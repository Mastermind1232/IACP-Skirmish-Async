/**
 * Interact handlers: interact_cancel_, interact_choice_
 */
import { getPlayerId, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { triggerBleedAfterAction } from './strain-handler.js';
import { consumeActionForCurrentFigure } from '../game/activation-state.js';
import { isDcCompanion } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

const FIGURE_LETTERS = 'abcdefghij';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta
 */
export async function handleInteractCancel(interaction, ctx) {
  const { getGame, dcMessageMeta } = ctx;
  const match = interaction.customId.match(/^interact_cancel_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, getLegalInteractOptions, getDcStats, updateDcActionsMessage, logGameAction, saveGames, pushUndo
 */
export async function handleInteractChoice(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    getLegalInteractOptions,
    getDcStats,
    updateDcActionsMessage,
    logGameAction,
    saveGames,
    pushUndo,
  } = ctx;
  const match = interaction.customId.match(/^interact_choice_([^_]+)_(.+)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, msgId, figureIdxStr, optionId] = match;
  const figureIndex = parseInt(figureIdxStr, 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.followUp({ content: 'Invalid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can perform this action.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // G48: Companion figures cannot interact (includes retrieve)
  if (isDcCompanion(meta.dcName)) {
    await interaction.followUp({ content: 'Companion figures cannot interact.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const actionsData = game.dcActionsData?.[msgId];
  const previousRemaining = actionsData?.remaining ?? 2;
  if (previousRemaining <= 0) {
    await interaction.followUp({ content: 'No actions remaining this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const playerNum = meta.playerNum;
  const mapId = game.selectedMap?.id;
  const options = mapId ? getLegalInteractOptions(game, playerNum, figureKey, mapId) : [];
  const opt = options.find((o) => o.id === optionId);
  if (!opt) {
    await interaction.followUp({ content: 'That interact is no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // F14: Snapshot state before mutate for undo
  const previousContraband = optionId === 'retrieve_contraband' ? game.figureContraband?.[figureKey] : undefined;
  // RTK-002: snapshot dropped-contraband list so undo can restore a dropped-space pickup
  const previousDroppedContrabandSpaces = optionId === 'retrieve_contraband' && game.droppedContrabandSpaces
    ? game.droppedContrabandSpaces.slice()
    : undefined;
  let previousLaunchPanelState;
  let previousOpenedDoors;
  let previousP1LaunchFlipped;
  let previousP2LaunchFlipped;
  if (optionId.startsWith('launch_panel_')) {
    const coord = optionId.replace('launch_panel_', '').split('_')[0]?.toLowerCase();
    previousLaunchPanelState = coord != null && game.launchPanelState ? game.launchPanelState[coord] : undefined;
    previousP1LaunchFlipped = game.p1LaunchPanelFlippedThisRound;
    previousP2LaunchFlipped = game.p2LaunchPanelFlippedThisRound;
  }
  if (optionId.startsWith('open_door_')) {
    previousOpenedDoors = game.openedDoors ? game.openedDoors.slice() : [];
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  consumeActionForCurrentFigure(actionsData, 1);
  // All in a Day's Work (CC) timing: an Interact has now RESOLVED during this
  // activation. Set the per-activation flag the card's timing gate reads.
  game.specialOrInteractResolvedThisActivation = true;
  await updateDcActionsMessage(game, msgId, interaction.client);

  const stats = getDcStats(meta.dcName);
  const displayName = meta.displayName || meta.dcName;
  const shortName = (displayName || meta.dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/, '') || displayName;
  const figLabel = (stats.figures ?? 1) > 1 ? `${shortName} ${dgIndex}${FIGURE_LETTERS[figureIndex] || 'a'}` : shortName;
  const pLabel = `P${playerNum}`;

  const tokenLabel = typeof ctx.getMissionTokenLabel === 'function' ? ctx.getMissionTokenLabel(game) : 'Mission Token';

  let logMsg = null;
  if (optionId === 'retrieve_contraband') {
    game.figureContraband = game.figureContraband || {};
    // Per destruct 2026-05-07: figures may carry multiple contraband
    // tokens (no per-figure cap). Track as a count so each token can be
    // discarded / scored individually.
    const _prevCount = typeof game.figureContraband[figureKey] === 'number'
      ? game.figureContraband[figureKey]
      : (game.figureContraband[figureKey] ? 1 : 0);
    game.figureContraband[figureKey] = _prevCount + 1;
    // RTK-002: if picking up a dropped-on-defeat token, consume one dropped-space entry
    // that the figure is adjacent to / on. Static spawn-coord tokens are unaffected.
    if (game.droppedContrabandSpaces?.length) {
      const { getFigureAdjacentCoordsFromSet } = await import('../game/board-helpers.js');
      const { toLowerSet } = await import('../game/coords.js');
      const droppedSet = toLowerSet(game.droppedContrabandSpaces);
      const hits = getFigureAdjacentCoordsFromSet(game, playerNum, figureKey, mapId, droppedSet);
      if (hits.length) {
        const consumed = String(hits[0]).toLowerCase();
        const idx = game.droppedContrabandSpaces.indexOf(consumed);
        if (idx >= 0) game.droppedContrabandSpaces.splice(idx, 1);
      }
    }
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** retrieved **${tokenLabel}**!`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('launch_panel_')) {
    const parts = optionId.replace('launch_panel_', '').split('_');
    const coord = parts[0];
    const side = parts[1];
    game.launchPanelState = game.launchPanelState || {};
    game.launchPanelState[coord.toLowerCase()] = side;
    if (playerNum === 1) game.p1LaunchPanelFlippedThisRound = true;
    else game.p2LaunchPanelFlippedThisRound = true;
    const upper = String(coord).toUpperCase();
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** flipped **${tokenLabel}** (${upper}) to **${side}**.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId === 'use_terminal') {
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** used terminal.`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('mark_patron_')) {
    // M11 Gaining Favor: place 1 of player's mission tokens on the
    // patron. Per destruct 2026-05-08: BOTH players may mark the same
    // patron at different times — storage is per-player flag per coord.
    // Decrement remaining tokens; VP scoring
    // (getAnchorheadPatronVpBonus) reads anchorheadPatronTokens at win-
    // condition + scorecard time and applies the [0,2,5,10,20] table
    // independently per player.
    const _patronCoord = optionId.replace('mark_patron_', '').toLowerCase();
    game.anchorheadPatronTokens = game.anchorheadPatronTokens || {};
    const _existing = game.anchorheadPatronTokens[_patronCoord];
    let _entry;
    if (_existing && typeof _existing === 'object') {
      _entry = { ..._existing };
    } else if (_existing === 1 || _existing === 2) {
      // Legacy shape — promote to per-player object preserving prior owner.
      _entry = { [_existing]: true };
    } else {
      _entry = {};
    }
    _entry[playerNum] = true;
    game.anchorheadPatronTokens[_patronCoord] = _entry;
    game.anchorheadTokensRemaining = game.anchorheadTokensRemaining || { 1: 4, 2: 4 };
    game.anchorheadTokensRemaining[playerNum] = Math.max(0, (game.anchorheadTokensRemaining[playerNum] ?? 4) - 1);
    logMsg = await logGameAction(game, interaction.client, `🍻 **${pLabel}: ${figLabel}** marked patron at **${_patronCoord.toUpperCase()}** (${game.anchorheadTokensRemaining[playerNum]} token${game.anchorheadTokensRemaining[playerNum] !== 1 ? 's' : ''} left).`, { phase: 'ROUND', icon: 'deploy' });
  } else if (optionId.startsWith('retrieve_child_')) {
    // Retrieve The Child (Clan of Two): UNIQUE figure removes The Child
    // from the board and gains 1 VP. Per alexanbv 2026-05-09: trigger is
    // The Child being incapacitated; either player's UNIQUE figure may
    // retrieve. Removes the child figure, clears childIncapacitated +
    // companionHostMap entry, awards 1 objective VP.
    const childOwnerPN = parseInt(optionId.replace('retrieve_child_', ''), 10);
    const _childPoses = game.figurePositions?.[childOwnerPN] || {};
    const childFk = Object.keys(_childPoses).find((fk) => dcNameFromFigureKey(fk) === 'The Child');
    if (childFk) {
      delete game.figurePositions[childOwnerPN][childFk];
      if (game.figureConditions?.[childFk]) delete game.figureConditions[childFk];
      if (game.figurePowerTokens?.[childFk]) delete game.figurePowerTokens[childFk];
      if (game.companionHostMap) {
        for (const k of Object.keys(game.companionHostMap)) {
          if (k.startsWith('The Child-') && game.companionHostMap[k]?.playerNum === childOwnerPN) {
            delete game.companionHostMap[k];
          }
        }
      }
      // Slice 4: Child being retrieved = removed from play. Clear its
      // companion banks so a future re-deploy (Static Pulse-style) starts
      // fresh, and the stale msgId doesn't keep an actions counter alive.
      try {
        const { getCompanionMsgIdForHost, clearCompanionBanks } = await import('../engine/activation-setup.js');
        const _childHostIds = childOwnerPN === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        for (const _hostMsgId of (_childHostIds || [])) {
          const _compMsgId = getCompanionMsgIdForHost(game, _hostMsgId);
          if (!_compMsgId) continue;
          const _hostDc = (childOwnerPN === 1 ? game.p1DcList : game.p2DcList)?.[(_childHostIds || []).indexOf(_hostMsgId)];
          if (_hostDc && (typeof _hostDc === 'object' ? _hostDc.dcName : _hostDc)) {
            // Match by attachment "Clan of Two" or built-in companion = The Child
            const _atts = childOwnerPN === 1 ? (game.p1DcAttachments?.[_hostMsgId] || []) : (game.p2DcAttachments?.[_hostMsgId] || []);
            const _isChildHost = _atts.some((a) => /clan of two/i.test(a));
            if (_isChildHost) clearCompanionBanks(game, _compMsgId);
          }
        }
      } catch (err) {
        console.error('[interact] retrieve-child companion-bank cleanup failed:', err?.message ?? err);
      }
      game.childIncapacitated = false;
      const { awardObjectiveVp } = await import('../game/index.js');
      awardObjectiveVp(game, playerNum, 1);
      logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** retrieved **The Child** — gained **+1 VP** (Clan of Two).`, { phase: 'ROUND', icon: 'deploy' });
      if (ctx.checkWinConditions) await ctx.checkWinConditions(game, interaction.client);
    } else {
      logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** — Retrieve The Child failed (no Child figure on board).`, { phase: 'ROUND', icon: 'deploy' });
    }
  } else if (optionId.startsWith('open_door_')) {
    // Door ID may contain multiple comma-separated edge keys for multi-space doors
    const edgeKeys = optionId.replace('open_door_', '').split(',');
    game.openedDoors = game.openedDoors || [];
    for (const ek of edgeKeys) {
      if (!game.openedDoors.includes(ek)) game.openedDoors.push(ek);
    }
    const doorLabel = edgeKeys[0].split('|').map((s) => s.toUpperCase()).join('–');
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** opened door (${doorLabel}).`, { phase: 'ROUND', icon: 'deploy' });
  } else {
    logMsg = await logGameAction(game, interaction.client, `**${pLabel}: ${figLabel}** — ${opt.label}.`, { phase: 'ROUND', icon: 'deploy' });
  }

  if (pushUndo) {
    pushUndo(game, {
      type: 'interact',
      gameId: game.gameId,
      msgId,
      figureIndex,
      optionId,
      figureKey,
      previousRemaining,
      previousContraband,
      previousDroppedContrabandSpaces,
      previousLaunchPanelState,
      previousOpenedDoors,
      previousP1LaunchFlipped,
      previousP2LaunchFlipped,
      launchPanelCoord: optionId.startsWith('launch_panel_') ? optionId.replace('launch_panel_', '').split('_')[0]?.toLowerCase() : undefined,
      openDoorEdgeKey: optionId.startsWith('open_door_') ? optionId.replace('open_door_', '') : undefined,
      gameLogMessageId: logMsg?.id,
    });
  }
  // Post-action Bleed strain (Interact resolves): centralized via
  // triggerBleedAfterAction (destruct 2026-05-07).
  await triggerBleedAfterAction(game, ctx, figureKey, playerNum);
  // Curious (Loth-cat E/R): after interact, suffer 1 Strain. Routes
  // through the canonical applyStrain pipeline (Fireproof / Headhunter /
  // per-strain choice / Under Duress / Paz). Fix 2026-05-09: was raw HP
  // mutation that fully bypassed the strain pipeline.
  if (ctx.getDcEffects) {
    const _curEff = ctx.getDcEffects()?.[meta.dcName];
    if ((_curEff?.passives || []).includes('Curious')) {
      const { applyStrain } = await import('./strain-handler.js');
      await applyStrain(game, ctx, {
        figureKey,
        controllerPlayerNum: playerNum,
        amount: 1,
        source: 'Curious',
      });
    }
  }
  saveGames(game.gameId);
}
