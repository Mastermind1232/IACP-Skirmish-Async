/**
 * Phase-D behavioral probe — CRR-ATK-004.
 *
 * CRR p.XX: "When a DC figure performs an attack using an alternate attack
 * pool, they may still trigger their own surge abilities unless the triggering
 * ability states otherwise."
 *
 * The existing invariant_pin probe checks source-text shape (surge set is
 * attacker-DC-derived; only blockSurgeAbilities fully opts out). This probe
 * exercises `getAttackerSurgeAbilities(combat)` as a pure function under the
 * three branches the rule cares about:
 *
 *   1. Baseline — attacker DC with surgeAbilities returns its list.
 *   2. Alternate pool — mutating attackInfo.dice (as the
 *      pendingOverrideAttackDice consumer does) does NOT strip the surge set,
 *      because surge derivation keys on combat.attackerDcName.
 *   3. Explicit opt-out — combat.blockSurgeAbilities=true returns [].
 *
 * A refactor that accidentally keys surges on dice pool or strips surges on
 * override would hard-fail (2) or (1) here instead of silently muting them
 * behind an alt-pool attack (e.g. Saber Strike, Bo-Rifle Staff Strike).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAttackerSurgeAbilities } from '../../../src/game/combat.js';
import { getDcEffects } from '../../../src/data-loader.js';

// Use a DC known to carry surgeAbilities in dc-effects.json.
// Flame Trooper surges: ["damage 2", "blast 1"].
const DC_NAME = '[Flame Trooper]';

describe('PROBE-ATK-004-BEHAVIOR: alt-pool surges follow attacker DC, not dice pool', () => {
  it('baseline — attacker DC surges are returned', () => {
    const expected = getDcEffects()[DC_NAME].surgeAbilities;
    assert.ok(Array.isArray(expected) && expected.length > 0,
      'test fixture assumption: DC must have non-empty surgeAbilities');

    const combat = { attackerDcName: DC_NAME };
    const surges = getAttackerSurgeAbilities(combat);
    assert.deepStrictEqual(surges, expected,
      'Baseline: getAttackerSurgeAbilities must return the attacker DC surge list.');
  });

  it('alt pool — mutating attackInfo.dice does not alter the surge set', () => {
    // Simulate what pendingOverrideAttackDice does: it rewrites attackInfo.dice
    // (and optionally type/pierce). It does NOT change attackerDcName. The
    // surge set must be unchanged from baseline.
    const expected = getDcEffects()[DC_NAME].surgeAbilities;
    const combat = {
      attackerDcName: DC_NAME,
      attackInfo: { dice: ['red', 'red'], type: 'melee', pierce: 0 },
    };
    const surgesBefore = getAttackerSurgeAbilities(combat);

    // Alt pool: swap the dice wholesale (as the override consumer does).
    combat.attackInfo.dice = ['blue', 'yellow'];
    combat.attackInfo.type = 'ranged';
    combat.attackInfo.pierce = 2;
    const surgesAfter = getAttackerSurgeAbilities(combat);

    assert.deepStrictEqual(surgesBefore, expected);
    assert.deepStrictEqual(surgesAfter, expected,
      'CRR-ATK-004: alternate-pool attack must still trigger the attacker DC surges.');
  });

  it('explicit opt-out — blockSurgeAbilities=true returns empty list', () => {
    const combat = { attackerDcName: DC_NAME, blockSurgeAbilities: true };
    const surges = getAttackerSurgeAbilities(combat);
    assert.deepStrictEqual(surges, [],
      'blockSurgeAbilities is the only full opt-out path (Tusken Cycler).');
  });

  it('explicit opt-out — blockSurgeAbilities=false keeps surges intact', () => {
    const combat = { attackerDcName: DC_NAME, blockSurgeAbilities: false };
    const expected = getDcEffects()[DC_NAME].surgeAbilities;
    const surges = getAttackerSurgeAbilities(combat);
    assert.deepStrictEqual(surges, expected,
      'Default path: blockSurgeAbilities=false leaves the surge set intact.');
  });
});
