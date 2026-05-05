/**
 * Regression: reorderPlayAreaAfterCheckpointLoad must read p1DcList /
 * p2DcList (processed DCs with `dcName`), NOT player1Squad.dcList /
 * player2Squad.dcList (raw input — array of strings).
 *
 * 2026-05-04 incident: commit 48ef4ef shipped the helper reading from
 * the raw squad. The skip-check `if (!s.dc || !s.dc.dcName)` then fired
 * on every iteration (strings have no `.dcName`), the helper deleted
 * every DC + attachment + companion message from Discord, and re-posted
 * nothing. Live game state ended up with arrays of nulls for
 * p1/p2DcMessageIds, p1/p2DcAttachmentMessageIds,
 * p1/p2DcCompanionMessageIds and `{}` for p1/p2CcAttachments and
 * p1/p2DcAttachments. The integration test stubbed the helper as a
 * no-op so the bug shipped untested.
 *
 * This test exercises the actual function body with a stubbed Discord
 * channel that records sends + deletes. Any future "read from squad"
 * regression will fail here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reorderPlayAreaAfterCheckpointLoad } from '../../src/engine/setup-bridge.js';

function makeStubChannel(label) {
  const sent = [];
  const deleted = [];
  const channel = {
    label,
    send: async (payload) => {
      const id = `${label}_NEW_${sent.length}`;
      sent.push({ id, payload });
      return { id, edit: async () => {} };
    },
    messages: {
      fetch: async (id) => ({
        id,
        delete: async () => { deleted.push(id); },
      }),
    },
  };
  return { channel, sent, deleted };
}

function makeStubClient(p1Channel, p2Channel) {
  return {
    channels: {
      fetch: async (id) => (id === 'P1_AREA' ? p1Channel : id === 'P2_AREA' ? p2Channel : null),
      cache: new Map(),
    },
  };
}

function makeDeps({ dcMessageMeta, dcExhaustedState, dcHealthState }) {
  return {
    buildDcEmbedAndFiles: async (dcName, exhausted, displayName) => ({
      embed: { title: `${dcName}${exhausted ? ' (E)' : ''}` },
      files: [],
    }),
    getDcPlayAreaComponents: () => [],
    getNicknamesForDcMessage: () => null,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    updateAttachmentMessageForDc: async () => {},
    createCompanionDcEmbed: async () => null,
    remapMsgIdKeyedFields: () => {},
  };
}

describe('reorderPlayAreaAfterCheckpointLoad — re-post path runs to completion', () => {
  it('reads p1DcList / p2DcList (processed) and re-posts every DC card', async () => {
    const { channel: p1Channel, sent: p1Sent, deleted: p1Deleted } = makeStubChannel('P1');
    const { channel: p2Channel, sent: p2Sent, deleted: p2Deleted } = makeStubChannel('P2');
    const client = makeStubClient(p1Channel, p2Channel);

    const game = {
      gameId: '99999',
      p1PlayAreaId: 'P1_AREA',
      p2PlayAreaId: 'P2_AREA',
      // Raw squad: this is what reorder MUST NOT read. Strings only.
      player1Squad: { dcList: ['[Zillo Technique]', '[Cross Training]', 'Snowtrooper (Elite)'] },
      player2Squad: { dcList: ['[Black Market]', 'Baze Malbus'] },
      // Processed DC list — what reorder SHOULD read.
      p1DcList: [
        { dcName: 'Snowtrooper (Elite)', displayName: 'Snowtrooper (Elite)', healthState: [[7, 7], [7, 7], [7, 7]] },
        { dcName: 'Director Krennic',    displayName: 'Director Krennic',    healthState: [[7, 7]] },
      ],
      p2DcList: [
        { dcName: 'Baze Malbus', displayName: 'Baze Malbus', healthState: [[12, 12]] },
      ],
      p1DcMessageIds: ['OLD_P1_DC_0', 'OLD_P1_DC_1'],
      p2DcMessageIds: ['OLD_P2_DC_0'],
      p1DcAttachmentMessageIds: ['OLD_P1_ATT_0', null],
      p2DcAttachmentMessageIds: [null],
      p1DcCompanionMessageIds: [null, null],
      p2DcCompanionMessageIds: ['OLD_P2_COMP_0'],
      p1CcAttachments: { OLD_P1_DC_0: ['Cross Training'] },
      p2CcAttachments: { OLD_P2_DC_0: ['Black Market'] },
      p1DcAttachments: {},
      p2DcAttachments: {},
    };

    const dcMessageMeta = new Map();
    const dcExhaustedState = new Map();
    const dcHealthState = new Map();
    const deps = makeDeps({ dcMessageMeta, dcExhaustedState, dcHealthState });

    await reorderPlayAreaAfterCheckpointLoad(game, client, deps);

    // P1: 2 DCs in p1DcList → both re-posted, both msgIds populated.
    assert.equal(game.p1DcMessageIds.length, 2, 'p1DcMessageIds length must match p1DcList');
    assert.ok(game.p1DcMessageIds.every((id) => id !== null), 'every p1DcMessageId must be a real id, not null');
    // P2: 1 DC in p2DcList → 1 msgId populated.
    assert.equal(game.p2DcMessageIds.length, 1);
    assert.ok(game.p2DcMessageIds.every((id) => id !== null));
    // Side-channel maps populated for each new id.
    for (const id of game.p1DcMessageIds) {
      assert.ok(dcMessageMeta.has(id), `dcMessageMeta must include new id ${id}`);
      assert.ok(dcHealthState.has(id), `dcHealthState must include new id ${id}`);
    }
    // Old messages got deleted.
    assert.ok(p1Deleted.includes('OLD_P1_DC_0'));
    assert.ok(p1Deleted.includes('OLD_P1_DC_1'));
    assert.ok(p2Deleted.includes('OLD_P2_DC_0'));
    // CC attachment data re-keyed under NEW msgId (was the corruption mode —
    // the helper resets game.p1CcAttachments = {} before re-keying).
    assert.ok(
      game.p1CcAttachments[game.p1DcMessageIds[0]],
      'p1CcAttachments must be re-keyed under the new DC msgId for the DC that had attachments',
    );
  });

  it('skips when there are no attachments and no companions (DC-only play area)', async () => {
    const { channel: p1Channel, sent: p1Sent, deleted: p1Deleted } = makeStubChannel('P1');
    const { channel: p2Channel, sent: p2Sent, deleted: p2Deleted } = makeStubChannel('P2');
    const client = makeStubClient(p1Channel, p2Channel);

    const game = {
      gameId: '99999',
      p1PlayAreaId: 'P1_AREA',
      p2PlayAreaId: 'P2_AREA',
      p1DcList: [{ dcName: 'BT-1', displayName: 'BT-1', healthState: [[6, 6]] }],
      p2DcList: [{ dcName: 'C-3PO', displayName: 'C-3PO', healthState: [[3, 3]] }],
      p1DcMessageIds: ['EXISTING_P1_DC_0'],
      p2DcMessageIds: ['EXISTING_P2_DC_0'],
      p1DcAttachmentMessageIds: [null],
      p2DcAttachmentMessageIds: [null],
      p1DcCompanionMessageIds: [null],
      p2DcCompanionMessageIds: [null],
      p1CcAttachments: {},
      p2CcAttachments: {},
      p1DcAttachments: {},
      p2DcAttachments: {},
    };

    const deps = makeDeps({
      dcMessageMeta: new Map(), dcExhaustedState: new Map(), dcHealthState: new Map(),
    });
    await reorderPlayAreaAfterCheckpointLoad(game, client, deps);

    // No deletes, no sends — skip path preserves the fresh populatePlayAreas state.
    assert.equal(p1Deleted.length, 0);
    assert.equal(p1Sent.length, 0);
    assert.equal(p2Deleted.length, 0);
    assert.equal(p2Sent.length, 0);
    assert.deepEqual(game.p1DcMessageIds, ['EXISTING_P1_DC_0'], 'msgIds must be untouched on skip');
  });

  it('LATENT-REORDER-NULL-SOURCE: arrays must NOT end up all-null when re-post path runs', async () => {
    // Tripwire for the original bug shape. If reorder ever silently falls
    // through every snapshot to the null branch, this test catches it.
    const { channel: p1Channel } = makeStubChannel('P1');
    const { channel: p2Channel } = makeStubChannel('P2');
    const client = makeStubClient(p1Channel, p2Channel);

    const game = {
      gameId: '99999',
      p1PlayAreaId: 'P1_AREA',
      p2PlayAreaId: 'P2_AREA',
      // p1DcList correct shape; squad has the WRONG (string) shape that
      // would re-introduce the bug if anyone reverts the source field.
      player1Squad: { dcList: ['Snowtrooper (Elite)', 'Director Krennic'] },
      p1DcList: [
        { dcName: 'Snowtrooper (Elite)', displayName: 'Snowtrooper (Elite)', healthState: [[7, 7]] },
        { dcName: 'Director Krennic', displayName: 'Director Krennic', healthState: [[7, 7]] },
      ],
      p2DcList: [],
      p1DcMessageIds: ['OLD_0', 'OLD_1'],
      p2DcMessageIds: [],
      p1DcAttachmentMessageIds: ['OLD_ATT_0', null],
      p2DcAttachmentMessageIds: [],
      p1DcCompanionMessageIds: [null, null],
      p2DcCompanionMessageIds: [],
      p1CcAttachments: {},
      p2CcAttachments: {},
      p1DcAttachments: { OLD_0: ['Cross Training'] },
      p2DcAttachments: {},
    };

    const deps = makeDeps({
      dcMessageMeta: new Map(), dcExhaustedState: new Map(), dcHealthState: new Map(),
    });
    await reorderPlayAreaAfterCheckpointLoad(game, client, deps);

    const allNulls = game.p1DcMessageIds.every((id) => id === null);
    assert.ok(!allNulls,
      'p1DcMessageIds must not be ALL nulls after a populated p1DcList load — that was the live-game-corruption signature');
  });
});
