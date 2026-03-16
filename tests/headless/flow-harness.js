/**
 * Flow Harness: bounded Discord-surface simulation for integration testing.
 *
 * Wraps the existing headless infrastructure but adds:
 *   - DiscordSurface model: tracks channels, messages, edits, visibility
 *   - UI function capture with player-visibility tagging
 *   - Interaction response harvesting with ephemeral detection
 *   - Message edit tracking via before/after snapshots
 *   - Pending state lifecycle tracking (DS-4)
 *   - Component lifecycle tracking (DS-5)
 *   - Surface invariant checking after every action
 *
 * This is NOT a full Discord emulator. It tracks enough structure to assert
 * what each player would see and catch the specific bug classes that matter.
 */

import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapSpaces, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { assertFlowInvariants, assertSurfaceInvariants } from './flow-invariants.js';

// ── Pending State Keys ──────────────────────────────────────────────────────

export const PENDING_STATE_KEYS = [
  'pendingCombat',
  'pendingNegation',
  'pendingCelebration',
  'pendingPowerTokenGrant',
  'pendingDcAbilityChoice',
  'pendingPounceSpaceChoice',
  'pendingMissileSalvo',
  'pendingCoverFire',
  'pendingSpreadThePainCondPick',
  'pendingStrainChoice',
  'pendingStillFaster',
  'pendingLastResort',
  'pendingStrikeMeDown',
  'pendingSlowOnTheDraw',
  'pendingForceExhaustion',
  'pendingIllicitArms',
  'pendingPowerConverter',
  'pendingThereIsNoTry',
  'pendingToughLuck',
  'pendingHunterProtocol',
  'pendingBleeding',
  'pendingEe3Carbine',
  'pendingBoRifle',
  'pendingRushPush',
  'pendingShoulderRush',
  'pendingFalseOrders',
  'pendingOverwatchPlacement',
  'pendingOrbitalBombardment',
  'pendingBombDrop',
  'pendingCcConfirmation',
  'pendingCcChoice',
  'pendingCcSpaceChoice',
  'moveInProgress',
  'endOfRoundWhoseTurn',
];

/** Check if a pending field is "active" (truthy, non-empty object). */
function isPendingActive(val) {
  if (!val) return false;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return false;
  return true;
}

/** Snapshot which pending states are active on a game. */
function snapshotPendingStates(game) {
  const snap = {};
  for (const key of PENDING_STATE_KEYS) {
    snap[key] = isPendingActive(game[key]);
  }
  return snap;
}

// ── State Delta Snapshots (for card-effect detection) ────────────────────────

/** Snapshot HP for all figures across both players. Returns Map<figureKey, {hp, maxHp}>. */
function snapshotFigureHp(game) {
  const snap = new Map();
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn];
    if (!positions) continue;
    for (const [figKey, pos] of Object.entries(positions)) {
      if (!pos) continue;
      const hp = game.figureHp?.[pn]?.[figKey];
      const maxHp = game.figureMaxHp?.[pn]?.[figKey];
      snap.set(figKey, { hp: hp ?? null, maxHp: maxHp ?? null });
    }
  }
  return snap;
}

/** Snapshot conditions for all figures. Returns Map<figureKey, Set<condition>>. */
function snapshotConditions(game) {
  const snap = new Map();
  const conditions = game.figureConditions;
  if (!conditions) return snap;
  for (const [figKey, conds] of Object.entries(conditions)) {
    snap.set(figKey, new Set(Array.isArray(conds) ? conds : Object.keys(conds)));
  }
  return snap;
}

/** Snapshot tokens (focus, evade, power, block) for all figures. Returns Map<figureKey, {focus, evade, power, block}>. */
function snapshotTokens(game) {
  const snap = new Map();
  for (const pn of [1, 2]) {
    const positions = game.figurePositions?.[pn];
    if (!positions) continue;
    for (const figKey of Object.keys(positions)) {
      snap.set(figKey, {
        focus: game.focusTokens?.[figKey] || 0,
        evade: game.evadeTokens?.[figKey] || 0,
        power: game.powerTokens?.[figKey] || 0,
        block: game.blockTokens?.[figKey] || 0,
      });
    }
  }
  return snap;
}

/** Compute state delta between before/after snapshots. */
function computeStateDelta(beforeHp, afterHp, beforeCond, afterCond, beforeTok, afterTok) {
  const delta = { hpChanges: {}, conditionsAdded: {}, conditionsRemoved: {}, tokensChanged: {} };
  let hasChanges = false;

  // HP changes
  for (const [fk, after] of afterHp) {
    const before = beforeHp.get(fk);
    if (before && before.hp !== after.hp) {
      delta.hpChanges[fk] = (after.hp ?? 0) - (before.hp ?? 0);
      hasChanges = true;
    }
  }
  // Defeated figures (in before but not after)
  for (const [fk] of beforeHp) {
    if (!afterHp.has(fk)) {
      delta.hpChanges[fk] = 'defeated';
      hasChanges = true;
    }
  }

  // Condition changes
  for (const [fk, afterSet] of afterCond) {
    const beforeSet = beforeCond.get(fk) || new Set();
    const added = [...afterSet].filter(c => !beforeSet.has(c));
    const removed = [...beforeSet].filter(c => !afterSet.has(c));
    if (added.length) { delta.conditionsAdded[fk] = added; hasChanges = true; }
    if (removed.length) { delta.conditionsRemoved[fk] = removed; hasChanges = true; }
  }

  // Token changes
  for (const [fk, afterTk] of afterTok) {
    const beforeTk = beforeTok.get(fk);
    if (!beforeTk) continue;
    const changed = {};
    let anyTokenChange = false;
    for (const type of ['focus', 'evade', 'power', 'block']) {
      const diff = (afterTk[type] || 0) - (beforeTk[type] || 0);
      if (diff !== 0) { changed[type] = diff; anyTokenChange = true; }
    }
    if (anyTokenChange) { delta.tokensChanged[fk] = changed; hasChanges = true; }
  }

  delta.hasChanges = hasChanges;
  return delta;
}

// ── Discord Surface Model ───────────────────────────────────────────────────

class DiscordSurface {
  constructor() {
    this.entries = [];
    this.editLog = [];
    this.knownMessageIds = new Set();
    // DS-4: Pending state transitions
    this.pendingTransitions = [];
    // DS-5: Component lifecycle — tracks which messages had components and when they were cleared
    this.componentHistory = []; // { step, messageId, action: 'add'|'remove'|'replace', componentCount }
  }

  recordInteractionResponse(step, userId, customId, response) {
    const playerNum = userId === 'player1' ? 1 : 2;
    const visibility = response.ephemeral
      ? (playerNum === 1 ? 'p1' : 'p2')
      : 'shared';

    this.entries.push({
      step,
      source: 'interaction',
      responseType: response.type,
      userId,
      playerNum,
      visibility,
      content: response.content || '',
      embeds: response.embeds || [],
      components: response.components || [],
      files: response.files || [],
      customId,
    });
  }

  recordUiCall(step, fnName, opts = {}) {
    this.entries.push({
      step,
      source: 'uiCall',
      fn: fnName,
      playerNum: opts.playerNum || null,
      visibility: opts.visibility || 'shared',
      msgId: opts.msgId || null,
      args: opts.args || [],
    });
  }

  recordEdit(step, messageId, channelId, before, after) {
    this.editLog.push({ step, messageId, channelId, before, after });

    // DS-5: Track component changes in edits
    const beforeComps = before.components || '';
    const afterComps = after.components || '';
    if (beforeComps !== afterComps) {
      const hadComponents = beforeComps && beforeComps !== '[]' && beforeComps !== '';
      const hasComponents = afterComps && afterComps !== '[]' && afterComps !== '';

      if (hadComponents && !hasComponents) {
        this.componentHistory.push({ step, messageId, action: 'remove', detail: 'components stripped to []' });
      } else if (!hadComponents && hasComponents) {
        this.componentHistory.push({ step, messageId, action: 'add', detail: 'components added' });
      } else if (hadComponents && hasComponents && beforeComps !== afterComps) {
        this.componentHistory.push({ step, messageId, action: 'replace', detail: 'components replaced' });
      }
    }
  }

  /**
   * Record a pending state transition.
   * @param {number} step
   * @param {string} key - The pending state key
   * @param {'created'|'cleared'} transition
   * @param {object} context - Relevant data (acting player, available actions, etc.)
   */
  recordPendingTransition(step, key, transition, context = {}) {
    this.pendingTransitions.push({ step, key, transition, ...context });
  }

  registerMessage(messageId) {
    this.knownMessageIds.add(messageId);
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getVisibleTo(playerNum) {
    const tag = playerNum === 1 ? 'p1' : 'p2';
    return this.entries.filter(e => e.visibility === 'shared' || e.visibility === tag);
  }

  getVisibleToOpponentOnly(playerNum) {
    const oppTag = playerNum === 1 ? 'p2' : 'p1';
    return this.entries.filter(e => e.visibility === oppTag);
  }

  getShared() {
    return this.entries.filter(e => e.visibility === 'shared');
  }

  getStepEntries(step) {
    return this.entries.filter(e => e.step === step);
  }

  getUiCalls(fnName) {
    return this.entries.filter(e => e.source === 'uiCall' && e.fn === fnName);
  }

  getResponses(responseType) {
    return this.entries.filter(e => e.source === 'interaction' && e.responseType === responseType);
  }

  sharedContainsText(text) {
    return this.getShared().some(e =>
      (e.content && e.content.includes(text)) ||
      (e.embeds && JSON.stringify(e.embeds).includes(text))
    );
  }

  getOrphanedEdits() {
    return this.editLog.filter(e => !this.knownMessageIds.has(e.messageId));
  }

  /** Get all pending transitions for a specific key. */
  getPendingTransitions(key) {
    return this.pendingTransitions.filter(t => t.key === key);
  }

  /** Get all component lifecycle events for a step. */
  getComponentChanges(step) {
    return this.componentHistory.filter(c => c.step === step);
  }

  /**
   * Check if a pending state was created and then properly resolved.
   * Returns { created: bool, cleared: bool, transitions: array }.
   */
  getPendingLifecycle(key) {
    const transitions = this.getPendingTransitions(key);
    return {
      created: transitions.some(t => t.transition === 'created'),
      cleared: transitions.some(t => t.transition === 'cleared'),
      transitions,
    };
  }
}

// ── Message Snapshot (for edit detection) ────────────────────────────────────

function snapshotChannelMessages(client) {
  const snap = new Map();
  for (const [chId, channel] of client._channelCache) {
    for (const [msgId, msg] of channel._messageStore) {
      snap.set(msgId, {
        channelId: chId,
        content: msg.content || '',
        embeds: msg.embeds ? JSON.stringify(msg.embeds) : '',
        components: msg.components ? JSON.stringify(msg.components) : '',
      });
    }
  }
  return snap;
}

function detectEdits(beforeSnap, afterSnap) {
  const edits = [];
  for (const [msgId, after] of afterSnap) {
    const before = beforeSnap.get(msgId);
    if (before && (before.content !== after.content || before.embeds !== after.embeds || before.components !== after.components)) {
      edits.push({ messageId: msgId, channelId: after.channelId, before, after });
    }
  }
  return edits;
}

// ── Flow Harness Factory ────────────────────────────────────────────────────

export function createFlowHarness(opts = {}) {
  const {
    mapId = 'mos-eisley-outskirts',
    p1Army = [{ dcName: 'Luke Skywalker' }],
    p2Army = [{ dcName: 'Darth Vader' }],
    round = 1,
    p1CcHand = [],
    p2CcHand = [],
    p1CcDeck = [],
    p2CcDeck = [],
    diceOverrides = null,
  } = opts;

  let builder = createTestGame()
    .withMap(mapId)
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .withPlayer1CcHand(p1CcHand)
    .withPlayer2CcHand(p2CcHand)
    .withPlayer1CcDeck(p1CcDeck)
    .withPlayer2CcDeck(p2CcDeck);

  if (round > 0) builder = builder.inRound(round);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder.build();

  const surface = new DiscordSurface();
  const client = deps.client || deps._client;

  // Register pre-existing messages
  for (const [, channel] of client._channelCache) {
    for (const [msgId] of channel._messageStore) {
      surface.registerMessage(msgId);
    }
  }

  // ── UI Capture Stubs with Visibility Tagging ──────────────────────────────
  let stepCount = 0;

  deps.updateDcActionsMessage = async (g, msgId, c) => {
    const meta = dcMessageMeta.get(msgId);
    surface.recordUiCall(stepCount, 'updateDcActionsMessage', {
      playerNum: meta?.playerNum || null,
      visibility: 'shared',
      msgId,
    });
  };

  deps.updateHandChannelMessages = async (g, c) => {
    surface.recordUiCall(stepCount, 'updateHandChannelMessages', {
      playerNum: null, visibility: 'p1',
    });
    surface.recordUiCall(stepCount, 'updateHandChannelMessages', {
      playerNum: null, visibility: 'p2',
    });
  };

  deps.updateHandVisualMessage = async (g, playerNum, c) => {
    surface.recordUiCall(stepCount, 'updateHandVisualMessage', {
      playerNum, visibility: playerNum === 1 ? 'p1' : 'p2',
    });
  };

  deps.updateDiscardPileMessage = async (g, playerNum, c) => {
    surface.recordUiCall(stepCount, 'updateDiscardPileMessage', {
      playerNum, visibility: playerNum === 1 ? 'p1' : 'p2',
    });
  };

  deps.updatePlayAreaDcButtons = async (g, c) => {
    surface.recordUiCall(stepCount, 'updatePlayAreaDcButtons', { visibility: 'shared' });
  };

  deps.sendRoundActivationPhaseMessage = async (g, c) => {
    surface.recordUiCall(stepCount, 'sendRoundActivationPhaseMessage', { visibility: 'shared' });
  };

  deps.maybeShowEndActivationPhaseButton = async (g, c) => {
    surface.recordUiCall(stepCount, 'maybeShowEndActivationPhaseButton', { visibility: 'shared' });
  };

  deps.refreshAllGameComponents = async (g, c) => {
    surface.recordUiCall(stepCount, 'refreshAllGameComponents', { visibility: 'shared' });
  };

  deps.updateAttachmentMessageForDc = async (...args) => {
    surface.recordUiCall(stepCount, 'updateAttachmentMessageForDc', { visibility: 'shared' });
  };

  for (const fn of [
    'updateMovementBankMessage', 'ensureMovementBankMessage',
    'clearMoveGridMessages',
    'sendDeckIllegalAlert', 'updateDeployPromptMessages',
  ]) {
    deps[fn] = async (...args) => {
      surface.recordUiCall(stepCount, fn, { visibility: 'shared', args });
    };
  }

  // Bleeding prompt: set a pending state so the sim can exercise bleed handlers
  deps.sendBleedingPrompt = async (g, channel, figureKey, playerNum, displayName) => {
    surface.recordUiCall(stepCount, 'sendBleedingPrompt', { visibility: 'shared', args: [figureKey, playerNum, displayName] });
    g.pendingBleeding = { figureKey, playerNum, displayName };
  };

  // ── Deterministic Dice ────────────────────────────────────────────────────
  if (diceOverrides) {
    let attackRollIdx = 0;
    let defenseRollIdx = 0;

    if (diceOverrides.attackRolls) {
      deps.rollAttackDice = (dice) => {
        const roll = diceOverrides.attackRolls[attackRollIdx % diceOverrides.attackRolls.length];
        attackRollIdx++;
        return roll;
      };
    }
    if (diceOverrides.defenseRolls) {
      deps.rollDefenseDice = (die) => {
        const roll = diceOverrides.defenseRolls[defenseRollIdx % diceOverrides.defenseRolls.length];
        defenseRollIdx++;
        return roll;
      };
    }
  }

  // ── Action deps for getAvailableActions ────────────────────────────────────
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcStats, getMapSpaces,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
  };

  // ── Step tracking ─────────────────────────────────────────────────────────
  const stepLog = [];

  return {
    getActions(playerNum) {
      const g = harness.getGame();
      return getAvailableActions(g, playerNum, actionDeps);
    },

    async act(customId, userId, actionOpts = {}) {
      stepCount++;

      const beforeGame = harness.getGame();
      const beforePending = snapshotPendingStates(beforeGame);
      const beforeSnap = snapshotChannelMessages(client);
      const beforeFigHp = snapshotFigureHp(beforeGame);
      const beforeCond = snapshotConditions(beforeGame);
      const beforeTok = snapshotTokens(beforeGame);

      const result = await harness.submitAction(customId, userId, actionOpts);

      const afterSnap = snapshotChannelMessages(client);
      const afterGame = harness.getGame();
      const afterPending = snapshotPendingStates(afterGame);
      const afterFigHp = snapshotFigureHp(afterGame);
      const afterCond = snapshotConditions(afterGame);
      const afterTok = snapshotTokens(afterGame);
      const stateDelta = computeStateDelta(beforeFigHp, afterFigHp, beforeCond, afterCond, beforeTok, afterTok);

      // Register new messages
      for (const [msgId] of afterSnap) {
        surface.registerMessage(msgId);
      }

      // Detect and record message edits
      const edits = detectEdits(beforeSnap, afterSnap);
      for (const edit of edits) {
        surface.recordEdit(stepCount, edit.messageId, edit.channelId, edit.before, edit.after);
      }

      // Harvest interaction responses
      if (result.messages) {
        for (const msg of result.messages) {
          surface.recordInteractionResponse(stepCount, userId, customId, msg);
        }
      }

      // Harvest new channel sends
      for (const [, channel] of client._channelCache) {
        for (const msg of channel._sentMessages) {
          if (!msg._surfaceRecorded) {
            msg._surfaceRecorded = true;
            surface.registerMessage(msg.id);
          }
        }
      }

      // ── DS-4: Record pending state transitions ──────────────────────────
      const p1Actions = getAvailableActions(afterGame, 1, actionDeps);
      const p2Actions = getAvailableActions(afterGame, 2, actionDeps);
      const stepEntries = surface.getStepEntries(stepCount);
      const hasVisibleUi = stepEntries.some(e =>
        (e.source === 'interaction' && e.responseType !== 'deferUpdate') ||
        e.source === 'uiCall'
      );

      for (const key of PENDING_STATE_KEYS) {
        if (!beforePending[key] && afterPending[key]) {
          // Pending state was just created
          surface.recordPendingTransition(stepCount, key, 'created', {
            customId,
            userId,
            p1HasActions: p1Actions.length > 0,
            p2HasActions: p2Actions.length > 0,
            hasVisibleUi,
            p1ActionTypes: p1Actions.map(a => a.type),
            p2ActionTypes: p2Actions.map(a => a.type),
          });
        }
        if (beforePending[key] && !afterPending[key]) {
          // Pending state was just cleared
          surface.recordPendingTransition(stepCount, key, 'cleared', {
            customId,
            userId,
            p1HasActions: p1Actions.length > 0,
            p2HasActions: p2Actions.length > 0,
            hasVisibleUi,
          });
        }
      }

      const step = {
        step: stepCount,
        customId,
        userId,
        error: result.error || null,
        gameEnded: afterGame?.ended || false,
        phase: afterGame?.phase,
        roundPhase: afterGame?.roundPhase,
        pendingCombat: !!afterGame?.pendingCombat,
        pendingNegation: !!afterGame?.pendingNegation,
        pendingCelebration: !!afterGame?.pendingCelebration,
        interactionResponses: (result.messages || []).map(m => m.type),
        editsDetected: edits.length,
        pendingCreated: PENDING_STATE_KEYS.filter(k => !beforePending[k] && afterPending[k]),
        pendingCleared: PENDING_STATE_KEYS.filter(k => beforePending[k] && !afterPending[k]),
        stateDelta,
      };
      stepLog.push(step);

      // Run invariant checks
      const gameErrors = assertFlowInvariants(afterGame, actionDeps);
      const surfaceErrors = assertSurfaceInvariants(afterGame, surface, stepCount);
      const invariantErrors = [...gameErrors, ...surfaceErrors];

      return { result, invariantErrors, step };
    },

    /** Get current game state. */
    getGame() { return harness.getGame(); },

    /** Get the Discord surface model. */
    getSurface() { return surface; },

    /** Get the step log. */
    getStepLog() { return stepLog; },

    /** Get dcMessageMeta. */
    getDcMessageMeta() { return dcMessageMeta; },

    /** Get the deps bag. */
    getDeps() { return deps; },

    /** Get the harness. */
    getHarness() { return harness; },

    /** Get action deps (for external invariant checks). */
    getActionDeps() { return actionDeps; },
  };
}
