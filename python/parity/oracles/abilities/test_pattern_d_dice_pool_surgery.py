"""D3.12 oracle — Pattern D dice-pool surgery family.

Proves three combat-declare abilities fire real behavior end-to-end:

  Shared primitive (`python/engine/mechanics/dice_pool_surgery.py`):
    - replace_die_in_pool(combat, selector, replacement)
      → first-match findIndex + spread-clone + in-place write-back, 100%
        byte-identical to JS `const dice = attackInfo.dice || []; const idx =
        dice.findIndex(predicate); if (idx >= 0) { const newDice = [...dice];
        newDice[idx] = replacement; combat.attackInfo = { ...attackInfo,
        dice: newDice }; }` at three JS sites (combat.js:1740, 1757, 1845).
    - is_once_per_round_used(game, key) / mark_once_per_round_used(game, key)
      → sticky-flag protocol on `game.roundFigureAbilityUsed[key]` mirroring
        the JS lazy-init (`if (!game.roundFigureAbilityUsed)
        game.roundFigureAbilityUsed = {}`) + ROUND_OBJECT_FLAGS reset pattern.

  Handlers (all delegate to `_dice_pool_replace` with per-ability deltas):
    - handle_shock_and_awe  — once-per-round sticky on
                               `${attackerFigureKey}_shock_and_awe`, replace
                               1 Yellow → Red
    - handle_vanguard       — distance_to_target <= 3 gate, replace 1 non-red
                               → Red (first non-red wins)
    - handle_front_line     — distance_to_target <= 3 gate, replace 1 blue
                               → red

  Per-ability log-line deltas (preserved byte-identically):
    - shock_and_awe: Title-Case "1 Yellow die replaced with Red."
    - vanguard:     interpolated colour, "1 ${color} die replaced with Red
                     (target within ${dist} spaces)."
    - front_line:   all-lowercase, "1 blue die replaced with red (target
                     within ${dist} spaces)."

  Fire-site helper integration:
    - Walks attacker specialAbilityIds; threads ctx verbatim
    - shock_and_awe gates on `game.roundFigureAbilityUsed[key]`
    - vanguard/front_line gate on ctx['distance_to_target']

  Dispatch integration:
    - dispatch.resolve routes each of the 3 IDs
    - lookup_pattern returns 'D'
    - combat_declare_dice_pool_surgery_ids() == ('front_line',
      'shock_and_awe', 'vanguard')
    - combat_declare_real_handler_ids() count = 20
      (6 D3.7 + 5 D3.9 + 3 D3.12 + 6 D3.14)
    - pattern_d_runnable_ids count = 24
      (20 combat-declare + 4 D3.16 combat-defense-friends)
    - pattern_d_stub_ids count = 137 (161 − 24)

  Fail-loud regression:
    - flawless_execution still raises TriggerNotImplemented (remaining 137
      Pattern D stubs preserved)

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d_dice_pool_surgery
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import lookup_pattern, resolve
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    get_handler_for,
    is_stub,
    pattern_d_registered_ids,
    pattern_d_runnable_ids,
    pattern_d_stub_ids,
)
from python.engine.abilities.pattern_d_handlers import (
    combat_declare_dice_pool_surgery_ids,
    combat_declare_real_handler_ids,
    handle_front_line,
    handle_shock_and_awe,
    handle_vanguard,
    install_combat_declare_handlers,
)
from python.engine.mechanics.combat_declare import fire_combat_declare_triggers
from python.engine.mechanics.dice_pool_surgery import (
    is_once_per_round_used,
    mark_once_per_round_used,
    replace_die_in_pool,
)


_DICE_POOL_THREE = ('front_line', 'shock_and_awe', 'vanguard')


# ── Primitive: replace_die_in_pool ──────────────────────────────────────────

def test_replace_die_in_pool_swaps_first_match():
    combat = {'attackInfo': {'dice': ['blue', 'yellow', 'yellow']}}
    out = replace_die_in_pool(combat, lambda c: c == 'yellow', 'red')
    assert out == {'applied': True, 'replaced_color': 'yellow', 'index': 1}
    assert combat['attackInfo']['dice'] == ['blue', 'red', 'yellow']


def test_replace_die_in_pool_no_match_returns_sentinel():
    combat = {'attackInfo': {'dice': ['red', 'red']}}
    out = replace_die_in_pool(combat, lambda c: c == 'yellow', 'red')
    assert out == {'applied': False, 'replaced_color': None, 'index': -1}
    # Pool untouched.
    assert combat['attackInfo']['dice'] == ['red', 'red']


def test_replace_die_in_pool_empty_dice_returns_sentinel():
    combat = {'attackInfo': {'dice': []}}
    out = replace_die_in_pool(combat, lambda c: True, 'red')
    assert out['applied'] is False
    assert out['index'] == -1


def test_replace_die_in_pool_missing_attackinfo_is_defensive():
    # Defensive: no attackInfo at all → treat as empty pool, return sentinel.
    combat = {}
    out = replace_die_in_pool(combat, lambda c: True, 'red')
    assert out['applied'] is False


def test_replace_die_in_pool_missing_dice_key_is_defensive():
    # Defensive: attackInfo present but no 'dice' key → treat as empty pool.
    combat = {'attackInfo': {}}
    out = replace_die_in_pool(combat, lambda c: True, 'red')
    assert out['applied'] is False


def test_replace_die_in_pool_creates_new_attackinfo_dict_on_write():
    # JS writes `combat.attackInfo = { ...attackInfo, dice: newDice }`, so the
    # prior attackInfo reference is NOT mutated in place — consumers holding
    # the old reference see the old pool.
    combat = {'attackInfo': {'dice': ['yellow'], 'other': 'unchanged'}}
    prior_attack_info = combat['attackInfo']
    replace_die_in_pool(combat, lambda c: c == 'yellow', 'red')
    # Current attackInfo is a NEW dict.
    assert combat['attackInfo'] is not prior_attack_info
    # Prior attackInfo still has original pool.
    assert prior_attack_info['dice'] == ['yellow']
    # 'other' key preserved on the new attackInfo via spread.
    assert combat['attackInfo']['other'] == 'unchanged'


def test_replace_die_in_pool_creates_new_dice_list_on_write():
    # JS `[...dice]` spread creates a new array; consumers holding the old
    # dice list must not see the swap.
    combat = {'attackInfo': {'dice': ['yellow', 'blue']}}
    prior_dice = combat['attackInfo']['dice']
    replace_die_in_pool(combat, lambda c: c == 'yellow', 'red')
    assert combat['attackInfo']['dice'] is not prior_dice
    assert prior_dice == ['yellow', 'blue']  # unchanged


def test_replace_die_in_pool_selector_agnostic():
    # Primitive is not hardcoded to yellow-or-red. Future reactive handlers
    # can swap any colour for any colour.
    combat = {'attackInfo': {'dice': ['red', 'blue']}}
    replace_die_in_pool(combat, lambda c: c == 'blue', 'yellow')
    assert combat['attackInfo']['dice'] == ['red', 'yellow']


# ── Primitive: is_once_per_round_used / mark_once_per_round_used ───────────

def test_is_once_per_round_used_missing_map_returns_false():
    assert is_once_per_round_used({}, 'anything') is False


def test_is_once_per_round_used_empty_map_returns_false():
    assert is_once_per_round_used({'roundFigureAbilityUsed': {}}, 'anything') is False


def test_is_once_per_round_used_absent_key_returns_false():
    game = {'roundFigureAbilityUsed': {'other_key': True}}
    assert is_once_per_round_used(game, 'missing') is False


def test_is_once_per_round_used_present_and_true_returns_true():
    game = {'roundFigureAbilityUsed': {'k': True}}
    assert is_once_per_round_used(game, 'k') is True


def test_mark_once_per_round_used_sets_flag_from_empty():
    game = {}
    mark_once_per_round_used(game, 'k1')
    assert game['roundFigureAbilityUsed'] == {'k1': True}


def test_mark_once_per_round_used_preserves_dict_identity():
    # ROUND_OBJECT_FLAGS reset pattern (D2.29 / activation-state.js) clears
    # the dict by reassignment to `{}`; if the mark primitive re-created the
    # dict on every call, it would break identity invariants.
    existing = {'prior_key': True}
    game = {'roundFigureAbilityUsed': existing}
    mark_once_per_round_used(game, 'new_key')
    assert game['roundFigureAbilityUsed'] is existing
    assert existing == {'prior_key': True, 'new_key': True}


def test_mark_then_is_used_returns_true():
    game = {}
    mark_once_per_round_used(game, 'k')
    assert is_once_per_round_used(game, 'k') is True


# ── Handler: shock_and_awe (once-per-round + yellow) ────────────────────────

def test_shock_and_awe_swaps_first_yellow_for_red():
    game = {}
    combat = {'attackInfo': {'dice': ['blue', 'yellow', 'yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0'}
    out = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['blue', 'red', 'yellow']
    assert out['replaced_color'] == 'yellow'
    assert out['index'] == 1


def test_shock_and_awe_log_line_is_title_case():
    # JS line 1753: "1 Yellow die replaced with Red." — Title-Case preserved.
    game = {}
    combat = {'attackInfo': {'dice': ['yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0'}
    out = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert out['log_message'] == '**Shock and Awe** — 1 Yellow die replaced with Red.'


def test_shock_and_awe_writes_sticky_flag_on_success():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0'}
    handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert game['roundFigureAbilityUsed'] == {'CaraDune-1-0_shock_and_awe': True}


def test_shock_and_awe_gates_on_second_fire_same_round():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow', 'yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0'}
    first = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert first['applied'] is True
    # Pool now has one yellow left; second fire must gate on sticky-flag, NOT
    # consume the remaining yellow.
    second = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert second['applied'] is False
    assert second['gated_by'] == 'once-per-round'
    assert combat['attackInfo']['dice'] == ['red', 'yellow']


def test_shock_and_awe_no_yellow_does_not_write_sticky_flag():
    # If there's no yellow to swap, JS's `if (idx >= 0)` block never runs, so
    # the sticky flag should also NOT be written — the ability didn't fire.
    game = {}
    combat = {'attackInfo': {'dice': ['red', 'blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0'}
    out = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-matching-die'
    # Sticky flag NOT written.
    assert 'roundFigureAbilityUsed' not in game or not game.get('roundFigureAbilityUsed')


def test_shock_and_awe_per_figure_sticky_key():
    # Two Cara Dunes in the same game gate independently — the sticky key
    # includes `attackerFigureKey`, per JS line 1741.
    game = {}
    combat_a = {'attackInfo': {'dice': ['yellow']}}
    combat_b = {'attackInfo': {'dice': ['yellow']}}
    handle_shock_and_awe(game, 'shock_and_awe',
                         {'combat': combat_a, 'attacker_figure_key': 'CaraDune-1-0'})
    handle_shock_and_awe(game, 'shock_and_awe',
                         {'combat': combat_b, 'attacker_figure_key': 'CaraDune-1-1'})
    assert combat_a['attackInfo']['dice'] == ['red']
    assert combat_b['attackInfo']['dice'] == ['red']
    assert game['roundFigureAbilityUsed'] == {
        'CaraDune-1-0_shock_and_awe': True,
        'CaraDune-1-1_shock_and_awe': True,
    }


def test_shock_and_awe_has_no_distance_gate():
    # JS combat.js:1740-1755 has no distance guard; Cara Dune fires it at
    # any range.
    game = {}
    combat = {'attackInfo': {'dice': ['yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'CaraDune-1-0',
           'distance_to_target': 99}
    out = handle_shock_and_awe(game, 'shock_and_awe', ctx)
    assert out['applied'] is True


# ── Handler: vanguard (distance ≤3 + non-red) ───────────────────────────────

def test_vanguard_swaps_first_non_red_at_distance_1():
    game = {}
    combat = {'attackInfo': {'dice': ['red', 'blue', 'yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 1}
    out = handle_vanguard(game, 'vanguard', ctx)
    assert out['applied'] is True
    # First non-red (blue at index 1) is the one replaced.
    assert combat['attackInfo']['dice'] == ['red', 'red', 'yellow']
    assert out['replaced_color'] == 'blue'
    assert out['index'] == 1


def test_vanguard_takes_first_non_red_yellow_wins_over_later_blue():
    # Proves selector uses findIndex order (first match), not a colour
    # priority list. If yellow comes before blue, yellow is replaced.
    game = {}
    combat = {'attackInfo': {'dice': ['red', 'yellow', 'blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 1}
    handle_vanguard(game, 'vanguard', ctx)
    assert combat['attackInfo']['dice'] == ['red', 'red', 'blue']


def test_vanguard_fires_at_exact_distance_3():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 3}
    out = handle_vanguard(game, 'vanguard', ctx)
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['red']


def test_vanguard_skips_at_distance_4():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 4}
    out = handle_vanguard(game, 'vanguard', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance>3'
    # Pool untouched.
    assert combat['attackInfo']['dice'] == ['blue']


def test_vanguard_no_non_red_dies_returns_no_matching():
    game = {}
    combat = {'attackInfo': {'dice': ['red', 'red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 1}
    out = handle_vanguard(game, 'vanguard', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-matching-die'


def test_vanguard_log_line_interpolates_color_and_distance():
    game = {}
    combat = {'attackInfo': {'dice': ['green']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 2}
    out = handle_vanguard(game, 'vanguard', ctx)
    assert out['log_message'] == (
        '**Vanguard** — 1 green die replaced with Red (target within 2 spaces).'
    )


def test_vanguard_has_no_once_per_round_gate():
    # JS combat.js:1757-1767 — no `roundFigureAbilityUsed` guard.
    game = {}
    combat = {'attackInfo': {'dice': ['blue', 'yellow']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
           'distance_to_target': 1}
    first = handle_vanguard(game, 'vanguard', ctx)
    second = handle_vanguard(game, 'vanguard', ctx)
    assert first['applied'] is True
    assert second['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'red']


# ── Handler: front_line (distance ≤3 + blue) ────────────────────────────────

def test_front_line_swaps_blue_for_red_at_distance_1():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow', 'blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 1}
    out = handle_front_line(game, 'front_line', ctx)
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['yellow', 'red']


def test_front_line_fires_at_exact_distance_3():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 3}
    out = handle_front_line(game, 'front_line', ctx)
    assert out['applied'] is True


def test_front_line_skips_at_distance_4():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 4}
    out = handle_front_line(game, 'front_line', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance>3'


def test_front_line_skips_when_no_blue_in_pool():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow', 'red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 1}
    out = handle_front_line(game, 'front_line', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-matching-die'


def test_front_line_log_line_is_all_lowercase():
    # JS combat.js:1855 — `1 blue die replaced with red` (lowercase "red",
    # lowercase "blue"). Distinct from shock_and_awe's Title-Case and
    # vanguard's interpolated colour.
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 2}
    out = handle_front_line(game, 'front_line', ctx)
    assert out['log_message'] == (
        '**Front Line** — 1 blue die replaced with red (target within 2 spaces).'
    )


def test_front_line_has_no_once_per_round_gate():
    game = {}
    combat = {'attackInfo': {'dice': ['blue', 'blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
           'distance_to_target': 1}
    first = handle_front_line(game, 'front_line', ctx)
    second = handle_front_line(game, 'front_line', ctx)
    assert first['applied'] is True
    assert second['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'red']


# ── Dispatch integration ───────────────────────────────────────────────────

def test_dispatch_resolve_routes_shock_and_awe():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow']}}
    out = resolve(game, 'shock_and_awe', {
        'combat': combat, 'attacker_figure_key': 'CaraDune-1-0',
    })
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['red']


def test_dispatch_resolve_routes_vanguard():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    out = resolve(game, 'vanguard', {
        'combat': combat, 'attacker_figure_key': 'ATRT-1-0',
        'distance_to_target': 2,
    })
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['red']


def test_dispatch_resolve_routes_front_line():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    out = resolve(game, 'front_line', {
        'combat': combat, 'attacker_figure_key': 'EchoBase-1-0',
        'distance_to_target': 1,
    })
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['red']


def test_lookup_pattern_returns_D_for_each_of_three():
    for aid in _DICE_POOL_THREE:
        assert lookup_pattern(aid) == 'D', f'{aid} should be Pattern D'


def test_none_of_three_is_a_stub():
    for aid in _DICE_POOL_THREE:
        info = get_handler_for(aid)
        assert info is not None, f'{aid} must be registered'
        trigger, handler = info
        assert trigger == 'combat-declare', f'{aid} must be on combat-declare'
        assert not is_stub(handler), f'{aid} should no longer be a stub'


# ── Fire-site helper integration ───────────────────────────────────────────

def test_fire_site_helper_fires_shock_and_awe():
    game = {}
    combat = {'attackInfo': {'dice': ['yellow', 'blue']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['shock_and_awe'],
        attacker_figure_key='CaraDune-1-0',
        ctx={},
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'blue']
    assert game['roundFigureAbilityUsed'] == {'CaraDune-1-0_shock_and_awe': True}


def test_fire_site_helper_shock_and_awe_gates_second_fire():
    # Consecutive attacks in the same round: first fires, second gates on
    # sticky-flag (not on a new findIndex miss).
    game = {}
    combat_1 = {'attackInfo': {'dice': ['yellow']}}
    fire_combat_declare_triggers(
        game, combat_1,
        attacker_special_ids=['shock_and_awe'],
        attacker_figure_key='CaraDune-1-0',
        ctx={},
    )
    combat_2 = {'attackInfo': {'dice': ['yellow']}}
    out2 = fire_combat_declare_triggers(
        game, combat_2,
        attacker_special_ids=['shock_and_awe'],
        attacker_figure_key='CaraDune-1-0',
        ctx={},
    )
    assert out2[0]['applied'] is False
    assert out2[0]['gated_by'] == 'once-per-round'
    assert combat_2['attackInfo']['dice'] == ['yellow']  # untouched


def test_fire_site_helper_distance_gate_skips_vanguard_when_far():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['vanguard'],
        attacker_figure_key='ATRT-1-0',
        ctx={'distance_to_target': 5},
    )
    assert out[0]['applied'] is False
    assert out[0]['gated_by'] == 'distance>3'
    assert combat['attackInfo']['dice'] == ['blue']


def test_fire_site_helper_mixes_dice_pool_surgery_with_focus_green():
    # Attacker carries battle_meditation (appends green die) AND vanguard
    # (replaces a non-red with red). Order matters — battle_meditation fires
    # first (index 0) and appends 'green' at end; vanguard then walks the
    # pool and replaces the first non-red, which should be 'blue' at index 0.
    game = {}
    combat = {'attackInfo': {'dice': ['blue', 'red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['battle_meditation', 'vanguard'],
        attacker_figure_key='Dc-1-0',
        ctx={'distance_to_target': 1},
    )
    assert [r['ability_id'] for r in out] == ['battle_meditation', 'vanguard']
    # battle_meditation: ['blue', 'red'] → ['blue', 'red', 'green']
    # vanguard: replaces first non-red (blue at 0) → ['red', 'red', 'green']
    assert combat['attackInfo']['dice'] == ['red', 'red', 'green']


# ── Introspection helpers ──────────────────────────────────────────────────

def test_combat_declare_dice_pool_surgery_ids_returns_three():
    assert combat_declare_dice_pool_surgery_ids() == _DICE_POOL_THREE


def test_combat_declare_real_handler_ids_total_count_is_twenty():
    assert len(combat_declare_real_handler_ids()) == 20


def test_combat_declare_real_handler_ids_includes_all_three_dice_pool():
    real = set(combat_declare_real_handler_ids())
    for aid in _DICE_POOL_THREE:
        assert aid in real, f'{aid} must be in real handler set'


# ── Pattern D bus state (post-D3.12) ───────────────────────────────────────

def test_pattern_d_runnable_ids_includes_all_three_dice_pool():
    runnable = set(pattern_d_runnable_ids())
    for aid in _DICE_POOL_THREE:
        assert aid in runnable, f'{aid} must be runnable in Pattern D bus'


def test_pattern_d_runnable_count_is_twenty_four_after_d3_16():
    # D3.7+D3.9+D3.12+D3.14 = 20 combat-declare real; D3.16 lands 4 more
    # (combat-defense-friends: sentinel, protector, keep_the_peace_elite,
    # keep_the_peace_regular) → 24 runnable.
    assert len(pattern_d_runnable_ids()) == 24


def test_pattern_d_stub_count_is_137_after_d3_16():
    # D3.6 baseline 161 stubs. D3.7 landed 6 → 155. D3.9 landed 5 → 150.
    # D3.12 lands 3 → 147. D3.14 lands 6 (combat-declare defender-side
    # second pass) → 141. D3.16 lands 4 (combat-defense-friends) → 137.
    assert len(pattern_d_stub_ids()) == 137
    assert len(pattern_d_registered_ids()) == 161


# ── Library pins ──────────────────────────────────────────────────────────

def test_dice_pool_surgery_ids_all_classify_as_combat_declare():
    from python.engine.data.ability_library_loader import get_ability
    for aid in _DICE_POOL_THREE:
        entry = get_ability(aid)
        assert entry is not None, f'{aid} must be in library'
        assert entry.get('type') == 'dcSpecial', f'{aid} must be dcSpecial'
        assert entry.get('trigger') == 'combat-declare', (
            f'{aid} must have trigger=combat-declare'
        )


def test_shock_and_awe_has_once_per_round_marker_in_library():
    # Library metadata parity: only shock_and_awe carries oncePer='round';
    # vanguard and front_line do not (their gate is distance, not once-per).
    from python.engine.data.ability_library_loader import get_ability
    assert get_ability('shock_and_awe').get('oncePer') == 'round'
    assert get_ability('vanguard').get('oncePer') is None
    assert get_ability('front_line').get('oncePer') is None


# ── Fail-loud regression: remaining 137 stubs still raise ──────────────────

def test_flawless_execution_still_raises_TriggerNotImplemented_via_dispatch():
    # flawless_execution remains the canonical still-stubbed combat-declare
    # ability (needs pendingPowerTokenGrant plumbing). Proves the 137
    # remaining Pattern D stubs are still fail-loud after D3.16.
    try:
        resolve({}, 'flawless_execution', {})
    except TriggerNotImplemented as e:
        assert e.ability_id == 'flawless_execution'
        return
    assert False, 'flawless_execution must still raise TriggerNotImplemented'


# ── Runner ─────────────────────────────────────────────────────────────────

def main():
    # Reset bus state so we begin from the post-D3.12 install for every run.
    dispatch.install_default_handlers()

    tests = [v for k, v in sorted(globals().items())
             if k.startswith('test_') and callable(v)]
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
