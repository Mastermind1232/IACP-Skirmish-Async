#!/usr/bin/env node
/**
 * Path B — Node.js stepper server for AlphaZero-Skirbo training.
 *
 * Reads JSON commands from stdin, one per line, and writes JSON responses
 * to stdout, one per line. Each command has a request-id the client uses
 * to match replies.
 *
 * Protocol (one JSON object per line):
 *
 *   IN   {"id": N, "cmd": "ping"}
 *   OUT  {"id": N, "ok": true, "pong": true}
 *
 *   IN   {"id": N, "cmd": "new_game", "map_id": "...", "p1_army": [...], "p2_army": [...]}
 *   OUT  {"id": N, "ok": true, "game": {...}, "game_id": "..."}
 *
 *   IN   {"id": N, "cmd": "step", "game": {...}, "customId": "...", "user_id": "p1"|"p2",
 *         "action_opts": {...}}
 *   OUT  {"id": N, "ok": true, "game": {...}, "events": [...]}  -- or error
 *
 *   IN   {"id": N, "cmd": "legal_actions", "game": {...}, "player_num": 1|2}
 *   OUT  {"id": N, "ok": true, "actions": [{customId, type, description, params?}]}
 *
 *   IN   {"id": N, "cmd": "terminal", "game": {...}}
 *   OUT  {"id": N, "ok": true, "done": bool, "p1_vp": int, "p2_vp": int,
 *         "reward_p1": -1|0|+1}
 *
 *   IN   {"id": N, "cmd": "exit"}
 *   OUT  {"id": N, "ok": true, "bye": true}   -- then process exits
 *
 * All errors shape: {"id": N, "ok": false, "error": "..."}
 *
 * The game object is the authoritative JS game state, a plain-object dump.
 * Python encoder reads it directly (field names match).
 */

import readline from 'node:readline';

import { createHarness } from '../game-harness.js';
import { getAvailableActions } from '../../engine/available-actions.js';
import { buildHeadlessDeps } from '../headless-deps.js';
import { initializeDcState } from '../init-dc-state.js';
import { getDcStats } from '../../data-loader.js';
import { runSetupSim } from '../../../tests/headless/setup-harness.js';

const rl = readline.createInterface({ input: process.stdin, terminal: false });

let gameIdCounter = 1;

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function replyOk(id, extra = {}) { write({ id, ok: true, ...extra }); }
function replyErr(id, msg) { write({ id, ok: false, error: String(msg) }); }

/**
 * Build a minimal ROUND_ACTIVE game directly (bypasses real deployment
 * flow for now). This mirrors the pattern used in
 * tests/fixtures/game-builder.js. Returns a game object ready for
 * stepping via createHarness.
 *
 * Important: the goal for full Path B completeness is to eventually run
 * setup through the real handlers (deployment zones, deploy_figure per
 * DC, CC shuffle, phase gates). This shortcut is a stepping stone, not
 * the final state. TODO: wire the real setup chain.
 */
function buildInitialGame({ map_id, p1_army, p2_army, p1_id = 'player1', p2_id = 'player2' } = {}) {
  const mapId = map_id || 'mos-eisley-outskirts';
  const gameId = String(gameIdCounter++).padStart(5, '0');

  function buildDcList(army) {
    const dcList = [];
    for (const entry of army || []) {
      const dcName = typeof entry === 'string' ? entry : entry.dcName;
      const count = (typeof entry === 'object' ? entry.count : 1) || 1;
      for (let dg = 0; dg < count; dg++) {
        const stats = getDcStats(dcName) || {};
        const figureCount = stats.figures ?? 1;
        const maxHp = stats.health ?? 1;
        const healthState = [];
        for (let f = 0; f < figureCount; f++) healthState.push([maxHp, maxHp]);
        const displayName = count > 1 ? `${dcName} [Group ${dg + 1}]` : dcName;
        dcList.push({ dcName, displayName, healthState, cost: stats.cost ?? 0 });
      }
    }
    return dcList;
  }

  const p1DcList = buildDcList(p1_army || []);
  const p2DcList = buildDcList(p2_army || []);

  const game = {
    gameId,
    player1Id: p1_id,
    player2Id: p2_id,
    selectedMap: mapId,
    mapId,
    p1DcList,
    p2DcList,
    p1DcMessageIds: p1DcList.map(() => null),
    p2DcMessageIds: p2DcList.map(() => null),
    p1ActivatedDcIndices: [],
    p2ActivatedDcIndices: [],
    p1ActivationsTotal: p1DcList.length,
    p2ActivationsTotal: p2DcList.length,
    p1ActivationsRemaining: p1DcList.length,
    p2ActivationsRemaining: p2DcList.length,
    p1CcHand: [],
    p2CcHand: [],
    p1CcDeck: [],
    p2CcDeck: [],
    p1CcDiscard: [],
    p2CcDiscard: [],
    p1DcAttachments: {},
    p2DcAttachments: {},
    p1CcAttachments: {},
    p2CcAttachments: {},
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    phase: 'round_active',
    roundPhase: 'activation',
    currentRound: 1,
    round: 1,
    initiativeHolder: 1,
    activePlayer: 1,
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: { 1: {}, 2: {} },
    figureOrientations: { 1: {}, 2: {} },
    figureStrain: { 1: {}, 2: {} },
    activationStartPositions: { 1: {}, 2: {} },
    activeFigureKeys: [],
    figuresMovedThisRound: [],
    ended: false,
  };
  return game;
}

async function handleNewGame(id, msg) {
  try {
    // Run the REAL setup flow: zone selection, deploy_figure per DC,
    // deployment done, CC shuffle draw, phase gates. Leaves the game in
    // ROUND_ACTIVE with every rule active (DCs, CCs, objectives).
    const config = {
      mapId: msg.map_id || 'mos-eisley-outskirts',
      p1Army: msg.p1_army || [],
      p2Army: msg.p2_army || [],
      p1CcDeck: msg.p1_cc_deck || [],
      p2CcDeck: msg.p2_cc_deck || [],
      p1Id: msg.p1_id || 'player1',
      p2Id: msg.p2_id || 'player2',
    };
    const result = await runSetupSim(config);
    // runSetupSim can emit cosmetic "errors" for no-op phase transitions
    // that don't actually block setup. Real failure is: game didn't
    // reach round_active or figures didn't deploy.
    const g = result.game;
    const reached = g && (g.phase === 'round_active' || g.phase === 'activation');
    const p1 = Object.keys((g?.figurePositions || {})[1] || {}).length;
    const p2 = Object.keys((g?.figurePositions || {})[2] || {}).length;
    if (!reached || p1 === 0 || p2 === 0) {
      return replyErr(id, `setup did not complete: phase=${g?.phase} p1figs=${p1} p2figs=${p2} errors=${JSON.stringify(result.errors || [])}`);
    }
    replyOk(id, {
      game: g,
      game_id: g.gameId,
      phases: result.phases,
      setup_warnings: result.errors || [],
    });
  } catch (e) {
    replyErr(id, e.stack || e.message);
  }
}

async function handleNewGameShortcut(id, msg) {
  // Legacy fast-path that skips deployment (used for unit tests only).
  try {
    const game = buildInitialGame(msg);
    replyOk(id, { game, game_id: game.gameId });
  } catch (e) {
    replyErr(id, e.stack || e.message);
  }
}

async function handleStep(id, msg) {
  try {
    if (!msg.game || !msg.game.gameId) {
      return replyErr(id, 'step: missing game.gameId');
    }
    const customId = msg.customId;
    const userId = msg.user_id || msg.game.player1Id;
    const actionOpts = msg.action_opts || {};

    const harness = createHarness(msg.game);
    const result = await harness.submitAction(customId, userId, actionOpts);
    replyOk(id, {
      game: harness.getGame(),
      events: result.events || [],
      messages: result.messages || [],
      error: result.error || null,
    });
  } catch (e) {
    replyErr(id, e.stack || e.message);
  }
}

async function handleLegalActions(id, msg) {
  try {
    if (!msg.game) return replyErr(id, 'legal_actions: missing game');
    const playerNum = Number(msg.player_num || msg.game.activePlayer || 1);
    // Build minimal deps so queries that need dcMessageMeta etc. don't crash.
    const deps = buildHeadlessDeps({
      gamesMap: new Map([[msg.game.gameId, msg.game]]),
      client: null,
      dcMessageMeta: new Map(),
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
    });
    const actions = getAvailableActions(msg.game, playerNum, deps);
    replyOk(id, { actions });
  } catch (e) {
    replyErr(id, e.stack || e.message);
  }
}

async function handleTerminal(id, msg) {
  try {
    const g = msg.game || {};
    const p1_vp = (g.player1VP || {}).total || 0;
    const p2_vp = (g.player2VP || {}).total || 0;
    const p1_alive = Object.keys((g.figurePositions || {})[1] || {}).length > 0;
    const p2_alive = Object.keys((g.figurePositions || {})[2] || {}).length > 0;
    const done = Boolean(g.ended) || !p1_alive || !p2_alive || g.phase === 'game_over';
    let reward_p1 = 0;
    if (!p1_alive && p2_alive) reward_p1 = -1;
    else if (p1_alive && !p2_alive) reward_p1 = 1;
    else if (p1_vp > p2_vp) reward_p1 = 1;
    else if (p1_vp < p2_vp) reward_p1 = -1;
    replyOk(id, { done, p1_vp, p2_vp, reward_p1 });
  } catch (e) {
    replyErr(id, e.stack || e.message);
  }
}

async function dispatch(msg) {
  const id = msg.id ?? null;
  switch (msg.cmd) {
    case 'ping':
      return replyOk(id, { pong: true });
    case 'new_game':
      return handleNewGame(id, msg);
    case 'new_game_shortcut':
      return handleNewGameShortcut(id, msg);
    case 'step':
      return handleStep(id, msg);
    case 'legal_actions':
      return handleLegalActions(id, msg);
    case 'terminal':
      return handleTerminal(id, msg);
    case 'exit':
      replyOk(id, { bye: true });
      process.exit(0);
      return;
    default:
      return replyErr(id, `unknown cmd: ${msg.cmd}`);
  }
}

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    return replyErr(null, `JSON parse error: ${e.message}`);
  }
  await dispatch(msg);
});

rl.on('close', () => process.exit(0));

// Signal ready so the client can detect the server is up.
write({ ok: true, ready: true, pid: process.pid });
