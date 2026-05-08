/**
 * Damage pipeline hook registrations.
 *
 * Each hook is a small object pushed onto one of three registries:
 *   - WHEN_DAMAGED_HOOKS  (after damage applies, figure alive)
 *   - BEFORE_DEFEATED_HOOKS (would-be HP=0, before reduceHp)
 *   - WHEN_DEFEATED_HOOKS  (after defeat confirmed)
 *
 * Hooks fire from EVERY call site that reduces HP — main attack
 * damage, Blast/Cleave splash, NPC direct, strain → damage,
 * crate explosion, Bleeding, Stun Batons, etc.
 *
 * To register a new ability:
 *   1. Decide which registry (when-damaged / before-defeated / when-defeated).
 *   2. Write a `probe(game, opts)` returning true when this ability
 *      should fire for the current damage event.
 *   3. Write an `apply(game, opts, ctx)` that performs the side-effect
 *      (and optionally returns `{ amount, preventDefeat }` to influence
 *      the pipeline).
 *   4. Tag with `sync: true` if the apply is synchronous AND should
 *      fire from sync call sites (resolveAbility's tempt, etc.).
 *
 * Many existing inline checks in combat-bridge.js can be moved here
 * incrementally; each migration removes one inline if-block and
 * pushes one registry entry.
 *
 * THIS COMMIT: registers Fury of Kashyyyk + Self-Preservation as the
 * proof-of-pattern. Remaining audited abilities (Sustained by Rage,
 * YWNDM, Bounty, Apex Predator, Hunt Dissent, Forward Vengeance,
 * Vengeance, Executor, Brutal Tactics, Nefarious Gains, Heroic
 * Effort, Into the Force, Last Stand, Useful Hide, Parting Shot,
 * Self-Destruct Protocol, Devastator) land in follow-up commits.
 */
import {
  WHEN_DAMAGED_HOOKS,
  BEFORE_DEFEATED_HOOKS,
  WHEN_DEFEATED_HOOKS,
} from './damage-pipeline.js';
import { getDcList, getDcMessageIds, opponentPlayerNum, vpKey, getActivatedDcIndices, dcAttachmentsKey } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcEffects, getDcKeywords, getMapData, isDcUnique } from '../data-loader.js';
import { applyCondition, isConditionImmune, areConditionEffectsSuppressed } from './conditions.js';
import { awardObjectiveVp } from './vp-helpers.js';
import { countGameSpaces } from './board-helpers.js';
import { grantPowerTokens } from './game-helpers.js';
import { healHp } from './damage-helpers.js';
import { setPendingCelebration, setPendingPartingShot, setPendingSelfDestruct, setPendingLastResort } from './interrupts.js';
import { cardNameIncludes } from './card-names.js';

// ── WHEN_DAMAGED ────────────────────────────────────────────────────────────

/**
 * Fury of Kashyyyk (army-wide CC attachment): when a friendly WOOKIEE
 * suffers ≥3 damage, that WOOKIEE becomes Focused. Fires after damage
 * applies, only if the figure survived (otherwise defeat supersedes).
 *
 * destruct 2026-05-08: this is a generic when-damaged trigger, not
 * specific to Blast/Cleave. Pulled from combat-bridge.js inline path
 * (still inline there for now; remove in cleanup pass once verified).
 */
WHEN_DAMAGED_HOOKS.push({
  id: 'fury_of_kashyyyk',
  sync: true,
  probe: (game, opts) => {
    if ((opts.amount || 0) < 3) return false;
    if (!opts.figureKey) return false;
    // Player owning the figure must have [Fury of Kashyyyk] attachment in army.
    const dcList = getDcList(game, opts.controllerPlayerNum) || [];
    if (!dcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) return false;
    // Figure itself must be a WOOKIEE.
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const kws = (getDcKeywords(game)?.[dcName] || []).map(k => String(k).toUpperCase());
    return kws.includes('WOOKIEE');
  },
  apply: (game, opts, _ctx) => {
    if (!opts.figureKey) return;
    applyCondition(game, opts.figureKey, 'Focus');
    // Note: log message is emitted by the inline path in combat-bridge.js
    // until that inline check is removed in the cleanup pass.
  },
});

/**
 * Self-Preservation (Hired Gun Elite): when this figure suffers
 * Damage, become Focused. Fires after damage applies, only if the
 * figure survived. Auto-applied; no player choice.
 */
WHEN_DAMAGED_HOOKS.push({
  id: 'self_preservation_hired_gun_elite',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    if ((opts.amount || 0) <= 0) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    return (eff?.specialAbilityIds || []).includes('self_preservation_hired_gun_elite');
  },
  apply: (game, opts, _ctx) => {
    if (!opts.figureKey) return;
    applyCondition(game, opts.figureKey, 'Focus');
  },
});

// ── BEFORE_DEFEATED ────────────────────────────────────────────────────────

/**
 * You Will Not Deny Me (Fifth Brother CC effect): when active for the
 * defender's player, Fifth Brother cannot be defeated. Per destruct
 * 2026-05-08: YWNDM keeps the figure at HP=0 (no heal), defeat
 * suppressed until the falloff condition triggers (e.g. round end
 * or hostile-defeated heal). Auto-applied; no prompt.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'you_will_not_deny_me',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    if (game.youWillNotDenyMeActive?.playerNum !== opts.controllerPlayerNum) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    return !!dcName && dcName.toLowerCase().includes('fifth');
  },
  apply: (game, opts, ctx) => {
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `**You Will Not Deny Me** — Fifth Brother cannot be defeated! Damage capped at health.`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
    return { preventDefeat: true };
  },
});

/**
 * Sustained by Rage (Krrsantan): cannot be defeated if has not
 * activated this round. Per CRR + destruct: HP stays at 0, defeat
 * suppressed until Krrsantan activates (then SbR no longer applies).
 * Auto-applied; no prompt.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'sustained_by_rage',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    if (!(eff?.specialAbilityIds || []).includes('sustained_by_rage')) return false;
    const dcMessageIds = getDcMessageIds(game, opts.controllerPlayerNum) || [];
    const idx = dcMessageIds.indexOf(opts.msgId);
    if (idx < 0) return false;
    const activated = getActivatedDcIndices(game, opts.controllerPlayerNum) || [];
    return !activated.includes(idx);
  },
  apply: (game, opts, ctx) => {
    const dcName = dcNameFromFigureKey(opts.figureKey);
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `**Sustained by Rage** — **${dcName}** cannot be defeated (has not activated this round)! Damage capped at health.`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
    return { preventDefeat: true };
  },
});

/**
 * Second Chance (CC attachment): when this DC is at HP=0, recover 2
 * Damage and discard the card. State carrier:
 * `game.secondChanceDcMsgId[msgId] === playerNum`. Auto-applied; the
 * heal restores HP > 0 so completeDeferredDefeat / downstream defeat
 * checks see the figure is alive.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'second_chance',
  sync: true,
  probe: (game, opts) => {
    if (!opts.msgId || !opts.controllerPlayerNum) return false;
    return game.secondChanceDcMsgId?.[opts.msgId] === opts.controllerPlayerNum;
  },
  apply: (game, opts, ctx) => {
    if (!ctx?.dcHealthState) return { preventDefeat: true };
    const { newHp } = healHp(ctx.dcHealthState, game, opts.msgId, opts.figIndex, 2, opts.controllerPlayerNum);
    delete game.secondChanceDcMsgId[opts.msgId];
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `**Second Chance** triggered! Recovered 2 Damage (HP → ${newHp}). Card discarded.`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
    return { preventDefeat: true };
  },
});

/**
 * Last Resort (Skirmish Upgrade attachment): "Deplete this card when
 * a figure in this group has suffered Damage equal to its Health.
 * Before that figure is defeated, roll 1 red die. Each figure and
 * object on or adjacent to that figure suffers Damage equal to the
 * Hit results."
 *
 * Detection: cardNameIncludes(playerAttachments, 'Last Resort') for
 * the defender's player. Once-per-figure flag
 * `game.lastResortTriggered[msgId]` prevents repeats.
 *
 * Returns preventDefeat=true; sets pendingLastResort. Handler in
 * src/handlers/interrupts.js (handleLastResort) does the roll +
 * splash + completeDeferredDefeat.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'last_resort',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.lastResortTriggered?.[opts.msgId]) return false;
    const attKey = dcAttachmentsKey(opts.controllerPlayerNum);
    const upgrades = game[attKey]?.[opts.msgId] || [];
    return cardNameIncludes(upgrades, 'Last Resort');
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return null;
    if (ctx?.client?._isFakeClient) return null;
    game.lastResortTriggered = game.lastResortTriggered || {};
    game.lastResortTriggered[opts.msgId] = true;
    setPendingLastResort(game, {
      gameId: game.gameId,
      figureKey: opts.figureKey,
      msgId: opts.msgId,
      figIndex: opts.figIndex,
      controllerPlayerNum: opts.controllerPlayerNum,
      defenderPlayerNum: opts.controllerPlayerNum,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
      // Legacy fields used by handleLastResort's adjacency math:
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
    });
    const ownerId = game[`player${opts.controllerPlayerNum}Id`];
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`last_resort_use_${game.gameId}_${opts.msgId}`).setLabel('Use Last Resort').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`last_resort_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> **Last Resort** — **${dcName}** is about to be defeated! Deplete to roll 1 red die — adjacent figures suffer Hits as Damage.`
        : `**Last Resort** — **${dcName}** is about to be defeated! Deplete to roll 1 red die — adjacent figures suffer Hits as Damage.`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

/**
 * Parting Shot (Hired Gun, Greedo): "When this figure is about to be
 * defeated, you may interrupt to perform an attack. Then, this figure
 * is defeated."
 *
 * Deferred-defeat: hook returns `preventDefeat: true`, sets
 * `pendingPartingShot`, posts [Fire Parting Shot] [Skip] in the combat
 * thread. Player handlers (parting-shot.js) call
 * `completeDeferredDefeat` to resume the defeat through applyDamage
 * with `_skipBeforeDefeatedHooks: true` so the hook doesn't re-fire.
 *
 * Stun guard: per CRR p.58, a Stunned figure cannot declare an attack,
 * so Parting Shot is suppressed. Uses pre-Step-8 condition snapshot if
 * available (combat._step7DefenderConds) per destruct's clarification
 * "PS at Step 7 fires before Stun at Step 8".
 *
 * Once-per-figure: `partingShotTriggered[msgId]` flag prevents repeats
 * if a figure is "about to be defeated" multiple times in the same
 * frame (e.g. Blast splash overlap).
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'parting_shot',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.partingShotTriggered?.[opts.msgId]) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    const sIds = eff?.specialAbilityIds || [];
    if (!sIds.some(id => id.startsWith('parting_shot_'))) return false;
    // Stun gate: pre-Step-8 snapshot (PS resolves at Step 7).
    const preConds = opts.combat?._step7DefenderConds
      ?? (game.figureConditions?.[opts.figureKey] || []);
    const suppressed = areConditionEffectsSuppressed(game, opts.figureKey);
    if (preConds.includes('Stun') && !suppressed) return false;
    return true;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) {
      // No prompt UI available (non-Discord ctx, e.g. headless replay).
      // Skip the interrupt, let defeat proceed normally.
      return null;
    }
    // Headless / oracle / fixture client — no human to click buttons.
    // Skip the interrupt and let defeat proceed normally so combat
    // tests don't deadlock waiting for a Discord click.
    if (ctx?.client?._isFakeClient) {
      return null;
    }
    game.partingShotTriggered = game.partingShotTriggered || {};
    game.partingShotTriggered[opts.msgId] = true;
    setPendingPartingShot(game, {
      gameId: game.gameId,
      figureKey: opts.figureKey,
      msgId: opts.msgId,
      figIndex: opts.figIndex,
      controllerPlayerNum: opts.controllerPlayerNum,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
      active: false,
    });
    const ownerId = game[`player${opts.controllerPlayerNum}Id`];
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`parting_shot_fire_${game.gameId}_${opts.msgId}`).setLabel('Fire Parting Shot').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`parting_shot_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> ⚠️ **Parting Shot** — **${dcName}** is about to be defeated. Fire a free attack first?`
        : `⚠️ **Parting Shot** — **${dcName}** is about to be defeated. Fire a free attack first?`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

// ── WHEN_DEFEATED ──────────────────────────────────────────────────────────

/**
 * Bounty (Fennec Shand passive): when this figure is defeated, the
 * opponent gains 2 VP. Source-agnostic: triggers from attack, Bleed,
 * Blast splash, etc. Inline path in combat-bridge.js was removed in
 * the same commit to prevent double-award.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'bounty',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.passives || []).includes('Bounty');
  },
  apply: (game, opts, ctx) => {
    if (!opts.figureKey) return;
    const oppPn = opts.attackerPlayerNum
      ?? (opts.controllerPlayerNum ? opponentPlayerNum(opts.controllerPlayerNum) : null);
    if (!oppPn) return;
    awardObjectiveVp(game, oppPn, 2);
    const total = game[vpKey(oppPn)]?.total ?? '?';
    const dcName = dcNameFromFigureKey(opts.figureKey);
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `\u{1F4B0} **Bounty** — **${dcName}** was defeated. Opponent (P${oppPn}) gains **2 VP** (${total} total).`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
  },
});

/**
 * Last Stand (Stormtrooper Elite passive): when this figure is
 * defeated, another figure in the same group becomes Focused.
 * Idempotent (`applyCondition` returns false if already present), so
 * inline path in combat-bridge.js is left alone for now — hook fires
 * orthogonally on non-combat defeats (Bleed, Blast splash, etc.).
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'last_stand',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.passives || []).includes('Last Stand');
  },
  apply: (game, opts, ctx) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const dgMatch = (opts.figureKey || '').match(/-(\d+)-\d+$/);
    const dgIdx = dgMatch ? dgMatch[1] : '1';
    const prefix = `${dcName}-${dgIdx}-`;
    const alive = Object.keys(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(k => k.startsWith(prefix) && k !== opts.figureKey);
    if (alive.length === 0) return;
    const target = alive[0];
    if (applyCondition(game, target, 'Focus')) {
      const targetName = dcNameFromFigureKey(target);
      if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
        ctx.logGameAction(
          game,
          ctx.client,
          `⚡ **Last Stand** — **${targetName}** becomes **Focused** (another figure in the group was defeated).`,
          { phase: 'ROUND', icon: 'card' },
        ).catch(() => {});
      }
    }
  },
});

/**
 * Apex Predator (CC effect): when this attacker defeats a hostile
 * within range, recover N HP. State carrier is `game.recoverOnHostileDefeat[playerNum] = { msgId, range, amount }`,
 * set by resolveAbility when Apex Predator is played. Today this is
 * combat-only — non-combat defeats (Bleed, Blast splash) don't pass
 * the attacker figure index needed for the heal target. Probe
 * requires an active combat-style attack frame.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'apex_predator_recover',
  sync: true,
  probe: (game, opts) => {
    if (!opts.attackerPlayerNum) return false;
    const apData = game.recoverOnHostileDefeat?.[opts.attackerPlayerNum];
    if (!apData) return false;
    if (!opts.combat) return false;
    const range = apData.range ?? 2;
    const dist = opts.combat.distanceToTarget ?? 0;
    return dist <= range;
  },
  apply: (game, opts, ctx) => {
    const apData = game.recoverOnHostileDefeat?.[opts.attackerPlayerNum];
    if (!apData) return;
    const apMsgId = apData.msgId ?? opts.combat?.attackerMsgId;
    const apAmt = apData.amount ?? 2;
    if (apMsgId && ctx?.dcHealthState) {
      const figIdx = opts.combat?.attackerFigureIndex ?? 0;
      const { healed } = healHp(ctx.dcHealthState, game, apMsgId, figIdx, apAmt, opts.attackerPlayerNum);
      if (healed > 0 && typeof ctx?.logGameAction === 'function' && ctx?.client) {
        const range = apData.range ?? 2;
        ctx.logGameAction(
          game,
          ctx.client,
          `**Apex Predator** — Recovered ${apAmt} HP after defeating hostile within ${range}.`,
          { phase: 'ROUND', icon: 'card' },
        ).catch(() => {});
      }
    }
    delete game.recoverOnHostileDefeat[opts.attackerPlayerNum];
  },
});

// Useful Hide registered below alongside Into the Force (player-pick).

/**
 * Celebration (Command Card auto-prompt): when a unique hostile is
 * defeated, post a "Play Celebration / Pass" button row in the combat
 * thread. Player can also play the card from hand normally; the hook's
 * job is the auto-prompt only. Falls back to no-op when ctx lacks a
 * thread (non-combat defeats — Bleed end-of-action, etc — still notify
 * via the CC-play timing window in hand channels).
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'celebration_auto_prompt',
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    if (!opts.attackerPlayerNum) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    return !!isDcUnique(dcName);
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return;
    // Headless / oracle / fixture client — no human to click buttons.
    if (ctx?.client?._isFakeClient) return;
    const ownerId = game[`player${opts.attackerPlayerNum}Id`];
    setPendingCelebration(game, {
      attackerPlayerNum: opts.attackerPlayerNum,
      combatThreadId: opts.combat?.combatThreadId ?? thread?.id,
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`celebration_play_${game.gameId}`).setLabel('Play Celebration (+4 VP)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`celebration_pass_${game.gameId}`).setLabel('Pass').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> — You defeated a unique figure. Play **Celebration** to gain 4 VP?`
        : `Unique figure defeated. Play **Celebration** to gain 4 VP?`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
  },
});

/**
 * Brutal Tactics (Saw Gerrera passive): once per round, when a hostile
 * figure is defeated, choose **one** hostile within 3 spaces — that
 * figure becomes Weakened. Player-pick prompt: posts a button row to
 * combat thread. Hook is async because it dispatches the prompt; only
 * fires when ctx carries deps + thread.
 *
 * Trigger side: the player WITH Saw on the board, when an opposing
 * figure dies. Pipeline opts.controllerPlayerNum is the defeated
 * figure's owner; Saw lives on the OTHER side, so that side does the
 * choosing.
 *
 * Once-per-round limit not yet enforced — preserve parity with the
 * old inline path, revisit alongside the per-round-limit cleanup.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'brutal_tactics',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    if (!opts.defeatedPos) return false;
    const triggerSidePn = opts.controllerPlayerNum === 1 ? 2 : 1;
    const figs = Object.keys(game.figurePositions?.[triggerSidePn] || {});
    return figs.some(fk => {
      const dcN = dcNameFromFigureKey(fk);
      return (getDcEffects()?.[dcN]?.passives || []).includes('Brutal Tactics');
    });
  },
  apply: async (game, opts, ctx) => {
    const enemyPos = game.figurePositions?.[opts.controllerPlayerNum] || {};
    const eligible = [];
    for (const [fk, pos] of Object.entries(enemyPos)) {
      if (!pos || fk === opts.figureKey) continue;
      const dist = countGameSpaces(game, opts.defeatedPos, pos);
      if (dist > 3) continue;
      if (isConditionImmune(game, fk)) continue;
      eligible.push({ figureKey: fk, label: dcNameFromFigureKey(fk) });
    }
    if (eligible.length === 0) return;
    const { openDefeatPick } = await import('../handlers/defeat-pick.js');
    await openDefeatPick(game, ctx, {
      kind: 'bt',
      controllerPlayerNum: opts.controllerPlayerNum,
      defeatedFigureKey: opts.figureKey,
      options: eligible,
    });
  },
});

/**
 * Vengeance (Royal Guard Regular): when an adjacent friendly non-
 * GUARDIAN, non-companion figure is defeated, this RG becomes Focused.
 *
 * Forward Vengeance (Royal Guard Elite) is the same trigger PLUS an
 * optional 1-space move. The move requires a UI prompt (granted-move
 * button) — that prompt path stays in combat-bridge.js for now since
 * the pipeline doesn't have access to deps/thread. The hook here only
 * handles the Focus side-effect for both variants.
 *
 * Inline path retained in combat-bridge.js for the move prompt. Focus
 * application is idempotent (`applyCondition` no-ops if already
 * focused), so dual-fire is safe.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'royal_guard_vengeance_focus',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    if (!opts.defeatedPos) return false;
    // Defeated figure must be non-GUARDIAN (per card text).
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
    if (kws.includes('GUARDIAN')) return false;
    // Same-side RG must exist adjacent to defeated position.
    const ms = getMapData(game.selectedMap?.id);
    const adj = (ms?.adjacency?.[String(opts.defeatedPos).toLowerCase()] || [])
      .map(a => String(a).toLowerCase());
    if (adj.length === 0) return false;
    return Object.entries(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .some(([rgFk, rgPos]) => {
        if (!rgPos || rgFk === opts.figureKey) return false;
        if (!adj.includes(String(rgPos).toLowerCase())) return false;
        const rgDc = dcNameFromFigureKey(rgFk);
        return rgDc === 'Royal Guard (Regular)' || rgDc === 'Royal Guard (Elite)';
      });
  },
  apply: (game, opts, ctx) => {
    const ms = getMapData(game.selectedMap?.id);
    const adj = (ms?.adjacency?.[String(opts.defeatedPos).toLowerCase()] || [])
      .map(a => String(a).toLowerCase());
    for (const [rgFk, rgPos] of Object.entries(game.figurePositions?.[opts.controllerPlayerNum] || {})) {
      if (!rgPos || rgFk === opts.figureKey) continue;
      if (!adj.includes(String(rgPos).toLowerCase())) continue;
      const rgDc = dcNameFromFigureKey(rgFk);
      if (rgDc !== 'Royal Guard (Regular)' && rgDc !== 'Royal Guard (Elite)') continue;
      if (applyCondition(game, rgFk, 'Focus')) {
        const label = rgDc === 'Royal Guard (Elite)' ? 'Forward Vengeance' : 'Vengeance';
        if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
          ctx.logGameAction(
            game,
            ctx.client,
            `⚔️ **${label}** — **${rgDc}** becomes **Focused** (adjacent friendly defeated).`,
            { phase: 'ROUND', icon: 'card' },
          ).catch(() => {});
        }
      }
    }
  },
});

/**
 * Into the Force (Obi-Wan Kenobi): when defeated, choose another
 * friendly figure — that figure becomes Focused. Player-pick prompt
 * via openDefeatPick. Async; requires ctx with deps + thread.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'into_the_force_obiwan',
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    if (dcName !== 'Obi-Wan Kenobi') return false;
    const eff = getDcEffects()?.[dcName];
    return (eff?.specialAbilityIds || []).includes('into_the_force_obiwan');
  },
  apply: async (game, opts, ctx) => {
    if (!opts.controllerPlayerNum) return;
    const alive = Object.keys(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(k => !k.startsWith('Obi-Wan Kenobi-'));
    if (alive.length === 0) return;
    const options = alive.map(fk => ({ figureKey: fk, label: dcNameFromFigureKey(fk) }));
    const { openDefeatPick } = await import('../handlers/defeat-pick.js');
    await openDefeatPick(game, ctx, {
      kind: 'itf',
      controllerPlayerNum: opts.controllerPlayerNum,
      defeatedFigureKey: opts.figureKey,
      options,
    });
  },
});

/**
 * Useful Hide (Tauntaun Rider): when defeated, distribute up to 2
 * Evade Tokens among friendly figures within 3 spaces. Player-pick
 * prompt that re-prompts after each pick until 2 distributed or Done
 * pressed.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'useful_hide_tauntaun',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    if (!opts.defeatedPos) return false;
    return dcNameFromFigureKey(opts.figureKey) === 'Tauntaun Rider';
  },
  apply: async (game, opts, ctx) => {
    const friendly = Object.entries(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(([k, pos]) => k !== opts.figureKey && pos && countGameSpaces(game, opts.defeatedPos, pos) <= 3)
      .map(([k]) => ({ figureKey: k, label: dcNameFromFigureKey(k) }));
    if (friendly.length === 0) return;
    const { openDefeatPick } = await import('../handlers/defeat-pick.js');
    await openDefeatPick(game, ctx, {
      kind: 'uh',
      controllerPlayerNum: opts.controllerPlayerNum,
      defeatedFigureKey: opts.figureKey,
      options: friendly,
      remaining: 2,
    });
  },
});
