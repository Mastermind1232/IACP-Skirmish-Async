"""Snapshot-oracle pytest for Pattern E abilities.

Every Pattern E dcSpecial has a frozen post-state snapshot under
`_pattern_e_snapshots/`. This test runs each ability through the
Python schema handler on the minimal fixture and asserts the
post-state matches the frozen snapshot. Catches any regression that
changes behavior for any ability.

Regenerate snapshots after an intentional change:
    python3 -m python.parity.ability_snapshot
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.parity.ability_snapshot import (
    SNAP_DIR,
    _apply,
    _list_pattern_e,
)


_ABILITY_IDS = _list_pattern_e()


@pytest.mark.parametrize('ability_id', _ABILITY_IDS)
def test_pattern_e_snapshot_matches(ability_id: str) -> None:
    """Post-state after applying `ability_id` matches its frozen snapshot."""
    snap_path = Path(SNAP_DIR) / f'{ability_id}.json'
    assert snap_path.exists(), (
        f'missing snapshot for {ability_id} — run '
        f'`python3 -m python.parity.ability_snapshot` to regenerate'
    )
    expected = json.loads(snap_path.read_text())
    actual = _apply(ability_id)
    assert actual == expected, (
        f'{ability_id}: post-state diverges from snapshot. If intentional, '
        f'regenerate via `python3 -m python.parity.ability_snapshot`.'
    )


def test_all_pattern_e_have_snapshots() -> None:
    """Every Pattern E ability has a snapshot file."""
    for aid in _ABILITY_IDS:
        path = Path(SNAP_DIR) / f'{aid}.json'
        assert path.exists(), f'missing snapshot file: {path}'


def test_no_orphan_snapshots() -> None:
    """Snapshot dir contains no entries for non-existent abilities."""
    known = set(_ABILITY_IDS)
    for path in Path(SNAP_DIR).glob('*.json'):
        aid = path.stem
        assert aid in known, (
            f'orphan snapshot {path.name} — ability no longer exists or '
            f'no longer classified as Pattern E; delete this file'
        )
