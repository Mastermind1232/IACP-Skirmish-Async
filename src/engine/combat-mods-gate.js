// Mods-window gate builder — slice C wiring (alexanbv 2026-06-14).
//
// Bridges the timing registry to the ability gate for the `mods` step: pulls
// the eligible attacker + defender mods abilities from the registry and builds
// the gate the pipeline drives (passives auto-fire, interactive resolved in
// player-chosen order, attacker gate then defender gate).
//
// Importing ./combat-abilities-mods.js for its registration side-effect so the
// registry is populated wherever this builder is used.

import './combat-abilities-mods.js';
import './combat-ability-timing-catalog.js'; // complete timing indicators for every combat ability
import './combat-abilities-from-csv.js'; // register ALL combat abilities into their gates from the CSV (timing-only until wired)
// Executable resolvers LAST so they overwrite any timing-only catalog/CSV entry
// for the same id (registerCombatAbility is last-write-wins per id).
import './combat-abilities-special.js'; // executable special-window die-turns (Zeb)
import './combat-abilities-zillo.js'; // executable zillo-window pierce-cancel
import './combat-abilities-rerolls.js'; // executable rerolls-window (generic innate rerolls)
import './combat-abilities-windows.js'; // condition-driven on_declare/mods/after_resolve (offer all legal abilities)
import { abilitiesForWindow } from './combat-timing-registry.js';
import { buildStepGate } from './combat-ability-gate.js';

/**
 * Build the gate for ANY attack window from the registry for the current combat
 * state. One generic builder serves every window (on_declare, rerolls, mods,
 * special, after_resolve) — it asks the registry which executable abilities are
 * eligible for each side and builds the attacker-then-defender gate the pipeline
 * drives. Per alexanbv 2026-06-15 ("wire the other combat windows to allow for
 * the inclusion of abilities in those windows").
 * @param {string} window  a combat-timing-registry TIMING_WINDOWS value
 * @param {object} game
 * @param {object} combat  game.pendingCombat
 * @param {object} [deps]  injected helpers forwarded to ability `applies`/`kind`
 * @returns {object} a combat-ability-gate gate
 */
export function buildWindowGate(window, game, combat, deps = {}) {
  const attacker = abilitiesForWindow(window, 'attacker', game, combat, deps);
  const defender = abilitiesForWindow(window, 'defender', game, combat, deps);
  return buildStepGate(window, [...attacker, ...defender]);
}

/**
 * Build the mods-step gate (thin wrapper over buildWindowGate for existing call
 * sites).
 * @param {object} game
 * @param {object} combat  game.pendingCombat
 * @param {object} [deps]  injected helpers forwarded to ability `applies`/`kind`
 * @returns {object} a combat-ability-gate gate
 */
export function buildModsGate(game, combat, deps = {}) {
  return buildWindowGate('mods', game, combat, deps);
}
