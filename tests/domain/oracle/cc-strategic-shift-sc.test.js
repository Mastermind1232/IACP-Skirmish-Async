/**
 * Strategic Shift × [Smuggling Compartment] — post-choice hand protection.
 *
 * Strategic Shift (chosen player shuffles hand into deck, then draws 2) picks
 * its target MID-effect, so SC must be offered AFTER the choice, to the chosen
 * player. The engine signals this by returning `requiresScHandProtection`
 * (instead of shuffling) when the chosen player owns an un-exhausted
 * [Smuggling Compartment] and has cards — unless the resume passes _scResolved.
 *
 * The Discord wiring (handleCcChoice → sc_ss_* handlers) offers the set-aside
 * and re-resolves with _scResolved; this test covers the engine contract.
 * alexanbv 2026-06-17 ("SC fires before any hand-affecting effect"); the named
 * SC-4-CCs set (Stall for Time, Collect Intel, Intelligence Leak, Strategic
 * Shift) — Strategic Shift was the last one open.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// Player 1 plays Strategic Shift targeting Player 2 (choiceIndex 1). Player 2
// owns an un-exhausted [Smuggling Compartment] + a hand to protect.
function gameWithScOwner({ scOwned = true, exhausted = false } = {}) {
  return {
    gameId: 'g1',
    player2CcHand: ['A', 'B', 'C'],
    player2CcDeck: ['D', 'E', 'F'],
    p2DcList: scOwned ? [{ dcName: '[Smuggling Compartment]' }] : [{ dcName: 'Han Solo' }],
    p2DcMessageIds: ['m-sc'],
    exhaustedSkirmishUpgrades: exhausted ? { 'm-sc': ['Smuggling Compartment'] } : {},
  };
}

describe('Strategic Shift — [Smuggling Compartment] post-choice protection', () => {
  it('defers (requiresScHandProtection) when the chosen player owns a usable SC', async () => {
    const { resolveAbility } = await import(resolve(ROOT, 'src/game/abilities.js'));
    const game = gameWithScOwner();
    const r = resolveAbility('Strategic Shift', { game, playerNum: 1, choiceIndex: 1 });
    assert.equal(r.applied, false, 'does not apply yet — protection pending');
    assert.ok(r.requiresScHandProtection, 'signals the SC protection step');
    assert.equal(r.requiresScHandProtection.ownerNum, 2, 'protects the CHOSEN player');
    // The hand must be untouched — the shuffle has NOT happened.
    assert.deepEqual(game.player2CcHand, ['A', 'B', 'C'], 'hand not shuffled before SC resolves');
  });

  it('proceeds with the shuffle once _scResolved is set (resume path)', async () => {
    const { resolveAbility } = await import(resolve(ROOT, 'src/game/abilities.js'));
    const game = gameWithScOwner();
    const r = resolveAbility('Strategic Shift', { game, playerNum: 1, choiceIndex: 1, _scResolved: true });
    assert.equal(r.applied, true, 'applies the shuffle on resume');
    assert.equal(game.player2CcHand.length, 2, 'chosen player drew 2 after shuffling hand away');
  });

  it('does NOT defer when the chosen player has no usable SC (shuffles directly)', async () => {
    const { resolveAbility } = await import(resolve(ROOT, 'src/game/abilities.js'));
    const game = gameWithScOwner({ scOwned: false });
    const r = resolveAbility('Strategic Shift', { game, playerNum: 1, choiceIndex: 1 });
    assert.equal(r.applied, true, 'no SC → shuffle resolves immediately');
    assert.ok(!r.requiresScHandProtection, 'no protection step offered');
  });

  it('does NOT defer when the chosen player\'s SC is already exhausted', async () => {
    const { resolveAbility } = await import(resolve(ROOT, 'src/game/abilities.js'));
    const game = gameWithScOwner({ exhausted: true });
    const r = resolveAbility('Strategic Shift', { game, playerNum: 1, choiceIndex: 1 });
    assert.equal(r.applied, true, 'exhausted SC → shuffle resolves immediately');
    assert.ok(!r.requiresScHandProtection);
  });
});
