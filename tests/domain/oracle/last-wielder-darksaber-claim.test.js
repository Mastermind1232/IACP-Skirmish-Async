/**
 * Behavioral oracles for Bo-Katan Kryze's **Last Wielder of the Darksaber**
 * start-of-round CLAIM mechanic (designer alexanbv 2026-06-21):
 *
 *   "Last Wielder of the Darksaber allows her to attach The Darksaber, and at
 *    the start of the round, if [The Darksaber is] attached to another figure,
 *    she may CLAIM the darksaber."
 *
 * Inclusion / initial-attach is handled at army-build time via the
 * `extendsAttachmentEligibility` field on `last_wielder_darksaber_bokatan`
 * (covered by last-wielder-darksaber-probe.test.js). These probes cover the
 * NEW start-of-round claim:
 *
 *   - round.js `_postLastWielderClaimPrompt` (detection / optional prompt)
 *   - interrupts.js `handleLastWielderDarksaber` (claim move + skip)
 *
 * The claim MOVES the "The Darksaber" attachment string off the source DC's
 * `p{N}DcAttachments` array and onto Bo-Katan's. The Darksaber is readied at
 * round start by the SU ready pass, so no exhaust handling is involved here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLastWielderDarksaber } from '../../../src/handlers/interrupts.js';
import { runStartOfRoundDcEffects } from '../../../src/handlers/round.js';
import { _registerDcMessageMeta } from '../../../src/game/activation-state.js';

const BO_MSG = 'm-bokatan';
const SRC_MSG = 'm-sabine';

/** Build a 1-player game: Bo-Katan + Sabine Wren, Darksaber on Sabine. */
function buildGame({ darksaberOn = 'sabine' } = {}) {
  const p1DcAttachments = {};
  if (darksaberOn === 'sabine') p1DcAttachments[SRC_MSG] = ['The Darksaber'];
  if (darksaberOn === 'bokatan') p1DcAttachments[BO_MSG] = ['The Darksaber'];
  const game = {
    gameId: 'g-lw',
    player1Id: 'p1',
    player2Id: 'p2',
    initiativePlayerNum: 1,
    p1DcList: [
      { dcName: 'Bo-Katan Kryze', displayName: 'Bo-Katan Kryze [Group 1]', defeated: false },
      { dcName: 'Sabine Wren', displayName: 'Sabine Wren [Group 1]', defeated: false },
    ],
    p1DcMessageIds: [BO_MSG, SRC_MSG],
    p1DcAttachments,
    p1CcAttachments: {},
    p1DcAttachmentMessageIds: [],
    p2DcList: [],
    p2DcMessageIds: [],
    p2DcAttachments: {},
    figurePositions: { 1: { 'Bo-Katan Kryze-1-0': 'A1', 'Sabine Wren-1-0': 'B1' }, 2: {} },
  };
  _registerDcMessageMeta(new Map([
    [BO_MSG, { gameId: 'g-lw', playerNum: 1, dcName: 'Bo-Katan Kryze', displayName: 'Bo-Katan Kryze [Group 1]' }],
    [SRC_MSG, { gameId: 'g-lw', playerNum: 1, dcName: 'Sabine Wren', displayName: 'Sabine Wren [Group 1]' }],
  ]));
  return game;
}

function _stubInteraction(customId, userId = 'p1') {
  const edits = [];
  return {
    interaction: {
      customId,
      user: { id: userId },
      message: { edit: async (p) => { edits.push(p); } },
      deferUpdate: async () => {},
      followUp: async () => {},
    },
    edits,
  };
}

function _stubCtx(game, interaction) {
  const refreshed = [];
  return {
    interaction,
    getGame: () => game,
    canActAsPlayer: (_g, uid, pn) => (pn === 1 ? uid === 'p1' : uid === 'p2'),
    saveGames: () => {},
    client: {},
    logGameAction: async () => {},
    updateAttachmentMessageForDc: async (_g, _pn, msgId) => { refreshed.push(msgId); },
    sendPhaseGateMessages: async () => {},
    _refreshed: refreshed,
  };
}

// ── start-of-round detection / prompt ───────────────────────────────────────

describe('LAST-WIELDER-CLAIM-PROMPT: detection at start of round', () => {
  async function runSor(game) {
    const logged = [];
    await runStartOfRoundDcEffects(game, game.gameId, {}, {
      logGameAction: async (_g, _c, msg, opts) => { logged.push({ msg, opts }); },
      updateHandChannelMessages: async () => {},
      checkWinConditions: async () => {},
    });
    return logged;
  }

  it('001: posts an optional Claim/Skip prompt when Darksaber is on ANOTHER of your DCs', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    const logged = await runSor(game);
    const lw = logged.find((l) => /Last Wielder of the Darksaber/.test(l.msg));
    assert.ok(lw, 'prompt posted');
    assert.ok(lw.opts?.components?.length, 'prompt has buttons');
    const ids = lw.opts.components.flatMap((r) => r.components.map((c) => c.data?.custom_id || c.customId));
    assert.ok(ids.some((id) => id.startsWith('last_wielder_claim_')), 'Claim button present');
    assert.ok(ids.some((id) => id.startsWith('last_wielder_skip_')), 'Skip button present');
    assert.ok(game.pendingStartOfRoundResolve >= 1, 'blocks activation until resolved');
  });

  it('002: NO prompt when Darksaber is already on Bo-Katan', async () => {
    const game = buildGame({ darksaberOn: 'bokatan' });
    const logged = await runSor(game);
    assert.equal(logged.find((l) => /Last Wielder of the Darksaber/.test(l.msg)), undefined);
  });

  it('003: NO prompt when Darksaber is not in play at all', async () => {
    const game = buildGame({ darksaberOn: 'none' });
    const logged = await runSor(game);
    assert.equal(logged.find((l) => /Last Wielder of the Darksaber/.test(l.msg)), undefined);
  });

  it('004: NO prompt when the source DC holding the Darksaber is defeated', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    game.p1DcList[1].defeated = true;
    const logged = await runSor(game);
    assert.equal(logged.find((l) => /Last Wielder of the Darksaber/.test(l.msg)), undefined);
  });
});

// ── claim button handler ────────────────────────────────────────────────────

describe('LAST-WIELDER-CLAIM-HANDLER: handleLastWielderDarksaber', () => {
  it('010: CLAIM moves the Darksaber from the source DC onto Bo-Katan', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    game.pendingStartOfRoundResolve = 1;
    const { interaction } = _stubInteraction(`last_wielder_claim_g-lw_1_${BO_MSG}_${SRC_MSG}`);
    const ctx = _stubCtx(game, interaction);

    await handleLastWielderDarksaber(interaction, ctx);

    assert.equal(game.p1DcAttachments[SRC_MSG], undefined, 'source array empty → key removed');
    assert.deepEqual(game.p1DcAttachments[BO_MSG], ['The Darksaber'], 'Darksaber now on Bo-Katan');
    assert.ok(ctx._refreshed.includes(SRC_MSG) && ctx._refreshed.includes(BO_MSG), 'both DC messages refreshed');
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'pending SoR resolved');
  });

  it('011: CLAIM preserves OTHER attachments on the source DC', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    game.p1DcAttachments[SRC_MSG] = ['Combat Coat', 'The Darksaber'];
    game.pendingStartOfRoundResolve = 1;
    const { interaction } = _stubInteraction(`last_wielder_claim_g-lw_1_${BO_MSG}_${SRC_MSG}`);
    const ctx = _stubCtx(game, interaction);

    await handleLastWielderDarksaber(interaction, ctx);

    assert.deepEqual(game.p1DcAttachments[SRC_MSG], ['Combat Coat'], 'unrelated attachment stays on source');
    assert.deepEqual(game.p1DcAttachments[BO_MSG], ['The Darksaber'], 'only the Darksaber moved');
  });

  it('012: SKIP leaves the Darksaber where it is', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    game.pendingStartOfRoundResolve = 1;
    const { interaction } = _stubInteraction(`last_wielder_skip_g-lw_1`);
    const ctx = _stubCtx(game, interaction);

    await handleLastWielderDarksaber(interaction, ctx);

    assert.deepEqual(game.p1DcAttachments[SRC_MSG], ['The Darksaber'], 'Darksaber unmoved');
    assert.equal(game.p1DcAttachments[BO_MSG], undefined, 'Bo-Katan did not gain it');
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'pending SoR still resolved');
  });

  it('013: only the owner may claim (wrong user rejected, no move)', async () => {
    const game = buildGame({ darksaberOn: 'sabine' });
    game.pendingStartOfRoundResolve = 1;
    const { interaction } = _stubInteraction(`last_wielder_claim_g-lw_1_${BO_MSG}_${SRC_MSG}`, 'p2');
    const ctx = _stubCtx(game, interaction);

    await handleLastWielderDarksaber(interaction, ctx);

    assert.deepEqual(game.p1DcAttachments[SRC_MSG], ['The Darksaber'], 'no move for non-owner');
    assert.equal(game.pendingStartOfRoundResolve, 1, 'pending NOT decremented for rejected click');
  });

  it('014: drift guard — claim is a no-op if Darksaber already on Bo-Katan', async () => {
    const game = buildGame({ darksaberOn: 'bokatan' });
    game.pendingStartOfRoundResolve = 1;
    const { interaction } = _stubInteraction(`last_wielder_claim_g-lw_1_${BO_MSG}_${SRC_MSG}`);
    const ctx = _stubCtx(game, interaction);

    await handleLastWielderDarksaber(interaction, ctx);

    assert.deepEqual(game.p1DcAttachments[BO_MSG], ['The Darksaber'], 'no duplication');
    assert.equal(game.pendingStartOfRoundResolve, undefined, 'pending still resolved (consumes the prompt)');
  });
});
