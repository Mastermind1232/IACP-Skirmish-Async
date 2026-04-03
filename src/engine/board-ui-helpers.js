/**
 * Board/map UI helper functions extracted from index.js.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { fetchGameChannel } from '../discord/channel-helpers.js';

/** Maps that are play-ready: have deployment zones, map-spaces, and are marked ready. */
export function getPlayReadyMaps(deps) {
  const dz = deps.getDeploymentZones();
  return deps.getMapRegistry().filter((m) => {
    if (!dz[m.id]?.red?.length || !dz[m.id]?.blue?.length) return false;
    const ms = deps.getMapData(m.id);
    if (!ms || ms.playReady === false) return false;
    return (Array.isArray(ms.spaces) && ms.spaces.length > 0) || (ms.adjacency && typeof ms.adjacency === 'object' && Object.keys(ms.adjacency).length > 0);
  });
}

/** After map selection: randomly pick A or B mission card, post to Game Log, pin it. */
export async function postMissionCardAfterMapSelection(game, client, map, deps) {
  const missions = deps.getMissionCardsData()[map.id];
  if (!missions?.a || !missions?.b) return;
  const variant = Math.random() < 0.5 ? 'a' : 'b';
  const mission = missions[variant];
  const mapName = map.name || map.id;
  const fullName = `${mapName} — ${mission.name}`;
  game.selectedMission = { variant, name: mission.name, fullName, tokenLabel: mission.tokenLabel || '', interactLabel: mission.interactLabel || '', mechanics: mission.mechanics || {} };
  await postPinnedMissionCardFromGameState(game, client, deps);
}

/** Post mission card when game.selectedMission and game.selectedMap are already set (e.g. Competitive). */
export async function postPinnedMissionCardFromGameState(game, client, deps) {
  const mission = game.selectedMission;
  const map = game.selectedMap;
  if (!mission || !map) return;
  const missionData = deps.getMissionCardsData()[map.id]?.[mission.variant];
  const variantLetter = mission.variant ? String(mission.variant).toUpperCase() : '';
  let missionName = missionData?.name || mission.name || '';
  const dupPattern = new RegExp(`^${variantLetter}[.:] ?`, 'i');
  if (variantLetter && dupPattern.test(missionName)) missionName = missionName.replace(dupPattern, '').trim();
  const variantLabel = variantLetter ? `Variant ${variantLetter} — ${missionName}` : missionName;
  const mapLabel = map.name || map.id;
  const fullName = `${mapLabel}: ${variantLabel}`;
  try {
    const ch = await fetchGameChannel(client, game.generalId);
    let sentMsg;
    const cardImagePath = missionData?.customImagePath || missionData?.imagePath;
    if (cardImagePath) {
      const resolvedPath = deps.resolveMissionCardImagePath(cardImagePath);
      const imagePath = resolvedPath ? join(deps.rootDir, resolvedPath) : null;
      if (imagePath && existsSync(imagePath)) {
        const attachment = new deps.AttachmentBuilder(imagePath, { name: 'mission-card.jpg' });
        sentMsg = await ch.send({ content: `\uD83C\uDFAF **Mission:** ${fullName}`, files: [attachment] });
      } else {
        sentMsg = await ch.send({ content: `\uD83C\uDFAF **Mission:** ${fullName}` });
      }
    } else {
      const parts = [`\uD83C\uDFAF **Mission:** ${fullName}`];
      if (missionData?.setup) parts.push(`**Setup:** ${missionData.setup}`);
      if (missionData?.persistent) parts.push(`**Persistent:** ${missionData.persistent}`);
      if (missionData?.startOfRound) parts.push(`**Start of Round:** ${missionData.startOfRound}`);
      if (missionData?.endOfRound) parts.push(`**End of Round:** ${missionData.endOfRound}`);
      sentMsg = await ch.send({ content: parts.join('\n') });
    }
    await sentMsg.pin().catch(deps.discordCatch);
    await deps.logGameAction(game, client, `Mission selected: **${fullName}** (pinned above).`, { phase: 'SETUP', icon: 'map' });
  } catch (err) {
    console.error('Mission card post error:', err);
    await deps.logGameAction(game, client, `Mission selected: **${fullName}**`, { phase: 'SETUP', icon: 'map' });
  }
}

/** Delete setup messages from Game Log when Round 1 begins. */
export async function clearPreGameSetup(game, client) {
  const ids = [
    ...(game.generalSetupMessageId ? [game.generalSetupMessageId] : []),
    ...(game.bothReadyMessageId ? [game.bothReadyMessageId] : []),
    ...(game.deploymentZoneMessageId ? [game.deploymentZoneMessageId] : []),
    ...(game.setupLogMessageIds || []),
  ];
  if (ids.length === 0 && !game.p1HandId && !game.p2HandId) return;
  try {
    const ch = await fetchGameChannel(client, game.generalId);
    for (const id of ids) {
      try {
        const msg = await ch.messages.fetch(id);
        await msg.delete();
      } catch {}
    }
    game.generalSetupMessageId = null;
    game.bothReadyMessageId = null;
    game.deploymentZoneMessageId = null;
    game.setupLogMessageIds = [];
  } catch (err) {
    console.error('Failed to clear pre-game setup:', err);
  }

  // Clear deck-selection artifacts from hand channels
  for (const handId of [game.p1HandId, game.p2HandId]) {
    if (!handId) continue;
    try {
      const handCh = await fetchGameChannel(client, handId);
      const msgs = await handCh.messages.fetch({ limit: 50 });
      for (const msg of msgs.values()) {
        try { await msg.delete(); } catch {}
      }
    } catch (err) {
      console.error('Failed to clear hand channel setup messages:', err);
    }
  }
}
