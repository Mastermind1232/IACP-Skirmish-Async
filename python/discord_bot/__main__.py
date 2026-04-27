"""Python entrypoint: `python -m python.discord_bot`.

Reads config from env vars and boots the bot via main.run_bot.

Required env:
  DISCORD_TOKEN (or DISCORD_BOT_TOKEN) — Discord bot token.

Optional env:
  DATABASE_URL         — Postgres DSN (enables PostgresStore).
  SKIRBO_GAMES_PATH    — path to games.json for JsonFileStore fallback.
  LOG_LEVEL            — python logging level (default INFO).

With neither DATABASE_URL nor SKIRBO_GAMES_PATH, games are stored
in-memory (lost on restart).
"""
from __future__ import annotations

import asyncio
import logging
import os


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format='%(asctime)s [%(name)s] %(levelname)s %(message)s',
    )


def main() -> None:
    # Load + validate config FIRST so a missing DISCORD_TOKEN dies with
    # a clear field-named message rather than a cryptic discord.py
    # failure deeper in setup.
    from python.discord_bot.config import BotConfig, ConfigError
    try:
        cfg = BotConfig.load_from_env()
    except ConfigError as e:
        # Log at ERROR even before logging is fully configured.
        logging.basicConfig(level=logging.ERROR)
        logging.getLogger('skirbo.main').error('%s', e)
        raise SystemExit(1)

    _configure_logging(cfg.log_level)
    log = logging.getLogger('skirbo.main')

    # Lazy import so --help and dry-run imports don't pull discord.py.
    from python.discord_bot.main import run_bot

    log.info('Booting Skirbo Discord bot…')
    asyncio.run(run_bot(cfg))


if __name__ == '__main__':
    main()
