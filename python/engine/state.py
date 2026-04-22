"""Canonical game-state representation + deterministic JSON.

A GameState is a thin wrapper around a dict. The authoritative schema is
`_field_inventory.txt` (411 fields, 11 categories). JS JSON semantics:
missing = undefined = omitted, distinct from `null`. This module preserves
that distinction so a JS->Python->JSON round trip is byte-identical.

Serialization rules (must match the JS dump helper):
- Keys sorted ascending (matches json.dumps(sort_keys=True)).
- No extra whitespace between separators.
- NaN/Infinity disallowed; floats use Python's default repr.
- Enum values serialize by their `.value` (string).
"""
import json
from typing import Any, Dict


class GameState:
    def __init__(self, data: Dict[str, Any] = None):
        self.data: Dict[str, Any] = dict(data) if data else {}

    def to_json(self) -> str:
        return json.dumps(self.data, sort_keys=True, separators=(',', ':'),
                          allow_nan=False, default=_json_default)

    @classmethod
    def from_json(cls, s: str) -> 'GameState':
        return cls(json.loads(s))

    def __eq__(self, other: object) -> bool:
        return isinstance(other, GameState) and self.data == other.data

    def __contains__(self, key: str) -> bool:
        return key in self.data

    def __getitem__(self, key: str) -> Any:
        return self.data[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.data[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def copy(self) -> 'GameState':
        return GameState(dict(self.data))


def _json_default(o: Any) -> Any:
    if hasattr(o, 'value'):
        return o.value
    raise TypeError(f'not JSON serializable: {type(o).__name__}')
