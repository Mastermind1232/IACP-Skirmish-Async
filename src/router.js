/**
 * Interaction router: map customId to handler key (prefix) for dispatch.
 * Single place to register all customId prefixes; order matters (first match wins).
 */

/** Button interaction prefixes, in dispatch order. */
const BUTTON_PREFIXES = [
  'request_resolve_',
  'request_reject_',
  'deck_illegal_play_',
  'deck_illegal_redo_',
  'dc_activate_',
  'dc_unactivate_',
  'dc_toggle_',
  'dc_deplete_',
  'dc_cc_special_',
  'dc_move_',
  'dc_attack_',
  'dc_interact_',
  'dc_special_',
  'special_done_',
  'move_mp_',
  'move_adjust_mp_',
  'move_pick_',
  'attack_target_',
  'cleave_target_',
  'combat_ready_',
  'combat_roll_',
  'combat_surge_',
  'status_phase_',
  'end_end_of_round_',
  'end_start_of_round_',
  'map_selection_',
  'draft_random_',
  'pass_activation_turn_',
  'end_turn_',
  'confirm_activate_',
  'cancel_activate_',
  'interact_cancel_',
  'interact_choice_',
  'refresh_map_',
  'refresh_all_',
  'undo_',
  'determine_initiative_',
  'deployment_zone_red_',
  'deployment_zone_blue_',
  'deployment_fig_',
  'deployment_orient_',
  'deploy_pick_',
  'deployment_done_',
  'cc_shuffle_draw_',
  'cc_play_',
  'cc_draw_',
  'cc_search_discard_',
  'cc_close_discard_',
  'cc_discard_',
  'illegal_cc_ignore_',
  'illegal_cc_unplay_',
  'botmenu_archive_yes_',
  'botmenu_archive_no_',
  'botmenu_kill_yes_',
  'botmenu_kill_no_',
  'botmenu_archive_',
  'botmenu_kill_',
  'kill_game_',
  'default_deck_',
  'squad_select_',
  'lobby_join_',
  'lobby_start_',
  'create_game',
  'join_game',
];

/** Modal submit prefixes. */
const MODAL_PREFIXES = [
  'squad_modal_',
  'deploy_modal_',
];

/** String select menu prefixes. */
const SELECT_PREFIXES = [
  'setup_attach_to_',
  'map_selection_draw_',
  'map_selection_pick_',
  'map_selection_menu_',
  'cc_attach_to_',
  'cc_play_select_',
  'cc_discard_select_',
];

/**
 * Return the first matching handler key (prefix) for the given customId and interaction type.
 * @param {string} customId
 * @param {'button'|'modal'|'select'} type
 * @returns {string|null}
 */
export function getHandlerKey(customId, type) {
  if (!customId || typeof customId !== 'string') return null;
  const list = type === 'button' ? BUTTON_PREFIXES : type === 'modal' ? MODAL_PREFIXES : SELECT_PREFIXES;
  for (const prefix of list) {
    if (customId.startsWith(prefix)) return prefix;
  }
  return null;
}

export { BUTTON_PREFIXES, MODAL_PREFIXES, SELECT_PREFIXES };
