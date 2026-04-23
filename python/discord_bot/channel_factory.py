"""Channel factory — creates the per-game Discord channels/threads.

When a new game starts, it needs a set of dedicated channels:
  - board channel (main game view, visible to both players)
  - log channel (append-only action history)
  - p1/p2 play-area channels (each player sees their own DCs)
  - p1/p2 hand threads (private CC hand display)

This module owns the creation flow. Like channels.py, it uses a
backend abstraction so tests can mock the guild/permission layer.

Backend interface:
  create_text_channel(guild_id, name, overwrites?) → channel_id
  create_thread(parent_channel_id, name, private=True) → channel_id
"""
from __future__ import annotations

import itertools
from typing import Any, Dict, List, Optional, Protocol


class ChannelFactoryBackend(Protocol):
    def create_text_channel(self, guild_id: str, name: str,
                            overwrites: Optional[Dict[str, Any]] = None
                            ) -> Optional[str]: ...
    def create_thread(self, parent_channel_id: str, name: str,
                      private: bool = True) -> Optional[str]: ...


class InMemoryFactoryBackend:
    """Dict-backed backend for tests. Channels/threads get monotonic ids."""

    def __init__(self) -> None:
        self.channels: List[Dict[str, Any]] = []
        self.threads: List[Dict[str, Any]] = []
        self._id_counter = itertools.count(1000)

    def _next_id(self) -> str:
        return str(next(self._id_counter))

    def create_text_channel(self, guild_id: str, name: str,
                            overwrites: Optional[Dict[str, Any]] = None
                            ) -> Optional[str]:
        if not guild_id or not name:
            return None
        cid = self._next_id()
        self.channels.append({
            'id': cid, 'guild_id': guild_id, 'name': name,
            'overwrites': overwrites or {},
        })
        return cid

    def create_thread(self, parent_channel_id: str, name: str,
                      private: bool = True) -> Optional[str]:
        if not parent_channel_id or not name:
            return None
        tid = self._next_id()
        self.threads.append({
            'id': tid, 'parent_channel_id': parent_channel_id,
            'name': name, 'private': private,
        })
        return tid


class DiscordFactoryBackend:
    """discord.py-backed backend. Requires a client bound to a guild."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def _guild(self, guild_id: str) -> Any:
        try:
            return self.client.get_guild(int(guild_id))
        except Exception:
            return None

    def create_text_channel(self, guild_id: str, name: str,
                            overwrites: Optional[Dict[str, Any]] = None
                            ) -> Optional[str]:
        import asyncio
        guild = self._guild(guild_id)
        if guild is None:
            return None
        try:
            async def _do():
                channel = await guild.create_text_channel(
                    name=name, overwrites=overwrites or {},
                )
                return str(channel.id)
            future = asyncio.run_coroutine_threadsafe(_do(), self.client.loop)
            return future.result(timeout=15)
        except Exception:
            return None

    def create_thread(self, parent_channel_id: str, name: str,
                      private: bool = True) -> Optional[str]:
        import asyncio
        try:
            import discord  # type: ignore[import]
        except ImportError:
            return None
        channel = self.client.get_channel(int(parent_channel_id))
        if channel is None:
            return None
        try:
            thread_type = (
                discord.ChannelType.private_thread if private
                else discord.ChannelType.public_thread
            )
            async def _do():
                thread = await channel.create_thread(
                    name=name, type=thread_type,
                )
                return str(thread.id)
            future = asyncio.run_coroutine_threadsafe(_do(), self.client.loop)
            return future.result(timeout=15)
        except Exception:
            return None


# Default backend singleton.
_default_factory: Optional[ChannelFactoryBackend] = None


def set_default_factory(backend: ChannelFactoryBackend) -> None:
    global _default_factory
    _default_factory = backend


def get_default_factory() -> ChannelFactoryBackend:
    global _default_factory
    if _default_factory is None:
        _default_factory = InMemoryFactoryBackend()
    return _default_factory


# ── High-level: create a full game's channel set ───────────────────────────

def _safe_slug(name: str, max_len: int = 16) -> str:
    """Lowercase + hyphenate for Discord channel names."""
    safe = ''.join(c if c.isalnum() else '-' for c in (name or '').lower())
    # Collapse consecutive hyphens.
    while '--' in safe:
        safe = safe.replace('--', '-')
    safe = safe.strip('-')
    return safe[:max_len] or 'player'


def create_game_channels(game_id: str, guild_id: str,
                          p1_id: str, p2_id: str,
                          *, prefix: Optional[str] = None,
                          backend: Optional[ChannelFactoryBackend] = None
                          ) -> Dict[str, Optional[str]]:
    """Create the full channel set for a new game.

    Returns a dict with channel IDs:
      {board_channel_id, log_channel_id,
       p1_play_area_channel_id, p2_play_area_channel_id,
       p1_hand_channel_id (thread), p2_hand_channel_id (thread)}

    Any field is None if creation failed. The caller then hands this
    dict to cmd_setup_channels to bind them to the game.
    """
    be = backend or get_default_factory()
    prefix = prefix or f'g-{_safe_slug(game_id, 12)}'
    p1_slug = _safe_slug(p1_id, 8)
    p2_slug = _safe_slug(p2_id, 8)

    out: Dict[str, Optional[str]] = {}
    out['board_channel_id'] = be.create_text_channel(
        guild_id, f'{prefix}-board',
    )
    out['log_channel_id'] = be.create_text_channel(
        guild_id, f'{prefix}-log',
    )
    out['p1_play_area_channel_id'] = be.create_text_channel(
        guild_id, f'{prefix}-{p1_slug}-play',
    )
    out['p2_play_area_channel_id'] = be.create_text_channel(
        guild_id, f'{prefix}-{p2_slug}-play',
    )
    # Hand threads hang off each player's play-area channel.
    if out['p1_play_area_channel_id']:
        out['p1_hand_channel_id'] = be.create_thread(
            out['p1_play_area_channel_id'], f'{p1_slug}-hand', private=True,
        )
    else:
        out['p1_hand_channel_id'] = None
    if out['p2_play_area_channel_id']:
        out['p2_hand_channel_id'] = be.create_thread(
            out['p2_play_area_channel_id'], f'{p2_slug}-hand', private=True,
        )
    else:
        out['p2_hand_channel_id'] = None
    return out
