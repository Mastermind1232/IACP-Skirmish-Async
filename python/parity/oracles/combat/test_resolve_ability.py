"""P2.11 verification: resolve_ability top-level dispatch.

Validates the JS-shape contract:
  - applied: bool
  - manualMessage / logMessage
  - requiresChoice / choiceOptions / choiceCount
  - chooseOne handling (no-choice prompt + chosen sub-entry)
  - informational ccEffect
  - surge entries return manual fallback
  - Pattern fallback for ability_ids the pattern dispatcher knows.
"""
from unittest.mock import patch

import python.engine.abilities.resolve_ability as _resolve_module
from python.engine.abilities.resolve_ability import resolve_ability


def _game():
    return {
        'figurePositions': {1: {'Han-1-0': 'a13'}, 2: {}},
        'figureConditions': {},
    }


# ── Manual fallback paths ──────────────────────────────────────────────


def test_resolve_ability_none_id_returns_manual():
    result = resolve_ability(None, {'game': _game()})
    assert result['applied'] is False
    assert 'manualMessage' in result


def test_resolve_ability_unknown_id_returns_manual():
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=None,
    ):
        result = resolve_ability('mystery_ability', {'game': _game()})
    assert result['applied'] is False
    assert 'manualMessage' in result


def test_resolve_ability_surge_returns_manual():
    """Surge entries are handled by step_surge, not here."""
    fake = {'type': 'surge', 'damage': 1}
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability('some_surge', {'game': _game()})
    assert result['applied'] is False


# ── Informational ccEffect ──────────────────────────────────────────────


def test_resolve_ability_informational_ccEffect_logs_only():
    fake = {
        'type': 'ccEffect',
        'informational': True,
        'logMessage': '**Collect Intel** — Look at opponent\'s hand.',
    }
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability('collect_intel', {'game': _game()})
    assert result['applied'] is True
    assert 'Collect Intel' in result['logMessage']


def test_resolve_ability_informational_falls_back_to_label():
    fake = {
        'type': 'ccEffect',
        'informational': True,
        'label': 'Some Effect',
    }
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability('cc_x', {'game': _game()})
    assert result['applied'] is True
    assert result['logMessage'] == 'Some Effect'


# ── chooseOne handling ──────────────────────────────────────────────────


def test_resolve_ability_chooseOne_without_index_returns_prompt():
    fake = {
        'type': 'ccEffect',
        'chooseOne': [
            {'label': 'Gain MP'},
            {'label': 'Gain Block'},
        ],
        'label': 'Vigor',
    }
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability('vigor', {'game': _game()})
    assert result['applied'] is False
    assert result['requiresChoice'] is True
    assert result['choiceOptions'] == ['Gain MP', 'Gain Block']
    assert result['choiceCount'] == 2


def test_resolve_ability_chooseOne_default_labels_when_missing():
    fake = {
        'type': 'ccEffect',
        'chooseOne': [{}, {}, {}],
    }
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability('multi_choice', {'game': _game()})
    assert result['choiceOptions'] == ['Option 1', 'Option 2', 'Option 3']


def test_resolve_ability_chooseOne_with_apply_focus_to_self():
    """Sub-entry with applyFocusToSelf applies condition + returns log."""
    fake = {
        'type': 'dcSpecial',
        'label': 'Reactive',
        'chooseOne': [
            {'applyFocusToSelf': True, 'label': 'Focus'},
            {'nextAttackReach': True, 'label': 'Reach'},
        ],
    }
    g = _game()
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability(
            'reactive',
            {
                'game': g,
                'choice_index': 0,
                'meta': {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
                'player_num': 1,
            },
        )
    assert result['applied'] is True
    assert 'Focused' in result['logMessage']
    # Focus condition applied to all Han-1-* figures.
    assert 'Focus' in g['figureConditions'].get('Han-1-0', [])


def test_resolve_ability_chooseOne_with_next_attack_reach():
    fake = {
        'type': 'dcSpecial',
        'label': 'Reach Plus Cleave',
        'chooseOne': [
            {'nextAttackReach': True, 'nextAttackCleave': 1, 'label': 'Reach'},
        ],
    }
    g = _game()
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability(
            'reach_cleave',
            {
                'game': g,
                'choice_index': 0,
                'meta': {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
                'player_num': 1,
            },
        )
    assert result['applied'] is True
    assert g['nextAttackReach'].get(1) is True
    assert 'cleave 1' in g['nextAttackBonusSurgeAbilities'].get(1, [])


# ── Snake-case + camel-case choice index alias ──────────────────────────


def test_resolve_ability_accepts_camelCase_choiceIndex():
    fake = {
        'type': 'dcSpecial',
        'chooseOne': [{'applyFocusToSelf': True, 'label': 'A'}],
    }
    g = _game()
    with patch.object(
        _resolve_module, 'get_ability',
        return_value=fake,
    ):
        result = resolve_ability(
            'abc',
            {
                'game': g,
                'choiceIndex': 0,
                'meta': {'dcName': 'Han', 'displayName': 'Han [DG 1]'},
                'player_num': 1,
            },
        )
    assert result['applied'] is True
