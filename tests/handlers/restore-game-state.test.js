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

  it('repairs stale companion figure keys carried in the restored blob', () => {
    // alexanbv 2026-08-11: game 00001 was a fresh lobby loaded from a
    // checkpoint predating ac266382, so the restored blob still held
    // "The Child-0-0". Restores bypass the load-time migrations in
    // game-state.js, so this path must repair the key itself — otherwise
    // checkpoint load, Undo and Resync each reintroduce the broken companion.
    const game = {};
    restoreGameStateInPlace(game, {
      gameId: null,
      figurePositions: { 1: {}, 2: { 'The Child-0-0': 't13', 'Baze Malbus-1-0': 'u13' } },
      companionHostMap: { 'The Child-0-0': { hostFigureKey: 'Baze Malbus-1-0', playerNum: 2 } },
    });
    assert.equal(game.figurePositions[2]['The Child-1-0'], 't13');
    assert.equal(game.figurePositions[2]['The Child-0-0'], undefined);
    assert.equal(game.companionHostMap['The Child-1-0'].hostFigureKey, 'Baze Malbus-1-0');
    assert.equal(game.companionHostMap['The Child-0-0'], undefined);
    // Untouched neighbour.
    assert.equal(game.figurePositions[2]['Baze Malbus-1-0'], 'u13');
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
