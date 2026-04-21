#!/usr/bin/env node
/**
 * Batch-15 DC/CC ledger patch: promote all 48 pending `surge` atoms.
 * Coverage is library-shape only: entry exists, type=surge, non-empty label,
 * surgeCost integer 1–2, label + surgeCost pinned to expected values.
 * Probe: tests/domain/oracle/dc-cc-surge-library-shape-batch-15-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-surge-library-shape-batch-15-probe.test.js';

const PROMOTIONS = [
  ['SURGE-1-HIT',                  '+1 hit',                1, '+1 Hit'],
  ['SURGE-1-HIT-PIERCE-1',         '+1 hit, pierce 1',      1, '+1 Hit, Pierce 1'],
  ['SURGE-1-HIT-STUN',             '+1 hit, stun',          1, '+1 Hit, Stun'],
  ['SURGE-2-HITS',                 '+2 hits',               1, '+2 Hits'],
  ['SURGE-3-DAMAGE',               '+3 damage',             1, '+3 Damage'],
  ['SURGE-ACCURACY-1',             'accuracy 1',            1, '+1 Accuracy'],
  ['SURGE-ACCURACY-2',             'accuracy 2',            1, '+2 Accuracy'],
  ['SURGE-ACCURACY-2-PIERCE-1',    'accuracy 2, pierce 1',  1, '+2 Accuracy, Pierce 1'],
  ['SURGE-ACCURACY-2-SURGE-1',     'accuracy 2, surge 1',   1, '+2 Accuracy, +1 Surge'],
  ['SURGE-ACCURACY-3',             'accuracy 3',            1, '+3 Accuracy'],
  ['SURGE-AGITATE',                'agitate',               1, 'Agitate'],
  ['SURGE-BARGAIN',                'bargain',               1, 'Bargain'],
  ['SURGE-BLAST-1',                'blast 1',               1, 'Blast 1'],
  ['SURGE-BLAST-2',                'blast 2',               1, 'Blast 2'],
  ['SURGE-BLEED',                  'bleed',                 1, 'Bleed'],
  ['SURGE-CLEAVE-1',               'cleave 1',              1, 'Cleave 1'],
  ['SURGE-CLEAVE-2',               'cleave 2',              1, 'Cleave 2'],
  ['SURGE-CONCUSSIVE-BOLT',        'concussive_bolt',       1, 'Concussive Bolt'],
  ['SURGE-CRITICAL-HIT',           'critical_hit',          1, 'Critical Hit'],
  ['SURGE-DAMAGE-1',               'damage 1',              1, '+1 Hit'],
  ['SURGE-DAMAGE-2',               'damage 2',              1, '+2 Hits'],
  ['SURGE-DAMAGE-2-HIDE',          'damage 2, hide',        1, '+2 Hits, Hide'],
  ['SURGE-DAMAGE-3',               'damage 3',              1, '+3 Hits'],
  ['SURGE-DAMAGE-4',               'damage 4',              2, '+4 Hits'],
  ['SURGE-DEADLY-SPIN',            'deadly_spin',           1, 'Deadly Spin'],
  ['SURGE-FELL-SWOOP',             'fell_swoop',            1, 'Fell Swoop'],
  ['SURGE-FIGHTING-KNIFE',         'fighting_knife',        1, 'Fighting Knife'],
  ['SURGE-FOCUS',                  'focus',                 1, 'Focus'],
  ['SURGE-HARASS',                 'harass',                1, 'Harass'],
  ['SURGE-HIDE',                   'hide',                  1, 'Hide'],
  ['SURGE-INTERROGATE',            'interrogate',           1, 'Interrogate'],
  ['SURGE-MASTERY',                'mastery',               1, 'Mastery'],
  ['SURGE-PIERCE-1',               'pierce 1',              1, 'Pierce 1'],
  ['SURGE-PIERCE-1-WEAKEN',        'pierce 1, weaken',      1, 'Pierce 1, Weaken'],
  ['SURGE-PIERCE-2',               'pierce 2',              1, 'Pierce 2'],
  ['SURGE-PIERCE-3',               'pierce 3',              1, 'Pierce 3'],
  ['SURGE-RECOVER-1',              'recover 1',             1, 'Recover 1'],
  ['SURGE-RECOVER-2',              'recover 2',             1, 'Recover 2'],
  ['SURGE-RECOVER-3',              'recover 3',             1, 'Recover 3'],
  ['SURGE-SHOCKING-PALM',          'shocking_palm',         1, 'Shocking Palm'],
  ['SURGE-SHRAPNEL',               'shrapnel',              1, 'Shrapnel'],
  ['SURGE-SPREAD-THE-PAIN',        'spread_the_pain',       1, 'Spread the Pain'],
  ['SURGE-SQUAD-COMMAND',          'squad_command',         1, 'Squad Command'],
  ['SURGE-STALK-PREY',             'stalk_prey',            1, 'Stalk Prey'],
  ['SURGE-STUN',                   'stun',                  1, 'Stun'],
  ['SURGE-STUN-NET',               'stun_net',              1, 'Stun Net'],
  ['SURGE-SUPPRESSION',            'suppression',           1, 'Suppression'],
  ['SURGE-WEAKEN',                 'weaken',                1, 'Weaken'],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, key, cost, label] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-15] skip ${id}: status is ${atom.status}`);
    continue;
  }
  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  atom.status = 'covered';
  atom.implHint = `Surge library-shape coverage in ${PROBE_FILE} pins type/label/surgeCost on abilities['${key}'].`;
  atom.evidence = {
    files: [...new Set([...implRefFiles, 'data/ability-library.json', PROBE_FILE])].sort(),
    assertions: [
      `abilities['${key}'] exists with type=surge`,
      `label === ${JSON.stringify(label)}`,
      `surgeCost === ${cost} (integer in [1,2])`,
    ],
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-15 surge library-shape probe (atomic-surge contract).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-15: surge library-shape contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-15] promoted ${patched} atom(s) pending → covered`);
