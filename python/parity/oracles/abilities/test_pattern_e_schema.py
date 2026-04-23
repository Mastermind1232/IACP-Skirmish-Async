"""Tests for the schema-driven Pattern E chain handler.

Covers the most common ability schema fields:
  - freeMoveBonus + mobileMovement (Lift Off)
  - freeMoveBonus + freeAttackBonus (Leaping Slash)
  - pounceRange + pounceNoAttack (Force Leap)
  - targetHostileFigure (Force Choke-like stamps)
  - fixedAreaEffect (area damage/strain)
  - rollOneDie (reactive die-roll abilities)
  - Fallback stamps pendingPatternE for unrecognized shapes

Run as: python3 -m python.parity.oracles.abilities.test_pattern_e_schema
"""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.abilities.dispatch import install_default_handlers
from python.engine.abilities.pattern_e_schema import handle_schema_chain


install_default_handlers()


def test_free_move_and_mobile_movement():
    """Lift Off: freeMoveBonus=4 + mobileMovement=True."""
    game = {'dcMessageMeta': {}}
    ctx = {'msg_id': 'm1', 'player_num': 1, 'figure_key': 'Dark Trooper-1-0'}
    r = handle_schema_chain(game, 'lift_off_dark_trooper', ctx)
    assert r['applied'] is True
    assert game['movementBank']['m1'] == {'total': 4, 'remaining': 4}
    assert game['mobileMovementActive']['m1'] is True
    kinds = {e['effect'] for e in r['effects']}
    assert 'freeMoveBonus' in kinds and 'mobileMovement' in kinds


def test_free_move_and_free_attack():
    """Leaping Slash: freeMoveBonus=2 + freeAttackBonus=True."""
    game = {}
    ctx = {'msg_id': 'm1', 'player_num': 1}
    r = handle_schema_chain(game, 'leaping_slash', ctx)
    assert game['movementBank']['m1']['total'] == 2
    assert 'm1' in game['freeAttackBonusPending']
    assert game['freeAttackBonusPending']['m1']['from'] == 'Leaping Slash'


def test_pounce_range_stamps_pending():
    """Force Leap: pounceRange=6, pounceNoAttack=True."""
    game = {}
    ctx = {'msg_id': 'm1', 'player_num': 1, 'figure_key': 'Ahsoka-1-0'}
    r = handle_schema_chain(game, 'force_leap_ahsoka', ctx)
    pp = game.get('pendingPounce') or {}
    assert pp.get('range') == 6
    assert pp.get('noAttack') is True
    assert pp.get('figureKey') == 'Ahsoka-1-0'


def test_passive_reactive_falls_back():
    """Twin Sabers (passive-reactive, no schema fields): falls back to
    pendingPatternE stamping rather than returning no-op."""
    game = {}
    ctx = {'figure_key': 'Ahsoka-1-0', 'player_num': 1}
    r = handle_schema_chain(game, 'twin_sabers_ahsoka', ctx)
    assert r['applied'] is True
    assert r['effects'] == []
    assert 'twin_sabers_ahsoka' in (game.get('pendingPatternE') or {})


def test_target_hostile_figure_stamps_pending_when_no_target():
    """Ability with targetHostileFigure dict but no ctx target → stamps
    pendingTargetHostile for UI/AI to resolve later."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    target_aid = None
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'E' and isinstance(entry.get('targetHostileFigure'), dict):
            target_aid = aid
            break
    if not target_aid:
        return

    game = {}
    ctx = {'msg_id': 'm1', 'player_num': 1, 'figure_key': 'Vader-1-0'}
    r = handle_schema_chain(game, target_aid, ctx)
    pth = game.get('pendingTargetHostile') or {}
    assert pth.get('abilityId') == target_aid
    assert 'spec' in pth
    assert {'effect': 'targetHostileFigure'} in r['effects']


def test_target_hostile_figure_resolves_when_target_provided():
    """With target_figure_key + target_player_num + target_msg_id in
    ctx, targetHostileFigure fires its damage immediately instead of
    stamping pending."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    # Find an ability with damage > 0
    target_aid = None
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'E':
            thf = entry.get('targetHostileFigure')
            if isinstance(thf, dict) and int(thf.get('damage') or 0) > 0:
                target_aid = aid
                target_spec = thf
                break
    if not target_aid:
        return

    dmg = int(target_spec.get('damage'))
    game = {
        'dcHealthState': {'tgtmsg': [[10, 10]]},
        'figureConditions': {},
    }
    ctx = {
        'figure_key': 'Vader-1-0',
        'player_num': 1,
        'target_figure_key': 'Luke-1-0',
        'target_player_num': 2,
        'target_msg_id': 'tgtmsg',
    }
    r = handle_schema_chain(game, target_aid, ctx)
    # Damage should have landed
    assert game['dcHealthState']['tgtmsg'][0][0] == 10 - dmg
    # And no pending-target should be stamped
    assert 'pendingTargetHostile' not in game
    # Effect labelled as resolved
    assert any(e.get('effect') == 'targetHostileFigure_resolved'
               for e in r['effects'])


def test_roll_one_die_stamps_pending_when_no_target():
    """Abilities with rollOneDie stamp pendingRollOneDie when no target
    info supplied."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    target_aid = None
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'E' and entry.get('rollOneDie'):
            target_aid = aid
            break
    if not target_aid:
        return

    game = {}
    ctx = {'msg_id': 'm1', 'player_num': 1}
    r = handle_schema_chain(game, target_aid, ctx)
    assert 'pendingRollOneDie' in game
    assert {'effect': 'rollOneDie'} in r['effects']


def test_roll_one_die_resolves_when_target_provided():
    """With target_figure_key + target_player_num + target_msg_id,
    rollOneDie rolls the die and applies damage = hits immediately."""
    import random
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    target_aid = None
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'E' and entry.get('rollOneDie'):
            target_aid = aid
            break
    if not target_aid:
        return

    # Seed RNG so damage is deterministic
    random.seed(12345)
    game = {'dcHealthState': {'tgtmsg': [[10, 10]]}}
    ctx = {
        'figure_key': 'Grenadier-1-0',
        'player_num': 1,
        'msg_id': 'attm',
        'target_figure_key': 'Luke-1-0',
        'target_player_num': 2,
        'target_msg_id': 'tgtmsg',
    }
    r = handle_schema_chain(game, target_aid, ctx)
    # Did not stamp pending
    assert 'pendingRollOneDie' not in game
    # Resolved effect present
    resolved = [e for e in r['effects']
                if e.get('effect') == 'rollOneDie_resolved']
    assert resolved, f'Expected rollOneDie_resolved, got {r["effects"]}'
    # HP may or may not drop depending on roll; at minimum it's ≤ 10
    post_hp = game['dcHealthState']['tgtmsg'][0][0]
    assert 0 <= post_hp <= 10


def test_fixed_area_effect_stamps_pending():
    """Abilities with fixedAreaEffect stamp pendingFixedArea with numeric spec."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    target_aid = None
    for aid, entry in lib.items():
        p, _ = classify_ability(aid, entry)
        if p == 'E' and entry.get('fixedAreaEffect'):
            target_aid = aid
            break
    if not target_aid:
        return

    game = {}
    ctx = {'msg_id': 'm1', 'player_num': 1}
    r = handle_schema_chain(game, target_aid, ctx)
    pfa = game.get('pendingFixedArea') or {}
    assert pfa.get('abilityId') == target_aid
    assert isinstance(pfa.get('range'), int)
    assert isinstance(pfa.get('damage'), int)
    assert {'effect': 'fixedAreaEffect'} in r['effects']


def test_schema_coverage_count():
    """Confirm the schema handler matches ≥ 50% of dcSpecial Pattern E
    abilities (up from 0% in the pending-stamper-only implementation)."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    match = fall = 0
    for aid, entry in lib.items():
        if entry.get('type') != 'dcSpecial':
            continue
        p, _ = classify_ability(aid, entry)
        if p != 'E':
            continue
        r = handle_schema_chain({}, aid, {'msg_id': 'm1', 'player_num': 1})
        if r['effects']:
            match += 1
        else:
            fall += 1
    total = match + fall
    if total == 0:
        return
    ratio = match / total
    assert ratio >= 0.60, (
        f'dcSpecial Pattern E schema match ratio too low: {ratio:.2%} '
        f'({match}/{total})'
    )


def main():
    cases = [
        ('free_move_and_mobile', test_free_move_and_mobile_movement),
        ('free_move_and_attack', test_free_move_and_free_attack),
        ('pounce_range', test_pounce_range_stamps_pending),
        ('passive_fallback', test_passive_reactive_falls_back),
        ('target_hostile_no_target', test_target_hostile_figure_stamps_pending_when_no_target),
        ('target_hostile_resolves', test_target_hostile_figure_resolves_when_target_provided),
        ('roll_one_die_no_target', test_roll_one_die_stamps_pending_when_no_target),
        ('roll_one_die_resolves', test_roll_one_die_resolves_when_target_provided),
        ('fixed_area_effect', test_fixed_area_effect_stamps_pending),
        ('coverage_count', test_schema_coverage_count),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} green')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
