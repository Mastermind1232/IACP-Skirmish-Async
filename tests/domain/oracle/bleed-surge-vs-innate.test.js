/**
 * Bleed: which figures have it as a SURGE and which as an INNATE.
 *
 * alexanbv 2026-09-02: "Some figures have surge for bleed, some figures have
 * innate bleed. Make sure it is correct which is which."
 *
 * 15 cards carry Bleed, and after alexanbv posted the current Flametrooper
 * card, ALL 15 are correctly classified. 10 as a surge, 5 as an innate.
 *
 * I initially reported [Flame Trooper] as wrong on six points. Every one was
 * the local art being stale, not the data. That is the second time in a day,
 * and the tell is volume: a cluster of independent mismatches on ONE card means
 * stale art, where a single isolated mismatch usually means a real defect.
 *
 * Three of the surge cards carry Bleed inside a COMBO surge rather than alone.
 * That matters because a combo splitter that dropped the second half would be
 * invisible in the data — the entry still says "bleed" — so those three are
 * asserted through the parser, not just the string.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSurgeEffect } from '../../../src/game/combat.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = (() => {
  const d = JSON.parse(readFileSync(resolve(root, 'data/dc-effects.json'), 'utf8'));
  return d.cards || d;
})();

const hasBleed = (arr) => (arr || []).some((x) => /bleed/i.test(String(x)));
const surges = (n) => dc[n].surgeAbilities || [];
const innates = (n) => [...(dc[n].abilities || []), ...(dc[n].passives || [])];

const SURGE_BLEED = [
  'Greedo', 'Royal Guard Champion', 'Taron Malicos',
  'Trandoshan Hunter (Elite)', 'Trandoshan Hunter (Regular)',
  'Ugnaught Tinkerer (Elite)', 'Ugnaught Tinkerer (Regular)',
  'Vinto Hreeda', 'Wookiee Warrior (Elite)', 'Wookiee Warrior (Regular)',
];
const INNATE_BLEED = ['Gaarkhan', 'Krrsantan', 'Nexu (Elite)', 'Nexu (Regular)', '[Flame Trooper]'];

describe('surge Bleed', () => {
  for (const n of SURGE_BLEED) {
    test(`${n}: Bleed is a surge and NOT an innate`, () => {
      assert.ok(hasBleed(surges(n)), `${n} surges: ${JSON.stringify(surges(n))}`);
      assert.ok(!hasBleed(innates(n)), `${n} innates: ${JSON.stringify(innates(n))}`);
    });
  }
});

describe('innate Bleed', () => {
  for (const n of INNATE_BLEED) {
    test(`${n}: Bleed is an innate and NOT a surge`, () => {
      assert.ok(hasBleed(innates(n)), `${n} innates: ${JSON.stringify(innates(n))}`);
      assert.ok(!hasBleed(surges(n)), `${n} surges: ${JSON.stringify(surges(n))}`);
    });
  }
});

describe('no card has it both ways', () => {
  test('the two lists are exhaustive and disjoint', () => {
    const all = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object' && (hasBleed(v.surgeAbilities) || hasBleed([...(v.abilities || []), ...(v.passives || [])])))
      .map(([k]) => k).sort();
    const expected = [...SURGE_BLEED, ...INNATE_BLEED].sort();
    assert.deepEqual(all, expected, 'a new Bleed card appeared — classify it against its art');
  });

  test('and none carries it in both buckets', () => {
    const both = Object.entries(dc)
      .filter(([, v]) => v && typeof v === 'object'
        && hasBleed(v.surgeAbilities) && hasBleed([...(v.abilities || []), ...(v.passives || [])]))
      .map(([k]) => k);
    assert.deepEqual(both, []);
  });
});

describe('the three COMBO surges keep both halves', () => {
  // The data string still says "bleed" even if the splitter drops it, so these
  // go through the parser rather than asserting on the entry.
  const combos = {
    'Trandoshan Hunter (Elite)': ['damage 1, bleed', { damage: 1 }],
    'Vinto Hreeda': ['pierce 2, bleed', { pierce: 2 }],
  };
  for (const [card, [key, other]] of Object.entries(combos)) {
    test(`${card}: "${key}" yields Bleed AND its partner`, () => {
      assert.ok(surges(card).includes(key), `${card} surges: ${JSON.stringify(surges(card))}`);
      const out = parseSurgeEffect(key);
      assert.ok((out.conditions || []).includes('Bleed'), `conditions: ${JSON.stringify(out.conditions)}`);
      for (const [f, v] of Object.entries(other)) assert.equal(out[f], v, `${f} half`);
    });
  }

  test('a bare "bleed" surge yields only the condition', () => {
    const out = parseSurgeEffect('bleed');
    assert.ok((out.conditions || []).includes('Bleed'));
    assert.equal(out.damage, 0);
    assert.equal(out.pierce, 0);
  });
});

describe('[Flame Trooper] — our data was RIGHT; the local art was stale', () => {
  // I reported six defects on this card. alexanbv posted the current IACP
  // Approved version and every one of them was the stale art, not the data:
  //
  //   innate band  Priority Target | Bleed | +2 Acc., Pierce 1   <- matches ours
  //   surges       +2 Damage | Blast 1                            <- matches
  //   Health 8, Speed 4, black, red+green                         <- matches
  //   Incinerate places a RUBBLE token                            <- matches
  //   Fireproof has no Napalm sentence                            <- matches
  //
  // The module image we hold (images/DC Skirmish Upgrades/Flametrooper.png,
  // "IACP Season 6") shows Weaken instead of Bleed+Pierce, health 9, and a
  // Napalm token. alexanbv: "There is no such thing as napalm."
  //
  // So the Bleed audit is 15 of 15 correct, not 14. The only real defects were
  // two typos in Fireproof, fixed.
  test('Bleed IS an innate here, as the current card prints it', () => {
    assert.deepEqual(dc['[Flame Trooper]'].abilities, ['Bleed', '+2 Accuracy', 'Pierce 1']);
    assert.deepEqual(dc['[Flame Trooper]'].passives, ['Priority Target']);
    assert.ok(!hasBleed(dc['[Flame Trooper]'].surgeAbilities));
  });

  test('health 8 and the printed surges', () => {
    assert.equal(dc['[Flame Trooper]'].health, 8);
    assert.deepEqual(dc['[Flame Trooper]'].surgeAbilities, ['damage 2', 'blast 1']);
  });

  test('Incinerate places a RUBBLE token — Napalm does not exist', () => {
    assert.match(dc['[Flame Trooper]'].abilityText, /place a Rubble token in the target space/);
    const bridge = readFileSync(resolve(root, 'src/engine/combat-bridge.js'), 'utf8');
    assert.match(bridge, /game\.rubbleTokens\.push\(_ftCoord\)/);
    assert.ok(!/Napalm/i.test(dc['[Flame Trooper]'].abilityText));
  });

  test('Fireproof reads as printed, with the two typos fixed', () => {
    assert.match(dc['[Flame Trooper]'].abilityText,
      /Fireproof: You cannot suffer Strain\. You are unaffected by your own Blast and abilities with "Flamethrower" in their name\./);
  });
});
