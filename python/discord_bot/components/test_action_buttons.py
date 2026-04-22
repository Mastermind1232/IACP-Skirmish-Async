"""Tests for action_buttons — classify / style / build / layout."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.actions import ActionType
from python.discord_bot.components.action_buttons import (
    MAX_BUTTONS_PER_ROW,
    MAX_ROWS,
    build_action_rows,
    build_button,
    chunk_button_list,
    classify,
    style_for,
)


class _A:
    """Lightweight Action stand-in for tests."""
    def __init__(self, action_type, custom_id, label=None):
        self.type = action_type
        self.custom_id = custom_id
        self.label = label


def test_classify_known_types():
    assert classify(ActionType.ATTACK_TARGET) == 'combat'
    assert classify(ActionType.MOVE_PICK_SPACE) == 'movement'
    assert classify(ActionType.PLAY_CC) == 'cc'
    assert classify(ActionType.PHASE_GATE_READY) == 'phase'
    assert classify(ActionType.PICK_ZONE) == 'setup'


def test_style_for_uses_group():
    assert style_for(ActionType.ATTACK_TARGET) == 'danger'
    assert style_for(ActionType.ACTIVATE_DC) == 'success'
    assert style_for(ActionType.PICK_ZONE) == 'primary'


def test_build_button_dict_shape():
    btn = build_button(_A(ActionType.ACTIVATE_DC, 'activate_dc_g1_h0'),
                        label='Activate Luke')
    assert btn == {
        'custom_id': 'activate_dc_g1_h0',
        'label': 'Activate Luke',
        'style': 'success',
        'group': 'activation',
        'disabled': False,
    }


def test_build_button_label_truncation():
    btn = build_button(_A(ActionType.PLAY_CC, 'play_cc_x',
                           label='x' * 200))
    assert len(btn['label']) <= 80


def test_build_button_rejects_bad_action():
    try:
        build_button(_A(None, ''))
    except ValueError:
        return
    raise AssertionError('expected ValueError')


def test_build_action_rows_groups_by_classify():
    actions = [
        _A(ActionType.ATTACK_TARGET, 'attack_target_1'),
        _A(ActionType.MOVE_PICK_SPACE, 'move_pick_space_2'),
        _A(ActionType.PLAY_CC, 'play_cc_3'),
    ]
    rows = build_action_rows(actions)
    # Each group is distinct, rows break between groups
    flat = [b for r in rows for b in r['buttons']]
    assert len(flat) == 3
    groups = [b['group'] for b in flat]
    # movement before combat before cc per _GROUP_ORDER
    assert groups.index('movement') < groups.index('combat')
    assert groups.index('combat') < groups.index('cc')


def test_build_action_rows_respects_5_per_row_cap():
    actions = [
        _A(ActionType.MOVE_PICK_SPACE, f'move_pick_space_{i}')
        for i in range(8)
    ]
    rows = build_action_rows(actions)
    # 8 movement buttons = 1 row of 5 + 1 row of 3
    assert len(rows) == 2
    assert len(rows[0]['buttons']) == 5
    assert len(rows[1]['buttons']) == 3


def test_build_action_rows_caps_at_5_rows_total():
    # 6 groups × 5 buttons = 30 buttons; only 5 rows fit
    actions = []
    for at in (ActionType.PICK_ZONE, ActionType.ACTIVATE_DC,
                ActionType.MOVE_PICK_SPACE, ActionType.ATTACK_TARGET,
                ActionType.PLAY_CC, ActionType.PHASE_GATE_READY):
        for i in range(5):
            actions.append(_A(at, f'{at.value}_{i}'))
    rows = build_action_rows(actions)
    assert len(rows) == MAX_ROWS
    for row in rows:
        assert len(row['buttons']) <= MAX_BUTTONS_PER_ROW


def test_build_action_rows_empty_input():
    assert build_action_rows([]) == []


def test_chunk_button_list_preserves_order():
    btns = [{'custom_id': f'x{i}', 'label': str(i), 'style': 'primary',
             'group': 'misc', 'disabled': False} for i in range(7)]
    rows = chunk_button_list(btns, per_row=3)
    assert len(rows) == 3
    assert [b['label'] for b in rows[0]['buttons']] == ['0', '1', '2']
    assert [b['label'] for b in rows[1]['buttons']] == ['3', '4', '5']
    assert [b['label'] for b in rows[2]['buttons']] == ['6']


def test_chunk_button_list_respects_max_rows():
    btns = [{'custom_id': f'x{i}', 'label': str(i), 'style': 'primary',
             'group': 'misc', 'disabled': False} for i in range(20)]
    rows = chunk_button_list(btns, per_row=5, max_rows=3)
    assert len(rows) == 3
    # 3 rows × 5 buttons = 15 total
    total = sum(len(r['buttons']) for r in rows)
    assert total == 15


def main():
    cases = [
        ('classify_known', test_classify_known_types),
        ('style_uses_group', test_style_for_uses_group),
        ('button_dict_shape', test_build_button_dict_shape),
        ('label_truncation', test_build_button_label_truncation),
        ('build_button_rejects_bad', test_build_button_rejects_bad_action),
        ('rows_grouped_by_classify', test_build_action_rows_groups_by_classify),
        ('rows_5_per_row_cap', test_build_action_rows_respects_5_per_row_cap),
        ('rows_capped_at_5_total', test_build_action_rows_caps_at_5_rows_total),
        ('rows_empty_input', test_build_action_rows_empty_input),
        ('chunk_preserves_order', test_chunk_button_list_preserves_order),
        ('chunk_max_rows', test_chunk_button_list_respects_max_rows),
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
