export const vpReducerHandlers = {
  VpAwarded(state, payload) {
    const vpKey = payload.playerNum === 1 ? 'player1VP' : 'player2VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.total += payload.amount;
    if (payload.reason === 'kill') vp.kills += payload.amount;
    if (payload.reason === 'objective') vp.objectives += payload.amount;
    return { ...state, [vpKey]: vp };
  },

  VpDeducted(state, payload) {
    const vpKey = payload.playerNum === 1 ? 'player1VP' : 'player2VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.total = Math.max(0, vp.total - payload.amount);
    if (payload.reason === 'kill') vp.kills = Math.max(0, vp.kills - payload.amount);
    if (payload.reason === 'objective') vp.objectives = Math.max(0, vp.objectives - payload.amount);
    return { ...state, [vpKey]: vp };
  },

  ObjectiveClaimed(state, payload) {
    const vpKey = payload.playerNum === 1 ? 'player1VP' : 'player2VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.objectives += (payload.vpValue || 0);
    vp.total += (payload.vpValue || 0);
    const claimedObjectives = [...(state.claimedObjectives || [])];
    claimedObjectives.push(payload.objectiveId);
    return { ...state, [vpKey]: vp, claimedObjectives };
  },

  TerminalControlled(state, payload) {
    const vpKey = payload.playerNum === 1 ? 'player1VP' : 'player2VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.objectives += (payload.vpValue || 0);
    vp.total += (payload.vpValue || 0);
    return { ...state, [vpKey]: vp };
  },

  CrateCollected(state, payload) {
    const vpKey = payload.playerNum === 1 ? 'player1VP' : 'player2VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.objectives += (payload.vpValue || 0);
    vp.total += (payload.vpValue || 0);
    const collectedCrates = [...(state.collectedCrates || [])];
    collectedCrates.push(payload.crateId);
    return { ...state, [vpKey]: vp, collectedCrates };
  },
};
