/**
 * Headless A/B eval for Skirbo strategy experiments.
 *
 * Uses pickSmartAction (like train.js) for reliable headless games, with
 * optional overrides to isolate specific decision points:
 *
 *   --greedy    : override move_pick_space with "walk toward nearest enemy"
 *   --learned   : use WG move scorer from training (default pickSmartAction)
 *   --attack-pref : when attack is available but DQN chose movement, override to attack
 *
 * Usage:
 *   node tests/headless/eval-movement-ab.js 50 --learned
 *   node tests/headless/eval-movement-ab.js 50 --learned --attack-pref
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import {
  loadLearnings, createGameTracer, pickSmartAction, abstractActionType,
  extractFeatures, recordMatchResult, replayUpdate,
  setGreedyMode, getQValues,
} from './learnings.js';
import { getRange } from '../../src/game/spatial.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LEARNINGS_PATH = process.env.LEARNINGS_PATH
  ? join(__dirname, process.env.LEARNINGS_PATH)
  : join(__dirname, 'learnings-data.json');
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const TEST_DECKS = JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));

// Parse args
const args = process.argv.slice(2);
const numGames = parseInt(args.find(a => !a.startsWith('-')) || '50', 10);
const useGreedy = args.includes('--greedy');
const useLearned = args.includes('--learned');
const useAttackPref = args.includes('--attack-pref');
const armLabel = [
  useGreedy ? 'greedy' : 'learned',
  useAttackPref ? '+atkpref' : '',
].filter(Boolean).join('');

if (!useGreedy && !useLearned) {
  console.error('Usage: node eval-movement-ab.js <numGames> --greedy|--learned [--attack-pref]');
  process.exit(1);
}

// Movement types that the attack-pref heuristic will override
const MOVE_ACTION_TYPES = new Set(['move_figure', 'move_pick_space']);

function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

/**
 * Greedy movement heuristic (mirrors strategy.js logic):
 * Pick the space that minimizes distance to nearest enemy.
 * If no improvement, pick "done".
 */
function greedyMoveOverride(game, moveSpaces, moveDone, actingPN) {
  const enemyPn = actingPN === 1 ? 2 : 1;
  const enemyPositions = Object.values(game.figurePositions?.[enemyPn] || {}).filter(Boolean);
  if (enemyPositions.length === 0) return null; // no enemies, fall through

  // Current position
  const moveEntry = Object.values(game.moveInProgress || {})[0];
  const curPos = moveEntry?.currentPosition || moveEntry?.startCoord;
  let currentDist = Infinity;
  if (curPos) {
    const cp = String(curPos).toLowerCase();
    for (const ePos of enemyPositions) {
      const d = getRange(cp, String(ePos).toLowerCase());
      if (d < currentDist) currentDist = d;
    }
  }

  // Find best spaces
  const bestSpaces = [];
  let bestDist = Infinity;
  for (const a of moveSpaces) {
    const coord = String(a.params.coord).toLowerCase();
    let minEnemyDist = Infinity;
    for (const ePos of enemyPositions) {
      const d = getRange(coord, String(ePos).toLowerCase());
      if (d < minEnemyDist) minEnemyDist = d;
    }
    if (minEnemyDist < bestDist) {
      bestDist = minEnemyDist;
      bestSpaces.length = 0;
      bestSpaces.push(a);
    } else if (minEnemyDist === bestDist) {
      bestSpaces.push(a);
    }
  }

  // Only move if it strictly improves distance
  if (bestDist < currentDist) {
    return bestSpaces[Math.floor(Math.random() * bestSpaces.length)];
  }
  // No improvement — pick done if available
  if (moveDone.length > 0) return moveDone[0];
  return bestSpaces[Math.floor(Math.random() * bestSpaces.length)];
}

let greedyOverrideCount = 0;
let learnedMoveCount = 0;

// Attack-preference instrumentation (global across all games)
let atkAvailable = 0;         // decisions where attack_target was in the pool
let atkChosen = 0;            // DQN naturally chose attack
let atkAvailNotChosen = 0;    // attack available but DQN chose something else
let atkPrefOverrides = 0;     // --attack-pref actually fired (overrode movement→attack)
let qGapSum = 0;              // cumulative Q(start_move) - Q(attack_close)
let qGapCount = 0;            // number of Q-gap samples

async function runOneGame(learnings, gameNum) {
  const { p1Deck, p2Deck } = pickMatchup(gameNum);
  const p1Army = p1Deck.dcList.map(n => ({ dcName: n }));
  const p2Army = p2Deck.dcList.map(n => ({ dcName: n }));

  const builder = createTestGame()
    .lightweight()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army);

  if (p1Deck.ccList?.length > 0) builder.withPlayer1CcDeck(p1Deck.ccList);
  if (p2Deck.ccList?.length > 0) builder.withPlayer2CcDeck(p2Deck.ccList);

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = builder
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

  const tracer1 = createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
  const tracer2 = createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);

  let consecutiveEmpty = 0;
  const failedMoves = new Set();
  let lastMoveId = null;
  let sameTypeCount = 0;
  let lastActionType = null;

  let moveActions = 0;
  let endActivations = 0;
  let attackActions = 0;
  let totalActivations = 0;
  let passActivations = 0;
  let totalIterations = 0;
  let stopReason = 'normal';

  const ccFailureCounts = new Map();
  const CC_MAX_RETRIES = 3;

  let lastFingerprint = '';
  let noProgressCount = 0;
  const NO_PROGRESS_LIMIT = 40;

  function boardFingerprint(g) {
    const p1hp = dcHealthState ? [...dcHealthState.values()].reduce((s, arr) => {
      for (const fig of arr) if (fig) s += fig[0]; return s;
    }, 0) : 0;
    const p1figs = Object.keys(g.figurePositions?.[1] || {}).length;
    const p2figs = Object.keys(g.figurePositions?.[2] || {}).length;
    const p1vp = g.player1VP?.total || 0;
    const p2vp = g.player2VP?.total || 0;
    const activeDc = g.currentActivatingDcIndex ?? -1;
    const round = g.currentRound || 1;
    const phase = g.roundPhase || '?';
    const pending = g.pendingCombat ? 'C' : g.moveInProgress ? 'M' : g.phaseGate ? 'G' : '';
    const pos1 = Object.values(g.figurePositions?.[1] || {}).sort().join(',');
    const pos2 = Object.values(g.figurePositions?.[2] || {}).sort().join(',');
    return `${round}:${phase}:${p1vp}:${p2vp}:${p1figs}:${p2figs}:${p1hp}:${activeDc}:${pending}:${pos1}:${pos2}`;
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;

    if ((g.currentRound || 1) > MAX_ROUNDS) {
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
      stopReason = 'round_cap';
      if (p1vp > p2vp) g.winnerId = g.player1Id;
      else if (p2vp > p1vp) g.winnerId = g.player2Id;
      else {
        const p1Figs = Object.keys(g.figurePositions?.[1] || {}).length;
        const p2Figs = Object.keys(g.figurePositions?.[2] || {}).length;
        if (p1Figs > p2Figs) g.winnerId = g.player1Id;
        else if (p2Figs > p1Figs) g.winnerId = g.player2Id;
        else g.winnerId = null;
      }
      break;
    }

    // Auto-resolve phase gates
    if (g.phaseGate) {
      const gateId = `phase_gate_ready_${g.gameId}`;
      try { await harness.submitAction(gateId, g.player1Id); } catch {}
      if (g.phaseGate) {
        try { await harness.submitAction(gateId, g.player2Id); } catch {}
      }
      continue;
    }
    // Auto-resolve combat ready (session 11: read combat.acked instead)
    if (g.pendingCombat
        && (g.pendingCombat.currentStep === 'step1+2-attacker'
            || g.pendingCombat.currentStep === 'step1+2-defender')) {
      const _acked = g.pendingCombat.acked || {};
      const combatReadyId = `combat_ready_${g.gameId}`;
      if (!_acked[1]) {
        try { await harness.submitAction(combatReadyId, g.player1Id); } catch {}
      }
      if (g.pendingCombat && !(g.pendingCombat.acked || {})[2]) {
        try { await harness.submitAction(combatReadyId, g.player2Id); } catch {}
      }
      continue;
    }

    // No-progress detection
    const fp = boardFingerprint(g);
    if (fp === lastFingerprint) {
      noProgressCount++;
      if (noProgressCount >= NO_PROGRESS_LIMIT) {
        const p1vp = g.player1VP?.total || 0;
        const p2vp = g.player2VP?.total || 0;
        g.ended = true;
        stopReason = 'no_progress';
        if (p1vp > p2vp) g.winnerId = g.player1Id;
        else if (p2vp > p1vp) g.winnerId = g.player2Id;
        else {
          const p1F = Object.keys(g.figurePositions?.[1] || {}).length;
          const p2F = Object.keys(g.figurePositions?.[2] || {}).length;
          g.winnerId = p1F > p2F ? g.player1Id : p1F < p2F ? g.player2Id : null;
        }
        break;
      }
    } else {
      noProgressCount = 0;
      lastFingerprint = fp;
    }

    // Clear accumulated state periodically
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
    let allActions = [
      ...p1Actions.map(a => ({ ...a, actingPlayer: 1 })),
      ...p2Actions.map(a => ({ ...a, actingPlayer: 2 })),
    ].filter(a => {
      if (a.type === 'attack_target' && !a.params?.targetFigureKey) return false;
      if (a.type === 'phase_gate_unready') return false;
      if (a.type === 'interact' && a.params?.optionId === 'use_terminal') return false;
      if (a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double') {
        if (!canResolveCcHeadless(g, a.actingPlayer, a.params.cardName, hDeps)) return false;
        const ccKey = `P${a.actingPlayer}:${a.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        if ((ccFailureCounts.get(ccKey) || 0) >= CC_MAX_RETRIES) return false;
        return true;
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
      }
      continue;
    }
    consecutiveEmpty = 0;

    // Stuck-state detection
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
        continue;
      }
    } else {
      sameTypeCount = 0;
      lastActionType = allActions[0]?.type;
    }

    // Track failed moves
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

    // Determine acting player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);

    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_ready','combat_roll'].includes(a.type));
      if (otherMandatory && !turnMandatory) actingPN = otherPlayer;
      else actingPN = turnPlayer;
    } else {
      actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer;
    }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);
    const tracer = actingPN === 1 ? tracer1 : tracer2;
    tracer.beforeAction(g, playerActions);

    let action;

    // === MOVEMENT OVERRIDE: greedy arm intercepts move_pick_space decisions ===
    if (useGreedy) {
      const moveSpaces = playerActions.filter(a => a.type === 'move_pick_space' && !a.params?.done && a.params?.coord);
      const moveDone = playerActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
      if (moveSpaces.length > 0) {
        const override = greedyMoveOverride(g, moveSpaces, moveDone, actingPN);
        if (override) {
          action = override;
          greedyOverrideCount++;
        }
      }
    }

    // Default: use pickSmartAction (WG learned scorer for movement)
    if (!action) {
      action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
      if (action?.type === 'move_pick_space') learnedMoveCount++;
    }

    // === ATTACK PREFERENCE INSTRUMENTATION + OVERRIDE ===
    // Only instrument at the key decision point: when BOTH attack and move_figure
    // (start a new move) are available — this is the "attack or move?" decision.
    const attackPool = playerActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
    const hasMoveStart = playerActions.some(a => a.type === 'move_figure');
    if (attackPool.length > 0 && hasMoveStart && action) {
      atkAvailable++;
      if (action.type === 'attack_target') {
        atkChosen++;
      } else {
        atkAvailNotChosen++;
        // Override: when DQN chose to START a move but attack was available, force attack.
        // Gate: only fire when activeDcHasTargetsInRange=1 (feature 42), meaning
        // the active figure genuinely has enemies it can hit RIGHT NOW.
        // If targets aren't in range, moving to close distance is correct.
        let targetsInRange = false;
        try {
          const feats = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
          targetsInRange = feats[42] > 0.5;
        } catch {}
        if (useAttackPref && action.type === 'move_figure' && targetsInRange && Math.random() < 0.5) {
          const atkPick = pickSmartAction(attackPool, g, learnings, actingPN, dcHealthState, dcMessageMeta);
          if (atkPick) {
            action = atkPick;
            atkPrefOverrides++;
          }
        }
      }
      // Q-gap sample
      try {
        const features = extractFeatures(g, actingPN, dcHealthState, dcMessageMeta);
        const Q = getQValues(learnings, features);
        // attack_close=0, start_move=6
        qGapSum += Q[6] - Q[0];
        qGapCount++;
      } catch { /* feature extraction can fail in edge states */ }
    }

    if (!action) continue;

    // Track metrics
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') attackActions++;
    else if (action.type === 'activate_dc') totalActivations++;
    else if (action.type === 'pass_activation_turn') passActivations++;
    totalIterations++;

    // Intercept interact actions
    if (action.type === 'interact') {
      const p = action.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
        const optionId = p.optionId;
        if (optionId === 'retrieve_contraband') {
          g.figureContraband = g.figureContraband || {};
          g.figureContraband[p.figureKey] = true;
        } else if (optionId?.startsWith('launch_panel_')) {
          const parts = optionId.replace('launch_panel_', '').split('_');
          const coord = parts[0];
          const side = parts[1];
          g.launchPanelState = g.launchPanelState || {};
          g.launchPanelState[coord.toLowerCase()] = side;
          if (action.actingPlayer === 1) g.p1LaunchPanelFlippedThisRound = true;
          else g.p2LaunchPanelFlippedThisRound = true;
        } else if (optionId?.startsWith('open_door_')) {
          const edgeKeys = optionId.replace('open_door_', '').split(',');
          g.openedDoors = g.openedDoors || [];
          for (const ek of edgeKeys) {
            if (!g.openedDoors.includes(ek)) g.openedDoors.push(ek);
          }
        }
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    // Intercept CC plays
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
      } catch (err) {
        const ccKey = `P${action.actingPlayer}:${action.params.cardName}:R${g.currentRound || 1}:${g.roundPhase || '?'}:${g.currentActivatingDcIndex ?? 'x'}`;
        const count = (ccFailureCounts.get(ccKey) || 0) + 1;
        ccFailureCounts.set(ccKey, count);
      }
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    // Intercept strain_choice_discard
    if (action.type === 'strain_choice_discard') {
      const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
      try { await harness.submitAction(action.customId, userId); } catch {}
      let g2 = harness.getGame();
      let safetyLimit = 30;
      while (g2.pendingStrainChoice?.discardTarget > 0 &&
             (g2.pendingStrainChoice.discardedCount || 0) < g2.pendingStrainChoice.discardTarget &&
             safetyLimit-- > 0) {
        const hand = getCcHand(g2, g2.pendingStrainChoice.playerNum) || [];
        if (hand.length === 0) break;
        try {
          await harness.submitAction(
            `strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, userId,
          );
        } catch { break; }
        g2 = harness.getGame();
      }
      if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
      tracer.afterAction(harness.getGame(), action);
      continue;
    }

    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    try {
      await harness.submitAction(action.customId, userId);
      tracer.afterAction(harness.getGame(), action);
    } catch {
      tracer.afterAction(harness.getGame(), action);
    }
  }

  if (!harness.getGame().ended && stopReason === 'normal') {
    stopReason = 'max_iterations';
  }

  const finalGame = harness.getGame();
  const winnerLabel = finalGame.winnerId === finalGame.player1Id ? 'P1' :
                      finalGame.winnerId === finalGame.player2Id ? 'P2' : null;

  return {
    ended: finalGame.ended || false,
    winnerLabel,
    p1Army: p1Deck.name,
    p2Army: p2Deck.name,
    p1VP: finalGame.player1VP?.total || 0,
    p2VP: finalGame.player2VP?.total || 0,
    finalRound: finalGame.currentRound || 1,
    moveActions,
    attackActions,
    endActivations,
    totalActivations,
    passActivations,
    totalIterations,
    stopReason,
  };
}

async function main() {
  const learnings = loadLearnings(LEARNINGS_PATH);
  setGreedyMode(true); // No exploration noise in eval

  const moveWeights = learnings?.withinGroupWeights?.move;
  const maxMag = moveWeights ? Math.max(...moveWeights.map(Math.abs)).toFixed(3) : 'none';

  console.log(`\n=== A/B Eval: ${armLabel} ===`);
  console.log(`  Games: ${numGames}`);
  console.log(`  WG move max|w|: ${maxMag}`);
  console.log(`  Attack preference: ${useAttackPref ? 'ON' : 'OFF'}`);
  console.log(`  Prior games in checkpoint: ${learnings.meta?.totalGames || 0}`);

  let completed = 0, p1Wins = 0, p2Wins = 0;
  let totalVP = 0, totalRounds = 0;
  let totalMoves = 0, totalAttacks = 0, totalActs = 0;
  let totalIterations = 0;
  const stopReasons = {};
  const startTime = Date.now();

  for (let i = 0; i < numGames; i++) {
    const gameNum = i; // Fixed sequence for reproducibility
    const result = await runOneGame(learnings, gameNum);

    if (result.ended) {
      completed++;
      if (result.winnerLabel === 'P1') p1Wins++;
      if (result.winnerLabel === 'P2') p2Wins++;
    }

    totalVP += (result.p1VP || 0) + (result.p2VP || 0);
    totalRounds += result.finalRound || 1;
    totalMoves += result.moveActions || 0;
    totalAttacks += result.attackActions || 0;
    totalActs += result.totalActivations || 0;
    totalIterations += result.totalIterations || 0;
    stopReasons[result.stopReason] = (stopReasons[result.stopReason] || 0) + 1;

    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Game ${i + 1}/${numGames} (${elapsed}s) VP so far: ${totalVP}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const atkAvailRate = atkAvailable > 0 ? ((atkAvailNotChosen / atkAvailable) * 100).toFixed(1) : 'n/a';
  const avgQGap = qGapCount > 0 ? (qGapSum / qGapCount).toFixed(3) : 'n/a';
  const noProgressCount = stopReasons['no_progress'] || 0;

  console.log(`\n=== RESULTS: ${armLabel} (${numGames} games, ${elapsed}s) ===`);
  console.log(`  Completed: ${completed}/${numGames}`);
  console.log(`  Wins P1/P2: ${p1Wins}/${p2Wins}`);
  console.log(`  Total VP: ${totalVP} | VP/game: ${(totalVP / numGames).toFixed(2)}`);
  console.log(`  VP/round: ${(totalVP / totalRounds).toFixed(3)}`);
  console.log(`  Avg rounds/game: ${(totalRounds / numGames).toFixed(1)}`);
  console.log(`  Avg attacks/game: ${(totalAttacks / numGames).toFixed(1)}`);
  console.log(`  Avg moves/game: ${(totalMoves / numGames).toFixed(1)}`);
  console.log(`  Avg activations/game: ${(totalActs / numGames).toFixed(1)}`);
  console.log(`  Avg iterations/game: ${(totalIterations / numGames).toFixed(0)}`);
  console.log(`  Stop reasons: ${Object.entries(stopReasons).map(([r,c]) => `${r}:${c}`).join(' ')}`);
  console.log(`  Movement overrides: greedy=${greedyOverrideCount} learned=${learnedMoveCount}`);
  console.log(`  --- Attack preference diagnostics ---`);
  console.log(`  Attack available: ${atkAvailable} decisions`);
  console.log(`  Attack chosen (organic): ${atkChosen}`);
  console.log(`  Attack avail but not chosen: ${atkAvailNotChosen} (${atkAvailRate}%)`);
  console.log(`  Attack-pref overrides: ${atkPrefOverrides}`);
  console.log(`  Avg Q-gap (move-attack): ${avgQGap}`);
  console.log(`  No-progress games: ${noProgressCount}/${numGames}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
