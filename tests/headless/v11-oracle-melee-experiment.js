/**
 * v11 Oracle Melee Baseline — Diagnostic A/B experiment.
 *
 * Compares a hand-coded kill-focused melee oracle against the learned DQN
 * policy (greedy, epsilon=0) on the same 50-game matchup set.
 *
 * Oracle decision priority:
 *   1. Mandatory actions (gates, combat flow) — handle immediately
 *   2. Reactive sub-states (negation, strain, etc.) — handle immediately
 *   3. Combat sub-actions — always spend surges, then resolve
 *   4. Attack available → pick target with lowest current HP, then lowest max HP, then nearest
 *   5. Move available → move toward weakest reachable enemy
 *   6. Activate DC → pick DC closest to an enemy
 *   7. End activation → end
 *   8. Fallback → random
 *
 * Question being answered:
 *   "Does a simple focused-kill melee policy outperform the learned agent
 *    on actual scoreboard outcomes?"
 *
 * Usage: node tests/headless/v11-oracle-melee-experiment.js
 */
import { createTestGame } from '../fixtures/game-builder.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { getDcStats, getMapData, getDcEffects } from '../../src/data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../../src/game/movement.js';
import { getPlayableCcFromHand } from '../../src/game/cc-timing.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { parseCoord } from '../../src/game/coords.js';
import { getCcHand } from '../../src/game/player-helpers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  setEncoderType, loadLearnings, saveLearnings,
  createGameTracer, pickSmartAction, abstractActionType, extractFeatures,
  replayUpdate, getLearningsStats, getQValues, checkDivergence,
  initializeNetwork, setGreedyMode, setVpWeight,
  recordMatchResult, setWeightDecay,
  ABSTRACT_TYPES,
  getDiagnostics, resetDiagnostics,
} from './learnings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DECKS = JSON.parse(readFileSync(join(__dirname, '../../data/destruct-test-decks.json'), 'utf8'));

// ── Config ───────────────────────────────────────────────────────────────────

const EVAL_GAMES = 50;
const TRAIN_GAMES = parseInt(process.env.TRAIN_GAMES || '250', 10);
const MAX_ITERATIONS = 10000;
const MAX_ROUNDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function pickMatchup(gameNum) {
  const i = gameNum % TEST_DECKS.length;
  let j = (gameNum + 17) % TEST_DECKS.length;
  if (j === i) j = (j + 1) % TEST_DECKS.length;
  return { p1Deck: TEST_DECKS[i], p2Deck: TEST_DECKS[j] };
}

function freshLearnings() {
  return {
    brainPhase: 5,
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null, trainingHistory: [] },
    network: initializeNetwork(),
    trainingStats: {
      totalUpdates: 0, avgAbsDelta: 0, hiddenSize: 64,
      lastTargetSync: 0, targetSyncs: 0, nanResets: 0,
      tdErrorHistory: [], featureNames: [],
    },
    dcStats: {}, affiliationStats: {}, matchups: [],
    replayBuffer: { transitions: [], writeIdx: 0, count: 0 },
    withinGroupWeights: {
      attack: new Array(6).fill(0), move: new Array(9).fill(0),
      surge: new Array(4).fill(0), cc: new Array(4).fill(0),
    },
  };
}

// ── Oracle Kill-Focused Policy ──────────────────────────────────────────────

/**
 * Deterministic kill-focused melee oracle.
 *
 * Priority:
 *   1. Mandatory / reactive / combat sub-actions
 *   2. Attack weakest enemy (lowest HP, then lowest max HP, then nearest)
 *   3. Move toward weakest enemy
 *   4. Activate DC nearest to enemy
 *   5. End activation
 */
function pickOracleAction(allActions, game, actingPN, dcHealthState, dcMessageMeta) {
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const oppNum = actingPN === 1 ? 2 : 1;
  const oppFigPositions = game.figurePositions?.[oppNum] || {};
  const myFigPositions = game.figurePositions?.[actingPN] || {};

  // ── 1. Mandatory actions ──────────────────────────────────────────────────
  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);

  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' ||
    a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);

  // ── 2. Reactive sub-states ────────────────────────────────────────────────
  const reactiveTypes = [
    'negation_play', 'negation_let_resolve',
    'celebration_play', 'celebration_pass',
    'cover_fire_block', 'cover_fire_skip',
    'still_faster_use', 'still_faster_skip', 'still_faster_dc_pick',
    'hunter_protocol_trigger', 'hunter_protocol_skip',
    'last_resort_use', 'last_resort_skip',
    'strike_me_down_yes', 'strike_me_down_no',
    'slow_on_draw_yes', 'slow_on_draw_no',
    'force_exhaustion_yes', 'force_exhaustion_no',
    'illicit_arms_pick', 'illicit_arms_skip', 'illicit_arms_use',
    'tough_luck_remove', 'tough_luck_skip',
    'power_converter_approve', 'power_converter_skip',
    'power_converter_die', 'power_converter_color',
    'there_is_no_try_die', 'there_is_no_try_face', 'there_is_no_try_skip',
    'strain_choice_alldmg', 'strain_choice_discard',
    'force_vision_pick',
  ];
  const reactive = allActions.filter(a => reactiveTypes.includes(a.type));
  if (reactive.length > 0) {
    // Prefer "use" / "play" / "trigger" over "skip" / "no" / "pass"
    const proactive = reactive.filter(a =>
      a.type.includes('_play') || a.type.includes('_use') || a.type.includes('_trigger') ||
      a.type.includes('_yes') || a.type.includes('_block') || a.type.includes('_remove') ||
      a.type === 'strain_choice_alldmg');
    return proactive.length > 0 ? pick(proactive) : pick(reactive);
  }

  // Other pending sub-states
  const pendingTypes = [
    'dc_ability_choice', 'pounce_space',
    'missile_salvo_die', 'missile_salvo_done',
    'power_token_choice', 'spread_pain_cond',
  ];
  const pending = allActions.filter(a => pendingTypes.includes(a.type));
  if (pending.length > 0) return pick(pending);

  // ── 3. Combat sub-actions — always spend surges ───────────────────────────
  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) {
    // combat_ready, combat_roll — mandatory flow
    const flow = combat.filter(a =>
      a.type === 'combat_gate' || a.type === 'combat_roll' ||
      a.type === 'combat_resolve' || a.type === 'combat_reroll_confirm');
    if (flow.length > 0) return pick(flow);
    // Surge spending — prefer damage surges, then any surge, then skip
    const surgeDmg = combat.filter(a => a.type?.startsWith('combat_surge'));
    if (surgeDmg.length > 0) return pick(surgeDmg);
    return pick(combat);
  }

  // Surge spend / skip from abstract types
  const surgeSpend = allActions.filter(a =>
    a.type === 'spend_surge' || a.type?.startsWith('combat_surge'));
  const surgeSkip = allActions.filter(a => a.type === 'skip_surges');
  if (surgeSpend.length > 0) return pick(surgeSpend);
  if (surgeSkip.length > 0) return pick(surgeSkip);

  // ── 4. Attack weakest enemy ───────────────────────────────────────────────
  const attacks = allActions.filter(a =>
    a.type === 'attack_target' && a.params?.targetFigureKey);

  if (attacks.length > 0) {
    // Score each attack: lowest current HP → lowest max HP → nearest
    const scored = attacks.map(a => {
      const targetFk = a.params.targetFigureKey;
      const hp = lookupHp(targetFk, oppNum, dcHealthState, dcMessageMeta);
      const targetPos = oppFigPositions[targetFk];
      const attackerPos = getAttackerPos(a, game, dcMessageMeta);
      const dist = (targetPos && attackerPos) ? coordDistance(attackerPos, targetPos) : 99;
      return {
        action: a,
        currentHp: hp?.current ?? 99,
        maxHp: hp?.max ?? 99,
        dist,
      };
    });
    scored.sort((a, b) => {
      if (a.currentHp !== b.currentHp) return a.currentHp - b.currentHp;
      if (a.maxHp !== b.maxHp) return a.maxHp - b.maxHp;
      return a.dist - b.dist;
    });
    return scored[0].action;
  }

  // ── 5. DC special abilities — use if available ────────────────────────────
  const specials = allActions.filter(a => a.type === 'dc_special');
  if (specials.length > 0) return pick(specials);

  // ── 6. CC play — use proactively ──────────────────────────────────────────
  const ccPlay = allActions.filter(a =>
    a.type === 'play_cc' || a.type === 'play_cc_special' || a.type === 'play_cc_double');
  if (ccPlay.length > 0) return pick(ccPlay);

  // ── 7. Movement — move toward weakest enemy ──────────────────────────────
  // For move_pick_space: pick the space that minimizes distance to weakest enemy
  const moveSpaces = allActions.filter(a =>
    a.type === 'move_pick_space' && a.params?.coord && !a.params?.done);
  if (moveSpaces.length > 0) {
    // Find weakest enemy figure
    const weakest = findWeakestEnemy(oppNum, oppFigPositions, dcHealthState, dcMessageMeta);
    if (weakest) {
      const scored = moveSpaces.map(a => ({
        action: a,
        dist: coordDistance(a.params.coord, weakest.pos),
      }));
      scored.sort((a, b) => a.dist - b.dist);
      return scored[0].action;
    }
    return pick(moveSpaces);
  }

  // For move_figure (start of movement): always start moving
  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) {
    // If no attacks available, always start moving
    return pick(moveStart);
  }

  // Movement done button
  const moveDone = allActions.filter(a =>
    a.type === 'move_pick_space' && a.params?.done);
  if (moveDone.length > 0) return pick(moveDone);

  // Interact with objectives when nothing else to do
  const interacts = allActions.filter(a => a.type === 'interact');
  if (interacts.length > 0) return pick(interacts);

  // ── 8. Activation management ──────────────────────────────────────────────
  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  if (endAct.length > 0) return pick(endAct);

  const activateDc = allActions.filter(a => a.type === 'activate_dc');
  if (activateDc.length > 0) {
    // Pick DC closest to an enemy
    const scored = activateDc.map(a => {
      const pn = a.actingPlayer;
      const dcName = a.params?.dcName;
      if (!dcName) return { action: a, minDist: 99 };
      // Find my figures for this DC
      const myFigs = Object.entries(myFigPositions)
        .filter(([fk]) => fk.startsWith(dcName + '-'));
      const oppFigs = Object.values(oppFigPositions);
      if (myFigs.length === 0 || oppFigs.length === 0) return { action: a, minDist: 99 };
      let minDist = 99;
      for (const [, myPos] of myFigs) {
        for (const oppPos of oppFigs) {
          const d = coordDistance(myPos, oppPos);
          if (d < minDist) minDist = d;
        }
      }
      return { action: a, minDist };
    });
    scored.sort((a, b) => a.minDist - b.minDist);
    return scored[0].action;
  }

  const passAct = allActions.filter(a => a.type === 'pass_activation_turn');
  if (passAct.length > 0) return pick(passAct);

  return pick(allActions);
}

// ── Oracle helpers ──────────────────────────────────────────────────────────

function lookupHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
  if (!figureKey || !dcHealthState || !dcMessageMeta) return null;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const parts = figureKey.split('-');
  const figureIndex = parseInt(parts[parts.length - 1], 10) || 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    if (meta.dcName !== dcName && meta.dcName?.toLowerCase() !== dcName.toLowerCase()) continue;
    if (healthArr && healthArr[figureIndex]) {
      return { current: healthArr[figureIndex][0], max: healthArr[figureIndex][1] };
    }
  }
  return null;
}

function getAttackerPos(action, game, dcMessageMeta) {
  const msgId = action.params?.msgId;
  const actingPN = action.actingPlayer;
  if (!msgId || !game.dcActionsData?.[msgId]) return null;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return null;
  const dcName = meta.dcName;
  const figs = Object.entries(game.figurePositions?.[actingPN] || {});
  for (const [fk, pos] of figs) {
    if (fk.startsWith(dcName + '-')) return pos;
  }
  return null;
}

function findWeakestEnemy(oppNum, oppFigPositions, dcHealthState, dcMessageMeta) {
  const entries = Object.entries(oppFigPositions);
  if (entries.length === 0) return null;
  let best = null;
  for (const [fk, pos] of entries) {
    const hp = lookupHp(fk, oppNum, dcHealthState, dcMessageMeta);
    const currentHp = hp?.current ?? 99;
    const maxHp = hp?.max ?? 99;
    if (!best || currentHp < best.currentHp ||
        (currentHp === best.currentHp && maxHp < best.maxHp)) {
      best = { fk, pos, currentHp, maxHp };
    }
  }
  return best;
}

// ── Game Loop ───────────────────────────────────────────────────────────────

async function runOneGame(learnings, gameNum, useOracle) {
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
    .inRound(1).build();
  const hDeps = harness.getDeps();
  const actionDeps = {
    dcMessageMeta, dcExhaustedState, dcHealthState, getDcStats, getMapData,
    computeMovementCache, getBoardStateForMovement, getMovementProfile,
    getPlayableCcFromHand,
    getPlayableCcSpecialsForDc: hDeps.getPlayableCcSpecialsForDc,
    getPlayableCcDoubleActionsForDc: hDeps.getPlayableCcDoubleActionsForDc,
  };

  // Only create tracers for DQN arm (needed for training)
  const tracer1 = useOracle ? null : createGameTracer(learnings, 1, dcHealthState, dcMessageMeta);
  const tracer2 = useOracle ? null : createGameTracer(learnings, 2, dcHealthState, dcMessageMeta);

  let consecutiveEmpty = 0;
  let lastActionType = null;
  let sameTypeCount = 0;
  const ccFailureCounts = new Map();
  const CC_MAX_RETRIES = 3;
  const failedMoves = new Set();
  let lastMoveId = null;
  let moveActions = 0, attackActions = 0, endActivations = 0;
  let totalActivations = 0, passActivations = 0;
  let surgeSpends = 0, surgeSkips = 0;
  let killCount = 0;
  const prevOppFigs = Object.keys(game.figurePositions?.[2] || {}).length +
                      Object.keys(game.figurePositions?.[1] || {}).length;

  // No-progress tracking
  let lastRound = 1, lastP1VP = 0, lastP2VP = 0, noProgressRounds = 0;

  // Activation-order telemetry
  let activationOrderThisRound = [];  // [{dcName, dist, hasTargets, round}]
  const allActivationOrders = [];     // one array per round
  let lastTelemetryRound = 1;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const g = harness.getGame();
    if (g.ended) break;
    if ((g.currentRound || 1) > MAX_ROUNDS) {
      const p1vp = g.player1VP?.total || 0;
      const p2vp = g.player2VP?.total || 0;
      g.ended = true;
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

    const curRound = g.currentRound || 1;
    if (curRound > lastRound) {
      const curP1VP = g.player1VP?.total || 0;
      const curP2VP = g.player2VP?.total || 0;
      const roundVPGain = (curP1VP + curP2VP) - (lastP1VP + lastP2VP);
      if (roundVPGain === 0) noProgressRounds++;
      lastP1VP = curP1VP;
      lastP2VP = curP2VP;
      lastRound = curRound;
    }

    // OOM prevention
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
        if (p2Figs.length > 0) await deps.applyNpcDamageToFigure(g, 2, p2Figs[0], 999, 'Stuck-state breaker');
        else if (p1Figs.length > 0) await deps.applyNpcDamageToFigure(g, 1, p1Figs[0], 999, 'Stuck-state breaker');
        sameTypeCount = 0; lastActionType = null;
        continue;
      }
    } else { sameTypeCount = 0; lastActionType = allActions[0]?.type; }

    // Failed move filtering
    const hasMoveSpaces = allActions.some(a => a.type === 'move_pick_space');
    if (lastMoveId && !hasMoveSpaces) failedMoves.add(lastMoveId);
    if (hasMoveSpaces) lastMoveId = null;
    if (allActions.some(a => a.type === 'activate_dc') && !allActions.some(a => a.type === 'dc_end_activation')) failedMoves.clear();
    const filteredActions = allActions.filter(a => !(a.type === 'move_figure' && failedMoves.has(a.customId)));
    const actionsToUse = filteredActions.length > 0 ? filteredActions : allActions;

    // Determine acting player
    const turnPlayer = g.currentActivationTurnPlayerId === g.player1Id ? 1 : 2;
    const turnActions = actionsToUse.filter(a => a.actingPlayer === turnPlayer);
    const otherPlayer = turnPlayer === 1 ? 2 : 1;
    const otherActions = actionsToUse.filter(a => a.actingPlayer === otherPlayer);
    let actingPN;
    if (turnActions.length > 0 && otherActions.length > 0) {
      const turnMandatory = turnActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      const otherMandatory = otherActions.some(a => ['phase_gate_ready','combat_gate','combat_roll'].includes(a.type));
      actingPN = (otherMandatory && !turnMandatory) ? otherPlayer : turnPlayer;
    } else { actingPN = turnActions.length > 0 ? turnPlayer : otherPlayer; }

    const playerActions = actionsToUse.filter(a => a.actingPlayer === actingPN);

    // ── Action selection: oracle vs learned ──────────────────────────────────
    let action;
    if (useOracle) {
      action = pickOracleAction(playerActions, g, actingPN, dcHealthState, dcMessageMeta);
    } else {
      const tracer = actingPN === 1 ? tracer1 : tracer2;
      tracer.beforeAction(g, playerActions);
      action = pickSmartAction(playerActions, g, learnings, actingPN, dcHealthState, dcMessageMeta);
    }
    if (!action) continue;

    // Track metrics
    if (action.type === 'move_figure') { moveActions++; lastMoveId = action.customId; }
    else if (action.type === 'dc_end_activation') endActivations++;
    else if (action.type === 'attack_target') attackActions++;
    else if (action.type === 'activate_dc') totalActivations++;
    else if (action.type === 'pass_activation_turn') passActivations++;
    const absType = abstractActionType(action, g);
    if (absType === 'surge_damage' || absType === 'surge_special' || absType === 'spend_surge') surgeSpends++;
    if (absType === 'skip_surges') surgeSkips++;

    // Activation-order telemetry: record which DC is activated and its distance to enemies
    const curTelRound = g.currentRound || 1;
    if (curTelRound > lastTelemetryRound) {
      if (activationOrderThisRound.length > 0) allActivationOrders.push([...activationOrderThisRound]);
      activationOrderThisRound = [];
      lastTelemetryRound = curTelRound;
    }
    if (action.type === 'activate_dc') {
      const pn = action.actingPlayer;
      const dcName = action.params?.dcName || 'unknown';
      const oppNum = pn === 1 ? 2 : 1;
      const telOppFigs = Object.values(g.figurePositions?.[oppNum] || {});
      const telMyFigs = Object.entries(g.figurePositions?.[pn] || {})
        .filter(([fk]) => fk.startsWith(dcName + '-'));
      let minDist = 99;
      for (const [, myPos] of telMyFigs) {
        for (const oppPos of telOppFigs) {
          const d = coordDistance(myPos, oppPos);
          if (d < minDist) minDist = d;
        }
      }
      const hasTargets = minDist <= 3;
      activationOrderThisRound.push({
        dcName, dist: minDist, hasTargets, round: curTelRound, playerNum: pn,
        orderInRound: activationOrderThisRound.length + 1,
      });
    }

    // Track opponent figures before action for kill counting
    const oppFigsBefore = Object.keys(g.figurePositions?.[1] || {}).length +
                          Object.keys(g.figurePositions?.[2] || {}).length;

    // Execute action
    if (action.type === 'interact') {
      const p = action.params;
      const actionsData = g.dcActionsData?.[p.msgId];
      if (actionsData && actionsData.remaining > 0) {
        actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      }
      if (!useOracle) {
        const tracer = actingPN === 1 ? tracer1 : tracer2;
        tracer.afterAction(harness.getGame(), action);
      }
      continue;
    }
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
        ccFailureCounts.set(ccKey, (ccFailureCounts.get(ccKey) || 0) + 1);
      }
      if (!useOracle) {
        const tracer = actingPN === 1 ? tracer1 : tracer2;
        tracer.afterAction(harness.getGame(), action);
      }
      continue;
    }
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
        try { await harness.submitAction(`strain_cc_pick_${g2.gameId}_${encodeURIComponent(hand[0])}`, action.actingPlayer === 1 ? g2.player1Id : g2.player2Id); } catch { break; }
        g2 = harness.getGame();
      }
      if (g2.pendingStrainChoice) delete g2.pendingStrainChoice;
      if (!useOracle) {
        const tracer = actingPN === 1 ? tracer1 : tracer2;
        tracer.afterAction(harness.getGame(), action);
      }
      continue;
    }
    const userId = action.actingPlayer === 1 ? g.player1Id : g.player2Id;
    try { await harness.submitAction(action.customId, userId); } catch {}

    if (!useOracle) {
      const tracer = actingPN === 1 ? tracer1 : tracer2;
      tracer.afterAction(harness.getGame(), action);
    }

    // Count kills
    const oppFigsAfter = Object.keys(harness.getGame().figurePositions?.[1] || {}).length +
                         Object.keys(harness.getGame().figurePositions?.[2] || {}).length;
    if (oppFigsAfter < oppFigsBefore) killCount += (oppFigsBefore - oppFigsAfter);
  }

  const finalGame = harness.getGame();
  if (!finalGame.ended) {
    finalGame.ended = true;
    const p1vp = finalGame.player1VP?.total || 0;
    const p2vp = finalGame.player2VP?.total || 0;
    if (p1vp > p2vp) finalGame.winnerId = finalGame.player1Id;
    else if (p2vp > p1vp) finalGame.winnerId = finalGame.player2Id;
  }

  if (!useOracle) {
    tracer1.finalize(finalGame, true);
    tracer2.finalize(finalGame, false);
    replayUpdate(learnings);
    recordMatchResult(learnings, p1Army, p2Army,
      finalGame.winnerId === finalGame.player1Id ? 'P1' :
      finalGame.winnerId === finalGame.player2Id ? 'P2' : null,
      getDcStats, getDcEffects);
  }

  const finalP1VP = finalGame.player1VP?.total || 0;
  const finalP2VP = finalGame.player2VP?.total || 0;
  const finalRound = finalGame.currentRound || 1;
  if (finalRound > lastRound) {
    const roundVPGain = (finalP1VP + finalP2VP) - (lastP1VP + lastP2VP);
    if (roundVPGain === 0) noProgressRounds++;
  }

  // Flush final round's activations
  if (activationOrderThisRound.length > 0) allActivationOrders.push([...activationOrderThisRound]);

  return {
    ended: finalGame.ended,
    winnerLabel: finalGame.winnerId === finalGame.player1Id ? 'P1' :
                 finalGame.winnerId === finalGame.player2Id ? 'P2' : null,
    p1VP: finalP1VP,
    p2VP: finalP2VP,
    finalRound,
    moveActions, attackActions, endActivations, totalActivations, passActivations,
    surgeSpends, surgeSkips, noProgressRounds,
    totalRounds: finalRound,
    killCount,
    activationOrders: allActivationOrders,
  };
}

// ── Result Helpers ──────────────────────────────────────────────────────────

function summarize(results, label) {
  const n = results.length;
  const avgVP = results.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / n;
  const avgAtk = results.reduce((s, r) => s + r.attackActions, 0) / n;
  const avgMoves = results.reduce((s, r) => s + r.moveActions, 0) / n;
  const avgRound = results.reduce((s, r) => s + r.finalRound, 0) / n;
  const avgEnd = results.reduce((s, r) => s + r.endActivations, 0) / n;
  const avgKills = results.reduce((s, r) => s + r.killCount, 0) / n;
  const p1Wins = results.filter(r => r.winnerLabel === 'P1').length;
  const p2Wins = results.filter(r => r.winnerLabel === 'P2').length;
  const totalRounds = results.reduce((s, r) => s + r.totalRounds, 0);
  const totalNoProgress = results.reduce((s, r) => s + r.noProgressRounds, 0);
  const noProgressRate = totalRounds > 0 ? (totalNoProgress / totalRounds * 100).toFixed(1) : 'N/A';
  const vpPerRound = totalRounds > 0 ? (results.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / totalRounds).toFixed(2) : 'N/A';
  const totalSurgeSpend = results.reduce((s, r) => s + r.surgeSpends, 0);
  const totalSurgeSkip = results.reduce((s, r) => s + r.surgeSkips, 0);
  const surgeRate = (totalSurgeSpend + totalSurgeSkip) > 0
    ? (totalSurgeSpend / (totalSurgeSpend + totalSurgeSkip) * 100).toFixed(1) : 'N/A';

  return {
    label, n, avgVP, avgAtk, avgMoves, avgRound, avgEnd, avgKills,
    p1Wins, p2Wins, noProgressRate, vpPerRound, surgeRate,
    winRate: ((p1Wins + p2Wins) / n * 100).toFixed(1),
  };
}

function analyzeActivationTelemetry(results) {
  // Aggregate across all games
  let totalFirstDists = [];
  let firstHasTargets = 0, firstTotal = 0;
  let allDists = [];
  let allHasTargets = 0, allTotal = 0;
  let firstActivationDcs = {};  // count how often each DC is activated first

  for (const r of results) {
    if (!r.activationOrders) continue;
    for (const round of r.activationOrders) {
      if (round.length === 0) continue;
      // First activation in the round
      const first = round[0];
      totalFirstDists.push(first.dist);
      if (first.hasTargets) firstHasTargets++;
      firstTotal++;
      firstActivationDcs[first.dcName] = (firstActivationDcs[first.dcName] || 0) + 1;
      // All activations
      for (const act of round) {
        allDists.push(act.dist);
        if (act.hasTargets) allHasTargets++;
        allTotal++;
      }
    }
  }

  const avgFirstDist = totalFirstDists.length > 0
    ? (totalFirstDists.reduce((s, d) => s + d, 0) / totalFirstDists.length) : 0;
  const firstTargetRate = firstTotal > 0 ? (firstHasTargets / firstTotal * 100) : 0;
  const avgAllDist = allDists.length > 0
    ? (allDists.reduce((s, d) => s + d, 0) / allDists.length) : 0;
  const allTargetRate = allTotal > 0 ? (allHasTargets / allTotal * 100) : 0;

  // Top 3 most-activated-first DCs
  const topFirst = Object.entries(firstActivationDcs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}(${count})`);

  return {
    avgFirstDist: avgFirstDist.toFixed(1),
    firstTargetRate: firstTargetRate.toFixed(1),
    avgAllDist: avgAllDist.toFixed(1),
    allTargetRate: allTargetRate.toFixed(1),
    topFirst: topFirst.join(', '),
    firstTotal,
    allTotal,
  };
}

function printComparison(oracle, dqn, oracleResults, dqnResults) {
  console.log('');
  console.log('                       ORACLE         DQN (greedy)');
  console.log(`  VP/game:             ${oracle.avgVP.toFixed(1).padEnd(15)}${dqn.avgVP.toFixed(1)}`);
  console.log(`  VP/round:            ${oracle.vpPerRound.padEnd(15)}${dqn.vpPerRound}`);
  console.log(`  Attacks/game:        ${oracle.avgAtk.toFixed(1).padEnd(15)}${dqn.avgAtk.toFixed(1)}`);
  console.log(`  Moves/game:          ${oracle.avgMoves.toFixed(1).padEnd(15)}${dqn.avgMoves.toFixed(1)}`);
  console.log(`  Kills/game:          ${oracle.avgKills.toFixed(1).padEnd(15)}${dqn.avgKills.toFixed(1)}`);
  console.log(`  Win rate:            ${oracle.winRate}%${' '.repeat(11)}${dqn.winRate}%`);
  console.log(`  Avg rounds:          ${oracle.avgRound.toFixed(1).padEnd(15)}${dqn.avgRound.toFixed(1)}`);
  console.log(`  No-progress rate:    ${oracle.noProgressRate}%${' '.repeat(11 - oracle.noProgressRate.length)}${dqn.noProgressRate}%`);
  console.log(`  Surge spend rate:    ${oracle.surgeRate}%${' '.repeat(11 - String(oracle.surgeRate).length)}${dqn.surgeRate}%`);
  console.log(`  End activations/g:   ${oracle.avgEnd.toFixed(1).padEnd(15)}${dqn.avgEnd.toFixed(1)}`);

  // Activation-order telemetry
  const oTel = analyzeActivationTelemetry(oracleResults);
  const dTel = analyzeActivationTelemetry(dqnResults);
  console.log('');
  console.log('  ── Activation Order Telemetry ──');
  console.log(`  1st act avg dist:    ${oTel.avgFirstDist.padEnd(15)}${dTel.avgFirstDist}`);
  console.log(`  1st act has targets: ${(oTel.firstTargetRate + '%').padEnd(15)}${dTel.firstTargetRate}%`);
  console.log(`  All act avg dist:    ${oTel.avgAllDist.padEnd(15)}${dTel.avgAllDist}`);
  console.log(`  All act has targets: ${(oTel.allTargetRate + '%').padEnd(15)}${dTel.allTargetRate}%`);
  console.log(`  Top 1st-act DCs (O): ${oTel.topFirst}`);
  console.log(`  Top 1st-act DCs (D): ${dTel.topFirst}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  v11 Oracle Melee Baseline — Diagnostic A/B             ║');
  console.log('║  Oracle: kill-focused melee (attack weakest, move in)   ║');
  console.log(`║  DQN: trained ${TRAIN_GAMES} games, greedy eval (argmax)${' '.repeat(Math.max(0, 11 - String(TRAIN_GAMES).length))}║`);
  console.log('║  Both run same 50-game matchup set                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── Arm A: Oracle (no training needed) ────────────────────────────────────

  console.log(`\n${'='.repeat(60)}`);
  console.log(`ARM A: Oracle Melee Policy — ${EVAL_GAMES} games`);
  console.log(`${'='.repeat(60)}`);

  const dummyLearnings = freshLearnings();
  const oracleResults = [];
  const oracleStart = Date.now();

  for (let i = 0; i < EVAL_GAMES; i++) {
    const result = await runOneGame(dummyLearnings, i, true);
    oracleResults.push(result);

    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - oracleStart) / 1000).toFixed(1);
      const window = oracleResults.slice(Math.max(0, oracleResults.length - 10));
      const avgAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const avgVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
      const avgKills = window.reduce((s, r) => s + r.killCount, 0) / window.length;
      console.log(`  [${i + 1}/${EVAL_GAMES}] ${elapsed}s | atk/g: ${avgAtk.toFixed(1)} | VP: ${avgVP.toFixed(1)} | kills/g: ${avgKills.toFixed(1)}`);
    }
  }
  const oracleTime = ((Date.now() - oracleStart) / 1000).toFixed(1);

  // ── Arm B: DQN (train 250, eval 50 greedy) ───────────────────────────────

  console.log(`\n${'='.repeat(60)}`);
  console.log(`ARM B: DQN Training — ${TRAIN_GAMES} games`);
  console.log(`${'='.repeat(60)}`);

  setEncoderType('flat');
  setWeightDecay(0);
  setGreedyMode(false);

  const learnings = freshLearnings();
  const trainResults = [];
  const trainStart = Date.now();

  for (let i = 0; i < TRAIN_GAMES; i++) {
    const result = await runOneGame(learnings, i, false);
    trainResults.push(result);

    if ((i + 1) % 50 === 0) {
      const window = trainResults.slice(i - 49, i + 1);
      const avgVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
      const avgAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const elapsed = ((Date.now() - trainStart) / 1000).toFixed(1);
      const td = learnings.trainingStats.avgAbsDelta;
      console.log(`  [${i + 1}/${TRAIN_GAMES}] ${elapsed}s | avgVP: ${avgVP.toFixed(1)} | TD: ${td.toFixed(4)} | atk/g: ${avgAtk.toFixed(1)} | updates: ${learnings.trainingStats.totalUpdates}`);
    }
  }
  const trainTime = ((Date.now() - trainStart) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`ARM B: DQN Greedy Eval — ${EVAL_GAMES} games (argmax, epsilon=0)`);
  console.log(`${'='.repeat(60)}`);

  setGreedyMode(true);
  resetDiagnostics();
  const dqnResults = [];
  const dqnStart = Date.now();

  for (let i = 0; i < EVAL_GAMES; i++) {
    const gameNum = TRAIN_GAMES + i;
    const result = await runOneGame(learnings, gameNum, false);
    dqnResults.push(result);

    if ((i + 1) % 10 === 0) {
      const elapsed = ((Date.now() - dqnStart) / 1000).toFixed(1);
      const window = dqnResults.slice(Math.max(0, dqnResults.length - 10));
      const avgAtk = window.reduce((s, r) => s + r.attackActions, 0) / window.length;
      const avgVP = window.reduce((s, r) => s + r.p1VP + r.p2VP, 0) / window.length;
      const avgKills = window.reduce((s, r) => s + r.killCount, 0) / window.length;
      console.log(`  [${i + 1}/${EVAL_GAMES}] ${elapsed}s | atk/g: ${avgAtk.toFixed(1)} | VP: ${avgVP.toFixed(1)} | kills/g: ${avgKills.toFixed(1)}`);
    }
  }
  setGreedyMode(false);
  const dqnTime = ((Date.now() - dqnStart) / 1000).toFixed(1);

  // ── Results ───────────────────────────────────────────────────────────────

  const oracleSummary = summarize(oracleResults, 'Oracle');
  const dqnSummary = summarize(dqnResults, 'DQN');

  console.log('\n' + '='.repeat(60));
  console.log('v11 ORACLE vs DQN — SIDE BY SIDE');
  console.log('='.repeat(60));
  printComparison(oracleSummary, dqnSummary, oracleResults, dqnResults);

  // ── Verdict ───────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  console.log('VERDICT');
  console.log('='.repeat(60));

  const vpDelta = oracleSummary.avgVP - dqnSummary.avgVP;
  const atkDelta = oracleSummary.avgAtk - dqnSummary.avgAtk;
  const killDelta = oracleSummary.avgKills - dqnSummary.avgKills;

  console.log(`  VP delta (oracle - DQN):     ${vpDelta >= 0 ? '+' : ''}${vpDelta.toFixed(1)}`);
  console.log(`  Attack delta:                ${atkDelta >= 0 ? '+' : ''}${atkDelta.toFixed(1)}`);
  console.log(`  Kill delta:                  ${killDelta >= 0 ? '+' : ''}${killDelta.toFixed(1)}`);
  console.log('');

  if (vpDelta > 1.0) {
    console.log('  >>> ORACLE WINS — simple kill logic outperforms learned DQN');
    console.log('      The DQN lacks sequence-level kill planning (move→attack→finish).');
    console.log('      Next step: hierarchical policy or options framework.');
  } else if (vpDelta < -1.0) {
    console.log('  >>> DQN WINS — the learned policy outperforms simple melee');
    console.log('      The game environment rewards strategic positioning over raw aggression.');
    console.log('      Next step: improve DQN credit assignment, not behavioral prior.');
  } else {
    console.log('  >>> DRAW — both within 1 VP');
    console.log('      Neither approach meaningfully solves the no-progress problem.');
    console.log('      Next step: investigate if 88% no-progress is a game-structural ceiling.');
  }

  // ── End-activation diagnostic ─────────────────────────────────────────────
  const diag = getDiagnostics();
  const endOverAttackRate = diag.attackAvailTotal > 0
    ? (diag.endActOverAttack / diag.attackAvailTotal * 100).toFixed(1) : 'N/A';
  const endOverAttackPerGame = (diag.endActOverAttack / EVAL_GAMES).toFixed(1);
  const endActRate = diag.totalDecisions > 0
    ? (diag.endActTotal / diag.totalDecisions * 100).toFixed(1) : 'N/A';

  console.log('\n' + '='.repeat(60));
  console.log('END-ACTIVATION DIAGNOSTIC');
  console.log('='.repeat(60));
  console.log(`  Total strategic decisions:     ${diag.totalDecisions}`);
  console.log(`  Decisions w/ attacks avail:    ${diag.attackAvailTotal}`);
  console.log(`  end_activation chosen (total): ${diag.endActTotal} (${endActRate}% of decisions)`);
  console.log(`  end_activation OVER attack:    ${diag.endActOverAttack} (${endOverAttackRate}% of attack-avail decisions)`);
  console.log(`  end_act-over-attack per game:  ${endOverAttackPerGame}`);

  console.log(`\nOracle time: ${oracleTime}s | DQN train: ${trainTime}s | DQN eval: ${dqnTime}s`);
  console.log('\n' + '='.repeat(60));
  console.log('EXPERIMENT COMPLETE');
  console.log('='.repeat(60));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
