export const handReducerHandlers = {
  DeckShuffled(state, payload) {
    const deckKey = payload.playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const discardKey = payload.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    // Shuffle discard into deck
    const shuffled = [...(state[discardKey] || [])];
    // Fisher-Yates (seeded externally if needed — for reducer, just accept the payload order)
    if (payload.newDeckOrder) {
      return { ...state, [deckKey]: payload.newDeckOrder, [discardKey]: [] };
    }
    return { ...state, [deckKey]: shuffled, [discardKey]: [] };
  },

  CardsDrawn(state, payload) {
    const deckKey = payload.playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = payload.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const deck = [...(state[deckKey] || [])];
    const hand = [...(state[handKey] || [])];
    const drawn = deck.splice(0, payload.count);
    hand.push(...drawn);
    return { ...state, [deckKey]: deck, [handKey]: hand };
  },

  CardPlayed(state, payload) {
    const handKey = payload.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const hand = (state[handKey] || []).filter(c => c !== payload.cardName);
    return { ...state, [handKey]: hand };
  },

  CardDiscarded(state, payload) {
    const handKey = payload.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discardKey = payload.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const hand = (state[handKey] || []).filter(c => c !== payload.cardName);
    const discard = [...(state[discardKey] || []), payload.cardName];
    return { ...state, [handKey]: hand, [discardKey]: discard };
  },

  NegationAttempted(state, payload) {
    return {
      ...state,
      pendingNegation: {
        playerNum: payload.playerNum,
        targetCardName: payload.targetCardName,
        resolved: false,
      },
    };
  },

  NegationResolved(state, payload) {
    const next = { ...state };
    delete next.pendingNegation;
    return next;
  },

  SquadSubmitted(state, payload) {
    const squadKey = payload.playerNum === 1 ? 'player1Squad' : 'player2Squad';
    return {
      ...state,
      [squadKey]: {
        affiliation: payload.affiliation,
        cards: payload.cards || [],
      },
    };
  },
};
