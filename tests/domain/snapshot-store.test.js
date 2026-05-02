import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldSnapshot, SNAPSHOT_INTERVAL, loadLatestSnapshot, saveSnapshot } from '../../src/domain/snapshot-store.js';

describe('SnapshotStore', () => {
  describe('shouldSnapshot', () => {
    it('returns false for version 0', () => {
      assert.equal(shouldSnapshot(0), false);
    });

    it('returns true at SNAPSHOT_INTERVAL', () => {
      assert.equal(shouldSnapshot(SNAPSHOT_INTERVAL), true);
    });

    it('returns false for non-interval versions', () => {
      assert.equal(shouldSnapshot(1), false);
      assert.equal(shouldSnapshot(SNAPSHOT_INTERVAL + 1), false);
      assert.equal(shouldSnapshot(SNAPSHOT_INTERVAL - 1), false);
    });

    it('returns true at multiples of SNAPSHOT_INTERVAL', () => {
      assert.equal(shouldSnapshot(SNAPSHOT_INTERVAL * 2), true);
      assert.equal(shouldSnapshot(SNAPSHOT_INTERVAL * 3), true);
    });
  });

  describe('saveSnapshot (no-pool graceful)', () => {
    it('does not throw with no DB pool', async () => {
      const state = {
        someField: 'value',
        undoStack: [1, 2, 3],
        moveGridMessageIds: ['msg1'],
        nested: { data: true },
      };
      await assert.doesNotReject(() => saveSnapshot('game-1', 50, state));
    });
  });

  describe('loadLatestSnapshot (no-pool graceful)', () => {
    it('returns null with no DB pool', async () => {
      const result = await loadLatestSnapshot('game-1');
      assert.equal(result, null);
    });
  });
});
