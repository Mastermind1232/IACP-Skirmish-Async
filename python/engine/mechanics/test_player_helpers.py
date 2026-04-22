"""Tests for player_helpers — opponent/initiative, getters/setters,
recompute_activation_counts, figure mutations, dcMatchesPlayableBy.

Run: python3 python/engine/mechanics/test_player_helpers.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.player_helpers import (
    dc_matches_playable_by,
    get_activated_dc_indices,
    get_cc_hand,
    get_dc_list,
    get_dc_message_ids,
    get_initiative_player_num,
    opponent_player_num,
    push_figure,
    recompute_activation_counts,
    remove_figure_position,
    set_activated_dc_indices,
    set_activations_remaining,
    set_activations_total,
    sum_squad_dc_cost,
    sync_health_state_to_list,
)


def test_opponent_player_num():
    assert opponent_player_num(1) == 2
    assert opponent_player_num(2) == 1


def test_get_initiative_player_num():
    g = {'initiativePlayerId': 'alice', 'player1Id': 'alice', 'player2Id': 'bob'}
    assert get_initiative_player_num(g) == 1
    g = {'initiativePlayerId': 'bob', 'player1Id': 'alice', 'player2Id': 'bob'}
    assert get_initiative_player_num(g) == 2


def test_per_player_getters_route_by_pn():
    g = {
        'p1DcList': ['Luke'],
        'p2DcList': ['Vader'],
        'p1DcMessageIds': ['m1'],
        'p2DcMessageIds': ['m2'],
        'player1CcHand': ['CC1'],
        'player2CcHand': ['CC2'],
        'p1ActivatedDcIndices': [0],
        'p2ActivatedDcIndices': [1],
    }
    assert get_dc_list(g, 1) == ['Luke']
    assert get_dc_list(g, 2) == ['Vader']
    assert get_dc_message_ids(g, 1) == ['m1']
    assert get_cc_hand(g, 2) == ['CC2']
    assert get_activated_dc_indices(g, 1) == [0]


def test_setters():
    g = {}
    set_activations_remaining(g, 1, 3)
    set_activations_total(g, 2, 5)
    set_activated_dc_indices(g, 1, [0, 2])
    assert g['p1ActivationsRemaining'] == 3
    assert g['p2ActivationsTotal'] == 5
    assert g['p1ActivatedDcIndices'] == [0, 2]


def test_sum_squad_dc_cost_simple():
    stats = {
        'Luke Skywalker': {'cost': 12},
        '[Deadly]': {'cost': 2},
        'Rebel Trooper (Regular)': {'cost': 3},
    }
    def lookup(name): return stats.get(name)
    squad = {'dcList': ['Luke Skywalker', 'Deadly', 'Rebel Trooper']}
    # Deadly uses [Deadly]; Rebel Trooper uses (Regular) fallback
    assert sum_squad_dc_cost(squad, lookup) == 12 + 2 + 3


def test_sum_squad_dc_cost_missing_cost_noop():
    def lookup(name): return {'foo': 'bar'}  # no 'cost' key
    assert sum_squad_dc_cost({'dcList': ['Any']}, lookup) == 0


def test_recompute_activation_counts_basic():
    g = {
        'p1DcList': [{'dcName': 'Luke'}, {'dcName': 'Han'}, {'dcName': '[Extra Armor]'}],
        'figurePositions': {1: {'Luke-1-0': 'a1', 'Han-1-0': 'b2'}},
        'p1ActivatedDcIndices': [0],
    }
    r = recompute_activation_counts(g, 1)
    # 2 activatable DCs (skirmish upgrade skipped), 1 activated → remaining = 1
    assert r == {'total': 2, 'remaining': 1}
    assert g['p1ActivationsTotal'] == 2
    assert g['p1ActivationsRemaining'] == 1


def test_recompute_activation_counts_figureless_dc_not_counted():
    g = {
        'p1DcList': [{'dcName': 'Luke'}, {'dcName': 'Han'}],
        'figurePositions': {1: {'Luke-1-0': 'a1'}},  # Han has no figures → not counted
        'p1ActivatedDcIndices': [],
    }
    r = recompute_activation_counts(g, 1)
    assert r == {'total': 1, 'remaining': 1}


def test_recompute_activation_counts_duplicate_dc_names_get_dg_suffixes():
    g = {
        'p1DcList': [{'dcName': 'Stormtrooper'}, {'dcName': 'Stormtrooper'}],
        'figurePositions': {1: {
            'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'a2', 'Stormtrooper-1-2': 'a3',
            'Stormtrooper-2-0': 'b1', 'Stormtrooper-2-1': 'b2', 'Stormtrooper-2-2': 'b3',
        }},
        'p1ActivatedDcIndices': [0],
    }
    r = recompute_activation_counts(g, 1)
    assert r == {'total': 2, 'remaining': 1}


def test_sync_health_state_to_list():
    g = {
        'p1DcMessageIds': ['m1', 'm2'],
        'p1DcList': [{'dcName': 'Luke'}, {'dcName': 'Han'}],
    }
    sync_health_state_to_list(g, 1, 'm2', [[5, 6]])
    assert g['p1DcList'][1]['healthState'] == [[5, 6]]
    # Unknown msgId is silent noop
    sync_health_state_to_list(g, 1, 'm99', [[1]])
    assert g['p1DcList'][0].get('healthState') is None


def test_remove_figure_position_cleans_all_state():
    g = {
        'figurePositions': {1: {'Luke-1-0': 'a1'}},
        'deviceTokens': {'Luke-1-0': ['foo']},
        'figureConditions': {'Luke-1-0': ['Stun']},
    }
    remove_figure_position(g, 1, 'Luke-1-0')
    assert 'Luke-1-0' not in g['figurePositions'][1]
    assert 'Luke-1-0' not in g['deviceTokens']
    assert 'Luke-1-0' not in g['figureConditions']


def test_push_figure_returns_prev_and_new():
    g = {'figurePositions': {1: {'Luke-1-0': 'a1'}}}
    r = push_figure(g, 1, 'Luke-1-0', 'B2')
    assert r == {'prevPos': 'a1', 'newPos': 'b2'}
    assert g['figurePositions'][1]['Luke-1-0'] == 'b2'


def test_push_figure_ghost_returns_none():
    g = {'figurePositions': {1: {}}}
    assert push_figure(g, 1, 'ghost', 'a1') is None
    assert push_figure({}, 1, 'ghost', 'a1') is None


def test_dc_matches_playable_by_any_figure():
    assert dc_matches_playable_by('Luke', '', None, None, {}) is True
    assert dc_matches_playable_by('Luke', 'any figure', None, None, {}) is True


def test_dc_matches_playable_by_name_match():
    effs = lambda: {'Luke Skywalker': {'keywords': [], 'affiliation': 'Rebel'}}
    assert dc_matches_playable_by('Luke Skywalker', 'Luke Skywalker', effs, None, {}) is True


def test_dc_matches_playable_by_unique():
    effs = lambda: {'Luke': {'unique': True, 'keywords': []}}
    assert dc_matches_playable_by('Luke', 'unique', effs, None, {}) is True
    effs2 = lambda: {'Trooper': {'unique': False, 'keywords': []}}
    assert dc_matches_playable_by('Trooper', 'unique', effs2, None, {}) is False


def test_dc_matches_playable_by_affiliation_and_keyword():
    effs = lambda: {'Rebel Trooper': {'affiliation': 'Rebel', 'keywords': ['Trooper']}}
    assert dc_matches_playable_by('Rebel Trooper', 'Rebel Trooper', effs, None, {}) is True
    assert dc_matches_playable_by('Rebel Trooper', 'Rebel', effs, None, {}) is True
    assert dc_matches_playable_by('Rebel Trooper', 'Imperial Trooper', effs, None, {}) is False


def test_dc_matches_playable_by_alternatives():
    effs = lambda: {'Han Solo': {'affiliation': 'Rebel', 'keywords': ['Smuggler']}}
    assert dc_matches_playable_by('Han Solo', 'Wookiee or Smuggler', effs, None, {}) is True


def main():
    cases = [
        ('opponent_player_num', test_opponent_player_num),
        ('get_initiative_player_num', test_get_initiative_player_num),
        ('per_player_getters_route_by_pn', test_per_player_getters_route_by_pn),
        ('setters', test_setters),
        ('sum_squad_dc_cost_simple', test_sum_squad_dc_cost_simple),
        ('sum_squad_dc_cost_missing_cost_noop', test_sum_squad_dc_cost_missing_cost_noop),
        ('recompute_activation_counts_basic', test_recompute_activation_counts_basic),
        ('recompute_figureless_not_counted', test_recompute_activation_counts_figureless_dc_not_counted),
        ('recompute_duplicate_dc_names', test_recompute_activation_counts_duplicate_dc_names_get_dg_suffixes),
        ('sync_health_state_to_list', test_sync_health_state_to_list),
        ('remove_figure_position_cleans_all_state', test_remove_figure_position_cleans_all_state),
        ('push_figure_returns_prev_and_new', test_push_figure_returns_prev_and_new),
        ('push_figure_ghost_returns_none', test_push_figure_ghost_returns_none),
        ('dc_matches_playable_by_any_figure', test_dc_matches_playable_by_any_figure),
        ('dc_matches_playable_by_name_match', test_dc_matches_playable_by_name_match),
        ('dc_matches_playable_by_unique', test_dc_matches_playable_by_unique),
        ('dc_matches_playable_by_affiliation_and_keyword', test_dc_matches_playable_by_affiliation_and_keyword),
        ('dc_matches_playable_by_alternatives', test_dc_matches_playable_by_alternatives),
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
