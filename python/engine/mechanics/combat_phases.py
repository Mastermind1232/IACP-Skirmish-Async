"""Combat state machine: 16-phase port of JS multi-step combat.

Mirrors src/handlers/combat.js + src/engine/combat-bridge.js step-for-step.
Each phase is a discrete transition on game['pendingCombat']; the engine is
pure-sync (no async/await — see plan: async-correctness boundary).

The companion module python/engine/mechanics/attack_orchestrator.py implements
the *atomic* path used by AI/MCTS/self-play (everything resolved in one tick).
This module implements the *step-by-step* path used by Discord (each click
advances exactly one phase).

Design contract:
- Game state stays JSON-serializable (no callables, no coroutines).
- pendingCombat is the single state holder; each step reads and mutates it.
- Each step function returns the modified game; phase advances are explicit.
- Gates (where Discord pauses for user input) are stored on
  pendingCombat['combatGate'] = {phase, p1Ready, p2Ready}.

JS reference sites are documented per phase below.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional


class CombatPhase(str, Enum):
    """The 16 distinct phase transitions of a combat resolution.

    Stored as the value of game['pendingCombat']['phase']. String-valued so
    the enum round-trips through JSON without custom encoding.

    Order matches JS combat.js dispatch — see src/handlers/combat.js:266+
    (sendCombatGate) and 366-448 (dispatchCombatGateAdvance).
    """

    # 1. Declare: attack_target_ click. Validates LOS/adjacency, opens
    # pendingCombat with attacker/target/dice/bonuses. JS combat.js:1348-1388.
    DECLARE = 'declare'

    # 2. Pre-combat gate (post_declare): both players confirm before rolling.
    # Hosts the bonus-stamping window: form post-attack hooks, loadout
    # post-attack, fury bonus, autofire, barrage, fireproof, unhinged.
    # JS combat.js:1391-1857.
    PRE_COMBAT_GATE = 'pre_combat_gate'

    # 3. Roll: rolls attack + defense dice. Stores attackDiceResults,
    # attackRoll, defenseDiceResults, defenseRoll on pendingCombat.
    # JS combat.js:2730-2793.
    ROLL = 'roll'

    # 4. Post-roll gate: both players see dice before rerolls.
    # JS combat.js:366-448 (dispatchCombatGateAdvance: post_roll branch).
    POST_ROLL_GATE = 'post_roll_gate'

    # 5. Forced reroll: queue-driven rerolls (Raider, Twin Sabers force-reroll,
    # Versatile Weaponry, etc.). Drains pendingCombat.forcedRerollQueue.
    # JS combat.js:3169-3170, 3382-3481.
    FORCED_REROLL = 'forced_reroll'

    # 6. Post-forced gate: confirm before attacker reroll window.
    POST_FORCED_GATE = 'post_forced_gate'

    # 7. Attacker reroll: attacker spends innate + CC rerolls.
    # JS combat.js:3441 (combat.attackDiceResults mutated).
    ATTACKER_REROLL = 'attacker_reroll'

    # 8. Post-attacker-reroll gate: confirm before defender reroll window.
    POST_ATTACKER_GATE = 'post_attacker_gate'

    # 9. Defender reroll: Defensive Stance, Foresight, Overpower, etc.
    # JS combat.js:3495 (combat.defenseDiceResults mutated).
    DEFENDER_REROLL = 'defender_reroll'

    # 10. Post-defender-reroll gate: confirm before passive window.
    POST_DEFENDER_GATE = 'post_defender_gate'

    # 11. Passive ability window: interruptible passives (Defensible,
    # Get Down, Call the Shots, Survival, Negotiate). Each can pause
    # the resolution while the player decides.
    # JS combat.js:4133 (handleCombatPassive).
    PASSIVE_WINDOW = 'passive_window'

    # 12. Token phase (attacker): attacker spends hit/block/power tokens.
    # JS combat.js:5216-5269. Sets attackerSpentPowerToken.
    TOKEN_ATTACKER = 'token_attacker'

    # 13. Token phase (defender): defender spends evade/block tokens.
    # JS combat.js:5216-5269. Sets defenderSpentBlock.
    TOKEN_DEFENDER = 'token_defender'

    # 14. Surge selection: attacker picks which surge abilities to spend.
    # Multi-step (each surge spend is one transition; loops until done).
    # JS combat.js:4869-5085.
    SURGE = 'surge'

    # 15. Pre-resolve gate: confirm before damage applies.
    POST_SURGE_GATE = 'pre_resolve_gate'

    # 16. Resolve: applies damage, fires post-attack triggers (defeat
    # pipeline, Pattern D after-attack hooks), clears pendingCombat.
    # JS combat-bridge.js:122-500.
    RESOLVE = 'resolve'


# Order is canonical — used by step_dispatch to find next phase.
PHASE_ORDER = (
    CombatPhase.DECLARE,
    CombatPhase.PRE_COMBAT_GATE,
    CombatPhase.ROLL,
    CombatPhase.POST_ROLL_GATE,
    CombatPhase.FORCED_REROLL,
    CombatPhase.POST_FORCED_GATE,
    CombatPhase.ATTACKER_REROLL,
    CombatPhase.POST_ATTACKER_GATE,
    CombatPhase.DEFENDER_REROLL,
    CombatPhase.POST_DEFENDER_GATE,
    CombatPhase.PASSIVE_WINDOW,
    CombatPhase.TOKEN_ATTACKER,
    CombatPhase.TOKEN_DEFENDER,
    CombatPhase.SURGE,
    CombatPhase.POST_SURGE_GATE,
    CombatPhase.RESOLVE,
)


# Which phases are gates (block on both-players-ready).
GATE_PHASES = frozenset({
    CombatPhase.PRE_COMBAT_GATE,
    CombatPhase.POST_ROLL_GATE,
    CombatPhase.POST_FORCED_GATE,
    CombatPhase.POST_ATTACKER_GATE,
    CombatPhase.POST_DEFENDER_GATE,
    CombatPhase.POST_SURGE_GATE,
})


@dataclass
class CombatGateState:
    """The shape of pendingCombat['combatGate'] when a gate is open.

    JS reference: src/handlers/combat.js:266 — `combat.combatGate =
    { phase: subPhase, p1Ready: false, p2Ready: false }`. Both players
    must click Ready (set their flag true) before the gate advances.

    In headless / self-play mode, gates auto-advance — see
    advance_combat_gate's `auto` shortcut.
    """

    phase: str  # CombatPhase value of the *next* phase the gate guards
    p1Ready: bool = False
    p2Ready: bool = False

    def both_ready(self) -> bool:
        return self.p1Ready and self.p2Ready

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable representation matching JS shape."""
        return {
            'phase': self.phase,
            'p1Ready': self.p1Ready,
            'p2Ready': self.p2Ready,
        }

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> Optional['CombatGateState']:
        """Hydrate from a stored game-state dict. Returns None if no gate."""
        if not isinstance(d, dict):
            return None
        return cls(
            phase=str(d.get('phase') or ''),
            p1Ready=bool(d.get('p1Ready')),
            p2Ready=bool(d.get('p2Ready')),
        )


def get_phase(game: Any) -> Optional[CombatPhase]:
    """Read the current combat phase from game['pendingCombat']. Returns
    None when no combat is open. Tolerant of string values (round-tripped
    through JSON) by coercing to the enum."""
    data = game.data if hasattr(game, 'data') else game
    pc = (data.get('pendingCombat') if isinstance(data, dict) else None) or {}
    raw = pc.get('phase')
    if raw is None:
        return None
    if isinstance(raw, CombatPhase):
        return raw
    try:
        return CombatPhase(raw)
    except ValueError:
        # Legacy / unknown phase string (e.g. atomic-resolved combat).
        return None


def set_phase(game: Any, phase: CombatPhase) -> None:
    """Set game['pendingCombat']['phase'] to the given enum value. Stored
    as a string for JSON serializability."""
    data = game.data if hasattr(game, 'data') else game
    pc = data.get('pendingCombat') or {}
    pc['phase'] = phase.value
    data['pendingCombat'] = pc


def open_gate(game: Any, next_phase: CombatPhase) -> None:
    """Open a both-players-ready gate that guards `next_phase`.

    Mirrors JS sendCombatGate (combat.js:266) — sets
    pendingCombat.combatGate to a fresh {phase, p1Ready=False,
    p2Ready=False} object.
    """
    data = game.data if hasattr(game, 'data') else game
    pc = data.get('pendingCombat') or {}
    pc['combatGate'] = CombatGateState(phase=next_phase.value).to_dict()
    data['pendingCombat'] = pc


def get_gate(game: Any) -> Optional[CombatGateState]:
    """Read the current combat gate, if any. Returns None when no gate
    is open."""
    data = game.data if hasattr(game, 'data') else game
    pc = (data.get('pendingCombat') if isinstance(data, dict) else None) or {}
    return CombatGateState.from_dict(pc.get('combatGate'))


def clear_gate(game: Any) -> None:
    """Remove the combat gate. Called after both players ready and the
    next phase begins. Mirrors JS combat.js:354 (`delete combat.combatGate`)."""
    data = game.data if hasattr(game, 'data') else game
    pc = data.get('pendingCombat') or {}
    if 'combatGate' in pc:
        del pc['combatGate']
    data['pendingCombat'] = pc


def is_self_play(game: Any) -> bool:
    """Return True when the current game is in headless / self-play mode.

    JS uses `if (game.selfPlay)` to auto-advance gates without waiting for
    button clicks (combat.js:260). Python checks the same flag plus a
    `headless` synonym used by AI training fixtures.
    """
    data = game.data if hasattr(game, 'data') else game
    if not isinstance(data, dict):
        return False
    return bool(data.get('selfPlay') or data.get('headless'))
