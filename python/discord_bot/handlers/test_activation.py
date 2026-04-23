"""Tests for the activation Discord handler."""
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
    from python.discord_bot.handlers import activation as act
    handlers.reset_for_tests()
    handlers.register('activate_dc_', act._handle_activate_dc, 'activation')
    handlers.register('pass_activation_turn_', act._handle_pass_activation_turn, 'activation')
    handlers.register('end_activation_phase_', act._handle_end_activation_phase, 'activation')
    handlers.register('dc_end_activation_', act._handle_dc_end_activation, 'activation')
    handlers.register('end_turn_', act._handle_end_turn, 'activation')
    handlers.register('cancel_activate_', act._handle_cancel_activate, 'activation')
    handlers.register('hair_trigger_skip_', act._handle_hair_trigger_skip, 'activation')
    handlers.register('iwba_skip_', act._handle_iwba_skip, 'activation')
    handlers.register('scav_weapon_transfer_', act._handle_scav_weapon_transfer, 'activation')
    handlers.register('heroic_effort_return_', act._handle_heroic_effort_return, 'activation')
    handlers.register('dc_switch_fig_', act._handle_dc_switch_fig, 'activation')


def _game_with_rebel_trooper(round_phase='activation'):
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader._dc_effects = {
        'Rebel Trooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3,
            'affiliation': 'Rebel',
        },
    }
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'a2': ['a1']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [],
    }}
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['phase'] = 'round_active'
    g.data['roundPhase'] = round_phase
    g.data['activePlayer'] = 1
    g.data['activationsRemaining'] = {1: 1, 2: 1}
    g.data['activeFigureKeys'] = []
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {},
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Rebel Trooper (Regular)', 'dgIndex': 0}]
    return g


def _cleanup():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_activate_dc_happy_path():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('activate_dc_G1_hl1dc0_0')
        result = handler(_Interaction('activate_dc_G1_hl1dc0_0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['playerNum'] == 1
        assert 'Rebel Trooper' in result['dcName']
        assert result['game'].data['activeFigureKeys']
    finally:
        _cleanup()


def test_activate_dc_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('activate_dc_G1_hl1dc0_0')
        result = handler(_Interaction('activate_dc_G1_hl1dc0_0', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner_of_dc'
    finally:
        _cleanup()


def test_activate_dc_malformed_custom_id():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('activate_dc_nope')
    result = handler(_Interaction('activate_dc_nope'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_pass_activation_turn_swaps_active_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('pass_activation_turn_G1')
        result = handler(_Interaction('pass_activation_turn_G1', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_activation_phase_transitions_round():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activationsRemaining'] = {1: 0, 2: 0}
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_activation_phase_G1')
        result = handler(_Interaction('end_activation_phase_G1'), ctx)
        assert result['ok'] is True
    finally:
        _cleanup()


def test_dc_end_activation_clears_active_and_swaps():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
        g.data['movementPoints'] = 3
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('dc_end_activation_G1_hl1dc0')
        result = handler(_Interaction('dc_end_activation_G1_hl1dc0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['activeFigureKeys'] == []
        assert result['game'].data['movementPoints'] == 0
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_turn_clears_pending_and_ends_activation():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
        g.data['pendingEndTurn'] = {'hl1dc0': {'displayName': 'Rebel Trooper'}}
        g.data['movementBank'] = {'hl1dc0': {'total': 4, 'remaining': 2}}
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_turn_G1_hl1dc0')
        result = handler(_Interaction('end_turn_G1_hl1dc0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['pendingEndTurn'] is None
        assert result['game'].data['movementBank'] is None
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_turn_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_turn_G1_hl1dc0')
        result = handler(_Interaction('end_turn_G1_hl1dc0', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner_of_dc'
    finally:
        _cleanup()


def test_cancel_activate_owner_ok_and_non_owner_blocked():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('cancel_activate_G1_alice')
    ok = handler(_Interaction('cancel_activate_G1_alice', user_id='alice'), {})
    assert ok['ok'] is True
    assert ok['ownerId'] == 'alice'
    nope = handler(_Interaction('cancel_activate_G1_alice', user_id='bob'), {})
    assert nope['ok'] is False
    assert nope['reason'] == 'not_owner'


def test_cancel_activate_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('cancel_activate_')
    # Empty tail → re.match fails → malformed.
    result = handler(_Interaction('cancel_activate_'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_hair_trigger_skip_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('hair_trigger_skip_G1_Luke-0-0')
    result = handler(_Interaction('hair_trigger_skip_G1_Luke-0-0'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'


def test_iwba_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingItWillBeAlright'] = {'figureKey': 'Cassian-0-0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('iwba_skip_G1_Cassian-0-0')
    result = handler(_Interaction('iwba_skip_G1_Cassian-0-0'), ctx)
    assert result['ok'] is True
    assert 'pendingItWillBeAlright' not in g.data


def test_scav_weapon_transfer_applies():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingScavengedWeaponryTransfer'] = {
        'playerNum': 1,
        'eligible': [
            {'msgId': 'hl1dc0', 'displayName': 'Rebel Trooper [DG 1]'},
            {'msgId': 'hl1dc1', 'displayName': 'Rebel Saboteur [DG 1]'},
        ],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('scav_weapon_transfer_G1_1_1')
    result = handler(
        _Interaction('scav_weapon_transfer_G1_1_1', user_id='alice'), ctx,
    )
    assert result['ok'] is True
    assert result['targetMsgId'] == 'hl1dc1'
    atts = g.data['p1DcAttachments']
    assert atts['hl1dc1'] == ['Scavenged Weaponry']
    assert g.data.get('pendingScavengedWeaponryTransfer') is None


def test_scav_weapon_transfer_rejects_wrong_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingScavengedWeaponryTransfer'] = {
        'playerNum': 2, 'eligible': [{'msgId': 'hl2dc0'}],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('scav_weapon_transfer_G1_1_0')
    result = handler(
        _Interaction('scav_weapon_transfer_G1_1_0', user_id='alice'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'no_pending_transfer'


def test_heroic_effort_return_moves_to_bottom():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingHeroicEffortReturn'] = {1: True}
    g.data['player1CcHand'] = ['A', 'B', 'C']
    g.data['player1CcDeck'] = ['D', 'E']
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('heroic_effort_return_G1_1_1')  # 'B'
    result = handler(
        _Interaction('heroic_effort_return_G1_1_1', user_id='alice'), ctx,
    )
    assert result['ok'] is True
    assert result['card'] == 'B'
    assert g.data['player1CcHand'] == ['A', 'C']
    assert g.data['player1CcDeck'] == ['D', 'E', 'B']
    # Pending cleared entirely (last entry)
    assert 'pendingHeroicEffortReturn' not in g.data


def test_heroic_effort_return_preserves_other_player_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingHeroicEffortReturn'] = {1: True, 2: True}
    g.data['player1CcHand'] = ['A']
    g.data['player1CcDeck'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('heroic_effort_return_G1_1_0')
    result = handler(
        _Interaction('heroic_effort_return_G1_1_0', user_id='alice'), ctx,
    )
    assert result['ok'] is True
    # Player 2 pending still present
    assert g.data['pendingHeroicEffortReturn'] == {2: True}


def test_dc_switch_fig_clears_selected_figure():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['dcActionsData'] = {
        'hl1dc0': {'selectedFigure': 'Luke-0-1', 'remaining': 2},
    }
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1, 'dcName': 'Luke'},
        },
    }
    _, handler, _ = find_handler('dc_switch_fig_hl1dc0')
    result = handler(_Interaction('dc_switch_fig_hl1dc0', user_id='alice'), ctx)
    assert result['ok'] is True
    assert g.data['dcActionsData']['hl1dc0']['selectedFigure'] is None
    # Remaining count preserved
    assert g.data['dcActionsData']['hl1dc0']['remaining'] == 2


def test_dc_switch_fig_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['dcActionsData'] = {'hl1dc0': {'selectedFigure': 'Luke-0-0'}}
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1, 'dcName': 'Luke'},
        },
    }
    _, handler, _ = find_handler('dc_switch_fig_hl1dc0')
    result = handler(_Interaction('dc_switch_fig_hl1dc0', user_id='bob'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_owner'


def test_dc_switch_fig_missing_meta():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None,
           'dc_message_meta': {}}
    _, handler, _ = find_handler('dc_switch_fig_hl1dc0')
    result = handler(_Interaction('dc_switch_fig_hl1dc0'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'msg_id_meta_missing'


def test_heroic_effort_return_no_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('heroic_effort_return_G1_1_0')
    result = handler(
        _Interaction('heroic_effort_return_G1_1_0', user_id='alice'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'no_pending_heroic_effort'


def test_scav_weapon_transfer_out_of_range():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['pendingScavengedWeaponryTransfer'] = {
        'playerNum': 1, 'eligible': [{'msgId': 'hl1dc0'}],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('scav_weapon_transfer_G1_1_5')
    result = handler(
        _Interaction('scav_weapon_transfer_G1_1_5', user_id='alice'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'target_index_out_of_range'


def test_iwba_skip_malformed_no_figure_key():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('iwba_skip_G1')
    result = handler(_Interaction('iwba_skip_G1'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def main():
    cases = [
        ('activate_dc_happy', test_activate_dc_happy_path),
        ('activate_dc_rejects_non_owner', test_activate_dc_rejects_non_owner),
        ('activate_dc_malformed', test_activate_dc_malformed_custom_id),
        ('pass_activation_swaps', test_pass_activation_turn_swaps_active_player),
        ('end_activation_phase_transitions', test_end_activation_phase_transitions_round),
        ('dc_end_activation_clears_and_swaps', test_dc_end_activation_clears_active_and_swaps),
        ('end_turn_clears_pending', test_end_turn_clears_pending_and_ends_activation),
        ('end_turn_rejects_non_owner', test_end_turn_rejects_non_owner),
        ('cancel_activate_owner_gate', test_cancel_activate_owner_ok_and_non_owner_blocked),
        ('cancel_activate_malformed', test_cancel_activate_malformed),
        ('hair_trigger_skip_ok', test_hair_trigger_skip_ok),
        ('iwba_skip_clears', test_iwba_skip_clears_pending),
        ('iwba_skip_malformed', test_iwba_skip_malformed_no_figure_key),
        ('scav_weapon_transfer_applies', test_scav_weapon_transfer_applies),
        ('scav_weapon_transfer_wrong_player', test_scav_weapon_transfer_rejects_wrong_player),
        ('scav_weapon_transfer_out_of_range', test_scav_weapon_transfer_out_of_range),
        ('heroic_effort_return_bottom', test_heroic_effort_return_moves_to_bottom),
        ('heroic_effort_return_preserves_other', test_heroic_effort_return_preserves_other_player_pending),
        ('heroic_effort_return_no_pending', test_heroic_effort_return_no_pending),
        ('dc_switch_fig_clears', test_dc_switch_fig_clears_selected_figure),
        ('dc_switch_fig_non_owner', test_dc_switch_fig_rejects_non_owner),
        ('dc_switch_fig_missing_meta', test_dc_switch_fig_missing_meta),
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
