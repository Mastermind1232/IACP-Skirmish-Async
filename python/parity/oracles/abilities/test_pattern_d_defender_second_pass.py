"""D3.14 oracle — Pattern D defender-side second pass (combat-declare).

Proves six combat-declare abilities fire real behavior end-to-end:

  Attacker-side fire (atkSpecialIds), reads defender-side ctx:
    - handle_exploit_weakness  → +1 Surge if defender has Bleed/Stun/Weaken
    - handle_conclusion        → −1 Evade unconditional (attacker-side mutation)

  Defender-side fire (defSpecialIds), mutates combat dict:
    - handle_disposable        → −1 Evade unconditional
    - handle_cortosis_weave    → −2 Pierce unconditional
    - handle_gamorrean_honor_guard → +1 Block if is_ranged
    - handle_composite_plating → +1 Block if distance_to_target >= 4

  Primitive:
    - _defender_has_harmful_condition walks game.figureConditions[defender_key]
      and returns True iff any element is in HARMFUL_CONDITIONS tuple
      (Stun, Bleed, Weaken).

  Fire-site integration (D3.14 additions to fire_combat_declare_triggers):
    - New `defender_special_ids` kwarg — when supplied, the helper runs a
      second walk over the defender's specialAbilityIds after the attacker
      walk completes. Each walk uses the same classifier + dispatch path;
      ordering is attacker-first then defender.

  Regression pins:
    - combat_declare_real_handler_ids() count = 20 (6 + 5 + 3 + 6)
    - pattern_d_runnable_ids() count = 24
      (20 combat-declare + 4 D3.16 combat-defense-friends)
    - pattern_d_stub_ids() count = 137 (161 − 24)
    - remaining 137 Pattern D abilities still raise TriggerNotImplemented

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d_defender_second_pass
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import lookup_pattern, resolve
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    get_handler_for,
    is_stub,
    pattern_d_runnable_ids,
    pattern_d_stub_ids,
)
from python.engine.abilities.pattern_d_handlers import (
    _defender_has_harmful_condition,
    combat_declare_defender_second_pass_ids,
    combat_declare_real_handler_ids,
    handle_composite_plating,
    handle_conclusion,
    handle_cortosis_weave,
    handle_disposable,
    handle_exploit_weakness,
    handle_gamorrean_honor_guard,
)
from python.engine.mechanics.combat_declare import fire_combat_declare_triggers
from python.engine.mechanics.conditions import HARMFUL_CONDITIONS


_D3_14_SIX = (
    'composite_plating',
    'conclusion',
    'cortosis_weave',
    'disposable',
    'exploit_weakness',
    'gamorrean_honor_guard',
)


def _combat(dice=None):
    """Minimal pendingCombat dict; dice default matches Relentless oracle."""
    return {'attackInfo': {'dice': list(dice) if dice else ['red']}}


# ── HARMFUL_CONDITIONS tuple pin ───────────────────────────────────────────

def test_harmful_conditions_contains_stun_bleed_weaken():
    assert 'Stun' in HARMFUL_CONDITIONS
    assert 'Bleed' in HARMFUL_CONDITIONS
    assert 'Weaken' in HARMFUL_CONDITIONS


def test_harmful_conditions_excludes_focus_and_hide():
    assert 'Focus' not in HARMFUL_CONDITIONS
    assert 'Hide' not in HARMFUL_CONDITIONS


# ── _defender_has_harmful_condition primitive ──────────────────────────────

def test_harmful_primitive_true_for_bleed():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is True


def test_harmful_primitive_true_for_stun():
    game = {'figureConditions': {'Rebel-1-0': ['Stun']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is True


def test_harmful_primitive_true_for_weaken():
    game = {'figureConditions': {'Rebel-1-0': ['Weaken']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is True


def test_harmful_primitive_true_when_mixed_with_focus():
    game = {'figureConditions': {'Rebel-1-0': ['Focus', 'Bleed']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is True


def test_harmful_primitive_false_when_only_focus():
    game = {'figureConditions': {'Rebel-1-0': ['Focus']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is False


def test_harmful_primitive_false_when_only_hide():
    game = {'figureConditions': {'Rebel-1-0': ['Hide']}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is False


def test_harmful_primitive_false_when_empty_list():
    game = {'figureConditions': {'Rebel-1-0': []}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is False


def test_harmful_primitive_false_when_key_missing():
    game = {'figureConditions': {}}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is False


def test_harmful_primitive_false_when_no_figure_conditions_map():
    game = {}
    assert _defender_has_harmful_condition(game, 'Rebel-1-0') is False


def test_harmful_primitive_false_when_game_none():
    assert _defender_has_harmful_condition(None, 'Rebel-1-0') is False


# ── Handler: exploit_weakness (attacker-side fires, defender-side reads) ───

def test_exploit_weakness_fires_when_defender_has_bleed():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is True
    assert '**Exploit Weakness**' in out['log_message']
    assert combat['surgeBonus'] == 1


def test_exploit_weakness_fires_when_defender_has_stun():
    game = {'figureConditions': {'Rebel-1-0': ['Stun']}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is True
    assert combat['surgeBonus'] == 1


def test_exploit_weakness_fires_when_defender_has_weaken():
    game = {'figureConditions': {'Rebel-1-0': ['Weaken']}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is True
    assert combat['surgeBonus'] == 1


def test_exploit_weakness_skips_when_defender_has_only_focus():
    game = {'figureConditions': {'Rebel-1-0': ['Focus']}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-harmful-condition'
    assert 'surgeBonus' not in combat


def test_exploit_weakness_skips_when_defender_has_no_conditions():
    game = {'figureConditions': {'Rebel-1-0': []}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-harmful-condition'


def test_exploit_weakness_skips_when_defender_figure_key_missing():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'missing-defender'
    assert 'surgeBonus' not in combat


def test_exploit_weakness_additive_on_existing_surge_bonus():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    combat = _combat()
    combat['surgeBonus'] = 2
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    handle_exploit_weakness(game, 'exploit_weakness', ctx)
    assert combat['surgeBonus'] == 3


# ── Handler: conclusion (attacker-side, unconditional) ─────────────────────

def test_conclusion_fires_unconditionally():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_conclusion(game, 'conclusion', ctx)
    assert out['applied'] is True
    assert '**Conclusion**' in out['log_message']
    assert combat['bonusEvade'] == -1


def test_conclusion_additive_on_existing_bonus_evade():
    game = {}
    combat = _combat()
    combat['bonusEvade'] = -1
    ctx = {'combat': combat}
    handle_conclusion(game, 'conclusion', ctx)
    assert combat['bonusEvade'] == -2


# ── Handler: disposable (defender-side, unconditional) ─────────────────────

def test_disposable_fires_unconditionally():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_disposable(game, 'disposable', ctx)
    assert out['applied'] is True
    assert '**Disposable**' in out['log_message']
    assert combat['bonusEvade'] == -1


def test_disposable_additive_on_existing_bonus_evade():
    game = {}
    combat = _combat()
    combat['bonusEvade'] = -2
    ctx = {'combat': combat}
    handle_disposable(game, 'disposable', ctx)
    assert combat['bonusEvade'] == -3


# ── Handler: cortosis_weave (defender-side, unconditional) ─────────────────

def test_cortosis_weave_fires_unconditionally():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_cortosis_weave(game, 'cortosis_weave', ctx)
    assert out['applied'] is True
    assert '**Cortosis Weave**' in out['log_message']
    assert combat['bonusPierce'] == -2


def test_cortosis_weave_additive_on_existing_bonus_pierce():
    game = {}
    combat = _combat()
    combat['bonusPierce'] = -1
    ctx = {'combat': combat}
    handle_cortosis_weave(game, 'cortosis_weave', ctx)
    assert combat['bonusPierce'] == -3


# ── Handler: gamorrean_honor_guard (is_ranged gate) ────────────────────────

def test_gamorrean_honor_guard_fires_when_is_ranged_true():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'is_ranged': True}
    out = handle_gamorrean_honor_guard(game, 'gamorrean_honor_guard', ctx)
    assert out['applied'] is True
    assert '**Gamorrean Honor Guard**' in out['log_message']
    assert combat['bonusBlock'] == 1


def test_gamorrean_honor_guard_skips_when_is_ranged_false():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'is_ranged': False}
    out = handle_gamorrean_honor_guard(game, 'gamorrean_honor_guard', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'not-ranged'
    assert 'bonusBlock' not in combat


def test_gamorrean_honor_guard_skips_when_is_ranged_missing():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_gamorrean_honor_guard(game, 'gamorrean_honor_guard', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'not-ranged'


def test_gamorrean_honor_guard_additive_on_existing_bonus_block():
    game = {}
    combat = _combat()
    combat['bonusBlock'] = 2
    ctx = {'combat': combat, 'is_ranged': True}
    handle_gamorrean_honor_guard(game, 'gamorrean_honor_guard', ctx)
    assert combat['bonusBlock'] == 3


# ── Handler: composite_plating (distance >= 4 gate) ────────────────────────

def test_composite_plating_fires_at_exact_threshold():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'distance_to_target': 4}
    out = handle_composite_plating(game, 'composite_plating', ctx)
    assert out['applied'] is True
    assert '**Composite Plating**' in out['log_message']
    assert '4 spaces away' in out['log_message']
    assert combat['bonusBlock'] == 1


def test_composite_plating_fires_above_threshold():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'distance_to_target': 10}
    out = handle_composite_plating(game, 'composite_plating', ctx)
    assert out['applied'] is True
    assert '10 spaces away' in out['log_message']
    assert combat['bonusBlock'] == 1


def test_composite_plating_skips_just_below_threshold():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'distance_to_target': 3}
    out = handle_composite_plating(game, 'composite_plating', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance<4'
    assert 'bonusBlock' not in combat


def test_composite_plating_skips_when_distance_zero():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'distance_to_target': 0}
    out = handle_composite_plating(game, 'composite_plating', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance<4'


def test_composite_plating_skips_when_distance_missing():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = handle_composite_plating(game, 'composite_plating', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance<4'


# ── Introspection helpers ──────────────────────────────────────────────────

def test_combat_declare_defender_second_pass_ids_returns_six():
    ids = combat_declare_defender_second_pass_ids()
    assert ids == _D3_14_SIX
    assert len(ids) == 6


def test_combat_declare_real_handler_ids_includes_all_six_d3_14():
    real = set(combat_declare_real_handler_ids())
    for aid in _D3_14_SIX:
        assert aid in real, f'{aid} must be in real handler set'


def test_combat_declare_real_handler_ids_total_count_is_twenty():
    assert len(combat_declare_real_handler_ids()) == 20


# ── Pattern D bus state (post-D3.14) ───────────────────────────────────────

def test_pattern_d_runnable_ids_includes_all_six_d3_14():
    runnable = set(pattern_d_runnable_ids())
    for aid in _D3_14_SIX:
        assert aid in runnable, f'{aid} must be runnable in Pattern D bus'


def test_pattern_d_stub_count_is_137_after_D3_16():
    # D3.6 baseline 161 stubs. D3.7 landed 6 → 155. D3.9 landed 5 → 150.
    # D3.12 landed 3 → 147. D3.14 lands 6 → 141. D3.16 lands 4
    # (combat-defense-friends: sentinel, protector, keep_the_peace_elite,
    # keep_the_peace_regular) → 137. D3.17 lands 1 (mission-start:
    # stealthy_davith) → 136.
    assert len(pattern_d_stub_ids()) == 136


def test_none_of_six_is_a_stub():
    for aid in _D3_14_SIX:
        info = get_handler_for(aid)
        assert info is not None, f'{aid} must be registered'
        trigger, handler = info
        assert trigger == 'combat-declare'
        assert not is_stub(handler), f'{aid} should no longer be a stub'


# ── Dispatch integration ───────────────────────────────────────────────────

def test_lookup_pattern_returns_D_for_each_of_six():
    for aid in _D3_14_SIX:
        assert lookup_pattern(aid) == 'D', f'{aid} should be Pattern D'


def test_dispatch_resolve_routes_exploit_weakness_through_real_handler():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    combat = _combat()
    ctx = {'combat': combat, 'defender_figure_key': 'Rebel-1-0'}
    out = resolve(game, 'exploit_weakness', ctx)
    assert out['applied'] is True
    assert combat['surgeBonus'] == 1


def test_dispatch_resolve_routes_disposable_through_real_handler():
    game = {}
    combat = _combat()
    ctx = {'combat': combat}
    out = resolve(game, 'disposable', ctx)
    assert out['applied'] is True
    assert combat['bonusEvade'] == -1


def test_dispatch_resolve_routes_composite_plating_through_real_handler():
    game = {}
    combat = _combat()
    ctx = {'combat': combat, 'distance_to_target': 5}
    out = resolve(game, 'composite_plating', ctx)
    assert out['applied'] is True
    assert combat['bonusBlock'] == 1


# ── Fire-site helper: attacker-side D3.14 (exploit_weakness, conclusion) ───

def test_fire_site_helper_fires_exploit_weakness_on_attacker_walk():
    game = {'figureConditions': {'Rebel-1-0': ['Bleed']}}
    combat = _combat()
    ctx = {
        'combat': combat,
        'defender_figure_key': 'Rebel-1-0',
    }
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['exploit_weakness'],
        attacker_figure_key='Scout-1-0',
        ctx=ctx,
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['surgeBonus'] == 1


def test_fire_site_helper_fires_conclusion_on_attacker_walk():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['conclusion'],
        attacker_figure_key='HK47-1-0',
        ctx={},
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['bonusEvade'] == -1


# ── Fire-site helper: D3.14 defender-side walk ─────────────────────────────

def test_fire_site_helper_fires_disposable_on_defender_walk():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={},
        defender_special_ids=['disposable'],
    )
    assert len(out) == 1
    assert out[0]['ability_id'] == 'disposable'
    assert out[0]['applied'] is True
    assert combat['bonusEvade'] == -1


def test_fire_site_helper_fires_cortosis_weave_on_defender_walk():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={},
        defender_special_ids=['cortosis_weave'],
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['bonusPierce'] == -2


def test_fire_site_helper_fires_gamorrean_on_defender_walk_when_ranged():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={'is_ranged': True},
        defender_special_ids=['gamorrean_honor_guard'],
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['bonusBlock'] == 1


def test_fire_site_helper_skips_gamorrean_on_defender_walk_when_melee():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={'is_ranged': False},
        defender_special_ids=['gamorrean_honor_guard'],
    )
    assert len(out) == 1
    assert out[0]['applied'] is False
    assert 'bonusBlock' not in combat


def test_fire_site_helper_fires_composite_plating_when_distance_ge_4():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={'distance_to_target': 5},
        defender_special_ids=['composite_plating'],
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert combat['bonusBlock'] == 1


def test_fire_site_helper_skips_composite_plating_when_distance_below_4():
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={'distance_to_target': 3},
        defender_special_ids=['composite_plating'],
    )
    assert len(out) == 1
    assert out[0]['applied'] is False
    assert 'bonusBlock' not in combat


def test_fire_site_helper_defender_walk_accumulates_multiple_handlers():
    # Defender's DC with both disposable + cortosis_weave — fire in order.
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={},
        defender_special_ids=['disposable', 'cortosis_weave'],
    )
    assert [r['ability_id'] for r in out] == ['disposable', 'cortosis_weave']
    assert all(r['applied'] is True for r in out)
    assert combat['bonusEvade'] == -1
    assert combat['bonusPierce'] == -2


def test_fire_site_helper_attacker_then_defender_walk_ordering():
    # Attacker carries battle_meditation + conclusion; defender carries
    # disposable. Ordering must be attacker-first (battle_meditation,
    # conclusion) then defender (disposable).
    game = {}
    combat = _combat(['blue'])
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['battle_meditation', 'conclusion'],
        attacker_figure_key='Luke-1-0',
        ctx={},
        defender_special_ids=['disposable'],
    )
    assert [r['ability_id'] for r in out] == [
        'battle_meditation', 'conclusion', 'disposable',
    ]
    # battle_meditation added a green die; conclusion + disposable each
    # reduced bonusEvade by 1 (stacks).
    assert combat['attackInfo']['dice'] == ['blue', 'green']
    assert combat['bonusEvade'] == -2


def test_fire_site_helper_with_no_defender_ids_behaves_as_pre_d3_14():
    # Back-compat: omitting defender_special_ids runs only the attacker walk.
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['conclusion'],
        attacker_figure_key='HK47-1-0',
        ctx={},
    )
    assert len(out) == 1
    assert out[0]['ability_id'] == 'conclusion'
    assert combat['bonusEvade'] == -1


def test_fire_site_helper_with_empty_defender_ids_behaves_as_pre_d3_14():
    # Passing empty list explicitly also runs only the attacker walk.
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['conclusion'],
        attacker_figure_key='HK47-1-0',
        ctx={},
        defender_special_ids=[],
    )
    assert len(out) == 1
    assert combat['bonusEvade'] == -1


def test_fire_site_helper_defender_walk_skips_non_pattern_d_ids():
    # Defender DC may carry Pattern A / Pattern C abilities in its
    # specialAbilityIds list; those aren't classified as combat-declare and
    # must be silently ignored by the walk.
    game = {}
    combat = _combat()
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=[],
        attacker_figure_key='Scout-1-0',
        ctx={},
        defender_special_ids=['Focus', 'disposable'],
    )
    # Focus (Pattern A) skipped; disposable (Pattern D combat-declare) fires.
    assert len(out) == 1
    assert out[0]['ability_id'] == 'disposable'
    assert combat['bonusEvade'] == -1


# ── Fail-loud regression: remaining stubs still raise ──────────────────────

def test_remaining_combat_declare_stubs_still_raise():
    # Flawless Execution is the canonical still-stubbed combat-declare
    # ability (needs pendingPowerTokenGrant plumbing). Proves the 137
    # remaining Pattern D stubs are still fail-loud after D3.16.
    try:
        resolve({}, 'flawless_execution', {})
    except TriggerNotImplemented as e:
        assert e.ability_id == 'flawless_execution'
        return
    assert False, 'flawless_execution must still raise TriggerNotImplemented'


def test_fire_site_helper_raises_if_defender_combat_defense_regresses_to_stub():
    # Post-D3.16, every combat-defense Pattern D ability (sentinel, protector,
    # keep_the_peace_elite, keep_the_peace_regular) is real, so no natural
    # stub exists on the combat-defense trigger. To prove the fire-site
    # helper's fail-loud discipline for defender walks, we temporarily swap
    # the real `protector` handler for a bus stub, run the defender walk,
    # assert TriggerNotImplemented raised, then restore. Same pattern as the
    # new combat-defense-friends oracle's sentinel-regression test.
    from python.engine.abilities.pattern_d import (
        register_trigger, _make_stub,
    )
    from python.engine.abilities.pattern_d_handlers import handle_protector
    register_trigger('combat-defense', 'protector',
                     _make_stub('protector', 'combat-defense'))
    try:
        game = {}
        combat = _combat()
        try:
            fire_combat_declare_triggers(
                game, combat,
                attacker_special_ids=[],
                attacker_figure_key='Scout-1-0',
                ctx={},
                defender_special_ids=['protector'],
            )
        except TriggerNotImplemented as e:
            assert e.ability_id == 'protector'
            # fire_combat_declare_triggers annotates the exception with its
            # own fire-site tag ('combat-declare'), regardless of the stub's
            # library trigger. This is the fail-loud contract of the helper.
            assert e.trigger == 'combat-declare'
            return
        assert False, 'fire-site helper must raise on stubbed defender ID'
    finally:
        register_trigger('combat-defense', 'protector', handle_protector)


# ── Runner ─────────────────────────────────────────────────────────────────

def main():
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
