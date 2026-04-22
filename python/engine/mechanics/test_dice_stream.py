"""P1-B: unit tests for DiceStream replay mode.

Proves the contract from python/parity/dice_stream_schema.md:
  1. rollAttackDice consumes pools.attack[c] in call order.
  2. rollDefenseDice consumes pools.defense[c] once.
  3. Exhausted pool → DiceStreamExhausted (never silent Math.random fallback).
  4. Recorder + stream composes: record a run, then replay, byte-identical.
  5. Two independent replays of the same stream produce identical outputs.

Run: python3 python/engine/mechanics/test_dice_stream.py
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.dice import (
    DiceRecorder,
    DiceStream,
    DiceStreamExhausted,
    roll_attack_dice,
    roll_defense_dice,
    roll_single_attack_die,
    roll_single_defense_die,
)


def _make_stream(pools):
    return DiceStream(pools={'attack': pools.get('attack', {}),
                             'defense': pools.get('defense', {})})


def test_roll_attack_dice_consumes_in_order():
    s = _make_stream({
        'attack': {'blue': [0, 1, 2], 'green': [3, 0]},
    })
    r = roll_attack_dice(['blue', 'green', 'blue'], stream=s)
    assert len(r['dice']) == 3
    # Pool state after: blue should have 1 remaining, green 1 remaining.
    assert s.pools['attack']['blue'] == [2]
    assert s.pools['attack']['green'] == [0]


def test_roll_defense_dice_pops_one():
    s = _make_stream({
        'defense': {'white': [0, 5], 'black': [3]},
    })
    r = roll_defense_dice('white', stream=s)
    assert 'block' in r
    assert s.pools['defense']['white'] == [5]


def test_exhausted_pool_raises():
    s = _make_stream({'attack': {'red': [0]}})
    roll_single_attack_die('red', stream=s)  # consumes the one
    try:
        roll_single_attack_die('red', stream=s)
    except DiceStreamExhausted:
        return
    raise AssertionError('expected DiceStreamExhausted')


def test_missing_pool_color_raises():
    s = _make_stream({'attack': {}})
    try:
        roll_attack_dice(['blue'], stream=s)
    except DiceStreamExhausted:
        return
    raise AssertionError('expected DiceStreamExhausted when color missing')


def test_record_then_replay_identical():
    """Record a run off the default RNG, then replay through a stream.
    Both outputs must match."""
    import random
    rng = random.Random(42)
    recorder = DiceRecorder()

    a_colors = ['blue', 'green', 'blue', 'yellow']
    a_run1 = roll_attack_dice(a_colors, recorder=recorder, rng=rng)
    d_run1 = roll_defense_dice('black', recorder=recorder, rng=rng)

    # Replay via a stream seeded from the recorder's pools.
    replay_pools = {
        'attack': {c: list(q) for c, q in recorder.pools.get('attack', {}).items()},
        'defense': {c: list(q) for c, q in recorder.pools.get('defense', {}).items()},
    }
    s = _make_stream(replay_pools)
    a_run2 = roll_attack_dice(a_colors, stream=s)
    d_run2 = roll_defense_dice('black', stream=s)

    assert a_run1 == a_run2, f'attack mismatch:\n{a_run1}\n{a_run2}'
    assert d_run1 == d_run2, f'defense mismatch:\n{d_run1}\n{d_run2}'


def test_two_independent_replays_match():
    """Same stream JSON loaded twice produces identical outputs."""
    stream_dict = {
        'version': 1,
        'gameId': 'T',
        'pools': {
            'attack': {'red': [0, 2, 4], 'blue': [1, 3]},
            'defense': {'white': [0, 2], 'black': [1]},
        },
    }

    s1 = DiceStream.from_dict(copy.deepcopy(stream_dict))
    s2 = DiceStream.from_dict(copy.deepcopy(stream_dict))

    run1 = [
        roll_attack_dice(['red', 'blue', 'red'], stream=s1),
        roll_defense_dice('white', stream=s1),
        roll_attack_dice(['blue', 'red'], stream=s1),
        roll_defense_dice('white', stream=s1),
        roll_defense_dice('black', stream=s1),
    ]
    run2 = [
        roll_attack_dice(['red', 'blue', 'red'], stream=s2),
        roll_defense_dice('white', stream=s2),
        roll_attack_dice(['blue', 'red'], stream=s2),
        roll_defense_dice('white', stream=s2),
        roll_defense_dice('black', stream=s2),
    ]
    assert json.dumps(run1, sort_keys=True) == json.dumps(run2, sort_keys=True)


def test_recorder_log_ordering():
    recorder = DiceRecorder()
    roll_attack_dice(['blue', 'green'], recorder=recorder, rng=None,
                    stream=_make_stream({'attack': {'blue': [0], 'green': [0]}}))
    roll_defense_dice('white', recorder=recorder,
                     stream=_make_stream({'defense': {'white': [0]}}))
    # Three entries: two attack, one defense, seq 0..2.
    assert len(recorder.log) == 3
    assert [e['seq'] for e in recorder.log] == [0, 1, 2]
    assert [e['role'] for e in recorder.log] == ['attack', 'attack', 'defense']


def test_from_dict_version_field():
    d = {'version': 2, 'gameId': 'X', 'pools': {'attack': {'red': [1]}, 'defense': {}}}
    s = DiceStream.from_dict(d)
    assert s.version == 2
    assert s.gameId == 'X'
    assert s.pools['attack']['red'] == [1]


def main():
    cases = [
        ('roll_attack_dice_consumes_in_order', test_roll_attack_dice_consumes_in_order),
        ('roll_defense_dice_pops_one', test_roll_defense_dice_pops_one),
        ('exhausted_pool_raises', test_exhausted_pool_raises),
        ('missing_pool_color_raises', test_missing_pool_color_raises),
        ('record_then_replay_identical', test_record_then_replay_identical),
        ('two_independent_replays_match', test_two_independent_replays_match),
        ('recorder_log_ordering', test_recorder_log_ordering),
        ('from_dict_version_field', test_from_dict_version_field),
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
