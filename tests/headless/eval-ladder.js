/**
 * Elo ladder: head-to-head eval between two frozen brain checkpoints.
 *
 * Unlike arena-train.js (evolutionary, one shared brain + per-agent strategy),
 * this pits two neural checkpoints against each other directly. Same army on
 * both sides, same neutral strategy on both sides (mild engagement nudges +
 * small epsilon), no training updates during eval. Each turn's decision uses
 * the checkpoint belonging to the acting player.
 *
 * Color-balanced: even games A=P1, odd games A=P2. Running Elo computed with
 * K=16; 95% CI derived from binomial score variance through the logit
 * derivative.
 *
 * Usage:
 *   node tests/headless/eval-ladder.js <path-a> <path-b> [numGames] [--matchups=N] [--map=name] [--verbose]
 *   node tests/headless/eval-ladder.js learnings-data.json learnings-data.json 100         # self-match sanity
 *   node tests/headless/eval-ladder.js learnings-data.json checkpoints/learnings-6757-champion-pre-expansion.json 500
 *
 * Output: Running Elo for both sides, ΔElo ± 95% CI, per-matchup breakdown.
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

import { loadLearnings, pickAgentAction } from './learnings.js';
import { pickMctsAction } from '../../src/ai/mcts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const MAX_ITERATIONS = 50000;
const K_FACTOR = 16; // Lower K for eval — we want an estimate, not fast rating movement
const DEFAULT_YARDSTICK_ELO = 1500;

// Neutral strategy used on BOTH sides of the ladder. Non-zero prefs nudge the
// Q-tie deadlock (empty prefs + deterministic DQN → both sides pass immediately,
// round 1 ends at 0 VP). Values are hand-tuned mild nudges — enough to shape
// action-category selection toward engagement, small enough that the DQN's
// learned Q values still dominate meaningful decisions. Both sides identical
// for fairness.
const NEUTRAL_STRATEGY = {
  rewardMultipliers: { vp: 1, dmg: 1, hp: 1, dist: 1, terminal: 1 },
  actionPreferences: {
    attack_close: 0.2,
    attack_ranged: 0.2,
    move_toward: 0.15,
    move_away: -0.1,
    move_lateral: 0,
    move_done: 0,
    start_move: 0.1,
    activate: 0.3,
    end_activation: -0.2,
    pass: -0.3,
    ability: 0.1,
    spend_surge: 0.1,
    skip_surges: 0,
    reroll: 0,
    gate: 0,
    combat_flow: 0,
    other: 0,
  },
  epsilon: 0.05, // arena-train minimum; breaks handler-error loops deterministically
};

// Known-benign handler noise from Discord-only render paths hitting null
// channel stubs in headless eval. Silencing keeps the Elo signal readable.
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
  for (const pat of SILENCED_ERRORS) {
    if (s.startsWith(pat)) return;
  }
  _origConsoleError.call(console, msg, ...rest);
};

function loadTestDecks() {
  return JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));
}

function makeNeutralAgent(id, army) {
  return {
    id,
    name: id,
    affiliation: 'neutral',
    elo: DEFAULT_YARDSTICK_ELO,
    generation: 0,
    createdAtGame: 0,
    parentIds: [],
    strategy: NEUTRAL_STRATEGY,
    army,
    stats: { games: 0, wins: 0, losses: 0, winStreak: 0, bestElo: DEFAULT_YARDSTICK_ELO },
    eloHistory: [],
  };
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Run one frozen head-to-head game. No tracers, no training updates, no evolution.
 * Each turn's decision uses learningsForP1 or learningsForP2 based on acting player.
 */
async function runLadderGame(learningsForP1, learningsForP2, armyP1, armyP2, options = {}) {
  const mctsP1 = options.mctsP1 | 0;
  const mctsP2 = options.mctsP2 | 0;
  const agentP1 = makeNeutralAgent('p1', armyP1);
  const agentP2 = makeNeutralAgent('p2', armyP2);

  const p1Army = armyP1.dcList.map(n => ({ dcName: n }));
  const p2Army = armyP2.dcList.map(n => ({ dcName: n }));

  let builder = createTestGame()
    .withMap(options.map || 'mos-eisley-outskirts')
    .withMissionVariant(options.variant || 'a')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);

  if (armyP1.ccList?.length > 0) builder = builder.withPlayer1CcDeck(armyP1.ccList);
  if (armyP2.ccList?.length > 0) builder = builder.withPlayer2CcDeck(armyP2.ccList);

  const { harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
    .inRound(1)
    .build();

  const hDeps = harness.getDeps();

  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;
  let deadlockBreaks = 0;
  let stuckBreaks = 0;
  let totalActions = 0;
  // epsilon=0 means DQN picks the same customId deterministically from the same
  // state; any handler that throws-and-continues (Discord rendering failures)
  // leaves state unchanged and loops forever. Track exact-customId repetition
  // and force an alternative action (or bail) to guarantee progress.
  let sameCustomIdCount = 0;
  let lastCustomId = null;
  let stuckBailCount = 0;

  const _iterStart = Date.now();
  const _iterLog = options.iterLog | 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    if (_iterLog > 0 && i > 0 && i % _iterLog === 0) {
      const secs = ((Date.now() - _iterStart) / 1000).toFixed(1);
      const tpid = g.currentActivationTurnPlayerId ?? g.initiativePlayerId;
      const tpn = tpid === g.player1Id ? 1 : 2;
      const vp1 = g.victoryPoints?.[1] ?? 0;
      const vp2 = g.victoryPoints?.[2] ?? 0;
      console.log(`      [iter ${i}] ${secs}s | round=${g.round} phase=${g.phase} tp=${tpn} VP=${vp1}-${vp2} lastAction=${lastActionType} sameCid=${sameCustomIdCount} stuckBail=${stuckBailCount}`);
    }

    // OOM prevention (same pattern as arena-train.js)
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
        sameTypeCount = 0;
        lastActionType = null;
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
      const MANDATORY = ['phase_gate_ready', 'combat_ready', 'combat_roll',
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
    const brainForTurn = actingPN === 1 ? learningsForP1 : learningsForP2;

    const mctsNForPlayer = actingPN === 1 ? mctsP1 : mctsP2;
    // MCTS only where it pays for itself — big between-activation choices that
    // DQN alone plateaus on. Within-activation tactical choices (move_pick_*,
    // surge spending, combat rerolls) have either huge branching (movement) or
    // very local impact (reroll/surge); MCTS lookahead is wasted budget there.
    // Limiting to strategic *decision points* keeps per-game wall-clock
    // tractable and aligns with the Phase-B hypothesis that activation / target
    // selection is where search helps.
    const MCTS_TRIGGER_TYPES = new Set([
      'activate_dc',        // which DC to activate next
      'attack_target',      // which enemy to attack
      'dc_special',         // ability use
      'pass_activation_turn',
      'play_cc', 'play_cc_special', 'play_cc_double',
      'interact',
    ]);
    let strategicCount = 0;
    for (const a of playerActions) {
      if (MCTS_TRIGGER_TYPES.has(a.type)) strategicCount++;
      if (strategicCount >= 2) break;
    }
    let action = null;
    if (mctsNForPlayer > 0 && strategicCount >= 2) {
      try {
        const mctsResult = await pickMctsAction({
          game: g, playerNum: actingPN, actionDeps,
          learnings: brainForTurn, harness,
          dcHealthState, dcExhaustedState, dcMessageMeta,
          numSims: mctsNForPlayer, cPuct: 1.4, temp: 1.0,
        });
        action = mctsResult?.action ?? null;
      } catch { /* MCTS failed — fall through to DQN */ }
    }
    if (!action) {
      action = pickAgentAction(agent, playerActions, g, brainForTurn, actingPN, dcHealthState, dcMessageMeta);
    }
    if (!action) continue;

    // Repetition-breaker: epsilon=0 DQN can loop on same customId when a handler
    // has a benign Discord-render error (state advances imperceptibly but the
    // dominant Q-value is unchanged). Force a different action after N repeats;
    // bail the whole game if we still can't escape.
    if (action.customId === lastCustomId) {
      sameCustomIdCount++;
      if (sameCustomIdCount > 15) {
        const alternatives = playerActions.filter(a => a.customId !== action.customId);
        if (alternatives.length > 0) {
          action = alternatives[Math.floor(Math.random() * alternatives.length)];
          // Reset counter: without this, lastCustomId stays pinned to the
          // stuck customId and the next iter's DQN re-pick (same preferred
          // action) triggers the breaker every iter — the counter climbs
          // forever and no stuckBail ever accumulates.
          sameCustomIdCount = 0;
          lastCustomId = action.customId;
        } else {
          stuckBailCount++;
          if (stuckBailCount > 3) break; // truly stuck — bail with whatever VP we have
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
    } catch { /* handler crashed — fall through */ }
  }

  const finalGame = harness.getGame();
  const p1Vp = finalGame.victoryPoints?.[1] ?? 0;
  const p2Vp = finalGame.victoryPoints?.[2] ?? 0;
  const winnerId = finalGame.winnerId;

  return {
    ended: !!finalGame.ended,
    winnerSide: !winnerId ? null : (winnerId === finalGame.player1Id ? 1 : 2),
    p1Vp,
    p2Vp,
    rounds: finalGame.round || 0,
    deadlockBreaks,
    stuckBreaks,
    totalActions,
  };
}

/**
 * Run the full ladder: N games, color-balanced, matchup-rotated.
 */
async function runLadder(learningsA, learningsB, numGames, testDecks, options = {}) {
  const matchupCount = Math.min(options.matchups || 1, testDecks.length);
  const selectedDecks = testDecks.slice(0, matchupCount);

  const results = {
    games: 0,
    // Win rate from A's perspective
    aWins: 0, bWins: 0, draws: 0,
    vpDeltaSum: 0, // (A's VP - B's VP) summed; A-perspective
    perMatchup: {}, // keyed by deckName
    // Running Elo (A = 1500 start, B = 1500 start, K=16)
    eloA: DEFAULT_YARDSTICK_ELO,
    eloB: DEFAULT_YARDSTICK_ELO,
  };

  const startTime = Date.now();

  for (let i = 0; i < numGames; i++) {
    const deck = selectedDecks[i % selectedDecks.length];
    // Color balance: even games A=P1, odd games A=P2
    const aAsP1 = (i % 2 === 0);
    const learningsForP1 = aAsP1 ? learningsA : learningsB;
    const learningsForP2 = aAsP1 ? learningsB : learningsA;

    let gameResult;
    try {
      // A = side using mctsA sims; B = side using mctsB sims. Mirror when A is P2.
      const mctsP1 = aAsP1 ? (options.mctsA | 0) : (options.mctsB | 0);
      const mctsP2 = aAsP1 ? (options.mctsB | 0) : (options.mctsA | 0);
      gameResult = await runLadderGame(learningsForP1, learningsForP2, deck, deck, {
        map: options.map,
        variant: options.variant,
        mctsP1,
        mctsP2,
        iterLog: options.iterLog,
      });
    } catch (err) {
      gameResult = { ended: false, winnerSide: null, p1Vp: 0, p2Vp: 0, rounds: 0 };
    }

    results.games++;

    // Translate to A's perspective
    const aVp = aAsP1 ? gameResult.p1Vp : gameResult.p2Vp;
    const bVp = aAsP1 ? gameResult.p2Vp : gameResult.p1Vp;
    const aSide = aAsP1 ? 1 : 2;
    const aWon = gameResult.winnerSide === aSide;
    const bWon = gameResult.winnerSide !== null && gameResult.winnerSide !== aSide;
    const drew = gameResult.winnerSide === null;

    if (aWon) results.aWins++;
    else if (bWon) results.bWins++;
    else results.draws++;

    results.vpDeltaSum += (aVp - bVp);

    // Elo update
    const scoreA = aWon ? 1.0 : (drew ? 0.5 : 0.0);
    const expA = expectedScore(results.eloA, results.eloB);
    results.eloA += K_FACTOR * (scoreA - expA);
    results.eloB += K_FACTOR * ((1 - scoreA) - (1 - expA));

    // Per-matchup tracking
    const mu = results.perMatchup[deck.name] || { games: 0, aWins: 0, bWins: 0, draws: 0, vpDelta: 0 };
    mu.games++;
    if (aWon) mu.aWins++;
    else if (bWon) mu.bWins++;
    else mu.draws++;
    mu.vpDelta += (aVp - bVp);
    results.perMatchup[deck.name] = mu;

    if (options.verbose) {
      console.log(`    game ${i + 1}: aAsP1=${aAsP1} | p1VP=${gameResult.p1Vp} p2VP=${gameResult.p2Vp} | winnerSide=${gameResult.winnerSide} | ended=${gameResult.ended} rounds=${gameResult.rounds} | actions=${gameResult.totalActions} deadlocks=${gameResult.deadlockBreaks} stuck=${gameResult.stuckBreaks} | aWon=${aWon} bWon=${bWon} drew=${drew}`);
    }

    // Progress
    if ((i + 1) % 10 === 0 || i === numGames - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const eloDelta = (results.eloA - results.eloB).toFixed(1);
      const winPctA = (100 * results.aWins / results.games).toFixed(1);
      const avgVpDelta = (results.vpDeltaSum / results.games).toFixed(2);
      console.log(
        `  [${i + 1}/${numGames}] ${elapsed}s | A=${results.aWins}W ${results.bWins}L ${results.draws}D (${winPctA}%) | ΔVP ${avgVpDelta} | ΔElo ${eloDelta}`
      );
    }
  }

  return results;
}

/**
 * 95% CI for Elo delta estimated via standard formula.
 * SE(Elo) ≈ 400 / √N for a two-player comparison near 50%.
 * Wider when win% far from 50%.
 */
function eloConfidenceInterval(aWins, bWins, draws) {
  const n = aWins + bWins + draws;
  if (n === 0) return { se: Infinity, ci95: Infinity };
  // Effective score
  const score = (aWins + 0.5 * draws) / n;
  // Variance of score
  // Binomial-ish: p(1-p)/n — draws contribute 0.25 instead of pq
  const variance = (aWins * (1 - score) ** 2 + bWins * (0 - score) ** 2 + draws * (0.5 - score) ** 2) / (n * n);
  const se = Math.sqrt(variance);
  // Convert score-SE to Elo-SE via derivative of logit at current score
  // d(Elo)/d(score) = 400 / (ln(10) * p * (1-p))
  const pClamp = Math.max(0.01, Math.min(0.99, score));
  const dEloDscore = 400 / (Math.log(10) * pClamp * (1 - pClamp));
  const seElo = se * dEloDscore;
  return { se: seElo, ci95: 1.96 * seElo };
}

async function main() {
  const args = process.argv.slice(2).filter(a => a);
  const positional = args.filter(a => !a.startsWith('-'));
  const flags = args.filter(a => a.startsWith('-'));

  if (positional.length < 2) {
    console.error('Usage: node tests/headless/eval-ladder.js <path-a> <path-b> [numGames=100] [--matchups=N] [--map=name] [--mcts-a=N] [--mcts-b=N]');
    process.exit(1);
  }

  const pathA = resolve(positional[0]);
  const pathB = resolve(positional[1]);
  const numGames = parseInt(positional[2] || '100', 10);
  const matchupsFlag = flags.find(f => f.startsWith('--matchups='));
  const mapFlag = flags.find(f => f.startsWith('--map='));
  const variantFlag = flags.find(f => f.startsWith('--variant='));
  const mctsAFlag = flags.find(f => f.startsWith('--mcts-a='));
  const mctsBFlag = flags.find(f => f.startsWith('--mcts-b='));
  const matchups = matchupsFlag ? parseInt(matchupsFlag.split('=')[1], 10) : 1;
  const mctsA = mctsAFlag ? parseInt(mctsAFlag.split('=')[1], 10) : 0;
  const mctsB = mctsBFlag ? parseInt(mctsBFlag.split('=')[1], 10) : 0;

  const learningsA = loadLearnings(pathA);
  const learningsB = loadLearnings(pathB);

  console.log(`Ladder: A=${pathA} (${learningsA.meta?.totalGames ?? '?'}g) vs B=${pathB} (${learningsB.meta?.totalGames ?? '?'}g)`);
  console.log(`Games: ${numGames} | Matchups: ${matchups} | K: ${K_FACTOR} | MCTS: A=${mctsA}sims B=${mctsB}sims`);

  const testDecks = loadTestDecks();
  const verbose = flags.includes('--verbose');
  const iterLogFlag = flags.find(f => f.startsWith('--iter-log='));
  const iterLog = iterLogFlag ? parseInt(iterLogFlag.split('=')[1], 10) : 0;
  const results = await runLadder(learningsA, learningsB, numGames, testDecks, {
    matchups,
    map: mapFlag ? mapFlag.split('=')[1] : undefined,
    variant: variantFlag ? variantFlag.split('=')[1] : undefined,
    verbose,
    mctsA,
    mctsB,
    iterLog,
  });

  const eloDelta = results.eloA - results.eloB;
  const { se, ci95 } = eloConfidenceInterval(results.aWins, results.bWins, results.draws);
  const avgVpDelta = results.vpDeltaSum / results.games;
  const winRateA = results.aWins / results.games;

  console.log('\n=== LADDER RESULT ===');
  console.log(`Games: ${results.games}`);
  console.log(`A wins: ${results.aWins} (${(100 * winRateA).toFixed(1)}%)`);
  console.log(`B wins: ${results.bWins} (${(100 * results.bWins / results.games).toFixed(1)}%)`);
  console.log(`Draws:  ${results.draws} (${(100 * results.draws / results.games).toFixed(1)}%)`);
  console.log(`Avg VP delta (A - B): ${avgVpDelta.toFixed(2)}`);
  console.log(`Running Elo: A=${results.eloA.toFixed(1)}  B=${results.eloB.toFixed(1)}`);
  console.log(`Elo delta (A - B): ${eloDelta.toFixed(1)} ± ${ci95.toFixed(1)} (95% CI)`);
  console.log(`Interpretation: ${Math.abs(eloDelta) > ci95 ? 'SIGNIFICANT' : 'NOT significant'} at 95%`);

  if (matchups > 1) {
    console.log('\nPer matchup:');
    for (const [name, mu] of Object.entries(results.perMatchup)) {
      const winPct = (100 * mu.aWins / mu.games).toFixed(1);
      const vp = (mu.vpDelta / mu.games).toFixed(2);
      console.log(`  ${name}: ${mu.aWins}W ${mu.bWins}L ${mu.draws}D (${winPct}%) | ΔVP ${vp}`);
    }
  }
}

main().catch(err => {
  console.error('Ladder failed:', err);
  process.exit(1);
});
