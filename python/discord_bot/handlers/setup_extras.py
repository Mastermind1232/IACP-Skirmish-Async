"""Additional setup-phase Discord handlers — thin validators.

  map_selection_{gameId}
  map_selection_draw_{gameId}
  map_selection_pick_{gameId}
  deployment_zone_red_{gameId}_{playerNum}
  deployment_zone_blue_{gameId}_{playerNum}
  deployment_orient_{...}
  deploy_pick_{gameId}_{playerNum}_{dcIdx}
  deploy_row_{gameId}_{playerNum}_{rowNum}
  deploy_row_back_{gameId}_{playerNum}
  loadout_select_{gameId}_{playerNum}
  loadout_confirm_{gameId}_{playerNum}
  form_pick_{gameId}_{playerNum}_{formId}
  setup_attach_to_{gameId}_{playerNum}
  attach_confirm_{gameId}_{playerNum}   (attach_done_redo still stub;
                                          heavy reverse-attachment flow)
  squad_confirm_{gameId}_{playerNum}
  squad_select_{gameId}_{playerNum}
  default_deck_{gameId}_{playerNum}_{deckKey}
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


def _make_game_handler(prefix: str
                         ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId} — any game participant OK."""
    assert prefix.endswith('_')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        if not cid.startswith(prefix):
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = cid[len(prefix):]
        if not game_id:
            return {'ok': False, 'reason': 'malformed_custom_id'}
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
        return {'ok': True, 'gameId': game_id,
                'action': prefix.rstrip('_')}

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


def _make_player_handler(prefix: str
                            ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}_{playerNum}[_{tail}] — owner-gated."""
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)_([12])(?:_(.+))?$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = m.group(1)
        player_num = int(m.group(2))
        tail = m.group(3) or ''
        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        user_id = _uid(interaction)
        owner_id = data.get(f'player{player_num}Id')
        if user_id and str(user_id) != str(owner_id or ''):
            return {'ok': False, 'reason': 'not_owner'}
        return {
            'ok': True, 'gameId': game_id, 'playerNum': player_num,
            'tail': tail, 'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_map_selection = _make_game_handler('map_selection_')
_handle_map_selection_draw = _make_game_handler('map_selection_draw_')
_handle_map_selection_pick = _make_game_handler('map_selection_pick_')
_handle_deployment_zone_red = _make_player_handler('deployment_zone_red_')
_handle_deployment_zone_blue = _make_player_handler('deployment_zone_blue_')
_handle_deployment_orient = _make_player_handler('deployment_orient_')
_handle_deploy_pick = _make_player_handler('deploy_pick_')
_handle_deploy_row = _make_player_handler('deploy_row_')
_handle_deploy_row_back = _make_player_handler('deploy_row_back_')
_handle_loadout_select = _make_player_handler('loadout_select_')
_handle_loadout_confirm = _make_player_handler('loadout_confirm_')
_handle_form_pick = _make_player_handler('form_pick_')
_handle_setup_attach_to = _make_player_handler('setup_attach_to_')
_handle_attach_confirm = _make_player_handler('attach_confirm_')
_handle_attach_done_redo = _make_player_handler('attach_done_redo_')
_handle_squad_confirm = _make_player_handler('squad_confirm_')
_handle_squad_select = _make_player_handler('squad_select_')
_handle_default_deck = _make_player_handler('default_deck_')


register('map_selection_', _handle_map_selection, 'core')
register('map_selection_draw_', _handle_map_selection_draw, 'core')
register('map_selection_pick_', _handle_map_selection_pick, 'core')
register('deployment_zone_red_', _handle_deployment_zone_red, 'core')
register('deployment_zone_blue_', _handle_deployment_zone_blue, 'core')
register('deployment_orient_', _handle_deployment_orient, 'core')
register('deploy_pick_', _handle_deploy_pick, 'core')
register('deploy_row_', _handle_deploy_row, 'core')
register('deploy_row_back_', _handle_deploy_row_back, 'core')
register('loadout_select_', _handle_loadout_select, 'core')
register('loadout_confirm_', _handle_loadout_confirm, 'core')
register('form_pick_', _handle_form_pick, 'core')
register('setup_attach_to_', _handle_setup_attach_to, 'core')
register('attach_confirm_', _handle_attach_confirm, 'core')
register('attach_done_redo_', _handle_attach_done_redo, 'core')
register('squad_confirm_', _handle_squad_confirm, 'core')
register('squad_select_', _handle_squad_select, 'core')
register('default_deck_', _handle_default_deck, 'core')
