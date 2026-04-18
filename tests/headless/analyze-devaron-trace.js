#!/usr/bin/env node
/**
 * Devaron regression diagnosis — analyze diagnostic traces from control vs treatment.
 * Usage: node analyze-devaron-trace.js
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJSON(name) {
  return JSON.parse(readFileSync(join(__dirname, name), 'utf8'));
}

function pct(n, d) { return d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'N/A'; }
function avg(arr) { return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }

// Load data
const controlTrace = loadJSON('learnings-devaron-control-diag-trace.json');
const treatTrace = loadJSON('learnings-devaron-treatment-diag-trace.json');
const controlLearnings = loadJSON('learnings-devaron-control.json');
const treatLearnings = loadJSON('learnings-devaron-treatment.json');

console.log('=== DEVARON REGRESSION DIAGNOSTIC ===\n');

// 1. Basic counts
console.log(`Control disagreements: ${controlTrace.length}`);
console.log(`Treatment disagreements: ${treatTrace.length}`);

// 2. Outcome breakdown by arm
function outcomeBreakdown(trace, label) {
  const outcomes = { attack: 0, interact: 0, moveOnly: 0, endOnly: 0, null: 0 };
  for (const t of trace) outcomes[t.outcome || 'null']++;
  const total = trace.length;
  console.log(`\n${label} — disagree outcomes (N=${total}):`);
  console.log(`  attack:   ${outcomes.attack} (${pct(outcomes.attack, total)})`);
  console.log(`  interact: ${outcomes.interact} (${pct(outcomes.interact, total)})`);
  console.log(`  moveOnly: ${outcomes.moveOnly} (${pct(outcomes.moveOnly, total)})`);
  console.log(`  endOnly:  ${outcomes.endOnly} (${pct(outcomes.endOnly, total)})`);
  return outcomes;
}

const cOutcomes = outcomeBreakdown(controlTrace, 'Control (heuristic controls on disagree)');
const tOutcomes = outcomeBreakdown(treatTrace, 'Treatment (scorer controls on disagree)');

// 3. By decision class
function byClassBreakdown(trace, label) {
  const classes = {};
  for (const t of trace) {
    if (!classes[t.classKey]) classes[t.classKey] = { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 };
    classes[t.classKey].total++;
    classes[t.classKey][t.outcome || 'endOnly']++;
  }
  console.log(`\n${label} — by decision class:`);
  for (const [cls, data] of Object.entries(classes).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${cls}: ${data.total} disagrees | attack=${pct(data.attack, data.total)} interact=${pct(data.interact, data.total)} moveOnly=${pct(data.moveOnly, data.total)} endOnly=${pct(data.endOnly, data.total)}`);
  }
  return classes;
}

const cByClass = byClassBreakdown(controlTrace, 'Control');
const tByClass = byClassBreakdown(treatTrace, 'Treatment');

// 4. By round
function byRoundBreakdown(trace, label) {
  const rounds = {};
  for (const t of trace) {
    const r = t.round;
    if (!rounds[r]) rounds[r] = { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 };
    rounds[r].total++;
    rounds[r][t.outcome || 'endOnly']++;
  }
  console.log(`\n${label} — by round:`);
  for (const r of Object.keys(rounds).sort()) {
    const d = rounds[r];
    console.log(`  R${r}: ${d.total} disagrees | attack=${pct(d.attack, d.total)} interact=${pct(d.interact, d.total)} moveOnly=${pct(d.moveOnly, d.total)} endOnly=${pct(d.endOnly, d.total)}`);
  }
  return rounds;
}

const cByRound = byRoundBreakdown(controlTrace, 'Control');
const tByRound = byRoundBreakdown(treatTrace, 'Treatment');

// 5. By activation timing
function byTimingBreakdown(trace, label) {
  const buckets = { early: { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 },
                    late: { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 } };
  for (const t of trace) {
    const b = t.actBucket;
    buckets[b].total++;
    buckets[b][t.outcome || 'endOnly']++;
  }
  console.log(`\n${label} — by activation timing:`);
  for (const [b, d] of Object.entries(buckets)) {
    console.log(`  ${b}: ${d.total} disagrees | attack=${pct(d.attack, d.total)} interact=${pct(d.interact, d.total)} moveOnly=${pct(d.moveOnly, d.total)} endOnly=${pct(d.endOnly, d.total)}`);
  }
  return buckets;
}

const cByTiming = byTimingBreakdown(controlTrace, 'Control');
const tByTiming = byTimingBreakdown(treatTrace, 'Treatment');

// 6. Feature analysis: what does the scorer pick differently?
function featureAnalysis(trace, label) {
  const objDiffs = [];    // scorer minObjNorm - heuristic minObjNorm
  const enemyDiffs = [];  // scorer minEnemyNorm - heuristic minEnemyNorm
  const scorerHigherObj = { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 };
  const heurHigherObj = { total: 0, attack: 0, interact: 0, moveOnly: 0, endOnly: 0 };
  for (const t of trace) {
    const objDiff = (t.scorerObjNorm || 0) - (t.heurObjNorm || 0);
    const enemyDiff = (t.scorerEnemyNorm || 0) - (t.heurEnemyNorm || 0);
    objDiffs.push(objDiff);
    enemyDiffs.push(enemyDiff);
    const bucket = objDiff > 0.01 ? scorerHigherObj : objDiff < -0.01 ? heurHigherObj : null;
    if (bucket) {
      bucket.total++;
      bucket[t.outcome || 'endOnly']++;
    }
  }
  console.log(`\n${label} — feature analysis:`);
  console.log(`  Avg minObjNorm diff (scorer-heur): ${avg(objDiffs).toFixed(4)}`);
  console.log(`  Avg minEnemyNorm diff (scorer-heur): ${avg(enemyDiffs).toFixed(4)}`);
  console.log(`  Scorer picks CLOSER to objective: ${scorerHigherObj.total} (attack=${scorerHigherObj.attack} interact=${scorerHigherObj.interact} move=${scorerHigherObj.moveOnly} end=${scorerHigherObj.endOnly})`);
  console.log(`  Heuristic picks CLOSER to objective: ${heurHigherObj.total} (attack=${heurHigherObj.attack} interact=${heurHigherObj.interact} move=${heurHigherObj.moveOnly} end=${heurHigherObj.endOnly})`);
}

featureAnalysis(controlTrace, 'Control');
featureAnalysis(treatTrace, 'Treatment');

// 7. DC swap frequency — which DCs are involved in disagreements?
function dcSwapAnalysis(trace, label) {
  const swaps = {};
  for (const t of trace) {
    const key = `${t.heurPick} → ${t.scorerPick}`;
    if (!swaps[key]) swaps[key] = { count: 0, outcomes: { attack: 0, interact: 0, moveOnly: 0, endOnly: 0 } };
    swaps[key].count++;
    swaps[key].outcomes[t.outcome || 'endOnly']++;
  }
  const sorted = Object.entries(swaps).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  console.log(`\n${label} — top DC swaps (heur→scorer):`);
  for (const [swap, data] of sorted) {
    const o = data.outcomes;
    console.log(`  ${swap}: ${data.count}x | atk=${o.attack} int=${o.interact} move=${o.moveOnly} end=${o.endOnly}`);
  }
}

dcSwapAnalysis(controlTrace, 'Control');
dcSwapAnalysis(treatTrace, 'Treatment');

// 8. Late-round (R3+R4) interact comparison — critical for Devaron crate control
console.log('\n=== LATE-ROUND INTERACT ANALYSIS (R3+R4) ===');
function lateRoundInteracts(trace, label) {
  const late = trace.filter(t => t.round >= 3);
  const interacts = late.filter(t => t.outcome === 'interact').length;
  const attacks = late.filter(t => t.outcome === 'attack').length;
  const total = late.length;
  console.log(`${label} late-round disagrees: ${total} | interact=${pct(interacts, total)} attack=${pct(attacks, total)}`);
  return { total, interacts, attacks };
}
lateRoundInteracts(controlTrace, 'Control');
lateRoundInteracts(treatTrace, 'Treatment');

// 9. Score margin analysis — how confident is the scorer when it disagrees?
function scoreMarginAnalysis(trace, label) {
  const margins = trace.map(t => (t.scorerScore || 0) - (t.heurScore || 0));
  const sorted = [...margins].sort((a, b) => a - b);
  console.log(`\n${label} — scorer score margin (scorer-heur):`);
  console.log(`  Mean: ${avg(margins).toFixed(4)}`);
  console.log(`  Median: ${sorted[Math.floor(sorted.length / 2)]?.toFixed(4)}`);
  console.log(`  P10: ${sorted[Math.floor(sorted.length * 0.1)]?.toFixed(4)}`);
  console.log(`  P90: ${sorted[Math.floor(sorted.length * 0.9)]?.toFixed(4)}`);
  // Outcomes by margin bucket
  const lowMargin = trace.filter(t => (t.scorerScore - t.heurScore) < 0.1);
  const highMargin = trace.filter(t => (t.scorerScore - t.heurScore) >= 0.1);
  const lowInteract = lowMargin.filter(t => t.outcome === 'interact').length;
  const highInteract = highMargin.filter(t => t.outcome === 'interact').length;
  console.log(`  Low-margin (<0.1): ${lowMargin.length} disagrees, interact=${pct(lowInteract, lowMargin.length)}`);
  console.log(`  High-margin (>=0.1): ${highMargin.length} disagrees, interact=${pct(highInteract, highMargin.length)}`);
}
scoreMarginAnalysis(controlTrace, 'Control');
scoreMarginAnalysis(treatTrace, 'Treatment');

console.log('\n=== END DIAGNOSTIC ===');
