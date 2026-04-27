"""Central env-var configuration with boot-time validation.

Replaces scattered `os.environ.get(...)` calls. Catches missing
required vars at startup with a clear message naming the missing
field, rather than a confusing failure deeper in discord.py setup.

Usage:
    from python.discord_bot.config import BotConfig
    cfg = BotConfig.load_from_env()  # raises if invalid
    bot.run(cfg.discord_token)
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional


class ConfigError(RuntimeError):
    """Raised by BotConfig.load_from_env when required env vars are missing
    or invalid. Message lists every missing field so the operator fixes
    them all in one pass."""


@dataclass
class BotConfig:
    """Validated bot configuration. All required fields are non-Optional.
    All optional fields have explicit defaults.
    """

    # Required: at least one of DISCORD_TOKEN / DISCORD_BOT_TOKEN.
    discord_token: str

    # Optional: when set, enables PostgresStore.
    database_url: Optional[str] = None

    # Optional: when set, achievement notifications post to this channel.
    achievements_channel_id: Optional[str] = None

    # Optional: 'DEBUG' / 'INFO' / 'WARNING' / 'ERROR'. Default INFO.
    log_level: str = 'INFO'

    # Optional: cap on per-player concurrent active games. Default 5.
    max_active_games_per_player: int = 5

    @classmethod
    def load_from_env(cls) -> 'BotConfig':
        """Read + validate environment variables. Raises ConfigError
        listing every missing required field.
        """
        errors: List[str] = []

        token = (
            os.environ.get('DISCORD_TOKEN')
            or os.environ.get('DISCORD_BOT_TOKEN')
        )
        if not token:
            errors.append(
                'DISCORD_TOKEN (or DISCORD_BOT_TOKEN) — Discord bot token. '
                'Set this in Railway → Variables.'
            )

        log_level = (os.environ.get('LOG_LEVEL') or 'INFO').upper()
        if log_level not in ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'):
            errors.append(
                f'LOG_LEVEL={log_level!r} — must be one of DEBUG / INFO / '
                f'WARNING / ERROR / CRITICAL.'
            )

        max_games_raw = os.environ.get('MAX_ACTIVE_GAMES_PER_PLAYER', '5')
        try:
            max_games = int(max_games_raw)
            if max_games < 1:
                raise ValueError('must be >= 1')
        except (ValueError, TypeError):
            errors.append(
                f'MAX_ACTIVE_GAMES_PER_PLAYER={max_games_raw!r} — must be a '
                f'positive integer.'
            )
            max_games = 5  # placeholder; we will raise below

        if errors:
            raise ConfigError(
                'BotConfig validation failed:\n  - '
                + '\n  - '.join(errors)
            )

        return cls(
            discord_token=token,  # type: ignore[arg-type]
            database_url=os.environ.get('DATABASE_URL') or None,
            achievements_channel_id=(
                os.environ.get('ACHIEVEMENTS_CHANNEL_ID') or None
            ),
            log_level=log_level,
            max_active_games_per_player=max_games,
        )

    def has_db(self) -> bool:
        """True when DATABASE_URL is set; PostgresStore can be used."""
        return bool(self.database_url)
