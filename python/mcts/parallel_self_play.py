"""D10 slice 6d — parallel self-play driver using BatchedMCTS.

Plays N games simultaneously, producing TrainingExamples tagged with the
visit-count-derived policy target and the game's final outcome (from
each example's active-player POV). Across all games, leaf evaluations
for each MCTS simulation are batched into one GPU call — the whole
point of this module.
"""
from __future__ import annotations

import random as _random
from typing import List, Optional

import torch

from python.encoding.encode import encode_state
from python.engine.actions import ActionType
from python.engine.creation import create_game
from python.engine.state import GameState
from python.engine.stepper import Action, step
from python.mcts.actions import policy_index_to_action
from python.mcts.batched_search import BatchedMCTS
from python.mcts.search import _terminal_reward_p1
from python.mcts.self_play import TrainingExample, _visit_counts_to_policy
from python.net.skirbo_cnn import SkirboCNN


def _fresh_game() -> GameState:
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
    return step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))


def play_batch(
    net: SkirboCNN,
    device: torch.device,
    n_games: int = 8,
    mcts_simulations: int = 25,
    max_moves: int = 400,
    n_policy: int = 4096,
    temperature_moves: int = 15,
    seed: Optional[int] = None,
) -> List[TrainingExample]:
    """Play `n_games` self-play games in parallel, return flattened
    TrainingExamples across all games."""
    rng = _random.Random(seed)
    games: List[GameState] = [_fresh_game() for _ in range(n_games)]
    histories: List[List[TrainingExample]] = [[] for _ in range(n_games)]
    actors: List[List[int]] = [[] for _ in range(n_games)]

    mcts = BatchedMCTS(
        net, device=device,
        attack_rng_seed=rng.randint(0, 1 << 30),
        n_policy=n_policy,
    )

    for move_idx in range(max_moves):
        active_indices = [i for i, g in enumerate(games)
                          if g.get('phase') != 'game_over']
        if not active_indices:
            break

        # Encode and save per-game tensors BEFORE MCTS mutates nothing
        # (it uses deep copies internally).
        move_tensors = {}
        for i in active_indices:
            active = int(games[i].get('activePlayer') or 1)
            sp, sc = encode_state(games[i], active)
            move_tensors[i] = (sp, sc, active)

        # One batched MCTS call across all live games.
        mcts_states = [games[i] for i in active_indices]
        results = mcts.run(mcts_states, mcts_simulations)

        # Temperature schedule.
        temperature = 1.0 if move_idx < temperature_moves else 1e-9

        for local_idx, game_idx in enumerate(active_indices):
            chosen_action, visits = results[local_idx]
            if not visits:
                # No legal children — treat as end-of-move; skip.
                continue
            policy_target = _visit_counts_to_policy(visits, n_policy, temperature)

            # Sample action during exploration phase.
            if temperature > 1e-6:
                indices = list(visits.keys())
                weights = [policy_target[i].item() for i in indices]
                total = sum(weights)
                if total > 0:
                    chosen_idx = rng.choices(indices, weights=weights, k=1)[0]
                    try:
                        chosen_action = policy_index_to_action(chosen_idx, games[game_idx])
                    except ValueError:
                        pass

            if chosen_action is None:
                continue

            sp, sc, actor = move_tensors[game_idx]
            histories[game_idx].append(TrainingExample(
                spatial=sp, scalar=sc, policy=policy_target, value=0.0,
            ))
            actors[game_idx].append(actor)

            if chosen_action.type == ActionType.ATTACK_TARGET:
                chosen_action.params = {
                    **chosen_action.params,
                    'rng_seed': rng.randint(0, 1 << 30),
                }
            try:
                games[game_idx] = step(games[game_idx], chosen_action)
            except Exception:
                # Illegal action from MCTS — treat as forfeit for active player.
                games[game_idx].data['phase'] = 'game_over'

    # Stamp terminal values per example.
    all_examples: List[TrainingExample] = []
    for game, history, actor_list in zip(games, histories, actors):
        # VP-margin reward regardless of phase — move-cap games still carry signal.
        reward_p1 = _terminal_reward_p1(game)
        for ex, actor in zip(history, actor_list):
            ex.value = reward_p1 if actor == 1 else -reward_p1
            all_examples.append(ex)
    return all_examples
