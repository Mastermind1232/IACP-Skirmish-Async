"""D3.1 oracle — ability-library classification.

Verifies every ability in `data/ability-library.json` lands in exactly one of
A/B/C/D/E, the counts match the frozen inventory (55/51/63/161/355, total 685),
and the decision tree handles each representative case.

Run as: python3 -m python.parity.oracles.abilities.test_classification
"""
import sys

from python.engine.abilities.classify import (
    ClassificationFailure,
    build_inventory,
    classify_ability,
    load_inventory,
)
from python.engine.data.ability_library_loader import get_ability, get_ability_library


# ── Structural shape ────────────────────────────────────────────────────────

def test_total_685():
    lib = get_ability_library()
    assert len(lib) == 685, f'expected 685 abilities, got {len(lib)}'


def test_counts_match_frozen_inventory():
    inv = build_inventory()
    assert inv['total'] == 685
    assert inv['counts'] == {'A': 55, 'B': 51, 'C': 63, 'D': 161, 'E': 355}, inv['counts']


def test_all_abilities_classified():
    lib = get_ability_library()
    for ab_id, entry in lib.items():
        pattern, reason = classify_ability(ab_id, entry)
        assert pattern in ('A', 'B', 'C', 'D', 'E'), f'{ab_id}: bad pattern {pattern}'
        assert reason and isinstance(reason, str), f'{ab_id}: empty reason'


def test_every_id_lands_in_exactly_one_pattern():
    inv = build_inventory()
    total = sum(inv['counts'].values())
    assert total == inv['total'] == 685
    patterns_per_id = {ab_id: info['pattern'] for ab_id, info in inv['entries'].items()}
    assert len(patterns_per_id) == 685


def test_persisted_inventory_matches_fresh_build():
    persisted = load_inventory()
    fresh = build_inventory()
    assert persisted['counts'] == fresh['counts'], (persisted['counts'], fresh['counts'])
    assert persisted['total'] == fresh['total']


# ── Decision-tree spot checks ───────────────────────────────────────────────

def test_surge_type_is_B():
    lib = get_ability_library()
    surge_ids = [aid for aid, e in lib.items() if e.get('type') == 'surge']
    assert len(surge_ids) == 51, f'expected 51 surge, got {len(surge_ids)}'
    for sid in surge_ids[:10]:
        p, r = classify_ability(sid, lib[sid])
        assert p == 'B', f'{sid}: expected B, got {p} ({r})'


def test_dcPassive_is_C():
    lib = get_ability_library()
    pass_ids = [aid for aid, e in lib.items() if e.get('type') == 'dcPassive']
    for pid in pass_ids:
        p, r = classify_ability(pid, lib[pid])
        assert p == 'C', f'{pid}: expected C, got {p} ({r})'


def test_dcSpecial_passive_no_trigger_is_C():
    lib = get_ability_library()
    hits = [(aid, e) for aid, e in lib.items()
            if e.get('type') == 'dcSpecial'
            and e.get('category') in ('passive', 'passive-auto')
            and not e.get('trigger')]
    assert hits, 'expected at least some dcSpecial passive abilities'
    for aid, entry in hits[:10]:
        p, r = classify_ability(aid, entry)
        assert p == 'C', f'{aid}: expected C, got {p} ({r})'


def test_dcSpecial_triggered_is_D():
    lib = get_ability_library()
    hits = [(aid, e) for aid, e in lib.items()
            if e.get('type') == 'dcSpecial' and e.get('trigger')]
    assert hits, 'expected triggered dcSpecial abilities'
    for aid, entry in hits[:10]:
        p, r = classify_ability(aid, entry)
        assert p == 'D', f'{aid}: expected D, got {p} ({r})'


def test_dcSpecial_active_no_trigger_is_E():
    lib = get_ability_library()
    hits = [(aid, e) for aid, e in lib.items()
            if e.get('type') == 'dcSpecial'
            and not e.get('trigger')
            and e.get('category') not in ('passive', 'passive-auto')]
    assert hits
    for aid, entry in hits[:10]:
        p, r = classify_ability(aid, entry)
        assert p == 'E', f'{aid}: expected E, got {p} ({r})'


def test_ccEffect_chain_marker_forces_E():
    p, _ = classify_ability('Force Push', get_ability('Force Push'))
    assert p == 'E'


def test_ccEffect_pure_delta_is_A():
    entry = get_ability('Focus')
    assert entry is not None
    p, r = classify_ability('Focus', entry)
    assert p == 'A', f'Focus: expected A, got {p} ({r})'


def test_unknown_type_raises():
    try:
        classify_ability('bad', {'type': 'zzz-unknown'})
    except ClassificationFailure:
        return
    assert False, 'expected ClassificationFailure on unknown type'


def test_missing_type_raises():
    try:
        classify_ability('bad', {})
    except ClassificationFailure:
        return
    assert False, 'expected ClassificationFailure on missing type'


# ── Pattern A field hygiene ─────────────────────────────────────────────────

def test_pattern_A_entries_have_no_chain_fields():
    from python.engine.abilities.classify import _CHAIN_FIELDS, _is_chain_field
    inv = build_inventory()
    a_ids = [aid for aid, info in inv['entries'].items() if info['pattern'] == 'A']
    for aid in a_ids:
        entry = get_ability(aid)
        for f in entry.keys():
            assert not _is_chain_field(f), f'{aid}: Pattern A has chain field {f!r}'


def test_pattern_A_entries_only_allowlist_fields():
    from python.engine.abilities.classify import _PATTERN_A_FIELDS
    inv = build_inventory()
    a_ids = [aid for aid, info in inv['entries'].items() if info['pattern'] == 'A']
    assert len(a_ids) == 55
    for aid in a_ids:
        entry = get_ability(aid)
        stray = [f for f in entry.keys() if f not in _PATTERN_A_FIELDS]
        assert not stray, f'{aid}: Pattern A with non-allowlist fields {stray}'


# ── Runner ──────────────────────────────────────────────────────────────────

def main():
    tests = [v for k, v in globals().items() if k.startswith('test_') and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            passed += 1
            print(f'PASS {t.__name__}')
        except AssertionError as e:
            print(f'FAIL {t.__name__}: {e}')
            sys.exit(1)
        except Exception as e:
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
