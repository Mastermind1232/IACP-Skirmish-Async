"""Discord embed / button builder helpers.

Mirrors src/discord/components.js core helpers. Returns plain data
structures (dataclass / dict) that the bot wraps with discord.py
ButtonBuilder / EmbedBuilder at send-time. Keeping this layer
discord.py-free means handler tests can verify component shape
without importing discord.py.

Public API:
  - truncate_label(s, max=80)
  - get_button_style(area) → ButtonStyle string
  - chunk_buttons_to_rows(buttons, max_per_row=5) → List[ActionRow]
  - Button(custom_id, label, style)
  - SelectOption(label, value, description=None)
  - SelectMenu(custom_id, placeholder, options)
  - ActionRow(components)
  - Embed(title=None, description=None, color=None, fields=None)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


MAX_BUTTONS_PER_ROW = 5
MAX_ROWS_PER_MESSAGE = 5
MAX_LABEL_LENGTH = 80


# ---------------------------------------------------------------------------
# Component dataclasses


@dataclass
class Button:
    """Discord button component shape. Maps to discord.ui.Button at send."""
    custom_id: str
    label: str
    style: str = 'Secondary'
    disabled: bool = False
    emoji: Optional[str] = None
    url: Optional[str] = None  # link buttons


@dataclass
class SelectOption:
    label: str
    value: str
    description: Optional[str] = None
    emoji: Optional[str] = None
    default: bool = False


@dataclass
class SelectMenu:
    """Discord select-menu component shape."""
    custom_id: str
    placeholder: str = ''
    options: List[SelectOption] = field(default_factory=list)
    min_values: int = 1
    max_values: int = 1
    disabled: bool = False


@dataclass
class ActionRow:
    """Discord ActionRow shape (max 5 buttons or 1 select per row)."""
    components: List[Any]  # Button | SelectMenu


@dataclass
class EmbedField:
    name: str
    value: str
    inline: bool = False


@dataclass
class Embed:
    """Discord embed shape."""
    title: Optional[str] = None
    description: Optional[str] = None
    color: Optional[int] = None
    fields: List[EmbedField] = field(default_factory=list)
    image_url: Optional[str] = None
    footer: Optional[str] = None
    thumbnail_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers


def truncate_label(s: Any, max: int = MAX_LABEL_LENGTH) -> str:
    """Truncate `s` to `max` chars, appending '…' when shortened.

    Mirrors JS truncateLabel byte-for-byte. Discord enforces 80-char
    label limit; truncation uses an ellipsis character (U+2026).
    """
    if s is None:
        return ''
    text = str(s)
    if len(text) <= max:
        return text
    return text[: max - 1] + '…'


# Area → ButtonStyle mapping. Mirrors JS getButtonStyle.
_BUTTON_STYLE_MAP: Dict[str, str] = {
    'attack':       'Danger',
    'destructive':  'Danger',
    'confirm':      'Success',
    'setup':        'Success',
    'cancel':       'Secondary',
    'movement':     'Secondary',
    'interact':     'Secondary',
    'surge':        'Secondary',
    'primary':      'Primary',
    'secondary':    'Secondary',
}


def get_button_style(area: str) -> str:
    """Map a semantic 'area' name to a Discord ButtonStyle.

    Returns 'Secondary' as the default for unknown areas.
    """
    return _BUTTON_STYLE_MAP.get(area, 'Secondary')


def chunk_buttons_to_rows(buttons: List[Button],
                          max_per_row: int = MAX_BUTTONS_PER_ROW,
                          ) -> List[ActionRow]:
    """Pack buttons into ActionRows of at most `max_per_row` (capped at
    5) buttons per row, with at most 5 rows per message.

    Mirrors JS chunkButtonsToRows. Drops overflow buttons silently
    (matches JS behavior — Discord rejects messages with > 25 buttons).
    """
    capped = min(max_per_row, MAX_BUTTONS_PER_ROW)
    rows: List[ActionRow] = []
    for r in range(0, len(buttons), capped):
        if len(rows) >= MAX_ROWS_PER_MESSAGE:
            break
        chunk = buttons[r: r + capped]
        rows.append(ActionRow(components=list(chunk)))
    return rows


def confirm_cancel_row(confirm_id: str, cancel_id: str,
                       confirm_label: str = 'Confirm',
                       cancel_label: str = 'Cancel',
                       ) -> ActionRow:
    """Build a 2-button confirm/cancel row. Common pattern across
    activation, attack, deploy flows."""
    return ActionRow(components=[
        Button(custom_id=confirm_id, label=confirm_label,
               style=get_button_style('confirm')),
        Button(custom_id=cancel_id, label=cancel_label,
               style=get_button_style('cancel')),
    ])
