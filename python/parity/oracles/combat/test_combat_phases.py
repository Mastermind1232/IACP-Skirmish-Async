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


# ── step_roll ──────────────────────────────────────────────────────────


def _make_combat_for_roll():
    """Minimal fixture: pendingCombat set up with declared attack info,
    ready to roll."""
    return {
        'pendingCombat': {
            'phase': CombatPhase.DECLARE.value,
            'attackInfo': {'dice': ['blue', 'green']},
            'target': {'defense': ['white']},
        },
    }


def test_step_roll_populates_attack_results():
    from python.engine.mechanics.combat_phases import step_roll
    g = _make_combat_for_roll()
    step_roll(g, rng=__import__('random').Random(42))
    pc = g['pendingCombat']
    assert 'attackDiceResults' in pc
    assert isinstance(pc['attackDiceResults'], list)
    assert len(pc['attackDiceResults']) == 2  # two attack dice rolled
    assert 'attackRoll' in pc
    assert {'acc', 'dmg', 'surge'} <= set(pc['attackRoll'].keys())


def test_step_roll_populates_defense_results():
    from python.engine.mechanics.combat_phases import step_roll
    g = _make_combat_for_roll()
    step_roll(g, rng=__import__('random').Random(7))
    pc = g['pendingCombat']
    assert 'defenseDiceResults' in pc
    assert len(pc['defenseDiceResults']) == 1  # single white die
    assert 'defenseRoll' in pc
    assert {'block', 'evade', 'dodge'} <= set(pc['defenseRoll'].keys())


def test_step_roll_advances_to_post_roll_gate():
    from python.engine.mechanics.combat_phases import step_roll
    g = _make_combat_for_roll()
    step_roll(g, rng=__import__('random').Random(1))
    assert get_phase(g) == CombatPhase.POST_ROLL_GATE
    gate = get_gate(g)
    assert gate is not None
    assert gate.phase == CombatPhase.POST_ROLL_GATE.value
    assert gate.both_ready() is False


def test_step_roll_raises_when_no_pending_combat():
    from python.engine.mechanics.combat_phases import (
        CombatStateError,
        step_roll,
    )
    try:
        step_roll(_game())
        assert False, 'expected CombatStateError'
    except CombatStateError:
        pass


def test_step_roll_raises_when_no_attack_dice():
    from python.engine.mechanics.combat_phases import (
        CombatStateError,
        step_roll,
    )
    g = {'pendingCombat': {'phase': CombatPhase.DECLARE.value}}
    try:
        step_roll(g)
        assert False, 'expected CombatStateError'
    except CombatStateError:
        pass


def test_step_roll_handles_multi_color_defense():
    """Imperial Officer-style multi-die defense (white + black)."""
    from python.engine.mechanics.combat_phases import step_roll
    g = {
        'pendingCombat': {
            'phase': CombatPhase.DECLARE.value,
            'attackInfo': {'dice': ['blue']},
            'target': {'defense': ['white', 'black']},
        },
    }
    step_roll(g, rng=__import__('random').Random(99))
    pc = g['pendingCombat']
    assert len(pc['defenseDiceResults']) == 2


def test_step_roll_deterministic_with_same_rng_seed():
    """Same seed → same rolls. Required for AI training reproducibility."""
    from python.engine.mechanics.combat_phases import step_roll
    g1 = _make_combat_for_roll()
    g2 = _make_combat_for_roll()
    step_roll(g1, rng=__import__('random').Random(123))
    step_roll(g2, rng=__import__('random').Random(123))
    assert g1['pendingCombat']['attackDiceResults'] == g2['pendingCombat']['attackDiceResults']
    assert g1['pendingCombat']['defenseDiceResults'] == g2['pendingCombat']['defenseDiceResults']


# ── send_combat_gate / advance_combat_gate ──────────────────────────────


def test_send_combat_gate_sets_phase_and_opens_gate():
    from python.engine.mechanics.combat_phases import send_combat_gate
    g = _game({'pendingCombat': {}})
    send_combat_gate(g, CombatPhase.POST_ROLL_GATE)
    assert get_phase(g) == CombatPhase.POST_ROLL_GATE
    gate = get_gate(g)
    assert gate is not None
    assert gate.phase == CombatPhase.POST_ROLL_GATE.value
    assert gate.both_ready() is False


def test_advance_combat_gate_player1_only():
    """Single p1 click — gate stays open waiting for p2."""
    from python.engine.mechanics.combat_phases import (
        advance_combat_gate,
        send_combat_gate,
    )
    g = _game({'pendingCombat': {}})
    send_combat_gate(g, CombatPhase.POST_ROLL_GATE)
    advance_combat_gate(g, player_num=1)
    gate = get_gate(g)
    assert gate is not None  # still open
    assert gate.p1Ready is True
    assert gate.p2Ready is False


def test_advance_combat_gate_both_players_clears_gate():
    """p1 then p2 → gate clears."""
    from python.engine.mechanics.combat_phases import (
        advance_combat_gate,
        send_combat_gate,
    )
    g = _game({'pendingCombat': {}})
    send_combat_gate(g, CombatPhase.POST_ROLL_GATE)
    advance_combat_gate(g, player_num=1)
    advance_combat_gate(g, player_num=2)
    assert get_gate(g) is None  # cleared


def test_advance_combat_gate_self_play_auto():
    """In self-play mode, advance with player_num=0 sets both flags
    and clears the gate in one call."""
    from python.engine.mechanics.combat_phases import (
        advance_combat_gate,
        send_combat_gate,
    )
    g = _game({'pendingCombat': {}, 'selfPlay': True})
    send_combat_gate(g, CombatPhase.POST_ROLL_GATE)
    advance_combat_gate(g)  # no player_num — auto
    assert get_gate(g) is None


def test_advance_combat_gate_no_op_when_no_gate():
    """Calling advance with no gate open is a no-op (does not raise)."""
    from python.engine.mechanics.combat_phases import advance_combat_gate
    g = _game({'pendingCombat': {'phase': 'declare'}})
    advance_combat_gate(g, player_num=1)
    # No gate, no error, state unchanged.
    assert get_gate(g) is None
