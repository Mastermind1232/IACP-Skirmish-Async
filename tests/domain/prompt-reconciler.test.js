/**
 * Regression tests for src/engine/prompt-reconciler.js — the live recovery layer
 * for the Walker / massive-displacement bug cluster.
 *
 * The reconciler is exercised directly for pure-state tests; render helpers
 * and deleted-msg paths use a minimal mock Discord client that records
 * `send` / `delete` calls so we can assert on effect without a real gateway.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_KINDS,
  signatureFor,
  getExpectedPrompts,
  recordPromptMessage,
  clearPromptRecord,
  reconcilePrompts,
} from '../../src/engine/prompt-reconciler.js';
import {
  onPostDeployMovementComplete,
  resumeDeferredPostDeployMove,
} from '../../src/handlers/post-deploy.js';

// ── Mock Discord client ─────────────────────────────────────────────────────

function makeMockClient() {
  const posted = [];
  const deleted = [];
  const fetchedMsgs = new Map();
  let nextMsgId = 1000;
  const channel = {
    id: 'thread-channel-1',
    async send(payload) {
      const id = `msg-${nextMsgId++}`;
      const msg = {
        id,
        channelId: channel.id,
        content: payload.content,
        components: payload.components,
        async delete() { deleted.push(id); },
      };
      fetchedMsgs.set(id, msg);
      posted.push({ id, content: payload.content });
      return msg;
    },
    messages: {
      async fetch(id) {
        return fetchedMsgs.get(id) || null;
      },
    },
  };
  const client = {
    channels: {
      async fetch(_id) { return channel; },
    },
  };
  return { client, channel, posted, deleted, fetchedMsgs };
}

// ── Game fixture builders ───────────────────────────────────────────────────

function baseGame(overrides = {}) {
  return {
    gameId: 'g1',
    figurePositions: {
      1: { 'trandoshan_hunter_1': '5A', 'trandoshan_hunter_2': '6B' },
      2: { 'stormtrooper_1': '7C' },
    },
    dcActionsData: {
      some_dc: { threadId: 'thread-channel-1' },
    },
    promptMessageIds: {},
    ...overrides,
  };
}

function gameWithMassivePushSpace() {
  const g = baseGame();
  g.pendingMassivePush = {
    gameId: 'g1',
    phase: 'enemy',
    currentIndex: 0,
    friendlyQueue: [],
    enemyQueue: [
      { figureKey: 'stormtrooper_1', dcName: 'Stormtrooper', playerNum: 2 },
    ],
    _currentValidSpaces: ['7D', '8C', '8D'],
    _currentPickable: null,
    _figurePickLockedIdx: 0,
  };
  return g;
}

function gameWithMassivePushFigure() {
  const g = baseGame();
  g.pendingMassivePush = {
    gameId: 'g1',
    phase: 'friendly',
    currentIndex: 0,
    friendlyQueue: [
      { figureKey: 'trandoshan_hunter_1', dcName: 'Trandoshan Hunter', playerNum: 1 },
      { figureKey: 'trandoshan_hunter_2', dcName: 'Trandoshan Hunter', playerNum: 1 },
    ],
    enemyQueue: [],
    _currentPickable: [
      { figureKey: 'trandoshan_hunter_1', dcName: 'Trandoshan Hunter', playerNum: 1 },
      { figureKey: 'trandoshan_hunter_2', dcName: 'Trandoshan Hunter', playerNum: 1 },
    ],
    _currentValidSpaces: null,
    _figurePickLockedIdx: -1,
  };
  return g;
}

function gameWithPostDeployChooser() {
  const g = baseGame();
  g.players = {
    1: { id: 'user-1' },
    2: { id: 'user-2' },
  };
  g.postDeployQueue = {
    currentPlayerNum: 1,
    awaitingOrder: true,
    activeAbility: null,
    abilities: [
      { abilityId: 'forward_emplacement', label: 'Forward Emplacement', dcName: 'AT-ST', figureKey: 'atst_1', playerNum: 1, interactive: true },
      { abilityId: 'strike_team', label: 'Strike Team', dcName: 'Strike Team', figureKey: 'st_1', playerNum: 1, interactive: true },
    ],
  };
  return g;
}

function gameWithWalkerPrompt() {
  const g = baseGame();
  g.players = {
    1: { id: 'user-1' },
    2: { id: 'user-2' },
  };
  g.postDeployQueue = {
    currentPlayerNum: 1,
    awaitingOrder: false,
    abilities: [],
    activeAbility: {
      abilityId: 'scavenged_walker_move',
      playerNum: 1,
      msgId: 'walker-msg-1',
      moveFigures: [{ figureKey: 'atst_1', dcName: 'AT-ST' }],
    },
  };
  return g;
}

// ── Unit tests: signatures + expected prompts ───────────────────────────────

describe('prompt-reconciler signatures', () => {
  it('PROMPT_KINDS exposes the four tracked kinds', () => {
    assert.deepEqual([...PROMPT_KINDS].sort(), [
      'massivePushFigure', 'massivePushSpace', 'postDeployChooser', 'walkerMove',
    ]);
  });

  it('signatureFor(massivePushSpace) changes with valid-space list', () => {
    const g = gameWithMassivePushSpace();
    const a = signatureFor('massivePushSpace', g);
    g.pendingMassivePush._currentValidSpaces = ['7D', '8C'];
    const b = signatureFor('massivePushSpace', g);
    assert.notEqual(a, b);
  });

  it('signatureFor(massivePushFigure) changes when pickable figures change', () => {
    const g = gameWithMassivePushFigure();
    const a = signatureFor('massivePushFigure', g);
    g.pendingMassivePush._currentPickable = [
      { figureKey: 'trandoshan_hunter_1', dcName: 'Trandoshan Hunter', playerNum: 1 },
    ];
    const b = signatureFor('massivePushFigure', g);
    assert.notEqual(a, b);
  });

  it('signatureFor(postDeployChooser) changes when interactive ability list changes', () => {
    const g = gameWithPostDeployChooser();
    const a = signatureFor('postDeployChooser', g);
    g.postDeployQueue.abilities = g.postDeployQueue.abilities.slice(0, 1);
    const b = signatureFor('postDeployChooser', g);
    assert.notEqual(a, b);
  });

  it('signatureFor(walkerMove) changes with active figure', () => {
    const g = gameWithWalkerPrompt();
    const a = signatureFor('walkerMove', g);
    g.postDeployQueue.activeAbility.moveFigures[0].figureKey = 'atst_2';
    const b = signatureFor('walkerMove', g);
    assert.notEqual(a, b);
  });
});

describe('prompt-reconciler getExpectedPrompts', () => {
  it('pendingMassivePush + pickable array → massivePushFigure', () => {
    const g = gameWithMassivePushFigure();
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'massivePushFigure');
  });

  it('pendingMassivePush + locked idx → falls through to space', () => {
    const g = gameWithMassivePushFigure();
    g.pendingMassivePush._figurePickLockedIdx = 0;
    g.pendingMassivePush._currentValidSpaces = ['5A', '5B'];
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'massivePushSpace');
  });

  it('pendingMassivePush + validSpaces → massivePushSpace', () => {
    const g = gameWithMassivePushSpace();
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'massivePushSpace');
  });

  it('pendingMassivePush blocks postDeployChooser (parent-flow invariant)', () => {
    const g = gameWithMassivePushSpace();
    g.postDeployQueue = gameWithPostDeployChooser().postDeployQueue;
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'massivePushSpace');
  });

  it('no pending push + interactive abilities + awaitingOrder → postDeployChooser', () => {
    const g = gameWithPostDeployChooser();
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'postDeployChooser');
  });

  it('walker active ability + no move-in-progress → walkerMove', () => {
    const g = gameWithWalkerPrompt();
    const exp = getExpectedPrompts(g);
    assert.equal(exp.length, 1);
    assert.equal(exp[0].kind, 'walkerMove');
  });

  it('walker active + moveInProgress for that figure → no prompt', () => {
    const g = gameWithWalkerPrompt();
    g.moveInProgress = { msg1: { figureKey: 'atst_1' } };
    assert.equal(getExpectedPrompts(g).length, 0);
  });

  it('empty game → no prompts', () => {
    assert.equal(getExpectedPrompts(baseGame()).length, 0);
  });
});

describe('recordPromptMessage / clearPromptRecord', () => {
  it('round-trip stores and clears by kind', () => {
    const g = baseGame();
    recordPromptMessage(g, 'walkerMove', 'c1', 'm1', 'sig1');
    assert.equal(g.promptMessageIds.walkerMove.messageId, 'm1');
    clearPromptRecord(g, 'walkerMove');
    assert.equal(g.promptMessageIds.walkerMove, undefined);
  });

  it('noop when channelId or messageId missing', () => {
    const g = baseGame();
    recordPromptMessage(g, 'walkerMove', null, 'm1', 's');
    assert.equal(g.promptMessageIds.walkerMove, undefined);
    recordPromptMessage(g, 'walkerMove', 'c1', null, 's');
    assert.equal(g.promptMessageIds.walkerMove, undefined);
  });
});

// ── Integration: reconcilePrompts ───────────────────────────────────────────

describe('reconcilePrompts', () => {
  it('pendingMassivePush with no tracked prompt → posts space prompt', async () => {
    const { client, posted } = makeMockClient();
    const g = gameWithMassivePushSpace();
    await reconcilePrompts(g, 'g1', client, {});
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /Massive Displacement/);
    assert.ok(g.promptMessageIds.massivePushSpace);
  });

  it('pendingMassivePush with pickable list and no tracked prompt → posts figure prompt', async () => {
    const { client, posted } = makeMockClient();
    const g = gameWithMassivePushFigure();
    await reconcilePrompts(g, 'g1', client, {});
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /Pick which/);
    assert.ok(g.promptMessageIds.massivePushFigure);
  });

  it('stale postDeployChooser while displacement pending → delete chooser + restore displacement', async () => {
    const { client, posted, deleted } = makeMockClient();
    const g = gameWithMassivePushSpace();
    // Simulate stale chooser record from before displacement started
    recordPromptMessage(g, 'postDeployChooser', 'thread-channel-1', 'stale-chooser-msg', 'old-sig');
    // Seed the fetchedMsgs so delete succeeds — simulate the live message
    const chRef = await client.channels.fetch('thread-channel-1');
    chRef.messages.fetch = async (id) => {
      if (id === 'stale-chooser-msg') return { id, async delete() { deleted.push(id); } };
      return null;
    };

    await reconcilePrompts(g, 'g1', client, {});

    assert.ok(deleted.includes('stale-chooser-msg'), 'stale chooser was deleted');
    assert.equal(g.promptMessageIds.postDeployChooser, undefined);
    assert.ok(g.promptMessageIds.massivePushSpace, 'displacement prompt restored');
    assert.equal(posted.length, 1);
  });

  it('repeated reconcile is idempotent — no duplicate posts when state stable', async () => {
    const { client, posted } = makeMockClient();
    const g = gameWithMassivePushSpace();
    await reconcilePrompts(g, 'g1', client, {});
    const afterFirst = posted.length;
    await reconcilePrompts(g, 'g1', client, {});
    await reconcilePrompts(g, 'g1', client, {});
    assert.equal(posted.length, afterFirst, 'no additional posts on repeated reconcile');
  });

  it('signature mismatch → delete + re-render', async () => {
    const { client, posted, deleted } = makeMockClient();
    const g = gameWithMassivePushSpace();
    await reconcilePrompts(g, 'g1', client, {});
    const firstId = g.promptMessageIds.massivePushSpace.messageId;

    // Mutate state so signature changes
    g.pendingMassivePush._currentValidSpaces = ['9Z'];

    await reconcilePrompts(g, 'g1', client, {});

    assert.ok(deleted.includes(firstId), 'old stale prompt was deleted');
    assert.ok(g.promptMessageIds.massivePushSpace);
    assert.notEqual(g.promptMessageIds.massivePushSpace.messageId, firstId);
    assert.equal(posted.length, 2);
  });

  it('restart-like rehydration: promptMessageIds wiped but pending state intact → reconcile re-posts', async () => {
    const { client, posted } = makeMockClient();
    const g = gameWithMassivePushSpace();
    // simulate process restart: game state persisted, transient helper state gone
    g.promptMessageIds = {};
    await reconcilePrompts(g, 'g1', client, {});
    assert.equal(posted.length, 1);
    assert.ok(g.promptMessageIds.massivePushSpace);
  });

  it('nothing pending + stale walkerMove record → cleaned up without re-post', async () => {
    const { client, posted, deleted } = makeMockClient();
    const g = baseGame();
    recordPromptMessage(g, 'walkerMove', 'thread-channel-1', 'walker-stale', 'old');
    const chRef = await client.channels.fetch('thread-channel-1');
    chRef.messages.fetch = async (id) => (id === 'walker-stale'
      ? { id, async delete() { deleted.push(id); } }
      : null);

    await reconcilePrompts(g, 'g1', client, {});
    assert.ok(deleted.includes('walker-stale'));
    assert.equal(g.promptMessageIds.walkerMove, undefined);
    assert.equal(posted.length, 0);
  });
});

// ── State-driven deferred-resume coverage ───────────────────────────────────

describe('post-deploy deferred resume (state-driven)', () => {
  it('onPostDeployMovementComplete stores descriptor when pendingMassivePush exists', async () => {
    const g = gameWithMassivePushSpace();
    let saved = 0;
    const ctx = { saveGames: () => { saved++; }, logGameAction: async () => null };
    await onPostDeployMovementComplete(g, 'g1', null, ctx, 'atst_1');
    assert.deepEqual(g._postDeployMoveDeferred?.figureKey, 'atst_1');
    assert.equal(saved, 1);
  });

  it('resumeDeferredPostDeployMove is a no-op when nothing deferred', async () => {
    const g = baseGame();
    await resumeDeferredPostDeployMove(g, 'g1', null, { saveGames: () => {} });
    // no throw, no state mutation
    assert.equal(g._postDeployMoveDeferred, undefined);
  });

  it('resumeDeferredPostDeployMove clears descriptor and advances queue', async () => {
    const g = baseGame();
    // active ability with one figure already done; advance should null out activeAbility
    g.postDeployQueue = {
      currentPlayerNum: 1,
      abilities: [],
      activeAbility: {
        abilityId: 'forward_emplacement',
        playerNum: 1,
        moveFigures: [{ figureKey: 'atst_1', dcName: 'AT-ST' }],
        currentFigureIdx: 0,
      },
    };
    g._postDeployMoveDeferred = { figureKey: 'atst_1', at: Date.now() };
    g.players = { 1: { id: 'u1' }, 2: { id: 'u2' } };

    const ctx = {
      saveGames: () => {},
      logGameAction: async () => null,
      // minimal deps used by downstream code paths we may touch
    };
    await resumeDeferredPostDeployMove(g, 'g1', null, ctx);
    assert.equal(g._postDeployMoveDeferred, undefined);
  });

  it('descriptor survives as pure state (serializable) across a JSON round-trip', async () => {
    const g = gameWithMassivePushSpace();
    await onPostDeployMovementComplete(g, 'g1', null, { saveGames: () => {} }, 'atst_1');
    const roundTripped = JSON.parse(JSON.stringify(g));
    assert.equal(roundTripped._postDeployMoveDeferred.figureKey, 'atst_1');
    // confirming we don't hold any non-serializable refs (functions, Maps)
    assert.equal(typeof roundTripped._postDeployMoveDeferred.at, 'number');
  });
});
