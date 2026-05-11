#!/usr/bin/env node
/**
 * MCTS self-play — Phase C of AlphaZero-Skirbo.
 *
 * Runs games where both players pick actions via pickMctsAction with
 * training-time knobs (rootTemp=1.0 → visits-proportional sampling,
 * dirichletEps=0.25 → exploration noise at root). At every MCTS-driven
 * decision we record a tuple {features, π_MCTS visit distribution, z game
 * outcome, playerNum} into learnings.policyBuffer; `z` is filled in at game
 * end per sample. These tuples are the training targets for the policy head
 * and a re-anchoring signal for the value head.
 *
 * Architecture mirrors runLadderGame in eval-ladder.js (single harness +
 * builder, same deadlock/stuck-loop breakers, phase-gate auto-resolution).
 * Difference: both sides share one `learnings` object, MCTS runs on every
 * strategic decision, and we record the visit distribution per decision.
 *
 * Usage:
 *   node tests/headless/mcts-selfplay.js <learnings-path> [numGames] [--mcts=N] [--map=name]
 *       [--output=<policy-buf-path>] [--weights-out=<out.json>] [--no-train] [--verbose]
 *       [--max-iters=N] [--root-temp=F] [--dirichlet-eps=F]
 *
 * Defaults: rootTemp=0.3, dirichletEps=0.05, dirichletAlpha=0.3, maxIters=4000
 *   - Cold-start (fresh Wp): low noise keeps games terminating. Once the policy
 *     head warms, scale rootTemp and eps up toward AlphaZero-spec (1.0, 0.25).
 *
 * Outputs: prints game-level summary + policy buffer stats. Policy buffer
 * gets persisted to <output-path> (default ./tests/headless/policy-buffer.json).
 * Caller (train.js, for now) can then run policyUpdate(learnings).
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { readFileSync } from 'fs';

import {
  loadLearnings, saveLearnings, pickAgentAction,
  extractFeatures, abstractActionType, ABSTRACT_TYPES,
  addPolicySample, finalizePolicyGameOutcome,
  savePolicyBuffer, loadPolicyBuffer,
  policyUpdate,
} from './learnings.js';
import { pickMctsAction } from '../../src/ai/mcts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const MAX_ITERATIONS = 50000;
const DEFAULT_POLICY_BUF_PATH = join(__dirname, 'policy-buffer.json');

// Match eval-ladder's neutral strategy exactly — keeps DQN fallback behavior
// identical between eval and self-play, so MCTS is the only lever.
const NEUTRAL_STRATEGY = {
  rewardMultipliers: { vp: 1, dmg: 1, hp: 1, dist: 1, terminal: 1 },
  actionPreferences: {
    attack_close: 0.2, attack_ranged: 0.2,
    move_toward: 0.15, move_away: -0.1, move_lateral: 0, move_done: 0,
    start_move: 0.1, activate: 0.3, end_activation: -0.2, pass: -0.3,
    ability: 0.1, spend_surge: 0.1, skip_surges: 0, reroll: 0,
    gate: 0, combat_flow: 0, other: 0,
  },
  epsilon: 0.05,
};

const SILENCED_ERRORS = [
  'Failed to update DC card after End Activation',
  'Failed to ready DC embed',
  'Failed to send End Turn prompt',
  'Failed to update DC card:',
  'Failed to dispatch next massive push',
  'Failed to render minimap',
];
const _origConsoleError = console.error;
console.error = function (msg, ...rest) {
  const s = typeof msg === 'string' ? msg : String(msg);
  for (const pat of SILENCED_ERRORS) if (s.startsWith(pat)) return;
  _origConsoleError.call(console, msg, ...rest);
};

// MCTS scope — same as eval-ladder.js. Tactical within-activation choices
// (move_pick_space, surge spend, reroll) skip MCTS and fall through to DQN.
const MCTS_TRIGGER_TYPES = new Set([
  'activate_dc', 'attack_target', 'dc_special',
  'pass_activation_turn',
  'play_cc', 'play_cc_special', 'play_cc_double',
  'interact',
]);

function loadTestDecks() {
  return JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));
}

function makeNeutralAgent(id, army) {
  return {
    id, name: id, affiliation: 'neutral',
    elo: 1500, generation: 0, createdAtGame: 0, parentIds: [],
    strategy: NEUTRAL_STRATEGY, army,
    stats: { games: 0, wins: 0, losses: 0, winStreak: 0, bestElo: 1500 },
    eloHistory: [],
  };
}

/**
 * Aggregate MCTS visit counts (per concrete action) into a NUM_ACTIONS-sized
 * target distribution over abstract action types. This matches the policy
 * head's output space.
 */
function visitsToPiTarget(rootActions, rootVisits, game) {
  const NUM_ACTIONS = ABSTRACT_TYPES.length;
  const pi = new Array(NUM_ACTIONS).fill(0);
  let total = 0;
  for (let i = 0; i < rootActions.length; i++) {
    const absType = abstractActionType(rootActions[i], game);
    const idx = ABSTRACT_TYPES.indexOf(absType);
    if (idx >= 0) {
      pi[idx] += rootVisits[i];
      total += rootVisits[i];
    }
  }
  if (total > 0) for (let k = 0; k < NUM_ACTIONS; k++) pi[k] /= total;
  return { pi, totalVisits: total };
}

/**
 * Run one self-play game. Records per-decision policy samples into
 * learnings.policyBuffer; z filled in at the end.
 *
 * Noise defaults are conservative: rootTemp=0.5 picks visit-weighted (not
 * pure argmax) while staying aggressive; dirichletEps=0.10 adds small root
 * exploration. Full AlphaZero-spec noise (rootTemp=1.0, eps=0.25) was found
 * to prevent Skirbo games from terminating (too many undamaging actions) —
 * so we stay closer to argmax until we have a trained policy head, then can
 * scale noise up.
 */
async function runSelfPlayGame(learnings, army, opts = {}) {
  const numSims = opts.numSims || 25;
  const rootTemp = opts.rootTemp ?? 0.3;
  const dirichletEps = opts.dirichletEps ?? 0.05;
  const dirichletAlpha = opts.dirichletAlpha ?? 0.3;
  const map = opts.map || 'mos-eisley-outskirts';
  const variant = opts.variant || 'a';
  // Forced-draw cap: self-play games that wander past this iter count are
  // truncated with winner=null and whatever VP each side has. Keeps a noisy
  // policy from stalling the whole training run.
  const maxIters = opts.maxIters ?? 4000;
  // Asymmetric mode: only one side uses MCTS, the other plays DQN-argmax.
  // Guarantees natural termination (per Phase B) while still generating
  // training data from the MCTS side. Useful for cold-start warm-up before
  // full symmetric self-play.
  const mctsSide = opts.mctsSide ?? 'both'; // 'both' | 1 | 2

  const agentP1 = makeNeutralAgent('p1', army);
  const agentP2 = makeNeutralAgent('p2', army);
  const armyList = army.dcList.map(n => ({ dcName: n }));

  let builder = createTestGame()
    .withMap(map).withMissionVariant(variant)
    .withPlayer1Army(armyList).withPlayer2Army(armyList);
  if (army.ccList?.length > 0) {
    builder = builder.withPlayer1CcDeck(army.ccList).withPlayer2CcDeck(army.ccList);
  }

  const { harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } =
    builder.inRound(1).build();
  const hDeps = harness.getDeps();
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  const gameTag = `sp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const iterLog = opts.iterLog | 0;
  const _iterStart = Date.now();
  let decisionsRecorded = 0;
  let mctsCallsAttempted = 0;
  let mctsCallsFallback = 0;

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;
  let deadlockBreaks = 0;
  let stuckBreaks = 0;
  let totalActions = 0;
  let sameCustomIdCount = 0;
  let lastCustomId = null;
  let stuckBailCount = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;
    if (i >= maxIters) break; // forced-draw cap — self-play doesn't wander forever

    if (iterLog > 0 && i > 0 && i % iterLog === 0) {
      const secs = ((Date.now() - _iterStart) / 1000).toFixed(1);
      const tpid = g.currentActivationTurnPlayerId ?? g.initiativePlayerId;
      const tpn = tpid === g.player1Id ? 1 : 2;
      const vp1 = g.victoryPoints?.[1] ?? 0;
      const vp2 = g.victoryPoints?.[2] ?? 0;
      console.log(`    [iter ${i}] ${secs}s | round=${g.round} phase=${g.phase} tp=${tpn} VP=${vp1}-${vp2} dec=${decisionsRecorded} mcts=${mctsCallsAttempted} sameCid=${sameCustomIdCount}`);
    }

    if (i > 0 && i % 200 === 0) {
      if (g.undoStack) g.undoStack = [];
      if (g.eventLog) g.eventLog = [];
      if (g.actionHistory) g.actionHistory = [];
      if (hDeps._actionLog) hDeps._actionLog.length = 0;
      if (hDeps._client?._sentMessages) hDeps._client._sentMessages.length = 0;
      if (hDeps._client?._channelCache) {
        for (const ch of hDeps._client._channelCache.values()) {
          if (ch._sentMessages) ch._sentMessages.length = 0;
          if (ch._messageStore) ch._messageStore.clear();
        }
      }
      const hMessages = harness.getMessages();
      if (hMessages) hMessages.length = 0;
    }

    const p1Actions = getAvailableActions(g, 1, actionDeps);
    const p2Actions = getAvailableActions(g, 2, actionDeps);
    const allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      if (a.type === 'phase_gate_unready') return false;
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        return canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps);
      }
      return true;
    });

    if (allActions.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty > 10) {
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Deadlock breaker');
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Deadlock breaker');
        } else break;
        consecutiveEmpty = 0;
        deadlockBreaks++;
      }
      continue;
    }
    consecutiveEmpty = 0;

    if (allActions.length > 0 && allActions.every(a => a.type === lastActionType)) {
      sameTypeCount++;
      if (sameTypeCount > 30) {
        for (const key of Object.keys(g)) {
          if (key.startsWith('pending') && g[key] != null && key !== 'pendingCombat') {
            g[key] = key.endsWith('Choice') ? {} : null;
          }
        }
        const p2Figs = Object.keys(g.figurePositions?.[2] || {});
        const p1Figs = Object.keys(g.figurePositions?.[1] || {});
        if (p2Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stuck-state breaker');
        } else if (p1Figs.length > 0) {
          await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stuck-state breaker');
        }
        sameTypeCount = 0; lastActionType = null;
        stuckBreaks++;
        continue;
      }
    } else {
      sameTypeCount = 0;
      lastActionType = allActions[0]?.type;
    }

    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) {
      failedMoves.clear();
    }

    const filteredActions = allActions.filter(a => {
      if (a.type === 'move_figure' && failedMoves.has(a.customId)) return false;
      return true;
    });
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);

    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const MANDATORY = ['phase_gate_ready', 'combat_gate', 'combat_roll',
        'dc_ability_choice', 'celebration_play', 'celebration_pass',
        'pounce_space', 'missile_salvo_die', 'missile_salvo_done',
        'power_token_choice', 'cover_fire_block', 'cover_fire_skip',
        'spread_pain_cond', 'negation_play', 'negation_let_resolve'];
      const turnMandatory = turnActions.some(a => MANDATORY.includes(a.type));
      const otherMandatory = otherActions.some(a => MANDATORY.includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const agent = actingPN === 1 ? agentP1 : agentP2;

    // Gate MCTS to strategic decisions only (same heuristic as eval-ladder).
    let strategicCount = 0;
    for (const a of playerActions) {
      if (MCTS_TRIGGER_TYPES.has(a.type)) strategicCount++;
      if (strategicCount >= 2) break;
    }

    let action = null;
    let recordedThisStep = false;

    const useMcts = strategicCount >= 2 &&
      (mctsSide === 'both' || mctsSide === actingPN);

    if (useMcts) {
      mctsCallsAttempted++;
      try {
        const mctsResult = await pickMctsAction({
          game: g, playerNum: actingPN, actionDeps,
          learnings, harness,
          dcHealthState, dcExhaustedState, dcMessageMeta,
          numSims, cPuct: 1.4, temp: 1.0,
          rootTemp, dirichletAlpha, dirichletEps,
        });
        if (mctsResult?.action && mctsResult.stats?.rootVisits) {
          action = mctsResult.action;
          const { pi, totalVisits } = visitsToPiTarget(
            mctsResult.stats.rootActions ?? playerActions,
            mctsResult.stats.rootVisits, g
          );
          // Skip recording pathological edge cases: 0 total visits (shortCircuit=true
          // on 1-legal-action), or the π that would be saved is all-zero.
          if (totalVisits > 0 && pi.some(x => x > 0)) {
            const features = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
            addPolicySample(learnings, features, pi, actingPN, gameTag);
            decisionsRecorded++;
            recordedThisStep = true;
          }
        }
      } catch {
        mctsCallsFallback++;
      }
    }
    if (!action) {
      action = pickAgentAction(agent, playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
    }
    if (!action) continue;

    if (action.customId === lastCustomId) {
      sameCustomIdCount++;
      if (sameCustomIdCount > 15) {
        const alternatives = playerActions.filter(a => a.customId !== action.customId);
        if (alternatives.length > 0) {
          action = alternatives[Math.floor(Math.random() * alternatives.length)];
          sameCustomIdCount = 0;
          lastCustomId = action.customId;
        } else {
          stuckBailCount++;
          if (stuckBailCount > 3) break;
        }
      }
    } else {
      sameCustomIdCount = 0;
      lastCustomId = action.customId;
    }

    if (action.type === 'move_figure') lastMoveId = action.customId;

    if (action.type === 'play_cc' || action.type === 'play_cc_special' || action.type === 'play_cc_double') {
      try {
        if (action.type === 'play_cc_special' || action.type === 'play_cc_double') {
          const actData = g.dcActionsData?.[action.params.msgId];
          if (actData && typeof actData.remaining === 'number') {
            if (action.type === 'play_cc_special') actData.remaining = Math.max(0, actData.remaining - 1);
            else actData.remaining = 0;
          }
        }
        await playCommandCardHeadless(g, action.actingPlayer, action.params.cardName, hDeps);
      } catch { /* CC play failed */ }
      continue;
    }

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    try {
      await harness.submitAction(action.customId, userId);
      totalActions++;
    } catch { /* handler crashed */ }
  }

  const finalGame = harness.getGame();
  const p1Vp = finalGame.victoryPoints?.[1] ?? 0;
  const p2Vp = finalGame.victoryPoints?.[2] ?? 0;
  const winnerId = finalGame.winnerId;
  const winnerPN = !winnerId ? null : (winnerId === finalGame.player1Id ? 1 : 2);

  const finalized = finalizePolicyGameOutcome(learnings, gameTag, winnerPN);

  return {
    ended: !!finalGame.ended,
    winnerPN, p1Vp, p2Vp, rounds: finalGame.round || 0,
    totalActions, deadlockBreaks, stuckBreaks,
    decisionsRecorded, finalized,
    mctsCallsAttempted, mctsCallsFallback,
  };
}

function parseArgs(argv) {
  const args = {
    numGames: 1, numSims: 25, verbose: false,
    output: DEFAULT_POLICY_BUF_PATH, map: undefined,
    train: true, weightsOut: null,
  };
  const pos = [];
  for (const a of argv) {
    if (a.startsWith('--mcts=')) args.numSims = parseInt(a.slice(7), 10) || 25;
    else if (a.startsWith('--games=')) args.numGames = parseInt(a.slice(8), 10) || 1;
    else if (a.startsWith('--map=')) args.map = a.slice(6);
    else if (a.startsWith('--output=')) args.output = resolve(a.slice(9));
    else if (a.startsWith('--weights-out=')) args.weightsOut = resolve(a.slice(14));
    else if (a.startsWith('--max-iters=')) args.maxIters = parseInt(a.slice(12), 10) || 4000;
    else if (a.startsWith('--root-temp=')) args.rootTemp = parseFloat(a.slice(12));
    else if (a.startsWith('--dirichlet-eps=')) args.dirichletEps = parseFloat(a.slice(16));
    else if (a.startsWith('--mcts-side=')) {
      const v = a.slice(12);
      args.mctsSide = (v === '1' || v === '2') ? parseInt(v, 10) : 'both';
    }
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--no-train') args.train = false;
    else pos.push(a);
  }
  if (pos.length > 0) args.learningsPath = resolve(pos[0]);
  if (pos.length > 1 && /^\d+$/.test(pos[1])) args.numGames = parseInt(pos[1], 10);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.learningsPath) {
    console.error('Usage: node tests/headless/mcts-selfplay.js <learnings-path> [numGames] [--mcts=N] [--map=name] [--output=policy-buf-path] [--weights-out=learnings-out-path] [--no-train] [--verbose]');
    process.exit(1);
  }

  console.log('=== MCTS Self-Play (Phase C) ===');
  console.log(`Learnings : ${args.learningsPath}`);
  console.log(`Games     : ${args.numGames}`);
  console.log(`MCTS sims : ${args.numSims}`);
  console.log(`Output    : ${args.output}`);
  console.log('');

  const learnings = loadLearnings(args.learningsPath);
  if (!learnings.network?.Wp) {
    console.error('[self-play] network has no policy head (Wp/bp) — loadLearnings migration should have added it. Aborting.');
    process.exit(2);
  }
  // Load existing policy buffer if present — accumulate across runs.
  loadPolicyBuffer(learnings, args.output);
  console.log(`Starting policy buffer: ${learnings.policyBuffer.samples.length} samples (lifetime ${learnings.policyBuffer.count})`);

  const testDecks = loadTestDecks();
  const startSamples = learnings.policyBuffer.samples.length;
  const startTime = Date.now();

  let p1Wins = 0, p2Wins = 0, draws = 0;
  let cumDecisions = 0, cumMctsCalls = 0;

  for (let i = 0; i < args.numGames; i++) {
    const deck = testDecks[i % testDecks.length];
    const result = await runSelfPlayGame(learnings, deck, {
      numSims: args.numSims,
      rootTemp: args.rootTemp ?? 0.5,
      dirichletEps: args.dirichletEps ?? 0.10,
      dirichletAlpha: 0.3,
      map: args.map,
      iterLog: args.verbose ? 500 : 0,
      maxIters: args.maxIters ?? 4000,
      mctsSide: args.mctsSide ?? 'both',
    });

    if (result.winnerPN === 1) p1Wins++;
    else if (result.winnerPN === 2) p2Wins++;
    else draws++;
    cumDecisions += result.decisionsRecorded;
    cumMctsCalls += result.mctsCallsAttempted;

    // Run the policy-head update after each game so learnings.network.Wp/bp
    // and the shared trunk actually move. Skip with --no-train if caller wants
    // to just accumulate buffer for external training.
    let policyStats = null;
    if (args.train) {
      const ps0 = learnings.trainingStats.policyStats;
      const before = ps0 ? { ce: ps0.avgPolicyCE, mse: ps0.avgValueMSE, ent: ps0.avgEntropy, upd: ps0.totalUpdates } : null;
      policyUpdate(learnings);
      const ps1 = learnings.trainingStats.policyStats;
      if (ps1) {
        policyStats = {
          ce: ps1.avgPolicyCE.toFixed(4),
          mse: ps1.avgValueMSE.toFixed(4),
          ent: ps1.avgEntropy.toFixed(4),
          updDelta: ps1.totalUpdates - (before?.upd ?? 0),
        };
      }
    }

    // Persist buffer + (optionally) weights after every game so a crash
    // doesn't lose accumulated self-play data.
    savePolicyBuffer(learnings, args.output);
    if (args.weightsOut) saveLearnings(learnings, args.weightsOut);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const trainTag = policyStats
      ? ` train{ce=${policyStats.ce} mse=${policyStats.mse} ent=${policyStats.ent} upd+${policyStats.updDelta}}`
      : '';
    console.log(
      `  game ${i + 1}/${args.numGames}: winner=${result.winnerPN ?? 'draw'} VP=${result.p1Vp}-${result.p2Vp} ` +
      `rounds=${result.rounds} actions=${result.totalActions} ` +
      `decisions=${result.decisionsRecorded} (finalized=${result.finalized}) ` +
      `mctsCalls=${result.mctsCallsAttempted} (fallback=${result.mctsCallsFallback})` +
      `${trainTag} [${elapsed}s]`
    );
  }

  const endTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const endSamples = learnings.policyBuffer.samples.length;
  const totalAdded = endSamples - startSamples;

  console.log('');
  console.log('=== Summary ===');
  console.log(`Games        : ${args.numGames} (p1=${p1Wins} p2=${p2Wins} draws=${draws})`);
  console.log(`Decisions    : ${cumDecisions} recorded (${cumMctsCalls} MCTS calls total)`);
  console.log(`Policy buffer: ${endSamples} samples (+${totalAdded} this run, lifetime ${learnings.policyBuffer.count})`);
  console.log(`Wall clock   : ${endTime}s`);

  savePolicyBuffer(learnings, args.output);
  console.log(`Saved buffer → ${args.output}`);
  if (args.weightsOut) {
    saveLearnings(learnings, args.weightsOut);
    console.log(`Saved weights → ${args.weightsOut}`);
  }
  const ps = learnings.trainingStats.policyStats;
  if (ps) {
    console.log(
      `Policy stats : updates=${ps.totalUpdates} avgCE=${ps.avgPolicyCE.toFixed(4)} ` +
      `avgValueMSE=${ps.avgValueMSE.toFixed(4)} avgEntropy=${ps.avgEntropy.toFixed(4)}`
    );
  }
}

// When invoked directly, run the CLI. When imported, only expose the runner.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch(err => { console.error('ERROR:', err); process.exit(1); });
}

export { runSelfPlayGame, visitsToPiTarget };
