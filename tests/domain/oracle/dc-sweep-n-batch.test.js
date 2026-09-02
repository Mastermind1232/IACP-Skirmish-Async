/**
 * Card-text sweep, N batch: Mara Jade, Maul, Migs Mayfeld, Moff Gideon,
 * Murne Rin, Nexu (Elite).
 *
 * One prose defect, and one open question left for alexanbv.
 *
 * Murne's Figurehead reads, glyph by glyph: "Before a friendly figure within 4
 * spaces suffers [Strain], you may suffer 1 [Damage] to prevent 1 of that
 * [Strain]" — the middle symbol is the outline star, not the hexagon.
 *
 * Our prose said the TRIGGER was "Damage or Strain", which contradicted both
 * the card and alexanbv's own 2026-06-19 ruling ("Figurehead is for STRAIN not
 * damage") that the spec row and the strain pipeline already follow. Fixed.
 *
 * The COST is left alone pending a ruling: the card says suffer 1 Damage, the
 * handler charges 1 Strain. That is not a cosmetic difference — Strain-for-
 * Strain is close to a no-op transfer, while Damage is what actually kills her.
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
const lib = JSON.parse(readFileSync(resolve(root, 'data/ability-library.json'), 'utf8')).abilities;

describe('Murne Rin — Figurehead triggers on Strain only', () => {
  test('the card text no longer says "Damage or Strain"', () => {
    assert.match(dc['Murne Rin'].abilityText,
      /Figurehead: Before a friendly figure within 4 spaces suffers Strain, you may suffer 1 Damage to prevent 1 of that Strain\./);
    assert.ok(!/suffers Damage or Strain/.test(dc['Murne Rin'].abilityText));
  });

  test('the library description agrees', () => {
    assert.match(lib.figurehead.description, /suffers Strain, you may suffer 1 Damage/);
    assert.ok(!/Damage or Strain/.test(lib.figurehead.description));
  });

  test('the spec row already carried the ruling, and still does', () => {
    const row = (abilitiesForCard('Murne Rin') || []).find((r) => r.ability === 'Figurehead');
    assert.equal(row.timing, 'when_suffers_strain');
    assert.match(row.notes, /STRAIN ONLY — no damage \(alexanbv 2026-06-19/);
  });

  test('the trigger really is wired into the strain pipeline, not the damage one', () => {
    const src = readFileSync(resolve(root, 'src/handlers/strain-handler.js'), 'utf8');
    assert.match(src, /export async function handleFigureheadStrainDecision/);
  });

  test('OPEN: the handler charges Strain where the card prints Damage', () => {
    // Pinned deliberately as the CURRENT behaviour, not as the correct one, so
    // that when alexanbv rules the change is a visible edit rather than a
    // silent drift. See the docstring.
    const src = readFileSync(resolve(root, 'src/handlers/strain-handler.js'), 'utf8');
    assert.match(src, /suffers \*\*1 Strain\*\* to prevent \*\*1\*\* of/,
      'if this fails, the cost was changed — update the docstring and this test together');
  });

  test('the rest of Murne matches', () => {
    const m = dc['Murne Rin'];
    assert.deepEqual(m.surgeAbilities, ['damage 2', 'accuracy 2', 'hide']);
    assert.deepEqual(m.abilities, ['+2 Accuracy']);
    assert.equal(m.health, 9);
  });
});

describe('Maul — Stalk Prey grants a Damage TOKEN', () => {
  test('the two glyphs sit on adjacent lines of his own card', () => {
    // Dual-Bladed Fury's "Cleave 2 [outline star]" and Stalk Prey's "1 [filled
    // badge]" are one line apart, which is what makes the distinction legible.
    assert.match(dc['Maul'].abilityText, /This attack gains Reach and Cleave 2/);
    assert.match(dc['Maul'].abilityText, /you gain 2 movement points and 1 Damage Token/);
  });

  test('his innate and surges match', () => {
    assert.deepEqual(dc['Maul'].abilities, ['+1 damage']);
    assert.deepEqual(dc['Maul'].surgeAbilities, ['pierce 3', 'stalk_prey']);
  });
});

describe('the rest of the batch matches its art', () => {
  test('Migs Mayfeld: Locked and Loaded grants "?" through the four-face prompt', () => {
    assert.match(dc['Migs Mayfeld'].abilityText, /After you resolve an attack, gain 2 Power Tokens\./);
    const fire = readFileSync(resolve(root, 'src/handlers/after-attack-fire.js'), 'utf8');
    assert.match(fire, /const btns = \['Damage', 'Surge', 'Block', 'Evade'\]\.map/,
      'alexanbv 2026-09-02: "? Is always any of the 4"');
  });

  test('Mara Jade: Professional is in the keyword bucket', () => {
    assert.deepEqual(dc['Mara Jade'].passives, ['Professional']);
    assert.deepEqual(dc['Mara Jade'].surgeAbilities, ['damage 2', 'pierce 3']);
  });

  test('Moff Gideon: Block 1 innate, +1 Damage and Pierce 3 surges', () => {
    assert.deepEqual(dc['Moff Gideon'].abilities, ['Block 1']);
    assert.deepEqual(dc['Moff Gideon'].surgeAbilities, ['damage 1', 'pierce 3']);
  });

  test('Nexu (Elite): Mobile keyword, Bleed and Cleave 2 innates', () => {
    const n = dc['Nexu (Elite)'];
    assert.deepEqual(n.passives, ['Mobile']);
    assert.deepEqual(n.abilities, ['Bleed', 'Cleave 2']);
    assert.deepEqual(n.surgeAbilities, ['damage 2']);
    assert.equal(n.speed, 6);
    assert.match(n.abilityText, /Non-Sentient: You cannot interact\./);
  });
});
