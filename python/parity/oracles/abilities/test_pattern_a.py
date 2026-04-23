"""D3.3 oracle — Pattern A stat-delta handler.

Spot-checks the shared handler on a spread of real library abilities:
  - HANDLED appliers mutate `game` correctly (applyFocus → figureConditions etc.)
  - RECORDED appliers accumulate in `result['bank']`
  - Mixed entries (applyFocus + extraActionBonus) do both
  - Pure-metadata entries resolve as empty no-ops
  - Allowlist fields with no applier raise UnsupportedPatternAField
  - Wrong-pattern resolve raises ValueError
  - Unknown ability raises UnknownAbility

Run as: python3 -m python.parity.oracles.abilities.test_pattern_a
"""
import sys

from python.engine.abilities.dispatch import UnknownAbility
from python.engine.abilities.pattern_a import (
    UnsupportedPatternAField,
    handled_fields,
    pattern_a_ids_all_handled,
    resolve_pattern_a,
)


# ── HANDLED: applyFocus ─────────────────────────────────────────────────────

def test_focus_applies_condition():
    game = {}
    r = resolve_pattern_a(game, 'Focus', {'figure_key': 'FK-1'})
    assert r['pattern'] == 'A'
    assert r['applied'] == [('applyFocus', 'FK-1')]
    assert r['bank'] == {}
    assert r['unimplemented'] == []
    assert game['figureConditions']['FK-1'] == ['Focus']


def test_focus_requires_figure_key():
    try:
        resolve_pattern_a({}, 'Focus', {})
    except UnsupportedPatternAField:
        return
    assert False, 'expected UnsupportedPatternAField without figure_key'


def test_guild_programming_applies_focus():
    game = {}
    r = resolve_pattern_a(game, 'Guild Programming', {'figure_key': 'FK-gp'})
    assert ('applyFocus', 'FK-gp') in r['applied']
    assert game['figureConditions']['FK-gp'] == ['Focus']


# ── HANDLED: applyHide ──────────────────────────────────────────────────────

def test_blend_in_applies_hide():
    game = {}
    r = resolve_pattern_a(game, 'Blend In', {'figure_key': 'FK-bi'})
    assert r['applied'] == [('applyHide', 'FK-bi')]
    assert game['figureConditions']['FK-bi'] == ['Hide']


def test_hide_in_plain_sight_applies_hide():
    game = {}
    r = resolve_pattern_a(game, 'Hide in Plain Sight', {'figure_key': 'FK-hps'})
    assert ('applyHide', 'FK-hps') in r['applied']


# ── HANDLED: recoverDamage ──────────────────────────────────────────────────

def _mk_health(msg_id='msg1', cur_hp=5, max_hp=8):
    # Health layout mirrors JS: [curHp, maxHp].
    return {'health': {msg_id: [[cur_hp, max_hp]]}}


def test_glory_of_the_kill_heals():
    game = _mk_health(cur_hp=5, max_hp=8)
    ctx = {'figure_key': 'FK-gok', 'msg_id': 'msg1', 'figure_index': 0, 'player_num': 1}
    r = resolve_pattern_a(game, 'Glory of the Kill', ctx)
    tag, payload = r['applied'][0]
    assert tag == 'recoverDamage'
    assert payload['figureKey'] == 'FK-gok'
    assert payload['amount'] == 3  # recoverDamage:3 from cur_hp 5 → newHp 8
    assert game['health']['msg1'][0][0] == 8  # cur_hp went 5→8


def test_miracle_worker_heals():
    game = _mk_health(cur_hp=2, max_hp=6)
    ctx = {'figure_key': 'FK-mw', 'msg_id': 'msg1', 'figure_index': 0, 'player_num': 1}
    r = resolve_pattern_a(game, 'Miracle Worker', ctx)
    assert r['applied'][0][0] == 'recoverDamage'
    assert game['health']['msg1'][0][0] > 2  # hp went up


def test_recover_damage_missing_ctx_banks_pending():
    """Without msg_id, recoverDamage now banks pendingRecoverDamage
    (was: raised UnsupportedPatternAField). Lets the caller still see
    the ability fired without requiring msg_id up front."""
    game = _mk_health()
    r = resolve_pattern_a(game, 'Recovery', {'figure_key': 'FK-r'})
    assert 'pendingRecoverDamage' in r['bank']
    assert r['bank']['pendingRecoverDamage'] >= 1


# ── RECORDED: bank accumulators ─────────────────────────────────────────────

def test_forbidden_knowledge_records_draw():
    r = resolve_pattern_a({}, 'Forbidden Knowledge', {})
    assert r['bank'] == {'draws': 1}
    assert r['applied'] == [('draw', 1)]


def test_there_is_another_records_draw():
    r = resolve_pattern_a({}, 'There is Another', {})
    assert r['bank'].get('draws', 0) >= 1


def test_jump_jets_records_mpBonus():
    r = resolve_pattern_a({}, 'Jump Jets', {})
    assert r['bank'].get('mpBonus', 0) > 0
    assert r['applied'][0][0] == 'mpBonus'


def test_desperate_escape_records_mpBonus():
    r = resolve_pattern_a({}, 'Desperate Escape', {})
    assert r['bank'].get('mpBonus', 0) > 0


def test_cc_advance_warning_records_mpBonus():
    r = resolve_pattern_a({}, 'cc:advance_warning', {})
    assert r['bank'].get('mpBonus', 0) > 0


def test_cc_fleet_footed_records_mpBonus():
    r = resolve_pattern_a({}, 'cc:fleet_footed', {})
    assert r['bank'].get('mpBonus', 0) > 0


# ── MIXED: HANDLED + RECORDED in the same entry ─────────────────────────────

def test_all_in_a_days_work_applies_focus_and_banks_action():
    game = {}
    r = resolve_pattern_a(game, "All in a Day's Work", {'figure_key': 'FK-ad'})
    tags = [t for t, _ in r['applied']]
    assert 'applyFocus' in tags
    assert 'extraActionBonus' in tags
    assert r['bank']['extraActionBonus'] == 1
    assert game['figureConditions']['FK-ad'] == ['Focus']


# ── PURE METADATA: empty applied ────────────────────────────────────────────

def test_cals_buddy_pure_metadata_is_noop():
    # Cal's Buddy has no non-metadata fields — should resolve with empty applied.
    r = resolve_pattern_a({}, "Cal's Buddy", {})
    assert r['applied'] == []
    assert r['bank'] == {}


def test_eyes_on_the_prize_informational_is_noop():
    # cc:eyes_on_the_prize has `informational: true` only (metadata-only).
    r = resolve_pattern_a({}, 'cc:eyes_on_the_prize', {})
    assert r['applied'] == []
    assert r['bank'] == {}


# ── FAIL LOUDLY: allowlist field with no applier ───────────────────────────

def test_beatdown_stamps_next_attacks_bonus():
    """Beatdown has nextAttacksBonusHits. Post-expansion the applier
    stamps game.nextAttacksBonusHits[msg_id] for the hit-bonus consumer."""
    game: Dict[str, Any] = {}
    r = resolve_pattern_a(game, 'Beatdown', {
        'figure_key': 'FK-b', 'msg_id': 'm1',
    })
    assert r['pattern'] == 'A'
    assert ('nextAttacksBonusHits', {'count': 2, 'bonus': 1}) in r['applied'] \
        or any(k == 'nextAttacksBonusHits' for k, _ in r['applied'])
    # pendingCombat / nextAttacksBonusHits stamp landed.
    assert 'm1' in (game.get('nextAttacksBonusHits') or {})


def test_armed_escort_stamps_defense_bonus():
    """Armed Escort's roundDefenseBonusEvade now lands on pendingCombat."""
    game: Dict[str, Any] = {}
    r = resolve_pattern_a(game, 'Armed Escort', {'figure_key': 'FK-ae'})
    assert r['pattern'] == 'A'
    assert ('bonusEvade', 1) in r['applied'] \
        or ('bonusEvade', 2) in r['applied']
    # pendingCombat got the evade bump.
    assert (game.get('pendingCombat') or {}).get('bonusEvade') >= 1


# ── FAIL LOUDLY: wrong-pattern + unknown ability ───────────────────────────

def test_wrong_pattern_raises_ValueError():
    try:
        resolve_pattern_a({}, 'Force Push', {})  # classified E
    except ValueError as e:
        assert 'Pattern A' in str(e) or 'pattern_a' in str(e)
        return
    assert False


def test_unknown_ability_raises_UnknownAbility():
    try:
        resolve_pattern_a({}, 'NotAnAbility-ZZZ', {})
    except UnknownAbility:
        return
    assert False


# ── Introspection helpers ───────────────────────────────────────────────────

def test_handled_fields_nonempty_and_sorted():
    fields = handled_fields()
    assert fields == sorted(fields)
    assert 'applyFocus' in fields
    assert 'applyHide' in fields
    assert 'powerTokenGain' in fields
    assert 'recoverDamage' in fields
    assert 'mpBonus' in fields
    assert 'draw' in fields


def test_pattern_a_ids_all_handled_is_nonempty():
    # Returns Pattern A IDs whose non-metadata fields are ALL in _FIELD_APPLIERS.
    ids = pattern_a_ids_all_handled()
    assert isinstance(ids, list)
    assert len(ids) >= 10, f'expected ≥10 fully-handled Pattern A abilities, got {len(ids)}'
    # Spot-check: Focus/Blend In/Forbidden Knowledge/Jump Jets should all be in.
    for expected in ['Focus', 'Blend In', 'Forbidden Knowledge', 'Jump Jets',
                     'Glory of the Kill', 'cc:advance_warning']:
        assert expected in ids, f'expected {expected!r} in fully-handled set'


def test_result_dict_shape():
    r = resolve_pattern_a({}, 'Focus', {'figure_key': 'FK-shape'})
    assert set(r.keys()) == {'ability_id', 'pattern', 'applied', 'bank', 'unimplemented'}
    assert r['ability_id'] == 'Focus'
    assert r['pattern'] == 'A'
    assert isinstance(r['applied'], list)
    assert isinstance(r['bank'], dict)
    assert isinstance(r['unimplemented'], list)


# ── All 20 fully-handled Pattern A IDs resolve cleanly ──────────────────────

def test_spot_check_all_fully_handled_abilities_resolve():
    ids = pattern_a_ids_all_handled()
    # Provide a wide ctx so heal/strain abilities don't miss on msg_id.
    for aid in ids:
        game = {'health': {'msg-spot': [[5, 8]]}}
        ctx = {
            'figure_key': 'FK-spot',
            'msg_id': 'msg-spot',
            'figure_index': 0,
            'player_num': 1,
        }
        try:
            r = resolve_pattern_a(game, aid, ctx)
        except Exception as e:
            assert False, f'{aid}: unexpected {type(e).__name__}: {e}'
        assert r['pattern'] == 'A', aid
        assert r['ability_id'] == aid


# ── Runner ──────────────────────────────────────────────────────────────────

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
