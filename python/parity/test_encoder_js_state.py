"""P1-G: validate the Python tensor encoder on real JS game states.

Loads 20 real JS-produced game-state snapshots (from dump-action-fuzz.js
output) and encodes each through `python.encoding.encode.encode_state`,
asserting:

  1. No exceptions (no KeyError, AttributeError, etc.).
  2. Tensor shapes match the expected 96-channel [32,32] spatial +
     1481-dim scalar.
  3. Values are finite (no NaN/Inf).
  4. Sensible population — at least one friendly-footprint cell set
     (figures deployed), at least one scalar slot non-zero (phase / VP
     / etc.).

If any of the 20 states fails these checks, the encoder has a
field-name gap that must be fixed before training can use JS-native
state.

Run: python3 python/parity/test_encoder_js_state.py [--fixtures path]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import List

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.encoding.encode import C, H, S, W, encode_state
from python.engine.state import GameState


DEFAULT_FIXTURE_COUNT = 20
DEFAULT_FIXTURE_SEED = 42


def _ensure_fixtures(count: int, seed: int, path: Path) -> None:
    """Regenerate fixtures via dump-action-fuzz.js if the file is absent."""
    if path.exists():
        return
    cmd = [
        'node', 'tests/headless/dump-action-fuzz.js',
        '--count', str(count),
        '--seed', str(seed),
        '--out', str(path),
    ]
    subprocess.run(cmd, check=True, cwd=REPO_ROOT)


def _load_fixtures(path: Path, limit: int) -> List[dict]:
    out = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            if r.get('skipped'):
                continue
            out.append(r)
            if len(out) >= limit:
                break
    return out


def test_encoder_on_20_js_states(fixtures_path: Path) -> None:
    """Core P1-G assertion."""
    fixtures = _load_fixtures(fixtures_path, DEFAULT_FIXTURE_COUNT)
    assert len(fixtures) >= DEFAULT_FIXTURE_COUNT, (
        f'need {DEFAULT_FIXTURE_COUNT} fixtures; got {len(fixtures)} at {fixtures_path}'
    )

    failures: List[str] = []
    stats = {
        'checked': 0,
        'friendlyPopulated': 0,
        'scalarNonZero': 0,
    }

    for i, fixture in enumerate(fixtures[:DEFAULT_FIXTURE_COUNT]):
        state_dict = fixture.get('postState') or fixture.get('preState')
        if state_dict is None:
            failures.append(f'fixture {i}: no preState/postState')
            continue
        game = GameState(state_dict)
        try:
            spatial, scalar = encode_state(game, pov_player=1)
        except Exception as e:
            failures.append(f'fixture {i} gameId={state_dict.get("gameId")}: '
                            f'{type(e).__name__}: {e}')
            continue

        # Shape check.
        if spatial.shape != (C, H, W):
            failures.append(f'fixture {i}: spatial shape {tuple(spatial.shape)} '
                            f'!= expected ({C}, {H}, {W})')
            continue
        if scalar.shape != (S,):
            failures.append(f'fixture {i}: scalar shape {tuple(scalar.shape)} '
                            f'!= expected ({S},)')
            continue

        # Finite check.
        if not torch.isfinite(spatial).all():
            failures.append(f'fixture {i}: spatial has non-finite values')
            continue
        if not torch.isfinite(scalar).all():
            failures.append(f'fixture {i}: scalar has non-finite values')
            continue

        # Sensibility: at least one friendly-footprint cell set (channel 0)
        # for a mid-game state. If the fixture is round_active, figures
        # should be on board.
        friendly_has_something = (spatial[0] > 0).any().item()
        if state_dict.get('phase') in ('round_active', 'activation'):
            if friendly_has_something:
                stats['friendlyPopulated'] += 1
        # Scalar should always have some non-zero (phase one-hot, VP,
        # activation counts, etc.).
        if (scalar != 0).any().item():
            stats['scalarNonZero'] += 1

        stats['checked'] += 1

    if failures:
        msg = f'{len(failures)} of {DEFAULT_FIXTURE_COUNT} fixtures failed encoding:\n'
        for f in failures[:10]:
            msg += f'  - {f}\n'
        raise AssertionError(msg)

    assert stats['checked'] == DEFAULT_FIXTURE_COUNT, stats
    assert stats['scalarNonZero'] == DEFAULT_FIXTURE_COUNT, (
        f'expected all 20 scalars to have non-zero entries; got '
        f'{stats["scalarNonZero"]}'
    )
    # Figures should be deployed in any round_active state. We require at
    # least half populate the friendly-footprint channel (some states
    # are pre-deployment or post-game where figurePositions can be empty
    # per-side from the acting player's perspective).
    active_count = sum(
        1 for f in fixtures[:DEFAULT_FIXTURE_COUNT]
        if (f.get('postState') or f.get('preState', {})).get('phase')
        in ('round_active', 'activation')
    )
    if active_count:
        assert stats['friendlyPopulated'] >= active_count // 2, (
            f'expected >=50% of {active_count} active-phase states to populate '
            f'friendly-footprint; got {stats["friendlyPopulated"]}'
        )

    print(f'OK: {stats["checked"]}/{DEFAULT_FIXTURE_COUNT} encoded cleanly; '
          f'{stats["friendlyPopulated"]} populated friendly-footprint; '
          f'{stats["scalarNonZero"]} had non-zero scalar entries.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fixtures', type=Path,
                    default=Path('/tmp/fuzz20_p1g.jsonl'))
    ap.add_argument('--count', type=int, default=DEFAULT_FIXTURE_COUNT)
    ap.add_argument('--seed', type=int, default=DEFAULT_FIXTURE_SEED)
    args = ap.parse_args()

    try:
        _ensure_fixtures(args.count, args.seed, args.fixtures)
    except subprocess.CalledProcessError as e:
        print(f'FAIL: fixture generation: {e}', file=sys.stderr)
        sys.exit(1)

    try:
        test_encoder_on_20_js_states(args.fixtures)
        print('PASS: encoder_on_20_js_states')
    except AssertionError as e:
        print(f'FAIL: encoder_on_20_js_states\n{e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
