/**
 * Card-text sweep, K batch: Jyn Erso, both Jyns, K-2SO, KX-Series, Kanan, Kayn.
 *
 * The stat lines and surge bands all matched. Three prose defects, one of which
 * described a stricter rule than either the card or our own code:
 *
 *   K-2SO's Continually Unexpected reads "any combination of 2 [Damage] and/or
 *   [Surge] tokens". Our text said "2 Damage Tokens or 2 Surge Tokens", which
 *   reads as needing two of a single type. The CODE was right all along
 *   (`hitCount + surgeCount < 2`), so a player reading the card in the bot would
 *   have been told they could not use an ability the engine would have allowed.
 *
 * KX-Series Security Droid is on the do-not-correct list and is left alone: its
 * printed art is the 12.0 playtest ("move up to 2 spaces") and our data carries
 * alexanbv's later revision ("up to 6 spaces" plus the SMALL push clause).
 * Correcting toward the image would regress a working card.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilitiesForCard } from '../../../src/engine/combat-ability-db.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();
const rowsFor = (c) => abilitiesForCard(c) || [];

describe('K-2SO — Continually Unexpected takes ANY two tokens', () => {
  test('the card text no longer says "2 of one type or 2 of the other"', () => {
    assert.match(dc['K-2S0'].abilityText,
      /Continually Unexpected\): If you have any combination of 2 Damage and\/or Surge Tokens/);
    assert.ok(!/2 Damage Tokens or 2 Surge Tokens/.test(dc['K-2S0'].abilityText));
  });

  test('the spec row agrees', () => {
    const row = rowsFor('K-2S0').find((r) => r.ability === 'Continually Unexpected');
    assert.match(row.conditional, /any combination of 2 Damage and\/or Surge Tokens/);
  });

  test('and the code really does SUM the two kinds', async () => {
    // This is the half that was already right, which is why the wrong text was
    // invisible: the engine allowed 1+1 while the card text in the bot did not.
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const run = (tokens) => {
      const game = {
        p1DcList: [{ dcName: 'K-2S0' }],
        p1DcMessageIds: ['m'],
        figurePositions: { 1: { 'K-2S0-1-0': 'c4' } },
        figurePowerTokens: { 'K-2S0-1-0': tokens },
        dcActionsData: { m: { selectedFigure: 0 } },
      };
      return resolveAbility('continually_unexpected', {
        game, playerNum: 1, msgId: 'm', meta: { dcName: 'K-2S0', playerNum: 1 },
      });
    };
    assert.equal(run(['Damage', 'Surge']).applied, true, 'one of each is "any combination of 2"');
    assert.equal(run(['Damage', 'Damage']).applied, true, 'two of a kind still qualifies');
    assert.equal(run(['Surge', 'Surge']).applied, true);
    assert.equal(run(['Damage']).applied, false, 'one token is not two');
    assert.equal(run(['Block', 'Evade']).applied, false, 'other token types do not count');
  });

  test('its stat line and surges are unchanged', () => {
    const k = dc['K-2S0'];
    assert.equal(k.health, 9);
    assert.equal(k.speed, 4);
    assert.deepEqual(k.attack, { dice: ['red', 'green', 'yellow'], type: 'melee' });
    assert.deepEqual(k.surgeAbilities, ['damage 2', 'accuracy 1, pierce 1']);
    assert.deepEqual(k.abilities, ['+2 Accuracy']);
  });
});

describe('Kanan Jarrus — two prose corrections', () => {
  test('Force Vision says "your activation"', () => {
    assert.match(dc['Kanan Jarrus'].abilityText, /Force Vision: At the start of your activation,/);
    assert.ok(!/start of you activation/.test(dc['Kanan Jarrus'].abilityText));
  });

  test('Soresu Form rerolls a DEFENSE die, and says so', () => {
    assert.match(dc['Kanan Jarrus'].abilityText, /it may reroll 1 defense die\./);
    const row = rowsFor('Kanan Jarrus').find((r) => r.ability === 'Soresu Form');
    assert.match(row.effect, /may reroll 1 defense die/);
    assert.equal(row.attack_side, 'defender', 'and it is registered on the defender side');
  });

  test('the conversion and the Strain cost are intact', () => {
    assert.match(dc['Kanan Jarrus'].abilityText,
      /convert each Dodge result to 2 Block and 1 Evade and, if that figure is not FORCE USER, you suffer 1 Strain/);
  });
});

describe('the rest of the K batch matches its art', () => {
  test('Jyn Erso: Pierce 1 innate, and Trust Goes Both Ways grants a SURGE token', () => {
    const j = dc['Jyn Erso'];
    assert.deepEqual(j.abilities, ['Pierce 1']);
    assert.deepEqual(j.surgeAbilities, ['accuracy 1, damage 1', 'damage 1']);
    assert.match(j.abilityText, /Recover 1 Damage and gain 1 Surge Token/,
      'the second badge is the surge squiggle, not another Damage token');
  });

  test('Jyn Odan: +1 Accuracy / +1 Damage innate, Stun+Pierce and Acc+Damage surges', () => {
    const j = dc['Jyn Odan'];
    assert.deepEqual(j.abilities, ['+1 Accuracy', '+1 damage']);
    assert.deepEqual(j.surgeAbilities, ['stun, pierce 1', 'accuracy 2, damage 2']);
    assert.match(j.abilityText, /Cunning: While defending, apply \+1 Block to the defense results for each Evade result/);
  });

  test('Kayn Somos: Squad Command is a surge, not a passive', () => {
    assert.deepEqual(dc['Kayn Somos'].surgeAbilities, ['damage 1', 'pierce 1', 'squad_command']);
    assert.match(dc['Kayn Somos'].abilityText, /Surge \(Squad Command\): Choose an adjacent friendly TROOPER\./);
  });

  test('KX-Series keeps alexanbv\'s revision, NOT the playtest art', () => {
    // The printed card says "move up to 2 spaces" and has no SMALL clause. Our
    // data is the later revision and must not be "corrected" toward the image.
    const kx = dc['KX-Series Security Droid (Elite)'];
    assert.match(kx.abilityText, /Shoulder Rush\): Move up to 6 spaces/);
    assert.match(kx.abilityText, /If that figure is SMALL, push it 1 space/);
    assert.deepEqual(kx.surgeAbilities, ['damage 1', 'weaken']);
  });
});
