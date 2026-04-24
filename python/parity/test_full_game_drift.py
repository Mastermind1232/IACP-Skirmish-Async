"""P1-F smoke test for full_game_drift.

Builds 10 synthetic JSONL traces that only use currently-ported actions
(pass_activation_turn, status_phase, end_end_of_round) — applies each
through the Python stepper AS the "JS-recorded" snapshot, then runs the
drift watchdog over the resulting trace directory. Expects zero diffs.

Run: python3 python/parity/test_full_game_drift.py
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.action_parser import step_custom_id
from python.engine.state import GameState
from python.parity.full_game_drift import run_drift


def _minimal_initial_game(game_id):
    return {
        'gameId': game_id,
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
        'phase': 'round_active',
        'roundPhase': 'activation',
        'activePlayer': 1,
        'currentRound': 1,
        'round': 1,
        'activationsRemaining': {1: 0, 2: 0},
        'figurePositions': {1: {}, 2: {}},
        'ended': False,
    }


def _scripted_trace(game_id: str, steps: int = 5):
    """Produce a JSONL trace (as a list of records) using only supported
    actions. Each step's postState is what the Python stepper actually
    produces — that's our "recorded JS" stand-in for smoke testing."""
    initial = _minimal_initial_game(game_id)
    current = GameState(dict(initial))
    records = [{
        'schemaVersion': 1,
        'gameId': game_id,
        'recordedAt': '2026-04-22T00:00:00Z',
        'initialState': dict(initial),
    }]
    # Cycle: p1 pass → p2 pass → end activation phase → end round → repeat.
    CYCLE = [
        ('pass_activation_turn_{gid}', 'p1'),
        ('pass_activation_turn_{gid}', 'p2'),
        ('status_phase_{gid}', 'p1'),
        ('end_end_of_round_{gid}', 'p1'),
    ]
    for i in range(steps):
        cid_tmpl, uid = CYCLE[i % len(CYCLE)]
        cid = cid_tmpl.format(gid=game_id)
        new_game = step_custom_id(current, cid, uid, {})
        records.append({
            'seq': i, 'customId': cid, 'userId': uid,
            'actionOpts': None, 'diceRolled': [], 'dicePools': {'attack': {}, 'defense': {}},
            'stateSnapshot': dict(new_game.data), 'ok': True,
        })
        current = new_game
    return records


def _write_traces(tmp_dir: Path, n_games: int) -> list:
    paths = []
    for i in range(n_games):
        records = _scripted_trace(f'DRIFT{i:03d}', steps=5)
        path = tmp_dir / f'game{i:03d}.jsonl'
        with path.open('w') as f:
            for r in records:
                f.write(json.dumps(r) + '\n')
        paths.append(path)
    return paths


def test_drift_zero_diffs_across_10_games():
    tmp = Path(tempfile.mkdtemp(prefix='drift_test_'))
    try:
        paths = _write_traces(tmp, n_games=10)
        summary = run_drift(paths, fail_on_diff=True)
        assert summary['games'] == 10, summary
        assert summary['totalDiffs'] == 0, \
            f'expected zero diffs; got {summary["totalDiffs"]}: firstDiff={summary["firstDiff"]}'
        assert summary['erroredSteps'] == 0, \
            f'expected zero errored steps; got {summary["erroredSteps"]}'
        assert summary['replayedSteps'] == 50, \
            f'expected 50 replayed steps (10 games × 5 steps); got {summary["replayedSteps"]}'
    finally:
        shutil.rmtree(tmp)


def test_drift_reports_first_diff_location():
    """When a trace has an intentional mismatch, firstDiff is populated."""
    tmp = Path(tempfile.mkdtemp(prefix='drift_test_'))
    try:
        # Build a one-step trace where the "recorded" post-state is wrong.
        game_id = 'BAD001'
        initial = _minimal_initial_game(game_id)
        current = GameState(dict(initial))
        # Apply for real:
        real_after = step_custom_id(current, f'pass_activation_turn_{game_id}', 'p1', {})
        # But record a WRONG post-state (wrong activePlayer):
        bogus_after = dict(real_after.data)
        # Note: activePlayer is now filtered as a Python-native field
        # (JS uses currentActivationTurnPlayerId). Use `round` to trigger
        # the diff — it's a universal field the filter doesn't touch.
        bogus_after['round'] = 999
        records = [
            {'schemaVersion': 1, 'gameId': game_id, 'recordedAt': 'x',
             'initialState': dict(initial)},
            {'seq': 0, 'customId': f'pass_activation_turn_{game_id}', 'userId': 'p1',
             'actionOpts': None, 'diceRolled': [],
             'dicePools': {'attack': {}, 'defense': {}},
             'stateSnapshot': bogus_after, 'ok': True},
        ]
        path = tmp / 'bad.jsonl'
        with path.open('w') as f:
            for r in records:
                f.write(json.dumps(r) + '\n')
        summary = run_drift([path])
        assert summary['totalDiffs'] >= 1
        assert summary['firstDiff'] is not None
        assert summary['firstDiff']['gameId'] == game_id
        assert summary['firstDiff']['seq'] == 0
    finally:
        shutil.rmtree(tmp)


def main():
    cases = [
        ('drift_zero_diffs_across_10_games', test_drift_zero_diffs_across_10_games),
        ('drift_reports_first_diff_location', test_drift_reports_first_diff_location),
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
