import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDcInfo, getDcExhausted, setDcExhausted, getDcHealth, setDcHealth,
} from './dc-state.js';
import { dcExhaustedState, dcHealthState, getGamesMap } from '../game-state.js';

describe('dc-state accessors (post Slice 4a: dcMessageMeta derived)', () => {
  // Capture pre-test Map state so tests don't leak side-effects into other
  // suites (the still-authoritative Maps + games are module-level singletons).
  const savedExh = new Map();
  const savedHp = new Map();
  const savedGames = new Map();
  const games = getGamesMap();

  beforeEach(() => {
    savedExh.clear(); savedHp.clear(); savedGames.clear();
    for (const [k, v] of dcExhaustedState) savedExh.set(k, v);
    for (const [k, v] of dcHealthState) savedHp.set(k, v);
    for (const [k, v] of games) savedGames.set(k, v);
    dcExhaustedState.clear(); dcHealthState.clear();
    games.clear();
  });

  after(() => {
    dcExhaustedState.clear(); dcHealthState.clear();
    games.clear();
    for (const [k, v] of savedExh) dcExhaustedState.set(k, v);
    for (const [k, v] of savedHp) dcHealthState.set(k, v);
    for (const [k, v] of savedGames) games.set(k, v);
  });

  describe('getDcInfo (derived from game.dcList + dcMessageIds)', () => {
    it('returns the meta object when the msgId is canonically tracked on a game', () => {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'Trooper', displayName: 'Trooper [Group 1]' }],
        p2DcMessageIds: [],
        p2DcList: [],
      });
      assert.deepEqual(getDcInfo({}, 'msg1'), {
        gameId: 'g1', playerNum: 1, dcName: 'Trooper', displayName: 'Trooper [Group 1]',
      });
    });

    it('returns undefined when msgId is not in any game', () => {
      assert.equal(getDcInfo({}, 'unknown'), undefined);
    });

    it('falls back to dcName when displayName is missing on the dcList entry', () => {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'Vader' }],
        p2DcMessageIds: [], p2DcList: [],
      });
      assert.equal(getDcInfo({}, 'msg1').displayName, 'Vader');
    });

    it('finds player 2 entries too', () => {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: [], p1DcList: [],
        p2DcMessageIds: ['p2m'],
        p2DcList: [{ dcName: 'Rebel', displayName: 'Rebel [Group 1]' }],
      });
      assert.equal(getDcInfo({}, 'p2m').playerNum, 2);
    });
  });

  describe('getDcExhausted', () => {
    it('returns the stored boolean', () => {
      dcExhaustedState.set('msg1', true);
      assert.equal(getDcExhausted({}, 'msg1'), true);
    });

    it('returns undefined when msgId is unknown (matches Map.get)', () => {
      assert.equal(getDcExhausted({}, 'unknown'), undefined);
    });

    it('returns false when explicitly set to false', () => {
      dcExhaustedState.set('msg1', false);
      assert.equal(getDcExhausted({}, 'msg1'), false);
    });
  });

  describe('setDcExhausted', () => {
    it('writes to the Map', () => {
      setDcExhausted({}, 'msg1', true);
      assert.equal(dcExhaustedState.get('msg1'), true);
    });

    it('overwrites existing values', () => {
      dcExhaustedState.set('msg1', true);
      setDcExhausted({}, 'msg1', false);
      assert.equal(dcExhaustedState.get('msg1'), false);
    });
  });

  describe('getDcHealth', () => {
    it('returns the stored array', () => {
      dcHealthState.set('msg1', [[3, 5], [4, 5]]);
      assert.deepEqual(getDcHealth({}, 'msg1'), [[3, 5], [4, 5]]);
    });

    it('returns undefined when msgId is unknown (matches Map.get)', () => {
      assert.equal(getDcHealth({}, 'unknown'), undefined);
    });
  });

  describe('setDcHealth', () => {
    it('writes to the Map', () => {
      setDcHealth({}, 'msg1', [[2, 5]]);
      assert.deepEqual(dcHealthState.get('msg1'), [[2, 5]]);
    });
  });
});
