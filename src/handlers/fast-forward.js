/**
 * Fast Forward: simulates movement rounds for testready games and opens activation threads,
 * allowing the user to test CC cards at the right timing window.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ThreadAutoArchiveDuration } from 'discord.js';
import { getAbilityLibrary, getDcEffects, getCcEffect as _getCcEffect } from '../data-loader.js';
import { getBoardStateForMovement, getMovementProfile, computeMovementCache } from '../game/movement.js';
import { parseCoord, normalizeCoord } from '../game/coords.js';

/**
 * Infer the timing category for fast-forward based on the primary CC's ability entry.
 * @param {object|null} entry - Ability library entry for the primary card
 * @returns {'roundStart'|'combatAttacker'|'combatDefender'|'activationStart'}
 */
function inferTimingForFastForward(entry) {
  if (!entry) return 'activationStart';
  if (entry.claimInitiative) return 'roundStart';
  if (entry.attackSurgeBonus || entry.attackAccuracyBonus || entry.nextAttackBonusPierce
      || entry.attackBonusDice || entry.attackBonusHits || entry.nextAttacksBonusHits)
    return 'combatAttacker';
  if (entry.applyHideWhenDefending || entry.defenseBonusDice
      || entry.roundDefenseBonusEvade || entry.roundDefenseBonusBlock)
    return 'combatDefender';
  return 'activationStart';
}

/** Chebyshev distance between two coordinate strings (includes diagonal). */
function coordDistance(a, b) {
  if (!a || !b) return Infinity;
  const { col: ac, row: ar } = parseCoord(a);
  const { col: bc, row: br } = parseCoord(b);
  return Math.max(Math.abs(ac - bc), Math.abs(ar - br));
}

/**
 * Among all reachable cells in the cache, find the topLeft position that brings the figure's
 * footprint closest to the target coordinate.
 * @param {Map<string, {cost: number, topLeft: string, size: string}>} cells
 * @param {string} targetPos
 * @returns {string|null} topLeft coord to move to, or null if no reachable cells
 */
function findClosestTopLeft(cells, targetPos) {
  let bestTopLeft = null;
  let bestDist = Infinity;
  for (const [cell, info] of cells) {
    const dist = coordDistance(cell, targetPos);
    if (dist < bestDist) {
      bestDist = dist;
      bestTopLeft = info.topLeft;
    }
  }
  return bestTopLeft;
}

/** Get base movement speed for a DC from dc-effects, fallback 4. */
function getSpeedForDc(dcName) {
  const effects = getDcEffects() || {};
  const base = (dcName || '').replace(/\s*\[.*\]\s*$/, '').trim();
  const entry = effects[base] || effects[dcName] || (() => {
    const key = Object.keys(effects).find((k) => k.toLowerCase() === (base || '').toLowerCase());
    return key ? effects[key] : {};
  })();
  return entry?.speed ?? 4;
}

/** Get the first positioned figure for a player. Returns { figureKey, pos } or null. */
function getFirstPositionedFigure(game, playerNum) {
  const positions = game.figurePositions?.[playerNum] || {};
  const figureKey = Object.keys(positions)[0];
  if (!figureKey) return null;
  return { figureKey, pos: positions[figureKey] };
}

/**
 * Find the first non-activated, non-defeated DC index for a player.
 * "Defeated" means no figure of that DC has a position.
 */
function findFirstActiveDcIndex(game, playerNum) {
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const activated = new Set((playerNum === 1 ? game.p1ActivatedDcIndices : game.p2ActivatedDcIndices) || []);
  const poses = game.figurePositions?.[playerNum] || {};

  for (let i = 0; i < dcList.length; i++) {
    if (activated.has(i)) continue;
    const dc = dcList[i];
    const dcName = typeof dc === 'object' ? dc.dcName : dc;
    const displayName = typeof dc === 'object' ? (dc.displayName || dcName) : dcName;
    const dgIndex = displayName?.match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const hasPosition = Object.keys(poses).some((k) => {
      const kDcName = k.replace(/-\d+-\d+$/, '');
      const kDg = k.match(/-(\d+)-\d+$/)?.[1] ?? '1';
      return kDcName === dcName && kDg === dgIndex;
    });
    if (hasPosition) return i;
  }
  // Fallback: first non-activated DC even without a position (e.g. not deployed)
  for (let i = 0; i < dcList.length; i++) {
    if (!activated.has(i)) return i;
  }
  return 0;
}

/**
 * Simulate movement rounds, moving figures toward each other.
 * @param {object} game
 * @param {number} activatorNum - Player number who will be activating
 * @param {number} defenderNum - The other player
 * @param {string} timing - from inferTimingForFastForward
 * @param {number} maxRounds
 * @returns {{ roundsSimulated: number, movementLog: string[] }}
 */
export function simulateMovementRounds(game, activatorNum, defenderNum, timing, maxRounds = 5) {
  const movementLog = [];
  let roundsSimulated = 0;

  for (let round = 0; round < maxRounds; round++) {
    const aPoses = game.figurePositions?.[activatorNum] || {};
    const dPoses = game.figurePositions?.[defenderNum] || {};
    const aFigKey = Object.keys(aPoses)[0];
    const dFigKey = Object.keys(dPoses)[0];

    if (!aFigKey || !dFigKey) break;
    const aPos = aPoses[aFigKey];
    const dPos = dPoses[dFigKey];
    if (!aPos || !dPos) break;

    // For combat timing, stop if already adjacent before moving
    if ((timing === 'combatAttacker' || timing === 'combatDefender') && coordDistance(aPos, dPos) <= 1) break;

    // Move activator toward defender
    const aDcName = aFigKey.replace(/-\d+-\d+$/, '');
    const aBoardState = getBoardStateForMovement(game, aFigKey);
    if (aBoardState) {
      const aProfile = getMovementProfile(aDcName, aFigKey, game);
      const aSpeed = getSpeedForDc(aDcName);
      const aCache = computeMovementCache(aPos, aSpeed, aBoardState, aProfile);
      const aBest = findClosestTopLeft(aCache.cells, dPos);
      if (aBest && aBest !== normalizeCoord(aPos)) {
        game.figurePositions = game.figurePositions || {};
        game.figurePositions[activatorNum] = game.figurePositions[activatorNum] || {};
        const oldPos = aPos;
        game.figurePositions[activatorNum][aFigKey] = aBest;
        movementLog.push(`${aDcName} moved ${String(oldPos).toUpperCase()} → ${aBest.toUpperCase()}`);
      }
    }

    // For non-combat timing, also move defender toward activator
    if (timing !== 'combatAttacker' && timing !== 'combatDefender') {
      const dDcName = dFigKey.replace(/-\d+-\d+$/, '');
      const dBoardState = getBoardStateForMovement(game, dFigKey);
      if (dBoardState) {
        const dProfile = getMovementProfile(dDcName, dFigKey, game);
        const dSpeed = getSpeedForDc(dDcName);
        const dCache = computeMovementCache(dPos, dSpeed, dBoardState, dProfile);
        const newAPos = game.figurePositions?.[activatorNum]?.[aFigKey] || aPos;
        const dBest = findClosestTopLeft(dCache.cells, newAPos);
        if (dBest && dBest !== normalizeCoord(dPos)) {
          game.figurePositions = game.figurePositions || {};
          game.figurePositions[defenderNum] = game.figurePositions[defenderNum] || {};
          const oldDPos = dPos;
          game.figurePositions[defenderNum][dFigKey] = dBest;
          movementLog.push(`${dDcName} moved ${String(oldDPos).toUpperCase()} → ${dBest.toUpperCase()}`);
        }
      }
    }

    roundsSimulated++;

    // Check stop condition after movement
    const newAPos = game.figurePositions?.[activatorNum]?.[aFigKey];
    const newDPos = game.figurePositions?.[defenderNum]?.[dFigKey];

    // Non-combat: 1 round is enough
    if (timing !== 'combatAttacker' && timing !== 'combatDefender') break;

    // Combat: stop when adjacent
    if (newAPos && newDPos && coordDistance(newAPos, newDPos) <= 1) break;

    // Advance game state for next round
    game.currentRound = (game.currentRound || 1) + 1;
    game.p1ActivatedDcIndices = [];
    game.p2ActivatedDcIndices = [];
    game.p1ActivationsRemaining = game.p1ActivationsTotal ?? 0;
    game.p2ActivationsRemaining = game.p2ActivationsTotal ?? 0;
  }

  return { roundsSimulated, movementLog };
}

/**
 * Programmatically open an activation thread for a player's DC (without an interaction).
 * Mirrors handleDcActivate logic (dc-play-area.js) but uses direct channel/message fetching.
 */
export async function startActivationThreadForFastForward(game, playerNum, dcIndex, gameId, client, ctx) {
  const {
    dcExhaustedState,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getDcPlayAreaComponents,
    getDcActionButtons,
    getActionsCounterContent,
    getActivationMinimapAttachment,
    updateActivationsMessage,
    DC_ACTIONS_PER_ACTIVATION,
  } = ctx;

  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const playAreaId = playerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;

  const dc = dcList[dcIndex];
  if (!dc) throw new Error(`DC not found at index ${dcIndex} for player ${playerNum}`);

  const dcName = typeof dc === 'object' ? dc.dcName : dc;
  const displayName = typeof dc === 'object' ? (dc.displayName || dcName) : dcName;
  const msgId = dcMessageIds[dcIndex];
  if (!msgId) throw new Error(`No message ID for DC index ${dcIndex} player ${playerNum}`);

  const healthState = (dcHealthState && dcHealthState.get(msgId)) || dc.healthState || [[null, null]];

  const channel = await client.channels.fetch(playAreaId);
  const msg = await channel.messages.fetch(msgId);

  dcExhaustedState.set(msgId, true);
  const { embed, files } = await buildDcEmbedAndFiles(dcName, true, displayName, healthState, getConditionsForDcMessage?.(game, { dcName, displayName }));
  await msg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, dcName) });

  const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
  const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });

  game.movementBank = game.movementBank || {};
  game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };

  const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
  const actMinimap = getActivationMinimapAttachment ? await getActivationMinimapAttachment(game, msgId) : null;
  const actionsPayload = {
    content: pingContent,
    components: getDcActionButtons(msgId, dcName, displayName, game.dcActionsData[msgId], game),
    allowedMentions: { users: [ownerId] },
  };
  if (actMinimap) actionsPayload.files = [actMinimap];
  const actionsMsg = await thread.send(actionsPayload);
  game.dcActionsData[msgId].messageId = actionsMsg.id;

  if (playerNum === 1) {
    game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining || 0) - 1);
    game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
    game.p1ActivatedDcIndices.push(dcIndex);
  } else {
    game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining || 0) - 1);
    game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
    game.p2ActivatedDcIndices.push(dcIndex);
  }
  await updateActivationsMessage(game, playerNum, client);

  return { thread, msgId, displayName };
}

/**
 * Open a defender thread for a player's DC (no activation state changes).
 * Shows CC buttons playable while defending.
 */
export async function startDefenderThreadForFastForward(game, defenderPlayerNum, defenderDcIndex, gameId, client, ctx) {
  const { getCcEffect } = ctx;

  const dcList = defenderPlayerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const dcMessageIds = defenderPlayerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const playAreaId = defenderPlayerNum === 1 ? game.p1PlayAreaId : game.p2PlayAreaId;

  const dc = dcList[defenderDcIndex];
  if (!dc) return null;

  const dcName = typeof dc === 'object' ? dc.dcName : dc;
  const displayName = typeof dc === 'object' ? (dc.displayName || dcName) : dcName;
  const msgId = dcMessageIds[defenderDcIndex];
  if (!msgId) return null;

  const channel = await client.channels.fetch(playAreaId);
  const msg = await channel.messages.fetch(msgId);

  const threadName = (`🛡️ DEFENDER — ${displayName}`).slice(0, 100);
  const thread = await msg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });

  game.defenderThreadData = game.defenderThreadData || {};
  game.defenderThreadData[msgId] = {
    remaining: 0, total: 0, messageId: null, threadId: thread.id, specialsUsed: [],
    isDefenderThread: true, playerNum: defenderPlayerNum,
  };

  // Filter CC hand for defender-relevant cards
  const hand = defenderPlayerNum === 1 ? (game.player1CcHand || []) : (game.player2CcHand || []);
  const defenderCards = hand.filter((cardName) => {
    const effect = getCcEffect(cardName);
    if (!effect) return false;
    return effect.applyHideWhenDefending || effect.defenseBonusDice
        || effect.roundDefenseBonusEvade || effect.roundDefenseBonusBlock;
  });

  if (defenderCards.length === 0) {
    await thread.send({ content: '🛡️ No defender CCs available in hand.' });
  } else {
    const btns = defenderCards.slice(0, 5).map((cardName, idx) =>
      new ButtonBuilder()
        .setCustomId(`dc_cc_defender_${gameId}_${msgId}_${idx}`)
        .setLabel(`CC: ${cardName}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)
    );
    const row = new ActionRowBuilder().addComponents(...btns);
    // Store card list so handler can look up by index
    game.defenderThreadData[msgId].defenderCards = defenderCards.slice(0, 5);
    await thread.send({ content: '🛡️ Defender CCs (play while being attacked):', components: [row] });
  }

  return { thread, msgId, displayName };
}

/**
 * Handle the fast_forward_{gameId} button.
 * Simulates movement rounds, opens activation thread (and defender thread if needed).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleFastForward(interaction, ctx) {
  const gameId = interaction.customId.replace('fast_forward_', '');
  const { getGame, saveGames, logGameAction, client } = ctx;

  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!game.isTestGame || game.ended) {
    await interaction.reply({ content: 'Fast Forward is only available for active test games.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });

  try {
    // Infer timing from the primary card
    const lib = getAbilityLibrary();
    const primaryCard = game.testScenarioPrimaryCard;
    const entry = primaryCard ? (lib?.abilities?.[primaryCard] ?? null) : null;
    const timing = inferTimingForFastForward(entry);

    // Determine who activates and who defends
    // combatDefender: P2 attacks, P1 defends (has the defender CC)
    const activatorNum = timing === 'combatDefender' ? 2 : 1;
    const defenderNum = 3 - activatorNum;

    // Simulate movement rounds
    const { roundsSimulated, movementLog } = simulateMovementRounds(game, activatorNum, defenderNum, timing, 5);

    // Find first non-activated DC for activator
    const activatorDcIndex = findFirstActiveDcIndex(game, activatorNum);

    // Open activation thread
    const activationResult = await startActivationThreadForFastForward(game, activatorNum, activatorDcIndex, gameId, client, ctx);

    // For combatDefender: also open defender thread for defender player
    if (timing === 'combatDefender') {
      const defenderDcIndex = findFirstActiveDcIndex(game, defenderNum);
      await startDefenderThreadForFastForward(game, defenderNum, defenderDcIndex, gameId, client, ctx);
    }

    // Build summary log
    const roundsLabel = roundsSimulated === 1 ? '1 round' : `${roundsSimulated} rounds`;
    const moveSummary = movementLog.length > 0
      ? '\n' + movementLog.map((m) => `  • ${m}`).join('\n')
      : '';
    const activatorDcName = activationResult?.displayName || 'figure';
    await logGameAction(game, client,
      `⏩ Fast-forwarded ${roundsLabel}.${moveSummary}\nActivation thread opened for **${activatorDcName}**.`,
      { icon: 'activate' }
    );

    saveGames();
  } catch (err) {
    console.error('handleFastForward error:', err);
    await interaction.followUp({ content: `Fast Forward failed: ${err.message}. Check bot console for details.`, ephemeral: true }).catch((err2) => { console.error('[discord]', err2?.message ?? err2); });
  }
}

/**
 * Handle the dc_cc_defender_{gameId}_{msgId}_{idx} button.
 * Plays a defender CC from the defender thread.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDefenderCcPlay(interaction, ctx) {
  // customId: dc_cc_defender_{gameId}_{msgId}_{idx}
  // gameId and msgId are digit-only strings; idx is a small integer
  const idWithoutPrefix = interaction.customId.replace('dc_cc_defender_', '');
  const parts = idWithoutPrefix.split('_');
  if (parts.length < 3) {
    await interaction.reply({ content: 'Invalid defender CC button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const gameId = parts[0];
  const idx = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(1, -1).join('_');

  const {
    getGame,
    getCcEffect,
    resolveAbility,
    logGameAction,
    updateHandVisualMessage,
    updateDiscardPileMessage,
    saveGames,
    client,
  } = ctx;

  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  const defenderData = game.defenderThreadData?.[msgId];
  if (!defenderData) {
    await interaction.reply({ content: 'Defender thread context not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  const playerNum = defenderData.playerNum;
  const defenderCards = defenderData.defenderCards;
  if (!defenderCards || isNaN(idx) || idx < 0 || idx >= defenderCards.length) {
    await interaction.reply({ content: 'Defender CC not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  const card = defenderCards[idx];
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
  const hand = game[handKey] || [];

  if (!hand.includes(card)) {
    await interaction.reply({ content: "That card is no longer in your hand.", ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });

  // Remove from hand, add to discard
  hand.splice(hand.indexOf(card), 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(card);

  // Resolve ability
  if (resolveAbility) {
    const effectData = getCcEffect(card);
    const abilityId = effectData?.abilityId ?? card;
    resolveAbility(abilityId, { game, playerNum, cardName: card, msgId, isDefending: true });
  }

  await logGameAction(game, client, `🛡️ <@${playerNum === 1 ? game.player1Id : game.player2Id}> played defender CC **${card}**.`, { icon: 'card' });
  await updateHandVisualMessage(game, playerNum, client);
  await updateDiscardPileMessage(game, playerNum, client);

  saveGames();
}
