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
import { abilitiesForWindow } from './combat-timing-registry.js';
import { buildStepGate } from './combat-ability-gate.js';

/**
 * Build the mods-step gate from the registry for the current combat state.
 * @param {object} game
 * @param {object} combat  game.pendingCombat
 * @param {object} [deps]  injected helpers forwarded to ability `applies`/`kind`
 * @returns {object} a combat-ability-gate gate
 */
export function buildModsGate(game, combat, deps = {}) {
  const attacker = abilitiesForWindow('mods', 'attacker', game, combat, deps);
  const defender = abilitiesForWindow('mods', 'defender', game, combat, deps);
  return buildStepGate('mods', [...attacker, ...defender]);
}
