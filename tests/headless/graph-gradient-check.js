/**
 * Graph encoder gradient verification — finite-difference vs analytical backprop.
 * Answers: is the hand-rolled graph backprop basically correct?
 *
 * Usage: node tests/headless/graph-gradient-check.js
 */
import {
  initGraphNetwork, graphForwardPass, graphBackpropUpdate,
  deepCopyGraphNetwork, GRAPH_OUTPUT_DIM, GRAPH_EMBED_DIM,
  GRAPH_NODE_DIM, GRAPH_EDGE_DIM, GRAPH_LAYERS,
} from './graph-encoder.js';

const NUM_ACTIONS = 5; // small for fast checking
const EPS = 1e-5;      // finite-difference step
const TOL = 1e-4;      // relative tolerance for pass/fail

// ── Synthetic graph: 3 nodes, fully connected ─────────────────────────────────

function makeTinyGraph() {
  const nodes = [
    { features: [1.0, 0.8, 0.5, 0.6, 0.3, 1.0, 0.0, 1.0, 0.2], team: 1, attackRange: 3 },
    { features: [-1.0, 0.5, 0.4, 0.3, 0.1, 0.0, 0.0, 1.0, 0.6], team: -1, attackRange: 1 },
    { features: [1.0, 1.0, 0.6, 0.7, 0.25, 0.0, 1.0, 1.0, 0.4], team: 1, attackRange: 5 },
  ];
  const edges = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      edges.push({ src: i, dst: j, features: [0.3 + 0.1 * i, i === 0 ? 1.0 : 0.0, nodes[i].team === nodes[j].team ? 1.0 : 0.0] });
    }
  }
  return { nodes, edges, numNodes: 3 };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getQ(gNet, graph, actionIdx) {
  const { Q } = graphForwardPass(gNet, graph);
  return Q[actionIdx];
}

/**
 * Extract analytical gradient by running backprop with delta=1, alpha=1, weightDecay=0.
 * Returns a map: paramPath → gradient value.
 */
function getAnalyticalGradients(gNet, graph, actionIdx) {
  const original = deepCopyGraphNetwork(gNet);
  const copy = deepCopyGraphNetwork(gNet);
  const { cache } = graphForwardPass(copy, graph);

  // delta=1 means dL/dQ[actionIdx] = 1
  graphBackpropUpdate(copy, cache, actionIdx, 1.0, 1.0, 0.0);

  const grads = {};

  // Extract gradients = (new - old) for each parameter
  for (let d = 0; d < copy.W_embed.length; d++) {
    for (let f = 0; f < copy.W_embed[d].length; f++) {
      grads[`W_embed[${d}][${f}]`] = copy.W_embed[d][f] - original.W_embed[d][f];
    }
  }
  for (let d = 0; d < copy.b_embed.length; d++) {
    grads[`b_embed[${d}]`] = copy.b_embed[d] - original.b_embed[d];
  }
  for (let l = 0; l < GRAPH_LAYERS; l++) {
    for (let d = 0; d < copy.layers[l].W_up.length; d++) {
      for (let c = 0; c < copy.layers[l].W_up[d].length; c++) {
        grads[`layers[${l}].W_up[${d}][${c}]`] = copy.layers[l].W_up[d][c] - original.layers[l].W_up[d][c];
      }
    }
    for (let d = 0; d < copy.layers[l].b_up.length; d++) {
      grads[`layers[${l}].b_up[${d}]`] = copy.layers[l].b_up[d] - original.layers[l].b_up[d];
    }
  }
  for (let d = 0; d < copy.W_read.length; d++) {
    for (let e = 0; e < copy.W_read[d].length; e++) {
      grads[`W_read[${d}][${e}]`] = copy.W_read[d][e] - original.W_read[d][e];
    }
  }
  for (let d = 0; d < copy.b_read.length; d++) {
    grads[`b_read[${d}]`] = copy.b_read[d] - original.b_read[d];
  }
  for (let j = 0; j < copy.W1.length; j++) {
    for (let i = 0; i < copy.W1[j].length; i++) {
      grads[`W1[${j}][${i}]`] = copy.W1[j][i] - original.W1[j][i];
    }
  }
  for (let j = 0; j < copy.b1.length; j++) {
    grads[`b1[${j}]`] = copy.b1[j] - original.b1[j];
  }
  for (let j = 0; j < copy.Wv.length; j++) {
    grads[`Wv[${j}]`] = copy.Wv[j] - original.Wv[j];
  }
  grads['bv'] = copy.bv - original.bv;
  for (let k = 0; k < copy.Wa.length; k++) {
    for (let j = 0; j < copy.Wa[k].length; j++) {
      grads[`Wa[${k}][${j}]`] = copy.Wa[k][j] - original.Wa[k][j];
    }
  }
  for (let k = 0; k < copy.ba.length; k++) {
    grads[`ba[${k}]`] = copy.ba[k] - original.ba[k];
  }

  return grads;
}

/**
 * Compute numerical gradient for a specific parameter using central differences.
 * @param {Function} getParam - returns current parameter value
 * @param {Function} setParam - sets parameter value
 */
function numericalGradient(gNet, graph, actionIdx, getParam, setParam) {
  const original = getParam();

  setParam(original + EPS);
  const qPlus = getQ(gNet, graph, actionIdx);

  setParam(original - EPS);
  const qMinus = getQ(gNet, graph, actionIdx);

  setParam(original); // restore
  return (qPlus - qMinus) / (2 * EPS);
}

// ── Main gradient check ─────────────────────────────────────────────────────

function runGradientCheck() {
  const gNet = initGraphNetwork(NUM_ACTIONS);
  const graph = makeTinyGraph();
  const actionIdx = 2;

  // Get analytical gradients
  const analytical = getAnalyticalGradients(gNet, graph, actionIdx);

  // Spot-check numerical gradients for each parameter group
  const paramSpecs = [];

  // W_embed: check a few representative entries
  for (const [d, f] of [[0, 0], [3, 2], [7, 5], [15, 8]]) {
    if (d < gNet.W_embed.length && f < gNet.W_embed[0].length) {
      paramSpecs.push({
        name: `W_embed[${d}][${f}]`,
        get: () => gNet.W_embed[d][f],
        set: (v) => { gNet.W_embed[d][f] = v; },
      });
    }
  }
  // b_embed
  for (const d of [0, 7, 15]) {
    paramSpecs.push({
      name: `b_embed[${d}]`,
      get: () => gNet.b_embed[d],
      set: (v) => { gNet.b_embed[d] = v; },
    });
  }
  // layers[l].W_up and b_up
  for (let l = 0; l < GRAPH_LAYERS; l++) {
    for (const [d, c] of [[0, 0], [5, 10], [10, 20], [15, 34]]) {
      if (d < gNet.layers[l].W_up.length && c < gNet.layers[l].W_up[0].length) {
        paramSpecs.push({
          name: `layers[${l}].W_up[${d}][${c}]`,
          get: () => gNet.layers[l].W_up[d][c],
          set: (v) => { gNet.layers[l].W_up[d][c] = v; },
        });
      }
    }
    for (const d of [0, 8, 15]) {
      paramSpecs.push({
        name: `layers[${l}].b_up[${d}]`,
        get: () => gNet.layers[l].b_up[d],
        set: (v) => { gNet.layers[l].b_up[d] = v; },
      });
    }
  }
  // W_read
  for (const [d, e] of [[0, 0], [10, 5], [20, 10], [31, 15]]) {
    if (d < gNet.W_read.length && e < gNet.W_read[0].length) {
      paramSpecs.push({
        name: `W_read[${d}][${e}]`,
        get: () => gNet.W_read[d][e],
        set: (v) => { gNet.W_read[d][e] = v; },
      });
    }
  }
  // b_read
  for (const d of [0, 15, 31]) {
    paramSpecs.push({
      name: `b_read[${d}]`,
      get: () => gNet.b_read[d],
      set: (v) => { gNet.b_read[d] = v; },
    });
  }
  // W1
  for (const [j, i] of [[0, 0], [20, 10], [40, 20], [63, 31]]) {
    if (j < gNet.W1.length && i < gNet.W1[0].length) {
      paramSpecs.push({
        name: `W1[${j}][${i}]`,
        get: () => gNet.W1[j][i],
        set: (v) => { gNet.W1[j][i] = v; },
      });
    }
  }
  // b1
  for (const j of [0, 32, 63]) {
    paramSpecs.push({
      name: `b1[${j}]`,
      get: () => gNet.b1[j],
      set: (v) => { gNet.b1[j] = v; },
    });
  }
  // Wv
  for (const j of [0, 32, 63]) {
    paramSpecs.push({
      name: `Wv[${j}]`,
      get: () => gNet.Wv[j],
      set: (v) => { gNet.Wv[j] = v; },
    });
  }
  // bv
  paramSpecs.push({
    name: 'bv',
    get: () => gNet.bv,
    set: (v) => { gNet.bv = v; },
  });
  // Wa
  for (const [k, j] of [[0, 0], [2, 30], [4, 63]]) {
    if (k < gNet.Wa.length && j < gNet.Wa[0].length) {
      paramSpecs.push({
        name: `Wa[${k}][${j}]`,
        get: () => gNet.Wa[k][j],
        set: (v) => { gNet.Wa[k][j] = v; },
      });
    }
  }
  // ba
  for (const k of [0, 2, 4]) {
    paramSpecs.push({
      name: `ba[${k}]`,
      get: () => gNet.ba[k],
      set: (v) => { gNet.ba[k] = v; },
    });
  }

  // Run checks
  console.log('=== Graph Encoder Gradient Verification ===');
  console.log(`Graph: ${graph.numNodes} nodes, ${graph.edges.length} edges`);
  console.log(`Network: ${NUM_ACTIONS} actions, EPS=${EPS}, TOL=${TOL}`);
  console.log(`Action index: ${actionIdx}\n`);

  const results = { pass: 0, fail: 0, skip: 0, details: [] };

  for (const spec of paramSpecs) {
    const numGrad = numericalGradient(gNet, graph, actionIdx, spec.get, spec.set);
    const anaGrad = analytical[spec.name];

    if (anaGrad === undefined) {
      results.skip++;
      results.details.push({ name: spec.name, status: 'SKIP', reason: 'not in analytical map' });
      continue;
    }

    // Relative error with denominator guard
    const denom = Math.max(Math.abs(numGrad), Math.abs(anaGrad), 1e-8);
    const relErr = Math.abs(numGrad - anaGrad) / denom;
    const absErr = Math.abs(numGrad - anaGrad);

    // Pass if relative error < TOL or absolute error < 1e-7 (near-zero gradients)
    const pass = relErr < TOL || absErr < 1e-7;

    if (pass) {
      results.pass++;
    } else {
      results.fail++;
    }
    results.details.push({
      name: spec.name,
      status: pass ? 'PASS' : '** FAIL **',
      numerical: numGrad,
      analytical: anaGrad,
      relErr: relErr,
      absErr: absErr,
    });
  }

  // Print results by component group
  const groups = {};
  for (const d of results.details) {
    const group = d.name.replace(/\[\d+\](\[\d+\])?$/, '');
    if (!groups[group]) groups[group] = [];
    groups[group].push(d);
  }

  for (const [group, items] of Object.entries(groups)) {
    const passes = items.filter(i => i.status === 'PASS').length;
    const fails = items.filter(i => i.status.includes('FAIL')).length;
    const groupStatus = fails === 0 ? 'PASS' : 'FAIL';
    console.log(`[${groupStatus}] ${group}: ${passes}/${items.length} passed`);

    // Show details for failures, and worst-case for passes
    for (const item of items) {
      if (item.status.includes('FAIL')) {
        console.log(`       ${item.name}: numerical=${item.numerical?.toExponential(4)}, analytical=${item.analytical?.toExponential(4)}, relErr=${item.relErr?.toExponential(2)}, absErr=${item.absErr?.toExponential(2)}`);
      }
    }
    // Show worst relative error among passes
    const passItems = items.filter(i => i.status === 'PASS' && i.relErr !== undefined);
    if (passItems.length > 0) {
      const worst = passItems.reduce((a, b) => (a.relErr || 0) > (b.relErr || 0) ? a : b);
      console.log(`       worst pass: ${worst.name} relErr=${worst.relErr?.toExponential(2)}`);
    }
  }

  console.log(`\n=== SUMMARY: ${results.pass} PASS, ${results.fail} FAIL, ${results.skip} SKIP ===`);

  if (results.fail > 0) {
    console.log('\n=== FAILED PARAMETERS ===');
    for (const d of results.details) {
      if (d.status.includes('FAIL')) {
        console.log(`  ${d.name}: num=${d.numerical?.toExponential(6)}, ana=${d.analytical?.toExponential(6)}, relErr=${d.relErr?.toExponential(4)}`);
      }
    }
  }

  return results;
}

// ── Parameter update magnitude test ─────────────────────────────────────────

function runParameterUpdateTest() {
  console.log('\n\n=== Parameter Update Magnitude Test ===');

  const gNet = initGraphNetwork(NUM_ACTIONS);
  const graph = makeTinyGraph();
  const actionIdx = 2;
  const alpha = 0.001;
  const weightDecay = 0.0001;
  const delta = 0.5; // moderate TD error

  // Snapshot before
  const before = deepCopyGraphNetwork(gNet);

  // Forward + backprop
  const { cache } = graphForwardPass(gNet, graph);
  graphBackpropUpdate(gNet, cache, actionIdx, delta, alpha, weightDecay);

  // Compare
  function paramDiff(name, oldArr, newArr) {
    if (typeof oldArr === 'number') {
      const diff = Math.abs(newArr - oldArr);
      console.log(`  ${name}: |delta|=${diff.toExponential(3)}, old=${oldArr.toFixed(6)}, new=${newArr.toFixed(6)}`);
      return diff > 0;
    }
    let maxDiff = 0, sumDiff = 0, count = 0, nonzero = 0;
    const flatOld = Array.isArray(oldArr[0]) ? oldArr.flat() : oldArr;
    const flatNew = Array.isArray(newArr[0]) ? newArr.flat() : newArr;
    for (let i = 0; i < flatOld.length; i++) {
      const d = Math.abs(flatNew[i] - flatOld[i]);
      if (d > maxDiff) maxDiff = d;
      sumDiff += d;
      count++;
      if (d > 1e-15) nonzero++;
    }
    const moved = nonzero / count * 100;
    console.log(`  ${name}: max|delta|=${maxDiff.toExponential(3)}, avg|delta|=${(sumDiff/count).toExponential(3)}, moved=${moved.toFixed(1)}% (${nonzero}/${count})`);
    return nonzero > 0;
  }

  console.log(`\nWith alpha=${alpha}, weightDecay=${weightDecay}, delta=${delta}:\n`);

  paramDiff('W_embed', before.W_embed, gNet.W_embed);
  paramDiff('b_embed', before.b_embed, gNet.b_embed);
  for (let l = 0; l < GRAPH_LAYERS; l++) {
    paramDiff(`layers[${l}].W_up`, before.layers[l].W_up, gNet.layers[l].W_up);
    paramDiff(`layers[${l}].b_up`, before.layers[l].b_up, gNet.layers[l].b_up);
  }
  paramDiff('W_read', before.W_read, gNet.W_read);
  paramDiff('b_read', before.b_read, gNet.b_read);
  paramDiff('W1', before.W1, gNet.W1);
  paramDiff('b1', before.b1, gNet.b1);
  paramDiff('Wv', before.Wv, gNet.Wv);
  paramDiff('bv', before.bv, gNet.bv);
  paramDiff('Wa', before.Wa, gNet.Wa);
  paramDiff('ba', before.ba, gNet.ba);
}

// ── Multiple-step convergence test ──────────────────────────────────────────

function runConvergenceTest() {
  console.log('\n\n=== Tiny Convergence Test ===');
  console.log('Can the graph network learn to output Q[2] = 10.0 for a fixed input?\n');

  const gNet = initGraphNetwork(NUM_ACTIONS);
  const graph = makeTinyGraph();
  const actionIdx = 2;
  const targetQ = 10.0;
  const alpha = 0.005;

  for (let step = 0; step < 200; step++) {
    const { Q, cache } = graphForwardPass(gNet, graph);
    const delta = targetQ - Q[actionIdx];

    if (step % 20 === 0 || step === 199) {
      console.log(`  step ${step}: Q[${actionIdx}]=${Q[actionIdx].toFixed(4)}, target=${targetQ}, delta=${delta.toFixed(4)}, allQ=[${Q.map(q => q.toFixed(2)).join(', ')}]`);
    }

    // Clamp delta like the real training
    const clampedDelta = Math.max(-1.0, Math.min(1.0, delta));
    graphBackpropUpdate(gNet, cache, actionIdx, clampedDelta, alpha, 0.0001);
  }

  const { Q: finalQ } = graphForwardPass(gNet, graph);
  const finalDelta = Math.abs(targetQ - finalQ[actionIdx]);
  console.log(`\n  Final Q[${actionIdx}] = ${finalQ[actionIdx].toFixed(4)} (target = ${targetQ}, gap = ${finalDelta.toFixed(4)})`);
  console.log(`  ${finalDelta < 2.0 ? 'PASS' : 'FAIL'}: network ${finalDelta < 2.0 ? 'converges toward' : 'fails to converge toward'} target`);
}

// ── Run all checks ──────────────────────────────────────────────────────────

const gradResults = runGradientCheck();
runParameterUpdateTest();
runConvergenceTest();

process.exit(gradResults.fail > 0 ? 1 : 0);
