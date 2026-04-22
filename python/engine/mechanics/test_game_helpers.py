"""Tests for game_helpers: grant_movement_bank + get_player_deployment_zones.

Run: python3 python/engine/mechanics/test_game_helpers.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.game_helpers import (
    get_player_deployment_zones,
    grant_movement_bank,
)


def test_grant_movement_bank_creates_entry():
    g = {}
    grant_movement_bank(g, 'hl1dc0', 3)
    assert g['movementBank'] == {'hl1dc0': {'total': 3, 'remaining': 3}}


def test_grant_movement_bank_accumulates():
    g = {'movementBank': {'hl1dc0': {'total': 4, 'remaining': 2}}}
    grant_movement_bank(g, 'hl1dc0', 2)
    assert g['movementBank']['hl1dc0'] == {'total': 6, 'remaining': 4}


def test_grant_movement_bank_noop_on_zero():
    g = {}
    grant_movement_bank(g, 'hl1dc0', 0)
    assert 'movementBank' not in g


def test_grant_movement_bank_noop_on_empty_msgid():
    g = {}
    grant_movement_bank(g, '', 3)
    grant_movement_bank(g, None, 3)
    assert 'movementBank' not in g


def test_grant_movement_bank_independent_msgids():
    g = {}
    grant_movement_bank(g, 'hl1dc0', 2)
    grant_movement_bank(g, 'hl1dc1', 5)
    assert g['movementBank']['hl1dc0'] == {'total': 2, 'remaining': 2}
    assert g['movementBank']['hl1dc1'] == {'total': 5, 'remaining': 5}


def test_get_player_deployment_zones_p1_initiative_red():
    g = {'deploymentZoneChosen': 'red'}
    assert get_player_deployment_zones(g, 1) == {'p1Zone': 'red', 'p2Zone': 'blue'}


def test_get_player_deployment_zones_p1_initiative_blue():
    g = {'deploymentZoneChosen': 'blue'}
    assert get_player_deployment_zones(g, 1) == {'p1Zone': 'blue', 'p2Zone': 'red'}


def test_get_player_deployment_zones_p2_initiative():
    # P2 has initiative, chose red → P2 gets red, P1 gets blue
    g = {'deploymentZoneChosen': 'red'}
    assert get_player_deployment_zones(g, 2) == {'p1Zone': 'blue', 'p2Zone': 'red'}

    g = {'deploymentZoneChosen': 'blue'}
    assert get_player_deployment_zones(g, 2) == {'p1Zone': 'red', 'p2Zone': 'blue'}


def test_get_player_deployment_zones_unchosen_defaults_to_blue_other():
    # If chosen is None/undefined, JS `=== 'red'` is false so `other` becomes 'red'.
    g = {}
    result = get_player_deployment_zones(g, 1)
    # p1 gets `chosen` (None), p2 gets 'red' (since p1Zone != 'red'... actually
    # p1Zone is None, so p2Zone = None != 'red' → 'red'). Verify exact JS shape.
    assert result == {'p1Zone': None, 'p2Zone': 'red'}


def main():
    cases = [
        ('grant_movement_bank_creates_entry', test_grant_movement_bank_creates_entry),
        ('grant_movement_bank_accumulates', test_grant_movement_bank_accumulates),
        ('grant_movement_bank_noop_on_zero', test_grant_movement_bank_noop_on_zero),
        ('grant_movement_bank_noop_on_empty_msgid', test_grant_movement_bank_noop_on_empty_msgid),
        ('grant_movement_bank_independent_msgids', test_grant_movement_bank_independent_msgids),
        ('get_player_deployment_zones_p1_red', test_get_player_deployment_zones_p1_initiative_red),
        ('get_player_deployment_zones_p1_blue', test_get_player_deployment_zones_p1_initiative_blue),
        ('get_player_deployment_zones_p2_initiative', test_get_player_deployment_zones_p2_initiative),
        ('get_player_deployment_zones_unchosen_defaults', test_get_player_deployment_zones_unchosen_defaults_to_blue_other),
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
