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


def _configure_logging() -> None:
    level = os.environ.get('LOG_LEVEL', 'INFO').upper()
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format='%(asctime)s [%(name)s] %(levelname)s %(message)s',
    )


def main() -> None:
    _configure_logging()
    log = logging.getLogger('skirbo.main')

    token = os.environ.get('DISCORD_TOKEN') or os.environ.get('DISCORD_BOT_TOKEN')
    if not token:
        log.error('DISCORD_TOKEN or DISCORD_BOT_TOKEN env var is required.')
        raise SystemExit(1)

    # Lazy import so --help and dry-run imports don't pull discord.py.
    from python.discord_bot.main import run_bot

    log.info('Booting Skirbo Discord bot…')
    asyncio.run(run_bot())


if __name__ == '__main__':
    main()
