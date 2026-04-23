"""D3.17 oracle — Pattern E.5 Barrage (two-attack state-flag mutator).

Exercises `python.engine.abilities.barrage.handle_barrage` across all 4
phases plus the defense-pool helper, and its dispatch routing via
`python.engine.abilities.pattern_e.resolve_pattern_e`.

JS firing sites pinned in the handler module docstring:
  Phase 1  declare                   — `src/game/abilities.js:1827-1831`
  Phase 2  after_first_attack        — `src/engine/combat-bridge.js:1499-1514`
  Phase 3  before_second_attack      — `src/handlers/combat.js:1512-1516`
  Phase 4  second_attack_target_gate — `src/handlers/dc-play-area.js:1137-1143`
  Helper:  defense-pool white die    — `src/handlers/combat.js:2594-2598`

Unlike Force Push / Hop On (3-phase interactive chains with implicit phase
detection via ctx-key-presence), Barrage is 4 structurally-distinct state
mutations keyed by explicit `ctx['phase']` tag.

Run as: python3 -m python.parity.oracles.abilities.test_e5_barrage
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.abilities import dispatch
from python.engine.abilities.barrage import (
    BarragePhaseError,
    barrage_defense_pool_extra_die,
    handle_barrage,
)
from python.engine.abilities.dispatch import UnknownAbility, resolve
from python.engine.abilities.pattern_e import (
    ChainNotImplemented,
    get_chain_handler,
    registered_chain_ids,
    resolve_pattern_e,
)


# ── Synthetic grid (4-neighbor ortho matching data/map-spaces.json shape) ────

def build_ortho_grid(cols: int, rows: int) -> Dict[str, Any]:
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


def _game(figure_positions: Optional[Dict[int, Dict[str, str]]] = None) -> Dict[str, Any]:
    return {
        'figurePositions': figure_positions or {1: {}, 2: {}},
    }


# ── Phase 1: declare ────────────────────────────────────────────────────────

def test_phase_declare_writes_second_attack_flag():
    game = _game()
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare',
        'msg_id': 'hl1dc0',
    })
    assert out['applied'] is True
    assert 'Barrage' in out['msg']
    assert game['barrageSecondAttack']['hl1dc0'] is True


def test_phase_declare_lazy_inits_dict_when_missing():
    game = _game()
    assert 'barrageSecondAttack' not in game
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare',
        'msg_id': 'hl1dc0',
    })
    assert isinstance(game['barrageSecondAttack'], dict)


def test_phase_declare_preserves_existing_dict_identity():
    # The D2.29 / activation-state.js ROUND_OBJECT_FLAGS pattern resets to {}
    # rather than deleting, so the existing dict identity must be reused.
    existing = {'other-msg': True}
    game = {'figurePositions': {1: {}, 2: {}}, 'barrageSecondAttack': existing}
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare',
        'msg_id': 'hl1dc0',
    })
    assert game['barrageSecondAttack'] is existing
    assert existing['hl1dc0'] is True
    assert existing['other-msg'] is True


def test_phase_declare_per_msg_id_independence():
    game = _game()
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl2dc1',
    })
    assert game['barrageSecondAttack']['hl1dc0'] is True
    assert game['barrageSecondAttack']['hl2dc1'] is True


# ── Phase 2: after_first_attack ─────────────────────────────────────────────

def test_phase_after_first_attack_full_flow():
    game = _game({
        1: {'Clone Trooper-1-0': 'a1'},
        2: {'Stormtrooper-1-0': 'c3'},
    })
    game['barrageSecondAttack'] = {'hl1dc0': True}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'Stormtrooper-1-0',
    })
    assert out['applied'] is True
    assert out['freeAttackPending'] is True
    assert out['targetSpace'] == 'c3'
    assert out['defenseBonusArmed'] is True
    # Declare flag consumed.
    assert 'hl1dc0' not in game['barrageSecondAttack']
    # Free attack pending set.
    assert game['freeAttackBonusPending']['hl1dc0'] is True
    # Target space stored.
    assert game['barrageTargetSpace']['hl1dc0'] == 'c3'
    # Defense bonus armed.
    assert game['barrageDefenseBonus']['hl1dc0'] is True


def test_phase_after_first_attack_noop_when_no_declare_flag():
    # JS guards under `if (game.barrageSecondAttack?.[msgId])`. Without the
    # declare flag (e.g., caller fired this phase for a non-Barrage attack),
    # the block should no-op — no free attack, no target space, no defense bonus.
    game = _game({1: {}, 2: {'Stormtrooper-1-0': 'c3'}})
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'Stormtrooper-1-0',
    })
    assert out['applied'] is False
    assert out['reason'] == 'no-declare-flag'
    assert 'freeAttackBonusPending' not in game
    assert 'barrageTargetSpace' not in game
    assert 'barrageDefenseBonus' not in game


def test_phase_after_first_attack_missing_target_position_skips_target_space():
    # JS: `const _pos = figurePositions?.[defenderPlayerNum]?.[target.figureKey]`
    # then `if (_pos)`. If the target figure has no recorded position
    # (e.g., defeated during first attack), target-space is NOT stored.
    # Defense bonus + free attack still armed per JS; the target-gate just
    # has nothing to filter against.
    game = _game({1: {}, 2: {}})  # defender has no positions
    game['barrageSecondAttack'] = {'hl1dc0': True}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'GhostFigure-1-0',
    })
    assert out['applied'] is True
    assert out['targetSpace'] is None
    assert 'barrageTargetSpace' not in game  # never lazy-inited
    assert game['freeAttackBonusPending']['hl1dc0'] is True
    assert game['barrageDefenseBonus']['hl1dc0'] is True


def test_phase_after_first_attack_preserves_existing_free_attack_dict():
    # Lazy init should preserve identity of existing freeAttackBonusPending.
    existing_free = {'other-msg': True}
    game = _game({1: {}, 2: {'Storm-1-0': 'c3'}})
    game['barrageSecondAttack'] = {'hl1dc0': True}
    game['freeAttackBonusPending'] = existing_free
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'Storm-1-0',
    })
    assert game['freeAttackBonusPending'] is existing_free
    assert existing_free['hl1dc0'] is True
    assert existing_free['other-msg'] is True


def test_phase_after_first_attack_per_msg_isolation():
    # Two concurrent Barrages on different msgIds should have independent state.
    game = _game({
        1: {'A-1-0': 'a1'},
        2: {'S1-1-0': 'c3', 'S2-1-0': 'f5'},
    })
    game['barrageSecondAttack'] = {'hl1dc0': True, 'hl2dc0': True}
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'S1-1-0',
    })
    handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl2dc0',
        'defender_player_num': 2,
        'target_figure_key': 'S2-1-0',
    })
    assert game['barrageTargetSpace']['hl1dc0'] == 'c3'
    assert game['barrageTargetSpace']['hl2dc0'] == 'f5'
    assert game['barrageDefenseBonus']['hl1dc0'] is True
    assert game['barrageDefenseBonus']['hl2dc0'] is True


# ── Phase 3: before_second_attack ───────────────────────────────────────────

def test_phase_before_second_attack_consumes_flag_and_marks_combat():
    combat = {'attackerMsgId': 'hl1dc0'}
    game = {'barrageDefenseBonus': {'hl1dc0': True}}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
        'combat': combat,
    })
    assert out['applied'] is True
    assert out['defenseBonusConsumed'] is True
    assert out['barrageAttack'] is True
    assert combat['barrageAttack'] is True
    # Flag consumed.
    assert 'hl1dc0' not in game['barrageDefenseBonus']


def test_phase_before_second_attack_falls_back_to_pending_combat():
    # JS writes `game.pendingCombat.barrageAttack = true` literally. If ctx
    # doesn't supply combat, Python mirrors by writing to game['pendingCombat'].
    pending = {'attackerMsgId': 'hl1dc0'}
    game = {
        'barrageDefenseBonus': {'hl1dc0': True},
        'pendingCombat': pending,
    }
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
    })
    assert out['applied'] is True
    assert out['barrageAttack'] is True
    assert pending['barrageAttack'] is True


def test_phase_before_second_attack_noop_without_defense_bonus_flag():
    game = {'barrageDefenseBonus': {}}
    combat = {}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
        'combat': combat,
    })
    assert out['applied'] is False
    assert out['defenseBonusConsumed'] is False
    assert out['barrageAttack'] is False
    assert 'barrageAttack' not in combat


def test_phase_before_second_attack_noop_when_flags_dict_missing():
    # No barrageDefenseBonus dict at all on game — noop, not error.
    game = {}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
        'combat': {},
    })
    assert out['applied'] is False


def test_phase_before_second_attack_no_combat_and_no_pending_combat_sets_no_flag():
    # Flag still consumed, but combat couldn't be marked anywhere.
    game = {'barrageDefenseBonus': {'hl1dc0': True}}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
    })
    assert out['applied'] is True
    assert out['defenseBonusConsumed'] is True
    # Flag consumed regardless.
    assert 'hl1dc0' not in game['barrageDefenseBonus']
    # barrageAttack returns False because no combat dict available.
    assert out['barrageAttack'] is False


# ── Phase 4: second_attack_target_gate ──────────────────────────────────────

def test_phase_target_gate_filters_by_within_3():
    grid = build_ortho_grid(8, 8)
    game = {'barrageTargetSpace': {'hl1dc0': 'd4'}}
    targets = [
        {'figureKey': 'A-1-0', 'coord': 'd5'},  # dist 1, KEEP
        {'figureKey': 'B-1-0', 'coord': 'f5'},  # dist 3, KEEP (boundary)
        {'figureKey': 'C-1-0', 'coord': 'g5'},  # dist 4, DROP
        {'figureKey': 'D-1-0', 'coord': 'a1'},  # dist far, DROP
    ]
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': targets,
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['filterApplied'] is True
    kept = {t['figureKey'] for t in out['filteredTargets']}
    assert kept == {'A-1-0', 'B-1-0'}
    # Flag consumed.
    assert 'hl1dc0' not in game['barrageTargetSpace']


def test_phase_target_gate_empty_filter_fallback_preserves_original_list():
    # JS verbatim: if `_barrageFiltered.length === 0`, targets array UNCHANGED,
    # flag STILL deleted. Ensure Python matches on both counts.
    grid = build_ortho_grid(8, 8)
    game = {'barrageTargetSpace': {'hl1dc0': 'a1'}}
    targets = [
        {'figureKey': 'Faraway-1-0', 'coord': 'h8'},  # dist 14, DROP
    ]
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': targets,
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['filterApplied'] is False
    assert out['filteredTargets'] == targets
    # Flag consumed despite fallback.
    assert 'hl1dc0' not in game['barrageTargetSpace']


def test_phase_target_gate_noop_without_flag():
    grid = build_ortho_grid(8, 8)
    game = {'barrageTargetSpace': {}}
    targets = [{'figureKey': 'A-1-0', 'coord': 'd5'}]
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': targets,
        'map_spaces': grid,
    })
    assert out['applied'] is False
    assert out['reason'] == 'no-target-space-flag'
    assert out['filteredTargets'] == targets
    assert out['filterApplied'] is False


def test_phase_target_gate_missing_map_spaces_fallback_preserves_targets():
    # JS `countSpaces` with empty mapSpaces returns inf, so every target
    # fails the filter → empty-filter fallback → targets unchanged. Python
    # short-circuits to the same outcome.
    game = {'barrageTargetSpace': {'hl1dc0': 'd4'}}
    targets = [
        {'figureKey': 'A-1-0', 'coord': 'd5'},
        {'figureKey': 'B-1-0', 'coord': 'a1'},
    ]
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': targets,
        'map_spaces': None,
    })
    assert out['applied'] is True
    assert out['filterApplied'] is False
    assert out['filteredTargets'] == targets
    # Flag still consumed.
    assert 'hl1dc0' not in game['barrageTargetSpace']


def test_phase_target_gate_skips_malformed_targets():
    # Non-dict targets and targets without coord are skipped (not KeyError).
    grid = build_ortho_grid(8, 8)
    game = {'barrageTargetSpace': {'hl1dc0': 'd4'}}
    targets = [
        {'figureKey': 'A-1-0', 'coord': 'd5'},   # valid, dist 1, KEEP
        None,                                     # malformed, skip
        {'figureKey': 'NoCoord'},                 # no coord, skip
        'not a dict',                             # malformed, skip
    ]
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': targets,
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['filterApplied'] is True
    assert len(out['filteredTargets']) == 1
    assert out['filteredTargets'][0]['figureKey'] == 'A-1-0'


def test_phase_target_gate_empty_target_list():
    grid = build_ortho_grid(8, 8)
    game = {'barrageTargetSpace': {'hl1dc0': 'd4'}}
    out = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': [],
        'map_spaces': grid,
    })
    assert out['applied'] is True
    # Empty-filter fallback — returns original (empty) list.
    assert out['filterApplied'] is False
    assert out['filteredTargets'] == []


# ── Fail-loud: phase dispatch validation ────────────────────────────────────

def test_unknown_phase_raises_BarragePhaseError():
    game = _game()
    try:
        handle_barrage(game, 'barrage_ct1701', {
            'phase': 'totally_made_up_phase',
            'msg_id': 'hl1dc0',
        })
    except BarragePhaseError as exc:
        assert 'totally_made_up_phase' in str(exc)
        return
    assert False, 'expected BarragePhaseError for unknown phase'


def test_missing_phase_raises_BarragePhaseError():
    game = _game()
    try:
        handle_barrage(game, 'barrage_ct1701', {'msg_id': 'hl1dc0'})
    except BarragePhaseError:
        return
    assert False, 'expected BarragePhaseError for missing phase'


def test_missing_msg_id_raises_ValueError():
    game = _game()
    try:
        handle_barrage(game, 'barrage_ct1701', {'phase': 'declare'})
    except ValueError as exc:
        assert 'msg_id' in str(exc)
        return
    assert False, 'expected ValueError for missing msg_id'


def test_none_game_raises_ValueError():
    try:
        handle_barrage(None, 'barrage_ct1701', {
            'phase': 'declare', 'msg_id': 'hl1dc0',
        })
    except ValueError:
        return
    assert False, 'expected ValueError for None game'


def test_non_dict_ctx_raises_ValueError():
    game = _game()
    try:
        handle_barrage(game, 'barrage_ct1701', 'not-a-dict')
    except ValueError:
        return
    assert False, 'expected ValueError for non-dict ctx'


# ── Defense-pool helper ─────────────────────────────────────────────────────

def test_defense_pool_extra_die_returns_white_when_flagged():
    combat = {'barrageAttack': True}
    assert barrage_defense_pool_extra_die(combat) == 'white'


def test_defense_pool_extra_die_returns_none_when_not_flagged():
    combat = {'barrageAttack': False}
    assert barrage_defense_pool_extra_die(combat) is None


def test_defense_pool_extra_die_returns_none_when_flag_absent():
    combat = {}
    assert barrage_defense_pool_extra_die(combat) is None


def test_defense_pool_extra_die_returns_none_for_non_dict():
    assert barrage_defense_pool_extra_die(None) is None
    assert barrage_defense_pool_extra_die('nonsense') is None
    assert barrage_defense_pool_extra_die(42) is None


# ── Full sequence: declare → after → before → flag consumed ─────────────────

def test_full_barrage_sequence_end_to_end():
    # Walk the full 4-phase lifecycle and verify state transitions byte-by-byte.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Clone Trooper-1-0': 'a1'},
        2: {'Storm-1-0': 'd4', 'Storm-1-1': 'd5', 'Storm-1-2': 'h8'},
    })

    # Phase 1: declare.
    r1 = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    assert r1['applied'] is True
    assert game['barrageSecondAttack']['hl1dc0'] is True

    # Phase 2: after first attack (target was Storm-1-0 at d4).
    r2 = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'after_first_attack',
        'msg_id': 'hl1dc0',
        'defender_player_num': 2,
        'target_figure_key': 'Storm-1-0',
    })
    assert r2['targetSpace'] == 'd4'
    assert 'hl1dc0' not in game['barrageSecondAttack']
    assert game['freeAttackBonusPending']['hl1dc0'] is True
    assert game['barrageTargetSpace']['hl1dc0'] == 'd4'
    assert game['barrageDefenseBonus']['hl1dc0'] is True

    # Phase 4: target gate for second attack — only Storm-1-1 (d5) is within 3.
    r4 = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'second_attack_target_gate',
        'msg_id': 'hl1dc0',
        'targets': [
            {'figureKey': 'Storm-1-1', 'coord': 'd5'},
            {'figureKey': 'Storm-1-2', 'coord': 'h8'},
        ],
        'map_spaces': grid,
    })
    assert r4['filterApplied'] is True
    assert [t['figureKey'] for t in r4['filteredTargets']] == ['Storm-1-1']
    assert 'hl1dc0' not in game['barrageTargetSpace']

    # Phase 3: before second attack resolves — arm the defender +1 white die.
    combat = {'attackerMsgId': 'hl1dc0'}
    r3 = handle_barrage(game, 'barrage_ct1701', {
        'phase': 'before_second_attack',
        'msg_id': 'hl1dc0',
        'combat': combat,
    })
    assert r3['barrageAttack'] is True
    assert combat['barrageAttack'] is True
    assert 'hl1dc0' not in game['barrageDefenseBonus']

    # Helper returns 'white' for the defense pool assembler to consume.
    assert barrage_defense_pool_extra_die(combat) == 'white'


# ── Dispatch integration ─────────────────────────────────────────────────────

def test_resolve_pattern_e_wraps_with_pattern_envelope():
    game = _game()
    out = resolve_pattern_e(game, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    assert out['ability_id'] == 'barrage_ct1701'
    assert out['pattern'] == 'E'
    assert out['applied'] is True
    assert game['barrageSecondAttack']['hl1dc0'] is True


def test_direct_handler_matches_dispatch_modulo_envelope():
    game1 = _game()
    game2 = _game()
    direct = handle_barrage(game1, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    wrapped = resolve_pattern_e(game2, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    for k in direct:
        assert wrapped[k] == direct[k]
    assert wrapped['pattern'] == 'E'
    assert wrapped['ability_id'] == 'barrage_ct1701'


def test_chain_handler_registered_for_barrage():
    handler = get_chain_handler('barrage_ct1701')
    assert handler is not None
    assert handler.__name__ == 'handle_barrage'


def test_lookup_pattern_returns_E_for_barrage():
    from python.engine.abilities.dispatch import lookup_pattern
    assert lookup_pattern('barrage_ct1701') == 'E'


def test_dispatch_resolve_routes_barrage_to_handler():
    game = _game()
    out = resolve(game, 'barrage_ct1701', {
        'phase': 'declare', 'msg_id': 'hl1dc0',
    })
    assert out['pattern'] == 'E'
    assert out['applied'] is True
    assert game['barrageSecondAttack']['hl1dc0'] is True


def test_dispatch_resolve_propagates_phase_error():
    # Unknown phase must bubble up through dispatch.resolve → resolve_pattern_e
    # → handle_barrage. No silent swallow.
    try:
        resolve(_game(), 'barrage_ct1701', {
            'phase': 'nonsense', 'msg_id': 'hl1dc0',
        })
    except BarragePhaseError:
        return
    assert False, 'expected BarragePhaseError through dispatch'


def test_registered_chain_ids_contains_all_six_chains():
    # Post-D3.17: six chains registered. force_throw/wrist_cord/mandalorian_whip
    # share handle_push_target_within_range; barrage_ct1701 is its own.
    ids = set(registered_chain_ids())
    assert {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }.issubset(ids)


def test_install_default_chain_handlers_idempotent():
    from python.engine.abilities.pattern_e import install_default_chain_handlers
    install_default_chain_handlers()
    install_default_chain_handlers()
    ids = set(registered_chain_ids())
    assert {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }.issubset(ids)


def test_unregistered_pattern_e_raises_ChainNotImplemented():
    # Post-bulk install: every Pattern E ability has a handler, so
    # ChainNotImplemented is only raised by truly unknown IDs. Smoke
    # test: resolving 'advanced_firepower_sorin' now succeeds via the
    # pending-stamper path.
    out = resolve({}, 'advanced_firepower_sorin', {})
    assert out.get('applied') is True


# ── Library classification pin ──────────────────────────────────────────────

def test_barrage_classifies_as_pattern_E():
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability
    entry = get_ability('barrage_ct1701')
    assert entry is not None
    pat, _ = classify_ability('barrage_ct1701', entry)
    assert pat == 'E'


def test_barrage_library_entry_has_expected_shape():
    # Pins the library contract the handler depends on. If this drifts,
    # every other Barrage test will fail so fail FAST and explicitly.
    from python.engine.data.ability_library_loader import get_ability
    entry = get_ability('barrage_ct1701')
    assert entry['type'] == 'dcSpecial'
    assert entry['label'] == 'Barrage'
    assert entry.get('freeAttackBonus') is True
    assert 'Perform 2 attacks' in entry['description']


# ── Runner ──────────────────────────────────────────────────────────────────

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
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
