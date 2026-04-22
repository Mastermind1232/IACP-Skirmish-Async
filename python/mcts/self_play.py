"""D10 slice 6c — self-play orchestrator + training loop.

The top-level loop that turns a randomly-initialized CNN into a playing
agent:

    for iter in range(n_iters):
        for _ in range(games_per_iter):
            examples += play_one_game(net, mcts_config)
        buffer.extend(examples)
        for _ in range(training_steps):
            batch = buffer.sample(batch_size)
            loss = train_step(net, optimizer, batch)

Each self-play game produces a stream of `TrainingExample`s — one per
move made — tagged with the visit-count distribution MCTS produced and
the final game outcome from the active player's perspective.

Scope:
  - Single-process, single-device. Parallel self-play is a follow-on.
  - Simple deque replay buffer; FIFO eviction.
  - Vanilla Adam; no LR schedule.
  - No periodic snapshotting to disk in this module (caller decides).
"""
from __future__ import annotations

import random as _random
from collections import deque
from dataclasses import dataclass
from typing import Deque, List, Optional, Sequence

import torch
import torch.nn.functional as F

from python.encoding.encode import encode_state
from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import Action, step
from python.mcts.search import MCTS, _terminal_reward_p1
from python.net.batched_eval import select_device
from python.net.skirbo_cnn import SkirboCNN


@dataclass
class TrainingExample:
    """One (position, policy_target, value_target) triple."""
    spatial: torch.Tensor     # [C, H, W]
    scalar: torch.Tensor      # [S]
    policy: torch.Tensor      # [n_policy] visit-count distribution, sums to 1
    value: float              # in [-1, 1], from the acting player's POV


# ---------------------------------------------------------------------------
# Game driver
# ---------------------------------------------------------------------------

def _visit_counts_to_policy(visits: dict, n_policy: int, temperature: float = 1.0) -> torch.Tensor:
    """Convert MCTS visit counts into a normalized policy target.

    temperature=1 uses raw proportions; temperature -> 0 approaches argmax
    (set a few moves in to sharpen the played action vs. the training target
    — AlphaZero uses this tau=1 -> tau=0 schedule)."""
    policy = torch.zeros(n_policy, dtype=torch.float32)
    if not visits:
        return policy
    if temperature <= 1e-6:
        best_idx = max(visits, key=visits.get)
        policy[best_idx] = 1.0
        return policy
    inv_t = 1.0 / temperature
    total = 0.0
    for idx, n in visits.items():
        v = (n + 1e-9) ** inv_t
        policy[idx] = v
        total += v
    if total > 0:
        policy /= total
    return policy


def play_one_game(
    net: SkirboCNN,
    device: torch.device,
    mcts_simulations: int = 25,
    max_moves: int = 400,
    n_policy: int = 4096,
    temperature_moves: int = 15,
    seed: Optional[int] = None,
) -> List[TrainingExample]:
    """Play a single self-play game from fresh auto-deploy to game-over
    (or move cap). Returns a list of TrainingExample.

    The first `temperature_moves` moves use tau=1 (sample proportional
    to visit counts) for exploration; subsequent moves use tau->0
    (greedy). Both the *played* action and the *training target* use
    the same tau.
    """
    rng = _random.Random(seed)
    # Fresh game with a simple default squad.
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

    mcts = MCTS(net, device=device, n_simulations=mcts_simulations,
                attack_rng_seed=rng.randint(0, 1 << 30), n_policy=n_policy)

    history: List[TrainingExample] = []
    played_by: List[int] = []  # active player when each example was made

    for move_idx in range(max_moves):
        if g.get('phase') == 'game_over':
            break
        active = int(g.get('activePlayer') or 1)
        sp, sc = encode_state(g, active)

        action, visits = mcts.run(g)
        temperature = 1.0 if move_idx < temperature_moves else 1e-9
        policy_target = _visit_counts_to_policy(visits, n_policy, temperature)

        # Sample action when exploring; argmax once temperature collapses.
        if temperature > 1e-6 and sum(visits.values()) > 0:
            indices = list(visits.keys())
            weights = [policy_target[i].item() for i in indices]
            chosen_idx = rng.choices(indices, weights=weights, k=1)[0]
            from python.mcts.actions import policy_index_to_action
            action = policy_index_to_action(chosen_idx, g)

        history.append(TrainingExample(
            spatial=sp, scalar=sc, policy=policy_target, value=0.0,
        ))
        played_by.append(active)

        if action.type == ActionType.ATTACK_TARGET:
            action.params = {
                **action.params,
                'rng_seed': rng.randint(0, 1 << 30),
            }
        g = step(g, action)

    # Reward on VP margin regardless of whether the game fully terminated.
    # Truncated-to-move-cap games still have a valid VP delta; treating them
    # as draws teaches the net to stall.
    reward_p1 = _terminal_reward_p1(g)

    # Stamp value targets — from each acting player's perspective.
    for ex, actor in zip(history, played_by):
        ex.value = reward_p1 if actor == 1 else -reward_p1
    return history


# ---------------------------------------------------------------------------
# Replay buffer + training
# ---------------------------------------------------------------------------

class ReplayBuffer:
    def __init__(self, capacity: int = 50_000) -> None:
        self.buffer: Deque[TrainingExample] = deque(maxlen=capacity)

    def extend(self, examples: Sequence[TrainingExample]) -> None:
        self.buffer.extend(examples)

    def __len__(self) -> int:
        return len(self.buffer)

    def sample(self, batch_size: int, rng: Optional[_random.Random] = None) -> List[TrainingExample]:
        rng = rng or _random
        if batch_size >= len(self.buffer):
            return list(self.buffer)
        return rng.sample(list(self.buffer), batch_size)


def train_step(
    net: SkirboCNN,
    optimizer: torch.optim.Optimizer,
    batch: Sequence[TrainingExample],
    device: torch.device,
) -> dict:
    """One gradient step.

    Loss = policy CE + value MSE (+ weight decay baked into optimizer).
    Returns {loss, policy_loss, value_loss}.
    """
    if not batch:
        return {'loss': 0.0, 'policy_loss': 0.0, 'value_loss': 0.0}
    net.train()
    spatial = torch.stack([b.spatial for b in batch]).to(device)
    scalar = torch.stack([b.scalar for b in batch]).to(device)
    policy_tgt = torch.stack([b.policy for b in batch]).to(device)
    value_tgt = torch.tensor([b.value for b in batch], dtype=torch.float32).to(device).unsqueeze(1)

    logits, value = net(spatial, scalar)
    log_probs = F.log_softmax(logits, dim=1)
    # Cross-entropy against the (normalized) visit distribution.
    policy_loss = -(policy_tgt * log_probs).sum(dim=1).mean()
    value_loss = F.mse_loss(value, value_tgt)
    loss = policy_loss + value_loss

    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
    return {
        'loss': float(loss.detach().cpu()),
        'policy_loss': float(policy_loss.detach().cpu()),
        'value_loss': float(value_loss.detach().cpu()),
    }


# ---------------------------------------------------------------------------
# Top-level loop
# ---------------------------------------------------------------------------

@dataclass
class SelfPlayConfig:
    n_iterations: int = 5
    games_per_iter: int = 2
    mcts_simulations: int = 25
    training_steps_per_iter: int = 20
    batch_size: int = 32
    buffer_capacity: int = 10_000
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    max_moves_per_game: int = 300
    temperature_moves: int = 15
    seed: int = 0


def run_self_play_loop(
    net: SkirboCNN,
    config: SelfPlayConfig,
    device: Optional[torch.device] = None,
    progress_cb=None,
) -> dict:
    """Run the full self-play -> train loop. Returns final metrics dict."""
    device = device or select_device()
    net.to(device)
    optimizer = torch.optim.Adam(
        net.parameters(), lr=config.learning_rate, weight_decay=config.weight_decay,
    )
    buffer = ReplayBuffer(capacity=config.buffer_capacity)
    rng = _random.Random(config.seed)

    last_metrics = {}
    for it in range(config.n_iterations):
        for g in range(config.games_per_iter):
            seed = rng.randint(0, 1 << 30)
            examples = play_one_game(
                net, device,
                mcts_simulations=config.mcts_simulations,
                max_moves=config.max_moves_per_game,
                temperature_moves=config.temperature_moves,
                seed=seed,
            )
            buffer.extend(examples)
            if progress_cb:
                progress_cb('game', {'iter': it, 'game': g, 'examples': len(examples)})

        losses = []
        for s in range(config.training_steps_per_iter):
            batch = buffer.sample(config.batch_size, rng)
            if not batch:
                break
            m = train_step(net, optimizer, batch, device)
            losses.append(m)
        if losses:
            last_metrics = {
                'iter': it,
                'buffer_size': len(buffer),
                'mean_loss': sum(m['loss'] for m in losses) / len(losses),
                'mean_policy_loss': sum(m['policy_loss'] for m in losses) / len(losses),
                'mean_value_loss': sum(m['value_loss'] for m in losses) / len(losses),
            }
            if progress_cb:
                progress_cb('train', last_metrics)
    return last_metrics
