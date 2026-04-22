"""D7.5 shape + padding + POV-swap oracle for `encode_state`.

Verifies the tensor-shape contract from D7.2/D7.3/D7.4:
  - spatial.shape == (96, 32, 32); scalar.shape == (1481,); both float32
  - wall_static channel (57) == 1.0 on every x>=26 / y>=28 padding cell
  - wall_static == 1.0 on every off-map cell inside [0..25] x [0..27]
  - every non-57 channel is 0.0 at all padding / off-map cells
  - POV-swap invariant: encode_state(game, 1) == encode_state(swap(game), 2)
    over a state populated with asymmetric figurePositions + VP + squad + IDs.

Full bijection (encode → decode → diff) is tested in D7.7 after D7.6 lands.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.encoding.encode import C, H, S, W, encode_state
from python.engine.creation import create_game
from python.engine.data.map_spaces_loader import get_map_spaces


_S_WALL_STATIC = 57  # per D7.3 wall_static channel index
MAP_ID = 'mos-eisley-outskirts'


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _new_game_with_map(**kwargs):
    """create_game() sets selectedMap as a string, which the encoder ignores
    in favor of `mapId`. Set mapId directly so _fill_block_a + _init_padding
    both see the map."""
    g = create_game(map_id=MAP_ID, **kwargs)
    g.data['mapId'] = MAP_ID
    return g


def _swap_players(game):
    """Swap every player-1/player-2 field populated in the POV-swap test.
    Full state-wide swap lives in D7.6 decode; this helper only needs to
    cover fields our oracle injects."""
    g2 = game.copy()
    d = g2.data
    fp = d.get('figurePositions') or {}
    if fp:
        d['figurePositions'] = {1: dict(fp.get(2, {})), 2: dict(fp.get(1, {}))}
    d['player1VP'], d['player2VP'] = d.get('player2VP'), d.get('player1VP')
    d['player1Squad'], d['player2Squad'] = d.get('player2Squad'), d.get('player1Squad')
    d['player1Id'], d['player2Id'] = d.get('player2Id'), d.get('player1Id')
    return g2


# ---------------------------------------------------------------------------
# Shape + dtype
# ---------------------------------------------------------------------------

def test_spatial_shape():
    spatial, _ = encode_state(_new_game_with_map(), 1)
    assert spatial.shape == (C, H, W), f'spatial shape {spatial.shape} != {(C, H, W)}'
    assert (C, H, W) == (96, 32, 32), f'shape contract drifted: got {(C, H, W)}'


def test_scalar_shape():
    _, scalar = encode_state(_new_game_with_map(), 1)
    assert scalar.shape == (S,), f'scalar shape {scalar.shape} != ({S},)'
    assert S == 1481, f'S contract drifted: got {S}'


def test_dtype_float32():
    spatial, scalar = encode_state(_new_game_with_map(), 1)
    assert spatial.dtype == torch.float32, f'spatial dtype {spatial.dtype}'
    assert scalar.dtype == torch.float32, f'scalar dtype {scalar.dtype}'


# ---------------------------------------------------------------------------
# Padding semantics
# ---------------------------------------------------------------------------

def test_padding_far_column_is_wall_static():
    spatial, _ = encode_state(_new_game_with_map(), 1)
    for y in range(H):
        for x in range(26, W):
            val = spatial[_S_WALL_STATIC, y, x].item()
            assert val == 1.0, f'wall_static!=1 at padding col ({y},{x}): {val}'


def test_padding_far_row_is_wall_static():
    spatial, _ = encode_state(_new_game_with_map(), 1)
    for y in range(28, H):
        for x in range(W):
            val = spatial[_S_WALL_STATIC, y, x].item()
            assert val == 1.0, f'wall_static!=1 at padding row ({y},{x}): {val}'


def test_padding_other_channels_zero():
    """Every padded cell (x>=26 or y>=28) carries 0 on every non-57 channel."""
    spatial, _ = encode_state(_new_game_with_map(), 1)
    for y in range(H):
        for x in range(W):
            if x < 26 and y < 28:
                continue
            for c in range(C):
                if c == _S_WALL_STATIC:
                    continue
                val = spatial[c, y, x].item()
                assert val == 0.0, (
                    f'non-wall channel {c} nonzero at padding ({y},{x}): {val}'
                )


def test_off_map_cells_are_wall_static():
    """Cells in the bounding box [0..25]x[0..27] but absent from map_spaces
    are also encoded as wall_static=1."""
    spatial, _ = encode_state(_new_game_with_map(), 1)
    ms = get_map_spaces(MAP_ID)
    spaces_set = {s.lower() for s in ms.get('spaces', [])}
    assert spaces_set, f'no spaces loaded for {MAP_ID}'
    off_count = 0
    for y in range(28):
        for x in range(26):
            coord = f'{chr(ord("a") + x)}{y + 1}'
            if coord in spaces_set:
                continue
            off_count += 1
            val = spatial[_S_WALL_STATIC, y, x].item()
            assert val == 1.0, (
                f'off-map cell {coord} ({y},{x}) wall_static={val}, want 1.0'
            )
    assert off_count > 0, (
        'expected at least some off-map cells inside bounding box '
        '(mos-eisley-outskirts is not rectangular)'
    )


# ---------------------------------------------------------------------------
# POV-swap invariant
# ---------------------------------------------------------------------------

def test_pov_swap_invariant_minimal():
    """encode_state(game, 1) == encode_state(swap_players(game), 2) for a
    state populated with asymmetric figurePositions + VP + squads + IDs."""
    g = _new_game_with_map(
        p1_squad=['Rebel Trooper', 'C-3PO'],
        p2_squad=['Stormtrooper', 'AT-DP'],
        player1_id='P1_ID',
        player2_id='P2_ID',
    )
    g.data['figurePositions'] = {
        1: {'Rebel Trooper-0-0': 'a1', 'C-3PO-1-0': 'b2'},
        2: {'Stormtrooper-0-0': 'd4', 'AT-DP-1-0': 'e5'},
    }
    g.data['player1VP'] = {'total': 3, 'kills': 1, 'objectives': 2}
    g.data['player2VP'] = {'total': 5, 'kills': 3, 'objectives': 2}

    sp1, sc1 = encode_state(g, 1)
    sp2, sc2 = encode_state(_swap_players(g), 2)

    if not torch.equal(sp1, sp2):
        for c in range(C):
            if not torch.equal(sp1[c], sp2[c]):
                diff = (sp1[c] - sp2[c]).abs().sum().item()
                raise AssertionError(
                    f'POV-swap invariant broken on spatial channel {c}: '
                    f'L1 diff = {diff}'
                )
    if not torch.equal(sc1, sc2):
        diffs = (sc1 - sc2).abs()
        idx = int(torch.argmax(diffs).item())
        raise AssertionError(
            f'POV-swap invariant broken on scalar[{idx}]: '
            f'pov1={sc1[idx].item()} pov2={sc2[idx].item()}'
        )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main():
    tests = [
        test_spatial_shape,
        test_scalar_shape,
        test_dtype_float32,
        test_padding_far_column_is_wall_static,
        test_padding_far_row_is_wall_static,
        test_padding_other_channels_zero,
        test_off_map_cells_are_wall_static,
        test_pov_swap_invariant_minimal,
    ]
    failed = []
    for t in tests:
        try:
            t()
            print(f'PASS: {t.__name__}')
        except Exception as e:
            print(f'FAIL: {t.__name__}: {e}')
            failed.append((t.__name__, e))
    total = len(tests)
    print(f'\n{total - len(failed)}/{total} passed')
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
