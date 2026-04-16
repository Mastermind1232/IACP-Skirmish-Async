/**
 * Direct-Detection Census — non-mutating surfacing layer.
 *
 * Greps `src/` for the direct-detection patterns that produced the Sentry
 * Droid Elite `multi_fire` miss and the class of "this DC is detected by
 * hardcoded name" bugs surfaced in the audit. Prints a census on every run
 * and fails only if the count grows beyond the committed baseline.
 *
 * This is a "no new direct-detection debt" guard. It does not retroactively
 * fail; it prevents additional debt from slipping in unnoticed.
 *
 * Design:
 *   - Read-only. Walks `src/` for .js files (excluding *.test.js).
 *   - Tracks each pattern family separately so regressions point at a
 *     specific shape.
 *   - Prints top offenders (files with the most hits) as informational
 *     output, to guide future consolidation.
 *
 * When the count legitimately goes down (DCs migrated to
 * `specialAbilityIds` pointers), lower the corresponding baseline entry
 * and commit with a one-line note.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  DD_BASELINE as BASELINE,
  DD_BASELINE_TOTAL as BASELINE_TOTAL,
} from './_crr-baselines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'src');

// Pattern families. Each is a named regex. The total baseline is the sum
// across families on the current commit. BASELINE (per-family caps) lives in
// `_crr-baselines.js` so the status-rollup test can read it without
// re-registering this file's tests.
const PATTERNS = {
  // dcName === 'X' / dcName !== 'X' — matches `dc.dcName`, `meta.dcName`, etc.
  dcName_equality: /\bdcName\s*(?:===|!==)\s*['"]/g,
  // dcName.includes('X')
  dcName_includes: /\bdcName\s*(?:\?\.)?\s*\.\s*includes\s*\(/g,
  // dcName.startsWith('X')
  dcName_startsWith: /\bdcName\s*(?:\?\.)?\s*\.\s*startsWith\s*\(/g,
  // cardNameIncludes(x, 'Y')
  cardNameIncludes: /\bcardNameIncludes\s*\(/g,
};

// ── Walk ────────────────────────────────────────────────────────────────────
function walkJsFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkJsFiles(full, out);
    else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function countPattern(re, text) {
  const matches = text.match(re) || [];
  return matches.length;
}

// ── Measure ─────────────────────────────────────────────────────────────────
const files = walkJsFiles(srcDir);
const counts = Object.fromEntries(Object.keys(PATTERNS).map(k => [k, 0]));
const perFile = {};
for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const rel = file.slice(repoRoot.length + 1);
  const fileCounts = {};
  for (const [key, re] of Object.entries(PATTERNS)) {
    const n = countPattern(re, text);
    if (n > 0) {
      counts[key] += n;
      fileCounts[key] = n;
    }
  }
  if (Object.keys(fileCounts).length > 0) {
    perFile[rel] = { ...fileCounts, total: Object.values(fileCounts).reduce((a, b) => a + b, 0) };
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);

function logAlways() {
  console.log(`\n[DD-Census] src/ scanned: ${files.length} .js files`);
  console.log(`[DD-Census] Per-family count (baseline in parentheses):`);
  for (const key of Object.keys(PATTERNS)) {
    const cur = counts[key];
    const base = BASELINE[key] ?? '?';
    const delta = cur - (BASELINE[key] ?? 0);
    const marker = delta > 0 ? '  ⚠ +' + delta : delta < 0 ? '  ↓ ' + delta : '';
    console.log(`        ${key.padEnd(22)} ${String(cur).padStart(3)}   (baseline ${base})${marker}`);
  }
  console.log(`[DD-Census] TOTAL: ${total} (baseline ${BASELINE_TOTAL})`);

  const sorted = Object.entries(perFile)
    .sort((a, b) => b[1].total - a[1].total);
  if (sorted.length > 0) {
    console.log(`\n[DD-Census] Top 10 files by direct-detection count:`);
    for (const [file, fc] of sorted.slice(0, 10)) {
      const parts = Object.entries(fc)
        .filter(([k]) => k !== 'total')
        .map(([k, n]) => `${k}=${n}`)
        .join(', ');
      console.log(`  ${String(fc.total).padStart(3)}  ${file}  [${parts}]`);
    }
  }
}

describe('Direct-Detection Census (non-mutating surfacing)', () => {
  it('emits census on every run (always)', () => {
    logAlways();
    assert.ok(true);
  });

  it('total direct-detection count does not exceed baseline', () => {
    assert.ok(
      total <= BASELINE_TOTAL,
      `Direct-detection total grew from baseline ${BASELINE_TOTAL} → ${total}. ` +
      `Prefer \`specialAbilityIds.includes('ability_id')\` over hardcoded DC/card names. ` +
      `If this increase is justified, bump BASELINE with a one-line note explaining why.`
    );
  });

  it('per-family counts do not exceed per-family baselines', () => {
    const violations = [];
    for (const key of Object.keys(PATTERNS)) {
      if (counts[key] > (BASELINE[key] ?? 0)) {
        violations.push(`  • ${key}: ${counts[key]} > baseline ${BASELINE[key] ?? 0}`);
      }
    }
    assert.equal(violations.length, 0,
      `Direct-detection families grew beyond baseline:\n${violations.join('\n')}`
    );
  });
});
