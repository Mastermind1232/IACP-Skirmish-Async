"""Pattern D — on-damage self-Focus family (D3.19).

Handlers: self_preservation, self_preservation_hired_gun_elite.
When the figure suffers damage, it becomes Focused. Fires via the
`on-damage` bus trigger.
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
from python.engine.abilities.pattern_d_handlers import _handle_self_preservation


def test_both_on_damage_abilities_runnable():
    runnable = pattern_d_runnable_ids()
    assert 'self_preservation' in runnable
    assert 'self_preservation_hired_gun_elite' in runnable
    for aid in ('self_preservation', 'self_preservation_hired_gun_elite'):
        info = get_handler_for(aid)
        assert info is not None
        trigger, handler = info
        assert trigger == 'on-damage'
        assert not is_stub(handler)


def test_self_preservation_applies_focus():
    g = {}
    result = _handle_self_preservation(
        g, 'self_preservation', {'figure_key': 'Hired Gun-0-0'},
    )
    assert result['applied'] is True
    assert 'Focused' in result['log_message']
    conds = (g.get('figureConditions') or {}).get('Hired Gun-0-0') or []
    assert 'Focus' in conds


def test_self_preservation_idempotent_when_focused():
    g = {'figureConditions': {'Hired Gun-0-0': ['Focus']}}
    result = _handle_self_preservation(
        g, 'self_preservation', {'figure_key': 'Hired Gun-0-0'},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'already-focused'


def test_self_preservation_gates_when_no_figure_key():
    g = {}
    result = _handle_self_preservation(g, 'self_preservation', {})
    assert result['applied'] is False
    assert result['gated_by'] == 'missing-figure-key'


def test_self_preservation_accepts_damaged_figure_key_alias():
    g = {}
    result = _handle_self_preservation(
        g, 'self_preservation',
        {'damaged_figure_key': 'Hired Gun Elite-0-0'},
    )
    assert result['applied'] is True
    conds = (g.get('figureConditions') or {}).get('Hired Gun Elite-0-0') or []
    assert 'Focus' in conds


def test_hired_gun_elite_variant_fires_same_handler():
    g = {}
    result = _handle_self_preservation(
        g, 'self_preservation_hired_gun_elite',
        {'figure_key': 'Hired Gun Elite-0-0'},
    )
    assert result['applied'] is True


def test_via_fire_ability_bus():
    g = {}
    result = fire_ability(g, 'self_preservation',
                          {'figure_key': 'Hired Gun-0-0',
                           'trigger': 'on-damage'})
    assert result['applied'] is True


def main():
    cases = [
        ('both_runnable', test_both_on_damage_abilities_runnable),
        ('applies_focus', test_self_preservation_applies_focus),
        ('idempotent_when_focused', test_self_preservation_idempotent_when_focused),
        ('gates_no_figure_key', test_self_preservation_gates_when_no_figure_key),
        ('damaged_figure_key_alias', test_self_preservation_accepts_damaged_figure_key_alias),
        ('hired_gun_elite_variant', test_hired_gun_elite_variant_fires_same_handler),
        ('via_fire_ability_bus', test_via_fire_ability_bus),
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
