/**
 * Combat orchestrator functions extracted from index.js.
 * Each function receives an explicit `deps` object carrying closed-over values.
 */

import { processFigureDefeat } from './defeat-handler.js';
import { applyStrain as _applyStrain, triggerBleedAfterAction as _triggerBleedAfterAction } from '../handlers/strain-handler.js';
import { setupPendingMoveX as _setupPendingMoveX } from '../handlers/move-x-handler.js';
import { cardNameIncludes } from '../game/card-names.js';
import { resolvePendingCombat } from '../game/combat-stack.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { fetchCombatThread, fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { getHandChannelId, getPlayerId as _getPlayerIdHelper, getDcList } from '../game/player-helpers.js';
import { discordCatch as _discordCatchH } from '../error-handling.js';

import { getDcEffect } from '../game/dc-helpers.js';
/**
 * Send a "you have N reaction card(s) playable now" notice to the player's
 * private Hand channel. Mirrors src/handlers/combat.js — combat thread is
 * shared, hand channel is private; opponent must not see card availability.
 *
 * Hidden-info audit (slice 6.13 ext / destruct 2026-05-05): this prompt is
 * gated on count > 0 (player must actually have a relevant card). That's
 * SAFE because the prompt goes to the player's PRIVATE hand channel — the
 * opponent cannot observe its presence/absence. Combat-thread prompts
 * elsewhere (sendModsYn, sendTokenWindow, sendRerollUI, sendCombatGate)
 * are timing-driven and ALWAYS fire regardless of hand contents, so they're
 * hidden-info safe too. Together this satisfies destruct's rule:
 * "even if a player has no cards with on declare or modifier abilities, the
 * opponent doesn't know that. Thus, each stage needs to ask anything for
 * this stage, for each player, in order."
 */
async function _sendPrivateReactionPrompt(client, game, playerNum, count, contextLabel) {
  if (!count || count <= 0) return;
  const handId = getHandChannelId(game, playerNum);
  if (!handId) return;
  try {
    const handCh = await fetchGameChannel(client, handId);
    const ownerId = _getPlayerIdHelper(game, playerNum);
    const ctx = contextLabel ? ` (${contextLabel})` : '';
    await handCh.send(sanitizeMentions({
      content: `<@${ownerId}> — You have **${count}** reaction card(s) playable now${ctx}. Check your hand below.`,
      allowedMentions: { users: [ownerId] },
    })).catch(_discordCatchH);
  } catch (err) {
    console.error('_sendPrivateReactionPrompt: hand channel unreachable', err?.message ?? err);
  }
}
import { countGameSpaces } from '../game/board-helpers.js';
import { getLoadoutCards as _getLoadoutCardsImpl } from '../data-loader.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import {
  enqueueAttackerStep8Effects as _enqueueAttackerStep8Effects,
  postPostResolveWindow as _postPostResolveWindow,
} from '../handlers/after-attack-resolve.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { setPendingCelebration, setPendingCleave, clearPendingCleave, setPendingCoverFire, setPendingBoltslinger, setPendingHeavyFire, setPendingLastResort, setPendingWantonDestruction, setPendingHavocShot, setPendingFightingKnife, setPendingSpreadThePain, setPendingPunishingStrike, setPendingDeflect, setPendingExtraProtection, setPendingReaction, setPendingIndiscriminateFire, setPendingConcussiveBolt, setPendingFigurehead, setPendingSuppressiveFireMp, setPendingAssassinsBlade, setPendingSelfDestruct, setPendingMastery, setPendingMilitaryEfficiency, setPendingInterrogate, setPendingExecutorInterrupt } from '../game/interrupts.js';

/**
 * Apply NPC (thug / Krykna / non-player-card) damage to a figure.
 * Handles HP reduction, defeat, VP award, and game log.
 */
export async function applyNpcDamageToFigure(game, playerNum, figureKey, damage, sourceLabel, deps) {
  const { logGameAction, client, dcHealthState, dcMessageMeta,
    dcNameFromFigureKey, parseFigureKey,
    opponentPlayerNum, getDcMessageIds, getDcList } = deps;

  const dcName = dcNameFromFigureKey(figureKey);
  const { dgIndex, figureIndex } = parseFigureKey(figureKey);

  // Locate the DC message for this figure
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    if (meta.dcName !== dcName) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const metaDg = dn ? String(dn[1]) : '1';
    if (metaDg === String(dgIndex)) { msgId = mid; break; }
  }

  if (msgId) {
    // destruct 2026-05-08: route through centralized damage pipeline.
    const { newHp, wasDefeated } = await _applyDamage(game, {
      dcHealthState, logGameAction, client, deps,
    }, {
      figureKey,
      msgId,
      figIndex: figureIndex,
      amount: damage,
      controllerPlayerNum: playerNum,
      source: sourceLabel,
    });
    const maxHp = dcHealthState.get(msgId)?.[figureIndex]?.[1] ?? 0;
    if (dcHealthState.get(msgId)?.[figureIndex]) {
      if (wasDefeated) {
        const oppPN = opponentPlayerNum(playerNum);
        const dcIds = getDcMessageIds(game, playerNum);
        const dcIdx = (dcIds || []).indexOf(msgId);
        await processFigureDefeat(game, {
          defeatedPlayerNum: playerNum,
          figureKey,
          attackerPlayerNum: oppPN,
          msgId,
          dcIdx,
          dcName,
          displayName: dcName,
          source: sourceLabel,
        }, deps);
      } else {
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (${newHp}/${maxHp} HP remaining).`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  } else {
    await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (HP not found in memory — update DC card manually).`, { phase: 'ROUND', icon: 'attack' });
  }
}

/**
 * Apply direct (non-combat) damage to a figure (reactions, post-combat effects, etc.).
 * Handles HP reduction, death, VP award to the opponent, and thread logging.
 */
export async function applyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, client, thread, sourceName, deps) {
  const { dcHealthState, dcNameFromFigureKey, discordCatch,
    getDcMessageIds, getDcList, opponentPlayerNum } = deps;

  if (!msgId) return;
  const figMatch = figKey.match(/-\d+-(\d+)$/);
  const figIdx = figMatch ? parseInt(figMatch[1], 10) : 0;
  // destruct 2026-05-08: route through the centralized damage pipeline
  // so when-damaged / before-defeated / when-defeated hooks fire
  // uniformly regardless of damage source. processFigureDefeat is
  // still called below since pipeline registries don't yet include
  // the existing post-defeat orchestration (slice 2b migration in
  // progress — registries populate as inline checks move out).
  const { applyDamage } = await import('../game/damage-pipeline.js');
  const { wasDefeated } = await applyDamage(game, {
    dcHealthState,
    logGameAction: deps.logGameAction,
    client,
    deps,
  }, {
    figureKey: figKey,
    msgId,
    figIndex: figIdx,
    amount: damage,
    controllerPlayerNum: playerNum,
    source: sourceName,
  });
  const figName = dcNameFromFigureKey(figKey);
  if (thread) await thread.send(`**${sourceName}** — ${figName} suffers **${damage} Damage**.`).catch(discordCatch);
  const dcIds = getDcMessageIds(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  if (wasDefeated && idx >= 0) {
    const oppPN = opponentPlayerNum(playerNum);
    const dcList = getDcList(game, playerNum);
    await processFigureDefeat(game, {
      defeatedPlayerNum: playerNum,
      figureKey: figKey,
      attackerPlayerNum: oppPN,
      msgId,
      dcIdx: idx,
      dcName: dcList[idx]?.dcName,
      displayName: figName,
      source: sourceName,
    }, deps);
    if (thread) await thread.send(`**${sourceName}** — ${figName} was **defeated**!`).catch(discordCatch);
  }
}

/**
 * Send a Bleeding damage prompt to the given channel.
 * Offers "Take 1 damage" or "Prevent (discard CC)".
 */
export async function sendBleedingPrompt(game, channel, figureKey, playerNum, displayName, deps) {
  const { ccDeckKey, ButtonBuilder, ButtonStyle, ActionRowBuilder, discordCatch } = deps;

  const deckKey = ccDeckKey(playerNum);
  const deckCount = (game[deckKey] || []).length;
  const acceptBtn = new ButtonBuilder()
    .setCustomId(`bleed_accept_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel('Take 1 damage')
    .setStyle(ButtonStyle.Danger);
  const preventBtn = new ButtonBuilder()
    .setCustomId(`bleed_prevent_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel(`Prevent (discard CC, ${deckCount} left)`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(deckCount === 0);
  const row = new ActionRowBuilder().addComponents(acceptBtn, preventBtn);
  await channel.send({
    content: `\u{1FA78} **Bleeding** — **${displayName}** suffers 1 damage after resolving their action. Take damage or discard top CC to prevent?`,
    components: [row],
  }).catch(discordCatch);
}

/**
 * Resolve combat after rolls (and optional surge).
 * Applies damage, VP, updates embeds/board, clears pendingCombat.
 */
export async function resolveCombatAfterRolls(game, combat, client, deps) {
  const {
    logGameAction, dcNameFromFigureKey, parseFigureKey, opponentPlayerNum,
    getDcEffects, getDcEffect, getMapData, computeCombatResult,
    getBoardStateForMovement, getEffectiveFigureSize, getFootprintCells, normalizeCoord,
    getPlayerId, findDcMessageIdForFigure, findFigureheadFigure,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    applyDamageAndFinishCombat: _applyDamageAndFinishCombat,
    discordCatch,
  } = deps;
  // Combat-pipeline rebuild (slice 3.7-3.8): rolls completed before this fn,
  // reroll + modifier + surge phases happened in handlers. By the time
  // resolveCombatAfterRolls runs, currentStep should already be 'zillo-window'
  // (set in pre_resolve dispatch). Walk through the final engine-driven steps:
  // zillo-window → step6 → step7 → step8 → resolved. The step6/step7/step8
  // transitions are coarse — actual damage calc and post-attack effects span
  // step7+step8. Telemetry reads these as the high-water-mark step.
  if (combat.currentStep === 'roll') combat.currentStep = 'step3-attacker';
  if (combat.currentStep === 'step5') combat.currentStep = 'zillo-window';
  // Engine advances zillo-window → step6 (accuracy) → step7 (damage). Marked
  // here at function entry; finer-grained transitions are slice 6+ work.
  if (combat.currentStep === 'zillo-window') combat.currentStep = 'step6';

  // Two scope variants:
  //   nextAttacksBonusHits[figureKey] — per-figure (Size Advantage,
  //     Maximum Firepower).
  //   groupNextAttacksBonusHits[playerNum] — group-activation scope
  //     (Beatdown). Per IACP "your group's activation" applies to any
  //     friendly figure's attack during the activating group's cycle.
  // Per-figure consumed first when both present; group bonus applies
  // to any subsequent attack from any of the player's figures.
  {
    const pendingFig = game.nextAttacksBonusHits?.[combat.attackerFigureKey];
    if (pendingFig && pendingFig.count > 0 && pendingFig.bonus > 0) {
      combat.bonusHits = (combat.bonusHits || 0) + pendingFig.bonus;
      pendingFig.count -= 1;
      if (pendingFig.count <= 0) delete game.nextAttacksBonusHits[combat.attackerFigureKey];
    } else {
      const pendingGrp = game.groupNextAttacksBonusHits?.[combat.attackerPlayerNum];
      if (pendingGrp && pendingGrp.count > 0 && pendingGrp.bonus > 0) {
        combat.bonusHits = (combat.bonusHits || 0) + pendingGrp.bonus;
        pendingGrp.count -= 1;
        if (pendingGrp.count <= 0) delete game.groupNextAttacksBonusHits[combat.attackerPlayerNum];
      }
    }
  }
  {
    const condFig = game.nextAttacksBonusConditions?.[combat.attackerFigureKey];
    if (condFig && condFig.count > 0 && condFig.conditions?.length) {
      combat.bonusConditions = combat.bonusConditions || [];
      combat.bonusConditions.push(...condFig.conditions);
      condFig.count -= 1;
      if (condFig.count <= 0) delete game.nextAttacksBonusConditions[combat.attackerFigureKey];
    } else {
      const condGrp = game.groupNextAttacksBonusConditions?.[combat.attackerPlayerNum];
      if (condGrp && condGrp.count > 0 && condGrp.conditions?.length) {
        combat.bonusConditions = combat.bonusConditions || [];
        combat.bonusConditions.push(...condGrp.conditions);
        condGrp.count -= 1;
        if (condGrp.count <= 0) delete game.groupNextAttacksBonusConditions[combat.attackerPlayerNum];
      }
    }
  }
  const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
  // Snapshot target position before damage resolution can remove it (used by Heavy Fire, etc.)
  if (combat.target?.figureKey && !combat._savedTargetPos) {
    combat._savedTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey] || null;
  }
  const roundBlock = game.roundDefenseBonusBlock?.[defenderPlayerNum] || 0;
  const roundEvade = game.roundDefenseBonusEvade?.[defenderPlayerNum] || 0;
  if (roundBlock) combat.bonusBlock = (combat.bonusBlock || 0) + roundBlock;
  if (roundEvade) combat.bonusEvade = (combat.bonusEvade || 0) + roundEvade;
  const roundAccPenalty = game.roundDefenseAccuracyPenalty?.[defenderPlayerNum] || 0;
  if (roundAccPenalty) combat.defenderAccuracyPenalty = (combat.defenderAccuracyPenalty || 0) + roundAccPenalty;
  // Choose a Side (SCUM): +1 Block only for defenders with MOBILE keyword
  const mobileBlock = game.roundMobileDefenseBonusBlock?.[defenderPlayerNum] || 0;
  if (mobileBlock && combat.target?.figureKey) {
    const _defDcName = dcNameFromFigureKey(combat.target.figureKey);
    const _defKws = (getDcEffects()?.[_defDcName]?.keywords || []).map((k) => String(k).toUpperCase());
    if (_defKws.includes('MOBILE')) combat.bonusBlock = (combat.bonusBlock || 0) + mobileBlock;
  }
  const perEvade = game.roundDefenderBonusBlockPerEvade?.[defenderPlayerNum] || 0;
  if (perEvade && combat.defenseRoll) combat.bonusBlock = (combat.bonusBlock || 0) + (combat.defenseRoll.evade || 0) * perEvade;
  // Inside Job (Hoth Battle Station A): persistent defenseModifierByZone.
  // Defender in own zone: +ownZone.blockBonus (negative on this card → −1).
  // Defender in opponent's zone: +opponentZone.evadeBonus (+1).
  // Per destruct 2026-05-07: must apply during defense resolution.
  if (combat.target?.figureKey && !combat.insideJobApplied) {
    const _ijMapId = game.selectedMap?.id;
    const _ijVariant = game?.selectedMission?.variant;
    if (_ijMapId && _ijVariant) {
      const { getMissionFlag, getDeploymentZones } = await import('../data-loader.js');
      const _ijRule = getMissionFlag(_ijMapId, _ijVariant, 'defenseModifierByZone');
      if (_ijRule && (typeof _ijRule.ownZone === 'object' || typeof _ijRule.opponentZone === 'object')) {
        const _ijZones = getDeploymentZones()?.[_ijMapId] || {};
        const _ijDefPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
        if (_ijDefPos) {
          const _ijCoord = String(_ijDefPos).toLowerCase();
          const _ijRedSet = new Set((_ijZones.red || []).map((c) => normalizeCoord(c)));
          const _ijBlueSet = new Set((_ijZones.blue || []).map((c) => normalizeCoord(c)));
          // Determine defender's own zone color.
          const { getInitiativePlayerNum } = await import('../game/player-helpers.js');
          const _ijInitPn = getInitiativePlayerNum(game);
          const _ijDefZoneColor = defenderPlayerNum === _ijInitPn
            ? game.deploymentZoneChosen
            : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
          const _ijDefOwnSet = _ijDefZoneColor === 'red' ? _ijRedSet : _ijBlueSet;
          const _ijDefOppSet = _ijDefZoneColor === 'red' ? _ijBlueSet : _ijRedSet;
          if (_ijDefOwnSet.has(_ijCoord) && typeof _ijRule.ownZone?.blockBonus === 'number') {
            combat.bonusBlock = (combat.bonusBlock || 0) + _ijRule.ownZone.blockBonus;
            combat.insideJobApplied = true;
            await logGameAction(game, client, `🏫 **Inside Job** — **${combat.target.label}** defending in own deployment zone: ${_ijRule.ownZone.blockBonus > 0 ? '+' : ''}${_ijRule.ownZone.blockBonus} Block.`, { phase: 'ROUND', icon: 'attack' });
          } else if (_ijDefOppSet.has(_ijCoord) && typeof _ijRule.opponentZone?.evadeBonus === 'number') {
            combat.bonusEvade = (combat.bonusEvade || 0) + _ijRule.opponentZone.evadeBonus;
            combat.insideJobApplied = true;
            await logGameAction(game, client, `🏫 **Inside Job** — **${combat.target.label}** defending in opponent's deployment zone: ${_ijRule.opponentZone.evadeBonus > 0 ? '+' : ''}${_ijRule.opponentZone.evadeBonus} Evade.`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
    }
  }
  // Harsh Environment: exterior spaces -1 Evade; interior spaces +1 Block (applied once per combat resolution)
  if (game.harshEnvironmentActive && !combat.harshEnvApplied) {
    const _heMapId = game.selectedMap?.id;
    const _heMsData = _heMapId ? getMapData(_heMapId) : null;
    const _heFigKey = combat.target?.figureKey;
    const _hePos = _heFigKey ? (game.figurePositions?.[defenderPlayerNum]?.[_heFigKey]) : null;
    if (_heMsData && _hePos) {
      combat.harshEnvApplied = true;
      const _heExterior = !!_heMsData.exterior?.[_hePos];
      if (_heExterior) {
        combat.bonusEvade = (combat.bonusEvade || 0) - 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on exterior space: \u22121 Evade.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        combat.bonusBlock = (combat.bonusBlock || 0) + 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on interior space: +1 Block.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Cavalry Charge: round TROOPER attack hit bonus
  const trooperHitBonus = game.roundTrooperAttackHitBonus?.[combat.attackerPlayerNum] || 0;
  if (trooperHitBonus) {
    const attackerEff = getDcEffect(combat.attackerDcName);
    const attackerKws = (attackerEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (attackerKws.includes('TROOPER')) combat.bonusHits = (combat.bonusHits || 0) + trooperHitBonus;
  }
  // Query (HK-47): if +1 Hit was applied but defender became Bleeding from surges, remove the bonus
  if (combat.queryBonusHitApplied && (combat.surgeConditions || []).includes('Bleed')) {
    combat.bonusHits = Math.max(0, (combat.bonusHits || 0) - 1);
    combat.queryBonusHitApplied = false;
    await logGameAction(game, client, '**Query** — +1 Hit removed (defender became Bleeding).', { phase: 'ROUND', icon: 'attack' });
  }
  // Line of Fire (Anchorhead B) crateBlockSink prompt is now wired
  // at the modifier step inside src/handlers/combat.js proceedAfterRerolls
  // (defender chooses 0-3 damage → +N Block via combat_passive_<gid>_cbs_N).
  // Per destruct 2026-05-08.
  // Experimental Weapons (Development Facility B): a carrier of a
  // weapon prototype applies weaponPrototypeCarrierBlockPenalty (−1
  // Block) to defense results. Per destruct 2026-05-08. Stacks with
  // other defense modifiers; runs once per attack.
  if (!combat.weaponPrototypePenaltyApplied && combat.target?.figureKey) {
    const _wpRule = game?.selectedMission?.rules?.persistent?.weaponPrototypeCarrierBlockPenalty;
    if (typeof _wpRule === 'number' && game.figureContraband?.[combat.target.figureKey]) {
      combat.bonusBlock = (combat.bonusBlock || 0) + _wpRule;
      combat.weaponPrototypePenaltyApplied = true;
      await logGameAction(game, client, `🔫 **Experimental Weapons** — **${combat.target.label}** carries a weapon prototype: ${_wpRule > 0 ? '+' : ''}${_wpRule} Block to defense.`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  let { hit, damage, resultText } = computeCombatResult(combat);
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  const attackerPlayerNum = combat.attackerPlayerNum;
  // Store target + adjacent spaces for Reduce to Rubble (only when attack hit)
  if (hit && game.selectedMap?.id) {
    const targetCoord = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetCoord) {
      const board = getBoardStateForMovement(game, null);
      if (board?.adjacency) {
        const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const targetSize = getEffectiveFigureSize(game, combat.target.figureKey, targetDcName);
        const targetCells = getFootprintCells(targetCoord, targetSize || '1x1').map((c) => normalizeCoord(c));
        const rubbleSet = new Set(targetCells);
        for (const c of targetCells) {
          for (const n of board.adjacency[c] || []) rubbleSet.add(normalizeCoord(n));
        }
        game.lastAttackTargetSpacesForRubble = [...rubbleSet];
        game.lastAttackAttackerPlayerNum = attackerPlayerNum;
      }
    }
  }
  const ownerId = getPlayerId(game, attackerPlayerNum);
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const { figureIndex: targetFigIndex } = parseFigureKey(combat.target.figureKey);

  // Figurehead (Murne Rin): before friendly figure suffers damage, may redirect to self (prevent 1)
  if (damage > 0 && hit) {
    const fhResult = findFigureheadFigure(game, defenderPlayerNum, combat.target.figureKey);
    if (fhResult) {
      const fhOwnerId = getPlayerId(game, defenderPlayerNum);
      const fhThread = await fetchCombatThread(client, combat.combatThreadId);
      setPendingFigurehead(game, {
        damage, hit, resultText, totalBlast,
        defenderPlayerNum, attackerPlayerNum, ownerId,
        targetMsgId, targetFigIndex,
        fhFigKey: fhResult.figureKey, fhMsgId: fhResult.msgId, fhFigIndex: fhResult.figIndex,
        fhLabel: fhResult.label,
      });
      await fhThread.send(sanitizeMentions({
        content: `<@${fhOwnerId}> — **Figurehead**: **${combat.target.label}** is about to suffer **${damage} damage**. Murne Rin suffers **${Math.max(0, damage - 1)} damage** instead (prevents 1)?`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`figurehead_use_${game.gameId}`).setLabel('Use Figurehead').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`figurehead_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
        allowedMentions: { users: [fhOwnerId] },
      }));
      return;
    }
  }
  // Combat-pipeline rebuild (slice 3.7-3.8): we're about to apply damage and
  // run after-attack-resolves effects. Advance currentStep through step7
  // (damage) and step8 (after attack resolves). _applyDamageAndFinishCombat
  // does both internally; marking at-entry gives the telemetry a useful
  // high-water-mark even if finer transitions land later.
  if (combat.currentStep === 'step6') combat.currentStep = 'step7';
  await _applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client);
  if (combat.currentStep === 'step7') combat.currentStep = 'step8';
}

/**
 * CRR-CLV-005: compute the per-attack Cleave-eligible target set for the
 * attacker's current combat. Melee: figures adjacent to attacker; Ranged:
 * figures within Accuracy + LOS of attacker. Always excludes the initial
 * attack target. Includes crates. Called from the initial Cleave prompt in
 * applyDamageAndFinishCombat and the sequential re-prompt in
 * handleCleaveTarget.
 */
export function computeCleaveEligibleTargets(game, combat, defenderPlayerNum, deps) {
  const {
    getFiguresAdjacentToCoord, getMapData, getEffectiveMapSpaces, isWithinN,
    hasFigureLineOfSight, getFigureFootprint, getFigureSize, getFigureLabel,
    getDcEffect: _getDcEffect, getLoadoutCards: _getLoadoutCards,
  } = deps;
  if (!game.selectedMap?.id) return [];
  const mapId = game.selectedMap.id;
  const attackerPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
  if (!attackerPos) return [];
  // Combat-pipeline rebuild (slice 6.7): per CRR + destruct 2026-05-05
  // "Reach applies to Cleave eligibility." Detect Reach on the attacker via
  // the same paths as the standard target-eligibility check (DC keywords,
  // DC passives, nextAttackReach flag, Electrostaff loadout passive). When
  // Reach is active for a melee attack, Cleave eligibility extends from
  // strict adjacency to "within 2 spaces + line of sight."
  let _attackerHasReach = false;
  if (!combat.isRanged && _getDcEffect) {
    const _atkDcName = combat.attackerDcName || '';
    const _atkEff = _getDcEffect(_atkDcName) || _getDcEffect(_atkDcName.replace(/\s*\[.*\]\s*$/, ''));
    const _atkKws = (_atkEff?.keywords || []).map((k) => String(k).toUpperCase());
    const _atkPassives = (_atkEff?.passives || []).map((p) => String(p).toUpperCase());
    let _loadoutHasReach = false;
    if (_getLoadoutCards) {
      const _loadoutChoice = game.combatPassiveConfig?.[combat.attackerFigureKey]?.loadout
        || game.figureConfig?.[combat.attackerFigureKey]?.loadout
        || combat.attackerLoadout;
      if (_loadoutChoice) {
        const _loadoutCard = _getLoadoutCards()[_loadoutChoice];
        if (_loadoutCard?.passive === 'Reach') _loadoutHasReach = true;
      }
    }
    // Fury of Kashyyyk: friendly WOOKIEES gain Reach. Per destruct
    // 2026-05-07. Detect via attacker's WOOKIEE keyword + presence of
    // the [Fury of Kashyyyk] attachment in the attacker's team's dcList.
    let _furyKashyyykReach = false;
    if (_atkKws.includes('WOOKIEE')) {
      const _fokDcList = getDcList(game, combat.attackerPlayerNum) || [];
      if (_fokDcList.some((dc) => dc?.dcName === '[Fury of Kashyyyk]')) {
        _furyKashyyykReach = true;
      }
    }
    _attackerHasReach =
      _atkKws.includes('REACH') ||
      _atkPassives.includes('REACH') ||
      !!game.nextAttackReach?.[combat.attackerFigureKey] ||
      _loadoutHasReach ||
      _furyKashyyykReach;
  }
  const targets = [];
  if (!combat.isRanged && !_attackerHasReach) {
    const adjToAttacker = getFiguresAdjacentToCoord(game, attackerPos, mapId, combat.attackerFigureKey);
    for (const c of adjToAttacker) {
      if (c.playerNum !== defenderPlayerNum) continue;
      if (c.figureKey === combat.target?.figureKey) continue;
      targets.push(c);
    }
    // Damageable-object cleave/attack targets (Slice 4): iterate
    // objectMeta for targetable entries. Replaces legacy cratePositions
    // loop. Adjacency check matches melee range (1 space).
    if (game.objectMeta) {
      const rawMs = getMapData(mapId);
      const adj = rawMs?.adjacency || {};
      const atkNorm = String(attackerPos).toLowerCase();
      const atkAdj = new Set((adj[atkNorm] || []).map((c) => String(c).toLowerCase()));
      atkAdj.add(atkNorm);
      for (const [objId, meta] of Object.entries(game.objectMeta)) {
        if (!meta?.targetable) continue;
        const hp = (game.objectHealth?.[objId] || [0])[0] ?? 0;
        if (hp <= 0) continue;
        const objPos = game.objectPositions?.[objId];
        if (!objPos) continue;
        if (!atkAdj.has(String(objPos).toLowerCase())) continue;
        const maxHp = (game.objectHealth?.[objId] || [0, 0])[1] ?? 0;
        const origCoord = objId.startsWith('crate-') ? objId.slice('crate-'.length) : null;
        targets.push({ figureKey: `crate_${origCoord || objId}`, playerNum: null, isCrate: true, crateOrigCoord: origCoord, crateCoord: objPos, objectId: objId, label: `${meta.name || objId} (${hp}/${maxHp} HP)` });
      }
    }
  } else if (!combat.isRanged && _attackerHasReach) {
    // Reach + melee: eligibility extends to 2 spaces + LOS (per CRR).
    const _reachRange = 2;
    const mapSpaces = getEffectiveMapSpaces(game, mapId);
    const attackerFp = getFigureFootprint(game, combat.attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
    for (const [fk, fCoord] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(attackerPos, fCoord, _reachRange, mapId)) continue;
      const candFp = getFigureFootprint(game, defenderPlayerNum, fk, getFigureSize);
      if (!hasFigureLineOfSight(attackerFp, candFp, mapSpaces, null)) continue;
      targets.push({ figureKey: fk, playerNum: defenderPlayerNum });
    }
    // Damageable-object targets within reach range (Slice 4).
    if (game.objectMeta) {
      for (const [objId, meta] of Object.entries(game.objectMeta)) {
        if (!meta?.targetable) continue;
        const hp = (game.objectHealth?.[objId] || [0])[0] ?? 0;
        if (hp <= 0) continue;
        const objPos = game.objectPositions?.[objId];
        if (!objPos) continue;
        if (!isWithinN(attackerPos, String(objPos).toLowerCase(), _reachRange, mapId)) continue;
        const maxHp = (game.objectHealth?.[objId] || [0, 0])[1] ?? 0;
        const origCoord = objId.startsWith('crate-') ? objId.slice('crate-'.length) : null;
        targets.push({ figureKey: `crate_${origCoord || objId}`, playerNum: null, isCrate: true, crateOrigCoord: origCoord, crateCoord: objPos, objectId: objId, label: `${meta.name || objId} (${hp}/${maxHp} HP)` });
      }
    }
  } else {
    const totalAcc = (combat.attackRoll?.acc || 0) + (combat.surgeAccuracy || 0) + (combat.bonusAccuracy || 0);
    const mapSpaces = getEffectiveMapSpaces(game, mapId);
    const attackerFp = getFigureFootprint(game, combat.attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
    for (const [fk, fCoord] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(attackerPos, fCoord, totalAcc, mapId)) continue;
      const candFp = getFigureFootprint(game, defenderPlayerNum, fk, getFigureSize);
      if (!hasFigureLineOfSight(attackerFp, candFp, mapSpaces, null)) continue;
      targets.push({ figureKey: fk, playerNum: defenderPlayerNum });
    }
    // Damageable-object targets within ranged accuracy (Slice 4).
    if (game.objectMeta) {
      for (const [objId, meta] of Object.entries(game.objectMeta)) {
        if (!meta?.targetable) continue;
        const hp = (game.objectHealth?.[objId] || [0])[0] ?? 0;
        if (hp <= 0) continue;
        const objPos = game.objectPositions?.[objId];
        if (!objPos) continue;
        if (!isWithinN(attackerPos, String(objPos).toLowerCase(), totalAcc, mapId)) continue;
        const maxHp = (game.objectHealth?.[objId] || [0, 0])[1] ?? 0;
        const origCoord = objId.startsWith('crate-') ? objId.slice('crate-'.length) : null;
        targets.push({ figureKey: `crate_${origCoord || objId}`, playerNum: null, isCrate: true, crateOrigCoord: origCoord, crateCoord: objPos, objectId: objId, label: `${meta.name || objId} (${hp}/${maxHp} HP)` });
      }
    }
  }
  return targets.map((c) => {
    if (c.isCrate) return c;
    const { label } = getFigureLabel(game, c.playerNum, c.figureKey, c.figureKey);
    return { figureKey: c.figureKey, playerNum: c.playerNum, label };
  });
}

/**
 * Apply damage, conditions, defeat logic, and finish combat resolution.
 * Called from resolveCombatAfterRolls and handleFigureheadDecision.
 */
export async function applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client, deps) {
  const {
    logGameAction, saveGames, dcHealthState, dcMessageMeta,
    dcNameFromFigureKey, parseFigureKey, opponentPlayerNum, discordCatch,
    healHp, removeFigurePosition,
    calculateKillVp, awardKillVp, awardObjectiveVp, vpKey,
    getDcList, getDcMessageIds, getDcStats, getDcEffects, getDcEffect, getDcKeywords,
    getPlayerId, getMapData, getEffectiveMapSpaces,
    isWithinN, hasLineOfSight,
    hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints,
    getFiguresAdjacentToTarget, getFiguresAdjacentToCoord, getFiguresOnOrAdjacentToSpace,
    getEffectiveFigureSize, getFootprintCells, getFigureSize,
    findDcMessageIdForFigure, lookupFigureDcIndex, getFigureLabel,
    getCcHand, getCcEffectsData, getCcEffect,
    ccHandKey, ccDiscardKey, ccDeckKey, ccAttachmentsKey,
    _applyCondition, filterCondition, isConditionImmune, HARMFUL_CONDITIONS,
    isDcUnique, getActivatedDcIndices,
    isDbConfigured, achievementsChannelId, checkAndGrantAchievements, checkAndPostAchievements, postAchievementNotification,
    checkNefariousGains, checkWinConditions, checkHuntDissent,
    checkFriendlyDefeatedPassiveRedraws,
    decrementActivationIfGroupDefeated, updateAttachmentMessageForDc,
    grantMovementBank, grantPowerTokens, getDiceData,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    getCelebrationButtons, getCleaveTargetButtons,
    applyNpcDamageToFigure: _applyNpcDamageToFigure,
    checkPostCombatSurges: _checkPostCombatSurges,
    finishCombatResolution: _finishCombatResolution,
    normalizeCoord,
  } = deps;

  const thread = await fetchCombatThread(client, combat.combatThreadId);
  const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
  // Store applied damage on combat object for post-combat checks (Return Fire, etc.)
  combat._appliedDamage = damage;
  // Store last attack metadata for post-attack CC effect handlers
  game.lastAttackAttackerMsgId = combat.attackerMsgId ?? null;
  game.lastAttackAttackerFigureIndex = combat.attackerFigureIndex ?? 0;
  game.lastAttackTargetFigureKey = combat.target?.figureKey ?? null;
  // Track that an attack was performed during this activation (for On a Diplomatic Mission, etc.)
  if (combat.attackerMsgId) {
    game.attackPerformedThisActivation = game.attackPerformedThisActivation || {};
    game.attackPerformedThisActivation[combat.attackerMsgId] = true;
  }

  // NPC target (thug / Krykna / Crate): apply damage directly, skip dcHealthState
  if (combat.target?.isNpc) {
    // Crate target (Devaron B) — Slices 3+5 (alexanbv 2026-05-10):
    // routes entirely through the unified object-damage pipeline.
    // applyDamageToObject handles HP decrement, splashOnDefeat (2 dmg
    // within 1), and the figure-damage adapter so when-damaged /
    // before-defeated / when-defeated hooks fire on splash-killed
    // figures. objectPositions owns crate location; objectHealth owns
    // HP. Legacy cratePositions has been removed.
    if (combat.target.npcType === 'crate') {
      const origCoord = combat.target.crateOrigCoord;
      const objectId = `crate-${origCoord}`;
      if (origCoord && damage > 0 && hit) {
        const { applyDamageToObject, makeFigureDamageAtAdapter } = await import('../game/object-damage-pipeline.js');
        const { awardObjectiveVp } = await import('../game/vp-helpers.js');
        const _crateCtx = {
          logGameAction, client,
          applyFigureDamageAt: makeFigureDamageAtAdapter(game, {
            logGameAction, client, dcHealthState, findDcMessageIdForFigure, deps, thread,
          }),
          awardObjectiveVp,
        };
        const res = await applyDamageToObject(game, _crateCtx, {
          objectId, amount: damage, attackerPlayerNum, source: 'Attack',
        });
        const curCoord = String(game.objectPositions?.[objectId] || origCoord).toUpperCase();
        if (res.defeated) {
          resultText += ` **Crate @ ${curCoord} destroyed! Figures within 1 suffered 2 Damage.**`;
          // applyDamageToObject already deleted objectPositions[objectId] on defeat.
          await checkWinConditions(game, client);
        } else {
          const newHp = res.newHp ?? 0;
          resultText += ` — Crate @ ${curCoord}: ${newHp}/5 HP remaining.`;
        }
      }
      // Wave 3: Blast from crate-target attack — apply to adjacent figures/objects
      const _crateBlastAmt = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
      if (_crateBlastAmt > 0 && hit && damage > 0 && game.selectedMap?.id) {
        const _crateBlastCoord = String(game.objectPositions?.[objectId] || origCoord).toLowerCase();
        const _crateBlastAdj = getFiguresAdjacentToCoord(game, _crateBlastCoord, game.selectedMap.id, null);
        for (const { figureKey: _cbFk, playerNum: _cbPn } of _crateBlastAdj) {
          const _cbMsgId = findDcMessageIdForFigure(game.gameId, _cbPn, _cbFk);
          if (!_cbMsgId) continue;
          const { figureIndex: _cbFigIdx } = parseFigureKey(_cbFk);
          const { newHp: _cbNewHp, wasDefeated: _cbDied } = await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
            figureKey: _cbFk, msgId: _cbMsgId, figIndex: _cbFigIdx,
            amount: _crateBlastAmt, controllerPlayerNum: _cbPn,
            attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
            source: 'Crate Blast', combat,
          });
          const _cbName = dcNameFromFigureKey(_cbFk);
          await logGameAction(game, client, `\u{1F4A5} **Blast ${_crateBlastAmt}** \u2014 **${_cbName}** suffers ${_crateBlastAmt} damage.`, { phase: 'ROUND', icon: 'attack' });
          if (_cbDied) {
            const { idx: _cbIdx } = lookupFigureDcIndex(game, _cbPn, _cbFk);
            const _cbDcName = dcNameFromFigureKey(_cbFk);
            await processFigureDefeat(game, {
              defeatedPlayerNum: _cbPn, figureKey: _cbFk,
              attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
              msgId: _cbMsgId, dcIdx: _cbIdx, dcName: _cbDcName, displayName: _cbName, source: 'Blast',
            }, { ...deps, client });
          }
        }
      }
      await thread.send({ content: resultText || '(No effect)', components: [] });
      resolvePendingCombat(game);
      saveGames(game.gameId);
      return;
    }
    // Thug / Krykna
    const npcArray = combat.target.npcType === 'thug' ? game.npcThugs : game.npcKrykna;
    const npc = npcArray?.[combat.target.npcIndex];
    if (npc && !npc.defeated) {
      if (damage > 0 && hit) {
        npc.hp = Math.max(0, npc.hp - damage);
        resultText += ` — ${combat.target.label}: ${npc.hp}/${npc.maxHp} HP remaining.`;
        if (npc.hp <= 0) {
          npc.defeated = true;
          awardObjectiveVp(game, attackerPlayerNum, 2);
          resultText += ` **${combat.target.label} defeated! +2 VP**`;
          // Krykna claim: track on game state for end-of-round deploy option
          if (combat.target.npcType === 'krykna') {
            game.claimedKrykna = game.claimedKrykna || { 1: 0, 2: 0 };
            game.claimedKrykna[attackerPlayerNum] = (game.claimedKrykna[attackerPlayerNum] || 0) + 1;
          }
          await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+2 VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          await checkWinConditions(game, client);
        }
        // Per destruct 2026-05-07: NPC FIGURES (Thug, Krykna) get
        // conditions like normal figures (CRR p.13 — only OBJECTS skip
        // conditions). Apply both BENEFICIAL (attacker-side) and HARMFUL
        // (target = NPC) conditions, gated on damage>0 same as normal
        // figure path. NPC condition state lives on
        // game.figureConditions keyed by the NPC figureKey
        // (npc_thug_N / npc_krykna_N).
        if (!npc.defeated) {
          const _npcConds = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
          for (const _nc of _npcConds) {
            const _isHarmful = HARMFUL_CONDITIONS.includes(_nc);
            const _recipientKey = _isHarmful ? combat.target.figureKey : combat.attackerFigureKey;
            if (_recipientKey) _applyCondition(game, _recipientKey, _nc);
          }
        }
      }
    }
    await thread.send({ content: resultText || '(No effect)', components: [] });
    resolvePendingCombat(game);
    saveGames(game.gameId);
    return;
  }

  // Track figures damaged by this group's activation (for Aim: Rebel Trooper Elite, etc.)
  if (damage > 0 && combat.attackerMsgId && combat.target?.figureKey) {
    game.activationDamagedFigures = game.activationDamagedFigures || {};
    game.activationDamagedFigures[combat.attackerMsgId] = game.activationDamagedFigures[combat.attackerMsgId] || [];
    if (!game.activationDamagedFigures[combat.attackerMsgId].includes(combat.target.figureKey)) {
      game.activationDamagedFigures[combat.attackerMsgId].push(combat.target.figureKey);
    }
  }

  // [COMBAT-TRACE] Selfplay diagnostic — log per-combat resolution details
  if (game.selfPlay) {
    const _ctDefHs = dcHealthState.get(targetMsgId);
    const _ctDefHp = _ctDefHs?.[targetFigIndex];
    const _ctPrevHp = Array.isArray(_ctDefHp) ? _ctDefHp[0] : '?';
    const _ctMaxHp = Array.isArray(_ctDefHp) ? _ctDefHp[1] : '?';
    const _ctRoll = combat.attackRoll || {};
    const _ctDef = combat.defenseRoll || {};
    console.log(`[COMBAT-TRACE] ${combat.attackerDcName} → ${targetDcName} | hit=${hit} dmg=${damage} | atk=[${_ctRoll.dmg}d,${_ctRoll.acc}a,${_ctRoll.surge}s] def=[${_ctDef.block}b,${_ctDef.evade}e,${_ctDef.dodge ? 'D' : '-'}] | surge_dmg=${combat.surgeDamage || 0} pierce=${(combat.surgePierce || 0) + (combat.bonusPierce || 0)} | hp=${_ctPrevHp}/${_ctMaxHp}→${hit ? Math.max(0, _ctPrevHp - damage) : _ctPrevHp} | defeated=${hit && _ctPrevHp > 0 && (_ctPrevHp - damage) <= 0 ? 'YES' : 'no'}`);
  }

  // Wave 3: Save target position + size before potential defeat. Blast / cleave-eligible
  // adjacency must use the FULL footprint of multi-cell targets (LARGE 2x2, MASSIVE 2x3),
  // not a single cell. Per CRR step 8: "If the main target is defeated, the figure is
  // removed before legitimate target spaces are calculated for these abilities" — so
  // adjacency uses target's pre-defeat footprint, with the target itself excluded.
  const _targetCoordBeforeDefeat = game.figurePositions?.[defenderPlayerNum]?.[combat.target?.figureKey];
  const _targetDcName = combat.target?.figureKey ? dcNameFromFigureKey(combat.target.figureKey) : null;
  const _targetSizeBeforeDefeat = combat.target?.figureKey
    ? (game.figureOrientations?.[combat.target.figureKey] || (_targetDcName ? getFigureSize(_targetDcName) : null))
    : null;

  let _fdNeedsEmbedRefresh = false;
  if (damage > 0 && targetMsgId) {
    // Extra Protection re-entry guard (alexanbv 2026-05-09): damage was
    // already applied in the first pass. Use a per-combat marker
    // (combat._damageApplied) instead of a global flag, so the signal
    // travels with the combat frame through nested-attack push/pop and
    // doesn't pollute later combats in the same round.
    const _epReentry = !!combat._damageApplied;
    let newCur;
    if (_epReentry) {
      const _epHpState = dcHealthState.get(targetMsgId)?.[targetFigIndex];
      newCur = Array.isArray(_epHpState) ? _epHpState[0] : 0;
    } else {
      // destruct 2026-05-08: step-7 main-target damage routes through
      // the centralized damage pipeline so when-suffers-damage,
      // before-defeated, and when-defeated hooks fire here uniformly
      // with Blast/Cleave/strain/NPC damage paths.
      const _mdResult = await _applyDamage(game, {
        dcHealthState, logGameAction, client, deps, thread,
      }, {
        figureKey: combat.target.figureKey,
        msgId: targetMsgId,
        figIndex: targetFigIndex,
        amount: damage,
        controllerPlayerNum: defenderPlayerNum,
        attackerPlayerNum,
        attackerFigureKey: combat.attackerFigureKey,
        source: 'Attack',
        combat,
      });
      newCur = _mdResult.newHp;
      // Mark damage applied on the combat frame so a subsequent re-entry
      // (handleExtraProtection → applyDamageAndFinishCombat) can detect
      // first-pass-already-ran and skip re-applying damage. Per-combat
      // marker, not a global flag — survives nested push/pop, doesn't
      // leak across attacks.
      combat._damageApplied = true;
      // BEFORE_DEFEATED hook (e.g. Parting Shot) may have deferred the
      // defeat. HP goes to 0 either way, but processFigureDefeat (the
      // post-defeat block below) must skip until completeDeferredDefeat
      // resumes. _defeatSuppressed mirrors the pipeline's preventDefeat
      // for downstream guards.
      if (_mdResult.preventDefeat) {
        combat._defeatSuppressed = true;
      }
      // Pause-on-WHEN_DAMAGED-interrupt (alexanbv 2026-05-09): Extra
      // Protection's WHEN_DAMAGED probe sets pendingExtraProtection +
      // posts the Play/Skip button. Without this bail, the pipeline
      // would continue past damage and reach finishCombatResolution
      // before the user has any chance to click — the EP window would
      // expire mid-pipeline. Bail here so the pipeline pauses; the
      // EP handler's applyDamageAndFinishCombat re-entry resumes
      // execution from this point on the next pass (combat._damageApplied
      // skips the damage step, pendingExtraProtection is null after
      // handler clears it, so the bail no-ops on re-entry).
      if (game.pendingExtraProtection?.combatRef === combat) {
        if (typeof saveGames === 'function') saveGames(game.gameId);
        return;
      }
    }
    // Combat-pipeline rebuild (slice 6.4): capture the defender's pre-condition
    // state BEFORE the Step 8 condition application block. Parting Shot is a
    // Step 7 interrupt that fires AFTER damage but BEFORE Step 8 surge-conditions
    // land. Per destruct Q2: "Stun is queued for Step 8 — not yet on HG when
    // Parting Shot triggers." Code-flow-wise the condition block runs before
    // the PS trigger, so we snapshot Stun-state-at-Step-7 here for the PS gate
    // to consult instead of the live (post-Step-8-conditions) condition list.
    const _step7DefenderConds = (game.figureConditions?.[combat.target.figureKey] || []).slice();
    combat._step7DefenderConds = _step7DefenderConds;
    if (dcHealthState.get(targetMsgId)?.[targetFigIndex]) {
      // Achievement: Devastator (10+ damage in a single attack)
      if (damage >= 10 && !_epReentry && isDbConfigured() && achievementsChannelId) {
        const _devUserId = getPlayerId(game, attackerPlayerNum);
        checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _devUserId, 'single_attack_damage', damage)
          .catch((err) => console.error('[Achievements] Devastator check failed:', err.message));
      }
      const dcMessageIds = getDcMessageIds(game, defenderPlayerNum);
      const dcList = getDcList(game, defenderPlayerNum);
      const idx = (dcMessageIds || []).indexOf(targetMsgId);
      // G22: Surge conditions (Bleed, Stun, Weaken, etc.) only apply when the attack deals damage.
      // This block is already inside `if (damage > 0 && targetMsgId)`, but we add an explicit
      // guard as defense-in-depth so conditions are never applied if damage is 0.
      // Also skip on Extra Protection re-entry since conditions were already applied.
      if (damage > 0 && !_epReentry) {
        // Conditions migrated 2026-05-09: every condition (surge / bonus /
        // passive) is queued as a step-8 attacker button rather than
        // auto-applied. fireCondition (after-attack-fire.js) handles
        // immunity, Fireproof, application, and Punishing Strike at click
        // time. Per destruct 2026-05-08: nothing auto in step 8.
        let allConditions = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
        const _passiveAttackerEff = getDcEffect(combat.attackerDcName);
        const _passiveAttackerCondNames = (_passiveAttackerEff?.passives || []).map((p) => String(p));
        for (const _passiveCondName of ['Bleed', 'Weaken']) {
          if (_passiveAttackerCondNames.includes(_passiveCondName) && !allConditions.includes(_passiveCondName)) {
            allConditions.push(_passiveCondName);
          }
        }
        // CRR p.13 (ATTACKING OBJECTS): conditions never apply to objects.
        // Skip them at queue time rather than enqueue + log "skipped" buttons.
        const _targetIsObject = combat.target?.isCrate || combat.target?.npcType === 'crate';
        if (_targetIsObject) {
          if (allConditions.length) {
            await logGameAction(game, client, `🪵 **Object target** — Conditions skipped (objects cannot have conditions per CRR).`, { phase: 'ROUND', icon: 'card' });
          }
          allConditions = [];
        }
        // Stash for fireCondition. Each entry carries the recipient class
        // (harmful → target, beneficial → attacker per CRR p.21). Immunity
        // and Fireproof are evaluated when the attacker clicks the button.
        combat._step8Conditions = allConditions.map((c) => ({
          condition: c,
          recipient: HARMFUL_CONDITIONS.includes(c) ? 'target' : 'attacker',
        }));
      }
      // Skip post-damage effects on Extra Protection re-entry — they already fired in the first pass.
      if (!_epReentry) {
      // Furious Charge inline disabled 2026-05-09 → fireFuriousCharge
      // (defender step-8 button).
      if (false && game.conditionalFocusIfDamagedGte?.playerNum === defenderPlayerNum && damage >= game.conditionalFocusIfDamagedGte.threshold) { // eslint-disable-line no-constant-condition
        if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
          await logGameAction(game, client, `**Furious Charge** — **${combat.target.label}** is now **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
        }
        game.conditionalFocusIfDamagedGte = null;
      }
      // Stun Batons inline disabled 2026-05-09 → fireStunBatons (already
      // wired in the dispatcher; enqueue probe lives in
      // enqueueAttackerPerDcEffects and routes through applyStrain so
      // Fireproof / Headhunter / when-damaged hooks fire uniformly).
      if (false && damage > 0) { // eslint-disable-line no-constant-condition
        const _sbAttDcName = combat.attackerDcName || '';
        const _sbAttEff = getDcEffects()?.[_sbAttDcName];
        if ((_sbAttEff?.passives || []).includes('Stun Batons')) {
          // Flame Trooper Fireproof: cannot suffer Strain
          const _sbTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
          if (cardNameIncludes(_sbTargetUpgrades, 'Flame Trooper')) {
            await logGameAction(game, client, `**Fireproof** — **${combat.target.label}** is immune to Strain from Stun Batons.`, { phase: 'ROUND', icon: 'card' });
          } else {
          game.figureConditions = game.figureConditions || {};
          game.figureConditions[combat.target.figureKey] = game.figureConditions[combat.target.figureKey] || [];
          // Strain = 1 direct HP damage. destruct 2026-05-08: route
          // through centralized damage pipeline (when-damaged hooks
          // fire here too).
          const _sbResult = await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
            figureKey: combat.target.figureKey,
            msgId: targetMsgId,
            figIndex: targetFigIndex,
            amount: 1,
            controllerPlayerNum: defenderPlayerNum,
            source: 'Stun Batons',
            viaStrain: true,
          });
          newCur = _sbResult.newHp;
          await logGameAction(game, client, `\u26A1 **Stun Batons** — **${combat.target.label}** suffers 1 Strain (1 HP damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Critical Hit moved 2026-05-09 to surge-spend phase
      // (handlers/combat.js — applies immediately when the surge is
      // chosen, per user clarification that it's a non-keyword surge).
      // Self-Preservation inline disabled 2026-05-09 — fires via the
      // self_preservation_hired_gun_elite WHEN_DAMAGED hook in
      // damage-pipeline-hooks.js (correct timing per user: when damage
      // is suffered, not after attack resolves). Inline was double-applying.
      if (false && newCur > 0) { // eslint-disable-line no-constant-condition
        const _spDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _spEff = getDcEffects()?.[_spDcName];
        if ((_spEff?.passives || []).includes('Self-Preservation')) {
          if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
            await logGameAction(game, client, `\u{1F6E1}\uFE0F **Self-Preservation** — **${_spDcName}** became **Focused** (suffered damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage, become Focused
      if (damage >= 3 && newCur > 0) {
        const _fokDefDcList = getDcList(game, defenderPlayerNum) || [];
        const _fokHasFury = _fokDefDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
        if (_fokHasFury) {
          const _fokTargetName = dcNameFromFigureKey(combat.target.figureKey);
          const _fokTargetKws = (getDcKeywords(game)[_fokTargetName] || []).map(k => String(k).toUpperCase());
          if (_fokTargetKws.includes('WOOKIEE')) {
            if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
              await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokTargetName}** became **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
      }
      } // end !_epReentry guard for post-damage effects
      // Guerrilla — handled below in the post-defeat block (line ~1270) via
      // specialAbilityIds. Earlier abilityText fuzzy-match removed 2026-05-06
      // after destruct's audit confirmed Alliance Ranger Regular needed its
      // own slug ('guerrilla_alliance_ranger_reg'); now both Reg and Elite go
      // through the slug-based check.
      // Sabine-Wren-Jets block REMOVED 2026-05-11 per alexanbv:
      // Sabine Wren does NOT have the Jets passive (her ability is
      // Special Action — Evasive Maneuver: move up to 2 spaces +
      // recover 2). The Jets passive block below already handles every
      // Jets-having DC data-driven, so this hardcoded duplicate was
      // both wrong (granted unearned MP to Sabine) and redundant.

      // Fly-By (Jet Trooper Elite): after attack, gain 2 MP if target was within 2 spaces
      {
        const _fbAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_fbAtkEff?.passives || []).includes('Fly-By') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _fbMsgId = combat.attackerMsgId;
          if (_fbMsgId) {
            grantMovementBank(game, _fbMsgId, 2);
            await logGameAction(game, client, `\u{1F680} **Fly-By** — **${combat.attackerDcName}** gains 2 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Jets (Jet Trooper Regular): after attack, gain 1 MP if target within 2 spaces
      {
        const _jtAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_jtAtkEff?.passives || []).includes('Jets') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _jtMsgId = combat.attackerMsgId;
          if (_jtMsgId) {
            grantMovementBank(game, _jtMsgId, 1);
            await logGameAction(game, client, `\u{1F680} **Jets** — **${combat.attackerDcName}** gains 1 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Leg Hydraulics (Tress Hacnua): handled via specialAbilityIds check below (not passives) to avoid double-granting
      // Locked and Loaded (Migs Mayfeld): after attack, gain 2 Power Tokens. Cap is 3.
      // Always grants the full 2 — if Migs is at 2 tokens, the standard
      // pendingPowerTokenOverflow path prompts the player to discard 1 by type.
      {
        const _llAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_llAtkEff?.passives || []).includes('Locked and Loaded')) {
          const _llFk = combat.attackerFigureKey;
          if (_llFk) {
            game.figurePowerTokens = game.figurePowerTokens || {};
            game.figurePowerTokens[_llFk] = game.figurePowerTokens[_llFk] || [];
            const _llCurrent = game.figurePowerTokens[_llFk].length;
            // Always grant 2 — overflow handled downstream via pendingPowerTokenOverflow.
            // Capping at "fill to 3" lost the player's choice over which existing token type to keep.
            game.pendingPowerTokenGrant = { grants: [{ figureKey: _llFk, figName: combat.attackerDcName, count: 2 }], channelId: combat.combatThreadId, playerNum: attackerPlayerNum };
            const _llBtns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
              new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
            );
            await thread.send({
              content: `\u{1F52B} **Locked and Loaded** — **${combat.attackerDcName}** gains 2 Power Tokens (${_llCurrent} \u2192 ${_llCurrent + 2}, max 3 — overflow will prompt for discard). Choose token type:`,
              components: [new ActionRowBuilder().addComponents(_llBtns)],
            }).catch(discordCatch);
          }
        }
      }
      // Open-Minded (Del Meeko): after attack, gain 1 MP or 1 Power Token (choice)
      {
        const _omAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_omAtkEff?.passives || []).includes('Open-Minded')) {
          const _omMsgId = combat.attackerMsgId;
          const _omFk = combat.attackerFigureKey;
          if (_omMsgId && _omFk) {
            const _omBtns = [
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_token`).setLabel('Gain 1 Power Token').setStyle(ButtonStyle.Secondary),
            ];
            await thread.send({
              content: `\u{1F9E0} **Open-Minded** — **${combat.attackerDcName}**: Choose one:`,
              components: [new ActionRowBuilder().addComponents(_omBtns)],
            }).catch(discordCatch);
          }
        }
      }
      // Nimble (Asajj Ventress) — REMOVED 2026-05-06 (Asajj removed from game
      // per destruct's 2026-05-05 ruling). Session 8.1-8.3 of combat-rebuild.
      if (false) { // eslint-disable-line no-constant-condition
        const _nimDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _nimEff = getDcEffects()?.[_nimDcName];
        if ((_nimEff?.specialAbilityIds || []).includes('nimble_asajj') && combat.defenseRoll) {
          const _nimTotalBlock = combat.defenseRoll.block || 0;
          if (_nimTotalBlock > 0) {
            const _nimMp = _nimTotalBlock * 2;
            const _nimMsgId = targetMsgId;
            if (_nimMsgId) {
              grantMovementBank(game, _nimMsgId, _nimMp);
            }
            await logGameAction(game, client, `\u{1F98E} **Nimble** — **${_nimDcName}** gained ${_nimMp} MP (${_nimTotalBlock} Block result${_nimTotalBlock !== 1 ? 's' : ''} \u00D7 2).`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
          }
        }
      }
      // Slippery — migrated to step-8 button window (slice 2b, destruct
      // 2026-05-08). Enqueue + fire handler live in
      // src/handlers/after-attack-{resolve,fire}.js. Defender clicks
      // the "Slippery: gain 2 MP" button in their post-resolve window.
      // Leg Hydraulics — migrated to step-8 button window (slice 2b,
      // destruct 2026-05-08). Enqueue + fire handler in
      // src/handlers/after-attack-{resolve,fire}.js. Note task #164:
      // current behavior is "gain 1 MP" but card text is actually
      // "MOVE 1 SPACE" — that fix lives separately and isn't gated on
      // this migration.
      // Loku Recon Token: Set Your Sights — moved to post-deploy
      // (handlers/post-deploy.js: scanPlayerPostDeployAbilities +
      // case 'set_your_sights'). Card text is "At the start of the
      // mission, place a Recon token on a unique hostile figure";
      // the prior after-attack placement was incorrect timing.
      // Force Deflection inline disabled 2026-05-09 → fireForceDeflection
      // (defender step-8 button).
      if (false) { // eslint-disable-line no-constant-condition
        const _fdDefDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _fdDefEff = getDcEffects()?.[_fdDefDcName];
        const _fdDefIsTarget = (_fdDefEff?.specialAbilityIds || []).includes('force_deflection_yoda');
        let _fdYodaFigKey = null;
        if (_fdDefIsTarget) {
          // Yoda is the defender — use Yoda's own figure key for round tracking
          _fdYodaFigKey = combat.target.figureKey;
        } else {
          // Check if any Yoda figure on defender's team is adjacent to the target space AND defender is REBEL
          const _fdDefAffil = _fdDefEff?.affiliation || '';
          if (_fdDefAffil === 'Rebel') {
            const _fdFriendlyFigs = game.figurePositions?.[defenderPlayerNum] || {};
            const _fdTargetCoord = _fdFriendlyFigs[combat.target.figureKey];
            if (_fdTargetCoord) {
              for (const [fk, fCoord] of Object.entries(_fdFriendlyFigs)) {
                if (fk === combat.target.figureKey) continue;
                const fDcName = dcNameFromFigureKey(fk);
                const fEff = getDcEffects()?.[fDcName];
                if (!(fEff?.specialAbilityIds || []).includes('force_deflection_yoda')) continue;
                // Check adjacency (within 1 space)
                if (isWithinN(fCoord, _fdTargetCoord, 1, game.selectedMap?.id)) {
                  _fdYodaFigKey = fk;
                  break;
                }
              }
            }
          }
        }
        if (_fdYodaFigKey) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          const _fdKey = `${_fdYodaFigKey}_force_deflection`;
          if (!game.roundFigureAbilityUsed[_fdKey]) {
            game.roundFigureAbilityUsed[_fdKey] = true;
            const _fdDiceCount = combat.attackDiceResults?.length || 0;
            if (_fdDiceCount > 0 && combat.attackerMsgId) {
              const _fdAtkFigIdx = combat.attackerFigureIndex ?? 0;
              const { newHp: _fdAtkNew, prevHp: _fdAtkPrev, wasDefeated: _fdAtkDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
                figureKey: combat.attackerFigureKey, msgId: combat.attackerMsgId, figIndex: _fdAtkFigIdx,
                amount: _fdDiceCount, controllerPlayerNum: attackerPlayerNum, source: 'Force Deflection', combat,
              });
              if (_fdAtkPrev > 0) {
                _fdNeedsEmbedRefresh = true;
                const _fdYodaDcName = dcNameFromFigureKey(_fdYodaFigKey);
                await logGameAction(game, client, `\u{1F535} **Force Deflection** — **${_fdYodaDcName}** deflects! **${combat.attackerDcName}** suffers **${_fdDiceCount} Damage** (${_fdDiceCount} attack dice rolled). HP: ${_fdAtkPrev} \u2192 ${_fdAtkNew}.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
                // Check if attacker was defeated by Force Deflection
                if (_fdAtkDefeated) {
                  const _fdAtkDcIds = getDcMessageIds(game, attackerPlayerNum);
                  const _fdAtkDcIdx = (_fdAtkDcIds || []).indexOf(combat.attackerMsgId);
                  await processFigureDefeat(game, {
                    defeatedPlayerNum: attackerPlayerNum,
                    figureKey: combat.attackerFigureKey,
                    attackerPlayerNum: defenderPlayerNum,
                    attackerFigureKey: combat.target.figureKey,
                    msgId: combat.attackerMsgId,
                    dcIdx: _fdAtkDcIdx,
                    dcName: combat.attackerDcName,
                    source: 'Force Deflection',
                  }, deps);
                }
              }
            }
          }
        }
      }
      // Distracting Fire inline disabled 2026-05-09 → fireDistractingFire
      // (attacker step-8 button per user 2026-05-09 categorization).
      if (false) { // eslint-disable-line no-constant-condition
        const _dfAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
        if (_dfAtkPos && combat.attackerMsgId && game.selectedMap?.id) {
          const _dfMapSp = getEffectiveMapSpaces(game, getMapData(game.selectedMap.id));
          // Scan the defender's side for alive Rebel Pathfinder figures
          const _dfFriendlyFigs = game.figurePositions?.[defenderPlayerNum] || {};
          const _dfAtkFp = getFigureFootprint(game, attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
          for (const [_dfFk, _dfPos] of Object.entries(_dfFriendlyFigs)) {
            const _dfDcName = dcNameFromFigureKey(_dfFk);
            const _dfEff = getDcEffects()?.[_dfDcName];
            if (!(_dfEff?.specialAbilityIds || []).includes('distracting_fire_rebel_pathfinder')) continue;
            // Check LOS from Pathfinder (full footprint) to attacker (full footprint)
            const _dfPathFp = getFigureFootprint(game, defenderPlayerNum, _dfFk, getFigureSize);
            if (!hasFigureLineOfSight(_dfPathFp, _dfAtkFp, _dfMapSp, null)) continue;
            // Deal 1 Damage to the attacker
            const _dfAtkFigIdx = combat.attackerFigureIndex ?? 0;
            const { newHp: _dfAtkNew, prevHp: _dfAtkPrev, wasDefeated: _dfAtkDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
              figureKey: combat.attackerFigureKey, msgId: combat.attackerMsgId, figIndex: _dfAtkFigIdx,
              amount: 1, controllerPlayerNum: attackerPlayerNum, source: 'Distracting Fire', combat,
            });
            if (_dfAtkPrev > 0) {
              _fdNeedsEmbedRefresh = true;
              await logGameAction(game, client, `**Distracting Fire** — **${_dfDcName}** has LOS to attacker **${combat.attackerDcName}**! Attacker suffers **1 Damage**. HP: ${_dfAtkPrev} \u2192 ${_dfAtkNew}.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
              if (_dfAtkDefeated) {
                const _dfAtkDcIds = getDcMessageIds(game, attackerPlayerNum);
                const _dfAtkDcIdx = (_dfAtkDcIds || []).indexOf(combat.attackerMsgId);
                await processFigureDefeat(game, {
                  defeatedPlayerNum: attackerPlayerNum,
                  figureKey: combat.attackerFigureKey,
                  attackerPlayerNum: defenderPlayerNum,
                  attackerFigureKey: combat.target.figureKey,
                  msgId: combat.attackerMsgId,
                  dcIdx: _dfAtkDcIdx,
                  dcName: combat.attackerDcName,
                  source: 'Distracting Fire',
                }, deps);
              }
            }
            break; // Only one Distracting Fire trigger per attack
          }
        }
      }
      // You Will Not Deny Me: prevent Fifth Brother from being defeated (restore HP to 1)
      //
      // Slice 5 audit (destruct 2026-05-06): destruct's model is "damage
      // capped at health, no Pierce overflow." Legacy approach heals back to
      // HP 1 on defeat. Both produce IDENTICAL combat outcomes because:
      //   - Within this attack: HP is now 1, downstream interrupts gate on
      //     newCur <= 0 and skip correctly. Defeat at line ~1158 also
      //     explicitly checks YWNDM-on-5th and skips processFigureDefeat.
      //   - Next attack 1 damage: reduceHp at line ~581 sees cur=1 → newCur=0,
      //     this YWNDM block fires AGAIN (flag persists), heals back to 1,
      //     defeat skipped.
      // The model-purist version (cur stays at 0, defeat suppressed) and the
      // legacy heal-to-1 produce the same behavior for normal combat damage.
      // The bug fixed in slice 5 was for NON-combat damage paths (Bleed,
      // AOE, strain) that don't reach this YWNDM block — those now route
      // through applyDamageWithDefeatCheck which consults isCannotBeDefeated
      // and suppresses defeat directly. Both code paths reach the same
      // outcome: 5th Brother does not defeat while YWNDM is active.
      // Slice 5 fix (destruct 2026-05-06): heal-to-1 is wrong because future
      // heal of N would put figure at 1+N HP (off-by-one too generous —
      // destruct's example: "Second Chance figure heals → has 3 HP not 2").
      // Per CRR + destruct: damage caps at health, defeat suppressed. cur
      // stays at 0; future heals reduce damage from health → cur = heal
      // amount. Set _defeatSuppressed flag so downstream interrupts skip.
      // Pipeline-level preventDefeat (e.g. Parting Shot) flows through
      // combat._defeatSuppressed already — pick it up so downstream
      // guards (Second Chance, SbR, Last Resort, Executor, processFigureDefeat)
      // skip when defeat is deferred.
      let _defeatSuppressed = !!combat._defeatSuppressed;
      // Self-Destruct Protocol — now handled by BEFORE_DEFEATED hook
      // (damage-pipeline-hooks.js + handlers/interrupts.js handleSelfDestructProtocol).
      // Parting Shot — now handled by BEFORE_DEFEATED hook
      // (damage-pipeline-hooks.js + handlers/parting-shot.js).
      // Last Resort — now handled by BEFORE_DEFEATED hook
      // (damage-pipeline-hooks.js + handlers/interrupts.js handleLastResort).
      // Executor (RGC) — now handled by BEFORE_DEFEATED hook
      // (damage-pipeline-hooks.js + handlers/interrupts.js handleExecutor).
      if (newCur <= 0 && !_defeatSuppressed) {
        // PRE-DEFEAT: Combat-specific context for CC timing validation (Of No Importance, etc.)
        game.lastDefeatInfo = { playerNum: defenderPlayerNum, figureKey: combat.target.figureKey, dcName: targetDcName };
        // CANONICAL DEFEAT CORE — handles: position removal, conditions, device tokens,
        // VP (including attachment VP), defeat log, activation decrement, CC attachment cleanup,
        // passive redraws, Nefarious Gains, Hunt Dissent, Heroic Effort, Scavenged Weaponry.
        // Win conditions skipped: combat-specific post-defeat effects may modify VP first.
        const { vp } = await processFigureDefeat(game, {
          defeatedPlayerNum: defenderPlayerNum,
          figureKey: combat.target.figureKey,
          attackerPlayerNum,
          attackerFigureKey: combat.attackerFigureKey,
          msgId: targetMsgId,
          dcIdx: idx,
          dcName: targetDcName,
          displayName: combat.target.label,
          skipWinConditions: true,
        }, { ...deps, client });
        const _vpK = vpKey(attackerPlayerNum);
        // Achievement: activation kill streak (Double Kill / Triple Kill / PENTAKILL)
        if (combat.attackerMsgId) {
          game.activationKills = game.activationKills || {};
          game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
          if (isDbConfigured() && achievementsChannelId) {
            const _akUserId = getPlayerId(game, attackerPlayerNum);
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId, 'activation_kills', game.activationKills[combat.attackerMsgId])
              .catch((err) => console.error('[Achievements] activation_kills check failed:', err.message));
          }
        }
        // Of No Importance: reduce VP gained when CC owner's own non-unique figure is defeated
        if (game.nextDefeatedFriendlyVpReduction?.playerNum === defenderPlayerNum) {
          const _noImportDcName = idx >= 0 ? dcList[idx]?.dcName : null;
          if (_noImportDcName && !isDcUnique(_noImportDcName)) {
            const _reduceAmt = game.nextDefeatedFriendlyVpReduction.amount || 0;
            const _reduced = Math.min(_reduceAmt, vp);
            game[_vpK].kills = Math.max(0, game[_vpK].kills - _reduced);
            game[_vpK].total = Math.max(0, game[_vpK].total - _reduced);
            resultText += ` (\u2212${_reduced} VP: Of No Importance)`;
            await logGameAction(game, client, `**Of No Importance** — VP reduced by ${_reduced}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.nextDefeatedFriendlyVpReduction = null;
        }
        // Price on Their Heads: award bounty VP to setter when target group is defeated
        const _priceBounty = game.priceBounties?.[combat.target.label];
        if (_priceBounty) {
          const _bountyAmt = typeof _priceBounty === 'object' ? _priceBounty.amount : _priceBounty;
          const _bountySetterNum = typeof _priceBounty === 'object' ? _priceBounty.playerNum : attackerPlayerNum;
          awardObjectiveVp(game, _bountySetterNum, _bountyAmt);
          delete game.priceBounties[combat.target.label];
          const _bountyVpK = vpKey(_bountySetterNum);
          await logGameAction(game, client, `**Price on Their Heads** — +${_bountyAmt} VP bounty awarded to P${_bountySetterNum} (${game[_bountyVpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // Paid in Beskar: grant Block tokens when hostile is defeated within range
        if (game.whenDefeatHostileWithin3GainBlockTokens) {
          const _beskarData = game.whenDefeatHostileWithin3GainBlockTokens;
          const _beskarDist = combat.distanceToTarget ?? 0;
          const _beskarRange = _beskarData.range ?? 3;
          if (_beskarDist <= _beskarRange) {
            const _beskarTokens = _beskarData.tokens ?? 1;
            const _beskarFigKey = combat.attackerFigureKey;
            grantPowerTokens(game, _beskarFigKey, 'Block', _beskarTokens);
            await logGameAction(game, client, `**Paid in Beskar** — +${_beskarTokens} Block Token${_beskarTokens !== 1 ? 's' : ''} granted to ${combat.attackerDisplayName}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.whenDefeatHostileWithin3GainBlockTokens = null;
        }
        // Worth Every Credit: bonus VP when hostile is defeated this activation
        if (game.nextHostileDefeatVpBonus?.[attackerPlayerNum]) {
          const _wecData = game.nextHostileDefeatVpBonus[attackerPlayerNum];
          const _wecAmt = typeof _wecData === 'object' ? (_wecData.amount ?? 2) : _wecData;
          awardObjectiveVp(game, attackerPlayerNum, _wecAmt);
          delete game.nextHostileDefeatVpBonus[attackerPlayerNum];
          await logGameAction(game, client, `**Worth Every Credit** — +${_wecAmt} bonus VP (${game[_vpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // You Will Not Deny Me: on any hostile defeat, Fifth Brother recovers 2 HP → card goes to game box
        if (game.youWillNotDenyMeActive) {
          const _ywndmData = game.youWillNotDenyMeActive;
          const _fifthKey = Object.keys(game.figurePositions?.[_ywndmData.playerNum] || {}).find(k => dcNameFromFigureKey(k).toLowerCase().includes('fifth brother'));
          if (_fifthKey) {
            const _fifthMsgId = (() => { for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _ywndmData.playerNum && mm.dcName?.toLowerCase().includes('fifth')) return mid; } return null; })();
            if (_fifthMsgId) {
              const { healed: _fifthHealed } = healHp(dcHealthState, game, _fifthMsgId, 0, 2, _ywndmData.playerNum);
              if (_fifthHealed > 0) {
                await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother recovered 2 HP after hostile defeat. Card returns to game box.`, { phase: 'ROUND', icon: 'card' });
              }
              game.youWillNotDenyMeActive = null;
              // Move card to game box
              game.gameBox = game.gameBox || [];
              game.gameBox.push('You Will Not Deny Me');
              // Per destruct 2026-05-07: when YWNDM falls off, if Fifth
              // Brother is still at 0 HP, he is immediately defeated.
              // The heal-by-2 above usually brings him to 2 HP; this
              // check is defensive for any other fall-off path.
              const _ywndmFifthHs = dcHealthState?.get(_fifthMsgId);
              const _ywndmEntry = Array.isArray(_ywndmFifthHs) ? _ywndmFifthHs[0] : null;
              const _ywndmCur = Array.isArray(_ywndmEntry) ? (_ywndmEntry[0] ?? _ywndmEntry[1] ?? 0) : 0;
              if (_ywndmCur <= 0 && deps && deps.processFigureDefeat) {
                await logGameAction(game, client, `\u{1F480} **You Will Not Deny Me** \u2014 fell off while **Fifth Brother** is at **0 HP**; defeated.`, { phase: 'ROUND', icon: 'attack' });
                await deps.processFigureDefeat(game, {
                  defeatedPlayerNum: _ywndmData.playerNum,
                  figureKey: _fifthKey,
                  attackerPlayerNum: attackerPlayerNum != null ? attackerPlayerNum : (_ywndmData.playerNum === 1 ? 2 : 1),
                  source: 'You Will Not Deny Me (fell off)',
                });
              }
            }
          }
        }
        // Guerrilla (Alliance Ranger Regular + Elite): "After you resolve an
        // attack, if the defender was defeated, become Hidden." Both slugs
        // share the same effect (destruct 2026-05-06 audit — Regular was
        // missing its slug; added 'guerrilla_alliance_ranger_reg' so both
        // figures route through one slug-based check here).
        if (combat.attackerFigureKey) {
          const _gAtkDcName = combat.attackerDcName;
          const _gAtkEff = getDcEffect(_gAtkDcName);
          const _gIds = _gAtkEff?.specialAbilityIds || [];
          if (_gIds.includes('guerrilla_alliance_ranger_elite') || _gIds.includes('guerrilla_alliance_ranger_reg')) {
            if (_applyCondition(game, combat.attackerFigureKey, 'Hide')) {
              await logGameAction(game, client, `🌑 **Guerrilla** — **${_gAtkDcName}** becomes **Hidden** (defeated the target).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Apex Predator — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Last Stand — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        const _lsDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        // Nefarious Gains — now handled by processFigureDefeat
        // Hunt Dissent — now handled by processFigureDefeat
        // Imperial Citadel — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // This is the Way (Armorer) — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Into the Force — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Vengeance / Forward Vengeance Focus — now handled by WHEN_DEFEATED
        // hook (damage-pipeline-hooks.js). The Forward-Vengeance Elite-only
        // optional 1-space move prompt remains here because the hook
        // framework doesn't have access to deps/thread for Discord buttons.
        {
          const _defPos = _targetCoordBeforeDefeat;
          if (_defPos) {
            const _defDcEff = getDcEffects()?.[_lsDcName];
            const _defKws = (_defDcEff?.keywords || []).map(k => k.toUpperCase());
            if (!_defKws.includes('GUARDIAN')) {
              const _ms = getMapData(game.selectedMap?.id);
              const _defAdj = (_ms?.adjacency?.[String(_defPos).toLowerCase()] || [])
                .map(a => String(a).toLowerCase());
              for (const [rgFk, rgPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
                if (!rgPos || rgFk === combat.target.figureKey) continue;
                if (!_defAdj.includes(String(rgPos).toLowerCase())) continue;
                if (dcNameFromFigureKey(rgFk) !== 'Royal Guard (Elite)') continue;
                if (!deps?.findDcMessageIdForFigure || !deps?.ButtonBuilder || !deps?.ButtonStyle || !deps?.ActionRowBuilder) continue;
                try {
                  const _fvMsgId = deps.findDcMessageIdForFigure(game.gameId, defenderPlayerNum, rgFk);
                  if (!_fvMsgId) continue;
                  // Move-X picker (1 space, bypassCosts true) — replaces
                  // the legacy grantMovementBank + granted_move button.
                  const { setupPendingMoveX } = await import('../handlers/move-x-handler.js');
                  await setupPendingMoveX(game, { client, logGameAction, saveGames: deps?.saveGames }, {
                    msgId: _fvMsgId,
                    figureKey: rgFk,
                    playerNum: defenderPlayerNum,
                    spaces: 1,
                    source: 'Forward Vengeance',
                    threadId: thread?.id || null,
                    bypassCosts: true,
                  });
                  await thread.send({
                    content: `⚔️ **Forward Vengeance** — **Royal Guard (Elite)** may move **1 space** (picker posted).`,
                  }).catch(() => {});
                } catch {}
              }
            }
          }
        }
        // Bounty — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Brutal Tactics — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Useful Hide — now handled by WHEN_DEFEATED hook (damage-pipeline-hooks.js).
        // Passive Redraws, defeat log, activation decrement, CC attachment cleanup — now handled by processFigureDefeat
        resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
        // Clean up pending sub-states referencing this DC (prevents orphaned states after defeat)
        if (targetMsgId) {
          if (game.pendingDcAbilityChoice) {
            for (const k of Object.keys(game.pendingDcAbilityChoice)) {
              if (k.startsWith(`${targetMsgId}_`)) delete game.pendingDcAbilityChoice[k];
            }
            if (Object.keys(game.pendingDcAbilityChoice).length === 0) delete game.pendingDcAbilityChoice;
          }
          if (game.pendingPounceSpaceChoice?.[targetMsgId]) {
            delete game.pendingPounceSpaceChoice[targetMsgId];
            if (Object.keys(game.pendingPounceSpaceChoice).length === 0) delete game.pendingPounceSpaceChoice;
          }
        }
        await checkWinConditions(game, client);
        // Celebration auto-prompt — now handled by WHEN_DEFEATED hook
        // (damage-pipeline-hooks.js). Hook fires from any defeat source.
        // Auto-prompt for defeat-triggered reaction cards
        try {
          const ccCards = getCcEffectsData?.()?.cards || {};
          const _defeatTimings = new Set([
            'whenHostileFigureDefeatedNotYourActivation',
            'whenHostileFigureWithin3SpacesDefeated',
            'afterUniqueHostileDefeated',
          ]);
          const _ownDefeatTimings = new Set([
            'whenOneOfYourFiguresDefeated',
          ]);
          // Notify attacker about hostile-defeat reactions in hand
          const atkHand = getCcHand(game, attackerPlayerNum) || [];
          const atkDefeatCards = [...new Set(atkHand)].filter(c => ccCards[c]?.timing && _defeatTimings.has(ccCards[c].timing));
          if (atkDefeatCards.length) {
            await _sendPrivateReactionPrompt(client, game, attackerPlayerNum, atkDefeatCards.length, 'hostile defeated');
          }
          // Notify defender about own-figure-defeat reactions in hand
          const defId = getPlayerId(game, defenderPlayerNum);
          const defHand = getCcHand(game, defenderPlayerNum) || [];
          const defDefeatCards = [...new Set(defHand)].filter(c => ccCards[c]?.timing && _ownDefeatTimings.has(ccCards[c].timing));
          if (defDefeatCards.length) {
            await _sendPrivateReactionPrompt(client, game, defenderPlayerNum, defDefeatCards.length, 'your figure was defeated');
          }
        } catch (_defeatPromptErr) {
          console.error('Defeat reaction prompt error:', _defeatPromptErr?.message ?? _defeatPromptErr);
        }
      }
    }
    if (combat.superchargeStrainAfterAttackCount > 0 && combat.attackerMsgId != null) {
      // Supercharge / Sustained by Rage post-attack strain: route through
      // the canonical applyStrain pipeline (Fireproof / Headhunter /
      // per-strain choice / Under Duress / Paz).
      await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
        figureKey: combat.attackerFigureKey,
        controllerPlayerNum: combat.attackerPlayerNum,
        amount: combat.superchargeStrainAfterAttackCount || 0,
        source: 'Supercharge',
      });
    }
    // The Darksaber: convert Blast X → Cleave X during Darksaber Strike attack
    // (before blast queues). Stays inline because the conversion mutates the
    // surgeBlast/surgeCleave inputs that enqueueAttackerStep8Effects reads.
    if (combat.darksaberBlastToCleave && (combat.surgeBlast || 0) > 0) {
      const _dsCv = combat.surgeBlast;
      combat.surgeCleave = (combat.surgeCleave || 0) + _dsCv;
      (combat.cleaveSources = combat.cleaveSources || []).push({ value: _dsCv, label: `Cleave ${_dsCv} (Darksaber Blast→Cleave)` });
      const _dsConvertedBlast = combat.surgeBlast;
      combat.surgeBlast = 0;
      await logGameAction(game, client, `**The Darksaber** — Blast ${_dsConvertedBlast} converted to Cleave ${_dsConvertedBlast}.`, { phase: 'ROUND', icon: 'card' });
    }
    // Stash context fireBlast (after-attack-fire.js) reads when the attacker
    // clicks the step-8 Blast button. Per CRR step 8 the splash uses the
    // target's pre-defeat footprint, so we capture coord + size here while
    // the target is still on the board (snapshot earlier in this fn). The
    // Flame Trooper friendly-skip rule needs the attacker's upgrades too.
    const _ftAtkUpgradesBlast = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
    combat._blastTargetCoord = _targetCoordBeforeDefeat;
    combat._blastTargetSize = _targetSizeBeforeDefeat;
    combat._blastFireproofFriendly = _ftAtkUpgradesBlast.includes('Flame Trooper');
    let effectiveBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
    // Blast splash fully migrated to step-8 fireBlast handler (2026-05-09)
    // and the object-damage pipeline (Slice 2, 2026-05-10). The legacy
    // inline `if (false &&` block was removed Slice 3 (2026-05-10).
    void effectiveBlast;
  } else if (hit && damage === 0) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — blocked`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (!hit) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — miss`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (damage > 0) {
    await logGameAction(game, client, `<@${ownerId}> dealt **${damage}** damage to **${combat.target.label}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  }
  // Recover keyword (CRR step 8) — destruct 2026-05-08: every step-8
  // effect prompts the attacker via the post-resolve window rather
  // than firing automatically. Sustained by Rage blocks own Recover —
  // gate that here BEFORE enqueueing so the button doesn't appear
  // for blocked figures. The button is rendered + fired by
  // src/handlers/after-attack-resolve.js.
  const _sbrBlockRecover = getDcEffects()?.[combat.attackerDcName]?.specialAbilityIds?.includes('sustained_by_rage');
  if (_sbrBlockRecover) combat.surgeRecover = 0;
  // Stash step-7 hit/damage on combat so enqueueAttackerStep8Effects
  // can gate keyword effects (Blast, Cleave, Recover) consistently.
  combat._step7Hit = hit;
  combat._step7Damage = damage;
  // Discard consumed conditions post-combat. Then re-apply any conditions
  // granted via surge: focus / surge: hide AFTER the discard, per destruct
  // 2026-05-07 ("hidden is discarded, and then reacquired"). Same logic
  // applies to Focus.
  if (combat.attackerFigureKey) {
    const _hadFocus = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Focus');
    filterCondition(game, combat.attackerFigureKey, 'Focus');  // Focus consumed after attacking
    if (_hadFocus) await logGameAction(game, client, `\u{1F3AF} **Focus** consumed on **${combat.attackerDcName}** \u2014 used in this attack.`, { phase: 'ROUND', icon: 'attack' });
    const _atkHidden = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Hide');
    filterCondition(game, combat.attackerFigureKey, 'Hide');   // Attacker loses Hidden after resolving an attack
    if (_atkHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.attackerDcName}** \u2014 resolved an attack.`, { phase: 'ROUND', icon: 'attack' });
    // Re-apply deferred surge conditions AFTER the discard (so the figure
    // ends the attack with the surge-granted condition rather than having
    // it stripped by the unconditional discard).
    if (combat.deferredSurgeFocus) {
      _applyCondition(game, combat.attackerFigureKey, 'Focus');
      await logGameAction(game, client, `\u{1F3AF} **Focus** applied via Surge to **${combat.attackerDcName}** (post-discard).`, { phase: 'ROUND', icon: 'attack' });
      combat.deferredSurgeFocus = false;
    }
    if (combat.deferredSurgeHide) {
      _applyCondition(game, combat.attackerFigureKey, 'Hide');
      await logGameAction(game, client, `\uD83D\uDC7B **Hidden** applied via Surge to **${combat.attackerDcName}** (post-discard).`, { phase: 'ROUND', icon: 'attack' });
      combat.deferredSurgeHide = false;
    }
  }
  if (combat.target?.figureKey) {
    const _defHidden = (game.figureConditions?.[combat.target.figureKey] || []).includes('Hide');
    filterCondition(game, combat.target.figureKey, 'Hide');    // Defender loses Hidden after being attacked
    if (_defHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.target.label}** \u2014 was targeted by an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  // Burst Fire / Crippling Blow / Disruptor Rifle / Electro-pulse /
  // Quick Strike all migrated 2026-05-09 to step-8 fire handlers
  // (after-attack-fire.js). Legacy inline blocks disabled below.
  if (false && game.burstFirePendingMsgId?.[combat.attackerMsgId]) { // eslint-disable-line no-constant-condition
    const _bfPending = game.burstFirePendingMsgId[combat.attackerMsgId];
    delete game.burstFirePendingMsgId[combat.attackerMsgId];
    if (damage > 0 && combat.target?.figureKey) {
      const _bfMapId = game.selectedMap?.id;
      const _bfMs = _bfMapId ? getMapData(_bfMapId) : null;
      const _bfTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_bfMs && _bfTargetPos) {
        // Collect all spaces adjacent to the target's footprint (handles multi-space figures)
        const _bfTargetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const _bfTargetSize = getFigureSize(_bfTargetDcName) || '1x1';
        const _bfTargetCells = getFootprintCells(_bfTargetPos, _bfTargetSize);
        const _bfAdjSet = new Set();
        for (const _bfCell of _bfTargetCells) {
          for (const _bfA of (_bfMs.adjacency?.[_bfCell] || [])) _bfAdjSet.add(_bfA);
        }
        // Remove the target's own cells from adjacency
        for (const _bfCell of _bfTargetCells) _bfAdjSet.delete(_bfCell);
        for (const _bfPn of [1, 2]) {
          for (const [_bfFk, _bfPos] of Object.entries(game.figurePositions?.[_bfPn] || {})) {
            // Check if any cell of this figure's footprint is adjacent to the target
            const _bfFkDcName = dcNameFromFigureKey(_bfFk);
            const _bfFkSize = getFigureSize(_bfFkDcName) || '1x1';
            const _bfFkCells = getFootprintCells(_bfPos, _bfFkSize);
            if (!_bfFkCells.some(c => _bfAdjSet.has(c))) continue;
            if (_bfFk === combat.target.figureKey) continue;
            if (isConditionImmune(game, _bfFk)) continue; // Condition Immunity: skip Stun
            if (_applyCondition(game, _bfFk, 'Stun')) {
              const _bfDcName = dcNameFromFigureKey(_bfFk);
              await logGameAction(game, client, `\uD83D\uDCA5 **Burst Fire** \u2014 **${_bfDcName}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
    }
  }
  // Crippling Blow inline disabled 2026-05-09 → fireCripplingBlow.
  if (false && game.cripplingBlowPending?.[combat.attackerMsgId]) { // eslint-disable-line no-constant-condition
    delete game.cripplingBlowPending[combat.attackerMsgId];
    if (hit && combat.target?.figureKey) {
      if (!isConditionImmune(game, combat.target.figureKey)) {
        if (_applyCondition(game, combat.target.figureKey, 'Stun')) {
          await logGameAction(game, client, `\u26A1 **Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
        }
      } else {
        await logGameAction(game, client, `**Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is immune to Stun.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Disruptor Rifle inline disabled 2026-05-09 → fireDisruptorRifle.
  if (false && game.disruptorRiflePending?.[combat.attackerMsgId]) { // eslint-disable-line no-constant-condition
    delete game.disruptorRiflePending[combat.attackerMsgId];
    if (hit && targetMsgId) {
      const _drHS = dcHealthState.get(targetMsgId) || [];
      const _drEntry = _drHS[targetFigIndex];
      if (_drEntry) {
        const [_drCur] = _drEntry;
        if (_drCur === 1) {
          await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
            figureKey: combat.target.figureKey, msgId: targetMsgId, figIndex: targetFigIndex,
            amount: 1, controllerPlayerNum: defenderPlayerNum,
            attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
            source: 'Disruptor Rifle', combat,
          });
          await logGameAction(game, client, `\u{1F480} **Disruptor Rifle** — **${combat.target?.label || ''}** had 1 HP remaining — suffers 1 additional Damage and is **defeated**.`, { phase: 'ROUND', icon: 'attack' });
          // Process defeat through canonical pipeline
          const { idx: _drIdx } = lookupFigureDcIndex(game, defenderPlayerNum, combat.target.figureKey);
          await processFigureDefeat(game, {
            defeatedPlayerNum: defenderPlayerNum,
            figureKey: combat.target.figureKey,
            attackerPlayerNum,
            attackerFigureKey: combat.attackerFigureKey,
            msgId: targetMsgId,
            dcIdx: _drIdx,
            dcName: targetDcName,
            displayName: combat.target.label,
            source: 'Disruptor Rifle',
          }, { ...deps, client });
        }
      }
    }
  }
  // Tonfa Strike inline disabled 2026-05-09 → fireTonfaStrike (chain-attack
  // queued, fires after defender step 8 closes per user spec).
  if (false && game.tonfaStrikeSecondAttack?.[combat.attackerMsgId]) { // eslint-disable-line no-constant-condition
    delete game.tonfaStrikeSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerFigureKey] = true;
    await thread.send('**Tonfa Strike** — You may perform an additional attack (use Attack button).');
  }
  // Barrage inline disabled 2026-05-09 → fireBarrage.
  if (false && game.barrageSecondAttack?.[combat.attackerMsgId]) { // eslint-disable-line no-constant-condition
    delete game.barrageSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerFigureKey] = true;
    // Store first target's position so second attack target must be within 3 spaces
    const _barrageTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target?.figureKey];
    if (_barrageTargetPos) {
      game.barrageTargetSpace = game.barrageTargetSpace || {};
      game.barrageTargetSpace[combat.attackerMsgId] = _barrageTargetPos;
    }
    // Mark that the next attack from this figure adds 1 white die to defense pool
    game.barrageDefenseBonus = game.barrageDefenseBonus || {};
    game.barrageDefenseBonus[combat.attackerMsgId] = true;
    await thread.send('**Barrage** — You may perform a second attack (target within 3 of first target, defender +1 white die). Use the **Attack** button.');
  }
  // Imperial Loadout post-attack effects.
  // Electro-pulse + Quick Strike migrated 2026-05-09 to step-8 fire
  // handlers (after-attack-fire.js); their inline branches gate on `false`.
  // Flurry of Blows is a chain-attack ability; that migration lands with
  // the rest of the chain-attack effects in a separate slice.
  if (combat.loadoutPostAttack) {
    const _lpa = combat.loadoutPostAttack;
    // Electro-pulse (Electrohammer): each other figure adjacent to target suffers 1 Damage
    if (false && _lpa === 'electro_pulse' && combat.target?.figureKey) { // eslint-disable-line no-constant-condition
      const _epTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_epTargetPos) {
        const _epLines = [];
        for (const [pNum, poses] of [[1, game.figurePositions?.[1] || {}], [2, game.figurePositions?.[2] || {}]]) {
          for (const [fk, pos] of Object.entries(poses)) {
            // Slice 6.11 fix (destruct 2026-05-06): "each other figure adjacent
            // to the target space" excludes the SOURCE (the PT carrying the
            // Electrohammer), NOT the target. The target itself IS adjacent
            // to its own space (distance 0) and therefore takes 1 splash
            // damage too. Previously we excluded the target, which silently
            // dropped the destruct-canonical case ("target itself takes 1
            // splash damage; PT does NOT").
            if (pNum === attackerPlayerNum && fk === combat.attackerFigureKey) continue;
            if (countGameSpaces(game, pos, _epTargetPos) > 1) continue;
            const _epFkDcName = dcNameFromFigureKey(fk);
            const _epMid = getDcMessageIds(game, pNum) || [];
            const _epDcL = getDcList(game, pNum);
            const { dgIndex: _epDgIdx, figureIndex: _epFigIdx } = parseFigureKey(fk);
            const _epMsgId = _epMid.find((mid, idx) => _epDcL?.[idx]?.dcName === _epFkDcName && _epDcL?.[idx]?.dgIndex === _epDgIdx);
            if (_epMsgId) {
              await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
                figureKey: fk, msgId: _epMsgId, figIndex: _epFigIdx,
                amount: 1, controllerPlayerNum: pNum,
                attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
                source: 'Electro-pulse', combat,
              });
            }
            _epLines.push(`**${_epFkDcName}** suffers 1 Damage`);
          }
        }
        if (_epLines.length > 0) {
          await logGameAction(game, client, `\u26A1 **Electro-pulse** — Adjacent figures:\n${_epLines.join('\n')}`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
    // Quick Strike (Electrostaff): if defender rerolled/modified dice, defender suffers 1 Damage.
    // Inline disabled 2026-05-09 → fireQuickStrike.
    if (false && _lpa === 'quick_strike' && hit && combat.target?.figureKey && targetMsgId) { // eslint-disable-line no-constant-condition
      const _qsModified = combat.defenderRerolledOrModified;
      if (_qsModified) {
        await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
          figureKey: combat.target.figureKey, msgId: targetMsgId, figIndex: targetFigIndex,
          amount: 1, controllerPlayerNum: defenderPlayerNum,
          attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
          source: 'Quick Strike', combat,
        });
        await logGameAction(game, client, `\u26A1 **Quick Strike** — Defender modified dice/results: **${combat.target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
    // Flurry of Blows inline disabled 2026-05-09 → fireFlurryOfBlows
    // (chain-attack staged, fires after defender step 8 closes).
    if (false && _lpa === 'flurry_of_blows' && hit && combat.attackerMsgId) { // eslint-disable-line no-constant-condition
      const _fobKey = `flurryOfBlows_${combat.attackerMsgId}`;
      if (!game.roundFigureAbilityUsed?.[_fobKey]) {
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[_fobKey] = true;
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[combat.attackerFigureKey] = true;
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[combat.attackerMsgId] = { dice: ['green'], type: 'melee', bonusHits: 1 };
        await thread.send('**Flurry of Blows** — You may perform a Melee attack using 1 green die (+1 Hit). Use the Attack button.');
      }
    }
  }
  // Clawdite Streetrat Assassin's Blade post-attack: choose an adjacent hostile, roll 1 red die, deal Hits
  if (combat.formPostAttack === 'assassins_blade' && combat.attackerFigureKey) {
    const _abAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    if (_abAttackerPos) {
      // Find adjacent hostile figures
      const _abAdjacentHostiles = [];
      for (const [_abFk, _abPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
        if (!_abPos) continue;
        if (countGameSpaces(game, _abAttackerPos, _abPos) === 1) _abAdjacentHostiles.push({ fk: _abFk, pos: _abPos });
      }
      if (_abAdjacentHostiles.length === 0) {
        await thread.send(`\u{1F5E1}\uFE0F **Assassin's Blade** — No adjacent hostile figures.`).catch(discordCatch);
      } else {
        const _abDiceData = getDiceData();
        const _abRedFaces = _abDiceData?.attack?.red || [];
        if (_abRedFaces.length > 0) {
          const _abRoll = _abRedFaces[Math.floor(Math.random() * _abRedFaces.length)];
          const _abHits = (_abRoll.damage || 0);
          const _abRollStr = Object.entries(_abRoll).filter(([k,v]) => v > 0 && k !== 'blank').map(([k,v]) => `${v} ${k}`).join(', ') || 'blank';
          if (_abAdjacentHostiles.length === 1 && _abHits > 0) {
            // Auto-apply to the only adjacent hostile
            const { fk: _abFk2 } = _abAdjacentHostiles[0];
            const _abDcName = dcNameFromFigureKey(_abFk2);
            for (const [_abMsgId, _abMeta] of dcMessageMeta) {
              if (_abMeta.gameId !== game.gameId || _abMeta.playerNum !== defenderPlayerNum || _abMeta.dcName !== _abDcName) continue;
              const _abFigIdx = parseFigureKey(_abFk2).figureIndex;
              await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
                figureKey: _abFk2, msgId: _abMsgId, figIndex: _abFigIdx,
                amount: _abHits, controllerPlayerNum: defenderPlayerNum,
                attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
                source: 'Assassin\'s Blade', combat,
              });
              break;
            }
            await thread.send(`\u{1F5E1}\uFE0F **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. **${_abDcName}** suffers **${_abHits} Damage**.`).catch(discordCatch);
            await logGameAction(game, client, `\u{1F5E1}\uFE0F **Assassin's Blade** — **${_abDcName}** suffers **${_abHits} Damage**.`, { phase: 'ROUND', icon: 'attack' });
          } else if (_abHits > 0) {
            // Multiple adjacent hostiles — show picker buttons
            setPendingAssassinsBlade(game, { hits: _abHits, rollStr: _abRollStr, defenderPlayerNum, attackerPlayerNum });
            const _abBtns = _abAdjacentHostiles.map(({ fk }) => {
              const name = dcNameFromFigureKey(fk);
              return new ButtonBuilder()
                .setCustomId(`ab_blade_pick_${game.gameId}_${fk}`)
                .setLabel(name)
                .setStyle(ButtonStyle.Danger);
            });
            const _abRows = [];
            for (let _r = 0; _r < _abBtns.length; _r += 5) _abRows.push(new ActionRowBuilder().addComponents(_abBtns.slice(_r, _r + 5)));
            await thread.send({ content: `\u{1F5E1}\uFE0F **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}** (${_abHits} Damage). Choose an adjacent hostile figure:`, components: _abRows }).catch(discordCatch);
          } else {
            await thread.send(`\u{1F5E1}\uFE0F **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. No hits.`).catch(discordCatch);
          }
        }
      }
    }
  }
  // Suppressive Fire (Skirmish Upgrade): exhaust after Ranged attack → Weaken target + 2 MP to SMALL friendly within 3
  const _sfUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _sfExh = game.exhaustedSkirmishUpgrades?.[combat.attackerMsgId] || [];
  if (cardNameIncludes(_sfUpgrades, 'Suppressive Fire') && !cardNameIncludes(_sfExh, 'Suppressive Fire') && combat.isRanged && damage > 0) {
    game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
    game.exhaustedSkirmishUpgrades[combat.attackerMsgId] = [..._sfExh, 'Suppressive Fire'];
    // Apply Weaken to the target
    const _sfTargetFk = combat.target?.figureKey;
    if (_sfTargetFk && !isConditionImmune(game, _sfTargetFk)) {
      _applyCondition(game, _sfTargetFk, 'Weaken');
    }
    const _sfTargetName = dcNameFromFigureKey(combat.target?.figureKey) || combat.defenderDcName;
    // Find SMALL friendly figures within 3 spaces of attacker for MP grant
    const _sfAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    const _sfSmallFriendlies = [];
    if (_sfAttackerPos) {
      const _sfEffects = getDcEffects();
      for (const [_sfFk, _sfPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (!_sfPos || _sfFk === combat.attackerFigureKey) continue;
        if (countGameSpaces(game, _sfAttackerPos, _sfPos) > 3) continue;
        // SMALL check: skip LARGE and MASSIVE figures
        const _sfDcName = dcNameFromFigureKey(_sfFk);
        const _sfKwds = (_sfEffects[_sfDcName]?.keywords || []).map(k => String(k).toUpperCase());
        if (_sfKwds.includes('LARGE') || _sfKwds.includes('MASSIVE')) continue;
        // Find msgId for this figure's DC
        const _sfFigMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _sfFk);
        if (_sfFigMsgId) _sfSmallFriendlies.push({ fk: _sfFk, msgId: _sfFigMsgId, dcName: _sfDcName });
      }
    }
    if (_sfSmallFriendlies.length === 1) {
      // Auto-stamp picker on the only eligible friendly. Recipient
      // ≠ attacker (filter excludes the attacker) → spend at once,
      // no bank, bypassCosts: false.
      const _sfF = _sfSmallFriendlies[0];
      try {
        const { setupPendingMoveX } = await import('../handlers/move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction, saveGames: deps?.saveGames }, {
          msgId: _sfF.msgId,
          figureKey: _sfF.fk,
          playerNum: attackerPlayerNum,
          spaces: 2,
          source: 'Suppressive Fire',
          threadId: combat.combatThreadId,
          bypassCosts: false,
        });
        await thread.send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. **${_sfF.dcName}** gains **2 MP** — spend at once, no bank.`).catch(discordCatch);
      } catch (err) {
        console.error('[combat-bridge] Suppressive Fire auto-grant picker stamp failed:', err?.message ?? err);
      }
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened; **${_sfF.dcName}** gains 2 MP (spend immediately, no bank).`, { phase: 'ROUND', icon: 'card' });
    } else if (_sfSmallFriendlies.length > 1) {
      // Show picker buttons
      setPendingSuppressiveFireMp(game, { attackerPlayerNum });
      const _sfBtns = _sfSmallFriendlies.map(({ fk, dcName }) =>
        new ButtonBuilder().setCustomId(`sf_mp_pick_${game.gameId}_${fk}`).setLabel(dcName).setStyle(ButtonStyle.Primary)
      );
      const _sfRows = [];
      for (let _r = 0; _r < _sfBtns.length; _r += 5) _sfRows.push(new ActionRowBuilder().addComponents(_sfBtns.slice(_r, _r + 5)));
      await thread.send({ content: `**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. Choose a SMALL friendly figure within 3 spaces to gain 2 MP:`, components: _sfRows }).catch(discordCatch);
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
    } else {
      await thread.send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. No eligible SMALL friendly figures within 3 spaces for MP grant.`).catch(discordCatch);
      await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
    }
  }
  // Flame Trooper Incinerate: after attacking, each figure that suffered damage suffers 1 Strain (HP loss). Place Rubble in target space.
  const _ftAtkUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _ftBlastRefreshMsgIds = [];
  if (cardNameIncludes(_ftAtkUpgrades, 'Flame Trooper') && hit) {
    // Apply 1 Strain (1 HP loss) to target if it suffered damage and survived
    if (damage > 0 && targetMsgId) {
      // Fireproof: target immune to Strain if it also has Flame Trooper attachment
      const _ftTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
      // Fireproof + per-strain choice + Headhunter handled by applyStrain.
      // Defeat finalization on the damage branch is handled inside the
      // strain pipeline (applyStrain → _applyDamageFromStrain).
      const _ftHsBefore = dcHealthState.get(targetMsgId);
      if (_ftHsBefore?.[targetFigIndex]?.[0] > 0) {
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
          figureKey: combat.target.figureKey,
          controllerPlayerNum: defenderPlayerNum,
          amount: 1,
          source: 'Flame Trooper Incinerate',
        });
      }
    }
    // Blast damage also triggers Incinerate Strain on adjacent damaged figures — auto-apply
    if (effectiveBlast > 0 && game.selectedMap?.id) {
      // CRR step 8: full-footprint adjacency (target may be a defeated multi-cell figure).
      const _ftBlastAdj = _targetCoordBeforeDefeat
        ? getFiguresAdjacentToCoord(game, _targetCoordBeforeDefeat, game.selectedMap.id, combat.target.figureKey, _targetSizeBeforeDefeat)
        : [];
      for (const { figureKey: _ftBlastFk, playerNum: _ftBlastPn } of _ftBlastAdj) {
        // Fireproof self-skip: own Incinerate Blast doesn't strain own
        // Flame Trooper figures (per the attacker's Fireproof passive).
        // applyStrain handles the TARGET-side Fireproof check below.
        if (_ftBlastPn === attackerPlayerNum && cardNameIncludes(_ftAtkUpgrades, 'Flame Trooper')) continue;
        const _ftBlastMsgId = findDcMessageIdForFigure(game.gameId, _ftBlastPn, _ftBlastFk);
        if (!_ftBlastMsgId) continue;
        const _ftBlastHsBefore = dcHealthState.get(_ftBlastMsgId);
        if (!_ftBlastHsBefore?.[parseFigureKey(_ftBlastFk).figureIndex] || _ftBlastHsBefore[parseFigureKey(_ftBlastFk).figureIndex][0] <= 0) continue;
        // Strain via the canonical applyStrain pipeline (Fireproof /
        // Headhunter / per-strain choice / Under Duress / Paz).
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
          figureKey: _ftBlastFk,
          controllerPlayerNum: _ftBlastPn,
          amount: 1,
          source: 'Incinerate Blast',
        });
        _ftBlastRefreshMsgIds.push(_ftBlastMsgId);
        // Defeat finalization on the damage branch is handled inside
        // applyStrain → _applyDamageFromStrain → applyDamage's pipeline
        // (which fires WHEN_DEFEATED hooks + post-defeat orchestration).
      }
    }
    // Place Rubble token in target space (if attack didn't miss)
    if (combat.target?.figureKey) {
      const _ftTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_ftTargetPos) {
        game.rubbleTokens = game.rubbleTokens || [];
        const _ftCoord = String(_ftTargetPos).toLowerCase();
        if (!game.rubbleTokens.includes(_ftCoord)) {
          game.rubbleTokens.push(_ftCoord);
        }
        await thread.send(`**Incinerate** — Rubble token placed at **${String(_ftTargetPos).toUpperCase()}**.`).catch(discordCatch);
      }
    }
  }

  const embedRefreshMsgIds = new Set(damage > 0 && targetMsgId ? [targetMsgId] : []);
  if (combat.surgeRecover > 0 && combat.attackerMsgId != null) embedRefreshMsgIds.add(combat.attackerMsgId);
  // Force Deflection embed refresh (flag set earlier in pre-defeat section)
  if (_fdNeedsEmbedRefresh && combat.attackerMsgId) embedRefreshMsgIds.add(combat.attackerMsgId);
  // Incinerate Blast Strain embed refreshes (collected earlier)
  if (_ftBlastRefreshMsgIds?.length) for (const _mid of _ftBlastRefreshMsgIds) embedRefreshMsgIds.add(_mid);

  // Concentrated Fire (alexanbv 2026-05-09): apply Stun to the SUPPORTER
  // figure (the non-attacker friendly Ranged TROOPER who played the CC),
  // NOT the attacker. Resolver writes the chosen figureKey into
  // game.applySelfStunAfterAttackFigureKey[playerNum].
  if (game.applySelfStunAfterAttackFigureKey?.[attackerPlayerNum]) {
    const _cfaFigKey = game.applySelfStunAfterAttackFigureKey[attackerPlayerNum];
    delete game.applySelfStunAfterAttackFigureKey[attackerPlayerNum];
    if (_cfaFigKey && !isConditionImmune(game, _cfaFigKey)) {
      if (_applyCondition(game, _cfaFigKey, 'Stun')) {
        const _cfaDcName = dcNameFromFigureKey(_cfaFigKey);
        await logGameAction(game, client, `**Concentrated Fire** — **${_cfaDcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'card' });
        const _cfaMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _cfaFigKey);
        if (_cfaMsgId) embedRefreshMsgIds.add(_cfaMsgId);
      }
    }
  }
  // Wild Fury inline disabled 2026-05-09 → fireWildFury (step-8 attacker
  // button). Routes through applyCondition with Condition Immunity filter.
  if (false && game.pendingPostAttackConditions?.[combat.attackerMsgId] && combat.attackerFigureKey) { // eslint-disable-line no-constant-condition
    let _ppaConditions = game.pendingPostAttackConditions[combat.attackerMsgId];
    delete game.pendingPostAttackConditions[combat.attackerMsgId];
    if (Array.isArray(_ppaConditions) && _ppaConditions.length > 0) {
      // Condition Immunity: filter out harmful conditions for immune figures
      if (isConditionImmune(game, combat.attackerFigureKey)) {
        _ppaConditions = _ppaConditions.filter((c) => !HARMFUL_CONDITIONS.includes(c));
      }
      if (_ppaConditions.length > 0) {
        for (const _ppaC of _ppaConditions) {
          _applyCondition(game, combat.attackerFigureKey, _ppaC);
        }
        const _ppaDcName = dcNameFromFigureKey(combat.attackerFigureKey);
        await logGameAction(game, client, `**Wild Fury** — **${_ppaDcName}** is now **${_ppaConditions.join(' + ')}**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Dying Lunge / Final Stand: attacker defeats itself after the attack resolves
  if (game.selfDefeatsAfterAttackMsgId?.[combat.attackerMsgId] && combat.attackerMsgId) {
    delete game.selfDefeatsAfterAttackMsgId[combat.attackerMsgId];
    const _sdaMsgId = combat.attackerMsgId;
    const _sdaFigKey = combat.attackerFigureKey;
    const _sdaFigIdx = combat.attackerFigureIndex ?? 0;
    if (_sdaFigKey) {
      const _sdaPrevHs = dcHealthState.get(_sdaMsgId);
      if (_sdaPrevHs?.[_sdaFigIdx]) {
        const _sdaMaxHp = _sdaPrevHs[_sdaFigIdx][1] ?? _sdaPrevHs[_sdaFigIdx][0] ?? 99;
        await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
          figureKey: _sdaFigKey, msgId: _sdaMsgId, figIndex: _sdaFigIdx,
          amount: _sdaMaxHp, controllerPlayerNum: attackerPlayerNum,
          source: 'Self-Defeat', combat,
        });
        const _sdaDcIds = getDcMessageIds(game, attackerPlayerNum);
        const _sdaIdx = (_sdaDcIds || []).indexOf(_sdaMsgId);
        embedRefreshMsgIds.add(_sdaMsgId);
        await processFigureDefeat(game, {
          defeatedPlayerNum: attackerPlayerNum,
          figureKey: _sdaFigKey,
          attackerPlayerNum: defenderPlayerNum,
          msgId: _sdaMsgId,
          dcIdx: _sdaIdx,
          dcName: combat.attackerDcName,
          source: 'Dying Lunge',
        }, deps);
      }
    }
  }

  // --- Named surge post-combat effects ---
  // Harass / Suppression both deal Strain to the defender — route through
  // applyStrain so Fireproof / Headhunter / per-strain choice / Under
  // Duress / Paz all gate correctly.
  if (hit && targetMsgId) {
    if ((combat.surgeHarass || 0) > 0) {
      await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
        figureKey: combat.target.figureKey,
        controllerPlayerNum: defenderPlayerNum,
        amount: combat.surgeHarass,
        source: 'Surge Harass',
      });
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Harass** — **${combat.target.label}** suffers **${combat.surgeHarass}** Strain`, { phase: 'ROUND', icon: 'attack' });
    }
    if (combat.surgeSuppressionStrain) {
      const supRoll = combat.defenseRoll || {};
      const supAmt = Math.min((supRoll.block || 0) + (supRoll.evade || 0) + (supRoll.dodge ? 1 : 0), 2);
      if (supAmt > 0) {
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
          figureKey: combat.target.figureKey,
          controllerPlayerNum: defenderPlayerNum,
          amount: supAmt,
          source: 'Suppression',
        });
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Suppression** — **${combat.target.label}** suffers **${supAmt}** Strain (${supRoll.block || 0} block, ${supRoll.evade || 0} evade${supRoll.dodge ? ', 1 dodge' : ''})`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Mandalorian Steel: if defender spent a Block Token this attack, recover 1 Damage on the defending figure
  if (combat.defenderSpentBlock && game.mandaAsteelPlayerNum === defenderPlayerNum && targetMsgId) {
    const { healed } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
    if (healed > 0) {
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Mandalorian Steel** — **${combat.target.label}** spent a Block Token; recovered 1 Damage`, { phase: 'ROUND', icon: 'card' });
    }
  }

  // Stalk Prey — migrated to step-8 button window (slice 2b, destruct
  // 2026-05-08). fireStalkPrey reads combat.surgeStalkPrey flag and
  // clears it; enqueue probe is in enqueueAttackerPerDcEffects.
  if (hit && combat.surgeStalkPrey && combat.attackerMsgId) {
    embedRefreshMsgIds.add(combat.attackerMsgId);
  }
  // Squad Command (Kayn Somos surge): Focus an adjacent friendly TROOPER.
  // Per destruct 2026-05-08: ACS (Advanced Com Systems) extends "adjacent"
  // → "within 3" for Kayn's abilities. The card text says "Choose AN
  // adjacent friendly TROOPER" (singular) — current impl auto-Focuses
  // the first eligible (TODO: full player-choice prompt).
  if (hit && combat.surgeSquadCommand && game.selectedMap?.id && combat.attackerFigureKey) {
    // ACS check on Kayn's DC msgId.
    const _sqAtkMsgId = combat.attackerMsgId;
    const _sqAtts = (game.p1DcAttachments?.[_sqAtkMsgId] || game.p2DcAttachments?.[_sqAtkMsgId] || []);
    const _sqHasACS = _sqAtts.some((a) => /Advanced Com Systems/i.test(String(a)));
    const _sqRange = _sqHasACS ? 3 : 1;
    const _sqAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    let _sqApplied = false;
    if (_sqAtkPos) {
      for (const [sqFk, sqPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (_sqApplied) break;
        if (sqFk === combat.attackerFigureKey || !sqPos) continue;
        if (typeof isWithinN === 'function' && !isWithinN(sqPos, _sqAtkPos, _sqRange, game.selectedMap.id)) continue;
        const sqDcName = dcNameFromFigureKey(sqFk);
        const sqEff = getDcEffect(sqDcName);
        const sqKws = (sqEff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!sqKws.includes('TROOPER')) continue;
        if (_applyCondition(game, sqFk, 'Focus')) {
          const sqMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, sqFk);
          if (sqMsgId) embedRefreshMsgIds.add(sqMsgId);
          await logGameAction(game, client, `**Squad Command**${_sqHasACS ? ' (ACS within 3)' : ''} — **${sqDcName}** is now **Focused**`, { phase: 'ROUND', icon: 'card' });
          _sqApplied = true;
        }
      }
    }
  }

  // Bleed: attacker prompted to take 1 damage or prevent by discarding CC after Attack action
  // (skipped if player spent a surge to prevent Bleed during the surge window)
  // Post-attack Bleed strain (centralized via triggerBleedAfterAction —
  // destruct 2026-05-07). Honors surgePreventBleed + attackerFireproof
  // gates that are specific to attack flow; the helper handles
  // areConditionEffectsSuppressed internally.
  if (!combat.surgePreventBleed && !combat.attackerFireproof && _triggerBleedAfterAction) {
    await _triggerBleedAfterAction(game, { ...deps, client, processFigureDefeat },
      combat.attackerFigureKey, combat.attackerPlayerNum);
  }
  // Deflection inline disabled 2026-05-09 → fireDeflection (defender step-8).
  const deflectDmg = game.deflectionPending?.[defenderPlayerNum];
  const deflectUnconditional = game.deflectionUnconditional?.[defenderPlayerNum];
  if (false && deflectDmg && deflectDmg > 0 && hit && (deflectUnconditional || damage === 0)) { // eslint-disable-line no-constant-condition
    delete game.deflectionPending[defenderPlayerNum];
    delete game.deflectionUnconditional?.[defenderPlayerNum];
    const attMsgId = combat.attackerMsgId;
    const attFigIdx = combat.attackerFigureIndex ?? 0;
    if (attMsgId) {
      const _deflectRes = await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
        figureKey: combat.attackerFigureKey, msgId: attMsgId, figIndex: attFigIdx,
        amount: deflectDmg, controllerPlayerNum: attackerPlayerNum,
        source: 'Deflection', combat,
      });
      const deflectMax = dcHealthState.get(attMsgId)?.[attFigIdx]?.[1] ?? 0;
      if (deflectMax > 0) {
        embedRefreshMsgIds.add(attMsgId);
        const defOwnerId = getPlayerId(game, defenderPlayerNum);
        await logGameAction(game, client, `<@${defOwnerId}> **Deflection** — Attacker suffers **${deflectDmg} Damage**.`, { allowedMentions: { users: [defOwnerId] }, phase: 'ROUND', icon: 'card' });
      }
    }
  }
  // Embed refresh for Blast damage already applied earlier in this function.
  // CRR step 8: full-footprint adjacency for multi-cell defeated targets.
  if (totalBlast > 0 && hit && game.selectedMap?.id) {
    const blastAdjacent = _targetCoordBeforeDefeat
      ? getFiguresAdjacentToCoord(game, _targetCoordBeforeDefeat, game.selectedMap.id, combat.target.figureKey, _targetSizeBeforeDefeat)
      : [];
    for (const { figureKey: bk, playerNum: bp } of blastAdjacent) {
      const mid = findDcMessageIdForFigure(game.gameId, bp, bk);
      if (mid) embedRefreshMsgIds.add(mid);
    }
  }
  // Cover Fire (CT-1701): after resolving an attack, distribute 1 Block Token to a friendly figure within 3 spaces.
  // If the attack hit, may discard 1 condition or Power Token from the target. Limit once per round.
  const _cfAttEff = getDcEffects()?.[combat.attackerDcName || ''];
  const _cfKey = `coverFire_${combat.attackerMsgId}`;
  if ((_cfAttEff?.passives || []).includes('Cover Fire') && combat.attackerMsgId && !game.roundFigureAbilityUsed?.[_cfKey]) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    game.roundFigureAbilityUsed[_cfKey] = true;
    const _cfAttPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    const _cfMapId = game.selectedMap?.id;
    if (_cfAttPos && _cfMapId) {
      // Find all friendly figures within 3 spaces
      const _cfFriendlies = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (!pos) continue;
        if (countGameSpaces(game, _cfAttPos, pos) <= 3) _cfFriendlies.push({ fk, pos });
      }
      if (_cfFriendlies.length === 1) {
        // Auto-grant to the only option
        grantPowerTokens(game, _cfFriendlies[0].fk, 'Block', 1);
        const _cfName = dcNameFromFigureKey(_cfFriendlies[0].fk);
        await logGameAction(game, client, `\u{1F6E1}\uFE0F **Cover Fire** — **${_cfName}** gained 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
        const _cfMid = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _cfFriendlies[0].fk);
        if (_cfMid) embedRefreshMsgIds.add(_cfMid);
      } else if (_cfFriendlies.length > 1) {
        // Picker buttons for Block token target
        const _cfBtns = _cfFriendlies.slice(0, 20).map(({ fk }) => {
          const _cfLabel = dcNameFromFigureKey(fk);
          return new ButtonBuilder()
            .setCustomId(`cover_fire_block_${game.gameId}_${attackerPlayerNum}_${fk}`)
            .setLabel(_cfLabel.slice(0, 80))
            .setStyle(ButtonStyle.Primary);
        });
        const _cfRows = chunkButtonsToRows(_cfBtns);
        setPendingCoverFire(game, { gameId: game.gameId, attackerPlayerNum, attackerMsgId: combat.attackerMsgId, hit: !!(hit && damage > 0), targetFigureKey: combat.target?.figureKey, targetMsgId, targetFigIndex, defenderPlayerNum, combat: { combatThreadId: combat.combatThreadId, resultText }, embedRefreshMsgIds: [...embedRefreshMsgIds] });
        await thread.send(sanitizeMentions({ content: `\u{1F6E1}\uFE0F **Cover Fire** — <@${ownerId}> Choose a friendly figure within 3 spaces to receive 1 Block Token:`, allowedMentions: { users: [ownerId] }, components: _cfRows }));
        // Don't return — the Block token choice is async but we continue combat resolution
      }
    }
    // If hit and damage > 0, offer to discard a condition or power token from the target
    if (hit && damage > 0 && combat.target?.figureKey) {
      const _cfTargetConds = (game.figureConditions?.[combat.target.figureKey] || []).filter(c => c !== 'Bleed' || c); // all conditions
      const _cfTargetTokens = game.figurePowerTokens?.[combat.target.figureKey] || [];
      const _cfRemovables = [..._cfTargetConds.map(c => ({ type: 'condition', value: c })), ..._cfTargetTokens.map(t => ({ type: 'token', value: t }))];
      if (_cfRemovables.length > 0) {
        const _cfRemBtns = _cfRemovables.slice(0, 20).map(({ type, value }, i) => {
          const label = type === 'condition' ? `Discard ${value}` : `Discard ${value} Token`;
          return new ButtonBuilder()
            .setCustomId(`cover_fire_discard_${game.gameId}_${type}_${i}_${combat.target.figureKey}`)
            .setLabel(label.slice(0, 80))
            .setStyle(ButtonStyle.Danger);
        });
        _cfRemBtns.push(new ButtonBuilder().setCustomId(`cover_fire_discard_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const _cfRemRows = chunkButtonsToRows(_cfRemBtns);
        await thread.send(sanitizeMentions({ content: `\u{1F6E1}\uFE0F **Cover Fire** — <@${ownerId}> You may discard 1 condition or Power Token from **${combat.target.label}**:`, allowedMentions: { users: [ownerId] }, components: _cfRemRows }));
      }
    }
  }

  // CRR-CLV-005 Cleave migrated 2026-05-09 to the step-8 queue.
  // enqueueAttackerStep8Effects pushes one entry per cleave source;
  // each surfaces as a separate button in the attacker post-resolve
  // window, fired by fireCleave (after-attack-fire.js). resultText
  // is stashed on the combat so fireCleave can carry it through
  // pendingCleave for the close-resolution path.
  combat._step7ResultText = resultText;
  // Legacy block disabled (kept here so blame-history is intact;
  // removal pass when the rest of step-7-inline keywords migrate).
  if (false) {
    const effectiveCleave = (combat.surgeCleave || 0) + (combat.passiveCleave || 0);
    const cleaveQueue = Array.isArray(combat.cleaveSources) && combat.cleaveSources.length > 0
      ? combat.cleaveSources.slice()
      : (effectiveCleave > 0 ? [{ value: effectiveCleave, label: `Cleave ${effectiveCleave}` }] : []);
    if (hit && damage > 0 && cleaveQueue.length > 0 && game.selectedMap?.id) {
      const cleaveTargets = computeCleaveEligibleTargets(game, combat, defenderPlayerNum, {
        getFiguresAdjacentToCoord, getMapData, getEffectiveMapSpaces, isWithinN,
        hasFigureLineOfSight, getFigureFootprint, getFigureSize, getFigureLabel,
        getDcEffect, getLoadoutCards: _getLoadoutCardsImpl,
      });
      if (cleaveTargets.length > 0) {
      const firstSource = cleaveQueue.shift();
      setPendingCleave(game, {
        gameId: game.gameId,
        combatThreadId: combat.combatThreadId,
        surgeCleave: firstSource.value,
        sourceLabel: firstSource.label,
        cleaveQueue,
        attackerPlayerNum,
        defenderPlayerNum,
        ownerId,
        targets: cleaveTargets,
        resultText,
        combat,
        initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
      });
      const cleaveRows = getCleaveTargetButtons(game.gameId, cleaveTargets);
      await thread.send(sanitizeMentions({
        content: `**${firstSource.label}:** <@${ownerId}> \u2014 Choose one eligible target to apply cleave damage:`,
        allowedMentions: { users: [ownerId] },
        components: cleaveRows,
      }));
        return;
      }
    }
  } // end legacy disabled cleave block
  // destruct 2026-05-08: post-resolve unified window.
  // After all step-7 damage applies and any per-DC inline applies have
  // run (those are still inline pending follow-up commits to migrate),
  // enqueue the step-8 keyword effects + post the attacker window.
  // Each click fires one effect; Done finishes; defender window opens
  // next; defender Done runs the legacy combat-close path below.
  _enqueueAttackerStep8Effects(combat);
  // Per-DC atk-side effects (Slippery's atk-side cousin Leg Hydraulics
  // and the rest as they migrate). Reads combat.attackerDcName +
  // specialAbilityIds; pushes one entry per matching ability.
  const { enqueueAttackerPerDcEffects } = await import('../handlers/after-attack-resolve.js');
  enqueueAttackerPerDcEffects(combat, game, deps);
  const _aaCtx = {
    ...deps,
    client,
    afterAttackClose: async (_t, _g, _c) => {
      const fkTriggered = await _checkPostCombatSurges(_g, _c, resultText, embedRefreshMsgIds, _t, ownerId, defenderPlayerNum);
      if (!fkTriggered) await _finishCombatResolution(_g, _c, resultText, embedRefreshMsgIds, client);
    },
  };
  await _postPostResolveWindow(thread, game, combat, 'attacker', _aaCtx);
}

/**
 * Check for post-combat surge effects that need UI interaction, before finishCombatResolution.
 * Returns true if a pending interaction was triggered (caller should NOT call finishCombatResolution yet).
 * Returns false if nothing triggered (caller should call finishCombatResolution).
 */
export async function checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, deps) {
  const {
    logGameAction, dcNameFromFigureKey, getFigureLabel, getFigureSize,
    getMapData, getPlayerId, getCcHand, getCcEffect, getCcEffectsData,
    getDcEffects, getFiguresAdjacentToTarget,
    _applyCondition, HARMFUL_CONDITIONS, isConditionImmune,
    ccHandKey, ccDiscardKey, ccDeckKey,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    getFightingKnifeTargetButtons,
    discordCatch,
    updateMovementBankMessage,
    client,
  } = deps;

  const hit = !resultText.includes('**Miss**');
  // Fighting Knife (Verena Talos): after non-miss, choose adjacent hostile, roll 1 red die, apply hits
  // Fighting Knife inline disabled 2026-05-09 → fireFightingKnife
  // (step-8 attacker button + fromStep8Queue bypass on click handlers).
  if (false && hit && combat.surgeFightingKnife && combat.attackerFigureKey && game.selectedMap?.id) { // eslint-disable-line no-constant-condition
    const adjHostiles = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id)
      .filter((c) => c.playerNum === defenderPlayerNum);
    if (adjHostiles.length > 0) {
      const targetsWithLabels = adjHostiles.map((c) => {
        const { msgId: mid, label } = getFigureLabel(game, c.playerNum, c.figureKey);
        return { figureKey: c.figureKey, playerNum: c.playerNum, label, msgId: mid };
      });
      setPendingFightingKnife(game, {
        gameId: game.gameId,
        combatThreadId: combat.combatThreadId,
        attackerPlayerNum: combat.attackerPlayerNum,
        ownerId,
        targets: targetsWithLabels,
        resultText,
        combat,
        initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
      });
      const rows = getFightingKnifeTargetButtons(game.gameId, targetsWithLabels);
      await thread.send(sanitizeMentions({
        content: `<@${ownerId}> **Fighting Knife** — Choose an adjacent hostile figure to roll 1 red die:`,
        allowedMentions: { users: [ownerId] },
        components: rows,
      })).catch(discordCatch);
      return true;
    }
  }
  // Concussive Bolt inline disabled 2026-05-09 → fireConcussiveBolt
  // (step-8 attacker button, with fromStep8Queue bypass on click handler).
  if (false && hit && combat.surgeConcussiveBolt && combat.target?.figureKey && game.selectedMap?.id) { // eslint-disable-line no-constant-condition
    const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
    const targetSize = getFigureSize(targetDcName);
    if (targetSize === '1x1') {
      const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      // Only LEGAL push destinations: not blocking, not occupied, not across
      // a closed door / cliff, not blocked by Spiked Boots.
      const { getValidPushDestinations } = await import('../game/movement.js');
      const _pusherDc = dcNameFromFigureKey(combat.attackerFigureKey);
      const _pusherKws = (getDcStats(_pusherDc)?.keywords || []).map(k => String(k).toUpperCase());
      const adjSpaces = getValidPushDestinations(game, combat.target.figureKey, defenderPlayerNum, { pusherIsMassive: _pusherKws.includes('MASSIVE') });
      if (adjSpaces.length > 0) {
        const { msgId: targetMsgId, label: targetLabel } = getFigureLabel(game, defenderPlayerNum, combat.target.figureKey, targetDcName);
        setPendingConcussiveBolt(game, {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          figureKey: combat.target.figureKey,
          figureLabel: String(targetLabel).slice(0, 80),
          currentPos: targetPos,
          adjSpaces,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        });
        const btns = adjSpaces.slice(0, 4).map((sp) =>
          new ButtonBuilder().setCustomId(`concussive_bolt_push_${game.gameId}_${sp}`).setLabel(sp.toUpperCase()).setStyle(ButtonStyle.Danger)
        );
        btns.push(new ButtonBuilder().setCustomId(`concussive_bolt_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send(sanitizeMentions({
          content: `<@${ownerId}> **Concussive Bolt** — Push **${targetLabel}** 1 space. Choose a destination:`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        })).catch(discordCatch);
        return true;
      }
    }
  }
  // Spread the Pain inline disabled 2026-05-09 → fireSpreadThePain
  // (step-8 attacker button + fromStep8Queue bypass on advanceSpreadThePain).
  if (false && hit && combat.spreadThePainConditions?.length > 0 && combat.target?.figureKey && game.selectedMap?.id) { // eslint-disable-line no-constant-condition
    const conditions = [...combat.spreadThePainConditions];
    const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetPos) {
      const ms = getMapData(game.selectedMap.id);
      const adjacency = ms?.adjacency || {};
      const candSpaces = new Set([String(targetPos).toLowerCase(), ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase())]);
      const figuresAtSpaces = [];
      for (const p of [1, 2]) {
        for (const [figKey, figPos] of Object.entries(game.figurePositions?.[p] || {})) {
          if (candSpaces.has(String(figPos).toLowerCase())) {
            const { msgId: mid, label } = getFigureLabel(game, p, figKey, undefined, 70);
            figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label, msgId: mid });
          }
        }
      }
      if (figuresAtSpaces.length > 0) {
        const firstCond = conditions[0];
        setPendingSpreadThePain(game, {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          conditions,
          conditionIdx: 0,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        });
        const btns = figuresAtSpaces.slice(0, 4).map((f) =>
          new ButtonBuilder()
            .setCustomId(`spread_pain_fig_${game.gameId}_${f.figureKey}`)
            .setLabel(f.label)
            .setStyle(f.playerNum === defenderPlayerNum ? ButtonStyle.Danger : ButtonStyle.Secondary)
        );
        btns.push(new ButtonBuilder().setCustomId(`spread_pain_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send(sanitizeMentions({
          content: `<@${ownerId}> **Spread the Pain** — Apply **${firstCond}** to a figure at or adjacent to target (${String(targetPos).toUpperCase()}):`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        })).catch(discordCatch);
        return true;
      }
    }
  }
  // Post-attack reactions: check if defender has Payback, Dangerous Prey, or Right Back At Ya!
  const defenderHand = getCcHand(game, defenderPlayerNum) || [];
  const REACTION_CARDS = [
    { name: 'Payback', targetDcName: 'Dengar' },
    { name: 'Dangerous Prey', targetDcName: 'Bossk' },
    { name: "Right Back At Ya!", targetDcName: 'Ahsoka Tano' },
  ];
  combat.promptedReactions = combat.promptedReactions || new Set();
  for (const { name, targetDcName } of REACTION_CARDS) {
    if (combat.promptedReactions.has(name)) continue;
    if (!defenderHand.includes(name)) continue;
    const targetFigKey = combat.target?.figureKey || '';
    if (!targetFigKey.startsWith(targetDcName + '-')) continue;
    // Prompt the defender for this reaction
    combat.promptedReactions.add(name);
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    // Tentatively remove from hand to prevent double-prompt; restored on skip
    const handKey = ccHandKey(defenderPlayerNum);
    const cardIdx = (game[handKey] || []).indexOf(name);
    if (cardIdx >= 0) game[handKey].splice(cardIdx, 1);
    setPendingReaction(game, {
      gameId: game.gameId,
      combatThreadId: combat.combatThreadId,
      attackerPlayerNum: combat.attackerPlayerNum,
      defenderPlayerNum,
      ownerId: defOwnerId,
      cardName: name,
      targetDcName,
      targetFigKey,
      attackerFigKey: combat.attackerFigureKey,
      attackerMsgId: combat.attackerMsgId,
      resultText,
      combat,
      initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
    });
    const btnUse = new ButtonBuilder()
      .setCustomId(`reaction_use_${game.gameId}`)
      .setLabel(`React: ${name}`)
      .setStyle(ButtonStyle.Danger);
    const btnSkip = new ButtonBuilder()
      .setCustomId(`reaction_skip_${game.gameId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);
    await thread.send(sanitizeMentions({
      content: `<@${defOwnerId}> — You have **${name}** in hand! React to this attack?`,
      allowedMentions: { users: [defOwnerId] },
      components: [new ActionRowBuilder().addComponents(btnUse, btnSkip)],
    })).catch(discordCatch);
    return true;
  }
  // Agitate (Cam Droid): on hit, defender's group must activate next, if able
  if (hit && combat.surgeAgitate && combat.target?.figureKey) {
    const defenderDcName = dcNameFromFigureKey(combat.target.figureKey);
    game.agitateNextActivation = { playerNum: defenderPlayerNum, dcName: defenderDcName };
    const defLabel = combat.target.label || defenderDcName;
    await thread.send(`**Agitate** — **${defLabel}**'s group must be the next to activate this round, if able.`).catch(discordCatch);
  }
  // Fell Swoop (Davith Elso): "After this attack resolves, become
  // Hidden, move up to 2 spaces, then perform an attack. Limit once
  // per round."
  //
  // Move-X 2-space budget: routes through pendingMoveX (immediate,
  // per-effect, no bank). Hide + free-attack flag fire alongside; the
  // free attack is gated separately by fellSwoopFreeAttack[msgId].
  // Fell Swoop inline disabled 2026-05-09 → fireFellSwoop. Fire handler
  // applies Hide + presents Move 2 picker; chain attack waits for
  // defender step 8 to close (combat._pendingChainAttacks).
  if (false && combat.surgeFellSwoop && combat.attackerFigureKey) { // eslint-disable-line no-constant-condition
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
    if (!game.roundFigureAbilityUsed[fsKey]) {
      game.roundFigureAbilityUsed[fsKey] = true;
      _applyCondition(game, combat.attackerFigureKey, 'Hide');
      game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
      game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
      const attName = combat.attackerDisplayName || dcNameFromFigureKey(combat.attackerFigureKey);
      await thread.send(`**Fell Swoop** — **${attName}** becomes **Hidden** and may **move up to 2 spaces**, then make a free attack.`).catch(discordCatch);
      // Stamp pendingMoveX with the freeAttackPrompt continuation so
      // the player gets an explicit "Declare Attack" button after
      // the move picker drains.
      const { stampPendingMoveX, postMoveXPicker } = await import('../handlers/move-x-handler.js');
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
  }
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (combat.surgeMastery && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const mastKey = `${combat.attackerFigureKey}_mastery`;
    if (!game.roundFigureAbilityUsed[mastKey]) {
      game.roundFigureAbilityUsed[mastKey] = true;
      // Rest in Peace: block discard-pile retrieval
      if (game.restInPeaceActive) {
        await thread.send('**Mastery** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).').catch(discordCatch);
      } else {
        const mastPlayerNum = combat.attackerPlayerNum;
        const mastDiscardKey = ccDiscardKey(mastPlayerNum);
        const mastDiscard = game[mastDiscardKey] || [];
        const mastEligible = mastDiscard.filter((cardName) => {
          const entry = getCcEffect(cardName);
          return entry && (entry.cost ?? 99) <= 1 && String(entry.playableBy || '').toUpperCase().includes('FORCE USER');
        });
        if (mastEligible.length === 0) {
          await thread.send(`**Mastery** — No eligible FORCE USER Command cards (cost \u2264 1) in your discard pile.`).catch(discordCatch);
        } else {
          setPendingMastery(game, { gameId: game.gameId, attackerPlayerNum: mastPlayerNum, discardKey: mastDiscardKey, eligible: mastEligible, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum });
          const mastOwnerId = getPlayerId(game, mastPlayerNum);
          const mastBtns = mastEligible.slice(0, 4).map((cardName, i) =>
            new ButtonBuilder().setCustomId(`mastery_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
          );
          mastBtns.push(new ButtonBuilder().setCustomId(`mastery_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send(sanitizeMentions({
            content: `<@${mastOwnerId}> **Mastery** — Choose a FORCE USER CC (cost \u2264 1) from your discard pile to return to hand:`,
            allowedMentions: { users: [mastOwnerId] },
            components: [new ActionRowBuilder().addComponents(mastBtns)],
          })).catch(discordCatch);
          return true;
        }
      }
    }
  }
  // Interrogate (Agent Blaise): look at opponent's hand, choose a CC; may discard equal/greater cost to force discard.
  if (combat.surgeInterrogate) {
    const intAttackerPlayerNum = combat.attackerPlayerNum;
    const intOpponentPlayerNum = defenderPlayerNum;
    const intOpponentHandKey = ccHandKey(intOpponentPlayerNum);
    const intOpponentHand = game[intOpponentHandKey] || [];
    if (intOpponentHand.length === 0) {
      await thread.send(`**Interrogate** — Opponent's hand is empty; no card to choose.`).catch(discordCatch);
    } else {
      setPendingInterrogate(game, { gameId: game.gameId, attackerPlayerNum: intAttackerPlayerNum, opponentPlayerNum: intOpponentPlayerNum, opponentHandSnapshot: [...intOpponentHand], chosenCardName: null, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum });
      const intOwnerId = getPlayerId(game, intAttackerPlayerNum);
      const intBtns = intOpponentHand.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      await thread.send(sanitizeMentions({
        content: `<@${intOwnerId}> **Interrogate** — \u26A0\uFE0F *Opponent: look away!* Pick the card you want to target:`,
        allowedMentions: { users: [intOwnerId] },
        components: [new ActionRowBuilder().addComponents(intBtns)],
      })).catch(discordCatch);
      return true;
    }
  }
  // Military Efficiency (Leia Organa): player picks 1 CC from discard to shuffle back into deck
  if (combat.surgeMilitaryEfficiency && combat.attackerPlayerNum) {
    const mePlayerNum = combat.attackerPlayerNum;
    const meDiscardKey = ccDiscardKey(mePlayerNum);
    const meDiscard = game[meDiscardKey] || [];
    if (game.restInPeaceActive) {
      await thread.send('**Military Efficiency** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).').catch(discordCatch);
    } else if (meDiscard.length === 0) {
      await thread.send(`**Military Efficiency** — No cards in discard pile to return.`).catch(discordCatch);
    } else {
      setPendingMilitaryEfficiency(game, {
        gameId: game.gameId,
        attackerPlayerNum: mePlayerNum,
        discardKey: meDiscardKey,
        eligible: [...meDiscard],
        resultText,
        combat,
        initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        defenderPlayerNum,
      });
      const meOwnerId = getPlayerId(game, mePlayerNum);
      const meBtns = meDiscard.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`me_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
      );
      meBtns.push(new ButtonBuilder().setCustomId(`me_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send(sanitizeMentions({
        content: `<@${meOwnerId}> **Military Efficiency** — Choose a Command card from your discard pile to shuffle back into your deck:`,
        allowedMentions: { users: [meOwnerId] },
        components: [new ActionRowBuilder().addComponents(meBtns)],
      })).catch(discordCatch);
      return true;
    }
  }
  return false;
}

/**
 * Send result to thread, clear combat/roll UI, refresh DC embeds and board.
 */
export async function finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client, deps) {
  const {
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    dcNameFromFigureKey, parseFigureKey, opponentPlayerNum, discordCatch,
    healHp,
    getDcList, getDcMessageIds, getDcStats, getDcEffect, getDcEffects, getDcKeywords,
    getPlayerId, getPlayAreaId, getMapData,
    isWithinN, hasLineOfSight,
    hasFigureLineOfSight, getFigureFootprint, getAllFigureFootprints,
    getFigureSize,
    findDcMessageIdForFigure, getFigureLabel,
    getCcHand, getCcEffectsData,
    _applyCondition,
    grantMovementBank, grantPowerTokens,
    renderDcEmbed,
    buildBoardMapPayload,
    updateDcActionsMessage, ensureMovementBankMessage, updateMovementBankMessage,
    sendPowerTokenOverflowUI,
    applyIndiscriminateFireSplash,
    ButtonBuilder, ButtonStyle, ActionRowBuilder,
    syncHealthStateToList,
  } = deps;

  const thread = await fetchCombatThread(client, combat.combatThreadId);
  await thread.send(resultText);
  // Lure of the Dark Side: after attack resolves, the chosen (forced)
  // hostile figure suffers Strain. Routes through applyStrain so
  // Fireproof immunity, Headhunter, Under Duress, and the per-strain
  // damage/discard choice all fire correctly.
  if (combat.isLure && combat.lurePostAttackStrain > 0 && combat.attackerFigureKey) {
    await thread.send(`**Lure of the Dark Side** — **${combat.attackerDcName}** suffers ${combat.lurePostAttackStrain} Strain.`).catch(discordCatch);
    await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat }, {
      figureKey: combat.attackerFigureKey,
      controllerPlayerNum: combat.attackerPlayerNum,
      amount: combat.lurePostAttackStrain,
      source: 'Lure of the Dark Side',
    });
  }
  // Hit and Run: stamp Move-X picker after the attack resolves. Per
  // rule 2 (in-activation special-action MP grant) — spend at once,
  // remainder discarded (no banking). The card text reads "gain N
  // movement points" (not "move X spaces"), so bypassCosts is FALSE
  // — each step honors +1 difficult terrain / +1 hostile-figure
  // adders, with the figure's movement profile (Mobile / Massive /
  // Efficient Travel) overriding via getMovementProfile.
  const pending = game.hitAndRunPendingMp;
  if (pending && pending.msgId === combat.attackerMsgId && pending.amount > 0) {
    const n = pending.amount;
    delete game.hitAndRunPendingMp;
    if (combat.attackerFigureKey) {
      try {
        const { setupPendingMoveX } = await import('../handlers/move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction, saveGames: deps?.saveGames }, {
          msgId: pending.msgId,
          figureKey: combat.attackerFigureKey,
          playerNum: combat.attackerPlayerNum,
          spaces: n,
          source: 'Hit and Run',
          threadId: combat.combatThreadId,
          bypassCosts: false,
        });
        const ownerId = getPlayerId(game, combat.attackerPlayerNum);
        await logGameAction(game, client, `Hit and Run: <@${ownerId}> gains **${n}** MP after the attack — spend at once, remainder lost.`, { allowedMentions: { users: [ownerId] }, phase: 'ACTION', icon: 'card' });
      } catch (err) {
        console.error('[combat-bridge] Hit and Run picker stamp failed:', err?.message ?? err);
      }
    }
  }
  // --- Post-combat ability prompts (before clearing pendingCombat) ---
  const pcAttEff = getDcEffect(combat.attackerDcName);
  const pcAttIds = pcAttEff?.specialAbilityIds || [];
  const pcOwnerId = getPlayerId(game, combat.attackerPlayerNum);
  // Sidewinder inline disabled 2026-05-09 → fireSidewinder (step-8
  // attacker button posts the same yes/skip prompt).
  if (false && pcAttIds.includes('sidewinder') && combat.attackerMsgId != null) { // eslint-disable-line no-constant-condition
    const swKey = combat.attackerFigureKey + '_sidewinder';
    if (!game.roundFigureAbilityUsed?.[swKey]) {
      await thread.send(sanitizeMentions({
        content: `<@${pcOwnerId}> **Sidewinder** — Suffer 1 Strain to move up to 2 spaces? (once per round)`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sidewinder_apply_${game.gameId}_${combat.attackerMsgId}_${combat.attackerFigureIndex ?? 0}`).setLabel('Suffer 1 Strain \u2192 Move up to 2 spaces').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`sidewinder_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
      })).catch(discordCatch);
    }
  }
  // Boltslinger inline disabled 2026-05-09 → fireBoltslinger.
  if (false && pcAttIds.includes('boltslinger') && game.selectedMap?.id && combat.attackerFigureKey) { // eslint-disable-line no-constant-condition
    const blDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
    const defFigs = game.figurePositions?.[blDefPlayerNum] || {};
    const boltslingerTargets = [];
    for (const [fk, pos] of Object.entries(defFigs)) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
      const { label: blLabel } = getFigureLabel(game, blDefPlayerNum, fk);
      boltslingerTargets.push({ figureKey: fk, playerNum: blDefPlayerNum, label: blLabel });
    }
    if (boltslingerTargets.length > 0) {
      setPendingBoltslinger(game, { gameId: game.gameId, attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: boltslingerTargets });
      const btns = boltslingerTargets.slice(0, 4).map((t, i) =>
        new ButtonBuilder().setCustomId(`boltslinger_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger)
      );
      btns.push(new ButtonBuilder().setCustomId(`boltslinger_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
      await thread.send(sanitizeMentions({
        content: `<@${pcOwnerId}> **Boltslinger** — Choose a hostile within 3 spaces to deal 1 Damage (verify LOS):`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(btns)],
      })).catch(discordCatch);
    }
  }
  // Indiscriminate Fire (Bossk): after attack, if not a miss, choose 1 non-red attack die;
  // each OTHER figure within 2 spaces of target (other than the defender
  // AND other than Bossk himself) suffers Damage = Hits and Strain = Surges
  // on that die. Per destruct 2026-05-08: Bossk excluded.
  // Indiscriminate Fire inline disabled 2026-05-09 → fireIndiscriminateFire.
  if (false && pcAttIds.includes('indiscriminate_fire') && !resultText.includes('**Miss**') && game.selectedMap?.id && combat.target?.figureKey) { // eslint-disable-line no-constant-condition
    const ifDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const targetPos = game.figurePositions?.[ifDefPlayerNum]?.[combat.target.figureKey];
    const rolledDice = combat.attackRoll?.dice || [];
    const nonRedDice = rolledDice.filter((d) => (d.color || '').toLowerCase() !== 'red');
    if (nonRedDice.length > 0 && targetPos) {
      const splashTargets = [];
      for (const pn of [1, 2]) {
        const figs = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(figs)) {
          if (fk === combat.target.figureKey) continue; // defender excluded
          if (fk === combat.attackerFigureKey) continue; // Bossk himself excluded
          if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
          const { label: lbl } = getFigureLabel(game, pn, fk);
          splashTargets.push({ figureKey: fk, playerNum: pn, label: lbl });
        }
      }
      if (nonRedDice.length === 1) {
        await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, deps);
      } else {
        setPendingIndiscriminateFire(game, { attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: splashTargets, availableDice: nonRedDice });
        const ifBtns = nonRedDice.slice(0, 5).map((d, i) =>
          new ButtonBuilder().setCustomId(`indiscriminate_die_${game.gameId}_${i}`).setLabel(`${String(d.color).slice(0, 1).toUpperCase()}${String(d.color).slice(1)} (${d.dmg}dmg/${d.surge}\u21AF)`).setStyle(ButtonStyle.Secondary)
        );
        ifBtns.push(new ButtonBuilder().setCustomId(`indiscriminate_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
        await thread.send(sanitizeMentions({
          content: `<@${pcOwnerId}> **Indiscriminate Fire** — Choose 1 non-red attack die for splash:`,
          allowedMentions: { users: [pcOwnerId] },
          components: [new ActionRowBuilder().addComponents(ifBtns)],
        })).catch(discordCatch);
      }
    }
  }

  // Heavy Fire inline disabled 2026-05-09 → fireHeavyFire.
  if (false && game.selectedMap?.id && combat.target?.figureKey && combat.attackerDcName) { // eslint-disable-line no-constant-condition
    const _hfPlayerNum = combat.attackerPlayerNum;
    const _hfDcList = getDcList(game, _hfPlayerNum) || [];
    const _hfDcMsgIds = getDcMessageIds(game, _hfPlayerNum) || [];
    const _hfIdx = _hfDcList.findIndex(dc => dc.dcName === '[Heavy Fire]');
    if (_hfIdx >= 0) {
      const _hfMsgId = _hfDcMsgIds[_hfIdx];
      const _hfExhausted = _hfMsgId ? (dcExhaustedState.get(_hfMsgId) ?? false) : true;
      if (!_hfExhausted) {
        // Check if attacker is VEHICLE or HEAVY WEAPON
        const _hfAttKws = (getDcKeywords(game)[combat.attackerDcName] || []).map(k => String(k).toUpperCase());
        if (_hfAttKws.includes('VEHICLE') || _hfAttKws.includes('HEAVY WEAPON')) {
          // Count printed attack dice
          const _hfAttEff = getDcEffect(combat.attackerDcName);
          const _hfPrintedDice = _hfAttEff?.attack?.dice || [];
          const _hfDiceCount = _hfPrintedDice.length;
          if (_hfDiceCount > 0) {
            // Find hostile figures within 2 spaces of target space
            const _hfDefPN = opponentPlayerNum(_hfPlayerNum);
            const _hfTargetPos = game.figurePositions?.[_hfDefPN]?.[combat.target.figureKey] || combat._savedTargetPos;
            if (_hfTargetPos) {
              const _hfHostiles = [];
              const _hfDefFigs = game.figurePositions?.[_hfDefPN] || {};
              for (const [fk, pos] of Object.entries(_hfDefFigs)) {
                if (!isWithinN(pos, _hfTargetPos, 2, game.selectedMap.id)) continue;
                const { label: lbl } = getFigureLabel(game, _hfDefPN, fk);
                _hfHostiles.push({ figureKey: fk, playerNum: _hfDefPN, label: lbl });
              }
              if (_hfHostiles.length > 0) {
                const _hfOwnerId = getPlayerId(game, _hfPlayerNum);
                const _hfBtns = [
                  new ButtonBuilder().setCustomId(`heavy_fire_use_${game.gameId}`).setLabel(`Use Heavy Fire (${_hfDiceCount} target${_hfDiceCount !== 1 ? 's' : ''})`).setStyle(ButtonStyle.Danger),
                  new ButtonBuilder().setCustomId(`heavy_fire_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
                ];
                setPendingHeavyFire(game, {
                  attackerPlayerNum: _hfPlayerNum,
                  attackerFigureKey: combat.attackerFigureKey,
                  attackerDcName: combat.attackerDcName,
                  attackerMsgId: combat.attackerMsgId,
                  combatThreadId: combat.combatThreadId,
                  hfMsgId: _hfMsgId,
                  diceCount: _hfDiceCount,
                  hostiles: _hfHostiles,
                  chosenTargets: [],
                  conditionsOwed: 0,
                });
                await thread.send(sanitizeMentions({
                  content: `<@${_hfOwnerId}> **Heavy Fire** — Your **${combat.attackerDcName}** resolved an attack (printed pool: ${_hfDiceCount} dice). Exhaust Heavy Fire to deal 1 Damage to up to ${_hfDiceCount} hostile figure${_hfDiceCount !== 1 ? 's' : ''} within 2 spaces of the target. Then, for each chosen figure, **${combat.attackerDcName}** gains 1 HARMFUL condition of your opponent's choice.`,
                  allowedMentions: { users: [_hfOwnerId] },
                  components: [new ActionRowBuilder().addComponents(_hfBtns)],
                })).catch(discordCatch);
              }
            }
          }
        }
      }
    }
  }

  // Havoc Shot (Fenn Signis): after an attack that didn't miss, suffer
  // 1 Strain to choose up to 2 figures within 2 spaces of the target
  // space in LOS, who suffer 1 Damage. The original target IS eligible
  // to be re-picked (per ruling) — only the attacker is excluded.
  // Havoc Shot inline disabled 2026-05-09 → fireHavocShot.
  if (false && pcAttIds.includes('havoc_shot') && !resultText.includes('**Miss**') && game.selectedMap?.id && combat.target?.figureKey) { // eslint-disable-line no-constant-condition
    const _hsTargetPos = game.figurePositions?.[combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum)]?.[combat.target.figureKey] || combat._savedTargetPos;
    const _hsAtkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
    if (_hsTargetPos && _hsAtkPos) {
      const _hsMapSpaces = getMapData(game.selectedMap.id);
      const _hsAllFootprints = getAllFigureFootprints(game, getFigureSize);
      const _hsAtkFp = getFigureFootprint(game, combat.attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
      const _hsEligible = [];
      for (const pn of [1, 2]) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!pos || fk === combat.attackerFigureKey) continue;
          if (!isWithinN(pos, _hsTargetPos, 2, game.selectedMap.id)) continue;
          const candFp = getFigureFootprint(game, pn, fk, getFigureSize);
          if (!hasFigureLineOfSight(_hsAtkFp, candFp, _hsMapSpaces, _hsAllFootprints)) continue;
          const { label: lbl } = getFigureLabel(game, pn, fk);
          _hsEligible.push({ figureKey: fk, playerNum: pn, label: lbl });
        }
      }
      if (_hsEligible.length > 0) {
        setPendingHavocShot(game, {
          gameId: game.gameId,
          attackerPlayerNum: combat.attackerPlayerNum,
          attackerMsgId: combat.attackerMsgId,
          attackerFigureKey: combat.attackerFigureKey,
          attackerFigureIndex: combat.attackerFigureIndex ?? 0,
          combatThreadId: combat.combatThreadId,
          targets: _hsEligible,
          chosen: [],
          maxPicks: 2,
        });
        const _hsBtns = [
          new ButtonBuilder().setCustomId(`havoc_shot_use_${game.gameId}`).setLabel('Use Havoc Shot (1 Strain)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`havoc_shot_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        ];
        await thread.send(sanitizeMentions({
          content: `<@${pcOwnerId}> **Havoc Shot** — Suffer 1 Strain to deal 1 Damage to up to 2 figures within 2 spaces of the target in your LOS?`,
          allowedMentions: { users: [pcOwnerId] },
          components: [new ActionRowBuilder().addComponents(_hsBtns)],
        })).catch(discordCatch);
      }
    }
  }

  // Deflect inline disabled 2026-05-09 → fireDeflect (defender step-8 button).
  if (false && combat.isRanged && combat.target?.figureKey && game.selectedMap?.id) { // eslint-disable-line no-constant-condition
    const _dflDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _dflAtkPN = combat.attackerPlayerNum;
    // Check defender and adjacent friendlies for deflect
    const _dflMapSpaces = getMapData(game.selectedMap.id);
    const _dflAllFootprints = getAllFigureFootprints(game, getFigureSize);
    // Gather all figures on the defender's team that have deflect and are either the target or adjacent to the target
    const _dflTargetPos = game.figurePositions?.[_dflDefPN]?.[combat.target.figureKey];
    const _dflCandidates = [];
    if (_dflTargetPos) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[_dflDefPN] || {})) {
        if (!pos) continue;
        const dName = dcNameFromFigureKey(fk);
        const dEff = getDcEffect(dName);
        if (!(dEff?.specialAbilityIds || []).includes('deflect')) continue;
        // Must be the target or adjacent to the target
        const isSelf = fk === combat.target.figureKey;
        const isAdj = !isSelf && isWithinN(pos, _dflTargetPos, 1, game.selectedMap.id);
        if (!isSelf && !isAdj) continue;
        _dflCandidates.push({ figureKey: fk, pos, dcName: dName });
      }
    }
    for (const _dflCand of _dflCandidates) {
      // Find hostiles in this figure's LOS
      const _dflHostiles = [];
      const _dflCandFp = getFigureFootprint(game, _dflDefPN, _dflCand.figureKey, getFigureSize);
      for (const [fk, pos] of Object.entries(game.figurePositions?.[_dflAtkPN] || {})) {
        if (!pos) continue;
        const candFp = getFigureFootprint(game, _dflAtkPN, fk, getFigureSize);
        if (!hasFigureLineOfSight(_dflCandFp, candFp, _dflMapSpaces, _dflAllFootprints)) continue;
        const { label: lbl } = getFigureLabel(game, _dflAtkPN, fk);
        _dflHostiles.push({ figureKey: fk, playerNum: _dflAtkPN, label: lbl });
      }
      if (_dflHostiles.length === 0) continue;
      const _dflOwnerId = getPlayerId(game, _dflDefPN);
      if (_dflHostiles.length === 1) {
        // Auto-apply to the only hostile in LOS
        const _dflTgt = _dflHostiles[0];
        const _dflTgtMsgId = findDcMessageIdForFigure(game.gameId, _dflTgt.playerNum, _dflTgt.figureKey);
        if (_dflTgtMsgId) {
          const { figureIndex: _dflFigIdx } = parseFigureKey(_dflTgt.figureKey);
          await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
            figureKey: _dflTgt.figureKey, msgId: _dflTgtMsgId, figIndex: _dflFigIdx,
            amount: 1, controllerPlayerNum: _dflTgt.playerNum,
            source: 'Deflect (Luke)', combat,
          });
          embedRefreshMsgIds.add(_dflTgtMsgId);
        }
        await thread.send(`**Deflect** — **${_dflCand.dcName}**: **${_dflTgt.label}** suffers 1 Damage.`).catch(discordCatch);
        await logGameAction(game, client, `**Deflect** — **${_dflCand.dcName}** redirects 1 Damage to **${_dflTgt.label}**.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        // Multiple hostiles — show picker
        setPendingDeflect(game, {
          gameId: game.gameId,
          deflectorPlayerNum: _dflDefPN,
          deflectorFigureKey: _dflCand.figureKey,
          deflectorDcName: _dflCand.dcName,
          combatThreadId: combat.combatThreadId,
          hostiles: _dflHostiles,
        });
        const _dflBtns = _dflHostiles.slice(0, 4).map((t, i) =>
          new ButtonBuilder().setCustomId(`deflect_pick_${game.gameId}_${i}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger)
        );
        _dflBtns.push(new ButtonBuilder().setCustomId(`deflect_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const _dflRows = chunkButtonsToRows(_dflBtns);
        await thread.send(sanitizeMentions({
          content: `<@${_dflOwnerId}> **Deflect** — **${_dflCand.dcName}** may redirect 1 Damage to a hostile in LOS:`,
          allowedMentions: { users: [_dflOwnerId] },
          components: _dflRows,
        })).catch(discordCatch);
      }
      break; // Only one Deflect trigger per attack
    }
  }

  // Missile Salvo: after each salvo attack, record target + show remaining die buttons
  if (combat.attackerMsgId && game.pendingMissileSalvo?.[combat.attackerMsgId]) {
    const ms = game.pendingMissileSalvo[combat.attackerMsgId];
    if (combat.target?.figureKey) ms.targetsFired = [...(ms.targetsFired || []), combat.target.figureKey];
    if (ms.diceAvailable?.length > 0) {
      const salvoOwnerId = getPlayerId(game, combat.attackerPlayerNum);
      const colorStyle = { blue: ButtonStyle.Primary, red: ButtonStyle.Danger, yellow: ButtonStyle.Secondary };
      const salvoBtns = ms.diceAvailable.map((c) =>
        new ButtonBuilder().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${combat.attackerMsgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || ButtonStyle.Secondary)
      );
      salvoBtns.push(new ButtonBuilder().setCustomId(`missile_salvo_done_${game.gameId}_${combat.attackerMsgId}`).setLabel('End Salvo').setStyle(ButtonStyle.Success));
      await thread.send(sanitizeMentions({
        content: `<@${salvoOwnerId}> **Missile Salvo** — ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining. Choose a die for your next attack (different target):`,
        components: [new ActionRowBuilder().addComponents(salvoBtns)],
        allowedMentions: { users: [salvoOwnerId] },
      })).catch(discordCatch);
    } else {
      delete game.pendingMissileSalvo[combat.attackerMsgId];
      await thread.send('**Missile Salvo** — All shots fired. Salvo complete.').catch(discordCatch);
    }
  }

  // Auto-prompt for post-attack reaction cards (Counter Attack, Dangerous Prey, Payback, etc.)
  try {
    const _ccCardsAll = getCcEffectsData?.()?.cards || {};
    const _postAtkTimings = new Set([
      'afterAttackTargetingYouResolved',
      'afterAttack',
      'afterDamage',
      'afterYouResolveAttackTargetingFigure',
    ]);
    // Defender: cards triggered by being attacked
    const _defPostPn = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _defPostId = getPlayerId(game, _defPostPn);
    const _defPostHand = getCcHand(game, _defPostPn) || [];
    const _defPostCards = [...new Set(_defPostHand)].filter(c => _ccCardsAll[c]?.timing && _postAtkTimings.has(_ccCardsAll[c].timing));
    if (_defPostCards.length) {
      await _sendPrivateReactionPrompt(client, game, _defPostPn, _defPostCards.length, 'attack on you resolved');
    }
    // Attacker: cards triggered by resolving an attack (includes Opportunistic — hostile suffered damage)
    const _atkPostTimings = new Set(['afterAttack', 'afterYouResolveAttackTargetingFigure', 'afterYouResolveAttackThatDidNotMissDueToAccuracy', 'afterHostileFigureSuffersDamage']);
    const _atkPostId = getPlayerId(game, combat.attackerPlayerNum);
    const _atkPostHand = getCcHand(game, combat.attackerPlayerNum) || [];
    const _atkPostCards = [...new Set(_atkPostHand)].filter(c => _ccCardsAll[c]?.timing && _atkPostTimings.has(_ccCardsAll[c].timing));
    if (_atkPostCards.length) {
      await _sendPrivateReactionPrompt(client, game, combat.attackerPlayerNum, _atkPostCards.length, 'attack resolved');
    }
  } catch (_postAtkErr) {
    console.error('Post-attack reaction prompt error:', _postAtkErr?.message ?? _postAtkErr);
  }

  // Return Fire inline disabled 2026-05-09 → fireReturnFire (defender
  // CHAIN attack — staged on combat._pendingDefenderChainAttacks which
  // _finishCombatResolution runs BEFORE attacker chain queue per user
  // 2026-05-09 priority spec).
  if (false) { // eslint-disable-line no-constant-condition
    const _rfDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _rfDefFk = combat.target?.figureKey;
    const _rfDefDcName = _rfDefFk ? dcNameFromFigureKey(_rfDefFk) : null;
    const _rfDefEff = _rfDefDcName ? getDcEffect(_rfDefDcName) : null;
    const _rfDefIds = _rfDefEff?.specialAbilityIds || [];
    const _rfHasReturnFire = _rfDefIds.includes('return_fire') || _rfDefIds.includes('return_fire_migs');
    if (_rfHasReturnFire && _rfDefFk && game.figurePositions?.[_rfDefPN]?.[_rfDefFk]) {
      const _rfKey = `returnFire_${_rfDefFk}`;
      if (!game.roundFigureAbilityUsed?.[_rfKey]) {
        // Han Solo's return_fire requires 0 damage unless Rogue Smuggler upgrade overrides
        let _rfCanFire = true;
        if (_rfDefIds.includes('return_fire') && !_rfDefIds.includes('return_fire_migs')) {
          const _rfDamage = combat._appliedDamage ?? 0;
          const _rfDefMsgId = findDcMessageIdForFigure(game.gameId, _rfDefPN, _rfDefFk);
          const _rfUpgrades = _rfDefMsgId ? (game.p1DcAttachments?.[_rfDefMsgId] || game.p2DcAttachments?.[_rfDefMsgId] || []) : [];
          const _rfHasRogue = cardNameIncludes(_rfUpgrades, 'Rogue Smuggler');
          if (_rfDamage > 0 && !_rfHasRogue) _rfCanFire = false;
        }
        // Combat-pipeline rebuild (slice 6.5 + 8.4): Stunned figures cannot
        // declare attacks (CRR p.58). Return Fire is a triggered out-of-
        // activation attack that requires declaration. If the figure is
        // Stunned, Return Fire is blocked. EXCEPT YWNDM-on-Fifth-Brother:
        // condition effects are suppressed (token placed but inert), so the
        // Stun does not actually block declaration.
        const _rfDefConds = game.figureConditions?.[_rfDefFk] || [];
        const _rfEffectsSuppressed = areConditionEffectsSuppressed(game, _rfDefFk);
        if (_rfCanFire && _rfDefConds.includes('Stun') && !_rfEffectsSuppressed) {
          _rfCanFire = false;
          await logGameAction(game, client, `**Return Fire** suppressed — **${_rfDefDcName}** is Stunned and cannot declare an attack.`, { phase: 'ROUND', icon: 'attack' });
        }
        if (_rfCanFire) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          game.roundFigureAbilityUsed[_rfKey] = true;
          // Set free attack bonus for the defender
          const _rfDefMsgId = findDcMessageIdForFigure(game.gameId, _rfDefPN, _rfDefFk);
          if (_rfDefMsgId) {
            game.freeAttackBonusPending = game.freeAttackBonusPending || {};
            game.freeAttackBonusPending[_rfDefFk] = true;
            game.forcedAttackTarget = game.forcedAttackTarget || {};
            game.forcedAttackTarget[_rfDefMsgId] = combat.attackerFigureKey;
            const _rfOwnerId = getPlayerId(game, _rfDefPN);
            const _rfLabel = _rfDefIds.includes('return_fire_migs') ? 'Return Fire (Migs)' : 'Return Fire';
            await thread.send(sanitizeMentions({
              content: `<@${_rfOwnerId}> **${_rfLabel}** — Interrupt: perform a free attack targeting **${combat.attackerDcName}**! Use the **Attack** button on your DC card.`,
              allowedMentions: { users: [_rfOwnerId] },
            })).catch(discordCatch);
            await logGameAction(game, client, `**${_rfLabel}** — **${_rfDefDcName}** may interrupt to attack **${combat.attackerDcName}**.`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
    }
  }

  // Defensive Fire (Bo-Katan): after resolving a ranged attack (as attacker), gain 1 Block Token
  if (combat.isRanged && combat.attackerFigureKey) {
    const _dfbEff = getDcEffect(combat.attackerDcName);
    if ((_dfbEff?.specialAbilityIds || []).includes('defensive_fire_bokatan')) {
      grantPowerTokens(game, combat.attackerFigureKey, 'Block', 1);
      await thread.send(`**Defensive Fire** — **${combat.attackerDcName}** gains 1 **Block Token** after ranged attack.`).catch(discordCatch);
      await logGameAction(game, client, `**Defensive Fire** — **${combat.attackerDcName}** gains 1 Block Token.`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Dual-Wield Pistols (Bo-Katan): after resolving a ranged attack, free ranged attack once/round
  if (combat.isRanged && combat.attackerFigureKey && combat.attackerMsgId) {
    const _dwpEff = getDcEffect(combat.attackerDcName);
    if ((_dwpEff?.specialAbilityIds || []).includes('dual_wield_pistols_bokatan')) {
      const _dwpKey = `dualWieldPistols_${combat.attackerFigureKey}`;
      if (!game.roundFigureAbilityUsed?.[_dwpKey]) {
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        game.roundFigureAbilityUsed[_dwpKey] = true;
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[combat.attackerFigureKey] = true;
        await thread.send(`**Dual-Wield Pistols** — **${combat.attackerDcName}** may perform a free Ranged attack! Use the **Attack** button.`).catch(discordCatch);
        await logGameAction(game, client, `**Dual-Wield Pistols** — **${combat.attackerDcName}** earns a free Ranged attack.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }

  // Wanton Destruction inline disabled 2026-05-09 → fireWantonDestruction
  // (step-8 attacker button). Click handlers don't close combat directly,
  // so no fromStep8Queue bypass needed.
  if (false && combat.target?.figureKey && game.selectedMap?.id) { // eslint-disable-line no-constant-condition
    const _wdAtkPN = combat.attackerPlayerNum;
    const _wdDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(_wdAtkPN);
    const _wdDcList = getDcList(game, _wdAtkPN) || [];
    const _wdEffects = getDcEffects();
    for (let _wdI = 0; _wdI < _wdDcList.length; _wdI++) {
      const _wdDc = _wdDcList[_wdI];
      if (!_wdDc || _wdDc.defeated) continue;
      const _wdEff = _wdEffects[_wdDc.dcName];
      if (!((_wdEff?.specialAbilityIds || []).includes('wanton_destruction_saw'))) continue;
      // Check Saw is alive (has a figure on the board)
      const _wdFigs = game.figurePositions?.[_wdAtkPN] || {};
      const _wdAlive = Object.keys(_wdFigs).some(fk => fk.startsWith(_wdDc.dcName + '-') && _wdFigs[fk]);
      if (!_wdAlive) continue;
      // Check player has at least 1 CC in hand
      const _wdHand = getCcHand(game, _wdAtkPN) || [];
      if (_wdHand.length === 0) continue;
      // Find eligible figures within 2 spaces of target (both teams, excluding defender)
      const _wdTargetPos = game.figurePositions?.[_wdDefPN]?.[combat.target.figureKey] || combat._savedTargetPos;
      if (!_wdTargetPos) continue;
      const _wdEligible = [];
      for (const pn of [1, 2]) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!pos || fk === combat.target.figureKey) continue;
          if (!isWithinN(pos, _wdTargetPos, 2, game.selectedMap.id)) continue;
          const { label: lbl } = getFigureLabel(game, pn, fk);
          _wdEligible.push({ figureKey: fk, playerNum: pn, label: lbl });
        }
      }
      if (_wdEligible.length === 0) continue;
      const _wdOwnerId = getPlayerId(game, _wdAtkPN);
      setPendingWantonDestruction(game, {
        gameId: game.gameId,
        ownerPlayerNum: _wdAtkPN,
        combatThreadId: combat.combatThreadId,
        targets: _wdEligible,
        chosen: [],
        maxPicks: 2,
      });
      const _wdBtns = [
        new ButtonBuilder().setCustomId(`wanton_use_${game.gameId}`).setLabel('Use (discard 1 CC)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`wanton_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send(sanitizeMentions({
        content: `<@${_wdOwnerId}> **Wanton Destruction** — **${_wdDc.dcName}**: Discard 1 CC to deal 1 Damage to up to 2 figures within 2 spaces of the target?`,
        allowedMentions: { users: [_wdOwnerId] },
        components: [new ActionRowBuilder().addComponents(_wdBtns)],
      })).catch(discordCatch);
      break;
    }
  }

  // Extra Protection window expiry (alexanbv 2026-05-09): EP is a
  // "when damaged" interrupt — once this combat (the inner where the
  // damage event fired) finishes resolving, the window has passed.
  // If the player didn't click Play/Skip in time, expire the prompt
  // so it doesn't get applied against a stale frame after the outer
  // resumes. Match by combatRef identity captured at probe time.
  if (game.pendingExtraProtection?.combatRef === combat) {
    delete game.pendingExtraProtection;
    if (thread) {
      try {
        await thread.send('**Extra Protection** — Window expired (combat resolved without response).').catch(discordCatch);
      } catch {}
    }
  }
  // Capture the most-recently-attacked target by attacker msgId so
  // post-attack abilities (Brutal Cleave, etc.) can enforce "different
  // figure" rules. Cleared at end-of-activation.
  if (combat.attackerMsgId && combat.target?.figureKey) {
    game.lastAttackTargetByMsgId = game.lastAttackTargetByMsgId || {};
    game.lastAttackTargetByMsgId[combat.attackerMsgId] = combat.target.figureKey;
  }
  resolvePendingCombat(game);
  clearPendingCleave(game);
  if (combat.rollMessageId) {
    try {
      const rollMsg = await thread.messages.fetch(combat.rollMessageId);
      await rollMsg.edit({ components: [] }).catch(discordCatch);
    } catch {}
  }
  // Autofire chain attack: grant free attack restricted to within 3 of target
  if (combat.autofireChainPending && combat.attackerMsgId) {
    game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
    game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
    if (combat.autofireChainTargetSpace) {
      game.autofireChainTargetSpace = game.autofireChainTargetSpace || {};
      game.autofireChainTargetSpace[combat.attackerMsgId] = combat.autofireChainTargetSpace;
    }
    await logGameAction(game, client, `**Autofire** — Chain attack available! Target must be within 3 of the original target space.`, { phase: 'ROUND', icon: 'attack' });
  }
  // The Darksaber: "then you may perform an attack" — grant second free attack
  if (game.darksaberSecondAttack?.[combat.attackerMsgId]) {
    delete game.darksaberSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Darksaber Strike' };
    // Clear the override so the second attack uses normal dice
    if (game.pendingOverrideAttackDice?.[combat.attackerMsgId]) delete game.pendingOverrideAttackDice[combat.attackerMsgId];
    await thread.send('**The Darksaber** — You may now perform a normal attack (use Attack button).').catch(discordCatch);
  }
  // Battlefield Leadership (Leia Organa): card text "Perform an attack,
  // then choose another friendly figure within 3 spaces. That figure
  // may interrupt to move up to 1 space and then perform an attack
  // with the same target." Per alexanbv 2026-05-10: Leia's attack
  // must fire FIRST, then the friendly picker auto-fires with the
  // same target captured. Triggers ONCE per Leia activation (gated by
  // _blFiredThisActivation flag on her msgId).
  {
    const _blGetDcEffFn = typeof getDcEffects === 'function' ? getDcEffects : null;
    const _blGetDcEff = _blGetDcEffFn ? _blGetDcEffFn() : {};
    const _blAtkDcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _blAtkEff = _blGetDcEff[_blAtkDcName] || _blGetDcEff[(_blAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const _blHasAbility = (_blAtkEff?.specialAbilityIds || []).includes('battlefield_leadership');
    const _blMsgId = combat.attackerMsgId;
    const _blAlreadyFired = _blMsgId ? !!(game._blFiredThisActivation?.[_blMsgId]) : true;
    if (_blHasAbility && !_blAlreadyFired && combat.defenderFigureKey) {
      game._blFiredThisActivation = game._blFiredThisActivation || {};
      game._blFiredThisActivation[_blMsgId] = true;
      const _blPlayerNum = combat.attackerPlayerNum;
      const _blLeiaPos = game.figurePositions?.[_blPlayerNum]?.[combat.attackerFigureKey];
      const _blEligible = [];
      if (_blLeiaPos) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[_blPlayerNum] || {})) {
          if (!pos || fk === combat.attackerFigureKey) continue;
          if (countGameSpaces(game, _blLeiaPos, pos) > 3) continue;
          _blEligible.push(fk);
        }
      }
      if (_blEligible.length > 0) {
        game.pendingBattlefieldLeadership = {
          leiaMsgId: _blMsgId,
          leiaFigureKey: combat.attackerFigureKey,
          capturedTargetFigureKey: combat.defenderFigureKey,
          eligibleFigureKeys: _blEligible,
          playerNum: _blPlayerNum,
        };
        const _blOwnerId = game[`player${_blPlayerNum}Id`];
        const _blBtns = _blEligible.slice(0, 4).map((fk) =>
          new ButtonBuilder()
            .setCustomId(`bl_friendly_${game.gameId}_${fk}`)
            .setLabel(`${dcNameFromFigureKey(fk)}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        _blBtns.push(
          new ButtonBuilder()
            .setCustomId(`bl_friendly_${game.gameId}_skip`)
            .setLabel('Skip Battlefield Leadership')
            .setStyle(ButtonStyle.Secondary)
        );
        await thread.send({
          content: `<@${_blOwnerId}> **Battlefield Leadership** — Choose a friendly figure within 3 of Leia. They may move up to 1 space (terrain ignored) and perform a free attack against the same target (**${dcNameFromFigureKey(combat.defenderFigureKey)}**).`,
          components: [new ActionRowBuilder().addComponents(_blBtns)],
          allowedMentions: { users: [_blOwnerId] },
        }).catch(discordCatch);
      }
    }
  }

  // Focus Fire: after first attack, enforce same target for second attack
  if (game.focusFireActive?.[combat.attackerFigureKey]) {
    const ff = game.focusFireActive[combat.attackerFigureKey];
    ff.attacksRemaining -= 1;
    if (ff.attacksRemaining > 0) {
      // Store first target — second attack must hit the same figure
      game.forcedAttackTarget = game.forcedAttackTarget || {};
      game.forcedAttackTarget[combat.attackerMsgId] = combat.defenderFigureKey;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Focus Fire' };
      await thread.send(`**Focus Fire** — 1 attack remaining. Must target the **same figure**. Use the Attack button.`).catch(discordCatch);
    } else {
      delete game.focusFireActive[combat.attackerFigureKey];
    }
  }
  // Multi-Fire: after first attack, enforce different target + apply -1 Hit for second attack
  if (game.multiFireActive?.[combat.attackerFigureKey]) {
    const mf = game.multiFireActive[combat.attackerFigureKey];
    mf.attacksRemaining -= 1;
    if (mf.attacksRemaining > 0) {
      mf.firstTargetFigureKey = combat.defenderFigureKey;
      // Block same target for second attack
      game.multiFireBlockedTarget = game.multiFireBlockedTarget || {};
      game.multiFireBlockedTarget[combat.attackerFigureKey] = combat.defenderFigureKey;
      // Apply -1 Hit to second attack too
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerMsgId] = { bonusHits: -1 };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Multi-Fire' };
      await thread.send(`**Multi-Fire** — 1 attack remaining. Must target a **different figure** (\u22121 Hit). Use the Attack button.`).catch(discordCatch);
    } else {
      delete game.multiFireActive[combat.attackerFigureKey];
      if (game.multiFireBlockedTarget?.[combat.attackerFigureKey]) delete game.multiFireBlockedTarget[combat.attackerFigureKey];
    }
  }
  // Overheated (Paz Vizsla): -1 Hit re-stamped for 2nd attack; attack
  // type flips to Melee after BOTH attacks complete (per CRR last-thing
  // ordering). Ranged for both attacks; swap is the closing step.
  // Per IACP rule 2026-05-09: keyed per-figureKey so each figure in a
  // multifigure group has its own Overheated chain.
  if (game.overheatedActive?.[combat.attackerFigureKey]) {
    const oh = game.overheatedActive[combat.attackerFigureKey];
    oh.attacksRemaining -= 1;
    if (oh.attacksRemaining > 0) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerMsgId] = { bonusHits: -1, source: 'Overheated' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Overheated' };
      await thread.send(`**Overheated** — 1 Ranged attack remaining (−1 Hit). Use the Attack button.`).catch(discordCatch);
    } else {
      delete game.overheatedActive[combat.attackerFigureKey];
      // Last thing: attack type becomes Melee for the rest of the round.
      game.attackTypeOverride = game.attackTypeOverride || {};
      game.attackTypeOverride[combat.attackerFigureKey] = 'melee';
      await thread.send(`**Overheated** — Both attacks resolved. Attack type is now **Melee** for the rest of the activation.`).catch(discordCatch);
    }
  }
  // Saber Orbit (Second Sister): re-apply override dice for remaining chained attacks
  // Per IACP rule 2026-05-09: keyed per-figureKey so each figure in a
  // multifigure group has its own Saber Orbit budget.
  if (game.saberOrbitAttacksRemaining?.[combat.attackerFigureKey] > 0) {
    game.saberOrbitAttacksRemaining[combat.attackerFigureKey] -= 1;
    const soRemaining = game.saberOrbitAttacksRemaining[combat.attackerFigureKey];
    if (soRemaining > 0) {
      // Re-set the override dice for the next Saber Orbit attack
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerMsgId] = { dice: ['red'], type: 'melee', pierce: 0, bonusAccuracy: 0 };
      await thread.send(`**Saber Orbit** — ${soRemaining} attack${soRemaining !== 1 ? 's' : ''} remaining (1 red die, Melee). Use the Attack button.`).catch(discordCatch);
    } else {
      delete game.saberOrbitAttacksRemaining[combat.attackerFigureKey];
      await thread.send('**Saber Orbit** — All attacks resolved.').catch(discordCatch);
    }
  }

  // Bladestorm inline disabled 2026-05-09 → fireBladestorm (step-8 attacker
  // button, routes through applyDamage so when-damaged hooks fire).
  if (false && combat.postAttackAoeDamage > 0 && combat.hit) { // eslint-disable-line no-constant-condition
    const aoeDmg = combat.postAttackAoeDamage;
    const aoeRange = combat.postAttackAoeRange || 2;
    const atkFk = combat.attackerFigureKey;
    const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[atkFk];
    const defPn = combat.defenderPlayerNum;
    if (atkPos) {
      const aoeParts = [];
      for (const [fk, coord] of Object.entries(game.figurePositions?.[defPn] || {})) {
        if (!coord || fk === combat.defenderFigureKey) continue;
        const dist = countGameSpaces(game, atkPos, coord);
        if (dist > aoeRange) continue;
        const fMsgId = findDcMessageIdForFigure(game.gameId, defPn, fk);
        if (!fMsgId) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          const newCur = Math.max(0, (cur ?? max) - aoeDmg);
          hs[figIdx] = [newCur, max];
          dcHealthState.set(fMsgId, hs);
          syncHealthStateToList(game, defPn, fMsgId, hs);
          aoeParts.push(`**${dcNameFromFigureKey(fk)}** ${aoeDmg} Dmg (${cur ?? max}\u2192${newCur})`);
          if (!embedRefreshMsgIds.includes(fMsgId)) embedRefreshMsgIds.push(fMsgId);
        }
      }
      if (aoeParts.length > 0) {
        await thread.send(`**Bladestorm** — Hostiles within ${aoeRange} spaces: ${aoeParts.join(', ')}`).catch(discordCatch);
      }
    }
  }
  // Blood Feud: check if defender's DC has a persistent Blood Feud marker → auto +1 Hit
  if (combat.hit && game.bloodFeudTargets?.[combat.defenderMsgId] && game.bloodFeudTargets[combat.defenderMsgId] === combat.attackerPlayerNum) {
    // Already applied during CC play for the first attack; for subsequent attacks the bonus is applied in combat.js pre-roll
  }

  for (const msgId of embedRefreshMsgIds) {
    try {
      const meta = dcMessageMeta.get(msgId);
      if (meta) {
        const channelId = getPlayAreaId(game, meta.playerNum);
        const channel = await fetchGameChannel(client, channelId);
        if (!channel) continue;
        const dcMsg = await channel.messages.fetch(msgId);
        const { embed, files } = await renderDcEmbed(game, msgId, deps);
        await dcMsg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update DC embed:', err);
    }
  }
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after attack:', err);
    }
  }
  // Refresh activation thread minimap after combat (conditions/actions may have changed)
  if (combat.attackerMsgId) {
    await updateDcActionsMessage(game, combat.attackerMsgId, client).catch(discordCatch);
  }
  // G73: Power Token Overflow — if any tokens were granted beyond the cap during combat
  // resolution, prompt the owning player to discard down.
  if (game.pendingPowerTokenOverflow?.length > 0 && thread) {
    // Determine the owning player from the first overflow entry's figureKey
    const _ptOvEntry = game.pendingPowerTokenOverflow[0];
    const _ptOvPlayerNum = Object.entries(game.figurePositions || {}).find(([, figs]) => figs?.[_ptOvEntry.figureKey])?.[0];
    const attackerPlayerNum = combat.attackerPlayerNum;
    const _ptOvPN = _ptOvPlayerNum ? parseInt(_ptOvPlayerNum, 10) : attackerPlayerNum;
    await sendPowerTokenOverflowUI(game, game.gameId, thread, _ptOvPN, saveGames);
  }
  // Parting Shot deferred-defeat resume: if the attacker of THIS combat
  // is the figure that armed Parting Shot, the free attack just resolved
  // — complete the deferred defeat now (per CRR + destruct 2026-05-08).
  // Pass `deps` directly as ctx so processFigureDefeat has all its
  // required dependencies (removeFigurePosition, calculateKillVp, etc.).
  if (game.pendingPartingShot?.active && game.pendingPartingShot.figureKey === combat.attackerFigureKey) {
    const { completeDeferredDefeat } = await import('../handlers/parting-shot.js');
    await completeDeferredDefeat(game, deps);
  }
  // Final Stand deferred-defeat resume (alexanbv 2026-05-10): if the
  // attacker of THIS combat is Baze (the playing figure of an active
  // Final Stand), Baze's free attack just resolved — finalize the
  // ORIGINAL would-be-defeated figure's defeat. Note: Final Stand's
  // target is a DIFFERENT figure than the attacker (unlike Parting Shot
  // where the dying figure is also the attacker).
  if (game.pendingFinalStand?.active && game.pendingFinalStand.playingFigureKey === combat.attackerFigureKey) {
    const { completeDeferredDefeat: completeFinalStand } = await import('../handlers/final-stand.js');
    await completeFinalStand(game, deps);
  }
  // Dying Lunge deferred-defeat resume (alexanbv 2026-05-10): same shape
  // as Parting Shot — the dying figure performs the free attack, then
  // is defeated. completeDyingLungeDefeat reads pendingDyingLunge.
  if (game.pendingDyingLunge?.active && game.pendingDyingLunge.figureKey === combat.attackerFigureKey) {
    const { completeDyingLungeDefeat } = await import('../handlers/before-defeated-ccs.js');
    await completeDyingLungeDefeat(game, deps);
  }
  // Chain-attack queues: defender chain attacks (Return Fire, etc.)
  // resolve FIRST, then attacker chain attacks (Tonfa / Barrage / Flurry /
  // Fell Swoop), per user 2026-05-09: "the defense side return fire
  // takes precedence over a second attack from the attacker."
  const _pdca = Array.isArray(combat._pendingDefenderChainAttacks) ? combat._pendingDefenderChainAttacks : [];
  const _pca = Array.isArray(combat._pendingChainAttacks) ? combat._pendingChainAttacks : [];
  for (const _entry of [..._pdca, ..._pca]) {
    if (!_entry?.msgId) continue;
    if (_entry.flagKey === 'freeAttackBonusPending') {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      // Per IACP rule 2026-05-09: freeAttackBonusPending is per-figureKey.
      // after-attack-fire entries set msgId for routing context, but the
      // free-attack flag must be keyed by the figure that gets the attack
      // — the original attacker's figureKey for chain-attack queues, the
      // defender's figureKey for Return Fire / defender chain queues.
      const _fabFkForEntry = _entry.figureKey
        || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_fabFkForEntry) game.freeAttackBonusPending[_fabFkForEntry] = _entry.flagValue ?? true;
    } else if (_entry.flagKey === 'fellSwoopFreeAttack') {
      game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
      game.fellSwoopFreeAttack[_entry.msgId] = _entry.flagValue ?? true;
    }
    if (_entry.pendingOverrideAttackDice) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_entry.msgId] = _entry.pendingOverrideAttackDice;
    }
    if (_entry.barrageTargetSpace) {
      game.barrageTargetSpace = game.barrageTargetSpace || {};
      game.barrageTargetSpace[_entry.msgId] = _entry.barrageTargetSpace;
    }
    if (_entry.barrageDefenseBonus) {
      game.barrageDefenseBonus = game.barrageDefenseBonus || {};
      game.barrageDefenseBonus[_entry.msgId] = true;
    }
    // Return Fire (defender chain) forces target onto the original attacker.
    if (_entry.forcedTargetFigureKey) {
      game.forcedAttackTarget = game.forcedAttackTarget || {};
      game.forcedAttackTarget[_entry.msgId] = _entry.forcedTargetFigureKey;
    }
    if (_entry.message && thread) {
      await thread.send(_entry.message).catch(discordCatch);
    }
  }
}
