"""Tests for the batched UI-validator handlers (favorites, space_picker,
fast_forward, etc.).

Coverage-oriented: sanity-check each family's happy path and rejection
path. Exhaustive behavior tests land with the individual concrete
handlers as they mature.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Interaction:
    def __init__(self, custom_id, user_id='alice'):
        self.custom_id = custom_id
        self.user = _User(user_id)


def _fresh():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import favorites as fv
    from python.discord_bot.handlers import space_picker as sp
    from python.discord_bot.handlers import fast_forward as ff
    handlers.reset_for_tests()
    handlers.register('fav_save_', fv._handle_fav_save, 'core')
    handlers.register('fav_list_back_', fv._handle_fav_list_back, 'core')
    handlers.register('space_row_', sp._handle_space_row, 'core')
    handlers.register('space_row_back_', sp._handle_space_row_back, 'core')
    handlers.register('fast_forward_', ff._handle_fast_forward, 'core')
    handlers.register('dc_cc_defender_', ff._handle_dc_cc_defender, 'core')
    handlers.register('ike_keep_', ff._handle_ike_keep, 'core')
    handlers.register('illegal_cc_ignore_', ff._handle_illegal_cc_ignore, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


# ── favorites ─────────────────────────────────────────────────────────────

def test_fav_save_validates_owner():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('fav_save_G1_1')
    ok = handler(_Interaction('fav_save_G1_1', user_id='alice'), ctx)
    assert ok['ok'] is True
    assert ok['playerNum'] == 1
    nope = handler(_Interaction('fav_save_G1_1', user_id='bob'), ctx)
    assert nope['ok'] is False
    assert nope['reason'] == 'not_owner'


def test_fav_list_back_parses_thread_id():
    _fresh()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('fav_list_back_T1')
    result = handler(_Interaction('fav_list_back_T1'), {})
    assert result['ok'] is True
    assert result['threadId'] == 'T1'


# ── space_picker ─────────────────────────────────────────────────────────

def test_space_row_requires_pending_pick():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingSpacePick'] = {'G1_hl1dc0': {'validSpaces': ['a1']}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('space_row_G1_hl1dc0_2')
    ok = handler(_Interaction('space_row_G1_hl1dc0_2'), ctx)
    assert ok['ok'] is True
    assert ok['rowNum'] == 2


def test_space_row_back_requires_pending_pick():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('space_row_back_G1_hl1dc0')
    result = handler(_Interaction('space_row_back_G1_hl1dc0'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'space_selection_expired'


# ── fast_forward + misc ─────────────────────────────────────────────────

def test_fast_forward_requires_participant():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('fast_forward_G1')
    ok = handler(_Interaction('fast_forward_G1', user_id='alice'), ctx)
    assert ok['ok'] is True
    nope = handler(_Interaction('fast_forward_G1', user_id='stranger'), ctx)
    assert nope['ok'] is False


def test_dc_cc_defender_parses_tail():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('dc_cc_defender_G1_hl2dc0_0')
    result = handler(
        _Interaction('dc_cc_defender_G1_hl2dc0_0', user_id='bob'), ctx,
    )
    assert result['ok'] is True
    assert result['tail'] == 'hl2dc0_0'


def test_ike_keep_ok():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('ike_keep_G1')
    result = handler(_Interaction('ike_keep_G1', user_id='alice'), ctx)
    assert result['ok'] is True


def test_illegal_cc_ignore_captures_tail():
    _fresh()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('illegal_cc_ignore_G1_Focus')
    result = handler(
        _Interaction('illegal_cc_ignore_G1_Focus', user_id='alice'), ctx,
    )
    assert result['ok'] is True
    assert result['tail'] == 'Focus'


def main():
    cases = [
        ('fav_save_owner', test_fav_save_validates_owner),
        ('fav_list_back_parses', test_fav_list_back_parses_thread_id),
        ('space_row_pending', test_space_row_requires_pending_pick),
        ('space_row_back_expired', test_space_row_back_requires_pending_pick),
        ('fast_forward_participant', test_fast_forward_requires_participant),
        ('dc_cc_defender_tail', test_dc_cc_defender_parses_tail),
        ('ike_keep_ok', test_ike_keep_ok),
        ('illegal_cc_ignore_tail', test_illegal_cc_ignore_captures_tail),
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
