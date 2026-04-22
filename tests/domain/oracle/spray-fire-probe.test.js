/**
 * PROBE-SPRAY-FIRE: Heavy Stormtrooper (Elite)'s **Spray Fire**.
 *
 * Card text: "While attacking, you may apply -3 Accuracy and +1
 *  Surge to the attack results."
 *
 * Extracted from src/handlers/combat.js:2179. Current handler applies
 * the trade-off unconditionally when the slug is present; a LATENT
 * tripwire at the bottom flags that the library's "may apply" clause
 * is not honored by the handler (tracked in latent-bugs memory).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSprayFireAbility,
  applySprayFire,
  SPRAY_FIRE_ABILITY_ID,
  SPRAY_FIRE_ACCURACY_DELTA,
  SPRAY_FIRE_SURGE_DELTA,
} from '../../../src/game/spray-fire-helpers.js';

describe('PROBE-SPRAY-FIRE-001: constants', () => {
  it('ability id', () => {
    assert.equal(SPRAY_FIRE_ABILITY_ID, 'spray_fire_heavy_stormtrooper');
  });
  it('accuracy delta = -3', () => {
    assert.equal(SPRAY_FIRE_ACCURACY_DELTA, -3);
  });
  it('surge delta = +1', () => {
    assert.equal(SPRAY_FIRE_SURGE_DELTA, 1);
  });
});

describe('PROBE-SPRAY-FIRE-002: hasSprayFireAbility', () => {
  it('slug present → true', () => {
    assert.equal(hasSprayFireAbility(['spray_fire_heavy_stormtrooper']), true);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasSprayFireAbility([]), false);
    assert.equal(hasSprayFireAbility(null), false);
    assert.equal(hasSprayFireAbility('spray_fire_heavy_stormtrooper'), false);
  });
});

describe('PROBE-SPRAY-FIRE-003: applySprayFire math', () => {
  it('zero existing → -3 accuracy, +1 surge', () => {
    assert.deepStrictEqual(applySprayFire({ bonusAccuracy: 0, surgeBonus: 0 }), {
      applied: true,
      bonusAccuracy: -3,
      surgeBonus: 1,
    });
  });
  it('stacks on existing', () => {
    assert.deepStrictEqual(applySprayFire({ bonusAccuracy: 2, surgeBonus: 2 }), {
      applied: true,
      bonusAccuracy: -1,
      surgeBonus: 3,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applySprayFire(), {
      applied: true,
      bonusAccuracy: -3,
      surgeBonus: 1,
    });
    assert.deepStrictEqual(applySprayFire({ bonusAccuracy: null, surgeBonus: null }), {
      applied: true,
      bonusAccuracy: -3,
      surgeBonus: 1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusAccuracy: 5, surgeBonus: 2 };
    applySprayFire(input);
    assert.deepStrictEqual(input, { bonusAccuracy: 5, surgeBonus: 2 });
  });
});

describe('PROBE-SPRAY-FIRE-004: library + dc-effects wiring', () => {
  it('library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.spray_fire_heavy_stormtrooper;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Spray Fire/i);
  });
  it('Heavy Stormtrooper (Elite) references slug', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Heavy Stormtrooper (Elite)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('spray_fire_heavy_stormtrooper'));
  });
});

describe('LATENT-SPRAY-FIRE: optionality not honored', () => {
  it('LATENT: library says "may apply" but handler applies unconditionally', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const desc = (lib.abilities?.spray_fire_heavy_stormtrooper?.description || '').toLowerCase();
    // Tripwire: library still uses "may apply" → action is optional.
    // If this fails, either library has been rewritten to be mandatory
    // (closing the mismatch) or handler has gained opt-in UI.
    assert.match(desc, /may apply/);
  });
});
