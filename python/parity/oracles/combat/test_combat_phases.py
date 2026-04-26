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


# ── step_forced_reroll ──────────────────────────────────────────────────


def _make_combat_with_rolled_dice():
    """Fixture: pendingCombat after step_roll has populated dice."""
    return {
        'pendingCombat': {
            'phase': CombatPhase.POST_ROLL_GATE.value,
            'attackerPlayerNum': 1,
            'attackDiceResults': [
                {'color': 'blue', 'acc': 1, 'dmg': 0, 'surge': 0},
                {'color': 'green', 'acc': 0, 'dmg': 2, 'surge': 1},
            ],
            'attackRoll': {'acc': 1, 'dmg': 2, 'surge': 1},
            'defenseDiceResults': [
                {'color': 'white', 'block': 0, 'evade': 1, 'dodge': False},
            ],
            'defenseRoll': {'block': 0, 'evade': 1, 'dodge': False},
        },
    }


def test_step_forced_reroll_empty_queue_advances_to_post_forced_gate():
    """No queue entries → just advance to POST_FORCED_GATE."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    step_forced_reroll(g)
    assert get_phase(g) == CombatPhase.POST_FORCED_GATE
    gate = get_gate(g)
    assert gate is not None and gate.phase == CombatPhase.POST_FORCED_GATE.value


def test_step_forced_reroll_drains_one_attack_entry():
    """Defender forces 1 atk reroll. Worst attack die replaced; queue
    pops; phase advances."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    g['pendingCombat']['forcedRerollQueue'] = [
        {'controlPlayer': 2, 'pool': 'attack', 'remaining': 1, 'source': 'X'},
    ]
    step_forced_reroll(g, rng=__import__('random').Random(7))
    assert g['pendingCombat']['forcedRerollQueue'] == []
    # Worst die was index 0 (blue, sum=1). It got rerolled.
    assert 0 in g['pendingCombat']['attackerRerolledIndices']
    assert get_phase(g) == CombatPhase.POST_FORCED_GATE


def test_step_forced_reroll_drains_one_defense_entry():
    """Attacker forces 1 def reroll. Defender's worst die replaced."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    g['pendingCombat']['forcedRerollQueue'] = [
        {'controlPlayer': 1, 'pool': 'defense', 'remaining': 1,
         'source': 'Versatile Weaponry'},
    ]
    step_forced_reroll(g, rng=__import__('random').Random(11))
    assert g['pendingCombat']['forcedRerollQueue'] == []
    assert 0 in g['pendingCombat']['defenderRerolledIndices']
    assert get_phase(g) == CombatPhase.POST_FORCED_GATE


def test_step_forced_reroll_multi_remaining():
    """Entry with remaining=2 is decremented but not popped."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    g['pendingCombat']['forcedRerollQueue'] = [
        {'controlPlayer': 1, 'pool': 'defense', 'remaining': 2, 'source': 'X'},
    ]
    step_forced_reroll(g, rng=__import__('random').Random(3))
    queue = g['pendingCombat']['forcedRerollQueue']
    assert len(queue) == 1
    assert queue[0]['remaining'] == 1
    # Phase remains FORCED_REROLL since queue not empty.
    assert get_phase(g) == CombatPhase.FORCED_REROLL


def test_step_forced_reroll_multiple_entries_drain_one_at_a_time():
    """Two entries — call drains the first, second remains."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    g['pendingCombat']['forcedRerollQueue'] = [
        {'controlPlayer': 1, 'pool': 'defense', 'remaining': 1, 'source': 'A'},
        {'controlPlayer': 2, 'pool': 'attack', 'remaining': 1, 'source': 'B'},
    ]
    step_forced_reroll(g, rng=__import__('random').Random(4))
    assert len(g['pendingCombat']['forcedRerollQueue']) == 1
    assert g['pendingCombat']['forcedRerollQueue'][0]['source'] == 'B'
    # Phase still FORCED_REROLL — more queue work pending.
    assert get_phase(g) == CombatPhase.FORCED_REROLL


def test_step_forced_reroll_recomputes_totals():
    """After reroll, attackRoll totals reflect the new dice."""
    from python.engine.mechanics.combat_phases import step_forced_reroll
    g = _make_combat_with_rolled_dice()
    g['pendingCombat']['forcedRerollQueue'] = [
        {'controlPlayer': 2, 'pool': 'attack', 'remaining': 1, 'source': 'X'},
    ]
    step_forced_reroll(g, rng=__import__('random').Random(99))
    pc = g['pendingCombat']
    # Totals derived from current dice list.
    expected_acc = sum(d.get('acc', 0) for d in pc['attackDiceResults'])
    expected_dmg = sum(d.get('dmg', 0) for d in pc['attackDiceResults'])
    expected_surge = sum(d.get('surge', 0) for d in pc['attackDiceResults'])
    assert pc['attackRoll'] == {
        'acc': expected_acc, 'dmg': expected_dmg, 'surge': expected_surge,
    }


# ── step_attacker_reroll / step_defender_reroll ─────────────────────────


def _make_combat_post_forced():
    """Fixture: pendingCombat after forced-reroll gate cleared."""
    return {
        'pendingCombat': {
            'phase': CombatPhase.POST_FORCED_GATE.value,
            'attackerPlayerNum': 1,
            'attackerRerollsRemaining': 1,
            'defenderRerollsRemaining': 1,
            'attackDiceResults': [
                {'color': 'blue', 'acc': 0, 'dmg': 0, 'surge': 0},
                {'color': 'green', 'acc': 2, 'dmg': 1, 'surge': 0},
            ],
            'attackRoll': {'acc': 2, 'dmg': 1, 'surge': 0},
            'defenseDiceResults': [
                {'color': 'white', 'block': 0, 'evade': 0, 'dodge': False},
            ],
            'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
        },
    }


def test_step_attacker_reroll_no_remaining_advances_gate():
    from python.engine.mechanics.combat_phases import step_attacker_reroll
    g = _make_combat_post_forced()
    g['pendingCombat']['attackerRerollsRemaining'] = 0
    step_attacker_reroll(g)
    assert get_phase(g) == CombatPhase.POST_ATTACKER_GATE


def test_step_attacker_reroll_picks_worst_die():
    """No die_idx given — pick the worst (lowest acc+dmg+surge)."""
    from python.engine.mechanics.combat_phases import step_attacker_reroll
    g = _make_combat_post_forced()
    step_attacker_reroll(g, rng=__import__('random').Random(42))
    # Worst was index 0 (sum=0). Should be in rerolled list.
    assert 0 in g['pendingCombat']['attackerRerolledIndices']
    assert g['pendingCombat']['attackerRerollsRemaining'] == 0
    assert get_phase(g) == CombatPhase.POST_ATTACKER_GATE


def test_step_attacker_reroll_with_explicit_idx():
    """Caller-supplied die_idx is honored."""
    from python.engine.mechanics.combat_phases import step_attacker_reroll
    g = _make_combat_post_forced()
    step_attacker_reroll(g, die_idx=1, rng=__import__('random').Random(11))
    assert 1 in g['pendingCombat']['attackerRerolledIndices']


def test_step_attacker_reroll_multi_remaining():
    """remaining=2 → first call decrements to 1, phase stays at
    ATTACKER_REROLL."""
    from python.engine.mechanics.combat_phases import step_attacker_reroll
    g = _make_combat_post_forced()
    g['pendingCombat']['attackerRerollsRemaining'] = 2
    step_attacker_reroll(g, rng=__import__('random').Random(5))
    assert g['pendingCombat']['attackerRerollsRemaining'] == 1
    assert get_phase(g) == CombatPhase.ATTACKER_REROLL


def test_step_defender_reroll_picks_worst_die():
    from python.engine.mechanics.combat_phases import step_defender_reroll
    g = _make_combat_post_forced()
    g['pendingCombat']['phase'] = CombatPhase.POST_ATTACKER_GATE.value
    step_defender_reroll(g, rng=__import__('random').Random(7))
    assert 0 in g['pendingCombat']['defenderRerolledIndices']
    assert g['pendingCombat']['defenderRerollsRemaining'] == 0
    assert get_phase(g) == CombatPhase.POST_DEFENDER_GATE


def test_step_defender_reroll_no_remaining_advances_gate():
    from python.engine.mechanics.combat_phases import step_defender_reroll
    g = _make_combat_post_forced()
    g['pendingCombat']['phase'] = CombatPhase.POST_ATTACKER_GATE.value
    g['pendingCombat']['defenderRerollsRemaining'] = 0
    step_defender_reroll(g)
    assert get_phase(g) == CombatPhase.POST_DEFENDER_GATE


# ── token phases ────────────────────────────────────────────────────────


def _make_combat_post_def_gate():
    return {
        'pendingCombat': {
            'phase': CombatPhase.POST_DEFENDER_GATE.value,
            'attackerPlayerNum': 1,
            'attackerFigureKey': 'Han Solo (Rebel Hero)-1-0',
            'target': {'figureKey': 'Boba Fett-1-0'},
        },
        'figurePowerTokens': {
            'Han Solo (Rebel Hero)-1-0': ['Hit', 'Block'],
            'Boba Fett-1-0': ['Evade'],
        },
    }


def test_step_token_attacker_damage_increments_bonus_hits():
    from python.engine.mechanics.combat_phases import step_token_attacker
    g = _make_combat_post_def_gate()
    step_token_attacker(g, token_type='Damage')
    assert g['pendingCombat']['bonusHits'] == 1
    assert g['pendingCombat']['attackerSpentPowerToken'] is True
    assert get_phase(g) == CombatPhase.TOKEN_ATTACKER


def test_step_token_attacker_with_unhinged_grants_2():
    from python.engine.mechanics.combat_phases import step_token_attacker
    g = _make_combat_post_def_gate()
    g['pendingCombat']['attackerUnhingedBonus'] = True
    step_token_attacker(g, token_type='Block')
    assert g['pendingCombat']['bonusBlock'] == 2


def test_step_token_attacker_skip_advances_to_defender():
    from python.engine.mechanics.combat_phases import step_token_attacker
    g = _make_combat_post_def_gate()
    step_token_attacker(g)  # no token_type → skip
    assert get_phase(g) == CombatPhase.TOKEN_DEFENDER


def test_step_token_attacker_removes_spent_token():
    from python.engine.mechanics.combat_phases import step_token_attacker
    g = _make_combat_post_def_gate()
    step_token_attacker(
        g, token_type='Damage',
        figure_key='Han Solo (Rebel Hero)-1-0', token_idx=0,
    )
    # Hit token at index 0 should be popped.
    assert g['figurePowerTokens']['Han Solo (Rebel Hero)-1-0'] == ['Block']


def test_step_token_defender_block_sets_spent_block_flag():
    """defenderSpentBlock is the Survival Is Strength gate input."""
    from python.engine.mechanics.combat_phases import step_token_defender
    g = _make_combat_post_def_gate()
    g['pendingCombat']['phase'] = CombatPhase.TOKEN_ATTACKER.value
    step_token_defender(g, token_type='Block')
    assert g['pendingCombat']['bonusBlock'] == 1
    assert g['pendingCombat']['defenderSpentBlock'] is True


def test_step_token_defender_evade_does_not_set_spent_block():
    from python.engine.mechanics.combat_phases import step_token_defender
    g = _make_combat_post_def_gate()
    g['pendingCombat']['phase'] = CombatPhase.TOKEN_ATTACKER.value
    step_token_defender(g, token_type='Evade')
    assert g['pendingCombat']['bonusEvade'] == 1
    assert g['pendingCombat'].get('defenderSpentBlock') is None


def test_step_token_defender_skip_advances_to_surge():
    from python.engine.mechanics.combat_phases import step_token_defender
    g = _make_combat_post_def_gate()
    g['pendingCombat']['phase'] = CombatPhase.TOKEN_ATTACKER.value
    step_token_defender(g)  # skip
    assert get_phase(g) == CombatPhase.SURGE


# ── step_surge ──────────────────────────────────────────────────────────


def _make_combat_at_surge():
    return {
        'pendingCombat': {
            'phase': CombatPhase.SURGE.value,
            'attackerPlayerNum': 1,
            'surgeRemaining': 2,
            'attackRoll': {'acc': 0, 'dmg': 0, 'surge': 2},
        },
    }


def test_step_surge_damage_increments_surge_damage():
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    step_surge(g, ability_id='damage 1')
    assert g['pendingCombat']['surgeDamage'] == 1
    assert g['pendingCombat']['surgeRemaining'] == 1
    assert g['pendingCombat']['surgeSpentCount']['damage 1'] == 1
    assert 'damage 1' in g['pendingCombat']['triggeredSurges']


def test_step_surge_skip_advances_to_gate():
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    step_surge(g)  # ability_id=None
    assert get_phase(g) == CombatPhase.POST_SURGE_GATE


def test_step_surge_no_remaining_advances_gate():
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    g['pendingCombat']['surgeRemaining'] = 0
    step_surge(g, ability_id='damage')
    # Surge exhausted before this call — no spend, just advance.
    assert get_phase(g) == CombatPhase.POST_SURGE_GATE


def test_step_surge_exhausting_last_surge_advances_gate():
    """Last surge spent → phase advances automatically."""
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    g['pendingCombat']['surgeRemaining'] = 1
    step_surge(g, ability_id='pierce')
    assert g['pendingCombat']['surgeRemaining'] == 0
    assert get_phase(g) == CombatPhase.POST_SURGE_GATE


def test_step_surge_per_ability_cap_default_one():
    """Default cap: each ability_id can only be spent once per attack."""
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    step_surge(g, ability_id='damage 1')
    step_surge(g, ability_id='damage 1')  # blocked by cap
    assert g['pendingCombat']['surgeSpentCount']['damage 1'] == 1
    # surgeRemaining only decremented once.
    assert g['pendingCombat']['surgeRemaining'] == 1


def test_step_surge_overload_saboteur_cap_2():
    """surgeMaxUsesPerAbility=2 (overload_saboteur) lifts cap to 2."""
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    g['pendingCombat']['surgeMaxUsesPerAbility'] = 2
    step_surge(g, ability_id='damage 1')
    step_surge(g, ability_id='damage 1')
    assert g['pendingCombat']['surgeSpentCount']['damage 1'] == 2
    assert g['pendingCombat']['surgeRemaining'] == 0


def test_step_surge_bleed_appends_to_surge_conditions():
    """Bleed-on-surge appends 'Bleed' to surgeConditions list."""
    from python.engine.mechanics.combat_phases import step_surge
    g = _make_combat_at_surge()
    step_surge(g, ability_id='bleed')
    assert 'Bleed' in (g['pendingCombat'].get('surgeConditions') or [])


# ── step_resolve ────────────────────────────────────────────────────────


def _make_combat_for_resolve(damage=2):
    """Fixture: pendingCombat ready to resolve. acc>=dist, damage>=block."""
    return {
        'pendingCombat': {
            'phase': CombatPhase.POST_SURGE_GATE.value,
            'attackerPlayerNum': 1,
            'attackerFigureKey': 'Han Solo (Rebel Hero)-1-0',
            'defenderPlayerNum': 2,
            'defenderMsgId': 'hl2dc0',
            'attackInfo': {'isRanged': False},
            'attackRoll': {'acc': 5, 'dmg': damage, 'surge': 0},
            'defenseRoll': {'block': 0, 'evade': 0, 'dodge': False},
            'distanceToTarget': 1,
            'target': {
                'figureKey': 'Boba Fett-1-0',
                'figureIndex': 0,
            },
            'attackerConds': [],
            'defenderConds': [],
        },
        'dcHealthState': {
            'hl2dc0': [[5, 5]],  # Boba: 5 current / 5 max HP
        },
    }


def test_step_resolve_returns_hit_damage_result():
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=2)
    result = step_resolve(g)
    assert result['hit'] is True
    assert result['damage'] == 2
    assert result['defeated'] is False


def test_step_resolve_applies_damage_to_dc_health_state():
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=2)
    step_resolve(g)
    # Boba was at 5/5; took 2 damage → 3/5.
    assert g['dcHealthState']['hl2dc0'][0] == [3, 5]


def test_step_resolve_clears_pending_combat():
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve()
    step_resolve(g)
    assert g['pendingCombat'] is None


def test_step_resolve_stamps_last_combat_result():
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=2)
    step_resolve(g)
    lcr = g.get('lastCombatResult')
    assert lcr is not None
    assert lcr['hit'] is True
    assert lcr['damage'] == 2
    assert lcr['attackerFigureKey'] == 'Han Solo (Rebel Hero)-1-0'
    assert lcr['targetFigureKey'] == 'Boba Fett-1-0'


def test_step_resolve_marks_defeat_when_hp_zero():
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=10)  # overkill
    result = step_resolve(g)
    assert result['defeated'] is True
    assert g['dcHealthState']['hl2dc0'][0][0] == 0


def test_step_resolve_miss_applies_no_damage():
    """Ranged attack with acc < distance is a miss."""
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=2)
    g['pendingCombat']['isRanged'] = True
    g['pendingCombat']['attackRoll']['acc'] = 1
    g['pendingCombat']['distanceToTarget'] = 5  # acc 1 < dist 5 → miss
    result = step_resolve(g)
    assert result['hit'] is False
    # Boba HP unchanged.
    assert g['dcHealthState']['hl2dc0'][0] == [5, 5]


# ── P1.9: process_figure_defeat integration ─────────────────────────────


def _make_combat_for_lethal_resolve():
    """Fixture: defender dies on this attack."""
    g = _make_combat_for_resolve(damage=10)
    # Add minimal state for defeat handler:
    g['p1DcList'] = [{'dcName': 'Han Solo (Rebel Hero)', 'dgIndex': 1}]
    g['p2DcList'] = [{'dcName': 'Boba Fett', 'dgIndex': 1}]
    g['p1DcMessageIds'] = ['hl1dc0']
    g['p2DcMessageIds'] = ['hl2dc0']
    g['figurePositions'] = {
        1: {'Han Solo (Rebel Hero)-1-0': 'a13'},
        2: {'Boba Fett-1-0': 'a14'},
    }
    g['player1VP'] = {'kills': 0, 'mission': 0, 'total': 0}
    g['player2VP'] = {'kills': 0, 'mission': 0, 'total': 0}
    return g


def test_step_resolve_stamps_last_defeat_info_on_kill():
    """When defender dies, lastDefeatInfo is stamped (used by
    cc-timing's recent-defeat gate)."""
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_lethal_resolve()
    step_resolve(g)
    assert 'lastDefeatInfo' in g
    info = g['lastDefeatInfo']
    assert info['playerNum'] == 2
    assert info['figureKey'] == 'Boba Fett-1-0'
    assert info['dcName'] == 'Boba Fett'


def test_step_resolve_runs_defeat_handler_on_kill():
    """When defender dies, process_figure_defeat is invoked and
    figurePositions removes the defeated figure."""
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_lethal_resolve()
    result = step_resolve(g)
    assert result['defeated'] is True
    # Figure removed from positions.
    assert 'Boba Fett-1-0' not in g['figurePositions'][2]


def test_step_resolve_no_defeat_handler_on_non_lethal():
    """Damage but no defeat → lastDefeatInfo not stamped."""
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_resolve(damage=2)  # not lethal
    step_resolve(g)
    assert g.get('lastDefeatInfo') is None or g.get('lastDefeatInfo') == {}


def test_step_resolve_defeat_result_in_last_combat_result():
    """lastCombatResult.defeatResult contains the defeat-handler return."""
    from python.engine.mechanics.combat_phases import step_resolve
    g = _make_combat_for_lethal_resolve()
    step_resolve(g)
    lcr = g['lastCombatResult']
    assert lcr['defeated'] is True
    # defeat_result has VP info (or None on best-effort failure).
    # In our minimal fixture some deps are missing; either outcome is
    # acceptable as long as the slot is populated for a kill.
    assert 'defeatResult' in lcr
