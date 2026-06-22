import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dcNameFromFigureKey, parseFigureKey, isFigurelessDc, hasDepleteEffect, getCompanionDescriptionForDc, figureHasPriorityTarget } from './dc-helpers.js';

describe('dcNameFromFigureKey', () => {
  it('extracts DC name from figure key', () => {
    assert.strictEqual(dcNameFromFigureKey('Darth Vader-1-0'), 'Darth Vader');
  });
  it('handles multi-digit indices', () => {
    assert.strictEqual(dcNameFromFigureKey('Stormtroopers-2-3'), 'Stormtroopers');
  });
  it('returns empty string for falsy input', () => {
    assert.strictEqual(dcNameFromFigureKey(null), '');
    assert.strictEqual(dcNameFromFigureKey(undefined), '');
  });
  it('returns original string if no match', () => {
    assert.strictEqual(dcNameFromFigureKey('invalid'), 'invalid');
  });
});

describe('parseFigureKey', () => {
  it('extracts dgIndex and figureIndex', () => {
    assert.deepStrictEqual(parseFigureKey('Stormtroopers-1-0'), { dgIndex: 1, figureIndex: 0 });
  });
  it('handles multi-word names', () => {
    assert.deepStrictEqual(parseFigureKey('Darth Vader-2-1'), { dgIndex: 2, figureIndex: 1 });
  });
  it('defaults for invalid input', () => {
    assert.deepStrictEqual(parseFigureKey('invalid'), { dgIndex: 1, figureIndex: 0 });
  });
  it('defaults for null', () => {
    assert.deepStrictEqual(parseFigureKey(null), { dgIndex: 1, figureIndex: 0 });
  });
});

describe('isFigurelessDc', () => {
  it('returns false for null/empty', () => {
    assert.ok(!isFigurelessDc(null));
    assert.ok(!isFigurelessDc(''));
    assert.ok(!isFigurelessDc(undefined));
  });

  it('returns true for bracketed names', () => {
    assert.ok(isFigurelessDc('[Focused on the Kill]'));
  });

  it('returns false for figure DCs', () => {
    assert.ok(!isFigurelessDc('Stormtrooper'));
  });
});

describe('hasDepleteEffect', () => {
  it('returns false for non-figureless DCs', () => {
    assert.ok(!hasDepleteEffect('Stormtrooper'));
  });

  it('returns false for null', () => {
    assert.ok(!hasDepleteEffect(null));
  });
});

describe('getCompanionDescriptionForDc', () => {
  it('returns *None* for unknown DC', () => {
    assert.strictEqual(getCompanionDescriptionForDc('NonexistentDC999'), '*None*');
  });

  it('returns *None* for DC without companion', () => {
    assert.strictEqual(getCompanionDescriptionForDc('Stormtrooper'), '*None*');
  });
});

describe('figureHasPriorityTarget (FIX 1 — normalized PT detection via passives)', () => {
  const game = { selectedMap: { id: 'x' } };

  // All 5 Priority Target figures now carry the keyword in the SAME data
  // structure (the `passives` array) — whether the card just lists the keyword
  // or also spells it out in abilityText prose. alexanbv 2026-06-21.
  it('recognizes [Flame Trooper] attachment — passives array', () => {
    assert.ok(figureHasPriorityTarget(game, '[Flame Trooper]-1-0'));
  });
  it('recognizes HK Assassin Droid (Elite) — passives array', () => {
    assert.ok(figureHasPriorityTarget(game, 'HK Assassin Droid (Elite)-1-0'));
  });
  it("recognizes Mak Eshka'rey — passives array", () => {
    assert.ok(figureHasPriorityTarget(game, "Mak Eshka'rey-1-0"));
  });
  it('recognizes Loku Kanoloa — normalized into passives (prose stays as Mon Cala Special Forces)', () => {
    assert.ok(figureHasPriorityTarget(game, 'Loku Kanoloa-1-0'));
  });
  it('recognizes Rebel Saboteur (Elite) — normalized into passives (prose stays as Overload)', () => {
    assert.ok(figureHasPriorityTarget(game, 'Rebel Saboteur (Elite)-1-0'));
  });

  it('returns false for a figure without Priority Target', () => {
    assert.ok(!figureHasPriorityTarget(game, 'Stormtrooper-1-0'));
  });
  it('returns false for Rebel Saboteur (Regular) — no Priority Target', () => {
    assert.ok(!figureHasPriorityTarget(game, 'Rebel Saboteur (Regular)-1-0'));
  });
  it('returns false for unknown DC / falsy', () => {
    assert.ok(!figureHasPriorityTarget(game, 'NonexistentDC999-1-0'));
    assert.ok(!figureHasPriorityTarget(game, null));
  });

  // alexanbv 2026-06-22: Priority Target is the FLAME TROOPER Squad Upgrade
  // FIGURE's keyword — scoped to that figure (identified by nickname), NOT the
  // host group's base figures. The SU figure has a HOST figureKey (e.g.
  // 'Stormtrooper-1-2') with a 'Flame Trooper' nickname.
  it('SU scoping: the Flame Trooper SU figure (host figureKey + nickname) HAS Priority Target', () => {
    const suGame = { figureNicknames: { 'Stormtrooper-1-2': 'Flame Trooper' } };
    assert.ok(figureHasPriorityTarget(suGame, 'Stormtrooper-1-2'));
  });
  it('SU scoping: a base group figure (no SU nickname) does NOT get Priority Target', () => {
    const suGame = { figureNicknames: { 'Stormtrooper-1-2': 'Flame Trooper' } };
    assert.ok(!figureHasPriorityTarget(suGame, 'Stormtrooper-1-0'));
  });
});
