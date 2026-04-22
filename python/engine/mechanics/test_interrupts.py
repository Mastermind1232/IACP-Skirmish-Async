"""Tests for interrupts.detect_post_move_interrupts.

Uses a 4-cell in-memory map to keep the path/adjacency trivial. Hostile
figure DCs are synthetic with monkeypatched keywords.

Run: python3 python/engine/mechanics/test_interrupts.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.data import dc_effects_loader, map_spaces_loader, map_tokens_loader
from python.engine.mechanics.interrupts import detect_post_move_interrupts


def _install(effects: dict, map_id: str = 'unit-test-map',
             spaces=None, tokens=None) -> None:
    dc_effects_loader._dc_effects = effects  # type: ignore[attr-defined]
    map_spaces_loader._map_spaces = {map_id: spaces or _basic_map()}  # type: ignore[attr-defined]
    map_tokens_loader._cache = {map_id: tokens or {}}  # type: ignore[attr-defined]


def _restore() -> None:
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()
    map_tokens_loader.reset_cache()


def _basic_map():
    return {
        'adjacency': {
            'a1': ['a2'], 'a2': ['a1', 'a3'], 'a3': ['a2', 'a4'], 'a4': ['a3'],
            'b1': [], 'b2': ['a2'], 'b3': ['a3'],
        },
        'blocking': [],
        'impassableEdges': [],
    }


def _base_game():
    return {
        'selectedMap': {'id': 'unit-test-map'},
        'openedDoors': [],
        'figurePositions': {1: {}, 2: {}},
        'p1DcMessageIds': [],
        'p2DcMessageIds': [],
        'p1DcList': [],
        'p2DcList': [],
    }


# ---------------------------------------------------------------------------

def test_empty_path_returns_no_triggers():
    _install({}, spaces=_basic_map())
    assert detect_post_move_interrupts(_base_game(), 1, 'L-1-0', None) == []
    assert detect_post_move_interrupts(_base_game(), 1, 'L-1-0', ['a1']) == []
    _restore()


def test_parting_blow_triggers_when_brawler_exits_adjacency():
    _install({'Wookiee Warrior': {'keywords': ['BRAWLER']}})
    g = _base_game()
    # Moving figure: P1 Luke at a1 → a3. Hostile Wookiee at a2 (between).
    g['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {'Wookiee Warrior-1-0': 'b2'},  # adjacent to a2 via b2->a2
    }
    g['player2CcHand'] = ['Parting Blow']
    # Path a1 → a2 → a3. Wookiee at b2 (adjacent to a2): was adj during a1→a2 step
    # (a2 adj includes b2? adjacency: a2 neighbors are a1, a3 — but b2 has a2 as neighbor).
    # Path walks:
    #   step0: exit a1, enter a2. Wookiee at b2, footprint b2.
    #     exit_adj for a1 = {a2}. enter_adj for a2 = {a1, a3}.
    #     was_adj: b2 in exit_adj? no. b2 == exiting(a1)? no. → wasAdjacent = False.
    #     still_adj: b2 in enter_adj? no. b2 == entering(a2)? no. → False.
    # Hmm this won't work. Let me reposition Wookiee at a2 itself won't work either since
    # that's on the path. Place Wookiee at b2 and adjust adjacency so b2 neighbors a2 AND a1.
    g['figurePositions'][2] = {'Wookiee Warrior-1-0': 'a2'}  # blocks the path
    # Actually for parting blow to trigger: Wookiee must be adjacent when moving out of a space,
    # then not adjacent after the step. Place Wookiee at a3 (adjacent to a2 and a4).
    # Moving a1 → a4: path a1, a2, a3, a4.
    # Step 2: exit a3, enter a4. Wookiee footprint {a3}. Wait, but Wookiee blocks movement.
    # For test, let's just use a separate adjacency net. Reset the setup:
    _restore()
    _install({'Wookiee Warrior': {'keywords': ['BRAWLER']}}, spaces={
        'adjacency': {
            'a1': ['a2', 'b1'], 'a2': ['a1', 'a3', 'b2'], 'a3': ['a2', 'a4', 'b3'],
            'a4': ['a3'], 'b1': ['a1', 'b2'], 'b2': ['a2', 'b1', 'b3'], 'b3': ['a3', 'b2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {'Wookiee Warrior-1-0': 'b2'},  # b2 is adjacent to a2
    }
    # Path: a1 → a2 → a3. Wookiee at b2.
    # Step 0: exit a1 (adj={a2, b1}), enter a2 (adj={a1, a3, b2}).
    #   Wookiee cell = b2. exit_adj contains b2? no (b2 not adj to a1). was_adj = False.
    #   enter_adj contains b2? yes. still_adj = True. → no parting blow.
    # Step 1: exit a2 (adj={a1,a3,b2}), enter a3 (adj={a2,a4,b3}).
    #   was_adj: b2 in exit_adj? yes → True.
    #   still_adj: b2 in enter_adj? no. b2 == a3? no. → False.
    #   → Parting Blow triggers!
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'a2', 'a3'])
    assert len(triggers) == 1
    assert triggers[0]['type'] == 'partingBlow'
    assert triggers[0]['cardName'] == 'Parting Blow'
    assert triggers[0]['candidatePlayerNum'] == 2
    assert triggers[0]['candidateDcName'] == 'Wookiee Warrior'
    assert triggers[0]['triggerSpace'] == 'a2'
    _restore()


def test_parting_blow_not_triggered_without_card_in_hand():
    _install({'Wookiee Warrior': {'keywords': ['BRAWLER']}}, spaces={
        'adjacency': {
            'a1': ['a2'], 'a2': ['a1', 'a3', 'b2'], 'a3': ['a2'], 'b2': ['a2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {'Wookiee Warrior-1-0': 'b2'},
    }
    g['player2CcHand'] = []  # no Parting Blow
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'a2', 'a3'])
    assert triggers == []
    _restore()


def test_parting_blow_once_per_move_only():
    _install({'Wookiee Warrior': {'keywords': ['BRAWLER']}}, spaces={
        'adjacency': {
            'a1': ['a2'], 'a2': ['a1', 'a3', 'b2'], 'a3': ['a2', 'a4', 'b3'],
            'a4': ['a3'], 'b2': ['a2'], 'b3': ['a3'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {
            'Wookiee Warrior-1-0': 'b2',  # adjacent to a2
            'Wookiee Warrior-1-1': 'b3',  # adjacent to a3
        },
    }
    g['player2CcHand'] = ['Parting Blow']
    # Moving a1 → a2 → a3 → a4. Two brawlers threaten distinct adjacencies.
    # Even though two figures each trigger once, parting blow is once per move.
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'a2', 'a3', 'a4'])
    parting_triggers = [t for t in triggers if t['type'] == 'partingBlow']
    assert len(parting_triggers) == 1
    _restore()


def test_dirty_trick_triggers_when_smuggler_enters_adjacency():
    _install({'Scum Smuggler': {'keywords': ['SMUGGLER']}}, spaces={
        'adjacency': {
            'a1': ['a2'], 'a2': ['a1', 'a3', 'b2'], 'a3': ['a2'], 'b2': ['a2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {
        1: {'Luke-1-0': 'a1'},
        2: {'Scum Smuggler-1-0': 'b2'},  # adj to a2
    }
    g['player2CcHand'] = ['Dirty Trick']
    # Moving a1 → a2: Luke enters adjacency of Smuggler.
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'a2'])
    assert len(triggers) == 1
    assert triggers[0]['type'] == 'dirtyTrick'
    assert triggers[0]['candidateDcName'] == 'Scum Smuggler'
    _restore()


def test_overwatch_triggers_on_entering_token_zone():
    _install({}, spaces={
        'adjacency': {'a1': ['a2'], 'a2': ['a1', 'a3'], 'a3': ['a2']},
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {1: {'Luke-1-0': 'a1'}, 2: {}}
    g['p2DcMessageIds'] = ['hl2dc0']
    g['p2DcList'] = [{'dcName': 'E-Web Engineer', 'displayName': 'E-Web Engineer [DG 1]'}]
    g['overwatchTokenPosition'] = {'hl2dc0': 'a2'}
    # Moving a1 → a2. was on/adj? exit_space=a1 not on/adj a2 (a1 != a2 and a1 not in enter_adj of a2? check).
    # exit_adj of a1 = {a2}. a2 in exit_adj → was_on_or_adj true → won't trigger.
    # Need to move from further away. Path a1 → a2 → a3. Step1: exit a2, enter a3. a3 != a2 but a2 in enter_adj of a3? yes. was_on_or_adj: exit=a2, a2==a2 → true. Skipped.
    # Hmm tricky. Step0: exit a1, enter a2. entering_space=a2 == norm_ow_space → true. was_on_or_adj: exit a1 == a2? no. a2 in exit_adj of a1? yes → was_on_or_adj=true. Skipped.
    # Need to enter the zone from outside. Add b1 which is not adjacent to a2.
    _restore()
    _install({}, spaces={
        'adjacency': {
            'a1': ['b1'], 'b1': ['a1', 'a2'], 'a2': ['b1', 'a3'], 'a3': ['a2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g['figurePositions'] = {1: {'Luke-1-0': 'a1'}, 2: {}}
    g['overwatchTokenPosition'] = {'hl2dc0': 'a3'}
    # Path a1 → b1 → a2 → a3. Token at a3. entering a2: a2 != a3, a3 in enter_adj of a2? yes → on/adj.
    # was_on_or_adj: exit=b1, a3 == b1? no. a3 in exit_adj of b1 = {a1, a2}? no. → false. Triggers!
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'b1', 'a2', 'a3'])
    ow_triggers = [t for t in triggers if t['type'] == 'overwatch']
    assert len(ow_triggers) == 1
    assert ow_triggers[0]['owMsgId'] == 'hl2dc0'
    assert ow_triggers[0]['owTokenSpace'] == 'a3'
    _restore()


def test_overwatch_exhausted_does_not_trigger():
    _install({}, spaces={
        'adjacency': {
            'a1': ['b1'], 'b1': ['a1', 'a2'], 'a2': ['b1', 'a3'], 'a3': ['a2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {1: {'Luke-1-0': 'a1'}, 2: {}}
    g['p2DcMessageIds'] = ['hl2dc0']
    g['p2DcList'] = [{'dcName': 'E-Web Engineer'}]
    g['overwatchTokenPosition'] = {'hl2dc0': 'a3'}
    g['exhaustedSkirmishUpgrades'] = {'hl2dc0': ['Overwatch']}
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'b1', 'a2', 'a3'])
    assert not any(t['type'] == 'overwatch' for t in triggers)
    _restore()


def test_no_trigger_when_moving_player_owns_overwatch():
    """Own overwatch never triggers against own movement."""
    _install({}, spaces={
        'adjacency': {
            'a1': ['b1'], 'b1': ['a1', 'a2'], 'a2': ['b1', 'a3'], 'a3': ['a2'],
        },
        'blocking': [], 'impassableEdges': [],
    })
    g = _base_game()
    g['figurePositions'] = {1: {'Luke-1-0': 'a1'}, 2: {}}
    g['p1DcMessageIds'] = ['hl1dc0']  # token owned by moving player
    g['p1DcList'] = [{'dcName': 'E-Web Engineer'}]
    g['overwatchTokenPosition'] = {'hl1dc0': 'a3'}
    triggers = detect_post_move_interrupts(g, 1, 'Luke-1-0', ['a1', 'b1', 'a2', 'a3'])
    assert not any(t['type'] == 'overwatch' for t in triggers)
    _restore()


def main():
    cases = [
        ('empty_path', test_empty_path_returns_no_triggers),
        ('parting_blow_brawler_exits', test_parting_blow_triggers_when_brawler_exits_adjacency),
        ('parting_blow_no_card_no_trigger', test_parting_blow_not_triggered_without_card_in_hand),
        ('parting_blow_once_per_move', test_parting_blow_once_per_move_only),
        ('dirty_trick_smuggler_enters', test_dirty_trick_triggers_when_smuggler_enters_adjacency),
        ('overwatch_enter_zone', test_overwatch_triggers_on_entering_token_zone),
        ('overwatch_exhausted_noop', test_overwatch_exhausted_does_not_trigger),
        ('overwatch_own_movement_noop', test_no_trigger_when_moving_player_owns_overwatch),
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
