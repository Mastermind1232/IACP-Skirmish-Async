"""Per-handler context builder — mirror of src/context-factory.js.

Each handler group declares which deps it needs (game store, health
state, message updaters, etc.). The router looks up the group's dep
list and builds a ctx dict to pass to the handler.

This is a thin registry: deps are passed in by the router caller (the
bot entry point owns the long-lived instances — game store, Discord
client, DB connection, etc.).
"""
from __future__ import annotations

from typing import Any, Dict, List


# Group → required dep key list. Each dep is looked up by key in the
# deps dict the router hands to build_context().
_GROUP_DEPS: Dict[str, List[str]] = {
    'activation': [
        'get_game', 'save_games', 'client',
        'dc_message_meta', 'dc_health_state',
        'log_game_action', 'update_dc_actions_message',
        'opponent_player_num',
    ],
    'combat': [
        'get_game', 'save_games', 'client',
        'dc_message_meta', 'dc_health_state',
        'log_game_action', 'combat_thread_fetcher',
        'opponent_player_num',
    ],
    'movement': [
        'get_game', 'save_games', 'client',
        'dc_message_meta', 'board_state_for_movement',
        'movement_profile', 'compute_movement_cache',
        'log_game_action',
    ],
    'ccHand': [
        'get_game', 'save_games', 'client',
        'build_hand_display_payload', 'update_hand_visual_message',
        'update_discard_pile_message', 'log_game_action',
        'get_cc_effect',
    ],
    'dcPlayArea': [
        'get_game', 'save_games', 'client',
        'dc_message_meta', 'dc_health_state',
        'update_dc_actions_message', 'render_dc_embed',
        'get_dc_play_area_components',
        'resolve_ability',
    ],
    'round': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'check_win_conditions',
        'run_end_of_round_rules', 'run_start_of_round_rules',
        'get_map_tokens_data', 'get_space_controller',
    ],
    'setup': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'get_map_registry',
        'get_mission_cards_data', 'get_deployment_zones',
    ],
    'phaseGate': [
        'get_game', 'save_games', 'client',
        'log_game_action',
    ],
    'interrupts': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'dc_message_meta',
    ],
    'recover': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'dc_health_state', 'dc_message_meta',
    ],
    'postCombat': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'process_figure_defeat',
    ],
    'combatReactions': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'combat_thread_fetcher',
    ],
    'combatSpecialEffects': [
        'get_game', 'save_games', 'client',
        'log_game_action',
    ],
    'blitzDeploy': [
        'get_game', 'save_games', 'client',
        'log_game_action',
    ],
    'favorites': [
        'get_game', 'save_games', 'client',
    ],
    'gameTools': [
        'get_game', 'save_games', 'client',
    ],
    'mapEvents': [
        'get_game', 'save_games', 'client',
        'log_game_action', 'get_map_tokens_data',
    ],
    'spacePicker': [
        'get_game', 'save_games', 'client',
        'get_map_data', 'get_board_state_for_movement',
    ],
    'postDeploy': [
        'get_game', 'save_games', 'client',
        'log_game_action',
    ],
    # Minimal fallback for ad-hoc registrations
    'core': [
        'get_game', 'save_games', 'client', 'log_game_action',
        'lobbies', 'lobby_embed_sent', 'channel_backend',
        'list_game_ids', 'delete_game', 'save_game',
        'MAX_ACTIVE_GAMES_PER_PLAYER', 'count_active_games_for_player',
    ],
}


class ContextGroupNotFound(KeyError):
    """Raised when build_context() is called with an unknown group."""


def build_context(group: str, deps: Dict[str, Any]) -> Dict[str, Any]:
    """Build a ctx dict for the given handler group.

    Resolves each required dep from the caller-supplied deps map. Missing
    deps come through as None so tests can easily stub subsets.

    Raises ContextGroupNotFound if the group isn't registered.
    """
    if group not in _GROUP_DEPS:
        raise ContextGroupNotFound(group)
    return {key: deps.get(key) for key in _GROUP_DEPS[group]}


def list_groups() -> List[str]:
    """Return all known handler groups."""
    return sorted(_GROUP_DEPS.keys())


def group_requires(group: str) -> List[str]:
    """Return the dep keys a group consumes."""
    if group not in _GROUP_DEPS:
        raise ContextGroupNotFound(group)
    return list(_GROUP_DEPS[group])


def validate_registry_at_startup() -> None:
    """Verify every registered handler's group is known to the
    context factory. Mirrors the JS startup-time fail-fast in
    src/context-factory.js: an unregistered group means the handler
    will silently receive an empty ctx, which is hard to debug.

    Raises:
      ContextGroupNotFound: if any handler is registered with a
        group not declared in _GROUP_DEPS.
    """
    from python.discord_bot.handlers import get_registry

    unknown = []
    for prefix, _handler, group in get_registry():
        if group not in _GROUP_DEPS:
            unknown.append((prefix, group))
    if unknown:
        joined = ', '.join(f'{p!r}→{g!r}' for p, g in unknown[:5])
        raise ContextGroupNotFound(
            f'{len(unknown)} handler(s) registered with unknown groups: '
            f'{joined}'
        )
