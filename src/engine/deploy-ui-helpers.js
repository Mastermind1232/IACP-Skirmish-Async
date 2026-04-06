/**
 * Deployment UI helper functions extracted from index.js.
 * Deploy prompts, map attachments for space choices, movement bank text.
 */
import { fetchGameChannel } from '../discord/channel-helpers.js';

/** Movement bank display text (green progress bar). */
export function getMovementBankText(displayName, remaining, total) {
  const safeTotal = Math.max(0, total ?? 0);
  const safeRemaining = Math.max(0, Math.min(remaining ?? 0, safeTotal));
  const bar = '\u{1F7E2}'.repeat(safeRemaining) + '\u26AA'.repeat(Math.max(0, safeTotal - safeRemaining));
  const name = displayName ? ` — ${displayName}` : '';
  return `**Movement Bank${name}:** ${safeRemaining}/${safeTotal} MP remaining ${bar ? `\n${bar}` : ''}`;
}

/** Per-figure deploy labels (delegates to discord helper with deps). */
export function getDeployFigureLabels(dcList, game, deps) {
  const getNickname = game ? (dcName, dgIndex, figIdx) => game.figureNicknames?.[`${dcName}-${dgIndex}-${figIdx}`] || null : undefined;
  return deps.getDeployFigureLabelsFromDiscord(dcList, { resolveDcName: deps.resolveDcName, isFigurelessDc: deps.isFigurelessDc, getDcStats: deps.getDcStats, getNickname });
}

/** Deploy button rows (delegates to discord helper with deps). */
export function getDeployButtonRows(gameId, playerNum, dcList, zone, figurePositions, game, deps) {
  const getNickname = game ? (dcName, dgIndex, figIdx) => game.figureNicknames?.[`${dcName}-${dgIndex}-${figIdx}`] || null : undefined;
  // Build set-aside keys from Lie in Ambush state so those figures are excluded from deploy buttons
  const setAsideArr = game?.lieInAmbushSetAside?.[playerNum];
  const setAsideFigureKeys = setAsideArr?.length ? new Set(setAsideArr) : undefined;
  return deps.getDeployButtonRowsFromDiscord(gameId, playerNum, dcList, zone, figurePositions, { resolveDcName: deps.resolveDcName, isFigurelessDc: deps.isFigurelessDc, getDcStats: deps.getDcStats, getNickname, setAsideFigureKeys });
}

/** Rebuilds deploy prompt messages for a player, removing buttons for already-deployed figures. */
export async function updateDeployPromptMessages(game, playerNum, client, deps) {
  const isInitiative = playerNum === deps.getInitiativePlayerNum(game);
  const idsKey = isInitiative ? 'initiativeDeployMessageIds' : 'nonInitiativeDeployMessageIds';
  const msgIds = game[idsKey];
  if (!msgIds?.length) return;
  const handId = deps.getHandChannelId(game, playerNum);
  const { p1Zone: _dp1z, p2Zone: _dp2z } = deps.getPlayerDeploymentZones(game, deps.getInitiativePlayerNum(game));
  const zone = playerNum === 1 ? _dp1z : _dp2z;
  const squad = deps.getSquad(game, playerNum);
  const dcList = squad?.dcList || [];
  try {
    const handChannel = await fetchGameChannel(client, handId);
    for (const msgId of msgIds) {
      try { await (await handChannel.messages.fetch(msgId)).delete(); } catch {}
    }
    game[idsKey] = [];
    const { deployRows, doneRow } = getDeployButtonRows(game.gameId, playerNum, dcList, zone, game.figurePositions, game, deps);
    const DEPLOY_ROWS_PER_MSG = 4;
    const zoneLabel = zone === 'red' ? 'red' : 'blue';
    const firstContent = isInitiative
      ? `You chose the **${zoneLabel}** zone. Deploy each figure below (one per row), then click **Deployment Completed** when finished.`
      : `Your opponent has deployed. Deploy each figure in the **${zoneLabel}** zone below (one per row), then click **Deployment Completed** when finished.`;
    const mapAttachment = await deps.getDeploymentMapAttachment(game, zone);
    if (deployRows.length === 0) {
      const payload = {
        content: isInitiative ? `You chose the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.` : `Your opponent has deployed. Deploy in the **${zoneLabel}** zone. When finished, click **Deployment Completed** below.`,
        components: [doneRow],
      };
      if (mapAttachment) payload.files = [mapAttachment];
      const msg = await handChannel.send(payload);
      game[idsKey].push(msg.id);
    } else {
      for (let i = 0; i < deployRows.length; i += DEPLOY_ROWS_PER_MSG) {
        const chunk = deployRows.slice(i, i + DEPLOY_ROWS_PER_MSG);
        const isLastChunk = i + DEPLOY_ROWS_PER_MSG >= deployRows.length;
        const components = isLastChunk ? [...chunk, doneRow] : chunk;
        const payload = { content: i === 0 ? firstContent : null, components };
        if (i === 0 && mapAttachment) payload.files = [mapAttachment];
        const msg = await handChannel.send(payload);
        game[idsKey].push(msg.id);
      }
    }
    game[isInitiative ? 'initiativeDeployMessageId' : 'nonInitiativeDeployMessageId'] = game[idsKey][game[idsKey].length - 1];
  } catch (err) {
    console.error('updateDeployPromptMessages error:', err);
  }
}

/** Returns AttachmentBuilder for CC/DC space choice (zoomed to validSpaces, labels on those coords). */
export async function getMapAttachmentForSpaces(game, validSpaces, deps) {
  const map = game?.selectedMap;
  if (!map?.id || !validSpaces?.length) return null;
  try {
    const figures = deps.getFiguresForRender(game);
    const tokens = deps.getMapTokensForRender(map.id, game?.selectedMission?.variant, game?.openedDoors, game?.ancillaryTokens, game?.selectedMission?.tokenLabel || 'Token', game?.signalMarkerStrain, game?.fluctuationPositions);
    const labelCoords = validSpaces.map((s) => String(s).toLowerCase());
    const buffer = await deps.renderMap(map.id, {
      figures,
      tokens,
      showGrid: true,
      maxWidth: 800,
      cropToZone: validSpaces,
      gridStyle: 'black',
      showGridOnlyOnCoords: labelCoords,
    });
    return new deps.AttachmentBuilder(buffer, { name: 'space-choice.png' });
  } catch (err) {
    console.error('Map for space choice error:', err);
    return null;
  }
}
