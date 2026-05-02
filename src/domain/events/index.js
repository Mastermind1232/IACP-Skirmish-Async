export { PHASE_EVENTS, PHASE_EVENT_SCHEMAS } from './phase-events.js';
export { COMBAT_EVENTS, COMBAT_EVENT_SCHEMAS } from './combat-events.js';
export { MOVEMENT_EVENTS, MOVEMENT_EVENT_SCHEMAS } from './movement-events.js';
export { ACTIVATION_EVENTS, ACTIVATION_EVENT_SCHEMAS } from './activation-events.js';
export { HAND_EVENTS, HAND_EVENT_SCHEMAS } from './hand-events.js';
export { FIGURE_EVENTS, FIGURE_EVENT_SCHEMAS } from './figure-events.js';
export { VP_EVENTS, VP_EVENT_SCHEMAS } from './vp-events.js';
export { SETUP_EVENTS, SETUP_EVENT_SCHEMAS } from './setup-events.js';
export { ABILITY_EVENTS, ABILITY_EVENT_SCHEMAS } from './ability-events.js';

import { PHASE_EVENTS, PHASE_EVENT_SCHEMAS } from './phase-events.js';
import { COMBAT_EVENTS, COMBAT_EVENT_SCHEMAS } from './combat-events.js';
import { MOVEMENT_EVENTS, MOVEMENT_EVENT_SCHEMAS } from './movement-events.js';
import { ACTIVATION_EVENTS, ACTIVATION_EVENT_SCHEMAS } from './activation-events.js';
import { HAND_EVENTS, HAND_EVENT_SCHEMAS } from './hand-events.js';
import { FIGURE_EVENTS, FIGURE_EVENT_SCHEMAS } from './figure-events.js';
import { VP_EVENTS, VP_EVENT_SCHEMAS } from './vp-events.js';
import { SETUP_EVENTS, SETUP_EVENT_SCHEMAS } from './setup-events.js';
import { ABILITY_EVENTS, ABILITY_EVENT_SCHEMAS } from './ability-events.js';

export const DOMAIN_EVENT_TYPES = {
  ...PHASE_EVENTS,
  ...COMBAT_EVENTS,
  ...MOVEMENT_EVENTS,
  ...ACTIVATION_EVENTS,
  ...HAND_EVENTS,
  ...FIGURE_EVENTS,
  ...VP_EVENTS,
  ...SETUP_EVENTS,
  ...ABILITY_EVENTS,
};

const ALL_SCHEMAS = {
  ...PHASE_EVENT_SCHEMAS,
  ...COMBAT_EVENT_SCHEMAS,
  ...MOVEMENT_EVENT_SCHEMAS,
  ...ACTIVATION_EVENT_SCHEMAS,
  ...HAND_EVENT_SCHEMAS,
  ...FIGURE_EVENT_SCHEMAS,
  ...VP_EVENT_SCHEMAS,
  ...SETUP_EVENT_SCHEMAS,
  ...ABILITY_EVENT_SCHEMAS,
};

export function getAllEventTypes() {
  return Object.keys(DOMAIN_EVENT_TYPES).sort();
}

export function validateEvent(event) {
  const errors = [];
  if (!event || !event.type) {
    return { valid: false, errors: ['Missing event type'] };
  }
  if (!DOMAIN_EVENT_TYPES[event.type]) {
    errors.push(`Unknown event type: ${event.type}`);
  }
  const schema = ALL_SCHEMAS[event.type];
  if (schema) {
    for (const field of schema.required) {
      if (event.payload == null || !(field in event.payload)) {
        errors.push(`Missing required payload field: ${field}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
