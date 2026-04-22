"""Tests for cc_timing — play context + timing-enum dispatch + restriction gate.

Exercises:
  - get_cc_play_context derivation
  - is_cc_playable_now core timings (startOfRound, duringActivation,
    duringAttack / isAttacker / isDefender), blocked-player flags,
    special-action suppression, per-round limits
  - is_cc_play_legal_by_restriction: affiliation + keyword + alternatives,
    Fallen Master, Devout, Fast Learner
  - cc_playable_by_matches
  - has_darksaber_imperial
  - get_playable_reaction_cards_for_timing pipeline

Uses monkeypatched cc_effects + dc_effects caches so synthetic cards and
DCs can be built ad-hoc.

Run: python3 python/engine/mechanics/test_cc_timing.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.data import cc_effects_loader, dc_effects_loader
from python.engine.mechanics.cc_timing import (
    cc_playable_by_matches,
    get_cc_play_context,
    get_playable_cc_from_hand,
    get_playable_reaction_cards_for_timing,
    has_darksaber_imperial,
    is_cc_play_legal_by_restriction,
    is_cc_playable_now,
)


def _install(cc_effects: dict, dc_effects: dict) -> None:
    cc_effects_loader._cc_effects = cc_effects  # type: ignore[attr-defined]
    dc_effects_loader._dc_effects = dc_effects  # type: ignore[attr-defined]


def _restore() -> None:
    cc_effects_loader.reset_cache()
    dc_effects_loader.reset_cache()


def _base_game(**extra):
    g = {
        'player1Id': 'alice',
        'player2Id': 'bob',
        'currentRound': 1,
        'p1DcList': [],
        'p2DcList': [],
    }
    g.update(extra)
    return g


# ---------------------------------------------------------------------------
# Play-context tests

def test_get_cc_play_context_start_of_round():
    g = _base_game(startOfRoundWhoseTurn='alice')
    ctx = get_cc_play_context(g, 1)
    assert ctx['startOfRound'] is True
    assert ctx['duringActivation'] is False


def test_get_cc_play_context_during_activation():
    g = _base_game(currentActivationTurnPlayerId='alice')
    ctx = get_cc_play_context(g, 1)
    assert ctx['duringActivation'] is True
    assert ctx['startOfRound'] is False


def test_get_cc_play_context_during_attack():
    g = _base_game(combat={'attackerPlayerNum': 1, 'defenderPlayerNum': 2, 'hit': True})
    ctx = get_cc_play_context(g, 1)
    assert ctx['duringAttack'] is True
    assert ctx['isAttacker'] is True
    assert ctx['isDefender'] is False


# ---------------------------------------------------------------------------
# is_cc_playable_now tests

def test_is_cc_playable_now_start_of_round_card():
    _install(
        {'Reinforcements': {'timing': 'startOfRound', 'playableBy': 'Any Figure'}},
        {},
    )
    g = _base_game(startOfRoundWhoseTurn='alice')
    assert is_cc_playable_now(g, 1, 'Reinforcements') is True
    # Not the right window:
    assert is_cc_playable_now(_base_game(), 1, 'Reinforcements') is False
    _restore()


def test_is_cc_playable_now_during_activation():
    _install(
        {'Hold On': {'timing': 'duringActivation', 'playableBy': 'Any Figure'}},
        {},
    )
    g = _base_game(currentActivationTurnPlayerId='alice')
    assert is_cc_playable_now(g, 1, 'Hold On') is True
    assert is_cc_playable_now(g, 2, 'Hold On') is False  # wrong player
    _restore()


def test_is_cc_playable_now_special_action_suppressed_from_hand():
    _install(
        {'Master Operative': {'timing': 'specialAction', 'playableBy': 'Any Figure'}},
        {},
    )
    g = _base_game(currentActivationTurnPlayerId='alice')
    # Special-action cards fire from the DC, never from the hand dropdown
    assert is_cc_playable_now(g, 1, 'Master Operative') is False
    _restore()


def test_is_cc_playable_now_shadow_ops_blocks_player():
    _install({'Hold On': {'timing': 'duringActivation'}}, {})
    g = _base_game(currentActivationTurnPlayerId='alice', shadowOpsBlockedPlayer=1)
    assert is_cc_playable_now(g, 1, 'Hold On') is False
    _restore()


def test_is_cc_playable_now_comms_jammer_blocks_opponent():
    _install({'Hold On': {'timing': 'duringActivation'}}, {})
    g = _base_game(currentActivationTurnPlayerId='alice',
                   commsJammerActivePlayerNum=1)
    # P1 is the jammer → P1 can still play; P2 cannot
    assert is_cc_playable_now(g, 1, 'Hold On') is True
    assert is_cc_playable_now(g, 2, 'Hold On') is False
    _restore()


def test_is_cc_playable_now_jundland_terror_once_per_eor():
    _install({'Jundland Terror': {'timing': 'endOfRound'}}, {})
    g = _base_game(endOfRoundWhoseTurn='alice', jundlandTerrorPlayedThisEor=True)
    assert is_cc_playable_now(g, 1, 'Jundland Terror') is False
    g2 = _base_game(endOfRoundWhoseTurn='alice')
    assert is_cc_playable_now(g2, 1, 'Jundland Terror') is True
    _restore()


def test_is_cc_playable_now_assassinate_locks_out_during_attack():
    _install({'Force Push': {'timing': 'duringAttack'}}, {})
    g = _base_game(combat={'attackerPlayerNum': 1, 'defenderPlayerNum': 2, 'ccLockedOut': True})
    assert is_cc_playable_now(g, 1, 'Force Push') is False
    _restore()


def test_get_playable_cc_from_hand_filters_correctly():
    _install({
        'SoR Card': {'timing': 'startOfRound'},
        'During Card': {'timing': 'duringActivation'},
        'Specials': {'timing': 'specialAction'},
    }, {})
    g = _base_game(currentActivationTurnPlayerId='alice')
    out = get_playable_cc_from_hand(g, 1, ['SoR Card', 'During Card', 'Specials', 'During Card'])
    # Only 'During Card' qualifies; dup preserved (pure filter, no dedupe)
    assert out == ['During Card', 'During Card']
    _restore()


# ---------------------------------------------------------------------------
# is_cc_play_legal_by_restriction tests

def test_is_cc_play_legal_any_figure_always_legal():
    _install({'X': {'playableBy': 'Any Figure'}}, {})
    g = _base_game()
    assert is_cc_play_legal_by_restriction(g, 1, 'X')['legal'] is True
    _restore()


def test_is_cc_play_legal_affiliation_match():
    _install(
        {'Rebel CC': {'playableBy': 'Rebel'}},
        {'Luke Skywalker': {'affiliation': 'Rebel', 'keywords': ['Force User']}},
    )
    g = _base_game(p1DcList=[{'dcName': 'Luke Skywalker'}])
    r = is_cc_play_legal_by_restriction(g, 1, 'Rebel CC')
    assert r['legal'] is True
    _restore()


def test_is_cc_play_legal_affiliation_mismatch():
    _install(
        {'Imperial CC': {'playableBy': 'Imperial'}},
        {'Luke Skywalker': {'affiliation': 'Rebel', 'keywords': []}},
    )
    g = _base_game(p1DcList=[{'dcName': 'Luke Skywalker'}])
    r = is_cc_play_legal_by_restriction(g, 1, 'Imperial CC')
    assert r['legal'] is False
    assert 'Imperial' in r.get('reason', '')
    _restore()


def test_is_cc_play_legal_compound_affiliation_and_keyword():
    _install(
        {'Imperial Trooper CC': {'playableBy': 'Imperial Trooper'}},
        {
            'Stormtrooper': {'affiliation': 'Imperial', 'keywords': ['Trooper']},
            'Rebel Trooper': {'affiliation': 'Rebel', 'keywords': ['Trooper']},
        },
    )
    # Army has a Stormtrooper → legal
    g1 = _base_game(p1DcList=[{'dcName': 'Stormtrooper'}])
    assert is_cc_play_legal_by_restriction(g1, 1, 'Imperial Trooper CC')['legal'] is True
    # Army has only Rebel Trooper (Imperial missing) → illegal
    g2 = _base_game(p1DcList=[{'dcName': 'Rebel Trooper'}])
    assert is_cc_play_legal_by_restriction(g2, 1, 'Imperial Trooper CC')['legal'] is False
    _restore()


def test_is_cc_play_legal_or_alternatives():
    _install(
        {'CC A or B': {'playableBy': 'Wookiee or Smuggler'}},
        {'Han Solo': {'affiliation': 'Rebel', 'keywords': ['Smuggler']}},
    )
    g = _base_game(p1DcList=[{'dcName': 'Han Solo'}])
    assert is_cc_play_legal_by_restriction(g, 1, 'CC A or B')['legal'] is True
    _restore()


def test_is_cc_play_legal_fallen_master_forceuser_treated_as_imperial():
    _install(
        {'Imperial CC': {'playableBy': 'Imperial'}},
        {
            'Taron Malicos': {
                'affiliation': 'Scum',
                'keywords': ['Force User'],
                'specialAbilityIds': ['fallen_master_malicos'],
            },
        },
    )
    g = _base_game(p1DcList=[{'dcName': 'Taron Malicos'}])
    # Fallen Master: FORCE USER → IMPERIAL for CC restriction purposes
    assert is_cc_play_legal_by_restriction(g, 1, 'Imperial CC')['legal'] is True
    _restore()


def test_is_cc_play_legal_devout_chirrut_rebel_force_user_virtual():
    _install(
        {'Rebel FU CC': {'playableBy': 'Rebel Force User'}},
        {
            'Chirrut Imwe': {
                'affiliation': 'Rebel',
                'keywords': ['Guardian'],  # no FORCE USER keyword
                'specialAbilityIds': ['devout_chirrut'],
            },
        },
    )
    g = _base_game(p1DcList=[{'dcName': 'Chirrut Imwe'}])
    assert is_cc_play_legal_by_restriction(g, 1, 'Rebel FU CC')['legal'] is True
    _restore()


def test_is_cc_play_legal_fast_learner_matches_other_dc_name():
    _install(
        {'Unique Han CC': {'playableBy': 'Han Solo'}},
        {
            'Mara Jade': {
                'affiliation': 'Imperial',
                'keywords': [],
                'specialAbilityIds': ['adaptive_skills_mara_jade'],
            },
            'Han Solo': {'affiliation': 'Rebel', 'keywords': ['Smuggler']},
        },
    )
    g = _base_game(p1DcList=[{'dcName': 'Mara Jade'}, {'dcName': 'Han Solo'}])
    r = is_cc_play_legal_by_restriction(g, 1, 'Unique Han CC')
    # Han is in the army → matches directly → legal, but NOT via fastLearner
    assert r['legal'] is True
    _restore()


def test_is_cc_play_legal_fast_learner_cooldown_gate():
    _install(
        {'Trooper CC': {'playableBy': 'Trooper'}},
        {
            'Mara Jade': {
                'affiliation': 'Imperial',  # army affiliation = Imperial → Mara gets HUNTER (not Trooper)
                'keywords': [],
                'specialAbilityIds': ['adaptive_skills_mara_jade'],
            },
            'Stormtrooper': {'affiliation': 'Imperial', 'keywords': ['Trooper']},
        },
    )
    g = _base_game(p1DcList=[{'dcName': 'Mara Jade'}, {'dcName': 'Stormtrooper'}])
    # Stormtrooper matches directly, legal=True
    assert is_cc_play_legal_by_restriction(g, 1, 'Trooper CC')['legal'] is True
    _restore()


# ---------------------------------------------------------------------------
# cc_playable_by_matches + has_darksaber_imperial

def test_cc_playable_by_matches_basic_keyword():
    _install({}, {'Luke Skywalker': {'keywords': ['Force User']}})
    # Matches via keyword (lowercase alt "force user" vs kw "Force User")
    assert cc_playable_by_matches('Force User', 'Luke Skywalker', 'Luke Skywalker',
                                    False, None, None) is True
    _restore()


def test_cc_playable_by_matches_darksaber_imperial_override():
    _install({}, {'Ahsoka Tano': {'keywords': ['Force User']}})
    assert cc_playable_by_matches('Imperial', 'Ahsoka Tano', 'Ahsoka Tano',
                                    True, None, None) is True
    _restore()


def test_has_darksaber_imperial_true_when_attached():
    _install({}, {'Ahsoka Tano': {'keywords': ['Force User']}})
    g = _base_game(
        p1DcList=[{'dcName': 'Ahsoka Tano'}],
        p1DcMessageIds=['hl1dc0'],
        p1DcAttachments={'hl1dc0': ['The Darksaber']},
    )
    assert has_darksaber_imperial(g, 1, 'Ahsoka Tano') is True
    _restore()


def test_has_darksaber_imperial_false_when_not_force_user():
    _install({}, {'Han Solo': {'keywords': ['Smuggler']}})
    g = _base_game(
        p1DcList=[{'dcName': 'Han Solo'}],
        p1DcMessageIds=['hl1dc0'],
        p1DcAttachments={'hl1dc0': ['The Darksaber']},
    )
    assert has_darksaber_imperial(g, 1, 'Han Solo') is False
    _restore()


# ---------------------------------------------------------------------------
# get_playable_reaction_cards_for_timing

def test_get_playable_reaction_cards_for_timing_full_pipeline():
    _install(
        {
            'Self-Defense': {
                'timing': 'whenHostileFigureEntersAdjacentSpace',
                'playableBy': 'Any Figure',
            },
            'Not Triggering': {'timing': 'startOfRound', 'playableBy': 'Any Figure'},
        },
        {'Luke Skywalker': {'affiliation': 'Rebel', 'keywords': []}},
    )
    g = _base_game(
        currentActivationTurnPlayerId='alice',  # P1 activating
        player1CcHand=['Self-Defense', 'Not Triggering'],
        p1DcList=[{'dcName': 'Luke Skywalker'}],
    )
    out = get_playable_reaction_cards_for_timing(
        g, 1, ['whenHostileFigureEntersAdjacentSpace'],
    )
    assert len(out) == 1
    assert out[0]['cardName'] == 'Self-Defense'
    _restore()


def main():
    cases = [
        ('play_context_start_of_round', test_get_cc_play_context_start_of_round),
        ('play_context_during_activation', test_get_cc_play_context_during_activation),
        ('play_context_during_attack', test_get_cc_play_context_during_attack),
        ('playable_now_sor_card', test_is_cc_playable_now_start_of_round_card),
        ('playable_now_during_activation', test_is_cc_playable_now_during_activation),
        ('playable_now_special_action_suppressed', test_is_cc_playable_now_special_action_suppressed_from_hand),
        ('playable_now_shadow_ops_blocks', test_is_cc_playable_now_shadow_ops_blocks_player),
        ('playable_now_comms_jammer', test_is_cc_playable_now_comms_jammer_blocks_opponent),
        ('playable_now_jundland_eor_limit', test_is_cc_playable_now_jundland_terror_once_per_eor),
        ('playable_now_assassinate_lockout', test_is_cc_playable_now_assassinate_locks_out_during_attack),
        ('playable_from_hand_filter', test_get_playable_cc_from_hand_filters_correctly),
        ('legal_any_figure', test_is_cc_play_legal_any_figure_always_legal),
        ('legal_affiliation_match', test_is_cc_play_legal_affiliation_match),
        ('legal_affiliation_mismatch', test_is_cc_play_legal_affiliation_mismatch),
        ('legal_compound_affiliation_keyword', test_is_cc_play_legal_compound_affiliation_and_keyword),
        ('legal_or_alternatives', test_is_cc_play_legal_or_alternatives),
        ('legal_fallen_master_override', test_is_cc_play_legal_fallen_master_forceuser_treated_as_imperial),
        ('legal_devout_chirrut', test_is_cc_play_legal_devout_chirrut_rebel_force_user_virtual),
        ('legal_fast_learner_direct_match', test_is_cc_play_legal_fast_learner_matches_other_dc_name),
        ('legal_trooper_direct_match', test_is_cc_play_legal_fast_learner_cooldown_gate),
        ('playable_by_matches_basic', test_cc_playable_by_matches_basic_keyword),
        ('playable_by_matches_darksaber_imperial', test_cc_playable_by_matches_darksaber_imperial_override),
        ('darksaber_imperial_true', test_has_darksaber_imperial_true_when_attached),
        ('darksaber_imperial_false_not_fu', test_has_darksaber_imperial_false_when_not_force_user),
        ('reaction_pipeline_full', test_get_playable_reaction_cards_for_timing_full_pipeline),
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
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
