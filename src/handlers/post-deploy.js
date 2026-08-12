/**
 * Post-deploy ability ordering and execution system.
 * After deployment (round 1), players choose the order of their post-deploy abilities.
 * Initiative player resolves first, then the other player.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getDcStats, getMapData, getDeploymentZones, getFigureSize, dcAbilityFlags } from '../data-loader.js';
import { dcNameFromFigureKey, applyCondition, grantPowerTokens, buildFigureButtonLabel } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getInitiativePlayerNum, opponentPlayerNum, getHandChannelId,
} from '../game/player-helpers.js';
import { normalizeCoord, getFootprintCells } from '../game/coords.js';
import { countSpaces } from '../game/spatial.js';
import { edgeKey } from '../game/coords.js';
import { getMapTokensData } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { sendPowerTokenOverflowUI } from './combat.js';
import { requireGame } from '../utils/guards.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { findDcMessageIdForFigure } from '../engine/game-readers.js';
import { splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';

// Module-level storage for companion DC embed deps (keyed by gameId).
// Set by runPostDeployPhase when ctx includes embed deps, consumed by resolveAutoAbility,
// cleaned up in finishPostDeploy.
const _companionEmbedDeps = new Map();

// Module-level storage for the post-deploy completion callback (keyed by gameId).
// Stored here instead of on `game` because callbacks are functions — JSON.stringify
// would silently strip them on save, stranding the game post-restart. If this map
// is empty on finishPostDeploy (e.g. process restart), the refresh safety net in
// refreshAllGameComponents re-posts CC draw prompts from pure state.
const _postDeployCallbacks = new Map();

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
    // When-deployed keyword flags can live in either `passives` or `abilities`
    // (2026-06-15 data split moved named ability flags into `abilities`), so scan
    // the union via dcAbilityFlags for these checks.
    const flags = dcAbilityFlags(eff);

    if (passives.includes('Beskar Armor')) {
      abilities.push({ abilityId: 'beskar_armor', label: 'Beskar Armor', dcName, figureKey: fk, playerNum, interactive: false, type: 'token' });
    }
    if (flags.includes('Stealthy')) {
      abilities.push({ abilityId: 'stealthy', label: 'Stealthy', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (flags.includes('Ambush')) {
      abilities.push({ abilityId: 'ambush', label: 'Ambush', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (flags.includes('In The Shadows')) {
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
    // Rebel Pathfinder's Infiltration lives in specialAbilityIds, not passives
    // (alexanbv 2026-06-20 — the passive check alone never enumerated it).
    if (passives.includes('Infiltration') || sIds.includes('infiltration_rebel_pathfinder')) {
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
    // Loku Set Your Sights: at start of mission, place a Recon token on
    // a unique hostile figure. Once-per-game (game.reconTokens[playerNum]
    // persists); de-dupe by player so the picker only fires once.
    if (sIds.includes('set_your_sights_loku') && !game[`setYourSightsFired_p${playerNum}`]) {
      abilities.push({ abilityId: 'set_your_sights', label: 'Set Your Sights', dcName, figureKey: fk, playerNum, interactive: true, type: 'figure_pick' });
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
        const companionKey = `${companionName}-1-0`;
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
 *
 * Exported as `createCompanionDcEmbed` (no underscore) so the checkpoint
 * loader can call it during a post-load companion recreation pass.
 * Internal name preserved as `_createCompanionDcEmbed` for the existing
 * post-deploy callers.
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

  // Register companion msgId at the host DC's index FIRST. The Derived
  // dcMessageMeta / dcHealthState views resolve companion msgIds by
  // walking p{n}DcCompanionMessageIds — without this prior write, the
  // .set() calls below find no meta and silently no-op (audit
  // 2026-05-05). Must come before dcHealthState.set so HP gets stored
  // canonically into game.companionHealthState[msg.id].
  const hostMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  const companionMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
  const hostIdx = hostMsgIds?.indexOf(hostMsgId);
  if (hostIdx >= 0 && companionMsgIds) {
    companionMsgIds[hostIdx] = msg.id;
  }

  // dcMessageMeta.set on a companion is still a no-op (Derived view's
  // resolution is now automatic via the parallel-array fallback) but
  // we keep the call for symmetry with host-DC creation. dcExhaustedState
  // .set is also no-op for companions. Only dcHealthState.set actually
  // writes through — to game.companionHealthState[msgId].
  dcMessageMeta.set(msg.id, { gameId: game.gameId, playerNum, dcName: companionName, displayName });
  dcExhaustedState.set(msg.id, false);
  dcHealthState.set(msg.id, healthState);

  const components = getDcPlayAreaComponents(msg.id, false, game, companionName);
  await msg.edit({ components });
}

/**
 * Programmatic companion deploy (mid-game, NO interactive picker). Mirrors the
 * core of handleCompanionDeployPick — placement + companionHostMap + the SAME
 * _createCompanionDcEmbed (DC embed, banks, host map, board image) — but is driven
 * by a directive from an ability resolver instead of a button click. Used by the
 * apply layer to deploy J4X-7 for Droid Mastery exactly the way The Child / other
 * companions enter play (alexanbv 2026-06-20 ruling).
 *
 * @param {object} game
 * @param {object} d - { companionName, hostFigureKey, playerNum, space }
 * @param {import('discord.js').Client} client
 * @param {object} deps - { buildDcEmbedAndFiles, dcMessageMeta, dcExhaustedState,
 *   dcHealthState, getDcPlayAreaComponents, getNicknamesForDcMessage?, logGameAction? }
 * @returns {Promise<{ ok: boolean, companionKey?: string, space?: string }>}
 */
export async function deployCompanionFigure(game, d, client, deps) {
  const { companionName, hostFigureKey, playerNum } = d || {};
  if (!game || !companionName || !hostFigureKey || !playerNum) return { ok: false };
  const hostPos = game.figurePositions?.[playerNum]?.[hostFigureKey];
  if (!hostPos) return { ok: false }; // host not on board → cannot place
  const normSpace = normalizeCoord(d.space || hostPos); // CSV: "into your space" (host space)
  const companionKey = `${companionName}-1-0`;
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
  game.figurePositions[playerNum][companionKey] = normSpace;

  // Track companion → host relationship (same shape as handleCompanionDeployPick).
  game.companionHostMap = game.companionHostMap || {};
  game.companionHostMap[companionKey] = { hostFigureKey, playerNum };

  // Resolve the host DC's msgId so the companion embed registers at the host's
  // index (the parallel-array fallback used by _createCompanionDcEmbed).
  const hostMsgId = findCompanionHostMsgId(game, playerNum, hostFigureKey, deps?.dcMessageMeta);
  if (hostMsgId != null) game[`companionDeployed_${hostMsgId}`] = true;

  if (deps?.logGameAction) {
    await deps.logGameAction(game, client, `👶 **${companionName}** deployed at **${normSpace.toUpperCase()}** (${dcNameFromFigureKey(hostFigureKey)}'s companion).`, { phase: 'ROUND', icon: 'deployed' }).catch(discordCatch);
  }

  // Build the companion DC embed via the SAME routine the interactive deploy uses.
  if (hostMsgId != null && deps?.buildDcEmbedAndFiles && deps?.getDcPlayAreaComponents) {
    try {
      await _createCompanionDcEmbed(game, companionName, playerNum, hostMsgId, client, {
        buildDcEmbedAndFiles: deps.buildDcEmbedAndFiles,
        dcMessageMeta: deps.dcMessageMeta,
        dcExhaustedState: deps.dcExhaustedState,
        dcHealthState: deps.dcHealthState,
        getDcPlayAreaComponents: deps.getDcPlayAreaComponents,
        getNicknamesForDcMessage: deps.getNicknamesForDcMessage || (() => undefined),
      });
    } catch (err) {
      console.error(`[post-deploy] deployCompanionFigure embed failed for ${companionName}:`, err?.message ?? err);
    }
  }
  return { ok: true, companionKey, space: normSpace };
}

/** Resolve the host DC's Discord msgId from its figureKey via dcMessageMeta. */
function findCompanionHostMsgId(game, playerNum, hostFigureKey, dcMessageMeta) {
  if (!dcMessageMeta) return null;
  const fkMatch = String(hostFigureKey).match(/-(\d+)-(\d+)$/);
  const hostDc = dcNameFromFigureKey(hostFigureKey);
  for (const [mId, mMeta] of dcMessageMeta) {
    if (mMeta.gameId !== game.gameId || mMeta.playerNum !== playerNum || mMeta.dcName !== hostDc) continue;
    if (!fkMatch) return mId;
    const dgM = (mMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIdx = dgM ? dgM[1] : '1';
    if (String(dgIdx) === String(fkMatch[1])) return mId;
  }
  return null;
}

/**
 * Public wrapper around the internal companion-embed creator. Used by the
 * checkpoint loader to recreate companion play-area messages for DCs that
 * had companion attachments at save time but lost their companion msg
 * during the cross-lobby restore.
 */
export async function createCompanionDcEmbed(game, companionName, playerNum, hostMsgId, client, deps) {
  return _createCompanionDcEmbed(game, companionName, playerNum, hostMsgId, client, deps);
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
      if (saveGames) saveGames(game.gameId);
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
      if (saveGames) saveGames(game.gameId);
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
      if (saveGames) saveGames(game.gameId);
      return;
    }
    fig = active.moveFigures[idx];
  }

  if (!fig) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
    if (saveGames) saveGames(game.gameId);
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

  // Find the card for THIS figure — group-aware. alexanbv 2026-08-12: "Granted
  // MP ... need to be granted to the chosen figure, NOT any figure with the same
  // name." This matched on dcName alone and took the first hit, so Smooth
  // Landing's "each adjacent friendly figure" could grant to the wrong group of
  // a duplicated card. figureKey is right here and carries the group index.
  const msgId = findDcMessageIdForFigure(game.gameId, playerNum, figureKey, dcMessageMeta);
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
    if (saveGames) saveGames(game.gameId);
    return;
  }

  // Migrated 2026-05-09: pendingOrderedMove → pendingMoveX. Post-deploy
  // moves now use the move-x picker (step-by-step, Stop button,
  // MASSIVE displacement at end via _finishPicker → _runMassiveDisplacement).
  // afterAction: 'postDeployAdvance' fires _advanceAfterFigure once the
  // picker drains, advancing the post-deploy queue.
  const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
  await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
    figures: [{ msgId, figureKey, playerNum, spaces: mp, dcName }],
    source: active.abilityLabel || 'Post-Deploy Move',
    threadId: null,
    bypassCosts: false,
    afterAction: { type: 'postDeployAdvance' },
  });
  if (saveGames) saveGames(game.gameId);
}

/**
 * Single entry point: advance after a figure finishes movement (or is skipped).
 * Handles all ability types — smooth_landing (resolved-figure tracking + picker),
 * strike_team (index-based + token distribution transition), and others (index-based).
 * @param {string} figureKey — REQUIRED: the figure that just finished.
 */
export async function _advanceAfterFigure(game, gameId, client, ctx, figureKey) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;
  const active = q.activeAbility;

  // No active ability or no moveFigures → ability is done
  if (!active || !active.moveFigures) {
    if (active) q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
    if (saveGames) saveGames(game.gameId);
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
      if (saveGames) saveGames(game.gameId);
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
      // Smooth Landing grants 1 MP to Bodhi + each adjacent friendly.
      // Per the gain-MP rules audit (rule 1: out-of-activation), the
      // MP must be spent IMMEDIATELY by each figure — no banking.
      // Multi-figure → orchestrate via setupPendingMoveXSequence so
      // the player picks the order. afterAction: postDeployAdvance
      // drains the post-deploy queue once every figure is done.
      const labels = ability.moveFigures.map(f => f.dcName);
      await logGameAction(game, client, `🛬 **Smooth Landing** — ${labels.join(', ')} gain${labels.length === 1 ? 's' : ''} **1 MP** after deployment. Pick order; each figure spends immediately.`, { phase: 'ROUND', icon: 'deployed' });
      const seqFigures = [];
      for (const mf of ability.moveFigures) {
        let mid = null;
        for (const [m, meta] of dcMessageMeta) {
          if (meta.dcName === mf.dcName && meta.playerNum === ability.playerNum) { mid = m; break; }
        }
        if (mid) seqFigures.push({ msgId: mid, figureKey: mf.figureKey, playerNum: ability.playerNum, spaces: mf.mp, dcName: mf.dcName });
      }
      if (seqFigures.length === 0) {
        await logGameAction(game, client, `🛬 **Smooth Landing** — no eligible figures resolved.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = null;
        await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
        break;
      }
      game.postDeployQueue.activeAbility = { abilityId: 'smooth_landing', abilityLabel: 'Smooth Landing', playerNum: ability.playerNum };
      const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
      await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
        figures: seqFigures,
        source: 'Smooth Landing',
        threadId: null,
        bypassCosts: false,
        afterAction: { type: 'postDeployAdvance' },
      });
      break;
    }
    case 'forward_emplacement': {
      // Forward Emplacement grants speed-MP to one figure post-deploy
      // (out-of-activation gain — rule 1). Picker is the spend UI;
      // remaining MP discarded if the player stops early. Single
      // figure → sequence-of-one (auto-advance, no order prompt).
      await logGameAction(game, client, `🏗️ **Forward Emplacement** — **${ability.dcName}** gains **${ability.mp} MP** after deployment. Spend immediately.`, { phase: 'ROUND', icon: 'deployed' });
      let mid = null;
      for (const [m, meta] of dcMessageMeta) {
        if (meta.dcName === ability.dcName && meta.playerNum === ability.playerNum) { mid = m; break; }
      }
      if (!mid) {
        await logGameAction(game, client, `⚠️ **Forward Emplacement** — could not locate **${ability.dcName}**'s play area; skipping.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = null;
        await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
        break;
      }
      game.postDeployQueue.activeAbility = { abilityId: 'forward_emplacement', abilityLabel: 'Forward Emplacement', playerNum: ability.playerNum };
      const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
      await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
        figures: [{ msgId: mid, figureKey: ability.figureKey, playerNum: ability.playerNum, spaces: ability.mp, dcName: ability.dcName }],
        source: 'Forward Emplacement',
        threadId: null,
        bypassCosts: false,
        afterAction: { type: 'postDeployAdvance' },
      });
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

      const findMidForDc = (dcName) => {
        if (!dcMessageMeta) return null;
        for (const [m, meta] of dcMessageMeta) {
          if (meta.dcName === dcName && meta.playerNum === ability.playerNum) return m;
        }
        return null;
      };
      if (adjFriendlies.length === 0) {
        // No adjacent friendlies — Cassian moves alone via sequence-of-one,
        // then token distribution.
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** gains **2 MP**. No adjacent friendly figures for additional MP.`, { phase: 'ROUND', icon: 'deployed' });
        const cassianMid = findMidForDc(ability.dcName);
        game.postDeployQueue.activeAbility = {
          abilityId: 'strike_team',
          abilityLabel: 'Strike Team',
          step: 'movement_sequence',
          playerNum: ability.playerNum,
          figureKey: ability.figureKey,
          tokenRemaining: 4,
          alreadyReceived: [],
        };
        if (cassianMid) {
          const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
          await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
            figures: [{ msgId: cassianMid, figureKey: ability.figureKey, playerNum: ability.playerNum, spaces: 2, dcName: ability.dcName }],
            source: 'Strike Team', threadId: null, bypassCosts: false,
            afterAction: { type: 'strikeTeamTokenDistrib', playerNum: ability.playerNum },
          });
        }
      } else if (adjFriendlies.length === 1) {
        // Single adjacent — auto-pick recipient, then orchestrator's order
        // picker handles movement order, then token distribution.
        const friend = adjFriendlies[0];
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** and **${friend.dcName}** each gain **2 MP**.`, { phase: 'ROUND', icon: 'deployed' });
        const cassianMid = findMidForDc(ability.dcName);
        const friendMid = findMidForDc(friend.dcName);
        game.postDeployQueue.activeAbility = {
          abilityId: 'strike_team',
          abilityLabel: 'Strike Team',
          step: 'movement_sequence',
          playerNum: ability.playerNum,
          figureKey: ability.figureKey,
          tokenRemaining: 4,
          alreadyReceived: [],
        };
        const figures = [];
        if (cassianMid) figures.push({ msgId: cassianMid, figureKey: ability.figureKey, playerNum: ability.playerNum, spaces: 2, dcName: ability.dcName });
        if (friendMid) figures.push({ msgId: friendMid, figureKey: friend.figureKey, playerNum: ability.playerNum, spaces: 2, dcName: friend.dcName });
        if (figures.length > 0) {
          const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
          await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
            figures, source: 'Strike Team', threadId: null, bypassCosts: false,
            afterAction: { type: 'strikeTeamTokenDistrib', playerNum: ability.playerNum },
          });
        }
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
      // Infiltration: each Pathfinder in the deployed group may move
      // up to 6 spaces post-deploy. Move-X per CRR MOVE-017 — picker
      // walks 1 space at a time, bypassCosts true, no banking. Player
      // picks resolution order via the multi-figure orchestrator.
      const figures = ability.figureKeys || [ability.figureKey];
      const seqFigures = [];
      for (const fk of figures) {
        const dn = dcNameFromFigureKey(fk);
        let mid = null;
        for (const [m, meta] of dcMessageMeta) {
          if (meta.dcName === dn && meta.playerNum === ability.playerNum) { mid = m; break; }
        }
        if (mid) seqFigures.push({ msgId: mid, figureKey: fk, playerNum: ability.playerNum, spaces: ability.mpPerFigure || 6, dcName: dn });
      }
      if (seqFigures.length === 0) {
        await logGameAction(game, client, `🥾 **Infiltration** — no eligible figures resolved.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = null;
        await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
        break;
      }
      await logGameAction(game, client, `🥾 **Infiltration** — ${seqFigures.length} **${ability.dcName}** figure${seqFigures.length === 1 ? '' : 's'} may each move up to ${ability.mpPerFigure || 6} spaces. Pick order.`, { phase: 'ROUND', icon: 'deployed' });
      game.postDeployQueue.activeAbility = { abilityId: 'infiltration', abilityLabel: 'Infiltration', playerNum: ability.playerNum };
      const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
      await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
        figures: seqFigures,
        source: 'Infiltration',
        threadId: null,
        bypassCosts: true,
        afterAction: { type: 'postDeployAdvance' },
      });
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
        const dist = countSpaces(_adMs, kotunPos, fpos, _adClosedDoorEdges, 50, game);
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
    case 'set_your_sights': {
      // Loku Kanoloa: "At the start of the mission, place a Recon
      // token on a unique hostile figure." Find every UNIQUE hostile
      // figure and present a picker. The chosen figure carries the
      // recon token for the rest of the game (see combat.js for the
      // Pierce 1 application + Mon Cala SF Focus trigger).
      const oppPN = opponentPlayerNum(ability.playerNum);
      const dcEffectsLocal = getDcEffects() || {};
      const hostilePositions = game.figurePositions?.[oppPN] || {};
      const uniqueHostiles = [];
      for (const [hfk, hpos] of Object.entries(hostilePositions)) {
        if (!hpos) continue;
        const hDcName = dcNameFromFigureKey(hfk);
        const hEff = dcEffectsLocal[hDcName] || dcEffectsLocal[hDcName?.replace(/\s*\(Elite\)\s*$/, '')];
        if (!hEff?.unique) continue;
        uniqueHostiles.push({ figureKey: hfk, dcName: hDcName });
      }
      if (uniqueHostiles.length === 0) {
        await logGameAction(game, client, `🎯 **Set Your Sights** — No unique hostile figures on the board for **${ability.dcName}**; recon token not placed.`, { phase: 'ROUND', icon: 'deployed' });
        game[`setYourSightsFired_p${ability.playerNum}`] = true;
        game.postDeployQueue.activeAbility = null; game.postDeployQueue.pendingActions = null;
        await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
        break;
      }
      game.postDeployQueue.activeAbility = {
        abilityId: 'set_your_sights',
        playerNum: ability.playerNum,
        dcName: ability.dcName,
        figureKey: ability.figureKey,
        candidates: uniqueHostiles,
      };
      const sysBtns = uniqueHostiles.slice(0, 20).map(h => new ButtonBuilder()
        .setCustomId(`pd_set_your_sights_pick_${gameId}_${ability.playerNum}_${h.figureKey}`)
        .setLabel(buildFigureButtonLabel(h.figureKey, game))
        .setStyle(ButtonStyle.Danger)
      );
      _stashPendingActions(game, sysBtns, 'Set Your Sights');
      const sysRows = chunkButtonsToRows(sysBtns);
      await logGameAction(game, client, `🎯 **Set Your Sights** — <@${ownerId}>, place a **Recon token** on a unique hostile figure for **${ability.dcName}**:`, {
        components: sysRows.slice(0, 5),
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
      // Scavenged Walker grants speed-MP after deployment (out-of-
      // activation gain — rule 1). Previous flow had a separate Y/N
      // "Perform Move / Skip" prompt; that's redundant now that the
      // pendingMoveX picker exposes its own "Stop (discard remaining)"
      // button — the player can just click Stop without moving.
      game[`scavengedWalkerDeployMoveFired_${ability.msgId}`] = true;
      const dcEffectsData = getDcEffects() || {};
      const walkerEff = dcEffectsData[ability.dcName];
      const walkerMp = walkerEff?.speed || 4;
      await logGameAction(game, client, `🚜 **Scavenged Walker** — **${ability.dcName}** may move up to ${walkerMp} MP after deployment (Stop discards remaining).`, { phase: 'ROUND', icon: 'deployed' });
      game.postDeployQueue.activeAbility = { abilityId: 'scavenged_walker_move', abilityLabel: 'Scavenged Walker', playerNum: ability.playerNum, msgId: ability.msgId };
      const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
      await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
        figures: [{ msgId: ability.msgId, figureKey: ability.figureKey, playerNum: ability.playerNum, spaces: walkerMp, dcName: ability.dcName }],
        source: 'Scavenged Walker',
        threadId: null,
        bypassCosts: false,
        afterAction: { type: 'postDeployAdvance' },
      });
      break;
    }
  }
}

// ── Strike Team: Damage Token distribution ──────────────────────────────────────

export async function _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction) {
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
  await renderPostDeployChooserPrompt(game, gameId, client, { logGameAction });
}

/**
 * Render-from-state: post the "After Deployment" ability chooser from pure
 * game state (postDeployQueue.abilities, already filtered to interactive).
 * Records the resulting msg into game.promptMessageIds.postDeployChooser.
 */
export async function renderPostDeployChooserPrompt(game, gameId, client, ctx) {
  const q = game.postDeployQueue;
  if (!q) return;
  const interactiveAbilities = (q.abilities || []).filter((a) => a.interactive);
  if (interactiveAbilities.length === 0) return;
  const ownerId = getPlayerId(game, q.currentPlayerNum);
  const playerLabel = `Player ${q.currentPlayerNum}`;
  const btns = interactiveAbilities.map((ab, idx) =>
    new ButtonBuilder()
      .setCustomId(`pd_pick_${gameId}_${q.currentPlayerNum}_${idx}`)
      .setLabel(`${ab.label} — ${ab.dcName}`)
      .setStyle(ButtonStyle.Primary)
  );
  const rows = chunkButtonsToRows(btns);
  const logGameAction = ctx?.logGameAction;
  if (!logGameAction) return;
  const sent = await logGameAction(game, client, `📋 **After Deployment** — <@${ownerId}> (${playerLabel}), choose which ability to resolve next (${interactiveAbilities.length} remaining):`, {
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
  if (sent?.id) {
    const { recordPromptMessage, signatureFor } = await import('../engine/prompt-reconciler.js');
    recordPromptMessage(game, 'postDeployChooser', sent.channelId || sent.channel?.id, sent.id, signatureFor('postDeployChooser', game));
  }
}

/**
 * Render-from-state: post the Scavenged Walker "Perform Move / Skip" prompt
 * from game.postDeployQueue.activeAbility. Records msg into
 * game.promptMessageIds.walkerMove.
 */
export async function renderWalkerMovePrompt(game, gameId, client, ctx) {
  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'scavenged_walker_move') return;
  const fig = active.moveFigures?.[0];
  if (!fig) return;
  const msgId = active.msgId || '';
  const ownerId = getPlayerId(game, active.playerNum);
  const btns = [
    new ButtonBuilder().setCustomId(`pd_walker_move_${gameId}_${active.playerNum}_${msgId}`).setLabel('Perform Move').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pd_walker_skip_${gameId}_${active.playerNum}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  ];
  _stashPendingActions(game, btns, 'Scavenged Walker');
  const logGameAction = ctx?.logGameAction;
  if (!logGameAction) return;
  const sent = await logGameAction(game, client, `🚶 **Scavenged Walker** — <@${ownerId}>, **${fig.dcName}** may perform a move after deployment:`, {
    components: [new ActionRowBuilder().addComponents(btns)],
    allowedMentions: { users: [ownerId] },
  });
  if (sent?.id) {
    const { recordPromptMessage, signatureFor } = await import('../engine/prompt-reconciler.js');
    recordPromptMessage(game, 'walkerMove', sent.channelId || sent.channel?.id, sent.id, signatureFor('walkerMove', game));
  }
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
  const cb = _postDeployCallbacks.get(gameId);
  _postDeployCallbacks.delete(gameId);
  // Legacy migration: drop stale serialized callback artifact so DB doesn't keep it.
  if (game._postDeployCallback) delete game._postDeployCallback;
  if (cb) {
    await cb();
    return;
  }
  // Callback missing (process restarted between runPostDeployPhase and
  // finishPostDeploy). For the cc_draw transition, post shuffle/draw prompts
  // directly from pure state so the game can still advance without a manual
  // Refresh. Refresh path has its own safety net for the belt-and-suspenders case.
  if (game.phase === 'cc_draw' && !game.ccShuffleDrawPromptsPosted) {
    try {
      const [{ sendCcShuffleDrawPrompts }, { getCcShuffleDrawButton }, { getInitiativePlayerZoneLabel }] = await Promise.all([
        import('../engine/cc-draw-prompts.js'),
        import('../discord/components.js'),
        import('../discord/embeds.js'),
      ]);
      await sendCcShuffleDrawPrompts(game, client, {
        getCcShuffleDrawButton, getInitiativePlayerZoneLabel,
      });
    } catch (err) {
      console.error('finishPostDeploy: CC prompt auto-recovery failed', err);
    }
  }
  // Draft Random restart-strand fallback: post-deploy finished but callback
  // (which sets ACTIVATION phase + posts the round message) was dropped. Pure
  // state says we're in ROUND_ACTIVE/START_OF_ROUND with no activation message
  // posted — advance to ACTIVATION. Message posting itself relies on the
  // refresh safety net (which has the full dep graph); bot auto-refresh on
  // startup means this state is visible before user interactions fire.
  if (
    game.phase === 'round_active'
    && game.roundPhase === 'start_of_round'
    && !game.activationPhaseMessagePosted
  ) {
    try {
      const { setRoundPhase, ROUND_PHASES } = await import('../game/phase.js');
      setRoundPhase(game, ROUND_PHASES.ACTIVATION);
    } catch (err) {
      console.error('finishPostDeploy: activation phase auto-recovery failed', err);
    }
  }
}

/**
 * Clean up module-level _companionEmbedDeps for a game (e.g. when game is killed).
 * @param {string} gameId
 */
export function cleanupCompanionEmbedDeps(gameId) {
  _companionEmbedDeps.delete(gameId);
  _postDeployCallbacks.delete(gameId);
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
    if (saveGames) saveGames(game.gameId);
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

  // Store callback in module-level map (NOT on game — functions don't survive JSON.stringify).
  // If this process restarts before finishPostDeploy, the callback is lost; the CC-draw
  // safety net in refreshAllGameComponents will re-post prompts from state.
  if (onComplete) _postDeployCallbacks.set(gameId, onComplete);

  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  if (saveGames) saveGames(game.gameId);
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
  if (saveGames) saveGames(game.gameId);
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
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'postDeployChooser');

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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
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

  if (!active) {
    saveGames(game.gameId);
    return;
  }

  // Build sequence figures for Cassian + the chosen friend. Resolve
  // each msgId via dcMessageMeta lookup. The orchestrator's order
  // picker replaces the legacy "Move X first / Move Y first" buttons
  // — same UX, fewer codepaths.
  // Resolve by FIGURE, not by card name. alexanbv 2026-08-12: "Granted MP are
  // often to non-unique figures. They need to be granted to the chosen figure,
  // NOT any figure with the same name."
  //
  // The old local lookup matched on dcName + playerNum and returned the FIRST
  // hit, so with two groups of the same card in the army it could hand the 2 MP
  // to the wrong group's card. Cassian is unique and was safe; the adjacent
  // friendly figure the player chooses very often is not.
  //
  // findDcMessageIdForFigure parses the group index out of the figureKey and
  // matches it against each card's [Group N] tag, so it lands on the group the
  // player actually picked.
  const dcMessageMetaCtx = ctx.dcMessageMeta;
  const midForFigure = (fk) => (
    dcMessageMetaCtx && fk ? findDcMessageIdForFigure(game.gameId, playerNum, fk, dcMessageMetaCtx) : null
  );
  const seqFigures = [];
  const cassianMid = midForFigure(cassianFk);
  if (cassianMid && cassianFk) seqFigures.push({ msgId: cassianMid, figureKey: cassianFk, playerNum, spaces: 2, dcName: cassianName });
  const friendMid = midForFigure(friendFk);
  if (friendMid) seqFigures.push({ msgId: friendMid, figureKey: friendFk, playerNum, spaces: 2, dcName: friendDcName });
  if (seqFigures.length === 0) {
    await logGameAction(game, client, `⚡ **Strike Team** — could not locate play area messages; skipping movement.`, { phase: 'ROUND', icon: 'deployed' });
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
    saveGames(game.gameId);
    return;
  }

  // Persist activeAbility state needed by the token-distribution
  // afterAction (tokenRemaining, alreadyReceived). The Strike Team
  // ability stays "active" through the sequence and into the token
  // step; it clears when token distribution completes.
  active.step = 'movement_sequence';
  active.tokenRemaining = active.tokenRemaining ?? 4;
  active.alreadyReceived = active.alreadyReceived || [];
  const { setupPendingMoveXSequence } = await import('./move-x-handler.js');
  await setupPendingMoveXSequence(game, { client, logGameAction, saveGames }, {
    figures: seqFigures,
    source: 'Strike Team',
    threadId: null,
    bypassCosts: false,
    afterAction: { type: 'strikeTeamTokenDistrib', playerNum },
  });
  saveGames(game.gameId);
}

// handleStrikeTeamOrderPick removed: the orchestrator's order picker
// (game.pendingMoveXSequence) now handles movement order for Strike
// Team via setupPendingMoveXSequence + the move_x_seq_pick_ button.

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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
}

// REMOVED 2026-05-09: handlePostDeployMoveSkip — pendingOrderedMove
// pipeline retired; post-deploy moves now go through the move-x
// picker, whose Stop button covers the skip path. The pd_move_skip_
// button prefix is no longer emitted by any UI.

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
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'walkerMove');

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'scavenged_walker_move') return;

  // Start the movement flow
  await _startNextMovement(game, gameId, client, ctx);
  saveGames(game.gameId);
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
  const { clearPromptRecord } = await import('../engine/prompt-reconciler.js');
  clearPromptRecord(game, 'walkerMove');

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  }
  saveGames(game.gameId);
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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
}

/**
 * Called from movement.js handleMovePick when a postDeployReturn move finishes.
 * If massive displacement is still unresolved, record a lightweight descriptor
 * on game state and defer. The massive-push dispatcher resumes by calling
 * resumeDeferredPostDeployMove with its own ctx (movePick group) once the
 * displacement queue drains.
 *
 * The descriptor is pure state — no in-memory closures — so refresh and
 * restart paths can reconstruct the resume action from game alone.
 */
export async function onPostDeployMovementComplete(game, gameId, client, ctx, completedFigureKey) {
  const { saveGames } = ctx;
  if (game.pendingMassivePush) {
    game._postDeployMoveDeferred = { figureKey: completedFigureKey, at: Date.now() };
    if (saveGames) saveGames(game.gameId);
    return;
  }
  await _advanceAfterFigure(game, gameId, client, ctx, completedFigureKey);
  if (saveGames) saveGames(game.gameId);
}

/**
 * Resume a deferred post-deploy movement-complete advance. Called by the
 * massive-push dispatcher once the queue drains. Caller supplies the ctx
 * (movePick group) which is a superset of what _advanceAfterFigure needs.
 * No-op if nothing was deferred.
 */
export async function resumeDeferredPostDeployMove(game, gameId, client, ctx) {
  const deferred = game._postDeployMoveDeferred;
  if (!deferred) return;
  const figureKey = deferred.figureKey;
  delete game._postDeployMoveDeferred;
  await _advanceAfterFigure(game, gameId, client, ctx, figureKey);
  const saveGames = ctx?.saveGames;
  if (saveGames) saveGames(game.gameId);
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
  if (saveGames) saveGames(game.gameId);
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
  saveGames(game.gameId);
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
  saveGames(game.gameId);
}

/**
 * Set Your Sights (Loku Kanoloa): start-of-mission Recon token placement.
 * customId: pd_set_your_sights_pick_${gameId}_${playerNum}_${figureKey}
 */
export async function handleSetYourSightsPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'pd_set_your_sights_pick_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the owning player can place the Recon token.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'set_your_sights') return;

  // Player-sensitive: each player's Loku keeps its own Recon token, so mirror
  // matches (both players running Loku) don't overwrite each other. alexanbv 2026-06-17.
  game.reconTokens = game.reconTokens || {};
  game.reconTokens[playerNum] = { figureKey };
  game[`setYourSightsFired_p${playerNum}`] = true;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction(game, client, `🎯 **Set Your Sights** — Recon token placed on **${dcNameFromFigureKey(figureKey)}**.`, { phase: 'ROUND', icon: 'deployed' });

  game.postDeployQueue.activeAbility = null;
  await postAbilityPicker(game, gameId, client, logGameAction, saveGames);
  saveGames(game.gameId);
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
  const companionKey = `${active.companionName}-1-0`;
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
  saveGames(game.gameId);
}
