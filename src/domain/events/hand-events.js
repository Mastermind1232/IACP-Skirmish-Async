export const HAND_EVENTS = {
  DeckShuffled: 'DeckShuffled',
  CardsDrawn: 'CardsDrawn',
  CardPlayed: 'CardPlayed',
  CardDiscarded: 'CardDiscarded',
  NegationAttempted: 'NegationAttempted',
  NegationResolved: 'NegationResolved',
  SquadSubmitted: 'SquadSubmitted',
};

export const HAND_EVENT_SCHEMAS = {
  DeckShuffled: { required: ['playerNum'] },
  CardsDrawn: { required: ['playerNum', 'count'] },
  CardPlayed: { required: ['playerNum', 'cardName'] },
  CardDiscarded: { required: ['playerNum', 'cardName'] },
  NegationAttempted: { required: ['playerNum', 'targetCardName'] },
  NegationResolved: { required: ['negated'] },
  SquadSubmitted: { required: ['playerNum', 'affiliation'] },
};
