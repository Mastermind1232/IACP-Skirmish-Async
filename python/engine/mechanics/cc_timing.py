"""CC play-timing gates — Python mirror of src/game/cc-timing.js.

When can a Command Card be played from hand? This module owns:

  get_cc_play_context(game, player_num) → game-state snapshot dict
      (startOfRound, duringActivation, endOfRound, duringAttack, …)

  is_cc_playable_now(game, player_num, card_name) → bool
      Full timing-enum dispatch covering ~55 timing strings. specialAction
      and doubleActionSpecial cards return False (they fire from the DC
      button, not from the hand dropdown).

  get_playable_cc_from_hand(game, player_num, hand) → filtered hand

  is_cc_play_legal_by_restriction(game, player_num, card_name)
      → {'legal': bool, 'reason'?: str, 'fastLearner'?: True}
      Enforces playableBy with support for:
        - affiliation + keyword decomposition ("IMPERIAL FORCE USER")
        - "or" alternatives, quoted names
        - Fallen Master override (FORCE USER → IMPERIAL)
        - Devout (Chirrut: REBEL FORCE USER virtual)
        - Adaptive Skills (Mara Jade): per-army affiliation + trait inject
        - Compound synonyms ("large creature" → MASSIVE + CREATURE)
        - State qualifier stripping ("readied vehicle" → "vehicle")

  cc_playable_by_matches / has_darksaber_imperial /
  is_cc_playable_by_dc / get_playable_cc_specials_for_dc /
  is_cc_double_action_playable_by_dc / get_playable_cc_double_actions_for_dc /
  get_playable_cc_end_of_activation_for_dc

  get_playable_reaction_cards_for_timing(game, player_num, timings)
      → canonical combat-reaction pipeline (timing + is_playable_now +
      is_play_legal_by_restriction + Provoke-target gate).
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

from python.engine.data.cc_effects_loader import get_cc_effect
from python.engine.data.dc_effects_loader import get_dc_effects
from python.engine.mechanics.board_helpers import count_game_spaces
from python.engine.mechanics.dc_keywords import get_dc_keywords
from python.engine.mechanics.player_helpers import (
    get_cc_hand,
    get_dc_attachments,
    get_dc_list,
    get_dc_message_ids,
    get_player_id,
    opponent_player_num,
)


ADAPTIVE_SKILLS_ABILITY_ID = 'adaptive_skills_mara_jade'


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'cc_timing expected GameState or dict, got {type(game).__name__}'
    )


# ---------------------------------------------------------------------------
# Play context

def get_cc_play_context(game: Any, player_num: int) -> Dict[str, Any]:
    """Derive CC-play context from game state. Mirrors JS getCcPlayContext."""
    data = _data(game)
    player_id = get_player_id(game, player_num)

    in_sor_window = bool(data.get('startOfRoundWhoseTurn'))
    start_of_round = bool(data.get('currentRound') and in_sor_window)
    during_activation = (
        not in_sor_window
        and data.get('currentActivationTurnPlayerId') == player_id
        and not data.get('endOfRoundWhoseTurn')
    )
    end_of_round = data.get('endOfRoundWhoseTurn') == player_id
    combat = data.get('combat') or data.get('pendingCombat')
    during_attack = bool(combat)
    is_attacker = bool(during_attack and combat and combat.get('attackerPlayerNum') == player_num)
    is_defender = bool(during_attack and combat and combat.get('defenderPlayerNum') == player_num)
    during_round = bool(
        not in_sor_window
        and data.get('currentRound')
        and data.get('currentActivationTurnPlayerId')
        and not data.get('endOfRoundWhoseTurn')
    )

    combat_hit = combat.get('hit') if combat else None
    defender_rerolled = bool(combat and len(combat.get('defenderRerolledIndices') or []) > 0)
    recent_defeat = bool(data.get('lastDefeatInfo'))

    return {
        'startOfRound': start_of_round,
        'duringActivation': during_activation,
        'endOfRound': end_of_round,
        'duringAttack': during_attack,
        'isAttacker': is_attacker,
        'isDefender': is_defender,
        'duringRound': during_round,
        'combatHit': combat_hit,
        'defenderRerolled': defender_rerolled,
        'recentDefeat': recent_defeat,
        'combat': combat,
    }


# ---------------------------------------------------------------------------
# is_cc_playable_now

_SPECIAL_ACTION_TIMING = frozenset({'specialaction', 'doubleactionspecial'})


def is_cc_playable_now(game: Any, player_num: int, card_name: str,
                       get_effect: Callable[[str], Optional[Dict[str, Any]]] = get_cc_effect,
                       ) -> bool:
    """True iff this CC can be played from hand right now."""
    data = _data(game)
    if data.get('shadowOpsBlockedPlayer') == player_num:
        return False
    if data.get('criticalHitBlockedPlayer') == player_num:
        return False
    cj = data.get('commsJammerActivePlayerNum')
    if cj and cj != player_num:
        return False

    effect = get_effect(card_name)
    if not effect or not effect.get('timing'):
        return False
    timing = str(effect.get('timing')).lower().strip()
    if timing in _SPECIAL_ACTION_TIMING:
        return False

    # Per-phase once-per-round limits
    if card_name == 'Jundland Terror' and data.get('jundlandTerrorPlayedThisEor'):
        return False
    if card_name == 'Reinforcements' and data.get('reinforcementsPlayedThisSor'):
        return False

    cbt = data.get('pendingCombat') or data.get('combat')
    if cbt and cbt.get('ccLockedOut') and timing == 'duringattack':
        return False

    ctx = get_cc_play_context(game, player_num)

    if timing in ('startofround', 'startofstatusphase'):
        return ctx['startOfRound']
    if timing == 'duringactivation':
        return ctx['duringActivation']
    if timing in ('startofactivation', 'endofactivation'):
        return ctx['duringActivation']
    if timing == 'endofround':
        return ctx['endOfRound']
    if timing == 'duringattack':
        return ctx['duringAttack']
    if timing in ('whiledefending', 'whenattackdeclaredonyou',
                  'afterattacktargetingyouresolved'):
        return ctx['duringAttack'] and ctx['isDefender']
    if timing == 'beforeyoudeclareattack':
        return ctx['duringActivation']
    if timing == 'whenyoudeclareattack':
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing in ('afterattack', 'afterattackdice'):
        return ctx['duringAttack']
    if timing == 'afteryouresolveattackthatdidnotmissduetoaccuracy':
        return ctx['duringAttack'] and ctx['isAttacker'] and ctx['combatHit'] is not False
    if timing == 'whenhostilefigureinyourlineofsightattacking':
        return ctx['duringAttack'] and ctx['isDefender']
    if timing == 'whileadjacentfriendlyfiguredefending':
        return ctx['duringAttack'] and ctx['isDefender']
    if timing == 'whileattackingbeforedefenderrerolls':
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing == 'afteryouresolveattacktargetingfigure':
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing == 'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight':
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing == 'whenyoudeclareattacktargetinghostilewithhighestfigurecost':
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing in (
        'whenyoudeclareclosequarters',
        'whenyoudeclareindiscriminatefire',
        'whenyouperformrapidfire',
    ):
        return ctx['duringAttack'] and ctx['isAttacker']
    if timing in ('whenfigurewithin3spacesdefending',
                  'whenfriendlyrebelforceuserwithin4spacesrollsdice'):
        return ctx['duringAttack']
    if timing == 'afterhostilefiguresuffersdamage':
        return ctx['duringActivation'] or ctx['duringRound']
    if timing == 'whenoneofyourfiguresdefeated':
        return (ctx['duringActivation'] or ctx['duringRound']) and ctx['recentDefeat']
    if timing == 'whencommandcardplayed':
        # Negation & Comm Disruption: reactive-only, never shown in dropdown.
        return False
    # All the remaining "during your activation" reaction/trigger timings
    if timing in (
        'whenyouhavesuffereddamageequaltoyourhealth',
        'whenhostilefigureentersspacewithin3spaces',
        'whenhostilefigureentersadjacentspace',
        'whenfriendlyfigurewithin2spacessuffers3plusdamage',
        'whenfriendlyfigurewithin3spaceswouldbedefeated',
        'whenyouendmovementinspaceswithotherfigures',
        'whenyoudeclarelightsaberthrow',
        'afterdamage',
        'whenattackdeclaredtargetingfriendlysmallfigurecost10orlesswithin3spaces',
        'afteractivationresolves',
        'afterspecial',
        'whenattackdeclaredonadjacentfriendly',
        'atstartofactivationofhostilefigureinyourlineofsight',
        'afteryouresolvegroupsactivation',
        'usewhenyouusegambit',
        'beforedeclaringrangedattack',
        'whenhostilefigurewithin3spacesdefeated',
        'whenhostilefiguredefeatednotyouractivation',
        'afteruniquehostiledefeated',
        'afterspecialorinteract',
        'afteryouresolvecloseandpersonal',
        'afteryouresolveinterrogate',
        'atstartofhostilefigureactivation',
        'usewhenyouusedualbladedfury',
        'usewhenyouuseemperor',
        'whencommandcarddiscardedfromhandordeck',
        'whenenemyfigureactivates',
        'whenhostilefigureexitsadjacentspace',
        'other',
    ):
        return ctx['duringActivation']

    return False


def get_playable_cc_from_hand(game: Any, player_num: int,
                              hand: Optional[List[str]]) -> List[str]:
    """Filter hand to cards playable right now."""
    return [c for c in (hand or []) if is_cc_playable_now(game, player_num, c)]


# ---------------------------------------------------------------------------
# is_cc_play_legal_by_restriction

_AFFILIATIONS = frozenset({'imperial', 'rebel', 'scum', 'mercenary'})
_STATE_QUALIFIERS = ('readied', 'exhausted', 'focused', 'hidden',
                     'stunned', 'weakened', 'bleeding')
_COMPOUND_SYNONYMS = {
    'large creature': ('massive', 'creature'),
}
_DG_SUFFIX_RE = re.compile(r'\s*\[(?:DG|Group) \d+\]$', re.IGNORECASE)
_VARIANT_SUFFIX_RE = re.compile(r'\s*\((?:Elite|Regular)\)\s*$', re.IGNORECASE)


def _alternative_matches_dc(alt: str, dc_base_lower: str, disp_lower: str,
                            affiliation_lower: str, kw_lower: List[str]) -> bool:
    """Single alternative match check. Mirrors JS alternativeMatchesDc."""
    # Name match (both containment directions)
    if (dc_base_lower and (dc_base_lower in alt or alt in dc_base_lower)):
        return True
    if disp_lower and (disp_lower in alt or alt in disp_lower):
        return True

    # Compound synonyms
    if alt in _COMPOUND_SYNONYMS:
        return all(kw in kw_lower for kw in _COMPOUND_SYNONYMS[alt])

    # State qualifier stripping
    stripped_alt = alt
    for q in _STATE_QUALIFIERS:
        if stripped_alt.startswith(q + ' '):
            stripped_alt = stripped_alt[len(q) + 1:].strip()
            break

    # Decompose into affiliation + keyword parts
    words = stripped_alt.split()
    req_affiliation: Optional[str] = None
    req_keyword_words: List[str] = []
    for w in words:
        if w in _AFFILIATIONS and not req_affiliation:
            req_affiliation = w
        else:
            req_keyword_words.append(w)
    req_keyword = ' '.join(req_keyword_words)

    if req_affiliation and affiliation_lower not in (req_affiliation, 'any'):
        return False
    if req_keyword and req_keyword not in kw_lower:
        return False
    return bool(req_affiliation or req_keyword)


def is_cc_play_legal_by_restriction(game: Any, player_num: int, card_name: str,
                                    get_effect: Callable[[str], Optional[Dict[str, Any]]] = get_cc_effect,
                                    ) -> Dict[str, Any]:
    """Legality check by playableBy restriction.

    Returns {'legal': bool, 'reason'?: str, 'fastLearner'?: True} — Fast
    Learner (Mara Jade's Adaptive Skills) is flagged separately so the
    caller can stamp the per-round cooldown. Mirrors JS byte-for-byte.
    """
    data = _data(game)
    effect = get_effect(card_name)
    playable_by = (effect.get('playableBy') if effect else '') or ''
    playable_by = playable_by.strip()
    if not playable_by or playable_by.lower() == 'any figure':
        return {'legal': True}

    dc_list = get_dc_list(game, player_num) or []
    all_keywords = get_dc_keywords(game)
    dc_effects = get_dc_effects() or {}
    p = playable_by.lower()

    if p in ('any small figure', 'any unique figure', 'unique'):
        return {'legal': True}

    alternatives = [
        a.strip().strip('"').lower()
        for a in re.split(r'\s+or\s+', playable_by, flags=re.IGNORECASE)
    ]

    # Army-wide DC ability modifiers
    has_fallen_master = False
    has_devout = False
    adaptive_skills_dc: Optional[str] = None
    army_affiliation: Optional[str] = None

    for dc in dc_list:
        dc_name = (dc.get('dcName') or dc.get('displayName')) if isinstance(dc, dict) else dc
        if not dc_name:
            continue
        eff = dc_effects.get(dc_name) or {}
        s_ids = eff.get('specialAbilityIds') or []
        if 'fallen_master_malicos' in s_ids:
            has_fallen_master = True
        if 'devout_chirrut' in s_ids:
            has_devout = True
        if ADAPTIVE_SKILLS_ABILITY_ID in s_ids:
            adaptive_skills_dc = dc_name
        aff = str(eff.get('affiliation') or '').lower()
        if aff and aff != 'any' and not army_affiliation:
            army_affiliation = aff

    for dc in dc_list:
        dc_name = (dc.get('dcName') or dc.get('displayName')) if isinstance(dc, dict) else dc
        if not dc_name:
            continue
        dc_base = _VARIANT_SUFFIX_RE.sub('', _DG_SUFFIX_RE.sub('', str(dc_name))).strip()
        disp = (dc.get('displayName') if isinstance(dc, dict) else None) or dc_name or dc_base
        dc_data = dc_effects.get(dc_name) or dc_effects.get(dc_base) or {}
        affiliation_lower = str(dc_data.get('affiliation') or '').lower()
        kw = all_keywords.get(dc_name) or all_keywords.get(dc_base) or []
        kw_lower = [str(k).lower() for k in kw]

        effective_affiliation = affiliation_lower
        if dc_name == adaptive_skills_dc and army_affiliation:
            effective_affiliation = army_affiliation

        effective_kw = list(kw_lower)
        if dc_name == adaptive_skills_dc and army_affiliation:
            as_map = {'imperial': 'hunter', 'scum': 'smuggler', 'rebel': 'guardian'}
            trait = as_map.get(army_affiliation)
            if trait and trait not in effective_kw:
                effective_kw.append(trait)

        for alt in alternatives:
            if _alternative_matches_dc(alt, dc_base.lower(), str(disp).lower(),
                                        effective_affiliation, effective_kw):
                return {'legal': True}
            # Fallen Master override: FORCE USER → IMPERIAL for CC restriction purposes
            if has_fallen_master and 'force user' in kw_lower:
                if _alternative_matches_dc(alt, dc_base.lower(), str(disp).lower(),
                                            'imperial', effective_kw):
                    return {'legal': True}

    # Devout (Chirrut): REBEL FORCE USER virtual — can play FORCE USER CCs with no aff
    # requirement OR rebel affiliation.
    if has_devout:
        for alt in alternatives:
            words = alt.split()
            req_aff = None
            kw_words = []
            for w in words:
                if w in _AFFILIATIONS:
                    req_aff = w
                else:
                    kw_words.append(w)
            req_kw = ' '.join(kw_words)
            if req_kw == 'force user' and (not req_aff or req_aff == 'rebel'):
                return {'legal': True}

    # Fast Learner (Mara Jade Adaptive Skills): once per round, allow when
    # the restriction matches another DC name in the army.
    if adaptive_skills_dc:
        round_used = (data.get('roundFigureAbilityUsed') or {})
        key = f'{adaptive_skills_dc}_fast_learner'
        if not round_used.get(key):
            cc_name_lower = (card_name or '').lower()
            if 'arcing shot' not in cc_name_lower:
                for dc in dc_list:
                    other_name = (dc.get('dcName') or dc.get('displayName')) if isinstance(dc, dict) else dc
                    if not other_name or other_name == adaptive_skills_dc:
                        continue
                    other_base = _VARIANT_SUFFIX_RE.sub(
                        '', _DG_SUFFIX_RE.sub('', str(other_name))).strip()
                    other_disp = (dc.get('displayName') if isinstance(dc, dict) else None) or other_name or other_base
                    for alt in alternatives:
                        alt_low = alt.strip().lower()
                        o_base = other_base.lower()
                        o_disp = str(other_disp).lower()
                        if (o_base in alt_low or alt_low in o_base
                                or o_disp in alt_low or alt_low in o_disp):
                            return {'legal': True, 'fastLearner': True}

    return {'legal': False, 'reason': f'No figure matches "playable by: {playable_by}" in your army.'}


# ---------------------------------------------------------------------------
# Per-DC playability (Special Action / Double Action Special / End of Activation)

def cc_playable_by_matches(playable_by: Optional[str], dc_name: str,
                           display_name: Optional[str] = None,
                           has_darksaber_imperial: bool = False,
                           extra_keywords: Optional[List[str]] = None,
                           game: Optional[Any] = None) -> bool:
    """DC-local playability match (Special Action timing etc.)."""
    if not playable_by:
        return False
    if playable_by.lower() == 'any figure':
        return True
    dc_base = _VARIANT_SUFFIX_RE.sub(
        '', _DG_SUFFIX_RE.sub('', dc_name or '')).strip()
    display_base = _VARIANT_SUFFIX_RE.sub(
        '', _DG_SUFFIX_RE.sub('', display_name or dc_base)).strip()
    d = dc_base.lower()
    disp = display_base.lower()
    kw_map = get_dc_keywords(game)
    base_keywords = kw_map.get(dc_name) or kw_map.get(dc_base)
    keywords = list(base_keywords or [])
    if extra_keywords:
        keywords.extend(extra_keywords)
    alternatives = [s.strip().lower() for s in re.split(r'\s+or\s+', playable_by, flags=re.IGNORECASE)]
    for alt in alternatives:
        if d in alt or alt in d or disp in alt or alt in disp:
            return True
        if keywords and any(str(k).lower() == alt for k in keywords):
            return True
    # The Darksaber: FORCE USER + Darksaber can use IMPERIAL Command cards
    if has_darksaber_imperial and 'imperial' in alternatives:
        return True
    return False


def has_darksaber_imperial(game: Any, player_num: int, dc_name: str) -> bool:
    """True if activating DC is FORCE USER with The Darksaber attached."""
    dc_base = _VARIANT_SUFFIX_RE.sub(
        '', _DG_SUFFIX_RE.sub('', dc_name or '')).strip()
    kw_map = get_dc_keywords(game)
    keywords = kw_map.get(dc_name) or kw_map.get(dc_base) or []
    if not any(str(k).upper() == 'FORCE USER' for k in keywords):
        return False
    atts = get_dc_attachments(game, player_num) or {}
    msg_ids = get_dc_message_ids(game, player_num) or []
    dc_list = get_dc_list(game, player_num) or []
    for i, msg_id in enumerate(msg_ids):
        if i >= len(dc_list):
            break
        entry = dc_list[i]
        entry_name = entry.get('dcName') if isinstance(entry, dict) else entry
        if entry_name != dc_base and entry_name != dc_name:
            continue
        if 'The Darksaber' in (atts.get(msg_id) or []):
            return True
    return False


def is_cc_playable_by_dc(cc_name: str, dc_name: str, display_name: Optional[str] = None,
                         has_darksaber: bool = False,
                         extra_keywords: Optional[List[str]] = None,
                         game: Optional[Any] = None) -> bool:
    """Special Action timing per-DC playability gate."""
    effect = get_cc_effect(cc_name)
    if not effect or str(effect.get('timing') or '').lower() != 'specialaction':
        return False
    return cc_playable_by_matches((effect.get('playableBy') or '').strip(),
                                   dc_name, display_name, has_darksaber,
                                   extra_keywords, game)


def get_playable_cc_specials_for_dc(game: Any, player_num: int, dc_name: str,
                                    display_name: Optional[str] = None) -> List[str]:
    hand = get_cc_hand(game, player_num) or []
    darksaber = has_darksaber_imperial(game, player_num, dc_name)
    extra_kw = _get_programming_override_keywords(game, player_num, dc_name)
    return [cc for cc in hand if is_cc_playable_by_dc(cc, dc_name, display_name,
                                                       darksaber, extra_kw, game)]


def is_cc_double_action_playable_by_dc(cc_name: str, dc_name: str,
                                       display_name: Optional[str] = None,
                                       has_darksaber: bool = False,
                                       extra_keywords: Optional[List[str]] = None,
                                       game: Optional[Any] = None) -> bool:
    effect = get_cc_effect(cc_name)
    if not effect or str(effect.get('timing') or '').lower() != 'doubleactionspecial':
        return False
    return cc_playable_by_matches((effect.get('playableBy') or '').strip(),
                                   dc_name, display_name, has_darksaber,
                                   extra_keywords, game)


def get_playable_cc_double_actions_for_dc(game: Any, player_num: int, dc_name: str,
                                          display_name: Optional[str] = None) -> List[str]:
    hand = get_cc_hand(game, player_num) or []
    darksaber = has_darksaber_imperial(game, player_num, dc_name)
    extra_kw = _get_programming_override_keywords(game, player_num, dc_name)
    return [cc for cc in hand
            if is_cc_double_action_playable_by_dc(cc, dc_name, display_name,
                                                    darksaber, extra_kw, game)]


def get_playable_cc_end_of_activation_for_dc(game: Any, player_num: int, dc_name: str,
                                             display_name: Optional[str] = None) -> List[str]:
    hand = get_cc_hand(game, player_num) or []
    darksaber = has_darksaber_imperial(game, player_num, dc_name)
    extra_kw = _get_programming_override_keywords(game, player_num, dc_name)
    out: List[str] = []
    for cc in hand:
        effect = get_cc_effect(cc)
        if not effect or str(effect.get('timing') or '').lower() != 'endofactivation':
            continue
        if cc_playable_by_matches((effect.get('playableBy') or '').strip(),
                                    dc_name, display_name, darksaber, extra_kw, game):
            out.append(cc)
    return out


# ---------------------------------------------------------------------------
# Reaction cards (combat timing triggers)

def _has_provoke_target(game: Any, player_num: int) -> bool:
    """True iff any hostile is adjacent to a friendly TROOPER or GUARDIAN."""
    data = _data(game)
    dc_effects = get_dc_effects() or {}
    opp_num = opponent_player_num(player_num)
    friendly_positions = (data.get('figurePositions') or {}).get(player_num) or {}
    hostile_positions = (data.get('figurePositions') or {}).get(opp_num) or {}
    hostile_entries = list(hostile_positions.items())
    if not hostile_entries:
        return False
    for fk, pos in friendly_positions.items():
        if not pos:
            continue
        dc_name = re.sub(r'-\d+-\d+$', '', fk)
        eff = dc_effects.get(dc_name) or {}
        kws = [str(k).upper() for k in (eff.get('keywords') or [])]
        if 'TROOPER' not in kws and 'GUARDIAN' not in kws:
            continue
        for _, h_pos in hostile_entries:
            if not h_pos:
                continue
            if count_game_spaces(game, pos, h_pos) <= 1:
                return True
    return False


def get_playable_reaction_cards_for_timing(game: Any, player_num: int,
                                           timing_triggers: List[str]
                                           ) -> List[Dict[str, Any]]:
    """Return hand cards matching ANY trigger timing that pass full legality."""
    hand = get_cc_hand(game, player_num) or []
    if not hand:
        return []
    trigger_set = {str(t).lower().strip() for t in timing_triggers}
    results: List[Dict[str, Any]] = []
    seen = set()
    for card_name in hand:
        if card_name in seen:
            continue
        seen.add(card_name)
        effect = get_cc_effect(card_name)
        if not effect or not effect.get('timing'):
            continue
        timing_lower = str(effect.get('timing')).lower().strip()
        if timing_lower not in trigger_set:
            continue
        if not is_cc_playable_now(game, player_num, card_name):
            continue
        verdict = is_cc_play_legal_by_restriction(game, player_num, card_name)
        if not verdict.get('legal'):
            continue
        if card_name == 'Provoke' and not _has_provoke_target(game, player_num):
            continue
        results.append({
            'cardName': card_name,
            'timing': effect.get('timing'),
            'playableBy': effect.get('playableBy') or 'Any Figure',
            'cost': effect.get('cost') or 0,
        })
    return results


# ---------------------------------------------------------------------------
# Programming Override (4-LOM)

def _get_programming_override_keywords(game: Any, player_num: int,
                                       dc_name: str) -> Optional[List[str]]:
    """Return [trait] if Programming Override is active on 4-LOM this round."""
    data = _data(game)
    trait_map = data.get('roundProgrammingOverrideTrait') or {}
    trait = trait_map.get(player_num)
    if not trait:
        return None
    dc_base = _VARIANT_SUFFIX_RE.sub(
        '', _DG_SUFFIX_RE.sub('', dc_name or '')).strip()
    if dc_base != '4-LOM':
        return None
    return [trait]
