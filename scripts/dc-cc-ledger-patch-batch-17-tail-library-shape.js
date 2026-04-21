#!/usr/bin/env node
/**
 * Batch-17 DC/CC ledger patch: final 6 pending atoms (1 ccEffect + 5
 * dcPassive) — closes the zero-structured-fields tail.
 * Probe: tests/domain/oracle/dc-cc-tail-library-shape-batch-17-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-tail-library-shape-batch-17-probe.test.js';

const PROMOTIONS = [
  ['CC-CAL-S-BUDDY',                 "Cal's Buddy",             'ccEffect',  "Deploy BD-1 to Cal's space or an adjacent space; BD-1 activates at start/end of Cal's activation"],
  ['DC-PASS-ATTACHED-DIO',           'attached_dio',            'dcPassive', 'Attached'],
  ['DC-PASS-DEFENSIVE-FIRE-BOKATAN', 'defensive_fire_bokatan',  'dcPassive', 'Defensive Fire'],
  ['DC-PASS-DROID-KIT-IDEN',         'droid_kit_iden',          'dcPassive', 'Droid Kit (Iden)'],
  ['DC-PASS-INSIGNIFICANT-DIO',      'insignificant_dio',       'dcPassive', 'Insignificant'],
  ['DC-PASS-PULSE-CANNON-IDEN',      'pulse_cannon_iden',       'dcPassive', 'Pulse Cannon (Iden)'],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, key, type, label] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-17] skip ${id}: status is ${atom.status}`);
    continue;
  }
  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  atom.status = 'covered';
  atom.implHint = `Tail library-shape coverage in ${PROBE_FILE} pins type/label on abilities['${key}'].`;
  atom.evidence = {
    files: [...new Set([...implRefFiles, 'data/ability-library.json', PROBE_FILE])].sort(),
    assertions: [
      `abilities['${key}'] exists with type=${type}`,
      `label === ${JSON.stringify(label)}`,
      `wiredStatus === 'wired' when present`,
    ],
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-17 tail library-shape probe (minimum-viable shape for entries without structured fields).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-17: tail library-shape contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-17] promoted ${patched} atom(s) pending → covered`);
