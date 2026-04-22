"""Tests for the cc_hand Discord handler."""
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
    from python.discord_bot.handlers import cc_hand as ch
    handlers.reset_for_tests()
    handlers.register('play_cc_', ch._handle_play_cc_from_hand, 'ccHand')
    handlers.register('cc_shuffle_draw_', ch._handle_cc_shuffle_draw, 'ccHand')
    handlers.register('cc_choice_', ch._handle_cc_choice, 'ccHand')
    handlers.register('cc_space_', ch._handle_cc_space, 'ccHand')


def _basic_game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_play_cc_from_hand_stages_confirmation():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['player1CcHand'] = ['Hold On', 'Focus', 'Reinforcements']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('play_cc_G1_1')
    result = handler(_Interaction('play_cc_G1_1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['card'] == 'Focus'
    pending = result['game'].data['pendingCcConfirmation']
    assert pending['card'] == 'Focus'
    assert pending['playerNum'] == 1


def test_play_cc_from_hand_rejects_out_of_range():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['player1CcHand'] = ['Hold On']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('play_cc_G1_9')
    result = handler(_Interaction('play_cc_G1_9', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'card_index_out_of_range'


def test_play_cc_from_hand_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('play_cc_G1_0')
    result = handler(_Interaction('play_cc_G1_0', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def test_cc_shuffle_draw_pulls_three():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['player1Squad'] = {'ccList': ['A', 'B', 'C', 'D', 'E']}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_shuffle_draw_G1')
    result = handler(_Interaction('cc_shuffle_draw_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert len(result['drew']) == 3


def test_cc_shuffle_draw_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_shuffle_draw_G1')
    result = handler(_Interaction('cc_shuffle_draw_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def test_cc_choice_parses_numeric_index():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCcChoice'] = {
        'abilityId': 'x', 'playerNum': 1,
        'choiceOptions': ['A', 'B', 'C'],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_choice_G1_1')
    result = handler(_Interaction('cc_choice_G1_1'), ctx)
    assert result['ok'] is True
    assert result['choiceIndex'] == 1


def test_cc_choice_resolves_label_to_index():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCcChoice'] = {
        'abilityId': 'x', 'playerNum': 1,
        'choiceOptions': ['Alpha', 'Beta', 'Gamma'],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_choice_G1_Beta')
    result = handler(_Interaction('cc_choice_G1_Beta'), ctx)
    assert result['ok'] is True
    assert result['choiceIndex'] == 1


def test_cc_choice_unknown_option():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCcChoice'] = {
        'abilityId': 'x', 'playerNum': 1, 'choiceOptions': ['A'],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_choice_G1_NoSuchOption')
    result = handler(_Interaction('cc_choice_G1_NoSuchOption'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'unknown_choice_option'


def test_cc_space_validates_against_valid_spaces():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCcSpaceChoice'] = {
        'abilityId': 'x', 'playerNum': 1,
        'validSpaces': ['a1', 'b2'],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_space_G1_z99')
    result = handler(_Interaction('cc_space_G1_z99'), ctx)
    assert result['ok'] is False
    # The stepper raises ValueError for invalid space
    assert result['reason'] == 'value_error'


def test_cc_space_commits_valid_space():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCcSpaceChoice'] = {
        'abilityId': 'unknown', 'playerNum': 1,
        'validSpaces': ['a1', 'b2'],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_space_G1_a1')
    result = handler(_Interaction('cc_space_G1_a1'), ctx)
    assert result['ok'] is True
    assert result['space'] == 'a1'


def main():
    cases = [
        ('play_cc_stages_confirm', test_play_cc_from_hand_stages_confirmation),
        ('play_cc_out_of_range', test_play_cc_from_hand_rejects_out_of_range),
        ('play_cc_non_player', test_play_cc_from_hand_rejects_non_player),
        ('cc_shuffle_draw_pulls_3', test_cc_shuffle_draw_pulls_three),
        ('cc_shuffle_draw_non_player', test_cc_shuffle_draw_rejects_non_player),
        ('cc_choice_numeric', test_cc_choice_parses_numeric_index),
        ('cc_choice_label', test_cc_choice_resolves_label_to_index),
        ('cc_choice_unknown', test_cc_choice_unknown_option),
        ('cc_space_invalid', test_cc_space_validates_against_valid_spaces),
        ('cc_space_valid', test_cc_space_commits_valid_space),
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
