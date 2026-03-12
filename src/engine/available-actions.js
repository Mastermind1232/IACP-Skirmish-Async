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

  // Is it this player's activation turn?
  const isMyTurn = game.currentActivationTurnPlayerId === playerId;

  if (!isMyTurn) {
    // Not our turn — can only play CC cards or pass
    return actions;
  }

  // Check if player has readied DCs to activate
  const activationsRemaining = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  if (activationsRemaining > 0) {
    // Can activate a DC — need dcMessageMeta to list available DCs
    if (deps.dcMessageMeta) {
      for (const [msgId, meta] of deps.dcMessageMeta) {
        if (meta.gameId !== gameId || meta.playerNum !== playerNum) continue;
        // Check if this DC is readied (not exhausted) and not depleted
        const exhausted = deps.dcExhaustedState?.get(msgId) ?? false;
        if (exhausted) continue;
        const depleted = game.p1DepletedDcMessageIds?.includes(msgId) || game.p2DepletedDcMessageIds?.includes(msgId);
        if (depleted) continue;

        actions.push({
          type: ACTION_TYPES.ACTIVATE_DC,
          customId: buildCustomId(ACTION_TYPES.ACTIVATE_DC, { msgId }),
          description: `Activate ${meta.displayName || meta.dcName}`,
          params: { msgId, dcName: meta.dcName },
        });
      }
    }

    // Can pass activation turn
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

      // This DC has actions remaining — can move, attack, interact, or special
      actions.push({
        type: ACTION_TYPES.MOVE_FIGURE,
        customId: buildCustomId(ACTION_TYPES.MOVE_FIGURE, { msgId }),
        description: `Move with ${meta.displayName || meta.dcName}`,
        params: { msgId, dcName: meta.dcName },
      });

      actions.push({
        type: ACTION_TYPES.ATTACK_TARGET,
        customId: buildCustomId(ACTION_TYPES.ATTACK_TARGET, { msgId }),
        description: `Attack with ${meta.displayName || meta.dcName}`,
        params: { msgId, dcName: meta.dcName },
      });

      // End turn for this DC
      actions.push({
        type: ACTION_TYPES.END_TURN,
        customId: buildCustomId(ACTION_TYPES.END_TURN, { msgId }),
        description: `End turn for ${meta.displayName || meta.dcName}`,
        params: { msgId, dcName: meta.dcName },
      });
    }
  }

  // End activation phase (if both players have used all activations)
  const shouldShowEnd = (game.p1ActivationsRemaining ?? 0) === 0 && (game.p2ActivationsRemaining ?? 0) === 0;
  if (shouldShowEnd) {
    actions.push({
      type: ACTION_TYPES.END_ACTIVATION_PHASE,
      customId: buildCustomId(ACTION_TYPES.END_ACTIVATION_PHASE, { gameId }),
      description: 'End Activation Phase',
    });
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

  // Rolling phase
  if (!combat.attackRoll || !combat.defenseRoll) {
    if (playerNum === attackerPn || playerNum === defenderPn) {
      actions.push({
        type: ACTION_TYPES.COMBAT_ROLL,
        customId: buildCustomId(ACTION_TYPES.COMBAT_ROLL, { gameId }),
        description: 'Roll dice',
      });
    }
    return actions;
  }

  // Reroll phase
  if (combat.rerollPhase) {
    const rerollPn = combat.rerollPhase === 'attacker' ? attackerPn : defenderPn;
    if (playerNum === rerollPn) {
      // Can reroll or skip
      actions.push({
        type: ACTION_TYPES.COMBAT_RESOLVE,
        customId: buildCustomId(ACTION_TYPES.COMBAT_RESOLVE, { gameId }),
        description: 'Skip rerolls and resolve',
      });
    }
    return actions;
  }

  // Surge assignment phase
  if (combat.pendingSurges) {
    if (playerNum === attackerPn) {
      actions.push({
        type: ACTION_TYPES.COMBAT_SKIP_SURGES,
        customId: buildCustomId(ACTION_TYPES.COMBAT_RESOLVE, { gameId }),
        description: 'Skip surges and resolve',
      });
    }
    return actions;
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
      // Space picking is complex — simplified here
      actions.push({
        type: ACTION_TYPES.MOVE_PICK_SPACE,
        customId: `move_pick_${moveKey}_done`,
        description: 'Finish movement',
        params: { moveKey },
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
  if (game.endOfRoundWhoseTurn && game.endOfRoundWhoseTurn !== playerId) return [];

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
