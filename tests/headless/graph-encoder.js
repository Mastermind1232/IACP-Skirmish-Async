/**
 * Graph Neural Network encoder for DQN state representation.
 * Replaces the flat 49-dim extractFeatures() with a GNN that captures
 * spatial/relational structure between figures on the board.
 *
 * Architecture: 2-layer message-passing GNN → mean pool → readout → DQN head
 * Node types: figures (friendly + enemy)
 * Edge features: normalized distance, in-attack-range, same-team
 */
import { parseCoord } from '../../src/game/coords.js';
import { getDcEffects } from '../../src/data-loader.js';

// ── Graph Constants ──────────────────────────────────────────────────────────
const GRAPH_NODE_DIM = 9;       // features per node (added distToNearestEnemy)
const GRAPH_EMBED_DIM = 16;     // node embedding size
const GRAPH_EDGE_DIM = 3;       // edge features: normDist, inRange, sameTeam
const GRAPH_LAYERS = 2;         // message-passing layers
const GRAPH_OUTPUT_DIM = 32;    // final state embedding fed to DQN head
const GRAPH_MSG_INPUT = GRAPH_EMBED_DIM + GRAPH_EDGE_DIM; // 19 — concat(neighbor, edge)
const GRAPH_UP_INPUT = GRAPH_EMBED_DIM + GRAPH_MSG_INPUT;  // 35 — concat(self, aggregated_msg)
const HIDDEN_SIZE = 64;
const WEIGHT_CLAMP = 50.0;
const EXPECTED_DMG = { red: 2.17, blue: 1.17, green: 1.33, yellow: 0.67 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function randn() {
  let u;
  do { u = Math.random(); } while (u === 0);
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * Math.random());
}

function coordDistance(a, b) {
  const pa = parseCoord(a);
  const pb = parseCoord(b);
  return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
}

// ── Graph Construction ───────────────────────────────────────────────────────

/**
 * Build a graph from the current game state.
 * Nodes: one per surviving figure (both players).
 * Edges: fully connected (small graphs, ~5-15 nodes).
 * Returns { nodes: [{features, team}], edges: [{src, dst, features}], numNodes }
 */
export function buildGraph(game, playerNum, dcHealthState, dcMessageMeta) {
  const oppNum = playerNum === 1 ? 2 : 1;
  let dcEffectsData;
  try { dcEffectsData = getDcEffects(); } catch { dcEffectsData = {}; }

  // Find active DC for this player
  let activeDcName = null;
  let activeFigIdx = 0;
  const dcIdx = game.currentActivatingDcIndex;
  const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  if (dcIdx != null && dcMsgIds && dcMsgIds[dcIdx]) {
    const msgId = dcMsgIds[dcIdx];
    const meta = dcMessageMeta?.get(msgId);
    if (meta && meta.playerNum === playerNum) {
      activeDcName = meta.dcName;
      activeFigIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    }
  }

  const nodes = [];
  const coords = [];

  // Add figure nodes for both players
  for (const pn of [playerNum, oppNum]) {
    const team = pn === playerNum ? 1.0 : -1.0;
    const figs = game.figurePositions?.[pn] || {};

    for (const [figKey, coord] of Object.entries(figs)) {
      // Extract DC name from figure key: "Jedi Luke-1-0" → "Jedi Luke"
      const dcName = figKey.replace(/-\d+-\d+$/, '');
      const parts = figKey.split('-');
      const figIndex = parseInt(parts[parts.length - 1], 10) || 0;

      // HP ratio
      let hpRatio = 1.0;
      const hp = lookupFigHp(figKey, pn, dcHealthState, dcMessageMeta);
      if (hp && hp.max > 0) hpRatio = hp.current / hp.max;

      // DC stats
      const lower = dcName.toLowerCase();
      const ciKey = dcEffectsData ? Object.keys(dcEffectsData).find(k => k.toLowerCase() === lower) : null;
      const eff = dcEffectsData?.[dcName] || (ciKey ? dcEffectsData[ciKey] : null);

      const speed = eff?.speed ? Math.min(eff.speed, 8) / 8 : 0.5;
      let attackPower = 0.5;
      let attackRange = 1;
      if (eff?.attack?.dice) {
        let dmg = 0;
        for (const die of eff.attack.dice) dmg += EXPECTED_DMG[die] || 0;
        attackPower = Math.min(dmg, 8) / 8;
      }
      if (eff?.attack?.range) attackRange = eff.attack.range;
      const normRange = Math.min(attackRange, 12) / 12;

      // Is this the currently active figure?
      const isActive = (pn === playerNum && dcName === activeDcName && figIndex === activeFigIdx) ? 1.0 : 0.0;

      // Stun check
      let isStunned = 0;
      const fc = game.figureConditions?.[figKey];
      if (Array.isArray(fc) && fc.some(c => String(c).toLowerCase() === 'stun')) {
        isStunned = 1.0;
      }

      nodes.push({
        features: [team, hpRatio, speed, attackPower, normRange, isActive, isStunned, 1.0, 0.0], // slot 8 = distToNearestEnemy (filled below)
        team,
        attackRange,  // raw range for edge computation
      });
      coords.push(coord);
    }
  }

  // Handle empty board (shouldn't happen, but safety)
  if (nodes.length === 0) {
    nodes.push({
      features: [0, 0, 0, 0, 0, 0, 0, 1.0, 1.0],
      team: 0,
      attackRange: 1,
    });
    coords.push('a1');
  }

  // Compute distToNearestEnemy for each node (slot 8)
  for (let i = 0; i < nodes.length; i++) {
    let minDist = 20;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j || nodes[i].team === nodes[j].team) continue;
      const d = coordDistance(coords[i], coords[j]);
      if (d < minDist) minDist = d;
    }
    nodes[i].features[8] = Math.min(minDist / 20, 1.0); // normalized [0,1]
  }

  // Build edges: fully connected
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dist = coordDistance(coords[i], coords[j]);
      const normDist = Math.min(dist / 20, 1.0);
      const inRange = dist <= Math.max(1, nodes[i].attackRange) ? 1.0 : 0.0;
      const sameTeam = nodes[i].team === nodes[j].team ? 1.0 : 0.0;
      edges.push({ src: i, dst: j, features: [normDist, inRange, sameTeam] });
    }
  }

  return { nodes, edges, numNodes: nodes.length };
}

function lookupFigHp(figureKey, playerNum, dcHealthState, dcMessageMeta) {
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

// ── Network Initialization ───────────────────────────────────────────────────

function makeMatrix(rows, cols, std) {
  const m = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(randn() * std);
    m.push(row);
  }
  return m;
}

/**
 * Initialize graph network parameters.
 * @param {number} numActions - number of abstract action types (23)
 */
export function initGraphNetwork(numActions) {
  const heEmbed = Math.sqrt(2 / GRAPH_NODE_DIM);
  const heUp = Math.sqrt(2 / GRAPH_UP_INPUT);
  const heRead = Math.sqrt(2 / GRAPH_EMBED_DIM);
  const heW1 = Math.sqrt(2 / GRAPH_OUTPUT_DIM);
  const xavierV = Math.sqrt(2 / (HIDDEN_SIZE + 1));
  const xavierA = Math.sqrt(2 / (HIDDEN_SIZE + numActions));

  return {
    // Node embedding: [EMBED_DIM x NODE_DIM]
    W_embed: makeMatrix(GRAPH_EMBED_DIM, GRAPH_NODE_DIM, heEmbed),
    b_embed: new Array(GRAPH_EMBED_DIM).fill(0),

    // Message-passing layers
    layers: Array.from({ length: GRAPH_LAYERS }, () => ({
      W_up: makeMatrix(GRAPH_EMBED_DIM, GRAPH_UP_INPUT, heUp),
      b_up: new Array(GRAPH_EMBED_DIM).fill(0),
    })),

    // Readout: [OUTPUT_DIM x EMBED_DIM]
    W_read: makeMatrix(GRAPH_OUTPUT_DIM, GRAPH_EMBED_DIM, heRead),
    b_read: new Array(GRAPH_OUTPUT_DIM).fill(0),

    // DQN head: same dueling structure, input = GRAPH_OUTPUT_DIM
    W1: makeMatrix(HIDDEN_SIZE, GRAPH_OUTPUT_DIM, heW1),
    b1: new Array(HIDDEN_SIZE).fill(0),
    Wv: Array.from({ length: HIDDEN_SIZE }, () => randn() * xavierV),
    bv: 0,
    Wa: makeMatrix(numActions, HIDDEN_SIZE, xavierA),
    ba: new Array(numActions).fill(0),
  };
}

// ── Forward Pass ─────────────────────────────────────────────────────────────

/**
 * Full forward pass: GNN → pool → readout → DQN head.
 * Returns { Q, V, A, cache } where cache has all intermediates for backprop.
 */
export function graphForwardPass(gNet, graph) {
  const N = graph.numNodes;
  const nActions = gNet.Wa.length;

  // Build adjacency lists for fast neighbor lookup
  const neighbors = Array.from({ length: N }, () => []);
  for (const e of graph.edges) {
    neighbors[e.dst].push(e); // edge src→dst: node dst receives message from src
  }

  // 1. Node embedding: h0 = ReLU(W_embed @ node_features + b_embed)
  const h_layers = []; // h_layers[l][i] = embedding of node i at layer l
  const h_pre_layers = []; // pre-ReLU values for backprop
  const h0 = [];
  const h0_pre = [];
  for (let i = 0; i < N; i++) {
    const pre = new Array(GRAPH_EMBED_DIM);
    const post = new Array(GRAPH_EMBED_DIM);
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
      let sum = gNet.b_embed[d];
      for (let f = 0; f < GRAPH_NODE_DIM; f++) {
        sum += gNet.W_embed[d][f] * (graph.nodes[i].features[f] || 0);
      }
      pre[d] = sum;
      post[d] = sum > 0 ? sum : 0; // ReLU
    }
    h0_pre.push(pre);
    h0.push(post);
  }
  h_pre_layers.push(h0_pre);
  h_layers.push(h0);

  // 2. Message-passing layers
  const agg_cache = []; // agg_cache[l][i] = aggregated message for node i at layer l
  const cat_cache = []; // cat_cache[l][i] = concat(h[i], agg[i])
  for (let l = 0; l < GRAPH_LAYERS; l++) {
    const h_prev = h_layers[l];
    const layer = gNet.layers[l];
    const h_new = [];
    const h_new_pre = [];
    const aggs = [];
    const cats = [];

    for (let i = 0; i < N; i++) {
      // Aggregate messages from neighbors
      const agg = new Array(GRAPH_MSG_INPUT).fill(0);
      const nbs = neighbors[i];
      if (nbs.length > 0) {
        for (const e of nbs) {
          // msg = concat(h_prev[src], edge_features)
          for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
            agg[d] += h_prev[e.src][d];
          }
          for (let d = 0; d < GRAPH_EDGE_DIM; d++) {
            agg[GRAPH_EMBED_DIM + d] += (e.features[d] || 0);
          }
        }
        // Mean aggregation
        for (let d = 0; d < GRAPH_MSG_INPUT; d++) {
          agg[d] /= nbs.length;
        }
      }
      aggs.push(agg);

      // Concat self + aggregated message
      const cat = new Array(GRAPH_UP_INPUT);
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) cat[d] = h_prev[i][d];
      for (let d = 0; d < GRAPH_MSG_INPUT; d++) cat[GRAPH_EMBED_DIM + d] = agg[d];
      cats.push(cat);

      // Update: h_new = ReLU(W_up @ cat + b_up)
      const pre = new Array(GRAPH_EMBED_DIM);
      const post = new Array(GRAPH_EMBED_DIM);
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
        let sum = layer.b_up[d];
        for (let c = 0; c < GRAPH_UP_INPUT; c++) {
          sum += layer.W_up[d][c] * cat[c];
        }
        pre[d] = sum;
        post[d] = sum > 0 ? sum : 0; // ReLU
      }
      h_new_pre.push(pre);
      h_new.push(post);
    }
    h_pre_layers.push(h_new_pre);
    h_layers.push(h_new);
    agg_cache.push(aggs);
    cat_cache.push(cats);
  }

  // 3. Global mean pooling
  const pooled = new Array(GRAPH_EMBED_DIM).fill(0);
  const h_final = h_layers[GRAPH_LAYERS];
  for (let i = 0; i < N; i++) {
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
      pooled[d] += h_final[i][d];
    }
  }
  if (N > 0) {
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) pooled[d] /= N;
  }

  // 4. Readout: state_embed = ReLU(W_read @ pooled + b_read)
  const read_pre = new Array(GRAPH_OUTPUT_DIM);
  const state_embed = new Array(GRAPH_OUTPUT_DIM);
  for (let d = 0; d < GRAPH_OUTPUT_DIM; d++) {
    let sum = gNet.b_read[d];
    for (let e = 0; e < GRAPH_EMBED_DIM; e++) {
      sum += gNet.W_read[d][e] * pooled[e];
    }
    read_pre[d] = sum;
    state_embed[d] = sum > 0 ? sum : 0;
  }

  // 5. DQN head: same dueling architecture
  const dqn_h_pre = new Array(HIDDEN_SIZE);
  const dqn_h = new Array(HIDDEN_SIZE);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    let sum = gNet.b1[j];
    for (let i = 0; i < GRAPH_OUTPUT_DIM; i++) {
      sum += gNet.W1[j][i] * state_embed[i];
    }
    dqn_h_pre[j] = sum;
    dqn_h[j] = sum > 0 ? sum : 0;
  }

  let V = gNet.bv;
  for (let j = 0; j < HIDDEN_SIZE; j++) V += gNet.Wv[j] * dqn_h[j];

  const A = new Array(nActions);
  let meanA = 0;
  for (let k = 0; k < nActions; k++) {
    let sum = gNet.ba[k];
    for (let j = 0; j < HIDDEN_SIZE; j++) sum += gNet.Wa[k][j] * dqn_h[j];
    A[k] = sum;
    meanA += sum;
  }
  meanA /= nActions;

  const Q = new Array(nActions);
  for (let k = 0; k < nActions; k++) Q[k] = V + A[k] - meanA;

  return {
    Q, V, A,
    cache: {
      graph, neighbors, N, nActions,
      h_layers, h_pre_layers,
      agg_cache, cat_cache,
      pooled, read_pre, state_embed,
      dqn_h_pre, dqn_h,
    },
  };
}

// ── Backpropagation ──────────────────────────────────────────────────────────

/**
 * Manual backprop through full graph encoder + DQN head.
 *
 * ARCHITECTURE: Two-phase design — compute ALL gradients first using original
 * (pre-update) weights, THEN apply all weight updates. This avoids the
 * read-after-write bug where downstream gradient computation uses weights that
 * were already modified by upstream updates.
 *
 * Shared weights (W_up, W_embed) accumulate gradients across all N nodes
 * before a single weight update, applying weight decay exactly once.
 *
 * @param {object} gNet - graph network parameters (mutated in-place)
 * @param {object} cache - intermediates from graphForwardPass
 * @param {number} actionIdx - chosen action index
 * @param {number} delta - TD error (clamped)
 * @param {number} alpha - learning rate
 * @param {number} weightDecay - L2 decay factor
 */
export function graphBackpropUpdate(gNet, cache, actionIdx, delta, alpha, weightDecay) {
  const { graph, neighbors, N, nActions } = cache;
  const decay = 1 - weightDecay;
  const clamp = WEIGHT_CLAMP;

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Compute all gradients using ORIGINAL (pre-update) weights
  // ════════════════════════════════════════════════════════════════════════════

  const dAChosen = delta * ((nActions - 1) / nActions);
  const dAOther = delta * (-1 / nActions);

  // ── Step 1: DQN head gradients ─────────────────────────────────────────────

  // Gradient to DQN hidden (using ORIGINAL Wv, Wa)
  const dDqnH = new Array(HIDDEN_SIZE).fill(0);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    dDqnH[j] = delta * gNet.Wv[j];
    for (let m = 0; m < nActions; m++) {
      dDqnH[j] += ((m === actionIdx) ? dAChosen : dAOther) * gNet.Wa[m][j];
    }
    if (cache.dqn_h_pre[j] <= 0) dDqnH[j] = 0; // ReLU gate
  }

  // Gradient to state_embed (using ORIGINAL W1)
  const dStateEmbed = new Array(GRAPH_OUTPUT_DIM).fill(0);
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    for (let i = 0; i < GRAPH_OUTPUT_DIM; i++) {
      dStateEmbed[i] += dDqnH[j] * gNet.W1[j][i];
    }
  }

  // ── Step 2: Readout gradients ──────────────────────────────────────────────

  // ReLU gate on readout
  const dReadPre = new Array(GRAPH_OUTPUT_DIM);
  for (let d = 0; d < GRAPH_OUTPUT_DIM; d++) {
    dReadPre[d] = cache.read_pre[d] > 0 ? dStateEmbed[d] : 0;
  }

  // Gradient to pooled (using ORIGINAL W_read)
  const dPooled = new Array(GRAPH_EMBED_DIM).fill(0);
  for (let d = 0; d < GRAPH_OUTPUT_DIM; d++) {
    for (let e = 0; e < GRAPH_EMBED_DIM; e++) {
      dPooled[e] += dReadPre[d] * gNet.W_read[d][e];
    }
  }

  // ── Step 3: Pooling gradient ───────────────────────────────────────────────
  const dHFinal = [];
  for (let i = 0; i < N; i++) {
    const dh = new Array(GRAPH_EMBED_DIM);
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) dh[d] = dPooled[d] / N;
    dHFinal.push(dh);
  }

  // ── Step 4: Message-passing layers gradient (reverse order) ────────────────
  // Accumulate W_up/b_up gradients across all nodes, using ORIGINAL W_up
  const layerGrads = gNet.layers.map(() => ({
    dW_up: Array.from({ length: GRAPH_EMBED_DIM }, () => new Array(GRAPH_UP_INPUT).fill(0)),
    db_up: new Array(GRAPH_EMBED_DIM).fill(0),
  }));

  let dH = dHFinal;

  for (let l = GRAPH_LAYERS - 1; l >= 0; l--) {
    const layer = gNet.layers[l];
    const lg = layerGrads[l];
    const dH_prev = Array.from({ length: N }, () => new Array(GRAPH_EMBED_DIM).fill(0));

    for (let i = 0; i < N; i++) {
      // ReLU gate
      const h_pre_il = cache.h_pre_layers[l + 1][i];
      const dPreI = new Array(GRAPH_EMBED_DIM);
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
        dPreI[d] = h_pre_il[d] > 0 ? dH[i][d] : 0;
      }

      // Accumulate W_up gradient: dW_up += dPreI ⊗ cat[l][i]
      const cat = cache.cat_cache[l][i];
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
        for (let c = 0; c < GRAPH_UP_INPUT; c++) {
          lg.dW_up[d][c] += dPreI[d] * cat[c];
        }
        lg.db_up[d] += dPreI[d];
      }

      // Gradient to cat using ORIGINAL W_up (not yet modified)
      const dCat = new Array(GRAPH_UP_INPUT).fill(0);
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
        for (let c = 0; c < GRAPH_UP_INPUT; c++) {
          dCat[c] += dPreI[d] * layer.W_up[d][c];
        }
      }

      // Split dCat into dH_prev[i] (self) and dAgg (aggregated message)
      for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
        dH_prev[i][d] += dCat[d];
      }
      const dAgg = dCat.slice(GRAPH_EMBED_DIM);

      // Distribute aggregate gradient to neighbors
      const nbs = neighbors[i];
      if (nbs.length > 0) {
        for (const e of nbs) {
          for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
            dH_prev[e.src][d] += dAgg[d] / nbs.length;
          }
        }
      }
    }

    dH = dH_prev;
  }

  // ── Step 5: Node embedding gradient ────────────────────────────────────────
  // Accumulate W_embed/b_embed gradients across all N nodes
  const dW_embed = Array.from({ length: GRAPH_EMBED_DIM }, () => new Array(GRAPH_NODE_DIM).fill(0));
  const db_embed = new Array(GRAPH_EMBED_DIM).fill(0);

  for (let i = 0; i < N; i++) {
    const h_pre_0 = cache.h_pre_layers[0][i];
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
      const grad = h_pre_0[d] > 0 ? dH[i][d] : 0; // ReLU gate
      for (let f = 0; f < GRAPH_NODE_DIM; f++) {
        dW_embed[d][f] += grad * (graph.nodes[i].features[f] || 0);
      }
      db_embed[d] += grad;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Apply all weight updates using accumulated gradients
  // ════════════════════════════════════════════════════════════════════════════

  // DQN advantage head
  for (let m = 0; m < nActions; m++) {
    const dA = (m === actionIdx) ? dAChosen : dAOther;
    for (let j = 0; j < HIDDEN_SIZE; j++) {
      gNet.Wa[m][j] = clampVal(gNet.Wa[m][j] * decay + alpha * dA * cache.dqn_h[j], clamp);
    }
    gNet.ba[m] += alpha * dA;
  }

  // DQN value head
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    gNet.Wv[j] = clampVal(gNet.Wv[j] * decay + alpha * delta * cache.dqn_h[j], clamp);
  }
  gNet.bv += alpha * delta;

  // DQN hidden layer (W1, b1)
  for (let j = 0; j < HIDDEN_SIZE; j++) {
    for (let i = 0; i < GRAPH_OUTPUT_DIM; i++) {
      gNet.W1[j][i] = clampVal(gNet.W1[j][i] * decay + alpha * dDqnH[j] * cache.state_embed[i], clamp);
    }
    gNet.b1[j] += alpha * dDqnH[j];
  }

  // Readout (W_read, b_read)
  for (let d = 0; d < GRAPH_OUTPUT_DIM; d++) {
    for (let e = 0; e < GRAPH_EMBED_DIM; e++) {
      gNet.W_read[d][e] = clampVal(gNet.W_read[d][e] * decay + alpha * dReadPre[d] * cache.pooled[e], clamp);
    }
    gNet.b_read[d] += alpha * dReadPre[d];
  }

  // Message-passing layers (W_up, b_up) — single update with accumulated gradient
  for (let l = 0; l < GRAPH_LAYERS; l++) {
    const layer = gNet.layers[l];
    const lg = layerGrads[l];
    for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
      for (let c = 0; c < GRAPH_UP_INPUT; c++) {
        layer.W_up[d][c] = clampVal(layer.W_up[d][c] * decay + alpha * lg.dW_up[d][c], clamp);
      }
      layer.b_up[d] += alpha * lg.db_up[d];
    }
  }

  // Node embedding (W_embed, b_embed) — single update with accumulated gradient
  for (let d = 0; d < GRAPH_EMBED_DIM; d++) {
    for (let f = 0; f < GRAPH_NODE_DIM; f++) {
      gNet.W_embed[d][f] = clampVal(gNet.W_embed[d][f] * decay + alpha * dW_embed[d][f], clamp);
    }
    gNet.b_embed[d] += alpha * db_embed[d];
  }
}

function clampVal(v, c) {
  return v > c ? c : v < -c ? -c : v;
}

// ── Masked Best Q (graph version) ────────────────────────────────────────────

export function getGraphMaskedBestQ(gNet, graph, nextActionIdxs) {
  if (!nextActionIdxs || nextActionIdxs.length === 0) return 0;
  const { Q } = graphForwardPass(gNet, graph);
  let maxQ = -Infinity;
  for (const idx of nextActionIdxs) {
    if (idx < Q.length && Q[idx] > maxQ) maxQ = Q[idx];
  }
  return isFinite(maxQ) ? maxQ : 0;
}

// ── Deep Copy ────────────────────────────────────────────────────────────────

export function deepCopyGraphNetwork(gNet) {
  return {
    W_embed: gNet.W_embed.map(r => [...r]),
    b_embed: [...gNet.b_embed],
    layers: gNet.layers.map(l => ({
      W_up: l.W_up.map(r => [...r]),
      b_up: [...l.b_up],
    })),
    W_read: gNet.W_read.map(r => [...r]),
    b_read: [...gNet.b_read],
    W1: gNet.W1.map(r => [...r]),
    b1: [...gNet.b1],
    Wv: [...gNet.Wv],
    bv: gNet.bv,
    Wa: gNet.Wa.map(r => [...r]),
    ba: [...gNet.ba],
  };
}

// ── NaN Safety ───────────────────────────────────────────────────────────────

export function sanitizeGraphNetwork(gNet, stats) {
  let resets = 0;
  const fix = (v) => isFinite(v) ? v : 0;
  const fixArr = (arr) => { for (let i = 0; i < arr.length; i++) { if (!isFinite(arr[i])) { arr[i] = 0; resets++; } } };
  const fixMat = (mat) => { for (const row of mat) fixArr(row); };

  fixMat(gNet.W_embed); fixArr(gNet.b_embed);
  for (const l of gNet.layers) { fixMat(l.W_up); fixArr(l.b_up); }
  fixMat(gNet.W_read); fixArr(gNet.b_read);
  fixMat(gNet.W1); fixArr(gNet.b1);
  fixArr(gNet.Wv);
  if (!isFinite(gNet.bv)) { gNet.bv = 0; resets++; }
  fixMat(gNet.Wa); fixArr(gNet.ba);

  if (resets > 0 && stats) stats.nanResets = (stats.nanResets || 0) + resets;
  return resets;
}

// ── Serialization helpers ────────────────────────────────────────────────────

/** Convert graph network to plain JSON for persistence. */
export function serializeGraphNetwork(gNet) {
  return {
    W_embed: gNet.W_embed, b_embed: gNet.b_embed,
    layers: gNet.layers.map(l => ({ W_up: l.W_up, b_up: l.b_up })),
    W_read: gNet.W_read, b_read: gNet.b_read,
    W1: gNet.W1, b1: gNet.b1,
    Wv: gNet.Wv, bv: gNet.bv,
    Wa: gNet.Wa, ba: gNet.ba,
  };
}

// ── Stats ────────────────────────────────────────────────────────────────────

export function getGraphNetworkStats(gNet) {
  let weightCount = 0;
  let absSum = 0;
  const addArr = (arr) => { for (const v of arr) { weightCount++; absSum += Math.abs(v); } };
  const addMat = (mat) => { for (const row of mat) addArr(row); };

  addMat(gNet.W_embed); addArr(gNet.b_embed);
  for (const l of gNet.layers) { addMat(l.W_up); addArr(l.b_up); }
  addMat(gNet.W_read); addArr(gNet.b_read);
  addMat(gNet.W1); addArr(gNet.b1);
  addArr(gNet.Wv);
  weightCount++; absSum += Math.abs(gNet.bv);
  addMat(gNet.Wa); addArr(gNet.ba);

  return { weightCount, avgAbsWeight: weightCount > 0 ? absSum / weightCount : 0 };
}

/** Deep-copy a graph object (nodes + edges). */
export function deepCopyGraph(graph) {
  return {
    nodes: graph.nodes.map(n => ({
      features: n.features.slice(),
      team: n.team,
      attackRange: n.attackRange,
    })),
    edges: graph.edges.map(e => ({
      src: e.src, dst: e.dst,
      features: e.features.slice(),
    })),
    numNodes: graph.numNodes,
  };
}

/**
 * Migrate a loaded graph network from old NODE_DIM to current NODE_DIM.
 * Extends W_embed rows with zeros for any new node feature columns.
 */
export function migrateGraphNetwork(gNet) {
  const oldDim = gNet.W_embed[0]?.length || 0;
  if (oldDim >= GRAPH_NODE_DIM) return gNet; // already current or newer
  const diff = GRAPH_NODE_DIM - oldDim;
  // Extend each row of W_embed with zeros for new features
  for (let r = 0; r < gNet.W_embed.length; r++) {
    for (let i = 0; i < diff; i++) gNet.W_embed[r].push(0);
  }
  return gNet;
}

// Re-export constants for integration
export { GRAPH_OUTPUT_DIM, GRAPH_EMBED_DIM, GRAPH_NODE_DIM, GRAPH_EDGE_DIM, GRAPH_LAYERS };
