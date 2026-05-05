/**
 * Companion side-channel: derived views (dcMessageMeta, dcExhaustedState,
 * dcHealthState) must resolve companion msgIds, not silently return
 * undefined.
 *
 * Audit 2026-05-05: companions (The Child via Clan of Two, Junk Droid
 * via R2-D2, etc.) live in `p{n}DcCompanionMessageIds` (a parallel
 * array). The Derived views previously only resolved msgIds in
 * `p{n}DcMessageIds`, so:
 *   - dcMessageMeta.get(companionMsgId) → undefined
 *     → standard handler entry pattern `if (!meta) return;` silently
 *       bailed when a button on a companion's posted card was clicked
 *       (e.g. The Child's Force Heal action).
 *   - dcHealthState.get(companionMsgId) → undefined
 *     → reduceHp returned 0/0/0 with wasDefeated:false, so attacks
 *       on companions silently dealt no damage. Companions were
 *       effectively immortal.
 *   - dcExhaustedState.get(companionMsgId) → undefined
 *     → unclear semantics for callers checking exhausted state.
 *
 * Fix: derived views fall back to companion arrays. Meta resolves to a
 * companion-flavored entry with `isCompanion: true`. Health reads/writes
 * `game.companionHealthState[msgId]` (canonical storage; registered in
 * CHECKPOINT MSGID_FLAGS for cross-lobby remap). Exhausted always
 * returns false for companions (they don't activate independently).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dcMessageMeta, dcExhaustedState, dcHealthState, getGame, setGame } from '../../src/game-state.js';

const GAMEID = 'companion-test-99999';

function setupCompanionGame() {
  // Minimal game with Baze + Clan of Two attached, The Child as companion.
  // dcList[2] = Baze, p2DcMessageIds[2] = host msgId, p2DcCompanionMessageIds[2] = companion msgId.
  const game = {
    gameId: GAMEID,
    p1DcList: [],
    p2DcList: [
      { dcName: 'AT-DP', displayName: 'AT-DP', healthState: [[16, 16]] },
      { dcName: 'Leia Organa', displayName: 'Leia Organa', healthState: [[11, 11]] },
      { dcName: 'Baze Malbus', displayName: 'Baze Malbus', healthState: [[11, 11]] },
    ],
    p1DcMessageIds: [],
    p2DcMessageIds: ['HOST_AT-DP', 'HOST_LEIA', 'HOST_BAZE'],
    p1DcCompanionMessageIds: [],
    p2DcCompanionMessageIds: [null, null, 'COMPANION_CHILD'],
    p2DcAttachments: { 'HOST_BAZE': ['Clan of Two'] },
    p2CcAttachments: {},
    companionHealthState: {},
  };
  setGame(GAMEID, game);
  return game;
}

describe('companion derived views — meta resolution', () => {
  beforeEach(setupCompanionGame);

  it('dcMessageMeta.get(hostMsgId) resolves to host DC name (sanity, unchanged)', () => {
    const m = dcMessageMeta.get('HOST_BAZE');
    assert.ok(m, 'host meta must resolve');
    assert.equal(m.dcName, 'Baze Malbus');
    assert.equal(m.playerNum, 2);
    assert.ok(!m.isCompanion, 'host is not a companion');
  });

  it('dcMessageMeta.get(companionMsgId) resolves to companion DC name (NEW)', () => {
    const m = dcMessageMeta.get('COMPANION_CHILD');
    assert.ok(m, 'companion meta must resolve via parallel-array fallback');
    assert.equal(m.dcName, 'The Child', 'companion dcName comes from Clan of Two attachment');
    assert.equal(m.playerNum, 2);
    assert.equal(m.isCompanion, true);
    assert.equal(m.hostMsgId, 'HOST_BAZE');
    assert.equal(m.hostDcName, 'Baze Malbus');
    assert.equal(m.hostIndex, 2);
  });

  it('dcMessageMeta.get(unknownMsgId) returns undefined (sanity)', () => {
    assert.equal(dcMessageMeta.get('TOTALLY_UNKNOWN'), undefined);
  });

  it('iteration includes both host and companion entries', () => {
    const entries = [...dcMessageMeta];
    const ids = entries.map(([id]) => id);
    assert.ok(ids.includes('HOST_BAZE'), 'iterator yields host');
    assert.ok(ids.includes('COMPANION_CHILD'), 'iterator yields companion');
  });
});

describe('companion derived views — exhausted state', () => {
  beforeEach(setupCompanionGame);

  it('dcExhaustedState.get(companionMsgId) returns false (companions never DC-exhaust)', () => {
    assert.equal(dcExhaustedState.get('COMPANION_CHILD'), false,
      'companions don\'t activate as their own DC, so exhausted is always false');
  });

  it('dcExhaustedState.set(companionMsgId, true) is a no-op', () => {
    dcExhaustedState.set('COMPANION_CHILD', true);
    assert.equal(dcExhaustedState.get('COMPANION_CHILD'), false,
      'setting exhausted on a companion must not persist (no-op)');
  });
});

describe('companion derived views — health state', () => {
  beforeEach(setupCompanionGame);

  it('dcHealthState.get(companionMsgId) returns undefined when never set', () => {
    assert.equal(dcHealthState.get('COMPANION_CHILD'), undefined,
      'no health stored yet → undefined');
  });

  it('dcHealthState.set(companionMsgId, hp) writes through to game.companionHealthState (NEW)', () => {
    dcHealthState.set('COMPANION_CHILD', [[2, 2]]);
    const game = getGame(GAMEID);
    assert.deepEqual(game.companionHealthState['COMPANION_CHILD'], [[2, 2]],
      'HP must be written to canonical companionHealthState storage');
  });

  it('dcHealthState.get(companionMsgId) reads back what was set', () => {
    dcHealthState.set('COMPANION_CHILD', [[2, 2]]);
    assert.deepEqual(dcHealthState.get('COMPANION_CHILD'), [[2, 2]]);
  });

  it('dcHealthState.set then mutate the array, then set again — round-trip correctness', () => {
    // Simulates reduceHp's pattern: get, mutate in-place, set back.
    dcHealthState.set('COMPANION_CHILD', [[2, 2]]);
    const hp = dcHealthState.get('COMPANION_CHILD');
    hp[0] = [1, 2];
    dcHealthState.set('COMPANION_CHILD', hp);
    assert.deepEqual(dcHealthState.get('COMPANION_CHILD'), [[1, 2]],
      'mutate-and-set round-trip works for companions just like host DCs');
  });

  it('host DC health remains independent of companion health', () => {
    dcHealthState.set('COMPANION_CHILD', [[1, 2]]);
    const hostHp = dcHealthState.get('HOST_BAZE');
    assert.deepEqual(hostHp, [[11, 11]],
      'companion HP write must not touch host HP');
  });
});

describe('companion derived views — LATENT-COMPANION-DAMAGE: reduceHp now applies damage', () => {
  // Tripwire: pre-fix dcHealthState.get(companionMsgId) returned undefined
  // and reduceHp early-returned wasDefeated:false. Companions could be
  // attacked but never took damage. This pin verifies the storage path
  // works end-to-end via dcHealthState (the actual reduceHp call lives
  // in src/game/damage-helpers.js and reads via dcHealthState).

  it('a companion at 2/2 HP receiving 1 damage ends at 1/2 (NOT silent no-op)', () => {
    setupCompanionGame();
    dcHealthState.set('COMPANION_CHILD', [[2, 2]]);
    // Simulate reduceHp's reads:
    const hp = dcHealthState.get('COMPANION_CHILD');
    assert.ok(hp, 'pre-fix: this returned undefined → reduceHp no-op');
    hp[0] = [Math.max(0, hp[0][0] - 1), hp[0][1]];
    dcHealthState.set('COMPANION_CHILD', hp);
    assert.deepEqual(dcHealthState.get('COMPANION_CHILD'), [[1, 2]],
      'damage applied; companion is no longer effectively immortal');
  });
});
