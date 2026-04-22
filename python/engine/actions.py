"""Action type enum + customId builder — mirrors `src/engine/action-types.js`.

Every JS ACTION_TYPES value has a Python equivalent. build_custom_id returns
the same customId strings the JS handler-registry parses.
"""
from enum import Enum


class ActionType(str, Enum):
    # Setup
    SELECT_MAP = 'select_map'
    MAP_TYPE_CHOICE = 'map_type_choice'
    MAP_CONFIRM = 'map_confirm'
    MAP_GO_BACK = 'map_go_back'
    DRAFT_RANDOM = 'draft_random'
    DETERMINE_INITIATIVE = 'determine_initiative'
    PICK_ZONE = 'pick_zone'
    DEPLOY_FIGURE = 'deploy_figure'
    DEPLOY_PICK = 'deploy_pick'
    DEPLOY_ROW = 'deploy_row'
    DEPLOY_DONE = 'deployment_done'
    AUTO_DEPLOY = 'auto_deploy'
    CONFIRM_ATTACHMENT = 'confirm_attachment'
    DRAW_CC = 'draw_cc'
    SUBMIT_SQUAD = 'submit_squad'

    # Activation
    ACTIVATE_DC = 'activate_dc'
    MOVE_FIGURE = 'move_figure'
    MOVE_PICK_SPACE = 'move_pick_space'
    MOVE_MP = 'move_mp'
    MOVE_LETTER = 'move_letter'
    ATTACK_TARGET = 'attack_target'
    DC_ACTION = 'dc_action'
    SPECIAL_ACTION = 'special_action'
    DC_SPECIAL = 'dc_special'
    INTERACT = 'interact'
    END_TURN = 'end_turn'
    DC_END_ACTIVATION = 'dc_end_activation'
    PASS_ACTIVATION_TURN = 'pass_activation_turn'
    END_ACTIVATION_PHASE = 'end_activation_phase'
    PLAY_CC = 'play_cc'
    PLAY_CC_SPECIAL = 'play_cc_special'
    PLAY_CC_DOUBLE = 'play_cc_double'
    CC_DRAW = 'cc_draw'

    # Combat
    COMBAT_READY = 'combat_ready'
    COMBAT_GATE = 'combat_gate'
    COMBAT_ROLL = 'combat_roll'
    COMBAT_REROLL = 'combat_reroll'
    COMBAT_SURGE = 'combat_surge'
    COMBAT_SKIP_SURGES = 'combat_skip_surges'
    COMBAT_RESOLVE = 'combat_resolve'
    COMBAT_PASSIVE = 'combat_passive'
    COMBAT_TOKEN = 'combat_token'

    # Phase gate
    PHASE_GATE_READY = 'phase_gate_ready'
    PHASE_GATE_UNREADY = 'phase_gate_unready'

    # Round
    END_ROUND_PASS = 'end_round_pass'
    END_START_OF_ROUND = 'end_start_of_round'
    END_END_OF_ROUND = 'end_end_of_round'

    # Pending sub-states
    DC_ABILITY_CHOICE = 'dc_ability_choice'
    CELEBRATION_PLAY = 'celebration_play'
    CELEBRATION_PASS = 'celebration_pass'
    POUNCE_SPACE = 'pounce_space'
    MISSILE_SALVO_DIE = 'missile_salvo_die'
    MISSILE_SALVO_DONE = 'missile_salvo_done'
    POWER_TOKEN_CHOICE = 'power_token_choice'
    COVER_FIRE_BLOCK = 'cover_fire_block'
    COVER_FIRE_SKIP = 'cover_fire_skip'
    PT_OVERFLOW_DISCARD = 'pt_overflow'
    SPREAD_PAIN_COND = 'spread_pain_cond'
    STRAIN_CHOICE_ALLDMG = 'strain_choice_alldmg'
    STRAIN_CHOICE_DISCARD = 'strain_choice_discard'

    # Dark sub-chain pending states
    RUSH_PUSH_FIG = 'rush_push_fig'
    RUSH_PUSH_SKIP = 'rush_push_skip'
    SHOULDER_RUSH_FIG = 'shoulder_rush_fig'
    SHOULDER_RUSH_SKIP = 'shoulder_rush_skip'
    FALSE_ORDERS_MOVE = 'false_orders_move'
    FALSE_ORDERS_ATTACK = 'false_orders_attack'
    FALSE_ORDERS_SKIP = 'false_orders_skip'
    CC_CONFIRM_PLAY = 'cc_confirm_play'
    CC_CANCEL_PLAY = 'cc_cancel_play'
    CC_CHOICE = 'cc_choice'
    CC_SPACE = 'cc_space'
    OVERWATCH_SPACE = 'overwatch_space'
    OB_SPACE = 'ob_space'
    BOMB_DROP_SPACE = 'bomb_drop_space'

    # Comm Disruption prompt
    COMM_DISRUPTION_PLAY = 'comm_disruption_play'
    COMM_DISRUPTION_SKIP = 'comm_disruption_skip'

    # Weapon choice pending states
    ARSENAL_PICK = 'arsenal_pick'
    EE3_PICK_DIE = 'ee3_pick_die'
    EE3_PICK_SKIP = 'ee3_pick_skip'
    BO_RIFLE_USE = 'bo_rifle_use'
    BO_RIFLE_SKIP = 'bo_rifle_skip'

    # Misc
    REFRESH_MAP = 'refresh_map'
    UNDO = 'undo'


def build_custom_id(action_type, **params):
    """Mirror of `buildCustomId` in src/engine/action-types.js.

    Returns the customId string the JS router dispatches on. Params match
    the JS signature one-for-one: gameId, msgId, playerNum, dcIndex,
    figureIndex, coord, etc.
    """
    t = action_type
    game_id = params.get('gameId')
    msg_id = params.get('msgId')
    player_num = params.get('playerNum')
    dc_index = params.get('dcIndex')
    figure_index = params.get('figureIndex', 0)

    if t == ActionType.PHASE_GATE_READY:
        return f'phase_gate_ready_{game_id}'
    if t == ActionType.PHASE_GATE_UNREADY:
        return f'phase_gate_unready_{game_id}'
    if t == ActionType.ACTIVATE_DC:
        return f'dc_activate_{game_id}_{player_num}_{dc_index}'
    if t == ActionType.END_TURN:
        return f'end_turn_{game_id}_{msg_id}'
    if t == ActionType.DC_END_ACTIVATION:
        return f'dc_end_activation_{msg_id}'
    if t == ActionType.PASS_ACTIVATION_TURN:
        return f'pass_activation_turn_{game_id}'
    if t == ActionType.END_ACTIVATION_PHASE:
        return f'status_phase_{game_id}'
    if t == ActionType.MOVE_FIGURE:
        return f'dc_move_{msg_id}_f{figure_index}'
    if t == ActionType.MOVE_MP:
        return f'move_mp_{params["moveKey"]}_{params["mp"]}'
    if t == ActionType.MOVE_PICK_SPACE:
        return f'move_pick_{params["moveKey"]}_{params["coord"]}'
    if t == ActionType.ATTACK_TARGET:
        return f'dc_attack_{msg_id}_f{figure_index}'
    if t == ActionType.COMBAT_READY:
        return f'combat_ready_{game_id}'
    if t == ActionType.COMBAT_GATE:
        return f'combat_gate_{game_id}'
    if t == ActionType.COMBAT_ROLL:
        return f'combat_roll_{game_id}'
    if t == ActionType.COMBAT_SURGE:
        return f'combat_surge_{game_id}_{params["surgeIndex"]}'
    if t == ActionType.COMBAT_REROLL:
        return f'combat_reroll_{game_id}_{params.get("side", "atk")}_{params["dieIndex"]}'
    if t == ActionType.COMBAT_RESOLVE:
        return f'combat_resolve_ready_{game_id}'
    if t == ActionType.DC_SPECIAL:
        return f'dc_special_{params["specialIdx"]}_{msg_id}'
    if t == ActionType.PLAY_CC_SPECIAL:
        return f'dc_cc_special_{msg_id}_{params["cardIndex"]}'
    if t == ActionType.PLAY_CC_DOUBLE:
        return f'dc_cc_double_{msg_id}_{params["cardIndex"]}'
    if t == ActionType.INTERACT:
        return f'interact_choice_{game_id}_{msg_id}_{figure_index}_{params["optionId"]}'
    if t == ActionType.DRAFT_RANDOM:
        return f'draft_random_{game_id}'
    if t == ActionType.DETERMINE_INITIATIVE:
        return f'determine_initiative_{game_id}'
    if t == ActionType.PICK_ZONE:
        return f'deployment_zone_{params["zone"]}_{game_id}'
    if t == ActionType.DEPLOY_FIGURE:
        return f'deployment_fig_{game_id}_{dc_index}'
    if t == ActionType.DEPLOY_DONE:
        return f'deployment_done_{game_id}'
    if t == ActionType.AUTO_DEPLOY:
        return f'auto_deploy_{game_id}'
    if t == ActionType.DRAW_CC:
        return f'cc_shuffle_draw_{game_id}'
    if t == ActionType.END_END_OF_ROUND:
        return f'end_end_of_round_{game_id}'
    if t == ActionType.END_START_OF_ROUND:
        return f'end_start_of_round_{game_id}'
    if t == ActionType.DC_ABILITY_CHOICE:
        return f'dc_ability_choice_{game_id}_{params["msgId"]}_{params["specialIdx"]}_{params["choiceIndex"]}'
    if t == ActionType.CELEBRATION_PLAY:
        return f'celebration_play_{game_id}'
    if t == ActionType.CELEBRATION_PASS:
        return f'celebration_pass_{game_id}'
    if t == ActionType.POUNCE_SPACE:
        return f'pounce_space_{game_id}_{params["msgId"]}_{params["figureIndex"]}_{params["space"]}'
    if t == ActionType.MISSILE_SALVO_DIE:
        return f'missile_salvo_die_{params["color"]}_{game_id}_{params["msgId"]}'
    if t == ActionType.MISSILE_SALVO_DONE:
        return f'missile_salvo_done_{game_id}_{params["msgId"]}'
    if t == ActionType.POWER_TOKEN_CHOICE:
        return f'power_token_choice_{game_id}_{params["tokenType"]}'
    if t == ActionType.COVER_FIRE_BLOCK:
        return f'cover_fire_block_{game_id}_{params["playerNum"]}_{params["figureKey"]}'
    if t == ActionType.COVER_FIRE_SKIP:
        return f'cover_fire_discard_skip_{game_id}'
    if t == ActionType.SPREAD_PAIN_COND:
        return f'spread_pain_cond_{game_id}_{params["condition"]}'
    if t == ActionType.STRAIN_CHOICE_ALLDMG:
        return f'strain_choice_alldmg_{game_id}'
    if t == ActionType.STRAIN_CHOICE_DISCARD:
        return f'strain_choice_discard_{game_id}_{params["discardCount"]}'
    if t == ActionType.RUSH_PUSH_FIG:
        return f'rush_push_fig_{game_id}_{msg_id}_{params["choiceIndex"]}'
    if t == ActionType.RUSH_PUSH_SKIP:
        return f'rush_push_skip_{game_id}_{msg_id}'
    if t == ActionType.SHOULDER_RUSH_FIG:
        return f'shoulder_rush_fig_{game_id}_{msg_id}_{params["choiceIndex"]}'
    if t == ActionType.SHOULDER_RUSH_SKIP:
        return f'shoulder_rush_skip_{game_id}_{msg_id}'
    if t == ActionType.FALSE_ORDERS_MOVE:
        return f'false_orders_action_{game_id}_{msg_id}_move'
    if t == ActionType.FALSE_ORDERS_ATTACK:
        return f'false_orders_action_{game_id}_{msg_id}_attack'
    if t == ActionType.FALSE_ORDERS_SKIP:
        return f'false_orders_action_{game_id}_{msg_id}_skip'
    if t == ActionType.CC_CONFIRM_PLAY:
        return f'cc_confirm_play_{game_id}'
    if t == ActionType.CC_CANCEL_PLAY:
        return f'cc_cancel_play_{game_id}'
    if t == ActionType.CC_CHOICE:
        return f'cc_choice_{game_id}_{params["choiceIndex"]}'
    if t == ActionType.CC_SPACE:
        return f'cc_space_{game_id}_{params["space"]}'
    if t == ActionType.OVERWATCH_SPACE:
        return f'overwatch_space_{game_id}_{msg_id}_{params["space"]}'
    if t == ActionType.OB_SPACE:
        return f'ob_space_{game_id}_{msg_id}_{params["space"]}'
    if t == ActionType.BOMB_DROP_SPACE:
        return f'bomb_drop_space_{game_id}_{msg_id}_{params["space"]}'
    if t == ActionType.COMM_DISRUPTION_PLAY:
        return f'comm_disruption_play_{game_id}'
    if t == ActionType.COMM_DISRUPTION_SKIP:
        return f'comm_disruption_skip_{game_id}'
    if t == ActionType.ARSENAL_PICK:
        return f'arsenal_pick_{game_id}_{msg_id}_{params["figureIndex"]}'
    if t == ActionType.EE3_PICK_DIE:
        return f'ee3_pick_die_{params["color"]}_{game_id}_{msg_id}_{params["figureIndex"]}'
    if t == ActionType.EE3_PICK_SKIP:
        return f'ee3_pick_die_skip_{game_id}_{msg_id}_{params["figureIndex"]}'
    if t == ActionType.BO_RIFLE_USE:
        return f'bo_rifle_pick_use_{game_id}_{msg_id}_{params["figureIndex"]}'
    if t == ActionType.BO_RIFLE_SKIP:
        return f'bo_rifle_pick_skip_{game_id}_{msg_id}_{params["figureIndex"]}'
    if t == ActionType.REFRESH_MAP:
        return f'refresh_map_{game_id}'
    if t == ActionType.UNDO:
        return f'undo_{game_id}'
    raise ValueError(f'Unknown action type: {t}')
