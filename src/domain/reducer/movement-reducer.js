export const movementReducerHandlers = {
  MovementStarted(state, payload) {
    const moveInProgress = { ...(state.moveInProgress || {}) };
    moveInProgress[payload.figureKey] = {
      figureKey: payload.figureKey,
      movementPoints: payload.movementPoints,
      remaining: payload.movementPoints,
      startCoord: payload.startCoord || null,
      path: [],
    };
    return { ...state, moveInProgress };
  },

  MovementPointsAdjusted(state, payload) {
    const entry = state.moveInProgress?.[payload.figureKey];
    if (!entry) return state;
    const moveInProgress = {
      ...state.moveInProgress,
      [payload.figureKey]: {
        ...entry,
        remaining: entry.remaining + payload.adjustment,
        movementPoints: entry.movementPoints + payload.adjustment,
      },
    };
    return { ...state, moveInProgress };
  },

  FigureMoved(state, payload) {
    // Update figurePositions
    const figurePositions = structuredClone(state.figurePositions || {});
    const playerPositions = figurePositions[payload.playerNum] || {};
    playerPositions[payload.figureKey] = payload.toCoord;
    figurePositions[payload.playerNum] = playerPositions;

    // Deduct MP if moveInProgress exists
    const moveInProgress = state.moveInProgress ? { ...state.moveInProgress } : {};
    const entry = moveInProgress[payload.figureKey];
    if (entry) {
      moveInProgress[payload.figureKey] = {
        ...entry,
        remaining: entry.remaining - (payload.mpCost ?? 1),
        path: [...entry.path, payload.toCoord],
      };
    }

    return { ...state, figurePositions, moveInProgress };
  },

  MovementCompleted(state, payload) {
    const moveInProgress = { ...state.moveInProgress };
    delete moveInProgress[payload.figureKey];
    return { ...state, moveInProgress };
  },

  MovementCancelled(state, payload) {
    const moveInProgress = { ...state.moveInProgress };
    const entry = moveInProgress[payload.figureKey];

    // Revert position if original coord provided
    let figurePositions = state.figurePositions;
    if (payload.originalCoord && payload.playerNum) {
      figurePositions = structuredClone(state.figurePositions || {});
      const playerPositions = figurePositions[payload.playerNum] || {};
      playerPositions[payload.figureKey] = payload.originalCoord;
      figurePositions[payload.playerNum] = playerPositions;
    }

    delete moveInProgress[payload.figureKey];
    return { ...state, figurePositions, moveInProgress };
  },

  FigurePushed(state, payload) {
    const figurePositions = structuredClone(state.figurePositions || {});
    const playerPositions = figurePositions[payload.playerNum] || {};
    playerPositions[payload.figureKey] = payload.toCoord;
    figurePositions[payload.playerNum] = playerPositions;
    return { ...state, figurePositions };
  },
};
