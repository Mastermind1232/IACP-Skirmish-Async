#!/usr/bin/env node
/**
 * Batch-13 + Batch-14 DC/CC ledger patch: final 98 ccEffect CCs promoted via
 * the bulk library-wiring probes. This closes the ccEffect library-wiring
 * campaign — every wired data-driven CC with structured fields now has
 * library-shape coverage.
 *
 * Probes:
 *   - tests/domain/oracle/dc-cc-library-wiring-batch-13-probe.test.js  (50 CCs)
 *   - tests/domain/oracle/dc-cc-library-wiring-batch-14-probe.test.js  (48 CCs)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(ROOT, 'docs/dc-cc-ledger.json');
const PROBE_13 = 'tests/domain/oracle/dc-cc-library-wiring-batch-13-probe.test.js';
const PROBE_14 = 'tests/domain/oracle/dc-cc-library-wiring-batch-14-probe.test.js';

const PROMOTIONS_13 = [
  ['CC-DISABLE',              'Disable',               ['disablesFigure']],
  ['CC-DISARM',               'Disarm',                ['chooseAdjacentHostileThen']],
  ['CC-DISENGAGE',            'Disengage',             ['mpBonus']],
  ['CC-DRAW',                 'Draw!',                 ['nextAttacksBonusHits']],
  ['CC-DYING-LUNGE',          'Dying Lunge',           ['mpBonus', 'freeAttackBonus', 'selfDefeatsAfterAttack', 'overrideAttackType']],
  ['CC-EERIE-VISAGE',         'Eerie Visage',          ['chooseAdjacentHostileThen']],
  ['CC-ELEMENT-OF-SURPRISE',  'Element of Surprise',   ['defensePoolRemoveMax', 'requireNoLosAtActivationStart']],
  ['CC-ESPIONAGE-MASTERY',    'Espionage Mastery',     ['returnDiscardToHand', 'draw']],
  ['CC-EXPOSE-WEAKNESS',      'Expose Weakness',       ['nextAttackBonusPierce']],
  ['CC-EXTRA-PROTECTION',     'Extra Protection',      ['mpBonus', 'freeAttackBonus']],
  ['CC-FACE-TO-FACE',         'Face to Face',          ['mpBonus', 'freeAttackBonus', 'overrideAttackType']],
  ['CC-FATAL-DECEPTION',      'Fatal Deception',       ['applyFocus', 'falseOrdersUpgrade']],
  ['CC-FINAL-STAND',          'Final Stand',           ['powerTokenGain', 'freeAttackBonus', 'selfDefeatsAfterAttack', 'mpBonus', 'overrideAttackType']],
  ['CC-FLURRY-OF-BLADES',     'Flurry of Blades',      ['nextAttacksBonusHits']],
  ['CC-FOCUS',                'Focus',                 ['applyFocus']],
  ['CC-FOOL-ME-ONCE',         'Fool Me Once',          ['clearOpponentDiscard', 'strainCostToSelf', 'draw', 'drawIfTrait']],
  ['CC-FORBIDDEN-KNOWLEDGE',  'Forbidden Knowledge',   ['draw']],
  ['CC-FORCE-DRAIN',          'Force Drain',           ['chooseAdjacentHostileThen']],
  ['CC-FORCE-JUMP',           'Force Jump',            ['mpBonus', 'mobileMovement']],
  ['CC-FORCE-LIGHTNING',      'Force Lightning',       ['chooseAdjacentHostileThen']],
  ['CC-FORCE-RUSH',           'Force Rush',            ['mpBonus']],
  ['CC-FORCE-SURGE',          'Force Surge',           ['mpBonus', 'chooseAdjacentHostileThen']],
  ['CC-FUEL-UPGRADE',         'Fuel Upgrade',          ['roundDefenseBonusEvade', 'vehicleSpeedBonusRound']],
  ['CC-FURIOUS-CHARGE',       'Furious Charge',        ['applyFocus', 'conditionalFocusIfDamagedGte']],
  ['CC-GET-BEHIND-ME',        'Get Behind Me!',        ['mpBonus', 'attackTargetSwap', 'getsBehindMe']],
  ['CC-GRISLY-CONTEST',       'Grisly Contest',        ['chooseAdjacentHostileThen']],
  ['CC-GUILD-PROGRAMMING',    'Guild Programming',     ['applyFocus']],
  ['CC-HEART-OF-FREEDOM',     'Heart of Freedom',      ['discardUpToNHarmful', 'recoverDamage', 'mpBonus']],
  ['CC-HEAVY-ARMOR',          'Heavy Armor',           ['defenderIgnorePierce']],
  ['CC-HOLD-GROUND',          'Hold Ground',           ['setsHoldGround']],
  ['CC-HUNTER-PROTOCOL',      'Hunter Protocol',       ['attackSurgeBonus', 'surgeDoublingActive']],
  ['CC-I-CAN-FEEL-IT',        'I Can Feel It',         ['chooseOne']],
  ['CC-IMPROVISED-WEAPONS',   'Improvised Weapons',    ['overrideAttackDice', 'overrideAttackType', 'freeAttackBonus']],
  ['CC-IN-THE-SHADOWS',       'In the Shadows',        ['roundInTheShadowsPlayerNum']],
  ['CC-JUMP-JETS',            'Jump Jets',             ['mpBonus']],
  ['CC-KARABAST',             'Karabast!',             ['chooseAdjacentHostileThen']],
  ['CC-LIGHTBOW',             'Lightbow',              ['freeAttackBonus', 'overrideAttackDice', 'overrideAttackType', 'overrideBonusAccuracy']],
  ['CC-LOCK-ON',              'Lock On',               ['attackAccuracyBonus']],
  ['CC-MANDALORIAN-TACTICS',  'Mandalorian Tactics',   ['chooseOne']],
  ['CC-MASTER-OPERATIVE',     'Master Operative',      ['applyFocus', 'attackSurgeBonus']],
  ['CC-MAXIMUM-FIREPOWER',    'Maximum Firepower',     ['nextAttacksBonusHits']],
  ['CC-MEDITATION',           'Meditation',            ['applyFocus', 'nextActivationFreeAttack']],
  ['CC-NEGATION',             'Negation',              ['negateCostZeroCc']],
  ['CC-OF-NO-IMPORTANCE',     'Of No Importance',      ['nextDefeatedFriendlyVpReduction']],
  ['CC-OFFICER-S-TRAINING',   "Officer's Training",    ['draw', 'drawIfTrait']],
  ['CC-ON-A-MISSION',         'On a Mission',          ['mpBonus']],
  ['CC-ON-THE-LAM',           'On the Lam',            ['mpBonusFromSpeed']],
  ['CC-OPPORTUNISTIC',        'Opportunistic',         ['mpBonus']],
  ['CC-OUT-OF-TIME',          'Out of Time',           ['chooseAdjacentHostileThen']],
  ['CC-OVERRUN',              'Overrun',               ['overrunThisActivation']],
];

const PROMOTIONS_14 = [
  ['CC-OVERWHELMING-IMPACT',  'Overwhelming Impact',   ['bonusDamagePerDefenseDie', 'bonusSurgePerDefenseDie', 'ignoreDefenseResultsNotOnDice']],
  ['CC-PAID-IN-BESKAR',       'Paid in Beskar',        ['whenDefeatHostileWithin3GainBlockTokens']],
  ['CC-PARTING-BLOW',         'Parting Blow',          ['partingBlowEffect']],
  ['CC-PLANNING',             'Planning',              ['draw', 'discardIfNotTrait', 'discardFromDrawn']],
  ['CC-PRICE-OF-GLORY',       'Price of Glory',        ['discardUpToNHarmful', 'mpBonus', 'optionalPowerTokenOnConditionDiscard']],
  ['CC-PRICE-ON-THEIR-HEADS', 'Price on Their Heads',  ['setsBounty']],
  ['CC-PRIMARY-TARGET',       'Primary Target',        ['applyFocus', 'attackBonusHits', 'requireHighestCostTarget']],
  ['CC-PUMMEL',               'Pummel',                ['pummelTwoAttacksThisActivation']],
  ['CC-RALLY',                'Rally',                 ['discardHarmfulConditions']],
  ['CC-RANK-AND-FILE',        'Rank and File',         ['mpBonus', 'trooperMpBonusRound']],
  ['CC-REACTIVE-LOYALTIES',   'Reactive Loyalties',    ['chooseOne']],
  ['CC-RECOVERY',             'Recovery',              ['recoverDamage']],
  ['CC-REDUCE-TO-RUBBLE',     'Reduce to Rubble',      ['chooseAdjacentHostileThen', 'placeRubbleOnTargetAndAdjacent']],
  ['CC-REPOSITION',           'Reposition',            ['pushFriendlyWithin3Spaces']],
  ['CC-REST-IN-PEACE',        'Rest in Peace',         ['draw', 'restInPeaceEffect']],
  ['CC-RETALIATION',          'Retaliation',           ['chooseOne']],
  ['CC-RUN-FOR-COVER',        'Run for Cover',         ['attackPoolRemoveMax']],
  ['CC-SARLACC-SWEEP',        'Sarlacc Sweep',         ['freeAttackBonus', 'freeAttackBonusCount']],
  ['CC-SAVAGE-VIGOR',         'Savage Vigor',          ['attackPoolKeepMax']],
  ['CC-SELF-DEFENSE',         'Self-Defense',          ['chooseAdjacentHostileThen']],
  ['CC-SET-FOR-STUN',         'Set for Stun',          ['attackResultReplaceWithStun']],
  ['CC-SHARED-EXPERIENCE',    'Shared Experience',     ['mpCost', 'applyFocus']],
  ['CC-SIZE-ADVANTAGE',       'Size Advantage',        ['nextAttacksBonusHits', 'nextAttacksBonusConditions']],
  ['CC-SMOKE-GRENADE',        'Smoke Grenade',         ['chooseSpaceWithin2OfActivating', 'mpBonus']],
  ['CC-SMUGGLED-SUPPLIES',    'Smuggled Supplies',     ['chooseOne']],
  ['CC-SON-OF-SKYWALKER',     'Son of Skywalker',      ['readyOwnDeploymentCard']],
  ['CC-STAY-DOWN',            'Stay Down',             ['freeAttackBonus']],
  ['CC-STILL-FASTER-THAN-YOU','Still Faster Than You', ['setsStillFaster']],
  ['CC-SUPERCHARGE',          'Supercharge',           ['attackPoolAddYellowUntilTotal', 'superchargeStrainAfterAttack']],
  ['CC-SURVIVAL-INSTINCTS',   'Survival Instincts',    ['roundDefenseBonusBlock', 'roundDefenseBonusEvade']],
  ['CC-TAKE-COVER',           'Take Cover',            ['roundDefenseBonusBlock', 'roundDefenseAccuracyPenalty']],
  ['CC-TAKE-INITIATIVE',      'Take Initiative',       ['claimInitiative', 'exhaustOneDeploymentCard']],
  ['CC-TAKE-IT-DOWN',         'Take it Down',          ['nextAttacksBonusHits']],
  ['CC-TAKE-POSITION',        'Take Position',         ['roundDefenseBonusBlock']],
  ['CC-THERE-IS-ANOTHER',     'There is Another',      ['draw']],
  ['CC-THERE-IS-NO-TRY',      'There Is No Try',       ['setsTherIsNoTry']],
  ['CC-TO-THE-LIMIT',         'To the Limit',          ['activationExtraActionThenStun']],
  ['CC-TOOLS-FOR-THE-JOB',    'Tools for the Job',     ['attackBonusDice']],
  ['CC-TOUGH-LUCK',           'Tough Luck',            ['setsToughLuck']],
  ['CC-TOXIC-DART',           'Toxic Dart',            ['chooseAdjacentHostileThen']],
  ['CC-TRANDOSHAN-TERROR',    'Trandoshan Terror',     ['attackBonusDice', 'attackBonusDiceColor']],
  ['CC-URGENCY',              'Urgency',               ['mpBonusFromSpeed', 'mustSpendAll']],
  ['CC-VANISH',               'Vanish',                ['vanishImmunityUntilNextActivation', 'nextActivationMpBonus']],
  ['CC-VETERAN-INSTINCTS',    'Veteran Instincts',     ['powerTokenGain', 'vetInstinctsActiveThisActivation']],
  ['CC-WILD-ATTACK',          'Wild Attack',           ['attackBonusDice', 'attackBonusDiceColor', 'defenseBonusDiceFromAttacker', 'defenseBonusDiceFromAttackerColor']],
  ['CC-WILD-FURY',            'Wild Fury',             ['applyFocus', 'freeAttackBonusCount', 'postActivationConditions']],
  ['CC-WORTH-EVERY-CREDIT',   'Worth Every Credit',    ['discardUpToNHarmful', 'mpBonus', 'nextHostileDefeatVpBonus']],
  ['CC-YOU-WILL-NOT-DENY-ME', 'You Will Not Deny Me',  ['setsYouWillNotDenyMe']],
];

const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
let patched = 0;

function apply(promotions, probeFile, batchTag) {
  let count = 0;
  for (const [id, name, fields] of promotions) {
    const atom = ledger.atoms.find((a) => a.id === id);
    if (!atom) throw new Error(`atom ${id} not found`);
    if (atom.status !== 'pending') {
      console.log(`[${batchTag}] skip ${id}: status is ${atom.status}`);
      continue;
    }
    const implRefFiles = Object.keys(atom.triage?.implRefs || {});
    atom.status = 'covered';
    atom.implHint = `Library-wiring coverage in ${probeFile} pins structured fields on abilities['${name}'].`;
    atom.evidence = {
      files: [...new Set([...implRefFiles, 'data/ability-library.json', probeFile])].sort(),
      assertions: [
        `abilities['${name}'] exists with type=ccEffect, wiredStatus=wired`,
        ...fields.map(f => `field '${f}' present and non-null`),
      ],
    };
    atom.reviewedBy = { name: 'claude-opus-4-7', date: '2026-04-21' };
    atom.notes = `Promoted via ${batchTag} library-wiring probe.`;
    count += 1;
  }
  return count;
}

patched += apply(PROMOTIONS_13, PROBE_13, 'batch-13');
patched += apply(PROMOTIONS_14, PROBE_14, 'batch-14');

ledger._meta = {
  ...ledger._meta,
  lastManualPatch: {
    at: new Date().toISOString(),
    batch: 'dc-cc-batch-13+14: library-wiring contracts (ccEffect campaign close)',
    patched,
  },
};

writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
console.log(`[dc-cc-ledger-patch-13-14] promoted ${patched} atom(s) pending → covered`);
