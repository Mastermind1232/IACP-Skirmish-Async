// On-declare-window gate builder — slice C wiring (alexanbv 2026-06-14).
//
// Mirrors combat-mods-gate for the on_declare window: pulls the eligible
// attacker + defender on-declare abilities from the registry and builds the
// gate the on-declare window drives (passives auto-fire — they already do
// inline; interactive DC abilities + interleaved CC plays resolved in the
// player's chosen order, attacker gate then defender gate).
//
// Imports the catalog (timing indicators) then the executable on-declare
// abilities so the executable entries supersede the timing-only placeholders.

import './combat-ability-timing-catalog.js';
import './combat-abilities-ondeclare.js';
import './combat-abilities-from-csv.js'; // register ALL combat abilities into their gates from the CSV (timing-only until wired)
import { abilitiesForWindow } from './combat-timing-registry.js';
import { buildStepGate } from './combat-ability-gate.js';

/**
 * Build the on-declare gate from the registry for the current combat state.
 * @param {object} game
 * @param {object} combat  game.pendingCombat
 * @param {object} [deps]  injected helpers forwarded to ability applies/kind
 * @returns {object} a combat-ability-gate gate
 */
export function buildOnDeclareGate(game, combat, deps = {}) {
  const attacker = abilitiesForWindow('on_declare', 'attacker', game, combat, deps);
  const defender = abilitiesForWindow('on_declare', 'defender', game, combat, deps);
  return buildStepGate('on_declare', [...attacker, ...defender]);
}
