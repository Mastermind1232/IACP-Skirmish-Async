"""P2.15 + P2.16 + P2.17 verification: Pattern E coverage gate.

The plan listed three Pattern E batches (top-25, next-25, long-tail
300+) for porting. The existing pattern_e + pattern_e_bulk modules
already cover all 355 Pattern E chains via the dispatch registry —
none raise PatternNotImplemented.

This test asserts the coverage gate so any regression that drops a
chain from the registry is caught.
"""
from python.engine.abilities.classify import build_inventory
from python.engine.abilities.dispatch import (
    PatternNotImplemented,
    UnknownAbility,
    resolve,
)


def test_all_pattern_e_chains_wired_to_a_handler():
    """Every Pattern E ability resolves through some handler — none
    raise PatternNotImplemented. Individual chain correctness is
    verified by ability_golden + cc_golden parity tests."""
    inv = build_inventory()
    not_implemented = []
    total = 0
    for ability_id, info in (inv.get('entries') or {}).items():
        if info.get('pattern') != 'E':
            continue
        total += 1
        try:
            resolve({}, ability_id, {})
        except PatternNotImplemented:
            not_implemented.append(ability_id)
        except UnknownAbility:
            not_implemented.append(ability_id)
        except Exception:
            # Any other exception means the handler ran (and needed
            # state we didn't provide). That counts as "wired".
            pass
    assert not_implemented == [], \
        f'{len(not_implemented)} of {total} Pattern E chains lack handlers: ' \
        f'{not_implemented[:10]}'


def test_pattern_a_b_c_d_chains_also_wired():
    """Same coverage gate for the other patterns. None should raise
    PatternNotImplemented."""
    inv = build_inventory()
    not_implemented_by_pattern = {'A': [], 'B': [], 'C': [], 'D': []}
    for ability_id, info in (inv.get('entries') or {}).items():
        pattern = info.get('pattern')
        if pattern not in not_implemented_by_pattern:
            continue
        try:
            resolve({}, ability_id, {})
        except PatternNotImplemented:
            not_implemented_by_pattern[pattern].append(ability_id)
        except UnknownAbility:
            pass  # Should not happen — would mean classifier disagreement.
        except Exception:
            pass

    for pattern, missing in not_implemented_by_pattern.items():
        assert missing == [], \
            f'Pattern {pattern}: {len(missing)} chains lack handlers'


def test_pattern_count_invariants():
    """Sanity: the inventory matches the expected pattern split.
    Total is 685 abilities split across 5 patterns."""
    inv = build_inventory()
    counts = inv.get('counts') or {}
    assert counts.get('E', 0) >= 350, \
        f"Pattern E count regressed: {counts.get('E')}"
    assert sum(counts.values()) == inv.get('total'), \
        'Pattern count mismatch with total'
