"""Pure-state CC hand engine layer. Mirrors src/handlers/cc-hand.js
state mutations sans Discord IO.

Deck primitives (draw, discard, shuffle) live in
python/engine/cards/deck.py; this module wraps them with the higher-level
hand operations the Discord handlers call: select-to-play, attach,
confirm-play, discard-select, shuffle-draw.

  - select_card_to_play: pendingCcConfirmation stamp.
  - cancel_pending_play: clear pendingCcConfirmation.
  - attach_cc_to_dc: hand → attachments[msg_id].
  - confirm_play_cc: legality check + hand → discard, fans into resolve_ability.
  - discard_card_from_hand: hand → discard (manual discard).
  - shuffle_draw: discard → deck → shuffle, draw `n`.
  - draw_with_reshuffle: thin re-export of cards/deck draw_with_reshuffle.

Higher-level CC reaction-card timing lives in
python/engine/cc_timing.py (P1.16).
"""
from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from python.engine.cards.deck import (
    discard_from_hand,
    draw_cc_cards,
    draw_with_reshuffle,
    shuffle_discard_into_deck,
)
from python.engine.mechanics.player_helpers import (
    cc_attachments_key,
    cc_discard_key,
    cc_hand_key,
)


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


# ---------------------------------------------------------------------------
# Pending-play / confirmation


def select_card_to_play(game: Any, *, player_num: int, card: str
                        ) -> Dict[str, Any]:
    """Stamp pendingCcConfirmation. Caller will trigger Discord preview UI.

    Returns:
      {'ok': True, 'card': ...}
      {'ok': False, 'code': 'not_in_hand', ...}
    """
    data = _data(game)
    hand = list(data.get(cc_hand_key(player_num)) or [])
    if card not in hand:
        return {'ok': False, 'code': 'not_in_hand',
                'message': "That card isn't in your hand."}
    data['pendingCcConfirmation'] = {'playerNum': player_num, 'card': card}
    return {'ok': True, 'card': card}


def cancel_pending_play(game: Any) -> bool:
    """Clear pendingCcConfirmation. Returns True if anything was cleared."""
    data = _data(game)
    if data.get('pendingCcConfirmation'):
        data['pendingCcConfirmation'] = None
        return True
    return False


# ---------------------------------------------------------------------------
# Attach


def attach_cc_to_dc(game: Any, *, player_num: int, card: str,
                    msg_id: str) -> Dict[str, Any]:
    """Move `card` from hand to ccAttachments[msg_id] list.

    Returns:
      {'ok': True, 'attachments': <updated list>}
      {'ok': False, 'code': 'not_in_hand', ...}
    """
    data = _data(game)
    hand_k = cc_hand_key(player_num)
    hand = list(data.get(hand_k) or [])
    if card not in hand:
        # Clear pending if stale.
        data['pendingCcAttachment'] = None
        return {'ok': False, 'code': 'not_in_hand',
                'message': 'That card is no longer in your hand.'}

    hand.remove(card)
    data[hand_k] = hand

    attach_k = cc_attachments_key(player_num)
    attachments = data.get(attach_k)
    if not isinstance(attachments, dict):
        attachments = {}
        data[attach_k] = attachments
    msg_attachments = attachments.get(msg_id)
    if not isinstance(msg_attachments, list):
        msg_attachments = []
        attachments[msg_id] = msg_attachments
    msg_attachments.append(card)

    data['pendingCcAttachment'] = None

    return {'ok': True, 'card': card, 'attachments': list(msg_attachments)}


# ---------------------------------------------------------------------------
# Confirm play (hand → discard)


def confirm_play_cc(game: Any, *, player_num: int, card: str
                    ) -> Dict[str, Any]:
    """Move `card` from hand to discard pile. Mirrors the state-mutation
    portion of handleCcConfirmPlay; legality / restriction checks remain
    the caller's responsibility (legalActions or pre-check).

    Returns:
      {'ok': True, 'card': ...}
      {'ok': False, 'code': 'not_in_hand', ...}
    """
    data = _data(game)
    if not discard_from_hand(game, player_num, card):
        return {'ok': False, 'code': 'not_in_hand',
                'message': f'**{card}** is not in your hand.'}
    data['pendingCcConfirmation'] = None
    return {'ok': True, 'card': card}


# ---------------------------------------------------------------------------
# Manual discard from hand (Negation, Comm Disruption, etc.)


def discard_card_from_hand(game: Any, *, player_num: int, card: str
                           ) -> Dict[str, Any]:
    """Send `card` from hand to discard, no play-effect.

    Returns:
      {'ok': True, 'card': ...}
      {'ok': False, 'code': 'not_in_hand', ...}
    """
    if not discard_from_hand(game, player_num, card):
        return {'ok': False, 'code': 'not_in_hand',
                'message': f'**{card}** is not in your hand.'}
    return {'ok': True, 'card': card}


# ---------------------------------------------------------------------------
# Shuffle-then-draw (Reorganize Forces, Combat Resupply, etc.)


def shuffle_draw(game: Any, *, player_num: int, draw_n: int = 1,
                 rng: Optional[random.Random] = None) -> Dict[str, Any]:
    """Move discard → deck, shuffle deck, draw `draw_n` cards.

    Returns:
      {'shuffled': <count>, 'drew': [...]}
    """
    moved = shuffle_discard_into_deck(game, player_num, rng=rng)
    drew = draw_cc_cards(game, player_num, draw_n) if draw_n > 0 else []
    return {'shuffled': moved, 'drew': drew}


# ---------------------------------------------------------------------------
# Top-level draw with reshuffle (re-export for callers)


__all__ = [
    'select_card_to_play',
    'cancel_pending_play',
    'attach_cc_to_dc',
    'confirm_play_cc',
    'discard_card_from_hand',
    'shuffle_draw',
    'draw_with_reshuffle',
]
