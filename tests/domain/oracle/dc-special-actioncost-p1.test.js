/**
 * ORACLE — Pattern P1 (audit 2026-06-26): DC special with no actionCost
 * defaults to 1 action.
 *
 * getDcStats (src/data-loader.js:635-644) only builds `_specialActionCosts`
 * when an explicit numeric `actionCost` (or an MP cost) is present on the
 * ability-library entry; otherwise specialCosts stays [] and both the renderer
 * (components.js:1210) and dispatcher (dc-play-area.js:2120) fall back to
 * `?? 1`, wrongly charging a full action for FREE abilities (and charging 1 for
 * abilities that should cost 2).
 *
 * These probes pin the data-driven cost surfaced via getDcStats for the four P1
 * cards after adding the explicit `actionCost` to data/ability-library.json.
 *
 * IMPORTANT alignment note: getDcStats only runs the cost-builder when the
 * card's dc-effects entry has NO explicit `specials` array (it gates on
 * `!specials && eff.specialAbilityIds?.length`). The cost arrays are derived
 * from the SAME `filtered` list that produces `specialIds`, so index alignment
 * is structural. Cara/Diala/Maul each reduce to a single surviving special
 * after passive filtering, so the new cost lands at the only index.
 *
 * Jabba the Hutt is the documented exception: its dc-effects entry carries an
 * explicit `specials` array, so getDcStats SKIPS the cost-builder entirely and
 * the library `actionCost:2` is inert through this path. That case is asserted
 * as a known gap (needs a code/dc-effects change, not just library data).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDcStats } from '../../../src/data-loader.js';

describe('ORACLE-P1-DC-ACTIONCOST: free/double specials carry explicit cost', () => {
  it('Cara Dune / Smash is free (cost 0) at its (only) special index', () => {
    const s = getDcStats('Cara Dune');
    assert.deepEqual(s.specialIds, ['smash']);
    assert.deepEqual(s.specialCosts, [0], 'Smash must cost 0 actions (free once/activation)');
  });

  it('Diala Passil / Force Throw is free (cost 0; only 1 Strain)', () => {
    const s = getDcStats('Diala Passil');
    assert.deepEqual(s.specialIds, ['force_throw']);
    assert.deepEqual(s.specialCosts, [0], 'Force Throw must cost 0 actions');
  });

  it('Maul / Dual-Bladed Fury is free on-declare (cost 0)', () => {
    const s = getDcStats('Maul');
    assert.deepEqual(s.specialIds, ['dual_bladed_fury']);
    assert.deepEqual(s.specialCosts, [0], 'Dual-Bladed Fury must cost 0 actions');
  });

  it('Jabba / Order Hit surfaces as a 2-action (double action) special', () => {
    // Jabba's dc-effects entry has an explicit `specials` array, so the
    // getDcStats cost-builder is skipped and the library actionCost:2 does NOT
    // flow through. Fixed by adding an explicit `specialCosts:[1,1,1,2]` to
    // Jabba's dc-effects entry (getDcStats prefers eff.specialCosts), aligned to
    // [Bully, Incentivize, Scheme, Order Hit]. The actual charge reads
    // resolveResult.doubleAction (abilities.js order_hit branch → entry.actionCost===2).
    const s = getDcStats('Jabba the Hutt');
    assert.ok(s.specials.includes('Order Hit'), 'Order Hit special is present');
    const orderHitIdx = s.specials.indexOf('Order Hit');
    assert.equal(s.specialCosts[orderHitIdx], 2, 'Order Hit costs 2 actions');
    assert.deepEqual(s.specialCosts, [1, 1, 1, 2], 'Bully/Incentivize/Scheme cost 1, Order Hit costs 2');
  });
});
