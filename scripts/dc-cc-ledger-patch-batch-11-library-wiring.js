#!/usr/bin/env node
/**
 * Batch-11 DC/CC ledger patch: final 53 data-driven ccEffect CCs promoted via
 * the bulk library-wiring probe. Closes the ccEffect library-wiring campaign.
 * Probe: tests/domain/oracle/dc-cc-library-wiring-batch-11-probe.test.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_FILE = 'tests/domain/oracle/dc-cc-library-wiring-batch-11-probe.test.js';

const PROMOTIONS = [
  ['CC-PACK-ALPHA',             'Pack Alpha',             ['packAlphaEffect']],
  ['CC-PARRY',                  'Parry',                  ['applyDefenseBonusBlock']],
  ['CC-PAYBACK',                'Payback',                ['paybackEffect']],
  ['CC-PERSONAL-ENERGY-SHIELD', 'Personal Energy Shield', ['roundDefenderBonusBlockPerEvade', 'evadeTokenGain']],
  ['CC-PICKPOCKET',             'Pickpocket',             ['pickpocketVpByAccuracy']],
  ['CC-POSITIONING-ADVANTAGE',  'Positioning Advantage',  ['attackBonusHits']],
  ['CC-PREPARED-FOR-BATTLE',    'Prepared for Battle',    ['powerTokenGain', 'conditionalAdjacentLeaderPowerToken']],
  ['CC-PRESERVATION-PROTOCOL',  'Preservation Protocol',  ['recoverDamage']],
  ['CC-PROTECT-THE-OLD-WAYS',   'Protect the Old Ways',   ['protectOldWaysBonus']],
  ['CC-PROVOKE',                'Provoke',                ['provokeNextActivation']],
  ['CC-RALLY-THE-TROOPS',       'Rally the Troops',       ['readyAdjacentFriendlyDeploymentCard']],
  ['CC-RAPID-RECALIBRATION',    'Rapid Recalibration',    ['rerollOneAttackDie']],
  ['CC-REBEL-GRAFFITI',         'Rebel Graffiti',         ['rebelGraffitiVp']],
  ['CC-REGROUP',                'Regroup',                ['discardHarmfulFromAdjacentFigures']],
  ['CC-REINFORCEMENTS',         'Reinforcements',         ['placeDefeatedFigure']],
  ['CC-REPAIR',                 'Repair',                 ['recoverDamageToAdjacent']],
  ['CC-REVERSE-ENGINEER',       'Reverse Engineer',       ['reverseEngineerEffect']],
  ['CC-RIGHT-BACK-AT-YA',       'Right Back At Ya!',      ['rightBackAtYaEffect']],
  ['CC-ROAR',                   'Roar',                   ['applyStunToUpToNAdjacentHostiles', 'onlyIfSufferedDamageGte']],
  ['CC-SECOND-CHANCE',          'Second Chance',          ['secondChanceEffect']],
  ['CC-SELF-AUGMENTATION',      'Self-Augmentation',      ['selfAugmentationEffect']],
  ['CC-SET-A-TRAP',             'Set a Trap',             ['setATrapEffect']],
  ['CC-SET-THE-CHARGES',        'Set the Charges',        ['setTheChargesEffect']],
  ['CC-SHADOW-OPS',             'Shadow Ops',             ['opponentCannotPlayCCsThisRound']],
  ['CC-SHOOT-THE-MESSENGER',    'Shoot the Messenger',    ['opponentDiscardDeckTop']],
  ['CC-SIGNAL-JAMMER',          'Signal Jammer',          ['signalJammer']],
  ['CC-SINGLE-PURPOSE',         'Single Purpose',         ['activationDoubleSpecialAction']],
  ['CC-SIT-TIGHT',              'Sit Tight',              ['sitTightPlayerNum']],
  ['CC-SLIPPERY-TARGET',        'Slippery Target',        ['mpBonusFromSpeed']],
  ['CC-SMUGGLER-S-TRICKS',      "Smuggler's Tricks",      ['roundSmugglersTricksPlayerNum']],
  ['CC-SNIPER-CONFIGURATION',   'Sniper Configuration',   ['attackAccuracyBonus', 'attackBonusPierce']],
  ['CC-SPINNING-KICK',          'Spinning Kick',          ['attackBonusSurgeAbilities']],
  ['CC-SQUAD-SWARM',            'Squad Swarm',            ['squadSwarmPlayerNum']],
  ['CC-STALL-FOR-TIME',         'Stall for Time',         ['opponentHandRandomToDeckTop']],
  ['CC-STATIC-PULSE',           'Static Pulse',           ['staticPulseEffect']],
  ['CC-STEALTH-TACTICS',        'Stealth Tactics',        ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['CC-STIMULANTS',             'Stimulants',             ['stimulantsEffect']],
  ['CC-STRATEGIC-SHIFT',        'Strategic Shift',        ['shuffleHandIntoDeckThenDraw']],
  ['CC-STRENGTH-IN-NUMBERS',    'Strength in Numbers',    ['strengthInNumbersPlayerNum']],
  ['CC-STROKE-OF-BRILLIANCE',   'Stroke of Brilliance',   ['applyDefenseBonusBlock', 'applyDefenseBonusEvade']],
  ['CC-SUPPORT-SPECIALIST',     'Support Specialist',     ['supportSpecialistEffect']],
  ['CC-TARGETING-NETWORK',      'Targeting Network',      ['rerollOneAttackDie']],
  ['CC-TELEKINETIC-THROW',      'Telekinetic Throw',      ['telekineticThrowEffect']],
  ['CC-TERMINAL-NETWORK',       'Terminal Network',       ['setsTerminalControl']],
  ['CC-TERMINAL-PROTOCOL',      'Terminal Protocol',      ['terminalProtocolEffect']],
  ['CC-TRANSMIT-THE-PLANS',     'Transmit the Plans',     ['grantHitTokensToActivating', 'vpNoteIfAdjacentTerminal']],
  ['CC-TRIANGULATE',            'Triangulate',            ['triangulateEffect', 'triangulateCountFriendlyDroids']],
  ['CC-UNLIMITED-POWER',        'Unlimited Power',        ['setsUnlimitedPower']],
  ['CC-UTINNI',                 'Utinni!',                ['roundUtinniJawaBuffs']],
  ['CC-WHISTLING-BIRDS',        'Whistling Birds',        ['whistlingBirdsEffect']],
  ['CC-WILD-FIRE',              'Wild Fire',              ['defensePoolRemoveMax']],
  ['CC-WINDFALL',               'Windfall',               ['setsWindfall']],
  ['CC-WREAK-VENGEANCE',        'Wreak Vengeance',        ['setsWreakVengeance']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;
for (const [id, name, fields] of PROMOTIONS) {
  const atom = ledger.atoms.find((a) => a.id === id);
  if (!atom) throw new Error(`atom ${id} not found`);
  if (atom.status !== 'pending') {
    console.log(`[batch-11] skip ${id}: status is ${atom.status}`);
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
  atom.notes = 'Promoted via batch-11 library-wiring probe (closes ccEffect campaign).';
  patched += 1;
}

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-11: library-wiring contracts (final)',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-11] promoted ${patched} atom(s) pending → covered`);
