import { Saga } from './saga.js';

export const MOVEMENT_STATES = {
  STARTED: 'STARTED',
  CHOOSING_SPACE: 'CHOOSING_SPACE',
  MOVING: 'MOVING',
  INTERRUPTED: 'INTERRUPTED',
  COMPLETED: 'COMPLETED',
};

export class MovementSaga extends Saga {
  constructor(id, movementData = {}) {
    super(id, 'movement', {
      phase: MOVEMENT_STATES.STARTED,
      figureKey: movementData.figureKey || null,
      movementPoints: movementData.movementPoints || 0,
      remaining: movementData.movementPoints || 0,
      path: [],
      ...movementData,
    });
  }

  startMovement(figureKey, mp) {
    this.state.figureKey = figureKey;
    this.state.movementPoints = mp;
    this.state.remaining = mp;
    this.state.phase = MOVEMENT_STATES.CHOOSING_SPACE;
    this.recordStep('startMovement', { figureKey, mp });
  }

  moveToSpace(coord, mpCost = 1) {
    this.state.path.push(coord);
    this.state.remaining -= mpCost;
    this.state.phase = MOVEMENT_STATES.MOVING;
    this.recordStep('moveToSpace', { coord, mpCost, remaining: this.state.remaining });
  }

  interrupt(type) {
    this.state.phase = MOVEMENT_STATES.INTERRUPTED;
    this.state.interruptType = type;
    this.recordStep('interrupt', { type });
  }

  resumeAfterInterrupt() {
    this.state.phase = this.state.remaining > 0 ? MOVEMENT_STATES.CHOOSING_SPACE : MOVEMENT_STATES.COMPLETED;
    delete this.state.interruptType;
    this.recordStep('resumeAfterInterrupt');
  }

  complete() {
    this.state.phase = MOVEMENT_STATES.COMPLETED;
    super.complete();
    this.recordStep('complete');
  }

  getExpectedActions() {
    switch (this.state.phase) {
      case MOVEMENT_STATES.STARTED: return ['move_mp'];
      case MOVEMENT_STATES.CHOOSING_SPACE: return ['move_pick', 'move_letter', 'move_back', 'move_adjust'];
      case MOVEMENT_STATES.MOVING: return ['move_pick', 'move_letter', 'move_back'];
      case MOVEMENT_STATES.INTERRUPTED: return []; // waiting for interrupt resolution
      case MOVEMENT_STATES.COMPLETED: return [];
      default: return [];
    }
  }
}
