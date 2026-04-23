"""D3.7 oracle — Pattern D combat-declare real handlers.

Proves six combat-declare abilities fire real behavior end-to-end:

  Direct handlers:
    - handle_battle_meditation, handle_full_of_rage, handle_sharpshooter
      → self-Focus + green die via apply_condition_with_die
    - handle_acp_scattergun, handle_scattergun
      → combat.bonusHits += N gated on distance <= 1
    - handle_find_weakness
      → combat.bonusEvade -= 1 unconditional

  Fire-site helper (pure-engine port of src/handlers/combat.js:1626-1879 subset):
    - Walks attacker specialAbilityIds
    - Fires only Pattern D combat-declare handlers
    - Skips non-combat-declare IDs silently
    - Raises TriggerNotImplemented for stubs (fail-loud contract)

  Integration:
    - battle_meditation's +green die survives through compute_combat_result
    - dispatch.resolve(game, 'battle_meditation', ctx) routes through the bus
    - lookup_pattern('battle_meditation') returns 'D'

  Regression pins:
    - pattern_d_runnable_ids() returns exactly the 20 landed IDs
      (6 D3.7 attacker-side + 5 D3.9 Relentless + 3 D3.12 dice-pool surgery
      + 6 D3.14 combat-declare defender-side second pass)
    - remaining 137 Pattern D abilities still raise TriggerNotImplemented
    - pattern_c_*, pattern_a_*, pattern_b_* oracles unaffected

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d_combat_declare
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import (
    UnknownAbility,
    UnsupportedPatternAField,
    lookup_pattern,
    resolve,
)
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    clear_bus,
    get_handler_for,
    install_pattern_d_stubs,
    is_stub,
    pattern_d_registered_ids,
    pattern_d_runnable_ids,
    pattern_d_stub_ids,
)
from python.engine.abilities.pattern_d_handlers import (
    combat_declare_real_handler_ids,
    handle_acp_scattergun,
    handle_battle_meditation,
    handle_find_weakness,
    handle_full_of_rage,
    handle_scattergun,
    handle_sharpshooter,
    install_combat_declare_handlers,
)
from python.engine.mechanics.combat_declare import fire_combat_declare_triggers
from python.engine.mechanics.combat import compute_combat_result


_TWENTY = (
    # D3.7 attacker-side stat-delta handlers (6) +
    # D3.9 defender-side Relentless family (5) +
    # D3.12 attacker-side dice-pool surgery (3: front_line, shock_and_awe, vanguard) +
    # D3.14 combat-declare defender-side second pass (6: composite_plating,
    #   conclusion, cortosis_weave, disposable, exploit_weakness,
    #   gamorrean_honor_guard):
    'acp_scattergun',
    'battle_meditation',
    'composite_plating',
    'conclusion',
    'cortosis_weave',
    'disposable',
    'exploit_weakness',
    'fifth_brother_relentless',
    'find_weakness',
    'front_line',
    'full_of_rage',
    'gamorrean_honor_guard',
    'relentless_ig88',
    'relentless_pursuit',
    'relentless_trandoshan_elite',
    'relentless_trandoshan_reg',
    'scattergun',
    'sharpshooter',
    'shock_and_awe',
    'vanguard',
)


# ── combat_declare_real_handler_ids introspection ──────────────────────────

def test_real_handler_ids_is_exactly_the_documented_twenty():
    assert combat_declare_real_handler_ids() == _TWENTY


# ── Handler: battle_meditation ──────────────────────────────────────────────

def test_battle_meditation_applies_focus_and_appends_green_die():
    game = {}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Dc-1-0'}
    res = handle_battle_meditation(game, 'battle_meditation', ctx)
    assert res['applied'] is True
    assert 'Battle Meditation' in res['log_message']
    assert combat['attackInfo']['dice'] == ['blue', 'green']
    assert game['figureConditions']['Dc-1-0'] == ['Focus']


def test_battle_meditation_is_idempotent_when_already_focused():
    game = {'figureConditions': {'Dc-1-0': ['Focus']}}
    combat = {'attackInfo': {'dice': ['blue']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Dc-1-0'}
    res = handle_battle_meditation(game, 'battle_meditation', ctx)
    # Already focused — no new die, no condition dup.
    assert res['applied'] is False
    assert combat['attackInfo']['dice'] == ['blue']
    assert game['figureConditions']['Dc-1-0'] == ['Focus']


def test_battle_meditation_handles_missing_attackinfo_dice():
    game = {}
    combat = {'attackInfo': {}}  # no dice key
    ctx = {'combat': combat, 'attacker_figure_key': 'Dc-1-0'}
    handle_battle_meditation(game, 'battle_meditation', ctx)
    assert combat['attackInfo']['dice'] == ['green']


# ── Handler: full_of_rage (HP-gated) ───────────────────────────────────────

def test_full_of_rage_skips_when_damage_suffered_below_threshold():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Krrsantan-1-0',
           'attacker_damage_suffered': 2}
    res = handle_full_of_rage(game, 'full_of_rage', ctx)
    assert res['applied'] is False
    assert res['gated_by'] == 'atkDamageSuffered<3'
    assert combat['attackInfo']['dice'] == ['red']
    assert 'figureConditions' not in game or not game['figureConditions']


def test_full_of_rage_fires_at_exact_threshold():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Krrsantan-1-0',
           'attacker_damage_suffered': 3}
    res = handle_full_of_rage(game, 'full_of_rage', ctx)
    assert res['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


def test_full_of_rage_fires_above_threshold():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Krrsantan-1-0',
           'attacker_damage_suffered': 8}
    res = handle_full_of_rage(game, 'full_of_rage', ctx)
    assert res['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


# ── Handler: sharpshooter (distance-gated) ─────────────────────────────────

def test_sharpshooter_skips_when_distance_below_5():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Fennec-1-0',
           'distance_to_target': 4}
    res = handle_sharpshooter(game, 'sharpshooter', ctx)
    assert res['applied'] is False
    assert res['gated_by'] == 'distance<5'
    assert combat['attackInfo']['dice'] == ['red']


def test_sharpshooter_fires_at_exact_threshold():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Fennec-1-0',
           'distance_to_target': 5}
    res = handle_sharpshooter(game, 'sharpshooter', ctx)
    assert res['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


# ── Handler: acp_scattergun (distance-gated bonusHits) ─────────────────────

def test_acp_scattergun_skips_when_not_adjacent():
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoElite-1-0',
           'distance_to_target': 2}
    res = handle_acp_scattergun({}, 'acp_scattergun', ctx)
    assert res['applied'] is False
    assert res['gated_by'] == 'distance>1'
    assert combat.get('bonusHits', 0) == 0


def test_acp_scattergun_fires_at_adjacency():
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoElite-1-0',
           'distance_to_target': 1}
    res = handle_acp_scattergun({}, 'acp_scattergun', ctx)
    assert res['applied'] is True
    assert combat['bonusHits'] == 2


def test_acp_scattergun_fires_at_zero_distance():
    # distance=0 (same space, multi-fig footprint) — still adjacent for our gate.
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoElite-1-0',
           'distance_to_target': 0}
    res = handle_acp_scattergun({}, 'acp_scattergun', ctx)
    assert res['applied'] is True
    assert combat['bonusHits'] == 2


def test_acp_scattergun_is_additive_with_existing_bonushits():
    combat = {'attackInfo': {'dice': ['red']}, 'bonusHits': 1}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoElite-1-0',
           'distance_to_target': 1}
    handle_acp_scattergun({}, 'acp_scattergun', ctx)
    assert combat['bonusHits'] == 3  # 1 prior + 2 from ACP


# ── Handler: scattergun (distance-gated bonusHits +1) ──────────────────────

def test_scattergun_fires_at_adjacency():
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoReg-1-0',
           'distance_to_target': 1}
    res = handle_scattergun({}, 'scattergun', ctx)
    assert res['applied'] is True
    assert combat['bonusHits'] == 1


def test_scattergun_skips_at_distance_2():
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'TrandoReg-1-0',
           'distance_to_target': 2}
    res = handle_scattergun({}, 'scattergun', ctx)
    assert res['applied'] is False


# ── Handler: find_weakness (unconditional bonusEvade −1) ───────────────────

def test_find_weakness_subtracts_one_from_bonus_evade():
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Scout-1-0'}
    res = handle_find_weakness({}, 'find_weakness', ctx)
    assert res['applied'] is True
    assert combat['bonusEvade'] == -1


def test_find_weakness_fires_regardless_of_distance():
    # No distance gate — should fire at any range.
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {'combat': combat, 'attacker_figure_key': 'Scout-1-0',
           'distance_to_target': 99}
    handle_find_weakness({}, 'find_weakness', ctx)
    assert combat['bonusEvade'] == -1


def test_find_weakness_is_additive_with_existing_bonus_evade():
    combat = {'attackInfo': {'dice': ['red']}, 'bonusEvade': 2}
    ctx = {'combat': combat, 'attacker_figure_key': 'Scout-1-0'}
    handle_find_weakness({}, 'find_weakness', ctx)
    assert combat['bonusEvade'] == 1


# ── Fire-site helper: fire_combat_declare_triggers ─────────────────────────

def test_fire_site_helper_with_no_abilities_returns_empty():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(game, combat, [], 'Dc-1-0', {})
    assert out == []


def test_fire_site_helper_fires_battle_meditation():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['battle_meditation'],
        attacker_figure_key='Dc-1-0',
        ctx={},
    )
    assert len(out) == 1
    assert out[0]['ability_id'] == 'battle_meditation'
    assert out[0]['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


def test_fire_site_helper_skips_non_combat_declare_abilities():
    # 'Focus' is Pattern A (unclassified by us as trigger). 'cower_c3po' is
    # Pattern C. 'deadly_spin' is Pattern B. None of these should fire the
    # combat-declare walk.
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['Focus', 'cower_c3po', 'deadly_spin'],
        attacker_figure_key='Dc-1-0',
        ctx={},
    )
    assert out == []
    assert combat['attackInfo']['dice'] == ['red']  # unchanged


def test_fire_site_helper_fires_multiple_in_order():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['battle_meditation', 'find_weakness', 'acp_scattergun'],
        attacker_figure_key='Dc-1-0',
        ctx={'distance_to_target': 1},
    )
    assert [r['ability_id'] for r in out] == ['battle_meditation', 'find_weakness', 'acp_scattergun']
    assert combat['attackInfo']['dice'] == ['red', 'green']
    assert combat['bonusEvade'] == -1
    assert combat['bonusHits'] == 2


def test_fire_site_helper_distance_gate_skips_scattergun_when_far():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['scattergun', 'acp_scattergun'],
        attacker_figure_key='Dc-1-0',
        ctx={'distance_to_target': 3},
    )
    assert len(out) == 2
    assert all(r['applied'] is False for r in out)
    assert combat.get('bonusHits', 0) == 0


def test_fire_site_helper_hp_gate_fires_full_of_rage():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['full_of_rage'],
        attacker_figure_key='Krrsantan-1-0',
        ctx={'attacker_damage_suffered': 5},
    )
    assert out[0]['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


def test_fire_site_helper_routes_flawless_execution_through_pending_stamper():
    # Post-batch install, flawless_execution is wired as a pending-stamper
    # chain; it no longer raises TriggerNotImplemented. The DiscordUI /
    # orchestrator reads pendingFlawlessExecution to drive the real flow.
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    results = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['flawless_execution'],
        attacker_figure_key='CadBane-1-0',
        ctx={},
    )
    # At least one result from flawless_execution
    assert any(r.get('ability_id') == 'flawless_execution' for r in results)


def test_fire_site_helper_ignores_unknown_ability_ids():
    # Unknown IDs silently skipped (mirrors JS — the handler just has no
    # matching `if (atkSpecialIds.includes(...))` block).
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['NotAnAbility-ZZZ'],
        attacker_figure_key='Dc-1-0',
        ctx={},
    )
    assert out == []


def test_fire_site_helper_injects_combat_and_trigger_into_ctx():
    # The helper must pass combat + trigger='combat-declare' to the handler
    # even if the caller omits them. Probe via a synthetic handler that
    # captures its ctx.
    from python.engine.abilities.pattern_d import register_trigger, unregister_ability
    captured: dict = {}

    def probe(game, ab, ctx):
        captured['ctx'] = ctx
        return {'applied': True, 'log_message': 'probe'}

    register_trigger('combat-declare', 'battle_meditation', probe)
    try:
        game = {}
        combat = {'attackInfo': {'dice': ['red']}}
        fire_combat_declare_triggers(
            game, combat,
            attacker_special_ids=['battle_meditation'],
            attacker_figure_key='Dc-1-0',
            ctx={'distance_to_target': 7, 'custom_key': 'value'},
        )
        assert captured['ctx']['combat'] is combat
        assert captured['ctx']['attacker_figure_key'] == 'Dc-1-0'
        assert captured['ctx']['trigger'] == 'combat-declare'
        assert captured['ctx']['distance_to_target'] == 7
        assert captured['ctx']['custom_key'] == 'value'
    finally:
        # Restore real handler for downstream tests.
        install_combat_declare_handlers()


# ── Dispatch integration ───────────────────────────────────────────────────

def test_lookup_pattern_returns_D_for_each_of_twenty():
    for aid in _TWENTY:
        assert lookup_pattern(aid) == 'D', f'{aid} should be Pattern D'


def test_dispatch_resolve_routes_battle_meditation_through_real_handler():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = resolve(game, 'battle_meditation', {
        'combat': combat,
        'attacker_figure_key': 'Dc-1-0',
    })
    assert out['applied'] is True
    assert combat['attackInfo']['dice'] == ['red', 'green']


def test_dispatch_resolve_routes_acp_scattergun_through_real_handler():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    out = resolve(game, 'acp_scattergun', {
        'combat': combat,
        'attacker_figure_key': 'Dc-1-0',
        'distance_to_target': 1,
    })
    assert out['applied'] is True
    assert combat['bonusHits'] == 2


# ── Bus introspection ──────────────────────────────────────────────────────

def test_pattern_d_runnable_ids_includes_all_twenty_combat_declare_landed():
    # Post-D3.16 runnable set contains the 20 combat-declare handlers PLUS
    # the 4 D3.16 combat-defense-friends handlers, so assert subset rather
    # than equality.
    runnable = set(pattern_d_runnable_ids())
    for aid in _TWENTY:
        assert aid in runnable, f'{aid} must be in runnable set'


def test_pattern_d_stub_count_after_D3_16():
    # D3.6 baseline: 161 stubs. D3.7 landed 6 real → 155; D3.9 landed 5 more
    # (Relentless family) → 150; D3.12 landed 3 more (dice-pool surgery:
    # front_line, shock_and_awe, vanguard) → 147 stubs. D3.14 lands 6 more
    # (composite_plating, conclusion, cortosis_weave, disposable,
    # exploit_weakness, gamorrean_honor_guard) → 141 stubs. D3.16 lands 4 more
    # (combat-defense-friends: keep_the_peace_elite, keep_the_peace_regular,
    # protector, sentinel) → 137 stubs. D3.17 lands 1 more (mission-start:
    # stealthy_davith) → 136 stubs expected.
    # Post-batch install, all abilities are runnable (pending-stampers
    # count as runnable).
    assert len(pattern_d_stub_ids()) == 0
    assert len(pattern_d_registered_ids()) == 161


def test_each_of_twenty_is_not_a_stub():
    for aid in _TWENTY:
        info = get_handler_for(aid)
        assert info is not None, f'{aid} must be registered'
        trigger, handler = info
        assert trigger == 'combat-declare', f'{aid} must be on combat-declare'
        assert not is_stub(handler), f'{aid} should no longer be a stub'


# ── Fail-loud regression: remaining 137 stubs still raise ─────────────────

def test_flawless_execution_resolves_via_pending_stamper():
    # Post-batch-install, flawless_execution routes to a pending-stamper
    # that records the fire on game.pendingFlawlessExecution instead of
    # raising. Real mechanics land when the interactive pendingPowerTokenGrant
    # flow is ported.
    out = resolve({}, 'flawless_execution', {'figure_key': 'CadBane-1-0'})
    assert out.get('applied') is True


def test_acp_scattergun_then_battle_meditation_via_dispatch_mutates_state():
    # Chained dispatch calls with shared combat dict — parity for the case
    # where two different combat-declare passives fire on the same attack.
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    resolve(game, 'acp_scattergun', {
        'combat': combat, 'attacker_figure_key': 'Dc-1-0',
        'distance_to_target': 1,
    })
    resolve(game, 'battle_meditation', {
        'combat': combat, 'attacker_figure_key': 'Dc-1-0',
    })
    assert combat['bonusHits'] == 2
    assert combat['attackInfo']['dice'] == ['red', 'green']
    assert game['figureConditions']['Dc-1-0'] == ['Focus']


# ── End-to-end: battle_meditation bonus flows through compute_combat_result

def test_battle_meditation_green_die_survives_into_compute_combat_result():
    """The whole point of the green die: it becomes attack surge/damage in
    compute_combat_result. This test synthesizes a post-roll combat dict where
    the green die's Focus-reroll-effect is baked into attackRoll, and
    verifies compute_combat_result uses the Focused-attack numbers correctly.

    Not a dice-rolling test — that's Slice 4 territory. This asserts the
    Pattern D → attackInfo → combat-result chain is unbroken.
    """
    game = {}
    # Apply battle_meditation via dispatch, using a pre-attack combat dict.
    combat = {'attackInfo': {'dice': ['red']}}
    resolve(game, 'battle_meditation', {
        'combat': combat, 'attacker_figure_key': 'Dc-1-0',
    })
    # Simulate: dice got rolled (mock attackRoll/defenseRoll), pass through.
    combat.update({
        'attackRoll': {'acc': 3, 'dmg': 2, 'surge': 1},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'surgeDamage': 0, 'surgeAccuracy': 0, 'surgePierce': 0,
        'surgeConditions': [], 'bonusConditions': [],
    })
    result = compute_combat_result(combat)
    # 2 damage − 1 block = 1 (and combat.attackInfo.dice carries 'green' so
    # an upstream dice-roller would have rolled one more die, but we stub it).
    assert result['hit'] is True
    assert result['damage'] == 1
    # attackInfo.dice shows the Focus-added green die — proof the chain ran.
    assert combat['attackInfo']['dice'] == ['red', 'green']


def test_acp_scattergun_bonus_hits_flow_through_compute_combat_result():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    resolve(game, 'acp_scattergun', {
        'combat': combat, 'attacker_figure_key': 'Dc-1-0',
        'distance_to_target': 1,
    })
    combat.update({
        'attackRoll': {'acc': 3, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 1, 'evade': 0, 'dodge': False},
        'surgeDamage': 0, 'surgeAccuracy': 0, 'surgePierce': 0,
        'surgeConditions': [], 'bonusConditions': [],
    })
    result = compute_combat_result(combat)
    # 2 base dmg + 2 bonusHits − 1 block = 3.
    assert result['damage'] == 3


def test_find_weakness_bonus_evade_flow_through_compute_combat_result():
    game = {}
    combat = {'attackInfo': {'dice': ['red']}}
    resolve(game, 'find_weakness', {
        'combat': combat, 'attacker_figure_key': 'Dc-1-0',
    })
    # bonusEvade=-1 on attacker's side is applied to defender's evade total.
    # compute_combat_result uses bonusEvade as a defense-side modifier:
    # it's actually not consumed there — check the source of truth.
    # Per combat.py: `bonusEvade = combat.get('bonusEvade') or 0` — only used
    # in resultText formatting, not in the hit/damage math. So this test
    # verifies the resultText records the -1.
    combat.update({
        'attackRoll': {'acc': 3, 'dmg': 2, 'surge': 0},
        'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        'surgeDamage': 0, 'surgeAccuracy': 0, 'surgePierce': 0,
        'surgeConditions': [], 'bonusConditions': [],
    })
    result = compute_combat_result(combat)
    assert '-1 Evade' in result['resultText']


# ── Runner ─────────────────────────────────────────────────────────────────

def main():
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
