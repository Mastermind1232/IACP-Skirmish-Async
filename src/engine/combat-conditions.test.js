import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeCondition, attackerDcName, conditionForRow } from './combat-conditions.js';

describe('conditionForRow: self-then-others derivation', () => {
  it('affects_self=TRUE, affects_others=None → attacker_is_self', () => {
    const cond = conditionForRow({ card: 'Cara Dune', affects_self: 'TRUE', affects_others: 'None' });
    assert.ok(cond({}, { attackerDcName: 'Cara Dune' }), 'owner attacking → usable');
    assert.ok(!cond({}, { attackerDcName: 'Greedo' }), 'different attacker → not usable');
  });

  it('affects_self=FALSE, affects_others=None → not usable (no self, no others grant)', () => {
    const cond = conditionForRow({ card: 'X', affects_self: 'FALSE', affects_others: 'None' });
    assert.ok(!cond({}, { attackerDcName: 'X' }));
  });

  it('affects_others="figures in this group" → in_group_of_source (attacker in the owner group)', () => {
    const cond = conditionForRow({ card: 'Targeting Computer', affects_self: 'FALSE', affects_others: 'figures in this group' });
    assert.ok(cond({}, { attackerDcName: 'Targeting Computer' }), 'attacker in the owner group → usable');
    assert.ok(!cond({}, { attackerDcName: 'Other' }));
  });

  it('ANDs the conditional-column guard (spend-token gate)', () => {
    const cond = conditionForRow({ card: 'Cara Dune', affects_self: 'TRUE', affects_others: 'None', conditional: 'after you spend a power token' });
    assert.ok(!cond({}, { attackerDcName: 'Cara Dune' }), 'self holds but no token spent → not usable');
    assert.ok(cond({}, { attackerDcName: 'Cara Dune', attackerSpentPowerToken: true }), 'token spent → usable');
  });
});

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
