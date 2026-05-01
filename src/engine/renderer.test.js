import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { renderHandThread, renderHandVisual, renderHandPayload } from './renderer.js';

/**
 * Mock Discord client. Tracks created threads + members. Supports forced-404
 * channels for the recovery branch.
 */
function makeMockClient({ knownChannels = {}, channels404 = new Set() } = {}) {
  const created = []; // [{ playerNum, threadId, parentId }]
  const memberAdds = []; // [{ threadId, memberId }]

  function makeThread(threadId, parent) {
    return {
      id: threadId,
      members: { add: async (memberId) => { memberAdds.push({ threadId, memberId }); } },
    };
  }

  let nextThreadCounter = 1;
  function makeChannel(channelId, isPlayArea = false) {
    if (!isPlayArea) return { id: channelId };
    // play-area channel: needs a threads.create method
    const guild = {
      roles: {
        cache: {
          find: () => null, // no Admin role by default; tests can override
        },
      },
    };
    return {
      id: channelId,
      guild,
      threads: {
        create: async () => {
          const tid = `thread${nextThreadCounter++}`;
          created.push({ parentId: channelId, threadId: tid });
          return makeThread(tid, channelId);
        },
      },
    };
  }

  const client = {
    channels: {
      fetch: async (id) => {
        if (channels404.has(id)) throw new Error('Discord 404');
        if (knownChannels[id]) return knownChannels[id];
        return null;
      },
    },
  };
  return { client, created, memberAdds, makeChannel };
}

describe('renderer.renderHandThread', () => {
  let mock;
  let game;

  beforeEach(() => {
    mock = makeMockClient();
    const playArea1 = mock.makeChannel('PLAY_AREA_1', true);
    const playArea2 = mock.makeChannel('PLAY_AREA_2', true);
    mock.client.channels.fetch = async (id) => {
      if (id === 'PLAY_AREA_1') return playArea1;
      if (id === 'PLAY_AREA_2') return playArea2;
      if (mock.client._extra?.[id]) return mock.client._extra[id];
      return null;
    };
    game = {
      gameId: '00001',
      player1Id: '11111111111111111',
      player2Id: '22222222222222222',
      p1PlayAreaId: 'PLAY_AREA_1',
      p2PlayAreaId: 'PLAY_AREA_2',
      p1HandId: null,
      p2HandId: null,
    };
  });

  it('creates a hand thread when none exists, stores id on game', async () => {
    const result = await renderHandThread(game, 1, mock.client);
    assert.equal(result.created, true);
    assert.ok(result.threadId);
    assert.equal(game.p1HandId, result.threadId);
    assert.equal(mock.created.length, 1);
    assert.equal(mock.created[0].parentId, 'PLAY_AREA_1');
  });

  it('adds the player to the new thread', async () => {
    await renderHandThread(game, 1, mock.client);
    const adds = mock.memberAdds.filter((a) => a.memberId === game.player1Id);
    assert.equal(adds.length, 1);
  });

  it('is idempotent: existing valid thread returns no-op', async () => {
    // Simulate: thread already exists and resolves on Discord
    game.p1HandId = 'EXISTING_THREAD';
    const existing = { id: 'EXISTING_THREAD' };
    mock.client._extra = { EXISTING_THREAD: existing };
    mock.client.channels.fetch = async (id) => {
      if (id === 'EXISTING_THREAD') return existing;
      if (id === 'PLAY_AREA_1') return mock.makeChannel('PLAY_AREA_1', true);
      return null;
    };
    const result = await renderHandThread(game, 1, mock.client);
    assert.equal(result.created, false);
    assert.equal(result.threadId, 'EXISTING_THREAD');
    assert.equal(game.p1HandId, 'EXISTING_THREAD');
    assert.equal(mock.created.length, 0);
  });

  it('falls through to recreate when existing thread 404s on Discord', async () => {
    game.p1HandId = 'STALE_THREAD';
    const playArea1 = mock.makeChannel('PLAY_AREA_1', true);
    mock.client.channels.fetch = async (id) => {
      if (id === 'STALE_THREAD') throw new Error('Discord 404');
      if (id === 'PLAY_AREA_1') return playArea1;
      return null;
    };
    const result = await renderHandThread(game, 1, mock.client);
    assert.equal(result.created, true);
    assert.notEqual(result.threadId, 'STALE_THREAD');
    assert.equal(game.p1HandId, result.threadId);
  });

  it('returns gracefully when play area channel is missing', async () => {
    game.p1PlayAreaId = null;
    const result = await renderHandThread(game, 1, mock.client);
    assert.equal(result.created, false);
    assert.equal(result.threadId, null);
    assert.equal(game.p1HandId, null);
  });

  it('skips player member-add when playerId is not a snowflake', async () => {
    game.player1Id = 'AI:Skirbo';
    await renderHandThread(game, 1, mock.client);
    const playerAdds = mock.memberAdds.filter((a) => a.memberId === 'AI:Skirbo');
    assert.equal(playerAdds.length, 0);
  });

  it('test games add Admin role members to the thread', async () => {
    game.isTestGame = true;
    const adminMembers = new Map([['admin1', {}], ['admin2', {}]]);
    const playArea1 = {
      id: 'PLAY_AREA_1',
      guild: {
        roles: {
          cache: {
            find: (fn) => {
              const role = { name: 'Admin', members: adminMembers };
              return fn(role) ? role : null;
            },
          },
        },
      },
      threads: {
        create: async () => ({
          id: 'thread_test',
          members: { add: async (memberId) => { mock.memberAdds.push({ threadId: 'thread_test', memberId }); } },
        }),
      },
    };
    mock.client.channels.fetch = async (id) => (id === 'PLAY_AREA_1' ? playArea1 : null);
    await renderHandThread(game, 1, mock.client);
    assert.ok(mock.memberAdds.some((a) => a.memberId === 'admin1'));
    assert.ok(mock.memberAdds.some((a) => a.memberId === 'admin2'));
  });

  it('competitive games (no isTestGame) do not add Admin members', async () => {
    game.isTestGame = false;
    const adminMembers = new Map([['admin1', {}]]);
    const playArea1 = {
      id: 'PLAY_AREA_1',
      guild: {
        roles: {
          cache: {
            find: (fn) => {
              const role = { name: 'Admin', members: adminMembers };
              return fn(role) ? role : null;
            },
          },
        },
      },
      threads: {
        create: async () => ({
          id: 'thread_comp',
          members: { add: async (memberId) => { mock.memberAdds.push({ threadId: 'thread_comp', memberId }); } },
        }),
      },
    };
    mock.client.channels.fetch = async (id) => (id === 'PLAY_AREA_1' ? playArea1 : null);
    await renderHandThread(game, 1, mock.client);
    assert.equal(mock.memberAdds.some((a) => a.memberId === 'admin1'), false);
  });
});

describe('renderer.renderHandVisual', () => {
  function makeChannelWithSendAndFetch() {
    const sent = [];
    const edited = [];
    const fetched = new Map();
    const channel = {
      send: async (payload) => {
        const id = `msg${sent.length + 1}`;
        const msg = {
          id,
          edit: async (p) => { edited.push({ id, payload: p }); },
        };
        fetched.set(id, msg);
        sent.push({ id, payload });
        return msg;
      },
      messages: {
        fetch: async (id) => {
          if (!fetched.has(id)) throw new Error('Discord 404');
          return fetched.get(id);
        },
      },
    };
    return { channel, sent, edited, fetched };
  }

  let game;
  let chA;
  let client;

  beforeEach(() => {
    chA = makeChannelWithSendAndFetch();
    client = {
      channels: {
        fetch: async (id) => (id === 'PLAY_AREA_1' ? chA.channel : null),
      },
    };
    game = {
      gameId: '00001',
      p1PlayAreaId: 'PLAY_AREA_1',
      p2PlayAreaId: 'PLAY_AREA_2',
      p1HandVisualMessageId: null,
      p2HandVisualMessageId: null,
      player1CcHand: ['Card A', 'Card B', 'Card C'],
      player2CcHand: [],
    };
  });

  it('posts a fresh hand-visual when msgId is null and stores the new id', async () => {
    const result = await renderHandVisual(game, 1, client);
    assert.equal(result.posted, true);
    assert.equal(result.edited, false);
    assert.ok(result.msgId);
    assert.equal(game.p1HandVisualMessageId, result.msgId);
    assert.equal(chA.sent.length, 1);
  });

  it('edits existing hand-visual when msgId is valid', async () => {
    // Post first to seed
    const first = await renderHandVisual(game, 1, client);
    chA.sent.length = 0;
    chA.edited.length = 0;
    // Hand size changes
    game.player1CcHand = ['only one'];
    const second = await renderHandVisual(game, 1, client);
    assert.equal(second.posted, false);
    assert.equal(second.edited, true);
    assert.equal(second.msgId, first.msgId);
    assert.equal(chA.sent.length, 0);
    assert.equal(chA.edited.length, 1);
  });

  it('falls through to post when stored msgId 404s on Discord', async () => {
    game.p1HandVisualMessageId = 'STALE_MSG';
    const result = await renderHandVisual(game, 1, client);
    assert.equal(result.posted, true);
    assert.equal(result.edited, false);
    assert.notEqual(result.msgId, 'STALE_MSG');
    assert.equal(game.p1HandVisualMessageId, result.msgId);
  });

  it('returns gracefully when play area is missing', async () => {
    game.p1PlayAreaId = null;
    const result = await renderHandVisual(game, 1, client);
    assert.equal(result.posted, false);
    assert.equal(result.edited, false);
    assert.equal(game.p1HandVisualMessageId, null);
  });

  it('handles empty hand (length 0)', async () => {
    game.player1CcHand = [];
    const result = await renderHandVisual(game, 1, client);
    assert.equal(result.posted, true);
    assert.ok(chA.sent[0].payload.embeds);
  });

  it('handles missing hand array (treats as empty)', async () => {
    delete game.player1CcHand;
    const result = await renderHandVisual(game, 1, client);
    assert.equal(result.posted, true);
  });
});

describe('renderer.renderHandPayload', () => {
  function makeThreadChannel() {
    const sent = [];
    const edited = [];
    const fetched = new Map();
    const channel = {
      send: async (payload) => {
        const id = `payload_msg${sent.length + 1}`;
        const msg = { id, edit: async (p) => { edited.push({ id, payload: p }); } };
        fetched.set(id, msg);
        sent.push({ id, payload });
        return msg;
      },
      messages: {
        fetch: async (id) => {
          if (!fetched.has(id)) throw new Error('Discord 404');
          return fetched.get(id);
        },
      },
    };
    return { channel, sent, edited, fetched };
  }

  let game;
  let thread;
  let client;

  beforeEach(() => {
    thread = makeThreadChannel();
    client = {
      channels: {
        fetch: async (id) => (id === 'HAND_THREAD_1' ? thread.channel : null),
      },
    };
    game = {
      gameId: '00001',
      p1HandId: 'HAND_THREAD_1',
      p2HandId: 'HAND_THREAD_2',
      p1HandMessageId: null,
      p2HandMessageId: null,
      player1CcHand: ['Card A', 'Card B'],
      player2CcHand: [],
      player1CcDeck: ['Deck 1', 'Deck 2'],
      player2CcDeck: [],
    };
  });

  it('posts payload into the hand thread when msgId is null, stores new id', async () => {
    const result = await renderHandPayload(game, 1, client);
    assert.equal(result.posted, true);
    assert.equal(result.edited, false);
    assert.ok(result.msgId);
    assert.equal(game.p1HandMessageId, result.msgId);
    assert.equal(thread.sent.length, 1);
  });

  it('edits existing payload when msgId is valid', async () => {
    const first = await renderHandPayload(game, 1, client);
    thread.sent.length = 0;
    thread.edited.length = 0;
    game.player1CcHand = ['Card C'];
    const second = await renderHandPayload(game, 1, client);
    assert.equal(second.posted, false);
    assert.equal(second.edited, true);
    assert.equal(second.msgId, first.msgId);
    assert.equal(thread.edited.length, 1);
  });

  it('falls through to post when stored msgId 404s', async () => {
    game.p1HandMessageId = 'STALE_PAYLOAD';
    const result = await renderHandPayload(game, 1, client);
    assert.equal(result.posted, true);
    assert.notEqual(result.msgId, 'STALE_PAYLOAD');
  });

  it('returns gracefully when hand thread is missing on game', async () => {
    game.p1HandId = null;
    const result = await renderHandPayload(game, 1, client);
    assert.equal(result.posted, false);
    assert.equal(result.edited, false);
  });

  it('returns gracefully when hand thread 404s on Discord', async () => {
    client.channels.fetch = async () => null;
    const result = await renderHandPayload(game, 1, client);
    assert.equal(result.posted, false);
    assert.equal(result.edited, false);
  });
});
