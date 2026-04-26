"""Slash command handlers — pure Python, no discord.py imports.

These functions implement the business logic behind the bot's slash
commands (/startgame, /squad, /status, /forfeit, etc.). The Discord
event wiring in main.py attaches them to discord.Client's
command tree; tests exercise them directly.

Each command takes (user_id, deps, **params) and returns a dict with
at minimum {'ok': bool} plus command-specific fields.
"""
from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

from python.discord_bot.game_lifecycle import (
    end_game,
    format_game_status,
    is_game_over,
    new_game,
    setup_game,
)


def _game_store(deps: Dict[str, Any]):
    return deps.get('game_store') or deps.get('_store')


def _save(deps: Dict[str, Any], game_id: str, game: Any) -> None:
    store = _game_store(deps)
    if store is None:
        return
    if hasattr(store, 'save'):
        store.save(game_id, game)
    elif isinstance(store, dict):
        store[game_id] = game


def _get(deps: Dict[str, Any], game_id: str) -> Any:
    store = _game_store(deps)
    if store is None:
        return None
    if hasattr(store, 'get'):
        return store.get(game_id)
    if isinstance(store, dict):
        return store.get(game_id)
    return None


def cmd_startgame(user_id: str, deps: Dict[str, Any], *,
                  opponent_id: str,
                  game_id: Optional[str] = None,
                  guild_id: Optional[str] = None) -> Dict[str, Any]:
    """Start a new game between user_id (P1) and opponent_id (P2).

    Creates a GameState with phase='lobby'. When `guild_id` is supplied,
    also creates the full Discord channel set (board, log, per-player
    play areas, hand threads) and binds them to the game via
    game_channels. Caller follows up with cmd_squad × 2 + cmd_startbattle.
    """
    if not user_id or not opponent_id:
        return {'ok': False, 'reason': 'missing_user_ids'}
    if user_id == opponent_id:
        return {'ok': False, 'reason': 'cannot_play_self'}
    gid = game_id or _default_game_id(user_id, opponent_id)
    if _get(deps, gid) is not None:
        return {'ok': False, 'reason': 'game_id_taken', 'gameId': gid}
    g = new_game(user_id, opponent_id, game_id=gid)
    _save(deps, gid, g)

    channels: Dict[str, Any] = {}
    if guild_id:
        try:
            from python.discord_bot import game_channels as gc
            from python.discord_bot.channel_factory import (
                create_game_channels,
            )
            factory = deps.get('channel_factory')
            channels = create_game_channels(
                gid, guild_id, user_id, opponent_id, backend=factory,
            )
            if channels.get('board_channel_id'):
                gc.set_board_message(gid, channels['board_channel_id'], None)
            if channels.get('log_channel_id'):
                gc.set_log_channel(gid, channels['log_channel_id'])
            if channels.get('p1_play_area_channel_id'):
                gc.set_play_area(gid, 1, channels['p1_play_area_channel_id'])
            if channels.get('p2_play_area_channel_id'):
                gc.set_play_area(gid, 2, channels['p2_play_area_channel_id'])
            if channels.get('p1_hand_channel_id'):
                gc.set_hand_channel(gid, 1, channels['p1_hand_channel_id'])
            if channels.get('p2_hand_channel_id'):
                gc.set_hand_channel(gid, 2, channels['p2_hand_channel_id'])
        except Exception:
            pass

    return {
        'ok': True, 'gameId': gid, 'player1Id': user_id,
        'player2Id': opponent_id, 'phase': 'lobby',
        'channels': channels,
    }


def cmd_squad(user_id: str, deps: Dict[str, Any], *,
              game_id: str,
              deployment_cards: list,
              cc_cards: Optional[list] = None) -> Dict[str, Any]:
    """Submit this user's squad for game_id. Stores under
    player{1|2}Squad based on the player's slot.
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if game.data.get('phase') != 'lobby':
        return {'ok': False, 'reason': 'game_not_in_lobby'}
    if user_id == game.data.get('player1Id'):
        slot = 1
    elif user_id == game.data.get('player2Id'):
        slot = 2
    else:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    squad = {'deploymentCards': list(deployment_cards)}
    if cc_cards:
        squad['ccCards'] = list(cc_cards)
    game.data[f'player{slot}Squad'] = squad
    _save(deps, game_id, game)
    both_in = bool(
        game.data.get('player1Squad') and game.data.get('player2Squad')
    )
    return {
        'ok': True, 'gameId': game_id, 'playerNum': slot,
        'bothSquadsSubmitted': both_in,
    }


def cmd_startbattle(user_id: str, deps: Dict[str, Any], *,
                    game_id: str,
                    map_id: str,
                    variant: str = 'a',
                    zone: str = 'red') -> Dict[str, Any]:
    """Transition game from lobby → round_active by running setup.

    Requires both squads submitted. Map + variant + zone chosen by the
    initiative player (usually).
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if game.data.get('phase') != 'lobby':
        return {'ok': False, 'reason': 'game_not_in_lobby'}
    p1_squad = game.data.get('player1Squad')
    p2_squad = game.data.get('player2Squad')
    if not p1_squad or not p2_squad:
        return {'ok': False, 'reason': 'squads_not_submitted'}
    if user_id not in (game.data.get('player1Id'), game.data.get('player2Id')):
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    game = setup_game(game, p1_squad, p2_squad, map_id, variant=variant, zone=zone)
    _save(deps, game_id, game)
    _refresh_discord_views(game_id, game, deps)
    return {
        'ok': True, 'gameId': game_id,
        'phase': game.data.get('phase'),
        'round': game.data.get('round'),
        'activePlayer': game.data.get('activePlayer'),
        'initiativeHolder': game.data.get('initiativeHolder'),
    }


def cmd_status(user_id: str, deps: Dict[str, Any], *,
               game_id: str) -> Dict[str, Any]:
    """Return a snapshot of the game for embed rendering."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    status = format_game_status(game)
    return {'ok': True, 'gameId': game_id, 'status': status}


def cmd_forfeit(user_id: str, deps: Dict[str, Any], *,
                game_id: str) -> Dict[str, Any]:
    """Forfeit the game — user_id loses, opponent wins."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if is_game_over(game):
        return {'ok': False, 'reason': 'game_already_ended'}
    if user_id == game.data.get('player1Id'):
        loser = 1
    elif user_id == game.data.get('player2Id'):
        loser = 2
    else:
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    winner = 2 if loser == 1 else 1
    game = end_game(game, winner=winner, reason='forfeit')
    _save(deps, game_id, game)
    return {
        'ok': True, 'gameId': game_id, 'winner': winner,
        'reason': 'forfeit', 'forfeitedBy': loser,
    }


def cmd_list_games(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    """List all games where user_id is a player."""
    store = _game_store(deps)
    if store is None:
        return {'ok': False, 'reason': 'no_game_store'}
    if hasattr(store, 'list_ids'):
        ids = store.list_ids()
    elif isinstance(store, dict):
        ids = list(store.keys())
    else:
        return {'ok': False, 'reason': 'no_list_method'}
    mine = []
    for gid in ids:
        g = _get(deps, gid)
        if g is None:
            continue
        if user_id in (g.data.get('player1Id'), g.data.get('player2Id')):
            mine.append({
                'gameId': gid,
                'status': format_game_status(g),
            })
    return {'ok': True, 'userId': user_id, 'games': mine}


def cmd_step_action(user_id: str, deps: Dict[str, Any], *,
                    game_id: str,
                    action_type: str,
                    action_params: Optional[Mapping[str, Any]] = None,
                    player_num: Optional[int] = None) -> Dict[str, Any]:
    """Apply a single Action to the game via the stepper. Returns the
    updated status + whether the game ended.

    After successful mutation, calls refresh_game_view to update the
    Discord board message (via deps['channel_backend']) and
    refresh_hand_view for both players (so CC draws / plays reflect).

    This is the slash-command front door to the game engine's step().
    Action parameters are validated by the stepper; illegal actions
    return {ok: False, reason: 'stepper_error', error: str}.
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if game.data.get('phase') == 'game_over':
        return {'ok': False, 'reason': 'game_already_ended'}
    if user_id not in (game.data.get('player1Id'), game.data.get('player2Id')):
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    # Resolve player_num from user_id if not explicit.
    if player_num is None:
        if user_id == game.data.get('player1Id'):
            player_num = 1
        else:
            player_num = 2

    from python.engine.actions import ActionType
    from python.engine.stepper import Action, step
    try:
        at = ActionType(action_type)
    except ValueError:
        return {'ok': False, 'reason': 'unknown_action_type',
                'actionType': action_type}
    action = Action(type=at, player=player_num,
                     params=dict(action_params or {}))
    # Snapshot before for log-diff.
    import copy
    before = copy.deepcopy(game)
    try:
        new_game = step(game, action)
    except Exception as e:
        return {
            'ok': False, 'reason': 'stepper_error',
            'error': f'{type(e).__name__}: {e}',
            'actionType': action_type,
        }
    _save(deps, game_id, new_game)

    # Post action-log entries for what changed.
    _log_step_event(game_id, before, new_game, action_type,
                     action_params or {}, player_num, deps)

    # On game-over transitions, write a completed_games row for stats.
    b_phase = (before.data if hasattr(before, 'data') else before).get('phase')
    a_phase = (
        new_game.data if hasattr(new_game, 'data') else new_game
    ).get('phase')
    if a_phase == 'game_over' and b_phase != 'game_over':
        _write_completed_game(new_game, deps)

    # Refresh the Discord board message + both hand messages. No-op when
    # the bot hasn't tracked channels for this game yet (headless tests).
    _refresh_discord_views(game_id, new_game, deps)

    return {
        'ok': True, 'gameId': game_id,
        'actionType': action_type,
        'status': format_game_status(new_game),
        'gameEnded': is_game_over(new_game),
    }


def _refresh_discord_views(game_id: str, game: Any,
                            deps: Dict[str, Any]) -> None:
    """Refresh the main game view + both hand views. Silent on error."""
    try:
        from python.discord_bot import game_channels as gc
        backend = deps.get('channel_backend')
        gc.refresh_game_view(game_id, game, backend=backend)
        gc.refresh_hand_view(game_id, 1, game, backend=backend)
        gc.refresh_hand_view(game_id, 2, game, backend=backend)
    except Exception:
        pass


def _write_completed_game(game: Any, deps: Dict[str, Any]) -> None:
    """Write a completed_games row via PostgresStore.insert_completed_game
    when the underlying store supports it. Silent no-op otherwise.
    """
    store = deps.get('game_store') or deps.get('_store')
    if store is None:
        return
    insert = getattr(store, 'insert_completed_game', None)
    if not callable(insert):
        return
    try:
        insert(game)
    except Exception:
        pass


def _log_step_event(game_id: str, before: Any, after: Any,
                     action_type: str, action_params: Mapping[str, Any],
                     player_num: int, deps: Dict[str, Any]) -> None:
    """Post game-log entries describing what changed between before/after.

    Silent on error. Uses the channel_backend from deps if supplied.
    """
    try:
        from python.discord_bot import game_log
        backend = deps.get('channel_backend')

        b_data = before.data if hasattr(before, 'data') else before
        a_data = after.data if hasattr(after, 'data') else after

        # Round transition.
        b_round = b_data.get('round')
        a_round = a_data.get('round')
        if a_round and a_round != b_round:
            game_log.log_round_transition(game_id, a_round, backend=backend)

        # Activation.
        if action_type == 'activate_dc':
            fk = action_params.get('figure_key') or action_params.get('figureKey')
            if fk:
                game_log.log_activation(game_id, fk, player_num, backend=backend)

        # CC play.
        if action_type == 'play_cc':
            card = action_params.get('card') or action_params.get('cardName')
            if card:
                game_log.log_cc_play(game_id, player_num, card, backend=backend)

        # DC special.
        if action_type == 'dc_special':
            fk = action_params.get('figure_key') or action_params.get('figureKey')
            result = a_data.get('lastDcSpecialResult') or {}
            label = result.get('abilityId', 'special ability')
            if fk:
                game_log.log_dc_special(game_id, fk, label, backend=backend)

        # Attack (via ATTACK_TARGET direct path).
        if action_type == 'attack_target':
            result = a_data.get('lastAttackOrchestration') or {}
            attacker = action_params.get('attacker_key') or ''
            target = action_params.get('target_key') or ''
            damage = int(result.get('damage') or 0)
            defeated = bool(result.get('defeated'))
            if attacker and target:
                game_log.log_attack(game_id, attacker, target, damage,
                                     defeated=defeated, backend=backend)

        # VP award detection.
        for pn in (1, 2):
            b_vp = int(((b_data.get(f'player{pn}VP') or {}).get('total') or 0))
            a_vp = int(((a_data.get(f'player{pn}VP') or {}).get('total') or 0))
            delta = a_vp - b_vp
            if delta > 0:
                game_log.log_vp_award(game_id, pn, delta,
                                       reason=action_type, backend=backend)

        # Game over.
        if a_data.get('phase') == 'game_over' and b_data.get('phase') != 'game_over':
            game_log.log_game_over(
                game_id,
                a_data.get('winner'),
                a_data.get('gameEndedReason') or 'unknown',
                backend=backend,
            )
    except Exception:
        pass


def cmd_setup_channels(user_id: str, deps: Dict[str, Any], *,
                        game_id: str,
                        board_channel_id: Optional[str] = None,
                        log_channel_id: Optional[str] = None,
                        p1_play_area_channel_id: Optional[str] = None,
                        p2_play_area_channel_id: Optional[str] = None,
                        p1_hand_channel_id: Optional[str] = None,
                        p2_hand_channel_id: Optional[str] = None
                        ) -> Dict[str, Any]:
    """Bind a game to a set of Discord channels.

    Called once per game during setup — either by the setup-command
    handler or a dedicated /setupchannels slash command. Only non-None
    fields are updated; existing assignments are preserved.

    After setup, cmd_step_action + cmd_startbattle can refresh the
    board message automatically.
    """
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if user_id not in (game.data.get('player1Id'), game.data.get('player2Id')):
        return {'ok': False, 'reason': 'not_a_player_in_game'}

    from python.discord_bot import game_channels as gc
    if board_channel_id is not None:
        gc.set_board_message(game_id, board_channel_id, None)
    if log_channel_id is not None:
        gc.set_log_channel(game_id, log_channel_id)
    if p1_play_area_channel_id is not None:
        gc.set_play_area(game_id, 1, p1_play_area_channel_id)
    if p2_play_area_channel_id is not None:
        gc.set_play_area(game_id, 2, p2_play_area_channel_id)
    if p1_hand_channel_id is not None:
        gc.set_hand_channel(game_id, 1, p1_hand_channel_id)
    if p2_hand_channel_id is not None:
        gc.set_hand_channel(game_id, 2, p2_hand_channel_id)

    return {
        'ok': True, 'gameId': game_id,
        'channels': gc.get_all(game_id),
    }


def cmd_legal_actions(user_id: str, deps: Dict[str, Any], *,
                      game_id: str) -> Dict[str, Any]:
    """Return the list of legal actions for the active player."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    if is_game_over(game):
        return {'ok': True, 'gameId': game_id, 'actions': []}
    try:
        from python.mcts.actions import legal_actions
        actions = legal_actions(game)
    except Exception as e:
        return {'ok': False, 'reason': 'legal_actions_error',
                'error': f'{type(e).__name__}: {e}'}
    return {
        'ok': True, 'gameId': game_id,
        'actions': [
            {'type': a.type.value, 'player': a.player, 'params': dict(a.params)}
            for a in actions
        ],
    }


def _default_game_id(p1: str, p2: str) -> str:
    """Deterministic short id for the {p1, p2} pair."""
    a, b = sorted([p1 or '_', p2 or '_'])
    return f'{a[:6]}-{b[:6]}'


# ---------------------------------------------------------------------------
# Stats slash commands (read-only DB queries)


def cmd_statcheck(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    """Show the global stats summary, or a specific player's record."""
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    summary = sq.get_stats_summary(store)
    return {'ok': True, 'summary': summary}


def cmd_statcheck_personal(user_id: str, deps: Dict[str, Any]
                            ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'userId': user_id,
            'summary': sq.get_stats_summary_for_player(store, user_id)}


def cmd_affiliation_winrate_global(user_id: str, deps: Dict[str, Any]
                                    ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'rates': sq.get_affiliation_win_rates(store)}


def cmd_affiliation_winrate_personal(user_id: str, deps: Dict[str, Any]
                                      ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'userId': user_id,
            'rates': sq.get_affiliation_win_rates_personal(store, user_id)}


def cmd_affiliation_pickrate_global(user_id: str, deps: Dict[str, Any]
                                     ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'rates': sq.get_affiliation_pick_rates(store)}


def cmd_affiliation_pickrate_personal(user_id: str, deps: Dict[str, Any]
                                       ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'userId': user_id,
            'rates': sq.get_affiliation_pick_rates_personal(store, user_id)}


def cmd_dc_winrate_global(user_id: str, deps: Dict[str, Any]
                           ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'rates': sq.get_dc_win_rates(store, limit=20)}


def cmd_dc_winrate_personal(user_id: str, deps: Dict[str, Any]
                             ) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'userId': user_id,
            'rates': sq.get_dc_win_rates_personal(store, user_id, limit=20)}


def cmd_leaderboard(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'leaderboard': sq.get_leaderboard(store, limit=10)}


def cmd_achievements(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    from python.discord_bot import stats_queries as sq
    store = _game_store(deps)
    return {'ok': True, 'userId': user_id,
            'achievements': sq.get_earned_achievements(store, user_id)}


# ---------------------------------------------------------------------------
# Admin slash commands


def cmd_botmenu(user_id: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    """Open the admin Bot Stuff menu (Kill Game). The actual
    interactive panel renders via a follow-up handler in the bot
    layer; this command surfaces a stub message."""
    return {
        'ok': True,
        'message': 'Bot menu — Kill Game admin tool. Use the buttons '
                   'in the followup message.',
    }


def cmd_power_token_list(user_id: str, deps: Dict[str, Any], *,
                          game_id: str) -> Dict[str, Any]:
    """List figures with active Power Tokens in the given game."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    tokens = data.get('figurePowerTokens') or {}
    rows = [{'figureKey': fk, 'tokens': list(t)}
            for fk, t in tokens.items() if t]
    return {'ok': True, 'gameId': game_id, 'figures': rows}


def cmd_power_token_add(user_id: str, deps: Dict[str, Any], *,
                         game_id: str, figure_key: str, token_type: str
                         ) -> Dict[str, Any]:
    """Manually grant a Power Token to a figure (cap 2 of same type)."""
    from python.engine.mechanics.tokens import grant_power_tokens
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    try:
        grant_power_tokens(data, figure_key, token_type, 1)
    except Exception as e:
        return {'ok': False, 'reason': 'grant_failed',
                'error': f'{type(e).__name__}: {e}'}
    _save(deps, game_id, game)
    return {'ok': True, 'gameId': game_id, 'figureKey': figure_key,
            'tokens': (data.get('figurePowerTokens') or {}).get(figure_key, [])}


def cmd_power_token_remove(user_id: str, deps: Dict[str, Any], *,
                            game_id: str, figure_key: str, index: int
                            ) -> Dict[str, Any]:
    """Manually remove the Nth (1-based) Power Token from a figure."""
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    tokens_map = data.get('figurePowerTokens') or {}
    tokens = list(tokens_map.get(figure_key) or [])
    idx = int(index) - 1
    if idx < 0 or idx >= len(tokens):
        return {'ok': False, 'reason': 'index_out_of_range',
                'count': len(tokens)}
    removed = tokens.pop(idx)
    if tokens:
        tokens_map[figure_key] = tokens
    else:
        tokens_map.pop(figure_key, None)
    data['figurePowerTokens'] = tokens_map
    _save(deps, game_id, game)
    return {'ok': True, 'gameId': game_id, 'figureKey': figure_key,
            'removed': removed, 'remaining': tokens}


def cmd_condition_add(user_id: str, deps: Dict[str, Any], *,
                       game_id: str, figure_key: str, condition: str
                       ) -> Dict[str, Any]:
    """Manually apply a condition to a figure."""
    from python.engine.mechanics.conditions import apply_condition
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    try:
        apply_condition(game, figure_key, condition)
    except Exception as e:
        return {'ok': False, 'reason': 'apply_failed',
                'error': f'{type(e).__name__}: {e}'}
    _save(deps, game_id, game)
    data = game.data if hasattr(game, 'data') else game
    return {'ok': True, 'gameId': game_id, 'figureKey': figure_key,
            'conditions': (data.get('figureConditions') or {}).get(figure_key, [])}


def cmd_testgame(user_id: str, deps: Dict[str, Any], *,
                  scenario: Optional[str] = None,
                  guild_id: Optional[str] = None,
                  ) -> Dict[str, Any]:
    """Spin up a self-vs-self test game for development. Caller is
    both player 1 and player 2 (with a synthetic 'test_p2' second
    player so the game-id namespace doesn't collide with real games).

    Mirrors the JS testgame shortcut (POST /testgame + #lfg "testgame"
    message handler) for local Cursor / terminal-driven testing.

    Optional scenario hooks come later; for now this just gives you
    a working game state to drive through /squad + /startbattle.
    """
    p2 = f'test_p2_{user_id}'
    gid = f'test-{user_id[:6]}'
    if _get(deps, gid) is not None:
        # Append a counter to avoid collisions on repeat invocations.
        i = 2
        while _get(deps, f'{gid}-{i}') is not None and i < 100:
            i += 1
        gid = f'{gid}-{i}'
    g = new_game(user_id, p2, game_id=gid)
    data = g.data if hasattr(g, 'data') else g
    data['testGame'] = True  # marker for filtering / cleanup
    _save(deps, gid, g)

    channels: Dict[str, Any] = {}
    if guild_id:
        try:
            from python.discord_bot import game_channels as gc
            from python.discord_bot.channel_factory import (
                create_game_channels,
            )
            factory = deps.get('channel_factory')
            channels = create_game_channels(
                gid, guild_id, user_id, p2, backend=factory,
            )
            for k, setter in (
                ('board_channel_id',  lambda v: gc.set_board_message(gid, v, None)),
                ('log_channel_id',    lambda v: gc.set_log_channel(gid, v)),
                ('p1_play_area_channel_id',
                 lambda v: gc.set_play_area(gid, 1, v)),
                ('p2_play_area_channel_id',
                 lambda v: gc.set_play_area(gid, 2, v)),
                ('p1_hand_channel_id', lambda v: gc.set_hand_channel(gid, 1, v)),
                ('p2_hand_channel_id', lambda v: gc.set_hand_channel(gid, 2, v)),
            ):
                v = channels.get(k)
                if v:
                    setter(v)
        except Exception:
            pass

    return {
        'ok': True, 'gameId': gid,
        'player1Id': user_id, 'player2Id': p2,
        'testGame': True, 'scenario': scenario,
        'channels': channels,
        'message': (
            f'Test game **{gid}** created — you are both players. '
            f'Submit squads with `/squad` (use this game id), then '
            f'`/startbattle` to begin.'
        ),
    }


def cmd_condition_remove(user_id: str, deps: Dict[str, Any], *,
                          game_id: str, figure_key: str, condition: str
                          ) -> Dict[str, Any]:
    """Manually clear a condition from a figure."""
    from python.engine.mechanics.conditions import filter_condition
    game = _get(deps, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    try:
        filter_condition(game, figure_key, condition)
    except Exception as e:
        return {'ok': False, 'reason': 'remove_failed',
                'error': f'{type(e).__name__}: {e}'}
    _save(deps, game_id, game)
    data = game.data if hasattr(game, 'data') else game
    return {'ok': True, 'gameId': game_id, 'figureKey': figure_key,
            'conditions': (data.get('figureConditions') or {}).get(figure_key, [])}
