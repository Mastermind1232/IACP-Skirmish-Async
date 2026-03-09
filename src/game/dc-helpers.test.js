import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dcNameFromFigureKey, parseFigureKey, isFigurelessDc, hasDepleteEffect, getCompanionDescriptionForDc } from './dc-helpers.js';

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
