// CSV-driven combat-ability registration (alexanbv 2026-06-15: "build ONLY on
// the new pipeline and register ALL combat abilities into their relevant gates
// from the CSV").
//
// docs/combat-spec.csv is the source of truth for which ability plugs into which
// timing window. This module reads every attack-window row and registers it into
// the combat-timing-registry so the gate's completeness view (timingIndicators-
// ForWindow) covers the ENTIRE library — every per-figure combat ability is
// catalogued in its gate, with shared abilities (Professional, Priority Target,
// …) registered once.
//
// Entries are registered TIMING-ONLY (no `applies`): they are catalogued in
// their window but NOT executed by abilitiesForWindow(). The hand-wired
// executable entries (combat-abilities-mods.js, with real `applies` + resolvers)
// remain the ones the live gate actually runs; as resolvers are implemented,
// abilities graduate from timing-only to executable. We import the hand-built
// catalog + mods FIRST so this module only fills the gap and never duplicates an
// ability already registered for the same name+window+side.

import './combat-ability-timing-catalog.js';
import './combat-abilities-mods.js';
import './combat-abilities-ondeclare.js';
import { loadAbilitySpec, GATE_TO_SPEC_WINDOW } from './combat-ability-db.js';
import { registerCombatAbility, getCombatAbility, allCombatAbilities } from './combat-timing-registry.js';

// spec timing → gate window (reverse of GATE_TO_SPEC_WINDOW; attack windows only)
const SPEC_TO_GATE = {};
for (const [gate, specs] of Object.entries(GATE_TO_SPEC_WINDOW)) {
  for (const s of specs) SPEC_TO_GATE[s] = gate;
}

function slug(s) {
  // Preserve a LEADING SIGN. Stripping it made "+1 Damage" and "-1 Damage"
  // collide on `1_damage`, so the second one registered was silently dropped as
  // already-covered — a printed penalty quietly inheriting a bonus's identity.
  // Surfaced 2026-09-01 by Gamorrean Guard (Regular), the first card in the
  // database with a negative innate.
  const sign = /^\s*([+-])/.exec(String(s));
  const body = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!sign) return body;
  return `${sign[1] === '-' ? 'minus' : 'plus'}_${body}`;
}

/** name+window+side keys already covered by an existing registry entry. */
function existingCoverageKeys() {
  const keys = new Set();
  for (const e of allCombatAbilities()) {
    const sides = e.side === 'either' ? ['attacker', 'defender'] : [e.side];
    for (const w of (e.windows || [])) {
      for (const s of sides) keys.add(`${e.name.toLowerCase()}|${w}|${s}`);
    }
  }
  return keys;
}

let _registered = false;

/**
 * Register every CSV attack-window ability not already covered, as a timing-only
 * catalog entry. Idempotent. Returns a small summary for tests/inspection.
 * @returns {{added:number, skippedExisting:number, total:number}}
 */
export function registerCsvCombatAbilities() {
  if (_registered) return _registered;
  const covered = existingCoverageKeys();
  // Dedup CSV rows by name+gateWindow+side (shared abilities → one entry).
  const seen = new Map(); // key → { name, gate, side, cards:Set }
  for (const rows of loadAbilitySpec().values()) {
    for (const r of rows) {
      const gate = SPEC_TO_GATE[r.timing];
      if (!gate) continue; // not an attack-gate window (e.g. spend_surges, start_of_round)
      const side = (r.attack_side === 'attacker' || r.attack_side === 'defender') ? r.attack_side : null;
      if (!side) continue; // attack-window rows must declare a side
      const key = `${r.ability.toLowerCase()}|${gate}|${side}`;
      if (!seen.has(key)) seen.set(key, { name: r.ability, gate, side, cards: new Set() });
      seen.get(key).cards.add(r.card);
    }
  }
  let added = 0;
  let skippedExisting = 0;
  for (const [key, e] of seen) {
    if (covered.has(key)) { skippedExisting++; continue; }
    const id = `csv:${slug(e.name)}:${e.gate}:${e.side}`;
    if (getCombatAbility(id)) { skippedExisting++; continue; }
    registerCombatAbility({
      id,
      name: e.name,
      windows: [e.gate],
      side: e.side,
      kind: 'interactive', // timing-only; kind is advisory until a resolver wires it
      // no `applies` → timing-only: catalogued in the gate, not yet executable
      detect: `CSV: ${[...e.cards].slice(0, 6).join(', ')}${e.cards.size > 6 ? ` +${e.cards.size - 6} more` : ''}`,
    });
    added++;
  }
  _registered = { added, skippedExisting, total: seen.size };
  return _registered;
}

/** Test hook: allow re-running registration after a registry wipe. */
export function _resetCsvRegistration() {
  _registered = false;
}

// Self-register on import (side-effect, like the hand-built catalog).
registerCsvCombatAbilities();
