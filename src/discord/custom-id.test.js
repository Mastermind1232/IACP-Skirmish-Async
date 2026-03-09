import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomId, splitCustomId, matchCustomId } from './custom-id.js';

describe('parseCustomId', () => {
  test('extracts suffix after prefix', () => {
    assert.strictEqual(parseCustomId('refresh_map_game123', 'refresh_map_'), 'game123');
  });
  test('returns null for non-matching prefix', () => {
    assert.strictEqual(parseCustomId('other_game123', 'refresh_map_'), null);
  });
  test('returns empty string when customId equals prefix', () => {
    assert.strictEqual(parseCustomId('refresh_map_', 'refresh_map_'), '');
  });
  test('returns null for null input', () => {
    assert.strictEqual(parseCustomId(null, 'refresh_map_'), null);
  });
  test('returns null for undefined input', () => {
    assert.strictEqual(parseCustomId(undefined, 'refresh_map_'), null);
  });
});

describe('splitCustomId', () => {
  test('splits remaining parts', () => {
    assert.deepStrictEqual(splitCustomId('deploy_pick_game1_2_3_a4', 'deploy_pick_'), ['game1', '2', '3', 'a4']);
  });
  test('returns empty array for non-matching prefix', () => {
    assert.deepStrictEqual(splitCustomId('other_thing', 'deploy_pick_'), []);
  });
});

describe('matchCustomId', () => {
  test('extracts regex groups', () => {
    assert.deepStrictEqual(matchCustomId('attack_target_msg1_2_3', /^attack_target_(.+)_(\d+)_(\d+)$/), ['msg1', '2', '3']);
  });
  test('returns null on no match', () => {
    assert.strictEqual(matchCustomId('other_thing', /^attack_target_(.+)$/), null);
  });
  test('returns null for null input', () => {
    assert.strictEqual(matchCustomId(null, /^test_(.+)$/), null);
  });
});
