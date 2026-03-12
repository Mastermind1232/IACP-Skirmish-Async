/**
 * Fake Discord Client for headless testing.
 * All channel/message operations are captured in memory.
 */

import { createFakeChannel } from './fake-interaction.js';

export function createFakeClient() {
  const sentMessages = [];
  const channelCache = new Map();

  function getOrCreateChannel(id) {
    if (!channelCache.has(id)) {
      const ch = createFakeChannel(id);
      // Override send to also capture in client-level log
      const origSend = ch.send;
      ch.send = async (payload) => {
        const msg = await origSend(payload);
        sentMessages.push({ channelId: id, ...msg });
        return msg;
      };
      channelCache.set(id, ch);
    }
    return channelCache.get(id);
  }

  return {
    channels: {
      fetch: async (id) => getOrCreateChannel(id),
      cache: channelCache,
    },
    users: {
      fetch: async (id) => ({ id, username: `Player_${id}`, displayName: `Player_${id}` }),
    },
    user: { id: 'fake-bot-id' },

    // Captured output
    _sentMessages: sentMessages,
    _channelCache: channelCache,
  };
}
