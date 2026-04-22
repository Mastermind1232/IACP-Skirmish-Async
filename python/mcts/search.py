"""D10 slice 6b — AlphaZero-style MCTS over the headless stepper.

Search primitives (PUCT selection, CNN-backed expansion, value backup
with per-player perspective flipping) that the self-play loop calls
once per move. Returns (chosen_action, visit_count_target) — the
visit counts become the training target for the CNN policy head.

Scope:
  - Terminal handling: phase == 'game_over' -> VP-delta-sign reward,
    +1 for own-win, -1 for own-loss, 0 for draw.
  - Move-limit: the caller can set max_depth so runaway sims don't
    loop forever on stalemate-prone early networks.
  - No virtual loss, no tree reuse, no parallelism — single-thread MVP.
  - RNG-seeded dice for reproducible simulations.
"""
from __future__ import annotations

import copy
import math
import random as _random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import torch

from python.encoding.encode import encode_state
from python.engine.actions import ActionType
from python.engine.state import GameState
from python.engine.stepper import Action, step
from python.mcts.actions import (
    action_to_policy_index,
    legal_actions,
    policy_index_to_action,
)


DEFAULT_C_PUCT = 1.5


@dataclass
class Node:
    prior: float = 0.0
    visit_count: int = 0
    value_sum: float = 0.0
    children: Dict[int, 'Node'] = field(default_factory=dict)
    # State fields — populated lazily when the node is expanded.
    state: Optional[GameState] = None
    to_act: int = 0                # active player at this node's state
    is_terminal: bool = False
    terminal_value_p1: float = 0.0  # +1 if p1 won, -1 if p1 lost

    @property
    def q_value(self) -> float:
        return self.value_sum / self.visit_count if self.visit_count else 0.0


def _deep_copy_state(game: GameState) -> GameState:
    """Deep-copy via the data dict. step() already copies top-level and
    the nested dicts it touches, but MCTS simulates many paths from one
    root so we take no chances."""
    return GameState(copy.deepcopy(game.data))


def _terminal_reward_p1(game: GameState) -> float:
    """Reward from player-1's perspective for a terminal state.
    +1 p1 wins, -1 p1 loses, 0 draw."""
    p1_vp = (game.get('player1VP') or {}).get('total', 0) or 0
    p2_vp = (game.get('player2VP') or {}).get('total', 0) or 0
    p1_alive = bool((game.get('figurePositions') or {}).get(1))
    p2_alive = bool((game.get('figurePositions') or {}).get(2))
    # Elimination dominates VP for game-over by wipe.
    if not p1_alive and p2_alive:
        return -1.0
    if p1_alive and not p2_alive:
        return 1.0
    if p1_vp > p2_vp:
        return 1.0
    if p1_vp < p2_vp:
        return -1.0
    return 0.0


class MCTS:
    """Single-threaded MCTS with PUCT selection.

    Usage:
        mcts = MCTS(net, device, n_simulations=50)
        action, visit_counts = mcts.run(root_game)
    """

    def __init__(
        self,
        net,
        device: Optional[torch.device] = None,
        n_simulations: int = 50,
        c_puct: float = DEFAULT_C_PUCT,
        max_depth: int = 200,
        attack_rng_seed: int = 0,
        n_policy: int = 4096,
    ) -> None:
        self.net = net
        self.device = device or torch.device('cpu')
        self.n_simulations = n_simulations
        self.c_puct = c_puct
        self.max_depth = max_depth
        self.n_policy = n_policy
        self._attack_rng = _random.Random(attack_rng_seed)
        self.net.eval()

    # ------------------------------------------------------------------
    # Network evaluation
    # ------------------------------------------------------------------

    @torch.no_grad()
    def _evaluate(self, game: GameState) -> Tuple[torch.Tensor, float]:
        """Return (policy_softmax over legal actions, value estimate) for
        `game` from the active player's perspective."""
        active = int(game.get('activePlayer') or 1)
        sp, sc = encode_state(game, active)
        sp = sp.unsqueeze(0).to(self.device)
        sc = sc.unsqueeze(0).to(self.device)
        logits, value = self.net(sp, sc)
        logits = logits[0].cpu()
        v = float(value[0, 0].cpu())
        return logits, v

    def _masked_softmax(self, logits: torch.Tensor, legal_idx: List[int]) -> Dict[int, float]:
        if not legal_idx:
            return {}
        legal_logits = logits[torch.tensor(legal_idx)]
        probs = torch.softmax(legal_logits, dim=0).tolist()
        return {idx: p for idx, p in zip(legal_idx, probs)}

    # ------------------------------------------------------------------
    # Node expansion
    # ------------------------------------------------------------------

    def _expand(self, node: Node, state: GameState) -> float:
        """Populate node.children + return value estimate from p1's POV."""
        node.state = state
        node.to_act = int(state.get('activePlayer') or 1)

        if state.get('phase') == 'game_over':
            node.is_terminal = True
            node.terminal_value_p1 = _terminal_reward_p1(state)
            return node.terminal_value_p1

        logits, value_from_active = self._evaluate(state)
        legal = legal_actions(state)
        legal_idx: List[int] = []
        idx_to_action: Dict[int, Action] = {}
        for a in legal:
            try:
                pi = action_to_policy_index(a, state)
            except ValueError:
                continue
            if 0 <= pi < self.n_policy:
                legal_idx.append(pi)
                idx_to_action[pi] = a

        priors = self._masked_softmax(logits, legal_idx)
        for pi in legal_idx:
            node.children[pi] = Node(prior=priors.get(pi, 0.0))

        # Flip value to p1's POV.
        value_p1 = value_from_active if node.to_act == 1 else -value_from_active
        return value_p1

    # ------------------------------------------------------------------
    # Selection (PUCT)
    # ------------------------------------------------------------------

    def _select_child(self, node: Node) -> int:
        """Return the policy-index of the child maximizing PUCT."""
        parent_visits = max(1, node.visit_count)
        best_idx = -1
        best_score = -float('inf')
        sqrt_parent = math.sqrt(parent_visits)
        for idx, child in node.children.items():
            q = child.q_value
            # Q is stored from p1's POV; flip so the CURRENT player maximizes.
            if node.to_act == 2:
                q = -q
            u = self.c_puct * child.prior * sqrt_parent / (1 + child.visit_count)
            score = q + u
            if score > best_score:
                best_score = score
                best_idx = idx
        return best_idx

    # ------------------------------------------------------------------
    # Single simulation
    # ------------------------------------------------------------------

    def _simulate(self, root: Node) -> None:
        path: List[Tuple[Node, int]] = []   # (parent_node, chosen_idx)
        node = root
        state = _deep_copy_state(root.state)
        depth = 0

        # Selection
        while node.children and not node.is_terminal and depth < self.max_depth:
            idx = self._select_child(node)
            child = node.children[idx]
            path.append((node, idx))
            try:
                action = policy_index_to_action(idx, state)
            except ValueError:
                break
            if action.type == ActionType.ATTACK_TARGET:
                action.params = {
                    **action.params,
                    'rng_seed': self._attack_rng.randint(0, 1 << 30),
                }
            try:
                state = step(state, action)
            except Exception:
                # Illegal path — score as loss for the actor and stop.
                break
            node = child
            depth += 1

        # Expansion (or terminal-value reuse)
        if node.is_terminal:
            value_p1 = node.terminal_value_p1
        elif node.state is None or not node.children:
            value_p1 = self._expand(node, state)
        else:
            value_p1 = node.q_value  # fall-through, shouldn't normally hit

        # Backup
        for parent, idx in path:
            child = parent.children[idx]
            child.visit_count += 1
            child.value_sum += value_p1
        root.visit_count += 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, root_state: GameState) -> Tuple[Action, Dict[int, int]]:
        """Run `n_simulations` simulations from `root_state` and pick the
        most-visited action. Returns (action, visit_counts_by_policy_idx).
        """
        root = Node()
        root.state = _deep_copy_state(root_state)
        self._expand(root, root.state)
        for _ in range(self.n_simulations):
            self._simulate(root)
        visits = {idx: c.visit_count for idx, c in root.children.items()}
        if not visits:
            raise RuntimeError('MCTS: root has no legal children')
        best_idx = max(visits, key=visits.get)
        return policy_index_to_action(best_idx, root.state), visits
