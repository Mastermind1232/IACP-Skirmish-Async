/**
 * CRR Coverage Consistency — non-mutating surfacing layer.
 *
 * Reads `docs/crr-coverage-heat-map.json` and verifies that each
 * `direct_oracle` (and certification / runtime_invariant / unit_test) entry
 * references test files that exist and test ids that are literally present.
 *
 * Also surfaces `inferred_only` / `uncovered` entries as informational
 * output so drift is visible on every run.
 *
 * Design goals:
 *   - Optimise for signal, not noise. Always log current drift loudly.
 *   - Baseline-and-fail-on-growth: the existing drift on 2026-04-14 is
 *     accepted as legacy; only NEW drift (beyond baseline) fails the build.
 *     Update the baseline (with a one-line note) when legacy drift is fixed.
 *   - Zero gameplay side effects. Reads JSON + source files only.
 *
 * Hard-fails on:
 *   - heat-map metadata missing
 *   - unresolved-pattern count > baseline (someone added drift without a fix)
 *   - unparseable-evidence count > baseline
 *
 * Surfaces (non-blocking):
 *   - every current unresolved pattern
 *   - every current unparseable-evidence entry
 *   - every test id not literally present (range-end notation, etc.)
 *   - every inferred_only / uncovered entry
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

const heatMapPath = resolve(repoRoot, 'docs/crr-coverage-heat-map.json');
const heatMap = JSON.parse(readFileSync(heatMapPath, 'utf8'));

// ── Baselines ────────────────────────────────────────────────────────────────
// Current known drift in the 2026-04-14 heat-map snapshot. The surfacing layer
// logs every item; the build fails only if these counts GROW. Lower them (with
// a commit-message note) as legacy drift is cleaned up.
const BASELINE = {
  // Bumped 2026-05-01: CQRS/domain scaffold purged (tests/domain/ deleted).
  // Heat-map entries that referenced domain tests are now unresolved. Lower
  // again as legacy drift is cleaned up or as heat-map evidence is updated.
  unresolvedPatterns: 37,
  unparseableEvidence: 0,      // heat-map entries with zero parseable file pattern or test id
};

// Dirs where test files can live. Ordered by likelihood for bare filenames.
const SEARCH_DIRS = [
  'tests/domain/oracle',
  'tests/domain/commands',
  'tests/domain/reducer',
  'tests/domain/sagas',
  'tests/domain/projections',
  'tests/domain',
  'tests/certification',
  'tests/headless',
  'tests/engine',
  'src/game',
  'src/engine',
  'src/handlers',
];

function matchInDir(absDir, pattern) {
  if (!existsSync(absDir)) return [];
  const starIdx = pattern.indexOf('*');
  if (starIdx === -1) {
    const abs = join(absDir, pattern);
    return existsSync(abs) ? [abs] : [];
  }
  const prefix = pattern.slice(0, starIdx);
  const suffix = pattern.slice(starIdx + 1);
  try {
    return readdirSync(absDir)
      .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
      .map(f => join(absDir, f));
  } catch {
    return [];
  }
}

function resolvePattern(pattern) {
  if (pattern.includes('/')) {
    const slash = pattern.lastIndexOf('/');
    const dirPart = pattern.slice(0, slash);
    const filePart = pattern.slice(slash + 1);
    return matchInDir(resolve(repoRoot, dirPart), filePart);
  }
  const matches = [];
  for (const dir of SEARCH_DIRS) {
    matches.push(...matchInDir(resolve(repoRoot, dir), pattern));
  }
  return matches;
}

// Extract test-file patterns from evidence prose. Catches:
//   "foo.test.js", "foo-*.test.js",
//   "tests/domain/oracle/movement-*.test.js",
//   "destruct-dc-tests.js", "destruct-cc-tests.js" (Destruct convention)
function extractFilePatterns(text) {
  const re = /[A-Za-z0-9_\-/\*]+[\-.](?:tests?)\.js/g;
  return [...new Set(text.match(re) || [])];
}

// Extract structured test ids: PROBE-AS-001, ORACLE-HANDLER-003,
// CERT-ATK-004, B-CTIME-014 (optional lowercase suffix like "003a").
function extractTestIds(text) {
  const re = /\b[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)+-\d{2,4}[a-z]?\b/g;
  return [...new Set(text.match(re) || [])];
}

const FAILING_TYPES = new Set(['direct_oracle', 'certification', 'runtime_invariant', 'unit_test']);
const INFO_ONLY_TYPES = new Set(['inferred_only', 'uncovered']);

const unresolvedPatterns = [];
const unparseableEvidence = [];
const idWarnings = [];
const infoEntries = [];

for (const entry of heatMap.coverage || []) {
  const id = `${entry.domain} ${entry.subdomain}`;
  const ct = entry.current_coverage_type;

  if (INFO_ONLY_TYPES.has(ct)) {
    infoEntries.push({ id, type: ct, notes: entry.notes || '' });
    continue;
  }
  if (!FAILING_TYPES.has(ct)) continue; // skip headless_selfplay etc.

  const evidence = entry.evidence || '';
  const patterns = extractFilePatterns(evidence);
  const testIds = extractTestIds(evidence);

  if (patterns.length === 0 && testIds.length === 0) {
    unparseableEvidence.push({ id, evidence: evidence.slice(0, 140) });
    continue;
  }

  const resolvedFiles = new Set();
  for (const pat of patterns) {
    const matches = resolvePattern(pat);
    if (matches.length === 0) {
      unresolvedPatterns.push({ id, pattern: pat });
    } else {
      for (const m of matches) resolvedFiles.add(m);
    }
  }

  if (testIds.length > 0 && resolvedFiles.size > 0) {
    const combinedText = [...resolvedFiles].map(f => {
      try { return readFileSync(f, 'utf8'); } catch { return ''; }
    }).join('\n');

    for (const tid of testIds) {
      if (!combinedText.includes(tid)) {
        idWarnings.push({ id, testId: tid });
      }
    }
  }
}

// ── Always-surface summary ──────────────────────────────────────────────────
function logAlways() {
  console.log(`\n[CRR] Heat-map snapshot: v${heatMap.metadata?.version} (${heatMap.metadata?.date})`);
  console.log(`[CRR] Coverage entries: ${heatMap.coverage?.length ?? 0}`);
  console.log(`[CRR] Current drift counts (baselines in parentheses):`);
  console.log(`        unresolved patterns:   ${unresolvedPatterns.length} (${BASELINE.unresolvedPatterns})`);
  console.log(`        unparseable evidence:  ${unparseableEvidence.length} (${BASELINE.unparseableEvidence})`);
  console.log(`        test-id warnings:      ${idWarnings.length} (informational)`);
  console.log(`        inferred_only/uncovered: ${infoEntries.length} (informational)`);

  if (unresolvedPatterns.length > 0) {
    console.log(`\n[CRR] Unresolved file patterns (evidence claims these tests exist):`);
    for (const u of unresolvedPatterns) {
      console.log(`  • [${u.id}] "${u.pattern}"`);
    }
  }
  if (unparseableEvidence.length > 0) {
    console.log(`\n[CRR] Unparseable evidence:`);
    for (const u of unparseableEvidence) {
      console.log(`  • [${u.id}] "${u.evidence}"`);
    }
  }
  if (idWarnings.length > 0) {
    const preview = idWarnings.slice(0, 12);
    console.log(`\n[CRR] Test-id warnings (${idWarnings.length}, often range-end notation like PROBE-AS-010):`);
    for (const w of preview) console.log(`  • [${w.id}] "${w.testId}"`);
    if (idWarnings.length > 12) console.log(`  … and ${idWarnings.length - 12} more`);
  }
  if (infoEntries.length > 0) {
    console.log(`\n[CRR] inferred_only / uncovered entries:`);
    for (const e of infoEntries) {
      console.log(`  • [${e.type}] ${e.id}`);
    }
  }
}

describe('CRR heat-map consistency (non-mutating surfacing)', () => {
  it('heat-map has version + date metadata', () => {
    assert.ok(heatMap.metadata?.version, 'heat map must have metadata.version');
    assert.ok(heatMap.metadata?.date, 'heat map must have metadata.date');
  });

  it('emits current drift summary (always)', () => {
    logAlways();
    assert.ok(true);
  });

  it('unresolved-pattern count does not grow beyond baseline', () => {
    assert.ok(
      unresolvedPatterns.length <= BASELINE.unresolvedPatterns,
      `Unresolved file patterns in heat-map grew from baseline ${BASELINE.unresolvedPatterns} → ${unresolvedPatterns.length}. ` +
      `Either add the missing test(s), update the heat-map evidence field, or — only if justified — bump BASELINE.unresolvedPatterns with a note.`
    );
  });

  it('unparseable-evidence count does not grow beyond baseline', () => {
    assert.ok(
      unparseableEvidence.length <= BASELINE.unparseableEvidence,
      `Unparseable-evidence entries grew from baseline ${BASELINE.unparseableEvidence} → ${unparseableEvidence.length}. ` +
      `Every heat-map entry should cite at least one *.test.js file or a structured test id (PROBE-/ORACLE-/CERT-/B-*).`
    );
  });
});
