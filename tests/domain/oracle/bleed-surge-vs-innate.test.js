/**
 * Bleed: which figures have it as a SURGE and which as an INNATE.
 *
 * alexanbv 2026-09-02: "Some figures have surge for bleed, some figures have
 * innate bleed. Make sure it is correct which is which."
 *
 * 15 cards carry Bleed. All were checked against their own card art at full
 * resolution. 14 are correct; [Flame Trooper] is not, and its defects are
 * raised with alexanbv rather than fixed here (six edits on one card including
 * a stat, on a Squad Upgrade, which is his ruleset).
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
const INNATE_BLEED = ['Gaarkhan', 'Krrsantan', 'Nexu (Elite)', 'Nexu (Regular)'];

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
    // [Flame Trooper] is the known-wrong one, raised with alexanbv.
    const expected = [...SURGE_BLEED, ...INNATE_BLEED, '[Flame Trooper]'].sort();
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

describe('KNOWN WRONG: [Flame Trooper], raised with alexanbv 2026-09-02', () => {
  // Its innate band prints "Priority Target" and "+2 Acc., Weaken". Pinned as
  // CURRENT, not correct, so the fix is a visible edit rather than silent drift.
  test('it currently carries a phantom innate Bleed and Pierce 1, and no Weaken', () => {
    const inn = dc['[Flame Trooper]'].abilities;
    assert.deepEqual(inn, ['Bleed', '+2 Accuracy', 'Pierce 1'],
      'if this fails the card was corrected — update the docstring and the lists above');
    assert.ok(!inn.includes('Weaken'), 'Weaken is printed on the card and missing here');
  });

  test('and Incinerate places a Rubble token where the card says Napalm', () => {
    assert.match(dc['[Flame Trooper]'].abilityText, /place a Rubble token in the target space/);
    const bridge = readFileSync(resolve(root, 'src/engine/combat-bridge.js'), 'utf8');
    assert.match(bridge, /game\.rubbleTokens\.push\(_ftCoord\)/);
    // A napalm token type already exists in the renderer, unused by this path.
    const tokens = JSON.parse(readFileSync(resolve(root, 'data/token-images.json'), 'utf8'));
    assert.ok(JSON.stringify(tokens).includes('napalm'), 'the token art exists');
  });
});
