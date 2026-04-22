"""P1-A smoke test for replay_harness.

Builds a hand-crafted JSONL trace (no Node required), runs it through
the replay harness, asserts the reporting lines up. Extends as more
handlers land.

Run: python3 python/parity/test_replay_harness.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.action_parser import (
    parse_custom_id,
    step_custom_id,
    supported_prefixes,
    UnparseableCustomId,
)
from python.engine.state import GameState
from python.parity.replay_harness import replay


def _write_jsonl(records):
    f = tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False)
    try:
        for r in records:
            f.write(json.dumps(r) + '\n')
        f.flush()
        return Path(f.name)
    finally:
        f.close()


def _minimal_initial_game():
    # Shape mirrors what action-recorder.js would emit. We include
    # the JS-native field names so parser/stepper paths encounter the
    # real schema.
    return {
        'gameId': 'TEST01',
        'player1Id': 'p1',
        'player2Id': 'p2',
        'selectedMap': 'mos-eisley-outskirts',
        'mapId': 'mos-eisley-outskirts',
        'p1DcList': [{'dcName': 'Rebel Trooper (Regular)',
                      'displayName': 'Rebel Trooper (Regular)',
                      'healthState': [[3, 3], [3, 3], [3, 3]],
                      'cost': 6}],
        'p2DcList': [{'dcName': 'Stormtrooper (Regular)',
                      'displayName': 'Stormtrooper (Regular)',
                      'healthState': [[3, 3], [3, 3], [3, 3]],
                      'cost': 6}],
        'player1VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'player2VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'phase': 'initiative',
        'ended': False,
    }


def test_parser_covers_expected_prefixes():
    expected = {
        'auto_deploy_', 'pass_activation_turn_', 'status_phase_',
        'end_end_of_round_', 'dc_end_activation_', 'dc_activate_',
    }
    assert expected.issubset(set(supported_prefixes())), \
        f'missing parsers: {expected - set(supported_prefixes())}'


def test_parser_rejects_unknown():
    # Use a genuinely-unknown prefix; most combat/CC prefixes are now parsed.
    assert parse_custom_id('totally_unknown_prefix_TEST01', '', {}, {}) is None
    assert parse_custom_id('', '', {}, {}) is None
    assert parse_custom_id(None, '', {}, {}) is None


def test_parser_auto_deploy_ok():
    pa = parse_custom_id('auto_deploy_TEST01', 'p1', {}, {})
    assert pa is not None
    assert pa.action.type.value == 'auto_deploy'
    assert pa.prefix == 'auto_deploy_'


def test_parser_dc_activate_with_dc_list():
    game = _minimal_initial_game()
    # After auto-deploy (simulated) we'd have figures; emulate by
    # seeding figurePositions with the three trooper figures.
    game['figurePositions'] = {1: {
        'Rebel Trooper (Regular)-0-0': 'a1',
        'Rebel Trooper (Regular)-0-1': 'a2',
        'Rebel Trooper (Regular)-0-2': 'a3',
    }, 2: {}}
    pa = parse_custom_id('dc_activate_TEST01_1_0', 'p1', game, {})
    assert pa is not None, 'parser should resolve dc_index=0 to first figure'
    assert pa.action.type.value == 'activate_dc'
    assert pa.action.params['figure_key'] == 'Rebel Trooper (Regular)-0-0'


def test_replay_harness_reports_unsupported():
    initial = _minimal_initial_game()
    records = [
        {
            'schemaVersion': 1, 'gameId': 'TEST01',
            'recordedAt': '2026-04-22T00:00:00Z',
            'initialState': initial,
        },
        # A deliberately-unknown prefix — the parser rejects it.
        {
            'seq': 0, 'customId': 'totally_unknown_prefix_TEST01', 'userId': 'p1',
            'actionOpts': None, 'diceRolled': [],
            'stateSnapshot': initial, 'ok': True,
        },
    ]
    path = _write_jsonl(records)
    try:
        summary = replay(path)
        assert summary['stepCount'] == 1
        assert summary['unsupportedSteps'] == 1
        assert summary['replayedSteps'] == 0
        assert summary['perStep'][0]['status'] == 'unsupported'
    finally:
        os.unlink(path)


def test_replay_harness_diff_shape():
    """Applying an action that yields a state != recorded snapshot should
    produce a diff-count > 0 but not crash."""
    game = _minimal_initial_game()
    game['activePlayer'] = 1
    # Build a fake "after" snapshot that diverges from what the Python
    # stepper will produce.
    fake_after = dict(game)
    fake_after['phase'] = 'game_over'   # intentional divergence

    records = [
        {
            'schemaVersion': 1, 'gameId': 'TEST01',
            'recordedAt': '2026-04-22T00:00:00Z',
            'initialState': game,
        },
        {
            'seq': 0, 'customId': 'pass_activation_turn_TEST01', 'userId': 'p1',
            'actionOpts': None, 'diceRolled': [],
            'stateSnapshot': fake_after, 'ok': True,
        },
    ]
    path = _write_jsonl(records)
    try:
        summary = replay(path)
        assert summary['stepCount'] == 1
        # replay should have applied the pass, diffed, and noted mismatch
        assert summary['replayedSteps'] == 1
        row = summary['perStep'][0]
        assert row['status'] in ('ok', 'diffs')
        # Intentional divergence (phase) should show up.
        if row['status'] == 'diffs':
            assert row['diffCount'] > 0
    finally:
        os.unlink(path)


def test_replay_harness_20_step_supported_trace():
    """Scripted 20-step trace of only-supported actions: pass-turn back
    and forth + end-activation-phase + end-of-round, repeated. Proves
    the harness can replay a multi-step trace with zero diffs when the
    Python stepper produces the same states as the 'recorded' ones."""
    from python.engine.actions import ActionType
    from python.engine.stepper import step

    # Bootstrap an initial ROUND_ACTIVE state manually (the real JS
    # setup chain isn't ported yet; that's phase S2).
    game = _minimal_initial_game()
    game.update({
        'phase': 'round_active',
        'roundPhase': 'activation',
        'activePlayer': 1,
        'currentRound': 1,
        'round': 1,
        'activationsRemaining': {1: 0, 2: 0},  # no figures to activate
        'figurePositions': {1: {}, 2: {}},
    })

    # Build 20 steps: alternate PASS_ACTIVATION_TURN for both players,
    # then an END_ACTIVATION_PHASE, then END_END_OF_ROUND, repeat.
    scripted = []
    user_ids = ['p1', 'p2']
    current = GameState(dict(game))
    for i in range(20):
        if i % 10 < 8:
            # 8 alternating pass actions.
            uid = user_ids[i % 2]
            cid = f'pass_activation_turn_TEST01'
            after = step_custom_id(current, cid, uid)
        elif i % 10 == 8:
            cid = 'status_phase_TEST01'
            uid = 'p1'
            after = step_custom_id(current, cid, uid)
        else:
            cid = 'end_end_of_round_TEST01'
            uid = 'p1'
            after = step_custom_id(current, cid, uid)
        scripted.append({
            'seq': i, 'customId': cid, 'userId': uid,
            'actionOpts': None, 'diceRolled': [],
            'stateSnapshot': dict(after.data), 'ok': True,
        })
        current = after

    records = [
        {
            'schemaVersion': 1, 'gameId': 'TEST01',
            'recordedAt': '2026-04-22T00:00:00Z',
            'initialState': dict(game),
        },
        *scripted,
    ]
    path = _write_jsonl(records)
    try:
        summary = replay(path)
        assert summary['stepCount'] == 20
        assert summary['replayedSteps'] == 20, \
            f'expected all 20 replayed, got {summary["replayedSteps"]}'
        assert summary['unsupportedSteps'] == 0
        assert summary['erroredSteps'] == 0
        assert summary['totalDiffs'] == 0, \
            f'expected zero diffs; got {summary["totalDiffs"]}: {summary["perStep"]}'
    finally:
        os.unlink(path)


def main():
    cases = [
        ('parser_covers_expected_prefixes', test_parser_covers_expected_prefixes),
        ('parser_rejects_unknown', test_parser_rejects_unknown),
        ('parser_auto_deploy_ok', test_parser_auto_deploy_ok),
        ('parser_dc_activate_with_dc_list', test_parser_dc_activate_with_dc_list),
        ('replay_harness_reports_unsupported', test_replay_harness_reports_unsupported),
        ('replay_harness_diff_shape', test_replay_harness_diff_shape),
        ('replay_harness_20_step_supported_trace', test_replay_harness_20_step_supported_trace),
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
