/**
 * [Smuggling Compartment] — pure logic for both abilities.
 *
 * Part 1 (reaction): exhaust to set aside any number of CCs from hand; return
 *   them at the start of the next activation or phase.
 * Part 2 (end of round): look at top and bottom of your Command deck; may move
 *   one of them to the top or bottom.
 *
 * alexanbv 2026-06-17: "wire both parts of SC."
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findSmugglingCompartmentMsgId,
  smugglingCompartmentPeek,
  applySmugglingCompartmentReorder,
  setAsideFromHand,
  returnSetAsideToHand,
  releaseSmugglingCompartmentSetAside,
  SMUGGLING_COMPARTMENT_NAME,
} from '../../../src/game/smuggling-compartment.js';

describe('Smuggling Compartment — detection', () => {
  it('finds the parallel msgId for an owned, usable card', () => {
    const dcList = [{ dcName: 'Han Solo' }, { dcName: SMUGGLING_COMPARTMENT_NAME }];
    const msgIds = ['m-han', 'm-sc'];
    assert.equal(findSmugglingCompartmentMsgId(dcList, msgIds), 'm-sc');
  });
  it('skips a defeated copy', () => {
    const dcList = [{ dcName: SMUGGLING_COMPARTMENT_NAME, defeated: true }];
    assert.equal(findSmugglingCompartmentMsgId(dcList, ['m-sc']), null);
  });
  it('skips a removed-from-game copy via the predicate', () => {
    const dcList = [{ dcName: SMUGGLING_COMPARTMENT_NAME }];
    const removed = (mid) => mid === 'm-sc';
    assert.equal(findSmugglingCompartmentMsgId(dcList, ['m-sc'], removed), null);
  });
  it('returns null when the card is not in the army', () => {
    assert.equal(findSmugglingCompartmentMsgId([{ dcName: 'Han Solo' }], ['m-han']), null);
  });
});

describe('Smuggling Compartment — Part 2 peek + reorder', () => {
  it('peeks the top and bottom cards', () => {
    assert.deepEqual(smugglingCompartmentPeek(['A', 'B', 'C', 'D']), { top: 'A', bottom: 'D', single: false });
  });
  it('flags a single-card deck (top equals bottom)', () => {
    assert.deepEqual(smugglingCompartmentPeek(['X']), { top: 'X', bottom: 'X', single: true });
  });
  it('returns null for an empty deck', () => {
    assert.equal(smugglingCompartmentPeek([]), null);
  });
  it('moves the top card to the bottom', () => {
    assert.deepEqual(applySmugglingCompartmentReorder(['A', 'B', 'C', 'D'], 'topToBottom'), ['B', 'C', 'D', 'A']);
  });
  it('moves the bottom card to the top', () => {
    assert.deepEqual(applySmugglingCompartmentReorder(['A', 'B', 'C', 'D'], 'bottomToTop'), ['D', 'A', 'B', 'C']);
  });
  it('leaves the deck unchanged on skip', () => {
    assert.deepEqual(applySmugglingCompartmentReorder(['A', 'B', 'C'], 'skip'), ['A', 'B', 'C']);
  });
  it('does not mutate the input array', () => {
    const deck = ['A', 'B', 'C'];
    applySmugglingCompartmentReorder(deck, 'topToBottom');
    assert.deepEqual(deck, ['A', 'B', 'C']);
  });
  it('returns a <2-card deck unchanged (no meaningful move)', () => {
    assert.deepEqual(applySmugglingCompartmentReorder(['A'], 'topToBottom'), ['A']);
  });
});

describe('Smuggling Compartment — Part 1 set aside + return', () => {
  it('sets aside chosen cards present in hand', () => {
    const { hand, setAside } = setAsideFromHand(['A', 'B', 'C', 'B'], ['B', 'C']);
    assert.deepEqual(setAside, ['B', 'C']);
    assert.deepEqual(hand, ['A', 'B']); // only one 'B' removed
  });
  it('ignores cards not in hand', () => {
    const { hand, setAside } = setAsideFromHand(['A'], ['Z']);
    assert.deepEqual(setAside, []);
    assert.deepEqual(hand, ['A']);
  });
  it('returns set-aside cards back to hand', () => {
    assert.deepEqual(returnSetAsideToHand(['A'], ['B', 'C']), ['A', 'B', 'C']);
  });
  it('round-trips hand → set aside → return', () => {
    const original = ['A', 'B', 'C'];
    const { hand, setAside } = setAsideFromHand(original, ['A', 'C']);
    assert.deepEqual(hand, ['B']);
    const restored = returnSetAsideToHand(hand, setAside);
    assert.deepEqual(restored.slice().sort(), original.slice().sort());
  });
});

describe('Smuggling Compartment — Part 1 release trigger', () => {
  it('returns each player\'s set-aside pile to hand and clears the piles', () => {
    const game = {
      player1CcHand: ['Keep1'],
      player2CcHand: ['Keep2'],
      smugglingCompartmentSetAside: { 1: ['Hidden A', 'Hidden B'], 2: ['Hidden C'] },
    };
    const released = releaseSmugglingCompartmentSetAside(game);
    assert.deepEqual(game.player1CcHand, ['Keep1', 'Hidden A', 'Hidden B']);
    assert.deepEqual(game.player2CcHand, ['Keep2', 'Hidden C']);
    assert.deepEqual(game.smugglingCompartmentSetAside, {});
    assert.equal(released.length, 2);
  });
  it('is a no-op when nothing is set aside', () => {
    const game = { player1CcHand: ['X'] };
    assert.deepEqual(releaseSmugglingCompartmentSetAside(game), []);
    assert.deepEqual(game.player1CcHand, ['X']);
  });
  it('skips empty piles', () => {
    const game = { player1CcHand: [], smugglingCompartmentSetAside: { 1: [] } };
    assert.deepEqual(releaseSmugglingCompartmentSetAside(game), []);
  });
});
