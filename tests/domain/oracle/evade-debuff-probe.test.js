/**
 * PROBE-EVADE-DEBUFF: the id predicates for Disposable and Conclusion.
 *
 * BOTH ARE -1 DODGE, not -1 Evade, despite this file's name and the helper's.
 * They were implemented as Evade because the two glyphs are near-identical on
 * the printed cards. alexanbv 2026-09-02 confirmed Conclusion from the art and
 * then Hired Gun explicitly: "hired gun (regular) are -1 dodge".
 *
 * So `applyEvadeDebuff` is no longer what either ability uses. The tests below
 * still cover that helper's arithmetic because it remains exported, but the
 * REAL behaviour of the two abilities is pinned at the bottom of this file.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasDisposableAbility,
  hasConclusionAbility,
  applyEvadeDebuff,
  DISPOSABLE_ABILITY_ID,
  CONCLUSION_ABILITY_ID,
  EVADE_DEBUFF_DELTA,
} from '../../../src/game/evade-debuff-helpers.js';

describe('PROBE-EVADE-DEBUFF-001: constants', () => {
  it('ids', () => {
    assert.equal(DISPOSABLE_ABILITY_ID, 'disposable');
    assert.equal(CONCLUSION_ABILITY_ID, 'conclusion');
  });
  it('delta = -1', () => {
    assert.equal(EVADE_DEBUFF_DELTA, -1);
  });
});

describe('PROBE-EVADE-DEBUFF-002: predicates', () => {
  it('disposable slug → has Disposable only', () => {
    assert.equal(hasDisposableAbility(['disposable']), true);
    assert.equal(hasConclusionAbility(['disposable']), false);
  });
  it('conclusion slug → has Conclusion only', () => {
    assert.equal(hasConclusionAbility(['conclusion']), true);
    assert.equal(hasDisposableAbility(['conclusion']), false);
  });
  it('missing / non-array → false', () => {
    assert.equal(hasDisposableAbility([]), false);
    assert.equal(hasDisposableAbility(null), false);
    assert.equal(hasConclusionAbility('conclusion'), false);
  });
});

describe('PROBE-EVADE-DEBUFF-003: applyEvadeDebuff math', () => {
  it('zero existing → -1', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: 0 }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('stacks on existing (multi-source debuff)', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: -1 }), {
      applied: true,
      bonusEvade: -2,
    });
  });
  it('cancels positive existing bonus', () => {
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: 2 }), {
      applied: true,
      bonusEvade: 1,
    });
  });
  it('defaults / null → treated as 0', () => {
    assert.deepStrictEqual(applyEvadeDebuff(), { applied: true, bonusEvade: -1 });
    assert.deepStrictEqual(applyEvadeDebuff({ bonusEvade: null }), {
      applied: true,
      bonusEvade: -1,
    });
  });
  it('pure: no mutation', () => {
    const input = { bonusEvade: 3 };
    applyEvadeDebuff(input);
    assert.deepStrictEqual(input, { bonusEvade: 3 });
  });
});

describe('PROBE-EVADE-DEBUFF-004: library + dc-effects wiring', () => {
  it('disposable library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.disposable;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Disposable/i);
  });
  it('conclusion library entry wired', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(
      await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'),
    );
    const e = lib.abilities?.conclusion;
    assert.ok(e);
    assert.equal(e.wiredStatus, 'wired');
    assert.match(e.label || '', /Conclusion/i);
  });
  it('Hired Gun (Regular) references disposable', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['Hired Gun (Regular)'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('disposable'));
  });
  it('HK-47 references conclusion', async () => {
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(
      await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'),
    );
    const dc = effects.cards?.['HK-47'];
    assert.ok(dc);
    assert.ok((dc.specialAbilityIds || []).includes('conclusion'));
  });
});

// ── The behaviour that actually ships ────────────────────────────────────────

describe('PROBE-EVADE-DEBUFF-DODGE: Disposable and Conclusion reduce DODGE', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/handlers/combat.js'), 'utf8');
  // Strip line comments before asserting: the branches explain WHY they no
  // longer touch bonusEvade, and matching that prose would be a false failure.
  const code = (text) => text.replace(/^\s*\/\/.*$/gm, '');

  it('Disposable subtracts from bonusDodge, not bonusEvade', () => {
    const branch = code(src.slice(src.indexOf("id === 'disposable'"), src.indexOf("id === 'cortosis_weave'")));
    assert.match(branch, /combat\.bonusDodge = \(combat\.bonusDodge \|\| 0\) - 1/,
      'Hired Gun (Regular) loses a Dodge, not an Evade');
    assert.ok(!/bonusEvade/.test(branch), 'and must no longer touch bonusEvade');
  });

  it('Conclusion cancels a Dodge', () => {
    const branch = code(src.slice(src.indexOf("id === 'conclusion'"), src.indexOf("id === 'dead_precise_dodge'")));
    assert.match(branch, /conclusionDodgeCancel = true/);
    assert.ok(!/bonusEvade/.test(branch));
  });

  it('the shipped card text says Dodge for both', () => {
    const dc = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dc-effects.json'), 'utf8')).cards;
    assert.match(dc['Hired Gun (Regular)'].abilityText, /Disposable: While defending, apply -1 Dodge/);
    assert.match(dc['HK-47'].abilityText, /Conclusion: While attacking, apply -1 Dodge/);
  });

  it('Jawa Scavenger and Scout Trooper genuinely ARE Evade', () => {
    // alexanbv 2026-09-02: "Jawa scavengers, scout troopers reference evades".
    // Pinned so a later sweep does not "correct" these to Dodge by analogy.
    const dc = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dc-effects.json'), 'utf8')).cards;
    assert.match(dc['Jawa Scavenger (Elite)'].abilityText, /-1 Evade/);
    assert.match(dc['Jawa Scavenger (Regular)'].abilityText, /-1 Evade/);
    assert.match(dc['Scout Trooper (Elite)'].abilityText, /-1 Evade/);
  });
});
