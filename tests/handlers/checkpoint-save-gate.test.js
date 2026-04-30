import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { whyMidAction } from '../../src/handlers/checkpoint.js';

describe('whyMidAction — save-time boundary gate', () => {
  it('returns empty string for a clean game (no in-flight action)', () => {
    const game = {
      pendingCombat: null,
      moveInProgress: {},
      pendingSpacePick: {},
      dcActionsData: {},
    };
    assert.equal(whyMidAction(game), '');
  });

  it('returns empty string for a freshly-loaded game with all fields undefined', () => {
    assert.equal(whyMidAction({}), '');
  });

  it('refuses save when combat is pending', () => {
    const game = { pendingCombat: { attackerMsgId: 'x', defenderMsgId: 'y' } };
    assert.match(whyMidAction(game), /combat/i);
  });

  it('refuses save when a move is in progress', () => {
    const game = { moveInProgress: { 'msg_1_0': { remaining: 3 } } };
    assert.match(whyMidAction(game), /move/i);
  });

  it('refuses save when a space pick is open', () => {
    const game = { pendingSpacePick: { 'g1_msg_1': { spaces: ['a1'] } } };
    assert.match(whyMidAction(game), /space pick/i);
  });

  it('refuses save when an activation has started actions', () => {
    const game = { dcActionsData: { 'msg_1': { actionsLeft: 1 } } };
    assert.match(whyMidAction(game), /activation/i);
  });

  it('returns empty for null game (defensive)', () => {
    assert.equal(whyMidAction(null), '');
    assert.equal(whyMidAction(undefined), '');
  });

  it('treats empty objects on each in-flight bucket as clean', () => {
    const game = {
      pendingCombat: null,
      moveInProgress: {},
      pendingSpacePick: {},
      dcActionsData: {},
    };
    assert.equal(whyMidAction(game), '');
  });
});
