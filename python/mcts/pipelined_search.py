"""D10 — async/pipelined BatchedMCTS with virtual-loss tree parallelism.

Instead of one simulation at a time per game, run up to `pipeline_depth`
simulations in flight per game at once. Each descent applies a *virtual
loss* to its path so other concurrent descents from the same root avoid
the same leaf; on backup, the virtual loss is undone and the real value
applied.

Why this matters for GPU utilization:
  - Without pipelining, a worker submits 1 × games_per_worker rows to
    the backend per sim step (e.g. batch 8).
  - With pipeline_depth=K, a worker submits up to K × games_per_worker
    rows per step (batch 32 at K=4). Bigger batches = fewer GPU kernel
    launches = higher utilization.
  - Across N workers, the inference server sees N × K × games_per_worker
    rows available to concatenate per forward.

Algorithm (per iteration of the outer while loop):
  1. For each game, greedily descend until either (a) pipeline is full,
     (b) no more sims remain, or (c) the root has no children.
     Each descent applies virtual loss to its path.
  2. Collect all newly-opened leaves into one list.
  3. Batch-evaluate non-terminal leaves in one backend call (possibly
     combined across games on the server side when N_workers>1).
  4. Back up values along each path, undoing virtual loss.
  5. Loop until no game has sims remaining and no sims are in flight.

Virtual-loss convention:
  value_sum is stored in player-1 POV throughout. A virtual loss for
  the current selector (node.to_act) means subtracting 1.0 from Q from
  the selector's POV. In p1 POV: subtract 1.0 if selector is p1; add
  1.0 if selector is p2. On backup, undo these deltas then add the real
  value_p1.

This file adds a new class `PipelinedBatchedMCTS`. The existing
`BatchedMCTS` stays unchanged so older tests keep passing.
"""
from __future__ import annotations

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
from python.mcts.inference_backend import InferenceBackend, LocalInferenceBackend
from python.mcts.search import DEFAULT_C_PUCT, Node, _deep_copy_state, _terminal_reward_p1


VIRTUAL_LOSS = 1.0


def _select_child_with_vl(node: Node, c_puct: float) -> int:
    """PUCT selection. Q is stored in p1 POV; flipped for p2's turn.
    Virtual loss is already baked into child.value_sum and visit_count
    by ongoing descents, so we just compute Q/U as usual."""
    parent_visits = max(1, node.visit_count)
    sqrt_parent = math.sqrt(parent_visits)
    best_idx = -1
    best_score = -float('inf')
    for idx, child in node.children.items():
        q = child.q_value
        if node.to_act == 2:
            q = -q
        u = c_puct * child.prior * sqrt_parent / (1 + child.visit_count)
        score = q + u
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx


class PipelinedBatchedMCTS:
    def __init__(
        self,
        net=None,
        device: Optional[torch.device] = None,
        c_puct: float = DEFAULT_C_PUCT,
        max_depth: int = 200,
        attack_rng_seed: int = 0,
        n_policy: int = 4096,
        backend: Optional[InferenceBackend] = None,
        pipeline_depth: int = 4,
        dirichlet_alpha: float = 0.3,
        dirichlet_weight: float = 0.25,
        add_dirichlet_noise: bool = True,
    ) -> None:
        if backend is None:
            if net is None:
                raise ValueError('PipelinedBatchedMCTS: must provide net or backend')
            backend = LocalInferenceBackend(net, device or torch.device('cpu'))
        self.backend = backend
        self.c_puct = c_puct
        self.max_depth = max_depth
        self.n_policy = n_policy
        self.pipeline_depth = max(1, int(pipeline_depth))
        self.dirichlet_alpha = dirichlet_alpha
        self.dirichlet_weight = dirichlet_weight
        self.add_dirichlet_noise = add_dirichlet_noise
        self._attack_rng = _random.Random(attack_rng_seed)
        self._noise_rng = _random.Random(attack_rng_seed ^ 0xABCDEF)

    # ------------------------------------------------------------------
    # Batched evaluation (same interface as BatchedMCTS)
    # ------------------------------------------------------------------

    def _batch_evaluate(
        self, states: List[GameState],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        if not states:
            return torch.empty(0, self.n_policy), torch.empty(0, 1)
        sps: List[torch.Tensor] = []
        scs: List[torch.Tensor] = []
        for s in states:
            pov = int(s.get('activePlayer') or 1)
            sp, sc = encode_state(s, pov)
            sps.append(sp)
            scs.append(sc)
        sp_batch = torch.stack(sps)
        sc_batch = torch.stack(scs)
        return self.backend.evaluate(sp_batch, sc_batch)

    def _expand_with_eval(
        self,
        node: Node,
        state: GameState,
        logits: torch.Tensor,
        value_from_active: float,
        is_root: bool = False,
    ) -> float:
        node.state = state
        node.to_act = int(state.get('activePlayer') or 1)
        legal = legal_actions(state)
        legal_idx: List[int] = []
        for a in legal:
            try:
                pi = action_to_policy_index(a, state)
            except ValueError:
                continue
            if 0 <= pi < self.n_policy:
                legal_idx.append(pi)
        if legal_idx:
            legal_logits = logits[torch.tensor(legal_idx)]
            probs = torch.softmax(legal_logits, dim=0).tolist()
            if is_root and self.add_dirichlet_noise and len(legal_idx) > 1:
                alpha = self.dirichlet_alpha
                samples = [self._noise_rng.gammavariate(alpha, 1.0) for _ in legal_idx]
                total = sum(samples) or 1.0
                noise = [s / total for s in samples]
                w = self.dirichlet_weight
                probs = [(1.0 - w) * p + w * n for p, n in zip(probs, noise)]
            for pi, p in zip(legal_idx, probs):
                node.children[pi] = Node(prior=p)
        return value_from_active if node.to_act == 1 else -value_from_active

    # ------------------------------------------------------------------
    # Descent with virtual loss
    # ------------------------------------------------------------------

    def _descend_vl(
        self, root: Node,
    ) -> Tuple[Node, Optional[GameState], List[Tuple[Node, int]]]:
        """Descend to an unexpanded leaf or terminal, applying virtual
        loss to each child along the path so concurrent descents avoid
        the same path."""
        if root.is_terminal:
            return root, None, []
        state = _deep_copy_state(root.state)
        node = root
        path: List[Tuple[Node, int]] = []
        depth = 0
        while node.children and not node.is_terminal and depth < self.max_depth:
            idx = _select_child_with_vl(node, self.c_puct)
            child = node.children[idx]
            # Virtual loss for the selecting player (node.to_act).
            child.visit_count += 1
            if node.to_act == 1:
                child.value_sum -= VIRTUAL_LOSS
            else:
                child.value_sum += VIRTUAL_LOSS
            path.append((node, idx))
            try:
                action = policy_index_to_action(idx, state)
            except ValueError:
                return child, None, path
            if action.type == ActionType.ATTACK_TARGET:
                action.params = {
                    **action.params,
                    'rng_seed': self._attack_rng.randint(0, 1 << 30),
                }
            try:
                state = step(state, action)
            except Exception:
                return child, None, path
            node = child
            depth += 1
            if state.get('phase') == 'game_over':
                node.is_terminal = True
                node.terminal_value_p1 = _terminal_reward_p1(state)
                node.state = state
                return node, None, path
        return node, state, path

    # ------------------------------------------------------------------
    # Backup (undoes virtual loss then applies real value)
    # ------------------------------------------------------------------

    def _backup_vl(
        self, path: List[Tuple[Node, int]], value_p1: float, root: Node,
    ) -> None:
        for parent, idx in path:
            child = parent.children[idx]
            # Undo virtual loss: opposite of what descend applied.
            if parent.to_act == 1:
                child.value_sum += VIRTUAL_LOSS
            else:
                child.value_sum -= VIRTUAL_LOSS
            # visit_count was pre-incremented in descend; add the real value.
            child.value_sum += value_p1
        root.visit_count += 1

    # ------------------------------------------------------------------
    # Public: run N trees with pipelining
    # ------------------------------------------------------------------

    def run(
        self,
        states: List[GameState],
        n_simulations: int,
    ) -> List[Tuple[Optional[Action], Dict[int, int]]]:
        # Build + initial-expand all roots.
        roots: List[Node] = []
        initial_states: List[GameState] = []
        for s in states:
            r = Node()
            r.state = _deep_copy_state(s)
            r.to_act = int(s.get('activePlayer') or 1)
            if s.get('phase') == 'game_over':
                r.is_terminal = True
                r.terminal_value_p1 = _terminal_reward_p1(s)
            roots.append(r)
            initial_states.append(r.state)

        to_expand = [(i, r) for i, r in enumerate(roots) if not r.is_terminal]
        if to_expand:
            expand_states = [initial_states[i] for i, _ in to_expand]
            logits_batch, values_batch = self._batch_evaluate(expand_states)
            for k, (i, r) in enumerate(to_expand):
                self._expand_with_eval(
                    r, expand_states[k],
                    logits_batch[k], float(values_batch[k, 0]),
                    is_root=True,
                )

        # Pipelined simulation loop.
        sims_remaining = [
            n_simulations if not r.is_terminal else 0 for r in roots
        ]

        while any(r > 0 for r in sims_remaining):
            # Phase 1: descend as many paths as allowed, up to pipeline_depth
            # per game.
            batch_descents: List[Tuple[int, Node, Optional[GameState], List[Tuple[Node, int]]]] = []
            per_game_flights: List[int] = [0] * len(roots)
            for i, root in enumerate(roots):
                while (sims_remaining[i] > 0
                       and per_game_flights[i] < self.pipeline_depth
                       and root.children
                       and not root.is_terminal):
                    leaf, state, path = self._descend_vl(root)
                    batch_descents.append((i, leaf, state, path))
                    per_game_flights[i] += 1
                    sims_remaining[i] -= 1
            if not batch_descents:
                break

            # Phase 2: batch-evaluate non-terminal, unexpanded leaves.
            to_eval_indices: List[int] = []
            to_eval_states: List[GameState] = []
            for k, (i, leaf, state, path) in enumerate(batch_descents):
                if leaf.is_terminal:
                    continue
                if state is None:
                    continue
                if leaf.children:
                    continue
                to_eval_indices.append(k)
                to_eval_states.append(state)

            values_p1: List[float] = [0.0] * len(batch_descents)
            if to_eval_states:
                logits_batch, values_batch = self._batch_evaluate(to_eval_states)
                for j, k in enumerate(to_eval_indices):
                    i, leaf, state, path = batch_descents[k]
                    v_p1 = self._expand_with_eval(
                        leaf, state, logits_batch[j], float(values_batch[j, 0]),
                    )
                    values_p1[k] = v_p1

            # Fill in values for terminal / dead-end leaves.
            for k, (i, leaf, state, path) in enumerate(batch_descents):
                if leaf.is_terminal:
                    values_p1[k] = leaf.terminal_value_p1
                elif state is None:
                    values_p1[k] = 0.0
                elif leaf.children and k not in to_eval_indices:
                    values_p1[k] = leaf.q_value

            # Phase 3: backup each path (undo virtual loss).
            for k, (i, leaf, state, path) in enumerate(batch_descents):
                self._backup_vl(path, values_p1[k], roots[i])

        # Harvest results.
        results: List[Tuple[Optional[Action], Dict[int, int]]] = []
        for r in roots:
            if not r.children:
                results.append((None, {}))
                continue
            visits = {idx: c.visit_count for idx, c in r.children.items()}
            best_idx = max(visits, key=visits.get)
            try:
                action = policy_index_to_action(best_idx, r.state)
            except ValueError:
                action = None
            results.append((action, visits))
        return results
