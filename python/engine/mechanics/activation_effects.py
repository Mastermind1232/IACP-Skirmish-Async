"""Deterministic start/end-of-activation effects — Python mirror of
src/engine/activation-effects.js.

Applied by the activation flow (stepper + handler) whenever a DC begins
or finishes activating. No Discord dependency. No network/IO.

Scope matches the JS file byte-for-byte:

  applyStartOfActivationEffects:
    - Mounted (terro / kuiil / dewback)     → +3 MP
    - Hunger Regular (Wampa)                 → +2 MP when no hostile ≤3
    - Madness (Taron Malicos)                → ≤2 CC in hand → 1 Strain + Focus
    - Into the Fray (Baze Malbus)            → +1 MP, 1 Surge per hostile w/ LOS
    - Comms Jammer (ISB Infiltrator Elite)   → opponent can't play CCs
    - Focused on the Kill (attachment)       → +2 MP
    - Beast Tamer (attachment)               → exhaust → Speed MP (+ interact override)
    - I Make the Rules Now (Cad Bane)        → +1 MP to friendly HUNTERs ≤4 of Cad

  applyEndOfActivationEffects:
    - Weaken auto-discard (unless disarm-locked)
    - Shield (Riot Trooper E/R)              → 1 Block token if none
    - In The Shadows (ISB Infiltrator Elite) → Hide condition
    - Unnerving (0-0-0)                      → adjacent hostiles → Weaken
    - Hold the Line (Baze Malbus)            → 1 Block per hostile w/ LOS
    - Son of Skywalker                       → auto-ready Luke after others' activation

Each branch returns a list of {'effect', 'message'} entries for the
caller (Discord embed or headless log) to display.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from python.engine.data.dc_effects_loader import get_dc_effect, get_dc_effects
from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.mechanics.board_helpers import count_game_spaces
from python.engine.mechanics.card_names import card_name_includes
from python.engine.mechanics.conditions import (
    apply_condition,
    filter_condition,
    is_condition_immune,
)
from python.engine.mechanics.damage_helpers import reduce_hp
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key, parse_figure_key
from python.engine.mechanics.game_helpers import grant_movement_bank
from python.engine.mechanics.los import has_line_of_sight
from python.engine.mechanics.player_helpers import (
    get_activated_dc_indices,
    get_cc_hand,
    get_dc_list,
    get_dc_message_ids,
    opponent_player_num,
    set_activated_dc_indices,
)
from python.engine.mechanics.spatial import get_all_figure_coords
from python.engine.mechanics.tokens import grant_power_tokens


_DG_INDEX_RE = re.compile(r'\[(?:DG|Group) (\d+)\]')


def _dg_index(display_name: Optional[str]) -> str:
    if not display_name:
        return '1'
    m = _DG_INDEX_RE.search(display_name)
    return m.group(1) if m else '1'


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'activation_effects expected GameState or dict, got {type(game).__name__}'
    )


def _includes_any(arr: Any, ids: List[str]) -> bool:
    if not isinstance(arr, list):
        return False
    return any(i in arr for i in ids)


# ---------------------------------------------------------------------------
# Start of activation

def apply_start_of_activation_effects(game: Any, *, dc_name: str, player_num: int,
                                      display_name: str, msg_id: str,
                                      dc_health_state: Optional[Dict[str, Any]] = None
                                      ) -> Dict[str, List[Dict[str, str]]]:
    """Apply deterministic start-of-activation passives.

    Returns {'applied': [{effect, message}, ...]}.
    """
    data = _data(game)
    applied: List[Dict[str, str]] = []
    dc_eff = (get_dc_effects() or {}).get(dc_name) or {}
    ability_ids = dc_eff.get('specialAbilityIds') or []
    passives = dc_eff.get('passives') or []

    # Mounted (Terro / Kuiil / Dewback or tagged passive): +3 MP
    if (_includes_any(ability_ids, ['mounted_terro', 'mounted_kuiil', 'mounted_dewback'])
            or 'Mounted' in passives):
        grant_movement_bank(game, msg_id, 3)
        applied.append({
            'effect': 'Mounted',
            'message': f'**Mounted** — **{display_name}** gains **3 movement points** at the start of activation.',
        })

    # Hunger Regular (Wampa only): +2 MP if no hostile within 3 spaces
    if dc_name == 'Wampa':
        dg = _dg_index(display_name)
        figure_key = f'Wampa-{dg}-0'
        pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(figure_key)
        hostile_nearby = False
        if pos:
            enemy_num = opponent_player_num(player_num)
            hostile_positions = ((data.get('figurePositions') or {}).get(enemy_num) or {}).values()
            hostile_nearby = any(
                hp and count_game_spaces(game, pos, hp) <= 3 for hp in hostile_positions
            )
        if not hostile_nearby and pos:
            grant_movement_bank(game, msg_id, 2)
            applied.append({
                'effect': 'Hunger',
                'message': f'**Hunger** — **{display_name}** gains **2 MP** (no hostile within 3 spaces).',
            })
        else:
            applied.append({
                'effect': 'Hunger',
                'message': f'**Hunger** — Hostile figure within 3 spaces; **{display_name}** does not gain MP.',
            })

    # Madness (Taron Malicos): ≤2 CC in hand → 1 Strain + Focus
    if dc_name == 'Taron Malicos':
        hand = get_cc_hand(game, player_num) or []
        if len(hand) <= 2:
            figure_positions = (data.get('figurePositions') or {}).get(player_num) or {}
            figure_keys = [fk for fk in figure_positions if fk.startswith('Taron Malicos-')]
            for fk in figure_keys:
                apply_condition(game, fk, 'Focus')
                if dc_health_state is not None:
                    fk_idx = parse_figure_key(fk).get('figureIndex', 0)
                    reduce_hp(dc_health_state, data, msg_id, fk_idx, 1, player_num)
            plural = 's' if len(hand) != 1 else ''
            applied.append({
                'effect': 'Madness',
                'message': (
                    f'**Madness** — **{display_name}** has {len(hand)} CC card{plural} '
                    f'in hand (≤2). Suffered **1 Strain** and became **Focused**.'
                ),
            })

    # Into the Fray (Baze Malbus): +1 MP, +1 Surge token per hostile with LOS
    if dc_name == 'Baze Malbus':
        grant_movement_bank(game, msg_id, 1)
        selected = data.get('selectedMap') or {}
        ms = get_map_spaces(selected.get('id')) if isinstance(selected, dict) else None
        dg = _dg_index(display_name)
        self_fk = f'Baze Malbus-{dg}-0'
        self_pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(self_fk)
        surge_count = 0
        if self_pos and ms:
            enemy_num = opponent_player_num(player_num)
            all_fig_coords = get_all_figure_coords(game)
            enemy_positions = (data.get('figurePositions') or {}).get(enemy_num) or {}
            for epos in enemy_positions.values():
                if not epos:
                    continue
                if has_line_of_sight(str(self_pos).lower(), str(epos).lower(), ms, all_fig_coords):
                    surge_count += 1
        if surge_count > 0:
            grant_power_tokens(data, self_fk, 'Surge', surge_count)
        plural = 's' if surge_count != 1 else ''
        applied.append({
            'effect': 'Into the Fray',
            'message': (
                f'**Into the Fray** — **{display_name}** gains **1 MP** and '
                f'**{surge_count} Surge Token{plural}** ({surge_count} hostile{plural} with LOS).'
            ),
        })

    # Comms Jammer (ISB Infiltrator Elite): opponent cannot play CCs this activation
    if 'comms_jammer_isb' in ability_ids:
        data['commsJammerActivePlayerNum'] = player_num
        applied.append({
            'effect': 'Comms Jammer',
            'message': (
                f'**Comms Jammer** — Opponent (P{opponent_player_num(player_num)}) '
                f'cannot play Command Cards during this activation.'
            ),
        })

    # Focused on the Kill (attachment): +2 MP
    attachments = (
        (data.get('p1DcAttachments') or {}).get(msg_id)
        or (data.get('p2DcAttachments') or {}).get(msg_id)
        or []
    )
    if attachments and card_name_includes(attachments, 'Focused on the Kill'):
        grant_movement_bank(game, msg_id, 2)
        applied.append({
            'effect': 'Focused on the Kill',
            'message': f'**Focused on the Kill** — **{dc_name}** gains **2 MP** at start of activation.',
        })

    # Beast Tamer (attachment): exhaust → Speed MP; Non-Sentient → interact override
    if attachments and card_name_includes(attachments, 'Beast Tamer'):
        bt_kws = [str(k).upper() for k in (dc_eff.get('keywords') or [])]
        if 'CREATURE' in bt_kws:
            exhausted_map = data.get('exhaustedSkirmishUpgrades') or {}
            bt_exhausted = exhausted_map.get(msg_id) or []
            if not card_name_includes(bt_exhausted, 'Beast Tamer'):
                if 'exhaustedSkirmishUpgrades' not in data:
                    data['exhaustedSkirmishUpgrades'] = {}
                if msg_id not in data['exhaustedSkirmishUpgrades']:
                    data['exhaustedSkirmishUpgrades'][msg_id] = []
                data['exhaustedSkirmishUpgrades'][msg_id].append('Beast Tamer')
                bt_speed = int(dc_eff.get('speed') or 0)
                if bt_speed > 0:
                    grant_movement_bank(game, msg_id, bt_speed)
                bt_is_non_sentient = 'Non-Sentient' in (dc_eff.get('abilityText') or '')
                if bt_is_non_sentient:
                    if 'beastTamerInteractOverride' not in data:
                        data['beastTamerInteractOverride'] = {}
                    data['beastTamerInteractOverride'][msg_id] = True
                suffix = (
                    ' and **can interact** this activation (Non-Sentient override)'
                    if bt_is_non_sentient else ''
                )
                applied.append({
                    'effect': 'Beast Tamer',
                    'message': (
                        f'**Beast Tamer** — **{display_name}** gains **{bt_speed} MP** (Speed){suffix}.'
                    ),
                })

    # I Make the Rules Now (Cad Bane): each friendly HUNTER within 4 of Cad gains 1 MP
    for pn in (1, 2):
        imrn_dc_list = get_dc_list(game, pn) or []
        imrn_dc_msg_ids = get_dc_message_ids(game, pn) or []
        for di, dc in enumerate(imrn_dc_list):
            if not isinstance(dc, dict) or not dc.get('dcName'):
                continue
            eff = (get_dc_effects() or {}).get(dc['dcName']) or {}
            if 'i_make_the_rules_cad_bane' not in (eff.get('specialAbilityIds') or []):
                continue
            # Skip if Cad Bane IS the activating DC (his own activation doesn't trigger this)
            if dc['dcName'] == dc_name and pn == player_num:
                continue
            cad_dg = _dg_index(dc.get('displayName') or dc['dcName'])
            cad_fk = f"{dc['dcName']}-{cad_dg}-0"
            cad_pos = ((data.get('figurePositions') or {}).get(pn) or {}).get(cad_fk)
            if not cad_pos:
                continue
            friendly_figs = (data.get('figurePositions') or {}).get(pn) or {}
            for fk, fp in friendly_figs.items():
                if not fp:
                    continue
                f_dc_name = dc_name_from_figure_key(fk)
                f_eff = (get_dc_effects() or {}).get(f_dc_name) or {}
                kws = [str(k).upper() for k in (f_eff.get('keywords') or [])]
                if 'HUNTER' not in kws:
                    continue
                if count_game_spaces(game, cad_pos, fp) > 4:
                    continue
                for j, listed in enumerate(imrn_dc_list):
                    if isinstance(listed, dict) and listed.get('dcName') == f_dc_name:
                        grant_movement_bank(game, imrn_dc_msg_ids[j], 1)
                        applied.append({
                            'effect': 'I Make the Rules Now',
                            'message': (
                                f'**I Make the Rules Now** — **{f_dc_name}** '
                                f'(HUNTER within 4 of Cad Bane) gains **1 MP**.'
                            ),
                        })
                        break

    # Adapt (Agent Blaise): pure UI prompt in JS, no engine state mutation.
    # Logged so the audit can confirm wired-engine status truthfully.
    if 'adapt_blaise' in ability_ids:
        applied.append({
            'effect': 'Adapt',
            'message': (
                f'🔄 **Adapt** — **{display_name}** chooses a trait '
                f'for this round (UI-only; no engine effect).'
            ),
        })

    # Fast Learner (Mara Jade): pure UI prompt; the actual gate fires
    # later when CCs are checked. JS only sends a thread message at SoA.
    if 'fast_learner_mara_jade' in ability_ids:
        applied.append({
            'effect': 'Fast Learner',
            'message': (
                f'📚 **Fast Learner** — **{display_name}** may, once this '
                f'round, play a CC whose restriction matches another DC '
                f'name in your army (UI-only at SoA).'
            ),
        })

    # Imperial Loadout (Purge Trooper): start-of-activation prompt that
    # displays the chosen loadout card. JS site:
    # src/engine/activation-setup.js D32. The loadout pick itself happens
    # at deploy-time (handlers/setup.js handleLoadoutConfirm) and writes
    # to figureConfig[figureKey].loadout. The card's effects (stat
    # modifiers, surge abilities) are read by ability/attachment lookups
    # at the relevant sites — no mutation here.
    if 'imperial_loadout_purge_trooper' in ability_ids:
        figs = (data.get('figurePositions') or {}).get(player_num) or {}
        first_fk = next(
            (fk for fk in figs if fk.startswith(dc_name + '-') and figs.get(fk)),
            None,
        )
        config = (data.get('figureConfig') or {}).get(first_fk or '') or {}
        chosen_loadout = config.get('loadout')
        if chosen_loadout:
            applied.append({
                'effect': 'Imperial Loadout',
                'message': f'⚔️ **Imperial Loadout: {chosen_loadout}**',
            })
        else:
            applied.append({
                'effect': 'Imperial Loadout',
                'message': '⚔️ **Imperial Loadout** — no loadout selected',
            })

    # Clawdite Shape (Elite/Reg): start-of-activation prompt displaying
    # the chosen form. JS site: src/engine/activation-setup.js D33.
    # Form pick at deploy-time (handleFormPick) writes to
    # figureConfig[figureKey].form; card effects are scattered.
    if ('shape_clawdite_elite' in ability_ids
            or 'shape_clawdite_reg' in ability_ids):
        figs = (data.get('figurePositions') or {}).get(player_num) or {}
        first_fk = next(
            (fk for fk in figs if fk.startswith(dc_name + '-') and figs.get(fk)),
            None,
        )
        config = (data.get('figureConfig') or {}).get(first_fk or '') or {}
        chosen_form = config.get('form')
        if chosen_form:
            applied.append({
                'effect': 'Clawdite Shape',
                'message': f'🦎 **Form: {chosen_form}**',
            })
        else:
            applied.append({
                'effect': 'Clawdite Shape',
                'message': '🦎 **Clawdite Shape** — no form selected',
            })

    # Scrap Battalion (Ugnaught Tinkerer Elite/Reg): Junk Droid
    # co-activates with the Ugnaught. JS marks the companion to
    # co-activate by stamping companionActivatedBefore[msgId] = 'co-activate'.
    if ('scrap_battalion_ugnaught_elite' in ability_ids
            or 'scrap_battalion_ugnaught_reg' in ability_ids):
        cab = dict(data.get('companionActivatedBefore') or {})
        cab[msg_id] = 'co-activate'
        data['companionActivatedBefore'] = cab
        applied.append({
            'effect': 'Scrap Battalion',
            'message': (
                f'🛠️ **Scrap Battalion** — **{display_name}**: Junk Droid '
                f'companion co-activates with this group.'
            ),
        })

    return {'applied': applied}


# ---------------------------------------------------------------------------
# End of activation

def apply_end_of_activation_effects(game: Any, *, dc_name: str, player_num: int,
                                    display_name: str, msg_id: str
                                    ) -> Dict[str, List[Dict[str, str]]]:
    """Apply deterministic end-of-activation effects for a just-finished DC.

    Returns {'applied': [{effect, message}, ...]}.
    """
    data = _data(game)
    applied: List[Dict[str, str]] = []
    dc_eff = (get_dc_effects() or {}).get(dc_name) or {}
    dg = _dg_index(display_name)
    prefix = f'{dc_name}-{dg}-'
    figure_positions = (data.get('figurePositions') or {}).get(player_num) or {}
    figure_keys = [k for k in figure_positions if k.startswith(prefix)]

    # Weakened auto-discards (CRR-WKN-002) unless disarm-permanent-Weakened locked
    conditions_map = data.get('figureConditions') or {}
    disarm_map = data.get('disarmPermanentWeakened') or {}
    for fk in figure_keys:
        fk_cond = conditions_map.get(fk) or []
        if 'Weaken' not in fk_cond:
            continue
        if disarm_map.get(fk):
            continue
        filter_condition(game, fk, 'Weaken')
        applied.append({
            'effect': 'Weaken discard',
            'message': f'**Weakened** — **{dc_name_from_figure_key(fk)}** discarded Weaken at end of activation.',
        })

    # Bleed damage: figures with Bleed take 1 damage at end of activation.
    # JS rule: Bleed is not auto-discarded (must be cleared via a CC or
    # ability). Each bleeding figure suffers 1 damage per end-of-activation.
    bleed_victims: List[str] = []
    for fk in figure_keys:
        fk_cond = conditions_map.get(fk) or []
        if 'Bleed' not in fk_cond:
            continue
        fig_idx = parse_figure_key(fk).get('figureIndex', 0)
        dc_health_state = data.get('dcHealthState')
        if isinstance(dc_health_state, dict):
            reduce_hp(dc_health_state, data, msg_id, fig_idx, 1, player_num)
        bleed_victims.append(dc_name_from_figure_key(fk))
    if bleed_victims:
        applied.append({
            'effect': 'Bleed',
            'message': (
                f'**Bleed** — {", ".join(bleed_victims)} suffered '
                f'1 Damage at end of activation.'
            ),
        })

    # Shield (Riot Trooper E/R): grant Block token if none held
    passives = dc_eff.get('passives') or []
    if 'Shield' in passives:
        power_tokens_map = data.get('figurePowerTokens') or {}
        for fk in figure_keys:
            tokens = power_tokens_map.get(fk) or []
            if 'Block' not in tokens:
                grant_power_tokens(data, fk, 'Block', 1)
                applied.append({
                    'effect': 'Shield',
                    'message': (
                        f'**Shield** — **{dc_name_from_figure_key(fk)}** '
                        f'gained 1 **Block Token** at end of activation.'
                    ),
                })

    # In The Shadows (ISB Infiltrator Elite): become Hidden
    if dc_name == 'ISB Infiltrator (Elite)':
        any_hidden = False
        for fk in figure_keys:
            apply_condition(game, fk, 'Hide')
            any_hidden = True
        if any_hidden:
            applied.append({
                'effect': 'In The Shadows',
                'message': (
                    f'**In The Shadows** — **ISB Infiltrator (Elite)** '
                    f'figures became **Hidden** at end of activation.'
                ),
            })

    # Unnerving (0-0-0): each adjacent hostile becomes Weakened
    if dc_name == '0-0-0':
        enemy_num = opponent_player_num(player_num)
        selected = data.get('selectedMap') or {}
        ms = get_map_spaces(selected.get('id')) if isinstance(selected, dict) else None
        weakened: List[str] = []
        enemy_positions = (data.get('figurePositions') or {}).get(enemy_num) or {}
        for fk in figure_keys:
            pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(fk)
            if not pos:
                continue
            pos_norm = str(pos).lower()
            adj = [str(a).lower() for a in ((ms or {}).get('adjacency') or {}).get(pos_norm, [])]
            for e_fk, e_pos in enemy_positions.items():
                if not e_pos or str(e_pos).lower() not in adj:
                    continue
                if is_condition_immune(game, e_fk):
                    continue
                if apply_condition(game, e_fk, 'Weaken'):
                    weakened.append(dc_name_from_figure_key(e_fk))
        if weakened:
            applied.append({
                'effect': 'Unnerving',
                'message': f'**Unnerving** — **0-0-0** Weakened adjacent hostiles: {", ".join(weakened)}.',
            })

    # Hold the Line (Baze Malbus): 1 Block per hostile with LOS
    if dc_name == 'Baze Malbus':
        htl_fk = f'Baze Malbus-{dg}-0'
        htl_pos = ((data.get('figurePositions') or {}).get(player_num) or {}).get(htl_fk)
        block_count = 0
        if htl_pos:
            enemy_num = opponent_player_num(player_num)
            selected = data.get('selectedMap') or {}
            ms = get_map_spaces(selected.get('id')) if isinstance(selected, dict) else None
            all_fig_coords = get_all_figure_coords(game)
            enemy_positions = (data.get('figurePositions') or {}).get(enemy_num) or {}
            for epos in enemy_positions.values():
                if not epos:
                    continue
                if has_line_of_sight(str(htl_pos).lower(), str(epos).lower(), ms, all_fig_coords):
                    block_count += 1
        if block_count > 0:
            grant_power_tokens(data, htl_fk, 'Block', block_count)
        plural = 's' if block_count != 1 else ''
        name = display_name or 'Baze Malbus'
        applied.append({
            'effect': 'Hold the Line',
            'message': (
                f'**Hold the Line** — **{name}** gained '
                f'**{block_count} Block Token{plural}** '
                f'({block_count} hostile{plural} with LOS).'
            ),
        })

    # Son of Skywalker: auto-ready Luke's DC after any OTHER activation ends
    sos = data.get('sonOfSkywalkerActive')
    if sos:
        sos_msg_id = sos.get('dcMsgId') if isinstance(sos, dict) else None
        sos_player_num = sos.get('playerNum') if isinstance(sos, dict) else None
        if sos_msg_id and sos_player_num and sos_msg_id != msg_id:
            sos_activated = get_activated_dc_indices(game, sos_player_num) or []
            sos_dc_ids = (
                data.get('p1DcMessageIds') if sos_player_num == 1
                else data.get('p2DcMessageIds')
            ) or []
            if sos_msg_id in sos_dc_ids:
                sos_idx = sos_dc_ids.index(sos_msg_id)
                if sos_idx in sos_activated:
                    set_activated_dc_indices(
                        game, sos_player_num,
                        [i for i in sos_activated if i != sos_idx],
                    )
                    applied.append({
                        'effect': 'Son of Skywalker',
                        'message': '**Son of Skywalker** — **Luke Skywalker** is automatically **Readied**.',
                    })

    # Final cleanup: clear all activation-scoped flags for this msg_id /
    # player / figure_keys. Mirrors JS cleanupActivation in
    # src/game/activation-state.js. Must run last so prior steps can read
    # any activation flags they need.
    try:
        from python.engine.mechanics.activation_state import cleanup_activation
        cleanup_activation(game, msg_id, player_num, figure_keys)
    except Exception:
        pass

    return {'applied': applied}
