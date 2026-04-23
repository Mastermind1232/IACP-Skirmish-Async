"""Pattern D — forest_fighters combat-declare handler oracle (D3.20).

Ewok Warrior Elite: +1 Hit during a melee attack while Hidden.
JS reference: src/handlers/combat.js:2102-2110.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.abilities import dispatch
from python.engine.abilities.pattern_d import (
    fire_ability, get_handler_for, is_stub, pattern_d_runnable_ids,
)
from python.engine.abilities.pattern_d_handlers import handle_forest_fighters


def _combat():
    return {'attackInfo': {'dice': ['red']}}


def test_forest_fighters_runnable():
    assert 'forest_fighters' in pattern_d_runnable_ids()
    info = get_handler_for('forest_fighters')
    assert info is not None
    trigger, handler = info
    assert trigger == 'combat-declare'
    assert not is_stub(handler)


def test_fires_when_melee_and_hidden():
    combat = _combat()
    g = {'figureConditions': {'Ewok-0-0': ['Hidden']}}
    result = handle_forest_fighters(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'is_ranged': False, 'distance_to_target': 1},
    )
    assert result['applied'] is True
    assert combat.get('bonusHits') == 1
    assert '+1 Hit' in result['log_message']


def test_gates_when_ranged():
    combat = _combat()
    g = {'figureConditions': {'Ewok-0-0': ['Hidden']}}
    result = handle_forest_fighters(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'is_ranged': True},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'not-melee'
    assert 'bonusHits' not in combat or combat['bonusHits'] == 0


def test_gates_when_not_hidden():
    combat = _combat()
    g = {'figureConditions': {'Ewok-0-0': ['Focus']}}
    result = handle_forest_fighters(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'is_ranged': False},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'not-hidden'


def test_gates_when_no_attacker_key():
    combat = _combat()
    result = handle_forest_fighters(
        {}, 'forest_fighters', {'combat': combat, 'is_ranged': False},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'missing-attacker'


def test_distance_fallback_when_is_ranged_omitted():
    # If is_ranged isn't supplied but distance is, distance>1 counts as ranged
    combat = _combat()
    g = {'figureConditions': {'Ewok-0-0': ['Hidden']}}
    result = handle_forest_fighters(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'distance_to_target': 3},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'not-melee'


def test_additive_on_existing_bonus_hits():
    combat = {'attackInfo': {'dice': ['red']}, 'bonusHits': 2}
    g = {'figureConditions': {'Ewok-0-0': ['Hidden']}}
    result = handle_forest_fighters(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'is_ranged': False},
    )
    assert result['applied'] is True
    assert combat['bonusHits'] == 3


def test_via_fire_ability_bus():
    combat = _combat()
    g = {'figureConditions': {'Ewok-0-0': ['Hidden']}}
    result = fire_ability(
        g, 'forest_fighters',
        {'combat': combat, 'attacker_figure_key': 'Ewok-0-0',
         'is_ranged': False, 'trigger': 'combat-declare'},
    )
    assert result['applied'] is True


def main():
    cases = [
        ('runnable', test_forest_fighters_runnable),
        ('fires_melee_hidden', test_fires_when_melee_and_hidden),
        ('gates_ranged', test_gates_when_ranged),
        ('gates_not_hidden', test_gates_when_not_hidden),
        ('gates_no_attacker', test_gates_when_no_attacker_key),
        ('distance_fallback', test_distance_fallback_when_is_ranged_omitted),
        ('additive_bonus_hits', test_additive_on_existing_bonus_hits),
        ('via_fire_ability', test_via_fire_ability_bus),
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
    print(f'\n{total - len(failures)}/{total} green')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
