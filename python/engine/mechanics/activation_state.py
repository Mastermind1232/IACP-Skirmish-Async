"""Per-activation + per-round state cleanup.

Byte-identical port of src/game/activation-state.js. Defines the four
flag lists JS uses to drive cleanupActivation() (called at end of each
DC's activation) and cleanupRoundStart() (called at start of each round).

Each flag list is a category of game-state field with a uniform key
shape:
  - ACTIVATION_MSGID_FLAGS: keyed by DC message ID. Cleared for the
    activated DC's msg_id at end of activation.
  - ACTIVATION_FIGKEY_FLAGS: keyed by figure_key. Cleared for every
    figure in the activated deployment group.
  - ACTIVATION_PLAYERNUM_FLAGS: keyed by player number. Cleared for
    the activating player at end of activation.
  - ACTIVATION_SCALAR_FLAGS: top-level fields. Deleted entirely.
  - ROUND_OBJECT_FLAGS: round-scoped dict fields. Reset to {}.
  - ROUND_NULL_FLAGS: round-scoped fields. Reset to None.

Without these resets, accumulated state across activations / rounds
diverges from JS — the source of many drift diffs before this port.
"""
from __future__ import annotations

from typing import Any, Dict, List


# ── Per-activation flags ────────────────────────────────────────────────


ACTIVATION_MSGID_FLAGS: List[str] = [
    'dcActionsData',
    'movementBank',
    'dcFinishedPinged',
    'pendingEndTurn',
    'fellSwoopFreeAttack',
    'overrunThisActivation',
    'overrunDamagedThisMove',
    'pummelTwoAttacksThisActivation',
    'pummelAttacksRemaining',
    'stayDownPendingMsgId',
    'burstFirePendingMsgId',
    'cripplingBlowPending',
    'disruptorRiflePending',
    'tonfaStrikeSecondAttack',
    'barrageSecondAttack',
    'barrageTargetSpace',
    'barrageDefenseBonus',
    'pendingMultiTargetRoll',
    'closeQuartersActive',
    'mobileMovementActive',
    'moveXBypassActive',
    'rushPending',
    'shoulderRushPending',
    'forcedAttackTarget',
    'selfDefeatsAfterAttackMsgId',
    'applySelfStunAfterAttackPlayerNum',
    'postActivationConditions',
    'pendingCombatResupply',
    'pendingPostAttackConditions',
    'pendingMpBonus',
    'freeAttackBonusPending',
    'pendingOverrideAttackDice',
    'pendingSlingBarrage',
    'nextAttackReach',
    'selfDestructProtocolTriggered',
    'falseOrdersUpgrade',
    'setTrapSpace',
    'reverseEngineerActive',
    'findsmanMeditationTarget',
    'nextAttackIgnoreFigureLOS',
    'optimalBombardmentBlastBonus',
    'deflectionPending',
    'deflectionUnconditional',
    'dcActivationLogMessageIds',
    'defenderThreadData',
    'deviceRerollGranted',
    'autofireActive',
    'fireMissionActive',
    'autofireChainTargetSpace',
    'darksaberSecondAttack',
    'saberOrbitAttacksRemaining',
    'pendingOverwatchPlacement',
    'activationKills',
    'activationDamagedFigures',
    'unstableDevicesUsedThisActivation',
    'yhsiwOptions',
    'pendingBoRifle',
    'pendingBombDrop',
    'activationExtraActionThenStun',
    'beastTamerInteractOverride',
    'imperialRetrofittingMultiAttack',
    'arcingShotActive',
    'wookieeAvengerSlamUsed',
    'specialActionUsedThisActivation',
    'focusFireActive',
    'multiFireActive',
    'multiFireBlockedTarget',
    'spotWeldPending',
    'pendingMissileSalvo',
    'pendingPounceSpaceChoice',
]


ACTIVATION_FIGKEY_FLAGS: List[str] = [
    'figureMoved',
    'tripodAttacked',
    'activationStartPositions',
    'overdriveUsedThisActivation',
    'massiveMovementLocked',
]


ACTIVATION_PLAYERNUM_FLAGS: List[str] = [
    'nextAttacksBonusHits',
    'nextAttacksBonusConditions',
    'nextAttackBonusSurgeAbilities',
    'nextAttackBonusPierce',
    'nextAttackBonusAccuracy',
    'vetInstinctsActiveThisActivation',
]


ACTIVATION_SCALAR_FLAGS: List[str] = [
    'commsJammerActivePlayerNum',
    'partingShotTriggered',
    'onTheLamActive',
    'arcingShotActiveScalar',
    'pendingWookSlamPush',
    'pendingSurgeOverflow',
]


# ── Per-round flags ─────────────────────────────────────────────────────


ROUND_OBJECT_FLAGS: List[str] = [
    'roundDefenseBonusBlock',
    'roundDefenseBonusEvade',
    'roundDefenseAccuracyPenalty',
    'roundMobileDefenseBonusBlock',
    'roundDefenderBonusBlockPerEvade',
    'roundTrooperAttackHitBonus',
    'roundVehicleSpeedBonus',
    'deflectionPending',
    'deflectionUnconditional',
    'roundAttackRerollDice',
    'freeAttackBonusPending',
    'pendingOverrideAttackDice',
    'pendingSlingBarrage',
    'nextAttackReach',
    'p1ActivationPhaseEnded',
    'p2ActivationPhaseEnded',
    'roundFigureAbilityUsed',
    'roundEfficientTravel',
    'roundEoREffectsPlayed',
    'fellSwoopFreeAttack',
    'overrunThisActivation',
    'overrunDamagedThisMove',
    'pummelTwoAttacksThisActivation',
    'pummelAttacksRemaining',
    'autofireActive',
    'fireMissionActive',
    'autofireChainTargetSpace',
    'roundDefenseAccuracyPenalty',
    'p1LaunchPanelFlippedThisRound',
    'p2LaunchPanelFlippedThisRound',
    'reinforcementsPlayedThisSor',
    'powerConverterUsedThisRound',
    'noCommandDrawThisRound',
    'harshEnvironmentActive',
    'p1EndOfRoundPassed',
    'p2EndOfRoundPassed',
]


ROUND_NULL_FLAGS: List[str] = [
    'youWillNotDenyMeActive',
    'phaseGate',
    'pendingPounceSpaceChoice',
    'pendingDcAbilityChoice',
    'pendingNegation',
    'pendingCelebration',
    'pendingPowerTokenGrant',
    'pendingItWillBeAlright',
    'pendingMuchToLearn',
    'pendingArmsDistribution',
    'pendingStrikeTeam',
    'pendingWristFlamethrower',
    'pendingEe3CarbinePassive',
    'pendingPatternE',
    'pendingSpacePick',
    'lastDefeatInfo',
    'lastCombatResult',
    'agitateNextActivation',
    'forceVisionPending',
    'forceVisionNextActivation',
    'strengthInNumbersData',
    'strengthInNumbersPlayerNum',
]


# ── Cleanup functions ───────────────────────────────────────────────────


def _state(game: Any) -> Dict[str, Any]:
    """Coerce a game (GameState wrapper or plain dict) to its underlying
    dict so we can mutate top-level fields uniformly."""
    return game.data if hasattr(game, 'data') else game


def cleanup_activation(game: Any, msg_id: str, player_num: int,
                       figure_keys: List[str]) -> None:
    """Run end-of-activation cleanup for a single DC's activation.

    Mirrors JS cleanupActivation (src/game/activation-state.js:127):
      - For each MSGID flag: delete game[flag][msg_id]
      - For each FIGKEY flag: delete game[flag][fk] for every fk in
        figure_keys
      - For each PLAYERNUM flag: delete game[flag][player_num]
      - For each SCALAR flag: delete game[flag] entirely
      - moveInProgress: delete entries whose key starts with msg_id + '_'
    """
    data = _state(game)

    for key in ACTIVATION_MSGID_FLAGS:
        d = data.get(key)
        if isinstance(d, dict) and msg_id in d:
            del d[msg_id]

    for key in ACTIVATION_FIGKEY_FLAGS:
        d = data.get(key)
        if not isinstance(d, dict):
            continue
        for fk in figure_keys:
            if fk in d:
                del d[fk]

    for key in ACTIVATION_PLAYERNUM_FLAGS:
        d = data.get(key)
        if isinstance(d, dict):
            # JS may have str or int keys; clear both shapes.
            if player_num in d:
                del d[player_num]
            if str(player_num) in d:
                del d[str(player_num)]

    for key in ACTIVATION_SCALAR_FLAGS:
        if key in data:
            del data[key]

    # moveInProgress uses compound keys "<msg_id>_<figureIndex>" —
    # clear any starting with msg_id + '_'.
    move_in_progress = data.get('moveInProgress')
    if isinstance(move_in_progress, dict):
        prefix = f'{msg_id}_'
        for k in list(move_in_progress.keys()):
            if isinstance(k, str) and k.startswith(prefix):
                del move_in_progress[k]


def cleanup_round_start(game: Any) -> None:
    """Run start-of-round cleanup. Mirrors JS cleanupRoundStart (line ~430).

    Resets:
      - ROUND_OBJECT_FLAGS to {}
      - ROUND_NULL_FLAGS to None

    Called at the top of each new round to clear flags that were set
    during the prior round's combat / end-of-round window.
    """
    data = _state(game)

    for key in ROUND_OBJECT_FLAGS:
        data[key] = {}

    for key in ROUND_NULL_FLAGS:
        data[key] = None
