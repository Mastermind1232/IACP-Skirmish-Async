/**
 * _cleanupMoveState (via the exported discardOpenMoveGrids) must not blow up
 * once round-scoped flag objects exist.
 *
 * The Mobile cleanup line referenced `figureKey`, which was never a parameter
 * of _cleanupMoveState. That is only harmless while `game.mobileMovementActive`
 * is undefined: `a?.[b]` short-circuits the WHOLE chain and never evaluates the
 * subscript. cleanupRoundStart lists mobileMovementActive in ROUND_OBJECT_FLAGS
 * and assigns `{}` at every round start — from round 2 on the subscript IS
 * evaluated and throws ReferenceError, taking out every End-Movement.
 *
 * Latent since 78204a92 (2026-05-13). The round-1 case passed precisely because
 * the field was missing, which is why nothing caught it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discardOpenMoveGrids } from '../../src/handlers/movement.js';

const makeGame = (extra = {}) => ({
  gameId: '00001',
  moveInProgress: {
    'msg1_0': { figureKey: 'Baze Malbus-1-0', playerNum: 2, mpRemaining: 2, msgId: 'msg1' },
  },
  pendingSpacePick: {},
  ...extra,
});

describe('_cleanupMoveState via discardOpenMoveGrids', () => {
  it('round 1 shape (mobileMovementActive undefined) cleans up without throwing', () => {
    const game = makeGame();
    assert.doesNotThrow(() => discardOpenMoveGrids(game, 'msg1'));
    assert.equal(game.moveInProgress['msg1_0'], undefined);
  });

  it('round 2+ shape (mobileMovementActive === {}) does not throw', () => {
    // Exactly what cleanupRoundStart produces for a ROUND_OBJECT_FLAGS entry.
    const game = makeGame({ mobileMovementActive: {} });
    assert.doesNotThrow(
      () => discardOpenMoveGrids(game, 'msg1'),
      'ReferenceError here means the free-variable reference is back',
    );
    assert.equal(game.moveInProgress['msg1_0'], undefined);
  });

  it('clears the Mobile flag for the moving figure, and only that figure', () => {
    const game = makeGame({
      mobileMovementActive: { 'Baze Malbus-1-0': true, 'Leia Organa-1-0': true },
    });
    discardOpenMoveGrids(game, 'msg1');
    assert.equal(game.mobileMovementActive['Baze Malbus-1-0'], undefined, 'mover cleared');
    assert.equal(game.mobileMovementActive['Leia Organa-1-0'], true, 'bystander untouched');
  });

  it('tolerates a move entry with no figureKey', () => {
    const game = makeGame({ mobileMovementActive: { 'Baze Malbus-1-0': true } });
    game.moveInProgress['msg1_0'] = { playerNum: 2, msgId: 'msg1' };
    assert.doesNotThrow(() => discardOpenMoveGrids(game, 'msg1'));
    // Nothing to key off, so the flag is left alone rather than mis-cleared.
    assert.equal(game.mobileMovementActive['Baze Malbus-1-0'], true);
  });
});
