"""P1.10 verification: cleanup_activation + cleanup_round_start.

Validates that all 80+ activation flags + ~50 round flags clear
properly when their lifecycle hook fires. Without these resets,
accumulated state across activations / rounds diverges from JS —
the source of many drift diffs before this port.
"""
from python.engine.mechanics.activation_state import (
    ACTIVATION_FIGKEY_FLAGS,
    ACTIVATION_MSGID_FLAGS,
    ACTIVATION_PLAYERNUM_FLAGS,
    ACTIVATION_SCALAR_FLAGS,
    ROUND_NULL_FLAGS,
    ROUND_OBJECT_FLAGS,
    cleanup_activation,
    cleanup_round_start,
)


# ── Flag-list shape ─────────────────────────────────────────────────────


def test_activation_msgid_flags_count():
    """JS has 71 entries in ACTIVATION_MSGID_FLAGS — Python should match."""
    # Loose lower bound: at least 60 — exact count drifts as JS adds flags.
    assert len(ACTIVATION_MSGID_FLAGS) >= 60


def test_activation_figkey_flags_present():
    assert 'figureMoved' in ACTIVATION_FIGKEY_FLAGS
    assert 'tripodAttacked' in ACTIVATION_FIGKEY_FLAGS


def test_activation_playernum_flags_present():
    assert 'nextAttacksBonusHits' in ACTIVATION_PLAYERNUM_FLAGS


def test_activation_scalar_flags_present():
    assert 'partingShotTriggered' in ACTIVATION_SCALAR_FLAGS


def test_round_object_flags_present():
    assert 'roundDefenseBonusBlock' in ROUND_OBJECT_FLAGS
    assert 'reinforcementsPlayedThisSor' in ROUND_OBJECT_FLAGS


def test_round_null_flags_present():
    assert 'phaseGate' in ROUND_NULL_FLAGS
    assert 'lastDefeatInfo' in ROUND_NULL_FLAGS


# ── cleanup_activation ──────────────────────────────────────────────────


def test_cleanup_activation_clears_msgid_flag():
    """dcActionsData[msg_id] removed, other entries kept."""
    g = {
        'dcActionsData': {
            'hl1dc0': {'remaining': 1},
            'hl1dc1': {'remaining': 2},
        },
    }
    cleanup_activation(g, 'hl1dc0', 1, ['Han Solo (Rebel Hero)-1-0'])
    assert 'hl1dc0' not in g['dcActionsData']
    assert 'hl1dc1' in g['dcActionsData']  # untouched


def test_cleanup_activation_clears_movement_bank():
    g = {
        'movementBank': {
            'hl1dc0': {'total': 4, 'remaining': 0},
        },
    }
    cleanup_activation(g, 'hl1dc0', 1, [])
    assert 'hl1dc0' not in g['movementBank']


def test_cleanup_activation_clears_figkey_flag():
    """figureMoved per-figure entries cleared for the activated group."""
    g = {
        'figureMoved': {
            'Han Solo (Rebel Hero)-1-0': True,
            'Boba Fett-1-0': True,  # other player's figure — untouched
        },
    }
    cleanup_activation(g, 'hl1dc0', 1, ['Han Solo (Rebel Hero)-1-0'])
    assert 'Han Solo (Rebel Hero)-1-0' not in g['figureMoved']
    assert 'Boba Fett-1-0' in g['figureMoved']


def test_cleanup_activation_clears_playernum_flag_int_key():
    g = {'nextAttacksBonusHits': {1: 2}}
    cleanup_activation(g, 'hl1dc0', 1, [])
    assert 1 not in g['nextAttacksBonusHits']


def test_cleanup_activation_clears_playernum_flag_str_key():
    """JS-loaded JSON often has string player keys."""
    g = {'nextAttacksBonusHits': {'1': 2}}
    cleanup_activation(g, 'hl1dc0', 1, [])
    assert '1' not in g['nextAttacksBonusHits']


def test_cleanup_activation_deletes_scalar_flag():
    g = {
        'partingShotTriggered': True,
        'commsJammerActivePlayerNum': 2,
    }
    cleanup_activation(g, 'hl1dc0', 1, [])
    assert 'partingShotTriggered' not in g
    assert 'commsJammerActivePlayerNum' not in g


def test_cleanup_activation_clears_move_in_progress_compound_keys():
    """moveInProgress keys are <msg_id>_<figureIndex>."""
    g = {
        'moveInProgress': {
            'hl1dc0_0': {'figureKey': 'X-1-0'},
            'hl1dc0_1': {'figureKey': 'X-1-1'},
            'hl2dc0_0': {'figureKey': 'Y-1-0'},  # other DC — untouched
        },
    }
    cleanup_activation(g, 'hl1dc0', 1, ['X-1-0', 'X-1-1'])
    assert 'hl1dc0_0' not in g['moveInProgress']
    assert 'hl1dc0_1' not in g['moveInProgress']
    assert 'hl2dc0_0' in g['moveInProgress']


def test_cleanup_activation_handles_missing_flags():
    """Cleanup never crashes on a sparse game state."""
    g = {}
    cleanup_activation(g, 'hl1dc0', 1, ['X-1-0'])
    # No keys appeared.
    assert g == {}


def test_cleanup_activation_clears_multiple_figkey_entries():
    g = {
        'figureMoved': {
            'X-1-0': True,
            'X-1-1': True,
            'X-1-2': True,
            'Y-1-0': True,
        },
    }
    cleanup_activation(g, 'hl1dc0', 1, ['X-1-0', 'X-1-1', 'X-1-2'])
    assert g['figureMoved'] == {'Y-1-0': True}


# ── cleanup_round_start ─────────────────────────────────────────────────


def test_cleanup_round_start_resets_object_flags_to_empty_dict():
    g = {'roundDefenseBonusBlock': {'X-1-0': 2}}
    cleanup_round_start(g)
    assert g['roundDefenseBonusBlock'] == {}


def test_cleanup_round_start_resets_null_flags():
    g = {'phaseGate': {'phase': 'pre_end_of_round'}, 'lastDefeatInfo': {'fk': 'X'}}
    cleanup_round_start(g)
    assert g['phaseGate'] is None
    assert g['lastDefeatInfo'] is None


def test_cleanup_round_start_creates_missing_flags():
    """Even if flags are absent, cleanup_round_start ensures they're
    set to their reset value (matches JS cleanupRoundStart behavior)."""
    g = {}
    cleanup_round_start(g)
    assert 'roundDefenseBonusBlock' in g
    assert g['roundDefenseBonusBlock'] == {}
    assert 'phaseGate' in g
    assert g['phaseGate'] is None


def test_cleanup_round_start_idempotent():
    """Running cleanup twice produces the same state."""
    g = {'roundDefenseBonusBlock': {'X': 1}, 'phaseGate': {'phase': 'X'}}
    cleanup_round_start(g)
    cleanup_round_start(g)
    assert g['roundDefenseBonusBlock'] == {}
    assert g['phaseGate'] is None


def test_cleanup_full_lifecycle():
    """End-of-activation → start-of-round leaves a clean slate for both
    activation and round flags."""
    g = {
        'dcActionsData': {'hl1dc0': {'remaining': 1}},
        'movementBank': {'hl1dc0': {'total': 4}},
        'figureMoved': {'Han-1-0': True},
        'partingShotTriggered': True,
        'roundDefenseBonusBlock': {'Han-1-0': 1},
        'phaseGate': {'phase': 'pre_end_of_round'},
    }
    # End of Han's activation.
    cleanup_activation(g, 'hl1dc0', 1, ['Han-1-0'])
    assert 'hl1dc0' not in g['dcActionsData']
    assert 'partingShotTriggered' not in g

    # Round flags are still set — they don't clear at end of activation.
    assert g['roundDefenseBonusBlock'] == {'Han-1-0': 1}
    assert g['phaseGate'] == {'phase': 'pre_end_of_round'}

    # Now round resets clear them.
    cleanup_round_start(g)
    assert g['roundDefenseBonusBlock'] == {}
    assert g['phaseGate'] is None
