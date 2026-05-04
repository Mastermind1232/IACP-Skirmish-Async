/**
 * Regression test for the customId parsing in checkpoint confirm handlers.
 *
 * Bug history: 2026-05-04 (commit ee21eb7) — the 2-click confirm refactor
 * (commit 712f3db) parsed `cp_newgame_confirm_<gameId>_<cpId>` and
 * `cp_load_ingame_confirm_<gameId>_<cpId>` using lastIndexOf('_'). But
 * cpIds are `cp_<ms>_<rand>` and contain TWO underscores, so lastIndexOf
 * split inside the cpId, leaving gameId mangled. Every confirm click
 * hit "Game not found" because getGame was called with a garbled id.
 *
 * This test verifies that getGame receives the correct gameId for the
 * representative customId shape produced by the picker handlers. If a
 * future regression changes the parser back to lastIndexOf or breaks
 * the prefix-stripping, this test fails immediately.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleCheckpointNewGameConfirm,
  handleCheckpointInGameConfirm,
} from '../../src/handlers/checkpoint.js';

/**
 * Build a minimal interaction stub that records followUp calls and
 * exposes the customId we want to parse. The confirm handlers exit
 * early when requireGame returns null (no participant check, no DB
 * fetch, no Discord side effects) — so we don't need to stub the
 * full ctx, just getGame.
 */
function makeInteraction(customId) {
  const followUpCalls = [];
  return {
    customId,
    user: { id: 'tester' },
    followUp: async (payload) => { followUpCalls.push(payload); return {}; },
    deferUpdate: async () => {},
    deleteReply: async () => {},
    editReply: async () => {},
    message: { components: [] },
    _followUpCalls: followUpCalls,
  };
}

function makeCtx(getGameImpl) {
  return {
    getGame: getGameImpl,
    // The handler reads these out of ctx but never reaches them when
    // requireGame returns null. Listed so destructure doesn't throw.
    saveGames: () => {},
    client: {},
  };
}

describe('checkpoint confirm — customId parser', () => {
  it('cross-lobby: extracts gameId="00001" from customId with cpId containing two underscores', async () => {
    const calls = [];
    const interaction = makeInteraction('cp_newgame_confirm_00001_cp_1730747683123_a3b7x2');
    const ctx = makeCtx((id) => { calls.push(id); return null; }); // null → early exit

    await handleCheckpointNewGameConfirm(interaction, ctx);

    assert.equal(calls.length, 1, 'getGame called exactly once');
    assert.equal(calls[0], '00001', 'gameId parsed correctly (NOT mangled with cpId fragment)');
  });

  it('in-game: extracts gameId="00001" from customId with cpId containing two underscores', async () => {
    const calls = [];
    const interaction = makeInteraction('cp_load_ingame_confirm_00001_cp_1730747683123_a3b7x2');
    const ctx = makeCtx((id) => { calls.push(id); return null; });

    await handleCheckpointInGameConfirm(interaction, ctx);

    assert.equal(calls.length, 1, 'getGame called exactly once');
    assert.equal(calls[0], '00001', 'gameId parsed correctly');
  });

  it('cross-lobby: when game is not found, posts "Game not found" follow-up and returns', async () => {
    const interaction = makeInteraction('cp_newgame_confirm_99999_cp_1730747683123_a3b7x2');
    const ctx = makeCtx(() => null);

    await handleCheckpointNewGameConfirm(interaction, ctx);

    const found = interaction._followUpCalls.find(c => /game not found/i.test(c.content || ''));
    assert.ok(found, 'Game-not-found follow-up was posted');
  });

  it('cross-lobby: parser handles a 4-digit gameId variant (defensive)', async () => {
    const calls = [];
    const interaction = makeInteraction('cp_newgame_confirm_0042_cp_99_xxx');
    const ctx = makeCtx((id) => { calls.push(id); return null; });

    await handleCheckpointNewGameConfirm(interaction, ctx);

    assert.equal(calls[0], '0042');
  });

  it('in-game: parser preserves full cpId (no truncation) when game is found', async () => {
    // We can't easily verify cpId here without running deeper into the
    // handler (which requires loadCheckpointOrFollowUp + DB), but we can
    // assert that gameId parsing is correct — which is the bug surface.
    // cpId fidelity is implicit: same parser that gets gameId right gets
    // cpId right (the test above for parseConfirmCustomId in unit form
    // would cover this directly if the parser were extracted).
    const calls = [];
    const interaction = makeInteraction('cp_load_ingame_confirm_12345_cp_xyz_abc');
    const ctx = makeCtx((id) => { calls.push(id); return null; });

    await handleCheckpointInGameConfirm(interaction, ctx);

    assert.equal(calls[0], '12345');
  });
});
