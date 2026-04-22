"""D7.6 — decode_state: (spatial[96,32,32], scalar[1481]) -> GameState.

Inverse of `encode_state`. The contract is *tensor-equivalent* bijection:

    encode_state(decode_state(encode_state(g), pov), pov) == encode_state(g, pov)

The returned GameState is the smallest dict such that re-encoding reproduces
the source tensor exactly. It is NOT required to byte-equal the original game
(the encoder is lossy on identities like gameId, player names, and numeric
values beyond the normalization caps). It IS required to carry every
tensor-observable fact — positions, traits, HP, tokens, flags, etc.

All channel / scalar indices are imported from encode.py to keep the layout
source-of-truth singular.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import torch

from python.engine.state import GameState
from python.engine.data.dc_effects_loader import get_dc_effects, get_dc_effect
from python.engine.data.figure_sizes_loader import get_figure_size
from python.engine.mechanics.coords import col_row_to_coord

from python.encoding import encode as E


# ---------------------------------------------------------------------------
# Tensor helpers
# ---------------------------------------------------------------------------

def _lit(spatial: torch.Tensor, channel: int) -> List[Tuple[int, int]]:
    """Return (y, x) pairs where spatial[channel] > 0, inside the on-grid
    [0..27] x [0..25] subrange only."""
    out: List[Tuple[int, int]] = []
    for y in range(E._MAX_ROW_Y + 1):
        for x in range(E._MAX_COL_X + 1):
            if spatial[channel, y, x].item() > 0.0:
                out.append((y, x))
    return out


def _xy_to_coord(y: int, x: int) -> str:
    return col_row_to_coord(x, y)


def _cell_val(spatial: torch.Tensor, channel: int, y: int, x: int) -> float:
    return float(spatial[channel, y, x].item())


# ---------------------------------------------------------------------------
# Reverse library indices
# ---------------------------------------------------------------------------

_TRAIT_REVERSE: Optional[Dict[Tuple[Any, ...], str]] = None


def _trait_signature(dc_name: str) -> Tuple[Any, ...]:
    effect = get_dc_effect(dc_name) or {}
    kws = frozenset(E._canonical_keywords(effect.get('keywords')))
    aff_raw = (effect.get('affiliation') or 'Any')
    aff_l = aff_raw.lower() if isinstance(aff_raw, str) else ''
    if aff_l == 'imperial':
        aff_ch = E._S_AFF_IMPERIAL
    elif aff_l == 'rebel':
        aff_ch = E._S_AFF_REBEL
    elif aff_l in ('mercenary', 'merc', 'scum'):
        aff_ch = E._S_AFF_MERC
    else:
        aff_ch = E._S_AFF_ANY
    size_ch = E._size_channel(get_figure_size(dc_name, '1x1'))
    is_attach = bool(effect.get('isAttachment') or effect.get('attachment'))
    return (kws, aff_ch, size_ch, is_attach)


def _trait_reverse() -> Dict[Tuple[Any, ...], str]:
    """Reverse lookup: (kw_set, aff_ch, size_ch, is_attach) -> first matching
    DC name in sorted order. Built lazily from the DC library."""
    global _TRAIT_REVERSE
    if _TRAIT_REVERSE is not None:
        return _TRAIT_REVERSE
    out: Dict[Tuple[Any, ...], str] = {}
    for name in sorted(get_dc_effects().keys()):
        sig = _trait_signature(name)
        if sig not in out:
            out[sig] = name
    _TRAIT_REVERSE = out
    return out


# ---------------------------------------------------------------------------
# Scalar block decoders
# ---------------------------------------------------------------------------

def _decode_block_a(scalar: torch.Tensor, data: Dict[str, Any]) -> None:
    for i, mid in enumerate(E._MISSION_ORDER):
        if scalar[i].item() == 1.0:
            data['mapId'] = mid
            data['selectedMap'] = mid
            break
    round_norm = float(scalar[E._A_ROUND_NORM].item())
    data['round'] = int(round(round_norm * E._ROUND_CAP))


def _decode_block_b(
    scalar: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    phase_rev = {
        E._B_PHASE_SQUAD_SELECT: 'initiative',
        E._B_PHASE_DEPLOYMENT: 'deployment',
        E._B_PHASE_CC_DRAW: 'cc_draw',
        E._B_PHASE_ROUND_ACTIVE: 'round_active',
        E._B_PHASE_ENDED: 'ended',
        E._B_PHASE_OTHER: 'attachment',
    }
    for idx, val in phase_rev.items():
        if scalar[idx].item() == 1.0:
            data['phase'] = val
            break
    rp_rev = {
        E._B_RP_SOR: 'start_of_round',
        E._B_RP_ACTIVATION: 'activation',
        E._B_RP_EOR: 'end_of_round',
    }
    for idx, val in rp_rev.items():
        if scalar[idx].item() == 1.0:
            data['roundPhase'] = val
            break
    if scalar[E._B_OWN_INIT].item() == 1.0:
        data['initiativeHolder'] = own
    elif scalar[E._B_OPP_INIT].item() == 1.0:
        data['initiativeHolder'] = opp
    if scalar[E._B_OWN_ACTIVE].item() == 1.0:
        data['activePlayer'] = own
    elif scalar[E._B_OPP_ACTIVE].item() == 1.0:
        data['activePlayer'] = opp
    if scalar[E._B_SOR_PENDING].item() == 1.0:
        # _fill_block_b reads pendingSorActions OR sorEffectsPending; either truthy lights the bit.
        data['pendingSorActions'] = True


def _decode_block_c(
    scalar: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    own_vp = int(round(float(scalar[E._C_OWN_VP].item()) * E._VP_CAP))
    opp_vp = int(round(float(scalar[E._C_OPP_VP].item()) * E._VP_CAP))
    if own == 1:
        data['player1VP'] = {'total': own_vp, 'kills': 0, 'objectives': 0}
        data['player2VP'] = {'total': opp_vp, 'kills': 0, 'objectives': 0}
    else:
        data['player1VP'] = {'total': opp_vp, 'kills': 0, 'objectives': 0}
        data['player2VP'] = {'total': own_vp, 'kills': 0, 'objectives': 0}


def _decode_block_d(
    scalar: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    own_act = 0
    opp_act = 0
    for i in range(10):
        if scalar[E._D_OWN_ACTIVATIONS_BASE + i].item() == 1.0:
            own_act = i
        if scalar[E._D_OPP_ACTIVATIONS_BASE + i].item() == 1.0:
            opp_act = i
    data['activationsRemaining'] = {own: own_act, opp: opp_act}


def _aff_from_scalars(
    scalar: torch.Tensor,
    rebel_idx: int,
    imp_idx: int,
    merc_idx: int,
) -> str:
    if scalar[rebel_idx].item() == 1.0:
        return 'Rebel'
    if scalar[imp_idx].item() == 1.0:
        return 'Imperial'
    if scalar[merc_idx].item() == 1.0:
        return 'Mercenary'
    return 'Any'


def _decode_blocks_e_f_j(
    scalar: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> Tuple[List[str], List[str]]:
    own_aff = _aff_from_scalars(
        scalar, E._E_OWN_REBEL, E._E_OWN_IMPERIAL, E._E_OWN_MERC
    )
    opp_aff = _aff_from_scalars(
        scalar, E._E_OPP_REBEL, E._E_OPP_IMPERIAL, E._E_OPP_MERC
    )
    own_cost = int(round(float(scalar[E._F_OWN_COST].item()) * E._SQUAD_COST_CAP))
    opp_cost = int(round(float(scalar[E._F_OPP_COST].item()) * E._SQUAD_COST_CAP))

    # Roster bitset -> DC names
    dc_sorted = sorted(get_dc_effects().keys())
    own_roster: List[str] = []
    opp_roster: List[str] = []
    for i, name in enumerate(dc_sorted):
        if i >= 241:
            break
        if scalar[E._J_OWN_ROSTER_BASE + i].item() == 1.0:
            own_roster.append(name)
        if scalar[E._J_OPP_ROSTER_BASE + i].item() == 1.0:
            opp_roster.append(name)

    own_squad = {
        'affiliation': own_aff,
        'cost': own_cost,
        'deploymentCards': own_roster,
    }
    opp_squad = {
        'affiliation': opp_aff,
        'cost': opp_cost,
        'deploymentCards': opp_roster,
    }
    data['squads'] = {own: own_squad, opp: opp_squad}
    return own_roster, opp_roster


def _decode_blocks_g_h_i(
    scalar: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    cc_sorted = E._CC_SORTED or []
    if not cc_sorted:
        # Prime the encoder's cache.
        E._cc_index()
        cc_sorted = E._CC_SORTED or []

    own_hand_names: List[str] = []
    own_discard_names: List[str] = []
    opp_discard_names: List[str] = []
    for i, name in enumerate(cc_sorted):
        if i >= 293:
            break
        if scalar[E._G_OWN_HAND_BITSET_BASE + i].item() == 1.0:
            own_hand_names.append(name)
        if scalar[E._H_OWN_DISCARD_BASE + i].item() == 1.0:
            own_discard_names.append(name)
        if scalar[E._H_OPP_DISCARD_BASE + i].item() == 1.0:
            opp_discard_names.append(name)

    own_hand_size = int(round(float(scalar[E._G_OWN_HAND_SIZE].item()) * E._HAND_CAP))
    opp_hand_size = int(round(float(scalar[E._I_OPP_HAND].item()) * E._HAND_CAP))
    own_deck_size = int(round(float(scalar[E._I_OWN_DECK].item()) * E._DECK_CAP))
    opp_deck_size = int(round(float(scalar[E._I_OPP_DECK].item()) * E._DECK_CAP))

    # Pad own hand with placeholder cards if the bitset is thinner than the size.
    # The encoder paints hand_size = min(len/_HAND_CAP, 1.0); to re-encode the
    # same size we just need a list with that many entries. Any unindexed
    # placeholder name works since opp discard names aren't in hand.
    if len(own_hand_names) < own_hand_size:
        pad = own_hand_size - len(own_hand_names)
        own_hand_names = own_hand_names + ['__UNKNOWN_CC__'] * pad
    elif len(own_hand_names) > own_hand_size:
        own_hand_names = own_hand_names[:own_hand_size]

    # Opponent hand is size-only; encoder uses len() but ignores names there.
    opp_hand_names = ['__UNKNOWN_CC__'] * opp_hand_size

    data['ccHand'] = {own: own_hand_names, opp: opp_hand_names}
    data['ccDiscard'] = {own: own_discard_names, opp: opp_discard_names}
    # _deck_size() accepts a bare int, which keeps us bit-identical for sizes.
    data['ccDeck'] = {own: own_deck_size, opp: opp_deck_size}


def _decode_block_k(scalar: torch.Tensor, data: Dict[str, Any]) -> None:
    for field, idx in E._K_NAMED_IDX.items():
        if scalar[idx].item() == 1.0:
            # A bare True is _is_pending_truthy, and the encoder only reads
            # truthiness for Block-K bit painting. Real game semantics live
            # in the spatial channels (pendingCombat etc.).
            data[field] = True
    if scalar[E._K_CATCHALL].item() == 1.0:
        # Encode any unknown pending bit by injecting a single synthetic
        # field that _fill_block_k's catch-all will detect.
        data['pendingDecoderCatchAll'] = True


# ---------------------------------------------------------------------------
# Spatial decoders — non-figure channels
# ---------------------------------------------------------------------------

def _decode_doors(spatial: torch.Tensor, data: Dict[str, Any]) -> None:
    doors: List[Dict[str, Any]] = []
    for y, x in _lit(spatial, E._S_DOOR_OPEN):
        doors.append({'cells': [_xy_to_coord(y, x)], 'open': True})
    for y, x in _lit(spatial, E._S_DOOR_CLOSED):
        doors.append({'cells': [_xy_to_coord(y, x)], 'open': False})
    if doors:
        data['doors'] = doors


def _decode_fluctuations(spatial: torch.Tensor, data: Dict[str, Any]) -> None:
    fluct: Dict[str, List[str]] = {}
    for color, ch in (
        ('yellow', E._S_FLUCT_YELLOW),
        ('blue', E._S_FLUCT_BLUE),
        ('green', E._S_FLUCT_GREEN),
        ('red', E._S_FLUCT_RED),
    ):
        coords = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, ch)]
        if coords:
            fluct[color] = coords
    if fluct:
        data['currentFluctuationPositions'] = fluct


def _decode_objectives(
    spatial: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    # crates
    crates: Dict[str, Any] = {}
    for y, x in _lit(spatial, E._S_CRATE_PRESENT):
        coord = _xy_to_coord(y, x)
        hp_frac = _cell_val(spatial, E._S_CRATE_HP, y, x)
        if hp_frac > 0.0:
            crates[coord] = {'hp': hp_frac, 'maxHp': 1.0}
        else:
            crates[coord] = {}
    if crates:
        data['cratePositions'] = crates
    gen = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_CRATE_TOKEN_GEN)]
    if gen:
        data['genericCrateTokens'] = gen
    inter = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_CRATE_TOKEN_INT)]
    if inter:
        data['interactCrateTokens'] = inter

    # terminals
    terms: Dict[str, Any] = {}
    for y, x in _lit(spatial, E._S_TERMINAL_PRESENT):
        coord = _xy_to_coord(y, x)
        meta: Dict[str, Any] = {}
        if _cell_val(spatial, E._S_TERMINAL_FRIEND_CTRL, y, x) == 1.0:
            meta['controller'] = own
        elif _cell_val(spatial, E._S_TERMINAL_ENEMY_CTRL, y, x) == 1.0:
            meta['controller'] = opp
        terms[coord] = meta
    if terms:
        data['terminals'] = terms

    for field, ch in (
        ('deviceTokens', E._S_DEVICE_TOKEN),
        ('ancillaryTokenA', E._S_ANC_A),
        ('ancillaryTokenB', E._S_ANC_B),
        ('ancillaryTokenC', E._S_ANC_C),
        ('ancillaryTokenD', E._S_ANC_D),
        ('imperialCitadelTokens', E._S_IMP_CITADEL),
        ('orbitalBombardmentTokens', E._S_ORB_BOMBARDMENT),
        ('overwatchTokens', E._S_OVERWATCH_TOKEN),
        ('setTrapTokens', E._S_SET_TRAP),
    ):
        coords = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, ch)]
        if coords:
            data[field] = coords


def _decode_npcs(spatial: torch.Tensor, data: Dict[str, Any]) -> None:
    for field, ch in (
        ('npcKrykna', E._S_NPC_KRYKNA),
        ('npcThugs', E._S_NPC_THUG),
        ('claimedKrykna', E._S_NPC_KRYKNA_CLAIMED),
    ):
        coords = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, ch)]
        if coords:
            data[field] = coords


def _decode_pending_masks(spatial: torch.Tensor, data: Dict[str, Any]) -> None:
    for field, ch in (
        ('pendingLegalMoveSpaces', E._S_LEGAL_MOVE),
        ('pendingLegalAttackTargets', E._S_LEGAL_ATTACK_TARGET),
        ('pendingSpacePickMask', E._S_PEND_SPACE_PICK),
        ('pendingPushDestMask', E._S_PEND_PUSH_DEST),
        ('pendingDoorMask', E._S_PEND_DOOR),
    ):
        coords = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, ch)]
        if coords:
            data[field] = coords
    fluct = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_PEND_FLUCT_SPACE)]
    if fluct:
        data['pendingFluctuationSwapFirst'] = {'coord': fluct[0]}


def _decode_zones(
    spatial: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
) -> None:
    zones: Dict[str, Any] = {}
    for y, x in _lit(spatial, E._S_ZONE_FRIEND):
        zones[_xy_to_coord(y, x)] = own
    for y, x in _lit(spatial, E._S_ZONE_ENEMY):
        zones[_xy_to_coord(y, x)] = opp
    for y, x in _lit(spatial, E._S_ZONE_CONTESTED):
        zones[_xy_to_coord(y, x)] = 'contested'
    if zones:
        data['zoneControl'] = zones


def _decode_combat(spatial: torch.Tensor, data: Dict[str, Any]) -> None:
    attackers = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_ATTACKER_ANCHOR)]
    defenders = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_DEFENDER_ANCHOR)]
    path = [_xy_to_coord(y, x) for (y, x) in _lit(spatial, E._S_ATTACK_PATH)]
    if not (attackers or defenders or path):
        return
    combat: Dict[str, Any] = {}
    if attackers:
        combat['attackerPosition'] = attackers[0]
    if defenders:
        combat['targetPosition'] = defenders[0]
    if path:
        combat['attackPathCells'] = path
    # Non-empty dict satisfies Block-K pendingCombat truthiness too; the
    # named-pending bit will already be set by _decode_block_k. Stash on a
    # non-reserved key so we don't stomp that True from Block K.
    data['pendingCombat'] = combat


# ---------------------------------------------------------------------------
# Spatial decoders — figures
# ---------------------------------------------------------------------------

def _anchor_size_string(
    spatial: torch.Tensor, y: int, x: int,
) -> str:
    """Return a size string whose _size_channel() matches the per-anchor
    size channel. Defaults to '1x1' when no size bit is lit (e.g., the anchor
    comes from a synthetic caller)."""
    if _cell_val(spatial, E._S_SIZE_2X2, y, x) == 1.0:
        return '2x2'
    if _cell_val(spatial, E._S_SIZE_1X2, y, x) == 1.0:
        return '1x2'
    return '1x1'


def _is_attach_at(spatial: torch.Tensor, y: int, x: int) -> bool:
    return _cell_val(spatial, E._S_IS_ATTACHMENT, y, x) == 1.0


def _keywords_at(spatial: torch.Tensor, y: int, x: int) -> frozenset:
    kws = set()
    for kw, idx in E._KEYWORD_CHANNEL_IDX.items():
        if _cell_val(spatial, idx, y, x) == 1.0:
            kws.add(kw)
    return frozenset(kws)


def _aff_channel_at(spatial: torch.Tensor, y: int, x: int) -> int:
    for ch in (E._S_AFF_IMPERIAL, E._S_AFF_REBEL, E._S_AFF_MERC, E._S_AFF_ANY):
        if _cell_val(spatial, ch, y, x) == 1.0:
            return ch
    return E._S_AFF_ANY


def _pick_dc_name(
    kws: frozenset,
    aff_ch: int,
    size_ch: int,
    is_attach: bool,
    roster_hint: Optional[List[str]] = None,
) -> str:
    """Pick a DC name whose library traits re-paint exactly these channels.

    Prefers names already present in `roster_hint` so the Block-J bitset lights
    the same slot in the round-trip. Falls back to the global first-in-sorted
    trait match, then to a synthetic name for empty-effect cases.
    """
    sig = (kws, aff_ch, size_ch, is_attach)
    if roster_hint:
        for name in roster_hint:
            if _trait_signature(name) == sig:
                return name
    rev = _trait_reverse()
    hit = rev.get(sig)
    if hit is not None:
        return hit
    return '__UNKNOWN_DC__'


def _size_from_channel(size_ch: int) -> str:
    if size_ch == E._S_SIZE_2X2:
        return '2x2'
    if size_ch == E._S_SIZE_1X2:
        return '1x2'
    return '1x1'


def _reconstruct_figures(
    spatial: torch.Tensor,
    data: Dict[str, Any],
    own: int,
    opp: int,
    own_roster: Optional[List[str]] = None,
    opp_roster: Optional[List[str]] = None,
) -> None:
    """Scan anchor channel; for each anchor rebuild the owning player and
    per-figure sub-dicts from the Group B/C channels."""
    positions: Dict[int, Dict[str, str]] = {own: {}, opp: {}}
    dc_health: Dict[str, List[Any]] = {}   # keyed by synthetic msgId
    conditions: Dict[int, Dict[str, List[str]]] = {own: {}, opp: {}}
    power_tokens: Dict[int, Dict[str, List[str]]] = {own: {}, opp: {}}
    orientations: Dict[int, Dict[str, str]] = {own: {}, opp: {}}
    strain: Dict[int, Dict[str, int]] = {own: {}, opp: {}}
    contraband: Dict[int, Dict[str, List[str]]] = {own: {}, opp: {}}
    activation_start: Dict[int, Dict[str, str]] = {own: {}, opp: {}}
    damage_taken: Dict[int, Dict[str, float]] = {own: {}, opp: {}}
    active_keys: List[str] = []
    moved_keys: List[str] = []

    counters: Dict[Tuple[int, str], int] = {}

    def _next_key(player: int, dc_name: str) -> str:
        k = (player, dc_name)
        n = counters.get(k, 0)
        counters[k] = n + 1
        return f'{dc_name}-{n}-0'

    for y, x in _lit(spatial, E._S_FIGURE_ANCHOR_TOPLEFT):
        # Whose anchor is this? Use footprint channel at (y, x).
        is_friendly = _cell_val(spatial, E._S_FRIENDLY_FOOTPRINT, y, x) == 1.0
        is_enemy = _cell_val(spatial, E._S_ENEMY_FOOTPRINT, y, x) == 1.0
        if is_friendly:
            player = own
        elif is_enemy:
            player = opp
        else:
            # Anchor with no footprint — skip; encoder never writes this.
            continue

        kws = _keywords_at(spatial, y, x)
        aff_ch = _aff_channel_at(spatial, y, x)
        size_ch = next(
            (ch for ch in (E._S_SIZE_1X1, E._S_SIZE_1X2, E._S_SIZE_2X2)
             if _cell_val(spatial, ch, y, x) == 1.0),
            E._S_SIZE_1X1,
        )
        is_attach = _is_attach_at(spatial, y, x)
        roster_hint = own_roster if player == own else opp_roster
        dc_name = _pick_dc_name(kws, aff_ch, size_ch, is_attach, roster_hint)
        figure_key = _next_key(player, dc_name)

        coord = _xy_to_coord(y, x)
        positions[player][figure_key] = coord

        # HP — stash as [cur, mx] with mx=1.0 so frac=cur re-encodes identically.
        hp_frac = _cell_val(spatial, E._S_HP_FRACTION, y, x)
        hp_full = _cell_val(spatial, E._S_HP_IS_FULL, y, x) == 1.0
        if hp_full:
            cur, mx = 1.0, 1.0
        elif hp_frac > 0.0:
            cur, mx = hp_frac, 1.0
        else:
            cur, mx = 0.0, 1.0
        # dcHealthState is keyed by msgId -> list[figure_idx]. _figure_hp in
        # the encoder scans ALL msgIds and reads hp_list[idx] where idx is
        # the trailing int of figure_key ('...-0-0' -> 0). We use one
        # list per (player, dc_name) so idx conflicts don't trample entries.
        msg_id = f'{player}:{dc_name}'
        lst = dc_health.setdefault(msg_id, [])
        # Pull the trailing index off the figure_key.
        idx = int(figure_key.rsplit('-', 1)[-1])
        while len(lst) <= idx:
            lst.append(None)
        lst[idx] = [cur, mx]

        # Strain — encoder stores min(val/_STRAIN_CAP, 1.0); reverse by
        # picking val = frac * _STRAIN_CAP.
        s_frac = _cell_val(spatial, E._S_STRAIN_FRACTION, y, x)
        if s_frac > 0.0:
            strain[player][figure_key] = s_frac * E._STRAIN_CAP

        # Orientation — pick the lit channel.
        for o_ch, o_str in (
            (E._S_ORIENT_N, 'n'),
            (E._S_ORIENT_E, 'e'),
            (E._S_ORIENT_S, 's'),
            (E._S_ORIENT_W, 'w'),
        ):
            if _cell_val(spatial, o_ch, y, x) == 1.0:
                orientations[player][figure_key] = o_str
                break

        # Conditions — scan lit channels.
        cond_list: List[str] = []
        for c_ch, c_str in (
            (E._S_COND_STUN, 'stun'),
            (E._S_COND_BLEED, 'bleed'),
            (E._S_COND_FOCUS, 'focused'),
            (E._S_COND_HIDE, 'hidden'),
            (E._S_COND_WEAKEN, 'weakened'),
        ):
            if _cell_val(spatial, c_ch, y, x) == 1.0:
                cond_list.append(c_str)
        if cond_list:
            conditions[player][figure_key] = cond_list

        # Power tokens — encoder stored min(count/3.0, 1.0). Reverse: count = round(frac*3).
        pt_list: List[str] = []
        for pt_ch, pt_name in (
            (E._S_PT_SURGE, 'Surge'),
            (E._S_PT_EVADE, 'Evade'),
            (E._S_PT_BLOCK, 'Block'),
            (E._S_PT_DAMAGE, 'Damage'),
        ):
            v = _cell_val(spatial, pt_ch, y, x)
            if v > 0.0:
                n = int(round(v * E._POWER_TOKEN_CAP))
                n = max(1, min(n, int(E._POWER_TOKEN_CAP)))
                pt_list.extend([pt_name] * n)
        if pt_list:
            power_tokens[player][figure_key] = pt_list

        if _cell_val(spatial, E._S_CONTRABAND, y, x) == 1.0:
            contraband[player][figure_key] = ['__contraband__']

        if _cell_val(spatial, E._S_IS_ACTIVE_FIGURE, y, x) == 1.0:
            active_keys.append(figure_key)

        dmg = _cell_val(spatial, E._S_DAMAGE_THIS_ACTIVATION, y, x)
        if dmg > 0.0:
            damage_taken[player][figure_key] = dmg * 10.0

        if _cell_val(spatial, E._S_HAS_MOVED_THIS_ROUND, y, x) == 1.0:
            moved_keys.append(figure_key)

    # Activation anchors are painted at activation-start coords, not current
    # coords. We match each lit cell to a figure on the same player whose
    # current anchor equals that cell — the encoder only paints _S_ACT_ANCHOR
    # when the figure has NOT moved, so we preserve that common case exactly.
    act_cells = set(_lit(spatial, E._S_ACTIVATION_ANCHOR))
    for player, pos_dict in positions.items():
        for fk, coord in pos_dict.items():
            # Reverse coord -> (y, x)
            from python.engine.mechanics.coords import parse_coord
            col, row = parse_coord(coord)
            if (row, col) in act_cells:
                activation_start[player][fk] = coord

    if positions[own] or positions[opp]:
        data['figurePositions'] = {own: positions[own], opp: positions[opp]}
    if dc_health:
        data['dcHealthState'] = dc_health
    if conditions[own] or conditions[opp]:
        data['figureConditions'] = {own: conditions[own], opp: conditions[opp]}
    if power_tokens[own] or power_tokens[opp]:
        data['figurePowerTokens'] = {own: power_tokens[own], opp: power_tokens[opp]}
    if orientations[own] or orientations[opp]:
        data['figureOrientations'] = {own: orientations[own], opp: orientations[opp]}
    if strain[own] or strain[opp]:
        data['figureStrain'] = {own: strain[own], opp: strain[opp]}
    if contraband[own] or contraband[opp]:
        data['figureContraband'] = {own: contraband[own], opp: contraband[opp]}
    if activation_start[own] or activation_start[opp]:
        data['activationStartPositions'] = {
            own: activation_start[own], opp: activation_start[opp]
        }
    if damage_taken[own] or damage_taken[opp]:
        data['figureDamageThisActivation'] = {
            own: damage_taken[own], opp: damage_taken[opp]
        }
    if active_keys:
        data['activeFigureKeys'] = active_keys
    if moved_keys:
        data['figuresMovedThisRound'] = moved_keys


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def decode_state(
    spatial: torch.Tensor,
    scalar: torch.Tensor,
    pov_player: int = 1,
) -> GameState:
    """Turn an encoded (spatial, scalar) pair back into a GameState.

    The output is tensor-equivalent, not byte-identical, to the pre-encode
    state. Values beyond encoder caps (VP>40, round>10, hand>8, etc.) are
    clamped to the cap.
    """
    if spatial.shape != (E.C, E.H, E.W):
        raise ValueError(
            f'decode_state: spatial shape {tuple(spatial.shape)} != {(E.C, E.H, E.W)}'
        )
    if scalar.shape != (E.S,):
        raise ValueError(
            f'decode_state: scalar shape {tuple(scalar.shape)} != {(E.S,)}'
        )
    own, opp = E._pov(pov_player)
    data: Dict[str, Any] = {}

    _decode_block_a(scalar, data)
    _decode_block_b(scalar, data, own, opp)
    _decode_block_c(scalar, data, own, opp)
    _decode_block_d(scalar, data, own, opp)
    own_roster, opp_roster = _decode_blocks_e_f_j(scalar, data, own, opp)
    _decode_blocks_g_h_i(scalar, data, own, opp)
    _decode_block_k(scalar, data)

    _decode_doors(spatial, data)
    _decode_fluctuations(spatial, data)
    _decode_objectives(spatial, data, own, opp)
    _decode_npcs(spatial, data)
    _decode_pending_masks(spatial, data)
    _decode_zones(spatial, data, own, opp)
    _decode_combat(spatial, data)

    _reconstruct_figures(spatial, data, own, opp, own_roster, opp_roster)

    return GameState(data)


__all__ = ['decode_state']
