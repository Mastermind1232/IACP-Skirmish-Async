"""Lobby buttons (Join Game, Start Game) as discord.py DynamicItems.

Replaces the prefix-based custom router for `lobby_join_<thread_id>`
and `lobby_start_<thread_id>`. discord.py owns the dispatch — when a
user clicks, the framework routes to LobbyJoinButton.callback /
LobbyStartButton.callback automatically, no router lookup or
build_context filtering involved.

Persistent across bot restarts — discord.py reconstructs the
DynamicItem from the customId regex template every time it sees a
matching click.

Bot wires these via `bot.add_dynamic_items(LobbyJoinButton,
LobbyStartButton)` at startup.
"""
from __future__ import annotations

import logging
from typing import Any

import discord
from discord import ui

_LOG = logging.getLogger('skirbo.views.lobby')


# ── Shared lobby state helpers ──────────────────────────────────────────


def _bot_deps(client: Any) -> dict:
    """Pull deps off the bot. The bot wires deps onto a `_skirbo_deps`
    attribute at startup so DynamicItem callbacks can reach the
    lobbies dict, game store, etc.
    """
    return getattr(client, '_skirbo_deps', None) or {}


# ── Lobby Join button ───────────────────────────────────────────────────


class LobbyJoinButton(
    ui.DynamicItem[ui.Button],
    template=r'lobby_join_(?P<thread_id>\d+)',
):
    """Persistent Join Game button. Custom_id pattern:
    `lobby_join_<thread_id>`. Lookup matched by the template regex.
    """

    def __init__(self, thread_id: str) -> None:
        super().__init__(
            ui.Button(
                style=discord.ButtonStyle.success,
                label='Join Game',
                custom_id=f'lobby_join_{thread_id}',
            ),
        )
        self.thread_id = thread_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Button,
        match: 'discord.ext.re.Match',
    ) -> 'LobbyJoinButton':
        return cls(thread_id=match['thread_id'])

    async def callback(self, interaction: discord.Interaction) -> None:
        deps = _bot_deps(interaction.client)
        lobbies = deps.get('lobbies') or {}
        lobby = lobbies.get(self.thread_id)

        # Missing lobby — bot may have restarted before reconstruction
        # picked it up, or thread is stale.
        if lobby is None:
            await interaction.response.send_message(
                '⚠️ Lobby state lost. Create a new forum post in '
                '#new-games.',
                ephemeral=True,
            )
            return

        if lobby.get('joinedId'):
            await interaction.response.send_message(
                'This lobby is already full.',
                ephemeral=True,
            )
            return

        joiner_id = str(interaction.user.id)
        creator_id = str(lobby.get('creatorId') or '')

        # MAX_ACTIVE_GAMES check (when wired).
        max_games = deps.get('MAX_ACTIVE_GAMES_PER_PLAYER')
        count_fn = deps.get('count_active_games_for_player')
        if (joiner_id != creator_id and callable(count_fn)
                and isinstance(max_games, int)
                and count_fn(joiner_id) >= max_games):
            await interaction.response.send_message(
                f'⚠️ You already have {max_games} active games. '
                f'Finish or forfeit one before joining a new lobby.',
                ephemeral=True,
            )
            return

        # Mutate lobby state.
        lobby['joinedId'] = joiner_id
        lobby['status'] = 'Full'

        # Edit the original lobby message in place to show the new
        # state and swap Join → Start. Refresh runs as a background
        # task so a thread-rename rate-limit (Discord caps thread
        # renames to ~2/10min) doesn't block the user's followup.
        await interaction.response.defer(ephemeral=True)
        import asyncio
        try:
            asyncio.create_task(
                _refresh_lobby_message(interaction, self.thread_id, lobby),
            )
        except Exception:
            _LOG.exception('scheduling lobby refresh failed')
        try:
            await interaction.followup.send(
                f'✅ You joined the lobby. Now <@{creator_id}> can click '
                f'**Start Game**.',
                ephemeral=True,
            )
        except Exception:
            pass


# ── Lobby Start button ──────────────────────────────────────────────────


class LobbyStartButton(
    ui.DynamicItem[ui.Button],
    template=r'lobby_start_(?P<thread_id>\d+)',
):
    """Persistent Start Game button. Visible only when the lobby is
    Full. Clicking advances to channel creation + setup."""

    def __init__(self, thread_id: str) -> None:
        super().__init__(
            ui.Button(
                style=discord.ButtonStyle.primary,
                label='Start Game',
                custom_id=f'lobby_start_{thread_id}',
            ),
        )
        self.thread_id = thread_id

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: ui.Button,
        match: 'discord.ext.re.Match',
    ) -> 'LobbyStartButton':
        return cls(thread_id=match['thread_id'])

    async def callback(self, interaction: discord.Interaction) -> None:
        deps = _bot_deps(interaction.client)
        lobbies = deps.get('lobbies') or {}
        lobby = lobbies.get(self.thread_id)

        if lobby is None:
            await interaction.response.send_message(
                '⚠️ Lobby state lost. Create a new forum post.',
                ephemeral=True,
            )
            return

        if not lobby.get('joinedId'):
            await interaction.response.send_message(
                'You need a second player to join before starting.',
                ephemeral=True,
            )
            return

        starter_id = str(interaction.user.id)
        creator_id = str(lobby.get('creatorId') or '')
        if starter_id != creator_id:
            await interaction.response.send_message(
                'Only the lobby creator can start the game.',
                ephemeral=True,
            )
            return

        lobby['status'] = 'Started'

        await interaction.response.defer(ephemeral=True)

        # Game creation FIRST (the user-facing thing that matters).
        # Lobby cosmetic refresh fires-and-forgets afterward so a
        # thread-rename rate-limit doesn't block channel creation.
        # cmd_startgame is SYNC and internally blocks waiting for
        # discord.py coroutines via run_coroutine_threadsafe; running
        # it on the event loop deadlocks. asyncio.to_thread offloads
        # it so the loop stays free for the scheduled coroutines.
        import asyncio
        try:
            from python.discord_bot.commands import cmd_startgame
            guild_id = (
                str(interaction.guild.id) if interaction.guild else None
            )
            result = await asyncio.to_thread(
                cmd_startgame, creator_id, deps,
                opponent_id=lobby['joinedId'],
                guild_id=guild_id,
            )
            if result.get('ok'):
                await interaction.followup.send(
                    f'🎲 Game **{result["gameId"]}** created. Check the '
                    f'play-area channels.',
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f'❌ Game creation failed: {result.get("reason")}',
                    ephemeral=True,
                )
        except Exception as e:
            _LOG.exception('start game flow failed')
            try:
                await interaction.followup.send(
                    f'❌ Start failed: {type(e).__name__}: {e}',
                    ephemeral=True,
                )
            except Exception:
                pass

        # Cosmetic lobby refresh — fire-and-forget. Discord rate-limits
        # thread renames to ~2 per 10 minutes; if we're capped, the
        # PATCH sleeps 500+ seconds. We don't want that to block the
        # main flow OR the user's followup. asyncio.create_task lets
        # it run in the background without blocking this coroutine.
        try:
            asyncio.create_task(
                _refresh_lobby_message(interaction, self.thread_id, lobby),
            )
        except Exception:
            _LOG.exception('scheduling lobby refresh failed')


# ── Embed + view builders ──────────────────────────────────────────────


def build_lobby_embed(lobby: dict) -> discord.Embed:
    """Build the Game Lobby embed. Replaces the inline copy in
    main.py / src/discord/embeds.js getLobbyEmbed.
    """
    creator_id = lobby.get('creatorId') or ''
    joined_id = lobby.get('joinedId')
    is_ready = bool(joined_id)
    p1 = f'1. **Player 1:** <@{creator_id}>'
    p2 = (
        f'2. **Player 2:** <@{joined_id}>' if joined_id
        else '2. **Player 2:** *(not yet joined)*'
    )
    body = (
        f'{p1}\n{p2}\n\n'
        + ('Both players ready! Click **Start Game** to begin.'
           if is_ready
           else 'Click **Join Game** to play!')
    )
    return discord.Embed(title='Game Lobby', description=body, color=0x2B2D31)


def build_lobby_view(thread_id: str, lobby: dict) -> ui.View:
    """Build a View with the right button (Join when LFG; Start when
    Full). View timeout=None makes the buttons persistent — the
    DynamicItem regex template lets discord.py route clicks even
    after a bot restart.
    """
    view = ui.View(timeout=None)
    if lobby.get('joinedId'):
        view.add_item(LobbyStartButton(thread_id=str(thread_id)))
    else:
        view.add_item(LobbyJoinButton(thread_id=str(thread_id)))
    return view


async def send_lobby_embed(thread: Any, lobby: dict) -> None:
    """Send a fresh lobby embed to the thread. Used by on_message
    when a new forum post arrives.
    """
    await thread.send(
        embed=build_lobby_embed(lobby),
        view=build_lobby_view(str(thread.id), lobby),
    )


async def _refresh_lobby_message(
    interaction: discord.Interaction, thread_id: str, lobby: dict,
) -> None:
    """Find the bot's prior lobby embed in the thread and edit it
    in place. Falls back to sending a new one if not found.
    """
    bot = interaction.client
    try:
        thread = bot.get_channel(int(thread_id)) or await bot.fetch_channel(
            int(thread_id),
        )
    except Exception:
        return
    msg = None
    async for m in thread.history(limit=20, oldest_first=False):
        if (m.author.id == bot.user.id and m.embeds
                and m.embeds[0].title == 'Game Lobby'):
            msg = m
            break
    embed = build_lobby_embed(lobby)
    view = build_lobby_view(thread_id, lobby)
    if msg is None:
        await thread.send(embed=embed, view=view)
    else:
        await msg.edit(embed=embed, view=view)

    # Best-effort thread rename to reflect status.
    status = lobby.get('status') or 'LFG'
    cur = thread.name or ''
    base = cur
    if base.startswith('['):
        idx = base.find(']')
        if idx > 0:
            base = base[idx + 1:].strip()
    new_name = f'[{status}] {base}' if base else f'[{status}]'
    if new_name != cur:
        try:
            await thread.edit(name=new_name)
        except Exception:
            pass
