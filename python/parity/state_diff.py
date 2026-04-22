"""Deep semantic diff of two GameState objects.

Used by the replay harness and oracle tests to pinpoint where Python and JS
diverge. The diff is structural and strict: exact equality, no float tolerance
(game state has no true-float fields at this layer — HP, VP, damage are ints).

Public API:
    state_diff(a, b) -> List[Diff]     # empty list == states match
    format_diff(diffs) -> str          # human-readable multi-line report
"""
from dataclasses import dataclass
from typing import Any, List, Optional, Union


@dataclass
class Diff:
    path: str                  # dotted/bracketed path, e.g. "figureHp.1.e0"
    kind: str                  # "missing_left" | "missing_right" | "value" | "type"
    left: Any = None
    right: Any = None

    def __str__(self) -> str:
        if self.kind == 'missing_left':
            return f'  + {self.path} = {self.right!r}  (only in right)'
        if self.kind == 'missing_right':
            return f'  - {self.path} = {self.left!r}  (only in left)'
        if self.kind == 'type':
            return f'  ~ {self.path}: {type(self.left).__name__} != {type(self.right).__name__}'
        return f'  ~ {self.path}: {self.left!r} != {self.right!r}'


def state_diff(left, right, path: str = '') -> List[Diff]:
    """Return a list of Diff entries describing every mismatch.

    Both `left` and `right` may be a GameState, a dict, a list, or a primitive.
    Missing key on either side is a diff. JS-undefined vs Python-None vs key
    absence are treated as the same (all mean "missing"); `null` in JSON loads
    to Python None and that *is* present-with-None — caller decides whether to
    normalize before diffing.
    """
    left_data = _unwrap(left)
    right_data = _unwrap(right)
    return _walk(left_data, right_data, path)


def _unwrap(x):
    data_attr = getattr(x, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    return x


def _walk(a, b, path: str) -> List[Diff]:
    if type(a) is not type(b):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return [] if a == b else [Diff(path, 'value', a, b)]
        return [Diff(path, 'type', a, b)]
    if isinstance(a, dict):
        return _walk_dict(a, b, path)
    if isinstance(a, list):
        return _walk_list(a, b, path)
    return [] if a == b else [Diff(path, 'value', a, b)]


def _walk_dict(a: dict, b: dict, path: str) -> List[Diff]:
    diffs: List[Diff] = []
    for k in sorted(set(a.keys()) | set(b.keys())):
        sub = f'{path}.{k}' if path else k
        if k not in a:
            diffs.append(Diff(sub, 'missing_left', right=b[k]))
        elif k not in b:
            diffs.append(Diff(sub, 'missing_right', left=a[k]))
        else:
            diffs.extend(_walk(a[k], b[k], sub))
    return diffs


def _walk_list(a: list, b: list, path: str) -> List[Diff]:
    diffs: List[Diff] = []
    for i in range(max(len(a), len(b))):
        sub = f'{path}[{i}]'
        if i >= len(a):
            diffs.append(Diff(sub, 'missing_left', right=b[i]))
        elif i >= len(b):
            diffs.append(Diff(sub, 'missing_right', left=a[i]))
        else:
            diffs.extend(_walk(a[i], b[i], sub))
    return diffs


def format_diff(diffs: List[Diff]) -> str:
    if not diffs:
        return '(no diffs)'
    return '\n'.join(str(d) for d in diffs)
