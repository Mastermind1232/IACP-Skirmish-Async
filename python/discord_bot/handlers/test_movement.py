"""Tests for the movement Discord handler."""
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
    from python.discord_bot.handlers import movement as mv
    handlers.reset_for_tests()
    handlers.register('move_figure_', mv._handle_move_figure, 'movement')
    handlers.register('move_mp_', mv._handle_move_mp, 'movement')
    handlers.register('move_pick_space_', mv._handle_move_pick_space, 'movement')
    handlers.register('move_letter_', mv._handle_move_letter, 'movement')


def _game_with_luke():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader._dc_effects = {
        'Luke': {'figures': 1, 'speed': 5, 'health': 10, 'cost': 12,
                  'affiliation': 'Rebel'},
    }
    # 3x3 grid with 4-connected adjacency
    adj = {}
    for c in range(3):
        for r in range(3):
            cell = f'{chr(97 + c)}{r + 1}'
            ns = []
            for dc, dr in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                nc, nr = c + dc, r + dr
                if 0 <= nc < 3 and 0 <= nr < 3:
                    ns.append(f'{chr(97 + nc)}{nr + 1}')
            adj[cell] = ns
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': adj, 'spaces': list(adj.keys()),
        'blocking': [], 'impassableEdges': [], 'movementBlockingEdges': [],
    }}
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['activePlayer'] = 1
    g.data['activationsRemaining'] = {1: 1, 2: 1}
    g.data['activeFigureKeys'] = ['Luke-0-0']
    g.data['movementPoints'] = 5
    g.data['figurePositions'] = {
        1: {'Luke-0-0': 'a1'}, 2: {},
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke', 'dgIndex': 0}]
    return g


def _cleanup():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_move_figure_sets_move_in_progress():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
        _, handler, _ = find_handler('move_figure_G1_hl1dc0_0')
        result = handler(_Interaction('move_figure_G1_hl1dc0_0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert 'Luke-0-0' in result['figureKey']
        mip = result['game'].data.get('moveInProgress') or {}
        assert 'hl1dc0' in mip
    finally:
        _cleanup()


def test_move_figure_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
        _, handler, _ = find_handler('move_figure_G1_hl1dc0_0')
        result = handler(_Interaction('move_figure_G1_hl1dc0_0', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner_of_dc'
    finally:
        _cleanup()


def test_move_mp_uses_dc_message_meta_for_game_lookup():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {
            'get_game': lambda gid: store.get(gid),
            'save_games': lambda: None,
            'dc_message_meta': {'hl1dc0': {'gameId': 'G1', 'playerNum': 1}},
        }
        _, handler, _ = find_handler('move_mp_hl1dc0_0_3')
        result = handler(_Interaction('move_mp_hl1dc0_0_3'), ctx)
        assert result['ok'] is True
        assert result['mp'] == 3
    finally:
        _cleanup()


def test_move_mp_missing_meta():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None,
           'dc_message_meta': {}}
    _, handler, _ = find_handler('move_mp_hl1dc0_0_3')
    result = handler(_Interaction('move_mp_hl1dc0_0_3'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'msg_id_not_in_meta'


def test_move_pick_space_commits_move():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
        _, handler, _ = find_handler('move_pick_space_G1_hl1dc0_0_a2')
        result = handler(
            _Interaction('move_pick_space_G1_hl1dc0_0_a2', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['space'] == 'a2'
        assert result['game'].data['figurePositions'][1]['Luke-0-0'] == 'a2'
    finally:
        _cleanup()


def test_move_pick_space_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
        _, handler, _ = find_handler('move_pick_space_G1_hl1dc0_0_a2')
        result = handler(
            _Interaction('move_pick_space_G1_hl1dc0_0_a2', user_id='bob'), ctx,
        )
        assert result['ok'] is False
    finally:
        _cleanup()


def test_move_letter_sets_letter():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_luke()
    try:
        store = {'G1': g}
        ctx = {
            'get_game': lambda gid: store.get(gid),
            'save_games': lambda: None,
            'dc_message_meta': {'hl1dc0': {'gameId': 'G1', 'playerNum': 1}},
        }
        _, handler, _ = find_handler('move_letter_hl1dc0_0_A')
        result = handler(_Interaction('move_letter_hl1dc0_0_A'), ctx)
        assert result['ok'] is True
        assert result['letter'] == 'A'
    finally:
        _cleanup()


def main():
    cases = [
        ('move_figure_sets_in_progress', test_move_figure_sets_move_in_progress),
        ('move_figure_non_owner', test_move_figure_rejects_non_owner),
        ('move_mp_uses_meta', test_move_mp_uses_dc_message_meta_for_game_lookup),
        ('move_mp_missing_meta', test_move_mp_missing_meta),
        ('move_pick_space_commits', test_move_pick_space_commits_move),
        ('move_pick_space_non_owner', test_move_pick_space_rejects_non_owner),
        ('move_letter', test_move_letter_sets_letter),
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
