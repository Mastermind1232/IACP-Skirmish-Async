/**
 * CC Scenario Generator
 *
 * Reads the gap list (CCs with 0 plays from sim-farm telemetry) and
 * generates scenario configs for each, matching CCs to appropriate
 * DCs and timing windows.
 *
 * Usage:
 *   node tests/headless/cc-scenario-gen.js [--all] [--from-telemetry]
 *
 * --all:            Generate for ALL CCs (not just gaps)
 * --from-telemetry: Only generate for CCs with 0 plays in coverage-telemetry.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { getCcEffectsData } from '../../src/data-loader.js';
import { buildScenarioForCc, findMatchingDc } from './scenario-templates.js';

/**
 * Generate scenario configs for CCs that have zero plays.
 * @param {string[]} gapList - CC names with 0 plays
 * @returns {Array<{ ccName, scenarioType, config, timing, requiredDc }>}
 */
export function generateMissingScenariosFromGaps(gapList) {
  const ccData = getCcEffectsData();
  const scenarios = [];
  const skipped = [];

  for (const ccName of gapList) {
    const card = ccData.cards?.[ccName];
    if (!card) {
      skipped.push({ ccName, reason: 'not found in cc-effects.json' });
      continue;
    }

    const scenario = buildScenarioForCc(ccName, card);
    if (!scenario) {
      skipped.push({ ccName, reason: `no matching DC for playableBy=${card.playableBy}` });
      continue;
    }

    scenarios.push(scenario);
  }

  return { scenarios, skipped };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const fromTelemetry = args.includes('--from-telemetry');

  const ccData = getCcEffectsData();
  const allCcNames = Object.keys(ccData.cards || {});
  let gapList;

  if (fromTelemetry) {
    try {
      const telemetryPath = new URL('./coverage-telemetry.json', import.meta.url);
      const telemetry = JSON.parse(readFileSync(telemetryPath, 'utf8'));
      const flowData = telemetry.flow || {};
      const ccPlayed = flowData.ccPlayed || {};
      gapList = allCcNames.filter(n => !ccPlayed[n]);
      console.log(`From telemetry: ${gapList.length}/${allCcNames.length} CCs with 0 plays`);
    } catch (e) {
      console.error(`Could not read telemetry: ${e.message}`);
      console.log('Run sim-farm first: node tests/headless/sim-farm.js 100');
      process.exit(1);
    }
  } else if (all) {
    gapList = allCcNames;
    console.log(`Generating scenarios for all ${gapList.length} CCs`);
  } else {
    gapList = allCcNames;
    console.log(`Generating scenarios for all ${gapList.length} CCs (use --from-telemetry to filter)`);
  }

  const { scenarios, skipped } = generateMissingScenariosFromGaps(gapList);

  // Write output
  const outputPath = new URL('./generated-scenarios.json', import.meta.url);
  const output = {
    generated: new Date().toISOString(),
    total: scenarios.length,
    skipped: skipped.length,
    scenarios: scenarios.map(s => ({
      ccName: s.ccName,
      scenarioType: s.scenarioType,
      timing: s.timing,
      requiredDc: s.requiredDc,
      config: {
        mapId: s.config.mapId,
        p1Army: s.config.p1Army.map(d => d.dcName),
        p2Army: s.config.p2Army.map(d => d.dcName),
        p1CcHand: s.config.p1CcHand,
        p2CcHand: s.config.p2CcHand,
      },
    })),
    skippedDetails: skipped,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nGenerated ${scenarios.length} scenarios, skipped ${skipped.length}`);
  console.log(`Output: tests/headless/generated-scenarios.json`);

  // Summary by type
  const byType = {};
  for (const s of scenarios) {
    byType[s.scenarioType] = (byType[s.scenarioType] || 0) + 1;
  }
  console.log('\nBy scenario type:');
  for (const [type, ct] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${ct}`);
  }

  if (skipped.length > 0) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ${s.ccName}: ${s.reason}`);
    }
  }
}

main().catch(e => {
  console.error('Scenario gen crashed:', e);
  process.exit(2);
});
