"""Tests for the cc_hand Discord handler."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Channel:
    def __init__(self, cid): self.id = cid


class _Interaction:
    def __init__(self, custom_id, user_id='alice', values=None, channel_id=None):
        self.custom_id = custom_id
        self.user = _User(user_id)
        if values is not None:
            self.values = values
        if channel_id is not None:
            self.channel = _Channel(channel_id)


def _fresh_registry():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import cc_hand as ch
    handlers.reset_for_tests()
    handlers.register('play_cc_', ch._handle_play_cc_from_hand, 'ccHand')
    handlers.register('cc_shuffle_draw_', ch._handle_cc_shuffle_draw, 'ccHand')
    handlers.register('cc_choice_', ch._handle_cc_choice, 'ccHand')
    handlers.register('cc_space_', ch._handle_cc_space, 'ccHand')
    handlers.register('cc_discard_select_', ch._handle_cc_discard_select, 'ccHand')
    handlers.register('cc_play_select_', ch._handle_cc_play_select, 'ccHand')
    handlers.register('squad_cancel_', ch._handle_squad_cancel, 'ccHand')
    handlers.register('cc_draw_', ch._handle_cc_draw, 'ccHand')
    handlers.register('cc_close_discard_', ch._handle_cc_close_discard, 'ccHand')
    handlers.register('negation_let_resolve_', ch._handle_negation_let_resolve, 'ccHand')


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


def test_cc_discard_select_moves_card():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_CHANNEL_P1'
    g.data['player1CcHand'] = ['Hold On', 'Focus', 'Reinforcements']
    g.data['player1CcDiscard'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_discard_select_G1')
    result = handler(
        _Interaction('cc_discard_select_G1', user_id='alice',
                      values=['Focus'], channel_id='HAND_CHANNEL_P1'),
        ctx,
    )
    assert result['ok'] is True
    assert result['card'] == 'Focus'
    assert result['playerNum'] == 1
    assert 'Focus' not in g.data['player1CcHand']
    assert 'Focus' in g.data['player1CcDiscard']


def test_cc_discard_select_wrong_channel():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['p2HandId'] = 'HAND_P2'
    g.data['player1CcHand'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_discard_select_G1')
    result = handler(
        _Interaction('cc_discard_select_G1', user_id='alice',
                      values=['Focus'], channel_id='SOME_OTHER_CHANNEL'),
        ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'wrong_channel'


def test_cc_discard_select_card_not_in_hand():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcHand'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_discard_select_G1')
    result = handler(
        _Interaction('cc_discard_select_G1', user_id='alice',
                      values=['Reinforcements'], channel_id='HAND_P1'),
        ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'card_not_in_hand'


def test_cc_play_select_stages_confirmation():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcHand'] = ['Hold On', 'Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_play_select_G1')
    result = handler(
        _Interaction('cc_play_select_G1', user_id='alice',
                      values=['Focus'], channel_id='HAND_P1'),
        ctx,
    )
    assert result['ok'] is True
    assert result['card'] == 'Focus'
    pending = g.data.get('pendingCcConfirmation') or {}
    assert pending.get('card') == 'Focus'
    assert pending.get('playerNum') == 1


def test_cc_play_select_wrong_channel():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['p2HandId'] = 'HAND_P2'
    g.data['player1CcHand'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_play_select_G1')
    result = handler(
        _Interaction('cc_play_select_G1', user_id='alice',
                      values=['Focus'], channel_id='NOT_HAND'),
        ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'wrong_channel'


def test_squad_cancel_drops_pending_entry():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    pending_squad = {'G1_1': {'timestamp': 123, 'squadString': 'Luke + Chewie'}}
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'pending_squad_confirm': pending_squad,
    }
    _, handler, _ = find_handler('squad_cancel_G1_1')
    result = handler(_Interaction('squad_cancel_G1_1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['cleared'] is True
    assert 'G1_1' not in pending_squad


def test_squad_cancel_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'pending_squad_confirm': {},
    }
    _, handler, _ = find_handler('squad_cancel_G1_1')
    result = handler(_Interaction('squad_cancel_G1_1', user_id='bob'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_owner'


def test_cc_draw_pulls_top_card_from_deck():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcDeck'] = ['Focus', 'Hold On', 'Reinforcements']
    g.data['player1CcHand'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_draw_G1')
    result = handler(
        _Interaction('cc_draw_G1', user_id='alice', channel_id='HAND_P1'), ctx,
    )
    assert result['ok'] is True
    assert result['card'] == 'Focus'
    assert result['deckRemaining'] == 2
    assert g.data['player1CcHand'] == ['Focus']
    assert g.data['player1CcDeck'] == ['Hold On', 'Reinforcements']


def test_cc_draw_empty_deck():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcDeck'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_draw_G1')
    result = handler(
        _Interaction('cc_draw_G1', user_id='alice', channel_id='HAND_P1'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'deck_empty'


def test_cc_close_discard_parses():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('cc_close_discard_G1_1')
    result = handler(_Interaction('cc_close_discard_G1_1'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'
    assert result['playerNum'] == 1


def test_cc_close_discard_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('cc_close_discard_G1_xyz')
    result = handler(_Interaction('cc_close_discard_G1_xyz'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_negation_let_resolve_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingNegation'] = {'card': 'Focus', 'playedBy': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('negation_let_resolve_G1')
    result = handler(_Interaction('negation_let_resolve_G1'), ctx)
    assert result['ok'] is True
    assert result['clearedCard'] == 'Focus'
    assert 'pendingNegation' not in g.data


def test_negation_let_resolve_no_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('negation_let_resolve_G1')
    result = handler(_Interaction('negation_let_resolve_G1'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_pending_negation'


def test_cc_draw_wrong_channel():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcDeck'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_draw_G1')
    result = handler(
        _Interaction('cc_draw_G1', user_id='alice', channel_id='NOT_HAND'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'wrong_channel'


def test_squad_cancel_no_pending_is_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'pending_squad_confirm': {},
    }
    _, handler, _ = find_handler('squad_cancel_G1_1')
    result = handler(_Interaction('squad_cancel_G1_1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['cleared'] is False


def test_cc_play_select_card_not_in_hand():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcHand'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_play_select_G1')
    result = handler(
        _Interaction('cc_play_select_G1', user_id='alice',
                      values=['Reinforcements'], channel_id='HAND_P1'),
        ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'card_not_in_hand'


def test_cc_discard_select_empty_values():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1HandId'] = 'HAND_P1'
    g.data['player1CcHand'] = ['Focus']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('cc_discard_select_G1')
    result = handler(
        _Interaction('cc_discard_select_G1', user_id='alice',
                      values=[], channel_id='HAND_P1'),
        ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'no_card_selected'


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
        ('cc_discard_select_moves', test_cc_discard_select_moves_card),
        ('cc_discard_select_wrong_channel', test_cc_discard_select_wrong_channel),
        ('cc_discard_select_not_in_hand', test_cc_discard_select_card_not_in_hand),
        ('cc_discard_select_no_value', test_cc_discard_select_empty_values),
        ('cc_play_select_stages', test_cc_play_select_stages_confirmation),
        ('cc_play_select_wrong_channel', test_cc_play_select_wrong_channel),
        ('cc_play_select_not_in_hand', test_cc_play_select_card_not_in_hand),
        ('squad_cancel_drops', test_squad_cancel_drops_pending_entry),
        ('squad_cancel_non_owner', test_squad_cancel_rejects_non_owner),
        ('squad_cancel_no_pending', test_squad_cancel_no_pending_is_ok),
        ('cc_draw_pulls', test_cc_draw_pulls_top_card_from_deck),
        ('cc_draw_empty', test_cc_draw_empty_deck),
        ('cc_draw_wrong_channel', test_cc_draw_wrong_channel),
        ('cc_close_discard_parses', test_cc_close_discard_parses),
        ('cc_close_discard_malformed', test_cc_close_discard_malformed),
        ('negation_let_resolve_clears', test_negation_let_resolve_clears_pending),
        ('negation_let_resolve_no_pending', test_negation_let_resolve_no_pending),
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
