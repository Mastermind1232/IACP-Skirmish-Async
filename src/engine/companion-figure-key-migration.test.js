/**
 * Migration: stale `${dcName}-0-0` companion figure keys → `${dcName}-1-0`.
 *
 * Companion deploy paths wrote dgIndex 0 while every action handler builds the
 * key with dgIndex 1, so companions reported "This figure has no position yet
 * (deploy first)" and could not move, attack, or interact. Deploy sites were
 * fixed in ac266382; this migration repairs saves written before that, which is
 * what live game 00001 was still carrying ("The Child-0-0": "t13").
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { migrateCompanionFigureKeys } from '../game-state.js';

describe('migrateCompanionFigureKeys', () => {
  test('renames a stale companion position key to dgIndex 1', () => {
    // Shape taken verbatim from live game 00001 before the fix.
    const g = {
      figurePositions: {
        1: { 'Director Krennic-1-0': 't9' },
        2: { 'The Child-0-0': 't13', 'Baze Malbus-1-0': 'u13' },
      },
    };
    migrateCompanionFigureKeys(g);
    assert.equal(g.figurePositions[2]['The Child-1-0'], 't13');
    assert.ok(!('The Child-0-0' in g.figurePositions[2]), 'stale key must be gone');
    // Untouched neighbours.
    assert.equal(g.figurePositions[2]['Baze Malbus-1-0'], 'u13');
    assert.equal(g.figurePositions[1]['Director Krennic-1-0'], 't9');
  });

  test('migrates the flat figureKey-keyed containers too', () => {
    const g = {
      figurePositions: { 1: {}, 2: { 'The Child-0-0': 't13' } },
      figureConditions: { 'The Child-0-0': ['Focus'] },
      figurePowerTokens: { 'The Child-0-0': ['Block'] },
      companionHostMap: { 'The Child-0-0': { hostFigureKey: 'Baze Malbus-1-0', playerNum: 2 } },
    };
    migrateCompanionFigureKeys(g);
    assert.deepEqual(g.figureConditions['The Child-1-0'], ['Focus']);
    assert.deepEqual(g.figurePowerTokens['The Child-1-0'], ['Block']);
    assert.equal(g.companionHostMap['The Child-1-0'].hostFigureKey, 'Baze Malbus-1-0');
    for (const k of ['figureConditions', 'figurePowerTokens', 'companionHostMap']) {
      assert.ok(!('The Child-0-0' in g[k]), `${k} must not keep the stale key`);
    }
  });

  test('leaves valid multi-group keys alone', () => {
    const g = {
      figurePositions: {
        1: { 'Snowtrooper (Elite)-1-2': 'u12', 'Snowtrooper (Elite)-2-0': 'r10' },
        2: {},
      },
    };
    const before = JSON.parse(JSON.stringify(g));
    migrateCompanionFigureKeys(g);
    assert.deepEqual(g, before, 'no dgIndex>=1 key may be rewritten');
  });

  test('is idempotent — a second pass changes nothing', () => {
    const g = { figurePositions: { 1: {}, 2: { 'The Child-0-0': 't13' } } };
    migrateCompanionFigureKeys(g);
    const afterFirst = JSON.parse(JSON.stringify(g));
    migrateCompanionFigureKeys(g);
    assert.deepEqual(g, afterFirst);
  });

  test('never clobbers a correct key that already exists', () => {
    const g = {
      figurePositions: { 1: {}, 2: { 'The Child-0-0': 'stale', 'The Child-1-0': 'live' } },
    };
    migrateCompanionFigureKeys(g);
    assert.equal(g.figurePositions[2]['The Child-1-0'], 'live', 'real entry wins');
    assert.ok(!('The Child-0-0' in g.figurePositions[2]), 'stale key still dropped');
  });

  test('tolerates missing and malformed containers', () => {
    assert.doesNotThrow(() => migrateCompanionFigureKeys({}));
    assert.doesNotThrow(() => migrateCompanionFigureKeys({ figurePositions: null }));
    assert.doesNotThrow(() => migrateCompanionFigureKeys({ figureConditions: 'nope' }));
  });
});
