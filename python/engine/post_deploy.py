"""Post-deploy phase engine.

Mirrors src/handlers/post-deploy.js. Pure-state scan + queue
construction; no Discord output.

Two entry points:
  - scan_player_post_deploy_abilities(game, player_num): scans deployed
    figures for passives that fire post-deploy. Returns a list of
    ability descriptors that the Discord layer (or AI training loop)
    can consume.
  - run_post_deploy_phase(game): scans both players, populates
    game['postDeployQueue'] with all triggered abilities. Sets a flag
    that callers (Discord handlers) read to drive the auto-resolve loop.

The actual ability resolution (token grants, condition application,
movement bonuses) is delegated to per-ability handlers in
mechanics/conditions.py / mechanics/tokens.py / activation_effects.py.
This module is the scan + queue layer.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _state(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _dc_name_from_figure_key(figure_key: str) -> str:
    """'Han Solo (Rebel Hero)-1-0' → 'Han Solo (Rebel Hero)'."""
    parts = figure_key.rsplit('-', 2)
    if len(parts) == 3:
        return parts[0]
    return figure_key


def _normalize_coord(c: Any) -> str:
    return str(c).lower() if c else ''


def scan_player_post_deploy_abilities(game: Any,
                                       player_num: int
                                       ) -> List[Dict[str, Any]]:
    """Scan one player's deployed figures for post-deploy passive triggers.

    Mirrors JS scanPlayerPostDeployAbilities. Returns a list of ability
    descriptors:
      {abilityId, label, dcName, figureKey, playerNum, interactive,
       type: 'token'|'condition'|'movement'|'multi_movement', ...}

    The Discord layer reads this list to render appropriate prompts;
    AI training loops invoke each entry's auto-resolve handler in turn.
    """
    from python.engine.data.dc_effects_loader import get_dc_effects

    abilities: List[Dict[str, Any]] = []
    data = _state(game)
    dc_effects = get_dc_effects() or {}

    fp_all = data.get('figurePositions') or {}
    fp = fp_all.get(player_num) or fp_all.get(str(player_num)) or {}
    if not isinstance(fp, dict):
        return abilities

    fig_entries = list(fp.items())

    for fk, pos in fig_entries:
        if not pos:
            continue
        dc_name = _dc_name_from_figure_key(fk)
        eff = dc_effects.get(dc_name)
        if not eff:
            # Try stripping (Elite) / (Regular) suffix.
            stripped = dc_name.rstrip()
            for suffix in (' (Elite)', ' (Regular)'):
                if stripped.endswith(suffix):
                    eff = dc_effects.get(stripped[:-len(suffix)])
                    if eff:
                        break
        if not eff:
            continue

        passives = eff.get('passives') or []

        if 'Beskar Armor' in passives:
            abilities.append({
                'abilityId': 'beskar_armor', 'label': 'Beskar Armor',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': False, 'type': 'token',
            })
        if 'Stealthy' in passives:
            abilities.append({
                'abilityId': 'stealthy', 'label': 'Stealthy',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': False, 'type': 'condition',
            })
        if 'Ambush' in passives:
            abilities.append({
                'abilityId': 'ambush', 'label': 'Ambush',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': False, 'type': 'condition',
            })
        if 'In The Shadows' in passives:
            abilities.append({
                'abilityId': 'in_the_shadows', 'label': 'In The Shadows',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': False, 'type': 'condition',
            })
        if 'Forward Emplacement' in passives:
            speed = eff.get('speed') or 0
            if speed > 0:
                abilities.append({
                    'abilityId': 'forward_emplacement',
                    'label': 'Forward Emplacement',
                    'dcName': dc_name, 'figureKey': fk,
                    'playerNum': player_num,
                    'interactive': True, 'type': 'movement', 'mp': speed,
                })
        if 'Security Detail' in passives:
            leaders: List[Dict[str, Any]] = []
            for lfk, lpos in fig_entries:
                if not lpos:
                    continue
                ldn = _dc_name_from_figure_key(lfk)
                leff = dc_effects.get(ldn) or {}
                kws = [str(k).upper() for k in (leff.get('keywords') or [])]
                if 'LEADER' in kws:
                    leaders.append({'figureKey': lfk, 'dcName': ldn})
            interactive = len(leaders) > 1
            abilities.append({
                'abilityId': 'security_detail', 'label': 'Security Detail',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': interactive, 'type': 'token',
                'leaders': leaders,
            })

        if 'Infiltration' in passives:
            abilities.append({
                'abilityId': 'infiltration', 'label': 'Infiltration',
                'dcName': dc_name, 'figureKey': fk, 'playerNum': player_num,
                'interactive': True, 'type': 'movement', 'mp': 4,
            })

    return abilities


def run_post_deploy_phase(game: Any) -> List[Dict[str, Any]]:
    """Scan BOTH players' figures for post-deploy abilities; populate
    game['postDeployQueue'] with the union.

    Mirrors JS runPostDeployPhase. Returns the queue list. Callers
    (Discord handlers, AI training, drift replay) then drain the queue
    by invoking auto-resolve / interactive handlers per entry.
    """
    data = _state(game)
    queue = []
    queue.extend(scan_player_post_deploy_abilities(game, 1))
    queue.extend(scan_player_post_deploy_abilities(game, 2))
    data['postDeployQueue'] = queue
    return queue


def finish_post_deploy(game: Any) -> None:
    """Clear the post-deploy queue after all entries are resolved.

    Mirrors JS finishPostDeploy's pure-state portion (no callbacks /
    Discord IO). Callers invoke once the queue is fully drained to
    transition to the round-1 flow.
    """
    data = _state(game)
    if 'postDeployQueue' in data:
        del data['postDeployQueue']
    data['postDeployComplete'] = True
