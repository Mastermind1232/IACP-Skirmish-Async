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
  // alexanbv 2026-08-18: "in the second case EoA does not merge. Companion EoA
  // completes, then move back to remaining host EoA."
  //
  // So the companion's window is NESTED, not merged: it must fully resolve
  // before the host's remaining effects come back. An earlier version merged
  // both sets into one bucket, which let the player interleave the companion's
  // EoA effects with the host's — the wrong shape.
  test('a second resolution SUSPENDS the open window rather than merging', () => {
    const game = {};
    startEoaResolution(game, [desc('host_a', 1), desc('host_b', 1)], 1, { activatorMsgId: 'host' });

    startEoaResolution(game, [desc('companion_x', 1)], 1, { activatorMsgId: 'companion' });

    const current = game.pendingEoaResolution.buckets.flatMap(b => b.descriptors.map(d => d.id));
    assert.deepEqual(current, ['companion_x'],
      "only the companion's effects are live — the host's must not be interleaved");
    assert.strictEqual(game.eoaResolutionStack.length, 1, "the host's window is suspended, not lost");
    const suspended = game.eoaResolutionStack[0].buckets.flatMap(b => b.descriptors.map(d => d.id));
    assert.deepEqual(suspended.sort(), ['host_a', 'host_b']);
  });

  test('the host window is never discarded by the nesting', () => {
    const game = {};
    startEoaResolution(game, [desc('host_only', 1)], 1, {});
    startEoaResolution(game, [desc('companion_only', 1)], 1, {});
    const all = [
      ...game.pendingEoaResolution.buckets.flatMap(b => b.descriptors.map(d => d.id)),
      ...game.eoaResolutionStack.flatMap(r => r.buckets.flatMap(b => b.descriptors.map(d => d.id))),
    ];
    assert.deepEqual(all.sort(), ['companion_only', 'host_only']);
  });

  test('the handler pops the suspended window when the nested one completes', () => {
    const src = readFileSync(new URL('../../src/handlers/eoa-handler.js', import.meta.url).pathname, 'utf8');
    assert.match(src, /game\.eoaResolutionStack\.pop\(\)/,
      'completing a nested window must restore the suspended one');
    assert.match(src, /while \(!desc && Array\.isArray\(game\.eoaResolutionStack\)/,
      'must keep unwinding while suspended windows remain');
  });

  test('teardown happens only once the LAST window closes', () => {
    const src = readFileSync(new URL('../../src/handlers/eoa-handler.js', import.meta.url).pathname, 'utf8');
    const popIdx = src.indexOf('game.eoaResolutionStack.pop()');
    const resumeIdx = src.indexOf('pendingEndActivationResume');
    assert.ok(popIdx > 0 && resumeIdx > popIdx,
      'the stack must be fully unwound before any deferred teardown runs');
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

describe('a paired activation must not wipe the other side state', () => {
  // alexanbv 2026-08-18: "reaudit all companion functions for similar issues."
  //
  // ACTIVATION_SCALAR_FLAGS are UNKEYED, so cleanupActivation's sweep is
  // all-or-nothing. With one activation running that is correct. A host +
  // companion pair is the ONLY case where two activations of the same player
  // overlap, and there whichever side ended first wiped the other side's
  // still-live state: its pending prompts (Parting Blow, Overcharged Weapons,
  // Static Pulse, Force card pick, YHSIW options, Wookiee slam push, surge
  // overflow) and its specialOrInteractResolvedThisActivation marker — the last
  // of which would let the surviving activation take a SECOND special action.
  test('the scalar sweep is skipped while a paired activation is live', async () => {
    const { cleanupActivation } = await import('../../src/game/activation-state.js');
    const game = {
      pendingPartingBlow: { owner: 'host' },
      specialOrInteractResolvedThisActivation: true,
      dcActionsData: {},
    };
    cleanupActivation(game, 'companion-msg', 1, [], { pairedActive: 'host-msg' });

    assert.deepEqual(game.pendingPartingBlow, { owner: 'host' },
      "the host's pending prompt must survive its companion ending");
    assert.strictEqual(game.specialOrInteractResolvedThisActivation, true,
      'wiping this would let the host take a second special action');
  });

  test('the sweep still runs when nothing is paired', () => {
    // The normal single-activation case must be unchanged.
    return import('../../src/game/activation-state.js').then(({ cleanupActivation }) => {
      const game = {
        pendingPartingBlow: { owner: 'solo' },
        specialOrInteractResolvedThisActivation: true,
        dcActionsData: {},
      };
      cleanupActivation(game, 'solo-msg', 1, []);
      assert.strictEqual(game.pendingPartingBlow, undefined, 'cleared as before');
      assert.strictEqual(game.specialOrInteractResolvedThisActivation, undefined);
    });
  });

  test('the handler passes the paired msgId through', () => {
    const src = readFileSync(new URL('../../src/handlers/activation.js', import.meta.url).pathname, 'utf8');
    assert.match(src, /cleanupActivation\([^)]*\{ pairedActive: _slice3PairedActive \}\)/,
      'the end-activation path must tell cleanupActivation whether a paired activation is live');
  });
});

describe('the paired guard must not trade a wipe for a deadlock', () => {
  // Caught by adversarial review of the guard above, BEFORE it shipped.
  //
  // activationLockKey is in ACTIVATION_SCALAR_FLAGS, and the pair gate in
  // dc-play-area.js refuses any msgId that does not own the lock. Skipping the
  // scalar sweep wholesale left the lock pointing at the side that had just
  // FINISHED, so the surviving side could never act — a deadlock, strictly
  // worse than the state-wipe it was fixing.
  //
  // It is also the only scalar that can be attributed: it encodes its owner as
  // `${msgId}_f${figureIndex}`. Hence the rule — clear what provably belongs to
  // the ending activation, preserve what might belong to the live one.
  test('the ending side releases its own lock even on a partial end', async () => {
    const { cleanupActivation } = await import('../../src/game/activation-state.js');
    const game = { activationLockKey: 'companion-msg_f0', dcActionsData: {} };
    cleanupActivation(game, 'companion-msg', 1, [], { pairedActive: 'host-msg' });
    assert.strictEqual(game.activationLockKey, undefined,
      'the finished side must release the lock, or its partner can never act');
  });

  test('it does NOT release a lock held by the surviving side', async () => {
    const { cleanupActivation } = await import('../../src/game/activation-state.js');
    const game = { activationLockKey: 'host-msg_f0', dcActionsData: {} };
    cleanupActivation(game, 'companion-msg', 1, [], { pairedActive: 'host-msg' });
    assert.strictEqual(game.activationLockKey, 'host-msg_f0',
      "the live side's lock must survive its partner ending");
  });

  test('a full end still clears the lock unconditionally', async () => {
    const { cleanupActivation } = await import('../../src/game/activation-state.js');
    const game = { activationLockKey: 'solo-msg_f1', dcActionsData: {} };
    cleanupActivation(game, 'solo-msg', 1, []);
    assert.strictEqual(game.activationLockKey, undefined);
  });
});
