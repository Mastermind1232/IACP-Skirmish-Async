import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketizeRoundTriggers,
  firstNonEmptyBinIdx,
  nextNonEmptyBinIdx,
  ROUND_BIN_MISSION,
  ROUND_BIN_INIT,
  ROUND_BIN_NON_INIT,
} from './round-trigger-bins.js';

describe('bucketizeRoundTriggers (SoR/EoR strict bins)', () => {
  it('orders bins mission -> init -> non-init', () => {
    const buckets = bucketizeRoundTriggers({
      missionDescriptors: [{ id: 'm1' }],
      descriptors: [
        { id: 'a', ownerPlayerNum: 1 },
        { id: 'b', ownerPlayerNum: 2 },
        { id: 'c', ownerPlayerNum: 1 },
      ],
      initPlayerNum: 2,
    });
    assert.strictEqual(buckets.length, 3);
    assert.strictEqual(buckets[0].bin, ROUND_BIN_MISSION);
    assert.strictEqual(buckets[1].bin, ROUND_BIN_INIT);
    assert.strictEqual(buckets[2].bin, ROUND_BIN_NON_INIT);
    // init player is 2 here
    assert.strictEqual(buckets[1].ownerPlayerNum, 2);
    assert.deepStrictEqual(buckets[1].descriptors.map((d) => d.id), ['b']);
    assert.strictEqual(buckets[2].ownerPlayerNum, 1);
    assert.deepStrictEqual(buckets[2].descriptors.map((d) => d.id), ['a', 'c']);
    assert.deepStrictEqual(buckets[0].descriptors.map((d) => d.id), ['m1']);
  });

  it('mission descriptors carry no owner (engine-driven)', () => {
    const buckets = bucketizeRoundTriggers({ missionDescriptors: [{ id: 'm' }], descriptors: [], initPlayerNum: 1 });
    assert.strictEqual(buckets[0].ownerPlayerNum, null);
  });

  it('always returns three bins even when empty', () => {
    const buckets = bucketizeRoundTriggers({ initPlayerNum: 1 });
    assert.strictEqual(buckets.length, 3);
    assert.ok(buckets.every((b) => b.descriptors.length === 0));
  });

  it('firstNonEmptyBinIdx skips empty leading bins in strict order', () => {
    const buckets = bucketizeRoundTriggers({
      missionDescriptors: [],
      descriptors: [{ id: 'x', ownerPlayerNum: 2 }],
      initPlayerNum: 1,
    });
    // mission empty, init (p1) empty, non-init (p2) has x
    assert.strictEqual(firstNonEmptyBinIdx(buckets), 2);
  });

  it('firstNonEmptyBinIdx returns -1 when all drained', () => {
    assert.strictEqual(firstNonEmptyBinIdx(bucketizeRoundTriggers({ initPlayerNum: 1 })), -1);
  });

  it('nextNonEmptyBinIdx advances past empty bins', () => {
    const buckets = bucketizeRoundTriggers({
      missionDescriptors: [{ id: 'm' }],
      descriptors: [{ id: 'y', ownerPlayerNum: 2 }],
      initPlayerNum: 1,
    });
    // bins: [mission(m)], [init p1 empty], [non-init p2 (y)]
    assert.strictEqual(firstNonEmptyBinIdx(buckets), 0);
    assert.strictEqual(nextNonEmptyBinIdx(buckets, 0), 2);
    assert.strictEqual(nextNonEmptyBinIdx(buckets, 2), -1);
  });
});
