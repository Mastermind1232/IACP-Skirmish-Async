"""Tests for the discord_bot router + registry + stepper-bridge."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _Interaction:
    """Discord.py-lite stub: just enough fields for the router."""
    def __init__(self, custom_id: str, user_id: str = 'alice'):
        self.custom_id = custom_id

        class _User:
            def __init__(self, _uid):
                self.id = _uid

        self.user = _User(user_id)


def _reset():
    from python.discord_bot import handlers
    handlers.reset_for_tests()


def _register_bridge():
    # Re-run install() after reset to repopulate
    from python.discord_bot.handlers import stepper_bridge
    stepper_bridge.install()


# ── Context tests ──────────────────────────────────────────────────────────

def test_build_context_unknown_group_raises():
    from python.discord_bot.context import ContextGroupNotFound, build_context
    try:
        build_context('no_such_group', {})
    except ContextGroupNotFound as e:
        assert 'no_such_group' in str(e)
        return
    raise AssertionError('expected ContextGroupNotFound')


def test_build_context_known_group_returns_dep_keys():
    from python.discord_bot.context import build_context
    ctx = build_context('phaseGate', {
        'get_game': 'gg', 'save_games': 'sg', 'client': 'c',
        'log_game_action': 'l',
    })
    assert ctx['get_game'] == 'gg'
    assert ctx['save_games'] == 'sg'


def test_build_context_missing_deps_come_through_as_none():
    from python.discord_bot.context import build_context
    ctx = build_context('phaseGate', {})
    assert ctx['get_game'] is None
    assert ctx['save_games'] is None
    assert ctx['client'] is None
    assert ctx['log_game_action'] is None


def test_list_groups_has_core_groups():
    from python.discord_bot.context import list_groups
    groups = list_groups()
    for expected in ('activation', 'combat', 'movement', 'ccHand',
                     'dcPlayArea', 'round', 'setup', 'phaseGate'):
        assert expected in groups


# ── Registry tests ──────────────────────────────────────────────────────────

def test_register_and_find_handler():
    _reset()
    from python.discord_bot.handlers import (
        find_handler, get_registered_prefixes, register,
    )
    def _h1(i, c): return 'h1'
    def _h2(i, c): return 'h2'
    register('longer_prefix_', _h1, 'core')
    register('long_', _h2, 'core')
    # Longer prefix wins
    m = find_handler('longer_prefix_42_x')
    assert m is not None
    prefix, handler, group = m
    assert prefix == 'longer_prefix_'
    assert handler('i', {}) == 'h1'
    # Short prefix match
    m2 = find_handler('long_9')
    assert m2[0] == 'long_'


def test_register_rejects_duplicate_prefix():
    _reset()
    from python.discord_bot.handlers import register
    register('x_', lambda i, c: None, 'core')
    try:
        register('x_', lambda i, c: None, 'core')
    except ValueError as e:
        assert 'duplicate' in str(e)
        return
    raise AssertionError('expected ValueError for duplicate prefix')


def test_find_handler_no_match():
    _reset()
    from python.discord_bot.handlers import find_handler
    assert find_handler('nonsense_prefix_thing') is None


def test_get_registered_prefixes_sorted_by_length_desc():
    _reset()
    from python.discord_bot.handlers import (
        get_registered_prefixes, register,
    )
    register('short_', lambda i, c: None, 'core')
    register('somewhat_longer_', lambda i, c: None, 'core')
    register('even_longer_prefix_', lambda i, c: None, 'core')
    prefixes = get_registered_prefixes()
    # Longest first
    assert prefixes[0] == 'even_longer_prefix_'
    assert prefixes[-1] == 'short_'


# ── Router tests ────────────────────────────────────────────────────────────

def test_route_sync_no_custom_id():
    _reset()
    from python.discord_bot.router import route_sync

    class _EmptyInt:
        pass

    result = route_sync(_EmptyInt(), {})
    assert result == {'ok': False, 'reason': 'no_custom_id'}


def test_route_sync_no_handler():
    _reset()
    from python.discord_bot.router import route_sync
    result = route_sync(_Interaction('unknown_prefix_foo'), {})
    assert result['ok'] is False
    assert result['reason'] == 'no_handler'


def test_route_sync_dispatches_to_handler():
    _reset()
    from python.discord_bot.handlers import register
    from python.discord_bot.router import route_sync

    calls = []
    def _h(interaction, ctx):
        calls.append((interaction.custom_id, ctx.get('get_game')))

    register('my_test_', _h, 'phaseGate')
    result = route_sync(
        _Interaction('my_test_foo'),
        {'get_game': 'GG', 'save_games': 's', 'client': 'c',
         'log_game_action': 'l'},
    )
    assert result == {'ok': True, 'prefix': 'my_test_', 'group': 'phaseGate'}
    assert calls == [('my_test_foo', 'GG')]


def test_route_sync_catches_handler_error():
    _reset()
    from python.discord_bot.handlers import register
    from python.discord_bot.router import route_sync

    def _bad(interaction, ctx):
        raise ValueError('synthetic')

    register('bad_', _bad, 'phaseGate')
    result = route_sync(_Interaction('bad_x'), {})
    assert result['ok'] is False
    assert result['reason'] == 'handler_error'
    assert 'synthetic' in result['error']


def test_route_async_handler():
    _reset()
    from python.discord_bot.handlers import register
    from python.discord_bot.router import route

    calls = []
    async def _async_h(interaction, ctx):
        calls.append('fired')

    register('ah_', _async_h, 'phaseGate')
    result = asyncio.run(route(_Interaction('ah_x'), {}))
    assert result['ok'] is True
    assert calls == ['fired']


# ── Stepper-bridge tests ────────────────────────────────────────────────────

def test_stepper_bridge_registered_for_common_prefixes():
    _reset()
    _register_bridge()
    from python.discord_bot.handlers import find_handler
    for prefix in ('phase_gate_ready_', 'auto_deploy_', 'dc_end_activation_',
                   'end_end_of_round_', 'power_token_choice_'):
        m = find_handler(f'{prefix}GAME_1')
        assert m is not None, f'no handler for {prefix!r}'
        assert m[0] == prefix


def test_stepper_bridge_no_game_found_returns_failure():
    _reset()
    _register_bridge()
    from python.discord_bot.router import route_sync
    deps = {'get_game': lambda _: None, 'save_games': lambda: None}
    result = route_sync(_Interaction('phase_gate_ready_abc'), deps)
    # Handler ran; but the bridge returned ok=False via its result
    assert result['ok'] is True  # router reports the dispatch worked
    # Bridge's return value isn't captured by route_sync — this test just
    # confirms nothing raised.


def test_stepper_bridge_reports_game_not_found_when_inspected():
    _reset()
    _register_bridge()
    from python.discord_bot.handlers import find_handler
    m = find_handler('phase_gate_ready_abc')
    assert m is not None
    _, handler, _ = m
    ctx = {'get_game': lambda _: None, 'save_games': lambda: None}
    result = handler(_Interaction('phase_gate_ready_abc'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def test_main_module_register_all_handlers_imports_without_error():
    from python.discord_bot.main import register_all_handlers
    # Should import stepper_bridge (and skip any not-yet-ported modules)
    count = register_all_handlers()
    assert count >= 1


def test_slash_command_registry():
    from python.discord_bot.main import (
        slash_command_dispatch,
        slash_command_names,
    )
    names = slash_command_names()
    assert set(names) == {
        'startgame', 'squad', 'startbattle', 'status',
        'forfeit', 'listgames', 'legalactions', 'stepaction',
        'setupchannels',
    }
    # Dispatch an unknown command.
    try:
        slash_command_dispatch('nope', 'alice', {'_store': {}})
    except ValueError as e:
        assert 'unknown slash command' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_slash_command_dispatch_starts_game():
    from python.discord_bot.main import slash_command_dispatch
    store = {}
    deps = {'_store': store, 'game_store': store}
    r = slash_command_dispatch('startgame', 'alice', deps,
                                 opponent_id='bob', game_id='g1')
    assert r['ok']
    assert r['gameId'] == 'g1'
    assert 'g1' in store


def test_wire_slash_commands_no_tree_returns_zero():
    """Bot without a tree attribute (plain discord.Client) → no-op."""
    from python.discord_bot.main import wire_slash_commands
    class _Stub: pass
    count = wire_slash_commands(_Stub(), {})
    assert count == 0


def test_route_auto_refreshes_when_result_has_game_id():
    """On successful handler returning {ok, gameId, game}, router
    calls game_channels.refresh_game_view via channel_backend."""
    from python.discord_bot import game_channels as gc, handlers
    from python.discord_bot.channels import InMemoryBackend
    from python.discord_bot.router import route_sync
    from python.engine.creation import create_game
    gc._reset_for_tests()
    handlers.reset_for_tests()

    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['phase'] = 'lobby'

    def _test_handler(interaction, ctx):
        return {'ok': True, 'gameId': 'g1', 'game': g}
    handlers.register('myaction_', _test_handler, 'core')

    be = InMemoryBackend()
    gc.set_board_message('g1', 'chan-1', None)
    deps = {'channel_backend': be}

    class _I: custom_id = 'myaction_g1'
    route_sync(_I(), deps)
    # Board message should exist after auto-refresh.
    cid, mid = gc.get_board_message('g1')
    assert cid == 'chan-1'
    assert mid is not None
    assert be.fetch(cid, mid) is not None


def main():
    cases = [
        ('build_context_unknown_group_raises', test_build_context_unknown_group_raises),
        ('build_context_known_group', test_build_context_known_group_returns_dep_keys),
        ('build_context_missing_deps_none', test_build_context_missing_deps_come_through_as_none),
        ('list_groups_core', test_list_groups_has_core_groups),
        ('register_and_find_handler', test_register_and_find_handler),
        ('register_rejects_duplicate', test_register_rejects_duplicate_prefix),
        ('find_handler_no_match', test_find_handler_no_match),
        ('prefixes_sorted_longest_first', test_get_registered_prefixes_sorted_by_length_desc),
        ('route_sync_no_custom_id', test_route_sync_no_custom_id),
        ('route_sync_no_handler', test_route_sync_no_handler),
        ('route_sync_dispatches', test_route_sync_dispatches_to_handler),
        ('route_sync_catches_error', test_route_sync_catches_handler_error),
        ('route_async_handler', test_route_async_handler),
        ('stepper_bridge_registered', test_stepper_bridge_registered_for_common_prefixes),
        ('stepper_bridge_no_game_found', test_stepper_bridge_no_game_found_returns_failure),
        ('stepper_bridge_game_not_found_result', test_stepper_bridge_reports_game_not_found_when_inspected),
        ('main_register_all_handlers', test_main_module_register_all_handlers_imports_without_error),
        ('slash_command_registry', test_slash_command_registry),
        ('slash_command_dispatch_starts_game', test_slash_command_dispatch_starts_game),
        ('wire_slash_no_tree', test_wire_slash_commands_no_tree_returns_zero),
        ('auto_refresh', test_route_auto_refreshes_when_result_has_game_id),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
