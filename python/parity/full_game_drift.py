"""P1-F: full-game drift watchdog.

Replays JS-recorded games through the Python engine with synchronized
dice, diffing the Python-derived state against the JS-recorded snapshot
at every step. First-diff-location reporting so a failure pinpoints the
handler that's drifting.

Integrates the parity infrastructure from P1-A (replay harness),
P1-B (DiceStream), and P1-C (action-recorder dicePools emit). Walks
a directory of JSONL traces produced by action-recorder.js (or the
dump-action-fuzz.js long-trace mode once that lands) and reports:

    {
      games: int,
      replayedSteps: int,
      unsupportedSteps: int,
      erroredSteps: int,
      totalDiffs: int,
      firstDiff: {gameId, seq, customId, diffs[:8]} | null,
      perGame: [{file, gameId, stepCount, replayedSteps,
                 unsupportedSteps, erroredSteps, totalDiffs}],
    }

CLI:
    python -m python.parity.full_game_drift --traces path/to/*.jsonl
    python -m python.parity.full_game_drift --traces traces/ --fail-on-diff
    python -m python.parity.full_game_drift --games 10 --trace-dir traces/

Exit codes:
    0: all games replayed with zero diffs (for supported actions)
    1: one or more games had diffs
    2: trace load/schema error
"""
from __future__ import annotations

import argparse
import glob
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from python.parity.replay_harness import replay


def _collect_trace_paths(
    traces_glob: Optional[str],
    trace_dir: Optional[str],
    limit: Optional[int],
) -> List[Path]:
    """Resolve --traces (glob) and/or --trace-dir (directory) into a path list."""
    paths: List[Path] = []
    if traces_glob:
        for m in glob.glob(traces_glob, recursive=True):
            p = Path(m)
            if p.is_file():
                paths.append(p)
    if trace_dir:
        d = Path(trace_dir)
        if not d.is_dir():
            raise FileNotFoundError(f'--trace-dir not a directory: {d}')
        for p in sorted(d.glob('*.jsonl')):
            paths.append(p)
    # De-duplicate while preserving order.
    seen = set()
    unique: List[Path] = []
    for p in paths:
        if p not in seen:
            unique.append(p)
            seen.add(p)
    if limit and limit > 0:
        unique = unique[:limit]
    return unique


def run_drift(
    trace_paths: List[Path],
    fail_on_diff: bool = False,
    max_diffs_per_step: int = 8,
) -> Dict[str, Any]:
    per_game: List[Dict[str, Any]] = []
    total = {
        'games': 0,
        'replayedSteps': 0,
        'unsupportedSteps': 0,
        'erroredSteps': 0,
        'totalDiffs': 0,
    }
    first_diff: Optional[Dict[str, Any]] = None

    for path in trace_paths:
        summary = replay(path, max_diffs_per_step=max_diffs_per_step)
        per_game.append({
            'file': str(path),
            'gameId': summary['gameId'],
            'stepCount': summary['stepCount'],
            'replayedSteps': summary['replayedSteps'],
            'unsupportedSteps': summary['unsupportedSteps'],
            'erroredSteps': summary['erroredSteps'],
            'totalDiffs': summary['totalDiffs'],
        })
        total['games'] += 1
        total['replayedSteps'] += summary['replayedSteps']
        total['unsupportedSteps'] += summary['unsupportedSteps']
        total['erroredSteps'] += summary['erroredSteps']
        total['totalDiffs'] += summary['totalDiffs']

        if first_diff is None:
            for row in summary['perStep']:
                if row.get('status') == 'diffs' and row.get('diffCount', 0) > 0:
                    first_diff = {
                        'file': str(path),
                        'gameId': summary['gameId'],
                        'seq': row['seq'],
                        'customId': row['customId'],
                        'diffCount': row['diffCount'],
                        'diffs': row.get('diffs') or [],
                    }
                    break

        if fail_on_diff and summary['totalDiffs'] > 0:
            break

    return {
        **total,
        'firstDiff': first_diff,
        'perGame': per_game,
    }


def _format_report(summary: Dict[str, Any]) -> str:
    lines = [
        f'games={summary["games"]}  '
        f'replayedSteps={summary["replayedSteps"]}  '
        f'unsupported={summary["unsupportedSteps"]}  '
        f'errored={summary["erroredSteps"]}  '
        f'totalDiffs={summary["totalDiffs"]}',
    ]
    if summary['firstDiff']:
        fd = summary['firstDiff']
        lines.append(
            f'  firstDiff: {fd["file"]} gameId={fd["gameId"]} '
            f'seq={fd["seq"]} customId={fd["customId"]} diffs={fd["diffCount"]}'
        )
        for d in fd.get('diffs', [])[:4]:
            lines.append(f'    {d}')
    for row in summary['perGame']:
        marker = 'OK' if row['totalDiffs'] == 0 and row['erroredSteps'] == 0 else 'DIFF'
        lines.append(
            f'  [{marker}] {row["file"]}  gameId={row["gameId"]}  '
            f'steps={row["stepCount"]}  replayed={row["replayedSteps"]}  '
            f'unsupported={row["unsupportedSteps"]}  diffs={row["totalDiffs"]}'
        )
    return '\n'.join(lines)


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description='Full-game JS→Python drift watchdog')
    ap.add_argument('--traces', help='glob pattern for JSONL trace files')
    ap.add_argument('--trace-dir', help='directory containing *.jsonl traces')
    ap.add_argument('--games', type=int, default=None,
                    help='limit: only replay the first N games')
    ap.add_argument('--fail-on-diff', action='store_true',
                    help='stop at the first game with diffs')
    ap.add_argument('--max-diffs', type=int, default=8)
    ap.add_argument('--json', action='store_true', help='emit JSON report')
    args = ap.parse_args(argv)

    if not args.traces and not args.trace_dir:
        print('ERROR: --traces or --trace-dir required', file=sys.stderr)
        return 2

    try:
        paths = _collect_trace_paths(args.traces, args.trace_dir, args.games)
    except FileNotFoundError as e:
        print(f'ERROR: {e}', file=sys.stderr)
        return 2
    if not paths:
        print('ERROR: no trace files found', file=sys.stderr)
        return 2

    summary = run_drift(paths, fail_on_diff=args.fail_on_diff,
                        max_diffs_per_step=args.max_diffs)
    if args.json:
        print(json.dumps(summary, indent=2, sort_keys=True))
    else:
        print(_format_report(summary))

    if summary['totalDiffs'] == 0 and summary['erroredSteps'] == 0:
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
