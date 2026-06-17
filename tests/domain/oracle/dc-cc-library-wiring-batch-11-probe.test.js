/**
 * Oracle batch-11: bulk library-wiring probe for data-driven ccEffect CCs.
 * Final batch of the library-wiring campaign — closes the remaining 53
 * pending CCs with the same contract. See batch-8 probe header for pattern.
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
  ['Pack Alpha',             ['packAlphaEffect']],
  ['Parry',                  ['applyDefenseBonusBlock']],
  ['Payback',                ['paybackEffect']],
  ['Personal Energy Shield', ['roundDefenderBonusBlockPerEvade', 'evadeTokenGain']],
  ['Pickpocket',             ['pickpocketVpByAccuracy']],
  ['Positioning Advantage',  ['attackBonusHits']],
  ['Prepared for Battle',    ['powerTokenGain', 'conditionalAdjacentLeaderPowerToken']],
  ['Preservation Protocol',  ['recoverDamage']],
  ['Protect the Old Ways',   ['protectOldWaysBonus']],
  ['Provoke',                ['provokeNextActivation']],
  ['Rally the Troops',       ['readyAdjacentFriendlyDeploymentCard']],
  ['Rapid Recalibration',    ['rerollOneAttackDie']],
  ['Rebel Graffiti',         ['rebelGraffitiVp']],
  ['Regroup',                ['discardHarmfulFromAdjacentFigures']],
  ['Reinforcements',         ['placeDefeatedFigure']],
  ['Repair',                 ['recoverDamageToAdjacent']],
  ['Reverse Engineer',       ['reverseEngineerEffect']],
  ['Right Back At Ya!',      ['rightBackAtYaEffect']],
  ['Roar',                   ['applyStunToUpToNAdjacentHostiles', 'onlyIfSufferedDamageGte']],
  ['Second Chance',          ['secondChanceEffect']],
  ['Self-Augmentation',      ['selfAugmentationEffect']],
  ['Set a Trap',             ['setATrapEffect']],
  ['Set the Charges',        ['setTheChargesEffect']],
  ['Shadow Ops',             ['opponentCannotPlayCCsThisRound']],
  ['Shoot the Messenger',    ['opponentDiscardDeckTop']],
  ['Signal Jammer',          ['signalJammer']],
  ['Single Purpose',         ['activationDoubleSpecialAction']],
  ['Sit Tight',              ['sitTightPlayerNum']],
  ['Slippery Target',        ['mpBonusFromSpeed']],
  ["Smuggler's Tricks",      ['roundSmugglersTricksPlayerNum']],
  ['Sniper Configuration',   ['attackAccuracyBonus', 'attackBonusPierce']],
  ['Spinning Kick',          ['attackBonusSurgeAbilities']],
  ['Squad Swarm',            ['squadSwarmPlayerNum']],
  ['Stall for Time',         ['opponentHandRandomToDeckTop']],
  ['Static Pulse',           ['staticPulseEffect']],
  ['Stealth Tactics',        ['defenseBonusDice', 'defenseBonusDiceColor']],
  ['Stimulants',             ['stimulantsEffect']],
  ['Strategic Shift',        ['shuffleHandIntoDeckThenDraw']],
  ['Strength in Numbers',    ['strengthInNumbersPlayerNum']],
  ['Stroke of Brilliance',   ['applyDefenseBonusBlock', 'applyDefenseBonusEvade']],
  ['Support Specialist',     ['supportSpecialistEffect']],
  ['Targeting Network',      ['rerollOneAttackDie']],
  ['Telekinetic Throw',      ['telekineticThrowEffect']],
  ['Terminal Network',       ['setsTerminalControl']],
  ['Terminal Protocol',      ['terminalProtocolEffect']],
  ['Transmit the Plans',     ['grantHitTokensToActivating', 'vpNoteIfAdjacentTerminal']],
  ['Triangulate',            ['triangulateEffect', 'triangulateCountFriendlyDroids']],
  ['Unlimited Power',        ['setsUnlimitedPower']],
  ['Utinni!',                ['roundUtinniJawaBuffs']],
  ['Whistling Birds',        ['whistlingBirdsEffect']],
  ['Wild Fire',              ['defensePoolRemoveMax']],
  ['Windfall',               ['windfallOnPlay']],
  ['Wreak Vengeance',        ['setsWreakVengeance']],
];

describe('DC-CC batch-11: ccEffect library-wiring contracts (53 CCs)', () => {
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
