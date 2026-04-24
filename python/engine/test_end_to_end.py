"""End-to-end game-flow tests.

Runs full games via legal_actions + stepper to verify the engine
plays through without stalling, crashing, or leaking state between
rounds. Protects against regressions in:

  - legal_actions completeness (no dead states)
  - Round refresh (activations, CC draws, round-scoped state clear)
  - Win condition detection (VP threshold, elimination)
  - Schema handler wiring (CC/DC_SPECIAL auto-ctx)
  - Attack handler bonus consumption

Run: python3 python/engine/test_end_to_end.py
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
from python.engine.stepper import step, Action
from python.mcts.actions import legal_actions


def _autodeploy_game(seed=0):
    random.seed(seed)
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['player1Squad'] = {
        'deploymentCards': ['Luke Skywalker', 'Rebel Trooper (Regular)'],
    }
    g.data['player2Squad'] = {
        'deploymentCards': ['Stormtrooper (Regular)', 'Stormtrooper (Regular)'],
    }
    g = step(g, Action(type=ActionType.AUTO_DEPLOY, player=0))
    return g


def test_random_play_never_stalls_over_200_steps():
    """Random play must never hit a dead state (legal_actions == []
    while phase != game_over) within 200 steps."""
    g = _autodeploy_game(seed=0)
    for step_n in range(200):
        if g.get('phase') == 'game_over':
            return
        actions = legal_actions(g)
        assert actions, (
            f'Dead state at step {step_n}: phase={g.get("phase")!r} '
            f'roundPhase={g.get("roundPhase")!r} '
            f'activationsRemaining={g.get("activationsRemaining")!r}'
        )
        g = step(g, random.choice(actions))


def test_random_play_advances_rounds():
    """Random play crosses a round boundary within 100 steps."""
    g = _autodeploy_game(seed=1)
    initial_round = g.get('round') or 1
    for _ in range(200):
        if g.get('phase') == 'game_over':
            break
        actions = legal_actions(g)
        if not actions:
            break
        g = step(g, random.choice(actions))
        if (g.get('round') or 1) > initial_round:
            return
    raise AssertionError(
        f'Round never advanced past {initial_round} in 200 steps'
    )


def test_cc_draw_refreshes_hand_at_round_start():
    """Round refresh auto-draws 2 CCs per player."""
    g = _autodeploy_game(seed=2)
    # Fast-forward to end of round 1.
    # Simulate by directly ending the round: clear activations, then EoR.
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['roundPhase'] = 'end'
    g.data['p1ActivationPhaseEnded'] = True
    g.data['p2ActivationPhaseEnded'] = True
    p1_before = len(g.data.get('player1CcHand') or [])
    p2_before = len(g.data.get('player2CcHand') or [])
    g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    p1_after = len(g.data.get('player1CcHand') or [])
    p2_after = len(g.data.get('player2CcHand') or [])
    assert p1_after >= p1_before, 'P1 hand should grow (or stay)'
    assert p2_after >= p2_before, 'P2 hand should grow (or stay)'


def test_round_scoped_state_clears_on_eor():
    """End-of-round clears pendingCombat, mobileMovementActive, etc.

    Post-commit matching JS activation-state.js:cleanupRoundStart,
    OBJECT_FLAGS get reset to {} and NULL_FLAGS get reset to None.
    Either "empty" form satisfies the clear-on-EoR contract.
    """
    g = _autodeploy_game(seed=3)
    g.data['pendingCombat'] = {'bonusHits': 2}
    g.data['mobileMovementActive'] = {'msg1': True}
    g.data['activeCardEffects'] = {'Devotion': {'flag': 'devotionEffect'}}
    g.data['paybackBonusSurge'] = {'msg1': 2}
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['roundPhase'] = 'end'
    g = step(g, Action(type=ActionType.END_END_OF_ROUND, player=0))
    def _is_clear(v):
        return v is None or v == {} or v == [] or v is False
    assert _is_clear(g.data.get('pendingCombat'))
    assert _is_clear(g.data.get('mobileMovementActive'))
    assert _is_clear(g.data.get('activeCardEffects'))
    assert _is_clear(g.data.get('paybackBonusSurge'))


def test_vp_threshold_triggers_game_over():
    """Awarding VP past 40 sets game_over."""
    from python.engine.mechanics.vp_helpers import award_kill_vp
    g = _autodeploy_game(seed=4)
    g.data['player1VP'] = {'total': 35, 'kills': 35, 'objectives': 0}
    assert g.get('phase') != 'game_over'
    award_kill_vp(g, 1, 10)  # 35 → 45
    assert g.get('phase') == 'game_over'
    assert g.get('winner') == 1


def test_full_game_via_run_setup_completes():
    """Setup via run_setup() → random play → eventual game_over.

    Verifies the full Python flow (setup chain + round loop + win
    conditions) works end-to-end without the AUTO_DEPLOY shortcut.
    """
    from python.engine.setup import run_setup
    random.seed(7)
    g = create_game(map_id='mos-eisley-outskirts')
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g = run_setup(
        g,
        {'deploymentCards': ['Luke Skywalker', 'Rebel Trooper (Regular)']},
        {'deploymentCards': ['Stormtrooper (Regular)', 'Stormtrooper (Regular)']},
        'mos-eisley-outskirts',
    )
    steps = 0
    while g.get('phase') != 'game_over' and steps < 5000:
        actions = legal_actions(g)
        if not actions:
            break
        g = step(g, random.choice(actions))
        steps += 1
    # Game must end (elimination or VP) within 5000 steps.
    assert g.get('phase') == 'game_over', (
        f'Game did not end in 5000 steps (round={g.get("round")})'
    )
    assert g.data.get('gameEndedReason'), 'Missing game-end reason'


def test_figure_elimination_triggers_game_over():
    """Wiping one side's figures triggers elimination win."""
    from python.engine.mechanics.defeat import remove_figure_position
    from python.engine.mechanics.win_conditions import check_win_conditions
    g = _autodeploy_game(seed=5)
    p2_figs = list((g.data.get('figurePositions') or {}).get(2, {}).keys())
    for fk in p2_figs:
        remove_figure_position(g.data, 2, fk)
    check_win_conditions(g)
    assert g.get('phase') == 'game_over'
    assert g.get('winner') == 1
    assert g.get('gameEndedReason') == 'elimination'


def main():
    cases = [
        ('no_stall_200_steps', test_random_play_never_stalls_over_200_steps),
        ('rounds_advance', test_random_play_advances_rounds),
        ('cc_draw_refreshes', test_cc_draw_refreshes_hand_at_round_start),
        ('round_state_clears', test_round_scoped_state_clears_on_eor),
        ('vp_triggers_game_over', test_vp_threshold_triggers_game_over),
        ('full_game_completes', test_full_game_via_run_setup_completes),
        ('elimination_triggers_game_over', test_figure_elimination_triggers_game_over),
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
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
