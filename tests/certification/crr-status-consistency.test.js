/**
 * CRR Status Rollup — non-mutating surfacing layer.
 *
 * Rolls up the state of every CRR-surfacing layer into one diffable
 * artifact at `docs/crr-status.json`. One PR-reviewable file shows
 * heat-map coverage distribution, direct-detection counts, ability-text
 * snapshot counts, round-flags bucket sizes + baselines, dep-bag
 * allowlist, and parity-scoreboard divergences.
 *
 * The individual layer tests remain authoritative. This test only
 * produces a rollup view and verifies it stays in sync.
 *
 * Behavior:
 *   - default run: build the current status object from canonical
 *     sources, read the committed `docs/crr-status.json`, fail with a
 *     named diff if they disagree.
 *   - `UPDATE_CRR_STATUS=1 npm test`: regenerate the committed file
 *     before comparing. Developer then reviews `git diff` and commits
 *     the status update alongside whatever change caused it.
 *
 * Non-mutating: reads JSON + imports constants from other test files.
 * No src/ changes, no gameplay impact.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../src/game/activation-state.js';
import { getAllRequiredDepKeys } from '../../src/context-factory.js';

import {
  BASELINE as DD_BASELINE,
  BASELINE_TOTAL as DD_BASELINE_TOTAL,
} from './direct-detection-census.test.js';
import {
  BASELINE_DUPLICATES,
  BASELINE_UNUSED,
  BASELINE_TYPE_MISMATCH,
} from './round-flags-completeness.test.js';
import { ALLOWED_OMISSIONS as DEP_BAG_ALLOWLIST } from './dep-bag-parity.test.js';
import { SCENARIOS as PARITY_SCENARIOS } from './handler-parity-reporting.test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const heatMapPath = resolve(repoRoot, 'docs/crr-coverage-heat-map.json');
const snapshotPath = resolve(repoRoot, 'docs/ability-text-snapshot.json');
const statusPath = resolve(repoRoot, 'docs/crr-status.json');

function buildHeatMapSummary() {
  const hm = JSON.parse(readFileSync(heatMapPath, 'utf8'));
  const entries = hm.coverage || [];
  const dist = {};
  for (const e of entries) {
    const t = e.current_coverage_type || 'unknown';
    dist[t] = (dist[t] || 0) + 1;
  }
  return {
    version: hm.metadata?.version ?? null,
    date: hm.metadata?.date ?? null,
    totalEntries: entries.length,
    coverageDistribution: dist,
  };
}

function buildSnapshotSummary() {
  if (!existsSync(snapshotPath)) return null;
  const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  return {
    dcCount: Object.keys(snap.dc || {}).length,
    ccCount: Object.keys(snap.cc || {}).length,
  };
}

function buildDirectDetectionSummary() {
  return {
    baselineTotal: DD_BASELINE_TOTAL,
    perFamily: { ...DD_BASELINE },
  };
}

function buildRoundFlagsSummary() {
  return {
    bucketSizes: {
      ROUND_OBJECT_FLAGS: ROUND_OBJECT_FLAGS.length,
      ROUND_NULL_FLAGS: ROUND_NULL_FLAGS.length,
      ROUND_ARRAY_FLAGS: ROUND_ARRAY_FLAGS.length,
      ROUND_FALSE_FLAGS: ROUND_FALSE_FLAGS.length,
      ROUND_DELETE_FLAGS: ROUND_DELETE_FLAGS.length,
    },
    totalUniqueKeys: new Set([
      ...ROUND_OBJECT_FLAGS, ...ROUND_NULL_FLAGS, ...ROUND_ARRAY_FLAGS,
      ...ROUND_FALSE_FLAGS, ...ROUND_DELETE_FLAGS,
    ]).size,
    baselineDuplicates: [...BASELINE_DUPLICATES].sort(),
    baselineUnused: [...BASELINE_UNUSED].sort(),
    baselineTypeMismatchCount: BASELINE_TYPE_MISMATCH.length,
  };
}

function buildDepBagSummary() {
  return {
    totalRequiredDepKeys: [...getAllRequiredDepKeys()].length,
    allowedOmissionsCount: Object.keys(DEP_BAG_ALLOWLIST).length,
    allowedOmissions: Object.keys(DEP_BAG_ALLOWLIST).sort(),
  };
}

function buildParitySummary() {
  const divergences = [];
  let agreementCount = 0;
  for (let i = 0; i < PARITY_SCENARIOS.length; i++) {
    const s = PARITY_SCENARIOS[i];
    const ho = (s.expectedHandlerOnly || []).length;
    const eo = (s.expectedEngineOnly || []).length;
    if (ho === 0 && eo === 0) {
      agreementCount++;
    } else {
      const shape = ho > 0 && eo > 0 ? 'both'
                  : ho > 0 ? 'handler_only'
                  : 'engine_only';
      divergences.push({
        scenario: i + 1,
        name: s.name,
        shape,
      });
    }
  }
  return {
    totalScenarios: PARITY_SCENARIOS.length,
    exactAgreementCount: agreementCount,
    openDivergenceCount: divergences.length,
    openDivergences: divergences,
  };
}

function buildStatus() {
  return {
    _meta: {
      purpose: 'Rollup of the CRR-surfacing layers\' current state. Individual layer tests are authoritative; this artifact is the diffable viewport.',
      regenerate: 'UPDATE_CRR_STATUS=1 npm test',
      sourceFiles: {
        heatMap: 'docs/crr-coverage-heat-map.json',
        abilityTextSnapshot: 'docs/ability-text-snapshot.json',
        directDetectionCensus: 'tests/certification/direct-detection-census.test.js',
        roundFlagsCompleteness: 'tests/certification/round-flags-completeness.test.js',
        depBagParity: 'tests/certification/dep-bag-parity.test.js',
        parityScoreboard: 'tests/certification/handler-parity-reporting.test.js',
      },
    },
    heatMap: buildHeatMapSummary(),
    abilityTextSnapshot: buildSnapshotSummary(),
    directDetectionCensus: buildDirectDetectionSummary(),
    roundFlagsCompleteness: buildRoundFlagsSummary(),
    depBagParity: buildDepBagSummary(),
    parityScoreboard: buildParitySummary(),
  };
}

const current = buildStatus();

if (process.env.UPDATE_CRR_STATUS === '1') {
  writeFileSync(statusPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`[crr-status] Regenerated ${statusPath}`);
}

describe('CRR Status Rollup (non-mutating surfacing)', () => {
  it('status file exists', () => {
    assert.ok(
      existsSync(statusPath),
      `Missing status artifact at ${statusPath}. Generate with: UPDATE_CRR_STATUS=1 npm test`
    );
  });

  let committed;
  try {
    committed = JSON.parse(readFileSync(statusPath, 'utf8'));
  } catch (err) {
    committed = null;
    it('status file parses as JSON', () => {
      assert.fail(`Status JSON could not be parsed: ${err.message}`);
    });
  }

  if (committed) {
    it('summary printed on every run', () => {
      console.log(
        `\n[crr-status] heat-map v${current.heatMap.version} (${current.heatMap.date}) · ` +
        `parity: ${current.parityScoreboard.totalScenarios} scenarios, ` +
        `${current.parityScoreboard.openDivergenceCount} open divergences · ` +
        `direct-detection baseline: ${current.directDetectionCensus.baselineTotal} · ` +
        `dep-bag allowlist: ${current.depBagParity.allowedOmissionsCount}`
      );
      assert.ok(true);
    });

    it('committed rollup matches current state', () => {
      try {
        assert.deepStrictEqual(committed, current);
      } catch (err) {
        const fields = Object.keys(current).filter(k =>
          JSON.stringify(committed[k]) !== JSON.stringify(current[k])
        );
        assert.fail(
          `docs/crr-status.json is stale. Drifted fields: ${fields.join(', ')}\n\n` +
          `To regenerate:  UPDATE_CRR_STATUS=1 npm test\n` +
          `Then review:    git diff docs/crr-status.json\n` +
          `Commit the updated status alongside whatever change caused the drift.\n\n` +
          `Diagnostic: ${err.message}`
        );
      }
    });
  }
});
