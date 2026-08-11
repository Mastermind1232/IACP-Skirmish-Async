/**
 * Game harness: executes handler actions headlessly.
 *
 * Ties together:
 * - Router (customId → handler key)
 * - Handler registry (key → handler function)
 * - Context factory (group → context from deps)
 * - Fake interactions (capture Discord output)
 *
 * Usage:
 *   const harness = createHarness(initialGame, options);
 *   const result = await harness.submitAction(customId, userId);
 *   console.log(harness.getGame());
 */

import { getHandlerKey } from '../router.js';
import { getHandler, getHandlerGroup } from '../handlers/index.js';
import { buildContext } from '../context-factory.js';
import { buildHeadlessDeps } from './headless-deps.js';
import { createFakeInteraction } from './fake-interaction.js';
import { createFakeClient } from './fake-client.js';
import { captureSnapshot, computeDiff } from '../event-log.js';
import { translateDiffToEvents } from '../domain/diff-translator.js';
import { getDcList, getDcMessageIds, getActivationsRemaining, setActivationsRemaining, getActivatedDcIndices } from '../game/player-helpers.js';
import { DC_ACTIONS_PER_ACTIVATION } from '../discord/messages.js';
import { isCompanionHostDefeated } from '../game/dc-helpers.js';
import { applyStartOfActivationEffects } from '../engine/activation-effects.js';
import { applyEndOfActivationEffects } from '../engine/activation-effects.js';
import { applyMoveTransition } from '../game/apply-move.js';
import { cleanupActivation } from '../game/activation-state.js';
import { getDcEffects } from '../data-loader.js';

/**
 * Headless-only DC activation: performs the 4 critical game-state mutations
 * that the Discord handler does, without touching Discord APIs.
 *
 * Bypasses: fetchGameChannel, message.edit, startThread, thread.send,
 *           updateActivationsMessage — all Discord-only side effects.
 *
 * @param {object} game - The game state object
 * @param {string} customId - The dc_activate_ customId
 * @param {Map} dcExhaustedState - DC exhausted state map
 * @param {Map} dcHealthState - DC health state map
 * @returns {{ ok: boolean, error?: string }}
 */
function headlessActivateDc(game, customId, dcExhaustedState, dcHealthState) {
  // customId format: dc_activate_{gameId}_{playerNum}_{dcIndex}_{ownerId}
  const suffix = customId.replace(/^dc_activate_/, '');
  const parts = suffix.split('_');
  // parts: [gameId, playerNum, dcIndex, ownerId]
  const playerNum = parseInt(parts[1], 10);
  const dcIndex = parseInt(parts[2], 10);

  const dcList = getDcList(game, playerNum) || [];
  const dc = dcList[dcIndex];
  if (!dc) return { ok: false, error: `DC not found at index ${dcIndex} for player ${playerNum}` };

  const { dcName, displayName } = dc;
  const remaining = getActivationsRemaining(game, playerNum);
  if (remaining <= 0) return { ok: false, error: 'No activations remaining this round' };

  // Companion host defeated: companion cannot activate if host group left play
  if (isCompanionHostDefeated(game, dcName, playerNum)) {
    return { ok: false, rejected: true };
  }

  const dcMessageIds = getDcMessageIds(game, playerNum) || [];
  const msgId = dcMessageIds[dcIndex];
  if (!msgId) return { ok: false, error: `DC message ID not found at index ${dcIndex}` };

  // 1. Mark DC exhausted
  dcExhaustedState.set(msgId, true);

  // 2. Initialize movement bank (consume any pending MP bonus).
  // Per alexanbv 2026-06-13: MP is strictly per-figure. Mirror
  // activation-setup B10 — top-level holds only UI metadata; every
  // figure of the group gets its own perFig[i] sub-bank, each seeded
  // with the pending MP bonus (per-figure semantics, no shared pool).
  game.movementBank = game.movementBank || {};
  const pendingMp = game.pendingMpBonus?.[msgId] ?? 0;
  if (pendingMp && game.pendingMpBonus) delete game.pendingMpBonus[msgId];
  const _hbFigCount = Math.max(1, getDcEffects()?.[dcName]?.figures ?? 1);
  const _hbPerFig = {};
  for (let _i = 0; _i < _hbFigCount; _i++) {
    _hbPerFig[_i] = { total: pendingMp, remaining: pendingMp };
  }
  game.movementBank[msgId] = {
    threadId: null, messageId: null, displayName, perFig: _hbPerFig,
  };

  // 3. Populate dcActionsData — gates move/attack action availability
  game.dcActionsData = game.dcActionsData || {};
  // Per alexanbv 2026-06-13: actions are STRICTLY per-figure — no group-level
  // remaining/total. Seed per-figure budgets (one per figure in the group) so
  // headless runs gate correctly. Mirror activation-setup B12.
  const _hbActionsPerFig = {};
  for (let _i = 0; _i < _hbFigCount; _i++) _hbActionsPerFig[_i] = DC_ACTIONS_PER_ACTIVATION;
  game.dcActionsData[msgId] = {
    perFigureRemaining: _hbActionsPerFig,
    figureLocked: {},
    messageId: null, threadId: null, specialsUsed: [],
  };

  // 4. Update activation counters
  setActivationsRemaining(game, playerNum, remaining - 1);
  getActivatedDcIndices(game, playerNum).push(dcIndex);

  // Strength in Numbers: clear after extra activation committed
  if (game.strengthInNumbersData && game.strengthInNumbersData.playerNum === playerNum) {
    game.strengthInNumbersData = null;
    game.strengthInNumbersPlayerNum = null;
  }

  // Agitate: clear restriction once the correct (or any) group activates
  if (game.agitateNextActivation && game.agitateNextActivation.playerNum === playerNum) {
    game.agitateNextActivation = null;
  }

  // Deterministic start-of-activation effects
  applyStartOfActivationEffects(game, { dcName, playerNum, displayName, msgId, dcHealthState });

  return { ok: true };
}

/**
 * Headless-only pass_activation_turn: mirrors the engine state mutation in
 * handlePassActivationTurn (src/handlers/activation.js:205). Sets
 * currentActivationTurnPlayerId to the opponent. Skips Discord embed IO,
 * pushUndo, and follow-up replies. Honors the same gate: cannot pass when
 * you have at least as many activations remaining as the opponent.
 */
function headlessPassActivationTurn(game) {
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  if (!turnPlayerId) return { ok: false, error: 'No turn player' };
  const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
  const otherPlayerNum = turnPlayerNum === 1 ? 2 : 1;
  const myRem = getActivationsRemaining(game, turnPlayerNum) ?? 0;
  const otherRem = getActivationsRemaining(game, otherPlayerNum) ?? 0;
  if (otherRem <= myRem) {
    return { ok: false, rejected: true, error: 'Cannot pass with fewer-or-equal remaining' };
  }
  const otherPlayerId = otherPlayerNum === 1 ? game.player1Id : game.player2Id;
  game.currentActivationTurnPlayerId = otherPlayerId;
  return { ok: true };
}

/**
 * Headless-only DC end-activation: mirrors the deterministic state-mutation
 * portion of handleDcEndActivation in src/handlers/activation.js. Skips all
 * Discord IO (thread.archive, message.edit, follow-up replies). Mirrors the
 * meta-lookup → cleanupActivation → applyEndOfActivationEffects sequence.
 */
function headlessEndActivation(game, customId, dcMessageMeta) {
  const msgId = customId.replace(/^dc_end_activation_/, '');
  const meta = dcMessageMeta?.get?.(msgId);
  if (!meta) {
    if (process.env.HEADLESS_DEBUG) {
      const keys = dcMessageMeta && dcMessageMeta.keys ? [...dcMessageMeta.keys()] : 'no-map';
      console.error(`[headlessEndActivation] no meta for ${msgId}; keys=${JSON.stringify(keys)}`);
    }
    return { ok: false, error: `No meta for msgId=${msgId}` };
  }
  const displayName = meta.displayName || meta.dcName;

  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[msgId] = true;

  // Build figure keys for only the activated deployment group.
  const endEff = getDcEffects()?.[meta.dcName];
  const figCount = endEff?.figures || 1;
  // 1-based, matching the live handler (activation.js). This harness carried
  // the same '0' default, so the suites reproduced the broken cleanup and
  // could never catch it — fixed alongside the production sites.
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKeys = [];
  for (let fi = 0; fi < figCount; fi++) {
    figureKeys.push(`${meta.dcName}-${dgIndex}-${fi}`);
  }
  cleanupActivation(game, msgId, meta.playerNum, figureKeys);
  applyEndOfActivationEffects(game, {
    dcName: meta.dcName, playerNum: meta.playerNum, displayName, msgId,
  });
  return { ok: true };
}

/**
 * Create a headless game harness for testing.
 *
 * @param {object} initialGame - The starting game state
 * @param {object} [options]
 * @param {object} [options.deps] - Pre-built headless deps (created if omitted)
 * @param {Map} [options.dcMessageMeta] - DC message metadata
 * @param {Map} [options.dcExhaustedState] - DC exhausted state
 * @param {Map} [options.dcHealthState] - DC health state
 * @returns {object} Harness with submitAction, getGame, getMessages, getDeps
 */
export function createHarness(initialGame, options = {}) {
  const lightweight = !!options.lightweight;
  const gamesMap = new Map();
  if (initialGame) {
    gamesMap.set(initialGame.gameId, structuredClone(initialGame));
  }

  const client = createFakeClient();

  const deps = options.deps || buildHeadlessDeps({
    gamesMap,
    client,
    dcMessageMeta: options.dcMessageMeta || new Map(),
    dcExhaustedState: options.dcExhaustedState || new Map(),
    dcHealthState: options.dcHealthState || new Map(),
  });

  // Override getGame/setGame/saveGames to use our local gamesMap
  deps.getGame = (id) => gamesMap.get(id) || null;
  deps.setGame = (id, game) => { gamesMap.set(id, game); };
  deps.saveGames = () => {};
  deps.client = client;

  const allMessages = [];

  function _translateEvents(gameId, handlerKey, playerId, beforeSnap, gamesMap) {
    if (!beforeSnap || !gameId) return [];
    const afterSnap = captureSnapshot(gamesMap.get(gameId));
    const diff = computeDiff(beforeSnap, afterSnap);
    if (!diff) return [];
    return translateDiffToEvents(handlerKey, diff, {
      gameId, playerId, before: beforeSnap, after: afterSnap,
    });
  }

  return {
    /**
     * Submit a handler action headlessly.
     * @param {string} customId - The button/select customId
     * @param {string} userId - The user submitting the action
     * @param {object} [actionOpts] - Additional options (type, values, etc.)
     * @returns {Promise<{ game: object, messages: Array, error?: string }>}
     */
    async submitAction(customId, userId, actionOpts = {}) {
      const type = actionOpts.type || 'button';
      const handlerKey = getHandlerKey(customId, type);

      if (!handlerKey) {
        return {
          game: gamesMap.get(initialGame?.gameId),
          messages: [],
          error: `No handler found for customId: ${customId}`,
        };
      }

      const handler = getHandler(handlerKey);
      if (!handler) {
        return {
          game: gamesMap.get(initialGame?.gameId),
          messages: [],
          error: `No handler function for key: ${handlerKey}`,
        };
      }

      const gameId = initialGame?.gameId;

      // Headless intercept: dc_activate_ bypasses Discord handler entirely
      if (customId.startsWith('dc_activate_')) {
        const game = gamesMap.get(gameId);
        if (!game) return { game: null, messages: [], error: 'Game not found', events: [] };
        const beforeSnap = lightweight ? null : captureSnapshot(game);
        const result = headlessActivateDc(game, customId, deps.dcExhaustedState, deps.dcHealthState);
        if (!result.ok) {
          // Graceful rejection (validation gate) vs hard error
          return { game, messages: [], error: result.rejected ? undefined : result.error, events: [] };
        }
        const events = lightweight ? [] : _translateEvents(gameId, handlerKey, userId, beforeSnap, gamesMap);
        return { game, messages: [], events };
      }

      // Headless intercept: dc_end_activation_ skips thread/message IO and
      // Discord embeds. Calls cleanupActivation + applyEndOfActivationEffects
      // directly so the activation actually ends. Lightweight-only — full
      // Discord-mode tests rely on the regular handler path running through
      // fakeInteraction for surface-event tracking.
      if (lightweight && customId.startsWith('dc_end_activation_')) {
        const game = gamesMap.get(gameId);
        if (!game) return { game: null, messages: [], error: 'Game not found', events: [] };
        const result = headlessEndActivation(game, customId, deps.dcMessageMeta);
        return { game, messages: [], error: result.ok ? undefined : result.error, events: [] };
      }

      // Headless intercept: pass_activation_turn_ skips embed/undo IO. Only
      // mutation is `currentActivationTurnPlayerId = opponent`. Same gate as
      // the live handler: cannot pass when you have ≥ opponent's activations.
      // Lightweight-only for the same reason as dc_end_activation_.
      if (lightweight && customId.startsWith('pass_activation_turn_')) {
        const game = gamesMap.get(gameId);
        if (!game) return { game: null, messages: [], error: 'Game not found', events: [] };
        const result = headlessPassActivationTurn(game);
        return { game, messages: [], error: result.ok ? undefined : (result.rejected ? undefined : result.error), events: [] };
      }

      // MCTS fast-path intercept: move_pick_ skips _renderNextMoveGrid (second
      // computeMovementCache + canvas minimap render) and _renderPostMoveBoardUpdate.
      // All state mutations (Overrun, Cut and Run, massive displacement,
      // moveState, pushUndo, Deference/Cassian/Swipe/Attached) still run.
      // Lightweight-only: Discord path never hits this branch.
      if (lightweight && customId.startsWith('move_pick_')) {
        const group = getHandlerGroup(handlerKey);
        const context = group ? buildContext(group, deps) : deps;
        const interaction = createFakeInteraction(customId, userId, { ...actionOpts, client });
        try {
          await applyMoveTransition(interaction, context);
          return { game: gamesMap.get(gameId), messages: [], events: [] };
        } catch (err) {
          return {
            game: gamesMap.get(gameId),
            messages: [],
            error: err.message,
            events: [],
          };
        }
      }

      const beforeSnap = lightweight ? null : (gameId ? captureSnapshot(gamesMap.get(gameId)) : null);

      const group = getHandlerGroup(handlerKey);
      if (!group) {
        // Handler with no group — call with no context
        const interaction = createFakeInteraction(customId, userId, {
          ...actionOpts,
          client,
          channel: client._channelCache.values().next().value,
        });
        try {
          await handler(interaction);
          if (!lightweight) {
            allMessages.push(...interaction.sentMessages);
            const events = _translateEvents(gameId, handlerKey, userId, beforeSnap, gamesMap);
            return { game: gamesMap.get(gameId), messages: interaction.sentMessages, events };
          }
          return { game: gamesMap.get(gameId), messages: [], events: [] };
        } catch (err) {
          return {
            game: gamesMap.get(gameId),
            messages: lightweight ? [] : interaction.sentMessages,
            error: err.message,
            events: [],
          };
        }
      }

      const context = buildContext(group, deps);
      const interaction = createFakeInteraction(customId, userId, { ...actionOpts, client });

      try {
        await handler(interaction, context);
        if (!lightweight) {
          allMessages.push(...interaction.sentMessages);
          const events = _translateEvents(gameId, handlerKey, userId, beforeSnap, gamesMap);
          return { game: gamesMap.get(gameId), messages: interaction.sentMessages, events };
        }
        return { game: gamesMap.get(gameId), messages: [], events: [] };
      } catch (err) {
        return {
          game: gamesMap.get(gameId),
          messages: lightweight ? [] : interaction.sentMessages,
          error: err.message,
          events: [],
        };
      }
    },

    /**
     * Get the current game state.
     * @param {string} [gameId] - Defaults to initialGame.gameId
     * @returns {object|null}
     */
    getGame(gameId) {
      return gamesMap.get(gameId || initialGame?.gameId) || null;
    },

    /**
     * Get all captured messages across all actions.
     * @returns {Array}
     */
    getMessages() {
      return allMessages;
    },

    /**
     * Get the deps bag (for inspection/override in tests).
     * @returns {object}
     */
    getDeps() {
      return deps;
    },

    /**
     * Get the in-memory games map.
     * @returns {Map}
     */
    getGamesMap() {
      return gamesMap;
    },
  };
}
