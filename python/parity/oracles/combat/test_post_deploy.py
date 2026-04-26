"""P1.15 verification: post-deploy queue engine port.

Validates scan + queue construction without Discord IO.
"""
from unittest.mock import patch

from python.engine.post_deploy import (
    finish_post_deploy,
    run_post_deploy_phase,
    scan_player_post_deploy_abilities,
)


def _game_with_figures(p1_figs=None, p2_figs=None):
    return {
        'figurePositions': {
            1: p1_figs or {},
            2: p2_figs or {},
        },
        'selectedMap': {'id': 'anchorhead-cantina-bar'},
    }


def test_scan_returns_empty_when_no_figures():
    g = _game_with_figures()
    result = scan_player_post_deploy_abilities(g, 1)
    assert result == []


def test_scan_returns_empty_when_no_passives():
    """Figures with no passive entries → no triggers."""
    g = _game_with_figures(p1_figs={'Han Solo (Rebel Hero)-1-0': 'a13'})
    # Han Solo has no post-deploy passive
    fake_effects = {'Han Solo (Rebel Hero)': {'passives': []}}
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    assert result == []


def test_scan_picks_up_beskar_armor():
    g = _game_with_figures(p1_figs={'The Mandalorian-1-0': 'a13'})
    fake_effects = {
        'The Mandalorian': {'passives': ['Beskar Armor']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    assert len(result) == 1
    assert result[0]['abilityId'] == 'beskar_armor'
    assert result[0]['type'] == 'token'
    assert result[0]['interactive'] is False


def test_scan_picks_up_stealthy_ambush_in_the_shadows():
    g = _game_with_figures(p1_figs={
        'Test-1-0': 'a13',
        'Test-1-1': 'a14',
        'Test-1-2': 'a15',
    })
    fake_effects = {
        'Test': {
            'passives': ['Stealthy', 'Ambush', 'In The Shadows'],
        },
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    # 3 figures × 3 passives = 9 ability entries.
    assert len(result) == 9
    ability_ids = {a['abilityId'] for a in result}
    assert ability_ids == {'stealthy', 'ambush', 'in_the_shadows'}


def test_scan_forward_emplacement_uses_speed():
    g = _game_with_figures(p1_figs={'Heavy-1-0': 'a13'})
    fake_effects = {
        'Heavy': {
            'passives': ['Forward Emplacement'],
            'speed': 4,
        },
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    fwd = next(r for r in result if r['abilityId'] == 'forward_emplacement')
    assert fwd['mp'] == 4
    assert fwd['interactive'] is True


def test_scan_security_detail_interactive_when_multiple_leaders():
    g = _game_with_figures(p1_figs={
        'Bodyguard-1-0': 'a13',
        'Vader-1-0': 'a14',
        'Tarkin-1-0': 'a15',
    })
    fake_effects = {
        'Bodyguard': {'passives': ['Security Detail']},
        'Vader': {'keywords': ['LEADER']},
        'Tarkin': {'keywords': ['LEADER']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    sd = next(r for r in result if r['abilityId'] == 'security_detail')
    # Two leaders → interactive (player picks which to attach to).
    assert sd['interactive'] is True
    assert len(sd['leaders']) == 2


def test_scan_security_detail_non_interactive_with_one_leader():
    g = _game_with_figures(p1_figs={
        'Bodyguard-1-0': 'a13',
        'Vader-1-0': 'a14',
    })
    fake_effects = {
        'Bodyguard': {'passives': ['Security Detail']},
        'Vader': {'keywords': ['LEADER']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        result = scan_player_post_deploy_abilities(g, 1)
    sd = next(r for r in result if r['abilityId'] == 'security_detail')
    assert sd['interactive'] is False
    assert len(sd['leaders']) == 1


def test_run_post_deploy_phase_combines_both_players():
    g = _game_with_figures(
        p1_figs={'Han-1-0': 'a13'},
        p2_figs={'Vader-1-0': 'a14'},
    )
    fake_effects = {
        'Han': {'passives': ['Stealthy']},
        'Vader': {'passives': ['Beskar Armor']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake_effects,
    ):
        queue = run_post_deploy_phase(g)
    assert len(queue) == 2
    assert g['postDeployQueue'] == queue
    player_nums = {q['playerNum'] for q in queue}
    assert player_nums == {1, 2}


def test_finish_post_deploy_clears_queue():
    g = {'postDeployQueue': [{'abilityId': 'X'}]}
    finish_post_deploy(g)
    assert 'postDeployQueue' not in g
    assert g['postDeployComplete'] is True


def test_finish_post_deploy_idempotent():
    """Calling finish twice must not crash."""
    g = {}
    finish_post_deploy(g)
    finish_post_deploy(g)
    assert g['postDeployComplete'] is True
