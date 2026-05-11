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
  _registerDcEffectsResolver,
} from './damage-pipeline.js';
import { getDcList, getDcMessageIds, opponentPlayerNum, vpKey, getActivatedDcIndices, dcAttachmentsKey } from './player-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { getDcEffects, getDcKeywords, getMapData, isDcUnique } from '../data-loader.js';
import { applyCondition, isConditionImmune, areConditionEffectsSuppressed } from './conditions.js';
import { awardObjectiveVp } from './vp-helpers.js';
import { countGameSpaces } from './board-helpers.js';
import { grantPowerTokens } from './game-helpers.js';
import { healHp } from './damage-helpers.js';
import { setPendingCelebration, setPendingPartingShot, setPendingSelfDestruct, setPendingLastResort, setPendingExecutorInterrupt, setPendingExtraProtection, setPendingFinalStand, setPendingDyingLunge, setPendingMiracleWorker, setPendingPreservationProtocol } from './interrupts.js';
import { cardNameIncludes } from './card-names.js';
import { getCcHand } from './player-helpers.js';
import { isWithinN } from '../engine/utils.js';

// Wire dc-effects resolver into damage-pipeline so its
// isImmuneToDirectDefeat helper can read special-ability ids without
// taking a static circular import on data-loader.
_registerDcEffectsResolver(() => getDcEffects());

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

/**
 * Extra Protection (Onar Koma CC) — fires WHEN_DAMAGED per CRR + user
 * 2026-05-09 spec: when ANOTHER friendly figure within 2 spaces of Onar
 * suffers ≥3 damage, Onar's player may play Extra Protection from hand
 * to move up to 2 spaces and perform an attack. Triggers on lethal
 * damage too — does NOT gate on survival. Fires before BEFORE_DEFEATED
 * so the prompt resolves before Parting Shot's window in the 7-damage-
 * lethal-on-Greedo scenario.
 *
 * No "once per combat" flag (alexanbv 2026-05-09): EP is a single-use
 * Command Card. Once played, it moves hand → discard, so the hand-check
 * below naturally prevents a second fire. The only re-fire path is
 * Aphra excavating an opponent's discarded EP, which is rare and a
 * legal second use anyway. The probe gates on `pendingExtraProtection`
 * to avoid overlapping prompts when multiple damage events hit in
 * quick succession (e.g. Blast spreading damage to several friendlies).
 */
WHEN_DAMAGED_HOOKS.push({
  id: 'extra_protection_onar_koma',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    if ((opts.amount || 0) < 3) return false;
    // Don't open a second EP prompt while one is already pending.
    if (game.pendingExtraProtection) return false;
    const defPN = opts.controllerPlayerNum;
    const hand = getCcHand(game, defPN) || [];
    // Single-use card: once played the hand check fails naturally.
    if (hand.indexOf('Extra Protection') < 0) return false;
    if (!game.selectedMap?.id) return false;
    const targetPos = game.figurePositions?.[defPN]?.[opts.figureKey];
    if (!targetPos) return false;
    const friendly = game.figurePositions?.[defPN] || {};
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === opts.figureKey) continue; // "another" friendly figure
      const dcN = dcNameFromFigureKey(fk);
      if (dcN !== 'Onar Koma') continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      return true;
    }
    return false;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    const findDcMessageIdForFigure = ctx?.deps?.findDcMessageIdForFigure ?? ctx?.findDcMessageIdForFigure;
    const logGameAction = ctx?.deps?.logGameAction ?? ctx?.logGameAction;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder || !findDcMessageIdForFigure) return null;
    if (ctx?.client?._isFakeClient) return null;
    const defPN = opts.controllerPlayerNum;
    const targetPos = game.figurePositions?.[defPN]?.[opts.figureKey];
    if (!targetPos) return null;
    const friendly = game.figurePositions?.[defPN] || {};
    let onarFk = null;
    let onarPos = null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === opts.figureKey) continue;
      if (dcNameFromFigureKey(fk) !== 'Onar Koma') continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      onarFk = fk; onarPos = pos; break;
    }
    if (!onarFk) return null;
    const onarMsgId = findDcMessageIdForFigure(game.gameId, defPN, onarFk);
    if (!onarMsgId) return null;
    setPendingExtraProtection(game, {
      targetFigKey: opts.figureKey,
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
      damage: opts.amount,
      playerNum: defPN,
      onarFigKey: onarFk,
      onarMsgId,
      onarDcName: 'Onar Koma',
      // combat-flow re-entry params (read by handleExtraProtection):
      hit: opts.combat?._step7Hit ?? true,
      resultText: opts.combat?._step7ResultText || '',
      totalBlast: (opts.combat?.surgeBlast || 0) + (opts.combat?.bonusBlast || 0),
      defenderPlayerNum: defPN,
      attackerPlayerNum: opts.attackerPlayerNum,
      ownerId: opts.combat ? game[`player${opts.combat.attackerPlayerNum}Id`] : null,
      // Frame-correctness fix (alexanbv 2026-05-09, B-NA-EP-002 / -003):
      // capture the combat object reference at probe time so the click
      // handler doesn't depend on `game.pendingCombat` at click time —
      // which may have popped to an outer frame (Slow on the Draw,
      // Parting Shot) by the time the user clicks.
      combatRef: opts.combat || null,
    });
    const ownerId = game[`player${defPN}Id`];
    const damagedLabel = opts.combat?.target?.label || dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`extra_protection_play_${game.gameId}`).setLabel('Play Extra Protection (move 2 + attack)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`extra_protection_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    if (logGameAction) {
      await logGameAction(game, ctx?.client, `<@${ownerId}> **Extra Protection** — **${damagedLabel}** suffers ${opts.amount} Damage. **Onar Koma** is within 2 spaces and may play Extra Protection (move up to 2 spaces, then perform an attack).`, { components: [row], allowedMentions: { users: [ownerId] } });
    }
    return null;
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
 * Executor (Royal Guard Champion): "When a friendly figure within 3
 * spaces is defeated, you may interrupt to move up to 2 spaces and
 * perform an attack. Limit once per round."
 *
 * WHEN_DEFEATED timing per canonical wording "When a friendly figure
 * is defeated" — the trigger fires AFTER the friendly's defeat is
 * confirmed. The "interrupt to move + attack" is RGC's reaction to
 * the defeat; it does not prevent or pause the defeat itself.
 *
 * Trigger side: the side OWNING the dying friendly figure (which is
 * the same as opts.controllerPlayerNum). RGC must be on that same
 * side, alive, within 3 of the dying figure (snapshot via
 * defeatedPos), and not yet used Executor this round
 * (`game.roundFigureAbilityUsed[`${rgcFigKey}_executor`]`). The
 * friendly is removed from the board by processFigureDefeat AFTER
 * this hook fires; RGC's button click is independent.
 *
 * Sets pendingExecutorInterrupt + posts the Use/Skip prompt. The
 * handler (handleExecutor in interrupts.js) grants RGC 2 MP and a
 * free attack flag.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'executor_rgc',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.executorTriggered?.[opts.msgId]) return false;
    const defeatedPos = opts.defeatedPos
      ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    if (!defeatedPos) return false;
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('executor')) continue;
      if (countGameSpaces(game, defeatedPos, pos) > 3) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_executor`]) continue;
      return true;
    }
    return false;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    const findDcMessageIdForFigure = ctx?.deps?.findDcMessageIdForFigure ?? ctx?.findDcMessageIdForFigure;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder || !findDcMessageIdForFigure) return null;
    if (ctx?.client?._isFakeClient) return null;
    const defeatedPos = opts.defeatedPos
      ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    let rgcFigKey = null;
    let rgcDcName = null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('executor')) continue;
      if (countGameSpaces(game, defeatedPos, pos) > 3) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_executor`]) continue;
      rgcFigKey = fk;
      rgcDcName = dcN;
      break;
    }
    if (!rgcFigKey) return null;
    const rgcMsgId = findDcMessageIdForFigure(game.gameId, opts.controllerPlayerNum, rgcFigKey);
    if (!rgcMsgId) return null;
    game.executorTriggered = game.executorTriggered || {};
    game.executorTriggered[opts.msgId] = true;
    setPendingExecutorInterrupt(game, {
      gameId: game.gameId,
      rgcFigKey,
      rgcMsgId,
      rgcPlayerNum: opts.controllerPlayerNum,
      rgcDcName,
      defeatedLabel: dcNameFromFigureKey(opts.figureKey),
      figureKey: opts.figureKey,
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
      defenderPlayerNum: opts.controllerPlayerNum,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
    });
    const ownerId = game[`player${opts.controllerPlayerNum}Id`];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`executor_use_${game.gameId}_${rgcMsgId}`).setLabel('Use Executor').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`executor_skip_${game.gameId}_${rgcMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    const defeatedLabel = dcNameFromFigureKey(opts.figureKey);
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> **Executor** — **${rgcDcName}** may interrupt (friendly **${defeatedLabel}** defeated within 3 spaces). Move up to 2 spaces, then perform an attack.`
        : `**Executor** — **${rgcDcName}** may interrupt (friendly **${defeatedLabel}** defeated within 3 spaces).`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

/**
 * Self-Destruct Protocol (IG-11): "When this figure is about to be
 * defeated, you may move up to 3 spaces, then roll 1 red die — each
 * figure adjacent suffers Damage equal to the Hits. Then this figure
 * is defeated."
 *
 * Detection: specialAbilityIds includes 'self_destruct_protocol'.
 * Once-per-figure flag `game.selfDestructProtocolTriggered[msgId]`.
 *
 * Returns preventDefeat=true; sets pendingSelfDestruct. Handler in
 * interrupts.js (handleSelfDestructProtocol → handleSelfDestructMovePick)
 * does the move + splash + completeDeferredDefeat.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'self_destruct_protocol',
  // Canonical trigger: "When you have suffered Damage equal to your
  // Health, before you are defeated …" — does NOT fire on direct
  // defeat (figure didn't suffer damage to reach 0 HP).
  requiresDamage: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.selfDestructProtocolTriggered?.[opts.msgId]) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.specialAbilityIds || []).includes('self_destruct_protocol');
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return null;
    if (ctx?.client?._isFakeClient) return null;
    game.selfDestructProtocolTriggered = game.selfDestructProtocolTriggered || {};
    game.selfDestructProtocolTriggered[opts.msgId] = true;
    setPendingSelfDestruct(game, {
      gameId: game.gameId,
      figureKey: opts.figureKey,
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
      defenderPlayerNum: opts.controllerPlayerNum,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
    });
    const ownerId = game[`player${opts.controllerPlayerNum}Id`];
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`self_destruct_protocol_use_${game.gameId}_${opts.msgId}`).setLabel('Use Self-Destruct').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`self_destruct_protocol_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> **Self-Destruct Protocol** — **${dcName}** is about to be defeated! Roll 1 red die, apply Hits to adjacent figures, then the figure is defeated.`
        : `**Self-Destruct Protocol** — **${dcName}** is about to be defeated!`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
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
  // Canonical trigger: "Deplete this card when a figure in this group
  // has suffered Damage equal to its Health" — damage-required.
  // Does NOT fire on direct defeat.
  requiresDamage: true,
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
  // Canonical trigger: "When you have suffered Damage equal to your
  // Health, before you are defeated …" — damage-required. Does NOT
  // fire on direct defeat.
  requiresDamage: true,
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

/**
 * Final Stand (Baze Malbus CC) — alexanbv 2026-05-10:
 *
 * Card text: "Use when a friendly figure within 3 spaces has suffered
 * damage equal to its Health, before it is defeated. Move up to 2 spaces,
 * gain 1 Power Token, and then perform an attack. Then, that friendly
 * figure is defeated."
 *
 * Migrated from `duringActivation`-only timing (cc-timing.js) to a real
 * BEFORE_DEFEATED hook so the prompt fires when ANY friendly figure
 * suffers damage = Health, regardless of whose activation is in
 * progress (including the opponent's attack on the friendly).
 *
 * Mara Jade Fast Learner integration is INTENTIONALLY DEFERRED — for
 * now Baze is the only eligible playing figure. Mara picker comes in a
 * follow-up.
 *
 * Once-per-defeat guard: `finalStandTriggered[msgId]` prevents repeat
 * prompts when a Blast splash applies multiple damage events to the same
 * figure in the same frame.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'final_stand',
  requiresDamage: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.finalStandTriggered?.[opts.msgId]) return false;
    if (!game.selectedMap?.id) return false;
    const ownerPN = opts.controllerPlayerNum;
    const hand = getCcHand(game, ownerPN) || [];
    if (hand.indexOf('Final Stand') < 0) return false;
    // Baze must be alive AND within 3 spaces of the would-be-defeated figure.
    const targetPos = game.figurePositions?.[ownerPN]?.[opts.figureKey];
    if (!targetPos) return false;
    const friendlyFigs = game.figurePositions?.[ownerPN] || {};
    for (const [fk, pos] of Object.entries(friendlyFigs)) {
      if (fk === opts.figureKey) continue; // Final Stand triggers on a DIFFERENT friendly within 3
      if (dcNameFromFigureKey(fk) !== 'Baze Malbus') continue;
      if (!pos) continue;
      if (isWithinN(pos, targetPos, 3, game.selectedMap.id)) return true;
    }
    return false;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    const findDcMessageIdForFigure = ctx?.deps?.findDcMessageIdForFigure ?? ctx?.findDcMessageIdForFigure;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder || !findDcMessageIdForFigure) return null;
    if (ctx?.client?._isFakeClient) return null;
    const ownerPN = opts.controllerPlayerNum;
    const targetPos = game.figurePositions?.[ownerPN]?.[opts.figureKey];
    if (!targetPos) return null;
    let bazeFigKey = null;
    let bazePos = null;
    for (const [fk, pos] of Object.entries(game.figurePositions?.[ownerPN] || {})) {
      if (fk === opts.figureKey) continue;
      if (dcNameFromFigureKey(fk) !== 'Baze Malbus') continue;
      if (!pos) continue;
      if (!isWithinN(pos, targetPos, 3, game.selectedMap.id)) continue;
      bazeFigKey = fk; bazePos = pos; break;
    }
    if (!bazeFigKey) return null;
    const bazeMsgId = findDcMessageIdForFigure(game.gameId, ownerPN, bazeFigKey);
    if (!bazeMsgId) return null;
    game.finalStandTriggered = game.finalStandTriggered || {};
    game.finalStandTriggered[opts.msgId] = true;
    setPendingFinalStand(game, {
      gameId: game.gameId,
      // The would-be-defeated figure that triggered the play:
      targetFigureKey: opts.figureKey,
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
      controllerPlayerNum: ownerPN,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
      // The figure that performs the Move + free attack:
      playingFigureKey: bazeFigKey,
      playingMsgId: bazeMsgId,
      playingDcName: 'Baze Malbus',
      active: false,
    });
    const ownerId = game[`player${ownerPN}Id`];
    const targetDcName = dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`final_stand_play_${game.gameId}_${opts.msgId}`).setLabel('Play Final Stand (Baze)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`final_stand_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> ⚔️ **Final Stand** — **${targetDcName}** is about to be defeated. Play to have **Baze Malbus** move up to 2, gain 1 Power Token, and perform a free attack? **${targetDcName}** is defeated after Baze's attack.`
        : `⚔️ **Final Stand** — **${targetDcName}** is about to be defeated. Play to have **Baze Malbus** intervene?`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

/**
 * Dying Lunge (CC, playableBy: Any Figure) — alexanbv 2026-05-10:
 *
 * Card text: "Use when you have suffered Damage equal to your Health,
 * before you are defeated. Move up to 2 spaces, then perform a Melee
 * attack. Then, you are defeated."
 *
 * Same shape as Parting Shot but as a CC played by the dying figure's
 * controller. The dying figure performs the Move + free attack itself,
 * then is defeated. Once-per-defeat dedup via dyingLungeTriggered[msgId].
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'dying_lunge',
  requiresDamage: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.dyingLungeTriggered?.[opts.msgId]) return false;
    const ownerPN = opts.controllerPlayerNum;
    const hand = getCcHand(game, ownerPN) || [];
    if (hand.indexOf('Dying Lunge') < 0) return false;
    return true;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return null;
    if (ctx?.client?._isFakeClient) return null;
    game.dyingLungeTriggered = game.dyingLungeTriggered || {};
    game.dyingLungeTriggered[opts.msgId] = true;
    setPendingDyingLunge(game, {
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
      new ButtonBuilder().setCustomId(`dying_lunge_play_${game.gameId}_${opts.msgId}`).setLabel('Play Dying Lunge').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`dying_lunge_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> ⚔️ **Dying Lunge** — **${dcName}** is about to be defeated. Play to move up to 2 and perform a free Melee attack first?`
        : `⚔️ **Dying Lunge** — **${dcName}** is about to be defeated. Play?`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

/**
 * Miracle Worker (CC, playableBy: MHD-19) — alexanbv 2026-05-10:
 *
 * Card text: "Use when a friendly figure within 3 spaces of you has
 * suffered damage equal to its Health. Instead of being defeated, it
 * recovers 3 damage."
 *
 * Prevents-defeat shape. MHD-19 (the playing figure) heals a different
 * friendly within 3 spaces by 3 damage, taking it back above 0 HP so
 * completeDeferredDefeat sees curHp > 0 and exits with no defeat.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'miracle_worker',
  requiresDamage: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.miracleWorkerTriggered?.[opts.msgId]) return false;
    if (!game.selectedMap?.id) return false;
    const ownerPN = opts.controllerPlayerNum;
    const hand = getCcHand(game, ownerPN) || [];
    if (hand.indexOf('Miracle Worker') < 0) return false;
    const targetPos = game.figurePositions?.[ownerPN]?.[opts.figureKey];
    if (!targetPos) return false;
    const friendlyFigs = game.figurePositions?.[ownerPN] || {};
    for (const [fk, pos] of Object.entries(friendlyFigs)) {
      if (fk === opts.figureKey) continue;
      if (dcNameFromFigureKey(fk) !== 'MHD-19') continue;
      if (!pos) continue;
      if (isWithinN(pos, targetPos, 3, game.selectedMap.id)) return true;
    }
    return false;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    const findDcMessageIdForFigure = ctx?.deps?.findDcMessageIdForFigure ?? ctx?.findDcMessageIdForFigure;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder || !findDcMessageIdForFigure) return null;
    if (ctx?.client?._isFakeClient) return null;
    const ownerPN = opts.controllerPlayerNum;
    const targetPos = game.figurePositions?.[ownerPN]?.[opts.figureKey];
    if (!targetPos) return null;
    let mhdFigKey = null;
    for (const [fk, pos] of Object.entries(game.figurePositions?.[ownerPN] || {})) {
      if (fk === opts.figureKey) continue;
      if (dcNameFromFigureKey(fk) !== 'MHD-19') continue;
      if (!pos) continue;
      if (!isWithinN(pos, targetPos, 3, game.selectedMap.id)) continue;
      mhdFigKey = fk; break;
    }
    if (!mhdFigKey) return null;
    const mhdMsgId = findDcMessageIdForFigure(game.gameId, ownerPN, mhdFigKey);
    if (!mhdMsgId) return null;
    game.miracleWorkerTriggered = game.miracleWorkerTriggered || {};
    game.miracleWorkerTriggered[opts.msgId] = true;
    setPendingMiracleWorker(game, {
      gameId: game.gameId,
      targetFigureKey: opts.figureKey,
      targetMsgId: opts.msgId,
      targetFigIndex: opts.figIndex,
      controllerPlayerNum: ownerPN,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
      mhdFigureKey: mhdFigKey,
      mhdMsgId,
      healAmount: 3,
    });
    const ownerId = game[`player${ownerPN}Id`];
    const targetDcName = dcNameFromFigureKey(opts.figureKey);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`miracle_worker_play_${game.gameId}_${opts.msgId}`).setLabel('Play Miracle Worker (heal 3)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`miracle_worker_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> ✨ **Miracle Worker** — **${targetDcName}** is about to be defeated. **MHD-19** within 3 spaces — play to recover 3 Damage instead?`
        : `✨ **Miracle Worker** — **${targetDcName}** is about to be defeated. Play?`,
      components: [row],
      allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
    }).catch(() => {});
    return { preventDefeat: true };
  },
});

/**
 * Preservation Protocol (CC, playableBy: 4-LOM) — alexanbv 2026-05-10:
 *
 * Card text: "Use when you have suffered Damage equal to your Health.
 * Instead of being defeated, recover 1 Damage. Until the end of the
 * game, you lose 'Programming Override' and 'Shared Intuition'."
 *
 * Self-targeting prevents-defeat. The dying figure must be 4-LOM. Heals
 * 1 Damage and stamps a permanent flag
 * (game.preservationProtocolUsed[playerNum][figKey] = true) that the
 * Programming Override + Shared Intuition resolvers can consult to
 * suppress those abilities.
 */
BEFORE_DEFEATED_HOOKS.push({
  id: 'preservation_protocol',
  requiresDamage: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.msgId || !opts.controllerPlayerNum) return false;
    if (game.preservationProtocolTriggered?.[opts.msgId]) return false;
    if (dcNameFromFigureKey(opts.figureKey) !== '4-LOM') return false;
    const ownerPN = opts.controllerPlayerNum;
    const hand = getCcHand(game, ownerPN) || [];
    if (hand.indexOf('Preservation Protocol') < 0) return false;
    return true;
  },
  apply: async (game, opts, ctx) => {
    const thread = ctx?.thread;
    const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
    const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
    const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
    if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return null;
    if (ctx?.client?._isFakeClient) return null;
    game.preservationProtocolTriggered = game.preservationProtocolTriggered || {};
    game.preservationProtocolTriggered[opts.msgId] = true;
    setPendingPreservationProtocol(game, {
      gameId: game.gameId,
      figureKey: opts.figureKey,
      msgId: opts.msgId,
      figIndex: opts.figIndex,
      controllerPlayerNum: opts.controllerPlayerNum,
      attackerPlayerNum: opts.attackerPlayerNum,
      source: opts.source || 'Damage',
      healAmount: 1,
    });
    const ownerId = game[`player${opts.controllerPlayerNum}Id`];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`preservation_protocol_play_${game.gameId}_${opts.msgId}`).setLabel('Play Preservation Protocol').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`preservation_protocol_skip_${game.gameId}_${opts.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: ownerId
        ? `<@${ownerId}> 🛡️ **Preservation Protocol** — **4-LOM** is about to be defeated. Play to recover 1 Damage instead? (Loses **Programming Override** and **Shared Intuition** for the rest of the game.)`
        : `🛡️ **Preservation Protocol** — **4-LOM** is about to be defeated. Play?`,
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
 * Nefarious Gains (Jabba the Hutt passive) — alexanbv 2026-05-10:
 *
 * Card text: "When a hostile figure is defeated, gain 1 VP."
 *
 * Migrated from inline call in defeat-handler.js to a proper
 * WHEN_DEFEATED hook for architectural parity with Bounty / Last
 * Stand / etc. The pure helper `checkNefariousGains` in vp-helpers.js
 * is the canonical mutator — kept and called from this hook (and
 * still available for the legacy inline wrapper in
 * engine/win-conditions.js, which is no longer invoked from the
 * defeat path).
 *
 * Probe: an opposing-team Jabba is alive (any figure key starting
 * with "Jabba the Hutt-" on the player NOT owning the defeated
 * figure). controllerPlayerNum is the defeated figure's owner; Jabba
 * lives on the OPPOSITE side.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'nefarious_gains_jabba',
  sync: true,
  probe: (game, opts) => {
    if (!opts.controllerPlayerNum) return false;
    const jabbaOwnerPN = opts.controllerPlayerNum === 1 ? 2 : 1;
    const figs = game.figurePositions?.[jabbaOwnerPN] || {};
    return Object.keys(figs).some(fk => fk.startsWith('Jabba the Hutt-'));
  },
  apply: (game, opts, ctx) => {
    const jabbaOwnerPN = opts.controllerPlayerNum === 1 ? 2 : 1;
    awardObjectiveVp(game, jabbaOwnerPN, 1);
    const total = game[vpKey(jabbaOwnerPN)]?.total ?? '?';
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `\u{1F4B0} **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${jabbaOwnerPN} VP: ${total}`,
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
/**
 * Last Stand (passive): when this figure is defeated, choose another
 * figure in your group to become Focused. Fires in WHEN_DEFEATED —
 * the canonical wording "When you are defeated" places the trigger
 * after defeat finalization.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'last_stand',
  probe: (game, opts) => {
    if (!opts.figureKey) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    return (eff?.passives || []).includes('Last Stand');
  },
  apply: async (game, opts, ctx) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const dgMatch = (opts.figureKey || '').match(/-(\d+)-\d+$/);
    const dgIdx = dgMatch ? dgMatch[1] : '1';
    const prefix = `${dcName}-${dgIdx}-`;
    const alive = Object.keys(game.figurePositions?.[opts.controllerPlayerNum] || {})
      .filter(k => k.startsWith(prefix) && k !== opts.figureKey);
    if (alive.length === 0) return;
    // Auto-pick when only one candidate (no choice to make).
    if (alive.length === 1) {
      const target = alive[0];
      if (applyCondition(game, target, 'Focus')) {
        const targetName = dcNameFromFigureKey(target);
        if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
          await ctx.logGameAction(
            game,
            ctx.client,
            `⚡ **Last Stand** — **${targetName}** becomes **Focused** (another figure in the group was defeated).`,
            { phase: 'ROUND', icon: 'card' },
          ).catch(() => {});
        }
      }
      return;
    }
    // Multiple candidates: post a player picker. Per alexanbv 2026-05-11
    // "fix last stand to prompt which groupmate to focus."
    game.pendingLastStand = {
      gameId: game.gameId,
      controllerPlayerNum: opts.controllerPlayerNum,
      eligibleFigureKeys: alive,
      defeatedFigureKey: opts.figureKey,
      defeatedDcName: dcName,
    };
    if (typeof ctx?.client !== 'undefined' && typeof ctx?.logGameAction === 'function') {
      try {
        const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import('discord.js');
        const ownerId = game[`player${opts.controllerPlayerNum}Id`];
        const btns = alive.slice(0, 4).map((fk) =>
          new ButtonBuilder()
            .setCustomId(`last_stand_pick_${game.gameId}_${fk}`)
            .setLabel(dcNameFromFigureKey(fk).slice(0, 80))
            .setStyle(ButtonStyle.Primary),
        );
        btns.push(new ButtonBuilder().setCustomId(`last_stand_pick_${game.gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const row = new ActionRowBuilder().addComponents(btns);
        // Post to general channel — defeat-handler doesn't have a thread context.
        const channelId = game.generalId;
        const channel = channelId ? await ctx.client.channels.fetch(channelId).catch(() => null) : null;
        if (channel) {
          await channel.send({
            content: `⚡ **Last Stand** — <@${ownerId}> Pick another figure in **${dcName}**'s group to become Focused:`,
            allowedMentions: { users: ownerId ? [ownerId] : [] },
            components: [row],
          }).catch(() => {});
        }
      } catch (err) {
        // Picker post failed — fall back to auto-pick first.
        const target = alive[0];
        if (applyCondition(game, target, 'Focus')) {
          await ctx.logGameAction?.(game, ctx.client,
            `⚡ **Last Stand** — picker failed; auto-Focused **${dcNameFromFigureKey(target)}**.`,
            { phase: 'ROUND', icon: 'card' }).catch(() => {});
        }
        delete game.pendingLastStand;
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
 * Imperial Citadel (skirmish upgrade): when a friendly Imperial figure
 * is defeated, transfer its Power Tokens to the Citadel card. Auto-
 * applied. Source-agnostic.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'imperial_citadel',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    const dcName = dcNameFromFigureKey(opts.figureKey);
    const eff = getDcEffects()?.[dcName];
    if (eff?.affiliation !== 'Imperial') return false;
    const dcList = getDcList(game, opts.controllerPlayerNum) || [];
    return dcList.some(dc => dc.dcName === '[Imperial Citadel]');
  },
  apply: (game, opts, ctx) => {
    const tokens = game.figurePowerTokens?.[opts.figureKey] || [];
    if (tokens.length === 0) return;
    game.imperialCitadelTokens = game.imperialCitadelTokens || { damage: 0, block: 0, hit: 0, surge: 0, evade: 0 };
    for (const t of tokens) {
      const tLower = String(t).toLowerCase();
      game.imperialCitadelTokens[tLower] = (game.imperialCitadelTokens[tLower] || 0) + 1;
    }
    const count = tokens.length;
    delete game.figurePowerTokens[opts.figureKey];
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      const dcName = dcNameFromFigureKey(opts.figureKey);
      ctx.logGameAction(
        game,
        ctx.client,
        `**Imperial Citadel** — ${count} Power Token${count !== 1 ? 's' : ''} transferred from defeated **${dcName}** to the Citadel.`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
  },
});

/**
 * This is the Way (The Armorer): when attacker defeats a hostile,
 * attacker gains 1 Block Token. Auto-applied; needs an Armorer on
 * the attacker's board. Skipped when noFriendliesActive (Lure /
 * False Orders) per destruct 2026-05-07. Source-agnostic in theory
 * but `combat.attackerFigureKey` is required to grant the token —
 * non-combat defeats with no specific attacker figure (Bleed) won't
 * trigger.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'this_is_the_way_armorer',
  sync: true,
  probe: (game, opts) => {
    if (!opts.attackerPlayerNum) return false;
    if (!opts.combat?.attackerFigureKey) return false;
    if (opts.combat?.noFriendliesActive) return false;
    return Object.keys(game.figurePositions?.[opts.attackerPlayerNum] || {})
      .some(fk => fk.startsWith('The Armorer-'));
  },
  apply: (game, opts, ctx) => {
    const granted = grantPowerTokens(game, opts.combat.attackerFigureKey, 'Block', 1, 2);
    if (granted > 0 && typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `🛡️ **This is the Way** — **${opts.combat.attackerDcName}** gains 1 **Block Token** (defeated hostile).`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
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

// ── Player-choice WHEN_DEFEATED CC auto-prompts (alexanbv 2026-05-10) ────────
//
// These four CCs trigger on figure defeat and currently rely on the
// `_notifyCcPlayWindow` ping to the controller's hand channel. The
// hook below posts an explicit Play/Skip prompt in the combat thread,
// elevating the UX to match Final Stand / Parting Shot patterns. On
// Play, the existing resolveAbility path runs the effect.
//
// - Debts Repaid (Chewbacca): friendly defeated → become Focused +
//   ready a DC.
// - Lord of the Sith (Darth Vader): hostile defeated NOT in your
//   activation → move 2 + Force Choke or free Melee attack.
// - Paid in Beskar (HUNTER): hostile defeated within 3 spaces → set
//   the "next defeat within 3 grants 2 Block Tokens" flag.
// - Retaliation (GUARDIAN): friendly defeated → chooseOne (Focused /
//   2 Power Tokens / Move 2).

import { setPendingDefeatCcPrompt, clearPendingDefeatCcPrompt } from './interrupts.js';

function _makeDefeatCcHook({ id, cardName, scope, label, requireProximity = 0, requireOpponent = false }) {
  return {
    id,
    requiresDamage: false,
    probe: (game, opts) => {
      if (!opts.figureKey || !opts.controllerPlayerNum) return false;
      if (!opts.defeatedPos && requireProximity > 0) return false;
      // Determine which player would PLAY the card.
      // - scope='friendly' (Debts Repaid, Retaliation): controlling
      //   player of the dying figure
      // - scope='hostile' (Lord of the Sith, Paid in Beskar):
      //   opponent of the dying figure's owner
      const playerPN = scope === 'friendly'
        ? opts.controllerPlayerNum
        : (opts.controllerPlayerNum === 1 ? 2 : 1);
      const hand = getCcHand(game, playerPN) || [];
      if (hand.indexOf(cardName) < 0) return false;
      // Once-per-defeat dedup
      const dedupKey = `${id}_${opts.msgId}_${opts.figIndex}`;
      if (game.defeatCcPromptTriggered?.[dedupKey]) return false;
      // Proximity check (Paid in Beskar within 3 of defeated figure)
      if (requireProximity > 0 && opts.defeatedPos && game.selectedMap?.id) {
        const friendly = game.figurePositions?.[playerPN] || {};
        const anyWithin = Object.values(friendly).some(pos =>
          pos && isWithinN(pos, opts.defeatedPos, requireProximity, game.selectedMap.id));
        if (!anyWithin) return false;
      }
      // Lord of the Sith: "NOT your activation" — the card player
      // must NOT be currently activating. Approximate: the defeating
      // attacker's player is the card player (since hostile defeated
      // by them). Skip if defeated-by-card-player's-own-activation.
      // The user can still play during their OWN turn if they really
      // want by manual hand-play — this gate is for the auto-prompt
      // specifically.
      if (requireOpponent && opts.attackerPlayerNum && opts.attackerPlayerNum === playerPN) {
        // Hostile was defeated by the card player's attack — gate via
        // card text. Allow for now (player will see the prompt; if
        // they shouldn't play during their own activation per CRR
        // they can skip).
      }
      return true;
    },
    apply: async (game, opts, ctx) => {
      const thread = ctx?.thread;
      const ButtonBuilder = ctx?.deps?.ButtonBuilder ?? ctx?.ButtonBuilder;
      const ButtonStyle = ctx?.deps?.ButtonStyle ?? ctx?.ButtonStyle;
      const ActionRowBuilder = ctx?.deps?.ActionRowBuilder ?? ctx?.ActionRowBuilder;
      if (!thread?.send || !ButtonBuilder || !ButtonStyle || !ActionRowBuilder) return null;
      if (ctx?.client?._isFakeClient) return null;
      const playerPN = scope === 'friendly'
        ? opts.controllerPlayerNum
        : (opts.controllerPlayerNum === 1 ? 2 : 1);
      const dedupKey = `${id}_${opts.msgId}_${opts.figIndex}`;
      game.defeatCcPromptTriggered = game.defeatCcPromptTriggered || {};
      game.defeatCcPromptTriggered[dedupKey] = true;
      setPendingDefeatCcPrompt(game, {
        gameId: game.gameId,
        id,
        cardName,
        playerPN,
        defeatedFigureKey: opts.figureKey,
        defeatedPos: opts.defeatedPos ?? null,
        attackerFigureKey: opts.attackerFigureKey ?? null,
      });
      const ownerId = game[`player${playerPN}Id`];
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`defeat_cc_play_${game.gameId}_${id}`).setLabel(`Play ${cardName}`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`defeat_cc_skip_${game.gameId}_${id}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      const dcName = dcNameFromFigureKey(opts.figureKey);
      await thread.send({
        content: ownerId
          ? `<@${ownerId}> 📜 **${cardName}** — ${label}. **${dcName}** was defeated. Play?`
          : `📜 **${cardName}** — ${label}. **${dcName}** was defeated. Play?`,
        components: [row],
        allowedMentions: ownerId ? { users: [ownerId] } : { parse: [] },
      }).catch(() => {});
    },
  };
}

WHEN_DEFEATED_HOOKS.push(_makeDefeatCcHook({
  id: 'debts_repaid_prompt',
  cardName: 'Debts Repaid',
  scope: 'friendly',
  label: 'Become Focused and ready a Deployment card',
}));

WHEN_DEFEATED_HOOKS.push(_makeDefeatCcHook({
  id: 'lord_of_the_sith_prompt',
  cardName: 'Lord of the Sith',
  scope: 'hostile',
  label: 'Move up to 2, then Force Choke or free Melee attack',
  requireOpponent: true,
}));

WHEN_DEFEATED_HOOKS.push(_makeDefeatCcHook({
  id: 'paid_in_beskar_prompt',
  cardName: 'Paid in Beskar',
  scope: 'hostile',
  label: 'Gain 2 Block Tokens',
  requireProximity: 3,
}));

WHEN_DEFEATED_HOOKS.push(_makeDefeatCcHook({
  id: 'retaliation_prompt',
  cardName: 'Retaliation',
  scope: 'friendly',
  label: 'Choose one: Focused / 2 Power Tokens / Move up to 2',
}));

/**
 * Vengeance (Royal Guard Regular): when an adjacent, friendly,
 * non-GUARDIAN figure is defeated, each adjacent Royal Guard (Regular)
 * becomes Focused. Per alexanbv 2026-05-10.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'vengeance_royal_guard',
  sync: true,
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    const defeatedDc = dcNameFromFigureKey(opts.figureKey);
    const defeatedEff = getDcEffects()?.[defeatedDc] || getDcEffects()?.[(defeatedDc || '').replace(/\s*\[.*\]\s*$/, '')];
    const defeatedKws = (defeatedEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (defeatedKws.includes('GUARDIAN')) return false;
    const defeatedPos = opts.defeatedPos ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    if (!defeatedPos) return false;
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('vengeance_royal_guard')) continue;
      if (countGameSpaces(game, defeatedPos, pos) === 1) return true;
    }
    return false;
  },
  apply: (game, opts, ctx) => {
    const defeatedPos = opts.defeatedPos ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    if (!defeatedPos) return;
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    const focused = [];
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('vengeance_royal_guard')) continue;
      if (countGameSpaces(game, defeatedPos, pos) !== 1) continue;
      if (isConditionImmune(game, fk)) continue;
      if (applyCondition(game, fk, 'Focus')) focused.push(dcN);
    }
    if (focused.length > 0 && typeof ctx?.logGameAction === 'function' && ctx?.client) {
      ctx.logGameAction(
        game,
        ctx.client,
        `🛡️ **Vengeance** — adjacent **${focused.join(', ')}** became Focused (friendly non-GUARDIAN defeated).`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
  },
});

/**
 * Forward Vengeance (Royal Guard Elite): when an adjacent, friendly,
 * non-GUARDIAN, non-companion figure is defeated, each adjacent Royal
 * Guard (Elite) becomes Focused AND may move 1 space (MOVE-X picker).
 * Per alexanbv 2026-05-10.
 */
WHEN_DEFEATED_HOOKS.push({
  id: 'forward_vengeance_royal_guard_elite',
  probe: (game, opts) => {
    if (!opts.figureKey || !opts.controllerPlayerNum) return false;
    const defeatedDc = dcNameFromFigureKey(opts.figureKey);
    const defeatedEff = getDcEffects()?.[defeatedDc] || getDcEffects()?.[(defeatedDc || '').replace(/\s*\[.*\]\s*$/, '')];
    const defeatedKws = (defeatedEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (defeatedKws.includes('GUARDIAN')) return false;
    if (defeatedEff?.companion) return false;
    const defeatedPos = opts.defeatedPos ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    if (!defeatedPos) return false;
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('forward_vengeance_royal_guard_elite')) continue;
      if (countGameSpaces(game, defeatedPos, pos) === 1) return true;
    }
    return false;
  },
  apply: async (game, opts, ctx) => {
    const defeatedPos = opts.defeatedPos ?? game.figurePositions?.[opts.controllerPlayerNum]?.[opts.figureKey];
    if (!defeatedPos) return;
    const friendly = game.figurePositions?.[opts.controllerPlayerNum] || {};
    const findMsgId = ctx?.deps?.findDcMessageIdForFigure ?? ctx?.findDcMessageIdForFigure;
    const triggered = [];
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!pos || fk === opts.figureKey) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = getDcEffects()?.[dcN];
      if (!(eff?.specialAbilityIds || []).includes('forward_vengeance_royal_guard_elite')) continue;
      if (countGameSpaces(game, defeatedPos, pos) !== 1) continue;
      if (!isConditionImmune(game, fk)) applyCondition(game, fk, 'Focus');
      triggered.push({ fk, dcName: dcN });
    }
    if (triggered.length === 0) return;
    if (typeof ctx?.logGameAction === 'function' && ctx?.client) {
      await ctx.logGameAction(
        game,
        ctx.client,
        `🛡️ **Forward Vengeance** — adjacent **${triggered.map((t) => t.dcName).join(', ')}** became Focused (friendly non-GUARDIAN non-companion defeated). Each may move 1 space.`,
        { phase: 'ROUND', icon: 'card' },
      ).catch(() => {});
    }
    // Set up a pendingMoveX (1 space) for each triggered Royal Guard and
    // post the Move-X picker. Player resolves each independently (or
    // declines via the End Movement button — MP stays in their bank).
    if (!findMsgId || ctx?.client?._isFakeClient) return;
    try {
      const { postMoveXPicker } = await import('../handlers/move-x-handler.js');
      for (const { fk, dcName: dcN } of triggered) {
        const rgMsgId = findMsgId(game.gameId, opts.controllerPlayerNum, fk);
        if (!rgMsgId) continue;
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[rgMsgId] = {
          remaining: 1,
          source: 'Forward Vengeance',
          playerNum: opts.controllerPlayerNum,
          figureKey: fk,
          dcName: dcN,
          threadId: null,
          msgId: rgMsgId,
          bypassCosts: true, // "Move 1 space" → bypassCosts per CRR MOVE-017.
          nextAction: null,
        };
        await postMoveXPicker(game, ctx, rgMsgId).catch((err) =>
          console.error('Forward Vengeance MOVE-X picker failed:', err?.message ?? err),
        );
      }
    } catch (err) {
      console.error('Forward Vengeance MOVE-X integration failed:', err?.message ?? err);
    }
  },
});
