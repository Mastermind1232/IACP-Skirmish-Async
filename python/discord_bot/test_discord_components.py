"""P3.7 verification: Discord component builders."""
import pytest

from python.discord_bot.discord_components import (
    ActionRow,
    Button,
    Embed,
    EmbedField,
    SelectMenu,
    SelectOption,
    chunk_buttons_to_rows,
    confirm_cancel_row,
    get_button_style,
    truncate_label,
)


# ── truncate_label ─────────────────────────────────────────────────────


def test_truncate_label_under_max():
    assert truncate_label('hello') == 'hello'


def test_truncate_label_at_max():
    text = 'x' * 80
    assert truncate_label(text) == text


def test_truncate_label_over_max_appends_ellipsis():
    text = 'x' * 100
    out = truncate_label(text)
    assert len(out) == 80
    assert out.endswith('…')


def test_truncate_label_custom_max():
    assert truncate_label('hello world', max=5) == 'hell…'


def test_truncate_label_none_returns_empty():
    assert truncate_label(None) == ''


def test_truncate_label_non_string():
    assert truncate_label(42) == '42'


# ── get_button_style ───────────────────────────────────────────────────


def test_get_button_style_attack_is_danger():
    assert get_button_style('attack') == 'Danger'


def test_get_button_style_destructive_is_danger():
    assert get_button_style('destructive') == 'Danger'


def test_get_button_style_confirm_is_success():
    assert get_button_style('confirm') == 'Success'


def test_get_button_style_movement_is_secondary():
    assert get_button_style('movement') == 'Secondary'


def test_get_button_style_primary_is_primary():
    assert get_button_style('primary') == 'Primary'


def test_get_button_style_unknown_defaults_secondary():
    assert get_button_style('mystery_area') == 'Secondary'


# ── chunk_buttons_to_rows ──────────────────────────────────────────────


def _btn(i):
    return Button(custom_id=f'btn_{i}', label=f'B{i}')


def test_chunk_buttons_under_5_one_row():
    btns = [_btn(i) for i in range(3)]
    rows = chunk_buttons_to_rows(btns)
    assert len(rows) == 1
    assert len(rows[0].components) == 3


def test_chunk_buttons_5_one_row():
    btns = [_btn(i) for i in range(5)]
    rows = chunk_buttons_to_rows(btns)
    assert len(rows) == 1
    assert len(rows[0].components) == 5


def test_chunk_buttons_6_two_rows():
    btns = [_btn(i) for i in range(6)]
    rows = chunk_buttons_to_rows(btns)
    assert len(rows) == 2
    assert len(rows[0].components) == 5
    assert len(rows[1].components) == 1


def test_chunk_buttons_caps_at_5_rows_per_message():
    """30 buttons → 5 rows of 5, last 5 dropped."""
    btns = [_btn(i) for i in range(30)]
    rows = chunk_buttons_to_rows(btns)
    assert len(rows) == 5  # capped


def test_chunk_buttons_custom_max_per_row():
    btns = [_btn(i) for i in range(6)]
    rows = chunk_buttons_to_rows(btns, max_per_row=2)
    assert len(rows) == 3
    for r in rows:
        assert len(r.components) == 2


def test_chunk_buttons_empty_returns_empty():
    assert chunk_buttons_to_rows([]) == []


# ── confirm_cancel_row ─────────────────────────────────────────────────


def test_confirm_cancel_row_default_labels():
    row = confirm_cancel_row('confirm_id', 'cancel_id')
    assert isinstance(row, ActionRow)
    assert len(row.components) == 2
    assert row.components[0].label == 'Confirm'
    assert row.components[0].style == 'Success'
    assert row.components[1].label == 'Cancel'
    assert row.components[1].style == 'Secondary'


def test_confirm_cancel_row_custom_labels():
    row = confirm_cancel_row('a', 'b', confirm_label='Yes', cancel_label='No')
    assert row.components[0].label == 'Yes'
    assert row.components[1].label == 'No'


# ── Component data classes ─────────────────────────────────────────────


def test_button_default_style_is_secondary():
    b = Button(custom_id='x', label='X')
    assert b.style == 'Secondary'
    assert b.disabled is False


def test_select_menu_default_options_empty():
    m = SelectMenu(custom_id='x', placeholder='pick')
    assert m.options == []
    assert m.min_values == 1


def test_embed_default_fields_empty():
    e = Embed(title='T', description='D')
    assert e.fields == []
    assert e.color is None


def test_embed_with_field():
    e = Embed(title='T', fields=[EmbedField(name='K', value='V')])
    assert e.fields[0].name == 'K'
