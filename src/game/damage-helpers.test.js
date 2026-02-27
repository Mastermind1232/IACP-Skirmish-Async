import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reduceHp, healHp, healHpDistributed } from './damage-helpers.js';

function makeHealthMap(entries) {
  return new Map(entries);
}

function makeGame(msgId, playerNum, healthState) {
  const dcIds = [msgId];
  const dcList = [{ dcName: 'Trooper', healthState: [...healthState] }];
  return playerNum === 1
    ? { p1DcMessageIds: dcIds, p1DcList: dcList, p2DcMessageIds: [], p2DcList: [] }
    : { p1DcMessageIds: [], p1DcList: [], p2DcMessageIds: dcIds, p2DcList: dcList };
}

describe('reduceHp', () => {
  it('reduces HP and syncs dcList', () => {
    const hs = makeHealthMap([['msg1', [[5, 8]]]]);
    const game = makeGame('msg1', 1, [[5, 8]]);
    const result = reduceHp(hs, game, 'msg1', 0, 3, 1);
    assert.strictEqual(result.newHp, 2);
    assert.strictEqual(result.maxHp, 8);
    assert.strictEqual(result.prevHp, 5);
    assert.strictEqual(result.wasDefeated, false);
    assert.deepStrictEqual(hs.get('msg1'), [[2, 8]]);
    assert.deepStrictEqual(game.p1DcList[0].healthState, [[2, 8]]);
  });

  it('clamps HP to 0', () => {
    const hs = makeHealthMap([['msg1', [[2, 8]]]]);
    const game = makeGame('msg1', 1, [[2, 8]]);
    const result = reduceHp(hs, game, 'msg1', 0, 10, 1);
    assert.strictEqual(result.newHp, 0);
    assert.strictEqual(result.wasDefeated, true);
  });

  it('reports wasDefeated when HP reaches 0', () => {
    const hs = makeHealthMap([['msg1', [[3, 8]]]]);
    const game = makeGame('msg1', 1, [[3, 8]]);
    const result = reduceHp(hs, game, 'msg1', 0, 3, 1);
    assert.strictEqual(result.wasDefeated, true);
    assert.strictEqual(result.newHp, 0);
  });

  it('handles cur=null (uses max as cur)', () => {
    const hs = makeHealthMap([['msg1', [[null, 6]]]]);
    const game = makeGame('msg1', 1, [[null, 6]]);
    const result = reduceHp(hs, game, 'msg1', 0, 2, 1);
    assert.strictEqual(result.prevHp, 6);
    assert.strictEqual(result.newHp, 4);
  });

  it('handles multi-figure DC (figureIndex 1)', () => {
    const hs = makeHealthMap([['msg1', [[8, 8], [5, 8]]]]);
    const game = makeGame('msg1', 2, [[8, 8], [5, 8]]);
    const result = reduceHp(hs, game, 'msg1', 1, 2, 2);
    assert.strictEqual(result.newHp, 3);
    assert.deepStrictEqual(hs.get('msg1'), [[8, 8], [3, 8]]);
    assert.deepStrictEqual(game.p2DcList[0].healthState, [[8, 8], [3, 8]]);
  });

  it('returns safe defaults for missing healthState', () => {
    const hs = new Map();
    const game = makeGame('msg1', 1, [[5, 8]]);
    const result = reduceHp(hs, game, 'msg1', 0, 3, 1);
    assert.strictEqual(result.newHp, 0);
    assert.strictEqual(result.wasDefeated, false);
  });

  it('handles 0 damage', () => {
    const hs = makeHealthMap([['msg1', [[5, 8]]]]);
    const game = makeGame('msg1', 1, [[5, 8]]);
    const result = reduceHp(hs, game, 'msg1', 0, 0, 1);
    assert.strictEqual(result.newHp, 5);
    assert.strictEqual(result.wasDefeated, false);
  });
});

describe('healHp', () => {
  it('heals HP and syncs dcList', () => {
    const hs = makeHealthMap([['msg1', [[3, 8]]]]);
    const game = makeGame('msg1', 1, [[3, 8]]);
    const result = healHp(hs, game, 'msg1', 0, 4, 1);
    assert.strictEqual(result.newHp, 7);
    assert.strictEqual(result.healed, 4);
    assert.deepStrictEqual(hs.get('msg1'), [[7, 8]]);
    assert.deepStrictEqual(game.p1DcList[0].healthState, [[7, 8]]);
  });

  it('clamps HP to max', () => {
    const hs = makeHealthMap([['msg1', [[6, 8]]]]);
    const game = makeGame('msg1', 1, [[6, 8]]);
    const result = healHp(hs, game, 'msg1', 0, 10, 1);
    assert.strictEqual(result.newHp, 8);
    assert.strictEqual(result.healed, 2);
  });

  it('heals 0 when already at max', () => {
    const hs = makeHealthMap([['msg1', [[8, 8]]]]);
    const game = makeGame('msg1', 1, [[8, 8]]);
    const result = healHp(hs, game, 'msg1', 0, 5, 1);
    assert.strictEqual(result.healed, 0);
    assert.strictEqual(result.newHp, 8);
  });

  it('handles cur=null (uses max as cur)', () => {
    const hs = makeHealthMap([['msg1', [[null, 6]]]]);
    const game = makeGame('msg1', 1, [[null, 6]]);
    const result = healHp(hs, game, 'msg1', 0, 2, 1);
    assert.strictEqual(result.healed, 0);
    assert.strictEqual(result.newHp, 6);
  });

  it('returns safe defaults for missing healthState', () => {
    const hs = new Map();
    const game = makeGame('msg1', 1, [[5, 8]]);
    const result = healHp(hs, game, 'msg1', 0, 3, 1);
    assert.strictEqual(result.healed, 0);
  });
});

describe('healHpDistributed', () => {
  it('distributes healing across multiple figures', () => {
    const hs = makeHealthMap([['msg1', [[2, 5], [1, 5]]]]);
    const game = makeGame('msg1', 1, [[2, 5], [1, 5]]);
    const result = healHpDistributed(hs, game, 'msg1', 10, 1);
    assert.strictEqual(result.totalRecovered, 7);
    assert.strictEqual(result.perFigure.length, 2);
    assert.strictEqual(result.perFigure[0].healed, 3);
    assert.strictEqual(result.perFigure[0].newHp, 5);
    assert.strictEqual(result.perFigure[1].healed, 4);
    assert.strictEqual(result.perFigure[1].newHp, 5);
    assert.deepStrictEqual(hs.get('msg1'), [[5, 5], [5, 5]]);
    assert.deepStrictEqual(game.p1DcList[0].healthState, [[5, 5], [5, 5]]);
  });

  it('stops healing when budget exhausted', () => {
    const hs = makeHealthMap([['msg1', [[2, 5], [1, 5]]]]);
    const game = makeGame('msg1', 1, [[2, 5], [1, 5]]);
    const result = healHpDistributed(hs, game, 'msg1', 4, 1);
    assert.strictEqual(result.totalRecovered, 4);
    assert.strictEqual(result.perFigure[0].healed, 3);
    assert.strictEqual(result.perFigure[1].healed, 1);
    assert.deepStrictEqual(hs.get('msg1'), [[5, 5], [2, 5]]);
  });

  it('skips undamaged figures', () => {
    const hs = makeHealthMap([['msg1', [[5, 5], [2, 5]]]]);
    const game = makeGame('msg1', 1, [[5, 5], [2, 5]]);
    const result = healHpDistributed(hs, game, 'msg1', 10, 1);
    assert.strictEqual(result.totalRecovered, 3);
    assert.strictEqual(result.perFigure.length, 1);
    assert.strictEqual(result.perFigure[0].index, 1);
  });

  it('returns 0 for missing healthState', () => {
    const hs = new Map();
    const game = makeGame('msg1', 1, [[5, 8]]);
    const result = healHpDistributed(hs, game, 'msg1', 5, 1);
    assert.strictEqual(result.totalRecovered, 0);
    assert.deepStrictEqual(result.perFigure, []);
  });

  it('handles all figures at full HP', () => {
    const hs = makeHealthMap([['msg1', [[5, 5], [5, 5]]]]);
    const game = makeGame('msg1', 1, [[5, 5], [5, 5]]);
    const result = healHpDistributed(hs, game, 'msg1', 5, 1);
    assert.strictEqual(result.totalRecovered, 0);
  });
});
