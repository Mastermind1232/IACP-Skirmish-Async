"""Unit tests for the D2.22 reroll window helpers.

Exercises grant_round_attack_reroll / get_round_attack_rerolls_available /
clear_round_attack_rerolls for additive grants, per-player independence, and
ROUND_OBJECT_FLAGS-style reset semantics.

Run as: python3 -m python.parity.oracles.combat.test_reroll_window
"""
import sys

from python.engine.mechanics.combat import (
    grant_round_attack_reroll,
    get_round_attack_rerolls_available,
    clear_round_attack_rerolls,
)


def test_initial_state_is_zero():
    d = {}
    assert get_round_attack_rerolls_available(d, 1) == 0
    assert get_round_attack_rerolls_available(d, 2) == 0


def test_grant_default_one():
    d = {}
    grant_round_attack_reroll(d, 1)
    assert get_round_attack_rerolls_available(d, 1) == 1


def test_grant_additive():
    d = {}
    grant_round_attack_reroll(d, 1, 2)
    grant_round_attack_reroll(d, 1, 1)
    assert get_round_attack_rerolls_available(d, 1) == 3


def test_grant_per_player_independent():
    d = {}
    grant_round_attack_reroll(d, 1, 2)
    grant_round_attack_reroll(d, 2, 5)
    assert get_round_attack_rerolls_available(d, 1) == 2
    assert get_round_attack_rerolls_available(d, 2) == 5


def test_clear_resets_all_players():
    d = {}
    grant_round_attack_reroll(d, 1, 3)
    grant_round_attack_reroll(d, 2, 2)
    clear_round_attack_rerolls(d)
    assert get_round_attack_rerolls_available(d, 1) == 0
    assert get_round_attack_rerolls_available(d, 2) == 0
    assert d == {}, 'clear should leave the dict empty (same identity, no keys)'


def test_clear_preserves_dict_identity():
    d = {}
    d_id = id(d)
    grant_round_attack_reroll(d, 1, 4)
    clear_round_attack_rerolls(d)
    assert id(d) == d_id, 'clear_round_attack_rerolls must not rebind; GameState holds this dict'


def test_grant_custom_amount_zero_is_noop():
    d = {}
    grant_round_attack_reroll(d, 1, 0)
    assert get_round_attack_rerolls_available(d, 1) == 0


ALL_TESTS = [
    test_initial_state_is_zero,
    test_grant_default_one,
    test_grant_additive,
    test_grant_per_player_independent,
    test_clear_resets_all_players,
    test_clear_preserves_dict_identity,
    test_grant_custom_amount_zero_is_noop,
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
