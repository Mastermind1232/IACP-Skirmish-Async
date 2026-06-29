/**
 * Combat orchestrator functions extracted from index.js.
 * Each function receives an explicit `deps` object carrying closed-over values.
 */

import { processFigureDefeat } from './defeat-handler.js';
import { applyStrain as _applyStrain, triggerBleedAfterAction as _triggerBleedAfterAction } from '../handlers/strain-handler.js';
import { setupPendingMoveX as _setupPendingMoveX } from '../handlers/move-x-handler.js';
import { cardNameIncludes } from '../game/card-names.js';
import { squadUpgradeFigureCard } from '../game/squad-upgrades.js';
import { resolvePendingCombat } from '../game/combat-stack.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { fetchCombatThread, fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { getHandChannelId, getPlayerId as _getPlayerIdHelper, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { findSmugglingCompartmentMsgId } from '../game/smuggling-compartment.js';
import { discordCatch as _discordCatchH } from '../error-handling.js';

import { getDcEffect, effectiveDcNameForFigure } from '../game/dc-helpers.js';
import { grantPowerTokens as _grantPowerTokensHelper } from '../game/game-helpers.js';
import { isDcUnique } from '../data-loader.js';
import { evaluateRoundModifiers } from '../game/round-modifiers.js';
import { exhaustAttachment } from '../game/card-state-helpers.js';
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
export async function _sendPrivateReactionPrompt(client, game, playerNum, count, contextLabel) {
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
  enqueueAfterResolveGateAbilities as _enqueueAfterResolveGateAbilities,
  postPostResolveWindow as _postPostResolveWindow,
} from '../handlers/after-attack-resolve.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { clearPendingCleave, setPendingCoverFire, setPendingReaction, setPendingSuppressiveFireMp, setPendingSuppressiveFireOptin, setPendingAssassinsBlade, setPendingMastery, setPendingMilitaryEfficiency, setPendingInterrogate } from '../game/interrupts.js';

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
    getPlayerId, findDcMessageIdForFigure,
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

  // Dual-Wield Pistols (Bo-Katan): deferred Block-token grant + once-per-round
  // limit. The card's "Before performing this bonus Ranged attack, you gain 2
  // Block Tokens" is CONTINGENT on actually performing the bonus attack — so the
  // offer site (checkPostCombatSurges) only stamps a pending marker; the grant
  // and the once-per-round flag fire HERE, when the bonus attack is actually
  // performed (its rolls resolve). Declining the bonus never burns the limit and
  // never grants tokens. Stale markers (left over from a forfeited bonus in a
  // prior round) are dropped without granting. See P3 / audit 2026-06-26.
  if (combat.attackerFigureKey && game.dwpBlockGrantPending?.[combat.attackerFigureKey]) {
    const _dwpPend = game.dwpBlockGrantPending[combat.attackerFigureKey];
    delete game.dwpBlockGrantPending[combat.attackerFigureKey];
    if (_dwpPend && _dwpPend.round === (game.currentRound || 1)) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      if (_dwpPend.dwpKey) game.roundFigureAbilityUsed[_dwpPend.dwpKey] = true;
      if (_dwpPend.grantBlock) {
        _grantPowerTokensHelper(game, combat.attackerFigureKey, 'Block', 2);
        const _dwpName = _dwpPend.dcName || dcNameFromFigureKey(combat.attackerFigureKey);
        await logGameAction(game, client, `**Dual-Wield Pistols** — **${_dwpName}** gains 2 Block Tokens before her bonus Ranged attack.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }

  // Two scope variants:
  //   nextAttacksBonusHits[figureKey] — per-figure (Size Advantage,
  //     Maximum Firepower).
  //   groupNextAttacksBonusHits[playerNum] — group-activation scope
  //     (Beatdown). Per IACP "your group's activation" applies to any
  //     friendly figure's attack during the activating group's cycle.
  // Per-figure consumed first when both present; group bonus applies
  // to any subsequent attack from any of the player's figures.
  // SMALL-target check for requiresSmallTarget-gated bonuses (Size Advantage,
  // CSV row 720). SMALL = not LARGE / MASSIVE per the target's keywords.
  const _saTargetIsSmall = (() => {
    const _tFk = combat.target?.figureKey;
    if (!_tFk) return false;
    const _tKws = (getDcEffect(effectiveDcNameForFigure(game, _tFk))?.keywords || []).map(k => String(k).toUpperCase());
    return !(_tKws.includes('LARGE') || _tKws.includes('MASSIVE'));
  })();
  // On the Hunt (CSV row 396): +1 Damage only when targeting a unique hostile
  // figure. The attack target (combat.target) is always hostile; check uniqueness.
  const _othTargetIsUnique = (() => {
    const _tFk = combat.target?.figureKey;
    if (!_tFk) return false;
    return isDcUnique(dcNameFromFigureKey(_tFk));
  })();
  {
    const pendingFig = game.nextAttacksBonusHits?.[combat.attackerFigureKey];
    // A pending entry applies if it grants any of Hit bonus, Blast, or Accuracy.
    // (Bombardment grants Blast 1 only — no Accuracy, no Hit bonus; alexanbv 2026-06-21.)
    const _pfGrants = pendingFig && pendingFig.count > 0
      && ((pendingFig.bonus > 0) || (pendingFig.blast > 0) || (pendingFig.accuracy > 0));
    if (_pfGrants && (!pendingFig.requiresSmallTarget || _saTargetIsSmall) && (!pendingFig.requiresUniqueHostileTarget || _othTargetIsUnique)) {
      if (pendingFig.bonus > 0) combat.bonusHits = (combat.bonusHits || 0) + pendingFig.bonus;
      if (pendingFig.blast > 0) combat.bonusBlast = (combat.bonusBlast || 0) + pendingFig.blast;
      if (pendingFig.accuracy > 0) combat.bonusAccuracy = (combat.bonusAccuracy || 0) + pendingFig.accuracy;
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
    if (condFig && condFig.count > 0 && condFig.conditions?.length && (!condFig.requiresSmallTarget || _saTargetIsSmall)) {
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
  // Per-figure active round-modifier registry (alexanbv 2026-06-20). Replaces the
  // old per-player round-scoped defense flags (roundDefenseBonusBlock /
  // roundDefenseBonusEvade / roundDefenseAccuracyPenalty / roundDeflectionAccuracyPenalty
  // / roundVehicleDefenseBonusEvade / roundDefenderBonusBlockPerEvade). Each card
  // is now evaluated against THIS defending figure's conditions at the moment it
  // defends, so e.g. an EOR-phase attack against a non-VEHICLE figure gets no
  // Fuel Upgrade Evade, and Deflection's penalty applies only to a Ranged attack
  // targeting the figure that played it.
  const _defFk = combat.target?.figureKey || null;
  if (_defFk) {
    const _defMods = evaluateRoundModifiers(game, {
      side: 'defense',
      figureKey: _defFk,
      playerNum: defenderPlayerNum,
      combat,
    });
    if (_defMods.block) combat.bonusBlock = (combat.bonusBlock || 0) + _defMods.block;
    if (_defMods.evade) combat.bonusEvade = (combat.bonusEvade || 0) + _defMods.evade;
    if (_defMods.accuracyPenalty) combat.defenderAccuracyPenalty = (combat.defenderAccuracyPenalty || 0) + _defMods.accuracyPenalty;
    // Personal Energy Shield: +N Block per Evade result (self figure only).
    if (_defMods.blockPerEvade && combat.defenseRoll) {
      combat.bonusBlock = (combat.bonusBlock || 0) + (combat.defenseRoll.evade || 0) * _defMods.blockPerEvade;
    }
    // Choose a Side (SCUM) Personal Combat Shield (+1 Evade per Block spent) is
    // applied at Block-spend time in handlers/combat.js
    // (applyPersonalCombatShieldOnBlockSpend, which re-evaluates the registry).
  }
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
  // Per-figure attacker round-modifier evaluation (alexanbv 2026-06-20). Replaces
  // the old per-player roundTrooperAttackHitBonus. Cavalry Charge's +1 Hit now
  // applies only when THIS attacking figure is a TROOPER within 3 spaces of the
  // card-playing figure. Surge (Smuggled Supplies) and reroll (Just Business /
  // Battlefield Awareness) eligibility are evaluated PER-FIGURE at their own
  // consumption points (handlers/combat.js) via the same evaluator, so an
  // ineligible attacking figure (wrong keyword / out of range / not Scum) gets
  // nothing — including EOR-phase attacks.
  if (combat.attackerFigureKey) {
    const _atkMods = evaluateRoundModifiers(game, {
      side: 'attack',
      figureKey: combat.attackerFigureKey,
      playerNum: combat.attackerPlayerNum,
      combat,
    });
    if (_atkMods.hit) combat.bonusHits = (combat.bonusHits || 0) + _atkMods.hit;
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
        // Target footprint cells (for Reduce to Rubble's "within 2 of the
        // target space" damage clause — alexanbv 2026-06-20).
        game.lastAttackTargetCellsForRubble = [...targetCells];
        game.lastAttackAttackerPlayerNum = attackerPlayerNum;
      }
    }
  }
  const ownerId = getPlayerId(game, attackerPlayerNum);
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const { figureIndex: targetFigIndex } = parseFigureKey(combat.target.figureKey);

  // Figurehead (Murne Rin) is a STRAIN reaction, NOT a Damage reaction
  // (alexanbv 2026-06-20: "Figurehead is for STRAIN not damage"; the CSV is
  // wrong). The combat-DAMAGE interrupt that used to live here was removed —
  // Figurehead does not intercept attack Damage. The Strain reaction (Murne may
  // suffer 1 Strain to prevent 1 of a friendly-within-4's Strain) is wired in
  // the strain pipeline (strain-handler.js).
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
  // Track that an attack was performed during this activation (for On a
  // Diplomatic Mission, etc.). Per alexanbv 2026-05-13: keyed by the
  // ATTACKING FIGURE, not the group's msgId — each figure in a multi-
  // figure group has its own independent activation and the "1 attack
  // per activation" cap is per-figure (Assault relaxes that for the
  // figure, not the group).
  if (combat.attackerFigureKey) {
    game.attackPerformedThisActivation = game.attackPerformedThisActivation || {};
    game.attackPerformedThisActivation[combat.attackerFigureKey] = true;
    // Blend In (K-2SO): "Discard this card ... when you declare an attack."
    // Clear the untargetable protection for the attacking figure and drop the
    // attachment when K-2SO attacks.
    if (game.blendInUntargetable?.[combat.attackerFigureKey]) {
      const _biEntry = game.blendInUntargetable[combat.attackerFigureKey];
      delete game.blendInUntargetable[combat.attackerFigureKey];
      if (_biEntry?.msgId) {
        const _biAttKey = combat.attackerPlayerNum === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
        const _biList = game[_biAttKey]?.[_biEntry.msgId];
        if (Array.isArray(_biList)) game[_biAttKey][_biEntry.msgId] = _biList.filter(n => n !== 'Blend In');
      }
    }
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
      // Unified Blast pipeline (alexanbv 2026-06-15 "exactly one pipeline for
      // blast no matter the target"): the attacker's surge-Blast is NOT applied
      // inline here. Set the blast target-context and funnel into the SAME
      // after-attack window the figure path uses (single fireBlast for every
      // target). The crate's splashOnDefeat (2 within 1) handled above is the
      // mission-specific ON-DEFEATED effect and stays in the object-damage step.
      const _crateCoord = String(game.objectPositions?.[objectId] || origCoord).toLowerCase();
      combat._blastTargetCoord = _crateCoord;
      combat._blastTargetSize = '1x1';
      combat._step7Hit = hit;
      combat._step7Damage = damage;
      combat._step8Conditions = []; // objects don't receive conditions (CRR p.13)
      await _runOrDeferAfterResolve(thread, game, combat, { resultText, embedRefreshMsgIds: new Set(), ownerId, defenderPlayerNum }, client, deps);
      return;
    }
    // Thug / Krykna
    const npcArray = combat.target.npcType === 'thug' ? game.npcThugs : game.npcKrykna;
    const npc = npcArray?.[combat.target.npcIndex];
    let _npcStep8Conditions = [];
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
          // Conditions (thug/krykna are FIGURES — CRR p.13) now route through the
          // unified after-attack window via _step8Conditions, NOT inline, so they
          // resolve in-sequence with the same harmful→target / beneficial→attacker
          // routing fireCondition applies (alexanbv 2026-06-15 "nothing out of sequence").
          _npcStep8Conditions = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])]
            .map((_nc) => ({ condition: _nc, recipient: HARMFUL_CONDITIONS.includes(_nc) ? 'target' : 'attacker' }));
        }
      }
    }
    // Unified after-attack pipeline (alexanbv 2026-06-15 "exactly one pipeline
    // for blast no matter the target; nothing should apply out of sequence"): set
    // the blast target-context + queued conditions and funnel into the SAME
    // after-attack window every other target uses (single fireBlast; conditions
    // via fireCondition). No inline apply, no early resolvePendingCombat — combat
    // finishes through the window / after_resolve gate.
    if (npc) {
      combat._blastTargetCoord = String(npc.coord).toLowerCase();
      combat._blastTargetSize = '1x1';
    }
    combat._step7Hit = hit;
    combat._step7Damage = damage;
    combat._step8Conditions = _npcStep8Conditions;
    await _runOrDeferAfterResolve(thread, game, combat, { resultText, embedRefreshMsgIds: new Set(), ownerId, defenderPlayerNum }, client, deps);
    return;
  }

  // Track figures damaged by this figure (for Aim: Rebel Trooper Elite).
  // Per alexanbv 2026-05-13 correction: Aim is per-figure tracking, not
  // per-group. Key by combat.attackerFigureKey.
  if (damage > 0 && combat.attackerFigureKey && combat.target?.figureKey) {
    game.activationDamagedFigures = game.activationDamagedFigures || {};
    game.activationDamagedFigures[combat.attackerFigureKey] = game.activationDamagedFigures[combat.attackerFigureKey] || [];
    if (!game.activationDamagedFigures[combat.attackerFigureKey].includes(combat.target.figureKey)) {
      game.activationDamagedFigures[combat.attackerFigureKey].push(combat.target.figureKey);
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
        sendPrivateReactionPrompt: _sendPrivateReactionPrompt,
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
      // Stun Batons inline disabled 2026-05-09 → fireStunBatons (already
      // wired in the dispatcher; enqueue probe lives in
      // enqueueAttackerPerDcEffects and routes through applyStrain so
      // Fireproof / Headhunter / when-damaged hooks fire uniformly).
      // Critical Hit moved 2026-05-09 to surge-spend phase
      // (handlers/combat.js — applies immediately when the surge is
      // chosen, per user clarification that it's a non-keyword surge).
      // Self-Preservation inline disabled 2026-05-09 — fires via the
      // self_preservation_hired_gun_elite WHEN_DAMAGED hook in
      // damage-pipeline-hooks.js (correct timing per user: when damage
      // is suffered, not after attack resolves). Inline was double-applying.
      // Fury of Kashyyyk Focus-on-damage — REMOVED 2026-06-16 (alexanbv: "Focus
      // upon damage is a when-damaged effect"). It is the WHEN_DAMAGED hook
      // 'fury_of_kashyyyk' (damage-pipeline-hooks.js), which already fired during
      // the main applyDamage call; this inline copy was a redundant duplicate.
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

      // Fly-By / Jets (Jet Trooper E/R) — MIGRATED 2026-06-16 to player-ordered
      // after_resolve buttons (enqueueAttackerPerDcEffects → fireFlyBy/fireJets),
      // per alexanbv "any ability that requires movement/choice should be fixed"
      // (nothing auto out of sequence).
      // Leg Hydraulics (Tress Hacnua): handled via specialAbilityIds check below (not passives) to avoid double-granting
      // Locked and Loaded (Migs Mayfeld) + Open-Minded (Del Meeko) — MIGRATED
      // 2026-06-16 to player-ordered after_resolve buttons
      // (enqueueAttackerPerDcEffects -> fireLockedAndLoaded / fireOpenMinded), so
      // the token-type / MP-vs-token choices happen in sequence, not auto out of
      // order (alexanbv "nothing auto").
      // Nimble (Asajj Ventress) — REMOVED 2026-05-06 (Asajj removed from game
      // per destruct's 2026-05-05 ruling). Session 8.1-8.3 of combat-rebuild.
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
      // Distracting Fire inline disabled 2026-05-09 → fireDistractingFire
      // (attacker step-8 button per user 2026-05-09 categorization).
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
          // Per alexanbv 2026-05-13: per-figureKey (kills are per-figure).
          if (combat.attackerFigureKey) {
            game.activationKills[combat.attackerFigureKey] = (game.activationKills[combat.attackerFigureKey] || 0) + 1;
            // Celebration (CSV row 573): only a UNIQUE hostile defeat counts.
            if (targetDcName && isDcUnique(targetDcName)) {
              game.activationUniqueKills = game.activationUniqueKills || {};
              game.activationUniqueKills[combat.attackerFigureKey] = (game.activationUniqueKills[combat.attackerFigureKey] || 0) + 1;
            }
          }
          if (isDbConfigured() && achievementsChannelId) {
            const _akUserId = getPlayerId(game, attackerPlayerNum);
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId, 'activation_kills', game.activationKills[combat.attackerFigureKey])
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
        // Price on Their Heads: award bounty VP to the setter only when the LAST
        // figure of the marked group is defeated (CSV row 778 — was firing on
        // every figure's defeat; alexanbv 2026-06-20). processFigureDefeat above
        // has already removed the just-defeated figure from figurePositions, so
        // "no figure of the group remains" means this was the last one.
        const _priceBounty = game.priceBounties?.[combat.target.label];
        const _pbDcName = dcNameFromFigureKey(combat.target.figureKey);
        const _pbDg = (combat.target.label || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] || '1';
        const _pbGroupAlive = Object.keys(game.figurePositions?.[defenderPlayerNum] || {}).some((k) => k.startsWith(`${_pbDcName}-${_pbDg}-`));
        if (_priceBounty && !_pbGroupAlive) {
          const _bountyAmt = typeof _priceBounty === 'object' ? _priceBounty.amount : _priceBounty;
          const _bountySetterNum = typeof _priceBounty === 'object' ? _priceBounty.playerNum : attackerPlayerNum;
          awardObjectiveVp(game, _bountySetterNum, _bountyAmt);
          delete game.priceBounties[combat.target.label];
          const _bountyVpK = vpKey(_bountySetterNum);
          await logGameAction(game, client, `**Price on Their Heads** — +${_bountyAmt} VP bounty awarded to P${_bountySetterNum} (${game[_bountyVpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // Paid in Beskar is resolved via the when_defeated prompt path
        // (damage-pipeline-hooks paid_in_beskar_prompt → defeat-cc-prompts →
        // the whenDefeatHostileWithin3GainBlockTokens effect, which grants to the
        // nearest friendly within 3 of the DEFEATED figure). The old
        // attacker-only / attacker→target-range / one-shot-via-flag path that
        // was here is removed (alexanbv 2026-06-19).
        // Worth Every Credit: bonus VP when hostile is defeated this activation
        if (game.nextHostileDefeatVpBonus?.[attackerPlayerNum]) {
          const _wecData = game.nextHostileDefeatVpBonus[attackerPlayerNum];
          const _wecAmt = typeof _wecData === 'object' ? (_wecData.amount ?? 2) : _wecData;
          awardObjectiveVp(game, attackerPlayerNum, _wecAmt);
          delete game.nextHostileDefeatVpBonus[attackerPlayerNum];
          await logGameAction(game, client, `**Worth Every Credit** — +${_wecAmt} bonus VP (${game[_vpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // You Will Not Deny Me: on a hostile defeat, the ATTACKER's Fifth Brother
        // recovers 2 HP → card goes to game box. Per-player (the beneficiary is
        // whoever defeated the hostile). alexanbv 2026-06-17.
        if (game.youWillNotDenyMeActive?.[attackerPlayerNum]) {
          const _ywndmPn = attackerPlayerNum;
          const _fifthKey = Object.keys(game.figurePositions?.[_ywndmPn] || {}).find(k => dcNameFromFigureKey(k).toLowerCase().includes('fifth brother'));
          if (_fifthKey) {
            const _fifthMsgId = (() => { for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _ywndmPn && mm.dcName?.toLowerCase().includes('fifth')) return mid; } return null; })();
            if (_fifthMsgId) {
              const { healed: _fifthHealed } = healHp(dcHealthState, game, _fifthMsgId, 0, 2, _ywndmPn);
              if (_fifthHealed > 0) {
                await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother recovered 2 HP after hostile defeat. Card returns to game box.`, { phase: 'ROUND', icon: 'card' });
              }
              delete game.youWillNotDenyMeActive[_ywndmPn];
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
                  defeatedPlayerNum: _ywndmPn,
                  figureKey: _fifthKey,
                  attackerPlayerNum: attackerPlayerNum != null ? attackerPlayerNum : (_ywndmPn === 1 ? 2 : 1),
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
            // alexanbv 2026-06-14: defer the Hide to AFTER the unconditional
            // "attacker loses Hidden after attacking" strip below (same pattern
            // as deferredSurgeHide) — applying it here gets it immediately
            // stripped, so Guerrilla never actually left the figure Hidden.
            combat.deferredGuerrillaHide = true;
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
        // Defeat-triggered reaction CCs (whenHostileFigureDefeated*,
        // whenOneOfYourFiguresDefeated, afterUniqueHostileDefeated) are now
        // offered by the damage pipeline's WHEN_DEFEATED CC-play window
        // (damage-pipeline.js _notifyCcPlayWindow / CC_TIMINGS_WHEN_DEFEATED),
        // fired at the moment of defeat. No inline prompt here.
      }
    }
    if (combat.superchargeStrainAfterAttackCount > 0 && combat.attackerMsgId != null) {
      // Supercharge / Sustained by Rage post-attack strain: route through
      // the canonical applyStrain pipeline (Fireproof / Headhunter /
      // per-strain choice / Under Duress / Paz).
      await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
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
    // alexanbv 2026-06-16: blast emanates from the DECLARED target square for a
    // large target (a single square), not the whole footprint — "blast affects the
    // target square". 1x1 targets are unchanged (their square IS their coord).
    combat._blastTargetCoord = combat.targetSquare || _targetCoordBeforeDefeat;
    combat._blastTargetSize = combat.targetSquare ? '1x1' : _targetSizeBeforeDefeat;
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
  // Mak Eshka'rey "Critical Hit" surge: "...if the target suffered 1 or more
  // Damage during this attack, it may not play command cards this round." The
  // surge-spend phase only sets combat.surgeCriticalHitPending; the CC-lockout
  // is deferred to here where the per-attack damage total is known. Mirror how
  // other "after damage, if it dealt damage" step-8 effects gate on
  // combat._step7Damage. Only block CCs when the target actually took >=1 dmg.
  if (combat.surgeCriticalHitPending && (combat._step7Damage || 0) >= 1) {
    game.criticalHitBlockedPlayer = combat.defenderPlayerNum;
    await logGameAction(game, client, `\u{1F3AF} **Critical Hit** — **${combat.target?.label || 'Defender'}** suffered ${combat._step7Damage} Damage; that player's Command cards are blocked for the rest of this round.`, { phase: 'ROUND', icon: 'card' });
  }
  // 0-0-0 "Shocking Palm" surge: "The attack misses and the defender becomes
  // Stunned." computeCombatResult forces hit=false (real miss, 0 damage), so
  // the normal damage>0 step-8 condition assembly above is skipped. Apply the
  // Stun UNCONDITIONALLY here — append it to _step8Conditions so it lands via
  // the same fireCondition path (immunity / Fireproof / Punishing Strike all
  // honoured at click time) in both the fully-blocked and would-have-dealt-
  // damage cases. Harmful → target (the defender).
  if (combat.attackMissAndStun && targetMsgId
      && !(combat.target?.isCrate || combat.target?.npcType === 'crate')) {
    combat._step8Conditions = Array.isArray(combat._step8Conditions) ? combat._step8Conditions : [];
    if (!combat._step8Conditions.some((e) => e?.condition === 'Stun')) {
      combat._step8Conditions.push({ condition: 'Stun', recipient: 'target' });
    }
  }
  // Discard consumed conditions post-combat. Then re-apply any conditions
  // granted via surge: focus / surge: hide AFTER the discard, per destruct
  // 2026-05-07 ("hidden is discarded, and then reacquired"). Same logic
  // applies to Focus.
  // Burst Fire / Crippling Blow / Disruptor Rifle / Electro-pulse /
  // Quick Strike all migrated 2026-05-09 to step-8 fire handlers
  // (after-attack-fire.js). Legacy inline blocks disabled below.
  // Crippling Blow inline disabled 2026-05-09 → fireCripplingBlow.
  // Disruptor Rifle inline disabled 2026-05-09 → fireDisruptorRifle.
  // Tonfa Strike inline disabled 2026-05-09 → fireTonfaStrike (chain-attack
  // queued, fires after defender step 8 closes per user spec).
  // Barrage inline disabled 2026-05-09 → fireBarrage. Per-figureKey 2026-05-13.
  // Imperial Loadout post-attack effects.
  // Electro-pulse + Quick Strike migrated 2026-05-09 to step-8 fire
  // handlers (after-attack-fire.js); their inline branches gate on `false`.
  // Flurry of Blows is a chain-attack ability; that migration lands with
  // the rest of the chain-attack effects in a separate slice.
  if (combat.loadoutPostAttack) {
    const _lpa = combat.loadoutPostAttack;
    // Electro-pulse (Electrohammer): each other figure adjacent to target suffers 1 Damage
    // Quick Strike (Electrostaff): if defender rerolled/modified dice, defender suffers 1 Damage.
    // Inline disabled 2026-05-09 → fireQuickStrike.
    // Flurry of Blows inline disabled 2026-05-09 → fireFlurryOfBlows
    // (chain-attack staged, fires after defender step 8 closes).
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
              await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread, sendPrivateReactionPrompt: _sendPrivateReactionPrompt }, {
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
  // Suppressive Fire (Skirmish Upgrade): "Exhaust… (may)" after a Ranged attack
  // that did not miss → Weaken target + 2 MP to a SMALL friendly within 3.
  // Gate on the non-miss `hit` flag, NOT damage>0: a fully-blocked hit (damage 0)
  // is still "not a miss". The effect is opt-in — present a Yes/Skip prompt and
  // only apply on opt-in (see applySuppressiveFireEffect / sf_optin handler).
  const _sfUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _sfExh = game.exhaustedSkirmishUpgrades?.[combat.attackerMsgId] || [];
  if (cardNameIncludes(_sfUpgrades, 'Suppressive Fire') && !cardNameIncludes(_sfExh, 'Suppressive Fire') && combat.isRanged && hit) {
    const _sfTargetName = dcNameFromFigureKey(combat.target?.figureKey) || combat.defenderDcName;
    setPendingSuppressiveFireOptin(game, {
      attackerPlayerNum,
      attackerMsgId: combat.attackerMsgId,
      attackerFigureKey: combat.attackerFigureKey,
      targetFigureKey: combat.target?.figureKey || null,
      targetName: _sfTargetName,
      combatThreadId: combat.combatThreadId,
    });
    await thread.send(sanitizeMentions({
      content: `**Suppressive Fire** — <@${ownerId}> You may exhaust **Suppressive Fire**: Weaken **${_sfTargetName}**, then a SMALL friendly figure within 3 gains 2 MP.`,
      allowedMentions: { users: [ownerId] },
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sf_optin_yes_${game.gameId}`).setLabel('Exhaust Suppressive Fire').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sf_optin_no_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      )],
    })).catch(discordCatch);
  }
  // Flame Trooper Incinerate: after attacking, each figure that suffered damage suffers 1 Strain (HP loss). Place Rubble in target space.
  const _ftAtkUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _ftBlastRefreshMsgIds = [];
  // Incinerate is the FLAME TROOPER FIGURE's ability — only fires when the Flame
  // Trooper Squad Upgrade figure itself is the attacker, not a group-mate.
  // alexanbv 2026-06-17.
  const _ftAttacking = cardNameIncludes(_ftAtkUpgrades, 'Flame Trooper')
    && squadUpgradeFigureCard(game, combat.attackerFigureKey) === 'Flame Trooper';
  if (_ftAttacking && hit) {
    // Apply 1 Strain (1 HP loss) to target if it suffered damage and survived
    if (damage > 0 && targetMsgId) {
      // Fireproof: target immune to Strain if it also has Flame Trooper attachment
      const _ftTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
      // Fireproof + per-strain choice + Headhunter handled by applyStrain.
      // Defeat finalization on the damage branch is handled inside the
      // strain pipeline (applyStrain → _applyDamageFromStrain).
      const _ftHsBefore = dcHealthState.get(targetMsgId);
      if (_ftHsBefore?.[targetFigIndex]?.[0] > 0) {
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
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
      // FUTURE — PLAYER-CHOSEN RESOLUTION ORDER (alexanbv 2026-06-23, NOT YET
      // BUILT): multi-figure strain (here, Incinerate-on-Blast) is applied per
      // figure (correct) but in FIXED order. The controller of the affected
      // figures should choose the order each suffers Strain / is defeated.
      // Search tag: "PLAYER-CHOSEN RESOLUTION ORDER" (note in damage-pipeline.js).
      for (const { figureKey: _ftBlastFk, playerNum: _ftBlastPn } of _ftBlastAdj) {
        // Fireproof is per-figure: only the Flame Trooper FIGURE itself is immune
        // to Incinerate Blast Strain, not other figures in its group. alexanbv
        // 2026-06-17. (applyStrain re-checks Fireproof, but skip + log here too.)
        if (squadUpgradeFigureCard(game, _ftBlastFk) === 'Flame Trooper') continue;
        const _ftBlastMsgId = findDcMessageIdForFigure(game.gameId, _ftBlastPn, _ftBlastFk);
        if (!_ftBlastMsgId) continue;
        const _ftBlastHsBefore = dcHealthState.get(_ftBlastMsgId);
        if (!_ftBlastHsBefore?.[parseFigureKey(_ftBlastFk).figureIndex] || _ftBlastHsBefore[parseFigureKey(_ftBlastFk).figureIndex][0] <= 0) continue;
        // Strain via the canonical applyStrain pipeline (Fireproof /
        // Headhunter / per-strain choice / Under Duress / Paz).
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
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
  // Dying Lunge / Final Stand: attacker defeats itself after the attack
  // resolves. Per alexanbv 2026-05-13: per-figureKey.
  if (game.selfDefeatsAfterAttackMsgId?.[combat.attackerFigureKey] && combat.attackerFigureKey) {
    delete game.selfDefeatsAfterAttackMsgId[combat.attackerFigureKey];
    const _sdaMsgId = combat.attackerMsgId;
    const _sdaFigKey = combat.attackerFigureKey;
    const _sdaFigIdx = combat.attackerFigureIndex ?? 0;
    if (_sdaFigKey) {
      const _sdaPrevHs = dcHealthState.get(_sdaMsgId);
      if (_sdaPrevHs?.[_sdaFigIdx]) {
        const _sdaMaxHp = _sdaPrevHs[_sdaFigIdx][1] ?? _sdaPrevHs[_sdaFigIdx][0] ?? 99;
        await _applyDamage(game, { dcHealthState, logGameAction, client, deps, thread, sendPrivateReactionPrompt: _sendPrivateReactionPrompt }, {
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
      await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
        figureKey: combat.target.figureKey,
        controllerPlayerNum: defenderPlayerNum,
        amount: combat.surgeHarass,
        source: 'Surge Harass',
      });
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Harass** — **${combat.target.label}** suffers **${combat.surgeHarass}** Strain`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Suppression (Biv Bodhrik): "if it did not miss DUE TO ACCURACY" — so it fires
  // even on an uncancelled-Dodge miss (the Strain amount even counts dodge
  // results). Gated on accuracy-sufficiency, NOT the full not-miss `hit` flag
  // (alexanbv 2026-06-22).
  if (combat._accuracySufficient && targetMsgId) {
    if (combat.surgeSuppressionStrain) {
      const supRoll = combat.defenseRoll || {};
      // Biv Bodhrik "Suppression": Strain = number of Block + Evade + Dodge
      // results (max 2). dodge is a numeric COUNT (recalcDefenseTotals sums
      // it), so use the count — not a binary 0/1 — so a 2-dodge roll yields 2.
      const supAmt = Math.min((supRoll.block || 0) + (supRoll.evade || 0) + (supRoll.dodge || 0), 2);
      if (supAmt > 0) {
        await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
          figureKey: combat.target.figureKey,
          controllerPlayerNum: defenderPlayerNum,
          amount: supAmt,
          source: 'Suppression',
        });
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Suppression** — **${combat.target.label}** suffers **${supAmt}** Strain (${supRoll.block || 0} block, ${supRoll.evade || 0} evade${supRoll.dodge ? `, ${supRoll.dodge} dodge` : ''})`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Mandalorian Steel: if a friendly figure WITHIN 4 SPACES of The Armorer spent a
  // Block Token this attack, recover 1 Damage on the defending figure (CSV row 743
  // target "a friendly figure within 4 spaces" of The Armorer).
  if (combat.defenderSpentBlock && game.mandaAsteelPlayerNum === defenderPlayerNum && targetMsgId) {
    // Resolve The Armorer's current position and require the defender to be within 4.
    const _msArmorerFk = game.mandaAsteelArmorerFigureKey;
    const _msArmorerPos = _msArmorerFk ? game.figurePositions?.[defenderPlayerNum]?.[_msArmorerFk] : null;
    const _msDefPos = combat.target?.figureKey ? game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey] : null;
    const _msWithin4 = !!(_msArmorerPos && _msDefPos && countGameSpaces(game, _msArmorerPos, _msDefPos) <= 4);
    if (_msWithin4) {
      const { healed } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
      if (healed > 0) {
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Mandalorian Steel** — **${combat.target.label}** spent a Block Token within 4 spaces of The Armorer; recovered 1 Damage`, { phase: 'ROUND', icon: 'card' });
      }
    }
  }

  // Stalk Prey — migrated to step-8 button window (slice 2b, destruct
  // 2026-05-08). fireStalkPrey reads combat.surgeStalkPrey flag and
  // clears it; enqueue probe is in enqueueAttackerPerDcEffects.
  // No miss clause (CSV cond=None) — refresh the attacker embed whenever the
  // surge was spent, even on a miss, so the +2 MP / Damage-Token grant shows.
  if (combat.surgeStalkPrey && combat.attackerMsgId) {
    embedRefreshMsgIds.add(combat.attackerMsgId);
  }
  // Squad Command (Kayn Somos surge): Focus an adjacent friendly TROOPER.
  // Per destruct 2026-05-08: ACS (Advanced Com Systems) extends "adjacent"
  // → "within 3" for Kayn's abilities. CSV: "Choose AN adjacent friendly
  // TROOPER; that figure becomes Focused." When 2+ TROOPERs are eligible the
  // player must pick WHICH — mirror the Cover Fire post-attack picker (post a
  // squad_command_focus_* button row; click handler applies Focus). When
  // exactly 1 is eligible, auto-Focus (no meaningful choice). alexanbv
  // 2026-06-21.
  // Squad Command (Kayn Somos surge): a SPECIAL surge that resolves even on a
  // MISS — surges are spent before the miss/accuracy/dodge check, and special
  // surges (Leia, Kayn, gain-token, recover) still go through on a miss
  // (alexanbv 2026-06-22). So NO `hit` gate. Range = adjacent (1), extended to
  // within 3 when Advanced Com Systems is attached to Kayn.
  if (combat.surgeSquadCommand && game.selectedMap?.id && combat.attackerFigureKey) {
    // ACS check on Kayn's DC msgId.
    const _sqAtkMsgId = combat.attackerMsgId;
    const _sqAtts = (game.p1DcAttachments?.[_sqAtkMsgId] || game.p2DcAttachments?.[_sqAtkMsgId] || []);
    const _sqHasACS = _sqAtts.some((a) => /Advanced Com Systems/i.test(String(a)));
    const _sqRange = _sqHasACS ? 3 : 1;
    const _sqAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    // within-N check: isWithinN/getMapData are NOT module-scoped here — take them
    // from deps (the same source computeCleaveEligibleTargets uses). Without
    // these the range filter was silently skipped, so Squad Command Focused ANY
    // friendly TROOPER on the board regardless of distance (alexanbv 2026-06-22).
    const _sqWithinN = deps?.isWithinN, _sqGetMap = deps?.getMapData;
    if (_sqAtkPos) {
      // Collect ALL eligible adjacent/within-3 friendly TROOPERs.
      const _sqEligible = [];
      for (const [sqFk, sqPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (sqFk === combat.attackerFigureKey || !sqPos) continue;
        if (typeof _sqWithinN === 'function' && typeof _sqGetMap === 'function'
          && !_sqWithinN(sqPos, _sqAtkPos, _sqRange, game.selectedMap.id, _sqGetMap)) continue;
        const sqDcName = dcNameFromFigureKey(sqFk);
        const sqEff = getDcEffect(sqDcName);
        const sqKws = (sqEff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!sqKws.includes('TROOPER')) continue;
        _sqEligible.push({ fk: sqFk, dcName: sqDcName });
      }
      if (_sqEligible.length === 1) {
        // Exactly one eligible — no choice, auto-Focus.
        const { fk: sqFk, dcName: sqDcName } = _sqEligible[0];
        if (_applyCondition(game, sqFk, 'Focus')) {
          const sqMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, sqFk);
          if (sqMsgId) embedRefreshMsgIds.add(sqMsgId);
          await logGameAction(game, client, `**Squad Command**${_sqHasACS ? ' (ACS within 3)' : ''} — **${sqDcName}** is now **Focused**`, { phase: 'ROUND', icon: 'card' });
        }
      } else if (_sqEligible.length > 1) {
        // 2+ eligible — the player chooses WHICH TROOPER to Focus.
        game.pendingSquadCommand = {
          gameId: game.gameId,
          playerNum: attackerPlayerNum,
          candidates: _sqEligible.map((e) => e.fk),
          hasACS: _sqHasACS,
        };
        if (thread && ButtonBuilder && ButtonStyle) {
          const _sqBtns = _sqEligible.slice(0, 20).map(({ fk, dcName }) =>
            new ButtonBuilder()
              .setCustomId(`squad_command_focus_${game.gameId}_${attackerPlayerNum}_${fk}`)
              .setLabel(String(dcName).slice(0, 80))
              .setStyle(ButtonStyle.Primary));
          const _sqRows = chunkButtonsToRows(_sqBtns);
          await thread.send(sanitizeMentions({ content: `**Squad Command**${_sqHasACS ? ' (ACS within 3)' : ''} — <@${ownerId}> Choose a friendly TROOPER to become **Focused**:`, allowedMentions: { users: [ownerId] }, components: _sqRows })).catch(discordCatch);
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
  // Limit once per round (IACP 2026-06-21): key by attacker figure (not the
  // attack/message id) so it fires at most once per round per CT-1701 figure.
  // roundFigureAbilityUsed is cleared to {} at round start (ROUND_OBJECT_FLAGS).
  const _cfKey = `coverFire_${combat.attackerFigureKey}`;
  if ((_cfAttEff?.passives || []).includes('Cover Fire') && combat.attackerMsgId && combat.attackerFigureKey && !game.roundFigureAbilityUsed?.[_cfKey]) {
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
    // If the attack did not miss (a fully-blocked hit, damage 0, still
    // counts — only a Miss disqualifies), offer to discard a condition or
    // power token from the target.
    if (hit && combat.target?.figureKey) {
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
  // destruct 2026-05-08: post-resolve unified window, extracted to
  // runAfterResolveWindow (the body the rebuild's `after_resolve` gate owns).
  // alexanbv 2026-06-15 "proceed with the separation": when the attack walks the
  // gate sequence, the DAMAGE step runs only the core (everything above); the
  // separate after_resolve GATE step runs the window. Stash the crossing locals
  // (the Set as an array so they survive a serialize) and return; the damage step
  // sees combat._afterResolveArgs and advances to the after_resolve gate, which
  // calls the bound runAfterResolveWindow. Legacy path (_seqActive unset) is
  // byte-for-byte unchanged.
  // "-ed"-form NOT-MISS surge conditions (e.g. Zuckuss Stun Net: "after this
  // attack resolves, if it did not miss, the target becomes Stunned"). These
  // resolve on ANY hit (not-miss), even at 0 damage — unlike the inline
  // "Surge: Stun/Weaken" keywords, which require damage. Append them to
  // _step8Conditions here (after the damage-gated assembly, so this augments it
  // and also covers the hit-but-0-damage case). Objects never receive conditions.
  // (alexanbv 2026-06-22)
  if (hit && targetMsgId && (combat.surgeNoMissConditions || []).length
    && !(combat.target?.isCrate || combat.target?.npcType === 'crate')) {
    combat._step8Conditions = Array.isArray(combat._step8Conditions) ? combat._step8Conditions : [];
    for (const _nc of combat.surgeNoMissConditions) {
      if (!combat._step8Conditions.some((e) => e?.condition === _nc)) {
        combat._step8Conditions.push({ condition: _nc, recipient: HARMFUL_CONDITIONS.includes(_nc) ? 'target' : 'attacker' });
      }
    }
  }

  await _runOrDeferAfterResolve(thread, game, combat, { resultText, embedRefreshMsgIds, ownerId, defenderPlayerNum }, client, deps);
}

/**
 * Apply the Suppressive Fire effect once the attacker has opted in: Weaken the
 * attack target, exhaust the attachment, then grant 2 MP to a SMALL friendly
 * figure within 3 spaces (auto-grant if exactly one, picker if many). Shared by
 * combat-bridge (legacy) and the sf_optin Yes handler. `send(content[, components])`
 * is an injected channel/thread sender; `logGameAction`/`client`/`saveGames` are deps.
 */
export async function applySuppressiveFireEffect(game, { send, client, logGameAction, saveGames }, { attackerPlayerNum, attackerMsgId, attackerFigureKey, targetFigureKey, targetName, combatThreadId }) {
  // Apply Weaken to the target, then exhaust Suppressive Fire (effect resolves).
  if (targetFigureKey && !isConditionImmune(game, targetFigureKey)) {
    _applyCondition(game, targetFigureKey, 'Weaken');
  }
  exhaustAttachment(game, attackerMsgId, 'Suppressive Fire');
  const _sfTargetName = targetName || dcNameFromFigureKey(targetFigureKey);
  // Find SMALL friendly figures within 3 spaces of attacker for MP grant.
  const _sfAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
  const _sfSmallFriendlies = [];
  if (_sfAttackerPos) {
    const _sfEffects = getDcEffects();
    for (const [_sfFk, _sfPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
      if (!_sfPos || _sfFk === attackerFigureKey) continue;
      if (countGameSpaces(game, _sfAttackerPos, _sfPos) > 3) continue;
      const _sfDcName = dcNameFromFigureKey(_sfFk);
      const _sfKwds = (_sfEffects[_sfDcName]?.keywords || []).map(k => String(k).toUpperCase());
      if (_sfKwds.includes('LARGE') || _sfKwds.includes('MASSIVE')) continue;
      const _sfFigMsgId = findDcMessageIdForFigure(game.gameId, attackerPlayerNum, _sfFk);
      if (_sfFigMsgId) _sfSmallFriendlies.push({ fk: _sfFk, msgId: _sfFigMsgId, dcName: _sfDcName });
    }
  }
  if (_sfSmallFriendlies.length === 1) {
    const _sfF = _sfSmallFriendlies[0];
    try {
      const { setupPendingMoveX } = await import('../handlers/move-x-handler.js');
      await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
        msgId: _sfF.msgId,
        figureKey: _sfF.fk,
        playerNum: attackerPlayerNum,
        spaces: 2,
        source: 'Suppressive Fire',
        threadId: combatThreadId,
        bypassCosts: false,
      });
      await send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. **${_sfF.dcName}** gains **2 MP** — spend at once, no bank.`);
    } catch (err) {
      console.error('[combat-bridge] Suppressive Fire auto-grant picker stamp failed:', err?.message ?? err);
    }
    await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened; **${_sfF.dcName}** gains 2 MP (spend immediately, no bank).`, { phase: 'ROUND', icon: 'card' });
  } else if (_sfSmallFriendlies.length > 1) {
    setPendingSuppressiveFireMp(game, { attackerPlayerNum });
    const _sfBtns = _sfSmallFriendlies.map(({ fk, dcName }) =>
      new ButtonBuilder().setCustomId(`sf_mp_pick_${game.gameId}_${fk}`).setLabel(dcName).setStyle(ButtonStyle.Primary)
    );
    const _sfRows = [];
    for (let _r = 0; _r < _sfBtns.length; _r += 5) _sfRows.push(new ActionRowBuilder().addComponents(_sfBtns.slice(_r, _r + 5)));
    await send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. Choose a SMALL friendly figure within 3 spaces to gain 2 MP:`, _sfRows);
    await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
  } else {
    await send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. No eligible SMALL friendly figures within 3 spaces for MP grant.`);
    await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
  }
}

/**
 * Run the after_resolve window now, OR — when the attack is walking the gate
 * sequence (_seqActive) — defer it to the after_resolve gate by stashing the
 * crossing locals (the Set as an array so it survives a serialize). Shared by
 * the figure-target tail and the NPC/crate target paths so EVERY target funnels
 * into the same single after-attack pipeline (alexanbv 2026-06-15 "exactly one
 * pipeline for blast no matter the target").
 */
async function _runOrDeferAfterResolve(thread, game, combat, { resultText, embedRefreshMsgIds, ownerId, defenderPlayerNum }, client, deps) {
  if (combat._seqActive) {
    combat._afterResolveArgs = { resultText, embedRefreshMsgIds: [...(embedRefreshMsgIds || [])], ownerId, defenderPlayerNum };
    return;
  }
  await runAfterResolveWindow(thread, game, combat, { resultText, embedRefreshMsgIds, ownerId, defenderPlayerNum }, client, deps);
}

/**
 * Run the attacker's after-attack (after_resolve) window: enqueue the step-8
 * keyword effects (Blast / Cleave / Recover / CCs) + per-DC attacker effects,
 * then post the attacker post-resolve window. Done → defender window → the
 * legacy close path (checkPostCombatSurges, e.g. Return Fire → else
 * finishCombatResolution).
 *
 * Extracted verbatim from the tail of applyDamageAndFinishCombat as the seam for
 * the gate rebuild's damage-vs-after_resolve split (alexanbv 2026-06-15). The
 * legacy resolve calls it at the same point (no behavior change); the sequence
 * driver's `after_resolve` gate step will call it instead of bundling it into
 * the damage step. Crossing locals (resultText, embedRefreshMsgIds, ownerId,
 * defenderPlayerNum) are passed explicitly since they originate earlier in the
 * damage core.
 */
export async function runAfterResolveWindow(thread, game, combat, { resultText, embedRefreshMsgIds, ownerId, defenderPlayerNum }, client, deps) {
  const { checkPostCombatSurges: _checkPostCombatSurges, finishCombatResolution: _finishCombatResolution, filterCondition, _applyCondition, logGameAction } = deps;
  // Focus/Hide discard is the FIRST thing in after_resolve (alexanbv 2026-06-16):
  // pre-existing Focus/Hide are consumed by attacking; surge-gained ones persist
  // (re-applied after the discard). Now runs for EVERY target type incl. NPC/crate,
  // which previously returned before the damage-core discard.
  if (combat.attackerFigureKey) {
    const _hadFocus = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Focus');
    filterCondition(game, combat.attackerFigureKey, 'Focus');  // Focus consumed after attacking
    if (_hadFocus) await logGameAction(game, client, `\u{1F3AF} **Focus** consumed on **${combat.attackerDcName}** \u2014 used in this attack.`, { phase: 'ROUND', icon: 'attack' });
    const _atkHidden = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Hide');
    filterCondition(game, combat.attackerFigureKey, 'Hide');   // Attacker loses Hidden after resolving an attack
    if (_atkHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.attackerDcName}** \u2014 resolved an attack.`, { phase: 'ROUND', icon: 'attack' });
    // Re-apply deferred surge conditions AFTER the discard (so the figure
    // ends the attack with the surge-granted condition rather than having
    // it stripped by the unconditional discard). These are the inline
    // "Surge: Focus" / "Surge: Hide" keyword conditions (Davith's Hide,
    // Officer's Focus) \u2014 the REQUIRES-DAMAGE bucket: they only apply when the
    // attack hit AND the target suffered damage (alexanbv 2026-06-22). Special
    // friendly-Focus surges (Kayn) use their own no-restriction path.
    const _ssCondOk = combat._step7Hit && (combat._step7Damage || 0) > 0;
    if (combat.deferredSurgeFocus) {
      if (_ssCondOk) {
        _applyCondition(game, combat.attackerFigureKey, 'Focus');
        await logGameAction(game, client, `\u{1F3AF} **Focus** applied via Surge to **${combat.attackerDcName}** (post-discard).`, { phase: 'ROUND', icon: 'attack' });
      }
      combat.deferredSurgeFocus = false;
    }
    if (combat.deferredSurgeHide) {
      if (_ssCondOk) {
        _applyCondition(game, combat.attackerFigureKey, 'Hide');
        await logGameAction(game, client, `\uD83D\uDC7B **Hidden** applied via Surge to **${combat.attackerDcName}** (post-discard).`, { phase: 'ROUND', icon: 'attack' });
      }
      combat.deferredSurgeHide = false;
    }
    // Guerrilla (Alliance Ranger) "become Hidden after defeating the target"
    // re-applied here, after the unconditional Hidden strip (alexanbv 2026-06-14).
    if (combat.deferredGuerrillaHide) {
      _applyCondition(game, combat.attackerFigureKey, 'Hide');
      await logGameAction(game, client, `\uD83C\uDF11 **Guerrilla** \u2014 **${combat.attackerDcName}** becomes **Hidden** (defeated the target).`, { phase: 'ROUND', icon: 'card' });
      combat.deferredGuerrillaHide = false;
    }
  }
  if (combat.target?.figureKey) {
    const _defHidden = (game.figureConditions?.[combat.target.figureKey] || []).includes('Hide');
    filterCondition(game, combat.target.figureKey, 'Hide');    // Defender loses Hidden after being attacked
    if (_defHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.target.label}** \u2014 was targeted by an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  // after_resolve builds from TWO components (alexanbv 2026-06-16): (1) the
  // condition gate — every after_resolve ability whose condition is met; then
  // (2) the keyword effects accumulated from mods + surges (Blast/Cleave/Recover/
  // conditions). Both land in the same post-resolve menu, resolved in player order.
  _enqueueAfterResolveGateAbilities(combat, game, deps);
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
  // Stash the close crossing-locals on combat so the LIVE after-resolve "Done"
  // click can reconstruct the close (alexanbv 2026-06-26 root-cause fix). The
  // _aaCtx.afterAttackClose closure above only survives the self-play / inline
  // drain; on the live path the window posts buttons and that closure is
  // discarded — the Done click (handleAarDone, 'postCombat' ctx group) has no
  // afterAttackClose, so finishCombatResolution → resolvePendingCombat never ran
  // and pendingCombat lingered after EVERY combat. _advanceFromSide('defender')
  // reads this to rebuild the close from ctx.checkPostCombatSurges/
  // finishCombatResolution (both in the postCombat ctx group).
  combat._aarCloseArgs = {
    resultText,
    embedRefreshMsgIds: [...(embedRefreshMsgIds || [])],
    ownerId,
    defenderPlayerNum,
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
  // Concussive Bolt inline disabled 2026-05-09 → fireConcussiveBolt
  // (step-8 attacker button, with fromStep8Queue bypass on click handler).
  // Spread the Pain inline disabled 2026-05-09 → fireSpreadThePain
  // (step-8 attacker button + fromStep8Queue bypass on advanceSpreadThePain).
  // Post-attack reactions: check if defender has Payback, Dangerous Prey, or Right Back At Ya!
  const defenderHand = getCcHand(game, defenderPlayerNum) || [];
  const REACTION_CARDS = [
    { name: 'Payback', targetDcName: 'Dengar' },
    { name: 'Dangerous Prey', targetDcName: 'Fennec Shand' },
    { name: "Right Back At Ya!", targetDcName: 'Ahsoka Tano' },
  ];
  combat.promptedReactions = combat.promptedReactions || new Set();
  for (const { name, targetDcName } of REACTION_CARDS) {
    if (combat.promptedReactions.has(name)) continue;
    if (!defenderHand.includes(name)) continue;
    const targetFigKey = combat.target?.figureKey || '';
    if (!targetFigKey.startsWith(targetDcName + '-')) continue;
    // Dangerous Prey (CSV row 597): conditional "you are within 4 spaces of the
    // attacker" — don't offer the reaction if the defender (you) is >4 away.
    if (name === 'Dangerous Prey') {
      const _dpDefPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigKey];
      const _dpAtkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
      if (!_dpDefPos || !_dpAtkPos || countGameSpaces(game, _dpDefPos, _dpAtkPos) > 4) continue;
    }
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
  // free attack is gated separately by fellSwoopFreeAttack[figureKey].
  // Fell Swoop inline disabled 2026-05-09 → fireFellSwoop. Fire handler
  // applies Hide + presents Move 2 picker; chain attack waits for
  // defender step 8 to close (combat._pendingChainAttacks).
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (combat.surgeMastery && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const mastKey = `${combat.attackerFigureKey}_mastery`;
    if (!game.roundFigureAbilityUsed[mastKey]) {
      // P3 fix (audit 2026-06-26): do NOT stamp the once-per-round limit at OFFER
      // time. The Rest-in-Peace block and the no-eligible-cards exit redraw
      // NOTHING, and a player who clicks Skip inside the picker also redraws
      // nothing — burning the use in any of those cases permanently disabled
      // Mastery for the round despite no redraw. The stamp now lives EXCLUSIVELY
      // in the commit branch of post-combat.js handleMasteryPick, so it fires
      // exactly once, only when a card is actually returned from discard to hand.
      // mastKey rides along in pendingMastery (masteryKey) so the handler can stamp it.
      // Rest in Peace: block discard-pile retrieval (no redraw -> limit untouched)
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
          // A redraw is being offered. Do NOT stamp here — the handler stamps the
          // limit only when the redraw is committed (Skip leaves it untouched).
          setPendingMastery(game, { gameId: game.gameId, attackerPlayerNum: mastPlayerNum, discardKey: mastDiscardKey, eligible: mastEligible, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum, masteryKey: mastKey });
          const mastOwnerId = getPlayerId(game, mastPlayerNum);
          const mastBtns = mastEligible.slice(0, 24).map((cardName, i) =>
            new ButtonBuilder().setCustomId(`mastery_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
          );
          mastBtns.push(new ButtonBuilder().setCustomId(`mastery_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send(sanitizeMentions({
            content: `<@${mastOwnerId}> **Mastery** — Choose a FORCE USER CC (cost \u2264 1) from your discard pile to return to hand:`,
            allowedMentions: { users: [mastOwnerId] },
            components: chunkButtonsToRows(mastBtns),
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
      setPendingInterrogate(game, { gameId: game.gameId, attackerPlayerNum: intAttackerPlayerNum, opponentPlayerNum: intOpponentPlayerNum, opponentHandSnapshot: [...intOpponentHand], chosenCardName: null, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum, combatThreadId: combat.combatThreadId });
      // Interrogate is an ability that affects the opponent's Command cards, so
      // [Smuggling Compartment] Part 1 applies: before Blaise looks at the hand,
      // the opponent may exhaust SC to set aside cards. If they own an
      // un-exhausted copy, open that reaction first and defer the picker until it
      // resolves (post-combat handlers resume it). alexanbv 2026-06-17.
      const intScMid = findSmugglingCompartmentMsgId(getDcList(game, intOpponentPlayerNum), getDcMessageIds(game, intOpponentPlayerNum));
      const intScUsable = intScMid && !cardNameIncludes(game.exhaustedSkirmishUpgrades?.[intScMid], 'Smuggling Compartment');
      const intScHandChId = intScUsable ? getHandChannelId(game, intOpponentPlayerNum) : null;
      if (intScUsable && intScHandChId) {
        game.pendingInterrogate.awaitingSc = true;
        const intScOwnerId = getPlayerId(game, intOpponentPlayerNum);
        try {
          const intScCh = await fetchGameChannel(client, intScHandChId);
          if (intScCh) {
            await intScCh.send(sanitizeMentions({
              content: `**Interrogate** — your opponent's Agent Blaise is about to look at your hand. **[Smuggling Compartment]** — you may exhaust it to set aside Command cards first (returned at the start of your next activation or the next phase).`,
              allowedMentions: { users: [intScOwnerId] },
              components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`sc_int_open_${game.gameId}_${intOpponentPlayerNum}`).setLabel('Set aside CCs (Smuggling Compartment)').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`sc_int_skip_${game.gameId}_${intOpponentPlayerNum}`).setLabel('No').setStyle(ButtonStyle.Secondary),
              )],
            })).catch(discordCatch);
            await thread.send(`**Interrogate** — waiting on the opponent's **[Smuggling Compartment]** reaction…`).catch(discordCatch);
            return true;
          }
        } catch (err) {
          console.error('Interrogate Smuggling Compartment offer error:', err);
        }
      }
      const intOwnerId = getPlayerId(game, intAttackerPlayerNum);
      const intBtns = intOpponentHand.slice(0, 24).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      await thread.send(sanitizeMentions({
        content: `<@${intOwnerId}> **Interrogate** — \u26A0\uFE0F *Opponent: look away!* Pick the card you want to target:`,
        allowedMentions: { users: [intOwnerId] },
        components: chunkButtonsToRows(intBtns),
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
      const meBtns = meDiscard.slice(0, 24).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`me_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
      );
      meBtns.push(new ButtonBuilder().setCustomId(`me_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send(sanitizeMentions({
        content: `<@${meOwnerId}> **Military Efficiency** — Choose a Command card from your discard pile to shuffle back into your deck:`,
        allowedMentions: { users: [meOwnerId] },
        components: chunkButtonsToRows(meBtns),
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
    updateDcActionsMessage, repostDcActionsMessage, ensureMovementBankMessage, updateMovementBankMessage,
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
    await _applyStrain(game, { client, logGameAction, saveGames, dcHealthState, findDcMessageIdForFigure, processFigureDefeat, findFigureheadFigure: deps.findFigureheadFigure }, {
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
  // Boltslinger inline disabled 2026-05-09 → fireBoltslinger.
  // Indiscriminate Fire (Bossk): after attack, if not a miss, choose 1 non-red attack die;
  // each OTHER figure within 2 spaces of target (other than the defender
  // AND other than Bossk himself) suffers Damage = Hits and Strain = Surges
  // on that die. Per destruct 2026-05-08: Bossk excluded.
  // Indiscriminate Fire inline disabled 2026-05-09 → fireIndiscriminateFire.

  // Heavy Fire inline disabled 2026-05-09 → fireHeavyFire.

  // Havoc Shot (Fenn Signis): after an attack that didn't miss, suffer
  // 1 Strain to choose up to 2 figures within 2 spaces of the target
  // space in LOS, who suffer 1 Damage. The original target IS eligible
  // to be re-picked (per ruling) — only the attacker is excluded.
  // Havoc Shot inline disabled 2026-05-09 → fireHavocShot.

  // Deflect inline disabled 2026-05-09 → fireDeflect (defender step-8 button).

  // Sling Barrage (Ewok Warrior Elite): the per-group-mate-LOS attack reroll is
  // consumed by this attack — clear the pending flag so a later attack this
  // activation doesn't re-grant it (the rerolls gate reads pendingSlingBarrage).
  if (combat.attackerFigureKey && game.pendingSlingBarrage?.[combat.attackerFigureKey]) {
    delete game.pendingSlingBarrage[combat.attackerFigureKey];
  }

  // Missile Salvo: after each salvo attack, record target + show remaining die buttons
  if (combat.attackerMsgId && game.pendingMissileSalvo?.[combat.attackerMsgId]) {
    const ms = game.pendingMissileSalvo[combat.attackerMsgId];
    if (combat.target?.figureKey) ms.targetsFired = [...(ms.targetsFired || []), combat.target.figureKey];
    // Re-prompt the next salvo die in the attacker's PLAY AREA (activation
    // thread), per alexanbv 2026-06-24, so the whole salvo lives where the
    // player manages the figure; the die choice then drops straight into the
    // target picker (handleMissileSalvoDie). Fall back to the combat thread.
    const _salvoThreadId = game.dcActionsData?.[combat.attackerMsgId]?.threadId;
    const _salvoTarget = (_salvoThreadId ? await fetchGameChannel(client, _salvoThreadId).catch(() => null) : null) || thread;
    if (ms.diceAvailable?.length > 0) {
      const salvoOwnerId = getPlayerId(game, combat.attackerPlayerNum);
      const colorStyle = { blue: ButtonStyle.Primary, red: ButtonStyle.Danger, yellow: ButtonStyle.Secondary };
      const salvoBtns = ms.diceAvailable.map((c) =>
        new ButtonBuilder().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${combat.attackerMsgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || ButtonStyle.Secondary)
      );
      salvoBtns.push(new ButtonBuilder().setCustomId(`missile_salvo_done_${game.gameId}_${combat.attackerMsgId}`).setLabel('End Salvo').setStyle(ButtonStyle.Success));
      if (_salvoTarget) await _salvoTarget.send(sanitizeMentions({
        content: `<@${salvoOwnerId}> **Missile Salvo** — ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining. Choose a die for your next attack (different target):`,
        components: [new ActionRowBuilder().addComponents(salvoBtns)],
        allowedMentions: { users: [salvoOwnerId] },
      })).catch(discordCatch);
    } else {
      delete game.pendingMissileSalvo[combat.attackerMsgId];
      if (_salvoTarget) await _salvoTarget.send('**Missile Salvo** — All shots fired. Salvo complete.').catch(discordCatch);
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

  // Inline target-selection (alexanbv 2026-06-24): the granted/multi-attack
  // continuations below re-arm freeAttackBonusPending on the attacker for the
  // next sequential shot. Instead of telling the player to find the generic
  // Attack button, post a Declare Attack button that drops straight into the
  // shared Attack target picker (handleGrantedAttack → dc_attack_). Each shot
  // fully resolves (incl. defeats) before this runs again, so shot 2/3 targeting
  // reflects the prior shot's board/LoS state.
  const _postAttackerChainButton = async (note) => {
    if (!combat.attackerMsgId) { if (thread) await thread.send(note).catch(discordCatch); return; }
    const _acFigIdx = String(combat.attackerFigureKey || '').match(/-(\d+)-(\d+)$/)?.[2] ?? '0';
    const _acOwnerId = getPlayerId(game, combat.attackerPlayerNum);
    const _acBtn = new ButtonBuilder()
      .setCustomId(`granted_attack_${game.gameId}_${combat.attackerMsgId}_f${_acFigIdx}`)
      .setLabel('Declare Attack')
      .setStyle(ButtonStyle.Primary);
    // Post the Declare Attack button in the attacker's PLAY AREA (its activation
    // thread) — per alexanbv 2026-06-24, not the combat thread — mirroring the
    // grantedAttackButton convention; clicking opens a fresh combat thread for
    // the next sequential shot. Fall back to the combat thread if the activation
    // thread can't be fetched.
    const _acThreadId = game.dcActionsData?.[combat.attackerMsgId]?.threadId;
    const _acTarget = (_acThreadId ? await fetchGameChannel(client, _acThreadId).catch(() => null) : null) || thread;
    if (!_acTarget) return;
    await _acTarget.send(sanitizeMentions({
      content: _acOwnerId ? `<@${_acOwnerId}> ${note}` : note,
      components: [new ActionRowBuilder().addComponents(_acBtn)],
      allowedMentions: { users: _acOwnerId ? [_acOwnerId] : [] },
    })).catch(discordCatch);
  };

  // Dual-Wield Pistols (Bo-Katan): after resolving a ranged attack, free ranged attack once/round.
  // IACP 2026-06-21: the Dual-Wield Pistols ability ALSO grants 2 Block Tokens BEFORE performing this
  // once-per-round bonus ranged attack (this is distinct from the Beskar Armor keyword, which grants 2
  // Block AFTER DEPLOYMENT via post-deploy.js).
  //
  // P3 fix (audit 2026-06-26): both the 2 Block Tokens AND the once-per-round
  // limit are CONTINGENT on actually performing the bonus attack ("Before
  // performing this bonus Ranged attack..."). They must NOT be granted/burned at
  // offer time — declining would otherwise pocket 2 free tokens and permanently
  // disable the ability for the round. So here we ONLY post the Declare-Attack
  // button + arm the free-attack flag, and stash a pending marker. The grant +
  // roundFigureAbilityUsed flag fire in resolveCombatAfterRolls when the bonus
  // attack's rolls actually resolve (see the dwpBlockGrantPending consumer above).
  if (combat.isRanged && combat.attackerFigureKey && combat.attackerMsgId) {
    const _dwpEff = getDcEffect(combat.attackerDcName);
    if ((_dwpEff?.specialAbilityIds || []).includes('dual_wield_pistols_bokatan')) {
      const _dwpKey = `dualWieldPistols_${combat.attackerFigureKey}`;
      // Don't re-offer if the limit is already burned (a prior bonus attack this
      // round committed it) OR a bonus offer is already pending resolution.
      const _dwpAlreadyPending = !!game.dwpBlockGrantPending?.[combat.attackerFigureKey];
      if (!game.roundFigureAbilityUsed?.[_dwpKey] && !_dwpAlreadyPending) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[combat.attackerFigureKey] = true;
        // Stash the contingent grant; committed only when the bonus attack is performed.
        game.dwpBlockGrantPending = game.dwpBlockGrantPending || {};
        game.dwpBlockGrantPending[combat.attackerFigureKey] = {
          round: game.currentRound || 1,
          dwpKey: _dwpKey,
          dcName: combat.attackerDcName,
          // Only grant Block if the figure actually carries the block sub-ability.
          grantBlock: (_dwpEff?.specialAbilityIds || []).includes('dual_wield_block_bokatan'),
        };
        await _postAttackerChainButton(`**Dual-Wield Pistols** — **${combat.attackerDcName}** may perform a free Ranged attack! Declare it below. (Gain 2 Block Tokens when you perform it.)`);
        await logGameAction(game, client, `**Dual-Wield Pistols** — **${combat.attackerDcName}** earns a free Ranged attack.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }

  // Wanton Destruction inline disabled 2026-05-09 → fireWantonDestruction
  // (step-8 attacker button). Click handlers don't close combat directly,
  // so no fromStep8Queue bypass needed.

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
  // Per alexanbv 2026-05-13: fellSwoopFreeAttack is per-figureKey; the
  // chain attack belongs to the original attacker figure.
  if (combat.autofireChainPending && combat.attackerFigureKey) {
    game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
    game.fellSwoopFreeAttack[combat.attackerFigureKey] = true;
    if (combat.autofireChainTargetSpace && combat.attackerFigureKey) {
      // Per alexanbv 2026-05-13: per-figureKey.
      game.autofireChainTargetSpace = game.autofireChainTargetSpace || {};
      game.autofireChainTargetSpace[combat.attackerFigureKey] = combat.autofireChainTargetSpace;
    }
    await logGameAction(game, client, `**Autofire** — Chain attack available! Target must be within 3 of the original target space.`, { phase: 'ROUND', icon: 'attack' });
  }
  // The Darksaber: "then you may perform an attack" — grant second free attack
  if (combat.attackerFigureKey && game.darksaberSecondAttack?.[combat.attackerFigureKey]) {
    delete game.darksaberSecondAttack[combat.attackerFigureKey];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Darksaber Strike' };
    // Clear the override so the second attack uses normal dice.
    // Per alexanbv 2026-05-13: keyed by attacker figureKey.
    if (game.pendingOverrideAttackDice?.[combat.attackerFigureKey]) delete game.pendingOverrideAttackDice[combat.attackerFigureKey];
    await _postAttackerChainButton('**The Darksaber** — You may now perform a normal attack. Declare it below.');
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
        const _blBtns = _blEligible.slice(0, 24).map((fk) =>
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
          components: chunkButtonsToRows(_blBtns),
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
      // Store first target — second attack must hit the same figure.
      // Per alexanbv 2026-05-13: keyed by attackerFigureKey so other
      // figures in the same multifig group are not also forced.
      game.forcedAttackTarget = game.forcedAttackTarget || {};
      game.forcedAttackTarget[combat.attackerFigureKey] = combat.defenderFigureKey;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Focus Fire' };
      await _postAttackerChainButton(`**Focus Fire** — 1 attack remaining. Must target the **same figure**. Declare it below.`);
    } else {
      delete game.focusFireActive[combat.attackerFigureKey];
    }
  }
  // Coordinated Attack: the two granted free attacks must target the SAME figure
  // (CSV row 587: "targeting the same figure"). The target isn't known until the
  // first of the pair declares, so we capture it here at resolve-time and force
  // the OTHER pair member onto the same defender. Mirrors Focus Fire's capture-
  // then-force, but cross-figure (the partner, not the same attacker). Clears
  // after locking so only the second attack is constrained.
  if (game.coordinatedAttackPair && (game.coordinatedAttackPair.figA === combat.attackerFigureKey || game.coordinatedAttackPair.figB === combat.attackerFigureKey)) {
    const _cap = game.coordinatedAttackPair;
    const _capPartner = _cap.figA === combat.attackerFigureKey ? _cap.figB : _cap.figA;
    if (_capPartner && combat.defenderFigureKey) {
      game.forcedAttackTarget = game.forcedAttackTarget || {};
      game.forcedAttackTarget[_capPartner] = combat.defenderFigureKey;
      // The partner figure (not the just-resolved attacker) takes the second
      // attack — post a Declare Attack button in the partner's PLAY AREA
      // (its activation thread), per alexanbv 2026-06-24.
      {
        const _caPartnerMsgId = findDcMessageIdForFigure(game.gameId, combat.attackerPlayerNum, _capPartner);
        const _caFigIdx = String(_capPartner || '').match(/-(\d+)-(\d+)$/)?.[2] ?? '0';
        const _caOwnerId = getPlayerId(game, combat.attackerPlayerNum);
        const _caNote = `**Coordinated Attack** — the second attack must target the **same figure** (**${dcNameFromFigureKey(combat.defenderFigureKey)}**). Declare it below.`;
        const _caThreadId = _caPartnerMsgId ? game.dcActionsData?.[_caPartnerMsgId]?.threadId : null;
        const _caTarget = (_caThreadId ? await fetchGameChannel(client, _caThreadId).catch(() => null) : null) || thread;
        if (_caPartnerMsgId && _caTarget) {
          const _caBtn = new ButtonBuilder()
            .setCustomId(`granted_attack_${game.gameId}_${_caPartnerMsgId}_f${_caFigIdx}`)
            .setLabel(`Declare Attack (${dcNameFromFigureKey(_capPartner)})`.slice(0, 80))
            .setStyle(ButtonStyle.Primary);
          await _caTarget.send(sanitizeMentions({
            content: _caOwnerId ? `<@${_caOwnerId}> ${_caNote}` : _caNote,
            components: [new ActionRowBuilder().addComponents(_caBtn)],
            allowedMentions: { users: _caOwnerId ? [_caOwnerId] : [] },
          })).catch(discordCatch);
        } else if (thread) {
          await thread.send(_caNote).catch(discordCatch);
        }
      }
    }
    delete game.coordinatedAttackPair;
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
      // Apply -1 Hit to second attack too. Per alexanbv 2026-05-13: figureKey-keyed.
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerFigureKey] = { bonusHits: -1 };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Multi-Fire' };
      await _postAttackerChainButton(`**Multi-Fire** — 1 attack remaining. Must target a **different figure** (\u22121 Hit). Declare it below.`);
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
      // Per alexanbv 2026-05-13: keyed by attacker figureKey.
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerFigureKey] = { bonusHits: -1, source: 'Overheated' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[combat.attackerFigureKey] = { from: 'Overheated' };
      await _postAttackerChainButton(`**Overheated** — 1 Ranged attack remaining (−1 Hit). Declare it below.`);
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
      // Re-set the override dice for the next Saber Orbit attack.
      // Per alexanbv 2026-05-13: keyed by attacker figureKey.
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[combat.attackerFigureKey] = { dice: ['red'], type: 'melee', pierce: 0, bonusAccuracy: 0 };
      await _postAttackerChainButton(`**Saber Orbit** — ${soRemaining} attack${soRemaining !== 1 ? 's' : ''} remaining (1 red die, Melee). Declare it below.`);
    } else {
      delete game.saberOrbitAttacksRemaining[combat.attackerFigureKey];
      await thread.send('**Saber Orbit** — All attacks resolved.').catch(discordCatch);
    }
  }

  // Bladestorm inline disabled 2026-05-09 → fireBladestorm (step-8 attacker
  // button, routes through applyDamage so when-damaged hooks fire).
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
  // Per alexanbv 2026-05-12: board-channel post + activation-thread
  // minimap refresh hit different channels, no data dependency — run
  // them in parallel.
  const _boardPostTask = (async () => {
    if (!(game.boardId && game.selectedMap)) return;
    try {
      const boardChannel = await fetchGameChannel(client, game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after attack:', err);
    }
  })();
  const _dcRefreshTask = (async () => {
    if (!combat.attackerMsgId) return;
    const _repostFn = repostDcActionsMessage || updateDcActionsMessage;
    await _repostFn(game, combat.attackerMsgId, client).catch(discordCatch);
  })();
  await Promise.all([_boardPostTask, _dcRefreshTask]);
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
  const _chainQueue = [
    ..._pdca.map((e) => ({ _entry: e, grantee: 'defender' })),
    ..._pca.map((e) => ({ _entry: e, grantee: 'attacker' })),
  ];
  for (const { _entry, grantee } of _chainQueue) {
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
      // Per alexanbv 2026-05-13: keyed by figureKey. Chain-attack
      // entries carry figureKey explicitly; fall back to combat's
      // attackerFigureKey if a legacy entry omits it.
      const _fsFkForEntry = _entry.figureKey
        || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_fsFkForEntry) game.fellSwoopFreeAttack[_fsFkForEntry] = _entry.flagValue ?? true;
    }
    if (_entry.pendingOverrideAttackDice) {
      // Per alexanbv 2026-05-13: keyed by figureKey. Chain-attack
      // entries carry figureKey explicitly; fall back to combat's
      // attackerFigureKey only if a legacy entry omits it.
      const _poadFk = _entry.figureKey || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_poadFk) {
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[_poadFk] = _entry.pendingOverrideAttackDice;
      }
    }
    // Per alexanbv 2026-05-13: keyed by figureKey. Chain-attack entries
    // carry figureKey; fall back to combat's attackerFigureKey only if
    // a legacy entry omits it.
    if (_entry.barrageTargetSpace) {
      game.barrageTargetSpace = game.barrageTargetSpace || {};
      const _bts_fk = _entry.figureKey || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_bts_fk) game.barrageTargetSpace[_bts_fk] = _entry.barrageTargetSpace;
    }
    if (_entry.barrageDefenseBonus) {
      game.barrageDefenseBonus = game.barrageDefenseBonus || {};
      const _bdb_fk = _entry.figureKey || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_bdb_fk) game.barrageDefenseBonus[_bdb_fk] = true;
    }
    // Return Fire (defender chain) forces target onto the original attacker.
    // Per alexanbv 2026-05-13: keyed by attacker figureKey. Chain-attack
    // entries carry figureKey explicitly; fall back to combat's
    // attackerFigureKey only if a legacy entry omits it.
    if (_entry.forcedTargetFigureKey) {
      const _ftFk = _entry.figureKey || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : null);
      if (_ftFk) {
        game.forcedAttackTarget = game.forcedAttackTarget || {};
        game.forcedAttackTarget[_ftFk] = _entry.forcedTargetFigureKey;
      }
    }
    // Inline target-selection (alexanbv 2026-06-24): post a Declare Attack
    // button so the chain attack's target picker is part of THIS flow — the
    // player does NOT hunt for the generic Attack button on the DC card. The
    // free-attack flags armed above are consumed by handleGrantedAttack →
    // dc_attack_ → the shared Attack target picker. Multi-attack chains
    // (Tonfa Strike, Barrage, Saber Orbit, etc.) re-stage the next entry as
    // each attack resolves, so this same path runs for shots 2/3 sequentially,
    // and the board/LoS state reflects the prior shot's outcome.
    if (_entry.message) {
      const _chainGranteeFk = _entry.figureKey
        || (_entry.msgId === combat.attackerMsgId ? combat.attackerFigureKey : combat.target?.figureKey);
      const _chainFigIdx = String(_chainGranteeFk || '').match(/-(\d+)-(\d+)$/)?.[2] ?? '0';
      const _chainPn = grantee === 'defender'
        ? (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum))
        : combat.attackerPlayerNum;
      const _chainOwnerId = getPlayerId(game, _chainPn);
      const _chainBtn = new ButtonBuilder()
        .setCustomId(`granted_attack_${game.gameId}_${_entry.msgId}_f${_chainFigIdx}`)
        .setLabel(`Declare Attack${_entry.source ? ` (${_entry.source})` : ''}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary);
      const _chainContent = _entry.message.includes(`<@${_chainOwnerId}>`)
        ? _entry.message
        : `<@${_chainOwnerId}> ${_entry.message}`;
      // Post to the grantee's PLAY AREA (its activation thread), per alexanbv
      // 2026-06-24; fall back to the combat thread if it can't be fetched.
      const _chainThreadId = game.dcActionsData?.[_entry.msgId]?.threadId;
      const _chainTarget = (_chainThreadId ? await fetchGameChannel(client, _chainThreadId).catch(() => null) : null) || thread;
      if (_chainTarget) {
        await _chainTarget.send(sanitizeMentions({
          content: _chainContent,
          components: [new ActionRowBuilder().addComponents(_chainBtn)],
          allowedMentions: { users: _chainOwnerId ? [_chainOwnerId] : [] },
        })).catch(discordCatch);
      }
    }
  }
}
