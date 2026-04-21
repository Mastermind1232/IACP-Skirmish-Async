#!/usr/bin/env node
/**
 * Batch-9 DC/CC ledger patch: 30 more data-driven CCs promoted via the
 * bulk library-wiring probe.
 *
 * Probe: tests/domain/oracle/dc-cc-library-wiring-batch-9-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-wiring-batch-9-probe.test.js';

const PROMOTIONS = [
  ['CC-DROID-MASTERY',         'Droid Mastery',           ['droidMasteryEffect']],
  ['CC-ELUSIVE',               'Elusive',                 ['elusiveEffect']],
  ['CC-ESCALATING-HOSTILITY',  'Escalating Hostility',    ['defenderStrain', 'defenderStrainPlusDiscardCopies']],
  ['CC-ETIQUETTE-AND-PROTOCOL','Etiquette and Protocol',  ['etiquetteAndProtocolEffect']],
  ['CC-EVACUATE',              'Evacuate',                ['evacuateEffect']],
  ['CC-EXPLOSIVE-WEAPONRY',    'Explosive Weaponry',      ['attackBonusBlast']],
  ['CC-FACE-ME',               'Face Me!',                ['faceMeEffect']],
  ['CC-FEINT',                 'Feint',                   ['defensePoolRemoveMax']],
  ['CC-FERAL-SWIPES',          'Feral Swipes',            ['feralSwipesEffect']],
  ['CC-FEROCITY',              'Ferocity',                ['ferocityEffect']],
  ['CC-FIELD-PROMOTION',       'Field Promotion',         ['celebrationVp', 'increaseArmyCostBy']],
  ['CC-FIELD-SUPPLY',          'Field Supply',            ['fieldSupplyEffect']],
  ['CC-FIELD-TACTICIAN',       'Field Tactician',         ['fieldTacticianEffect']],
  ['CC-FINDSMAN-MEDITATION',   'Findsman Meditation',     ['findsmanMeditationEffect']],
  ['CC-FORCE-ILLUSION',        'Force Illusion',          ['applyHideWhenDefending']],
  ['CC-FORCE-PUSH',            'Force Push',              ['forcePushEffect']],
  ['CC-FORESEE',               'Foresee',                 ['foreseeEffect']],
  ['CC-FORWARD-MARCH',         'Forward March',           ['grantMpToFriendliesWithin2']],
  ['CC-GLORY-OF-THE-KILL',     'Glory of the Kill',       ['recoverDamage']],
  ['CC-GRENADIER',             'Grenadier',               ['rollOneDie', 'rollOneDieTarget', 'rollOneDieRange']],
  ['CC-GUARDIAN-STANCE',       'Guardian Stance',         ['defenderRerollDiceMax']],
  ['CC-GUERILLA-WARFARE',      'Guerilla Warfare',        ['applyBlockAndHideToIsolatedFriendlies']],
  ['CC-HARD-TO-HIT',           'Hard to Hit',             ['applyDefenseBonusEvade']],
  ['CC-HARSH-ENVIRONMENT',     'Harsh Environment',       ['informational', 'setsHarshEnvironment']],
  ['CC-HEAVY-ORDNANCE',        'Heavy Ordnance',          ['attackBonusHits']],
  ['CC-HEIGHTENED-REFLEXES',   'Heightened Reflexes',     ['defensePoolRemoveMax']],
  ['CC-HIDDEN-TRAP',           'Hidden Trap',             ['hiddenTrapEffect']],
  ['CC-HIDE-IN-PLAIN-SIGHT',   'Hide in Plain Sight',     ['applyHide']],
  ['CC-HIT-AND-RUN',           'Hit and Run',             ['mpAfterAttack']],
  ['CC-HONORING-THE-FALLEN',   'Honoring the Fallen',     ['attackBonusHitsFromDefeatedFriendly', 'attackBonusHitsFromDefeatedMax']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, name, fields] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-9] skip ${id}: status is ${atom.status}`);
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
  atom.notes = 'Promoted via batch-9 library-wiring probe (structural field contract on data-driven ccEffect).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-9: library-wiring contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-9] promoted ${patched} atom(s) pending → covered`);
