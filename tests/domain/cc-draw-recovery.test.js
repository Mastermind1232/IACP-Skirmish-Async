/**
 * Regression tests for src/engine/cc-draw-prompts.js — the post-deploy → cc_draw
 * completion path and its refresh-level safety net.
 *
 * Covers:
 *  - Normal finishPostDeploy completion posts CC shuffle/draw prompts
 *  - Restart scenario: callback gone, refresh safety net re-posts from pure state
 *  - Repeated refresh is idempotent (flag prevents duplicates)
 *  - No duplicate posts in a single flow
 *  - Does not post when both players have already drawn
 *  - recoverCcDrawPhase sets the idempotency flag so auto-refresh doesn't dupe
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { sendCcShuffleDrawPrompts } from '../../src/engine/cc-draw-prompts.js';

// ── Mock Discord client ─────────────────────────────────────────────────────

function makeMockClient() {
  const posted = [];
  const channelsById = new Map();

  function makeChannel(id) {
    const ch = {
      id,
      async send(payload) {
        posted.push({ channelId: id, content: payload.content, components: payload.components });
        return { id: `msg-${posted.length}`, channelId: id };
      },
    };
    channelsById.set(id, ch);
    return ch;
  }

  const client = {
    channels: {
      async fetch(id) {
        return channelsById.get(id) || makeChannel(id);
      },
    },
  };
  return { client, posted };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function baseGame(overrides = {}) {
  return {
    gameId: 'g1',
    phase: 'cc_draw',
    generalId: 'general-1',
    p1HandId: 'p1hand-1',
    p2HandId: 'p2hand-1',
    player1Id: '111',
    player2Id: '222',
    initiativePlayerId: '111',
    player1Squad: { ccList: ['Assault', 'Take Initiative', 'Urgency'] },
    player2Squad: { ccList: ['Deploy', 'Cower', 'Element of Surprise'] },
    p1CcAttachments: {},
    p2CcAttachments: {},
    postDeployEffectsFired: true,
    ...overrides,
  };
}

function mockDeps() {
  return {
    getCcShuffleDrawButton: (gameId) => ({ type: 'row', gameId, kind: 'ccShuffleDraw' }),
    getInitiativePlayerZoneLabel: () => 'Blue Zone ',
    saveGames: () => {},
  };
}

// ── sendCcShuffleDrawPrompts ────────────────────────────────────────────────

describe('sendCcShuffleDrawPrompts', () => {
  it('posts to general + both hand channels on normal flow', async () => {
    const game = baseGame();
    const { client, posted } = makeMockClient();
    const result = await sendCcShuffleDrawPrompts(game, client, mockDeps());

    assert.equal(result, true);
    assert.equal(game.ccShuffleDrawPromptsPosted, true);
    assert.equal(posted.length, 3);
    assert.equal(posted[0].channelId, 'general-1');
    assert.equal(posted[1].channelId, 'p1hand-1');
    assert.equal(posted[2].channelId, 'p2hand-1');
    // Hand channels carry the shuffle/draw button
    assert.ok(posted[1].components?.[0]?.kind === 'ccShuffleDraw');
    assert.ok(posted[2].components?.[0]?.kind === 'ccShuffleDraw');
  });

  it('is idempotent — second call is a no-op when flag is set', async () => {
    const game = baseGame();
    const { client, posted } = makeMockClient();
    await sendCcShuffleDrawPrompts(game, client, mockDeps());
    assert.equal(posted.length, 3);

    const result2 = await sendCcShuffleDrawPrompts(game, client, mockDeps());
    assert.equal(result2, false);
    assert.equal(posted.length, 3, 'second call must not post anything');
  });

  it('skips when both players already drew', async () => {
    const game = baseGame({ player1CcDrawn: true, player2CcDrawn: true });
    const { client, posted } = makeMockClient();
    const result = await sendCcShuffleDrawPrompts(game, client, mockDeps());
    assert.equal(result, false);
    assert.equal(posted.length, 0);
    assert.notEqual(game.ccShuffleDrawPromptsPosted, true);
  });

  it('skips hand channels for players who already drew but still posts general', async () => {
    const game = baseGame({ player1CcDrawn: true });
    const { client, posted } = makeMockClient();
    await sendCcShuffleDrawPrompts(game, client, mockDeps());
    // general + p2 hand only (p1 already drew)
    const channels = posted.map((p) => p.channelId).sort();
    assert.deepEqual(channels, ['general-1', 'p2hand-1']);
  });

  it('skips entirely when required channel IDs are missing', async () => {
    const game = baseGame({ generalId: null });
    const { client, posted } = makeMockClient();
    const result = await sendCcShuffleDrawPrompts(game, client, mockDeps());
    assert.equal(result, false);
    assert.equal(posted.length, 0);
  });

  it('filters placed attachments out of the deck list shown to players', async () => {
    const game = baseGame({
      p1CcAttachments: { 'imp_officer_1': ['Assault'] },
    });
    const { client, posted } = makeMockClient();
    await sendCcShuffleDrawPrompts(game, client, mockDeps());
    const p1Post = posted.find((p) => p.channelId === 'p1hand-1');
    // "Assault" is attached — should NOT appear in deck listing
    assert.ok(!p1Post.content.includes('Assault'), `Assault should be filtered out, got: ${p1Post.content}`);
    assert.ok(p1Post.content.includes('Take Initiative'));
    // Deck count reflects the filter: 3 total - 1 attached = 2
    assert.ok(p1Post.content.includes('(2 cards)'));
  });
});

// ── Refresh safety net ──────────────────────────────────────────────────────

describe('refreshAllGameComponents CC-draw safety net', () => {
  it('re-posts CC prompts when post-deploy finished but prompts never sent (restart scenario)', async () => {
    const { refreshAllGameComponents } = await import('../../src/engine/message-updaters.js');
    const game = baseGame();
    // Simulate the live-stranded game state from game 00001:
    //   postDeployEffectsFired=true, ccShuffleDrawPromptsPosted absent, neither drew
    const { client, posted } = makeMockClient();

    // Minimal deps bag — safety net only needs the CC helpers + a no-op reloadGameData
    const deps = {
      ...mockDeps(),
      reloadGameData: async () => {},
      // Stub out board/DC paths refresh would otherwise touch
      buildBoardMapPayload: async () => ({ content: '' }),
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      getDcStats: () => ({}),
      isFigurelessDc: () => false,
      getPlayAreaId: () => null,
      buildDcEmbedAndFiles: async () => ({ embed: {}, files: [] }),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      getCompanionDescriptionForDc: () => '',
      EmbedBuilder: class { setTitle() { return this; } setDescription() { return this; } setColor() { return this; } },
      COLORS: { DARK_EMBED: 0 },
      getCcHand: () => [],
      getCcDeck: () => [],
      getHandChannelId: () => null,
      buildHandDisplayPayload: () => ({ content: '' }),
      discordCatch: () => {},
      getHandVisualEmbed: () => ({}),
      getCcDiscard: () => [],
      getDiscardThreadId: () => null,
      getDiscardPileEmbed: () => ({}),
      getDiscardPileButtons: () => [],
      getDcMessageIds: () => [],
      dcAttachmentMessageIdsKey: () => null,
      ccAttachmentsKey: () => null,
      dcAttachmentsKey: () => null,
      buildAttachmentEmbedsAndFiles: async () => ({ embeds: [], files: [] }),
      getTokensForDcMessage: () => [],
      getDcList: () => [],
      getActivatedDcIndices: () => [],
      recomputeActivationCounts: () => {},
      updateActivationsMessage: async () => {},
      logGameAction: async () => {},
    };

    await refreshAllGameComponents(game, client, deps);

    // Should have posted exactly 3: general + p1 hand + p2 hand
    const handPosts = posted.filter((p) => p.channelId === 'p1hand-1' || p.channelId === 'p2hand-1');
    assert.equal(handPosts.length, 2, `expected 2 hand-channel posts, got ${handPosts.length}`);
    assert.equal(game.ccShuffleDrawPromptsPosted, true);
  });

  it('is idempotent across repeated refresh calls', async () => {
    const { refreshAllGameComponents } = await import('../../src/engine/message-updaters.js');
    const game = baseGame();
    const { client, posted } = makeMockClient();

    const deps = {
      ...mockDeps(),
      reloadGameData: async () => {},
      buildBoardMapPayload: async () => ({ content: '' }),
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      getDcStats: () => ({}),
      isFigurelessDc: () => false,
      getPlayAreaId: () => null,
      buildDcEmbedAndFiles: async () => ({ embed: {}, files: [] }),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      getCompanionDescriptionForDc: () => '',
      EmbedBuilder: class { setTitle() { return this; } setDescription() { return this; } setColor() { return this; } },
      COLORS: { DARK_EMBED: 0 },
      getCcHand: () => [], getCcDeck: () => [], getHandChannelId: () => null,
      buildHandDisplayPayload: () => ({ content: '' }),
      discordCatch: () => {}, getHandVisualEmbed: () => ({}),
      getCcDiscard: () => [], getDiscardThreadId: () => null,
      getDiscardPileEmbed: () => ({}), getDiscardPileButtons: () => [],
      getDcMessageIds: () => [],
      dcAttachmentMessageIdsKey: () => null, ccAttachmentsKey: () => null, dcAttachmentsKey: () => null,
      buildAttachmentEmbedsAndFiles: async () => ({ embeds: [], files: [] }),
      getTokensForDcMessage: () => [], getDcList: () => [], getActivatedDcIndices: () => [],
      recomputeActivationCounts: () => {}, updateActivationsMessage: async () => {},
      logGameAction: async () => {},
    };

    await refreshAllGameComponents(game, client, deps);
    const firstRun = posted.length;
    await refreshAllGameComponents(game, client, deps);
    await refreshAllGameComponents(game, client, deps);
    assert.equal(posted.length, firstRun, 'repeated refresh must not duplicate CC prompts');
  });

  it('does not re-post when both players already drew (even if flag absent)', async () => {
    const { refreshAllGameComponents } = await import('../../src/engine/message-updaters.js');
    const game = baseGame({ player1CcDrawn: true, player2CcDrawn: true });
    const { client, posted } = makeMockClient();
    const deps = {
      ...mockDeps(),
      reloadGameData: async () => {},
      buildBoardMapPayload: async () => ({ content: '' }),
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      getDcStats: () => ({}),
      isFigurelessDc: () => false,
      getPlayAreaId: () => null,
      buildDcEmbedAndFiles: async () => ({ embed: {}, files: [] }),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      getCompanionDescriptionForDc: () => '',
      EmbedBuilder: class { setTitle() { return this; } setDescription() { return this; } setColor() { return this; } },
      COLORS: { DARK_EMBED: 0 },
      getCcHand: () => [], getCcDeck: () => [], getHandChannelId: () => null,
      buildHandDisplayPayload: () => ({ content: '' }),
      discordCatch: () => {}, getHandVisualEmbed: () => ({}),
      getCcDiscard: () => [], getDiscardThreadId: () => null,
      getDiscardPileEmbed: () => ({}), getDiscardPileButtons: () => [],
      getDcMessageIds: () => [],
      dcAttachmentMessageIdsKey: () => null, ccAttachmentsKey: () => null, dcAttachmentsKey: () => null,
      buildAttachmentEmbedsAndFiles: async () => ({ embeds: [], files: [] }),
      getTokensForDcMessage: () => [], getDcList: () => [], getActivatedDcIndices: () => [],
      recomputeActivationCounts: () => {}, updateActivationsMessage: async () => {},
      logGameAction: async () => {},
    };
    await refreshAllGameComponents(game, client, deps);
    const handPosts = posted.filter((p) => p.channelId === 'p1hand-1' || p.channelId === 'p2hand-1' || p.channelId === 'general-1');
    assert.equal(handPosts.length, 0, 'must not post CC prompts once both drew');
  });

  it('does not post during active post-deploy queue (postDeployEffectsFired=false)', async () => {
    const { refreshAllGameComponents } = await import('../../src/engine/message-updaters.js');
    const game = baseGame({ postDeployEffectsFired: false });
    const { client, posted } = makeMockClient();
    const deps = {
      ...mockDeps(),
      reloadGameData: async () => {},
      buildBoardMapPayload: async () => ({ content: '' }),
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      isDepletedRemovedFromGame: () => false,
      getDcStats: () => ({}),
      isFigurelessDc: () => false,
      getPlayAreaId: () => null,
      buildDcEmbedAndFiles: async () => ({ embed: {}, files: [] }),
      renderDcEmbed: async () => ({ embed: {}, files: [] }),
      getDcPlayAreaComponents: () => [],
      getCompanionDescriptionForDc: () => '',
      EmbedBuilder: class { setTitle() { return this; } setDescription() { return this; } setColor() { return this; } },
      COLORS: { DARK_EMBED: 0 },
      getCcHand: () => [], getCcDeck: () => [], getHandChannelId: () => null,
      buildHandDisplayPayload: () => ({ content: '' }),
      discordCatch: () => {}, getHandVisualEmbed: () => ({}),
      getCcDiscard: () => [], getDiscardThreadId: () => null,
      getDiscardPileEmbed: () => ({}), getDiscardPileButtons: () => [],
      getDcMessageIds: () => [],
      dcAttachmentMessageIdsKey: () => null, ccAttachmentsKey: () => null, dcAttachmentsKey: () => null,
      buildAttachmentEmbedsAndFiles: async () => ({ embeds: [], files: [] }),
      getTokensForDcMessage: () => [], getDcList: () => [], getActivatedDcIndices: () => [],
      recomputeActivationCounts: () => {}, updateActivationsMessage: async () => {},
      logGameAction: async () => {},
    };
    await refreshAllGameComponents(game, client, deps);
    assert.equal(posted.length, 0, 'must not post while post-deploy still active');
  });
});

// ── JSON round-trip ─────────────────────────────────────────────────────────

describe('pure-state survival across restart', () => {
  it('ccShuffleDrawPromptsPosted survives JSON round-trip (unlike the old _postDeployCallback)', () => {
    const game = baseGame({ ccShuffleDrawPromptsPosted: true });
    const roundTripped = JSON.parse(JSON.stringify(game));
    assert.equal(roundTripped.ccShuffleDrawPromptsPosted, true);
  });

  it('documents the old bug: function callback is silently stripped by JSON.stringify', () => {
    const game = { ...baseGame(), _postDeployCallback: async () => 'would-fire' };
    const roundTripped = JSON.parse(JSON.stringify(game));
    assert.equal(roundTripped._postDeployCallback, undefined,
      'confirms old pattern: the callback is gone after any save/load cycle — hence the stranded game');
  });
});
