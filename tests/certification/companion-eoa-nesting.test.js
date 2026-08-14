/**
 * A companion activating SECOND runs INSIDE its host's end-of-activation window.
 *
 * alexanbv 2026-08-13: "if after, the entire activation counts as an EoA ability
 * and can be interspersed with other EoA abilities."
 *
 * That makes the window NEST, which the slice-1 design did not anticipate. Both
 * pieces of state were single slots:
 *
 *   game.pendingEoaResolution         the open window
 *   game.pendingEndActivationResume   the deferred teardown
 *
 * When the companion's own End Activation landed while the host's window was
 * still open, it overwrote BOTH. The host's remaining descriptors were
 * discarded, and — the serious one — the host's teardown marker was replaced by
 * the companion's, so THE HOST'S ACTIVATION NEVER FINISHED: no End Turn prompt,
 * no after-resolves window. A stranded activation, which is the exact failure
 * mode the whole rework exists to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { startEoaResolution } from '../../src/game/eoa-orchestrator.js';

const desc = (id, pn) => ({ id, ownerPlayerNum: pn, sourceMsgId: `m-${id}`, sourceLabel: id, subPromptKey: id });

describe('companion activation nests inside the host EoA window', () => {
  test('a second startEoaResolution MERGES rather than clobbering the open window', () => {
    const game = {};
    startEoaResolution(game, [desc('host_a', 1), desc('host_b', 1)], 1, { activatorMsgId: 'host' });
    const before = game.pendingEoaResolution.buckets.flatMap(b => b.descriptors.map(d => d.id));
    assert.deepEqual(before.sort(), ['host_a', 'host_b']);

    // The companion's own end, while the host's window is still open.
    startEoaResolution(game, [desc('companion_x', 1)], 1, { activatorMsgId: 'companion' });

    const after = game.pendingEoaResolution.buckets.flatMap(b => b.descriptors.map(d => d.id));
    assert.deepEqual(after.sort(), ['companion_x', 'host_a', 'host_b'],
      "the host's descriptors must survive — one window holding both sets is what "
      + '"interspersed with other EoA abilities" means');
  });

  test('merging does not duplicate a descriptor already present', () => {
    const game = {};
    startEoaResolution(game, [desc('shield', 1)], 1, {});
    startEoaResolution(game, [desc('shield', 1)], 1, {});
    const ids = game.pendingEoaResolution.buckets.flatMap(b => b.descriptors.map(d => d.id));
    assert.deepEqual(ids, ['shield'], 'a re-enumerated descriptor must not double up');
  });

  test('merging reopens an emptied bucket so the new descriptors are reachable', () => {
    const game = {};
    startEoaResolution(game, [desc('host_a', 1)], 1, {});
    // Simulate the host's only descriptor having been consumed.
    game.pendingEoaResolution.buckets[game.pendingEoaResolution.currentBucketIdx].descriptors = [];
    startEoaResolution(game, [desc('companion_x', 1)], 1, {});
    const cur = game.pendingEoaResolution.buckets[game.pendingEoaResolution.currentBucketIdx];
    assert.ok(cur.descriptors.some(d => d.id === 'companion_x'),
      'the current bucket must point at the merged descriptors, not an empty one');
  });
});

describe('deferred teardowns queue rather than overwrite', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, 'utf8');

  test('the resume marker is a queue', () => {
    const src = read('../../src/handlers/activation.js');
    assert.match(src, /pendingEndActivationResume\.push\(/,
      'host and companion can both be waiting on the same window close');
    assert.ok(!/game\.pendingEndActivationResume = \{/.test(src),
      'a single-slot assignment loses the first teardown — the stranding bug');
  });

  test('the handler drains every queued teardown', () => {
    const src = read('../../src/handlers/eoa-handler.js');
    assert.match(src, /for \(const resume of resumes\)/,
      'must run ALL deferred teardowns, not just the last one queued');
    const idxDelete = src.indexOf('delete game.pendingEndActivationResume');
    const idxLoop = src.indexOf('for (const resume of resumes)');
    assert.ok(idxDelete > 0 && idxLoop > idxDelete,
      'the queue must be cleared BEFORE draining, so a re-entrant close cannot tear down twice');
  });
});
