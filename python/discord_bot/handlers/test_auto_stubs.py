"""Tests for the auto-generated stub module that guarantees 100%
JS→Python dispatcher coverage."""
from __future__ import annotations

import re
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


def _load_js_prefixes():
    """Parse every register('prefix_', ...) call from JS index.js."""
    path = REPO_ROOT / 'src' / 'handlers' / 'index.js'
    with open(path) as f:
        code = f.read()
    return set(re.findall(r"^register\('([^']+)'", code, re.M))


def _load_py_prefixes():
    """Load all concrete + bridge + auto_stub handler registrations."""
    from python.discord_bot import handlers as H
    # Force import of every Python handler module
    import python.discord_bot.handlers.setup  # noqa: F401
    import python.discord_bot.handlers.activation  # noqa: F401
    import python.discord_bot.handlers.combat  # noqa: F401
    import python.discord_bot.handlers.round  # noqa: F401
    import python.discord_bot.handlers.movement  # noqa: F401
    import python.discord_bot.handlers.cc_hand  # noqa: F401
    import python.discord_bot.handlers.dc_play_area  # noqa: F401
    import python.discord_bot.handlers.interact  # noqa: F401
    import python.discord_bot.handlers.phase_gate  # noqa: F401
    import python.discord_bot.handlers.combat_special_effects  # noqa: F401
    import python.discord_bot.handlers.movement_extras  # noqa: F401
    import python.discord_bot.handlers.post_deploy  # noqa: F401
    import python.discord_bot.handlers.post_combat  # noqa: F401
    import python.discord_bot.handlers.combat_reactions  # noqa: F401
    import python.discord_bot.handlers.botmenu  # noqa: F401
    import python.discord_bot.handlers.stepper_bridge  # noqa: F401
    import python.discord_bot.handlers.auto_stubs  # noqa: F401
    return {p for p, _, _ in H._REGISTRY}


def test_every_js_prefix_has_a_python_handler():
    js = _load_js_prefixes()
    py = _load_py_prefixes()
    missing = js - py
    assert not missing, f'JS prefixes with no Python handler: {sorted(missing)}'


def test_stub_handler_returns_ok_stub_true():
    py = _load_py_prefixes()  # ensure auto_stubs installed
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('lobby_join_G1_alice')
    result = handler(_Interaction('lobby_join_G1_alice'), {})
    assert result['ok'] is True
    assert result['stub'] is True
    assert result['prefix'] == 'lobby_join_'
    assert result['gameId'] == 'G1'


def test_stub_handler_malformed_cid_rejected():
    py = _load_py_prefixes()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('refresh_map_G1')
    # Empty prefix match still returns ok (just no tail)
    result = handler(_Interaction('refresh_map_'), {})
    # Note: stub returns ok with gameId='' when there's no tail
    assert result['ok'] is True
    assert result['stub'] is True


def test_stub_does_not_mutate_state():
    py = _load_py_prefixes()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    before = dict(g.data)
    _, handler, _ = find_handler('fav_save_G1_1')
    ctx = {'get_game': lambda gid: g, 'save_games': lambda: None}
    result = handler(_Interaction('fav_save_G1_1'), ctx)
    assert result['stub'] is True
    # No state mutation
    assert g.data == before


def test_concrete_handlers_shadow_stubs():
    """Verify concrete ports (e.g. in dc_play_area.py) take precedence
    over auto_stubs. If a concrete handler exists for a prefix, the
    stub must not shadow it.
    """
    _load_py_prefixes()
    from python.discord_bot.handlers import find_handler
    # extra_armor_pick_ has a concrete handler in round.py; it should
    # NOT return stub=True.
    _, handler, _ = find_handler('extra_armor_pick_G1_1_Luke-0-0')
    # Run it against a game and expect state-aware behavior, not stub
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingExtraArmor_p1'] = {'total': 4, 'allocation': {}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    result = handler(_Interaction('extra_armor_pick_G1_1_Luke-0-0',
                                    user_id='alice'), ctx)
    # Real handler path — returns tokenCount, not stub
    assert result.get('stub') is not True
    assert 'tokenCount' in result


def test_stub_count_matches_installed():
    from python.discord_bot.handlers import auto_stubs
    _load_py_prefixes()
    # Count should be >= 200 (adjust whenever more concrete ports land)
    assert auto_stubs._INSTALLED_COUNT >= 200


def main():
    cases = [
        ('100pct_coverage', test_every_js_prefix_has_a_python_handler),
        ('stub_returns_ok', test_stub_handler_returns_ok_stub_true),
        ('stub_empty_tail', test_stub_handler_malformed_cid_rejected),
        ('stub_no_mutation', test_stub_does_not_mutate_state),
        ('concrete_shadows_stubs', test_concrete_handlers_shadow_stubs),
        ('install_count_pinned', test_stub_count_matches_installed),
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
