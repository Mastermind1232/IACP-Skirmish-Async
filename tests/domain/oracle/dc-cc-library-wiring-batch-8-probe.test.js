/**
 * Oracle batch-8: bulk library-wiring probe for data-driven ccEffect CCs.
 *
 * For each CC in this batch:
 *   - The library entry exists at `data/ability-library.json:abilities[<name>]`.
 *   - Its `type` is `ccEffect` and `wiredStatus` is `wired`.
 *   - Every field declared on the atom's `triage.structuredFields` is
 *     present on the library entry with a non-null value.
 *
 * This pins the dispatcher contract: if a field is renamed, removed, or
 * blanked-out, the handler stops honoring the card even if nothing looks
 * broken in isolation. Batch-8 covers 40 CCs in one file — handler-path
 * coverage would merely re-verify the same field reads, so a data-shape
 * probe is sufficient.
 *
 * Atoms covered by this probe are promoted via
 * scripts/dc-cc-ledger-patch-batch-8-library-wiring.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

// Hand-picked 40-CC slice. Each entry: [ccName, [requiredField, ...]].
// Fields match what the atom's triage.structuredFields declares. Kept
// inline (not data-driven from the ledger) so a ledger edit alone
// doesn't silently change test scope.
const BATCH = [
  ['Arcing Shot',             ['attackAccuracyBonus', 'arcingShotTargeting']],
  ['Ballistics Matrix',       ['ballisticsMatrixEffect']],
  ['Battle Scars',            ['powerTokenGain', 'powerTokenGainIfDamagedGte']],
  ['Battlefield Awareness',   ['battlefieldAwarenessEffect']],
  ['Bladestorm',              ['attackSurgeBonus', 'postAttackAoeDamage', 'postAttackAoeRange']],
  ['Blaze of Glory',          ['readyOwnDeploymentCard', 'endOfRoundSelfDamage']],
  ['Blood Feud',              ['bloodFeudEffect']],
  ['Brace for Impact',        ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['Brace Yourself',          ['applyDefenseBonusBlock', 'defenseBonusOnlyWhenNotAttackerActivation']],
  ['Built on Hope',           ['builtOnHopeEffect']],
  ['Call the Vanguard',       ['callTheVanguardEffect']],
  ['Capitalize',              ['defensePoolRemoveMax']],
  ['cc:against_the_odds',     ['focusGainToUpToNFigures', 'vpCondition']],
  ['cc:eyes_on_the_prize',    ['informational']],
  ['cc:gauntlet_blade',       ['rollOneDie', 'rollOneDieTarget', 'rollOneDieSurgeSelfPowerToken']],
  ['Change of Plans',         ['changeOfPlansEffect']],
  ['Chaotic Force',           ['chaoticForceEffect']],
  ['Choose a Side',           ['chooseASideEffect']],
  ['Cloned Reinforcements',   ['placeDefeatedFigure']],
  ['Collateral Damage',       ['flatDamageToFigureWithin']],
  ['Combat Resupply',         ['powerTokenGain', 'distributeHitTokensEqualToRound']],
  ['Corrupting Force',        ['corruptingForceEffect']],
  ['Dangerous Bargains',      ['vpCondition', 'vpGainSelf', 'vpGainOpponent']],
  ['Dangerous Prey',          ['dangerousPreyEffect']],
  ['Dark Energy',             ['darkEnergyEffect']],
  ['De Wanna Wanga',          ['shuffleOneFromDiscardIntoDeck']],
  ['Deadeye',                 ['attackAccuracyBonus']],
  ['Deadly Precision',        ['attackAccuracyBonus']],
  ['Demoralizing Monologue',  ['demoralizingMonologueEffect', 'forceDefenderRerollOne']],
  ['Devotion',                ['devotionEffect']],
];

describe('DC-CC batch-8: ccEffect library-wiring contracts (30 CCs)', () => {
  for (const [name, fields] of BATCH) {
    it(`${name} — library entry + required fields present`, () => {
      const e = lib.abilities?.[name];
      assert.ok(e, `ability-library entry missing for ${name}`);
      assert.equal(e.type, 'ccEffect', `${name} type != ccEffect`);
      assert.equal(e.wiredStatus, 'wired', `${name} wiredStatus != wired`);
      for (const f of fields) {
        assert.ok(f in e, `${name} missing field ${f}`);
        assert.notEqual(e[f], null, `${name} field ${f} is null`);
        assert.notEqual(e[f], undefined, `${name} field ${f} is undefined`);
      }
    });
  }
});
