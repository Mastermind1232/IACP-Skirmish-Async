"""P3.2 verification: FakeInteraction + FakeChannel.

Validates the Discord-mocking surface used by all Phase 3 handler
tests. Mirrors the JS fake-interaction.test.js suite.
"""
import asyncio

import pytest

from python.discord_bot.fake_interaction import (
    FakeInteraction,
    create_fake_channel,
    create_fake_interaction,
)


def _run(coro):
    """Run a coroutine in a fresh event loop. Compatible with pytest's
    default sync-test mode."""
    return asyncio.get_event_loop().run_until_complete(coro) \
        if asyncio.get_event_loop_policy() and asyncio.get_event_loop().is_running() is False \
        else asyncio.new_event_loop().run_until_complete(coro)


def _aio(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Channel basics ──────────────────────────────────────────────────────


def test_create_fake_channel_has_default_id():
    c = create_fake_channel()
    assert c.id == 'fake-channel-1'


def test_create_fake_channel_with_explicit_id():
    c = create_fake_channel('my-channel')
    assert c.id == 'my-channel'
    assert c.name == 'my-channel'


def test_channel_send_string_payload_captures_message():
    c = create_fake_channel()
    msg = _aio(c.send('hello world'))
    assert msg.content == 'hello world'
    assert msg in c._sent_messages


def test_channel_send_dict_payload_assigns_attrs():
    c = create_fake_channel()
    msg = _aio(c.send({'content': 'hi', 'embeds': [{'title': 'T'}]}))
    assert msg.content == 'hi'
    assert msg.embeds == [{'title': 'T'}]


def test_channel_messages_fetch_string_id_returns_msg():
    c = create_fake_channel()
    msg = _aio(c.messages.fetch('m1'))
    assert msg.id == 'm1'
    # Subsequent fetch returns same object.
    msg2 = _aio(c.messages.fetch('m1'))
    assert msg is msg2


def test_message_start_thread_returns_thread_channel():
    c = create_fake_channel()
    msg = _aio(c.send('test'))
    thread = _aio(msg.start_thread(name='Activation Thread'))
    assert thread.is_thread() is True
    assert thread.parent is c
    assert thread.name == 'Activation Thread'


def test_message_edit_string_replaces_content():
    c = create_fake_channel()
    msg = _aio(c.send('original'))
    _aio(msg.edit('updated'))
    assert msg.content == 'updated'


def test_message_edit_dict_merges_attrs():
    c = create_fake_channel()
    msg = _aio(c.send('original'))
    _aio(msg.edit({'embeds': [{'title': 'X'}]}))
    assert msg.embeds == [{'title': 'X'}]
    # Content preserved from original.
    assert msg.content == 'original'


# ── Interaction basics ──────────────────────────────────────────────────


def test_create_fake_interaction_has_custom_id_and_user():
    i = create_fake_interaction('dc_activate_g1_1_0', 'alice')
    assert i.custom_id == 'dc_activate_g1_1_0'
    assert i.user.id == 'alice'


def test_interaction_follow_up_captures_string_message():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.follow_up('You did it'))
    assert any(
        m['type'] == 'follow_up' and m.get('content') == 'You did it'
        for m in i.sent_messages
    )


def test_interaction_follow_up_captures_dict_payload():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.follow_up({'content': 'X', 'ephemeral': True}))
    msg = i.sent_messages[-1]
    assert msg['content'] == 'X'
    assert msg['ephemeral'] is True


def test_interaction_edit_reply_captures():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.edit_reply('updated'))
    assert i.sent_messages[-1]['type'] == 'edit_reply'


def test_interaction_reply_captures():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.reply({'content': 'hi', 'ephemeral': False}))
    assert i.sent_messages[-1]['type'] == 'reply'
    assert i.sent_messages[-1]['ephemeral'] is False


def test_interaction_defer_update_captures():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.defer_update())
    assert i.sent_messages[-1]['type'] == 'defer_update'


def test_interaction_show_modal_captures():
    i = create_fake_interaction('btn_x', 'alice')
    _aio(i.show_modal({'title': 'Squad Submit'}))
    assert i.sent_messages[-1]['type'] == 'show_modal'


# ── Type checks ─────────────────────────────────────────────────────────


def test_default_interaction_is_button():
    i = create_fake_interaction('btn_x', 'alice')
    assert i.is_button() is True
    assert i.is_string_select_menu() is False
    assert i.is_modal_submit() is False


def test_select_interaction_is_select_menu():
    i = create_fake_interaction('sel_x', 'alice', interaction_type='select')
    assert i.is_string_select_menu() is True
    assert i.is_button() is False


def test_modal_interaction_is_modal_submit():
    i = create_fake_interaction('mod_x', 'alice', interaction_type='modal')
    assert i.is_modal_submit() is True


# ── Channel passed in ──────────────────────────────────────────────────


def test_interaction_uses_provided_channel():
    c = create_fake_channel('p1-hand')
    i = create_fake_interaction('cc_play_select_g1', 'alice', channel=c)
    assert i.channel is c
    assert i.channel_id == 'p1-hand'
