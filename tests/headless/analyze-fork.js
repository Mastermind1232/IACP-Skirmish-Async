#!/usr/bin/env node
/**
 * Fork-test analyzer. Reads two training-history tails (control + MC) and
 * prints the metrics the fork report needs. Both inputs must have
 * trainingHistory entries from the SAME starting checkpoint — this script
 * only looks at the slice appended after `startGames`.
 *
 * Usage:
 *   node analyze-fork.js <start-json> <control-json> <mc-json>
 */
import { readFileSync } from 'node:fs';

const [startP, controlP, mcP] = process.argv.slice(2);
if (!startP || !controlP || !mcP) {
  console.error('usage: analyze-fork.js <start-json> <control-json> <mc-json>');
  process.exit(1);
}

const start = JSON.parse(readFileSync(startP, 'utf-8'));
const startGames = start.meta.totalGames;
const startHistLen = start.meta.trainingHistory?.length || 0;

function tail(path) {
  const f = JSON.parse(readFileSync(path, 'utf-8'));
  const hist = f.meta.trainingHistory || [];
  // Entries appended after the starting checkpoint. The ring buffer trims
  // from the front at 200, so we can't rely on index — filter by totalGames.
  const appended = hist.filter(e => e.totalGames > startGames);
  return { f, hist, appended };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function avgVpOverGames(appended, games) {
  // Take the most recent N games by walking backward through appended entries
  // and accumulating until entry.total sums to >= games.
  let totalVp = 0, totalG = 0;
  for (let i = appended.length - 1; i >= 0 && totalG < games; i--) {
    const e = appended[i];
    const vp = e.avgVP || 0;
    const g  = e.total || 0;
    totalVp += vp * g;
    totalG += g;
  }
  return totalG > 0 ? totalVp / totalG : 0;
}

function halfSplit(appended) {
  const total = appended.reduce((s, e) => s + (e.total || 0), 0);
  const half = total / 2;
  let cum = 0;
  let cut = 0;
  for (let i = 0; i < appended.length; i++) {
    cum += appended[i].total || 0;
    if (cum >= half) { cut = i + 1; break; }
  }
  const first = appended.slice(0, cut);
  const second = appended.slice(cut);
  const firstVp = first.reduce((s, e) => s + (e.avgVP || 0) * (e.total || 0), 0) / first.reduce((s, e) => s + (e.total || 0), 0);
  const secondVp = second.reduce((s, e) => s + (e.avgVP || 0) * (e.total || 0), 0) / second.reduce((s, e) => s + (e.total || 0), 0);
  return { firstVp, secondVp, delta: secondVp - firstVp };
}

function decisionClassTail(appended, lastK = 5) {
  const recent = appended.slice(-lastK);
  const agg = {
    calls: 0, mandatoryFlow: 0, epsilonExplore: 0,
    plannerDominated: 0, dqnArgmax: 0, heuristicFallback: 0,
    wgResolved: { attack: 0, move: 0, cc: 0, activate: 0, surge: 0, ability: 0, other: 0 },
  };
  for (const e of recent) {
    const dc = e.decisionClass;
    if (!dc) continue;
    for (const k of ['calls','mandatoryFlow','epsilonExplore','plannerDominated','dqnArgmax','heuristicFallback']) {
      agg[k] += dc[k] || 0;
    }
    for (const k of Object.keys(agg.wgResolved)) {
      agg.wgResolved[k] += dc.wgResolved?.[k] || 0;
    }
  }
  return agg;
}

function pct(x, total) { return total > 0 ? (100 * x / total).toFixed(1) + '%' : '  -  '; }

function report(label, path) {
  const { f, hist, appended } = tail(path);
  console.log(`\n═══ ${label}  (${path})  ═══`);
  console.log(`  totalGames: ${f.meta.totalGames}   appended entries: ${appended.length}`);
  if (appended.length === 0) {
    console.log('  (no new entries — starting checkpoint must match)');
    return null;
  }
  const last250 = avgVpOverGames(appended, 250);
  const last500 = avgVpOverGames(appended, 500);
  const allVp = avgVpOverGames(appended, Infinity);
  const split = halfSplit(appended);
  const tailEpsilons = appended.slice(-3).map(e => (e.epsilon || 0).toFixed(3)).join(' ');
  const tailAbsDelta = appended.slice(-5).map(e => (e.avgAbsDelta || 0).toFixed(4));
  const dc = decisionClassTail(appended);
  const totalDC = dc.mandatoryFlow + dc.epsilonExplore + dc.plannerDominated + dc.dqnArgmax + dc.heuristicFallback;
  const totalWg = Object.values(dc.wgResolved).reduce((s, v) => s + v, 0);
  console.log(`  avgVP:  final-250=${last250.toFixed(2)}   final-500=${last500.toFixed(2)}   all=${allVp.toFixed(2)}`);
  console.log(`  half-split: first=${split.firstVp.toFixed(2)}  second=${split.secondVp.toFixed(2)}  delta=${split.delta >= 0 ? '+' : ''}${split.delta.toFixed(2)}`);
  console.log(`  tail avgAbsDelta: [${tailAbsDelta.join(', ')}]`);
  console.log(`  tail epsilons: ${tailEpsilons}`);
  console.log(`  decisionClass (last 5 checkpoints, ${dc.calls} calls):`);
  console.log(`    mandatoryFlow:    ${String(dc.mandatoryFlow).padStart(6)}  ${pct(dc.mandatoryFlow, totalDC)}`);
  console.log(`    epsilonExplore:   ${String(dc.epsilonExplore).padStart(6)}  ${pct(dc.epsilonExplore, totalDC)}`);
  console.log(`    plannerDominated: ${String(dc.plannerDominated).padStart(6)}  ${pct(dc.plannerDominated, totalDC)}`);
  console.log(`    dqnArgmax:        ${String(dc.dqnArgmax).padStart(6)}  ${pct(dc.dqnArgmax, totalDC)}`);
  console.log(`    heuristicFallback:${String(dc.heuristicFallback).padStart(6)}  ${pct(dc.heuristicFallback, totalDC)}`);
  console.log(`  wgResolved:`);
  for (const [k, v] of Object.entries(dc.wgResolved)) {
    console.log(`    ${k.padEnd(10)} ${String(v).padStart(6)}  ${pct(v, totalWg)}`);
  }
  return { last250, last500, allVp, split, dc, totalDC };
}

console.log(`══════════════════════════════════════════════════════`);
console.log(`  Starting checkpoint: ${startP}`);
console.log(`  Starting totalGames: ${startGames}   history entries: ${startHistLen}`);
console.log(`══════════════════════════════════════════════════════`);
const ctrl = report('CONTROL', controlP);
const mc = report('MC ARM', mcP);

if (ctrl && mc) {
  console.log(`\n═══ DIFF (MC − CONTROL) ═══`);
  console.log(`  final-250 avgVP: ${(mc.last250 - ctrl.last250).toFixed(2)}   (control ${ctrl.last250.toFixed(2)}, mc ${mc.last250.toFixed(2)})`);
  console.log(`  final-500 avgVP: ${(mc.last500 - ctrl.last500).toFixed(2)}   (control ${ctrl.last500.toFixed(2)}, mc ${mc.last500.toFixed(2)})`);
  console.log(`  half-split Δ:    mc ${mc.split.delta >= 0 ? '+' : ''}${mc.split.delta.toFixed(2)}  ctrl ${ctrl.split.delta >= 0 ? '+' : ''}${ctrl.split.delta.toFixed(2)}`);
  // Decision rule
  console.log(`\n═══ DECISION-RULE THRESHOLDS ═══`);
  if (mc.last250 >= 56 && ctrl.last250 <= 54) {
    console.log('  → CREDIT-ASSIGNMENT CEILING (MC ≥ 56 and control ≤ 54)');
  } else if (mc.last250 >= 56 && ctrl.last250 >= 56) {
    console.log('  → PLATEAU CALL PREMATURE (both ≥ 56)');
  } else if (mc.last250 <= 54 && ctrl.last250 <= 54) {
    console.log('  → REPRESENTATION/CAPACITY CEILING (both ≤ 54)');
  } else {
    console.log(`  → GRAY-ZONE / INCONCLUSIVE (control ${ctrl.last250.toFixed(2)}, mc ${mc.last250.toFixed(2)})`);
  }
}
