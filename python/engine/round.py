"""Round-phase engine. Pure-state subset of src/handlers/round.js.

Three entry points:
  - run_start_of_round(game): start-of-round housekeeping. Increments
    round counter, swaps initiative, applies SoR DC effects, runs
    mission start-of-round rules. No Discord IO.
  - run_end_of_round(game): end-of-round housekeeping. Runs mission
    end-of-round rules, applies EoR DC effects, calls
    cleanup_round_start to reset round-scoped flags.
  - run_start_of_round_dc_effects(game): DC-passive subset of SoR.
    Mirrors JS runStartOfRoundDcEffects. Returns True when any async
    effect is pending (caller must wait for resolution before
    continuing the activation phase).

The Discord layer wraps these with thread/embed updates; the AI
training loop calls them directly between rounds.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _state(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _opp_player(player_num: int) -> int:
    return 2 if player_num == 1 else 1


def _initiative_player_num(game: Any) -> int:
    """Return the player number that holds initiative (1 or 2)."""
    data = _state(game)
    init_id = data.get('initiativePlayerId')
    if init_id == data.get('player1Id'):
        return 1
    if init_id == data.get('player2Id'):
        return 2
    # Fallback: read the explicit field if present.
    return int(data.get('initiativePlayerNum') or 1)


def _swap_initiative(game: Any) -> None:
    """Swap initiative to the other player. Mirrors JS round.js:852."""
    data = _state(game)
    p1_id = data.get('player1Id')
    p2_id = data.get('player2Id')
    cur = data.get('initiativePlayerId')
    if cur == p1_id and p2_id is not None:
        data['initiativePlayerId'] = p2_id
    elif cur == p2_id and p1_id is not None:
        data['initiativePlayerId'] = p1_id


def run_start_of_round_dc_effects(game: Any) -> List[Dict[str, Any]]:
    """Apply DC start-of-round passives. Returns a list of triggered
    effects (for logging) and stamps any pending state.

    Mirrors JS runStartOfRoundDcEffects (round.js:1071). Pure-state
    subset — no Discord prompts. Async / interactive effects (those
    that require a player choice) stamp `pendingSorActions` on game
    so callers can wait before continuing.
    """
    triggered: List[Dict[str, Any]] = []
    data = _state(game)

    # Iterate both players' DC lists.
    from python.engine.data.dc_effects_loader import get_dc_effects
    dc_effects = get_dc_effects() or {}
    for pn in (1, 2):
        dc_list = data.get(f'p{pn}DcList') or []
        msg_ids = data.get(f'p{pn}DcMessageIds') or []
        fp_all = data.get('figurePositions') or {}
        fp = fp_all.get(pn) or fp_all.get(str(pn)) or {}
        for i, dc in enumerate(dc_list):
            if not isinstance(dc, dict) or i >= len(msg_ids):
                continue
            dc_name = dc.get('dcName')
            msg_id = msg_ids[i]
            if not dc_name or not msg_id:
                continue
            eff = dc_effects.get(dc_name)
            if not eff:
                continue
            sids = eff.get('specialAbilityIds') or []
            # Self Destruct Probe (Saboteur Probe Droid Elite/Reg) —
            # arms at start of round 2+; explodes via end-of-activation
            # / movement triggers later.
            if 'self_destruct_probe' in sids:
                cur_round = int(data.get('currentRound') or data.get('round') or 1)
                if cur_round >= 2:
                    triggered.append({
                        'effect': 'self_destruct_probe',
                        'dcName': dc_name,
                        'msgId': msg_id,
                        'playerNum': pn,
                    })
            # Other start-of-round passives are ported per-ability via
            # pattern_d trigger='start-of-round'. Fire them here.
            try:
                from python.engine.abilities.pattern_d import fire_ability
                from python.engine.data.ability_library_loader import (
                    get_ability,
                )
                for sid in sids:
                    try:
                        ability = get_ability(sid)
                        if not ability:
                            continue
                        trigger = (ability.get('trigger') or '').lower()
                        if trigger != 'start-of-round':
                            continue
                        # Find a representative figure_key for the DC.
                        fk = next(
                            (f for f in fp if isinstance(f, str)
                             and f.startswith(dc_name + '-')),
                            None,
                        )
                        if not fk:
                            continue
                        result = fire_ability(data, sid, {
                            'figure_key': fk,
                            'msg_id': msg_id,
                            'player_num': pn,
                            'trigger': 'start-of-round',
                        })
                        if result:
                            triggered.append({
                                'ability_id': sid,
                                'figureKey': fk,
                                **result,
                            })
                    except Exception:
                        continue
            except Exception:
                pass

    if triggered:
        data['lastStartOfRoundDcEvents'] = triggered
    return triggered


def run_start_of_round(game: Any) -> Dict[str, Any]:
    """Start-of-round flow. Mirror of JS round.js _runInitiativeSwapAndContinue
    + runStatusPhaseAfterEndOfRound's start-of-round portion.

    Side effects (in order):
      1. Swap initiative to the other player.
      2. Increment currentRound + round counter.
      3. Reset round-scoped flags via cleanup_round_start.
      4. Set roundPhase = 'activation'.
      5. Reset both players' p{N}ActivationsRemaining to live group counts.
      6. Apply mission start-of-round rules.
      7. Fire DC start-of-round passives.

    Returns a result dict {currentRound, initiativePlayerNum,
    triggeredEffects} for caller logging.
    """
    from python.engine.mechanics.activation_state import cleanup_round_start

    data = _state(game)

    # 1. Swap initiative.
    _swap_initiative(game)

    # 2. Increment round counter.
    cur_round = int(data.get('currentRound') or data.get('round') or 1)
    data['currentRound'] = cur_round + 1
    data['round'] = cur_round + 1

    # 3. Reset round-scoped flags.
    cleanup_round_start(game)

    # 4. Round phase → activation.
    data['roundPhase'] = 'activation'
    data['phase'] = 'round_active'

    # 5. Reset activation counters from live group counts.
    for pn in (1, 2):
        groups = _count_live_groups(game, pn)
        data[f'p{pn}ActivationsRemaining'] = groups
        data[f'p{pn}ActivationsTotal'] = groups
        data[f'p{pn}ActivatedDcIndices'] = []

    # 6. Mission start-of-round rules — already wired in mission_rules.
    try:
        from python.engine.mechanics.mission_rules import (
            run_start_of_round_rules,
        )
        sel_map = data.get('selectedMap') or {}
        map_id = data.get('mapId') or sel_map.get('id')
        sel_mission = data.get('selectedMission') or {}
        variant = sel_mission.get('variant') or 'a'
        rules = sel_mission.get('rules') or {}
        sor = rules.get('startOfRound') if isinstance(rules, dict) else None
        if map_id and sor:
            run_start_of_round_rules(game, map_id, variant, dict(sor))
    except Exception:
        pass

    # 7. DC start-of-round passives.
    triggered = run_start_of_round_dc_effects(game)

    return {
        'currentRound': data['currentRound'],
        'initiativePlayerNum': _initiative_player_num(game),
        'triggeredEffects': triggered,
    }


def run_end_of_round(game: Any) -> Dict[str, Any]:
    """End-of-round flow. Mirror of JS runEndOfRoundRules + EoR-passive
    fire sites.

    Side effects (in order):
      1. Run mission end-of-round rules (terminal VP, fluctuation swap
         opportunities, NPC activations, etc.).
      2. Fire DC end-of-round passives via pattern_d trigger='end-of-round'.
      3. Set roundPhase = 'end_of_round'.
      4. Stamp endOfRoundWhoseTurn = initiative player.

    Mission rules + per-ability triggers handle their own logging via
    apply_end_of_round_dc_effects (already in mechanics/round_effects.py).

    NOTE: cleanup_round_start is NOT called here — it fires at the
    START of the NEXT round. End-of-round leaves the round flags in
    place so end-of-round CCs can read them.
    """
    data = _state(game)
    triggered: List[Dict[str, Any]] = []

    # 1. Mission end-of-round rules.
    try:
        from python.engine.mechanics.mission_rules import run_end_of_round_rules
        sel_map = data.get('selectedMap') or {}
        map_id = data.get('mapId') or sel_map.get('id')
        sel_mission = data.get('selectedMission') or {}
        variant = sel_mission.get('variant') or 'a'
        rules = sel_mission.get('rules') or {}
        eor = rules.get('endOfRound') if isinstance(rules, dict) else None
        if map_id and eor:
            run_end_of_round_rules(game, map_id, variant, dict(eor))
    except Exception:
        pass

    # 2. DC end-of-round passives. Already partial in round_effects.
    try:
        from python.engine.mechanics.round_effects import (
            apply_end_of_round_dc_effects,
        )
        events = apply_end_of_round_dc_effects(game)
        if events:
            data['lastEndOfRoundDcEvents'] = events
            triggered.extend(events)
    except Exception:
        pass

    # 3. Round phase → end_of_round.
    data['roundPhase'] = 'end_of_round'

    # 4. End-of-round turn = initiative player.
    init_id = data.get('initiativePlayerId')
    if init_id is not None:
        data['endOfRoundWhoseTurn'] = init_id

    return {
        'roundPhase': 'end_of_round',
        'triggeredEffects': triggered,
    }


def _count_live_groups(game: Any, player_num: int) -> int:
    """Count distinct deployment groups still on the board (≥1 figure
    alive) for the given player. Used to reset activation counts."""
    data = _state(game)
    fp_all = data.get('figurePositions') or {}
    fp = fp_all.get(player_num) or fp_all.get(str(player_num)) or {}
    if not isinstance(fp, dict):
        return 0
    groups = set()
    for fk, pos in fp.items():
        if not pos:
            continue
        # figure_key shape: <DcName>-<groupIdx>-<figIdx>
        parts = fk.rsplit('-', 2)
        if len(parts) == 3:
            groups.add(f'{parts[0]}-{parts[1]}')
    return len(groups)
