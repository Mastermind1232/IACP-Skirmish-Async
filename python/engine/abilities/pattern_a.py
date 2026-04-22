"""D3.3 — Pattern A shared handler: stat-delta abilities.

A Pattern A ability is a declarative bundle of stat deltas applied at a single
resolution site: apply a condition, grant a token, heal, take self-strain, or
bank an activation-scope modifier (MP, extra actions, CC draws). No prompt, no
target picker, no multi-step chain.

`resolve_pattern_a(game, ability_id, ctx)` reads the library entry, iterates
its fields, and dispatches each field through `_FIELD_APPLIERS`. Unknown fields
raise `UnsupportedPatternAField` — silent skip is explicitly disallowed.

ctx shape (all optional except `figure_key`):
    {
      'figure_key': 'DC-NAME-dg-fig',  # required for most effects
      'msg_id':     'hl0dc0',          # required for heal / strain
      'figure_index': 0,               # required for heal / strain
      'player_num': 1,                 # 1 or 2 — self-play and ownership
    }

Result shape:
    {
      'ability_id': '...',
      'pattern': 'A',
      'applied': [ (field, payload), ... ],   # ordered trace of what ran
      'bank':    { 'mpBonus': 3, 'draws': 1, ... },  # activation-scope deltas
      'unimplemented': []  # empty for scaffold-green runs; populated only if
                           # a handler chooses `_record_pending` instead of raising
    }

Scaffold wiring policy (D3.3):
  HANDLED  — field calls directly into an engine primitive (conditions, tokens,
             strain, reduce_hp). Mutates `game`.
  RECORDED — field is an activation/round flag accumulator; stored in
             `result['bank']`. No game mutation. Callers (D4 activation layer)
             consume these later.
  UNSUPPORTED — field is in the Pattern A allowlist but has no scaffold impl;
             raises `UnsupportedPatternAField(ability_id, field)` on hit.

Expanding the HANDLED / RECORDED sets is how Pattern A graduates from scaffold
to fully-wired. The classifier keeps the Pattern-A allowlist wider than the
scaffold's HANDLED ∪ RECORDED, which is intentional: we want classification
stable against wiring progress.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple

from python.engine.abilities.classify import classify_ability
from python.engine.data.ability_library_loader import get_ability
from python.engine.mechanics.conditions import apply_condition
from python.engine.mechanics.damage_helpers import heal_hp
from python.engine.mechanics.strain import apply_strain_to_figure
from python.engine.mechanics.tokens import grant_power_tokens


class UnsupportedPatternAField(RuntimeError):
    """A Pattern A entry carries a field with no scaffold handler."""

    def __init__(self, ability_id: str, field: str):
        super().__init__(f'ability {ability_id!r}: Pattern A field {field!r} not wired in D3.3 scaffold')
        self.ability_id = ability_id
        self.field = field


# ── Metadata fields: silently ignored ───────────────────────────────────────
# These never appear in `result['applied']` — they're informational only.
_METADATA_FIELDS = frozenset({
    'type', 'label', 'logMessage', 'wiredStatus', 'category', 'trigger',
    'oncePer', 'timing', 'informational', 'description',
})


# ── HANDLED appliers (mutate `game` via engine primitives) ─────────────────
Applier = Callable[[Dict[str, Any], str, Any, Dict[str, Any], Dict[str, Any]], None]


def _apply_focus(game, ability_id, value, ctx, result):
    if not value:
        return
    fk = _require_fk(ctx, 'applyFocus')
    apply_condition(game, fk, 'Focus')
    result['applied'].append(('applyFocus', fk))


def _apply_hide(game, ability_id, value, ctx, result):
    if not value:
        return
    fk = _require_fk(ctx, 'applyHide')
    apply_condition(game, fk, 'Hide')
    result['applied'].append(('applyHide', fk))


def _apply_power_token_gain(game, ability_id, value, ctx, result):
    fk = _require_fk(ctx, 'powerTokenGain')
    tokens = [value] if isinstance(value, str) else list(value or [])
    for raw in tokens:
        token = _normalize_token(raw)
        grant_power_tokens(game, fk, token, 1)
        result['applied'].append(('powerTokenGain', {'figureKey': fk, 'token': token}))


def _apply_recover_damage(game, ability_id, value, ctx, result):
    amount = int(value)
    if amount <= 0:
        return
    msg_id = ctx.get('msg_id')
    fig_idx = ctx.get('figure_index')
    fk = ctx.get('figure_key')
    if not msg_id or fig_idx is None or not fk:
        raise UnsupportedPatternAField(ability_id, 'recoverDamage (ctx missing msg_id/figure_index/figure_key)')
    game.setdefault('health', {})
    healed = heal_hp(game['health'], game, msg_id, fig_idx, amount, ctx.get('player_num', 1))
    result['applied'].append(('recoverDamage', {'figureKey': fk, 'amount': healed.get('healed', 0)}))


def _apply_strain_cost_to_self(game, ability_id, value, ctx, result):
    amount = int(value)
    if amount <= 0:
        return
    msg_id = ctx.get('msg_id')
    fig_idx = ctx.get('figure_index')
    fk = ctx.get('figure_key')
    if not msg_id or fig_idx is None or not fk:
        raise UnsupportedPatternAField(ability_id, 'strainCostToSelf (ctx missing msg_id/figure_index/figure_key)')
    game.setdefault('health', {})
    r = apply_strain_to_figure(game['health'], game, msg_id, fig_idx, fk, ctx.get('player_num', 1), amount)
    result['applied'].append(('strainCostToSelf', {'figureKey': fk, 'applied': r.get('applied', 0), 'defeated': r.get('defeated', False)}))


# ── RECORDED appliers (accumulate in `result['bank']`) ─────────────────────

def _record_bank_int(field: str) -> Applier:
    def _apply(game, ability_id, value, ctx, result):
        amt = int(value) if isinstance(value, (int, float, str)) else 0
        if amt == 0:
            return
        result['bank'][field] = result['bank'].get(field, 0) + amt
        result['applied'].append((field, amt))
    _apply.__name__ = f'_record_{field}'
    return _apply


def _record_draw(game, ability_id, value, ctx, result):
    n = int(value) if not isinstance(value, bool) else (1 if value else 0)
    if n <= 0:
        return
    result['bank']['draws'] = result['bank'].get('draws', 0) + n
    result['applied'].append(('draw', n))


# ── Dispatch table ──────────────────────────────────────────────────────────

_FIELD_APPLIERS: Dict[str, Applier] = {
    # HANDLED — direct engine primitives
    'applyFocus': _apply_focus,
    'applyHide': _apply_hide,
    'powerTokenGain': _apply_power_token_gain,
    'recoverDamage': _apply_recover_damage,
    'recoverSelf': _apply_recover_damage,
    'strainCostToSelf': _apply_strain_cost_to_self,

    # RECORDED — activation-scope banks (consumed by D4 later)
    'mpBonus': _record_bank_int('mpBonus'),
    'extraActionBonus': _record_bank_int('extraActionBonus'),
    'actionBonus': _record_bank_int('actionBonus'),
    'freeMoveBonus': _record_bank_int('freeMoveBonus'),
    'draw': _record_draw,
}


def _require_fk(ctx: Dict[str, Any], field: str) -> str:
    fk = ctx.get('figure_key')
    if not fk:
        raise UnsupportedPatternAField('<ctx>', f'{field} requires ctx.figure_key')
    return fk


def _normalize_token(raw: str) -> str:
    """JS library stores tokens as 'Damage'|'Block'|'Surge'|'Evade' with title case.
    Some entries use lowercase variants; mirror JS permissiveness with a capitalize().
    """
    s = str(raw).strip()
    if not s:
        return s
    return s[0].upper() + s[1:]


# ── Entry point ─────────────────────────────────────────────────────────────

def resolve_pattern_a(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Apply a Pattern A ability. Raises on unknown / wrong-pattern / unsupported field."""
    entry = get_ability(ability_id)
    if entry is None:
        from python.engine.abilities.dispatch import UnknownAbility
        raise UnknownAbility(ability_id)

    pattern, _reason = classify_ability(ability_id, entry)
    if pattern != 'A':
        raise ValueError(
            f'resolve_pattern_a called on ability {ability_id!r} (pattern {pattern}); '
            f'route via dispatch.resolve()'
        )

    result: Dict[str, Any] = {
        'ability_id': ability_id,
        'pattern': 'A',
        'applied': [],
        'bank': {},
        'unimplemented': [],
    }

    for field, value in entry.items():
        if field in _METADATA_FIELDS:
            continue
        applier = _FIELD_APPLIERS.get(field)
        if applier is None:
            raise UnsupportedPatternAField(ability_id, field)
        applier(game, ability_id, value, ctx, result)

    return result


def handled_fields() -> List[str]:
    """List of Pattern A fields the scaffold handles (directly or via bank)."""
    return sorted(_FIELD_APPLIERS.keys())


def pattern_a_ids_all_handled() -> List[str]:
    """Return Pattern A ability IDs whose non-metadata fields are ALL in the
    scaffold's handled set. Useful for the spot-check test."""
    from python.engine.abilities.classify import load_inventory
    inv = load_inventory()
    handled = set(_FIELD_APPLIERS.keys())
    ids: List[str] = []
    for ab_id, info in inv.get('entries', {}).items():
        if info.get('pattern') != 'A':
            continue
        entry = get_ability(ab_id) or {}
        fields = [f for f in entry.keys() if f not in _METADATA_FIELDS]
        if fields and all(f in handled for f in fields):
            ids.append(ab_id)
    return sorted(ids)
