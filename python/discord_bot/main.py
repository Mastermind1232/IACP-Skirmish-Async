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
    'python.discord_bot.handlers.activation_picks',
    'python.discord_bot.handlers.blitz_deploy',
    'python.discord_bot.handlers.botmenu',
    'python.discord_bot.handlers.cc_hand',
    'python.discord_bot.handlers.combat',
    'python.discord_bot.handlers.combat_picks',
    'python.discord_bot.handlers.combat_reactions',
    'python.discord_bot.handlers.combat_special_effects',
    'python.discord_bot.handlers.dc_play_area',
    'python.discord_bot.handlers.fast_forward',
    'python.discord_bot.handlers.favorites',
    'python.discord_bot.handlers.game_tools',
    'python.discord_bot.handlers.interact',
    'python.discord_bot.handlers.interrupts',
    'python.discord_bot.handlers.interrupts_extras',
    'python.discord_bot.handlers.lobby',
    'python.discord_bot.handlers.map_events',
    'python.discord_bot.handlers.movement',
    'python.discord_bot.handlers.movement_extras',
    'python.discord_bot.handlers.phase_gate',
    'python.discord_bot.handlers.post_combat',
    'python.discord_bot.handlers.post_deploy',
    'python.discord_bot.handlers.post_deploy_picks',
    'python.discord_bot.handlers.requests',
    'python.discord_bot.handlers.round',
    'python.discord_bot.handlers.setup',
    'python.discord_bot.handlers.setup_extras',
    'python.discord_bot.handlers.space_picker',
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


async def route_interaction(interaction: Any, deps: Dict[str, Any]) -> Dict[str, Any]:
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
    # Stats commands (read-only)
    ('statcheck', 'Show completed games summary.', 'cmd_statcheck', []),
    ('mystats', 'Show your personal stats.', 'cmd_statcheck_personal', []),
    ('affiliationwinrateglobal', 'Win rate by affiliation across all games.',
     'cmd_affiliation_winrate_global', []),
    ('affiliationwinratepersonal', 'Your win rate by affiliation.',
     'cmd_affiliation_winrate_personal', []),
    ('affiliationpickrateglobal', 'Pick rate by affiliation across all games.',
     'cmd_affiliation_pickrate_global', []),
    ('affiliationpickratepersonal', 'Your pick rate by affiliation.',
     'cmd_affiliation_pickrate_personal', []),
    ('dcwinrateglobaltopten', 'Win rate by DC (top 20 by games played).',
     'cmd_dc_winrate_global', []),
    ('dcwinratepersonaltopten', 'Your win rate by DC (top 20).',
     'cmd_dc_winrate_personal', []),
    ('leaderboard', 'Top players by win rate (≥5 completed games).',
     'cmd_leaderboard', []),
    ('achievements', 'Your earned achievements.', 'cmd_achievements', []),
    # Admin commands
    ('botmenu', 'Open Bot Stuff menu (Kill Game admin).',
     'cmd_botmenu', []),
    ('powertokenlist', 'List figures with active power tokens.',
     'cmd_power_token_list', ['game_id']),
    ('powertokenadd', 'Manually grant a power token to a figure.',
     'cmd_power_token_add', ['game_id', 'figure_key', 'token_type']),
    ('powertokenremove', 'Manually remove a power token from a figure.',
     'cmd_power_token_remove', ['game_id', 'figure_key', 'index']),
    ('conditionadd', 'Manually apply a condition to a figure.',
     'cmd_condition_add', ['game_id', 'figure_key', 'condition']),
    ('conditionremove', 'Manually clear a condition from a figure.',
     'cmd_condition_remove', ['game_id', 'figure_key', 'condition']),
    ('testgame', 'Spin up a self-vs-self test game (dev shortcut).',
     'cmd_testgame', ['scenario?']),
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


async def run_bot(cfg: 'BotConfig' = None) -> None:
    """Boot the bot with discord.py and hand button events to the router.

    Accepts a BotConfig (load_from_env()) — preferred entry. For
    backwards compat, a None argument falls back to env-loading
    inside this function (so existing tests + ad-hoc invocations
    don't break).

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
    from python.discord_bot.config import BotConfig
    from python.discord_bot.db import make_store

    if cfg is None:
        cfg = BotConfig.load_from_env()
    token = cfg.discord_token

    intents = discord.Intents.default()
    intents.message_content = True
    # Use commands.Bot so we get a `tree` for slash-command registration.
    bot = _commands.Bot(command_prefix='!', intents=intents)

    # Register discord.py-native DynamicItem buttons (lobby first).
    # Each class' regex template lets the framework route clicks
    # without our custom router. Persistent across restarts.
    try:
        from python.discord_bot import views as _views
        for cls in _views.all_dynamic_item_classes():
            bot.add_dynamic_items(cls)
        _LOG.info(
            'Registered %d dynamic-item button classes',
            len(_views.all_dynamic_item_classes()),
        )
    except Exception:
        _LOG.exception('Dynamic-item registration failed')

    # Self-register all handler modules
    registered = register_all_handlers()
    _LOG.info('Registered %d handler modules', registered)

    # Persistent store — Postgres / JSON file / in-memory.
    game_store = make_store()
    _LOG.info('Game store: %s', type(game_store).__name__)

    # Seed achievement definitions on startup. No-op when no DB.
    try:
        from python.discord_bot.achievements import seed_achievements
        n = seed_achievements(game_store)
        if n:
            _LOG.info('Seeded %d achievement definitions', n)
    except Exception:
        _LOG.exception('Achievement seeding failed')

    # Wire discord.py-backed channel + factory backends as the defaults,
    # so game_channels.refresh_game_view / create_game_channels post to
    # real Discord.
    channel_backend = DiscordBackend(bot)
    set_default_backend(channel_backend)
    set_default_factory(DiscordFactoryBackend(bot))

    deps = build_deps(game_store, bot)
    deps['channel_backend'] = channel_backend
    # Surface validated config so consumers (e.g. achievements channel
    # poster, max-active-games gate) read typed fields instead of
    # calling os.environ.get themselves.
    deps['config'] = cfg
    deps['MAX_ACTIVE_GAMES_PER_PLAYER'] = cfg.max_active_games_per_player
    # Let handlers both read and write via the store.
    if hasattr(game_store, 'save'):
        deps['save_game'] = game_store.save
    if hasattr(game_store, 'list_ids'):
        deps['list_game_ids'] = game_store.list_ids
    if hasattr(game_store, 'delete'):
        deps['delete_game'] = game_store.delete
    # Lobby state: thread_id → {creatorId, joinedId, status}.
    # Populated by the on_message listener below; consumed by
    # lobby_join_ / lobby_start_ button handlers.
    deps.setdefault('lobbies', {})
    deps.setdefault('lobby_embed_sent', set())

    # Hang deps off the bot so DynamicItem callbacks (which only
    # receive the interaction) can reach them via interaction.client.
    bot._skirbo_deps = deps

    # Register slash commands on the bot's tree.
    slash_count = wire_slash_commands(bot, deps)
    _LOG.info('Registered %d slash commands', slash_count)

    # Prefix list of custom_ids handled by DynamicItems. Our custom
    # router skips these so we don't double-respond. Each entry is
    # the prefix portion of the DynamicItem's regex template.
    DYNAMIC_ITEM_PREFIXES = ('lobby_join_', 'lobby_start_')

    @bot.listen('on_interaction')
    async def on_interaction(interaction):  # noqa: D401
        # ADDITIVE listener (bot.listen, NOT bot.event). This means
        # discord.py's default on_interaction still runs — which is
        # what dispatches DynamicItems (lobby buttons) and slash
        # commands. Our listener handles legacy prefix-based custom
        # router for buttons not yet migrated to View classes.
        itype = getattr(interaction, 'type', None)
        if itype is None or str(itype).endswith('application_command'):
            return
        # Skip — DynamicItem already handles these.
        cid_check = (
            (getattr(interaction, 'data', {}) or {}).get('custom_id', '')
            or getattr(interaction, 'custom_id', '') or ''
        )
        if any(cid_check.startswith(p) for p in DYNAMIC_ITEM_PREFIXES):
            return
        # Custom-id prefixes that need to open a Discord modal must NOT
        # be defer()-acknowledged first — show_modal() must be the
        # initial response. For all others, defer immediately so Discord
        # doesn't show "The interaction failed" while the handler runs.
        custom_id = (
            (getattr(interaction, 'data', {}) or {}).get('custom_id')
            or getattr(interaction, 'custom_id', '')
            or ''
        )
        needs_modal = custom_id.startswith('squad_select_')
        if not needs_modal:
            try:
                resp = getattr(interaction, 'response', None)
                if resp is not None and not resp.is_done():
                    await resp.defer(ephemeral=True)
            except Exception:
                pass
        result = await route_interaction(interaction, deps)
        if not result.get('ok'):
            _LOG.warning('Route failed: %s', result)
        # Per-handler UI follow-ups.
        try:
            await _post_route_ui_followup(interaction, result, bot, deps)
        except Exception:
            _LOG.exception('post-route UI follow-up failed')

    @bot.event
    async def on_ready():  # noqa: D401
        await bot.tree.sync()
        _LOG.info('Bot ready: %s (synced %d commands)',
                  bot.user, slash_count)
        # Reconstruct lobbies from existing #new-games threads — survives
        # bot restarts. Mirrors src/index.js lobby reconstruction loop.
        try:
            await _reconstruct_lobbies(bot, deps)
        except Exception:
            _LOG.exception('Lobby reconstruction failed')
        # Auto-refresh active game views so post-redeploy UI reflects
        # current state. Mirrors src/index.js startup auto-refresh.
        try:
            await _refresh_active_games(bot, deps)
        except Exception:
            _LOG.exception('Active game refresh failed')

    @bot.event
    async def on_guild_channel_delete(channel):  # noqa: D401
        """When a game's channel is manually deleted, clean up its DB
        records. Mirrors src/index.js client.on('channelDelete').
        """
        try:
            await _handle_channel_delete(channel, deps)
        except Exception:
            _LOG.exception('on_guild_channel_delete failed')

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
            from python.discord_bot.views import lobby as _lobby_view
            await _lobby_view.send_lobby_embed(thread, lobby)
            await _update_lobby_thread_name(thread, lobby)
        except Exception:
            _LOG.exception('on_message lobby setup failed')

        # Admin text commands (typed in #lfg or #bothelpers).
        try:
            await _maybe_handle_admin_text(message, deps)
        except Exception:
            _LOG.exception('admin text command handler failed')

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


# ---------------------------------------------------------------------------
# Lobby reconstruction on bot restart


async def _reconstruct_lobbies(bot: Any, deps: Dict[str, Any]) -> None:
    """Scan every #new-games forum across every guild and rebuild the
    in-memory lobby dict from the bot's existing 'Game Lobby' embeds.
    Mirrors the JS reconstruction loop in src/index.js.
    """
    import re
    import discord  # type: ignore[import]

    lobbies = deps['lobbies']
    embed_sent = deps['lobby_embed_sent']
    total = 0
    for guild in bot.guilds:
        forum = next(
            (c for c in guild.channels
             if isinstance(c, discord.ForumChannel) and c.name == 'new-games'),
            None,
        )
        if forum is None:
            continue
        try:
            active = forum.threads
        except Exception:
            continue
        for thread in active:
            tid = str(thread.id)
            if tid in lobbies:
                continue
            try:
                # Find the bot's "Game Lobby" embed in the thread.
                lobby_msg = None
                async for m in thread.history(limit=10, oldest_first=True):
                    if (m.author.id == bot.user.id and m.embeds
                            and m.embeds[0].title == 'Game Lobby'):
                        lobby_msg = m
                        break
                if lobby_msg is None:
                    continue
                desc = (lobby_msg.embeds[0].description or '')
                player_ids = re.findall(r'<@(\d+)>', desc)
                if not player_ids:
                    continue
                creator_id = player_ids[0]
                joined_id = player_ids[1] if len(player_ids) >= 2 else None
                # Skip threads where the game already launched.
                tname = thread.name or ''
                if tname.startswith('[Launched]'):
                    continue
                status = 'Full' if (tname.startswith('[Full]') or joined_id) else 'LFG'
                lobbies[tid] = {
                    'creatorId': creator_id,
                    'joinedId': joined_id,
                    'status': status,
                }
                embed_sent.add(tid)
                total += 1
            except Exception:
                _LOG.warning(
                    'Failed to reconstruct lobby for thread %s',
                    thread.id, exc_info=True,
                )
    if total > 0:
        _LOG.info('Reconstructed %d lobby/lobbies from #new-games', total)


# ---------------------------------------------------------------------------
# Active-game auto-refresh on startup


async def _refresh_active_games(bot: Any, deps: Dict[str, Any]) -> None:
    """Refresh game views for every active game so post-redeploy UI
    reflects current state. Mirrors src/index.js startup loop.
    """
    get_game = deps.get('get_game')
    list_ids = deps.get('list_game_ids')
    if not (callable(get_game) and callable(list_ids)):
        return
    try:
        from python.discord_bot import game_channels as gc
    except Exception:
        return
    backend = deps.get('channel_backend')
    refreshed = 0
    for game_id in list_ids() or []:
        try:
            game = get_game(game_id)
            if game is None:
                continue
            data = game.data if hasattr(game, 'data') else game
            if not isinstance(data, dict):
                continue
            if data.get('archived') or data.get('killed'):
                continue
            if not data.get('selectedMap'):
                continue
            gc.refresh_game_view(game_id, game, backend=backend)
            gc.refresh_hand_view(game_id, 1, game, backend=backend)
            gc.refresh_hand_view(game_id, 2, game, backend=backend)
            refreshed += 1
        except Exception:
            _LOG.warning(
                'Failed to refresh active game %s', game_id, exc_info=True,
            )
    if refreshed > 0:
        _LOG.info('Refreshed %d active game view(s)', refreshed)


# ---------------------------------------------------------------------------
# Channel-delete handler


async def _handle_channel_delete(channel: Any, deps: Dict[str, Any]) -> None:
    """Find the game associated with a deleted channel and clean up
    its DB record. Mirrors src/index.js client.on('channelDelete').
    """
    channel_id = str(getattr(channel, 'id', '') or '')
    if not channel_id:
        return

    get_game = deps.get('get_game')
    list_ids = deps.get('list_game_ids')
    delete_game = deps.get('delete_game')
    if not (callable(get_game) and callable(list_ids)):
        return

    # Find the game whose channels include this one.
    channel_keys = (
        'gameCategoryId', 'generalId', 'chatId', 'boardId',
        'gameLogId', 'p1PlayAreaId', 'p2PlayAreaId',
        'p1HandId', 'p2HandId',
    )
    matched_id = None
    for game_id in list_ids() or []:
        game = get_game(game_id)
        if game is None:
            continue
        data = game.data if hasattr(game, 'data') else game
        if not isinstance(data, dict):
            continue
        for key in channel_keys:
            if str(data.get(key) or '') == channel_id:
                matched_id = game_id
                break
        if matched_id:
            break

    if matched_id is None:
        return

    # Re-entrancy guard: bot-initiated deletions also fire this event.
    guard = deps.setdefault('_channel_delete_guard', set())
    if matched_id in guard:
        return
    guard.add(matched_id)
    try:
        _LOG.info('External channel deletion for game %s — cleaning up',
                  matched_id)
        if callable(delete_game):
            try:
                delete_game(matched_id)
            except Exception:
                _LOG.warning('delete_game(%s) failed', matched_id,
                              exc_info=True)
    finally:
        guard.discard(matched_id)


# ---------------------------------------------------------------------------
# Admin text commands (typed in #lfg, #bothelpers)


async def _post_route_ui_followup(interaction: Any,
                                   result: Dict[str, Any],
                                   bot: Any,
                                   deps: Dict[str, Any]) -> None:
    """After a button handler runs, render any UI follow-up the
    handler signaled (lobby embed refresh, modal show, ephemeral
    error message, etc.).

    The router-level defer() already acknowledged the interaction;
    this helper sends the actual user-facing response.
    """
    if not isinstance(result, dict):
        return

    # Modal show: handlers that need a popup (e.g. squad_select_)
    # return showModal=True with a modal definition. We routed without
    # deferring for these; now build + show the modal.
    if result.get('showModal'):
        try:
            await _show_modal_from_handler_result(interaction, result)
        except Exception:
            _LOG.exception(
                'show_modal failed for custom_id %s',
                getattr(interaction, 'custom_id', None),
            )
        return

    custom_id = getattr(interaction, 'custom_id', None)
    if not isinstance(custom_id, str):
        return

    prefix = result.get('prefix') or ''

    # Lobby join → refresh the lobby embed in the thread.
    if prefix == 'lobby_join_' and result.get('ok'):
        thread_id = custom_id[len('lobby_join_'):]
        await _refresh_lobby_thread(bot, thread_id, deps)

    # Lobby start → render post-start state (creates game channels).
    if prefix == 'lobby_start_' and result.get('ok'):
        thread_id = custom_id[len('lobby_start_'):]
        await _refresh_lobby_thread(bot, thread_id, deps,
                                    status_override='Started')

    # Default ephemeral acknowledgment if the handler returned an error.
    if not result.get('ok'):
        try:
            reason = result.get('reason') or 'unknown'
            cid = (
                getattr(interaction, 'custom_id', None)
                or (getattr(interaction, 'data', {}) or {}).get('custom_id')
                or '?'
            )
            # Map common reasons to plain-English messages.
            msg_map = {
                'no_handler': (
                    f"⚠️ This button isn't wired up yet on the new bot "
                    f"(`{cid}`). It worked on the old JavaScript bot but "
                    f"the Python port doesn't have a handler for it. "
                    f"Tell @corndog19 with that ID."
                ),
                'fallback_error': (
                    f"❌ Action failed: {result.get('error', 'unknown')}"
                ),
                'no_custom_id': "⚠️ Button has no customId — likely a bug.",
                'lobby_not_found': (
                    "⚠️ Lobby state lost (bot may have restarted). "
                    "Create a new forum post in #new-games."
                ),
                'lobby_full': (
                    "⚠️ Lobby is already full. The other player joined."
                ),
            }
            text = msg_map.get(reason) or f'❌ {reason}'
            await interaction.followup.send(text, ephemeral=True)
        except Exception:
            pass


async def _show_modal_from_handler_result(interaction: Any,
                                            result: Dict[str, Any]) -> None:
    """Build a discord.ui.Modal from a handler's showModal result and
    send it via interaction.response.send_modal().
    """
    import discord  # type: ignore[import]

    modal_id = result.get('modalCustomId') or 'modal'
    title = result.get('title') or 'Submit'
    fields = result.get('fields') or []

    class _DynModal(discord.ui.Modal):
        def __init__(self) -> None:
            super().__init__(title=title, custom_id=modal_id)
            for f in fields:
                style = (
                    discord.TextStyle.paragraph
                    if (f.get('style') or '').lower() == 'paragraph'
                    else discord.TextStyle.short
                )
                self.add_item(discord.ui.TextInput(
                    custom_id=f.get('custom_id') or '',
                    label=(f.get('label') or '')[:45] or 'Field',
                    style=style,
                    required=bool(f.get('required', True)),
                    placeholder=(f.get('placeholder') or '')[:100] or None,
                ))

        async def on_submit(self, _interaction: Any) -> None:
            # Submission routes back through on_interaction_event via
            # the discord.py interaction system; this stub satisfies
            # the abstract method.
            await _interaction.response.defer(ephemeral=True)

    await interaction.response.send_modal(_DynModal())


async def _refresh_lobby_thread(bot: Any, thread_id: str,
                                 deps: Dict[str, Any],
                                 status_override: Optional[str] = None,
                                 ) -> None:
    """Re-render the Game Lobby embed + button row in `thread_id` to
    reflect the latest lobby state (after join / start)."""
    lobbies = deps.get('lobbies') or {}
    lobby = lobbies.get(str(thread_id))
    if lobby is None:
        return
    if status_override:
        lobby['status'] = status_override
    try:
        thread = bot.get_channel(int(thread_id))
        if thread is None:
            thread = await bot.fetch_channel(int(thread_id))
        # Find prior lobby embed message and edit it; if not found,
        # send a new one.
        latest_lobby_msg = None
        async for m in thread.history(limit=20, oldest_first=False):
            if (m.author.id == bot.user.id and m.embeds
                    and m.embeds[0].title == 'Game Lobby'):
                latest_lobby_msg = m
                break
        if latest_lobby_msg is None:
            await _send_lobby_embed(thread, lobby)
        else:
            await _edit_lobby_embed(latest_lobby_msg, thread, lobby)
        await _update_lobby_thread_name(thread, lobby)
    except Exception:
        _LOG.exception('lobby thread refresh failed for %s', thread_id)


async def _edit_lobby_embed(message: Any, thread: Any,
                             lobby: Dict[str, Any]) -> None:
    """Edit an existing lobby embed message to reflect updated lobby state."""
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
    await message.edit(embed=embed, view=view)


async def _maybe_handle_admin_text(message: Any,
                                    deps: Dict[str, Any]) -> None:
    """Dispatch admin text commands from #lfg / #bothelpers messages.

    Mirrors the JS messageCreate text-command handlers:
      - testready [@p2]   (#lfg only) — random test scenario.
      - killgamemcp       (#bothelpers only) — kill all test/AI games.
      - selfplaymcp ...   (#bothelpers only) — selfplay queue stub
        (no-op since Python has no Discord-side selfplay loop).
    """
    content = (getattr(message, 'content', '') or '').strip()
    if not content:
        return
    channel = getattr(message, 'channel', None)
    channel_name = (getattr(channel, 'name', '') or '').lower()

    lower = content.lower()

    # testready — works in any channel named lfg.
    if lower.startswith('testready') and channel_name == 'lfg':
        await _handle_text_testready(message, deps)
        return

    # killgamemcp / selfplaymcp — restricted to #bothelpers.
    if channel_name == 'bothelpers':
        if lower.startswith('killgamemcp'):
            await _handle_text_killgamemcp(message, deps)
            return
        if lower.startswith('selfplaymcp'):
            await _handle_text_selfplaymcp(message, deps)
            return


async def _handle_text_testready(message: Any,
                                   deps: Dict[str, Any]) -> None:
    """Spin up a quick test game with the message author as P1.
    Optional second player from a Discord mention.
    """
    try:
        from python.discord_bot.commands import cmd_testgame
    except Exception:
        return
    user_id = str(message.author.id)
    guild_id = str(getattr(message.guild, 'id', '') or '') or None
    result = cmd_testgame(user_id, deps, guild_id=guild_id)
    msg = (
        f'✅ Test game **{result.get("gameId")}** created. {result.get("message", "")}'
        if result.get('ok')
        else f'❌ testready failed: {result.get("reason")}'
    )
    try:
        await message.channel.send(msg)
    except Exception:
        pass


async def _handle_text_killgamemcp(message: Any,
                                     deps: Dict[str, Any]) -> None:
    """Delete all games marked testGame=True or selfPlay=True.
    Mirrors the JS killgamemcp admin command.
    """
    list_ids = deps.get('list_game_ids')
    get_game = deps.get('get_game')
    delete_game = deps.get('delete_game')
    if not (callable(list_ids) and callable(get_game) and callable(delete_game)):
        try:
            await message.channel.send('❌ killgamemcp: deps not wired.')
        except Exception:
            pass
        return
    killed = 0
    for game_id in list_ids() or []:
        try:
            g = get_game(game_id)
            if g is None:
                continue
            data = g.data if hasattr(g, 'data') else g
            if not (data.get('testGame') or data.get('selfPlay')):
                continue
            delete_game(game_id)
            killed += 1
        except Exception:
            continue
    try:
        await message.channel.send(f'🪦 Killed {killed} test/selfplay game(s).')
    except Exception:
        pass


async def _handle_text_selfplaymcp(message: Any,
                                     deps: Dict[str, Any]) -> None:
    """selfplaymcp text command. Python has no Discord-side selfplay
    queue (training-only), so most subcommands are stubs that report
    the gap honestly. status / coverage delegate to DB queries when
    available.
    """
    parts = (getattr(message, 'content', '') or '').split()
    sub = parts[1].lower() if len(parts) >= 2 else 'status'
    try:
        if sub == 'status':
            await message.channel.send(
                'ℹ️ selfplay status: Discord-side selfplay queue not '
                'ported to Python. Headless training runs in '
                '`python/mcts/`. No live queue to report.'
            )
        elif sub in ('start', 'stop', 'pause', 'resume', 'seed'):
            await message.channel.send(
                f'❌ selfplaymcp {sub}: Discord-side selfplay queue not '
                f'ported to Python. Run headless training scripts under '
                f'`python/mcts/` instead.'
            )
        elif sub == 'coverage':
            await message.channel.send(
                'ℹ️ Coverage: HTTP endpoints not ported to Python. '
                'Coverage data lives in the `exploration_episodes` / '
                '`exploration_transitions` Postgres tables; query '
                'directly for now.'
            )
        else:
            await message.channel.send(
                'Usage: selfplaymcp [status|start|stop|pause|resume|'
                'seed|coverage]'
            )
    except Exception:
        pass
