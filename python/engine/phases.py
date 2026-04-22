"""Phase and round-phase enums — mirrors `src/game/phase.js`.

String-valued enums so `phase_value == 'round_active'` matches JS JSON
exactly without explicit conversion.
"""
from enum import Enum


class Phase(str, Enum):
    LOBBY = 'lobby'
    MAP_SELECTION = 'map_selection'
    INITIATIVE = 'initiative'
    ZONE_SELECTION = 'zone_selection'
    DEPLOYMENT = 'deployment'
    ATTACHMENT = 'attachment'
    CC_DRAW = 'cc_draw'
    ROUND_ACTIVE = 'round_active'
    ENDED = 'ended'


class RoundPhase(str, Enum):
    START_OF_ROUND = 'start_of_round'
    ACTIVATION = 'activation'
    END_OF_ROUND = 'end_of_round'


VALID_PHASE_TRANSITIONS = {
    Phase.LOBBY.value:          [Phase.MAP_SELECTION.value],
    Phase.MAP_SELECTION.value:  [Phase.INITIATIVE.value],
    Phase.INITIATIVE.value:     [Phase.ZONE_SELECTION.value],
    Phase.ZONE_SELECTION.value: [Phase.ATTACHMENT.value, Phase.DEPLOYMENT.value],
    Phase.ATTACHMENT.value:     [Phase.DEPLOYMENT.value],
    Phase.DEPLOYMENT.value:     [Phase.ATTACHMENT.value, Phase.CC_DRAW.value],
    Phase.CC_DRAW.value:        [Phase.ROUND_ACTIVE.value],
    Phase.ROUND_ACTIVE.value:   [Phase.ENDED.value],
    Phase.ENDED.value:          [],
}

VALID_ROUND_PHASE_TRANSITIONS = {
    RoundPhase.START_OF_ROUND.value: [RoundPhase.ACTIVATION.value],
    RoundPhase.ACTIVATION.value:     [RoundPhase.END_OF_ROUND.value],
    RoundPhase.END_OF_ROUND.value:   [RoundPhase.START_OF_ROUND.value],
}


def is_valid_phase_transition(from_phase, to_phase):
    if from_phase is None:
        return True
    if to_phase == Phase.ENDED.value:
        return True
    allowed = VALID_PHASE_TRANSITIONS.get(from_phase)
    if allowed is None:
        return True
    return to_phase in allowed


def is_valid_round_phase_transition(from_phase, to_phase):
    if from_phase is None:
        return True
    allowed = VALID_ROUND_PHASE_TRANSITIONS.get(from_phase)
    if allowed is None:
        return True
    return to_phase in allowed
