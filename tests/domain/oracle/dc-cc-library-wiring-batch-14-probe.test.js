/**
 * Oracle batch-14: final ccEffect library-wiring probe.
 * Closes the ccEffect library-wiring campaign — all wired data-driven CCs
 * now have library-shape coverage. Same contract as batch-8.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

const BATCH = [
  ['Overwhelming Impact',   ['bonusDamagePerDefenseDie', 'bonusSurgePerDefenseDie', 'ignoreDefenseResultsNotOnDice']],
  ['Paid in Beskar',        ['whenDefeatHostileWithin3GainBlockTokens']],
  ['Parting Blow',          ['partingBlowEffect']],
  ['Planning',              ['draw', 'discardIfNotTrait', 'discardFromDrawn']],
  ['Price of Glory',        ['discardUpToNHarmful', 'mpBonus', 'optionalPowerTokenOnConditionDiscard']],
  ['Price on Their Heads',  ['setsBounty']],
  ['Primary Target',        ['applyFocus', 'attackBonusHits', 'requireHighestCostTarget']],
  ['Pummel',                ['pummelTwoAttacksThisActivation']],
  ['Rally',                 ['discardHarmfulConditions']],
  ['Rank and File',         ['mpBonus', 'trooperMpBonusRound']],
  ['Reactive Loyalties',    ['chooseOne']],
  ['Recovery',              ['recoverDamage']],
  ['Reduce to Rubble',      ['chooseAdjacentHostileThen', 'placeRubbleOnTargetAndAdjacent']],
  ['Reposition',            ['pushFriendlyWithin3Spaces']],
  ['Rest in Peace',         ['draw', 'restInPeaceEffect']],
  ['Retaliation',           ['chooseOne']],
  ['Run for Cover',         ['attackPoolRemoveMax']],
  ['Sarlacc Sweep',         ['freeAttackBonus', 'freeAttackBonusCount']],
  ['Savage Vigor',          ['attackPoolKeepMax']],
  ['Self-Defense',          ['chooseAdjacentHostileThen']],
  ['Set for Stun',          ['attackResultReplaceWithStun']],
  ['Shared Experience',     ['mpCost', 'applyFocus']],
  ['Size Advantage',        ['nextAttacksBonusHits', 'nextAttacksBonusConditions']],
  ['Smoke Grenade',         ['chooseSpaceWithin2OfActivating', 'mpBonus']],
  ['Smuggled Supplies',     ['chooseOne']],
  ['Son of Skywalker',      ['readyOwnDeploymentCard']],
  ['Stay Down',             ['freeAttackBonus']],
  ['Still Faster Than You', ['setsStillFaster']],
  ['Supercharge',           ['attackPoolAddYellowUntilTotal', 'superchargeStrainAfterAttack']],
  ['Survival Instincts',    ['roundDefenseBonusBlock', 'roundDefenseBonusEvade']],
  ['Take Cover',            ['roundDefenseBonusBlock', 'roundDefenseAccuracyPenalty']],
  ['Take Initiative',       ['claimInitiative', 'exhaustOneDeploymentCard']],
  ['Take it Down',          ['nextAttacksBonusHits']],
  ['Take Position',         ['roundDefenseBonusBlock']],
  ['There is Another',      ['draw']],
  ['There Is No Try',       ['setsTherIsNoTry']],
  ['To the Limit',          ['activationExtraActionThenStun']],
  ['Tools for the Job',     ['attackBonusDice']],
  ['Tough Luck',            ['reactionOnly', 'reactionTrigger']],
  ['Toxic Dart',            ['chooseAdjacentHostileThen']],
  ['Trandoshan Terror',     ['attackBonusDice', 'attackBonusDiceColor']],
  ['Urgency',               ['mpBonusFromSpeed']],
  ['Vanish',                ['vanishImmunityUntilNextActivation', 'nextActivationMpBonus']],
  ['Veteran Instincts',     ['powerTokenGain']],
  ['Wild Attack',           ['attackBonusDice', 'attackBonusDiceColor', 'defenseBonusDiceFromAttacker', 'defenseBonusDiceFromAttackerColor']],
  ['Wild Fury',             ['applyFocus', 'freeAttackBonusCount', 'postActivationConditions']],
  ['Worth Every Credit',    ['discardUpToNHarmful', 'mpBonus', 'nextHostileDefeatVpBonus']],
  ['You Will Not Deny Me',  ['setsYouWillNotDenyMe']],
];

describe('DC-CC batch-14: ccEffect library-wiring contracts (48 CCs)', () => {
  for (const [name, fields] of BATCH) {
    it(`${name} — library entry + required fields present`, () => {
      const e = lib.abilities?.[name];
      assert.ok(e, `ability-library entry missing for ${name}`);
      assert.equal(e.type, 'ccEffect');
      assert.equal(e.wiredStatus, 'wired');
      for (const f of fields) {
        assert.ok(f in e, `${name} missing field ${f}`);
        assert.notEqual(e[f], null, `${name} field ${f} is null`);
        assert.notEqual(e[f], undefined, `${name} field ${f} is undefined`);
      }
    });
  }
});
