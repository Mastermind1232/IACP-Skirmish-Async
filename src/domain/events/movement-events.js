export const MOVEMENT_EVENTS = {
  MovementStarted: 'MovementStarted',
  MovementPointsAdjusted: 'MovementPointsAdjusted',
  FigureMoved: 'FigureMoved',
  MovementCompleted: 'MovementCompleted',
  MovementCancelled: 'MovementCancelled',
  FigurePushed: 'FigurePushed',
};

export const MOVEMENT_EVENT_SCHEMAS = {
  MovementStarted: { required: ['figureKey', 'movementPoints'] },
  MovementPointsAdjusted: { required: ['figureKey', 'adjustment'] },
  FigureMoved: { required: ['figureKey', 'fromCoord', 'toCoord'] },
  MovementCompleted: { required: ['figureKey'] },
  MovementCancelled: { required: ['figureKey'] },
  FigurePushed: { required: ['figureKey', 'fromCoord', 'toCoord'] },
};
