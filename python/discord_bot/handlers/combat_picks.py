"""Combat picker validators — thin ports for dice / target / CC picks
during combat.

Every handler validates participant + parses tail. Downstream combat
orchestration stays deferred.

  cleave_target_{gameId}_{targetIdx}
  cover_fire_discard_{gameId}_{type}_{idx}_{figureKey}
  guidance_systems_{gameId}_{tail}
  ct_reroll_{gameId}_{tail}   (Cross-Training reroll)
  rogue_one_token_{gameId}_{figureKey}_{tokenIndex}  (or _skip)
  figurehead_use_{gameId}
  figurehead_skip_{gameId}
  lasat_die_{gameId}_{dieIdx}
  lasat_face_{gameId}_{dieIdx}_{faceIdx}
  false_orders_atk_{gameId}_{msgId}_{targetIdx}
  false_orders_space_{gameId}_{tail}
  order_move_space_{gameId}_{tail}
  order_move_{gameId}_{officerMsgId}
  zillo_discard_{gameId}_{cardIdx}
  ud_deplete_use_{gameId}
  ud_deplete_skip_{gameId}
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict

from python.discord_bot.handlers import register


def _cid(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _uid(interaction: Any) -> str:
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return ''


def _make_game_tail_handler(prefix: str
                              ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}[_{tail}] — participant-gated validator."""
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)(?:_(.+))?$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = m.group(1)
        tail = m.group(2) or ''

        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        user_id = _uid(interaction)
        if user_id and str(user_id) not in (
            str(data.get('player1Id') or ''),
            str(data.get('player2Id') or ''),
        ):
            return {'ok': False, 'reason': 'not_a_player_in_game'}
        return {
            'ok': True, 'game': game, 'gameId': game_id, 'tail': tail,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_cleave_target = _make_game_tail_handler('cleave_target_')
_handle_cover_fire_discard = _make_game_tail_handler('cover_fire_discard_')
_handle_guidance_systems = _make_game_tail_handler('guidance_systems_')
_handle_ct_reroll = _make_game_tail_handler('ct_reroll_')
_handle_rogue_one_token = _make_game_tail_handler('rogue_one_token_')
_handle_figurehead_use = _make_game_tail_handler('figurehead_use_')
_handle_figurehead_skip = _make_game_tail_handler('figurehead_skip_')
_handle_lasat_die = _make_game_tail_handler('lasat_die_')
_handle_lasat_face = _make_game_tail_handler('lasat_face_')
_handle_false_orders_atk = _make_game_tail_handler('false_orders_atk_')
_handle_false_orders_space = _make_game_tail_handler('false_orders_space_')
_handle_order_move_space = _make_game_tail_handler('order_move_space_')
_handle_order_move = _make_game_tail_handler('order_move_')
_handle_zillo_discard = _make_game_tail_handler('zillo_discard_')
_handle_ud_deplete_use = _make_game_tail_handler('ud_deplete_use_')
_handle_ud_deplete_skip = _make_game_tail_handler('ud_deplete_skip_')


register('cleave_target_', _handle_cleave_target, 'core')
register('cover_fire_discard_', _handle_cover_fire_discard, 'core')
register('guidance_systems_', _handle_guidance_systems, 'core')
register('ct_reroll_', _handle_ct_reroll, 'core')
register('rogue_one_token_', _handle_rogue_one_token, 'core')
register('figurehead_use_', _handle_figurehead_use, 'core')
register('figurehead_skip_', _handle_figurehead_skip, 'core')
register('lasat_die_', _handle_lasat_die, 'core')
register('lasat_face_', _handle_lasat_face, 'core')
register('false_orders_atk_', _handle_false_orders_atk, 'core')
register('false_orders_space_', _handle_false_orders_space, 'core')
register('order_move_space_', _handle_order_move_space, 'core')
register('order_move_', _handle_order_move, 'core')
register('zillo_discard_', _handle_zillo_discard, 'core')
register('ud_deplete_use_', _handle_ud_deplete_use, 'core')
register('ud_deplete_skip_', _handle_ud_deplete_skip, 'core')
