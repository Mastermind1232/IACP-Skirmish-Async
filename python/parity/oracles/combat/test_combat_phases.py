"""P1.1 verification: combat phase node model.

Validates the 16-phase enum, phase-order list, gate-set, and the helper
functions on python/engine/mechanics/combat_phases.py. No game logic
runs — this is purely a structural test of the state-machine scaffold.
"""
from python.engine.mechanics.combat_phases import (
    GATE_PHASES,
    PHASE_ORDER,
    CombatGateState,
    CombatPhase,
    clear_gate,
    get_gate,
    get_phase,
    is_self_play,
    open_gate,
    set_phase,
)


# ── Enum + ordering ─────────────────────────────────────────────────────


def test_combat_phase_has_16_members():
    """The state machine has exactly 16 distinct transitions."""
    assert len(list(CombatPhase)) == 16


def test_phase_order_covers_all_members():
    """PHASE_ORDER must be a permutation of CombatPhase — no missing
    phase, no duplicates."""
    assert set(PHASE_ORDER) == set(CombatPhase)
    assert len(PHASE_ORDER) == len(set(PHASE_ORDER))


def test_phase_order_starts_with_declare_ends_with_resolve():
    """The state machine begins at DECLARE and terminates at RESOLVE."""
    assert PHASE_ORDER[0] == CombatPhase.DECLARE
    assert PHASE_ORDER[-1] == CombatPhase.RESOLVE


def test_gate_phases_are_all_in_phase_order():
    """Every gate phase must appear in the canonical order."""
    for gate in GATE_PHASES:
        assert gate in PHASE_ORDER


def test_six_gate_phases():
    """Six of the 16 phases are gates: pre-combat, post-roll,
    post-forced, post-attacker, post-defender, post-surge."""
    assert len(GATE_PHASES) == 6


def test_phase_values_are_strings():
    """Stored phase value must be a string for JSON serializability."""
    for p in CombatPhase:
        assert isinstance(p.value, str)
        assert p.value  # non-empty


# ── CombatGateState dataclass ───────────────────────────────────────────


def test_gate_state_default():
    """Fresh gate has both flags False."""
    g = CombatGateState(phase=CombatPhase.ROLL.value)
    assert g.p1Ready is False
    assert g.p2Ready is False
    assert g.both_ready() is False


def test_gate_state_both_ready():
    """both_ready() True only when both flags True."""
    g = CombatGateState(phase=CombatPhase.ROLL.value, p1Ready=True, p2Ready=True)
    assert g.both_ready() is True


def test_gate_state_one_ready():
    """One-side-ready does not satisfy both_ready."""
    g = CombatGateState(phase=CombatPhase.ROLL.value, p1Ready=True)
    assert g.both_ready() is False


def test_gate_state_round_trips_through_dict():
    """to_dict / from_dict preserves shape."""
    g = CombatGateState(phase=CombatPhase.ROLL.value, p1Ready=True, p2Ready=False)
    d = g.to_dict()
    assert d == {'phase': 'roll', 'p1Ready': True, 'p2Ready': False}
    g2 = CombatGateState.from_dict(d)
    assert g2 == g


def test_gate_state_from_dict_handles_none():
    """from_dict tolerates None / missing — returns None."""
    assert CombatGateState.from_dict(None) is None
    assert CombatGateState.from_dict({}) is not None  # empty is a valid gate


# ── Game state helpers ──────────────────────────────────────────────────


def _game(d=None):
    """Tiny helper — returns a plain dict so tests stay free of GameState
    coupling."""
    return d if d is not None else {}


def test_get_phase_returns_none_when_no_combat():
    assert get_phase(_game()) is None


def test_get_phase_returns_none_for_legacy_string():
    """If pendingCombat.phase is a non-enum string, return None
    (atomic-resolved combat from older code paths)."""
    g = _game({'pendingCombat': {'phase': 'legacy_atomic_string'}})
    assert get_phase(g) is None


def test_set_and_get_phase_round_trip():
    g = _game({'pendingCombat': {}})
    set_phase(g, CombatPhase.ROLL)
    assert get_phase(g) == CombatPhase.ROLL
    # The stored value is the enum value (str), not the enum itself.
    assert g['pendingCombat']['phase'] == 'roll'


def test_set_phase_creates_pending_combat_if_missing():
    g = _game()
    set_phase(g, CombatPhase.DECLARE)
    assert 'pendingCombat' in g
    assert g['pendingCombat']['phase'] == 'declare'


def test_open_gate_sets_full_shape():
    g = _game({'pendingCombat': {}})
    open_gate(g, CombatPhase.ROLL)
    gate = g['pendingCombat']['combatGate']
    assert gate == {'phase': 'roll', 'p1Ready': False, 'p2Ready': False}


def test_get_gate_returns_dataclass():
    g = _game({'pendingCombat': {
        'combatGate': {'phase': 'roll', 'p1Ready': True, 'p2Ready': False},
    }})
    gate = get_gate(g)
    assert gate is not None
    assert gate.phase == 'roll'
    assert gate.p1Ready is True
    assert gate.p2Ready is False


def test_get_gate_returns_none_when_absent():
    assert get_gate(_game()) is None
    assert get_gate(_game({'pendingCombat': {}})) is None


def test_clear_gate_removes_only_the_gate():
    g = _game({'pendingCombat': {
        'phase': 'roll',
        'combatGate': {'phase': 'roll', 'p1Ready': True, 'p2Ready': True},
        'attackerKey': 'foo-1-0',
    }})
    clear_gate(g)
    assert 'combatGate' not in g['pendingCombat']
    # The rest of pendingCombat is untouched.
    assert g['pendingCombat']['phase'] == 'roll'
    assert g['pendingCombat']['attackerKey'] == 'foo-1-0'


def test_clear_gate_idempotent():
    """Clearing when no gate is set must not crash."""
    g = _game({'pendingCombat': {}})
    clear_gate(g)  # should not raise
    assert g['pendingCombat'] == {}


# ── Self-play detection ─────────────────────────────────────────────────


def test_is_self_play_false_when_unset():
    assert is_self_play(_game()) is False
    assert is_self_play(_game({})) is False


def test_is_self_play_true_when_self_play_set():
    assert is_self_play(_game({'selfPlay': True})) is True


def test_is_self_play_true_when_headless_set():
    """Self-play and headless are equivalent for gate auto-advance."""
    assert is_self_play(_game({'headless': True})) is True


# ── End-to-end transition smoke ─────────────────────────────────────────


def test_walk_all_16_phases_without_crashing():
    """Set/get every phase in canonical order. Validates the enum
    values round-trip cleanly through the helpers and the dict."""
    g = _game()
    for p in PHASE_ORDER:
        set_phase(g, p)
        assert get_phase(g) == p


def test_gate_open_then_clear_transitions():
    """Open a gate, mark both ready (via direct dict mutation), clear."""
    g = _game()
    set_phase(g, CombatPhase.ROLL)
    open_gate(g, CombatPhase.POST_ROLL_GATE)
    assert get_gate(g) is not None
    g['pendingCombat']['combatGate']['p1Ready'] = True
    g['pendingCombat']['combatGate']['p2Ready'] = True
    assert get_gate(g).both_ready() is True
    clear_gate(g)
    assert get_gate(g) is None
