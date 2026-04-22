"""M3-I: tests for phase_gate state machine.

Mirrors the JS test coverage: create, record-ready (incl. test-game
both-for-one), record-unready (test-game undo ordering), clear,
playerNumFromId.

Run: python3 python/engine/mechanics/test_phase_gate.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.phase_gate import (
    PHASE_GATE_LABELS,
    clear_phase_gate,
    create_phase_gate,
    player_num_from_id,
    record_phase_gate_ready,
    record_phase_gate_unready,
)


def _game(p1='u1', p2='u2', test=False):
    return {'player1Id': p1, 'player2Id': p2, 'isTestGame': test}


def test_create_installs_gate_with_defaults():
    g = _game()
    create_phase_gate(g, 'deploy_done')
    assert g['phaseGate'] == {
        'phase': 'deploy_done',
        'p1Ready': False, 'p2Ready': False,
        'p1MsgId': None, 'p2MsgId': None,
    }


def test_record_ready_p1_then_p2_both_ready_on_second():
    g = _game()
    create_phase_gate(g, 'cc_drawn')
    r1 = record_phase_gate_ready(g, 'u1')
    assert r1 == {'alreadyReady': False, 'bothReady': False, 'playerNum': 1}
    assert g['phaseGate']['p1Ready'] is True
    assert g['phaseGate']['p2Ready'] is False

    r2 = record_phase_gate_ready(g, 'u2')
    assert r2 == {'alreadyReady': False, 'bothReady': True, 'playerNum': 2}
    assert g['phaseGate']['p2Ready'] is True


def test_record_ready_duplicate_returns_alreadyReady():
    g = _game()
    create_phase_gate(g, 'deploy_done')
    record_phase_gate_ready(g, 'u1')
    r = record_phase_gate_ready(g, 'u1')
    assert r == {'alreadyReady': True, 'bothReady': False, 'playerNum': 1}


def test_test_game_p1_readies_for_both_sequentially():
    g = _game(test=True)
    create_phase_gate(g, 'deploy_done')
    r1 = record_phase_gate_ready(g, 'u1')  # P1 clicks → P1 ready
    assert r1['playerNum'] == 1
    assert g['phaseGate']['p1Ready'] is True
    assert g['phaseGate']['p2Ready'] is False

    r2 = record_phase_gate_ready(g, 'u1')  # P1 clicks again → counts as P2
    assert r2['playerNum'] == 2
    assert r2['bothReady'] is True
    assert g['phaseGate']['p2Ready'] is True


def test_record_unready_flips_back():
    g = _game()
    create_phase_gate(g, 'deploy_done')
    record_phase_gate_ready(g, 'u1')
    record_phase_gate_ready(g, 'u2')
    r = record_phase_gate_unready(g, 'u2')
    assert r == {'alreadyUnready': False, 'playerNum': 2}
    assert g['phaseGate']['p2Ready'] is False
    assert g['phaseGate']['p1Ready'] is True


def test_record_unready_when_already_unready():
    g = _game()
    create_phase_gate(g, 'deploy_done')
    r = record_phase_gate_unready(g, 'u1')
    assert r == {'alreadyUnready': True, 'playerNum': 1}


def test_test_game_unready_pops_p2_first_then_p1():
    g = _game(test=True)
    create_phase_gate(g, 'cc_drawn')
    record_phase_gate_ready(g, 'u1')  # p1
    record_phase_gate_ready(g, 'u1')  # p2
    assert g['phaseGate']['p1Ready'] is True
    assert g['phaseGate']['p2Ready'] is True

    r1 = record_phase_gate_unready(g, 'u1')  # unready p2 first
    assert r1['playerNum'] == 2
    assert g['phaseGate']['p2Ready'] is False
    assert g['phaseGate']['p1Ready'] is True

    r2 = record_phase_gate_unready(g, 'u1')  # now unready p1
    assert r2['playerNum'] == 1
    assert g['phaseGate']['p1Ready'] is False


def test_clear_phase_gate_nulls_it():
    g = _game()
    create_phase_gate(g, 'deploy_done')
    clear_phase_gate(g)
    assert g['phaseGate'] is None


def test_player_num_from_id():
    g = _game(p1='alice', p2='bob')
    assert player_num_from_id(g, 'alice') == 1
    assert player_num_from_id(g, 'bob') == 2
    assert player_num_from_id(g, 'charlie') == 0
    assert player_num_from_id(g, '') == 0


def test_labels_are_stable():
    # Sanity: all expected phase keys present, no typos.
    expected = {
        'deploy_done', 'attach_done', 'cc_drawn',
        'pre_end_of_round', 'post_end_of_round',
        'post_start_of_round', 'pre_activation',
    }
    assert set(PHASE_GATE_LABELS.keys()) == expected


def test_no_gate_returns_empty_shape():
    g = _game()
    # Never created; record_ready should noop-return.
    r = record_phase_gate_ready(g, 'u1')
    assert r == {'alreadyReady': False, 'bothReady': False, 'playerNum': 0}


def main():
    cases = [
        ('create_installs_gate_with_defaults', test_create_installs_gate_with_defaults),
        ('record_ready_p1_then_p2', test_record_ready_p1_then_p2_both_ready_on_second),
        ('record_ready_duplicate_alreadyReady', test_record_ready_duplicate_returns_alreadyReady),
        ('test_game_p1_readies_both', test_test_game_p1_readies_for_both_sequentially),
        ('record_unready_flips_back', test_record_unready_flips_back),
        ('record_unready_already_unready', test_record_unready_when_already_unready),
        ('test_game_unready_pops_p2_first', test_test_game_unready_pops_p2_first_then_p1),
        ('clear_phase_gate_nulls_it', test_clear_phase_gate_nulls_it),
        ('player_num_from_id', test_player_num_from_id),
        ('labels_are_stable', test_labels_are_stable),
        ('no_gate_returns_empty_shape', test_no_gate_returns_empty_shape),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
