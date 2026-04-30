import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { restoreGameStateInPlace } from '../../src/handlers/checkpoint.js';

describe('restoreGameStateInPlace', () => {
  it('wipes existing fields and applies savedState', () => {
    const game = { a: 1, b: 2, c: 3 };
    restoreGameStateInPlace(game, { x: 10, y: 20 });
    assert.equal(game.a, undefined);
    assert.equal(game.b, undefined);
    assert.equal(game.c, undefined);
    assert.equal(game.x, 10);
    assert.equal(game.y, 20);
  });

  it('preserves undoStack across the wipe', () => {
    const stack = [{ type: 'action', label: 'do stuff' }];
    const game = { a: 1, undoStack: stack };
    restoreGameStateInPlace(game, { x: 10 });
    // undoStack survives wipe (saved in place; savedState had no undoStack key)
    assert.deepEqual(game.undoStack, stack);
    assert.equal(game.x, 10);
    assert.equal(game.a, undefined);
  });

  it('savedState fields override existing keys', () => {
    const game = { phase: 'lobby', round: 0 };
    restoreGameStateInPlace(game, { phase: 'round_active', round: 3 });
    assert.equal(game.phase, 'round_active');
    assert.equal(game.round, 3);
  });

  it('identityOverlay overrides savedState', () => {
    const game = { gameId: '99999', generalId: 'channel_a' };
    const savedState = { gameId: '00001', generalId: 'channel_b', otherField: 'kept' };
    const overlay = { gameId: '99999', generalId: 'channel_a' };
    restoreGameStateInPlace(game, savedState, overlay);
    assert.equal(game.gameId, '99999'); // overlay wins
    assert.equal(game.generalId, 'channel_a'); // overlay wins
    assert.equal(game.otherField, 'kept'); // savedState applied where no overlay
  });

  it('mutates the game object in place (returns undefined)', () => {
    const game = { a: 1 };
    const ret = restoreGameStateInPlace(game, { b: 2 });
    assert.equal(ret, undefined);
    assert.equal(game.b, 2);
  });

  it('handles empty savedState (wipes everything except undoStack)', () => {
    const stack = [{ x: 1 }];
    const game = { a: 1, b: 2, undoStack: stack };
    restoreGameStateInPlace(game, {});
    assert.equal(game.a, undefined);
    assert.equal(game.b, undefined);
    assert.deepEqual(game.undoStack, stack);
  });

  it('handles undefined identityOverlay (defaults to no overlay)', () => {
    const game = { a: 1 };
    restoreGameStateInPlace(game, { x: 5 });
    assert.equal(game.x, 5);
    assert.equal(game.a, undefined);
  });
});
