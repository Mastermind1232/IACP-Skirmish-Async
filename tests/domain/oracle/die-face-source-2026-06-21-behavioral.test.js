/**
 * Die-face pickers must derive faces from the canonical source (data/dice.json
 * via getDistinctDieFaces), not hardcode them (alexanbv 2026-06-21).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDistinctDieFaces, getDiceData } from '../../../src/data-loader.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('getDistinctDieFaces — single source of die faces', () => {
  it('white defense die has a Dodge face; black does not', () => {
    const white = getDistinctDieFaces('defense', 'white');
    const black = getDistinctDieFaces('defense', 'black');
    assert.ok(white.some((f) => f.dodge), 'white has a Dodge face');
    assert.ok(!black.some((f) => f.dodge), 'black has NO Dodge face');
  });

  it('returns the DISTINCT faces actually present in dice.json', () => {
    for (const color of ['white', 'black']) {
      const raw = getDiceData().defense[color];
      const distinct = getDistinctDieFaces('defense', color);
      // Every distinct face exists in the raw die, and there are no duplicates.
      const keyOf = (f) => `${f.block ?? 0}|${f.evade ?? 0}|${f.dodge ? 1 : 0}`;
      const rawKeys = new Set(raw.map(keyOf));
      const seen = new Set();
      for (const f of distinct) {
        assert.ok(rawKeys.has(keyOf(f)), `${color} face ${keyOf(f)} comes from the die data`);
        assert.ok(!seen.has(keyOf(f)), 'no duplicate faces');
        seen.add(keyOf(f));
      }
    }
  });

  it('attack dice expose {acc,dmg,surge} faces from the source', () => {
    const red = getDistinctDieFaces('attack', 'red');
    assert.ok(red.length > 0 && red.every((f) => 'acc' in f && 'dmg' in f && 'surge' in f));
  });

  it('There Is No Try pickers no longer hardcode a face list', () => {
    // Guard against regression: the two There Is No Try face sources must derive
    // their faces from data/dice.json, not an inline [{ block/b: ... }] literal.
    //
    // 2026-08-31: both now reach it through `faceOptionsFor` in
    // src/game/die-face-picker.js, the shared picker Rapid Recalibration also
    // uses, rather than calling getDistinctDieFaces themselves. Accept either,
    // since the point is the single source and not the call site.
    const reactions = fs.readFileSync(path.join(ROOT, 'src/handlers/combat-reactions.js'), 'utf8');
    const actions = fs.readFileSync(path.join(ROOT, 'src/engine/available-actions.js'), 'utf8');
    const derivesFaces = (src) => /getDistinctDieFaces|faceOptionsFor/.test(src);
    assert.ok(derivesFaces(reactions), 'combat-reactions derives faces from the canonical source');
    assert.ok(derivesFaces(actions), 'available-actions derives faces from the canonical source');
    assert.ok(!/\[\{ *b: *0, *e: *0, *d: *0 \}/.test(actions), 'no hardcoded {b,e,d} face array remains');

    // ...and the shared picker really is backed by the canonical source.
    const picker = fs.readFileSync(path.join(ROOT, 'src/game/die-face-picker.js'), 'utf8');
    assert.ok(picker.includes('getDistinctDieFaces'), 'die-face-picker reads data/dice.json via getDistinctDieFaces');
  });
});
