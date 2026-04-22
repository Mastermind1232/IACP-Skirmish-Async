"""Per-player getters/setters + squad helpers — mirror of src/game/player-helpers.js.

Almost all functions are 2-branch ternaries (p1X vs p2X); the heavier
logic lives in recompute_activation_counts and dc_matches_playable_by.

Field names stay JS-native (camelCase) during the parity window because
the game dict is still written by JS during cross-validation. After
Phase 14 (JS deletion) callers can either keep camelCase or rewrap.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional


# ---------------------------------------------------------------------------
# Opponent / initiative

def opponent_player_num(pn: int) -> int:
    return 2 if pn == 1 else 1


def get_initiative_player_num(game: Any) -> int:
    data = _data(game)
    return 1 if data.get('initiativePlayerId') == data.get('player1Id') else 2


# ---------------------------------------------------------------------------
# Squad cost

def sum_squad_dc_cost(squad: Optional[Dict[str, Any]],
                      stats_lookup: Callable[[str], Optional[Dict[str, Any]]]) -> int:
    """Sum DC costs for a squad. Handles bracketed attachments + Regular/Elite variants."""
    dc_list = (squad or {}).get('dcList') or []
    total = 0
    for entry in dc_list:
        name = entry.strip('[]') if isinstance(entry, str) else entry
        stats = (
            stats_lookup(name)
            or stats_lookup(f'[{name}]')
            or stats_lookup(f'{name} (Regular)')
            or stats_lookup(f'{name} (Elite)')
        )
        if stats and stats.get('cost') is not None:
            total += stats['cost']
    return total


# ---------------------------------------------------------------------------
# Getters (pn → field)

def _get(game: Any, p1_key: str, p2_key: str, pn: int) -> Any:
    data = _data(game)
    return data.get(p1_key) if pn == 1 else data.get(p2_key)


def get_player_id(game, pn):                 return _get(game, 'player1Id',               'player2Id',               pn)
def get_dc_list(game, pn):                   return _get(game, 'p1DcList',                'p2DcList',                pn)
def get_dc_message_ids(game, pn):            return _get(game, 'p1DcMessageIds',          'p2DcMessageIds',          pn)
def get_hand_channel_id(game, pn):           return _get(game, 'p1HandId',                'p2HandId',                pn)
def get_play_area_id(game, pn):              return _get(game, 'p1PlayAreaId',            'p2PlayAreaId',            pn)
def get_activations_remaining(game, pn):     return _get(game, 'p1ActivationsRemaining',  'p2ActivationsRemaining',  pn)
def get_activations_total(game, pn):         return _get(game, 'p1ActivationsTotal',      'p2ActivationsTotal',      pn)
def get_activations_message_id(game, pn):    return _get(game, 'p1ActivationsMessageId',  'p2ActivationsMessageId',  pn)
def get_activated_dc_indices(game, pn):      return _get(game, 'p1ActivatedDcIndices',    'p2ActivatedDcIndices',    pn)
def get_discard_thread_id(game, pn):         return _get(game, 'p1DiscardThreadId',       'p2DiscardThreadId',       pn)
def get_squad(game, pn):                     return _get(game, 'player1Squad',            'player2Squad',            pn)
def get_cc_hand(game, pn):                   return _get(game, 'player1CcHand',           'player2CcHand',           pn)
def get_cc_discard(game, pn):                return _get(game, 'player1CcDiscard',        'player2CcDiscard',        pn)
def get_cc_deck(game, pn):                   return _get(game, 'player1CcDeck',           'player2CcDeck',           pn)
def get_cc_attachments(game, pn):            return _get(game, 'p1CcAttachments',         'p2CcAttachments',         pn)
def get_dc_attachments(game, pn):            return _get(game, 'p1DcAttachments',         'p2DcAttachments',         pn)


# ---------------------------------------------------------------------------
# Health state sync

def sync_health_state_to_list(game: Any, player_num: int, msg_id: str,
                              health_state: List) -> None:
    """Sync a figure's health state array back to the DC list for persistence."""
    dc_ids = get_dc_message_ids(game, player_num) or []
    dc_list = get_dc_list(game, player_num) or []
    if msg_id not in dc_ids:
        return
    idx = dc_ids.index(msg_id)
    if idx >= 0 and idx < len(dc_list) and isinstance(dc_list[idx], dict):
        dc_list[idx]['healthState'] = list(health_state)


# ---------------------------------------------------------------------------
# Setters

def _set(game: Any, p1_key: str, p2_key: str, pn: int, v: Any) -> None:
    data = _data(game)
    data[p1_key if pn == 1 else p2_key] = v


def set_activations_remaining(game, pn, v):  _set(game, 'p1ActivationsRemaining', 'p2ActivationsRemaining', pn, v)
def set_activations_total(game, pn, v):      _set(game, 'p1ActivationsTotal',     'p2ActivationsTotal',     pn, v)
def set_activated_dc_indices(game, pn, v):   _set(game, 'p1ActivatedDcIndices',   'p2ActivatedDcIndices',   pn, v)


# ---------------------------------------------------------------------------
# Activation count recompute (single source of truth)

_SKIRMISH_UPGRADE_RE = re.compile(r'^\[.+\]$')


def recompute_activation_counts(game: Any, pn: int) -> Dict[str, int]:
    """Recompute ActivationsTotal / ActivationsRemaining from board state.

    A DC is activatable if it has figures on the board. Lie-in-Ambush
    set-aside groups are out-of-play and do NOT count until deployed.
    Mirrors JS recomputeActivationCounts.
    """
    data = _data(game)
    dc_list = get_dc_list(game, pn) or []
    figs = (data.get('figurePositions') or {}).get(pn) or {}
    fig_keys = list(figs.keys())
    activated_indices = get_activated_dc_indices(game, pn) or []

    total = 0
    activated = 0
    dg_counts: Dict[str, int] = {}

    for i, entry in enumerate(dc_list):
        dc_name = entry.get('dcName') if isinstance(entry, dict) else entry
        if not isinstance(dc_name, str):
            continue
        if _SKIRMISH_UPGRADE_RE.match(dc_name):
            continue
        dg_counts[dc_name] = dg_counts.get(dc_name, 0) + 1
        dg_index = dg_counts[dc_name]
        prefix = f'{dc_name}-{dg_index}-'
        has_figures = any(fk.startswith(prefix) and figs.get(fk) for fk in fig_keys)
        if has_figures:
            total += 1
            if i in activated_indices:
                activated += 1

    set_activations_total(game, pn, total)
    set_activations_remaining(game, pn, total - activated)
    return {'total': total, 'remaining': total - activated}


# ---------------------------------------------------------------------------
# Figure position mutations

def remove_figure_position(game: Any, pn: int, figure_key: str) -> None:
    """Remove a figure's position and clean up per-figure state."""
    data = _data(game)
    positions = (data.get('figurePositions') or {}).get(pn)
    if isinstance(positions, dict) and figure_key in positions:
        del positions[figure_key]
    device_tokens = data.get('deviceTokens')
    if isinstance(device_tokens, dict) and figure_key in device_tokens:
        del device_tokens[figure_key]
    conditions = data.get('figureConditions')
    if isinstance(conditions, dict) and figure_key in conditions:
        del conditions[figure_key]


def push_figure(game: Any, player_num: int, figure_key: str,
                new_space: str) -> Optional[Dict[str, str]]:
    """Move a figure already on the board to a new space.

    Returns {'prevPos', 'newPos'} or None if figure has no current position.
    """
    data = _data(game)
    positions = (data.get('figurePositions') or {}).get(player_num)
    if not isinstance(positions, dict):
        return None
    prev_pos = positions.get(figure_key)
    if prev_pos is None:
        return None
    new_pos = str(new_space).lower()
    positions[figure_key] = new_pos
    return {'prevPos': prev_pos, 'newPos': new_pos}


# ---------------------------------------------------------------------------
# Key helpers (for code that needs both read+write via game[key])

def cc_hand_key(pn):                    return 'player1CcHand' if pn == 1 else 'player2CcHand'
def cc_discard_key(pn):                 return 'player1CcDiscard' if pn == 1 else 'player2CcDiscard'
def cc_deck_key(pn):                    return 'player1CcDeck' if pn == 1 else 'player2CcDeck'
def cc_drawn_key(pn):                   return 'player1CcDrawn' if pn == 1 else 'player2CcDrawn'
def cc_attachments_key(pn):             return 'p1CcAttachments' if pn == 1 else 'p2CcAttachments'
def dc_attachments_key(pn):             return 'p1DcAttachments' if pn == 1 else 'p2DcAttachments'
def dc_attachment_message_ids_key(pn):  return 'p1DcAttachmentMessageIds' if pn == 1 else 'p2DcAttachmentMessageIds'
def vp_key(pn):                         return 'player1VP' if pn == 1 else 'player2VP'
def deploy_metadata_key(pn):            return 'player1DeployMetadata' if pn == 1 else 'player2DeployMetadata'
def deploy_labels_key(pn):              return 'player1DeployLabels' if pn == 1 else 'player2DeployLabels'
def army_cost_modifier_key(pn):         return 'player1ArmyCostModifier' if pn == 1 else 'player2ArmyCostModifier'
def activated_dc_indices_key(pn):       return 'p1ActivatedDcIndices' if pn == 1 else 'p2ActivatedDcIndices'


# ---------------------------------------------------------------------------
# DC / playableBy matching

_DG_SUFFIX_RE = re.compile(r'\s*\[(?:DG|Group) \d+\]$', re.IGNORECASE)
_VARIANT_SUFFIX_RE = re.compile(r'\s*\((?:Elite|Regular)\)\s*$', re.IGNORECASE)

_AFFILIATIONS = frozenset({'imperial', 'rebel', 'scum', 'mercenary'})


def dc_matches_playable_by(dc_name: str,
                           playable_by: Optional[str],
                           get_dc_effects_fn: Optional[Callable[[], Dict[str, Any]]],
                           get_dc_keywords_fn: Optional[Callable[[Any], Dict[str, List[str]]]],
                           game: Any,
                           display_name: Optional[str] = None) -> bool:
    """Check whether a DC matches a CC's playableBy restriction.

    Mirrors src/game/player-helpers.js:dcMatchesPlayableBy byte-for-byte.
    """
    if not playable_by:
        return True
    lower = playable_by.lower().strip()
    if not lower or lower == 'any figure':
        return True

    dc_base = _VARIANT_SUFFIX_RE.sub('', _DG_SUFFIX_RE.sub('', dc_name)).strip()
    all_dc_effects = (get_dc_effects_fn() if get_dc_effects_fn else None) or {}
    dc_data = all_dc_effects.get(dc_name) or all_dc_effects.get(dc_base) or {}

    if get_dc_keywords_fn:
        kw_map = get_dc_keywords_fn(game) or {}
        kw_raw = kw_map.get(dc_name) or kw_map.get(dc_base) or []
    else:
        kw_raw = dc_data.get('keywords') or []
    kw_lower = [str(k).lower() for k in kw_raw]
    affiliation_lower = str(dc_data.get('affiliation') or '').lower()

    alternatives = [a.strip().strip('"') for a in re.split(r'\s+or\s+', lower, flags=re.IGNORECASE)]

    for alt in alternatives:
        if alt in ('unique', 'any unique figure'):
            if dc_data.get('unique'):
                return True
            continue
        if alt == 'any small figure':
            if 'small' in kw_lower:
                return True
            continue

        dc_low = dc_base.lower()
        if dc_low in alt or alt in dc_low:
            return True
        if display_name:
            disp_base = _VARIANT_SUFFIX_RE.sub('', _DG_SUFFIX_RE.sub('', str(display_name))).strip().lower()
            if disp_base and (disp_base in alt or alt in disp_base):
                return True

        words = alt.split()
        req_aff = None
        req_kw_words: List[str] = []
        for w in words:
            if w in _AFFILIATIONS and not req_aff:
                req_aff = w
            else:
                req_kw_words.append(w)
        req_kw = ' '.join(req_kw_words)
        if req_aff and affiliation_lower not in (req_aff, 'any'):
            continue
        if req_kw and req_kw not in kw_lower:
            continue
        if req_aff or req_kw:
            return True
    return False


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    """Unwrap GameState → dict if needed. Tolerates plain dicts too."""
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'player_helpers expected GameState or dict, got {type(game).__name__}'
    )
