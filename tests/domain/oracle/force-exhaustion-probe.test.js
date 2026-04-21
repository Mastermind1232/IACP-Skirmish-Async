/**
 * PROBE-FORCE-EXHAUSTION: The Child's **Force Exhaustion**.
 *
 * Card text: "When a figure you control is targeted by an attack, you
 *  may declare that The Child becomes Incapacitated. Remove 1 attack
 *  die from that attack and the attacker becomes Weakened. Extends to
 *  figures carrying the Clan of Two attachment."
 *
 * Phase 2 high-risk probe grind (2026-04-21). Atom was structural-only
 * with eligibility logic inlined at combat.js:2333 and die-removal at
 * combat-reactions.js:818. Pure helpers extracted to
 * src/game/force-exhaustion-helpers.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canOfferForceExhaustion,
  findChildFigureKey,
  removeForceExhaustionDie,
  FORCE_EXHAUSTION_DIE_REMOVE_ORDER,
} from '../../../src/game/force-exhaustion-helpers.js';

function gameWith({ childAlive = true, childIncapacitated = false } = {}) {
  return {
    gameId: 'gfe',
    figurePositions: {
      1: { 'Mandalorian-1-0': 'a1' },
      2: childAlive ? { 'The Child-1-0': 'a1' } : {},
    },
    childIncapacitated,
  };
}

describe('PROBE-FORCE-EXHAUSTION-001: findChildFigureKey locates the figure case-insensitively', () => {
  it('standard figure key returns the key', () => {
    const g = gameWith();
    assert.equal(findChildFigureKey(g, 2), 'The Child-1-0');
  });

  it('no Child on defender side → null', () => {
    const g = gameWith({ childAlive: false });
    assert.equal(findChildFigureKey(g, 2), null);
  });

  it('missing figurePositions entry → null (no throw)', () => {
    assert.equal(findChildFigureKey({}, 2), null);
  });
});

describe('PROBE-FORCE-EXHAUSTION-002: canOfferForceExhaustion — target predicate', () => {
  it('target IS The Child, Child alive, not incapacitated → eligible (target-is-child)', () => {
    const r = canOfferForceExhaustion(gameWith(), 2, 'The Child', []);
    assert.equal(r.eligible, true);
    assert.equal(r.reasonCode, 'target-is-child');
    assert.equal(r.childFigureKey, 'The Child-1-0');
  });

  it('target has Clan of Two attachment (string form) → eligible', () => {
    const r = canOfferForceExhaustion(gameWith(), 2, 'The Mandalorian', ['Clan of Two']);
    assert.equal(r.eligible, true);
    assert.equal(r.reasonCode, 'clan-of-two');
  });

  it('target is neither Child nor Clan-of-Two carrier → ineligible', () => {
    const r = canOfferForceExhaustion(gameWith(), 2, 'Rebel Trooper', []);
    assert.equal(r.eligible, false);
    assert.equal(r.reasonCode, 'target-not-eligible');
  });

  it('Clan of Two match accepts bracketed form "[Clan of Two]"', () => {
    const r = canOfferForceExhaustion(gameWith(), 2, 'Luke Skywalker', ['[Clan of Two]']);
    assert.equal(r.eligible, true);
    assert.equal(r.reasonCode, 'clan-of-two');
  });

  it('Clan of Two match is case-sensitive (matches cardNameIncludes contract)', () => {
    // cardNameIncludes performs strict equality after stripping brackets,
    // so lowercase "clan of two" does not match. Documented to guard
    // against silent behavior drift if the helper changes.
    const r = canOfferForceExhaustion(gameWith(), 2, 'Luke Skywalker', ['clan of two']);
    assert.equal(r.eligible, false);
    assert.equal(r.reasonCode, 'target-not-eligible');
  });
});

describe('PROBE-FORCE-EXHAUSTION-003: canOfferForceExhaustion — Child-state guards', () => {
  it('no live Child on defender side → ineligible (no-child-alive)', () => {
    const g = gameWith({ childAlive: false });
    const r = canOfferForceExhaustion(g, 2, 'The Child', []);
    assert.equal(r.eligible, false);
    assert.equal(r.reasonCode, 'no-child-alive');
  });

  it('Child already incapacitated → ineligible (already-incapacitated), even if target is Child', () => {
    const g = gameWith({ childIncapacitated: true });
    const r = canOfferForceExhaustion(g, 2, 'The Child', []);
    assert.equal(r.eligible, false);
    assert.equal(r.reasonCode, 'already-incapacitated');
  });

  it('already-incapacitated short-circuits before target check', () => {
    const g = gameWith({ childIncapacitated: true });
    const r = canOfferForceExhaustion(g, 2, 'Rebel Trooper', []);
    assert.equal(r.reasonCode, 'already-incapacitated');
  });

  it('missing defenderUpgrades argument is handled (treated as empty)', () => {
    const r = canOfferForceExhaustion(gameWith(), 2, 'Rebel Trooper');
    assert.equal(r.eligible, false);
    assert.equal(r.reasonCode, 'target-not-eligible');
  });
});

describe('PROBE-FORCE-EXHAUSTION-004: die removal priority', () => {
  it('exported order is [yellow, green, blue, red]', () => {
    assert.deepStrictEqual(
      [...FORCE_EXHAUSTION_DIE_REMOVE_ORDER],
      ['yellow', 'green', 'blue', 'red'],
    );
  });

  it('removes yellow first when present', () => {
    const r = removeForceExhaustionDie(['red', 'blue', 'green', 'yellow']);
    assert.equal(r.removedColor, 'yellow');
    assert.deepStrictEqual(r.dice.sort(), ['blue', 'green', 'red']);
  });

  it('removes green when no yellow', () => {
    const r = removeForceExhaustionDie(['red', 'green', 'blue']);
    assert.equal(r.removedColor, 'green');
    assert.deepStrictEqual(r.dice.sort(), ['blue', 'red']);
  });

  it('removes blue when only red and blue', () => {
    const r = removeForceExhaustionDie(['red', 'blue']);
    assert.equal(r.removedColor, 'blue');
    assert.deepStrictEqual(r.dice, ['red']);
  });

  it('falls back to red when only red present', () => {
    const r = removeForceExhaustionDie(['red', 'red']);
    assert.equal(r.removedColor, 'red');
    assert.deepStrictEqual(r.dice, ['red']);
  });

  it('empty dice → no removal, null color', () => {
    const r = removeForceExhaustionDie([]);
    assert.equal(r.removedColor, null);
    assert.deepStrictEqual(r.dice, []);
  });

  it('does not mutate caller array', () => {
    const input = ['yellow', 'red'];
    removeForceExhaustionDie(input);
    assert.deepStrictEqual(input, ['yellow', 'red']);
  });

  it('duplicates of same color — only one removed', () => {
    const r = removeForceExhaustionDie(['yellow', 'yellow', 'red']);
    assert.equal(r.removedColor, 'yellow');
    assert.equal(r.dice.filter((c) => c === 'yellow').length, 1);
    assert.equal(r.dice.includes('red'), true);
  });

  it('unknown color in list ignored; removal proceeds on known colors', () => {
    const r = removeForceExhaustionDie(['purple', 'yellow', 'red']);
    assert.equal(r.removedColor, 'yellow');
    assert.ok(r.dice.includes('purple'));
    assert.ok(r.dice.includes('red'));
  });
});

describe('PROBE-FORCE-EXHAUSTION-005: library entry wired', () => {
  it('force_exhaustion_child entry exists', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.force_exhaustion_child;
    assert.ok(entry, 'force_exhaustion_child must exist in ability-library');
    assert.match(entry.label || '', /Force Exhaustion/);
  });

  it('The Child DC ability text mentions Force Exhaustion (handler-only dispatch)', async () => {
    // NOTE: force_exhaustion_child is NOT in The Child's specialAbilityIds;
    // dispatch happens in src/handlers/combat.js by checking targetDcName
    // === "The Child" (or the Clan of Two attachment). Library entry
    // exists only for documentation + the behavioral-probe ledger.
    const { readFile } = await import('node:fs/promises');
    const effects = JSON.parse(await readFile(new URL('../../../data/dc-effects.json', import.meta.url), 'utf8'));
    const child = effects.cards?.['The Child'];
    assert.ok(child, 'The Child DC must exist in dc-effects');
    assert.match(child.abilityText || '', /Force Exhaustion/);
  });
});
