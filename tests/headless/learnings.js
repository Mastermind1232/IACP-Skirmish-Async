/**
 * Strategy learning module — Linear Function Approximation (Brain Phase 2).
 * Replaces tabular Q-learning with weighted feature vectors per action type.
 * Q(state, action) = dot(weights[action], features(state))
 * Both players share the same weights, indexed from their own perspective.
 */
import { parseCoord } from '../../src/game/coords.js';
import { getDcEffects } from '../../src/data-loader.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── Constants ───────────────────────────────────────────────────────────────

const GAMMA = 0.95;        // Discount factor
const ALPHA = 0.01;        // Learning rate (fixed for linear approx)
const WEIGHT_CLAMP = 10.0; // Safety clamp to prevent divergence

const REWARD_WEIGHTS = {
  vp: 10.0,               // VP gained (primary win condition)
  dmg: 0.5,               // Enemy HP removed
  hp: -0.5,               // Own HP lost (negative = penalty)
  dist: 0.1,              // Distance reduction to enemies
  terminal: 50.0,         // Win/loss bonus at game end
};

const NUM_FEATURES = 14;

const FEATURE_NAMES = [
  'vpAdv', 'myHpRatio', 'oppHpRatio', 'hpAdv',
  'myFigsRatio', 'figsAdv', 'closeness', 'nearestEnemy',
  'roundProgress', 'activationsRatio', 'inCombat', 'inMovement',
  'attackPower', 'bias',
];

const ABSTRACT_TYPES = [
  'attack_close', 'attack_ranged', 'move_toward', 'move_away', 'move_lateral',
  'move_done', 'start_move', 'activate', 'end_activation', 'pass',
  'ability', 'spend_surge', 'skip_surges', 'reroll', 'other',
];

// Expected damage per attack die (from dice.json face averages)
const EXPECTED_DMG_PER_DIE = { red: 2.17, blue: 1.17, green: 1.33, yellow: 0.67 };

// ── Helpers ─────────────────────────────────────────────────────────────────

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

function getHpTotals(dcHealthState, dcMessageMeta, playerNum) {
  let current = 0, max = 0;
  for (const [msgId, healthArr] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta || meta.playerNum !== playerNum) continue;
    for (const [cur, mx] of healthArr) {
      current += cur;
      max += mx;
    }
  }
  return { current, max };
}

function getAvgDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 8;
  let totalDist = 0;
  for (const myPos of myFigs) {
    let minD = Infinity;
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < minD) minD = d;
    }
    totalDist += minD;
  }
  return totalDist / myFigs.length;
}

function getMinDistToEnemy(game, playerNum) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myFigs = Object.values(game.figurePositions?.[playerNum] || {});
  const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
  if (myFigs.length === 0 || oppFigs.length === 0) return 10;
  let globalMin = Infinity;
  for (const myPos of myFigs) {
    for (const oppPos of oppFigs) {
      const d = coordDistance(myPos, oppPos);
      if (d < globalMin) globalMin = d;
    }
  }
  return globalMin;
}

function getArmyAttackPower(game, playerNum) {
  const figs = game.figurePositions?.[playerNum] || {};
  const figKeys = Object.keys(figs);
  if (figKeys.length === 0) return 0;
  let totalDmg = 0;
  let dcEffects;
  try { dcEffects = getDcEffects(); } catch { return 0; }
  for (const figKey of figKeys) {
    // Extract DC name: "Darth Vader-1-0" → "Darth Vader"
    const dcName = figKey.replace(/-\d+-\d+$/, '');
    const lower = dcName.toLowerCase();
    const ciKey = Object.keys(dcEffects).find(k => k.toLowerCase() === lower);
    const eff = dcEffects[dcName] || (ciKey ? dcEffects[ciKey] : null);
    if (eff?.attack?.dice) {
      for (const die of eff.attack.dice) {
        totalDmg += EXPECTED_DMG_PER_DIE[die] || 0;
      }
    }
  }
  // Normalize — ~15 is roughly max single-army expected damage
  return Math.min(1, totalDmg / 15);
}

// ── Feature Extraction ──────────────────────────────────────────────────────

export function extractFeatures(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  const myFigs = Object.keys(game.figurePositions?.[playerNum] || {}).length;
  const oppFigs = Object.keys(game.figurePositions?.[oppNum] || {}).length;
  const avgDist = getAvgDistToEnemy(game, playerNum);
  const minDist = getMinDistToEnemy(game, playerNum);
  const round = game.currentRound || game.round || 1;
  const myActs = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const oppActs = oppNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);

  const myHpRatio = myHp.max > 0 ? myHp.current / myHp.max : 0;
  const oppHpRatio = oppHp.max > 0 ? oppHp.current / oppHp.max : 0;
  const totalFigs = myFigs + oppFigs;
  const totalActs = myActs + oppActs;

  return [
    /* 0  vpAdv          */ (myVP - oppVP) / 40,
    /* 1  myHpRatio      */ myHpRatio,
    /* 2  oppHpRatio     */ oppHpRatio,
    /* 3  hpAdv          */ myHpRatio - oppHpRatio,
    /* 4  myFigsRatio    */ totalFigs > 0 ? myFigs / totalFigs : 0.5,
    /* 5  figsAdv        */ totalFigs > 0 ? (myFigs - oppFigs) / totalFigs : 0,
    /* 6  closeness      */ 1 - Math.min(avgDist, 10) / 10,
    /* 7  nearestEnemy   */ 1 - Math.min(minDist, 10) / 10,
    /* 8  roundProgress  */ Math.min(round, 5) / 5,
    /* 9  activationsRatio */ totalActs > 0 ? myActs / totalActs : 0.5,
    /* 10 inCombat       */ game.pendingCombat ? 1 : 0,
    /* 11 inMovement     */ game.moveInProgress && Object.keys(game.moveInProgress).length > 0 ? 1 : 0,
    /* 12 attackPower    */ getArmyAttackPower(game, playerNum),
    /* 13 bias           */ 1.0,
  ];
}

// ── Weight System ───────────────────────────────────────────────────────────

export function initializeWeights() {
  const weights = {};
  for (const t of ABSTRACT_TYPES) {
    weights[t] = new Array(NUM_FEATURES).fill(0);
  }
  return weights;
}

export function computeQ(weights, actionType, features) {
  const w = weights[actionType];
  if (!w) return 0;
  let sum = 0;
  for (let i = 0; i < NUM_FEATURES; i++) {
    sum += w[i] * (features[i] || 0);
  }
  return sum;
}

function getBestQ(weights, features) {
  let maxQ = -Infinity;
  for (const t of ABSTRACT_TYPES) {
    const q = computeQ(weights, t, features);
    if (q > maxQ) maxQ = q;
  }
  return maxQ === -Infinity ? 0 : maxQ;
}

function updateWeightsForAction(weights, actionType, features, delta, alpha) {
  if (!weights[actionType]) weights[actionType] = new Array(NUM_FEATURES).fill(0);
  const w = weights[actionType];
  for (let i = 0; i < NUM_FEATURES; i++) {
    w[i] += alpha * delta * (features[i] || 0);
    if (w[i] > WEIGHT_CLAMP) w[i] = WEIGHT_CLAMP;
    if (w[i] < -WEIGHT_CLAMP) w[i] = -WEIGHT_CLAMP;
  }
}

// ── Training Update ─────────────────────────────────────────────────────────

function updateTraceLinear(learnings, trace) {
  if (!learnings.weights) learnings.weights = initializeWeights();
  if (!learnings.trainingStats) learnings.trainingStats = { totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES };
  const weights = learnings.weights;
  let deltaSum = 0;
  let count = 0;

  for (let i = trace.length - 1; i >= 0; i--) {
    const { features, absType, reward, nextFeatures } = trace[i];
    if (!features) continue;
    const currentQ = computeQ(weights, absType, features);
    const maxQNext = nextFeatures ? getBestQ(weights, nextFeatures) : 0;
    const delta = reward + GAMMA * maxQNext - currentQ;
    updateWeightsForAction(weights, absType, features, delta, ALPHA);
    deltaSum += Math.abs(delta);
    count++;
  }

  if (count > 0) {
    learnings.trainingStats.totalUpdates += count;
    // Running average of |delta|
    const prevAvg = learnings.trainingStats.avgAbsDelta || 0;
    learnings.trainingStats.avgAbsDelta = prevAvg * 0.95 + (deltaSum / count) * 0.05;
  }
}

// ── Action Abstraction ──────────────────────────────────────────────────────

export function abstractActionType(action, game) {
  const t = action.type;
  // Mandatory flow actions
  if (t === 'phase_gate_ready' || t === 'end_start_of_round' ||
      t === 'end_end_of_round' || t === 'end_activation_phase') return 'gate';
  if (t === 'combat_ready' || t === 'combat_roll') return 'combat_flow';
  // Strategic combat actions
  if (t === 'combat_resolve' || t === 'combat_skip_surges') return 'skip_surges';
  if (t?.startsWith('combat_reroll')) return 'reroll';
  if (t?.startsWith('combat_surge')) return 'spend_surge';
  // DC specials and CC play
  if (t === 'dc_special') return 'ability';
  if (t === 'play_cc') return 'ability';
  // Attacks
  if (t === 'attack_target') {
    if (action.params?.targetFigureKey && game) {
      const oppNum = action.actingPlayer === 1 ? 2 : 1;
      const tPos = game.figurePositions?.[oppNum]?.[action.params.targetFigureKey];
      const myFigs = game.figurePositions?.[action.actingPlayer] || {};
      if (tPos) {
        let minD = Infinity;
        for (const pos of Object.values(myFigs)) {
          const d = coordDistance(pos, tPos);
          if (d < minD) minD = d;
        }
        return minD <= 2 ? 'attack_close' : 'attack_ranged';
      }
    }
    return 'attack_close';
  }
  // Movement
  if (t === 'move_pick_space') {
    if (action.params?.done) return 'move_done';
    if (action.params?.coord && game) {
      const pn = action.actingPlayer;
      const oppNum = pn === 1 ? 2 : 1;
      const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
      if (oppFigs.length > 0) {
        const moveKey = action.params.moveKey;
        const moveState = game.moveInProgress?.[moveKey];
        const curPos = moveState?.currentPosition || moveState?.startCoord;
        if (curPos) {
          const curDist = Math.min(...oppFigs.map(p => coordDistance(curPos, p)));
          const newDist = Math.min(...oppFigs.map(p => coordDistance(action.params.coord, p)));
          if (newDist < curDist) return 'move_toward';
          if (newDist > curDist) return 'move_away';
          return 'move_lateral';
        }
      }
    }
    return 'move_toward';
  }
  if (t === 'move_figure') return 'start_move';
  // Activation
  if (t === 'activate_dc') return 'activate';
  if (t === 'dc_end_activation') return 'end_activation';
  if (t === 'pass_activation_turn') return 'pass';
  // Pending sub-state actions (ability choices / gates)
  if (t === 'dc_ability_choice' || t === 'pounce_space' ||
      t === 'celebration_play' || t === 'celebration_pass' ||
      t === 'missile_salvo_die' || t === 'missile_salvo_done' ||
      t === 'power_token_choice' || t === 'cover_fire_block' || t === 'cover_fire_skip' ||
      t === 'spread_pain_cond' || t === 'negation_play' || t === 'negation_let_resolve') return 'ability';
  // Fallback
  return 'other';
}

// ── Snapshots & Rewards ─────────────────────────────────────────────────────

export function captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  return {
    myVP: (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    oppVP: (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0,
    myHpCurrent: myHp.current,
    myHpMax: myHp.max,
    oppHpCurrent: oppHp.current,
    oppHpMax: oppHp.max,
    avgDist: getAvgDistToEnemy(game, playerNum),
    myFigs: Object.keys(game.figurePositions?.[playerNum] || {}).length,
    oppFigs: Object.keys(game.figurePositions?.[oppNum] || {}).length,
  };
}

export function computeReward(before, after, isTerminal, didWin) {
  const w = REWARD_WEIGHTS;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  let reward = w.vp * deltaVP + w.dmg * deltaEnemyDmg + w.hp * deltaMyHP + w.dist * deltaDist;
  if (isTerminal) {
    reward += didWin ? w.terminal : -w.terminal;
  }
  return reward;
}

// ── Action Selection ────────────────────────────────────────────────────────

function getEpsilon(totalGames) {
  return Math.max(0.05, 0.3 - 0.001 * totalGames);
}

export function pickSmartAction(allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Group actions by abstract type
  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  // Mandatory actions — always use heuristic (no strategic choice)
  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pick(mandatoryActions);
  if (mandatoryActions.length > 0) return pick(mandatoryActions);

  // Strategic actions only from here
  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pick(allActions);

  // Epsilon-greedy exploration
  const epsilon = getEpsilon(learnings.meta.totalGames);
  if (Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: compute Q via linear function approximation
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const weights = learnings.weights;
  if (!weights) return heuristicPick(strategicActions, game);

  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const q = computeQ(weights, absType, features);
    if (q > bestQ) {
      bestQ = q;
      bestType = absType;
    }
  }

  if (bestType === null) return heuristicPick(strategicActions, game);
  return pickWithinGroup(groups[bestType], bestType, game);
}

function pickWithinGroup(actions, absType, game) {
  if (actions.length <= 1) return actions[0];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  if (absType === 'attack_close' || absType === 'attack_ranged') {
    const scored = actions.map(a => {
      const fk = a.params?.targetFigureKey;
      let priority = 0;
      if (fk) {
        const oppNum = a.actingPlayer === 1 ? 2 : 1;
        const oppFigs = Object.keys(game.figurePositions?.[oppNum] || {});
        priority = 10 - oppFigs.length;
      }
      return { action: a, priority };
    });
    scored.sort((a, b) => b.priority - a.priority);
    return scored[0].action;
  }
  if (absType === 'move_toward' || absType === 'move_away' || absType === 'move_lateral') {
    const oppNum = actions[0].actingPlayer === 1 ? 2 : 1;
    const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
    if (oppFigs.length > 0) {
      const scored = actions.map(a => {
        const coord = a.params?.coord || '';
        if (!coord || a.params?.done) return { action: a, dist: 999 };
        const dist = Math.min(...oppFigs.map(p => coordDistance(coord, p)));
        return { action: a, dist };
      });
      scored.sort((a, b) => a.dist - b.dist);
      const best = scored[0].dist;
      const tied = scored.filter(s => s.dist === best);
      return pick(tied).action;
    }
  }
  return pick(actions);
}

function heuristicPick(allActions, game) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' || a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);

  const pendingTypes = ['dc_ability_choice', 'celebration_play', 'celebration_pass',
    'pounce_space', 'missile_salvo_die', 'missile_salvo_done',
    'power_token_choice', 'cover_fire_block', 'cover_fire_skip',
    'spread_pain_cond', 'negation_play', 'negation_let_resolve'];
  const pending = allActions.filter(a => pendingTypes.includes(a.type));
  if (pending.length > 0) return pick(pending);

  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) return pick(combat);

  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) return pickWithinGroup(attacks, 'attack_close', game);

  const specials = allActions.filter(a => a.type === 'dc_special');
  if (specials.length > 0) return pick(specials);

  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && !a.params?.done);
  if (moveSpaces.length > 0) return pickWithinGroup(moveSpaces, 'move_toward', game);

  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) return pick(moveStart);

  const moveFinish = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveFinish.length > 0) return pick(moveFinish);

  const endAct = allActions.filter(a => a.type === 'dc_end_activation');
  if (endAct.length > 0) return pick(endAct);
  const activate = allActions.filter(a => a.type === 'activate_dc');
  if (activate.length > 0) return pick(activate);

  return pick(allActions);
}

// ── Game Loop Integration ───────────────────────────────────────────────────

export function createGameTracer(learnings, playerNum, dcHealthState, dcMessageMeta) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;

  return {
    beforeAction(game) {
      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeReward(lastSnapshot, afterSnap, false, false);
      trace.push({ features: lastFeatures, absType, reward, nextFeatures });
      lastSnapshot = null;
      lastFeatures = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        trace[trace.length - 1].reward += didWin ? REWARD_WEIGHTS.terminal : (didLose ? -REWARD_WEIGHTS.terminal : 0);
        trace[trace.length - 1].nextFeatures = null; // Terminal state
      }
      updateTraceLinear(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Persistence ─────────────────────────────────────────────────────────────

export function loadLearnings(filePath) {
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      // Migrate from tabular to linear if needed
      if (!data.weights) {
        data.weights = initializeWeights();
        delete data.states;
      }
      if (!data.trainingStats) {
        data.trainingStats = { totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES };
      }
      if (!data.dcStats) data.dcStats = {};
      if (!data.affiliationStats) data.affiliationStats = {};
      if (!data.matchups) data.matchups = [];
      return data;
    }
  } catch { /* start fresh */ }
  return {
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null },
    weights: initializeWeights(),
    trainingStats: { totalUpdates: 0, avgAbsDelta: 0, featureNames: FEATURE_NAMES },
    dcStats: {},
    affiliationStats: {},
    matchups: [],
  };
}

export function saveLearnings(learnings, filePath) {
  learnings.meta.lastUpdated = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(learnings));
}

// ── Per-DC / Affiliation Tracking ────────────────────────────────────────

export function recordMatchResult(learnings, p1Army, p2Army, winnerLabel, getDcStatsFunc, getDcEffectsFunc) {
  if (!learnings.dcStats) learnings.dcStats = {};
  if (!learnings.affiliationStats) learnings.affiliationStats = {};
  if (!learnings.matchups) learnings.matchups = [];

  function getAffiliation(dcName) {
    try {
      if (getDcEffectsFunc) {
        const effects = getDcEffectsFunc();
        const lower = dcName?.toLowerCase?.() || '';
        const ciKey = Object.keys(effects).find(k => k.toLowerCase() === lower);
        const eff = effects[dcName] || (ciKey ? effects[ciKey] : null);
        if (eff?.affiliation) return eff.affiliation.toLowerCase();
      }
    } catch { /* ignore */ }
    return 'unknown';
  }

  function trackDc(dcName, isWinner) {
    if (!learnings.dcStats[dcName]) {
      learnings.dcStats[dcName] = { wins: 0, losses: 0, games: 0, affiliation: getAffiliation(dcName) };
    }
    const s = learnings.dcStats[dcName];
    s.games++;
    if (isWinner === true) s.wins++;
    else if (isWinner === false) s.losses++;
    if (s.affiliation === 'unknown') s.affiliation = getAffiliation(dcName);
  }

  for (const dc of p1Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P1' ? true : winnerLabel === 'P2' ? false : null);
  }
  for (const dc of p2Army) {
    const name = typeof dc === 'object' ? dc.dcName : dc;
    trackDc(name, winnerLabel === 'P2' ? true : winnerLabel === 'P1' ? false : null);
  }

  const p1Affs = new Set(p1Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  const p2Affs = new Set(p2Army.map(dc => getAffiliation(typeof dc === 'object' ? dc.dcName : dc)));
  for (const aff of p1Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P1') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P2') learnings.affiliationStats[aff].losses++;
  }
  for (const aff of p2Affs) {
    if (!learnings.affiliationStats[aff]) learnings.affiliationStats[aff] = { wins: 0, losses: 0, games: 0 };
    learnings.affiliationStats[aff].games++;
    if (winnerLabel === 'P2') learnings.affiliationStats[aff].wins++;
    else if (winnerLabel === 'P1') learnings.affiliationStats[aff].losses++;
  }

  learnings.matchups.push({
    p1: p1Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    p2: p2Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    winner: winnerLabel,
    game: learnings.meta.totalGames,
  });
  if (learnings.matchups.length > 200) learnings.matchups = learnings.matchups.slice(-200);
}

// ── Agent-Specific Action Selection (Arena) ─────────────────────────────────

export function pickAgentAction(agent, allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pickRandom(mandatoryActions);
  if (mandatoryActions.length > 0) return pickRandom(mandatoryActions);

  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pickRandom(allActions);

  // Agent-specific epsilon
  const epsilon = agent.strategy.epsilon;
  if (Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: Q via linear function approximation + agent preferences
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const weights = learnings.weights;
  if (!weights) return heuristicPick(strategicActions, game);

  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const qBase = computeQ(weights, absType, features);
    const preference = agent.strategy.actionPreferences[absType] ?? 0;
    const effectiveQ = qBase + preference;
    if (effectiveQ > bestQ) {
      bestQ = effectiveQ;
      bestType = absType;
    }
  }

  if (bestType === null) return heuristicPick(strategicActions, game);
  return pickWithinGroup(groups[bestType], bestType, game);
}

/**
 * Compute reward with agent-specific reward multipliers.
 */
export function computeAgentReward(before, after, isTerminal, didWin, rewardMultipliers) {
  const m = rewardMultipliers;
  const deltaVP = (after.myVP - before.myVP) - (after.oppVP - before.oppVP);
  const oppDmgBefore = before.oppHpMax - before.oppHpCurrent;
  const oppDmgAfter = after.oppHpMax - after.oppHpCurrent;
  const deltaEnemyDmg = oppDmgAfter - oppDmgBefore;
  const deltaMyHP = after.myHpCurrent - before.myHpCurrent;
  const deltaDist = before.avgDist - after.avgDist;

  const w = REWARD_WEIGHTS;
  let reward =
    w.vp * deltaVP * (m.vp ?? 1) +
    w.dmg * deltaEnemyDmg * (m.dmg ?? 1) +
    w.hp * deltaMyHP * (m.hp ?? 1) +
    w.dist * deltaDist * (m.dist ?? 1);

  if (isTerminal) {
    const terminalReward = didWin ? w.terminal : -w.terminal;
    reward += terminalReward * (m.terminal ?? 1);
  }
  return reward;
}

/**
 * Create a game tracer that uses agent-specific reward computation.
 */
export function createAgentTracer(learnings, playerNum, dcHealthState, dcMessageMeta, rewardMultipliers) {
  const trace = [];
  let lastSnapshot = null;
  let lastFeatures = null;

  return {
    beforeAction(game) {
      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastFeatures) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastFeatures = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextFeatures = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeAgentReward(lastSnapshot, afterSnap, false, false, rewardMultipliers);
      trace.push({ features: lastFeatures, absType, reward, nextFeatures });
      lastSnapshot = null;
      lastFeatures = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const termReward = didWin
          ? REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1)
          : (didLose ? -REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1) : 0);
        trace[trace.length - 1].reward += termReward;
        trace[trace.length - 1].nextFeatures = null;
      }
      updateTraceLinear(learnings, trace);
      if (updateMeta) {
        learnings.meta.totalGames++;
        if (game.ended && game.winnerId) {
          if (game.winnerId === game.player1Id) learnings.meta.p1Wins++;
          else learnings.meta.p2Wins++;
        }
      }
    },

    getTrace() { return trace; },
  };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getLearningsStats(learnings) {
  const weights = learnings.weights || {};
  let weightCount = 0;
  let maxAbsWeight = 0;
  let minAbsWeight = Infinity;
  let totalAbsWeight = 0;

  const perAction = {};
  for (const [actionType, wArr] of Object.entries(weights)) {
    if (!Array.isArray(wArr)) continue;
    perAction[actionType] = [];
    for (let i = 0; i < wArr.length; i++) {
      const absW = Math.abs(wArr[i]);
      weightCount++;
      totalAbsWeight += absW;
      if (absW > maxAbsWeight) maxAbsWeight = absW;
      if (absW < minAbsWeight) minAbsWeight = absW;
      perAction[actionType].push({ feature: FEATURE_NAMES[i] || `f${i}`, weight: wArr[i], absWeight: absW });
    }
  }
  if (weightCount === 0) minAbsWeight = 0;

  return {
    totalGames: learnings.meta.totalGames,
    p1Wins: learnings.meta.p1Wins,
    p2Wins: learnings.meta.p2Wins,
    weightCount,
    avgAbsWeight: weightCount > 0 ? totalAbsWeight / weightCount : 0,
    weightRange: [-maxAbsWeight, maxAbsWeight],
    totalUpdates: learnings.trainingStats?.totalUpdates || 0,
    avgAbsDelta: learnings.trainingStats?.avgAbsDelta || 0,
    epsilon: getEpsilon(learnings.meta.totalGames),
  };
}
