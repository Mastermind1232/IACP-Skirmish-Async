"""Loader for data/mission-cards.json — per-map per-variant mission data.

Structure: {maps: {mapId: {variant: {name, tokenLabel, interactLabel,
mechanics, imagePath, setup, startOfRound, endOfRound, rules}}}}.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional


_REPO_ROOT = Path(__file__).resolve().parents[3]
_DATA_PATH = _REPO_ROOT / 'data' / 'mission-cards.json'

_cache: Optional[Dict[str, Any]] = None


def reset_cache() -> None:
    global _cache
    _cache = None


def _load() -> Dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    with open(_DATA_PATH, 'r') as f:
        raw = json.load(f)
    _cache = raw.get('maps') or {}
    return _cache


def get_mission_cards_data() -> Dict[str, Any]:
    """Return full {mapId: {variant: data}} dict."""
    return _load()


def get_mission(map_id: Optional[str], variant: str) -> Dict[str, Any]:
    """Return mission data for a given map + variant, or {}."""
    if not map_id:
        return {}
    v = variant if variant in ('a', 'b') else 'a'
    return (_load().get(map_id) or {}).get(v) or {}


def get_mission_rules(map_id: Optional[str], variant: str) -> Dict[str, Any]:
    """Return the 'rules' block for a mission (data-driven SoR/EoR effects)."""
    rules = get_mission(map_id, variant).get('rules')
    return rules if isinstance(rules, dict) else {}
