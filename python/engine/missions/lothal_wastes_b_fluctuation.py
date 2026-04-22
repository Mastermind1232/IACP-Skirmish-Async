"""D3.10 — Pattern E.2 Fluctuation (Lothal Wastes B) mission-rule port.

Plan-label note: the execution plan tagged D3.10 as "Pattern E.2 Fluctuation
(Force Storm displacement) with multi-figure queue". That framing is a
drafting error — there is no "Fluctuation" or "Force Storm" ability in
`data/ability-library.json`, and the Pattern E chain registry does not cover
this behavior. Fluctuation is the Lothal Wastes B **mission rule**, a
2-player swap queue (not a multi-figure displacement chain).

The pending-state identity is preserved: `python/engine/pending_state_inventory.md`
classifies `pendingFluctuationSwap{Queue,First}` as "resolved in E.2". That
claim is honored here — this module lands end-to-end behavior for those
pending-state fields — but the code lives in `python/engine/missions/` (D5
structural home), NOT `python/engine/abilities/`. The Pattern E chain
registry stays discipline-pure: `get_chain_handler('Fluctuation')` returns
None, and all 354 non-Force-Push Pattern E ability IDs still raise
`ChainNotImplemented` on dispatch.

JS ground truth (sites ported verbatim):
  - `src/game/mission-rules.js:23-33`   — getCurrentFluctuationPositions
  - `src/game/mission-rules.js:236-287` — vpPerControlledFluctuation EOR rule
  - `src/handlers/round.js:817-831`     — swap queue init on EOR gate
  - `src/handlers/map-events.js:134-216` — handleFluctuationSwap (two-click)
  - `src/handlers/map-events.js:223-263` — handleFluctuationSkip
  - `src/handlers/round.js:1022-1029`    — continueAfterFluctuationSwap cleanup
  - `src/game/activation-state.js:383`   — fluctuationSwappedThisRound in
                                             ROUND_ARRAY_FLAGS (reset to [])
  - `src/game/activation-state.js:412-413` — pendingFluctuationSwap* in
                                               ROUND_DELETE_FLAGS (delete)

Color → power-token mapping (mirror of mission-rules.js:244):
  yellow → Surge, blue → Evade, green → Block, red → Damage

Reuse primitives (no new mechanics introduced by this slice):
  - `normalize_coord`    (python.engine.mechanics.coords)
  - `award_objective_vp` (python.engine.mechanics.defeat)
  - `grant_power_tokens` (python.engine.mechanics.tokens)

This module is pure engine: no Discord plumbing (button-repost, deferUpdate,
logGameAction), no async. The Discord handler layer (D4) will wrap
`apply_fluctuation_swap` / `skip_fluctuation_swap` with UI surfacing once the
bridge port lands.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from python.engine.mechanics.coords import normalize_coord
from python.engine.mechanics.defeat import award_objective_vp
from python.engine.mechanics.tokens import grant_power_tokens


MAP_ID = 'lothal-wastes'
VARIANT = 'b'

_COLOR_TO_POWER_TOKEN = {
    'yellow': 'Surge',
    'blue': 'Evade',
    'green': 'Block',
    'red': 'Damage',
}

_NEUTRAL_COLOR_RE = re.compile(r'Neutral (\w+)\.', re.IGNORECASE)


def _extract_color_from_image(image: Optional[str]) -> Optional[str]:
    """Parse 'Mission Token--Neutral Yellow.gif' → 'yellow'. None if no match.

    Mirrors mission-rules.js:250: `(typeInfo?.image || '').match(/Neutral (\\w+)\\./i)`.
    """
    if not image:
        return None
    m = _NEUTRAL_COLOR_RE.search(str(image))
    if not m:
        return None
    return m.group(1).lower()


def _get_initiative_player_num(game: Dict[str, Any]) -> int:
    """Port of `src/game/player-helpers.js:getInitiativePlayerNum`.

    1 if `initiativePlayerId == player1Id`, else 2.
    """
    return 1 if game.get('initiativePlayerId') == game.get('player1Id') else 2


def get_current_fluctuation_positions(game: Dict[str, Any],
                                      map_id: str,
                                      map_tokens_data: Dict[str, Any]
                                      ) -> Dict[str, List[str]]:
    """Canonical accessor for current fluctuation positions.

    Port of `src/game/mission-rules.js:23-33`. Lazy-initializes
    `game['fluctuationPositions']` from static JSON on first call and returns
    the stored dict on subsequent calls so mid-round swaps persist.

    Returns shape: `{"0": ["j10", "p10"], "2": ["h21", "t21"], ...}` — string
    keys (token type id), string arrays of coords (normalized).

    `map_tokens_data` may be either the top-level `{source, maps}` dict (with
    the port of `data/map-tokens.json`) or the nested `maps` dict itself. The
    JS side receives `getMapTokensData()` output which is the `maps` shape, so
    the Python caller should pass `map_tokens_data['maps']` when loading the
    raw JSON, or pass the pre-extracted maps dict.
    """
    if game.get('fluctuationPositions'):
        return game['fluctuationPositions']
    mission_b = (map_tokens_data.get(map_id) or {}).get('missionB') or {}
    positions = mission_b.get('positions') or {}
    out: Dict[str, List[str]] = {}
    for id_key, coords in positions.items():
        out[id_key] = [normalize_coord(c) for c in (coords or [])]
    game['fluctuationPositions'] = out
    return out


def init_fluctuation_swap_queue(game: Dict[str, Any],
                                map_id: str,
                                variant: str) -> bool:
    """Initialize the per-EOR swap queue.

    Port of `src/handlers/round.js:817-831`. No-op on any other map/variant
    combination — returns False. On match (Lothal Wastes B):
      - `pendingFluctuationSwapQueue = [initPn, otherPn]`  (initiative order)
      - `fluctuationSwappedThisRound = []`
      - `pendingFluctuationSwapFirst = None`

    Returns True when the queue was seeded, False otherwise.

    `game` must have `initiativePlayerId` + `player1Id` + `player2Id`
    populated.
    """
    if map_id != MAP_ID or variant != VARIANT:
        return False
    init_pn = _get_initiative_player_num(game)
    other_pn = 2 if init_pn == 1 else 1
    game['pendingFluctuationSwapQueue'] = [init_pn, other_pn]
    game['fluctuationSwappedThisRound'] = []
    game['pendingFluctuationSwapFirst'] = None
    return True


def apply_fluctuation_swap(game: Dict[str, Any],
                           player_num: int,
                           coord: str) -> Dict[str, Any]:
    """Handle one swap click — first saves source, second executes the exchange.

    Port of `src/handlers/map-events.js:134-216` (handleFluctuationSwap), minus
    the Discord interaction + button-repost plumbing.

    Return-dict shapes (mutually exclusive):
      - `{applied: False, reason: 'no-queue'}`          — queue empty/missing
      - `{applied: False, reason: 'wrong-player',
                           expected: int}`              — not this player's turn
      - `{applied: False, phase: 'first', source: str}` — first click saved
      - `{applied: False, reason: 'coord-not-found',
                           source: str, target: str}`   — lookup miss (both
                                                          coords must land in
                                                          `fluctuationPositions`)
      - `{applied: True, source: str, target: str,
                         queue_advanced: True,
                         next_player: int | None}`      — swap executed

    Side effects on a successful swap (second click):
      - `fluctuationPositions[sourceTypeId][sourceIdx] = target`
      - `fluctuationPositions[targetTypeId][targetIdx] = source`
      - both coords appended to `fluctuationSwappedThisRound`
      - `pendingFluctuationSwapFirst` cleared to None
      - `pendingFluctuationSwapQueue.pop(0)`
    """
    queue = game.get('pendingFluctuationSwapQueue')
    if not queue:
        return {'applied': False, 'reason': 'no-queue'}
    expected_pn = queue[0]
    if player_num != expected_pn:
        return {'applied': False, 'reason': 'wrong-player',
                'expected': expected_pn}
    norm = normalize_coord(coord)

    first = game.get('pendingFluctuationSwapFirst')
    if not first:
        game['pendingFluctuationSwapFirst'] = norm
        return {'applied': False, 'phase': 'first', 'source': norm}

    source = first
    target = norm
    game['pendingFluctuationSwapFirst'] = None

    positions = game.get('fluctuationPositions') or {}
    source_type_id: Optional[str] = None
    source_idx = -1
    target_type_id: Optional[str] = None
    target_idx = -1
    for type_id, coords in positions.items():
        if not isinstance(coords, list):
            continue
        for i, c in enumerate(coords):
            if normalize_coord(c) == source:
                source_type_id = type_id
                source_idx = i
                break
        for i, c in enumerate(coords):
            if normalize_coord(c) == target:
                target_type_id = type_id
                target_idx = i
                break

    if source_type_id is None or target_type_id is None:
        return {'applied': False, 'reason': 'coord-not-found',
                'source': source, 'target': target}

    positions[source_type_id][source_idx] = target
    positions[target_type_id][target_idx] = source

    swapped = game.setdefault('fluctuationSwappedThisRound', [])
    swapped.append(source)
    swapped.append(target)

    queue.pop(0)
    next_player = queue[0] if queue else None
    return {'applied': True, 'source': source, 'target': target,
            'queue_advanced': True, 'next_player': next_player}


def skip_fluctuation_swap(game: Dict[str, Any],
                          player_num: int) -> Dict[str, Any]:
    """Handle a swap-skip (player declines to swap).

    Port of `src/handlers/map-events.js:223-263` (handleFluctuationSkip).

    Returns:
      - `{applied: False, reason: 'no-queue'}`          — queue empty/missing
      - `{applied: False, reason: 'wrong-player',
                           expected: int}`              — not this player's turn
      - `{skipped: True, next_player: int | None}`      — queue advanced

    Side effects on skip:
      - `pendingFluctuationSwapFirst = None` (clears any pending first-click)
      - `pendingFluctuationSwapQueue.pop(0)`
    """
    queue = game.get('pendingFluctuationSwapQueue')
    if not queue:
        return {'applied': False, 'reason': 'no-queue'}
    expected_pn = queue[0]
    if player_num != expected_pn:
        return {'applied': False, 'reason': 'wrong-player',
                'expected': expected_pn}
    game['pendingFluctuationSwapFirst'] = None
    queue.pop(0)
    next_player = queue[0] if queue else None
    return {'skipped': True, 'next_player': next_player}


def score_controlled_fluctuations(game: Dict[str, Any],
                                  map_id: str,
                                  map_tokens_data: Dict[str, Any],
                                  get_space_controller: Callable[[Dict[str, Any], str, str], Optional[int]],
                                  vp_per_fluctuation: int = 1,
                                  grant_power_token: bool = True
                                  ) -> Dict[str, Any]:
    """Apply the `vpPerControlledFluctuation` EOR rule.

    Port of `src/game/mission-rules.js:236-287`. Iterates canonical
    fluctuation positions (via `get_current_fluctuation_positions`), extracts
    the color of each token type from its image string, and for every
    position:
      - awards `vp_per_fluctuation` objective VP to the space controller
        (via `award_objective_vp`) — skipped when no controller
      - grants the color-matched power token to every figure on that coord
        (unioned across both players) when `grant_power_token` is True

    Returns `{vp_awarded: {1: int, 2: int}, tokens_granted: List[(fig_key, token)]}`.

    Per-fluctuation awards are accumulated into a per-player sum and awarded
    once at the end (mirrors JS: `vpByPlayer[controller] += vp; ...
    awardObjectiveVp(game, pn, vpVal)`).
    """
    mission_b = (map_tokens_data.get(map_id) or {}).get('missionB') or {}
    token_types = mission_b.get('tokenTypes') or []
    positions = get_current_fluctuation_positions(game, map_id, map_tokens_data)

    vp_by_player = {1: 0, 2: 0}
    tokens_granted: List[Tuple[str, str]] = []

    for id_key, coords in positions.items():
        if not isinstance(coords, list) or len(coords) == 0:
            continue
        try:
            type_info = token_types[int(id_key)]
        except (ValueError, IndexError, TypeError):
            type_info = None
        color = _extract_color_from_image((type_info or {}).get('image') if type_info else None)
        power_token = _COLOR_TO_POWER_TOKEN.get(color) if color else None
        for coord in coords:
            controller = get_space_controller(game, map_id, coord)
            if controller in (1, 2):
                vp_by_player[controller] += vp_per_fluctuation
            if grant_power_token and power_token:
                for pn in (1, 2):
                    poses = (game.get('figurePositions') or {}).get(pn) or {}
                    for fig_key, fig_coord in poses.items():
                        if normalize_coord(fig_coord) == normalize_coord(coord):
                            grant_power_tokens(game, fig_key, power_token, 1)
                            tokens_granted.append((fig_key, power_token))

    for pn in (1, 2):
        if vp_by_player[pn] > 0:
            award_objective_vp(game, pn, vp_by_player[pn])

    return {'vp_awarded': dict(vp_by_player), 'tokens_granted': tokens_granted}


def cleanup_fluctuation_round_start(game: Dict[str, Any]) -> None:
    """Round-start cleanup — reset `fluctuationSwappedThisRound` to `[]`.

    Mirrors `activation-state.js:383` (ROUND_ARRAY_FLAGS), which the JS
    cleanup function resets at round-start.
    """
    game['fluctuationSwappedThisRound'] = []


def cleanup_fluctuation_round_end(game: Dict[str, Any]) -> None:
    """End-of-round cleanup — delete `pendingFluctuationSwap*` fields.

    Mirrors `activation-state.js:412-413` (ROUND_DELETE_FLAGS) + the explicit
    deletes at `round.js:1022-1029` in `continueAfterFluctuationSwap`. Uses
    `pop(..., None)` so a missing key is a no-op (mirrors JS `delete`).
    """
    game.pop('pendingFluctuationSwapQueue', None)
    game.pop('pendingFluctuationSwapFirst', None)
