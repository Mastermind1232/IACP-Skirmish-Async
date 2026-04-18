/**
 * Phase-D probe: melee/ranged classification is weapon-typed, not distance-typed.
 *
 * PROBE-PD-MEL-003: A figure without the melee icon cannot perform melee
 *   attacks; an attack targeting an adjacent figure that uses a ranged
 *   weapon is a ranged attack. (CRR MELEE ATTACKS)
 *
 * Implementation: every site that classifies an attack uses
 *   `isRanged = attackInfo.type === 'range'`. No branch in combat.js or
 *   available-actions.js re-classifies an attack based on the distance
 *   to target. A ranged weapon firing at an adjacent figure stays a
 *   ranged attack — distance does not enter the classification.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDcEffects } from '../../../src/data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const COMBAT_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');

describe('PROBE-PD-MEL-003: attack classification is weapon-typed, not distance-typed', () => {
  it('003a: source — isRanged is derived from the ranged weapon-type flag (distance-independent)', () => {
    const pat = /const\s+isRanged\s*=\s*attackInfo\.type\s*===\s*'range';/g;
    const cMatches = COMBAT_SRC.match(pat) || [];
    const aMatches = AA_SRC.match(pat) || [];
    assert.ok(cMatches.length >= 1,
      'combat.js must classify isRanged via attackInfo.type — CRR-MEL-003');
    assert.ok(aMatches.length >= 1,
      'available-actions.js must classify isRanged via attackInfo.type — CRR-MEL-003');
  });

  it('003b: source — no branch rewrites isRanged after computing it (no distance override)', () => {
    // A direct re-classification would look like `isRanged = dist`, `isRanged = target.dist`,
    // etc. Pattern: any reassignment of `isRanged` after the initial const.
    const reassign = /\bisRanged\s*=\s*[^=;]/g;
    const cMatches = [...COMBAT_SRC.matchAll(reassign)];
    const aMatches = [...AA_SRC.matchAll(reassign)];
    // Each file should have exactly the const declaration(s) — no mutations.
    for (const m of cMatches) {
      assert.match(COMBAT_SRC.slice(Math.max(0, m.index - 20), m.index + 50),
        /const\s+isRanged/, `combat.js must not mutate isRanged — CRR-MEL-003`);
    }
    for (const m of aMatches) {
      assert.match(AA_SRC.slice(Math.max(0, m.index - 20), m.index + 50),
        /const\s+isRanged/, `available-actions.js must not mutate isRanged — CRR-MEL-003`);
    }
  });

  it('003c: data — attack.type is a per-DC classifier; a "range" DC stays ranged regardless of distance', () => {
    // Data layer pin: the attack type comes from dc-effects.json; adjacency/distance
    // is not a data attribute.
    const effects = getDcEffects();
    const stormtrooperLike = Object.keys(effects).find((n) =>
      effects[n]?.attack?.type === 'range' && Array.isArray(effects[n]?.attack?.dice)
    );
    const ahsokaLike = Object.keys(effects).find((n) =>
      effects[n]?.attack?.type === 'melee' && Array.isArray(effects[n]?.attack?.dice)
    );
    assert.ok(stormtrooperLike, 'a ranged figure must exist in dc-effects.json — CRR-MEL-003');
    assert.ok(ahsokaLike, 'a melee figure must exist in dc-effects.json — CRR-MEL-003');

    // The type is a string scalar — no distance, no LOS, no positional input.
    assert.equal(typeof effects[stormtrooperLike].attack.type, 'string',
      'attack.type must be a scalar weapon-type string — CRR-MEL-003');
    assert.equal(typeof effects[ahsokaLike].attack.type, 'string',
      'attack.type must be a scalar weapon-type string — CRR-MEL-003');
    assert.ok(!('adjacentType' in effects[stormtrooperLike].attack),
      'attack has no distance-variant type field — CRR-MEL-003');
  });

  it('003d: range defaults — a ranged weapon never collapses to melee range [1,1]', () => {
    // The default in available-actions.js:
    //   let [minRange, maxRange] = attackInfo.range || (isRanged ? [1, max(1, accCeiling)] : [1, 1]);
    // Ranged defaults use accCeiling (≥1); melee defaults to [1,1]. The branch
    // is gated on isRanged (weapon-type), NOT on target distance.
    assert.match(AA_SRC,
      /attackInfo\.range\s*\|\|\s*\(isRanged\s*\?\s*\[1,\s*Math\.max\(1,\s*accuracyCeiling\)\]\s*:\s*\[1,\s*1\]\)/,
      'range default branch must be gated on isRanged (weapon-type) — CRR-MEL-003');
  });
});
