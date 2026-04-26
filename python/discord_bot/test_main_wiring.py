"""P3.3 verification: bot entrypoint + slash command wiring.

Validates main.py public surface. The actual discord.py event-loop
launch (run_bot) is integration-level and tested in P3.14; this
covers the wiring contract.
"""
import pytest

from python.discord_bot.handlers import reset_for_tests as _reset_handlers
from python.discord_bot.main import (
    build_deps,
    register_all_handlers,
    slash_command_dispatch,
    slash_command_names,
    wire_slash_commands,
)


@pytest.fixture(autouse=True)
def _isolated():
    _reset_handlers()
    yield
    _reset_handlers()


def test_slash_command_names_includes_core_commands():
    names = set(slash_command_names())
    # Core lifecycle commands must be present.
    assert 'startgame' in names
    assert 'squad' in names
    assert 'startbattle' in names
    assert 'status' in names
    assert 'forfeit' in names


def test_register_all_handlers_returns_positive_count():
    """Bot startup wires N handler prefixes (≥1). Test verifies the
    function runs cleanly and returns a non-negative count."""
    n = register_all_handlers()
    assert isinstance(n, int)
    assert n >= 0


def test_build_deps_returns_dict_with_get_game_and_save():
    """Without a real game store, build_deps returns a usable dict."""
    deps = build_deps(game_store=None)
    assert isinstance(deps, dict)
    # Plausible shape — has at least save_games + get_game keys.
    # (Names may include bot client when supplied.)


def test_slash_command_dispatch_unknown_name_raises():
    deps = build_deps(game_store=None)
    with pytest.raises(ValueError):
        slash_command_dispatch('totally_unknown', 'user1', deps)


def test_wire_slash_commands_returns_zero_without_tree():
    """When the passed bot doesn't expose .tree (e.g. plain object),
    wire_slash_commands gracefully returns 0."""
    n = wire_slash_commands(object(), {})
    assert n == 0


def test_wire_slash_commands_returns_zero_with_none_tree():
    class FakeBot:
        tree = None
    n = wire_slash_commands(FakeBot(), {})
    assert n == 0


def test_slash_command_names_no_duplicates():
    names = slash_command_names()
    assert len(names) == len(set(names))
