"""Tests for dc_play_area Discord handler."""
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
    from python.discord_bot.handlers import dc_play_area as dp
    handlers.reset_for_tests()
    handlers.register('dc_action_', dp._handle_dc_action, 'dcPlayArea')
    handlers.register('dc_special_', dp._handle_dc_special, 'dcPlayArea')
    handlers.register('dc_cc_special_', dp._handle_dc_cc_special, 'dcPlayArea')
    handlers.register('dc_cc_double_', dp._handle_dc_cc_double, 'dcPlayArea')
    handlers.register('dc_ability_choice_', dp._handle_dc_ability_choice, 'dcPlayArea')
    handlers.register('bo_rifle_pick_', dp._handle_bo_rifle_pick, 'dcPlayArea')
    handlers.register('ee3_pick_die_', dp._handle_ee3_pick_die, 'dcPlayArea')
    handlers.register('overwatch_space_', dp._handle_overwatch_space, 'dcPlayArea')
    handlers.register('bomb_drop_space_', dp._handle_bomb_drop_space, 'dcPlayArea')
    handlers.register('ob_space_', dp._handle_ob_space, 'dcPlayArea')
    handlers.register('special_done_', dp._handle_special_done, 'dcPlayArea')
    handlers.register('dc_deplete_', dp._handle_dc_deplete, 'dcPlayArea')
    handlers.register('dc_remove_stun_', dp._handle_dc_remove_stun, 'dcPlayArea')
    handlers.register('ob_skip_', dp._handle_ob_skip, 'dcPlayArea')


def _basic_game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_dc_action_records_choice():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('dc_action_G1_hl1dc0_attack')
    result = handler(_Interaction('dc_action_G1_hl1dc0_attack'), ctx)
    assert result['ok'] is True
    assert result['actionName'] == 'attack'
    assert result['game'].data['pendingDcActionChoice']['hl1dc0'] == 'attack'


def test_dc_special_dispatches_ability():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Luke': {'figures': 1, 'specialAbilityIds': ['unknown_ability']},
    }
    try:
        g = _basic_game()
        g.data['figurePositions'] = {1: {'Luke-0-0': 'a1'}, 2: {}}
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Luke', 'dgIndex': 0}]
        store = {'G1': g}
        ctx = {
            'get_game': lambda gid: store.get(gid),
            'save_games': lambda: None,
            'dc_message_meta': {'hl1dc0': {'gameId': 'G1', 'playerNum': 1}},
        }
        _, handler, _ = find_handler('dc_special_0_hl1dc0')
        result = handler(_Interaction('dc_special_0_hl1dc0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['specialIdx'] == 0
    finally:
        dc_effects_loader.reset_cache()


def test_dc_cc_special_plays_from_hand():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.data import cc_effects_loader, dc_effects_loader
    cc_effects_loader._cc_effects = {
        'Master Operative': {'timing': 'specialAction', 'playableBy': 'Any Figure'},
    }
    dc_effects_loader._dc_effects = {'Boba Fett': {'affiliation': 'Scum', 'keywords': []}}
    try:
        g = _basic_game()
        g.data['player1CcHand'] = ['Master Operative']
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'Boba Fett', 'dgIndex': 0}]
        store = {'G1': g}
        ctx = {
            'get_game': lambda gid: store.get(gid),
            'save_games': lambda: None,
            'dc_message_meta': {'hl1dc0': {'gameId': 'G1', 'playerNum': 1}},
        }
        _, handler, _ = find_handler('dc_cc_special_hl1dc0_0')
        result = handler(_Interaction('dc_cc_special_hl1dc0_0'), ctx)
        assert result['ok'] is True
        assert result['card'] == 'Master Operative'
    finally:
        cc_effects_loader.reset_cache()
        dc_effects_loader.reset_cache()


def test_dc_ability_choice_dispatches():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingDcAbilityChoice'] = {
        'hl1dc0_0': {'abilityId': 'unknown', 'playerNum': 1,
                     'choiceOptions': ['A', 'B']},
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('dc_ability_choice_G1_hl1dc0_0_1')
    result = handler(_Interaction('dc_ability_choice_G1_hl1dc0_0_1'), ctx)
    assert result['ok'] is True
    assert result['choiceIdx'] == 1


def test_bo_rifle_pick_use():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingBoRifle'] = {'hl1dc0': {'meleeDice': ['red']}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('bo_rifle_pick_use_G1_hl1dc0_0')
    result = handler(_Interaction('bo_rifle_pick_use_G1_hl1dc0_0'), ctx)
    assert result['ok'] is True
    assert result['choice'] == 'use'
    override = result['game'].data.get('pendingOverrideAttackDice') or {}
    assert 'hl1dc0' in override


def test_bo_rifle_pick_skip():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingBoRifle'] = {'hl1dc0': {'meleeDice': ['red']}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('bo_rifle_pick_skip_G1_hl1dc0_0')
    result = handler(_Interaction('bo_rifle_pick_skip_G1_hl1dc0_0'), ctx)
    assert result['ok'] is True
    assert result['choice'] == 'skip'


def test_ee3_pick_die_color():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'IG-88': {'attack': {'dice': ['blue', 'yellow', 'yellow']}},
    }
    try:
        g = _basic_game()
        g.data['movementBank'] = {'hl1dc0': {'total': 4, 'remaining': 4}}
        g.data['p1DcMessageIds'] = ['hl1dc0']
        g.data['p1DcList'] = [{'dcName': 'IG-88', 'dgIndex': 0}]
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
        _, handler, _ = find_handler('ee3_pick_die_blue_G1_hl1dc0_0')
        result = handler(_Interaction('ee3_pick_die_blue_G1_hl1dc0_0'), ctx)
        assert result['ok'] is True
        assert result['choice'] == 'blue'
    finally:
        dc_effects_loader.reset_cache()


def test_ee3_pick_die_skip():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('ee3_pick_die_skip_G1_hl1dc0_0')
    result = handler(_Interaction('ee3_pick_die_skip_G1_hl1dc0_0'), ctx)
    assert result['ok'] is True
    assert result['choice'] == 'skip'
    assert result['game'].data['pendingEe3Carbine']['hl1dc0'] == 'decided'


def test_overwatch_space_places_token():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingOverwatchPlacement'] = {'hl1dc0': {'playerNum': 1}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('overwatch_space_G1_hl1dc0_A5')
    result = handler(_Interaction('overwatch_space_G1_hl1dc0_A5'), ctx)
    assert result['ok'] is True
    assert result['space'] == 'A5'
    assert result['game'].data['overwatchTokenPosition']['hl1dc0'] == 'a5'


def test_bomb_drop_space_damages_figures():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['figurePositions'] = {1: {}, 2: {'Trooper-0-0': 'a1'}}
    g.data['p2DcMessageIds'] = ['hl2dc0']
    g.data['p2DcList'] = [{'dcName': 'Trooper'}]
    g.data['dcHealthState'] = {'hl2dc0': [[5, 5]]}
    g.data['pendingBombDrop'] = {'hl1dc0': {'damage': 2}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('bomb_drop_space_G1_hl1dc0_a1')
    result = handler(_Interaction('bomb_drop_space_G1_hl1dc0_a1'), ctx)
    assert result['ok'] is True
    assert result['game'].data['dcHealthState']['hl2dc0'][0][0] == 3


def test_dc_deplete_adds_msg_id_to_depleted_list():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1,
                        'dcName': 'Boba Fett Elite', 'displayName': 'Boba Fett [DG 1]'},
        },
    }
    _, handler, _ = find_handler('dc_deplete_hl1dc0')
    result = handler(_Interaction('dc_deplete_hl1dc0', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['alreadyDepleted'] is False
    assert g.data['p1DepletedDcMessageIds'] == ['hl1dc0']


def test_dc_deplete_idempotent_when_already_depleted():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1DepletedDcMessageIds'] = ['hl1dc0']
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1, 'dcName': 'X'},
        },
    }
    _, handler, _ = find_handler('dc_deplete_hl1dc0')
    result = handler(_Interaction('dc_deplete_hl1dc0', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['alreadyDepleted'] is True
    # No duplicate
    assert g.data['p1DepletedDcMessageIds'] == ['hl1dc0']


def test_dc_deplete_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1, 'dcName': 'X'},
        },
    }
    _, handler, _ = find_handler('dc_deplete_hl1dc0')
    result = handler(_Interaction('dc_deplete_hl1dc0', user_id='bob'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_owner'


def test_dc_remove_stun_spends_action_and_clears_stun():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['dcActionsData'] = {'hl1dc0': {'remaining': 2, 'total': 2}}
    g.data['figureConditions'] = {'Luke-1-0': ['Stun', 'Focus']}
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1,
                        'dcName': 'Luke', 'displayName': 'Luke [DG 1]'},
        },
    }
    _, handler, _ = find_handler('dc_remove_stun_hl1dc0_f0')
    result = handler(_Interaction('dc_remove_stun_hl1dc0_f0', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['remaining'] == 1
    conds = g.data['figureConditions']['Luke-1-0']
    assert 'Stun' not in conds
    assert 'Focus' in conds


def test_dc_remove_stun_rejects_when_not_stunned():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['dcActionsData'] = {'hl1dc0': {'remaining': 2, 'total': 2}}
    g.data['figureConditions'] = {'Luke-1-0': ['Focus']}
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1,
                        'dcName': 'Luke', 'displayName': 'Luke [DG 1]'},
        },
    }
    _, handler, _ = find_handler('dc_remove_stun_hl1dc0_f0')
    result = handler(_Interaction('dc_remove_stun_hl1dc0_f0', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'figure_not_stunned'


def test_dc_remove_stun_rejects_no_actions():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['dcActionsData'] = {'hl1dc0': {'remaining': 0, 'total': 2}}
    g.data['figureConditions'] = {'Luke-1-0': ['Stun']}
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'dc_message_meta': {
            'hl1dc0': {'gameId': 'G1', 'playerNum': 1,
                        'dcName': 'Luke', 'displayName': 'Luke [DG 1]'},
        },
    }
    _, handler, _ = find_handler('dc_remove_stun_hl1dc0_f0')
    result = handler(_Interaction('dc_remove_stun_hl1dc0_f0', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_actions_remaining'


def test_ob_skip_parses():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('ob_skip_G1_hl1dc0')
    result = handler(_Interaction('ob_skip_G1_hl1dc0'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'
    assert result['msgId'] == 'hl1dc0'


def test_ob_skip_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('ob_skip_G1')
    result = handler(_Interaction('ob_skip_G1'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_special_done_parses_clean():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('special_done_G1_hl1dc0')
    result = handler(_Interaction('special_done_G1_hl1dc0'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'
    assert result['msgId'] == 'hl1dc0'


def test_special_done_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('special_done_')
    result = handler(_Interaction('special_done_'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def main():
    cases = [
        ('dc_action_records', test_dc_action_records_choice),
        ('dc_special_dispatches', test_dc_special_dispatches_ability),
        ('dc_cc_special_plays', test_dc_cc_special_plays_from_hand),
        ('dc_ability_choice', test_dc_ability_choice_dispatches),
        ('bo_rifle_use', test_bo_rifle_pick_use),
        ('bo_rifle_skip', test_bo_rifle_pick_skip),
        ('ee3_color', test_ee3_pick_die_color),
        ('ee3_skip', test_ee3_pick_die_skip),
        ('overwatch_space', test_overwatch_space_places_token),
        ('bomb_drop_space', test_bomb_drop_space_damages_figures),
        ('special_done_parses', test_special_done_parses_clean),
        ('special_done_malformed', test_special_done_malformed),
        ('dc_deplete_adds_to_list', test_dc_deplete_adds_msg_id_to_depleted_list),
        ('dc_deplete_idempotent', test_dc_deplete_idempotent_when_already_depleted),
        ('dc_deplete_non_owner', test_dc_deplete_rejects_non_owner),
        ('dc_remove_stun_spends', test_dc_remove_stun_spends_action_and_clears_stun),
        ('dc_remove_stun_not_stunned', test_dc_remove_stun_rejects_when_not_stunned),
        ('dc_remove_stun_no_actions', test_dc_remove_stun_rejects_no_actions),
        ('ob_skip_parses', test_ob_skip_parses),
        ('ob_skip_malformed', test_ob_skip_malformed),
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
