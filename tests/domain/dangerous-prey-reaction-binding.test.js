/**
 * Regression: Dangerous Prey reaction must be bound to its real owner.
 *
 * The after-attack reaction in combat-bridge.js (REACTION_CARDS) gates on
 * `targetFigKey.startsWith(targetDcName + '-')`. Dangerous Prey belongs to
 * Fennec Shand (data/unique-figure-ccs.json, data/cc-effects.json), NOT Bossk
 * — it was previously bound to 'Bossk', so the reaction never fired when
 * Fennec Shand was attacked. This pins the binding to the data source so it
 * can't silently drift back.
 *
 * Source-level assertion (the REACTION_CARDS array is a local constant inside
 * a large non-exported combat function with deep Discord/game dependencies, so
 * a data-shape probe is the appropriate guard here).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');

describe('Dangerous Prey reaction binding', () => {
  it('declares Dangerous Prey as Fennec Shand\'s card in the data sources', () => {
    const uniqueCcs = JSON.parse(
      readFileSync(resolve(root, 'data', 'unique-figure-ccs.json'), 'utf8'),
    );
    const ccEffects = JSON.parse(
      readFileSync(resolve(root, 'data', 'cc-effects.json'), 'utf8'),
    );

    // unique-figure-ccs.json maps the card to its owning figure (under `cards`).
    const owner = (uniqueCcs.cards ?? uniqueCcs)['Dangerous Prey']?.figure;
    assert.equal(owner, 'Fennec Shand', 'Dangerous Prey owner in unique-figure-ccs.json');

    // cc-effects.json declares playableBy (under `cards`).
    const effects = ccEffects.cards ?? ccEffects;
    assert.equal(
      effects['Dangerous Prey']?.playableBy,
      'Fennec Shand',
      'Dangerous Prey playableBy in cc-effects.json',
    );
  });

  it('binds the REACTION_CARDS entry to Fennec Shand, not Bossk', () => {
    const src = readFileSync(resolve(root, 'src', 'engine', 'combat-bridge.js'), 'utf8');
    const m = src.match(/\{\s*name:\s*'Dangerous Prey'\s*,\s*targetDcName:\s*'([^']+)'\s*\}/);
    assert.ok(m, 'Dangerous Prey REACTION_CARDS entry should exist');
    assert.equal(m[1], 'Fennec Shand', 'Dangerous Prey reaction must target Fennec Shand');
    assert.notEqual(m[1], 'Bossk', 'Dangerous Prey reaction must not be bound to Bossk');
  });
});
