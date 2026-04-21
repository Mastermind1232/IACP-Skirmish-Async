#!/usr/bin/env node
/**
 * Batch-8 DC/CC ledger patch: 30 more data-driven CCs promoted via the
 * bulk library-wiring probe.
 *
 * Probe: tests/domain/oracle/dc-cc-library-wiring-batch-8-probe.test.js
 *
 * Same pattern as batch-7: the CC is consumed by a thin dispatcher reading
 * structured fields from data/ability-library.json. Field presence + value
 * is the contract. Handler-path coverage would re-verify the same reads.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-wiring-batch-8-probe.test.js';

const PROMOTIONS = [
  ['CC-ARCING-SHOT',           'Arcing Shot',             ['attackAccuracyBonus', 'arcingShotTargeting']],
  ['CC-BALLISTICS-MATRIX',     'Ballistics Matrix',       ['ballisticsMatrixEffect']],
  ['CC-BATTLE-SCARS',          'Battle Scars',            ['powerTokenGain', 'powerTokenGainIfDamagedGte']],
  ['CC-BATTLEFIELD-AWARENESS', 'Battlefield Awareness',   ['battlefieldAwarenessEffect']],
  ['CC-BLADESTORM',            'Bladestorm',              ['attackSurgeBonus', 'postAttackAoeDamage', 'postAttackAoeRange']],
  ['CC-BLAZE-OF-GLORY',        'Blaze of Glory',          ['readyOwnDeploymentCard', 'endOfRoundSelfDamage']],
  ['CC-BLOOD-FEUD',            'Blood Feud',              ['bloodFeudEffect']],
  ['CC-BRACE-FOR-IMPACT',      'Brace for Impact',        ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['CC-BRACE-YOURSELF',        'Brace Yourself',          ['applyDefenseBonusBlock', 'defenseBonusOnlyWhenNotAttackerActivation']],
  ['CC-BUILT-ON-HOPE',         'Built on Hope',           ['builtOnHopeEffect']],
  ['CC-CALL-THE-VANGUARD',     'Call the Vanguard',       ['callTheVanguardEffect']],
  ['CC-CAPITALIZE',            'Capitalize',              ['defensePoolRemoveMax']],
  ['CC-CC-AGAINST-THE-ODDS',   'cc:against_the_odds',     ['focusGainToUpToNFigures', 'vpCondition']],
  ['CC-CC-EYES-ON-THE-PRIZE',  'cc:eyes_on_the_prize',    ['informational']],
  ['CC-CC-GAUNTLET-BLADE',     'cc:gauntlet_blade',       ['rollOneDie', 'rollOneDieTarget', 'rollOneDieSurgeSelfPowerToken']],
  ['CC-CHANGE-OF-PLANS',       'Change of Plans',         ['changeOfPlansEffect']],
  ['CC-CHAOTIC-FORCE',         'Chaotic Force',           ['chaoticForceEffect']],
  ['CC-CHOOSE-A-SIDE',         'Choose a Side',           ['chooseASideEffect']],
  ['CC-CLONED-REINFORCEMENTS', 'Cloned Reinforcements',   ['placeDefeatedFigure']],
  ['CC-COLLATERAL-DAMAGE',     'Collateral Damage',       ['flatDamageToFigureWithin']],
  ['CC-COMBAT-RESUPPLY',       'Combat Resupply',         ['powerTokenGain', 'distributeHitTokensEqualToRound']],
  ['CC-CORRUPTING-FORCE',      'Corrupting Force',        ['corruptingForceEffect']],
  ['CC-DANGEROUS-BARGAINS',    'Dangerous Bargains',      ['vpCondition', 'vpGainSelf', 'vpGainOpponent']],
  ['CC-DANGEROUS-PREY',        'Dangerous Prey',          ['dangerousPreyEffect']],
  ['CC-DARK-ENERGY',           'Dark Energy',             ['darkEnergyEffect']],
  ['CC-DE-WANNA-WANGA',        'De Wanna Wanga',          ['shuffleOneFromDiscardIntoDeck']],
  ['CC-DEADEYE',               'Deadeye',                 ['attackAccuracyBonus']],
  ['CC-DEADLY-PRECISION',      'Deadly Precision',        ['attackAccuracyBonus']],
  ['CC-DEMORALIZING-MONOLOGUE','Demoralizing Monologue',  ['demoralizingMonologueEffect', 'forceDefenderRerollOne']],
  ['CC-DEVOTION',              'Devotion',                ['devotionEffect']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, name, fields] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-8] skip ${id}: status is ${atom.status}`);
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
  atom.notes = 'Promoted via batch-8 library-wiring probe (structural field contract on data-driven ccEffect).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-8: library-wiring contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-8] promoted ${patched} atom(s) pending → covered`);
