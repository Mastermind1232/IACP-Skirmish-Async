"""D3.4 — Pattern B shared handler: surge abilities.

All 51 Pattern B entries in `data/ability-library.json` share a single shape:
`{type: 'surge', surgeCost: 1, label: '<display>', description?, wiredStatus?}`.
The ability_id IS the surge key that `parse_surge_effect` consumes (byte-
identical to JS `parseSurgeEffect` from `src/game/combat.js:174-256`). The
handler parses the key into an attack-modifier dict; applying those modifiers
to a combat instance happens inside `compute_combat_result` (Slice 4) — this
handler does NOT mutate `game`.

Scaffold wiring policy (D3.4):
  HANDLED — all 51 surge IDs. parse_surge_effect is a pure function over the
            ability_id string; no per-ability wiring table exists or is needed.
            Named-effect surges (deadly_spin, critical_hit, concussive_bolt,
            …) and composite comma-surges (`accuracy 2, damage 2`, …) all
            flow through the same parser.
  UNSUPPORTED — a Pattern B entry that carries a field outside the tiny
            allowlist `{type, surgeCost, label, description, wiredStatus}`
            raises `UnsupportedPatternBField`. Catches library drift where a
            surge entry is shaped like a ccEffect.

Known JS-parity-preserved edge: surge key `+3 damage` parses to zero-modifier
in BOTH engines — the JS regex only matches `damage N` and `+N hit[s]`, not
`+N damage`. `Bo-Katan Kryze` references this key in `data/dc-effects.json`.
This is a shared-bug parity preservation: fixing it requires changing both
`src/game/combat.js:174-256` and `python/engine/mechanics/surge.py` in sync,
which is out of scope for D3.4. Flagged in the slice report.

ctx shape (all optional at parse time):
    { 'player_num': 1 }   # unused today; preserved for future wiring

Result shape:
    {
      'ability_id': '...',
      'pattern': 'B',
      'surge_cost': 1,                # always 1 in the library
      'modifiers': {                  # parse_surge_effect output
        'damage': int, 'pierce': int, 'accuracy': int,
        'blast': int, 'recover': int, 'cleave': int,
        'conditions': [str, ...],
        # plus any surge* flags (surgeCancelDodge, surgeCriticalHit, …)
      },
    }
"""
from __future__ import annotations

from typing import Any, Dict, List

from python.engine.abilities.classify import classify_ability
from python.engine.data.ability_library_loader import get_ability
from python.engine.mechanics.surge import parse_surge_effect


class UnsupportedPatternBField(RuntimeError):
    """A Pattern B entry carries a field outside the surge allowlist.

    Indicates library drift — e.g. someone tacked a `chooseOne` onto a surge
    entry. Fail loudly so the dispatch layer never silently mis-resolves.
    """

    def __init__(self, ability_id: str, fields: List[str]):
        super().__init__(
            f'ability {ability_id!r}: Pattern B entry has non-allowlist fields {fields}'
        )
        self.ability_id = ability_id
        self.fields = fields


# Tight allowlist — Pattern B entries shouldn't carry anything beyond this set.
_PATTERN_B_FIELDS = frozenset({
    'type', 'surgeCost', 'label', 'description', 'wiredStatus',
})


def resolve_pattern_b(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve a Pattern B surge ability. Raises on unknown / wrong-pattern /
    stray field."""
    entry = get_ability(ability_id)
    if entry is None:
        from python.engine.abilities.dispatch import UnknownAbility
        raise UnknownAbility(ability_id)

    pattern, _reason = classify_ability(ability_id, entry)
    if pattern != 'B':
        raise ValueError(
            f'resolve_pattern_b called on ability {ability_id!r} (pattern {pattern}); '
            f'route via dispatch.resolve()'
        )

    stray = sorted(f for f in entry.keys() if f not in _PATTERN_B_FIELDS)
    if stray:
        raise UnsupportedPatternBField(ability_id, stray)

    modifiers = parse_surge_effect(ability_id)
    return {
        'ability_id': ability_id,
        'pattern': 'B',
        'surge_cost': int(entry.get('surgeCost', 1)),
        'modifiers': modifiers,
    }


def pattern_b_ids_all_handled() -> List[str]:
    """All 51 Pattern B IDs are handled uniformly by parse_surge_effect. This
    helper exists to mirror `pattern_a_ids_all_handled` and to give the parity
    harness a stable enumerant."""
    from python.engine.abilities.classify import load_inventory
    inv = load_inventory()
    return sorted(aid for aid, info in inv.get('entries', {}).items()
                  if info.get('pattern') == 'B')
