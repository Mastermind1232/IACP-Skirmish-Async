"""D2.17-2.19 — DiceStream-backed roller + attack/defense roll evaluation.

Mirror of `src/game/combat.js` lines 1-114 (hooks, _drawIndex, _record,
rollAttackDice, rollDefenseDice, rollSingleAttackDie, rollSingleDefenseDie,
recalcAttackTotals, recalcDefenseTotals).

DiceStream parity contract (per `python/parity/dice_stream_schema.md`):
  - `stream.pools.<role>.<color>` is a FIFO queue of face indices.
  - `rollAttackDice(colors)` pops one index per color from `pools.attack[c]`.
  - `rollDefenseDice(color)` pops one index from `pools.defense[c]`.
  - When a pool is set but empty, raise `DiceStreamExhausted` — never silently
    fall back to `random()`.
  - When `stream=None`, fall back to the supplied `rng` (seeded Random). When
    both are None, use Python's module-level `random` (non-deterministic).

This keeps the Python roller's consumption order byte-identical to JS, so a
stream recorded on one side replays identically on the other.
"""
from __future__ import annotations

import random as _random_module
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from python.engine.data.dice_loader import attack_faces, defense_faces


class DiceStreamExhausted(Exception):
    """Raised when a DiceStream is installed but the requested pool is empty."""


@dataclass
class DiceStream:
    """Pre-recorded FIFO queue of face indices, keyed by (role, color).

    Matches the JS shape: `{pools: {attack: {<color>: [idx, ...]}, defense: {...}}}`.
    Both sides pop from index 0.
    """
    pools: Dict[str, Dict[str, List[int]]] = field(default_factory=lambda: {'attack': {}, 'defense': {}})
    version: int = 1
    gameId: Optional[str] = None

    def pop(self, role: str, color: str) -> int:
        bucket = self.pools.get(role) or {}
        q = bucket.get(color)
        if not q:
            raise DiceStreamExhausted(f'DiceStreamExhausted: {role}/{color}')
        return q.pop(0)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> 'DiceStream':
        """Construct from a JS-produced JSON dict (from action-recorder logs)."""
        return cls(
            pools={
                'attack': {k: list(v) for k, v in (d.get('pools', {}).get('attack') or {}).items()},
                'defense': {k: list(v) for k, v in (d.get('pools', {}).get('defense') or {}).items()},
            },
            version=d.get('version', 1),
            gameId=d.get('gameId'),
        )


@dataclass
class DiceRecorder:
    """Records each roll into `pools` (same shape as DiceStream) + a flat `log`.

    Mirror of the JS recorder installed by `setDiceRecorder(r)` — per roll,
    appends the index to `pools[role][color]` and a `{seq, role, color, faceIdx,
    face}` entry to `log`.
    """
    pools: Dict[str, Dict[str, List[int]]] = field(default_factory=lambda: {'attack': {}, 'defense': {}})
    log: List[Dict[str, Any]] = field(default_factory=list)

    def record(self, role: str, color: str, face_idx: int, face: Dict[str, Any]) -> None:
        bucket = self.pools.setdefault(role, {})
        bucket.setdefault(color, []).append(face_idx)
        self.log.append({
            'seq': len(self.log), 'role': role, 'color': color,
            'faceIdx': face_idx, 'face': dict(face),
        })


def _draw_index(stream: Optional[DiceStream], rng: Optional[_random_module.Random],
                role: str, color: str, faces_len: int) -> int:
    if stream is not None:
        return stream.pop(role, color)
    if rng is not None:
        return rng.randrange(faces_len)
    return _random_module.randrange(faces_len)


def roll_attack_dice(dice_colors: Optional[List[str]],
                     stream: Optional[DiceStream] = None,
                     recorder: Optional[DiceRecorder] = None,
                     rng: Optional[_random_module.Random] = None) -> Dict[str, Any]:
    """Roll one attack die per color. Returns totals + per-die breakdown.

    Return shape mirrors JS rollAttackDice: `{acc, dmg, surge, dice: [...]}`.
    Each entry in `dice` is `{color, acc, dmg, surge}` (color is the ORIGINAL
    input case — lowercase normalization is only for the data lookup).
    """
    dice: List[Dict[str, Any]] = []
    acc = dmg = surge = 0
    for color in (dice_colors or []):
        norm = color.lower()
        faces = attack_faces(norm)
        if not faces:
            continue
        idx = _draw_index(stream, rng, 'attack', norm, len(faces))
        face = faces[idx]
        result = {
            'color': color,
            'acc': face.get('acc', 0) or 0,
            'dmg': face.get('dmg', 0) or 0,
            'surge': face.get('surge', 0) or 0,
        }
        if recorder is not None:
            recorder.record('attack', norm, idx, {
                'acc': result['acc'], 'dmg': result['dmg'], 'surge': result['surge'],
            })
        dice.append(result)
        acc += result['acc']
        dmg += result['dmg']
        surge += result['surge']
    return {'acc': acc, 'dmg': dmg, 'surge': surge, 'dice': dice}


def roll_defense_dice(defense_type: Optional[str] = 'white',
                      stream: Optional[DiceStream] = None,
                      recorder: Optional[DiceRecorder] = None,
                      rng: Optional[_random_module.Random] = None) -> Dict[str, Any]:
    """Roll a single defense die. Mirror of JS rollDefenseDice.

    Returns: `{color, block, evade, dodge}`. `dodge` is always a bool (the JS
    coerces `!!face.dodge`).
    """
    color = defense_type or 'white'
    norm = color.lower()
    faces = defense_faces(norm)
    if not faces:
        return {'color': color, 'block': 0, 'evade': 0, 'dodge': False}
    idx = _draw_index(stream, rng, 'defense', norm, len(faces))
    face = faces[idx]
    result = {
        'color': color,
        'block': face.get('block', 0) or 0,
        'evade': face.get('evade', 0) or 0,
        'dodge': bool(face.get('dodge')),
    }
    if recorder is not None:
        recorder.record('defense', norm, idx, {
            'block': result['block'], 'evade': result['evade'], 'dodge': result['dodge'],
        })
    return result


def roll_single_attack_die(color: str,
                           stream: Optional[DiceStream] = None,
                           recorder: Optional[DiceRecorder] = None,
                           rng: Optional[_random_module.Random] = None) -> Dict[str, Any]:
    """Roll one attack die of the given color."""
    norm = color.lower()
    faces = attack_faces(norm)
    if not faces:
        return {'color': color, 'acc': 0, 'dmg': 0, 'surge': 0}
    idx = _draw_index(stream, rng, 'attack', norm, len(faces))
    face = faces[idx]
    result = {
        'color': color,
        'acc': face.get('acc', 0) or 0,
        'dmg': face.get('dmg', 0) or 0,
        'surge': face.get('surge', 0) or 0,
    }
    if recorder is not None:
        recorder.record('attack', norm, idx, {
            'acc': result['acc'], 'dmg': result['dmg'], 'surge': result['surge'],
        })
    return result


def roll_single_defense_die(color: str,
                            stream: Optional[DiceStream] = None,
                            recorder: Optional[DiceRecorder] = None,
                            rng: Optional[_random_module.Random] = None) -> Dict[str, Any]:
    """Roll one defense die of the given color."""
    norm = (color or 'white').lower()
    faces = defense_faces(norm)
    if not faces:
        return {'color': color, 'block': 0, 'evade': 0, 'dodge': False}
    idx = _draw_index(stream, rng, 'defense', norm, len(faces))
    face = faces[idx]
    result = {
        'color': color,
        'block': face.get('block', 0) or 0,
        'evade': face.get('evade', 0) or 0,
        'dodge': bool(face.get('dodge')),
    }
    if recorder is not None:
        recorder.record('defense', norm, idx, {
            'block': result['block'], 'evade': result['evade'], 'dodge': result['dodge'],
        })
    return result


def recalc_attack_totals(dice: List[Dict[str, Any]]) -> Dict[str, int]:
    """Recompute {acc, dmg, surge} totals from a per-die list."""
    acc = dmg = surge = 0
    for d in dice:
        acc += d.get('acc', 0) or 0
        dmg += d.get('dmg', 0) or 0
        surge += d.get('surge', 0) or 0
    return {'acc': acc, 'dmg': dmg, 'surge': surge}


def recalc_defense_totals(dice: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Recompute {block, evade, dodge} totals from a per-die list."""
    block = evade = 0
    dodge = False
    for d in dice:
        block += d.get('block', 0) or 0
        evade += d.get('evade', 0) or 0
        if d.get('dodge'):
            dodge = True
    return {'block': block, 'evade': evade, 'dodge': dodge}
