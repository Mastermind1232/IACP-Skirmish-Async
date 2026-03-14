/**
 * Action type constants and customId builders for the available-actions system.
 * Maps game states to the handler prefixes that can handle them.
 */

export const ACTION_TYPES = {
  // Setup
  SELECT_MAP: 'select_map',
  MAP_TYPE_CHOICE: 'map_type_choice',
  MAP_CONFIRM: 'map_confirm',
  MAP_GO_BACK: 'map_go_back',
  DRAFT_RANDOM: 'draft_random',
  DETERMINE_INITIATIVE: 'determine_initiative',
  PICK_ZONE: 'pick_zone',
  DEPLOY_FIGURE: 'deploy_figure',
  DEPLOY_PICK: 'deploy_pick',
  DEPLOY_ROW: 'deploy_row',
  DEPLOY_DONE: 'deployment_done',
  AUTO_DEPLOY: 'auto_deploy',
  CONFIRM_ATTACHMENT: 'confirm_attachment',
  DRAW_CC: 'draw_cc',
  SUBMIT_SQUAD: 'submit_squad',

  // Activation
  ACTIVATE_DC: 'activate_dc',
  MOVE_FIGURE: 'move_figure',
  MOVE_PICK_SPACE: 'move_pick_space',
  MOVE_MP: 'move_mp',
  MOVE_LETTER: 'move_letter',
  ATTACK_TARGET: 'attack_target',
  DC_ACTION: 'dc_action',
  SPECIAL_ACTION: 'special_action',
  DC_SPECIAL: 'dc_special',
  INTERACT: 'interact',
  END_TURN: 'end_turn',
  DC_END_ACTIVATION: 'dc_end_activation',
  PASS_ACTIVATION_TURN: 'pass_activation_turn',
  END_ACTIVATION_PHASE: 'end_activation_phase',
  PLAY_CC: 'play_cc',
  CC_DRAW: 'cc_draw',

  // Combat
  COMBAT_READY: 'combat_ready',
  COMBAT_ROLL: 'combat_roll',
  COMBAT_REROLL: 'combat_reroll',
  COMBAT_SURGE: 'combat_surge',
  COMBAT_SKIP_SURGES: 'combat_skip_surges',
  COMBAT_RESOLVE: 'combat_resolve',
  COMBAT_PASSIVE: 'combat_passive',
  COMBAT_TOKEN: 'combat_token',

  // Phase gate
  PHASE_GATE_READY: 'phase_gate_ready',
  PHASE_GATE_UNREADY: 'phase_gate_unready',

  // Round
  END_ROUND_PASS: 'end_round_pass',
  END_START_OF_ROUND: 'end_start_of_round',
  END_END_OF_ROUND: 'end_end_of_round',

  // Pending sub-states
  DC_ABILITY_CHOICE: 'dc_ability_choice',
  CELEBRATION_PLAY: 'celebration_play',
  CELEBRATION_PASS: 'celebration_pass',
  POUNCE_SPACE: 'pounce_space',
  MISSILE_SALVO_DIE: 'missile_salvo_die',
  MISSILE_SALVO_DONE: 'missile_salvo_done',
  POWER_TOKEN_CHOICE: 'power_token_choice',
  COVER_FIRE_BLOCK: 'cover_fire_block',
  COVER_FIRE_SKIP: 'cover_fire_skip',
  SPREAD_PAIN_COND: 'spread_pain_cond',
  STRAIN_CHOICE_ALLDMG: 'strain_choice_alldmg',
  STRAIN_CHOICE_DISCARD: 'strain_choice_discard',

  // Misc
  REFRESH_MAP: 'refresh_map',
  UNDO: 'undo',
};

/**
 * Build a customId string for a given action type and parameters.
 * This encodes the handler prefix + game-specific identifiers.
 */
export function buildCustomId(type, params = {}) {
  const { gameId, msgId, playerNum, dcIndex, figureIndex = 0, coord, targetInfo } = params;

  switch (type) {
    // Phase gate
    case ACTION_TYPES.PHASE_GATE_READY:
      return `phase_gate_ready_${gameId}`;
    case ACTION_TYPES.PHASE_GATE_UNREADY:
      return `phase_gate_unready_${gameId}`;

    // Activation — must match handler parsing formats
    case ACTION_TYPES.ACTIVATE_DC:
      // Handler parses: dc_activate_{gameId}_{playerNum}_{dcIndex}
      return `dc_activate_${gameId}_${playerNum}_${dcIndex}`;
    case ACTION_TYPES.END_TURN:
      // Handler parses: end_turn_{gameId}_{msgId} (regex: /^end_turn_([^_]+)_(.+)$/)
      return `end_turn_${gameId}_${msgId}`;
    case ACTION_TYPES.DC_END_ACTIVATION:
      // Handler parses: dc_end_activation_{msgId} (simple replace)
      return `dc_end_activation_${msgId}`;
    case ACTION_TYPES.PASS_ACTIVATION_TURN:
      return `pass_activation_turn_${gameId}`;
    case ACTION_TYPES.END_ACTIVATION_PHASE:
      return `status_phase_${gameId}`;

    // Movement — handler expects _f{figureIndex} suffix
    case ACTION_TYPES.MOVE_FIGURE:
      return `dc_move_${msgId}_f${figureIndex}`;
    case ACTION_TYPES.MOVE_MP:
      return `move_mp_${params.moveKey}_${params.mp}`;
    case ACTION_TYPES.MOVE_PICK_SPACE:
      return `move_pick_${params.moveKey}_${coord}`;

    // Combat — handler expects _f{figureIndex} suffix for attack
    case ACTION_TYPES.ATTACK_TARGET:
      return `dc_attack_${msgId}_f${figureIndex}`;
    case ACTION_TYPES.COMBAT_READY:
      return `combat_ready_${gameId}`;
    case ACTION_TYPES.COMBAT_ROLL:
      return `combat_roll_${gameId}`;
    case ACTION_TYPES.COMBAT_SURGE:
      return `combat_surge_${gameId}_${params.surgeIndex}`;
    case ACTION_TYPES.COMBAT_REROLL:
      return `combat_reroll_${gameId}_${params.dieIndex}`;
    case ACTION_TYPES.COMBAT_RESOLVE:
      return `combat_resolve_ready_${gameId}`;

    // DC Special
    case ACTION_TYPES.DC_SPECIAL:
      return `dc_special_${params.specialIdx}_${msgId}`;

    // Interact
    case ACTION_TYPES.INTERACT:
      return `interact_choice_${gameId}_${msgId}_${figureIndex}_${params.optionId}`;

    // Setup
    case ACTION_TYPES.DRAFT_RANDOM:
      return `draft_random_${gameId}`;
    case ACTION_TYPES.DETERMINE_INITIATIVE:
      return `determine_initiative_${gameId}`;
    case ACTION_TYPES.PICK_ZONE:
      return `deployment_zone_${params.zone}_${gameId}`;
    case ACTION_TYPES.DEPLOY_FIGURE:
      return `deployment_fig_${gameId}_${dcIndex}`;
    case ACTION_TYPES.DEPLOY_DONE:
      return `deployment_done_${gameId}`;
    case ACTION_TYPES.AUTO_DEPLOY:
      return `auto_deploy_${gameId}`;
    case ACTION_TYPES.DRAW_CC:
      return `cc_shuffle_draw_${gameId}`;

    // Round
    case ACTION_TYPES.END_END_OF_ROUND:
      return `end_end_of_round_${gameId}`;
    case ACTION_TYPES.END_START_OF_ROUND:
      return `end_start_of_round_${gameId}`;

    // Pending sub-states
    case ACTION_TYPES.DC_ABILITY_CHOICE:
      return `dc_ability_choice_${gameId}_${params.msgId}_${params.specialIdx}_${params.choiceIndex}`;
    case ACTION_TYPES.CELEBRATION_PLAY:
      return `celebration_play_${gameId}`;
    case ACTION_TYPES.CELEBRATION_PASS:
      return `celebration_pass_${gameId}`;
    case ACTION_TYPES.POUNCE_SPACE:
      return `pounce_space_${gameId}_${params.msgId}_${params.figureIndex}_${params.space}`;
    case ACTION_TYPES.MISSILE_SALVO_DIE:
      return `missile_salvo_die_${params.color}_${gameId}_${params.msgId}`;
    case ACTION_TYPES.MISSILE_SALVO_DONE:
      return `missile_salvo_done_${gameId}_${params.msgId}`;
    case ACTION_TYPES.POWER_TOKEN_CHOICE:
      return `power_token_choice_${gameId}_${params.tokenType}`;
    case ACTION_TYPES.COVER_FIRE_BLOCK:
      return `cover_fire_block_${gameId}_${params.playerNum}_${params.figureKey}`;
    case ACTION_TYPES.COVER_FIRE_SKIP:
      return `cover_fire_discard_skip_${gameId}`;
    case ACTION_TYPES.SPREAD_PAIN_COND:
      return `spread_pain_cond_${gameId}_${params.condition}`;
    case ACTION_TYPES.STRAIN_CHOICE_ALLDMG:
      return `strain_choice_alldmg_${gameId}`;
    case ACTION_TYPES.STRAIN_CHOICE_DISCARD:
      return `strain_choice_discard_${gameId}_${params.discardCount}`;

    // Misc
    case ACTION_TYPES.REFRESH_MAP:
      return `refresh_map_${gameId}`;
    case ACTION_TYPES.UNDO:
      return `undo_${gameId}`;

    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}
