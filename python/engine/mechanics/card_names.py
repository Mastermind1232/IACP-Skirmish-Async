"""Card-name helpers — bracket-agnostic comparison.

Byte-identical port of `src/game/card-names.js`. Attachments and upgrades
can be stored either as "Heroic Effort" or "[Heroic Effort]" depending on
the path; these helpers normalize away the brackets so callers don't care.
"""
from __future__ import annotations

from typing import Any, Sequence


def strip_brackets(name: Any) -> Any:
    """Strip a single layer of square brackets from a card name string.

    Returns the input unchanged for non-string values. Mirrors JS
    `card-names.js:stripBrackets`.
    """
    if not isinstance(name, str):
        return name
    if name.startswith('[') and name.endswith(']'):
        return name[1:-1]
    return name


def card_name_equals(a: Any, b: Any) -> bool:
    """Compare two card names, ignoring bracket wrappers."""
    return strip_brackets(a) == strip_brackets(b)


def card_name_includes(arr: Any, name: str) -> bool:
    """Check if `arr` contains `name`, ignoring bracket wrappers.

    Returns False when `arr` is not a list/tuple. Mirrors JS
    `Array.isArray` early-return.
    """
    if not isinstance(arr, (list, tuple)):
        return False
    bare = strip_brackets(name)
    return any(strip_brackets(entry) == bare for entry in arr)
