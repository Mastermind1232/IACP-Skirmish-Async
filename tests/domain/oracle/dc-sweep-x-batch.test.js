/**
 * Card-text sweep, FINAL batch: Wampa (Regular), both Weequay Pirates, both
 * Wing Guards, both Wookiee Warriors, Yoda, Zeb Orrelios, Zuckuss.
 *
 * One defect, and it is the most consequential single-field error the sweep
 * found: Zeb Orrelios's base attack was typed MELEE. His card prints the
 * blaster icon.
 *
 * A melee base attack can only ever target an ADJACENT figure, so Zeb — a
 * 15-health, 8-cost unique — could not attack at range at all. The card's own
 * text corroborates it: "Bo-Rifle Staff Strike: Once during your activation,
 * you may perform a MELEE attack using 2 red dice". That qualifier is only
 * meaningful if the base attack is something else.
 *
 * The glyph was read against four known cards rather than in isolation, since
 * a lone icon is exactly what a downscaled sheet gets wrong.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

describe('Zeb Orrelios attacks at RANGE', () => {
  test('his base attack is ranged, not melee', () => {
    assert.deepEqual(dc['Zeb Orrelios'].attack, { dice: ['red', 'green'], type: 'range' });
  });

  test('his own Staff Strike text is why', () => {
    // A "perform a Melee attack" special only makes sense if the base is not.
    assert.match(dc['Zeb Orrelios'].abilityText,
      /Bo-Rifle Staff Strike: Once during your activation, you may perform a Melee attack using 2 red dice/);
  });

  test('the four cards his glyph was compared against still say what they said', () => {
    // The comparison is the evidence, so it is pinned with the finding.
    assert.equal(dc['The Mandalorian'].attack.type, 'range', 'same blaster glyph as Zeb');
    assert.equal(dc['Zuckuss'].attack.type, 'range', 'same blaster glyph as Zeb');
    assert.equal(dc['Wookiee Warrior (Elite)'].attack.type, 'melee', 'different, hilt glyph');
    assert.equal(dc['Wampa (Elite)'].attack.type, 'melee', 'different, hilt glyph');
  });

  test('melee attacks are range-clamped to adjacent, which is what he was losing', () => {
    const handlers = readFileSync(resolve(root, 'src/handlers/combat.js'), 'utf8');
    assert.match(handlers, /if \(overrideDice\.type === 'melee'\) attackInfo = \{ \.\.\.attackInfo, range: \[1, 1\] \};/);
  });

  test('the rest of his card was already right', () => {
    assert.equal(dc['Zeb Orrelios'].health, 15);
    assert.equal(dc['Zeb Orrelios'].speed, 4);
    assert.deepEqual(dc['Zeb Orrelios'].abilities, ['+3 Accuracy']);
    assert.deepEqual(dc['Zeb Orrelios'].surgeAbilities, ['damage 2', 'accuracy 2, recover 1']);
  });
});

describe('Habitat shows up a second time, and is still correctly absent', () => {
  test('Wampa (Regular) prints "Habitat: Snow" and we do not record it', () => {
    // Second instance after Tusken Raider (Regular)'s "Habitat: Desert". Both
    // are pre-IACP FFG printings; both cards' IACP-badged Elite counterparts
    // have no such row. Campaign content, not a skirmish mechanic.
    assert.ok(!/habitat/i.test(JSON.stringify(dc['Wampa (Regular)'])));
    assert.ok(!/habitat/i.test(JSON.stringify(dc['Wampa (Elite)'])));
  });

  test('the two Wampas differ only where the cards differ', () => {
    assert.deepEqual(dc['Wampa (Regular)'].abilities, ['+1 damage']);
    assert.deepEqual(dc['Wampa (Elite)'].abilities, ['+2 damage']);
    assert.deepEqual(dc['Wampa (Regular)'].surgeAbilities, ['stun', 'cleave 2']);
    assert.deepEqual(dc['Wampa (Elite)'].surgeAbilities, ['cleave 3', 'weaken, stun']);
    assert.deepEqual(dc['Wampa (Regular)'].passives, ['Efficient Travel']);
    assert.deepEqual(dc['Wampa (Elite)'].passives, ['Reach', 'Efficient Travel'], 'only the Elite has Reach');
  });
});

describe('the rest of the final batch', () => {
  test('both Weequay Pirates: innate accuracy one step apart', () => {
    assert.deepEqual(dc['Weequay Pirate (Elite)'].abilities, ['+2 Accuracy']);
    assert.deepEqual(dc['Weequay Pirate (Regular)'].abilities, ['+1 Accuracy']);
    assert.deepEqual(dc['Weequay Pirate (Elite)'].surgeAbilities, ['damage 2', 'pierce 1', 'accuracy 2']);
    assert.deepEqual(dc['Weequay Pirate (Regular)'].surgeAbilities, ['damage 1', 'accuracy 1']);
    assert.match(dc['Weequay Pirate (Elite)'].abilityText, /Prowl\): You become Hidden\./, 'Elite-only');
    assert.ok(!/Prowl/.test(dc['Weequay Pirate (Regular)'].abilityText));
  });

  test('both Wing Guards: no innate band, and different Keep the Peace wording', () => {
    for (const n of ['Wing Guard (Elite)', 'Wing Guard (Regular)']) {
      assert.ok(!dc[n].abilities, `${n} has no innate`);
    }
    assert.deepEqual(dc['Wing Guard (Elite)'].surgeAbilities, ['accuracy 3', 'damage 2']);
    assert.deepEqual(dc['Wing Guard (Regular)'].surgeAbilities, ['damage 1', 'recover 1']);
    // The Elite's version costs the ATTACKER a strain; the Regular's costs the
    // Wing Guard one and is optional. Genuinely different abilities.
    assert.match(dc['Wing Guard (Elite)'].abilityText, /the attacker suffers 1 Strain/);
    assert.match(dc['Wing Guard (Regular)'].abilityText, /you may suffer 1 Strain/);
  });

  test('both Wookiee Warriors share Fury and differ by one damage step', () => {
    assert.deepEqual(dc['Wookiee Warrior (Elite)'].abilities, ['Fury']);
    assert.deepEqual(dc['Wookiee Warrior (Regular)'].abilities, ['Fury']);
    assert.deepEqual(dc['Wookiee Warrior (Elite)'].surgeAbilities, ['damage 2', 'bleed', 'cleave 2']);
    assert.deepEqual(dc['Wookiee Warrior (Regular)'].surgeAbilities, ['damage 1', 'bleed', 'cleave 2']);
  });

  test('Zuckuss: two innates and four surges', () => {
    assert.deepEqual(dc['Zuckuss'].abilities, ['Mystic Hunter', '+2 Accuracy']);
    assert.deepEqual(dc['Zuckuss'].surgeAbilities, ['accuracy 3', 'damage 2', 'pierce 2', 'stun_net']);
  });

  test('Yoda has no attack at all, and stays on the do-not-correct list', () => {
    assert.ok(!dc['Yoda'].attack, 'the card prints a dash');
    assert.deepEqual(dc['Yoda'].defense, ['white']);
    const dcnext = readFileSync('/Users/adammeehan/skirbo-listener/audit/dcnext.py', 'utf8');
    assert.match(dcnext, /'Yoda'/, 'still listed as do-not-correct');
  });
});
