"""Stepper-bridge handler: customId → ActionType → step(game, action).

Registers a broad set of customId prefixes that map 1:1 to stepper
ActionTypes via python/engine/action_parser.py. This is the minimum-
viable handler: for every button the bot gets, find the right Action,
apply it to the game, and save.

Individual handlers that need Discord-side UI rendering (button grids,
embed updates, thread management) override this by registering under a
more specific prefix. Prefix dispatch is longest-match in the router,
so 'end_turn_' (stepper bridge) is shadowed by 'end_turn_some_modal_'
if any handler registers the longer prefix first.
"""
from __future__ import annotations

from typing import Any, Dict

from python.discord_bot.handlers import register


# Keep this list aligned with action_parser.py's PREFIX_DISPATCH map.
# Each prefix owns a customId family; the bridge just forwards to the
# stepper.
_BRIDGED_PREFIXES = [
    # Round flow
    ('auto_deploy_', 'round'),
    ('pass_activation_turn_', 'activation'),
    ('status_phase_', 'activation'),
    ('end_end_of_round_', 'round'),
    ('end_start_of_round_', 'round'),
    ('dc_end_activation_', 'activation'),
    ('dc_activate_', 'activation'),
    # Phase gates
    ('phase_gate_ready_', 'phaseGate'),
    ('phase_gate_unready_', 'phaseGate'),
    # Interact
    ('interact_choice_', 'core'),
    # CC actions
    ('cc_shuffle_draw_', 'ccHand'),
    ('cc_confirm_play_', 'ccHand'),
    ('cc_cancel_play_', 'ccHand'),
    ('cc_choice_', 'ccHand'),
    # Power-token flow
    ('pt_overflow_', 'combat'),
    ('power_token_choice_', 'combat'),
    # Combat response windows
    ('celebration_play_', 'ccHand'),
    ('celebration_pass_', 'ccHand'),
    ('cover_fire_block_', 'combat'),
    ('cover_fire_skip_', 'combat'),
    ('comm_disruption_play_', 'ccHand'),
    ('comm_disruption_skip_', 'ccHand'),
    ('spread_pain_cond_', 'combat'),
    # Weapon modifiers
    ('bo_rifle_pick_', 'dcPlayArea'),
    ('ee3_pick_die_', 'dcPlayArea'),
    # Skip/done flows
    ('rush_push_skip_', 'dcPlayArea'),
    ('shoulder_rush_skip_', 'dcPlayArea'),
    ('false_orders_skip_', 'dcPlayArea'),
    ('missile_salvo_done_', 'combatSpecialEffects'),
    ('missile_salvo_die_', 'combatSpecialEffects'),
    ('arsenal_pick_', 'dcPlayArea'),
    # Space pickers
    ('pounce_space_', 'dcPlayArea'),
    ('overwatch_space_', 'dcPlayArea'),
    ('bomb_drop_space_', 'dcPlayArea'),
    ('ob_space_', 'dcPlayArea'),
    # Setup flow
    ('map_confirm_', 'setup'),
    ('map_goback_', 'setup'),
    ('map_type_', 'setup'),
    ('draft_random_', 'setup'),
    ('determine_initiative_', 'setup'),
    ('deployment_zone_', 'setup'),
    ('deployment_fig_', 'setup'),
    ('deployment_done_', 'setup'),
    # Play from DC
    ('dc_cc_special_', 'dcPlayArea'),
    ('dc_cc_double_', 'dcPlayArea'),
    ('dc_special_', 'dcPlayArea'),
    # DC-ability choice
    ('dc_ability_choice_', 'dcPlayArea'),
    # Rush / Shoulder / False Orders accept
    ('rush_push_fig_', 'dcPlayArea'),
    ('shoulder_rush_fig_', 'dcPlayArea'),
    ('false_orders_action_', 'dcPlayArea'),
    # Strain choice
    ('strain_choice_alldmg_', 'combat'),
    ('strain_choice_discard_', 'combat'),
    # Core combat flow
    ('attack_target_', 'combat'),
    ('combat_roll_', 'combat'),
    ('combat_reroll_', 'combat'),
    ('combat_surge_', 'combat'),
    ('combat_token_', 'combat'),
    ('combat_resolve_ready_', 'combat'),
    ('combat_gate_', 'combat'),
    ('combat_passive_', 'combat'),
    ('pre_reroll_', 'combat'),
]


def _bridge_handler(interaction: Any, ctx: Dict[str, Any]) -> Any:
    """Parse customId → Action → step the game.

    Pulls the game from ctx.get_game (via gameId parse), applies the
    action, persists via ctx.save_games. No Discord UI rendering — that
    lives in per-family dedicated handlers that land later.

    This handler is intentionally UI-less: it covers the button-click
    → state-mutation round-trip for the 80% of customIds where the bot
    just needs to advance state.
    """
    # Lazy import to keep discord_bot.handlers lightweight at import time
    from python.engine.action_parser import UnparseableCustomId, step_custom_id

    custom_id = _extract_custom_id(interaction)
    if not custom_id:
        return {'ok': False, 'reason': 'no_custom_id'}

    user_id = _extract_user_id(interaction)
    game_id = _extract_game_id(custom_id)
    if not game_id:
        return {'ok': False, 'reason': 'no_game_id_in_custom_id'}

    get_game = ctx.get('get_game')
    if not callable(get_game):
        return {'ok': False, 'reason': 'no_get_game_in_context'}

    game = get_game(game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    try:
        new_game = step_custom_id(game, custom_id, user_id, action_opts={})
    except UnparseableCustomId as e:
        return {'ok': False, 'reason': 'unparseable', 'error': str(e)}
    except NotImplementedError as e:
        return {'ok': False, 'reason': 'not_implemented', 'error': str(e)}
    except ValueError as e:
        return {'ok': False, 'reason': 'value_error', 'error': str(e)}

    save = ctx.get('save_games')
    if callable(save):
        save()
    # Persist the updated state back to the store if we can.
    save_game = ctx.get('save_game')
    if callable(save_game):
        save_game(game_id, new_game)

    # Refresh the Discord board view + both hand views.
    try:
        from python.discord_bot import game_channels as gc
        backend = ctx.get('channel_backend')
        gc.refresh_game_view(game_id, new_game, backend=backend)
        gc.refresh_hand_view(game_id, 1, new_game, backend=backend)
        gc.refresh_hand_view(game_id, 2, new_game, backend=backend)
    except Exception:
        pass

    return {'ok': True, 'gameId': game_id, 'customId': custom_id, 'game': new_game}


def _extract_custom_id(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _extract_user_id(interaction: Any) -> str:
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    if hasattr(interaction, 'userId'):
        return str(interaction.userId)
    if hasattr(interaction, 'user_id'):
        return str(interaction.user_id)
    return ''


def _extract_game_id(custom_id: str) -> str:
    """Most customIds embed gameId as the first underscore-delimited segment
    after the handler prefix. We walk the _BRIDGED_PREFIXES list to find the
    matching prefix, then return the first remaining segment.
    """
    for prefix, _ in _BRIDGED_PREFIXES:
        if custom_id.startswith(prefix):
            rest = custom_id[len(prefix):]
            parts = rest.split('_', 1)
            return parts[0] if parts else ''
    return ''


# ── Registration ────────────────────────────────────────────────────────────

def install() -> None:
    """Register every bridged prefix under its declared context group.

    Idempotent-safe via the handlers registry's duplicate-prefix guard.
    """
    from python.discord_bot.handlers import _PREFIX_SET
    for prefix, group in _BRIDGED_PREFIXES:
        if prefix in _PREFIX_SET:
            continue  # something more specific already owns it
        register(prefix, _bridge_handler, group)


# Self-register at import time (main.py imports this module)
install()
