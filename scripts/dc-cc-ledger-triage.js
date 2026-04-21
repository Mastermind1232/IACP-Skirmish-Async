#!/usr/bin/env node
/**
 * Automated triage pass over `docs/dc-cc-ledger.json`.
 *
 * For each pending atom, scan src/ and tests/ once and record:
 *   - triage.implRefs:   { fileRelPath: hitCount, ... } in src/
 *   - triage.testRefs:   { fileRelPath: hitCount, ... } in tests/
 *   - triage.riskTier:   'low' | 'medium' | 'high' — heuristic over the counts
 *
 * Risk heuristic:
 *   high    = no src hits AND no test hits (likely data-only or gap)
 *   medium  = src hits present but NO test hits (implemented, untested)
 *   low     = both src and test hits present (implemented + tested, probably)
 *
 * Matching uses the atom's abilityKey exactly (quoted forms: "key" or 'key').
 * CC atoms additionally match their human-readable key (the CC name). This
 * is a first-cut triage to sort the universe — "low" still needs review to
 * confirm the test is actually *about* that ability.
 *
 * Does NOT change atom.status — triage lives in a separate `triage` subtree
 * so reviewers can see the signal alongside their own verdicts.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const SRC_DIR = resolve(ROOT, 'src');
const TESTS_DIR = resolve(ROOT, 'tests');

function* walkJs(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkJs(p);
    else if (p.endsWith('.js')) yield p;
  }
}

function loadFiles(dir) {
  const out = [];
  for (const p of walkJs(dir)) out.push({ path: p, src: readFileSync(p, 'utf8') });
  return out;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const srcFiles = loadFiles(SRC_DIR);
const testFiles = loadFiles(TESTS_DIR);

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));

// Name-style needles (abilityKey / label) — match only inside quotes so we
// don't count comments or incidental substrings. Identifier-style needles
// (structured field names) — match on word boundary since they appear as
// unquoted property access in code.
function countHits(files, { nameNeedles = [], idNeedles = [] } = {}) {
  const res = {};
  const namePatterns = nameNeedles.map((n) => new RegExp(`['"\`]${escRe(n)}['"\`]`, 'g'));
  const idPatterns = idNeedles.map((n) => new RegExp(`\\b${escRe(n)}\\b`, 'g'));
  for (const f of files) {
    let total = 0;
    for (const re of namePatterns) { const m = f.src.match(re); if (m) total += m.length; }
    for (const re of idPatterns) { const m = f.src.match(re); if (m) total += m.length; }
    if (total > 0) res[relative(ROOT, f.path)] = total;
  }
  return res;
}

// Load the library so we can extract each atom's structured dispatch fields.
const LIB = JSON.parse(readFileSync(resolve(ROOT, 'data/ability-library.json'), 'utf8')).abilities;
const METADATA_KEYS = new Set(['type', 'label', 'description', 'logMessage', 'wiredStatus', 'surgeCost', 'oncePer', 'category', 'trigger', 'freeAction']);

function structuredFields(key) {
  const entry = LIB[key] || {};
  return Object.keys(entry).filter((k) => !METADATA_KEYS.has(k));
}

let enriched = 0;
for (const a of ledger.atoms) {
  // Needles fall into two groups:
  //   - name needles: quoted literal of abilityKey / label (catches name-dispatched paths)
  //   - field needles: quoted literals of structured field names (catches data-driven paths)
  const nameNeedles = [a.abilityKey];
  if (a.label && a.label !== a.abilityKey && a.type !== 'ccEffect') nameNeedles.push(a.label);
  const fieldNeedles = structuredFields(a.abilityKey);

  const implRefs = countHits(srcFiles, { nameNeedles, idNeedles: fieldNeedles });
  const testRefs = countHits(testFiles, { nameNeedles }); // tests almost always name the mechanic

  const implCount = Object.keys(implRefs).length;
  const testCount = Object.keys(testRefs).length;
  let riskTier;
  if (implCount === 0 && testCount === 0) riskTier = 'high';
  else if (testCount === 0) riskTier = 'medium';
  else riskTier = 'low';

  a.triage = {
    dispatchKind: fieldNeedles.length > 0 ? 'data-driven' : 'name-only',
    structuredFields: fieldNeedles,
    implRefs,
    testRefs,
    riskTier,
  };
  enriched++;
}

const byTier = ledger.atoms.reduce((m, a) => {
  const t = a.triage?.riskTier || 'unknown';
  m[t] = (m[t] || 0) + 1;
  return m;
}, {});
const byTypeTier = {};
for (const a of ledger.atoms) {
  const k = `${a.type}:${a.triage?.riskTier}`;
  byTypeTier[k] = (byTypeTier[k] || 0) + 1;
}

ledger._meta = {
  ...ledger._meta,
  triagedAt: new Date().toISOString(),
  triageSummary: { byTier, byTypeTier },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-triage] enriched ${enriched} atoms`);
console.log('  by tier:', byTier);
console.log('  by type+tier:', byTypeTier);
