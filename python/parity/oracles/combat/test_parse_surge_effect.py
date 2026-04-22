"""Unit + port tests for parse_surge_effect (D2.20).

Covers named-shortcut early returns, double: prefix stripping, parenthetical
annotation removal, comma-split accumulation, numeric patterns, conditions
ordering, cancel-N fallback, and the surge-legality 003b parity check.

Run as: python3 -m python.parity.oracles.combat.test_parse_surge_effect
"""
import sys

from python.engine.mechanics.surge import parse_surge_effect


# ── Numeric patterns ────────────────────────────────────────────────────────

def test_damage_n_accumulates():
    e = parse_surge_effect('damage 2')
    assert e['damage'] == 2
    assert e['pierce'] == 0
    assert e['accuracy'] == 0
    assert e['conditions'] == []


def test_hit_alias_increments_damage():
    e = parse_surge_effect('+3 hits')
    assert e['damage'] == 3


def test_pierce_n():
    e = parse_surge_effect('pierce 2')
    assert e['pierce'] == 2
    assert e['damage'] == 0


def test_accuracy_signed():
    e = parse_surge_effect('accuracy -1')
    assert e['accuracy'] == -1


def test_blast_n_and_recover_cleave():
    e1 = parse_surge_effect('blast 2')
    e2 = parse_surge_effect('recover 1')
    e3 = parse_surge_effect('cleave 3')
    assert e1['blast'] == 2
    assert e2['recover'] == 1
    assert e3['cleave'] == 3


# ── Double: prefix stripping (surge-legality 003b) ──────────────────────────

def test_003b_double_prefix_strips_and_parses():
    e = parse_surge_effect('double:pierce 2')
    assert e['pierce'] == 2, 'double:pierce 2 should parse as pierce=2'
    assert e['damage'] == 0, 'no damage from pierce surge'
    assert e['conditions'] == [], 'no conditions from pierce surge'


def test_double_plus3_hits_is_damage_3():
    e = parse_surge_effect('double:+3 hits')
    assert e['damage'] == 3


# ── Parenthetical annotations stripped ───────────────────────────────────────

def test_parenthetical_ignored():
    e = parse_surge_effect('damage 2 (bonus)')
    assert e['damage'] == 2


# ── Named-shortcut early returns ────────────────────────────────────────────

def test_stun_net_shortcut():
    e = parse_surge_effect('stun_net')
    assert e['conditions'] == ['Stun']


def test_deadly_spin_shortcut():
    e = parse_surge_effect('deadly_spin')
    assert e.get('surgeCancelDodge') is True
    assert e['cleave'] == 3


def test_deadly_shortcut():
    e = parse_surge_effect('deadly')
    assert e.get('surgeCancelDodge') is True
    assert e.get('cleave', 0) == 0


def test_shocking_palm_shortcut():
    e = parse_surge_effect('shocking_palm')
    assert e.get('replaceWithStun') is True


def test_shrapnel_shortcut():
    e = parse_surge_effect('shrapnel')
    assert e['blast'] == 2


def test_critical_hit_shortcut():
    e = parse_surge_effect('critical_hit')
    assert e['pierce'] == 2
    assert e.get('surgeCriticalHit') is True


def test_hit_token_shortcut():
    e = parse_surge_effect('hit token')
    assert e.get('surgeGrantHitToken') == 1


def test_hit_token_2_shortcut():
    e = parse_surge_effect('hit token 2')
    assert e.get('surgeGrantHitToken') == 2


def test_evade_token_shortcut():
    e = parse_surge_effect('evade token')
    assert e.get('surgeGrantEvade') == 1


def test_block_1_shortcut():
    e = parse_surge_effect('block 1')
    assert e.get('surgeAttackerBlock') == 1


def test_surge_1_shortcut():
    e = parse_surge_effect('surge 1')
    assert e.get('surgeGrantExtraSurge') == 1


def test_fighting_knife_and_concussive_bolt():
    a = parse_surge_effect('fighting_knife')
    b = parse_surge_effect('concussive_bolt')
    assert a.get('surgeFightingKnife') is True
    assert b.get('surgeConcussiveBolt') is True


def test_cancel_n_shortcut():
    e = parse_surge_effect('cancel 2')
    assert e.get('surgeCancel') == 2


def test_complex_cleave_x_deferred():
    e = parse_surge_effect('cleave x')
    assert e.get('surgeComplex') == 'cleave x'


# ── Comma-split accumulation + conditions ordering ──────────────────────────

def test_comma_damage_plus_stun():
    e = parse_surge_effect('damage 1, stun')
    assert e['damage'] == 1
    assert e['conditions'] == ['Stun']


def test_comma_multi_conditions_preserve_order():
    e = parse_surge_effect('stun, bleed, weaken')
    assert e['conditions'] == ['Stun', 'Bleed', 'Weaken']


def test_comma_pierce_plus_bleed():
    e = parse_surge_effect('pierce 1, bleed')
    assert e['pierce'] == 1
    assert e['conditions'] == ['Bleed']


def test_comma_blast_plus_recover():
    e = parse_surge_effect('blast 2, recover 1')
    assert e['blast'] == 2
    assert e['recover'] == 1


def test_comma_split_accumulates_across_parts():
    e = parse_surge_effect('damage 1, damage 2')
    assert e['damage'] == 3


# ── String-match parts in comma-split chain ─────────────────────────────────

def test_focus_part_sets_flag():
    e = parse_surge_effect('focus')
    assert e.get('surgeSelfFocus') is True


def test_hide_part_sets_flag():
    e = parse_surge_effect('hide')
    assert e.get('surgeSelfHide') is True


def test_gain_n_part_sets_vp():
    e = parse_surge_effect('gain 2')
    assert e.get('surgeVpGain') == 2


# ── Unknown keys return defaults, do not raise ──────────────────────────────

def test_unknown_key_returns_defaults():
    e = parse_surge_effect('xyz_mystery_key')
    assert e['damage'] == 0
    assert e['pierce'] == 0
    assert e['accuracy'] == 0
    assert e['conditions'] == []


def test_empty_key_returns_defaults():
    e = parse_surge_effect('')
    assert e['damage'] == 0
    assert e['conditions'] == []


def test_none_key_returns_defaults():
    e = parse_surge_effect(None)
    assert e['damage'] == 0


ALL_TESTS = [
    test_damage_n_accumulates,
    test_hit_alias_increments_damage,
    test_pierce_n,
    test_accuracy_signed,
    test_blast_n_and_recover_cleave,
    test_003b_double_prefix_strips_and_parses,
    test_double_plus3_hits_is_damage_3,
    test_parenthetical_ignored,
    test_stun_net_shortcut,
    test_deadly_spin_shortcut,
    test_deadly_shortcut,
    test_shocking_palm_shortcut,
    test_shrapnel_shortcut,
    test_critical_hit_shortcut,
    test_hit_token_shortcut,
    test_hit_token_2_shortcut,
    test_evade_token_shortcut,
    test_block_1_shortcut,
    test_surge_1_shortcut,
    test_fighting_knife_and_concussive_bolt,
    test_cancel_n_shortcut,
    test_complex_cleave_x_deferred,
    test_comma_damage_plus_stun,
    test_comma_multi_conditions_preserve_order,
    test_comma_pierce_plus_bleed,
    test_comma_blast_plus_recover,
    test_comma_split_accumulates_across_parts,
    test_focus_part_sets_flag,
    test_hide_part_sets_flag,
    test_gain_n_part_sets_vp,
    test_unknown_key_returns_defaults,
    test_empty_key_returns_defaults,
    test_none_key_returns_defaults,
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
