import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getGameLock, cleanupGameLock, withGameLock } from './action-queue.js';

describe('action-queue', () => {
  it('getGameLock returns same Mutex for same gameId', () => {
    const lock1 = getGameLock('00001');
    const lock2 = getGameLock('00001');
    assert.strictEqual(lock1, lock2);
    cleanupGameLock('00001');
  });

  it('getGameLock returns different Mutex for different gameIds', () => {
    const lock1 = getGameLock('00001');
    const lock2 = getGameLock('00002');
    assert.notStrictEqual(lock1, lock2);
    cleanupGameLock('00001');
    cleanupGameLock('00002');
  });

  it('cleanupGameLock removes the lock', () => {
    const lock1 = getGameLock('00003');
    cleanupGameLock('00003');
    const lock2 = getGameLock('00003');
    assert.notStrictEqual(lock1, lock2);
    cleanupGameLock('00003');
  });

  it('withGameLock serializes concurrent operations on same game', async () => {
    const order = [];
    const p1 = withGameLock('00004', async () => {
      order.push('start-1');
      await new Promise((r) => setTimeout(r, 50));
      order.push('end-1');
    });
    const p2 = withGameLock('00004', async () => {
      order.push('start-2');
      order.push('end-2');
    });
    await Promise.all([p1, p2]);
    assert.deepStrictEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
    cleanupGameLock('00004');
  });

  it('withGameLock allows concurrent operations on different games', async () => {
    const order = [];
    const p1 = withGameLock('00005', async () => {
      order.push('game5-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('game5-end');
    });
    const p2 = withGameLock('00006', async () => {
      order.push('game6-start');
      order.push('game6-end');
    });
    await Promise.all([p1, p2]);
    // game6 should complete before game5 because they run concurrently
    assert.ok(order.indexOf('game6-end') < order.indexOf('game5-end'));
    cleanupGameLock('00005');
    cleanupGameLock('00006');
  });

  it('withGameLock runs without lock when gameId is null', async () => {
    let ran = false;
    await withGameLock(null, async () => { ran = true; });
    assert.ok(ran);
  });

  it('withGameLock propagates errors from handler', async () => {
    await assert.rejects(
      () => withGameLock('00007', async () => { throw new Error('test error'); }),
      { message: 'test error' },
    );
    cleanupGameLock('00007');
  });

  it('withGameLock releases lock after error so next handler can run', async () => {
    let secondRan = false;
    try {
      await withGameLock('00008', async () => { throw new Error('fail'); });
    } catch (_) {}
    await withGameLock('00008', async () => { secondRan = true; });
    assert.ok(secondRan);
    cleanupGameLock('00008');
  });
});
