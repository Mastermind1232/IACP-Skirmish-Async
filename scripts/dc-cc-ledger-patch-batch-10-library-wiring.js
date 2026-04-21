#!/usr/bin/env node
/**
 * Batch-10 DC/CC ledger patch: 30 more data-driven CCs via library-wiring probe.
 * Probe: tests/domain/oracle/dc-cc-library-wiring-batch-10-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-wiring-batch-10-probe.test.js';

const PROMOTIONS = [
  ['CC-HOSTILE-NEGOTIATION',  'Hostile Negotiation',    ['discardRandomFromHand', 'opponentDiscardRandomFromHand']],
  ['CC-HOUR-OF-NEED',         'Hour of Need',           ['recoverDamageFromRound']],
  ['CC-HUNT-THEM-DOWN',       'Hunt Them Down',         ['attackAccuracyBonus', 'attackBonusSurgeAbilities']],
  ['CC-I-MAKE-MY-OWN-LUCK',   'I Make My Own Luck',     ['claimInitiative', 'firstActivationFigureName']],
  ['CC-I-MUST-GO-ALONE',      'I Must Go Alone',        ['roundDefenderCannotBeTargetedUnlessWithinSpaces']],
  ['CC-INDUCE-RAGE',          'Induce Rage',            ['induceRageEffect']],
  ['CC-INSPIRING-SPEECH',     'Inspiring Speech',       ['focusGainToAdjacentUpToN']],
  ['CC-INTELLIGENCE-LEAK',    'Intelligence Leak',      ['opponentDiscardFromHandChoice', 'selfStrainFromDiscardedCost']],
  ['CC-IRON-WILL',            'Iron Will',              ['maxDamageFromAttack']],
  ['CC-JUNDLAND-TERROR',      'Jundland Terror',        ['jundlandTerrorEffect']],
  ['CC-JUST-BUSINESS',        'Just Business',          ['roundAttackRerollDice']],
  ['CC-KNOWLEDGE-AND-DEFENSE','Knowledge and Defense',  ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['CC-LEARN-BY-EXAMPLE',     'Learn by Example',       ['learnByExampleEffect']],
  ['CC-LET-S-MAKE-A-DEAL',    "Let's Make a Deal",      ['letsMakeADealEffect']],
  ['CC-LOOKING-FOR-A-FIGHT',  'Looking for a Fight',    ['powerTokenGain', 'lookingForAFightChoice']],
  ['CC-LORD-OF-THE-SITH',     'Lord of the Sith',       ['lordOfTheSithEffect']],
  ['CC-LURE-OF-THE-DARK-SIDE','Lure of the Dark Side',  ['lureOfTheDarkSide']],
  ['CC-MANDALORIAN-STEEL',    'Mandalorian Steel',      ['setsMandaAsteel']],
  ['CC-MARKED-TERRITORY',     'Marked Territory',       ['powerTokenGain', 'conditionalExteriorPowerToken']],
  ['CC-MARKSMAN',             'Marksman',               ['nextAttackIgnoreFigureLOS']],
  ['CC-MERCILESS',            'Merciless',              ['opponentDiscardDeckTop', 'elseGainVp']],
  ['CC-MIRACLE-WORKER',       'Miracle Worker',         ['recoverDamage']],
  ['CC-MITIGATE',             'Mitigate',               ['rerollOneAttackDie']],
  ['CC-NAVIGATION-UPGRADE',   'Navigation Upgrade',     ['navigationUpgradeEffect']],
  ['CC-NEW-ORDERS',           'New Orders',             ['readyAdjacentFriendlyDeploymentCard']],
  ['CC-NO-CHEATING',          'No Cheating',            ['roundDebuffNextHostileActivation']],
  ['CC-ONE-IN-A-MILLION',     'One in a Million',       ['defensePoolRemoveAll', 'defensePoolRemoveOnlyWhenNotAttackerActivation']],
  ['CC-OPTIMAL-BOMBARDMENT',  'Optimal Bombardment',    ['optimalBombardmentEffect', 'blastBonusToAdjacentVehiclesDroidHW']],
  ['CC-OVERCHARGED-WEAPONS',  'Overcharged Weapons',    ['overchargedWeaponsEffect']],
  ['CC-OVERHEATED',           'Overheated',             ['overheatedEffect']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, name, fields] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-10] skip ${id}: status is ${atom.status}`);
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
  atom.notes = 'Promoted via batch-10 library-wiring probe.';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-10: library-wiring contracts',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-10] promoted ${patched} atom(s) pending → covered`);
