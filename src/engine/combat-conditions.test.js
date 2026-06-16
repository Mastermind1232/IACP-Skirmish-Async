import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCondition, attackerDcName } from './combat-conditions.js';

describe('combat-conditions: the condition-predicate layer', () => {
  it('attacker_is_self matches the attacking figure DC, variant-insensitive', () => {
    const c = makeCondition({ type: 'attacker_is_self', card: 'Cara Dune' });
    assert.ok(c({}, { attackerDcName: 'Cara Dune' }), 'exact');
    assert.ok(c({}, { attackerDcName: 'Cara Dune [Elite]' }), 'variant suffix ignored');
    assert.ok(!c({}, { attackerDcName: 'Greedo' }), 'different attacker → false');
  });

  it('spent_power_token reads combat.attackerSpentPowerToken', () => {
    const c = makeCondition({ type: 'spent_power_token' });
    assert.ok(c({}, { attackerSpentPowerToken: true }));
    assert.ok(!c({}, {}));
  });

  it('unknown / empty type defaults to always-true (never silently drops an ability)', () => {
    assert.ok(makeCondition()({}, {}));
    assert.ok(makeCondition({ type: 'not_a_real_type' })({}, {}));
    assert.ok(makeCondition({ type: 'always' })({}, {}));
  });

  it('attackerDcName falls back to the figure key', () => {
    assert.equal(attackerDcName({ attackerFigureKey: 'Cara Dune-1-0' }), 'cara dune');
  });
});
