"""D7.5 — encode_state: GameState -> (spatial[96, 32, 32], scalar[1481]).

Byte-identical, lossless encoding over the decision-relevant subset of state.
Bijection with decode_state lands in D7.6; 100-state round-trip oracle in D7.7.

Layout contract (frozen by D7.2 / D7.3 / D7.4):
  - spatial : torch.float32 [C=96, H=32, W=32]
  - scalar  : torch.float32 [S=1481]

Coord mapping: x = ord(col) - ord('a')  (0..25);  y = row - 1  (0..27).
Tensor index is tensor[c, y, x] (PyTorch height-first). Every cell with
x >= 26 OR y >= 28 OR absent from map_spaces.spaces is encoded as
wall_static = 1.0 (channel 57); all other channels zero on such cells.

POV rotation:
  - Block A (mission + round) is absolute — no rotation.
  - Spatial Groups A/B/C/D/E/F/G/H/I AND scalar Blocks B-K rotate: own = pov,
    opp = the other player. encode(game, 1) == encode(swap_players(game), 2).
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple

import torch

from python.engine.phases import Phase, RoundPhase
from python.engine.state import GameState
from python.engine.data.cc_effects_loader import get_cc_effects
from python.engine.data.dc_effects_loader import get_dc_effect, get_dc_effects
from python.engine.data.figure_sizes_loader import get_figure_size
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.mechanics.card_names import strip_brackets
from python.engine.mechanics.coords import (
    get_footprint_cells,
    normalize_coord,
    parse_coord,
)


# ---------------------------------------------------------------------------
# Shape constants
# ---------------------------------------------------------------------------

C: int = 96
H: int = 32
W: int = 32
S: int = 1481

_MAX_COL_X: int = 25  # valid x in [0, 25]
_MAX_ROW_Y: int = 27  # valid y in [0, 27]

# Normalization caps
_VP_CAP: float = 40.0
_SQUAD_COST_CAP: float = 40.0
_ROUND_CAP: float = 10.0
_HAND_CAP: float = 8.0
_DECK_CAP: float = 10.0
_POWER_TOKEN_CAP: float = 3.0
_STRAIN_CAP: float = 3.0


# ---------------------------------------------------------------------------
# Spatial channel indices
# ---------------------------------------------------------------------------

# Group A — footprints + anchors (idx 0-2)
_S_FRIENDLY_FOOTPRINT = 0
_S_ENEMY_FOOTPRINT = 1
_S_FIGURE_ANCHOR_TOPLEFT = 2

# Group B — per-figure static DC meta (idx 3-28)
_KEYWORD_CHANNEL_ORDER: Tuple[str, ...] = (
    'TROOPER',       # 3
    'LEADER',        # 4
    'BRAWLER',       # 5
    'HUNTER',        # 6
    'GUARDIAN',      # 7
    'DROID',         # 8
    'SMUGGLER',      # 9
    'SPY',           # 10
    'FORCE USER',    # 11
    'CREATURE',      # 12
    'HEAVY WEAPON',  # 13
    'VEHICLE',       # 14
    'TECHNICIAN',    # 15
    'WOOKIEE',       # 16
    'MOBILE',        # 17
    'MASSIVE',       # 18
    'REACH',         # 19
    'PROFESSIONAL',  # 20
)
_KEYWORD_CHANNEL_IDX: Dict[str, int] = {
    kw: 3 + i for i, kw in enumerate(_KEYWORD_CHANNEL_ORDER)
}
_KEYWORD_CANONICAL: Dict[str, str] = {
    'WOOKIE': 'WOOKIEE',
    'WOOKIEE': 'WOOKIEE',
    'MOBILE': 'MOBILE',
    'VEHICLE': 'VEHICLE',
    'HEAVY WEAPON': 'HEAVY WEAPON',
    'BRAWLER': 'BRAWLER',
}
_KEYWORD_DROP: frozenset = frozenset({
    'IG-88', 'LUKE SKYWALKER', 'DARK DISCIPLE', 'SQUAD UPGRADE',
})

_S_AFF_IMPERIAL = 21
_S_AFF_REBEL = 22
_S_AFF_MERC = 23
_S_AFF_ANY = 24

_S_SIZE_1X1 = 25
_S_SIZE_1X2 = 26
_S_SIZE_2X2 = 27  # 2x2 and larger

_S_IS_ATTACHMENT = 28

# Group C — per-figure dynamic state (idx 29-53)
_S_HP_FRACTION = 29
_S_HP_IS_FULL = 30
_S_STRAIN_FRACTION = 31
_S_ORIENT_N = 32
_S_ORIENT_E = 33
_S_ORIENT_S = 34
_S_ORIENT_W = 35
_S_COND_STUN = 36
_S_COND_BLEED = 37
_S_COND_FOCUS = 38
_S_COND_HIDE = 39
_S_COND_WEAKEN = 40
# 41-44 reserved
_S_PT_SURGE = 45
_S_PT_EVADE = 46
_S_PT_BLOCK = 47
_S_PT_DAMAGE = 48
_S_CONTRABAND = 49
_S_ACTIVATION_ANCHOR = 50
_S_IS_ACTIVE_FIGURE = 51
_S_DAMAGE_THIS_ACTIVATION = 52
_S_HAS_MOVED_THIS_ROUND = 53

# Group D — terrain + doors + fluctuation (idx 54-64)
_S_TERRAIN_DIFFICULT = 54
_S_TERRAIN_HOSTILE = 55
_S_TERRAIN_RUBBLE = 56
_S_WALL_STATIC = 57
_S_WALL_LOS = 58
_S_DOOR_OPEN = 59
_S_DOOR_CLOSED = 60
_S_FLUCT_YELLOW = 61
_S_FLUCT_BLUE = 62
_S_FLUCT_GREEN = 63
_S_FLUCT_RED = 64

# Group E — objectives + board tokens (idx 65-80)
_S_CRATE_PRESENT = 65
_S_CRATE_HP = 66
_S_CRATE_TOKEN_GEN = 67
_S_CRATE_TOKEN_INT = 68
_S_TERMINAL_PRESENT = 69
_S_TERMINAL_FRIEND_CTRL = 70
_S_TERMINAL_ENEMY_CTRL = 71
_S_DEVICE_TOKEN = 72
_S_ANC_A = 73
_S_ANC_B = 74
_S_ANC_C = 75
_S_ANC_D = 76
_S_IMP_CITADEL = 77
_S_ORB_BOMBARDMENT = 78
_S_OVERWATCH_TOKEN = 79
_S_SET_TRAP = 80

# Group F — NPC figures (idx 81-83)
_S_NPC_KRYKNA = 81
_S_NPC_THUG = 82
_S_NPC_KRYKNA_CLAIMED = 83

# Group G — pending-state masks (idx 84-89)
_S_LEGAL_MOVE = 84
_S_LEGAL_ATTACK_TARGET = 85
_S_PEND_SPACE_PICK = 86
_S_PEND_PUSH_DEST = 87
_S_PEND_FLUCT_SPACE = 88
_S_PEND_DOOR = 89

# Group H — zone control (idx 90-92)
_S_ZONE_FRIEND = 90
_S_ZONE_ENEMY = 91
_S_ZONE_CONTESTED = 92

# Group I — combat POV (idx 93-95)
_S_ATTACKER_ANCHOR = 93
_S_DEFENDER_ANCHOR = 94
_S_ATTACK_PATH = 95


# ---------------------------------------------------------------------------
# Scalar block indices
# ---------------------------------------------------------------------------

# Block A — mission + round (idx 0-9)
_MISSION_ORDER: Tuple[str, ...] = (
    'mos-eisley-outskirts',        # 0
    'corellian-underground',       # 1
    'chopper-base-atollon',        # 2
    'lothal-wastes',               # 3
    'development-facility',        # 4
    'devaron-garrison',            # 5
    'anchorhead-cantina-bar',      # 6
    'hoth-battle-station',         # 7
)
_MISSION_IDX: Dict[str, int] = {m: i for i, m in enumerate(_MISSION_ORDER)}
_A_ROUND_NORM = 8
_A_LATE_GAME = 9

# Block B — phase + initiative (idx 10-26)
# Phase 9 -> 6-slot mapping:
#   LOBBY / MAP_SELECTION / INITIATIVE / ZONE_SELECTION -> idx 10 squad_select
#   DEPLOYMENT                                          -> idx 11
#   CC_DRAW                                             -> idx 12
#   ROUND_ACTIVE                                        -> idx 13
#   ENDED                                               -> idx 14
#   ATTACHMENT / unknown                                -> idx 15 other
_B_PHASE_SQUAD_SELECT = 10
_B_PHASE_DEPLOYMENT = 11
_B_PHASE_CC_DRAW = 12
_B_PHASE_ROUND_ACTIVE = 13
_B_PHASE_ENDED = 14
_B_PHASE_OTHER = 15
_B_RP_SOR = 16
_B_RP_ACTIVATION = 17
_B_RP_EOR = 18
# idx 19 reserved
_B_OWN_INIT = 20
_B_OPP_INIT = 21
_B_OWN_ACTIVE = 22
_B_OPP_ACTIVE = 23
# idx 24-25 reserved
_B_SOR_PENDING = 26

# Block C — VP (idx 27-34)
_C_OWN_VP = 27
_C_OPP_VP = 28
_C_VP_MARGIN = 29
_C_OWN_AT_40 = 30
_C_OPP_AT_40 = 31
_C_OWN_AT_30 = 32
_C_OPP_AT_30 = 33
# idx 34 reserved

# Block D — activations (idx 35-54)
_D_OWN_ACTIVATIONS_BASE = 35   # one-hot 0..9
_D_OPP_ACTIVATIONS_BASE = 45   # one-hot 0..9

# Block E — affiliation (idx 55-60)
_E_OWN_REBEL = 55
_E_OWN_IMPERIAL = 56
_E_OWN_MERC = 57
_E_OPP_REBEL = 58
_E_OPP_IMPERIAL = 59
_E_OPP_MERC = 60

# Block F — squad cost (idx 61-64)
_F_OWN_COST = 61
_F_OPP_COST = 62
_F_OWN_UNDER_OPP = 63
# idx 64 reserved

# Block G — own CC hand (idx 65-358)
_G_OWN_HAND_SIZE = 65
_G_OWN_HAND_BITSET_BASE = 66    # 293 slots

# Block H — discards (idx 359-944)
_H_OWN_DISCARD_BASE = 359       # 293 slots
_H_OPP_DISCARD_BASE = 652       # 293 slots

# Block I — opp partial info (idx 945-948)
_I_OWN_DECK = 945
_I_OPP_HAND = 946
_I_OPP_DECK = 947
# idx 948 reserved

# Block J — DC roster bitsets (idx 949-1430)
_J_OWN_ROSTER_BASE = 949        # 241 slots
_J_OPP_ROSTER_BASE = 1190       # 241 slots

# Block K — 49 named pending flags + 1 catch-all (idx 1431-1480)
_K_BASE = 1431
_K_NAMED_PENDING: Tuple[str, ...] = (
    'pendingCombat',              # 1431
    'pendingOverrideAttackDice',  # 1432
    'pendingStrainChoice',        # 1433
    'pendingPowerTokenGrant',     # 1434
    'pendingPowerTokenOverflow',  # 1435
    'pendingReaction',            # 1436
    'pendingEndTurn',             # 1437
    'pendingCcChoice',            # 1438
    'pendingCcConfirmation',      # 1439
    'pendingCcSpaceChoice',       # 1440
    'pendingDcChoice',            # 1441
    'pendingCardPick',            # 1442
    'pendingFigurePick',          # 1443
    'pendingSorActions',          # 1444
    'pendingEorActions',          # 1445
    'pendingMassivePush',         # 1446
    'pendingMassiveDisplacement', # 1447
    'pendingKrykaRespawn',        # 1448
    'pendingFluctuationSwapQueue',# 1449
    'pendingFluctuationSwapFirst',# 1450
    'pendingAbilityChain',        # 1451
    'pendingLieInAmbush',         # 1452
    'pendingForcePush',           # 1453
    'pendingForceThrow',          # 1454
    'pendingWristCord',           # 1455
    'pendingMandalorianWhip',     # 1456
    'pendingHopOn',               # 1457
    'pendingHavocShot',           # 1458
    'pendingBarrage',             # 1459
    'pendingWookieeRage',         # 1460
    'pendingSaberOrbit',          # 1461
    'pendingWildCohesion',        # 1462
    'pendingYhsiw',               # 1463
    'pendingNegation',            # 1464
    'pendingBleeding',            # 1465
    'pendingThereIsNoTry',        # 1466
    'pendingEmperorTrap',         # 1467
    'pendingExecutiveOrder',      # 1468
    'pendingBattlefieldLeadership', # 1469
    'pendingHeroicEffort',        # 1470
    'pendingFiringSquad',         # 1471
    'pendingSentryMultiFire',     # 1472
    'pendingDeploymentChoice',    # 1473
    'pendingLoadoutCard',         # 1474
    'pendingReactionPick',        # 1475
    'pendingOverrunDamage',       # 1476
    'pendingCutAndRunDamage',     # 1477
    'pendingDefeatResolution',    # 1478
    'pendingInitiativeChoice',    # 1479
)
assert len(_K_NAMED_PENDING) == 49
_K_NAMED_IDX: Dict[str, int] = {
    field: _K_BASE + i for i, field in enumerate(_K_NAMED_PENDING)
}
_K_CATCHALL = _K_BASE + 49  # idx 1480


# ---------------------------------------------------------------------------
# Lazily-cached library indices
# ---------------------------------------------------------------------------

_CC_SORTED: Optional[List[str]] = None
_CC_INDEX: Optional[Dict[str, int]] = None
_DC_SORTED: Optional[List[str]] = None
_DC_INDEX: Optional[Dict[str, int]] = None


def _cc_index() -> Dict[str, int]:
    global _CC_SORTED, _CC_INDEX
    if _CC_INDEX is None:
        _CC_SORTED = sorted(get_cc_effects().keys())
        _CC_INDEX = {name: i for i, name in enumerate(_CC_SORTED)}
    return _CC_INDEX


def _dc_index() -> Dict[str, int]:
    global _DC_SORTED, _DC_INDEX
    if _DC_INDEX is None:
        _DC_SORTED = sorted(get_dc_effects().keys())
        _DC_INDEX = {name: i for i, name in enumerate(_DC_SORTED)}
    return _DC_INDEX


# ---------------------------------------------------------------------------
# POV helpers
# ---------------------------------------------------------------------------

def _pov(pov_player: int) -> Tuple[int, int]:
    """Return (own, opp) player numbers for the given POV. Defaults to (1, 2)."""
    if pov_player == 2:
        return 2, 1
    return 1, 2


def _player_key(d: Any, player_num: int) -> Any:
    """Fetch a player-keyed sub-dict tolerant of int, str, and nested keys."""
    if not isinstance(d, dict):
        return None
    if player_num in d:
        return d[player_num]
    str_key = str(player_num)
    if str_key in d:
        return d[str_key]
    return None


# ---------------------------------------------------------------------------
# Coord -> (x, y) helpers
# ---------------------------------------------------------------------------

def _coord_to_xy(coord: Any) -> Optional[Tuple[int, int]]:
    """IA coord -> (x, y). Returns None on unparseable input."""
    if not isinstance(coord, str) or not coord:
        return None
    col, row = parse_coord(coord)
    if col < 0 or row < 0:
        return None
    return col, row


def _xy_in_bounds(x: int, y: int) -> bool:
    return 0 <= x <= _MAX_COL_X and 0 <= y <= _MAX_ROW_Y


def _paint_cells(
    spatial: torch.Tensor,
    channel: int,
    cells: Iterable[str],
    value: float = 1.0,
) -> None:
    """Set spatial[channel, y, x] = value for every IA coord in `cells`
    that lies inside the tensor bounds."""
    for coord in cells:
        xy = _coord_to_xy(coord)
        if xy is None:
            continue
        x, y = xy
        if _xy_in_bounds(x, y):
            spatial[channel, y, x] = value


def _paint_cell(
    spatial: torch.Tensor,
    channel: int,
    coord: Any,
    value: float = 1.0,
) -> None:
    xy = _coord_to_xy(coord)
    if xy is None:
        return
    x, y = xy
    if _xy_in_bounds(x, y):
        spatial[channel, y, x] = value


# ---------------------------------------------------------------------------
# Keyword canonicalization
# ---------------------------------------------------------------------------

def _canonical_keywords(raw: Any) -> List[str]:
    """Return canonical keyword channels for a DC's keyword list.

    Matches JS library loader policy:
      - uppercase
      - rewrite WOOKIE->WOOKIEE etc. via _KEYWORD_CANONICAL
      - drop single-DC tags (IG-88, LUKE SKYWALKER, DARK DISCIPLE, SQUAD UPGRADE)
      - return only tokens that have a dedicated channel in Group B
    """
    if not isinstance(raw, (list, tuple)):
        return []
    out: List[str] = []
    for kw in raw:
        if not isinstance(kw, str):
            continue
        up = kw.upper().strip()
        if up in _KEYWORD_DROP:
            continue
        up = _KEYWORD_CANONICAL.get(up, up)
        if up in _KEYWORD_CHANNEL_IDX and up not in out:
            out.append(up)
    return out


def _size_channel(size: Any) -> int:
    if not isinstance(size, str):
        return _S_SIZE_1X1
    s = size.lower().strip()
    if s == '1x1':
        return _S_SIZE_1X1
    if s in ('1x2', '2x1'):
        return _S_SIZE_1X2
    return _S_SIZE_2X2


# ---------------------------------------------------------------------------
# Spatial-fill helpers
# ---------------------------------------------------------------------------

def _init_padding(spatial: torch.Tensor, map_spaces: Dict[str, Any]) -> None:
    """Write wall_static=1 on every padded cell (outside map or outside tensor)."""
    on_map: set = set()
    if isinstance(map_spaces, dict):
        for c in map_spaces.get('spaces', []) or []:
            if isinstance(c, str):
                on_map.add(c.lower())
    for y in range(H):
        for x in range(W):
            if y > _MAX_ROW_Y or x > _MAX_COL_X:
                spatial[_S_WALL_STATIC, y, x] = 1.0
                continue
            # Inside (0..25, 0..27) but not a valid map cell -> padding wall too.
            col = chr(ord('a') + x)
            coord = f'{col}{y + 1}'
            if coord not in on_map:
                spatial[_S_WALL_STATIC, y, x] = 1.0


def _fill_terrain(spatial: torch.Tensor, map_spaces: Dict[str, Any]) -> None:
    if not isinstance(map_spaces, dict):
        return
    terrain = map_spaces.get('terrain', {}) or {}
    if isinstance(terrain, dict):
        for coord, kind in terrain.items():
            if not isinstance(coord, str):
                continue
            k = (kind or '').lower() if isinstance(kind, str) else ''
            if k == 'difficult':
                _paint_cell(spatial, _S_TERRAIN_DIFFICULT, coord)
            elif k == 'hostile':
                _paint_cell(spatial, _S_TERRAIN_HOSTILE, coord)
            elif k == 'rubble':
                _paint_cell(spatial, _S_TERRAIN_RUBBLE, coord)
            elif k == 'blocking':
                _paint_cell(spatial, _S_WALL_STATIC, coord)
                _paint_cell(spatial, _S_WALL_LOS, coord)
    for coord in map_spaces.get('blocking', []) or []:
        if isinstance(coord, str):
            _paint_cell(spatial, _S_WALL_STATIC, coord)
            _paint_cell(spatial, _S_WALL_LOS, coord)


def _fill_doors(
    spatial: torch.Tensor,
    game: GameState,
    map_spaces: Dict[str, Any],
) -> None:
    doors = game.get('doors', []) or []
    if isinstance(doors, list):
        for d in doors:
            if not isinstance(d, dict):
                continue
            cells = d.get('cells', []) or []
            channel = _S_DOOR_OPEN if d.get('open', False) else _S_DOOR_CLOSED
            _paint_cells(spatial, channel, cells)


def _fill_fluctuations(spatial: torch.Tensor, game: GameState) -> None:
    fluct = game.get('currentFluctuationPositions', {}) or {}
    if not isinstance(fluct, dict):
        return
    color_channel = {
        'yellow': _S_FLUCT_YELLOW,
        'blue': _S_FLUCT_BLUE,
        'green': _S_FLUCT_GREEN,
        'red': _S_FLUCT_RED,
    }
    for color, coords in fluct.items():
        if not isinstance(color, str):
            continue
        ch = color_channel.get(color.lower())
        if ch is None or not isinstance(coords, (list, tuple)):
            continue
        _paint_cells(spatial, ch, coords)


def _fill_figures(
    spatial: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    """Stamp friendly/enemy footprints, anchors, DC static traits, per-figure HP,
    conditions, power tokens, orientation."""
    figure_positions = game.get('figurePositions', {}) or {}
    dc_health = game.get('dcHealthState', {}) or {}
    conditions = game.get('figureConditions', {}) or {}
    power_tokens = game.get('figurePowerTokens', {}) or {}
    orientations = game.get('figureOrientations', {}) or {}
    strain = game.get('figureStrain', {}) or {}
    contraband = game.get('figureContraband', {}) or {}
    activation_start = game.get('activationStartPositions', {}) or {}
    active_figures = game.get('activeFigureKeys', []) or []
    damage_taken = game.get('figureDamageThisActivation', {}) or {}
    moved_this_round = game.get('figuresMovedThisRound', []) or []

    active_set = set(active_figures) if isinstance(active_figures, (list, set, tuple)) else set()
    moved_set = set(moved_this_round) if isinstance(moved_this_round, (list, set, tuple)) else set()

    for player_num, footprint_channel in (
        (own_player, _S_FRIENDLY_FOOTPRINT),
        (opp_player, _S_ENEMY_FOOTPRINT),
    ):
        positions = _player_key(figure_positions, player_num) or {}
        if not isinstance(positions, dict):
            continue
        for figure_key, top_left in positions.items():
            if not isinstance(top_left, str) or not top_left:
                continue
            dc_name = _dc_name_from_figure_key(figure_key)
            size = get_figure_size(dc_name, '1x1')
            cells = get_footprint_cells(top_left, size)
            _paint_cells(spatial, footprint_channel, cells)
            _paint_cell(spatial, _S_FIGURE_ANCHOR_TOPLEFT, top_left)

            # Group B static traits — paint on top-left anchor only.
            effect = get_dc_effect(dc_name) or {}
            for kw in _canonical_keywords(effect.get('keywords')):
                _paint_cell(spatial, _KEYWORD_CHANNEL_IDX[kw], top_left)
            aff = (effect.get('affiliation') or 'Any')
            if isinstance(aff, str):
                aff_l = aff.lower()
                if aff_l == 'imperial':
                    _paint_cell(spatial, _S_AFF_IMPERIAL, top_left)
                elif aff_l == 'rebel':
                    _paint_cell(spatial, _S_AFF_REBEL, top_left)
                elif aff_l in ('mercenary', 'merc', 'scum'):
                    _paint_cell(spatial, _S_AFF_MERC, top_left)
                else:
                    _paint_cell(spatial, _S_AFF_ANY, top_left)
            _paint_cell(spatial, _size_channel(size), top_left)
            if effect.get('isAttachment') or effect.get('attachment'):
                _paint_cell(spatial, _S_IS_ATTACHMENT, top_left)

            # Group C — per-figure dynamic state.
            hp_frac, is_full = _figure_hp(dc_health, game, player_num, figure_key, dc_name)
            if hp_frac is not None:
                _paint_cell(spatial, _S_HP_FRACTION, top_left, hp_frac)
            if is_full:
                _paint_cell(spatial, _S_HP_IS_FULL, top_left)

            fig_strain = _player_key(strain, player_num) or {}
            if isinstance(fig_strain, dict):
                s_val = fig_strain.get(figure_key)
                if isinstance(s_val, (int, float)) and s_val > 0:
                    _paint_cell(
                        spatial, _S_STRAIN_FRACTION, top_left,
                        min(float(s_val) / _STRAIN_CAP, 1.0),
                    )

            orient = (_player_key(orientations, player_num) or {}).get(figure_key)
            if isinstance(orient, str):
                mapping = {
                    'n': _S_ORIENT_N, 'north': _S_ORIENT_N,
                    'e': _S_ORIENT_E, 'east': _S_ORIENT_E,
                    's': _S_ORIENT_S, 'south': _S_ORIENT_S,
                    'w': _S_ORIENT_W, 'west': _S_ORIENT_W,
                }
                ch = mapping.get(orient.lower())
                if ch is not None:
                    _paint_cell(spatial, ch, top_left)

            fig_conds = (_player_key(conditions, player_num) or {}).get(figure_key, [])
            if isinstance(fig_conds, (list, tuple)):
                cond_ch = {
                    'stun': _S_COND_STUN,
                    'bleed': _S_COND_BLEED,
                    'focused': _S_COND_FOCUS,
                    'focus': _S_COND_FOCUS,
                    'hidden': _S_COND_HIDE,
                    'hide': _S_COND_HIDE,
                    'weakened': _S_COND_WEAKEN,
                    'weaken': _S_COND_WEAKEN,
                }
                for c in fig_conds:
                    if isinstance(c, str):
                        ch = cond_ch.get(c.lower())
                        if ch is not None:
                            _paint_cell(spatial, ch, top_left)

            fig_pt = (_player_key(power_tokens, player_num) or {}).get(figure_key, [])
            if isinstance(fig_pt, (list, tuple)):
                counts = {'Surge': 0, 'Evade': 0, 'Block': 0, 'Damage': 0}
                for t in fig_pt:
                    if isinstance(t, str) and t in counts:
                        counts[t] += 1
                for color, ch in (
                    ('Surge', _S_PT_SURGE),
                    ('Evade', _S_PT_EVADE),
                    ('Block', _S_PT_BLOCK),
                    ('Damage', _S_PT_DAMAGE),
                ):
                    if counts[color] > 0:
                        _paint_cell(
                            spatial, ch, top_left,
                            min(counts[color] / _POWER_TOKEN_CAP, 1.0),
                        )

            contra = (_player_key(contraband, player_num) or {}).get(figure_key, [])
            if isinstance(contra, (list, tuple)) and len(contra) > 0:
                _paint_cell(spatial, _S_CONTRABAND, top_left)

            if figure_key in (_player_key(activation_start, player_num) or {}):
                anchor = (_player_key(activation_start, player_num) or {}).get(figure_key)
                _paint_cell(spatial, _S_ACTIVATION_ANCHOR, anchor)

            if figure_key in active_set:
                _paint_cell(spatial, _S_IS_ACTIVE_FIGURE, top_left)

            dmg_map = _player_key(damage_taken, player_num) or {}
            if isinstance(dmg_map, dict):
                d_val = dmg_map.get(figure_key)
                if isinstance(d_val, (int, float)) and d_val > 0:
                    _paint_cell(spatial, _S_DAMAGE_THIS_ACTIVATION, top_left,
                                min(float(d_val) / 10.0, 1.0))

            if figure_key in moved_set:
                _paint_cell(spatial, _S_HAS_MOVED_THIS_ROUND, top_left)


def _figure_hp(
    dc_health: Dict[str, Any],
    game: GameState,
    player_num: int,
    figure_key: str,
    dc_name: str,
) -> Tuple[Optional[float], bool]:
    """Resolve (hp_fraction, is_full) for a figure. Returns (None, False) when
    no HP info is available in dcHealthState."""
    if not isinstance(dc_health, dict):
        return None, False
    # dcHealthState is keyed by msgId in JS; we don't have the D4 msgId map here.
    # Best-effort scan by (playerNum, figureKey suffix).
    try:
        idx = int(figure_key.rsplit('-', 1)[-1])
    except (ValueError, AttributeError):
        idx = 0
    for msg_id, hp_list in dc_health.items():
        if not isinstance(hp_list, list):
            continue
        if 0 <= idx < len(hp_list):
            entry = hp_list[idx]
            if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                cur, mx = entry[0], entry[1]
                if isinstance(cur, (int, float)) and isinstance(mx, (int, float)) and mx > 0:
                    frac = max(0.0, min(float(cur) / float(mx), 1.0))
                    return frac, cur >= mx
    return None, False


def _dc_name_from_figure_key(figure_key: Any) -> str:
    """figure_key format: '<dcName>-<dgIndex>-<figIndex>' (greedy DC name)."""
    if not isinstance(figure_key, str):
        return ''
    # Strip the trailing '-<int>-<int>' suffix.
    parts = figure_key.rsplit('-', 2)
    if len(parts) >= 3 and parts[-1].isdigit() and parts[-2].isdigit():
        return parts[0]
    return figure_key


def _fill_objectives(
    spatial: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    for coord, entry in (game.get('cratePositions', {}) or {}).items():
        if not isinstance(coord, str):
            continue
        _paint_cell(spatial, _S_CRATE_PRESENT, coord)
        if isinstance(entry, dict):
            hp = entry.get('hp')
            max_hp = entry.get('maxHp') or 1
            if isinstance(hp, (int, float)) and isinstance(max_hp, (int, float)) and max_hp > 0:
                _paint_cell(spatial, _S_CRATE_HP, coord, max(0.0, min(hp / max_hp, 1.0)))
    for coord in (game.get('genericCrateTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_CRATE_TOKEN_GEN, coord)
    for coord in (game.get('interactCrateTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_CRATE_TOKEN_INT, coord)

    terminals = game.get('terminals', {}) or {}
    if isinstance(terminals, dict):
        for coord, meta in terminals.items():
            if not isinstance(coord, str):
                continue
            _paint_cell(spatial, _S_TERMINAL_PRESENT, coord)
            if isinstance(meta, dict):
                ctrl = meta.get('controller')
                if ctrl == own_player:
                    _paint_cell(spatial, _S_TERMINAL_FRIEND_CTRL, coord)
                elif ctrl == opp_player:
                    _paint_cell(spatial, _S_TERMINAL_ENEMY_CTRL, coord)

    for coord in (game.get('deviceTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_DEVICE_TOKEN, coord)

    for field, ch in (
        ('ancillaryTokenA', _S_ANC_A),
        ('ancillaryTokenB', _S_ANC_B),
        ('ancillaryTokenC', _S_ANC_C),
        ('ancillaryTokenD', _S_ANC_D),
    ):
        coords = game.get(field, []) or []
        if isinstance(coords, (list, tuple)):
            _paint_cells(spatial, ch, coords)

    for coord in (game.get('imperialCitadelTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_IMP_CITADEL, coord)
    for coord in (game.get('orbitalBombardmentTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_ORB_BOMBARDMENT, coord)
    for coord in (game.get('overwatchTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_OVERWATCH_TOKEN, coord)
    for coord in (game.get('setTrapTokens', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_SET_TRAP, coord)


def _fill_npcs(spatial: torch.Tensor, game: GameState) -> None:
    for coord in (game.get('npcKrykna', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_NPC_KRYKNA, coord)
    for coord in (game.get('npcThugs', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_NPC_THUG, coord)
    for coord in (game.get('claimedKrykna', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_NPC_KRYKNA_CLAIMED, coord)


def _fill_pending_masks(
    spatial: torch.Tensor,
    game: GameState,
    own_player: int,
) -> None:
    for coord in (game.get('pendingLegalMoveSpaces', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_LEGAL_MOVE, coord)
    for coord in (game.get('pendingLegalAttackTargets', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_LEGAL_ATTACK_TARGET, coord)
    for coord in (game.get('pendingSpacePickMask', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_PEND_SPACE_PICK, coord)
    for coord in (game.get('pendingPushDestMask', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_PEND_PUSH_DEST, coord)
    fluct_first = game.get('pendingFluctuationSwapFirst')
    if isinstance(fluct_first, dict):
        coord = fluct_first.get('coord')
        if isinstance(coord, str):
            _paint_cell(spatial, _S_PEND_FLUCT_SPACE, coord)
    for coord in (game.get('pendingDoorMask', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_PEND_DOOR, coord)


def _fill_zone_control(
    spatial: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    zones = game.get('zoneControl', {}) or {}
    if not isinstance(zones, dict):
        return
    for coord, ctrl in zones.items():
        if not isinstance(coord, str):
            continue
        if ctrl == own_player:
            _paint_cell(spatial, _S_ZONE_FRIEND, coord)
        elif ctrl == opp_player:
            _paint_cell(spatial, _S_ZONE_ENEMY, coord)
        elif ctrl in (None, 0, 'contested'):
            _paint_cell(spatial, _S_ZONE_CONTESTED, coord)


def _fill_combat_pov(
    spatial: torch.Tensor,
    game: GameState,
) -> None:
    combat = game.get('pendingCombat')
    if not isinstance(combat, dict):
        return
    attacker = combat.get('attackerPosition')
    defender = combat.get('targetPosition') or combat.get('defenderPosition')
    if isinstance(attacker, str):
        _paint_cell(spatial, _S_ATTACKER_ANCHOR, attacker)
    if isinstance(defender, str):
        _paint_cell(spatial, _S_DEFENDER_ANCHOR, defender)
    for coord in (combat.get('attackPathCells', []) or []):
        if isinstance(coord, str):
            _paint_cell(spatial, _S_ATTACK_PATH, coord)


# ---------------------------------------------------------------------------
# Scalar block fillers
# ---------------------------------------------------------------------------

def _fill_block_a(scalar: torch.Tensor, game: GameState) -> None:
    map_id = ''
    sel = game.get('selectedMap')
    if isinstance(sel, dict):
        map_id = sel.get('id') or sel.get('mapId') or ''
    if not map_id:
        map_id = game.get('mapId') or ''
    if isinstance(map_id, str) and map_id in _MISSION_IDX:
        scalar[_MISSION_IDX[map_id]] = 1.0
    round_num = game.get('round', 0) or 0
    try:
        rn = float(round_num)
    except (TypeError, ValueError):
        rn = 0.0
    scalar[_A_ROUND_NORM] = min(rn / _ROUND_CAP, 1.0)
    scalar[_A_LATE_GAME] = 1.0 if rn >= 4 else 0.0


def _fill_block_b(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    phase = game.get('phase', '')
    phase_val = phase.value if isinstance(phase, Phase) else str(phase or '').lower()
    phase_idx = {
        'lobby': _B_PHASE_SQUAD_SELECT,
        'map_selection': _B_PHASE_SQUAD_SELECT,
        'initiative': _B_PHASE_SQUAD_SELECT,
        'zone_selection': _B_PHASE_SQUAD_SELECT,
        'deployment': _B_PHASE_DEPLOYMENT,
        'cc_draw': _B_PHASE_CC_DRAW,
        'round_active': _B_PHASE_ROUND_ACTIVE,
        'ended': _B_PHASE_ENDED,
        'attachment': _B_PHASE_OTHER,
    }.get(phase_val, _B_PHASE_OTHER)
    scalar[phase_idx] = 1.0

    rp = game.get('roundPhase', '')
    rp_val = rp.value if isinstance(rp, RoundPhase) else str(rp or '').lower()
    rp_idx = {
        'start_of_round': _B_RP_SOR,
        'activation': _B_RP_ACTIVATION,
        'end_of_round': _B_RP_EOR,
    }.get(rp_val)
    if rp_idx is not None:
        scalar[rp_idx] = 1.0

    initiative = game.get('initiativeHolder') or game.get('initiativePlayer')
    if initiative == own_player:
        scalar[_B_OWN_INIT] = 1.0
    elif initiative == opp_player:
        scalar[_B_OPP_INIT] = 1.0

    active = game.get('activePlayer') or game.get('currentPlayer')
    if active == own_player:
        scalar[_B_OWN_ACTIVE] = 1.0
    elif active == opp_player:
        scalar[_B_OPP_ACTIVE] = 1.0

    sor = game.get('pendingSorActions') or game.get('sorEffectsPending')
    if sor:
        scalar[_B_SOR_PENDING] = 1.0


def _fill_block_c(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    vp = game.get('vp') or game.get('victoryPoints') or {}
    own_vp = _player_key(vp, own_player)
    opp_vp = _player_key(vp, opp_player)
    if isinstance(own_vp, dict):
        own_vp = own_vp.get('total', 0)
    if isinstance(opp_vp, dict):
        opp_vp = opp_vp.get('total', 0)
    try:
        own_v = float(own_vp or 0)
    except (TypeError, ValueError):
        own_v = 0.0
    try:
        opp_v = float(opp_vp or 0)
    except (TypeError, ValueError):
        opp_v = 0.0
    scalar[_C_OWN_VP] = min(own_v / _VP_CAP, 1.0)
    scalar[_C_OPP_VP] = min(opp_v / _VP_CAP, 1.0)
    margin = (own_v - opp_v) / _VP_CAP
    scalar[_C_VP_MARGIN] = max(-1.0, min(margin, 1.0))
    scalar[_C_OWN_AT_40] = 1.0 if own_v >= 40 else 0.0
    scalar[_C_OPP_AT_40] = 1.0 if opp_v >= 40 else 0.0
    scalar[_C_OWN_AT_30] = 1.0 if own_v >= 30 else 0.0
    scalar[_C_OPP_AT_30] = 1.0 if opp_v >= 30 else 0.0


def _activations_remaining(game: GameState, player_num: int) -> int:
    act = game.get('activationsRemaining') or game.get('activationCounts') or {}
    v = _player_key(act, player_num)
    try:
        n = int(v or 0)
    except (TypeError, ValueError):
        n = 0
    return max(0, min(n, 9))


def _fill_block_d(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    scalar[_D_OWN_ACTIVATIONS_BASE + _activations_remaining(game, own_player)] = 1.0
    scalar[_D_OPP_ACTIVATIONS_BASE + _activations_remaining(game, opp_player)] = 1.0


def _squad_affiliation(game: GameState, player_num: int) -> str:
    squads = game.get('squads') or game.get('squadData') or {}
    squad = _player_key(squads, player_num)
    if isinstance(squad, dict):
        aff = squad.get('affiliation') or squad.get('affil')
        if isinstance(aff, str):
            return aff
    aff = game.get(f'squadPlayer{player_num}Affiliation')
    if isinstance(aff, str):
        return aff
    return 'Any'


def _fill_block_e(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    def _mark(aff: str, rebel_idx: int, imp_idx: int, merc_idx: int) -> None:
        a = aff.lower() if isinstance(aff, str) else ''
        if a == 'rebel':
            scalar[rebel_idx] = 1.0
        elif a == 'imperial':
            scalar[imp_idx] = 1.0
        elif a in ('mercenary', 'merc', 'scum'):
            scalar[merc_idx] = 1.0
    _mark(_squad_affiliation(game, own_player), _E_OWN_REBEL, _E_OWN_IMPERIAL, _E_OWN_MERC)
    _mark(_squad_affiliation(game, opp_player), _E_OPP_REBEL, _E_OPP_IMPERIAL, _E_OPP_MERC)


def _squad_cost(game: GameState, player_num: int) -> float:
    squads = game.get('squads') or game.get('squadData') or {}
    squad = _player_key(squads, player_num)
    if isinstance(squad, dict):
        for key in ('cost', 'totalCost', 'pointTotal'):
            v = squad.get(key)
            if isinstance(v, (int, float)):
                return float(v)
    v = game.get(f'squadPlayer{player_num}Cost')
    if isinstance(v, (int, float)):
        return float(v)
    return 0.0


def _fill_block_f(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    own_cost = _squad_cost(game, own_player)
    opp_cost = _squad_cost(game, opp_player)
    scalar[_F_OWN_COST] = min(own_cost / _SQUAD_COST_CAP, 1.0)
    scalar[_F_OPP_COST] = min(opp_cost / _SQUAD_COST_CAP, 1.0)
    scalar[_F_OWN_UNDER_OPP] = 1.0 if own_cost < opp_cost else 0.0


def _cc_list(game: GameState, field: str, player_num: int) -> List[str]:
    container = game.get(field, {}) or {}
    raw = _player_key(container, player_num)
    if raw is None:
        raw = game.get(f'{field}P{player_num}')
    if not isinstance(raw, (list, tuple)):
        return []
    return [strip_brackets(x) for x in raw if isinstance(x, str)]


def _deck_size(game: GameState, player_num: int) -> int:
    container = game.get('ccDeck', {}) or {}
    raw = _player_key(container, player_num)
    if raw is None:
        raw = game.get(f'ccDeckP{player_num}')
    if isinstance(raw, (list, tuple)):
        return len(raw)
    if isinstance(raw, int):
        return raw
    return 0


def _fill_blocks_g_h_i(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    cc_idx = _cc_index()
    own_hand = _cc_list(game, 'ccHand', own_player)
    own_discard = _cc_list(game, 'ccDiscard', own_player)
    opp_discard = _cc_list(game, 'ccDiscard', opp_player)
    opp_hand = _cc_list(game, 'ccHand', opp_player)

    scalar[_G_OWN_HAND_SIZE] = min(len(own_hand) / _HAND_CAP, 1.0)
    for name in own_hand:
        idx = cc_idx.get(name)
        if idx is not None:
            scalar[_G_OWN_HAND_BITSET_BASE + idx] = 1.0

    for name in own_discard:
        idx = cc_idx.get(name)
        if idx is not None:
            scalar[_H_OWN_DISCARD_BASE + idx] = 1.0
    for name in opp_discard:
        idx = cc_idx.get(name)
        if idx is not None:
            scalar[_H_OPP_DISCARD_BASE + idx] = 1.0

    scalar[_I_OWN_DECK] = min(_deck_size(game, own_player) / _DECK_CAP, 1.0)
    scalar[_I_OPP_HAND] = min(len(opp_hand) / _HAND_CAP, 1.0)
    scalar[_I_OPP_DECK] = min(_deck_size(game, opp_player) / _DECK_CAP, 1.0)


def _roster_names(game: GameState, player_num: int) -> List[str]:
    """Return the DC names from player_num's deployed roster (bracket-stripped)."""
    squads = game.get('squads') or game.get('squadData') or {}
    squad = _player_key(squads, player_num)
    roster: List[str] = []
    if isinstance(squad, dict):
        dcs = squad.get('deploymentCards') or squad.get('cards') or squad.get('dcs') or []
        if isinstance(dcs, (list, tuple)):
            for d in dcs:
                if isinstance(d, str):
                    roster.append(strip_brackets(d))
                elif isinstance(d, dict):
                    name = d.get('name') or d.get('dcName') or d.get('card')
                    if isinstance(name, str):
                        roster.append(strip_brackets(name))
    # Also walk figurePositions as a fallback for whoever has been deployed.
    figs = _player_key(game.get('figurePositions', {}) or {}, player_num) or {}
    if isinstance(figs, dict):
        for figure_key in figs:
            roster.append(strip_brackets(_dc_name_from_figure_key(figure_key)))
    return roster


def _fill_block_j(
    scalar: torch.Tensor,
    game: GameState,
    own_player: int,
    opp_player: int,
) -> None:
    dc_idx = _dc_index()
    for player_num, base in ((own_player, _J_OWN_ROSTER_BASE),
                             (opp_player, _J_OPP_ROSTER_BASE)):
        for name in _roster_names(game, player_num):
            idx = dc_idx.get(name)
            if idx is not None:
                scalar[base + idx] = 1.0


def _fill_block_k(scalar: torch.Tensor, game: GameState) -> None:
    any_other = False
    for field, idx in _K_NAMED_IDX.items():
        val = game.get(field)
        if _is_pending_truthy(val):
            scalar[idx] = 1.0
    # catch-all: any other game key starting with 'pending' that isn't in the
    # named list.
    for field, val in game.data.items():
        if not isinstance(field, str):
            continue
        if not field.startswith('pending'):
            continue
        if field in _K_NAMED_IDX:
            continue
        if _is_pending_truthy(val):
            any_other = True
            break
    if any_other:
        scalar[_K_CATCHALL] = 1.0


def _is_pending_truthy(val: Any) -> bool:
    if val is None or val is False:
        return False
    if isinstance(val, (list, tuple, dict, set, str)):
        return len(val) > 0
    if isinstance(val, (int, float)):
        return val != 0
    return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def encode_state(
    game: GameState,
    pov_player: int = 1,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """Encode a game state into (spatial[96, 32, 32], scalar[1481]) float32 tensors.

    POV is `pov_player` (1 or 2): Block A is absolute; every other block plus
    every own/enemy spatial channel is relative to the POV. Padded cells
    (x >= 26, y >= 28, or off-map) carry wall_static=1 and zeros elsewhere.
    """
    if not isinstance(game, GameState):
        raise TypeError(f'encode_state requires GameState, got {type(game).__name__}')
    own_player, opp_player = _pov(pov_player)

    spatial = torch.zeros((C, H, W), dtype=torch.float32)
    scalar = torch.zeros((S,), dtype=torch.float32)

    map_id = ''
    sel = game.get('selectedMap')
    if isinstance(sel, dict):
        map_id = sel.get('id') or sel.get('mapId') or ''
    if not map_id:
        map_id = game.get('mapId') or ''
    map_spaces = get_map_spaces(map_id) if isinstance(map_id, str) else {}

    _init_padding(spatial, map_spaces)
    _fill_terrain(spatial, map_spaces)
    _fill_doors(spatial, game, map_spaces)
    _fill_fluctuations(spatial, game)
    _fill_figures(spatial, game, own_player, opp_player)
    _fill_objectives(spatial, game, own_player, opp_player)
    _fill_npcs(spatial, game)
    _fill_pending_masks(spatial, game, own_player)
    _fill_zone_control(spatial, game, own_player, opp_player)
    _fill_combat_pov(spatial, game)

    _fill_block_a(scalar, game)
    _fill_block_b(scalar, game, own_player, opp_player)
    _fill_block_c(scalar, game, own_player, opp_player)
    _fill_block_d(scalar, game, own_player, opp_player)
    _fill_block_e(scalar, game, own_player, opp_player)
    _fill_block_f(scalar, game, own_player, opp_player)
    _fill_blocks_g_h_i(scalar, game, own_player, opp_player)
    _fill_block_j(scalar, game, own_player, opp_player)
    _fill_block_k(scalar, game)

    return spatial, scalar


__all__ = [
    'encode_state',
    'C',
    'H',
    'W',
    'S',
]
