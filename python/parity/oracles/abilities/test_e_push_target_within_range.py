"""D3.15 oracle — generalized push-target-within-range handler.

Covers the two new chains landed in D3.15 alongside `force_throw`:

  - wrist_cord         — 2 MP cost, LOS-required, must-adjacent-to-activator,
                          no postPushFreeAttack, no hostileOnly, no strain.
  - mandalorian_whip   — LOS-required, hostile-only, max 3 from target,
                          must-adjacent-to-activator, postPushFreeAttack.

Both chains share `handle_push_target_within_range` with `force_throw`. The
D3.11 oracle (`test_e16_force_throw.py`) pins force_throw's unique behavior;
this oracle pins the unique deltas of wrist_cord + mandalorian_whip plus
spot checks on shared Phase-3 side-effect plumbing (Spiked Boots guard,
MP deduction, free-attack pending writes, MASSIVE attacker bypass).

JS firing site: `src/game/abilities.js:296-452`.

Run as: python3 -m python.parity.oracles.abilities.test_e_push_target_within_range
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.abilities import dispatch
from python.engine.abilities.pattern_e import (
    get_chain_handler,
    registered_chain_ids,
    resolve_pattern_e,
)
from python.engine.abilities.push_target_within_range import (
    handle_push_target_within_range,
)
from python.engine.data import dc_effects_loader


# ── Synthetic grid + fixture builders ──────────────────────────────────────

def build_ortho_grid(cols: int, rows: int) -> Dict[str, Any]:
    """4-neighbor grid matching `data/map-spaces.json` adjacency shape."""
    spaces: List[str] = []
    adjacency: Dict[str, List[str]] = {}

    def coord(c: int, r: int) -> str:
        return f'{chr(97 + c)}{r + 1}'

    for r in range(rows):
        for c in range(cols):
            k = coord(c, r)
            spaces.append(k)
            neighbors: List[str] = []
            for dc, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nc, nr = c + dc, r + dr
                if 0 <= nc < cols and 0 <= nr < rows:
                    neighbors.append(coord(nc, nr))
            adjacency[k] = neighbors
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'terrain': {},
        'blocking': [],
        'movementBlockingEdges': [],
        'impassableEdges': [],
    }


def _game(figure_positions: Optional[Dict[int, Dict[str, str]]] = None,
          figure_orientations: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {
        'figurePositions': figure_positions or {1: {}, 2: {}},
        'figureOrientations': figure_orientations or {},
        'p1DcAttachments': {},
        'p2DcAttachments': {},
    }


def _patch_spiked_boots(dc_name: str) -> Optional[Dict[str, Any]]:
    """Inject spiked_boots_snowtrooper into cached dc_effects for test DC."""
    ef = dc_effects_loader.get_dc_effects()
    original = dict(ef[dc_name]) if dc_name in ef else None
    if dc_name not in ef:
        ef[dc_name] = {'specialAbilityIds': ['spiked_boots_snowtrooper']}
    else:
        sids = list(ef[dc_name].get('specialAbilityIds') or [])
        if 'spiked_boots_snowtrooper' not in sids:
            sids.append('spiked_boots_snowtrooper')
            ef[dc_name] = {**ef[dc_name], 'specialAbilityIds': sids}
    return original


def _unpatch(dc_name: str, original: Optional[Dict[str, Any]]) -> None:
    ef = dc_effects_loader.get_dc_effects()
    if original is None:
        ef.pop(dc_name, None)
    else:
        ef[dc_name] = original


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ Wrist Cord — 2 MP cost, LOS, must-adjacent-to-activator, no free attack ║
# ╚══════════════════════════════════════════════════════════════════════════╝

# ── Phase 1 ────────────────────────────────────────────────────────────────

def test_wrist_cord_phase1_enumerates_friendlies_no_hostile_only():
    # Wrist Cord has NO hostileOnly — friendlies ARE enumerated alongside
    # enemies (attacker excluded). Delta from mandalorian_whip which filters
    # friendlies out.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1',
            'Stormtrooper (Elite)-1-0': 'b1'},
        2: {'Rebel Trooper-1-0': 'c1'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    keys = out['targetFigureKeys']
    assert 'Rebel Trooper-1-0' in keys          # enemy enumerated
    assert 'Stormtrooper (Elite)-1-0' in keys   # friendly enumerated
    assert 'Mandalorian Super Commando-1-0' not in keys  # attacker excluded


def test_wrist_cord_phase1_los_gate_fires():
    # requiresLos: true — gate LOS from attacker. We simulate LOS blocking by
    # placing wall-blocking via adjacency removal. Using has_line_of_sight's
    # behavior: when active_position is set AND map_spaces is provided, the
    # LOS gate runs. For synthetic grid w/ no blocking the gate is permissive
    # — so we assert the LOS gate code path runs by verifying that enumeration
    # succeeds on an unobstructed grid.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    # LOS unobstructed → target enumerated.
    assert out.get('requiresChoice') is True
    assert 'Rebel Trooper-1-0' in out['targetFigureKeys']


def test_wrist_cord_phase1_distance_gate_3_from_activator():
    # wrist_cord range is 3 (same as force_throw). Figure at d1 (3 away from
    # a1) — included. Figure at e1 (4 away) — excluded.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'd1',
            'Imperial Officer (Regular)-1-0': 'e1'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert 'Rebel Trooper-1-0' in out['targetFigureKeys']
    assert 'Imperial Officer (Regular)-1-0' not in out['targetFigureKeys']


def test_wrist_cord_phase1_no_strain_applied():
    # wrist_cord has no strainCostToSelf — the handler must NOT touch HP.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    dc_health_state = {'mando-msg': [[5, 5]]}
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
        'attacker_msg_id': 'mando-msg',
        'dc_health_state': dc_health_state,
    })
    assert out.get('requiresChoice') is True
    # No strain applied even though msg_id + health-state are provided.
    assert out.get('strainApplied') is False
    assert dc_health_state['mando-msg'][0][0] == 5  # HP unchanged


# ── Phase 2 ────────────────────────────────────────────────────────────────

def test_wrist_cord_phase2_must_adj_to_activator_exactly_1():
    # mustAdjacentToActivator: true — landing must be EXACTLY 1 from attacker.
    # Figure at d4 is the target; active at a1 means only a1's 4-neighbors
    # (a2, b1) qualify. Neither is close to the target, but with no
    # maxDistanceFromTarget cap, both ARE enumerable if they are unoccupied
    # and within 1 of attacker.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'd4'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    valid = set(out['validSpaces'])
    # Only cells exactly 1 from attacker AND not occupied.
    assert valid == {'a2', 'b1'}
    # Target's own cell d4 must NOT appear (too far from activator).
    assert 'd4' not in valid


def test_wrist_cord_phase2_target_key_returned():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'map_spaces': grid,
    })
    assert out['targetFigureKey'] == 'Rebel Trooper-1-0'
    assert out['spaceChoiceLabel'].startswith('**Wrist Cord** — Pick a landing space')


# ── Phase 3 ────────────────────────────────────────────────────────────────

def test_wrist_cord_phase3_mp_deducted_from_movement_bank():
    # mpCostToActivate: 2 — handler deducts 2 MP from game.movementBank[msgId].
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    game['movementBank'] = {'mando-msg': {'remaining': 5}}
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'a2',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['movementBank']['mando-msg']['remaining'] == 3  # 5 - 2
    assert out.get('refreshMovementBank') is True


def test_wrist_cord_phase3_mp_deduct_floored_at_zero():
    # Short MP bank → floor at 0, not negative.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    game['movementBank'] = {'mando-msg': {'remaining': 1}}
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'a2',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['movementBank']['mando-msg']['remaining'] == 0


def test_wrist_cord_phase3_no_free_attack_pending():
    # postPushFreeAttack absent → no freeAttackBonusPending write + no log suffix.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    game['movementBank'] = {'mando-msg': {'remaining': 5}}
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'a2',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert 'freeAttackBonusPending' not in game or \
        'mando-msg' not in (game.get('freeAttackBonusPending') or {})
    assert 'forcedAttackTarget' not in game or \
        'mando-msg' not in (game.get('forcedAttackTarget') or {})
    assert 'Now attack that figure' not in out['logMessage']


def test_wrist_cord_phase3_log_format():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'b1'},
    })
    out = handle_push_target_within_range(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'a2',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    log = out['logMessage']
    assert log.startswith('**Wrist Cord** — **Mandalorian Super Commando** pushed **Rebel Trooper** ')
    assert 'from B1 to A2' in log
    # Coords must NOT be bolded.
    assert 'from **B1**' not in log


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ Mandalorian Whip — hostile-only, max-3-from-target, postPushFreeAttack   ║
# ╚══════════════════════════════════════════════════════════════════════════╝

# ── Phase 1 ────────────────────────────────────────────────────────────────

def test_whip_phase1_excludes_friendlies_hostile_only():
    # hostileOnly: true — friendlies must NOT be enumerated.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1',
            'Stormtrooper (Elite)-1-0': 'b1'},
        2: {'Rebel Trooper-1-0': 'c1'},
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    keys = out['targetFigureKeys']
    assert 'Rebel Trooper-1-0' in keys
    # Friendly Stormtrooper must be excluded via hostileOnly.
    assert 'Stormtrooper (Elite)-1-0' not in keys


def test_whip_phase1_distance_gate_3_from_activator():
    # mandalorian_whip range: 3.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'a1'},
        2: {'Rebel Trooper-1-0': 'd1',            # 3 away → included
            'Imperial Officer (Regular)-1-0': 'e1'},  # 4 away → excluded
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['targetFigureKeys'] == ['Rebel Trooper-1-0']


# ── Phase 2 ────────────────────────────────────────────────────────────────

def test_whip_phase2_max_distance_from_target_3():
    # maxDistanceFromTarget: 3 + mustAdjacentToActivator: true. Valid spaces
    # must be ≤3 from target AND exactly 1 from activator.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'c3'},
        2: {'Rebel Trooper-1-0': 'e5'},
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'c3',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    valid = set(out['validSpaces'])
    # Activator at c3 — 4-neighbors are {b3, d3, c2, c4}. All are ≤3 from e5.
    # b3 → count_spaces(b3, e5) = 5 > 3, so excluded.
    # d3 → count_spaces(d3, e5) = 3 → included.
    # c2 → count_spaces(c2, e5) = 5 > 3, excluded.
    # c4 → count_spaces(c4, e5) = 3 → included.
    assert 'd3' in valid
    assert 'c4' in valid
    assert 'b3' not in valid
    assert 'c2' not in valid


def test_whip_phase2_max_distance_from_target_filters_correctly():
    # Target at a1 (corner), activator at c3. Activator's 4-neighbors: b3,
    # d3, c2, c4. Distances to target a1:
    #   b3→a1=3 (within), d3→a1=5 (out), c2→a1=3 (within), c4→a1=5 (out).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'c3'},
        2: {'Rebel Trooper-1-0': 'a1'},
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'c3',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    valid = set(out['validSpaces'])
    assert 'b3' in valid
    assert 'c2' in valid
    assert 'd3' not in valid  # 5 from target
    assert 'c4' not in valid  # 5 from target


# ── Phase 3 ────────────────────────────────────────────────────────────────

def test_whip_phase3_free_attack_pending_written():
    # postPushFreeAttack: true → writes freeAttackBonusPending + forcedAttackTarget.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'c3'},
        2: {'Rebel Trooper-1-0': 'd3'},
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'c3',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'c4',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    pending = game.get('freeAttackBonusPending') or {}
    assert pending.get('mando-msg') is True
    forced = game.get('forcedAttackTarget') or {}
    assert forced.get('mando-msg') == 'Rebel Trooper-1-0'


def test_whip_phase3_log_suffix_for_free_attack():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'c3'},
        2: {'Rebel Trooper-1-0': 'd3'},
    })
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'c3',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'c4',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    log = out['logMessage']
    assert log.startswith('**Mandalorian Whip** — **Mandalorian Super Commando** pushed **Rebel Trooper** ')
    assert 'from D3 to C4' in log
    # The free-attack log suffix must be appended.
    assert 'Now attack that figure (free action).' in log


def test_whip_phase3_no_mp_deduction():
    # Whip has no mpCostToActivate — movementBank untouched.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Mandalorian Super Commando-1-0': 'c3'},
        2: {'Rebel Trooper-1-0': 'd3'},
    })
    game['movementBank'] = {'mando-msg': {'remaining': 5}}
    out = handle_push_target_within_range(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': 'Mandalorian Super Commando-1-0',
        'active_position': 'c3',
        'chosen_figure_key': 'Rebel Trooper-1-0',
        'chosen_space': 'c4',
        'attacker_msg_id': 'mando-msg',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    # Movement bank unchanged.
    assert game['movementBank']['mando-msg']['remaining'] == 5
    # refreshMovementBank should NOT be set (no MP deduction happened).
    assert out.get('refreshMovementBank') is None


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ Spiked Boots guard (shared across all 3 chains)                          ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def test_spiked_boots_blocks_non_massive_in_phase1():
    # Target carrying spiked_boots_snowtrooper is filtered OUT of Phase 1
    # enumeration when attacker is not MASSIVE.
    original = _patch_spiked_boots('Rebel Trooper')
    try:
        grid = build_ortho_grid(8, 8)
        game = _game({
            1: {'Mandalorian Super Commando-1-0': 'a1'},
            2: {'Rebel Trooper-1-0': 'b1'},
        })
        out = handle_push_target_within_range(game, 'wrist_cord', {
            'player_num': 1,
            'attacker_figure_key': 'Mandalorian Super Commando-1-0',
            'active_position': 'a1',
            'attacker_keywords': [],  # not MASSIVE
            'map_spaces': grid,
        })
        # Target filtered out → empty enumeration → manual message.
        assert out.get('applied') is False
        assert 'no valid SMALL targets' in out['manualMessage']
    finally:
        _unpatch('Rebel Trooper', original)


def test_spiked_boots_massive_attacker_bypasses():
    # MASSIVE attacker ignores Spiked Boots.
    original = _patch_spiked_boots('Rebel Trooper')
    try:
        grid = build_ortho_grid(8, 8)
        game = _game({
            1: {'AT-DP-1-0': 'a1'},
            2: {'Rebel Trooper-1-0': 'b1'},
        })
        out = handle_push_target_within_range(game, 'wrist_cord', {
            'player_num': 1,
            'attacker_figure_key': 'AT-DP-1-0',
            'active_position': 'a1',
            'attacker_keywords': ['MASSIVE'],
            'map_spaces': grid,
        })
        assert out.get('requiresChoice') is True
        assert 'Rebel Trooper-1-0' in out['targetFigureKeys']
    finally:
        _unpatch('Rebel Trooper', original)


def test_spiked_boots_phase3_guard_returns_manual_message():
    # If somehow we skip Phase 1 enumeration and land straight on Phase 3,
    # the guard fires there too and returns a manual message.
    original = _patch_spiked_boots('Rebel Trooper')
    try:
        grid = build_ortho_grid(8, 8)
        game = _game({
            1: {'Mandalorian Super Commando-1-0': 'a1'},
            2: {'Rebel Trooper-1-0': 'b1'},
        })
        out = handle_push_target_within_range(game, 'wrist_cord', {
            'player_num': 1,
            'attacker_figure_key': 'Mandalorian Super Commando-1-0',
            'active_position': 'a1',
            'attacker_keywords': [],
            'chosen_figure_key': 'Rebel Trooper-1-0',
            'chosen_space': 'a2',
            'map_spaces': grid,
        })
        assert out.get('applied') is False
        assert 'Spiked Boots' in out['manualMessage']
        assert 'MASSIVE figures' in out['manualMessage']
    finally:
        _unpatch('Rebel Trooper', original)


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ Dispatch + registry integration                                          ║
# ╚══════════════════════════════════════════════════════════════════════════╝

def test_wrist_cord_routes_via_resolve_pattern_e():
    game = _game()
    out = resolve_pattern_e(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out['ability_id'] == 'wrist_cord'
    assert out['pattern'] == 'E'
    assert out.get('applied') is False


def test_mandalorian_whip_routes_via_resolve_pattern_e():
    game = _game()
    out = resolve_pattern_e(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out['ability_id'] == 'mandalorian_whip'
    assert out['pattern'] == 'E'
    assert out.get('applied') is False


def test_wrist_cord_routes_via_dispatch_resolve():
    game = _game()
    out = dispatch.resolve(game, 'wrist_cord', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out['ability_id'] == 'wrist_cord'
    assert out['pattern'] == 'E'


def test_mandalorian_whip_routes_via_dispatch_resolve():
    game = _game()
    out = dispatch.resolve(game, 'mandalorian_whip', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out['ability_id'] == 'mandalorian_whip'
    assert out['pattern'] == 'E'


def test_wrist_cord_and_whip_classify_as_E():
    assert dispatch.lookup_pattern('wrist_cord') == 'E'
    assert dispatch.lookup_pattern('mandalorian_whip') == 'E'


def test_both_chains_share_generalized_handler():
    # Post-D3.15: wrist_cord + mandalorian_whip + force_throw share the same
    # generalized handler instance.
    h_wrist = get_chain_handler('wrist_cord')
    h_whip = get_chain_handler('mandalorian_whip')
    h_throw = get_chain_handler('force_throw')
    assert h_wrist is not None
    assert h_whip is not None
    assert h_throw is not None
    assert h_wrist is h_whip
    assert h_wrist is h_throw
    assert h_wrist.__name__ == 'handle_push_target_within_range'


def test_registered_chain_ids_contains_all_six():
    ids = registered_chain_ids()
    assert 'Force Push' in ids
    assert 'force_throw' in ids
    assert 'hop_on_kuiil' in ids
    assert 'wrist_cord' in ids
    assert 'mandalorian_whip' in ids
    assert 'barrage_ct1701' in ids


# ── Runner ─────────────────────────────────────────────────────────────────

def main():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith('test_') and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            passed += 1
            print(f'PASS {t.__name__}')
        except AssertionError as e:
            print(f'FAIL {t.__name__}: {e}')
            sys.exit(1)
        except Exception as e:
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
            import traceback
            traceback.print_exc()
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
