"""Button builders — mirror of src/discord/action-buttons.js.

Turns legal_actions output into Discord button components. Pure function:
game state in → ActionRow[] out. No Discord API calls; the bot layer
converts the ActionRow dicts to discord.py objects.

ActionRow shape (dict-based so tests don't need discord.py):
    {'type': 'action_row', 'buttons': [Button, ...]}

Button shape:
    {
      'custom_id': str,
      'label': str,
      'style': 'primary' | 'secondary' | 'success' | 'danger',
      'group': str,
      'disabled': bool,
    }
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from python.engine.actions import ActionType


MAX_BUTTONS_PER_ROW = 5
MAX_ROWS = 5
MAX_LABEL = 80


# Action type → logical group (for styling + row placement)
_TYPE_TO_GROUP: Dict[ActionType, str] = {
    # Setup
    ActionType.SELECT_MAP: 'setup',
    ActionType.MAP_TYPE_CHOICE: 'setup',
    ActionType.MAP_CONFIRM: 'setup',
    ActionType.MAP_GO_BACK: 'setup',
    ActionType.DRAFT_RANDOM: 'setup',
    ActionType.DETERMINE_INITIATIVE: 'setup',
    ActionType.PICK_ZONE: 'setup',
    ActionType.DEPLOY_FIGURE: 'setup',
    ActionType.DEPLOY_PICK: 'setup',
    ActionType.DEPLOY_ROW: 'setup',
    ActionType.DEPLOY_DONE: 'setup',
    ActionType.CONFIRM_ATTACHMENT: 'setup',
    ActionType.DRAW_CC: 'setup',
    ActionType.SUBMIT_SQUAD: 'setup',
    ActionType.AUTO_DEPLOY: 'setup',
    # Activation
    ActionType.ACTIVATE_DC: 'activation',
    ActionType.END_TURN: 'activation',
    ActionType.DC_END_ACTIVATION: 'activation',
    ActionType.PASS_ACTIVATION_TURN: 'activation',
    ActionType.END_ACTIVATION_PHASE: 'activation',
    # Movement
    ActionType.MOVE_FIGURE: 'movement',
    ActionType.MOVE_PICK_SPACE: 'movement',
    ActionType.MOVE_MP: 'movement',
    ActionType.MOVE_LETTER: 'movement',
    # Combat
    ActionType.ATTACK_TARGET: 'combat',
    ActionType.COMBAT_READY: 'combat',
    ActionType.COMBAT_GATE: 'combat',
    ActionType.COMBAT_ROLL: 'combat',
    ActionType.COMBAT_REROLL: 'combat',
    ActionType.COMBAT_SURGE: 'combat',
    ActionType.COMBAT_SKIP_SURGES: 'combat',
    ActionType.COMBAT_RESOLVE: 'combat',
    ActionType.COMBAT_PASSIVE: 'combat',
    ActionType.COMBAT_TOKEN: 'combat',
    # Special
    ActionType.DC_ACTION: 'special',
    ActionType.SPECIAL_ACTION: 'special',
    ActionType.DC_SPECIAL: 'special',
    ActionType.INTERACT: 'special',
    ActionType.DC_ABILITY_CHOICE: 'special',
    # CC
    ActionType.PLAY_CC: 'cc',
    ActionType.PLAY_CC_SPECIAL: 'cc',
    ActionType.PLAY_CC_DOUBLE: 'cc',
    ActionType.CC_DRAW: 'cc',
    ActionType.CC_CONFIRM_PLAY: 'cc',
    ActionType.CC_CANCEL_PLAY: 'cc',
    ActionType.CC_CHOICE: 'cc',
    ActionType.CC_SPACE: 'cc',
    ActionType.CELEBRATION_PLAY: 'cc',
    ActionType.CELEBRATION_PASS: 'cc',
    ActionType.COMM_DISRUPTION_PLAY: 'cc',
    ActionType.COMM_DISRUPTION_SKIP: 'cc',
    # Phase
    ActionType.PHASE_GATE_READY: 'phase',
    ActionType.PHASE_GATE_UNREADY: 'phase',
    ActionType.END_ROUND_PASS: 'phase',
    ActionType.END_START_OF_ROUND: 'phase',
    ActionType.END_END_OF_ROUND: 'phase',
    # Misc (token / picker / skip)
    ActionType.POWER_TOKEN_CHOICE: 'misc',
    ActionType.PT_OVERFLOW_DISCARD: 'misc',
    ActionType.COVER_FIRE_BLOCK: 'misc',
    ActionType.COVER_FIRE_SKIP: 'misc',
    ActionType.SPREAD_PAIN_COND: 'misc',
    ActionType.ARSENAL_PICK: 'misc',
    ActionType.EE3_PICK_DIE: 'misc',
    ActionType.EE3_PICK_SKIP: 'misc',
    ActionType.BO_RIFLE_USE: 'misc',
    ActionType.BO_RIFLE_SKIP: 'misc',
    ActionType.POUNCE_SPACE: 'misc',
    ActionType.MISSILE_SALVO_DIE: 'misc',
    ActionType.MISSILE_SALVO_DONE: 'misc',
    ActionType.OVERWATCH_SPACE: 'misc',
    ActionType.OB_SPACE: 'misc',
    ActionType.BOMB_DROP_SPACE: 'misc',
    ActionType.RUSH_PUSH_FIG: 'misc',
    ActionType.RUSH_PUSH_SKIP: 'misc',
    ActionType.SHOULDER_RUSH_FIG: 'misc',
    ActionType.SHOULDER_RUSH_SKIP: 'misc',
    ActionType.FALSE_ORDERS_MOVE: 'misc',
    ActionType.FALSE_ORDERS_ATTACK: 'misc',
    ActionType.FALSE_ORDERS_SKIP: 'misc',
    ActionType.STRAIN_CHOICE_ALLDMG: 'misc',
    ActionType.STRAIN_CHOICE_DISCARD: 'misc',
    ActionType.REFRESH_MAP: 'misc',
    ActionType.UNDO: 'misc',
}


# Group → Discord button style (primary/secondary/success/danger)
_GROUP_TO_STYLE: Dict[str, str] = {
    'setup': 'primary',
    'activation': 'success',
    'movement': 'primary',
    'combat': 'danger',
    'special': 'secondary',
    'cc': 'success',
    'phase': 'secondary',
    'misc': 'secondary',
}


_GROUP_ORDER = ['setup', 'activation', 'movement', 'combat', 'special',
                'cc', 'phase', 'misc']


def classify(action_type: ActionType) -> str:
    """Return the layout group for an action type."""
    return _TYPE_TO_GROUP.get(action_type, 'misc')


def style_for(action_type: ActionType) -> str:
    """Return the Discord button style for an action type."""
    return _GROUP_TO_STYLE.get(classify(action_type), 'secondary')


def _truncate_label(label: str) -> str:
    if len(label) <= MAX_LABEL:
        return label
    return label[:MAX_LABEL - 1] + '…'


def build_button(action: Any, label: Optional[str] = None,
                 disabled: bool = False) -> Dict[str, Any]:
    """Build a single button component dict from an Action (or Action-like).

    Expected action shape:
        action.type: ActionType
        action.custom_id: str — pre-built Discord customId
        action.label (optional) or `label` param

    Returns a dict ready for conversion to discord.py's ButtonBuilder.
    """
    action_type = getattr(action, 'type', None)
    custom_id = getattr(action, 'custom_id', None) or getattr(action, 'customId', None)
    if not action_type or not custom_id:
        raise ValueError('build_button: action must have .type and .custom_id / .customId')
    label = label or getattr(action, 'label', None) or str(action_type.value)
    return {
        'custom_id': custom_id,
        'label': _truncate_label(str(label)),
        'style': style_for(action_type),
        'group': classify(action_type),
        'disabled': bool(disabled),
    }


def build_action_rows(actions: List[Any]) -> List[Dict[str, Any]]:
    """Lay out actions into ActionRows, respecting Discord's 5x5 limit.

    Buttons are grouped by classify() group, rows are filled up to
    MAX_BUTTONS_PER_ROW, and total rows are capped at MAX_ROWS.

    Returns a list of ActionRow dicts:
        [{'type': 'action_row', 'buttons': [...]}]

    Overflow (buttons beyond 5×5) is silently dropped — caller should
    paginate beforehand for large action sets.
    """
    if not actions:
        return []
    # Bucket by group, preserving insertion order within each
    by_group: Dict[str, List[Dict[str, Any]]] = {g: [] for g in _GROUP_ORDER}
    for action in actions:
        try:
            btn = build_button(action)
        except ValueError:
            continue
        by_group.setdefault(btn['group'], []).append(btn)

    rows: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []
    for group in _GROUP_ORDER:
        for btn in by_group.get(group, []):
            if len(current) == MAX_BUTTONS_PER_ROW:
                rows.append({'type': 'action_row', 'buttons': current})
                current = []
                if len(rows) >= MAX_ROWS:
                    return rows
            current.append(btn)
        # Row break between groups when the group has any buttons
        if by_group.get(group) and current:
            rows.append({'type': 'action_row', 'buttons': current})
            current = []
            if len(rows) >= MAX_ROWS:
                return rows
    if current and len(rows) < MAX_ROWS:
        rows.append({'type': 'action_row', 'buttons': current})
    return rows[:MAX_ROWS]


def chunk_button_list(buttons: List[Dict[str, Any]],
                      per_row: int = MAX_BUTTONS_PER_ROW,
                      max_rows: int = MAX_ROWS) -> List[Dict[str, Any]]:
    """Helper: chunk a flat button list into ActionRows by count.

    Does NOT regroup by classify() — buttons stay in their input order.
    Used for picker UIs (row picker, target picker) where position matters.
    """
    if not buttons:
        return []
    rows: List[Dict[str, Any]] = []
    for i in range(0, len(buttons), per_row):
        rows.append({'type': 'action_row', 'buttons': buttons[i:i + per_row]})
        if len(rows) >= max_rows:
            break
    return rows[:max_rows]
