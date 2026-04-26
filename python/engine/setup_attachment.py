"""Attachment restriction parser. Mirrors getAttachmentRestriction
from src/handlers/setup.js.

Reads the first line of `card.abilityText`; when it matches `<X> ONLY`,
parses `<X>` into OR-alternatives and returns a filter function that
accepts a DC name and returns True/False for legality.

Scope (atomic): the major paths used by competitive squads:
  - "UNIQUE FIGURE"
  - "UNIQUE FIGURE WITH FIGURE COST N OR MORE"
  - "NON-MASSIVE", "NON-UNIQUE" (conjunctive)
  - Keyword matches (LEADER, HUNTER, DROID, TROOPER, ...)
  - Name matches ("DARTH VADER", "SHORETROOPER")
  - "GROUP WITH N FIGURES" suffix
  - OR-split with comma-list expansion

Discord-side bits (eligibility-extender chains, edge syntax) deferred.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional


RESTRICTION_KEYWORDS = (
    'LEADER', 'HUNTER', 'DROID', 'TROOPER', 'GUARDIAN', 'CREATURE',
    'VEHICLE', 'WOOKIEE', 'JEDI', 'SITH', 'FORCE USER', 'FORCE-USER',
    'IMPERIAL', 'REBEL', 'SCOUNDREL', 'MERCENARY',
    'HEAVY WEAPON', 'BRAWLER', 'SMUGGLER', 'SPY', 'BOUNTY HUNTER',
    'PILOT', 'OFFICER',
)


def _matches_keyword_phrase(phrase: str, dc_keywords: List[str],
                             affiliation: str) -> bool:
    """Match `phrase` against the DC's keywords + affiliation. The
    phrase may itself be multi-word (e.g. "IMPERIAL TROOPER").
    """
    phrase = phrase.strip()
    if not phrase:
        return False
    if phrase in dc_keywords:
        return True
    # Affiliation match (REBEL / IMPERIAL / MERCENARY).
    if phrase == affiliation:
        return True
    # Compound: every word must appear as a keyword OR as the affiliation.
    parts = [p for p in phrase.split() if p]
    if all(p in dc_keywords or p == affiliation for p in parts):
        return True
    return False


def get_attachment_restriction(
    card_name: str,
    army_dc_names: Optional[List[str]] = None,
    *,
    dc_effects: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Parse the first-line `<X> ONLY` restriction. Returns:
      {'restrictionText': raw_text, 'filter': fn}
    or None when the card has no restriction line.
    """
    if dc_effects is None:
        from python.engine.data.dc_effects_loader import get_dc_effects
        dc_effects = get_dc_effects() or {}
    bracket_key = f'[{card_name}]'
    card = dc_effects.get(card_name) or dc_effects.get(bracket_key)
    if not card:
        return None
    if not card.get('abilityText') and not (card.get('keywords') or []):
        return None
    first_line = (card.get('abilityText') or '').split('\n', 1)[0].strip()
    only_match = re.match(r'^(.+?)\s+ONLY$', first_line, re.IGNORECASE)
    if not only_match:
        return None
    restriction_raw = only_match.group(1).replace('"', '').strip()

    # Split into OR-alternatives. "4 OR MORE" is a phrase, not a split.
    normalized = re.sub(r'(\d+)\s+OR\s+MORE', r'\1_OR_MORE',
                        restriction_raw, flags=re.IGNORECASE)
    or_parts = [s.strip() for s in re.split(r'\s+OR\s+', normalized,
                                             flags=re.IGNORECASE)
                 if s.strip()]
    alternatives: List[str] = []
    for part in or_parts:
        if ',' in part and 'NON-' not in part:
            subs = [s.strip() for s in part.split(',') if s.strip()]
            alternatives.extend(subs)
        else:
            alternatives.append(part.replace('_OR_MORE', ' OR MORE'))

    def filter_fn(dc_name: str) -> bool:
        dc_stats = (dc_effects or {}).get(dc_name) or {}
        if not dc_stats:
            return True  # unknown DC — allow (mirror JS)
        dc_kw_upper = [str(k).upper() for k in (dc_stats.get('keywords') or [])]
        dc_name_upper = (dc_name or '').upper()
        is_unique = bool(dc_stats.get('unique'))
        figure_cost = int(dc_stats.get('cost') or 0)
        figures = int(dc_stats.get('figures') or 1)
        affiliation = (dc_stats.get('affiliation') or '').upper()

        for alt in alternatives:
            alt_upper = re.sub(r'\([^)]*\)', '', alt).strip().upper()

            # NON- conjunction (e.g. "NON-MASSIVE, NON-UNIQUE TROOPER").
            if 'NON-' in alt_upper:
                if 'NON-MASSIVE' in alt_upper and 'MASSIVE' in dc_kw_upper:
                    continue
                if 'NON-UNIQUE' in alt_upper and is_unique:
                    continue
                remaining = (alt_upper
                             .replace('NON-MASSIVE', '')
                             .replace('NON-UNIQUE', '')
                             .replace(',', '').strip())
                if remaining:
                    grp_match = re.match(
                        r'^(.+?)\s+GROUP\s+WITH\s+(\d+)\s+FIGURES?$',
                        remaining,
                    )
                    if grp_match:
                        if figures != int(grp_match.group(2)):
                            continue
                        remaining = grp_match.group(1).strip()
                    if remaining and not _matches_keyword_phrase(
                        remaining, dc_kw_upper, affiliation,
                    ):
                        continue
                return True

            # UNIQUE ...
            if alt_upper.startswith('UNIQUE '):
                if not is_unique:
                    continue
                if alt_upper == 'UNIQUE FIGURE':
                    return True
                cost_match = re.search(r'FIGURE COST (\d+) OR MORE', alt_upper)
                if cost_match and figure_cost < int(cost_match.group(1)):
                    continue
                if 'UNIQUE FIGURE' in alt_upper:
                    return True
                kw_part = re.sub(r'^UNIQUE\s+', '', alt_upper).strip()
                if kw_part and not _matches_keyword_phrase(
                    kw_part, dc_kw_upper, affiliation,
                ):
                    continue
                return True

            # GROUP WITH N FIGURES
            grp = re.match(r'(.+?)\s+GROUP WITH (\d+) FIGURES', alt_upper)
            if grp:
                if figures != int(grp.group(2)):
                    continue
                if not _matches_keyword_phrase(
                    grp.group(1).strip(), dc_kw_upper, affiliation,
                ):
                    continue
                return True

            # Name-based match (checked before keyword to handle e.g.
            # "SHORETROOPER" containing the keyword "TROOPER").
            stripped = re.sub(r'\s*\(.*\)$', '', dc_name_upper)
            if alt_upper in dc_name_upper or stripped in alt_upper:
                return True

            # Keyword match.
            if any(k in alt_upper for k in RESTRICTION_KEYWORDS):
                if _matches_keyword_phrase(
                    alt_upper, dc_kw_upper, affiliation,
                ):
                    return True

        return False

    return {
        'restrictionText': restriction_raw,
        'filter': filter_fn,
        'alternatives': alternatives,
    }
