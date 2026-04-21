#!/usr/bin/env node
/**
 * DC/CC ledger test-coverage discovery pass (tiered).
 *
 * For each pending atom with existing implRefs, classify test-file matches
 * into confidence tiers so we can promote only the atoms whose tests truly
 * exercise the ability. Read-only: writes a JSON report and prints a
 * summary. A separate promotion script consumes the report.
 *
 * Tiers (most confident first):
 *   strong:
 *     - filename (basename) contains the abilityKey slug.
 *       This is the only tier considered promotable. Filename is a
 *       deliberate author signal that the file is about this ability,
 *       and is robust against common-word collisions that plague label
 *       matching (e.g. "Ambush" matching tests for "Lie in Ambush").
 *   medium:
 *     - a describe(...) / it(...) label contains the abilityKey or its
 *       slug. Subject to common-word false positives; flagged for human
 *       review rather than auto-promoted.
 *   weak:
 *     - abilityKey appears only inside a string literal, or a structured
 *       field name matches, or the slug appears in non-label content.
 *       Too noisy to act on (e.g. field `applyFocus` matches any test
 *       that happens to call focus).
 *
 * An atom is `promotable` when it has at least one strong-tier match in
 * tests/domain/. Medium matches are logged for reviewer triage. Weak
 * matches are recorded but do not count toward promotion.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const TESTS_DIR = resolve(ROOT, 'tests/domain');
const REPORT_PATH = resolve(ROOT, 'docs/dc-cc-ledger-test-discovery-report.json');

function walkJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkJsFiles(p));
    else if (st.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

function toSlug(s) {
  return String(s)
    .replace(/'/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function extractLabels(content) {
  const labels = [];
  const re = /\b(?:describe|it)\s*\(\s*(['"`])([^'"`]{3,200})\1/g;
  let m;
  while ((m = re.exec(content)) !== null) labels.push(m[2]);
  return labels;
}

function matchesInStringLiterals(content, needle) {
  if (!needle || needle.length < 4) return false;
  const re = new RegExp(`(['"\`])[^'"\`]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"\`]*\\1`);
  return re.test(content);
}

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const testFiles = walkJsFiles(TESTS_DIR);
const fileCache = new Map();
for (const f of testFiles) fileCache.set(f, readFileSync(f, 'utf8'));
const labelCache = new Map();
for (const [f, c] of fileCache) labelCache.set(f, extractLabels(c));

const report = { atoms: [], summary: {} };
let promotable = 0;
let mediumOnly = 0;
let weakOnly = 0;
let noMatch = 0;
let noImplRefs = 0;

for (const atom of ledger.atoms) {
  if (atom.status !== 'pending') continue;
  const implRefs = atom.triage?.implRefs || {};
  if (Object.keys(implRefs).length === 0) { noImplRefs += 1; continue; }

  const abilityKey = atom.abilityKey || '';
  const slug = toSlug(abilityKey);
  const fields = atom.triage?.structuredFields || [];

  const strong = [];
  const medium = [];
  const weak = [];

  for (const [file, content] of fileCache) {
    const fname = basename(file).toLowerCase();
    const labels = labelCache.get(file) || [];
    const relPath = relative(ROOT, file);

    // Strong: filename contains slug as a bounded token. We require the
    // slug to be surrounded by non-alphanumeric characters (or string
    // boundary) to avoid substring collisions (e.g. "charge" matching
    // "surcharge"). Trailing "s" is allowed to accommodate plurals like
    // "sentinel" → "sentinels". We compare with separators normalized to
    // `-` because test filenames use kebab-case while the slug fn emits
    // snake_case.
    if (slug && slug.length > 4) {
      const slugKebab = slug.replace(/_/g, '-');
      const slugEsc = slugKebab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundedFn = new RegExp(`(^|[^a-z0-9])${slugEsc}s?([^a-z0-9]|$)`);
      const fnameKebab = fname.replace(/_/g, '-');
      if (boundedFn.test(fnameKebab)) {
        strong.push({ file: relPath, hits: ['filename'] });
        continue;
      }
    }

    // Medium: describe/it label contains abilityKey or slug
    let labelHit = false;
    if (abilityKey && abilityKey.length > 3) {
      for (const lbl of labels) {
        const low = lbl.toLowerCase();
        if (low.includes(abilityKey.toLowerCase()) || (slug.length > 4 && low.includes(slug))) {
          labelHit = true;
          break;
        }
      }
    }
    if (labelHit) {
      medium.push({ file: relPath, hits: ['label'] });
      continue;
    }

    // Medium: abilityKey appears inside a string literal
    if (abilityKey && matchesInStringLiterals(content, abilityKey)) {
      medium.push({ file: relPath, hits: ['stringLiteral:abilityKey'] });
      continue;
    }

    // Weak: slug in content, or a structured field name present
    const weakHits = [];
    if (slug && slug.length > 4 && content.includes(slug)) weakHits.push('slug');
    for (const field of fields) {
      if (field && field.length > 3 && content.includes(field)) weakHits.push(`field:${field}`);
    }
    if (weakHits.length > 0) weak.push({ file: relPath, hits: weakHits });
  }

  let tier;
  if (strong.length > 0) { tier = 'strong'; promotable += 1; }
  else if (medium.length > 0) { tier = 'medium'; mediumOnly += 1; }
  else if (weak.length > 0) { tier = 'weak'; weakOnly += 1; }
  else { tier = 'none'; noMatch += 1; }

  report.atoms.push({
    id: atom.id,
    abilityKey,
    tier,
    strong,
    medium,
    weak,
  });
}

report.summary = {
  totalAtoms: ledger.atoms.length,
  pendingTotal: ledger.atoms.filter((a) => a.status === 'pending').length,
  promotable,
  mediumOnly,
  weakOnly,
  noMatch,
  noImplRefs,
  testFilesScanned: testFiles.length,
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log('[discover-tests] report written to', relative(ROOT, REPORT_PATH));
console.log('[discover-tests] summary:', JSON.stringify(report.summary, null, 2));
