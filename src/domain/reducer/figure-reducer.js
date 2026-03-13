export const figureReducerHandlers = {
  FigureDeployed(state, payload) {
    const figurePositions = structuredClone(state.figurePositions || {});
    const playerPositions = figurePositions[payload.playerNum] || {};
    playerPositions[payload.figureKey] = payload.coord;
    figurePositions[payload.playerNum] = playerPositions;
    return { ...state, figurePositions };
  },

  FigureDamaged(state, payload) {
    const dcHealthState = structuredClone(state.dcHealthState || {});
    if (dcHealthState[payload.figureKey] != null) {
      dcHealthState[payload.figureKey] = Math.max(0, dcHealthState[payload.figureKey] - payload.amount);
    }
    return { ...state, dcHealthState };
  },

  FigureHealed(state, payload) {
    const dcHealthState = structuredClone(state.dcHealthState || {});
    if (dcHealthState[payload.figureKey] != null) {
      const maxHp = payload.maxHp ?? Infinity;
      dcHealthState[payload.figureKey] = Math.min(maxHp, dcHealthState[payload.figureKey] + payload.amount);
    }
    return { ...state, dcHealthState };
  },

  FigureDefeated(state, payload) {
    const figurePositions = structuredClone(state.figurePositions || {});
    const playerPositions = figurePositions[payload.playerNum] || {};
    delete playerPositions[payload.figureKey];
    figurePositions[payload.playerNum] = playerPositions;

    const depletedFigures = [...(state.depletedFigures || [])];
    depletedFigures.push(payload.figureKey);

    // Award VP to opponent
    const vpKey = payload.playerNum === 1 ? 'player2VP' : 'player1VP';
    const vp = { ...(state[vpKey] || { total: 0, kills: 0, objectives: 0 }) };
    vp.kills += (payload.vpValue || 0);
    vp.total += (payload.vpValue || 0);

    return { ...state, figurePositions, depletedFigures, [vpKey]: vp };
  },

  FigureStrained(state, payload) {
    const figureStrain = { ...(state.figureStrain || {}) };
    figureStrain[payload.figureKey] = (figureStrain[payload.figureKey] || 0) + payload.amount;
    return { ...state, figureStrain };
  },

  ConditionApplied(state, payload) {
    const figureConditions = { ...(state.figureConditions || {}) };
    const conditions = [...(figureConditions[payload.figureKey] || [])];
    if (!conditions.includes(payload.condition)) {
      conditions.push(payload.condition);
    }
    figureConditions[payload.figureKey] = conditions;
    return { ...state, figureConditions };
  },

  ConditionRemoved(state, payload) {
    const figureConditions = { ...(state.figureConditions || {}) };
    const conditions = (figureConditions[payload.figureKey] || []).filter(c => c !== payload.condition);
    figureConditions[payload.figureKey] = conditions;
    return { ...state, figureConditions };
  },

  PowerTokenGained(state, payload) {
    const figurePowerTokens = { ...(state.figurePowerTokens || {}) };
    const tokens = [...(figurePowerTokens[payload.figureKey] || [])];
    tokens.push(payload.tokenType);
    figurePowerTokens[payload.figureKey] = tokens;
    return { ...state, figurePowerTokens };
  },

  PowerTokenSpent(state, payload) {
    const figurePowerTokens = { ...(state.figurePowerTokens || {}) };
    const tokens = [...(figurePowerTokens[payload.figureKey] || [])];
    const idx = tokens.indexOf(payload.tokenType);
    if (idx >= 0) tokens.splice(idx, 1);
    figurePowerTokens[payload.figureKey] = tokens;
    return { ...state, figurePowerTokens };
  },
};
