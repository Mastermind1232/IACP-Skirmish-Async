import {
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../game/activation-state.js';

export const phaseReducerHandlers = {
  GameCreated(state, payload) {
    return {
      ...(state || {}),
      gameId: payload.generalId,
      player1Id: payload.player1Id,
      player2Id: payload.player2Id,
      generalId: payload.generalId,
      gameCategoryId: payload.gameCategoryId || null,
      phase: 'map_selection',
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      p1DcList: [],
      p2DcList: [],
    };
  },

  MapSelected(state, payload) {
    return {
      ...state,
      selectedMap: payload.mapId,
      selectedMission: payload.missionVariant || null,
      phase: 'initiative',
    };
  },

  InitiativeDetermined(state, payload) {
    return {
      ...state,
      initiativePlayerNum: payload.initiativePlayerNum,
      phase: 'zone_selection',
    };
  },

  DeploymentZoneChosen(state, payload) {
    const key = payload.playerNum === 1 ? 'player1DeploymentZone' : 'player2DeploymentZone';
    return {
      ...state,
      [key]: payload.zoneId,
      phase: 'deployment',
    };
  },

  DeploymentCompleted(state, payload) {
    const key = payload.playerNum === 1 ? 'player1Deployed' : 'player2Deployed';
    return {
      ...state,
      [key]: true,
    };
  },

  AttachmentsConfirmed(state, payload) {
    return {
      ...state,
      setupAttachmentConfirmed: true,
    };
  },

  CommandCardsDrawn(state, payload) {
    const key = payload.playerNum === 1 ? 'player1CcDrawn' : 'player2CcDrawn';
    return {
      ...state,
      [key]: true,
    };
  },

  RoundStarted(state, payload) {
    const next = { ...state };
    next.currentRound = payload.roundNumber;
    next.phase = 'round_active';
    next.roundPhase = 'start_of_round';
    for (const key of ROUND_OBJECT_FLAGS) {
      next[key] = {};
    }
    for (const key of ROUND_NULL_FLAGS) {
      next[key] = null;
    }
    for (const key of ROUND_ARRAY_FLAGS) {
      next[key] = [];
    }
    for (const key of ROUND_FALSE_FLAGS) {
      next[key] = false;
    }
    for (const key of ROUND_DELETE_FLAGS) {
      delete next[key];
    }
    return next;
  },

  ActivationPhaseStarted(state, payload) {
    return {
      ...state,
      roundPhase: 'activation',
      currentActivationTurnPlayerId: payload.activePlayerId || null,
    };
  },

  ActivationPhaseEnded(state) {
    return {
      ...state,
      player1ActivationPhaseEnded: true,
      player2ActivationPhaseEnded: true,
    };
  },

  EndOfRoundStarted(state) {
    return {
      ...state,
      roundPhase: 'end_of_round',
    };
  },

  RoundEnded(state) {
    return {
      ...state,
      roundPhase: null,
    };
  },

  GameEnded(state, payload) {
    return {
      ...state,
      ended: true,
      winnerId: payload.winnerId,
      phase: 'ended',
    };
  },

  PhaseGateOpened(state, payload) {
    return {
      ...state,
      phaseGate: {
        phase: payload.gateType,
        p1Ready: false,
        p2Ready: false,
      },
    };
  },

  PhaseGatePlayerReady(state, payload) {
    const readyKey = payload.playerNum === 1 ? 'p1Ready' : 'p2Ready';
    return {
      ...state,
      phaseGate: {
        ...state.phaseGate,
        [readyKey]: true,
      },
    };
  },

  PhaseGateCleared(state) {
    const next = { ...state };
    delete next.phaseGate;
    return next;
  },
};
