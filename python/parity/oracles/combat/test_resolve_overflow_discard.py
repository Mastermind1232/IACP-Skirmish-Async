"""Port of pure-engine portions of tests/domain/oracle/combat-token-behavioral.test.js (D6.8b).

Ports the B-C-OVERFLOW and B-C-PEND2 tests that exercise grant_power_tokens +
resolve_overflow_discard WITHOUT any Discord handler dependency. The rest of
combat-token-behavioral.test.js (B-C-TOKEN-001..011, B-C-OVERFLOW-004..007,
B-C-PEND2-001/002/004/005/006, B-C-COMBINED-001/002/003) exercises
handleCombatToken / handlePowerTokenChoice / handlePowerTokenOverflowDiscard /
resumeSurgeChoiceOrResolve — all Discord-handler-driven, deferred to D3/D4.

Run as: python3 -m python.parity.oracles.combat.test_resolve_overflow_discard
"""
import sys

from python.engine.mechanics.tokens import grant_power_tokens, resolve_overflow_discard


# ── B-C-OVERFLOW-001: grant_power_tokens queues overflow when exceeding cap ─

def test_overflow_001_grant_queues_overflow_when_exceeding_cap():
    game = {'figurePowerTokens': {'Trooper-1-0': ['Damage', 'Block']}}
    grant_power_tokens(game, 'Trooper-1-0', 'Surge', 1)
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 3
    assert game['pendingPowerTokenOverflow'] is not None
    assert game['pendingPowerTokenOverflow'][0]['figureKey'] == 'Trooper-1-0'
    assert game['pendingPowerTokenOverflow'][0]['discardCount'] == 1


# ── B-C-OVERFLOW-002: resolve_overflow_discard removes token, decrements ────

def test_overflow_002_resolve_removes_token_and_decrements():
    game = {
        'figurePowerTokens': {'Trooper-1-0': ['Damage', 'Block', 'Surge']},
        'pendingPowerTokenOverflow': [{'figureKey': 'Trooper-1-0', 'discardCount': 1}],
    }
    r = resolve_overflow_discard(game, 'Trooper-1-0', 0)
    assert r['discarded'] == 'Damage'
    assert r['remaining'] == 0
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 2
    assert game['pendingPowerTokenOverflow'] is None


# ── B-C-OVERFLOW-003: multi-discard needs multiple resolves ─────────────────

def test_overflow_003_multi_discard_needs_multiple_resolves():
    game = {
        'figurePowerTokens': {'Trooper-1-0': ['Damage', 'Block', 'Surge', 'Evade']},
        'pendingPowerTokenOverflow': [{'figureKey': 'Trooper-1-0', 'discardCount': 2}],
    }
    r1 = resolve_overflow_discard(game, 'Trooper-1-0', 0)
    assert r1['remaining'] == 1
    assert game['pendingPowerTokenOverflow'] is not None

    r2 = resolve_overflow_discard(game, 'Trooper-1-0', 0)
    assert r2['remaining'] == 0
    assert game['pendingPowerTokenOverflow'] is None
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 2


# ── B-C-PEND2-003: overflow fully resolved clears to None (not empty list) ─

def test_pend2_003_overflow_cleared_to_none_not_empty_list():
    game = {
        'figurePowerTokens': {'Trooper-1-0': ['Damage', 'Block', 'Surge']},
        'pendingPowerTokenOverflow': [{'figureKey': 'Trooper-1-0', 'discardCount': 1}],
    }
    resolve_overflow_discard(game, 'Trooper-1-0', 2)  # discard Surge
    assert game['pendingPowerTokenOverflow'] is None
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 2


# ── B-C-COMBINED-004: full grant → overflow → resolve flow maintains state ─

def test_combined_004_full_grant_overflow_resolve_flow():
    game = {'figurePowerTokens': {'Trooper-1-0': ['Damage', 'Block']}}
    # Step 1: grant triggers overflow
    grant_power_tokens(game, 'Trooper-1-0', 'Surge', 1)
    assert game['pendingPowerTokenOverflow'] is not None
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 3

    # Step 2: resolve overflow
    r = resolve_overflow_discard(game, 'Trooper-1-0', 0)
    assert r['discarded'] == 'Damage'
    assert r['remaining'] == 0
    assert game['pendingPowerTokenOverflow'] is None
    assert len(game['figurePowerTokens']['Trooper-1-0']) == 2


# ── Additional: out-of-range index returns None and doesn't mutate ─────────

def test_out_of_range_index_is_noop():
    game = {
        'figurePowerTokens': {'T-0-0': ['Damage']},
        'pendingPowerTokenOverflow': [{'figureKey': 'T-0-0', 'discardCount': 1}],
    }
    r = resolve_overflow_discard(game, 'T-0-0', 5)
    assert r['discarded'] is None
    assert r['remaining'] == 0
    assert game['figurePowerTokens']['T-0-0'] == ['Damage']


def test_unknown_figure_key_is_noop():
    game = {}
    r = resolve_overflow_discard(game, 'Ghost-0-0', 0)
    assert r['discarded'] is None
    assert r['remaining'] == 0


ALL_TESTS = [
    test_overflow_001_grant_queues_overflow_when_exceeding_cap,
    test_overflow_002_resolve_removes_token_and_decrements,
    test_overflow_003_multi_discard_needs_multiple_resolves,
    test_pend2_003_overflow_cleared_to_none_not_empty_list,
    test_combined_004_full_grant_overflow_resolve_flow,
    test_out_of_range_index_is_noop,
    test_unknown_figure_key_is_noop,
]


def _main() -> int:
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
            print(f'PASS  {t.__name__}')
        except AssertionError as e:
            failures += 1
            print(f'FAIL  {t.__name__}: {e}')
        except Exception as e:
            failures += 1
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
    total = len(ALL_TESTS)
    print(f'\n{total - failures}/{total} passed')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(_main())
