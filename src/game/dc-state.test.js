import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDcInfo, getDcExhausted, setDcExhausted, getDcHealth, setDcHealth,
} from './dc-state.js';
import { dcMessageMeta, dcExhaustedState, dcHealthState } from '../game-state.js';

describe('dc-state accessors (Slice 1: Map-backed)', () => {
  // Capture pre-test Map state so tests don't leak side-effects into other
  // suites (game-state Maps are module-level singletons).
  const savedMeta = new Map();
  const savedExh = new Map();
  const savedHp = new Map();

  beforeEach(() => {
    savedMeta.clear(); savedExh.clear(); savedHp.clear();
    for (const [k, v] of dcMessageMeta) savedMeta.set(k, v);
    for (const [k, v] of dcExhaustedState) savedExh.set(k, v);
    for (const [k, v] of dcHealthState) savedHp.set(k, v);
    dcMessageMeta.clear(); dcExhaustedState.clear(); dcHealthState.clear();
  });

  after(() => {
    dcMessageMeta.clear(); dcExhaustedState.clear(); dcHealthState.clear();
    for (const [k, v] of savedMeta) dcMessageMeta.set(k, v);
    for (const [k, v] of savedExh) dcExhaustedState.set(k, v);
    for (const [k, v] of savedHp) dcHealthState.set(k, v);
  });

  describe('getDcInfo', () => {
    it('returns the meta object when msgId is known', () => {
      dcMessageMeta.set('msg1', { gameId: 'g1', playerNum: 1, dcName: 'Trooper', displayName: 'Trooper' });
      assert.deepEqual(getDcInfo({}, 'msg1'), { gameId: 'g1', playerNum: 1, dcName: 'Trooper', displayName: 'Trooper' });
    });

    it('returns null when msgId is unknown', () => {
      assert.equal(getDcInfo({}, 'unknown'), null);
    });
  });

  describe('getDcExhausted', () => {
    it('returns the stored boolean', () => {
      dcExhaustedState.set('msg1', true);
      assert.equal(getDcExhausted({}, 'msg1'), true);
    });

    it('returns false (not undefined) when msgId is unknown', () => {
      assert.equal(getDcExhausted({}, 'unknown'), false);
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

    it('returns [[null, null]] (not undefined) when msgId is unknown', () => {
      assert.deepEqual(getDcHealth({}, 'unknown'), [[null, null]]);
    });
  });

  describe('setDcHealth', () => {
    it('writes to the Map', () => {
      setDcHealth({}, 'msg1', [[2, 5]]);
      assert.deepEqual(dcHealthState.get('msg1'), [[2, 5]]);
    });
  });
});
