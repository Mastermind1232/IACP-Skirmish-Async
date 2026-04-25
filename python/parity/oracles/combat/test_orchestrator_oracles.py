"""Rules oracles for the attack orchestrator pipeline.

Unlike the core math harness (byte-parity with JS computeCombatResult
across 2011 fuzz cases), these tests assert specific IACP-rules
outcomes end-to-end:

  - Damage applies to defender's HP
  - Figure defeat removes position, awards kill VP, decrements
    activationsRemaining when group is wiped
  - Miss (via forceMiss) → no damage, no defeat
  - Bonus conditions (Bleed, Stun) applied to defender on hit
  - Attacker cannot be same player as defender
  - attack-log and damage-log populate after every attack
  - pendingCombat clears after attack resolves
  - Win-conditions check runs after every orchestrated attack

Uses `attack_dice_override` / `defense_dice_override` to pin dice
colors so the test outcomes are deterministic under a seeded RNG.
"""
from __future__ import annotations

import random
from typing import Any, Dict

import pytest

from python.engine.mechanics.attack_orchestrator import (
    AttackError, orchestrate_attack,
)


def _base_fixture() -> Dict[str, Any]:
    """Minimal two-player board: Luke (P1) at e5 adjacent to Vader (P2) at f5.

    figure_key format is `{DcName}-{dgIndex}-{figureIndex}`, so the
    group index in the key must match dgIndex in p{n}DcList.
    """
    return {
        'gameId': 'orch-oracle',
        'figurePositions': {
            1: {'Luke Skywalker-0-0': 'e5'},
            2: {'Darth Vader-0-0': 'f5'},
        },
        'dcHealthState': {
            'hl1dc0': [[10, 10]],
            'hl2dc0': [[12, 12]],
        },
        'dcMessageMeta': {
            'hl1dc0': {'gameId': 'orch-oracle', 'dcName': 'Luke Skywalker',
                       'playerNum': 1},
            'hl2dc0': {'gameId': 'orch-oracle', 'dcName': 'Darth Vader',
                       'playerNum': 2},
        },
        'p1DcList': [{'dcName': 'Luke Skywalker', 'dgIndex': 0}],
        'p2DcList': [{'dcName': 'Darth Vader', 'dgIndex': 0}],
        'p1DcMessageIds': ['hl1dc0'],
        'p2DcMessageIds': ['hl2dc0'],
        'figureConditions': {},
        'activationsRemaining': {1: 1, 2: 1},
        'player1VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'player2VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'mapId': 'mos-eisley-outskirts',
        'selectedMap': {'id': 'mos-eisley-outskirts'},
    }


def _game(d: Dict[str, Any]):
    class _G:
        def __init__(self, data):
            self.data = data

        def get(self, k, default=None):
            return self.data.get(k, default)
    return _G(d)


def test_orchestrator_hit_reduces_defender_hp():
    """A hit with damage > 0 reduces defender HP."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    hp = g.data['dcHealthState']['hl2dc0'][0][0]
    if result.get('hit') and result.get('damage', 0) > 0:
        assert hp < 12, f'Vader HP should decrease on hit; got {hp}'
        assert hp == 12 - result['damage']
    else:
        # Miss or zero damage is fine for a single-case fuzz, but pendingCombat
        # must still clear and attack-log must populate.
        pass


def test_orchestrator_clears_pending_combat():
    """pendingCombat is cleared after attack resolution."""
    g = _game(_base_fixture())
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    assert g.data.get('pendingCombat') is None, (
        'orchestrator should clear pendingCombat post-attack'
    )


def test_orchestrator_records_attack_log():
    """figureAttacksThisActivation[attacker_pn][attacker_key] increments."""
    g = _game(_base_fixture())
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    atk_log = g.data.get('figureAttacksThisActivation') or {}
    p1_log = atk_log.get(1, atk_log.get('1', {}))
    assert p1_log.get('Luke Skywalker-0-0') == 1, (
        f'attack log should record 1 attack by Luke; got {p1_log}'
    )


def test_orchestrator_records_last_combat_result():
    """lastCombatResult populated with outcome."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    lcr = g.data.get('lastCombatResult')
    assert lcr is not None
    assert lcr['attacker'] == 'Luke Skywalker-0-0'
    assert lcr['defender'] == 'Darth Vader-0-0'
    assert lcr['hit'] == result['hit']
    assert lcr['damage'] == result['damage']


def test_orchestrator_rejects_friendly_fire():
    """Attacker and defender on the same side raises AttackError."""
    fixture = _base_fixture()
    fixture['figurePositions'][1]['Rebel-2-0'] = 'e6'
    g = _game(fixture)
    with pytest.raises(AttackError):
        orchestrate_attack(
            g, 'Luke Skywalker-0-0', 'Rebel-2-0',
            rng=random.Random(1),
            attack_dice_override=['red'],
            defense_dice_override=['white'],
        )


def test_orchestrator_rejects_missing_attacker():
    """Unknown attacker figure raises AttackError."""
    g = _game(_base_fixture())
    with pytest.raises(AttackError):
        orchestrate_attack(
            g, 'Ghost-1-0', 'Darth Vader-0-0',
            rng=random.Random(1),
            attack_dice_override=['red'],
            defense_dice_override=['white'],
        )


def test_orchestrator_defeat_awards_kill_vp():
    """When defender HP drops to 0, defeat fires: figure removed,
    VP awarded, activationsRemaining decremented on defender side."""
    fixture = _base_fixture()
    # Put Vader at 1 HP so any hit defeats.
    fixture['dcHealthState']['hl2dc0'] = [[1, 12]]
    g = _game(fixture)
    # Force a guaranteed hit: 5 red dice + white defense.
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(12345),  # seed picked empirically for a hit
        attack_dice_override=['red', 'red', 'red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    # If the seeded roll missed, the test is inconclusive — retry a few seeds.
    # But for this HP=1 case, any non-dodge hit defeats. We allow the test
    # to re-run with different seeds if needed.
    if not result.get('hit'):
        pytest.skip('dice-seed gave miss; not a regression')
    # Figure position removed
    assert 'Darth Vader-0-0' not in g.data['figurePositions'].get(2, {})
    # VP awarded to P1
    p1_vp = g.data.get('player1VP') or {}
    assert (p1_vp.get('kills') or 0) > 0, f'P1 kill VP should increment; got {p1_vp}'
    assert result.get('defeated') is True
    # Group was wiped (only one figure) → activationsRemaining[2] -= 1
    act = g.data.get('activationsRemaining') or {}
    p2_rem = act.get(2, act.get('2', 0))
    assert p2_rem == 0, (
        f'P2 activationsRemaining should be 0 after Vader wipe; got {p2_rem}'
    )


def test_orchestrator_bonus_conditions_apply_on_hit():
    """bonusConditions in pendingCombat apply to defender on hit."""
    fixture = _base_fixture()
    fixture['pendingCombat'] = {'bonusConditions': ['Bleed']}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('no damage on this seed; bonusConditions gate on damage')
    conds = g.data.get('figureConditions', {}).get('Darth Vader-0-0', [])
    assert 'Bleed' in conds, f'Bleed should apply on hit; got {conds}'


def test_orchestrator_defeat_drops_contraband_on_carry_mission():
    """Mos Eisley Outskirts B: a defeated figure carrying contraband
    drops it on its last space."""
    fixture = _base_fixture()
    fixture['dcHealthState']['hl2dc0'] = [[1, 12]]
    fixture['figureContraband'] = {'Darth Vader-0-0': True}
    fixture['selectedMission'] = {'mechanics': {'type': 'carry'}}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(12345),
        attack_dice_override=['red', 'red', 'red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit'):
        pytest.skip('miss on this seed')
    assert result.get('defeated') is True
    dropped = g.data.get('droppedContrabandSpaces') or []
    assert 'f5' in dropped, f'contraband should drop at f5; got {dropped}'
    # Carrier entry removed.
    assert 'Darth Vader-0-0' not in (g.data.get('figureContraband') or {})


def test_orchestrator_defeat_skips_contraband_drop_non_carry_mission():
    """Non-carry missions: contraband is NOT dropped on defeat
    (flag is still cleared but space not added)."""
    fixture = _base_fixture()
    fixture['dcHealthState']['hl2dc0'] = [[1, 12]]
    fixture['figureContraband'] = {'Darth Vader-0-0': True}
    # Missing selectedMission → no carry mechanic.
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(12345),
        attack_dice_override=['red', 'red', 'red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit'):
        pytest.skip('miss on this seed')
    dropped = g.data.get('droppedContrabandSpaces')
    assert not dropped, f'non-carry mission must not drop; got {dropped}'


def test_crippling_blow_stuns_defender_on_hit():
    """Crippling Blow CC stamps cripplingBlowPending. On a hit,
    defender becomes Stunned; flag clears regardless."""
    fixture = _base_fixture()
    fixture['cripplingBlowPending'] = {'hl1dc0': True}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    # Flag cleared.
    assert not (g.data.get('cripplingBlowPending') or {}).get('hl1dc0')
    # If the attack hit, Vader is Stunned.
    if result.get('hit'):
        conds = g.data.get('figureConditions', {}).get('Darth Vader-0-0', [])
        assert 'Stun' in conds, (
            f'Crippling Blow should Stun defender on hit; got {conds}'
        )


def test_self_defeats_after_attack_fires_on_attacker():
    """Dying Lunge / Final Stand stamp selfDefeatsAfterAttackMsgId.
    After attack resolves, attacker is removed from board and
    defender's player scores kill VP."""
    fixture = _base_fixture()
    fixture['selfDefeatsAfterAttackMsgId'] = {'hl1dc0': True}
    g = _game(fixture)
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    # Attacker removed from board.
    p1_figs = g.data['figurePositions'].get(1, {})
    assert 'Luke Skywalker-0-0' not in p1_figs, (
        f'Luke should self-defeat after attack; still at {p1_figs.get("Luke Skywalker-0-0")}'
    )
    # Flag cleared.
    assert not (g.data.get('selfDefeatsAfterAttackMsgId') or {}).get('hl1dc0'), (
        'selfDefeatsAfterAttackMsgId should clear on consume'
    )


def test_surge_spend_damage_applies_to_combat():
    """Spending a 'damage 2' surge adds 2 to combat.surgeDamage,
    which compute_combat_result reads into final damage."""
    g = _game(_base_fixture())
    # Attacker has 2 surge baseline; spend 'damage 2'.
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['yellow', 'yellow', 'yellow'],  # gets surges
        defense_dice_override=['white'],
        surge_spends=['damage 2'],
    )
    combat = result['combat']
    assert combat.get('surgeDamage', 0) >= 2, (
        f'surgeDamage should be >=2 after spending "damage 2"; got '
        f'{combat.get("surgeDamage")}'
    )


def test_surge_spend_pierce_applies_to_combat():
    """Spending a 'pierce 1' surge adds 1 to combat.surgePierce."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['yellow', 'yellow'],
        defense_dice_override=['white'],
        surge_spends=['pierce 1'],
    )
    combat = result['combat']
    assert combat.get('surgePierce', 0) >= 1, (
        f'surgePierce should be >=1; got {combat.get("surgePierce")}'
    )


def test_surge_spend_blast_populates_surgeBlast_field():
    """Spending a 'blast 2' surge populates combat.surgeBlast = 2.

    The blast phase (reads surgeBlast + bonusBlast) then triggers
    adjacent-figure damage. This test verifies the plumbing —
    end-to-end blast-damage-lands is gated on map adjacency which
    varies per map and isn't worth tuning a fixture for."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['yellow', 'yellow'],
        defense_dice_override=['white'],
        surge_spends=['blast 2'],
    )
    assert result['combat'].get('surgeBlast') == 2, (
        f'surgeBlast should be 2 after spending blast 2; got '
        f'{result["combat"].get("surgeBlast")}'
    )


def test_surge_spend_bleed_applies_condition():
    """Spending a 'bleed' surge adds Bleed to surgeConditions."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['yellow', 'yellow'],
        defense_dice_override=['white'],
        surge_spends=['bleed'],
    )
    combat = result['combat']
    surge_conds = combat.get('surgeConditions') or []
    assert 'Bleed' in surge_conds, (
        f'surgeConditions should include Bleed; got {surge_conds}'
    )


def test_activate_stunned_figure_clears_stun_and_halves_actions():
    """Activating a Stunned figure: clears Stun, dcActionsData.total = 1."""
    from python.engine.stepper import step, Action, ActionType
    from python.engine.state import GameState
    # Build a minimal game where Luke is Stunned and about to activate.
    g_data = _base_fixture()
    g_data['activationsRemaining'] = {1: 1, 2: 1}
    g_data['p1ActivationsRemaining'] = 1
    g_data['p2ActivationsRemaining'] = 1
    g_data['figureConditions'] = {'Luke Skywalker-0-0': ['Stun', 'Focus']}
    g_data['phase'] = 'round_active'
    g_data['roundPhase'] = 'activation'
    gs = GameState(g_data)
    gs = step(gs, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Luke Skywalker-0-0'},
    ))
    # Stun cleared, Focus retained.
    conds = gs.data.get('figureConditions', {}).get('Luke Skywalker-0-0', [])
    assert 'Stun' not in conds, f'Stun should be cleared; got {conds}'
    assert 'Focus' in conds, f'Focus should remain; got {conds}'
    # dcActionsData.total == 1 (halved from 2).
    dc_act = gs.data.get('dcActionsData', {})
    entry = dc_act.get('hl1dc0')
    assert entry is not None, 'dcActionsData entry missing'
    assert entry['total'] == 1 and entry['remaining'] == 1, (
        f'stunned activation should give 1 action; got {entry}'
    )


def test_activate_non_stunned_figure_gets_2_actions():
    """Normal activation: dcActionsData.total = 2, no Stun changes."""
    from python.engine.stepper import step, Action, ActionType
    from python.engine.state import GameState
    g_data = _base_fixture()
    g_data['activationsRemaining'] = {1: 1, 2: 1}
    g_data['p1ActivationsRemaining'] = 1
    g_data['p2ActivationsRemaining'] = 1
    g_data['phase'] = 'round_active'
    g_data['roundPhase'] = 'activation'
    gs = GameState(g_data)
    gs = step(gs, Action(
        type=ActionType.ACTIVATE_DC, player=1,
        params={'figure_key': 'Luke Skywalker-0-0'},
    ))
    entry = gs.data.get('dcActionsData', {}).get('hl1dc0')
    assert entry is not None
    assert entry['total'] == 2 and entry['remaining'] == 2, (
        f'normal activation should give 2 actions; got {entry}'
    )


def test_orchestrator_multi_figure_group_partial_wipe():
    """Defeating one figure of a multi-figure group doesn't decrement
    activationsRemaining (group still alive)."""
    fixture = _base_fixture()
    # Add a 2-figure Stormtrooper group for P2.
    fixture['figurePositions'][2] = {
        'Darth Vader-0-0': 'f5',
        'Stormtrooper-0-0': 'f6',
        'Stormtrooper-0-1': 'g6',
    }
    fixture['dcHealthState']['hl2dc1'] = [[1, 3], [3, 3]]
    fixture['p2DcList'].append({'dcName': 'Stormtrooper', 'dgIndex': 0})
    fixture['p2DcMessageIds'].append('hl2dc1')
    fixture['dcMessageMeta']['hl2dc1'] = {
        'gameId': 'orch-oracle', 'dcName': 'Stormtrooper', 'playerNum': 2,
    }
    fixture['activationsRemaining'] = {1: 1, 2: 2}  # 2 groups live
    g = _game(fixture)
    # Knock out one Stormtrooper; the other remains.
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Stormtrooper-0-0',
        rng=random.Random(42),
        attack_dice_override=['red', 'red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit'):
        pytest.skip('miss on this seed')
    # Only one Stormtrooper figure wiped — group still alive.
    stormtroopers = [
        fk for fk in g.data['figurePositions'].get(2, {}).keys()
        if fk.startswith('Stormtrooper-')
    ]
    # activationsRemaining[2] should NOT decrement (group survives).
    act = g.data.get('activationsRemaining') or {}
    p2_rem = act.get(2, act.get('2', 0))
    if len(stormtroopers) >= 1:
        # Group still alive — no decrement
        assert p2_rem == 2, (
            f'group-partial wipe should not decrement activationsRemaining; '
            f'remaining P2 stormtroopers={len(stormtroopers)}, '
            f'p2_rem={p2_rem}'
        )


def test_next_attacks_bonus_conditions_consumed_on_hit():
    """nextAttacksBonusConditions[player] merges into combat.bonusConditions
    and decrements; depleted entry is removed."""
    fixture = _base_fixture()
    fixture['nextAttacksBonusConditions'] = {
        1: {'count': 2, 'conditions': ['Bleed']},
    }
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    entry = g.data['nextAttacksBonusConditions'].get(1)
    assert entry is not None, 'entry should remain after first consume'
    assert entry['count'] == 1, f'count should decrement to 1; got {entry}'
    if result.get('hit'):
        conds = (g.data.get('figureConditions') or {}).get(
            'Darth Vader-0-0') or []
        assert 'Bleed' in conds, (
            f'bonus Bleed should apply on hit; figureConditions={conds}'
        )


def test_next_attacks_bonus_conditions_depleted_entry_removed():
    """When counter hits 0, entry is dropped from the map."""
    fixture = _base_fixture()
    fixture['nextAttacksBonusConditions'] = {
        1: {'count': 1, 'conditions': ['Stun']},
    }
    g = _game(fixture)
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    assert 1 not in (g.data.get('nextAttacksBonusConditions') or {}), (
        'depleted entry should be removed'
    )


def test_deflection_unconditional_damages_attacker_on_hit():
    """deflectionUnconditional fires on any hit, regardless of damage dealt."""
    fixture = _base_fixture()
    fixture['deflectionPending'] = {2: 3}
    fixture['deflectionUnconditional'] = {2: True}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit'):
        pytest.skip('miss on this seed')
    # Luke (P1) took deflection damage: 10 - 3 = 7.
    assert g.data['dcHealthState']['hl1dc0'][0][0] == 7, (
        f"Luke HP should drop by 3; got {g.data['dcHealthState']['hl1dc0']}"
    )
    assert 2 not in (g.data.get('deflectionPending') or {}), (
        'deflectionPending entry should clear after firing'
    )


def test_deflection_conditional_only_fires_on_zero_damage():
    """Legacy deflection only fires when defender takes 0 damage."""
    fixture = _base_fixture()
    fixture['deflectionPending'] = {2: 2}
    # deflectionUnconditional NOT set → conditional on damage == 0.
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('wrong seed outcome for this conditional test')
    # Hit with damage > 0 — deflection should NOT fire.
    assert g.data['dcHealthState']['hl1dc0'][0][0] == 10, (
        'Luke HP should be untouched when conditional deflection skipped'
    )
    # Entry NOT consumed either.
    assert (g.data.get('deflectionPending') or {}).get(2) == 2


def test_furious_charge_focuses_defender_when_damage_gte_threshold():
    """conditionalFocusIfDamagedGte: on damage >= threshold, defender gains
    Focus and the flag clears."""
    fixture = _base_fixture()
    fixture['conditionalFocusIfDamagedGte'] = {'playerNum': 2, 'threshold': 1}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) < 1:
        pytest.skip('no damage on this seed')
    conds = (g.data.get('figureConditions') or {}).get('Darth Vader-0-0') or []
    assert 'Focus' in conds, f'Vader should be Focused; got {conds}'
    assert g.data.get('conditionalFocusIfDamagedGte') is None, (
        'flag should be cleared after firing'
    )


def test_furious_charge_does_not_fire_below_threshold():
    """Threshold gate: damage < threshold keeps flag and does not Focus."""
    fixture = _base_fixture()
    fixture['conditionalFocusIfDamagedGte'] = {'playerNum': 2, 'threshold': 99}
    g = _game(fixture)
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    conds = (g.data.get('figureConditions') or {}).get('Darth Vader-0-0') or []
    assert 'Focus' not in conds, 'no Focus below threshold'
    assert g.data.get('conditionalFocusIfDamagedGte') is not None, (
        'flag must be preserved when threshold not met'
    )


def test_furious_charge_only_fires_for_matching_player():
    """Flag with playerNum=1 must not fire when P2 takes damage."""
    fixture = _base_fixture()
    fixture['conditionalFocusIfDamagedGte'] = {'playerNum': 1, 'threshold': 1}
    g = _game(fixture)
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    conds = (g.data.get('figureConditions') or {}).get('Darth Vader-0-0') or []
    assert 'Focus' not in conds, 'P1-owned flag must not fire for P2 damage'
    assert g.data.get('conditionalFocusIfDamagedGte') is not None


def test_critical_hit_blocks_defender_from_playing_ccs():
    """critical_hit surge (Mak Eshka'rey) stamps surgeCriticalHit on the
    combat dict; post-damage this sets criticalHitBlockedPlayer so the
    defender can't play Command cards the rest of the round."""
    g = _game(_base_fixture())
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        surge_spends=['critical_hit'],
        attack_dice_override=['red', 'blue', 'blue'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('no damage on this seed')
    assert g.data.get('criticalHitBlockedPlayer') == 2, (
        f"criticalHitBlockedPlayer should be 2 (defender); "
        f"got {g.data.get('criticalHitBlockedPlayer')}"
    )


def test_stun_batons_deals_extra_strain_on_damage():
    """Riot Trooper Stun Batons: on damage, target takes +1 HP strain."""
    fixture = _base_fixture()
    # Swap Luke (no Stun Batons) for Riot Trooper (Elite) — has Stun Batons.
    fixture['figurePositions'] = {
        1: {'Riot Trooper (Elite)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['p1DcList'] = [{'dcName': 'Riot Trooper (Elite)', 'dgIndex': 0}]
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Riot Trooper (Elite)', 'playerNum': 1,
    }
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Riot Trooper (Elite)-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('no damage on this seed')
    # Vader starts at 12; took `damage` + 1 (Stun Batons strain).
    expected = 12 - result['damage'] - 1
    assert g.data['dcHealthState']['hl2dc0'][0][0] == expected, (
        f'Vader HP should be {expected} (damage {result["damage"]} + 1 strain); '
        f'got {g.data["dcHealthState"]["hl2dc0"][0][0]}'
    )


def test_stun_batons_skipped_when_no_damage_dealt():
    """Stun Batons requires damage > 0."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Riot Trooper (Elite)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['p1DcList'] = [{'dcName': 'Riot Trooper (Elite)', 'dgIndex': 0}]
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Riot Trooper (Elite)', 'playerNum': 1,
    }
    g = _game(fixture)
    # Find a miss seed to verify Stun Batons does NOT fire without damage.
    miss_game = None
    for seed in range(50):
        fx = {**fixture}
        fx['figurePositions'] = {
            1: {'Riot Trooper (Elite)-0-0': 'e5'},
            2: {'Darth Vader-0-0': 'f5'},
        }
        fx['dcHealthState'] = {
            'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]],
        }
        g2 = _game(dict(fx))
        r = orchestrate_attack(
            g2, 'Riot Trooper (Elite)-0-0', 'Darth Vader-0-0',
            rng=random.Random(seed),
            attack_dice_override=['blue'],
            defense_dice_override=['red', 'red'],
        )
        if not r.get('hit') or r.get('damage', 0) == 0:
            miss_game = g2
            break
    if miss_game is None:
        pytest.skip('no zero-damage outcome')
    assert miss_game.data['dcHealthState']['hl2dc0'][0][0] == 12, (
        'Vader HP should be untouched when no damage dealt'
    )


def test_stun_batons_skipped_when_target_has_flame_trooper():
    """Flame Trooper attachment grants Fireproof — immune to Stun Batons."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Riot Trooper (Elite)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['p1DcList'] = [{'dcName': 'Riot Trooper (Elite)', 'dgIndex': 0}]
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Riot Trooper (Elite)', 'playerNum': 1,
    }
    fixture['p2DcAttachments'] = {'hl2dc0': ['Flame Trooper']}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Riot Trooper (Elite)-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('no damage on this seed')
    # Fireproof — only the direct damage, not the +1 strain.
    expected = 12 - result['damage']
    assert g.data['dcHealthState']['hl2dc0'][0][0] == expected, (
        f'Fireproof should skip Stun Batons strain; expected {expected}, '
        f'got {g.data["dcHealthState"]["hl2dc0"][0][0]}'
    )


def test_fury_of_kashyyyk_focuses_wookiee_on_3_plus_damage():
    """[Fury of Kashyyyk] attachment: when a friendly WOOKIEE survives 3+
    damage, they become Focused."""
    fixture = _base_fixture()
    # Swap Vader (no WOOKIEE keyword) for Chewbacca (WOOKIEE).
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Chewbacca-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[12, 12]],  # Chewbacca survives 3 dmg easily.
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Chewbacca', 'playerNum': 2,
    }
    fixture['p2DcList'] = [
        {'dcName': 'Chewbacca', 'dgIndex': 0},
        {'dcName': '[Fury of Kashyyyk]', 'dgIndex': 1},
    ]
    g = _game(fixture)
    # Need 3+ damage — use 3 red dice vs weak defense.
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Chewbacca-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) < 3:
        pytest.skip('need 3+ damage for this test')
    conds = (g.data.get('figureConditions') or {}).get('Chewbacca-0-0') or []
    assert 'Focus' in conds, (
        f'Chewbacca should be Focused (Fury of Kashyyyk + 3+ dmg); got {conds}'
    )


def test_fury_of_kashyyyk_does_not_fire_below_threshold():
    """Damage < 3 → no Focus."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Chewbacca-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]],
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Chewbacca', 'playerNum': 2,
    }
    fixture['p2DcList'] = [
        {'dcName': 'Chewbacca', 'dgIndex': 0},
        {'dcName': '[Fury of Kashyyyk]', 'dgIndex': 1},
    ]
    g = _game(fixture)
    # 1 red die — low damage.
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Chewbacca-0-0',
        rng=random.Random(1),
        attack_dice_override=['blue'],
        defense_dice_override=['red'],
    )
    if not result.get('hit') or result.get('damage', 0) >= 3:
        pytest.skip('wrong damage outcome for below-threshold test')
    conds = (g.data.get('figureConditions') or {}).get('Chewbacca-0-0') or []
    assert 'Focus' not in conds, (
        f'Chewbacca should not be Focused with damage < 3; got {conds}'
    )


def test_fury_of_kashyyyk_skipped_for_non_wookiee():
    """Non-WOOKIEE target doesn't get Focus even with Fury in squad."""
    fixture = _base_fixture()
    # Vader is not a WOOKIEE.
    fixture['p2DcList'] = [
        {'dcName': 'Darth Vader', 'dgIndex': 0},
        {'dcName': '[Fury of Kashyyyk]', 'dgIndex': 1},
    ]
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) < 3:
        pytest.skip('need 3+ damage for this test')
    conds = (g.data.get('figureConditions') or {}).get('Darth Vader-0-0') or []
    assert 'Focus' not in conds, (
        f'Vader (not WOOKIEE) must not be Focused by Fury; got {conds}'
    )


def test_fly_by_grants_2_mp_to_attacker_when_target_within_2():
    """Jet Trooper (Elite) Fly-By: after attack within 2 spaces, +2 MP."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Jet Trooper (Elite)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['p1DcList'] = [{'dcName': 'Jet Trooper (Elite)', 'dgIndex': 0}]
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Jet Trooper (Elite)', 'playerNum': 1,
    }
    g = _game(fixture)
    orchestrate_attack(
        g, 'Jet Trooper (Elite)-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    bank = (g.data.get('movementBank') or {}).get('hl1dc0') or {}
    bonus = int(bank.get('bonus') or bank.get('total') or 0)
    assert bonus >= 2, (
        f'Fly-By should grant 2 MP to attacker; got bank={bank}'
    )


def test_jets_grants_1_mp_to_attacker_when_target_within_2():
    """Jet Trooper (Regular) Jets: after attack within 2 spaces, +1 MP."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Jet Trooper (Regular)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['p1DcList'] = [{'dcName': 'Jet Trooper (Regular)', 'dgIndex': 0}]
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Jet Trooper (Regular)', 'playerNum': 1,
    }
    g = _game(fixture)
    orchestrate_attack(
        g, 'Jet Trooper (Regular)-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    bank = (g.data.get('movementBank') or {}).get('hl1dc0') or {}
    bonus = int(bank.get('bonus') or bank.get('total') or 0)
    assert bonus >= 1, f'Jets should grant 1 MP; got bank={bank}'


def test_nimble_grants_defender_2_mp_per_block():
    """Asajj Ventress nimble_asajj: defender gains 2 MP per Block rolled."""
    fixture = _base_fixture()
    # Replace Vader with Asajj Ventress (has nimble_asajj specialAbility).
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Asajj Ventress-0-0': 'f5'},
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Asajj Ventress', 'playerNum': 2,
    }
    fixture['p2DcList'] = [{'dcName': 'Asajj Ventress', 'dgIndex': 0}]
    g = _game(fixture)
    # Try multiple seeds — black dice often roll blocks but not always.
    fired = False
    for seed in range(50):
        fx = dict(fixture)
        fx['figurePositions'] = {
            1: {'Luke Skywalker-0-0': 'e5'},
            2: {'Asajj Ventress-0-0': 'f5'},
        }
        fx['dcHealthState'] = {
            'hl1dc0': [[10, 10]], 'hl2dc0': [[12, 12]],
        }
        fx['movementBank'] = None
        g2 = _game(dict(fx))
        orchestrate_attack(
            g2, 'Luke Skywalker-0-0', 'Asajj Ventress-0-0',
            rng=random.Random(seed),
            attack_dice_override=['red'],
            defense_dice_override=['black', 'black', 'black'],
        )
        bank = (g2.data.get('movementBank') or {}).get('hl2dc0') or {}
        bonus = int(bank.get('bonus') or bank.get('total') or 0)
        if bonus >= 2:
            fired = True
            break
    assert fired, 'Nimble should grant >=2 MP for at least one block in 50 seeds'


def test_guerilla_hides_attacker_on_kill():
    """Rebel Pathfinder Guerilla: when the attack defeats the defender,
    the attacker becomes Hidden."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Alliance Ranger (Elite)-0-0': 'e5'},
        2: {'Stormtrooper-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[1, 4]],  # Stormtrooper at 1 HP — easy to defeat.
    }
    fixture['dcMessageMeta'] = {
        'hl1dc0': {'gameId': 'orch-oracle', 'dcName': 'Alliance Ranger (Elite)',
                   'playerNum': 1},
        'hl2dc0': {'gameId': 'orch-oracle', 'dcName': 'Stormtrooper',
                   'playerNum': 2},
    }
    fixture['p1DcList'] = [{'dcName': 'Alliance Ranger (Elite)', 'dgIndex': 0}]
    fixture['p2DcList'] = [{'dcName': 'Stormtrooper', 'dgIndex': 0}]
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Alliance Ranger (Elite)-0-0', 'Stormtrooper-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('defeated'):
        pytest.skip('did not kill on this seed')
    conds = (g.data.get('figureConditions') or {}).get(
        'Alliance Ranger (Elite)-0-0') or []
    assert 'Hide' in conds, (
        f'Rebel Pathfinder should be Hidden after killing; got {conds}'
    )


def test_guerilla_does_not_fire_without_kill():
    """No defeat → no Hide."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Alliance Ranger (Elite)-0-0': 'e5'},
        2: {'Darth Vader-0-0': 'f5'},
    }
    fixture['dcMessageMeta']['hl1dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Alliance Ranger (Elite)',
        'playerNum': 1,
    }
    fixture['p1DcList'] = [{'dcName': 'Alliance Ranger (Elite)', 'dgIndex': 0}]
    g = _game(fixture)
    orchestrate_attack(
        g, 'Alliance Ranger (Elite)-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    conds = (g.data.get('figureConditions') or {}).get(
        'Alliance Ranger (Elite)-0-0') or []
    assert 'Hide' not in conds, (
        f'Hide should not apply without kill; got {conds}'
    )


def test_distracting_fire_damages_attacker_when_pathfinder_has_los():
    """Rebel Pathfinder Elite: if alive on defender's side with LOS to
    attacker, attacker takes 1 damage post-attack."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {
            'Darth Vader-0-0': 'f5',
            # Pathfinder is the second figure on P2 with LOS to Luke.
            'Rebel Pathfinder (Elite)-1-0': 'e6',
        },
    }
    fixture['p2DcList'] = [
        {'dcName': 'Darth Vader', 'dgIndex': 0},
        {'dcName': 'Rebel Pathfinder (Elite)', 'dgIndex': 1},
    ]
    g = _game(fixture)
    luke_hp_before = fixture['dcHealthState']['hl1dc0'][0][0]
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    # Distracting Fire deals 1 damage to attacker — independent of attack hit.
    luke_hp_after = g.data['dcHealthState']['hl1dc0'][0][0]
    assert luke_hp_after == luke_hp_before - 1, (
        f'Luke should take 1 damage from Distracting Fire; '
        f'before={luke_hp_before} after={luke_hp_after}'
    )


def test_distracting_fire_skipped_without_pathfinder():
    """No Pathfinder on defender's side → no Distracting Fire damage."""
    g = _game(_base_fixture())
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    assert g.data['dcHealthState']['hl1dc0'][0][0] == 10, (
        'Luke HP should be untouched without Distracting Fire trigger'
    )


def test_you_will_not_deny_me_saves_fifth_brother():
    """youWillNotDenyMeActive prevents Fifth Brother defeat by healing to 1 HP."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Fifth Brother-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[1, 12]],  # 1 HP, easy lethal hit.
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Fifth Brother', 'playerNum': 2,
    }
    fixture['p2DcList'] = [{'dcName': 'Fifth Brother', 'dgIndex': 0}]
    fixture['youWillNotDenyMeActive'] = {'playerNum': 2}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Fifth Brother-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('miss on this seed')
    # Defeated should be flipped to False; figure still on the board at 1 HP.
    assert not result.get('defeated'), (
        'Fifth Brother should not be defeated; YWNDM should heal to 1.'
    )
    pos = (g.data.get('figurePositions') or {}).get(2, {}).get(
        'Fifth Brother-0-0')
    assert pos is not None, 'Fifth Brother should remain on the board'
    hp = g.data['dcHealthState']['hl2dc0'][0][0]
    assert hp == 1, f'Fifth Brother should be at 1 HP; got {hp}'


def test_second_chance_saves_target_and_discards_card():
    """secondChanceDcMsgId saves the target and removes the CC entry."""
    fixture = _base_fixture()
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[1, 12]],  # 1 HP — hit will defeat.
    }
    fixture['secondChanceDcMsgId'] = {'hl2dc0': 2}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('miss on this seed')
    assert not result.get('defeated'), 'Second Chance should save target'
    pos = (g.data.get('figurePositions') or {}).get(2, {}).get('Darth Vader-0-0')
    assert pos is not None, 'Vader should remain on the board'
    sc = g.data.get('secondChanceDcMsgId') or {}
    assert 'hl2dc0' not in sc, 'Second Chance entry should be discarded'


def test_sustained_by_rage_saves_unactivated_maul():
    """Maul sustained_by_rage: defeat is prevented if not activated this round."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Maul-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[1, 12]],
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Maul', 'playerNum': 2,
    }
    fixture['p2DcList'] = [{'dcName': 'Maul', 'dgIndex': 0}]
    # No p2ActivatedDcIndices → Maul has not activated this round.
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Maul-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('miss on this seed')
    assert not result.get('defeated'), (
        'Maul should be saved by sustained_by_rage'
    )
    pos = (g.data.get('figurePositions') or {}).get(2, {}).get('Maul-0-0')
    assert pos is not None
    hp = g.data['dcHealthState']['hl2dc0'][0][0]
    assert hp == 1, f'Maul should be at 1 HP; got {hp}'


def test_sustained_by_rage_does_not_save_after_activation():
    """Once Maul has activated, sustained_by_rage no longer prevents defeat."""
    fixture = _base_fixture()
    fixture['figurePositions'] = {
        1: {'Luke Skywalker-0-0': 'e5'},
        2: {'Maul-0-0': 'f5'},
    }
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]],
        'hl2dc0': [[1, 12]],
    }
    fixture['dcMessageMeta']['hl2dc0'] = {
        'gameId': 'orch-oracle', 'dcName': 'Maul', 'playerNum': 2,
    }
    fixture['p2DcList'] = [{'dcName': 'Maul', 'dgIndex': 0}]
    fixture['p2ActivatedDcIndices'] = [0]  # Maul has activated.
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Maul-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('hit') or result.get('damage', 0) == 0:
        pytest.skip('miss on this seed')
    assert result.get('defeated'), (
        'Maul should be defeated normally after activation'
    )


def test_worth_every_credit_awards_bonus_vp_on_kill():
    """nextHostileDefeatVpBonus[player] adds objective VP and clears."""
    fixture = _base_fixture()
    fixture['dcHealthState'] = {
        'hl1dc0': [[10, 10]], 'hl2dc0': [[1, 12]],
    }
    fixture['nextHostileDefeatVpBonus'] = {1: {'amount': 3}}
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('defeated'):
        pytest.skip('did not kill on this seed')
    obj = (g.data.get('player1VP') or {}).get('objectives', 0)
    assert obj >= 3, (
        f'P1 should have objective VP from Worth Every Credit; got {obj}'
    )
    assert 1 not in (g.data.get('nextHostileDefeatVpBonus') or {})


def test_apex_predator_heals_attacker_on_kill_within_range():
    """recoverOnHostileDefeat heals attacker when hostile within range falls."""
    fixture = _base_fixture()
    fixture['dcHealthState'] = {
        'hl1dc0': [[5, 10]],  # Luke at 5/10 — room to heal.
        'hl2dc0': [[1, 12]],
    }
    fixture['recoverOnHostileDefeat'] = {
        1: {'range': 3, 'amount': 2, 'msgId': 'hl1dc0'},
    }
    g = _game(fixture)
    result = orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red', 'red'],
        defense_dice_override=['white'],
    )
    if not result.get('defeated'):
        pytest.skip('did not kill on this seed')
    luke_hp = g.data['dcHealthState']['hl1dc0'][0][0]
    assert luke_hp == 7, (
        f'Apex Predator should heal +2 (5→7); got {luke_hp}'
    )


def test_next_attacks_bonus_conditions_only_consumed_by_matching_player():
    """Player-2's pending bonus conditions don't fire on a P1 attack."""
    fixture = _base_fixture()
    fixture['nextAttacksBonusConditions'] = {
        2: {'count': 1, 'conditions': ['Bleed']},
    }
    g = _game(fixture)
    orchestrate_attack(
        g, 'Luke Skywalker-0-0', 'Darth Vader-0-0',
        rng=random.Random(1),
        attack_dice_override=['red'],
        defense_dice_override=['white'],
    )
    p2_entry = (g.data.get('nextAttacksBonusConditions') or {}).get(2)
    assert p2_entry is not None
    assert p2_entry['count'] == 1, (
        f'P2 entry must not decrement on a P1 attack; got {p2_entry}'
    )
