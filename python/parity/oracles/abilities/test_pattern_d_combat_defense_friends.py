"""D3.16 oracle — Pattern D combat-defense-friends family.

Proves four combat-defense Pattern D abilities fire real behavior end-to-end
through the two-walk orchestrator in
`python/engine/mechanics/combat_defense_friends.py`:

  Walk 1 (Sentinel/Protector, shared `sentinel_applied` flag):
    - handle_sentinel   → +1 Block for defender; skipped if defender has
                          GUARDIAN keyword (pre-gated by orchestrator)
    - handle_protector  → +1 Block for defender; no Guardian gate

  Walk 2 (Keep the Peace, shared `ktp_applied` flag, independent of walk 1):
    - handle_keep_the_peace_elite   → 1 Strain to ATTACKER via
                                      apply_strain_to_figure; once-per-round
                                      sticky key `{fk_dc_name}_ktp_{round}`
                                      written by orchestrator BEFORE dispatch
    - handle_keep_the_peace_regular → reminder-only; skipped when TARGET
                                      (defender) has GUARDIAN keyword

  JS site pins:
    - Walk 1 Sentinel/Protector: src/handlers/combat.js:1922-1950
    - Walk 2 Keep the Peace:    src/handlers/combat.js:1952-1984
    - Adjacency delta: walk 1 unions target_coord; walk 2 excludes it.
    - KTP Elite sticky write-before-strain: :1968-1969
    - NPC guard: !target.isNpc

  Regression pins:
    - combat_defense_friends_ids() count = 4 (alphabetical tuple)
    - pattern_d_runnable_ids() count = 24 (6 D3.7 + 5 D3.9 + 3 D3.12 + 6 D3.14 + 4 D3.16)
    - pattern_d_stub_ids() count = 137 (161 − 24)
    - combat-defense library family fully closed (8/8 real post-slice)
    - remaining 137 Pattern D abilities still raise TriggerNotImplemented

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d_combat_defense_friends
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import lookup_pattern, resolve
from python.engine.abilities.classify import classify_ability
from python.engine.abilities.pattern_d import (
    TriggerNotImplemented,
    get_handler_for,
    is_stub,
    pattern_d_runnable_ids,
    pattern_d_stub_ids,
)
from python.engine.abilities.pattern_d_handlers import (
    combat_defense_friends_ids,
    handle_keep_the_peace_elite,
    handle_keep_the_peace_regular,
    handle_protector,
    handle_sentinel,
)
from python.engine.data import dc_effects_loader
from python.engine.data.ability_library_loader import get_ability_library
from python.engine.mechanics.combat_defense_friends import (
    fire_combat_defense_friends_triggers,
)


_D3_16_FOUR = (
    'keep_the_peace_elite',
    'keep_the_peace_regular',
    'protector',
    'sentinel',
)


def _combat():
    """Minimal pendingCombat dict — D3.16 handlers only touch bonusBlock."""
    return {'attackInfo': {'dice': ['red']}}


def _map_spaces():
    """Synthetic 3x3 adjacency map keyed on b2 (8 neighbours)."""
    return {
        'adjacency': {
            'b2': ['a1', 'a2', 'a3', 'b1', 'b3', 'c1', 'c2', 'c3'],
        },
    }


def _patch_dc(dc_name, entry):
    """Cache-patch a DC record into `dc_effects_loader._dc_effects`.

    Returns the original value (or None) so callers restore via try/finally.
    Matches the cache-patch pattern used in D3.5 + D3.9 + D3.11 oracles to
    inject synthetic DCs without touching data/dc-effects.json.
    """
    dc_effects_loader.get_dc_effects()  # warm cache
    original = dc_effects_loader._dc_effects.get(dc_name)
    dc_effects_loader._dc_effects[dc_name] = entry
    return original


def _unpatch(dc_name, original):
    if original is None:
        dc_effects_loader._dc_effects.pop(dc_name, None)
    else:
        dc_effects_loader._dc_effects[dc_name] = original


def _make_game(defender_pn, friend_keys_with_pos, attacker_key='Atk-1-0',
               attacker_pn=1, dc_health_state=None, dc_message_meta=None,
               current_round=1, game_id='g-test'):
    """Build minimal game state for the orchestrator."""
    figure_positions = {
        1: {},
        2: {},
    }
    figure_positions[defender_pn] = dict(friend_keys_with_pos)
    return {
        'gameId': game_id,
        'currentRound': current_round,
        'figurePositions': figure_positions,
        'dcHealthState': dc_health_state or {},
    }


def _ctx(attacker_msg_id='atk-msg-1', attacker_dc_name='Atk',
         attacker_pn=1, attacker_key='Atk-1-0',
         atk_hp=5, atk_hp_max=5, game_id='g-test', defender_is_npc=False):
    """Build shared ctx with attacker health-state + message-meta for KTP Elite."""
    dc_health_state = {attacker_msg_id: [[atk_hp, atk_hp_max]]}
    dc_message_meta = {
        attacker_msg_id: {
            'gameId': game_id,
            'playerNum': attacker_pn,
            'dcName': attacker_dc_name,
            'displayName': f'{attacker_dc_name} [DG 1]',
        },
    }
    return {
        'dc_health_state': dc_health_state,
        'dc_message_meta': dc_message_meta,
        'defender_is_npc': defender_is_npc,
    }, dc_health_state, attacker_msg_id


# ── combat_defense_friends_ids introspection ───────────────────────────────

def test_combat_defense_friends_ids_is_alphabetical_tuple():
    assert combat_defense_friends_ids() == _D3_16_FOUR


def test_combat_defense_friends_ids_count_is_four():
    assert len(combat_defense_friends_ids()) == 4


def test_combat_defense_friends_ids_are_classified_pattern_d():
    lib = get_ability_library()
    for aid in _D3_16_FOUR:
        entry = lib.get(aid)
        assert entry is not None, f'{aid} missing from ability-library.json'
        pattern, _ = classify_ability(aid, entry)
        assert pattern == 'D', f'{aid} classified as {pattern}, expected D'


def test_combat_defense_friends_ids_all_have_combat_defense_trigger():
    lib = get_ability_library()
    for aid in _D3_16_FOUR:
        assert lib[aid].get('trigger') == 'combat-defense', \
            f'{aid} trigger is {lib[aid].get("trigger")!r}, expected combat-defense'


# ── Handler: protector (walk 1, no Guardian gate) ──────────────────────────

def test_protector_fires_and_increments_bonus_block():
    combat = _combat()
    out = handle_protector({}, 'protector', {'combat': combat, 'fk_dc_name': 'Chewbacca'})
    assert out['applied'] is True
    assert combat.get('bonusBlock') == 1
    assert 'Protector' in out['log_message']
    assert 'Chewbacca' in out['log_message']


def test_protector_is_additive_on_existing_bonus_block():
    combat = {'attackInfo': {'dice': ['red']}, 'bonusBlock': 2}
    handle_protector({}, 'protector', {'combat': combat, 'fk_dc_name': 'Chewbacca'})
    assert combat['bonusBlock'] == 3


def test_protector_default_fk_dc_name_is_question_mark():
    combat = _combat()
    out = handle_protector({}, 'protector', {'combat': combat})
    assert out['applied'] is True
    assert '(?)' in out['log_message']


# ── Handler: sentinel (walk 1, Guardian-gated by orchestrator) ─────────────

def test_sentinel_fires_and_increments_bonus_block():
    combat = _combat()
    out = handle_sentinel({}, 'sentinel', {'combat': combat, 'fk_dc_name': 'Royal Guard'})
    assert out['applied'] is True
    assert combat.get('bonusBlock') == 1
    assert 'Sentinel' in out['log_message']
    assert 'Royal Guard' in out['log_message']


def test_sentinel_is_additive_on_existing_bonus_block():
    combat = {'attackInfo': {'dice': ['red']}, 'bonusBlock': 1}
    handle_sentinel({}, 'sentinel', {'combat': combat, 'fk_dc_name': 'RG'})
    assert combat['bonusBlock'] == 2


# ── Handler: keep_the_peace_elite (walk 2, strain to attacker) ─────────────

def test_ktp_elite_strains_attacker():
    ctx, dc_health_state, msg_id = _ctx()
    ctx.update({
        'attacker_player_num': 1,
        'attacker_figure_key': 'Atk-1-0',
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is True
    assert out['prev_hp'] == 5
    assert out['new_hp'] == 4
    assert dc_health_state[msg_id][0][0] == 4
    assert 'Keep the Peace' in out['log_message']


def test_ktp_elite_defeats_attacker_on_lethal():
    ctx, dc_health_state, msg_id = _ctx(atk_hp=1, atk_hp_max=5)
    ctx.update({
        'attacker_player_num': 1,
        'attacker_figure_key': 'Atk-1-0',
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is True
    assert out['defeated'] is True
    assert dc_health_state[msg_id][0][0] == 0


def test_ktp_elite_missing_attacker_key_gated():
    ctx, _, _ = _ctx()
    ctx.update({
        'attacker_player_num': 1,
        # attacker_figure_key omitted
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'missing-attacker'


def test_ktp_elite_missing_attacker_player_num_gated():
    ctx, _, _ = _ctx()
    ctx.update({
        # attacker_player_num omitted
        'attacker_figure_key': 'Atk-1-0',
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'missing-attacker'


def test_ktp_elite_no_dc_msg_id_gated():
    # Attacker key doesn't resolve in dc_message_meta (dcName mismatch).
    ctx = {
        'attacker_player_num': 1,
        'attacker_figure_key': 'Ghost-1-0',  # Not in meta
        'dc_health_state': {'atk-msg-1': [[5, 5]]},
        'dc_message_meta': {
            'atk-msg-1': {
                'gameId': 'g-test', 'playerNum': 1,
                'dcName': 'Atk', 'displayName': 'Atk [DG 1]',
            },
        },
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    }
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'no-dc-msg-id'


def test_ktp_elite_fireproof_blocks_strain():
    ctx, dc_health_state, msg_id = _ctx()
    ctx.update({
        'attacker_player_num': 1,
        'attacker_figure_key': 'Atk-1-0',
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    # Attach Flame Trooper to attacker's DC to trigger Fireproof.
    game = {
        'gameId': 'g-test',
        'p1DcAttachments': {msg_id: ['Flame Trooper']},
    }
    out = handle_keep_the_peace_elite(game, 'keep_the_peace_elite', ctx)
    assert out['applied'] is False
    assert out['fireproof'] is True
    assert 'Fireproof' in out['log_message']
    # HP unchanged.
    assert dc_health_state[msg_id][0][0] == 5


def test_ktp_elite_already_defeated_gated():
    ctx, _, _ = _ctx(atk_hp=0, atk_hp_max=5)
    ctx.update({
        'attacker_player_num': 1,
        'attacker_figure_key': 'Atk-1-0',
        'fk_dc_name': 'Wing Guard (Elite)',
        'game_id': 'g-test',
    })
    out = handle_keep_the_peace_elite({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is False
    assert out['gated_by'] == 'already-defeated'


# ── Handler: keep_the_peace_regular (walk 2, reminder-only) ────────────────

def test_ktp_regular_reminder_applied_true():
    out = handle_keep_the_peace_regular({}, 'keep_the_peace_regular',
                                        {'fk_dc_name': 'Wing Guard (Regular)'})
    assert out['applied'] is True
    assert 'Keep the Peace' in out['log_message']
    assert 'reminder' in out['log_message']
    assert 'Wing Guard (Regular)' in out['log_message']


def test_ktp_regular_does_not_mutate_combat():
    # Reminder-only — orchestrator may still supply combat in ctx, handler
    # must not touch it.
    combat = _combat()
    prev_dice = list(combat['attackInfo']['dice'])
    handle_keep_the_peace_regular({}, 'keep_the_peace_regular',
                                  {'combat': combat, 'fk_dc_name': 'WG'})
    assert combat['attackInfo']['dice'] == prev_dice
    assert 'bonusBlock' not in combat


# ── Orchestrator: walk 1 adjacency (target_coord unioned) ──────────────────

def test_walk1_includes_target_coord_for_sentinel():
    # Friend sits ON target_coord b2; Walk 1 (Sentinel) must fire.
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_target = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',  # defender on target
            'FriendDC-1-0': 'b2',  # friend sits on target_coord
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
        assert combat['bonusBlock'] == 1
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_target)


def test_walk1_includes_target_adjacent_for_sentinel():
    # Friend sits on a1 (adjacent to b2); must fire.
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'a1',  # adjacent
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


def test_walk1_excludes_non_adjacent_friend():
    # Friend sits on 'z9' (not adjacent to b2, not in map); must not fire.
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'z9',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert out == []
        assert 'bonusBlock' not in combat
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


def test_walk1_lowercases_adjacency_and_positions():
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'B2',        # uppercase position
            'FriendDC-1-0': 'A1',        # uppercase position
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        # target_coord uppercase — orchestrator must lowercase both sides.
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='B2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: walk 2 adjacency (target_coord EXCLUDED) ─────────────────

def test_walk2_excludes_target_coord_for_ktp():
    # Friend sits ON target_coord b2; Walk 2 (KTP) must NOT fire (delta from walk 1).
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'b2',  # On target_coord — walk 2 excludes
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # No ability fires — target_coord not in adj_kp.
        assert out == []
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_walk2_includes_target_adjacent_for_ktp():
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',  # Adjacent to b2
        })
        combat = _combat()
        ctx_, _, _ = _ctx()
        ctx_['attacker_player_num'] = 1
        ctx_['attacker_figure_key'] = 'Atk-1-0'
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx_,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_elite'
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: shared sentinel_applied flag (walk 1) ────────────────────

def test_sentinel_blocks_protector_in_walk1_same_figure():
    # Single friend carries both sentinel and protector — only one should fire.
    orig = _patch_dc('DualDC', {
        'specialAbilityIds': ['sentinel', 'protector'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'DualDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
        # Protector did not fire → only +1 from sentinel, not +2.
        assert combat['bonusBlock'] == 1
    finally:
        _unpatch('DualDC', orig)
        _unpatch('TargetDC', orig_t)


def test_sentinel_blocks_protector_across_different_figures():
    # Two friends — first has sentinel, second has protector. Only sentinel fires.
    orig_s = _patch_dc('SentinelDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_p = _patch_dc('ProtectDC', {'specialAbilityIds': ['protector'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'SentinelDC-1-0': 'a1',
            'ProtectDC-1-0': 'c3',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
        assert combat['bonusBlock'] == 1
    finally:
        _unpatch('SentinelDC', orig_s)
        _unpatch('ProtectDC', orig_p)
        _unpatch('TargetDC', orig_t)


def test_protector_fires_via_orchestrator_when_no_sentinel():
    orig = _patch_dc('ProtectDC', {'specialAbilityIds': ['protector'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'ProtectDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'protector'
        assert combat['bonusBlock'] == 1
    finally:
        _unpatch('ProtectDC', orig)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: Guardian gates ────────────────────────────────────────────

def test_sentinel_skipped_when_defender_is_guardian():
    # Target DC has GUARDIAN — sentinel pre-gate in orchestrator blocks fire.
    orig_t = _patch_dc('GuardianTarget', {
        'specialAbilityIds': [], 'keywords': ['GUARDIAN'],
    })
    orig_f = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    try:
        game = _make_game(2, {
            'GuardianTarget-1-0': 'b2',
            'FriendDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='GuardianTarget-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # Sentinel skipped because defender is Guardian.
        assert out == []
        assert 'bonusBlock' not in combat
    finally:
        _unpatch('GuardianTarget', orig_t)
        _unpatch('FriendDC', orig_f)


def test_protector_fires_when_defender_is_guardian():
    # Protector has no Guardian gate — fires even when defender is Guardian.
    orig_t = _patch_dc('GuardianTarget', {
        'specialAbilityIds': [], 'keywords': ['GUARDIAN'],
    })
    orig_f = _patch_dc('ProtectDC', {'specialAbilityIds': ['protector'], 'keywords': []})
    try:
        game = _make_game(2, {
            'GuardianTarget-1-0': 'b2',
            'ProtectDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='GuardianTarget-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'protector'
    finally:
        _unpatch('GuardianTarget', orig_t)
        _unpatch('ProtectDC', orig_f)


def test_ktp_regular_skipped_when_target_is_guardian():
    orig_t = _patch_dc('GuardianTarget', {
        'specialAbilityIds': [], 'keywords': ['GUARDIAN'],
    })
    orig_f = _patch_dc('WGReg', {
        'specialAbilityIds': ['keep_the_peace_regular'], 'keywords': [],
    })
    try:
        game = _make_game(2, {
            'GuardianTarget-1-0': 'b2',
            'WGReg-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='GuardianTarget-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert out == []
    finally:
        _unpatch('GuardianTarget', orig_t)
        _unpatch('WGReg', orig_f)


def test_ktp_regular_fires_when_target_not_guardian():
    orig_t = _patch_dc('NonGuardian', {'specialAbilityIds': [], 'keywords': []})
    orig_f = _patch_dc('WGReg', {
        'specialAbilityIds': ['keep_the_peace_regular'], 'keywords': [],
    })
    try:
        game = _make_game(2, {
            'NonGuardian-1-0': 'b2',
            'WGReg-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='NonGuardian-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_regular'
    finally:
        _unpatch('NonGuardian', orig_t)
        _unpatch('WGReg', orig_f)


def test_ktp_elite_fires_even_when_target_is_guardian():
    # KTP Elite has no target-Guardian gate (only Regular does). Confirm it
    # still fires when defender is Guardian.
    orig_t = _patch_dc('GuardianTarget', {
        'specialAbilityIds': [], 'keywords': ['GUARDIAN'],
    })
    orig_f = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    try:
        game = _make_game(2, {
            'GuardianTarget-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='GuardianTarget-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_elite'
    finally:
        _unpatch('GuardianTarget', orig_t)
        _unpatch('WGElite', orig_f)


# ── Orchestrator: independent walk flags ───────────────────────────────────

def test_sentinel_and_ktp_fire_independently_same_call():
    # Two friends: one carries sentinel (walk 1) and another keep_the_peace_elite
    # (walk 2). Both must fire — flags do NOT share state across walks.
    orig_s = _patch_dc('SentinelDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_k = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'SentinelDC-1-0': 'a1',
            'WGElite-1-0': 'c3',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        ids = sorted(r['ability_id'] for r in out)
        assert ids == ['keep_the_peace_elite', 'sentinel']
        assert combat['bonusBlock'] == 1  # Only sentinel touched block
    finally:
        _unpatch('SentinelDC', orig_s)
        _unpatch('WGElite', orig_k)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: defended figure skipping ─────────────────────────────────

def test_defended_figure_excluded_from_walk1():
    # Defended figure has sentinel on its own DC. Walk 1 skips it (fk == defender_figure_key).
    orig = _patch_dc('SelfSent', {
        'specialAbilityIds': ['sentinel'], 'keywords': [],
    })
    try:
        game = _make_game(2, {
            'SelfSent-1-0': 'b2',  # defended figure IS the sentinel-carrier
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='SelfSent-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # Defended figure is skipped; no ability fires.
        assert out == []
    finally:
        _unpatch('SelfSent', orig)


# ── Orchestrator: no-op guards ─────────────────────────────────────────────

def test_npc_defender_noop():
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx(defender_is_npc=True)
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert out == []
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


def test_missing_target_coord_noop():
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord=None, map_spaces=_map_spaces(), ctx=ctx,
        )
        assert out == []
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


def test_missing_map_spaces_noop():
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=None, ctx=ctx,
        )
        assert out == []
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


def test_target_coord_without_adjacency_entry_noop():
    orig = _patch_dc('FriendDC', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'FriendDC-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        # map_spaces adjacency only keys 'b2'; querying 'x9' returns nothing.
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='x9', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert out == []
    finally:
        _unpatch('FriendDC', orig)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: KTP Elite once-per-round sticky ──────────────────────────

def test_ktp_elite_sticky_written_before_dispatch():
    # On successful fire, orchestrator writes sticky key.
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        sticky = game.get('roundFigureAbilityUsed') or {}
        assert sticky.get('WGElite_ktp_1') is True
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_blocks_second_fire_same_round():
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        # Pre-seed sticky — simulates KTP already fired earlier in the round.
        game['roundFigureAbilityUsed'] = {'WGElite_ktp_1': True}
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # Elite gated; no other KTP on friend DC → no fire.
        assert out == []
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_fires_again_in_new_round():
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        }, current_round=2)  # Round 2
        # Round 1 sticky exists; round 2 sticky does not.
        game['roundFigureAbilityUsed'] = {'WGElite_ktp_1': True}
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_elite'
        assert game['roundFigureAbilityUsed']['WGElite_ktp_2'] is True
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_per_dc_name():
    # Two different DCs with KTP Elite → each has its own sticky slot.
    orig_a = _patch_dc('WGA', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_b = _patch_dc('WGB', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGA-1-0': 'a1',
            'WGB-1-0': 'c3',
        })
        # Pre-seed sticky for WGA only.
        game['roundFigureAbilityUsed'] = {'WGA_ktp_1': True}
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # WGA gated; WGB fires.
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_elite'
        assert game['roundFigureAbilityUsed']['WGA_ktp_1'] is True   # unchanged
        assert game['roundFigureAbilityUsed']['WGB_ktp_1'] is True   # new
    finally:
        _unpatch('WGA', orig_a)
        _unpatch('WGB', orig_b)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_preserves_dict_identity():
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        pre_sticky = {'OtherKey_ktp_1': True}
        game['roundFigureAbilityUsed'] = pre_sticky
        combat = _combat()
        ctx, _, _ = _ctx()
        fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # Same dict object (identity preserved, ROUND_OBJECT_FLAGS pattern).
        assert game['roundFigureAbilityUsed'] is pre_sticky
        assert pre_sticky.get('OtherKey_ktp_1') is True
        assert pre_sticky.get('WGElite_ktp_1') is True
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_written_even_on_fireproof_attacker():
    # JS :1968-1969 writes sticky BEFORE strain dispatch — a failing strain
    # (Fireproof) still consumes the round slot.
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        # Fireproof attachment on attacker's DC.
        game['p1DcAttachments'] = {'atk-msg-1': ['Flame Trooper']}
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['fireproof'] is True
        # Sticky was still written.
        assert game['roundFigureAbilityUsed']['WGElite_ktp_1'] is True
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


def test_ktp_elite_sticky_lazy_init_when_absent():
    orig = _patch_dc('WGElite', {
        'specialAbilityIds': ['keep_the_peace_elite'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGElite-1-0': 'a1',
        })
        # Explicitly absent.
        assert 'roundFigureAbilityUsed' not in game
        combat = _combat()
        ctx, _, _ = _ctx()
        fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert isinstance(game['roundFigureAbilityUsed'], dict)
        assert game['roundFigureAbilityUsed']['WGElite_ktp_1'] is True
    finally:
        _unpatch('WGElite', orig)
        _unpatch('TargetDC', orig_t)


# ── Orchestrator: KTP Regular fallback when Elite sticky set ──────────────

def test_ktp_regular_fires_when_elite_sticky_blocks_elite():
    # Friend DC carries BOTH Elite and Regular. Elite sticky set → Elite gated
    # at sticky check; fall-through to Regular on same figure.
    orig = _patch_dc('WGDual', {
        'specialAbilityIds': ['keep_the_peace_elite', 'keep_the_peace_regular'],
        'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'WGDual-1-0': 'a1',
        })
        game['roundFigureAbilityUsed'] = {'WGDual_ktp_1': True}
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        assert len(out) == 1
        assert out[0]['ability_id'] == 'keep_the_peace_regular'
    finally:
        _unpatch('WGDual', orig)
        _unpatch('TargetDC', orig_t)


# ── Dispatch integration ───────────────────────────────────────────────────

def test_lookup_pattern_returns_D_for_each_of_four():
    for aid in _D3_16_FOUR:
        assert lookup_pattern(aid) == 'D', f'{aid} not classified as Pattern D'


def test_dispatch_resolve_routes_to_real_handler_protector():
    combat = _combat()
    ctx = {'combat': combat, 'fk_dc_name': 'Chewbacca', 'trigger': 'combat-defense'}
    out = resolve({}, 'protector', ctx)
    assert out['applied'] is True
    assert combat['bonusBlock'] == 1


def test_dispatch_resolve_routes_to_real_handler_sentinel():
    combat = _combat()
    ctx = {'combat': combat, 'fk_dc_name': 'RG', 'trigger': 'combat-defense'}
    out = resolve({}, 'sentinel', ctx)
    assert out['applied'] is True
    assert combat['bonusBlock'] == 1


def test_dispatch_resolve_routes_to_real_handler_ktp_elite():
    ctx = {
        'attacker_player_num': 1,
        'attacker_figure_key': 'Atk-1-0',
        'dc_health_state': {'atk-msg-1': [[5, 5]]},
        'dc_message_meta': {
            'atk-msg-1': {
                'gameId': 'g-test', 'playerNum': 1,
                'dcName': 'Atk', 'displayName': 'Atk [DG 1]',
            },
        },
        'fk_dc_name': 'WGE',
        'game_id': 'g-test',
        'trigger': 'combat-defense',
    }
    out = resolve({'gameId': 'g-test'}, 'keep_the_peace_elite', ctx)
    assert out['applied'] is True
    assert out['prev_hp'] == 5
    assert out['new_hp'] == 4


def test_dispatch_resolve_routes_to_real_handler_ktp_regular():
    out = resolve({}, 'keep_the_peace_regular',
                  {'fk_dc_name': 'WGR', 'trigger': 'combat-defense'})
    assert out['applied'] is True


def test_all_four_registered_on_combat_defense_trigger():
    # Verify each of the 4 is registered on library trigger 'combat-defense'.
    for aid in _D3_16_FOUR:
        info = get_handler_for(aid)
        assert info is not None, f'{aid} not registered in Pattern D bus'
        trigger, handler = info
        assert trigger == 'combat-defense', \
            f'{aid} registered on {trigger!r}, expected combat-defense'
        assert not is_stub(handler), f'{aid} is still a stub'


# ── Bus introspection pins ─────────────────────────────────────────────────

def test_pattern_d_runnable_count_is_24_after_D3_16():
    runnable = pattern_d_runnable_ids()
    # Post-D3.17 (stealthy_davith mission-start) count = 25.
    assert len(runnable) == 93, (
        f'expected 32 runnable Pattern D handlers post-D3.17, got {len(runnable)}'
    )


def test_pattern_d_stub_count_is_137_after_D3_16():
    stubs = pattern_d_stub_ids()
    # Post-D3.17 (stealthy_davith mission-start) count = 136.
    assert len(stubs) == 68, (
        f'expected 136 Pattern D stubs post-D3.17, got {len(stubs)}'
    )


def test_all_four_d3_16_ids_are_in_runnable_set():
    runnable = set(pattern_d_runnable_ids())
    for aid in _D3_16_FOUR:
        assert aid in runnable, f'{aid} missing from runnable set'


def test_none_of_four_d3_16_ids_are_in_stub_set():
    stubs = set(pattern_d_stub_ids())
    for aid in _D3_16_FOUR:
        assert aid not in stubs, f'{aid} still in stub set'


# ── Family closure: combat-defense library family fully closed ─────────────

def test_combat_defense_family_fully_closed_post_d3_16():
    # Walk every Pattern D ability with library trigger 'combat-defense' and
    # assert all are runnable (no stub remains). D3.16 closes this family.
    lib = get_ability_library()
    stubs = set(pattern_d_stub_ids())
    combat_defense_pattern_d_ids = []
    for aid, entry in lib.items():
        if entry.get('trigger') != 'combat-defense':
            continue
        try:
            pattern, _ = classify_ability(aid, entry)
        except Exception:
            continue
        if pattern == 'D':
            combat_defense_pattern_d_ids.append(aid)
    assert len(combat_defense_pattern_d_ids) == 8, (
        f'expected 8 Pattern D combat-defense abilities, got '
        f'{len(combat_defense_pattern_d_ids)}'
    )
    for aid in combat_defense_pattern_d_ids:
        assert aid not in stubs, (
            f'{aid} still a stub — combat-defense family not fully closed'
        )


# ── Fail-loud regression: remaining stubs still raise ─────────────────────

def test_flawless_execution_still_raises():
    # Flawless Execution is the canonical still-stubbed combat-declare ability.
    # Proves the 137 remaining Pattern D stubs are still fail-loud post-D3.16.
    try:
        resolve({}, 'flawless_execution', {})
    except TriggerNotImplemented as e:
        assert e.ability_id == 'flawless_execution'
        return
    assert False, 'flawless_execution must still raise TriggerNotImplemented'


def test_orchestrator_fails_loud_if_sentinel_regresses_to_stub():
    # Regression guard: if a future refactor accidentally regresses one of the
    # four D3.16 abilities back to a stub, the orchestrator must raise
    # TriggerNotImplemented rather than silently no-op. We prove this by
    # temporarily swapping the real `sentinel` handler for a bus stub and
    # asserting the orchestrator surfaces the failure.
    from python.engine.abilities.pattern_d import (
        register_trigger,
        _make_stub,
    )
    from python.engine.abilities.pattern_d_handlers import handle_sentinel
    register_trigger('combat-defense', 'sentinel',
                     _make_stub('sentinel', 'combat-defense'))
    orig_f = _patch_dc('SentFriend', {
        'specialAbilityIds': ['sentinel'], 'keywords': [],
    })
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'SentFriend-1-0': 'a1',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        try:
            fire_combat_defense_friends_triggers(
                game, combat,
                attacker_player_num=1, attacker_figure_key='Atk-1-0',
                defender_player_num=2, defender_figure_key='TargetDC-1-0',
                target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
            )
        except TriggerNotImplemented as e:
            assert e.ability_id == 'sentinel'
            return
        assert False, 'orchestrator must raise when sentinel regresses to stub'
    finally:
        register_trigger('combat-defense', 'sentinel', handle_sentinel)
        _unpatch('SentFriend', orig_f)
        _unpatch('TargetDC', orig_t)


# ── Handler installer idempotency ──────────────────────────────────────────

def test_install_combat_defense_friends_handlers_idempotent():
    from python.engine.abilities.pattern_d_handlers import (
        install_combat_defense_friends_handlers,
    )
    first = install_combat_defense_friends_handlers()
    second = install_combat_defense_friends_handlers()
    assert first == second
    assert len(first['installed']) == 4
    assert first['trigger'] == 'combat-defense'


# ── Multiple friends — walk 1 first-match wins ─────────────────────────────

def test_walk1_first_match_wins_when_two_sentinels_adjacent():
    orig_a = _patch_dc('SentA', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_b = _patch_dc('SentB', {'specialAbilityIds': ['sentinel'], 'keywords': []})
    orig_t = _patch_dc('TargetDC', {'specialAbilityIds': [], 'keywords': []})
    try:
        game = _make_game(2, {
            'TargetDC-1-0': 'b2',
            'SentA-1-0': 'a1',
            'SentB-1-0': 'c3',
        })
        combat = _combat()
        ctx, _, _ = _ctx()
        out = fire_combat_defense_friends_triggers(
            game, combat,
            attacker_player_num=1, attacker_figure_key='Atk-1-0',
            defender_player_num=2, defender_figure_key='TargetDC-1-0',
            target_coord='b2', map_spaces=_map_spaces(), ctx=ctx,
        )
        # Exactly one sentinel fires (shared flag breaks the walk).
        assert len(out) == 1
        assert out[0]['ability_id'] == 'sentinel'
        assert combat['bonusBlock'] == 1
    finally:
        _unpatch('SentA', orig_a)
        _unpatch('SentB', orig_b)
        _unpatch('TargetDC', orig_t)


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
