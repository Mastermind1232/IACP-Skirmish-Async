"""Tests for the auto-stubs module + 100% dispatcher coverage.

Every JS handler prefix now has a concrete Python handler. The
auto_stubs module remains as a safety net — if a JS prefix were added
without a Python port, auto_stubs would catch it. Today, 0 stubs
install because every prefix is claimed by a concrete module first.
"""
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
    path = REPO_ROOT / 'src' / 'handlers' / 'index.js'
    with open(path) as f:
        code = f.read()
    return set(re.findall(r"^register\('([^']+)'", code, re.M))


def _load_py_prefixes():
    from python.discord_bot import handlers as H
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
    import python.discord_bot.handlers.interrupts  # noqa: F401
    import python.discord_bot.handlers.map_events  # noqa: F401
    import python.discord_bot.handlers.game_tools  # noqa: F401
    import python.discord_bot.handlers.lobby  # noqa: F401
    import python.discord_bot.handlers.requests  # noqa: F401
    import python.discord_bot.handlers.favorites  # noqa: F401
    import python.discord_bot.handlers.space_picker  # noqa: F401
    import python.discord_bot.handlers.fast_forward  # noqa: F401
    import python.discord_bot.handlers.post_deploy_picks  # noqa: F401
    import python.discord_bot.handlers.blitz_deploy  # noqa: F401
    import python.discord_bot.handlers.setup_extras  # noqa: F401
    import python.discord_bot.handlers.activation_picks  # noqa: F401
    import python.discord_bot.handlers.combat_picks  # noqa: F401
    import python.discord_bot.handlers.interrupts_extras  # noqa: F401
    import python.discord_bot.handlers.final_validators  # noqa: F401
    import python.discord_bot.handlers.stepper_bridge  # noqa: F401
    import python.discord_bot.handlers.auto_stubs  # noqa: F401
    return {p for p, _, _ in H._REGISTRY}


def test_every_js_prefix_has_a_python_handler():
    js = _load_js_prefixes()
    py = _load_py_prefixes()
    missing = js - py
    assert not missing, f'JS prefixes with no Python handler: {sorted(missing)}'


def test_zero_stubs_installed():
    """All prefixes are concrete — auto_stubs installs nothing."""
    _load_py_prefixes()
    from python.discord_bot.handlers import auto_stubs
    assert auto_stubs._INSTALLED_COUNT == 0


def test_no_stub_handlers_in_registry():
    """No registered handler's __name__ starts with _stub_."""
    _load_py_prefixes()
    from python.discord_bot import handlers as H
    stub_prefixes = [
        p for p, h, _ in H._REGISTRY
        if h.__name__.startswith('_stub_')
    ]
    assert not stub_prefixes, \
        f'Stub handlers still registered: {stub_prefixes}'


def test_concrete_count_matches_js():
    """Python concrete-handler count meets or exceeds JS prefix count."""
    js = _load_js_prefixes()
    py = _load_py_prefixes()
    # Python may have extra prefixes (bridge duplicates), but should
    # cover every JS one.
    assert py >= js, f'Missing JS prefixes: {sorted(js - py)}'


def test_concrete_handler_shadow_precedence():
    """A concrete handler for a prefix is selected by the router, not
    the auto_stub fallback. Verified via a handler that has state-aware
    behavior (extra_armor_pick_)."""
    _load_py_prefixes()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingExtraArmor_p1'] = {'total': 4, 'allocation': {}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('extra_armor_pick_G1_1_Luke-0-0')
    result = handler(_Interaction('extra_armor_pick_G1_1_Luke-0-0',
                                    user_id='alice'), ctx)
    # Real handler returns tokenCount; no 'stub' key.
    assert result.get('stub') is not True
    assert 'tokenCount' in result


def main():
    cases = [
        ('100pct_coverage', test_every_js_prefix_has_a_python_handler),
        ('zero_stubs_installed', test_zero_stubs_installed),
        ('no_stub_handlers_in_registry', test_no_stub_handlers_in_registry),
        ('concrete_count_matches_js', test_concrete_count_matches_js),
        ('concrete_shadow_precedence', test_concrete_handler_shadow_precedence),
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
