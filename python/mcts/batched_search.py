"""D10 slice 6d — batched-inference MCTS for parallel self-play.

BatchedMCTS runs N independent MCTS trees in lockstep. Every simulation
step, each game descends its tree to a leaf; all non-terminal leaves are
then evaluated by the CNN in a single batched forward pass. This turns
the GPU's batch-1 latency (where overhead dominates) into batch-N
throughput (where math dominates) — the unlock that makes the 3080 Ti
useful.

Each game's internal MCTS logic is unchanged from search.py:
  - PUCT selection with c_puct.
  - CNN priors (softmax over legal actions).
  - Q stored from player-1 POV, flipped when it's p2's turn.
  - Terminal values: +1 p1-win / -1 p1-loss / 0 draw.

Per-game attack RNG seeds are derived from a single master seed so
simulations are deterministic given the seed.
"""
from __future__ import annotations

import copy
import math
import random as _random
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
from python.mcts.search import DEFAULT_C_PUCT, Node, _deep_copy_state, _terminal_reward_p1


class BatchedMCTS:
    """Parallel MCTS across N games with batched CNN inference."""

    def __init__(
        self,
        net,
        device: Optional[torch.device] = None,
        c_puct: float = DEFAULT_C_PUCT,
        max_depth: int = 200,
        attack_rng_seed: int = 0,
        n_policy: int = 4096,
    ) -> None:
        self.net = net
        self.device = device or torch.device('cpu')
        self.c_puct = c_puct
        self.max_depth = max_depth
        self.n_policy = n_policy
        self._attack_rng = _random.Random(attack_rng_seed)
        self.net.eval()

    # ------------------------------------------------------------------
    # Batched NN evaluation
    # ------------------------------------------------------------------

    @torch.no_grad()
    def _batch_evaluate(
        self, states: List[GameState],
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """Encode each state from its active player's POV, stack, forward.

        Returns (logits_batch [N, n_policy], values_batch [N, 1]) on CPU.
        """
        if not states:
            return torch.empty(0, self.n_policy), torch.empty(0, 1)
        sps: List[torch.Tensor] = []
        scs: List[torch.Tensor] = []
        for s in states:
            pov = int(s.get('activePlayer') or 1)
            sp, sc = encode_state(s, pov)
            sps.append(sp)
            scs.append(sc)
        sp_batch = torch.stack(sps).to(self.device, non_blocking=True)
        sc_batch = torch.stack(scs).to(self.device, non_blocking=True)
        logits, values = self.net(sp_batch, sc_batch)
        return logits.cpu(), values.cpu()

    def _expand_with_eval(
        self,
        node: Node,
        state: GameState,
        logits: torch.Tensor,
        value_from_active: float,
    ) -> float:
        """Populate node.children from a pre-computed NN eval. Returns
        value in player-1 POV."""
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
            for pi, p in zip(legal_idx, probs):
                node.children[pi] = Node(prior=p)

        return value_from_active if node.to_act == 1 else -value_from_active

    # ------------------------------------------------------------------
    # Selection (PUCT) — copy of search.MCTS._select_child for locality
    # ------------------------------------------------------------------

    def _select_child(self, node: Node) -> int:
        parent_visits = max(1, node.visit_count)
        sqrt_parent = math.sqrt(parent_visits)
        best_idx = -1
        best_score = -float('inf')
        for idx, child in node.children.items():
            q = child.q_value
            if node.to_act == 2:
                q = -q
            u = self.c_puct * child.prior * sqrt_parent / (1 + child.visit_count)
            score = q + u
            if score > best_score:
                best_score = score
                best_idx = idx
        return best_idx

    # ------------------------------------------------------------------
    # Descent phase — each game descends to its next leaf
    # ------------------------------------------------------------------

    def _descend(
        self, root: Node,
    ) -> Tuple[Node, Optional[GameState], List[Tuple[Node, int]]]:
        """Select a path from `root` down to an unexpanded leaf or terminal.

        Returns (leaf_node, leaf_state_or_None_if_terminal, path).
        """
        if root.is_terminal:
            return root, None, []
        state = _deep_copy_state(root.state)
        node = root
        path: List[Tuple[Node, int]] = []
        depth = 0
        while node.children and not node.is_terminal and depth < self.max_depth:
            idx = self._select_child(node)
            child = node.children[idx]
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
            # If child is terminal (newly reached), stop here.
            if state.get('phase') == 'game_over':
                node.is_terminal = True
                node.terminal_value_p1 = _terminal_reward_p1(state)
                node.state = state
                return node, None, path
        return node, state, path

    # ------------------------------------------------------------------
    # Public: run N trees in lockstep
    # ------------------------------------------------------------------

    def run(
        self,
        states: List[GameState],
        n_simulations: int,
    ) -> List[Tuple[Optional[Action], Dict[int, int]]]:
        """For each state in `states`, run `n_simulations` MCTS sims and
        return (chosen_action, visit_counts). Non-terminal states that
        have no legal children return (None, {})."""
        # Build and expand roots (one batched eval for all non-terminals).
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
                )

        # Lockstep simulations.
        for _ in range(n_simulations):
            self._run_one_sim_batch(roots)

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

    # ------------------------------------------------------------------
    # One simulation across all trees
    # ------------------------------------------------------------------

    def _run_one_sim_batch(self, roots: List[Node]) -> None:
        # Phase 1: descend each tree to a leaf.
        leaves: List[Node] = []
        leaf_states: List[Optional[GameState]] = []
        paths: List[List[Tuple[Node, int]]] = []
        for r in roots:
            leaf, state, path = self._descend(r)
            leaves.append(leaf)
            leaf_states.append(state)
            paths.append(path)

        # Phase 2: batch-evaluate non-terminal, unexpanded leaves.
        to_eval: List[Tuple[int, Node, GameState]] = []
        for i, (leaf, state) in enumerate(zip(leaves, leaf_states)):
            if leaf.is_terminal:
                continue
            if state is None:
                continue
            if leaf.children:
                continue
            to_eval.append((i, leaf, state))

        values_p1: List[float] = [0.0] * len(roots)
        if to_eval:
            eval_states = [s for _, _, s in to_eval]
            logits_batch, values_batch = self._batch_evaluate(eval_states)
            for k, (i, leaf, state) in enumerate(to_eval):
                v_p1 = self._expand_with_eval(
                    leaf, state, logits_batch[k], float(values_batch[k, 0]),
                )
                values_p1[i] = v_p1

        # Fill in terminal / already-expanded leaf values.
        for i, leaf in enumerate(leaves):
            if leaf.is_terminal:
                values_p1[i] = leaf.terminal_value_p1
            elif leaf_states[i] is None:
                # Illegal descent dead-end: treat as draw from both POVs.
                values_p1[i] = 0.0
            elif leaf.children and (i, leaf, leaf_states[i]) not in [
                (j, l, s) for j, l, s in to_eval
            ]:
                # Already-expanded re-visit; use current Q.
                values_p1[i] = leaf.q_value

        # Phase 3: backup.
        for path, v_p1, root in zip(paths, values_p1, roots):
            for parent, idx in path:
                child = parent.children[idx]
                child.visit_count += 1
                child.value_sum += v_p1
            root.visit_count += 1
