"""P3.5 verification: context factory.

Validates build_context, list_groups, group_requires, and the
fail-fast validate_registry_at_startup helper.
"""
import pytest

from python.discord_bot.context import (
    ContextGroupNotFound,
    build_context,
    group_requires,
    list_groups,
    validate_registry_at_startup,
)
from python.discord_bot.handlers import (
    register,
    reset_for_tests,
)


def _h(_i, _c):
    return None


@pytest.fixture(autouse=True)
def _isolated_registry():
    reset_for_tests()
    yield
    reset_for_tests()


# ── build_context ──────────────────────────────────────────────────────


def test_build_context_combat_group_returns_dict():
    deps = {'get_game': lambda x: None, 'client': 'CLIENT_REF',
            'log_game_action': lambda *a, **k: None}
    ctx = build_context('combat', deps)
    assert ctx['get_game'] is deps['get_game']
    assert ctx['client'] == 'CLIENT_REF'
    # Missing deps come through as None (not KeyError).
    assert 'dc_message_meta' in ctx
    assert ctx['dc_message_meta'] is None


def test_build_context_unknown_group_raises():
    with pytest.raises(ContextGroupNotFound):
        build_context('totally_unknown_group', {})


def test_build_context_only_includes_required_deps():
    deps = {'get_game': 'X', 'client': 'Y', 'extra_unused_dep': 'Z'}
    ctx = build_context('phaseGate', {**deps})
    assert ctx['get_game'] == 'X'
    assert ctx['client'] == 'Y'
    # Extra dep not in the group's required list is filtered out.
    assert 'extra_unused_dep' not in ctx


# ── list_groups / group_requires ──────────────────────────────────────


def test_list_groups_includes_all_known():
    groups = list_groups()
    assert 'combat' in groups
    assert 'movement' in groups
    assert 'ccHand' in groups
    assert 'dcPlayArea' in groups
    assert 'round' in groups
    assert 'setup' in groups


def test_group_requires_returns_dep_list():
    deps = group_requires('combat')
    assert 'get_game' in deps
    assert 'log_game_action' in deps


def test_group_requires_unknown_raises():
    with pytest.raises(ContextGroupNotFound):
        group_requires('mystery_group')


# ── validate_registry_at_startup ───────────────────────────────────────


def test_validate_registry_passes_with_known_groups():
    register('test_btn_', _h, 'combat')
    register('test_btn2_', _h, 'movement')
    # Should not raise.
    validate_registry_at_startup()


def test_validate_registry_raises_for_unknown_group():
    register('bad_btn_', _h, 'group_that_does_not_exist')
    with pytest.raises(ContextGroupNotFound) as exc:
        validate_registry_at_startup()
    assert 'bad_btn_' in str(exc.value)
    assert 'group_that_does_not_exist' in str(exc.value)


def test_validate_registry_passes_with_empty_registry():
    # Empty registry → nothing to validate. No raise.
    validate_registry_at_startup()


def test_validate_registry_lists_first_5_unknown():
    """When many handlers have unknown groups, error truncates to 5."""
    for i in range(7):
        register(f'bad_btn_{i}_', _h, f'unknown_group_{i}')
    with pytest.raises(ContextGroupNotFound) as exc:
        validate_registry_at_startup()
    msg = str(exc.value)
    assert '7 handler(s)' in msg
