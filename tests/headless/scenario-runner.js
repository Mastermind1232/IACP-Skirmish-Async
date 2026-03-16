/**
 * Scenario Runner
 *
 * Loads scenarios from generated-scenarios.json and runs each one
 * through the flow harness. Records per-card results: played successfully,
 * state changed, or crashed.
 *
 * Usage:
 *   node tests/headless/scenario-runner.js [--verbose] [--limit=N]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createFlowHarness } from './flow-harness.js';

async function runScenario(scenario, verbose) {
  const { ccName, scenarioType, config } = scenario;

  let fh;
  try {
    fh = createFlowHarness({
      mapId: config.mapId,
      p1Army: config.p1Army.map(n => ({ dcName: n })),
      p2Army: config.p2Army.map(n => ({ dcName: n })),
      p1CcHand: config.p1CcHand || [],
      p2CcHand: config.p2CcHand || [],
    });
  } catch (e) {
    return { ccName, scenarioType, status: 'setup-error', error: e.message };
  }

  const MAX_STEPS = 80;
  let ccPlayed = false;
  let stateChanged = false;
  let playError = null;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const game = fh.getGame();
      if (game.ended) break;

      const p1Actions = fh.getActions(1);
      const p2Actions = fh.getActions(2);
      const allActions = [
        ...p1Actions.map(a => ({ ...a, _uid: 'player1' })),
        ...p2Actions.map(a => ({ ...a, _uid: 'player2' })),
      ];

      if (allActions.length === 0) break;

      // Prefer playing the target CC
      const ccAction = allActions.find(a =>
        a.type === 'play_cc' &&
        (a.params?.cardName === ccName || a.params?.ccName === ccName)
      );

      const action = ccAction || allActions[step % allActions.length];

      const result = await fh.act(action.customId, action._uid);

      if (ccAction && action === ccAction) {
        ccPlayed = true;
        if (result.step?.stateDelta?.hasChanges) {
          stateChanged = true;
        }
        if (result.result?.error) {
          playError = result.result.error;
        }
        break; // We got what we came for
      }
    }
  } catch (e) {
    return { ccName, scenarioType, status: 'crash', error: e.message, ccPlayed };
  }

  if (!ccPlayed) {
    return { ccName, scenarioType, status: 'not-reached', error: 'CC never became playable in this scenario' };
  }

  if (playError) {
    return { ccName, scenarioType, status: 'play-error', error: playError, stateChanged };
  }

  return {
    ccName,
    scenarioType,
    status: stateChanged ? 'effect' : 'no-op',
    stateChanged,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  let scenarios;
  try {
    const scenarioPath = new URL('./generated-scenarios.json', import.meta.url);
    const data = JSON.parse(readFileSync(scenarioPath, 'utf8'));
    scenarios = data.scenarios;
  } catch (e) {
    console.error(`Could not read generated-scenarios.json: ${e.message}`);
    console.log('Run scenario generator first: node tests/headless/cc-scenario-gen.js');
    process.exit(1);
  }

  const toRun = scenarios.slice(0, limit);
  console.log(`\nScenario Runner: ${toRun.length} scenarios\n`);

  const results = { effect: 0, 'no-op': 0, 'not-reached': 0, 'setup-error': 0, crash: 0, 'play-error': 0 };
  const details = [];

  for (let i = 0; i < toRun.length; i++) {
    const scenario = toRun[i];
    const result = await runScenario(scenario, verbose);
    results[result.status] = (results[result.status] || 0) + 1;
    details.push(result);

    if (verbose || result.status === 'crash' || result.status === 'play-error') {
      console.log(`  [${i + 1}/${toRun.length}] ${result.ccName}: ${result.status}${result.error ? ` — ${result.error}` : ''}`);
    }

    // Progress
    if (!verbose && (i + 1) % Math.max(1, Math.floor(toRun.length / 10)) === 0) {
      const pct = Math.round(((i + 1) / toRun.length) * 100);
      process.stdout.write(`   ${pct}% (${i + 1}/${toRun.length})\r`);
    }
  }

  // Report
  console.log(`\n${'─'.repeat(50)}`);
  console.log('SCENARIO RESULTS');
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Effect (state changed):  ${results.effect}`);
  console.log(`  No-op (played, no change): ${results['no-op']}`);
  console.log(`  Not reached (CC not playable): ${results['not-reached']}`);
  console.log(`  Setup error:             ${results['setup-error']}`);
  console.log(`  Crash:                   ${results.crash}`);
  console.log(`  Play error:              ${results['play-error']}`);

  // Write results
  const outputPath = new URL('./scenario-results.json', import.meta.url);
  const output = {
    timestamp: new Date().toISOString(),
    totalRun: toRun.length,
    summary: results,
    details,
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n  Results → scenario-results.json\n`);

  // List crashes and play errors
  const crashes = details.filter(d => d.status === 'crash');
  const playErrors = details.filter(d => d.status === 'play-error');
  if (crashes.length > 0) {
    console.log(`Crashes (${crashes.length}):`);
    for (const c of crashes) {
      console.log(`  ${c.ccName}: ${c.error}`);
    }
  }
  if (playErrors.length > 0) {
    console.log(`Play errors (${playErrors.length}):`);
    for (const pe of playErrors) {
      console.log(`  ${pe.ccName}: ${pe.error}`);
    }
  }
}

main().catch(e => {
  console.error('Scenario runner crashed:', e);
  process.exit(2);
});
