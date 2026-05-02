import {
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
} from '../../game/activation-state.js';

export const activationReducerHandlers = {
  DcActivated(state, payload) {
    const dcActionsData = { ...(state.dcActionsData || {}) };
    dcActionsData[payload.msgId] = {
      remaining: payload.totalActions || 2,
      total: payload.totalActions || 2,
      threadId: payload.threadId || null,
      messageId: payload.messageId || null,
      specialsUsed: [],
      selectedFigure: payload.selectedFigure || null,
    };
    const activatedDcIndices = [...(state.activatedDcIndices || [])];
    if (payload.dcIndex != null && !activatedDcIndices.includes(payload.dcIndex)) {
      activatedDcIndices.push(payload.dcIndex);
    }
    return { ...state, dcActionsData, activatedDcIndices };
  },

  DcActionPerformed(state, payload) {
    const dcActionsData = { ...(state.dcActionsData || {}) };
    const entry = dcActionsData[payload.msgId];
    if (entry) {
      dcActionsData[payload.msgId] = {
        ...entry,
        remaining: entry.remaining - (payload.actionCost || 1),
      };
    }
    return { ...state, dcActionsData };
  },

  DcEndedActivation(state, payload) {
    const dcActionsData = { ...(state.dcActionsData || {}) };
    const entry = dcActionsData[payload.msgId];
    if (entry) {
      dcActionsData[payload.msgId] = { ...entry, remaining: 0 };
    }
    return { ...state, dcActionsData };
  },

  ActivationCleanedUp(state, payload) {
    const next = { ...state };
    for (const key of ACTIVATION_MSGID_FLAGS) {
      if (next[key]?.[payload.msgId] !== undefined) {
        next[key] = { ...next[key] };
        delete next[key][payload.msgId];
      }
    }
    if (payload.figureKeys) {
      for (const key of ACTIVATION_FIGKEY_FLAGS) {
        if (!next[key]) continue;
        next[key] = { ...next[key] };
        for (const fk of payload.figureKeys) {
          delete next[key][fk];
        }
      }
    }
    if (payload.playerNum) {
      for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
        if (next[key]?.[payload.playerNum] !== undefined) {
          next[key] = { ...next[key] };
          delete next[key][payload.playerNum];
        }
      }
    }
    for (const key of ACTIVATION_SCALAR_FLAGS) {
      delete next[key];
    }
    return next;
  },

  ActivationTurnPassed(state, payload) {
    return {
      ...state,
      currentActivationTurnPlayerNum: payload.newActivePlayerNum,
    };
  },
};
