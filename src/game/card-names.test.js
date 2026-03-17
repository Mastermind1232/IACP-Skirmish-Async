import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripBrackets, cardNameEquals, cardNameIncludes } from './card-names.js';

describe('stripBrackets', () => {
  it('strips matching brackets', () => {
    assert.equal(stripBrackets('[Lie in Ambush]'), 'Lie in Ambush');
    assert.equal(stripBrackets('[Focused on the Kill]'), 'Focused on the Kill');
  });

  it('returns bare names unchanged (idempotent)', () => {
    assert.equal(stripBrackets('Lie in Ambush'), 'Lie in Ambush');
    assert.equal(stripBrackets('Cross-Training'), 'Cross-Training');
  });

  it('does not strip mismatched brackets', () => {
    assert.equal(stripBrackets('[only-opening'), '[only-opening');
    assert.equal(stripBrackets('only-closing]'), 'only-closing]');
  });

  it('passes through non-string values', () => {
    assert.equal(stripBrackets(null), null);
    assert.equal(stripBrackets(undefined), undefined);
    assert.equal(stripBrackets(42), 42);
  });
});

describe('cardNameEquals', () => {
  it('matches bracket-wrapped to bare', () => {
    assert.equal(cardNameEquals('[Focused on the Kill]', 'Focused on the Kill'), true);
    assert.equal(cardNameEquals('Focused on the Kill', '[Focused on the Kill]'), true);
  });

  it('matches bare to bare', () => {
    assert.equal(cardNameEquals('Foo', 'Foo'), true);
  });

  it('matches bracket to bracket', () => {
    assert.equal(cardNameEquals('[Foo]', '[Foo]'), true);
  });

  it('rejects different names', () => {
    assert.equal(cardNameEquals('Foo', 'Bar'), false);
    assert.equal(cardNameEquals('[Foo]', 'Bar'), false);
  });
});

describe('cardNameIncludes', () => {
  it('finds bracket-wrapped entry with bare search', () => {
    assert.equal(cardNameIncludes(['[Lie in Ambush]', 'Cross-Training'], 'Lie in Ambush'), true);
  });

  it('finds bare entry with bracket search', () => {
    assert.equal(cardNameIncludes(['Lie in Ambush', 'Cross-Training'], '[Lie in Ambush]'), true);
  });

  it('returns false when not present', () => {
    assert.equal(cardNameIncludes(['Cross-Training'], 'Lie in Ambush'), false);
  });

  it('returns false for non-array input', () => {
    assert.equal(cardNameIncludes(undefined, 'Foo'), false);
    assert.equal(cardNameIncludes(null, 'Foo'), false);
  });

  it('handles empty array', () => {
    assert.equal(cardNameIncludes([], 'Foo'), false);
  });

  it('handles mixed bracket and bare entries', () => {
    const arr = ['[Focused on the Kill]', 'Cross-Training', '[Lie in Ambush]'];
    assert.equal(cardNameIncludes(arr, 'Focused on the Kill'), true);
    assert.equal(cardNameIncludes(arr, 'Cross-Training'), true);
    assert.equal(cardNameIncludes(arr, 'Lie in Ambush'), true);
    assert.equal(cardNameIncludes(arr, 'Driven by Hatred'), false);
  });
});
