"""Snapshot-oracle pytest for Pattern D abilities.

Mirrors the Pattern E snapshot suite: every Pattern D ability has a
frozen post-state snapshot; this pytest re-applies the handler on
the fixture and diffs.

Regenerate after intentional changes:
    python3 -m python.parity.pattern_d_snapshot
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from python.parity.pattern_d_snapshot import (
    SNAP_DIR,
    _apply,
    _list_pattern_d,
)


_ABILITY_IDS = _list_pattern_d()


@pytest.mark.parametrize('ability_id', _ABILITY_IDS)
def test_pattern_d_snapshot_matches(ability_id: str) -> None:
    """Post-state after firing trigger handler matches frozen snapshot."""
    snap_path = Path(SNAP_DIR) / f'{ability_id}.json'
    assert snap_path.exists(), (
        f'missing snapshot for {ability_id} — run '
        f'`python3 -m python.parity.pattern_d_snapshot` to regenerate'
    )
    expected = json.loads(snap_path.read_text())
    actual = _apply(ability_id)
    assert actual == expected, (
        f'{ability_id}: Pattern D post-state diverges from snapshot.'
    )


def test_all_pattern_d_have_snapshots() -> None:
    for aid in _ABILITY_IDS:
        path = Path(SNAP_DIR) / f'{aid}.json'
        assert path.exists(), f'missing {path}'


def test_no_orphan_d_snapshots() -> None:
    known = set(_ABILITY_IDS)
    for path in Path(SNAP_DIR).glob('*.json'):
        aid = path.stem
        assert aid in known, f'orphan Pattern D snapshot {path.name}'


def test_no_stubs_raise_trigger_not_implemented() -> None:
    """Every snapshot should reflect a real handler run (no
    TriggerNotImplemented errors). If this fails, a real ability
    regressed to a stub."""
    bad = []
    for aid in _ABILITY_IDS:
        snap = json.loads((Path(SNAP_DIR) / f'{aid}.json').read_text())
        err = snap.get('error') or ''
        if 'TriggerNotImplemented' in err:
            bad.append(aid)
    assert not bad, f'{len(bad)} abilities still stubs: {bad[:10]}'
