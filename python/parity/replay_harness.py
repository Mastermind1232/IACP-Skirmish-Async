"""Replay-harness: load JS-recorded JSONL → run through Python engine → diff.

Scope at D6 bootstrap:
  - Read a JSONL file produced by `tests/headless/action-recorder.js`.
  - Load the initial-state snapshot into a Python GameState.
  - Diff the initial state against the snapshot (pure serialization parity).
  - For each subsequent step, STUB the Python apply_action (D2+) and record
    where we would have diffed.

The full replay — actually running each action through the Python engine — is
unlocked deliverable by deliverable as D2–D5 land. Until then, this script:
  1. Round-trips the initial state snapshot (deterministic-JSON test).
  2. Validates the JSONL schema.
  3. Reports how many steps are "replayable" (currently: 0 until D2 arrives).

CLI:
    python -m python.parity.replay_harness --jsonl path/to/game.jsonl
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterator, List

from python.engine.state import GameState
from python.parity.state_diff import state_diff, format_diff


REQUIRED_HEADER_FIELDS = {'schemaVersion', 'gameId', 'initialState'}
REQUIRED_STEP_FIELDS = {'seq', 'customId', 'userId', 'stateSnapshot'}


class ReplayError(Exception):
    pass


def iter_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    with path.open('r') as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as e:
                raise ReplayError(f'{path}:{lineno} invalid JSON: {e}') from e


def replay(jsonl_path: Path) -> Dict[str, Any]:
    """Replay a recording; return a summary dict.

    Summary: {
      'gameId': str,
      'stepCount': int,
      'initialStateDiffs': int,
      'replayableSteps': int,        # always 0 until D2
      'pendingDeliverables': List[str],
    }
    """
    records = list(iter_jsonl(jsonl_path))
    if not records:
        raise ReplayError(f'{jsonl_path}: empty file')

    header = records[0]
    missing_header = REQUIRED_HEADER_FIELDS - set(header.keys())
    if missing_header:
        raise ReplayError(
            f'{jsonl_path}:1 header missing fields: {sorted(missing_header)}'
        )

    initial_state = GameState(header['initialState'])
    round_tripped = GameState.from_json(initial_state.to_json())
    init_diffs = state_diff(initial_state, round_tripped)

    step_records = records[1:]
    for i, rec in enumerate(step_records, start=2):
        missing_step = REQUIRED_STEP_FIELDS - set(rec.keys())
        if missing_step:
            raise ReplayError(
                f'{jsonl_path}:{i} step missing fields: {sorted(missing_step)}'
            )

    return {
        'gameId': header['gameId'],
        'stepCount': len(step_records),
        'initialStateDiffs': len(init_diffs),
        'initialStateDiffReport': format_diff(init_diffs) if init_diffs else None,
        'replayableSteps': 0,
        'pendingDeliverables': ['D2', 'D3', 'D4', 'D5'],
    }


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='JS→Python replay-harness (D6 bootstrap)')
    ap.add_argument('--jsonl', required=True, type=Path)
    args = ap.parse_args(argv)
    try:
        summary = replay(args.jsonl)
    except ReplayError as e:
        print(f'REPLAY-ERROR: {e}', file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary['initialStateDiffs'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
