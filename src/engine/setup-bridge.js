/**
 * Setup bridge functions extracted from index.js.
 * Handles post-attachment setup, play area reordering, draft-random flow, and play area population.
 */
import { fetchGameChannel, snowflakeUsers } from '../discord/channel-helpers.js';
import { getDcStats } from '../data-loader.js';
import { isFigurelessDc } from '../game/dc-helpers.js';
import { cardNameEquals } from '../game/card-names.js';

/**
 * Parity with setup.js applySetupAttachment's Lie in Ambush branch.
 * Scans a player's CC attachments (dcMsgId -> [cardNames]) for any Lie in Ambush
 * attachment and populates game.lieInAmbushSetAside[playerNum] with the figureKeys
 * that must be skipped during auto-deploy. dgIndex computation mirrors
 * setup.js:262-286 (count same-name figure DCs up to dcIdx).
 *
 * Safe to call repeatedly — rebuilds the per-player set-aside from current state.
 */
function populateLieInAmbushSetAsideFromAttachments(game, playerNum) {
  const squadKey = playerNum === 1 ? 'player1Squad' : 'player2Squad';
  const dcList = game[squadKey]?.dcList || [];
  const dcMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
  const ccAttachments = playerNum === 1 ? (game.p1CcAttachments || {}) : (game.p2CcAttachments || {});
  const figureKeys = [];
  for (const [dcMsgId, cards] of Object.entries(ccAttachments)) {
    if (!Array.isArray(cards)) continue;
    if (!cards.some((c) => cardNameEquals(c, 'Lie in Ambush'))) continue;
    const dcIdx = dcMsgIds.indexOf(dcMsgId);
    if (dcIdx < 0 || !dcList[dcIdx]) continue;
    const resolveName = (d) => (typeof d === 'string' ? d : (d?.dcName || d?.displayName));
    const dcName = resolveName(dcList[dcIdx]);
    if (!dcName) continue;
    let dgIndex = 0;
    for (let i = 0; i < dcList.length; i++) {
      const n = resolveName(dcList[i]);
      if (!n || isFigurelessDc(n)) continue;
      if (n === dcName) dgIndex++;
      if (i === dcIdx) break;
    }
    const figures = getDcStats(dcName)?.figures ?? 1;
    for (let f = 0; f < figures; f++) figureKeys.push(`${dcName}-${dgIndex}-${f}`);
  }
  if (figureKeys.length > 0) {
    game.lieInAmbushSetAside = game.lieInAmbushSetAside || {};
    game.lieInAmbushSetAside[playerNum] = figureKeys;
  }
}

/**
 * Reorder play area messages so attachments appear right after their parent DCs.
 * Deletes all DC + attachment messages and re-sends them in interleaved order.
 * @param {object} game
 * @param {number} playerNum
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function reorderPlayAreaAfterAttachments(game, playerNum, client, deps) {
  const dcList = deps.getDcList(game, playerNum);
  const dcMsgIds = deps.getDcMessageIds(game, playerNum);
  const attachMsgIds = game[deps.dcAttachmentMessageIdsKey(playerNum)] || [];
  const ccAttachKey = deps.ccAttachmentsKey(playerNum);
  const dcAttachKey = deps.dcAttachmentsKey(playerNum);
  const channelId = deps.getPlayAreaId(game, playerNum);

  // Only reorder if there are attachments (existing messages or pending data) to interleave
  const hasAttachmentMsgs = attachMsgIds.some((id) => id != null);
  const hasAttachmentData = dcMsgIds.some((id) => id && (
    ((game[ccAttachKey] || {})[id] || []).length > 0 ||
    ((game[dcAttachKey] || {})[id] || []).length > 0
  ));
  if (!hasAttachmentMsgs && !hasAttachmentData) return;

  const channel = await fetchGameChannel(client, channelId);
  const oldDcMsgIds = [...dcMsgIds];
  const oldAttachMsgIds = [...attachMsgIds];

  // 1. Delete all existing DC messages and attachment messages
  for (const msgId of oldDcMsgIds) {
    if (msgId) {
      try { await (await channel.messages.fetch(msgId)).delete(); }
      catch (err) { console.error('[reorder] Failed to delete DC msg:', err.message); }
    }
  }
  for (const msgId of oldAttachMsgIds) {
    if (msgId) {
      try { await (await channel.messages.fetch(msgId)).delete(); }
      catch (err) { console.error('[reorder] Failed to delete attachment msg:', err.message); }
    }
  }

  // 2. Re-send in correct interleaved order: DC -> its attachments -> next DC -> ...
  const newDcMsgIds = [];
  const newAttachMsgIds = [];
  const dcMsgIdRemap = new Map();

  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const oldDcMsgId = oldDcMsgIds[i];
    const healthState = dc.healthState || [];

    // Re-send DC embed
    const { embed, files } = await deps.buildDcEmbedAndFiles(dc.dcName, false, dc.displayName, healthState, undefined, [], null, null, deps.getNicknamesForDcMessage(game, dc));
    const newDcMsg = await channel.send({ embeds: [embed], files });
    const newDcMsgId = newDcMsg.id;
    newDcMsgIds.push(newDcMsgId);

    // Clean up old Map entries and set new ones
    if (oldDcMsgId) {
      deps.dcMessageMeta.delete(oldDcMsgId);
      deps.dcExhaustedState.delete(oldDcMsgId);
      deps.dcHealthState.delete(oldDcMsgId);
      dcMsgIdRemap.set(oldDcMsgId, newDcMsgId);
    }
    deps.dcMessageMeta.set(newDcMsgId, { gameId: game.gameId, playerNum, dcName: dc.dcName, displayName: dc.displayName });
    deps.dcExhaustedState.set(newDcMsgId, false);
    deps.dcHealthState.set(newDcMsgId, healthState);

    // Add components (buttons)
    const components = deps.getDcPlayAreaComponents(newDcMsgId, false, game, dc.dcName);
    await newDcMsg.edit({ components });

    // Re-send attachment message interleaved right after its DC
    const ccAttachments = oldDcMsgId ? ((game[ccAttachKey] || {})[oldDcMsgId] || []) : [];
    const dcAttachments = oldDcMsgId ? ((game[dcAttachKey] || {})[oldDcMsgId] || []) : [];
    if (ccAttachments.length > 0 || dcAttachments.length > 0) {
      const { embeds, files: attachFiles } = await deps.buildAttachmentEmbedsAndFiles(ccAttachments, dcAttachments, dc.displayName);
      const attachMsg = await channel.send({ embeds, files: attachFiles });
      newAttachMsgIds.push(attachMsg.id);
    } else {
      newAttachMsgIds.push(null);
    }
  }

  // 3. Update game arrays
  if (playerNum === 1) {
    game.p1DcMessageIds = newDcMsgIds;
    game.p1DcAttachmentMessageIds = newAttachMsgIds;
    game.p1DcCompanionMessageIds = newDcMsgIds.map(() => null);
  } else {
    game.p2DcMessageIds = newDcMsgIds;
    game.p2DcAttachmentMessageIds = newAttachMsgIds;
    game.p2DcCompanionMessageIds = newDcMsgIds.map(() => null);
  }

  // 4. Remap msgId-keyed attachment objects (CC and DC attachments)
  for (const key of [ccAttachKey, dcAttachKey]) {
    const obj = game[key];
    if (!obj) continue;
    const newObj = {};
    for (const [oldId, val] of Object.entries(obj)) {
      const newId = dcMsgIdRemap.get(oldId) || oldId;
      newObj[newId] = val;
    }
    game[key] = newObj;
  }
}

/**
 * Called when all setup attachments are placed: reorder play area, then start deployment phase.
 * @param {object} game
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function finishSetupAttachments(game, client, deps) {
  // Reorder play area messages so attachments appear right after their parent DCs
  try {
    await deps.reorderPlayAreaAfterAttachments(game, 1, client);
    await deps.reorderPlayAreaAfterAttachments(game, 2, client);
  } catch (err) {
    console.error('Failed to reorder play area after attachments:', err);
  }
  // Transition to deployment — startDeploymentAfterAttachments sends deploy buttons
  if (deps.startDeploymentAfterAttachments) {
    await deps.startDeploymentAfterAttachments(game, client, deps);
  }
  deps.saveGames();
}

/**
 * Run full Draft Random setup: map, hand channels, squads, initiative, deploy, draw.
 * @param {object} game
 * @param {import('discord.js').Client} client
 * @param {object} deps
 * @param {{ scenarioId?: string, seedConfig?: { mapId: string, p1Deck: object, p2Deck: object } }} [options]
 *   scenarioId: use scenario decks and seed P1 hand
 *   seedConfig: config-family replay — use exact map + decks from headless explorer seed
 */
export async function runDraftRandom(game, client, deps, options = {}) {
  const { scenarioId, seedConfig } = options;
  const generalChannel = await fetchGameChannel(client, game.generalId);

  // Map selection
  if (!game.mapSelected) {
    const playReadyMaps = deps.getPlayReadyMaps();
    if (playReadyMaps.length === 0) throw new Error('No play-ready maps available.');
    let map;
    if (seedConfig?.mapId) {
      map = playReadyMaps.find(m => m.id === seedConfig.mapId);
      if (!map) throw new Error(`Seed map "${seedConfig.mapId}" not found in play-ready maps.`);
    } else {
      map = playReadyMaps[Math.floor(Math.random() * playReadyMaps.length)];
    }
    game.selectedMap = { id: map.id, name: map.name, imagePath: map.imagePath };
    game.mapSelected = true;
    deps.setPhase(game, deps.PHASES.INITIATIVE);
    await deps.postMissionCardAfterMapSelection(game, client, map);
  }

  // Play areas first (hand threads live inside them)
  if (!game.p1PlayAreaId || !game.p2PlayAreaId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const { p1PlayAreaChannel, p2PlayAreaChannel } = await deps.createPlayAreaChannels(
      guild, gameCategory, prefix, game.player1Id, game.player2Id
    );
    game.p1PlayAreaId = p1PlayAreaChannel.id;
    game.p2PlayAreaId = p2PlayAreaChannel.id;
  }

  // Map Updates channel created AFTER play areas so it appears last in the category
  if (!game.boardId) {
    const guild = generalChannel.guild;
    const gameCategory = await guild.channels.fetch(game.gameCategoryId || generalChannel.parentId);
    const prefix = `IA${game.gameId}`;
    const boardChannel = await deps.createBoardChannel(guild, gameCategory, prefix, game.player1Id, game.player2Id);
    game.boardId = boardChannel.id;
    if (game.selectedMap) {
      try {
        const payload = await deps.buildBoardMapPayload(game.gameId, game.selectedMap, game);
        await boardChannel.send(payload);
      } catch (err) {
        console.error('runDraftRandom: failed to post map to Map Updates:', err);
      }
    }
    // Ping Active Player button is already included in the map update standard row
  }

  // Hand threads live inside each player's play area
  if (!game.p1HandId || !game.p2HandId) {
    await deps.createHandThreads(client, game);
  }

  // Deck selection: seedConfig overrides with exact decks, else default + scenario retool
  let p1Deck, p2Deck;
  if (seedConfig?.p1Deck && seedConfig?.p2Deck) {
    // Config-family replay: use exact deck objects from headless explorer seed.
    // Initiative, deployment zone, figure placement, and CC draw order are still randomized.
    p1Deck = { ...seedConfig.p1Deck, dcList: [...(seedConfig.p1Deck.dcList || [])], ccList: [...(seedConfig.p1Deck.ccList || [])] };
    p2Deck = { ...seedConfig.p2Deck, dcList: [...(seedConfig.p2Deck.dcList || [])], ccList: [...(seedConfig.p2Deck.ccList || [])] };
  } else {
    p1Deck = { ...deps.DEFAULT_DECK_REBELS, dcList: [...(deps.DEFAULT_DECK_REBELS.dcList || [])], ccList: [...(deps.DEFAULT_DECK_REBELS.ccList || [])] };
    p2Deck = { ...deps.DEFAULT_DECK_SCUM, dcList: [...(deps.DEFAULT_DECK_SCUM.dcList || [])], ccList: [...(deps.DEFAULT_DECK_SCUM.ccList || [])] };
    if (scenarioId && !game.trainingMode) {
      ({ p1Deck, p2Deck } = deps.retoolDecksForScenario(p1Deck, p2Deck, scenarioId));
    }
  }
  await deps.applySquadSubmission(game, true, p1Deck, client);
  await deps.applySquadSubmission(game, false, p2Deck, client);

  // Parity with interactive setup (setup.js applySetupAttachment): any existing
  // "Lie in Ambush" CC attachments must populate game.lieInAmbushSetAside so
  // those figures are skipped during auto-deploy. Interactive attach-UI already
  // populates this field; Draft Random never hit that path, so the figures
  // would deploy and show an Activate button despite being attached.
  populateLieInAmbushSetAsideFromAttachments(game, 1);
  populateLieInAmbushSetAsideFromAttachments(game, 2);

  // Initiative + deployment zone
  if (!game.initiativeDetermined) {
    const winner = Math.random() < 0.5 ? game.player1Id : game.player2Id;
    const playerNum = winner === game.player1Id ? 1 : 2;
    game.initiativePlayerId = winner;
    game.initiativeDetermined = true;
    deps.setPhase(game, deps.PHASES.ZONE_SELECTION);
    await deps.logGameAction(
      game,
      client,
      `<@${winner}> (**Player ${playerNum}**) won initiative! Chooses deployment zone and activates first each round.`,
      { allowedMentions: { users: snowflakeUsers([winner]) }, phase: 'INITIATIVE', icon: 'initiative' }
    );
  }
  if (!game.deploymentZoneChosen) {
    const zone = Math.random() < 0.5 ? 'red' : 'blue';
    const otherZone = zone === 'red' ? 'blue' : 'red';
    game.deploymentZoneChosen = zone;
    deps.setPhase(game, deps.PHASES.DEPLOYMENT);
    const initiativePlayerNum = deps.getInitiativePlayerNum(game);
    const { p1Zone: _p1z, p2Zone: _p2z } = deps.getPlayerDeploymentZones(game, initiativePlayerNum);
    game.player1DeploymentZone = _p1z;
    game.player2DeploymentZone = _p2z;
    const zoneLabel = `[${zone.toUpperCase()}] `;
    await deps.logGameAction(
      game,
      client,
      `<@${game.initiativePlayerId}> (${zoneLabel}**Player ${initiativePlayerNum}**) chose the **${zone}** deployment zone`,
      { allowedMentions: { users: snowflakeUsers([game.initiativePlayerId]) }, phase: 'INITIATIVE', icon: 'zone' }
    );
  }

  // Auto-deploy figures
  const mapId = game.selectedMap?.id;
  const zones = mapId ? deps.getDeploymentZones()[mapId] : null;
  if (!zones) throw new Error('Deployment zones not found for selected map.');
  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[1]) game.figurePositions[1] = {};
  if (!game.figurePositions[2]) game.figurePositions[2] = {};
  game.figureOrientations = game.figureOrientations || {};

  const deployForPlayer = (playerNum, zone, opponentZone) => {
    const squad = deps.getSquad(game, playerNum);
    const dcList = squad?.dcList || [];
    const { metadata } = deps.getDeployFigureLabels(dcList, game);
    // Compute centroid of opponent zone to rank spaces by proximity to the "entrance"
    const oppZoneCoords = (zones?.[opponentZone] || []).map((s) => deps.parseCoord(String(s).toLowerCase()));
    const oppCx = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.col, 0) / oppZoneCoords.length : 0;
    const oppCy = oppZoneCoords.length ? oppZoneCoords.reduce((s, c) => s + c.row, 0) / oppZoneCoords.length : 0;
    // Parity with setup.js deploy path: skip Lie in Ambush set-aside figures
    const setAsideKeys = new Set(game.lieInAmbushSetAside?.[playerNum] || []);
    for (const meta of metadata) {
      const figureKey = `${meta.dcName}-${meta.dgIndex}-${meta.figureIndex}`;
      if (setAsideKeys.has(figureKey)) continue; // Lie in Ambush — deploys later
      const occupied = [];
      for (const p of [1, 2]) {
        for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
          const dcName = deps.dcNameFromFigureKey(k);
          const size = deps.getEffectiveFigureSize(game, k, dcName);
          occupied.push(...deps.getFootprintCells(s, size));
        }
      }
      const baseSize = deps.getFigureSize(meta.dcName);
      const size = baseSize === '2x3' ? (Math.random() < 0.5 ? '2x3' : '3x2') : baseSize;
      const zoneSpaces = (zones?.[zone] || []).map((s) => String(s).toLowerCase());
      // Get blocking terrain and check if figure ignores blocking (Massive/Mobile)
      const ms = deps.getMapData?.(mapId);
      const blocking = ms?.blocking || [];
      const keywords = deps.getDcKeywords?.(game)?.[meta.dcName] || [];
      const kwUpper = keywords.map(k => String(k).toUpperCase());
      const ignoreBlocking = kwUpper.includes('MOBILE') || kwUpper.includes('MASSIVE');
      const validSpaces = deps.filterValidTopLeftSpaces(zoneSpaces, occupied, size, deps.getFootprintCells, blocking, ignoreBlocking);
      if (!validSpaces.length) throw new Error(`No valid deploy spaces for ${meta.dcName} in ${zone} zone.`);
      // Sort by Manhattan distance to opponent zone centroid (ascending = closest to enemy entrance first)
      validSpaces.sort((a, b) => {
        const pa = deps.parseCoord(a), pb = deps.parseCoord(b);
        const da = Math.abs(pa.col - oppCx) + Math.abs(pa.row - oppCy);
        const db = Math.abs(pb.col - oppCx) + Math.abs(pb.row - oppCy);
        return da - db;
      });
      const space = validSpaces[0];
      game.figurePositions[playerNum][figureKey] = space;
      if (baseSize === '2x3') {
        game.figureOrientations[figureKey] = size;
      }
    }
  };

  const initiativePlayerNum = deps.getInitiativePlayerNum(game);
  const nonInitiativePlayerNum = deps.opponentPlayerNum(initiativePlayerNum);
  const zone = game.deploymentZoneChosen;
  const otherZone = zone === 'red' ? 'blue' : 'red';
  deployForPlayer(initiativePlayerNum, zone, otherZone);
  deployForPlayer(nonInitiativePlayerNum, otherZone, zone);

  game.initiativePlayerDeployed = true;
  game.nonInitiativePlayerDeployed = true;
  game.currentRound = 1;
  game.currentActivationTurnPlayerId = game.initiativePlayerId;
  game.draftRandomUsed = true;
  deps.setPhase(game, deps.PHASES.ROUND_ACTIVE, deps.ROUND_PHASES.START_OF_ROUND);
  game.startOfRoundWhoseTurn = game.initiativePlayerId;

  if (game.boardId && game.selectedMap) {
    const boardChannel = await fetchGameChannel(client, game.boardId);
    const payload = await deps.buildBoardMapPayload(game.gameId, game.selectedMap, game);
    await boardChannel.send(payload);
  }

  // Clear general-channel setup messages + hand-channel deck-selection artifacts
  // before posting fresh hand content
  await deps.clearPreGameSetup(game, client);

  // Shuffle + draw starting 3 CCs. Scenario may seed P1 hand (e.g. smoke_grenade forces Smoke Grenade)
  const drawStartingHand = async (playerNum) => {
    const squad = deps.getSquad(game, playerNum);
    const ccList = squad?.ccList || [];
    const deck = [...ccList];
    deps.shuffleArray(deck);
    let hand = deck.splice(0, 3);
    if (scenarioId && playerNum === 1) {
      const primaryCard = deps.getScenarioPrimaryCard(scenarioId);
      if (primaryCard && !hand.includes(primaryCard)) {
        const replaced = hand[0];
        hand = [primaryCard, hand[1], hand[2]].filter(Boolean);
        if (replaced) deck.push(replaced);
        const pcIdx = deck.indexOf(primaryCard);
        if (pcIdx >= 0) deck.splice(pcIdx, 1);
      }
    }
    const deckKey = deps.ccDeckKey(playerNum);
    const handKey = deps.ccHandKey(playerNum);
    const drawnKey = deps.ccDrawnKey(playerNum);
    game[deckKey] = deck;
    game[handKey] = hand;
    game[drawnKey] = true;
    const playerId = deps.getPlayerId(game, playerNum);
    await deps.logGameAction(game, client, `<@${playerId}> shuffled and drew 3 Command Cards.`, { phase: 'DEPLOYMENT', icon: 'card', allowedMentions: { users: snowflakeUsers([playerId]) } });
    const handChannelId = deps.getHandChannelId(game, playerNum);
    const handChannel = await fetchGameChannel(client, handChannelId);
    const existingMsgs = await handChannel.messages.fetch({ limit: 5 });
    if (existingMsgs.size === 0) {
      const playerId = deps.getPlayerId(game, playerNum);
      await handChannel.send({
        content: `<@${playerId}>, this is your hand.`,
        embeds: [deps.getHandTooltipEmbed(game, playerNum)],
        allowedMentions: { users: snowflakeUsers([playerId]) },
      });
    }
    const handPayload = deps.buildHandDisplayPayload(hand, deck, game.gameId, game, playerNum);
    const handMsg = await handChannel.send({
      content: handPayload.content,
      embeds: handPayload.embeds,
      files: handPayload.files || [],
      components: handPayload.components,
    });
    // Store hand message ID for reliable future edits
    if (playerNum === 1) game.p1HandMessageId = handMsg.id;
    else game.p2HandMessageId = handMsg.id;
    await deps.updateHandVisualMessage(game, playerNum, client);
  };
  await drawStartingHand(1);
  await drawStartingHand(2);

  await deps.logGameAction(game, client, '**Draft Random** — Auto-deployed all figures and drew starting CCs.', { phase: 'DEPLOYMENT', icon: 'deployed' });

  await deps.updatePlayAreaDcButtons(game, client);
  const hasPendingSor = await deps.runStartOfRoundDcEffects(game, game.gameId, client, { logGameAction: deps.logGameAction });
  // Run post-deploy phase (interactive queue); if active, activation phase is deferred
  let postDeployActive = false;
  if (game.currentRound === 1) {
    postDeployActive = await deps.runPostDeployPhase(game, game.gameId, client, {
      logGameAction: deps.logGameAction, saveGames: deps.saveGames,
      buildDcEmbedAndFiles: deps.buildDcEmbedAndFiles, dcMessageMeta: deps.dcMessageMeta,
      dcExhaustedState: deps.dcExhaustedState, dcHealthState: deps.dcHealthState,
      getDcPlayAreaComponents: deps.getDcPlayAreaComponents, getNicknamesForDcMessage: deps.getNicknamesForDcMessage,
    }, async () => {
      if (!hasPendingSor) {
        deps.setRoundPhase(game, deps.ROUND_PHASES.ACTIVATION);
        await deps.sendRoundActivationPhaseMessage(game, client);
      }
      deps.saveGames();
    });
  }
  if (!postDeployActive && !hasPendingSor) {
    deps.setRoundPhase(game, deps.ROUND_PHASES.ACTIVATION);
    await deps.sendRoundActivationPhaseMessage(game, client);
  }
  deps.saveGames();
}

/**
 * Populate both play areas with DC embeds, discard pile, hand visual, activations messages.
 * @param {object} game
 * @param {object} client - Discord client
 * @param {object} deps
 */
export async function populatePlayAreas(game, client, deps) {
  const p1PlayArea = await fetchGameChannel(client, game.p1PlayAreaId);
  const p2PlayArea = await fetchGameChannel(client, game.p2PlayAreaId);
  const gameId = game.gameId;

  // Activation counts are set below after dcList is populated (recomputeActivationCounts)

  const processDcList = (dcList) => {
    const counts = {};
    const totals = {};
    for (const d of dcList) {
      const n = deps.resolveDcName(d);
      if (n) totals[n] = (totals[n] || 0) + 1;
    }
    return dcList.map((entry) => {
      const dcName = deps.resolveDcName(entry);
      counts[dcName] = (counts[dcName] || 0) + 1;
      const dgIndex = counts[dcName];
      const displayName = totals[dcName] > 1 ? `${dcName} [Group ${dgIndex}]` : dcName;
      const stats = deps.getDcStats(dcName);
      const figureless = deps.isFigurelessDc(dcName);
      const health = figureless ? null : (stats.health ?? '?');
      const figures = figureless ? 0 : (stats.figures ?? 1);
      const healthState = figureless ? [] : Array.from({ length: figures }, () => [health, health]);
      return { dcName, displayName, healthState };
    });
  };

  const p1DcsRaw = processDcList(game.player1Squad.dcList || []);
  const p2DcsRaw = processDcList(game.player2Squad.dcList || []);
  const p1Dcs = p1DcsRaw.filter((dc) => !deps.isDcAttachment(dc.dcName));
  const p2Dcs = p2DcsRaw.filter((dc) => !deps.isDcAttachment(dc.dcName));
  // Sort: figure DCs by cost descending (most expensive first), figureless DCs (skirmish upgrades) last
  const _dcSortKey = (dc) => {
    if (deps.isFigurelessDc(dc.dcName)) return -Infinity;
    return deps.getDcStats(dc.dcName)?.cost ?? 0;
  };
  p1Dcs.sort((a, b) => _dcSortKey(b) - _dcSortKey(a));
  p2Dcs.sort((a, b) => _dcSortKey(b) - _dcSortKey(a));
  game.p1DcList = p1Dcs;
  game.p2DcList = p2Dcs;
  game.p1ActivatedDcIndices = game.p1ActivatedDcIndices || [];
  game.p2ActivatedDcIndices = game.p2ActivatedDcIndices || [];
  // Derive activation counts from board state (handles LiA set-aside automatically)
  deps.recomputeActivationCounts(game, 1);
  deps.recomputeActivationCounts(game, 2);
  game.p1DcMessageIds = [];
  game.p2DcMessageIds = [];
  game.p1DcAttachmentMessageIds = [];
  game.p2DcAttachmentMessageIds = [];
  game.p1DcCompanionMessageIds = [];
  game.p2DcCompanionMessageIds = [];
  game.p1CcAttachments = game.p1CcAttachments || {};
  game.p2CcAttachments = game.p2CcAttachments || {};
  game.p1DcAttachments = game.p1DcAttachments || {};
  game.p2DcAttachments = game.p2DcAttachments || {};

  // Tooltip embeds at top of each Play Area
  await p1PlayArea.send({ embeds: [deps.getPlayAreaTooltipEmbed(game, 1)] });
  await p2PlayArea.send({ embeds: [deps.getPlayAreaTooltipEmbed(game, 2)] });

  const p1HandCount = (game.player1CcHand || []).length;
  const p2HandCount = (game.player2CcHand || []).length;
  const p1HandVisualMsg = await p1PlayArea.send({ embeds: [deps.getHandVisualEmbed(p1HandCount)] });
  const p2HandVisualMsg = await p2PlayArea.send({ embeds: [deps.getHandVisualEmbed(p2HandCount)] });
  game.p1HandVisualMessageId = p1HandVisualMsg.id;
  game.p2HandVisualMessageId = p2HandVisualMsg.id;

  const p1DiscardCount = (game.player1CcDiscard || []).length;
  const p2DiscardCount = (game.player2CcDiscard || []).length;
  const p1DiscardMsg = await p1PlayArea.send({
    embeds: [deps.getDiscardPileEmbed(p1DiscardCount)],
    components: [deps.getDiscardPileButtons(gameId, 1, false)],
  });
  const p2DiscardMsg = await p2PlayArea.send({
    embeds: [deps.getDiscardPileEmbed(p2DiscardCount)],
    components: [deps.getDiscardPileButtons(gameId, 2, false)],
  });
  game.p1DiscardPileMessageId = p1DiscardMsg.id;
  game.p2DiscardPileMessageId = p2DiscardMsg.id;

  const p1ActivationsMsg = await p1PlayArea.send(deps.getActivationsLine(game.p1ActivationsTotal, game.p1ActivationsTotal));
  const p2ActivationsMsg = await p2PlayArea.send(deps.getActivationsLine(game.p2ActivationsTotal, game.p2ActivationsTotal));
  game.p1ActivationsMessageId = p1ActivationsMsg.id;
  game.p2ActivationsMessageId = p2ActivationsMsg.id;

  for (const { dcName, displayName, healthState } of p1Dcs) {
    const { embed, files } = await deps.buildDcEmbedAndFiles(dcName, false, displayName, healthState, undefined, [], null, null, deps.getNicknamesForDcMessage(game, { dcName, displayName }));
    const msg = await p1PlayArea.send({ embeds: [embed], files });
    deps.dcMessageMeta.set(msg.id, { gameId, playerNum: 1, dcName, displayName });
    deps.dcExhaustedState.set(msg.id, false);
    deps.dcHealthState.set(msg.id, healthState);
    const p1Components = deps.getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p1Components });
    game.p1DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p1DcAttachmentMessageIds.push(null);
    game.p1DcCompanionMessageIds.push(null);
  }
  for (const { dcName, displayName, healthState } of p2Dcs) {
    const { embed, files } = await deps.buildDcEmbedAndFiles(dcName, false, displayName, healthState, undefined, [], null, null, deps.getNicknamesForDcMessage(game, { dcName, displayName }));
    const msg = await p2PlayArea.send({ embeds: [embed], files });
    deps.dcMessageMeta.set(msg.id, { gameId, playerNum: 2, dcName, displayName });
    deps.dcExhaustedState.set(msg.id, false);
    deps.dcHealthState.set(msg.id, healthState);
    const p2Components = deps.getDcPlayAreaComponents(msg.id, false, game, dcName);
    await msg.edit({ components: p2Components });
    game.p2DcMessageIds.push(msg.id);
    // Attachments: only create when DC has attachments; create on demand in updateAttachmentMessageForDc
    game.p2DcAttachmentMessageIds.push(null);
    game.p2DcCompanionMessageIds.push(null);
  }
}
