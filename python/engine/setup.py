"""Headless setup orchestrator — runs the full setup chain.

Chains together the individual setup action handlers into a single
`run_setup()` call that takes two squads + map config and returns
a ready-to-play game. Mirrors the runSetupSim harness from
tests/headless/setup-harness.js without the Discord UI layer.

Flow:

  1. SUBMIT_SQUAD for each player
  2. SELECT_MAP
  3. DETERMINE_INITIATIVE (lower-cost player, random tiebreak)
  4. PICK_ZONE (initiative player picks; default 'red')
  5. DEPLOY_FIGURE for every DC figure (reads squad.deploymentCards,
     expands groups, places on rows)
  6. CC deck init (seeded from squad.ccCards or generic-any pool)
  7. Transition to roundPhase=activation / round=1
  8. Set activationsRemaining from board

After this, `legal_actions(game)` returns the mid-activation action
set for the initiative player.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from python.engine.actions import ActionType
from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.state import GameState
from python.engine.stepper import Action, step


def _squad_cost(squad: Mapping[str, Any]) -> int:
    """Approximate squad cost (sum of DC costs). Used for initiative
    determination. Lower-cost squad gets initiative per CRR rule."""
    total = 0
    for dc_name in (squad.get('deploymentCards') or []):
        eff = get_dc_effect(dc_name) or {}
        cost = eff.get('cost')
        if isinstance(cost, (int, float)):
            total += int(cost)
    return total


def _expand_squad_figures(squad: Mapping[str, Any]) -> List[str]:
    """Return a list of figure_key strings for every figure in the squad.
    Handles multi-figure DCs (figures=N) as DC-name-group-0..figure_idx."""
    out: List[str] = []
    group_idx = 0
    for dc_name in (squad.get('deploymentCards') or []):
        eff = get_dc_effect(dc_name) or {}
        n_figs = eff.get('figures') or 1
        for fig_idx in range(int(n_figs)):
            out.append(f'{dc_name}-{group_idx}-{fig_idx}')
        group_idx += 1
    return out


def _pick_deploy_coords(map_id: str, n_figs: int, zone: str,
                         start_row: int = 1) -> List[str]:
    """Pick N board coords near the player's edge for deployment.

    `zone` is 'red' (low rows) or 'blue' (high rows). Walks columns
    in order and picks the first N traversable cells from the edge
    inward.
    """
    ms = get_map_spaces(map_id) or {}
    adj = ms.get('adjacency') or {}
    if not adj:
        return []
    all_cells = sorted(adj.keys())
    # Group cells by row (numeric suffix).
    rows: Dict[int, List[str]] = {}
    for cell in all_cells:
        # coord shape: letter(s)+digit(s), e.g. a3 / ab12
        i = 0
        while i < len(cell) and not cell[i].isdigit():
            i += 1
        if i == 0 or i == len(cell):
            continue
        try:
            rnum = int(cell[i:])
        except ValueError:
            continue
        rows.setdefault(rnum, []).append(cell)
    if not rows:
        return []
    row_nums = sorted(rows.keys())
    if zone == 'blue':
        row_nums = list(reversed(row_nums))
    picked: List[str] = []
    for rn in row_nums:
        for c in rows[rn]:
            if len(picked) >= n_figs:
                break
            picked.append(c)
        if len(picked) >= n_figs:
            break
    return picked[:n_figs]


def run_setup(game: GameState,
              player1_squad: Mapping[str, Any],
              player2_squad: Mapping[str, Any],
              map_id: str,
              variant: str = 'a',
              zone: str = 'red',
              rng_seed: Optional[int] = None) -> GameState:
    """Run the full setup chain. Returns the ready-to-play GameState.

    Args:
      game: A fresh GameState (from create_game).
      player1_squad / player2_squad: {deploymentCards: [...], ccCards?: [...]}
      map_id: Map id string (e.g. 'mos-eisley-outskirts').
      variant: 'a' or 'b'.
      zone: Initial zone assignment for initiative player ('red' or 'blue').
      rng_seed: Optional — for deterministic CC deck shuffling.

    After return: game.phase='round_active', game.round=1, legal_actions
    returns initiative-player's activation options.
    """
    # 1. Submit squads
    game = step(game, Action(
        type=ActionType.SUBMIT_SQUAD, player=1,
        params={'squad': dict(player1_squad)},
    ))
    game = step(game, Action(
        type=ActionType.SUBMIT_SQUAD, player=2,
        params={'squad': dict(player2_squad)},
    ))

    # 2. Select map
    game = step(game, Action(
        type=ActionType.SELECT_MAP, player=0,
        params={'mission_id': f'{map_id}:{variant}'},
    ))

    # 3. Determine initiative (lower cost wins; ties → P1)
    c1 = _squad_cost(player1_squad)
    c2 = _squad_cost(player2_squad)
    init_player = 1 if c1 <= c2 else 2
    game = step(game, Action(
        type=ActionType.DETERMINE_INITIATIVE, player=0,
        params={'player': init_player},
    ))

    # 4. Pick zone
    game = step(game, Action(
        type=ActionType.PICK_ZONE, player=init_player,
        params={'zone': zone},
    ))

    # 5. Deploy every figure on each side.
    p1_figs = _expand_squad_figures(player1_squad)
    p2_figs = _expand_squad_figures(player2_squad)

    # Initiative player gets the `zone` color; opponent gets the other.
    p1_zone = zone if init_player == 1 else ('blue' if zone == 'red' else 'red')
    p2_zone = 'blue' if p1_zone == 'red' else 'red'

    p1_coords = _pick_deploy_coords(map_id, len(p1_figs), p1_zone)
    p2_coords = _pick_deploy_coords(map_id, len(p2_figs), p2_zone)

    # Avoid p1 and p2 landing on the same cell.
    used = set()
    for i, fk in enumerate(p1_figs):
        if i >= len(p1_coords):
            break
        coord = p1_coords[i]
        if coord in used:
            continue
        used.add(coord)
        game = step(game, Action(
            type=ActionType.DEPLOY_FIGURE, player=1,
            params={'figure_key': fk, 'coord': coord},
        ))
    for i, fk in enumerate(p2_figs):
        if i >= len(p2_coords):
            break
        coord = p2_coords[i]
        if coord in used:
            # Pick the next unused from p2_coords.
            for alt in p2_coords[i + 1:]:
                if alt not in used:
                    coord = alt
                    break
        used.add(coord)
        game = step(game, Action(
            type=ActionType.DEPLOY_FIGURE, player=2,
            params={'figure_key': fk, 'coord': coord},
        ))

    # 6. Seed CC decks from squad config (or fallback).
    import random as _r
    rng = _r.Random(rng_seed if rng_seed is not None else 1)
    for pn_key, squad, deck_key, hand_key, disc_key in (
        (1, player1_squad, 'player1CcDeck', 'player1CcHand', 'player1CcDiscard'),
        (2, player2_squad, 'player2CcDeck', 'player2CcHand', 'player2CcDiscard'),
    ):
        cc_cards = list(squad.get('ccCards') or squad.get('commandCards') or [])
        if not cc_cards:
            from python.engine.data.cc_effects_loader import get_cc_effects
            all_cc = get_cc_effects() or {}
            generic = [
                (name, eff) for name, eff in all_cc.items()
                if isinstance(eff, dict)
                and eff.get('playableBy') in (None, 'Any Figure', 'Any')
            ]
            broad_timings = (
                'duringActivation', 'startOfActivation',
                'beforeYouDeclareAttack',
            )
            broad = [n for n, e in generic if e.get('timing') in broad_timings]
            rest = [n for n, e in generic if e.get('timing') not in broad_timings]
            cc_cards = (broad + rest)[:10]
        if cc_cards:
            shuffled = list(cc_cards)
            rng.shuffle(shuffled)
            game.data[hand_key] = shuffled[:2]
            game.data[deck_key] = shuffled[2:]
            game.data[disc_key] = []

    # 7. Finalize round state.
    from python.engine.stepper import _count_activations_from_board
    game.data['round'] = 1
    game.data['currentRound'] = 1
    game.data['phase'] = 'round_active'
    game.data['roundPhase'] = 'activation'
    game.data['activePlayer'] = init_player
    game.data['initiativeHolder'] = init_player
    game.data['activationsRemaining'] = {
        1: _count_activations_from_board(game, 1),
        2: _count_activations_from_board(game, 2),
    }
    game.data['figuresMovedThisRound'] = []
    game.data['figureAttacksThisActivation'] = {}
    game.data['figureDamageThisActivation'] = {}
    game.data['activeFigureKeys'] = []
    game.data['activationStartPositions'] = {}
    game.data['movementPoints'] = 0
    return game
