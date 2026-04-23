"""Channel/message abstraction — pure-Python surface over discord.py.

Handler code (in handlers/, commands.py, etc.) should use the functions
in this module rather than calling discord.py's Channel/Message APIs
directly. Tests mock the backend; production wires a real discord.py
client.

The `MessageTarget` interface is the minimal set of ops a handler needs:
  - post(target, payload) → new message_id
  - edit(target, message_id, payload) → bool
  - delete(target, message_id) → bool
  - fetch(target, message_id) → payload dict or None

A `ChannelBackend` implementation can be:
  - InMemoryBackend: dict-backed; used by tests
  - DiscordBackend: thin wrapper around discord.py (production)

Payload shape mirrors what `render_game_view` returns:
  {embeds: [...], components: [...], content: str, files: [...]}
"""
from __future__ import annotations

import itertools
from typing import Any, Dict, List, Optional, Protocol


class ChannelBackend(Protocol):
    """Minimal interface all message backends implement."""

    def post(self, channel_id: str, payload: Dict[str, Any]) -> Optional[str]: ...
    def edit(self, channel_id: str, message_id: str,
             payload: Dict[str, Any]) -> bool: ...
    def delete(self, channel_id: str, message_id: str) -> bool: ...
    def fetch(self, channel_id: str, message_id: str) -> Optional[Dict[str, Any]]: ...
    def list_messages(self, channel_id: str) -> List[Dict[str, Any]]: ...


class InMemoryBackend:
    """Dict-backed backend for tests + dev.

    Messages are stored per channel in insertion order. Message IDs are
    monotonic integers stringified.
    """
    def __init__(self) -> None:
        self._messages: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self._id_counter = itertools.count(1)

    def _next_id(self) -> str:
        return str(next(self._id_counter))

    def post(self, channel_id: str, payload: Dict[str, Any]) -> Optional[str]:
        if not channel_id:
            return None
        msg_id = self._next_id()
        ch = self._messages.setdefault(channel_id, {})
        ch[msg_id] = dict(payload)
        return msg_id

    def edit(self, channel_id: str, message_id: str,
             payload: Dict[str, Any]) -> bool:
        ch = self._messages.get(channel_id) or {}
        if message_id not in ch:
            return False
        ch[message_id] = dict(payload)
        return True

    def delete(self, channel_id: str, message_id: str) -> bool:
        ch = self._messages.get(channel_id) or {}
        if message_id not in ch:
            return False
        del ch[message_id]
        return True

    def fetch(self, channel_id: str, message_id: str) -> Optional[Dict[str, Any]]:
        ch = self._messages.get(channel_id) or {}
        return ch.get(message_id)

    def list_messages(self, channel_id: str) -> List[Dict[str, Any]]:
        ch = self._messages.get(channel_id) or {}
        return [dict(m, _id=mid) for mid, m in ch.items()]


class DiscordBackend:
    """discord.py-backed backend for production.

    Takes a discord.Client at construction time. Async methods are
    wrapped to look synchronous for handler code — they schedule the
    work onto the client's event loop via run_coroutine_threadsafe.

    Not used in tests — InMemoryBackend stubs everything.
    """
    def __init__(self, client: Any) -> None:
        self.client = client

    def _channel(self, channel_id: str) -> Any:
        """Fetch a channel object by id."""
        try:
            return self.client.get_channel(int(channel_id))
        except Exception:
            return None

    def post(self, channel_id: str, payload: Dict[str, Any]) -> Optional[str]:
        import asyncio
        channel = self._channel(channel_id)
        if channel is None:
            return None
        try:
            future = asyncio.run_coroutine_threadsafe(
                channel.send(**_translate_payload(payload)),
                self.client.loop,
            )
            msg = future.result(timeout=10)
            return str(msg.id)
        except Exception:
            return None

    def edit(self, channel_id: str, message_id: str,
             payload: Dict[str, Any]) -> bool:
        import asyncio
        channel = self._channel(channel_id)
        if channel is None:
            return False
        try:
            async def _do():
                msg = await channel.fetch_message(int(message_id))
                await msg.edit(**_translate_payload(payload))
            future = asyncio.run_coroutine_threadsafe(_do(), self.client.loop)
            future.result(timeout=10)
            return True
        except Exception:
            return False

    def delete(self, channel_id: str, message_id: str) -> bool:
        import asyncio
        channel = self._channel(channel_id)
        if channel is None:
            return False
        try:
            async def _do():
                msg = await channel.fetch_message(int(message_id))
                await msg.delete()
            future = asyncio.run_coroutine_threadsafe(_do(), self.client.loop)
            future.result(timeout=10)
            return True
        except Exception:
            return False

    def fetch(self, channel_id: str, message_id: str) -> Optional[Dict[str, Any]]:
        import asyncio
        channel = self._channel(channel_id)
        if channel is None:
            return None
        try:
            async def _do():
                msg = await channel.fetch_message(int(message_id))
                return {
                    'content': msg.content,
                    'embeds': [e.to_dict() for e in (msg.embeds or [])],
                }
            future = asyncio.run_coroutine_threadsafe(_do(), self.client.loop)
            return future.result(timeout=10)
        except Exception:
            return None

    def list_messages(self, channel_id: str) -> List[Dict[str, Any]]:
        # Production callers track message IDs explicitly; full channel
        # history iteration isn't needed.
        return []


def _translate_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Convert our dict payload to discord.py Message.send kwargs."""
    try:
        import discord  # type: ignore[import]
    except ImportError:
        return dict(payload)
    out: Dict[str, Any] = {}
    if 'content' in payload:
        out['content'] = payload['content']
    if payload.get('embeds'):
        out['embeds'] = [
            discord.Embed.from_dict(e) for e in payload['embeds']
        ]
    # Components require View objects — left to the caller to build.
    # For now, skip; a future pass will translate dict components to Views.
    return out


# Default backend singleton — swappable for tests.
_default_backend: Optional[ChannelBackend] = None


def set_default_backend(backend: ChannelBackend) -> None:
    global _default_backend
    _default_backend = backend


def get_default_backend() -> ChannelBackend:
    global _default_backend
    if _default_backend is None:
        _default_backend = InMemoryBackend()
    return _default_backend


# ── High-level helpers ─────────────────────────────────────────────────────

def post_game_view(channel_id: str, game: Any,
                   *, backend: Optional[ChannelBackend] = None
                   ) -> Optional[str]:
    """Render the game with render_game_view and post to channel_id.

    Returns the message id on success, None on failure.
    """
    from python.discord_bot.messages.updaters import render_game_view
    payload = render_game_view(game)
    be = backend or get_default_backend()
    return be.post(channel_id, payload)


def update_game_view(channel_id: str, message_id: str, game: Any,
                     *, backend: Optional[ChannelBackend] = None) -> bool:
    """Re-render the game view and edit an existing message."""
    from python.discord_bot.messages.updaters import render_game_view
    payload = render_game_view(game)
    be = backend or get_default_backend()
    return be.edit(channel_id, message_id, payload)
