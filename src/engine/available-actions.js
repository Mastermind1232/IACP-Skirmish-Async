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
import { getRange, hasLineOfSight } from '../game/spatial.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';
import { getAttackerSurgeAbilities, SURGE_LABELS, parseSurgeEffect } from '../game/combat.js';
import { getLegalInteractOptions } from '../game/board-helpers.js';
import { isDcCompanion, getDcEffects } from '../data-loader.js';

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
      const ccDeckLen = (game[`p${playerNum}CcDeck`] || []).length;
      return [
        { type: 'bleed_accept', customId: `bleed_accept_${gameId}_${playerNum}_${bl.figureKey}`, description: `Bleeding: ${bl.displayName} takes 1 damage` },
        { type: 'bleed_prevent', customId: `bleed_prevent_${gameId}_${playerNum}_${bl.figureKey}`, description: `Bleeding: prevent (discard CC, ${ccDeckLen} left)`, disabled: ccDeckLen === 0 },
      ].filter(a => !a.disabled);
    }
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
  const isReady = playerNum === 1 ? gate.p1Ready : gate.p2Ready;
  const actions = [];

  if (!isReady) {
    actions.push({
      type: ACTION_TYPES.PHASE_GATE_READY,
      customId: buildCustomId(ACTION_TYPES.PHASE_GATE_READY, { gameId: game.gameId, playerNum }),
      description: `Ready for ${gate.phase}`,
    });
  } else {
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
  // Both players can roll for initiative
  return [{
    type: ACTION_TYPES.DETERMINE_INITIATIVE,
    customId: buildCustomId(ACTION_TYPES.DETERMINE_INITIATIVE, { gameId: game.gameId }),
    description: 'Roll for initiative',
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

  // Auto-deploy is always available during deployment
  actions.push({
    type: ACTION_TYPES.AUTO_DEPLOY,
    customId: buildCustomId(ACTION_TYPES.AUTO_DEPLOY, { gameId }),
    description: 'Auto-deploy all figures',
  });

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

  // Check for pending sub-states first
  if (game.pendingCombat) {
    return getCombatActions(game, playerNum, deps);
  }

  if (game.moveInProgress && Object.keys(game.moveInProgress).length > 0) {
    return getMovementActions(game, playerNum, deps);
  }

  if (game.pendingNegation) {
    return getNegationActions(game, playerNum);
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

  // Check round phase
  switch (game.roundPhase) {
    case ROUND_PHASES.START_OF_ROUND:
      return getStartOfRoundActions(game, playerNum);

    case ROUND_PHASES.ACTIVATION:
      return getActivationActions(game, playerNum, deps);

    case ROUND_PHASES.END_OF_ROUND:
      return getEndOfRoundActions(game, playerNum);

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
    if (d.remaining <= 0) return false;
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
      if (data && data.remaining > 0) {
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
      // Can pass activation turn
      actions.push({
        type: ACTION_TYPES.PASS_ACTIVATION_TURN,
        customId: buildCustomId(ACTION_TYPES.PASS_ACTIVATION_TURN, { gameId }),
        description: 'Pass activation turn',
      });
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
      if (!data || data.remaining <= 0) continue;

      // Skip if all figures for this DC are defeated (no positions on board)
      const figs = game.figurePositions?.[playerNum] || {};
      const hasSurvivors = Object.keys(figs).some(fk => fk.startsWith(meta.dcName + '-'));
      if (!hasSurvivors) continue;

      // This DC has actions remaining — can move, attack, interact, or special
      const displayName = meta.displayName || meta.dcName;
      const figureIndex = data.selectedFigure ?? 0;
      actions.push({
        type: ACTION_TYPES.MOVE_FIGURE,
        customId: buildCustomId(ACTION_TYPES.MOVE_FIGURE, { msgId, figureIndex }),
        description: `Move with ${displayName}`,
        params: { msgId, dcName: meta.dcName },
      });

      // Attack: compute individual targets if deps available
      const targets = computeAttackTargets(game, msgId, meta, figureIndex, playerNum, deps);
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
      } else {
        // Fallback: generic attack action (no target info available)
        actions.push({
          type: ACTION_TYPES.ATTACK_TARGET,
          customId: buildCustomId(ACTION_TYPES.ATTACK_TARGET, { msgId, figureIndex }),
          description: `Attack with ${displayName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }

      // Interact — compute legal interact options for each figure of this DC
      const mapId = game.selectedMap?.id;
      if (mapId) {
        const dcEff = getDcEffects()?.[meta.dcName];
        const abilityText = dcEff?.abilityText || '';
        const isNonSentient = abilityText.includes('Non-Sentient') && !game.beastTamerInteractOverride?.[msgId];
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
        const specialCosts = dcStats?.specialCosts || [];
        const specialsUsed = data.specialsUsed || [];
        const isStunned = (game.figureConditions?.[`${meta.dcName}-1-${figureIndex}`] || []).includes('Stun');

        for (let si = 0; si < specials.length; si++) {
          const cost = specialCosts[si] ?? 1;
          if (specialsUsed.includes(si)) continue; // Already used this activation
          if (data.remaining < cost) continue;      // Not enough actions
          if (isStunned) continue;                   // Stunned figures can't use specials

          actions.push({
            type: ACTION_TYPES.DC_SPECIAL,
            customId: buildCustomId(ACTION_TYPES.DC_SPECIAL, { msgId, specialIdx: si }),
            description: `${specials[si]} (${displayName})`,
            params: { msgId, dcName: meta.dcName, specialIdx: si, specialName: specials[si], cost },
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
      if (data && data.remaining <= 0) {
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
          description: `Illicit Arms: Discard ${hand[i]} for +1 Hit`,
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

  // During-reroll reactions
  if (game.pendingToughLuck) {
    const tl = game.pendingToughLuck;
    if (playerNum === game.toughLuckPlayerNum) {
      return [
        { type: 'tough_luck_remove', customId: `tough_luck_remove_${gameId}_${tl.idx}`, description: 'Tough Luck: Remove rerolled die' },
        { type: 'tough_luck_skip', customId: `tough_luck_skip_${gameId}`, description: 'Skip Tough Luck' },
      ];
    }
    return [];
  }

  // Combat ready check — both players must confirm
  if (!combat.p1Ready || !combat.p2Ready) {
    const isReady = playerNum === 1 ? combat.p1Ready : combat.p2Ready;
    if (!isReady) {
      actions.push({
        type: ACTION_TYPES.COMBAT_READY,
        customId: buildCustomId(ACTION_TYPES.COMBAT_READY, { gameId }),
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

  // Reroll phase — list each eligible die for reroll + done option
  if (combat.rerollPhase) {
    let rerollPn;
    if (combat.rerollPhase === 'attacker') {
      rerollPn = attackerPn;
    } else if (combat.rerollPhase === 'forced') {
      rerollPn = (combat.forcedRerollQueue || [])[0]?.controlPlayer ?? attackerPn;
    } else {
      rerollPn = defenderPn;
    }
    if (playerNum === rerollPn) {
      const phase = combat.rerollPhase;
      // For forced rerolls, determine which dice pool based on queue entry
      let sideKey, rerollsRemaining, diceResults, alreadyRerolled;
      if (phase === 'forced') {
        const entry = (combat.forcedRerollQueue || [])[0];
        rerollsRemaining = entry?.remaining ?? 0;
        // Forced rerolls can target attack, defense, or any
        const atkDice = combat.attackDiceResults || [];
        const defDice = combat.defenseDiceResults || [];
        const atkRerolled = combat.attackerRerolledIndices || [];
        const defRerolled = combat.defenderRerolledIndices || [];
        if (entry?.pool === 'attack' || entry?.pool === 'any') {
          for (let i = 0; i < atkDice.length; i++) {
            if (atkRerolled.includes(i)) continue;
            actions.push({
              type: ACTION_TYPES.COMBAT_REROLL,
              customId: buildCustomId(ACTION_TYPES.COMBAT_REROLL, { gameId, side: 'atk', dieIndex: i }),
              description: `Force reroll atk die ${i + 1} (${atkDice[i]?.color || 'unknown'})`,
              params: { side: 'atk', dieIndex: i },
            });
          }
        }
        if (entry?.pool === 'defense' || entry?.pool === 'any') {
          for (let i = 0; i < defDice.length; i++) {
            if (defRerolled.includes(i)) continue;
            actions.push({
              type: ACTION_TYPES.COMBAT_REROLL,
              customId: buildCustomId(ACTION_TYPES.COMBAT_REROLL, { gameId, side: 'def', dieIndex: i }),
              description: `Force reroll def die ${i + 1} (${defDice[i]?.color || 'unknown'})`,
              params: { side: 'def', dieIndex: i },
            });
          }
        }
        sideKey = 'atk'; // Used for done button
      } else {
        sideKey = phase === 'attacker' ? 'atk' : 'def';
        rerollsRemaining = phase === 'attacker'
          ? (combat.attackerRerollsRemaining ?? 0)
          : (combat.defenderRerollsRemaining ?? 0);
        diceResults = phase === 'attacker' ? combat.attackDiceResults : combat.defenseDiceResults;
        alreadyRerolled = phase === 'attacker' ? (combat.attackerRerolledIndices || []) : (combat.defenderRerolledIndices || []);

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

  // Surge assignment phase — list each spendable surge ability
  if (combat.pendingSurges || combat.surgeRemaining > 0) {
    if (playerNum === attackerPn) {
      // Compute surge abilities dynamically (they're not stored on combat state)
      const surgeKeys = getAttackerSurgeAbilities(combat);
      const surgesRemaining = combat.surgeRemaining ?? 0;

      for (let i = 0; i < surgeKeys.length; i++) {
        const key = surgeKeys[i];
        const isDouble = key.startsWith('double:');
        const cost = isDouble ? 2 : 1;
        if (cost > surgesRemaining) continue;

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

// ── Negation ─────────────────────────────────────────────────────────────────

function getNegationActions(game, playerNum) {
  const neg = game.pendingNegation;
  if (!neg) return [];

  const oppPn = opponentPlayerNum(neg.playedBy);
  if (playerNum !== oppPn) return [];

  return [
    {
      type: 'negation_play',
      customId: `negation_play_${game.gameId}`,
      description: 'Play Negation',
    },
    {
      type: 'negation_let_resolve',
      customId: `negation_let_resolve_${game.gameId}`,
      description: 'Let card resolve',
    },
  ];
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

function getEndOfRoundActions(game, playerNum) {
  const playerId = getPlayerId(game, playerNum);

  // Only the player whose turn it is in the EoR window can act
  if (!game.endOfRoundWhoseTurn) return [];
  if (game.endOfRoundWhoseTurn !== playerId) return [];

  return [{
    type: ACTION_TYPES.END_END_OF_ROUND,
    customId: buildCustomId(ACTION_TYPES.END_END_OF_ROUND, { gameId: game.gameId }),
    description: 'End "End of Round" window',
  }];
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
    delete game.pendingCelebration;
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

  // Offer CC discard options (1..maxDiscards)
  const hand = getCcHand(game, pending.playerNum) || [];
  const ccCostPerStrain = pending.ccCostPerStrain || 1;
  const maxDiscards = pending.amount > 0 ? Math.min(pending.amount, Math.floor(hand.length / ccCostPerStrain)) : 0;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDcListForPlayer(game, playerNum) {
  if (playerNum === 1) return game.player1Squad?.dcList || [];
  return game.player2Squad?.dcList || [];
}

/**
 * Compute valid attack targets for a given figure.
 * Simplified version of dc-play-area.js target computation for headless use.
 * Returns array of { figureKey, coord, label, hasLOS, dist }.
 */
function computeAttackTargets(game, msgId, meta, figureIndex, playerNum, deps) {
  const getDcStats = deps.getDcStats;
  const getMapSpaces = deps.getMapSpaces;
  if (!getDcStats || !getMapSpaces || !game.selectedMap?.id) return [];

  const stats = getDcStats(meta.dcName);
  const attackInfo = stats?.attack;
  if (!attackInfo) return [];

  // Determine attacker position
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerPos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!attackerPos) return [];

  // Range: melee = 1, ranged = accuracy-based (use generous max since accuracy is checked after roll)
  const isRanged = attackInfo.type === 'range';
  const [minRange, maxRange] = attackInfo.range || (isRanged ? [1, 20] : [1, 1]);
  const ms = getMapSpaces(game.selectedMap.id);
  if (!ms) return [];

  const enemyPn = opponentPlayerNum(playerNum);
  const enemyPositions = game.figurePositions?.[enemyPn] || {};
  const targets = [];

  for (const [fk, coord] of Object.entries(enemyPositions)) {
    if (!coord) continue;
    const dist = getRange(String(attackerPos).toLowerCase(), String(coord).toLowerCase());
    if (dist < minRange || dist > maxRange) continue;

    // LOS check (skip figure blocking for simplicity — full version is in dc-play-area)
    const los = hasLineOfSight(
      String(attackerPos).toLowerCase(),
      String(coord).toLowerCase(),
      ms,
      null,
    );
    if (!los) continue;

    const targetDcName = dcNameFromFigureKey(fk);
    targets.push({ figureKey: fk, coord: String(coord).toLowerCase(), label: targetDcName, hasLOS: los, dist });
  }

  return targets;
}
