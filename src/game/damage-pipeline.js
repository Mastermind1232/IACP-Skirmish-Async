/**
 * Centralized damage pipeline (destruct 2026-05-08).
 *
 * Every HP reduction in the codebase routes through `applyDamage` so
 * the same sequence of hooks fires regardless of the damage source —
 * main-target attack damage (step 7), Blast splash, Cleave, NPC
 * direct damage, and the damage branch of strain (when opponent
 * picks damage instead of discarding cards).
 *
 * Sequence:
 *   1. WHEN_DAMAGED hooks — fire BEFORE damage applies. Each may
 *      modify the amount (e.g. Sustained by Rage halves) or schedule
 *      side-effects (e.g. Fury of Kashyyyk grants Focus when ≥3 dmg).
 *      Hooks return the (possibly modified) amount.
 *   2. would-be-defeated check — compute newHp = max(0, currentHp − amount).
 *   3. BEFORE_DEFEATED hooks — fire ONLY if would-be-newHp === 0 AND
 *      figure is alive. May prevent defeat by setting result.preventDefeat
 *      or modifying amount. Examples: Final Stand, Dying Lunge,
 *      Second Chance, You Will Not Deny Me. Returns the resolved
 *      effect; caller may pause for player choice via pendingX flags.
 *   4. damage application — reduceHp(...) runs only if not prevented.
 *   5. WHEN_DEFEATED hooks — fire AFTER reduceHp confirms defeat.
 *      Examples: Heroic Effort, Apex Predator, Hunt Dissent,
 *      Celebration prompt, Debts Repaid (CC).
 *
 * Registries are exported so the slice-2b migration commits can
 * gradually move existing inline checks (Furious Charge,
 * Self-Preservation, Sustained by Rage, etc.) into the appropriate
 * category. The pipeline is correct from day-one even with empty
 * registries — it just delegates to reduceHp + processFigureDefeat
 * exactly as the call sites already do.
 *
 * Strain pipeline integration: applyStrain calls into applyDamage
 * with `viaStrain: true` for the damage branch (when opponent picks
 * damage). Some hooks may consult viaStrain to avoid double-firing
 * (e.g. Sustained by Rage modifies attack damage but not strain
 * damage — TBD per ability).
 */

import { reduceHp } from './damage-helpers.js';
import { getPlayableReactionCardsForTiming } from './cc-timing.js';
import { opponentPlayerNum, getInitiativePlayerNum } from './player-helpers.js';
import { markMapDirty } from './game-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { isFigureVanished } from './conditions.js';

/**
 * Canonical "X suffers N Damage (HP A→B)" message emitter (per
 * alexanbv 2026-05-13). Fires from every successful damage application
 * so every source — attack step 7 main target, Blast/Cleave/Direct-die
 * splash, Special-Action damage (Flamethrower, Slam, Headbutt, Force
 * Surge), Bleed, Strain→damage, Cut and Run, Tempt, Lure, Havoc Shot,
 * etc. — surfaces a single consistent line in the right channel.
 *
 * Routing:
 *  1. If `ctx.thread` is set (combat / interrupt thread) → post there.
 *  2. Else if `game.pendingCombat.combatThreadId` exists AND `ctx.client`
 *     can fetch it → post to the combat thread.
 *  3. Else fall back to `ctx.logGameAction` (game log channel).
 *
 * Callers may set `opts.suppressDamageMessage: true` to opt out (e.g.,
 * call sites that emit their own bespoke phrasing and haven't yet been
 * migrated; will be removed during the per-site cleanup pass).
 */
async function _emitDamageMessage(game, ctx, opts, applied) {
  if (!ctx || opts?.suppressDamageMessage) return;
  if (!applied || applied <= 0) return;
  const dcName = dcNameFromFigureKey(opts.figureKey) || opts.figureKey;
  const source = opts.source ? ` (${opts.source})` : '';
  const hpNote = (typeof opts._prevHp === 'number' && typeof opts._newHp === 'number')
    ? ` — HP ${opts._prevHp} → ${opts._newHp}`
    : '';
  const defeatedTag = (typeof opts._newHp === 'number' && opts._newHp <= 0) ? ' **(defeated)**' : '';
  const msg = `💢 **${dcName}** suffers **${applied} Damage**${source}${hpNote}${defeatedTag}`;
  // 1. ctx.thread first.
  if (ctx.thread && typeof ctx.thread.send === 'function') {
    await ctx.thread.send(msg).catch(() => {});
    return;
  }
  // 2. Active combat thread (fetch via client).
  const combatThreadId = game?.pendingCombat?.combatThreadId;
  if (combatThreadId && ctx.client && typeof ctx.client.channels?.fetch === 'function') {
    try {
      const t = await ctx.client.channels.fetch(combatThreadId);
      if (t && typeof t.send === 'function') {
        await t.send(msg).catch(() => {});
        return;
      }
    } catch { /* fall through to log */ }
  }
  // 3. Game log fallback.
  if (typeof ctx.logGameAction === 'function') {
    await ctx.logGameAction(game, ctx.client, msg, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  }
}

/**
 * @typedef {Object} DamageOpts
 * @property {string} figureKey
 * @property {string} msgId
 * @property {number} figIndex
 * @property {number} amount             - HP to remove (≥0; 0 short-circuits)
 * @property {number} controllerPlayerNum - the figure's owning player
 * @property {string} [source='Damage']  - free-form label for logs
 * @property {number} [attackerPlayerNum]
 * @property {string} [attackerFigureKey]
 * @property {boolean} [viaStrain=false] - true when called from strain pipeline's damage branch
 * @property {Object} [combat]            - active combat object, if applicable
 */

/**
 * @typedef {Object} DamageResult
 * @property {number} amount       - final amount applied (after when-damaged hooks)
 * @property {number} prevHp
 * @property {number} newHp
 * @property {boolean} wasDefeated
 * @property {boolean} preventDefeat - true if a before-defeated hook prevented defeat
 */

/**
 * CC-play window timings emitted by the pipeline. Each phase posts
 * a prompt to the relevant player's hand channel listing CCs with
 * matching `timing` field. Players play CCs orthogonally; the
 * pipeline does NOT pause for these (fire-and-forget). Defeat-
 * preventing CCs (Second Chance, YWNDM) must register as
 * BEFORE_DEFEATED hooks with sync logic — they cannot rely on the
 * notify window alone.
 *
 * Recognized timings (canonical names from CC effect data):
 *   - whenFigureSuffersDamage      — fired after damage applies
 *   - beforeFigureIsDefeated       — fired when would-be HP = 0
 *   - whenFigureIsDefeated         — fired after defeat confirmed
 *
 * Add more as cards are audited and their timings get codified.
 */
const CC_TIMINGS_WHEN_DAMAGED = [
  'whenFigureSuffersDamage',
  'afterHostileFigureSuffersDamage',
  'whenFriendlyFigureWithin2SpacesSuffers3PlusDamage',
];
const CC_TIMINGS_BEFORE_DEFEATED = [
  'beforeFigureIsDefeated',
  // destruct 2026-05-08: "when X suffers damage equal to its Health"
  // is canonical wording for the same trigger.
  'whenYouHaveSufferedDamageEqualToYourHealth',
  'whenFriendlyFigureWithin3SpacesWouldBeDefeated',
];
const CC_TIMINGS_WHEN_DEFEATED = [
  'whenFigureIsDefeated',
  'whenOneOfYourFiguresDefeated',
  'whenHostileFigureDefeatedNotYourActivation',
  'whenHostileFigureWithin3SpacesDefeated',
  'afterUniqueHostileDefeated',
];

/**
 * Notify both players that a CC-play window is open with the given
 * timings. For each player who has a matching CC in hand, posts a
 * lightweight prompt to their hand channel. Fire-and-forget; pipeline
 * does not block on player response.
 *
 * Players play CCs via the normal cc-hand handlers — those handlers
 * mutate game state which the next pipeline call observes.
 */
async function _notifyCcPlayWindow(game, ctx, timings, opts) {
  if (!ctx?.client || !timings?.length) return;
  const sendPrivateReactionPrompt = ctx.sendPrivateReactionPrompt;
  if (typeof sendPrivateReactionPrompt !== 'function') return;
  // Prompt players in the correct resolution order (alexanbv 2026-06-16): in an
  // attack the attacker resolves their reaction window first, then the defender;
  // outside an attack the initiative player goes first. opts.order is precomputed
  // by the caller from damageResolutionPlayerOrder; fall back to [1, 2].
  const order = Array.isArray(opts?.order) && opts.order.length === 2 ? opts.order : [1, 2];
  // Perspective split (alexanbv 2026-06-16): "hostile suffered damage" timings
  // (Opportunistic) belong to the OPPONENT of the suffering figure; the self /
  // friendly timings belong to the sufferer's controller. Without this, the window
  // wrongly offered Opportunistic to the sufferer's own controller (and the self
  // timings to the opponent). Gated only when the sufferer's controller is known.
  const HOSTILE_TIMINGS = new Set([
    'afterHostileFigureSuffersDamage',            // Opportunistic
    'whenHostileFigureDefeatedNotYourActivation',
    'whenHostileFigureWithin3SpacesDefeated',
    'afterUniqueHostileDefeated',
  ]);
  const controllerPn = opts?.controllerPlayerNum;
  for (const pn of order) {
    let pnTimings = timings;
    if (controllerPn === 1 || controllerPn === 2) {
      pnTimings = (pn === controllerPn)
        ? timings.filter((t) => !HOSTILE_TIMINGS.has(t)) // sufferer's controller: self/friendly reactions
        : timings.filter((t) => HOSTILE_TIMINGS.has(t));  // opponent: hostile-suffered reactions (Opportunistic)
    }
    if (!pnTimings.length) continue;
    const cards = getPlayableReactionCardsForTiming(game, pn, pnTimings);
    if (!cards.length) continue;
    try {
      await sendPrivateReactionPrompt(ctx.client, game, pn, cards.length, opts.contextLabel);
    } catch (_e) { /* non-fatal — prompt failure shouldn't break damage */ }
  }
}

/**
 * WHEN_DAMAGED registry. Each entry:
 *   { id: string,
 *     probe: (game, opts) => boolean,
 *     apply: async (game, opts, ctx) => { amount?: number, sideEffects?: ... } }
 *
 * `apply` returns an object whose `amount` (if defined) overrides the
 * pipeline's running amount. Side-effects (logs, condition application,
 * etc.) are the apply's responsibility.
 *
 * Empty for now; populated as inline checks migrate from combat-bridge.js.
 */
export const WHEN_DAMAGED_HOOKS = [];

/**
 * BEFORE_DEFEATED registry — fires when would-be-newHp === 0 AND
 * figure currently alive. Each entry:
 *   { id: string,
 *     probe: (game, opts) => boolean,
 *     apply: async (game, opts, ctx) =>
 *       { preventDefeat?: boolean, amount?: number, pendingPrompt?: any } }
 *
 * Some entries (Final Stand, Second Chance) may set pendingPrompt to
 * pause the pipeline for player choice — caller handles re-entry via
 * combat-bridge's existing pendingX patterns.
 */
export const BEFORE_DEFEATED_HOOKS = [];

/**
 * WHEN_DEFEATED registry — fires after reduceHp confirms defeat. Each
 * entry: { id, probe, apply }. apply is fire-and-forget (return value
 * ignored). Side-effects only — VP awards, prompt posts, etc.
 *
 * processFigureDefeat is invoked by the pipeline after these hooks
 * complete (or stays as the orchestrator if it's already capturing
 * everything — TBD as migrations land).
 */
export const WHEN_DEFEATED_HOOKS = [];

/**
 * Run the centralized damage pipeline for one figure.
 *
 * Day-one shape: with empty registries, this reduces to reduceHp() +
 * a defeat boolean. Migrations populate the registries; existing
 * inline checks at call sites get removed as they land.
 *
 * @param {object} game
 * @param {object} ctx          - dcHealthState, logGameAction, client, processFigureDefeat, ...
 * @param {DamageOpts} opts
 * @returns {Promise<DamageResult>}
 */
// Lazy hook registration: import damage-pipeline-hooks.js on first
// applyDamage call so the registry entries land before the first
// damage event. Avoids circular-import init-order issues.
let _hooksLoaded = false;
export async function _ensureHooksLoaded() {
  if (_hooksLoaded) return;
  _hooksLoaded = true;
  try {
    await import('./damage-pipeline-hooks.js');
  } catch (err) {
    console.error('[damage-pipeline] failed to load hooks:', err?.message ?? err);
  }
}

/**
 * The order in which the two players resolve their reaction abilities ("when
 * damaged" / "would be defeated" / "when defeated") for a suffering figure
 * (alexanbv 2026-06-16):
 *   - INSIDE an attack (opts.fromAttack or opts.combat): the ATTACKER resolves
 *     first, then the defender — so attacker damage-suffer abilities (e.g. the
 *     attacker's side playing Opportunistic on the defender's loss) go first.
 *   - NOT inside an attack (direct damage — Headbutt, Slam, a CC, …): the player
 *     with INITIATIVE resolves first, then the other player.
 * Returns [firstPlayerNum, secondPlayerNum].
 */
export function damageResolutionPlayerOrder(game, opts = {}) {
  const fromAttack = !!(opts.fromAttack || opts.combat);
  if (fromAttack) {
    const atk = opts.combat?.attackerPlayerNum ?? opts.attackerPlayerNum;
    if (atk === 1 || atk === 2) return [atk, opponentPlayerNum(atk)];
  }
  const init = getInitiativePlayerNum(game);
  if (init === 1 || init === 2) return [init, opponentPlayerNum(init)];
  return [1, 2];
}

/**
 * Probe-passing hooks, ordered by the OWNER player (alexanbv 2026-06-16: Onar/Baze
 * etc. must fire in the correct player timing, not registration order). A hook may
 * expose `ownerPlayer(game, opts)`; absent that, the owner defaults to the
 * suffering figure's team (`controllerPlayerNum`) — correct for the vast majority
 * of damage/defeat reactions ("a friendly protects me" / "I prevent my own
 * defeat"). Sorted by `order` (attacker-first in an attack, else initiative-first);
 * registration order breaks ties (stable). Probes are independent owner-presence
 * checks, so evaluating them all up front is safe.
 */
function _firingHooksInOrder(hooks, game, opts, order, syncOnly = false) {
  return hooks
    .filter((h) => h.probe && h.apply && (!syncOnly || h.sync) && h.probe(game, opts))
    .map((h, i) => {
      const pn = h.ownerPlayer ? h.ownerPlayer(game, opts) : opts.controllerPlayerNum;
      const k = order.indexOf(pn);
      return { h, i, k: k < 0 ? order.length : k };
    })
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.h);
}

export async function applyDamage(game, ctx, opts) {
  await _ensureHooksLoaded();
  if (!opts || !opts.figureKey || !opts.msgId) {
    throw new Error('applyDamage: figureKey + msgId required');
  }
  const amount = Math.max(0, parseInt(opts.amount || 0, 10));
  if (amount === 0) {
    return { amount: 0, prevHp: 0, newHp: 0, wasDefeated: false, preventDefeat: false };
  }
  // Vanish: the figure cannot suffer Damage until its next activation
  // (alexanbv 2026-06-19). All damage sources are blocked; the figure is still
  // targetable (Vanish only prevents the Damage/condition, not targeting).
  if (isFigureVanished(game, opts.figureKey)) {
    if (ctx?.logGameAction && ctx?.client) {
      await ctx.logGameAction(game, ctx.client, `**Vanish** — **${dcNameFromFigureKey(opts.figureKey)}** cannot suffer Damage (${amount} prevented).`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
    return { amount: 0, prevHp: 0, newHp: 0, wasDefeated: false, preventDefeat: false, vanishImmune: true };
  }

  // Order per destruct 2026-05-08:
  //   1. reduceHp first — HP fully applies. On-damage abilities
  //      trigger because the figure "took damage to become defeated".
  //   2. WHEN_DAMAGED hooks fire (after reduceHp).
  //   3. If newHp === 0 (the figure's health reached 0):
  //        a. BEFORE_DEFEATED CC-play window + sync hooks.
  //           Hooks may return preventDefeat=true to defer the
  //           defeat finalization until the interrupt resolves.
  //        b. If !preventDefeat: WHEN_DEFEATED hooks +
  //           CC-play window. Caller then calls processFigureDefeat.
  //
  // `opts._skipBeforeDefeatedHooks: true` — used by interrupt handlers
  // resuming a deferred defeat (e.g. completeDeferredDefeat after a
  // Parting Shot attack). Skips the BEFORE_DEFEATED window so the
  // hook doesn't re-fire on the same defeat event.

  // Snapshot defeated figure's position BEFORE reduceHp /
  // processFigureDefeat clear figurePositions. WHEN_DEFEATED hooks
  // with spatial probes (Brutal Tactics, Vengeance, Useful Hide,
  // Last Resort) consume `opts.defeatedPos` from the hook payload.
  const defeatedPosCandidate = opts.controllerPlayerNum
    ? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey] || null
    : null;

  // 1. reduceHp.
  const result = reduceHp(
    ctx.dcHealthState, game, opts.msgId, opts.figIndex, amount, opts.controllerPlayerNum,
  );
  const defeatedPos = result.wasDefeated ? defeatedPosCandidate : null;
  // Health-state change re-colors figure on minimap; defeat removes it.
  // Mark the map dirty so the next updateDcActionsMessage re-renders.
  if (result.prevHp !== result.newHp) markMapDirty(game);

  // Per alexanbv 2026-05-13: emit a single canonical "X suffers N
  // Damage (HP A→B)" message routed to combat thread / log. Annotate
  // opts so the emitter has HP context.
  const _applied = Math.max(0, (result.prevHp || 0) - (result.newHp || 0));
  if (_applied > 0) {
    await _emitDamageMessage(game, ctx, { ...opts, _prevHp: result.prevHp, _newHp: result.newHp }, _applied);
  }

  // 2. WHEN_DAMAGED hooks (post-reduce). Side effects only — amount has already
  //    applied. Fired in owner-player order (attacker-first / init-first).
  const _order = damageResolutionPlayerOrder(game, opts);
  const whenDamagedOpts = { ...opts, amount, prevHp: result.prevHp, newHp: result.newHp };
  for (const hook of _firingHooksInOrder(WHEN_DAMAGED_HOOKS, game, whenDamagedOpts, _order)) {
    try {
      await hook.apply(game, whenDamagedOpts, ctx);
    } catch (err) {
      console.error(`[damage-pipeline] WHEN_DAMAGED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }

  let preventDefeat = false;
  if (result.wasDefeated && !opts._skipBeforeDefeatedHooks) {
    // 3a. BEFORE_DEFEATED — CC-play window + sync hooks (owner-player ordered).
    await _notifyCcPlayWindow(game, ctx, CC_TIMINGS_BEFORE_DEFEATED, {
      contextLabel: `figure's HP reached 0 (${opts.source || 'Damage'})`,
      order: _order,
      controllerPlayerNum: opts.controllerPlayerNum,
    });
    const beforeOpts = { ...opts, amount, prevHp: result.prevHp, newHp: result.newHp, defeatedPos };
    for (const hook of _firingHooksInOrder(BEFORE_DEFEATED_HOOKS, game, beforeOpts, _order)) {
      const out = await hook.apply(game, beforeOpts, ctx);
      if (out?.preventDefeat) preventDefeat = true;
    }
  }

  if (result.wasDefeated && !preventDefeat) {
    // 3b. WHEN_DEFEATED hooks + CC-play window (owner-player ordered).
    const defeatedOpts = { ...opts, amount, prevHp: result.prevHp, defeatedPos };
    for (const hook of _firingHooksInOrder(WHEN_DEFEATED_HOOKS, game, defeatedOpts, _order)) {
      try {
        await hook.apply(game, defeatedOpts, ctx);
      } catch (err) {
        console.error(`[damage-pipeline] WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
      }
    }
    await _notifyCcPlayWindow(game, ctx, CC_TIMINGS_WHEN_DEFEATED, {
      contextLabel: `figure defeated (${opts.source || 'Damage'})`,
      order: damageResolutionPlayerOrder(game, opts),
      controllerPlayerNum: opts.controllerPlayerNum,
    });
  } else if (!result.wasDefeated) {
    // Survived damage — emit when-suffers-damage CC window.
    await _notifyCcPlayWindow(game, ctx, CC_TIMINGS_WHEN_DAMAGED, {
      contextLabel: `figure suffered damage (${opts.source || 'Damage'})`,
      order: damageResolutionPlayerOrder(game, opts),
      controllerPlayerNum: opts.controllerPlayerNum,
    });
  }

  return {
    amount,
    prevHp: result.prevHp,
    newHp: result.newHp,
    wasDefeated: !!result.wasDefeated,
    preventDefeat,
  };
}

/**
 * Synchronous variant of applyDamage for callers that can't await
 * (e.g. resolveAbility's `tempt` branch). Skips async hooks; only
 * runs hooks tagged `sync: true` in their registry entry. Use when
 * the caller is stuck in a sync function and the migration cost of
 * making it async is too high.
 *
 * Trade-off: when async-only hooks register (most will be async since
 * they may post Discord prompts), they DO NOT FIRE from sync callers.
 * Document each sync call site so registries don't surprise the
 * caller. Today, registries are empty, so behavior is identical to
 * the async variant.
 *
 * @param {object} game
 * @param {object} ctx
 * @param {DamageOpts} opts
 * @returns {DamageResult}
 */
export function applyDamageSync(game, ctx, opts) {
  // Sync caller can't await dynamic import — kick off hook load in
  // background; first sync call may miss hooks if registration hasn't
  // completed. Subsequent calls hit the populated registries.
  _ensureHooksLoaded();
  if (!opts || !opts.figureKey || !opts.msgId) {
    throw new Error('applyDamageSync: figureKey + msgId required');
  }
  const amount = Math.max(0, parseInt(opts.amount || 0, 10));
  if (amount === 0) {
    return { amount: 0, prevHp: 0, newHp: 0, wasDefeated: false, preventDefeat: false };
  }

  const defeatedPosCandidate = opts.controllerPlayerNum
    ? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey] || null
    : null;
  const result = reduceHp(
    ctx.dcHealthState, game, opts.msgId, opts.figIndex, amount, opts.controllerPlayerNum,
  );
  const defeatedPos = result.wasDefeated ? defeatedPosCandidate : null;
  if (result.prevHp !== result.newHp) markMapDirty(game);

  // Canonical damage message (alexanbv 2026-05-13). Sync caller can't
  // await; we fire-and-forget the promise (logGameAction itself is
  // typically a fire-and-forget Discord call).
  const _appliedSync = Math.max(0, (result.prevHp || 0) - (result.newHp || 0));
  if (_appliedSync > 0) {
    void _emitDamageMessage(game, ctx, { ...opts, _prevHp: result.prevHp, _newHp: result.newHp }, _appliedSync);
  }

  // WHEN_DAMAGED hooks fire post-reduceHp (side effects only) — owner-player ordered.
  const _orderSync = damageResolutionPlayerOrder(game, opts);
  const whenDamagedOpts = { ...opts, amount, prevHp: result.prevHp, newHp: result.newHp };
  for (const hook of _firingHooksInOrder(WHEN_DAMAGED_HOOKS, game, whenDamagedOpts, _orderSync, true)) {
    try {
      hook.apply(game, whenDamagedOpts, ctx);
    } catch (err) {
      console.error(`[damage-pipeline] sync WHEN_DAMAGED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }

  let preventDefeat = false;
  if (result.wasDefeated && !opts._skipBeforeDefeatedHooks) {
    const beforeOpts = { ...opts, amount, prevHp: result.prevHp, newHp: result.newHp, defeatedPos };
    for (const hook of _firingHooksInOrder(BEFORE_DEFEATED_HOOKS, game, beforeOpts, _orderSync, true)) {
      const out = hook.apply(game, beforeOpts, ctx);
      if (out?.preventDefeat) preventDefeat = true;
    }
  }

  if (result.wasDefeated && !preventDefeat) {
    const defeatedOpts = { ...opts, amount, prevHp: result.prevHp, defeatedPos };
    for (const hook of _firingHooksInOrder(WHEN_DEFEATED_HOOKS, game, defeatedOpts, _orderSync, true)) {
      try {
        hook.apply(game, defeatedOpts, ctx);
      } catch (err) {
        console.error(`[damage-pipeline] sync WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
      }
    }
  }
  return {
    amount,
    prevHp: result.prevHp,
    newHp: result.newHp,
    wasDefeated: !!result.wasDefeated,
    preventDefeat,
  };
}

/**
 * Cannot-be-defeated guard for direct-defeat target pickers.
 *
 * Per IACP: a "cannot be defeated" effect overrides direct-defeat
 * ability text. So Maul (while Sustained by Rage's no-activation
 * condition is met) and Fifth Brother (while You Will Not Deny Me is
 * attached & active) are NOT selectable as targets by IWBA, Voracious,
 * Evacuate, or any other direct-defeat ability. Note: Second Chance is
 * NOT a "cannot" effect — it triggers on defeat to recover, so SC-
 * protected figures ARE selectable; the SC hook handles the heal at
 * apply time.
 *
 * @returns {boolean} true if this figure currently cannot be defeated
 *   and should be filtered out of direct-defeat target pickers.
 */
export function isImmuneToDirectDefeat(game, controllerPlayerNum, figureKey) {
  if (!game || !controllerPlayerNum || !figureKey) return false;
  // You Will Not Deny Me (Fifth Brother): active while the CC is
  // attached and youWillNotDenyMeActive flags it for this side.
  if (game.youWillNotDenyMeActive?.[controllerPlayerNum]) {
    const dcName = String(figureKey).split('-')[0] || '';
    if (dcName.toLowerCase().includes('fifth')) return true;
  }
  // Sustained by Rage (Maul): active while the DC has not resolved an
  // activation this round.
  try {
    const dcName = String(figureKey).split('-')[0] || '';
    const eff = (typeof getDcEffectsModule === 'function' ? getDcEffectsModule() : null)?.[dcName];
    if ((eff?.specialAbilityIds || []).includes('sustained_by_rage')) {
      // Find the figure's DC index via figureKey → dcName matching the
      // controller's dcList. If the index is NOT in activatedDcIndices,
      // SBR is active.
      const list = controllerPlayerNum === 1 ? game.p1DcList : game.p2DcList;
      const ids = controllerPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const activated = controllerPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
      if (Array.isArray(list)) {
        const idx = list.findIndex(d => (d?.dcName || d) === dcName);
        if (idx >= 0 && !activated.includes(idx) && (ids?.[idx])) return true;
      }
    }
  } catch { /* fail-open: don't crash the picker */ }
  return false;
}

// Local resolver for getDcEffects so the helper above doesn't import
// the data-loader at module-load time (avoid circular ESM init).
let _cachedDcEffectsResolver = null;
function getDcEffectsModule() {
  if (_cachedDcEffectsResolver) return _cachedDcEffectsResolver();
  // Lazy-init: dynamic-require pattern via Function constructor would
  // be over-engineering. Instead, import at call time and cache.
  // (Sync require is unavailable in ESM; this returns null on the
  // first call — caller handles undefined effects gracefully.)
  return null;
}

/**
 * Test/init helper to wire the dc-effects resolver lazily. Called
 * from the damage-pipeline-hooks loader so isImmuneToDirectDefeat can
 * read keyword data without static imports.
 */
export function _registerDcEffectsResolver(fn) {
  _cachedDcEffectsResolver = fn;
}

/**
 * Direct-defeat path. Some abilities defeat a figure WITHOUT the
 * figure suffering damage (Cassian's "It Will Be Alright", Rancor's
 * "Voracious", the "Evacuate" CC, etc.). Per IACP, those abilities
 * skip the damage triggers entirely:
 *   - No WHEN_DAMAGED hooks (figure didn't suffer damage)
 *   - No BEFORE_DEFEATED hooks (no "would-be-defeated by damage"
 *     interrupts — Last Resort, YWNDM, Second Chance, SDP, etc. do
 *     not fire)
 *   - WHEN_DEFEATED hooks DO fire (Last Stand, Bounty, Apex Predator,
 *     This is the Way, Useful Hide, etc. — these are "when this
 *     figure is defeated" triggers regardless of cause)
 *   - processFigureDefeat finalizes (VP, board cleanup, activation
 *     decrement, attachment cleanup, passive redraws, defeat log,
 *     win conditions)
 *
 * State change: HP is recorded as 0 via reduceHp(prevHp) so the
 * dcHealthState mirrors the death.
 *
 * @param {object} game
 * @param {object} ctx — same shape as applyDamage's ctx (dcHealthState,
 *   logGameAction, client, processFigureDefeat, dcMessageMeta, etc.)
 * @param {object} opts
 * @param {string} opts.figureKey
 * @param {string} opts.msgId
 * @param {number} opts.figIndex
 * @param {number} opts.controllerPlayerNum
 * @param {number|null} [opts.attackerPlayerNum=null] — null for
 *   self-inflicted (Voracious, IWBA, Evacuate); set when "directly
 *   defeats" is from an opposing source for VP attribution.
 * @param {string} [opts.source=''] — card name for logs.
 */
export async function applyDirectDefeat(game, ctx, opts) {
  await _ensureHooksLoaded();
  if (!opts || !opts.figureKey || !opts.msgId) {
    throw new Error('applyDirectDefeat: figureKey + msgId required');
  }
  // Snapshot position BEFORE state mutations (WHEN_DEFEATED hooks
  // with spatial probes need the pre-cleanup position).
  const defeatedPos = opts.controllerPlayerNum
    ? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey] || null
    : null;
  // Record HP=0. Compute current HP and reduce by exactly that amount.
  const hs = ctx.dcHealthState?.get?.(opts.msgId) || [];
  const figHp = hs[opts.figIndex];
  const curHp = Array.isArray(figHp) ? Math.max(0, figHp[0] ?? 0) : 0;
  if (curHp > 0) {
    reduceHp(ctx.dcHealthState, game, opts.msgId, opts.figIndex, curHp, opts.controllerPlayerNum);
  }
  const defeatedOpts = {
    ...opts,
    amount: curHp,
    prevHp: curHp,
    newHp: 0,
    defeatedPos,
    directDefeat: true,
  };
  // BEFORE_DEFEATED hooks fire on direct defeat too, EXCEPT for hooks
  // whose canonical trigger text requires "suffered damage equal to
  // health" (Self-Destruct Protocol, Last Resort, Parting Shot).
  // Those are tagged `requiresDamage: true` on registration; we skip
  // them on the direct-defeat path. Categorical "would be defeated"
  // hooks (You Will Not Deny Me, Sustained by Rage, Second Chance,
  // Executor RGC, etc.) DO fire — they're independent of damage.
  // CC-play timing window for "before defeated" also fires.
  await _notifyCcPlayWindow(game, ctx, CC_TIMINGS_BEFORE_DEFEATED, {
    contextLabel: `figure directly defeated (${opts.source || 'ability'})`,
    order: damageResolutionPlayerOrder(game, opts),
    controllerPlayerNum: opts.controllerPlayerNum,
  });
  let preventDefeat = false;
  // Owner-player ordered; requiresDamage hooks (Parting Shot / Last Resort /
  // Self-Destruct) are skipped on the direct-defeat path (no damage was suffered).
  const _ddOrder = damageResolutionPlayerOrder(game, opts);
  const _ddBefore = BEFORE_DEFEATED_HOOKS.filter((h) => !h.requiresDamage);
  for (const hook of _firingHooksInOrder(_ddBefore, game, defeatedOpts, _ddOrder)) {
    try {
      const out = await hook.apply(game, defeatedOpts, ctx);
      if (out?.preventDefeat) preventDefeat = true;
    } catch (err) {
      console.error(`[damage-pipeline] direct-defeat BEFORE_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }
  if (preventDefeat) {
    return {
      figureKey: opts.figureKey,
      prevHp: curHp,
      newHp: 0,
      wasDefeated: false,
      preventDefeat: true,
    };
  }
  // WHEN_DEFEATED hooks. Mirrors applyDamage's WHEN_DEFEATED block (owner-ordered).
  for (const hook of _firingHooksInOrder(WHEN_DEFEATED_HOOKS, game, defeatedOpts, _ddOrder)) {
    try {
      await hook.apply(game, defeatedOpts, ctx);
    } catch (err) {
      console.error(`[damage-pipeline] direct-defeat WHEN_DEFEATED hook ${hook.id} threw:`, err?.message ?? err);
    }
  }
  await _notifyCcPlayWindow(game, ctx, CC_TIMINGS_WHEN_DEFEATED, {
    contextLabel: `figure directly defeated (${opts.source || 'ability'})`,
    order: damageResolutionPlayerOrder(game, opts),
    controllerPlayerNum: opts.controllerPlayerNum,
  });
  // processFigureDefeat (VP, removeFromBoard, attachment cleanup,
  // activation decrement, passive redraws, defeat log, win conditions).
  if (typeof ctx?.processFigureDefeat === 'function') {
    await ctx.processFigureDefeat(game, {
      defeatedPlayerNum: opts.controllerPlayerNum,
      figureKey: opts.figureKey,
      attackerPlayerNum: opts.attackerPlayerNum ?? null,
      msgId: opts.msgId,
      dcName: opts.dcName ?? undefined,
      displayName: opts.displayName ?? undefined,
      source: opts.source || 'direct defeat',
    });
  }
  return {
    figureKey: opts.figureKey,
    prevHp: curHp,
    newHp: 0,
    wasDefeated: true,
  };
}

/**
 * Test-helper: clear all registries. Used by unit tests to isolate
 * pipeline behavior from migration drift.
 */
export function _clearRegistries() {
  WHEN_DAMAGED_HOOKS.length = 0;
  BEFORE_DEFEATED_HOOKS.length = 0;
  WHEN_DEFEATED_HOOKS.length = 0;
}
