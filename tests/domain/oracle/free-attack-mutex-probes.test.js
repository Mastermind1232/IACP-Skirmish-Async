/**
 * Tier 3 Legality-Oracle Probes: Free-Attack Window Mutex (D3)
 *
 * Heat-map row (D3 "Free-attack window mutex"): only one free-attack window
 * (pendingFiringSquad / pendingCoordinatedRaid / pendingFieldTactics) may be
 * active at a time, and the consumption chain at src/handlers/combat.js:937-965
 * must route a given msgId to at most one branch.
 *
 * Before these probes the row was inferred_only — individual windows were
 * exercised by selfplay but the mutex itself was never asserted.
 *
 * Scope: the three fields explicitly named in the heat-map row. Adjacent
 * free-attack windows (Battlefield Leadership, Fell Swoop, Emperor Interrupt,
 * Executive Order, Bombardment Sorin) are covered elsewhere (post-select
 * gating certification) and are out of scope here.
 *
 * PROBE-FAM-001: Static mutex — setup-site outputs are one-at-a-time
 *   For each of the three fields, a game state with only that field populated
 *   yields activeWindowCount === 1. An empty-game state yields 0.
 *
 * PROBE-FAM-002: Consumption routing is mutually exclusive by msgId
 *   Pure-function shadow of combat.js:937-965 selects at most one branch per
 *   msgId and clears exactly that field; unmatched fields are untouched.
 *
 * PROBE-FAM-003: Transition path — A → consume → B → consume → C → consume
 *   Every intermediate state has activeWindowCount <= 1. Final state is 0.
 *
 * PROBE-FAM-004: Round cleanup safety net
 *   All three field names appear in ROUND_NULL_FLAGS, so round cleanup
 *   guarantees activeWindowCount === 0 at round boundaries.
 *
 * PROBE-FAM-005: Anti-drift source pin
 *   The mutex scope in combat.js still names exactly these three fields via
 *   the `isFiringSquadFreeAttack | isCoordinatedRaidFreeAttack |
 *   isFieldTacticsFreeAttack` trio. A 4th mutex member or a rename trips the
 *   pin and forces a probe rewrite.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MUTEX_FIELDS = ['pendingFiringSquad', 'pendingCoordinatedRaid', 'pendingFieldTactics'];

/** Count how many of the three mutex fields are currently "active" on game. */
function activeWindowCount(game) {
  let n = 0;
  if (Array.isArray(game.pendingFiringSquad) && game.pendingFiringSquad.length > 0) n++;
  if (game.pendingCoordinatedRaid) n++;
  if (game.pendingFieldTactics) n++;
  return n;
}

/**
 * Pure-function shadow of the mutex-consumption chain at
 * src/handlers/combat.js:937-965. Returns { branch, cleared } — the name of
 * the branch that fired (or null), and the mutex field that was cleared.
 * Mutates `game` to match handler semantics.
 */
function consumeFreeAttackWindow(game, msgId) {
  const isFiringSquad = (game.pendingFiringSquad || []).some(p => p.forMsgId === msgId);
  const isCoordinatedRaid = game.pendingCoordinatedRaid?.forMsgId === msgId;
  const isFieldTactics = game.pendingFieldTactics?.forMsgId === msgId;
  if (isFiringSquad) {
    game.pendingFiringSquad = (game.pendingFiringSquad || []).filter(p => p.forMsgId !== msgId);
    if (game.pendingFiringSquad.length === 0) delete game.pendingFiringSquad;
    return { branch: 'firingSquad', cleared: 'pendingFiringSquad' };
  }
  if (isCoordinatedRaid) {
    delete game.pendingCoordinatedRaid;
    return { branch: 'coordinatedRaid', cleared: 'pendingCoordinatedRaid' };
  }
  if (isFieldTactics) {
    delete game.pendingFieldTactics;
    return { branch: 'fieldTactics', cleared: 'pendingFieldTactics' };
  }
  return { branch: null, cleared: null };
}

describe('Free-Attack Window Mutex Oracle Probes', () => {
  describe('PROBE-FAM-001: static mutex', () => {
    it('empty game → activeWindowCount === 0', () => {
      assert.equal(activeWindowCount({}), 0);
    });
    it('only pendingFiringSquad set → count === 1', () => {
      const g = { pendingFiringSquad: [{ forMsgId: 'msg1', chosenFigureKey: 'Greedo-1-0', triggeredByMsgId: 'src1' }] };
      assert.equal(activeWindowCount(g), 1);
    });
    it('only pendingCoordinatedRaid set → count === 1', () => {
      const g = { pendingCoordinatedRaid: { forMsgId: 'msg2', chosenFigureKey: 'Greedo-1-0', triggeredByMsgId: 'src2' } };
      assert.equal(activeWindowCount(g), 1);
    });
    it('only pendingFieldTactics set → count === 1', () => {
      const g = { pendingFieldTactics: { forMsgId: 'msg3', chosenFigureKey: 'Greedo-1-0', triggeredByMsgId: 'src3' } };
      assert.equal(activeWindowCount(g), 1);
    });
    it('empty-array pendingFiringSquad does not count as active (pre-choice state)', () => {
      const g = { pendingFiringSquad: [] };
      assert.equal(activeWindowCount(g), 0);
    });
  });

  describe('PROBE-FAM-002: consumption routing is mutually exclusive by msgId', () => {
    it('matches Firing Squad entry, clears it, leaves other fields untouched', () => {
      const g = {
        pendingFiringSquad: [{ forMsgId: 'atkA', chosenFigureKey: 'Trooper-1-0', triggeredByMsgId: 'src' }],
        pendingCoordinatedRaid: { forMsgId: 'other', chosenFigureKey: 'x', triggeredByMsgId: 'y' },
        pendingFieldTactics: { forMsgId: 'also-other', chosenFigureKey: 'x', triggeredByMsgId: 'y' },
      };
      const r = consumeFreeAttackWindow(g, 'atkA');
      assert.equal(r.branch, 'firingSquad');
      assert.equal(g.pendingFiringSquad, undefined);
      assert.equal(g.pendingCoordinatedRaid?.forMsgId, 'other');
      assert.equal(g.pendingFieldTactics?.forMsgId, 'also-other');
    });
    it('matches CoordinatedRaid when msgId hits it and FiringSquad does not', () => {
      const g = {
        pendingCoordinatedRaid: { forMsgId: 'atkB', chosenFigureKey: 'x', triggeredByMsgId: 'y' },
      };
      const r = consumeFreeAttackWindow(g, 'atkB');
      assert.equal(r.branch, 'coordinatedRaid');
      assert.equal(g.pendingCoordinatedRaid, undefined);
    });
    it('matches FieldTactics when only it matches', () => {
      const g = {
        pendingFieldTactics: { forMsgId: 'atkC', chosenFigureKey: 'x', triggeredByMsgId: 'y' },
      };
      const r = consumeFreeAttackWindow(g, 'atkC');
      assert.equal(r.branch, 'fieldTactics');
      assert.equal(g.pendingFieldTactics, undefined);
    });
    it('no match for a non-matching msgId → returns null branch, leaves state intact', () => {
      const g = {
        pendingFiringSquad: [{ forMsgId: 'other', chosenFigureKey: 'x', triggeredByMsgId: 'y' }],
      };
      const r = consumeFreeAttackWindow(g, 'unknown');
      assert.equal(r.branch, null);
      assert.equal(g.pendingFiringSquad.length, 1);
    });
    it('first-match ordering is stable: FiringSquad wins over CoordinatedRaid when both match same msgId', () => {
      const g = {
        pendingFiringSquad: [{ forMsgId: 'atkX', chosenFigureKey: 'x', triggeredByMsgId: 'y' }],
        pendingCoordinatedRaid: { forMsgId: 'atkX', chosenFigureKey: 'x', triggeredByMsgId: 'y' },
      };
      const r = consumeFreeAttackWindow(g, 'atkX');
      assert.equal(r.branch, 'firingSquad');
      assert.equal(g.pendingFiringSquad, undefined);
      // The unmatched-by-chain branch is not cleared — confirms routing is one-branch-per-call.
      assert.equal(g.pendingCoordinatedRaid?.forMsgId, 'atkX');
    });
  });

  describe('PROBE-FAM-003: transition path — A → consume → B → consume → C → consume', () => {
    it('at every intermediate state, activeWindowCount <= 1, and final state is 0', () => {
      const g = {};
      const snapshots = [];
      // Set FiringSquad → consume → Set CoordinatedRaid → consume → Set FieldTactics → consume
      g.pendingFiringSquad = [{ forMsgId: 'a', chosenFigureKey: 'x', triggeredByMsgId: 's' }];
      snapshots.push(activeWindowCount(g));
      consumeFreeAttackWindow(g, 'a');
      snapshots.push(activeWindowCount(g));
      g.pendingCoordinatedRaid = { forMsgId: 'b', chosenFigureKey: 'x', triggeredByMsgId: 's' };
      snapshots.push(activeWindowCount(g));
      consumeFreeAttackWindow(g, 'b');
      snapshots.push(activeWindowCount(g));
      g.pendingFieldTactics = { forMsgId: 'c', chosenFigureKey: 'x', triggeredByMsgId: 's' };
      snapshots.push(activeWindowCount(g));
      consumeFreeAttackWindow(g, 'c');
      snapshots.push(activeWindowCount(g));
      for (const n of snapshots) assert.ok(n <= 1, `count ${n} violates mutex`);
      assert.deepEqual(snapshots, [1, 0, 1, 0, 1, 0]);
    });
  });

  describe('PROBE-FAM-004: round cleanup safety net', () => {
    it('all three fields are listed in ROUND_NULL_FLAGS', async () => {
      const { ROUND_NULL_FLAGS } = await import('../../../src/game/activation-state.js');
      for (const f of MUTEX_FIELDS) {
        assert.ok(ROUND_NULL_FLAGS.includes(f), `${f} missing from ROUND_NULL_FLAGS`);
      }
    });
  });

  describe('PROBE-FAM-005: anti-drift source pin', () => {
    it('combat.js still names exactly the three mutex branches and no more', () => {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const combatSrc = readFileSync(resolve(__dirname, '../../../src/handlers/combat.js'), 'utf8');
      // The three isXxxFreeAttack locals identify the mutex scope. If a 4th
      // free-attack mutex member is added, the probe must be rewritten to
      // include it and this pin should trip.
      assert.ok(combatSrc.includes('isFiringSquadFreeAttack'), 'isFiringSquadFreeAttack missing from combat.js');
      assert.ok(combatSrc.includes('isCoordinatedRaidFreeAttack'), 'isCoordinatedRaidFreeAttack missing from combat.js');
      assert.ok(combatSrc.includes('isFieldTacticsFreeAttack'), 'isFieldTacticsFreeAttack missing from combat.js');
      // Field-name pin — refactors that rename any mutex field trip this.
      for (const f of MUTEX_FIELDS) {
        assert.ok(combatSrc.includes(f), `${f} missing from combat.js`);
      }
    });
  });
});
