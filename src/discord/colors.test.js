import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from './colors.js';

describe('COLORS', () => {
  test('has expected keys', () => {
    assert.ok(COLORS.DARK_EMBED);
    assert.ok(COLORS.BLURPLE);
    assert.ok(COLORS.GREEN);
    assert.ok(COLORS.RED);
    assert.ok(COLORS.ORANGE);
    assert.ok(COLORS.GRAY);
    assert.ok(COLORS.GOLD);
  });

  test('values are valid hex color numbers', () => {
    for (const val of Object.values(COLORS)) {
      assert.strictEqual(typeof val, 'number');
      assert.ok(val >= 0 && val <= 0xffffff);
    }
  });
});
