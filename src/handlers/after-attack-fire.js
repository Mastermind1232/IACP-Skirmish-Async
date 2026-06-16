/**
 * Fire handlers for step-8 / after-attack-resolves effects.
 *
 * Each handler implements the actual application logic for one effect
 * type. Called from after-attack-resolve.js when the attacker (or
 * defender) clicks an effect's button in the post-resolve window.
 *
 * Effect types map to handlers via the `fireEffect` dispatcher:
 *   - 'recover'    → fireRecover    (heal attacker by N)
 *   - 'blast'      → fireBlast      (CRR step 8 splash; TODO follow-up)
 *   - 'cleave'     → fireCleave     (target picker; TODO follow-up)
 *   - 'condition'  → fireCondition  (apply 1 condition; TODO follow-up)
 *   - per-DC      → followup commits per ability
 *
 * Slice 2b first cut (this commit): only `recover` is wired live.
 * Other types throw a not-yet-wired error — they continue to fire via
 * the legacy inline-apply path inside applyDamageAndFinishCombat until
 * their follow-up commit migrates them.
 */
import { discordCatch } from '../error-handling.js';
import { healHp } from '../game/damage-helpers.js';
import {
  grantMovementBank, grantPowerTokens, opponentPlayerNum,
  parseFigureKey, dcNameFromFigureKey, getDcEffect,
  applyCondition, isConditionImmune, HARMFUL_CONDITIONS,
} from '../game/index.js';
import { isWithinN } from '../engine/utils.js';
import { getFigureLabel } from '../engine/game-readers.js';
import { getFigureFootprint, getAllFigureFootprints, hasFigureLineOfSight } from '../game/spatial.js';
import { sanitizeMentions } from '../discord/channel-helpers.js';
import { getCombatAbility } from '../engine/combat-timing-registry.js';
import { playCC } from '../game/cc-timing.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import {
  setPendingBoltslinger, setPendingHeavyFire, setPendingHavocShot,
  setPendingIndiscriminateFire, setPendingConcussiveBolt,
  setPendingFightingKnife, setPendingSpreadThePain,
  setPendingWantonDestruction, setPendingDeflect,
} from '../game/interrupts.js';
import { getCcHand } from '../game/player-helpers.js';
import { getDcList, getPlayerId, getDcMessageIds } from '../game/player-helpers.js';
import { applyDamage } from '../game/damage-pipeline.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import { lookupFigureDcIndex } from '../engine/game-readers.js';
import { applyNpcDamageToFigure } from '../engine/combat-bridge.js';
import { getFiguresAdjacentToCoord } from '../game/movement.js';
import { getFiguresOnOrAdjacentToSpace } from '../game/board-helpers.js';
import { getDcKeywords, getDcEffects, getFigureSize } from '../data-loader.js';
import { getFootprintCells } from '../game/coords.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { applyStrain } from './strain-handler.js';
import { setupPendingMoveX } from './move-x-handler.js';

/**
 * Recover N — heals the attacker by N HP. Applies even on a miss
 * (CRR Recover keyword). Sustained by Rage blocks own Recover; that
 * gate is enforced upstream when the entry is enqueued.
 */
async function fireRecover(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client } = ctx;
  if (!dcHealthState || combat.attackerMsgId == null) return;
  const amount = Number(effect.payload?.amount ?? combat.surgeRecover ?? 0);
  if (amount <= 0) return;
  healHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, amount, combat.attackerPlayerNum);
  // Clear surgeRecover so it doesn't get re-applied if the inline
  // path runs (e.g. self-play double-fire safety).
  combat.surgeRecover = 0;
  if (logGameAction && thread) {
    await logGameAction(game, client, `\u{1F49A} **Recover ${amount}** — **${combat.attackerDcName}** healed ${amount} HP.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Blast N (CRR step 8): all figures and objects on or adjacent to the
 * target's pre-defeat space suffer N damage. Multiple Blast sources sum
 * into one splash event (CRR-BST-010); enqueueAttackerStep8Effects pushes
 * a single 'blast' entry with the summed amount.
 *
 * Reads combat._blastTargetCoord / combat._blastTargetSize / combat._blastFireproofFriendly
 * (stashed by applyDamageAndFinishCombat before the queue ran).
 */
async function fireBlast(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, dcMessageMeta, findDcMessageIdForFigure, getMapData, deps } = ctx;
  const amount = Number(effect.payload?.amount ?? 0);
  if (amount <= 0) return;
  if (!combat._blastTargetCoord || !game.selectedMap?.id) return;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const ftFireproofFriendly = !!combat._blastFireproofFriendly;
  const adjacent = getFiguresAdjacentToCoord(
    game,
    combat._blastTargetCoord,
    game.selectedMap.id,
    combat.target?.figureKey,
    combat._blastTargetSize,
  );
  const dCtx = { dcHealthState, logGameAction, client, deps, thread };
  for (const { figureKey, playerNum } of adjacent) {
    if (playerNum === attackerPlayerNum && ftFireproofFriendly) continue;
    const msgId = findDcMessageIdForFigure?.(game.gameId, playerNum, figureKey);
    if (!msgId) continue;
    const { figureIndex } = parseFigureKey(figureKey);
    const { newHp, wasDefeated } = await applyDamage(game, dCtx, {
      figureKey, msgId, figIndex: figureIndex,
      amount, controllerPlayerNum: playerNum,
      attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
      source: 'Blast', combat,
    });
    const { dcList: bDcList, idx: bIdx } = lookupFigureDcIndex(game, playerNum, figureKey, {
      dcMessageMeta, getDcMessageIds, getDcList,
    });
    // Fury of Kashyyyk (army-wide passive on a CC): friendly WOOKIEE
    // suffering 3+ damage becomes Focused.
    if (amount >= 3 && newHp > 0) {
      const fokDcList = getDcList(game, playerNum) || [];
      if (fokDcList.some((dc) => dc.dcName === '[Fury of Kashyyyk]')) {
        const fokName = dcNameFromFigureKey(figureKey);
        const fokKws = (getDcKeywords(game)[fokName] || []).map((k) => String(k).toUpperCase());
        if (fokKws.includes('WOOKIEE') && applyCondition(game, figureKey, 'Focus')) {
          if (logGameAction) {
            await logGameAction(game, client, `**Fury of Kashyyyk** — **${fokName}** became **Focused** (suffered ${amount} Blast Damage).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
          }
        }
      }
    }
    if (wasDefeated) {
      const blastLabel = bDcList[bIdx]?.displayName || figureKey;
      const blastDcName = bDcList[bIdx]?.dcName;
      await processFigureDefeat(game, {
        defeatedPlayerNum: playerNum,
        figureKey,
        attackerPlayerNum,
        attackerFigureKey: combat.attackerFigureKey,
        msgId,
        dcIdx: bIdx,
        dcName: blastDcName,
        displayName: blastLabel,
        source: 'Blast',
      }, { ...(deps || {}), client });
      if (combat.attackerMsgId) {
        // Per alexanbv 2026-05-13: per-figureKey.
        game.activationKills = game.activationKills || {};
        if (combat.attackerFigureKey) {
          game.activationKills[combat.attackerFigureKey] = (game.activationKills[combat.attackerFigureKey] || 0) + 1;
        }
      }
    }
  }
  // Neutral-NPC splash (alexanbv 2026-05-10): Blast also affects
  // neutral figures (Thugs, Krykna) within 1 of target space. They're
  // figures, not objects — receive damage via applyDamageToNpc.
  try {
    const { applyDamageToNpc } = await import('../game/hostile-enumeration.js');
    const { awardObjectiveVp: _vpBlast } = await import('../game/vp-helpers.js');
    const _blastNormCoord = String(combat._blastTargetCoord).toLowerCase();
    for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
      const arr = game[arrName];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const npc = arr[i];
        if (!npc || npc.defeated) continue;
        // CRR: Blast hits figures/objects OTHER THAN THE TARGET. Skip the target
        // NPC itself when this attack targeted it (unified blast pipeline —
        // alexanbv 2026-06-15).
        if (combat.target?.isNpc && combat.target?.npcType === npcType && combat.target?.npcIndex === i) continue;
        if (countGameSpaces(game, _blastNormCoord, String(npc.coord).toLowerCase()) > 1) continue;
        await applyDamageToNpc(game, { logGameAction, client, awardObjectiveVp: _vpBlast }, {
          npcType, npcIndex: i, amount, attackerPlayerNum, source: `Blast ${amount}`,
        });
      }
    }
  } catch (err) {
    console.error('[fireBlast] npc damage iteration failed:', err?.message ?? err);
  }
  // Object splash (alexanbv 2026-05-10): Blast also damages damageable
  // objects on/adjacent to target space. Routes through the unified
  // object-damage pipeline; splashOnDefeat fires through the figure
  // damage adapter so crate-explosion mechanics keep working.
  try {
    const { getDamageableObjectsWithinN, applyDamageToObject, makeFigureDamageAtAdapter } =
      await import('../game/object-damage-pipeline.js');
    const _blastTargetNorm2 = String(combat._blastTargetCoord).toLowerCase();
    const objectIds = getDamageableObjectsWithinN(game, _blastTargetNorm2, 1);
    if (objectIds.length > 0) {
      const _blastObjCtx = {
        logGameAction, client,
        applyFigureDamageAt: makeFigureDamageAtAdapter(game, {
          logGameAction, client, dcHealthState, findDcMessageIdForFigure, deps, thread,
        }),
        awardObjectiveVp: (await import('../game/vp-helpers.js')).awardObjectiveVp,
      };
      // CRR: Blast hits objects OTHER THAN THE TARGET. Skip the target object
      // (e.g. a crate this attack targeted) — unified blast pipeline.
      const _blastTargetObjId = combat.target?.npcType === 'crate' && combat.target?.crateOrigCoord
        ? `crate-${combat.target.crateOrigCoord}`
        : null;
      for (const objId of objectIds) {
        if (_blastTargetObjId && objId === _blastTargetObjId) continue;
        await applyDamageToObject(game, _blastObjCtx, {
          objectId: objId, amount, attackerPlayerNum, source: `Blast ${amount}`,
        });
      }
    }
  } catch (err) {
    console.error('[fireBlast] object-damage iteration failed:', err?.message ?? err);
  }
  // Legacy crate splash removed Slice 3; legacy cratePositions removed
  // Slice 5 (alexanbv 2026-05-10). Crates flow 100% through the unified
  // object-damage pipeline. applyDamageToObject deletes
  // objectPositions[id] on defeat — no manual sync needed.
}

/**
 * Apply 1 condition (CRR step 8). One queue entry per condition source
 * (surge, CC bonus, passive); each click applies that single condition,
 * routed to attacker (Focus/Hide — beneficial) or target (Bleed/Stun/
 * Weaken — harmful). At apply time fireCondition checks Condition Immunity
 * (Onar, Snowtrooper) + Fireproof (Flame Trooper Bleed) and triggers the
 * Punishing Strike replacement prompt when a harmful condition lands.
 *
 * Per destruct 2026-05-08: even "auto-dealt" conditions (Gaarkhan Bleed,
 * Riot Trooper Weaken passives) flow through this path so Punishing
 * Strike has a chance to fire.
 */
async function fireCondition(thread, game, combat, effect, ctx) {
  const { logGameAction, client, ButtonBuilder, ButtonStyle, ActionRowBuilder, deps } = ctx;
  const cond = effect.payload?.condition;
  if (!cond) return;
  const recipient = effect.payload?.recipient || (HARMFUL_CONDITIONS.includes(cond) ? 'target' : 'attacker');
  const recipientFigKey = recipient === 'target'
    ? combat.target?.figureKey
    : combat.attackerFigureKey;
  if (!recipientFigKey) return;
  const recipientLabel = recipient === 'target'
    ? (combat.target?.label || dcNameFromFigureKey(recipientFigKey))
    : (combat.attackerDcName || dcNameFromFigureKey(recipientFigKey));
  // Condition Immunity (Onar, Snowtrooper, etc.) — only filters HARMFUL.
  if (HARMFUL_CONDITIONS.includes(cond) && isConditionImmune(game, recipientFigKey)) {
    if (logGameAction) {
      await logGameAction(game, client, `**Condition Immunity** — **${recipientLabel}** is immune to ${cond}.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    }
    return;
  }
  // Fireproof (Flame Trooper) — cannot Bleed.
  if (cond === 'Bleed' && combat.defenderFireproof && recipient === 'target') {
    if (logGameAction) {
      await logGameAction(game, client, `**Fireproof** — **${recipientLabel}** is immune to Bleed.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    }
    return;
  }
  const applied = applyCondition(game, recipientFigKey, cond);
  if (logGameAction) {
    const verb = recipient === 'attacker' ? 'gains' : 'is now';
    await logGameAction(game, client, `**${cond}** — **${recipientLabel}** ${verb} **${cond}**.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  // Punishing Strike (Skirmish Upgrade): when one of your figures applies
  // a HARMFUL condition, exhaust to discard that condition and apply a
  // different harmful condition instead. Only prompts when condition
  // actually landed (applied=true) on a target.
  if (applied && HARMFUL_CONDITIONS.includes(cond) && recipient === 'target') {
    const psAtkDcList = getDcList(game, combat.attackerPlayerNum) || [];
    const psHasPS = psAtkDcList.some((dc) => dc.dcName === '[Punishing Strike]');
    const psExhKey = `ps_army_p${combat.attackerPlayerNum}`;
    const psAlreadyExhausted = cardNameIncludes(game.exhaustedSkirmishUpgrades?.[psExhKey], 'Punishing Strike');
    if (psHasPS && !psAlreadyExhausted && thread && ButtonBuilder && ActionRowBuilder) {
      const { setPendingPunishingStrike } = await import('../game/interrupts.js');
      const otherConds = HARMFUL_CONDITIONS.filter((c) => c !== cond);
      const psBtns = otherConds.map((c) =>
        new ButtonBuilder()
          .setCustomId(`ps_replace_${game.gameId}_${recipientFigKey}_${cond}_${c}`)
          .setLabel(`Replace with ${c}`)
          .setStyle(ButtonStyle.Primary),
      );
      psBtns.push(
        new ButtonBuilder()
          .setCustomId(`ps_replace_${game.gameId}_${recipientFigKey}_${cond}_skip`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      );
      setPendingPunishingStrike(game, {
        attackerPlayerNum: combat.attackerPlayerNum,
        targetFigureKey: recipientFigKey,
        originalCondition: cond,
      });
      await thread.send({
        content: `**Punishing Strike** — **${recipientLabel}** was applied **${cond}**. Exhaust Punishing Strike to replace it with a different harmful condition?`,
        components: [new ActionRowBuilder().addComponents(psBtns)],
      }).catch(discordCatch);
    }
  }
}

/**
 * Leg Hydraulics (Tress Hacnua) — attacker after-resolve: "After you
 * resolve an attack, move up to 1 space."
 *
 * Move-X effect: per-effect 1-space budget, no MP banked. Routes
 * through pendingMoveX so the bypass (MOVE-017 + MOVE-020) is scoped
 * to the budget being consumed and discarded when complete or stopped.
 */
async function fireLegHydraulics(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null || !combat.attackerFigureKey) return;
  await setupPendingMoveX(game, ctx, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 1,
    source: 'Leg Hydraulics',
    threadId: combat.combatThreadId,
  });
}

/** Fly-By (Jet Trooper Elite) — gain 2 MP. Migrated from inline (alexanbv 2026-06-16). */
async function fireFlyBy(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null) return;
  const { logGameAction, client } = ctx;
  grantMovementBank(game, combat.attackerMsgId, 2);
  if (logGameAction) await logGameAction(game, client, `\u{1F680} **Fly-By** — **${combat.attackerDcName}** gains 2 MP.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
}

/** Jets (Jet Trooper Regular) — gain 1 MP. Migrated from inline (alexanbv 2026-06-16). */
async function fireJets(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null) return;
  const { logGameAction, client } = ctx;
  grantMovementBank(game, combat.attackerMsgId, 1);
  if (logGameAction) await logGameAction(game, client, `\u{1F680} **Jets** — **${combat.attackerDcName}** gains 1 MP.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
}

/** Locked and Loaded (Migs Mayfeld) — gain 2 Power Tokens; player picks type, overflow
 *  prompts for a discard. Migrated from inline; posts the same power-token choice the
 *  existing handlePowerTokenChoice handler consumes (alexanbv 2026-06-16). */
async function fireLockedAndLoaded(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  const fk = combat.attackerFigureKey;
  if (!fk || !thread || !ButtonBuilder || !ActionRowBuilder) return;
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
  const current = game.figurePowerTokens[fk].length;
  game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: combat.attackerDcName, count: 2 }], channelId: combat.combatThreadId, playerNum: combat.attackerPlayerNum };
  const btns = ['Damage', 'Surge', 'Block', 'Evade'].map((t) =>
    new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary));
  await thread.send({
    content: `\u{1F52B} **Locked and Loaded** — **${combat.attackerDcName}** gains 2 Power Tokens (${current} → ${current + 2}, max 3 — overflow will prompt for discard). Choose token type:`,
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
}

/** Open-Minded (Del Meeko) — gain 1 MP OR 1 Power Token (choice). Migrated from inline;
 *  posts the same buttons the existing handleCombatPassive handler consumes. */
async function fireOpenMinded(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  const msgId = combat.attackerMsgId;
  const fk = combat.attackerFigureKey;
  if (msgId == null || !fk || !thread || !ButtonBuilder || !ActionRowBuilder) return;
  const btns = [
    new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_openminded_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_openminded_token`).setLabel('Gain 1 Power Token').setStyle(ButtonStyle.Secondary),
  ];
  await thread.send({
    content: `\u{1F9E0} **Open-Minded** — **${combat.attackerDcName}**: Choose one:`,
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
}

/**
 * Stun Batons (Riot Trooper E/R) — attacker after-resolve: target
 * suffers 1 Strain on damage. Routes through the strain pipeline
 * (applyStrain), which handles Fireproof, Headhunter, opponent's
 * strain-prevention CCs, and the underlying damage application —
 * which fires when-damaged hooks + defeat checks correctly.
 * destruct 2026-05-08.
 */
async function fireStunBatons(thread, game, combat, effect, ctx) {
  if (!combat?.target?.figureKey) return;
  const defenderPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  await applyStrain(game, ctx, {
    figureKey: combat.target.figureKey,
    controllerPlayerNum: defenderPN,
    amount: 1,
    source: 'Stun Batons',
  });
}

/**
 * Stalk Prey (Bossk CC) — attacker after-resolve: +2 MP + 1 Damage
 * Token. Triggered by combat.surgeStalkPrey flag set when the CC
 * was played; this fire handler clears the flag.
 */
async function fireStalkPrey(thread, game, combat, effect, ctx) {
  const { logGameAction, client, ensureMovementBankMessage } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  // Per-figure bank: +2 MP goes to the attacking figure's sub-bank only.
  const _atkFigIdx = parseFigureKey(combat.attackerFigureKey).figureIndex ?? 0;
  grantMovementBank(game, combat.attackerMsgId, 2, _atkFigIdx);
  grantPowerTokens(game, combat.attackerFigureKey, 'Damage', 1);
  delete combat.surgeStalkPrey;
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `**Stalk Prey** — **${combat.attackerDcName}** gained +2 MP and +1 Damage Token`,
      { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  if (ensureMovementBankMessage) {
    await ensureMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
  }
}

/**
 * Slippery (Alliance Smuggler E/R) — defender after-resolve: "After
 * an attack targeting you resolves, gain 2 movement points." This
 * is an OUT-OF-ACTIVATION MP gain (the defender isn't activating)
 * so per the gain-MP rules the points must be spent IMMEDIATELY by
 * interrupt — not banked. Routes through setupPendingMoveX so the
 * 1-space-at-a-time picker fires; remaining points are discarded
 * when the picker closes.
 */
async function fireSlippery(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  const msgId = effect.payload?.msgId;
  const figureKey = effect.payload?.figureKey;
  const playerNum = effect.payload?.playerNum;
  const threadId = effect.payload?.threadId || null;
  if (!msgId || !figureKey || !playerNum) return;
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `\u{1F3C3} **Slippery** — **${effect.payload?.defenderDcName || combat.target?.label}** gains 2 MP to spend immediately (interrupt; remaining discarded).`,
      { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  // Slippery is a regular MP gain (not Move-X) — bypassCosts: false
  // makes the picker honor +1 difficult-terrain and +1 hostile-figure
  // adders, with the figure's profile (Mobile / Massive / Efficient
  // Travel) overriding via getMovementProfile.
  await setupPendingMoveX(game, ctx, {
    msgId,
    figureKey,
    playerNum,
    spaces: 2,
    source: 'Slippery',
    threadId,
    bypassCosts: false,
  });
}

/**
 * Cleave N (CRR-CLV-005): each Cleave-X source independently picks
 * its own target from the eligible set. The step-8 queue surfaces
 * one button per accumulating source (passive Cleave, Surge: Cleave,
 * Krayt Dragon Fury, Darksaber Blast→Cleave conversion, etc.); each
 * click posts a target picker for THAT source's value alone, and the
 * existing handleCleaveTarget applies damage + defeat finalization
 * via _applyDamage.
 *
 * Per the user's correction: Blast SUMS multiple sources into one
 * splash event (handled by fireBlast); Cleave does NOT sum — each
 * source resolves separately with its own target choice.
 */
async function fireCleave(thread, game, combat, effect, ctx) {
  const { client, logGameAction } = ctx;
  const amount = Number(effect.payload?.amount ?? 0);
  if (amount <= 0 || !combat?.target?.figureKey) return;
  const sourceLabel = effect.payload?.sourceLabel || `Cleave ${amount}`;
  const defenderPlayerNum = combat.defenderPlayerNum
    ?? (combat.attackerPlayerNum === 1 ? 2 : 1);
  // Use the engine's existing cleave-eligibility helper + button
  // builder + pendingCleave state so the click flow matches the
  // legacy inline path exactly. The only difference: cleaveQueue is
  // empty here — each source is its own queued effect, so
  // handleCleaveTarget returns to the step-8 window when this source
  // resolves rather than chaining to a "next source" reprompt.
  let computeCleaveEligibleTargets, getCleaveTargetButtons, deps;
  try {
    ({ computeCleaveEligibleTargets } = await import('../engine/combat-bridge.js'));
    deps = ctx.deps || ctx;
    getCleaveTargetButtons = deps?.getCleaveTargetButtons || ctx?.getCleaveTargetButtons;
  } catch (err) {
    console.error('[after-attack-fire] fireCleave import failed:', err?.message ?? err);
    return;
  }
  if (!computeCleaveEligibleTargets) return;
  const cleaveTargets = computeCleaveEligibleTargets(game, combat, defenderPlayerNum, deps);
  if (cleaveTargets.length === 0) {
    if (logGameAction && thread) {
      await logGameAction(game, client, `**${sourceLabel}** — no eligible targets in range; effect skipped.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  const { setPendingCleave } = await import('../game/interrupts.js');
  const ownerId = game[`player${combat.attackerPlayerNum}Id`];
  setPendingCleave(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    surgeCleave: amount,
    sourceLabel,
    // Empty queue: each source is its own step-8 effect entry, so
    // handleCleaveTarget should NOT chain to a next source — it
    // should return to the post-resolve window for the next button.
    cleaveQueue: [],
    attackerPlayerNum: combat.attackerPlayerNum,
    defenderPlayerNum,
    ownerId,
    targets: cleaveTargets,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  if (thread && getCleaveTargetButtons) {
    const cleaveRows = getCleaveTargetButtons(game.gameId, cleaveTargets);
    await thread.send({
      content: `**${sourceLabel}** — <@${ownerId}>, choose one eligible target to apply Cleave damage:`,
      components: cleaveRows,
      allowedMentions: { users: [ownerId] },
    }).catch(discordCatch);
  }
}

/**
 * Vader's Finest (Attack+Move special action) — attacker after-resolve:
 * 1-space Move-X picker, bypassCosts true. The attack already fired
 * via freeAttackBonusPending; this is the move that follows.
 */
async function fireVadersFinestMove(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null || !combat.attackerFigureKey) return;
  await setupPendingMoveX(game, ctx, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 1,
    source: "Vader's Finest",
    threadId: combat.combatThreadId,
    bypassCosts: true,
  });
}

/**
 * Burst Fire (Imperial Loadout): on damage, every figure adjacent to the
 * target's pre-defeat space (excluding target) is Stunned. Condition
 * Immunity blocks the Stun. Reads combat._blastTargetCoord/_blastTargetSize
 * (stashed at step-7 close, same as Blast).
 */
async function fireBurstFire(thread, game, combat, effect, ctx) {
  const { logGameAction, client, getMapData } = ctx;
  if (combat.attackerFigureKey && game.burstFirePendingMsgId?.[combat.attackerFigureKey]) {
    delete game.burstFirePendingMsgId[combat.attackerFigureKey];
  }
  if (!combat._blastTargetCoord || !game.selectedMap?.id) return;
  const ms = getMapData?.(game.selectedMap.id);
  if (!ms) return;
  const targetSize = combat._blastTargetSize || (combat.target?.figureKey ? getFigureSize(dcNameFromFigureKey(combat.target.figureKey)) : null) || '1x1';
  const targetCells = getFootprintCells(combat._blastTargetCoord, targetSize);
  const adjSet = new Set();
  for (const cell of targetCells) {
    for (const a of (ms.adjacency?.[cell] || [])) adjSet.add(a);
  }
  for (const cell of targetCells) adjSet.delete(cell);
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      const fkSize = getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
      const fkCells = getFootprintCells(pos, fkSize);
      if (!fkCells.some((c) => adjSet.has(c))) continue;
      if (fk === combat.target?.figureKey) continue;
      if (isConditionImmune(game, fk)) continue;
      if (applyCondition(game, fk, 'Stun') && logGameAction) {
        await logGameAction(game, client, `\u{1F4A5} **Burst Fire** — **${dcNameFromFigureKey(fk)}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
      }
    }
  }
}

/**
 * Crippling Blow (Imperial Loadout): on hit, defender is Stunned.
 * Condition Immunity logs and skips.
 */
async function fireCripplingBlow(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  if (combat.attackerFigureKey && game.cripplingBlowPending?.[combat.attackerFigureKey]) {
    delete game.cripplingBlowPending[combat.attackerFigureKey];
  }
  const fk = combat.target?.figureKey;
  if (!fk) return;
  const label = combat.target.label || dcNameFromFigureKey(fk);
  if (isConditionImmune(game, fk)) {
    if (logGameAction) {
      await logGameAction(game, client, `**Crippling Blow** — **${label}** is immune to Stun.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  if (applyCondition(game, fk, 'Stun') && logGameAction) {
    await logGameAction(game, client, `⚡ **Crippling Blow** — **${label}** is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Disruptor Rifle (Imperial Loadout): if attack hit and defender currently
 * at exactly 1 HP, deal 1 more damage. The HP read is at click time so
 * other step-8 effects (e.g. Bleed apply) that lowered HP don't double-fire.
 */
async function fireDisruptorRifle(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps } = ctx;
  if (combat.attackerFigureKey && game.disruptorRiflePending?.[combat.attackerFigureKey]) {
    delete game.disruptorRiflePending[combat.attackerFigureKey];
  }
  const fk = combat.target?.figureKey;
  const targetMsgId = combat.target?.msgId;
  if (!fk || !targetMsgId) return;
  const { figureIndex } = parseFigureKey(fk);
  const hs = dcHealthState?.get?.(targetMsgId) || [];
  const entry = hs[figureIndex];
  if (!entry) return;
  const [cur] = entry;
  if (cur !== 1) {
    if (logGameAction) {
      await logGameAction(game, client, `**Disruptor Rifle** — **${combat.target.label}** is not at 1 HP; effect skipped.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: fk, msgId: targetMsgId, figIndex: figureIndex,
    amount: 1, controllerPlayerNum: combat.defenderPlayerNum,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    source: 'Disruptor Rifle', combat,
  });
  if (logGameAction) {
    await logGameAction(game, client, `\u{1F480} **Disruptor Rifle** — **${combat.target.label}** had 1 HP — suffers 1 additional Damage and is **defeated**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  const { idx } = lookupFigureDcIndex(game, combat.defenderPlayerNum, fk, {
    dcMessageMeta: ctx.dcMessageMeta,
    getDcMessageIds, getDcList,
  });
  await processFigureDefeat(game, {
    defeatedPlayerNum: combat.defenderPlayerNum,
    figureKey: fk,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    msgId: targetMsgId,
    dcIdx: idx,
    dcName: dcNameFromFigureKey(fk),
    displayName: combat.target.label,
    source: 'Disruptor Rifle',
  }, { ...(deps || {}), client });
}

/**
 * Electro-pulse (Electrohammer post-attack): each other figure adjacent
 * to the target space suffers 1 Damage. Source PT is excluded; target
 * itself takes the splash too (CRR slice 6.11 destruct fix).
 */
async function fireElectroPulse(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, findDcMessageIdForFigure, deps } = ctx;
  combat.loadoutPostAttack = null;
  const targetFk = combat.target?.figureKey;
  if (!targetFk) return;
  const targetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[targetFk] || combat._blastTargetCoord;
  if (!targetPos) return;
  const lines = [];
  for (const pNum of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pNum] || {})) {
      if (pNum === combat.attackerPlayerNum && fk === combat.attackerFigureKey) continue;
      if (countGameSpaces(game, pos, targetPos) > 1) continue;
      const msgId = findDcMessageIdForFigure?.(game.gameId, pNum, fk);
      if (!msgId) continue;
      const { figureIndex } = parseFigureKey(fk);
      await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
        figureKey: fk, msgId, figIndex: figureIndex,
        amount: 1, controllerPlayerNum: pNum,
        attackerPlayerNum: combat.attackerPlayerNum,
        attackerFigureKey: combat.attackerFigureKey,
        source: 'Electro-pulse', combat,
      });
      lines.push(`**${dcNameFromFigureKey(fk)}** suffers 1 Damage`);
    }
  }
  if (lines.length && logGameAction) {
    await logGameAction(game, client, `⚡ **Electro-pulse** — Adjacent figures:\n${lines.join('\n')}`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Quick Strike (Electrostaff post-attack): if defender modified dice
 * (rerolled or +/-N), defender suffers 1 Damage. Hit-gating already
 * happened at queue time.
 */
async function fireQuickStrike(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps } = ctx;
  combat.loadoutPostAttack = null;
  const fk = combat.target?.figureKey;
  const targetMsgId = combat.target?.msgId;
  if (!fk || !targetMsgId) return;
  const { figureIndex } = parseFigureKey(fk);
  await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: fk, msgId: targetMsgId, figIndex: figureIndex,
    amount: 1, controllerPlayerNum: combat.defenderPlayerNum,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    source: 'Quick Strike', combat,
  });
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **Quick Strike** — Defender modified dice/results: **${combat.target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Stage a chain-attack prompt for after-defender-Done. The fire handlers
 * below populate combat._pendingChainAttacks; combat-bridge's
 * _finishCombatResolution iterates and posts each prompt + sets the
 * matching pending flag so the player gets the new attack only AFTER
 * the defender's step-8 window has closed (per user 2026-05-09 spec).
 */
function _stageChainAttack(combat, entry) {
  combat._pendingChainAttacks = combat._pendingChainAttacks || [];
  combat._pendingChainAttacks.push(entry);
}

/**
 * Tonfa Strike (Imperial Loadout): "after this attack, you may make an
 * additional attack." Stage the chain attack — combat-close will post
 * the Declare Attack prompt + arm freeAttackBonusPending after the
 * defender step-8 window closes.
 */
async function fireTonfaStrike(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  // Per-figureKey 2026-05-13: each figure has its own Tonfa Strike grant.
  if (combat.attackerFigureKey && game.tonfaStrikeSecondAttack?.[combat.attackerFigureKey]) {
    delete game.tonfaStrikeSecondAttack[combat.attackerFigureKey];
  }
  _stageChainAttack(combat, {
    source: 'Tonfa Strike',
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    message: '**Tonfa Strike** — You may perform an additional attack (use Attack button).',
  });
}

/**
 * Barrage (CT-1701): "after first attack, perform a second attack
 * (target within 3 of first; defender +1 white die)." Stages target
 * window + defense bonus alongside the chain attack.
 */
async function fireBarrage(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  // Per-figureKey 2026-05-13.
  if (combat.attackerFigureKey && game.barrageSecondAttack?.[combat.attackerFigureKey]) {
    delete game.barrageSecondAttack[combat.attackerFigureKey];
  }
  // Capture target's position now (target may move/be removed during
  // defender step 8); chain-attack post-close uses this for the within-3 gate.
  const targetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[combat.target?.figureKey];
  _stageChainAttack(combat, {
    source: 'Barrage',
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    barrageTargetSpace: targetPos || null,
    barrageDefenseBonus: true,
    message: '**Barrage** — You may perform a second attack (target within 3 of first target, defender +1 white die). Use the **Attack** button.',
  });
}

/**
 * Flurry of Blows (Electrobaton loadout): hit-gated free 1-green-die
 * melee attack with +1 Hit, once per activation. Stages override-dice +
 * the chain attack.
 */
async function fireFlurryOfBlows(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  combat.loadoutPostAttack = null;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  // Per alexanbv 2026-06-13: Flurry of Blows is per FIGURE, not per group.
  game.roundFigureAbilityUsed[`flurryOfBlows_${combat.attackerFigureKey}`] = true;
  _stageChainAttack(combat, {
    source: 'Flurry of Blows',
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    pendingOverrideAttackDice: { dice: ['green'], type: 'melee', bonusHits: 1 },
    message: '**Flurry of Blows** — You may perform a Melee attack using 1 green die (+1 Hit). Use the Attack button.',
  });
}

/**
 * Fell Swoop (Davith Elso surge): apply Hide, present Move 2 picker,
 * then stage the chain attack for after defender step 8 closes. The
 * Move-X picker fires immediately on click; after it drains, the new
 * attack waits until the defender Done.
 */
async function fireFellSwoop(thread, game, combat, effect, ctx) {
  const { logGameAction, client, saveGames } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
  if (game.roundFigureAbilityUsed[fsKey]) return;
  game.roundFigureAbilityUsed[fsKey] = true;
  applyCondition(game, combat.attackerFigureKey, 'Hide');
  const attName = combat.attackerDisplayName || dcNameFromFigureKey(combat.attackerFigureKey);
  if (logGameAction) {
    await logGameAction(game, client, `**Fell Swoop** — **${attName}** becomes **Hidden** and may **move up to 2 spaces**, then make a free attack.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  _stageChainAttack(combat, {
    source: 'Fell Swoop',
    msgId: combat.attackerMsgId,
    flagKey: 'fellSwoopFreeAttack',
    flagValue: true,
    message: null, // deferred prompt is posted via freeAttackPrompt continuation when Move-X drains
  });
  const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
  stampPendingMoveX(game, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 2,
    source: 'Fell Swoop',
    threadId: combat.combatThreadId,
    nextAction: {
      type: 'freeAttackPrompt',
      payload: {
        msgId: combat.attackerMsgId,
        playerNum: combat.attackerPlayerNum,
        figureKey: combat.attackerFigureKey,
        sourceLabel: 'Fell Swoop',
      },
    },
  });
  await postMoveXPicker(game, { client, logGameAction, saveGames }, combat.attackerMsgId);
}

/**
 * Bladestorm (CC effect): after attack, all hostiles within N spaces of
 * the attacker suffer N AoE damage. Reads combat.postAttackAoeDamage +
 * combat.postAttackAoeRange (set by the CC). Routes through the central
 * damage pipeline so when-damaged / before-defeated / when-defeated
 * hooks fire — this is an upgrade over the inline path which mutated
 * dcHealthState directly and bypassed the hooks.
 */
async function fireBladestorm(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, findDcMessageIdForFigure, deps } = ctx;
  const aoeDmg = combat.postAttackAoeDamage || 0;
  const aoeRange = combat.postAttackAoeRange || 2;
  combat.postAttackAoeDamage = 0;
  if (aoeDmg <= 0) return;
  const atkFk = combat.attackerFigureKey;
  const atkPos = atkFk ? game.figurePositions?.[combat.attackerPlayerNum]?.[atkFk] : null;
  const defPn = combat.defenderPlayerNum;
  if (!atkPos || !defPn) return;
  const lines = [];
  for (const [fk, coord] of Object.entries(game.figurePositions?.[defPn] || {})) {
    if (!coord || fk === combat.target?.figureKey) continue;
    if (countGameSpaces(game, atkPos, coord) > aoeRange) continue;
    const fMsgId = findDcMessageIdForFigure?.(game.gameId, defPn, fk);
    if (!fMsgId) continue;
    const { figureIndex } = parseFigureKey(fk);
    const { prevHp, newHp } = await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
      figureKey: fk, msgId: fMsgId, figIndex: figureIndex,
      amount: aoeDmg, controllerPlayerNum: defPn,
      attackerPlayerNum: combat.attackerPlayerNum,
      attackerFigureKey: atkFk,
      source: 'Bladestorm', combat,
    });
    lines.push(`**${dcNameFromFigureKey(fk)}** ${aoeDmg} Dmg (${prevHp}→${newHp})`);
  }
  if (lines.length && thread) {
    await thread.send(`**Bladestorm** — Hostiles within ${aoeRange} spaces: ${lines.join(', ')}`).catch(discordCatch);
  }
}

/**
 * Shrapnel Splash (Drokkatta) — picker-chosen splash alternative to
 * Blast 2. Card text: "after this attack resolves, if it did not miss,
 * each figure and object within 2 spaces of the target space suffers
 * 1 Damage." Per alexanbv 2026-05-10: choice is made via the surge-
 * spend picker (combat_passive_shrapnel_blast vs _splash); this fire
 * handler runs only on the splash branch, gated on the attack not
 * missing (combat._step7Hit).
 */
async function fireShrapnelSplash(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, findDcMessageIdForFigure, deps } = ctx;
  if (!combat.surgeShrapnelSplash) return;
  combat.surgeShrapnelSplash = false;
  if (!combat._step7Hit) {
    await thread?.send?.('🧨 **Shrapnel Splash** — Attack missed; splash does not fire.').catch(discordCatch);
    return;
  }
  const tgtFk = combat.target?.figureKey;
  const defPn = combat.defenderPlayerNum;
  if (!tgtFk || !defPn) return;
  const tgtPos = game.figurePositions?.[defPn]?.[tgtFk];
  if (!tgtPos) return;
  const atkPn = combat.attackerPlayerNum;
  const atkFk = combat.attackerFigureKey;
  const lines = [];
  // alexanbv 2026-05-10: card text "each figure and object within 2 of
  // target space" — every figure (regular + neutral NPCs) is affected,
  // including the primary target. enumerateAllFigures returns both
  // populations; routing branches on isNpc.
  const { enumerateAllFigures, applyDamageToNpc } = await import('../game/hostile-enumeration.js');
  const { awardObjectiveVp } = await import('../game/vp-helpers.js');
  for (const entry of enumerateAllFigures(game)) {
    if (countGameSpaces(game, tgtPos, entry.coord) > 2) continue;
    if (entry.isNpc) {
      const r = await applyDamageToNpc(game, { logGameAction, client, awardObjectiveVp }, {
        npcType: entry.npcType, npcIndex: entry.npcIndex,
        amount: 1, attackerPlayerNum: atkPn, source: 'Shrapnel Splash',
      });
      if (r.applied) {
        const label = entry.npcType === 'thug' ? `Thug ${entry.npcIndex + 1}` : `Krykna ${entry.npcIndex + 1}`;
        lines.push(`**${label}** 1 Dmg (${r.prevHp}→${r.newHp})`);
      }
      continue;
    }
    const pn = entry.controllerPlayerNum;
    const fk = entry.figureKey;
    const fMsgId = findDcMessageIdForFigure?.(game.gameId, pn, fk);
    if (!fMsgId) continue;
    const { figureIndex } = parseFigureKey(fk);
    const { prevHp, newHp } = await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
      figureKey: fk, msgId: fMsgId, figIndex: figureIndex,
      amount: 1, controllerPlayerNum: pn,
      attackerPlayerNum: atkPn,
      attackerFigureKey: atkFk,
      source: 'Shrapnel Splash', combat,
    });
    lines.push(`**${dcNameFromFigureKey(fk)}** 1 Dmg (${prevHp}→${newHp})`);
  }
  if (lines.length && thread) {
    await thread.send(`🧨 **Shrapnel Splash** — Figures within 2 of target: ${lines.join(', ')}`).catch(discordCatch);
  } else if (thread) {
    await thread.send('🧨 **Shrapnel Splash** — no figures within 2 of target space.').catch(discordCatch);
  }
  // Objects within 2 of target space — card text says "each figure AND
  // object" so mission-declared damageable objects within range take 1
  // Damage too. Object-damage pipeline (alexanbv 2026-05-10). The
  // splash-on-defeat callback routes through canonical applyDamage so
  // figure-defeat hooks fire.
  try {
    const { getDamageableObjectsWithinN, applyDamageToObject, makeFigureDamageAtAdapter } =
      await import('../game/object-damage-pipeline.js');
    const objectIds = getDamageableObjectsWithinN(game, tgtPos, 2);
    if (objectIds.length > 0) {
      const _splashCtx = {
        logGameAction, client,
        applyFigureDamageAt: makeFigureDamageAtAdapter(game, {
          logGameAction, client, dcHealthState, findDcMessageIdForFigure, deps, thread,
        }),
        awardObjectiveVp: (await import('../game/vp-helpers.js')).awardObjectiveVp,
      };
      for (const objId of objectIds) {
        await applyDamageToObject(game, _splashCtx, {
          objectId: objId, amount: 1, attackerPlayerNum: atkPn, source: 'Shrapnel Splash',
        });
      }
    }
  } catch (err) {
    console.error('[shrapnel-splash] object-damage iteration failed:', err?.message ?? err);
  }
}

/**
 * Sidewinder (Jyn Odan): "after this attack, suffer 1 Strain to move
 * up to 2 spaces. Limit once per round." Posts the same yes/skip prompt
 * the inline path used to auto-post after combat close. Existing
 * handleSidewinderApply / handleSidewinderSkip (combat-special-effects.js)
 * own the click flow — no combat-close coupling, so the step-8 wrap is
 * a clean lift.
 */
async function fireSidewinder(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !ButtonBuilder || !ActionRowBuilder) return;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  const swKey = combat.attackerFigureKey + '_sidewinder';
  if (game.roundFigureAbilityUsed?.[swKey]) return;
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  await thread.send({
    content: `<@${ownerId}> **Sidewinder** — Suffer 1 Strain to move up to 2 spaces? (once per round)`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sidewinder_apply_${game.gameId}_${combat.attackerMsgId}_${combat.attackerFigureIndex ?? 0}`)
        .setLabel('Suffer 1 Strain → Move up to 2 spaces')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`sidewinder_skip_${game.gameId}`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Primary),
    )],
  }).catch(discordCatch);
}

/**
 * Boltslinger (Vinto Hreeda): after attack, deal 1 Damage to a hostile
 * within 3 spaces. Posts the existing target picker; the click handler
 * (handleBoltslingerTarget) does the apply + defeat handling and does
 * NOT close combat, so no fromStep8Queue bypass needed.
 */
async function fireBoltslinger(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !ButtonBuilder || !ActionRowBuilder) return;
  if (!combat.attackerFigureKey || !game.selectedMap?.id) return;
  const defPN = opponentPlayerNum(combat.attackerPlayerNum);
  const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
  if (!atkPos) return;
  const targets = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
    if (fk === combat.target?.figureKey) continue;
    if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
    const { label } = getFigureLabel(game, defPN, fk, undefined, 80, {
      dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
    });
    targets.push({ figureKey: fk, playerNum: defPN, label });
  }
  if (targets.length === 0) return;
  setPendingBoltslinger(game, {
    gameId: game.gameId,
    attackerPlayerNum: combat.attackerPlayerNum,
    combatThreadId: combat.combatThreadId,
    targets,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  const btns = targets.slice(0, 4).map((t, i) =>
    new ButtonBuilder().setCustomId(`boltslinger_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`boltslinger_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Boltslinger** — Choose a hostile within 3 spaces to deal 1 Damage (verify LOS):`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Indiscriminate Fire (Bossk): on hit, choose 1 non-red attack die;
 * each OTHER figure within 2 spaces of target (excluding defender +
 * Bossk himself) suffers Damage = Hits and Strain = Surges on that die.
 * If only one non-red die was rolled, the splash auto-applies via the
 * existing applyIndiscriminateFireSplash helper (no decision needed);
 * otherwise the die-picker prompt fires.
 */
async function fireIndiscriminateFire(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder, deps } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey) return;
  const defPN = opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const rolledDice = combat.attackRoll?.dice || [];
  const nonRedDice = rolledDice.filter((d) => (d.color || '').toLowerCase() !== 'red');
  if (nonRedDice.length === 0) return;
  const splashTargets = [];
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (fk === combat.target.figureKey) continue;
      if (fk === combat.attackerFigureKey) continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      const { label } = getFigureLabel(game, pn, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      splashTargets.push({ figureKey: fk, playerNum: pn, label });
    }
  }
  const applyIndiscriminateFireSplash = deps?.applyIndiscriminateFireSplash || ctx.applyIndiscriminateFireSplash;
  if (nonRedDice.length === 1 && applyIndiscriminateFireSplash) {
    await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, deps);
    return;
  }
  setPendingIndiscriminateFire(game, {
    attackerPlayerNum: combat.attackerPlayerNum,
    combatThreadId: combat.combatThreadId,
    targets: splashTargets,
    availableDice: nonRedDice,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  const btns = nonRedDice.slice(0, 5).map((d, i) =>
    new ButtonBuilder()
      .setCustomId(`indiscriminate_die_${game.gameId}_${i}`)
      .setLabel(`${String(d.color).slice(0, 1).toUpperCase()}${String(d.color).slice(1)} (${d.dmg}dmg/${d.surge}↯)`)
      .setStyle(ButtonStyle.Secondary));
  btns.push(new ButtonBuilder().setCustomId(`indiscriminate_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Indiscriminate Fire** — Choose 1 non-red attack die for splash:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Heavy Fire (Skirmish Upgrade): if the attacker is a friendly VEHICLE
 * or HEAVY WEAPON and the [Heavy Fire] DC is in the army and not
 * exhausted, the attacker may deal 1 Damage to up to N hostiles within
 * 2 of target (where N = printed attack-pool dice count). For each
 * chosen target, attacker gains 1 HARMFUL condition picked by opponent.
 */
async function fireHeavyFire(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder, dcExhaustedState } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey || !combat.attackerDcName) return;
  const playerNum = combat.attackerPlayerNum;
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const hfIdx = dcList.findIndex((dc) => dc.dcName === '[Heavy Fire]');
  if (hfIdx < 0) return;
  const hfMsgId = dcMsgIds[hfIdx];
  if (!hfMsgId) return;
  if (dcExhaustedState?.get?.(hfMsgId)) return;
  const atkKws = (ctx.getDcKeywords?.(game) || {})[combat.attackerDcName] || [];
  // Note: getDcKeywords is imported, but ctx may also pass it; use either.
  const upper = atkKws.map((k) => String(k).toUpperCase());
  if (!upper.includes('VEHICLE') && !upper.includes('HEAVY WEAPON')) return;
  const attEff = getDcEffect(combat.attackerDcName);
  const printed = attEff?.attack?.dice || [];
  const diceCount = printed.length;
  if (diceCount === 0) return;
  const defPN = opponentPlayerNum(playerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey] || combat._blastTargetCoord;
  if (!targetPos) return;
  const hostiles = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
    if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
    const { label } = getFigureLabel(game, defPN, fk, undefined, 80, {
      dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
    });
    hostiles.push({ figureKey: fk, playerNum: defPN, label });
  }
  if (hostiles.length === 0) return;
  setPendingHeavyFire(game, {
    attackerPlayerNum: playerNum,
    attackerFigureKey: combat.attackerFigureKey,
    attackerDcName: combat.attackerDcName,
    attackerMsgId: combat.attackerMsgId,
    combatThreadId: combat.combatThreadId,
    hfMsgId,
    diceCount,
    hostiles,
    chosenTargets: [],
    conditionsOwed: 0,
  });
  const ownerId = getPlayerId(game, playerNum);
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Heavy Fire** — Your **${combat.attackerDcName}** resolved an attack (printed pool: ${diceCount} dice). Exhaust Heavy Fire to deal 1 Damage to up to ${diceCount} hostile figure${diceCount !== 1 ? 's' : ''} within 2 spaces of the target. Then, for each chosen figure, **${combat.attackerDcName}** gains 1 HARMFUL condition of your opponent's choice.`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`heavy_fire_use_${game.gameId}`).setLabel(`Use Heavy Fire (${diceCount} target${diceCount !== 1 ? 's' : ''})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`heavy_fire_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    )],
  })).catch(discordCatch);
}

/**
 * Havoc Shot (Fenn Signis): on hit, suffer 1 Strain to deal 1 Damage to
 * up to 2 figures within 2 of target in attacker's LOS. Original target
 * IS eligible to be re-picked (per ruling); only attacker is excluded.
 */
async function fireHavocShot(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey || !combat.attackerFigureKey) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey] || combat._blastTargetCoord;
  const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
  if (!targetPos || !atkPos) return;
  const ms = ctx.getMapData?.(game.selectedMap.id);
  if (!ms) return;
  const allFp = getAllFigureFootprints(game, getFigureSize);
  const atkFp = getFigureFootprint(game, combat.attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
  const eligible = [];
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!pos || fk === combat.attackerFigureKey) continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      const candFp = getFigureFootprint(game, pn, fk, getFigureSize);
      if (!hasFigureLineOfSight(atkFp, candFp, ms, allFp)) continue;
      const { label } = getFigureLabel(game, pn, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      eligible.push({ figureKey: fk, playerNum: pn, label });
    }
  }
  if (eligible.length === 0) return;
  setPendingHavocShot(game, {
    gameId: game.gameId,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerMsgId: combat.attackerMsgId,
    attackerFigureKey: combat.attackerFigureKey,
    attackerFigureIndex: combat.attackerFigureIndex ?? 0,
    combatThreadId: combat.combatThreadId,
    targets: eligible,
    chosen: [],
    maxPicks: 2,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Havoc Shot** — Suffer 1 Strain to deal 1 Damage to up to 2 figures within 2 spaces of the target in your LOS?`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`havoc_shot_use_${game.gameId}`).setLabel('Use Havoc Shot (1 Strain)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`havoc_shot_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    )],
  })).catch(discordCatch);
}

/**
 * Concussive Bolt (4-LOM): on hit, push 1x1 target 1 space (attacker
 * picks direction). Posts the same push-destination prompt as the
 * inline path; pending state carries fromStep8Queue so the click
 * handler re-posts the attacker step-8 window instead of closing combat.
 */
async function fireConcussiveBolt(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !combat.target?.figureKey || !game.selectedMap?.id) return;
  const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
  if (getFigureSize(targetDcName) !== '1x1') return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const { getValidPushDestinations } = await import('../game/movement.js');
  const pusherDc = combat.attackerFigureKey ? dcNameFromFigureKey(combat.attackerFigureKey) : null;
  const pusherKws = pusherDc ? (getDcEffect(pusherDc)?.keywords || []).map((k) => String(k).toUpperCase()) : [];
  const adjSpaces = getValidPushDestinations(game, combat.target.figureKey, defPN, { pusherIsMassive: pusherKws.includes('MASSIVE') });
  if (adjSpaces.length === 0) return;
  const { label } = getFigureLabel(game, defPN, combat.target.figureKey, targetDcName, 80, {
    dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  setPendingConcussiveBolt(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    attackerPlayerNum: combat.attackerPlayerNum,
    defenderPlayerNum: defPN,
    ownerId,
    figureKey: combat.target.figureKey,
    figureLabel: String(label).slice(0, 80),
    currentPos: targetPos,
    adjSpaces,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  const btns = adjSpaces.slice(0, 4).map((sp) =>
    new ButtonBuilder().setCustomId(`concussive_bolt_push_${game.gameId}_${sp}`).setLabel(sp.toUpperCase()).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`concussive_bolt_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Concussive Bolt** — Push **${label}** 1 space. Choose a destination:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Fighting Knife (Verena Talos): on hit, choose an adjacent hostile,
 * roll 1 red die, apply Hits as damage. Stores fromStep8Queue: true so
 * handleFightingKnifeTarget / Skip return to the attacker post-resolve
 * window instead of closing combat.
 */
async function fireFightingKnife(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder, deps } = ctx;
  if (!thread || !combat.attackerFigureKey || !game.selectedMap?.id) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const getFiguresAdjacentToTarget = deps?.getFiguresAdjacentToTarget;
  if (!getFiguresAdjacentToTarget) return;
  const adjHostiles = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id)
    .filter((c) => c.playerNum === defPN);
  if (adjHostiles.length === 0) return;
  const targets = adjHostiles.map((c) => {
    const { msgId, label } = getFigureLabel(game, c.playerNum, c.figureKey, undefined, 80, {
      dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
    });
    return { figureKey: c.figureKey, playerNum: c.playerNum, label, msgId };
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  setPendingFightingKnife(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    attackerPlayerNum: combat.attackerPlayerNum,
    ownerId,
    targets,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  const btns = targets.slice(0, 4).map((t, i) =>
    new ButtonBuilder().setCustomId(`fighting_knife_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`fighting_knife_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Fighting Knife** — Choose an adjacent hostile figure to roll 1 red die:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Spread the Pain (Dengar surge): on hit, apply each chosen HARMFUL
 * condition to a figure on or adjacent to the target. Multi-step flow:
 * one figure pick prompt per condition, advanced by advanceSpreadThePain.
 * Stages fromStep8Queue: true so the multi-step return path goes back
 * to the attacker post-resolve window.
 */
async function fireSpreadThePain(thread, game, combat, effect, ctx) {
  if (!thread || !Array.isArray(combat.spreadThePainConditions) || combat.spreadThePainConditions.length === 0) return;
  if (!combat.target?.figureKey || !game.selectedMap?.id) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const ms = ctx.getMapData?.(game.selectedMap.id);
  const adjacency = ms?.adjacency || {};
  const candSpaces = new Set([
    String(targetPos).toLowerCase(),
    ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase()),
  ]);
  let anyEligible = false;
  for (const p of [1, 2]) {
    for (const figPos of Object.values(game.figurePositions?.[p] || {})) {
      if (candSpaces.has(String(figPos).toLowerCase())) { anyEligible = true; break; }
    }
    if (anyEligible) break;
  }
  if (!anyEligible) return;
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  setPendingSpreadThePain(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    attackerPlayerNum: combat.attackerPlayerNum,
    defenderPlayerNum: defPN,
    ownerId,
    conditions: [...combat.spreadThePainConditions],
    conditionIdx: 0,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  // Reuse the existing multi-step prompt advancer.
  const { advanceSpreadThePain } = await import('./combat-special-effects.js').catch(() => ({}));
  if (advanceSpreadThePain) {
    await advanceSpreadThePain(game, game.pendingSpreadThePain, ctx);
  }
}

/**
 * Wanton Destruction (Saw Gerrera): "after any friendly attack resolves,
 * discard 1 CC → up to 2 figures (not defender) within 2 of target
 * suffer 1 Damage." Army-wide trigger gated on Saw being alive on the
 * board + player having ≥1 CC in hand. The existing handleWantonUse /
 * CcPick / Pick / Done / Skip flow doesn't call finishCombatResolution,
 * so no fromStep8Queue bypass is needed.
 */
async function fireWantonDestruction(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !combat.target?.figureKey || !game.selectedMap?.id) return;
  const atkPN = combat.attackerPlayerNum;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(atkPN);
  const dcList = getDcList(game, atkPN) || [];
  const effects = getDcEffects?.() || {};
  let sawDc = null;
  for (const dc of dcList) {
    if (!dc || dc.defeated) continue;
    const eff = effects[dc.dcName];
    if (!((eff?.specialAbilityIds || []).includes('wanton_destruction_saw'))) continue;
    const figs = game.figurePositions?.[atkPN] || {};
    const alive = Object.keys(figs).some((fk) => fk.startsWith(dc.dcName + '-') && figs[fk]);
    if (alive) { sawDc = dc; break; }
  }
  if (!sawDc) return;
  if ((getCcHand(game, atkPN) || []).length === 0) return;
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey] || combat._blastTargetCoord;
  if (!targetPos) return;
  const eligible = [];
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!pos || fk === combat.target.figureKey) continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      const { label } = getFigureLabel(game, pn, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      eligible.push({ figureKey: fk, playerNum: pn, label });
    }
  }
  if (eligible.length === 0) return;
  const ownerId = getPlayerId(game, atkPN);
  setPendingWantonDestruction(game, {
    gameId: game.gameId,
    ownerPlayerNum: atkPN,
    combatThreadId: combat.combatThreadId,
    targets: eligible,
    chosen: [],
    maxPicks: 2,
  });
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Wanton Destruction** — **${sawDc.dcName}**: Discard 1 CC to deal 1 Damage to up to 2 figures within 2 spaces of the target?`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wanton_use_${game.gameId}`).setLabel('Use (discard 1 CC)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`wanton_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    )],
  })).catch(discordCatch);
}

// ── DEFENDER-SIDE FIRE HANDLERS ─────────────────────────────────────────────

/**
 * Furious Charge (CC, defender side): defender becomes Focused on the
 * attack that triggered the threshold. Damage threshold is gate at
 * enqueue time; this handler just applies + clears the queued state.
 */
async function fireFuriousCharge(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  const fk = combat.target?.figureKey;
  if (!fk) return;
  if (game.conditionalFocusIfDamagedGte) game.conditionalFocusIfDamagedGte = null;
  if (isConditionImmune(game, fk)) return;
  if (applyCondition(game, fk, 'Focus') && logGameAction) {
    await logGameAction(game, client, `**Furious Charge** — **${combat.target.label || dcNameFromFigureKey(fk)}** is now **Focused** (suffered ${combat._step7Damage || 0} Damage).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
}

/**
 * Force Deflection (Yoda CC): attacker suffers Damage = number of
 * attack dice rolled. Eligibility (Yoda is target OR adjacent to
 * friendly REBEL target) verified here at fire time. Limit once per
 * round, tracked by figureKey_force_deflection key.
 */
async function fireForceDeflection(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps, findDcMessageIdForFigure } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetFk = combat.target?.figureKey;
  if (!targetFk) return;
  const targetDcName = dcNameFromFigureKey(targetFk);
  const targetEff = getDcEffect(targetDcName);
  const targetIsYoda = (targetEff?.specialAbilityIds || []).includes('force_deflection_yoda');
  let yodaFigKey = null;
  if (targetIsYoda) {
    yodaFigKey = targetFk;
  } else if ((targetEff?.affiliation || '') === 'Rebel') {
    const friendly = game.figurePositions?.[defPN] || {};
    const targetCoord = friendly[targetFk];
    if (targetCoord) {
      for (const [fk, pos] of Object.entries(friendly)) {
        if (fk === targetFk) continue;
        const dcN = dcNameFromFigureKey(fk);
        const e = getDcEffect(dcN);
        if (!(e?.specialAbilityIds || []).includes('force_deflection_yoda')) continue;
        if (isWithinN(pos, targetCoord, 1, game.selectedMap?.id)) { yodaFigKey = fk; break; }
      }
    }
  }
  if (!yodaFigKey) return;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  const fdKey = `${yodaFigKey}_force_deflection`;
  if (game.roundFigureAbilityUsed[fdKey]) return;
  game.roundFigureAbilityUsed[fdKey] = true;
  const diceCount = combat.attackDiceResults?.length || 0;
  if (diceCount === 0) return;
  const atkFigIdx = combat.attackerFigureIndex ?? 0;
  const { newHp, prevHp, wasDefeated } = await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: combat.attackerFigureKey, msgId: combat.attackerMsgId, figIndex: atkFigIdx,
    amount: diceCount, controllerPlayerNum: combat.attackerPlayerNum,
    source: 'Force Deflection', combat,
  });
  if (prevHp <= 0) return;
  const yodaDcName = dcNameFromFigureKey(yodaFigKey);
  if (logGameAction) {
    await logGameAction(game, client, `🔵 **Force Deflection** — **${yodaDcName}** deflects! **${combat.attackerDcName}** suffers **${diceCount} Damage** (${diceCount} attack dice rolled). HP: ${prevHp} → ${newHp}.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  if (wasDefeated) {
    const dcIds = getDcMessageIds(game, combat.attackerPlayerNum) || [];
    const dcIdx = dcIds.indexOf(combat.attackerMsgId);
    await processFigureDefeat(game, {
      defeatedPlayerNum: combat.attackerPlayerNum,
      figureKey: combat.attackerFigureKey,
      attackerPlayerNum: defPN,
      attackerFigureKey: targetFk,
      msgId: combat.attackerMsgId,
      dcIdx,
      dcName: combat.attackerDcName,
      source: 'Force Deflection',
    }, { ...(deps || {}), client });
  }
}

/**
 * Distracting Fire (Rebel Pathfinder Elite): per card text
 * "if the attack did not miss, you may force the defender's group to go
 * next." Force-activation effect (NO damage). Reuses the
 * forceVisionNextActivation mechanism (Kanan), which gates the
 * opponent's next group activation against a named DC. Hit-gated.
 *
 * The trigger DC is the attacker (Pathfinder Elite); the group forced
 * is the defender's group (combat.target's DC name).
 */
async function fireDistractingFire(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  if (!combat._step7Hit) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetDcName = combat.target?.figureKey ? dcNameFromFigureKey(combat.target.figureKey) : null;
  if (!targetDcName) return;
  game.forceVisionNextActivation = { playerNum: defPN, dcName: targetDcName };
  if (logGameAction) {
    await logGameAction(game, client, `🎯 **Distracting Fire** — **${combat.attackerDcName}** forces **${targetDcName}**'s group to activate next, if able.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
}

/**
 * Deflection (CC, defender): attacker suffers N damage. Hit-gated;
 * legacy variant requires defender took 0 damage; unconditional variant
 * always fires. Pulls amount from game.deflectionPending[defenderPN].
 */
async function fireDeflection(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps } = ctx;
  if (!combat.attackerMsgId) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const deflectDmg = game.deflectionPending?.[defPN];
  if (!deflectDmg || deflectDmg <= 0) return;
  delete game.deflectionPending[defPN];
  if (game.deflectionUnconditional?.[defPN]) delete game.deflectionUnconditional[defPN];
  const atkFigIdx = combat.attackerFigureIndex ?? 0;
  await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: combat.attackerFigureKey, msgId: combat.attackerMsgId, figIndex: atkFigIdx,
    amount: deflectDmg, controllerPlayerNum: combat.attackerPlayerNum,
    source: 'Deflection', combat,
  });
  if (logGameAction) {
    const ownerId = getPlayerId(game, defPN);
    await logGameAction(game, client, `<@${ownerId}> **Deflection** — Attacker suffers **${deflectDmg} Damage**.`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
}

/**
 * Deflect (Luke Skywalker JK + variants): ranged-only. Defender (or
 * adjacent friendly with the ability) chooses 1 hostile in LOS, that
 * hostile suffers 1 damage. If only one hostile in LOS, auto-applies.
 */
async function fireDeflect(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps, ButtonBuilder, ButtonStyle, ActionRowBuilder, getMapData, findDcMessageIdForFigure } = ctx;
  if (!combat.isRanged || !combat.target?.figureKey || !game.selectedMap?.id || !thread) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const atkPN = combat.attackerPlayerNum;
  const ms = getMapData?.(game.selectedMap.id);
  const allFp = getAllFigureFootprints(game, getFigureSize);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const candidates = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
    if (!pos) continue;
    const dName = dcNameFromFigureKey(fk);
    const e = getDcEffect(dName);
    if (!(e?.specialAbilityIds || []).includes('deflect')) continue;
    const isSelf = fk === combat.target.figureKey;
    const isAdj = !isSelf && isWithinN(pos, targetPos, 1, game.selectedMap.id);
    if (!isSelf && !isAdj) continue;
    candidates.push({ figureKey: fk, dcName: dName });
  }
  for (const cand of candidates) {
    const candFp = getFigureFootprint(game, defPN, cand.figureKey, getFigureSize);
    const hostiles = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[atkPN] || {})) {
      if (!pos) continue;
      const candFpA = getFigureFootprint(game, atkPN, fk, getFigureSize);
      if (!hasFigureLineOfSight(candFp, candFpA, ms, allFp)) continue;
      const { label } = getFigureLabel(game, atkPN, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      hostiles.push({ figureKey: fk, playerNum: atkPN, label });
    }
    if (hostiles.length === 0) continue;
    if (hostiles.length === 1) {
      const tgt = hostiles[0];
      const tgtMsgId = findDcMessageIdForFigure?.(game.gameId, tgt.playerNum, tgt.figureKey);
      if (tgtMsgId) {
        const { figureIndex } = parseFigureKey(tgt.figureKey);
        await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
          figureKey: tgt.figureKey, msgId: tgtMsgId, figIndex: figureIndex,
          amount: 1, controllerPlayerNum: tgt.playerNum,
          source: 'Deflect (Luke)', combat,
        });
      }
      await thread.send(`**Deflect** — **${cand.dcName}**: **${tgt.label}** suffers 1 Damage.`).catch(discordCatch);
      if (logGameAction) {
        await logGameAction(game, client, `**Deflect** — **${cand.dcName}** redirects 1 Damage to **${tgt.label}**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
      }
    } else {
      setPendingDeflect(game, {
        gameId: game.gameId,
        deflectorPlayerNum: defPN,
        deflectorFigureKey: cand.figureKey,
        deflectorDcName: cand.dcName,
        combatThreadId: combat.combatThreadId,
        hostiles,
      });
      const ownerId = getPlayerId(game, defPN);
      const btns = hostiles.slice(0, 4).map((t, i) =>
        new ButtonBuilder().setCustomId(`deflect_pick_${game.gameId}_${i}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger));
      btns.push(new ButtonBuilder().setCustomId(`deflect_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send(sanitizeMentions({
        content: `<@${ownerId}> **Deflect** — **${cand.dcName}** may redirect 1 Damage to a hostile in LOS:`,
        allowedMentions: { users: [ownerId] },
        components: [new ActionRowBuilder().addComponents(btns)],
      })).catch(discordCatch);
    }
    break; // Only one Deflect trigger per attack
  }
}

/**
 * Return Fire (Han Solo / Migs Mayfeld): defender's CHAIN ATTACK on
 * the original attacker. Per user 2026-05-09, this resolves BEFORE any
 * attacker chain attack — staged on combat._pendingDefenderChainAttacks
 * which _finishCombatResolution iterates first.
 *
 * Han's variant requires defender took 0 damage UNLESS they have the
 * Rogue Smuggler upgrade. Both variants block on Stun (CRR p.58 — a
 * stunned figure can't declare an attack); YWNDM-Fifth-Brother
 * suppression bypasses the Stun gate.
 */
async function fireReturnFire(thread, game, combat, effect, ctx) {
  const { logGameAction, client, findDcMessageIdForFigure } = ctx;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const fk = combat.target?.figureKey;
  if (!fk) return;
  const dcN = dcNameFromFigureKey(fk);
  const eff = getDcEffect(dcN);
  const ids = eff?.specialAbilityIds || [];
  const hasReturnFire = ids.includes('return_fire') || ids.includes('return_fire_migs');
  if (!hasReturnFire) return;
  if (!game.figurePositions?.[defPN]?.[fk]) return;
  const rfKey = `returnFire_${fk}`;
  if (game.roundFigureAbilityUsed?.[rfKey]) return;
  // Han Solo variant: requires 0 damage taken unless Rogue Smuggler upgrade.
  let canFire = true;
  if (ids.includes('return_fire') && !ids.includes('return_fire_migs')) {
    const damage = combat._appliedDamage ?? combat._step7Damage ?? 0;
    const defMsgId = findDcMessageIdForFigure?.(game.gameId, defPN, fk);
    const upgrades = defMsgId ? (game.p1DcAttachments?.[defMsgId] || game.p2DcAttachments?.[defMsgId] || []) : [];
    if (damage > 0 && !cardNameIncludes(upgrades, 'Rogue Smuggler')) canFire = false;
  }
  // Stun blocks declaration (CRR p.58) unless YWNDM-Fifth-Brother suppression.
  const conds = game.figureConditions?.[fk] || [];
  const { areConditionEffectsSuppressed } = await import('../game/conditions.js');
  const suppressed = areConditionEffectsSuppressed(game, fk);
  if (canFire && conds.includes('Stun') && !suppressed) {
    canFire = false;
    if (logGameAction) {
      await logGameAction(game, client, `**Return Fire** suppressed — **${dcN}** is Stunned and cannot declare an attack.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
  }
  if (!canFire) return;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[rfKey] = true;
  const defMsgId = findDcMessageIdForFigure?.(game.gameId, defPN, fk);
  if (!defMsgId) return;
  const ownerId = getPlayerId(game, defPN);
  const label = ids.includes('return_fire_migs') ? 'Return Fire (Migs)' : 'Return Fire';
  // Stage on the DEFENDER chain queue — runs first in _finishCombatResolution.
  combat._pendingDefenderChainAttacks = combat._pendingDefenderChainAttacks || [];
  combat._pendingDefenderChainAttacks.push({
    source: label,
    msgId: defMsgId,
    figureKey: fk,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    forcedTargetMsgId: combat.attackerMsgId,
    forcedTargetFigureKey: combat.attackerFigureKey,
    message: `<@${ownerId}> **${label}** — Interrupt: perform a free attack targeting **${combat.attackerDcName}**! Use the **Attack** button on your DC card.`,
  });
}

/**
 * Effect dispatcher. Adds an entry here as each effect type's fire
 * handler lands.
 */
/**
 * Fire a condition-met after_resolve gate ability when its button is clicked
 * (alexanbv 2026-06-16). Previously `gate_ability` fell through to the default
 * no-op, so every CC/figure-ability button in the post-resolve window silently
 * dropped its click. Now: a Command Card routes through the playCC pipeline
 * (validate → comms-jammer → opponent-cancel → execute → dispose); a figure
 * ability with no executable resolver yet stays a diagnostic no-op (logged).
 */
async function fireGateAbility(thread, game, combat, effect, ctx) {
  const reg = getCombatAbility(effect?.payload?.abilityId);
  const side = effect?.side === 'defender' ? 'defender' : 'attacker';
  if (reg?.params?.kind === 'cc') {
    const pn = side === 'attacker'
      ? combat.attackerPlayerNum
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const fig = side === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
    const res = await playCC(game, pn, fig, reg.params.card, { ctx });
    if (thread) {
      if (!res.ok) await thread.send(`⚠️ Can't play ${reg.params.card}: ${res.reason}`).catch(discordCatch);
      else if (res.cancelled) await thread.send(`**${reg.params.card}** was cancelled (${res.cancelled}).`).catch(discordCatch);
      else await thread.send(`**${reg.params.card}** played.`).catch(discordCatch);
    }
    if (res.ok && !res.cancelled && res.result) {
      await applyAbilityResult(res.result, { game, playerNum: pn, msgId: side === 'attacker' ? combat.attackerMsgId : undefined, client: ctx.client, ctx });
    }
    return;
  }
  // Figure ability with no executable resolver yet → diagnostic no-op.
  console.warn(`[after-attack-fire] gate_ability "${reg?.name || effect?.payload?.abilityId}" has no executable resolver; skipping`);
}

export async function fireEffect(thread, game, combat, effect, ctx) {
  switch (effect.type) {
    case 'gate_ability':
      await fireGateAbility(thread, game, combat, effect, ctx);
      return;
    case 'recover':
      await fireRecover(thread, game, combat, effect, ctx);
      return;
    case 'slippery':
      await fireSlippery(thread, game, combat, effect, ctx);
      return;
    case 'leg_hydraulics':
      await fireLegHydraulics(thread, game, combat, effect, ctx);
      return;
    case 'fly_by':
      await fireFlyBy(thread, game, combat, effect, ctx);
      return;
    case 'jets':
      await fireJets(thread, game, combat, effect, ctx);
      return;
    case 'locked_and_loaded':
      await fireLockedAndLoaded(thread, game, combat, effect, ctx);
      return;
    case 'open_minded':
      await fireOpenMinded(thread, game, combat, effect, ctx);
      return;
    case 'stalk_prey':
      await fireStalkPrey(thread, game, combat, effect, ctx);
      return;
    case 'stun_batons':
      await fireStunBatons(thread, game, combat, effect, ctx);
      return;
    case 'vaders_finest_move':
      await fireVadersFinestMove(thread, game, combat, effect, ctx);
      return;
    case 'cleave':
      await fireCleave(thread, game, combat, effect, ctx);
      return;
    case 'blast':
      await fireBlast(thread, game, combat, effect, ctx);
      return;
    case 'condition':
      await fireCondition(thread, game, combat, effect, ctx);
      return;
    case 'burst_fire':
      await fireBurstFire(thread, game, combat, effect, ctx);
      return;
    case 'crippling_blow':
      await fireCripplingBlow(thread, game, combat, effect, ctx);
      return;
    case 'disruptor_rifle':
      await fireDisruptorRifle(thread, game, combat, effect, ctx);
      return;
    case 'electro_pulse':
      await fireElectroPulse(thread, game, combat, effect, ctx);
      return;
    case 'quick_strike':
      await fireQuickStrike(thread, game, combat, effect, ctx);
      return;
    case 'tonfa_strike':
      await fireTonfaStrike(thread, game, combat, effect, ctx);
      return;
    case 'barrage':
      await fireBarrage(thread, game, combat, effect, ctx);
      return;
    case 'flurry_of_blows':
      await fireFlurryOfBlows(thread, game, combat, effect, ctx);
      return;
    case 'fell_swoop':
      await fireFellSwoop(thread, game, combat, effect, ctx);
      return;
    case 'bladestorm':
      await fireBladestorm(thread, game, combat, effect, ctx);
      return;
    case 'shrapnel_splash':
      await fireShrapnelSplash(thread, game, combat, effect, ctx);
      return;
    case 'sidewinder':
      await fireSidewinder(thread, game, combat, effect, ctx);
      return;
    case 'boltslinger':
      await fireBoltslinger(thread, game, combat, effect, ctx);
      return;
    case 'indiscriminate_fire':
      await fireIndiscriminateFire(thread, game, combat, effect, ctx);
      return;
    case 'heavy_fire':
      await fireHeavyFire(thread, game, combat, effect, ctx);
      return;
    case 'havoc_shot':
      await fireHavocShot(thread, game, combat, effect, ctx);
      return;
    case 'concussive_bolt':
      await fireConcussiveBolt(thread, game, combat, effect, ctx);
      return;
    case 'fighting_knife':
      await fireFightingKnife(thread, game, combat, effect, ctx);
      return;
    case 'spread_the_pain':
      await fireSpreadThePain(thread, game, combat, effect, ctx);
      return;
    case 'wanton_destruction':
      await fireWantonDestruction(thread, game, combat, effect, ctx);
      return;
    case 'distracting_fire':
      await fireDistractingFire(thread, game, combat, effect, ctx);
      return;
    case 'furious_charge':
      await fireFuriousCharge(thread, game, combat, effect, ctx);
      return;
    case 'force_deflection':
      await fireForceDeflection(thread, game, combat, effect, ctx);
      return;
    case 'deflection':
      await fireDeflection(thread, game, combat, effect, ctx);
      return;
    case 'deflect':
      await fireDeflect(thread, game, combat, effect, ctx);
      return;
    case 'return_fire':
      await fireReturnFire(thread, game, combat, effect, ctx);
      return;
    // 'blast', 'cleave', 'condition', and per-DC types land in
    // follow-up commits. For now they fall through; the inline
    // applicator in combat-bridge.js still handles them.
    default:
      // Unknown / not-yet-wired type — log and drop. The effect was
      // already consumed from the queue by the caller.
      console.warn(`[after-attack-fire] effect type "${effect.type}" not yet wired; skipping`);
      return;
  }
}
