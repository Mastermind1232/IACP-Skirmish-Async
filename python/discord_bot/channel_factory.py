"""Channel factory — creates the per-game Discord channels/threads.

Mirrors src/game-creation.js. When a new game starts, it creates:

  Category: "IA Game #00001"  (zero-padded sequential ID, placed
                                directly below the "⚔️ Games" category)
   ├── IA00001 Game Log         (text)
   ├── IA00001 General Chat     (text)
   ├── IA00001 Map Updates      (text — board renders posted here)
   ├── IA00001 <p1>-play-area   (text + private hand thread inside)
   └── IA00001 <p2>-play-area   (text + private hand thread inside)

Backend abstraction lets tests mock the guild/permission layer without
discord.py installed.
"""
from __future__ import annotations

import itertools
import logging
import re
from typing import Any, Dict, List, Optional, Protocol, Tuple

_LOG = logging.getLogger('skirbo.channel_factory')


# Category names. JS uses '⚔️ Games' (with emoji); some servers
# created the category as plain 'Games'. Match either form so we
# don't silently strand new games at the server root.
GAMES_CATEGORY = '⚔️ Games'
GAMES_CATEGORY_FALLBACKS = ('⚔️ Games', 'Games', '⚔ Games')

# Game-ID category pattern. e.g. "IA Game #00042".
_GAME_CATEGORY_RE = re.compile(r'^IA Game #(\d+)$')


class ChannelFactoryBackend(Protocol):
    def create_category(self, guild_id: str, name: str,
                        position: Optional[int] = None,
                        overwrites: Optional[Dict[str, Any]] = None,
                        ) -> Optional[str]: ...
    def list_categories(self, guild_id: str) -> List[Dict[str, Any]]: ...
    def find_category_by_name(self, guild_id: str, name: str
                              ) -> Optional[Dict[str, Any]]: ...
    def create_text_channel(self, guild_id: str, name: str,
                            parent_id: Optional[str] = None,
                            overwrites: Optional[Dict[str, Any]] = None,
                            ) -> Optional[str]: ...
    def create_thread(self, parent_channel_id: str, name: str,
                      private: bool = True) -> Optional[str]: ...


# ── In-memory backend (tests) ──────────────────────────────────────────


class InMemoryFactoryBackend:
    def __init__(self) -> None:
        self.categories: List[Dict[str, Any]] = []
        self.channels: List[Dict[str, Any]] = []
        self.threads: List[Dict[str, Any]] = []
        self._id_counter = itertools.count(1000)

    def _next_id(self) -> str:
        return str(next(self._id_counter))

    def create_category(self, guild_id, name, position=None, overwrites=None):
        cid = self._next_id()
        self.categories.append({
            'id': cid, 'guild_id': guild_id, 'name': name,
            'position': position, 'overwrites': overwrites or {},
        })
        return cid

    def list_categories(self, guild_id):
        return [c for c in self.categories if c.get('guild_id') == guild_id]

    def find_category_by_name(self, guild_id, name):
        for c in self.categories:
            if c.get('guild_id') == guild_id and c.get('name') == name:
                return c
        return None

    def create_text_channel(self, guild_id, name, parent_id=None,
                             overwrites=None):
        cid = self._next_id()
        self.channels.append({
            'id': cid, 'guild_id': guild_id, 'name': name,
            'parent_id': parent_id, 'overwrites': overwrites or {},
        })
        return cid

    def create_thread(self, parent_channel_id, name, private=True):
        tid = self._next_id()
        self.threads.append({
            'id': tid, 'parent_channel_id': parent_channel_id,
            'name': name, 'private': private,
        })
        return tid


# ── Discord-backed backend ─────────────────────────────────────────────


class DiscordFactoryBackend:
    """discord.py-backed backend. Bridges sync calls to the bot's
    event loop via run_coroutine_threadsafe.
    """

    def __init__(self, client: Any) -> None:
        self.client = client

    def _guild(self, guild_id: str) -> Any:
        try:
            return self.client.get_guild(int(guild_id))
        except Exception:
            return None

    def _run(self, coro_factory):
        """Schedule a coroutine on the bot loop and block until done.
        DO NOT call from inside the event loop — see asyncio.to_thread
        in callers.
        """
        import asyncio
        future = asyncio.run_coroutine_threadsafe(
            coro_factory(), self.client.loop,
        )
        return future.result(timeout=20)

    def create_category(self, guild_id, name, position=None, overwrites=None):
        guild = self._guild(guild_id)
        if guild is None:
            return None
        try:
            async def _do():
                kwargs = {'name': name, 'overwrites': overwrites or {}}
                if position is not None:
                    kwargs['position'] = position
                cat = await guild.create_category(**kwargs)
                return str(cat.id)
            return self._run(_do)
        except Exception:
            _LOG.exception('create_category failed for %s', name)
            return None

    def list_categories(self, guild_id):
        guild = self._guild(guild_id)
        if guild is None:
            return []
        try:
            import discord  # type: ignore[import]
            return [
                {'id': str(c.id), 'name': c.name, 'position': c.position}
                for c in guild.channels
                if isinstance(c, discord.CategoryChannel)
            ]
        except Exception:
            _LOG.exception('list_categories failed')
            return []

    def find_category_by_name(self, guild_id, name):
        for cat in self.list_categories(guild_id):
            if cat.get('name') == name:
                return cat
        return None

    def create_text_channel(self, guild_id, name, parent_id=None,
                             overwrites=None):
        guild = self._guild(guild_id)
        if guild is None:
            return None
        try:
            import discord  # type: ignore[import]
            parent = None
            if parent_id:
                parent = guild.get_channel(int(parent_id))
            async def _do():
                kwargs = {'name': name, 'overwrites': overwrites or {}}
                if parent is not None:
                    kwargs['category'] = parent
                channel = await guild.create_text_channel(**kwargs)
                return str(channel.id)
            return self._run(_do)
        except Exception:
            _LOG.exception('create_text_channel failed for %s', name)
            return None

    def create_thread(self, parent_channel_id, name, private=True):
        try:
            import discord  # type: ignore[import]
        except ImportError:
            return None
        channel = self.client.get_channel(int(parent_channel_id))
        if channel is None:
            _LOG.warning('create_thread: parent channel %s not found',
                          parent_channel_id)
            return None
        try:
            thread_type = (
                discord.ChannelType.private_thread if private
                else discord.ChannelType.public_thread
            )
            async def _do():
                thread = await channel.create_thread(
                    name=name, type=thread_type, invitable=False,
                )
                return str(thread.id)
            return self._run(_do)
        except Exception:
            _LOG.exception('create_thread failed for %s', name)
            return None

    def add_thread_member(self, thread_id: str, user_id: str) -> bool:
        """Add a user to a private thread so they can see it.
        Mirrors JS thread.members.add(playerId).
        """
        try:
            import discord  # type: ignore[import]
        except ImportError:
            return False
        try:
            thread = self.client.get_channel(int(thread_id))
            if thread is None:
                return False
            user_obj = discord.Object(id=int(user_id))
            async def _do():
                await thread.add_user(user_obj)
                return True
            return bool(self._run(_do))
        except Exception:
            _LOG.exception('add_thread_member failed for %s/%s',
                            thread_id, user_id)
            return False

    def build_player_overwrites(self, guild_id: str, p1_id: str, p2_id: str,
                                 *, kind: str = 'play') -> Dict[Any, Any]:
        """Construct discord.py PermissionOverwrite map mirroring JS
        playerPerms / playAreaPerms / boardPerms patterns.
        """
        try:
            import discord  # type: ignore[import]
        except ImportError:
            return {}
        guild = self._guild(guild_id)
        if guild is None:
            return {}

        everyone = guild.default_role
        bot_member = guild.me
        p1_obj = discord.Object(id=int(p1_id)) if p1_id and p1_id.isdigit() else None
        p2_obj = discord.Object(id=int(p2_id)) if p2_id and p2_id.isdigit() else None

        # Build admin role override (if Admin role exists).
        admin_role = None
        for role in guild.roles:
            if role.name.lower() == 'admin':
                admin_role = role
                break

        ow: Dict[Any, Any] = {}

        if kind == 'play':
            # General Chat / Game Log: hide from @everyone, players +
            # bot + admin can see + send.
            ow[everyone] = discord.PermissionOverwrite(view_channel=False)
            if p1_obj is not None:
                ow[p1_obj] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                )
            if p2_obj is not None:
                ow[p2_obj] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                )
            if bot_member is not None:
                ow[bot_member] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                    manage_messages=True, embed_links=True,
                    attach_files=True,
                )
            if admin_role is not None:
                ow[admin_role] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                    manage_messages=True,
                )

        elif kind == 'read_only':
            # Map Updates: players see, only bot writes.
            ow[everyone] = discord.PermissionOverwrite(view_channel=False)
            if p1_obj is not None:
                ow[p1_obj] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=False,
                )
            if p2_obj is not None:
                ow[p2_obj] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=False,
                )
            if bot_member is not None:
                ow[bot_member] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                    manage_messages=True, embed_links=True,
                    attach_files=True,
                )
            if admin_role is not None:
                ow[admin_role] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                )

        elif kind in ('play_area_p1', 'play_area_p2'):
            # Play areas: opponent reads (cannot send), player can send
            # in threads only, bot does everything. Mirrors JS playAreaPerms.
            owner_id = p1_obj if kind == 'play_area_p1' else p2_obj
            opponent_id = p2_obj if kind == 'play_area_p1' else p1_obj
            ow[everyone] = discord.PermissionOverwrite(
                view_channel=False, send_messages=False,
            )
            if owner_id is not None:
                ow[owner_id] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=False,
                    send_messages_in_threads=True,
                )
            if opponent_id is not None:
                ow[opponent_id] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=False,
                )
            if bot_member is not None:
                ow[bot_member] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                    create_private_threads=True,
                    create_public_threads=True,
                    manage_threads=True,
                    send_messages_in_threads=True,
                    embed_links=True, attach_files=True,
                )
            if admin_role is not None:
                ow[admin_role] = discord.PermissionOverwrite(
                    view_channel=True, send_messages=True,
                )

        return ow


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


# ── High-level: create a full game's channel set ───────────────────────


def _next_game_id_number(backend: ChannelFactoryBackend, guild_id: str) -> int:
    """Find the highest existing IA Game #N category, return N+1.
    Mirrors JS scan in createGameChannels.
    """
    cats = backend.list_categories(guild_id) or []
    max_id = 0
    for c in cats:
        m = _GAME_CATEGORY_RE.match(c.get('name') or '')
        if m:
            try:
                n = int(m.group(1))
                if n > max_id:
                    max_id = n
            except (TypeError, ValueError):
                continue
    return max_id + 1


def _build_player_overwrites(backend: 'ChannelFactoryBackend',
                              guild_id: str, p1_id: str, p2_id: str,
                              *, kind: str = 'play') -> Dict[str, Any]:
    """Build a discord.py PermissionOverwrite map mirroring JS's
    playerPerms: hide from @everyone, allow players + bot.

    `kind`:
      - 'play': both players read+write (general/log channels).
      - 'read_only': both players read; only bot writes (board channel).
      - 'play_area_p<n>': only player_n writes; opponent reads.

    Returns the dict shape discord.py's create_text_channel /
    create_category accepts as the `overwrites` kwarg.

    For non-discord backends (in-memory tests), returns a plain
    dict that the backend can ignore or store for assertion.
    """
    builder = getattr(backend, 'build_player_overwrites', None)
    if callable(builder):
        try:
            return builder(guild_id, p1_id, p2_id, kind=kind) or {}
        except Exception:
            _LOG.exception('build_player_overwrites failed')
            return {}
    return {}


def create_game_channels(game_id: str, guild_id: str,
                          p1_id: str, p2_id: str,
                          *, prefix: Optional[str] = None,
                          backend: Optional[ChannelFactoryBackend] = None
                          ) -> Dict[str, Optional[str]]:
    """Create the full channel set for a new game, mirroring JS:

      Category "IA Game #00001"  (right after "⚔️ Games" if it exists)
        ├ IA00001 Game Log           (log_channel_id)
        ├ IA00001 General Chat       (chat_channel_id)
        ├ IA00001 Map Updates        (board_channel_id)
        ├ IA00001 P1 Play Area       (p1_play_area_channel_id)
        ├ IA00001 P2 Play Area       (p2_play_area_channel_id)
        ├   ↳ private thread "Your Hand"  (p1_hand_channel_id)
        └   ↳ private thread "Your Hand"  (p2_hand_channel_id)

    Returns a dict with channel/thread IDs. Any field is None if
    creation failed; partial creation is left in place (caller
    decides whether to roll back via deleteGameChannelsAndGame).

    `prefix` arg is ignored in favor of the JS-style sequential
    naming. `game_id` is also ignored for naming purposes — JS
    derives the game number from the category scan, not from the
    in-memory game-state id.
    """
    be = backend or get_default_factory()

    next_n = _next_game_id_number(be, guild_id)
    pad = f'{next_n:05d}'
    cat_name = f'IA Game #{pad}'
    ch_prefix = f'IA{pad}'

    # Position: directly after the "Games" category if present (try
    # JS form '⚔️ Games' first, fall back to plain 'Games' for
    # servers without the emoji).
    games_cat = None
    for candidate in GAMES_CATEGORY_FALLBACKS:
        games_cat = be.find_category_by_name(guild_id, candidate)
        if games_cat:
            break
    position = None
    if games_cat:
        try:
            position = int(games_cat.get('position', 0)) + 1
        except (TypeError, ValueError):
            position = None

    out: Dict[str, Optional[str]] = {
        'game_category_id': None,
        'game_number': pad,
        'log_channel_id': None,
        'chat_channel_id': None,
        'board_channel_id': None,
        'p1_play_area_channel_id': None,
        'p2_play_area_channel_id': None,
        'p1_hand_channel_id': None,
        'p2_hand_channel_id': None,
    }

    # Build permission overwrite presets once.
    play_perms = _build_player_overwrites(be, guild_id, p1_id, p2_id, kind='play')
    read_only_perms = _build_player_overwrites(
        be, guild_id, p1_id, p2_id, kind='read_only',
    )
    p1_play_perms = _build_player_overwrites(
        be, guild_id, p1_id, p2_id, kind='play_area_p1',
    )
    p2_play_perms = _build_player_overwrites(
        be, guild_id, p1_id, p2_id, kind='play_area_p2',
    )

    cat_id = be.create_category(
        guild_id, cat_name, position=position, overwrites=play_perms,
    )
    out['game_category_id'] = cat_id
    if cat_id is None:
        _LOG.error('Failed to create game category %s', cat_name)
        return out

    out['log_channel_id'] = be.create_text_channel(
        guild_id, f'{ch_prefix} Game Log', parent_id=cat_id,
        overwrites=play_perms,
    )
    out['chat_channel_id'] = be.create_text_channel(
        guild_id, f'{ch_prefix} General Chat', parent_id=cat_id,
        overwrites=play_perms,
    )
    out['board_channel_id'] = be.create_text_channel(
        guild_id, f'{ch_prefix} Map Updates', parent_id=cat_id,
        overwrites=read_only_perms,
    )
    out['p1_play_area_channel_id'] = be.create_text_channel(
        guild_id, f'{ch_prefix} P1 Play Area', parent_id=cat_id,
        overwrites=p1_play_perms,
    )
    out['p2_play_area_channel_id'] = be.create_text_channel(
        guild_id, f'{ch_prefix} P2 Play Area', parent_id=cat_id,
        overwrites=p2_play_perms,
    )

    # Hand threads inside each play-area channel.
    if out['p1_play_area_channel_id']:
        out['p1_hand_channel_id'] = be.create_thread(
            out['p1_play_area_channel_id'], 'Your Hand', private=True,
        )
    if out['p2_play_area_channel_id']:
        out['p2_hand_channel_id'] = be.create_thread(
            out['p2_play_area_channel_id'], 'Your Hand', private=True,
        )

    return out
