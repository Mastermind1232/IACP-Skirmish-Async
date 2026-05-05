/**
 * Regression test for dice.json canonical face values.
 *
 * Background: 2026-05-04 — destruct caught a phantom +1 accuracy on the
 * yellow die's 6th face during a live BT-1 attack roll. Audit found three
 * faces in `data/dice.json` disagreed with `data/dice-face-outcomes.json`
 * (the Symbol Labeling Tool reference, derived from the actual VASSAL
 * dice-face images):
 *   - yellow face 6: had +1 phantom accuracy
 *   - white face 2 + face 4: wrong block/evade distribution
 *   - black face 1: had a blank face (canonical IA black has no blank)
 *
 * After fixing those, this test locks in the canonical values so a future
 * edit to dice.json can't silently drift again. The expected values match
 * dice-face-outcomes.json exactly.
 *
 * To regenerate the reference snapshot if the canonical values change
 * (e.g., an IACP errata): update both this file's expected arrays AND
 * data/dice-face-outcomes.json AND data/dice.json together. Asymmetric
 * updates will fail this test.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const DICE = JSON.parse(readFileSync(join(ROOT, 'data/dice.json'), 'utf8'));

// Canonical FFG Imperial Assault dice (post-IACP white-die dodge errata).
// Each array is in face order 1-6 (zero-indexed in the array).
const CANONICAL = {
  attack: {
    red: [
      { acc: 0, dmg: 1, surge: 0 }, // +1 Hit
      { acc: 0, dmg: 2, surge: 0 }, // +2 Hit
      { acc: 0, dmg: 2, surge: 0 }, // +2 Hit
      { acc: 0, dmg: 2, surge: 1 }, // +2 Hit, +1 Surge
      { acc: 0, dmg: 3, surge: 0 }, // +3 Hit
      { acc: 0, dmg: 3, surge: 0 }, // +3 Hit
    ],
    yellow: [
      { acc: 0, dmg: 0, surge: 1 }, // +1 Surge
      { acc: 2, dmg: 0, surge: 1 }, // +2 Accuracy, +1 Surge
      { acc: 2, dmg: 1, surge: 0 }, // +2 Accuracy, +1 Hit
      { acc: 1, dmg: 1, surge: 1 }, // +1 Accuracy, +1 Hit, +1 Surge
      { acc: 1, dmg: 2, surge: 0 }, // +1 Accuracy, +2 Hit
      { acc: 0, dmg: 1, surge: 2 }, // +1 Hit, +2 Surge (no accuracy)
    ],
    green: [
      { acc: 1, dmg: 0, surge: 1 }, // +1 Accuracy, +1 Surge
      { acc: 1, dmg: 1, surge: 1 }, // +1 Accuracy, +1 Hit, +1 Surge
      { acc: 2, dmg: 1, surge: 1 }, // +2 Accuracy, +1 Hit, +1 Surge
      { acc: 3, dmg: 2, surge: 0 }, // +3 Accuracy, +2 Hit
      { acc: 1, dmg: 2, surge: 0 }, // +1 Accuracy, +2 Hit
      { acc: 2, dmg: 2, surge: 0 }, // +2 Accuracy, +2 Hit
    ],
    blue: [
      { acc: 2, dmg: 0, surge: 1 }, // +2 Accuracy, +1 Surge
      { acc: 2, dmg: 1, surge: 0 }, // +2 Accuracy, +1 Hit
      { acc: 5, dmg: 1, surge: 0 }, // +5 Accuracy, +1 Hit
      { acc: 3, dmg: 1, surge: 1 }, // +3 Accuracy, +1 Hit, +1 Surge
      { acc: 3, dmg: 2, surge: 0 }, // +3 Accuracy, +2 Hit
      { acc: 4, dmg: 2, surge: 0 }, // +4 Accuracy, +2 Hit
    ],
  },
  defense: {
    white: [
      { block: 0, evade: 0 },             // blank
      { block: 0, evade: 1 },             // +1 Evade
      { block: 1, evade: 0 },             // +1 Block
      { block: 1, evade: 1 },             // +1 Block, +1 Evade
      { block: 1, evade: 1 },             // +1 Block, +1 Evade
      { block: 0, evade: 0, dodge: true }, // Dodge (post-IACP errata; was 2 Block)
    ],
    black: [
      { block: 1, evade: 0 }, // +1 Block (no blank face — black die canonical)
      { block: 1, evade: 0 }, // +1 Block
      { block: 2, evade: 0 }, // +2 Block
      { block: 2, evade: 0 }, // +2 Block
      { block: 3, evade: 0 }, // +3 Block
      { block: 0, evade: 1 }, // +1 Evade
    ],
  },
};

describe('dice.json — canonical face values', () => {
  for (const color of ['red', 'yellow', 'green', 'blue']) {
    describe(`${color} attack die`, () => {
      for (let i = 0; i < 6; i++) {
        it(`face ${i + 1}`, () => {
          assert.deepEqual(DICE.attack[color][i], CANONICAL.attack[color][i]);
        });
      }
    });
  }

  for (const color of ['white', 'black']) {
    describe(`${color} defense die`, () => {
      for (let i = 0; i < 6; i++) {
        it(`face ${i + 1}`, () => {
          assert.deepEqual(DICE.defense[color][i], CANONICAL.defense[color][i]);
        });
      }
    });
  }
});

describe('dice.json — totals (anti-drift sanity)', () => {
  it('yellow has 6 total accuracy across all faces (locked in 2026-05-04 fix)', () => {
    const total = DICE.attack.yellow.reduce((s, f) => s + f.acc, 0);
    assert.equal(total, 6);
  });

  it('white has 3 total block + 3 total evade + 1 dodge across all faces', () => {
    const block = DICE.defense.white.reduce((s, f) => s + (f.block || 0), 0);
    const evade = DICE.defense.white.reduce((s, f) => s + (f.evade || 0), 0);
    const dodge = DICE.defense.white.filter(f => f.dodge).length;
    assert.equal(block, 3, 'white block total');
    assert.equal(evade, 3, 'white evade total');
    assert.equal(dodge, 1, 'white dodge count');
  });

  it('black has 9 total block + 1 evade across all faces (no blank face)', () => {
    const block = DICE.defense.black.reduce((s, f) => s + (f.block || 0), 0);
    const evade = DICE.defense.black.reduce((s, f) => s + (f.evade || 0), 0);
    const blank = DICE.defense.black.filter(f => !f.block && !f.evade && !f.dodge).length;
    assert.equal(block, 9);
    assert.equal(evade, 1);
    assert.equal(blank, 0, 'black die has no blank face');
  });
});
