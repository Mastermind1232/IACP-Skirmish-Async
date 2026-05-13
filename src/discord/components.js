import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { normalizeCoord } from '../game/coords.js';
import { getDcList, getActivatedDcIndices, getPlayerId, getActivationsRemaining, opponentPlayerNum } from '../game/player-helpers.js';
import { isDcCompanion } from '../data-loader.js';
import { cardNameIncludes } from '../game/card-names.js';

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
    const hasActiveActivation = !!game?.dcActionsData?.[msgId];
    const activationFinished = !!game?.dcFinishedPinged?.[msgId];
    const btns = [];
    // Only show Un-activate if the activation hasn't completed yet (undo a misclick)
    if (!activationFinished) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`dc_unactivate_${msgId}`)
          .setLabel('Un-activate')
          .setStyle(ButtonStyle.Secondary),
      );
    }
    // Only show Ready if activation hasn't finished (undo misclick); once done, card stays exhausted until Status Phase
    if (!activationFinished) {
      btns.push(
        new ButtonBuilder()
          .setCustomId(`dc_toggle_${msgId}`)
          .setLabel('Ready')
          .setStyle(ButtonStyle.Success),
      );
    }
    if (hasActiveActivation) {
      btns.push(new ButtonBuilder()
        .setCustomId(`dc_end_activation_${msgId}`)
        .setLabel('End Activation')
        .setStyle(ButtonStyle.Danger)
      );
    }
    return btns.length ? new ActionRowBuilder().addComponents(...btns) : null;
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
    // Don't show Activate for DCs with no figures on the board (e.g. Lie in Ambush — not yet deployed)
    // Filter by group identity ([DG N] suffix → dgIndex N), not just dcName base, so a set-aside
    // LiA group doesn't inherit the deployed sibling group's "has figures" state.
    const _suffixMatch = (dcName || '').match(/\s*\[(?:DG|Group) (\d+)\]$/i);
    const _dcBase = (dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').trim();
    const _figurePrefix = _suffixMatch ? `${_dcBase}-${_suffixMatch[1]}-` : `${_dcBase}-`;
    const _hasFiguresOnBoard = !game || !_dcBase || [1, 2].some(pn =>
      Object.keys(game.figurePositions?.[pn] || {}).some(fk => fk.startsWith(_figurePrefix))
    );
    toggleRow = _hasFiguresOnBoard ? getDcToggleButton(msgId, exhausted, game) : null;
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

/** F16/F11: Bot Stuff menu — Resync + Kill Game (shown via /botmenu in Game Log). */
export function getBotmenuButtons(gameId, { showForfeit = false } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`resync_${gameId}`)
      .setLabel('Resync (Rebuild UI buttons / recover current state)')
      .setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cp_save_${gameId}`)
      .setLabel('💾 Save Checkpoint')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`cp_load_ingame_open_${gameId}`)
      .setLabel('🔀 Load Checkpoint (this lobby)')
      .setStyle(ButtonStyle.Secondary),
  );
  const dangerButtons = [];
  if (showForfeit) {
    dangerButtons.push(
      new ButtonBuilder()
        .setCustomId(`forfeit_${gameId}`)
        .setLabel('Forfeit')
        .setStyle(ButtonStyle.Danger)
    );
  }
  dangerButtons.push(
    new ButtonBuilder()
      .setCustomId(`botmenu_kill_${gameId}`)
      .setLabel('Kill Game')
      .setStyle(ButtonStyle.Danger)
  );
  const row3 = new ActionRowBuilder().addComponents(...dangerButtons);
  return [row1, row2, row3];
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
  if (components.length === 0) return null;
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
      .setCustomId(`fav_choose_${gameId}_${playerNum}`)
      .setLabel('Choose from Favorites')
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


/**
 * Canonical tier-1 row picker: groups spaces by row number and returns "Row N" buttons.
 * Used by the generic space_row_ handler and by flow-specific row pickers (deploy, movement).
 * @param {string[]} spaces - valid space coordinates (e.g. ['a3','b3','c4'])
 * @param {string} customIdPrefix - button customId prefix, row number is appended (e.g. 'space_row_00001_abc_')
 * @param {object} [options]
 * @param {import('discord.js').ButtonStyle} [options.style=ButtonStyle.Primary] - button style
 * @returns {{ rows: ActionRowBuilder[], available: string[] }}
 */
export function buildRowPickerButtons(spaces, customIdPrefix, options = {}) {
  const { style = ButtonStyle.Primary, rowDisplayOffset = 0 } = options;
  const normalized = (spaces || []).map((s) => normalizeCoord(s));
  const { sortedRows } = groupSpacesByRow(normalized);
  const btns = sortedRows.map((rowNum) =>
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}${rowNum}`)
      .setLabel(`Row ${rowNum + rowDisplayOffset}`)
      .setStyle(style)
  );
  const rows = [];
  for (let i = 0; i < btns.length; i += MAX_BUTTONS_PER_ROW) {
    rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + MAX_BUTTONS_PER_ROW)));
  }
  return { rows: rows.slice(0, MAX_ROWS_PER_MESSAGE), available: normalized };
}

/**
 * Filter a list of space coordinates to only those in a specific row.
 * @param {string[]} spaces - normalized coordinates
 * @param {number} rowNum - row number to keep
 * @returns {string[]}
 */
export function filterSpacesToRow(spaces, rowNum) {
  return (spaces || []).filter((s) => {
    const m = s.match(/^[a-z]+(\d+)$/i);
    return m && parseInt(m[1], 10) === rowNum;
  });
}

/**
 * Clean up a single pending space pick entry after cell selection or cancel.
 * @param {object} game
 * @param {string} contextKey
 */
export function cleanupSpacePick(game, contextKey) {
  if (game.pendingSpacePick) delete game.pendingSpacePick[contextKey];
}

/**
 * Clean up ALL pending space pick state — called on game end / teardown.
 * @param {object} game
 */
export function cleanupAllSpacePicks(game) {
  delete game.pendingSpacePick;
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
    const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
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
        labels.push(truncateLabel(rawLabel));
        metadata.push({ dcName, dgIndex, figureIndex: f });
      }
    }
  }
  return { labels, metadata };
}

/** Deploy button rows + done row; helpers = { resolveDcName, isFigurelessDc, getDcStats, setAsideFigureKeys }. */
export function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions, helpers = {}) {
  const { labels, metadata } = getDeployFigureLabels(dcList, helpers);
  const setAsideKeys = helpers.setAsideFigureKeys;
  const zoneStyle = zone === 'red' ? ButtonStyle.Danger : ButtonStyle.Primary;
  const pos = figurePositions?.[playerNum] || {};
  const deployRows = [];
  for (let i = 0; i < labels.length; i++) {
    const meta = metadata[i];
    const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
    // Skip Lie in Ambush set-aside figures
    if (setAsideKeys?.has(figureKey)) continue;
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
  if (cardNameIncludes(attachments, "Vader's Finest")) {
    names.push('VF: Attack+Move');
    costs.push(1);
    names.push('VF: Focus');
    costs.push(1);
  }
  if (cardNameIncludes(attachments, "Smuggler's Run")) {
    names.push("Smuggler's Run");
    costs.push(1);
  }
  if (cardNameIncludes(attachments, 'Z-6 Trooper')) {
    names.push('Autofire');
    costs.push(1);
  }
  if (cardNameIncludes(attachments, 'Mortar Trooper')) {
    names.push('Fire Mission');
    costs.push(2);
  }
  if (cardNameIncludes(attachments, 'The Darksaber')) {
    names.push('Darksaber Strike');
    costs.push(1);
  }
  if (cardNameIncludes(attachments, 'Orbital Bombardment')) {
    names.push('OB: Place Tokens');
    costs.push(1);
  }
  if (cardNameIncludes(attachments, 'Overwatch')) {
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
  // Unified activation lock (alexanbv 2026-05-10): lock key is
  // `${msgId}_f${figureIndex}` identifying the exact activating figure.
  // Buttons for any other (msgId, figureIndex) combination are disabled
  // until the locked figure ends. Computed at render time using the
  // figure that this row pertains to (selectedFigure for the action
  // row; figure-pick rows separately gate their pick buttons).
  const _lockKey = game?.activationLockKey || null;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  let specials = stats.specials || [];
  let specialCosts = stats.specialCosts || [];
  let specialMpCosts = stats.specialMpCosts || [];
  // Skirmish Upgrade attachments may remove DC specials (e.g. Driven by Hatred removes Brutality)
  const _suUpgrades = game ? (game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || []) : [];
  if (_suUpgrades.length) {
    const _lostSpecials = new Set();
    if (cardNameIncludes(_suUpgrades, 'Driven by Hatred')) _lostSpecials.add('Brutality');
    if (_lostSpecials.size) {
      const _filteredPairs = specials.map((s, i) => [s, specialCosts[i] ?? 1, specialMpCosts[i] ?? 0]).filter(([s]) => !_lostSpecials.has(s));
      specials = _filteredPairs.map(([s]) => s);
      specialCosts = _filteredPairs.map(([, c]) => c);
      specialMpCosts = _filteredPairs.map(([,, m]) => m);
    }
    // Inject attachment-provided special actions
    const injected = getAttachmentSpecials(_suUpgrades, game, msgId);
    if (injected.names.length) {
      specials = [...specials, ...injected.names];
      specialCosts = [...specialCosts, ...injected.costs];
      specialMpCosts = [...specialMpCosts, ...injected.names.map(() => 0)];
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
  // Experimental Weapons (Development Facility B): when figure carries a
  // weapon prototype, expose the 3 carrier-specific actions as extra
  // blue buttons. Per destruct 2026-05-08. Costs from data:
  //   • Attack (auto-Focus) — 1 action
  //   • Gain 3 VP — 2 actions
  //   • Move 4 + Recover 3 Strain — 2 actions
  if (game?.selectedMission?.name === 'Experimental Weapons') {
    const _wpActions = game?.selectedMission?.rules?.persistent?.weaponPrototypeCarrierActions || [];
    if (_wpActions.length > 0) {
      const _wpDgIdx = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _wpSelFig = typeof actionsDataOrRemaining === 'object' ? (actionsDataOrRemaining?.selectedFigure ?? 0) : 0;
      const _wpFk = `${dcName}-${_wpDgIdx}-${_wpSelFig}`;
      if (game.figureContraband?.[_wpFk]) {
        for (const _wpAct of _wpActions) {
          if (!_wpAct?.label) continue;
          specials = [...specials, _wpAct.label];
          specialCosts = [...specialCosts, _wpAct.actionCost || 1];
        }
      }
    }
  }
  const dgIndex = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const actionsData = typeof actionsDataOrRemaining === 'object' && actionsDataOrRemaining != null ? actionsDataOrRemaining : { remaining: actionsDataOrRemaining };
  const actionsRemaining = actionsData.remaining ?? 2;
  // Per alexanbv 2026-05-13: specialsUsed is per-figure. UI reads the
  // currently-selected figure's list for the "already used" disable state.
  const _suFigIdx = actionsData.selectedFigure ?? 0;
  const specialsUsed = actionsData.specialsUsedByFig?.[_suFigIdx] || [];
  const noActions = (actionsRemaining ?? 2) <= 0;
  const playerNum = game ? (getPlayerNumForMsgId(msgId) ?? 1) : 1;
  const selectedFigure = actionsData.selectedFigure ?? null;
  // Phase 2 (destruct 2026-05-07): per-figure budget. When the currently-
  // selected figure has used all its 2 actions, action buttons disable;
  // figureLocked[figIdx] prevents return to a finished figure (the
  // dropdown filter below excludes locked figures).
  const _perFigRem = actionsData.perFigureRemaining || null;
  const _figLocked = actionsData.figureLocked || {};
  const _curFigOutOfActions = (selectedFigure != null && _perFigRem)
    ? ((_perFigRem[selectedFigure] ?? 0) <= 0)
    : false;

  // Stun: per IACP, Stun prevents Move and Attack actions only — does NOT
  // block Interact or non-attack Special Actions (destruct 2026-05-07).
  const checkFigIdx = figures === 1 ? 0 : (selectedFigure ?? null);
  const isStunned = checkFigIdx != null && !!(game?.figureConditions?.[`${dcName}-${dgIndex}-${checkFigIdx}`] || []).includes('Stun');
  const isBleeding = checkFigIdx != null && !!(game?.figureConditions?.[`${dcName}-${dgIndex}-${checkFigIdx}`] || []).includes('Bleed');
  // noAct = "any action" gate — used for Interact + non-attack Specials.
  // Stun does NOT block these (destruct 2026-05-07 audit). Move/Attack
  // gates are computed separately (noMove/noAttack below).
  // Phase 2 (destruct 2026-05-07): also gate when the current figure has
  // used all its per-figure actions (must switch via dropdown).
  // Compose this row's lock key from msgId + selectedFigure. Row is
  // blocked when a lock exists that doesn't match this exact figure.
  const _thisRowFigIdx = selectedFigure ?? 0;
  const _thisRowKey = `${msgId}_f${_thisRowFigIdx}`;
  const _activationLocked = !!(_lockKey && _lockKey !== _thisRowKey);

  const noAct = noActions || _curFigOutOfActions || _activationLocked;
  const noAttack = noActions || isStunned || _curFigOutOfActions || _activationLocked;

  // To the Limit (C75): extra action cannot be a Move
  const toTheLimitActive = !!game?.activationExtraActionThenStun?.[_figureKeyForOncePerAct];
  // Move blocked by Stun + To-the-Limit + no-actions + activation lock.
  const noMove = noActions || isStunned || toTheLimitActive || _curFigOutOfActions || _activationLocked;

  // Non-Combatant: DCs with no attack dice cannot attack
  const hasAttack = (stats.attack?.dice?.length ?? 0) > 0;

  // Heroic (Jedi Luke): "Once during your activation, you may perform an
  // attack without spending an action." Surfaces as a sibling Primary/blue
  // Attack button alongside the regular Attack — NOT as a Special Action.
  // (destruct 2026-05-06.) Disabled when used this activation OR Stunned.
  // Per IACP rule 2026-05-09: "once per activation" applies to the
  // active figure's activation, not the whole multifigure group.
  // Compute figureKey for the currently-selected figure; gate Heroic
  // / Bo-Rifle Staff visibility against figureKey-keyed flag.
  const _selFigForOncePerAct = selectedFigure ?? 0;
  const _figureKeyForOncePerAct = `${dcName}-${dgIndex}-${_selFigForOncePerAct}`;
  const _hasHeroic = Array.isArray(stats.rawSpecialIds) && stats.rawSpecialIds.includes('heroic');
  const _heroicUsed = !!game?.heroicUsedThisActivation?.[_figureKeyForOncePerAct];
  const _showHeroic = _hasHeroic && hasAttack && !_heroicUsed;
  // Bo-Rifle Staff Strike (Zeb Orrelios): parallel blue free-attack button.
  // Per destruct 2026-05-07. Once per activation; free action; replaces
  // attack dice with [Red, Red] melee. Surfaces same way as Heroic.
  const _hasBoRifleStaff = Array.isArray(stats.rawSpecialIds) && stats.rawSpecialIds.includes('bo_rifle_staff_strike');
  const _boRifleUsed = !!game?.boRifleStaffUsedThisActivation?.[_figureKeyForOncePerAct];
  const _showBoRifleStaff = _hasBoRifleStaff && hasAttack && !_boRifleUsed;
  // [Wookiee Avenger] (Chewbacca): "Once during your activation, you may
  // use Slam without spending an action." Surfaces as a sibling
  // free-action button alongside Attack, available ANYTIME during the
  // activation (alexanbv 2026-05-10). Gated on the existing
  // wookieeAvengerSlamUsed flag (per alexanbv 2026-05-13: keyed by
  // figureKey now, not msgId — reuse _figureKeyForOncePerAct above).
  const _hasWaSlam = !!(_suUpgrades.length && cardNameIncludes(_suUpgrades, 'Wookiee Avenger'));
  const _waSlamUsed = !!game?.wookieeAvengerSlamUsed?.[_figureKeyForOncePerAct];
  const _showWaSlam = _hasWaSlam && !_waSlamUsed;

  const rows = [];

  if (figures > 1) {
    if (selectedFigure != null && selectedFigure < figures) {
      // Figure already selected: show action buttons (no dropdown — frees up a row slot)
      const _selNick = game?.figureNicknames?.[`${dcName}-${dgIndex}-${selectedFigure}`];
      const suffix = _selNick ? ` ${dgIndex}${FIGURE_LETTERS[selectedFigure]} (${_selNick})` : ` ${dgIndex}${FIGURE_LETTERS[selectedFigure]}`;
      const moveLbl = toTheLimitActive ? `Move${suffix} (blocked)` : `Move${suffix}`;
      // Single unified branch — Stun blocks Move/Attack only; Interact +
      // Specials remain usable (destruct 2026-05-07).
      const comps = [
        new ButtonBuilder().setCustomId(`dc_move_${msgId}_f${selectedFigure}`).setLabel(moveLbl).setStyle(ButtonStyle.Success).setDisabled(noMove),
      ];
      if (hasAttack) comps.push(new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f${selectedFigure}`).setLabel(`Attack${suffix}`).setStyle(ButtonStyle.Danger).setDisabled(noAttack));
      if (_showHeroic) comps.push(new ButtonBuilder().setCustomId(`dc_heroic_attack_${msgId}_f${selectedFigure}`).setLabel(`Heroic Attack (free)`).setStyle(ButtonStyle.Primary).setDisabled(isStunned));
      if (_showBoRifleStaff) comps.push(new ButtonBuilder().setCustomId(`dc_bo_rifle_attack_${msgId}_f${selectedFigure}`).setLabel(`Bo-Rifle Strike (free)`).setStyle(ButtonStyle.Primary).setDisabled(isStunned));
      if (_showWaSlam) comps.push(new ButtonBuilder().setCustomId(`dc_wa_slam_${msgId}_f${selectedFigure}`).setLabel(`Free Slam (Wookiee Avenger)`).setStyle(ButtonStyle.Primary).setDisabled(_activationLocked));
      comps.push(new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f${selectedFigure}`).setLabel(`Interact${suffix}`).setStyle(ButtonStyle.Secondary).setDisabled(noAct));
      rows.push(new ActionRowBuilder().addComponents(...comps));
      // Condition-discard row: Remove Stun + Remove Bleed (1 action each)
      // when applicable. Surface as a separate row so the action row stays
      // tight at 4 buttons (Move/Attack/Heroic/Interact).
      if (isStunned || isBleeding) {
        const condBtns = [];
        if (isStunned) condBtns.push(new ButtonBuilder().setCustomId(`dc_remove_stun_${msgId}_f${selectedFigure}`).setLabel(`Remove Stun${suffix} (1 Action)`.slice(0, 80)).setStyle(ButtonStyle.Danger).setDisabled(noActions));
        if (isBleeding) condBtns.push(new ButtonBuilder().setCustomId(`dc_remove_bleed_${msgId}_f${selectedFigure}`).setLabel(`Remove Bleed${suffix} (1 Action)`.slice(0, 80)).setStyle(ButtonStyle.Danger).setDisabled(noActions));
        if (condBtns.length) rows.push(new ActionRowBuilder().addComponents(...condBtns));
      }
      // Phase 2 (destruct 2026-05-07): "End Figure" button lets the
      // active player voluntarily forfeit their current figure's remaining
      // actions and lock that figure so the next figure can begin. Only
      // shown when there's at least one OTHER unlocked figure to pick.
      const _hasOtherUnlocked = (() => {
        for (let f = 0; f < figures; f++) {
          if (f === selectedFigure) continue;
          if (!_figLocked[f]) return true;
        }
        return false;
      })();
      if (_hasOtherUnlocked) {
        const endFigBtn = new ButtonBuilder()
          .setCustomId(`dc_end_figure_${msgId}_f${selectedFigure}`)
          .setLabel(`End Figure${suffix}`)
          .setStyle(ButtonStyle.Secondary);
        rows.push(new ActionRowBuilder().addComponents(endFigBtn));
      }
    } else {
      // No figure selected yet: show one Pick button per unlocked figure.
      // Per destruct 2026-05-08: each figure is its own activation; the
      // pick handler resets BOTH the action bank and the MP bank so the
      // chosen figure starts fresh with 2 actions and Speed-MP granted
      // on its next Move click. Locked figures are excluded — IACP
      // "complete one figure before another" prevents re-pick.
      const figButtons = [];
      for (let f = 0; f < figures; f++) {
        if (_figLocked[f]) continue;
        const fk = `${dcName}-${dgIndex}-${f}`;
        const nick = game?.figureNicknames?.[fk];
        const label = nick
          ? `${dgIndex}${FIGURE_LETTERS[f]} (${nick})`
          : `Figure ${dgIndex}${FIGURE_LETTERS[f]}`;
        figButtons.push(
          new ButtonBuilder()
            .setCustomId(`dc_fig_pick_${msgId}_f${f}`)
            .setLabel(label.slice(0, 80))
            .setStyle(ButtonStyle.Primary),
        );
      }
      // Discord caps an ActionRow at 5 buttons; multi-figure DGs are at
      // most 4 (figures field) so this fits in a single row in practice.
      if (figButtons.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(...figButtons.slice(0, 5)));
      }
    }
  } else {
    const moveLbl = toTheLimitActive ? 'Move (blocked)' : 'Move';
    // Single unified branch — Stun blocks Move/Attack only; Interact +
    // Specials remain usable (destruct 2026-05-07).
    const comps = [
      new ButtonBuilder().setCustomId(`dc_move_${msgId}_f0`).setLabel(moveLbl).setStyle(ButtonStyle.Success).setDisabled(noMove),
    ];
    if (hasAttack) comps.push(new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f0`).setLabel('Attack').setStyle(ButtonStyle.Danger).setDisabled(noAttack));
    if (_showHeroic) comps.push(new ButtonBuilder().setCustomId(`dc_heroic_attack_${msgId}_f0`).setLabel('Heroic Attack (free)').setStyle(ButtonStyle.Primary).setDisabled(isStunned));
    if (_showBoRifleStaff) comps.push(new ButtonBuilder().setCustomId(`dc_bo_rifle_attack_${msgId}_f0`).setLabel('Bo-Rifle Strike (free)').setStyle(ButtonStyle.Primary).setDisabled(isStunned));
    if (_showWaSlam) comps.push(new ButtonBuilder().setCustomId(`dc_wa_slam_${msgId}_f0`).setLabel('Free Slam (Wookiee Avenger)').setStyle(ButtonStyle.Primary).setDisabled(_activationLocked));
    comps.push(new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f0`).setLabel('Interact').setStyle(ButtonStyle.Secondary).setDisabled(noAct));
    rows.push(new ActionRowBuilder().addComponents(...comps));
    if (isStunned || isBleeding) {
      const condBtns = [];
      if (isStunned) condBtns.push(new ButtonBuilder().setCustomId(`dc_remove_stun_${msgId}_f0`).setLabel('Remove Stun (1 Action)').setStyle(ButtonStyle.Danger).setDisabled(noActions));
      if (isBleeding) condBtns.push(new ButtonBuilder().setCustomId(`dc_remove_bleed_${msgId}_f0`).setLabel('Remove Bleed (1 Action)').setStyle(ButtonStyle.Danger).setDisabled(noActions));
      if (condBtns.length) rows.push(new ActionRowBuilder().addComponents(...condBtns));
    }
  }

  // Spend remaining MP: available when movement bank has unspent points from a previous Move action
  // This is free — does not cost an action (IA rules: MP persist for the entire activation)
  {
    const bankMp = game?.movementBank?.[msgId]?.remaining ?? 0;
    const spendFigIdx = figures > 1 ? (selectedFigure ?? 0) : 0;
    const moveKey = `${msgId}_${spendFigIdx}`;
    const hasActiveMoveSession = !!game?.moveInProgress?.[moveKey];
    if (bankMp > 0 && !hasActiveMoveSession && rows.length < 5) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`dc_spend_mp_${msgId}_f${spendFigIdx}`)
          .setLabel(`Spend Remaining MP (${bankMp})`)
          .setStyle(ButtonStyle.Success)
      ));
    }
  }
  if (specials.length > 0 && rows.length < 5) {
    const specialBtns = specials.slice(0, 5).map((name, idx) => {
      const alreadyUsed = specialsUsed.includes(idx);
      const cost = specialCosts[idx] ?? 1;
      const mpCost = specialMpCosts[idx] ?? 0;
      const needsDoubleAction = cost >= 2;
      // VF: Focus — limit once per round per group
      const isVfFocusUsed = name === 'VF: Focus' && !!game?.vadersFocusUsedThisRound?.[msgId];
      let label;
      if (mpCost > 0 && cost <= 0) {
        // MP-based ability (e.g. Boba Fett's Wrist Cord) — not an action
        label = `${name} (${mpCost} MP)`.slice(0, 80);
      } else if (needsDoubleAction) {
        label = `Special Action: ${name} (2 Actions)`.slice(0, 80);
      } else {
        label = `Special Action: ${name}`.slice(0, 80);
      }
      const bankMp = game?.movementBank?.[msgId]?.remaining ?? 0;
      const mpDisabled = mpCost > 0 && bankMp < mpCost;
      // destruct 2026-05-07: Stun does NOT block Special Actions in
      // general — only Move + Attack. Stunned figures can still use
      // non-attack specials. Attack-specials that grant freeAttackBonus
      // will be refused at the dc_attack guard if the player tries to
      // launch the attack itself.
      return new ButtonBuilder()
        .setCustomId(`dc_special_${idx}_${msgId}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(alreadyUsed || isVfFocusUsed || (mpCost > 0 ? mpDisabled : (actionsRemaining ?? 2) < cost));
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
      // destruct 2026-05-07: Stun does NOT block Double-Action CC plays in
      // general (Stun is Move/Attack only). Attack-Double-Actions still
      // refuse via the dc_attack guard if the player tries to launch.
      const ccDoubleBtns = ccDoubles.map((ccName, idx) =>
        new ButtonBuilder()
          .setCustomId(`dc_cc_double_${msgId}_${idx}`)
          .setLabel(_truncLabel('CC (2 Actions): ', ccName))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled((actionsRemaining ?? 2) < 2)
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
            .setStyle(ButtonStyle.Danger)
        ));
      }
    }
  }
  // End Activation button in thread (mirrors dc_end_activation_ on DC card in play area)
  if (rows.length < 5) {
    const endActBtns = [];
    // Multi-figure DG: "Done with 1A" button to finish this figure and pick the next
    if (figures > 1 && selectedFigure != null) {
      const _figLabel = `${dgIndex}${FIGURE_LETTERS[selectedFigure]}`;
      endActBtns.push(
        new ButtonBuilder()
          .setCustomId(`dc_switch_fig_${msgId}`)
          .setLabel(`Done with ${_figLabel}`)
          .setStyle(ButtonStyle.Primary)
      );
    }
    const endLabel = figures > 1 ? 'End Group Activation' : 'End Activation';
    endActBtns.push(
      new ButtonBuilder()
        .setCustomId(`dc_end_activation_${msgId}`)
        .setLabel(endLabel)
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(new ActionRowBuilder().addComponents(...endActBtns));
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
    const label = truncateLabel(fullLabel);
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
        .setLabel(`Pass (opponent has ${otherRemaining - myRemaining} more activation${otherRemaining - myRemaining !== 1 ? 's' : ''} than you)`)
        .setStyle(ButtonStyle.Secondary)
    ));
  }
  return rows;
}

export { MAX_BUTTONS_PER_ROW, MAX_ROWS_PER_MESSAGE, MAX_LABEL_LENGTH };
