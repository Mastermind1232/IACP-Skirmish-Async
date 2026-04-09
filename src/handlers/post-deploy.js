/**
 * Post-deploy ability ordering and execution system.
 * After deployment (round 1), players choose the order of their post-deploy abilities.
 * Initiative player resolves first, then the other player.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getDcStats, getMapData, getDeploymentZones, getFigureSize } from '../data-loader.js';
import { dcNameFromFigureKey, applyCondition, grantPowerTokens, buildFigureButtonLabel } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getInitiativePlayerNum, opponentPlayerNum, getHandChannelId,
} from '../game/player-helpers.js';
import { bottomLeftCoord, normalizeCoord, getFootprintCells } from '../game/coords.js';
import { countSpaces } from '../game/spatial.js';
import { edgeKey } from '../game/coords.js';
import { getMapTokensData } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { sendPowerTokenOverflowUI } from './combat.js';
import { requireGame } from '../utils/guards.js';
import { buildRowPickerButtons, chunkButtonsToRows, cleanupSpacePick } from '../discord/components.js';
import { splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';

// Module-level storage for companion DC embed deps (keyed by gameId).
// Set by runPostDeployPhase when ctx includes embed deps, consumed by resolveAutoAbility,
// cleaned up in finishPostDeploy.
const _companionEmbedDeps = new Map();

/**
 * Stash pending button customIds on the postDeployQueue so getAvailableActions
 * can surface them for the AI / selfplay without duplicating button-generation logic.
 */
function _stashPendingActions(game, buttons, label) {
  if (!game.postDeployQueue) return;
  game.postDeployQueue.pendingActions = buttons.map(b => ({
    type: 'post_deploy_active',
    customId: b.data.custom_id,
    description: `Post-deploy: ${label}`,
  }));
}

// ── Ability scanning ────────────────────────────────────────────────────────

/**
 * Scan a single player's deployed figures and skirmish upgrades for post-deploy abilities.
 * Returns an array of ability descriptors.
 */
function scanPlayerPostDeployAbilities(game, playerNum) {
  const abilities = [];
  const dcEffects = getDcEffects() || {};

  const figPositions = game.figurePositions?.[playerNum] || {};
  const figEntries = Object.entries(figPositions);

  // Scan deployed figures for DC passives and specialAbilityIds
  for (const [fk, pos] of figEntries) {
    if (!pos) continue;
    const dcName = dcNameFromFigureKey(fk);
    const eff = dcEffects[dcName] || dcEffects[dcName?.replace(/\s*\(Elite\)\s*$/, '')];
    if (!eff) continue;
    const passives = eff.passives || [];
    const sIds = eff.specialAbilityIds || [];

    if (passives.includes('Beskar Armor')) {
      abilities.push({ abilityId: 'beskar_armor', label: 'Beskar Armor', dcName, figureKey: fk, playerNum, interactive: false, type: 'token' });
    }
    if (passives.includes('Stealthy')) {
      abilities.push({ abilityId: 'stealthy', label: 'Stealthy', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (passives.includes('Ambush')) {
      abilities.push({ abilityId: 'ambush', label: 'Ambush', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (passives.includes('In The Shadows')) {
      abilities.push({ abilityId: 'in_the_shadows', label: 'In The Shadows', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (passives.includes('Forward Emplacement')) {
      const speed = eff.speed || 0;
      if (speed > 0) {
        abilities.push({ abilityId: 'forward_emplacement', label: 'Forward Emplacement', dcName, figureKey: fk, playerNum, interactive: true, type: 'movement', mp: speed });
      }
    }
    if (passives.includes('Smooth Landing')) {
      // Bodhi + each adjacent friendly gains 1 MP — all need to move immediately
      // Use multi-cell adjacency: check ALL cells of both trigger and candidate figures
      const ms = getMapData(game.selectedMap?.id);
      const adjacency = ms?.adjacency || {};
      // Build set of all cells adjacent to any cell of the triggering figure's footprint
      const triggerSize = game.figureOrientations?.[fk] || getFigureSize(dcName) || '1x1';
      const triggerCells = getFootprintCells(pos, triggerSize).map(c => normalizeCoord(c));
      const adjSet = new Set();
      for (const tc of triggerCells) {
        for (const n of (adjacency[tc] || [])) adjSet.add(normalizeCoord(n));
      }
      const moveFigures = [{ figureKey: fk, dcName, mp: 1 }];
      const done = new Set([fk]);
      for (const [afk, apos] of figEntries) {
        if (!apos || done.has(afk)) continue;
        // Get all cells the candidate figure occupies
        const aDcName = dcNameFromFigureKey(afk);
        const aSize = game.figureOrientations?.[afk] || getFigureSize(aDcName) || '1x1';
        const aCells = getFootprintCells(apos, aSize).map(c => normalizeCoord(c));
        // Adjacent if ANY cell of candidate is adjacent to ANY cell of trigger
        if (!aCells.some(c => adjSet.has(c))) continue;
        done.add(afk);
        moveFigures.push({ figureKey: afk, dcName: aDcName, mp: 1 });
      }
      abilities.push({ abilityId: 'smooth_landing', label: 'Smooth Landing', dcName, figureKey: fk, playerNum, interactive: true, type: 'multi_movement', moveFigures });
    }
    if (passives.includes('Security Detail')) {
      const leaders = [];
      for (const [lfk, lpos] of figEntries) {
        if (!lpos) continue;
        const ldn = dcNameFromFigureKey(lfk);
        const leff = dcEffects[ldn];
        if ((leff?.keywords || []).some(k => k.toUpperCase() === 'LEADER')) {
          leaders.push({ figureKey: lfk, dcName: ldn });
        }
      }
      const isInteractive = leaders.length > 1;
      abilities.push({ abilityId: 'security_detail', label: 'Security Detail', dcName, figureKey: fk, playerNum, interactive: isInteractive, type: 'token', leaders });
    }
    if (passives.includes('Infiltration')) {
      const dgMatch = fk.match(/^(.+)-(\d+)-(\d+)$/);
      if (dgMatch) {
        const [, baseName, dgIdx] = dgMatch;
        const prefix = `${baseName}-${dgIdx}-`;
        const dgFigures = Object.keys(figPositions).filter(k => k.startsWith(prefix) && figPositions[k]);
        if (!abilities.some(a => a.abilityId === 'infiltration' && a.dcName === dcName && a.playerNum === playerNum)) {
          abilities.push({ abilityId: 'infiltration', label: 'Infiltration', dcName, figureKey: fk, figureKeys: dgFigures, playerNum, interactive: true, type: 'movement', mpPerFigure: 6 });
        }
      }
    }
    // Strike Team: check specialAbilityIds
    if (sIds.includes('strike_team_cassian') && !abilities.some(a => a.abilityId === 'strike_team' && a.playerNum === playerNum)) {
      abilities.push({ abilityId: 'strike_team', label: 'Strike Team', dcName, figureKey: fk, playerNum, interactive: true, type: 'complex' });
    }
    // Ko-Tun Arms Distribution post-deploy: pick 1 friendly within 3 spaces → gain 1 Power Token
    if (sIds.includes('arms_distribution_kotun') && !game[`armsDistDeployFired_p${playerNum}`]) {
      abilities.push({ abilityId: 'arms_distribution_deploy', label: 'Arms Distribution (Deploy)', dcName, figureKey: fk, playerNum, interactive: true, type: 'token_pick' });
    }
  }

  // Direct DC companion deployment (e.g., Jarrod Kelvin → J4X-7, Iden Versio → Dio)
  // These have companion as a string on the DC itself (not via attachment)
  const dcList = getDcList(game, playerNum) || [];
  const msgIds = getDcMessageIds(game, playerNum) || [];
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc || dc.defeated) continue;
    const mid = msgIds[i];
    const eff = dcEffects[dc.dcName];
    if (!eff || typeof eff.companion !== 'string') continue;
    // Skip if already deployed (attachment-based or direct)
    if (game[`companionDeployed_${mid}`]) continue;
    // Skip if the companion is already in figurePositions (e.g., via attachment path)
    const companionName = eff.companion;
    const alreadyPlaced = Object.keys(figPositions).some(k => k.startsWith(companionName + '-'));
    if (alreadyPlaced) continue;
    const hostFk = Object.keys(figPositions).find(k => k.startsWith(dc.dcName + '-'));
    if (hostFk) {
      abilities.push({
        abilityId: 'companion_deploy', label: `Deploy ${companionName}`,
        dcName: dc.dcName, figureKey: hostFk, msgId: mid, playerNum,
        companionName, interactive: false, type: 'companion',
      });
    }
  }

  // Scan skirmish upgrades (figureless DCs with attachments)
  const attachments = getDcAttachments(game, playerNum) || {};

  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc) continue;
    const dcName = dc.dcName;
    const eff = dcEffects[dcName] || dcEffects[`[${dcName}]`] || dcEffects[dcName?.replace(/^\[|\]$/g, '')];
    if (!eff) continue;

    // Extra Armor
    if (dcName.includes('Extra Armor') && !game[`extraArmorFired_p${playerNum}`]) {
      abilities.push({ abilityId: 'extra_armor', label: 'Extra Armor', dcName, playerNum, interactive: true, type: 'token_distribute', total: 4 });
    }
  }

  // Scavenged Walker (attachment) — check all DCs for this attachment
  for (let i = 0; i < msgIds.length; i++) {
    const mid = msgIds[i];
    const atts = attachments[mid] || [];
    if (atts.includes('Scavenged Walker')) {
      const dc = dcList[i];
      if (!dc || dc.defeated) continue;
      const fk = Object.keys(figPositions).find(k => k.startsWith(dc.dcName + '-'));
      if (fk && !game[`scavengedWalkerDeployMoveFired_${mid}`]) {
        abilities.push({ abilityId: 'scavenged_walker_move', label: 'Scavenged Walker', dcName: dc.dcName, figureKey: fk, msgId: mid, playerNum, interactive: true, type: 'movement', optional: true });
      }
    }
    // Cross Training (attachment): after deployment, this group becomes Hidden
    if (atts.some(a => a.toLowerCase() === 'cross training')) {
      const dc = dcList[i];
      if (dc && !dc.defeated) {
        // Find all deployed figures in the same deployment group
        const dgMatch = Object.keys(figPositions).find(k => k.startsWith(dc.dcName + '-'));
        if (dgMatch) {
          const dgPrefix = dgMatch.match(/^(.+-\d+)-/)?.[1]; // e.g. "Snowtrooper (Elite)-1"
          if (dgPrefix) {
            const groupFigures = Object.keys(figPositions).filter(k => k.startsWith(dgPrefix + '-') && figPositions[k]);
            for (const gfk of groupFigures) {
              abilities.push({ abilityId: 'cross_training_hidden', label: 'Cross Training', dcName: dc.dcName, figureKey: gfk, playerNum, interactive: false, type: 'condition' });
            }
          }
        }
      }
    }
    // Companion deployment via attachment (e.g., [Clan of Two] → The Child)
    for (const attName of atts) {
      const attData = dcEffects[attName] || dcEffects[`[${attName}]`];
      if (attData && typeof attData.companion === 'string' && !game[`companionDeployed_${mid}`]) {
        const dc = dcList[i];
        if (!dc || dc.defeated) continue;
        const hostFk = Object.keys(figPositions).find(k => k.startsWith(dc.dcName + '-'));
        if (hostFk) {
          // Check if the ability text allows adjacent placement (e.g. "your space or an adjacent space")
          const allowsAdjacent = (attData.abilityText || '').toLowerCase().includes('adjacent space');
          abilities.push({
            abilityId: 'companion_deploy', label: `Deploy ${attData.companion}`,
            dcName: dc.dcName, figureKey: hostFk, msgId: mid, playerNum,
            companionName: attData.companion,
            interactive: allowsAdjacent, type: 'companion',
            companionAllowsAdjacent: allowsAdjacent,
          });
        }
      }
    }
  }

  return abilities;
}

/**
 * Group abilities by DC so the picker is cleaner. Consolidate auto-apply abilities
 * from the same DC into one entry.
 */
function consolidateAbilities(abilities) {
  const consolidated = [];
  const autoByFk = new Map();

  for (const ab of abilities) {
    if (!ab.interactive) {
      const key = ab.figureKey;
      if (!autoByFk.has(key)) autoByFk.set(key, []);
      autoByFk.get(key).push(ab);
    } else {
      consolidated.push(ab);
    }
  }

  for (const [fk, group] of autoByFk) {
    consolidated.push(...group);
  }

  return consolidated;
}

// ── Auto-apply resolution ───────────────────────────────────────────────────

async function resolveAutoAbility(game, ability, client, logGameAction) {
  const { abilityId, dcName, figureKey, playerNum } = ability;

  switch (abilityId) {
    case 'beskar_armor': {
      grantPowerTokens(game, figureKey, 'Block', 2);
      await logGameAction(game, client, `🛡️ **Beskar Armor** — **${dcName}** gains **2 Block Tokens** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      break;
    }
    case 'stealthy': {
      applyCondition(game, figureKey, 'Hide');
      await logGameAction(game, client, `🥷 **Stealthy** — **${dcName}** becomes **Hidden** at start of mission.`, { phase: 'ROUND', icon: 'deployed' });
      break;
    }
    case 'ambush': {
      applyCondition(game, figureKey, 'Hide');
      await logGameAction(game, client, `🥷 **Ambush** — **${dcName}** becomes **Hidden** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      break;
    }
    case 'in_the_shadows': {
      applyCondition(game, figureKey, 'Hide');
      await logGameAction(game, client, `🥷 **In The Shadows** — **${dcName}** becomes **Hidden** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      break;
    }
    case 'cross_training_hidden': {
      applyCondition(game, figureKey, 'Hide');
      await logGameAction(game, client, `🥷 **Cross Training** — **${dcName}** becomes **Hidden** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      break;
    }
    case 'security_detail': {
      // Auto-resolve: pick the only LEADER
      const leaders = ability.leaders || [];
      if (leaders.length > 0) {
        const leader = leaders[0];
        grantPowerTokens(game, leader.figureKey, 'Block', 1);
        await logGameAction(game, client, `🛡️ **Security Detail** — **${leader.dcName}** gains **1 Block Token** (from ${dcName}).`, { phase: 'ROUND', icon: 'deployed' });
      }
      break;
    }
    case 'companion_deploy': {
      // Place companion at host figure's position
      const companionName = ability.companionName;
      const hostPos = game.figurePositions?.[playerNum]?.[figureKey];
      if (hostPos && companionName) {
        const companionKey = `${companionName}-0-0`;
        if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
        game.figurePositions[playerNum][companionKey] = hostPos;
        game[`companionDeployed_${ability.msgId}`] = true;
        // Track companion → host relationship for activation
        game.companionHostMap = game.companionHostMap || {};
        game.companionHostMap[companionKey] = { hostFigureKey: figureKey, playerNum };
        await logGameAction(game, client, `👶 **${companionName}** deployed at **${dcName}**'s position (${hostPos}).`, { phase: 'ROUND', icon: 'deployed' });
        // Create DC embed for companion in Play Area
        const embedDeps = _companionEmbedDeps.get(game.gameId);
        if (embedDeps) {
          try {
            await _createCompanionDcEmbed(game, companionName, playerNum, ability.msgId, client, embedDeps);
          } catch (err) {
            console.error(`[post-deploy] Failed to create companion DC embed for ${companionName}:`, err.message);
          }
        }
      }
      break;
    }
  }
}

// ── Companion DC embed creation ─────────────────────────────────────────────

/**
 * Create a DC embed for a companion figure in the player's Play Area.
 * Mirrors the pattern from populatePlayAreas in setup-bridge.js.
 */
async function _createCompanionDcEmbed(game, companionName, playerNum, hostMsgId, client, deps) {
  const {
    buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState, dcHealthState,
    getDcPlayAreaComponents, getNicknamesForDcMessage,
  } = deps;

  const playAreaId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
  if (!playAreaId) return;

  const stats = getDcStats(companionName);
  const health = stats?.health ?? '?';
  const figures = stats?.figures ?? 1;
  const healthState = Array.from({ length: figures }, () => [health, health]);
  const displayName = companionName;
  const dcInfo = { dcName: companionName, displayName };

  const { embed, files } = await buildDcEmbedAndFiles(
    companionName, false, displayName, healthState, undefined, [], null, null,
    getNicknamesForDcMessage(game, dcInfo),
  );

  const playArea = await fetchGameChannel(client, playAreaId);
  const msg = await playArea.send({ embeds: [embed], files });

  dcMessageMeta.set(msg.id, { gameId: game.gameId, playerNum, dcName: companionName, displayName });
  dcExhaustedState.set(msg.id, false);
  dcHealthState.set(msg.id, healthState);

  const components = getDcPlayAreaComponents(msg.id, false, game, companionName);
  await msg.edit({ components });

  // Store companion message ID at the host DC's index
  const hostMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  const companionMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
  const hostIdx = hostMsgIds?.indexOf(hostMsgId);
  if (hostIdx >= 0 && companionMsgIds) {
    companionMsgIds[hostIdx] = msg.id;
  }
}

// ── Movement prompt for post-deploy figures ─────────────────────────────────

/**
 * Start movement for the next figure in a multi-movement flow.
 * Used by Smooth Landing, Forward Emplacement, Strike Team (after adj pick).
 * For smooth_landing: shows a picker so the player chooses which figure moves next.
 * For other abilities: uses currentFigureIdx to auto-advance.
 */
async function _startNextMovement(game, gameId, client, ctx) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;
  q.pendingActions = null; // Clear stash — movement system handles its own buttons
  const active = q.activeAbility;
  if (!active || !active.moveFigures) return;

  // For smooth_landing with player-chosen order: show picker when >1 figures remain
  if (active.abilityId === 'smooth_landing' && !active._pickedFigureKey) {
    // Filter to remaining figures (not yet resolved)
    const remaining = active.moveFigures.filter(f => !active._resolvedFigures?.includes(f.figureKey));
    if (remaining.length === 0) {
      // All figures done
      q.activeAbility = null;
      await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
      if (saveGames) saveGames();
      return;
    }
    if (remaining.length === 1) {
      // Only one left — auto-pick it
      active._pickedFigureKey = remaining[0].figureKey;
    } else {
      // Show picker buttons for remaining figures
      const playerNum = active.playerNum;
      const ownerId = getPlayerId(game, playerNum);
      const btns = remaining.slice(0, 20).map(f => new ButtonBuilder()
        .setCustomId(`pd_sl_pick_${gameId}_${playerNum}_${f.figureKey}`)
        .setLabel(buildFigureButtonLabel(f.figureKey, game))
        .setStyle(ButtonStyle.Primary)
      );
      _stashPendingActions(game, btns, 'Smooth Landing');
      const rows = chunkButtonsToRows(btns);
      const generalChannel = await fetchGameChannel(client, game.generalId);
      if (generalChannel) {
        await generalChannel.send({
          content: `🛬 **Smooth Landing** — <@${ownerId}>, choose which figure moves next (${remaining.length} remaining):`,
          components: rows,
          allowedMentions: { users: [ownerId] },
        }).catch(() => null);
      }
      if (saveGames) saveGames();
      return;
    }
  }

  // Determine which figure to move
  let fig;
  if (active._pickedFigureKey) {
    fig = active.moveFigures.find(f => f.figureKey === active._pickedFigureKey);
    delete active._pickedFigureKey;
  } else {
    const idx = active.currentFigureIdx || 0;
    if (idx >= active.moveFigures.length) {
      q.activeAbility = null;
      await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
      if (saveGames) saveGames();
      return;
    }
    fig = active.moveFigures[idx];
  }

  if (!fig) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
    if (saveGames) saveGames();
    return;
  }

  await _startMovementForFigure(game, gameId, client, ctx, fig);
}

/**
 * Start movement UI for a specific figure. Extracted from _startNextMovement
 * so it can be called by both the auto-advance and picker flows.
 */
async function _startMovementForFigure(game, gameId, client, ctx, fig) {
  const { logGameAction, saveGames, dcMessageMeta, getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;
  const active = q.activeAbility;
  if (!active) return;

  const { figureKey, dcName, mp } = fig;
  const playerNum = active.playerNum;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  const ownerId = getPlayerId(game, playerNum);

  if (!pos) {
    // Figure has no position — advance
    await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
    return;
  }

  // Find msgId for this figure's DC
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.dcName === dcName && meta.playerNum === playerNum) { msgId = mid; break; }
  }
  if (!msgId) {
    await logGameAction(game, client, `⚠️ Could not find play area message for **${dcName}** — skipping movement.`, { phase: 'ROUND', icon: 'deployed' });
    await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
    return;
  }

  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
    return;
  }
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(pos, mp, boardState, profile);

  // Fix 1: When no valid movement spaces, show a Stay button instead of auto-skipping
  if (cache.cells.size === 0) {
    const generalChannel = await fetchGameChannel(client, game.generalId);
    if (!generalChannel) {
      await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
      return;
    }
    const stayBtn = new ButtonBuilder()
      .setCustomId(`pd_move_stay_${gameId}_${playerNum}_${figureKey}`)
      .setLabel('Stay (Skip Movement)')
      .setStyle(ButtonStyle.Secondary);
    _stashPendingActions(game, [stayBtn], active.abilityLabel || 'Post-Deploy');
    await generalChannel.send({
      content: `🛬 **${active.abilityLabel || 'Post-Deploy'}** — <@${ownerId}>, **${dcName}** has no valid movement spaces (${mp} MP). Figure may stay in place.`,
      components: [new ActionRowBuilder().addComponents(stayBtn)],
      allowedMentions: { users: [ownerId] },
    }).catch(() => null);
    if (saveGames) saveGames();
    return;
  }

  // Set up movement via the movement engine
  const dgMatch = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const figureIndex = dgMatch ? parseInt(dgMatch[3], 10) : 0;
  game.moveInProgress = game.moveInProgress || {};
  const moveKey = `${msgId}_${figureIndex}`;
  game.moveInProgress[moveKey] = {
    figureKey,
    playerNum,
    mpRemaining: mp,
    displayName: dcName,
    msgId,
    movementProfile: profile,
    boardState,
    movementCache: cache,
    cacheMaxMp: mp,
    startCoord: pos,
    pendingMp: null,
    distanceMessageId: null,
    postDeployReturn: true,
  };

  const buttonSpaces = [...cache.cells.keys()];
  const isMultiTile = profile.size && profile.size !== '1x1';
  game.moveGridMessageIds = game.moveGridMessageIds || {};

  // Build labelMap for multi-tile figures (show bottom-left coords)
  const labelMap = {};
  if (isMultiTile) {
    for (const s of buttonSpaces) {
      const n = normalizeCoord(s);
      labelMap[n] = bottomLeftCoord(n, profile.size).toUpperCase();
    }
  }
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';
  const minimapCells = isMultiTile
    ? buttonSpaces.map((tl) => bottomLeftCoord(tl, profile.size))
    : buttonSpaces;
  const minimap = getMovementMinimapAttachment ? await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells) : null;

  const totalFigs = active.moveFigures.length;
  const resolvedCount = active._resolvedFigures?.length || 0;
  const remainingCount = totalFigs - resolvedCount;
  const figLabel = totalFigs > 1 ? ` (${remainingCount} remaining)` : '';

  // Store pendingSpacePick for generic row→cell handler
  const moveContextKey = `${gameId}_${moveKey}`;
  const moveHeader = `🛬 **${active.abilityLabel || 'Post-Deploy'}**${figLabel} — <@${ownerId}>, move **${dcName}** (**${mp}** MP):${multiTileNote}`;
  const moveActionBtns = [
    { customId: `pd_move_skip_${gameId}_${playerNum}_${moveKey}`, label: 'Skip Movement', style: ButtonStyle.Secondary },
  ];
  game.pendingSpacePick = game.pendingSpacePick || {};
  game.pendingSpacePick[moveContextKey] = {
    validSpaces: buttonSpaces,
    cellPrefix: `move_pick_${msgId}_${figureIndex}_`,
    mapSpaces: boardState.mapSpaces,
    labelMap,
    headerText: moveHeader,
    actionButtons: moveActionBtns,
  };
  const { rows: moveRowBtns } = buildRowPickerButtons(buttonSpaces, `space_row_${moveContextKey}_`);
  const actionBtns = moveActionBtns.map(b =>
    new ButtonBuilder().setCustomId(b.customId).setLabel(b.label).setStyle(b.style)
  );
  const actionRow = new ActionRowBuilder().addComponents(...actionBtns);

  // Find the game-log channel to post the movement UI
  const generalChannel = await fetchGameChannel(client, game.generalId);
  if (!generalChannel) {
    await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
    return;
  }

  const payload = {
    content: `${moveHeader}\nChoose a row:`,
    components: [...moveRowBtns.slice(0, 4), actionRow],
    allowedMentions: { users: [ownerId] },
  };
  if (minimap) payload.files = [minimap];

  const gridMsg = await generalChannel.send(payload).catch(() => null);
  game.moveGridMessageIds[moveKey] = gridMsg?.id ? [gridMsg.id] : [];

  if (saveGames) saveGames();
}

/**
 * Single entry point: advance after a figure finishes movement (or is skipped).
 * Handles all ability types — smooth_landing (resolved-figure tracking + picker),
 * strike_team (index-based + token distribution transition), and others (index-based).
 * @param {string} figureKey — REQUIRED: the figure that just finished.
 */
async function _advanceAfterFigure(game, gameId, client, ctx, figureKey) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;
  const active = q.activeAbility;

  // No active ability or no moveFigures → ability is done
  if (!active || !active.moveFigures) {
    if (active) q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
    if (saveGames) saveGames();
    return;
  }

  if (active.abilityId === 'smooth_landing') {
    // Resolved-figure tracking: mark this figure done, show picker for remaining
    active._resolvedFigures = active._resolvedFigures || [];
    if (figureKey && !active._resolvedFigures.includes(figureKey)) {
      active._resolvedFigures.push(figureKey);
    }
    const remaining = active.moveFigures.filter(f => !active._resolvedFigures.includes(f.figureKey));
    if (remaining.length === 0) {
      q.activeAbility = null;
      await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
      if (saveGames) saveGames();
      return;
    }
    await _startNextMovement(game, gameId, client, ctx);
  } else {
    // Index-based advance (Forward Emplacement, Strike Team, Scavenged Walker, etc.)
    active.currentFigureIdx = (active.currentFigureIdx || 0) + 1;
    if (active.currentFigureIdx >= active.moveFigures.length) {
      // All figures moved — check if Strike Team needs token distribution next
      if (active.abilityId === 'strike_team' && active.tokenRemaining > 0) {
        active.step = 'tokens';
        active.moveFigures = null;
        await _postStrikeTeamTokenPicker(game, gameId, active.playerNum, client, logGameAction);
      } else {
        q.activeAbility = null;
        await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
      }
    } else {
      await _startNextMovement(game, gameId, client, ctx);
    }
  }
}

// ── Interactive ability posting ──────────────────────────────────────────────

async function postInteractiveAbility(game, gameId, ability, client, ctx) {
  const { logGameAction, saveGames, dcMessageMeta, getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment } = ctx;
  const ownerId = getPlayerId(game, ability.playerNum);

  switch (ability.abilityId) {
    case 'security_detail': {
      const leaders = ability.leaders || [];
      const btns = leaders.map(l => new ButtonBuilder()
        .setCustomId(`pd_security_pick_${gameId}_${ability.playerNum}_${ability.figureKey}_${l.figureKey}`)
        .setLabel(l.dcName)
        .setStyle(ButtonStyle.Primary)
      );
      _stashPendingActions(game, btns, 'Security Detail');
      const rows = chunkButtonsToRows(btns);
      await logGameAction(game, client, `🛡️ **Security Detail** (${ability.dcName}) — <@${ownerId}>, choose which **LEADER** gains 1 Block Token:`, {
        components: rows,
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
    case 'smooth_landing': {
      // Log the ability, then start sequential movement for each figure
      const labels = ability.moveFigures.map(f => f.dcName);
      await logGameAction(game, client, `🛬 **Smooth Landing** — ${labels.join(', ')} gain${labels.length === 1 ? 's' : ''} **1 MP** after deployment. Resolve movement now.`, { phase: 'ROUND', icon: 'deployed' });
      game.postDeployQueue.activeAbility = {
        abilityId: 'smooth_landing',
        abilityLabel: 'Smooth Landing',
        moveFigures: ability.moveFigures,
        currentFigureIdx: 0,
        playerNum: ability.playerNum,
      };
      await _startNextMovement(game, gameId, client, ctx);
      break;
    }
    case 'forward_emplacement': {
      await logGameAction(game, client, `🏗️ **Forward Emplacement** — **${ability.dcName}** gains **${ability.mp} MP** after deployment. Resolve movement now.`, { phase: 'ROUND', icon: 'deployed' });
      game.postDeployQueue.activeAbility = {
        abilityId: 'forward_emplacement',
        abilityLabel: 'Forward Emplacement',
        moveFigures: [{ figureKey: ability.figureKey, dcName: ability.dcName, mp: ability.mp }],
        currentFigureIdx: 0,
        playerNum: ability.playerNum,
      };
      await _startNextMovement(game, gameId, client, ctx);
      break;
    }
    case 'strike_team': {
      // Step 1: Grant Cassian 2 MP
      const stMoveFigures = [{ figureKey: ability.figureKey, dcName: ability.dcName, mp: 2 }];

      // Find adjacent friendlies
      const pos = game.figurePositions?.[ability.playerNum]?.[ability.figureKey];
      const ms = getMapData(game.selectedMap?.id);
      const adj = pos ? (ms?.adjacency?.[String(pos).toLowerCase()] || []).map(a => String(a).toLowerCase()) : [];
      const adjFriendlies = [];
      for (const [afk, apos] of Object.entries(game.figurePositions?.[ability.playerNum] || {})) {
        if (!apos || afk === ability.figureKey) continue;
        if (adj.includes(String(apos).toLowerCase())) {
          adjFriendlies.push({ figureKey: afk, dcName: dcNameFromFigureKey(afk) });
        }
      }

      if (adjFriendlies.length === 0) {
        // No adjacent friendlies — Cassian moves alone, then Hit tokens
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** gains **2 MP**. No adjacent friendly figures for additional MP.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = {
          abilityId: 'strike_team',
          abilityLabel: 'Strike Team',
          step: 'movement',
          moveFigures: stMoveFigures,
          currentFigureIdx: 0,
          playerNum: ability.playerNum,
          figureKey: ability.figureKey,
          tokenRemaining: 4,
          alreadyReceived: [],
        };
        await _startNextMovement(game, gameId, client, ctx);
      } else if (adjFriendlies.length === 1) {
        // Only one adjacent — auto-pick, then let player choose movement order
        const friend = adjFriendlies[0];
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** and **${friend.dcName}** each gain **2 MP**.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = {
          abilityId: 'strike_team',
          abilityLabel: 'Strike Team',
          step: 'order_pick',
          cassianMoveFigure: stMoveFigures[0],
          friendMoveFigure: { figureKey: friend.figureKey, dcName: friend.dcName, mp: 2 },
          playerNum: ability.playerNum,
          figureKey: ability.figureKey,
          tokenRemaining: 4,
          alreadyReceived: [],
        };
        const orderBtns = [
          new ButtonBuilder().setCustomId(`pd_strike_order_${gameId}_${ability.playerNum}_cassian`).setLabel(`Move ${ability.dcName} first`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pd_strike_order_${gameId}_${ability.playerNum}_friend`).setLabel(`Move ${friend.dcName} first`).setStyle(ButtonStyle.Primary),
        ];
        _stashPendingActions(game, orderBtns, 'Strike Team');
        await logGameAction(game, client, `⚡ **Strike Team** — <@${ownerId}>, choose who moves first:`, {
          components: [new ActionRowBuilder().addComponents(orderBtns)],
          allowedMentions: { users: [ownerId] },
        });
      } else {
        // Multiple adjacent — player picks
        game.postDeployQueue.activeAbility = {
          abilityId: 'strike_team',
          abilityLabel: 'Strike Team',
          step: 'adj_pick',
          cassianMoveFigure: stMoveFigures[0],
          tokenRemaining: 4,
          playerNum: ability.playerNum,
          figureKey: ability.figureKey,
          alreadyReceived: [],
        };
        const btns = adjFriendlies.map(f => new ButtonBuilder()
          .setCustomId(`pd_strike_adj_${gameId}_${ability.playerNum}_${f.figureKey}`)
          .setLabel(f.dcName)
          .setStyle(ButtonStyle.Primary)
        );
        _stashPendingActions(game, btns, 'Strike Team');
        const rows = chunkButtonsToRows(btns);
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** gains **2 MP**. <@${ownerId}>, choose an adjacent friendly figure to also gain **2 MP**:`, {
          components: rows,
          allowedMentions: { users: [ownerId] },
          phase: 'ROUND', icon: 'deployed',
        });
      }
      break;
    }
    case 'infiltration': {
      const figures = ability.figureKeys || [ability.figureKey];
      game.postDeployQueue.activeAbility = {
        abilityId: 'infiltration',
        abilityLabel: 'Infiltration',
        moveFigures: figures.map(fk => ({ figureKey: fk, dcName: dcNameFromFigureKey(fk), mp: ability.mpPerFigure || 6 })),
        currentFigureIdx: 0,
        playerNum: ability.playerNum,
        dcName: ability.dcName,
      };
      // Start movement for first figure
      await _startNextMovement(game, gameId, client, ctx);
      break;
    }
    case 'extra_armor': {
      game[`extraArmorFired_p${ability.playerNum}`] = true;
      const allFks = Object.keys(game.figurePositions?.[ability.playerNum] || {});
      if (allFks.length > 0) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game[`pendingExtraArmor_p${ability.playerNum}`] = { remaining: 4, total: 4, allocation: {} };
        game.postDeployQueue.activeAbility = { abilityId: 'extra_armor', playerNum: ability.playerNum, remaining: 4 };
        const btns = allFks.slice(0, 20).map(fk => new ButtonBuilder()
          .setCustomId(`extra_armor_pick_${gameId}_${ability.playerNum}_${fk}`)
          .setLabel(buildFigureButtonLabel(fk, game))
          .setStyle(ButtonStyle.Primary)
        );
        _stashPendingActions(game, btns, 'Extra Armor');
        const rows = chunkButtonsToRows(btns);
        await logGameAction(game, client, `🛡️ **Extra Armor** — <@${ownerId}>, distribute **4 Block Tokens** among your figures (4 remaining). Check your hand channel.`, {
          allowedMentions: { users: [ownerId] },
        });
        // Send buttons to player's hand channel so only they can interact
        const handChId = getHandChannelId(game, ability.playerNum);
        try {
          const handCh = await fetchGameChannel(client, handChId);
          const sent = await handCh.send({
            content: '🛡️ **Extra Armor** — Choose a figure to give **1 Block Token** (4 remaining):',
            components: rows,
          });
          game[`pendingExtraArmor_p${ability.playerNum}`].handMsgId = sent.id;
          game[`pendingExtraArmor_p${ability.playerNum}`].handChId = handChId;
        } catch (err) {
          console.error('Extra Armor hand channel send failed:', err);
        }
      }
      break;
    }
    case 'arms_distribution_deploy': {
      game[`armsDistDeployFired_p${ability.playerNum}`] = true;
      // Find all friendly figures within 3 spaces of Ko-Tun (graph distance)
      const kotunPos = game.figurePositions?.[ability.playerNum]?.[ability.figureKey];
      const _adMapId = game.selectedMap?.id;
      const _adMs = _adMapId ? getMapData(_adMapId) : null;
      const _adAllDoors = _adMapId ? (getMapTokensData()?.[_adMapId]?.doors || []) : [];
      const _adOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
      const _adClosedDoorEdges = new Set(
        _adAllDoors
          .filter(e => { const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase(); return !_adOpenedSet.has(`${a}|${b}`) && !_adOpenedSet.has(`${b}|${a}`); })
          .map(e => edgeKey(e[0], e[1]))
      );
      const eligible = [];
      for (const [fk, fpos] of Object.entries(game.figurePositions?.[ability.playerNum] || {})) {
        if (!fpos) continue;
        const dist = countSpaces(_adMs, kotunPos, fpos, _adClosedDoorEdges);
        if (dist <= 3) {
          eligible.push(fk);
        }
      }
      if (eligible.length === 0) {
        await logGameAction(game, client, `🎯 **Arms Distribution (Deploy)** — No friendly figures within 3 spaces of **${ability.dcName}**.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = null; game.postDeployQueue.pendingActions = null;
        await postAbilityPicker(game, gameId, client, logGameAction);
        break;
      }
      game.postDeployQueue.activeAbility = {
        abilityId: 'arms_distribution_deploy',
        playerNum: ability.playerNum,
        figureKey: ability.figureKey,
        dcName: ability.dcName,
        eligibleFigures: eligible,
        step: 'pick_figure',
      };
      const btns = eligible.slice(0, 20).map(fk => new ButtonBuilder()
        .setCustomId(`pd_arms_dist_fig_${gameId}_${ability.playerNum}_${fk}`)
        .setLabel(buildFigureButtonLabel(fk, game))
        .setStyle(ButtonStyle.Primary)
      );
      _stashPendingActions(game, btns, 'Arms Distribution');
      const rows = chunkButtonsToRows(btns);
      await logGameAction(game, client, `🎯 **Arms Distribution (Deploy)** — <@${ownerId}>, choose **1 friendly figure** within 3 spaces of **${ability.dcName}** to gain **1 Power Token**:`, {
        components: rows.slice(0, 5),
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
    case 'companion_deploy': {
      // Interactive companion deploy — player chooses host space or adjacent space
      const companionName = ability.companionName;
      const hostPos = game.figurePositions?.[ability.playerNum]?.[ability.figureKey];
      if (!hostPos || !companionName) break;
      const hostNorm = normalizeCoord(hostPos);

      // Get all cells adjacent to the host figure (multi-cell aware)
      const ms = getMapData(game.selectedMap?.id);
      const adjacency = ms?.adjacency || {};
      const hostSize = game.figureOrientations?.[ability.figureKey] || getFigureSize(ability.dcName) || '1x1';
      const hostCells = getFootprintCells(hostPos, hostSize).map(c => normalizeCoord(c));
      const adjSet = new Set();
      for (const hc of hostCells) {
        for (const n of (adjacency[hc] || [])) {
          const nn = normalizeCoord(n);
          // Exclude cells the host itself occupies
          if (!hostCells.includes(nn)) adjSet.add(nn);
        }
      }
      // Filter out spaces occupied by any figure
      const allPositions = new Set();
      for (const pn of [1, 2]) {
        for (const [fk, fpos] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!fpos) continue;
          const fSize = game.figureOrientations?.[fk] || getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
          for (const c of getFootprintCells(fpos, fSize)) allPositions.add(normalizeCoord(c));
        }
      }
      const adjSpaces = [...adjSet].filter(s => !allPositions.has(s));

      // Build buttons: host space first, then adjacent
      // Only gameId, playerNum, and space are needed — companion info lives in activeAbility
      const btns = [];
      btns.push(new ButtonBuilder()
        .setCustomId(`pd_comp_space_${gameId}_${ability.playerNum}_${hostNorm}`)
        .setLabel(`Host space (${hostNorm.toUpperCase()})`)
        .setStyle(ButtonStyle.Primary)
      );
      for (const adjSpace of adjSpaces.slice(0, 19)) {
        btns.push(new ButtonBuilder()
          .setCustomId(`pd_comp_space_${gameId}_${ability.playerNum}_${adjSpace}`)
          .setLabel(adjSpace.toUpperCase())
          .setStyle(ButtonStyle.Secondary)
        );
      }
      const rows = chunkButtonsToRows(btns);

      game.postDeployQueue.activeAbility = {
        abilityId: 'companion_deploy',
        playerNum: ability.playerNum,
        figureKey: ability.figureKey,
        dcName: ability.dcName,
        companionName,
        msgId: ability.msgId,
      };
      _stashPendingActions(game, btns, `Deploy ${companionName}`);

      await logGameAction(game, client, `👶 **Deploy ${companionName}** — <@${ownerId}>, choose a space to deploy **${companionName}** (${ability.dcName}'s space or an adjacent space):`, {
        components: rows,
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
    case 'scavenged_walker_move': {
      game[`scavengedWalkerDeployMoveFired_${ability.msgId}`] = true;
      // Use the unified movement flow
      const dcEffectsData = getDcEffects() || {};
      const walkerEff = dcEffectsData[ability.dcName];
      const walkerMp = walkerEff?.speed || 4;
      game.postDeployQueue.activeAbility = {
        abilityId: 'scavenged_walker_move',
        abilityLabel: 'Scavenged Walker',
        moveFigures: [{ figureKey: ability.figureKey, dcName: ability.dcName, mp: walkerMp }],
        currentFigureIdx: 0,
        playerNum: ability.playerNum,
        optional: true,
      };
      // Show move/skip choice before starting movement
      const btns = [
        new ButtonBuilder().setCustomId(`pd_walker_move_${gameId}_${ability.playerNum}_${ability.msgId}`).setLabel('Perform Move').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pd_walker_skip_${gameId}_${ability.playerNum}_${ability.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      _stashPendingActions(game, btns, 'Scavenged Walker');
      await logGameAction(game, client, `🚶 **Scavenged Walker** — <@${ownerId}>, **${ability.dcName}** may perform a move after deployment:`, {
        components: [new ActionRowBuilder().addComponents(btns)],
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
  }
}

// ── Strike Team: Damage Token distribution ──────────────────────────────────────

async function _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction) {
  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'strike_team') return;

  const ownerId = getPlayerId(game, playerNum);
  const dzData = getDeploymentZones();
  const mapId = game.selectedMap?.id;
  const zone = playerNum === 1 ? game.player1DeploymentZone : game.player2DeploymentZone;
  const dzSpaces = (dzData?.[mapId]?.[zone] || []).map(s => String(s).toLowerCase());
  const dzSet = new Set(dzSpaces);

  // Find friendlies outside deployment zone (exclude figures that already received a token)
  const alreadyReceivedSet = new Set(active.alreadyReceived || []);
  const outsideZone = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
    if (!pos) continue;
    if (alreadyReceivedSet.has(fk)) continue;
    if (!dzSet.has(String(pos).toLowerCase())) {
      outsideZone.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk) });
    }
  }

  if (outsideZone.length === 0 || active.tokenRemaining <= 0) {
    await logGameAction(game, client, `⚡ **Strike Team** — No friendly figures outside deployment zone (or no tokens remaining).`, { phase: 'ROUND', icon: 'deployed' });
    game.postDeployQueue.activeAbility = null; game.postDeployQueue.pendingActions = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
    return;
  }

  const btns = outsideZone.slice(0, 20).map(f => new ButtonBuilder()
    .setCustomId(`pd_strike_token_${gameId}_${playerNum}_${f.figureKey}`)
    .setLabel(buildFigureButtonLabel(f.figureKey, game))
    .setStyle(ButtonStyle.Primary)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`pd_strike_token_done_${gameId}_${playerNum}`)
    .setLabel(`Done (${active.tokenRemaining} remaining)`)
    .setStyle(ButtonStyle.Secondary)
  );
  _stashPendingActions(game, btns, 'Strike Team');
  const rows = chunkButtonsToRows(btns);
  await logGameAction(game, client, `⚡ **Strike Team** — <@${ownerId}>, choose up to **${active.tokenRemaining}** friendly figure(s) outside your deployment zone to gain **1 Damage Token** each:`, {
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

// ── Ability picker ──────────────────────────────────────────────────────────

async function postAbilityPicker(game, gameId, client, logGameAction, saveGames) {
  const q = game.postDeployQueue;
  if (!q) return;

  const abilities = q.abilities || [];
  if (abilities.length === 0) {
    await advanceToNextPlayer(game, gameId, client, logGameAction);
    return;
  }

  const ownerId = getPlayerId(game, q.currentPlayerNum);
  const playerLabel = `Player ${q.currentPlayerNum}`;

  // If only auto-apply abilities remain, resolve them all
  const hasInteractive = abilities.some(a => a.interactive);
  if (!hasInteractive) {
    for (const ab of abilities) {
      await resolveAutoAbility(game, ab, client, logGameAction);
      if (game.pendingPowerTokenOverflow?.length > 0) {
        const _ovCh = await fetchGameChannel(client, game.generalId);
        if (_ovCh) await sendPowerTokenOverflowUI(game, gameId, _ovCh, ab.playerNum, saveGames);
      }
    }
    q.abilities = [];
    await advanceToNextPlayer(game, gameId, client, logGameAction);
    return;
  }

  // Auto-resolve all non-interactive abilities before showing buttons
  const autoAbilities = abilities.filter(a => !a.interactive);
  const interactiveAbilities = abilities.filter(a => a.interactive);
  for (const ab of autoAbilities) {
    await resolveAutoAbility(game, ab, client, logGameAction);
    if (game.pendingPowerTokenOverflow?.length > 0) {
      const _ovCh = await fetchGameChannel(client, game.generalId);
      if (_ovCh) await sendPowerTokenOverflowUI(game, gameId, _ovCh, ab.playerNum, saveGames);
    }
  }
  q.abilities = interactiveAbilities;

  if (interactiveAbilities.length === 0) {
    q.abilities = [];
    await advanceToNextPlayer(game, gameId, client, logGameAction);
    return;
  }

  q.awaitingOrder = true;
  const btns = interactiveAbilities.map((ab, idx) => {
    return new ButtonBuilder()
      .setCustomId(`pd_pick_${gameId}_${q.currentPlayerNum}_${idx}`)
      .setLabel(`${ab.label} — ${ab.dcName}`)
      .setStyle(ButtonStyle.Primary);
  });
  const rows = chunkButtonsToRows(btns);
  await logGameAction(game, client, `📋 **After Deployment** — <@${ownerId}> (${playerLabel}), choose which ability to resolve next (${interactiveAbilities.length} remaining):`, {
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

// ── Player advancement ──────────────────────────────────────────────────────

async function advanceToNextPlayer(game, gameId, client, logGameAction) {
  const q = game.postDeployQueue;
  if (!q) return;

  if (q.nextPlayerAbilities && q.nextPlayerAbilities.length > 0) {
    q.currentPlayerNum = opponentPlayerNum(q.currentPlayerNum);
    q.abilities = q.nextPlayerAbilities;
    q.nextPlayerAbilities = null;
    q.awaitingOrder = false;
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    await finishPostDeploy(game, gameId, client, logGameAction);
  }
}

async function finishPostDeploy(game, gameId, client, logGameAction) {
  delete game.postDeployQueue;
  game.postDeployEffectsFired = true;
  _companionEmbedDeps.delete(gameId);
  if (game._postDeployCallback) {
    const cb = game._postDeployCallback;
    delete game._postDeployCallback;
    await cb();
  }
}

/**
 * Clean up module-level _companionEmbedDeps for a game (e.g. when game is killed).
 * @param {string} gameId
 */
export function cleanupCompanionEmbedDeps(gameId) {
  _companionEmbedDeps.delete(gameId);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point: replaces the old inline post-deploy block.
 *
 * @param {object} game
 * @param {string} gameId
 * @param {object} client - Discord client
 * @param {object} ctx - { logGameAction, saveGames, dcMessageMeta, getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment, buildBoardMapPayload }
 * @param {function} onComplete - called when all post-deploy effects are done
 * @returns {boolean} true if a queue was created (async flow), false if all resolved immediately
 */
export async function runPostDeployPhase(game, gameId, client, ctx, onComplete) {
  const { logGameAction, saveGames } = ctx;

  // Store companion DC embed deps if provided (consumed by resolveAutoAbility)
  if (ctx.buildDcEmbedAndFiles) {
    _companionEmbedDeps.set(gameId, ctx);
  }

  if (game.postDeployEffectsFired) return false;

  const initPn = getInitiativePlayerNum(game);
  const otherPn = opponentPlayerNum(initPn);

  const initAbilities = consolidateAbilities(scanPlayerPostDeployAbilities(game, initPn));
  const otherAbilities = consolidateAbilities(scanPlayerPostDeployAbilities(game, otherPn));

  // No abilities at all — skip
  if (initAbilities.length === 0 && otherAbilities.length === 0) {
    game.postDeployEffectsFired = true;
    _companionEmbedDeps.delete(gameId);
    return false;
  }

  const initHasInteractive = initAbilities.some(a => a.interactive);
  const otherHasInteractive = otherAbilities.some(a => a.interactive);

  // All auto-apply for both players — resolve immediately
  if (!initHasInteractive && !otherHasInteractive) {
    game.postDeployEffectsFired = true;
    for (const ab of initAbilities) await resolveAutoAbility(game, ab, client, logGameAction);
    for (const ab of otherAbilities) await resolveAutoAbility(game, ab, client, logGameAction);
    _companionEmbedDeps.delete(gameId);
    // Check for overflow after batch auto-resolve
    if (game.pendingPowerTokenOverflow?.length > 0) {
      const _ovCh = await fetchGameChannel(client, game.generalId);
      if (_ovCh) {
        const _ovEntry = game.pendingPowerTokenOverflow[0];
        const _ovPn = _ovEntry?.playerNum || initPn;
        await sendPowerTokenOverflowUI(game, gameId, _ovCh, _ovPn, saveGames);
      }
    }
    if (saveGames) saveGames();
    return false;
  }

  // Set up the queue
  game.postDeployQueue = {
    currentPlayerNum: initPn,
    abilities: initAbilities,
    nextPlayerAbilities: otherAbilities,
    awaitingOrder: false,
    activeAbility: null,
  };

  // Store callback for when everything completes
  if (onComplete) game._postDeployCallback = onComplete;

  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  if (saveGames) saveGames();
  return true;
}

/**
 * Called after an interactive sub-flow completes to advance the queue.
 */
export async function advancePostDeployQueue(game, gameId, client, ctx) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;

  q.activeAbility = null;
  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  if (saveGames) saveGames();
}

// ── Button handlers ─────────────────────────────────────────────────────────

/**
 * Player picks which ability to resolve next.
 */
export async function handlePostDeployPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const abilityIdx = parseInt(parts[2], 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick post-deploy abilities.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const q = game.postDeployQueue;
  if (!q || q.currentPlayerNum !== playerNum) {
    await interaction.followUp({ content: 'Not your turn for post-deploy abilities.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const abilities = q.abilities || [];
  if (abilityIdx < 0 || abilityIdx >= abilities.length) {
    await interaction.followUp({ content: 'Invalid ability selection.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Remove from queue
  const [ability] = abilities.splice(abilityIdx, 1);
  q.awaitingOrder = false;

  // Disable buttons on the picker message
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  if (!ability.interactive) {
    await resolveAutoAbility(game, ability, client, logGameAction);
    if (game.pendingPowerTokenOverflow?.length > 0) {
      const _ovCh = await fetchGameChannel(client, game.generalId);
      if (_ovCh) await sendPowerTokenOverflowUI(game, gameId, _ovCh, ability.playerNum, saveGames);
    }
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  } else {
    await postInteractiveAbility(game, gameId, ability, client, ctx);
  }
  saveGames();
}

/**
 * Security Detail: player picks which LEADER gets the Block Token.
 */
export async function handleSecurityDetailPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_security_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const leaderFk = parts.slice(2).join('_');
  const leaderDcName = dcNameFromFigureKey(leaderFk);
  grantPowerTokens(game, leaderFk, 'Block', 1);
  await logGameAction(game, client, `🛡️ **Security Detail** — **${leaderDcName}** gains **1 Block Token**.`, { phase: 'ROUND', icon: 'deployed' });
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, interaction.channel, playerNum, saveGames);
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  }
  saveGames();
}

/**
 * Strike Team: player picks adjacent friendly for 2 MP.
 */
export async function handleStrikeTeamAdjPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_strike_adj_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const friendFk = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const friendDcName = dcNameFromFigureKey(friendFk);
  const active = game.postDeployQueue?.activeAbility;
  const cassianFk = active?.figureKey;
  const cassianName = cassianFk ? dcNameFromFigureKey(cassianFk) : 'Cassian Andor';
  await logGameAction(game, client, `⚡ **Strike Team** — **${cassianName}** and **${friendDcName}** each gain **2 MP**.`, { phase: 'ROUND', icon: 'deployed' });

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Let player choose movement order
  if (active) {
    const cassianMove = active.cassianMoveFigure || { figureKey: cassianFk, dcName: cassianName, mp: 2 };
    active.step = 'order_pick';
    active.cassianMoveFigure = cassianMove;
    active.friendMoveFigure = { figureKey: friendFk, dcName: friendDcName, mp: 2 };
    const ownerId = getPlayerId(game, playerNum);
    const orderBtns = [
      new ButtonBuilder().setCustomId(`pd_strike_order_${gameId}_${playerNum}_cassian`).setLabel(`Move ${cassianName} first`).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`pd_strike_order_${gameId}_${playerNum}_friend`).setLabel(`Move ${friendDcName} first`).setStyle(ButtonStyle.Primary),
    ];
    _stashPendingActions(game, orderBtns, 'Strike Team');
    await logGameAction(game, client, `⚡ **Strike Team** — <@${ownerId}>, choose who moves first:`, {
      components: [new ActionRowBuilder().addComponents(orderBtns)],
      allowedMentions: { users: [ownerId] },
    });
  }
  saveGames();
}

/**
 * Strike Team: player chooses movement order (Cassian first or friend first).
 */
export async function handleStrikeTeamOrderPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_strike_order_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const choice = parts[2]; // 'cassian' or 'friend'

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'strike_team' || active.step !== 'order_pick') return;

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const cassianMove = active.cassianMoveFigure;
  const friendMove = active.friendMoveFigure;
  active.step = 'movement';
  active.moveFigures = choice === 'friend'
    ? [friendMove, cassianMove]
    : [cassianMove, friendMove];
  active.currentFigureIdx = 0;
  await _startNextMovement(game, gameId, client, ctx);
  saveGames();
}

/**
 * Strike Team: player picks a figure outside deployment zone for Damage Token.
 */
export async function handleStrikeTeamTokenPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_strike_token_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'strike_team') return;

  const dcName = dcNameFromFigureKey(figureKey);
  grantPowerTokens(game, figureKey, 'Damage', 1);
  active.tokenRemaining -= 1;
  if (!active.alreadyReceived) active.alreadyReceived = [];
  active.alreadyReceived.push(figureKey);

  await logGameAction(game, client, `⚡ **Strike Team** — **${dcName}** gains **1 Damage Token** (${active.tokenRemaining} remaining).`, { phase: 'ROUND', icon: 'deployed' });
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, interaction.channel, playerNum, saveGames);
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  if (active.tokenRemaining <= 0) {
    game.postDeployQueue.activeAbility = null; game.postDeployQueue.pendingActions = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  } else {
    await _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction);
  }
  saveGames();
}

/**
 * Strike Team: player is done distributing Damage Tokens.
 */
export async function handleStrikeTeamTokenDone(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_strike_token_done_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const _tdPn = game.postDeployQueue?.currentPlayerNum;
  if (_tdPn && canActAsPlayer && !canActAsPlayer(game, interaction.user.id, _tdPn)) {
    await interaction.followUp({ content: 'Only the owning player can do this.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  }
  saveGames();
}

/**
 * Post-deploy movement skip: player skips movement for a figure.
 */
export async function handlePostDeployMoveSkip(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_move_skip_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const moveKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can skip.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Read figureKey BEFORE cleaning up moveInProgress (needed for smooth_landing tracking)
  const skippedFigureKey = game.moveInProgress?.[moveKey]?.figureKey || null;

  // Clean up pendingSpacePick
  cleanupSpacePick(game, `${gameId}_${moveKey}`);

  // Clean up moveInProgress
  if (game.moveInProgress?.[moveKey]) {
    delete game.moveInProgress[moveKey];
  }
  // Clean up grid messages
  if (game.moveGridMessageIds?.[moveKey]) {
    for (const mid of game.moveGridMessageIds[moveKey]) {
      try {
        const ch = interaction.channel || await fetchGameChannel(client, game.generalId);
        const msg = await ch.messages.fetch(mid).catch(() => null);
        if (msg) await msg.edit({ components: [] }).catch(discordCatch);
      } catch {}
    }
    delete game.moveGridMessageIds[moveKey];
  }

  const q = game.postDeployQueue;
  if (!q) { saveGames(); return; }

  await _advanceAfterFigure(game, gameId, client, ctx, skippedFigureKey);
  saveGames();
}

/**
 * Scavenged Walker: player starts the post-deploy move.
 */
export async function handleWalkerMove(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_walker_move_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const _wmPn = game.postDeployQueue?.currentPlayerNum;
  if (_wmPn && canActAsPlayer && !canActAsPlayer(game, interaction.user.id, _wmPn)) {
    await interaction.followUp({ content: 'Only the owning player can move.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'scavenged_walker_move') return;

  // Start the movement flow
  await _startNextMovement(game, gameId, client, ctx);
  saveGames();
}

/**
 * Scavenged Walker: player skips the post-deploy move.
 */
export async function handleWalkerSkip(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_walker_skip_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const _wsPn = game.postDeployQueue?.currentPlayerNum;
  if (_wsPn && canActAsPlayer && !canActAsPlayer(game, interaction.user.id, _wsPn)) {
    await interaction.followUp({ content: 'Only the owning player can skip.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  }
  saveGames();
}

/**
 * Smooth Landing figure picker: player chooses which figure moves next.
 */
export async function handleSmoothLandingPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_sl_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'smooth_landing') return;

  // Set the picked figure and start its movement
  active._pickedFigureKey = figureKey;
  await _startNextMovement(game, gameId, client, ctx);
  saveGames();
}

/**
 * Post-deploy movement Stay: figure stays in place (no valid movement spaces).
 */
export async function handlePostDeployMoveStay(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_move_stay_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can skip.', ephemeral: true }).catch(discordCatch);
    return;
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const dcName = dcNameFromFigureKey(figureKey);
  const active = game.postDeployQueue?.activeAbility;
  await logGameAction(game, client, `🛬 **${active?.abilityLabel || 'Post-Deploy'}** — **${dcName}** stays in place.`, { phase: 'ROUND', icon: 'deployed' });

  await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
  saveGames();
}

/**
 * Called from movement.js handleMovePick when a postDeployReturn move finishes.
 * Delegates to _advanceAfterFigure which handles all ability types.
 * @param {string} completedFigureKey — REQUIRED: the figure that just finished moving.
 */
export async function onPostDeployMovementComplete(game, gameId, client, ctx, completedFigureKey) {
  const { saveGames } = ctx;
  await _advanceAfterFigure(game, gameId, client, ctx, completedFigureKey);
  if (saveGames) saveGames();
}

/**
 * Called from the existing handleExtraArmorPick when all tokens are distributed,
 * if a postDeployQueue is active.
 */
export async function onExtraArmorComplete(game, gameId, client, ctx) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;

  q.activeAbility = null;
  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  if (saveGames) saveGames();
}

/**
 * Arms Distribution (Deploy): player picks a friendly figure within 3 spaces of Ko-Tun.
 */
export async function handleArmsDistFigPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_arms_dist_fig_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'arms_distribution_deploy') return;

  // Store selected figure, show token type picker
  active.selectedFigure = figureKey;
  active.step = 'pick_token';
  const dcName = dcNameFromFigureKey(figureKey);

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const tokenBtns = ['Damage', 'Surge', 'Block', 'Evade'].map(t => new ButtonBuilder()
    .setCustomId(`pd_arms_dist_token_${gameId}_${playerNum}_${t}`)
    .setLabel(t)
    .setStyle(t === 'Damage' || t === 'Surge' ? ButtonStyle.Danger : ButtonStyle.Primary)
  );
  _stashPendingActions(game, tokenBtns, 'Arms Distribution');
  await logGameAction(game, client, `🎯 **Arms Distribution (Deploy)** — Choose a Power Token type for **${dcName}**:`, {
    components: [new ActionRowBuilder().addComponents(tokenBtns)],
  });
  saveGames();
}

/**
 * Arms Distribution (Deploy): player picks token type (Hit/Surge/Block/Evade).
 */
export async function handleArmsDistTokenPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_arms_dist_token_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const tokenType = parts[2]; // 'Damage', 'Surge', 'Block', or 'Evade'

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'arms_distribution_deploy' || !active.selectedFigure) return;

  const figureKey = active.selectedFigure;
  const dcName = dcNameFromFigureKey(figureKey);

  grantPowerTokens(game, figureKey, tokenType, 1);
  await logGameAction(game, client, `🎯 **Arms Distribution (Deploy)** — **${dcName}** gains **1 ${tokenType} Token**.`, { phase: 'ROUND', icon: 'deployed' });
  if (game.pendingPowerTokenOverflow?.length > 0) {
    await sendPowerTokenOverflowUI(game, gameId, interaction.channel, playerNum, saveGames);
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  game.postDeployQueue.activeAbility = null;
  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  saveGames();
}

/**
 * Companion deploy: player picks a space to deploy the companion.
 */
export async function handleCompanionDeployPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  // customId: pd_comp_space_${gameId}_${playerNum}_${space}
  const parts = splitCustomId(interaction.customId, 'pd_comp_space_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const space = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can deploy companions.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'companion_deploy') {
    await interaction.followUp({ content: 'No companion deploy in progress.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const normSpace = normalizeCoord(space);
  const companionKey = `${active.companionName}-0-0`;
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][companionKey] = normSpace;
  game[`companionDeployed_${active.msgId}`] = true;

  // Track companion → host relationship for activation
  game.companionHostMap = game.companionHostMap || {};
  game.companionHostMap[companionKey] = { hostFigureKey: active.figureKey, playerNum };

  await logGameAction(game, client, `👶 **${active.companionName}** deployed at **${normSpace.toUpperCase()}** (${active.dcName}'s companion).`, { phase: 'ROUND', icon: 'deployed' });

  // Create DC embed for companion in Play Area
  const embedDeps = _companionEmbedDeps.get(gameId);
  if (embedDeps) {
    try {
      await _createCompanionDcEmbed(game, active.companionName, playerNum, active.msgId, client, embedDeps);
    } catch (err) {
      console.error(`[post-deploy] Failed to create companion DC embed for ${active.companionName}:`, err.message);
    }
  }

  await interaction.message.edit({ components: [] }).catch(discordCatch);

  game.postDeployQueue.activeAbility = null;
  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  saveGames();
}
