/**
 * Activation handlers: status_phase_, pass_activation_turn_, end_turn_, confirm_activate_, cancel_activate_
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getCcEffectsData, getDcEffects, getMapData, getFigureSize, getDeploymentZones, getDcStats, getLoadoutCards, getFormCards } from '../data-loader.js';
import { finalizeActivation, getCompanionForDc, formatCompanionStats, getPairedActiveMsgId, getCompanionMsgIdForHost } from '../engine/activation-setup.js';
import { applyEndOfActivationEffects } from '../engine/activation-effects.js';
import { clearPendingTokenDistribution, setPendingItWillBeAlright, clearPendingItWillBeAlright, clearPendingGeneralsOrders, clearPendingConspire, setPendingDurasteelFistPush, setPendingWookSlamPush, clearPendingWookSlamPush, setPendingTrustedAlly, clearPendingTrustedAlly, setPendingMotivation, clearPendingMotivation, setPendingLieInAmbush, clearPendingLieInAmbush, clearPendingScavengedWeaponryTransfer } from '../game/interrupts.js';
import { isFigurelessDc } from '../game/dc-helpers.js';
import { filterValidTopLeftSpaces } from '../engine/utils.js';
import { parseCoord } from '../game/coords.js';
import { cleanupActivation, isActivationActionInProgress, describeActivationActionInProgress, figureKeyForActivation } from '../game/activation-state.js';
import { discardOpenMoveGrids } from './movement.js';
import { applyCondition, filterCondition, dcNameFromFigureKey, parseFigureKey, reduceHp, healHp, getMaxPowerTokens, grantPowerTokens, grantMovementBank, figureChoiceLabels, isConditionImmune, HARMFUL_CONDITIONS } from '../game/index.js';
import { applyObjectDamageSync } from '../game/object-damage-pipeline.js';
import { awardObjectiveVp } from '../game/vp-helpers.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { getValidPushDestinations } from '../game/movement.js';
import { getAllFigureCoords } from '../game/spatial.js';
import { countGameSpaces } from '../game/board-helpers.js';
import { isFieldTacticsDc, fieldTacticsRoundKey, enumerateFieldTacticsTargets } from '../game/field-tactics-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { getFootprintCells } from '../game/coords.js';
import { getDiceData, getDcKeywords, dcAbilityFlags } from '../data-loader.js';
import { setRoundPhase, ROUND_PHASES } from '../game/phase.js';
import { setPendingLoadoutSelection } from '../game/interrupts.js';
import { getFormsChosenByTeamClawdites } from '../game/figure-config.js';
import { sendPowerTokenOverflowUI } from './combat.js';
import { exhaustAttachment, depleteDc, isDcDepleted } from '../game/card-state-helpers.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';
import { refreshHandAndDiscard } from '../engine/message-updaters.js';
import { releaseSmugglingCompartmentSetAside } from '../game/smuggling-compartment.js';
import {
  getPlayerId,
  getDcList,
  getDcMessageIds,
  getPlayAreaId,
  getHandChannelId,
  getActivationsRemaining,
  getActivatedDcIndices,
  getCcHand,
  setActivatedDcIndices,
  recomputeActivationCounts,
  ccDeckKey,
  ccDiscardKey,
  ccHandKey,
  opponentPlayerNum,
  getInitiativePlayerNum,
  pushFigure,
} from '../game/player-helpers.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows, truncateLabel } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';

/**
 * Determine the companion (if any) for a given DC, considering both
 * direct companion fields (e.g. Iden Versio → Dio) and attachment-based
 * companions (e.g. [Clan of Two] → The Child, [Indentured Jester] → Salacious B. Crumb).
 * Returns { companionName, companionStats, isCoActivation } or null.
 * isCoActivation is true for Junk Droid (Ugnaught) which co-activates rather than before/after.
 */

// getCompanionForDc and formatCompanionStats moved to ../engine/activation-setup.js

/**
 * Field Tactics (Death Trooper Elite/Regular). Card text: "After your
 * activation, you may immediately ACTIVATE a friendly TROOPER or LEADER group
 * with cost 6 or less. That group loses 'Field Tactics' this round."
 *
 * Per the 2026-06 audit this is an immediate ACTIVATION grant, not a free
 * interrupt attack. The chosen group is activated now (out of normal turn
 * order) through the standard activation flow — modelled on Squad Swarm: set
 * an activation-grant flag + chosen target, then prompt the owner to click the
 * group's card to begin. (The legacy `pendingFieldTactics` free-attack path was
 * deleted 2026-06-18 — Field Tactics is purely an activation grant now.)
 *
 * @param {object} game
 * @param {object} meta - dcMessageMeta entry for the activating DC
 * @param {string} dcMsgId - DC message ID that just finished activating
 * @param {Function} logGameAction
 * @param {object} client
 * @param {Function} findDcMsgIdForFigure - (gameId, playerNum, figureKey) => msgId | null
 */
async function maybePromptFieldTactics(game, meta, dcMsgId, logGameAction, client, findDcMsgIdForFigure) {
  if (!isFieldTacticsDc(meta.dcName)) return;
  // Guard: limit once per round per group
  const ftRoundKey = fieldTacticsRoundKey(dcMsgId);
  if (game.roundFigureAbilityUsed?.[ftRoundKey]) return;
  const validTargets = enumerateFieldTacticsTargets(game, meta, getDcEffects());
  if (validTargets.length === 0) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  const gameId = game.gameId;
  if (validTargets.length === 1) {
    // Auto-select the only eligible group and grant its immediate activation.
    const chosenFk = validTargets[0];
    const chosenMsgId = findDcMsgIdForFigure ? findDcMsgIdForFigure(gameId, meta.playerNum, chosenFk) : null;
    grantFieldTacticsActivation(game, meta.playerNum, chosenMsgId);
    const chosenName = dcNameFromFigureKey(chosenFk);
    await logGameAction(game, client, `<@${ownerId}> **Field Tactics** — **${chosenName}**'s group may **immediately activate** now (it loses Field Tactics this round). Click its card to begin.`, {
      phase: 'ROUND', icon: 'activate', allowedMentions: { users: [ownerId] },
    });
    return;
  }
  // Multiple targets — show picker buttons (one per eligible group figure).
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
  const rows = chunkButtonsToRows(btns);
  await logGameAction(game, client, `<@${ownerId}> **Field Tactics** — Choose a friendly TROOPER/LEADER group (cost ≤6) within 2 spaces to **immediately activate**:`, {
    components: rows,
    allowedMentions: { users: [ownerId] },
  });
}

/**
 * Record the Field Tactics immediate-activation grant + spend the round-once
 * guard. Mirrors the Squad Swarm flag (`squadSwarmPlayerNum`): the chosen
 * group activates through the normal activation flow on the next card click.
 */
function grantFieldTacticsActivation(game, playerNum, chosenMsgId) {
  game.fieldTacticsActivationPlayerNum = playerNum;
  game.fieldTacticsActivationMsgId = chosenMsgId || null;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  // "That group loses Field Tactics this round" — lock the ACTIVATED group's
  // own key (alexanbv 2026-06-19), not the triggering Death Trooper's, so an
  // activated Field Tactics group cannot itself trigger Field Tactics this round.
  if (chosenMsgId) game.roundFigureAbilityUsed[fieldTacticsRoundKey(chosenMsgId)] = true;
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
  const gameId = parseCustomId(interaction.customId, 'status_phase_');
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
    const endBtn = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`status_phase_${gameId}`)
        .setLabel(`End R${round} Activation Phase`)
        .setStyle(ButtonStyle.Secondary)
    );
    await interaction.message.edit({
      content: `**Round ${round}** — End Activation Phase: ${game.p1ActivationPhaseEnded ? 'P1 ✅' : 'P1 ⏳'} | ${game.p2ActivationPhaseEnded ? 'P2 ✅' : 'P2 ⏳'}\nBoth players must click the button when done with activations and any end-of-activation effects.`,
      embeds: [],
      components: [endBtn],
    }).catch(discordCatch);
    saveGames(game.gameId);
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
  saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames
 */
export async function handlePassActivationTurn(interaction, ctx) {
  const { getGame, replyIfGameEnded, getPlayerZoneLabel, logGameAction, pushUndo, client, saveGames, repostRoundActivationMessage } = ctx;
  const gameId = parseCustomId(interaction.customId, 'pass_activation_turn_');
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
  const _otherWord = otherRem === 1 ? 'activation' : 'activations';
  const _myWord = myRem === 1 ? 'activation' : 'activations';
  const passLogMsg = await logGameAction(game, client, `<@${turnPlayerId}> passed the turn to <@${otherPlayerId}> (Player ${otherPlayerNum} has **${otherRem}** ${_otherWord} remaining; you have **${myRem}** ${_myWord}).`, { phase: 'ROUND', icon: 'activate', allowedMentions: { users: [otherPlayerId] } });
  pushUndo(game, {
    type: 'pass_turn',
    previousTurnPlayerId: turnPlayerId,
    gameLogMessageId: passLogMsg?.id,
    roundMessageId: game.roundActivationMessageId,
    roundContentBefore,
    gameId,
  });
  // Turn change → repost the activation prompt at the bottom so the new
  // turn-player sees it without scrolling past their action logs.
  await repostRoundActivationMessage?.(game, gameId, client);
  saveGames(game.gameId);
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
  setPendingLieInAmbush(game, { playerNum: liaOwnerNum, dcName });

  const gameId = game.gameId;
  const liaOwnerId = getPlayerId(game, liaOwnerNum);
  const handId = getHandChannelId(game, liaOwnerNum);

  try {
    const handChannel = await fetchGameChannel(client, handId);
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
 * Fire ONLY the "when deployed" abilities for a group deployed mid-round via
 * Lie in Ambush. Per the IACP timing rules, a LiA-deployed group resolves its
 * WHEN-DEPLOYED abilities but NOT its "after deployment" abilities (which only
 * trigger during the normal round-1 post-deploy phase).
 *
 * The three when-deployed abilities (docs/combat-spec.csv timing=when_deployed):
 *   - In The Shadows (ISB Infiltrator Elite): become Hidden — non-interactive,
 *     reuses applyCondition (same apply path as post-deploy.js's in_the_shadows).
 *   - Shape (Clawdite Shapeshifter): gain 1 Form card — interactive, posts the
 *     same form_pick_* picker the normal deploy flow does (setup.js).
 *   - Imperial Loadout (Purge Trooper Elite): gain 1 Loadout card — interactive,
 *     posts the same loadout_select_/loadout_confirm_ picker (setup.js).
 *
 * It deliberately does NOT fire after-deployment abilities (Cross Training,
 * Ambush, Smooth Landing, Beskar Armor, Security Detail, Infiltration, Strike
 * Team, Extra Armor, companions, etc.).
 *
 * @param {object} game
 * @param {number} playerNum
 * @param {string} dcName — the deployed card name
 * @param {string[]} figureKeys — the figure keys that were just placed
 * @param {object} ctx — handler ctx (logGameAction, saveGames, ...)
 * @param {import('discord.js').Client} client
 */
export async function fireLieInAmbushWhenDeployed(game, playerNum, dcName, figureKeys, ctx, client) {
  const { logGameAction, saveGames } = ctx;
  const dcEffects = getDcEffects() || {};
  const eff = dcEffects[dcName] || dcEffects[dcName?.replace(/\s*\(Elite\)\s*$/, '')];
  if (!eff) return;

  const passives = eff.passives || [];
  const sIds = eff.specialAbilityIds || [];
  // When-deployed keyword flags (In The Shadows / Ambush) may live in either
  // `passives` or `abilities` (2026-06-15 data split), so scan the union.
  const flags = dcAbilityFlags(eff);
  // Only consider figures that were actually placed on the board.
  const placedKeys = figureKeys.filter(fk => game.figurePositions?.[playerNum]?.[fk]);
  if (placedKeys.length === 0) return;

  // ── In The Shadows (non-interactive) — become Hidden ───────────────────────
  if (flags.includes('In The Shadows')) {
    for (const fk of placedKeys) applyCondition(game, fk, 'Hide');
    await logGameAction(game, client, `🥷 **In The Shadows** — **${dcName}** becomes **Hidden** when deployed.`, { phase: 'ROUND', icon: 'deployed' });
  }

  // ── Ambush (non-interactive) — Ewok Warrior becomes Hidden ─────────────────
  // Card text "After YOU are deployed, you become Hidden" is a PER-FIGURE
  // when-deployed trigger, so it fires on LiA — unlike phase-level "after
  // deployment" abilities (E-Web Forward Emplacement, Smooth Landing, Beskar
  // Armor, …) which do NOT. (alexanbv 2026-06-18: the CSV tags Ambush
  // after_deployment, but the card wording is the per-figure form.)
  if (flags.includes('Ambush')) {
    for (const fk of placedKeys) applyCondition(game, fk, 'Hide');
    await logGameAction(game, client, `🥷 **Ambush** — **${dcName}** becomes **Hidden** when deployed.`, { phase: 'ROUND', icon: 'deployed' });
  }

  // ── Imperial Loadout (interactive) — Purge Trooper gains 1 Loadout card ─────
  if (sIds.includes('imperial_loadout_purge_trooper')) {
    const loadoutCards = getLoadoutCards();
    const names = Object.keys(loadoutCards);
    const figureKey = placedKeys[0];
    if (names.length > 0) {
      setPendingLoadoutSelection(game, { figureKey, playerNum });
      const defaultName = names[0];
      const selectionRow = new ActionRowBuilder().addComponents(
        ...names.map((name) => new ButtonBuilder()
          .setCustomId(`loadout_select_${game.gameId}_${figureKey}_${name}`)
          .setLabel(name)
          .setStyle(name === defaultName ? ButtonStyle.Success : ButtonStyle.Primary))
      );
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`loadout_confirm_${game.gameId}_${figureKey}`)
          .setLabel('Confirm Selection')
          .setStyle(ButtonStyle.Success)
      );
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await fetchGameChannel(client, handId);
        await handChannel.send({
          content: `⚔️ **Imperial Loadout** — Choose a Loadout card for **${dcName}** (deployed via Lie in Ambush):`,
          components: [selectionRow, confirmRow],
        });
      } catch (err) {
        console.error('[Lie in Ambush] Failed to send loadout picker:', err.message);
      }
    }
  }

  // ── Shape (interactive) — Clawdite Shapeshifter gains 1 Form card ──────────
  const _shapeIds = ['shape_clawdite_elite', 'shape_clawdite_reg'];
  if (sIds.some(id => _shapeIds.includes(id))) {
    const formCards = getFormCards();
    const figureKey = placedKeys[0];
    const takenForms = getFormsChosenByTeamClawdites(game, playerNum, figureKey);
    const formNames = Object.keys(formCards).filter(n => !takenForms.has(n));
    if (formNames.length > 0) {
      const row = new ActionRowBuilder().addComponents(
        ...formNames.map((name) => new ButtonBuilder()
          .setCustomId(`form_pick_${game.gameId}_${figureKey}_${name}`)
          .setLabel(name)
          .setStyle(ButtonStyle.Primary))
      );
      try {
        const handId = getHandChannelId(game, playerNum);
        const handChannel = await fetchGameChannel(client, handId);
        await handChannel.send({
          content: `🔄 **Shape** — Choose a Form card for **${dcName}** (deployed via Lie in Ambush):`,
          components: [row],
        });
      } catch (err) {
        console.error('[Lie in Ambush] Failed to send form picker:', err.message);
      }
    }
  }

  if (saveGames) saveGames(game.gameId);
}

/**
 * Handle lia_deploy_zone_ button: deploy the set-aside group to chosen zone.
 */
export async function handleLiaDeployZone(interaction, ctx) {
  const { getGame, logGameAction, client, saveGames, updateActivationsMessage, updateRoundActivationMessage } = ctx;
  // customId: lia_deploy_zone_<gameId>_<playerNum>_<zone>
  const parts = splitCustomId(interaction.customId, 'lia_deploy_zone_');
  const zone = parts[parts.length - 1]; // red or blue
  const playerNum = parseInt(parts[parts.length - 2], 10);
  const gameId = parts.slice(0, -2).join('_');
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
  const ms = getMapData(mapId);
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

    // Check if figure is MOBILE or MASSIVE — those can deploy on blocking terrain
    const fkDcName = dcNameFromFigureKey(fk);
    const fkKeywords = getDcKeywords(game)?.[fkDcName] || [];
    const fkKwUpper = fkKeywords.map(k => String(k).toUpperCase());
    const ignoreBlocking = fkKwUpper.includes('MOBILE') || fkKwUpper.includes('MASSIVE');
    const validSpaces = filterValidTopLeftSpaces(zoneSpaces, currentOccupied, figureSize, getFootprintCells, blocking, ignoreBlocking);
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
  clearPendingLieInAmbush(game);

  // Recompute activation counts — LiA set-aside was cleared, figures now on board
  if (placed > 0) {
    recomputeActivationCounts(game, playerNum);
  }

  // alexanbv 2026-06-23: keep zone selection message (no delete) for traceability

  // Fire ONLY the group's WHEN-DEPLOYED abilities (In The Shadows → Hidden,
  // Clawdite Shape → form picker, Imperial Loadout → loadout config). A group
  // deployed via Lie in Ambush does NOT fire its "after deployment" abilities
  // (Cross Training, Ambush, Smooth Landing, companions, etc.) — those only
  // trigger during the normal round-1 post-deploy phase.
  if (placed > 0) {
    await fireLieInAmbushWhenDeployed(game, playerNum, dcName, setAsideKeys, ctx, client);
  }

  await logGameAction(game, client, `🎯 **Lie in Ambush** — **${dcName}** deployed ${placed} figure(s) to the **${zone}** zone!`, {
    phase: 'ROUND',
    icon: 'deploy',
  });

  saveGames(game.gameId);
  await updateActivationsMessage?.(game, playerNum, client);

  // Refresh round activation message — LiA deployment changes the activation balance
  if (placed > 0) await updateRoundActivationMessage?.(game, gameId, client);

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
    renderDcEmbed,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    updateRoundActivationMessage,
    repostRoundActivationMessage,
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
  // Gate: activation thread must be ended first (End Activation button in thread)
  if (game.dcActionsData?.[dcMsgId]) {
    await interaction.followUp({ content: 'Press **End Activation** in the activation thread first.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const otherPlayerNum = opponentPlayerNum(meta.playerNum);
  const otherPlayerId = getPlayerId(game, otherPlayerNum);
  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[dcMsgId] = true;
  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = dcMsgId;
  delete game.pendingEndTurn[dcMsgId];
  // alexanbv 2026-06-23: keep message (no delete) for traceability
  // Deterministic end-of-activation effects now handled by applyEndOfActivationEffects()
  // in handleDcEndActivation (shared with headless). Only choice-based effects remain here.

  // Trust Goes Both Ways (Jyn Erso): the end-of-activation branch is now a
  // PLAYER-CHOICE descriptor in the EoA orchestrator (subPromptKey
  // 'trust_both_ways_eoa', enumerated in src/game/eoa-orchestrator.js and
  // resolved in src/handlers/eoa-handler.js). The legacy ad-hoc prompt that
  // used to live here (`act_passive_..._trustboth_`) was REMOVED: it double-
  // wired the ability across two handlers with two different once-per-round
  // keys (per-figure here vs per-msgId in the orchestrator), so it could fire
  // twice. The single canonical key is now `trustBothWays_${msgId}`, shared
  // by both the SoA and EoA orchestrator branches.

  const actionsData = game.dcActionsData?.[dcMsgId];
  if (actionsData?.threadId) {
    try {
      const thread = await fetchGameChannel(client, actionsData.threadId);
      await thread.setArchived(true);
    } catch (err) {
      console.error('Failed to archive DC activation thread:', err);
    }
    if (game.dcActionsData?.[dcMsgId]) delete game.dcActionsData[dcMsgId];
    // next-attack bonuses: per-figure 2026-05-09 (multifigure-independent-
    // activation rule). cleanupActivation (called downstream) clears these
    // via ACTIVATION_FIGKEY_FLAGS, but this thread-archive path runs before
    // cleanupActivation, so sweep figureKeys for the DG here too.
    {
      const _etDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
      const _etPrefix = `${meta.dcName}-${_etDgIdx}-`;
      const _etFkSweep = Object.keys(game.figurePositions?.[meta.playerNum] || {})
        .filter((k) => k.startsWith(_etPrefix));
      for (const _efk of _etFkSweep) {
        if (game.nextAttacksBonusHits?.[_efk]) delete game.nextAttacksBonusHits[_efk];
        if (game.nextAttacksBonusConditions?.[_efk]) delete game.nextAttacksBonusConditions[_efk];
        if (game.nextAttackBonusSurgeAbilities?.[_efk]) delete game.nextAttackBonusSurgeAbilities[_efk];
        if (game.nextAttackBonusPierce?.[_efk]) delete game.nextAttackBonusPierce[_efk];
        if (game.nextAttackBonusAccuracy?.[_efk]) delete game.nextAttackBonusAccuracy[_efk];
        if (game.nextAttackReach?.[_efk]) delete game.nextAttackReach[_efk];
      }
    }
    if (game.movementBank?.[dcMsgId]) delete game.movementBank[dcMsgId];
  }
  await updateDcCardMessage(client, game, dcMsgId, ctx, { exhausted: true, errorContext: 'Failed to update DC card after End Turn:' });

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

  // Son of Skywalker now handled by applyEndOfActivationEffects() in handleDcEndActivation.

  game.currentActivationTurnPlayerId = otherPlayerId;
  await logGameAction(game, client, `<@${otherPlayerId}> (**Player ${otherPlayerNum}'s turn**) **${pending.displayName}** finished all actions — your turn to activate a figure!`, {
    allowedMentions: { users: [otherPlayerId] },
    phase: 'ROUND',
    icon: 'activate',
  });
  // Turn change → repost the activation prompt at the bottom so the new
  // turn-player sees it without scrolling. Repost handles activation vs
  // End-Phase variant routing internally.
  await repostRoundActivationMessage?.(game, gameId, client);
  // Field Tactics (Death Trooper): after activation, choose a friendly TROOPER/LEADER within 2 to perform a free attack
  await maybePromptFieldTactics(game, meta, dcMsgId, logGameAction, client, ctx.findDcMessageIdForFigure);
  // Lie in Ambush: after opponent activates, check if trigger fires
  await checkLieInAmbushTrigger(game, meta.playerNum, ctx);
  saveGames(game.gameId);
}

/**
 * Handle dc_switch_fig_ — "Switch Figure" button in multi-figure DG activation thread.
 * Deselects the current figure and shows the figure picker dropdown again.
 */
export async function handleDcSwitchFig(interaction, ctx) {
  const { getGame, dcMessageMeta, updateDcActionsMessage, saveGames, client } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_switch_fig_');
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'This DC is no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) {
    await interaction.followUp({ content: 'Only the owner can switch figures.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.dcActionsData?.[msgId]) {
    game.dcActionsData[msgId].selectedFigure = null;
  }
  saveGames(game.gameId);
  await updateDcActionsMessage(game, msgId, client);
}

/**
 * Handle dc_end_activation_ — red "End Activation" button on the DC card.
 * Immediately ends the current activation: deletes thread, cleans up state, pings opponent.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
/**
 * Clan of Two teleport (handler for clan_of_two_teleport_<gameId>_<hostMsgId>_<space>).
 * Pushes The Child to the chosen space (host's space or an adjacent space).
 * Per destruct 2026-05-07: teleport fires at host's END regardless of
 * companion-first / host-first order; this handler is invoked by clicking
 * the teleport button posted in handleDcEndActivation.
 */
export async function handleClanOfTwoTeleport(interaction, ctx) {
  const { getGame, dcMessageMeta, saveGames, logGameAction, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const suffix = parseCustomId(interaction.customId, 'clan_of_two_teleport_');
  const parts = suffix.split('_');
  if (parts.length < 3) { await interaction.followUp({ content: 'Invalid teleport.', ephemeral: true }).catch(discordCatch); return; }
  const gameId = parts[0];
  const space = parts[parts.length - 1];
  const hostMsgId = parts.slice(1, -1).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta?.get(hostMsgId);
  if (!meta) { await interaction.followUp({ content: 'Host DC no longer tracked.', ephemeral: true }).catch(discordCatch); return; }
  const ownerId = getPlayerId(game, meta.playerNum);
  if (interaction.user.id !== ownerId) { await interaction.followUp({ content: 'Only the host\'s owner may teleport The Child.', ephemeral: true }).catch(discordCatch); return; }
  let childFk = null;
  for (const fk of Object.keys(game.figurePositions?.[meta.playerNum] || {})) {
    if (fk.startsWith('The Child-')) { childFk = fk; break; }
  }
  if (!childFk) { await interaction.followUp({ content: 'The Child is not on the board.', ephemeral: true }).catch(discordCatch); return; }
  const result = pushFigure(game, meta.playerNum, childFk, space);
  if (!result) { await interaction.followUp({ content: 'Could not teleport The Child.', ephemeral: true }).catch(discordCatch); return; }
  await interaction.message.edit({ content: `\u{1F4AB} **Clan of Two** — **The Child** teleported from ${result.prevPos.toUpperCase()} to **${space.toUpperCase()}**.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `\u{1F4AB} **Clan of Two** — Child teleported to ${space.toUpperCase()}.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

export async function handleDcEndActivation(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    renderDcEmbed,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    getDcActionButtons,
    updateDcActionsMessage,
    client,
    saveGames,
  } = ctx;
  const msgId = parseCustomId(interaction.customId, 'dc_end_activation_');
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
  // Per alexanbv 2026-05-12: unspent MP / an open move grid must not
  // block End Activation. Discard any open move-grid state for this
  // msgId before the in-progress check — moveInProgress is just stale
  // UI once the player has signalled they're done. Combat, ability
  // target picks (non-movement pendingSpacePick), and SoA chooser
  // buckets still block as before.
  discardOpenMoveGrids(game, msgId);
  // The after-resolve close now clears game.pendingCombat itself on the live
  // "Done" click (after-attack-resolve.js _advanceFromSide → finishCombat
  // resolution → resolvePendingCombat), so a normal combat no longer leaves a
  // stale pendingCombat here. If one DOES linger (a genuine bug), surface it via
  // the Force-Clear button below rather than silently masking it (alexanbv
  // 2026-06-26: the auto-clear band-aid was removed once the root cause was fixed).
  const _blockReason = describeActivationActionInProgress(game, msgId);
  if (_blockReason) {
    console.warn(`[end-activation] Blocked for msgId=${msgId}: ${_blockReason}`);
    // Per alexanbv 2026-05-12: a rebuild that interrupts an attack can
    // leave game.pendingCombat populated forever — neither player can
    // resolve it because the in-thread Ready buttons reference a
    // combat thread that's now stale. Expose a "Force Clear" recovery
    // button alongside the refusal so the activation owner can nuke
    // the stale pendingCombat and re-end the activation.
    const _isPendingCombat = _blockReason.startsWith('combat in progress');
    const _payload = {
      content: `⏳ An action is still resolving: **${_blockReason}**. Finish or cancel it before ending the activation.`,
      ephemeral: true,
    };
    if (_isPendingCombat) {
      const _clearRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`clear_stale_combat_${game.gameId}_${msgId}`)
          .setLabel('Force Clear Stale Combat')
          .setStyle(ButtonStyle.Danger),
      );
      _payload.components = [_clearRow];
      _payload.content += '\n\nIf this combat is left over from an interrupted rebuild, use the button below to discard it. **This nukes the pending attack** — only use if the combat thread is dead.';
    }
    await interaction.followUp(_payload).catch(discordCatch);
    return;
  }
  const otherPlayerNum = opponentPlayerNum(meta.playerNum);
  const otherPlayerId = getPlayerId(game, otherPlayerNum);
  const displayName = meta.displayName || meta.dcName;
  const gameId = game.gameId;

  game.dcFinishedPinged = game.dcFinishedPinged || {};
  game.dcFinishedPinged[msgId] = true;
  // Per alexanbv 2026-05-12: End Activation is a save-worthy boundary.
  // The atomicOpts.commitFn drains this flag on lock release.
  game._pendingSave = true;

  // EoA orchestrator (alexanbv 2026-05-11): enumerate player-triggered
  // end-of-activation abilities. The chooser posts as a non-blocking
  // message — the player can resolve them before clicking End Turn.
  // Currently wired descriptors: Jyn Erso "Trust Goes Both Ways" (EoA
  // branch). More descriptors added per audit pass.
  try {
    const { enumerateActivatorEoaDescriptors, startEoaResolution, describeChooserPrompt } = await import('../game/eoa-orchestrator.js');
    const _eoaDescs = enumerateActivatorEoaDescriptors(game, {
      dcName: meta.dcName,
      playerNum: meta.playerNum,
      msgId,
    });
    // END-OF-ACTIVATION COMMAND CARDS (Force Surge, Rebel Graffiti).
    //
    // These are optional plays from hand, deliberately NOT descriptors of their
    // own (see the note in eoa-orchestrator.js: a descriptor would force a
    // prompt every single activation). But they still need the window HELD
    // open, because both are immediate spends that need the activation
    // standing — alexanbv 2026-08-12: "if mp chosen from diplo it would be
    // treated as an immediate spend at that moment ... Force Surge is move
    // spaces, so it is also immediate spend".
    //
    // So one placeholder descriptor per player who actually holds a playable
    // one. Its only job is to keep the activation alive while they decide; the
    // real play goes through the normal play-from-hand path. No card, no
    // descriptor, no prompt — the every-activation nag the 2026-06-18 note
    // warned about does not happen.
    //
    // This also repairs a regression I introduced in 4e11213c: removing
    // 'endOfActivation' from the after-resolves prompt left these two cards
    // with no prompt anywhere at all.
    for (const _ccPn of [getInitiativePlayerNum(game), opponentPlayerNum(getInitiativePlayerNum(game))]) {
      const _eoaCards = getPlayableReactionCardsForTiming(game, _ccPn, ['endOfActivation']);
      if (!_eoaCards.length) continue;
      _eoaDescs.push({
        id: `eoa_cc_window:${_ccPn}:${msgId}`,
        ownerPlayerNum: _ccPn,
        sourceMsgId: msgId,
        sourceLabel: `Play an end-of-activation Command Card (${_eoaCards.length} playable)`,
        subPromptKey: 'eoa_cc_window',
        extras: { dcName: meta.dcName, cardCount: _eoaCards.length },
      });
    }
    if (_eoaDescs.length > 0) {
      // game.initiativePlayerNum does not exist, so this silently bucketed
      // activator-first instead of initiative-first (alexanbv 2026-08-12:
      // "End of activation happens first. In initiative order.").
      const _eoaInit = getInitiativePlayerNum(game);
      const _eoaStarted = startEoaResolution(game, _eoaDescs, _eoaInit, {
        activatorPlayerNum: meta.playerNum,
        activatorMsgId: msgId,
      });
      if (_eoaStarted) {
        const _eoaPrompt = describeChooserPrompt(game.pendingEoaResolution, game.gameId);
        if (_eoaPrompt) {
          const { ButtonBuilder: _EoaBB, ButtonStyle: _EoaBS, ActionRowBuilder: _EoaAR } = await import('discord.js');
          const _eoaButtons = _eoaPrompt.choices.map((c) =>
            new _EoaBB().setCustomId(c.customId).setLabel(c.label).setStyle(c.descId === '__skip_all__' ? _EoaBS.Secondary : _EoaBS.Primary),
          );
          const _eoaRow = new _EoaAR().addComponents(_eoaButtons);
          const _eoaChannel = await fetchGameChannel(client, game.generalId).catch(() => null);
          if (_eoaChannel) {
            await _eoaChannel.send({
              content: `\u{1F3C1} **End-of-Activation** — Player ${_eoaPrompt.ownerPlayerNum}: choose which effect to resolve next, or skip all remaining.`,
              components: [_eoaRow],
            }).catch(discordCatch);
          }
        }
      }
    }
  } catch (err) {
    console.error('EoA orchestrator failed:', err?.message ?? err);
  }

  // TEARDOWN IS DEFERRED WHILE THE EoA WINDOW IS OPEN.
  //
  // alexanbv 2026-08-12: "End of activation and after activation resolves are
  // two different windows. End of activation happens first." Everything below
  // this point dismantles the activation, so it cannot run until the window
  // above has closed — otherwise an end-of-activation effect resolves against
  // an activation that no longer exists. Force Surge is the card that proved
  // it: it needs the activation still standing to move.
  //
  // Note this is NOT how SoA works. SoA also posts and continues; it just
  // refuses the End Activation click while its chooser is open. That is safe
  // at the START of an activation because nothing is being destroyed. It does
  // not transfer here.
  //
  // When the window is open, finishDcEndActivation is called instead by
  // handlers/eoa-handler.js once the last bucket closes.
  // Stored beside pendingEoaResolution, not inside it: consumeDescriptor and
  // skipCurrentBucket DELETE that object when the last bucket closes, which is
  // exactly the moment we need this.
  if (game.pendingEoaResolution) {
    game.pendingEndActivationResume = {
      msgId, ownerId, otherPlayerNum, otherPlayerId, displayName, gameId,
    };
    saveGames(game.gameId);
    return;
  }

  await finishDcEndActivation(ctx, {
    game, meta, msgId, ownerId, otherPlayerNum, otherPlayerId, displayName, gameId,
  });
}

/**
 * Everything that happens AFTER the end-of-activation window closes: teardown,
 * the after-activation-resolves window, the End Turn prompt and the rest.
 *
 * Split out of handleDcEndActivation on 2026-08-12 so the EoA window can hold
 * it. Deliberately takes no `interaction`: on the deferred path the caller is a
 * different interaction entirely (an EoA button click), and the original one is
 * long since acknowledged. Every `interaction.` use stayed behind in the head.
 */
export async function finishDcEndActivation(ctx, state) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    renderDcEmbed,
    getDcPlayAreaComponents,
    logGameAction,
    maybeShowEndActivationPhaseButton,
    getDcActionButtons,
    updateDcActionsMessage,
    client,
    saveGames,
  } = ctx;
  const { game, meta, msgId, ownerId, otherPlayerNum, otherPlayerId, displayName, gameId } = state;


  // Slice 3 (alexanbv 2026-05-10): host and companion end activation
  // INDEPENDENTLY. If the paired side still has an active dcActionsData
  // entry, this is a partial end — clean up only the clicked msgId's
  // per-figure state and DC card; skip thread archive, turn switch,
  // companion manual-log, Clan of Two teleport, and post-activation
  // hooks. Those fire when the OTHER side ends (and the paired check
  // returns null because this side is already cleared).
  const _slice3PairedActive = getPairedActiveMsgId(game, msgId);

  // Companion-first gate clearance (destruct 2026-05-07 (c)): if the
  // ending DC is itself a companion that was chosen to go BEFORE its
  // host, flip the host's companionActivatedBefore flag from 'before'
  // to 'completed' so the host's action gate releases.
  if (game.companionActivatedBefore) {
    for (const _hostMsgId of Object.keys(game.companionActivatedBefore)) {
      if (game.companionActivatedBefore[_hostMsgId] !== 'before') continue;
      const _hostMeta = dcMessageMeta?.get(_hostMsgId);
      if (!_hostMeta) continue;
      const _hostAtts = game.p1DcAttachments?.[_hostMsgId] || game.p2DcAttachments?.[_hostMsgId] || [];
      const _hostCompanion = getCompanionForDc(_hostMeta.dcName, _hostAtts);
      if (_hostCompanion?.companionName === meta.dcName) {
        game.companionActivatedBefore[_hostMsgId] = 'completed';
      }
    }
  }

  // Clean up activation state. Skip thread archive when the paired side
  // (companion or host) is still active — the thread is shared.
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData?.threadId && !_slice3PairedActive) {
    try {
      const thread = await fetchGameChannel(client, actionsData.threadId);
      await thread.setArchived(true);
    } catch (err) {
      console.error('Failed to archive DC activation thread on End Activation:', err);
    }
  }
  // Build figure keys for only the activated deployment group (not all DGs)
  const endEff = getDcEffects()?.[meta.dcName];
  const figCount = endEff?.figures || 1;
  // dgIndex is 1-BASED. A single-group DC's displayName carries no "[Group N]"
  // suffix, so a '0' default built `${dcName}-0-N` keys that match nothing the
  // handlers ever wrote (they use ?? 1) — cleanupActivation then silently
  // cleared nothing. attackPerformedThisActivation is the sharp edge: it is in
  // ACTIVATION_FIGKEY_FLAGS and NOT in ROUND_OBJECT_FLAGS, so it survived both
  // this cleanup and the round reset, permanently blocking that figure's next
  // attack ("already attacked this activation and does not have Assault").
  // alexanbv 2026-08-11.
  const dgIndex = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKeys = [];
  for (let fi = 0; fi < figCount; fi++) {
    figureKeys.push(`${meta.dcName}-${dgIndex}-${fi}`);
  }
  // Two ACTIVATION_FIGKEY_FLAGS are still needed further down THIS function,
  // after cleanupActivation has wiped them: On a Diplomatic Mission reads
  // attackPerformedThisActivation (~line 1250) and Wild Fury reads
  // postActivationConditions (~line 1340). Snapshot them before the wipe.
  //
  // Both were already dead before the dgIndex fix above — the lookups used
  // `-0-N` keys while the writers (figureKeyForActivation, which correctly
  // defaults to 1) used `-1-0`, so they never matched. Aligning the keys alone
  // would have kept them dead for the opposite reason: cleanupActivation now
  // matches, and deletes the data before either consumer runs.
  const _preCleanupAttacked = new Set(figureKeys.filter((fk) => game.attackPerformedThisActivation?.[fk]));
  const _preCleanupPostConds = {};
  for (const fk of figureKeys) {
    const _pc = game.postActivationConditions?.[fk];
    if (_pc) _preCleanupPostConds[fk] = _pc;
  }
  // Record which DC just activated, BEFORE cleanup erases the evidence.
  //
  // Cards with `afterActivationResolves` timing (Blaze of Glory, Son of
  // Skywalker) are offered ~320 lines below, long after cleanupActivation has
  // deleted dcActionsData[msgId]. They resolved their target via
  // findActiveActivationMsgId, which requires that entry to exist — so by the
  // time the player could legally play them there was no "active activation"
  // and both bailed with "Resolve manually: no activation in progress",
  // spending the card for nothing. This pointer is what they fall back to.
  // Previously written only by handleEndTurn. alexanbv 2026-08-11.
  game.lastActivationMsgIdByPlayer = game.lastActivationMsgIdByPlayer || {};
  game.lastActivationMsgIdByPlayer[meta.playerNum] = msgId;
  cleanupActivation(game, msgId, meta.playerNum, figureKeys);
  // Weakened discard + Stun persistence now handled by applyEndOfActivationEffects().
  // End-of-activation deterministic effects (shared with headless).
  // Per destruct 2026-05-07: each figure has individual EoA, fired when
  // that figure locks (auto via 0-actions or manual via End Figure
  // button). Per-figure EoA is dispatched in updateDcActionsMessage and
  // handleDcEndFigure; figureEoaFired marks the figures that have
  // already fired. This whole-group call now SKIPS those figures and
  // runs only for figures whose EoA hasn't fired yet (e.g. activation
  // ending while a figure still has actions remaining — End Activation
  // button before per-figure lock).
  const _ad = game.dcActionsData?.[msgId];
  const _figCount = endEff?.figures || 1;
  const _eoaFired = _ad?.figureEoaFired || {};
  for (let _eoaFi = 0; _eoaFi < _figCount; _eoaFi++) {
    if (_eoaFired[_eoaFi]) continue;
    const { applied: _endEffects } = applyEndOfActivationEffects(game, {
      dcName: meta.dcName,
      playerNum: meta.playerNum,
      displayName,
      msgId,
      // Multi-figure groups: pass figureIndex to scope to one figure.
      // Single-figure groups: omit figureIndex to use legacy whole-group
      // logic (no behavior change vs pre-2026-05-07).
      ...(_figCount > 1 ? { figureIndex: _eoaFi } : {}),
    });
    for (const eff of _endEffects) {
      await logGameAction(game, client, eff.message, { phase: 'ROUND', icon: 'activate' });
    }
    if (_ad) {
      _ad.figureEoaFired = _ad.figureEoaFired || {};
      _ad.figureEoaFired[_eoaFi] = true;
    }
  }

  // Sustained by Rage (Maul / Krrsantan): "If you have not resolved an
  // activation this round, you cannot be defeated." Per destruct
  // 2026-05-07: when the SbR figure resolves an activation, the
  // protection ends — if at 0 HP, immediately defeated. The
  // already-activated check on activatedDcIndices runs AFTER this
  // handler so we use the per-msgId activation-just-finished signal.
  {
    const _sbrEff = getDcEffects()?.[meta.dcName];
    if ((_sbrEff?.specialAbilityIds || []).includes('sustained_by_rage')) {
      const _sbrHs = ctx.dcHealthState?.get(msgId);
      if (Array.isArray(_sbrHs)) {
        for (let _fi = 0; _fi < _sbrHs.length; _fi++) {
          const _sbrEntry = _sbrHs[_fi];
          if (!Array.isArray(_sbrEntry)) continue;
          const [_sbrCur, _sbrMax] = _sbrEntry;
          if ((_sbrCur ?? _sbrMax ?? 1) > 0) continue;
          const _sbrFk = `${meta.dcName}-${dgIndex}-${_fi}`;
          await logGameAction(game, client, `💀 **Sustained by Rage** ends — **${meta.dcName}** is at **0 HP** after activation; defeated.`, { phase: 'ROUND', icon: 'attack' });
          if (ctx.processFigureDefeat) {
            await ctx.processFigureDefeat(game, {
              defeatedPlayerNum: meta.playerNum,
              figureKey: _sbrFk,
              attackerPlayerNum: meta.playerNum,
              source: 'Sustained by Rage (activation resolved)',
            });
          }
        }
      }
    }
  }

  // Update DC card (stays exhausted)
  await updateDcCardMessage(client, game, msgId, ctx, { exhausted: true, errorContext: 'Failed to update DC card after End Activation:' });

  // Spot Weld (Ugnaught): if Spot Weld was used during THIS activation, the
  // freshly-placed Junk Droid entered Ready and gets a (second) activation AFTER
  // the Ugnaught finishes — regardless of whether it already activated before
  // (alexanbv 2026-06-26). Spot Weld (abilities.js) re-creates the JD's
  // dcActionsData (fresh 2-action bank, messageId:null) and flags
  // game._spotWeldReadyJd. Here, as the host (Ugnaught) ends, we post a fresh
  // action message for the Ready JD so the player can activate it. The JD's
  // re-created bank makes it the paired-active side, so the partial-end below
  // keeps the turn from passing until the JD also ends. The host's lock was just
  // released by cleanupActivation, so the JD buttons are usable.
  if (msgId && Array.isArray(game._spotWeldReadyJd) && game._spotWeldReadyJd.length) {
    const _swJdMsgId = getCompanionMsgIdForHost(game, msgId);
    if (_swJdMsgId && game._spotWeldReadyJd.includes(_swJdMsgId)) {
      const _swJdData = game.dcActionsData?.[_swJdMsgId];
      if (_swJdData?.isCompanion && !_swJdData.messageId && _swJdData.threadId && typeof getDcActionButtons === 'function') {
        try {
          const _swThread = await fetchGameChannel(client, _swJdData.threadId);
          const _swName = game.movementBank?.[_swJdMsgId]?.displayName || 'Junk Droid';
          const _swMsg = await _swThread.send(sanitizeMentions({
            content: `🤖 **${_swName}** is **Ready** (Spot Weld) — it may activate now, after **${displayName}**. Use its buttons, then **End Activation** when done.`,
            components: getDcActionButtons(_swJdMsgId, _swName, _swName, _swJdData, game),
            allowedMentions: { users: [] },
          }));
          _swJdData.messageId = _swMsg.id;
          await logGameAction(game, client, `🤖 **Spot Weld** — **${_swName}** is Ready and may activate after **${displayName}**.`, { phase: 'ACTIVATION', icon: 'activate' });
        } catch (err) {
          console.error('[spot-weld] failed to post Ready Junk Droid activation message:', err?.message ?? err);
        }
      }
      // Consume the flag so the JD isn't re-offered if the host somehow re-ends.
      game._spotWeldReadyJd = game._spotWeldReadyJd.filter((id) => id !== _swJdMsgId);
    }
  }

  // Slice 3 partial end: paired side still active. Skip turn switch and
  // all post-activation hooks (Clan of Two teleport, End Turn prompt,
  // manual companion log, On a Diplomatic, Field Tactics, Lie in Ambush,
  // repost). They fire when the SECOND side ends and the paired check
  // returns null.
  if (_slice3PairedActive) {
    // Child-first companion order: after Child's partial-end, check whether the
    // host (Baze) has deferred SoA descriptors (e.g. Into the Fray) that should
    // fire now — before Baze's action buttons unlock. These were stored in
    // pendingCompanionHostSoaDescriptors when companion_order was emitted.
    const _pendingHostSoa = game.pendingCompanionHostSoaDescriptors?.[_slice3PairedActive];
    if (_pendingHostSoa?.length) {
      delete game.pendingCompanionHostSoaDescriptors[_slice3PairedActive];
      try {
        const { startSoaResolution: _startSoaRes, describeChooserPrompt: _soaDescPrompt } = await import('../game/soa-orchestrator.js');
        const { ButtonBuilder: _SoaBB, ButtonStyle: _SoaBS, ActionRowBuilder: _SoaAR } = await import('discord.js');
        const _hostMeta = dcMessageMeta?.get(_slice3PairedActive);
        const _hostPn = _hostMeta?.playerNum ?? meta.playerNum;
        // game.initiativePlayerNum does not exist — see activation-setup.js.
        const _soaInitPn = getInitiativePlayerNum(game);
        const _soaStarted = _startSoaRes(game, _pendingHostSoa, _soaInitPn, {
          activatorPlayerNum: _hostPn,
          activatorMsgId: _slice3PairedActive,
        });
        if (_soaStarted) {
          const _soaPrompt = _soaDescPrompt(game.pendingSoaResolution, game.gameId);
          if (_soaPrompt) {
            // Post to the host's activation thread so SoA stays in context with
            // the figure, not the game log. Fall back to generalId if no thread.
            const _hostThreadId = game.dcActionsData?.[_slice3PairedActive]?.threadId;
            const _soaChannel = await fetchGameChannel(client, _hostThreadId || game.generalId).catch(() => null);
            if (_soaChannel) {
              const _soaButtons = _soaPrompt.choices.map((c) =>
                new _SoaBB().setCustomId(c.customId).setLabel(c.label).setStyle(c.descId === '__skip_all__' ? _SoaBS.Secondary : _SoaBS.Primary),
              );
              await _soaChannel.send({
                content: `✨ **Start-of-Activation** — Player ${_soaPrompt.ownerPlayerNum}: resolve effects for **${_hostMeta?.dcName || 'the host'}**.`,
                components: [new _SoaAR().addComponents(_soaButtons)],
              }).catch(discordCatch);
            }
          }
        }
      } catch (err) {
        console.error('[slice3] failed to start deferred host SoA:', err?.message ?? err);
      }
    }
    saveGames(game.gameId);
    // Refresh the still-active paired side's action message so its buttons
    // reflect the now-cleared activation lock (cleanupActivation just released it).
    if (typeof updateDcActionsMessage === 'function') {
      await updateDcActionsMessage(game, _slice3PairedActive, client).catch((e) =>
        console.error('[slice3] failed to refresh paired DC action message:', e?.message ?? e),
      );
    }
    return;
  }

  // --- Companion activation at end of activation ---
  // If companion was marked 'pending-after' or was never addressed (player ignored buttons), activate now
  {
    const _compAttachments = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _compInfo = getCompanionForDc(meta.dcName, _compAttachments);
    // Skip the manual companion-log path when the companion has its own
    // wired bank (slice 1+2). That path was the legacy "play it manually"
    // hint; with the wired bank the companion activates via its own UI.
    const _compMsgId = getCompanionMsgIdForHost(game, msgId);
    if (_compInfo && !_compInfo.isCoActivation && !_compMsgId) {
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

  // --- Clan of Two: teleport The Child to host space or adjacent (host END) ---
  // Per destruct 2026-05-07: regardless of order (Child-first or Host-first),
  // The Child teleports at the host's END to host's space or adjacent. Post a
  // button row letting the player pick the destination; click pushes the Child.
  {
    const _coTAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    if (cardNameIncludes(_coTAtts, 'Clan of Two')) {
      const _hostDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _hostFk = `${meta.dcName}-${_hostDgIdx}-0`;
      const _hostPos = game.figurePositions?.[meta.playerNum]?.[_hostFk];
      // Find The Child's current figure key (it's a single-figure companion).
      let _childFk = null;
      for (const fk of Object.keys(game.figurePositions?.[meta.playerNum] || {})) {
        if (fk.startsWith('The Child-')) { _childFk = fk; break; }
      }
      if (_hostPos && _childFk) {
        const _ms = ctx.getMapData?.(game.selectedMap?.id);
        const _adj = (_ms?.adjacency?.[String(_hostPos).toLowerCase()] || []).map((s) => String(s).toLowerCase());
        // Filter to unoccupied destination spaces (Child can land on host's
        // space if host is small AND companion can stack — for IA the Child
        // is a companion that shares squares OK, so include host space).
        const _candidates = [String(_hostPos).toLowerCase(), ..._adj];
        const _btns = _candidates.slice(0, 24).map((sp) =>
          new ButtonBuilder()
            .setCustomId(`clan_of_two_teleport_${gameId}_${msgId}_${sp}`)
            .setLabel(`Teleport to ${sp.toUpperCase()}`)
            .setStyle(ButtonStyle.Primary)
        );
        if (_btns.length > 0) {
          await logGameAction(game, client, `\u{1F4AB} **Clan of Two** — Teleport **The Child** to **${meta.dcName}**'s space or adjacent (Child currently at ${String(_childFk).toUpperCase()} → ${String(game.figurePositions?.[meta.playerNum]?.[_childFk] || '?').toUpperCase()}):`, {
            phase: 'ACTIVATION',
            icon: 'activate',
            components: chunkButtonsToRows(_btns),
          });
        }
      }
    }
  }

  // Send End Turn button to game log (turn switch happens when player presses it)
  game.pendingEndTurn = game.pendingEndTurn || {};
  if (!game.pendingEndTurn[msgId]) {
    try {
      const ch = await fetchGameChannel(client, game.generalId);
      const icon = '\u26A1';
      const timestamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
      const endTurnBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`end_turn_${gameId}_${msgId}`)
          .setLabel('End Turn')
          .setStyle(ButtonStyle.Primary)
      );
      const endTurnMsg = await ch.send(sanitizeMentions({
        content: `${icon} ${timestamp} — <@${ownerId}> (**Player ${meta.playerNum}**) **${displayName}** activation resolved. Press **End Turn** to pass your turn.`,
        components: [endTurnBtn],
        allowedMentions: { users: [ownerId] },
      }));
      game.pendingEndTurn[msgId] = { playerNum: meta.playerNum, displayName, messageId: endTurnMsg.id };
    } catch (err) {
      console.error('Failed to send End Turn prompt after End Activation:', err);
    }
  }

  // On a Diplomatic Mission (Skirmish Upgrade, LEADER): exhaust at end of activation if no attack → choice
  {
    const _odmUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _odmExh = game.exhaustedSkirmishUpgrades?.[msgId] || [];
    // attackPerformedThisActivation is now figureKey-keyed (alexanbv
    // 2026-05-13). Group-scope "no attack" means none of the group's
    // figures attacked this activation.
    // Snapshot taken before cleanupActivation — the live map is already wiped.
    const _odmAnyFigAttacked = figureKeys.some((fk) => _preCleanupAttacked.has(fk));
    if (cardNameIncludes(_odmUpgrades, 'On a Diplomatic Mission') && !cardNameIncludes(_odmExh, 'On a Diplomatic Mission') && !_odmAnyFigAttacked) {
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
  // Clean up attack tracking for this activation — per-figureKey now
  // (alexanbv 2026-05-13). Clear every figure in the activated group.
  if (game.attackPerformedThisActivation) {
    for (const fk of figureKeys) {
      if (game.attackPerformedThisActivation[fk]) delete game.attackPerformedThisActivation[fk];
    }
  }

  // Squad Swarm used to post its "activate another group?" offer here, gated on
  // game.squadSwarmPlayerNum. That was the wrong end of the window: this runs on
  // End Activation, BEFORE the player can play the card, so playing Squad Swarm
  // in its own legal window missed the offer and the flag sat until the end of
  // the NEXT activation. Removed per alexanbv 2026-08-12 ("squad swarm should
  // have the same timing as strength in numbers"). The card now resolves where
  // Strength in Numbers does: when it is played, in abilities.js.

  // Lie in Ambush: after opponent activates, check if trigger fires
  await checkLieInAmbushTrigger(game, meta.playerNum, ctx);

  // AFTER-ACTIVATION-RESOLVES window. Per alexanbv 2026-08-12: "End of
  // activation and after activation resolves are two different windows. End of
  // activation happens first. In initiative order. Then after activation
  // resolves happens. In init order."
  //
  // This is the SECOND window. Both players get it, initiative player first,
  // and the two timing tags are NOT interchangeable:
  //
  //   afterActivationResolves          Blaze of Glory, Son of Skywalker.
  //                                    "can be played after any activation,
  //                                    friendly or hostile" — so the
  //                                    NON-activating player is prompted too.
  //   afterYouResolveGroupsActivation  Change of Plans, Squad Swarm, Strength
  //                                    in Numbers. "By nature ... require it to
  //                                    have been your activation" — activator
  //                                    only.
  //
  // Previously only the activating player was prompted, for all tags at once,
  // so Blaze and Son of Skywalker were invisible off a hostile activation.
  //
  // 'endOfActivation' deliberately no longer appears here: it is the FIRST
  // window and belongs before the activation is torn down.
  try {
    const _initPn = getInitiativePlayerNum(game);
    for (const _pn of [_initPn, opponentPlayerNum(_initPn)]) {
      const _timings = _pn === meta.playerNum
        ? ['afterActivationResolves', 'afterYouResolveGroupsActivation']
        : ['afterActivationResolves'];
      const reactCards = getPlayableReactionCardsForTiming(game, _pn, _timings);
      if (!reactCards.length) continue;
      const handId = getHandChannelId(game, _pn);
      if (!handId) continue;
      const handCh = await fetchGameChannel(client, handId);
      if (!handCh) continue;
      const _pid = getPlayerId(game, _pn);
      const _whose = _pn === meta.playerNum ? 'Your activation ended' : `**${displayName}**'s activation ended`;
      await handCh.send({
        content: `<@${_pid}> — ${_whose}! You have ${reactCards.length} reaction card(s) playable now.`,
        allowedMentions: { users: [_pid] },
      }).catch(discordCatch);
    }
  } catch (_endActErr) {
    console.error('After-activation-resolves prompt error:', _endActErr?.message ?? _endActErr);
  }

  // Field Tactics (Death Trooper): after activation, choose a friendly TROOPER/LEADER within 2 to perform a free attack
  await maybePromptFieldTactics(game, meta, msgId, logGameAction, client, ctx.findDcMessageIdForFigure);

  // Wild Fury post-activation conditions (per CRR + user 2026-05-09:
  // applies at END OF ACTIVATION, not after each attack). Reads the
  // queue populated when Wild Fury was played; applies Stun + Bleed
  // (or whatever was queued) to figure 0 of the activating DC, with
  // Condition Immunity filtering harmful conditions on immune figures.
  // Per alexanbv 2026-05-13: postActivationConditions is figureKey-keyed.
  // Iterate every figure in the group; apply queued conditions per-figure.
  for (const _pacFk of figureKeys) {
    // Read the pre-cleanup snapshot; cleanupActivation already cleared the
    // live map (and did so under the correct keys after the dgIndex fix).
    if (!_preCleanupPostConds[_pacFk]) continue;
    let waConds = _preCleanupPostConds[_pacFk];
    delete _preCleanupPostConds[_pacFk];
    delete game.postActivationConditions?.[_pacFk];
    if (Array.isArray(waConds) && waConds.length > 0) {
      const waFigureKey = _pacFk;
      const _waImmune = (game.figurePositions?.[meta.playerNum]?.[waFigureKey]) ? isConditionImmune(game, waFigureKey) : false;
      if (_waImmune) {
        waConds = waConds.filter((c) => !HARMFUL_CONDITIONS.includes(c));
      }
      if (waConds.length > 0) {
        for (const c of waConds) applyCondition(game, waFigureKey, c);
        await logGameAction(game, client, `**Wild Fury** — **${displayName}** is now **${waConds.join(' + ')}** (end of activation).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
      }
    }
  }

  saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, dcMessageMeta, dcExhaustedState, dcHealthState, buildDcEmbedAndFiles, getDcPlayAreaComponents, updateActivationsMessage, getActionsCounterContent, getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons, DC_ACTIONS_PER_ACTIVATION, ThreadAutoArchiveDuration, ACTION_ICONS, pushUndo, client, saveGames
 */
export async function handleConfirmActivate(interaction, ctx) {
  const {
    getGame,
    dcExhaustedState, dcHealthState,
    renderDcEmbed, getDcPlayAreaComponents,
    updateActivationsMessage, getActionsCounterContent,
    getDcActionButtons, getActivationMinimapAttachment, getActivateDcButtons,
    DC_ACTIONS_PER_ACTIVATION, ACTION_ICONS,
    logGameAction, pushUndo, client, saveGames,
  } = ctx;
  const dcMessageMeta = ctx.dcMessageMeta;
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
  // [Smuggling Compartment] Part 1: cards set aside with the reaction return at
  // the start of the next activation. Release them as this activation begins.
  {
    const _scReleased = releaseSmugglingCompartmentSetAside(game);
    for (const _scR of _scReleased) {
      await logGameAction(game, client, `**[Smuggling Compartment]** — P${_scR.playerNum} returns ${_scR.cards.length} set-aside Command card${_scR.cards.length === 1 ? '' : 's'} to hand.`, { phase: 'ACTIVATION', icon: 'card' }).catch(() => {});
      try { await refreshHandAndDiscard(game, _scR.playerNum, client); } catch { /* best-effort */ }
    }
  }
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
  const displayName = meta.displayName || meta.dcName;
  const playAreaId = getPlayAreaId(game, meta.playerNum);
  const playChannel = await fetchGameChannel(client, playAreaId);
  const dcMsg = await playChannel.messages.fetch(msgId);
  const dcIndex = (getDcMessageIds(game, meta.playerNum) || []).indexOf(msgId);
  await finalizeActivation({
    game, gameId, playerNum: meta.playerNum, dcIndex,
    dcName: meta.dcName, displayName, msgId, ownerId,
    dcMessage: dcMsg,
    pushUndo,
    confirmationMessage: interaction.message,
    activateCardMsgId,
    deps: {
      dcExhaustedState, dcHealthState, dcMessageMeta: ctx.dcMessageMeta,
      buildDcEmbedAndFiles: ctx.buildDcEmbedAndFiles,
      renderDcEmbed, getDcPlayAreaComponents,
      updateActivationsMessage, getActionsCounterContent,
      getDcActionButtons, getActivationMinimapAttachment,
      getActivateDcButtons,
      DC_ACTIONS_PER_ACTIVATION, ACTION_ICONS,
      logGameAction, saveGames, client,
      findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
      hasLineOfSight: ctx.hasLineOfSight,
      getMapData: ctx.getMapData,
      getDcStats: ctx.getDcStats,
    },
  });
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
  const { getGame, dcMessageMeta, dcExhaustedState, dcHealthState, saveGames, logGameAction, client, renderDcEmbed, getDcPlayAreaComponents, processFigureDefeat } = ctx;
  // Parse: act_passive_{gameId}_{msgId}_{ability}_{choice}
  const parts = splitCustomId(interaction.customId, 'act_passive_');
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

  // Slice 5 cleanup (destruct 2026-05-07): vigor / responsive / fulcrum /
  // hunger / tacmove branches removed — all five abilities now flow through
  // the SoA orchestrator (soa-handler.js soa_pick_ / soa_fire_ / soa_skip_all_).
  // The matching `act_passive_*_<vigor|responsive|fulcrum|hunger|tacmove>_*`
  // buttons are no longer posted by activation-setup.js.
  // awr / awrtoken branches removed in slice 8a (2026-05-07) — AWR
  // migrated to the SoA orchestrator (subPromptKey 'awr'). The
  // act_passive_*_awr_* / act_passive_*_awrtoken_* buttons are no
  // longer posted.
  if (ability === 'openminded') {
    const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const fk = `${meta.dcName}-${dgIndex}-0`;
    if (choice === 'mp') {
      grantMovementBank(game, msgId, 1);
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}** gained **1 MP**.`, components: [] }).catch(discordCatch);
    } else if (choice === 'token') {
      // Grant 1 Power Token — player chooses type via power_token_choice_ flow
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: meta.dcName, count: 1 }], channelId: interaction.channelId, playerNum: meta.playerNum };
      const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = await import('discord.js');
      const tokenBtns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
        new BB().setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(BS.Secondary)
      );
      await interaction.message.edit({ content: `🧠 **Open-Minded** — **${displayName}**: Choose Power Token type:`, components: [new AR().addComponents(tokenBtns)] }).catch(discordCatch);
      saveGames(game.gameId);
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
      // Calming Presence (Yoda): strain via applyStrain pipeline,
      // followed by harmful-condition removal once strain resolves.
      // Per CRR + user 2026-05-09: post-strain effects are followups.
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const selfFk = `${meta.dcName}-${dgIndex}-0`;
      const { applyStrain } = await import('./strain-handler.js');
      await applyStrain(game, ctx, {
        figureKey: selfFk,
        controllerPlayerNum: meta.playerNum,
        amount: 1,
        source: 'Calming Presence',
        followup: { type: 'calming_presence_remove', payload: { condFk, condName } },
      });
      const condFkName = dcNameFromFigureKey(condFk);
      await interaction.message.edit({ content: `🧘 **Calming Presence** — Removed **${condName}** from **${condFkName}**. **${displayName}** suffered **1 Strain**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Calming Presence** (Yoda) — Removed ${condName} from ${condFkName}; ${displayName} suffered 1 Strain.`, { phase: 'ACTIVATION', icon: 'condition' });
    }
  // --- Nemik's Manifesto: exhaust for +1 MP, -2 Strain ---
  // Per destruct 2026-05-07: strain routes through applyStrain so the
  // canonical strain subroutine fires (UD prompt, Fireproof, Headhunter).
  } else if (ability === 'nemik') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `📜 **Nemik's Manifesto** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      // choice = 'use_{nmMsgId}'
      const nmMsgId = interaction.customId.replace(/^act_passive_[^_]+_[^_]+_nemik_use_/, '');
      // Grant 1 MP to the activating figure's bank, then exhaust the card
      grantMovementBank(game, msgId, 1);
      exhaustAttachment(game, nmMsgId, "Nemik's Manifesto");
      await interaction.message.edit({ content: `📜 **Nemik's Manifesto** — **${displayName}** gained **1 MP**. Now suffering **2 Strain**...`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Nemik's Manifesto** — ${displayName} gained 1 MP. (Exhausted)`, { phase: 'ACTIVATION', icon: 'card' });
      // Strain via the player-choice subroutine (UD prompt, Fireproof, Headhunter, etc.)
      const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const fk = `${meta.dcName}-${dgIndex}-0`;
      const { applyStrain } = await import('./strain-handler.js');
      await applyStrain(game, ctx, {
        figureKey: fk,
        controllerPlayerNum: meta.playerNum,
        amount: 2,
        source: "Nemik's Manifesto",
      });
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
        // Unshakable (per CRR + user 2026-05-09): strain via applyStrain
        // pipeline; harmful-condition removal + card exhaust happen
        // AS THE FOLLOWUP after strain resolves.
        const targetMsgId = ctx.findDcMessageIdForFigure?.(gameId, meta.playerNum, targetFk);
        if (targetMsgId) {
          // Look up the [Unshakable] card msgId for the followup's exhaust step.
          let _usMsgId = null;
          const _usDcList2 = getDcList(game, meta.playerNum) || [];
          const _usDcMsgIds2 = getDcMessageIds(game, meta.playerNum) || [];
          for (let i = 0; i < _usDcList2.length; i++) {
            if ((_usDcList2[i]?.dcName || _usDcList2[i]) === '[Unshakable]') {
              _usMsgId = _usDcMsgIds2[i];
              break;
            }
          }
          const { applyStrain } = await import('./strain-handler.js');
          await applyStrain(game, ctx, {
            figureKey: targetFk,
            controllerPlayerNum: meta.playerNum,
            amount: 1,
            source: 'Unshakable',
            followup: {
              type: 'unshakable_remove',
              payload: { targetFk, removedCond, usMsgId: _usMsgId },
            },
          });
        }
        await interaction.message.edit({ content: `**Unshakable** — **${targetDcName}** must suffer **1 Strain**, then **${removedCond}** is removed.`, components: [] }).catch(discordCatch);
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
            .setLabel(truncateLabel(dn))
            .setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`sc_fig_pick_${game.gameId}_${msgId}_cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
        const rows = chunkButtonsToRows(btns);
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
        // When-discarded subroutine (deck): Built on Hope re-draw + Windfall hooks.
        const { fireCcDiscarded } = await import('../game/cc-passive-redraw.js');
        const _strDisc = fireCcDiscarded(game, _strTargetPn, _strCard, { fromDeck: true });
        await interaction.message.edit({ content: `🧠 **Strategize** — Discarded **${_strCard}** from the ${_strIsOwn ? 'own' : "opponent's"} deck.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Strategize** (Thrawn) — Discarded ${_strCard} from ${_strIsOwn ? 'own' : "opponent's"} command deck.`, { phase: 'ACTIVATION', icon: 'card' });
        if (_strDisc.windfallSelfVp > 0) await logGameAction?.(game, client, `**Windfall** — P${_strTargetPn} gains **1 VP** (Windfall discarded).`, { phase: 'ACTIVATION', icon: 'card' });
      } else {
        await interaction.message.edit({ content: `🧠 **Strategize** — Deck is empty; nothing to discard.`, components: [] }).catch(discordCatch);
      }
    }
  // --- Trust Goes Both Ways: REMOVED. Both the start- and end-of-activation
  //     branches are now player-choice orchestrator descriptors
  //     (subPromptKeys 'trust_both_ways' / 'trust_both_ways_eoa', resolved in
  //     soa-handler.js / eoa-handler.js). The legacy `trustboth` act_passive
  //     handler was deleted along with its emitter to stop the double-fire. ---
  // --- Token Distribution: used by Arms Distribution and Long-Laid Plans ---
  } else if (ability === 'tokendist') {
    const pending = game.pendingTokenDistribution;
    if (!pending) return;
    if (choice === 'done') {
      const abilityLabel = pending.ability === 'longlaid' ? 'Long-Laid Plans' : 'Arms Distribution';
      await interaction.message.edit({ content: `${pending.ability === 'longlaid' ? '🧠' : '🎯'} **${abilityLabel}** — Done (distributed ${(pending.originalRemaining || pending.remaining) - pending.remaining} token${((pending.originalRemaining || pending.remaining) - pending.remaining) !== 1 ? 's' : ''}).`, components: [] }).catch(discordCatch);
      clearPendingTokenDistribution(game);
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
      clearPendingTokenDistribution(game);
    } else {
      // Show figure picker again for next token
      const _tdDgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
      const _tdSelfFk = `${meta.dcName}-${_tdDgIndex}-0`;
      const _tdSelfPos = game.figurePositions?.[meta.playerNum]?.[_tdSelfFk];
      const _tdFriendlies = _tdSelfPos ? Object.entries(game.figurePositions?.[meta.playerNum] || {})
        .filter(([fk2, fp]) => fp && countGameSpaces(game, _tdSelfPos, fp) <= 3) : [];
      if (_tdFriendlies.length > 0) {
        const btns = _tdFriendlies.slice(0, 24).map(([fk2]) =>
          new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_${fk2}`).setLabel(dcNameFromFigureKey(fk2)).setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_tokendist_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
        await interaction.message.edit({ content: `${icon} **${abilityLabel}** — **${targetDcName}** gained **1 ${tokenType} Token**. Pick next figure (${pending.remaining} remaining):`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
      } else {
        await interaction.message.edit({ content: `${icon} **${abilityLabel}** — **${targetDcName}** gained **1 ${tokenType} Token**. No more eligible figures.`, components: [] }).catch(discordCatch);
        clearPendingTokenDistribution(game);
      }
    }
  // --- General's Orders: each chosen figure gains 2 MP ---
  } else if (ability === 'genorders') {
    const pending = game.pendingGeneralsOrders;
    if (!pending) return;
    if (choice === 'done') {
      await interaction.message.edit({ content: `🎖️ **General's Orders** — Done (${pending.chosen.length} figure${pending.chosen.length !== 1 ? 's' : ''} granted MP).`, components: [] }).catch(discordCatch);
      clearPendingGeneralsOrders(game);
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
      // Recipient ≠ activator (card explicitly says "another friendly")
      // → spend immediately, no bank. Per alexanbv 2026-05-10: the card
      // says "perform a move" = a full Move action with the figure's
      // own Speed-MP, not a fixed 2 MP.
      let _goSpaces = 2;
      if (targetMsgId) {
        try {
          const { getEffectiveSpeed } = await import('../game/board-helpers.js');
          _goSpaces = getEffectiveSpeed(targetDcName, targetFk, game, meta.playerNum) ?? 2;
        } catch { /* fall back to 2 if speed lookup fails */ }
        try {
          const { setupPendingMoveX } = await import('./move-x-handler.js');
          await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
            msgId: targetMsgId,
            figureKey: targetFk,
            playerNum: meta.playerNum,
            spaces: _goSpaces,
            source: "General's Orders",
            threadId: null,
            bypassCosts: false,
          });
        } catch (err) {
          console.error("[activation] General's Orders picker stamp failed:", err?.message ?? err);
        }
      }
      pending.chosen.push(targetFk);
      pending.remaining--;
      await logGameAction?.(game, client, `**General's Orders** — ${targetDcName} performs a Move (${_goSpaces} MP, spend immediately, no bank).`, { phase: 'ACTIVATION', icon: 'activate' });
      if (pending.remaining <= 0) {
        await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** moved (${_goSpaces} MP). All picks used.`, components: [] }).catch(discordCatch);
        clearPendingGeneralsOrders(game);
      } else {
        // Show remaining figure choices (exclude already chosen)
        const friendlyFigs = Object.entries(game.figurePositions?.[meta.playerNum] || {})
          .filter(([fk, fp]) => fp && !pending.chosen.includes(fk));
        const _goSelfDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _goSelfFk = `${meta.dcName}-${_goSelfDgIdx}-0`;
        const filtered = friendlyFigs.filter(([fk]) => fk !== _goSelfFk);
        if (filtered.length > 0) {
          const _go2Slice = filtered.slice(0, 24);
          const _go2Labels = figureChoiceLabels(_go2Slice.map(([fk]) => fk));
          const btns = _go2Slice.map(([fk], i) =>
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_${fk}`).setLabel(_go2Labels[i]).setStyle(ButtonStyle.Primary)
          );
          btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_genorders_done`).setLabel('Done').setStyle(ButtonStyle.Secondary));
          await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** gained **2 MP**. Pick figure ${2 - pending.remaining + 1} of 2:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
        } else {
          await interaction.message.edit({ content: `🎖️ **General's Orders** — **${targetDcName}** gained **2 MP**. No more eligible figures.`, components: [] }).catch(discordCatch);
          clearPendingGeneralsOrders(game);
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
      // Mark Slam as used this activation. Per alexanbv 2026-05-13:
      // per-figure (specials are per-figure, not per-group).
      const _waFk = figureKeyForActivation(game, msgId);
      game.wookieeAvengerSlamUsed = game.wookieeAvengerSlamUsed || {};
      if (_waFk) game.wookieeAvengerSlamUsed[_waFk] = true;
      // CRR: "A figure can perform each special action ability only once
      // per activation." WA's free Slam IS the Special Action — consuming
      // it consumes Chewie's once-per-activation right to use Slam. Push
      // Slam's specialIdx into actionsData.specialsUsed so the dc_special_
      // button click handler at dc-play-area.js:1318 correctly refuses a
      // second (paid) Slam in the same activation.
      // Per alexanbv 2026-05-13: specialsUsedByFig is per-figure. Push
      // Slam's specialIdx for the currently-selected figure so a paid
      // Slam from that same figure is refused.
      const _waActData = game.dcActionsData?.[msgId];
      if (_waActData) {
        const _waDcSpecials = (getDcEffects()?.[meta.dcName]?.specials) || [];
        const _waSlamIdx = _waDcSpecials.indexOf('Slam');
        if (_waSlamIdx >= 0) {
          const _waFigIdx = _waActData.selectedFigure ?? 0;
          if (!_waActData.specialsUsedByFig) _waActData.specialsUsedByFig = {};
          if (!_waActData.specialsUsedByFig[_waFigIdx]) _waActData.specialsUsedByFig[_waFigIdx] = [];
          if (!_waActData.specialsUsedByFig[_waFigIdx].includes(_waSlamIdx)) {
            _waActData.specialsUsedByFig[_waFigIdx].push(_waSlamIdx);
          }
        }
      }
      // Track as special action for CC purposes (To the Limit, All in a
      // Day's Work). Per alexanbv 2026-05-13: per-figure.
      game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
      if (_waFk) game.specialActionUsedThisActivation[_waFk] = (game.specialActionUsedThisActivation[_waFk] || 0) + 1;
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
            const res = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
              figureKey: targetFk, msgId: targetMsgId, figIndex: figIdx,
              amount: hits, controllerPlayerNum: targetPlayerNum,
              source: 'Wookiee Slam',
            });
            const _wsDefNote = res.newHp <= 0 ? ' **(defeated)**' : '';
            resultParts.push(`${hits} Damage to **${targetDcName}**${_wsDefNote} (HP: ${res.prevHp} -> ${res.newHp})`);
            if (res.newHp <= 0 && processFigureDefeat) {
              await processFigureDefeat(game, {
                defeatedPlayerNum: targetPlayerNum,
                figureKey: targetFk,
                attackerPlayerNum: meta.playerNum,
                source: 'Wookiee Avenger Slam',
              });
            }
          } else {
            resultParts.push(`Apply ${hits} Damage to **${targetDcName}** manually`);
          }
        }
        // SMALL push check: if target is SMALL, alive, and took hits, offer space picker for push
        const _wsTargetAlive = targetPlayerNum && game.figurePositions?.[targetPlayerNum]?.[targetFk];
        const targetKws = getDcKeywords(game)?.[targetDcName] || [];
        const isSmall = !targetKws.some(k => /large|massive/i.test(String(k)));
        if (isSmall && hits > 0 && _wsTargetAlive) {
          const _waMapId = game.selectedMap?.id;
          const _waMs = _waMapId ? getMapData(_waMapId) : null;
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
              setPendingWookSlamPush(game, { targetFk, targetPlayerNum, gameId, msgId });
              const spaceBtns = validPushSpaces.slice(0, 24).map(s =>
                new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslamspace_${String(s).toLowerCase()}`).setLabel(String(s).toUpperCase()).setStyle(ButtonStyle.Primary)
              );
              spaceBtns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_wookslamspace_skip`).setLabel('Skip push').setStyle(ButtonStyle.Secondary));
              await interaction.message.edit({ content: `**Wookiee Avenger Slam** — ${resultParts.join('. ')}. Push **${targetDcName}** to which space?`, components: chunkButtonsToRows(spaceBtns) }).catch(discordCatch);
              await logGameAction?.(game, client, `**Wookiee Avenger Slam** — Rolled ${diceResult} against ${targetDcName}. Push pending.`, { phase: 'ACTIVATION', icon: 'activate' });
              saveGames(game.gameId);
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
      clearPendingWookSlamPush(game);
      await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Push skipped.`, components: [] }).catch(discordCatch);
    } else {
      const { targetFk, targetPlayerNum } = pending;
      const targetDcName = dcNameFromFigureKey(targetFk);
      const chosenSpace = String(choice).toLowerCase();
      pushFigure(game, targetPlayerNum, targetFk, chosenSpace);
      clearPendingWookSlamPush(game);
      await interaction.message.edit({ content: `**Wookiee Avenger Slam** — Pushed **${targetDcName}** to **${chosenSpace.toUpperCase()}**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `**Wookiee Avenger Slam** — Pushed **${targetDcName}** to **${chosenSpace.toUpperCase()}**.`, { phase: 'ACTIVATION', icon: 'move' });
    }
  // --- Durasteel Fist: roll 1 green die on adjacent target ---
  } else if (ability === 'durasteelfist') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🤜 **Durasteel Fist** — Skipped.`, components: [] }).catch(discordCatch);
    } else if (choice.startsWith('obj:')) {
      // Object target (alexanbv 2026-06-22): "Choose 1 adjacent figure OR OBJECT."
      // Roll 1 green die, apply Hits to the object's health. No push — that only
      // applies to a SMALL figure.
      const objId = choice.slice(4);
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${meta.dcName}_durasteel_fist_${msgId}`] = true;
      const faces = getDiceData()?.attack?.green;
      const objName = game.objectMeta?.[objId]?.name || objId;
      if (!faces?.length) {
        await interaction.message.edit({ content: `🤜 **Durasteel Fist** — Roll 1 green die manually and apply results to **${objName}**.`, components: [] }).catch(discordCatch);
      } else {
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const surges = face.surge ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        let resultMsg = `Rolled: **${diceResult}**`;
        if (hits > 0 && Array.isArray(game.objectHealth?.[objId])) {
          // Object-damage pipeline (alexanbv 2026-06-22): HP + position + vpOnDefeat.
          const _od = applyObjectDamageSync(game, objId, hits, { attackerPlayerNum: meta.playerNum, awardObjectiveVp });
          resultMsg += `; ${hits} Damage to **${_od.name}** (${_od.prevHp}→${_od.newHp})${_od.defeated ? ' — destroyed' : ''}`;
        } else if (hits > 0) {
          resultMsg += `; apply ${hits} Damage to **${objName}** manually`;
        }
        await interaction.message.edit({ content: `🤜 **Durasteel Fist** — ${resultMsg}.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Durasteel Fist** — Rolled ${diceResult} against ${objName}.`, { phase: 'ACTIVATION', icon: 'activate' });
      }
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
            const res = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
              figureKey: targetFk, msgId: targetMsgId, figIndex: figIdx,
              amount: hits, controllerPlayerNum: targetPlayerNum,
              source: 'Durasteel Fist',
            });
            const _dfDefNote = res.newHp <= 0 ? ' **(defeated)**' : '';
            resultParts.push(`${hits} Damage to **${targetDcName}**${_dfDefNote} (HP: ${res.prevHp} -> ${res.newHp})`);
            if (res.newHp <= 0 && processFigureDefeat) {
              await processFigureDefeat(game, {
                defeatedPlayerNum: targetPlayerNum,
                figureKey: targetFk,
                attackerPlayerNum: meta.playerNum,
                source: 'Durasteel Fist',
              });
            }
          } else {
            resultParts.push(`Apply ${hits} Damage to **${targetDcName}** manually`);
          }
        }
        // Surge + SMALL check: push 1 space (attacker picks direction)
        if (surges > 0) {
          const targetKws = getDcKeywords(game)?.[targetDcName] || [];
          const isSmall = !targetKws.some(k => /large|massive/i.test(String(k)));
          if (isSmall && targetPlayerNum) {
            const _pusherKws = (getDcStats(meta.dcName)?.keywords || []).map(k => String(k).toUpperCase());
            const legal = getValidPushDestinations(game, targetFk, targetPlayerNum, { pusherIsMassive: _pusherKws.includes('MASSIVE') });
            if (legal.length === 0) {
              resultParts.push(`Surge rolled — would push **${targetDcName}** 1 space, but no legal destinations`);
            } else if (legal.length === 1) {
              // Single legal space — apply automatically.
              const { prevPos, newPos } = pushFigure(game, targetPlayerNum, targetFk, legal[0]) || {};
              resultParts.push(`Surge — pushed **${targetDcName}** ${prevPos?.toUpperCase()} → ${String(newPos).toUpperCase()}`);
            } else {
              // 2+ options — set up pending state + button picker.
              setPendingDurasteelFistPush(game, {
                gameId, msgId,
                attackerPlayerNum: meta.playerNum,
                targetPlayerNum,
                targetFigureKey: targetFk,
                targetDcName,
                legalSpaces: legal,
              });
              const btns = legal.slice(0, 24).map((sp) =>
                new ButtonBuilder()
                  .setCustomId(`durasteel_push_${gameId}_${sp}`)
                  .setLabel(sp.toUpperCase())
                  .setStyle(ButtonStyle.Danger)
              );
              await interaction.followUp({
                content: `🤜 **Durasteel Fist** — Surge rolled, push **${targetDcName}** 1 space. Pick a destination:`,
                components: chunkButtonsToRows(btns),
              }).catch(discordCatch);
              resultParts.push(`Surge — push prompt sent`);
            }
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
      exhaustAttachment(game, msgId, 'Motivation');
      // Store pending and show heal vs discard choice
      setPendingMotivation(game, { targetFk, gameId, msgId, playerNum: meta.playerNum });
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
    // Grant 1 MP to chosen target (≠ activator per card text "choose
    // a friendly figure with a lower figure cost than you"). Spend
    // immediately, no bank. bypassCosts: false.
    if (targetMsgId) {
      try {
        const { setupPendingMoveX } = await import('./move-x-handler.js');
        await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
          msgId: targetMsgId,
          figureKey: targetFk,
          playerNum: meta.playerNum,
          spaces: 1,
          source: 'Motivation',
          threadId: null,
          bypassCosts: false,
        });
        resultParts.push('gains 1 MP (spend immediately)');
      } catch (err) {
        console.error('[activation] Motivation picker stamp failed:', err?.message ?? err);
        resultParts.push('1 MP (resolve manually)');
      }
    }
    clearPendingMotivation(game);
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
      exhaustAttachment(game, msgId, 'Trusted Ally');
      // Show heal vs discard choice
      setPendingTrustedAlly(game, { targetFk, gameId, msgId, playerNum: meta.playerNum });
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
    clearPendingTrustedAlly(game);
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
        // Per alexanbv 2026-05-13: the IR multi-attack grant is
        // per-figure. Using IR on figure[0] does not grant multi-attack
        // to siblings in the group. The exhaust gate (per-DC) handles
        // the once-per-round limit separately.
        const _irFk = figureKeyForActivation(game, msgId);
        game.imperialRetrofittingMultiAttack = game.imperialRetrofittingMultiAttack || {};
        if (_irFk) game.imperialRetrofittingMultiAttack[_irFk] = true;
        exhaustAttachment(game, _irCardMsgId, 'Imperial Retrofitting');
        await interaction.message.edit({ content: `**Imperial Retrofitting** — Exhausted. **${displayName}** may perform **multiple attacks** this activation.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Retrofitting** exhausted — **${displayName}** may perform multiple attacks this activation.`, { phase: 'ACTIVATION', icon: 'card' });
        // After exhaust, offer deplete for Focus if card is not yet depleted
        const _irStillAvailable = !isDcDepleted(game, _irCardMsgId);
        if (_irStillAvailable) {
          const _irFocusBtns = [
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_focus_${_irCardMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          ];
          await interaction.channel.send({ content: `**Imperial Retrofitting** — Also deplete for **Focus** before declaring an attack?`, components: [new ActionRowBuilder().addComponents(_irFocusBtns)] }).catch(discordCatch);
        }
      } else if (_irAction === 'move') {
        // Grant Speed MP to the vehicle, then exhaust IR
        const _irSpeed = ctx.getDcStats?.(meta.dcName)?.speed ?? 4;
        grantMovementBank(game, msgId, _irSpeed);
        exhaustAttachment(game, _irCardMsgId, 'Imperial Retrofitting');
        await interaction.message.edit({ content: `**Imperial Retrofitting** — Exhausted. **${displayName}** performs a move (**${_irSpeed} MP**).`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `**Imperial Retrofitting** exhausted — **${displayName}** gains ${_irSpeed} MP (performs a move).`, { phase: 'ACTIVATION', icon: 'card' });
        // After exhaust, offer deplete for Focus if card is not yet depleted
        const _irStillAvailable = !isDcDepleted(game, _irCardMsgId);
        if (_irStillAvailable) {
          const _irFocusBtns = [
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_focus_${_irCardMsgId}`).setLabel('IR: Focus (Deplete)').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_impretro_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          ];
          await interaction.channel.send({ content: `**Imperial Retrofitting** — Also deplete for **Focus** before declaring an attack?`, components: [new ActionRowBuilder().addComponents(_irFocusBtns)] }).catch(discordCatch);
        }
      } else if (_irAction === 'focus') {
        // Apply Focus to the vehicle figure, then deplete IR
        const _irDgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const _irFigKey = `${meta.dcName}-${_irDgIdx}-0`;
        applyCondition(game, _irFigKey, 'Focus');
        depleteDc(game, _irCardMsgId, meta.playerNum);
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
        // Refresh Citadel play area embed to show updated token counts
        const _icDcListRefresh = getDcList(game, meta.playerNum) || [];
        const _icMsgIdsRefresh = getDcMessageIds(game, meta.playerNum) || [];
        const _icIdx = _icDcListRefresh.findIndex(dc => dc?.dcName === '[Imperial Citadel]');
        if (_icIdx >= 0 && _icMsgIdsRefresh[_icIdx]) {
          await updateDcCardMessage(client, game, _icMsgIdsRefresh[_icIdx], ctx, { errorContext: 'Failed to refresh Imperial Citadel embed:' });
        }
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
      // Per IACP rule clarification 2026-05-09: "once per activation"
      // applies to each FIGURE'S activation in a multifigure group,
      // not the group as a whole. Key by figureKey of the activating
      // figure (Saska Thorn).
      const _udDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _udDgIdx = _udDgMatch ? _udDgMatch[1] : '1';
      const _udSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _udFigureKey = `${meta.dcName}-${_udDgIdx}-${_udSelFig}`;
      game.unstableDevicesUsedThisActivation = game.unstableDevicesUsedThisActivation || {};
      game.unstableDevicesUsedThisActivation[_udFigureKey] = true;
      await interaction.message.edit({ content: `🔧 **Unstable Devices** — **${targetDcName}** gains **1 Device token** (now ${game.deviceTokens[targetFk]}).`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `🔧 **Unstable Devices** — **${targetDcName}** gains 1 Device token (now ${game.deviceTokens[targetFk]}).`, { phase: 'ACTIVATION', icon: 'activate' });
    }
  } else if (ability === 'droidkit') {
    if (choice === 'skip') {
      await interaction.message.edit({ content: `🤖 **Droid Kit** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const tokenMap = { damage: 'Damage', surge: 'Surge', block: 'Block', evade: 'Evade' };
      const tokenType = tokenMap[choice];
      if (tokenType) {
        const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const fk = `${meta.dcName}-${dgIndex}-0`;
        grantPowerTokens(game, fk, tokenType, 1);
        await interaction.message.edit({ content: `🤖 **Droid Kit** — **${displayName}** gained **1 ${tokenType} Token**.`, components: [] }).catch(discordCatch);
        await logGameAction?.(game, client, `🤖 **Droid Kit** — **${displayName}** gained 1 ${tokenType} Token.`, { phase: 'ACTIVATION', icon: 'activate' });
      }
    }
  // --- Conspire (Senator form): distribute Focus tokens to friendlies within 1 space ---
  } else if (ability === 'conspire') {
    if (choice === 'skip') {
      clearPendingConspire(game);
      await interaction.message.edit({ content: `🗣️ **Conspire** — Skipped.`, components: [] }).catch(discordCatch);
    } else {
      const targetFk = choice;
      const targetDcName = dcNameFromFigureKey(targetFk);
      grantPowerTokens(game, targetFk, 'Damage', 1);
      await interaction.message.edit({ content: `🗣️ **Conspire** — **${targetDcName}** gained **1 Focus (Damage) Token**.`, components: [] }).catch(discordCatch);
      await logGameAction?.(game, client, `🗣️ **Conspire** — **${targetDcName}** gained 1 Focus (Damage) Token.`, { phase: 'ACTIVATION', icon: 'activate' });
      // If more tokens to distribute, show picker again
      if (game.pendingConspire) {
        game.pendingConspire.tokensRemaining = (game.pendingConspire.tokensRemaining || 1) - 1;
        if (game.pendingConspire.tokensRemaining > 0) {
          const _conFk = game.pendingConspire.senderFk;
          const _conPos = game.figurePositions?.[meta.playerNum]?.[_conFk];
          if (_conPos) {
            const { getMapData: _gms } = await import('../data-loader.js');
            const _conMs = _gms(game.selectedMap?.id);
            const _conAdj = (_conMs?.adjacency?.[String(_conPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
            const _conFriendlies = Object.entries(game.figurePositions?.[meta.playerNum] || {})
              .filter(([fk2, pos2]) => fk2 !== _conFk && pos2 && _conAdj.includes(String(pos2).toLowerCase()));
            if (_conFriendlies.length > 0) {
              const _conSlice = _conFriendlies.slice(0, 24);
              const _conLabels = figureChoiceLabels(_conSlice.map(([fk2]) => fk2));
              const btns = _conSlice.map(([fk2], i) =>
                new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_${fk2}`).setLabel(_conLabels[i]).setStyle(ButtonStyle.Primary)
              );
              btns.push(new ButtonBuilder().setCustomId(`act_passive_${gameId}_${msgId}_conspire_skip`).setLabel('Done').setStyle(ButtonStyle.Secondary));
              const thread = interaction.channel;
              await thread.send({ content: `🗣️ **Conspire** — ${game.pendingConspire.tokensRemaining} Focus token(s) remaining. Choose a figure:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
              saveGames(game.gameId);
              return;
            }
          }
        }
        clearPendingConspire(game);
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
      // Track as special action for CC purposes. Per alexanbv 2026-05-13: per-figure.
      const _suFk = figureKeyForActivation(game, msgId);
      game.specialActionUsedThisActivation = game.specialActionUsedThisActivation || {};
      if (_suFk) game.specialActionUsedThisActivation[_suFk] = (game.specialActionUsedThisActivation[_suFk] || 0) + 1;
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
  saveGames(game.gameId);
}

/**
 * Handle field_tactics_pick_ — player chose a figure (or skip) for Field Tactics interrupt attack.
 * Button format: field_tactics_pick_{gameId}_{triggerMsgId}_{figureKey|skip}
 */
export async function handleFieldTacticsPick(interaction, ctx) {
  const { getGame, dcMessageMeta, logGameAction, saveGames, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'field_tactics_pick_');
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
    saveGames(game.gameId);
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
  grantFieldTacticsActivation(game, triggerMeta.playerNum, chosenMsgId);
  const chosenName = dcNameFromFigureKey(figureKey);
  const _ftMsg = `**Field Tactics** — **${chosenName}**'s group may **immediately activate** now (it loses Field Tactics this round). Click its card to begin.`;
  await interaction.message.edit({ content: _ftMsg, components: [] }).catch(discordCatch);
  await logGameAction(game, client, _ftMsg, { phase: 'ROUND', icon: 'activate' });
  saveGames(game.gameId);
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
  saveGames(game.gameId);
}

/**
 * Heroic Effort: player picks a CC from hand to place on bottom of deck.
 */
/**
 * Heroic Effort — the OPTIONAL draw decision (alexanbv 2026-06-22). On "Draw 1"
 * the player draws a Command card and is then prompted to bury 1 from hand; on
 * "Decline" nothing happens. customId: heroic_effort_draw_<gameId>_<pn>_<yes|no>.
 */
export async function handleHeroicEffortDraw(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'heroic_effort_draw_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const decision = parts[2]; // 'yes' | 'no'
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingHeroicEffortDraw?.[playerNum]) {
    await interaction.followUp({ content: 'No Heroic Effort draw pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  delete game.pendingHeroicEffortDraw[playerNum];
  if (Object.keys(game.pendingHeroicEffortDraw).length === 0) delete game.pendingHeroicEffortDraw;
  if (decision !== 'yes') {
    await interaction.message.edit({ content: '**Heroic Effort** — Declined (no card drawn).', components: [] }).catch(discordCatch);
    await logGameAction(game, client, `**Heroic Effort** — P${playerNum} declined the draw.`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  const hKey = ccHandKey(playerNum);
  const dKey = ccDeckKey(playerNum);
  const deck = game[dKey] || [];
  if (deck.length === 0) {
    await interaction.message.edit({ content: '**Heroic Effort** — Deck is empty; no card drawn.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  const drawn = deck.shift();
  game[hKey] = [...(game[hKey] || []), drawn];
  game[dKey] = deck;
  if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, client);
  await logGameAction(game, client, `**Heroic Effort** — P${playerNum} drew 1 Command card; must return 1 to deck bottom.`, { phase: 'ROUND', icon: 'card' });
  // The draw was taken → the bury-1 is now mandatory. Post the return picker.
  game.pendingHeroicEffortReturn = game.pendingHeroicEffortReturn || {};
  game.pendingHeroicEffortReturn[playerNum] = true;
  const hand = game[hKey] || [];
  const btns = hand.slice(0, 25).map((card, idx) =>
    new ButtonBuilder()
      .setCustomId(`heroic_effort_return_${game.gameId}_${playerNum}_${idx}`)
      .setLabel(truncateLabel(card))
      .setStyle(ButtonStyle.Primary)
  );
  await interaction.message.edit({
    content: '**Heroic Effort** — Drew 1 card. Choose 1 Command card from your hand to place on the bottom of your deck:',
    components: chunkButtonsToRows(btns).slice(0, 5),
  }).catch(discordCatch);
  saveGames(game.gameId);
}

export async function handleHeroicEffortReturn(interaction, ctx) {
  const { getGame, saveGames, updateHandVisualMessage, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'heroic_effort_return_');
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
  saveGames(game.gameId);
}

/**
 * Scavenged Weaponry: player picks which friendly Droid/Vehicle to transfer the attachment to.
 */
export async function handleScavWeaponTransfer(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const parts = splitCustomId(interaction.customId, 'scav_weapon_transfer_');
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
  clearPendingScavengedWeaponryTransfer(game);
  await interaction.message.edit({
    content: `**Scavenged Weaponry** — Transferred to **${target.displayName}**.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client, `**Scavenged Weaponry** — Transferred to **${target.displayName}** after defeat.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

/**
 * Handle sc_fig_pick_ — player picks target figure for Spectre Cell exhaust ability.
 * customId: sc_fig_pick_{gameId}_{activatingMsgId}_{figureKey|cancel}
 */
export async function handleScFigPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, dcMessageMeta, saveGames, logGameAction, client } = ctx;
  // Parse: sc_fig_pick_{gameId}_{activatingMsgId}_{rest}
  const full = parseCustomId(interaction.customId, 'sc_fig_pick_');
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
    saveGames(game.gameId);
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
        exhaustAttachment(game, scMsgId, 'Spectre Cell');
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
  // Recipient is "another friendly figure" → ≠ activator. Spend
  // immediately, no bank. bypassCosts: false so terrain/figure
  // adders apply unless the figure's profile bypasses them.
  if (targetMsgId) {
    // "...and may interrupt to perform an attack" (CSV row 83): the chosen
    // figure also gets a free attack after the 2-MP move (alexanbv 2026-06-20;
    // the interrupt attack was text-only). freeAttackBonusPending marks it free;
    // the freeAttackPrompt continuation posts the Declare Attack button.
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[targetFk] = true;
    try {
      const { setupPendingMoveX } = await import('./move-x-handler.js');
      await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
        msgId: targetMsgId,
        figureKey: targetFk,
        playerNum: meta.playerNum,
        spaces: 2,
        source: '[Spectre Cell]',
        threadId: null,
        bypassCosts: false,
        nextAction: { type: 'freeAttackPrompt', payload: { msgId: targetMsgId, playerNum: meta.playerNum, figureKey: targetFk, sourceLabel: '[Spectre Cell]' } },
      });
    } catch (err) {
      console.error('[activation] Spectre Cell picker stamp failed:', err?.message ?? err);
    }
  }

  await interaction.message.edit({
    content: `**[Spectre Cell]** — **${targetDcName}** gains 2 MP (spend immediately, no bank) and may interrupt to perform an attack. (Exhausted)`,
    components: [],
  }).catch(discordCatch);
  await logGameAction?.(game, client, `**[Spectre Cell]** — ${targetDcName} gains 2 MP, may interrupt attack. (Exhausted)`, { phase: 'ACTIVATION', icon: 'card' });
  saveGames(game.gameId);
}

/**
 * Hair Trigger: use interrupt attack
 */
export async function handleHairTriggerUse(interaction, ctx) {
  const { getGame, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // hair_trigger_use_{gameId}_{htMsgId}_{figureKey}
  const suffix = parseCustomId(interaction.customId, 'hair_trigger_use_');
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
  game.freeAttackBonusPending[figureKey] = true;
  const htDcName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await interaction.followUp({
    content: `**Hair Trigger** — **${htDcName}** interrupts! Use the **Attack** button on your DC card to perform a free attack.`,
  }).catch(discordCatch);
  await logGameAction(game, client, `**Hair Trigger** — **${htDcName}** interrupts to perform a free attack.`, { phase: 'ACTIVATION', icon: 'attack' });
  saveGames(game.gameId);
}

/**
 * Hair Trigger: skip
 */
export async function handleHairTriggerSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // hair_trigger_skip_{gameId}_{figureKey}
  const suffix = parseCustomId(interaction.customId, 'hair_trigger_skip_');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const game = getGame(gameId);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (game) saveGames(game.gameId);
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

  // Find eligible targets within 2 spaces (within 3 if ACS attached).
  // Per IACP, figures with an active "cannot be defeated" effect
  // (Maul / Sustained by Rage, Fifth Brother / YWNDM) are NOT
  // selectable — "cannot" overrides the direct-defeat ability text.
  const { isImmuneToDirectDefeat } = await import('../game/damage-pipeline.js');
  const _iwbaAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  const _iwbaMaxRange = cardNameIncludes(_iwbaAtts, 'Advanced Com Systems') ? 3 : 2;
  const targets = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[meta.playerNum] || {})) {
    if (!pos || fk === selfFk) continue;
    if (countGameSpaces(game, selfPos, pos) > _iwbaMaxRange) continue;
    if (isImmuneToDirectDefeat(game, meta.playerNum, fk)) continue;
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
    saveGames(game.gameId);
    return;
  }

  // Store pending state
  setPendingItWillBeAlright(game, {
    cassianMsgId: msgId,
    playerNum: meta.playerNum,
    targets: targets.map(t => ({ figureKey: t.figureKey, dcName: t.dcName, msgId: t.msgId, figIdx: t.figIdx })),
  });

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
  saveGames(game.gameId);
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
    clearPendingItWillBeAlright(game);
    saveGames(game.gameId);
  }
}

/**
 * It Will Be Alright: Pick — defeat chosen figure, then offer free move or attack.
 */
export async function handleItWillBeAlrightPick(interaction, ctx) {
  const { getGame, dcMessageMeta, dcHealthState, saveGames, logGameAction, client, processFigureDefeat } = ctx;
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

  // Direct-defeat: per IACP these abilities skip WHEN_DAMAGED and
  // BEFORE_DEFEATED entirely (the figure does NOT suffer damage). Use
  // applyDirectDefeat which records HP=0, fires WHEN_DEFEATED hooks
  // (Last Stand, Bounty, Apex Predator, etc.), and finalizes via
  // processFigureDefeat.
  const { applyDirectDefeat } = await import('../game/damage-pipeline.js');
  await applyDirectDefeat(game, { dcHealthState, logGameAction, client, processFigureDefeat, dcMessageMeta }, {
    figureKey,
    msgId: targetMsgId,
    figIndex: targetFigIdx,
    controllerPlayerNum: playerNum,
    attackerPlayerNum: oppNum,
    dcName: targetDcName,
    displayName: targetDcName,
    source: 'It Will Be Alright',
  });

  // Offer free move or attack
  const cassianMsgId = pending.cassianMsgId;
  const cassianMeta = dcMessageMeta?.get(cassianMsgId);
  const cassianDisplay = cassianMeta?.displayName || 'Cassian Andor';

  setPendingItWillBeAlright(game, { ...pending, phase: 'action', sacrificed: targetDcName });

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`iwba_action_${gameId}_${cassianMsgId}_move`).setLabel('Free Move').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`iwba_action_${gameId}_${cassianMsgId}_attack`).setLabel('Free Attack').setStyle(ButtonStyle.Danger),
  );

  await interaction.message.edit({
    content: `**It Will Be Alright** — **${targetDcName}** defeated. **${cassianDisplay}** may perform a free move or attack:`,
    components: [actionRow],
  }).catch(discordCatch);
  saveGames(game.gameId);
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
    grantMovementBank(game, cassianMsgId, speed);
    await interaction.message.edit({
      content: `**It Will Be Alright** — **${cassianDisplay}** gains **${speed} MP** (free move).`,
      components: [],
    }).catch(discordCatch);
    await logGameAction(game, client, `**It Will Be Alright** — **${cassianDisplay}** gains ${speed} MP (free move after sacrifice).`, { phase: 'ACTIVATION', icon: 'move' });
  } else {
    // Grant free attack
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    const _iwbaFk = figureKeyForActivation(game, cassianMsgId);
    if (_iwbaFk) game.freeAttackBonusPending[_iwbaFk] = true;
    await interaction.message.edit({
      content: `**It Will Be Alright** — **${cassianDisplay}** may perform a free attack. Use the **Attack** button.`,
      components: [],
    }).catch(discordCatch);
    await logGameAction(game, client, `**It Will Be Alright** — **${cassianDisplay}** gains a free attack (after sacrifice).`, { phase: 'ACTIVATION', icon: 'attack' });
  }

  clearPendingItWillBeAlright(game);
  saveGames(game.gameId);
}
