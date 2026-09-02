/**
 * The O/0 droid-name ambiguity, and the half of it that was still live.
 *
 * The Deployment Cards are keyed "C-3P0" and "K-2S0" with a DIGIT ZERO. The
 * Command Cards restricted to them say "C-3PO" and "K-2SO" with the LETTER O.
 * The glyphs are near-identical in the card font, so both spellings are in the
 * data and neither side misread anything.
 *
 * A fix on 2026-08-31 taught the CC LEGALITY gate (ccPlayableByMatches) to fold
 * the two together. It did not teach:
 *
 *   1. the figure PICKER (dcMatchesPlayableBy, used by handlers/cc-hand.js), so
 *      Blend In and Etiquette and Protocol became legal to play and then
 *      answered "No eligible Deployment Cards" for their own figure; or
 *   2. Blend In's own resolver, which compared `dc.dcName === 'K-2SO'` and
 *      `fk.startsWith('K-2SO-')` against a board full of "K-2S0".
 *
 * So the card was legal, unpickable, and would have bailed anyway. Nothing ever
 * threw. The lesson is the shape, not the card: a normalisation that lives at
 * one comparison site and not the others fixes exactly the symptom it was
 * written for.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldDroidDigits, isSameDcName } from '../../../src/game/dc-helpers.js';
import { dcMatchesPlayableBy } from '../../../src/game/player-helpers.js';
import { getDcEffects } from '../../../src/data-loader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const dc = getDcEffects();

describe('the fold itself', () => {
  test('folds both cases of O to zero and leaves everything else alone', () => {
    assert.equal(foldDroidDigits('K-2SO'), 'K-2S0');
    assert.equal(foldDroidDigits('C-3PO'), 'C-3P0');
    assert.equal(foldDroidDigits('K-2S0'), 'K-2S0', 'already-folded is a no-op');
    assert.equal(foldDroidDigits('Kanan Jarrus'), 'Kanan Jarrus');
    assert.equal(foldDroidDigits(''), '');
    assert.equal(foldDroidDigits(null), '', 'null must not throw or become "null"');
  });

  test('isSameDcName matches across the ambiguity and across name suffixes', () => {
    assert.ok(isSameDcName('K-2S0', 'K-2SO'));
    assert.ok(isSameDcName('C-3P0', 'C-3PO'));
    assert.ok(isSameDcName('K-2S0 [DG 1]', 'K-2SO'), 'a group suffix must not defeat it');
    assert.ok(isSameDcName('k-2s0', 'K-2SO'), 'case-insensitive');
  });

  test('and does NOT match two genuinely different cards', () => {
    assert.ok(!isSameDcName('K-2S0', 'C-3P0'));
    assert.ok(!isSameDcName('K-2S0', 'Kanan Jarrus'));
    assert.ok(!isSameDcName('', 'K-2SO'));
    assert.ok(!isSameDcName('K-2SO', null));
  });
});

describe('the database really is spelled with a zero', () => {
  // If someone later renames the keys, these flip and the fold becomes dead
  // weight rather than a silent no-op — which is the point of pinning it.
  test('the DC keys use a digit zero', () => {
    assert.ok(dc['K-2S0'], 'the deployment card is keyed with a zero');
    assert.ok(dc['C-3P0'], 'and so is C-3PO');
    assert.ok(!dc['K-2SO'], 'the letter-O spelling is NOT a key');
  });

  test('the Command Cards restricted to them use the letter O', () => {
    const cc = (() => {
      const d = JSON.parse(readFileSync(resolve(root, 'data/cc-effects.json'), 'utf8'));
      return d.cards || d;
    })();
    assert.equal(cc['Blend In'].playableBy, 'K-2SO');
    assert.equal(cc['Etiquette and Protocol'].playableBy, 'C-3PO');
  });
});

describe('the figure PICKER resolves both spellings', () => {
  const pick = (dcName, playableBy) =>
    dcMatchesPlayableBy(dcName, playableBy, getDcEffects, null, {}, dcName);

  test('Blend In finds K-2SO', () => {
    assert.ok(pick('K-2S0', 'K-2SO'), 'this returned false, so the picker offered nothing');
  });

  test('Etiquette and Protocol finds C-3PO', () => {
    assert.ok(pick('C-3P0', 'C-3PO'));
  });

  test('On a Mission finds Chopper, whose key carries a nickname', () => {
    assert.ok(pick('C1-10P "Chopper"', 'C1-10P'));
  });

  test('it still refuses a card the restriction does not name', () => {
    assert.ok(!pick('Kanan Jarrus', 'K-2SO'));
    assert.ok(!pick('C-3P0', 'K-2SO'), 'the two droids do not fold into each other');
  });

  test('every named-card restriction in cc-effects resolves to a real DC', () => {
    // The guard for the whole class. A playableBy naming a card that does not
    // exist makes that card unplayable and throws nothing.
    const cc = (() => {
      const d = JSON.parse(readFileSync(resolve(root, 'data/cc-effects.json'), 'utf8'));
      return d.cards || d;
    })();
    const keywords = new Set();
    for (const v of Object.values(dc)) {
      if (v && typeof v === 'object') for (const k of (v.keywords || [])) keywords.add(String(k).toUpperCase());
    }
    const CATEGORY = /^(any|non-|readied|unique|small|large|massive|friendly|hostile|your)\b/i;
    const AFFIL = new Set(['IMPERIAL', 'REBEL', 'SCUM', 'MERCENARY']);
    const unresolved = [];
    for (const [card, v] of Object.entries(cc)) {
      if (!v || typeof v !== 'object' || !v.playableBy) continue;
      for (const raw of String(v.playableBy).replace(/\s+or\s+/gi, ',').split(',')) {
        const p = raw.trim().replace(/^"|"$/g, '');
        if (!p || CATEGORY.test(p)) continue;
        // A phrase built only from keywords/affiliations is a trait restriction.
        const words = p.toUpperCase().split(/\s+/);
        if (words.every((w) => keywords.has(w) || AFFIL.has(w))) continue;
        if (words.length > 1 && keywords.has(words.slice(1).join(' '))) continue;
        if (!dcMatchesPlayableByAnyCard(p)) unresolved.push(`${card} -> "${p}"`);
      }
    }
    assert.deepEqual(unresolved, [], 'these restrictions name no card in the database');

    function dcMatchesPlayableByAnyCard(name) {
      return Object.keys(dc).some((k) => pick(k, name));
    }
  });
});

describe("Blend In's resolver no longer hardcodes a spelling", () => {
  test('it finds the DC and tags the figures under the zero spelling', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const game = {
      p1DcList: [{ dcName: 'K-2S0', displayName: 'K-2S0' }],
      p1DcMessageIds: ['msg_k2'],
      figurePositions: { 1: { 'K-2S0-1-0': 'c4', 'Kanan Jarrus-2-0': 'd4' } },
    };
    const res = resolveAbility('Blend In', { game, playerNum: 1 });
    assert.equal(res.applied, true, 'the old === against "K-2SO" bailed with "K-2SO is not in play"');
    assert.deepEqual(Object.keys(game.blendInUntargetable), ['K-2S0-1-0'],
      'K-2SO is tagged untargetable and Kanan is not');
    assert.deepEqual(game.p1DcAttachments?.msg_k2, ['Blend In']);
  });

  test('it still reports honestly when K-2SO is not in the army', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const game = {
      p1DcList: [{ dcName: 'Kanan Jarrus' }],
      p1DcMessageIds: ['msg_x'],
      figurePositions: { 1: { 'Kanan Jarrus-1-0': 'd4' } },
    };
    const res = resolveAbility('Blend In', { game, playerNum: 1 });
    assert.equal(res.applied, false);
    assert.match(res.manualMessage, /not in play/);
  });

  test('the literal spellings are gone from the resolver', () => {
    const src = readFileSync(resolve(root, 'src/game/abilities.js'), 'utf8');
    assert.ok(!/dc\.dcName === 'K-2SO'/.test(src));
    assert.ok(!/startsWith\('K-2SO-'\)/.test(src));
  });
});
