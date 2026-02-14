import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { normalizeCoord } from '../game/coords.js';

const MAX_BUTTONS_PER_ROW = 5;
const MAX_ROWS_PER_MESSAGE = 5;
const MAX_LABEL_LENGTH = 80;

/** Discord button label limit (2.5). Truncate to max chars; default 80. */
export function truncateLabel(s, max = MAX_LABEL_LENGTH) {
  if (s == null) return '';
  const str = String(s);
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
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
        .setStyle(ButtonStyle.Success)
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
 * @param {{ isDepletedRemovedFromGame: (game, msgId) => boolean, hasDepleteEffect: (dcName) => boolean }} helpers
 */
export function getDcPlayAreaComponents(msgId, exhausted, game, dcName, helpers = {}) {
  const { isDepletedRemovedFromGame = () => false, hasDepleteEffect = () => false } = helpers;
  if (game && isDepletedRemovedFromGame(game, msgId)) return [];
  const toggleRow = getDcToggleButton(msgId, exhausted, game);
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

/** @param {string} gameId - @param {{ game?: { ended?: boolean } }} [opts] - when game.ended, Undo is disabled (F14). */
export function getBoardButtons(gameId, opts = {}) {
  const game = opts.game;
  const undoDisabled = !!game?.ended;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_map_${gameId}`)
      .setLabel('Refresh Map')
      .setStyle(ButtonStyle.Primary),
    getUndoButton(gameId, undoDisabled),
    new ButtonBuilder()
      .setCustomId(`refresh_all_${gameId}`)
      .setLabel('Refresh All')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** F17: One row with Map Selection menu (Random / Competitive / Select Draw / Selection). */
export function getMapSelectionMenu(gameId) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`map_selection_menu_${gameId}`)
    .setPlaceholder('Choose how to select the map')
    .addOptions(
      { label: 'Random', value: 'random', description: 'Random map and mission (A or B)' },
      { label: 'Competitive', value: 'competitive', description: 'Random from tournament rotation' },
      { label: 'Select Draw', value: 'select_draw', description: 'Pick several, then random draw' },
      { label: 'Selection', value: 'selection', description: 'Pick one mission' },
    );
  return new ActionRowBuilder().addComponents(select);
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
export function getMissionSelectionPickMenu(gameId, options) {
  const opts = options.slice(0, MISSION_SELECT_MAX_OPTIONS);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`map_selection_pick_${gameId}`)
    .setPlaceholder('Choose one mission')
    .addOptions(opts.map((o) => ({ label: o.label, value: o.value })));
  return new ActionRowBuilder().addComponents(select);
}

/** F16/F11: Bot Stuff menu — Archive and Kill Game (shown via /botmenu in Game Log). */
export function getBotmenuButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`botmenu_archive_${gameId}`)
      .setLabel('Archive')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`botmenu_kill_${gameId}`)
      .setLabel('Kill Game')
      .setStyle(ButtonStyle.Danger)
  );
}

/** Confirm Archive: first confirm wins. */
export function getBotmenuArchiveConfirmButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`botmenu_archive_yes_${gameId}`)
      .setLabel('Yes, archive')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`botmenu_archive_no_${gameId}`)
      .setLabel('No')
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

export function getDeploymentDoneButton(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`deployment_done_${gameId}`)
      .setLabel('Deployment Completed')
      .setStyle(ButtonStyle.Success)
  );
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

/** Select Squad + Default Rebels/Scum/Imperial for testing. */
export function getHandSquadButtons(gameId, playerNum) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`squad_select_${gameId}_${playerNum}`)
      .setLabel('Select Squad')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_rebel`)
      .setLabel('Default Rebels')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_scum`)
      .setLabel('Default Scum')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`default_deck_${gameId}_${playerNum}_imperial`)
      .setLabel('Default Imperial')
      .setStyle(ButtonStyle.Primary),
  );
}

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

/** Action rows for movement space selection: move_pick_${msgId}_${figureIndex}_${space}. */
export function getMoveSpaceGridRows(msgId, figureIndex, validSpaces, mapSpaces) {
  const available = (validSpaces || []).map((s) => normalizeCoord(s));
  const orderMap = new Map(
    (mapSpaces?.spaces || []).map((coord, idx) => [normalizeCoord(coord), idx])
  );
  available.sort((a, b) => {
    const diff = (orderMap.get(a) ?? Infinity) - (orderMap.get(b) ?? Infinity);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
  const byRow = {};
  const rowOrder = [];
  for (const s of available) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!byRow[row]) {
      byRow[row] = [];
      rowOrder.push(row);
    }
    byRow[row].push(s);
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
              .setCustomId(`move_pick_${msgId}_${figureIndex}_${space}`)
              .setLabel(space.toUpperCase())
              .setStyle(ButtonStyle.Success)
          )
        )
      );
    }
  }
  return { rows: rows.slice(0, MAX_ROWS_PER_MESSAGE), available };
}

/** Per-figure deploy labels; helpers = { resolveDcName, isFigurelessDc, getDcStats }. */
export function getDeployFigureLabels(dcList, helpers = {}) {
  const { resolveDcName = (d) => (typeof d === 'object' ? d?.dcName || d?.displayName : d), isFigurelessDc = () => false, getDcStats = () => ({ figures: 1 }) } = helpers;
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
        labels.push(`Deploy ${baseName} ${dgIndex}${FIGURE_LETTERS[f]}`);
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
  const doneRow = getDeploymentDoneButton(gameId);
  return { deployRows, doneRow };
}

/** Action rows of deploy space buttons (deploy_pick_...) grouped by map row. */
export function getDeploySpaceGridRows(gameId, playerNum, flatIndex, validSpaces, occupiedSpaces, zone) {
  const occupied = new Set((occupiedSpaces || []).map((s) => String(s).toLowerCase()));
  const available = (validSpaces || [])
    .map((s) => String(s).toLowerCase())
    .filter((s) => !occupied.has(s));
  const byRow = {};
  for (const s of available) {
    const m = s.match(/^([a-z]+)(\d+)$/i);
    const row = m ? parseInt(m[2], 10) : 0;
    if (!byRow[row]) byRow[row] = [];
    byRow[row].push(s);
  }
  const sortedRows = Object.keys(byRow).map(Number).sort((a, b) => a - b);
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
  return { rows: rows.slice(0, MAX_ROWS_PER_MESSAGE), available };
}

/**
 * Action rows for DC: [Move][Attack][Interact] per figure, then specials, then CC specials. Max 5 rows.
 * @param {object} [helpers] - { getDcStats(dcName), getPlayerNumForMsgId(msgId), getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName) }
 */
export function getDcActionButtons(msgId, dcName, displayName, actionsDataOrRemaining = 2, game = null, helpers = {}) {
  const { getDcStats = () => ({}), getPlayerNumForMsgId = () => 1, getPlayableCcSpecialsForDc = () => [] } = helpers;
  const stats = getDcStats(dcName);
  const figures = stats.figures ?? 1;
  const specials = stats.specials || [];
  const dgIndex = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const actionsData = typeof actionsDataOrRemaining === 'object' && actionsDataOrRemaining != null ? actionsDataOrRemaining : { remaining: actionsDataOrRemaining, specialsUsed: [] };
  const actionsRemaining = actionsData.remaining ?? 2;
  const specialsUsed = Array.isArray(actionsData.specialsUsed) ? actionsData.specialsUsed : [];
  const noActions = (actionsRemaining ?? 2) <= 0;
  const playerNum = game ? (getPlayerNumForMsgId(msgId) ?? 1) : 1;
  const rows = [];
  for (let f = 0; f < figures && rows.length < 5; f++) {
    const suffix = figures <= 1 ? '' : ` ${dgIndex}${FIGURE_LETTERS[f]}`;
    const comps = [
      new ButtonBuilder().setCustomId(`dc_move_${msgId}_f${f}`).setLabel(`Move${suffix}`).setStyle(ButtonStyle.Success).setDisabled(noActions),
      new ButtonBuilder().setCustomId(`dc_attack_${msgId}_f${f}`).setLabel(`Attack${suffix}`).setStyle(ButtonStyle.Danger).setDisabled(noActions),
      new ButtonBuilder().setCustomId(`dc_interact_${msgId}_f${f}`).setLabel(`Interact${suffix}`).setStyle(ButtonStyle.Secondary).setDisabled(noActions),
    ];
    rows.push(new ActionRowBuilder().addComponents(...comps));
  }
  if (specials.length > 0 && rows.length < 5) {
    const specialBtns = specials.slice(0, 5).map((name, idx) => {
      const alreadyUsed = specialsUsed.includes(idx);
      return new ButtonBuilder()
        .setCustomId(`dc_special_${idx}_${msgId}`)
        .setLabel(name.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(noActions || alreadyUsed);
    });
    rows.push(new ActionRowBuilder().addComponents(...specialBtns));
  }
  if (game && rows.length < 5) {
    const playableCc = getPlayableCcSpecialsForDc(game, playerNum, dcName, displayName);
    const ccSpecials = playableCc.slice(0, 5);
    if (ccSpecials.length > 0) {
      const ccBtns = ccSpecials.map((ccName, idx) =>
        new ButtonBuilder()
          .setCustomId(`dc_cc_special_${msgId}_${idx}`)
          .setLabel(`CC: ${ccName}`.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(noActions)
      );
      rows.push(new ActionRowBuilder().addComponents(...ccBtns));
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
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const activated = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
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
  const playerId = playerNum === 1 ? game.player1Id : game.player2Id;
  const myRemaining = playerNum === 1 ? (game.p1ActivationsRemaining ?? 0) : (game.p2ActivationsRemaining ?? 0);
  const otherRemaining = playerNum === 1 ? (game.p2ActivationsRemaining ?? 0) : (game.p1ActivationsRemaining ?? 0);
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
