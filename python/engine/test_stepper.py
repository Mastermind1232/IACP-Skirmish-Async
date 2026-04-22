"""D10 — tests for the headless action-application stepper.

Run as: python3 python/engine/test_stepper.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import (
    Action,
    implemented_action_types,
    is_implemented,
    step,
)


def test_unknown_action_raises():
    g = create_game()
    # UNDO is not yet registered — use it as the unimplemented sentinel
    try:
        step(g, Action(type=ActionType.UNDO, player=1))
    except NotImplementedError as e:
        assert 'undo' in str(e)
        return
    raise AssertionError('expected NotImplementedError')


def test_step_does_not_mutate_input():
    g = create_game()
    g.data['activePlayer'] = 1
    orig_json = g.to_json()
    step(g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=1))
    assert g.to_json() == orig_json, 'step() mutated input'


def test_pass_activation_turn_swaps_active_player():
    g = create_game()
    g.data['activePlayer'] = 1
    new_g = step(g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=1))
    assert new_g.data['activePlayer'] == 2
    next_g = step(new_g, Action(type=ActionType.PASS_ACTIVATION_TURN, player=2))
    assert next_g.data['activePlayer'] == 1


def test_end_activation_phase_requires_zero_activations():
    g = create_game()
    g.data['activationsRemaining'] = {1: 2, 2: 0}
    try:
        step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    except ValueError as e:
        assert 'activations remaining' in str(e)
        return
    raise AssertionError('expected ValueError when activations remain')


def test_end_activation_phase_transitions_to_end():
    g = create_game()
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['roundPhase'] = 'activation'
    new_g = step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    assert new_g.data['roundPhase'] == 'end'
    assert new_g.data['p1ActivationPhaseEnded'] is False
    assert new_g.data['p2ActivationPhaseEnded'] is False


def test_end_activation_phase_accepts_missing_activations():
    """Missing activationsRemaining should be treated as zero."""
    g = create_game()
    g.data.pop('activationsRemaining', None)
    g.data['roundPhase'] = 'activation'
    new_g = step(g, Action(type=ActionType.END_ACTIVATION_PHASE, player=1))
    assert new_g.data['roundPhase'] == 'end'


def test_is_implemented_reports_correctly():
    assert is_implemented(ActionType.PASS_ACTIVATION_TURN)
    assert is_implemented(ActionType.END_ACTIVATION_PHASE)
    assert is_implemented(ActionType.ACTIVATE_DC)
    assert is_implemented(ActionType.MOVE_PICK_SPACE)
    assert is_implemented(ActionType.DC_END_ACTIVATION)
    assert is_implemented(ActionType.ATTACK_TARGET)
    assert is_implemented(ActionType.CC_DRAW)
    assert is_implemented(ActionType.INTERACT)
    assert is_implemented(ActionType.PLAY_CC)
    assert is_implemented(ActionType.DC_SPECIAL)
    assert is_implemented(ActionType.SPECIAL_ACTION)
    assert not is_implemented(ActionType.UNDO)


def _two_figure_game():
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['mapId'] = 'mos-eisley-outskirts'
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    g.data['activationsRemaining'] = {1: 1, 2: 1}
    g.data['activePlayer'] = 1
    return g


def test_activate_dc_sets_movement_points_from_speed():
    g = _two_figure_game()
    action = Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    )
    new_g = step(g, action)
    # Rebel Trooper (Regular) speed = 4.
    assert new_g.data['movementPoints'] == 4
    assert new_g.data['activeFigureKeys'] == ['Rebel Trooper (Regular)-0-0']
    assert new_g.data['activationsRemaining'][1] == 0
    # Start position recorded.
    starts = new_g.data['activationStartPositions']
    assert starts[1]['Rebel Trooper (Regular)-0-0'] == 'a1'


def test_activate_dc_rejects_no_activations():
    g = _two_figure_game()
    g.data['activationsRemaining'] = {1: 0, 2: 1}
    try:
        step(g, Action(
            type=ActionType.ACTIVATE_DC, player=1,
            params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
        ))
    except ValueError as e:
        assert 'no activations remaining' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_activate_dc_rejects_wrong_owner():
    g = _two_figure_game()
    try:
        step(g, Action(
            type=ActionType.ACTIVATE_DC, player=2,
            params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
        ))
    except ValueError as e:
        assert 'does not own' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_move_pick_space_updates_position_and_charges_mp():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    assert g.data['movementPoints'] == 4
    g = step(g, Action(
        type=ActionType.MOVE_PICK_SPACE, player=1,
        params={'coord': 'a3'},
    ))
    assert g.data['figurePositions'][1]['Rebel Trooper (Regular)-0-0'] == 'a3'
    # 2 orthogonal steps -> 2 MP charged.
    assert g.data['movementPoints'] == 2
    assert 'Rebel Trooper (Regular)-0-0' in g.data['figuresMovedThisRound']


def test_move_pick_space_rejects_insufficient_mp():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    # Manually clamp MP to 1 to force rejection on a 2-step move.
    g.data['movementPoints'] = 1
    try:
        step(g, Action(
            type=ActionType.MOVE_PICK_SPACE, player=1,
            params={'coord': 'a3'},
        ))
    except ValueError as e:
        assert 'insufficient MP' in str(e)
        return
    raise AssertionError('expected ValueError')


def _attack_ready_game():
    g = _two_figure_game()
    # a1/a2 known LOS-clear on mos-eisley-outskirts.
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'a2'},
    }
    g.data['activePlayer'] = 1
    g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
    return g


def test_attack_target_requires_different_owner():
    g = _attack_ready_game()
    g.data['figurePositions'][2]['Rebel Trooper (Regular)-0-1'] = 'h9'
    try:
        step(g, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Rebel Trooper (Regular)-0-1',
                'rng_seed': 1,
            },
        ))
    except ValueError as e:
        # Under test fixture the "friendly" with same DC is on p2 — so this
        # test actually validates the missing-figure path. Rewrite: attack
        # a key that doesn't exist.
        pass
    # Attack own figure via forced construction:
    g2 = _attack_ready_game()
    g2.data['figurePositions'][1]['Rebel Trooper (Regular)-0-1'] = 'h9'
    try:
        step(g2, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Rebel Trooper (Regular)-0-1',
                'rng_seed': 1,
            },
        ))
    except ValueError as e:
        assert 'own figure' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_attack_target_is_deterministic_with_seed():
    g = _attack_ready_game()
    a = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 42,
        },
    ))
    b = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 42,
        },
    ))
    assert a.data.get('dcHealthState') == b.data.get('dcHealthState'), 'seeded attack not deterministic'


def test_attack_target_rejects_second_attack_same_activation():
    g = _attack_ready_game()
    # Pump target HP so the first attack can't possibly kill, keeping the
    # figure on the board for the second-attack check.
    g.data['dcHealthState'] = {'2:Stormtrooper (Regular)': [[50, 50]]}
    g = step(g, Action(
        type=ActionType.ATTACK_TARGET, player=1,
        params={
            'attacker_key': 'Rebel Trooper (Regular)-0-0',
            'target_key': 'Stormtrooper (Regular)-0-0',
            'rng_seed': 1,
        },
    ))
    try:
        step(g, Action(
            type=ActionType.ATTACK_TARGET, player=1,
            params={
                'attacker_key': 'Rebel Trooper (Regular)-0-0',
                'target_key': 'Stormtrooper (Regular)-0-0',
                'rng_seed': 2,
            },
        ))
    except ValueError as e:
        assert 'already attacked' in str(e)
        return
    raise AssertionError('expected ValueError on double attack')


def test_attack_target_kills_and_awards_vp():
    """Walk seeds until one produces a lethal attack, then validate VP + removal."""
    base = _attack_ready_game()
    # Stormtrooper has 3 HP; crank target HP to 1 so any damage kills.
    # dcHealthState = {'2:Stormtrooper (Regular)': [[1, 3]]}
    base.data['dcHealthState'] = {'2:Stormtrooper (Regular)': [[1, 3]]}
    # Try seeds until we land a hit with >=1 damage.
    for seed in range(500):
        g = base.copy()
        try:
            new_g = step(g, Action(
                type=ActionType.ATTACK_TARGET, player=1,
                params={
                    'attacker_key': 'Rebel Trooper (Regular)-0-0',
                    'target_key': 'Stormtrooper (Regular)-0-0',
                    'rng_seed': seed,
                },
            ))
        except Exception:
            continue
        # Check defeat
        fp = new_g.data.get('figurePositions') or {}
        if 'Stormtrooper (Regular)-0-0' not in (fp.get(2) or {}):
            vp = (new_g.data.get('player1VP') or {}).get('kills', 0)
            assert vp >= 1, f'no VP after kill seed={seed}'
            return
    raise AssertionError('no kill in 500 seeds — dice distribution broken')


def test_auto_deploy_places_figures_and_starts_round():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    # 3 figures per group (Regular has figures=3).
    p1 = new_g.data['figurePositions'][1]
    p2 = new_g.data['figurePositions'][2]
    assert len(p1) == 3, p1
    assert len(p2) == 3, p2
    # All cells distinct.
    all_cells = list(p1.values()) + list(p2.values())
    assert len(set(all_cells)) == len(all_cells)
    assert new_g.data['round'] == 1
    assert new_g.data['phase'] == 'round_active'
    assert new_g.data['roundPhase'] == 'activation'
    # One deployment group each -> 1 activation each.
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}


def test_auto_deploy_separates_sides_by_row():
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1_rows = [int(c[1:]) for c in new_g.data['figurePositions'][1].values()]
    p2_rows = [int(c[1:]) for c in new_g.data['figurePositions'][2].values()]
    # p1 on low rows, p2 on high rows.
    assert max(p1_rows) < min(p2_rows), f'p1 rows {p1_rows} vs p2 rows {p2_rows}'


def test_auto_deploy_skips_bracketed_upgrades():
    """[Heroic Effort]-style attachments must not get a board slot."""
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)', '[Heroic Effort]']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1 = new_g.data['figurePositions'][1]
    # Only the Rebel Trooper (3 figures); no bracketed key.
    assert all('Rebel Trooper' in k for k in p1)
    assert len(p1) == 3


def test_auto_deploy_multiple_dcs_distinct_groups():
    """Same DC twice in deploymentCards => group indices 0 and 1."""
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 40,
                  'deploymentCards': ['Rebel Trooper (Regular)', 'Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    new_g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    p1_keys = list(new_g.data['figurePositions'][1].keys())
    # 2 groups * 3 figs = 6 keys.
    assert len(p1_keys) == 6
    groups = {k.rsplit('-', 2)[1] for k in p1_keys}
    assert groups == {'0', '1'}, groups
    # 2 activations for p1.
    assert new_g.data['activationsRemaining'][1] == 2


def test_end_end_of_round_refreshes_activations():
    g = _two_figure_game()
    g.data['round'] = 1
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['figuresMovedThisRound'] = ['Rebel Trooper (Regular)-0-0']
    g.data['figureAttacksThisActivation'] = {1: {'Rebel Trooper (Regular)-0-0': 1}}
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['round'] == 2
    assert new_g.data['roundPhase'] == 'activation'
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}
    assert new_g.data['figuresMovedThisRound'] == []
    assert new_g.data['figureAttacksThisActivation'] == {}


def test_end_end_of_round_detects_game_over():
    g = _two_figure_game()
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {},
    }
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['phase'] == 'game_over'
    assert new_g.data['activationsRemaining'][2] == 0


def test_end_end_of_round_counts_multi_figure_group_as_one():
    g = _two_figure_game()
    g.data['figurePositions'] = {
        1: {
            'Rebel Trooper (Regular)-0-0': 'a1',
            'Rebel Trooper (Regular)-0-1': 'a2',
            'Rebel Trooper (Regular)-0-2': 'a3',
        },
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    new_g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    assert new_g.data['activationsRemaining'] == {1: 1, 2: 1}


def test_phase_gate_ready_marks_player_ready():
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    # Install a gate
    from python.engine.mechanics.phase_gate import create_phase_gate
    create_phase_gate(g, 'deploy_done')

    g2 = step(g, Action(type=ActionType.PHASE_GATE_READY, player=1))
    assert g2.data['phaseGate']['p1Ready'] is True
    assert g2.data['phaseGate']['p2Ready'] is False

    g3 = step(g2, Action(type=ActionType.PHASE_GATE_READY, player=2))
    assert g3.data['phaseGate']['p1Ready'] is True
    assert g3.data['phaseGate']['p2Ready'] is True


def test_phase_gate_unready_flips_back():
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    from python.engine.mechanics.phase_gate import create_phase_gate, record_phase_gate_ready
    create_phase_gate(g, 'deploy_done')
    record_phase_gate_ready(g, 'alice')
    assert g.data['phaseGate']['p1Ready'] is True

    g2 = step(g, Action(type=ActionType.PHASE_GATE_UNREADY, player=1))
    assert g2.data['phaseGate']['p1Ready'] is False


def test_phase_gate_ready_no_gate_is_noop():
    g = create_game()
    g.data['player1Id'] = 'alice'
    # No phaseGate installed — record_ready returns no-op shape; state unchanged
    g2 = step(g, Action(type=ActionType.PHASE_GATE_READY, player=1))
    assert g2.data.get('phaseGate') is None


def test_interact_open_door_dispatch():
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    dc_effects_loader._dc_effects = {'Luke': {'figures': 1, 'speed': 4}}
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'a2': ['a1']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [], 'movementBlockingEdges': [],
    }}
    map_tokens_loader._cache = {'utest': {
        'terminals': [], 'doors': [['a1', 'a2']],
    }}
    try:
        g = create_game()
        g.data['mapId'] = 'utest'
        g.data['selectedMap'] = {'id': 'utest'}
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        new_g = step(g, Action(
            type=ActionType.INTERACT, player=1,
            params={'figure_key': 'Luke-0-0', 'option_id': 'open_door_a1|a2'},
        ))
        assert new_g.data['openedDoors'] == ['a1|a2']
    finally:
        dc_effects_loader.reset_cache()
        map_spaces_loader.reset_cache()
        map_tokens_loader.reset_cache()


def test_interact_rejects_illegal_option():
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    dc_effects_loader._dc_effects = {'Luke': {'figures': 1}}
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [],
    }}
    map_tokens_loader._cache = {'utest': {'terminals': [], 'doors': []}}
    try:
        g = create_game()
        g.data['mapId'] = 'utest'
        g.data['selectedMap'] = {'id': 'utest'}
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        try:
            step(g, Action(
                type=ActionType.INTERACT, player=1,
                params={'figure_key': 'Luke-0-0', 'option_id': 'open_door_z9|z10'},
            ))
        except ValueError as e:
            assert 'not legal' in str(e)
            return
        raise AssertionError('expected ValueError for illegal interact option')
    finally:
        dc_effects_loader.reset_cache()
        map_spaces_loader.reset_cache()
        map_tokens_loader.reset_cache()


def test_pt_overflow_discard_resolves_one_slot():
    g = create_game()
    g.data['figurePowerTokens'] = {'Luke-0-0': ['Block', 'Surge', 'Evade']}
    g.data['pendingPowerTokenOverflow'] = [
        {'figureKey': 'Luke-0-0', 'discardCount': 2},
    ]
    # Discard index 1 ('Surge') → queue entry drops to 1.
    new_g = step(g, Action(
        type=ActionType.PT_OVERFLOW_DISCARD, player=1,
        params={'figure_key': 'Luke-0-0', 'token_index': 1},
    ))
    assert new_g.data['figurePowerTokens']['Luke-0-0'] == ['Block', 'Evade']
    assert new_g.data['pendingPowerTokenOverflow'] == [
        {'figureKey': 'Luke-0-0', 'discardCount': 1},
    ]


def test_pt_overflow_discard_clears_queue_when_drained():
    g = create_game()
    g.data['figurePowerTokens'] = {'Luke-0-0': ['Block']}
    g.data['pendingPowerTokenOverflow'] = [
        {'figureKey': 'Luke-0-0', 'discardCount': 1},
    ]
    new_g = step(g, Action(
        type=ActionType.PT_OVERFLOW_DISCARD, player=1,
        params={'figure_key': 'Luke-0-0', 'token_index': 0},
    ))
    assert new_g.data['figurePowerTokens']['Luke-0-0'] == []
    assert new_g.data['pendingPowerTokenOverflow'] is None


def test_cc_draw_pulls_n_from_deck_to_hand():
    g = create_game()
    g.data['player1CcDeck'] = ['A', 'B', 'C', 'D']
    new_g = step(g, Action(type=ActionType.CC_DRAW, player=1, params={'n': 2}))
    assert new_g.data['player1CcHand'] == ['A', 'B']
    assert new_g.data['player1CcDeck'] == ['C', 'D']
    assert new_g.data['lastCcDraw'] == {'playerNum': 1, 'cards': ['A', 'B']}


def test_cc_draw_default_n_one():
    g = create_game()
    g.data['player1CcDeck'] = ['A', 'B']
    new_g = step(g, Action(type=ActionType.CC_DRAW, player=1))
    assert new_g.data['player1CcHand'] == ['A']
    assert new_g.data['player1CcDeck'] == ['B']


def test_cc_draw_reshuffle_from_discard_when_deck_empty():
    g = create_game()
    g.data['player1CcDeck'] = ['A']
    g.data['player1CcDiscard'] = ['X', 'Y']
    new_g = step(g, Action(
        type=ActionType.CC_DRAW, player=1,
        params={'n': 3, 'reshuffle': True, 'rng_seed': 7},
    ))
    assert sorted(new_g.data['player1CcHand']) == ['A', 'X', 'Y']
    assert new_g.data['player1CcDiscard'] == []
    assert new_g.data['player1CcDeck'] == []


def test_cc_draw_target_hand_size_takes_precedence():
    g = create_game()
    g.data['player1CcHand'] = ['A']
    g.data['player1CcDeck'] = ['B', 'C', 'D']
    new_g = step(g, Action(
        type=ActionType.CC_DRAW, player=1,
        params={'target_hand_size': 3, 'n': 99},
    ))
    assert new_g.data['player1CcHand'] == ['A', 'B', 'C']


def test_cc_draw_invalid_player_raises():
    g = create_game()
    try:
        step(g, Action(type=ActionType.CC_DRAW, player=0))
    except ValueError as e:
        assert 'player' in str(e).lower()
        return
    raise AssertionError('expected ValueError')


def test_play_cc_moves_hand_to_discard_and_records_pending():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Hold On': {'timing': 'duringActivation', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {}
    try:
        g = create_game()
        g.data['player1Id'] = 'alice'
        g.data['player2Id'] = 'bob'
        g.data['currentActivationTurnPlayerId'] = 'alice'
        g.data['player1CcHand'] = ['Hold On', 'Other Card']
        new_g = step(g, Action(
            type=ActionType.PLAY_CC, player=1,
            params={'card': 'Hold On'},
        ))
        assert new_g.data['player1CcHand'] == ['Other Card']
        assert new_g.data['player1CcDiscard'] == ['Hold On']
        assert new_g.data['pendingCcEffect']['cardName'] == 'Hold On'
        assert new_g.data['pendingCcEffect']['playerNum'] == 1
        assert new_g.data['lastPlayedCc'] == {'cardName': 'Hold On', 'playerNum': 1}
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_play_cc_rejects_card_not_in_hand():
    from python.engine.data import cc_effects_loader
    cc_effects_loader._cc_effects = {'Hold On': {'timing': 'duringActivation'}}
    try:
        g = create_game()
        g.data['player1CcHand'] = []
        try:
            step(g, Action(type=ActionType.PLAY_CC, player=1, params={'card': 'Hold On'}))
        except ValueError as e:
            assert 'not in' in str(e)
            return
        raise AssertionError('expected ValueError')
    finally:
        cc_effects_loader.reset_cache()


def test_play_cc_rejects_timing_mismatch():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'SoR Only': {'timing': 'startOfRound', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {}
    try:
        g = create_game()
        g.data['player1Id'] = 'alice'
        g.data['player1CcHand'] = ['SoR Only']
        # No startOfRoundWhoseTurn → not playable now
        try:
            step(g, Action(type=ActionType.PLAY_CC, player=1, params={'card': 'SoR Only'}))
        except ValueError as e:
            assert 'not playable now' in str(e)
            return
        raise AssertionError('expected ValueError')
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_play_cc_force_bypasses_gates():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'SoR Only': {'timing': 'startOfRound', 'playableBy': 'Imperial'},
    }
    dc_effects_loader._dc_effects = {}
    try:
        g = create_game()
        g.data['player1CcHand'] = ['SoR Only']
        # Timing and restriction both fail but force=True bypasses
        new_g = step(g, Action(
            type=ActionType.PLAY_CC, player=1,
            params={'card': 'SoR Only', 'force': True},
        ))
        assert new_g.data['player1CcHand'] == []
        assert new_g.data['player1CcDiscard'] == ['SoR Only']
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_dc_special_rejects_missing_figure():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.DC_SPECIAL, player=1,
            params={'figure_key': 'Nobody-0-0', 'special_idx': 0},
        ))
    except ValueError as e:
        assert 'not on board' in str(e)
        return
    raise AssertionError('expected ValueError for missing figure')


def test_dc_special_rejects_out_of_range_idx():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Luke Skywalker': {'figures': 1, 'specialAbilityIds': ['ability_a']},
    }
    try:
        g = create_game()
        g.data['figurePositions'] = {1: {'Luke Skywalker-0-0': 'a1'}, 2: {}}
        try:
            step(g, Action(
                type=ActionType.DC_SPECIAL, player=1,
                params={'figure_key': 'Luke Skywalker-0-0', 'special_idx': 5},
            ))
        except ValueError as e:
            assert 'out of range' in str(e)
            return
        raise AssertionError('expected ValueError for out-of-range idx')
    finally:
        dc_effects_loader.reset_cache()


def test_dc_special_requires_params():
    g = create_game()
    try:
        step(g, Action(type=ActionType.DC_SPECIAL, player=1, params={}))
    except ValueError as e:
        assert 'figure_key' in str(e)
        return
    raise AssertionError('expected ValueError for missing params')


def test_end_start_of_round_clears_window_and_transitions():
    g = create_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    g.data['roundPhase'] = 'start_of_round'
    new_g = step(g, Action(type=ActionType.END_START_OF_ROUND, player=1))
    assert new_g.data['startOfRoundWhoseTurn'] is None
    assert new_g.data['roundPhase'] == 'activation'


def test_end_start_of_round_runs_mission_sor_rules():
    g = create_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    g.data['roundPhase'] = 'start_of_round'
    g.data['initiativePlayerId'] = 'alice'
    g.data['player1Id'] = 'alice'
    g.data['player1CcHand'] = ['A', 'B', 'C']
    g.data['selectedMission'] = {
        'variant': 'a',
        'rules': {
            'startOfRound': {
                'setTokenCountFromInitiativeHand': {'gameKey': 'cantinaTokens'},
            },
        },
    }
    new_g = step(g, Action(type=ActionType.END_START_OF_ROUND, player=1))
    assert new_g.data['cantinaTokens'] == 3
    assert new_g.data['startOfRoundWhoseTurn'] is None


def test_end_start_of_round_preserves_game_over_phase():
    g = create_game()
    g.data['roundPhase'] = 'game_over'
    g.data['startOfRoundWhoseTurn'] = 'alice'
    new_g = step(g, Action(type=ActionType.END_START_OF_ROUND, player=1))
    # roundPhase should stay 'game_over', not override to 'activation'
    assert new_g.data['roundPhase'] == 'game_over'


def test_celebration_play_awards_4_vp_and_discards():
    g = create_game()
    g.data['player1CcHand'] = ['Celebration', 'Other Card']
    g.data['pendingCelebration'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(type=ActionType.CELEBRATION_PLAY, player=1))
    assert new_g.data['player1CcHand'] == ['Other Card']
    assert new_g.data['player1CcDiscard'] == ['Celebration']
    assert new_g.data['player1VP'] == {'total': 4, 'kills': 0, 'objectives': 4}
    assert new_g.data['pendingCelebration'] is None


def test_celebration_play_requires_window():
    g = create_game()
    try:
        step(g, Action(type=ActionType.CELEBRATION_PLAY, player=1))
    except ValueError as e:
        assert 'pendingCelebration' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_celebration_play_requires_card_in_hand():
    g = create_game()
    g.data['pendingCelebration'] = {'attackerPlayerNum': 1}
    g.data['player1CcHand'] = ['Other']
    try:
        step(g, Action(type=ActionType.CELEBRATION_PLAY, player=1))
    except ValueError as e:
        assert 'not in hand' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_celebration_pass_clears_window_no_vp():
    g = create_game()
    g.data['pendingCelebration'] = {'attackerPlayerNum': 1}
    prior_vp = dict(g.data.get('player1VP') or {})
    new_g = step(g, Action(type=ActionType.CELEBRATION_PASS, player=1))
    assert new_g.data['pendingCelebration'] is None
    assert (new_g.data.get('player1VP') or {}) == prior_vp  # unchanged


def test_cover_fire_block_grants_token_and_clears_pending():
    g = create_game()
    g.data['pendingCoverFire'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(
        type=ActionType.COVER_FIRE_BLOCK, player=1,
        params={'figure_key': 'Luke-0-0'},
    ))
    assert 'Block' in new_g.data['figurePowerTokens']['Luke-0-0']
    assert new_g.data['pendingCoverFire'] is None


def test_cover_fire_block_requires_window():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.COVER_FIRE_BLOCK, player=1,
            params={'figure_key': 'Luke-0-0'},
        ))
    except ValueError as e:
        assert 'pendingCoverFire' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cover_fire_skip_clears_pending():
    g = create_game()
    g.data['pendingCoverFire'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(type=ActionType.COVER_FIRE_SKIP, player=1))
    assert new_g.data['pendingCoverFire'] is None


def test_bo_rifle_use_sets_melee_override():
    g = create_game()
    g.data['pendingBoRifle'] = {'hl1dc0': {'meleeDice': ['red', 'green']}}
    new_g = step(g, Action(
        type=ActionType.BO_RIFLE_USE, player=1,
        params={'msg_id': 'hl1dc0'},
    ))
    assert new_g.data['pendingOverrideAttackDice']['hl1dc0'] == {
        'dice': ['red', 'green'], 'type': 'melee',
    }
    assert new_g.data['pendingBoRifle'] is None


def test_bo_rifle_skip_clears_pending():
    g = create_game()
    g.data['pendingBoRifle'] = {'hl1dc0': {'meleeDice': ['red']}}
    new_g = step(g, Action(
        type=ActionType.BO_RIFLE_SKIP, player=1,
        params={'msg_id': 'hl1dc0'},
    ))
    assert new_g.data['pendingBoRifle'] is None
    # No override set
    assert new_g.data.get('pendingOverrideAttackDice') is None


def test_bo_rifle_use_requires_pending():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.BO_RIFLE_USE, player=1,
            params={'msg_id': 'hl1dc0'},
        ))
    except ValueError as e:
        assert 'pendingBoRifle' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_ee3_pick_die_deducts_mp_and_swaps_color_to_red():
    g = create_game()
    g.data['movementBank'] = {'hl1dc0': {'total': 4, 'remaining': 4}}
    new_g = step(g, Action(
        type=ActionType.EE3_PICK_DIE, player=1,
        params={
            'msg_id': 'hl1dc0', 'color': 'blue',
            'base_dice': ['blue', 'green', 'yellow'],
        },
    ))
    assert new_g.data['movementBank']['hl1dc0']['remaining'] == 2
    assert new_g.data['pendingOverrideAttackDice']['hl1dc0']['dice'] == [
        'red', 'green', 'yellow',
    ]
    assert new_g.data['pendingEe3Carbine']['hl1dc0'] == 'decided'


def test_ee3_pick_die_rejects_invalid_color():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.EE3_PICK_DIE, player=1,
            params={'msg_id': 'hl1dc0', 'color': 'red',
                    'base_dice': ['blue']},
        ))
    except ValueError as e:
        assert 'color' in str(e).lower()
        return
    raise AssertionError('expected ValueError')


def test_ee3_pick_skip_just_stamps_decided():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.EE3_PICK_SKIP, player=1,
        params={'msg_id': 'hl1dc0'},
    ))
    assert new_g.data['pendingEe3Carbine']['hl1dc0'] == 'decided'
    assert new_g.data.get('pendingOverrideAttackDice') is None
    assert new_g.data.get('movementBank') is None


def test_spread_pain_cond_appends_to_combat_conditions():
    g = create_game()
    g.data['pendingSpreadThePainCondPick'] = {'attackerPlayerNum': 1}
    g.data['pendingCombat'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(
        type=ActionType.SPREAD_PAIN_COND, player=1,
        params={'cond': 'stun'},
    ))
    assert new_g.data['pendingCombat']['spreadThePainConditions'] == ['Stun']
    assert new_g.data['pendingSpreadThePainCondPick'] is None


def test_spread_pain_cond_skip_no_append_clears_pending():
    g = create_game()
    g.data['pendingSpreadThePainCondPick'] = {'attackerPlayerNum': 1}
    g.data['pendingCombat'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(
        type=ActionType.SPREAD_PAIN_COND, player=1,
        params={'cond': 'skip'},
    ))
    assert new_g.data['pendingSpreadThePainCondPick'] is None
    assert new_g.data['pendingCombat'].get('spreadThePainConditions') in (None, [])


def test_spread_pain_cond_rejects_bad_value():
    g = create_game()
    g.data['pendingSpreadThePainCondPick'] = {'attackerPlayerNum': 1}
    try:
        step(g, Action(
            type=ActionType.SPREAD_PAIN_COND, player=1,
            params={'cond': 'nonsense'},
        ))
    except ValueError as e:
        assert 'stun' in str(e).lower()
        return
    raise AssertionError('expected ValueError')


def test_overwatch_space_places_token_and_clears_pending():
    g = create_game()
    g.data['pendingOverwatchPlacement'] = {'hl1dc0': {'playerNum': 1}}
    new_g = step(g, Action(
        type=ActionType.OVERWATCH_SPACE, player=1,
        params={'msg_id': 'hl1dc0', 'space': 'A5'},
    ))
    assert new_g.data['overwatchTokenPosition']['hl1dc0'] == 'a5'
    assert new_g.data['pendingOverwatchPlacement'] is None


def test_overwatch_space_requires_params():
    g = create_game()
    try:
        step(g, Action(type=ActionType.OVERWATCH_SPACE, player=1, params={}))
    except ValueError as e:
        assert 'msg_id' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cc_cancel_play_clears_pending_confirmation():
    g = create_game()
    g.data['pendingCcConfirmation'] = {'playerNum': 1, 'card': 'Hold On'}
    new_g = step(g, Action(type=ActionType.CC_CANCEL_PLAY, player=1))
    assert new_g.data['pendingCcConfirmation'] is None


def test_comm_disruption_skip_clears_prompt():
    g = create_game()
    g.data['pendingCommDisruptionPrompt'] = {'targetPlayerNum': 2, 'playedCard': 'X'}
    new_g = step(g, Action(type=ActionType.COMM_DISRUPTION_SKIP, player=2))
    assert new_g.data['pendingCommDisruptionPrompt'] is None


def test_rush_push_skip_clears_pending():
    g = create_game()
    g.data['pendingRushPush'] = {'playerNum': 1}
    new_g = step(g, Action(type=ActionType.RUSH_PUSH_SKIP, player=1))
    assert new_g.data['pendingRushPush'] is None


def test_shoulder_rush_skip_clears_pending():
    g = create_game()
    g.data['pendingShoulderRush'] = {'playerNum': 1}
    new_g = step(g, Action(type=ActionType.SHOULDER_RUSH_SKIP, player=1))
    assert new_g.data['pendingShoulderRush'] is None


def test_false_orders_skip_clears_pending():
    g = create_game()
    g.data['pendingFalseOrders'] = {'playerNum': 1}
    new_g = step(g, Action(type=ActionType.FALSE_ORDERS_SKIP, player=1))
    assert new_g.data['pendingFalseOrders'] is None


def test_missile_salvo_done_clears_pending():
    g = create_game()
    g.data['pendingMissileSalvo'] = {'hl1dc0': {'diceAvailable': ['red']}}
    new_g = step(g, Action(type=ActionType.MISSILE_SALVO_DONE, player=1))
    assert new_g.data['pendingMissileSalvo'] is None


def test_missile_salvo_done_with_msg_id_clears_just_that_slot():
    g = create_game()
    g.data['pendingMissileSalvo'] = {
        'hl1dc0': {'diceAvailable': ['red']},
        'hl2dc0': {'diceAvailable': ['blue']},
    }
    new_g = step(g, Action(
        type=ActionType.MISSILE_SALVO_DONE, player=1,
        params={'msg_id': 'hl1dc0'},
    ))
    assert new_g.data['pendingMissileSalvo'] == {'hl2dc0': {'diceAvailable': ['blue']}}


def test_missile_salvo_die_consumes_color_and_sets_override():
    g = create_game()
    g.data['pendingMissileSalvo'] = {
        'hl1dc0': {'playerNum': 1, 'diceAvailable': ['red', 'green', 'blue']},
    }
    new_g = step(g, Action(
        type=ActionType.MISSILE_SALVO_DIE, player=1,
        params={'msg_id': 'hl1dc0', 'color': 'Red'},
    ))
    assert new_g.data['pendingMissileSalvo']['hl1dc0']['diceAvailable'] == ['green', 'blue']
    assert new_g.data['pendingOverrideAttackDice']['hl1dc0'] == {
        'dice': ['red'], 'type': 'ranged', 'bonusAccuracy': 3,
    }
    assert new_g.data['freeAttackBonusPending']['hl1dc0'] is True


def test_missile_salvo_die_rejects_unavailable_color():
    g = create_game()
    g.data['pendingMissileSalvo'] = {
        'hl1dc0': {'diceAvailable': ['red']},
    }
    try:
        step(g, Action(
            type=ActionType.MISSILE_SALVO_DIE, player=1,
            params={'msg_id': 'hl1dc0', 'color': 'blue'},
        ))
    except ValueError as e:
        assert 'diceAvailable' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_missile_salvo_die_requires_pending():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.MISSILE_SALVO_DIE, player=1,
            params={'msg_id': 'hl1dc0', 'color': 'red'},
        ))
    except ValueError as e:
        assert 'pendingMissileSalvo' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_skip_handlers_require_pending_window():
    cases = [
        (ActionType.CC_CANCEL_PLAY, 'pendingCcConfirmation'),
        (ActionType.COMM_DISRUPTION_SKIP, 'pendingCommDisruptionPrompt'),
        (ActionType.RUSH_PUSH_SKIP, 'pendingRushPush'),
        (ActionType.SHOULDER_RUSH_SKIP, 'pendingShoulderRush'),
        (ActionType.FALSE_ORDERS_SKIP, 'pendingFalseOrders'),
        (ActionType.MISSILE_SALVO_DONE, 'pendingMissileSalvo'),
    ]
    for action_type, expected_msg in cases:
        g = create_game()
        try:
            step(g, Action(type=action_type, player=1))
        except ValueError as e:
            assert expected_msg in str(e), f'{action_type}: {e}'
            continue
        raise AssertionError(f'{action_type}: expected ValueError')


def test_power_token_choice_applies_type_to_all_grants():
    g = create_game()
    g.data['pendingPowerTokenGrant'] = {
        'grants': [
            {'figureKey': 'Luke-0-0', 'figName': 'Luke', 'count': 2},
            {'figureKey': 'Han-0-0', 'figName': 'Han', 'count': 1},
        ],
        'playerNum': 1,
    }
    new_g = step(g, Action(
        type=ActionType.POWER_TOKEN_CHOICE, player=1,
        params={'type': 'Surge'},
    ))
    assert new_g.data['figurePowerTokens']['Luke-0-0'] == ['Surge', 'Surge']
    assert new_g.data['figurePowerTokens']['Han-0-0'] == ['Surge']
    assert new_g.data['pendingPowerTokenGrant'] is None


def test_power_token_choice_accepts_hit_as_damage_alias():
    g = create_game()
    g.data['pendingPowerTokenGrant'] = {
        'grants': [{'figureKey': 'Luke-0-0', 'figName': 'Luke', 'count': 1}],
    }
    new_g = step(g, Action(
        type=ActionType.POWER_TOKEN_CHOICE, player=1,
        params={'type': 'hit'},
    ))
    assert new_g.data['figurePowerTokens']['Luke-0-0'] == ['Damage']


def test_power_token_choice_rejects_invalid_type():
    g = create_game()
    g.data['pendingPowerTokenGrant'] = {'grants': [], 'playerNum': 1}
    try:
        step(g, Action(type=ActionType.POWER_TOKEN_CHOICE, player=1,
                        params={'type': 'nonsense'}))
    except ValueError as e:
        assert 'Damage' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_power_token_choice_requires_pending():
    g = create_game()
    try:
        step(g, Action(type=ActionType.POWER_TOKEN_CHOICE, player=1,
                        params={'type': 'Surge'}))
    except ValueError as e:
        assert 'pendingPowerTokenGrant' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_comm_disruption_play_cancels_pending_cc():
    g = create_game()
    g.data['pendingCommDisruptionPrompt'] = {
        'targetPlayerNum': 2,
        'playedCard': 'Reinforcements',
        'playedBy': 1,
    }
    g.data['pendingCcEffect'] = {
        'cardName': 'Reinforcements', 'playerNum': 1,
        'timing': 'startOfRound',
    }
    g.data['player2CcHand'] = ['Comm Disruption', 'Other']
    new_g = step(g, Action(type=ActionType.COMM_DISRUPTION_PLAY, player=2))
    assert new_g.data['player2CcHand'] == ['Other']
    assert new_g.data['player2CcDiscard'] == ['Comm Disruption']
    assert new_g.data['pendingCcEffect'] is None
    assert new_g.data['pendingCommDisruptionPrompt'] is None
    assert new_g.data['lastCancelledCc'] == {
        'cardName': 'Reinforcements', 'byPlayerNum': 2,
    }


def test_comm_disruption_play_requires_card_in_hand():
    g = create_game()
    g.data['pendingCommDisruptionPrompt'] = {'targetPlayerNum': 2, 'playedCard': 'X'}
    g.data['player2CcHand'] = ['Other']
    try:
        step(g, Action(type=ActionType.COMM_DISRUPTION_PLAY, player=2))
    except ValueError as e:
        assert 'Comm Disruption' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_comm_disruption_play_requires_prompt():
    g = create_game()
    try:
        step(g, Action(type=ActionType.COMM_DISRUPTION_PLAY, player=2))
    except ValueError as e:
        assert 'pendingCommDisruptionPrompt' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_dc_ability_choice_clears_pending_and_records_result():
    g = create_game()
    g.data['pendingDcAbilityChoice'] = {
        'hl1dc0_0': {
            'gameId': g.data.get('gameId'),
            'playerNum': 1,
            'abilityId': 'totally_unknown_ability',
            'figureIndex': 0,
            'specialIdx': 0,
            'choiceOptions': ['Option A', 'Option B'],
        },
    }
    new_g = step(g, Action(
        type=ActionType.DC_ABILITY_CHOICE, player=1,
        params={'msg_id': 'hl1dc0', 'special_idx': 0, 'choice_index': 1},
    ))
    # Unknown ability is tolerated — result records reason
    assert new_g.data['pendingDcAbilityChoice'] is None
    assert new_g.data['lastDcAbilityChoiceResult']['abilityId'] == 'totally_unknown_ability'
    assert new_g.data['lastDcAbilityChoiceResult']['choiceIndex'] == 1
    assert new_g.data['lastDcAbilityChoiceResult']['result']['reason'] == 'unknown_ability'


def test_dc_ability_choice_requires_pending():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.DC_ABILITY_CHOICE, player=1,
            params={'msg_id': 'hl1dc0', 'special_idx': 0, 'choice_index': 0},
        ))
    except ValueError as e:
        assert 'no pending choice' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_dc_ability_choice_rejects_out_of_range():
    g = create_game()
    g.data['pendingDcAbilityChoice'] = {
        'hl1dc0_0': {
            'playerNum': 1, 'abilityId': 'x',
            'choiceOptions': ['A'],
        },
    }
    try:
        step(g, Action(
            type=ActionType.DC_ABILITY_CHOICE, player=1,
            params={'msg_id': 'hl1dc0', 'special_idx': 0, 'choice_index': 5},
        ))
    except ValueError as e:
        assert 'out of range' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cc_confirm_play_delegates_to_play_cc():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Hold On': {'timing': 'duringActivation', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {}
    try:
        g = create_game()
        g.data['player1Id'] = 'alice'
        g.data['currentActivationTurnPlayerId'] = 'alice'
        g.data['player1CcHand'] = ['Hold On']
        g.data['pendingCcConfirmation'] = {'playerNum': 1, 'card': 'Hold On'}
        new_g = step(g, Action(type=ActionType.CC_CONFIRM_PLAY, player=1))
        assert new_g.data['pendingCcConfirmation'] is None
        assert new_g.data['player1CcHand'] == []
        assert new_g.data['player1CcDiscard'] == ['Hold On']
        assert new_g.data['pendingCcEffect']['cardName'] == 'Hold On'
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_cc_confirm_play_signal_jammer_cancels_both():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Hold On': {'timing': 'duringActivation', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {}
    try:
        g = create_game()
        g.data['player1CcHand'] = ['Hold On']
        g.data['player2CcHand'] = ['Signal Jammer']
        g.data['pendingCcConfirmation'] = {'playerNum': 1, 'card': 'Hold On'}
        g.data['signalJammerActive'] = {'playerNum': 2}
        new_g = step(g, Action(type=ActionType.CC_CONFIRM_PLAY, player=1))
        # Both cards discarded
        assert new_g.data['player1CcHand'] == []
        assert new_g.data['player1CcDiscard'] == ['Hold On']
        assert new_g.data['player2CcHand'] == []
        assert new_g.data['player2CcDiscard'] == ['Signal Jammer']
        assert new_g.data['signalJammerActive'] is None
        assert new_g.data['lastCancelledCc']['method'] == 'signal_jammer'
        # pendingCcEffect NOT set (card was cancelled, not played)
        assert new_g.data.get('pendingCcEffect') is None
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_cc_confirm_play_requires_pending():
    g = create_game()
    try:
        step(g, Action(type=ActionType.CC_CONFIRM_PLAY, player=1))
    except ValueError as e:
        assert 'pendingCcConfirmation' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_play_cc_special_moves_to_discard_with_pending_effect():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Master Operative': {'timing': 'specialAction', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {'Luke Skywalker': {'keywords': [], 'affiliation': 'Rebel'}}
    try:
        g = create_game()
        g.data['player1CcHand'] = ['Master Operative']
        new_g = step(g, Action(
            type=ActionType.PLAY_CC_SPECIAL, player=1,
            params={'card': 'Master Operative', 'dc_name': 'Luke Skywalker'},
        ))
        assert new_g.data['player1CcHand'] == []
        assert new_g.data['player1CcDiscard'] == ['Master Operative']
        assert new_g.data['pendingCcEffect']['cardName'] == 'Master Operative'
        assert new_g.data['pendingCcEffect']['dcName'] == 'Luke Skywalker'
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_play_cc_special_rejects_wrong_timing():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    # 'duringActivation' is not specialAction — should reject
    cc_effects_loader._cc_effects = {
        'Hold On': {'timing': 'duringActivation', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {'Luke Skywalker': {}}
    try:
        g = create_game()
        g.data['player1CcHand'] = ['Hold On']
        try:
            step(g, Action(
                type=ActionType.PLAY_CC_SPECIAL, player=1,
                params={'card': 'Hold On', 'dc_name': 'Luke Skywalker'},
            ))
        except ValueError as e:
            assert 'not playable' in str(e)
            return
        raise AssertionError('expected ValueError')
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_play_cc_double_accepts_double_action_special_timing():
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Dual-Bladed Fury': {'timing': 'doubleActionSpecial', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {'Darth Maul': {}}
    try:
        g = create_game()
        g.data['player1CcHand'] = ['Dual-Bladed Fury']
        new_g = step(g, Action(
            type=ActionType.PLAY_CC_DOUBLE, player=1,
            params={'card': 'Dual-Bladed Fury', 'dc_name': 'Darth Maul'},
        ))
        assert new_g.data['player1CcDiscard'] == ['Dual-Bladed Fury']
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_play_cc_special_requires_params():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.PLAY_CC_SPECIAL, player=1,
            params={'card': 'X'},  # missing dc_name
        ))
    except ValueError as e:
        assert 'dc_name' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_select_map_sets_selected_map_and_mission():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.SELECT_MAP, player=0,
        params={'mission_id': 'mos-eisley-outskirts:a'},
    ))
    assert new_g.data['selectedMap']['id'] == 'mos-eisley-outskirts'
    assert new_g.data['selectedMission']['variant'] == 'a'
    assert new_g.data['selectedMission']['name']  # non-empty
    assert new_g.data['mapId'] == 'mos-eisley-outskirts'
    assert new_g.data['mapSelected'] is True


def test_select_map_default_variant_a():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.SELECT_MAP, player=0,
        params={'mission_id': 'mos-eisley-outskirts'},
    ))
    assert new_g.data['selectedMission']['variant'] == 'a'


def test_select_map_rejects_unknown_map():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.SELECT_MAP, player=0,
            params={'mission_id': 'nonsense-map:a'},
        ))
    except ValueError as e:
        assert 'no mission data' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_select_map_rejects_bad_variant():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.SELECT_MAP, player=0,
            params={'mission_id': 'mos-eisley-outskirts:z'},
        ))
    except ValueError as e:
        assert 'variant' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_pick_zone_sets_deployment_zone_chosen():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.PICK_ZONE, player=1,
        params={'zone': 'Red'},  # case-insensitive
    ))
    assert new_g.data['deploymentZoneChosen'] == 'red'


def test_pick_zone_rejects_invalid_zone():
    g = create_game()
    try:
        step(g, Action(type=ActionType.PICK_ZONE, player=1,
                        params={'zone': 'yellow'}))
    except ValueError as e:
        assert 'red' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_determine_initiative_sets_initiative_player():
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    new_g = step(g, Action(
        type=ActionType.DETERMINE_INITIATIVE, player=0,
        params={'player': 2},
    ))
    assert new_g.data['initiativePlayerId'] == 'bob'
    assert new_g.data['initiativeHolder'] == 2


def test_determine_initiative_rejects_bad_player():
    g = create_game()
    try:
        step(g, Action(type=ActionType.DETERMINE_INITIATIVE, player=0,
                        params={'player': 3}))
    except ValueError as e:
        assert 'player' in str(e).lower()
        return
    raise AssertionError('expected ValueError')


def test_submit_squad_sets_player_squad():
    g = create_game()
    squad = {'name': 'Rebels', 'dcList': ['Luke'], 'ccList': ['Hold On']}
    new_g = step(g, Action(
        type=ActionType.SUBMIT_SQUAD, player=1,
        params={'squad': squad},
    ))
    assert new_g.data['player1Squad'] == squad
    assert new_g.data.get('player2Squad') in (None, {})


def test_submit_squad_rejects_missing_squad():
    g = create_game()
    try:
        step(g, Action(type=ActionType.SUBMIT_SQUAD, player=1, params={}))
    except ValueError as e:
        assert 'squad' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_deploy_done_initiative_side():
    g = create_game()
    g.data['initiativeHolder'] = 1
    new_g = step(g, Action(type=ActionType.DEPLOY_DONE, player=1))
    assert new_g.data['initiativePlayerDeployed'] is True
    assert new_g.data.get('nonInitiativePlayerDeployed') in (None, False)
    assert new_g.data.get('deploymentComplete') is not True


def test_deploy_done_non_initiative_side():
    g = create_game()
    g.data['initiativeHolder'] = 1
    new_g = step(g, Action(type=ActionType.DEPLOY_DONE, player=2))
    assert new_g.data['nonInitiativePlayerDeployed'] is True
    assert new_g.data.get('initiativePlayerDeployed') in (None, False)


def test_deploy_done_both_players_marks_complete():
    g = create_game()
    g.data['initiativeHolder'] = 1
    g = step(g, Action(type=ActionType.DEPLOY_DONE, player=1))
    g = step(g, Action(type=ActionType.DEPLOY_DONE, player=2))
    assert g.data['deploymentComplete'] is True


def test_draw_cc_initial_starting_hand():
    g = create_game()
    g.data['player1Squad'] = {'ccList': ['A', 'B', 'C', 'D', 'E']}
    new_g = step(g, Action(
        type=ActionType.DRAW_CC, player=1,
        params={'rng_seed': 42, 'starting_size': 3},
    ))
    assert len(new_g.data['player1CcHand']) == 3
    assert len(new_g.data['player1CcDeck']) == 2
    assert new_g.data['player1CcDrawn'] is True


def test_draw_cc_filters_attached_cards_from_deck():
    g = create_game()
    g.data['player1Squad'] = {'ccList': ['A', 'B', 'C', 'D', 'E']}
    g.data['p1CcAttachments'] = {'hl1dc0': ['B', 'D']}
    new_g = step(g, Action(
        type=ActionType.DRAW_CC, player=1,
        params={'rng_seed': 0, 'starting_size': 3},
    ))
    # B and D should NOT be in hand OR deck
    all_cards = new_g.data['player1CcHand'] + new_g.data['player1CcDeck']
    assert 'B' not in all_cards
    assert 'D' not in all_cards
    assert sorted(all_cards) == ['A', 'C', 'E']


def test_draw_cc_rejects_double_draw():
    g = create_game()
    g.data['player1Squad'] = {'ccList': ['A', 'B', 'C']}
    step(g, Action(type=ActionType.DRAW_CC, player=1,
                    params={'rng_seed': 0, 'starting_size': 3}))
    # Note: second step on same game triggers ValueError because the first
    # mutation set player1CcDrawn; step() copies input so we need to re-apply
    g2 = step(g, Action(type=ActionType.DRAW_CC, player=1,
                        params={'rng_seed': 0, 'starting_size': 3}))
    try:
        step(g2, Action(type=ActionType.DRAW_CC, player=1,
                        params={'rng_seed': 0, 'starting_size': 3}))
    except ValueError as e:
        assert 'already drawn' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_draw_cc_rejects_no_squad():
    g = create_game()
    g.data.pop('player1Squad', None)
    try:
        step(g, Action(type=ActionType.DRAW_CC, player=1, params={'rng_seed': 0}))
    except ValueError as e:
        assert 'no squad submitted' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_map_type_choice_sets_selection_type():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.MAP_TYPE_CHOICE, player=0,
        params={'selection_type': 'Random'},  # case-insensitive
    ))
    assert new_g.data['mapSelectionType'] == 'random'


def test_map_type_choice_rejects_invalid():
    g = create_game()
    try:
        step(g, Action(type=ActionType.MAP_TYPE_CHOICE, player=0,
                        params={'selection_type': 'nonsense'}))
    except ValueError as e:
        assert 'selection_type' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_map_confirm_sets_map_selected_and_advances_phase():
    g = create_game()
    g.data['selectedMap'] = {'id': 'x', 'name': 'X'}
    g.data['mapSelectionType'] = 'random'
    new_g = step(g, Action(type=ActionType.MAP_CONFIRM, player=0))
    assert new_g.data['mapSelected'] is True
    assert new_g.data['phase'] == 'initiative'
    assert new_g.data.get('mapSelectionType') is None


def test_map_confirm_requires_selected_map():
    g = create_game()
    try:
        step(g, Action(type=ActionType.MAP_CONFIRM, player=0))
    except ValueError as e:
        assert 'no map selected' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_map_confirm_idempotent_when_already_confirmed():
    g = create_game()
    g.data['selectedMap'] = {'id': 'x'}
    g.data['mapSelected'] = True
    new_g = step(g, Action(type=ActionType.MAP_CONFIRM, player=0))
    # No change; no error
    assert new_g.data['mapSelected'] is True


def test_map_go_back_clears_pending_selection():
    g = create_game()
    g.data['selectedMap'] = {'id': 'x'}
    g.data['selectedMission'] = {'variant': 'a'}
    g.data['mapSelectionType'] = 'draw'
    g.data['mapId'] = 'x'
    new_g = step(g, Action(type=ActionType.MAP_GO_BACK, player=0))
    assert 'selectedMap' not in new_g.data
    assert 'selectedMission' not in new_g.data
    assert 'mapSelectionType' not in new_g.data
    assert 'mapId' not in new_g.data


def test_map_go_back_noop_once_confirmed():
    g = create_game()
    g.data['selectedMap'] = {'id': 'x'}
    g.data['mapSelected'] = True
    new_g = step(g, Action(type=ActionType.MAP_GO_BACK, player=0))
    assert new_g.data['selectedMap'] == {'id': 'x'}


def test_end_turn_clears_pending_and_movement_bank_then_ends_activation():
    g = create_game()
    g.data['activeFigureKeys'] = ['Luke-0-0']
    g.data['movementPoints'] = 3
    g.data['activePlayer'] = 1
    g.data['pendingEndTurn'] = {'hl1dc0': {'displayName': 'Luke'}}
    g.data['movementBank'] = {'hl1dc0': {'total': 4, 'remaining': 2}}
    new_g = step(g, Action(
        type=ActionType.END_TURN, player=1,
        params={'msg_id': 'hl1dc0'},
    ))
    # END_TURN clears the specific msg_id from both maps
    assert new_g.data['pendingEndTurn'] is None
    assert new_g.data['movementBank'] is None
    # And delegates to DC_END_ACTIVATION state changes
    assert new_g.data['activeFigureKeys'] == []
    assert new_g.data['movementPoints'] == 0
    assert new_g.data['activePlayer'] == 2


def test_pounce_space_dispatches_and_clears_pending():
    g = create_game()
    g.data['pendingPounceSpaceChoice'] = {
        'hl1dc0': {
            'abilityId': 'unknown_ability',
            'playerNum': 1,
            'validSpaces': ['a1', 'a2', 'b1'],
            'targetFigureKey': 'Luke-0-0',
            'figureIndex': 0,
            'specialIdx': 0,
        },
    }
    new_g = step(g, Action(
        type=ActionType.POUNCE_SPACE, player=1,
        params={'msg_id': 'hl1dc0', 'space': 'A2'},  # uppercase OK
    ))
    assert new_g.data['pendingPounceSpaceChoice'] is None
    assert new_g.data['lastPounceResult']['chosenSpace'] == 'a2'
    assert new_g.data['lastPounceResult']['result']['reason'] == 'unknown_ability'


def test_pounce_space_rejects_invalid_space():
    g = create_game()
    g.data['pendingPounceSpaceChoice'] = {
        'hl1dc0': {
            'abilityId': 'x', 'playerNum': 1,
            'validSpaces': ['a1'],
        },
    }
    try:
        step(g, Action(
            type=ActionType.POUNCE_SPACE, player=1,
            params={'msg_id': 'hl1dc0', 'space': 'z99'},
        ))
    except ValueError as e:
        assert 'not a valid' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cc_choice_dispatches_with_choice_index():
    g = create_game()
    g.data['pendingCcChoice'] = {
        'abilityId': 'unknown_cc_ability',
        'playerNum': 1,
        'choiceOptions': ['Option A', 'Option B'],
        'choiceValues': [None, 'Luke-0-0'],
    }
    new_g = step(g, Action(
        type=ActionType.CC_CHOICE, player=1,
        params={'choice_index': 1},
    ))
    assert new_g.data['pendingCcChoice'] is None
    assert new_g.data['lastCcChoiceResult']['abilityId'] == 'unknown_cc_ability'


def test_cc_choice_rejects_out_of_range():
    g = create_game()
    g.data['pendingCcChoice'] = {
        'abilityId': 'x', 'playerNum': 1, 'choiceOptions': ['A'],
    }
    try:
        step(g, Action(type=ActionType.CC_CHOICE, player=1,
                        params={'choice_index': 5}))
    except ValueError as e:
        assert 'out of range' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cc_space_validates_against_valid_spaces():
    g = create_game()
    g.data['pendingCcSpaceChoice'] = {
        'abilityId': 'x', 'playerNum': 1,
        'validSpaces': ['a1', 'b2'],
    }
    try:
        step(g, Action(type=ActionType.CC_SPACE, player=1,
                        params={'space': 'z99'}))
    except ValueError as e:
        assert 'not a valid' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_cc_space_dispatches_on_valid_pick():
    g = create_game()
    g.data['pendingCcSpaceChoice'] = {
        'abilityId': 'unknown_cc', 'playerNum': 1,
        'validSpaces': ['a1', 'b2'],
    }
    new_g = step(g, Action(type=ActionType.CC_SPACE, player=1,
                            params={'space': 'a1'}))
    assert new_g.data['pendingCcSpaceChoice'] is None
    assert new_g.data['lastCcSpaceResult']['abilityId'] == 'unknown_cc'


def test_arsenal_pick_sets_override_dice_and_clears_pending():
    g = create_game()
    g.data['pendingArsenalPick'] = {'hl1dc0': {'options': [['red', 'green']]}}
    new_g = step(g, Action(
        type=ActionType.ARSENAL_PICK, player=1,
        params={'msg_id': 'hl1dc0', 'dice': ['red', 'blue']},
    ))
    assert new_g.data['pendingArsenalPick'] is None
    assert new_g.data['pendingOverrideAttackDice']['hl1dc0'] == {
        'dice': ['red', 'blue'],
    }


def test_arsenal_pick_requires_dice_list():
    g = create_game()
    try:
        step(g, Action(type=ActionType.ARSENAL_PICK, player=1,
                        params={'msg_id': 'hl1dc0', 'dice': 'not a list'}))
    except ValueError as e:
        assert 'dice' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_combat_ready_flags_both_sides():
    g = create_game()
    g.data['pendingCombat'] = {'attackerPlayerNum': 1, 'defenderPlayerNum': 2}
    g = step(g, Action(type=ActionType.COMBAT_READY, player=1))
    assert g.data['pendingCombat']['p1Ready'] is True
    assert g.data['pendingCombat'].get('phase') != 'ready'
    g = step(g, Action(type=ActionType.COMBAT_READY, player=2))
    assert g.data['pendingCombat']['p2Ready'] is True
    assert g.data['pendingCombat']['phase'] == 'ready'


def test_combat_gate_stamps_phase():
    g = create_game()
    g.data['pendingCombat'] = {'attackerPlayerNum': 1}
    new_g = step(g, Action(
        type=ActionType.COMBAT_GATE, player=1,
        params={'gate': 'close_quarters'},
    ))
    assert new_g.data['pendingCombat']['phase'] == 'close_quarters'


def test_combat_reroll_records_indices_and_updates_values():
    g = create_game()
    g.data['pendingCombat'] = {
        'attackerPlayerNum': 1,
        'attackRoll': [{'face': 'blank'}, {'face': 'hit'}, {'face': 'blank'}],
    }
    new_g = step(g, Action(
        type=ActionType.COMBAT_REROLL, player=1,
        params={
            'side': 'attacker',
            'indices': [0, 2],
            'new_values': [{'face': 'hit'}, {'face': 'surge'}],
        },
    ))
    assert new_g.data['pendingCombat']['attackerRerolledIndices'] == [0, 2]
    assert new_g.data['pendingCombat']['attackRoll'][0]['face'] == 'hit'
    assert new_g.data['pendingCombat']['attackRoll'][2]['face'] == 'surge'


def test_combat_reroll_defender_side():
    g = create_game()
    g.data['pendingCombat'] = {'defenderPlayerNum': 2}
    new_g = step(g, Action(
        type=ActionType.COMBAT_REROLL, player=2,
        params={'side': 'defender', 'indices': [0]},
    ))
    assert new_g.data['pendingCombat']['defenderRerolledIndices'] == [0]


def test_combat_surge_decrements_remaining_and_records():
    g = create_game()
    g.data['pendingCombat'] = {
        'attackerPlayerNum': 1, 'surgeRemaining': 2,
    }
    g = step(g, Action(
        type=ActionType.COMBAT_SURGE, player=1,
        params={'ability': 'pierce_1'},
    ))
    assert g.data['pendingCombat']['surgeRemaining'] == 1
    assert g.data['pendingCombat']['triggeredSurges'] == ['pierce_1']
    # Spend the last surge → phase auto-advances
    g = step(g, Action(
        type=ActionType.COMBAT_SURGE, player=1,
        params={'ability': 'accuracy_2'},
    ))
    assert g.data['pendingCombat']['surgeRemaining'] == 0
    assert g.data['pendingCombat']['phase'] == 'surges_done'


def test_combat_surge_rejects_when_none_remaining():
    g = create_game()
    g.data['pendingCombat'] = {'surgeRemaining': 0}
    try:
        step(g, Action(
            type=ActionType.COMBAT_SURGE, player=1,
            params={'ability': 'x'},
        ))
    except ValueError as e:
        assert 'no surges' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_combat_skip_surges_advances_phase():
    g = create_game()
    g.data['pendingCombat'] = {'surgeRemaining': 2}
    new_g = step(g, Action(type=ActionType.COMBAT_SKIP_SURGES, player=1))
    assert new_g.data['pendingCombat']['surgeRemaining'] == 0
    assert new_g.data['pendingCombat']['phase'] == 'surges_done'


def test_combat_passive_dedupe():
    g = create_game()
    g.data['pendingCombat'] = {}
    g = step(g, Action(type=ActionType.COMBAT_PASSIVE, player=1,
                        params={'passive': 'cunning'}))
    g = step(g, Action(type=ActionType.COMBAT_PASSIVE, player=1,
                        params={'passive': 'cunning'}))
    assert g.data['pendingCombat']['triggeredPassives'] == ['cunning']


def test_combat_token_spends_matching_token():
    g = create_game()
    g.data['pendingCombat'] = {'attackerPlayerNum': 1}
    g.data['figurePowerTokens'] = {'Luke-0-0': ['Surge', 'Block', 'Damage']}
    new_g = step(g, Action(
        type=ActionType.COMBAT_TOKEN, player=1,
        params={'figure_key': 'Luke-0-0', 'token_type': 'Block', 'index': 1},
    ))
    assert new_g.data['figurePowerTokens']['Luke-0-0'] == ['Surge', 'Damage']
    assert new_g.data['pendingCombat']['spentTokens'] == [
        {'figureKey': 'Luke-0-0', 'tokenType': 'Block'},
    ]


def test_combat_token_mismatched_type_raises():
    g = create_game()
    g.data['pendingCombat'] = {}
    g.data['figurePowerTokens'] = {'Luke-0-0': ['Surge']}
    try:
        step(g, Action(
            type=ActionType.COMBAT_TOKEN, player=1,
            params={'figure_key': 'Luke-0-0', 'token_type': 'Block', 'index': 0},
        ))
    except ValueError as e:
        assert 'expected' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_combat_resolve_applies_damage_and_clears_pending():
    g = create_game()
    g.data['pendingCombat'] = {
        'attackerPlayerNum': 1,
        'defenderPlayerNum': 2,
        'defenderMsgId': 'hl2dc0',
        'target': {'figureKey': 'Stormtrooper-0-0'},
        'targetStats': {'cost': 0},
    }
    g.data['dcHealthState'] = {'hl2dc0': [[5, 5]]}
    g.data['figurePositions'] = {1: {}, 2: {'Stormtrooper-0-0': 'a1'}}
    new_g = step(g, Action(
        type=ActionType.COMBAT_RESOLVE, player=1,
        params={'damage': 2, 'defeated': False},
    ))
    assert new_g.data['dcHealthState']['hl2dc0'][0][0] == 3
    assert new_g.data['pendingCombat'] is None
    assert new_g.data['lastCombatResult']['damage'] == 2
    assert new_g.data['lastCombatResult']['applied'] is True
    # Figure still on board (not defeated)
    assert 'Stormtrooper-0-0' in new_g.data['figurePositions'][2]


def test_combat_resolve_defeated_awards_kill_vp_and_removes_figure():
    g = create_game()
    g.data['pendingCombat'] = {
        'attackerPlayerNum': 1,
        'defenderPlayerNum': 2,
        'defenderMsgId': 'hl2dc0',
        'target': {'figureKey': 'Stormtrooper-0-0'},
        'targetStats': {'cost': 4},
    }
    g.data['dcHealthState'] = {'hl2dc0': [[2, 5]]}
    g.data['figurePositions'] = {1: {}, 2: {'Stormtrooper-0-0': 'a1'}}
    new_g = step(g, Action(
        type=ActionType.COMBAT_RESOLVE, player=1,
        params={'damage': 2, 'defeated': True},
    ))
    assert new_g.data['player1VP']['kills'] == 4
    assert new_g.data['player1VP']['total'] == 4
    assert 'Stormtrooper-0-0' not in new_g.data['figurePositions'][2]


def test_combat_resolve_requires_pending():
    g = create_game()
    try:
        step(g, Action(
            type=ActionType.COMBAT_RESOLVE, player=1,
            params={'damage': 0},
        ))
    except ValueError as e:
        assert 'pendingCombat' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_deploy_figure_places_on_board():
    g = create_game()
    g.data['figurePositions'] = {1: {}, 2: {}}
    new_g = step(g, Action(
        type=ActionType.DEPLOY_FIGURE, player=1,
        params={'figure_key': 'Luke-0-0', 'coord': 'C5'},
    ))
    assert new_g.data['figurePositions'][1]['Luke-0-0'] == 'c5'


def test_deploy_figure_rejects_missing_params():
    g = create_game()
    try:
        step(g, Action(type=ActionType.DEPLOY_FIGURE, player=1, params={}))
    except ValueError as e:
        assert 'figure_key' in str(e)
        return
    raise AssertionError('expected ValueError')


def test_deploy_pick_records_flat_index():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.DEPLOY_PICK, player=1,
        params={'flat_index': 3},
    ))
    assert new_g.data['pendingDeployPick'][1] == 3


def test_move_figure_records_in_progress():
    g = create_game()
    g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
    new_g = step(g, Action(
        type=ActionType.MOVE_FIGURE, player=1,
        params={'figure_key': 'Luke-0-0', 'msg_id': 'hl1dc0'},
    ))
    assert new_g.data['moveInProgress']['hl1dc0']['figureKey'] == 'Luke-0-0'
    assert new_g.data['moveInProgress']['hl1dc0']['playerNum'] == 1


def test_move_mp_records_budget():
    g = create_game()
    g.data['moveInProgress'] = {'hl1dc0': {'figureKey': 'Luke-0-0'}}
    new_g = step(g, Action(
        type=ActionType.MOVE_MP, player=1,
        params={'msg_id': 'hl1dc0', 'mp': 3},
    ))
    assert new_g.data['moveInProgress']['hl1dc0']['mpRemaining'] == 3


def test_move_letter_records_letter():
    g = create_game()
    g.data['moveInProgress'] = {'hl1dc0': {}}
    new_g = step(g, Action(
        type=ActionType.MOVE_LETTER, player=1,
        params={'msg_id': 'hl1dc0', 'letter': 'A'},
    ))
    assert new_g.data['moveInProgress']['hl1dc0']['letter'] == 'A'


def test_dc_action_records_pending_choice():
    g = create_game()
    new_g = step(g, Action(
        type=ActionType.DC_ACTION, player=1,
        params={'msg_id': 'hl1dc0', 'action_name': 'attack'},
    ))
    assert new_g.data['pendingDcActionChoice']['hl1dc0'] == 'attack'


def test_special_action_delegates_to_dc_special():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Luke': {'figures': 1, 'specialAbilityIds': ['unknown_ability']},
    }
    try:
        g = create_game()
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        # Expect UnknownAbility to propagate from dispatch, since _handle_dc_special
        # raises it
        try:
            step(g, Action(
                type=ActionType.SPECIAL_ACTION, player=1,
                params={'figure_key': 'Luke-0-0', 'special_idx': 0},
            ))
        except Exception as e:
            # Either UnknownAbility or the generic dispatcher message
            assert 'unknown' in str(e).lower() or 'ability' in str(e).lower()
            return
        # If no exception raised, the dispatcher must have logged and moved on
    finally:
        dc_effects_loader.reset_cache()


def test_refresh_map_is_noop():
    g = create_game()
    orig = g.to_json()
    new_g = step(g, Action(type=ActionType.REFRESH_MAP, player=0))
    assert new_g.to_json() == orig


def test_confirm_attachment_flips_flag():
    g = create_game()
    new_g = step(g, Action(type=ActionType.CONFIRM_ATTACHMENT, player=1))
    assert new_g.data['p1AttachmentsConfirmed'] is True


def test_rush_push_fig_moves_target_and_applies_damage():
    g = create_game()
    g.data['figurePositions'] = {
        1: {'Onar-0-0': 'a1'},
        2: {'Stormtrooper-0-0': 'a2'},
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p2DcMessageIds'] = ['hl2dc0']
    g.data['p1DcList'] = [{'dcName': 'Onar'}]
    g.data['p2DcList'] = [{'dcName': 'Stormtrooper'}]
    g.data['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[5, 5]],
    }
    g.data['pendingRushPush'] = {
        'playerNum': 1,
        'activatorFigureKey': 'Onar-0-0',
        'msgId': 'hl1dc0',
    }
    new_g = step(g, Action(
        type=ActionType.RUSH_PUSH_FIG, player=1,
        params={'target_figure_key': 'Stormtrooper-0-0', 'destination': 'a3'},
    ))
    assert new_g.data['figurePositions'][2]['Stormtrooper-0-0'] == 'a3'
    # Both suffer 1 damage
    assert new_g.data['dcHealthState']['hl1dc0'][0][0] == 9
    assert new_g.data['dcHealthState']['hl2dc0'][0][0] == 4
    assert new_g.data['pendingRushPush'] is None


def test_shoulder_rush_fig_applies_pending_damage():
    g = create_game()
    g.data['figurePositions'] = {1: {}, 2: {'Trooper-0-0': 'a1'}}
    g.data['p2DcMessageIds'] = ['hl2dc0']
    g.data['p2DcList'] = [{'dcName': 'Trooper'}]
    g.data['dcHealthState'] = {'hl2dc0': [[8, 8]]}
    g.data['pendingShoulderRush'] = {'playerNum': 1, 'damage': 3}
    new_g = step(g, Action(
        type=ActionType.SHOULDER_RUSH_FIG, player=1,
        params={'target_figure_key': 'Trooper-0-0', 'destination': 'b2'},
    ))
    assert new_g.data['figurePositions'][2]['Trooper-0-0'] == 'b2'
    assert new_g.data['dcHealthState']['hl2dc0'][0][0] == 5  # 8 - 3
    assert new_g.data['pendingShoulderRush'] is None


def test_false_orders_move_moves_controlled_figure():
    g = create_game()
    g.data['figurePositions'] = {2: {'Trooper-0-0': 'a1'}}
    g.data['pendingFalseOrders'] = {
        'controlledFigureKey': 'Trooper-0-0',
        'controlledPlayerNum': 2,
        'controllerPlayerNum': 1,
    }
    new_g = step(g, Action(
        type=ActionType.FALSE_ORDERS_MOVE, player=1,
        params={'destination': 'B2'},
    ))
    assert new_g.data['figurePositions'][2]['Trooper-0-0'] == 'b2'
    assert new_g.data['pendingFalseOrders'] is None


def test_false_orders_attack_records_intent():
    g = create_game()
    g.data['pendingFalseOrders'] = {
        'controlledFigureKey': 'Trooper-0-0',
        'controlledPlayerNum': 2,
        'controllerPlayerNum': 1,
    }
    new_g = step(g, Action(
        type=ActionType.FALSE_ORDERS_ATTACK, player=1,
        params={'target_figure_key': 'Luke-0-0'},
    ))
    assert new_g.data['pendingFalseOrdersAttack'] == {
        'controlledFigureKey': 'Trooper-0-0',
        'controlledPlayerNum': 2,
        'targetFigureKey': 'Luke-0-0',
        'controllerPlayerNum': 1,
    }
    assert new_g.data['pendingFalseOrders'] is None


def test_strain_choice_alldmg_applies_full_hp_damage():
    g = create_game()
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['dcHealthState'] = {'hl1dc0': [[8, 8]]}
    g.data['pendingStrainChoice'] = {
        'amount': 3, 'figureKey': 'Luke-0-0', 'playerNum': 1,
    }
    new_g = step(g, Action(type=ActionType.STRAIN_CHOICE_ALLDMG, player=1))
    assert new_g.data['dcHealthState']['hl1dc0'][0][0] == 5  # 8 - 3
    assert new_g.data['pendingStrainChoice'] is None


def test_strain_choice_discard_prevents_strain_via_deck_drain():
    g = create_game()
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['dcHealthState'] = {'hl1dc0': [[8, 8]]}
    g.data['player1CcDeck'] = ['A', 'B', 'C', 'D', 'E']
    g.data['pendingStrainChoice'] = {
        'amount': 3, 'figureKey': 'Luke-0-0', 'playerNum': 1,
        'ccCostPerStrain': 1,
    }
    new_g = step(g, Action(
        type=ActionType.STRAIN_CHOICE_DISCARD, player=1,
        params={'discard_count': 2},
    ))
    # 2 CCs discarded prevent 2 strain; 1 remaining → HP damage
    assert new_g.data['player1CcDeck'] == ['C', 'D', 'E']
    assert new_g.data['player1CcDiscard'] == ['A', 'B']
    assert new_g.data['dcHealthState']['hl1dc0'][0][0] == 7  # 8 - 1
    assert new_g.data['lastStrainChoice'] == {
        'amount': 3, 'strainPrevented': 2, 'hpDamage': 1,
    }


def test_strain_choice_discard_under_duress_doubles_cost():
    g = create_game()
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['dcHealthState'] = {'hl1dc0': [[8, 8]]}
    g.data['player1CcDeck'] = ['A', 'B', 'C', 'D']
    g.data['pendingStrainChoice'] = {
        'amount': 2, 'figureKey': 'Luke-0-0', 'playerNum': 1,
        'ccCostPerStrain': 2,
    }
    new_g = step(g, Action(
        type=ActionType.STRAIN_CHOICE_DISCARD, player=1,
        params={'discard_count': 2},
    ))
    # 2 discards × 2-per-strain = 4 CCs drained (all of deck); prevents 2 strain
    assert new_g.data['player1CcDeck'] == []
    assert len(new_g.data['player1CcDiscard']) == 4
    # No HP damage (all prevented)
    assert new_g.data['dcHealthState']['hl1dc0'][0][0] == 8


def test_bomb_drop_space_damages_figures_on_coord():
    g = create_game()
    g.data['figurePositions'] = {
        1: {'Luke-0-0': 'a1'},
        2: {'Vader-0-0': 'a1'},  # same space as Luke
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p2DcMessageIds'] = ['hl2dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['p2DcList'] = [{'dcName': 'Vader'}]
    g.data['dcHealthState'] = {'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]]}
    g.data['pendingBombDrop'] = {'hl1dc0': {'damage': 3}}
    new_g = step(g, Action(
        type=ActionType.BOMB_DROP_SPACE, player=1,
        params={'msg_id': 'hl1dc0', 'space': 'a1'},
    ))
    assert new_g.data['dcHealthState']['hl1dc0'][0][0] == 7
    assert new_g.data['dcHealthState']['hl2dc0'][0][0] == 9
    assert new_g.data['pendingBombDrop'] is None
    assert len(new_g.data['lastBombDropHits']['hits']) == 2


def test_ob_space_accumulates_and_finalizes_on_last_space():
    g = create_game()
    g.data['figurePositions'] = {1: {}, 2: {'Trooper-0-0': 'b2'}}
    g.data['p2DcMessageIds'] = ['hl2dc0']
    g.data['p2DcList'] = [{'dcName': 'Trooper'}]
    g.data['dcHealthState'] = {'hl2dc0': [[5, 5]]}
    g.data['pendingOrbitalBombardment'] = {
        'msgId': 'hl1dc0', 'playerNum': 1,
        'spacesRemaining': 2, 'spacesChosen': [], 'damage': 2,
    }
    # First pick: no resolution yet
    g = step(g, Action(type=ActionType.OB_SPACE, player=1,
                        params={'msg_id': 'hl1dc0', 'space': 'a1'}))
    assert g.data['pendingOrbitalBombardment']['spacesChosen'] == ['a1']
    assert g.data['dcHealthState']['hl2dc0'][0][0] == 5  # not yet applied
    # Second pick: resolve
    g = step(g, Action(type=ActionType.OB_SPACE, player=1,
                        params={'msg_id': 'hl1dc0', 'space': 'B2'}))
    assert g.data['pendingOrbitalBombardment'] is None
    assert g.data['dcHealthState']['hl2dc0'][0][0] == 3
    assert g.data['lastOrbitalBombardmentHits']['spaces'] == ['a1', 'b2']


def test_draft_random_sets_squad_and_flag():
    g = create_game()
    squad = {'name': 'Random', 'dcList': ['Rebel Trooper']}
    new_g = step(g, Action(
        type=ActionType.DRAFT_RANDOM, player=1,
        params={'squad': squad},
    ))
    assert new_g.data['player1Squad'] == squad
    assert new_g.data['p1DraftedRandom'] is True


def test_dc_end_activation_clears_active_and_swaps_player():
    g = _two_figure_game()
    g = step(g, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Rebel Trooper (Regular)-0-0'},
    ))
    g = step(g, Action(type=ActionType.DC_END_ACTIVATION, player=1))
    assert g.data['activeFigureKeys'] == []
    assert g.data['movementPoints'] == 0
    assert g.data['activePlayer'] == 2


def main():
    cases = [
        ('unknown_action_raises', test_unknown_action_raises),
        ('step_does_not_mutate_input', test_step_does_not_mutate_input),
        ('pass_activation_turn_swaps_active_player', test_pass_activation_turn_swaps_active_player),
        ('end_activation_phase_requires_zero_activations', test_end_activation_phase_requires_zero_activations),
        ('end_activation_phase_transitions_to_end', test_end_activation_phase_transitions_to_end),
        ('end_activation_phase_accepts_missing_activations', test_end_activation_phase_accepts_missing_activations),
        ('is_implemented_reports_correctly', test_is_implemented_reports_correctly),
        ('activate_dc_sets_movement_points_from_speed', test_activate_dc_sets_movement_points_from_speed),
        ('activate_dc_rejects_no_activations', test_activate_dc_rejects_no_activations),
        ('activate_dc_rejects_wrong_owner', test_activate_dc_rejects_wrong_owner),
        ('move_pick_space_updates_position_and_charges_mp', test_move_pick_space_updates_position_and_charges_mp),
        ('move_pick_space_rejects_insufficient_mp', test_move_pick_space_rejects_insufficient_mp),
        ('dc_end_activation_clears_active_and_swaps_player', test_dc_end_activation_clears_active_and_swaps_player),
        ('phase_gate_ready_marks_player_ready', test_phase_gate_ready_marks_player_ready),
        ('phase_gate_unready_flips_back', test_phase_gate_unready_flips_back),
        ('phase_gate_ready_no_gate_is_noop', test_phase_gate_ready_no_gate_is_noop),
        ('interact_open_door_dispatch', test_interact_open_door_dispatch),
        ('interact_rejects_illegal_option', test_interact_rejects_illegal_option),
        ('pt_overflow_discard_resolves_one_slot', test_pt_overflow_discard_resolves_one_slot),
        ('pt_overflow_discard_clears_queue_when_drained', test_pt_overflow_discard_clears_queue_when_drained),
        ('cc_draw_pulls_n_from_deck_to_hand', test_cc_draw_pulls_n_from_deck_to_hand),
        ('cc_draw_default_n_one', test_cc_draw_default_n_one),
        ('cc_draw_reshuffle_from_discard_when_empty', test_cc_draw_reshuffle_from_discard_when_deck_empty),
        ('cc_draw_target_hand_size_precedence', test_cc_draw_target_hand_size_takes_precedence),
        ('cc_draw_invalid_player_raises', test_cc_draw_invalid_player_raises),
        ('play_cc_moves_hand_to_discard', test_play_cc_moves_hand_to_discard_and_records_pending),
        ('play_cc_rejects_not_in_hand', test_play_cc_rejects_card_not_in_hand),
        ('play_cc_rejects_timing_mismatch', test_play_cc_rejects_timing_mismatch),
        ('play_cc_force_bypasses_gates', test_play_cc_force_bypasses_gates),
        ('dc_special_rejects_missing_figure', test_dc_special_rejects_missing_figure),
        ('dc_special_rejects_out_of_range_idx', test_dc_special_rejects_out_of_range_idx),
        ('dc_special_requires_params', test_dc_special_requires_params),
        ('end_start_of_round_clears_window', test_end_start_of_round_clears_window_and_transitions),
        ('end_start_of_round_runs_mission_sor_rules', test_end_start_of_round_runs_mission_sor_rules),
        ('end_start_of_round_preserves_game_over', test_end_start_of_round_preserves_game_over_phase),
        ('celebration_play_awards_vp', test_celebration_play_awards_4_vp_and_discards),
        ('celebration_play_requires_window', test_celebration_play_requires_window),
        ('celebration_play_requires_card_in_hand', test_celebration_play_requires_card_in_hand),
        ('celebration_pass_clears_window', test_celebration_pass_clears_window_no_vp),
        ('cover_fire_block_grants_token', test_cover_fire_block_grants_token_and_clears_pending),
        ('cover_fire_block_requires_window', test_cover_fire_block_requires_window),
        ('cover_fire_skip_clears_pending', test_cover_fire_skip_clears_pending),
        ('bo_rifle_use_sets_melee_override', test_bo_rifle_use_sets_melee_override),
        ('bo_rifle_skip_clears_pending', test_bo_rifle_skip_clears_pending),
        ('bo_rifle_use_requires_pending', test_bo_rifle_use_requires_pending),
        ('ee3_pick_die_deducts_mp_and_swaps', test_ee3_pick_die_deducts_mp_and_swaps_color_to_red),
        ('ee3_pick_die_rejects_invalid_color', test_ee3_pick_die_rejects_invalid_color),
        ('ee3_pick_skip_stamps_decided', test_ee3_pick_skip_just_stamps_decided),
        ('spread_pain_cond_appends', test_spread_pain_cond_appends_to_combat_conditions),
        ('spread_pain_cond_skip', test_spread_pain_cond_skip_no_append_clears_pending),
        ('spread_pain_cond_rejects_bad_value', test_spread_pain_cond_rejects_bad_value),
        ('overwatch_space_places_token', test_overwatch_space_places_token_and_clears_pending),
        ('overwatch_space_requires_params', test_overwatch_space_requires_params),
        ('cc_cancel_play_clears_pending', test_cc_cancel_play_clears_pending_confirmation),
        ('comm_disruption_skip_clears_prompt', test_comm_disruption_skip_clears_prompt),
        ('rush_push_skip_clears_pending', test_rush_push_skip_clears_pending),
        ('shoulder_rush_skip_clears_pending', test_shoulder_rush_skip_clears_pending),
        ('false_orders_skip_clears_pending', test_false_orders_skip_clears_pending),
        ('missile_salvo_done_clears_pending', test_missile_salvo_done_clears_pending),
        ('skip_handlers_require_pending_window', test_skip_handlers_require_pending_window),
        ('power_token_choice_applies_to_grants', test_power_token_choice_applies_type_to_all_grants),
        ('power_token_choice_hit_alias', test_power_token_choice_accepts_hit_as_damage_alias),
        ('power_token_choice_rejects_invalid', test_power_token_choice_rejects_invalid_type),
        ('power_token_choice_requires_pending', test_power_token_choice_requires_pending),
        ('comm_disruption_play_cancels_cc', test_comm_disruption_play_cancels_pending_cc),
        ('comm_disruption_play_requires_card', test_comm_disruption_play_requires_card_in_hand),
        ('comm_disruption_play_requires_prompt', test_comm_disruption_play_requires_prompt),
        ('dc_ability_choice_clears_pending', test_dc_ability_choice_clears_pending_and_records_result),
        ('dc_ability_choice_requires_pending', test_dc_ability_choice_requires_pending),
        ('dc_ability_choice_rejects_out_of_range', test_dc_ability_choice_rejects_out_of_range),
        ('cc_confirm_play_delegates', test_cc_confirm_play_delegates_to_play_cc),
        ('cc_confirm_play_signal_jammer', test_cc_confirm_play_signal_jammer_cancels_both),
        ('cc_confirm_play_requires_pending', test_cc_confirm_play_requires_pending),
        ('play_cc_special_discards_with_effect', test_play_cc_special_moves_to_discard_with_pending_effect),
        ('play_cc_special_rejects_wrong_timing', test_play_cc_special_rejects_wrong_timing),
        ('play_cc_double_accepts_double_timing', test_play_cc_double_accepts_double_action_special_timing),
        ('play_cc_special_requires_params', test_play_cc_special_requires_params),
        ('select_map_sets_selected', test_select_map_sets_selected_map_and_mission),
        ('select_map_default_variant_a', test_select_map_default_variant_a),
        ('select_map_rejects_unknown', test_select_map_rejects_unknown_map),
        ('select_map_rejects_bad_variant', test_select_map_rejects_bad_variant),
        ('pick_zone_sets_chosen', test_pick_zone_sets_deployment_zone_chosen),
        ('pick_zone_rejects_invalid', test_pick_zone_rejects_invalid_zone),
        ('determine_initiative_sets', test_determine_initiative_sets_initiative_player),
        ('determine_initiative_rejects', test_determine_initiative_rejects_bad_player),
        ('submit_squad_sets_player_squad', test_submit_squad_sets_player_squad),
        ('submit_squad_rejects_missing', test_submit_squad_rejects_missing_squad),
        ('deploy_done_initiative_side', test_deploy_done_initiative_side),
        ('deploy_done_non_initiative_side', test_deploy_done_non_initiative_side),
        ('deploy_done_both_marks_complete', test_deploy_done_both_players_marks_complete),
        ('draw_cc_initial_starting_hand', test_draw_cc_initial_starting_hand),
        ('draw_cc_filters_attached', test_draw_cc_filters_attached_cards_from_deck),
        ('draw_cc_rejects_double_draw', test_draw_cc_rejects_double_draw),
        ('draw_cc_rejects_no_squad', test_draw_cc_rejects_no_squad),
        ('map_type_choice_sets_selection', test_map_type_choice_sets_selection_type),
        ('map_type_choice_rejects_invalid', test_map_type_choice_rejects_invalid),
        ('map_confirm_sets_selected', test_map_confirm_sets_map_selected_and_advances_phase),
        ('map_confirm_requires_map', test_map_confirm_requires_selected_map),
        ('map_confirm_idempotent', test_map_confirm_idempotent_when_already_confirmed),
        ('map_go_back_clears_pending', test_map_go_back_clears_pending_selection),
        ('map_go_back_noop_when_confirmed', test_map_go_back_noop_once_confirmed),
        ('end_turn_clears_pending_and_ends', test_end_turn_clears_pending_and_movement_bank_then_ends_activation),
        ('pounce_space_dispatches', test_pounce_space_dispatches_and_clears_pending),
        ('pounce_space_rejects_invalid', test_pounce_space_rejects_invalid_space),
        ('cc_choice_dispatches', test_cc_choice_dispatches_with_choice_index),
        ('cc_choice_rejects_out_of_range', test_cc_choice_rejects_out_of_range),
        ('cc_space_validates_spaces', test_cc_space_validates_against_valid_spaces),
        ('cc_space_dispatches_valid', test_cc_space_dispatches_on_valid_pick),
        ('arsenal_pick_sets_override', test_arsenal_pick_sets_override_dice_and_clears_pending),
        ('arsenal_pick_requires_dice_list', test_arsenal_pick_requires_dice_list),
        ('missile_salvo_done_with_msg_id', test_missile_salvo_done_with_msg_id_clears_just_that_slot),
        ('missile_salvo_die_consumes_and_sets', test_missile_salvo_die_consumes_color_and_sets_override),
        ('missile_salvo_die_rejects_unavailable', test_missile_salvo_die_rejects_unavailable_color),
        ('missile_salvo_die_requires_pending', test_missile_salvo_die_requires_pending),
        ('combat_ready_flags_both_sides', test_combat_ready_flags_both_sides),
        ('combat_gate_stamps_phase', test_combat_gate_stamps_phase),
        ('combat_reroll_records_indices', test_combat_reroll_records_indices_and_updates_values),
        ('combat_reroll_defender_side', test_combat_reroll_defender_side),
        ('combat_surge_decrements', test_combat_surge_decrements_remaining_and_records),
        ('combat_surge_rejects_when_none', test_combat_surge_rejects_when_none_remaining),
        ('combat_skip_surges_advances', test_combat_skip_surges_advances_phase),
        ('combat_passive_dedupe', test_combat_passive_dedupe),
        ('combat_token_spends_matching', test_combat_token_spends_matching_token),
        ('combat_token_mismatched_raises', test_combat_token_mismatched_type_raises),
        ('combat_resolve_applies_damage', test_combat_resolve_applies_damage_and_clears_pending),
        ('combat_resolve_defeated_awards_vp', test_combat_resolve_defeated_awards_kill_vp_and_removes_figure),
        ('combat_resolve_requires_pending', test_combat_resolve_requires_pending),
        ('deploy_figure_places_on_board', test_deploy_figure_places_on_board),
        ('deploy_figure_rejects_missing', test_deploy_figure_rejects_missing_params),
        ('deploy_pick_records', test_deploy_pick_records_flat_index),
        ('move_figure_records_progress', test_move_figure_records_in_progress),
        ('move_mp_records_budget', test_move_mp_records_budget),
        ('move_letter_records_letter', test_move_letter_records_letter),
        ('dc_action_records_choice', test_dc_action_records_pending_choice),
        ('special_action_delegates', test_special_action_delegates_to_dc_special),
        ('refresh_map_noop', test_refresh_map_is_noop),
        ('confirm_attachment_flips', test_confirm_attachment_flips_flag),
        ('rush_push_fig_moves_and_damages', test_rush_push_fig_moves_target_and_applies_damage),
        ('shoulder_rush_fig_applies_damage', test_shoulder_rush_fig_applies_pending_damage),
        ('false_orders_move_moves_figure', test_false_orders_move_moves_controlled_figure),
        ('false_orders_attack_records', test_false_orders_attack_records_intent),
        ('strain_choice_alldmg', test_strain_choice_alldmg_applies_full_hp_damage),
        ('strain_choice_discard', test_strain_choice_discard_prevents_strain_via_deck_drain),
        ('strain_choice_discard_under_duress', test_strain_choice_discard_under_duress_doubles_cost),
        ('bomb_drop_space_damages', test_bomb_drop_space_damages_figures_on_coord),
        ('ob_space_accumulates_then_resolves', test_ob_space_accumulates_and_finalizes_on_last_space),
        ('draft_random_sets_squad', test_draft_random_sets_squad_and_flag),
        ('attack_target_requires_different_owner', test_attack_target_requires_different_owner),
        ('attack_target_is_deterministic_with_seed', test_attack_target_is_deterministic_with_seed),
        ('attack_target_rejects_second_attack_same_activation', test_attack_target_rejects_second_attack_same_activation),
        ('attack_target_kills_and_awards_vp', test_attack_target_kills_and_awards_vp),
        ('end_end_of_round_refreshes_activations', test_end_end_of_round_refreshes_activations),
        ('end_end_of_round_detects_game_over', test_end_end_of_round_detects_game_over),
        ('end_end_of_round_counts_multi_figure_group_as_one', test_end_end_of_round_counts_multi_figure_group_as_one),
        ('auto_deploy_places_figures_and_starts_round', test_auto_deploy_places_figures_and_starts_round),
        ('auto_deploy_separates_sides_by_row', test_auto_deploy_separates_sides_by_row),
        ('auto_deploy_skips_bracketed_upgrades', test_auto_deploy_skips_bracketed_upgrades),
        ('auto_deploy_multiple_dcs_distinct_groups', test_auto_deploy_multiple_dcs_distinct_groups),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            print(f'FAIL: {name}: {e}')
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
