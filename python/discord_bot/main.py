"""Discord bot entry point — mirror of src/index.js (Node → Python).

Responsibilities:
  - Load config (token, guild id, intents).
  - Import handler modules so they self-register via handlers/__init__.py.
  - Wire the on_interaction event to the router.
  - Boot the bot with discord.py's asyncio runtime.

discord.py is not imported at module load time so tests can exercise the
router/context without a real Discord dependency. Production entry
path is `asyncio.run(run_bot())`.
"""
from __future__ import annotations

import importlib
import logging
import os
from typing import Any, Dict, List

from python.discord_bot.router import route


_LOG = logging.getLogger('skirbo.bot')


# ── Handler module list — imported at boot to trigger self-registration ─────

_HANDLER_MODULES: List[str] = [
    'python.discord_bot.handlers.activation',
    'python.discord_bot.handlers.combat',
    'python.discord_bot.handlers.movement',
    'python.discord_bot.handlers.interact',
    'python.discord_bot.handlers.phase_gate',
    'python.discord_bot.handlers.round',
    'python.discord_bot.handlers.cc_hand',
    'python.discord_bot.handlers.dc_play_area',
    'python.discord_bot.handlers.setup',
    'python.discord_bot.handlers.stepper_bridge',
]


def register_all_handlers() -> int:
    """Import every handler module; returns the count imported successfully.

    Any module that doesn't exist yet is silently skipped so the port can
    land handlers incrementally.
    """
    imported = 0
    for mod_name in _HANDLER_MODULES:
        try:
            importlib.import_module(mod_name)
            imported += 1
        except ModuleNotFoundError:
            _LOG.debug('Handler module %s not yet ported; skipping', mod_name)
        except Exception as e:
            _LOG.error('Handler module %s failed to import: %s', mod_name, e)
    return imported


def build_deps(game_store: Any, client: Any = None) -> Dict[str, Any]:
    """Construct the deps map the router hands to build_context().

    Test ergonomics: pass a dict-backed game_store and None client.
    Production: a real GameStore + discord.Client.
    """
    return {
        'get_game': game_store.get if hasattr(game_store, 'get') else game_store,
        'save_games': getattr(game_store, 'save', lambda: None),
        'client': client,
        # Logging no-op by default; production wires Discord log channel
        'log_game_action': lambda *a, **k: None,
        # The rest of the deps land as modules/fns get ported. For now, None.
        'dc_message_meta': {},
        'dc_health_state': {},
        'opponent_player_num': lambda pn: 2 if pn == 1 else 1,
    }


async def on_interaction(interaction: Any, deps: Dict[str, Any]) -> Dict[str, Any]:
    """Callback for the Discord on_interaction event. Route + return result."""
    return await route(interaction, deps)


_SLASH_COMMANDS = [
    # (name, description, command_handler, param_names)
    ('startgame', 'Start a new game with an opponent.', 'cmd_startgame',
     ['opponent_id', 'game_id?']),
    ('squad', 'Submit your squad for a game.', 'cmd_squad',
     ['game_id', 'deployment_cards', 'cc_cards?']),
    ('startbattle', 'Begin the battle (runs setup chain).', 'cmd_startbattle',
     ['game_id', 'map_id', 'variant?', 'zone?']),
    ('status', 'Show game status.', 'cmd_status', ['game_id']),
    ('forfeit', 'Forfeit the game — opponent wins.', 'cmd_forfeit',
     ['game_id']),
    ('listgames', 'List your active games.', 'cmd_list_games', []),
    ('legalactions', 'Show legal actions for the active player.',
     'cmd_legal_actions', ['game_id']),
    ('stepaction', 'Apply a single action to a game.', 'cmd_step_action',
     ['game_id', 'action_type', 'action_params?', 'player_num?']),
    ('setupchannels', 'Bind a game to its Discord channels.',
     'cmd_setup_channels', ['game_id', 'board_channel_id?',
                             'log_channel_id?', 'p1_play_area_channel_id?',
                             'p2_play_area_channel_id?',
                             'p1_hand_channel_id?', 'p2_hand_channel_id?']),
]


def slash_command_names() -> list:
    """Return the list of slash-command names the bot exposes."""
    return [name for name, *_ in _SLASH_COMMANDS]


def slash_command_dispatch(name: str, user_id: str, deps: Dict[str, Any],
                            **params) -> Dict[str, Any]:
    """Run a slash command by name.

    Returns the command's result dict. Raises ValueError if the command
    is not registered.
    """
    from python.discord_bot import commands as _cmds
    for cmd_name, _desc, cmd_attr, _params in _SLASH_COMMANDS:
        if cmd_name == name:
            fn = getattr(_cmds, cmd_attr, None)
            if fn is None:
                raise RuntimeError(
                    f'slash command {name!r} bound to missing '
                    f'commands.{cmd_attr}',
                )
            return fn(user_id, deps, **params)
    raise ValueError(f'unknown slash command: {name!r}')


def wire_slash_commands(bot: Any, deps: Dict[str, Any]) -> int:
    """Register every slash command on the given discord.py Client.

    The bot must expose a `tree` attribute (discord.Client + commands.Bot
    both do). Each command dispatches to the matching cmd_* via
    slash_command_dispatch.

    Returns the number of commands registered. Graceful no-op if the bot
    doesn't have a tree attribute (test environments).
    """
    tree = getattr(bot, 'tree', None)
    if tree is None:
        return 0

    try:
        import discord  # type: ignore[import]
        from discord import app_commands  # type: ignore[import]
    except ImportError:
        return 0

    registered_count = 0

    for cmd_name, desc, _cmd_attr, _params in _SLASH_COMMANDS:
        # Build a closure per command so each keeps its own name.
        def _make(name: str, description: str):
            @tree.command(name=name, description=description)
            async def _runner(interaction: 'discord.Interaction'):
                user_id = str(interaction.user.id)
                try:
                    result = slash_command_dispatch(name, user_id, deps)
                except ValueError as e:
                    await interaction.response.send_message(
                        f'Error: {e}', ephemeral=True,
                    )
                    return
                # Short reply; rich embeds go in followup channels.
                content = (
                    f'✓ {name}: {result}' if result.get('ok')
                    else f'✗ {name}: {result.get("reason") or result}'
                )
                await interaction.response.send_message(content, ephemeral=True)
            return _runner

        _make(cmd_name, desc)
        registered_count += 1

    return registered_count


async def run_bot() -> None:
    """Boot the bot with discord.py and hand button events to the router.

    Requires the DISCORD_BOT_TOKEN env var. Imports discord lazily so
    import-time errors in the rest of the package surface before this.

    Picks a game store via db.make_store (DATABASE_URL → Postgres,
    SKIRBO_GAMES_PATH → JSON, else InMemory). Wires a DiscordBackend
    and DiscordFactoryBackend so channel posts + channel creation
    go through discord.py.
    """
    import discord  # type: ignore[import]
    from discord.ext import commands as _commands  # type: ignore[import]

    from python.discord_bot.channel_factory import (
        DiscordFactoryBackend, set_default_factory,
    )
    from python.discord_bot.channels import (
        DiscordBackend, set_default_backend,
    )
    from python.discord_bot.db import make_store

    # Accept either DISCORD_TOKEN (JS-bot legacy) or DISCORD_BOT_TOKEN.
    token = os.environ.get('DISCORD_TOKEN') or os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        raise RuntimeError('DISCORD_TOKEN or DISCORD_BOT_TOKEN env var required')

    intents = discord.Intents.default()
    intents.message_content = True
    # Use commands.Bot so we get a `tree` for slash-command registration.
    bot = _commands.Bot(command_prefix='!', intents=intents)

    # Self-register all handler modules
    registered = register_all_handlers()
    _LOG.info('Registered %d handler modules', registered)

    # Persistent store — Postgres / JSON file / in-memory.
    game_store = make_store()
    _LOG.info('Game store: %s', type(game_store).__name__)

    # Wire discord.py-backed channel + factory backends as the defaults,
    # so game_channels.refresh_game_view / create_game_channels post to
    # real Discord.
    channel_backend = DiscordBackend(bot)
    set_default_backend(channel_backend)
    set_default_factory(DiscordFactoryBackend(bot))

    deps = build_deps(game_store, bot)
    deps['channel_backend'] = channel_backend
    # Let handlers both read and write via the store.
    if hasattr(game_store, 'save'):
        deps['save_game'] = game_store.save
    # Lobby state: thread_id → {creatorId, joinedId, status}.
    # Populated by the on_message listener below; consumed by
    # lobby_join_ / lobby_start_ button handlers.
    deps.setdefault('lobbies', {})
    deps.setdefault('lobby_embed_sent', set())

    # Register slash commands on the bot's tree.
    slash_count = wire_slash_commands(bot, deps)
    _LOG.info('Registered %d slash commands', slash_count)

    @bot.event
    async def on_interaction_event(interaction):  # noqa: D401
        # Only route non-slash interactions (buttons, modals) through the
        # router. Slash commands are dispatched via the tree above.
        itype = getattr(interaction, 'type', None)
        if itype is None or str(itype).endswith('application_command'):
            return
        result = await on_interaction(interaction, deps)
        if not result.get('ok'):
            _LOG.warning('Route failed: %s', result)

    @bot.event
    async def on_ready():  # noqa: D401
        await bot.tree.sync()
        _LOG.info('Bot ready: %s (synced %d commands)',
                  bot.user, slash_count)

    @bot.event
    async def on_message(message):  # noqa: D401
        """Watch #new-games forum for new posts → create a lobby.

        Mirrors src/index.js maybeSetupLobbyFromFirstMessage. Discord
        forum threads aren't messageable until the author posts the
        first message, so we hook on_message rather than on_thread_create.
        """
        try:
            if message.author.bot:
                return
            thread = message.channel
            if not getattr(thread, 'parent', None):
                return
            parent_name = getattr(thread.parent, 'name', '') or ''
            if parent_name != 'new-games':
                return

            lobbies = deps['lobbies']
            embed_sent = deps['lobby_embed_sent']
            tid = str(thread.id)
            if tid in lobbies or tid in embed_sent:
                return
            embed_sent.add(tid)

            lobby = {
                'creatorId': str(message.author.id),
                'joinedId': None,
                'status': 'LFG',
            }
            lobbies[tid] = lobby
            await _send_lobby_embed(thread, lobby)
            await _update_lobby_thread_name(thread, lobby)
        except Exception:
            _LOG.exception('on_message lobby setup failed')

    await bot.start(token)


async def _send_lobby_embed(thread: Any, lobby: Dict[str, Any]) -> None:
    """Post the Game Lobby embed + Join Game button into the thread.
    Mirrors getLobbyEmbed + getLobbyJoinButton from src/discord/.
    """
    import discord  # type: ignore[import]

    creator_id = lobby.get('creatorId') or ''
    joined_id = lobby.get('joinedId')
    is_ready = bool(joined_id)
    p1 = f'1. **Player 1:** <@{creator_id}>'
    p2 = (f'2. **Player 2:** <@{joined_id}>' if joined_id
          else '2. **Player 2:** *(not yet joined)*')
    body = (f'{p1}\n{p2}\n\n'
            + ('Both players ready! Click **Start Game** to begin.'
               if is_ready
               else 'Click **Join Game** to play!'))
    embed = discord.Embed(title='Game Lobby', description=body, color=0x2B2D31)

    # Build a button row.
    view = discord.ui.View(timeout=None)
    if is_ready:
        view.add_item(discord.ui.Button(
            style=discord.ButtonStyle.primary,
            label='Start Game',
            custom_id=f'lobby_start_{thread.id}',
        ))
    else:
        view.add_item(discord.ui.Button(
            style=discord.ButtonStyle.success,
            label='Join Game',
            custom_id=f'lobby_join_{thread.id}',
        ))
    await thread.send(embed=embed, view=view)


async def _update_lobby_thread_name(thread: Any,
                                    lobby: Dict[str, Any]) -> None:
    """Rename the thread to reflect lobby status. Best-effort —
    Discord rate-limits thread renames hard."""
    status = lobby.get('status') or 'LFG'
    cur_name = getattr(thread, 'name', '') or ''
    # Strip any leading [STATUS] tag.
    base = cur_name
    if base.startswith('['):
        idx = base.find(']')
        if idx > 0:
            base = base[idx + 1:].strip()
    new_name = f'[{status}] {base}' if base else f'[{status}]'
    if new_name == cur_name:
        return
    try:
        await thread.edit(name=new_name)
    except Exception:
        # Discord rate-limits / perm errors are non-fatal here.
        pass
