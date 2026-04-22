"""D7 — 10K random-state round-trip stress test.

Generates N synthetic game states across varied maps/figures/phases/tokens
and asserts `encode(decode(encode(g), pov), pov) == encode(g, pov)` for each.

Run as: python3 python/encoding/stress_roundtrip.py [N]
"""
from __future__ import annotations

import random
import string
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import torch

from python.encoding.encode import encode_state
from python.encoding.decode import decode_state
from python.engine.creation import create_game
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.data.figure_sizes_loader import get_figure_sizes
from python.engine.data.map_spaces_loader import all_map_ids, get_map_spaces


def _figure_dcs():
    """Figures that exist in BOTH figure-sizes and dc-effects — the only
    set where the round-trip contract is well-defined (roster bitset keys
    off dc-effects)."""
    effects = get_dc_effects()
    out = []
    for name in get_figure_sizes():
        if name not in effects:
            continue
        e = effects[name] or {}
        if e.get('isAttachment') or e.get('attachment'):
            continue
        out.append(name)
    return out


FIGURE_DCS = _figure_dcs()
MAP_IDS = all_map_ids()
PHASES = ['setup', 'round_active', 'round_end', 'game_over']
ROUND_PHASES = ['activation', 'status', 'end']
CONDITIONS = ['stun', 'bleed', 'hidden', 'weakened', 'focused', 'strained']
POWER_TOKENS = ['Surge', 'Evade', 'Block', 'Dodge']
ORIENTATIONS = ['n', 'e', 's', 'w']


def _rand_cells(spaces, rng, n, exclude=()):
    pool = [s for s in spaces if s not in exclude]
    rng.shuffle(pool)
    return pool[:n]


def _rand_coord(rng):
    col = rng.choice(string.ascii_lowercase[:24])
    row = rng.randint(1, 26)
    return f'{col}{row}'


def _build_random_game(seed: int):
    rng = random.Random(seed)
    map_id = rng.choice(MAP_IDS)
    spaces = get_map_spaces(map_id).get('spaces', []) or [
        _rand_coord(rng) for _ in range(60)
    ]

    n1 = rng.randint(0, 3)
    n2 = rng.randint(0, 3)
    p1_dcs = rng.sample(FIGURE_DCS, n1) if n1 else []
    p2_dcs = rng.sample(FIGURE_DCS, n2) if n2 else []

    g = create_game(map_id=map_id)
    g.data['mapId'] = map_id

    fig_positions = {1: {}, 2: {}}
    used = set()

    def _place(player, dcs):
        for dc in dcs:
            key = f'{dc}-0-0'
            cells = _rand_cells(spaces, rng, 1, exclude=used)
            if not cells:
                return
            used.add(cells[0])
            fig_positions[player][key] = cells[0]

    _place(1, p1_dcs)
    _place(2, p2_dcs)
    g.data['figurePositions'] = fig_positions

    # VP
    g.data['player1VP'] = {
        'total': rng.randint(0, 20),
        'kills': rng.randint(0, 10),
        'objectives': rng.randint(0, 10),
    }
    g.data['player2VP'] = {
        'total': rng.randint(0, 20),
        'kills': rng.randint(0, 10),
        'objectives': rng.randint(0, 10),
    }

    # Phase / round
    g.data['phase'] = rng.choice(PHASES)
    g.data['roundPhase'] = rng.choice(ROUND_PHASES)
    g.data['round'] = rng.randint(1, 8)
    g.data['initiativeHolder'] = rng.choice([1, 2])
    g.data['activePlayer'] = rng.choice([1, 2])
    g.data['activationsRemaining'] = {
        1: rng.randint(0, 4),
        2: rng.randint(0, 4),
    }

    # Figure state
    hp = {}
    conds = {1: {}, 2: {}}
    pts = {1: {}, 2: {}}
    strain = {1: {}, 2: {}}
    orients = {1: {}, 2: {}}
    for player, dcs in ((1, p1_dcs), (2, p2_dcs)):
        for idx, dc in enumerate(dcs):
            key = f'{dc}-0-0'
            cur = rng.randint(1, 6)
            mx = rng.randint(cur, 10)
            hp[f'msg{player}-{idx}'] = [[cur, mx]]
            if rng.random() < 0.4:
                k = rng.randint(1, 2)
                conds[player][key] = rng.sample(CONDITIONS, k)
            if rng.random() < 0.4:
                k = rng.randint(1, 3)
                pts[player][key] = [rng.choice(POWER_TOKENS) for _ in range(k)]
            if rng.random() < 0.3:
                strain[player][key] = rng.randint(0, 3)
            if rng.random() < 0.5:
                orients[player][key] = rng.choice(ORIENTATIONS)
    g.data['dcHealthState'] = hp
    g.data['figureConditions'] = conds
    g.data['figurePowerTokens'] = pts
    g.data['figureStrain'] = strain
    g.data['figureOrientations'] = orients

    # Board tokens
    if rng.random() < 0.5:
        n = rng.randint(1, 3)
        g.data['cratePositions'] = {
            c: {'hp': rng.random(), 'maxHp': 1.0}
            for c in _rand_cells(spaces, rng, n, exclude=used)
        }
    if rng.random() < 0.4:
        g.data['genericCrateTokens'] = _rand_cells(spaces, rng, rng.randint(1, 3), exclude=used)
    if rng.random() < 0.3:
        g.data['deviceTokens'] = _rand_cells(spaces, rng, rng.randint(1, 2), exclude=used)
    if rng.random() < 0.3:
        g.data['overwatchTokens'] = _rand_cells(spaces, rng, rng.randint(1, 2), exclude=used)

    # Doors
    if rng.random() < 0.3:
        door_cells = _rand_cells(spaces, rng, rng.randint(1, 3), exclude=used)
        g.data['doors'] = [
            {'cells': [c], 'open': rng.random() < 0.5} for c in door_cells
        ]

    # NPCs
    if rng.random() < 0.2:
        g.data['npcKrykna'] = _rand_cells(spaces, rng, rng.randint(1, 2), exclude=used)
    if rng.random() < 0.2:
        g.data['npcThugs'] = _rand_cells(spaces, rng, rng.randint(1, 2), exclude=used)

    # Fluctuations
    if rng.random() < 0.3:
        g.data['currentFluctuationPositions'] = {
            color: _rand_cells(spaces, rng, rng.randint(1, 2), exclude=used)
            for color in ('yellow', 'blue', 'green', 'red')
            if rng.random() < 0.5
        }

    # Zones
    if rng.random() < 0.3:
        zone_cells = _rand_cells(spaces, rng, rng.randint(1, 3), exclude=used)
        g.data['zoneControl'] = {
            c: rng.choice([1, 2, 'contested']) for c in zone_cells
        }

    # Pending flags
    if rng.random() < 0.2:
        g.data['pendingOverrideAttackDice'] = True
    if rng.random() < 0.15:
        g.data['pendingStrainChoice'] = {'color': rng.choice(['red', 'blue'])}

    return g


def _run(n: int):
    failures = []
    for i in range(n):
        pov = 1 if (i % 2 == 0) else 2
        try:
            g = _build_random_game(i)
            sp1, sc1 = encode_state(g, pov)
            decoded = decode_state(sp1, sc1, pov)
            sp2, sc2 = encode_state(decoded, pov)
            if not torch.equal(sp1, sp2):
                bad = []
                for c in range(sp1.shape[0]):
                    d = (sp1[c] - sp2[c]).abs().sum().item()
                    if d > 0.0:
                        bad.append((c, d))
                raise AssertionError(
                    f'spatial mismatch seed={i} pov={pov} channels='
                    + ','.join(f'c{c}(L1={d})' for c, d in bad[:6])
                )
            if not torch.equal(sc1, sc2):
                diffs = (sc1 - sc2).abs()
                bad = [(k, sc1[k].item(), sc2[k].item())
                       for k in range(sc1.shape[0]) if diffs[k].item() > 0.0]
                raise AssertionError(
                    f'scalar mismatch seed={i} pov={pov} idx='
                    + ','.join(f'#{k}:{a}->{b}' for k, a, b in bad[:6])
                )
        except Exception as e:
            failures.append((i, pov, str(e)))
            if len(failures) >= 20:
                break
        if (i + 1) % 500 == 0:
            print(f'  ...{i + 1}/{n} ({len(failures)} failures so far)')
    return failures


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10000
    print(f'Running {n} random-state round-trip cases...')
    failures = _run(n)
    if failures:
        print(f'\nFAIL: {len(failures)} failures (first {min(20, len(failures))} shown):')
        for seed, pov, msg in failures[:20]:
            print(f'  seed={seed} pov={pov}: {msg}')
        sys.exit(1)
    print(f'\nPASS: {n}/{n} round-trips clean')


if __name__ == '__main__':
    main()
