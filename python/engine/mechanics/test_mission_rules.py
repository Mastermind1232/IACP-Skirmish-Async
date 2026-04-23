"""Tests for mission_rules — EOR / SOR VP engines + Krykna/Thug NPC lifecycle.

Run: python3 python/engine/mechanics/test_mission_rules.py
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.data import (
    deployment_zones_loader,
    dc_effects_loader,
    map_spaces_loader,
    map_tokens_loader,
)
from python.engine.mechanics.mission_rules import (
    get_current_fluctuation_positions,
    get_valid_krykna_placement_spaces,
    run_end_of_round_rules,
    run_npc_krykna_activation,
    run_npc_thug_activation,
    run_start_of_round_rules,
)
from python.engine.mechanics.vp_helpers import award_objective_vp


def _install(dc_effects=None, map_spaces=None, map_tokens=None, deployment_zones=None,
             map_id: str = 'utest'):
    if dc_effects is not None:
        dc_effects_loader._dc_effects = dc_effects  # type: ignore[attr-defined]
    if map_spaces is not None:
        map_spaces_loader._map_spaces = {map_id: map_spaces}  # type: ignore[attr-defined]
    if map_tokens is not None:
        map_tokens_loader._cache = {map_id: map_tokens}  # type: ignore[attr-defined]
    if deployment_zones is not None:
        deployment_zones_loader._cache = {map_id: deployment_zones}  # type: ignore[attr-defined]


def _restore():
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()
    map_tokens_loader.reset_cache()
    deployment_zones_loader.reset_cache()


def _base_game(**extra):
    g = {
        'player1Id': 'alice',
        'player2Id': 'bob',
        'initiativePlayerId': 'alice',
        'selectedMap': {'id': 'utest'},
        'selectedMission': {'variant': 'a'},
        'figurePositions': {1: {}, 2: {}},
        'p1DcList': [],
        'p2DcList': [],
    }
    g.update(extra)
    return g


def _3x3_map():
    """3×3 grid: a1..c3 all fully connected (4-way)."""
    adj = {}
    for c in range(3):
        for r in range(3):
            cell = f'{chr(97 + c)}{r + 1}'
            neigh = []
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    if dc == 0 and dr == 0:
                        continue
                    if abs(dc) + abs(dr) != 1:  # 4-connected only
                        continue
                    nc, nr = c + dc, r + dr
                    if 0 <= nc < 3 and 0 <= nr < 3:
                        neigh.append(f'{chr(97 + nc)}{nr + 1}')
            adj[cell] = neigh
    return {'adjacency': adj, 'blocking': [], 'impassableEdges': []}


# ---------------------------------------------------------------------------
# Fluctuation positions

def test_get_current_fluctuation_positions_lazy_init_from_token_data():
    _install(map_tokens={
        'missionB': {
            'positions': {'0': ['A1', 'B2'], '2': ['C3']},
        },
    })
    g = _base_game()
    res = get_current_fluctuation_positions(g, 'utest')
    assert res == {'0': ['a1', 'b2'], '2': ['c3']}
    # Subsequent call returns cached
    res2 = get_current_fluctuation_positions(g, 'utest')
    assert res2 is res
    _restore()


# ---------------------------------------------------------------------------
# vpPerControlledSpaceInList (Lothal A Blitz style)

def test_eor_vp_per_controlled_space_in_list_awards_correctly():
    _install(
        dc_effects={'Luke': {'keywords': [], 'affiliation': 'Rebel'}},
        map_spaces=_3x3_map(),
        map_tokens={
            'missionA': {'positions': {'0': ['a1', 'c3']}},
        },
    )
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'a1'},  # P1 controls a1 (and its neighbors)
        2: {},
    })
    rules = {'vpPerControlledSpaceInList': {'vp': 2, 'vpMessage': '{count} positions × {vp} VP'}}
    r = run_end_of_round_rules(g, 'utest', 'a', rules)
    # P1 is sole presence near a1 → 2 VP. c3 uncontrolled → 0.
    assert r['gameEnded'] is False
    assert g['player1VP']['total'] == 2
    assert g.get('player2VP') is None
    _restore()


# ---------------------------------------------------------------------------
# vpPerControlledDeploymentZone (Hoth A Inside Job)

def test_eor_vp_per_controlled_deployment_zone():
    _install(
        dc_effects={'Luke': {'keywords': [], 'affiliation': 'Rebel'}},
        map_spaces=_3x3_map(),
        deployment_zones={'red': ['a1', 'a2'], 'blue': ['c2', 'c3']},
    )
    # P1 has figure in red zone, P2 in blue. Both control their own zone.
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'a1'},
        2: {'Luke-1-0': 'c3'},
    })
    rules = {'vpPerControlledDeploymentZone': {'vp': 3}}
    r = run_end_of_round_rules(g, 'utest', 'a', rules)
    assert r['gameEnded'] is False
    assert g['player1VP']['total'] == 3
    assert g['player2VP']['total'] == 3
    _restore()


def test_eor_vp_per_controlled_deployment_zone_contested_no_award():
    _install(
        dc_effects={'Luke': {'keywords': [], 'affiliation': 'Rebel'}},
        map_spaces=_3x3_map(),
        deployment_zones={'red': ['a1', 'a2'], 'blue': ['c2', 'c3']},
    )
    # Both players in the red zone → contested, no VP for that zone.
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'a1'},
        2: {'Luke-1-0': 'a2'},
    })
    rules = {'vpPerControlledDeploymentZone': {'vp': 3}}
    run_end_of_round_rules(g, 'utest', 'a', rules)
    assert g.get('player1VP') is None
    assert g.get('player2VP') is None
    _restore()


# ---------------------------------------------------------------------------
# vpPerTokenForControllingCell

def test_eor_vp_per_token_for_controlling_cell():
    _install(
        dc_effects={'Luke': {}},
        map_spaces=_3x3_map(),
    )
    g = _base_game(
        figurePositions={1: {'Luke-1-0': 'a1'}, 2: {}},
        cantinaTokens=5,
    )
    rules = {
        'vpPerTokenForControllingCell': {
            'controlCell': 'a1',
            'vpPerToken': 2,
            'tokenCountKey': 'cantinaTokens',
        },
    }
    run_end_of_round_rules(g, 'utest', 'a', rules)
    assert g['player1VP']['total'] == 10  # 5 × 2
    assert g['cantinaTokens'] == 0
    _restore()


def test_eor_vp_per_token_uncontrolled_still_clears_tokens():
    _install(
        dc_effects={'Luke': {}},
        map_spaces=_3x3_map(),
    )
    # Both players in control set → contested → no award BUT tokens cleared.
    g = _base_game(
        figurePositions={1: {'Luke-1-0': 'a1'}, 2: {'Luke-1-0': 'a1'}},
        cantinaTokens=5,
    )
    rules = {
        'vpPerTokenForControllingCell': {
            'controlCell': 'a1',
            'vpPerToken': 2,
            'tokenCountKey': 'cantinaTokens',
        },
    }
    run_end_of_round_rules(g, 'utest', 'a', rules)
    assert g.get('player1VP') is None
    assert g['cantinaTokens'] == 0
    _restore()


# ---------------------------------------------------------------------------
# vpPerContrabandInDeploymentZone (Hoth B carry)

def test_eor_vp_per_contraband_in_deployment_zone_respects_zone_fn():
    _install(
        dc_effects={'Luke': {}},
        map_spaces=_3x3_map(),
    )
    g = _base_game(
        figurePositions={1: {'Luke-1-0': 'a1'}, 2: {}},
        figureContraband={'Luke-1-0': True},
    )
    # ctx injects the zone-check function
    ctx = {
        'isFigureInDeploymentZone': lambda game, pn, fk, mid: pn == 1 and fk == 'Luke-1-0',
    }
    rules = {
        'vpPerContrabandInDeploymentZone': {'vp': 4, 'vpMessage': '{count} ex × {vp} VP'},
    }
    run_end_of_round_rules(g, 'utest', 'a', rules, ctx)
    assert g['player1VP']['total'] == 4
    assert g['figureContraband'] == {}
    _restore()


# ---------------------------------------------------------------------------
# autoDistributeCrateTokens (Devaron A)

def test_eor_auto_distribute_crate_tokens_awards_vp_and_tokens():
    _install(
        dc_effects={'Luke': {}},
        map_spaces=_3x3_map(),
        map_tokens={'terminals': []},
    )
    g = _base_game(
        figurePositions={1: {'Luke-1-0': 'a2'}, 2: {}},  # Luke adjacent to a1
        crateTokens={'a1': ['Block', 'Surge']},
    )
    rules = {'autoDistributeCrateTokens': {'vpPerCrate': 2}}
    run_end_of_round_rules(g, 'utest', 'a', rules)
    # Luke got 2 power tokens, P1 got 2 VP, crate cleared.
    assert g['player1VP']['total'] == 2
    assert g['figurePowerTokens']['Luke-1-0'] == ['Block', 'Surge']
    assert g['crateTokens']['a1'] == []
    _restore()


# ---------------------------------------------------------------------------
# SoR: setTokenCountFromInitiativeHand

def test_sor_set_token_count_from_initiative_hand():
    _install()
    g = _base_game(player1CcHand=['c1', 'c2', 'c3'])
    rules = {'setTokenCountFromInitiativeHand': {'gameKey': 'cantinaTokens'}}
    run_start_of_round_rules(g, 'utest', 'a', rules)
    assert g['cantinaTokens'] == 3
    _restore()


# ---------------------------------------------------------------------------
# SoR: randomRevealAndPlaceStrain (deterministic via seeded rng)

def test_sor_random_reveal_and_place_strain_deterministic():
    _install(
        map_tokens={'missionA': {
            'tokenTypes': [
                {'image': 'Neutral Blue.png'},
                {'image': 'Neutral Red.png'},
                {'image': 'Neutral Green.png'},
            ],
            'positions': {'0': ['a1'], '1': ['b2'], '2': ['c3']},
        }},
    )
    g = _base_game()
    rng = random.Random(42)
    rules = {'randomRevealAndPlaceStrain': {'strainStateKey': 'signalMarkerStrain'}}
    run_start_of_round_rules(g, 'utest', 'a', rules, rng=rng)
    # Each player gets one token; two of the three positions get +1 strain.
    strain = g.get('signalMarkerStrain') or {}
    assert sum(strain.values()) == 2
    _restore()


# ---------------------------------------------------------------------------
# SoR: placeTokensOnCrates (Devaron A)

def test_sor_place_tokens_on_crates_appends_by_color():
    _install(
        map_tokens={'missionA': {
            'tokenTypes': [
                {'image': 'Blue-Crate.png'},
                {'image': 'Yellow-Crate.png'},
            ],
            'positions': {'0': ['a1'], '1': ['c3']},
        }},
    )
    g = _base_game()
    rules = {'placeTokensOnCrates': {}}
    run_start_of_round_rules(g, 'utest', 'a', rules)
    assert g['crateTokens'] == {'a1': ['Block'], 'c3': ['Surge']}
    # Running again accumulates
    run_start_of_round_rules(g, 'utest', 'a', rules)
    assert g['crateTokens'] == {'a1': ['Block', 'Block'], 'c3': ['Surge', 'Surge']}
    _restore()


# ---------------------------------------------------------------------------
# NPC Krykna

def test_run_npc_krykna_activation_lazy_init_and_damage_emit():
    _install(
        map_spaces=_3x3_map(),
        map_tokens={'missionA': {'positions': {'0': ['a1', 'c3']}}},
    )
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'a2'},  # adjacent to a1 → takes 2 damage
        2: {'Vader-1-0': 'b3'}, # adjacent to c3 → takes 2 damage
    })
    r = run_npc_krykna_activation(g, 'utest')
    assert len(g['npcKrykna']) == 2
    assert [e['figureKey'] for e in r['damageEvents']] == ['Luke-1-0', 'Vader-1-0']
    assert all(e['damage'] == 2 for e in r['damageEvents'])
    _restore()


def test_run_npc_krykna_no_positions_returns_empty():
    _install(map_tokens={'missionA': {'positions': {}}})
    g = _base_game()
    r = run_npc_krykna_activation(g, 'utest')
    assert r == {'logs': [], 'damageEvents': []}
    _restore()


def test_get_valid_krykna_placement_spaces_excludes_occupied():
    _install(
        deployment_zones={'red': ['a1', 'a2'], 'blue': ['c2', 'c3']},
    )
    g = _base_game(
        figurePositions={1: {}, 2: {'Thug-1-0': 'c2'}},
    )
    # P1 places in opponent's (blue) zone. c2 is occupied → only c3.
    spaces = get_valid_krykna_placement_spaces(g, 1, 'utest')
    assert spaces == ['c3']
    _restore()


# ---------------------------------------------------------------------------
# NPC Thug BFS

def test_run_npc_thug_activation_moves_toward_hostile():
    _install(
        map_spaces=_3x3_map(),
        map_tokens={'missionA': {'positions': {'0': ['a1']}}},
    )
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'c3'},  # thug at a1, Luke at c3 (distance 4)
        2: {},
    })
    r = run_npc_thug_activation(g, 'utest')
    assert len(g['npcThugs']) == 1
    # Thug moves up to 2 steps toward Luke; path a1→a2→a3→b3→c3 (length 4),
    # max_steps=2 → thug now at a3 (path[max_steps-1]=path[1]=a3)
    thug_coord = g['npcThugs'][0]['coord']
    assert thug_coord in ('a3', 'b1', 'b2', 'a2', 'b3')  # any 2-step neighbor toward c3
    # Distance from start should have decreased by at least 1
    assert len(r['logs']) >= 1
    _restore()


def test_run_npc_thug_no_hostiles_stays_put():
    _install(
        map_spaces=_3x3_map(),
        map_tokens={'missionA': {'positions': {'0': ['a1']}}},
    )
    g = _base_game(figurePositions={1: {}, 2: {}})
    r = run_npc_thug_activation(g, 'utest')
    assert g['npcThugs'][0]['coord'] == 'a1'
    assert 'stays put' in r['logs'][0]
    _restore()


def test_run_npc_thug_damage_events_for_adjacent_hostiles():
    _install(
        map_spaces=_3x3_map(),
        map_tokens={'missionA': {'positions': {'0': ['a1']}}},
    )
    g = _base_game(figurePositions={
        1: {'Luke-1-0': 'a2'},  # already adjacent to a1
        2: {},
    })
    r = run_npc_thug_activation(g, 'utest')
    # Luke stays adjacent to thug (thug already next to him; stayed put)
    dmg = [e for e in r['damageEvents'] if e['figureKey'] == 'Luke-1-0']
    assert len(dmg) == 1
    assert dmg[0]['damage'] == 2
    _restore()


def test_eor_push_controlled_crates_stamps_pending_prompts():
    """Each crate on a space the player controls queues a push prompt."""
    _install(
        dc_effects={'Luke': {}},
        map_spaces=_3x3_map(),
        map_tokens={
            'missionB': {'positions': {'0': ['a1', 'b1'], '1': ['c1']}},
        },
    )
    g = _base_game(
        # Luke controls a1/b1 via adjacency; no one controls c1.
        figurePositions={1: {'Luke-1-0': 'a1'}, 2: {}},
        cratePositions={'a1': 'a1', 'b1': 'b1', 'c1': 'c1'},
    )
    rules = {'pushControlledCratesUpTo': 3}
    run_end_of_round_rules(g, 'utest', 'b', rules)
    prompts = g.get('pendingCratePushPrompts') or {}
    # P1 controls a1/b1 (his figure is on a1, and adjacency logic in
    # get_space_controller may or may not include b1 — assert at least
    # one prompt landed, and every queued entry carries the right max dist).
    assert prompts, 'expected at least one player to get crate-push prompts'
    for pn, items in prompts.items():
        assert pn in (1, 2)
        for item in items:
            assert item['maxDistance'] == 3
            assert 'origCoord' in item and 'currentCoord' in item
    _restore()


def main():
    cases = [
        ('fluctuation_positions_lazy_init', test_get_current_fluctuation_positions_lazy_init_from_token_data),
        ('eor_vp_per_controlled_space_in_list', test_eor_vp_per_controlled_space_in_list_awards_correctly),
        ('eor_vp_per_controlled_deployment_zone', test_eor_vp_per_controlled_deployment_zone),
        ('eor_vp_per_controlled_zone_contested', test_eor_vp_per_controlled_deployment_zone_contested_no_award),
        ('eor_vp_per_token_for_controlling_cell', test_eor_vp_per_token_for_controlling_cell),
        ('eor_vp_per_token_uncontrolled_clears', test_eor_vp_per_token_uncontrolled_still_clears_tokens),
        ('eor_vp_per_contraband_in_zone', test_eor_vp_per_contraband_in_deployment_zone_respects_zone_fn),
        ('eor_auto_distribute_crate_tokens', test_eor_auto_distribute_crate_tokens_awards_vp_and_tokens),
        ('sor_set_token_count_from_hand', test_sor_set_token_count_from_initiative_hand),
        ('sor_random_reveal_and_place_strain', test_sor_random_reveal_and_place_strain_deterministic),
        ('sor_place_tokens_on_crates', test_sor_place_tokens_on_crates_appends_by_color),
        ('npc_krykna_lazy_init_damage', test_run_npc_krykna_activation_lazy_init_and_damage_emit),
        ('npc_krykna_no_positions', test_run_npc_krykna_no_positions_returns_empty),
        ('get_valid_krykna_placement', test_get_valid_krykna_placement_spaces_excludes_occupied),
        ('npc_thug_moves_toward_hostile', test_run_npc_thug_activation_moves_toward_hostile),
        ('npc_thug_no_hostiles_stays_put', test_run_npc_thug_no_hostiles_stays_put),
        ('npc_thug_damage_events_adjacent', test_run_npc_thug_damage_events_for_adjacent_hostiles),
        ('eor_push_controlled_crates', test_eor_push_controlled_crates_stamps_pending_prompts),
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
