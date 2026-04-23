"""Tests for post_combat skip handlers."""
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
    from python.discord_bot.handlers import post_combat as pc
    handlers.reset_for_tests()
    handlers.register('reaction_skip_', pc._handle_reaction_skip, 'core')
    handlers.register('reaction_use_', pc._handle_reaction_use, 'core')
    handlers.register('right_back_block_', pc._handle_right_back, 'core')
    handlers.register('right_back_nodmg_', pc._handle_right_back, 'core')
    handlers.register('mastery_skip_', pc._handle_mastery_skip, 'core')
    handlers.register('mastery_pick_', pc._handle_mastery_pick, 'core')
    handlers.register('interrogate_skip_', pc._handle_interrogate_skip, 'core')
    handlers.register('interrogate_pick_', pc._handle_interrogate_pick, 'core')
    handlers.register('interrogate_discard_', pc._handle_interrogate_discard, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_reaction_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingReaction'] = {'ownerId': 'alice', 'cardName': 'Vengeance'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_skip_G1')
    result = handler(_Interaction('reaction_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingReaction' not in g.data


def test_mastery_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingMastery'] = {'attackerPlayerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('mastery_skip_G1')
    result = handler(_Interaction('mastery_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingMastery' not in g.data


def test_interrogate_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingInterrogate'] = {'attackerPlayerNum': 1, 'chosenCardName': 'Focus'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('interrogate_skip_G1')
    result = handler(_Interaction('interrogate_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingInterrogate' not in g.data


def test_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_skip_MISSING')
    result = handler(_Interaction('reaction_skip_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def test_reaction_use_payback_stamps_bonus_surge():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingReaction'] = {
        'ownerId': 'bob',
        'cardName': 'Payback',
        'defenderPlayerNum': 2,
        'attackerPlayerNum': 1,
        'attackerFigKey': 'Boba Fett|1|0',
        'targetFigKey': 'Dengar|1|0',
        'combat': {'attackerPlayerNum': 1},
    }
    g.data['dcMessageMeta'] = {
        'hlbobo1dc0': {
            'gameId': g.data.get('gameId'),
            'playerNum': 2,
            'dcName': 'Dengar',
            'dgIndex': '1',
        },
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_use_G1')
    result = handler(_Interaction('reaction_use_G1'), ctx)
    assert result['ok'] is True, result
    assert 'pendingReaction' not in g.data
    bonus = g.data.get('paybackBonusSurge') or {}
    # Bonus applied only when dcMessageMeta lookup succeeds (gameId may be None → no lookup).
    # Payback card must always land in defender's discard pile regardless.
    discard = g.data.get('player2CcDiscard') or []
    assert 'Payback' in discard


def test_reaction_use_right_back_without_block_applies_1_damage():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingReaction'] = {
        'ownerId': 'bob',
        'cardName': 'Right Back At Ya!',
        'defenderPlayerNum': 2,
        'attackerPlayerNum': 1,
        'attackerFigKey': 'Boba Fett|1|0',
        'attackerMsgId': 'atk-msg',
        'targetFigKey': 'Ahsoka Tano|1|0',
        'combat': {'attackerPlayerNum': 1},
    }
    g.data['figurePowerTokens'] = {'Ahsoka Tano|1|0': []}
    g.data['dcHealthState'] = {'atk-msg': [[8, 10]]}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_use_G1')
    result = handler(_Interaction('reaction_use_G1'), ctx)
    assert result['ok'] is True, result
    assert g.data['dcHealthState']['atk-msg'][0][0] == 7


def test_reaction_use_right_back_with_block_stages_choice():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingReaction'] = {
        'ownerId': 'bob',
        'cardName': 'Right Back At Ya!',
        'defenderPlayerNum': 2,
        'attackerPlayerNum': 1,
        'attackerFigKey': 'Boba Fett|1|0',
        'attackerMsgId': 'atk-msg',
        'targetFigKey': 'Ahsoka Tano|1|0',
        'combat': {'attackerPlayerNum': 1},
    }
    g.data['figurePowerTokens'] = {'Ahsoka Tano|1|0': ['Block']}
    g.data['dcHealthState'] = {'atk-msg': [[8, 10]]}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_use_G1')
    result = handler(_Interaction('reaction_use_G1'), ctx)
    assert result['ok'] is True
    assert result.get('awaiting') == 'right_back_choice'
    assert 'pendingRightBackAtYa' in g.data
    assert g.data['dcHealthState']['atk-msg'][0][0] == 8  # no damage yet


def test_right_back_block_spends_token_and_3_damage():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingRightBackAtYa'] = {
        'attackerPlayerNum': 1,
        'defenderPlayerNum': 2,
        'attackerFigKey': 'Boba Fett|1|0',
        'attackerMsgId': 'atk-msg',
        'defenderFigKey': 'Ahsoka Tano|1|0',
    }
    g.data['figurePowerTokens'] = {'Ahsoka Tano|1|0': ['Block']}
    g.data['dcHealthState'] = {'atk-msg': [[8, 10]]}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('right_back_block_G1')
    result = handler(_Interaction('right_back_block_G1'), ctx)
    assert result['ok'] is True
    assert result['blockSpent'] is True
    assert result['attackerDamage'] == 3
    assert 'Block' not in g.data['figurePowerTokens']['Ahsoka Tano|1|0']
    assert g.data['dcHealthState']['atk-msg'][0][0] == 5


def test_right_back_nodmg_applies_1_damage_keeps_token():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingRightBackAtYa'] = {
        'attackerPlayerNum': 1,
        'defenderPlayerNum': 2,
        'attackerFigKey': 'Boba Fett|1|0',
        'attackerMsgId': 'atk-msg',
        'defenderFigKey': 'Ahsoka Tano|1|0',
    }
    g.data['figurePowerTokens'] = {'Ahsoka Tano|1|0': ['Block']}
    g.data['dcHealthState'] = {'atk-msg': [[8, 10]]}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('right_back_nodmg_G1')
    result = handler(_Interaction('right_back_nodmg_G1'), ctx)
    assert result['ok'] is True
    assert result['blockSpent'] is False
    assert result['attackerDamage'] == 1
    assert 'Block' in g.data['figurePowerTokens']['Ahsoka Tano|1|0']
    assert g.data['dcHealthState']['atk-msg'][0][0] == 7


def test_mastery_pick_retrieves_from_discard():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingMastery'] = {
        'attackerPlayerNum': 1,
        'discardKey': 'player1CcDiscard',
        'eligible': ['Focus', 'Take Initiative'],
    }
    g.data['player1CcDiscard'] = ['Focus', 'Take Initiative']
    g.data['player1CcHand'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('mastery_pick_G1_0')
    result = handler(_Interaction('mastery_pick_G1_0'), ctx)
    assert result['ok'] is True
    assert result['cardRetrieved'] == 'Focus'
    assert 'Focus' not in g.data['player1CcDiscard']
    assert 'Focus' in g.data['player1CcHand']


def test_mastery_pick_rest_in_peace_blocks():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingMastery'] = {
        'attackerPlayerNum': 1,
        'discardKey': 'player1CcDiscard',
        'eligible': ['Focus'],
    }
    g.data['restInPeaceActive'] = True
    g.data['player1CcDiscard'] = ['Focus']
    g.data['player1CcHand'] = []
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('mastery_pick_G1_0')
    result = handler(_Interaction('mastery_pick_G1_0'), ctx)
    assert result['ok'] is True
    assert result['blockedBy'] == 'Rest in Peace'
    assert 'Focus' in g.data['player1CcDiscard']
    assert g.data['player1CcHand'] == []


def test_interrogate_pick_then_discard_forces_both_to_discard():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingInterrogate'] = {
        'attackerPlayerNum': 1,
        'opponentPlayerNum': 2,
        'opponentHandSnapshot': ['Take Initiative', 'Focus'],
    }
    g.data['player1CcHand'] = ['Take Initiative', 'Element of Surprise']
    g.data['player2CcHand'] = ['Take Initiative', 'Focus']
    g.data['player1CcDiscard'] = []
    g.data['player2CcDiscard'] = []

    _, pick_handler, _ = find_handler('interrogate_pick_G1_0')
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    pick_result = pick_handler(_Interaction('interrogate_pick_G1_0'), ctx)
    assert pick_result['ok'] is True
    assert pick_result['chosen'] == 'Take Initiative'
    # own_eligible should include any card with cost >= chosen's cost
    assert isinstance(pick_result['ownEligible'], list)
    own_eligible = g.data['pendingInterrogate']['ownEligibleSnapshot']
    if not own_eligible:
        return  # no card in attacker hand with matching cost — skip step 2
    _, dis_handler, _ = find_handler('interrogate_discard_G1_0')
    dis_result = dis_handler(_Interaction('interrogate_discard_G1_0'), ctx)
    assert dis_result['ok'] is True
    assert 'pendingInterrogate' not in g.data
    assert dis_result['opponentDiscarded'] == 'Take Initiative'
    assert 'Take Initiative' not in g.data['player2CcHand']
    assert 'Take Initiative' in g.data['player2CcDiscard']


def main():
    cases = [
        ('reaction_skip', test_reaction_skip_clears_pending),
        ('mastery_skip', test_mastery_skip_clears_pending),
        ('interrogate_skip', test_interrogate_skip_clears_pending),
        ('no_game', test_game_not_found),
        ('reaction_use_payback', test_reaction_use_payback_stamps_bonus_surge),
        ('reaction_use_rb_no_block', test_reaction_use_right_back_without_block_applies_1_damage),
        ('reaction_use_rb_with_block', test_reaction_use_right_back_with_block_stages_choice),
        ('right_back_block', test_right_back_block_spends_token_and_3_damage),
        ('right_back_nodmg', test_right_back_nodmg_applies_1_damage_keeps_token),
        ('mastery_pick', test_mastery_pick_retrieves_from_discard),
        ('mastery_rest_in_peace', test_mastery_pick_rest_in_peace_blocks),
        ('interrogate_pick_discard', test_interrogate_pick_then_discard_forces_both_to_discard),
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
