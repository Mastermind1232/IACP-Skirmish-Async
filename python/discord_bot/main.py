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


async def run_bot() -> None:
    """Boot the bot with discord.py and hand button events to the router.

    Requires the DISCORD_BOT_TOKEN env var. Imports discord lazily so
    import-time errors in the rest of the package surface before this.
    """
    import discord  # type: ignore[import]

    token = os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        raise RuntimeError('DISCORD_BOT_TOKEN env var required')

    intents = discord.Intents.default()
    intents.message_content = True
    bot = discord.Client(intents=intents)

    # Self-register all handler modules
    registered = register_all_handlers()
    _LOG.info('Registered %d handler modules', registered)

    # Game store placeholder — production wires SQLAlchemy
    game_store: Dict[str, Any] = {}
    deps = build_deps(game_store, bot)

    @bot.event
    async def on_interaction_event(interaction):  # noqa: D401
        result = await on_interaction(interaction, deps)
        if not result.get('ok'):
            _LOG.warning('Route failed: %s', result)

    @bot.event
    async def on_ready():  # noqa: D401
        _LOG.info('Bot ready: %s', bot.user)

    await bot.start(token)
