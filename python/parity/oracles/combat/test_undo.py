"""P1.14 verification: undo stack push/pop infrastructure."""
from python.engine.mechanics.undo import (
    UNDO_STACK_MAX,
    clear_undo,
    peek_undo,
    pop_undo,
    push_undo,
)


def test_push_undo_appends_snapshot():
    g = {'figurePositions': {1: {'X-1-0': 'a1'}}}
    push_undo(g)
    assert 'undoStack' in g
    assert len(g['undoStack']) == 1
    assert g['undoStack'][0]['figurePositions'] == {1: {'X-1-0': 'a1'}}


def test_push_undo_deep_copies_state():
    """Mutating the live state after push doesn't affect the snapshot."""
    g = {'figurePositions': {1: {'X-1-0': 'a1'}}}
    push_undo(g)
    # Mutate live state.
    g['figurePositions'][1]['X-1-0'] = 'a2'
    assert g['undoStack'][0]['figurePositions'][1]['X-1-0'] == 'a1'


def test_push_undo_excludes_undo_stack_itself():
    """Snapshot doesn't recursively include undoStack."""
    g = {'figurePositions': {}, 'undoStack': []}
    push_undo(g)
    assert 'undoStack' not in g['undoStack'][0]


def test_push_undo_excludes_last_results():
    """Per-step ephemera (lastCombatResult, lastDcSpecialResult, etc.)
    are not snapshotted — they belong to the moment, not the state."""
    g = {
        'figurePositions': {},
        'lastCombatResult': {'hit': True},
        'lastDcSpecialResult': {'applied': True},
    }
    push_undo(g)
    snapshot = g['undoStack'][0]
    assert 'lastCombatResult' not in snapshot
    assert 'lastDcSpecialResult' not in snapshot


def test_pop_undo_restores_previous_state():
    g = {'figurePositions': {1: {'X-1-0': 'a1'}}}
    push_undo(g)
    g['figurePositions'][1]['X-1-0'] = 'a2'
    assert pop_undo(g) is True
    assert g['figurePositions'][1]['X-1-0'] == 'a1'


def test_pop_undo_returns_false_on_empty_stack():
    g = {}
    assert pop_undo(g) is False


def test_pop_undo_does_not_touch_excluded_fields():
    """Excluded fields are not restored — they keep their post-action value."""
    g = {'figurePositions': {1: {}}, 'lastCombatResult': {'hit': True}}
    push_undo(g)
    g['lastCombatResult'] = {'hit': False}
    pop_undo(g)
    # lastCombatResult is excluded → not restored.
    assert g['lastCombatResult'] == {'hit': False}


def test_stack_capped_at_max_entries():
    """Once stack exceeds UNDO_STACK_MAX, oldest snapshots discarded."""
    g = {'figurePositions': {1: {}}, 'counter': 0}
    for i in range(UNDO_STACK_MAX + 5):
        g['counter'] = i
        push_undo(g)
    assert len(g['undoStack']) == UNDO_STACK_MAX


def test_peek_undo_does_not_pop():
    g = {'figurePositions': {1: {'X': 'a'}}}
    push_undo(g)
    snap = peek_undo(g)
    assert snap is not None
    assert len(g['undoStack']) == 1  # not popped


def test_peek_undo_none_on_empty_stack():
    assert peek_undo({}) is None


def test_clear_undo_empties_stack():
    g = {'figurePositions': {}}
    push_undo(g)
    push_undo(g)
    clear_undo(g)
    assert g['undoStack'] == []


def test_undo_round_trips_through_complex_state():
    """Realistic snapshot: figure positions, conditions, VP, combat state."""
    g = {
        'figurePositions': {
            1: {'Han-1-0': 'a13', 'Chewie-1-0': 'a12'},
            2: {'Boba-1-0': 'a14'},
        },
        'figureConditions': {'Boba-1-0': ['Bleed']},
        'player1VP': {'kills': 2, 'mission': 8, 'total': 10},
        'pendingCombat': None,
    }
    push_undo(g)
    # Mutate everything.
    g['figurePositions'][1]['Han-1-0'] = 'b14'
    g['figureConditions']['Boba-1-0'].append('Stun')
    g['player1VP']['total'] = 15
    g['pendingCombat'] = {'phase': 'roll'}
    # Restore.
    pop_undo(g)
    assert g['figurePositions'][1]['Han-1-0'] == 'a13'
    assert g['figureConditions']['Boba-1-0'] == ['Bleed']
    assert g['player1VP']['total'] == 10
    assert g['pendingCombat'] is None
