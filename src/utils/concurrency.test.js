import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWithLimit, DISCORD_REFRESH_CONCURRENCY } from './concurrency.js';

describe('runWithLimit', () => {
  it('returns empty array for empty input', async () => {
    const result = await runWithLimit(5, [], async () => 1);
    assert.deepEqual(result, []);
  });

  it('returns empty array for null input', async () => {
    const result = await runWithLimit(5, null, async () => 1);
    assert.deepEqual(result, []);
  });

  it('preserves input order in results regardless of completion order', async () => {
    // Item with index N completes after (10 - N) ms — reverse-ordered
    // completion. Result must still be in input order.
    const items = [0, 1, 2, 3, 4];
    const result = await runWithLimit(3, items, async (item) => {
      await new Promise((r) => setTimeout(r, (10 - item) * 5));
      return item * 10;
    });
    assert.deepEqual(result, [0, 10, 20, 30, 40]);
  });

  it('caps in-flight work at concurrency limit', async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await runWithLimit(4, items, async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    assert.equal(maxObserved, 4, 'no more than `concurrency` items in flight at once');
  });

  it('handles concurrency > items.length without spawning idle workers', async () => {
    const items = [1, 2, 3];
    const result = await runWithLimit(100, items, async (x) => x * 2);
    assert.deepEqual(result, [2, 4, 6]);
  });

  it('clamps invalid concurrency (zero or negative) to 1', async () => {
    const items = [1, 2, 3];
    const result = await runWithLimit(0, items, async (x) => x);
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('propagates errors from fn (does not swallow them)', async () => {
    await assert.rejects(
      () => runWithLimit(2, [1, 2, 3], async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
      /boom/,
    );
  });

  it('exposes a sane default DISCORD_REFRESH_CONCURRENCY constant', () => {
    assert.ok(typeof DISCORD_REFRESH_CONCURRENCY === 'number');
    assert.ok(DISCORD_REFRESH_CONCURRENCY >= 1 && DISCORD_REFRESH_CONCURRENCY <= 10,
      'must be a conservative concurrency cap, not full Promise.all');
  });
});
