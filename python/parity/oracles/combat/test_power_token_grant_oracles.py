"""Port of tests/domain/oracle/power-token-grant-oracles.test.js — behavioral subset (D6.8b).

Ports B-PTGRANT-001..005 — grant-then-overflow semantics for grant_power_tokens.

Structural ORACLE-PTGRANT-001..003 (which grep src/handlers/*.js and
src/game/game-helpers.js for JS migration patterns) are NOT portable.

Run as: python3 -m python.parity.oracles.combat.test_power_token_grant_oracles
"""
import sys

from python.engine.mechanics.tokens import grant_power_tokens


# ── B-PTGRANT-001: Normal grant below cap produces no overflow ─────────────

def test_001_normal_grant_below_cap_no_overflow():
    game = {'figurePowerTokens': {'Riot Trooper (Elite)-1-0': ['Damage']}}
    grant_power_tokens(game, 'Riot Trooper (Elite)-1-0', 'Block', 1)
    assert game['figurePowerTokens']['Riot Trooper (Elite)-1-0'] == ['Damage', 'Block']
    assert game.get('pendingPowerTokenOverflow') is None


# ── B-PTGRANT-002: Grant at cap triggers overflow (activation site) ─────────

def test_002_grant_at_cap_queues_overflow():
    game = {'figurePowerTokens': {'Riot Trooper (Elite)-1-0': ['Damage', 'Surge']}}
    grant_power_tokens(game, 'Riot Trooper (Elite)-1-0', 'Block', 1)
    # Token granted first (grant-then-overflow)
    assert len(game['figurePowerTokens']['Riot Trooper (Elite)-1-0']) == 3
    assert 'Block' in game['figurePowerTokens']['Riot Trooper (Elite)-1-0']
    # Overflow queued
    assert game['pendingPowerTokenOverflow'] is not None
    assert game['pendingPowerTokenOverflow'][0]['figureKey'] == 'Riot Trooper (Elite)-1-0'
    assert game['pendingPowerTokenOverflow'][0]['discardCount'] == 1


# ── B-PTGRANT-003: Non-activation site at cap (Deference Protocol pattern) ─

def test_003_deference_protocol_grant_at_cap_queues_overflow():
    game = {'figurePowerTokens': {'Royal Guard-1-0': ['Block', 'Block']}}
    grant_power_tokens(game, 'Royal Guard-1-0', 'Block', 1)
    assert len(game['figurePowerTokens']['Royal Guard-1-0']) == 3
    assert game['pendingPowerTokenOverflow'] is not None
    assert game['pendingPowerTokenOverflow'][0]['discardCount'] == 1


# ── B-PTGRANT-004: Multi-token grant at cap ─────────────────────────────────

def test_004_multi_token_grant_queues_correct_overflow_count():
    game = {'figurePowerTokens': {'Baze Malbus-1-0': ['Damage']}}
    grant_power_tokens(game, 'Baze Malbus-1-0', 'Block', 3)
    assert len(game['figurePowerTokens']['Baze Malbus-1-0']) == 4
    assert game['pendingPowerTokenOverflow'] is not None
    assert game['pendingPowerTokenOverflow'][0]['discardCount'] == 2


# ── B-PTGRANT-005: Self-play auto-discards overflow (no pending) ───────────

def test_005_selfplay_auto_discards_oldest():
    game = {
        'selfPlay': True,
        'figurePowerTokens': {'K-2SO-1-0': ['Damage', 'Block']},
    }
    grant_power_tokens(game, 'K-2SO-1-0', 'Surge', 1)
    # Auto-discard oldest (Damage) — stays at cap
    assert len(game['figurePowerTokens']['K-2SO-1-0']) == 2
    assert 'Surge' in game['figurePowerTokens']['K-2SO-1-0']
    assert 'Damage' not in game['figurePowerTokens']['K-2SO-1-0']
    assert game.get('pendingPowerTokenOverflow') is None


# ── Additional: testPvpOverflowPath forces PvP queue even in selfPlay ──────

def test_selfplay_with_test_pvp_flag_queues_instead_of_auto_discarding():
    game = {
        'selfPlay': True,
        'testPvpOverflowPath': True,
        'figurePowerTokens': {'K-2SO-1-0': ['Damage', 'Block']},
    }
    grant_power_tokens(game, 'K-2SO-1-0', 'Surge', 1)
    assert len(game['figurePowerTokens']['K-2SO-1-0']) == 3
    assert game['pendingPowerTokenOverflow'] is not None


# ── Additional: existing queue entry is OVERWRITTEN not added to ───────────

def test_existing_overflow_entry_gets_overwritten_not_additive():
    game = {'figurePowerTokens': {'T-0-0': ['Damage', 'Block']}}
    grant_power_tokens(game, 'T-0-0', 'Surge', 1)
    # Now queued with discardCount=1
    assert game['pendingPowerTokenOverflow'][0]['discardCount'] == 1
    # Second grant bumps overflow but overwrites existing entry
    grant_power_tokens(game, 'T-0-0', 'Evade', 1)
    # 4 tokens - cap 2 = 2; entry overwritten to 2 (not additive 1+2)
    assert len(game['figurePowerTokens']['T-0-0']) == 4
    entries = [e for e in game['pendingPowerTokenOverflow'] if e['figureKey'] == 'T-0-0']
    assert len(entries) == 1
    assert entries[0]['discardCount'] == 2


ALL_TESTS = [
    test_001_normal_grant_below_cap_no_overflow,
    test_002_grant_at_cap_queues_overflow,
    test_003_deference_protocol_grant_at_cap_queues_overflow,
    test_004_multi_token_grant_queues_correct_overflow_count,
    test_005_selfplay_auto_discards_oldest,
    test_selfplay_with_test_pvp_flag_queues_instead_of_auto_discarding,
    test_existing_overflow_entry_gets_overwritten_not_additive,
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
