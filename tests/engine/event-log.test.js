import { describe, it } from 'node:test';
import assert from 'node:assert';
import { captureSnapshot, computeDiff, createEvent, appendToBuffer, getRecentEvents, clearBuffer } from '../../src/event-log.js';

describe('event-log', () => {
  describe('captureSnapshot', () => {
    it('deep clones game state', () => {
      const game = { gameId: '00001', player1Id: 'p1', nested: { a: 1 } };
      const snap = captureSnapshot(game);
      assert.deepStrictEqual(snap, game);
      snap.nested.a = 999;
      assert.strictEqual(game.nested.a, 1); // original unchanged
    });

    it('strips transient fields', () => {
      const game = { gameId: '00001', undoStack: [1, 2, 3], moveGridMessageIds: ['a'] };
      const snap = captureSnapshot(game);
      assert.strictEqual(snap.undoStack, undefined);
      assert.strictEqual(snap.moveGridMessageIds, undefined);
      assert.strictEqual(snap.gameId, '00001');
    });

    it('returns null for null input', () => {
      assert.strictEqual(captureSnapshot(null), null);
    });
  });

  describe('computeDiff', () => {
    it('returns null when nothing changed', () => {
      const before = { a: 1, b: 'hello' };
      const after = { a: 1, b: 'hello' };
      assert.strictEqual(computeDiff(before, after), null);
    });

    it('detects changed keys', () => {
      const before = { a: 1, b: 'hello' };
      const after = { a: 2, b: 'hello' };
      const diff = computeDiff(before, after);
      assert.deepStrictEqual(diff.set, { a: 2 });
      assert.deepStrictEqual(diff.deleted, []);
    });

    it('detects deleted keys', () => {
      const before = { a: 1, b: 'hello' };
      const after = { a: 1 };
      const diff = computeDiff(before, after);
      assert.deepStrictEqual(diff.set, {});
      assert.deepStrictEqual(diff.deleted, ['b']);
    });

    it('detects new keys', () => {
      const before = { a: 1 };
      const after = { a: 1, b: 'hello' };
      const diff = computeDiff(before, after);
      assert.deepStrictEqual(diff.set, { b: 'hello' });
      assert.deepStrictEqual(diff.deleted, []);
    });

    it('detects nested object changes', () => {
      const before = { data: { x: 1 } };
      const after = { data: { x: 2 } };
      const diff = computeDiff(before, after);
      assert.deepStrictEqual(diff.set, { data: { x: 2 } });
    });
  });

  describe('createEvent', () => {
    it('creates event with auto-incrementing seq', () => {
      const evt1 = createEvent('test_game', 'handler_a_', 'handler_a_00001', 'user1', { set: {}, deleted: [] });
      const evt2 = createEvent('test_game', 'handler_b_', 'handler_b_00001', 'user2', { set: {}, deleted: [] });
      assert.strictEqual(evt1.seq + 1, evt2.seq);
      assert.strictEqual(evt1.gameId, 'test_game');
      assert.strictEqual(evt1.handlerKey, 'handler_a_');
    });
  });

  describe('ring buffer', () => {
    it('stores and retrieves events', () => {
      const gameId = 'buffer_test_' + Date.now();
      clearBuffer(gameId);

      const evt = createEvent(gameId, 'test_', 'test_id', 'user1', { set: { a: 1 }, deleted: [] });
      appendToBuffer(evt);

      const recent = getRecentEvents(gameId, 5);
      assert.strictEqual(recent.length, 1);
      assert.strictEqual(recent[0].handlerKey, 'test_');
    });

    it('returns empty for unknown game', () => {
      const recent = getRecentEvents('nonexistent', 5);
      assert.strictEqual(recent.length, 0);
    });

    it('limits to requested count', () => {
      const gameId = 'limit_test_' + Date.now();
      clearBuffer(gameId);

      for (let i = 0; i < 20; i++) {
        appendToBuffer(createEvent(gameId, `h${i}_`, `id${i}`, 'user1', { set: {}, deleted: [] }));
      }

      const recent = getRecentEvents(gameId, 5);
      assert.strictEqual(recent.length, 5);
    });
  });
});
