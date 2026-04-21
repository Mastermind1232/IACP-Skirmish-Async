/**
 * Oracle: Rebel Trooper (Elite) correctly exposes "Get into Position" as a
 * 2-action special and the generic mpBonus+applyFocus handler resolves it.
 *
 * Covers DC-CC ledger atoms:
 *   - DC-SPEC-GET-INTO-POSITION (newly owned by Rebel Trooper Elite)
 *
 * Three assertions:
 *   1. `getDcStats("Rebel Trooper (Elite)")` now lists the special with
 *      `specialCosts: [2]` — the new `actionCost: 2` library field
 *      propagates through data-loader even though the card does not declare
 *      `specialCosts` itself.
 *   2. The ability-library entry for `get_into_position` carries
 *      `actionCost: 2` — pinned so future edits that drop the field fail.
 *   3. Rebel Trooper (Elite) DC entry references the slug — pinned so a
 *      future scaffold/cleanup that drops the ID fails.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcStats, getAbilityLibrary, getDcEffects } from '../../../src/data-loader.js';

describe('DC-CC: Rebel Trooper (Elite) — Get into Position wiring', () => {
  it('library entry declares actionCost=2 and mpBonus=4', () => {
    const lib = getAbilityLibrary();
    const entry = lib.abilities?.get_into_position;
    assert.ok(entry, 'get_into_position missing from library');
    assert.equal(entry.actionCost, 2);
    assert.equal(entry.mpBonus, 4);
    assert.equal(entry.applyFocus, true);
  });

  it('dc-effects: Rebel Trooper (Elite) references get_into_position', () => {
    const eff = getDcEffects()?.['Rebel Trooper (Elite)'];
    assert.ok(eff, 'Rebel Trooper (Elite) missing');
    assert.ok(Array.isArray(eff.specialAbilityIds), 'specialAbilityIds missing');
    assert.ok(eff.specialAbilityIds.includes('get_into_position'));
  });

  it('getDcStats surfaces the special with cost=2', () => {
    const stats = getDcStats('Rebel Trooper (Elite)');
    assert.ok(Array.isArray(stats.specials));
    assert.ok(Array.isArray(stats.specialCosts));
    const idx = stats.specialIds.indexOf('get_into_position');
    assert.ok(idx >= 0, 'get_into_position not in derived specialIds');
    assert.equal(stats.specialCosts[idx], 2, 'specialCosts should be 2 for double-action');
  });
});
