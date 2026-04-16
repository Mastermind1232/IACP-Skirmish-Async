/**
 * ROUND_*_FLAGS Completeness (Variant A) — non-mutating surfacing layer.
 *
 * Enforces three mechanical invariants on the round-scoped flag registry
 * in `src/game/activation-state.js`:
 *
 *   1. No key appears in more than one of the five ROUND_*_FLAGS sets.
 *      (Would give ambiguous reset semantics.)
 *
 *   2. Every registered key is written somewhere under `src/` (excluding
 *      activation-state.js itself and *.test.js). A registered-but-unused
 *      key is dead bookkeeping that will silently accumulate over time.
 *
 *   3. Typed buckets have at least one type-consistent write pattern
 *      somewhere in `src/`:
 *        - ROUND_ARRAY_FLAGS:  `game.X.push(` or `game.X = [`
 *        - ROUND_FALSE_FLAGS:  `game.X = true|false`
 *        - ROUND_OBJECT_FLAGS: `game.X = {` or `game.X[` or `game.X = null`
 *                              or `game.X ||=` / `??=`
 *        - ROUND_NULL_FLAGS:   same as object (null-slot holds objects/null)
 *        - ROUND_DELETE_FLAGS: no type check (transient)
 *
 * What this catches:
 *   - dead flag registrations (invariant 2)
 *   - duplicate / ambiguous registrations (invariant 1)
 *   - obvious typed-bucket / write-shape mismatches (invariant 3)
 *
 * What this does NOT catch:
 *   - whether a flag that SHOULD be round-scoped is registered at all
 *     (naming isn't uniform; see Variant B, deferred)
 *   - semantic correctness of reset timing
 *   - cross-round state leaks on non-happy paths (e.g., handler throws)
 *   - the Lie-in-Ambush bug class (that was dcName-prefix matching, a
 *     separate issue; this layer does not protect against it)
 *
 * Baseline-and-fail-on-growth: if the current repo has existing
 * violations, they are captured in BASELINE arrays and surfaced in the
 * output. New violations (beyond baseline) cause a hard fail.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../src/game/activation-state.js';
import {
  RF_BASELINE_DUPLICATES as BASELINE_DUPLICATES,
  RF_BASELINE_UNUSED as BASELINE_UNUSED,
  RF_BASELINE_TYPE_MISMATCH as BASELINE_TYPE_MISMATCH,
} from './_crr-baselines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const srcDir = resolve(repoRoot, 'src');
const activationStatePath = resolve(srcDir, 'game', 'activation-state.js');

const BUCKETS = {
  object: ROUND_OBJECT_FLAGS,
  null:   ROUND_NULL_FLAGS,
  array:  ROUND_ARRAY_FLAGS,
  false:  ROUND_FALSE_FLAGS,
  delete: ROUND_DELETE_FLAGS,
};

// BASELINE_DUPLICATES / BASELINE_UNUSED / BASELINE_TYPE_MISMATCH live in
// `_crr-baselines.js` so the status-rollup test can read them without
// re-registering this file's tests. Reason lives with the constants there.

// ── File walker ──────────────────────────────────────────────────────────────
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

// ── Invariant 1: no duplicate registration ───────────────────────────────────
function findDuplicates() {
  const seen = new Map(); // key -> bucket(s)
  for (const [bucket, keys] of Object.entries(BUCKETS)) {
    for (const k of keys) {
      if (!seen.has(k)) seen.set(k, [bucket]);
      else seen.get(k).push(bucket);
    }
  }
  const dupes = [];
  for (const [k, buckets] of seen) {
    if (buckets.length > 1) dupes.push({ key: k, buckets });
  }
  return dupes;
}

// ── Invariant 2 + 3: scan write sites ────────────────────────────────────────
//
// For each registered flag, determine:
//   - usedAnywhere: any `game.{KEY}` reference found in src/ (excluding
//     activation-state.js itself)
//   - hasArrayWrite, hasBooleanWrite, hasObjectishWrite: at least one
//     write matching the expected shape
function buildWriteIndex(allFlags) {
  // Initialise per-flag records
  const index = {};
  for (const k of allFlags) {
    index[k] = {
      usedAnywhere: false,
      hasArrayWrite: false,
      hasBooleanWrite: false,
      hasObjectishWrite: false,
    };
  }

  const files = walkJsFiles(srcDir).filter(f => f !== activationStatePath);

  // Precompile per-flag patterns once. Only flags we care about.
  const patternsByFlag = {};
  for (const k of allFlags) {
    // Escape: flag keys are identifiers; no regex metachars expected.
    patternsByFlag[k] = {
      any: new RegExp(`\\bgame\\.${k}\\b`),
      array: new RegExp(
        `\\bgame\\.${k}\\s*(?:\\.push\\s*\\(|\\.concat\\s*\\(|\\.splice\\s*\\(|=\\s*\\[)`
      ),
      boolean: new RegExp(`\\bgame\\.${k}\\s*=\\s*(?:true|false|!)`),
      objectish: new RegExp(
        // Covers: = {...}, = null, [key] =, ||=, ??=, = new Map/Set, = Object(...)
        `\\bgame\\.${k}\\s*(?:\\[|\\|\\|=|\\?\\?=|=\\s*(?:\\{|null|new\\s+(?:Map|Set)\\b))`
      ),
    };
  }

  for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const k of allFlags) {
      const pats = patternsByFlag[k];
      if (!pats.any.test(text)) continue;
      index[k].usedAnywhere = true;
      if (pats.array.test(text))     index[k].hasArrayWrite = true;
      if (pats.boolean.test(text))   index[k].hasBooleanWrite = true;
      if (pats.objectish.test(text)) index[k].hasObjectishWrite = true;
    }
  }
  return index;
}

// ── Run scans ────────────────────────────────────────────────────────────────
const allFlags = [
  ...ROUND_OBJECT_FLAGS,
  ...ROUND_NULL_FLAGS,
  ...ROUND_ARRAY_FLAGS,
  ...ROUND_FALSE_FLAGS,
  ...ROUND_DELETE_FLAGS,
];
const uniqueFlags = [...new Set(allFlags)];
const duplicates = findDuplicates();
const writeIndex = buildWriteIndex(uniqueFlags);

const unusedFlags = [];
for (const k of uniqueFlags) {
  if (!writeIndex[k].usedAnywhere) unusedFlags.push(k);
}

const typeMismatches = [];
function expectForBucket(bucket, rec) {
  if (bucket === 'array')   return rec.hasArrayWrite;
  if (bucket === 'false')   return rec.hasBooleanWrite;
  if (bucket === 'object')  return rec.hasObjectishWrite;
  if (bucket === 'null')    return rec.hasObjectishWrite; // null-slot holds objects or null
  if (bucket === 'delete')  return true; // no type check
  return true;
}
for (const [bucket, keys] of Object.entries(BUCKETS)) {
  for (const k of keys) {
    const rec = writeIndex[k];
    // Only check flags that are actually used somewhere — an unused flag
    // is Invariant 2's concern, not a type mismatch.
    if (!rec.usedAnywhere) continue;
    if (!expectForBucket(bucket, rec)) {
      typeMismatches.push({
        key: k,
        bucket,
        saw: {
          array:   rec.hasArrayWrite,
          boolean: rec.hasBooleanWrite,
          objectish: rec.hasObjectishWrite,
        },
      });
    }
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────
function logAlways() {
  console.log(`\n[round-flags] Totals:`);
  console.log(`        ROUND_OBJECT_FLAGS:  ${ROUND_OBJECT_FLAGS.length}`);
  console.log(`        ROUND_NULL_FLAGS:    ${ROUND_NULL_FLAGS.length}`);
  console.log(`        ROUND_ARRAY_FLAGS:   ${ROUND_ARRAY_FLAGS.length}`);
  console.log(`        ROUND_FALSE_FLAGS:   ${ROUND_FALSE_FLAGS.length}`);
  console.log(`        ROUND_DELETE_FLAGS:  ${ROUND_DELETE_FLAGS.length}`);
  console.log(`        unique keys:         ${uniqueFlags.length}`);
  console.log(`[round-flags] Current findings (baseline in parens):`);
  console.log(`        duplicates:          ${duplicates.length} (${BASELINE_DUPLICATES.length})`);
  console.log(`        unused registrations:${unusedFlags.length} (${BASELINE_UNUSED.length})`);
  console.log(`        type mismatches:     ${typeMismatches.length} (${BASELINE_TYPE_MISMATCH.length})`);

  if (duplicates.length > 0) {
    console.log(`\n[round-flags] Duplicate registrations:`);
    for (const d of duplicates) console.log(`  • ${d.key}  →  [${d.buckets.join(', ')}]`);
  }
  if (unusedFlags.length > 0) {
    console.log(`\n[round-flags] Registered but no write site found in src/:`);
    for (const k of unusedFlags) console.log(`  • ${k}`);
  }
  if (typeMismatches.length > 0) {
    console.log(`\n[round-flags] Registered-bucket vs actual-write shape mismatches:`);
    for (const tm of typeMismatches) {
      const found = Object.entries(tm.saw).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none';
      console.log(`  • ${tm.key}  (bucket=${tm.bucket}; found writes: ${found})`);
    }
  }
}

function growthBeyond(current, baseline) {
  const base = new Set(baseline);
  return current.filter(x => !base.has(typeof x === 'string' ? x : x.key));
}

describe('ROUND_*_FLAGS completeness (non-mutating surfacing)', () => {
  it('emits flag registry summary on every run', () => {
    logAlways();
    assert.ok(true);
  });

  it('no flag key is registered in more than one bucket (Inv 1)', () => {
    const keys = duplicates.map(d => d.key);
    const newDupes = growthBeyond(keys, BASELINE_DUPLICATES);
    if (newDupes.length > 0) {
      assert.fail(
        `${newDupes.length} new duplicate registration(s) beyond baseline ${BASELINE_DUPLICATES.length}:\n` +
        newDupes.map(k => `  • ${k}`).join('\n')
      );
    }
  });

  it('every registered key is written somewhere in src/ (Inv 2)', () => {
    const newUnused = growthBeyond(unusedFlags, BASELINE_UNUSED);
    if (newUnused.length > 0) {
      assert.fail(
        `${newUnused.length} new unused registration(s) beyond baseline ${BASELINE_UNUSED.length}:\n` +
        newUnused.map(k => `  • ${k}`).join('\n')
      );
    }
  });

  it('typed-bucket flags have at least one type-consistent write (Inv 3)', () => {
    const keys = typeMismatches.map(t => t.key);
    const newMismatches = growthBeyond(keys, BASELINE_TYPE_MISMATCH);
    if (newMismatches.length > 0) {
      assert.fail(
        `${newMismatches.length} new type-mismatch(es) beyond baseline ${BASELINE_TYPE_MISMATCH.length}:\n` +
        newMismatches.map(k => `  • ${k}`).join('\n')
      );
    }
  });
});
