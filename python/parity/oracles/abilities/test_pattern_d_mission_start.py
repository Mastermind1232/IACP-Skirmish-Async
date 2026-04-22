"""Pattern D — mission-start trigger oracle (D3.17 stealthy_davith).

Scope: the `stealthy_davith` ability fires via the Pattern D bus on the
`mission-start` trigger and makes Davith Elso Hidden.

JS reference: `src/handlers/setup.js` calls the mission-start dispatch
after deployment settles; Davith's spec text is "At the start of the
mission, become Hidden."
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
from python.engine.abilities.pattern_d_handlers import handle_stealthy_davith
from python.engine.state import GameState


def _fresh_game() -> GameState:
    g = GameState()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['figurePositions'] = {
        1: {'Davith Elso-0-0': 'a1'},
        2: {},
    }
    return g


def test_stealthy_davith_is_registered_not_stub():
    info = get_handler_for('stealthy_davith')
    assert info is not None, 'stealthy_davith must be registered on the bus'
    trigger, handler = info
    assert trigger == 'mission-start'
    assert handler is handle_stealthy_davith
    assert not is_stub(handler)
    assert 'stealthy_davith' in pattern_d_runnable_ids()


def test_stealthy_davith_applies_hidden_on_fire():
    g = _fresh_game()
    result = handle_stealthy_davith(
        g.data, 'stealthy_davith',
        {'figure_key': 'Davith Elso-0-0', 'trigger': 'mission-start'},
    )
    assert result['applied'] is True
    assert 'Hidden' in result['log_message']
    # Condition was recorded on the figure
    conds = (g.data.get('figureConditions') or {}).get('Davith Elso-0-0') or []
    assert 'Hidden' in conds


def test_stealthy_davith_idempotent_on_second_fire():
    g = _fresh_game()
    handle_stealthy_davith(g.data, 'stealthy_davith',
                            {'figure_key': 'Davith Elso-0-0'})
    second = handle_stealthy_davith(g.data, 'stealthy_davith',
                                     {'figure_key': 'Davith Elso-0-0'})
    # Already Hidden — second fire reports gated
    assert second['applied'] is False
    assert second['gated_by'] == 'already-hidden'


def test_stealthy_davith_requires_figure_key():
    g = _fresh_game()
    result = handle_stealthy_davith(g.data, 'stealthy_davith', {})
    assert result['applied'] is False
    assert result['gated_by'] == 'no-figure-key'


def test_stealthy_davith_via_bus_fire_ability():
    g = _fresh_game()
    result = fire_ability(g.data, 'stealthy_davith',
                          {'figure_key': 'Davith Elso-0-0',
                           'trigger': 'mission-start'})
    assert result['applied'] is True
    conds = (g.data.get('figureConditions') or {}).get('Davith Elso-0-0') or []
    assert 'Hidden' in conds


def main():
    cases = [
        ('stealthy_davith_registered', test_stealthy_davith_is_registered_not_stub),
        ('stealthy_davith_applies_hidden', test_stealthy_davith_applies_hidden_on_fire),
        ('stealthy_davith_idempotent', test_stealthy_davith_idempotent_on_second_fire),
        ('stealthy_davith_requires_fk', test_stealthy_davith_requires_figure_key),
        ('stealthy_davith_via_bus', test_stealthy_davith_via_bus_fire_ability),
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
