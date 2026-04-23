"""Post-deploy Discord handlers — thin port of src/handlers/post-deploy.js.

Owns the simple pd_* prefixes that only touch scratch-state. The heavy
pd_* flows (arms_distribution token picker, companion deploy grid,
walker move flow) land when their full UI scaffolding does.

  pd_strike_token_done_{gameId}  — clears postDeployQueue.activeAbility
  pd_walker_skip_{gameId}        — clears postDeployQueue.activeAbility
                                    (same shape, different JS label)
"""
from __future__ import annotations

from typing import Any, Dict

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


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Any:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _clear_active_ability(interaction: Any, ctx: Dict[str, Any],
                           prefix: str) -> Dict[str, Any]:
    """Shared body for pd_strike_token_done_ / pd_walker_skip_ — both
    pop `postDeployQueue.activeAbility`. Owner check goes via
    `postDeployQueue.currentPlayerNum`.
    """
    cid = _cid(interaction)
    if not cid.startswith(prefix):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len(prefix):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    queue = data.get('postDeployQueue')
    if not queue:
        return {'ok': False, 'reason': 'no_post_deploy_queue'}

    current_pn = queue.get('currentPlayerNum')
    user_id = _uid(interaction)
    owner_id = data.get(f'player{current_pn}Id') if current_pn else None
    if user_id and owner_id and str(user_id) != str(owner_id):
        return {'ok': False, 'reason': 'not_owner'}

    queue['activeAbility'] = None
    data['postDeployQueue'] = queue

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'currentPlayerNum': current_pn,
    }


def _handle_pd_strike_token_done(interaction: Any,
                                   ctx: Dict[str, Any]) -> Dict[str, Any]:
    """pd_strike_token_done_{gameId} — strike-team token placement done.
    Mirrors src/handlers/post-deploy.js:1512-1533.
    """
    return _clear_active_ability(interaction, ctx, 'pd_strike_token_done_')


def _handle_pd_walker_skip(interaction: Any,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """pd_walker_skip_{gameId} — walker post-deploy move skipped.
    Mirrors src/handlers/post-deploy.js:1614-1648.
    """
    return _clear_active_ability(interaction, ctx, 'pd_walker_skip_')


register('pd_strike_token_done_', _handle_pd_strike_token_done, 'postDeploy')
register('pd_walker_skip_', _handle_pd_walker_skip, 'postDeploy')
