/**
 * Interaction router: map customId to handler key (prefix) for dispatch.
 * Button and select prefixes are auto-derived from the handler registry.
 * Only modal prefixes are maintained here manually (small, stable list).
 */
import { getRegisteredButtonPrefixes } from './handlers/index.js';

/**
 * Button prefixes: auto-derived from handler registry + a small set of
 * inline handlers that live directly in index.js (not in the handler registry).
 * Computed once on first use.
 */
const LOCAL_BUTTON_PREFIXES = ['ping_active_', 'create_game', 'join_game', 'botlog_resolve_'];
let _buttonPrefixes = null;
function getButtonPrefixes() {
  if (!_buttonPrefixes) {
    _buttonPrefixes = [...getRegisteredButtonPrefixes(), ...LOCAL_BUTTON_PREFIXES]
      .sort((a, b) => b.length - a.length);
  }
  return _buttonPrefixes;
}

/** Modal submit prefixes (inline handlers in index.js, not in the registry). */
const MODAL_PREFIXES = [
  'squad_modal_',
  'deploy_modal_',
  'devaron_crate_modal_',
  'krykna_push_modal_',
  'dc_rename_modal_',
  'fav_name_modal_',
  'fav_rename_modal_',
  'fav_list_rename_modal_',
];

/**
 * Select prefixes: auto-derived from handler registry (covers all registered
 * select handlers like arsenal_pick_, cc_attach_to_, etc.) + local prefixes
 * for inline/adapter handlers not in the registry.
 */
const LOCAL_SELECT_PREFIXES = [
  'dc_fig_select_',
  'overwatch_space_sel_',
  'pounce_space_sel_',
  'false_orders_space_sel_',
  'rush_push_space_sel_',
  'shoulder_rush_space_sel_',
  'bomb_drop_space_sel_',
  'cc_space_sel_',
];
let _selectPrefixes = null;
function getSelectPrefixes() {
  if (!_selectPrefixes) {
    _selectPrefixes = [...getRegisteredButtonPrefixes(), ...LOCAL_SELECT_PREFIXES]
      .sort((a, b) => b.length - a.length);
  }
  return _selectPrefixes;
}

/**
 * Return the first matching handler key (prefix) for the given customId and interaction type.
 * @param {string} customId
 * @param {'button'|'modal'|'select'} type
 * @returns {string|null}
 */
export function getHandlerKey(customId, type) {
  if (!customId || typeof customId !== 'string') return null;
  const list = type === 'button' ? getButtonPrefixes() : type === 'modal' ? MODAL_PREFIXES : getSelectPrefixes();
  for (const prefix of list) {
    if (customId.startsWith(prefix)) return prefix;
  }
  return null;
}
