"""Embed + message builders — mirror of src/engine/message-updaters.js.

Pure functions that turn game-state snapshots into Discord-ready
payloads. The bot layer converts these dicts to discord.py Embed /
Message objects. Keeping them dict-based means the tests don't need
discord.py installed.

Embed dict shape (matches discord.py's Embed):
    {
      'title': str,
      'description': str,
      'color': int,  # 0xRRGGBB
      'fields': [{'name': str, 'value': str, 'inline': bool}, ...],
      'footer': {'text': str},
      'thumbnail': {'url': str},
    }

Message payload shape:
    {
      'content': str,
      'embeds': [Embed, ...],
      'components': [ActionRow, ...],  # from components.action_buttons
    }
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


# ── Color palette (consistent with JS embed styling) ───────────────────────

COLOR_REBEL = 0xE74C3C      # red
COLOR_IMPERIAL = 0x95A5A6    # grey
COLOR_SCUM = 0xF39C12        # orange
COLOR_MERCENARY = 0x1ABC9C   # teal
COLOR_NEUTRAL = 0x3498DB     # blue
COLOR_DEFEAT = 0x7F0000      # dark red
COLOR_VICTORY = 0x00A65A     # green

AFFILIATION_COLORS = {
    'rebel': COLOR_REBEL,
    'imperial': COLOR_IMPERIAL,
    'scum': COLOR_SCUM,
    'mercenary': COLOR_MERCENARY,
}


def _unwrap(game: Any) -> Dict[str, Any]:
    data = getattr(game, 'data', None)
    if isinstance(data, dict):
        return data
    if isinstance(game, dict):
        return game
    return {}


# ── VP + round banner ──────────────────────────────────────────────────────

def build_vp_banner(game: Any) -> Dict[str, Any]:
    """Top-of-thread VP + round summary embed.

    Renders:
        Round {n} • P1 {p1name}: {p1vp} VP • P2 {p2name}: {p2vp} VP
    """
    data = _unwrap(game)
    round_num = data.get('round') or data.get('currentRound') or 1
    p1_vp = (data.get('player1VP') or {}).get('total', 0)
    p2_vp = (data.get('player2VP') or {}).get('total', 0)
    p1_name = data.get('player1Name') or 'Player 1'
    p2_name = data.get('player2Name') or 'Player 2'
    active = data.get('activePlayer')
    active_marker = '→' if active in (1, 2) else ''
    p1_marker = '→ ' if active == 1 else ''
    p2_marker = '→ ' if active == 2 else ''
    return {
        'title': f'Round {round_num}',
        'description': (
            f'{p1_marker}**{p1_name}**: {p1_vp} VP    '
            f'{p2_marker}**{p2_name}**: {p2_vp} VP'
        ),
        'color': COLOR_NEUTRAL,
    }


# ── DC card embed ──────────────────────────────────────────────────────────

def build_dc_embed(game: Any, msg_id: str,
                   *, exhausted: bool = False) -> Dict[str, Any]:
    """Render a DC card as an embed.

    Pulls from game.p{n}DcList[i].dcName / .healthState and
    dc-effects.json for stats. The actual figure image attachment is
    built by a separate helper (get_dc_card_image_path) in the bot
    layer.

    Returns a minimal embed dict; the bot layer enriches with image.
    """
    data = _unwrap(game)
    # Locate the DC entry
    for pn in (1, 2):
        ids = data.get(f'p{pn}DcMessageIds') or []
        dc_list = data.get(f'p{pn}DcList') or []
        if msg_id in ids:
            idx = ids.index(msg_id)
            if idx < len(dc_list):
                dc = dc_list[idx]
                return _render_dc(dc, pn, exhausted=exhausted)
    return {'title': 'Unknown DC', 'color': COLOR_NEUTRAL}


def _render_dc(dc: Dict[str, Any], player_num: int,
               *, exhausted: bool) -> Dict[str, Any]:
    from python.engine.data.dc_effects_loader import get_dc_effect
    dc_name = dc.get('dcName') or 'Unknown DC'
    display = dc.get('displayName') or dc_name
    effect = get_dc_effect(dc_name) or {}
    affiliation = (effect.get('affiliation') or 'neutral').lower()
    color = AFFILIATION_COLORS.get(affiliation, COLOR_NEUTRAL)
    if exhausted:
        color = COLOR_DEFEAT

    health_state = dc.get('healthState') or []
    hp_strs = []
    for cur, mx in health_state:
        hp_strs.append(f'{cur}/{mx}')
    hp_str = ' · '.join(hp_strs) if hp_strs else '—'

    stats_line = (
        f"Cost {effect.get('cost', '—')}   "
        f"Speed {effect.get('speed', '—')}   "
        f"Health {effect.get('health', '—')}"
    )

    fields = [
        {'name': 'HP', 'value': hp_str, 'inline': True},
        {'name': 'Stats', 'value': stats_line, 'inline': True},
    ]

    exhausted_note = ' — *exhausted*' if exhausted else ''
    return {
        'title': f'{display}{exhausted_note}',
        'description': effect.get('abilityText') or '',
        'color': color,
        'fields': fields,
        'footer': {'text': f'P{player_num} · {affiliation.title() or "Neutral"}'},
    }


# ── CC hand display ────────────────────────────────────────────────────────

def build_hand_display(game: Any, player_num: int) -> Dict[str, Any]:
    """Render a player's CC hand as a message payload."""
    data = _unwrap(game)
    hand_key = f'player{player_num}CcHand'
    hand = data.get(hand_key) or []
    if not hand:
        return {
            'content': f'_Your hand is empty (Round {data.get("round") or 1})._',
        }
    numbered = [f'{i + 1}. **{c}**' for i, c in enumerate(hand)]
    return {
        'content': f'**Your Hand ({len(hand)} card{"s" if len(hand) != 1 else ""}):**\n'
                   + '\n'.join(numbered),
    }


# ── Log message formatters ─────────────────────────────────────────────────

_PHASE_EMOJI = {
    'SETUP': '⚔️',
    'ROUND': '🔵',
    'ACTION': '▶️',
    'ACTIVATION': '🚩',
    'DEPLOYMENT': '📍',
    'ATTACK': '⚡',
}

_ICON_EMOJI = {
    'attack': '⚡',
    'move': '🏃',
    'deploy': '📍',
    'deployed': '✅',
    'activate': '🚩',
    'round': '🔵',
    'card': '🃏',
}


def format_log_line(message: str, *, phase: Optional[str] = None,
                    icon: Optional[str] = None) -> str:
    """Format a game-log line with phase/icon prefix."""
    emoji = ''
    if icon and icon in _ICON_EMOJI:
        emoji = _ICON_EMOJI[icon]
    elif phase and phase in _PHASE_EMOJI:
        emoji = _PHASE_EMOJI[phase]
    return f'{emoji} {message}'.strip()


# ── Mission card ───────────────────────────────────────────────────────────

def build_mission_card(game: Any) -> Dict[str, Any]:
    """Render the selected mission as an embed for the pinned mission card."""
    data = _unwrap(game)
    selected = data.get('selectedMission') or {}
    map_info = data.get('selectedMap') or {}
    name = selected.get('fullName') or selected.get('name') or map_info.get('name') or 'Mission'
    variant = (selected.get('variant') or '').upper()
    return {
        'title': f'{name}{" — " + variant if variant else ""}',
        'description': selected.get('tokenLabel') or '',
        'color': COLOR_NEUTRAL,
        'fields': [
            {
                'name': 'Interact',
                'value': selected.get('interactLabel') or '—',
                'inline': True,
            },
            {
                'name': 'Mechanics',
                'value': (selected.get('mechanics') or {}).get('type') or '—',
                'inline': True,
            },
        ],
    }


# ── Activation embed ───────────────────────────────────────────────────────

def build_activation_summary(game: Any) -> Dict[str, Any]:
    """Render which player's turn it is + remaining activations."""
    data = _unwrap(game)
    active = data.get('activePlayer')
    p1_rem = data.get('p1ActivationsRemaining')
    p2_rem = data.get('p2ActivationsRemaining')
    active_name = 'Player 1' if active == 1 else 'Player 2' if active == 2 else 'Neither'
    desc = (
        f"**{active_name}'s turn**\n"
        f'P1: {p1_rem if p1_rem is not None else "—"} activations remaining\n'
        f'P2: {p2_rem if p2_rem is not None else "—"} activations remaining'
    )
    return {
        'title': 'Activation Phase',
        'description': desc,
        'color': COLOR_REBEL if active == 1 else COLOR_IMPERIAL if active == 2 else COLOR_NEUTRAL,
    }


# ── Pending-window prompts ─────────────────────────────────────────────────

def build_pending_prompt(prompt_text: str,
                         *, color: int = COLOR_NEUTRAL) -> Dict[str, Any]:
    """Simple single-line prompt with action buttons.

    The buttons themselves come from components.action_buttons; this
    just builds the embed header.
    """
    return {
        'description': prompt_text,
        'color': color,
    }
