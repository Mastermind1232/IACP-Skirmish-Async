/**
 * Oracle batch-10: bulk library-wiring probe for data-driven ccEffect CCs.
 * See batch-8 probe header for pattern rationale.
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
  ['Hostile Negotiation',    ['discardRandomFromHand', 'opponentDiscardRandomFromHand']],
  ['Hour of Need',           ['recoverDamageFromRound']],
  ['Hunt Them Down',         ['attackAccuracyBonus', 'attackBonusSurgeAbilities']],
  ['I Make My Own Luck',     ['claimInitiative', 'firstActivationFigureName']],
  ['I Must Go Alone',        ['roundDefenderCannotBeTargetedUnlessWithinSpaces']],
  ['Induce Rage',            ['induceRageEffect']],
  ['Inspiring Speech',       ['focusGainToAdjacentUpToN']],
  ['Intelligence Leak',      ['opponentDiscardFromHandChoice', 'selfStrainFromDiscardedCost']],
  ['Iron Will',              ['maxDamageFromAttack']],
  ['Jundland Terror',        ['jundlandTerrorEffect']],
  ['Just Business',          ['roundAttackRerollDice']],
  ['Knowledge and Defense',  ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['Learn by Example',       ['learnByExampleEffect']],
  ["Let's Make a Deal",      ['letsMakeADealEffect']],
  ['Looking for a Fight',    ['powerTokenGain', 'lookingForAFightChoice']],
  ['Lord of the Sith',       ['lordOfTheSithEffect']],
  ['Lure of the Dark Side',  ['lureOfTheDarkSide']],
  ['Mandalorian Steel',      ['setsMandaAsteel']],
  ['Marked Territory',       ['powerTokenGain', 'conditionalExteriorPowerToken']],
  ['Marksman',               ['nextAttackIgnoreFigureLOS']],
  ['Merciless',              ['opponentDiscardDeckTop', 'elseGainVp']],
  ['Miracle Worker',         ['recoverDamage']],
  ['Mitigate',               ['rerollOneAttackDie']],
  ['Navigation Upgrade',     ['navigationUpgradeEffect']],
  ['New Orders',             ['readyAdjacentFriendlyDeploymentCard', 'readyRequireWithinSpaces', 'readyAllowSameDc']],
  // 'No Cheating' (Asajj-only CC) removed 2026-05-06 — Asajj Ventress removed
  // from game per destruct 2026-05-05; Session 8.1-8.3 of combat-rebuild plan.
  ['One in a Million',       ['defensePoolRemoveAll', 'defensePoolRemoveOnlyWhenNotAttackerActivation']],
  ['Optimal Bombardment',    ['optimalBombardmentEffect', 'blastBonusToAdjacentVehiclesDroidHW']],
  ['Overcharged Weapons',    ['overchargedWeaponsEffect']],
  ['Overheated',             ['overheatedEffect']],
];

describe('DC-CC batch-10: ccEffect library-wiring contracts (30 CCs)', () => {
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
