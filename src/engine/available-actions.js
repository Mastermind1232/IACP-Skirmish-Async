/**
 * Available actions system: reads game state and returns all legal actions
 * for a given player. Each action includes a type, customId, and description.
 *
 * This is the foundation for the AI player — it can list what moves are legal
 * without needing Discord.
 */

import { ACTION_TYPES, buildCustomId } from './action-types.js';
import { getPlayerId, getInitiativePlayerNum, opponentPlayerNum } from '../game/player-helpers.js';
import { PHASES, ROUND_PHASES } from '../game/phase.js';
import { getRange, hasLineOfSight } from '../game/spatial.js';
import { dcNameFromFigureKey } from '../game/dc-helpers.js';

/**
 * Get all available actions for a player in the current game state.
 * @param {object} game - The game state
 * @param {number} playerNum - 1 or 2
 * @param {object} [deps] - Optional dependencies for advanced queries (dcMessageMeta, getDcStats, etc.)
 * @returns {Array<{ type: string, customId: string, description: string, params?: object }>}
 */
export function getAvailableActions(game, playerNum, deps = {}) {
  if (!game || game.ended) return [];

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
  const noActionsRemaining = !Object.values(game.dcActionsData || {}).some(d => d.remaining > 0);
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

  if (!isMyTurn) {
    // Not our turn — can only play CC cards or pass (plus end-phase above)
    return actions;
  }

  // Check if player has readied DCs to activate
  const activationsRemaining = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  if (activationsRemaining > 0) {
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
  } else if (!noActivations) {
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
      const playable = deps.getPlayableCcFromHand(hand, game, playerNum, { timing: 'special_action' });
      for (let i = 0; i < playable.length; i++) {
        const card = playable[i];
        actions.push({
          type: ACTION_TYPES.PLAY_CC,
          customId: `cc_play_${gameId}_${playerNum}_${i}`,
          description: `Play CC: ${card.name || card}`,
          params: { cardIndex: i, cardName: card.name || card },
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
    const rerollPn = combat.rerollPhase === 'attacker' ? attackerPn : defenderPn;
    if (playerNum === rerollPn) {
      const side = combat.rerollPhase;
      const rerollsRemaining = side === 'attacker'
        ? (combat.attackerRerollsRemaining ?? 0)
        : (combat.defenderRerollsRemaining ?? 0);
      const roll = side === 'attacker' ? combat.attackRoll : combat.defenseRoll;

      if (rerollsRemaining > 0 && roll?.dice) {
        for (let i = 0; i < roll.dice.length; i++) {
          actions.push({
            type: ACTION_TYPES.COMBAT_REROLL,
            customId: buildCustomId(ACTION_TYPES.COMBAT_REROLL, { gameId, dieIndex: i }),
            description: `Reroll ${side} die ${i + 1} (${roll.dice[i]?.color || 'unknown'})`,
            params: { side, dieIndex: i },
          });
        }
      }

      // Done rerolling / skip
      actions.push({
        type: ACTION_TYPES.COMBAT_RESOLVE,
        customId: buildCustomId(ACTION_TYPES.COMBAT_RESOLVE, { gameId }),
        description: 'Done rerolling',
      });
    }
    return actions;
  }

  // Surge assignment phase — list each spendable surge ability
  if (combat.pendingSurges || combat.surgeRemaining > 0) {
    if (playerNum === attackerPn) {
      const surgeAbilities = combat.surgeAbilities || [];
      for (let i = 0; i < surgeAbilities.length; i++) {
        const sa = surgeAbilities[i];
        const cost = sa.cost ?? 1;
        if (cost <= (combat.surgeRemaining ?? 0)) {
          actions.push({
            type: ACTION_TYPES.COMBAT_SURGE,
            customId: buildCustomId(ACTION_TYPES.COMBAT_SURGE, { gameId, surgeIndex: i }),
            description: `Spend surge: ${sa.label || sa.key || `ability ${i}`}`,
            params: { surgeIndex: i, surgeKey: sa.key },
          });
        }
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
