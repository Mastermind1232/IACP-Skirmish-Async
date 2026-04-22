"""D2.20 — parse_surge_effect.

Byte-identical port of `parseSurgeEffect(key)` in `src/game/combat.js` lines
174-256. Given a surge ability key (e.g. "damage 2", "pierce 1", "stun",
"double:pierce 2", "deadly_spin", "blast 2, recover 1"), returns a modifier
dict describing what that surge spend does to the attack.

Numeric keys always present with default 0:
  damage, pierce, accuracy, blast, recover, cleave
Conditions: list of condition names (order-preserving).
Complex named-effect flags are set only when applicable (e.g.
`surgeCancelDodge`, `replaceWithStun`, `surgeGrantHitToken`).

JS strips `double:` prefix and parenthetical annotations before matching.
Python mirrors that normalization exactly.
"""
from __future__ import annotations

import re
from typing import Any, Dict


_PAREN_RE = re.compile(r'\s*\([^)]*\)')
_DAMAGE_RE = re.compile(r'^damage\s+(\d+)$')
_HIT_RE = re.compile(r'^\+(\d+)\s+hit(s?)$')
_PIERCE_RE = re.compile(r'^pierce\s+(\d+)$')
_ACC_RE = re.compile(r'^accuracy\s+(-?\d+)$')
_BLAST_RE = re.compile(r'^blast\s+(\d+)$')
_RECOVER_RE = re.compile(r'^recover\s+(\d+)$')
_CLEAVE_RE = re.compile(r'^cleave\s+(\d+)$')
_CANCEL_RE = re.compile(r'^cancel\s+(\d+)$')
_GAIN_RE = re.compile(r'^gain\s+(\d+)$')
_COMMA_SPLIT_RE = re.compile(r'\s*,\s*')


def parse_surge_effect(key: Any) -> Dict[str, Any]:
    """Parse a surge key into its attack modifiers.

    Stable contract:
      - `damage`, `pierce`, `accuracy`, `blast`, `recover`, `cleave` always 0 by
        default, integer when set.
      - `conditions` is always a list (may be empty).
      - Named-effect flags are only present when matched.
      - Unknown keys pass through with only the defaults — they do not raise.
    """
    out: Dict[str, Any] = {
        'damage': 0, 'pierce': 0, 'accuracy': 0,
        'conditions': [], 'blast': 0, 'recover': 0, 'cleave': 0,
    }
    raw = str(key or '')
    if raw.startswith('double:'):
        raw = raw[len('double:'):]
    k = _PAREN_RE.sub('', raw).lower().strip()

    # ── Named surge-key shortcuts — exact match on full k, early return ─────
    if k == 'stun_net':
        out['conditions'].append('Stun'); return out
    if k == 'harass':
        out['surgeHarass'] = 1; return out
    if k == 'shocking_palm':
        out['replaceWithStun'] = True; return out
    if k == 'squad_command':
        out['surgeSquadCommand'] = True; return out
    if k == 'stalk_prey':
        out['surgeStalkPrey'] = True; return out
    if k == 'deadly_spin':
        out['surgeCancelDodge'] = True; out['cleave'] = 3; return out
    if k == 'deadly':
        out['surgeCancelDodge'] = True; return out
    if k == 'shrapnel':
        out['blast'] = 2; return out
    if k == 'critical_hit':
        out['pierce'] = 2; out['surgeCriticalHit'] = True; return out
    if k == 'suppression':
        out['surgeSuppressionStrain'] = True; return out
    if k == 'focus':
        out['surgeSelfFocus'] = True; return out
    if k == 'hide':
        out['surgeSelfHide'] = True; return out
    if k == 'hit token':
        out['surgeGrantHitToken'] = 1; return out
    if k == 'hit token 2':
        out['surgeGrantHitToken'] = 2; return out
    if k == 'block token':
        out['surgeGrantBlockToken'] = 1; return out
    if k == 'power token':
        out['surgeGrantPowerToken'] = 1; return out
    if k == 'evade':
        out['surgeGrantEvade'] = 1; return out
    if k == 'block 1':
        out['surgeAttackerBlock'] = 1; return out
    if k == 'surge 1':
        out['surgeGrantExtraSurge'] = 1; return out
    if k == 'fighting_knife':
        out['surgeFightingKnife'] = True; return out
    if k == 'concussive_bolt':
        out['surgeConcussiveBolt'] = True; return out
    if k == 'bargain':
        out['surgeBargain'] = True; return out
    if k == 'spread_the_pain':
        out['surgeSpreadThePain'] = True; return out
    if k == 'agitate':
        out['surgeAgitate'] = True; return out
    if k == 'fell_swoop':
        out['surgeFellSwoop'] = True; return out
    if k == 'mastery':
        out['surgeMastery'] = True; return out
    if k == 'interrogate':
        out['surgeInterrogate'] = True; return out
    if k == 'military_efficiency':
        out['surgeMilitaryEfficiency'] = True; return out
    cancel_m = _CANCEL_RE.match(k)
    if cancel_m:
        out['surgeCancel'] = int(cancel_m.group(1)); return out
    if k == 'evade token':
        out['surgeGrantEvade'] = 1; return out
    if k in ('cleave x', 'recover x'):
        out['surgeComplex'] = k; return out

    # ── Generic comma-split pattern matching ─────────────────────────────────
    parts = [p for p in _COMMA_SPLIT_RE.split(k) if p]
    for p in parts:
        # Numeric patterns — continue on match (skips else-if chain + cancel fallback).
        m = _DAMAGE_RE.match(p)
        if m:
            out['damage'] += int(m.group(1)); continue
        m = _HIT_RE.match(p)
        if m:
            out['damage'] += int(m.group(1)); continue
        m = _PIERCE_RE.match(p)
        if m:
            out['pierce'] += int(m.group(1)); continue
        m = _ACC_RE.match(p)
        if m:
            out['accuracy'] += int(m.group(1)); continue
        m = _BLAST_RE.match(p)
        if m:
            out['blast'] += int(m.group(1)); continue
        m = _RECOVER_RE.match(p)
        if m:
            out['recover'] += int(m.group(1)); continue
        m = _CLEAVE_RE.match(p)
        if m:
            out['cleave'] += int(m.group(1)); continue

        # String-match branches — fall through (cancel fallback still runs).
        fell_through = False
        if p == 'stun':
            out['conditions'].append('Stun')
        elif p == 'weaken':
            out['conditions'].append('Weaken')
        elif p == 'bleed':
            out['conditions'].append('Bleed')
        elif p == 'hide':
            out['surgeSelfHide'] = True
        elif p == 'focus':
            out['surgeSelfFocus'] = True
        elif p == 'block token':
            out['surgeGrantBlockToken'] = (out.get('surgeGrantBlockToken', 0) or 0) + 1
        elif p == 'hit token':
            out['surgeGrantHitToken'] = (out.get('surgeGrantHitToken', 0) or 0) + 1
        elif p == 'hit token 2':
            out['surgeGrantHitToken'] = (out.get('surgeGrantHitToken', 0) or 0) + 2
        elif p == 'evade token':
            out['surgeGrantEvade'] = (out.get('surgeGrantEvade', 0) or 0) + 1
        elif p == 'power token':
            out['surgeGrantPowerToken'] = (out.get('surgeGrantPowerToken', 0) or 0) + 1
        elif p == 'surge 1':
            out['surgeGrantExtraSurge'] = (out.get('surgeGrantExtraSurge', 0) or 0) + 1
        elif p == 'evade':
            out['surgeGrantEvade'] = (out.get('surgeGrantEvade', 0) or 0) + 1
        elif p == 'block 1':
            out['surgeAttackerBlock'] = (out.get('surgeAttackerBlock', 0) or 0) + 1
        else:
            gm = _GAIN_RE.match(p)
            if gm:
                out['surgeVpGain'] = (out.get('surgeVpGain', 0) or 0) + int(gm.group(1))
                continue  # JS: gain N ends with continue (skip cancel fallback).
            fell_through = True

        # Fallback cancel-N check — runs after the else-if chain in JS.
        # In practice only a part that didn't match any prior branch (fell_through
        # OR a string-matched part that coincidentally also matches cancel regex,
        # which none do) can add here.
        _ = fell_through  # value unused; kept for clarity
        cm = _CANCEL_RE.match(p)
        if cm:
            out['surgeCancel'] = (out.get('surgeCancel', 0) or 0) + int(cm.group(1))
    return out
