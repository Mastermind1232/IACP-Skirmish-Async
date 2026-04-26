"""P2.3 verification: end-of-activation effects integrate cleanup_activation.

Validates that apply_end_of_activation_effects clears all activation-scoped
flags at its tail. Without this, accumulated activation state leaks across
DC activations and causes drift vs JS.
"""
from unittest.mock import patch

from python.engine.mechanics.activation_effects import (
    apply_end_of_activation_effects,
)
from python.engine.mechanics.activation_state import (
    ACTIVATION_FIGKEY_FLAGS,
    ACTIVATION_MSGID_FLAGS,
    ACTIVATION_PLAYERNUM_FLAGS,
    ACTIVATION_SCALAR_FLAGS,
)


def _base_game(dc_name='Han', player_num=1, msg_id='hl1dc0', dg=1):
    """Game fixture with all activation flag categories populated."""
    fk0 = f'{dc_name}-{dg}-0'
    fk1 = f'{dc_name}-{dg}-1'
    g = {
        'figurePositions': {1: {fk0: 'a13', fk1: 'a14'}, 2: {}},
        'figureConditions': {},
        'figurePowerTokens': {},
        'dcHealthState': {},
    }
    # Stamp every msgid flag.
    for k in ACTIVATION_MSGID_FLAGS:
        g[k] = {msg_id: 'set'}
    # Stamp every figkey flag.
    for k in ACTIVATION_FIGKEY_FLAGS:
        g[k] = {fk0: 'set', fk1: 'set'}
    # Stamp every playernum flag.
    for k in ACTIVATION_PLAYERNUM_FLAGS:
        g[k] = {player_num: 'set'}
    # Stamp every scalar flag.
    for k in ACTIVATION_SCALAR_FLAGS:
        g[k] = 'set'
    # moveInProgress with compound key.
    g['moveInProgress'] = {f'{msg_id}_0': 'mid_move', 'other_0': 'keep'}
    return g, fk0, fk1


def test_end_of_activation_clears_all_msgid_flags():
    g, _, _ = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_MSGID_FLAGS:
        d = g.get(k)
        assert isinstance(d, dict)
        assert 'hl1dc0' not in d, f'{k} still has hl1dc0'


def test_end_of_activation_clears_figkey_flags_for_active_group():
    g, fk0, fk1 = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_FIGKEY_FLAGS:
        d = g.get(k) or {}
        assert fk0 not in d, f'{k} still has {fk0}'
        assert fk1 not in d, f'{k} still has {fk1}'


def test_end_of_activation_clears_playernum_flags():
    g, _, _ = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_PLAYERNUM_FLAGS:
        d = g.get(k) or {}
        assert 1 not in d and '1' not in d, f'{k} still has player 1'


def test_end_of_activation_deletes_scalar_flags():
    g, _, _ = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_SCALAR_FLAGS:
        assert k not in g, f'{k} still in game'


def test_end_of_activation_clears_move_in_progress_for_msgid():
    g, _, _ = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    mip = g.get('moveInProgress') or {}
    assert 'hl1dc0_0' not in mip
    # Other-msgid entries preserved.
    assert mip.get('other_0') == 'keep'


def test_end_of_activation_preserves_other_player_flags():
    """Cleaning up player 1's activation must not clear player 2's flags."""
    g, _, _ = _base_game(player_num=1)
    # Stamp player 2 onto playernum flags too.
    for k in ACTIVATION_PLAYERNUM_FLAGS:
        g[k][2] = 'p2_set'
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_PLAYERNUM_FLAGS:
        d = g.get(k) or {}
        assert d.get(2) == 'p2_set', f'{k} lost p2 entry'


def test_end_of_activation_preserves_other_msgid_flags():
    """Cleaning hl1dc0 must not clear hl1dc1."""
    g, _, _ = _base_game()
    for k in ACTIVATION_MSGID_FLAGS:
        g[k]['hl1dc1'] = 'preserve'
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    for k in ACTIVATION_MSGID_FLAGS:
        d = g.get(k) or {}
        assert d.get('hl1dc1') == 'preserve', f'{k} lost hl1dc1'


def test_end_of_activation_returns_applied_dict():
    """Cleanup runs at tail; return shape unchanged."""
    g, _, _ = _base_game()
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value={'Han': {'passives': []}},
    ):
        result = apply_end_of_activation_effects(
            g, dc_name='Han', player_num=1, display_name='Han', msg_id='hl1dc0',
        )
    assert 'applied' in result
    assert isinstance(result['applied'], list)
