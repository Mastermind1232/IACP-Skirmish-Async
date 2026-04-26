"""P2.13 verification: movement / activation interrupts engine layer.

Validates pure-state mutations for:
  - Still Faster Than You (use + skip)
  - Squad Swarm (use + skip)
  - Overdrive (use)
  - Self-Destruct Probe (use + skip)
  - Self-Destruct Protocol (use + skip)
"""
import random

from python.engine.interrupts import (
    overdrive_use,
    self_destruct_probe_skip,
    self_destruct_protocol_skip,
    self_destruct_protocol_use,
    self_destruct_probe_use,
    squad_swarm_skip,
    squad_swarm_use,
    still_faster_skip,
    still_faster_use,
)


def _game():
    return {
        'figurePositions': {1: {}, 2: {}},
        'dcHealthState': {},
        'p1DcList': [],
        'p2DcList': [],
        'p1DcMessageIds': [],
        'p2DcMessageIds': [],
    }


# ── Still Faster ────────────────────────────────────────────────────────


def test_still_faster_use_stamps_fell_swoop_and_exclude():
    g = _game()
    result = still_faster_use(g, msg_id='hl1dc0', target_msg_id='hl1dc1')
    assert result['ok'] is True
    assert g['fellSwoopFreeAttack']['hl1dc0'] is True
    assert g['stillFasterExcludeMsgId'] == 'hl1dc1'


def test_still_faster_skip_clears_pending():
    g = _game()
    g['stillFasterPending'] = True
    result = still_faster_skip(g)
    assert result['ok'] is True
    assert g['stillFasterPending'] is None


# ── Squad Swarm ─────────────────────────────────────────────────────────


def test_squad_swarm_use_clears_player_flag():
    g = _game()
    g['squadSwarmPlayerNum'] = 1
    g['squadSwarmCumulativeCost'] = 8
    result = squad_swarm_use(g, msg_id='hl1dc0', target_msg_id='hl1dc1')
    assert result['ok'] is True
    assert g['squadSwarmPlayerNum'] is None
    assert g['squadSwarmTargetMsgId'] == 'hl1dc1'
    # Cumulative cost preserved (chain continues).
    assert g['squadSwarmCumulativeCost'] == 8


def test_squad_swarm_skip_clears_cumulative_cost():
    g = _game()
    g['squadSwarmPlayerNum'] = 1
    g['squadSwarmCumulativeCost'] = 8
    result = squad_swarm_skip(g)
    assert result['ok'] is True
    assert g['squadSwarmPlayerNum'] is None
    assert 'squadSwarmCumulativeCost' not in g


# ── Overdrive ───────────────────────────────────────────────────────────


def test_overdrive_use_grants_extra_action_and_takes_damage():
    g = _game()
    g['dcActionsData'] = {'hl1dc0': {'remaining': 1, 'total': 2,
                                       'specialsUsed': []}}
    g['dcHealthState'] = {'hl1dc0': [[5, 5]]}
    g['p1DcMessageIds'] = ['hl1dc0']
    result = overdrive_use(
        g, msg_id='hl1dc0', dc_name='Han', player_num=1,
        display_name='Han [DG 1]',
    )
    assert result['ok'] is True
    # +1 action up to total+1.
    assert g['dcActionsData']['hl1dc0']['remaining'] == 2
    # Took 1 damage.
    assert g['dcHealthState']['hl1dc0'][0][0] == 4
    # Overdrive flag stamped.
    assert g['overdriveUsedThisActivation']['Han-1-0'] is True


def test_overdrive_use_rejects_when_no_active_activation():
    g = _game()
    result = overdrive_use(
        g, msg_id='hl1dc0', dc_name='Han', player_num=1,
        display_name='Han [DG 1]',
    )
    assert result['ok'] is False
    assert result['code'] == 'no_active_activation'


def test_overdrive_use_caps_at_total_plus_one():
    g = _game()
    g['dcActionsData'] = {'hl1dc0': {'remaining': 2, 'total': 2,
                                       'specialsUsed': []}}
    g['dcHealthState'] = {'hl1dc0': [[5, 5]]}
    g['p1DcMessageIds'] = ['hl1dc0']
    result = overdrive_use(
        g, msg_id='hl1dc0', dc_name='Han', player_num=1,
        display_name='Han [DG 1]',
    )
    # 2 + 1 = 3, capped at total+1 = 3.
    assert g['dcActionsData']['hl1dc0']['remaining'] == 3


# ── Self-Destruct Probe ─────────────────────────────────────────────────


def test_self_destruct_probe_skip_clears_pending_sor():
    g = _game()
    g['pendingSorActions'] = {'hl1dc0': True, 'hl1dc1': True}
    result = self_destruct_probe_skip(g, msg_id='hl1dc0')
    assert result['ok'] is True
    assert 'hl1dc0' not in g['pendingSorActions']
    # Other entry preserved.
    assert g['pendingSorActions'].get('hl1dc1') is True


def test_self_destruct_probe_skip_removes_dict_when_empty():
    g = _game()
    g['pendingSorActions'] = {'hl1dc0': True}
    self_destruct_probe_skip(g, msg_id='hl1dc0')
    assert 'pendingSorActions' not in g


# ── Self-Destruct Protocol ──────────────────────────────────────────────


def test_self_destruct_protocol_skip_clears_pending():
    g = _game()
    g['pendingSelfDestruct'] = {'defenderPlayerNum': 1}
    result = self_destruct_protocol_skip(g)
    assert result['ok'] is True
    assert 'pendingSelfDestruct' not in g


def test_self_destruct_protocol_use_rejects_when_no_pending():
    g = _game()
    result = self_destruct_protocol_use(g)
    assert result['ok'] is False
    assert result['code'] == 'no_pending'


def test_self_destruct_protocol_use_consumes_pending_flag():
    g = _game()
    g['pendingSelfDestruct'] = {'defenderPlayerNum': 1}
    g['pendingCombat'] = {'target': {'figureKey': 'Probe-1-0'}}
    g['figurePositions'] = {1: {'Probe-1-0': 'a13'}, 2: {}}
    g['selectedMap'] = {'id': 'unknown'}
    result = self_destruct_protocol_use(
        g, rng=random.Random(0),
    )
    assert result['ok'] is True
    assert 'pendingSelfDestruct' not in g
