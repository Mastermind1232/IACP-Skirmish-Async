"""Tests for the phase_gate Discord handler."""
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
    from python.discord_bot.handlers import phase_gate as ph
    handlers.reset_for_tests()
    # Re-register the two phase-gate handlers without reloading the module
    # (reload would fail because the module-level register() calls would
    # see the prefixes already registered on a subsequent import).
    handlers.register('phase_gate_ready_', ph._handle_phase_gate_ready, 'phaseGate')
    handlers.register('phase_gate_unready_', ph._handle_phase_gate_unready, 'phaseGate')


def _new_game_with_gate(gate_phase='deploy_done', p1_id='alice', p2_id='bob'):
    from python.engine.creation import create_game
    from python.engine.mechanics.phase_gate import create_phase_gate
    g = create_game()
    g.data['player1Id'] = p1_id
    g.data['player2Id'] = p2_id
    g.data['round'] = 2
    create_phase_gate(g, gate_phase)
    return g


def test_phase_gate_ready_marks_p1_and_returns_status():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game_with_gate()
    store = {'G1': g}
    ctx = {
        'get_game': lambda gid: store.get(gid),
        'save_games': lambda: None,
        'log_game_action': None,
    }
    _, handler, _ = find_handler('phase_gate_ready_G1')
    result = handler(_Interaction('phase_gate_ready_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['gate']['p1Ready'] is True
    assert result['gate']['p2Ready'] is False
    assert 'waiting on P2' in result['statusText']
    assert result['bothReady'] is False


def test_phase_gate_ready_both_players_sets_both_ready():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game_with_gate()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_ready_G1')
    # P1 ready
    r1 = handler(_Interaction('phase_gate_ready_G1', user_id='alice'), ctx)
    # Re-wire the store to the new game (step returned a copy)
    store['G1'] = r1['game']
    # P2 ready
    r2 = handler(_Interaction('phase_gate_ready_G1', user_id='bob'), ctx)
    assert r2['bothReady'] is True
    assert '✅' in r2['statusText']


def test_phase_gate_ready_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game_with_gate()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_ready_G1')
    result = handler(_Interaction('phase_gate_ready_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def test_phase_gate_ready_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_ready_MISSING')
    result = handler(_Interaction('phase_gate_ready_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def test_phase_gate_unready_flips_back():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    from python.engine.mechanics.phase_gate import record_phase_gate_ready
    g = _new_game_with_gate()
    record_phase_gate_ready(g, 'alice')  # pre-ready P1
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_unready_G1')
    result = handler(_Interaction('phase_gate_unready_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['gate']['p1Ready'] is False


def test_phase_gate_status_embed_has_description_and_color():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _new_game_with_gate()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_ready_G1')
    result = handler(_Interaction('phase_gate_ready_G1', user_id='alice'), ctx)
    assert 'description' in result['statusEmbed']
    assert 'color' in result['statusEmbed']


def test_phase_gate_round_number_in_status():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    # Use cc_drawn gate which includes {round} in its label template
    g = _new_game_with_gate(gate_phase='cc_drawn')
    g.data['round'] = 5
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('phase_gate_ready_G1')
    result = handler(_Interaction('phase_gate_ready_G1', user_id='alice'), ctx)
    # {round} is substituted to 5
    assert 'Round 5' in result['statusText']


def main():
    cases = [
        ('ready_marks_p1', test_phase_gate_ready_marks_p1_and_returns_status),
        ('ready_both_players', test_phase_gate_ready_both_players_sets_both_ready),
        ('ready_rejects_non_player', test_phase_gate_ready_rejects_non_player),
        ('ready_game_not_found', test_phase_gate_ready_game_not_found),
        ('unready_flips_back', test_phase_gate_unready_flips_back),
        ('status_embed_shape', test_phase_gate_status_embed_has_description_and_color),
        ('round_number_in_status', test_phase_gate_round_number_in_status),
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
