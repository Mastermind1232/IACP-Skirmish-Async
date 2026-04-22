"""Tests for interact.resolve_interact_option — all 4 option types + errors."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.data import dc_effects_loader, map_spaces_loader
from python.engine.mechanics.interact import (
    UnknownInteractOption,
    resolve_interact_option,
)


def _install():
    dc_effects_loader._dc_effects = {'Luke': {}}  # type: ignore[attr-defined]
    map_spaces_loader._map_spaces = {'utest': {  # type: ignore[attr-defined]
        'adjacency': {'a1': ['a2'], 'a2': ['a1', 'b2'], 'b2': ['a2']},
        'blocking': [], 'impassableEdges': [],
    }}


def _restore():
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_retrieve_contraband_sets_carrying_flag():
    _install()
    g = {'figurePositions': {1: {'Luke-1-0': 'a1'}}, 'selectedMap': {'id': 'utest'}}
    r = resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'retrieve_contraband')
    assert g['figureContraband'] == {'Luke-1-0': True}
    assert r['appliedEffect'] == 'retrieve_contraband'
    assert 'Luke-1-0' in r['logMessage']
    assert r['undoSnapshot']['previousContraband'] is None
    _restore()


def test_retrieve_contraband_consumes_dropped_space_if_adjacent():
    _install()
    g = {
        'figurePositions': {1: {'Luke-1-0': 'a1'}},
        'selectedMap': {'id': 'utest'},
        'droppedContrabandSpaces': ['a2', 'c3'],  # a2 adjacent, c3 far
    }
    resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'retrieve_contraband')
    # Only c3 should remain — a2 was consumed as the first adjacent hit
    assert g['droppedContrabandSpaces'] == ['c3']
    _restore()


def test_launch_panel_colored_flips_and_marks_flipped_this_round():
    _install()
    g = {'figurePositions': {1: {'Luke-1-0': 'a1'}}, 'selectedMap': {'id': 'utest'}}
    r = resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'launch_panel_a2_colored')
    assert g['launchPanelState'] == {'a2': 'colored'}
    assert g['p1LaunchPanelFlippedThisRound'] is True
    assert g.get('p2LaunchPanelFlippedThisRound') is None
    assert r['appliedEffect'] == 'launch_panel'
    assert r['launchPanelCoord'] == 'a2'
    _restore()


def test_launch_panel_gray_for_p2():
    _install()
    g = {'figurePositions': {2: {'Vader-1-0': 'a1'}}, 'selectedMap': {'id': 'utest'}}
    resolve_interact_option(g, 2, 'Vader-1-0', 'utest', 'launch_panel_b2_gray')
    assert g['launchPanelState'] == {'b2': 'gray'}
    assert g['p2LaunchPanelFlippedThisRound'] is True
    _restore()


def test_launch_panel_malformed_raises():
    _install()
    g = {}
    try:
        resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'launch_panel_a2')
    except UnknownInteractOption:
        pass
    else:
        raise AssertionError('expected UnknownInteractOption')
    _restore()


def test_use_terminal_logs_no_state_mutation():
    _install()
    g = {}
    r = resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'use_terminal')
    assert r['appliedEffect'] == 'use_terminal'
    # No state change expected; mission_rules handles terminal-control VP.
    assert g == {}
    _restore()


def test_open_door_single_edge():
    _install()
    g = {}
    r = resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'open_door_a1|a2')
    assert g['openedDoors'] == ['a1|a2']
    assert r['appliedEffect'] == 'open_door'
    assert 'A1–A2' in r['logMessage']
    _restore()


def test_open_door_multi_edge_all_opened():
    _install()
    g = {}
    r = resolve_interact_option(
        g, 1, 'Luke-1-0', 'utest', 'open_door_a1|a2,b1|b2',
    )
    assert g['openedDoors'] == ['a1|a2', 'b1|b2']
    assert r['undoSnapshot']['previousOpenedDoors'] == []
    _restore()


def test_open_door_deduplicates_existing_edges():
    _install()
    g = {'openedDoors': ['a1|a2']}
    resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'open_door_a1|a2,b1|b2')
    assert g['openedDoors'] == ['a1|a2', 'b1|b2']  # no duplicate
    _restore()


def test_unknown_option_raises():
    _install()
    g = {}
    try:
        resolve_interact_option(g, 1, 'Luke-1-0', 'utest', 'nonsense_option')
    except UnknownInteractOption:
        pass
    else:
        raise AssertionError('expected UnknownInteractOption')
    _restore()


def main():
    cases = [
        ('retrieve_contraband_sets_flag', test_retrieve_contraband_sets_carrying_flag),
        ('retrieve_contraband_consumes_dropped', test_retrieve_contraband_consumes_dropped_space_if_adjacent),
        ('launch_panel_colored_p1', test_launch_panel_colored_flips_and_marks_flipped_this_round),
        ('launch_panel_gray_p2', test_launch_panel_gray_for_p2),
        ('launch_panel_malformed_raises', test_launch_panel_malformed_raises),
        ('use_terminal_no_mutation', test_use_terminal_logs_no_state_mutation),
        ('open_door_single_edge', test_open_door_single_edge),
        ('open_door_multi_edge', test_open_door_multi_edge_all_opened),
        ('open_door_dedup', test_open_door_deduplicates_existing_edges),
        ('unknown_option_raises', test_unknown_option_raises),
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
