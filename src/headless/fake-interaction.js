/**
 * Fake Discord Interaction for headless testing.
 * Captures all replies/followUps for later inspection.
 */

export function createFakeChannel(channelId = 'fake-channel-1') {
  const messages = [];
  return {
    id: channelId,
    messages: {
      fetch: async () => new Map(),
    },
    send: async (payload) => {
      const msg = { id: `fake-msg-${messages.length}`, ...payload, channel: null };
      messages.push(msg);
      return msg;
    },
    _sentMessages: messages,
    isThread: () => false,
    parent: null,
  };
}

export function createFakeInteraction(customId, userId, options = {}) {
  const sentMessages = [];
  const channel = options.channel || createFakeChannel();

  const interaction = {
    customId,
    user: { id: userId, username: options.username || 'TestPlayer' },
    member: { id: userId },
    message: {
      id: options.messageId || 'fake-msg',
      channel,
      content: '',
      embeds: [],
      components: [],
      edit: async (payload) => {
        sentMessages.push({ type: 'edit', ...payload });
        return interaction.message;
      },
    },
    channel,
    channelId: channel.id,
    guild: options.guild || { id: 'fake-guild', channels: { fetch: async () => channel } },
    values: options.values || [],
    fields: options.fields || { getTextInputValue: () => '' },

    // Interaction methods — capture instead of sending to Discord
    deferUpdate: async () => { sentMessages.push({ type: 'deferUpdate' }); },
    deferReply: async (opts) => { sentMessages.push({ type: 'deferReply', ...opts }); },
    followUp: async (payload) => {
      const msg = { type: 'followUp', ...(typeof payload === 'string' ? { content: payload } : payload) };
      sentMessages.push(msg);
      return msg;
    },
    editReply: async (payload) => {
      const msg = { type: 'editReply', ...(typeof payload === 'string' ? { content: payload } : payload) };
      sentMessages.push(msg);
      return msg;
    },
    reply: async (payload) => {
      const msg = { type: 'reply', ...(typeof payload === 'string' ? { content: payload } : payload) };
      sentMessages.push(msg);
      return msg;
    },

    // Type checks (pretend to be a button by default)
    isButton: () => options.type !== 'select' && options.type !== 'modal',
    isStringSelectMenu: () => options.type === 'select',
    isModalSubmit: () => options.type === 'modal',
    isChatInputCommand: () => false,
    isAutocomplete: () => false,

    // Options for slash commands
    options: {
      getInteger: () => null,
      getString: () => null,
      getUser: () => null,
      getSubcommand: () => null,
    },

    // Captured output
    sentMessages,
  };

  return interaction;
}
