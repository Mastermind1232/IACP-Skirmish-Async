"""Snapshot-oracle pytest for all 293 command cards.

Regenerate after intentional changes:
    python3 -m python.parity.cc_snapshot
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.parity.cc_snapshot import SNAP_DIR, _apply, _list_cards


_CARDS = _list_cards()


def _safe(name: str) -> str:
    return (name.replace('/', '_').replace("'", '_')
            .replace(':', '_').replace(' ', '_').replace('!', ''))


@pytest.mark.parametrize('card', _CARDS)
def test_cc_snapshot_matches(card: str) -> None:
    """Post-state after resolving `card` matches its frozen snapshot."""
    path = Path(SNAP_DIR) / f'{_safe(card)}.json'
    assert path.exists(), (
        f'missing snapshot for {card!r} — run '
        f'`python3 -m python.parity.cc_snapshot` to regenerate'
    )
    expected = json.loads(path.read_text())
    actual = _apply(card)
    assert actual == expected, (
        f'{card}: CC post-state diverges from snapshot.'
    )


def test_all_cards_have_snapshots() -> None:
    for name in _CARDS:
        path = Path(SNAP_DIR) / f'{_safe(name)}.json'
        assert path.exists(), f'missing {path}'
