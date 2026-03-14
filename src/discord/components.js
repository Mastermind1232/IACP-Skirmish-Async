import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { normalizeCoord, bottomLeftCoord } from '../game/coords.js';
import { getDcList, getActivatedDcIndices, getPlayerId, getActivationsRemaining, opponentPlayerNum } from '../game/player-helpers.js';
import { isDcCompanion } from '../data-loader.js';

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS_PER_MESSAGE = 5;
const MAX_LABEL_LENGTH = 80;

/**
 * Group an array of space coordinate strings (e.g. 'a3', 'b12') by their numeric row suffix.
 * @param {string[]} spaces
 * @returns {{ byRow: Record<number, string[]>, sortedRows: number[] }}
 */
function groupSpacesByRow(spaces) {
  const byRow = {};
  for (const s of spaces) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!byRow[row]) byRow[row] = [];
    byRow[row].push(s);
  }
  const sortedRows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
  return { byRow, sortedRows };
}

/** Discord button label limit (2.5). Truncate to max chars; default 80. */
export function truncateLabel(s, max = MAX_LABEL_LENGTH) {
  if (s == null) return '';
  const str = String(s);
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/** Truncate a label with a fixed prefix, ensuring the name portion gets an ellipsis if needed. */
function _truncLabel(prefix, name, max = MAX_LABEL_LENGTH) {
  const full = `${prefix}${name}`;
  if (full.length <= max) return full;
  const maxName = max - prefix.length - 1; // -1 for ellipsis
  return `${prefix}${name.slice(0, maxName)}…`;
}

/**
 * Area-based button styles per plan 2.5: combat=red, confirm=green, cancel=grey, etc.
 * @param {string} area - 'attack'|'confirm'|'cancel'|'destructive'|'setup'|'movement'|'surge'|'interact'|'primary'|'secondary'
 */
export function getButtonStyle(area) {
  switch (area) {
    case 'attack':
    case 'destructive':
      return ButtonStyle.Danger;
    case 'confirm':
    case 'setup':
      return ButtonStyle.Success;
    case 'cancel':
    case 'movement':
    case 'interact':
    case 'surge':
      return ButtonStyle.Secondary;
    case 'primary':
      return ButtonStyle.Primary;
    case 'secondary':
    default:
      return ButtonStyle.Secondary;
  }
}

/**
 * Chunk an array of button components into ActionRows with at most maxPerRow buttons per row.
 * Enforces Discord limit of 5 buttons per row and 5 rows per message.
 * @param {import('discord.js').ButtonBuilder[]} components
 * @param {number} [maxPerRow=5]
 */
export function chunkButtonsToRows(components, maxPerRow = MAX_BUTTONS_PER_ROW) {
  const capped = Math.min(maxPerRow, MAX_BUTTONS_PER_ROW);
  const rows = [];
  for (let r = 0; r < components.length && rows.length < MAX_ROWS_PER_MESSAGE; r += capped) {
    const slice = components.slice(r, r + capped);
    rows.push(new ActionRowBuilder().addComponents(...slice));
  }
  return rows;
}

/** Search (blue) and Close (red) buttons for discard pile. */
export function getDiscardPileButtons(gameId, playerNum, hasOpenThread) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_search_discard_${gameId}_${playerNum}`)
      .setLabel('Search Discard Pile')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`cc_close_discard_${gameId}_${playerNum}`)
      .setLabel('Close Discard Pile')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasOpenThread)
  );
}

/** Exhaust/Ready row for a DC message in Play Area. */
export function getDcToggleButton(msgId, exhausted, game = null) {
  if (exhausted) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dc_unactivate_${msgId}`)
        .setLabel('Un-activate')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`dc_toggle_${msgId}`)
        .setLabel('Ready')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dc_end_activation_${msgId}`)
        .setLabel('End Activation')
        .setStyle(ButtonStyle.Danger)
    );
  }
  const bothDrawn = game && game.player1CcDrawn && game.player2CcDrawn;
  if (!bothDrawn) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dc_toggle_${msgId}`)
      .setLabel('Activate')
      .setStyle(ButtonStyle.Success)
  );
}

/**
 * Component rows for a DC message in Play Area: Exhaust/Activate row, then optional Deplete row.
 * @param {string} msgId
 * @param {boolean} exhausted
 * @param {object} game
 * @param {string} dcName
 * @param {{ isDepletedRemovedFromGame: (game, msgId) => boolean, hasDepleteEffect: (dcName) => boolean, hasExhaustEffect: (dcName) => boolean, isFigurelessDc: (dcName) => boolean }} helpers
 */
export function getDcPlayAreaComponents(msgId, exhausted, game, dcName, helpers = {}) {
  const { isDepletedRemovedFromGame = () => false, hasDepleteEffect = () => false, hasExhaustEffect = () => false, isFigurelessDc = () => false, getDcStats, gameStarted } = helpers;
  if (game && isDepletedRemovedFromGame(game, msgId)) return [];
  const figureless = isFigurelessDc(dcName);
  let toggleRow;
  if (figureless) {
    // Skirmish upgrades: no Activate button. Show Exhaust/Ready only if card has an exhaust effect.
    if (hasExhaustEffect(dcName)) {
      const bothDrawn = game && game.player1CcDrawn && game.player2CcDrawn;
      if (exhausted) {
        toggleRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dc_toggle_${msgId}`)
            .setLabel('Ready')
            .setStyle(ButtonStyle.Success)
        );
      } else if (bothDrawn) {
        toggleRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dc_toggle_${msgId}`)
            .setLabel('Exhaust')
            .setStyle(ButtonStyle.Secondary)
        );
      }
    }
    // else: no toggle row for figureless cards without exhaust
  } else {
    toggleRow = getDcToggleButton(msgId, exhausted, game);
  }
  const rows = toggleRow ? [toggleRow] : [];
  if (hasDepleteEffect(dcName)) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dc_deplete_${msgId}`)
          .setLabel('Deplete')
          .setStyle(ButtonStyle.Primary)
      )
    );
  }
  if (getDcStats && !gameStarted) {
    const stats = getDcStats(dcName);
    if (stats && stats.figures > 1) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dc_rename_${msgId}`)
            .setLabel('Rename Figures')
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }
  }
  return rows;
}

/** Figure index suffix letters for multi-figure DCs (e.g. 1a, 1b). */
export const FIGURE_LETTERS = 'abcdefghij';

export function getUndoButton(gameId, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(`undo_${gameId}`)
    .setLabel('UNDO')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

/**
 * @param {string} gameId
 * @param {{ game?: object }} [opts]
 * @returns {import('discord.js').ActionRowBuilder[]} Array of action rows (1 main row + optional fast-forward row)
 */
export function getBoardButtons(gameId, opts = {}) {
  const game = opts.game;
  const undoDisabled = !!game?.ended;
  const mainRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_map_${gameId}`)
      .setLabel('Refresh Map')
      .setStyle(ButtonStyle.Primary),
    getUndoButton(gameId, undoDisabled),
    new ButtonBuilder()
      .setCustomId(`ping_active_${gameId}`)
      .setLabel('Ping Active Player')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔔'),
  );
  const rows = [mainRow];
  if (game?.isTestGame && game?.testP2IsBot && !game?.ended) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fast_forward_${gameId}`)
        .setLabel('⏩ Fast Forward')
        .setStyle(ButtonStyle.Success)
    ));
  }
  return rows;
}

/** F17: One row with 4 map-type buttons (Competitive / Random / Select Draw / Selection). */
export function getMapTypeButtons(gameId, selectedType = null) {
  const types = [
    { id: 'competitive', label: 'Competitive' },
    { id: 'random', label: 'Random' },
    { id: 'select_draw', label: 'Select Draw' },
    { id: 'selection', label: 'Selection' },
  ];
  return new ActionRowBuilder().addComponents(
    ...types.map((t) =>
      new ButtonBuilder()
        .setCustomId(`map_type_${t.id}_${gameId}`)
        .setLabel(t.label)
        .setStyle(t.id === selectedType ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

export function getMapConfirmButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`map_confirm_${gameId}`)
      .setLabel('Confirm Selection')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`map_goback_${gameId}`)
      .setLabel('Go Back')
      .setStyle(ButtonStyle.Secondary),
  );
}

const MISSION_SELECT_MAX_OPTIONS = 25;

/**
 * F17 Select Draw: multi-select menu of missions (min 2, then random draw).
 * @param {string} gameId
 * @param {{ value: string, label: string }[]} options - from buildPlayableMissionOptions
 */
export function getMissionSelectDrawMenu(gameId, options) {
  const opts = options.slice(0, MISSION_SELECT_MAX_OPTIONS);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`map_selection_draw_${gameId}`)
    .setPlaceholder('Choose at least 2 missions (we\'ll pick one at random)')
    .setMinValues(2)
    .setMaxValues(Math.max(2, opts.length))
    .addOptions(opts.map((o) => ({ label: o.label, value: o.value })));
  return new ActionRowBuilder().addComponents(select);
}

/**
 * F17 Selection: single-select menu of missions.
 * @param {string} gameId
 * @param {{ value: string, label: string }[]} options - from buildPlayableMissionOptions
 */
export function getMissionSelectionPickMenu(gameId, options, selectedValue) {
  const opts = options.slice(0, MISSION_SELECT_MAX_OPTIONS);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`map_selection_pick_${gameId}`)
    .setPlaceholder('Choose one mission')
    .addOptions(opts.map((o) => ({ label: o.label, value: o.value, default: selectedValue ? o.value === selectedValue : false })));
  return new ActionRowBuilder().addComponents(select);
}

/** F16/F11: Bot Stuff menu — Kill Game + Refresh All (shown via /botmenu in Game Log). */
export function getBotmenuButtons(gameId, { showForfeit = false } = {}) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`refresh_all_${gameId}`)
      .setLabel('Refresh All')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`botmenu_recover_${gameId}`)
      .setLabel('Recover')
      .setStyle(ButtonStyle.Secondary),
  ];
  if (showForfeit) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`forfeit_${gameId}`)
        .setLabel('Forfeit')
        .setStyle(ButtonStyle.Danger)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`botmenu_kill_${gameId}`)
      .setLabel('Kill Game')
      .setStyle(ButtonStyle.Danger)
  );
  return new ActionRowBuilder().addComponents(buttons);
}

/** Confirm forfeit: requires confirmation before ending game. */
export function getForfeitConfirmButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`forfeit_yes_${gameId}`)
      .setLabel('Yes, I forfeit')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`forfeit_no_${gameId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Confirm Kill Game: first confirm wins. */
export function getBotmenuKillConfirmButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`botmenu_kill_yes_${gameId}`)
      .setLabel('Yes, kill game')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`botmenu_kill_no_${gameId}`)
      .setLabel('No')
      .setStyle(ButtonStyle.Secondary)
  );
}

/** One row: Map Selection (if not yet selected). Draft Random when test game. Kill Game removed (F16: only via /botmenu). */
export function getGeneralSetupButtons(game) {
  const draftBtn = new ButtonBuilder()
    .setCustomId(`draft_random_${game.gameId}`)
    .setLabel('Draft Random')
    .setStyle(ButtonStyle.Secondary);
  const components = [];
  if (!game.mapSelected) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`map_selection_${game.gameId}`)
        .setLabel('MAP SELECTION')
        .setStyle(ButtonStyle.Success)
    );
  }
  if (game.isTestGame && !game.mapSelected && !game.draftRandomUsed && !game.initiativeDetermined) {
    components.push(draftBtn);
  }
  return new ActionRowBuilder().addComponents(...components);
}

/** Determine Initiative for the Both Squads Ready message. Kill Game removed (F16: only via /botmenu). */
export function getDetermineInitiativeButtons(game) {
  const components = [];
  if (!game.initiativeDetermined) {
    components.push(
      new ButtonBuilder()
        .setCustomId(`determine_initiative_${game.gameId}`)
        .setLabel('Determine Initiative')
        .setStyle(ButtonStyle.Primary)
    );
  }
  return new ActionRowBuilder().addComponents(...components);
}

export function getDeploymentZoneButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_zone_red_${gameId}`)
      .setLabel('Red Zone')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`deployment_zone_blue_${gameId}`)
      .setLabel('Blue Zone')
      .setStyle(ButtonStyle.Primary)
  );
}

export function getDeploymentDoneButton(gameId, playerNum) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_done_${gameId}`)
      .setLabel('Deployment Completed')
      .setStyle(ButtonStyle.Success),
  );
  if (playerNum != null) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`auto_deploy_${gameId}_${playerNum}`)
        .setLabel('Auto-Deploy')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

export function getMainMenu() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_game')
      .setLabel('Create Game')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('join_game')
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function getLobbyJoinButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join_${threadId}`)
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Success),
  );
}

export function getLobbyStartButton(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_start_${threadId}`)
      .setLabel('Start Game')
      .setStyle(ButtonStyle.Primary),
  );
}

export function getCcShuffleDrawButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_shuffle_draw_${gameId}`)
      .setLabel('Shuffle deck and draw starting 3 Command Cards')
      .setStyle(ButtonStyle.Success),
  );
}

/** Play CC (green), Draw CC (green), Discard CC (red). Pass hand/deck to disable when empty. */
export function getCcActionButtons(gameId, hand = [], deck = []) {
  const hasHand = (hand || []).length > 0;
  const hasDeck = (deck || []).length > 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cc_play_${gameId}`)
      .setLabel('Play CC')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasHand),
    new ButtonBuilder()
      .setCustomId(`cc_draw_${gameId}`)
      .setLabel('Draw CC')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasDeck),
    new ButtonBuilder()
      .setCustomId(`cc_discard_${gameId}`)
      .setLabel('Discard CC')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasHand),
  );
}

/** Buttons for Negation response: Play Negation / Let it resolve. */
export function getNegationResponseButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`negation_play_${gameId}`)
      .setLabel('Play Negation')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`negation_let_resolve_${gameId}`)
      .setLabel('Let it resolve')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Buttons for Celebration: Play Celebration / Pass. */
export function getCelebrationButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`celebration_play_${gameId}`)
      .setLabel('Play Celebration (+4 VP)')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`celebration_pass_${gameId}`)
      .setLabel('Pass')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Buttons for "bot thinks this CC play is illegal" prompt: Ignore and play / Unplay card. */
export function getIllegalCcPlayButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`illegal_cc_ignore_${gameId}`)
      .setLabel('Ignore and play')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`illegal_cc_unplay_${gameId}`)
      .setLabel('Unplay card')
      .setStyle(ButtonStyle.Danger),
  );
}

export function getSelectSquadButton(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary),
  );
}

/** Select Squad button for hand thread (alias). */
export const getHandSquadButtons = getSelectSquadButton;

export function getKillGameButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`kill_game_${gameId}`)
      .setLabel('Kill Game (testing)')
      .setStyle(ButtonStyle.Danger),
  );
}

/** IMPLEMENTED / REJECTED buttons for bot-requests or bot-feedback-and-requests forum posts. */
export function getRequestActionButtons(threadId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`request_resolve_${threadId}`)
      .setLabel('IMPLEMENTED')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`request_reject_${threadId}`)
      .setLabel('REJECTED')
      .setStyle(ButtonStyle.Danger),
  );
}

/** F6 Cleave: one row per 5 targets, buttons labeled by target. customId: cleave_target_${gameId}_${index}. */
export function getCleaveTargetButtons(gameId, targets) {
  if (!targets?.length) return [];
  const rows = [];
  for (let i = 0; i < targets.length; i += MAX_BUTTONS_PER_ROW) {
    const slice = targets.slice(i, i + MAX_BUTTONS_PER_ROW);
    rows.push(
      new ActionRowBuilder().addComponents(
        slice.map((t, j) => {
          const idx = i + j;
          return new ButtonBuilder()
            .setCustomId(`cleave_target_${gameId}_${idx}`)
            .setLabel((t.label || t.figureKey || `Target ${idx + 1}`).slice(0, 80))
            .setStyle(ButtonStyle.Danger);
        })
      )
    );
  }
  return rows.slice(0, MAX_ROWS_PER_MESSAGE);
}

/** Fighting Knife: target buttons + Skip. customId: fighting_knife_target_${gameId}_${index}. */
export function getFightingKnifeTargetButtons(gameId, targets) {
  if (!targets?.length) return [];
  const allBtns = targets.map((t, i) =>
    new ButtonBuilder()
      .setCustomId(`fighting_knife_target_${gameId}_${i}`)
      .setLabel((t.label || t.figureKey || `Target ${i + 1}`).slice(0, 80))
      .setStyle(ButtonStyle.Danger)
  );
  allBtns.push(new ButtonBuilder().setCustomId(`fighting_knife_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  const rows = [];
  for (let i = 0; i < allBtns.length; i += MAX_BUTTONS_PER_ROW) {
    rows.push(new ActionRowBuilder().addComponents(allBtns.slice(i, i + MAX_BUTTONS_PER_ROW)));
  }
  return rows.slice(0, MAX_ROWS_PER_MESSAGE);
}

/** Action rows for MP selection: move_mp_${msgId}_${figureIndex}_${mp}. */
export function getMoveMpButtonRows(msgId, figureIndex, mpRemaining) {
  if (!mpRemaining || mpRemaining < 1) return [];
  const btns = [];
  for (let mp = 1; mp <= mpRemaining; mp++) {
    btns.push(
      new ButtonBuilder()
        .setCustomId(`move_mp_${msgId}_${figureIndex}_${mp}`)
        .setLabel(`${mp} MP`)
        .setStyle(ButtonStyle.Primary)
    );
  }
  const rows = [];
  for (let r = 0; r < btns.length && rows.length < MAX_ROWS_PER_MESSAGE; r += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  }
  return rows;
}

/** Action rows for two-tier movement column picker: move_letter_${msgId}_${figureIndex}_${letter}. */
export function buildLetterRows(cells, msgId, figureIndex) {
  const counts = {};
  for (const c of cells) {
    const letter = c.match(/^([a-z]+)/)?.[1] ?? c[0];
    counts[letter] = (counts[letter] || 0) + 1;
  }
  const letters = Object.keys(counts).sort();
  const btns = letters.map((letter) =>
    new ButtonBuilder()
      .setCustomId(`move_letter_${msgId}_${figureIndex}_${letter}`)
      .setLabel(letter.toUpperCase())
      .setStyle(ButtonStyle.Primary)
  );
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  }
  return rows;
}

/** Action rows for movement space selection: move_pick_${msgId}_${figureIndex}_${space}. */
export function getMoveSpaceGridRows(msgId, figureIndex, validSpaces, mapSpaces, size = '1x1') {
  // Build a labelMap so buttons show bottom-left corner of each placement instead of top-left.
  const labelMap = {};
  if (size && size !== '1x1') {
    for (const space of validSpaces) {
      const norm = normalizeCoord(space);
      labelMap[norm] = bottomLeftCoord(norm, size).toUpperCase();
    }
  }
  // Pass Infinity so all reachable cells get buttons; overflow is sent across multiple messages in movement.js
  return getSpaceChoiceRows(`move_pick_${msgId}_${figureIndex}_`, validSpaces, mapSpaces, Infinity, labelMap);
}

/**
 * Generic space choice rows (reusable for CC/DC "pick a space").
 * Buttons: ${customIdPrefix}${space}. Returns { rows, available }.
 */
export function getSpaceChoiceRows(customIdPrefix, validSpaces, mapSpaces, maxRows = MAX_ROWS_PER_MESSAGE, labelMap = {}) {
  const available = (validSpaces || []).map((s) => normalizeCoord(s));
  const orderMap = new Map(
    (mapSpaces?.spaces || []).map((coord, idx) => [normalizeCoord(coord), idx])
  );
  available.sort((a, b) => {
    const diff = (orderMap.get(a) ?? Infinity) - (orderMap.get(b) ?? Infinity);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
  const { byRow } = groupSpacesByRow(available);
  // Preserve insertion order (map-space index sort) rather than numeric row sort
  const rowOrder = [];
  for (const s of available) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!rowOrder.includes(row)) rowOrder.push(row);
  }
  const rows = [];
  for (const rowNum of rowOrder) {
    const tiles = byRow[rowNum] || [];
    for (let i = 0; i < tiles.length; i += 5) {
      const chunk = tiles.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder().addComponents(
          chunk.map((space) =>
            new ButtonBuilder()
              .setCustomId(`${customIdPrefix}${space}`)
              .setLabel(labelMap[space] || space.toUpperCase())
              .setStyle(ButtonStyle.Success)
          )
        )
      );
    }
  }
  const sliced = rows.slice(0, maxRows);
  return { rows: sliced, available, overflowed: rows.length > maxRows };
}

/**
 * Build a StringSelectMenu dropdown for space selection when buttons overflow (>25 spaces).
 * The select menu customId is `${selectPrefix}${contextSuffix}` and each option value is the space coordinate.
 * @param {string} selectPrefix - e.g. 'overwatch_space_sel_'
 * @param {string} contextSuffix - e.g. `${gameId}_${msgId}`
 * @param {string[]} available - normalized space coordinates
 * @param {Record<string, string>} [labelMap] - optional display label overrides
 * @returns {ActionRowBuilder}
 */
export function buildSpaceSelectMenu(selectPrefix, contextSuffix, available, labelMap = {}) {
  const options = available.slice(0, 25).map((space) => ({
    label: (labelMap[space] || space).toUpperCase(),
    value: space,
  }));
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${selectPrefix}${contextSuffix}`)
    .setPlaceholder('Pick a space…')
    .addOptions(options);
  return new ActionRowBuilder().addComponents(select);
}

/** Per-figure deploy labels; helpers = { resolveDcName, isFigurelessDc, getDcStats, getNickname }. */
export function getDeployFigureLabels(dcList, helpers = {}) {
  const { resolveDcName = (d) => (typeof d === 'object' ? d?.dcName || d?.displayName : d), isFigurelessDc = () => false, getDcStats = () => ({ figures: 1 }), getNickname = () => null } = helpers;
  if (!dcList?.length) return { labels: [], metadata: [] };
  const figureDcs = dcList.map(resolveDcName).filter((n) => n && !isFigurelessDc(n));
  const totals = {};
  const counts = {};
  for (const d of figureDcs) totals[d] = (totals[d] || 0) + 1;
  const labels = [];
  const metadata = [];
  for (let i = 0; i < figureDcs.length; i++) {
    const dcName = figureDcs[i];
    counts[dcName] = (counts[dcName] || 0) + 1;
    const dgIndex = counts[dcName];
    const displayName = totals[dcName] > 1 ? `${dcName} [DG ${dgIndex}]` : dcName;
    const baseName = displayName.replace(/\s*\[(?:DG|Group) \d+\]$/, '');
    const figures = getDcStats(dcName).figures ?? 1;
    if (figures <= 1) {
      labels.push(`Deploy ${displayName}`);
      metadata.push({ dcName, dgIndex, figureIndex: 0 });
    } else {
      for (let f = 0; f < figures; f++) {
        const nick = getNickname(dcName, dgIndex, f);
        const nickSuffix = nick ? ` (${nick})` : '';
        const rawLabel = `Deploy ${baseName} ${dgIndex}${FIGURE_LETTERS[f]}${nickSuffix}`;
        labels.push(rawLabel.length > 80 ? rawLabel.slice(0, 77) + '...' : rawLabel);
        metadata.push({ dcName, dgIndex, figureIndex: f });
      }
    }
  }
  return { labels, metadata };
}

/** Deploy button rows + done row; helpers = { resolveDcName, isFigurelessDc, getDcStats }. */
export function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions, helpers = {}) {
  const { labels, metadata } = getDeployFigureLabels(dcList, helpers);
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const pos = figurePositions?.[playerNum] || {};
  const deployRows = [];
  for (let i = 0; i < labels.length; i++) {
    const meta = metadata[i];
    const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
    const space = pos[figureKey];
    const displaySpace = space ? space.toUpperCase() : '';
    const label = space
      ? `${labels[i]} (Location: ${displaySpace})`.slice(0, 80)
      : labels[i].slice(0, 80);
    deployRows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`deployment_fig_${gameId}_${playerNum}_${i}`)
          .setLabel(label)
          .setStyle(space ? ButtonStyle.Secondary : zoneStyle)
      )
    );
  }
  const doneRow = getDeploymentDoneButton(gameId, playerNum);
  return { deployRows, doneRow };
}

/** Action rows of deploy space buttons (deploy_pick_...) grouped by map row. Returns ALL rows (caller handles overflow). */
export function getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, occupiedSpaces, zone) {
  const occupied = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const available = (validSpaces || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => !occupied.has(s));
  const { byRow, sortedRows } = groupSpacesByRow(available);
  for (const r of sortedRows) {
    byRow[r].sort((a, b) => (a || '').localeCompare(b || ''));
  }
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const rows = [];
  for (const rowNum of sortedRows) {
    const tiles = byRow[rowNum];
    for (let i = 0; i < tiles.length; i += 5) {
      const chunk = tiles.slice(i, i + 5);
      rows.push(
        new ActionRowBuilder().addComponents(
          chunk.map((space) =>
            new ButtonBuilder()
              .setCustomId(`deploy_pick_${gameId}_${playerNum}_${flatIndex}_${space}`)
              .setLabel(space.toUpperCase())
              .setStyle(zoneStyle)
          )
        )
      );
    }
  }
  return { rows, available };
}

/** Two-tier deploy row picker: deploy_row_{gameId}_{playerNum}_{flatIndex}_{rowNum}. Used when zone has >5 action rows. */
export function buildDeployRowButtons(gameId, playerNum, flatIndex, validSpaces, occupiedSpaces, zone) {
  const occupied = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const available = (validSpaces || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => !occupied.has(s));
  const { sortedRows } = groupSpacesByRow(available);
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const btns = sortedRows.map((rowNum) =>
    new ButtonBuilder()
      .setCustomId(`deploy_row_${gameId}_${playerNum}_${flatIndex}_${rowNum}`)
      .setLabel(`Row ${rowNum}`)
      .setStyle(zoneStyle)
  );
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  }
  return { rows: rows.slice(0, MAX_ROWS_PER_MESSAGE), available };
}

/** Get special actions injected by Skirmish Upgrade attachments. */
export function getAttachmentSpecials(attachments, game, msgId) {
  const names = [];
  const costs = [];
  if (!attachments?.length) return { names, costs };
  if (attachments.includes("Vader's Finest")) {
    names.push('VF: Attack+Move');
    costs.push(1);
    names.push('VF: Focus');
    costs.push(1);
  }
  if (attachments.includes("Smuggler's Run")) {
    names.push("Smuggler's Run");
    costs.push(1);
  }
  if (attachments.includes('Z-6 Trooper')) {
    names.push('Autofire');
    costs.push(1);
  }
  if (attachments.includes('Mortar Trooper')) {
    names.push('Fire Mission');
    costs.push(2);
  }
  if (attachments.includes('The Darksaber')) {
    names.push('Darksaber Strike');
    costs.push(1);
  }
  if (attachments.includes('Orbital Bombardment')) {
    names.push('OB: Place Tokens');
    costs.push(1);
  }
  if (attachments.includes('Overwatch')) {
    names.push('OW: Place Token');
    costs.push(1);
  }
  return { names, costs };
}

/**
 * Action rows for DC: figure dropdown (multi-fig) + [Move][Attack][Interact] for selected figure, then specials, then CC specials. Max 5 rows.
 * @param {object} [helpers] - { getDcStats(dcName), getPlayerNumForMsgId(msgId), getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName) }
 */
export function getDcActionButtons(msgId, dcName, displayName, actionsDataOrRemaining = 2, game = null, helpers = {}) {
  const { getDcStats = () => ({}), getPlayerNumForMsgId = () => 1, getPlayableCcSpecialsForDc = () => [], getPlayableCcEndOfActivationForDc = () => [], getPlayableCcDoubleActionsForDc = () => [] } = helpers;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  let specials = stats.specials || [];
  let specialCosts = stats.specialCosts || [];
  // Skirmish Upgrade attachments may remove DC specials (e.g. Driven by Hatred removes Brutality)
  const _suUpgrades = game ? (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []) : [];
  if (_suUpgrades.length) {
    const _lostSpecials = new Set();
    if (_suUpgrades.includes('Driven by Hatred')) _lostSpecials.add('Brutality');
    if (_lostSpecials.size) {
      const _filteredPairs = specials.map((s, i) => [s, specialCosts[i] ?? 1]).filter(([s]) => !_lostSpecials.has(s));
      specials = _filteredPairs.map(([s]) => s);
      specialCosts = _filteredPairs.map(([, c]) => c);
    }
    // Inject attachment-provided special actions
    const injected = getAttachmentSpecials(_suUpgrades, game, msgId);
    if (injected.names.length) {
      specials = [...specials, ...injected.names];
      specialCosts = [...specialCosts, ...injected.costs];
    }
  }
  // Bomb Drop (Hoth Battle Station B): inject special action if figure is carrying explosive
  if (game?.selectedMission?.mechanics?.type === 'carry' && game?.selectedMission?.name === 'Bomb Drop') {
    const _bdDgIdx = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _bdPn = game ? (getPlayerNumForMsgId(msgId) ?? 1) : 1;
    const _bdSelFig = typeof actionsDataOrRemaining === 'object' ? (actionsDataOrRemaining?.selectedFigure ?? 0) : 0;
    const _bdFk = `${dcName}-${_bdDgIdx}-${_bdSelFig}`;
    if (game.figureContraband?.[_bdFk]) {
      specials = [...specials, 'Bomb Drop'];
      specialCosts = [...specialCosts, 1];
    }
  }
  const dgIndex = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const actionsData = typeof actionsDataOrRemaining === 'object' && actionsDataOrRemaining != null ? actionsDataOrRemaining : { remaining: actionsDataOrRemaining, specialsUsed: [] };
  const actionsRemaining = actionsData.remaining ?? 2;
  const specialsUsed = Array.isArray(actionsData.specialsUsed) ? actionsData.specialsUsed : [];
  const noActions = (actionsRemaining ?? 2) <= 0;
  const playerNum = game ? (getPlayerNumForMsgId(msgId) ?? 1) : 1;
  const selectedFigure = actionsData.selectedFigure ?? null;

  // Stun: check if the active figure is Stunned — if so, disable all action buttons
  const checkFigIdx = figures === 1 ? 0 : (selectedFigure ?? null);
  const isStunned = checkFigIdx != null && !!(game?.figureConditions?.[`${dcName}-${dgIndex}-${checkFigIdx}`] || []).includes('Stun');
  const noAct = noActions || isStunned;

  // To the Limit (C75): extra action cannot be a Move
  const toTheLimitActive = !!game?.activationExtraActionThenStun?.[msgId];
  const noMove = noAct || toTheLimitActive;

  // Non-Sentient: creatures with this trait cannot interact (unless Beast Tamer override is active)
  const _nsAbilityText = stats.abilityText || '';
  const _isNonSentient = _nsAbilityText.includes('Non-Sentient');
  const _beastTamerOverride = !!game?.beastTamerInteractOverride?.[msgId];
  // G48: Companion figures cannot interact
  const _isCompanion = isDcCompanion(dcName);
  const noInteract = noAct || (_isNonSentient && !_beastTamerOverride) || _isCompanion;

  const rows = [];

  if (figures > 1) {
    if (selectedFigure != null && selectedFigure < figures) {
      // Figure already selected: show action buttons (no dropdown — frees up a row slot)
      const _selNick = game?.figureNicknames?.[`${dcName}-${dgIndex}-${selectedFigure}`];
      const suffix = _selNick ? ` ${dgIndex}${FIGURE_LETTERS[selectedFigure]} (${_selNick})` : ` ${dgIndex}${FIGURE_LETTERS[selectedFigure]}`;
      const moveLbl = toTheLimitActive ? `Move${suffix} (blocked)` : `Move${suffix}`;
      const interactLbl = _isNonSentient && !_beastTamerOverride ? `Interact${suffix} (Non-Sentient)` : `Interact${suffix}`;
      const comps = [
        new ButtonBuilder().setCustomId(`dc_move_${msgId}_f${selectedFigure}`).setLabel(moveLbl).setStyle(ButtonStyle.Success).setDisabled(noMove),
        new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f${selectedFigure}`).setLabel(`Attack${suffix}`).setStyle(ButtonStyle.Danger).setDisabled(noAct),
        new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f${selectedFigure}`).setLabel(interactLbl.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(noInteract),
      ];
      rows.push(new ActionRowBuilder().addComponents(...comps));
    } else {
      // No figure selected yet: show dropdown only
      const options = [];
      for (let f = 0; f < figures; f++) {
        const fk = `${dcName}-${dgIndex}-${f}`;
        const nick = game?.figureNicknames?.[fk];
        const label = nick ? `Figure ${dgIndex}${FIGURE_LETTERS[f]} (${nick})` : `Figure ${dgIndex}${FIGURE_LETTERS[f]}`;
        options.push({ label: label.slice(0, 100), value: String(f), default: false });
      }
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`dc_fig_select_${msgId}`)
        .setPlaceholder('Select a figure to act with…')
        .addOptions(options);
      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }
  } else {
    const stunLabel = isStunned ? '⚡ Stunned — no actions' : null;
    const moveLbl = toTheLimitActive ? 'Move (blocked)' : 'Move';
    const _singleInteractLbl = _isNonSentient && !_beastTamerOverride ? 'Interact (Non-Sentient)' : 'Interact';
    const comps = stunLabel
      ? [new ButtonBuilder().setCustomId(`dc_move_${msgId}_f0`).setLabel(stunLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary).setDisabled(true),
         new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f0`).setLabel('Attack').setStyle(ButtonStyle.Danger).setDisabled(true),
         new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f0`).setLabel(_singleInteractLbl).setStyle(ButtonStyle.Secondary).setDisabled(true)]
      : [new ButtonBuilder().setCustomId(`dc_move_${msgId}_f0`).setLabel(moveLbl).setStyle(ButtonStyle.Success).setDisabled(noMove),
         new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f0`).setLabel('Attack').setStyle(ButtonStyle.Danger).setDisabled(noAct),
         new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f0`).setLabel(_singleInteractLbl).setStyle(ButtonStyle.Secondary).setDisabled(noInteract)];
    rows.push(new ActionRowBuilder().addComponents(...comps));
  }

  if (specials.length > 0 && rows.length < 5) {
    const specialBtns = specials.slice(0, 5).map((name, idx) => {
      const alreadyUsed = specialsUsed.includes(idx);
      const cost = specialCosts[idx] ?? 1;
      const needsDoubleAction = cost >= 2;
      // VF: Focus — limit once per round per group
      const isVfFocusUsed = name === 'VF: Focus' && !!game?.vadersFocusUsedThisRound?.[msgId];
      const label = needsDoubleAction ? `${name} (2 Actions)`.slice(0, 80) : name.slice(0, 80);
      return new ButtonBuilder()
        .setCustomId(`dc_special_${idx}_${msgId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isStunned || alreadyUsed || isVfFocusUsed || (actionsRemaining ?? 2) < cost);
    });
    // Split into multiple rows if > 5 specials
    for (let i = 0; i < specialBtns.length; i += 5) {
      if (rows.length >= 5) break;
      rows.push(new ActionRowBuilder().addComponents(...specialBtns.slice(i, i + 5)));
    }
  }
  if (game && rows.length < 5) {
    const playableCc = getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName);
    const ccSpecials = playableCc.slice(0, 5);
    if (ccSpecials.length > 0) {
      const ccBtns = ccSpecials.map((ccName, idx) =>
        new ButtonBuilder()
          .setCustomId(`dc_cc_special_${msgId}_${idx}`)
          .setLabel(_truncLabel('CC: ', ccName))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(noAct)
      );
      rows.push(new ActionRowBuilder().addComponents(...ccBtns));
    }
  }
  // Double Action CCs: shown when 2 actions remain; disabled when < 2 actions or Stunned
  if (game && !noActions && rows.length < 5) {
    const playableCcDouble = getPlayableCcDoubleActionsForDc(game, playerNum, dcName, displayName);
    const ccDoubles = playableCcDouble.slice(0, 5);
    if (ccDoubles.length > 0) {
      const ccDoubleBtns = ccDoubles.map((ccName, idx) =>
        new ButtonBuilder()
          .setCustomId(`dc_cc_double_${msgId}_${idx}`)
          .setLabel(_truncLabel('CC (2 Actions): ', ccName))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(isStunned || (actionsRemaining ?? 2) < 2)
      );
      rows.push(new ActionRowBuilder().addComponents(...ccDoubleBtns));
    }
  }
  // End-of-Activation CCs: shown and enabled only when all actions are spent
  if (game && noActions && rows.length < 5) {
    const playableEoa = getPlayableCcEndOfActivationForDc(game, playerNum, dcName, displayName);
    const eoaCards = playableEoa.slice(0, 5);
    if (eoaCards.length > 0) {
      const eoaBtns = eoaCards.map((ccName, idx) =>
        new ButtonBuilder()
          .setCustomId(`dc_cc_eoa_${msgId}_${idx}`)
          .setLabel(_truncLabel('CC (End of Act.): ', ccName))
          .setStyle(ButtonStyle.Success)
          .setDisabled(false)
      );
      rows.push(new ActionRowBuilder().addComponents(...eoaBtns));
    }
  }
  // Overdrive: DROID may take 1 damage for +1 action (shown when CC is active and actions remain)
  if (game?.roundDroidExtraActionCostDamage && !noActions && rows.length < 5) {
    const dcKws = (getDcStats(dcName)?.keywords || []).map((k) => String(k).toUpperCase());
    if (dcKws.includes('DROID')) {
      const _odFigKey = `${dcName}-${dgIndex}-0`;
      const alreadyUsed = game.overdriveUsedThisActivation?.[_odFigKey];
      if (!alreadyUsed) {
        rows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`overdrive_use_${msgId}`)
            .setLabel('Overdrive: −1 HP for +1 Action')
            .setStyle(ButtonStyle.Warning)
        ));
      }
    }
  }
  return rows;
}

/**
 * ActionRow(s) for Activate buttons (DCs not yet activated). Includes Pass turn to opponent when applicable.
 * @param {object} helpers - { resolveDcName(dc), isFigurelessDc(dcName), isGroupDefeated(game, playerNum, dcIndex) }
 */
export function getActivateDcButtons(game, playerNum, helpers = {}) {
  const { resolveDcName = (dc) => (typeof dc === 'object' ? dc?.dcName || dc?.displayName : dc), isFigurelessDc = () => false, isGroupDefeated = () => true } = helpers;
  const dcList = getDcList(game, playerNum) || [];
  const activated = getActivatedDcIndices(game, playerNum) || [];
  const activatedSet = new Set(activated);
  const gameId = game.gameId;
  const btns = [];
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = resolveDcName(dc);
    if (isFigurelessDc(dcName)) continue;
    if (activatedSet.has(i)) continue;
    if (isGroupDefeated(game, playerNum, i)) continue;
    const displayName = dc?.displayName || dcName;
    const fullLabel = `Activate ${displayName}`;
    const label = fullLabel.length > 80 ? fullLabel.slice(0, 77) + '…' : fullLabel;
    btns.push(new ButtonBuilder()
      .setCustomId(`dc_activate_${gameId}_${playerNum}_${i}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Success));
  }
  const rows = [];
  for (let r = 0; r < btns.length && rows.length < MAX_ROWS_PER_MESSAGE; r += 5) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
  }
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const playerId = getPlayerId(game, playerNum);
  const oppNum = opponentPlayerNum(playerNum);
  const myRemaining = getActivationsRemaining(game, playerNum) ?? 0;
  const otherRemaining = getActivationsRemaining(game, oppNum) ?? 0;
  if (turnPlayerId === playerId && otherRemaining > myRemaining && myRemaining > 0 && rows.length < MAX_ROWS_PER_MESSAGE) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pass_activation_turn_${gameId}`)
        .setLabel('Pass turn to opponent')
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  return rows;
}

export { MAX_BUTTONS_PER_ROW, MAX_ROWS_PER_MESSAGE, MAX_LABEL_LENGTH };
