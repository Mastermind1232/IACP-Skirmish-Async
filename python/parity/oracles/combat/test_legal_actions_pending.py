"""P2.18 verification: legal_actions pending-state gates.

Validates that pending_gate_actions returns the right gated action set
for each pendingXxx flag, and None when no flag is active.
"""
from python.engine.legal_actions_pending import (
    list_active_pending_flags,
    pending_gate_actions,
)


def _game():
    return {'figurePositions': {1: {}, 2: {}}}


def test_no_pending_returns_none():
    g = _game()
    assert pending_gate_actions(g) is None


def test_pending_combat_routes_to_combat_phase_actions():
    g = _game()
    g['pendingCombat'] = {
        'phase': 'declare',
        'attackerMsgId': 'hl1dc0',
        'attackInfo': {'dice': ['red']},
        'target': {'figureKey': 'Vader-1-0'},
    }
    actions = pending_gate_actions(g)
    assert actions is not None
    # legal_combat_actions returns at least one action.
    assert isinstance(actions, list)


def test_pending_negation_offers_play_or_resolve():
    g = _game()
    g['pendingNegation'] = {'card': 'Take Cover'}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {'negation_play', 'negation_let_resolve'}


def test_pending_celebration_offers_play_or_pass():
    g = _game()
    g['pendingCelebration'] = {'playerNum': 1}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {'celebration_play', 'celebration_pass'}


def test_pending_self_destruct_offers_use_or_skip():
    g = _game()
    g['pendingSelfDestruct'] = {'defenderPlayerNum': 1}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {
        'self_destruct_protocol_use', 'self_destruct_protocol_skip',
    }


def test_pending_cc_choice_returns_index_per_option():
    g = _game()
    g['pendingCcChoice'] = {'options': ['A', 'B', 'C']}
    actions = pending_gate_actions(g)
    assert len(actions) == 3
    assert {a['params']['index'] for a in actions} == {0, 1, 2}


def test_pending_cc_space_choice_returns_action_per_space():
    g = _game()
    g['pendingCcSpaceChoice'] = {'validSpaces': ['a13', 'a14']}
    actions = pending_gate_actions(g)
    assert {a['params']['space'] for a in actions} == {'a13', 'a14'}


def test_pending_dc_ability_choice_returns_indexed_options():
    g = _game()
    g['pendingDcAbilityChoice'] = {'options': [{}, {}]}
    actions = pending_gate_actions(g)
    assert len(actions) == 2
    assert all(a['type'] == 'dc_ability_choice' for a in actions)


def test_pending_space_pick_returns_indexed_spaces():
    g = _game()
    g['pendingSpacePick'] = {'validSpaces': ['a13', 'a14', 'a15']}
    actions = pending_gate_actions(g)
    assert len(actions) == 3


def test_pending_pattern_e_offers_options():
    g = _game()
    g['pendingPatternE'] = {'pickType': 'space',
                              'options': ['a13', 'a14']}
    actions = pending_gate_actions(g)
    assert len(actions) == 2
    assert all(a['type'] == 'pattern_e_space' for a in actions)


def test_pending_power_token_grant_offers_token_picks():
    g = _game()
    g['pendingPowerTokenGrant'] = {'options': ['Block', 'Evade']}
    actions = pending_gate_actions(g)
    assert {a['params']['token'] for a in actions} == {'Block', 'Evade'}


def test_pending_strain_choice_offers_amounts():
    g = _game()
    g['pendingChannelTheForceStrain'] = True
    actions = pending_gate_actions(g)
    assert {a['params']['amount'] for a in actions} == {1, 2, 3}


def test_pending_force_slow_offers_figure_picks():
    g = _game()
    g['pendingForceSlow'] = {'figureKeys': ['Han-1-0', 'Chewie-1-0']}
    actions = pending_gate_actions(g)
    assert {a['params']['figureKey'] for a in actions} == {
        'Han-1-0', 'Chewie-1-0',
    }


def test_pending_under_duress_offers_pay_or_pass():
    g = _game()
    g['pendingUnderDuress'] = {'card': 'Under Duress'}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {
        'under_duress_pay', 'under_duress_pass',
    }


def test_pending_cc_confirmation_offers_confirm_or_cancel():
    g = _game()
    g['pendingCcConfirmation'] = {'card': 'Take Cover'}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {
        'cc_confirm_play', 'cc_cancel_play',
    }


# ── Priority ordering ───────────────────────────────────────────────────


def test_pending_combat_takes_priority_over_other_flags():
    g = _game()
    g['pendingCombat'] = {
        'phase': 'declare', 'attackerMsgId': 'hl1dc0',
        'attackInfo': {'dice': ['red']},
        'target': {'figureKey': 'Vader-1-0'},
    }
    g['pendingNegation'] = {'card': 'Take Cover'}
    actions = pending_gate_actions(g)
    # Combat actions, NOT negation actions.
    types = {a['type'] for a in actions}
    assert 'negation_play' not in types


def test_pending_negation_takes_priority_over_cc_choice():
    g = _game()
    g['pendingNegation'] = {'card': 'X'}
    g['pendingCcChoice'] = {'options': ['A', 'B']}
    actions = pending_gate_actions(g)
    assert {a['type'] for a in actions} == {'negation_play', 'negation_let_resolve'}


# ── Diagnostic helper ───────────────────────────────────────────────────


def test_list_active_pending_flags_finds_all_set():
    g = _game()
    g['pendingNegation'] = {'card': 'X'}
    g['pendingCcChoice'] = {'options': ['A']}
    g['pendingNothing'] = None  # falsy → skipped
    flags = list_active_pending_flags(g)
    assert 'pendingNegation' in flags
    assert 'pendingCcChoice' in flags
    assert 'pendingNothing' not in flags


def test_list_active_pending_flags_empty_when_none():
    flags = list_active_pending_flags(_game())
    assert flags == []
