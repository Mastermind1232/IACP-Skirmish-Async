/**
 * Interaction router: map customId to handler key (prefix) for dispatch.
 * Button prefixes are auto-derived from the handler registry in handlers/index.js.
 * Only select menu and modal prefixes are maintained here manually.
 */
import { getRegisteredButtonPrefixes } from './handlers/index.js';

/**
 * Button prefixes: auto-derived from handler registry + a small set of
 * inline handlers that live directly in index.js (not in the handler registry).
 * Computed once on first use.
 */
const LOCAL_BUTTON_PREFIXES = ['ping_active_', 'create_game', 'join_game'];
let _buttonPrefixes = null;
function getButtonPrefixes() {
  if (!_buttonPrefixes) {
    _buttonPrefixes = [...getRegisteredButtonPrefixes(), ...LOCAL_BUTTON_PREFIXES];
  }
  return _buttonPrefixes;
}

/** Modal submit prefixes. */
const MODAL_PREFIXES = [
  'squad_modal_',
  'deploy_modal_',
  'devaron_crate_modal_',
  'krykna_push_modal_',
  'dc_rename_modal_',
];

/** String select menu prefixes. */
const SELECT_PREFIXES = [
  'dc_fig_select_',
  'arsenal_pick_',
  'setup_attach_to_',
  'map_selection_draw_',
  'map_selection_pick_',
  'cc_attach_to_',
  'cc_play_select_',
  'cc_discard_select_',
  'overwatch_space_sel_',
  'pounce_space_sel_',
  'false_orders_space_sel_',
  'rush_push_space_sel_',
  'shoulder_rush_space_sel_',
  'bomb_drop_space_sel_',
  'cc_space_sel_',
];

/**
 * Return the first matching handler key (prefix) for the given customId and interaction type.
 * @param {string} customId
 * @param {'button'|'modal'|'select'} type
 * @returns {string|null}
 */
export function getHandlerKey(customId, type) {
  if (!customId || typeof customId !== 'string') return null;
  const list = type === 'button' ? getButtonPrefixes() : type === 'modal' ? MODAL_PREFIXES : SELECT_PREFIXES;
  for (const prefix of list) {
    if (customId.startsWith(prefix)) return prefix;
  }
  return null;
}

export { MODAL_PREFIXES, SELECT_PREFIXES };
