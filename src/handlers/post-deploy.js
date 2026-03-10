/**
 * Post-deploy ability ordering and execution system.
 * After deployment (round 1), players choose the order of their post-deploy abilities.
 * Initiative player resolves first, then the other player.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDcEffects, getMapSpaces, getDeploymentZones } from '../data-loader.js';
import { dcNameFromFigureKey, applyCondition } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getInitiativePlayerNum, opponentPlayerNum,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

// ── Ability scanning ────────────────────────────────────────────────────────

/**
 * Scan a single player's deployed figures and skirmish upgrades for post-deploy abilities.
 * Returns an array of ability descriptors.
 */
function scanPlayerPostDeployAbilities(game, playerNum) {
  const abilities = [];
  const dcEffects = getDcEffects() || {};

  // Scan deployed figures for DC passives
  for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
    if (!pos) continue;
    const dcName = dcNameFromFigureKey(fk);
    const eff = dcEffects[dcName];
    if (!eff) continue;
    const passives = eff.passives || [];

    if (passives.includes('Beskar Armor')) {
      abilities.push({ abilityId: 'beskar_armor', label: 'Beskar Armor', dcName, figureKey: fk, playerNum, interactive: false, type: 'token' });
    }
    if (passives.includes('Stealthy')) {
      abilities.push({ abilityId: 'stealthy', label: 'Stealthy', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (passives.includes('Ambush')) {
      abilities.push({ abilityId: 'ambush', label: 'Ambush', dcName, figureKey: fk, playerNum, interactive: false, type: 'condition' });
    }
    if (passives.includes('Forward Emplacement')) {
      abilities.push({ abilityId: 'forward_emplacement', label: 'Forward Emplacement', dcName, figureKey: fk, playerNum, interactive: false, type: 'mp', speed: eff.speed || 0 });
    }
    if (passives.includes('Smooth Landing')) {
      abilities.push({ abilityId: 'smooth_landing', label: 'Smooth Landing', dcName, figureKey: fk, playerNum, interactive: false, type: 'mp' });
    }
    if (passives.includes('Security Detail')) {
      // Check how many LEADERs this player has
      const leaders = [];
      for (const [lfk, lpos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
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
      // Find all figures in same deployment group
      const dgMatch = fk.match(/^(.+)-(\d+)-(\d+)$/);
      if (dgMatch) {
        const [, baseName, dgIdx] = dgMatch;
        const prefix = `${baseName}-${dgIdx}-`;
        const dgFigures = Object.keys(game.figurePositions?.[playerNum] || {}).filter(k => k.startsWith(prefix) && game.figurePositions[playerNum][k]);
        // Only add one Infiltration entry per DC name (avoid dupes from multi-figure DGs)
        if (!abilities.some(a => a.abilityId === 'infiltration' && a.dcName === dcName && a.playerNum === playerNum)) {
          abilities.push({ abilityId: 'infiltration', label: 'Infiltration', dcName, figureKey: fk, figureKeys: dgFigures, playerNum, interactive: true, type: 'movement', mpPerFigure: 6 });
        }
      }
    }
    // Strike Team: check specialAbilityIds
    const sIds = eff.specialAbilityIds || [];
    if (sIds.includes('strike_team_cassian') && !abilities.some(a => a.abilityId === 'strike_team' && a.playerNum === playerNum)) {
      abilities.push({ abilityId: 'strike_team', label: 'Strike Team', dcName, figureKey: fk, playerNum, interactive: true, type: 'complex' });
    }
  }

  // Scan skirmish upgrades (figureless DCs with attachments)
  const dcList = getDcList(game, playerNum) || [];
  const msgIds = getDcMessageIds(game, playerNum) || [];
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
      // Find the figure key for this DC
      const fk = Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith(dc.dcName + '-'));
      if (fk && !game[`scavengedWalkerDeployMoveFired_${mid}`]) {
        abilities.push({ abilityId: 'scavenged_walker_move', label: 'Scavenged Walker', dcName: dc.dcName, figureKey: fk, msgId: mid, playerNum, interactive: true, type: 'movement', optional: true });
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
  // Group auto-apply abilities by dcName+figureKey
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

  // Add auto groups
  for (const [fk, group] of autoByFk) {
    if (group.length === 1) {
      consolidated.push(group[0]);
    } else {
      // Multiple auto abilities on same figure — keep separate for clarity
      consolidated.push(...group);
    }
  }

  return consolidated;
}

// ── Auto-apply resolution ───────────────────────────────────────────────────

async function resolveAutoAbility(game, ability, client, logGameAction) {
  const { abilityId, dcName, figureKey, playerNum } = ability;

  switch (abilityId) {
    case 'beskar_armor': {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
      game.figurePowerTokens[figureKey].push('Block', 'Block');
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
    case 'forward_emplacement': {
      const speed = ability.speed || 0;
      if (speed > 0) {
        game.deployBonusMp = game.deployBonusMp || {};
        game.deployBonusMp[figureKey] = (game.deployBonusMp[figureKey] || 0) + speed;
        await logGameAction(game, client, `🏗️ **Forward Emplacement** — **${dcName}** gains **${speed} MP** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      }
      break;
    }
    case 'smooth_landing': {
      const pos = game.figurePositions?.[playerNum]?.[figureKey];
      if (pos) {
        game.deployBonusMp = game.deployBonusMp || {};
        game.deployBonusMp[figureKey] = (game.deployBonusMp[figureKey] || 0) + 1;
        const granted = [dcName];
        const ms = getMapSpaces(game.selectedMap?.id);
        const adj = (ms?.adjacency?.[String(pos).toLowerCase()] || []).map(a => String(a).toLowerCase());
        const done = new Set();
        for (const [afk, apos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
          if (!apos || afk === figureKey) continue;
          if (!adj.includes(String(apos).toLowerCase())) continue;
          if (done.has(afk)) continue;
          done.add(afk);
          game.deployBonusMp[afk] = (game.deployBonusMp[afk] || 0) + 1;
          granted.push(dcNameFromFigureKey(afk));
        }
        await logGameAction(game, client, `🛬 **Smooth Landing** — ${granted.join(', ')} gain${granted.length === 1 ? 's' : ''} **1 MP** after deployment.`, { phase: 'ROUND', icon: 'deployed' });
      }
      break;
    }
    case 'security_detail': {
      // Auto-resolve: pick the only LEADER (or first if somehow 0)
      const leaders = ability.leaders || [];
      if (leaders.length > 0) {
        const leader = leaders[0];
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[leader.figureKey] = game.figurePowerTokens[leader.figureKey] || [];
        game.figurePowerTokens[leader.figureKey].push('Block');
        await logGameAction(game, client, `🛡️ **Security Detail** — **${leader.dcName}** gains **1 Block Token** (from ${dcName}).`, { phase: 'ROUND', icon: 'deployed' });
      }
      break;
    }
  }
}

// ── Interactive ability posting ──────────────────────────────────────────────

async function postInteractiveAbility(game, gameId, ability, client, logGameAction) {
  const ownerId = getPlayerId(game, ability.playerNum);

  switch (ability.abilityId) {
    case 'security_detail': {
      const leaders = ability.leaders || [];
      const btns = leaders.map(l => new ButtonBuilder()
        .setCustomId(`pd_security_pick_${gameId}_${ability.playerNum}_${ability.figureKey}_${l.figureKey}`)
        .setLabel(l.dcName)
        .setStyle(ButtonStyle.Primary)
      );
      const rows = [];
      for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
      await logGameAction(game, client, `🛡️ **Security Detail** (${ability.dcName}) — <@${ownerId}>, choose which **LEADER** gains 1 Block Token:`, {
        components: rows,
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
    case 'strike_team': {
      // Step 1: Grant Cassian 2 MP
      game.deployBonusMp = game.deployBonusMp || {};
      game.deployBonusMp[ability.figureKey] = (game.deployBonusMp[ability.figureKey] || 0) + 2;

      // Find adjacent friendlies
      const pos = game.figurePositions?.[ability.playerNum]?.[ability.figureKey];
      const ms = getMapSpaces(game.selectedMap?.id);
      const adj = pos ? (ms?.adjacency?.[String(pos).toLowerCase()] || []).map(a => String(a).toLowerCase()) : [];
      const adjFriendlies = [];
      for (const [afk, apos] of Object.entries(game.figurePositions?.[ability.playerNum] || {})) {
        if (!apos || afk === ability.figureKey) continue;
        if (adj.includes(String(apos).toLowerCase())) {
          adjFriendlies.push({ figureKey: afk, dcName: dcNameFromFigureKey(afk) });
        }
      }

      if (adjFriendlies.length === 0) {
        // No adjacent friendlies — skip that part, go straight to Hit tokens
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** gains **2 MP**. No adjacent friendly figures for additional MP.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = { abilityId: 'strike_team', step: 'tokens', remaining: 4, playerNum: ability.playerNum, figureKey: ability.figureKey };
        await _postStrikeTeamTokenPicker(game, gameId, ability.playerNum, client, logGameAction);
      } else if (adjFriendlies.length === 1) {
        // Only one adjacent — auto-pick
        const friend = adjFriendlies[0];
        game.deployBonusMp[friend.figureKey] = (game.deployBonusMp[friend.figureKey] || 0) + 2;
        await logGameAction(game, client, `⚡ **Strike Team** — **${ability.dcName}** and **${friend.dcName}** each gain **2 MP**.`, { phase: 'ROUND', icon: 'deployed' });
        game.postDeployQueue.activeAbility = { abilityId: 'strike_team', step: 'tokens', remaining: 4, playerNum: ability.playerNum, figureKey: ability.figureKey };
        await _postStrikeTeamTokenPicker(game, gameId, ability.playerNum, client, logGameAction);
      } else {
        // Multiple adjacent — player picks
        game.postDeployQueue.activeAbility = { abilityId: 'strike_team', step: 'adj_pick', remaining: 4, playerNum: ability.playerNum, figureKey: ability.figureKey };
        const btns = adjFriendlies.map(f => new ButtonBuilder()
          .setCustomId(`pd_strike_adj_${gameId}_${ability.playerNum}_${f.figureKey}`)
          .setLabel(f.dcName)
          .setStyle(ButtonStyle.Primary)
        );
        const rows = [];
        for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
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
        figureKeys: figures,
        currentFigureIdx: 0,
        playerNum: ability.playerNum,
        dcName: ability.dcName,
        mpPerFigure: ability.mpPerFigure || 6,
      };
      await _postInfiltrationMovePicker(game, gameId, client, logGameAction);
      break;
    }
    case 'extra_armor': {
      game[`extraArmorFired_p${ability.playerNum}`] = true;
      const allFks = Object.keys(game.figurePositions?.[ability.playerNum] || {});
      if (allFks.length > 0) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game[`pendingExtraArmor_p${ability.playerNum}`] = { remaining: 4 };
        game.postDeployQueue.activeAbility = { abilityId: 'extra_armor', playerNum: ability.playerNum, remaining: 4 };
        const btns = allFks.slice(0, 20).map(fk => new ButtonBuilder()
          .setCustomId(`extra_armor_pick_${gameId}_${ability.playerNum}_${fk}`)
          .setLabel(fk.replace(/-\d+-\d+$/, ''))
          .setStyle(ButtonStyle.Primary)
        );
        const rows = [];
        for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
        await logGameAction(game, client, `🛡️ **Extra Armor** — <@${ownerId}>, distribute **4 Block Tokens** among your figures (4 remaining):`, {
          components: rows,
          allowedMentions: { users: [ownerId] },
        });
      }
      break;
    }
    case 'scavenged_walker_move': {
      game[`scavengedWalkerDeployMoveFired_${ability.msgId}`] = true;
      game.postDeployQueue.activeAbility = { abilityId: 'scavenged_walker_move', playerNum: ability.playerNum, figureKey: ability.figureKey, msgId: ability.msgId, dcName: ability.dcName };
      const btns = [
        new ButtonBuilder().setCustomId(`pd_walker_move_${gameId}_${ability.playerNum}_${ability.msgId}`).setLabel('Perform Move').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pd_walker_skip_${gameId}_${ability.playerNum}_${ability.msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await logGameAction(game, client, `🚶 **Scavenged Walker** — <@${ownerId}>, **${ability.dcName}** may perform a move after deployment:`, {
        components: [new ActionRowBuilder().addComponents(btns)],
        allowedMentions: { users: [ownerId] },
      });
      break;
    }
  }
}

// ── Strike Team: Hit Token distribution ──────────────────────────────────────

async function _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction) {
  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'strike_team') return;

  const ownerId = getPlayerId(game, playerNum);
  const dzData = getDeploymentZones();
  const mapId = game.selectedMap?.id;
  const zone = playerNum === 1 ? game.player1DeploymentZone : game.player2DeploymentZone;
  const dzSpaces = (dzData?.[mapId]?.[zone] || []).map(s => String(s).toLowerCase());
  const dzSet = new Set(dzSpaces);

  // Find friendlies outside deployment zone
  const outsideZone = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
    if (!pos) continue;
    if (!dzSet.has(String(pos).toLowerCase())) {
      outsideZone.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk) });
    }
  }

  if (outsideZone.length === 0 || active.remaining <= 0) {
    await logGameAction(game, client, `⚡ **Strike Team** — No friendly figures outside deployment zone (or no tokens remaining).`, { phase: 'ROUND', icon: 'deployed' });
    game.postDeployQueue.activeAbility = null;
    return;
  }

  const btns = outsideZone.slice(0, 20).map(f => new ButtonBuilder()
    .setCustomId(`pd_strike_token_${gameId}_${playerNum}_${f.figureKey}`)
    .setLabel(f.dcName)
    .setStyle(ButtonStyle.Primary)
  );
  btns.push(new ButtonBuilder()
    .setCustomId(`pd_strike_token_done_${gameId}_${playerNum}`)
    .setLabel(`Done (${active.remaining} remaining)`)
    .setStyle(ButtonStyle.Secondary)
  );
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  await logGameAction(game, client, `⚡ **Strike Team** — <@${ownerId}>, choose up to **${active.remaining}** friendly figure(s) outside your deployment zone to gain **1 Hit Token** each:`, {
    components: rows.slice(0, 5),
    allowedMentions: { users: [ownerId] },
  });
}

// ── Infiltration: movement picker ────────────────────────────────────────────

async function _postInfiltrationMovePicker(game, gameId, client, logGameAction) {
  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'infiltration') return;

  const figures = active.figureKeys || [];
  const idx = active.currentFigureIdx || 0;
  if (idx >= figures.length) {
    // All figures done
    game.postDeployQueue.activeAbility = null;
    return;
  }

  const fk = figures[idx];
  const dcName = dcNameFromFigureKey(fk);
  const ownerId = getPlayerId(game, active.playerNum);
  const mp = active.mpPerFigure || 6;

  const btns = [
    new ButtonBuilder().setCustomId(`pd_infiltrate_move_${gameId}_${active.playerNum}_${fk}`).setLabel(`Move ${dcName} (${mp} MP)`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pd_infiltrate_skip_${gameId}_${active.playerNum}_${fk}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  ];
  await logGameAction(game, client, `🏃 **Infiltration** — <@${ownerId}>, **${dcName}** may move up to **${mp}** spaces (figure ${idx + 1}/${figures.length}):`, {
    components: [new ActionRowBuilder().addComponents(btns)],
    allowedMentions: { users: [ownerId] },
  });
}

// ── Ability picker ──────────────────────────────────────────────────────────

async function postAbilityPicker(game, gameId, client, logGameAction) {
  const q = game.postDeployQueue;
  if (!q) return;

  const abilities = q.abilities || [];
  if (abilities.length === 0) {
    // Current player done — move to next player or finish
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
    }
    q.abilities = [];
    await advanceToNextPlayer(game, gameId, client, logGameAction);
    return;
  }

  q.awaitingOrder = true;
  const btns = abilities.map((ab, idx) => {
    const autoLabel = ab.interactive ? '' : ' (auto)';
    return new ButtonBuilder()
      .setCustomId(`pd_pick_${gameId}_${q.currentPlayerNum}_${idx}`)
      .setLabel(`${ab.label} — ${ab.dcName}${autoLabel}`)
      .setStyle(ab.interactive ? ButtonStyle.Primary : ButtonStyle.Secondary);
  });
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
  await logGameAction(game, client, `📋 **After Deployment** — <@${ownerId}> (${playerLabel}), choose which ability to resolve next (${abilities.length} remaining):`, {
    components: rows.slice(0, 5),
    allowedMentions: { users: [ownerId] },
  });
}

// ── Player advancement ──────────────────────────────────────────────────────

async function advanceToNextPlayer(game, gameId, client, logGameAction) {
  const q = game.postDeployQueue;
  if (!q) return;

  if (q.nextPlayerAbilities && q.nextPlayerAbilities.length > 0) {
    // Move to next player
    q.currentPlayerNum = opponentPlayerNum(q.currentPlayerNum);
    q.abilities = q.nextPlayerAbilities;
    q.nextPlayerAbilities = null;
    q.awaitingOrder = false;
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    // All done — clean up and proceed
    await finishPostDeploy(game, gameId, client, logGameAction);
  }
}

async function finishPostDeploy(game, gameId, client, logGameAction) {
  delete game.postDeployQueue;
  game.postDeployEffectsFired = true;
  // The caller (or advancePostDeployQueue) will trigger sendRoundActivationPhaseMessage
  // via the callback stored in the queue
  if (game._postDeployCallback) {
    const cb = game._postDeployCallback;
    delete game._postDeployCallback;
    await cb();
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point: replaces the old inline post-deploy block.
 * Called from runStartOfRoundDcEffects and handleEndStartOfRound.
 *
 * @param {object} game
 * @param {string} gameId
 * @param {object} client - Discord client
 * @param {object} ctx - { logGameAction, saveGames }
 * @param {function} onComplete - called when all post-deploy effects are done
 * @returns {boolean} true if a queue was created (async flow), false if all resolved immediately
 */
export async function runPostDeployPhase(game, gameId, client, ctx, onComplete) {
  const { logGameAction, saveGames } = ctx;

  if (game.postDeployEffectsFired) return false;

  const initPn = getInitiativePlayerNum(game);
  const otherPn = opponentPlayerNum(initPn);

  const initAbilities = consolidateAbilities(scanPlayerPostDeployAbilities(game, initPn));
  const otherAbilities = consolidateAbilities(scanPlayerPostDeployAbilities(game, otherPn));

  // No abilities at all — skip
  if (initAbilities.length === 0 && otherAbilities.length === 0) {
    game.postDeployEffectsFired = true;
    return false;
  }

  const initHasInteractive = initAbilities.some(a => a.interactive);
  const otherHasInteractive = otherAbilities.some(a => a.interactive);

  // All auto-apply for both players — resolve immediately
  if (!initHasInteractive && !otherHasInteractive) {
    game.postDeployEffectsFired = true;
    for (const ab of initAbilities) await resolveAutoAbility(game, ab, client, logGameAction);
    for (const ab of otherAbilities) await resolveAutoAbility(game, ab, client, logGameAction);
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

  await postAbilityPicker(game, gameId, client, logGameAction);
  if (saveGames) saveGames();
  return true;
}

/**
 * Called after an interactive sub-flow completes to advance the queue.
 * Also called from movement.js when postDeployReturn movement finishes.
 */
export async function advancePostDeployQueue(game, gameId, client, ctx) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;

  // Clear active ability
  q.activeAbility = null;

  // Post next picker
  await postAbilityPicker(game, gameId, client, logGameAction);
  if (saveGames) saveGames();
}

// ── Button handlers ─────────────────────────────────────────────────────────

/**
 * Player picks which ability to resolve next.
 */
export async function handlePostDeployPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_pick_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const abilityIdx = parseInt(parts[2], 10);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
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
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  if (!ability.interactive) {
    // Auto-resolve
    await resolveAutoAbility(game, ability, client, logGameAction);
    // Continue to next pick
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    // Start interactive sub-flow
    await postInteractiveAbility(game, gameId, ability, client, logGameAction);
  }
  saveGames();
}

/**
 * Security Detail: player picks which LEADER gets the Block Token.
 */
export async function handleSecurityDetailPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_security_pick_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  // parts[2..N-1] = source figure key, last part = leader figure key
  // Button ID: pd_security_pick_GAMEID_PN_SOURCEFK_LEADERFK
  // Since figure keys contain hyphens, we need a delimiter. Use the fact that
  // the source FK was passed as part of the button ID.
  // Actually, let's re-parse: customId = pd_security_pick_GAMEID_PN_LEADERFK
  const leaderFk = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const leaderDcName = dcNameFromFigureKey(leaderFk);
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[leaderFk] = game.figurePowerTokens[leaderFk] || [];
  game.figurePowerTokens[leaderFk].push('Block');
  await logGameAction(game, client, `🛡️ **Security Detail** — **${leaderDcName}** gains **1 Block Token**.`, { phase: 'ROUND', icon: 'deployed' });

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  // Advance queue
  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  }
  saveGames();
}

/**
 * Strike Team: player picks adjacent friendly for 2 MP.
 */
export async function handleStrikeTeamAdjPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_strike_adj_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const friendFk = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const friendDcName = dcNameFromFigureKey(friendFk);
  game.deployBonusMp = game.deployBonusMp || {};
  game.deployBonusMp[friendFk] = (game.deployBonusMp[friendFk] || 0) + 2;

  const active = game.postDeployQueue?.activeAbility;
  const cassianFk = active?.figureKey;
  const cassianName = cassianFk ? dcNameFromFigureKey(cassianFk) : 'Cassian Andor';
  await logGameAction(game, client, `⚡ **Strike Team** — **${cassianName}** and **${friendDcName}** each gain **2 MP**.`, { phase: 'ROUND', icon: 'deployed' });

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  // Move to token distribution step
  if (active) {
    active.step = 'tokens';
    await _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction);
    if (!active.step || active.remaining <= 0 || !game.postDeployQueue?.activeAbility) {
      // No figures outside zone — already auto-advanced
      await postAbilityPicker(game, gameId, client, logGameAction);
    }
  }
  saveGames();
}

/**
 * Strike Team: player picks a figure outside deployment zone for Hit Token.
 */
export async function handleStrikeTeamTokenPick(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_strike_token_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'strike_team') return;

  const dcName = dcNameFromFigureKey(figureKey);
  game.figurePowerTokens = game.figurePowerTokens || {};
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
  game.figurePowerTokens[figureKey].push('Hit');
  active.remaining -= 1;

  await logGameAction(game, client, `⚡ **Strike Team** — **${dcName}** gains **1 Hit Token** (${active.remaining} remaining).`, { phase: 'ROUND', icon: 'deployed' });

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  if (active.remaining <= 0) {
    game.postDeployQueue.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    await _postStrikeTeamTokenPicker(game, gameId, playerNum, client, logGameAction);
  }
  saveGames();
}

/**
 * Strike Team: player is done distributing Hit Tokens.
 */
export async function handleStrikeTeamTokenDone(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_strike_token_done_', '').split('_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  }
  saveGames();
}

/**
 * Infiltration: player starts movement for a Pathfinder figure.
 */
export async function handleInfiltrateMove(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client, dcMessageMeta, getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment, getMoveSpaceGridRows } = ctx;
  const parts = interaction.customId.replace('pd_infiltrate_move_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'infiltration') return;

  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) {
    await interaction.followUp({ content: 'Figure position not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const mp = active.mpPerFigure || 6;

  // Find the msgId for this figure's DC
  const dcName = dcNameFromFigureKey(figureKey);
  const dgMatch = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const figureIndex = dgMatch ? parseInt(dgMatch[3], 10) : 0;
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.dcName === dcName && meta.playerNum === playerNum) { msgId = mid; break; }
  }
  if (!msgId) {
    await interaction.followUp({ content: 'DC message not found. Cannot start movement.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Set up movement
  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    await interaction.followUp({ content: 'Map data missing.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(pos, mp, boardState, profile);
  if (cache.cells.size === 0) {
    await interaction.followUp({ content: 'No valid movement spaces. Skipping.', ephemeral: true }).catch(discordCatch);
    // Advance to next figure
    active.currentFigureIdx = (active.currentFigureIdx || 0) + 1;
    await _postInfiltrationMovePicker(game, gameId, client, logGameAction);
    if (!game.postDeployQueue?.activeAbility || (active.currentFigureIdx >= (active.figureKeys || []).length)) {
      game.postDeployQueue.activeAbility = null;
      await postAbilityPicker(game, gameId, client, logGameAction);
    }
    saveGames();
    return;
  }

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

  // Show movement grid
  const buttonSpaces = [...cache.cells.keys()];
  const isMultiTile = profile.size && profile.size !== '1x1';
  game.moveGridMessageIds = game.moveGridMessageIds || {};

  // Use the column-letter grid builder
  const { rows } = getMoveSpaceGridRows(msgId, figureIndex, buttonSpaces, boardState.mapSpaces, profile.size);
  const minimapCells = isMultiTile ? buttonSpaces.map(tl => {
    // bottomLeftCoord helper — inline simple version
    return tl; // simplified, movement.js does the actual coord math
  }) : buttonSpaces;

  const minimap = getMovementMinimapAttachment ? await getMovementMinimapAttachment(game, msgId, figureKey, minimapCells) : null;
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';

  // Post movement UI similar to handleMoveMp pattern but in game log channel
  const firstRows = rows.slice(0, 4);
  const adjustRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${msgId}_${figureIndex}`)
      .setLabel('🗺️ Pick Path Manually')
      .setStyle(ButtonStyle.Secondary)
  );
  firstRows.push(adjustRow);

  const payload = {
    content: `**Infiltration Move** — Pick a column for **${dcName}** (**${mp}** MP):${multiTileNote}`,
    components: firstRows,
    fetchReply: true,
  };
  if (minimap) payload.files = [minimap];

  const gridMsg = await interaction.followUp(payload).catch(() => null);
  game.moveGridMessageIds[moveKey] = gridMsg?.id ? [gridMsg.id] : [];

  // Post overflow rows
  for (let i = 4; i < rows.length; i += 5) {
    const more = rows.slice(i, i + 5);
    if (more.length > 0) {
      const follow = await interaction.channel.send({ content: null, components: more }).catch(() => null);
      if (follow?.id) game.moveGridMessageIds[moveKey].push(follow.id);
    }
  }

  saveGames();
}

/**
 * Infiltration: player skips movement for a figure.
 */
export async function handleInfiltrateSkip(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_infiltrate_skip_', '').split('_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'infiltration') return;

  active.currentFigureIdx = (active.currentFigureIdx || 0) + 1;
  if (active.currentFigureIdx >= (active.figureKeys || []).length) {
    game.postDeployQueue.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    await _postInfiltrationMovePicker(game, gameId, client, logGameAction);
  }
  saveGames();
}

/**
 * Scavenged Walker: player starts the post-deploy move.
 */
export async function handleWalkerMove(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client, dcMessageMeta, getBoardStateForMovement, getMovementProfile, computeMovementCache, getMovementMinimapAttachment, getMoveSpaceGridRows } = ctx;
  const parts = interaction.customId.replace('pd_walker_move_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const walkerMsgId = parts.slice(2).join('_');

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const active = game.postDeployQueue?.activeAbility;
  if (!active || active.abilityId !== 'scavenged_walker_move') return;

  const figureKey = active.figureKey;
  const dcName = active.dcName;
  const pos = game.figurePositions?.[playerNum]?.[figureKey];
  if (!pos) {
    await interaction.followUp({ content: 'Figure position not found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Get speed from DC effects
  const dcEffects = getDcEffects() || {};
  const eff = dcEffects[dcName];
  const mp = eff?.speed || 4;

  const boardState = getBoardStateForMovement(game, figureKey);
  if (!boardState) {
    await interaction.followUp({ content: 'Map data missing.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(pos, mp, boardState, profile);
  if (cache.cells.size === 0) {
    await interaction.followUp({ content: 'No valid movement spaces.', ephemeral: true }).catch(discordCatch);
    game.postDeployQueue.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
    saveGames();
    return;
  }

  // Figure index from figureKey
  const dgMatch = figureKey.match(/^(.+)-(\d+)-(\d+)$/);
  const figureIndex = dgMatch ? parseInt(dgMatch[3], 10) : 0;

  game.moveInProgress = game.moveInProgress || {};
  const moveKey = `${walkerMsgId}_${figureIndex}`;
  game.moveInProgress[moveKey] = {
    figureKey,
    playerNum,
    mpRemaining: mp,
    displayName: dcName,
    msgId: walkerMsgId,
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

  const { rows } = getMoveSpaceGridRows(walkerMsgId, figureIndex, buttonSpaces, boardState.mapSpaces, profile.size);
  const minimap = getMovementMinimapAttachment ? await getMovementMinimapAttachment(game, walkerMsgId, figureKey, buttonSpaces) : null;
  const multiTileNote = isMultiTile ? `\n📐 Buttons show **bottom-left corner** of each valid placement.` : '';

  const firstRows = rows.slice(0, 4);
  const adjustRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`move_adjust_mp_${walkerMsgId}_${figureIndex}`)
      .setLabel('🗺️ Pick Path Manually')
      .setStyle(ButtonStyle.Secondary)
  );
  firstRows.push(adjustRow);

  const payload = {
    content: `**Scavenged Walker Move** — Pick a column for **${dcName}** (**${mp}** MP):${multiTileNote}`,
    components: firstRows,
    fetchReply: true,
  };
  if (minimap) payload.files = [minimap];

  const gridMsg = await interaction.followUp(payload).catch(() => null);
  game.moveGridMessageIds[moveKey] = gridMsg?.id ? [gridMsg.id] : [];

  for (let i = 4; i < rows.length; i += 5) {
    const more = rows.slice(i, i + 5);
    if (more.length > 0) {
      const follow = await interaction.channel.send({ content: null, components: more }).catch(() => null);
      if (follow?.id) game.moveGridMessageIds[moveKey].push(follow.id);
    }
  }

  saveGames();
}

/**
 * Scavenged Walker: player skips the post-deploy move.
 */
export async function handleWalkerSkip(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('pd_walker_skip_', '').split('_');
  const gameId = parts[0];

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}

  const q = game.postDeployQueue;
  if (q) {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  }
  saveGames();
}

/**
 * Called from movement.js handleMovePick when a postDeployReturn move finishes.
 * Advances the infiltration/walker flow or the overall queue.
 */
export async function onPostDeployMovementComplete(game, gameId, client, ctx) {
  const { logGameAction, saveGames } = ctx;
  const q = game.postDeployQueue;
  if (!q) return;

  const active = q.activeAbility;
  if (!active) {
    await postAbilityPicker(game, gameId, client, logGameAction);
    if (saveGames) saveGames();
    return;
  }

  if (active.abilityId === 'infiltration') {
    // Advance to next figure
    active.currentFigureIdx = (active.currentFigureIdx || 0) + 1;
    if (active.currentFigureIdx >= (active.figureKeys || []).length) {
      q.activeAbility = null;
      await postAbilityPicker(game, gameId, client, logGameAction);
    } else {
      await _postInfiltrationMovePicker(game, gameId, client, logGameAction);
    }
  } else if (active.abilityId === 'scavenged_walker_move') {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  } else {
    q.activeAbility = null;
    await postAbilityPicker(game, gameId, client, logGameAction);
  }

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
  await postAbilityPicker(game, gameId, client, logGameAction);
  if (saveGames) saveGames();
}
