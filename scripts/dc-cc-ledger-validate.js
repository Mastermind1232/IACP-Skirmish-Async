#!/usr/bin/env node
/**
 * Validator for `docs/dc-cc-ledger.json`.
 *
 * Checks:
 *   1. schema — every atom has required fields (id, type, abilityKey, status)
 *   2. id uniqueness
 *   3. type ∈ { dcSpecial, dcPassive, surge, ccEffect }
 *   4. status ∈ { pending, covered, covered_by_ref, gap, exempt }
 *   5. status=covered atoms MUST carry evidence.files (≥1) and reviewedBy
 *   6. evidence.files[] paths exist on disk
 *   7. owners[].name must resolve against dc-effects / cc-effects
 *   8. library coherence — every ability-library entry must have an atom
 *      (re-run scaffold if this fails)
 *
 * Exits 0 on clean, 1 on any error. Warnings do not fail.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const LIB_PATH = resolve(ROOT, 'data/ability-library.json');
const DC_PATH = resolve(ROOT, 'data/dc-effects.json');
const CC_PATH = resolve(ROOT, 'data/cc-effects.json');

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
const library = JSON.parse(readFileSync(LIB_PATH, 'utf8')).abilities;
const dcCards = JSON.parse(readFileSync(DC_PATH, 'utf8')).cards;
const ccCards = JSON.parse(readFileSync(CC_PATH, 'utf8')).cards;

const VALID_TYPES = new Set(['dcSpecial', 'dcPassive', 'surge', 'ccEffect']);
const VALID_STATUS = new Set(['pending', 'covered', 'covered_by_ref', 'gap', 'exempt']);

const errors = [];
const warnings = [];

const atoms = ledger.atoms || [];
const seenIds = new Set();
const seenKeys = new Set();

for (const a of atoms) {
  if (!a.id || !a.type || !a.abilityKey || !a.status) {
    errors.push(`atom missing required field: ${JSON.stringify(a).slice(0, 120)}`);
    continue;
  }
  if (seenIds.has(a.id)) errors.push(`duplicate atom id: ${a.id}`);
  seenIds.add(a.id);
  seenKeys.add(a.abilityKey);

  if (!VALID_TYPES.has(a.type)) errors.push(`[${a.id}] invalid type: ${a.type}`);
  if (!VALID_STATUS.has(a.status)) errors.push(`[${a.id}] invalid status: ${a.status}`);

  if (a.status === 'covered') {
    if (!a.evidence?.files?.length) errors.push(`[${a.id}] status=covered requires evidence.files`);
    if (!a.reviewedBy?.name || !a.reviewedBy?.date) errors.push(`[${a.id}] status=covered requires reviewedBy { name, date }`);
  }
  if (a.status === 'covered_by_ref' && !a.seeAlso?.length) {
    errors.push(`[${a.id}] status=covered_by_ref requires seeAlso`);
  }
  if (a.status === 'exempt' && !a.exemptReason) {
    warnings.push(`[${a.id}] status=exempt without exemptReason`);
  }

  for (const f of a.evidence?.files || []) {
    const p = resolve(ROOT, f);
    if (!existsSync(p) || !statSync(p).isFile()) {
      errors.push(`[${a.id}] evidence.file missing on disk: ${f}`);
    }
  }

  for (const o of a.owners || []) {
    if (o.kind === 'dc' || o.kind === 'dc-surge') {
      if (!dcCards[o.name]) errors.push(`[${a.id}] owner DC not found: ${o.name}`);
    } else if (o.kind === 'cc') {
      if (!ccCards[o.name]) errors.push(`[${a.id}] owner CC not found: ${o.name}`);
    } else {
      errors.push(`[${a.id}] unknown owner kind: ${o.kind}`);
    }
  }
}

// Coherence — every library key must have an atom.
for (const key of Object.keys(library)) {
  if (!seenKeys.has(key)) {
    errors.push(`library entry has no atom (re-run scaffold): ${key}`);
  }
}

for (const w of warnings) console.warn(`WARN ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

const byStatus = atoms.reduce((m, a) => { m[a.status] = (m[a.status] || 0) + 1; return m; }, {});
console.log(`[dc-cc-ledger-validate] ${atoms.length} atoms; ${errors.length} errors, ${warnings.length} warnings`);
console.log('  by status:', byStatus);

process.exit(errors.length ? 1 : 0);
