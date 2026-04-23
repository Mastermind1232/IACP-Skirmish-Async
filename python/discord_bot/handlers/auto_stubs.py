"""Auto-generated stub handlers for remaining JS-side prefixes.

Every customId prefix registered in src/handlers/index.js that doesn't
yet have a concrete Python port lands here. Each stub:

  - Parses the customId with a tolerant regex (prefix + optional tail)
  - Resolves gameId from the first underscore-delimited segment when
    present
  - Returns {'ok': True, 'stub': True, 'prefix', 'customId', 'gameId'}

Purpose: guarantee 100% dispatcher coverage so no button falls through
the router. The bot layer inspects `stub=True` and can surface an
'under construction' ephemeral message instead of silently succeeding.

As real ports land for a prefix, the concrete registration in its
domain module (e.g. `dc_play_area.py`) takes precedence — this stub
file's `install()` skips any prefix already claimed.

Do not hand-edit the _STUB_PREFIXES list without also updating the
generator: it is derived from `src/handlers/index.js`.
"""
from __future__ import annotations

from typing import Any, Dict, List

from python.discord_bot.handlers import register


# Every prefix below shadows a JS handler that the Python port has not
# yet reached. The list is ordered the same as JS register() calls so
# the diff against a future auto-regeneration stays minimal.
_STUB_PREFIXES: List[str] = [
    'lobby_join_',
    'lobby_start_',
    'request_resolve_',
    'request_reject_',
    'refresh_map_',
    'refresh_all_',
    'undo_',
    'kill_game_',
    'default_deck_',
    'ctf_pick_',
    'ctf_strain_',
    'doubt_fig_',
    'pd_pick_',
    'pd_security_pick_',
    'pd_strike_adj_',
    'pd_strike_order_',
    'pd_strike_token_',
    'pd_move_skip_',
    'pd_move_stay_',
    'pd_sl_pick_',
    'pd_walker_move_',
    'pd_arms_dist_fig_',
    'pd_arms_dist_token_',
    'pd_comp_space_',
    'move_adjust_mp_',
    'move_pick_',
    'massive_push_space_',
    'massive_push_figure_',
    'mvint_play_',
    'ow_interrupt_use_',
    'dio_follow_pick_',
    'cleave_target_',
    'cover_fire_discard_',
    'guidance_systems_',
    'ct_reroll_',
    'rogue_one_token_',
    'figurehead_use_',
    'figurehead_skip_',
    'lasat_die_',
    'lasat_face_',
    'false_orders_space_',
    'order_move_space_',
    'order_move_',
    'false_orders_atk_',
    'zillo_discard_',
    'ud_deplete_use_',
    'ud_deplete_skip_',
    'act_passive_',
    'confirm_activate_',
    'field_tactics_pick_',
    'fv_pick_',
    'lia_deploy_zone_',
    'sc_fig_pick_',
    'hair_trigger_use_',
    'iwba_use_',
    'iwba_pick_',
    'iwba_action_',
    'map_selection_',
    'deployment_zone_red_',
    'deployment_zone_blue_',
    'deployment_orient_',
    'deploy_pick_',
    'deploy_row_back_',
    'deploy_row_',
    'loadout_select_',
    'loadout_confirm_',
    'form_pick_',
    'setup_attach_to_',
    'attach_confirm_',
    'attach_done_redo_',
    'blitz_group_',
    'blitz_pass_',
    'blitz_move_fig_',
    'blitz_move_pick_',
    'blitz_move_done_',
    'dc_unactivate_',
    'dc_toggle_',
    'dc_rename_',
    'dc_cc_eoa_',
    'rush_push_space_',
    'shoulder_rush_space_',
    'ob_deplete_',
    'space_row_back_',
    'space_row_',
    'squad_confirm_',
    'deck_illegal_play_',
    'deck_illegal_redo_',
    'ike_keep_',
    'cc_play_',
    'cc_draw_',
    'cc_search_discard_',
    'cc_close_discard_',
    'cc_discard_',
    'squad_select_',
    'illegal_cc_ignore_',
    'illegal_cc_unplay_',
    'negation_play_',
    'negation_let_resolve_',
    'fav_save_',
    'fav_remove_',
    'fav_rename_',
    'fav_choose_',
    'fav_choose_select_',
    'fav_list_select_',
    'fav_list_rename_',
    'fav_list_remove_',
    'fav_list_back_',
    'botmenu_recover_',
    'botmenu_kill_yes_',
    'forfeit_yes_',
    'forfeit_',
    'fast_forward_',
    'dc_cc_defender_',
    'tough_luck_remove_',
    'there_is_no_try_die_',
    'there_is_no_try_face_',
    'vet_instincts_pick_',
    'hunter_protocol_trigger_',
    'strike_me_down_yes_',
    'slow_on_draw_yes_',
    'slow_on_draw_resume_',
    'power_converter_approve_',
    'power_converter_skip_',
    'power_converter_die_',
    'power_converter_color_',
    'illicit_arms_use_',
    'illicit_arms_skip_',
    'illicit_arms_pick_',
    'force_exhaustion_yes_',
    'force_exhaustion_no_',
    'doubt_reroll_use_',
    'doubt_reroll_skip_',
    'reaction_use_',
    'right_back_block_',
    'right_back_nodmg_',
    'mastery_pick_',
    'interrogate_pick_',
    'interrogate_discard_',
    'still_faster_use_',
    'still_faster_skip_',
    'still_faster_dc_pick_',
    'squad_swarm_yes_',
    'squad_swarm_no_',
    'overdrive_use_',
    'self_destruct_probe_use_',
    'self_destruct_probe_skip_',
    'self_destruct_protocol_use_',
    'self_destruct_protocol_skip_',
    'last_resort_use_',
    'last_resort_skip_',
    'yhsiw_transfer_',
    'yhsiw_damage_',
    'submit_fight_use_',
    'submit_fight_skip_',
    'scavenged_walker_attack_',
    'scavenged_walker_skip_',
    'dbh_force_choke_',
    'dbh_attack_',
    'dbh_skip_',
    'on_diplomatic_',
    'ab_blade_pick_',
    'sf_mp_pick_',
    'ps_replace_',
    'force_slow_pick_',
    'excavation_pick_',
    'bm_draw_',
    'bm_discard_',
    'bm_return_',
    'bm_skip_',
    'executor_use_',
    'executor_skip_',
    'extra_protection_play_',
    'extra_protection_skip_',
    'devaron_door_open_',
    'devaron_crate_push_',
    'krykna_push_',
    'krykna_place_pick_',
    'krykna_place_skip_',
    'krykna_place_',
    'fluctuation_swap_',
    'fluctuation_skip_',
    'bleed_accept_',
    'bleed_prevent_',
    'sidewinder_apply_',
    'boltslinger_target_',
    'indiscriminate_die_',
    'fighting_knife_target_',
    'concussive_bolt_push_',
    'concussive_bolt_skip_',
    'spread_pain_fig_',
    'spread_pain_skip_',
    'heavy_fire_use_',
    'heavy_fire_tgt_done_',
    'heavy_fire_tgt_',
    'heavy_fire_cond_',
    'havoc_shot_use_',
    'havoc_shot_pick_',
    'havoc_shot_done_',
    'deflect_pick_',
    'wanton_use_',
    'wanton_cc_',
    'wanton_pick_',
    'wanton_done_',
    'map_selection_draw_',
    'map_selection_pick_',
    'cc_attach_to_',
    'bel_reorder_1_',
    'bel_reorder_2_',
    # handleDcAction covers these 4 via a single JS handler:
    'dc_attack_',
    'dc_move_',
    'dc_interact_',
    'dc_spend_mp_',
]


def _cid(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _make_stub(prefix: str):
    """Build a stub handler for a specific prefix.

    The handler returns `{'ok': True, 'stub': True, 'prefix', 'customId',
    'gameId'}`. It never mutates game state.
    """
    assert prefix.endswith('_')

    def _stub(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        if not cid.startswith(prefix):
            return {'ok': False, 'reason': 'malformed_custom_id',
                    'prefix': prefix}
        tail = cid[len(prefix):]
        # Most customIds put gameId as the first segment after the prefix
        parts = tail.split('_', 1) if tail else []
        game_id = parts[0] if parts else ''
        return {
            'ok': True, 'stub': True,
            'prefix': prefix, 'customId': cid, 'gameId': game_id,
        }

    _stub.__name__ = f'_stub_{prefix.strip("_")}'
    return _stub


def install() -> int:
    """Register stubs for every prefix not already claimed by a
    concrete handler. Returns the number of stubs actually installed.
    """
    from python.discord_bot.handlers import _PREFIX_SET
    installed = 0
    for prefix in _STUB_PREFIXES:
        if prefix in _PREFIX_SET:
            continue
        register(prefix, _make_stub(prefix), 'core')
        installed += 1
    return installed


# Self-install at import. The router loads this module after all
# concrete handler modules, so each stub only lands when nothing
# better claims the prefix.
_INSTALLED_COUNT = install()
