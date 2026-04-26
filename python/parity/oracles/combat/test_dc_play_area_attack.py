"""P2.8 verification: dc_play_area.handle_attack_target engine port.

Validates pendingCombat construction, free-attack vs normal-attack
actions decrement, and override-dice merging.
"""
from python.engine.dc_play_area import handle_attack_target


def _game(remaining=2):
    return {
        'dcActionsData': {'hl1dc0': {'remaining': remaining, 'total': 2,
                                       'specialsUsed': []}},
        'figurePositions': {1: {'Han-1-0': 'a13'},
                            2: {'Vader-1-0': 'a20'}},
    }


def _stats():
    return {'attack': {'dice': ['red', 'green'], 'range': [1, 3]},
            'defense': ['white']}


def _target(fk='Vader-1-0'):
    return {
        'figureKey': fk,
        'playerNum': 2,
        'dist': 4,
        'isNpc': False,
        'defense': ['white'],
        'figureIndex': 0,
    }


# ── pendingCombat construction ──────────────────────────────────────────


def test_handle_attack_target_constructs_pending_combat():
    g = _game()
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is True
    pc = g['pendingCombat']
    assert pc['attackerMsgId'] == 'hl1dc0'
    assert pc['attackerPlayerNum'] == 1
    assert pc['attackerDcName'] == 'Han'
    assert pc['attackerFigureKey'] == 'Han-1-0'
    assert pc['target']['figureKey'] == 'Vader-1-0'
    assert pc['attackInfo']['dice'] == ['red', 'green']
    assert pc['phase'] == 'declare'


def test_target_default_defense_type_picked_from_defense_colors():
    g = _game()
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['pendingCombat']['target']['defenseType'] == 'white'


# ── Free-attack handling ────────────────────────────────────────────────


def test_normal_attack_decrements_actions_data():
    g = _game(remaining=2)
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['dcActionsData']['hl1dc0']['remaining'] == 1


def test_battlefield_leadership_free_attack_does_not_decrement():
    g = _game(remaining=2)
    g['pendingBattlefieldLeadership'] = {'forMsgId': 'hl1dc0'}
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['consumedFreeAttack'] == 'pendingBattlefieldLeadership'
    assert g['dcActionsData']['hl1dc0']['remaining'] == 2
    assert 'pendingBattlefieldLeadership' not in g


def test_fell_swoop_free_attack_consumes_msg_keyed_flag():
    g = _game(remaining=2)
    g['fellSwoopFreeAttack'] = {'hl1dc0': True}
    g['stillFasterExcludeMsgId'] = 'someMsg'
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['consumedFreeAttack'] == 'fellSwoopFreeAttack'
    assert g['dcActionsData']['hl1dc0']['remaining'] == 2
    assert 'fellSwoopFreeAttack' not in g
    assert g['stillFasterExcludeMsgId'] is None


def test_firing_squad_list_consume():
    g = _game(remaining=2)
    g['pendingFiringSquad'] = [
        {'forMsgId': 'hl1dc0'},
        {'forMsgId': 'hl1dc1'},
    ]
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['consumedFreeAttack'] == 'pendingFiringSquad'
    assert g['dcActionsData']['hl1dc0']['remaining'] == 2
    # Other entry preserved.
    assert g['pendingFiringSquad'] == [{'forMsgId': 'hl1dc1'}]


def test_firing_squad_clears_when_empty():
    g = _game(remaining=2)
    g['pendingFiringSquad'] = [{'forMsgId': 'hl1dc0'}]
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert 'pendingFiringSquad' not in g


# ── Override dice merging ───────────────────────────────────────────────


def test_pending_override_attack_dice_replaces_dice():
    g = _game()
    g['pendingOverrideAttackDice'] = {'hl1dc0': {'dice': ['blue', 'blue']}}
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['pendingCombat']['attackInfo']['dice'] == ['blue', 'blue']
    # Override consumed.
    assert 'pendingOverrideAttackDice' not in g


def test_pending_override_melee_clamps_range_to_1_1():
    g = _game()
    g['pendingOverrideAttackDice'] = {'hl1dc0': {'type': 'melee'}}
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['pendingCombat']['attackInfo']['range'] == [1, 1]
    assert g['pendingCombat']['isRanged'] is False


def test_pending_override_ranged_extends_range():
    g = _game()
    g['pendingOverrideAttackDice'] = {'hl1dc0': {'type': 'ranged'}}
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    pc = g['pendingCombat']
    assert pc['attackInfo']['attackType'] == 'Ranged'
    assert pc['attackInfo']['range'][1] == 99
    assert pc['isRanged'] is True


def test_remove_die_color_strips_from_dice_list():
    g = _game()
    g['pendingOverrideAttackDice'] = {'hl1dc0': {'removeDieColor': 'green'}}
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['pendingCombat']['attackInfo']['dice'] == ['red']


def test_block_surge_abilities_stamps_flag():
    g = _game()
    g['pendingOverrideAttackDice'] = {'hl1dc0': {'blockSurgeAbilities': True}}
    handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert g['_pendingBlockSurgeAbilities'] is True


# ── Validation gates ────────────────────────────────────────────────────


def test_etiquette_pair_blocks_attack():
    g = _game()
    g['etiquetteBlockPairs'] = [['Han-1-0', 'Vader-1-0']]
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is False
    assert result['code'] == 'etiquette'
    # No pendingCombat created.
    assert 'pendingCombat' not in g


def test_forced_target_gates_wrong_target():
    g = _game()
    g['forcedAttackTarget'] = {'hl1dc0': 'Stormtrooper-1-0'}
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is False
    assert result['code'] == 'forced_target'


def test_forced_target_consumed_when_correct_target():
    g = _game()
    g['forcedAttackTarget'] = {'hl1dc0': 'Vader-1-0'}
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is True
    assert 'forcedAttackTarget' not in g


def test_multi_fire_blocks_same_target():
    g = _game()
    g['multiFireBlockedTarget'] = {'hl1dc0': 'Vader-1-0'}
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is False
    assert result['code'] == 'multi_fire'


def test_multi_fire_clears_for_different_target():
    g = _game()
    g['multiFireBlockedTarget'] = {'hl1dc0': 'Stormtrooper-1-0'}
    result = handle_attack_target(
        g, msg_id='hl1dc0', attacker_player_num=1,
        attacker_dc_name='Han', attacker_figure_key='Han-1-0',
        attacker_figure_index=0, target=_target(),
        attacker_stats=_stats(),
    )
    assert result['ok'] is True
    assert 'multiFireBlockedTarget' not in g
