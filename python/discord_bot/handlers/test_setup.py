"""Tests for the setup Discord handler."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Interaction:
    def __init__(self, custom_id, user_id='alice'):
        self.custom_id = custom_id
        self.user = _User(user_id)


def _fresh_registry():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import setup as stp
    handlers.reset_for_tests()
    handlers.register('map_confirm_', stp._handle_map_confirm, 'setup')
    handlers.register('map_goback_', stp._handle_map_goback, 'setup')
    handlers.register('map_type_', stp._handle_map_type_choice, 'setup')
    handlers.register('deployment_zone_', stp._handle_deployment_zone, 'setup')
    handlers.register('draft_random_', stp._handle_draft_random, 'setup')
    handlers.register('determine_initiative_', stp._handle_determine_initiative, 'setup')
    handlers.register('deployment_done_', stp._handle_deployment_done, 'setup')


def _new_game(**overrides):
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data.update(overrides)
    return g


def test_map_confirm_advances_phase():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game(selectedMap={'id': 'x'})
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('map_confirm_G1')
    result = handler(_Interaction('map_confirm_G1'), ctx)
    assert result['ok'] is True
    assert result['phase'] == 'initiative'
    assert result['game'].data.get('mapSelected') is True


def test_map_confirm_rejects_no_selection():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('map_confirm_G1')
    result = handler(_Interaction('map_confirm_G1'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'value_error'


def test_map_goback_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game(selectedMap={'id': 'x'}, selectedMission={'variant': 'a'})
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('map_goback_G1')
    result = handler(_Interaction('map_goback_G1'), ctx)
    assert result['ok'] is True
    assert 'selectedMap' not in result['game'].data


def test_map_type_choice_records():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('map_type_random_G1')
    result = handler(_Interaction('map_type_random_G1'), ctx)
    assert result['ok'] is True
    assert result['selectionType'] == 'random'
    assert result['game'].data.get('mapSelectionType') == 'random'


def test_deployment_zone_rejects_non_initiative_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game(initiativePlayerId='alice')
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('deployment_zone_red_G1')
    result = handler(_Interaction('deployment_zone_red_G1', user_id='bob'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_initiative_player'


def test_deployment_zone_happy_path():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game(initiativePlayerId='alice')
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('deployment_zone_blue_G1')
    result = handler(_Interaction('deployment_zone_blue_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['zone'] == 'blue'
    assert result['game'].data['deploymentZoneChosen'] == 'blue'


def test_draft_random_requires_squad_in_ctx():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('draft_random_G1')
    result = handler(_Interaction('draft_random_G1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_random_squad_in_ctx'


def test_draft_random_applies_squad():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    squad = {'name': 'RandomRebel', 'dcList': ['Luke']}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'random_squad': squad,
    }
    _, handler, _ = find_handler('draft_random_G1')
    result = handler(_Interaction('draft_random_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['game'].data['player1Squad'] == squad
    assert result['game'].data['p1DraftedRandom'] is True


def test_determine_initiative_requires_ctx():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('determine_initiative_G1')
    result = handler(_Interaction('determine_initiative_G1'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_initiative_player_in_ctx'


def test_determine_initiative_sets():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'initiative_player_num': 2,
    }
    _, handler, _ = find_handler('determine_initiative_G1')
    result = handler(_Interaction('determine_initiative_G1'), ctx)
    assert result['ok'] is True
    assert result['game'].data['initiativePlayerId'] == 'bob'


def test_deployment_done_marks_player_and_completes():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game(initiativeHolder=1)
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('deployment_done_G1')
    r1 = handler(_Interaction('deployment_done_G1', user_id='alice'), ctx)
    assert r1['ok'] is True
    assert r1['bothDeployed'] is False
    store['G1'] = r1['game']
    r2 = handler(_Interaction('deployment_done_G1', user_id='bob'), ctx)
    assert r2['bothDeployed'] is True


def test_deployment_done_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('deployment_done_G1')
    result = handler(_Interaction('deployment_done_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def main():
    cases = [
        ('map_confirm_advances', test_map_confirm_advances_phase),
        ('map_confirm_rejects_empty', test_map_confirm_rejects_no_selection),
        ('map_goback_clears', test_map_goback_clears_pending),
        ('map_type_choice_records', test_map_type_choice_records),
        ('deployment_zone_rejects_non_init', test_deployment_zone_rejects_non_initiative_player),
        ('deployment_zone_happy', test_deployment_zone_happy_path),
        ('draft_random_requires_ctx', test_draft_random_requires_squad_in_ctx),
        ('draft_random_applies', test_draft_random_applies_squad),
        ('determine_init_requires_ctx', test_determine_initiative_requires_ctx),
        ('determine_init_sets', test_determine_initiative_sets),
        ('deploy_done_both', test_deployment_done_marks_player_and_completes),
        ('deploy_done_rejects_non_player', test_deployment_done_rejects_non_player),
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
