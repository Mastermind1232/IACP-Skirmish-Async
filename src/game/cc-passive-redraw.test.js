/**
 * Tests for CC Passive Redraw system.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveDiscardToHand,
  checkSurgePassiveRedraws,
  checkDeckDiscardPassiveRedraws,
  checkFriendlyDefeatedPassiveRedraws,
  checkStartOfRoundPassiveRedraws,
} from './cc-passive-redraw.js';

// ── moveDiscardToHand ────────────────────────────────────────────────────────

describe('moveDiscardToHand', () => {
  it('moves card from discard to hand for player 1', () => {
    const game = {
      player1CcDiscard: ['Card A', 'Knowledge and Defense', 'Card B'],
      player1CcHand: ['Card X'],
    };
    const result = moveDiscardToHand(game, 1, 'Knowledge and Defense');
    assert.strictEqual(result, true);
    assert.deepStrictEqual(game.player1CcDiscard, ['Card A', 'Card B']);
    assert.deepStrictEqual(game.player1CcHand, ['Card X', 'Knowledge and Defense']);
  });

  it('returns false if card not in discard', () => {
    const game = {
      player1CcDiscard: ['Card A'],
      player1CcHand: [],
    };
    const result = moveDiscardToHand(game, 1, 'Knowledge and Defense');
    assert.strictEqual(result, false);
    assert.deepStrictEqual(game.player1CcDiscard, ['Card A']);
  });

  it('handles empty discard and hand', () => {
    const game = {};
    const result = moveDiscardToHand(game, 2, 'Anything');
    assert.strictEqual(result, false);
  });
});

// ── checkSurgePassiveRedraws ─────────────────────────────────────────────────

describe('checkSurgePassiveRedraws', () => {
  // Mock getDcKeywords — these tests depend on the data-loader returning keywords.
  // Since we can't easily mock ES module imports without node_modules, we test the
  // pure logic by ensuring the function handles missing keywords gracefully.

  it('returns empty redrawn array when discard is empty', () => {
    const game = { player1CcDiscard: [], player1CcHand: [] };
    const result = checkSurgePassiveRedraws(game, 1, 'Some DC');
    assert.deepStrictEqual(result.redrawn, []);
  });

  it('returns empty redrawn array when no matching cards in discard', () => {
    const game = { player1CcDiscard: ['Unrelated Card'], player1CcHand: [] };
    const result = checkSurgePassiveRedraws(game, 1, 'Some DC');
    assert.deepStrictEqual(result.redrawn, []);
  });
});

// ── checkDeckDiscardPassiveRedraws ───────────────────────────────────────────

describe('checkDeckDiscardPassiveRedraws', () => {
  it('moves Built on Hope from discard to hand when discarded from deck', () => {
    const game = {
      player1CcDiscard: ['Built on Hope'],
      player1CcHand: ['Card X'],
    };
    const result = checkDeckDiscardPassiveRedraws(game, 1, 'Built on Hope');
    assert.deepStrictEqual(result.redrawn, ['Built on Hope']);
    assert.deepStrictEqual(game.player1CcDiscard, []);
    assert.deepStrictEqual(game.player1CcHand, ['Card X', 'Built on Hope']);
  });

  it('does not trigger for non-matching cards', () => {
    const game = {
      player1CcDiscard: ['Some Card'],
      player1CcHand: [],
    };
    const result = checkDeckDiscardPassiveRedraws(game, 1, 'Some Card');
    assert.deepStrictEqual(result.redrawn, []);
    assert.deepStrictEqual(game.player1CcDiscard, ['Some Card']);
  });

  it('does not trigger if Built on Hope is not in discard', () => {
    const game = {
      player1CcDiscard: [],
      player1CcHand: [],
    };
    const result = checkDeckDiscardPassiveRedraws(game, 1, 'Built on Hope');
    assert.deepStrictEqual(result.redrawn, []);
  });
});

// ── checkFriendlyDefeatedPassiveRedraws ─────────────────────────────────────

describe('checkFriendlyDefeatedPassiveRedraws', () => {
  it('returns empty redrawn array when discard is empty', () => {
    const game = { player1CcDiscard: [], player1CcHand: [] };
    const result = checkFriendlyDefeatedPassiveRedraws(game, 1, 'Some DC');
    assert.deepStrictEqual(result.redrawn, []);
  });

  it('returns empty when Shared Experience not in discard', () => {
    const game = { player1CcDiscard: ['Other Card'], player1CcHand: [] };
    const result = checkFriendlyDefeatedPassiveRedraws(game, 1, 'IG-88');
    assert.deepStrictEqual(result.redrawn, []);
  });
});

// ── checkStartOfRoundPassiveRedraws ─────────────────────────────────────────

describe('checkStartOfRoundPassiveRedraws', () => {
  it('moves Rebel Graffiti from discard to hand when Sabine Wren in army', () => {
    const game = {
      player1CcDiscard: ['Rebel Graffiti'],
      player1CcHand: [],
      p1DcList: [{ dcName: 'Sabine Wren', displayName: 'Sabine Wren' }],
    };
    const result = checkStartOfRoundPassiveRedraws(game, 1);
    assert.deepStrictEqual(result.redrawn, ['Rebel Graffiti']);
    assert.deepStrictEqual(game.player1CcDiscard, []);
    assert.deepStrictEqual(game.player1CcHand, ['Rebel Graffiti']);
  });

  it('does not trigger without Sabine Wren in army', () => {
    const game = {
      player1CcDiscard: ['Rebel Graffiti'],
      player1CcHand: [],
      p1DcList: [{ dcName: 'Luke Skywalker', displayName: 'Luke Skywalker' }],
    };
    const result = checkStartOfRoundPassiveRedraws(game, 1);
    assert.deepStrictEqual(result.redrawn, []);
    assert.deepStrictEqual(game.player1CcDiscard, ['Rebel Graffiti']);
  });

  it('does not trigger when Rebel Graffiti not in discard', () => {
    const game = {
      player1CcDiscard: [],
      player1CcHand: [],
      p1DcList: [{ dcName: 'Sabine Wren', displayName: 'Sabine Wren' }],
    };
    const result = checkStartOfRoundPassiveRedraws(game, 1);
    assert.deepStrictEqual(result.redrawn, []);
  });

  it('handles player 2 correctly', () => {
    const game = {
      player2CcDiscard: ['Rebel Graffiti'],
      player2CcHand: ['Card Y'],
      p2DcList: [{ dcName: 'Sabine Wren', displayName: 'Sabine Wren' }],
    };
    const result = checkStartOfRoundPassiveRedraws(game, 2);
    assert.deepStrictEqual(result.redrawn, ['Rebel Graffiti']);
    assert.deepStrictEqual(game.player2CcDiscard, []);
    assert.deepStrictEqual(game.player2CcHand, ['Card Y', 'Rebel Graffiti']);
  });
});
