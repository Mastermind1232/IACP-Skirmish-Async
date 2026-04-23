"""Pattern D — Fury (Wookiee Warrior Elite/Regular) combat-dice oracle [D3.21].

While attacking, if attacker has suffered 5+ damage, grant +1 Surge.
JS reference: src/handlers/combat.js:1847-1851 + src/game/fury-helpers.js.
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
from python.engine.abilities.pattern_d_handlers import (
    FURY_MIN_DAMAGE, FURY_SURGE_BONUS, handle_fury,
)


def _combat():
    return {'attackInfo': {'dice': ['red']}}


def test_fury_constants_match_js():
    assert FURY_MIN_DAMAGE == 5
    assert FURY_SURGE_BONUS == 1


def test_both_fury_abilities_runnable():
    r = pattern_d_runnable_ids()
    assert 'fury_wookiee_elite' in r
    assert 'fury_wookiee_reg' in r
    for aid in ('fury_wookiee_elite', 'fury_wookiee_reg'):
        info = get_handler_for(aid)
        assert info is not None
        trigger, handler = info
        assert trigger == 'combat-dice'
        assert not is_stub(handler)


def test_fires_at_exact_threshold():
    combat = _combat()
    result = handle_fury(
        {}, 'fury_wookiee_elite',
        {'combat': combat, 'attacker_damage_suffered': 5},
    )
    assert result['applied'] is True
    assert combat.get('furyBonus') == 1
    assert 'Furious' in result['log_message']
    assert '5' in result['log_message']


def test_fires_above_threshold():
    combat = _combat()
    result = handle_fury(
        {}, 'fury_wookiee_reg',
        {'combat': combat, 'attacker_damage_suffered': 8},
    )
    assert result['applied'] is True
    assert combat['furyBonus'] == 1
    assert '8' in result['log_message']


def test_gates_below_threshold():
    combat = _combat()
    result = handle_fury(
        {}, 'fury_wookiee_elite',
        {'combat': combat, 'attacker_damage_suffered': 4},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'atkDamageSuffered<5'
    assert 'furyBonus' not in combat


def test_gates_zero_damage():
    combat = _combat()
    result = handle_fury(
        {}, 'fury_wookiee_elite',
        {'combat': combat, 'attacker_damage_suffered': 0},
    )
    assert result['applied'] is False


def test_gates_missing_combat():
    result = handle_fury(
        {}, 'fury_wookiee_elite',
        {'attacker_damage_suffered': 6},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'missing-combat'


def test_both_variants_share_handler_behavior():
    combat_e = _combat()
    combat_r = _combat()
    ctx = {'attacker_damage_suffered': 6}
    re = handle_fury({}, 'fury_wookiee_elite', {**ctx, 'combat': combat_e})
    rr = handle_fury({}, 'fury_wookiee_reg', {**ctx, 'combat': combat_r})
    assert re['applied'] is True
    assert rr['applied'] is True
    assert combat_e['furyBonus'] == combat_r['furyBonus'] == 1


def test_via_fire_ability_bus():
    combat = _combat()
    result = fire_ability(
        {}, 'fury_wookiee_elite',
        {'combat': combat, 'attacker_damage_suffered': 7,
         'trigger': 'combat-dice'},
    )
    assert result['applied'] is True


def main():
    cases = [
        ('constants_match', test_fury_constants_match_js),
        ('both_runnable', test_both_fury_abilities_runnable),
        ('fires_at_threshold', test_fires_at_exact_threshold),
        ('fires_above', test_fires_above_threshold),
        ('gates_below', test_gates_below_threshold),
        ('gates_zero', test_gates_zero_damage),
        ('gates_missing_combat', test_gates_missing_combat),
        ('variants_parity', test_both_variants_share_handler_behavior),
        ('via_bus', test_via_fire_ability_bus),
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
