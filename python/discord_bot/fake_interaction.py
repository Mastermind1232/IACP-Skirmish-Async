"""Fake Discord Interaction + Channel for headless handler tests.

Mirrors src/headless/fake-interaction.js. Captures all replies / followUps
for later inspection. Provides enough Discord-API surface for the bot's
handlers to run without a live Discord gateway:

  - channel.messages.fetch(id) → returns a fake message with edit() /
    start_thread()
  - message.start_thread() → fake thread channel with send()
  - channel.send() → fake message
  - interaction.defer_update / follow_up / edit_reply / reply →
    capture output

Usage:

    from python.discord_bot.fake_interaction import (
        create_fake_channel, create_fake_interaction,
    )

    channel = create_fake_channel('p1-play-area')
    interaction = create_fake_interaction(
        custom_id='dc_activate_g1_1_0',
        user_id='alice',
        channel=channel,
    )

    await handle_dc_activate(interaction, ctx)

    # Inspect captured side-effects
    assert any(m['type'] == 'follow_up' for m in interaction.sent_messages)
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


_msg_counter = itertools.count(1)


def _next_msg_id() -> str:
    return f'fake-msg-{next(_msg_counter)}'


# ---------------------------------------------------------------------------
# Fake message


def create_fake_message(msg_id: str, channel: 'FakeChannel') -> 'FakeMessage':
    msg = FakeMessage(id=msg_id, channel=channel)
    return msg


class FakeMessage:
    """Discord-Message-like object, async-method shaped."""

    def __init__(self, id: str, channel: 'FakeChannel') -> None:
        self.id = id
        self.channel = channel
        self.content = ''
        self.embeds: List[Any] = []
        self.components: List[Any] = []
        self.attachments: Dict[str, Any] = {}
        self.author = type('Author', (), {'bot': True, 'id': 'fake-bot'})()
        self._edits: List[Any] = []
        self._reactions: List[Any] = []
        self._deleted = False
        self._pinned = False

    async def edit(self, payload: Any = None, **kwargs: Any) -> 'FakeMessage':
        merged = {} if payload is None else (
            {'content': payload} if isinstance(payload, str) else dict(payload)
        )
        merged.update(kwargs)
        self._edits.append(merged)
        for k, v in merged.items():
            setattr(self, k, v)
        return self

    async def start_thread(self, name: Optional[str] = None,
                           **kwargs: Any) -> 'FakeChannel':
        thread_id = f'thread-{self.id}'
        thread = create_fake_channel(thread_id)
        thread.name = name or thread_id
        thread._is_thread = True
        thread.parent = self.channel
        thread.parent_id = self.channel.id
        return thread

    async def delete(self) -> None:
        self._deleted = True

    async def react(self, emoji: Any) -> None:
        self._reactions.append(emoji)

    async def pin(self) -> None:
        self._pinned = True

    async def unpin(self) -> None:
        self._pinned = False


# ---------------------------------------------------------------------------
# Fake channel


class _MessageStoreFetcher:
    """Async-callable that supports both fetch(id) and fetch() forms."""

    def __init__(self, channel: 'FakeChannel') -> None:
        self._channel = channel

    async def __call__(self, id_or_opts: Any = None) -> Any:
        store = self._channel._message_store
        if isinstance(id_or_opts, str):
            if id_or_opts not in store:
                store[id_or_opts] = create_fake_message(id_or_opts, self._channel)
            return store[id_or_opts]
        # No-arg or limit-dict: return a dict + .find / .filter helpers.
        result = dict(store)

        class _Coll(dict):
            def find(self, fn: Callable[[Any], bool]) -> Optional[Any]:
                for v in self.values():
                    if fn(v):
                        return v
                return None

            def filter(self, fn: Callable[[Any], bool]) -> Dict[str, Any]:
                return {k: v for k, v in self.items() if fn(v)}

        return _Coll(result)


class FakeChannel:
    """Discord-Channel-like fake object."""

    def __init__(self, channel_id: str = 'fake-channel-1') -> None:
        self.id = channel_id
        self.name = channel_id
        self._sent_messages: List[FakeMessage] = []
        self._message_store: Dict[str, FakeMessage] = {}
        self.messages = type('MsgsAPI', (), {'fetch': _MessageStoreFetcher(self)})()
        self._is_thread = False
        self.parent: Optional['FakeChannel'] = None
        self.parent_id: Optional[str] = None
        self.type = 0
        self.guild = type('Guild', (), {'id': 'fake-guild'})()

    async def send(self, payload: Any = None, **kwargs: Any) -> FakeMessage:
        msg_id = _next_msg_id()
        msg = create_fake_message(msg_id, self)
        if isinstance(payload, str):
            msg.content = payload
        elif isinstance(payload, dict):
            for k, v in payload.items():
                setattr(msg, k, v)
        for k, v in kwargs.items():
            setattr(msg, k, v)
        self._message_store[msg_id] = msg
        self._sent_messages.append(msg)
        return msg

    async def bulk_delete(self, _msgs: Any) -> None:
        pass

    def is_thread(self) -> bool:
        return self._is_thread

    def is_text_based(self) -> bool:
        return True

    async def delete(self) -> None:
        pass


def create_fake_channel(channel_id: str = 'fake-channel-1') -> FakeChannel:
    return FakeChannel(channel_id)


# ---------------------------------------------------------------------------
# Fake interaction


@dataclass
class _FakeUser:
    id: str
    username: str = 'TestPlayer'


@dataclass
class _FakeMember:
    id: str


class FakeInteraction:
    """Discord-Interaction-like object with async response methods."""

    def __init__(self, *, custom_id: str, user_id: str,
                 channel: Optional[FakeChannel] = None,
                 message_id: Optional[str] = None,
                 username: Optional[str] = None,
                 guild: Optional[Any] = None,
                 values: Optional[List[str]] = None,
                 fields: Optional[Any] = None,
                 client: Optional[Any] = None,
                 interaction_type: str = 'button',
                 options: Optional[Any] = None,
                 ) -> None:
        self.custom_id = custom_id
        self.user = _FakeUser(id=user_id, username=username or 'TestPlayer')
        self.member = _FakeMember(id=user_id)
        self.channel = channel or create_fake_channel()
        self.channel_id = self.channel.id
        self.message = create_fake_message(message_id or 'fake-msg', self.channel)
        self.guild = guild or type(
            'Guild', (), {
                'id': 'fake-guild',
                'channels': type('Channels', (),
                                  {'fetch': lambda _self, _id: self.channel})(),
                'members': type('Members', (),
                                 {'fetch': lambda _self, mid:
                                    type('M', (), {'id': mid,
                                                     'display_name': f'Player_{mid}'})()})(),
            })()
        self.values = values or []
        self.fields = fields or type('F', (), {'get_text_input_value': lambda _self, _k: ''})()
        self.client = client
        self.options = options or type('Opts', (), {
            'get_integer': lambda _self, _k=None: None,
            'get_string': lambda _self, _k=None: None,
            'get_user': lambda _self, _k=None: None,
            'get_subcommand': lambda _self: None,
        })()
        self._interaction_type = interaction_type
        self.sent_messages: List[Dict[str, Any]] = []

    # ── Response methods (capture instead of sending) ───────────────────

    async def defer_update(self, **opts: Any) -> None:
        self.sent_messages.append({'type': 'defer_update', **opts})

    async def defer_reply(self, **opts: Any) -> None:
        self.sent_messages.append({'type': 'defer_reply', **opts})

    async def follow_up(self, payload: Any = None, **kwargs: Any
                        ) -> Dict[str, Any]:
        msg = {'type': 'follow_up'}
        if isinstance(payload, str):
            msg['content'] = payload
        elif isinstance(payload, dict):
            msg.update(payload)
        msg.update(kwargs)
        self.sent_messages.append(msg)
        return msg

    async def edit_reply(self, payload: Any = None, **kwargs: Any
                         ) -> Dict[str, Any]:
        msg = {'type': 'edit_reply'}
        if isinstance(payload, str):
            msg['content'] = payload
        elif isinstance(payload, dict):
            msg.update(payload)
        msg.update(kwargs)
        self.sent_messages.append(msg)
        return msg

    async def reply(self, payload: Any = None, **kwargs: Any
                    ) -> Dict[str, Any]:
        msg = {'type': 'reply'}
        if isinstance(payload, str):
            msg['content'] = payload
        elif isinstance(payload, dict):
            msg.update(payload)
        msg.update(kwargs)
        self.sent_messages.append(msg)
        return msg

    async def update(self, payload: Any = None, **kwargs: Any
                     ) -> Dict[str, Any]:
        msg = {'type': 'update'}
        if isinstance(payload, str):
            msg['content'] = payload
        elif isinstance(payload, dict):
            msg.update(payload)
        msg.update(kwargs)
        self.sent_messages.append(msg)
        return msg

    async def show_modal(self, modal: Any) -> None:
        self.sent_messages.append({'type': 'show_modal', 'modal': modal})

    # ── Type checks ─────────────────────────────────────────────────────

    def is_button(self) -> bool:
        return self._interaction_type == 'button'

    def is_string_select_menu(self) -> bool:
        return self._interaction_type == 'select'

    def is_modal_submit(self) -> bool:
        return self._interaction_type == 'modal'

    def is_chat_input_command(self) -> bool:
        return self._interaction_type == 'slash'

    def is_autocomplete(self) -> bool:
        return False


def create_fake_interaction(custom_id: str, user_id: str,
                            **opts: Any) -> FakeInteraction:
    """Convenience factory mirroring the JS createFakeInteraction shape."""
    return FakeInteraction(
        custom_id=custom_id, user_id=user_id, **opts,
    )
