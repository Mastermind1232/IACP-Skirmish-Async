/**
 * Activation handlers: status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getCcEffectsData, getDcEffects, getMapSpaces, getFigureSize, getDeploymentZones, getDcStats } from '../data-loader.js';
import { isFigurelessDc } from '../game/dc-helpers.js';
import { filterValidTopLeftSpaces } from '../engine/utils.js';
import { parseCoord } from '../game/coords.js';
import { cleanupActivation } from '../game/activation-state.js';
import { applyCondition, filterCondition, dcNameFromFigureKey, reduceHp, healHp, getMaxPowerTokens, grantPowerTokens, awardKillVp } from '../game/index.js';
import { getRange } from '../game/spatial.js';
import { getFootprintCells } from '../game/coords.js';
import { getDiceData, getDcKeywords } from '../data-loader.js';
import { setRoundPhase, ROUND_PHASES } from '../game/phase.js';
import { sendPowerTokenOverflowUI } from './combat.js';
import {
  getPlayerId,
  getDcList,
  getDcMessageIds,
  getPlayAreaId,
  getHandChannelId,
  getActivationsRemaining,
  getActivatedDcIndices,
  getCcHand,
  getDcAttachments,
  setActivationsRemaining,
  setActivatedDcIndices,
  ccDeckKey,
  ccDiscardKey,
  ccHandKey,
  opponentPlayerNum,
  getInitiativePlayerNum,
  removeFigurePosition,
} from '../game/player-helpers.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

/**
 * Determine the companion (if any) for a given DC, considering both
 * direct companion fields (e.g. Iden Versio → Dio) and attachment-based
 * companions (e.g. [Clan of Two] → The Child, [Indentured Jester] → Salacious B. Crumb).
 * Returns { companionName, companionStats, isCoActivation } or null.
 * isCoActivation is true for Junk Droid (Ugnaught) which co-activates rather than before/after.
 */
function getCompanionForDc(dcName, attachments) {
  const eff = getDcEffects();
  if (!eff) return null;
  const dcData = eff[dcName];
  if (!dcData) return null;
  // Direct companion field (string = named companion, true = IS a companion)
  if (typeof dcData.companion === 'string') {
    const companionName = dcData.companion;
    const companionStats = eff[companionName];
    if (!companionStats) return null;
    // Junk Droid co-activates as part of Ugnaught group
    const isCoActivation = companionName === 'Junk Droid';
    return { companionName, companionStats, isCoActivation };
  }
  // Attachment-based companions (attachments stored as plain names, dc-effects uses [brackets])
  if (attachments?.length) {
    for (const attName of attachments) {
      // Try both plain name and bracketed name
      const attData = eff[attName] || eff[`[${attName}]`];
      if (attData && typeof attData.companion === 'string') {
        const companionName = attData.companion;
        const companionStats = eff[companionName];
        if (!companionStats) continue;
        return { companionName, companionStats, isCoActivation: false };
      }
    }
  }
  return null;
}

/**
 * Build a summary string for a companion's stats.
 */
function formatCompanionStats(name, stats) {
  const parts = [`**${name}**`];
  if (stats.health) parts.push(`Health ${stats.health}`);
  if (stats.speed) parts.push(`Speed ${stats.speed}`);
  if (stats.attack) {
    const dice = (stats.attack.dice || []).join(', ');
    parts.push(`${stats.attack.type === 'melee' ? 'Melee' : 'Ranged'} (${dice})`);
  }
  if (stats.defense?.length) parts.push(`Defense: ${stats.defense.join(', ')}`);
  if (stats.passives?.length) parts.push(stats.passives.join(', '));
  if (stats.surgeAbilities?.length) parts.push(`Surges: ${stats.surgeAbilities.join('; ')}`);
  const specials = stats.specials?.length ? `\nSpecials: ${stats.specials.join(', ')}` : '';
  const abilitySnippet = stats.abilityText ? `\n${stats.abilityText.split('\n').slice(0, 2).join(' | ')}` : '';
  return parts.join(' | ') + specials + abilitySnippet;
}

/**
 * Field Tactics (Death Trooper Elite/Regular): after activation ends, choose a
 * friendly TROOPER or LEADER figure within 2 spaces (cost ≤6) to perform an
 * interrupt free attack.  Modelled on Coordinated Raid (pendingCoordinatedRaid).
 *
 * @param {object} game
 * @param {object} meta - dcMessageMeta entry for the activating DC
 * @param {string} dcMsgId - DC message ID that just finished activating
 * @param {Function} logGameAction
 * @param {object} client
 * @param {Function} findDcMsgIdForFigure - (gameId, playerNum, figureKey) => msgId | null
 */
async function maybePromptFieldTactics(game, meta, dcMsgId, logGameAction, client, findDcMsgIdForFigure) {
  const dcName = meta.dcName;
  if (dcName !== 'Death Trooper (Elite)' && dcName !== 'Death Trooper (Regular)') return;
  // Guard: limit once per round per group
  const ftRoundKey = `fieldTactics_${dcMsgId}`;
  if (game.roundFigureAbilityUsed?.[ftRoundKey]) return;
  const eff = getDcEffects();
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const prefix = `${dcName}-${dgIndex}-`;
  // Find any figure in this DG that is on the board to serve as origin for range check
  const myFigKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
  if (myFigKeys.length === 0) return;
  const originPos = game.figurePositions?.[meta.playerNum]?.[myFigKeys[0]];
  if (!originPos) return;
  // Scan all friendly figures for TROOPER or LEADER keyword, cost ≤ 6, within 2 spaces
  const validTargets = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[meta.playerNum] || {})) {
    if (!pos || fk.startsWith(prefix)) continue; // skip self
    const fkDcName = dcNameFromFigureKey(fk);
    const fkEff = eff?.[fkDcName];
    if (!fkEff) continue;
    const kws = (fkEff.keywords || []).map(k => String(k).toUpperCase());
    if (!kws.includes('TROOPER') && !kws.includes('LEADER')) continue;
    if ((fkEff.cost ?? 99) > 6) continue;
    if (getRange(originPos, pos) > 2) continue;
    validTargets.push(fk);
  }
  if (validTargets.length === 0) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  const gameId = game.gameId;
  if (validTargets.length === 1) {
    // Auto-select the only eligible figure
    const chosenFk = validTargets[0];
    const chosenMsgId = findDcMsgIdForFigure ? findDcMsgIdForFigure(gameId, meta.playerNum, chosenFk) : null;
    if (chosenMsgId) {
      game.pendingFieldTactics = { forMsgId: chosenMsgId, chosenFigureKey: chosenFk, triggeredByMsgId: dcMsgId };
    }
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    game.roundFigureAbilityUsed[ftRoundKey] = true;
    const chosenName = dcNameFromFigureKey(chosenFk);
    await logGameAction(game, client, `**Field Tactics** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.`, { phase: 'ROUND', icon: 'activate' });
    return;
  }
  // Multiple targets — show picker buttons
  const btns = validTargets.slice(0, 20).map(fk => {
    const label = dcNameFromFigureKey(fk);
    return new ButtonBuilder()
      .setCustomId(`field_tactics_pick_${gameId}_${dcMsgId}_${fk}`)
      .setLabel(label.slice(0, 80))
      .setStyle(ButtonStyle.Primary);
  });
  btns.push(
    new ButtonBuilder()
      .setCustomId(`field_tactics_pick_${gameId}_${dcMsgId}_skip`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
  );
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(...btns.slice(i, i + 5)));
  }
  await logGameAction(game, client, `<@${ownerId}> **Field Tactics** — Choose a friendly TROOPER/LEADER (cost ≤6) within 2 spaces to perform a free interrupt attack:`, {
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, hasActionsRemainingInGame, GAME_PHASES, PHASE_COLOR, getInitiativePlayerZoneLabel, logGameAction, updateHandChannelMessages, saveGames, client
 */
export async function handleStatusPhase(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    hasActionsRemainingInGame,
    GAME_PHASES,
    PHASE_COLOR,
    getInitiativePlayerZoneLabel,
    logGameAction,
    updateHandChannelMessages,
    saveGames,
    client,
  } = ctx;
  const gameId = interaction.customId.replace('status_phase_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can end the activation phase.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const r1 = game.p1ActivationsRemaining ?? 0;
  const r2 = game.p2ActivationsRemaining ?? 0;
  const hasActions = hasActionsRemainingInGame(game, gameId);
  if (r1 > 0 || r2 > 0 || hasActions) {
    const parts = [];
    if (r1 > 0 || r2 > 0) parts.push(`P1: ${r1} activations left, P2: ${r2} activations left`);
    if (hasActions) parts.push('some DCs still have actions to spend');
    await interaction.followUp({
      content: `Both players must use all activations and actions first. (${parts.join('; ')})`,
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const round = game.currentRound || 1;
  const clickerIsP1 = interaction.user.id === game.player1Id;
  game.p1ActivationPhaseEnded = game.p1ActivationPhaseEnded || false;
  game.p2ActivationPhaseEnded = game.p2ActivationPhaseEnded || false;
  // In test games, human (P1) clicks for both sides; first click = P1, second = P2
  if (game.isTestGame && clickerIsP1) {
    if (!game.p1ActivationPhaseEnded) game.p1ActivationPhaseEnded = true;
    else game.p2ActivationPhaseEnded = true;
  } else if (clickerIsP1) {
    game.p1ActivationPhaseEnded = true;
  } else {
    game.p2ActivationPhaseEnded = true;
  }
  const bothEnded = game.p1ActivationPhaseEnded && game.p2ActivationPhaseEnded;
  if (!bothEnded) {
    const waiting = !game.p1ActivationPhaseEnded ? 'P1' : 'P2';
    await interaction.followUp({
      content: `${clickerIsP1 ? 'P1' : 'P2'} has ended activation. Waiting for **${waiting}** to click **End R${round} Activation Phase**.`,
      ephemeral: true,
    }).catch(discordCatch);
    const generalChannel = await client.channels.fetch(game.generalId);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`${GAME_PHASES.ROUND.emoji}  ROUND ${round} - Activation Phase`)
      .setColor(PHASE_COLOR);
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.message.edit({
      content: `**Round ${round}** — End Activation Phase: ${game.p1ActivationPhaseEnded ? 'P1 ✅' : 'P1 ⏳'} | ${game.p2ActivationPhaseEnded ? 'P2 ✅' : 'P2 ⏳'}\nBoth players must click the button when done with activations and any end-of-activation effects.`,
      embeds: [roundEmbed],
      components: [endBtn],
    }).catch(discordCatch);
    saveGames();
    return;
  }
  game.p1ActivationPhaseEnded = false;
  game.p2ActivationPhaseEnded = false;
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Phase gate: both players confirm before entering end-of-round effects
  const { sendPhaseGateMessages } = ctx;
  if (sendPhaseGateMessages) {
    await sendPhaseGateMessages(game, 'pre_end_of_round', ctx);
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames
 */
export async function handlePassActivationTurn(interaction, ctx) {
  const { getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames } = ctx;
  const gameId = interaction.customId.replace('pass_activation_turn_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const turnPlayerId = game.currentActivationTurnPlayerId ?? game.initiativePlayerId;
  const turnPlayerNum = turnPlayerId === game.player1Id ? 1 : 2;
  if (!await requirePlayer(interaction, game, interaction.user.id, turnPlayerNum, canActAsPlayer, "It's not your turn to pass.")) return;
  // Force Vision: cannot pass if you haven't picked yet or have a named group pending
  if (game.forceVisionPending && game.forceVisionPending === turnPlayerNum) {
    await interaction.followUp({ content: `👁️ **Force Vision** — You must first choose a group from the Force Vision prompt before passing.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.forceVisionNextActivation && game.forceVisionNextActivation.playerNum === turnPlayerNum) {
    const _fvDcName = game.forceVisionNextActivation.dcName;
    await interaction.followUp({ content: `👁️ **Force Vision** — You cannot pass. You must activate **${_fvDcName}** next.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const myRem = getActivationsRemaining(game, turnPlayerNum) ?? 0;
  const otherPlayerNum = opponentPlayerNum(turnPlayerNum);
  const otherRem = getActivationsRemaining(game, otherPlayerNum) ?? 0;
  if (otherRem <= myRem) {
    await interaction.followUp({ content: `You have **${myRem}** activation${myRem !== 1 ? 's' : ''} remaining; opponent has **${otherRem}**. You can only pass when they have more.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const otherPlayerId = getPlayerId(game, otherPlayerNum);
  const round = game.currentRound || 1;
  const turnNum = turnPlayerNum;
  const turnZone = getPlayerZoneLabel(game, turnPlayerId);
  const roundContentBefore = `<@${turnPlayerId}> (${turnZone}**Player ${turnNum}**) **Round ${round}** — Your turn to activate! You may pass back if the other player has more activations.`;
  game.currentActivationTurnPlayerId = otherPlayerId;
  const passLogMsg = await logGameAction(game, client, `<@${turnPlayerId}> passed the turn to <@${otherPlayerId}> (Player ${otherPlayerNum} has more activations remaining).`, { phase: 'ROUND', icon: 'activate', allowedMentions: { users: [otherPlayerId] } });
  pushUndo(game, {
    type: 'pass_turn',
    previousTurnPlayerId: turnPlayerId,
    gameLogMessageId: passLogMsg?.id,
    roundMessageId: game.roundActivationMessageId,
    roundContentBefore,
    gameId,
  });
  if (game.roundActivationMessageId && game.generalId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const initNum = otherPlayerNum;
      const newCurrentRem = getActivationsRemaining(game, otherPlayerNum) ?? 0;
      const justPassedRem = getActivationsRemaining(game, turnPlayerNum) ?? 0;
      const passRows = [];
      if (justPassedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      const otherZone = getPlayerZoneLabel(game, otherPlayerId);
      await msg.edit({
        content: `<@${otherPlayerId}> (${otherZone}**Player ${initNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back if the other player has more activations.' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch(discordCatch);
    } catch (err) {
      console.error('Failed to update round message for pass:', err);
    }
  }
  saveGames();
}

// ── Lie in Ambush: trigger check + deploy handler ───────────────────────────

/**
 * After an opponent activates a group, check if the Lie in Ambush trigger fires.
 * "If you have 3+ exhausted or defeated groups and it is not the first round,
 *  deploy this group to any deployment zone."
 * @param {object} game
 * @param {number} activatingPlayerNum - player who just finished activating
 * @param {object} ctx - logGameAction, client
 */
async function checkLieInAmbushTrigger(game, activatingPlayerNum, ctx) {
  const { logGameAction, client } = ctx;
  const liaOwnerNum = opponentPlayerNum(activatingPlayerNum);

  // Not round 1
  if ((game.currentRound || 1) <= 1) return;

  // Owner has set-aside figures
  const setAsideKeys = game.lieInAmbushSetAside?.[liaOwnerNum];
  if (!setAsideKeys?.length) return;

  // Not already deployed (check first figure key)
  if (game.figurePositions?.[liaOwnerNum]?.[setAsideKeys[0]]) return;

  // Not already pending
  if (game.pendingLieInAmbush) return;

  // Count exhausted or defeated groups for the LiA owner
  const dcList = getDcList(game, liaOwnerNum) || [];
  const activatedIndices = new Set(getActivatedDcIndices(game, liaOwnerNum) || []);
  const pos = game.figurePositions?.[liaOwnerNum] || {};

  let exhOrDefeated = 0;
  const figureDcCounts = {};
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = dc?.dcName || dc?.displayName;
    if (!dcName || isFigurelessDc(dcName)) continue;

    figureDcCounts[dcName] = (figureDcCounts[dcName] || 0) + 1;
    const dgIndex = figureDcCounts[dcName];

    // Skip the set-aside group itself
    if (setAsideKeys.includes(`${dcName}-${dgIndex}-0`)) continue;

    // Exhausted = activated this round
    if (activatedIndices.has(i)) { exhOrDefeated++; continue; }

    // Defeated = all figures removed from board
    const figures = getDcStats(dcName)?.figures ?? 1;
    let allGone = true;
    for (let f = 0; f < figures; f++) {
      if (pos[`${dcName}-${dgIndex}-${f}`]) { allGone = false; break; }
    }
    if (allGone) exhOrDefeated++;
  }

  if (exhOrDefeated < 3) return;

  // Trigger fires — show zone selection in owner's hand channel
  const dcName = dcNameFromFigureKey(setAsideKeys[0]);
  game.pendingLieInAmbush = { playerNum: liaOwnerNum, dcName };

  const gameId = game.gameId;
  const liaOwnerId = getPlayerId(game, liaOwnerNum);
  const handId = getHandChannelId(game, liaOwnerNum);

  try {
    const handChannel = await client.channels.fetch(handId);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lia_deploy_zone_${gameId}_${liaOwnerNum}_red`)
        .setLabel('Deploy to Red Zone')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`lia_deploy_zone_${gameId}_${liaOwnerNum}_blue`)
        .setLabel('Deploy to Blue Zone')
        .setStyle(ButtonStyle.Primary),
    );
    await handChannel.send({
      content: `🎯 **Lie in Ambush** triggered! You have **${exhOrDefeated}** exhausted/defeated groups.\nDeploy **${dcName}** to any deployment zone:`,
      components: [row],
    });
  } catch (err) {
    console.error('[Lie in Ambush] Failed to send zone selection:', err.message);
  }

  await logGameAction(game, client, `🎯 **Lie in Ambush** — <@${liaOwnerId}> may deploy **${dcName}** (${exhOrDefeated} exhausted/defeated groups).`, {
    allowedMentions: { users: [liaOwnerId] },
    phase: 'ROUND',
    icon: 'deploy',
  });
}

/**
 * Handle lia_deploy_zone_ button: deploy the set-aside group to chosen zone.
 */
export async function handleLiaDeployZone(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames } = ctx;
  // customId: lia_deploy_zone_<gameId>_<playerNum>_<zone>
  const parts = interaction.customId.split('_');
  const zone = parts[parts.length - 1]; // red or blue
  const playerNum = parseInt(parts[parts.length - 2], 10);
  const gameId = parts.slice(3, -2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  const ownerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owning player can deploy this group.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const setAsideKeys = game.lieInAmbushSetAside?.[playerNum];
  if (!setAsideKeys?.length) {
    await interaction.followUp({ content: 'No set-aside group to deploy.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Get zone spaces
  const mapId = game.selectedMap?.id;
  const zones = mapId ? getDeploymentZones()[mapId] : null;
  const zoneSpaces = (zones?.[zone] || []).map(s => String(s).toLowerCase());
  if (!zoneSpaces.length) {
    await interaction.followUp({ content: `No spaces in the ${zone} zone.`, ephemeral: true }).catch(discordCatch);
    return;
  }

  // Build occupied set
  const occupied = [];
  for (const p of [1, 2]) {
    for (const [k, s] of Object.entries(game.figurePositions?.[p] || {})) {
      const dn = dcNameFromFigureKey(k);
      const size = game.figureOrientations?.[k] || getFigureSize(dn);
      occupied.push(...getFootprintCells(s, size));
    }
  }

  // Compute opponent zone centroid for entrance-based sorting
  const oppZone = zone === 'red' ? 'blue' : 'red';
  const oppCoords = (zones?.[oppZone] || []).map(s => parseCoord(String(s).toLowerCase()));
  const oppCx = oppCoords.length ? oppCoords.reduce((a, c) => a + c.col, 0) / oppCoords.length : 0;
  const oppCy = oppCoords.length ? oppCoords.reduce((a, c) => a + c.row, 0) / oppCoords.length : 0;

  const dcName = dcNameFromFigureKey(setAsideKeys[0]);
  const figureSize = getFigureSize(dcName);
  const ms = getMapSpaces(mapId);
  const blocking = ms?.blocking || [];

  if (!game.figurePositions) game.figurePositions = { 1: {}, 2: {} };
  if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};

  let placed = 0;
  for (const fk of setAsideKeys) {
    // Rebuild occupied for each figure since previous placements change it
    const currentOccupied = [];
    for (const p of [1, 2]) {
      for (const [k, s] of Object.entries(game.figurePositions[p] || {})) {
        const dn = dcNameFromFigureKey(k);
        const size = game.figureOrientations?.[k] || getFigureSize(dn);
        currentOccupied.push(...getFootprintCells(s, size));
      }
    }

    const validSpaces = filterValidTopLeftSpaces(zoneSpaces, currentOccupied, figureSize, getFootprintCells, blocking, false);
    if (!validSpaces.length) continue;

    // Sort by proximity to opponent zone entrance
    validSpaces.sort((a, b) => {
      const pa = parseCoord(a), pb = parseCoord(b);
      return (Math.abs(pa.col - oppCx) + Math.abs(pa.row - oppCy)) -
             (Math.abs(pb.col - oppCx) + Math.abs(pb.row - oppCy));
    });

    game.figurePositions[playerNum][fk] = validSpaces[0];
    placed++;
  }

  // Clean up set-aside state
  delete game.lieInAmbushSetAside[playerNum];
  delete game.pendingLieInAmbush;

  // Remove the zone selection message
  try {
    await interaction.message.delete();
  } catch {}

  await logGameAction(game, client, `🎯 **Lie in Ambush** — **${dcName}** deployed ${placed} figure(s) to the **${zone}** zone!`, {
    phase: 'ROUND',
    icon: 'deploy',
  });

  saveGames();
  await interaction.followUp({ content: `Deployed **${dcName}** (${placed} figure(s)) to the **${zone}** zone.`, ephemeral: true }).catch(discordCatch);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, logGameAction, maybeShowEndActivationPhaseButton, client, saveGames
 */
export async function handleEndTurn(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getNicknamesForDcMessage,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^end_turn_([^_]+)_(.+)$/);
  if (!match) return;
  const gameId = match[1];
  const dcMsgId = match[2];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(dcMsgId);
  if (!meta || meta.gameId !== gameId) {
    await interaction.followUp({ content: 'Invalid End Turn.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the player who finished that activation can end the turn.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pending = game.pendingEndTurn?.[dcMsgId];
  if (!pending) {
    await interaction.followUp({ content: 'This turn was already ended.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const otherPlayerNum = opponentPlayerNum(meta.playerNum);
  const otherPlayerId = getPlayerId(game, otherPlayerNum);
  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[dcMsgId] = true;
  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = dcMsgId;
  delete game.pendingEndTurn[dcMsgId];
  if (pending.messageId) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const endTurnMsg = await ch.messages.fetch(pending.messageId);
      await endTurnMsg.edit({ components: [] }).catch(discordCatch);
    } catch {}
  }
  // Shield (Riot Trooper E/R): at end of activation, if no Block tokens, gain 1 Block token
  const _shieldEff = getDcEffects()?.[meta.dcName];
  if ((_shieldEff?.passives || []).includes('Shield')) {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    for (const fk of figureKeys) {
      const tokens = game.figurePowerTokens?.[fk] || [];
      if (!tokens.includes('Block')) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
        if (game.figurePowerTokens[fk].length < getMaxPowerTokens(fk)) {
          game.figurePowerTokens[fk].push('Block');
          const fkName = dcNameFromFigureKey(fk);
          await logGameAction(game, client, `🛡️ **Shield** — **${fkName}** gained 1 **Block Token** at end of activation.`, { phase: 'ROUND', icon: 'activate' });
        }
      }
    }
  }

  // In The Shadows (ISB Infiltrator Elite): become Hidden at end of activation
  if (meta.dcName === 'ISB Infiltrator (Elite)') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Hide');
    }
    if (figureKeys.length > 0) {
      await logGameAction(game, client, `🥷 **In The Shadows** — **ISB Infiltrator (Elite)** figures became **Hidden** at end of activation.`, { phase: 'ROUND', icon: 'activate' });
    }
  }
  // Unnerving (0-0-0): at end of activation, each adjacent hostile becomes Weakened
  if (meta.dcName === '0-0-0') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    const figureKeys000 = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(k => k.startsWith(prefix));
    const enemyNum = opponentPlayerNum(meta.playerNum);
    const ms = getMapSpaces(game.selectedMap?.id);
    const weakened = [];
    for (const fk of figureKeys000) {
      const pos = game.figurePositions?.[meta.playerNum]?.[fk];
      if (!pos) continue;
      const posNorm = String(pos).toLowerCase();
      const adj = (ms?.adjacency?.[posNorm] || []).map(a => String(a).toLowerCase());
      for (const [eFk, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (!adj.includes(String(ePos).toLowerCase())) continue;
        // Condition Immunity: skip Weaken for immune figures
        const _unnEff = getDcEffects()?.[dcNameFromFigureKey(eFk)] || getDcEffects()?.[dcNameFromFigureKey(eFk)?.replace(/\s*\[.*\]\s*$/, '')];
        const _unnImm = (_unnEff?.specialAbilityIds || []).includes('immune_onar') || (_unnEff?.specialAbilityIds || []).includes('immune_snowtrooper_elite');
        if (_unnImm) continue;
        if (applyCondition(game, eFk, 'Weaken')) {
          weakened.push(dcNameFromFigureKey(eFk));
        }
      }
    }
    if (weakened.length > 0) {
      await logGameAction(game, client, `😈 **Unnerving** — **0-0-0** Weakened adjacent hostiles: ${weakened.join(', ')}.`, { phase: 'ROUND', icon: 'activate' });
    }
  }
  // Hold the Line (Baze Malbus): at end of activation, gain 1 Block Token per hostile with LOS
  if (meta.dcName === 'Baze Malbus') {
    const _htlHasLos = ctx.hasLineOfSight;
    const _htlMapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
    const _htlDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _htlFk = `Baze Malbus-${_htlDgIndex}-0`;
    const _htlPos = game.figurePositions?.[meta.playerNum]?.[_htlFk];
    let _htlBlockCount = 0;
    if (_htlPos && _htlHasLos && _htlMapSpaces) {
      const _htlEnemyNum = opponentPlayerNum(meta.playerNum);
      const _htlAllFigCoords = [];
      for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) _htlAllFigCoords.push(String(fp).toLowerCase());
      for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) _htlAllFigCoords.push(String(fp).toLowerCase());
      for (const [, ePos] of Object.entries(game.figurePositions?.[_htlEnemyNum] || {})) {
        if (!ePos) continue;
        if (_htlHasLos(String(_htlPos).toLowerCase(), String(ePos).toLowerCase(), _htlMapSpaces, _htlAllFigCoords)) _htlBlockCount++;
      }
    }
    if (_htlBlockCount > 0) {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[_htlFk] = game.figurePowerTokens[_htlFk] || [];
      const _htlMax = getMaxPowerTokens(_htlFk);
      for (let i = 0; i < _htlBlockCount; i++) { if (game.figurePowerTokens[_htlFk].length < _htlMax) game.figurePowerTokens[_htlFk].push('Block'); }
    }
    await logGameAction(game, client, `🛡️ **Hold the Line** — **${meta.displayName || 'Baze Malbus'}** gained **${_htlBlockCount} Block Token${_htlBlockCount !== 1 ? 's' : ''}** (${_htlBlockCount} hostile${_htlBlockCount !== 1 ? 's' : ''} with LOS).`, { phase: 'ROUND', icon: 'activate' });
  }

  const actionsData = game.dcActionsData?.[dcMsgId];
  if (actionsData?.threadId) {
    try {
      const thread = await client.channels.fetch(actionsData.threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete DC activation thread:', err);
    }
    if (game.dcActionsData?.[dcMsgId]) delete game.dcActionsData[dcMsgId];
    if (game.nextAttacksBonusHits?.[meta.playerNum]) delete game.nextAttacksBonusHits[meta.playerNum];
    if (game.nextAttacksBonusConditions?.[meta.playerNum]) delete game.nextAttacksBonusConditions[meta.playerNum];
    if (game.nextAttackBonusSurgeAbilities?.[meta.playerNum]) delete game.nextAttackBonusSurgeAbilities[meta.playerNum];
    if (game.nextAttackBonusPierce?.[meta.playerNum]) delete game.nextAttackBonusPierce[meta.playerNum];
    if (game.movementBank?.[dcMsgId]) delete game.movementBank[dcMsgId];
  }
  try {
    const playAreaId = getPlayAreaId(game, meta.playerNum);
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(dcMsgId);
    const healthState = dcHealthState.get(dcMsgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, meta.displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[dcMsgId] || game?.p2DcAttachments?.[dcMsgId] || []), null, null, getNicknamesForDcMessage?.(game, meta));
    const components = getDcPlayAreaComponents(dcMsgId, true, game, meta.dcName);
    await dcMsg.edit({
      embeds: [embed],
      files,
      components,
    }).catch(discordCatch);
  } catch (err) {
    console.error('Failed to update DC card after End Turn:', err);
  }

  // --- Companion activation at end of turn ---
  {
    const _compAttachments = game.p1DcAttachments?.[dcMsgId] || game.p2DcAttachments?.[dcMsgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    if (_compInfo && !_compInfo.isCoActivation) {
      const _compState = game.companionActivatedBefore?.[dcMsgId];
      if (_compState === 'pending-after' || !_compState) {
        const _compSummary = formatCompanionStats(_compInfo.companionName, _compInfo.companionStats);
        await logGameAction(game, client, `🐾 **${_compInfo.companionName} activates NOW** (after **${meta.displayName || meta.dcName}**'s activation).\nPerform the companion's activation (move, attack, special actions) manually.\n\n${_compSummary}`, {
          phase: 'ACTIVATION',
          icon: 'activate',
        });
      }
    }
    if (game.companionActivatedBefore?.[dcMsgId]) {
      delete game.companionActivatedBefore[dcMsgId];
    }
  }

  // Son of Skywalker: auto-ready Luke's DC after any activation ends
  if (game.sonOfSkywalkerActive) {
    const sos = game.sonOfSkywalkerActive;
    const sosDcMsgId = sos.dcMsgId;
    const sosPlayerNum = sos.playerNum;
    // Don't re-ready if this IS Luke's activation ending (he just activated, should stay exhausted)
    if (sosDcMsgId !== dcMsgId) {
      const sosDcIds = getDcMessageIds(game, sosPlayerNum) || [];
      const sosIdx = sosDcIds.indexOf(sosDcMsgId);
      const sosActivated = getActivatedDcIndices(game, sosPlayerNum);
      if (sosIdx >= 0 && Array.isArray(sosActivated) && sosActivated.includes(sosIdx)) {
        setActivatedDcIndices(game, sosPlayerNum, sosActivated.filter((i) => i !== sosIdx));
        const sosMeta = dcMessageMeta.get(sosDcMsgId);
        const sosName = sosMeta?.displayName || sosMeta?.dcName || 'Luke Skywalker';
        await logGameAction(game, client, `⚡ **Son of Skywalker** — **${sosName}** is automatically **Readied**.`, { phase: 'ROUND', icon: 'activate' });
      }
    }
  }

  game.currentActivationTurnPlayerId = otherPlayerId;
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${pending.displayName}** finished all actions — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const round = game.currentRound || 1;
      const newCurrentRem = getActivationsRemaining(game, otherPlayerNum) ?? 0;
      const justActedRem = getActivationsRemaining(game, meta.playerNum) ?? 0;
      const passRows = [];
      if (justActedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      await msg.edit({
        content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch(discordCatch);
    } catch (err) {
      console.error('Failed to update round message after end turn:', err);
    }
  }
  await maybeShowEndActivationPhaseButton(game, client);
  // Field Tactics (Death Trooper): after activation, choose a friendly TROOPER/LEADER within 2 to perform a free attack
  await maybePromptFieldTactics(game, meta, dcMsgId, logGameAction, client, ctx.findDcMessageIdForFigure);
  // Lie in Ambush: after opponent activates, check if trigger fires
  await checkLieInAmbushTrigger(game, meta.playerNum, ctx);
  saveGames();
}

/**
 * Handle dc_end_activation_ — red "End Activation" button on the DC card.
 * Immediately ends the current activation: deletes thread, cleans up state, pings opponent.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
export async function handleDcEndActivation(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getNicknamesForDcMessage,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    client,
    saveGames,
  } = ctx;
  const msgId = interaction.customId.replace('dc_end_activation_', '');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can end this activation.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const otherPlayerNum = opponentPlayerNum(meta.playerNum);
  const otherPlayerId = getPlayerId(game, otherPlayerNum);
  const displayName = meta.displayName || meta.dcName;
  const gameId = game.gameId;

  // Clean up activation state
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData?.threadId) {
    try {
      const thread = await client.channels.fetch(actionsData.threadId);
      await thread.delete();
    } catch (err) {
      console.error('Failed to delete DC activation thread on End Activation:', err);
    }
  }
  // Build figure keys for only the activated deployment group (not all DGs)
  const endEff = getDcEffects()?.[meta.dcName];
  const figCount = endEff?.figures || 1;
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '0';
  const figureKeys = [];
  for (let fi = 0; fi < figCount; fi++) {
    figureKeys.push(`${meta.dcName}-${dgIndex}-${fi}`);
  }
  cleanupActivation(game, msgId, meta.playerNum, figureKeys);
  // Stun: discarded at end of activation (condition logic, not a flag)
  if (game.figureConditions && ctx.getDcStats) {
    const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const figures = ctx.getDcStats(meta.dcName).figures ?? 1;
    for (let f = 0; f < figures; f++) {
      const fk = `${meta.dcName}-${dgIndex}-${f}`;
      filterCondition(game, fk, 'Stun');
    }
  }

  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = msgId;
  game.currentActivationTurnPlayerId = otherPlayerId;

  // Update DC card (stays exhausted)
  try {
    const playAreaId = getPlayAreaId(game, meta.playerNum);
    const playChannel = await client.channels.fetch(playAreaId);
    const dcMsg = await playChannel.messages.fetch(msgId);
    const healthState = dcHealthState.get(msgId) ?? [[null, null]];
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, healthState, getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []), null, null, getNicknamesForDcMessage?.(game, meta));
    await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, meta.dcName) }).catch(discordCatch);
  } catch (err) {
    console.error('Failed to update DC card after End Activation:', err);
  }

  // --- Companion activation at end of activation ---
  // If companion was marked 'pending-after' or was never addressed (player ignored buttons), activate now
  {
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    if (_compInfo && !_compInfo.isCoActivation) {
      const _compState = game.companionActivatedBefore?.[msgId];
      if (_compState === 'pending-after' || !_compState) {
        const _compSummary = formatCompanionStats(_compInfo.companionName, _compInfo.companionStats);
        await logGameAction(game, client, `🐾 **${_compInfo.companionName} activates NOW** (after **${displayName}**'s activation).\nPerform the companion's activation (move, attack, special actions) manually.\n\n${_compSummary}`, {
          phase: 'ACTIVATION',
          icon: 'activate',
        });
      }
    }
    // Clean up companion tracking for this activation
    if (game.companionActivatedBefore?.[msgId]) {
      delete game.companionActivatedBefore[msgId];
    }
  }

  // Ping opponent
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${displayName}** ended activation — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });

  // Update round activation message
  if (game.roundActivationMessageId && game.generalId && !game.roundActivationButtonShown) {
    try {
      const ch = await client.channels.fetch(game.generalId);
      const msg = await ch.messages.fetch(game.roundActivationMessageId);
      const round = game.currentRound || 1;
      const newCurrentRem = getActivationsRemaining(game, otherPlayerNum) ?? 0;
      const justActedRem = getActivationsRemaining(game, meta.playerNum) ?? 0;
      const passRows = [];
      if (justActedRem > newCurrentRem && newCurrentRem > 0) {
        passRows.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pass_activation_turn_${gameId}`)
            .setLabel('Pass turn to opponent')
            .setStyle(ButtonStyle.Secondary)
        ));
      }
      await msg.edit({
        content: `<@${otherPlayerId}> (**Player ${otherPlayerNum}**) **Round ${round}** — Your turn to activate!${passRows.length ? ' You may pass back (opponent has more activations).' : ''}`,
        components: passRows,
        allowedMentions: { users: [otherPlayerId] },
      }).catch(discordCatch);
    } catch (err) {
      console.error('Failed to update round message after End Activation:', err);
    }
  }
  await maybeShowEndActivationPhaseButton(game, client);

  // On a Diplomatic Mission (Skirmish Upgrade, LEADER): exhaust at end of activation if no attack → choice
  {
    const _odmUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _odmExh = game.exhaustedSkirmishUpgrades?.[msgId] || [];
    if (_odmUpgrades.includes('On a Diplomatic Mission') && !_odmExh.includes('On a Diplomatic Mission') && !game.attackPerformedThisActivation?.[msgId]) {
      const _odmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${msgId}_mp`).setLabel('+2 MP').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${msgId}_evade`).setLabel('+1 Evade (rest of round)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${msgId}_vp`).setLabel('+1 VP').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`on_diplomatic_${gameId}_${msgId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await logGameAction(game, client, `<@${ownerId}> **On a Diplomatic Mission** — No attack this activation. Choose a bonus:`, {
        components: [_odmRow],
        allowedMentions: { users: [ownerId] },
      });
    }
  }
  // Clean up attack tracking for this activation
  if (game.attackPerformedThisActivation?.[msgId]) delete game.attackPerformedThisActivation[msgId];

  // Squad Swarm: after ending activation, offer to activate another DC with the same name (combined cost ≤ 15)
  if (game.squadSwarmPlayerNum === meta.playerNum) {
    const _sqDcList = getDcList(game, meta.playerNum) || [];
    const _sqDcIds = getDcMessageIds(game, meta.playerNum) || [];
    const sameNameIds = _sqDcIds.filter((id, i) => {
      if (!id || id === msgId) return false;
      const dc = _sqDcList[i];
      if (!dc || dc.defeated || dc.dcName !== meta.dcName) return false;
      return !ctx.dcExhaustedState?.get(id);
    });
    // G4: Track cumulative cost across chained Squad Swarm activations
    const thisCost = ctx.getDcStats?.(meta.dcName)?.cost ?? 0;
    const cumulativeCost = (game.squadSwarmCumulativeCost ?? 0) + thisCost;
    game.squadSwarmCumulativeCost = cumulativeCost;
    const eligibleIds = sameNameIds.filter((id) => {
      const dc = _sqDcList[_sqDcIds.indexOf(id)];
      const candidateCost = dc ? (ctx.getDcStats?.(dc.dcName)?.cost ?? 0) : 0;
      return (cumulativeCost + candidateCost) <= 15;
    });
    if (eligibleIds.length > 0) {
      const ownerId = getPlayerId(game, meta.playerNum);
      const btns = eligibleIds.slice(0, 4).map((id) =>
        new ButtonBuilder()
          .setCustomId(`squad_swarm_yes_${gameId}_${msgId}_${id}`)
          .setLabel(`Activate ${ctx.dcMessageMeta?.get(id)?.displayName || meta.dcName}`.slice(0, 80))
          .setStyle(ButtonStyle.Success)
      );
      btns.push(new ButtonBuilder().setCustomId(`squad_swarm_no_${gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await logGameAction(game, client, `<@${ownerId}> **Squad Swarm** — activate another **${meta.dcName}** (${cumulativeCost} pts used)?`, {
        components: [new ActionRowBuilder().addComponents(...btns)],
        allowedMentions: { users: [ownerId] },
      });
    } else {
      // G4: No eligible candidates — clear cumulative cost
      delete game.squadSwarmCumulativeCost;
    }
  }

  // Lie in Ambush: after opponent activates, check if trigger fires
  await checkLieInAmbushTrigger(game, meta.playerNum, ctx);

  // Auto-prompt owner for post-activation reaction cards (Change of Plans, Provoke, etc.)
  try {
    const ccCards = getCcEffectsData?.()?.cards || {};
    const _endActTimings = new Set(['afterYouResolveGroupsActivation', 'afterActivationResolves', 'endOfActivation']);
    const hand = getCcHand(game, meta.playerNum) || [];
    const reactCards = [...new Set(hand)].filter(c => ccCards[c]?.timing && _endActTimings.has(ccCards[c].timing));
    if (reactCards.length) {
      await logGameAction(game, client, `<@${ownerId}> — Activation ended! You have ${reactCards.length} reaction card(s) playable now. Check your Hand channel.`, {
        allowedMentions: { users: [ownerId] },
        phase: 'ROUND',
        icon: 'card',
      });
    }
  } catch (_endActErr) {
    console.error('End-activation reaction prompt error:', _endActErr?.message ?? _endActErr);
  }

  // Field Tactics (Death Trooper): after activation, choose a friendly TROOPER/LEADER within 2 to perform a free attack
  await maybePromptFieldTactics(game, meta, msgId, logGameAction, client, ctx.findDcMessageIdForFigure);

  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, dcExhaustedState, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, updateActivationsMessage, getActionsCounterContent, getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons, DC_ACTIONS_PER_ACTIVATION, ThreadAutoArchiveDuration, ACTION_ICONS, client, saveGames
 */
export async function handleConfirmActivate(interaction, ctx) {
  const {
    getGame,
    dcMessageMeta,
    dcExhaustedState,
    dcHealthState,
    buildDcEmbedAndFiles,
    getConditionsForDcMessage,
    getNicknamesForDcMessage,
    getDcPlayAreaComponents,
    updateActivationsMessage,
    getActionsCounterContent,
    getDcActionButtons,
    getActivationMinimapAttachment,
    getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION,
    ThreadAutoArchiveDuration,
    ACTION_ICONS,
    logGameAction,
    client,
    saveGames,
  } = ctx;
  const match = interaction.customId.match(/^confirm_activate_([^_]+)_(.+)_(\d+)$/);
  if (!match) return;
  const [, gameId, msgId, activateCardMsgIdStr] = match;
  const activateCardMsgId = activateCardMsgIdStr === '0' ? null : activateCardMsgIdStr;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta || meta.gameId !== gameId) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) return;
  const remaining = getActivationsRemaining(game, meta.playerNum);
  if (remaining <= 0) {
    await interaction.followUp({ content: 'No activations remaining.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Force Vision (Kanan): block activation while opponent hasn't picked yet
  if (game.forceVisionPending && game.forceVisionPending === meta.playerNum) {
    await interaction.followUp({ content: `👁️ **Force Vision** — You must first choose a group from the Force Vision prompt before activating.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Force Vision (Kanan): enforce forced activation
  if (game.forceVisionNextActivation && game.forceVisionNextActivation.playerNum === meta.playerNum) {
    const _fvConfirmDcName = game.forceVisionNextActivation.dcName;
    if (meta.dcName !== _fvConfirmDcName) {
      const _fvConfirmDcList = getDcList(game, meta.playerNum) || [];
      const _fvConfirmActivated = getActivatedDcIndices(game, meta.playerNum) || [];
      const _fvConfirmIdx = _fvConfirmDcList.findIndex((d) => d.dcName === _fvConfirmDcName);
      if (_fvConfirmIdx >= 0 && !_fvConfirmActivated.includes(_fvConfirmIdx)) {
        const _fvConfirmFigs = game.figurePositions?.[meta.playerNum] || {};
        const _fvConfirmAlive = Object.entries(_fvConfirmFigs).some(([fk, pos]) => fk.startsWith(_fvConfirmDcName + '-') && pos);
        if (_fvConfirmAlive) {
          await interaction.followUp({ content: `👁️ **Force Vision** — **${_fvConfirmDcName}** must be the next group to activate, if able.`, ephemeral: true }).catch(discordCatch);
          return;
        }
        game.forceVisionNextActivation = null;
      } else {
        game.forceVisionNextActivation = null;
      }
    } else {
      game.forceVisionNextActivation = null;
    }
  }
  // Strength in Numbers: enforce combined deployment cost <= 12
  const sinData = game.strengthInNumbersData;
  if (sinData && sinData.playerNum === meta.playerNum) {
    const candidateCost = ctx.getDcStats?.(meta.dcName)?.cost ?? 0;
    const combinedCost = (sinData.triggeringGroupCost || 0) + candidateCost;
    if (combinedCost > 12) {
      const displayName = meta.displayName || meta.dcName;
      await interaction.followUp({
        content: `**Strength in Numbers** — Combined deployment cost of **${sinData.triggeringGroupName || 'previous group'}** (${sinData.triggeringGroupCost}) + **${displayName}** (${candidateCost}) = **${combinedCost}**, which exceeds the 12-point cap. Choose a cheaper group.`,
        ephemeral: true,
      }).catch(discordCatch);
      return;
    }
  }
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  dcExhaustedState.set(msgId, true);
  setActivationsRemaining(game, meta.playerNum, (getActivationsRemaining(game, meta.playerNum) || 0) - 1);
  {
    const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
    if (dcIndex !== -1) {
      const indices = getActivatedDcIndices(game, meta.playerNum) || [];
      setActivatedDcIndices(game, meta.playerNum, [...indices, dcIndex]);
    }
  }
  await updateActivationsMessage(game, meta.playerNum, client);
  // Strength in Numbers: clear the flag after the extra activation is committed
  if (game.strengthInNumbersData && game.strengthInNumbersData.playerNum === meta.playerNum) {
    game.strengthInNumbersData = null;
    game.strengthInNumbersPlayerNum = null;
  }
  const displayName = meta.displayName || meta.dcName;
  const playAreaId = getPlayAreaId(game, meta.playerNum);
  const playChannel = await client.channels.fetch(playAreaId);
  const dcMsg = await playChannel.messages.fetch(msgId);
  const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, true, displayName, dcHealthState.get(msgId) ?? [[null, null]], getConditionsForDcMessage?.(game, meta), (game?.p1DcAttachments?.[msgId] || game?.p2DcAttachments?.[msgId] || []), null, null, getNicknamesForDcMessage?.(game, meta));
  await dcMsg.edit({ embeds: [embed], files, components: getDcPlayAreaComponents(msgId, true, game, meta.dcName) });
  const threadName = displayName.length > 100 ? displayName.slice(0, 97) + '…' : displayName;
  const thread = await dcMsg.startThread({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek });
  game.movementBank = game.movementBank || {};
  game.movementBank[msgId] = { total: 0, remaining: 0, threadId: thread.id, messageId: null, displayName };
  // Deploy bonus MP (legacy backward-compat — post-deploy MP is now spent immediately via movement engine)
  if (game.deployBonusMp) {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const prefix = `${meta.dcName}-${dgIndex}-`;
    let _dbTotal = 0;
    for (const [dbFk, dbAmt] of Object.entries(game.deployBonusMp)) {
      if (dbFk.startsWith(prefix) && dbAmt > 0) {
        _dbTotal = Math.max(_dbTotal, dbAmt); // per-group: use max figure bonus
        delete game.deployBonusMp[dbFk];
      }
    }
    if (_dbTotal > 0) {
      game.movementBank[msgId].total += _dbTotal;
      game.movementBank[msgId].remaining += _dbTotal;
    }
    if (Object.keys(game.deployBonusMp).length === 0) delete game.deployBonusMp;
  }
  // Track activation start positions for abilities like Light It Up
  game.activationStartPositions = game.activationStartPositions || {};
  {
    const _aspDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _aspPrefix = `${meta.dcName}-${_aspDgIndex}-`;
    const _aspFigPos = game.figurePositions?.[meta.playerNum] || {};
    for (const [fk, pos] of Object.entries(_aspFigPos)) {
      if (fk.startsWith(_aspPrefix)) game.activationStartPositions[fk] = pos;
    }
  }
  game.dcActionsData = game.dcActionsData || {};
  game.dcActionsData[msgId] = { remaining: DC_ACTIONS_PER_ACTIVATION, total: DC_ACTIONS_PER_ACTIVATION, messageId: null, threadId: thread.id, specialsUsed: [] };
  const pingContent = `<@${ownerId}> — Your activation thread. ${getActionsCounterContent(DC_ACTIONS_PER_ACTIVATION, DC_ACTIONS_PER_ACTIVATION)}`;
  const actMinimap = await getActivationMinimapAttachment(game, msgId);
  const actionsPayload = {
    content: pingContent,
    components: getDcActionButtons(msgId, meta.dcName, displayName, game.dcActionsData[msgId], game),
    allowedMentions: { users: [ownerId] },
  };
  if (actMinimap) actionsPayload.files = [actMinimap];
  const actionsMsg = await withDiscordRetry(() => thread.send(actionsPayload));
  game.dcActionsData[msgId].messageId = actionsMsg.id;
  // Hair Trigger (Jyn Odan): at start of hostile activation, interrupt to attack that figure. Once/round.
  {
    const _htOpponentPN = opponentPlayerNum(meta.playerNum);
    const _htDcEffects = getDcEffects();
    for (const [_htFk, _htPos] of Object.entries(game.figurePositions?.[_htOpponentPN] || {})) {
      if (!_htPos) continue;
      const _htDcName = dcNameFromFigureKey(_htFk);
      const _htEff = _htDcEffects?.[_htDcName];
      if (!((_htEff?.specialAbilityIds || []).includes('hair_trigger'))) continue;
      const _htKey = `hairTrigger_${_htFk}`;
      if (game.roundFigureAbilityUsed?.[_htKey]) continue;
      // Find the msgId for the Hair Trigger figure
      const _htMsgId = ctx.findDcMessageIdForFigure(game.gameId, _htOpponentPN, _htFk);
      if (!_htMsgId) continue;
      const _htOwnerId = getPlayerId(game, _htOpponentPN);
      const _htRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hair_trigger_use_${game.gameId}_${_htMsgId}_${_htFk}`).setLabel(`Use Hair Trigger (${_htDcName})`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`hair_trigger_skip_${game.gameId}_${_htFk}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({
        content: `<@${_htOwnerId}> **Hair Trigger** — **${_htDcName}** may interrupt to perform an attack targeting **${displayName}**. (Once per round)`,
        allowedMentions: { users: [_htOwnerId] },
        components: [_htRow],
      }).catch(discordCatch);
      break; // Only one Hair Trigger prompt per activation
    }
  }
  // Swipe (Salacious B. Crumb): when activating in a space containing a hostile, deal 1 Damage
  if (meta.dcName === 'Salacious B. Crumb') {
    const _swDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _swFk = `Salacious B. Crumb-${_swDgIndex}-0`;
    const _swPos = game.figurePositions?.[meta.playerNum]?.[_swFk];
    if (_swPos) {
      const _swEnemyPN = opponentPlayerNum(meta.playerNum);
      const _swEnemyFigs = game.figurePositions?.[_swEnemyPN] || {};
      for (const [_swEfk, _swEpos] of Object.entries(_swEnemyFigs)) {
        if (!_swEpos || String(_swEpos).toLowerCase() !== String(_swPos).toLowerCase()) continue;
        const _swKey = `swipe_${_swFk}_${_swEfk}`;
        if (game.roundFigureAbilityUsed?.[_swKey]) continue;
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        game.roundFigureAbilityUsed[_swKey] = true;
        // Apply 1 Damage to the hostile figure
        const _swTgtMsgId = ctx.findDcMessageIdForFigure(game.gameId, _swEnemyPN, _swEfk);
        if (_swTgtMsgId) {
          const _swFkMatch = _swEfk.match(/-(\d+)-(\d+)$/);
          const _swFigIdx = _swFkMatch ? parseInt(_swFkMatch[2], 10) : 0;
          const hs = dcHealthState.get(_swTgtMsgId);
          if (hs?.[_swFigIdx] && Array.isArray(hs[_swFigIdx])) {
            const [cur, max] = hs[_swFigIdx];
            hs[_swFigIdx] = [Math.max(0, (cur ?? max) - 1), max];
          }
        }
        const _swTgtName = dcNameFromFigureKey(_swEfk);
        await thread.send(`**Swipe** — **Salacious B. Crumb** activates in **${_swTgtName}**'s space: **${_swTgtName}** suffers 1 Damage.`).catch(discordCatch);
        await logGameAction(game, client, `**Swipe** — **Salacious B. Crumb** deals 1 Damage to **${_swTgtName}** on activation.`, { phase: 'ACTIVATION', icon: 'attack' });
      }
    }
  }
  // It Will Be Alright (Cassian Andor): once during activation, sacrifice a friendly figure within 2 spaces for a free action
  if (meta.dcName === 'Cassian Andor') {
    const _iwbaDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _iwbaSelfFk = `Cassian Andor-${_iwbaDgIndex}-0`;
    const _iwbaSelfPos = game.figurePositions?.[meta.playerNum]?.[_iwbaSelfFk];
    const _iwbaGetRange = ctx.getRange || getRange;
    if (_iwbaSelfPos) {
      // Find friendly figures within 2 spaces that are alive (not self)
      const _iwbaHs = ctx.dcHealthState;
      const _iwbaTargets = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[meta.playerNum] || {})) {
        if (!pos || fk === _iwbaSelfFk) continue;
        if (_iwbaGetRange(_iwbaSelfPos, pos) > 2) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        // Check alive: find msgId and check HP > 0
        let fkMsgId = ctx.findDcMessageIdForFigure(game.gameId, meta.playerNum, fk);
        if (!fkMsgId) continue;
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const fkFigIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const fkEntry = _iwbaHs?.get(fkMsgId)?.[fkFigIdx];
        if (!fkEntry || !Array.isArray(fkEntry)) continue;
        const [fkCur, fkMax] = fkEntry;
        if ((fkMax ?? 0) === 0 || ((fkCur ?? fkMax ?? 0) <= 0)) continue;
        _iwbaTargets.push({ figureKey: fk, dcName: fkDcName, msgId: fkMsgId, figIdx: fkFigIdx });
      }
      if (_iwbaTargets.length > 0) {
        const _iwbaRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`iwba_use_${game.gameId}_${msgId}`).setLabel('It Will Be Alright (sacrifice a friendly)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`iwba_skip_${game.gameId}_${msgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({
          content: `**It Will Be Alright** — **${displayName}** may sacrifice a friendly figure within 2 spaces to perform a free move or attack.`,
          components: [_iwbaRow],
        }).catch(discordCatch);
      }
    }
  }
  // Mounted (Captain Terro, Kuiil): gain 3 MP at start of activation
  const _mountedEff = getDcEffects()?.[meta.dcName];
  const _mountedIds = _mountedEff?.specialAbilityIds || [];
  if (_mountedIds.includes('mounted_terro') || _mountedIds.includes('mounted_kuiil') || _mountedIds.includes('mounted_dewback') || (_mountedEff?.passives || []).includes('Mounted')) {
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
    game.movementBank[msgId].total += 3;
    game.movementBank[msgId].remaining += 3;
    await thread.send({ content: `🐎 **Mounted** — **${displayName}** gains **3 movement points** at the start of activation.` }).catch(discordCatch);
  }
  // Vigor (Ahsoka Tano, Fifth Brother): choose 2 MP or 1 Block Token
  if (meta.dcName === 'Ahsoka Tano' || meta.dcName === 'Fifth Brother') {
    const vigorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_vigor_mp`).setLabel('Gain 2 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_vigor_block`).setLabel('Gain 1 Block Token').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `✨ **Vigor** — **${displayName}**: Choose one:`, components: [vigorRow] }).catch(discordCatch);
  }
  // Madness (Taron Malicos): if ≤2 CC cards in hand, suffer 1 Strain and become Focused
  if (meta.dcName === 'Taron Malicos') {
    const hand = getCcHand(game, meta.playerNum) || [];
    if (hand.length <= 2) {
      const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(fk => fk.startsWith('Taron Malicos-'));
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      for (const fk of figureKeys) {
        applyCondition(game, fk, 'Focus');
        // Apply 1 Strain (= 1 HP damage)
        const fkMsgId = msgId;
        const fkIdx = parseInt(fk.split('-').pop(), 10) || 0;
        const hs = dcHealthState.get(fkMsgId);
        if (hs?.[fkIdx] && Array.isArray(hs[fkIdx])) {
          const [cur, max] = hs[fkIdx];
          hs[fkIdx] = [Math.max(0, (cur ?? max) - 1), max];
        }
      }
      await thread.send({ content: `😤 **Madness** — **${displayName}** has ${hand.length} CC card${hand.length !== 1 ? 's' : ''} in hand (≤2). Suffered **1 Strain** and became **Focused**.` }).catch(discordCatch);
      await logGameAction(game, client, `**Madness** — **${displayName}** suffered 1 Strain and became Focused (${hand.length} CC in hand).`, { phase: 'ACTIVATION', icon: 'condition' });
    }
  }
  // Responsive (Shyla Varad): choose 1 MP or recover 1 Damage
  if (meta.dcName === 'Shyla Varad') {
    const respRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_responsive_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_responsive_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Secondary),
    );
    await thread.send({ content: `🏃 **Responsive** — **${displayName}**: Choose one:`, components: [respRow] }).catch(discordCatch);
  }
  // Fulcrum (Agent Kallus): at start of activation, each player draws 1 CC
  if (meta.dcName === 'Agent Kallus') {
    const _fParts = [];
    for (const pn of [1, 2]) {
      const deckKey = ccDeckKey(pn);
      const handKey = ccHandKey(pn);
      const deck = game[deckKey] || [];
      if (deck.length > 0) {
        const card = deck.shift();
        game[handKey] = [...(game[handKey] || []), card];
        _fParts.push(`P${pn} drew 1 CC`);
      } else {
        _fParts.push(`P${pn} deck empty`);
      }
    }
    await thread.send({ content: `🕵️ **Fulcrum** — Each player draws 1 Command card. (${_fParts.join(', ')})` }).catch(discordCatch);
  }
  // Hunger (Wampa Regular/Elite): position-aware hostile proximity check
  {
    const _getRange = ctx.getRange;
    const _hungerCheck = (dcName, range, mpGain, elite) => {
      if (meta.dcName !== dcName) return false;
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figureKey = `${dcName}-${dgIndex}-0`;
      const pos = game.figurePositions?.[meta.playerNum]?.[figureKey];
      if (!pos || !_getRange) return false;
      const enemyNum = opponentPlayerNum(meta.playerNum);
      const hostilePos = Object.values(game.figurePositions?.[enemyNum] || {});
      const anyHostileInRange = hostilePos.some(hp => hp && _getRange(pos, hp) <= range);
      return !anyHostileInRange;
    };
    if (meta.dcName === 'Wampa' && _hungerCheck('Wampa', 3, 2, false)) {
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 2;
      game.movementBank[msgId].remaining += 2;
      await thread.send({ content: `🐻 **Hunger** — **${displayName}** gains **2 MP** (no hostile within 3 spaces).` }).catch(discordCatch);
    } else if (meta.dcName === 'Wampa' && !_hungerCheck('Wampa', 3, 2, false)) {
      await thread.send({ content: `🐻 **Hunger** — Hostile figure within 3 spaces; **${displayName}** does not gain MP.` }).catch(discordCatch);
    }
    if (meta.dcName === 'Wampa (Elite)') {
      if (_hungerCheck('Wampa (Elite)', 2, 3, true)) {
        game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
        game.movementBank[msgId].total += 3;
        game.movementBank[msgId].remaining += 3;
        // Also gain 1 Block or Evade Token — choice buttons
        const hungerRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_hunger_block`).setLabel('Block Token').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_hunger_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `🐻 **Hunger** — **${displayName}** gains **3 MP** (no hostile within 2 spaces). Choose a token:`, components: [hungerRow] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🐻 **Hunger** — Hostile figure within 2 spaces; **${displayName}** does not gain MP or tokens.` }).catch(discordCatch);
      }
    }
  }
  // Tactical Movement (Fenn Signis): choose a friendly figure within 3 → gains 2 MP
  if (meta.dcName === 'Fenn Signis') {
    const _getRange = ctx.getRange;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `${meta.dcName}-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    if (selfPos && _getRange) {
      const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => fk !== selfFk && fp && _getRange(selfPos, fp) <= 3);
      if (friendlyFigs.length > 0) {
        const btns = friendlyFigs.slice(0, 4).map(([fk]) => {
          const label = dcNameFromFigureKey(fk);
          return new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tacmove_${fk}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tacmove_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const tmRow = new ActionRowBuilder().addComponents(btns);
        await thread.send({ content: `🎯 **Tactical Movement** — Choose a friendly figure within 3 spaces to gain **2 MP**:`, components: [tmRow] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🎯 **Tactical Movement** — No friendly figures within 3 spaces.` }).catch(discordCatch);
      }
    }
  }
  // Into the Fray (Baze Malbus): gain 1 Surge Token per hostile with LOS, then gain 1 MP
  if (meta.dcName === 'Baze Malbus') {
    game.movementBank = game.movementBank || {};
    game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
    game.movementBank[msgId].total += 1;
    game.movementBank[msgId].remaining += 1;
    // Count hostiles with LOS
    const _hasLos = ctx.hasLineOfSight;
    const _mapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `Baze Malbus-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    let surgeCount = 0;
    if (selfPos && _hasLos && _mapSpaces) {
      const enemyNum = opponentPlayerNum(meta.playerNum);
      const allFigCoords = [];
      for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) allFigCoords.push(String(fp).toLowerCase());
      for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) allFigCoords.push(String(fp).toLowerCase());
      for (const [, ePos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
        if (!ePos) continue;
        if (_hasLos(String(selfPos).toLowerCase(), String(ePos).toLowerCase(), _mapSpaces, allFigCoords)) surgeCount++;
      }
    }
    if (surgeCount > 0) {
      grantPowerTokens(game, selfFk, 'Surge', surgeCount);
    }
    await thread.send({ content: `🔥 **Into the Fray** — **${displayName}** gains **1 MP** and **${surgeCount} Surge Token${surgeCount !== 1 ? 's' : ''}** (${surgeCount} hostile${surgeCount !== 1 ? 's' : ''} with LOS).` }).catch(discordCatch);
    if (game.pendingPowerTokenOverflow?.length > 0) {
      await sendPowerTokenOverflowUI(game, gameId, thread, meta.playerNum, saveGames);
    }
  }
  // Advanced Weapons Research (Director Krennic): friendly within range gains 1 Hit or Surge Token
  // Range is 2 (or 3 with Advanced Com Systems attachment)
  if (meta.dcName === 'Director Krennic') {
    const _getRange = ctx.getRange;
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const selfFk = `Director Krennic-${dgIndex}-0`;
    const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
    if (selfPos && _getRange) {
      const _awrAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _awrRange = _awrAtts.some(a => a.includes('Advanced Com Systems')) ? 3 : 2;
      const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => fk !== selfFk && fp && _getRange(selfPos, fp) <= _awrRange);
      if (friendlyFigs.length > 0) {
        const btns = friendlyFigs.slice(0, 3).map(([fk]) => {
          const label = dcNameFromFigureKey(fk);
          return new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_awr_${fk}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_awr_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const awrRow = new ActionRowBuilder().addComponents(btns);
        game.pendingAwr = { gameId: game.gameId, msgId, playerNum: meta.playerNum };
        await thread.send({ content: `🔬 **Advanced Weapons Research** — Choose a friendly figure within ${_awrRange} spaces to grant a **Hit Token** or **Surge Token**:`, components: [awrRow] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🔬 **Advanced Weapons Research** — No friendly figures within ${_awrRange} spaces.` }).catch(discordCatch);
      }
    }
  }
  // Durasteel Fist (Dark Trooper Mk III): once during activation, choose adjacent figure, roll 1 green die
  if (_mountedIds.includes('durasteel_fist_dark_trooper') && !game.roundFigureAbilityUsed?.[`${meta.dcName}_durasteel_fist_${msgId}`]) {
    const _dfDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _dfActData = game.dcActionsData?.[msgId];
    const _dfSelFig = _dfActData?.selectedFigure ?? 0;
    const _dfSelfFk = `${meta.dcName}-${_dfDgIndex}-${_dfSelFig}`;
    const _dfSelfPos = game.figurePositions?.[meta.playerNum]?.[_dfSelfFk];
    if (_dfSelfPos) {
      const _dfMapId = game.selectedMap?.id;
      const _dfMs = getMapSpaces(_dfMapId);
      const _dfAdj = (_dfMs?.adjacency?.[String(_dfSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
      const _dfTargets = [];
      for (const pn of [1, 2]) {
        for (const [fk, fp] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!fp || fk === _dfSelfFk) continue;
          if (_dfAdj.includes(String(fp).toLowerCase())) {
            _dfTargets.push({ fk, playerNum: pn });
          }
        }
      }
      if (_dfTargets.length > 0) {
        const _dfBtns = _dfTargets.slice(0, 4).map(({ fk }) =>
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_durasteelfist_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Danger)
        );
        _dfBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_durasteelfist_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🤜 **Durasteel Fist** — Choose an adjacent figure to target (roll 1 green die, apply Hits as damage):`, components: [new ActionRowBuilder().addComponents(_dfBtns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `🤜 **Durasteel Fist** — No adjacent figures to target.` }).catch(discordCatch);
      }
    }
  }
  // Comms Jammer (ISB Infiltrator Elite): opponent can't play CCs during your activation
  if (_mountedIds.includes('comms_jammer_isb')) {
    const oppNum = opponentPlayerNum(meta.playerNum);
    game.commsJammerActivePlayerNum = meta.playerNum;
    await thread.send({ content: `📡 **Comms Jammer** — Opponent (P${oppNum}) cannot play Command Cards during this activation.` }).catch(discordCatch);
  }
  // Power Converter (Saska Teft): combat-time trigger — handled in combat.js, NOT here
  // Unstable Devices (Saska Teft): free once-per-activation — a friendly in LOS gains 1 Device token
  if (_mountedIds.includes('unstable_devices_saska') && !game.unstableDevicesUsedThisActivation?.[msgId]) {
    const _udHasLos = ctx.hasLineOfSight;
    const _udMapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
    const _udDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _udSelfFk = `${meta.dcName}-${_udDgIndex}-0`;
    const _udSelfPos = game.figurePositions?.[meta.playerNum]?.[_udSelfFk];
    // Collect all figure coords for LOS blocking check
    const _udAllFigCoords = [];
    for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) _udAllFigCoords.push(String(fp).toLowerCase());
    for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) _udAllFigCoords.push(String(fp).toLowerCase());
    // Find friendlies in LOS
    const _udFriendlies = [];
    if (_udSelfPos && _udHasLos && _udMapSpaces) {
      for (const [fk, fp] of Object.entries(game.figurePositions?.[meta.playerNum] || {})) {
        if (!fp) continue;
        if (_udHasLos(String(_udSelfPos).toLowerCase(), String(fp).toLowerCase(), _udMapSpaces, _udAllFigCoords)) {
          _udFriendlies.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk) });
        }
      }
    }
    if (_udFriendlies.length === 1) {
      // Only one friendly in LOS — show confirm button
      const f = _udFriendlies[0];
      const confirmBtn = new ButtonBuilder()
        .setCustomId(`act_passive_${game.gameId}_${msgId}_unstabledev_${f.figureKey}`)
        .setLabel(`Grant to ${f.dcName}`)
        .setStyle(ButtonStyle.Primary);
      const skipBtn = new ButtonBuilder()
        .setCustomId(`act_passive_${game.gameId}_${msgId}_unstabledev_skip`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Secondary);
      await thread.send({ content: `🔧 **Unstable Devices** — Grant **1 Device token** to **${f.dcName}**? (free, once per activation)`, components: [new ActionRowBuilder().addComponents(confirmBtn, skipBtn)] }).catch(discordCatch);
    } else if (_udFriendlies.length > 1) {
      // Multiple friendlies — picker
      const btns = _udFriendlies.slice(0, 4).map(f =>
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_unstabledev_${f.figureKey}`).setLabel(f.dcName).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_unstabledev_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🔧 **Unstable Devices** — Choose a friendly figure in LOS to gain **1 Device token** (free, once per activation):`, components: [new ActionRowBuilder().addComponents(...btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🔧 **Unstable Devices** — No friendly figures in line of sight.` }).catch(discordCatch);
    }
  }
  // Negotiate (Hondo): when declaring attack, +2 damage unless target pays 2 VP
  if (_mountedIds.includes('negotiate_hondo')) {
    await thread.send({ content: `💰 **Negotiate** available — When you attack, the target suffers +2 Damage unless they pay 2 VP.` }).catch(discordCatch);
  }
  // Airborne Commander (Gar Saxon): Mobile figures within 4 can use your surge abilities
  if (_mountedIds.includes('airborne_commander_gar_saxon')) {
    await thread.send({ content: `🪂 **Airborne Commander** — Mobile figures within 4 spaces may use Gar Saxon's surge abilities.` }).catch(discordCatch);
  }
  // Droid Kit (Iden Versio): if friendly Dio is in Iden's space, gain 1 Power Token (once per activation)
  if (meta.dcName === 'Iden Versio') {
    const _dkDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _dkSelfFk = `${meta.dcName}-${_dkDgIndex}-0`;
    const _dkSelfPos = game.figurePositions?.[meta.playerNum]?.[_dkSelfFk];
    // Find Dio in figurePositions for the same player
    const _dkDioFk = Object.keys(game.figurePositions?.[meta.playerNum] || {}).find(fk => fk.startsWith('Dio-'));
    const _dkDioPos = _dkDioFk ? game.figurePositions[meta.playerNum][_dkDioFk] : null;
    if (_dkSelfPos && _dkDioPos && String(_dkSelfPos).toLowerCase() === String(_dkDioPos).toLowerCase()) {
      const dkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_droidkit_hit`).setLabel('Hit Token').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_droidkit_surge`).setLabel('Surge Token').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_droidkit_block`).setLabel('Block Token').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_droidkit_evade`).setLabel('Evade Token').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_droidkit_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `🤖 **Droid Kit** — **Dio** is in **${displayName}**'s space. Gain 1 Power Token:`, components: [dkRow] }).catch(discordCatch);
    } else {
      const reason = !_dkDioFk ? 'Dio is not in play' : 'Dio is not in the same space';
      await thread.send({ content: `🤖 **Droid Kit** — ${reason}; no Power Token gained.` }).catch(discordCatch);
    }
  }
  // Advanced Firepower (General Sorin): adjacent DROID/VEHICLE may use your surge abilities (within 2 with ACS)
  if (_mountedIds.includes('advanced_firepower_sorin')) {
    const _afAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _afHasACS = _afAtts.some(a => a.includes('Advanced Com Systems'));
    const _afRange = _afHasACS ? 'within 2 spaces (ACS)' : 'adjacent';
    await thread.send({ content: `🔧 **Advanced Firepower** — ${_afRange} DROID or VEHICLE figures may use Sorin's surge abilities.` }).catch(discordCatch);
  }
  // Unhinged Director (Director Krennic): TROOPER/GUARDIAN within 2 (3 with ACS) get +2 bonus from tokens
  if (_mountedIds.includes('unhinged_director_krennic')) {
    const _udAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _udHasACS = _udAtts.some(a => a.includes('Advanced Com Systems'));
    const _udRange = _udHasACS ? '3 (ACS)' : '2';
    await thread.send({ content: `📋 **Unhinged Director** — TROOPER or GUARDIAN within ${_udRange} spaces gain +2 (instead of +1) when spending power tokens.` }).catch(discordCatch);
  }
  // Squad Cohesion (Ko-Tun): REBEL within 3 can spend another REBEL's token
  if (_mountedIds.includes('squad_cohesion_kotun')) {
    await thread.send({ content: `🤝 **Squad Cohesion** — REBEL figures within 3 spaces may spend each other's power tokens.` }).catch(discordCatch);
  }
  // Consider It My Payment (Asajj): opponent reveals a CC from hand
  if (_mountedIds.includes('consider_it_my_payment_asajj')) {
    const oppNum = opponentPlayerNum(meta.playerNum);
    const oppOwnerId = game[`player${oppNum}Id`];
    await thread.send({ content: `💳 **Consider It My Payment** — <@${oppOwnerId}>, reveal a Command Card from your hand.`, allowedMentions: { users: [oppOwnerId] } }).catch(discordCatch);
  }
  // General's Orders (General Weiss): choose up to 2 friendlies; each gains 2 MP
  if (_mountedIds.includes('generals_orders_weiss')) {
    const _goGetRange = ctx.getRange || getRange;
    const _goDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _goSelfFk = `${meta.dcName}-${_goDgIndex}-0`;
    const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
      .filter(([fk, fp]) => fk !== _goSelfFk && fp);
    if (friendlyFigs.length > 0) {
      game.pendingGeneralsOrders = { gameId: game.gameId, msgId, playerNum: meta.playerNum, remaining: 2, chosen: [] };
      const btns = friendlyFigs.slice(0, 4).map(([fk]) =>
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_genorders_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_genorders_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🎖️ **General's Orders** — Choose up to 2 friendly figures; each gains **2 MP** (pick 1 of 2):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🎖️ **General's Orders** — No friendly figures available.` }).catch(discordCatch);
    }
  }
  // Long-Laid Plans (Thrawn): distribute N power tokens (N = round#) among friendlies within 3
  if (_mountedIds.includes('long_laid_plans_thrawn')) {
    const roundNum = game.currentRound || 1;
    const _llpGetRange = ctx.getRange || getRange;
    const _llpDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _llpSelfFk = `${meta.dcName}-${_llpDgIndex}-0`;
    const _llpSelfPos = game.figurePositions?.[meta.playerNum]?.[_llpSelfFk];
    const _llpFriendlies = _llpSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
      .filter(([fk, fp]) => fp && _llpGetRange(_llpSelfPos, fp) <= 3) : [];
    if (_llpFriendlies.length > 0 && roundNum > 0) {
      game.pendingTokenDistribution = { gameId: game.gameId, msgId, playerNum: meta.playerNum, remaining: roundNum, ability: 'longlaid', tokenTypes: ['Hit', 'Block', 'Surge', 'Evade'] };
      const btns = _llpFriendlies.slice(0, 4).map(([fk]) =>
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tokendist_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🧠 **Long-Laid Plans** — Distribute **${roundNum} power token${roundNum > 1 ? 's' : ''}** among friendly figures within 3 spaces. Pick a figure (${roundNum} remaining):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🧠 **Long-Laid Plans** — No friendly figures within 3 spaces (or round 0).` }).catch(discordCatch);
    }
  }
  // Strategize (Thrawn): look at top CC of each deck, may discard one
  if (_mountedIds.includes('strategize_thrawn')) {
    const _strOppNum = opponentPlayerNum(meta.playerNum);
    const _strOwnDeck = game[ccDeckKey(meta.playerNum)] || [];
    const _strOppDeck = game[ccDeckKey(_strOppNum)] || [];
    const _strOwnTop = _strOwnDeck[0] || '(empty)';
    const _strOppTop = _strOppDeck[0] || '(empty)';
    const _strBtns = [];
    if (_strOwnDeck.length > 0) _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_strategize_own`).setLabel(`Discard yours: ${_strOwnTop.slice(0, 60)}`).setStyle(ButtonStyle.Danger));
    if (_strOppDeck.length > 0) _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_strategize_opp`).setLabel(`Discard opponent: ${_strOppTop.slice(0, 60)}`).setStyle(ButtonStyle.Danger));
    _strBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_strategize_skip`).setLabel('Discard neither').setStyle(ButtonStyle.Secondary));
    await thread.send({
      content: `🧠 **Strategize** — Top of each command deck:\n• **Your deck:** ${_strOwnTop}\n• **Opponent's deck:** ${_strOppTop}\n\nYou may discard one:`,
      components: [new ActionRowBuilder().addComponents(_strBtns)],
    }).catch(discordCatch);
  }
  // Wisdom (Yoda): draw 1 CC, return 1 to bottom of deck
  if (_mountedIds.includes('wisdom_yoda')) {
    const deckKey = ccDeckKey(meta.playerNum);
    const handKey = ccHandKey(meta.playerNum);
    const deck = game[deckKey] || [];
    if (deck.length > 0) {
      const card = deck.shift();
      game[handKey] = [...(game[handKey] || []), card];
      // Show buttons for each unique card in hand to return to bottom of deck
      const hand = game[handKey] || [];
      const uniqueCards = [...new Set(hand)];
      if (uniqueCards.length > 0) {
        const rows = [];
        for (let i = 0; i < uniqueCards.length; i += 5) {
          const chunk = uniqueCards.slice(i, i + 5);
          const btns = chunk.map((c, ci) =>
            new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_wisdom_${i + ci}`).setLabel(c.length > 70 ? c.slice(0, 67) + '...' : c).setStyle(ButtonStyle.Secondary)
          );
          rows.push(new ActionRowBuilder().addComponents(btns));
        }
        await thread.send({ content: `🧘 **Wisdom** — Drew 1 CC. Choose a card from your hand to return to the bottom of your deck:`, components: rows.slice(0, 5) }).catch(discordCatch);
      } else {
        await thread.send({ content: `🧘 **Wisdom** — Drew 1 CC but hand is empty (cannot return).` }).catch(discordCatch);
      }
    } else {
      await thread.send({ content: `🧘 **Wisdom** — Deck is empty; cannot draw.` }).catch(discordCatch);
    }
  }
  // Force Vision (Kanan): opponent chooses one of their ready groups and must activate it next
  if (_mountedIds.includes('force_vision_kanan')) {
    const _fvOppNum = opponentPlayerNum(meta.playerNum);
    const _fvOppOwnerId = getPlayerId(game, _fvOppNum);
    // Build list of opponent's unactivated (ready) groups that are still alive
    const _fvOppDcList = getDcList(game, _fvOppNum) || [];
    const _fvOppActivated = getActivatedDcIndices(game, _fvOppNum) || [];
    const _fvReadyGroups = [];
    for (let i = 0; i < _fvOppDcList.length; i++) {
      if (_fvOppActivated.includes(i)) continue;
      const dc = _fvOppDcList[i];
      const figs = game.figurePositions?.[_fvOppNum] || {};
      const alive = Object.entries(figs).some(([fk, pos]) => fk.startsWith(dc.dcName + '-') && pos);
      if (!alive) continue;
      _fvReadyGroups.push({ index: i, dcName: dc.dcName, displayName: dc.displayName || dc.dcName });
    }
    if (_fvReadyGroups.length > 0) {
      // Mark pending so opponent cannot activate until they pick
      game.forceVisionPending = _fvOppNum;
      const _fvRows = [];
      const _fvBtns = [];
      for (const rg of _fvReadyGroups.slice(0, 20)) {
        _fvBtns.push(
          new ButtonBuilder()
            .setCustomId(`fv_pick_${game.gameId}_${_fvOppNum}_${rg.index}`)
            .setLabel(rg.displayName.length > 80 ? rg.displayName.slice(0, 77) + '...' : rg.displayName)
            .setStyle(ButtonStyle.Primary)
        );
        if (_fvBtns.length === 5) {
          _fvRows.push(new ActionRowBuilder().addComponents(..._fvBtns.splice(0)));
        }
      }
      if (_fvBtns.length > 0) _fvRows.push(new ActionRowBuilder().addComponents(..._fvBtns));
      try {
        const _fvGeneralCh = await client.channels.fetch(game.generalId);
        await _fvGeneralCh.send({
          content: `👁️ **Force Vision** — <@${_fvOppOwnerId}>, **Kanan Jarrus** is activating! Choose one of your ready groups — you **must** activate it next, if possible:`,
          components: _fvRows.slice(0, 5),
          allowedMentions: { users: [_fvOppOwnerId] },
        });
      } catch (_fvErr) {
        console.error('Force Vision prompt error:', _fvErr);
      }
    } else {
      await thread.send({ content: `👁️ **Force Vision** — Opponent has no ready groups to choose from.` }).catch(discordCatch);
    }
  }
  // Arms Distribution (Ko-Tun): distribute 2 power tokens among friendlies within 3
  if (_mountedIds.includes('arms_distribution_kotun')) {
    const _adGetRange = ctx.getRange || getRange;
    const _adDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _adSelfFk = `${meta.dcName}-${_adDgIndex}-0`;
    const _adSelfPos = game.figurePositions?.[meta.playerNum]?.[_adSelfFk];
    const _adFriendlies = _adSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
      .filter(([fk, fp]) => fp && _adGetRange(_adSelfPos, fp) <= 3) : [];
    if (_adFriendlies.length > 0) {
      game.pendingTokenDistribution = { gameId: game.gameId, msgId, playerNum: meta.playerNum, remaining: 2, ability: 'armsdist', tokenTypes: ['Hit', 'Block'] };
      const btns = _adFriendlies.slice(0, 4).map(([fk]) =>
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tokendist_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🎯 **Arms Distribution** — Distribute **2 power tokens** (Hit or Block) among friendly figures within 3 spaces. Pick a figure (2 remaining):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🎯 **Arms Distribution** — No friendly figures within 3 spaces.` }).catch(discordCatch);
    }
  }
  // Trust Goes Both Ways (Jyn Erso): choose a friendly within 3 to gain 1 MP
  if (_mountedIds.includes('trust_goes_both_ways_jyn')) {
    const _tgbwGetRange = ctx.getRange || getRange;
    const _tgbwDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _tgbwSelfFk = `${meta.dcName}-${_tgbwDgIndex}-0`;
    const _tgbwSelfPos = game.figurePositions?.[meta.playerNum]?.[_tgbwSelfFk];
    const _tgbwFriendlies = _tgbwSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
      .filter(([fk, fp]) => fk !== _tgbwSelfFk && fp && _tgbwGetRange(_tgbwSelfPos, fp) <= 3) : [];
    if (_tgbwFriendlies.length > 0) {
      const btns = _tgbwFriendlies.slice(0, 4).map(([fk]) =>
        new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_trustboth_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
      );
      btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_trustboth_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
      await thread.send({ content: `🤝 **Trust Goes Both Ways** — Choose a friendly figure within 3 spaces to gain **1 MP**:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    } else {
      await thread.send({ content: `🤝 **Trust Goes Both Ways** — No friendly figures within 3 spaces.` }).catch(discordCatch);
    }
  }
  // Dead Precise (Ko-Tun): +2 Accuracy if didn't move this activation
  if (_mountedIds.includes('dead_precise_kotun')) {
    await thread.send({ content: `🎯 **Dead Precise** — If you do not move during this activation, apply +2 Accuracy while attacking.` }).catch(discordCatch);
  }
  // Adapt (Agent Blaise): choose a trait for the round
  if (_mountedIds.includes('adapt_blaise')) {
    await thread.send({ content: `🔄 **Adapt** — Choose a trait for this round. Agent Blaise gains that trait.` }).catch(discordCatch);
  }
  // Hunt Dissent (Agent Kallus): when you or friendly TROOPER within 3 defeats hostile, gain Block Token
  if (_mountedIds.includes('hunt_dissent_kallus')) {
    await thread.send({ content: `🎯 **Hunt Dissent** — When you or a friendly TROOPER within 3 spaces defeats a hostile figure, gain 1 Block Token.` }).catch(discordCatch);
  }
  // Air Support (Bodhi): after friendly attack, if target in your LOS, target suffers 1 additional damage
  if (_mountedIds.includes('air_support_bodhi')) {
    await thread.send({ content: `✈️ **Air Support** — After a friendly figure resolves an attack, if the target is in Bodhi's LOS, the target suffers 1 additional Damage.` }).catch(discordCatch);
  }
  // Fast Learner (Mara Jade): once per round, may play CC as different DC
  if (_mountedIds.includes('fast_learner_mara_jade') && !game.roundFigureAbilityUsed?.[`${meta.dcName}_fast_learner`]) {
    await thread.send({ content: `📚 **Fast Learner** — Once this round, Mara Jade may play a Command card whose restriction matches the name of another Deployment card in your army (except "Arcing Shot").` }).catch(discordCatch);
  }
  // Imperial Loadout (Purge Trooper): show chosen loadout
  if (_mountedIds.includes('imperial_loadout_purge_trooper')) {
    const { getConfig } = await import('../game/figure-config.js');
    const { getLoadoutCards, getRootDir } = await import('../data-loader.js');
    const { AttachmentBuilder } = await import('discord.js');
    const { join } = await import('path');
    const fks = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(fk => fk.startsWith(meta.dcName + '-'));
    const chosenLoadout = fks.length > 0 ? getConfig(game, fks[0])?.loadout : null;
    if (chosenLoadout) {
      const lCard = getLoadoutCards()[chosenLoadout];
      const files = [];
      if (lCard?.imagePath) try { files.push(new AttachmentBuilder(join(getRootDir(), lCard.imagePath))); } catch {}
      await thread.send({ content: `⚔️ **Imperial Loadout: ${chosenLoadout}** — ${lCard?.abilityText || 'Apply loadout abilities.'}`, files }).catch(discordCatch);
    } else {
      await thread.send({ content: `⚔️ **Imperial Loadout** — No loadout card selected. Apply abilities manually.` }).catch(discordCatch);
    }
  }
  // Clawdite Form: show chosen form card + apply Fleet MP bonus (Streetrat)
  if (_mountedIds.includes('shape_clawdite_elite') || _mountedIds.includes('shape_clawdite_reg')) {
    const { getConfig } = await import('../game/figure-config.js');
    const { getFormCards, getRootDir } = await import('../data-loader.js');
    const { AttachmentBuilder } = await import('discord.js');
    const { join } = await import('path');
    const fks = Object.keys(game.figurePositions?.[meta.playerNum] || {}).filter(fk => fk.startsWith(meta.dcName + '-'));
    const chosenForm = fks.length > 0 ? getConfig(game, fks[0])?.form : null;
    if (chosenForm) {
      const fCard = getFormCards()[chosenForm];
      const files = [];
      if (fCard?.imagePath) try { files.push(new AttachmentBuilder(join(getRootDir(), fCard.imagePath))); } catch {}
      await thread.send({ content: `🔄 **Form: ${chosenForm}** — ${fCard?.abilityText || 'Apply form abilities.'}`, files }).catch(discordCatch);
      // Fleet (Streetrat): gain MP at start of activation
      if (fCard?.fleetMp && fCard.fleetMp > 0) {
        game.movementBank = game.movementBank || {};
        if (!game.movementBank[msgId]) {
          game.movementBank[msgId] = { total: fCard.fleetMp, remaining: fCard.fleetMp, threadId: thread.id, messageId: null, displayName: meta.displayName || meta.dcName };
        } else {
          game.movementBank[msgId].total += fCard.fleetMp;
          game.movementBank[msgId].remaining += fCard.fleetMp;
        }
        await thread.send({ content: `🏃 **Fleet** — **${meta.dcName}** gains **${fCard.fleetMp} MP** at start of activation.` }).catch(discordCatch);
      }
      // Conspire (Senator): special action — distribute Power Tokens to friendlies within 1 space
      if (chosenForm === 'Senator') {
        const _conFk = fks[0];
        const _conPos = game.figurePositions?.[meta.playerNum]?.[_conFk];
        if (_conPos) {
          const { getMapSpaces: _gms } = await import('../data-loader.js');
          const _conMs = _gms(game.selectedMap?.id);
          const _conAdj = (_conMs?.adjacency?.[String(_conPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
          // Count printed attack dice for token distribution
          const _conEff = getDcEffects()[meta.dcName] || {};
          const _conDiceCount = (_conEff.attack?.dice || []).length;
          const _conFriendlies = Object.entries(game.figurePositions?.[meta.playerNum] || {})
            .filter(([fk2, pos2]) => fk2 !== _conFk && pos2 && _conAdj.includes(String(pos2).toLowerCase()));
          if (_conFriendlies.length > 0 && _conDiceCount > 0) {
            const btns = _conFriendlies.slice(0, 4).map(([fk2]) =>
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_conspire_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_conspire_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            game.pendingConspire = { tokensRemaining: _conDiceCount, senderFk: _conFk };
            await thread.send({ content: `🗣️ **Conspire** (Special Action) — Distribute **${_conDiceCount} Focus token(s)** to friendly figures within 1 space. Choose a figure:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
          } else {
            await thread.send({ content: `🗣️ **Conspire** — No friendly figures within 1 space (or no dice in attack pool). Use manually if needed.` }).catch(discordCatch);
          }
        }
      }
      // Shields Up (Soldier): special action — place energy shield in adjacent space
      if (chosenForm === 'Soldier') {
        const _suFk = fks[0];
        const _suPos = game.figurePositions?.[meta.playerNum]?.[_suFk];
        if (_suPos) {
          const { getMapSpaces: _gms2 } = await import('../data-loader.js');
          const _suMs = _gms2(game.selectedMap?.id);
          const _suAdj = (_suMs?.adjacency?.[String(_suPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
          // Filter out occupied spaces
          const _suOccupied = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean).map(s => String(s).toLowerCase()));
          const _suAvail = _suAdj.filter(s => !_suOccupied.has(s));
          if (_suAvail.length > 0) {
            const btns = _suAvail.slice(0, 4).map(s =>
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_shieldsup_${s}`).setLabel(s.toUpperCase()).setStyle(ButtonStyle.Primary)
            );
            btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_shieldsup_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
            await thread.send({ content: `🛡️ **Shields Up** (Special Action) — Place an energy shield in an adjacent space:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
          } else {
            await thread.send({ content: `🛡️ **Shields Up** — No adjacent empty spaces. Use manually if needed.` }).catch(discordCatch);
          }
        }
      }
    } else {
      await thread.send({ content: `🔄 **Shape** — No form card selected. Apply abilities manually.` }).catch(discordCatch);
    }
  }
  // Scrap Battalion (Ugnaught): Junk Droid readies and co-activates as part of group
  if (_mountedIds.includes('scrap_battalion_ugnaught_elite') || _mountedIds.includes('scrap_battalion_ugnaught_reg')) {
    const isElite = _mountedIds.includes('scrap_battalion_ugnaught_elite');
    game.companionActivatedBefore = game.companionActivatedBefore || {};
    game.companionActivatedBefore[msgId] = 'co-activate'; // Junk Droid co-activates, no before/after choice
    // Grant Junk Droid its Speed (4 MP) and a free attack for co-activation
    const _sbCompMsgIds = meta.playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    const _sbDcMsgIds = meta.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    let _sbJunkDroidMsgId = null;
    if (_sbCompMsgIds) {
      for (let i = 0; i < _sbCompMsgIds.length; i++) {
        if (_sbCompMsgIds[i] && _sbDcMsgIds?.[i] === msgId) {
          _sbJunkDroidMsgId = _sbCompMsgIds[i];
          break;
        }
      }
    }
    if (_sbJunkDroidMsgId) {
      game.movementBank = game.movementBank || {};
      game.movementBank[_sbJunkDroidMsgId] = { remaining: 4, total: 4, threadId: thread.id, messageId: null, displayName: 'Junk Droid' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[_sbJunkDroidMsgId] = { from: 'Scrap Battalion' };
    }
    await thread.send({ content: `🤖 **Scrap Battalion — Junk Droid Co-Activates**\nThe Junk Droid readies and activates **as part of this group**.${_sbJunkDroidMsgId ? ' **4 MP** and **1 free attack** granted — use its Move/Attack buttons.' : ' Move and attack with it during this activation.'}\n\`\`\`\nJunk Droid: Speed 4 | Health 1 | Melee (1 green) | +1 Hit\nSurge abilities (${meta.dcName}'s): Bleed, Pierce ${isElite ? '2' : '1'}\n\`\`\`${isElite ? '\n⚡ **Overclock** (Special Action): The Junk Droid may **interrupt** to perform a move or attack.' : ''}` }).catch(discordCatch);
  }
  // --- Skirmish Upgrade attachment activation effects ---
  const _suActivationUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (_suActivationUpgrades.length) {
    // Focused on the Kill (IG-88): +2 MP at start of activation
    if (_suActivationUpgrades.includes('Focused on the Kill')) {
      game.movementBank = game.movementBank || {};
      if (!game.movementBank[msgId]) {
        game.movementBank[msgId] = { total: 2, remaining: 2, threadId: thread.id, messageId: null, displayName: meta.displayName || meta.dcName };
      } else {
        game.movementBank[msgId].total += 2;
        game.movementBank[msgId].remaining += 2;
      }
      await thread.send({ content: `**Focused on the Kill** — **${meta.dcName}** gains **2 MP** at start of activation.` }).catch(discordCatch);
    }
    // Survivalist: end-of-round recovery handled in round.js; movement cost ignore handled in movement.js
    // Wookiee Avenger (Chewbacca): free Slam once during activation (choose adjacent hostile, roll 1 red, push if SMALL)
    if (_suActivationUpgrades.includes('Wookiee Avenger') && !game.wookieeAvengerSlamUsed?.[msgId]) {
      const _waMapId = game.selectedMap?.id;
      const _waMs = _waMapId ? getMapSpaces(_waMapId) : null;
      const _waDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _waSelfFk = `${meta.dcName}-${_waDgIndex}-0`;
      const _waSelfPos = game.figurePositions?.[meta.playerNum]?.[_waSelfFk];
      if (_waSelfPos && _waMs) {
        const _waAdj = (_waMs.adjacency?.[String(_waSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
        const _waEnemyNum = opponentPlayerNum(meta.playerNum);
        const _waHostiles = Object.entries(game.figurePositions?.[_waEnemyNum] || {})
          .filter(([, fp]) => fp && _waAdj.includes(String(fp).toLowerCase()));
        if (_waHostiles.length > 0) {
          const btns = _waHostiles.slice(0, 4).map(([fk]) =>
            new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_wookslam_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
          );
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_wookslam_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({ content: `**Wookiee Avenger** — **${meta.dcName}** may use **Slam** without spending an action. Choose an adjacent hostile figure:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
        } else {
          await thread.send({ content: `**Wookiee Avenger** — No adjacent hostile figures for free Slam.` }).catch(discordCatch);
        }
      }
    }
    // Motivation (UNIQUE): exhaust during activation — friendly with lower cost + LOS discards harmful or recovers 1, gains 1 MP
    if (_suActivationUpgrades.includes('Motivation') && !(game.exhaustedSkirmishUpgrades?.[msgId] || []).includes('Motivation')) {
      const _motGetRange = ctx.getRange || getRange;
      const _motHasLos = ctx.hasLineOfSight;
      const _motMapSpaces = ctx.getMapSpaces?.(game.selectedMap?.id);
      const _motDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _motSelfFk = `${meta.dcName}-${_motDgIndex}-0`;
      const _motSelfPos = game.figurePositions?.[meta.playerNum]?.[_motSelfFk];
      const _motSelfCost = ctx.getDcStats?.(meta.dcName)?.cost ?? 99;
      const _motAllFigCoords = [];
      for (const [, fp] of Object.entries(game.figurePositions?.[1] || {})) if (fp) _motAllFigCoords.push(String(fp).toLowerCase());
      for (const [, fp] of Object.entries(game.figurePositions?.[2] || {})) if (fp) _motAllFigCoords.push(String(fp).toLowerCase());
      const _motFriendlies = _motSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => {
          if (fk === _motSelfFk || !fp) return false;
          const dcN = dcNameFromFigureKey(fk);
          const cost = ctx.getDcStats?.(dcN)?.cost ?? 99;
          if (cost >= _motSelfCost) return false;
          if (_motHasLos && _motMapSpaces) {
            return _motHasLos(String(_motSelfPos).toLowerCase(), String(fp).toLowerCase(), _motMapSpaces, _motAllFigCoords);
          }
          return true; // If LOS unavailable, allow all
        }) : [];
      if (_motFriendlies.length > 0) {
        const btns = _motFriendlies.slice(0, 4).map(([fk]) =>
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_motivation_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_motivation_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Motivation** — Choose a friendly figure with lower cost in your LOS (recover 1 Damage or discard HARMFUL, then gain 1 MP):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `**Motivation** — No eligible friendly figures (lower cost with LOS).` }).catch(discordCatch);
      }
    }
    // Trusted Ally (DROID): exhaust during activation — adjacent friendly recovers 1 or discards 1 harmful
    if (_suActivationUpgrades.includes('Trusted Ally') && !(game.exhaustedSkirmishUpgrades?.[msgId] || []).includes('Trusted Ally')) {
      const _taMapId = game.selectedMap?.id;
      const _taMs = getMapSpaces(_taMapId);
      const _taDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _taSelfFk = `${meta.dcName}-${_taDgIndex}-0`;
      const _taSelfPos = game.figurePositions?.[meta.playerNum]?.[_taSelfFk];
      const _taAdj = _taSelfPos ? (_taMs?.adjacency?.[String(_taSelfPos).toLowerCase()] || []).map(a => String(a).toLowerCase()) : [];
      const _taFriendlies = Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk, fp]) => fk !== _taSelfFk && fp && _taAdj.includes(String(fp).toLowerCase()));
      if (_taFriendlies.length > 0) {
        const btns = _taFriendlies.slice(0, 4).map(([fk]) =>
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_trustedally_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_trustedally_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**Trusted Ally** — Choose an adjacent friendly figure (recover 1 Damage or discard 1 HARMFUL condition):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await thread.send({ content: `**Trusted Ally** — No adjacent friendly figures.` }).catch(discordCatch);
      }
    }
    // Driven by Hatred (Darth Vader): end-of-round move 2 + Force Choke or attack (-1 die) — automated in round.js EOR + interrupts.js handler
    // Rogue Smuggler (Han Solo): exhaust to interrupt and attack — not yet automated (needs interrupt trigger + attack flow)
    // Vader's Finest, Smuggler's Run, Z-6 Autofire, Mortar Trooper Fire Mission: injected as special action buttons (automated)
    // Headhunter: auto-triggered via applyStrainToFigure hook (automated)
    // Beast Tamer (M69-M70): exhaust at start of CREATURE activation → grant Speed MP; if NON-SENTIENT → allow interact
    if (_suActivationUpgrades.includes('Beast Tamer') && !(game.exhaustedSkirmishUpgrades?.[msgId] || []).includes('Beast Tamer')) {
      const _btEff = getDcEffects()?.[meta.dcName];
      const _btKws = (_btEff?.keywords || []).map(k => String(k).toUpperCase());
      if (_btKws.includes('CREATURE')) {
        // Exhaust Beast Tamer
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[msgId] = game.exhaustedSkirmishUpgrades[msgId] || [];
        if (!game.exhaustedSkirmishUpgrades[msgId].includes('Beast Tamer')) {
          game.exhaustedSkirmishUpgrades[msgId].push('Beast Tamer');
        }
        // Grant Speed MP (perform a move = gain movement points equal to Speed)
        const _btSpeed = ctx.getDcStats?.(meta.dcName)?.speed ?? 0;
        if (_btSpeed > 0) {
          game.movementBank = game.movementBank || {};
          if (!game.movementBank[msgId]) {
            game.movementBank[msgId] = { total: _btSpeed, remaining: _btSpeed, threadId: thread.id, messageId: null, displayName: meta.displayName || meta.dcName };
          } else {
            game.movementBank[msgId].total += _btSpeed;
            game.movementBank[msgId].remaining += _btSpeed;
          }
        }
        // If NON-SENTIENT, allow interact during this activation
        const _btAbilityText = _btEff?.abilityText || '';
        const _btIsNonSentient = _btAbilityText.includes('Non-Sentient');
        if (_btIsNonSentient) {
          game.beastTamerInteractOverride = game.beastTamerInteractOverride || {};
          game.beastTamerInteractOverride[msgId] = true;
          await thread.send({ content: `**Beast Tamer** — **${displayName}** gains **${_btSpeed} MP** (Speed) and **can interact** this activation (Non-Sentient override).` }).catch(discordCatch);
        } else {
          await thread.send({ content: `**Beast Tamer** — **${displayName}** gains **${_btSpeed} MP** (Speed).` }).catch(discordCatch);
        }
        await logGameAction(game, client, `**Beast Tamer** exhausted — **${displayName}** gains ${_btSpeed} MP${_btIsNonSentient ? ' and can interact' : ''}.`, { phase: 'ACTIVATION', icon: 'activate' });
      }
    }
  }
  // Imperial Retrofitting (I48): at start of activation of AT-ST, General Weiss, or SC2-M Repulsor Tank
  // Scan the activating player's DCs for [Imperial Retrofitting] and offer exhaust/deplete options
  {
    const _irEligibleNames = ['AT-ST', 'General Weiss', 'SC2-M Repulsor Tank'];
    if (_irEligibleNames.includes(meta.dcName)) {
      const _irDcList = getDcList(game, meta.playerNum) || [];
      const _irDcMsgIds = getDcMessageIds(game, meta.playerNum) || [];
      let _irMsgId = null;
      for (let di = 0; di < _irDcList.length; di++) {
        const dc = _irDcList[di];
        if (dc?.dcName === '[Imperial Retrofitting]') {
          _irMsgId = _irDcMsgIds[di] || null;
          break;
        }
      }
      if (_irMsgId) {
        const _irDepleted = (game.p1DepletedDcMessageIds || []).includes(_irMsgId) || (game.p2DepletedDcMessageIds || []).includes(_irMsgId);
        const _irExhausted = (game.exhaustedSkirmishUpgrades?.[_irMsgId] || []).includes('Imperial Retrofitting');
        if (!_irDepleted) {
          const _irBtns = [];
          if (!_irExhausted) {
            _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_impretro_multiattack_${_irMsgId}`).setLabel('IR: Multi-Attack (Exhaust)').setStyle(ButtonStyle.Primary));
            _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_impretro_move_${_irMsgId}`).setLabel('IR: Move (Exhaust)').setStyle(ButtonStyle.Primary));
          }
          _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_impretro_focus_${_irMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger));
          _irBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({ content: `**Imperial Retrofitting** — Choose an option for **${displayName}**:`, components: [new ActionRowBuilder().addComponents(_irBtns)] }).catch(discordCatch);
        }
      }
    }
  }
  // Imperial Citadel (I47): at start of a friendly Imperial figure's activation, it may gain 1 Power Token from this card
  {
    const _icAtkEff = getDcEffects()?.[meta.dcName];
    if (_icAtkEff?.affiliation === 'Imperial') {
      const _icDcList = getDcList(game, meta.playerNum) || [];
      if (_icDcList.some(dc => dc.dcName === '[Imperial Citadel]')) {
        const _icTokens = game.imperialCitadelTokens || {};
        const _icAvailable = Object.entries(_icTokens).filter(([, count]) => count > 0);
        if (_icAvailable.length > 0) {
          const _icBtns = _icAvailable.slice(0, 4).map(([type, count]) => {
            const label = `${type.charAt(0).toUpperCase() + type.slice(1)} (${count})`;
            return new ButtonBuilder()
              .setCustomId(`act_passive_${game.gameId}_${msgId}_citadel_token_${type}`)
              .setLabel(label)
              .setStyle(ButtonStyle.Primary);
          });
          _icBtns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_citadel_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({ content: `**Imperial Citadel** — **${displayName}** may gain 1 Power Token from the Citadel:`, components: [new ActionRowBuilder().addComponents(_icBtns)] }).catch(discordCatch);
        }
      }
    }
  }
  // I Make the Rules Now (Cad Bane): when another figure activates, HUNTER within 4 of Cad Bane gains 1 MP
  // Scan all DCs on BOTH teams for this ability
  for (const pn of [1, 2]) {
    const dcList = getDcList(game, pn) || [];
    const dcMsgIds = getDcMessageIds(game, pn) || [];
    for (let di = 0; di < dcList.length; di++) {
      const dc = dcList[di];
      if (!dc?.dcName) continue;
      const eff = getDcEffects()?.[dc.dcName];
      if (!(eff?.specialAbilityIds || []).includes('i_make_the_rules_cad_bane')) continue;
      if (dc.dcName === meta.dcName && pn === meta.playerNum) continue; // "another figure"
      const _getRange = ctx.getRange;
      const cadDgIdx = (dc.displayName || dc.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const cadFk = `${dc.dcName}-${cadDgIdx}-0`;
      const cadPos = game.figurePositions?.[pn]?.[cadFk];
      if (!cadPos || !_getRange) continue;
      // Grant 1 MP to each HUNTER within 4 of Cad Bane
      const friendlyFigs = game.figurePositions?.[pn] || {};
      for (const [fk, fp] of Object.entries(friendlyFigs)) {
        if (!fp) continue;
        const fDcName = dcNameFromFigureKey(fk);
        const fEff = getDcEffects()?.[fDcName];
        if (!(fEff?.keywords || []).some(k => String(k).toUpperCase() === 'HUNTER')) continue;
        if (_getRange(cadPos, fp) > 4) continue;
        // Find the msgId for this HUNTER figure
        for (const [mId, mMeta] of dcMessageMeta) {
          if (mMeta.gameId !== game.gameId || mMeta.playerNum !== pn || mMeta.dcName !== fDcName) continue;
          game.movementBank = game.movementBank || {};
          game.movementBank[mId] = game.movementBank[mId] || { total: 0, remaining: 0 };
          game.movementBank[mId].remaining += 1;
          game.movementBank[mId].total += 1;
          await thread.send({ content: `🔫 **I Make the Rules Now** — **${fDcName}** (HUNTER within 4 of Cad Bane) gains **1 MP**.` }).catch(discordCatch);
          break;
        }
      }
    }
  }

  // Calming Presence (Yoda): when a friendly REBEL activates, remove 1 harmful condition + suffer 1 Strain
  // Check if any Yoda figure on the activating player's team has this ability
  if (meta.playerNum) {
    const dcList = getDcList(game, meta.playerNum) || [];
    for (const dc of dcList) {
      if (!dc?.dcName) continue;
      const eff = getDcEffects()?.[dc.dcName];
      if (!(eff?.specialAbilityIds || []).includes('calming_presence_yoda')) continue;
      if (dc.dcName === meta.dcName) continue; // different figure
      // Check if the activating DC is REBEL
      const activatingEff = getDcEffects()?.[meta.dcName];
      if (activatingEff?.affiliation !== 'Rebel') continue;
      // Collect all harmful conditions across all figures in the activating group
      const dgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const figures = activatingEff?.figures ?? 1;
      const _cpHarmfulEntries = [];
      for (let fi = 0; fi < figures; fi++) {
        const fk = `${meta.dcName}-${dgIdx}-${fi}`;
        const conds = game.figureConditions?.[fk] || [];
        // Disarm permanent Weakened: exclude locked Weaken from removable choices
        const harmful = conds.filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
        for (const h of harmful) {
          _cpHarmfulEntries.push({ fk, condition: h, figIndex: fi });
        }
      }
      if (_cpHarmfulEntries.length > 0) {
        // Deduplicate by fk+condition
        const seen = new Set();
        const unique = _cpHarmfulEntries.filter(e => {
          const key = `${e.fk}_${e.condition}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const btns = unique.slice(0, 4).map(({ fk, condition }) => {
          const label = figures > 1 ? `${dcNameFromFigureKey(fk)}: ${condition}` : condition;
          return new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_calmpres_${fk}_${condition}`).setLabel(label).setStyle(ButtonStyle.Primary);
        });
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_calmpres_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `🧘 **Calming Presence** (Yoda) — **${meta.dcName}** is a REBEL figure. Remove 1 harmful condition (the activating figure suffers 1 Strain):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      }
      break;
    }
  }

  // Unshakable: exhaust at start of activation → choose friendly figure cost≥9, discard 1 harmful condition, suffer 1 Strain
  {
    const _usDcList = getDcList(game, meta.playerNum) || [];
    const _usDcMsgIds = getDcMessageIds(game, meta.playerNum) || [];
    let _usMsgId = null;
    for (let _usI = 0; _usI < _usDcList.length; _usI++) {
      if ((_usDcList[_usI]?.dcName || _usDcList[_usI]) === '[Unshakable]') { _usMsgId = _usDcMsgIds[_usI] || null; break; }
    }
    if (_usMsgId) {
      const _usExh = game.exhaustedSkirmishUpgrades?.[_usMsgId] || [];
      const _usDepleted = (game[`p${meta.playerNum}DepletedDcMessageIds`] || []).includes(_usMsgId);
      if (!_usExh.includes('Unshakable') && !_usDepleted) {
        // Find all friendly figures with cost ≥ 9 that have harmful conditions
        const _usAllFigPos = game.figurePositions?.[meta.playerNum] || {};
        const _usCandidates = [];
        for (const [fk, pos] of Object.entries(_usAllFigPos)) {
          if (!pos) continue;
          const fkDcName = dcNameFromFigureKey(fk);
          const fkCost = getDcStats(fkDcName)?.cost ?? 0;
          if (fkCost < 9) continue;
          const conds = game.figureConditions?.[fk] || [];
          const harmful = conds.filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
          if (harmful.length > 0) _usCandidates.push({ fk, dcName: fkDcName, harmful });
        }
        if (_usCandidates.length > 0) {
          const btns = _usCandidates.slice(0, 4).map(({ fk, dcName: dName, harmful }) => {
            const label = `${dName}: ${harmful.join(', ')}`;
            return new ButtonBuilder()
              .setCustomId(`act_passive_${game.gameId}_${msgId}_unshakable_${fk}`)
              .setLabel(label.length > 80 ? label.slice(0, 77) + '...' : label)
              .setStyle(ButtonStyle.Primary);
          });
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_unshakable_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread.send({
            content: `**Unshakable** — Choose a figure (cost ≥ 9) to discard 1 harmful condition (suffers 1 Strain):`,
            components: [new ActionRowBuilder().addComponents(btns)],
          }).catch(discordCatch);
        }
      }
    }
  }

  // Nemik's Manifesto: exhaust during activation → suffer 2 Strain, gain 1 MP
  {
    const _nmDcList = getDcList(game, meta.playerNum) || [];
    const _nmDcMsgIds = getDcMessageIds(game, meta.playerNum) || [];
    let _nmMsgId = null;
    for (let _nmI = 0; _nmI < _nmDcList.length; _nmI++) {
      if ((_nmDcList[_nmI]?.dcName || _nmDcList[_nmI]) === "[Nemik's Manifesto]") { _nmMsgId = _nmDcMsgIds[_nmI] || null; break; }
    }
    if (_nmMsgId) {
      const _nmExh = game.exhaustedSkirmishUpgrades?.[_nmMsgId] || [];
      const _nmDepleted = (game[`p${meta.playerNum}DepletedDcMessageIds`] || []).includes(_nmMsgId);
      if (!_nmExh.includes("Nemik's Manifesto") && !_nmDepleted) {
        const nmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_nemik_use_${_nmMsgId}`).setLabel("Use Nemik's Manifesto (+1 MP, -2 Strain)").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_nemik_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `📜 **Nemik's Manifesto** — Exhaust to grant **${displayName}** +1 MP (suffers 2 Strain)?`, components: [nmRow] }).catch(discordCatch);
      }
    }
  }

  // [Spectre Cell]: exhaust during activation → choose another friendly figure → +2 MP, may interrupt attack
  {
    const _scDcList = getDcList(game, meta.playerNum) || [];
    const _scDcMsgIds = getDcMessageIds(game, meta.playerNum) || [];
    let _scMsgId = null;
    for (let _scI = 0; _scI < _scDcList.length; _scI++) {
      if ((_scDcList[_scI]?.dcName || _scDcList[_scI]) === '[Spectre Cell]') { _scMsgId = _scDcMsgIds[_scI] || null; break; }
    }
    if (_scMsgId) {
      const _scExh = game.exhaustedSkirmishUpgrades?.[_scMsgId] || [];
      const _scDepleted = (game[`p${meta.playerNum}DepletedDcMessageIds`] || []).includes(_scMsgId);
      if (!_scExh.includes('Spectre Cell') && !_scDepleted) {
        // Check that there's at least one other friendly figure on the board
        const _scAllFigs = game.figurePositions?.[meta.playerNum] || {};
        const _scActivatingPrefix = `${meta.dcName}-`;
        const _scHasOther = Object.entries(_scAllFigs).some(([fk, pos]) => pos && !fk.startsWith(_scActivatingPrefix));
        if (_scHasOther) {
          const scRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_spectrecell_use`).setLabel('Use Spectre Cell (+2 MP + interrupt attack)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${msgId}_spectrecell_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**[Spectre Cell]** — Exhaust to choose another friendly figure: +2 MP and may interrupt to perform an attack.`, components: [scRow] }).catch(discordCatch);
        }
      }
    }
  }

  // Voracious (Rancor): when another figure activates adjacent to the Rancor, offer a free melee attack
  // Scan BOTH teams for any Rancor with the voracious_rancor ability
  for (const rancorPn of [1, 2]) {
    const rDcList = getDcList(game, rancorPn) || [];
    const rDcMsgIds = getDcMessageIds(game, rancorPn) || [];
    for (let ri = 0; ri < rDcList.length; ri++) {
      const rDc = rDcList[ri];
      if (!rDc?.dcName) continue;
      const rEff = getDcEffects()?.[rDc.dcName];
      if (!(rEff?.specialAbilityIds || []).includes('voracious_rancor')) continue;
      // "another figure" — skip if the activating DC is this same Rancor on the same team
      if (rDc.dcName === meta.dcName && rancorPn === meta.playerNum) continue;
      const rMsgId = rDcMsgIds[ri];
      if (!rMsgId) continue;
      // Find the Rancor's figure position
      const rDgIdx = (rDc.displayName || rDc.dcName).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const rFk = `${rDc.dcName}-${rDgIdx}-0`;
      const rPos = game.figurePositions?.[rancorPn]?.[rFk];
      if (!rPos) continue; // Rancor not on the board (defeated or not deployed)
      // Get Rancor footprint cells (Rancor is 2x3)
      const rSize = game.figureOrientations?.[rFk] || getFigureSize(rDc.dcName) || '2x3';
      const rCells = getFootprintCells(rPos, rSize);
      // Get activating figure's footprint cells
      const actDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const actStats = ctx.getDcStats?.(meta.dcName);
      const actFigCount = actStats?.figures ?? 1;
      let anyAdjacent = false;
      const adjacentActFks = [];
      for (let fi = 0; fi < actFigCount; fi++) {
        const actFk = `${meta.dcName}-${actDgIdx}-${fi}`;
        const actPos = game.figurePositions?.[meta.playerNum]?.[actFk];
        if (!actPos) continue;
        const actSize = game.figureOrientations?.[actFk] || getFigureSize(meta.dcName) || '1x1';
        const actCells = getFootprintCells(actPos, actSize);
        // Check adjacency: any Rancor cell adjacent to any activating figure cell
        let isAdj = false;
        for (const rc of rCells) {
          for (const ac of actCells) {
            if (getRange(rc, ac) === 1) { isAdj = true; break; }
          }
          if (isAdj) break;
        }
        if (isAdj) {
          anyAdjacent = true;
          adjacentActFks.push(actFk);
        }
      }
      if (anyAdjacent && adjacentActFks.length > 0) {
        const rDisplayName = rDc.displayName || rDc.dcName;
        const rancorOwner = rancorPn === meta.playerNum ? 'friendly' : 'hostile';
        // Store pending voracious data for the button handler
        game.pendingVoracious = game.pendingVoracious || {};
        game.pendingVoracious[rMsgId] = {
          rancorMsgId: rMsgId,
          rancorDcName: rDc.dcName,
          rancorPlayerNum: rancorPn,
          rancorFigureKey: rFk,
          rancorDisplayName: rDisplayName,
          targetFigureKeys: adjacentActFks,
          targetPlayerNum: meta.playerNum,
          targetDcName: meta.dcName,
          activatingMsgId: msgId,
        };
        // Build buttons: one attack button per adjacent figure (usually just 1), plus Skip
        const vorBtns = [];
        for (const tFk of adjacentActFks.slice(0, 4)) {
          const tLabel = actFigCount > 1 ? `Attack ${dcNameFromFigureKey(tFk)}` : `Attack ${meta.dcName}`;
          vorBtns.push(
            new ButtonBuilder()
              .setCustomId(`act_passive_${game.gameId}_${msgId}_voracious_${rMsgId}_${tFk}`)
              .setLabel(tLabel)
              .setStyle(ButtonStyle.Danger)
          );
        }
        vorBtns.push(
          new ButtonBuilder()
            .setCustomId(`act_passive_${game.gameId}_${msgId}_voracious_${rMsgId}_skip`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
        );
        await thread.send({
          content: `**Voracious** — **${rDisplayName}** (${rancorOwner}, P${rancorPn}) is adjacent to the activating figure. The Rancor may perform a free melee attack:`,
          components: [new ActionRowBuilder().addComponents(vorBtns)],
        }).catch(discordCatch);
      }
    }
  }

  // --- Companion activation ordering (before/after) ---
  // Check for companions that activate at the start or end of the parent's activation
  // (excludes Junk Droid which co-activates and is handled by Scrap Battalion above)
  {
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    if (_compInfo && !_compInfo.isCoActivation) {
      game.companionActivatedBefore = game.companionActivatedBefore || {};
      // Only prompt if companion hasn't already been marked (shouldn't happen, but guard)
      if (!game.companionActivatedBefore[msgId]) {
        const _compRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`act_passive_${game.gameId}_${msgId}_companionbefore_activate`)
            .setLabel(`Activate ${_compInfo.companionName} Now (Before)`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`act_passive_${game.gameId}_${msgId}_companionafter_skip`)
            .setLabel(`Skip (Activate ${_compInfo.companionName} After)`)
            .setStyle(ButtonStyle.Secondary),
        );
        const _compSummary = formatCompanionStats(_compInfo.companionName, _compInfo.companionStats);
        await thread.send({
          content: `🐾 **Companion: ${_compInfo.companionName}** — Activates at the start or end of **${displayName}**'s activation.\n${_compSummary}\n\nActivate the companion now (before ${meta.dcName}) or after?`,
          components: [_compRow],
        }).catch(discordCatch);
      }
    }
  }

  const logCh = await client.channels.fetch(game.generalId);
  const icon = ACTION_ICONS.activate || '⚡';
  const pLabel = `P${meta.playerNum}`;
  const logMsg = await logCh.send({
    content: `${icon} <t:${Math.floor(Date.now() / 1000)}:t> — **${pLabel}:** <@${ownerId}> activated **${displayName}**!`,
    allowedMentions: { users: [ownerId] },
  });
  game.dcActivationLogMessageIds = game.dcActivationLogMessageIds || {};
  game.dcActivationLogMessageIds[msgId] = logMsg.id;
  if (activateCardMsgId) {
    try {
      const activateCardMsg = await logCh.messages.fetch(activateCardMsgId);
      const activateRows = getActivateDcButtons(game, meta.playerNum);
      await activateCardMsg.edit({ content: '**Activate a Deployment Card**', components: activateRows.length > 0 ? activateRows : [] }).catch(discordCatch);
    } catch {}
  }
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - (none required; just deferUpdate and edit)
 */
export async function handleCancelActivate(interaction, _ctx) {
  const match = interaction.customId.match(/^cancel_activate_([^_]+)_(.+)$/);
  if (!match) return;
  const [, gameId, ownerId] = match;
  if (interaction.user.id !== ownerId) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
}

/**
 * Handle activation-passive choice buttons (act_passive_).
 * Covers: Vigor, Responsive, Hunger (Elite token choice), Tactical Movement, Advanced Weapons Research,
 * Open-Minded, Calming Presence, Wisdom, Trust Goes Both Ways, Token Distribution (Arms Distribution,
 * Long-Laid Plans), General's Orders, Durasteel Fist, Motivation, Trusted Ally.
 */
export async function handleActPassive(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, dcMessageMeta, dcHealthState, saveGames, logGameAction, client, buildDcEmbedAndFiles, getDcPlayAreaComponents } = ctx;
  // Parse: act_passive_{gameId}_{msgId}_{ability}_{choice}
  const parts = interaction.customId.replace(/^act_passive_/, '').split('_');
  if (parts.length < 3) return;
  const gameId = parts[0];
  const msgId = parts[1];
  const ability = parts[2];
  const choice = parts.slice(3).join('_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return;
  const displayName = meta.displayName || meta.dcName;
  // Remove buttons from message
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  if (ability === 'vigor') {
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 2;
      game.movementBank[msgId].remaining += 2;
      await interaction.message.edit({ content: `✨ **Vigor** — **${displayName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
    } else if (choice === 'block') {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      grantPowerTokens(game, fk, 'Block', 1);
      await interaction.message.edit({ content: `✨ **Vigor** — **${displayName}** gained **1 Block Token**.`, components: [] }).catch(discordCatch);
      if (game.pendingPowerTokenOverflow?.length > 0) {
        await sendPowerTokenOverflowUI(game, gameId, interaction.channel, meta.playerNum, saveGames);
      }
    }
  } else if (ability === 'responsive') {
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 1;
      game.movementBank[msgId].remaining += 1;
      await interaction.message.edit({ content: `🏃 **Responsive** — **${displayName}** gained **1 MP**.`, components: [] }).catch(discordCatch);
    } else if (choice === 'heal') {
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      const fkIdx = 0;
      const hs = dcHealthState.get(msgId);
      if (hs?.[fkIdx] && Array.isArray(hs[fkIdx])) {
        const [cur, max] = hs[fkIdx];
        hs[fkIdx] = [Math.min(max, (cur ?? max) + 1), max];
      }
      await interaction.message.edit({ content: `🏃 **Responsive** — **${displayName}** recovered **1 Damage**.`, components: [] }).catch(discordCatch);
    }
  } else if (ability === 'hunger') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const fk = `${meta.dcName}-${dgIndex}-0`;
    if (choice === 'block') {
      grantPowerTokens(game, fk, 'Block', 1);
      await interaction.message.edit({ content: `🐻 **Hunger** — **${displayName}** gained 3 MP and **1 Block Token**.`, components: [] }).catch(discordCatch);
    } else if (choice === 'evade') {
      grantPowerTokens(game, fk, 'Evade', 1);
      await interaction.message.edit({ content: `🐻 **Hunger** — **${displayName}** gained 3 MP and **1 Evade Token**.`, components: [] }).catch(discordCatch);
    }
    if (game.pendingPowerTokenOverflow?.length > 0) {
      await sendPowerTokenOverflowUI(game, gameId, interaction.channel, meta.playerNum, saveGames);
    }
  } else if (ability === 'tacmove') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🎯 **Tactical Movement** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice is the figureKey of the target
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      // Find the target's msgId to add MP to their movement bank
      let targetMsgId = null;
      for (const [mId, mMeta] of dcMessageMeta) {
        if (mMeta.gameId !== gameId) continue;
        if (mMeta.dcName === targetDcName && mMeta.playerNum === meta.playerNum) {
          targetMsgId = mId;
          break;
        }
      }
      if (targetMsgId) {
        game.movementBank = game.movementBank || {};
        game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
        game.movementBank[targetMsgId].total += 2;
        game.movementBank[targetMsgId].remaining += 2;
      }
      await interaction.message.edit({ content: `🎯 **Tactical Movement** — **${targetDcName}** gained **2 MP**.`, components: [] }).catch(discordCatch);
    }
  } else if (ability === 'awr') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — Skipped.`, components: [] }).catch(discordCatch);
      delete game.pendingAwr;
    } else {
      // choice is the figureKey of the target — now offer Hit or Surge token choice
      game.pendingAwr = game.pendingAwr || {};
      game.pendingAwr.targetFk = choice;
      const targetDcName = dcNameFromFigureKey(choice);
      const tokenRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awrtoken_hit`).setLabel('Hit Token').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_awrtoken_surge`).setLabel('Surge Token').setStyle(ButtonStyle.Primary),
      );
      await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — **${targetDcName}**: Choose token type:`, components: [tokenRow] }).catch(discordCatch);
    }
  } else if (ability === 'awrtoken') {
    const targetFk = game.pendingAwr?.targetFk;
    if (!targetFk) return;
    const targetDcName = dcNameFromFigureKey(targetFk);
    const tokenType = choice === 'hit' ? 'Hit' : 'Surge';
    grantPowerTokens(game, targetFk, tokenType, 1);
    delete game.pendingAwr;
    await interaction.message.edit({ content: `🔬 **Advanced Weapons Research** — **${targetDcName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(discordCatch);
    if (game.pendingPowerTokenOverflow?.length > 0) {
      await sendPowerTokenOverflowUI(game, gameId, interaction.channel, meta.playerNum, saveGames);
    }
  } else if (ability === 'openminded') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const fk = `${meta.dcName}-${dgIndex}-0`;
    if (choice === 'mp') {
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 1;
      game.movementBank[msgId].remaining += 1;
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}** gained **1 MP**.`, components: [] }).catch(discordCatch);
    } else if (choice === 'token') {
      // Grant 1 Power Token — player chooses type via power_token_choice_ flow
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: meta.dcName, count: 1 }], channelId: interaction.channelId, playerNum: meta.playerNum };
      const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = await import('discord.js');
      const tokenBtns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
        new BB().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(BS.Secondary)
      );
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}**: Choose Power Token type:`, components: [new AR().addComponents(tokenBtns)] }).catch(discordCatch);
      saveGames();
      return; // Don't save twice
    }
  // --- Calming Presence: pick condition to remove, suffer 1 Strain ---
  } else if (ability === 'calmpres') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🧘 **Calming Presence** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice format: figureKey_Condition (e.g. "Rebel Ranger-1-0_Stun")
      // But since figureKey contains hyphens, we stored it as act_passive_{gameId}_{msgId}_calmpres_{fk}_{condition}
      // The fk and condition are in the remaining parts after 'calmpres'
      // parts[3:] = calmpres, fk..., Condition
      // We need to re-parse from customId since figureKeys have hyphens
      const fullSuffix = interaction.customId.replace(/^act_passive_[^_]+_[^_]+_calmpres_/, '');
      const lastUnderscore = fullSuffix.lastIndexOf('_');
      const condFk = fullSuffix.slice(0, lastUnderscore);
      const condName = fullSuffix.slice(lastUnderscore + 1);
      filterCondition(game, condFk, condName);
      // Apply 1 Strain to the activating figure
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const selfFk = `${meta.dcName}-${dgIndex}-0`;
      reduceHp(dcHealthState, game, msgId, 0, 1, meta.playerNum);
      const condFkName = dcNameFromFigureKey(condFk);
      await interaction.message.edit({ content: `🧘 **Calming Presence** — Removed **${condName}** from **${condFkName}**. **${displayName}** suffered **1 Strain**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Calming Presence** (Yoda) — Removed ${condName} from ${condFkName}; ${displayName} suffered 1 Strain.`, { phase: 'ACTIVATION', icon: 'condition' });
    }
  // --- Nemik's Manifesto: exhaust for +1 MP, -2 Strain ---
  } else if (ability === 'nemik') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `📜 **Nemik's Manifesto** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice = 'use_{nmMsgId}'
      const nmMsgId = interaction.customId.replace(/^act_passive_[^_]+_[^_]+_nemik_use_/, '');
      // Exhaust the card
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[nmMsgId] = [...(game.exhaustedSkirmishUpgrades[nmMsgId] || []), "Nemik's Manifesto"];
      // Grant 1 MP
      game.movementBank = game.movementBank || {};
      game.movementBank[msgId] = game.movementBank[msgId] || { total: 0, remaining: 0 };
      game.movementBank[msgId].total += 1;
      game.movementBank[msgId].remaining += 1;
      // Apply 2 Strain to the activating figure
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      const figMatch = fk.match(/-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[1], 10) : 0;
      reduceHp(dcHealthState, game, msgId, figIdx, 2, meta.playerNum);
      await interaction.message.edit({ content: `📜 **Nemik's Manifesto** — **${displayName}** gained **1 MP** and suffered **2 Strain**. (Exhausted)`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Nemik's Manifesto** — ${displayName} gained 1 MP, suffered 2 Strain. (Exhausted)`, { phase: 'ACTIVATION', icon: 'card' });
    }
  // --- Unshakable: discard harmful condition from cost≥9 figure, suffer 1 Strain, exhaust ---
  } else if (ability === 'unshakable') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Unshakable** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // Parse figureKey from remaining parts after 'unshakable'
      const fullSuffix = interaction.customId.replace(/^act_passive_[^_]+_[^_]+_unshakable_/, '');
      const targetFk = fullSuffix;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const conds = game.figureConditions?.[targetFk] || [];
      const harmful = conds.filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[targetFk]));
      if (harmful.length > 0) {
        const removedCond = harmful[0];
        filterCondition(game, targetFk, removedCond);
        // Apply 1 Strain to the chosen figure
        const targetMsgId = ctx.findDcMessageIdForFigure?.(gameId, meta.playerNum, targetFk);
        if (targetMsgId) {
          const figMatch = targetFk.match(/-(\d+)$/);
          const figIdx = figMatch ? parseInt(figMatch[1], 10) : 0;
          reduceHp(dcHealthState, game, targetMsgId, figIdx, 1, meta.playerNum);
        }
        // Exhaust Unshakable
        const _usDcList2 = getDcList(game, meta.playerNum) || [];
        const _usDcMsgIds2 = getDcMessageIds(game, meta.playerNum) || [];
        for (let i = 0; i < _usDcList2.length; i++) {
          if ((_usDcList2[i]?.dcName || _usDcList2[i]) === '[Unshakable]') {
            const usMsgId2 = _usDcMsgIds2[i];
            if (usMsgId2) {
              game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
              game.exhaustedSkirmishUpgrades[usMsgId2] = [...(game.exhaustedSkirmishUpgrades[usMsgId2] || []), 'Unshakable'];
            }
            break;
          }
        }
        await interaction.message.edit({ content: `**Unshakable** — Removed **${removedCond}** from **${targetDcName}**. That figure suffered **1 Strain**.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Unshakable** — Removed ${removedCond} from ${targetDcName}; suffered 1 Strain. (Exhausted)`, { phase: 'ACTIVATION', icon: 'condition' });
      } else {
        await interaction.message.edit({ content: `**Unshakable** — No harmful conditions to remove.`, components: [] }).catch(discordCatch);
      }
    }
  // --- Spectre Cell: exhaust → choose another friendly figure → +2 MP + interrupt attack ---
  } else if (ability === 'spectrecell') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: '**[Spectre Cell]** — Skipped.', components: [] }).catch(discordCatch);
    } else if (choice === 'use') {
      // Show figure picker for other friendly figures
      const allFigs = game.figurePositions?.[meta.playerNum] || {};
      const activatingPrefix = `${meta.dcName}-`;
      const targets = [];
      const seenDcNames = new Set();
      for (const [fk, pos] of Object.entries(allFigs)) {
        if (!pos) continue;
        if (fk.startsWith(activatingPrefix)) continue;
        const dn = dcNameFromFigureKey(fk);
        if (seenDcNames.has(dn)) continue;
        seenDcNames.add(dn);
        targets.push({ fk, dcName: dn });
      }
      if (targets.length > 0) {
        const btns = targets.slice(0, 24).map(({ fk, dcName: dn }) =>
          new ButtonBuilder()
            .setCustomId(`sc_fig_pick_${game.gameId}_${msgId}_${fk}`)
            .setLabel(dn.length > 80 ? dn.slice(0, 77) + '...' : dn)
            .setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`sc_fig_pick_${game.gameId}_${msgId}_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
        const rows = [];
        for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
        await interaction.message.edit({
          content: '**[Spectre Cell]** — Choose another friendly figure to gain 2 MP and may interrupt to attack:',
          components: rows.slice(0, 5),
        }).catch(discordCatch);
      } else {
        await interaction.message.edit({ content: '**[Spectre Cell]** — No eligible friendly figures.', components: [] }).catch(discordCatch);
      }
    }
  // --- Wisdom: return 1 CC to bottom of deck ---
  } else if (ability === 'wisdom') {
    const handKey = ccHandKey(meta.playerNum);
    const deckKey = ccDeckKey(meta.playerNum);
    const hand = game[handKey] || [];
    const cardIndex = parseInt(choice, 10);
    const uniqueCards = [...new Set(hand)];
    if (cardIndex >= 0 && cardIndex < uniqueCards.length) {
      const cardName = uniqueCards[cardIndex];
      const idx = hand.indexOf(cardName);
      if (idx >= 0) {
        hand.splice(idx, 1);
        game[handKey] = hand;
        game[deckKey] = game[deckKey] || [];
        game[deckKey].push(cardName);
        await interaction.message.edit({ content: `🧘 **Wisdom** — Returned **${cardName}** to the bottom of the deck.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Wisdom** (Yoda) — Drew 1 CC, returned 1 CC to bottom of deck.`, { phase: 'ACTIVATION', icon: 'card' });
      }
    }
  // --- Strategize (Thrawn): discard top of own or opponent's CC deck ---
  } else if (ability === 'strategize') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🧠 **Strategize** — Chose not to discard.`, components: [] }).catch(discordCatch);
    } else {
      const _strIsOwn = choice === 'own';
      const _strTargetPn = _strIsOwn ? meta.playerNum : opponentPlayerNum(meta.playerNum);
      const _strDeckKey = ccDeckKey(_strTargetPn);
      const _strDeck = game[_strDeckKey] || [];
      if (_strDeck.length > 0) {
        const _strCard = _strDeck.shift();
        const _strDiscKey = ccDiscardKey(_strTargetPn);
        game[_strDiscKey] = game[_strDiscKey] || [];
        game[_strDiscKey].push(_strCard);
        await interaction.message.edit({ content: `🧠 **Strategize** — Discarded **${_strCard}** from the ${_strIsOwn ? 'own' : "opponent's"} deck.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Strategize** (Thrawn) — Discarded ${_strCard} from ${_strIsOwn ? 'own' : "opponent's"} command deck.`, { phase: 'ACTIVATION', icon: 'card' });
      } else {
        await interaction.message.edit({ content: `🧠 **Strategize** — Deck is empty; nothing to discard.`, components: [] }).catch(discordCatch);
      }
    }
  // --- Trust Goes Both Ways: chosen figure gains 1 MP ---
  } else if (ability === 'trustboth') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🤝 **Trust Goes Both Ways** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      let targetMsgId = null;
      for (const [mId, mMeta] of dcMessageMeta) {
        if (mMeta.gameId !== gameId) continue;
        if (mMeta.dcName === targetDcName && mMeta.playerNum === meta.playerNum) {
          targetMsgId = mId;
          break;
        }
      }
      if (targetMsgId) {
        game.movementBank = game.movementBank || {};
        game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
        game.movementBank[targetMsgId].total += 1;
        game.movementBank[targetMsgId].remaining += 1;
      }
      await interaction.message.edit({ content: `🤝 **Trust Goes Both Ways** — **${targetDcName}** gained **1 MP**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Trust Goes Both Ways** (Jyn Erso) — ${targetDcName} gained 1 MP.`, { phase: 'ACTIVATION', icon: 'activate' });
    }
  // --- Token Distribution: used by Arms Distribution and Long-Laid Plans ---
  } else if (ability === 'tokendist') {
    const pending = game.pendingTokenDistribution;
    if (!pending) return;
    if (choice === 'done') {
      const abilityLabel = pending.ability === 'longlaid' ? 'Long-Laid Plans' : 'Arms Distribution';
      await interaction.message.edit({ content: `${pending.ability === 'longlaid' ? '🧠' : '🎯'} **${abilityLabel}** — Done (distributed ${(pending.originalRemaining || pending.remaining) - pending.remaining} token${((pending.originalRemaining || pending.remaining) - pending.remaining) !== 1 ? 's' : ''}).`, components: [] }).catch(discordCatch);
      delete game.pendingTokenDistribution;
    } else {
      // choice is figureKey — show token type picker
      pending.pendingTargetFk = choice;
      if (!pending.originalRemaining) pending.originalRemaining = pending.remaining;
      const tokenBtns = pending.tokenTypes.map(t =>
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokenpick_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
      );
      const targetDcName = dcNameFromFigureKey(choice);
      await interaction.message.edit({ content: `Choose token type for **${targetDcName}** (${pending.remaining} remaining):`, components: [new ActionRowBuilder().addComponents(tokenBtns)] }).catch(discordCatch);
    }
  } else if (ability === 'tokenpick') {
    const pending = game.pendingTokenDistribution;
    if (!pending || !pending.pendingTargetFk) return;
    const tokenType = choice.charAt(0).toUpperCase() + choice.slice(1);
    const fk = pending.pendingTargetFk;
    grantPowerTokens(game, fk, tokenType, 1);
    pending.remaining--;
    const targetDcName = dcNameFromFigureKey(fk);
    delete pending.pendingTargetFk;
    const abilityLabel = pending.ability === 'longlaid' ? 'Long-Laid Plans' : 'Arms Distribution';
    const icon = pending.ability === 'longlaid' ? '🧠' : '🎯';
    await logGameAction?.(game, client, `**${abilityLabel}** — ${targetDcName} gained 1 ${tokenType} Token.`, { phase: 'ACTIVATION', icon: 'activate' });
    if (game.pendingPowerTokenOverflow?.length > 0) {
      await sendPowerTokenOverflowUI(game, gameId, interaction.channel, meta.playerNum, saveGames);
    }
    if (pending.remaining <= 0) {
      await interaction.message.edit({ content: `${icon} **${abilityLabel}** — **${targetDcName}** gained **1 ${tokenType} Token**. Distribution complete.`, components: [] }).catch(discordCatch);
      delete game.pendingTokenDistribution;
    } else {
      // Show figure picker again for next token
      const _tdGetRange = getRange;
      const _tdDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _tdSelfFk = `${meta.dcName}-${_tdDgIndex}-0`;
      const _tdSelfPos = game.figurePositions?.[meta.playerNum]?.[_tdSelfFk];
      const _tdFriendlies = _tdSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk2, fp]) => fp && _tdGetRange(_tdSelfPos, fp) <= 3) : [];
      if (_tdFriendlies.length > 0) {
        const btns = _tdFriendlies.slice(0, 4).map(([fk2]) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
        await interaction.message.edit({ content: `${icon} **${abilityLabel}** — **${targetDcName}** gained **1 ${tokenType} Token**. Pick next figure (${pending.remaining} remaining):`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
      } else {
        await interaction.message.edit({ content: `${icon} **${abilityLabel}** — **${targetDcName}** gained **1 ${tokenType} Token**. No more eligible figures.`, components: [] }).catch(discordCatch);
        delete game.pendingTokenDistribution;
      }
    }
  // --- General's Orders: each chosen figure gains 2 MP ---
  } else if (ability === 'genorders') {
    const pending = game.pendingGeneralsOrders;
    if (!pending) return;
    if (choice === 'done') {
      await interaction.message.edit({ content: `🎖️ **General's Orders** — Done (${pending.chosen.length} figure${pending.chosen.length !== 1 ? 's' : ''} granted MP).`, components: [] }).catch(discordCatch);
      delete game.pendingGeneralsOrders;
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      let targetMsgId = null;
      for (const [mId, mMeta] of dcMessageMeta) {
        if (mMeta.gameId !== gameId) continue;
        if (mMeta.dcName === targetDcName && mMeta.playerNum === meta.playerNum) {
          targetMsgId = mId;
          break;
        }
      }
      if (targetMsgId) {
        game.movementBank = game.movementBank || {};
        game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
        game.movementBank[targetMsgId].total += 2;
        game.movementBank[targetMsgId].remaining += 2;
      }
      pending.chosen.push(targetFk);
      pending.remaining--;
      await logGameAction?.(game, client, `**General's Orders** — ${targetDcName} gained 2 MP.`, { phase: 'ACTIVATION', icon: 'activate' });
      if (pending.remaining <= 0) {
        await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** gained **2 MP**. All picks used.`, components: [] }).catch(discordCatch);
        delete game.pendingGeneralsOrders;
      } else {
        // Show remaining figure choices (exclude already chosen)
        const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
          .filter(([fk, fp]) => fp && !pending.chosen.includes(fk));
        const _goSelfDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _goSelfFk = `${meta.dcName}-${_goSelfDgIdx}-0`;
        const filtered = friendlyFigs.filter(([fk]) => fk !== _goSelfFk);
        if (filtered.length > 0) {
          const btns = filtered.slice(0, 4).map(([fk]) =>
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_${fk}`).setLabel(dcNameFromFigureKey(fk)).setStyle(ButtonStyle.Primary)
          );
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
          await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** gained **2 MP**. Pick figure ${2 - pending.remaining + 1} of 2:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
        } else {
          await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** gained **2 MP**. No more eligible figures.`, components: [] }).catch(discordCatch);
          delete game.pendingGeneralsOrders;
        }
      }
    }
  // --- Durasteel Fist: roll 1 green die on adjacent target ---
  // --- Wookiee Avenger free Slam: roll 1 red die on adjacent target ---
  } else if (ability === 'wookslam') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Wookiee Avenger** — Free Slam skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      // Mark Slam as used this activation
      game.wookieeAvengerSlamUsed = game.wookieeAvengerSlamUsed || {};
      game.wookieeAvengerSlamUsed[msgId] = true;
      // Track as special action for CC purposes (To the Limit, All in a Day's Work)
      game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
      game.specialActionUsedThisActivation[msgId] = (game.specialActionUsedThisActivation[msgId] || 0) + 1;
      // Roll 1 red die
      const faces = getDiceData()?.attack?.red;
      if (!faces?.length) {
        await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Roll 1 red die manually and apply results to **${targetDcName}**.`, components: [] }).catch(discordCatch);
      } else {
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const surges = face.surge ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const resultParts = [`Rolled: **${diceResult}**`];
        // Determine target's playerNum
        let targetPlayerNum = null;
        for (const pn of [1, 2]) {
          if (game.figurePositions?.[pn]?.[targetFk]) { targetPlayerNum = pn; break; }
        }
        if (hits > 0 && targetPlayerNum) {
          let targetMsgId = null;
          for (const [mId, mMeta] of dcMessageMeta) {
            if (mMeta.gameId !== gameId || mMeta.playerNum !== targetPlayerNum || mMeta.dcName !== targetDcName) continue;
            targetMsgId = mId;
            break;
          }
          if (targetMsgId) {
            const fkMatch = targetFk.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const res = reduceHp(dcHealthState, game, targetMsgId, figIdx, hits, targetPlayerNum);
            resultParts.push(`${hits} Damage to **${targetDcName}** (HP: ${res.prevHp} -> ${res.newHp})`);
          } else {
            resultParts.push(`Apply ${hits} Damage to **${targetDcName}** manually`);
          }
        }
        // SMALL push check: if target is SMALL, offer space picker for push
        const targetKws = getDcKeywords(game)?.[targetDcName] || [];
        const isSmall = !targetKws.some(k => /large|massive/i.test(String(k)));
        if (isSmall && hits > 0) {
          const _waMapId = game.selectedMap?.id;
          const _waMs = _waMapId ? getMapSpaces(_waMapId) : null;
          const _waDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
          const _waSelfFk = `${meta.dcName}-${_waDgIndex}-0`;
          const _waSelfPos = game.figurePositions?.[meta.playerNum]?.[_waSelfFk];
          if (_waSelfPos && _waMs) {
            const adjSpaces = _waMs.adjacency?.[String(_waSelfPos).toLowerCase()] || [];
            const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean).map(s => String(s).toLowerCase()));
            const targetCurPos = game.figurePositions?.[targetPlayerNum]?.[targetFk];
            const validPushSpaces = adjSpaces.filter(s => {
              const sl = String(s).toLowerCase();
              return !occupiedSet.has(sl) || (targetCurPos && sl === String(targetCurPos).toLowerCase());
            });
            if (validPushSpaces.length > 0) {
              // Store pending push state
              game.pendingWookSlamPush = { targetFk, targetPlayerNum, gameId, msgId };
              const spaceBtns = validPushSpaces.slice(0, 4).map(s =>
                new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslamspace_${String(s).toLowerCase()}`).setLabel(String(s).toUpperCase()).setStyle(ButtonStyle.Primary)
              );
              spaceBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslamspace_skip`).setLabel('Skip push').setStyle(ButtonStyle.Secondary));
              await interaction.message.edit({ content: `**Wookiee Avenger Slam** — ${resultParts.join('. ')}. Push **${targetDcName}** to which space?`, components: [new ActionRowBuilder().addComponents(spaceBtns)] }).catch(discordCatch);
              await logGameAction?.(game, client, `**Wookiee Avenger Slam** — Rolled ${diceResult} against ${targetDcName}. Push pending.`, { phase: 'ACTIVATION', icon: 'activate' });
              saveGames();
              return; // Don't save again at the end
            }
          }
        }
        await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Target: **${targetDcName}**. ${resultParts.join('. ')}.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Wookiee Avenger Slam** — Rolled ${diceResult} against ${targetDcName}.`, { phase: 'ACTIVATION', icon: 'activate' });
      }
    }
  // --- Wookiee Avenger Slam push space chosen ---
  } else if (ability === 'wookslamspace') {
    const pending = game.pendingWookSlamPush;
    if (!pending) {
      await interaction.message.edit({ content: `**Wookiee Avenger Slam** — No pending push.`, components: [] }).catch(discordCatch);
    } else if (choice === 'skip') {
      delete game.pendingWookSlamPush;
      await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Push skipped.`, components: [] }).catch(discordCatch);
    } else {
      const { targetFk, targetPlayerNum } = pending;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const chosenSpace = String(choice).toLowerCase();
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[targetPlayerNum] = game.figurePositions[targetPlayerNum] || {};
      game.figurePositions[targetPlayerNum][targetFk] = chosenSpace;
      delete game.pendingWookSlamPush;
      await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Pushed **${targetDcName}** to **${chosenSpace.toUpperCase()}**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Wookiee Avenger Slam** — Pushed **${targetDcName}** to **${chosenSpace.toUpperCase()}**.`, { phase: 'ACTIVATION', icon: 'move' });
    }
  // --- Durasteel Fist: roll 1 green die on adjacent target ---
  } else if (ability === 'durasteelfist') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🤜 **Durasteel Fist** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${meta.dcName}_durasteel_fist_${msgId}`] = true;
      // Roll 1 green die
      const faces = getDiceData()?.attack?.green;
      if (!faces?.length) {
        await interaction.message.edit({ content: `🤜 **Durasteel Fist** — Roll 1 green die manually and apply results to **${targetDcName}**.`, components: [] }).catch(discordCatch);
      } else {
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const surges = face.surge ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const resultParts = [`Rolled: **${diceResult}**`];
        // Determine target's playerNum
        let targetPlayerNum = null;
        for (const pn of [1, 2]) {
          if (game.figurePositions?.[pn]?.[targetFk]) { targetPlayerNum = pn; break; }
        }
        if (hits > 0 && targetPlayerNum) {
          // Find target's msgId
          let targetMsgId = null;
          for (const [mId, mMeta] of dcMessageMeta) {
            if (mMeta.gameId !== gameId || mMeta.playerNum !== targetPlayerNum || mMeta.dcName !== targetDcName) continue;
            targetMsgId = mId;
            break;
          }
          if (targetMsgId) {
            const fkMatch = targetFk.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const res = reduceHp(dcHealthState, game, targetMsgId, figIdx, hits, targetPlayerNum);
            resultParts.push(`${hits} Damage to **${targetDcName}** (HP: ${res.prevHp} -> ${res.newHp})`);
          } else {
            resultParts.push(`Apply ${hits} Damage to **${targetDcName}** manually`);
          }
        }
        // Surge + SMALL check: push (player chooses push direction — no space picker for single push)
        if (surges > 0) {
          const targetKws = getDcKeywords(game)?.[targetDcName] || [];
          const isSmall = !targetKws.some(k => /large|massive/i.test(String(k)));
          if (isSmall) {
            resultParts.push(`Surge rolled and target is SMALL — push **${targetDcName}** 1 space`);
          }
        }
        await interaction.message.edit({ content: `🤜 **Durasteel Fist** — Target: **${targetDcName}**. ${resultParts.join('. ')}.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Durasteel Fist** — Rolled ${diceResult} against ${targetDcName}.`, { phase: 'ACTIVATION', icon: 'activate' });
      }
    }
  // --- Motivation: chosen figure recovers 1 or discards harmful, then gains 1 MP ---
  } else if (ability === 'motivation') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Motivation** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      // Exhaust the upgrade
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = game.exhaustedSkirmishUpgrades[msgId] || [];
      if (!game.exhaustedSkirmishUpgrades[msgId].includes('Motivation')) {
        game.exhaustedSkirmishUpgrades[msgId].push('Motivation');
      }
      // Store pending and show heal vs discard choice
      game.pendingMotivation = { targetFk, gameId, msgId, playerNum: meta.playerNum };
      // Disarm permanent Weakened: exclude locked Weaken from discardable choices
      const conds = (game.figureConditions?.[targetFk] || []).filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[targetFk]));
      const btns = [
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivchoice_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Primary),
      ];
      if (conds.length > 0) {
        for (const c of [...new Set(conds)].slice(0, 3)) {
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_motivchoice_${c}`).setLabel(`Discard ${c}`).setStyle(ButtonStyle.Danger));
        }
      }
      await interaction.message.edit({ content: `**Motivation** — **${targetDcName}**: Choose one:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    }
  } else if (ability === 'motivchoice') {
    const pending = game.pendingMotivation;
    if (!pending) return;
    const targetFk = pending.targetFk;
    const targetDcName = dcNameFromFigureKey(targetFk);
    // Find target's msgId for HP operations
    let targetMsgId = null;
    for (const [mId, mMeta] of dcMessageMeta) {
      if (mMeta.gameId !== gameId || mMeta.dcName !== targetDcName || mMeta.playerNum !== meta.playerNum) continue;
      targetMsgId = mId;
      break;
    }
    const resultParts = [];
    if (choice === 'heal') {
      if (targetMsgId) {
        const fkMatch = targetFk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        healHp(dcHealthState, game, targetMsgId, figIdx, 1, meta.playerNum);
        resultParts.push('recovered 1 Damage');
      }
    } else {
      // choice is a condition name
      filterCondition(game, targetFk, choice);
      resultParts.push(`discarded ${choice}`);
    }
    // Grant 1 MP to target
    if (targetMsgId) {
      game.movementBank = game.movementBank || {};
      game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
      game.movementBank[targetMsgId].total += 1;
      game.movementBank[targetMsgId].remaining += 1;
      resultParts.push('gained 1 MP');
    }
    delete game.pendingMotivation;
    await interaction.message.edit({ content: `**Motivation** — **${targetDcName}**: ${resultParts.join(', ')}.`, components: [] }).catch(discordCatch);
    await logGameAction?.(game, client, `**Motivation** — ${targetDcName}: ${resultParts.join(', ')}.`, { phase: 'ACTIVATION', icon: 'activate' });
  // --- Trusted Ally: chosen figure recovers 1 or discards harmful ---
  } else if (ability === 'trustedally') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Trusted Ally** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      // Exhaust the upgrade
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = game.exhaustedSkirmishUpgrades[msgId] || [];
      if (!game.exhaustedSkirmishUpgrades[msgId].includes('Trusted Ally')) {
        game.exhaustedSkirmishUpgrades[msgId].push('Trusted Ally');
      }
      // Show heal vs discard choice
      game.pendingTrustedAlly = { targetFk, gameId, msgId, playerNum: meta.playerNum };
      // Disarm permanent Weakened: exclude locked Weaken from discardable choices
      const conds = (game.figureConditions?.[targetFk] || []).filter(c => ['Stun', 'Bleed', 'Weaken'].includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[targetFk]));
      const btns = [
        new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tallychoice_heal`).setLabel('Recover 1 Damage').setStyle(ButtonStyle.Primary),
      ];
      if (conds.length > 0) {
        for (const c of [...new Set(conds)].slice(0, 3)) {
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tallychoice_${c}`).setLabel(`Discard ${c}`).setStyle(ButtonStyle.Danger));
        }
      }
      await interaction.message.edit({ content: `**Trusted Ally** — **${targetDcName}**: Choose one:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
    }
  } else if (ability === 'tallychoice') {
    const pending = game.pendingTrustedAlly;
    if (!pending) return;
    const targetFk = pending.targetFk;
    const targetDcName = dcNameFromFigureKey(targetFk);
    let targetMsgId = null;
    for (const [mId, mMeta] of dcMessageMeta) {
      if (mMeta.gameId !== gameId || mMeta.dcName !== targetDcName || mMeta.playerNum !== meta.playerNum) continue;
      targetMsgId = mId;
      break;
    }
    if (choice === 'heal') {
      if (targetMsgId) {
        const fkMatch = targetFk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        healHp(dcHealthState, game, targetMsgId, figIdx, 1, meta.playerNum);
      }
      await interaction.message.edit({ content: `**Trusted Ally** — **${targetDcName}** recovered **1 Damage**.`, components: [] }).catch(discordCatch);
    } else {
      filterCondition(game, targetFk, choice);
      await interaction.message.edit({ content: `**Trusted Ally** — **${targetDcName}** discarded **${choice}**.`, components: [] }).catch(discordCatch);
    }
    delete game.pendingTrustedAlly;
    await logGameAction?.(game, client, `**Trusted Ally** — ${targetDcName}: ${choice === 'heal' ? 'recovered 1 Damage' : 'discarded ' + choice}.`, { phase: 'ACTIVATION', icon: 'activate' });
  // --- Imperial Retrofitting (I48): exhaust for multi-attack/move, deplete for Focus ---
  } else if (ability === 'impretro') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Imperial Retrofitting** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice is 'multiattack_<irMsgId>', 'move_<irMsgId>', or 'focus_<irMsgId>'
      const _irParts = choice.split('_');
      const _irAction = _irParts[0]; // 'multiattack', 'move', or 'focus'
      const _irCardMsgId = _irParts.slice(1).join('_'); // the IR card's msgId
      if (_irAction === 'multiattack') {
        // Exhaust Imperial Retrofitting
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[_irCardMsgId] = game.exhaustedSkirmishUpgrades[_irCardMsgId] || [];
        if (!game.exhaustedSkirmishUpgrades[_irCardMsgId].includes('Imperial Retrofitting')) {
          game.exhaustedSkirmishUpgrades[_irCardMsgId].push('Imperial Retrofitting');
        }
        // Allow multiple attacks this activation for the vehicle
        game.imperialRetrofittingMultiAttack = game.imperialRetrofittingMultiAttack || {};
        game.imperialRetrofittingMultiAttack[msgId] = true;
        await interaction.message.edit({ content: `**Imperial Retrofitting** — Exhausted. **${displayName}** may perform **multiple attacks** this activation.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Retrofitting** exhausted — **${displayName}** may perform multiple attacks this activation.`, { phase: 'ACTIVATION', icon: 'card' });
        // After exhaust, offer deplete for Focus if card is not yet depleted
        const _irStillAvailable = !(game.p1DepletedDcMessageIds || []).includes(_irCardMsgId) && !(game.p2DepletedDcMessageIds || []).includes(_irCardMsgId);
        if (_irStillAvailable) {
          const _irFocusBtns = [
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_focus_${_irCardMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          ];
          await interaction.channel.send({ content: `**Imperial Retrofitting** — Also deplete for **Focus** before declaring an attack?`, components: [new ActionRowBuilder().addComponents(_irFocusBtns)] }).catch(discordCatch);
        }
      } else if (_irAction === 'move') {
        // Exhaust Imperial Retrofitting
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[_irCardMsgId] = game.exhaustedSkirmishUpgrades[_irCardMsgId] || [];
        if (!game.exhaustedSkirmishUpgrades[_irCardMsgId].includes('Imperial Retrofitting')) {
          game.exhaustedSkirmishUpgrades[_irCardMsgId].push('Imperial Retrofitting');
        }
        // Grant Speed MP to the vehicle
        const _irSpeed = ctx.getDcStats?.(meta.dcName)?.speed ?? 4;
        game.movementBank = game.movementBank || {};
        if (!game.movementBank[msgId]) {
          game.movementBank[msgId] = { total: _irSpeed, remaining: _irSpeed, threadId: interaction.channel?.id, messageId: null, displayName: displayName };
        } else {
          game.movementBank[msgId].total += _irSpeed;
          game.movementBank[msgId].remaining += _irSpeed;
        }
        await interaction.message.edit({ content: `**Imperial Retrofitting** — Exhausted. **${displayName}** performs a move (**${_irSpeed} MP**).`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Retrofitting** exhausted — **${displayName}** gains ${_irSpeed} MP (performs a move).`, { phase: 'ACTIVATION', icon: 'card' });
        // After exhaust, offer deplete for Focus if card is not yet depleted
        const _irStillAvailable = !(game.p1DepletedDcMessageIds || []).includes(_irCardMsgId) && !(game.p2DepletedDcMessageIds || []).includes(_irCardMsgId);
        if (_irStillAvailable) {
          const _irFocusBtns = [
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_focus_${_irCardMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          ];
          await interaction.channel.send({ content: `**Imperial Retrofitting** — Also deplete for **Focus** before declaring an attack?`, components: [new ActionRowBuilder().addComponents(_irFocusBtns)] }).catch(discordCatch);
        }
      } else if (_irAction === 'focus') {
        // Deplete Imperial Retrofitting — mark as depleted
        if (meta.playerNum === 1) {
          game.p1DepletedDcMessageIds = game.p1DepletedDcMessageIds || [];
          if (!game.p1DepletedDcMessageIds.includes(_irCardMsgId)) game.p1DepletedDcMessageIds.push(_irCardMsgId);
        } else {
          game.p2DepletedDcMessageIds = game.p2DepletedDcMessageIds || [];
          if (!game.p2DepletedDcMessageIds.includes(_irCardMsgId)) game.p2DepletedDcMessageIds.push(_irCardMsgId);
        }
        // Apply Focus to the vehicle figure
        const _irDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _irFigKey = `${meta.dcName}-${_irDgIdx}-0`;
        applyCondition(game, _irFigKey, 'Focus');
        await interaction.message.edit({ content: `**Imperial Retrofitting** — Depleted. **${displayName}** becomes **Focused**.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Retrofitting** depleted — **${displayName}** becomes Focused.`, { phase: 'ACTIVATION', icon: 'card' });
      }
    }
  } else if (ability === 'citadel') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `**Imperial Citadel** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice is 'token_<type>' e.g. 'token_focus', 'token_block'
      const _icType = choice.replace('token_', '');
      const _icTokens = game.imperialCitadelTokens || {};
      if ((_icTokens[_icType] || 0) > 0) {
        _icTokens[_icType]--;
        game.imperialCitadelTokens = _icTokens;
        const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const fk = `${meta.dcName}-${dgIndex}-0`;
        grantPowerTokens(game, fk, _icType.charAt(0).toUpperCase() + _icType.slice(1), 1);
        await interaction.message.edit({ content: `**Imperial Citadel** — **${displayName}** gained 1 **${_icType.charAt(0).toUpperCase() + _icType.slice(1)} Token** from the Citadel.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Citadel** — **${displayName}** gained 1 ${_icType.charAt(0).toUpperCase() + _icType.slice(1)} Token from the Citadel.`, { phase: 'ACTIVATION', icon: 'card' });
        if (game.pendingPowerTokenOverflow?.length > 0) {
          await sendPowerTokenOverflowUI(game, gameId, interaction.channel, meta.playerNum, saveGames);
        }
      } else {
        await interaction.message.edit({ content: `**Imperial Citadel** — No ${_icType} tokens remaining.`, components: [] }).catch(discordCatch);
      }
    }
  } else if (ability === 'unstabledev') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🔧 **Unstable Devices** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice = figureKey
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      game.deviceTokens = game.deviceTokens || {};
      game.deviceTokens[targetFk] = (game.deviceTokens[targetFk] || 0) + 1;
      game.unstableDevicesUsedThisActivation = game.unstableDevicesUsedThisActivation || {};
      game.unstableDevicesUsedThisActivation[msgId] = true;
      await interaction.message.edit({ content: `🔧 **Unstable Devices** — **${targetDcName}** gains **1 Device token** (now ${game.deviceTokens[targetFk]}).`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `🔧 **Unstable Devices** — **${targetDcName}** gains 1 Device token (now ${game.deviceTokens[targetFk]}).`, { phase: 'ACTIVATION', icon: 'activate' });
    }
  } else if (ability === 'droidkit') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🤖 **Droid Kit** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const tokenMap = { hit: 'Hit', surge: 'Surge', block: 'Block', evade: 'Evade' };
      const tokenType = tokenMap[choice];
      if (tokenType) {
        const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const fk = `${meta.dcName}-${dgIndex}-0`;
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
        const cap = getMaxPowerTokens(fk);
        if (game.figurePowerTokens[fk].length < cap) {
          game.figurePowerTokens[fk].push(tokenType);
          await interaction.message.edit({ content: `🤖 **Droid Kit** — **${displayName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(discordCatch);
          await logGameAction?.(game, client, `🤖 **Droid Kit** — **${displayName}** gained 1 ${tokenType} Token.`, { phase: 'ACTIVATION', icon: 'activate' });
        } else {
          await interaction.message.edit({ content: `🤖 **Droid Kit** — **${displayName}** is at max Power Tokens (${cap}). No token gained.`, components: [] }).catch(discordCatch);
        }
      }
    }
  // --- Conspire (Senator form): distribute Focus tokens to friendlies within 1 space ---
  } else if (ability === 'conspire') {
    if (choice === 'skip') {
      delete game.pendingConspire;
      await interaction.message.edit({ content: `🗣️ **Conspire** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[targetFk] = game.figurePowerTokens[targetFk] || [];
      const cap = getMaxPowerTokens(targetFk);
      if (game.figurePowerTokens[targetFk].length < cap) {
        game.figurePowerTokens[targetFk].push('Hit');
        await interaction.message.edit({ content: `🗣️ **Conspire** — **${targetDcName}** gained **1 Focus (Hit) Token**.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `🗣️ **Conspire** — **${targetDcName}** gained 1 Focus (Hit) Token.`, { phase: 'ACTIVATION', icon: 'activate' });
      } else {
        await interaction.message.edit({ content: `🗣️ **Conspire** — **${targetDcName}** is at max tokens (${cap}). No token gained.`, components: [] }).catch(discordCatch);
      }
      // If more tokens to distribute, show picker again
      if (game.pendingConspire) {
        game.pendingConspire.tokensRemaining = (game.pendingConspire.tokensRemaining || 1) - 1;
        if (game.pendingConspire.tokensRemaining > 0) {
          const _conFk = game.pendingConspire.senderFk;
          const _conPos = game.figurePositions?.[meta.playerNum]?.[_conFk];
          if (_conPos) {
            const { getMapSpaces: _gms } = await import('../data-loader.js');
            const _conMs = _gms(game.selectedMap?.id);
            const _conAdj = (_conMs?.adjacency?.[String(_conPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
            const _conFriendlies = Object.entries(game.figurePositions?.[meta.playerNum] || {})
              .filter(([fk2, pos2]) => fk2 !== _conFk && pos2 && _conAdj.includes(String(pos2).toLowerCase()));
            if (_conFriendlies.length > 0) {
              const btns = _conFriendlies.slice(0, 4).map(([fk2]) =>
                new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
              );
              btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_skip`).setLabel('Done').setStyle(ButtonStyle.Secondary));
              const thread = interaction.channel;
              await thread.send({ content: `🗣️ **Conspire** — ${game.pendingConspire.tokensRemaining} Focus token(s) remaining. Choose a figure:`, components: [new ActionRowBuilder().addComponents(btns)] }).catch(discordCatch);
              saveGames();
              return;
            }
          }
        }
        delete game.pendingConspire;
      }
    }
  // --- Shields Up (Soldier form): place energy shield in adjacent space ---
  } else if (ability === 'shieldsup') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🛡️ **Shields Up** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const space = choice.toLowerCase();
      game.ancillaryTokens = game.ancillaryTokens || {};
      game.ancillaryTokens.energyShield = game.ancillaryTokens.energyShield || [];
      game.ancillaryTokens.energyShield.push(space);
      // Track as special action for CC purposes
      game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
      game.specialActionUsedThisActivation[msgId] = (game.specialActionUsedThisActivation[msgId] || 0) + 1;
      await interaction.message.edit({ content: `🛡️ **Shields Up** — Energy shield placed at **${space.toUpperCase()}**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `🛡️ **Shields Up** — Energy shield placed at **${space.toUpperCase()}**.`, { phase: 'ACTIVATION', icon: 'activate' });
    }
  } else if (ability === 'companionbefore') {
    // Player chose to activate companion BEFORE the main group
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    if (_compInfo) {
      game.companionActivatedBefore = game.companionActivatedBefore || {};
      game.companionActivatedBefore[msgId] = 'before';
      const _compSummary = formatCompanionStats(_compInfo.companionName, _compInfo.companionStats);
      await interaction.message.edit({
        content: `🐾 **${_compInfo.companionName} activates NOW** (before **${displayName}**).\nPerform the companion's activation (move, attack, special actions) manually, then continue with **${meta.dcName}**'s activation.\n\n${_compSummary}`,
        components: [],
      }).catch(discordCatch);
      await logGameAction?.(game, client, `🐾 **${_compInfo.companionName}** activates **before** **${displayName}**.`, { phase: 'ACTIVATION', icon: 'activate' });
    }
  } else if (ability === 'companionafter') {
    // Player chose to skip — companion will activate after the main group's activation ends
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    if (_compInfo) {
      game.companionActivatedBefore = game.companionActivatedBefore || {};
      game.companionActivatedBefore[msgId] = 'pending-after'; // Will activate at end
      await interaction.message.edit({
        content: `🐾 **${_compInfo.companionName}** will activate **after** **${displayName}**'s activation ends.`,
        components: [],
      }).catch(discordCatch);
    }
  }
  saveGames();
}

/**
 * Handle field_tactics_pick_ — player chose a figure (or skip) for Field Tactics interrupt attack.
 * Button format: field_tactics_pick_{gameId}_{triggerMsgId}_{figureKey|skip}
 */
export async function handleFieldTacticsPick(interaction, ctx) {
  const { getGame, dcMessageMeta, logGameAction, saveGames, client } = ctx;
  const parts = interaction.customId.replace('field_tactics_pick_', '').split('_');
  // Format: gameId_triggerMsgId_figureKey (figureKey may contain underscores — but figure keys use hyphens)
  // Actually: gameId and triggerMsgId are snowflake-like, figureKey is the rest
  const gameId = parts[0];
  const triggerMsgId = parts[1];
  const chosenValue = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (chosenValue === 'skip') {
    await interaction.message.edit({ content: '**Field Tactics** — Skipped.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }
  const figureKey = chosenValue;
  const triggerMeta = dcMessageMeta.get(triggerMsgId);
  if (!triggerMeta) {
    await interaction.followUp({ content: '**Field Tactics** — Could not resolve trigger DC.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const findDcMsgIdForFigure = ctx.findDcMessageIdForFigure;
  const chosenMsgId = findDcMsgIdForFigure ? findDcMsgIdForFigure(gameId, triggerMeta.playerNum, figureKey) : null;
  if (chosenMsgId) {
    game.pendingFieldTactics = { forMsgId: chosenMsgId, chosenFigureKey: figureKey, triggeredByMsgId: triggerMsgId };
  }
  const ftRoundKey = `fieldTactics_${triggerMsgId}`;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[ftRoundKey] = true;
  const chosenName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({ content: `**Field Tactics** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Field Tactics** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.`, { phase: 'ROUND', icon: 'activate' });
  saveGames();
}

/**
 * Handle Force Vision pick: opponent chooses which of their groups must activate next.
 * Button prefix: fv_pick_{gameId}_{oppPlayerNum}_{dcIndex}
 */
export async function handleForceVisionPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, logGameAction, saveGames, client } = ctx;
  const match = interaction.customId.match(/^fv_pick_([^_]+)_(\d+)_(\d+)$/);
  if (!match) return;
  const [, gameId, oppNumStr, dcIndexStr] = match;
  const oppNum = parseInt(oppNumStr, 10);
  const dcIndex = parseInt(dcIndexStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const clickerId = interaction.user.id;
  if (!canActAsPlayer(game, clickerId, oppNum)) {
    await interaction.followUp({ content: 'Only the affected player can pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const dcList = getDcList(game, oppNum) || [];
  const dc = dcList[dcIndex];
  if (!dc) {
    await interaction.followUp({ content: 'Group not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const displayName = dc.displayName || dc.dcName;
  // Store the forced activation and clear the pending flag
  game.forceVisionNextActivation = { playerNum: oppNum, dcName: dc.dcName };
  game.forceVisionPending = null;
  // Remove buttons from message
  await interaction.message.edit({
    content: `👁️ **Force Vision** — <@${clickerId}> chose **${displayName}**. That group must be activated next, if possible.`,
    components: [],
    allowedMentions: { users: [] },
  }).catch(discordCatch);
  await logGameAction(game, client, `👁️ **Force Vision** — **${displayName}** must be activated next by Player ${oppNum}, if possible.`, { phase: 'ROUND', icon: 'activate' });
  saveGames();
}

/**
 * Heroic Effort: player picks a CC from hand to place on bottom of deck.
 */
export async function handleHeroicEffortReturn(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('heroic_effort_return_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const cardIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingHeroicEffortReturn?.[playerNum]) {
    await interaction.followUp({ content: 'No Heroic Effort return pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const hKey = ccHandKey(playerNum);
  const dKey = ccDeckKey(playerNum);
  const hand = game[hKey] || [];
  if (cardIdx < 0 || cardIdx >= hand.length) {
    await interaction.followUp({ content: 'Invalid card selection.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const cardName = hand[cardIdx];
  hand.splice(cardIdx, 1);
  game[hKey] = hand;
  game[dKey] = [...(game[dKey] || []), cardName];
  delete game.pendingHeroicEffortReturn[playerNum];
  if (Object.keys(game.pendingHeroicEffortReturn).length === 0) delete game.pendingHeroicEffortReturn;
  await interaction.message.edit({
    content: `**Heroic Effort** — Placed **${cardName}** on the bottom of your deck.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client, `**Heroic Effort** — P${playerNum} returned 1 Command card to deck bottom.`, { phase: 'ROUND', icon: 'card' });
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client);
  saveGames();
}

/**
 * Scavenged Weaponry: player picks which friendly Droid/Vehicle to transfer the attachment to.
 */
export async function handleScavWeaponTransfer(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = interaction.customId.replace('scav_weapon_transfer_', '').split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const targetIdx = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingScavengedWeaponryTransfer;
  if (!pending || pending.playerNum !== playerNum) {
    await interaction.followUp({ content: 'No Scavenged Weaponry transfer pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const target = pending.eligible[targetIdx];
  if (!target) {
    await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attKey = playerNum === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
  game[attKey][target.msgId] = [...(game[attKey][target.msgId] || []), 'Scavenged Weaponry'];
  delete game.pendingScavengedWeaponryTransfer;
  await interaction.message.edit({
    content: `**Scavenged Weaponry** — Transferred to **${target.displayName}**.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client, `**Scavenged Weaponry** — Transferred to **${target.displayName}** after defeat.`, { phase: 'ROUND', icon: 'card' });
  saveGames();
}

/**
 * Handle sc_fig_pick_ — player picks target figure for Spectre Cell exhaust ability.
 * customId: sc_fig_pick_{gameId}_{activatingMsgId}_{figureKey|cancel}
 */
export async function handleScFigPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, dcMessageMeta, saveGames, logGameAction, client } = ctx;
  // Parse: sc_fig_pick_{gameId}_{activatingMsgId}_{rest}
  const full = interaction.customId.replace(/^sc_fig_pick_/, '');
  const firstUs = full.indexOf('_');
  const gameId = full.slice(0, firstUs);
  const rest = full.slice(firstUs + 1);
  const secondUs = rest.indexOf('_');
  const activatingMsgId = rest.slice(0, secondUs);
  const target = rest.slice(secondUs + 1);

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;

  if (target === 'cancel') {
    await interaction.message.edit({ content: '**[Spectre Cell]** — Cancelled.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }

  const meta = dcMessageMeta.get(activatingMsgId);
  if (!meta) return;

  const targetFk = target;
  const targetDcName = dcNameFromFigureKey(targetFk);

  // Exhaust Spectre Cell
  const dcList = getDcList(game, meta.playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, meta.playerNum) || [];
  for (let i = 0; i < dcList.length; i++) {
    if ((dcList[i]?.dcName || dcList[i]) === '[Spectre Cell]') {
      const scMsgId = dcMsgIds[i];
      if (scMsgId) {
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[scMsgId] = [...(game.exhaustedSkirmishUpgrades[scMsgId] || []), 'Spectre Cell'];
      }
      break;
    }
  }

  // Grant 2 MP to target figure — find target's msgId
  let targetMsgId = null;
  for (const [mId, mMeta] of dcMessageMeta) {
    if (mMeta.gameId !== gameId) continue;
    if (mMeta.dcName === targetDcName && mMeta.playerNum === meta.playerNum) {
      targetMsgId = mId;
      break;
    }
  }
  if (targetMsgId) {
    game.movementBank = game.movementBank || {};
    game.movementBank[targetMsgId] = game.movementBank[targetMsgId] || { total: 0, remaining: 0 };
    game.movementBank[targetMsgId].total += 2;
    game.movementBank[targetMsgId].remaining += 2;
  }

  await interaction.message.edit({
    content: `**[Spectre Cell]** — **${targetDcName}** gains 2 MP and may interrupt to perform an attack. (Exhausted)`,
    components: [],
  }).catch(discordCatch);
  await logGameAction?.(game, client, `**[Spectre Cell]** — ${targetDcName} gains 2 MP, may interrupt attack. (Exhausted)`, { phase: 'ACTIVATION', icon: 'card' });
  saveGames();
}

/**
 * Hair Trigger: use interrupt attack
 */
export async function handleHairTriggerUse(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // hair_trigger_use_{gameId}_{htMsgId}_{figureKey}
  const suffix = interaction.customId.replace('hair_trigger_use_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const htMsgId = parts[1];
  const figureKey = parts.slice(2).join('_');
  const game = getGame(gameId);
  if (!game) return;
  const htOwnerPN = game.figurePositions?.[1]?.[figureKey] ? 1 : (game.figurePositions?.[2]?.[figureKey] ? 2 : null);
  if (!htOwnerPN) return;
  if (interaction.user.id !== getPlayerId(game, htOwnerPN)) return;
  const htKey = `hairTrigger_${figureKey}`;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[htKey] = true;
  // Grant free attack
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[htMsgId] = true;
  const htDcName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await interaction.followUp({
    content: `**Hair Trigger** — **${htDcName}** interrupts! Use the **Attack** button on your DC card to perform a free attack.`,
  }).catch(discordCatch);
  await logGameAction(game, client, `**Hair Trigger** — **${htDcName}** interrupts to perform a free attack.`, { phase: 'ACTIVATION', icon: 'attack' });
  saveGames();
}

/**
 * Hair Trigger: skip
 */
export async function handleHairTriggerSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // hair_trigger_skip_{gameId}_{figureKey}
  const suffix = interaction.customId.replace('hair_trigger_skip_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const game = getGame(gameId);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (game) saveGames();
}

/**
 * It Will Be Alright: Use — show figure picker for friendly figures within 2 spaces to sacrifice.
 */
export async function handleItWillBeAlrightUse(interaction, ctx) {
  const { getGame, dcMessageMeta, dcHealthState, saveGames, logGameAction, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // iwba_use_{gameId}_{msgId}
  const m = interaction.customId.match(/^iwba_use_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta?.get(msgId);
  if (!meta) return;
  const displayName = meta.displayName || meta.dcName;

  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const selfFk = `Cassian Andor-${dgIndex}-0`;
  const selfPos = game.figurePositions?.[meta.playerNum]?.[selfFk];
  const _getRange = ctx.getRange || getRange;

  // Find eligible targets within 2 spaces
  const targets = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[meta.playerNum] || {})) {
    if (!pos || fk === selfFk) continue;
    if (_getRange(selfPos, pos) > 2) continue;
    const fkDcName = dcNameFromFigureKey(fk);
    const fkMsgId = ctx.findDcMessageIdForFigure(gameId, meta.playerNum, fk);
    if (!fkMsgId) continue;
    const fkMatch = fk.match(/-(\d+)-(\d+)$/);
    const fkFigIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
    const fkEntry = dcHealthState?.get(fkMsgId)?.[fkFigIdx];
    if (!fkEntry || !Array.isArray(fkEntry)) continue;
    const [fkCur, fkMax] = fkEntry;
    if ((fkMax ?? 0) === 0 || ((fkCur ?? fkMax ?? 0) <= 0)) continue;
    targets.push({ figureKey: fk, dcName: fkDcName, msgId: fkMsgId, figIdx: fkFigIdx });
  }

  if (targets.length === 0) {
    await interaction.message.edit({ content: '**It Will Be Alright** — No eligible friendly figures within 2 spaces.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }

  // Store pending state
  game.pendingItWillBeAlright = {
    cassianMsgId: msgId,
    playerNum: meta.playerNum,
    targets: targets.map(t => ({ figureKey: t.figureKey, dcName: t.dcName, msgId: t.msgId, figIdx: t.figIdx })),
  };

  const btns = targets.slice(0, 20).map(t =>
    new ButtonBuilder()
      .setCustomId(`iwba_pick_${gameId}_${t.figureKey}`)
      .setLabel(t.dcName.replace(/_/g, ' '))
      .setStyle(ButtonStyle.Danger)
  );
  const rows = [];
  while (btns.length > 0) rows.push(new ActionRowBuilder().addComponents(btns.splice(0, 5)));

  await interaction.message.edit({
    content: `**It Will Be Alright** — Choose a friendly figure to sacrifice:`,
    components: rows.slice(0, 5),
  }).catch(discordCatch);
  saveGames();
}

/**
 * It Will Be Alright: Skip
 */
export async function handleItWillBeAlrightSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^iwba_skip_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId] = m;
  const game = getGame(gameId);
  await interaction.message.edit({ content: '**It Will Be Alright** — Skipped.', components: [] }).catch(discordCatch);
  if (game) {
    delete game.pendingItWillBeAlright;
    saveGames();
  }
}

/**
 * It Will Be Alright: Pick — defeat chosen figure, then offer free move or attack.
 */
export async function handleItWillBeAlrightPick(interaction, ctx) {
  const { getGame, dcMessageMeta, dcHealthState, saveGames, logGameAction, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // iwba_pick_{gameId}_{figureKey}
  const m = interaction.customId.match(/^iwba_pick_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, figureKey] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;

  const pending = game.pendingItWillBeAlright;
  if (!pending) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }

  const target = pending.targets.find(t => t.figureKey === figureKey);
  if (!target) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }

  const { dcName: targetDcName, msgId: targetMsgId, figIdx: targetFigIdx } = target;
  const playerNum = pending.playerNum;
  const oppNum = opponentPlayerNum(playerNum);

  // Defeat the figure: set HP to 0
  const hs = dcHealthState?.get(targetMsgId);
  if (hs?.[targetFigIdx] && Array.isArray(hs[targetFigIdx])) {
    hs[targetFigIdx] = [0, hs[targetFigIdx][1]];
  }

  // Remove from board
  removeFigurePosition(game, playerNum, figureKey);

  // Award VP to opponent
  const dcEff = getDcEffects()?.[targetDcName];
  const isCompanion = dcEff?.companion === true;
  if (!isCompanion) {
    const stats = getDcStats(targetDcName);
    const vp = stats?.cost ?? 0;
    if (vp > 0) awardKillVp(game, oppNum, vp);
    await logGameAction(game, client, `**It Will Be Alright** — **${targetDcName}** is sacrificed and defeated! (+${vp} VP to P${oppNum})`, { phase: 'ACTIVATION', icon: 'attack' });
  } else {
    await logGameAction(game, client, `**It Will Be Alright** — **${targetDcName}** (companion) is sacrificed and defeated!`, { phase: 'ACTIVATION', icon: 'attack' });
  }

  // Offer free move or attack
  const cassianMsgId = pending.cassianMsgId;
  const cassianMeta = dcMessageMeta?.get(cassianMsgId);
  const cassianDisplay = cassianMeta?.displayName || 'Cassian Andor';

  game.pendingItWillBeAlright = { ...pending, phase: 'action', sacrificed: targetDcName };

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`iwba_action_${gameId}_${cassianMsgId}_move`).setLabel('Free Move').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`iwba_action_${gameId}_${cassianMsgId}_attack`).setLabel('Free Attack').setStyle(ButtonStyle.Danger),
  );

  await interaction.message.edit({
    content: `**It Will Be Alright** — **${targetDcName}** defeated. **${cassianDisplay}** may perform a free move or attack:`,
    components: [actionRow],
  }).catch(discordCatch);
  saveGames();
}

/**
 * It Will Be Alright: Action — grant free move or attack to Cassian.
 */
export async function handleItWillBeAlrightAction(interaction, ctx) {
  const { getGame, dcMessageMeta, saveGames, logGameAction, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // iwba_action_{gameId}_{cassianMsgId}_{move|attack}
  const m = interaction.customId.match(/^iwba_action_([^_]+)_([^_]+)_(move|attack)$/);
  if (!m) return;
  const [, gameId, cassianMsgId, actionType] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;

  const cassianMeta = dcMessageMeta?.get(cassianMsgId);
  const cassianDisplay = cassianMeta?.displayName || 'Cassian Andor';

  if (actionType === 'move') {
    // Grant Cassian's speed as movement points
    const cassianStats = getDcStats('Cassian Andor');
    const speed = cassianStats?.speed ?? 4;
    game.movementBank = game.movementBank || {};
    game.movementBank[cassianMsgId] = game.movementBank[cassianMsgId] || { total: 0, remaining: 0 };
    game.movementBank[cassianMsgId].total += speed;
    game.movementBank[cassianMsgId].remaining += speed;
    await interaction.message.edit({
      content: `**It Will Be Alright** — **${cassianDisplay}** gains **${speed} MP** (free move).`,
      components: [],
    }).catch(discordCatch);
    await logGameAction(game, client, `**It Will Be Alright** — **${cassianDisplay}** gains ${speed} MP (free move after sacrifice).`, { phase: 'ACTIVATION', icon: 'move' });
  } else {
    // Grant free attack
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[cassianMsgId] = true;
    await interaction.message.edit({
      content: `**It Will Be Alright** — **${cassianDisplay}** may perform a free attack. Use the **Attack** button.`,
      components: [],
    }).catch(discordCatch);
    await logGameAction(game, client, `**It Will Be Alright** — **${cassianDisplay}** gains a free attack (after sacrifice).`, { phase: 'ACTIVATION', icon: 'attack' });
  }

  delete game.pendingItWillBeAlright;
  saveGames();
}
