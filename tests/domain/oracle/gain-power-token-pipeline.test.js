/**
 * Gain-Power-Token pipeline (alexanbv 2026-06-22):
 *  - gaining tokens past the cap (normally 2) queues an overflow → the player
 *    discards down to the cap, and may discard the NEWLY-GAINED or EXISTING tokens;
 *  - Migs Mayfeld ("Locked and Loaded") raises the cap to 3.
 * All PT grants route through grantPowerTokens so the cap/overflow apply uniformly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { grantPowerTokens, resolveOverflowDiscard } from '../../../src/game/game-helpers.js';
import { getMaxPowerTokens } from '../../../src/game/dc-helpers.js';

describe('gain-PT pipeline — cap + overflow', () => {
  it('a normal figure caps at 2: gaining a 3rd queues an overflow-discard of 1', () => {
    const game = { figurePowerTokens: { 'Stormtrooper-1-0': ['Damage', 'Block'] } };
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Surge', 1);
    // The token is always granted; the overflow is then queued for a discard.
    assert.deepEqual(game.figurePowerTokens['Stormtrooper-1-0'], ['Damage', 'Block', 'Surge']);
    assert.equal(game.pendingPowerTokenOverflow?.[0]?.figureKey, 'Stormtrooper-1-0');
    assert.equal(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });

  it('the discard may remove an EXISTING token (not just the newly-gained one)', () => {
    const game = { figurePowerTokens: { 'Stormtrooper-1-0': ['Damage', 'Block'] } };
    grantPowerTokens(game, 'Stormtrooper-1-0', 'Surge', 1); // now [Damage, Block, Surge]
    // Discard index 0 (the EXISTING Damage token) — keeping the newly-gained Surge.
    const r = resolveOverflowDiscard(game, 'Stormtrooper-1-0', 0);
    assert.equal(r.discarded, 'Damage');
    assert.deepEqual(game.figurePowerTokens['Stormtrooper-1-0'], ['Block', 'Surge']);
    assert.ok(!game.pendingPowerTokenOverflow, 'overflow cleared once back at the cap');
  });

  it('Migs Mayfeld can hold 3 power tokens (cap = 3, no overflow at 3)', () => {
    assert.equal(getMaxPowerTokens('Migs Mayfeld-1-0'), 3);
    const game = { figurePowerTokens: { 'Migs Mayfeld-1-0': ['Damage', 'Block'] } };
    grantPowerTokens(game, 'Migs Mayfeld-1-0', 'Surge', 1); // 3rd token — within Migs's cap
    assert.equal(game.figurePowerTokens['Migs Mayfeld-1-0'].length, 3);
    assert.ok(!game.pendingPowerTokenOverflow, 'no overflow at 3 for Migs');
    // A 4th DOES overflow.
    grantPowerTokens(game, 'Migs Mayfeld-1-0', 'Evade', 1);
    assert.equal(game.pendingPowerTokenOverflow?.[0]?.discardCount, 1);
  });
});
