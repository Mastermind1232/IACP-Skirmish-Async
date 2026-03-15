/**
 * Discord Flow Sim Farm
 *
 * Runs many randomized virtual Discord-flow simulations with varied armies,
 * maps, CC hands, and action policies. Checks all GS/DS invariants every step.
 * Reports failures with reproducible seeds.
 *
 * Usage:
 *   node tests/headless/sim-farm.js [count] [--seed=N] [--verbose] [--stop-on-fail]
 *
 * Examples:
 *   node tests/headless/sim-farm.js 100
 *   node tests/headless/sim-farm.js 1000 --seed=42
 *   node tests/headless/sim-farm.js 50 --verbose
 *   node tests/headless/sim-farm.js 500 --stop-on-fail
 */

import { createFlowHarness } from './flow-harness.js';
import { runSetupSim } from './setup-harness.js';
import { getDcEffects, getDcStats, getMapRegistry, getMapSpaces, getCcEffectsData, getDeploymentZones } from '../../src/data-loader.js';

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Data Pool ───────────────────────────────────────────────────────────────

function buildDataPools() {
  const dcEffects = getDcEffects();
  const deployable = [];
  for (const name of Object.keys(dcEffects)) {
    if (name.startsWith('[')) continue; // Skip skirmish upgrades
    const stats = getDcStats(name);
    if (stats && stats.health > 0 && stats.cost > 0 && stats.attack) {
      deployable.push({ name, cost: stats.cost, health: stats.health, figures: stats.figures || 1 });
    }
  }

  const maps = getMapRegistry();
  const zones = getDeploymentZones();
  const usableMaps = [];
  for (const m of maps) {
    try {
      const spaces = getMapSpaces(m.id);
      if (!spaces || Object.keys(spaces).length === 0) continue;
      // For setup sims, require both red and blue deployment zones
      const z = zones[m.id];
      if (!z?.red?.length || !z?.blue?.length) continue;
      usableMaps.push(m.id);
    } catch { /* skip maps without spaces data */ }
  }

  const ccData = getCcEffectsData();
  const ccNames = Object.keys(ccData.cards || {});

  return { deployable, usableMaps, ccNames };
}

// ── Random Army Builder ─────────────────────────────────────────────────────

function randomArmy(rng, deployable, maxCost = 20) {
  const shuffled = deployable.slice().sort(() => rng() - 0.5);
  const army = [];
  let cost = 0;
  for (const dc of shuffled) {
    if (cost + dc.cost <= maxCost) {
      army.push({ dcName: dc.name });
      cost += dc.cost;
    }
    if (army.length >= 3) break; // Cap at 3 DCs for bounded runtime
  }
  // Ensure at least 1 DC
  if (army.length === 0 && shuffled.length > 0) {
    army.push({ dcName: shuffled[0].name });
  }
  return army;
}

function randomCcHand(rng, ccNames, count = 2) {
  const shuffled = ccNames.slice().sort(() => rng() - 0.5);
  return shuffled.slice(0, count);
}

// ── Action Policies ─────────────────────────────────────────────────────────

const POLICIES = ['round-robin', 'aggressive', 'random', 'cc-eager'];

function pickAction(policy, rng, p1Actions, p2Actions, stepNum) {
  const all = [
    ...p1Actions.map(a => ({ ...a, _uid: 'player1' })),
    ...p2Actions.map(a => ({ ...a, _uid: 'player2' })),
  ];
  if (all.length === 0) return null;

  switch (policy) {
    case 'aggressive': {
      // Prefer attack/combat actions, then activate, then anything
      const priority = ['attack_target', 'combat_roll', 'combat_ready', 'combat_skip_surges',
        'combat_resolve', 'combat_surge', 'activate_dc', 'celebration_pass',
        'negation_let_resolve', 'dc_end_activation'];
      for (const type of priority) {
        const match = all.find(a => a.type === type);
        if (match) return match;
      }
      return all[Math.floor(rng() * all.length)];
    }
    case 'cc-eager': {
      // Prefer playing command cards
      const ccAction = all.find(a => a.type === 'play_cc');
      if (ccAction) return ccAction;
      // Then prefer celebration_play over pass (to exercise CC paths)
      const celPlay = all.find(a => a.type === 'celebration_play');
      if (celPlay) return celPlay;
      return all[Math.floor(rng() * all.length)];
    }
    case 'random':
      return all[Math.floor(rng() * all.length)];
    case 'round-robin':
    default:
      return all[stepNum % all.length];
  }
}

// ── Single Sim Run ──────────────────────────────────────────────────────────

async function runSim(seed, pools, opts = {}) {
  const rng = mulberry32(seed);
  const { verbose } = opts;

  const mapId = pools.usableMaps[Math.floor(rng() * pools.usableMaps.length)];
  const p1Army = randomArmy(rng, pools.deployable);
  const p2Army = randomArmy(rng, pools.deployable);
  const p1CcHand = randomCcHand(rng, pools.ccNames, Math.floor(rng() * 4)); // 0-3 cards
  const p2CcHand = randomCcHand(rng, pools.ccNames, Math.floor(rng() * 4));
  const policy = POLICIES[Math.floor(rng() * POLICIES.length)];

  const scenario = {
    seed,
    mapId,
    p1Army: p1Army.map(d => d.dcName),
    p2Army: p2Army.map(d => d.dcName),
    p1CcHand,
    p2CcHand,
    policy,
  };

  let fh;
  try {
    fh = createFlowHarness({ mapId, p1Army, p2Army, p1CcHand, p2CcHand });
  } catch (e) {
    // Some army/map combos may fail to build (e.g., no deployment zones for army size)
    return { seed, scenario, status: 'setup-error', error: e.message, violations: [], steps: 0 };
  }

  const violations = [];
  const MAX_STEPS = 150;
  let lastCustomId = null;
  let lastActionType = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const game = fh.getGame();
    if (game.ended) break;

    const p1Actions = fh.getActions(1);
    const p2Actions = fh.getActions(2);
    const action = pickAction(policy, rng, p1Actions, p2Actions, step);

    if (!action) {
      violations.push({
        step,
        invariant: 'SIM-DEADEND',
        message: `No actions available at step ${step}`,
        lastCustomId,
        lastActionType,
      });
      break;
    }

    lastCustomId = action.customId;
    lastActionType = action.type;

    try {
      const result = await fh.act(action.customId, action._uid);
      for (const err of result.invariantErrors) {
        violations.push({
          step,
          invariant: err.split(':')[0],
          message: err,
          customId: action.customId,
          actionType: action.type,
          actingPlayer: action._uid,
        });
      }
      if (result.result.error) {
        // Handler errors are not invariant violations but worth tracking
        if (verbose) {
          console.log(`  [seed=${seed} step=${step}] handler error: ${result.result.error}`);
        }
      }
    } catch (e) {
      violations.push({
        step,
        invariant: 'SIM-CRASH',
        message: `Crash at step ${step}: ${e.message}`,
        customId: action.customId,
        actionType: action.type,
      });
      break;
    }
  }

  const status = violations.length > 0 ? 'failed' : 'passed';
  return {
    seed,
    scenario,
    status,
    violations,
    steps: fh.getStepLog().length,
    ended: fh.getGame()?.ended || false,
  };
}

// ── Setup Sim Run ────────────────────────────────────────────────────────────

async function runSetupSimFromSeed(seed, pools, opts = {}) {
  const rng = mulberry32(seed);
  const { verbose } = opts;

  const mapId = pools.usableMaps[Math.floor(rng() * pools.usableMaps.length)];
  const p1Army = randomArmy(rng, pools.deployable);
  const p2Army = randomArmy(rng, pools.deployable);
  // Build CC decks (6-10 cards each for realistic draw)
  const ccCount = 6 + Math.floor(rng() * 5);
  const p1CcDeck = randomCcHand(rng, pools.ccNames, ccCount);
  const p2CcDeck = randomCcHand(rng, pools.ccNames, ccCount);

  const scenario = {
    seed,
    mapId,
    p1Army: p1Army.map(d => d.dcName),
    p2Army: p2Army.map(d => d.dcName),
    p1CcDeck,
    p2CcDeck,
  };

  try {
    const result = await runSetupSim({
      mapId,
      p1Army,
      p2Army,
      p1CcDeck,
      p2CcDeck,
      verbose,
    });

    const violations = [];
    for (const err of result.errors) {
      violations.push({
        step: err.step,
        invariant: 'SETUP-ERROR',
        message: `${err.customId}: ${err.error}`,
      });
    }

    if (!result.reachedRoundActive) {
      violations.push({
        step: result.steps.length,
        invariant: 'SETUP-INCOMPLETE',
        message: `Did not reach ROUND_ACTIVE — stuck at phase=${result.game?.phase} roundPhase=${result.game?.roundPhase}`,
      });
    }

    // Verify figures were actually deployed
    if (result.figureCount.p1 === 0 || result.figureCount.p2 === 0) {
      violations.push({
        step: result.steps.length,
        invariant: 'SETUP-NO-FIGURES',
        message: `Missing figures — P1: ${result.figureCount.p1}, P2: ${result.figureCount.p2}`,
      });
    }

    return {
      seed,
      scenario,
      status: violations.length > 0 ? 'failed' : 'passed',
      violations,
      steps: result.steps.length,
      ended: false,
      phases: result.phases,
      figureCount: result.figureCount,
    };
  } catch (e) {
    return {
      seed,
      scenario,
      status: 'setup-error',
      error: e.message,
      violations: [{ step: 0, invariant: 'SETUP-CRASH', message: e.message }],
      steps: 0,
    };
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const count = parseInt(args.find(a => !a.startsWith('-')) || '100', 10);
  const seedBase = parseInt((args.find(a => a.startsWith('--seed=')) || '').split('=')[1] || Date.now().toString(), 10);
  const verbose = args.includes('--verbose');
  const stopOnFail = args.includes('--stop-on-fail');
  const setupMode = args.includes('--setup');

  const modeLabel = setupMode ? 'Setup Sim Farm' : 'Discord Flow Sim Farm';
  console.log(`\n🎲 ${modeLabel}`);
  console.log(`   Sims: ${count}  Seed base: ${seedBase}${setupMode ? '  Mode: setup' : '  Policy: randomized'}`);
  console.log(`   Flags: ${verbose ? 'verbose ' : ''}${stopOnFail ? 'stop-on-fail' : ''}\n`);

  const pools = buildDataPools();
  console.log(`   Pool: ${pools.deployable.length} DCs, ${pools.usableMaps.length} maps, ${pools.ccNames.length} CCs\n`);

  const results = { passed: 0, failed: 0, setupErrors: 0, totalSteps: 0, completed: 0 };
  const failures = [];
  const invariantCounts = {};
  const startTime = Date.now();

  for (let i = 0; i < count; i++) {
    const seed = seedBase + i;
    const result = setupMode
      ? await runSetupSimFromSeed(seed, pools, { verbose })
      : await runSim(seed, pools, { verbose });

    if (result.status === 'passed') {
      results.passed++;
    } else if (result.status === 'setup-error') {
      results.setupErrors++;
      if (verbose) console.log(`  [${i + 1}/${count}] seed=${seed} SETUP-ERROR: ${result.error}`);
    } else {
      results.failed++;
      failures.push(result);
      for (const v of result.violations) {
        const key = v.invariant;
        invariantCounts[key] = (invariantCounts[key] || 0) + 1;
      }
      if (verbose || failures.length <= 5) {
        console.log(`  FAIL seed=${seed} (${result.scenario.policy}) step=${result.violations[0]?.step}`);
        console.log(`    ${result.scenario.p1Army.join(' + ')} vs ${result.scenario.p2Army.join(' + ')}`);
        console.log(`    map=${result.scenario.mapId}`);
        console.log(`    ${result.violations[0]?.message}`);
      }
      if (stopOnFail) break;
    }

    results.totalSteps += result.steps;
    if (result.ended) results.completed++;

    // Progress indicator every 10%
    if (!verbose && (i + 1) % Math.max(1, Math.floor(count / 10)) === 0) {
      const pct = Math.round(((i + 1) / count) * 100);
      process.stdout.write(`   ${pct}% (${i + 1}/${count}) — ${results.failed} failures\r`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Report ──────────────────────────────────────────────────────────────

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`RESULTS: ${count} sims in ${elapsed}s`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  Passed:       ${results.passed}`);
  console.log(`  Failed:       ${results.failed}`);
  console.log(`  Setup errors: ${results.setupErrors}`);
  console.log(`  Completed:    ${results.completed} (${Math.round((results.completed / Math.max(1, results.passed + results.failed)) * 100)}%)`);
  console.log(`  Total steps:  ${results.totalSteps}`);
  console.log(`  Avg steps:    ${Math.round(results.totalSteps / Math.max(1, count))}`);

  if (Object.keys(invariantCounts).length > 0) {
    console.log(`\nInvariant violation breakdown:`);
    const sorted = Object.entries(invariantCounts).sort((a, b) => b[1] - a[1]);
    for (const [inv, ct] of sorted) {
      console.log(`  ${inv}: ${ct}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\nFirst ${Math.min(failures.length, 10)} failures (reproduce with --seed=N):`);
    for (const f of failures.slice(0, 10)) {
      const v = f.violations[0];
      console.log(`\n  seed=${f.seed}  policy=${f.scenario.policy}  map=${f.scenario.mapId}`);
      console.log(`  P1: ${f.scenario.p1Army.join(' + ')}`);
      console.log(`  P2: ${f.scenario.p2Army.join(' + ')}`);
      if (f.scenario.p1CcHand?.length) console.log(`  P1 hand: ${f.scenario.p1CcHand.join(', ')}`);
      if (f.scenario.p2CcHand?.length) console.log(`  P2 hand: ${f.scenario.p2CcHand.join(', ')}`);
      if (f.scenario.p1CcDeck?.length) console.log(`  P1 deck: ${f.scenario.p1CcDeck.length} cards`);
      if (f.scenario.p2CcDeck?.length) console.log(`  P2 deck: ${f.scenario.p2CcDeck.length} cards`);
      console.log(`  step=${v.step}  action=${v.actionType || '?'}  customId=${v.customId || v.lastCustomId || '?'}`);
      console.log(`  ${v.message}`);
    }
  }

  console.log(`\n${'─'.repeat(60)}\n`);

  // Exit code: 0 if no invariant failures, 1 if any
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Sim farm crashed:', e);
  process.exit(2);
});
