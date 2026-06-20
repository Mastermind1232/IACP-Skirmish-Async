/**
 * Oracle batch-9: bulk library-wiring probe for data-driven ccEffect CCs.
 *
 * See batch-8 probe header for pattern rationale. This file covers the
 * next 30 pending CCs with the same contract: library entry exists,
 * type=ccEffect, wiredStatus=wired, and each declared structured field
 * is present with a non-null value.
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
  ['Droid Mastery',           ['droidMasteryEffect']],
  ['Elusive',                 ['elusiveEffect']],
  ['Escalating Hostility',    ['defenderStrain', 'defenderStrainPlusDiscardCopies']],
  ['Etiquette and Protocol',  ['etiquetteAndProtocolEffect']],
  ['Evacuate',                ['evacuateEffect']],
  ['Explosive Weaponry',      ['attackBonusBlast']],
  ['Face Me!',                ['faceMeEffect']],
  ['Feint',                   ['feintEffect']],
  ['Feral Swipes',            ['feralSwipesEffect']],
  ['Ferocity',                ['ferocityEffect']],
  ['Field Promotion',         ['celebrationVp', 'increaseArmyCostBy']],
  ['Field Supply',            ['fieldSupplyEffect']],
  ['Field Tactician',         ['fieldTacticianEffect']],
  ['Findsman Meditation',     ['findsmanMeditationEffect']],
  ['Force Illusion',          ['applyHideWhenDefending']],
  ['Force Push',              ['forcePushEffect']],
  ['Foresee',                 ['foreseeEffect']],
  ['Forward March',           ['grantMpToFriendliesWithin2']],
  ['Glory of the Kill',       ['recoverDamage']],
  ['Grenadier',               ['rollOneDie', 'rollOneDieTarget', 'rollOneDieRange']],
  ['Guardian Stance',         ['defenderRerollDiceMax']],
  ['Guerilla Warfare',        ['applyBlockAndHideToIsolatedFriendlies']],
  ['Hard to Hit',             ['applyDefenseBonusEvade']],
  ['Harsh Environment',       ['informational', 'setsHarshEnvironment']],
  ['Heavy Ordnance',          ['attackBonusHits']],
  ['Heightened Reflexes',     ['removeDefenseDieResults']],
  ['Hidden Trap',             ['hiddenTrapEffect']],
  ['Hide in Plain Sight',     ['untargetableUntilRoundEnd']],
  ['Hit and Run',             ['mpAfterAttack']],
  ['Honoring the Fallen',     ['attackBonusHitsFromDefeatedFriendly', 'attackBonusHitsFromDefeatedMax']],
];

describe('DC-CC batch-9: ccEffect library-wiring contracts (30 CCs)', () => {
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
