import { phaseReducerHandlers } from './phase-reducer.js';
import { combatReducerHandlers } from './combat-reducer.js';
import { movementReducerHandlers } from './movement-reducer.js';
import { activationReducerHandlers } from './activation-reducer.js';
import { figureReducerHandlers } from './figure-reducer.js';
import { handReducerHandlers } from './hand-reducer.js';
import { vpReducerHandlers } from './vp-reducer.js';
import { setupReducerHandlers } from './setup-reducer.js';
import { abilityReducerHandlers } from './ability-reducer.js';

const ALL_HANDLERS = {
  ...phaseReducerHandlers,
  ...combatReducerHandlers,
  ...movementReducerHandlers,
  ...activationReducerHandlers,
  ...figureReducerHandlers,
  ...handReducerHandlers,
  ...vpReducerHandlers,
  ...setupReducerHandlers,
  ...abilityReducerHandlers,
};

export function gameReducer(state, event) {
  const handler = ALL_HANDLERS[event.type];
  if (!handler) {
    console.warn(`[reducer] No handler for event type: ${event.type}`);
    return state;
  }
  const cloned = structuredClone(state);
  return handler(cloned, event.payload, event);
}

export function getRegisteredReducerTypes() {
  return Object.keys(ALL_HANDLERS);
}
