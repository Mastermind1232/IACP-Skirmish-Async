/**
 * Oracle batch-12: bulk library-wiring probe for data-driven ccEffect CCs
 * that had discovery-tier test hits but still needed library-shape coverage.
 * Same contract as batch-8. Adds structural-field pins on top of whatever
 * existing tests touched these CCs by name.
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
  ["All in a Day's Work",  ['applyFocus', 'extraActionBonus']],
  ['Ambush',               ['mpBonus', 'chooseAdjacentHostileThen']],
  ['Apex Predator',        ['applyFocus', 'applyHide', 'powerTokenGain', 'mpBonus', 'recoverOnHostileDefeat', 'recoverOnHostileDefeatRange']],
  ['Armed Escort',         ['roundDefenseBonusEvade']],
  ['Assassinate',          ['attackBonusHits', 'mutualExcludeAttackCc']],
  ['Beatdown',             ['nextAttacksBonusHits']],
  ['Black Market Prices',  ['draw', 'drawThenDiscardOneGainVp']],
  ['Blitz',                ['attackSurgeBonus']],
  ['Bodyguard',            ['attackTargetSwap']],
  ['Burst Fire',           ['freeAttackBonus']],
  ['Capture the Weary',    ['chooseAdjacentHostileThen']],
  ['Cavalry Charge',       ['roundDefenseBonusBlock', 'trooperRoundAttackHitBonus']],
  ['Adrenaline',        ['timing', 'adrenalineEffect']],
  ['Advance Warning',   ['advanceWarningEffect']],
  ['Dioxis Fumes',      ['dioxisFumesEffect']],
  ['Fleet Footed',      ['mpBonus']],
  ['Celebration',          ['celebrationVp']],
  ['Close and Personal',   ['mpBonus', 'freeAttackBonus', 'overrideAttackDice', 'overrideAttackType', 'overrideAttackPierce', 'blockSurgeAbilities', 'bonusSurgeAbilities']],
  ['Comm Disruption',      ['commDisruptionEffect']],
  ['Counter Attack',       ['chooseAdjacentHostileThen']],
  ['Cripple',              ['cripplesFigure']],
  ['Cruel Strike',         ['nextAttackBonusSurgeAbilities', 'freeAttackBonus']],
  ['Crush',                ['chooseAdjacentHostileThen']],
  ['Cut Lines',            ['noCommandDrawThisRound']],
  ['Deathblow',            ['attackBonusHits', 'requiresMeleeAttack', 'bonusHitVsRangedDefender']],
  ['Debts Repaid',         ['applyFocus', 'readyActiveDc']],
  ["Definition: 'Love'",   ['freeAttackBonus', 'attackOverrideOpts']],
  ['Deflection',           ['roundDeflectionAccuracyPenalty', 'deflectionCounterDamage', 'deflectionCounterUnconditional', 'deflectionRangedOnly']],
  ['Desperate Escape',     ['mpBonus']],
  ['Dirty Trick',          ['chooseAdjacentHostileThen']],
];

describe('DC-CC batch-12: ccEffect library-wiring contracts (30 CCs)', () => {
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
