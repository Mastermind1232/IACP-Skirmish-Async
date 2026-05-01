/**
 * Invariant tests: the dcExhaustedState Map is a derived cache.
 * Canonical source = activatedDcIndices ∪ abilityExhaustedMsgIds.
 *
 * If repopulateDcMapsForGame ever stops matching the derivation, the
 * migration to a single source of truth (see consolidation plan) breaks.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  dcMessageMeta, dcExhaustedState, dcHealthState,
  repopulateDcMapsForGame, getGamesMap,
} from '../game-state.js';

describe('DC state invariant: Maps are derived from canonical game state', () => {
  const savedMeta = new Map();
  const savedExh = new Map();
  const savedHp = new Map();
  const savedGames = new Map();
  const games = getGamesMap();

  beforeEach(() => {
    savedMeta.clear(); savedExh.clear(); savedHp.clear(); savedGames.clear();
    for (const [k, v] of dcMessageMeta) savedMeta.set(k, v);
    for (const [k, v] of dcExhaustedState) savedExh.set(k, v);
    for (const [k, v] of dcHealthState) savedHp.set(k, v);
    for (const [k, v] of games) savedGames.set(k, v);
    dcMessageMeta.clear(); dcExhaustedState.clear(); dcHealthState.clear();
    games.clear();
  });

  after(() => {
    dcMessageMeta.clear(); dcExhaustedState.clear(); dcHealthState.clear();
    games.clear();
    for (const [k, v] of savedMeta) dcMessageMeta.set(k, v);
    for (const [k, v] of savedExh) dcExhaustedState.set(k, v);
    for (const [k, v] of savedHp) dcHealthState.set(k, v);
    for (const [k, v] of savedGames) games.set(k, v);
  });

  function makeGame(id) {
    const game = {
      gameId: id,
      p1DcList: [
        { dcName: 'Trooper', displayName: 'Trooper [Group 1]', healthState: [[5, 5]] },
        { dcName: 'Vader', displayName: 'Vader', healthState: [[12, 12]] },
      ],
      p2DcList: [
        { dcName: 'Rebel', displayName: 'Rebel [Group 1]', healthState: [[3, 3]] },
      ],
      p1DcMessageIds: ['p1m1', 'p1m2'],
      p2DcMessageIds: ['p2m1'],
      p1ActivatedDcIndices: [],
      p2ActivatedDcIndices: [],
      abilityExhaustedMsgIds: [],
    };
    games.set(id, game);
    return game;
  }

  it('all DCs start exhausted=false when no activations and no ability-exhaust', () => {
    makeGame('g1');
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), false);
    assert.equal(dcExhaustedState.get('p1m2'), false);
    assert.equal(dcExhaustedState.get('p2m1'), false);
  });

  it('activatedDcIndices marks the DC at that index as exhausted', () => {
    const g = makeGame('g1');
    g.p1ActivatedDcIndices = [0];
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), true);
    assert.equal(dcExhaustedState.get('p1m2'), false);
  });

  it('abilityExhaustedMsgIds marks the listed msgId as exhausted', () => {
    const g = makeGame('g1');
    g.abilityExhaustedMsgIds = ['p1m2'];
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), false);
    assert.equal(dcExhaustedState.get('p1m2'), true);
  });

  it('union: activated OR abilityExhausted both produce true', () => {
    const g = makeGame('g1');
    g.p1ActivatedDcIndices = [0];
    g.abilityExhaustedMsgIds = ['p1m2'];
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), true);
    assert.equal(dcExhaustedState.get('p1m2'), true);
  });

  it('clearing activatedDcIndices and abilityExhaustedMsgIds (round reset) clears the Map on repopulate', () => {
    const g = makeGame('g1');
    g.p1ActivatedDcIndices = [0, 1];
    g.abilityExhaustedMsgIds = ['p1m1', 'p2m1'];
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), true);
    assert.equal(dcExhaustedState.get('p1m2'), true);
    assert.equal(dcExhaustedState.get('p2m1'), true);
    // simulate round reset
    g.p1ActivatedDcIndices = [];
    g.p2ActivatedDcIndices = [];
    g.abilityExhaustedMsgIds = [];
    repopulateDcMapsForGame('g1');
    assert.equal(dcExhaustedState.get('p1m1'), false);
    assert.equal(dcExhaustedState.get('p1m2'), false);
    assert.equal(dcExhaustedState.get('p2m1'), false);
  });

  it('healthState mirror: dcHealthState always equals dcList[i].healthState after repopulate', () => {
    const g = makeGame('g1');
    g.p1DcList[0].healthState = [[2, 5]];
    g.p1DcList[1].healthState = [[10, 12]];
    g.p2DcList[0].healthState = [[0, 3]];
    repopulateDcMapsForGame('g1');
    assert.deepEqual(dcHealthState.get('p1m1'), [[2, 5]]);
    assert.deepEqual(dcHealthState.get('p1m2'), [[10, 12]]);
    assert.deepEqual(dcHealthState.get('p2m1'), [[0, 3]]);
  });

  it('meta mirror: dcMessageMeta entries match dcList shape', () => {
    makeGame('g1');
    repopulateDcMapsForGame('g1');
    assert.deepEqual(dcMessageMeta.get('p1m1'), {
      gameId: 'g1', playerNum: 1, dcName: 'Trooper', displayName: 'Trooper [Group 1]',
    });
    assert.deepEqual(dcMessageMeta.get('p2m1'), {
      gameId: 'g1', playerNum: 2, dcName: 'Rebel', displayName: 'Rebel [Group 1]',
    });
  });

  it('repopulate is idempotent: calling twice produces the same Map state', () => {
    const g = makeGame('g1');
    g.p1ActivatedDcIndices = [0];
    g.abilityExhaustedMsgIds = ['p2m1'];
    repopulateDcMapsForGame('g1');
    const snap1 = new Map(dcExhaustedState);
    repopulateDcMapsForGame('g1');
    assert.deepEqual([...dcExhaustedState], [...snap1]);
  });

  it('repopulate scoped to one game does not affect other games (distinct msgIds)', () => {
    const g1 = makeGame('g1');
    // Override g2 with distinct msgIds so we can test scope cleanly
    const g2 = {
      gameId: 'g2',
      p1DcList: [{ dcName: 'X', displayName: 'X', healthState: [[1, 1]] }],
      p2DcList: [{ dcName: 'Y', displayName: 'Y', healthState: [[1, 1]] }],
      p1DcMessageIds: ['g2p1m1'],
      p2DcMessageIds: ['g2p2m1'],
      p1ActivatedDcIndices: [],
      p2ActivatedDcIndices: [],
      abilityExhaustedMsgIds: [],
    };
    games.set('g2', g2);
    g1.p1ActivatedDcIndices = [0];
    g2.p1ActivatedDcIndices = [0];
    repopulateDcMapsForGame('g1');
    // g2's Map entries don't exist yet (haven't repopulated)
    assert.equal(dcExhaustedState.get('g2p1m1'), undefined);
    repopulateDcMapsForGame('g2');
    assert.equal(dcExhaustedState.get('p1m1'), true);    // g1
    assert.equal(dcExhaustedState.get('g2p1m1'), true);  // g2
  });
});
