/**
 * Every figure-restricted Command Card must name a figure that actually exists.
 *
 * A unique CC is gated by `playableBy` naming its owner's Deployment Card. If
 * the two files spell the name differently, the matcher returns false and the
 * card is UNPLAYABLE BY ITS OWN FIGURE, silently — nothing throws, the card just
 * never appears as legal.
 *
 * Found 2026-08-31 during the Deployment Card sweep. Two cards were dead:
 *
 *   Karabast!        playableBy "Zeb Orellios"  vs DC key "Zeb Orrelios"
 *   Guerilla Warfare playableBy "Saw Gerrera"   vs DC key "Saw Gerrerra"
 *
 * The printed cards read "Zeb Orrelios" and "Saw Gerrera", so Karabast! was the
 * misspelled side and the Saw Gerrerra DC KEY was the misspelled side. Both are
 * fixed: alexanbv approved the rename on 2026-08-31 ("all of saw stuff should be
 * Saw Gerrera spelling"), so the key was renamed across dc-effects.json,
 * dc-images.json, figure-images.json, figure-sizes.json, destruct-test-decks.json
 * and docs/combat-spec.csv. The image FILE names on disk still read "Gerrerra",
 * so the paths those maps point at were deliberately left alone.
 *
 * AWAITING_RENAME is now empty and should stay that way — an entry in it is a
 * card that cannot be played by its own figure.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccPlayableByMatches } from '../../../src/game/cc-timing.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const load = (f) => {
  const d = JSON.parse(readFileSync(resolve(root, f), 'utf8'));
  return d.cards || d;
};

/**
 * A playableBy value is a TRAIT restriction (not a figure) when every word in it
 * is a known trait, affiliation or size word. The vocabulary is derived from the
 * keywords the Deployment Cards actually declare, so it stays correct as cards
 * are added.
 *
 * This deliberately avoids an "all caps" heuristic: figure names like K-2SO,
 * C-3PO, BT-1, IG-88, HK-47, R2-D2 and 0-0-0 have no lowercase letters either,
 * and excluding them by case is exactly what let two dead cards sit unnoticed.
 */
function buildTraitVocabulary(dc) {
  const words = new Set(['imperial', 'rebel', 'scum', 'mercenary', 'small', 'large', 'massive', 'unique', 'figure', 'readied', 'ready', 'non-massive', 'any']);
  for (const card of Object.values(dc)) {
    for (const k of (card?.keywords || [])) {
      for (const w of String(k).toLowerCase().split(/\s+/)) words.add(w);
    }
    for (const pssv of (card?.passives || [])) {
      const v = String(pssv).toLowerCase();
      if (v === 'mobile' || v === 'massive') words.add(v);
    }
  }
  return words;
}

/**
 * Known-broken, awaiting a designer decision. Keep this EMPTY if you can — an
 * entry here is a card that cannot be played by its own figure.
 */
const AWAITING_RENAME = new Set();

describe('figure-restricted CCs name a real Deployment Card', () => {
  const cc = load('data/cc-effects.json');
  const dc = load('data/dc-effects.json');
  const dcNames = Object.keys(dc);

  const traitWords = buildTraitVocabulary(dc);
  const isTrait = (pb) => {
    const v = pb.toLowerCase();
    if (/\bor\b/.test(v)) return true;   // "BRAWLER or GUARDIAN", '"Iden Versio" or "Dio"'
    return v.split(/\s+/).every((w) => traitWords.has(w));
  };

  const figureRestricted = Object.entries(cc)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => [k, String(v.playableBy || '').trim()])
    .filter(([, pb]) => pb && !isTrait(pb));

  test('the scan actually finds figure-restricted cards (guards against a vacuous pass)', () => {
    assert.ok(figureRestricted.length > 20, `expected many figure-restricted CCs, got ${figureRestricted.length}`);
  });

  for (const [card, playableBy] of figureRestricted) {
    test(`${card} — "${playableBy}" resolves to a figure`, () => {
      const matched = dcNames.some((dcName) => ccPlayableByMatches(playableBy, dcName, dcName));
      if (AWAITING_RENAME.has(card)) {
        assert.ok(
          !matched,
          `${card} now resolves — the DC rename landed, so remove it from AWAITING_RENAME`,
        );
        return;
      }
      assert.ok(
        matched,
        `${card} is restricted to "${playableBy}", which matches no Deployment Card. `
        + 'The card is unplayable by its own figure. Check the spelling in both files.',
      );
    });
  }
});
