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


# ── Phase steps ─────────────────────────────────────────────────────────


class CombatStateError(ValueError):
    """Raised when a phase step is called on a game whose pendingCombat
    is missing or in the wrong phase. Replay paths catch this and skip."""


def _require_pending_combat(game: Any, label: str) -> Dict[str, Any]:
    """Return game['pendingCombat'] or raise CombatStateError."""
    data = game.data if hasattr(game, 'data') else game
    pc = (data.get('pendingCombat') if isinstance(data, dict) else None)
    if not isinstance(pc, dict) or not pc:
        raise CombatStateError(
            f'{label}: no pendingCombat open (phase={get_phase(game)})'
        )
    return pc


def step_roll(game: Any, *, dice_stream=None, recorder=None, rng=None) -> Any:
    """Roll attack + defense dice. Mirrors JS combat.js:2730-2793.

    Reads attack dice colors from pendingCombat['attackInfo']['dice']
    and defense color from pendingCombat['defense'] (or 'white' default).
    Stores results in pendingCombat:
      - attackDiceResults: List[{color, acc, dmg, surge}]
      - attackRoll: {acc, dmg, surge}
      - defenseDiceResults: [{color, block, evade, dodge}]
      - defenseRoll: {block, evade, dodge}

    Advances phase to POST_ROLL_GATE (and opens that gate).

    Optional kwargs:
      dice_stream: pre-recorded DiceStream (for replay parity).
      recorder: DiceRecorder to capture rolls.
      rng: random.Random instance (for deterministic AI training).

    JS calls rollAttackDice / rollDefenseDice directly. Python wires
    to the byte-identical equivalents in mechanics.dice.
    """
    from python.engine.mechanics.dice import (
        roll_attack_dice as _roll_attack,
        roll_defense_dice as _roll_defense,
    )

    pc = _require_pending_combat(game, 'step_roll')
    cur_phase = get_phase(game)
    if cur_phase not in (None, CombatPhase.DECLARE,
                          CombatPhase.PRE_COMBAT_GATE, CombatPhase.ROLL):
        raise CombatStateError(
            f'step_roll: cannot roll from phase {cur_phase}'
        )

    # Attack dice colors from attackInfo or fallback to top-level 'dice'.
    attack_info = pc.get('attackInfo') or {}
    dice_colors = (
        attack_info.get('dice')
        if isinstance(attack_info, dict) else None
    )
    if not dice_colors:
        dice_colors = pc.get('dice') or []
    if not dice_colors:
        raise CombatStateError('step_roll: pendingCombat has no attack dice')

    atk_result = _roll_attack(
        list(dice_colors),
        stream=dice_stream, recorder=recorder, rng=rng,
    )

    # Defense dice — JS rolls one die per defense color (Imperial Officer
    # has white+black; most figures have one). target.defense is a list.
    target = pc.get('target') or {}
    defense_colors = target.get('defense') if isinstance(target, dict) else None
    if not isinstance(defense_colors, list) or not defense_colors:
        # Singular default — JS's rollDefenseDice takes one type.
        defense_colors = [pc.get('defenseType') or 'white']

    def_results = []
    block_total = 0
    evade_total = 0
    dodge_any = False
    for color in defense_colors:
        d = _roll_defense(color, stream=dice_stream, recorder=recorder, rng=rng)
        def_results.append(d)
        block_total += int(d.get('block', 0) or 0)
        evade_total += int(d.get('evade', 0) or 0)
        if d.get('dodge'):
            dodge_any = True

    pc['attackDiceResults'] = atk_result['dice']
    pc['attackRoll'] = {
        'acc': atk_result['acc'],
        'dmg': atk_result['dmg'],
        'surge': atk_result['surge'],
    }
    pc['defenseDiceResults'] = def_results
    pc['defenseRoll'] = {
        'block': block_total,
        'evade': evade_total,
        'dodge': dodge_any,
    }
    pc['defenseDiceCount'] = len(def_results)

    # Advance to post-roll gate.
    set_phase(game, CombatPhase.POST_ROLL_GATE)
    open_gate(game, CombatPhase.POST_ROLL_GATE)

    data = game.data if hasattr(game, 'data') else game
    data['pendingCombat'] = pc
    return game


# ── Gate advance ────────────────────────────────────────────────────────


def send_combat_gate(game: Any, sub_phase: CombatPhase) -> Any:
    """Open a combat gate that guards `sub_phase`.

    Mirrors JS sendCombatGate (combat.js:266). Sets pendingCombat.phase
    to the sub_phase and opens the combat gate. In self-play mode, the
    caller will immediately advance through the gate via dispatch_combat
    _gate_advance — JS calls this branch synchronously
    (`if (game.selfPlay) await dispatchCombatGateAdvance(...)`).
    """
    set_phase(game, sub_phase)
    open_gate(game, sub_phase)
    return game


def advance_combat_gate(game: Any, player_num: int = 0) -> Any:
    """Process a player's "Ready" click on the open combat gate.

    Mirrors JS handleCombatGateReady (combat.js:294-359). Sets the
    appropriate p{N}Ready flag; when both flags are true, clears the
    gate and returns control to the caller (which then runs the next
    phase step).

    `player_num` 0 (default) is auto-mode: in self-play, both flags are
    set to True at once (mirrors `if (game.isTestGame && isP1)` shortcut
    + the selfPlay auto-advance path).
    """
    pc = _require_pending_combat(game, 'advance_combat_gate')
    gate_dict = pc.get('combatGate')
    if not isinstance(gate_dict, dict):
        # No gate open; nothing to do.
        return game

    if player_num == 0 or is_self_play(game):
        # Auto-advance: set both flags. JS uses this in self-play.
        gate_dict['p1Ready'] = True
        gate_dict['p2Ready'] = True
    elif player_num == 1:
        gate_dict['p1Ready'] = True
    elif player_num == 2:
        gate_dict['p2Ready'] = True

    if gate_dict.get('p1Ready') and gate_dict.get('p2Ready'):
        # Both ready: clear the gate. The caller (dispatch_combat_gate
        # _advance) routes to the next phase step.
        clear_gate(game)

    data = game.data if hasattr(game, 'data') else game
    data['pendingCombat'] = pc
    return game


# ── Forced reroll queue ─────────────────────────────────────────────────


def step_forced_reroll(game: Any, *, dice_stream=None, recorder=None,
                       rng=None) -> Any:
    """Drain pendingCombat['forcedRerollQueue'] one entry at a time.

    Each queue entry is `{controlPlayer, pool: 'attack'|'defense'|'any',
    remaining: int, source: str}`. JS sites populate this at
    src/handlers/combat.js:2992-3036 (Versatile Weaponry, Shared
    Calculations, Raider, Precision, Fyrnock Style).

    Behavior per entry:
      - Reroll one die from the indicated pool (worst die for the
        controlPlayer's interest — attacker forces worst-defense reroll,
        defender forces worst-attack reroll).
      - Decrement remaining; pop entry when 0.
    Recomputes attackRoll / defenseRoll totals after each reroll.

    Advances to POST_FORCED_GATE when the queue is empty.

    Self-play / atomic mode: drain the entire queue in one call.
    Discord mode: caller invokes once per UI step.
    """
    from python.engine.mechanics.dice import (
        roll_single_attack_die,
        roll_single_defense_die,
    )

    pc = _require_pending_combat(game, 'step_forced_reroll')
    cur_phase = get_phase(game)
    if cur_phase not in (
        CombatPhase.POST_ROLL_GATE,
        CombatPhase.FORCED_REROLL,
    ):
        raise CombatStateError(
            f'step_forced_reroll: cannot run from phase {cur_phase}'
        )

    queue = list(pc.get('forcedRerollQueue') or [])
    if not queue:
        # Nothing to do. Advance to post-forced gate.
        set_phase(game, CombatPhase.POST_FORCED_GATE)
        open_gate(game, CombatPhase.POST_FORCED_GATE)
        data = game.data if hasattr(game, 'data') else game
        data['pendingCombat'] = pc
        return game

    set_phase(game, CombatPhase.FORCED_REROLL)

    # Drain one entry. In self-play mode caller can loop until empty.
    entry = queue[0]
    if not isinstance(entry, dict):
        queue.pop(0)
        pc['forcedRerollQueue'] = queue
        data = game.data if hasattr(game, 'data') else game
        data['pendingCombat'] = pc
        return game

    pool = entry.get('pool') or 'any'
    remaining = int(entry.get('remaining') or 0)
    control_player = int(entry.get('controlPlayer') or 0)

    # Pick which side's pool to reroll from. JS picks based on
    # controlPlayer's intent (attacker re-rolls defense; defender
    # re-rolls attack). 'any' defaults to attack-side.
    atk_player = int(pc.get('attackerPlayerNum') or 1)
    if pool == 'attack' or (pool == 'any' and control_player != atk_player):
        # Reroll one attack die — pick the worst (lowest acc+dmg+surge sum).
        atk_dice = list(pc.get('attackDiceResults') or [])
        if atk_dice:
            worst_idx = min(
                range(len(atk_dice)),
                key=lambda i: (
                    int(atk_dice[i].get('acc') or 0)
                    + int(atk_dice[i].get('dmg') or 0)
                    + int(atk_dice[i].get('surge') or 0)
                ),
            )
            color = atk_dice[worst_idx].get('color') or 'blue'
            new_die = roll_single_attack_die(
                color, stream=dice_stream, recorder=recorder, rng=rng,
            )
            atk_dice[worst_idx] = new_die
            pc['attackDiceResults'] = atk_dice
            pc['attackRoll'] = {
                'acc': sum(int(d.get('acc') or 0) for d in atk_dice),
                'dmg': sum(int(d.get('dmg') or 0) for d in atk_dice),
                'surge': sum(int(d.get('surge') or 0) for d in atk_dice),
            }
            rerolled = list(pc.get('attackerRerolledIndices') or [])
            if worst_idx not in rerolled:
                rerolled.append(worst_idx)
            pc['attackerRerolledIndices'] = rerolled
    else:
        # Reroll one defense die — pick the worst (lowest block+evade).
        def_dice = list(pc.get('defenseDiceResults') or [])
        if def_dice:
            worst_idx = min(
                range(len(def_dice)),
                key=lambda i: (
                    int(def_dice[i].get('block') or 0)
                    + int(def_dice[i].get('evade') or 0)
                ),
            )
            color = def_dice[worst_idx].get('color') or 'white'
            new_die = roll_single_defense_die(
                color, stream=dice_stream, recorder=recorder, rng=rng,
            )
            def_dice[worst_idx] = new_die
            pc['defenseDiceResults'] = def_dice
            pc['defenseRoll'] = {
                'block': sum(int(d.get('block') or 0) for d in def_dice),
                'evade': sum(int(d.get('evade') or 0) for d in def_dice),
                'dodge': any(d.get('dodge') for d in def_dice),
            }
            rerolled = list(pc.get('defenderRerolledIndices') or [])
            if worst_idx not in rerolled:
                rerolled.append(worst_idx)
            pc['defenderRerolledIndices'] = rerolled

    # Decrement remaining; pop entry when exhausted.
    remaining -= 1
    if remaining <= 0:
        queue.pop(0)
    else:
        entry['remaining'] = remaining
        queue[0] = entry
    pc['forcedRerollQueue'] = queue

    # If queue now empty, advance to post-forced gate.
    if not queue:
        set_phase(game, CombatPhase.POST_FORCED_GATE)
        open_gate(game, CombatPhase.POST_FORCED_GATE)

    data = game.data if hasattr(game, 'data') else game
    data['pendingCombat'] = pc
    return game


# ── Attacker / defender reroll phases ───────────────────────────────────


def _reroll_attack_die(pc: Dict[str, Any], die_idx: int, *,
                       dice_stream=None, recorder=None, rng=None) -> None:
    """Reroll attack die at given index; update totals + rerolled-index list."""
    from python.engine.mechanics.dice import roll_single_attack_die
    atk_dice = list(pc.get('attackDiceResults') or [])
    if die_idx < 0 or die_idx >= len(atk_dice):
        return
    color = atk_dice[die_idx].get('color') or 'blue'
    atk_dice[die_idx] = roll_single_attack_die(
        color, stream=dice_stream, recorder=recorder, rng=rng,
    )
    pc['attackDiceResults'] = atk_dice
    pc['attackRoll'] = {
        'acc': sum(int(d.get('acc') or 0) for d in atk_dice),
        'dmg': sum(int(d.get('dmg') or 0) for d in atk_dice),
        'surge': sum(int(d.get('surge') or 0) for d in atk_dice),
    }
    rerolled = list(pc.get('attackerRerolledIndices') or [])
    if die_idx not in rerolled:
        rerolled.append(die_idx)
    pc['attackerRerolledIndices'] = rerolled


def _reroll_defense_die(pc: Dict[str, Any], die_idx: int, *,
                         dice_stream=None, recorder=None, rng=None) -> None:
    """Reroll defense die at given index; update totals + rerolled-index list."""
    from python.engine.mechanics.dice import roll_single_defense_die
    def_dice = list(pc.get('defenseDiceResults') or [])
    if die_idx < 0 or die_idx >= len(def_dice):
        return
    color = def_dice[die_idx].get('color') or 'white'
    def_dice[die_idx] = roll_single_defense_die(
        color, stream=dice_stream, recorder=recorder, rng=rng,
    )
    pc['defenseDiceResults'] = def_dice
    pc['defenseRoll'] = {
        'block': sum(int(d.get('block') or 0) for d in def_dice),
        'evade': sum(int(d.get('evade') or 0) for d in def_dice),
        'dodge': any(d.get('dodge') for d in def_dice),
    }
    rerolled = list(pc.get('defenderRerolledIndices') or [])
    if die_idx not in rerolled:
        rerolled.append(die_idx)
    pc['defenderRerolledIndices'] = rerolled


def step_attacker_reroll(game: Any, die_idx: Optional[int] = None, *,
                          dice_stream=None, recorder=None, rng=None) -> Any:
    """Spend one attacker reroll on `die_idx` (or auto-pick worst die when
    None). Decrements pendingCombat['attackerRerollsRemaining'].

    Mirrors JS combat.js:3441 (combat.attackDiceResults mutated). Innate
    rerolls are pre-loaded into attackerRerollsRemaining at declare time.

    When attackerRerollsRemaining reaches 0, advances to
    POST_ATTACKER_GATE and opens the gate.
    """
    pc = _require_pending_combat(game, 'step_attacker_reroll')
    cur_phase = get_phase(game)
    if cur_phase not in (
        CombatPhase.POST_FORCED_GATE,
        CombatPhase.ATTACKER_REROLL,
    ):
        raise CombatStateError(
            f'step_attacker_reroll: cannot run from phase {cur_phase}'
        )

    remaining = int(pc.get('attackerRerollsRemaining') or 0)
    if remaining <= 0:
        # No rerolls available — advance to gate.
        set_phase(game, CombatPhase.POST_ATTACKER_GATE)
        open_gate(game, CombatPhase.POST_ATTACKER_GATE)
        data = game.data if hasattr(game, 'data') else game
        data['pendingCombat'] = pc
        return game

    set_phase(game, CombatPhase.ATTACKER_REROLL)

    # Pick die to reroll: caller-supplied or worst (lowest sum).
    if die_idx is None:
        atk_dice = pc.get('attackDiceResults') or []
        if atk_dice:
            die_idx = min(
                range(len(atk_dice)),
                key=lambda i: (
                    int(atk_dice[i].get('acc') or 0)
                    + int(atk_dice[i].get('dmg') or 0)
                    + int(atk_dice[i].get('surge') or 0)
                ),
            )

    if die_idx is not None:
        _reroll_attack_die(
            pc, die_idx,
            dice_stream=dice_stream, recorder=recorder, rng=rng,
        )

    pc['attackerRerollsRemaining'] = remaining - 1

    if pc['attackerRerollsRemaining'] <= 0:
        set_phase(game, CombatPhase.POST_ATTACKER_GATE)
        open_gate(game, CombatPhase.POST_ATTACKER_GATE)

    data = game.data if hasattr(game, 'data') else game
    data['pendingCombat'] = pc
    return game


def step_defender_reroll(game: Any, die_idx: Optional[int] = None, *,
                          dice_stream=None, recorder=None, rng=None) -> Any:
    """Spend one defender reroll on `die_idx`. Mirror of step_attacker_reroll
    for defender side. JS combat.js:3495 (combat.defenseDiceResults mutated).

    When defenderRerollsRemaining reaches 0, advances to POST_DEFENDER_GATE.
    """
    pc = _require_pending_combat(game, 'step_defender_reroll')
    cur_phase = get_phase(game)
    if cur_phase not in (
        CombatPhase.POST_ATTACKER_GATE,
        CombatPhase.DEFENDER_REROLL,
    ):
        raise CombatStateError(
            f'step_defender_reroll: cannot run from phase {cur_phase}'
        )

    remaining = int(pc.get('defenderRerollsRemaining') or 0)
    if remaining <= 0:
        set_phase(game, CombatPhase.POST_DEFENDER_GATE)
        open_gate(game, CombatPhase.POST_DEFENDER_GATE)
        data = game.data if hasattr(game, 'data') else game
        data['pendingCombat'] = pc
        return game

    set_phase(game, CombatPhase.DEFENDER_REROLL)

    if die_idx is None:
        def_dice = pc.get('defenseDiceResults') or []
        if def_dice:
            die_idx = min(
                range(len(def_dice)),
                key=lambda i: (
                    int(def_dice[i].get('block') or 0)
                    + int(def_dice[i].get('evade') or 0)
                ),
            )

    if die_idx is not None:
        _reroll_defense_die(
            pc, die_idx,
            dice_stream=dice_stream, recorder=recorder, rng=rng,
        )

    pc['defenderRerollsRemaining'] = remaining - 1

    if pc['defenderRerollsRemaining'] <= 0:
        set_phase(game, CombatPhase.POST_DEFENDER_GATE)
        open_gate(game, CombatPhase.POST_DEFENDER_GATE)

    data = game.data if hasattr(game, 'data') else game
    data['pendingCombat'] = pc
    return game
