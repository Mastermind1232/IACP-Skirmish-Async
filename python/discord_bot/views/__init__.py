"""discord.py-native View / DynamicItem button + modal classes.

This package replaces the custom-router-based handler system one
feature area at a time. Each module in this package owns:

  - DynamicItem subclasses (one per persistent button pattern), where
    custom_id is matched by regex template.
  - Modal subclasses (discord.ui.Modal).
  - View factory functions (build a View attached to a fresh embed).

Bot startup imports each module + calls bot.add_dynamic_items(...) so
DynamicItems persist across restarts.

Migration order (incremental — each chunk shippable):
  1. lobby     ← migrating now
  2. setup     (squad, map, deployment)
  3. combat    (declare → resolve)
  4. movement
  5. cc_hand
  6. dc_play_area
  7. round / phase_gate
  8. abilities (long tail)
"""

from python.discord_bot.views import lobby

__all__ = ['lobby']


def all_dynamic_item_classes():
    """Return every DynamicItem subclass to register with the bot.
    Bot startup iterates this and calls bot.add_dynamic_items(*classes).
    """
    return [
        lobby.LobbyJoinButton,
        lobby.LobbyStartButton,
    ]
