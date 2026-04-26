"""Legal-action pending-state gates.

When any pendingXxx flag is set on the game state, the AI / action
enumerator must return only the actions that resolve that pending
state. JS getAvailableActions does this via a long if/else chain at
the top; this module is the Python mirror.

Entry point:
  pending_gate_actions(game) → Optional[List[Dict]]

Returns None when no pending flag is active (caller should compute
normal legal-action set). Returns a list of action dicts when a flag
is active.

Each action dict has shape:
  {'type': '<action_type>', 'params': {...}}

Mirrors the JS priority order: combat-flag first, then card-react
flags, then space-pick / choice flags. JS source:
src/engine/available-actions.js getAvailableActions.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _data(game: Any) -> Dict[str, Any]:
    return game.data if hasattr(game, 'data') else game


def _truthy_dict(value: Any) -> bool:
    """Return True when `value` is a non-empty dict / list / scalar."""
    if value is None:
        return False
    if isinstance(value, (dict, list, tuple, set)):
        return bool(value)
    return bool(value)


# Pending-flag → action-list builder. Each builder returns either:
#   - None: gate not active
#   - List[Dict]: the actions that resolve this gate
#
# Builders are checked in the order listed. First match wins; the
# remainder are not evaluated. Mirrors JS `getAvailableActions`
# top-down priority.


def _gate_pending_combat(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    """In-flight combat: defer to combat_phases.legal_combat_actions."""
    pc = data.get('pendingCombat')
    if not isinstance(pc, dict) or not pc:
        return None
    from python.engine.mechanics.combat_phases import legal_combat_actions
    return legal_combat_actions(data)


def _gate_pending_negation(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if not _truthy_dict(data.get('pendingNegation')):
        return None
    return [
        {'type': 'negation_play'},
        {'type': 'negation_let_resolve'},
    ]


def _gate_pending_celebration(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    if not _truthy_dict(data.get('pendingCelebration')):
        return None
    return [
        {'type': 'celebration_play'},
        {'type': 'celebration_pass'},
    ]


def _gate_pending_comm_disruption(data: Dict[str, Any]
                                   ) -> Optional[List[Dict[str, Any]]]:
    if not _truthy_dict(data.get('pendingCommDisruptionPrompt')):
        return None
    return [
        {'type': 'comm_disruption_play'},
        {'type': 'comm_disruption_skip'},
    ]


def _gate_pending_cc_choice(data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    cc_choice = data.get('pendingCcChoice')
    if not isinstance(cc_choice, dict):
        return None
    options = cc_choice.get('options') or cc_choice.get('choiceOptions') or []
    if not options:
        return None
    return [
        {'type': 'cc_choice', 'params': {'index': i}}
        for i in range(len(options))
    ]


def _gate_pending_cc_space_choice(data: Dict[str, Any]
                                   ) -> Optional[List[Dict[str, Any]]]:
    pcsc = data.get('pendingCcSpaceChoice')
    if not isinstance(pcsc, dict):
        return None
    spaces = pcsc.get('validSpaces') or []
    return [
        {'type': 'cc_space', 'params': {'space': s}}
        for s in spaces
    ]


def _gate_pending_dc_ability_choice(data: Dict[str, Any]
                                     ) -> Optional[List[Dict[str, Any]]]:
    pdac = data.get('pendingDcAbilityChoice')
    if not isinstance(pdac, dict):
        return None
    options = pdac.get('options') or []
    return [
        {'type': 'dc_ability_choice', 'params': {'index': i}}
        for i in range(len(options))
    ]


def _gate_pending_space_pick(data: Dict[str, Any]
                              ) -> Optional[List[Dict[str, Any]]]:
    psp = data.get('pendingSpacePick')
    if not isinstance(psp, dict):
        return None
    spaces = psp.get('validSpaces') or psp.get('spaces') or []
    return [
        {'type': 'space_pick', 'params': {'space': s}}
        for s in spaces
    ]


def _gate_pending_pattern_e(data: Dict[str, Any]
                             ) -> Optional[List[Dict[str, Any]]]:
    """Generic Pattern E pending-state gate. Most chains expose
    `pendingPatternE` with `pickType` + payload; AI can pick from
    any options offered.
    """
    ppe = data.get('pendingPatternE')
    if not isinstance(ppe, dict):
        return None
    pick_type = ppe.get('pickType') or 'space'
    options = ppe.get('options') or []
    if not options and pick_type == 'space':
        options = ppe.get('validSpaces') or []
    if not options:
        return None
    return [
        {'type': f'pattern_e_{pick_type}',
         'params': {'index': i, 'option': opt}}
        for i, opt in enumerate(options)
    ]


def _gate_pending_power_token_grant(data: Dict[str, Any]
                                     ) -> Optional[List[Dict[str, Any]]]:
    ptg = data.get('pendingPowerTokenGrant')
    if not isinstance(ptg, dict):
        return None
    options = ptg.get('options') or ['Block', 'Evade', 'Surge', 'Hit', 'Power']
    return [
        {'type': 'power_token_choice', 'params': {'token': t}}
        for t in options
    ]


def _gate_pending_power_token_overflow(data: Dict[str, Any]
                                        ) -> Optional[List[Dict[str, Any]]]:
    pto = data.get('pendingPowerTokenOverflow')
    if not pto:
        return None
    if isinstance(pto, list) and pto:
        first = pto[0]
        if isinstance(first, dict):
            existing = first.get('existingTokens') or []
            return [
                {'type': 'power_token_overflow_discard',
                 'params': {'index': i}}
                for i in range(len(existing))
            ]
    return None


def _gate_pending_strain_choice(data: Dict[str, Any]
                                 ) -> Optional[List[Dict[str, Any]]]:
    if not _truthy_dict(data.get('pendingChannelTheForceStrain')):
        return None
    return [
        {'type': 'strain_choice', 'params': {'amount': n}}
        for n in (1, 2, 3)
    ]


def _gate_pending_force_slow(data: Dict[str, Any]
                              ) -> Optional[List[Dict[str, Any]]]:
    pfs = data.get('pendingForceSlow')
    if not isinstance(pfs, dict):
        return None
    figure_keys = pfs.get('figureKeys') or []
    return [
        {'type': 'force_slow_pick', 'params': {'figureKey': fk}}
        for fk in figure_keys
    ]


def _gate_pending_self_destruct(data: Dict[str, Any]
                                 ) -> Optional[List[Dict[str, Any]]]:
    if not _truthy_dict(data.get('pendingSelfDestruct')):
        return None
    return [
        {'type': 'self_destruct_protocol_use'},
        {'type': 'self_destruct_protocol_skip'},
    ]


def _gate_pending_force_vision(data: Dict[str, Any]
                                ) -> Optional[List[Dict[str, Any]]]:
    if data.get('forceVisionPending') is None:
        return None
    fv_options = data.get('pendingForceVisionOptions') or []
    return [
        {'type': 'force_vision_pick', 'params': {'dcName': d}}
        for d in fv_options
    ] or [{'type': 'force_vision_skip'}]


def _gate_pending_under_duress(data: Dict[str, Any]
                                ) -> Optional[List[Dict[str, Any]]]:
    pud = data.get('pendingUnderDuress')
    if not isinstance(pud, dict):
        return None
    return [
        {'type': 'under_duress_pay'},
        {'type': 'under_duress_pass'},
    ]


def _gate_pending_negation_window(data: Dict[str, Any]
                                   ) -> Optional[List[Dict[str, Any]]]:
    """Other react-window flags that gate to play-or-skip choices."""
    react_flags = (
        ('pendingDeflect',           'deflect'),
        ('pendingCoverFire',         'cover_fire'),
        ('pendingItWillBeAlright',   'iwba'),
        ('pendingMuchToLearn',       'much_to_learn'),
    )
    for flag, prefix in react_flags:
        if _truthy_dict(data.get(flag)):
            return [
                {'type': f'{prefix}_play'},
                {'type': f'{prefix}_skip'},
            ]
    return None


def _gate_pending_cc_confirmation(data: Dict[str, Any]
                                   ) -> Optional[List[Dict[str, Any]]]:
    pcc = data.get('pendingCcConfirmation')
    if not isinstance(pcc, dict):
        return None
    return [
        {'type': 'cc_confirm_play'},
        {'type': 'cc_cancel_play'},
    ]


# Priority-ordered registry. First match wins.
PENDING_GATES = (
    _gate_pending_combat,
    _gate_pending_negation,
    _gate_pending_celebration,
    _gate_pending_self_destruct,
    _gate_pending_negation_window,   # deflect / cover_fire / iwba / mtl
    _gate_pending_cc_confirmation,
    _gate_pending_cc_choice,
    _gate_pending_dc_ability_choice,
    _gate_pending_cc_space_choice,
    _gate_pending_space_pick,
    _gate_pending_pattern_e,
    _gate_pending_power_token_grant,
    _gate_pending_power_token_overflow,
    _gate_pending_strain_choice,
    _gate_pending_force_slow,
    _gate_pending_force_vision,
    _gate_pending_under_duress,
    _gate_pending_comm_disruption,
)


def pending_gate_actions(game: Any) -> Optional[List[Dict[str, Any]]]:
    """Return the gated action set when a pendingXxx flag is active.

    Returns None when no gate matches (caller computes normal actions).
    """
    data = _data(game)
    for gate in PENDING_GATES:
        result = gate(data)
        if result is not None:
            return result
    return None


def list_active_pending_flags(game: Any) -> List[str]:
    """Diagnostic: return a list of pendingXxx flag names that are
    currently set. Useful for AI training logs / drift inspection.
    """
    data = _data(game)
    out: List[str] = []
    for key in data:
        if not isinstance(key, str):
            continue
        if not (key.startswith('pending') or key == 'forceVisionPending'):
            continue
        if _truthy_dict(data.get(key)):
            out.append(key)
    return out
