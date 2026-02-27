import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterCondition, isConditionImmune, HARMFUL_CONDITIONS } from './conditions.js';

describe('HARMFUL_CONDITIONS', () => {
  it('contains Stun, Bleed, Weaken', () => {
    assert.deepStrictEqual(HARMFUL_CONDITIONS, ['Stun', 'Bleed', 'Weaken']);
  });
});

describe('filterCondition', () => {
  it('removes a condition from a figure', () => {
    const game = { figureConditions: { 'Trooper-0-0': ['Stun', 'Bleed'] } };
    filterCondition(game, 'Trooper-0-0', 'Stun');
    assert.deepStrictEqual(game.figureConditions['Trooper-0-0'], ['Bleed']);
  });

  it('deletes figureConditions key when empty', () => {
    const game = { figureConditions: { 'Trooper-0-0': ['Stun'] } };
    filterCondition(game, 'Trooper-0-0', 'Stun');
    assert.strictEqual(game.figureConditions['Trooper-0-0'], undefined);
  });

  it('no-ops when figureConditions is missing', () => {
    const game = {};
    assert.doesNotThrow(() => filterCondition(game, 'Trooper-0-0', 'Stun'));
  });

  it('no-ops when figure has no conditions', () => {
    const game = { figureConditions: {} };
    assert.doesNotThrow(() => filterCondition(game, 'Trooper-0-0', 'Stun'));
  });

  it('preserves other conditions', () => {
    const game = { figureConditions: { 'X-0-0': ['Focus', 'Bleed', 'Hide'] } };
    filterCondition(game, 'X-0-0', 'Bleed');
    assert.deepStrictEqual(game.figureConditions['X-0-0'], ['Focus', 'Hide']);
  });
});

describe('isConditionImmune', () => {
  it('returns true for Onar Koma', () => {
    assert.ok(isConditionImmune({}, 'Onar Koma-0-0'));
  });

  it('returns true for Snowtrooper (Elite)', () => {
    assert.ok(isConditionImmune({}, 'Snowtrooper (Elite)-0-0'));
  });

  it('returns false for generic figure', () => {
    assert.ok(!isConditionImmune({}, 'Stormtrooper-0-0'));
  });
});
