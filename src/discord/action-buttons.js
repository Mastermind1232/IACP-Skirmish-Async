/**
 * Convert available-actions output to Discord button components.
 * Pure function: game state in → ActionRow[] out. No Discord API calls.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ACTION_TYPES } from '../engine/action-types.js';
import { PHASES, ROUND_PHASES } from '../game/phase.js';

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5;       // Discord hard limit
const MAX_LABEL = 80;

// ── Action grouping ─────────────────────────────────────────────────────────

/** Logical groups for visual layout + button style. */
const GROUP_ORDER = ['setup', 'activation', 'movement', 'combat', 'special', 'cc', 'phase', 'misc'];

const TYPE_TO_GROUP = {
  // Setup
  [ACTION_TYPES.SELECT_MAP]: 'setup',
  [ACTION_TYPES.MAP_TYPE_CHOICE]: 'setup',
  [ACTION_TYPES.MAP_CONFIRM]: 'setup',
  [ACTION_TYPES.MAP_GO_BACK]: 'setup',
  [ACTION_TYPES.DRAFT_RANDOM]: 'setup',
  [ACTION_TYPES.DETERMINE_INITIATIVE]: 'setup',
  [ACTION_TYPES.PICK_ZONE]: 'setup',
  [ACTION_TYPES.DEPLOY_FIGURE]: 'setup',
  [ACTION_TYPES.DEPLOY_PICK]: 'setup',
  [ACTION_TYPES.DEPLOY_ROW]: 'setup',
  [ACTION_TYPES.DEPLOY_DONE]: 'setup',
  [ACTION_TYPES.CONFIRM_ATTACHMENT]: 'setup',
  [ACTION_TYPES.DRAW_CC]: 'setup',
  [ACTION_TYPES.SUBMIT_SQUAD]: 'setup',

  // Activation
  [ACTION_TYPES.ACTIVATE_DC]: 'activation',
  [ACTION_TYPES.END_TURN]: 'activation',
  [ACTION_TYPES.DC_END_ACTIVATION]: 'activation',
  [ACTION_TYPES.PASS_ACTIVATION_TURN]: 'activation',
  [ACTION_TYPES.END_ACTIVATION_PHASE]: 'activation',

  // Movement
  [ACTION_TYPES.MOVE_FIGURE]: 'movement',
  [ACTION_TYPES.MOVE_PICK_SPACE]: 'movement',
  [ACTION_TYPES.MOVE_MP]: 'movement',
  [ACTION_TYPES.MOVE_LETTER]: 'movement',

  // Combat
  [ACTION_TYPES.ATTACK_TARGET]: 'combat',
  [ACTION_TYPES.COMBAT_READY]: 'combat',
  [ACTION_TYPES.COMBAT_ROLL]: 'combat',
  [ACTION_TYPES.COMBAT_REROLL]: 'combat',
  [ACTION_TYPES.COMBAT_SURGE]: 'combat',
  [ACTION_TYPES.COMBAT_SKIP_SURGES]: 'combat',
  [ACTION_TYPES.COMBAT_RESOLVE]: 'combat',
  [ACTION_TYPES.COMBAT_PASSIVE]: 'combat',
  [ACTION_TYPES.COMBAT_TOKEN]: 'combat',

  // Special / DC abilities
  [ACTION_TYPES.DC_ACTION]: 'special',
  [ACTION_TYPES.SPECIAL_ACTION]: 'special',
  [ACTION_TYPES.DC_SPECIAL]: 'special',
  [ACTION_TYPES.INTERACT]: 'special',

  // CC
  [ACTION_TYPES.PLAY_CC]: 'cc',
  [ACTION_TYPES.CC_DRAW]: 'cc',

  // Phase transitions
  [ACTION_TYPES.PHASE_GATE_READY]: 'phase',
  [ACTION_TYPES.PHASE_GATE_UNREADY]: 'phase',
  [ACTION_TYPES.END_ROUND_PASS]: 'phase',
  [ACTION_TYPES.END_START_OF_ROUND]: 'phase',
  [ACTION_TYPES.END_END_OF_ROUND]: 'phase',

  // Pending sub-states
  [ACTION_TYPES.DC_ABILITY_CHOICE]: 'special',
  [ACTION_TYPES.CELEBRATION_PLAY]: 'cc',
  [ACTION_TYPES.CELEBRATION_PASS]: 'cc',
  [ACTION_TYPES.POUNCE_SPACE]: 'movement',
  [ACTION_TYPES.MISSILE_SALVO_DIE]: 'combat',
  [ACTION_TYPES.MISSILE_SALVO_DONE]: 'combat',
  [ACTION_TYPES.POWER_TOKEN_CHOICE]: 'special',
  [ACTION_TYPES.COVER_FIRE_BLOCK]: 'combat',
  [ACTION_TYPES.COVER_FIRE_SKIP]: 'combat',
  [ACTION_TYPES.SPREAD_PAIN_COND]: 'special',
  [ACTION_TYPES.STRAIN_CHOICE_ALLDMG]: 'special',
  [ACTION_TYPES.STRAIN_CHOICE_DISCARD]: 'special',

  // Misc
  [ACTION_TYPES.REFRESH_MAP]: 'misc',
  [ACTION_TYPES.UNDO]: 'misc',
};

const GROUP_STYLE = {
  setup: ButtonStyle.Success,
  activation: ButtonStyle.Primary,
  movement: ButtonStyle.Secondary,
  combat: ButtonStyle.Danger,
  special: ButtonStyle.Primary,
  cc: ButtonStyle.Secondary,
  phase: ButtonStyle.Success,
  misc: ButtonStyle.Secondary,
};

/**
 * Group an array of actions by logical group.
 * @param {Array<{type, customId, description}>} actions
 * @returns {Map<string, Array>} group name → actions
 */
export function groupActions(actions) {
  const groups = new Map();
  for (const action of actions) {
    const group = TYPE_TO_GROUP[action.type] || 'misc';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(action);
  }
  return groups;
}

// ── Button building ─────────────────────────────────────────────────────────

function truncLabel(text) {
  if (!text) return '???';
  return text.length <= MAX_LABEL ? text : text.slice(0, MAX_LABEL - 1) + '\u2026';
}

/**
 * Convert available actions into Discord ActionRow[] ready for a message payload.
 * Respects Discord limits (5 buttons/row, 5 rows/message).
 *
 * @param {Array<{type, customId, description, params?}>} actions - from getAvailableActions()
 * @param {object} [opts]
 * @param {boolean} [opts.includeRefresh] - append a Refresh Map button
 * @param {string}  [opts.gameId] - needed for refresh button
 * @returns {ActionRowBuilder[]}
 */
export function actionsToButtons(actions, opts = {}) {
  if (!actions?.length && !opts.includeRefresh) return [];

  const buttons = [];

  // Build buttons in group order for consistent layout
  const groups = groupActions(actions);
  for (const groupName of GROUP_ORDER) {
    const groupActions = groups.get(groupName);
    if (!groupActions?.length) continue;
    const style = GROUP_STYLE[groupName] || ButtonStyle.Secondary;
    for (const action of groupActions) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(action.customId)
          .setLabel(truncLabel(action.description))
          .setStyle(style)
      );
    }
  }

  // Optional refresh button at the end
  if (opts.includeRefresh && opts.gameId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`refresh_map_${opts.gameId}`)
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  // Chunk into ActionRows (max 5 buttons per row, max 5 rows)
  const rows = [];
  for (let i = 0; i < buttons.length && rows.length < MAX_ROWS; i += MAX_BUTTONS_PER_ROW) {
    const slice = buttons.slice(i, i + MAX_BUTTONS_PER_ROW);
    rows.push(new ActionRowBuilder().addComponents(...slice));
  }
  return rows;
}

// ── Context description ─────────────────────────────────────────────────────

/**
 * Build a human-readable context string for the current game state.
 * Tells the player what's happening and what they should do.
 *
 * @param {object} game
 * @param {number} playerNum - 1 or 2
 * @returns {string}
 */
export function describeContext(game, playerNum) {
  if (!game) return 'No game state.';
  if (game.ended) return 'Game over.';

  // Phase gate (sequential: only activePlayer can ack)
  if (game.phaseGate) {
    const gate = game.phaseGate;
    const acked = gate.acked || {};
    const isReady = Boolean(acked[playerNum]);
    const otherPn = playerNum === 1 ? 2 : 1;
    const otherReady = Boolean(acked[otherPn]);
    const isActive = gate.activePlayer === playerNum;
    if (isReady && otherReady) return `Both players ready for ${gate.phase}.`;
    if (isReady) return `Waiting for opponent to ready up for ${gate.phase}.`;
    if (isActive) return `Ready up for ${gate.phase}.`;
    return `Waiting for opponent to confirm ${gate.phase} first.`;
  }

  switch (game.phase) {
    case PHASES.LOBBY:
      return 'Waiting for players to join.';

    case PHASES.MAP_SELECTION:
      return 'Select a map.';

    case PHASES.INITIATIVE:
      return 'Roll for initiative.';

    case PHASES.ZONE_SELECTION:
      return 'Choose your deployment zone.';

    case PHASES.DEPLOYMENT:
      return 'Deploy your figures to the map.';

    case PHASES.ATTACHMENT:
      return 'Confirm skirmish upgrade attachments.';

    case PHASES.CC_DRAW:
      return 'Draw your starting command cards.';

    case PHASES.ROUND_ACTIVE:
      return describeRoundContext(game, playerNum);

    case PHASES.ENDED:
      return 'Game over.';

    default:
      return 'Waiting...';
  }
}

function describeRoundContext(game, playerNum) {
  const round = game.roundNumber || 1;
  const prefix = `Round ${round}`;

  // Pending states take priority
  if (game.pendingCombat) {
    const combat = game.pendingCombat;
    if (combat.phase === 'surges') return `${prefix} — Assign surge abilities.`;
    if (combat.phase === 'rerolls') return `${prefix} — Choose dice to reroll.`;
    if (combat.phase === 'resolve') return `${prefix} — Resolve combat.`;
    return `${prefix} — Combat in progress.`;
  }

  if (game.pendingNegation) return `${prefix} — Respond to command card (negate?).`;
  if (game.pendingStrainChoice) return `${prefix} — Choose: suffer damage or discard cards.`;
  if (game.pendingPowerTokenChoice) return `${prefix} — Choose a power token type.`;
  if (game.pendingCoverFire) return `${prefix} — Choose a figure to block with Cover Fire.`;
  if (game.pendingCelebration) return `${prefix} — Play Celebration or pass.`;
  if (game.pendingPounce) return `${prefix} — Choose a space for Pounce.`;
  if (game.pendingMissileSalvo) return `${prefix} — Choose dice for Missile Salvo.`;
  if (game.pendingSpreadPain) return `${prefix} — Choose a condition for Spread the Pain.`;

  // Round sub-phases
  switch (game.roundPhase) {
    case ROUND_PHASES.START_OF_ROUND:
      return `${prefix} — Start of round effects.`;

    case ROUND_PHASES.ACTIVATION: {
      if (game.activeActivation) {
        const dcName = game.activeActivation.dcName || 'a figure';
        return `${prefix} — Activating ${dcName}. Choose an action.`;
      }
      return `${prefix} — Choose a deployment card to activate.`;
    }

    case ROUND_PHASES.END_OF_ROUND:
      return `${prefix} — End of round.`;

    default:
      return `${prefix} — Your turn.`;
  }
}
