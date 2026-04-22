"""D2.29 — Defeat pipeline (pure-engine subset).

Byte-identical port of the pure-engine steps from
`src/engine/defeat-handler.js:processFigureDefeat`, plus the supporting VP and
activation helpers from `src/game/vp-helpers.js`, `src/engine/mission-helpers.js`,
and `src/game/player-helpers.js`.

Pure-engine subset ported here:
  1. remove_figure_position          — drops the figure + clears device tokens
                                        + clears conditions
  2. calculate_kill_vp               — per-figure VP for a kill (respects
                                        companion guard + subCost rule)
  3. award_kill_vp / award_objective_vp / deduct_vp / ensure_vp
                                     — VP mutation helpers
  4. check_nefarious_gains           — Jabba the Hutt +1 objective VP on kill
  5. recompute_activation_counts     — single-source-of-truth activation math
  6. process_figure_defeat           — orchestrator for the 9-step defeat flow,
                                        covering the deterministic game-state
                                        mutations (steps 1–2b, 4, 5, 7 from JS)

Steps deferred to later slices (handler/UI-bound):
  3 — Discord defeat log line                     → D11 integration layer
  6 — Passive CC redraws (Shared Experience)       → D3 ability dispatch
  8 — Hunt Dissent (Kallus block token)            → D3 ability dispatch
  8b — Heroic Effort CC return prompt              → D3 E.18 handler
  8c — Scavenged Weaponry transfer prompt          → D4 attachment handling
  8d — This is the Way (Armorer block token)       → D3 ability dispatch
  9 — Win-condition check                          → D5 mission layer

The orchestrator takes optional callbacks for these deferred effects so a
caller that already has them wired (e.g. the Discord handler, via D3/D4 deps)
can inject them without the pure-engine module taking on the dependency.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from python.engine.data.dc_effects_loader import get_dc_effect, get_dc_effects
from python.engine.mechanics.dc_helpers import dc_name_from_figure_key


# ── Player-state accessors (port of player-helpers.js subset) ───────────────

def _dc_list_key(player_num: int) -> str:
    return 'p1DcList' if player_num == 1 else 'p2DcList'


def _dc_message_ids_key(player_num: int) -> str:
    return 'p1DcMessageIds' if player_num == 1 else 'p2DcMessageIds'


def _activated_dc_indices_key(player_num: int) -> str:
    return 'p1ActivatedDcIndices' if player_num == 1 else 'p2ActivatedDcIndices'


def _activations_total_key(player_num: int) -> str:
    return 'p1ActivationsTotal' if player_num == 1 else 'p2ActivationsTotal'


def _activations_remaining_key(player_num: int) -> str:
    return 'p1ActivationsRemaining' if player_num == 1 else 'p2ActivationsRemaining'


def _dc_attachments_key(player_num: int) -> str:
    return 'p1DcAttachments' if player_num == 1 else 'p2DcAttachments'


def _cc_attachments_key(player_num: int) -> str:
    return 'p1CcAttachments' if player_num == 1 else 'p2CcAttachments'


# ── Figure-position mutations ───────────────────────────────────────────────

def remove_figure_position(game: Dict[str, Any],
                           player_num: int,
                           figure_key: str) -> None:
    """Remove a figure and its per-figure state.

    Mirrors `player-helpers.js:removeFigurePosition`. Clears:
      - `game['figurePositions'][playerNum][figureKey]`
      - `game['deviceTokens'][figureKey]`
      - `game['figureConditions'][figureKey]`
    All deletes are defensive — missing keys are ignored.
    """
    fp = game.get('figurePositions') or {}
    if player_num in fp and figure_key in fp[player_num]:
        del fp[player_num][figure_key]
    dt = game.get('deviceTokens') or {}
    if figure_key in dt:
        del dt[figure_key]
    fc = game.get('figureConditions') or {}
    if figure_key in fc:
        del fc[figure_key]


# ── VP mutation helpers (port of vp-helpers.js) ────────────────────────────

def _vp_key(player_num: int) -> str:
    return 'player1VP' if player_num == 1 else 'player2VP'


def ensure_vp(game: Dict[str, Any], player_num: int) -> Dict[str, int]:
    """Ensure game[vpKey(pn)] exists and return it.

    Mirrors `vp-helpers.js:ensureVp`. Default shape is
    `{total: 0, kills: 0, objectives: 0}`.
    """
    key = _vp_key(player_num)
    if key not in game or not game[key]:
        game[key] = {'total': 0, 'kills': 0, 'objectives': 0}
    return game[key]


def award_kill_vp(game: Dict[str, Any], player_num: int, amount: int) -> None:
    """Award kill VP: increments `kills` + `total`.

    Amount may be negative (e.g. negative-cost attachments); JS has no
    sign-restriction in this function. Mirrors `vp-helpers.js:awardKillVp`.
    """
    vp = ensure_vp(game, player_num)
    vp['kills'] = (vp.get('kills') or 0) + amount
    vp['total'] = (vp.get('total') or 0) + amount


def award_objective_vp(game: Dict[str, Any], player_num: int, amount: int) -> None:
    """Award objective VP: increments `objectives` + `total`."""
    vp = ensure_vp(game, player_num)
    vp['objectives'] = (vp.get('objectives') or 0) + amount
    vp['total'] = (vp.get('total') or 0) + amount


def deduct_vp(game: Dict[str, Any], player_num: int, amount: int) -> None:
    """Deduct VP (clamped to 0). Objectives first, then kills.

    Mirrors `vp-helpers.js:deductVp`. `total` is clamped at 0 at the end.
    """
    vp = ensure_vp(game, player_num)
    remaining = amount
    obj = vp.get('objectives') or 0
    obj_deduct = min(obj, remaining)
    vp['objectives'] = obj - obj_deduct
    remaining -= obj_deduct
    if remaining > 0:
        vp['kills'] = max(0, (vp.get('kills') or 0) - remaining)
    vp['total'] = max(0, (vp.get('total') or 0) - amount)


def check_nefarious_gains(game: Dict[str, Any],
                          defeated_owner_pn: int) -> Optional[Dict[str, Any]]:
    """Jabba the Hutt: +1 objective VP when any hostile figure is defeated.

    Mirrors `vp-helpers.js:checkNefariousGains`. Returns
    `{jabbaOwnerPN, vpTotal}` when Jabba is alive on the opposing team, else
    None. Pure data — no Discord logging.
    """
    jabba_owner = 1 if defeated_owner_pn == 2 else 2
    positions = (game.get('figurePositions') or {}).get(jabba_owner) or {}
    jabba_alive = any(fk.startswith('Jabba the Hutt-') for fk in positions.keys())
    if not jabba_alive:
        return None
    award_objective_vp(game, jabba_owner, 1)
    vp_total = (game.get(_vp_key(jabba_owner)) or {}).get('total', 0)
    return {'jabbaOwnerPN': jabba_owner, 'vpTotal': vp_total}


# ── Kill VP calculation (port of mission-helpers.js:calculateKillVp) ───────

def _is_dc_companion(dc_name: str) -> bool:
    """True if the DC is flagged `companion: true` in dc-effects.json."""
    eff = get_dc_effect(dc_name) or {}
    return eff.get('companion') is True


def calculate_kill_vp(dc_name: str) -> int:
    """Return the VP value for defeating one figure of this DC.

    Mirrors `mission-helpers.js:calculateKillVp`. Rules:
      - Companions are worth 0 VP.
      - Multi-figure groups use `effects.subCost` when set; otherwise
        `stats.cost` (falling back to 5 when stats are missing — IA default
        deployment cost for unknown DCs, matches JS `?? 5`).
    """
    if _is_dc_companion(dc_name):
        return 0
    eff = get_dc_effect(dc_name) or {}
    figures = eff.get('figures') if eff.get('figures') is not None else 1
    cost = eff.get('cost')
    sub_cost = eff.get('subCost')
    if figures and figures > 1 and sub_cost is not None:
        return sub_cost
    return cost if cost is not None else 5


# ── Activation count recompute (port of player-helpers.js) ─────────────────

def recompute_activation_counts(game: Dict[str, Any],
                                player_num: int) -> Dict[str, int]:
    """Recompute ActivationsTotal/Remaining from the current board state.

    Mirrors `player-helpers.js:recomputeActivationCounts`. A DC is activatable
    iff it has at least one figure on the board (truthy position value). Lie-
    in-Ambush set-aside groups (no position) don't count. Figureless DCs
    (name in `[Brackets]`) are skipped entirely. Remaining = total minus the
    count of already-activated indices that are still activatable.
    """
    dc_list = game.get(_dc_list_key(player_num)) or []
    fig_positions = (game.get('figurePositions') or {}).get(player_num) or {}
    fig_keys = list(fig_positions.keys())
    activated_indices = game.get(_activated_dc_indices_key(player_num)) or []

    total = 0
    activated = 0
    dg_counts: Dict[str, int] = {}

    for i, dc in enumerate(dc_list):
        dc_name = dc.get('dcName') if isinstance(dc, dict) else dc
        if not dc_name or (isinstance(dc_name, str)
                           and dc_name.startswith('[')
                           and dc_name.endswith(']')):
            continue
        dg_counts[dc_name] = (dg_counts.get(dc_name, 0) or 0) + 1
        dg_index = dg_counts[dc_name]
        prefix = f'{dc_name}-{dg_index}-'
        has_figures = any(fk.startswith(prefix) and fig_positions.get(fk)
                          for fk in fig_keys)
        if has_figures:
            total += 1
            if i in activated_indices:
                activated += 1

    game[_activations_total_key(player_num)] = total
    game[_activations_remaining_key(player_num)] = total - activated
    return {'total': total, 'remaining': total - activated}


# ── Attachment VP lookup ────────────────────────────────────────────────────

def _attachment_vp(game: Dict[str, Any],
                   player_num: int,
                   msg_id: str,
                   dc_name: str) -> int:
    """Compute attachment VP when the last figure of the group is defeated.

    Mirrors step 2b of `defeat-handler.js`. Rules: "When the last figure of a
    group with an Attachment is defeated, the opposing player scores VPs
    equal to the deployment cost of the Attachment." Negative costs reduce
    total VP. Returns 0 if any figures remain alive.
    """
    fp = (game.get('figurePositions') or {}).get(player_num) or {}
    group_alive = any(fk.startswith(f'{dc_name}-') and fp.get(fk) for fk in fp.keys())
    if group_alive:
        return 0
    att_key = _dc_attachments_key(player_num)
    attachments = (game.get(att_key) or {}).get(msg_id) or []
    total = 0
    all_effects = get_dc_effects()
    for att_name in attachments:
        att_eff = all_effects.get(att_name) or {}
        att_cost = att_eff.get('cost')
        if att_cost is None:
            # Fall back to stripping brackets (mirror getDcEffect fallback).
            import re
            stripped = re.sub(r'\s*\[.*\]\s*$', '', att_name)
            att_cost = (all_effects.get(stripped) or {}).get('cost')
        if att_cost is None:
            continue
        if att_cost != 0:
            total += att_cost
    return total


# ── Main orchestrator ───────────────────────────────────────────────────────

def process_figure_defeat(game: Dict[str, Any],
                          opts: Dict[str, Any],
                          deps: Optional[Dict[str, Callable]] = None) -> Dict[str, Any]:
    """Run the pure-engine subset of the defeat pipeline.

    `opts` mirrors the JS call:
      - `defeatedPlayerNum` (int, required)
      - `figureKey` (str, required)
      - `attackerPlayerNum` (int, required)
      - `msgId` (str, optional) — DC message ID for attachment cleanup
      - `dcIdx` (int, optional, default -1)
      - `dcName` (str, optional — derived from figureKey when omitted)
      - `awardVp` (bool, optional, default True)

    `deps` is an optional dict of callbacks for later-slice integrations that
    the caller may or may not have wired up yet:
      - `checkWinConditions(game)` — from D5
      - `checkFriendlyDefeatedPassiveRedraws(game, pn, dcName)` — from D3
      - `checkHuntDissent(game, attackerPn, attackerFigureKey)` — from D3
      - `checkThisIsTheWay(game, attackerPn, attackerFigureKey)` — from D3

    Returns `{vp, dcName, attachmentVp, nefarious}`.
    Pure-engine side effects on `game`:
      - figurePositions / deviceTokens / figureConditions entries removed
      - VP (kills) awarded to attacker (including attachment VP)
      - Activation counts recomputed for the defeated side
      - `game[ccAttachmentsKey(pn)][msgId]` cleared when non-empty
      - Jabba's Nefarious Gains objective VP (if applicable)
    """
    deps = deps or {}
    defeated_pn: int = opts['defeatedPlayerNum']
    figure_key: str = opts['figureKey']
    attacker_pn: int = opts['attackerPlayerNum']
    msg_id: Optional[str] = opts.get('msgId')
    dc_idx: int = opts.get('dcIdx', -1)
    dc_name: str = opts.get('dcName') or dc_name_from_figure_key(figure_key)
    award_vp = opts.get('awardVp', True)

    # 1. Remove position + conditions + device tokens
    remove_figure_position(game, defeated_pn, figure_key)

    # 2. Calculate + award kill VP, plus attachment VP (2b) when last-in-group.
    vp = 0
    attachment_vp = 0
    if award_vp:
        vp = calculate_kill_vp(dc_name)
        if vp > 0:
            award_kill_vp(game, attacker_pn, vp)
        if msg_id:
            attachment_vp = _attachment_vp(game, defeated_pn, msg_id, dc_name)
            if attachment_vp != 0:
                award_kill_vp(game, attacker_pn, attachment_vp)

    # 4. Decrement activation if group fully defeated (derived from board state).
    recompute_activation_counts(game, defeated_pn)

    # 5. Clear CC attachments for the defeated DC.
    if msg_id and dc_idx >= 0:
        cc_key = _cc_attachments_key(defeated_pn)
        cc_atts = game.get(cc_key) or {}
        if cc_atts.get(msg_id):
            del cc_atts[msg_id]

    # 6 — Passive CC redraws (Shared Experience, etc.) — deferred to D3.
    check_redraws = deps.get('checkFriendlyDefeatedPassiveRedraws')
    redrawn: List[str] = []
    if callable(check_redraws):
        result = check_redraws(game, defeated_pn, dc_name) or {}
        redrawn = list(result.get('redrawn') or [])

    # 7. Nefarious Gains (Jabba: +1 objective VP when hostile defeated).
    nefarious = check_nefarious_gains(game, defeated_pn)

    # 8, 8d — Hunt Dissent, This is the Way — deferred to D3.
    attacker_fk = opts.get('attackerFigureKey')
    check_hunt = deps.get('checkHuntDissent')
    if attacker_fk and callable(check_hunt):
        check_hunt(game, attacker_pn, attacker_fk)
    check_titw = deps.get('checkThisIsTheWay')
    if attacker_fk and callable(check_titw):
        check_titw(game, attacker_pn, attacker_fk)

    # 8b, 8c — Heroic Effort + Scavenged Weaponry — deferred to D3/D4.
    # 9 — Win conditions — deferred to D5.
    check_win = deps.get('checkWinConditions')
    if not opts.get('skipWinConditions') and callable(check_win):
        check_win(game)

    return {
        'vp': vp,
        'attachmentVp': attachment_vp,
        'dcName': dc_name,
        'nefarious': nefarious,
        'redrawn': redrawn,
    }
