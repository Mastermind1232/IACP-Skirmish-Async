"""Tests for the combat Discord handler."""
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
    from python.discord_bot.handlers import combat as cm
    handlers.reset_for_tests()
    handlers.register('power_token_choice_', cm._handle_power_token_choice, 'combat')
    handlers.register('strain_choice_alldmg_', cm._handle_strain_choice_alldmg, 'combat')
    handlers.register('strain_choice_discard_', cm._handle_strain_choice_discard, 'combat')
    handlers.register('spread_pain_cond_', cm._handle_spread_pain_cond, 'combat')
    handlers.register('combat_ready_', cm._handle_combat_ready, 'combat')
    handlers.register('combat_skip_surges_', cm._handle_combat_skip_surges, 'combat')
    handlers.register('pt_overflow_', cm._handle_pt_overflow, 'combat')


def _basic_game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_power_token_choice_applies_type():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingPowerTokenGrant'] = {
        'grants': [{'figureKey': 'Luke-0-0', 'figName': 'Luke', 'count': 1}],
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('power_token_choice_G1_Surge')
    result = handler(_Interaction('power_token_choice_G1_Surge'), ctx)
    assert result['ok'] is True
    assert result['tokenType'] == 'Surge'
    assert 'Surge' in result['game'].data['figurePowerTokens']['Luke-0-0']


def test_strain_choice_alldmg_applies():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1DcMessageIds'] = ['h0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['dcHealthState'] = {'h0': [[8, 8]]}
    g.data['pendingStrainChoice'] = {
        'amount': 2, 'figureKey': 'Luke-0-0', 'playerNum': 1,
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('strain_choice_alldmg_G1')
    result = handler(_Interaction('strain_choice_alldmg_G1'), ctx)
    assert result['ok'] is True
    assert result['game'].data['dcHealthState']['h0'][0][0] == 6


def test_strain_choice_discard_parses_count():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['p1DcMessageIds'] = ['h0']
    g.data['p1DcList'] = [{'dcName': 'Luke'}]
    g.data['dcHealthState'] = {'h0': [[8, 8]]}
    g.data['player1CcDeck'] = ['A', 'B', 'C']
    g.data['pendingStrainChoice'] = {
        'amount': 2, 'figureKey': 'Luke-0-0', 'playerNum': 1,
        'ccCostPerStrain': 1,
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('strain_choice_discard_G1_2')
    result = handler(_Interaction('strain_choice_discard_G1_2'), ctx)
    assert result['ok'] is True
    assert result['discardCount'] == 2
    assert result['game'].data['player1CcDeck'] == ['C']


def test_spread_pain_cond_appends():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingSpreadThePainCondPick'] = {'attackerPlayerNum': 1}
    g.data['pendingCombat'] = {'attackerPlayerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('spread_pain_cond_G1_stun')
    result = handler(_Interaction('spread_pain_cond_G1_stun'), ctx)
    assert result['ok'] is True
    assert result['cond'] == 'stun'
    assert result['game'].data['pendingCombat']['spreadThePainConditions'] == ['Stun']


def test_combat_ready_flags_and_bothReady():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCombat'] = {'attackerPlayerNum': 1, 'defenderPlayerNum': 2}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('combat_ready_G1')
    r1 = handler(_Interaction('combat_ready_G1', user_id='alice'), ctx)
    assert r1['ok'] is True
    assert r1['bothReady'] is False
    store['G1'] = r1['game']
    r2 = handler(_Interaction('combat_ready_G1', user_id='bob'), ctx)
    assert r2['bothReady'] is True


def test_combat_ready_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCombat'] = {}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('combat_ready_G1')
    result = handler(_Interaction('combat_ready_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def test_combat_skip_surges_advances_phase():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['pendingCombat'] = {'surgeRemaining': 2}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('combat_skip_surges_G1')
    result = handler(_Interaction('combat_skip_surges_G1'), ctx)
    assert result['ok'] is True
    assert result['game'].data['pendingCombat']['phase'] == 'surges_done'


def test_pt_overflow_extracts_figure_key_with_underscores():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _basic_game()
    g.data['figurePowerTokens'] = {
        'Rebel Trooper (Regular)-0-1': ['Block', 'Surge'],
    }
    g.data['pendingPowerTokenOverflow'] = [
        {'figureKey': 'Rebel Trooper (Regular)-0-1', 'discardCount': 1},
    ]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    # customId with underscores in figure_key
    cid = 'pt_overflow_G1_Rebel Trooper (Regular)-0-1_1'
    _, handler, _ = find_handler(cid)
    result = handler(_Interaction(cid), ctx)
    assert result['ok'] is True
    assert result['figureKey'] == 'Rebel Trooper (Regular)-0-1'
    assert result['tokenIndex'] == 1


def main():
    cases = [
        ('power_token_choice_applies', test_power_token_choice_applies_type),
        ('strain_alldmg', test_strain_choice_alldmg_applies),
        ('strain_discard_count_parse', test_strain_choice_discard_parses_count),
        ('spread_pain_cond', test_spread_pain_cond_appends),
        ('combat_ready_bothReady', test_combat_ready_flags_and_bothReady),
        ('combat_ready_non_player', test_combat_ready_rejects_non_player),
        ('combat_skip_surges', test_combat_skip_surges_advances_phase),
        ('pt_overflow_figure_key_underscores', test_pt_overflow_extracts_figure_key_with_underscores),
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
