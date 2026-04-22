"""Tests for message updaters — embed + log line builders."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.messages.updaters import (
    COLOR_DEFEAT,
    COLOR_IMPERIAL,
    COLOR_NEUTRAL,
    COLOR_REBEL,
    build_activation_summary,
    build_dc_embed,
    build_hand_display,
    build_mission_card,
    build_pending_prompt,
    build_vp_banner,
    format_log_line,
)


def test_vp_banner_includes_round_and_vp():
    g = {
        'round': 3,
        'player1VP': {'total': 7},
        'player2VP': {'total': 4},
        'activePlayer': 1,
    }
    banner = build_vp_banner(g)
    assert 'Round 3' in banner['title']
    assert '7 VP' in banner['description']
    assert '4 VP' in banner['description']
    # P1 is active → → marker precedes P1's name
    assert banner['description'].startswith('→')


def test_vp_banner_default_when_empty():
    banner = build_vp_banner({})
    assert 'Round 1' in banner['title']
    assert '0 VP' in banner['description']


def test_dc_embed_unknown_returns_placeholder():
    e = build_dc_embed({}, 'unknown_msg_id')
    assert e['title'] == 'Unknown DC'


def test_dc_embed_locates_dc_and_colors_by_affiliation():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Luke Skywalker': {
            'affiliation': 'Rebel', 'cost': 12, 'speed': 5, 'health': 10,
            'abilityText': 'Jedi Knight powers.',
        },
    }
    try:
        g = {
            'p1DcMessageIds': ['hl1dc0'],
            'p1DcList': [{'dcName': 'Luke Skywalker', 'healthState': [[7, 10]]}],
        }
        e = build_dc_embed(g, 'hl1dc0')
        assert 'Luke Skywalker' in e['title']
        assert e['color'] == COLOR_REBEL
        assert any('7/10' in f['value'] for f in e['fields'])
    finally:
        dc_effects_loader.reset_cache()


def test_dc_embed_exhausted_uses_defeat_color_and_note():
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = {
        'Stormtrooper': {'affiliation': 'Imperial', 'cost': 6, 'speed': 4,
                          'health': 4, 'abilityText': ''},
    }
    try:
        g = {
            'p2DcMessageIds': ['hl2dc0'],
            'p2DcList': [{'dcName': 'Stormtrooper', 'healthState': [[4, 4]]}],
        }
        e = build_dc_embed(g, 'hl2dc0', exhausted=True)
        assert e['color'] == COLOR_DEFEAT
        assert 'exhausted' in e['title']
    finally:
        dc_effects_loader.reset_cache()


def test_hand_display_empty():
    g = {'player1CcHand': []}
    r = build_hand_display(g, 1)
    assert 'empty' in r['content'].lower()


def test_hand_display_numbered():
    g = {'player1CcHand': ['Focus', 'Hold On', 'Sprint']}
    r = build_hand_display(g, 1)
    assert '1. **Focus**' in r['content']
    assert '2. **Hold On**' in r['content']
    assert '3. **Sprint**' in r['content']


def test_format_log_line_with_icon():
    line = format_log_line('Luke moved to A1.', icon='move')
    assert '🏃' in line
    assert 'Luke moved' in line


def test_format_log_line_with_phase_fallback():
    line = format_log_line('Round started.', phase='ROUND')
    assert '🔵' in line


def test_format_log_line_plain_when_unknown():
    line = format_log_line('Just a message.', icon='nonexistent')
    assert 'Just a message.' in line


def test_build_mission_card_with_selected():
    g = {
        'selectedMap': {'id': 'moe', 'name': 'Mos Eisley'},
        'selectedMission': {
            'variant': 'a',
            'fullName': 'Mos Eisley — A. Get to the Ship',
            'interactLabel': 'Retrieve Intel',
            'mechanics': {'type': 'carry', 'speedPenalty': -1},
        },
    }
    e = build_mission_card(g)
    assert 'Mos Eisley' in e['title']
    assert 'A' in e['title']
    assert any(f['name'] == 'Interact' for f in e['fields'])
    mech_field = [f for f in e['fields'] if f['name'] == 'Mechanics'][0]
    assert mech_field['value'] == 'carry'


def test_activation_summary_active_player():
    g = {
        'activePlayer': 2,
        'p1ActivationsRemaining': 1,
        'p2ActivationsRemaining': 3,
    }
    e = build_activation_summary(g)
    assert 'Player 2' in e['description']
    assert e['color'] == COLOR_IMPERIAL


def test_activation_summary_neither_active():
    e = build_activation_summary({'p1ActivationsRemaining': 0,
                                    'p2ActivationsRemaining': 0})
    assert e['color'] == COLOR_NEUTRAL


def test_pending_prompt_uses_given_color():
    e = build_pending_prompt('Choose a target:', color=0xFF00FF)
    assert e['description'] == 'Choose a target:'
    assert e['color'] == 0xFF00FF


def main():
    cases = [
        ('vp_banner_round_and_vp', test_vp_banner_includes_round_and_vp),
        ('vp_banner_defaults', test_vp_banner_default_when_empty),
        ('dc_embed_unknown', test_dc_embed_unknown_returns_placeholder),
        ('dc_embed_by_affiliation', test_dc_embed_locates_dc_and_colors_by_affiliation),
        ('dc_embed_exhausted', test_dc_embed_exhausted_uses_defeat_color_and_note),
        ('hand_display_empty', test_hand_display_empty),
        ('hand_display_numbered', test_hand_display_numbered),
        ('log_line_icon', test_format_log_line_with_icon),
        ('log_line_phase_fallback', test_format_log_line_with_phase_fallback),
        ('log_line_unknown_icon_plain', test_format_log_line_plain_when_unknown),
        ('mission_card_selected', test_build_mission_card_with_selected),
        ('activation_summary_active', test_activation_summary_active_player),
        ('activation_summary_neither', test_activation_summary_neither_active),
        ('pending_prompt_color', test_pending_prompt_uses_given_color),
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
