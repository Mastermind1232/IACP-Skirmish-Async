export const abilityReducerHandlers = {
  AbilityTriggered(state, payload) {
    const triggeredAbilities = [...(state.triggeredAbilities || [])];
    triggeredAbilities.push({ abilityId: payload.abilityId, source: payload.source });
    return { ...state, triggeredAbilities };
  },

  AbilityResolved(state, payload) {
    return { ...state, lastResolvedAbility: { abilityId: payload.abilityId, result: payload.result } };
  },

  InterruptPrompted(state, payload) {
    const pendingField = payload.pendingField || `pending${payload.interruptType}`;
    return {
      ...state,
      [pendingField]: {
        interruptType: payload.interruptType,
        playerNum: payload.playerNum,
        data: payload.data || {},
      },
    };
  },

  InterruptResolved(state, payload) {
    const pendingField = payload.pendingField || `pending${payload.interruptType}`;
    const next = { ...state };
    delete next[pendingField];
    return next;
  },

  StartOfRoundEffectRun(state, payload) {
    const sorEffectsRun = [...(state.sorEffectsRun || [])];
    sorEffectsRun.push(payload.effectId);
    return { ...state, sorEffectsRun };
  },

  EndOfRoundEffectRun(state, payload) {
    const eorEffectsRun = [...(state.eorEffectsRun || [])];
    eorEffectsRun.push(payload.effectId);
    return { ...state, eorEffectsRun };
  },
};
