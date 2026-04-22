"""Unit tests for D2.26 pure-engine strain application.

Exercises `apply_strain_to_figure`: the Fireproof gate + reduce_hp delegation
+ defeat signal propagation.

Handler-dependent strain branches deferred to D3/D4 are explicitly NOT covered:
  - pendingStrainChoice (HP vs CC-discard prompt)
  - Headhunter reduce-by-1 + opponent CC discard
  - Under Duress opponent-controlled choice
  - Submit or Fight (Paz Vizsla) heal-from-discard

Run as: python3 -m python.parity.oracles.combat.test_apply_strain
"""
import sys

from python.engine.mechanics.strain import apply_strain_to_figure


def test_amount_zero_is_noop():
    health = {'msg1': [[5, 8]]}
    r = apply_strain_to_figure(health, {}, 'msg1', 0, 'Trooper-1-0', 1, 0)
    assert r == {'fireproof': False, 'applied': 0, 'prevHp': 0, 'newHp': 0, 'defeated': False}
    assert health['msg1'] == [[5, 8]]


def test_negative_amount_is_noop():
    health = {'msg1': [[5, 8]]}
    r = apply_strain_to_figure(health, {}, 'msg1', 0, 'T-1-0', 1, -3)
    assert r['applied'] == 0
    assert health['msg1'] == [[5, 8]]


def test_missing_msg_id_is_noop():
    r = apply_strain_to_figure({}, {}, '', 0, 'T-1-0', 1, 2)
    assert r['applied'] == 0


def test_missing_figure_key_is_noop():
    health = {'msg1': [[5, 8]]}
    r = apply_strain_to_figure(health, {}, 'msg1', 0, None, 1, 2)
    assert r['applied'] == 0
    assert health['msg1'] == [[5, 8]]


def test_simple_strain_reduces_hp():
    health = {'msg1': [[5, 8]]}
    game = {}
    r = apply_strain_to_figure(health, game, 'msg1', 0, 'T-1-0', 1, 2)
    assert r['fireproof'] is False
    assert r['applied'] == 2
    assert r['prevHp'] == 5
    assert r['newHp'] == 3
    assert r['defeated'] is False
    assert health['msg1'] == [[3, 8]]


def test_strain_to_zero_sets_defeated_flag():
    health = {'msg1': [[2, 8]]}
    r = apply_strain_to_figure(health, {}, 'msg1', 0, 'T-1-0', 1, 5)
    assert r['newHp'] == 0
    assert r['defeated'] is True
    assert r['applied'] == 2  # clamped to prev HP


def test_fireproof_p1_attachment_blocks_strain():
    health = {'msg1': [[5, 8]]}
    game = {
        'p1DcAttachments': {'msg1': ['Flame Trooper']},
    }
    r = apply_strain_to_figure(health, game, 'msg1', 0, 'T-1-0', 1, 3)
    assert r['fireproof'] is True
    assert r['applied'] == 0
    assert health['msg1'] == [[5, 8]]


def test_fireproof_p2_attachment_also_blocks_strain():
    """Fireproof check unions both players' DcAttachments maps."""
    health = {'msg1': [[5, 8]]}
    game = {
        'p2DcAttachments': {'msg1': ['Flame Trooper']},
    }
    r = apply_strain_to_figure(health, game, 'msg1', 0, 'T-1-0', 1, 3)
    assert r['fireproof'] is True
    assert health['msg1'] == [[5, 8]]


def test_fireproof_survives_bracket_wrapping():
    """Fireproof lookup is bracket-agnostic via card_name_includes."""
    health = {'msg1': [[5, 8]]}
    game = {
        'p1DcAttachments': {'msg1': ['[Flame Trooper]']},
    }
    r = apply_strain_to_figure(health, game, 'msg1', 0, 'T-1-0', 1, 3)
    assert r['fireproof'] is True


def test_strain_without_fireproof_ignored_on_other_msg_id():
    """Fireproof attachment on a DIFFERENT msgId does not protect our target."""
    health = {'msgTarget': [[5, 8]], 'msgOther': [[5, 8]]}
    game = {
        'p1DcAttachments': {'msgOther': ['Flame Trooper']},
    }
    r = apply_strain_to_figure(health, game, 'msgTarget', 0, 'T-1-0', 1, 3)
    assert r['fireproof'] is False
    assert r['applied'] == 3


ALL_TESTS = [
    test_amount_zero_is_noop,
    test_negative_amount_is_noop,
    test_missing_msg_id_is_noop,
    test_missing_figure_key_is_noop,
    test_simple_strain_reduces_hp,
    test_strain_to_zero_sets_defeated_flag,
    test_fireproof_p1_attachment_blocks_strain,
    test_fireproof_p2_attachment_also_blocks_strain,
    test_fireproof_survives_bracket_wrapping,
    test_strain_without_fireproof_ignored_on_other_msg_id,
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
