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
  // Combat reactions
  'cleave_target_': COMMAND_TYPES.CleaveTarget,
  // Hand/CC operations
  'cc_play_': COMMAND_TYPES.PlayCommandCard,
  'cc_confirm_play_': COMMAND_TYPES.PlayCommandCard,
  'cc_cancel_play_': COMMAND_TYPES.PlayCommandCard,
  'cc_draw_': COMMAND_TYPES.DrawCommandCards,
  'cc_shuffle_draw_': COMMAND_TYPES.DrawCommandCards,
  'cc_discard_': COMMAND_TYPES.DiscardCommandCard,
  'cc_discard_select_': COMMAND_TYPES.DiscardCommandCard,
  'cc_search_discard_': COMMAND_TYPES.DiscardCommandCard,
  'cc_close_discard_': COMMAND_TYPES.DiscardCommandCard,
  'cc_play_select_': COMMAND_TYPES.PlayCommandCard,
  'cc_choice_': COMMAND_TYPES.PlayCommandCard,
  'cc_attach_to_': COMMAND_TYPES.PlayCommandCard,
  'cc_space_': COMMAND_TYPES.PlayCommandCard,
  'negation_play_': COMMAND_TYPES.NegationAttempt,
  'negation_let_resolve_': COMMAND_TYPES.NegationResolve,
  'dc_cc_special_': COMMAND_TYPES.PlayCommandCard,
  'dc_cc_double_': COMMAND_TYPES.PlayCommandCard,
  'dc_cc_eoa_': COMMAND_TYPES.PlayCommandCard,
  'dc_cc_defender_': COMMAND_TYPES.PlayCommandCard,
  'bm_draw_': COMMAND_TYPES.DrawCommandCards,
  'bm_discard_': COMMAND_TYPES.DiscardCommandCard,
  'bm_return_': COMMAND_TYPES.DiscardCommandCard,
  'bm_skip_': COMMAND_TYPES.DiscardCommandCard,
  'deck_illegal_play_': COMMAND_TYPES.PlayCommandCard,
  'deck_illegal_redo_': COMMAND_TYPES.PlayCommandCard,
  'illegal_cc_ignore_': COMMAND_TYPES.PlayCommandCard,
  'illegal_cc_unplay_': COMMAND_TYPES.PlayCommandCard,
  // Setup operations
  'map_selection_': COMMAND_TYPES.SelectMap,
  'map_type_': COMMAND_TYPES.SelectMap,
  'map_confirm_': COMMAND_TYPES.ConfirmMap,
  'map_goback_': COMMAND_TYPES.SelectMap,
  'map_selection_draw_': COMMAND_TYPES.SelectMap,
  'map_selection_pick_': COMMAND_TYPES.SelectMap,
  'determine_initiative_': COMMAND_TYPES.DetermineInitiative,
  'deployment_zone_red_': COMMAND_TYPES.ChooseDeploymentZone,
  'deployment_zone_blue_': COMMAND_TYPES.ChooseDeploymentZone,
  'deploy_pick_': COMMAND_TYPES.DeployFigure,
  'deploy_row_': COMMAND_TYPES.DeployFigure,
  'deploy_row_back_': COMMAND_TYPES.DeployFigure,
  'deployment_fig_': COMMAND_TYPES.DeployFigure,
  'deployment_orient_': COMMAND_TYPES.DeployFigure,
  'deployment_done_': COMMAND_TYPES.FinishDeployment,
  'auto_deploy_': COMMAND_TYPES.DeployFigure,
  'squad_select_': COMMAND_TYPES.SubmitSquad,
  'squad_confirm_': COMMAND_TYPES.SubmitSquad,
  'squad_cancel_': COMMAND_TYPES.SubmitSquad,
  'form_pick_': COMMAND_TYPES.DeployFigure,
  'loadout_select_': COMMAND_TYPES.DeployFigure,
  'loadout_confirm_': COMMAND_TYPES.DeployFigure,
  // DC play area
  'dc_attack_': COMMAND_TYPES.PerformAction,
  'dc_move_': COMMAND_TYPES.PerformAction,
  'dc_interact_': COMMAND_TYPES.PerformAction,
  'dc_special_': COMMAND_TYPES.PerformAction,
  'dc_toggle_': COMMAND_TYPES.PerformAction,
  'dc_deplete_': COMMAND_TYPES.PerformAction,
  'dc_unactivate_': COMMAND_TYPES.PerformAction,
  'dc_ability_choice_': COMMAND_TYPES.PerformAction,
  'dc_rename_': COMMAND_TYPES.PerformAction,
  'special_done_': COMMAND_TYPES.PerformAction,
  'interact_choice_': COMMAND_TYPES.PerformAction,
  'interact_cancel_': COMMAND_TYPES.PerformAction,
  'fast_forward_': COMMAND_TYPES.PerformAction,
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

    case 'move_adjust_mp_':
      return { gameId: parts[0] };

    // CC/hand — generic: capture the full remainder
    case 'cc_play_':
    case 'cc_confirm_play_':
    case 'cc_cancel_play_':
    case 'cc_draw_':
    case 'cc_shuffle_draw_':
    case 'cc_discard_':
    case 'cc_discard_select_':
    case 'cc_search_discard_':
    case 'cc_close_discard_':
    case 'cc_play_select_':
    case 'cc_choice_':
    case 'cc_attach_to_':
    case 'cc_space_':
    case 'negation_play_':
    case 'negation_let_resolve_':
    case 'dc_cc_special_':
    case 'dc_cc_double_':
    case 'dc_cc_eoa_':
    case 'dc_cc_defender_':
    case 'bm_draw_':
    case 'bm_discard_':
    case 'bm_return_':
    case 'bm_skip_':
    case 'deck_illegal_play_':
    case 'deck_illegal_redo_':
    case 'illegal_cc_ignore_':
    case 'illegal_cc_unplay_':
      return { gameId: parts[0], cardName: parts.slice(1).join('_') };

    // Setup — map operations
    case 'map_selection_':
    case 'map_type_':
    case 'map_confirm_':
    case 'map_goback_':
    case 'map_selection_draw_':
    case 'map_selection_pick_':
      return { gameId: parts[0], mapId: parts.slice(1).join('_') };

    case 'determine_initiative_':
      return { gameId: parts[0], initiativePlayerNum: parseInt(parts[1], 10) };

    case 'deployment_zone_red_':
      return { gameId: parts[0], zoneId: 'red', playerNum: parseInt(parts[1], 10) };

    case 'deployment_zone_blue_':
      return { gameId: parts[0], zoneId: 'blue', playerNum: parseInt(parts[1], 10) };

    case 'deploy_pick_':
    case 'deploy_row_':
    case 'deploy_row_back_':
    case 'deployment_fig_':
    case 'deployment_orient_':
    case 'auto_deploy_':
    case 'form_pick_':
    case 'loadout_select_':
    case 'loadout_confirm_':
      return { gameId: parts[0], figureKey: parts.slice(1).join('_') };

    case 'deployment_done_':
      return { gameId: parts[0], playerNum: parseInt(parts[1], 10) };

    case 'squad_select_':
    case 'squad_confirm_':
    case 'squad_cancel_':
      return { gameId: parts[0], affiliation: parts.slice(1).join('_') };

    // DC play area — generic
    case 'dc_attack_':
    case 'dc_move_':
    case 'dc_interact_':
    case 'dc_special_':
    case 'dc_toggle_':
    case 'dc_deplete_':
    case 'dc_unactivate_':
    case 'dc_ability_choice_':
    case 'dc_rename_':
    case 'special_done_':
    case 'interact_choice_':
    case 'interact_cancel_':
    case 'fast_forward_':
      return { gameId: parts[0], msgId: parts[1], actionType: prefix.replace(/_$/, '') };

    case 'cleave_target_':
      return { gameId: parts[0], targetFigureKey: parts.slice(1).join('_') };

    default:
      console.warn(`[command-router] parsePayloadFromCustomId: unhandled prefix "${prefix}" — customId="${customId}"`);
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
  console.warn(`[command-router] customIdToCommand: no command match for handlerKey="${handlerKey}" customId="${customId}"`);
  return null;
}
