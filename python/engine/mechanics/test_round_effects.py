"""Tests for apply_start_of_round_dc_effects / apply_end_of_round_dc_effects."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _fresh_game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_brush_ezra_grants_4_mp():
    from python.engine.mechanics.round_effects import apply_start_of_round_dc_effects
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Ezra Bridger': {
            'specialAbilityIds': ['brush_ezra'],
            'figures': 1, 'speed': 4, 'health': 8, 'cost': 10, 'affiliation': 'Rebel',
        },
    }
    try:
        g = _fresh_game()
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Ezra Bridger', 'dgIndex': 0}]
        events = apply_start_of_round_dc_effects(g)
        assert len(events) == 1
        assert events[0]['abilityId'] == 'brush_ezra'
        assert events[0]['playerNum'] == 1
        assert events[0]['msgId'] == 'hl1dc0'
        assert events[0]['mpGranted'] == 4
        bank = (g.data.get('movementBank') or {}).get('hl1dc0')
        assert bank is not None
        assert bank.get('total') == 4 or bank.get('remaining') == 4
    finally:
        dc_effects_loader.reset_cache()


def test_brush_ezra_skips_when_defeated():
    from python.engine.mechanics.round_effects import apply_start_of_round_dc_effects
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Ezra Bridger': {'specialAbilityIds': ['brush_ezra'], 'figures': 1},
    }
    try:
        g = _fresh_game()
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Ezra Bridger', 'dgIndex': 0, 'defeated': True}]
        events = apply_start_of_round_dc_effects(g)
        assert events == []
        assert 'hl1dc0' not in (g.data.get('movementBank') or {})
    finally:
        dc_effects_loader.reset_cache()


def test_brush_ezra_fires_for_both_players():
    from python.engine.mechanics.round_effects import apply_start_of_round_dc_effects
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Ezra Bridger': {'specialAbilityIds': ['brush_ezra'], 'figures': 1},
    }
    try:
        g = _fresh_game()
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Ezra Bridger', 'dgIndex': 0}]
        g.data['p2DcMessageIds'] = ['hl2dc0']
        g.data['p2DcList'] = [{'dcName': 'Ezra Bridger', 'dgIndex': 0}]
        events = apply_start_of_round_dc_effects(g)
        assert len(events) == 2
        players = sorted(e['playerNum'] for e in events)
        assert players == [1, 2]
    finally:
        dc_effects_loader.reset_cache()


def test_no_effects_when_no_brush_dc():
    from python.engine.mechanics.round_effects import apply_start_of_round_dc_effects
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Luke': {'specialAbilityIds': ['son_of_skywalker'], 'figures': 1},
    }
    try:
        g = _fresh_game()
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Luke', 'dgIndex': 0}]
        events = apply_start_of_round_dc_effects(g)
        assert events == []
    finally:
        dc_effects_loader.reset_cache()


def test_end_of_round_is_placeholder():
    from python.engine.mechanics.round_effects import apply_end_of_round_dc_effects
    g = _fresh_game()
    assert apply_end_of_round_dc_effects(g) == []


def test_end_start_of_round_stepper_wires_dc_events():
    from python.engine.stepper import Action, step
    from python.engine.actions import ActionType
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Ezra Bridger': {'specialAbilityIds': ['brush_ezra'], 'figures': 1},
    }
    try:
        g = _fresh_game()
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Ezra Bridger', 'dgIndex': 0}]
        g.data['startOfRoundWhoseTurn'] = 'alice'
        new_g = step(g, Action(type=ActionType.END_START_OF_ROUND, player=1))
        events = new_g.data.get('lastStartOfRoundDcEvents') or []
        assert any(e.get('abilityId') == 'brush_ezra' for e in events)
        assert new_g.data.get('startOfRoundWhoseTurn') is None
    finally:
        dc_effects_loader.reset_cache()


def main():
    cases = [
        ('brush_ezra_grants_4mp', test_brush_ezra_grants_4_mp),
        ('brush_ezra_skips_defeated', test_brush_ezra_skips_when_defeated),
        ('brush_ezra_both_players', test_brush_ezra_fires_for_both_players),
        ('no_effects_no_brush', test_no_effects_when_no_brush_dc),
        ('eor_placeholder', test_end_of_round_is_placeholder),
        ('stepper_wires_events', test_end_start_of_round_stepper_wires_dc_events),
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
