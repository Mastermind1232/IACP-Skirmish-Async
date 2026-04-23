"""Pattern D — `freeMoveEqualToSpeed` handler oracle (charge + wall_run).

JS reference: src/game/abilities.js:1895-1910. The handler grants MP
equal to the DC's speed and, for Charge, also marks
`game.freeAttackBonusPending[msgId] = True`.
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
    _handle_free_move_equal_to_speed,
)


def _dummy_dc_effects(speed=5):
    return {
        'TestDC': {
            'specialAbilityIds': ['charge'],
            'figures': 1, 'speed': speed, 'health': 10, 'cost': 10,
        },
    }


def _fresh_game():
    return {}


def test_charge_grants_speed_mp_and_free_attack_flag():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = _dummy_dc_effects(speed=5)
    try:
        g = _fresh_game()
        result = _handle_free_move_equal_to_speed(
            g, 'charge', {'dc_name': 'TestDC', 'msg_id': 'hl1dc0'},
        )
        assert result['applied'] is True
        assert result['mpGranted'] == 5
        assert result['freeAttackPending'] is True
        assert result['msgId'] == 'hl1dc0'
        # Side effects
        bank = (g.get('movementBank') or {}).get('hl1dc0')
        assert bank is not None
        assert bank.get('total') == 5
        pending = g.get('freeAttackBonusPending') or {}
        assert pending.get('hl1dc0') is True
    finally:
        dc_effects_loader.reset_cache()


def test_wall_run_grants_speed_mp_without_free_attack_flag():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = _dummy_dc_effects(speed=4)
    try:
        g = _fresh_game()
        result = _handle_free_move_equal_to_speed(
            g, 'wall_run', {'dc_name': 'TestDC', 'msg_id': 'hl1dc0'},
        )
        assert result['applied'] is True
        assert result['mpGranted'] == 4
        assert result['freeAttackPending'] is False
        assert g.get('freeAttackBonusPending') is None
    finally:
        dc_effects_loader.reset_cache()


def test_charge_gates_when_msg_id_missing():
    g = _fresh_game()
    result = _handle_free_move_equal_to_speed(
        g, 'charge', {'dc_name': 'TestDC'},
    )
    assert result['applied'] is False
    assert result['gated_by'] == 'missing-dc-name-or-msg-id'


def test_charge_gates_when_dc_name_missing():
    g = _fresh_game()
    result = _handle_free_move_equal_to_speed(
        g, 'charge', {'msg_id': 'hl1dc0'},
    )
    assert result['applied'] is False


def test_charge_and_wall_run_are_runnable():
    assert 'charge' in pattern_d_runnable_ids()
    assert 'wall_run' in pattern_d_runnable_ids()
    info = get_handler_for('charge')
    assert info is not None
    trigger, handler = info
    assert trigger == 'activation'
    assert not is_stub(handler)


def test_charge_via_fire_ability_bus():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = _dummy_dc_effects(speed=6)
    try:
        g = _fresh_game()
        result = fire_ability(
            g, 'charge', {'dc_name': 'TestDC', 'msg_id': 'hl1dc0',
                          'trigger': 'activation'},
        )
        assert result['applied'] is True
        assert result['mpGranted'] == 6
    finally:
        dc_effects_loader.reset_cache()


def main():
    cases = [
        ('charge_grants_mp_and_flag', test_charge_grants_speed_mp_and_free_attack_flag),
        ('wall_run_no_flag', test_wall_run_grants_speed_mp_without_free_attack_flag),
        ('charge_gates_no_msg', test_charge_gates_when_msg_id_missing),
        ('charge_gates_no_dc', test_charge_gates_when_dc_name_missing),
        ('both_runnable', test_charge_and_wall_run_are_runnable),
        ('via_fire_ability', test_charge_via_fire_ability_bus),
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
