/**
 * Oracle batch-13: bulk library-wiring probe for data-driven ccEffect CCs.
 * Same contract as batch-8 probe.
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
  ['Disable',               ['disablesFigure']],
  ['Disarm',                ['chooseAdjacentHostileThen']],
  ['Disengage',             ['mpBonus']],
  ['Draw!',                 ['freeAttackBonus']],
  ['Dying Lunge',           ['mpBonus', 'freeAttackBonus', 'selfDefeatsAfterAttack', 'overrideAttackType']],
  ['Eerie Visage',          ['chooseAdjacentHostileThen']],
  ['Element of Surprise',   ['defensePoolRemoveMax', 'requireNoLosAtActivationStart']],
  ['Espionage Mastery',     ['returnDiscardToHand', 'draw']],
  ['Expose Weakness',       ['nextAttackBonusPierce']],
  ['Extra Protection',      ['mpBonus', 'freeAttackBonus']],
  ['Face to Face',          ['mpBonus', 'freeAttackBonus', 'overrideAttackType']],
  ['Fatal Deception',       ['falseOrdersUpgrade']],
  ['Final Stand',           ['powerTokenGain', 'freeAttackBonus', 'selfDefeatsAfterAttack', 'mpBonus']],
  ['Flurry of Blades',      ['freeAttackBonus']],
  ['Focus',                 ['applyFocus']],
  ['Fool Me Once',          ['clearOpponentDiscard', 'strainCostToSelf', 'draw', 'drawIfTrait']],
  ['Forbidden Knowledge',   ['draw']],
  ['Force Drain',           ['chooseAdjacentHostileThen']],
  ['Force Jump',            ['mpBonus', 'mobileMovement']],
  ['Force Lightning',       ['chooseAdjacentHostileThen']],
  ['Force Rush',            ['mpBonus']],
  ['Force Surge',           ['mpBonus', 'chooseAdjacentHostileThen']],
  ['Fuel Upgrade',          ['vehicleDefenseBonusEvadeRound', 'vehicleSpeedBonusRound']],
  // applyFocus removed 2026-06-26 (audit P11): it was inert/stale — the live
  // effect readies the DC. conditionalFocusIfDamagedGte stays (load-bearing).
  ['Furious Charge',        ['conditionalFocusIfDamagedGte']],
  ['Get Behind Me!',        ['mpBonus', 'attackTargetSwap', 'getsBehindMe']],
  ['Grisly Contest',        ['chooseAdjacentHostileThen']],
  ['Guild Programming',     ['applyFocus']],
  ['Heart of Freedom',      ['discardUpToNHarmful', 'recoverDamage', 'mpBonus']],
  ['Heavy Armor',           ['defenderIgnorePierce']],
  ['Hold Ground',           ['setsHoldGround']],
  ['Hunter Protocol',       ['surgeDoublingActive']],
  ['I Can Feel It',         ['chooseOne']],
  ['Improvised Weapons',    ['overrideAttackDice', 'overrideAttackType', 'freeAttackBonus', 'blockSurgeAbilities']],
  ['In the Shadows',        ['roundInTheShadowsPlayerNum']],
  ['Jump Jets',             ['placeSelfWithin']],
  ['Karabast!',             ['karabastEffect']],
  ['Lightbow',              ['freeAttackBonus', 'overrideAttackDice', 'overrideAttackType', 'overrideBonusAccuracy', 'blockSurgeAbilities', 'bonusSurgeAbilities']],
  ['Lock On',               ['chooseOne']],
  ['Mandalorian Tactics',   ['chooseOne']],
  ['Master Operative',      ['applyFocus', 'attackSurgeBonus']],
  ['Maximum Firepower',     ['nextAttacksBonusHits']],
  ['Meditation',            ['applyFocus', 'nextActivationFreeAttack']],
  ['Negation',              ['negateCostZeroCc']],
  ['Of No Importance',      ['nextDefeatedFriendlyVpReduction']],
  ["Officer's Training",    ['draw', 'drawIfTrait']],
  ['On a Mission',          ['mpBonus']],
  ['On the Lam',            ['mpBonusFromSpeed']],
  ['Opportunistic',         ['mpBonus']],
  ['Out of Time',           ['chooseAdjacentHostileThen']],
  ['Overrun',               ['overrunThisActivation']],
];

describe('DC-CC batch-13: ccEffect library-wiring contracts (50 CCs)', () => {
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
