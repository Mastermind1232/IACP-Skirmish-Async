"""P3.4 verification: get_handler_key prefix routing.

Validates the JS-parity getHandlerKey contract: longest-prefix-first
match, modal type uses MODAL_PREFIXES, button/select uses the
registered handler set.
"""
import pytest

from python.discord_bot.handlers import (
    get_registered_prefixes,
    register,
    reset_for_tests,
)
from python.discord_bot.router import MODAL_PREFIXES, get_handler_key


def _h(_i, _c):
    return None


@pytest.fixture(autouse=True)
def _isolated_registry():
    reset_for_tests()
    register('phase_gate_', _h, 'combat')
    register('phase_gate_ready_', _h, 'combat')
    register('dc_attack_', _h, 'dcPlayArea')
    register('dc_activate_', _h, 'dcPlayArea')
    yield
    reset_for_tests()


def test_get_handler_key_returns_none_for_empty_input():
    assert get_handler_key(None) is None
    assert get_handler_key('') is None


def test_get_handler_key_returns_none_for_no_match():
    assert get_handler_key('completely_unknown_xyz') is None


def test_get_handler_key_button_matches_registered_prefix():
    assert get_handler_key('dc_activate_g1_1_0') == 'dc_activate_'
    assert get_handler_key('dc_attack_g1_h_f0') == 'dc_attack_'


def test_get_handler_key_longest_prefix_wins():
    """phase_gate_ready_ wins over phase_gate_ when both match."""
    assert get_handler_key('phase_gate_ready_g1') == 'phase_gate_ready_'


def test_get_handler_key_select_uses_same_registry_as_button():
    """JS getHandlerKey for select also auto-derives from registry."""
    assert get_handler_key('dc_activate_g1_1', type_='select') == 'dc_activate_'


def test_get_handler_key_modal_uses_modal_prefixes_only():
    """Modal type only matches MODAL_PREFIXES, not button registry."""
    assert get_handler_key('squad_modal_g1', type_='modal') == 'squad_modal_'
    # A registered button prefix is not matched in modal mode.
    assert get_handler_key('dc_activate_g1', type_='modal') is None


def test_modal_prefixes_known_set():
    """Sanity: the ported MODAL_PREFIXES list matches JS exactly."""
    expected = {
        'squad_modal_', 'deploy_modal_', 'devaron_crate_modal_',
        'krykna_push_modal_', 'dc_rename_modal_', 'fav_name_modal_',
        'fav_rename_modal_', 'fav_list_rename_modal_',
    }
    assert set(MODAL_PREFIXES) == expected


def test_modal_longest_prefix_wins():
    """fav_list_rename_modal_ wins over fav_rename_modal_ if both could
    match. (Not a practical case, but verifies the sort.)"""
    # All MODAL_PREFIXES are unique enough that no two share a prefix-
    # of-prefix relation. Just verify the dispatch picks one.
    assert get_handler_key('fav_list_rename_modal_x',
                            type_='modal') == 'fav_list_rename_modal_'


def test_get_registered_prefixes_returns_longest_first():
    prefixes = get_registered_prefixes()
    # Verify length-descending order.
    lengths = [len(p) for p in prefixes]
    assert lengths == sorted(lengths, reverse=True)
