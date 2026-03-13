/**
 * Strategy learning module — Q-learning over game state-action graphs.
 * Both players share the same graph, indexed from their own perspective.
 * Over many games, finds paths that lead to quicker wins.
 */
import { parseCoord } from '../../src/game/coords.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// ── Constants ───────────────────────────────────────────────────────────────

const GAMMA = 0.95;        // Discount factor (future rewards matter in long games)
const REWARD_WEIGHTS = {
  vp: 10.0,               // VP gained (primary win condition)
  dmg: 0.5,               // Enemy HP removed
  hp: -0.5,               // Own HP lost (negative = penalty)
  dist: 0.1,              // Distance reduction to enemies
  terminal: 50.0,         // Win/loss bonus at game end
};

// ── State Representation ────────────────────────────────────────────────────

function bucketVpDiff(diff) {
  return Math.max(-20, Math.min(20, Math.round(diff / 5) * 5));
}

function bucketHpPct(current, max) {
  if (max <= 0) return 0;
  const pct = (current / max) * 100;
  if (pct <= 0) return 0;
  if (pct <= 25) return 25;
  if (pct <= 50) return 50;
  if (pct <= 75) return 75;
  return 100;
}

function bucketDistance(avg) {
  if (avg <= 1) return 1;
  if (avg <= 2) return 2;
  if (avg <= 3) return 3;
  if (avg <= 5) return 5;
  return 8;
}

function classifyPhase(game, playerNum) {
  if (game.pendingCombat) return 'combat';
  const moves = game.moveInProgress || {};
  if (Object.keys(moves).some(k => moves[k].playerNum === playerNum)) return 'movement';
  if (game.dcActionsData) {
    for (const data of Object.values(game.dcActionsData)) {
      if (data.remaining > 0) return 'mid_activate';
    }
  }
  if (game.roundPhase !== 'activation') return 'round_transition';
  return 'pre_activate';
}

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

export function computeStateHash(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  const myVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total || 0;
  const myHp = getHpTotals(dcHealthState, dcMessageMeta, playerNum);
  const oppHp = getHpTotals(dcHealthState, dcMessageMeta, oppNum);
  const myFigs = Object.keys(game.figurePositions?.[playerNum] || {}).length;
  const oppFigs = Object.keys(game.figurePositions?.[oppNum] || {}).length;
  const avgDist = getAvgDistToEnemy(game, playerNum);
  const phase = classifyPhase(game, playerNum);
  const myActs = Math.min(4, playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0));
  const round = Math.min(5, game.currentRound || game.round || 1);

  return [
    `vp:${bucketVpDiff(myVP - oppVP)}`,
    `mhp:${bucketHpPct(myHp.current, myHp.max)}`,
    `ohp:${bucketHpPct(oppHp.current, oppHp.max)}`,
    `mf:${Math.min(8, myFigs)}`,
    `of:${Math.min(8, oppFigs)}`,
    `d:${bucketDistance(avgDist)}`,
    `ph:${phase}`,
    `a:${myActs}`,
    `r:${round}`,
  ].join('|');
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
        // Compare distance from current position vs proposed position
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
    return 'move_toward'; // Default
  }
  if (t === 'move_figure') return 'start_move';
  // Activation
  if (t === 'activate_dc') return 'activate';
  if (t === 'dc_end_activation') return 'end_activation';
  if (t === 'pass_activation_turn') return 'pass';
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
  const deltaDist = before.avgDist - after.avgDist; // Positive = got closer

  let reward = w.vp * deltaVP + w.dmg * deltaEnemyDmg + w.hp * deltaMyHP + w.dist * deltaDist;
  if (isTerminal) {
    reward += didWin ? w.terminal : -w.terminal;
  }
  return reward;
}

// ── Q-Learning Core ─────────────────────────────────────────────────────────

function ensureState(learnings, hash) {
  if (!learnings.states[hash]) {
    learnings.states[hash] = { visits: 0, actions: {} };
  }
  return learnings.states[hash];
}

function ensureAction(state, absType) {
  if (!state.actions[absType]) {
    state.actions[absType] = { visits: 0, qValue: 0, totalReward: 0, transitions: {} };
  }
  return state.actions[absType];
}

function getMaxQ(learnings, stateHash) {
  const state = learnings.states[stateHash];
  if (!state || Object.keys(state.actions).length === 0) return 0;
  return Math.max(...Object.values(state.actions).map(a => a.qValue));
}

export function updateTrace(learnings, trace) {
  for (let i = trace.length - 1; i >= 0; i--) {
    const { stateHash, absType, reward, nextStateHash } = trace[i];
    const state = ensureState(learnings, stateHash);
    const action = ensureAction(state, absType);
    const maxQNext = nextStateHash ? getMaxQ(learnings, nextStateHash) : 0;
    const alpha = 1 / (1 + 0.01 * action.visits);
    action.qValue += alpha * (reward + GAMMA * maxQNext - action.qValue);
    action.visits += 1;
    action.totalReward += reward;
    state.visits += 1;
    if (nextStateHash) {
      action.transitions[nextStateHash] = (action.transitions[nextStateHash] || 0) + 1;
    }
  }
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

  // If we have mandatory actions mixed with strategic ones, always pick mandatory first
  if (mandatoryActions.length > 0) return pick(mandatoryActions);

  // Strategic actions only from here
  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pick(allActions);

  const stateHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
  const state = learnings.states[stateHash];

  // Epsilon-greedy — but explore with heuristic bias, not fully random
  const epsilon = getEpsilon(learnings.meta.totalGames);
  if (!state || Math.random() < epsilon) {
    // Exploration (or unseen state): use heuristic priority with slight randomization
    // This prevents exploration from making catastrophically bad choices
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: pick best abstract type by Q-value
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const actionData = state.actions[absType];
    const q = actionData?.qValue ?? 0;
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
    // Prefer lower-HP targets (more likely to score a kill)
    // We don't have HP info here easily, so just pick randomly
    return pick(actions);
  }
  if (absType === 'move_toward') {
    // Prefer the space closest to nearest enemy
    const oppNum = actions[0].actingPlayer === 1 ? 2 : 1;
    const oppFigs = Object.values(game.figurePositions?.[oppNum] || {});
    if (oppFigs.length > 0) {
      const scored = actions.map(a => {
        const coord = a.params?.coord || '';
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
  // Same priority as the original pickAction — fallback for unseen states
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const gates = allActions.filter(a => a.type === 'phase_gate_ready');
  if (gates.length > 0) return pick(gates);
  const transitions = allActions.filter(a =>
    a.type === 'end_end_of_round' || a.type === 'end_start_of_round' || a.type === 'end_activation_phase');
  if (transitions.length > 0) return pick(transitions);
  const combat = allActions.filter(a => a.type?.startsWith('combat_'));
  if (combat.length > 0) return pick(combat);
  const attacks = allActions.filter(a => a.type === 'attack_target' && a.params?.targetFigureKey);
  if (attacks.length > 0) return pick(attacks);
  const moveSpaces = allActions.filter(a => a.type === 'move_pick_space' && !a.params?.done);
  if (moveSpaces.length > 0) return pick(moveSpaces);
  const moveFinish = allActions.filter(a => a.type === 'move_pick_space' && a.params?.done);
  if (moveFinish.length > 0) return pick(moveFinish);
  const moveStart = allActions.filter(a => a.type === 'move_figure');
  if (moveStart.length > 0) return pick(moveStart);
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
  let lastStateHash = null;
  let lastAbsType = null;

  return {
    beforeAction(game) {
      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastStateHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastStateHash) return;
      const absType = abstractActionType(action, game);
      // Skip mandatory flow actions (no strategic choice)
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastStateHash = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeReward(lastSnapshot, afterSnap, false, false);
      trace.push({ stateHash: lastStateHash, absType, reward, nextStateHash: nextHash });
      lastSnapshot = null;
      lastStateHash = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      // Apply terminal bonus to the last trace entry
      if (trace.length > 0 && game.ended) {
        trace[trace.length - 1].reward += didWin ? REWARD_WEIGHTS.terminal : (didLose ? -REWARD_WEIGHTS.terminal : 0);
        trace[trace.length - 1].nextStateHash = null; // Terminal state
      }
      // Backward Q-update
      updateTrace(learnings, trace);
      // Only one tracer should update meta per game
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
      // Ensure newer tracking fields exist
      if (!data.dcStats) data.dcStats = {};
      if (!data.affiliationStats) data.affiliationStats = {};
      if (!data.matchups) data.matchups = [];
      return data;
    }
  } catch { /* start fresh */ }
  return {
    meta: { totalGames: 0, p1Wins: 0, p2Wins: 0, lastUpdated: null },
    states: {},
    dcStats: {},           // { dcName: { wins, losses, games, kills, deaths } }
    affiliationStats: {},  // { affiliation: { wins, losses, games } }
    matchups: [],          // last 200 game results for trend analysis
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

  // Helper to get affiliation for a DC
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

  // Track each DC
  function trackDc(dcName, isWinner) {
    if (!learnings.dcStats[dcName]) {
      learnings.dcStats[dcName] = { wins: 0, losses: 0, games: 0, affiliation: getAffiliation(dcName) };
    }
    const s = learnings.dcStats[dcName];
    s.games++;
    if (isWinner === true) s.wins++;
    else if (isWinner === false) s.losses++;
    // Update affiliation in case it was missing
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

  // Track affiliations
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

  // Store recent matchup for trend
  learnings.matchups.push({
    p1: p1Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    p2: p2Army.map(dc => typeof dc === 'object' ? dc.dcName : dc),
    winner: winnerLabel,
    game: learnings.meta.totalGames,
  });
  // Keep last 200
  if (learnings.matchups.length > 200) learnings.matchups = learnings.matchups.slice(-200);
}

// ── Agent-Specific Action Selection (Arena) ─────────────────────────────────

/**
 * Pick an action using an agent's strategy profile instead of global epsilon.
 * Same logic as pickSmartAction but with agent-specific preferences and exploration.
 */
export function pickAgentAction(agent, allActions, game, learnings, playerNum, dcHealthState, dcMessageMeta) {
  if (allActions.length === 0) return null;
  if (allActions.length === 1) return allActions[0];

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Group actions by abstract type
  const groups = {};
  for (const action of allActions) {
    const abs = abstractActionType(action, game);
    if (!groups[abs]) groups[abs] = [];
    groups[abs].push(action);
  }

  // Mandatory actions — always pick first
  const mandatoryTypes = ['gate', 'combat_flow'];
  const mandatoryActions = allActions.filter(a => mandatoryTypes.includes(abstractActionType(a, game)));
  if (mandatoryActions.length === allActions.length) return pickRandom(mandatoryActions);
  if (mandatoryActions.length > 0) return pickRandom(mandatoryActions);

  // Strategic actions only
  const strategicActions = allActions.filter(a => !mandatoryTypes.includes(abstractActionType(a, game)));
  if (strategicActions.length === 0) return pickRandom(allActions);

  const stateHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
  const state = learnings.states[stateHash];

  // Agent-specific epsilon
  const epsilon = agent.strategy.epsilon;
  if (!state || Math.random() < epsilon) {
    return heuristicPick(strategicActions, game);
  }

  // Exploitation: pick best abstract type by Q-value + agent action preferences
  const absTypes = Object.keys(groups).filter(t => !mandatoryTypes.includes(t));
  if (absTypes.length === 0) return heuristicPick(strategicActions, game);

  let bestType = null;
  let bestQ = -Infinity;
  for (const absType of absTypes) {
    const actionData = state.actions[absType];
    const qBase = actionData?.qValue ?? 0;
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
  let lastStateHash = null;

  return {
    beforeAction(game) {
      lastSnapshot = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      lastStateHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
    },

    afterAction(game, action) {
      if (!lastSnapshot || !lastStateHash) return;
      const absType = abstractActionType(action, game);
      if (absType === 'gate' || absType === 'combat_flow') {
        lastSnapshot = null;
        lastStateHash = null;
        return;
      }
      const afterSnap = captureSnapshot(game, playerNum, dcHealthState, dcMessageMeta);
      const nextHash = computeStateHash(game, playerNum, dcHealthState, dcMessageMeta);
      const reward = computeAgentReward(lastSnapshot, afterSnap, false, false, rewardMultipliers);
      trace.push({ stateHash: lastStateHash, absType, reward, nextStateHash: nextHash });
      lastSnapshot = null;
      lastStateHash = null;
    },

    finalize(game, updateMeta = false) {
      const didWin = game.ended && game.winnerId === (playerNum === 1 ? game.player1Id : game.player2Id);
      const didLose = game.ended && game.winnerId && !didWin;
      if (trace.length > 0 && game.ended) {
        const termReward = didWin
          ? REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1)
          : (didLose ? -REWARD_WEIGHTS.terminal * (rewardMultipliers.terminal ?? 1) : 0);
        trace[trace.length - 1].reward += termReward;
        trace[trace.length - 1].nextStateHash = null;
      }
      updateTrace(learnings, trace);
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
  const stateCount = Object.keys(learnings.states).length;
  let actionCount = 0;
  let totalVisits = 0;
  let bestQ = -Infinity;
  let worstQ = Infinity;
  for (const state of Object.values(learnings.states)) {
    totalVisits += state.visits;
    for (const action of Object.values(state.actions)) {
      actionCount++;
      if (action.qValue > bestQ) bestQ = action.qValue;
      if (action.qValue < worstQ) worstQ = action.qValue;
    }
  }
  return {
    totalGames: learnings.meta.totalGames,
    p1Wins: learnings.meta.p1Wins,
    p2Wins: learnings.meta.p2Wins,
    states: stateCount,
    actionEntries: actionCount,
    totalVisits,
    qRange: [worstQ === Infinity ? 0 : worstQ, bestQ === -Infinity ? 0 : bestQ],
    epsilon: getEpsilon(learnings.meta.totalGames),
  };
}
