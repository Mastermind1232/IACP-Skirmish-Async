/**
 * Fake Discord Interaction for headless testing.
 * Captures all replies/followUps for later inspection.
 *
 * Provides enough Discord API surface for all handlers to run:
 *   - channel.messages.fetch(id) → returns a fake message with edit(), startThread()
 *   - message.startThread() → returns a fake thread channel with send()
 *   - channel.send() → returns a fake message
 *   - interaction.deferUpdate/followUp/editReply/reply → capture output
 */

let _globalMsgCounter = 0;

function createFakeMessage(id, channel) {
  const msg = {
    id,
    channel,
    content: '',
    embeds: [],
    components: [],
    attachments: new Map(),
    edit: async (payload) => {
      if (typeof payload === 'string') {
        msg.content = payload;
      } else {
        Object.assign(msg, payload);
      }
      return msg;
    },
    startThread: async (opts = {}) => {
      const threadId = `thread-${id}`;
      const thread = createFakeChannel(threadId);
      thread.name = opts.name || threadId;
      thread.isThread = () => true;
      thread.parent = channel;
      thread.parentId = channel.id;
      return thread;
    },
    delete: async () => {},
    react: async () => {},
    pin: async () => {},
    unpin: async () => {},
  };
  return msg;
}

export function createFakeChannel(channelId = 'fake-channel-1') {
  const sentMessages = [];
  const messageStore = new Map();

  const channel = {
    id: channelId,
    name: channelId,
    messages: {
      fetch: async (idOrOpts) => {
        // fetch(id) → single message; fetch() → Map of all
        if (typeof idOrOpts === 'string') {
          if (!messageStore.has(idOrOpts)) {
            // Auto-create missing messages so handlers don't crash
            const msg = createFakeMessage(idOrOpts, channel);
            messageStore.set(idOrOpts, msg);
          }
          return messageStore.get(idOrOpts);
        }
        return messageStore;
      },
    },
    send: async (payload) => {
      const id = `fake-msg-${++_globalMsgCounter}`;
      const msg = createFakeMessage(id, channel);
      if (typeof payload === 'string') {
        msg.content = payload;
      } else if (payload) {
        Object.assign(msg, payload);
      }
      messageStore.set(id, msg);
      sentMessages.push(msg);
      return msg;
    },
    bulkDelete: async () => {},
    _sentMessages: sentMessages,
    _messageStore: messageStore,
    isThread: () => false,
    isTextBased: () => true,
    delete: async () => {},
    parent: null,
    parentId: null,
    type: 0,
    guild: { id: 'fake-guild' },
  };

  return channel;
}

export function createFakeInteraction(customId, userId, options = {}) {
  const sentMessages = [];
  const channel = options.channel || createFakeChannel();

  const interaction = {
    customId,
    user: { id: userId, username: options.username || 'TestPlayer' },
    member: { id: userId },
    message: createFakeMessage(options.messageId || 'fake-msg', channel),
    channel,
    channelId: channel.id,
    guild: options.guild || {
      id: 'fake-guild',
      channels: { fetch: async () => channel },
      members: { fetch: async (id) => ({ id, displayName: `Player_${id}` }) },
    },
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
    update: async (payload) => {
      const msg = { type: 'update', ...(typeof payload === 'string' ? { content: payload } : payload) };
      sentMessages.push(msg);
      return msg;
    },
    showModal: async (modal) => {
      sentMessages.push({ type: 'showModal', ...modal });
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

    // Client reference (for handlers that use interaction.client.channels.fetch)
    client: options.client || null,

    // Captured output
    sentMessages,
  };

  return interaction;
}
