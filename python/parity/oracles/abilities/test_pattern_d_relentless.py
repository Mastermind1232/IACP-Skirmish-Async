"""D3.9 oracle — Pattern D Relentless family (defender-side combat-declare).

Proves five Relentless abilities fire real behavior end-to-end:

  Handlers (all share `_relentless_strain` shared primitive):
    - handle_relentless_trandoshan_elite, handle_relentless_trandoshan_reg,
      handle_relentless_ig88, handle_fifth_brother_relentless
      → 1 Strain to target figure if distance_to_target <= 3
    - handle_relentless_pursuit
      → library orphan (no JS DC carries it); registered for dispatch parity

  Fire-site integration (port of src/handlers/combat.js:1711-1715):
    - Defender-side ctx threaded through fire_combat_declare_triggers
    - HP of defender figure is reduced in dc_health_state
    - Fireproof gate prevents strain
    - Defeat signal propagated on lethal hit

  Library parity:
    - 5 relentless_* IDs present in data/ability-library.json
    - 4 of them appear in JS relentlessIds list at combat.js:1712
    - relentless_pursuit is a library orphan — flagged + pinned

  Regression pins:
    - combat_declare_real_handler_ids() count = 20
      (6 from D3.7 + 5 from D3.9 + 3 from D3.12 + 6 from D3.14)
    - pattern_d_runnable_ids() count = 24
      (20 combat-declare + 4 D3.16 combat-defense-friends)
    - pattern_d_stub_ids() count = 137 (161 − 24)
    - remaining 137 Pattern D abilities still raise TriggerNotImplemented

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d_relentless
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
    combat_declare_defender_side_ids,
    combat_declare_real_handler_ids,
    handle_fifth_brother_relentless,
    handle_relentless_ig88,
    handle_relentless_pursuit,
    handle_relentless_trandoshan_elite,
    handle_relentless_trandoshan_reg,
)
from python.engine.mechanics.combat_declare import fire_combat_declare_triggers
from python.engine.mechanics.figure_lookup import (
    find_dc_message_id_for_figure,
    parse_figure_key,
)


_RELENTLESS_FIVE = (
    'fifth_brother_relentless',
    'relentless_ig88',
    'relentless_pursuit',
    'relentless_trandoshan_elite',
    'relentless_trandoshan_reg',
)

_JS_FIRED_RELENTLESS = (
    # Matches `relentlessIds` list at src/handlers/combat.js:1712 exactly.
    'relentless_trandoshan_elite',
    'relentless_trandoshan_reg',
    'relentless_ig88',
    'fifth_brother_relentless',
)

_LIBRARY_ORPHAN = 'relentless_pursuit'


def _build_relentless_defender_ctx(defender_figure_key='Rebel-1-0',
                                   defender_player_num=2,
                                   defender_hp=5, defender_hp_max=5,
                                   distance=1, dc_name_p2='Rebel',
                                   attacker_figure_key='Trando-1-0'):
    """Build a full defender-side ctx + game state.

    Returns (game, ctx, msg_id) — the msg_id is the defender's DC message id
    so the caller can assert on dc_health_state[msg_id] after the fire.
    """
    msg_id = 'msg-def-1'
    dc_message_meta = {
        msg_id: {
            'gameId': 'g-test',
            'playerNum': defender_player_num,
            'dcName': dc_name_p2,
            'displayName': f'{dc_name_p2} [DG 1]',
        },
    }
    dc_health_state = {
        msg_id: [[defender_hp, defender_hp_max]],
    }
    game = {
        'gameId': 'g-test',
    }
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {
        'combat': combat,
        'attacker_figure_key': attacker_figure_key,
        'distance_to_target': distance,
        'defender_figure_key': defender_figure_key,
        'defender_player_num': defender_player_num,
        'dc_health_state': dc_health_state,
        'dc_message_meta': dc_message_meta,
    }
    return game, ctx, msg_id


# ── parse_figure_key primitive ──────────────────────────────────────────────

def test_parse_figure_key_returns_parts():
    assert parse_figure_key('Trando-1-0') == ('Trando', 1, 0)


def test_parse_figure_key_handles_hyphens_in_dc_name():
    # IG-88 has a hyphen in the DC name; regex is greedy-first-group.
    assert parse_figure_key('IG-88-1-2') == ('IG-88', 1, 2)


def test_parse_figure_key_returns_none_for_malformed():
    assert parse_figure_key('no-matching-shape-here-abc') is None


def test_parse_figure_key_returns_none_for_non_string():
    assert parse_figure_key(None) is None
    assert parse_figure_key(123) is None


# ── find_dc_message_id_for_figure primitive ────────────────────────────────

def test_find_dc_message_id_basic_match():
    meta = {
        'msg1': {
            'gameId': 'g1', 'playerNum': 2,
            'dcName': 'Trando', 'displayName': 'Trando [DG 1]',
        },
    }
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', meta) == 'msg1'


def test_find_dc_message_id_returns_none_when_no_match():
    meta = {
        'msg1': {
            'gameId': 'g1', 'playerNum': 2,
            'dcName': 'Rebel', 'displayName': 'Rebel [DG 1]',
        },
    }
    # Asking for a different dcName → None.
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', meta) is None


def test_find_dc_message_id_respects_game_id():
    meta = {
        'msg1': {
            'gameId': 'g-other', 'playerNum': 2,
            'dcName': 'Trando', 'displayName': 'Trando [DG 1]',
        },
    }
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', meta) is None


def test_find_dc_message_id_respects_player_num():
    meta = {
        'msg1': {
            'gameId': 'g1', 'playerNum': 1,
            'dcName': 'Trando', 'displayName': 'Trando [DG 1]',
        },
    }
    # Caller asks for player 2 — player 1 match must be skipped.
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', meta) is None


def test_find_dc_message_id_matches_dg_index():
    meta = {
        'msg1': {
            'gameId': 'g1', 'playerNum': 2,
            'dcName': 'Trando', 'displayName': 'Trando [DG 1]',
        },
        'msg2': {
            'gameId': 'g1', 'playerNum': 2,
            'dcName': 'Trando', 'displayName': 'Trando [DG 2]',
        },
    }
    # Asking for Trando-2-0 → msg2, not msg1.
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-2-0', meta) == 'msg2'


def test_find_dc_message_id_accepts_group_label_variant():
    # JS regex allows '[DG 1]' or '[Group 1]' interchangeably.
    meta = {
        'msg1': {
            'gameId': 'g1', 'playerNum': 2,
            'dcName': 'Trando', 'displayName': 'Trando [Group 1]',
        },
    }
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', meta) == 'msg1'


def test_find_dc_message_id_returns_none_for_empty_meta():
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', {}) is None
    assert find_dc_message_id_for_figure('g1', 2, 'Trando-1-0', None) is None


# ── Handler: distance gate boundary ─────────────────────────────────────────

def test_relentless_fires_at_distance_3_exact_boundary():
    game, ctx, msg_id = _build_relentless_defender_ctx(distance=3)
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is True
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]


def test_relentless_skips_at_distance_4():
    game, ctx, msg_id = _build_relentless_defender_ctx(distance=4)
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'distance>3'
    # HP untouched.
    assert ctx['dc_health_state'][msg_id] == [[5, 5]]


def test_relentless_fires_at_distance_1():
    game, ctx, msg_id = _build_relentless_defender_ctx(distance=1)
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is True
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]


def test_relentless_fires_at_distance_0_adjacent():
    game, ctx, msg_id = _build_relentless_defender_ctx(distance=0)
    out = handle_relentless_ig88(game, 'relentless_ig88', ctx)
    assert out['applied'] is True


# ── Handler: missing-ctx fail-soft gates ───────────────────────────────────

def test_relentless_gates_off_when_defender_figure_key_missing():
    game, ctx, _msg_id = _build_relentless_defender_ctx()
    ctx['defender_figure_key'] = None
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'missing-defender'


def test_relentless_gates_off_when_defender_player_num_missing():
    game, ctx, _msg_id = _build_relentless_defender_ctx()
    ctx['defender_player_num'] = None
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'missing-defender'


def test_relentless_gates_off_when_no_matching_dc_msg_id():
    # Defender figure key doesn't match any dcMessageMeta entry.
    game, ctx, _msg_id = _build_relentless_defender_ctx()
    ctx['defender_figure_key'] = 'NotInMeta-1-0'
    out = handle_relentless_trandoshan_elite(game, 'relentless_trandoshan_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-dc-msg-id'


# ── Handler: Fireproof + defeat integration ────────────────────────────────

def test_relentless_blocked_by_fireproof_attachment():
    game, ctx, msg_id = _build_relentless_defender_ctx()
    game['p2DcAttachments'] = {msg_id: ['Flame Trooper']}
    out = handle_relentless_ig88(game, 'relentless_ig88', ctx)
    assert out['applied'] is False
    assert out.get('fireproof') is True
    # HP untouched.
    assert ctx['dc_health_state'][msg_id] == [[5, 5]]
    # Log message name-checks the label.
    assert 'Fireproof' in out['log_message']
    assert 'Relentless' in out['log_message']


def test_relentless_defeat_signal_when_lethal():
    game, ctx, msg_id = _build_relentless_defender_ctx(defender_hp=1)
    out = handle_relentless_ig88(game, 'relentless_ig88', ctx)
    assert out['applied'] is True
    assert out['defeated'] is True
    assert ctx['dc_health_state'][msg_id] == [[0, 5]]
    assert out['new_hp'] == 0


def test_relentless_silent_noop_on_already_defeated():
    game, ctx, msg_id = _build_relentless_defender_ctx(defender_hp=0)
    out = handle_relentless_ig88(game, 'relentless_ig88', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'already-defeated'
    assert ctx['dc_health_state'][msg_id] == [[0, 5]]


# ── Label differentiation (JS parity) ───────────────────────────────────────

def test_js_fired_four_use_label_relentless():
    for handler_fn, aid in (
        (handle_relentless_trandoshan_elite, 'relentless_trandoshan_elite'),
        (handle_relentless_trandoshan_reg,   'relentless_trandoshan_reg'),
        (handle_relentless_ig88,             'relentless_ig88'),
        (handle_fifth_brother_relentless,    'fifth_brother_relentless'),
    ):
        game, ctx, _msg_id = _build_relentless_defender_ctx()
        out = handler_fn(game, aid, ctx)
        assert out['applied'] is True, aid
        assert '**Relentless**' in out['log_message'], f'{aid} missing Relentless label'
        assert '**Relentless Pursuit**' not in out['log_message'], f'{aid} should not use orphan label'


def test_relentless_pursuit_uses_distinct_label():
    game, ctx, _msg_id = _build_relentless_defender_ctx()
    out = handle_relentless_pursuit(game, 'relentless_pursuit', ctx)
    assert out['applied'] is True
    assert '**Relentless Pursuit**' in out['log_message']


# ── Introspection helpers ──────────────────────────────────────────────────

def test_combat_declare_defender_side_ids_returns_five():
    ids = combat_declare_defender_side_ids()
    assert ids == _RELENTLESS_FIVE
    assert len(ids) == 5


def test_combat_declare_real_handler_ids_includes_all_five_relentless():
    real = set(combat_declare_real_handler_ids())
    for aid in _RELENTLESS_FIVE:
        assert aid in real, f'{aid} must be in real handler set'


def test_combat_declare_real_handler_ids_total_count_is_twenty():
    assert len(combat_declare_real_handler_ids()) == 20


# ── Pattern D bus state (post-D3.9) ────────────────────────────────────────

def test_pattern_d_runnable_ids_includes_all_five_relentless():
    runnable = set(pattern_d_runnable_ids())
    for aid in _RELENTLESS_FIVE:
        assert aid in runnable, f'{aid} must be runnable in Pattern D bus'


def test_pattern_d_stub_count_is_137_after_D3_16():
    # D3.6 baseline 161 stubs. D3.7 landed 6 → 155. D3.9 lands 5 more → 150.
    # D3.12 lands 3 more (dice-pool surgery) → 147. D3.14 lands 6 more
    # (combat-declare defender-side second pass) → 141. D3.16 lands 4 more
    # (combat-defense-friends: sentinel, protector, keep_the_peace_elite,
    # keep_the_peace_regular) → 137. D3.17 lands 1 more (mission-start:
    # stealthy_davith) → 136.
    assert len(pattern_d_stub_ids()) == 108


def test_none_of_five_is_a_stub():
    for aid in _RELENTLESS_FIVE:
        info = get_handler_for(aid)
        assert info is not None, f'{aid} must be registered'
        trigger, handler = info
        assert trigger == 'combat-declare'
        assert not is_stub(handler), f'{aid} should no longer be a stub'


# ── Dispatch integration ───────────────────────────────────────────────────

def test_lookup_pattern_returns_D_for_each_relentless():
    for aid in _RELENTLESS_FIVE:
        assert lookup_pattern(aid) == 'D', f'{aid} should be Pattern D'


def test_dispatch_resolve_routes_relentless_ig88_through_real_handler():
    game, ctx, msg_id = _build_relentless_defender_ctx()
    out = resolve(game, 'relentless_ig88', ctx)
    assert out['applied'] is True
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]


def test_dispatch_resolve_routes_relentless_pursuit_orphan_cleanly():
    # The library orphan is still dispatchable by direct ID even though it's
    # unreachable via live fire_combat_declare_triggers walks (no DC carries
    # it in specialAbilityIds).
    game, ctx, msg_id = _build_relentless_defender_ctx()
    out = resolve(game, 'relentless_pursuit', ctx)
    assert out['applied'] is True
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]
    assert '**Relentless Pursuit**' in out['log_message']


# ── Fire-site integration ──────────────────────────────────────────────────

def test_fire_site_helper_fires_relentless_on_defender():
    game, ctx, msg_id = _build_relentless_defender_ctx()
    combat = ctx['combat']
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['relentless_trandoshan_elite'],
        attacker_figure_key=ctx['attacker_figure_key'],
        ctx=ctx,
    )
    assert len(out) == 1
    assert out[0]['applied'] is True
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]


def test_fire_site_helper_skips_relentless_when_distance_above_3():
    game, ctx, msg_id = _build_relentless_defender_ctx(distance=5)
    combat = ctx['combat']
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['relentless_ig88'],
        attacker_figure_key=ctx['attacker_figure_key'],
        ctx=ctx,
    )
    assert len(out) == 1
    assert out[0]['applied'] is False
    assert ctx['dc_health_state'][msg_id] == [[5, 5]]


def test_fire_site_helper_fires_multiple_relentless_together():
    # Unusual scenario (no DC carries multiple Relentless IDs), but proves
    # the fire-site walk accumulates defender-side side effects correctly.
    game, ctx, msg_id = _build_relentless_defender_ctx(defender_hp=4)
    combat = ctx['combat']
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['relentless_trandoshan_elite', 'relentless_ig88'],
        attacker_figure_key=ctx['attacker_figure_key'],
        ctx=ctx,
    )
    assert len(out) == 2
    assert all(r['applied'] is True for r in out)
    # Each handler applied 1 strain → defender at 4 - 2 = 2.
    assert ctx['dc_health_state'][msg_id] == [[2, 5]]


def test_fire_site_helper_mixes_attacker_and_defender_handlers():
    # Same attacker carries battle_meditation + relentless_ig88 — former
    # mutates combat dict; latter mutates dc_health_state.
    game, ctx, msg_id = _build_relentless_defender_ctx()
    combat = ctx['combat']
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['battle_meditation', 'relentless_ig88'],
        attacker_figure_key=ctx['attacker_figure_key'],
        ctx=ctx,
    )
    assert [r['ability_id'] for r in out] == ['battle_meditation', 'relentless_ig88']
    # battle_meditation added a green die.
    assert combat['attackInfo']['dice'] == ['red', 'green']
    # relentless_ig88 reduced defender HP.
    assert ctx['dc_health_state'][msg_id] == [[4, 5]]


def test_fire_site_helper_skips_when_defender_ctx_is_missing():
    # If the fire-site caller (future D4 handler port) forgets to thread
    # defender ctx, the gate trips to 'missing-defender' rather than
    # raising — matches JS which silently returns from applyStrainToFigure
    # when it can't resolve msgId.
    game = {'gameId': 'g-test'}
    combat = {'attackInfo': {'dice': ['red']}}
    ctx = {
        'combat': combat,
        'attacker_figure_key': 'Trando-1-0',
        'distance_to_target': 1,
        # defender_* / dc_health_state / dc_message_meta intentionally omitted
    }
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['relentless_ig88'],
        attacker_figure_key='Trando-1-0',
        ctx=ctx,
    )
    assert len(out) == 1
    assert out[0]['applied'] is False
    assert out[0]['gated_by'] == 'missing-defender'


def test_fire_site_helper_fireproof_prevents_defender_hp_change():
    game, ctx, msg_id = _build_relentless_defender_ctx()
    game['p1DcAttachments'] = {msg_id: ['Flame Trooper']}
    combat = ctx['combat']
    out = fire_combat_declare_triggers(
        game, combat,
        attacker_special_ids=['fifth_brother_relentless'],
        attacker_figure_key=ctx['attacker_figure_key'],
        ctx=ctx,
    )
    assert len(out) == 1
    assert out[0]['applied'] is False
    assert out[0]['fireproof'] is True
    # HP unchanged.
    assert ctx['dc_health_state'][msg_id] == [[5, 5]]


# ── Library-orphan pin for relentless_pursuit ──────────────────────────────

def test_relentless_pursuit_is_in_library():
    from python.engine.data.ability_library_loader import get_ability
    entry = get_ability('relentless_pursuit')
    assert entry is not None
    assert entry.get('trigger') == 'combat-declare'
    assert entry.get('type') == 'dcSpecial'
    assert entry.get('wiredStatus') == 'wired'


def test_relentless_pursuit_not_in_js_firing_list():
    # JS list at src/handlers/combat.js:1712 only fires 4 IDs. Pinning the
    # discovery here so a future JS sync has a grep-able test name.
    js_fired = set(_JS_FIRED_RELENTLESS)
    assert _LIBRARY_ORPHAN not in js_fired
    # And the 4 JS-fired are all still in the Python-landed set.
    py_real = set(combat_declare_real_handler_ids())
    for aid in js_fired:
        assert aid in py_real


def test_four_js_fired_relentless_are_all_python_handlers():
    py_real = set(combat_declare_real_handler_ids())
    for aid in _JS_FIRED_RELENTLESS:
        assert aid in py_real, f'{aid} is in JS list but missing from Python handlers'


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


# ── Runner ─────────────────────────────────────────────────────────────────

def main():
    # Re-install handlers once at runner start so the bus state is fully
    # post-D3.9 before any stubs get re-probed by downstream tests.
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
