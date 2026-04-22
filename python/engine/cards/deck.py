"""CC deck / hand / discard pile operations — Python mirror of the deck
primitives scattered across src/game/abilities.js (drawCcCards) and
src/handlers/round.js (CC draw phase).

Scope (C5-A skeleton):
  - draw_cc_cards(game, player_num, n): pull up to n from deck top into hand
  - discard_from_hand(game, player_num, card_name): remove from hand → discard
  - discard_from_deck_top(game, player_num, n): drain n from top → discard
  - shuffle_deck(game, player_num, rng): in-place Fisher-Yates
  - shuffle_discard_into_deck(game, player_num, rng): empties discard → deck,
    shuffles deck
  - hand_size / deck_size / discard_size

Uses JS-native field names (player1CcHand/CcDeck/CcDiscard) via
player_helpers key-lookup functions so the state shape remains
parity-compatible during the JS port window.
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from python.engine.mechanics.player_helpers import (
    cc_deck_key,
    cc_discard_key,
    cc_hand_key,
)


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'cards.deck expected GameState or dict, got {type(game).__name__}'
    )


# ---------------------------------------------------------------------------
# Size helpers

def hand_size(game: Any, player_num: int) -> int:
    data = _data(game)
    return len(data.get(cc_hand_key(player_num)) or [])


def deck_size(game: Any, player_num: int) -> int:
    data = _data(game)
    return len(data.get(cc_deck_key(player_num)) or [])


def discard_size(game: Any, player_num: int) -> int:
    data = _data(game)
    return len(data.get(cc_discard_key(player_num)) or [])


# ---------------------------------------------------------------------------
# Draw / discard

def draw_cc_cards(game: Any, player_num: int, n: int) -> List[str]:
    """Shift up to `n` cards from the deck top into hand. Mirrors
    src/game/abilities.js:drawCcCards byte-for-byte.

    Returns the list of cards actually drawn (may be shorter than n when
    the deck is short).
    """
    if n <= 0:
        return []
    data = _data(game)
    deck_k = cc_deck_key(player_num)
    hand_k = cc_hand_key(player_num)
    deck = list(data.get(deck_k) or [])
    hand = list(data.get(hand_k) or [])
    drew: List[str] = []
    for _ in range(n):
        if not deck:
            break
        card = deck.pop(0)
        hand.append(card)
        drew.append(card)
    data[deck_k] = deck
    data[hand_k] = hand
    return drew


def discard_from_hand(game: Any, player_num: int, card_name: str) -> bool:
    """Remove the first matching `card_name` from hand, push to discard pile.

    Returns True when discarded, False if the card wasn't in hand.
    """
    data = _data(game)
    hand_k = cc_hand_key(player_num)
    disc_k = cc_discard_key(player_num)
    hand = list(data.get(hand_k) or [])
    if card_name not in hand:
        return False
    hand.remove(card_name)
    data[hand_k] = hand
    discard = list(data.get(disc_k) or [])
    discard.append(card_name)
    data[disc_k] = discard
    return True


def discard_from_deck_top(game: Any, player_num: int, n: int) -> List[str]:
    """Drain `n` cards from deck top into discard pile. Returns the cards."""
    if n <= 0:
        return []
    data = _data(game)
    deck_k = cc_deck_key(player_num)
    disc_k = cc_discard_key(player_num)
    deck = list(data.get(deck_k) or [])
    discard = list(data.get(disc_k) or [])
    drained: List[str] = []
    for _ in range(n):
        if not deck:
            break
        card = deck.pop(0)
        discard.append(card)
        drained.append(card)
    data[deck_k] = deck
    data[disc_k] = discard
    return drained


def draw_to_hand_size(game: Any, player_num: int, target: int) -> List[str]:
    """Draw cards until hand reaches `target` size (or deck empty). Returns drawn."""
    current = hand_size(game, player_num)
    needed = max(0, target - current)
    return draw_cc_cards(game, player_num, needed) if needed else []


# ---------------------------------------------------------------------------
# Shuffle

def shuffle_deck(game: Any, player_num: int,
                 rng: Optional[random.Random] = None) -> None:
    """In-place Fisher-Yates shuffle of the deck. Uses `rng` if given."""
    data = _data(game)
    deck_k = cc_deck_key(player_num)
    deck = list(data.get(deck_k) or [])
    r = rng if rng is not None else random
    r.shuffle(deck)
    data[deck_k] = deck


def shuffle_discard_into_deck(game: Any, player_num: int,
                              rng: Optional[random.Random] = None) -> int:
    """Move all cards from discard pile into deck, then shuffle.

    Returns the number of cards moved.
    """
    data = _data(game)
    deck_k = cc_deck_key(player_num)
    disc_k = cc_discard_key(player_num)
    discard = list(data.get(disc_k) or [])
    if not discard:
        return 0
    deck = list(data.get(deck_k) or [])
    deck.extend(discard)
    data[disc_k] = []
    data[deck_k] = deck
    shuffle_deck(game, player_num, rng=rng)
    return len(discard)


# ---------------------------------------------------------------------------
# Draw with optional reshuffle fallback

def draw_with_reshuffle(game: Any, player_num: int, n: int,
                        rng: Optional[random.Random] = None) -> List[str]:
    """Draw n cards; when deck runs out, reshuffle discard pile in and keep drawing.

    Mirrors the common CC-draw pattern used outside the initial setup window
    (where deck is guaranteed pre-shuffled and full).
    """
    if n <= 0:
        return []
    drew = draw_cc_cards(game, player_num, n)
    if len(drew) >= n:
        return drew
    # Deck emptied mid-draw → reshuffle discard and continue
    shuffle_discard_into_deck(game, player_num, rng=rng)
    remaining = n - len(drew)
    drew.extend(draw_cc_cards(game, player_num, remaining))
    return drew
