"""Tests for npc.apply_npc_damage_to_figure + find_dc_msg_id_for_figure."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.npc import (
    apply_npc_damage_to_figure,
    find_dc_msg_id_for_figure,
)


def _meta(mid, game_id, pn, dc, dg=1):
    return (mid, {
        'gameId': game_id, 'playerNum': pn, 'dcName': dc,
        'displayName': f'{dc} [DG {dg}]',
    })


def test_find_dc_msg_id_for_figure_happy_path():
    g = {'gameId': 'g1'}
    meta = [_meta('hl1dc0', 'g1', 1, 'Luke')]
    assert find_dc_msg_id_for_figure(g, 1, 'Luke-1-0', meta) == 'hl1dc0'


def test_find_dc_msg_id_for_figure_wrong_game():
    g = {'gameId': 'g1'}
    meta = [_meta('hl1dc0', 'g2', 1, 'Luke')]  # different game
    assert find_dc_msg_id_for_figure(g, 1, 'Luke-1-0', meta) is None


def test_find_dc_msg_id_for_figure_wrong_dg():
    g = {'gameId': 'g1'}
    meta = [_meta('hl1dc0', 'g1', 1, 'Stormtrooper', dg=1)]
    # Looking up DG 2 stormtrooper
    assert find_dc_msg_id_for_figure(g, 1, 'Stormtrooper-2-0', meta) is None


def test_find_dc_msg_id_for_figure_empty_meta():
    assert find_dc_msg_id_for_figure({}, 1, 'Luke-1-0', None) is None
    assert find_dc_msg_id_for_figure({}, 1, 'Luke-1-0', []) is None


def test_apply_npc_damage_reduces_hp_logs_survival():
    g = {'gameId': 'g1', 'player1VP': None, 'p1DcMessageIds': ['hl1dc0'],
         'p1DcList': [{'dcName': 'Luke', 'healthState': [[10, 10]]}]}
    hs = {'hl1dc0': [[10, 10]]}
    meta = [_meta('hl1dc0', 'g1', 1, 'Luke')]
    r = apply_npc_damage_to_figure(g, 1, 'Luke-1-0', 2, 'Thug', hs, meta)
    assert r['applied'] is True
    assert r['newHp'] == 8
    assert r['maxHp'] == 10
    assert r['wasDefeated'] is False
    assert '2 damage' in r['logMessage']
    assert '8/10' in r['logMessage']


def test_apply_npc_damage_defeat_flag():
    g = {'gameId': 'g1', 'p1DcMessageIds': ['hl1dc0'],
         'p1DcList': [{'dcName': 'Luke', 'healthState': [[2, 10]]}]}
    hs = {'hl1dc0': [[2, 10]]}
    meta = [_meta('hl1dc0', 'g1', 1, 'Luke')]
    r = apply_npc_damage_to_figure(g, 1, 'Luke-1-0', 5, 'Krykna', hs, meta)
    assert r['applied'] is True
    assert r['newHp'] == 0
    assert r['wasDefeated'] is True
    assert 'defeated' in r['logMessage']


def test_apply_npc_damage_no_matching_meta_returns_fallback():
    g = {'gameId': 'g1'}
    hs = {}
    r = apply_npc_damage_to_figure(g, 1, 'Luke-1-0', 2, 'Thug', hs, [])
    assert r['applied'] is False
    assert r['msgId'] is None
    assert 'update DC card manually' in r['logMessage']


def main():
    cases = [
        ('find_msg_id_happy', test_find_dc_msg_id_for_figure_happy_path),
        ('find_msg_id_wrong_game', test_find_dc_msg_id_for_figure_wrong_game),
        ('find_msg_id_wrong_dg', test_find_dc_msg_id_for_figure_wrong_dg),
        ('find_msg_id_empty_meta', test_find_dc_msg_id_for_figure_empty_meta),
        ('apply_damage_survival', test_apply_npc_damage_reduces_hp_logs_survival),
        ('apply_damage_defeat', test_apply_npc_damage_defeat_flag),
        ('apply_damage_no_meta_fallback', test_apply_npc_damage_no_matching_meta_returns_fallback),
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
