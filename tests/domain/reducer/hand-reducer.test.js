import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handReducerHandlers } from '../../../src/domain/reducer/hand-reducer.js';

describe('Hand Reducer', () => {
  it('draw → play → discard lifecycle', () => {
    let state = {
      player1CcDeck: ['Card A', 'Card B', 'Card C', 'Card D', 'Card E'],
      player1CcHand: [],
      player1CcDiscard: [],
    };

    state = handReducerHandlers.CardsDrawn(state, { playerNum: 1, count: 3 });
    assert.deepEqual(state.player1CcHand, ['Card A', 'Card B', 'Card C']);
    assert.deepEqual(state.player1CcDeck, ['Card D', 'Card E']);

    state = handReducerHandlers.CardPlayed(state, { playerNum: 1, cardName: 'Card B' });
    assert.deepEqual(state.player1CcHand, ['Card A', 'Card C']);

    state = handReducerHandlers.CardDiscarded(state, { playerNum: 1, cardName: 'Card A' });
    assert.deepEqual(state.player1CcHand, ['Card C']);
    assert.deepEqual(state.player1CcDiscard, ['Card A']);
  });

  it('negation lifecycle: attempt → resolve', () => {
    let state = {};

    state = handReducerHandlers.NegationAttempted(state, {
      playerNum: 2, targetCardName: 'Take Initiative',
    });
    assert.ok(state.pendingNegation);
    assert.equal(state.pendingNegation.playerNum, 2);

    state = handReducerHandlers.NegationResolved(state, { negated: true });
    assert.equal(state.pendingNegation, undefined);
  });

  it('squad submitted', () => {
    let state = {};
    state = handReducerHandlers.SquadSubmitted(state, {
      playerNum: 1, affiliation: 'IMPERIAL', cards: ['Stormtrooper', 'Vader'],
    });
    assert.deepEqual(state.player1Squad, { affiliation: 'IMPERIAL', cards: ['Stormtrooper', 'Vader'] });
  });

  it('deck shuffled with explicit order', () => {
    let state = {
      player1CcDeck: [],
      player1CcDiscard: ['X', 'Y', 'Z'],
    };
    state = handReducerHandlers.DeckShuffled(state, {
      playerNum: 1, newDeckOrder: ['Z', 'X', 'Y'],
    });
    assert.deepEqual(state.player1CcDeck, ['Z', 'X', 'Y']);
    assert.deepEqual(state.player1CcDiscard, []);
  });
});
