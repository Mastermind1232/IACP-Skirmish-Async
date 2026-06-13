import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  startRoundTriggerResolution,
  currentBin,
  findDescriptorInCurrentBin,
  consumeDescriptor,
  skipCurrentBin,
  isResolutionComplete,
} from './round-trigger-orchestrator.js';

function setup(initPlayerNum = 1) {
  const game = {};
  const started = startRoundTriggerResolution(game, {
    phase: 'EoR',
    missionDescriptors: [{ id: 'm1', label: 'mission rule' }],
    descriptors: [
      { id: 'a', ownerPlayerNum: 1 },
      { id: 'b', ownerPlayerNum: 1 },
      { id: 'c', ownerPlayerNum: 2 },
    ],
    initPlayerNum,
  });
  return { game, started };
}

describe('round-trigger-orchestrator lifecycle', () => {
  it('starts only when something is pending', () => {
    const empty = {};
    assert.strictEqual(startRoundTriggerResolution(empty, { phase: 'SoR', initPlayerNum: 1 }), false);
    assert.strictEqual(empty.pendingRoundTrigger, undefined);
    const { started } = setup();
    assert.strictEqual(started, true);
  });

  it('begins on the mission bin', () => {
    const { game } = setup(1);
    assert.strictEqual(currentBin(game).bin, 'mission');
  });

  it('enforces strict bin order: mission -> init -> non-init', () => {
    const { game } = setup(1); // init = p1
    // mission bin
    assert.ok(consumeDescriptor(game, 'm1'));
    // now init player (p1) bin
    assert.strictEqual(currentBin(game).ownerPlayerNum, 1);
    // a descriptor from a later bin is NOT resolvable yet
    assert.strictEqual(findDescriptorInCurrentBin(game, 'c'), null);
    assert.ok(findDescriptorInCurrentBin(game, 'a'));
    // player chooses order within the bin: b before a
    assert.ok(consumeDescriptor(game, 'b'));
    assert.ok(consumeDescriptor(game, 'a'));
    // bin drained -> advance to non-init (p2)
    assert.strictEqual(currentBin(game).ownerPlayerNum, 2);
    assert.ok(consumeDescriptor(game, 'c'));
    // all drained -> complete
    assert.strictEqual(isResolutionComplete(game), true);
  });

  it('respects initiative ownership (init = p2)', () => {
    const { game } = setup(2);
    consumeDescriptor(game, 'm1');
    // init player is now 2 -> its bin (with c) comes before p1's
    assert.strictEqual(currentBin(game).ownerPlayerNum, 2);
    assert.ok(findDescriptorInCurrentBin(game, 'c'));
    assert.strictEqual(findDescriptorInCurrentBin(game, 'a'), null);
  });

  it('skipCurrentBin forgoes the rest and advances', () => {
    const { game } = setup(1);
    consumeDescriptor(game, 'm1'); // -> p1 bin
    skipCurrentBin(game); // forgo p1's a,b -> p2 bin
    assert.strictEqual(currentBin(game).ownerPlayerNum, 2);
    skipCurrentBin(game); // forgo p2 -> done
    assert.strictEqual(isResolutionComplete(game), true);
  });
});
