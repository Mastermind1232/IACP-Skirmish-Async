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

  describe('getDcExhausted (derived from activatedDcIndices + abilityExhaustedMsgIds)', () => {
    function seed() {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'X', displayName: 'X' }],
        p2DcMessageIds: [], p2DcList: [],
        p1ActivatedDcIndices: [],
        p2ActivatedDcIndices: [],
        abilityExhaustedMsgIds: [],
      });
    }

    it('returns true when DC is in activatedDcIndices', () => {
      seed();
      games.get('g1').p1ActivatedDcIndices = [0];
      assert.equal(getDcExhausted({}, 'msg1'), true);
    });

    it('returns true when msgId is in abilityExhaustedMsgIds', () => {
      seed();
      games.get('g1').abilityExhaustedMsgIds = ['msg1'];
      assert.equal(getDcExhausted({}, 'msg1'), true);
    });

    it('returns false when neither flag is set', () => {
      seed();
      assert.equal(getDcExhausted({}, 'msg1'), false);
    });

    it('returns undefined when msgId is unknown to game state', () => {
      assert.equal(getDcExhausted({}, 'unknown'), undefined);
    });
  });

  describe('setDcExhausted (write-through to canonical state)', () => {
    function seed() {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'X', displayName: 'X' }],
        p2DcMessageIds: [], p2DcList: [],
        p1ActivatedDcIndices: [],
        p2ActivatedDcIndices: [],
        abilityExhaustedMsgIds: [],
      });
    }

    it('setting true adds to abilityExhaustedMsgIds', () => {
      seed();
      setDcExhausted({}, 'msg1', true);
      assert.deepEqual(games.get('g1').abilityExhaustedMsgIds, ['msg1']);
      assert.equal(getDcExhausted({}, 'msg1'), true);
    });

    it('setting true is idempotent (no duplicates)', () => {
      seed();
      setDcExhausted({}, 'msg1', true);
      setDcExhausted({}, 'msg1', true);
      assert.deepEqual(games.get('g1').abilityExhaustedMsgIds, ['msg1']);
    });

    it('setting false removes from abilityExhaustedMsgIds AND activatedDcIndices (closes latent gap)', () => {
      seed();
      const g = games.get('g1');
      g.abilityExhaustedMsgIds = ['msg1'];
      g.p1ActivatedDcIndices = [0];
      setDcExhausted({}, 'msg1', false);
      assert.deepEqual(g.abilityExhaustedMsgIds, []);
      assert.deepEqual(g.p1ActivatedDcIndices, []);
      assert.equal(getDcExhausted({}, 'msg1'), false);
    });

    it('silently drops .set for unknown msgId (no game state to update)', () => {
      seed();
      setDcExhausted({}, 'unknown', true);
      assert.deepEqual(games.get('g1').abilityExhaustedMsgIds, []);
    });
  });

  describe('getDcHealth (derived from game.dcList[i].healthState)', () => {
    function seed() {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'X', displayName: 'X', healthState: [[3, 5], [4, 5]] }],
        p2DcMessageIds: [], p2DcList: [],
      });
    }

    it('returns the dcList entry healthState directly (live reference, not copy)', () => {
      seed();
      const result = getDcHealth({}, 'msg1');
      assert.deepEqual(result, [[3, 5], [4, 5]]);
      // Mutating the returned array should mutate canonical state — same
      // contract as the Map-backed behavior.
      result[0][0] = 1;
      assert.equal(games.get('g1').p1DcList[0].healthState[0][0], 1);
    });

    it('returns undefined when msgId is unknown', () => {
      assert.equal(getDcHealth({}, 'unknown'), undefined);
    });
  });

  describe('setDcHealth (write-through to dcList[i].healthState)', () => {
    function seed() {
      games.set('g1', {
        gameId: 'g1',
        p1DcMessageIds: ['msg1'],
        p1DcList: [{ dcName: 'X', displayName: 'X', healthState: [[5, 5]] }],
        p2DcMessageIds: [], p2DcList: [],
      });
    }

    it('writes through to dcList', () => {
      seed();
      setDcHealth({}, 'msg1', [[2, 5]]);
      assert.deepEqual(games.get('g1').p1DcList[0].healthState, [[2, 5]]);
      assert.deepEqual(getDcHealth({}, 'msg1'), [[2, 5]]);
    });

    it('silently drops .set for unknown msgId', () => {
      seed();
      setDcHealth({}, 'unknown', [[9, 9]]);
      assert.deepEqual(games.get('g1').p1DcList[0].healthState, [[5, 5]]);
    });
  });
});
