import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFigurelessDc, hasDepleteEffect, getCompanionDescriptionForDc } from './dc-helpers.js';

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
