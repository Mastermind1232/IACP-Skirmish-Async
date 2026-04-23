"""Tests for the round Discord handler."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Interaction:
    def __init__(self, custom_id, user_id='alice'):
        self.custom_id = custom_id
        self.user = _User(user_id)


def _fresh_registry():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import round as rd
    handlers.reset_for_tests()
    handlers.register('end_end_of_round_', rd._handle_end_end_of_round, 'round')
    handlers.register('end_start_of_round_', rd._handle_end_start_of_round, 'round')
    handlers.register('extra_armor_pick_', rd._handle_extra_armor_pick, 'round')
    handlers.register('extra_armor_confirm_', rd._handle_extra_armor_confirm, 'round')
    handlers.register('extra_armor_cancel_', rd._handle_extra_armor_cancel, 'round')
    handlers.register('sor_mission_reveal_', rd._handle_sor_mission_reveal, 'round')
    handlers.register('rogue_one_return_', rd._handle_rogue_one_return, 'round')
    handlers.register('imp_citadel_', rd._handle_imp_citadel, 'round')
    handlers.register('rbf_discard_', rd._handle_rbf_discard, 'round')
    handlers.register('prog_override_', rd._handle_prog_override, 'round')


def _two_figure_game(round_num=1):
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader._dc_effects = {
        'Rebel Trooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3, 'affiliation': 'Rebel',
        },
        'Stormtrooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3, 'affiliation': 'Imperial',
        },
    }
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'h8': ['h7']},
        'spaces': ['a1', 'a2', 'h7', 'h8'],
        'blocking': [], 'impassableEdges': [],
    }}
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['round'] = round_num
    g.data['roundPhase'] = 'end'
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    return g


def _cleanup():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_end_end_of_round_advances_round():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game(round_num=1)
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_end_of_round_G1')
        result = handler(_Interaction('end_end_of_round_G1'), ctx)
        assert result['ok'] is True
        assert result['round'] == 2
        assert result['roundPhase'] == 'activation'
    finally:
        _cleanup()


def test_end_end_of_round_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('end_end_of_round_')
    result = handler(_Interaction('end_end_of_round_'), {'get_game': lambda g: None})
    # game_not_found because empty gameId
    assert result['ok'] is False


def test_end_start_of_round_closes_window():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_start_of_round_G1')
        result = handler(_Interaction('end_start_of_round_G1', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['startOfRoundWhoseTurn'] is None
    finally:
        _cleanup()


def test_end_start_of_round_rejects_non_sor_holder():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_start_of_round_G1')
        result = handler(_Interaction('end_start_of_round_G1', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_sor_holder'
    finally:
        _cleanup()


def test_end_start_of_round_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('end_start_of_round_MISSING')
    result = handler(_Interaction('end_start_of_round_MISSING'),
                      {'get_game': lambda gid: None})
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


# ── Extra Armor ────────────────────────────────────────────────────────────

def test_extra_armor_pick_cycles_0_1_2_0():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingExtraArmor_p1'] = {'total': 4, 'allocation': {}}
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        cid = 'extra_armor_pick_G1_1_Rebel Trooper (Regular)-0-0'
        _, handler, _ = find_handler(cid)

        r1 = handler(_Interaction(cid, user_id='alice'), ctx)
        assert r1['ok'] is True and r1['tokenCount'] == 1
        r2 = handler(_Interaction(cid, user_id='alice'), ctx)
        assert r2['tokenCount'] == 2
        r3 = handler(_Interaction(cid, user_id='alice'), ctx)
        assert r3['tokenCount'] == 0
    finally:
        _cleanup()


def test_extra_armor_pick_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingExtraArmor_p1'] = {'total': 4, 'allocation': {}}
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        cid = 'extra_armor_pick_G1_1_Rebel Trooper (Regular)-0-0'
        _, handler, _ = find_handler(cid)
        result = handler(_Interaction(cid, user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


def test_extra_armor_confirm_requires_budget_exhausted():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingExtraArmor_p1'] = {
        'total': 4, 'allocation': {'Rebel Trooper (Regular)-0-0': 2},
    }
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('extra_armor_confirm_G1_1')
        result = handler(
            _Interaction('extra_armor_confirm_G1_1', user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'budget_not_exhausted'
        assert result['remaining'] == 2
    finally:
        _cleanup()


def test_extra_armor_confirm_applies_block_tokens():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingExtraArmor_p1'] = {
        'total': 4,
        'allocation': {
            'Rebel Trooper (Regular)-0-0': 2,
            'Rebel Trooper (Regular)-0-1': 2,
        },
    }
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('extra_armor_confirm_G1_1')
        result = handler(
            _Interaction('extra_armor_confirm_G1_1', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert len(result['applied']) == 2
        # Pending cleared
        assert g.data.get('pendingExtraArmor_p1') is None
        # Tokens granted
        tokens = (g.data.get('figurePowerTokens') or {})
        assert len(tokens.get('Rebel Trooper (Regular)-0-0') or []) == 2
        assert all(t == 'Block'
                    for t in tokens.get('Rebel Trooper (Regular)-0-0') or [])
    finally:
        _cleanup()


def test_extra_armor_cancel_is_noop():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('extra_armor_cancel_G1_1')
    result = handler(_Interaction('extra_armor_cancel_G1_1'), {})
    assert result['ok'] is True
    assert result['noop'] is True


# ── sor_mission_reveal ─────────────────────────────────────────────────────

def test_sor_mission_reveal_clears_flag():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingMissionSorReveal'] = True
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('sor_mission_reveal_G1')
        result = handler(
            _Interaction('sor_mission_reveal_G1', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert g.data.get('pendingMissionSorReveal') is False
    finally:
        _cleanup()


def test_sor_mission_reveal_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingMissionSorReveal'] = True
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('sor_mission_reveal_G1')
        result = handler(
            _Interaction('sor_mission_reveal_G1', user_id='stranger'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_a_player_in_game'
    finally:
        _cleanup()


def test_sor_mission_reveal_rejects_when_already_revealed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingMissionSorReveal'] = False
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('sor_mission_reveal_G1')
        result = handler(
            _Interaction('sor_mission_reveal_G1', user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'already_revealed'
    finally:
        _cleanup()


# ── rogue_one_return ───────────────────────────────────────────────────────

def test_rogue_one_return_moves_card_to_deck_top():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingRogueOne_p1'] = {'remaining': 2}
    g.data['player1CcHand'] = ['A', 'B', 'C']
    g.data['player1CcDeck'] = ['X', 'Y']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rogue_one_return_G1_1_1')  # card index 1 = 'B'
        result = handler(
            _Interaction('rogue_one_return_G1_1_1', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['card'] == 'B'
        assert result['remaining'] == 1
        assert g.data['player1CcHand'] == ['A', 'C']
        assert g.data['player1CcDeck'] == ['B', 'X', 'Y']
        # Pending still present with 1 remaining
        assert g.data['pendingRogueOne_p1']['remaining'] == 1
    finally:
        _cleanup()


def test_rogue_one_return_clears_pending_when_last_card():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingRogueOne_p1'] = {'remaining': 1}
    g.data['player1CcHand'] = ['A', 'B']
    g.data['player1CcDeck'] = []
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rogue_one_return_G1_1_0')
        result = handler(
            _Interaction('rogue_one_return_G1_1_0', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['remaining'] == 0
        assert g.data['pendingRogueOne_p1'] is None
        assert g.data['player1CcDeck'] == ['A']
    finally:
        _cleanup()


def test_rogue_one_return_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingRogueOne_p1'] = {'remaining': 2}
    g.data['player1CcHand'] = ['A', 'B']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rogue_one_return_G1_1_0')
        result = handler(
            _Interaction('rogue_one_return_G1_1_0', user_id='bob'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


def test_rogue_one_return_rejects_out_of_range_index():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['pendingRogueOne_p1'] = {'remaining': 2}
    g.data['player1CcHand'] = ['A']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rogue_one_return_G1_1_5')
        result = handler(
            _Interaction('rogue_one_return_G1_1_5', user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'card_index_out_of_range'
    finally:
        _cleanup()


def test_rogue_one_return_rejects_when_no_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rogue_one_return_G1_1_0')
        result = handler(
            _Interaction('rogue_one_return_G1_1_0', user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'no_pending_rogue_one'
    finally:
        _cleanup()


# ── imp_citadel ────────────────────────────────────────────────────────────

def test_imp_citadel_places_damage_token():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('imp_citadel_G1_1_damage')
        result = handler(
            _Interaction('imp_citadel_G1_1_damage', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['tokenType'] == 'damage'
        assert result['tokens'] == {'damage': 1, 'block': 0}
        assert g.data['imperialCitadelTokens']['damage'] == 1
    finally:
        _cleanup()


def test_imp_citadel_places_block_token_accumulates():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['imperialCitadelTokens'] = {'damage': 2, 'block': 1}
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('imp_citadel_G1_1_block')
        result = handler(
            _Interaction('imp_citadel_G1_1_block', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['tokens'] == {'damage': 2, 'block': 2}
    finally:
        _cleanup()


def test_imp_citadel_migrates_legacy_focus_to_block():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['imperialCitadelTokens'] = {'damage': 1, 'focus': 3}
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('imp_citadel_G1_1_block')
        result = handler(
            _Interaction('imp_citadel_G1_1_block', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        # focus (3) rolled into block (0→3), then +1 for this placement
        assert result['tokens']['block'] == 4
        assert 'focus' not in g.data['imperialCitadelTokens']
    finally:
        _cleanup()


def test_imp_citadel_rejects_invalid_token_type():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('imp_citadel_G1_1_bogus')
    result = handler(_Interaction('imp_citadel_G1_1_bogus'), {})
    assert result['ok'] is False
    assert result['reason'] == 'invalid_token_type'


def test_imp_citadel_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('imp_citadel_G1_1_damage')
        result = handler(
            _Interaction('imp_citadel_G1_1_damage', user_id='bob'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


# ── rbf_discard ────────────────────────────────────────────────────────────

def test_rbf_discard_moves_card_to_discard():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['player1CcHand'] = ['A', 'B', 'C']
    g.data['player1CcDiscard'] = ['Z']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rbf_discard_G1_1_1')  # card B
        result = handler(
            _Interaction('rbf_discard_G1_1_1', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['card'] == 'B'
        assert g.data['player1CcHand'] == ['A', 'C']
        assert g.data['player1CcDiscard'] == ['Z', 'B']
    finally:
        _cleanup()


def test_rbf_discard_rejects_out_of_range():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['player1CcHand'] = ['A']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rbf_discard_G1_1_5')
        result = handler(
            _Interaction('rbf_discard_G1_1_5', user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'card_index_out_of_range'
    finally:
        _cleanup()


def test_rbf_discard_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['player1CcHand'] = ['A']
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('rbf_discard_G1_1_0')
        result = handler(
            _Interaction('rbf_discard_G1_1_0', user_id='bob'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


# ── prog_override ──────────────────────────────────────────────────────────

def test_prog_override_sets_trait():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('prog_override_G1_1_FORCE_USER')
        result = handler(
            _Interaction('prog_override_G1_1_FORCE_USER', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['trait'] == 'FORCE USER'
        assert g.data['roundProgrammingOverrideTrait'][1] == 'FORCE USER'
    finally:
        _cleanup()


def test_prog_override_single_word_trait():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('prog_override_G1_1_LEADER')
        result = handler(
            _Interaction('prog_override_G1_1_LEADER', user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['trait'] == 'LEADER'
    finally:
        _cleanup()


def test_prog_override_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('prog_override_G1_1_HUNTER')
        result = handler(
            _Interaction('prog_override_G1_1_HUNTER', user_id='bob'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


def main():
    cases = [
        ('eor_advances_round', test_end_end_of_round_advances_round),
        ('eor_malformed', test_end_end_of_round_malformed),
        ('sor_closes_window', test_end_start_of_round_closes_window),
        ('sor_rejects_non_holder', test_end_start_of_round_rejects_non_sor_holder),
        ('sor_game_not_found', test_end_start_of_round_game_not_found),
        ('ea_pick_cycles', test_extra_armor_pick_cycles_0_1_2_0),
        ('ea_pick_non_owner', test_extra_armor_pick_rejects_non_owner),
        ('ea_confirm_budget', test_extra_armor_confirm_requires_budget_exhausted),
        ('ea_confirm_applies', test_extra_armor_confirm_applies_block_tokens),
        ('ea_cancel_noop', test_extra_armor_cancel_is_noop),
        ('sor_reveal_clears', test_sor_mission_reveal_clears_flag),
        ('sor_reveal_non_player', test_sor_mission_reveal_rejects_non_player),
        ('sor_reveal_already', test_sor_mission_reveal_rejects_when_already_revealed),
        ('ror_moves_to_top', test_rogue_one_return_moves_card_to_deck_top),
        ('ror_clears_pending', test_rogue_one_return_clears_pending_when_last_card),
        ('ror_non_owner', test_rogue_one_return_rejects_non_owner),
        ('ror_out_of_range', test_rogue_one_return_rejects_out_of_range_index),
        ('ror_no_pending', test_rogue_one_return_rejects_when_no_pending),
        ('imp_citadel_damage', test_imp_citadel_places_damage_token),
        ('imp_citadel_block_accum', test_imp_citadel_places_block_token_accumulates),
        ('imp_citadel_focus_migrate', test_imp_citadel_migrates_legacy_focus_to_block),
        ('imp_citadel_invalid_type', test_imp_citadel_rejects_invalid_token_type),
        ('imp_citadel_non_owner', test_imp_citadel_rejects_non_owner),
        ('rbf_moves', test_rbf_discard_moves_card_to_discard),
        ('rbf_out_of_range', test_rbf_discard_rejects_out_of_range),
        ('rbf_non_owner', test_rbf_discard_rejects_non_owner),
        ('prog_override_multi', test_prog_override_sets_trait),
        ('prog_override_single', test_prog_override_single_word_trait),
        ('prog_override_non_owner', test_prog_override_rejects_non_owner),
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
