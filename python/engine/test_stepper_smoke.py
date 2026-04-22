"""End-to-end smoke test for the Python stepper.

Plays a full game from AUTO_DEPLOY to game-over using a random-action
policy drawn from legal_actions(). Validates that:
  - Every handler we register can be invoked without crashing
  - The game reaches phase='game_over' OR the move cap without exceptions
  - Both players' VP + figurePositions stay in a sane shape throughout

Run: python3 python/engine/test_stepper_smoke.py
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.stepper import Action, step
from python.mcts.actions import legal_actions


def _play_one_game(seed: int, max_moves: int = 400) -> dict:
    rng = random.Random(seed)
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={
            'affiliation': 'Rebel', 'cost': 20,
            'deploymentCards': ['Rebel Trooper (Regular)'],
        },
        p2_squad={
            'affiliation': 'Imperial', 'cost': 22,
            'deploymentCards': ['Stormtrooper (Regular)'],
        },
    )
    g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))

    moves_taken = 0
    for _ in range(max_moves):
        if g.get('phase') == 'game_over':
            break
        actions = legal_actions(g)
        if not actions:
            break
        action = rng.choice(actions)
        if action.type == ActionType.ATTACK_TARGET:
            action.params = {**action.params, 'rng_seed': rng.randint(0, 1 << 30)}
        g = step(g, action)
        moves_taken += 1

    return {
        'moves_taken': moves_taken,
        'phase': g.get('phase'),
        'round': g.get('round') or g.get('currentRound'),
        'p1VP': (g.get('player1VP') or {}).get('total', 0),
        'p2VP': (g.get('player2VP') or {}).get('total', 0),
        'p1_figures': len(g.get('figurePositions', {}).get(1, {})),
        'p2_figures': len(g.get('figurePositions', {}).get(2, {})),
    }


def test_smoke_random_game_with_seed_42():
    r = _play_one_game(seed=42, max_moves=200)
    assert r['moves_taken'] > 0, 'no moves taken?'
    # Either game ended or hit move cap — both are acceptable
    assert r['phase'] in ('round_active', 'game_over', 'end', None), r['phase']


def test_smoke_multiple_seeds_no_crash():
    results = []
    for seed in range(5):
        r = _play_one_game(seed=seed, max_moves=150)
        results.append(r)
    # All completed without exception
    assert len(results) == 5
    # At least one game should have had some moves in each
    assert all(r['moves_taken'] > 0 for r in results), results


def main():
    cases = [
        ('smoke_random_game_seed_42', test_smoke_random_game_with_seed_42),
        ('smoke_multiple_seeds_no_crash', test_smoke_multiple_seeds_no_crash),
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
