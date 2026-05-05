/**
 * Integration test for cross-lobby checkpoint load.
 *
 * Catches the bug class that has shipped repeatedly:
 *   - Today (commit 98bba29): remap ran AFTER attachment recreation loop,
 *     so lookups returned empty. All attachment embeds silently no-op'd.
 *   - Today (commit ee21eb7): customId parser used lastIndexOf, mangled
 *     gameId. Already covered by checkpoint-confirm-parser.test.js.
 *   - Earlier (commit 1d5a76b): lobbyIdentity overlay missing gameCategoryId,
 *     killgame in checkpoint-loaded games walked the wrong category.
 *   - Earlier (b8a92df, 4c5d97a): loader missing recreation loops entirely.
 *
 * Strategy: stub the file-system + Discord deps with recording wrappers,
 * call applyCheckpointToNewLobby with a realistic-shape game state, then
 * verify:
 *   1. Operation order — populatePlayAreas BEFORE remapMsgIdKeyedFields
 *      BEFORE updateAttachmentMessageForDc. Order regression = silent
 *      data loss.
 *   2. msgId-keyed state is correctly remapped (p1DcAttachments keys
 *      translate from saved-old to lobby-new IDs).
 *   3. lobbyIdentity overlay preserves every Discord ID (gameCategoryId
 *      especially — its absence caused killgame to silently fail).
 *   4. updateAttachmentMessageForDc IS called per DC after remap, so the
 *      reconciler sees correct keys and posts the embed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckpointToNewLobby, remapMsgIdKeyedFields } from '../../src/handlers/checkpoint.js';

// ── Test fixture: a saved game with attachments + companion + figures ──
function makeCheckpoint() {
  return {
    game_state: {
      gameId: 'OLD_GAME_ID',
      guildId: 'GUILD_OLD',
      gameCategoryId: 'CAT_OLD',
      generalId: 'GEN_OLD',
      chatId: 'CHAT_OLD',
      boardId: 'BOARD_OLD',
      player1Id: 'P1_USER_OLD',
      player2Id: 'P2_USER_OLD',
      p1HandId: 'P1HAND_OLD',
      p2HandId: 'P2HAND_OLD',
      p1PlayAreaId: 'P1PA_OLD',
      p2PlayAreaId: 'P2PA_OLD',
      achievementsChannelId: 'ACH_OLD',
      // Saved DC msgIds — keys to be translated
      p1DcMessageIds: ['DC1_OLD', 'DC2_OLD'],
      p2DcMessageIds: ['DC3_OLD'],
      // Attachments keyed by OLD msgIds — should be remapped to NEW
      p1DcAttachments: { 'DC1_OLD': ['Cross Training'], 'DC2_OLD': ['Lie in Ambush'] },
      p2DcAttachments: { 'DC3_OLD': ['Scavenged Walker'] },
      p1CcAttachments: { 'DC1_OLD': ['Bury the Hatchet'] },
      p2CcAttachments: {},
      p1DcList: [{ dcName: 'Trooper', healthState: [[5, 5]] }, { dcName: 'Officer', healthState: [[3, 3]] }],
      p2DcList: [{ dcName: 'Rebel', healthState: [[7, 7]] }],
      figurePositions: { 1: { 'Trooper-1-0': 'a1' }, 2: { 'Rebel-1-0': 'b2' } },
      currentRound: 2,
      phase: 'round_active',
    },
    game_version: 'irrelevant-mocked',
  };
}

// ── Build a "new lobby" game shell with new IDs ──
function makeNewLobbyShell() {
  return {
    gameId: 'NEW_GAME_ID',
    guildId: 'GUILD_NEW',
    gameCategoryId: 'CAT_NEW',
    generalId: 'GEN_NEW',
    chatId: 'CHAT_NEW',
    boardId: 'BOARD_NEW',
    player1Id: 'P1_USER_NEW',
    player2Id: 'P2_USER_NEW',
    p1HandId: 'P1HAND_NEW',
    p2HandId: 'P2HAND_NEW',
    p1PlayAreaId: 'P1PA_NEW',
    p2PlayAreaId: 'P2PA_NEW',
    achievementsChannelId: 'ACH_NEW',
  };
}

// ── Stubbed deps with operation logging ──
function makeStubDeps(callLog) {
  return {
    populatePlayAreas: async (game, _client, _opts) => {
      callLog.push('populatePlayAreas');
      // Simulate DC card posting: assign NEW msgIds
      game.p1DcMessageIds = ['DC1_NEW', 'DC2_NEW'];
      game.p2DcMessageIds = ['DC3_NEW'];
      game.p1DcAttachmentMessageIds = [null, null];
      game.p2DcAttachmentMessageIds = [null];
    },
    sendRoundActivationPhaseMessage: async () => { callLog.push('sendRoundActivationPhaseMessage'); },
    saveGames: () => { callLog.push('saveGames'); },
    refreshAllGameComponents: async () => { callLog.push('refreshAllGameComponents'); },
    updateAttachmentMessageForDc: async (game, playerNum, dcMsgId) => {
      callLog.push(`updateAttachmentMessageForDc:${playerNum}:${dcMsgId}`);
      // Simulate posting the embed: write a NEW msgId into the array
      const arrKey = playerNum === 1 ? 'p1DcAttachmentMessageIds' : 'p2DcAttachmentMessageIds';
      const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const idx = dcMsgIds.indexOf(dcMsgId);
      if (idx < 0) return;
      const ccAtts = (playerNum === 1 ? game.p1CcAttachments : game.p2CcAttachments)[dcMsgId] || [];
      const dcAtts = (playerNum === 1 ? game.p1DcAttachments : game.p2DcAttachments)[dcMsgId] || [];
      const hasContent = ccAtts.length > 0 || dcAtts.length > 0;
      if (hasContent) game[arrKey][idx] = `ATT_MSG_${dcMsgId}`;
    },
    createCompanionDcEmbed: async () => { callLog.push('createCompanionDcEmbed'); },
    buildDcEmbedAndFiles: async () => ({ embed: {}, files: [] }),
    dcMessageMeta: new Map(),
    dcExhaustedState: new Map(),
    dcHealthState: new Map(),
    getDcPlayAreaComponents: () => [],
    getNicknamesForDcMessage: () => null,
    buildBoardMapPayload: async () => { callLog.push('buildBoardMapPayload'); return { content: '' }; },
    reorderPlayAreaAfterCheckpointLoad: async () => { callLog.push('reorderPlayAreaAfterCheckpointLoad'); },
  };
}

// Stub Discord client — only `channels.fetch` paths matter; return a stub channel.
function makeStubClient() {
  const stubChannel = {
    send: async () => ({ id: 'STUB_MSG' }),
    messages: { fetch: async () => ({ delete: async () => {}, edit: async () => {} }) },
  };
  return {
    channels: { fetch: async () => stubChannel, cache: new Map() },
  };
}

// ── Tests ──

describe('remapMsgIdKeyedFields — translate msgId-keyed state across cross-lobby load', () => {
  it('translates p1DcAttachments keys from old → new', () => {
    const game = {
      p1DcMessageIds: ['NEW1', 'NEW2'],
      p2DcMessageIds: ['NEW3'],
      p1DcAttachments: { 'OLD1': ['a'], 'OLD2': ['b'] },
      p2DcAttachments: { 'OLD3': ['c'] },
    };
    remapMsgIdKeyedFields(game, ['OLD1', 'OLD2'], ['OLD3']);
    assert.deepEqual(game.p1DcAttachments, { 'NEW1': ['a'], 'NEW2': ['b'] });
    assert.deepEqual(game.p2DcAttachments, { 'NEW3': ['c'] });
  });

  it('translates compound keys (msgId_suffix)', () => {
    const game = {
      p1DcMessageIds: ['NEW1'],
      p2DcMessageIds: [],
      roundFigureAbilityUsed: { 'OLD1_lieinambush': true, 'OLD1_overdrive': true },
    };
    remapMsgIdKeyedFields(game, ['OLD1'], []);
    assert.deepEqual(game.roundFigureAbilityUsed, { 'NEW1_lieinambush': true, 'NEW1_overdrive': true });
  });

  it('translates dcFinishedPinged (recently added to MSGID_FLAGS)', () => {
    const game = {
      p1DcMessageIds: ['NEW1'],
      p2DcMessageIds: [],
      dcFinishedPinged: { 'OLD1': true },
    };
    remapMsgIdKeyedFields(game, ['OLD1'], []);
    assert.deepEqual(game.dcFinishedPinged, { 'NEW1': true });
  });

  it('handles missing remap entry gracefully (key stays as-is, no crash)', () => {
    const game = {
      p1DcMessageIds: ['NEW1'],
      p2DcMessageIds: [],
      p1DcAttachments: { 'OLD1': ['a'], 'UNKNOWN': ['b'] },
    };
    remapMsgIdKeyedFields(game, ['OLD1'], []);
    assert.deepEqual(game.p1DcAttachments, { 'NEW1': ['a'], 'UNKNOWN': ['b'] });
  });
});

describe('applyCheckpointToNewLobby — execution order + state migration', () => {
  it('runs populatePlayAreas BEFORE attachment recreation loop (ordering invariant)', async () => {
    const callLog = [];
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps(callLog);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    const populateIdx = callLog.indexOf('populatePlayAreas');
    const firstAttachIdx = callLog.findIndex(c => c.startsWith('updateAttachmentMessageForDc'));
    assert.ok(populateIdx >= 0, 'populatePlayAreas was called');
    assert.ok(firstAttachIdx >= 0, 'updateAttachmentMessageForDc was called');
    assert.ok(populateIdx < firstAttachIdx, 'populatePlayAreas runs BEFORE attachment loop');
  });

  it('updateAttachmentMessageForDc sees REMAPPED keys and posts embeds for DCs with attachments', async () => {
    const callLog = [];
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps(callLog);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    // Saved game had attachments on DC1, DC2, DC3 (old msgIds). After load,
    // those should be remapped to NEW msgIds and the loop should post embeds.
    assert.deepEqual(newGame.p1DcAttachmentMessageIds, ['ATT_MSG_DC1_NEW', 'ATT_MSG_DC2_NEW'],
      'P1 attachment embeds posted for both DCs');
    assert.deepEqual(newGame.p2DcAttachmentMessageIds, ['ATT_MSG_DC3_NEW'],
      'P2 attachment embed posted');
  });

  it('p1/p2DcAttachments keys are translated to NEW msgIds (post-remap)', async () => {
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps([]);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    assert.deepEqual(Object.keys(newGame.p1DcAttachments).sort(), ['DC1_NEW', 'DC2_NEW']);
    assert.deepEqual(Object.keys(newGame.p2DcAttachments), ['DC3_NEW']);
    // Values should be unchanged
    assert.deepEqual(newGame.p1DcAttachments['DC1_NEW'], ['Cross Training']);
    assert.deepEqual(newGame.p2DcAttachments['DC3_NEW'], ['Scavenged Walker']);
  });

  it('lobbyIdentity overlay preserves new-lobby Discord IDs (gameCategoryId, generalId, etc.)', async () => {
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps([]);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    assert.equal(newGame.gameId, 'NEW_GAME_ID', 'gameId preserved');
    assert.equal(newGame.gameCategoryId, 'CAT_NEW', 'gameCategoryId preserved (killgame regression)');
    assert.equal(newGame.guildId, 'GUILD_NEW', 'guildId preserved');
    assert.equal(newGame.generalId, 'GEN_NEW', 'generalId preserved');
    assert.equal(newGame.chatId, 'CHAT_NEW', 'chatId preserved');
    assert.equal(newGame.boardId, 'BOARD_NEW', 'boardId preserved');
    assert.equal(newGame.player1Id, 'P1_USER_NEW', 'player1Id preserved');
    assert.equal(newGame.player2Id, 'P2_USER_NEW', 'player2Id preserved');
    assert.equal(newGame.p1HandId, 'P1HAND_NEW', 'p1HandId preserved');
    assert.equal(newGame.p1PlayAreaId, 'P1PA_NEW', 'p1PlayAreaId preserved');
    assert.equal(newGame.achievementsChannelId, 'ACH_NEW', 'achievementsChannelId preserved');
  });

  it('saved game state (figurePositions, currentRound) is restored', async () => {
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps([]);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    assert.deepEqual(newGame.figurePositions, { 1: { 'Trooper-1-0': 'a1' }, 2: { 'Rebel-1-0': 'b2' } });
    assert.equal(newGame.currentRound, 2);
    assert.equal(newGame.phase, 'round_active');
  });

  it('refreshAllGameComponents runs LAST (after recreation loops)', async () => {
    const callLog = [];
    const newGame = makeNewLobbyShell();
    const checkpoint = makeCheckpoint();
    const deps = makeStubDeps(callLog);
    const client = makeStubClient();

    await applyCheckpointToNewLobby(newGame, checkpoint, client, deps);

    const refreshIdx = callLog.indexOf('refreshAllGameComponents');
    const lastAttachIdx = callLog.findLastIndex(c => c.startsWith('updateAttachmentMessageForDc'));
    assert.ok(refreshIdx >= 0, 'refreshAllGameComponents was called');
    assert.ok(refreshIdx > lastAttachIdx, 'refreshAllGameComponents runs after attachment loop');
  });
});
