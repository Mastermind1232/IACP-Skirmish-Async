"""D2.27 — Power token application with stack + overflow.

Byte-identical port of the power-token helpers from
`src/game/game-helpers.js` (`grantPowerTokens`, `resolveOverflowDiscard`).
No Discord dependency — the overflow queue only sets pending state; the
Discord layer reads `game.pendingPowerTokenOverflow` to prompt a discard.

State shape (mirrors JS):
    game['figurePowerTokens']           dict[str, list[str]]
        # figureKey → ordered list of token type strings (e.g. 'Block', 'Evade',
        # 'Damage', 'Surge'). Oldest tokens sit at index 0.
    game['pendingPowerTokenOverflow']   list[dict] | None
        # queue of `{figureKey, discardCount}` entries awaiting a Discord
        # discard choice. Set to None (not []) when empty to match JS.
    game['selfPlay']                    bool   # true inside headless training
    game['testPvpOverflowPath']         bool   # forces PvP branch in headless tests

Overflow policy mirrors JS exactly:
  - selfPlay AND NOT testPvpOverflowPath → auto-discard the oldest `overflow`
    tokens (AI keeps the newly-granted ones). No pending state is queued.
  - Otherwise (PvP, or test-flag forcing the PvP branch) → update or append an
    entry in `pendingPowerTokenOverflow`. If an entry already exists for the
    figureKey, its `discardCount` is overwritten with the fresh overflow
    (NOT additive — JS sets `existing.discardCount = overflow` outright).

`resolveOverflowDiscard` splices out a token at the given index, decrements
the matching overflow entry, and clears `pendingPowerTokenOverflow` to None
when the array empties.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from python.engine.mechanics.dc_helpers import get_max_power_tokens


def grant_power_tokens(game: Dict[str, Any],
                       figure_key: Optional[str],
                       token_type: str,
                       count: int,
                       max_tokens: Optional[int] = None) -> int:
    """Grant `count` power tokens of `token_type` to a figure.

    Always adds the tokens, then checks overflow against the per-figure cap
    (`max_tokens` overrides the default from `get_max_power_tokens`). Returns
    the number of tokens actually added — always equals `count` when positive.

    No-ops (return 0) when `figure_key` is falsy or `count <= 0`.
    """
    if not figure_key or count <= 0:
        return 0
    game.setdefault('figurePowerTokens', {})
    game['figurePowerTokens'].setdefault(figure_key, [])
    cap = max_tokens if max_tokens is not None else get_max_power_tokens(figure_key)

    tokens = game['figurePowerTokens'][figure_key]
    for _ in range(count):
        tokens.append(token_type)

    total_tokens = len(tokens)
    overflow = total_tokens - cap
    if overflow > 0:
        if game.get('selfPlay') and not game.get('testPvpOverflowPath'):
            # Auto-discard oldest — AI keeps the newly granted ones.
            del tokens[:overflow]
        else:
            queue = game.get('pendingPowerTokenOverflow') or []
            existing = next((e for e in queue if e.get('figureKey') == figure_key), None)
            if existing is not None:
                # JS sets outright (not additive).
                existing['discardCount'] = overflow
            else:
                queue.append({'figureKey': figure_key, 'discardCount': overflow})
            game['pendingPowerTokenOverflow'] = queue
    return count


def resolve_overflow_discard(game: Dict[str, Any],
                             figure_key: str,
                             token_index: int) -> Dict[str, Any]:
    """Discard a specific token at `token_index` to resolve overflow.

    Mirrors `game-helpers.js:resolveOverflowDiscard`. Returns
    `{discarded: str|None, remaining: int}` — `discarded` is the popped token
    type (None on out-of-range), `remaining` is the total overflow left for
    this figureKey across the queue.

    Side effects: pops `figurePowerTokens[figureKey][token_index]`; decrements
    the first matching entry in `pendingPowerTokenOverflow`; removes the entry
    if its count drops to 0; clears `pendingPowerTokenOverflow` to None when
    the array empties.
    """
    tokens = (game.get('figurePowerTokens') or {}).get(figure_key)
    if not tokens or token_index < 0 or token_index >= len(tokens):
        return {'discarded': None, 'remaining': 0}

    discarded = tokens.pop(token_index)

    overflow_arr = game.get('pendingPowerTokenOverflow') or []
    entry = next((e for e in overflow_arr
                  if e.get('figureKey') == figure_key and e.get('discardCount', 0) > 0),
                 None)
    if entry is not None:
        entry['discardCount'] -= 1
        if entry['discardCount'] <= 0:
            overflow_arr.remove(entry)

    if not overflow_arr:
        game['pendingPowerTokenOverflow'] = None

    remaining = sum(e.get('discardCount', 0)
                    for e in overflow_arr
                    if e.get('figureKey') == figure_key)
    return {'discarded': discarded, 'remaining': remaining}
