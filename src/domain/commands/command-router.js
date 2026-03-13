import { COMMAND_TYPES } from './index.js';

/**
 * Maps button/select prefixes to command types.
 */
export const PREFIX_TO_COMMAND = {
  // Phase gates
  'phase_gate_ready_': COMMAND_TYPES.PhaseGateReady,
  'phase_gate_unready_': COMMAND_TYPES.PhaseGateUnready,
  // Round transitions
  'end_end_of_round_': COMMAND_TYPES.EndEndOfRound,
  'end_start_of_round_': COMMAND_TYPES.EndStartOfRound,
  'status_phase_': COMMAND_TYPES.StatusPhase,
  // Activation
  'dc_activate_': COMMAND_TYPES.ActivateDc,
  'end_turn_': COMMAND_TYPES.EndTurn,
  'dc_end_activation_': COMMAND_TYPES.DcEndActivation,
  'pass_activation_turn_': COMMAND_TYPES.PassActivationTurn,
  'confirm_activate_': COMMAND_TYPES.ConfirmActivate,
  'cancel_activate_': COMMAND_TYPES.CancelActivate,
  // Movement
  'move_mp_': COMMAND_TYPES.StartMovement,
  'move_pick_': COMMAND_TYPES.MoveToSpace,
  'move_letter_': COMMAND_TYPES.MoveLetter,
  'move_back_letters_': COMMAND_TYPES.MoveBackLetters,
  'move_adjust_mp_': COMMAND_TYPES.MoveAdjustMp,
  // Combat
  'attack_target_': COMMAND_TYPES.AttackTarget,
  'combat_ready_': COMMAND_TYPES.ReadyForCombat,
  'combat_roll_': COMMAND_TYPES.RollCombatDice,
  'combat_surge_': COMMAND_TYPES.SpendSurge,
  'combat_reroll_': COMMAND_TYPES.PerformReroll,
  'combat_resolve_ready_': COMMAND_TYPES.CombatResolveReady,
  'combat_passive_': COMMAND_TYPES.CombatPassive,
  'combat_token_': COMMAND_TYPES.CombatToken,
};

/**
 * Parses a customId string into structured payload fields.
 * Different prefixes encode different data after the prefix.
 */
export function parsePayloadFromCustomId(customId, prefix) {
  const remainder = customId.slice(prefix.length);
  const parts = remainder.split('_');

  switch (prefix) {
    case 'phase_gate_ready_':
    case 'phase_gate_unready_':
      return { gameId: parts[0], playerNum: parseInt(parts[1], 10) };

    case 'end_end_of_round_':
    case 'end_start_of_round_':
    case 'status_phase_':
      return { gameId: parts[0] };

    case 'dc_activate_':
    case 'dc_end_activation_':
    case 'end_turn_':
    case 'confirm_activate_':
    case 'cancel_activate_':
      return { gameId: parts[0], msgId: parts[1] };

    case 'pass_activation_turn_':
      return { gameId: parts[0], playerNum: parseInt(parts[1], 10) };

    case 'attack_target_':
      return { gameId: parts[0], attackerMsgId: parts[1], defenderMsgId: parts[2] };

    case 'combat_ready_':
      return { gameId: parts[0], playerNum: parseInt(parts[1], 10) };

    case 'combat_roll_':
    case 'combat_resolve_ready_':
      return { gameId: parts[0] };

    case 'combat_surge_':
      return { gameId: parts[0], surgeKey: parts.slice(1).join('_') };

    case 'combat_reroll_':
      return { gameId: parts[0], side: parts[1], dieIndex: parseInt(parts[2], 10) };

    case 'combat_passive_':
      return { gameId: parts[0], passiveName: parts.slice(1).join('_') };

    case 'combat_token_':
      return { gameId: parts[0], tokenType: parts[1], figureKey: parts.slice(2).join('_') };

    case 'move_mp_':
      return { gameId: parts[0], msgId: parts[1], movementPoints: parseInt(parts[2], 10) };

    case 'move_pick_':
      return { gameId: parts[0], coord: parts[1] };

    case 'move_letter_':
      return { gameId: parts[0], letter: parts[1] };

    case 'move_back_letters_':
    case 'move_adjust_mp_':
      return { gameId: parts[0] };

    default:
      return { raw: remainder };
  }
}

/**
 * Converts a Discord customId into a domain command.
 */
export function customIdToCommand(customId, handlerKey, playerId, gameId) {
  // Match using handlerKey (the prefix) directly first
  const commandType = PREFIX_TO_COMMAND[handlerKey];
  if (commandType) {
    const payload = parsePayloadFromCustomId(customId, handlerKey);
    return {
      type: commandType,
      gameId: payload.gameId || gameId,
      playerId,
      payload,
      timestamp: new Date().toISOString(),
    };
  }

  // Fallback: scan all prefixes
  for (const [prefix, cmdType] of Object.entries(PREFIX_TO_COMMAND)) {
    if (customId.startsWith(prefix)) {
      const payload = parsePayloadFromCustomId(customId, prefix);
      return {
        type: cmdType,
        gameId: payload.gameId || gameId,
        playerId,
        payload,
        timestamp: new Date().toISOString(),
      };
    }
  }
  return null;
}
