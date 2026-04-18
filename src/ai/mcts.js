/**
 * Thin PUCT-MCTS on top of the existing dueling DQN.
 *
 * Tree search with:
 *   - Policy prior P(s,a) = softmax(Q[absType(a)]) distributed uniformly
 *     over concrete actions sharing the same abstract action type
 *   - Leaf value V(s) ≈ max_a Q(s,a) from the DQN (no separate value head
 *     until Phase C adds one)
 *   - PUCT child selection: argmax Q(a) + c_puct * P(a) * sqrt(N) / (1 + N(a))
 *
 * The search runs one concrete action per simulation step. State is cloned
 * via structuredClone per simulation and restored before the next sim.
 * Branches that hand control to the opponent (or reach a terminal) are
 * treated as leaves and evaluated once with the DQN.
 *
 * Phase B MVP — see memory `project_alphazero_skirbo.md`.
 */

import { getAvailableActions } from '../engine/available-actions.js';
import {
  extractFeatures,
  getQValues,
  getPolicyPrior,
  abstractActionType,
  ABSTRACT_TYPES,
} from '../../tests/headless/learnings.js';

const DEFAULT_C_PUCT = 1.4;
const DEFAULT_NUM_SIMS = 50;
const DEFAULT_TEMP = 1.0;
// Eval-time defaults: deterministic argmax at root, no Dirichlet noise.
// AlphaZero uses noise + ∝N sampling for *training* diversity; at eval we
// want the strongest pick. Caller overrides via opts for self-play/training.
const DEFAULT_ROOT_TEMP = 0;
const DEFAULT_DIRICHLET_ALPHA = 0.3;
const DEFAULT_DIRICHLET_EPS = 0;

/**
 * Softmax with temperature.
 * @param {number[]} logits
 * @param {number} temp
 * @returns {number[]}
 */
function softmax(logits, temp) {
  const T = Math.max(temp, 1e-6);
  let max = -Infinity;
  for (const x of logits) if (x > max) max = x;
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp((logits[i] - max) / T);
    exps[i] = e;
    sum += e;
  }
  if (sum === 0) return logits.map(() => 1 / logits.length);
  for (let i = 0; i < exps.length; i++) exps[i] /= sum;
  return exps;
}

/**
 * Dirichlet sample via Gamma (Marsaglia-Tsang; good enough for α≥1, decent α<1).
 * Falls back to uniform if something goes sideways. Used only at root for
 * exploration noise mixed into priors.
 */
function sampleGamma(alpha) {
  if (alpha < 1) {
    // Boost: Γ(α) = Γ(α+1) * U^(1/α)
    const g = sampleGamma(alpha + 1);
    const u = Math.random();
    return g * Math.pow(u || 1e-12, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 32; i++) {
    let x, v;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u || 1e-12) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return d; // fallback
}

function sampleDirichlet(alpha, n) {
  const xs = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    xs[i] = sampleGamma(alpha);
    sum += xs[i];
  }
  if (sum === 0) return xs.map(() => 1 / n);
  for (let i = 0; i < n; i++) xs[i] /= sum;
  return xs;
}

/**
 * Sample an index from `weights` proportional to weights^(1/temp).
 * temp=0 → deterministic argmax. temp=1 → proportional to weights.
 */
function sampleProportional(weights, temp) {
  if (temp <= 1e-6) {
    let best = -Infinity, bestI = 0;
    for (let i = 0; i < weights.length; i++) if (weights[i] > best) { best = weights[i]; bestI = i; }
    return bestI;
  }
  const invT = 1 / temp;
  const adj = weights.map(w => Math.pow(Math.max(w, 0), invT));
  let sum = 0;
  for (const x of adj) sum += x;
  if (sum === 0) return Math.floor(Math.random() * weights.length);
  const r = Math.random() * sum;
  let acc = 0;
  for (let i = 0; i < adj.length; i++) {
    acc += adj[i];
    if (r <= acc) return i;
  }
  return adj.length - 1;
}

class MctsNode {
  constructor(priorP = 0) {
    this.priorP = priorP;
    this.N = 0;
    this.W = 0;
    this.children = null; // Map<customId, MctsNode>
    this.actions = null;  // Array<action> parallel to children insertion order
    this.v = 0;           // last leaf-eval (diagnostics)
    this.terminal = false;
  }
  Q() { return this.N === 0 ? 0 : this.W / this.N; }
}

function puctSelect(node, cPuct) {
  let bestId = null;
  let bestScore = -Infinity;
  const sqrtParentN = Math.sqrt(node.N + 1);
  for (const [customId, child] of node.children) {
    const u = cPuct * child.priorP * sqrtParentN / (1 + child.N);
    const score = child.Q() + u;
    if (score > bestScore) {
      bestScore = score;
      bestId = customId;
    }
  }
  return bestId;
}

/**
 * V̂(s) ≈ max Q(s,a) over legal abstract action types.
 * Signed from playerNum's perspective.
 */
function evaluateLeaf(game, playerNum, learnings, dcHealthState, dcMessageMeta, legalActions) {
  if (!legalActions || legalActions.length === 0) return 0;
  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const Q = getQValues(learnings, features);
  if (!Q) return 0;
  let maxQ = -Infinity;
  const seen = new Set();
  for (const a of legalActions) {
    const absType = abstractActionType(a, game);
    if (seen.has(absType)) continue;
    seen.add(absType);
    const idx = ABSTRACT_TYPES.indexOf(absType);
    if (idx < 0) continue;
    if (Q[idx] > maxQ) maxQ = Q[idx];
  }
  return maxQ === -Infinity ? 0 : maxQ;
}

/**
 * Build per-action priors. When the network has a policy head (Phase C),
 * use learned P(s) directly and renormalize over the *legal* abstract types.
 * Otherwise fall back to softmax(Q) over abstract types.
 * In both cases, each absType's mass is distributed uniformly among the
 * concrete actions that share that type.
 */
function computePriors(game, playerNum, learnings, dcHealthState, dcMessageMeta, legalActions, temp) {
  const n = legalActions.length;
  if (n === 0) return [];

  const absTypeOfAction = new Array(n);
  const absTypeGroups = new Map();
  const absTypesOrdered = [];
  for (let i = 0; i < n; i++) {
    const t = abstractActionType(legalActions[i], game);
    absTypeOfAction[i] = t;
    if (!absTypeGroups.has(t)) {
      absTypeGroups.set(t, []);
      absTypesOrdered.push(t);
    }
    absTypeGroups.get(t).push(i);
  }

  const features = extractFeatures(game, playerNum, dcHealthState, dcMessageMeta);
  const priors = new Array(n).fill(0);

  const learnedP = getPolicyPrior(learnings, features);
  const Q = getQValues(learnings, features);
  const qAbsProbs = Q
    ? softmax(absTypesOrdered.map(t => {
        const idx = ABSTRACT_TYPES.indexOf(t);
        return idx >= 0 ? Q[idx] : 0;
      }), temp)
    : null;

  let absProbs;
  if (learnedP) {
    // Phase C: learned policy head. Renormalize over the legal abstract types.
    const raw = absTypesOrdered.map(t => {
      const idx = ABSTRACT_TYPES.indexOf(t);
      return idx >= 0 ? Math.max(learnedP[idx], 1e-9) : 1e-9;
    });
    let sum = 0;
    for (const x of raw) sum += x;
    const pLearned = sum > 0 ? raw.map(x => x / sum) : raw.map(() => 1 / raw.length);

    // Cold-start blend: when the policy head hasn't concentrated mass (near-uniform),
    // lean on Q-priors so MCTS still finds terminal states. maxP vs uniform gives
    // a cheap proxy for "warmth"; linear blend transitions smoothly as Wp trains.
    if (qAbsProbs) {
      const uniform = 1 / pLearned.length;
      const maxP = Math.max(...pLearned);
      const spread = Math.max(0, maxP - uniform);
      const warmth = Math.min(1, spread / (2 * uniform));
      const beta = 1 - warmth;
      absProbs = pLearned.map((p, i) => (1 - beta) * p + beta * qAbsProbs[i]);
    } else {
      absProbs = pLearned;
    }
  } else if (qAbsProbs) {
    absProbs = qAbsProbs;
  } else {
    for (let i = 0; i < n; i++) priors[i] = 1 / n;
    return priors;
  }

  for (let k = 0; k < absTypesOrdered.length; k++) {
    const indices = absTypeGroups.get(absTypesOrdered[k]);
    const perAction = absProbs[k] / indices.length;
    for (const i of indices) priors[i] = perAction;
  }
  return priors;
}

/**
 * Snapshot the full simulator state needed to restore after a rollout.
 * Includes every external map that handlers mutate: dcExhausted, dcHealth,
 * and dcMessageMeta (handlers add/remove entries on massive-push respawn,
 * companion spawn, DC defeat, etc.). Failing to restore dcMessageMeta lets
 * simulated action-space pollution leak across sims and between MCTS calls
 * in a long-running ladder.
 */
function snapshotState(game, dcExhaustedState, dcHealthState, dcMessageMeta) {
  return {
    gameId: game.gameId,
    gameClone: structuredClone(game),
    exhaustedClone: new Map(dcExhaustedState),
    healthClone: new Map(dcHealthState),
    metaClone: dcMessageMeta ? new Map(dcMessageMeta) : null,
  };
}

function restoreState(snapshot, gamesMap, dcExhaustedState, dcHealthState, dcMessageMeta) {
  gamesMap.set(snapshot.gameId, structuredClone(snapshot.gameClone));
  dcExhaustedState.clear();
  for (const [k, v] of snapshot.exhaustedClone) dcExhaustedState.set(k, v);
  dcHealthState.clear();
  for (const [k, v] of snapshot.healthClone) dcHealthState.set(k, v);
  if (dcMessageMeta && snapshot.metaClone) {
    dcMessageMeta.clear();
    for (const [k, v] of snapshot.metaClone) dcMessageMeta.set(k, v);
  }
  return gamesMap.get(snapshot.gameId);
}

/**
 * Main MCTS entry point.
 *
 * @param {object} opts
 * @param {object} opts.game - current game (the live instance inside gamesMap)
 * @param {number} opts.playerNum - 1 or 2, the root player
 * @param {object} opts.actionDeps - deps bundle for getAvailableActions
 * @param {object} opts.learnings - DQN checkpoint { network, ... }
 * @param {object} opts.harness - headless harness with submitAction + getGamesMap
 * @param {Map} opts.dcHealthState
 * @param {Map} opts.dcExhaustedState
 * @param {Map} opts.dcMessageMeta
 * @param {number} [opts.numSims=50]
 * @param {number} [opts.cPuct=1.4]
 * @param {number} [opts.temp=1.0] - prior softmax temperature
 * @returns {Promise<{ action: object, score: number, stats: object } | null>}
 */
export async function pickMctsAction(opts) {
  const {
    playerNum, actionDeps, learnings, harness,
    dcHealthState, dcExhaustedState, dcMessageMeta,
    numSims = DEFAULT_NUM_SIMS,
    cPuct = DEFAULT_C_PUCT,
    temp = DEFAULT_TEMP,
    rootTemp = DEFAULT_ROOT_TEMP,
    dirichletAlpha = DEFAULT_DIRICHLET_ALPHA,
    dirichletEps = DEFAULT_DIRICHLET_EPS,
  } = opts;

  const gamesMap = harness.getGamesMap();
  // Always operate against the live gamesMap entry — the caller's `game`
  // reference may go stale after internal restores (structuredClone swaps the
  // object under the map) but the gameId is durable.
  const gameId = opts.game.gameId;
  let game = gamesMap.get(gameId) || opts.game;
  const userId = playerNum === 1 ? game.player1Id : game.player2Id;

  const rootActions = getAvailableActions(game, playerNum, actionDeps);
  if (rootActions.length === 0) return null;
  if (rootActions.length === 1) return { action: rootActions[0], score: 0, stats: { totalSims: 0, shortCircuit: true } };

  const root = new MctsNode(1.0);
  root.children = new Map();
  root.actions = rootActions;
  let rootPriors = computePriors(game, playerNum, learnings, dcHealthState, dcMessageMeta, rootActions, temp);
  // Dirichlet noise at root (AlphaZero recipe): P_root(a) = (1-ε)P(a) + ε η(a).
  // Without this, the DQN-derived priors are sharply peaked on one action and
  // every MCTS call picks the same concrete customId — the ladder's sameCid
  // breaker then fires every iter. Noise widens the visit distribution.
  if (dirichletEps > 0 && rootActions.length > 1) {
    const noise = sampleDirichlet(dirichletAlpha, rootActions.length);
    rootPriors = rootPriors.map((p, i) => (1 - dirichletEps) * p + dirichletEps * noise[i]);
  }
  for (let i = 0; i < rootActions.length; i++) {
    root.children.set(rootActions[i].customId, new MctsNode(rootPriors[i]));
  }

  const rootSnap = snapshotState(game, dcExhaustedState, dcHealthState, dcMessageMeta);

  let expansions = 0;
  let terminalHits = 0;
  let handlerErrors = 0;

  const MAX_SIM_STEPS = 32; // watchdog: cap descent depth per simulation

  for (let sim = 0; sim < numSims; sim++) {
    let node = root;
    let liveActions = rootActions;
    let liveGame = game;
    const path = [root];

    let simSteps = 0;
    while (simSteps < MAX_SIM_STEPS) {
      simSteps++;
      if (node.children === null || node.children.size === 0 || node.terminal) break;

      const customId = puctSelect(node, cPuct);
      if (!customId) break;
      const child = node.children.get(customId);
      path.push(child);

      let stepErr = null;
      try {
        await harness.submitAction(customId, userId);
      } catch (err) {
        stepErr = err;
        handlerErrors++;
      }

      liveGame = gamesMap.get(rootSnap.gameId);

      if (stepErr || !liveGame) {
        child.terminal = true;
        child.v = 0;
        break;
      }

      if (liveGame.ended) {
        child.terminal = true;
        terminalHits++;
        const myId = playerNum === 1 ? liveGame.player1Id : liveGame.player2Id;
        child.v = liveGame.winnerId === myId ? 1 : (liveGame.winnerId ? -1 : 0);
        break;
      }

      // If control shifted to opponent, this branch is a leaf for root-player MCTS.
      const tpid = liveGame.currentActivationTurnPlayerId ?? liveGame.initiativePlayerId;
      const activePN = tpid === liveGame.player1Id ? 1 : (tpid === liveGame.player2Id ? 2 : playerNum);
      if (activePN !== playerNum) {
        if (child.children === null) {
          child.children = new Map();
          const oppActions = getAvailableActions(liveGame, activePN, actionDeps);
          child.v = evaluateLeaf(liveGame, playerNum, learnings, dcHealthState, dcMessageMeta, oppActions);
          expansions++;
        }
        break;
      }

      liveActions = getAvailableActions(liveGame, playerNum, actionDeps);

      if (child.children === null) {
        // First expansion of this node: create children, set leaf value, done.
        if (liveActions.length === 0) {
          child.terminal = true;
          child.v = 0;
        } else {
          child.children = new Map();
          child.actions = liveActions;
          const priors = computePriors(liveGame, playerNum, learnings, dcHealthState, dcMessageMeta, liveActions, temp);
          for (let i = 0; i < liveActions.length; i++) {
            child.children.set(liveActions[i].customId, new MctsNode(priors[i]));
          }
          child.v = evaluateLeaf(liveGame, playerNum, learnings, dcHealthState, dcMessageMeta, liveActions);
        }
        expansions++;
        break;
      }

      // Already expanded — descend further.
      node = child;
    }

    const leafV = path[path.length - 1].v ?? 0;
    for (const n of path) {
      n.N += 1;
      n.W += leafV;
    }

    restoreState(rootSnap, gamesMap, dcExhaustedState, dcHealthState, dcMessageMeta);
  }

  const rootVisits = new Array(rootActions.length);
  const rootQs = new Array(rootActions.length);
  for (let i = 0; i < rootActions.length; i++) {
    const child = root.children.get(rootActions[i].customId);
    rootVisits[i] = child.N;
    rootQs[i] = child.Q();
  }

  // Sample action at root ∝ N^(1/rootTemp). rootTemp>0 gives stochastic picks
  // which (a) break the sameCid-every-iter pattern when the DQN prior is sharp
  // and (b) mirrors AlphaZero's training-time move selection.
  const pickedIdx = sampleProportional(rootVisits, rootTemp);
  const bestAction = rootActions[pickedIdx];
  const bestQ = rootQs[pickedIdx];

  return {
    action: bestAction,
    score: bestQ,
    stats: { totalSims: numSims, expansions, terminalHits, handlerErrors, rootVisits, rootQs, pickedIdx, rootActions },
  };
}

export const __mctsInternals = {
  softmax, puctSelect, computePriors, evaluateLeaf, MctsNode,
  sampleGamma, sampleDirichlet, sampleProportional,
};
