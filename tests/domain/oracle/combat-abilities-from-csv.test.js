/**
 * CSV-driven combat-ability registration (alexanbv 2026-06-15: "build ONLY on
 * the new pipeline and register ALL combat abilities into their relevant gates
 * from the CSV"). Proves every attack-window ability in docs/combat-spec.csv is
 * registered in its gate window (executable OR timing-only), with shared
 * abilities registered once, and that this adds no executable entries (so the
 * live gate behavior is unchanged until resolvers are wired).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerCsvCombatAbilities } from '../../../src/engine/combat-abilities-from-csv.js';
import { timingIndicatorsForWindow } from '../../../src/engine/combat-timing-registry.js';
import { loadAbilitySpec, GATE_TO_SPEC_WINDOW } from '../../../src/engine/combat-ability-db.js';

const SPEC_TO_GATE = {};
for (const [g, ws] of Object.entries(GATE_TO_SPEC_WINDOW)) for (const w of ws) SPEC_TO_GATE[w] = g;

describe('combat-abilities-from-csv: full gate coverage from the CSV', () => {
  it('registers something for every attack gate window', () => {
    registerCsvCombatAbilities();
    for (const w of ['on_declare', 'rerolls', 'mods', 'after_resolve']) {
      assert.ok(timingIndicatorsForWindow(w).length > 0, `window ${w} has registered abilities`);
    }
  });

  it('every CSV attack-window ability is registered in its gate window+side', () => {
    registerCsvCombatAbilities();
    // Build the set of registered name|window|side (expanding 'either').
    const registered = new Set();
    for (const w of ['on_declare', 'rerolls', 'mods', 'after_resolve']) {
      for (const e of timingIndicatorsForWindow(w)) {
        const sides = e.side === 'either' ? ['attacker', 'defender'] : [e.side];
        for (const s of sides) registered.add(`${e.name.toLowerCase()}|${w}|${s}`);
      }
    }
    const missing = [];
    for (const rows of loadAbilitySpec().values()) {
      for (const r of rows) {
        const gate = SPEC_TO_GATE[r.timing];
        if (!gate) continue;
        if (r.attack_side !== 'attacker' && r.attack_side !== 'defender') continue;
        const key = `${r.ability.toLowerCase()}|${gate}|${r.attack_side}`;
        if (!registered.has(key)) missing.push(`${r.card} :: ${r.ability} (${gate}/${r.attack_side})`);
      }
    }
    assert.deepEqual(missing, [], `unregistered CSV abilities: ${missing.slice(0, 10).join('; ')}`);
  });

  it('shared keyword abilities (Professional, Priority Target) are registered once', () => {
    registerCsvCombatAbilities();
    const pro = timingIndicatorsForWindow('rerolls').filter((e) => e.name === 'Professional');
    assert.equal(pro.length, 1, 'Professional registered exactly once (shared)');
    const pt = timingIndicatorsForWindow('on_declare').filter((e) => e.name === 'Priority Target');
    assert.equal(pt.length, 1, 'Priority Target registered exactly once (shared)');
  });

  it('CSV entries are timing-only — they add NO executable entries (live gate unchanged)', () => {
    const summary = registerCsvCombatAbilities();
    assert.ok(summary.added > 100, `expected a large CSV catalog, got ${summary.added}`);
    // Every csv:-id entry is timing-only.
    for (const w of ['on_declare', 'rerolls', 'mods', 'after_resolve']) {
      for (const e of timingIndicatorsForWindow(w)) {
        if (e.id.startsWith('csv:')) {
          assert.equal(e.timingOnly, true, `${e.id} must be timing-only (no resolver yet)`);
        }
      }
    }
  });
});
