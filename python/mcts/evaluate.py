"""D10 — evaluation harness: play N games between two checkpoints.

Usage:
    python3 python/mcts/evaluate.py --new latest.pt --old init.pt --games 20

Reports:
    new-wins / old-wins / draws
    average game length
    average VP margin (new - old)

Each game uses MCTS with a small simulation budget for speed; matches
are split evenly between "new plays as p1" and "new plays as p2" so
seat-of-play bias doesn't skew the result.
"""
from __future__ import annotations

import argparse
import random as _random
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import Action, step
from python.mcts.search import MCTS, _terminal_reward_p1
from python.net.batched_eval import select_device
from python.net.skirbo_cnn import CNNConfig, SkirboCNN


@dataclass
class GameResult:
    winner: int  # 1 = new wins, -1 = old wins, 0 = draw
    length: int
    new_vp: int
    old_vp: int


def _load_net(path: Path, device: torch.device) -> SkirboCNN:
    payload = torch.load(path, map_location='cpu', weights_only=False)
    cfg_dict = payload.get('net_config') or {}
    net = SkirboCNN(CNNConfig(
        n_channels=cfg_dict.get('n_channels', 128),
        n_res_blocks=cfg_dict.get('n_res_blocks', 6),
    ))
    # Handle torch.compile'd checkpoints: strip '_orig_mod.' prefix if present.
    sd = payload['state_dict']
    stripped = {}
    for k, v in sd.items():
        key = k.replace('_orig_mod.', '')
        stripped[key] = v
    net.load_state_dict(stripped, strict=False)
    net.to(device)
    net.eval()
    return net


def _fresh_game() -> GameState:
    g = create_game(
        map_id='mos-eisley-outskirts',
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    return step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))


def _play_game(
    new_net: SkirboCNN,
    old_net: SkirboCNN,
    device: torch.device,
    new_plays_as: int,
    n_simulations: int,
    max_moves: int,
    seed: int,
) -> GameResult:
    """Play one game. Whichever side `new_net` controls is `new_plays_as`
    (1 or 2). Returns result from new_net's perspective."""
    rng = _random.Random(seed)
    g = _fresh_game()
    mcts_new = MCTS(
        new_net, device=device, n_simulations=n_simulations,
        attack_rng_seed=rng.randint(0, 1 << 30),
    )
    mcts_old = MCTS(
        old_net, device=device, n_simulations=n_simulations,
        attack_rng_seed=rng.randint(0, 1 << 30),
    )

    for move in range(max_moves):
        if g.get('phase') == 'game_over':
            break
        active = int(g.get('activePlayer') or 1)
        mcts = mcts_new if active == new_plays_as else mcts_old
        try:
            action, _ = mcts.run(g)
        except RuntimeError:
            break
        if action is None:
            break
        if action.type == ActionType.ATTACK_TARGET:
            action.params = {
                **action.params,
                'rng_seed': rng.randint(0, 1 << 30),
            }
        try:
            g = step(g, action)
        except Exception:
            g.data['phase'] = 'game_over'
            break

    reward_p1 = _terminal_reward_p1(g) if g.get('phase') == 'game_over' else 0.0
    # Translate to new_net's POV.
    new_reward = reward_p1 if new_plays_as == 1 else -reward_p1
    winner = 1 if new_reward > 0 else (-1 if new_reward < 0 else 0)
    p1_vp = (g.get('player1VP') or {}).get('total', 0) or 0
    p2_vp = (g.get('player2VP') or {}).get('total', 0) or 0
    new_vp = p1_vp if new_plays_as == 1 else p2_vp
    old_vp = p2_vp if new_plays_as == 1 else p1_vp
    return GameResult(
        winner=winner,
        length=move + 1,
        new_vp=int(new_vp),
        old_vp=int(old_vp),
    )


def run_match(
    new_path: Path,
    old_path: Path,
    n_games: int = 20,
    n_simulations: int = 10,
    max_moves: int = 200,
    device: torch.device = None,
    seed: int = 0,
) -> dict:
    device = device or select_device()
    new_net = _load_net(new_path, device)
    old_net = _load_net(old_path, device)

    results: List[GameResult] = []
    half = n_games // 2
    rng = _random.Random(seed)
    t0 = time.perf_counter()
    for i in range(n_games):
        new_plays_as = 1 if i < half else 2
        r = _play_game(
            new_net, old_net, device, new_plays_as,
            n_simulations, max_moves, rng.randint(0, 1 << 30),
        )
        results.append(r)

    elapsed = time.perf_counter() - t0
    new_wins = sum(1 for r in results if r.winner == 1)
    old_wins = sum(1 for r in results if r.winner == -1)
    draws = sum(1 for r in results if r.winner == 0)
    avg_len = sum(r.length for r in results) / len(results)
    avg_vp_margin = sum(r.new_vp - r.old_vp for r in results) / len(results)

    return {
        'n_games': n_games,
        'new_wins': new_wins,
        'old_wins': old_wins,
        'draws': draws,
        'win_rate_new': new_wins / n_games,
        'avg_game_length': avg_len,
        'avg_vp_margin': avg_vp_margin,
        'elapsed_s': elapsed,
    }


def main():
    ap = argparse.ArgumentParser(description='Skirbo checkpoint vs checkpoint')
    ap.add_argument('--new', required=True, help='newer checkpoint .pt')
    ap.add_argument('--old', required=True, help='older checkpoint .pt (baseline)')
    ap.add_argument('--games', type=int, default=20)
    ap.add_argument('--sims', type=int, default=10)
    ap.add_argument('--max-moves', type=int, default=200)
    ap.add_argument('--device', default=None)
    ap.add_argument('--seed', type=int, default=0)
    args = ap.parse_args()

    device = torch.device(args.device) if args.device else select_device()
    print(f'new={args.new} old={args.old} device={device}')
    summary = run_match(
        Path(args.new), Path(args.old),
        n_games=args.games, n_simulations=args.sims,
        max_moves=args.max_moves, device=device, seed=args.seed,
    )
    print(
        f'games={summary["n_games"]}  '
        f'new={summary["new_wins"]}  old={summary["old_wins"]}  draws={summary["draws"]}  '
        f'win_rate_new={summary["win_rate_new"]:.3f}  '
        f'avg_len={summary["avg_game_length"]:.1f}  '
        f'avg_vp_margin={summary["avg_vp_margin"]:+.2f}  '
        f'elapsed={summary["elapsed_s"]:.1f}s'
    )


if __name__ == '__main__':
    main()
