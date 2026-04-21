#!/usr/bin/env node
/**
 * Batch-12 DC/CC ledger patch: 30 more ccEffect CCs (discovery tier != none).
 * Library-wiring probe provides structural-contract coverage in addition to
 * whatever ambient label/field mentions the discovery pass detected.
 * Probe: tests/domain/oracle/dc-cc-library-wiring-batch-12-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-wiring-batch-12-probe.test.js';

const PROMOTIONS = [
  ['CC-ALL-IN-A-DAY-S-WORK',  "All in a Day's Work",  ['applyFocus', 'extraActionBonus']],
  ['CC-AMBUSH',               'Ambush',               ['mpBonus', 'chooseAdjacentHostileThen']],
  ['CC-APEX-PREDATOR',        'Apex Predator',        ['applyFocus', 'applyHide', 'powerTokenGain', 'mpBonus', 'recoverOnHostileDefeat', 'recoverOnHostileDefeatRange']],
  ['CC-ARMED-ESCORT',         'Armed Escort',         ['roundDefenseBonusEvade']],
  ['CC-ASSASSINATE',          'Assassinate',          ['attackBonusHits', 'mutualExcludeAttackCc']],
  ['CC-BEATDOWN',             'Beatdown',             ['nextAttacksBonusHits']],
  ['CC-BLACK-MARKET-PRICES',  'Black Market Prices',  ['draw', 'drawThenDiscardOneGainVp']],
  ['CC-BLITZ',                'Blitz',                ['attackSurgeBonus']],
  ['CC-BODYGUARD',            'Bodyguard',            ['mpBonus', 'attackTargetSwap']],
  ['CC-BURST-FIRE',           'Burst Fire',           ['freeAttackBonus']],
  ['CC-CAPTURE-THE-WEARY',    'Capture the Weary',    ['chooseAdjacentHostileThen']],
  ['CC-CAVALRY-CHARGE',       'Cavalry Charge',       ['roundDefenseBonusBlock', 'trooperRoundAttackHitBonus']],
  ['CC-CC-ADRENALINE',        'cc:adrenaline',        ['timing', 'adrenalineEffect']],
  ['CC-CC-ADVANCE-WARNING',   'cc:advance_warning',   ['mpBonus']],
  ['CC-CC-DIOXIS-FUMES',      'cc:dioxis_fumes',      ['dioxisFumesEffect']],
  ['CC-CC-FLEET-FOOTED',      'cc:fleet_footed',      ['mpBonus']],
  ['CC-CELEBRATION',          'Celebration',          ['celebrationVp']],
  ['CC-CLOSE-AND-PERSONAL',   'Close and Personal',   ['mpBonus', 'freeAttackBonus', 'overrideAttackDice', 'overrideAttackType']],
  ['CC-COMM-DISRUPTION',      'Comm Disruption',      ['commDisruptionEffect']],
  ['CC-COUNTER-ATTACK',       'Counter Attack',       ['chooseAdjacentHostileThen']],
  ['CC-CRIPPLE',              'Cripple',              ['cripplesFigure']],
  ['CC-CRUEL-STRIKE',         'Cruel Strike',         ['nextAttackBonusSurgeAbilities']],
  ['CC-CRUSH',                'Crush',                ['chooseAdjacentHostileThen']],
  ['CC-CUT-LINES',            'Cut Lines',            ['noCommandDrawThisRound']],
  ['CC-DEATHBLOW',            'Deathblow',            ['attackBonusHits']],
  ['CC-DEBTS-REPAID',         'Debts Repaid',         ['applyFocus', 'readyActiveDc']],
  ['CC-DEFINITION-LOVE',      "Definition: 'Love'",   ['freeAttackBonus', 'attackOverrideOpts']],
  ['CC-DEFLECTION',           'Deflection',           ['roundDefenseAccuracyPenalty', 'deflectionCounterDamage', 'deflectionCounterUnconditional']],
  ['CC-DESPERATE-ESCAPE',     'Desperate Escape',     ['mpBonus']],
  ['CC-DIRTY-TRICK',          'Dirty Trick',          ['chooseAdjacentHostileThen']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, name, fields] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-12] skip ${id}: status is ${atom.status}`);
    continue;
  }
  const implRefFiles = Object.keys(atom.triage?.implRefs || {});
  atom.status = 'covered';
  atom.implHint = `Library-wiring coverage in ${PROBE_FILE} pins structured fields on abilities['${name}'].`;
  atom.evidence = {
    files: [...new Set([...implRefFiles, 'data/ability-library.json', PROBE_FILE])].sort(),
    assertions: [
      `abilities['${name}'] exists with type=ccEffect, wiredStatus=wired`,
      ...fields.map(f => `field '${f}' present and non-null`),
    ],
  };
  atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
  atom.notes = 'Promoted via batch-12 library-wiring probe (structural contract; tier!=none discovery hits).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-12: library-wiring contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-12] promoted ${patched} atom(s) pending → covered`);
