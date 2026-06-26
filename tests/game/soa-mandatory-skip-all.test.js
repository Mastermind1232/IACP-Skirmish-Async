/**
 * SoA bucket-level "Skip all remaining" suppression for MANDATORY descriptors
 * (residual follow-up 2026-06-26).
 *
 * Madness (Taron Malicos) is a mandatory player-triggered descriptor: the
 * player must Resolve it (and absorb the Strain/Focus penalty if hand <= 2).
 * The per-prompt Skip is already absent for it, but the BUCKET-level
 * "Skip all remaining" button used to route through skipCurrentBucket and
 * discharge the pending mandatory descriptor, dodging the penalty.
 *
 * describeChooserPrompt must therefore SUPPRESS "Skip all remaining" whenever
 * the current bucket still holds any descriptor tagged `mandatory: true`, while
 * still offering each descriptor's own Resolve button (no soft-lock). Once only
 * optional descriptors remain, the button reappears.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeChooserPrompt,
  startSoaResolution,
  consumeDescriptor,
} from '../../src/game/soa-orchestrator.js';

function mkDesc(id, label, extra = {}) {
  return { id, ownerPlayerNum: 1, sourceMsgId: 'msg_x', sourceLabel: label, subPromptKey: id, extras: {}, ...extra };
}

describe('SoA "Skip all remaining" suppression for mandatory descriptors', () => {
  it('suppresses Skip-all when the bucket holds a mandatory descriptor (Madness)', () => {
    const game = {};
    const madness = mkDesc('madness:msg_x', 'Madness', { mandatory: true });
    started(game, [madness]);
    const prompt = describeChooserPrompt(game.pendingSoaResolution, 'g1');
    const ids = prompt.choices.map((c) => c.descId);
    assert.ok(ids.includes('madness:msg_x'), 'Madness must still have its own Resolve button');
    assert.ok(!ids.includes('__skip_all__'), 'Skip all remaining must be suppressed while Madness is pending');
  });

  it('keeps Skip-all when only optional descriptors are present', () => {
    const game = {};
    const optional = mkDesc('mounted:msg_x', 'Mounted'); // no mandatory tag
    started(game, [optional]);
    const prompt = describeChooserPrompt(game.pendingSoaResolution, 'g1');
    const ids = prompt.choices.map((c) => c.descId);
    assert.ok(ids.includes('__skip_all__'), 'Skip all remaining should be offered for purely optional buckets');
  });

  it('restores Skip-all once the mandatory descriptor is consumed', () => {
    const game = {};
    const madness = mkDesc('madness:msg_x', 'Madness', { mandatory: true });
    const optional = mkDesc('vigor:msg_x', 'Vigor');
    started(game, [madness, optional]);
    // While Madness is pending -> suppressed.
    let ids = describeChooserPrompt(game.pendingSoaResolution, 'g1').choices.map((c) => c.descId);
    assert.ok(!ids.includes('__skip_all__'));
    // Resolve Madness -> only the optional one remains -> Skip-all reappears.
    consumeDescriptor(game, 'madness:msg_x');
    ids = describeChooserPrompt(game.pendingSoaResolution, 'g1').choices.map((c) => c.descId);
    assert.ok(ids.includes('vigor:msg_x'));
    assert.ok(ids.includes('__skip_all__'), 'Skip all remaining returns once no mandatory descriptors remain');
  });
});

function started(game, descriptors) {
  const ok = startSoaResolution(game, descriptors, 1, { activatorPlayerNum: 1, activatorMsgId: 'msg_x' });
  assert.ok(ok, 'startSoaResolution should arm a resolution');
}
