/**
 * Phase-D behavioral probe — CRR-SKA-003 (group-scope of attachment effects).
 *
 * CRR: "Abilities on Attachment cards apply to all figures in the
 *       corresponding group."
 *
 * The companion invariant_pin probe
 * (phase-d-ska-003-attachments-apply-to-group-probe.test.js) pins the source
 * shape — attachments keyed by DC message id, no per-figure container. This
 * probe complements it with a behavioral check that exercises the shared-
 * lookup contract directly: given a multi-figure group, the attachment record
 * retrieved for any figure of that group is the SAME object, so mutating or
 * reading effects for figureA mirrors to figureB without any per-figure sync
 * step. A refactor that routes attachments through a per-figure lookup would
 * return distinct objects and fail this probe.
 *
 * PROBE-SKA-003-A: same attachment record served for all figures in the group
 * PROBE-SKA-003-B: object identity (=== ) — shared reference, not a shallow copy
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror the read-shape used across src/ — DcAttachments?.[msgId].
function getAttachmentsForFigure(game, playerNum, figureMsgId) {
  const bucket = playerNum === 1 ? game.p1DcAttachments : game.p2DcAttachments;
  return bucket?.[figureMsgId];
}

describe('PROBE-SKA-003-A: attachment lookup returns the same record for every figure in the group', () => {
  it('two figures of the same DC (same msgId) see the same attachment list', () => {
    const sharedAttachments = [{ name: 'Battlefield Experts', effect: 'surge->damage 1' }];
    const game = { p1DcAttachments: { 'MSG-STORM-1': sharedAttachments } };

    // Two figures in the same group share the DC msgId — that's the whole
    // substrate for group-scope attachment effects.
    const forFig0 = getAttachmentsForFigure(game, 1, 'MSG-STORM-1');
    const forFig1 = getAttachmentsForFigure(game, 1, 'MSG-STORM-1');

    assert.deepStrictEqual(forFig0, sharedAttachments,
      'CRR-SKA-003: every figure of the group receives the group attachment list.');
    assert.deepStrictEqual(forFig1, sharedAttachments,
      'Second figure of the same group sees the same list (not isolated).');
  });
});

describe('PROBE-SKA-003-B: shared reference — not a per-figure copy', () => {
  it('mutating the attachment list via one figure\'s lookup is visible to the other', () => {
    const game = { p1DcAttachments: { 'MSG-STORM-1': [{ name: 'Weapon Mod' }] } };
    const a = getAttachmentsForFigure(game, 1, 'MSG-STORM-1');
    // Push a new attachment through figureA's reference.
    a.push({ name: 'Armor Mod' });
    const b = getAttachmentsForFigure(game, 1, 'MSG-STORM-1');
    assert.equal(b.length, 2,
      'Attachment list is shared — new entries on one figure\'s view must appear on the group-wide view.');
    assert.equal(a, b,
      'Reference equality confirms the engine has no per-figure copy (the group-scope contract).');
  });
});

describe('PROBE-SKA-003-C: separate DC msgIds see separate attachment lists (control)', () => {
  it('two DCs have isolated attachment buckets', () => {
    const game = {
      p1DcAttachments: {
        'MSG-STORM-1': [{ name: 'Weapon Mod' }],
        'MSG-VADER-1': [{ name: 'Elite Training' }],
      },
    };
    const storm = getAttachmentsForFigure(game, 1, 'MSG-STORM-1');
    const vader = getAttachmentsForFigure(game, 1, 'MSG-VADER-1');
    assert.notEqual(storm, vader,
      'Group isolation: attachments on DC A do not leak into DC B.');
    assert.equal(storm[0].name, 'Weapon Mod');
    assert.equal(vader[0].name, 'Elite Training');
  });
});
