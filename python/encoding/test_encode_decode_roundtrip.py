"""D7.6/D7.7 — encode/decode tensor-bijection oracle.

Contract:
    encode(decode(encode(g), pov), pov) == encode(g, pov)

Run as: python python/encoding/test_encode_decode_roundtrip.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.encoding.encode import C, H, S, W, encode_state
from python.encoding.decode import decode_state
from python.engine.creation import create_game

MAP_ID = 'mos-eisley-outskirts'


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _new_game(**kwargs):
    g = create_game(map_id=MAP_ID, **kwargs)
    g.data['mapId'] = MAP_ID
    return g


def _diff_channels(
    a: torch.Tensor, b: torch.Tensor, tag: str,
) -> List[Tuple[int, float]]:
    """Return [(channel, L1 diff), ...] for channels where a != b."""
    out: List[Tuple[int, float]] = []
    if a.shape != b.shape:
        raise AssertionError(f'{tag}: shape mismatch {a.shape} vs {b.shape}')
    for c in range(a.shape[0]):
        diff = (a[c] - b[c]).abs().sum().item()
        if diff > 0.0:
            out.append((c, diff))
    return out


def _diff_scalar_indices(
    a: torch.Tensor, b: torch.Tensor,
) -> List[Tuple[int, float, float]]:
    out = []
    diffs = (a - b).abs()
    for i in range(a.shape[0]):
        if diffs[i].item() > 0.0:
            out.append((i, float(a[i].item()), float(b[i].item())))
    return out


def _assert_round_trip(game, pov: int, case_name: str) -> None:
    sp1, sc1 = encode_state(game, pov)
    decoded = decode_state(sp1, sc1, pov)
    sp2, sc2 = encode_state(decoded, pov)

    if not torch.equal(sp1, sp2):
        bad = _diff_channels(sp1, sp2, f'{case_name}/spatial')
        raise AssertionError(
            f'[{case_name} pov={pov}] spatial round-trip broken on channels: '
            + ', '.join(f'c{c}(L1={d})' for c, d in bad[:8])
        )
    if not torch.equal(sc1, sc2):
        bad = _diff_scalar_indices(sc1, sc2)
        head = bad[:6]
        raise AssertionError(
            f'[{case_name} pov={pov}] scalar round-trip broken at idx: '
            + ', '.join(f'#{i}: {a}->{b}' for i, a, b in head)
        )


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------

def case_empty_map():
    """Fresh game with only map/identity set."""
    return _new_game()


def case_figures_minimal():
    """Two 1x1 figures per side at distinct coords."""
    g = _new_game(
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1', 'Rebel Trooper (Regular)-0-1': 'b2'},
        2: {'Stormtrooper (Regular)-0-0': 'd4', 'Stormtrooper (Regular)-0-1': 'e5'},
    }
    g.data['player1VP'] = {'total': 6, 'kills': 2, 'objectives': 4}
    g.data['player2VP'] = {'total': 4, 'kills': 1, 'objectives': 3}
    return g


def case_round_phase_active():
    g = case_figures_minimal()
    g.data['phase'] = 'round_active'
    g.data['roundPhase'] = 'activation'
    g.data['round'] = 3
    g.data['initiativeHolder'] = 1
    g.data['activePlayer'] = 2
    g.data['activationsRemaining'] = {1: 3, 2: 2}
    return g


def case_board_tokens():
    g = case_figures_minimal()
    g.data['cratePositions'] = {'g7': {'hp': 0.5, 'maxHp': 1.0}}
    g.data['genericCrateTokens'] = ['h8']
    g.data['interactCrateTokens'] = ['i9']
    g.data['deviceTokens'] = ['j10']
    g.data['ancillaryTokenA'] = ['k11']
    g.data['overwatchTokens'] = ['l12']
    g.data['setTrapTokens'] = ['m13']
    g.data['terminals'] = {'n14': {'controller': 1}, 'o15': {'controller': 2}}
    g.data['zoneControl'] = {'p16': 1, 'q17': 2, 'r18': 'contested'}
    return g


def case_pending_flags():
    g = case_figures_minimal()
    g.data['pendingCombat'] = {
        'attackerPosition': 'a1',
        'targetPosition': 'd4',
        'attackPathCells': ['b2', 'c3'],
    }
    g.data['pendingOverrideAttackDice'] = True
    g.data['pendingStrainChoice'] = {'color': 'red'}
    g.data['pendingLegalMoveSpaces'] = ['c3', 'c4']
    return g


def case_figure_state():
    """Figures with HP, conditions, power tokens, strain, orientation."""
    g = _new_game(
        p1_squad={'affiliation': 'Rebel', 'cost': 20,
                  'deploymentCards': ['Rebel Trooper (Regular)']},
        p2_squad={'affiliation': 'Imperial', 'cost': 22,
                  'deploymentCards': ['Stormtrooper (Regular)']},
    )
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'd4'},
    }
    g.data['dcHealthState'] = {
        'msg1': [[2, 4]],  # Rebel Trooper: 2/4 HP => frac 0.5
    }
    g.data['figureConditions'] = {
        1: {'Rebel Trooper (Regular)-0-0': ['stun', 'bleed']},
        2: {'Stormtrooper (Regular)-0-0': ['hidden']},
    }
    g.data['figurePowerTokens'] = {
        1: {'Rebel Trooper (Regular)-0-0': ['Surge', 'Evade']},
        2: {},
    }
    g.data['figureStrain'] = {
        1: {'Rebel Trooper (Regular)-0-0': 2},
        2: {},
    }
    g.data['figureOrientations'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'n'},
        2: {'Stormtrooper (Regular)-0-0': 'e'},
    }
    g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
    return g


def case_pov2():
    """Reuse figures_minimal; encode with pov=2."""
    return case_figures_minimal()


def case_fluctuations():
    g = case_figures_minimal()
    g.data['currentFluctuationPositions'] = {
        'yellow': ['f6', 'f7'],
        'blue': ['g8'],
        'green': ['h9', 'h10'],
        'red': ['i11'],
    }
    return g


def case_doors():
    g = case_figures_minimal()
    g.data['doors'] = [
        {'cells': ['c3'], 'open': True},
        {'cells': ['d3'], 'open': False},
    ]
    return g


def case_npcs():
    g = case_figures_minimal()
    g.data['npcKrykna'] = ['k10', 'k11']
    g.data['npcThugs'] = ['l10']
    g.data['claimedKrykna'] = ['k10']
    return g


def case_pt_multi():
    """Multiple power tokens of same color on one figure."""
    g = case_figure_state()
    g.data['figurePowerTokens'][1]['Rebel Trooper (Regular)-0-0'] = [
        'Surge', 'Surge', 'Evade', 'Block', 'Block', 'Block',
    ]
    return g


def case_multi_roster():
    """Two different DC types on one side — exercises trait-reverse picker
    across signatures."""
    g = _new_game()
    g.data['figurePositions'] = {
        1: {
            'Rebel Trooper (Regular)-0-0': 'a1',
            'Echo Base Trooper (Regular)-0-0': 'b2',
        },
        2: {
            'Stormtrooper (Regular)-0-0': 'd4',
            'Snowtrooper (Regular)-0-0': 'e5',
        },
    }
    return g


def case_asymmetric_pov2():
    """Assymmetric figures + VP, rendered from pov=2 to catch own/opp swap."""
    g = _new_game()
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {
            'Stormtrooper (Regular)-0-0': 'd4',
            'Snowtrooper (Regular)-0-0': 'e5',
        },
    }
    g.data['player1VP'] = {'total': 2, 'kills': 1, 'objectives': 1}
    g.data['player2VP'] = {'total': 8, 'kills': 3, 'objectives': 5}
    g.data['initiativeHolder'] = 2
    g.data['activePlayer'] = 2
    return g


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

CASES = [
    ('empty_map', case_empty_map, 1),
    ('figures_minimal', case_figures_minimal, 1),
    ('figures_minimal_pov2', case_figures_minimal, 2),
    ('round_phase_active', case_round_phase_active, 1),
    ('board_tokens', case_board_tokens, 1),
    ('pending_flags', case_pending_flags, 1),
    ('figure_state', case_figure_state, 1),
    ('pov2', case_pov2, 2),
    ('fluctuations', case_fluctuations, 1),
    ('doors', case_doors, 1),
    ('npcs', case_npcs, 1),
    ('pt_multi', case_pt_multi, 1),
    ('multi_roster', case_multi_roster, 1),
    ('asymmetric_pov2', case_asymmetric_pov2, 2),
]


def main():
    failures = []
    for name, builder, pov in CASES:
        try:
            g = builder()
            _assert_round_trip(g, pov, name)
            print(f'PASS: {name} (pov={pov})')
        except Exception as e:
            print(f'FAIL: {name} (pov={pov}): {e}')
            failures.append((name, e))
    total = len(CASES)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
