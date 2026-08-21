/**
 * Oracle batch-7: library-shape probes for 10 data-driven CC effects.
 *
 * These CCs are consumed via structured fields on their `data/ability-library.json`
 * entries — the field names and shapes ARE the contract the card text implies.
 * If a field is renamed, removed, or mistyped, the handler stops honoring the
 * card even when nothing else looks broken. Each describe block pins:
 *
 *   1. The library entry exists at `abilities[<name>]`.
 *   2. `type === 'ccEffect'` and `wiredStatus === 'wired'`.
 *   3. The card-text-bearing fields are present with the expected shape/value.
 *
 * A data-shape probe is sufficient coverage because the handler side is a
 * thin dispatcher: handler-path tests would merely re-verify the same field.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_PATH = resolve(__dirname, '../../../data/ability-library.json');
const lib = JSON.parse(readFileSync(LIB_PATH, 'utf8'));

function entryOf(name) {
  const e = lib.abilities?.[name];
  assert.ok(e, `ability-library entry missing for ${name}`);
  return e;
}

describe('DC-CC batch-7: ccEffect library-shape contracts', () => {
  it('A Powerful Influence — interactBlockRange + controlBlockRange both = 3', () => {
    const e = entryOf('A Powerful Influence');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.interactBlockRange, 3);
    assert.equal(e.controlBlockRange, 3);
  });

  it('Balancing Force — balancingForceEffect flag set', () => {
    const e = entryOf('Balancing Force');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.balancingForceEffect, true);
  });

  it('Behind Enemy Lines — revealsOpponentDeckTop = 3', () => {
    const e = entryOf('Behind Enemy Lines');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.revealsOpponentDeckTop, 3);
  });

  it('Blend In — blendInAttach flag set (untargetable attachment on K-2SO)', () => {
    const e = entryOf('Blend In');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.blendInAttach, true);
  });

  it('Camouflage — applyHideWhenDefending flag set (defensive Hidden)', () => {
    const e = entryOf('Camouflage');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.applyHideWhenDefending, true);
  });

  it('Cheat to Win — cheatToWinEffect flag set (choose any face on Gambit die)', () => {
    const e = entryOf('Cheat to Win');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.cheatToWinEffect, true);
  });

  it('Close the Gap — grantMpToFriendliesByKeyword pins BRAWLER/mp:2 + armor token', () => {
    const e = entryOf('Close the Gap');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.deepEqual(e.grantMpToFriendliesByKeyword, {
      keyword: 'BRAWLER',
      mp: 2,
      grantBlockToken: true,
    });
  });

  it('Collect Intel — revealsOpponentHand flag set', () => {
    const e = entryOf('Collect Intel');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.revealsOpponentHand, true);
  });

  it('Coordinated Attack — coordinatedAttackEffect flag set', () => {
    const e = entryOf('Coordinated Attack');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.coordinatedAttackEffect, true);
  });

  it('Data Theft — stealsFromOpponentDiscard flag set', () => {
    const e = entryOf('Data Theft');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.stealsFromOpponentDiscard, true);
  });

  it('Deploy the Garrison! — deployGarrisonEffect flag set', () => {
    const e = entryOf('Deploy the Garrison!');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.deployGarrisonEffect, true);
  });

  it('Double or Nothing — doubleOrNothingEffect + doubleMatchingIconsOnReroll both true', () => {
    const e = entryOf('Double or Nothing');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.doubleOrNothingEffect, true);
    assert.equal(e.doubleMatchingIconsOnReroll, true);
  });

  it('Efficient Travel — roundEfficientTravel flag set', () => {
    const e = entryOf('Efficient Travel');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.roundEfficientTravel, true);
  });

  it('Emergency Aid — recover 2 normally, 3 if GUARDIAN/LEADER', () => {
    const e = entryOf('Emergency Aid');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.equal(e.recoverDamageToAdjacent, 2);
    assert.deepEqual(e.recoverDamageToAdjacentIfTrait, { GUARDIAN: 3, LEADER: 3 });
  });

  it('Endless Reserves — placeDefeatedFigure pins TROOPER/sameGroup/shuffle-back', () => {
    const e = entryOf('Endless Reserves');
    assert.equal(e.type, 'ccEffect');
    assert.equal(e.wiredStatus, 'wired');
    assert.deepEqual(e.placeDefeatedFigure, {
      traitFilter: ['TROOPER'],
      placementAnchor: 'sameGroup',
      shuffleBackToDeck: true,
    });
  });
});
