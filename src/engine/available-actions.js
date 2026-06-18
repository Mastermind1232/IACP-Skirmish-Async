/**
 * Available actions system: reads game state and returns all legal actions
 * for a given player. Each action includes a type, customId, and description.
 *
 * This is the foundation for the AI player — it can list what moves are legal
 * without needing Discord.
 */

import { ACTION_TYPES, buildCustomId } from './action-types.js';
import { getPlayerId, getInitiativePlayerNum, opponentPlayerNum, getCcHand, getDcList, getActivatedDcIndices } from '../game/player-helpers.js';
import { PHASES, ROUND_PHASES } from '../game/phase.js';
import { effectiveFigureCount } from '../game/squad-upgrades.js';
import { hasLineOfSight, countSpaces } from '../game/spatial.js';
import { edgeKey, getFootprintCells } from '../game/coords.js';
import { clearPendingCelebration } from '../game/interrupts.js';
import { getBrokenWallEdges } from '../game/movement.js';
import { dcNameFromFigureKey, isCompanionHostDefeated } from '../game/dc-helpers.js';
import { getAttackerSurgeAbilities, SURGE_LABELS, parseSurgeEffect } from '../game/combat.js';
import { getLegalInteractOptions } from '../game/board-helpers.js';
import { isDcCompanion, getDcEffects, getMapTokensData, getFigureSize, getLoadoutCards } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';

import { getDcEffect } from '../game/dc-helpers.js';
import { anyFigureHasActions, figureActionsRemaining } from '../game/activation-state.js';
/**
 * Get all available actions for a player in the current game state.
 * @param {object} game - The game state
 * @param {number} playerNum - 1 or 2
 * @param {object} [deps] - Optional dependencies for advanced queries (dcMessageMeta, getDcStats, etc.)
 * @returns {Array<{ type: string, customId: string, description: string, params?: object }>}
 */
export function getAvailableActions(game, playerNum, deps = {}) {
  if (!game || game.ended) return [];

  // Combat side-effect pending states must resolve before any phase gate.
  // These are set during combat/activation resolution and could persist into
  // a round-end phase gate if the triggering action was the last of the round.
  if (game.pendingCelebration) {
    const celebActions = getCelebrationActions(game, playerNum);
    if (celebActions.length > 0) return celebActions;
  }
  if (game.pendingPowerTokenGrant) {
    const tokenActions = getPowerTokenActions(game, playerNum);
    if (tokenActions.length > 0) return tokenActions;
  }
  if (game.pendingSpreadThePainCondPick) {
    const spreadActions = getSpreadThePainActions(game, playerNum);
    if (spreadActions.length > 0) return spreadActions;
  }
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) {
    const choiceActions = getDcAbilityChoiceActions(game, playerNum, deps);
    if (choiceActions.length > 0) return choiceActions;
  }
  // Bleeding prompt (headless only): figure owner must accept or prevent
  if (game.pendingBleeding) {
    const bl = game.pendingBleeding;
    if (playerNum === bl.playerNum) {
      const gameId = game.gameId;
      const ccDeckLen = (game[playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck'] || []).length;
      return [
        { type: 'bleed_accept', customId: `bleed_accept_${gameId}_${playerNum}_${bl.figureKey}`, description: `Bleeding: ${bl.displayName} takes 1 damage` },
        { type: 'bleed_prevent', customId: `bleed_prevent_${gameId}_${playerNum}_${bl.figureKey}`, description: `Bleeding: prevent (discard CC, ${ccDeckLen} left)`, disabled: ccDeckLen === 0 },
      ].filter(a => !a.disabled);
    }
    return [];
  }

  // Post-deploy queue: player must pick which interactive ability to resolve next
  if (game.postDeployQueue?.awaitingOrder) {
    const q = game.postDeployQueue;
    if (playerNum === q.currentPlayerNum) {
      return (q.abilities || []).map((ab, idx) => ({
        type: 'post_deploy_pick',
        customId: `pd_pick_${game.gameId}_${q.currentPlayerNum}_${idx}`,
        description: `Post-deploy: ${ab.label} — ${ab.dcName}`,
      }));
    }
    return [];
  }
  // Post-deploy active ability: interactive buttons stashed by post-deploy handlers
  if (game.postDeployQueue?.pendingActions?.length > 0) {
    const q = game.postDeployQueue;
    const pNum = q.activeAbility?.playerNum ?? q.currentPlayerNum;
    if (playerNum === pNum) return q.pendingActions;
    return [];
  }

  // Start-of-round interactive effects (Rule by Fear, Force Slow, etc.)
  if (game.pendingSorActions?.length > 0) {
    const mine = game.pendingSorActions.filter(a => a.playerNum === playerNum);
    if (mine.length > 0) return mine;
    return [];
  }

  // Phase gate takes priority — only ready/unready allowed
  if (game.phaseGate) {
    return getPhaseGateActions(game, playerNum);
  }

  // Dispatch based on game phase
  switch (game.phase) {
    case PHASES.LOBBY:
      return []; // Lobby actions handled outside this system

    case PHASES.MAP_SELECTION:
      return getMapSelectionActions(game, playerNum, deps);

    case PHASES.INITIATIVE:
      return getInitiativeActions(game, playerNum);

    case PHASES.ZONE_SELECTION:
      return getZoneSelectionActions(game, playerNum);

    case PHASES.DEPLOYMENT:
      return getDeploymentActions(game, playerNum, deps);

    case PHASES.ATTACHMENT:
      return getAttachmentActions(game, playerNum);

    case PHASES.CC_DRAW:
      return getCcDrawActions(game, playerNum);

    case PHASES.ROUND_ACTIVE:
      return getRoundActiveActions(game, playerNum, deps);

    case PHASES.ENDED:
      return [];

    default:
      // Legacy games without phase tracking — try to infer
      return getLegacyActions(game, playerNum, deps);
  }
}

// ── Phase Gate ───────────────────────────────────────────────────────────────

function getPhaseGateActions(game, playerNum) {
  const gate = game.phaseGate;
  // Sequential gate (destruct 2026-05-06): only the activePlayer can ack.
  const _acked = gate.acked || {};
  const isReady = Boolean(_acked[playerNum]);
  const isActive = gate.activePlayer === playerNum;
  const actions = [];

  if (!isReady && isActive) {
    actions.push({
      type: ACTION_TYPES.PHASE_GATE_READY,
      customId: buildCustomId(ACTION_TYPES.PHASE_GATE_READY, { gameId: game.gameId, playerNum }),
      description: `Ready for ${gate.phase}`,
    });
  } else if (isReady) {
    actions.push({
      type: ACTION_TYPES.PHASE_GATE_UNREADY,
      customId: buildCustomId(ACTION_TYPES.PHASE_GATE_UNREADY, { gameId: game.gameId, playerNum }),
      description: `Unready for ${gate.phase}`,
    });
  }

  return actions;
}

// ── Map Selection ────────────────────────────────────────────────────────────

function getMapSelectionActions(game, playerNum, deps) {
  // Both players can participate in map selection
  const actions = [];
  if (game.draftMapPool?.length) {
    actions.push({
      type: ACTION_TYPES.DRAFT_RANDOM,
      customId: buildCustomId(ACTION_TYPES.DRAFT_RANDOM, { gameId: game.gameId }),
      description: 'Start random draft',
    });
  }
  return actions;
}

// ── Initiative ───────────────────────────────────────────────────────────────

function getInitiativeActions(game, playerNum) {
  // Both squads must be submitted before initiative can be determined
  if (!game.player1Squad || !game.player2Squad) return [];
  return [{
    type: ACTION_TYPES.DETERMINE_INITIATIVE,
    customId: buildCustomId(ACTION_TYPES.DETERMINE_INITIATIVE, { gameId: game.gameId }),
    description: 'Determine initiative',
  }];
}

// ── Zone Selection ───────────────────────────────────────────────────────────

function getZoneSelectionActions(game, playerNum) {
  const chooserId = game.deviousSchemeZoneChooser || game.initiativePlayerId;
  const chooserPn = chooserId === game.player1Id ? 1 : (chooserId === game.player2Id ? 2 : null);

  if (playerNum !== chooserPn) return [];

  return [
    {
      type: ACTION_TYPES.PICK_ZONE,
      customId: buildCustomId(ACTION_TYPES.PICK_ZONE, { gameId: game.gameId, zone: 'red' }),
      description: 'Choose RED deployment zone',
      params: { zone: 'red' },
    },
    {
      type: ACTION_TYPES.PICK_ZONE,
      customId: buildCustomId(ACTION_TYPES.PICK_ZONE, { gameId: game.gameId, zone: 'blue' }),
      description: 'Choose BLUE deployment zone',
      params: { zone: 'blue' },
    },
  ];
}

// ── Deployment ───────────────────────────────────────────────────────────────

function getDeploymentActions(game, playerNum, deps) {
  const initPlayerNum = getInitiativePlayerNum(game);
  const isInitPlayer = playerNum === initPlayerNum;

  // Initiative player deploys first, then the other
  if (isInitPlayer && !game.initiativePlayerDeployed) {
    return getDeployActionsForPlayer(game, playerNum, deps);
  }
  if (!isInitPlayer && game.initiativePlayerDeployed && !game.nonInitiativePlayerDeployed) {
    return getDeployActionsForPlayer(game, playerNum, deps);
  }

  return [];
}

function getDeployActionsForPlayer(game, playerNum, deps) {
  const actions = [];
  const gameId = game.gameId;

  // Deployment done (if all required figures are placed)
  actions.push({
    type: ACTION_TYPES.DEPLOY_DONE,
    customId: buildCustomId(ACTION_TYPES.DEPLOY_DONE, { gameId }),
    description: 'Finish deployment',
  });

  // Individual figure deployment (requires dcMessageMeta to list undeployed figures)
  // This is a simplified version — full implementation needs figure-level detail
  const dcList = getDcListForPlayer(game, playerNum);
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = typeof dc === 'object' ? dc.dcName : dc;
    actions.push({
      type: ACTION_TYPES.DEPLOY_FIGURE,
      customId: buildCustomId(ACTION_TYPES.DEPLOY_FIGURE, { gameId, dcIndex: i }),
      description: `Deploy ${dcName}`,
      params: { dcIndex: i, dcName },
    });
  }

  return actions;
}

// ── Attachment ────────────────────────────────────────────────────────────────

function getAttachmentActions(game, playerNum) {
  const confirmed = game.setupAttachmentConfirmed?.[playerNum];
  if (confirmed) return [];

  return [{
    type: ACTION_TYPES.CONFIRM_ATTACHMENT,
    customId: `attach_done_confirm_${game.gameId}_${playerNum}`,
    description: 'Confirm attachments',
  }];
}

// ── CC Draw ──────────────────────────────────────────────────────────────────

function getCcDrawActions(game, playerNum) {
  const drawn = playerNum === 1 ? game.player1CcDrawn : game.player2CcDrawn;
  if (drawn) return [];

  return [{
    type: ACTION_TYPES.DRAW_CC,
    customId: buildCustomId(ACTION_TYPES.DRAW_CC, { gameId: game.gameId }),
    description: 'Shuffle & draw starting hand',
  }];
}

// ── Round Active ─────────────────────────────────────────────────────────────

function getRoundActiveActions(game, playerNum, deps) {
  const playerId = getPlayerId(game, playerNum);
  const gameId = game.gameId;

  // Check for pending sub-states first
  // Power Token Overflow takes priority over combat — must discard before continuing
  if (game.pendingPowerTokenOverflow?.length > 0) {
    const overflowActions = getOverflowActions(game, playerNum);
    if (overflowActions.length > 0) return overflowActions;
  }

  if (game.pendingCombat) {
    const combatActions = getCombatActions(game, playerNum, deps);
    // Append playable CCs alongside combat actions (combat-timing windows)
    if (deps.getPlayableCcFromHand) {
      const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
      if (hand?.length) {
        const playable = deps.getPlayableCcFromHand(game, playerNum, hand);
        for (let i = 0; i < playable.length; i++) {
          combatActions.push({
            type: ACTION_TYPES.PLAY_CC,
            customId: `cc_play_${gameId}_${playerNum}_${i}`,
            description: `Play CC: ${playable[i]}`,
            params: { cardIndex: i, cardName: playable[i] },
          });
        }
      }
    }
    return combatActions;
  }

  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    return getMovementActions(game, playerNum, deps);
  }

  // ── Post-combat pending abilities ──────────────────────────────────────────
  // Set during finishCombatResolution AFTER pendingCombat is deleted.
  if (game.pendingBoltslinger) {
    const bl = game.pendingBoltslinger;
    if (playerNum === bl.attackerPlayerNum) {
      const acts = (bl.targets || []).slice(0, 4).map((t, i) => ({
        type: 'boltslinger_target', customId: `boltslinger_target_${gameId}_${i}`,
        description: `Boltslinger: deal 1 Dmg to ${t.label}`,
      }));
      acts.push({ type: 'boltslinger_skip', customId: `boltslinger_skip_${gameId}`, description: 'Skip Boltslinger' });
      return acts;
    }
    return [];
  }
  if (game.pendingIndiscriminateFire) {
    const idf = game.pendingIndiscriminateFire;
    if (playerNum === idf.attackerPlayerNum) {
      const acts = (idf.availableDice || []).slice(0, 5).map((d, i) => ({
        type: 'indiscriminate_die', customId: `indiscriminate_die_${gameId}_${i}`,
        description: `Indiscriminate Fire: ${d.color} die`,
      }));
      acts.push({ type: 'indiscriminate_skip', customId: `indiscriminate_skip_${gameId}`, description: 'Skip Indiscriminate Fire' });
      return acts;
    }
    return [];
  }
  if (game.pendingHeavyFire) {
    const hf = game.pendingHeavyFire;
    if (playerNum === (hf.attackerPlayerNum || hf.ownerPlayerNum)) {
      return [
        { type: 'heavy_fire_use', customId: `heavy_fire_use_${gameId}`, description: 'Use Heavy Fire' },
        { type: 'heavy_fire_skip', customId: `heavy_fire_skip_${gameId}`, description: 'Skip Heavy Fire' },
      ];
    }
    return [];
  }
  if (game.pendingHavocShot) {
    const hs = game.pendingHavocShot;
    if (playerNum === hs.attackerPlayerNum) {
      const acts = (hs.targets || []).slice(0, 4).map((t, i) => ({
        type: 'havoc_shot_target', customId: `havoc_shot_target_${gameId}_${i}`,
        description: `Havoc Shot: ${t.label}`,
      }));
      acts.push({ type: 'havoc_shot_skip', customId: `havoc_shot_skip_${gameId}`, description: 'Skip Havoc Shot' });
      return acts;
    }
    return [];
  }
  if (game.pendingWantonDestruction) {
    const wd = game.pendingWantonDestruction;
    if (playerNum === wd.ownerPlayerNum) {
      return [
        { type: 'wanton_use', customId: `wanton_use_${gameId}`, description: 'Use Wanton Destruction (discard 1 CC)' },
        { type: 'wanton_skip', customId: `wanton_skip_${gameId}`, description: 'Skip Wanton Destruction' },
      ];
    }
    return [];
  }
  if (game.pendingDeflect) {
    const df = game.pendingDeflect;
    if (playerNum === df.deflectorPlayerNum) {
      const acts = (df.hostiles || []).slice(0, 4).map((t, i) => ({
        type: 'deflect_target', customId: `deflect_pick_${gameId}_${i}`,
        description: `Deflect: ${t.label}`,
      }));
      acts.push({ type: 'deflect_skip', customId: `deflect_skip_${gameId}`, description: 'Skip Deflect' });
      return acts;
    }
    return [];
  }
  if (game.pendingReaction) {
    const rx = game.pendingReaction;
    if (playerNum === rx.defenderPlayerNum) {
      return [
        { type: 'reaction_use', customId: `reaction_use_${gameId}`, description: 'Use Reaction' },
        { type: 'reaction_skip', customId: `reaction_skip_${gameId}`, description: 'Skip Reaction' },
      ];
    }
    return [];
  }
  if (game.pendingMastery) {
    const ms = game.pendingMastery;
    if (playerNum === ms.attackerPlayerNum) {
      const acts = (ms.eligible || []).map((e, i) => ({
        type: 'mastery_pick', customId: `mastery_pick_${gameId}_${e.discardKey || i}`,
        description: `Mastery: discard ${e.label || e.discardKey}`,
      }));
      acts.push({ type: 'mastery_skip', customId: `mastery_skip_${gameId}`, description: 'Skip Mastery' });
      return acts;
    }
    return [];
  }
  if (game.pendingMilitaryEfficiency) {
    const me = game.pendingMilitaryEfficiency;
    if (playerNum === me.attackerPlayerNum) {
      const acts = (me.eligible || []).map((card, i) => ({
        type: 'me_pick', customId: `me_pick_${gameId}_${i}`,
        description: `Military Efficiency: shuffle ${card} back into deck`,
      }));
      acts.push({ type: 'me_skip', customId: `me_skip_${gameId}`, description: 'Skip Military Efficiency' });
      return acts;
    }
    return [];
  }
  if (game.pendingInterrogate) {
    const it = game.pendingInterrogate;
    if (playerNum === it.attackerPlayerNum) {
      const acts = (it.opponentHandSnapshot || []).map((card, i) => ({
        type: 'interrogate_pick', customId: `interrogate_pick_${gameId}_${i}`,
        description: `Interrogate: look at ${card}`,
      }));
      acts.push({ type: 'interrogate_skip', customId: `interrogate_skip_${gameId}`, description: 'Skip Interrogation' });
      return acts;
    }
    return [];
  }

  // Pending DC ability choice (chooseOne mechanic)
  if (game.pendingDcAbilityChoice && Object.keys(game.pendingDcAbilityChoice).length > 0) {
    const choiceActions = getDcAbilityChoiceActions(game, playerNum, deps);
    if (choiceActions.length > 0) return choiceActions;
  }

  // Pending Celebration (after defeating a unique figure)
  if (game.pendingCelebration) {
    const celebActions = getCelebrationActions(game, playerNum);
    if (celebActions.length > 0) return celebActions;
  }

  // Pending Pounce space choice (Nexu etc.)
  if (game.pendingPounceSpaceChoice && Object.keys(game.pendingPounceSpaceChoice).length > 0) {
    const pounceActions = getPounceSpaceActions(game, playerNum, deps);
    if (pounceActions.length > 0) return pounceActions;
  }

  // Pending Missile Salvo (BT-1 etc.)
  if (game.pendingMissileSalvo && Object.keys(game.pendingMissileSalvo).length > 0) {
    const salvoActions = getMissileSalvoActions(game, playerNum);
    if (salvoActions.length > 0) return salvoActions;
  }

  // Pending Power Token grant
  if (game.pendingPowerTokenGrant) {
    const tokenActions = getPowerTokenActions(game, playerNum);
    if (tokenActions.length > 0) return tokenActions;
  }

  // Pending Power Token Overflow — player must discard excess tokens
  if (game.pendingPowerTokenOverflow?.length > 0) {
    const overflowActions = getOverflowActions(game, playerNum);
    if (overflowActions.length > 0) return overflowActions;
  }

  // Pending Cover Fire
  if (game.pendingCoverFire) {
    const coverActions = getCoverFireActions(game, playerNum);
    if (coverActions.length > 0) return coverActions;
  }

  // Pending Strain Choice (player must resolve strain allocation before continuing)
  if (game.pendingStrainChoice && Object.keys(game.pendingStrainChoice).length > 0) {
    const strainActions = getStrainChoiceActions(game, playerNum);
    if (strainActions.length > 0) return strainActions;
  }

  // Force Vision pending: blocked player must pick a group
  if (game.forceVisionPending && game.forceVisionPending === playerNum) {
    const fvActions = getForceVisionPickActions(game, playerNum);
    if (fvActions.length > 0) return fvActions;
    // Safety: no ready groups remain — clear the stale pending
    game.forceVisionPending = null;
  }

  // Pending Spread the Pain condition pick
  if (game.pendingSpreadThePainCondPick) {
    const spreadActions = getSpreadThePainActions(game, playerNum);
    if (spreadActions.length > 0) return spreadActions;
  }

  // Pending Still Faster Than You interrupt
  if (game.pendingStillFaster) {
    const sfActions = getStillFasterActions(game, playerNum);
    if (sfActions.length > 0) return sfActions;
  }

  // Pending Last Resort interrupt (figure about to die)
  if (game.pendingLastResort) {
    const lrActions = getLastResortActions(game, playerNum);
    if (lrActions.length > 0) return lrActions;
  }

  // Pending CC confirmation (player must confirm/cancel before anything else)
  if (game.pendingCcConfirmation) {
    const ccConfirmActions = getCcConfirmActions(game, playerNum);
    if (ccConfirmActions.length > 0) return ccConfirmActions;
  }

  // Pending CC choice (chooseOne for CC like Retaliation)
  if (game.pendingCcChoice && game.pendingCcChoice.gameId) {
    const ccChoiceActions = getCcChoiceActions(game, playerNum);
    if (ccChoiceActions.length > 0) return ccChoiceActions;
  }

  // Pending CC space choice (pick-a-space for CC like Smoke Grenade)
  if (game.pendingCcSpaceChoice && game.pendingCcSpaceChoice.gameId) {
    const ccSpaceActions = getCcSpaceActions(game, playerNum);
    if (ccSpaceActions.length > 0) return ccSpaceActions;
  }

  // Pending EE-3 Carbine die pick (Boba Fett)
  if (game.pendingEe3Carbine && typeof game.pendingEe3Carbine === 'object') {
    const ee3Actions = getEe3CarbineActions(game, playerNum, deps);
    if (ee3Actions.length > 0) return ee3Actions;
  }

  // Pending Bo-Rifle weapon pick (Agent Kallus)
  if (game.pendingBoRifle && typeof game.pendingBoRifle === 'object') {
    const brActions = getBoRifleActions(game, playerNum, deps);
    if (brActions.length > 0) return brActions;
  }

  // Pending Rush (Onar)
  if (game.pendingRushPush) {
    const rushActions = getRushPushActions(game, playerNum);
    if (rushActions.length > 0) return rushActions;
  }

  // Pending Shoulder Rush (Drokkatta)
  if (game.pendingShoulderRush) {
    const srActions = getShoulderRushActions(game, playerNum);
    if (srActions.length > 0) return srActions;
  }

  // Pending False Orders / Lure
  if (game.pendingFalseOrders) {
    const foActions = getFalseOrdersActions(game, playerNum);
    if (foActions.length > 0) return foActions;
  }

  // Check round phase
  switch (game.roundPhase) {
    case ROUND_PHASES.START_OF_ROUND:
      return getStartOfRoundActions(game, playerNum);

    case ROUND_PHASES.ACTIVATION:
      return getActivationActions(game, playerNum, deps);

    case ROUND_PHASES.END_OF_ROUND:
      return getEndOfRoundActions(game, playerNum, deps);

    default:
      return getActivationActions(game, playerNum, deps);
  }
}

// ── Activation Phase ─────────────────────────────────────────────────────────

function getActivationActions(game, playerNum, deps) {
  const playerId = getPlayerId(game, playerNum);
  const actions = [];
  const gameId = game.gameId;

  // End activation phase — both players must confirm, regardless of turn
  const noActivations = (game.p1ActivationsRemaining ?? 0) === 0 && (game.p2ActivationsRemaining ?? 0) === 0;
  // Check if any alive DC still has actions remaining (skip stale entries for defeated DCs)
  const noActionsRemaining = !Object.entries(game.dcActionsData || {}).some(([msgId, d]) => {
    if (!anyFigureHasActions(d)) return false;
    // If we have health state, verify the DC isn't fully defeated
    if (deps.dcHealthState) {
      const hs = deps.dcHealthState.get(msgId);
      if (hs && hs.every(fig => fig && fig[0] <= 0)) return false;
    }
    return true;
  });
  if (noActivations && noActionsRemaining) {
    const alreadyEnded = playerNum === 1 ? game.p1ActivationPhaseEnded : game.p2ActivationPhaseEnded;
    if (!alreadyEnded) {
      actions.push({
        type: ACTION_TYPES.END_ACTIVATION_PHASE,
        customId: buildCustomId(ACTION_TYPES.END_ACTIVATION_PHASE, { gameId }),
        description: 'End Activation Phase',
      });
    }
  }

  // Is it this player's activation turn?
  const isMyTurn = game.currentActivationTurnPlayerId === playerId;

  // Check for active DC with actions remaining (even if not our turn — we still
  // need to offer dc_end_activation for our own DCs that have pending actions)
  if (!isMyTurn && deps.dcMessageMeta) {
    for (const [msgId, meta] of deps.dcMessageMeta) {
      if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
      const data = game.dcActionsData?.[msgId];
      if (data && anyFigureHasActions(data)) {
        // Skip if DC is fully defeated (stale dcActionsData)
        if (deps.dcHealthState) {
          const hs = deps.dcHealthState.get(msgId);
          if (hs && hs.every(fig => fig && fig[0] <= 0)) continue;
        }
        actions.push({
          type: ACTION_TYPES.DC_END_ACTIVATION,
          customId: buildCustomId(ACTION_TYPES.DC_END_ACTIVATION, { msgId }),
          description: `End activation for ${meta.displayName || meta.dcName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }
    }
    return actions;
  }

  // Check if player has readied DCs to activate
  const activationsRemaining = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  // Check if there's already an active DC for this player (blocks new activations)
  // Skip fully defeated DCs — their stale dcActionsData should not block new activations
  const hasActiveDc = deps.dcMessageMeta && [...deps.dcMessageMeta].some(([msgId, meta]) => {
    if (meta.gameId !== gameId || meta.playerNum !== playerNum) return false;
    if (game.dcActionsData?.[msgId] == null) return false;
    if (deps.dcHealthState) {
      const hs = deps.dcHealthState.get(msgId);
      if (hs && hs.every(fig => fig && fig[0] <= 0)) return false;
    }
    return true;
  });

  if (activationsRemaining > 0 && !hasActiveDc) {
    // Can activate a DC — need dcMessageMeta to list available DCs
    let hasActivatableDc = false;
    if (deps.dcMessageMeta) {
      const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      for (const [msgId, meta] of deps.dcMessageMeta) {
        if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
        // Check if this DC is readied (not exhausted) and not depleted
        const exhausted = deps.dcExhaustedState?.get(msgId) ?? false;
        if (exhausted) continue;
        const depleted = game.p1DepletedDcMessageIds?.includes(msgId) || game.p2DepletedDcMessageIds?.includes(msgId);
        if (depleted) continue;
        // Skip DCs with no surviving figures on the board
        const figs = game.figurePositions?.[playerNum] || {};
        if (!Object.keys(figs).some(fk => fk.startsWith(meta.dcName + '-'))) continue;
        // Companions cannot activate if their host group has left play (rules: COMPANIONS L919-920)
        if (isCompanionHostDefeated(game, meta.dcName, playerNum)) continue;

        hasActivatableDc = true;
        const dcIndex = dcMsgIds ? dcMsgIds.indexOf(msgId) : 0;
        actions.push({
          type: ACTION_TYPES.ACTIVATE_DC,
          customId: buildCustomId(ACTION_TYPES.ACTIVATE_DC, { gameId, playerNum, dcIndex }),
          description: `Activate ${meta.displayName || meta.dcName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }
    }

    if (hasActivatableDc) {
      // Can pass activation turn — but only if opponent has MORE activations (matches handler guard)
      const otherPlayerNum = playerNum === 1 ? 2 : 1;
      const otherRem = otherPlayerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
      if (otherRem > activationsRemaining) {
        actions.push({
          type: ACTION_TYPES.PASS_ACTIVATION_TURN,
          customId: buildCustomId(ACTION_TYPES.PASS_ACTIVATION_TURN, { gameId }),
          description: 'Pass activation turn',
        });
      }
    } else {
      // Has activations on paper but no DCs to activate (all exhausted/dead)
      // Offer end activation phase to prevent deadlock
      const alreadyEnded = playerNum === 1 ? game.p1ActivationPhaseEnded : game.p2ActivationPhaseEnded;
      if (!alreadyEnded) {
        actions.push({
          type: ACTION_TYPES.END_ACTIVATION_PHASE,
          customId: buildCustomId(ACTION_TYPES.END_ACTIVATION_PHASE, { gameId }),
          description: 'End Activation Phase (no DCs to activate)',
        });
      }
    }
  } else if (!noActivations && !hasActiveDc) {
    // Player has 0 activations but opponent still has some — must pass turn
    actions.push({
      type: ACTION_TYPES.PASS_ACTIVATION_TURN,
      customId: buildCustomId(ACTION_TYPES.PASS_ACTIVATION_TURN, { gameId }),
      description: 'Pass activation turn',
    });
  }

  // Check for active DC with actions remaining
  if (deps.dcMessageMeta) {
    for (const [msgId, meta] of deps.dcMessageMeta) {
      if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
      const data = game.dcActionsData?.[msgId];
      if (!data || !anyFigureHasActions(data)) continue;

      // Skip if all figures for this DC are defeated (no positions on board)
      const figs = game.figurePositions?.[playerNum] || {};
      const hasSurvivors = Object.keys(figs).some(fk => fk.startsWith(meta.dcName + '-'));
      if (!hasSurvivors) continue;

      // This DC has actions remaining — can move, attack, interact, or special
      const displayName = meta.displayName || meta.dcName;
      const figureIndex = data.selectedFigure ?? 0;

      // Build figureKey for condition checks (stun, massive, position)
      const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
      const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
      const figConditions = game.figureConditions?.[figureKey] || [];
      const isStunned = figConditions.includes('Stun');
      const hasPosition = !!game.figurePositions?.[playerNum]?.[figureKey];

      // Wave 4: Stunned figure can spend 1 action to remove Stun (rules: STUNNED L2759-2761)
      if (isStunned && figureActionsRemaining(data, figureIndex) >= 1) {
        actions.push({
          type: 'remove_stun',
          customId: `dc_remove_stun_${msgId}_f${figureIndex}`,
          description: `Remove Stun from ${displayName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }

      // Stunned/no-position/massive-locked/To-the-Limit figures cannot Move
      if (!isStunned && hasPosition
          && !game.massiveMovementLocked?.[figureKey]
          && !game.activationExtraActionThenStun?.[figureKey]) {
        actions.push({
          type: ACTION_TYPES.MOVE_FIGURE,
          customId: buildCustomId(ACTION_TYPES.MOVE_FIGURE, { msgId, figureIndex }),
          description: `Move with ${displayName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }

      // Arsenal / Epic Arsenal: if DC has Arsenal and no override dice yet, offer dice pick
      const arsenalActions = getArsenalPickActions(game, playerNum, msgId, deps);
      if (arsenalActions.length > 0) {
        actions.push(...arsenalActions);
      }

      // Attack: compute individual targets if deps available (stunned figures cannot attack)
      // Enforce 1-attack-per-activation rule PER FIGURE (alexanbv
      // 2026-05-13): if THIS figure already attacked, only offer attack
      // if the DC has Assault, or a free/bonus attack is pending. The
      // flag is keyed by figureKey so siblings in a multifigure group
      // remain eligible.
      const alreadyAttacked = !!game.attackPerformedThisActivation?.[figureKey];
      let attackBlocked = false;
      if (alreadyAttacked) {
        // Per alexanbv 2026-05-13: every free-attack flag below is now
        // per-figureKey. The DEFAULT scope is per-figure unless a card
        // explicitly says "group".
        const hasFreeAttack = game.freeAttackBonusPending?.[figureKey] != null
          || game.pounceAttackPending?.[figureKey] != null
          || game.fellSwoopFreeAttack?.[figureKey]
          || game.pummelTwoAttacksThisActivation?.[figureKey];
        const hasIRMultiAttack = !!game.imperialRetrofittingMultiAttack?.[figureKey];
        if (!hasFreeAttack && !hasIRMultiAttack) {
          const dcAbilityText = getDcEffects()?.[meta.dcName]?.abilityText || '';
          const hasAssault = /\bAssault:/i.test(dcAbilityText);
          if (!hasAssault) attackBlocked = true;
        }
      }
      const canComputeTargets = deps.getDcStats && deps.getMapData && game.selectedMap?.id;
      const targets = (isStunned || attackBlocked) ? [] : computeAttackTargets(game, msgId, meta, figureIndex, playerNum, deps);
      if (targets.length > 0) {
        game.attackTargets = game.attackTargets || {};
        game.attackTargets[`${msgId}_${figureIndex}`] = targets;
        for (let ti = 0; ti < targets.length; ti++) {
          const t = targets[ti];
          actions.push({
            type: ACTION_TYPES.ATTACK_TARGET,
            customId: `attack_target_${msgId}_${figureIndex}_${ti}`,
            description: `Attack ${t.label} with ${displayName}`,
            params: { msgId, dcName: meta.dcName, targetIndex: ti, targetFigureKey: t.figureKey },
          });
        }
      } else if (!canComputeTargets && !isStunned && !attackBlocked) {
        // Fallback: deps unavailable, offer generic attack (Discord handler will compute targets)
        actions.push({
          type: ACTION_TYPES.ATTACK_TARGET,
          customId: buildCustomId(ACTION_TYPES.ATTACK_TARGET, { msgId, figureIndex }),
          description: `Attack with ${displayName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }
      // If canComputeTargets but targets is empty: no valid targets in range/LOS — don't offer attack

      // Interact — compute legal interact options for each figure of this DC
      const mapId = game.selectedMap?.id;
      if (mapId) {
        const dcEff = getDcEffects()?.[meta.dcName];
        const abilityText = dcEff?.abilityText || '';
        const isNonSentient = abilityText.includes('Non-Sentient') && !game.beastTamerInteractOverride?.[figureKey];
        const isCompanion = isDcCompanion(meta.dcName);
        if (!isNonSentient && !isCompanion) {
          const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
          const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
          const pos = game.figurePositions?.[playerNum]?.[figureKey];
          if (pos) {
            const interactOpts = getLegalInteractOptions(game, playerNum, figureKey, mapId);
            for (const opt of interactOpts) {
              actions.push({
                type: ACTION_TYPES.INTERACT,
                customId: buildCustomId(ACTION_TYPES.INTERACT, {
                  gameId: game.gameId, msgId, figureIndex, optionId: opt.id,
                }),
                description: `${opt.label} (${displayName})`,
                params: {
                  msgId, dcName: meta.dcName, figureIndex, figureKey,
                  optionId: opt.id, optionLabel: opt.label, missionSpecific: opt.missionSpecific,
                },
              });
            }
          }
        }
      }

      // DC Specials — list available special abilities
      if (deps.getDcStats) {
        const dcStats = deps.getDcStats(meta.dcName);
        const specials = dcStats?.specials || [];
        const specialIds = dcStats?.specialIds || [];
        const specialCosts = dcStats?.specialCosts || [];
        // Per alexanbv 2026-05-13: specialsUsed is per-figure. Each figure
        // in a multifigure group can use the same special action once on
        // its own turn.
        const specialsUsed = data.specialsUsedByFig?.[figureIndex] || [];
        const isStunned = (game.figureConditions?.[`${meta.dcName}-1-${figureIndex}`] || []).includes('Stun');

        for (let si = 0; si < specials.length; si++) {
          const cost = specialCosts[si] ?? 1;
          if (specialsUsed.includes(si)) continue; // Already used this activation
          if (figureActionsRemaining(data, figureIndex) < cost) continue;      // Not enough actions
          if (isStunned) continue;                   // Stunned figures can't use specials

          actions.push({
            type: ACTION_TYPES.DC_SPECIAL,
            customId: buildCustomId(ACTION_TYPES.DC_SPECIAL, { msgId, specialIdx: si }),
            description: `${specials[si]} (${displayName})`,
            params: { msgId, dcName: meta.dcName, specialIdx: si, specialName: specials[si], specialId: specialIds[si] || null, cost },
          });
        }
      }

      // CC Special Action CCs (timing: specialAction) — costs 1 action
      if (deps.getPlayableCcSpecialsForDc && figureActionsRemaining(data, figureIndex) >= 1) {
        const ccSpecials = deps.getPlayableCcSpecialsForDc(game, playerNum, meta.dcName, meta.displayName);
        for (let ci = 0; ci < ccSpecials.length; ci++) {
          actions.push({
            type: ACTION_TYPES.PLAY_CC_SPECIAL,
            customId: buildCustomId(ACTION_TYPES.PLAY_CC_SPECIAL, { msgId, cardIndex: ci }),
            description: `Play CC (Special Action): ${ccSpecials[ci]} (${displayName})`,
            params: { msgId, dcName: meta.dcName, cardIndex: ci, cardName: ccSpecials[ci], actionCost: 1 },
          });
        }
      }

      // CC Double Action CCs (timing: doubleActionSpecial) — costs 2 actions
      if (deps.getPlayableCcDoubleActionsForDc && figureActionsRemaining(data, figureIndex) >= 2) {
        const ccDoubles = deps.getPlayableCcDoubleActionsForDc(game, playerNum, meta.dcName, meta.displayName);
        for (let ci = 0; ci < ccDoubles.length; ci++) {
          actions.push({
            type: ACTION_TYPES.PLAY_CC_DOUBLE,
            customId: buildCustomId(ACTION_TYPES.PLAY_CC_DOUBLE, { msgId, cardIndex: ci }),
            description: `Play CC (Double Action): ${ccDoubles[ci]} (${displayName})`,
            params: { msgId, dcName: meta.dcName, cardIndex: ci, cardName: ccDoubles[ci], actionCost: 2 },
          });
        }
      }

      // End activation early (forfeit remaining actions)
      actions.push({
        type: ACTION_TYPES.DC_END_ACTIVATION,
        customId: buildCustomId(ACTION_TYPES.DC_END_ACTIVATION, { msgId }),
        description: `End activation for ${displayName}`,
        params: { msgId, dcName: meta.dcName },
      });
    }
  }

  // Check for DCs with 0 actions remaining — need to end activation
  if (deps.dcMessageMeta) {
    for (const [msgId, meta] of deps.dcMessageMeta) {
      if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
      const data = game.dcActionsData?.[msgId];
      if (data && !anyFigureHasActions(data)) {
        // DC has been activated but has no actions left — can end activation
        actions.push({
          type: ACTION_TYPES.DC_END_ACTIVATION,
          customId: buildCustomId(ACTION_TYPES.DC_END_ACTIVATION, { msgId }),
          description: `End activation for ${meta.displayName || meta.dcName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }
    }
  }

  // CC play actions — list playable CCs from hand
  if (deps.getPlayableCcFromHand) {
    const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
    if (hand?.length) {
      // getPlayableCcFromHand(game, playerNum, hand) returns string[]
      const playable = deps.getPlayableCcFromHand(game, playerNum, hand);
      for (let i = 0; i < playable.length; i++) {
        const cardName = playable[i];
        actions.push({
          type: ACTION_TYPES.PLAY_CC,
          customId: `cc_play_${gameId}_${playerNum}_${i}`,
          description: `Play CC: ${cardName}`,
          params: { cardIndex: i, cardName },
        });
      }
    }
  }

  // Non-blocking side prompts: overwatch, bomb drop, orbital bombardment
  // These appear alongside normal activation actions (player can resolve them at any point)
  if (game.pendingOverwatchPlacement && Object.keys(game.pendingOverwatchPlacement).length > 0) {
    actions.push(...getOverwatchPlacementActions(game, playerNum, deps));
  }
  if (game.pendingBombDrop && Object.keys(game.pendingBombDrop).length > 0) {
    actions.push(...getBombDropActions(game, playerNum, deps));
  }
  if (game.pendingOrbitalBombardment) {
    actions.push(...getOrbitalBombardmentActions(game, playerNum, deps));
  }

  return actions;
}

// ── Combat Sub-flow ──────────────────────────────────────────────────────────

function getCombatActions(game, playerNum, deps) {
  const combat = game.pendingCombat;
  if (!combat) return [];

  const playerId = getPlayerId(game, playerNum);
  const actions = [];
  const gameId = game.gameId;
  const attackerPn = combat.attackerPlayerNum || 1;
  const defenderPn = opponentPlayerNum(attackerPn);

  // ── Combat-reaction pending states ─────────────────────────────────────────
  // These block normal combat flow until resolved. Check in priority order.

  // Pre-roll defensive reactions (set during attack declaration)
  if (game.pendingStrikeMeDown) {
    if (playerNum === game.pendingStrikeMeDown.defenderPlayerNum) {
      return [
        { type: 'strike_me_down_yes', customId: `strike_me_down_yes_${gameId}`, description: 'Use Strike Me Down (reduce VP cost, be defeated)' },
        { type: 'strike_me_down_no', customId: `strike_me_down_no_${gameId}`, description: 'Decline Strike Me Down' },
      ];
    }
    return [];
  }

  if (game.pendingSlowOnTheDraw) {
    if (playerNum === game.pendingSlowOnTheDraw.defenderPlayerNum) {
      return [
        { type: 'slow_on_draw_yes', customId: `slow_on_draw_yes_${gameId}`, description: 'Interrupt: Attack Greedo first' },
        { type: 'slow_on_draw_no', customId: `slow_on_draw_no_${gameId}`, description: 'Decline Slow on the Draw' },
      ];
    }
    return [];
  }

  if (game.pendingForceExhaustion) {
    if (playerNum === game.pendingForceExhaustion.defenderPlayerNum) {
      return [
        { type: 'force_exhaustion_yes', customId: `force_exhaustion_yes_${gameId}`, description: 'Use Force Exhaustion (Incapacitate The Child)' },
        { type: 'force_exhaustion_no', customId: `force_exhaustion_no_${gameId}`, description: 'Decline Force Exhaustion' },
      ];
    }
    return [];
  }

  if (game.pendingIllicitArms) {
    const ia = game.pendingIllicitArms;
    if (playerNum === ia.playerNum) {
      const iaActions = [];
      // Generate CC pick options directly (bypass intermediate "use" step)
      const hand = (ia.playerNum === 1 ? game.player1CcHand : game.player2CcHand) || [];
      for (let i = 0; i < hand.length; i++) {
        iaActions.push({
          type: 'illicit_arms_pick',
          customId: `illicit_arms_pick_${gameId}_${i}`,
          description: `Illicit Arms: Discard ${hand[i]} for +1 Damage`,
          params: { ccIndex: i, ccName: hand[i] },
        });
      }
      iaActions.push({
        type: 'illicit_arms_skip',
        customId: `illicit_arms_skip_${gameId}`,
        description: 'Decline Illicit Arms',
      });
      return iaActions;
    }
    return [];
  }

  // Post-attack-roll reactions
  if (game.pendingPowerConverter) {
    if (playerNum === attackerPn) {
      return [
        { type: 'power_converter_approve', customId: `power_converter_approve_${gameId}`, description: 'Use Power Converter (swap/reroll attack die)' },
        { type: 'power_converter_skip', customId: `power_converter_skip_${gameId}`, description: 'Skip Power Converter' },
      ];
    }
    return [];
  }

  // Post-defense-roll reactions
  if (game.pendingThereIsNoTry) {
    const tint = game.pendingThereIsNoTry;
    const tintPn = tint.defenderPlayerNum ?? defenderPn;
    if (playerNum === tintPn) {
      const tintActions = [];
      if (tint.pickedDieIdx == null) {
        // Step 1: skip or pick a defense die
        const defDice = combat.defenseDiceResults || [];
        for (let i = 0; i < defDice.length; i++) {
          tintActions.push({
            type: 'there_is_no_try_die',
            customId: `there_is_no_try_die_${gameId}_${i}`,
            description: `There Is No Try: Set die #${i + 1} (${defDice[i]?.color || 'white'})`,
            params: { dieIndex: i },
          });
        }
        tintActions.push({
          type: 'there_is_no_try_skip',
          customId: `there_is_no_try_skip_${gameId}`,
          description: 'Skip There Is No Try',
        });
      } else {
        // Step 2: pick a face for the chosen die
        const dieIdx = tint.pickedDieIdx;
        const die = (combat.defenseDiceResults || [])[dieIdx];
        const color = die?.color || 'white';
        const faces = color === 'black'
          ? [{ b: 0, e: 0, d: 0 }, { b: 1, e: 0, d: 0 }, { b: 2, e: 0, d: 0 }, { b: 1, e: 1, d: 0 }, { b: 0, e: 1, d: 0 }, { b: 0, e: 0, d: 1 }]
          : [{ b: 0, e: 0, d: 0 }, { b: 1, e: 0, d: 0 }, { b: 1, e: 1, d: 0 }, { b: 0, e: 0, d: 1 }];
        for (const face of faces) {
          tintActions.push({
            type: 'there_is_no_try_face',
            customId: `there_is_no_try_face_${gameId}_${dieIdx}_${face.b}_${face.e}_${face.d}`,
            description: `Set to ${face.b}B/${face.e}E${face.d ? '/Dodge' : ''}`,
            params: { dieIndex: dieIdx, block: face.b, evade: face.e, dodge: face.d },
          });
        }
      }
      return tintActions;
    }
    return [];
  }

  // Tough Luck (post-reroll reaction) is handled by the discrete combat gate
  // (_offerToughLuck → tlgate_* in handlers/combat.js), driven by
  // combat._pendingToughLuck — not by a round-long game.toughLuckPlayerNum arm.
  // The legacy game.pendingToughLuck oracle block was removed 2026-06-18.

  // Combat sub-phase gate — sequential (destruct 2026-05-06): only the
  // activePlayer can ack. Surface the action exclusively to them.
  if (combat.combatGate) {
    const gate = combat.combatGate;
    const _acked = gate.acked || {};
    const _isAcked = Boolean(_acked[playerNum]);
    const _isActive = gate.activePlayer === playerNum;
    if (!_isAcked && _isActive) {
      actions.push({
        type: ACTION_TYPES.COMBAT_GATE,
        customId: buildCustomId(ACTION_TYPES.COMBAT_GATE, { gameId }),
        description: `Combat gate: ${gate.phase}`,
      });
    }
    return actions;
  }

  // Combat ready check — both players must confirm via the sequential
  // on-declare gate (combat_gate_). Per-gate ack tracked on
  // combat.combatGate.acked; only combat.combatGate.activePlayer may
  // currently ack.
  const _stepIsPreRoll = combat.currentStep === 'step1+2-attacker'
    || combat.currentStep === 'step1+2-defender';
  if (_stepIsPreRoll) {
    const _gate = combat.combatGate;
    const _gAcked = _gate?.acked || {};
    const _isAcked = Boolean(_gAcked[playerNum]);
    const _isActive = _gate?.activePlayer === playerNum;
    if (_gate && _isActive && !_isAcked) {
      actions.push({
        type: ACTION_TYPES.COMBAT_GATE,
        customId: buildCustomId(ACTION_TYPES.COMBAT_GATE, { gameId }),
        description: 'Ready for combat',
      });
    }
    return actions;
  }

  // Rolling phase — attacker rolls first, then defender
  if (!combat.attackRoll) {
    if (playerNum === attackerPn) {
      actions.push({
        type: ACTION_TYPES.COMBAT_ROLL,
        customId: buildCustomId(ACTION_TYPES.COMBAT_ROLL, { gameId }),
        description: 'Roll attack dice',
      });
    }
    return actions;
  }
  if (!combat.defenseRoll) {
    if (playerNum === defenderPn) {
      actions.push({
        type: ACTION_TYPES.COMBAT_ROLL,
        customId: buildCustomId(ACTION_TYPES.COMBAT_ROLL, { gameId }),
        description: 'Roll defense dice',
      });
    }
    return actions;
  }

  // Reroll phase — list each eligible die for reroll + done option.
  // alexanbv 2026-05-13: 'forced' phase retired. Only 'attacker' and
  // 'defender' phases exist; every reroll ability (voluntary +1 grant,
  // forced/controlled queue entry, complex ability) is surfaced in the
  // holder's bucket and the sub-picker filters dice by entry.pool.
  if (combat.rerollPhase) {
    const phase = combat.rerollPhase;
    const rerollPn = phase === 'attacker' ? attackerPn : defenderPn;
    if (playerNum === rerollPn) {
      const sideKey = phase === 'attacker' ? 'atk' : 'def';
      const _aiHolderPN = phase === 'attacker'
        ? (combat.attackerPlayerNum || 1)
        : (combat.defenderPlayerNum ?? (combat.attackerPlayerNum === 1 ? 2 : 1));
      const _aiPool = phase === 'attacker' ? 'attack' : 'defense';
      const rerollsRemaining = (combat.forcedRerollQueue || [])
        .filter(e => e.controlPlayer === _aiHolderPN && (e.pool === _aiPool || e.pool === 'any'))
        .reduce((n, e) => n + Math.max(0, e.remaining ?? 0), 0);
      const diceResults = phase === 'attacker' ? combat.attackDiceResults : combat.defenseDiceResults;
      const alreadyRerolled = phase === 'attacker' ? (combat.attackerRerolledIndices || []) : (combat.defenderRerolledIndices || []);

      if (rerollsRemaining > 0 && diceResults?.length) {
        for (let i = 0; i < diceResults.length; i++) {
          if (alreadyRerolled.includes(i)) continue;
          actions.push({
            type: ACTION_TYPES.COMBAT_REROLL,
            customId: buildCustomId(ACTION_TYPES.COMBAT_REROLL, { gameId, side: sideKey, dieIndex: i }),
            description: `Reroll ${phase} die ${i + 1} (${diceResults[i]?.color || 'unknown'})`,
            params: { side: sideKey, dieIndex: i },
          });
        }
      }

      // Done rerolling / skip
      actions.push({
        type: 'combat_reroll_done',
        customId: `combat_reroll_${gameId}_${sideKey}_done`,
        description: 'Done rerolling',
      });
    }
    return actions;
  }

  // Pending Hunter Protocol — attacker may re-trigger a surge ability
  if (game.pendingHunterProtocol) {
    if (playerNum === attackerPn) {
      actions.push({
        type: 'hunter_protocol_trigger',
        customId: `hunter_protocol_trigger_${gameId}`,
        description: 'Trigger Hunter Protocol (re-use surge)',
      });
      actions.push({
        type: 'hunter_protocol_skip',
        customId: `hunter_protocol_skip_${gameId}`,
        description: 'Skip Hunter Protocol',
      });
    }
    return actions;
  }

  // ── Pre-resolution combat pending abilities ───────────────────────────────
  // These are set during resolution while pendingCombat still exists.
  // They send Discord buttons and wait for player input before combat can continue.

  if (game.pendingFigurehead) {
    const fh = game.pendingFigurehead;
    if (playerNum === fh.defenderPlayerNum) {
      return [
        { type: 'figurehead_use', customId: `figurehead_use_${gameId}`, description: 'Use Figurehead (redirect attack)' },
        { type: 'figurehead_skip', customId: `figurehead_skip_${gameId}`, description: 'Skip Figurehead' },
      ];
    }
    return [];
  }

  if (game.pendingCleave) {
    const cl = game.pendingCleave;
    if (playerNum === cl.attackerPlayerNum) {
      return (cl.targets || []).map((t, i) => ({
        type: 'cleave_target', customId: `cleave_target_${gameId}_${i}`,
        description: `Cleave ${cl.surgeCleave || ''} to ${t.label}`,
      }));
    }
    return [];
  }

  if (game.pendingFightingKnife) {
    const fk = game.pendingFightingKnife;
    if (playerNum === fk.attackerPlayerNum) {
      const acts = (fk.targets || []).map((t, i) => ({
        type: 'fighting_knife_target', customId: `fighting_knife_target_${gameId}_${i}`,
        description: `Fighting Knife: ${t.label}`,
      }));
      acts.push({ type: 'fighting_knife_skip', customId: `fighting_knife_skip_${gameId}`, description: 'Skip Fighting Knife' });
      return acts;
    }
    return [];
  }

  if (game.pendingConcussiveBolt) {
    const cb = game.pendingConcussiveBolt;
    if (playerNum === cb.attackerPlayerNum) {
      const acts = (cb.adjSpaces || []).slice(0, 4).map((sp) => ({
        type: 'concussive_bolt_push', customId: `concussive_bolt_push_${gameId}_${sp}`,
        description: `Push to ${String(sp).toUpperCase()}`,
      }));
      acts.push({ type: 'concussive_bolt_skip', customId: `concussive_bolt_skip_${gameId}`, description: 'Skip Concussive Bolt' });
      return acts;
    }
    return [];
  }

  if (game.pendingExtraProtection) {
    const ep = game.pendingExtraProtection;
    if (playerNum === (ep.defenderPlayerNum || defenderPn)) {
      return [
        { type: 'extra_protection_play', customId: `extra_protection_play_${gameId}`, description: 'Use Extra Protection' },
        { type: 'extra_protection_skip', customId: `extra_protection_skip_${gameId}`, description: 'Skip Extra Protection' },
      ];
    }
    return [];
  }

  // Executor interrupt (Royal Guard Champion): fires during damage resolution when
  // a friendly figure is defeated within 3 spaces. Blocks combat until resolved.
  if (game.pendingExecutorInterrupt) {
    const ex = game.pendingExecutorInterrupt;
    if (playerNum === ex.rgcPlayerNum) {
      return [
        { type: 'executor_use', customId: `executor_use_${gameId}_${ex.rgcMsgId}`, description: 'Use Executor (move 2 + free attack)' },
        { type: 'executor_skip', customId: `executor_skip_${gameId}_${ex.rgcMsgId}`, description: 'Skip Executor' },
      ];
    }
    return [];
  }

  // Mid-combat pending sub-states: set during surge/token handling and resolved
  // via buttons outside getCombatActions. Block ALL combat actions so the defender
  // can't submit COMBAT_RESOLVE before the attacker resolves the sub-state.
  if (game.pendingSpreadThePainCondPick || game.pendingRogueOneTokenPick ||
      game.pendingSurgeOverflow || game.pendingZilloDiscard) {
    return [];
  }

  // Surge assignment phase — list each spendable surge ability
  if (combat.pendingSurges || combat.surgeRemaining > 0) {
    if (playerNum === attackerPn) {
      // Compute surge abilities dynamically (they're not stored on combat state)
      const surgeKeys = getAttackerSurgeAbilities(combat);
      const surgesRemaining = combat.surgeRemaining ?? 0;
      // Overload (Rebel Saboteur): may trigger the same surge ability up to twice per attack
      const atkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
      const atkEff = getDcEffect(atkDcName);
      const maxSurgeUses = (atkEff?.specialAbilityIds || []).includes('overload_saboteur') ? 2 : 1;

      for (let i = 0; i < surgeKeys.length; i++) {
        const key = surgeKeys[i];
        const isDouble = key.startsWith('double:');
        const cost = isDouble ? 2 : 1;
        if (cost > surgesRemaining) continue;
        // Skip surges already spent the max number of times
        if (((combat.surgeSpentCount || {})[i] || 0) >= maxSurgeUses) continue;

        const label = SURGE_LABELS[key]
          || SURGE_LABELS[key.replace('double:', '')]
          || key;
        actions.push({
          type: ACTION_TYPES.COMBAT_SURGE,
          customId: buildCustomId(ACTION_TYPES.COMBAT_SURGE, { gameId, surgeIndex: i }),
          description: `Spend surge: ${label}`,
          params: { surgeIndex: i, surgeKey: key, cost },
        });
      }

      // Skip remaining surges
      actions.push({
        type: ACTION_TYPES.COMBAT_SKIP_SURGES,
        customId: buildCustomId(ACTION_TYPES.COMBAT_RESOLVE, { gameId }),
        description: 'Skip surges and resolve',
      });
    }
    return actions;
  }

  // Both rolls done, no rerolls, no surges — ready to resolve
  // This covers the case where proceedAfterRerolls/proceedAfterTokens already ran
  if (combat.attackRoll && combat.defenseRoll) {
    actions.push({
      type: ACTION_TYPES.COMBAT_RESOLVE,
      customId: buildCustomId(ACTION_TYPES.COMBAT_RESOLVE, { gameId }),
      description: 'Ready to resolve rolls',
    });
  }

  return actions;
}

// ── Movement Sub-flow ────────────────────────────────────────────────────────

function getMovementActions(game, playerNum, deps) {
  const actions = [];

  for (const [moveKey, moveState] of Object.entries(game.moveInProgress || {})) {
    if (moveState.playerNum !== playerNum) continue;

    // Movement in progress — pick space or adjust MP
    if (moveState.phase === 'pick_space' || !moveState.phase) {
      // Compute reachable spaces if deps available
      if (deps.computeMovementCache && deps.getBoardStateForMovement && moveState.figureKey) {
        try {
          const board = deps.getBoardStateForMovement(game, moveState.figureKey);
          const startPos = moveState.currentPosition || moveState.startCoord;
          const mpRemaining = moveState.mpRemaining ?? moveState.totalMp ?? 0;
          // Use stored profile/cache from moveState if available, else compute
          const profile = moveState.movementProfile
            || (deps.getMovementProfile
              ? deps.getMovementProfile(moveState.dcName || '', moveState.figureKey, game)
              : {});
          if (board && mpRemaining > 0 && startPos) {
            const cache = deps.computeMovementCache(startPos, mpRemaining, board, profile);
            if (cache?.cells?.size > 0) {
              for (const [coord, info] of cache.cells) {
                if (info.cost > 0 && info.cost <= mpRemaining) {
                  actions.push({
                    type: ACTION_TYPES.MOVE_PICK_SPACE,
                    customId: buildCustomId(ACTION_TYPES.MOVE_PICK_SPACE, { moveKey, coord }),
                    description: `Move to ${coord} (cost ${info.cost})`,
                    params: { moveKey, coord, cost: info.cost },
                  });
                }
              }
            }
          }
        } catch {
          // Fall through to simple finish action
        }
      }

      // Always offer finish movement
      actions.push({
        type: ACTION_TYPES.MOVE_PICK_SPACE,
        customId: `move_pick_${moveKey}_done`,
        description: 'Finish movement',
        params: { moveKey, done: true },
      });
    }
  }

  return actions;
}

// ── Start of Round ───────────────────────────────────────────────────────────

function getStartOfRoundActions(game, playerNum) {
  return [{
    type: ACTION_TYPES.END_START_OF_ROUND,
    customId: buildCustomId(ACTION_TYPES.END_START_OF_ROUND, { gameId: game.gameId }),
    description: 'End Start of Round window',
  }];
}

// ── End of Round ─────────────────────────────────────────────────────────────

function getEndOfRoundActions(game, playerNum, deps) {
  const playerId = getPlayerId(game, playerNum);

  // Only the player whose turn it is in the EoR window can act
  if (!game.endOfRoundWhoseTurn) return [];
  if (game.endOfRoundWhoseTurn !== playerId) return [];

  const actions = [{
    type: ACTION_TYPES.END_END_OF_ROUND,
    customId: buildCustomId(ACTION_TYPES.END_END_OF_ROUND, { gameId: game.gameId }),
    description: 'End "End of Round" window',
  }];

  // Append playable CCs (end-of-round timing window)
  if (deps?.getPlayableCcFromHand) {
    const hand = playerNum === 1 ? game.player1CcHand : game.player2CcHand;
    if (hand?.length) {
      const playable = deps.getPlayableCcFromHand(game, playerNum, hand);
      const gameId = game.gameId;
      for (let i = 0; i < playable.length; i++) {
        actions.push({
          type: ACTION_TYPES.PLAY_CC,
          customId: `cc_play_${gameId}_${playerNum}_${i}`,
          description: `Play CC: ${playable[i]}`,
          params: { cardIndex: i, cardName: playable[i] },
        });
      }
    }
  }

  return actions;
}

// ── Legacy (no game.phase) ───────────────────────────────────────────────────

function getLegacyActions(game, playerNum, deps) {
  // For games without the phase system, try to infer from flags
  // This is a simplified fallback
  if (game.phaseGate) return getPhaseGateActions(game, playerNum);
  if (game.pendingCombat) return getCombatActions(game, playerNum, deps);
  if (game.currentActivationTurnPlayerId) {
    return getActivationActions(game, playerNum, deps);
  }
  return [];
}

// ── DC Ability Choice ─────────────────────────────────────────────────────

function getDcAbilityChoiceActions(game, playerNum, deps) {
  const actions = [];
  const gameId = game.gameId;

  for (const [key, pending] of Object.entries(game.pendingDcAbilityChoice)) {
    // Auto-clear dead-figure entries regardless of playerNum (prevents orphaned states)
    if (deps?.dcHealthState && pending.msgId) {
      const hs = deps.dcHealthState.get(pending.msgId);
      const fi = pending.figureIndex ?? 0;
      if (hs && hs[fi] && hs[fi][0] <= 0) {
        delete game.pendingDcAbilityChoice[key];
        continue;
      }
    }
    if (pending.playerNum !== playerNum) continue;
    // Choices can be stored as choiceOptions, choices, or targetFigureKeys
    const choices = pending.choiceOptions || pending.choices || pending.targetFigureKeys || [];
    if (choices.length === 0) {
      delete game.pendingDcAbilityChoice[key];
      continue;
    }
    for (let i = 0; i < choices.length; i++) {
      const label = typeof choices[i] === 'string' ? choices[i] : choices[i]?.label || `Option ${i + 1}`;
      actions.push({
        type: ACTION_TYPES.DC_ABILITY_CHOICE,
        customId: buildCustomId(ACTION_TYPES.DC_ABILITY_CHOICE, {
          gameId, msgId: pending.msgId, specialIdx: pending.specialIdx, choiceIndex: i,
        }),
        description: `Ability choice: ${label}`,
        params: { key, choiceIndex: i, label },
      });
    }
  }

  return actions;
}

// ── Celebration ───────────────────────────────────────────────────────────

function getCelebrationActions(game, playerNum) {
  const pending = game.pendingCelebration;
  if (!pending || pending.attackerPlayerNum !== playerNum) return [];

  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const hasCelebration = (game[handKey] || []).includes('Celebration');

  // If the player doesn't have Celebration, auto-pass (clear pending state)
  if (!hasCelebration) {
    clearPendingCelebration(game);
    return [];
  }

  return [
    {
      type: ACTION_TYPES.CELEBRATION_PLAY,
      customId: buildCustomId(ACTION_TYPES.CELEBRATION_PLAY, { gameId: game.gameId }),
      description: 'Play Celebration',
    },
    {
      type: ACTION_TYPES.CELEBRATION_PASS,
      customId: buildCustomId(ACTION_TYPES.CELEBRATION_PASS, { gameId: game.gameId }),
      description: 'Skip Celebration',
    },
  ];
}

// ── Pounce Space ──────────────────────────────────────────────────────────

function getPounceSpaceActions(game, playerNum, deps) {
  const actions = [];
  const gameId = game.gameId;

  for (const [msgId, pending] of Object.entries(game.pendingPounceSpaceChoice)) {
    // Auto-clear dead-figure entries regardless of playerNum (prevents orphaned states)
    if (deps?.dcHealthState) {
      const hs = deps.dcHealthState.get(msgId);
      const fi = pending.figureIndex ?? 0;
      if (hs && hs[fi] && hs[fi][0] <= 0) {
        delete game.pendingPounceSpaceChoice[msgId];
        continue;
      }
    }
    if (pending.playerNum !== playerNum) continue;
    const spaces = pending.validSpaces || [];
    if (spaces.length === 0) {
      delete game.pendingPounceSpaceChoice[msgId];
      continue;
    }
    for (const space of spaces) {
      actions.push({
        type: ACTION_TYPES.POUNCE_SPACE,
        customId: buildCustomId(ACTION_TYPES.POUNCE_SPACE, {
          gameId, msgId, figureIndex: pending.figureIndex ?? 0, space,
        }),
        description: `Pounce to ${space}`,
        params: { msgId, space },
      });
    }
  }

  return actions;
}

// ── Missile Salvo ─────────────────────────────────────────────────────────

function getMissileSalvoActions(game, playerNum) {
  const actions = [];
  const gameId = game.gameId;

  for (const [msgId, pending] of Object.entries(game.pendingMissileSalvo)) {
    if (pending.playerNum !== playerNum) continue;
    const dice = pending.diceAvailable || [];
    for (const color of dice) {
      actions.push({
        type: ACTION_TYPES.MISSILE_SALVO_DIE,
        customId: buildCustomId(ACTION_TYPES.MISSILE_SALVO_DIE, { gameId, msgId, color }),
        description: `Missile Salvo: ${color} die`,
        params: { msgId, color },
      });
    }
    actions.push({
      type: ACTION_TYPES.MISSILE_SALVO_DONE,
      customId: buildCustomId(ACTION_TYPES.MISSILE_SALVO_DONE, { gameId, msgId }),
      description: 'End Missile Salvo',
      params: { msgId },
    });
  }

  return actions;
}

// ── Power Token Choice ────────────────────────────────────────────────────

function getPowerTokenActions(game, playerNum) {
  const pending = game.pendingPowerTokenGrant;
  if (!pending || pending.playerNum !== playerNum) return [];

  const gameId = game.gameId;
  const tokenTypes = ['hit', 'surge', 'block', 'evade'];

  return tokenTypes.map(tokenType => ({
    type: ACTION_TYPES.POWER_TOKEN_CHOICE,
    customId: buildCustomId(ACTION_TYPES.POWER_TOKEN_CHOICE, { gameId, tokenType }),
    description: `Choose ${tokenType} power token`,
    params: { tokenType },
  }));
}

// ── Power Token Overflow Discard ──────────────────────────────────────────

function getOverflowActions(game, playerNum) {
  const overflowArr = game.pendingPowerTokenOverflow;
  if (!overflowArr?.length) return [];
  const entry = overflowArr[0];
  const { figureKey } = entry;
  // Determine which player owns this figure
  const ownerPn = Object.entries(game.figurePositions || {}).find(([, figs]) => figs[figureKey])?.[0];
  if (ownerPn && Number(ownerPn) !== playerNum) return [];
  const tokens = game.figurePowerTokens?.[figureKey] || [];
  const gameId = game.gameId;
  return tokens.map((tokenType, i) => ({
    type: ACTION_TYPES.PT_OVERFLOW_DISCARD,
    customId: `pt_overflow_${gameId}_${playerNum}_${figureKey}_${i}`,
    description: `Discard ${tokenType} token (overflow)`,
    params: { figureKey, tokenIndex: i, tokenType },
  }));
}

// ── Cover Fire ────────────────────────────────────────────────────────────

function getCoverFireActions(game, playerNum) {
  const pending = game.pendingCoverFire;
  if (!pending || pending.attackerPlayerNum !== playerNum) return [];

  const actions = [];
  const gameId = game.gameId;

  // Offer friendly figures near the target as block token recipients
  const figs = game.figurePositions?.[playerNum] || {};
  for (const figureKey of Object.keys(figs)) {
    actions.push({
      type: ACTION_TYPES.COVER_FIRE_BLOCK,
      customId: buildCustomId(ACTION_TYPES.COVER_FIRE_BLOCK, { gameId, playerNum, figureKey }),
      description: `Cover Fire: grant block to ${figureKey}`,
      params: { figureKey },
    });
  }

  // Always offer skip
  actions.push({
    type: ACTION_TYPES.COVER_FIRE_SKIP,
    customId: buildCustomId(ACTION_TYPES.COVER_FIRE_SKIP, { gameId }),
    description: 'Skip Cover Fire',
  });

  return actions;
}

// ── Strain Choice ─────────────────────────────────────────────────────────

function getStrainChoiceActions(game, playerNum) {
  const pending = game.pendingStrainChoice;
  if (!pending || !pending.playerNum || pending.playerNum !== playerNum) return [];

  const gameId = game.gameId;
  const actions = [];

  // Always offer "take all as damage"
  actions.push({
    type: ACTION_TYPES.STRAIN_CHOICE_ALLDMG,
    customId: buildCustomId(ACTION_TYPES.STRAIN_CHOICE_ALLDMG, { gameId }),
    description: `Take all strain as damage (${pending.amount} HP)`,
    params: { amount: pending.amount },
  });

  // Offer CC discard options (1..maxDiscards) — rules: discard from deck top, not hand
  const deckKey = `player${pending.playerNum}CcDeck`;
  const deck = game[deckKey] || [];
  const ccCostPerStrain = pending.ccCostPerStrain || 1;
  const maxDiscards = pending.amount > 0 ? Math.min(pending.amount, Math.floor(deck.length / ccCostPerStrain)) : 0;
  for (let i = 1; i <= maxDiscards; i++) {
    const hpRemaining = pending.amount - i;
    const ccCost = i * ccCostPerStrain;
    actions.push({
      type: ACTION_TYPES.STRAIN_CHOICE_DISCARD,
      customId: buildCustomId(ACTION_TYPES.STRAIN_CHOICE_DISCARD, { gameId, discardCount: i }),
      description: `Discard ${ccCost} CC${ccCost > 1 ? 's' : ''}${hpRemaining > 0 ? ` + ${hpRemaining} HP` : ''}`,
      params: { discardCount: i, ccCost, hpRemaining },
    });
  }

  return actions;
}

// ── Force Vision (Kanan Jarrus) ───────────────────────────────────────────

function getForceVisionPickActions(game, playerNum) {
  const actions = [];
  const gameId = game.gameId;
  const dcList = getDcList(game, playerNum) || [];
  const activatedIndices = getActivatedDcIndices(game, playerNum) || [];
  for (let i = 0; i < dcList.length; i++) {
    if (activatedIndices.includes(i)) continue;
    const dc = dcList[i];
    const figs = game.figurePositions?.[playerNum] || {};
    const alive = Object.keys(figs).some(fk => fk.startsWith(dc.dcName + '-'));
    if (!alive) continue;
    actions.push({
      type: 'force_vision_pick',
      customId: `fv_pick_${gameId}_${playerNum}_${i}`,
      description: `Force Vision: choose ${dc.displayName || dc.dcName}`,
      params: { dcIndex: i, dcName: dc.dcName },
    });
  }
  return actions;
}

// ── Spread the Pain ───────────────────────────────────────────────────────

function getSpreadThePainActions(game, playerNum) {
  const pending = game.pendingSpreadThePainCondPick;
  if (!pending || pending.attackerPlayerNum !== playerNum) return [];

  const gameId = game.gameId;
  const conditions = ['stun', 'weaken', 'bleed', 'skip'];

  return conditions.map(condition => ({
    type: ACTION_TYPES.SPREAD_PAIN_COND,
    customId: buildCustomId(ACTION_TYPES.SPREAD_PAIN_COND, { gameId, condition }),
    description: condition === 'skip' ? 'Skip Spread the Pain' : `Spread the Pain: ${condition}`,
    params: { condition },
  }));
}

// ── Still Faster Than You ─────────────────────────────────────────────────

function getStillFasterActions(game, playerNum) {
  const pending = game.pendingStillFaster;
  if (!pending || pending.sftPlayerNum !== playerNum) return [];

  const gameId = game.gameId;
  const actMsgId = pending.activatingMsgId;

  return [
    {
      type: 'still_faster_use',
      customId: `still_faster_use_${gameId}_${actMsgId}`,
      description: 'Interrupt: Still Faster Than You',
    },
    {
      type: 'still_faster_skip',
      customId: `still_faster_skip_${gameId}_${actMsgId}`,
      description: 'Skip Still Faster Than You',
    },
  ];
}

// ── Last Resort ──────────────────────────────────────────────────────────

function getLastResortActions(game, playerNum) {
  const pending = game.pendingLastResort;
  if (!pending || pending.defenderPlayerNum !== playerNum) return [];

  const gameId = game.gameId;
  const targetMsgId = pending.targetMsgId;

  return [
    {
      type: 'last_resort_use',
      customId: `last_resort_use_${gameId}_${targetMsgId}`,
      description: 'Use Last Resort (AoE damage before defeat)',
    },
    {
      type: 'last_resort_skip',
      customId: `last_resort_skip_${gameId}_${targetMsgId}`,
      description: 'Skip Last Resort',
    },
  ];
}

// ── EE-3 Carbine Die Pick ────────────────────────────────────────────────

function getEe3CarbineActions(game, playerNum, deps) {
  const pending = game.pendingEe3Carbine;
  if (!pending || typeof pending !== 'object') return [];
  for (const [msgId, val] of Object.entries(pending)) {
    if (!val || val === 'decided' || typeof val !== 'object') continue;
    if (val.playerNum !== playerNum) continue;
    const gameId = game.gameId;
    const figureIndex = val.figureIndex ?? 0;
    // Get base dice to find non-red colors
    const dcMeta = deps.dcMessageMeta?.get(msgId);
    const stats = dcMeta ? deps.getDcStats?.(dcMeta.dcName) : null;
    const baseDice = stats?.attack?.dice || ['red'];
    const nonRedColors = [...new Set(baseDice.filter(d => d !== 'red'))];
    const actions = nonRedColors.map(color => ({
      type: ACTION_TYPES.EE3_PICK_DIE,
      customId: buildCustomId(ACTION_TYPES.EE3_PICK_DIE, { gameId, msgId, figureIndex, color }),
      description: `EE-3 Carbine: upgrade ${color} → Red`,
      params: { color, msgId, figureIndex },
    }));
    actions.push({
      type: ACTION_TYPES.EE3_PICK_SKIP,
      customId: buildCustomId(ACTION_TYPES.EE3_PICK_SKIP, { gameId, msgId, figureIndex }),
      description: 'Skip EE-3 Carbine',
      params: { msgId, figureIndex },
    });
    return actions;
  }
  return [];
}

// ── Bo-Rifle Weapon Pick ─────────────────────────────────────────────────

function getBoRifleActions(game, playerNum, deps) {
  const pending = game.pendingBoRifle;
  if (!pending || typeof pending !== 'object') return [];
  for (const [msgId, val] of Object.entries(pending)) {
    if (!val || typeof val !== 'object') continue;
    if (val.playerNum !== playerNum) continue;
    const gameId = game.gameId;
    const figureIndex = val.figureIndex ?? 0;
    return [
      {
        type: ACTION_TYPES.BO_RIFLE_USE,
        customId: buildCustomId(ACTION_TYPES.BO_RIFLE_USE, { gameId, msgId, figureIndex }),
        description: 'Bo-Rifle: Melee mode',
        params: { msgId, figureIndex },
      },
      {
        type: ACTION_TYPES.BO_RIFLE_SKIP,
        customId: buildCustomId(ACTION_TYPES.BO_RIFLE_SKIP, { gameId, msgId, figureIndex }),
        description: 'Bo-Rifle: Normal ranged',
        params: { msgId, figureIndex },
      },
    ];
  }
  return [];
}

// ── Arsenal Pick ─────────────────────────────────────────────────────────

function getArsenalPickActions(game, playerNum, msgId, deps) {
  const dcMeta = deps.dcMessageMeta?.get(msgId);
  if (!dcMeta || dcMeta.playerNum !== playerNum) return [];
  const dcEffects = getDcEffects()?.[dcMeta.dcName];
  const specialIds = dcEffects?.specialAbilityIds || [];
  const hasArsenal = specialIds.includes('arsenal');
  const hasEpicArsenal = specialIds.includes('epic_arsenal');
  if (!hasArsenal && !hasEpicArsenal) return [];
  // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
  const data = game.dcActionsData?.[msgId];
  const figureIndex = data?.selectedFigure ?? 0;
  const _dgM = (dcMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const _arsActFk = `${dcMeta.dcName}-${_dgM ? _dgM[1] : '1'}-${figureIndex}`;
  if (game.pendingOverrideAttackDice?.[_arsActFk]) return []; // already picked
  const gameId = game.gameId;
  // Arsenal: 2 dice combos; Epic Arsenal: 3 dice combos
  const diceCount = hasEpicArsenal ? 3 : 2;
  const colors = ['red', 'blue', 'yellow', 'green'];
  const combos = [];
  if (diceCount === 2) {
    for (let i = 0; i < colors.length; i++)
      for (let j = i; j < colors.length; j++)
        combos.push(`${colors[i]},${colors[j]}`);
  } else {
    for (let i = 0; i < colors.length; i++)
      for (let j = i; j < colors.length; j++)
        for (let k = j; k < colors.length; k++) {
          if (colors[i] === colors[j] && colors[j] === colors[k]) continue;
          combos.push(`${colors[i]},${colors[j]},${colors[k]}`);
        }
  }
  return combos.map(combo => ({
    type: ACTION_TYPES.ARSENAL_PICK,
    customId: buildCustomId(ACTION_TYPES.ARSENAL_PICK, { gameId, msgId, figureIndex }),
    description: `Arsenal: ${combo}`,
    params: { msgId, figureIndex, diceCombo: combo },
    selectValues: [combo],
  }));
}

// ── CC Confirmation ──────────────────────────────────────────────────────

function getCcConfirmActions(game, playerNum) {
  const pending = game.pendingCcConfirmation;
  if (!pending || pending.playerNum !== playerNum) return [];
  const gameId = game.gameId;
  return [
    { type: ACTION_TYPES.CC_CONFIRM_PLAY, customId: buildCustomId(ACTION_TYPES.CC_CONFIRM_PLAY, { gameId }), description: `Confirm play: ${pending.card}` },
    { type: ACTION_TYPES.CC_CANCEL_PLAY, customId: buildCustomId(ACTION_TYPES.CC_CANCEL_PLAY, { gameId }), description: 'Cancel CC play' },
  ];
}

// ── CC Choice ────────────────────────────────────────────────────────────

function getCcChoiceActions(game, playerNum) {
  const pending = game.pendingCcChoice;
  if (!pending || pending.playerNum !== playerNum) return [];
  const gameId = game.gameId;
  const options = pending.choiceOptions || [];
  return options.map((opt, i) => ({
    type: ACTION_TYPES.CC_CHOICE,
    customId: buildCustomId(ACTION_TYPES.CC_CHOICE, { gameId, choiceIndex: i }),
    description: `CC choice: ${typeof opt === 'string' ? opt : opt.label || `Option ${i}`}`,
    params: { choiceIndex: i },
  }));
}

// ── CC Space Choice ──────────────────────────────────────────────────────

function getCcSpaceActions(game, playerNum) {
  const pending = game.pendingCcSpaceChoice;
  if (!pending || pending.playerNum !== playerNum) return [];
  const gameId = game.gameId;
  const validSpaces = pending.validSpaces || [];
  return validSpaces.map(space => ({
    type: ACTION_TYPES.CC_SPACE,
    customId: buildCustomId(ACTION_TYPES.CC_SPACE, { gameId, space: String(space).toLowerCase() }),
    description: `CC space: ${String(space).toUpperCase()}`,
    params: { space: String(space).toLowerCase() },
  }));
}

// ── Rush Push ────────────────────────────────────────────────────────────

function getRushPushActions(game, playerNum) {
  const pending = game.pendingRushPush;
  if (!pending || pending.playerNum !== playerNum) return [];
  const gameId = game.gameId;
  const msgId = pending.msgId;
  const targets = pending.targets || [];
  const actions = targets.map((fk, i) => ({
    type: ACTION_TYPES.RUSH_PUSH_FIG,
    customId: buildCustomId(ACTION_TYPES.RUSH_PUSH_FIG, { gameId, msgId, choiceIndex: i }),
    description: `Rush: target ${dcNameFromFigureKey(fk)}`,
    params: { choiceIndex: i, figureKey: fk },
  }));
  actions.push({
    type: ACTION_TYPES.RUSH_PUSH_SKIP,
    customId: buildCustomId(ACTION_TYPES.RUSH_PUSH_SKIP, { gameId, msgId }),
    description: 'Skip Rush',
  });
  return actions;
}

// ── Shoulder Rush ────────────────────────────────────────────────────────

function getShoulderRushActions(game, playerNum) {
  const pending = game.pendingShoulderRush;
  if (!pending || pending.playerNum !== playerNum) return [];
  const gameId = game.gameId;
  const msgId = pending.msgId;
  const targets = pending.targets || [];
  const actions = targets.map((fk, i) => ({
    type: ACTION_TYPES.SHOULDER_RUSH_FIG,
    customId: buildCustomId(ACTION_TYPES.SHOULDER_RUSH_FIG, { gameId, msgId, choiceIndex: i }),
    description: `Shoulder Rush: target ${dcNameFromFigureKey(fk)}`,
    params: { choiceIndex: i, figureKey: fk },
  }));
  actions.push({
    type: ACTION_TYPES.SHOULDER_RUSH_SKIP,
    customId: buildCustomId(ACTION_TYPES.SHOULDER_RUSH_SKIP, { gameId, msgId }),
    description: 'Skip Shoulder Rush',
  });
  return actions;
}

// ── False Orders / Lure ──────────────────────────────────────────────────

function getFalseOrdersActions(game, playerNum) {
  const fo = game.pendingFalseOrders;
  if (!fo || fo.controllerPlayerNum !== playerNum) return [];
  const gameId = game.gameId;
  const msgId = fo.murneRinMsgId || fo.msgId;
  return [
    { type: ACTION_TYPES.FALSE_ORDERS_MOVE, customId: buildCustomId(ACTION_TYPES.FALSE_ORDERS_MOVE, { gameId, msgId }), description: `False Orders: move ${dcNameFromFigureKey(fo.controlledFigureKey)}` },
    { type: ACTION_TYPES.FALSE_ORDERS_ATTACK, customId: buildCustomId(ACTION_TYPES.FALSE_ORDERS_ATTACK, { gameId, msgId }), description: `False Orders: attack with ${dcNameFromFigureKey(fo.controlledFigureKey)}` },
    { type: ACTION_TYPES.FALSE_ORDERS_SKIP, customId: buildCustomId(ACTION_TYPES.FALSE_ORDERS_SKIP, { gameId, msgId }), description: 'Skip False Orders' },
  ];
}

// ── Overwatch Placement ──────────────────────────────────────────────────

function getOverwatchPlacementActions(game, playerNum, deps) {
  const pending = game.pendingOverwatchPlacement;
  if (!pending) return [];
  // Find msgId entries for this player
  const getMapDataFn = deps.getMapData;
  const dcMeta = deps.dcMessageMeta;
  for (const [msgId, val] of Object.entries(pending)) {
    if (!val) continue;
    const meta = dcMeta?.get(msgId);
    if (meta && meta.playerNum !== playerNum) continue;
    // Return space options from map
    const mapId = game.selectedMap?.id;
    const ms = getMapDataFn?.(mapId);
    const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
    if (allSpaces.length === 0) continue;
    const gameId = game.gameId;
    return allSpaces.slice(0, 25).map(space => ({
      type: ACTION_TYPES.OVERWATCH_SPACE,
      customId: buildCustomId(ACTION_TYPES.OVERWATCH_SPACE, { gameId, msgId, space }),
      description: `Overwatch: place at ${String(space).toUpperCase()}`,
      params: { space, msgId },
    }));
  }
  return [];
}

// ── Orbital Bombardment ──────────────────────────────────────────────────

function getOrbitalBombardmentActions(game, playerNum, deps) {
  const pending = game.pendingOrbitalBombardment;
  if (!pending || pending.playerNum !== playerNum) return [];
  const getMapDataFn = deps.getMapData;
  const mapId = game.selectedMap?.id;
  const ms = getMapDataFn?.(mapId);
  const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
  if (allSpaces.length === 0) return [];
  const gameId = game.gameId;
  const msgId = pending.msgId;
  return allSpaces.slice(0, 25).map(space => ({
    type: ACTION_TYPES.OB_SPACE,
    customId: buildCustomId(ACTION_TYPES.OB_SPACE, { gameId, msgId, space }),
    description: `Orbital Bombardment: space ${String(space).toUpperCase()}`,
    params: { space, msgId },
  }));
}

// ── Bomb Drop ────────────────────────────────────────────────────────────

function getBombDropActions(game, playerNum, deps) {
  const pending = game.pendingBombDrop;
  if (!pending) return [];
  const dcMeta = deps.dcMessageMeta;
  for (const [msgId, val] of Object.entries(pending)) {
    if (!val) continue;
    const meta = dcMeta?.get(msgId);
    if (meta && meta.playerNum !== playerNum) continue;
    const getMapDataFn = deps.getMapData;
    const mapId = game.selectedMap?.id;
    const ms = getMapDataFn?.(mapId);
    const allSpaces = ms?.adjacency ? Object.keys(ms.adjacency) : [];
    if (allSpaces.length === 0) continue;
    const gameId = game.gameId;
    return allSpaces.slice(0, 25).map(space => ({
      type: ACTION_TYPES.BOMB_DROP_SPACE,
      customId: buildCustomId(ACTION_TYPES.BOMB_DROP_SPACE, { gameId, msgId, space }),
      description: `Bomb Drop: space ${String(space).toUpperCase()}`,
      params: { space, msgId },
    }));
  }
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDcListForPlayer(game, playerNum) {
  if (playerNum === 1) return game.player1Squad?.dcList || [];
  return game.player2Squad?.dcList || [];
}

/**
 * Compute valid attack targets for a given figure.
 * Simplified version of dc-play-area.js target computation for headless use.
 * Returns array of { figureKey, coord, label, hasLOS, dist }.
 *
 * Known gaps vs Discord's buildAndSendAttackTargets (dc-play-area.js:1000):
 * - Priority Target (abilityText-driven forced targeting)
 * - Fire Mission (remote attack delegation)
 * - Droid Arm (Migs Mayfeld melee override)
 * - Vanish immunity bypass
 * These are intentionally deferred from headless backfill.
 */
function computeAttackTargets(game, msgId, meta, figureIndex, playerNum, deps) {
  const getDcStats = deps.getDcStats;
  const getMapData = deps.getMapData;
  if (!getDcStats || !getMapData || !game.selectedMap?.id) return [];

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats?.attack;
  if (!attackInfo) return [];

  // Determine attacker position
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!attackerPos) return [];

  // Range: melee = 1, ranged = capped by max possible accuracy from dice + surges.
  // Previous default [1,20] allowed offering targets that could never be hit (e.g.
  // blue+red pool has max accuracy 5 — attacking at distance 8 is guaranteed miss).
  const isRanged = attackInfo.type === 'range';
  const MAX_ACC_PER_DIE = { blue: 5, green: 3, yellow: 2, red: 0 };
  let maxDiceAcc = 0;
  for (const die of attackInfo.dice || []) maxDiceAcc += MAX_ACC_PER_DIE[die] || 0;
  // Check DC surge abilities for accuracy surges (e.g. "accuracy 2")
  const _aaEff = getDcEffect(meta.dcName);
  let maxSurgeAcc = 0;
  for (const sa of _aaEff?.surgeAbilities || []) {
    const m = sa.match(/^accuracy\s+(\d+)$/i);
    if (m) maxSurgeAcc = Math.max(maxSurgeAcc, parseInt(m[1], 10));
  }
  const accuracyCeiling = maxDiceAcc + maxSurgeAcc;
  let [minRange, maxRange] = attackInfo.range || (isRanged ? [1, Math.max(1, accuracyCeiling)] : [1, 1]);
  // Even with explicit range, cap by accuracy ceiling for ranged attacks —
  // a weapon with range [1,12] but max accuracy 5 can't hit past 5.
  if (isRanged && accuracyCeiling > 0) maxRange = Math.min(maxRange, accuracyCeiling);
  // Reach: melee attackers extend maxRange from 1 to 2 when any of these
  // are true — REACH keyword, REACH passive, game.nextAttackReach flag,
  // [Fury of Kashyyyk] attachment for WOOKIEE attackers, or a loadout card
  // whose passive === 'Reach' (e.g. Electrostaff). Per CRR
  // (RULES_REFERENCE.md:1933, 2401, 2404), Reach melee can target within
  // 2 spaces.
  if (!isRanged) {
    const _reachKws = (_aaEff?.keywords || []).map(k => String(k).toUpperCase());
    const _reachPassives = (_aaEff?.passives || []).map(p => String(p).toUpperCase());
    const _hasFury = _reachKws.includes('WOOKIEE')
      && (getDcList(game, playerNum) || []).some(dc => dc.dcName === '[Fury of Kashyyyk]');
    const _loadoutName = getConfig(game, figureKey)?.loadout;
    const _loadoutReach = _loadoutName ? getLoadoutCards()?.[_loadoutName]?.passive === 'Reach' : false;
    const _hasReach =
      _reachKws.includes('REACH') ||
      _reachPassives.includes('REACH') ||
      !!game.nextAttackReach?.[figureKey] ||
      _hasFury ||
      _loadoutReach;
    if (_hasReach && maxRange < 2) maxRange = 2;
  }
  const ms = getMapData(game.selectedMap.id);
  if (!ms) return [];
  const _aaMapId = game.selectedMap.id;
  const _aaAllDoors = getMapTokensData()?.[_aaMapId]?.doors || [];
  const _aaOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const _aaClosedEdgePairs = _aaAllDoors.filter(e => {
    const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase();
    return !_aaOpenedSet.has(`${a}|${b}`) && !_aaOpenedSet.has(`${b}|${a}`);
  });
  const _aaClosedDoorEdges = new Set(_aaClosedEdgePairs.map(e => edgeKey(e[0], e[1])));
  // LOS effectiveMs (parity with dc-play-area.js:937-970): merge closed-door
  // edges into impassableEdges so doors block LOS, merge energy-shield and
  // smoke spaces into blocking (CRR p.28 + C54 Smoke Grenade), and subtract
  // currently-broken Wasskah walls from the base impassableEdges so LOS can
  // pass through them (mission rule — wall between two difficult-terrain
  // spaces does not block LOS).
  const _aaShieldSpaces = (game.ancillaryTokens?.energyShield || []).map(s => String(s).toLowerCase());
  const _aaSmokeSpaces = (game.ancillaryTokens?.smoke || []).map(s => String(s).toLowerCase());
  const _aaExtraBlocking = [..._aaShieldSpaces, ..._aaSmokeSpaces];
  const _aaBrokenWalls = getBrokenWallEdges(game, ms);
  const _aaBaseImpassable = ms.impassableEdges || [];
  const _aaFilteredImpassable = _aaBrokenWalls.size > 0
    ? _aaBaseImpassable.filter(e => !_aaBrokenWalls.has(edgeKey(e[0], e[1])))
    : _aaBaseImpassable;
  const _aaNeedsEffective = _aaClosedEdgePairs.length > 0 || _aaExtraBlocking.length > 0 || _aaBrokenWalls.size > 0;
  const _aaEffectiveMs = _aaNeedsEffective
    ? {
        ...ms,
        impassableEdges: _aaClosedEdgePairs.length > 0
          ? [..._aaFilteredImpassable, ..._aaClosedEdgePairs]
          : _aaFilteredImpassable,
        blocking: _aaExtraBlocking.length > 0
          ? [...(ms.blocking || []), ..._aaExtraBlocking]
          : ms.blocking,
      }
    : ms;

  const enemyPn = opponentPlayerNum(playerNum);
  const enemyPositions = game.figurePositions?.[enemyPn] || {};

  // Build figure-blocking coords (parity with dc-play-area.js:1022-1042)
  const attackerPosLc = String(attackerPos).toLowerCase();
  const attackerFpSet = new Set([attackerPosLc]);
  // Expand attacker footprint for multi-cell figures
  const attackerSize = game.figureOrientations?.[figureKey] || getFigureSize(meta.dcName);
  if (attackerSize && attackerSize !== '1x1') {
    for (const cell of getFootprintCells(attackerPos, attackerSize)) attackerFpSet.add(String(cell).toLowerCase());
  }

  // Attacker-side figure-blocking bypass (parity with dc-play-area.js:925-936 + 975).
  // Any one of these nulls the figure-blocking set for the rest of this call:
  //   - Priority Target: abilityText contains "priority target" AND "line of sight"
  //   - MASSIVE attacker keyword
  //   - Clawdite Scout form: figureConfig.form === 'Scout' grants Priority Target
  //   - Marksman CC: game.nextAttackIgnoreFigureLOS[msgId] bypasses for one attack
  // Handler consumes the Marksman flag (delete-on-read); engine is read-only here —
  // consumption is the mutator's responsibility at attack resolution, not at
  // target enumeration.
  const _attackerAbilityText = (_aaEff?.abilityText || '').toLowerCase();
  const _attackerKws = (_aaEff?.keywords || []).map(k => String(k).toUpperCase());
  const _clawditeForm = getConfig(game, figureKey)?.form;
  const _attackerIgnoresFigureBlocking =
    (_attackerAbilityText.includes('priority target') && _attackerAbilityText.includes('line of sight')) ||
    _attackerKws.includes('MASSIVE') ||
    _clawditeForm === 'Scout' ||
    !!game.nextAttackIgnoreFigureLOS?.[figureKey];

  const figureBlockingCoords = _attackerIgnoresFigureBlocking ? null : new Set();
  // Attacker footprint cells for multi-cell LOS origin iteration.
  // Hoisted here so Camo-reciprocal distance computation in the blocking
  // loop can use it.
  const _aaAttackerFpCells = [...attackerFpSet];
  // Camo reciprocal (Mak / Scout Trooper Elite): "You do not block line of
  // sight for [hostile figures 4+ spaces away]." When attacker is 4+ from
  // a hostile Camo figure, exclude that Camo figure's cells from blocking.
  const _AA_CAMO_IDS = new Set(['camouflage_mak', 'camouflage_scout_trooper']);
  if (figureBlockingCoords) {
    for (const [thisPn, poses] of [[playerNum, game.figurePositions?.[playerNum] || {}], [enemyPn, enemyPositions]]) {
      for (const [fk, pos] of Object.entries(poses)) {
        if (!pos || attackerFpSet.has(String(pos).toLowerCase())) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffect(fkDcName);
        if (fkEff?.companion === true) continue;
        if ((fkEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) continue;
        if (thisPn === enemyPn && (fkEff?.specialAbilityIds || []).some(id => _AA_CAMO_IDS.has(id))) {
          const fkPosLc = String(pos).toLowerCase();
          const dist = Math.min(..._aaAttackerFpCells.map(ac => countSpaces(ms, ac, fkPosLc, _aaClosedDoorEdges)));
          if (dist >= 4) continue;
        }
        const fkSize = game.figureOrientations?.[fk] || getFigureSize(fkDcName);
        for (const cell of getFootprintCells(pos, fkSize)) figureBlockingCoords.add(String(cell).toLowerCase());
      }
    }
  }

  const targets = [];

  for (const [fk, coord] of Object.entries(enemyPositions)) {
    if (!coord) continue;
    const coordLc = String(coord).toLowerCase();

    // Target footprint (for multi-cell targets, LOS/distance may be
    // traced to any occupied cell).
    const targetDcName = dcNameFromFigureKey(fk);
    const targetSize = game.figureOrientations?.[fk] || getFigureSize(targetDcName);
    const _aaTargetFpCells = (targetSize && targetSize !== '1x1')
      ? getFootprintCells(coord, targetSize).map(c => String(c).toLowerCase())
      : [coordLc];

    // Distance: minimum over attacker-footprint × target-footprint
    // (parity with dc-play-area.js:1010). countSpaces still gates by
    // closed doors via _aaClosedDoorEdges.
    let dist = Infinity;
    for (const ac of _aaAttackerFpCells) {
      for (const tc of _aaTargetFpCells) {
        const d = countSpaces(ms, ac, tc, _aaClosedDoorEdges);
        if (d < dist) dist = d;
      }
    }
    if (dist < minRange || dist > maxRange) continue;

    // Vanish immunity (parity with dc-play-area.js:1002-1006): if the enemy
    // player has just used Vanish, filter targets whose figureKey starts with
    // the protected DC's dcName (covers all group/figure indices of that DC)
    // until the vanisher's next activation.
    const _vanish = game.vanishImmunityUntilNextActivation?.[enemyPn];
    if (_vanish) {
      const _vanishMeta = deps.dcMessageMeta?.get(_vanish.msgId);
      if (_vanishMeta && fk.startsWith(`${_vanishMeta.dcName}-`)) continue;
    }

    // I Must Go Alone CC (parity with dc-play-area.js:1012-1013):
    // when game.roundDefenderCannotBeTargetedUnlessWithinSpaces protects the
    // enemy player, targets beyond the spaces cap are filtered.
    const _iMustGoAlone = game.roundDefenderCannotBeTargetedUnlessWithinSpaces;
    if (_iMustGoAlone?.playerNum === enemyPn && dist > _iMustGoAlone.spaces) continue;

    // Blend In (K-2SO): the attached figure cannot be the target of an attack.
    if (game.blendInUntargetable?.[fk]) continue;

    // LOS check with figure blocking (parity with dc-play-area.js)
    // Remove target's own footprint from blocking set (target doesn't block LOS to itself)
    let losBlockingCoords = figureBlockingCoords;
    const targetEff = getDcEffect(targetDcName);
    if (figureBlockingCoords === null) {
      losBlockingCoords = null; // attacker-side bypass active (Priority Target / MASSIVE / Scout form / Marksman)
    } else if ((targetEff?.keywords || []).some(kw => String(kw).toUpperCase() === 'MASSIVE')) {
      losBlockingCoords = null; // MASSIVE targets: no figure blocking
    } else if (targetSize && targetSize !== '1x1') {
      const targetFp = new Set(_aaTargetFpCells);
      losBlockingCoords = new Set([...figureBlockingCoords].filter(c => !targetFp.has(c)));
    } else {
      // Single-cell target: remove its own coord from blocking
      if (figureBlockingCoords.has(coordLc)) {
        losBlockingCoords = new Set(figureBlockingCoords);
        losBlockingCoords.delete(coordLc);
      }
    }

    // Multi-cell LOS: try attacker-fp × target-fp corner pairs (parity with
    // dc-play-area.js:1025-1030). Uses _aaEffectiveMs so closed doors and
    // energy shields block LOS.
    let los = false;
    outer: for (const ac of _aaAttackerFpCells) {
      for (const tc of _aaTargetFpCells) {
        if (hasLineOfSight(ac, tc, _aaEffectiveMs, losBlockingCoords)) { los = true; break outer; }
      }
    }

    // Fire Mission (parity with dc-play-area.js:1032-1050): if primary LOS
    // failed and the attacker group is in Fire Mission mode, retry LOS from
    // every other figure in the same group. Uses the same _aaEffectiveMs and
    // losBlockingCoords as the primary check. Attachment-aware figure count
    // covers Z-6 / Mortar / Riot Trooper squad upgrades that bump the group
    // size by 1. Blast 1 is a combat-resolution concern, not target
    // enumeration, so out of scope here.
    if (!los && game.fireMissionActive?.[figureKey]) {
      const _fmDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _fmFigCount = getDcStats(meta.dcName)?.figures ?? 1;
      const _fmSuAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _fmTotalFigs = effectiveFigureCount(_fmFigCount, _fmSuAtts);
      fmRetry: for (let fi2 = 0; fi2 < _fmTotalFigs; fi2++) {
        if (fi2 === figureIndex) continue;
        const otherFk = `${meta.dcName}-${_fmDgIdx}-${fi2}`;
        const otherPos = game.figurePositions?.[playerNum]?.[otherFk];
        if (!otherPos) continue;
        const otherSize = game.figureOrientations?.[otherFk] || getFigureSize(meta.dcName);
        const otherFpCells = getFootprintCells(otherPos, otherSize);
        for (const oac of otherFpCells) {
          for (const tc of _aaTargetFpCells) {
            if (hasLineOfSight(oac, tc, _aaEffectiveMs, losBlockingCoords)) { los = true; break fmRetry; }
          }
        }
      }
    }

    if (!los) continue;

    // Insignificant (Dio): can't be targeted if in same space as a friendly figure
    const _insigEff = targetEff;
    if ((_insigEff?.specialAbilityIds || []).includes('insignificant_dio')) {
      const friendlyPositions = game.figurePositions?.[enemyPn] || {};
      const hasFriendlyInSpace = Object.entries(friendlyPositions).some(([ffk, fpos]) =>
        ffk !== fk && fpos && String(fpos).toLowerCase() === coordLc
      );
      if (hasFriendlyInSpace) continue;
    }
    targets.push({ figureKey: fk, coord: coordLc, label: targetDcName, hasLOS: los, dist });
  }

  // NPC targets (Krykna, Thugs): neutral hostile figures targetable by attacks
  for (const [npcArray, npcType] of [[game.npcKrykna, 'krykna'], [game.npcThugs, 'thug']]) {
    if (!Array.isArray(npcArray)) continue;
    for (let i = 0; i < npcArray.length; i++) {
      const npc = npcArray[i];
      if (npc.defeated) continue;
      const npcCoord = String(npc.coord).toLowerCase();
      // Distance/LOS use attacker footprint iteration for multi-cell parity
      // and _aaEffectiveMs for door/shield LOS correctness.
      let npcDist = Infinity;
      for (const ac of _aaAttackerFpCells) {
        const d = countSpaces(ms, ac, npcCoord, _aaClosedDoorEdges);
        if (d < npcDist) npcDist = d;
      }
      if (npcDist < minRange || npcDist > maxRange) continue;
      let npcLosBlocking = figureBlockingCoords;
      if (figureBlockingCoords && figureBlockingCoords.has(npcCoord)) {
        npcLosBlocking = new Set(figureBlockingCoords);
        npcLosBlocking.delete(npcCoord);
      }
      let npcLos = false;
      for (const ac of _aaAttackerFpCells) {
        if (hasLineOfSight(ac, npcCoord, _aaEffectiveMs, npcLosBlocking)) { npcLos = true; break; }
      }
      if (!npcLos) continue;
      const npcLabel = npcType === 'thug' ? `Thug ${i + 1}` : `Krykna ${i + 1}`;
      targets.push({ figureKey: `npc_${npcType}_${i}`, coord: npcCoord, label: npcLabel, hasLOS: npcLos, dist: npcDist, isNpc: true, npcType, npcIndex: i });
    }
  }

  return targets;
}
