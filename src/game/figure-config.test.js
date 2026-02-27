import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, setConfig, clearConfig, getAttachments, hasAttachment } from './figure-config.js';

describe('figure-config', () => {
  it('getConfig returns empty object for missing config', () => {
    const game = {};
    assert.deepStrictEqual(getConfig(game, 'Trooper-0-0'), {});
  });

  it('setConfig creates figureConfig and sets key', () => {
    const game = {};
    setConfig(game, 'Trooper-0-0', 'loadout', 'Electrobatons');
    assert.strictEqual(game.figureConfig['Trooper-0-0'].loadout, 'Electrobatons');
  });

  it('setConfig preserves existing keys', () => {
    const game = { figureConfig: { 'Trooper-0-0': { loadout: 'Electrobatons' } } };
    setConfig(game, 'Trooper-0-0', 'form', 'Senator');
    assert.strictEqual(game.figureConfig['Trooper-0-0'].loadout, 'Electrobatons');
    assert.strictEqual(game.figureConfig['Trooper-0-0'].form, 'Senator');
  });

  it('getConfig returns set values', () => {
    const game = {};
    setConfig(game, 'Trooper-0-0', 'loadout', 'Electrobatons');
    assert.strictEqual(getConfig(game, 'Trooper-0-0').loadout, 'Electrobatons');
  });

  it('clearConfig removes figure config', () => {
    const game = { figureConfig: { 'Trooper-0-0': { loadout: 'X' } } };
    clearConfig(game, 'Trooper-0-0');
    assert.deepStrictEqual(getConfig(game, 'Trooper-0-0'), {});
  });

  it('getAttachments returns empty array when none set', () => {
    assert.deepStrictEqual(getAttachments({}, 'Trooper-0-0'), []);
  });

  it('getAttachments returns attachment list', () => {
    const game = { figureConfig: { 'Trooper-0-0': { attachments: ['Combat Suit', 'Targeting Computer'] } } };
    assert.deepStrictEqual(getAttachments(game, 'Trooper-0-0'), ['Combat Suit', 'Targeting Computer']);
  });

  it('hasAttachment checks for specific attachment', () => {
    const game = { figureConfig: { 'Trooper-0-0': { attachments: ['Combat Suit'] } } };
    assert.ok(hasAttachment(game, 'Trooper-0-0', 'Combat Suit'));
    assert.ok(!hasAttachment(game, 'Trooper-0-0', 'Targeting Computer'));
  });
});
