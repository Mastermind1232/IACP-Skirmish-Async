"""DC keywords resolution — Python mirror of src/data-loader.js:getDcKeywords.

Returns {dcName → keywords[]} from dc-effects.json, with dynamic overlays
from attachments when `game` is provided:

  - Self-Augmentation (CC attachment) → adds DROID
  - Cross Training (DC attachment) → adds SPY
  - Adaptive Skills (Mara Jade): NOT handled here — computed inline in
    cc_timing.is_cc_play_legal_by_restriction (byte-identical to JS dual
    handling; the overlay version also exists in JS but cc_timing re-does
    the resolution itself).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.data.dc_effects_loader import get_dc_effects


_PASSIVE_AS_KEYWORD = frozenset({'mobile', 'massive', 'efficient travel', 'reach'})


def get_dc_keywords(game: Optional[Any] = None) -> Dict[str, List[str]]:
    """Return dcName → keywords[] with movement-passive promotion + attachments."""
    out: Dict[str, List[str]] = {}
    for name, card in (get_dc_effects() or {}).items():
        if not isinstance(card, dict):
            continue
        kws = list(card.get('keywords') or [])
        for p in (card.get('passives') or []):
            if str(p).lower() in _PASSIVE_AS_KEYWORD:
                kws.append(p)
        if kws:
            out[name] = kws

    if game is None:
        return out

    data = _data(game)

    # Self-Augmentation (CC attachment) → adds DROID to the attached DC.
    for pn in (1, 2):
        cc_atts = data.get('p1CcAttachments' if pn == 1 else 'p2CcAttachments')
        if not cc_atts:
            continue
        dc_list = data.get('p1DcList' if pn == 1 else 'p2DcList')
        msg_ids = data.get('p1DcMessageIds' if pn == 1 else 'p2DcMessageIds')
        if not dc_list or not msg_ids:
            continue
        for msg_id, cards in cc_atts.items():
            if not isinstance(cards, list):
                continue
            if 'Self-Augmentation' not in cards:
                continue
            if msg_id not in msg_ids:
                continue
            idx = msg_ids.index(msg_id)
            dc = dc_list[idx] if idx < len(dc_list) else None
            dc_name = (dc.get('dcName') or dc.get('displayName')) if isinstance(dc, dict) else dc
            if not dc_name:
                continue
            out.setdefault(dc_name, [])
            if not any(str(k).upper() == 'DROID' for k in out[dc_name]):
                out[dc_name].append('Droid')

    # Cross Training (DC attachment) → adds SPY.
    for pn in (1, 2):
        dc_atts = data.get('p1DcAttachments' if pn == 1 else 'p2DcAttachments')
        if not dc_atts:
            continue
        dc_list = data.get('p1DcList' if pn == 1 else 'p2DcList')
        msg_ids = data.get('p1DcMessageIds' if pn == 1 else 'p2DcMessageIds')
        if not dc_list or not msg_ids:
            continue
        for msg_id, cards in dc_atts.items():
            if not isinstance(cards, list):
                continue
            if not any(str(c).lower() == 'cross training' for c in cards):
                continue
            if msg_id not in msg_ids:
                continue
            idx = msg_ids.index(msg_id)
            dc = dc_list[idx] if idx < len(dc_list) else None
            dc_name = (dc.get('dcName') or dc.get('displayName')) if isinstance(dc, dict) else dc
            if not dc_name:
                continue
            out.setdefault(dc_name, [])
            if not any(str(k).upper() == 'SPY' for k in out[dc_name]):
                out[dc_name].append('Spy')

    return out


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    return {}
