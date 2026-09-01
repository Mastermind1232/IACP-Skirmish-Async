/**
 * Combat handlers: attack_target_, combat_gate_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { COLORS } from '../discord/colors.js';
import { setPendingCelebration, setPendingCleave, clearPendingCleave, clearPendingCoverFire, clearPendingFalseOrders, setPendingIllicitArms, setPendingThereIsNoTry, setPendingPowerConverter, setPendingZilloDiscard, clearPendingZilloDiscard, clearPendingExecutiveOrder, clearPendingCoordinatedRaid, setPendingSurgeOverflow, clearPendingSurgeOverflow, setPendingRogueOneTokenPick, clearPendingRogueOneTokenPick, clearPendingEmperorInterrupt, clearPendingBombardmentSorin, clearPendingBattlefieldLeadership, setPendingHunterProtocol, setPendingUnhingedDirector, clearPendingUnhingedDirector } from '../game/interrupts.js';
import { sendPowerTokenOverflowUI, TOKEN_EMOJI } from '../discord/power-token-prompts.js';
import { applyStrain, registerStrainFollowup } from './strain-handler.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { consumeActionForCurrentFigure } from '../game/activation-state.js';
import { getDcEffect, figureHasInTheShadows, effectiveDcNameForFigure } from '../game/dc-helpers.js';
import { evaluateRoundModifiers } from '../game/round-modifiers.js';
export { sendPowerTokenOverflowUI };
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { pushNestedCombat, resolvePendingCombat } from '../game/combat-stack.js';
import { getMapData, getMapTokensData, getDcEffects as getDcEffectsGlobal, getDcKeywords as getDcKeywordsGlobal, getLoadoutCards, getFormCards, getFigureSize, getDeploymentZones, getMissionCardsData } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { figureMpRemaining, consumeMovementPoints } from '../game/game-helpers.js';
import { isWithinSpaces as _isWithinSpaces, countSpaces } from '../game/spatial.js';
import { getClosedDoorEdges } from '../game/board-helpers.js';
import { cardNameIncludes } from '../game/card-names.js';
import { canOfferForceExhaustion, removeForceExhaustionDie } from '../game/force-exhaustion-helpers.js';
import { exhaustAttachment, depleteDc, combatSelfAttachmentMsgId, auraAttachmentBearerMsgId } from '../game/card-state-helpers.js';
import { squadUpgradeFigureCard } from '../game/squad-upgrades.js';
import { hasAgileAbility, applyAgileConversion } from '../game/agile-jet-trooper-helpers.js';
import { hasAimAbility, aimBonusApplies, applyAimBonus } from '../game/aim-rebel-trooper-helpers.js';
import { hasTakeCoverAbility, applyTakeCoverBonus } from '../game/take-cover-jawa-helpers.js';
import { hasSlipperyAbility, applySlipperyBonus } from '../game/slippery-smuggler-helpers.js';
import {
  hasDeadPreciseAbility,
  deadPreciseBonusApplies,
  applyDeadPreciseBonus,
} from '../game/dead-precise-kotun-helpers.js';
import { hasAwkwardAbility, awkwardBlocks } from '../game/awkward-atst-helpers.js';
import {
  hasSniperAbility,
  hasEliteSniperAbility,
  sniperGateOpen,
  applySniperRerolls,
} from '../game/sniper-helpers.js';
import {
  hasCompositePlatingAbility,
  compositePlatingApplies,
  applyCompositePlatingBonus,
} from '../game/composite-plating-helpers.js';
import {
  hasGamorreanHonorGuardAbility,
  gamorreanHonorGuardApplies,
  applyGamorreanHonorGuardBonus,
} from '../game/gamorrean-honor-guard-helpers.js';
import {
  hasOverpowerAbility,
  applyOverpowerAttackerReroll,
  applyOverpowerDefenderReroll,
} from '../game/overpower-helpers.js';
import {
  hasForesightAbility,
  hasDefensiveStanceAbility,
  applyDefensiveReroll,
} from '../game/defensive-reroll-helpers.js';
import {
  hasTargetingComputerAbility,
  applyTargetingComputerReroll,
} from '../game/targeting-computer-helpers.js';
import {
  hasChargeGeneratorsAbility,
  chargeGeneratorsApplies,
  applyChargeGeneratorsBonus,
} from '../game/charge-generators-helpers.js';
import { hasSprayFireAbility, applySprayFire } from '../game/spray-fire-helpers.js';
import { hasRaiderAbility, buildRaiderForcedReroll } from '../game/raider-weequay-helpers.js';
import {
  hasSquadTrainingAbility,
  applySquadTrainingReroll,
} from '../game/squad-training-helpers.js';
import { hasQueryAbility, applyQueryBonus } from '../game/query-hk47-helpers.js';
import {
  hasBespinSecurityAbility,
  attackerQualifiesForBespin,
  applyBespinSecurityReroll,
} from '../game/bespin-security-helpers.js';
import {
  hasCortosisWeaveAbility,
  applyCortosisWeave,
} from '../game/cortosis-weave-helpers.js';
import {
  hasFindWeaknessAbility,
  applyFindWeaknessEvade,
} from '../game/find-weakness-helpers.js';
import {
  hasExploitWeaknessAbility,
  defenderHasHarmfulCondition,
  applyExploitWeaknessSurge,
} from '../game/exploit-weakness-helpers.js';
import {
  hasFrontLineAbility,
  hasFrontLineAccuracy,
  frontLineInRange,
  applyFrontLineDieSwap,
} from '../game/front-line-helpers.js';
import {
  hasInspiringAbility,
  applyInspiringReroll,
  INSPIRING_RANGE,
} from '../game/inspiring-helpers.js';
import {
  hasDistractingAbility,
  applyDistractingEvade,
} from '../game/distracting-helpers.js';
import {
  hasCunningAbility,
  applyCunningFlag,
} from '../game/cunning-helpers.js';
import {
  hasKtpEliteAbility,
  hasKtpRegularAbility,
  buildKtpRoundKey,
  isKtpAlreadyUsed,
  KTP_STRAIN_AMOUNT,
} from '../game/keep-the-peace-helpers.js';
// Hunker Down (Cara Dune) is now a mods-window gate passive
// (combat-abilities-mods.js 'hunker_down' → _fireModsPassive) gated on the
// near_terrain_type condition primitive; the inline declaration-time path +
// its hunker-down-helpers imports were removed. alexanbv 2026-06-18.
import {
  hasRelentlessAbility,
  relentlessInRange,
  RELENTLESS_STRAIN_AMOUNT,
} from '../game/relentless-helpers.js';
import {
  hasAcpScattergun,
  hasScattergun,
  scattergunInRange,
  applyScattergunHits,
  ACP_SCATTERGUN_HIT_DELTA,
  SCATTERGUN_HIT_DELTA,
} from '../game/scattergun-helpers.js';
import {
  hasSharpshooterAbility,
  sharpshooterInRange,
  SHARPSHOOTER_CONDITION,
  SHARPSHOOTER_BONUS_DIE,
} from '../game/sharpshooter-helpers.js';
import {
  hasVanguardAbility,
  vanguardInRange,
  applyVanguardDieSwap,
} from '../game/vanguard-helpers.js';
import {
  hasForestFightersAbility,
  forestFightersQualifies,
  applyForestFightersHit,
} from '../game/forest-fighters-helpers.js';
import {
  tripodBlocksAttack,
} from '../game/tripod-eweb-helpers.js';
import { resolveThereIsNoTrySourceFigure, thereIsNoTryInRange, thereIsNoTryRollerEligible } from '../game/there-is-no-try-helpers.js';
import { faceOptionsFor, formatFaceLabel, applyFaceToDie, totalsFor } from '../game/die-face-picker.js';
import {
  hasMuchToLearnAbility,
  muchToLearnInRange,
  isUniqueFriendly,
  isForceUserFriendly,
  applyMuchToLearnReroll,
  resolveMuchToLearnMode,
} from '../game/much-to-learn-helpers.js';
import {
  hasAdvTargetingComputerAbility,
  advTcRerollLostHits,
  applyAdvTcHitBonus,
  ADV_TARGETING_COMPUTER_CONDITION,
  ADV_TARGETING_COMPUTER_BONUS_DIE,
} from '../game/adv-targeting-computer-helpers.js';
import {
  applyShockAndAweDieSwap,
} from '../game/shock-and-awe-helpers.js';
import {
  hasSharedIntuitionAbility,
  sharedIntuitionInRange,
  isHunterFriendly,
  applySharedIntuitionHit,
} from '../game/shared-intuition-helpers.js';
import {
  hasBattleMeditationAbility,
  battleMeditationLabel,
  BATTLE_MEDITATION_CONDITION,
  BATTLE_MEDITATION_BONUS_DIE,
} from '../game/battle-meditation-helpers.js';
import {
  hasFullOfRageAbility,
  fullOfRageDamageTriggered,
  FULL_OF_RAGE_CONDITION,
  FULL_OF_RAGE_BONUS_DIE,
} from '../game/full-of-rage-helpers.js';
// Fury (Wookiee Warrior) is now a gate mods passive ('fury_wookiee'); its
// detection/effect moved to combat-abilities-mods.js + _fireModsPassive, so the
// fury-helpers are no longer imported here. alexanbv 2026-06-18.
import {
  hasMonCalaSfLokuAbility,
  MON_CALA_SF_LOKU_CONDITION,
} from '../game/mon-cala-sf-loku-helpers.js';
import {
  hasSlowOnTheDrawAbility,
} from '../game/slow-on-the-draw-helpers.js';
import {
  figureHasIllicitArms,
  playerArmyAffiliationIsScum,
} from '../game/illicit-arms-helpers.js';
import {
  hasDisposableAbility,
  hasConclusionAbility,
  applyEvadeDebuff,
} from '../game/evade-debuff-helpers.js';
import { reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, applyCondition, applyConditionWithDie, resetCondition, filterCondition, isConditionImmune, dcNameFromFigureKey, parseCoord, getFootprintCells, checkNefariousGains, getMaxPowerTokens, grantPowerTokens, resolveOverflowDiscard, getEffectiveMapSpaces, edgeKey, getInnateRerollAbilities } from '../game/index.js';
import { getPlayerDisplayName } from '../discord/user-helpers.js';
import { renderAttackDiceImage, renderDefenseDiceImage } from '../discord/dice-renderer.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getCcHand, getCcDeck, getCcDiscard, getActivatedDcIndices,
  recomputeActivationCounts,
  ccDiscardKey, ccHandKey, ccDeckKey, ccAttachmentsKey, vpKey,
  opponentPlayerNum, getInitiativePlayerNum,
  removeFigurePosition, getHandChannelId,
} from '../game/player-helpers.js';
import { checkFriendlyDefeatedPassiveRedraws, checkDeckDiscardPassiveRedraws } from '../game/cc-passive-redraw.js';
import { getPlayableReactionCardsForTiming, canPlayCC } from '../game/cc-timing.js';
import { eligibleThirdPartyCcFigures, applyThirdPartyCcEffect, thirdPartyCardName } from '../engine/third-party-ccs.js';
import { applyDefenseDieTurn, applyDefenseDieRemoval } from '../engine/defense-die-turn.js';
import { isLargeTarget, getDeclarableSquares } from '../engine/large-target.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { tokenSpenderFigureKey } from '../engine/combat-abilities-tokens.js';
import { discardCc } from './cc-hand.js';
import { openCcCounterWindow, registerCcCustomResolve, registerCombatGateResume, playCcFull } from './cc-pipeline.js';
import { recalcAttackTotals as _recalcAttackTotals, recalcDefenseTotals as _recalcDefenseTotals } from '../game/combat.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchCombatThread, fetchGameChannel, snowflakeUsers, sanitizeMentions, isAiUserId } from '../discord/channel-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
// Slice C: timing-window gate machine (flag-gated migration, default off).
import { buildModsGate, buildWindowGate } from '../engine/combat-mods-gate.js';
import { buildOnDeclareGate } from '../engine/combat-ondeclare-gate.js';
import { stashPendingModifier, drainPendingModifiers, applyPendingEffect } from '../engine/combat-pending-modifiers.js';
import { driveModsGate, recordModsChoice, passModsSide } from '../engine/combat-mods-orchestrator.js';
import { startSequence as _startSequence, advanceSequence as _advanceSequence } from '../engine/combat-sequence-driver.js';
import { rerollDie as _rerollDie, selectableDieIndices as _selectableDieIndices } from '../engine/combat-reroll.js';
import { pendingForcedRerolls, depletableCardMsgId } from '../engine/combat-abilities-rerolls.js';
import { auraGrantedSurges as _auraGrantedSurges, scrapBattalionGrantedSurges as _scrapBattalionGrantedSurges } from '../engine/surge-auras.js';
import { getCombatAbility } from '../engine/combat-timing-registry.js';
import { markAbilityUsed as _markAbilityUsed, limitGuard as _limitGuard, abilityLimitKey as _abilityLimitKey } from '../engine/combat-conditions.js';

/**
 * Mark a gate ability used for its limit scope after it resolves (alexanbv
 * 2026-06-16: "once a button corresponding to a once/round ability is clicked,
 * after that resolution is complete, the ability should be added to the used
 * list"). Generic — reads the registry params (card/ability/limit); no-op for
 * abilities without a limit.
 */
function _markGateAbilityUsed(game, combat, pick) {
  const reg = getCombatAbility(pick);
  const p = reg?.params;
  if (p?.card && p?.ability) _markAbilityUsed(game, combat, p);
  // Exhaust-on-use (alexanbv 2026-06-17): an exhaust ability exhausts its card
  // ONLY when actually used — not eagerly at declaration. Once exhausted, its
  // `applies` no longer offers it (until the card readies in the status phase).
  if (p?.exhaustOnUse) {
    const mid = combatSelfAttachmentMsgId(combat, reg.side);
    if (mid) exhaustAttachment(game, mid, p.exhaustOnUse);
  }
  // AURA exhaust attachments (Trusted Ally — worn by a friendly figure within N
  // of the attacker): exhaust the BEARER's DC, not the attacker's own (alexanbv
  // 2026-06-18 FIX-4). Re-locate the ready bearer (the one that granted the
  // reroll) and mark it exhausted so it can't be reused until readied.
  if (p?.auraExhaustOnUse) {
    const deps = { getMapData, isWithinSpaces: _isWithinSpaces, getDcList, getDcMessageIds };
    const mid = auraAttachmentBearerMsgId(game, combat, p.auraExhaustOnUse, p.auraRange ?? 3, deps, true);
    if (mid) exhaustAttachment(game, mid, p.auraExhaustOnUse);
  }
  // DEPLETE-on-use (Doubt): the upgrade's cost is "Deplete this card" — deplete
  // it on the OWNER (reg.side's player) the moment the reroll resolves, so the
  // per-deck-cycle limit (gated in `applies` via isDcDepleted) is enforced.
  // alexanbv 2026-06-26 (audit fix).
  if (p?.depleteOnUse) {
    const ownerPN = reg.side === 'attacker'
      ? combat.attackerPlayerNum
      : (combat.defenderPlayerNum ?? (combat.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null));
    if (ownerPN) {
      const mid = depletableCardMsgId(game, ownerPN, p.depleteOnUse);
      if (mid) depleteDc(game, mid, ownerPN);
    }
  }
}

/**
 * Tough Luck (CC) — end-of-rerolls picker (alexanbv 2026-06-30 redesign).
 *
 * NEW BEHAVIOR: no per-reroll pause. At the end of the rerolls gate, each player
 * is offered a single chance to remove any one rerolled opponent die:
 *   • Defender window: can cancel any rerolled attack die (including ones rerolled
 *     by the defender's own abilities — e.g. Tress, HK rerolling attack dice).
 *   • Attacker window: can cancel any rerolled defense die (until start of mods).
 *
 * Called by the rerolls onComplete (both seq-active and legacy paths). Posts a
 * picker to the relevant player's hand channel with one button per unique rerolled
 * opponent die. Returns true if a window was posted (gate must pause), false if
 * neither player has a TL window (advance immediately).
 */
export async function _offerToughLuckFinal(thread, game, combat, ctx) {
  const atkPN = combat.attackerPlayerNum;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(atkPN);

  // Defender window: cancel a rerolled attack die.
  const atkRerolled = (combat._rerolledDice || []).filter((d) => d.pool === 'attack');
  if (!combat._tlFinalDefenderOffered && atkRerolled.length > 0 && defPN
    && (getCcHand(game, defPN) || []).includes('Tough Luck')) {
    combat._tlFinalDefenderOffered = true;
    combat._pendingToughLuckFinal = { phase: 'defender', playerNum: defPN };
    await _postToughLuckFinalPicker(thread, game, combat, ctx, defPN, atkRerolled);
    return true;
  }

  // Attacker window: cancel a rerolled defense die.
  const defRerolled = (combat._rerolledDice || []).filter((d) => d.pool === 'defense');
  if (!combat._tlFinalAttackerOffered && defRerolled.length > 0 && atkPN
    && (getCcHand(game, atkPN) || []).includes('Tough Luck')) {
    combat._tlFinalAttackerOffered = true;
    combat._pendingToughLuckFinal = { phase: 'attacker', playerNum: atkPN };
    await _postToughLuckFinalPicker(thread, game, combat, ctx, atkPN, defRerolled);
    return true;
  }

  // No TL window needed — clean up tracking.
  delete combat._rerolledDice;
  return false;
}

async function _postToughLuckFinalPicker(thread, game, combat, ctx, playerNum, rerolledDice) {
  const ownerId = game[`player${playerNum}Id`] ?? '';
  const buttons = rerolledDice.map(({ pool, index }) => {
    const die = (pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults)?.[index];
    return new ButtonBuilder()
      .setCustomId(`tl_final_remove_${combat.gameId}_${pool}_${index}`)
      .setLabel(`Remove rerolled ${die?.color || ''} ${pool} die`.trim())
      .setStyle(ButtonStyle.Danger);
  });
  buttons.push(
    new ButtonBuilder().setCustomId(`tl_final_skip_${combat.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  const rows = chunkButtonsToRows(buttons).slice(0, 5);
  const _tlHandId = getHandChannelId(game, playerNum);
  const _tlHandCh = _tlHandId && ctx.client
    ? await fetchGameChannel(ctx.client, _tlHandId).catch(() => null)
    : null;
  await (_tlHandCh ?? thread)?.send(sanitizeMentions({
    content: `**Tough Luck** — <@${ownerId}> you may remove any one rerolled die result.`,
    components: rows,
    allowedMentions: { users: [ownerId] },
  })).catch(discordCatch);
}

/**
 * After a reroll resolver completes, offer Double or Nothing on the die just
 * rerolled (combat._lastRerolledDie, set by rerollDie); if a DON window is posted
 * the gate PAUSES (handleDonGate re-drives). Otherwise drive the window normally.
 * Tough Luck is no longer per-reroll — it is offered once at the END of the
 * rerolls gate via _offerToughLuckFinal. alexanbv 2026-06-30.
 */
export async function _driveGateOrOfferToughLuck(window, thread, game, combat, ctx) {
  if (window === 'rerolls' && combat?._lastRerolledDie) {
    const last = combat._lastRerolledDie;
    const { pool, index } = last;
    // Double or Nothing still fires per-reroll (symbol-count comparison reads
    // last.prevSymbols/newSymbols captured at reroll time).
    if (await _offerDoubleOrNothing(game, combat, ctx, thread, pool, index, last)) return;
    delete combat._lastRerolledDie;
  }
  await _driveGatePath(window, thread, game, combat, ctx);
}

/**
 * Double or Nothing (CC, CSV row 625) post-reroll reaction. When a Double or
 * Nothing reroll (game.doubleMatchingIconsOnReroll armed for this side) produced
 * a die with the SAME number of symbols, its CONTROLLER (game.doubleMatchingIconsOnReroll.playerNum)
 * may DOUBLE or CANCEL that die's whole result (or decline). Mirrors the discrete
 * Tough Luck gate (_offerToughLuck → tlgate_* → handleToughLuckGate): stash
 * combat._pendingDoubleOrNothing, post the prompt, PAUSE; handleDonGate applies
 * the pick and resumes. Returns true iff a window was posted.
 * alexanbv 2026-06-20 (replaces the auto-double DON-PARTIAL behavior).
 */
export async function _offerDoubleOrNothing(game, combat, ctx, thread, pool, idx, last) {
  if (!combat || idx == null) return false;
  const don = game.doubleMatchingIconsOnReroll;
  if (!don) return false;
  if (combat.doubleOrNothingApplied) return false;
  // Side must match the rerolled pool (atk → attack die, def → defense die).
  if ((don.side === 'atk' && pool !== 'attack') || (don.side === 'def' && pool !== 'defense')) return false;
  // Only when the symbol count matched (per CSV). Symbol counts captured by rerollDie.
  const prev = last?.prevSymbols ?? null;
  const cur = last?.newSymbols ?? null;
  if (prev == null || cur == null || prev !== cur || cur <= 0) {
    // Count changed (or zero): DON does nothing; consume the arm so it doesn't
    // re-trigger on a later reroll this attack.
    game.doubleMatchingIconsOnReroll = null;
    combat.doubleOrNothingApplied = true;
    await thread?.send(`**Double or Nothing** — Symbol count changed (${prev ?? '?'} → ${cur ?? '?'}). No double/cancel.`).catch(discordCatch);
    return false;
  }
  const controllerPN = don.playerNum;
  if (!controllerPN) return false;
  combat._pendingDoubleOrNothing = { pool, idx, playerNum: controllerPN, symbols: cur };
  const ownerId = game[`player${controllerPN}Id`] ?? '';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dongate_double_${combat.gameId}`).setLabel('Double the result').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dongate_cancel_${combat.gameId}`).setLabel('Cancel the result').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`dongate_skip_${combat.gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  await thread?.send(sanitizeMentions({
    content: `**Double or Nothing** — Same number of symbols (${cur}). <@${ownerId}> may **double** or **cancel** the rerolled ${pool} die's results.`,
    components: [row], allowedMentions: { users: [ownerId] },
  })).catch(discordCatch);
  return true;
}

/**
 * Double or Nothing gate response. The controller doubles, cancels, or declines
 * the rerolled die's whole result; then offers Tough Luck on the same die (the
 * opponent may still react), else resumes the rerolls window.
 * customId: dongate_double_<gameId> | dongate_cancel_<gameId> | dongate_skip_<gameId>.
 */
export async function handleDonGate(interaction, ctx) {
  const { getGame, saveGames, replyIfGameEnded } = ctx;
  const mode = interaction.customId.startsWith('dongate_double_') ? 'double'
    : interaction.customId.startsWith('dongate_cancel_') ? 'cancel' : 'skip';
  const prefix = mode === 'double' ? 'dongate_double_' : mode === 'cancel' ? 'dongate_cancel_' : 'dongate_skip_';
  const parts = splitCustomId(interaction.customId, prefix);
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded?.(game, interaction)) return;
  const combat = game.pendingCombat;
  const don = combat?._pendingDoubleOrNothing;
  if (!don) { await interaction.followUp({ content: 'No pending Double or Nothing.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, don.playerNum, canActAsPlayer, 'Only the Double or Nothing player may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  const dice = don.pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults;
  const die = dice?.[don.idx];
  if (die && mode !== 'skip') {
    if (mode === 'cancel') {
      if (don.pool === 'attack') { die.acc = 0; die.dmg = 0; die.surge = 0; }
      else { die.block = 0; die.evade = 0; die.dodge = false; }
    } else {
      if (don.pool === 'attack') {
        die.acc = (die.acc || 0) * 2; die.dmg = (die.dmg || 0) * 2; die.surge = (die.surge || 0) * 2;
      } else {
        die.block = (die.block || 0) * 2; die.evade = (die.evade || 0) * 2;
        if (die.dodge) die.dodge = (typeof die.dodge === 'number' ? die.dodge : 1) * 2;
      }
    }
    const recalc = don.pool === 'attack' ? _recalcAttackTotals : _recalcDefenseTotals;
    combat[don.pool === 'attack' ? 'attackRoll' : 'defenseRoll'] = recalc(dice);
    const tDesc = don.pool === 'attack'
      ? `${combat.attackRoll.acc} acc, ${combat.attackRoll.dmg} dmg, ${combat.attackRoll.surge} surge`
      : `${combat.defenseRoll.block} block, ${combat.defenseRoll.evade} evade${combat.defenseRoll.dodge ? ' DODGE' : ''}`;
    await thread?.send(`**Double or Nothing** — **${mode === 'cancel' ? 'Cancelled' : 'Doubled'}** the rerolled ${don.pool} die's results. New totals: ${tDesc}.`).catch(discordCatch);
  } else if (mode === 'skip') {
    await thread?.send('**Double or Nothing** — Declined; results unchanged.').catch(discordCatch);
  }
  combat.doubleOrNothingApplied = true;
  game.doubleMatchingIconsOnReroll = null;
  delete combat._pendingDoubleOrNothing;
  // Tough Luck has ALREADY been offered (it now precedes Double or Nothing per the
  // alexanbv 2026-06-20 ordering ruling); the rerolled-die marker is consumed and
  // we simply resume the rerolls window.
  delete combat._lastRerolledDie;
  await _driveGatePath('rerolls', thread, game, combat, ctx);
  saveGames?.(game.gameId);
}
import { activeSide as _modsActiveSide, pendingInteractive as _pendingInteractive } from '../engine/combat-ability-gate.js';

/** F10: Send "Ready to resolve rolls" confirmation step in combat thread; caller should return after.
 * Now uses the combat gate system so both players must confirm.
 *
 * Per CRR + destruct 2026-05-05: Zillo Technique's exhaust window is the
 * canonical 'zillo-window' step (between Step 5 surge spend and Step 7
 * damage calc). The defender sees the attacker's total Pierce — including
 * any surge-Pierce committed in Step 5 — and can choose to exhaust Zillo
 * to reduce by 2. No other ability has this timing window.
 *
 * If Zillo prompts, this defers the pre_resolve gate until the defender
 * responds (handleZilloPierceCancel re-enters this function). Otherwise
 * the pre_resolve gate fires immediately.
 *
 * Slice 6.10 / 3.7-3.8: at this point combat.currentStep should be 'step5'
 * (transitioning to 'zillo-window' or 'step6' depending on Zillo path).
 * The slice 3.7 wiring at the pre_resolve dispatch handles the transition
 * to 'zillo-window' regardless of whether the prompt fires.
 */
export async function sendReadyToResolveRolls(thread, gameId, game, ctx) {
  // Rebuild path: this is the surge-spend → resolve boundary every legacy
  // surge path funnels through. When the attack is on the sequence driver and
  // we're in spend_surges, advance to the damage step instead of posting the
  // legacy resolve button. (One guard covers all the call sites.)
  const _seqCombat = game?.pendingCombat;
  if (_seqCombat?._seqActive && _seqCombat._seqStep === 'spend_surges') {
    await _advanceSequence(_seqCombat, _seqHandlers(thread, game, _seqCombat, ctx));
    return;
  }
}





/**
 * Slice C gate-driven mods path. Self-contained (does not reuse
 * handleCombatPassive) so the legacy flag-off flow is untouched. Drives
 * combat.modsGate: auto-fires passives, posts the player-ordered choose window
 * for interactive abilities, and on completion proceeds to the surge phase.
 */
// Per-step gate config — one generic pipeline serves every window. Each step
// declares its gate field, button-id prefix, optional passive-firer, and what
// to do when the gate completes. Adding a step = one config entry.
const _GATE_WINDOWS = {
  mods: {
    field: 'modsGate', pickPrefix: 'combat_mods_pick_', title: 'Modifiers',
    firePassive: (side, id, thread, game, combat, ctx) => _fireModsPassive(side, id, thread, game, combat, ctx),
    onComplete: async (thread, game, combat, ctx) => { delete combat.modsGate; await proceedAfterTokens(thread, game, combat, ctx); },
  },
  on_declare: {
    field: 'onDeclareGate', pickPrefix: 'combat_ondeclare_pick_', title: 'On-Declare',
    firePassive: (side, id, thread, game, combat, ctx) => _fireOnDeclarePassive(side, id, thread, game, combat, ctx),
    onComplete: async (thread, game, combat, ctx) => { delete combat.onDeclareGate; if (ctx._onDeclareGateDone) await ctx._onDeclareGateDone(thread, game, combat); },
  },
  // Remaining attack windows (alexanbv 2026-06-15 "build the WHOLE sequence with
  // all the gates"). Wired into the config so the generic pick/subchoice/driver
  // layer serves them; their onComplete is set by the sequence driver when the
  // attack walks the windows in order. All behind the gate flag (off in prod).
  rerolls: {
    field: 'rerollsGate', pickPrefix: 'combat_rerolls_pick_', title: 'Rerolls',
    firePassive: null,
    onComplete: async (thread, game, combat, ctx) => {
      // End of attack step 3: resolve Shrewd Scoundrel's deferred double now,
      // after all rerolls (incl. Cheat to Win) have happened (IACP FAQ).
      await _resolveShrewdScoundrel(combat, ctx, thread);
      delete combat.rerollsGate;
      // End-of-rerolls Tough Luck: offer each player a one-time picker for any
      // rerolled opponent die. Pauses if a window is posted; continues when the
      // player responds (handleToughLuckFinalPick calls ctx._rerollsGateDone).
      if (await _offerToughLuckFinal(thread, game, combat, ctx)) return;
      if (ctx._rerollsGateDone) await ctx._rerollsGateDone(thread, game, combat);
    },
  },
  after_resolve: {
    field: 'afterResolveGate', pickPrefix: 'combat_afterresolve_pick_', title: 'After Resolve',
    firePassive: null,
    onComplete: async (thread, game, combat, ctx) => { delete combat.afterResolveGate; if (ctx._afterResolveGateDone) await ctx._afterResolveGateDone(thread, game, combat); },
  },
  special: {
    field: 'specialGate', pickPrefix: 'combat_special_pick_', title: 'Special',
    firePassive: null,
    // ATTACKER-ONLY conditional window (alexanbv 2026-06-25): the only ability
    // that lives here is Zeb's Lasat Honor Guard die-turn. Skip the window
    // entirely (and never prompt the defender) unless the attacker has an
    // eligible die-turn — it is NOT a bilateral always-prompt window.
    onlySide: 'attacker',
    noCcPlay: true, // no CCs live in this step (alexanbv 2026-06-26)
    onComplete: async (thread, game, combat, ctx) => { delete combat.specialGate; if (ctx._specialGateDone) await ctx._specialGateDone(thread, game, combat); },
  },
  // Zillo Technique exhaust window (pierce-cancel) — its own gate step AFTER
  // spend_surges (alexanbv 2026-06-15 "rewire all of the missing resolvers").
  // Previously absent from _GATE_WINDOWS, which would crash the sequence's zillo
  // step; the resolver (zillo_technique_pierce_cancel) already exists.
  zillo: {
    field: 'zilloGate', pickPrefix: 'combat_zillo_pick_', title: 'Zillo Technique',
    firePassive: null,
    // DEFENDER-ONLY conditional window (alexanbv 2026-06-25): only the defender's
    // Zillo pierce-cancel lives here. The attacker has NO zillo window — skip it
    // entirely (and never prompt the attacker) unless the defender is eligible.
    onlySide: 'defender',
    // The only choice is Exhaust-or-not — no submenu, no CCs. Label Done "Skip"
    // so the window reads [Exhaust Zillo Technique → Pierce −2] [Skip] (alexanbv 2026-06-26).
    noCcPlay: true,
    doneLabel: 'Skip',
    onComplete: async (thread, game, combat, ctx) => { delete combat.zilloGate; if (ctx._zilloGateDone) await ctx._zilloGateDone(thread, game, combat); },
  },
};

/** The window whose gate is currently live on `combat` (sequential — at most one). */
function _activeGateWindow(combat) {
  for (const [w, cfg] of Object.entries(_GATE_WINDOWS)) if (combat?.[cfg.field]) return w;
  return null;
}
/** Map a pick/choose customId back to its window via the per-window prefix. */
function _windowForPickCustomId(customId) {
  for (const [w, cfg] of Object.entries(_GATE_WINDOWS)) if (customId.startsWith(cfg.pickPrefix)) return w;
  return null;
}

/** Drive a step's gate (generic). window ∈ keys of _GATE_WINDOWS. */
async function _driveGatePath(window, thread, game, combat, ctx) {
  const cfg = _GATE_WINDOWS[window];
  await driveModsGate(combat[cfg.field], {
    // Self-play / headless: auto-pass empty sides (no live player to click Done),
    // so the always-post-a-window behavior doesn't stall self-driven games.
    autoPassEmpty: !!game.selfPlay,
    firePassive: cfg.firePassive ? (side, id) => cfg.firePassive(side, id, thread, game, combat, ctx) : undefined,
    postChooseWindow: (side, pending) => _postGateChooseWindow(window, side, pending, thread, game, combat),
    onComplete: async () => {
      // When the full attack runs on the sequence driver, a window's completion
      // advances to the next step; otherwise fall back to the window's legacy
      // onComplete (existing flag-on-per-window behavior). Pick handlers re-enter
      // here on each player choice, so this branch must be consistent.
      if (combat._seqActive) {
        delete combat[cfg.field];
        // End-of-rerolls Tough Luck: offer each player a one-time picker for any
        // rerolled opponent die before advancing to the next step (mods).
        if (window === 'rerolls' && await _offerToughLuckFinal(thread, game, combat, ctx)) return;
        await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
      } else {
        await cfg.onComplete(thread, game, combat, ctx);
      }
    },
  });
  ctx.saveGames?.(game.gameId);
}

/**
 * Re-drive the attack gate after a combat CC's counter-window resolves. Invoked
 * via the registry (registerCombatGateResume) from cc-pipeline's
 * _resolveCcCounterWindow once the Negate/Comms window for a combat CC closes —
 * the gate paused on play; this returns to that phase's options. Reconstructs
 * the gate from the stored { window } + pendingCombat (never stores transient
 * handlers). alexanbv 2026-06-17.
 */
export async function resumeCombatGateAfterCc(game, ctx, client) {
  const pend = game?.pendingCombatCcResolve;
  if (!pend) return;
  delete game.pendingCombatCcResolve;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== pend.gameId) { ctx.saveGames?.(game.gameId); return; }
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  // After-attack CC (kind 'after_attack'): re-post the post-resolve window
  // (the same window handleAarFire would have re-posted) now that the play
  // resolved or cancelled. alexanbv 2026-06-17.
  if (pend.kind === 'after_attack') {
    const { postPostResolveWindow } = await import('./after-attack-resolve.js');
    await postPostResolveWindow(thread, game, combat, pend.effectSide, ctx);
    ctx.saveGames?.(game.gameId);
    return;
  }
  // Attack gate CC (after-attack / mid-rerolls DON): re-drive the paused gate.
  const cfg = _GATE_WINDOWS[pend.window];
  if (!cfg || !combat[cfg.field]) { ctx.saveGames?.(game.gameId); return; } // gate already advanced/cleared
  await _driveGatePath(pend.window, thread, game, combat, ctx);
}

// ── Full-attack sequence driver wiring (alexanbv 2026-06-15 rebuild) ──────────
// Shared gate-builder deps + per-window passive-firer.
function _gateDeps(ctx) {
  return { getDcEffects: ctx.getDcEffects, getMapData, isWithinSpaces: _isWithinSpaces, getFigureSize, getSquadCohesionTokens, dcHealthState: ctx.dcHealthState, findDcMessageIdForFigure: ctx.findDcMessageIdForFigure };
}
/**
 * Build the sequence-driver handlers for an in-flight attack. Reconstructed on
 * each event (button click) from thread/game/combat/ctx — never stored on the
 * (serialized) combat object.
 */
function _seqHandlers(thread, game, combat, ctx) {
  const handlers = {
    driveGate: async (step, c) => {
      // after_resolve is not a choose-ability gate — it runs the proven
      // post-resolve window (runAfterResolveWindow): post the attacker step-8
      // Blast/Cleave/Return Fire effects, then close via checkPostCombatSurges →
      // finishCombatResolution (which ends combat — this is the terminal step, so
      // no further advance). The damage step stashed the crossing locals on
      // c._afterResolveArgs (the Set was serialized to an array — rehydrate it).
      if (step === 'after_resolve') {
        const a = c._afterResolveArgs || {};
        delete c._afterResolveArgs;
        await ctx.runAfterResolveWindow(thread, game, c, {
          resultText: a.resultText,
          embedRefreshMsgIds: new Set(a.embedRefreshMsgIds || []),
          ownerId: a.ownerId,
          defenderPlayerNum: a.defenderPlayerNum,
        }, ctx.client);
        return;
      }
      const cfg = _GATE_WINDOWS[step];
      const deps = _gateDeps(ctx);
      const gate = step === 'on_declare'
        ? buildOnDeclareGate(game, c, deps)
        : buildWindowGate(step, game, c, deps);
      c[cfg.field] = gate;
      // Single-sided conditional windows (alexanbv 2026-06-25): 'special'
      // (attacker-only Zeb die-turn) and 'zillo' (defender-only pierce-cancel)
      // are NOT bilateral always-prompt windows. Mark the irrelevant side
      // complete so it is never prompted, and SKIP the whole window when the one
      // relevant side has no eligible ability.
      if (cfg.onlySide && gate.attacker && gate.defender) {
        const otherSide = cfg.onlySide === 'attacker' ? 'defender' : 'attacker';
        gate[otherSide].passivesFired = true;
        gate[otherSide].passed = true;
        const rel = gate[cfg.onlySide];
        const relCount = (rel?.interactive?.length || 0) + (rel?.passive?.length || 0);
        if (relCount === 0) {
          delete c[cfg.field];
          await _advanceSequence(c, _seqHandlers(thread, game, c, ctx));
          return;
        }
      }
      // _driveGatePath drives it (reading cfg.firePassive); its onComplete
      // advances the sequence because c._seqActive is set.
      await _driveGatePath(step, thread, game, c, ctx);
    },
    runMechanic: async (step, c) => {
      if (step === 'roll') {
        // Post the Roll Combat Dice button; handleCombatRoll rolls (Focus die is
        // already in the pool from declaration) and advances the sequence.
        await postRollDiceButton(thread, game, c, ctx);
        return;
      }
      if (step === 'spend_surges') {
        // Compute surge total + post the surge UI; the surge→resolve boundary
        // (sendReadyToResolveRolls) advances the sequence to damage when active.
        await proceedAfterTokens(thread, game, c, ctx);
        return;
      }
      if (step === 'damage') {
        // Damage core: defense-mod accrual → computeCombatResult (dodge +
        // range/acc) → Figurehead interrupt → apply main-target damage + defeat
        // interrupts, all via the existing resolve path. With c._seqActive set,
        // applyDamageAndFinishCombat DEFERS the after_resolve window and stashes
        // c._afterResolveArgs (alexanbv 2026-06-15 "proceed with the separation").
        // Advance to the after_resolve gate ONLY when the core reached that
        // deferral point. If it paused for an interrupt (Figurehead / Extra
        // Protection) or finished early (NPC/crate target → no after_resolve
        // window), _afterResolveArgs is unset and we don't advance here — the
        // resume / early-finish path owns continuation. [Interrupt + NPC resume
        // wiring is a follow-up slice; the normal path is validated end-to-end.]
        await ctx.resolveCombatAfterRolls(game, c, ctx.client);
        if (c._afterResolveArgs && !game.pendingWhenDamagedCcWindow && !game.pendingDefeatCcWindow) await _advanceSequence(c, handlers);
        return;
      }
      // Fallback: unknown mechanic step — advance so the walk never stalls.
      await _advanceSequence(c, handlers);
    },
    onComplete: async (_c) => { /* attack fully resolved — finalize handled by damage step once ported */ },
  };
  return handlers;
}
/** Entry point: run a full attack through the gate sequence (rebuild path). */
export async function runAttackSequence(thread, game, combat, ctx) {
  combat._seqActive = true;
  await _startSequence(combat, _seqHandlers(thread, game, combat, ctx));
}

/**
 * Resume the gate sequence after an interrupt's damage re-entry (alexanbv
 * 2026-06-15 "for all interrupts ... it should go through the sequence; nothing
 * should apply out of sequence"). When an attack walks the sequence
 * (_seqActive) and an interrupt (Figurehead / Extra Protection) paused the
 * damage step, the resume handler re-calls applyDamageAndFinishCombat — which
 * now reaches the deferral point and stashes combat._afterResolveArgs instead of
 * finishing combat. This advances the sequence into the after_resolve gate so
 * the attack continues and finishes IN sequence. No-op for legacy
 * (non-_seqActive) attacks, or if the damage core hasn't reached the deferral
 * point yet (e.g. a second nested interrupt is still pending). Fetches the
 * combat thread itself when callers (in other handler modules) don't have one.
 */
export async function resumeSequenceAfterInterrupt(game, combat, ctx, thread) {
  if (!combat?._seqActive || !combat._afterResolveArgs) return;
  const thr = thread || await ctx.client?.channels?.fetch(combat.combatThreadId);
  await _advanceSequence(combat, _seqHandlers(thr, game, combat, ctx));
}

/**
 * Resume a gate attack that paused the ROLL step for a roll-time interrupt
 * (There Is No Try sets a defense die face before the reroll window). The
 * interrupt handler calls this after resolving — it advances the sequence the
 * same way handleCombatRoll's _seqActive branch does (roll complete → rerolls
 * window). No-op for legacy (non-_seqActive) attacks.
 */
export async function resumeGateAfterRollInterrupt(thread, game, combat, ctx) {
  // Only resume when the sequence is genuinely paused at the roll step (TINT
  // posts its picker there). Guarding on _seqStep avoids mis-advancing if the
  // handler is ever reached in another state.
  if (!combat?._seqActive || combat._seqStep !== 'roll') return false;
  await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
  return true;
}

/**
 * Factory for reroll abilities — the thin resolver every reroll ability shares
 * (alexanbv 2026-06-15 "each ability should call a reroll function with certain
 * inputs: which die can be selected, whether the color can be swapped, …").
 * Posts a die-picker over the currently-selectable dice (selectableDieIndices =
 * the ability's eligibility predicate ∩ the binary reroll lock) and calls the
 * generic rerollDie on the pick. colorSwap (Saska) adds a follow-up color pick.
 * The lock (no die rerolled twice; Zeb/RR exempt) lives inside rerollDie, not
 * here. Mirrors _makeDieTurnResolver's 2-stage prompt/apply + sub-choice flow.
 */
/** Lando's Gambit applies to ANY reroll he takes (alexanbv 2026-06-16): if the
 * side's figure has gambit_lando, the reroll gains an optional color-swap stage
 * ("replace the die with another of the same type before rerolling"). */
function _figureHasGambit(combat, side) {
  const dc = side === 'defender' ? combat.defenderDcName : combat.attackerDcName;
  if (!dc) return false;
  const eff = getDcEffectsGlobal()[dc] || getDcEffectsGlobal()[(dc || '').replace(/\s*\[.*\]\s*$/, '')];
  return (eff?.specialAbilityIds || []).includes('gambit_lando');
}

/** Double ALL symbols on a die (Shrewd Scoundrel / IACP FAQ): attack →
 * acc+dmg+surge ×2; defense → block+evade ×2 and dodge ×2 (a boolean dodge
 * becomes a numeric 2, which recalcDefenseTotals counts as 2). */
export function _doubleDieResults(die, pool) {
  if (!die) return;
  if (pool === 'attack') {
    die.acc = (die.acc || 0) * 2; die.dmg = (die.dmg || 0) * 2; die.surge = (die.surge || 0) * 2;
  } else {
    die.block = (die.block || 0) * 2; die.evade = (die.evade || 0) * 2;
    const dc = die.dodge === true ? 1 : (Number(die.dodge) || 0);
    if (dc > 0) die.dodge = dc * 2;
  }
}

/** Shrewd Scoundrel (Lando) — DEFERRED to the END of the rerolls step (IACP FAQ
 * via alexanbv): if the Resourceful-rerolled die's CURRENT Damage (attack) /
 * Block (defense) count matches the guess, double ALL of that die's symbols.
 * Deferring lets Cheat to Win + any further rerolls resolve first. */
export async function _resolveShrewdScoundrel(combat, ctx, thread) {
  const ss = combat?.shrewdScoundrel;
  if (!ss) return;
  delete combat.shrewdScoundrel;
  const { pool, index, guess } = ss;
  if (typeof guess !== 'number') return;
  const diceField = pool === 'attack' ? 'attackDiceResults' : 'defenseDiceResults';
  const die = combat[diceField]?.[index];
  if (!die) return;
  const checkVal = pool === 'attack' ? (die.dmg || 0) : (die.block || 0);
  const sym = pool === 'attack' ? 'Damage' : 'Block';
  if (checkVal === guess) {
    _doubleDieResults(die, pool);
    const recalc = pool === 'attack' ? ctx?.recalcAttackTotals : ctx?.recalcDefenseTotals;
    if (recalc) combat[pool === 'attack' ? 'attackRoll' : 'defenseRoll'] = recalc(combat[diceField]);
    await thread?.send(`**Shrewd Scoundrel** — guessed ${guess} ${sym}, matched: that die's results are DOUBLED.`).catch(discordCatch);
  } else {
    await thread?.send(`**Shrewd Scoundrel** — guessed ${guess} ${sym}, die shows ${checkVal} (no match).`).catch(discordCatch);
  }
}

/** Resourceful (Lando) — staged reroll resolver (alexanbv 2026-06-16):
 * pick a die (attack OR defense) → Gambit color-swap (if Lando has Gambit) →
 * Shrewd Scoundrel guess (if Lando has it) → reroll. The Shrewd double is
 * DEFERRED to the end of the rerolls step (_resolveShrewdScoundrel). */
function _makeResourcefulResolver(side) {
  const sk = '_rrResourceful';
  const eff = (combat) => {
    const dc = side === 'defender' ? combat.defenderDcName : combat.attackerDcName;
    return getDcEffectsGlobal()[dc] || getDcEffectsGlobal()[(dc || '').replace(/\s*\[.*\]\s*$/, '')];
  };
  // Shrewd Scoundrel is once per activation (CSV) — only offer the guess if Lando
  // has the ability AND it hasn't already been used this activation. alexanbv 2026-06-17.
  const _shrewdLimit = (game, combat) =>
    _limitGuard('once per activation', _abilityLimitKey('Lando Calrissian', 'Shrewd Scoundrel'))(game, combat);
  const hasShrewd = (game, combat) =>
    (eff(combat)?.specialAbilityIds || []).includes('shrewd_scoundrel_lando') && _shrewdLimit(game, combat);
  const dieField = (pool) => (pool === 'attack' ? 'attackDiceResults' : 'defenseDiceResults');
  const postSub = (thread, gameId, id, content, btns) => thread?.send(sanitizeMentions({
    content,
    components: chunkButtonsToRows(btns.map(([c, l, s]) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${id}`).setLabel(l).setStyle(_modsStyle(s)))),
  })).catch(discordCatch);
  const guessBtns = [['g0', 'Guess 0'], ['g1', 'Guess 1'], ['g2', 'Guess 2'], ['gskip', 'No guess', 'secondary']];
  return {
    prompt: ({ combat }) => {
      const atk = _selectableDieIndices(combat, { pool: 'attack' });
      const def = _selectableDieIndices(combat, { pool: 'defense' });
      return {
        content: '**Resourceful** (Lando) — choose a die to reroll:',
        buttons: [
          ...atk.map((i) => [`a${i}`, `Reroll attack die #${i + 1}`]),
          ...def.map((i) => [`d${i}`, `Reroll defense die #${i + 1}`]),
          ['skip', 'Skip', 'secondary'],
        ],
      };
    },
    apply: async (choice, { game, combat, ctx, thread, gameId, id }) => {
      const st = combat[sk] || {};
      const doReroll = async () => {
        // Store the Shrewd guess for the DEFERRED double (end of rerolls step).
        if (typeof st.guess === 'number') combat.shrewdScoundrel = { pool: st.pool, index: st.index, guess: st.guess };
        const res = _rerollDie(combat, ctx, { pool: st.pool, index: st.index, newColor: st.newColor });
        if (res.ok) await _sendRerollResult(thread, st.pool, `**Resourceful** — rerolled ${st.pool} die #${st.index + 1}.`, res.newDie);
        else await thread?.send(`**Resourceful** — die #${st.index + 1} not rerolled (${res.reason}).`).catch(discordCatch);
        delete combat[sk];
      };
      const askGuess = async () => { st.stage = 'guess'; await postSub(thread, gameId, id, '**Shrewd Scoundrel** — guess the number of Damage/Block on the die after rerolls (0-2):', guessBtns); return { followUp: true }; };
      if (!st.stage) {
        if (choice === 'skip') { delete combat[sk]; await thread?.send('**Resourceful** — Skipped.').catch(discordCatch); return undefined; }
        st.pool = choice[0] === 'd' ? 'defense' : 'attack';
        st.index = parseInt(choice.slice(1), 10);
        combat[sk] = st;
        if (_figureHasGambit(combat, side)) {
          st.stage = 'gambit';
          const die = combat[dieField(st.pool)]?.[st.index];
          const colors = st.pool === 'attack' ? ['blue', 'green', 'red', 'yellow'] : ['white', 'black'];
          await postSub(thread, gameId, id, `**Gambit** — replace die #${st.index + 1} with another of the same type, or keep:`, [...colors.map((c) => [c, c, 'primary']), ['keep', `Keep ${die?.color || 'color'}`, 'secondary']]);
          return { followUp: true };
        }
        if (hasShrewd(game, combat)) return askGuess();
        await doReroll(); return undefined;
      }
      if (st.stage === 'gambit') {
        st.newColor = choice === 'keep' ? undefined : choice;
        if (hasShrewd(game, combat)) return askGuess();
        await doReroll(); return undefined;
      }
      if (st.stage === 'guess') {
        st.guess = choice === 'gskip' ? null : parseInt(choice.slice(1), 10);
        // A real guess (not "No guess") USES Shrewd Scoundrel — mark its
        // once-per-activation limit so Resourceful's later rerolls this
        // activation won't re-offer the guess. alexanbv 2026-06-17.
        if (typeof st.guess === 'number') {
          _markAbilityUsed(game, combat, { card: 'Lando Calrissian', ability: 'Shrewd Scoundrel', limit: 'once per activation' });
        }
        await doReroll(); return undefined;
      }
      return undefined;
    },
  };
}

function _makeRerollResolver({ name, pool, side, eligible, colorSwap = false, dieColor = null, strainCost = 0, stageKey = 'rr' }) {
  // Die-color restriction (Overpower: only RED/BLACK dice selectable). Composed
  // with any passed-in eligibility filter. A SELECTION filter, not a color swap.
  if (dieColor) {
    const base = eligible;
    eligible = (d, i) => (!base || base(d, i)) && String(d?.color || '').toLowerCase() === dieColor;
  }
  // pool 'any' — "choose 1 die; the player that rolled it must reroll it"
  // (Precision, Raider). The owner may pick EITHER pool's die (typically to
  // force the opponent to reroll a good die), so offer attack + defense dice as
  // a<i>/d<i> buttons. No color swap on these (Gambit is Lando-only).
  // alexanbv 2026-06-17 — the data-driven gate previously mis-pooled these to
  // the owner's own attack dice only.
  if (pool === 'any') {
    const lbl = (p, d) => p === 'attack'
      ? `${d?.acc || 0}a/${d?.dmg || 0}d/${d?.surge || 0}s`
      : `${d?.block || 0}b/${d?.evade || 0}e${d?.dodge ? '/dodge' : ''}`;
    return {
      prompt: ({ combat }) => {
        const atk = _selectableDieIndices(combat, { pool: 'attack' });
        const def = _selectableDieIndices(combat, { pool: 'defense' });
        if (atk.length + def.length === 0) return { content: `**${name}** — no eligible die to reroll.`, buttons: [['skip', 'OK', 'secondary']] };
        const ad = combat.attackDiceResults || [], dd = combat.defenseDiceResults || [];
        return {
          content: `**${name}** — choose any die; the player that rolled it rerolls it:`,
          buttons: [
            ...atk.map((i) => [`a${i}`, `Attack #${i + 1} (${lbl('attack', ad[i])})`]),
            ...def.map((i) => [`d${i}`, `Defense #${i + 1} (${lbl('defense', dd[i])})`]),
            ['skip', 'Skip', 'secondary'],
          ],
        };
      },
      apply: async (choice, { combat, thread, ctx }) => {
        if (choice === 'skip') { thread?.send(`**${name}** — Skipped.`).catch(discordCatch); return undefined; }
        const p = choice[0] === 'd' ? 'defense' : 'attack';
        const idx = parseInt(choice.slice(1), 10);
        const res = _rerollDie(combat, ctx, { pool: p, index: idx });
        if (res.ok) await _sendRerollResult(thread, p, `**${name}** — rerolled ${p} die #${idx + 1} → ${lbl(p, res.newDie)}.`, res.newDie);
        else thread?.send(`**${name}** — die #${idx + 1} not rerolled (${res.reason}).`).catch(discordCatch);
        return undefined;
      },
    };
  }
  const wantsColorSwap = (combat) => colorSwap || _figureHasGambit(combat, side);
  const diceField = pool === 'attack' ? 'attackDiceResults' : 'defenseDiceResults';
  const dieLabel = (d) => pool === 'attack'
    ? `${d?.acc || 0}a/${d?.dmg || 0}d/${d?.surge || 0}s`
    : `${d?.block || 0}b/${d?.evade || 0}e${d?.dodge ? '/dodge' : ''}`;
  return {
    prompt: ({ combat }) => {
      const idxs = _selectableDieIndices(combat, { pool, eligible });
      if (idxs.length === 0) return { content: `**${name}** — no eligible ${pool} die to reroll.`, buttons: [['skip', 'OK', 'secondary']] };
      const dice = combat[diceField] || [];
      return { content: `**${name}** — choose a ${pool} die to reroll:`, buttons: [...idxs.map((i) => [String(i), `Die #${i + 1} (${dieLabel(dice[i])})`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: async (choice, { game, combat, thread, ctx, gameId, id }) => {
      const sk = `_${stageKey}`;
      if (choice === 'skip') { delete combat[`${sk}Stage`]; delete combat[`${sk}Die`]; thread?.send(`**${name}** — Skipped.`).catch(discordCatch); return undefined; }
      // colorSwap (incl. Lando's Gambit): stage 1 picks the die, stage 2 the color.
      const _cs = wantsColorSwap(combat);
      if (_cs && combat[`${sk}Stage`] !== 'color') {
        combat[`${sk}Die`] = parseInt(choice, 10); combat[`${sk}Stage`] = 'color';
        const die = combat[diceField]?.[combat[`${sk}Die`]];
        const colors = pool === 'attack' ? ['blue', 'green', 'red', 'yellow'] : ['white', 'black'];
        const btns = [...colors.map((c) => [c, c, 'primary']), [die?.color || 'keep', `Keep ${die?.color || 'color'}`, 'secondary']];
        await thread?.send(sanitizeMentions({ content: `**${name}** — choose the new color for die #${combat[`${sk}Die`] + 1}:`, components: chunkButtonsToRows(btns.map(([c, l, s]) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${id}`).setLabel(l).setStyle(_modsStyle(s)))) })).catch(discordCatch);
        return { followUp: true };
      }
      const idx = _cs ? combat[`${sk}Die`] : parseInt(choice, 10);
      const newColor = _cs && ['blue', 'green', 'red', 'yellow', 'white', 'black'].includes(choice) ? choice : undefined;
      const res = _rerollDie(combat, ctx, { pool, index: idx, newColor });
      if (res.ok) {
        await _sendRerollResult(thread, pool, `**${name}** — rerolled ${pool} die #${idx + 1} → ${dieLabel(res.newDie)}.`, res.newDie);
        // Strain cost on use (Rancor's Trained: "suffer 1 Strain to reroll"). The
        // attacker pays it AFTER a successful reroll. alexanbv 2026-06-18.
        if (strainCost && game) {
          await applyStrain(game, ctx, { figureKey: combat.attackerFigureKey, controllerPlayerNum: combat.attackerPlayerNum, amount: strainCost, source: name });
          thread?.send(`**${name}** — suffered ${strainCost} Strain.`).catch(discordCatch);
        }
      } else thread?.send(`**${name}** — die #${idx + 1} not rerolled (${res.reason}).`).catch(discordCatch);
      delete combat[`${sk}Stage`]; delete combat[`${sk}Die`];
      return undefined;
    },
  };
}

/**
 * GATE forcedRerollQueue-drain resolver (gate-rework 2026-06-18). Slot `i` for a
 * side consumes the i-th pending queue entry the side controls — a reroll grant
 * pushed by the legacy path (Guardian Stance, Battlefield Awareness, Cross
 * Training, Doubt, Demoralizing Monologue, Versatile Weaponry, Raider, …) that the
 * data-driven loop skips (attack_side='None'). Applies the reroll through the
 * SAME generic reroll path (_rerollDie / the shared lock) per the entry's pool,
 * then decrements `remaining` (clearing the entry when it hits 0). The reroll is
 * optional (a Skip button) — declining leaves the entry for later.
 */
function _makeForcedRerollResolver({ slot, side }) {
  const lbl = (p, d) => p === 'attack'
    ? `${d?.acc || 0}a/${d?.dmg || 0}d/${d?.surge || 0}s`
    : `${d?.block || 0}b/${d?.evade || 0}e${d?.dodge ? '/dodge' : ''}`;
  const me = (combat) => pendingForcedRerolls(combat, side)[slot];
  return {
    prompt: ({ combat }) => {
      const entry = me(combat)?.entry;
      if (!entry) return { content: '**Granted Reroll** — none pending.', buttons: [['skip', 'OK', 'secondary']] };
      const pool = entry.pool || 'any';
      const src = entry.source ? `${entry.source} — ` : '';
      if (pool === 'any') {
        const atk = _selectableDieIndices(combat, { pool: 'attack' });
        const def = _selectableDieIndices(combat, { pool: 'defense' });
        const ad = combat.attackDiceResults || [], dd = combat.defenseDiceResults || [];
        return {
          content: `**${src}Granted Reroll** — choose any die to reroll:`,
          buttons: [
            ...atk.map((i) => [`a${i}`, `Attack #${i + 1} (${lbl('attack', ad[i])})`]),
            ...def.map((i) => [`d${i}`, `Defense #${i + 1} (${lbl('defense', dd[i])})`]),
            ['skip', 'Skip', 'secondary'],
          ],
        };
      }
      const idxs = _selectableDieIndices(combat, { pool });
      const dice = (pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults) || [];
      return {
        content: `**${src}Granted Reroll** — choose a ${pool} die to reroll:`,
        buttons: [...idxs.map((i) => [String(i), `Die #${i + 1} (${lbl(pool, dice[i])})`]), ['skip', 'Skip', 'secondary']],
      };
    },
    apply: async (choice, { combat, ctx, thread }) => {
      const found = me(combat);
      if (!found) return undefined;
      const entry = found.entry;
      if (choice === 'skip') { await thread?.send(`**${entry.source || 'Granted Reroll'}** — Skipped.`).catch(discordCatch); return undefined; }
      const pool = entry.pool || 'any';
      let p, idx;
      if (pool === 'any') { p = choice[0] === 'd' ? 'defense' : 'attack'; idx = parseInt(choice.slice(1), 10); }
      else { p = pool; idx = parseInt(choice, 10); }
      const res = _rerollDie(combat, ctx, { pool: p, index: idx });
      if (res.ok) await _sendRerollResult(thread, p, `**${entry.source || 'Granted Reroll'}** — rerolled ${p} die #${idx + 1} → ${lbl(p, res.newDie)}.`, res.newDie);
      else await thread?.send(`**${entry.source || 'Granted Reroll'}** — die #${idx + 1} not rerolled (${res.reason}).`).catch(discordCatch);
      // Demoralizing Monologue (Moff Gideon): record which DEFENSE die the
      // attacker chose to reroll so computeCombatResult can REMOVE that die's
      // results when the attacker revealed 2+ cards
      // (combat.demoralizingMonologueRemoveDie). Captured here — the only point
      // that knows the chosen index — and consumed at scoring. alexanbv 2026-06-26.
      if (res.ok && entry.demoralizingMonologue && p === 'defense') {
        combat.demoralizingMonologueDieIndex = idx;
      }
      // Decrement the consumed grant; clear it when exhausted.
      entry.remaining = (entry.remaining ?? 1) - 1;
      return undefined;
    },
  };
}

/**
 * Exhaust-attachment bonus resolver (Scavenged Weaponry +1 Damage, Explosive
 * Armaments Blast 1, Feeding Frenzy +1 Damage) — alexanbv 2026-06-17. No sub-choice:
 * clicking the button applies the stat bonus; the gate's _markGateAbilityUsed
 * then exhausts the attachment (params.exhaustOnUse). Replaces the eager
 * declaration handling so the card exhausts ONLY when the player uses it.
 */
function _makeExhaustBonusResolver({ card, effect, label }) {
  return {
    apply: async (_choice, { combat, thread }) => {
      if (effect === 'hit') combat.bonusHits = (combat.bonusHits || 0) + 1;
      else if (effect === 'blast') combat.bonusBlast = (combat.bonusBlast || 0) + 1;
      await thread?.send(`**${card}** — Exhausted: ${label} applied to this attack.`).catch(discordCatch);
    },
  };
}

/**
 * Reusable "spend/discard a resource → apply a bonus" mods resolver (FIX-2,
 * alexanbv 2026-06-18). Pattern: optionally spend one of a resource X for a stat
 * bonus Y. Stage 1 lists the spendable resources as buttons (+ Skip); on a pick,
 * `spend(choice, args)` removes that resource and the bonus is applied, then a log
 * line is posted. No multi-stage. Used by Rogue One (discard an ally Power Token →
 * +1 Damage), Illicit Arms (discard a Command card → +1 Damage), Zillo Block Boost
 * (discard a Command card → +1 Block).
 *   options(game, combat) → [[choice, label], …] of spendable resources
 *   spend(choice, { game, combat }) → mutate state to remove the resource; return
 *        a short description of what was spent (or null to abort)
 *   bonus(combat) → mutate combat to apply the stat bonus; return its label
 */
function _makeSpendResourceResolver({ name, options, spend, bonus, ephemeral = false }) {
  return {
    // ephemeral:true → the sub-choice prompt is posted privately to the picking
    // player (handleModsPick) instead of the shared combat thread. Used for
    // CC-discard resolvers (Zillo Block-Boost, Illicit Arms) whose options list
    // the player's HAND — posting them publicly leaks the hand (alexanbv 2026-06-26).
    prompt: ({ game, combat }) => {
      const opts = options(game, combat) || [];
      if (opts.length === 0) return { content: `**${name}** — nothing to spend.`, buttons: [['skip', 'OK', 'secondary']], ephemeral };
      return { content: `**${name}** — choose a resource to spend:`, buttons: [...opts, ['skip', 'Skip', 'secondary']], ephemeral };
    },
    apply: async (choice, args) => {
      const { thread } = args;
      if (choice === 'skip') { thread?.send(`**${name}** — Skipped.`).catch(discordCatch); return undefined; }
      const spent = await spend(choice, args);
      if (spent == null) { thread?.send(`**${name}** — could not spend that resource.`).catch(discordCatch); return undefined; }
      const label = bonus(args.combat);
      thread?.send(`**${name}** — discarded ${spent}: ${label} applied.`).catch(discordCatch);
      return undefined;
    },
  };
}

// _discardCcFromHand was removed (alexanbv 2026-06-26): the Illicit Arms /
// Zillo Technique cost-discards now route through the central discardCc choke
// point (imported from cc-hand.js) so the card is REVEALED publicly AND
// when-discarded passives fire.

/** Mods-step convenience wrapper (existing call sites unchanged). */
async function _driveModsGatePath(thread, game, combat, ctx) {
  return _driveGatePath('mods', thread, game, combat, ctx);
}

/**
 * Factory for 2-stage "turn an attack die to a chosen face" abilities (Zeb /
 * Lasat Honor Guard, Rapid Recalibration). Stage 1 picks which die; stage 2
 * picks the new face (posted as a follow-up, returning { followUp: true } so the
 * gate waits). Mirrors handleLasatFacePick's recompute of combat.attackRoll.
 */
function _makeDieTurnResolver({ name, eligible, phaseFlag, stageKey }) {
  return {
    prompt: ({ combat }) => {
      const dice = combat.attackDiceResults || [];
      const idxs = eligible(dice);
      if (idxs.length === 0) return { content: `**${name}** — no eligible attack die to turn.`, buttons: [['skip', 'OK', 'secondary']] };
      return { content: `**${name}** — choose an attack die to turn:`, buttons: [...idxs.map((i) => [String(i), `Die #${i + 1} (${dice[i].dmg || 0}d/${dice[i].surge || 0}s/${dice[i].acc || 0}a)`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: async (choice, { combat, thread, ctx, gameId, id }) => {
      if (choice === 'skip') { if (phaseFlag) combat[phaseFlag] = false; thread?.send(`**${name}** — Skipped.`).catch(discordCatch); return undefined; }
      const sk = `_${stageKey}`;
      if (combat[`${sk}Stage`] !== 'face') {
        combat[`${sk}Die`] = parseInt(choice, 10); combat[`${sk}Stage`] = 'face';
        const die = combat.attackDiceResults?.[combat[`${sk}Die`]];
        // Shared picker (alexanbv 2026-08-31: "all these die turn abilities
        // should use similar functions"). faceOptionsFor deduplicates, so a die
        // whose sheet repeats a face no longer offers the same button twice.
        const faces = faceOptionsFor('attack', die?.color);
        const btns = faces.map((f, fi) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${fi}_${id}`).setLabel(formatFaceLabel('attack', f).slice(0, 80)).setStyle(ButtonStyle.Primary));
        await thread?.send({ content: `**${name}** — choose the new face for die #${combat[`${sk}Die`] + 1}:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
        return { followUp: true };
      }
      const dieIdx = combat[`${sk}Die`]; const faceIdx = parseInt(choice, 10);
      const die = combat.attackDiceResults?.[dieIdx];
      const newFace = faceOptionsFor('attack', die?.color)[faceIdx];
      if (die && newFace) {
        // Re-total from the whole pool rather than adding and subtracting one
        // die: the old arithmetic clamped each term at 0 independently, so a
        // turn could quietly lose damage when another effect had already
        // reduced the running total.
        combat.attackDiceResults[dieIdx] = applyFaceToDie('attack', die, newFace);
        combat.attackRoll = { ...(combat.attackRoll || {}), ...totalsFor('attack', combat.attackDiceResults) };
        thread?.send(`**${name}** — die #${dieIdx + 1} turned to ${formatFaceLabel('attack', newFace)}.`).catch(discordCatch);
      }
      if (phaseFlag) combat[phaseFlag] = false; delete combat[`${sk}Stage`]; delete combat[`${sk}Die`];
      return undefined;
    },
  };
}

/**
 * Defense-pool die-turn resolver (alexanbv 2026-06-16) — mirrors _makeDieTurnResolver
 * but turns a DEFENSE die (block/evade/dodge). `dodgeConversion` (Yoda / There Is No
 * Try, defender side) makes a Dodge on the turned die count as 2 Blocks + 1 Evade.
 * 2-stage: pick die → pick face; recompute via applyDefenseDieTurn.
 */
function _makeDefenseDieTurnResolver({ name, eligible, stageKey, dodgeConversion = false }) {
  return {
    prompt: ({ combat }) => {
      const dice = combat.defenseDiceResults || [];
      const idxs = (eligible ? eligible(dice) : dice.map((_d, i) => i));
      if (idxs.length === 0) return { content: `**${name}** — no eligible defense die to turn.`, buttons: [['skip', 'OK', 'secondary']] };
      return { content: `**${name}** — choose a defense die to turn:`, buttons: [...idxs.map((i) => [String(i), `Die #${i + 1} (${dice[i].block || 0}b/${dice[i].evade || 0}e${dice[i].dodge ? '/dodge' : ''})`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: async (choice, { combat, thread, ctx, gameId, id }) => {
      if (choice === 'skip') { thread?.send(`**${name}** — Skipped.`).catch(discordCatch); return undefined; }
      const sk = `_${stageKey}`;
      if (combat[`${sk}Stage`] !== 'face') {
        combat[`${sk}Die`] = parseInt(choice, 10); combat[`${sk}Stage`] = 'face';
        const die = combat.defenseDiceResults?.[combat[`${sk}Die`]];
        const faces = ctx?.getDiceData?.().defense?.[die?.color] || [];
        const btns = faces.map((f, fi) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${fi}_${id}`).setLabel(`${f.block || 0}b/${f.evade || 0}e${f.dodge ? '/dodge' : ''}`.slice(0, 80)).setStyle(ButtonStyle.Primary));
        await thread?.send({ content: `**${name}** — choose the new face for die #${combat[`${sk}Die`] + 1}:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
        return { followUp: true };
      }
      const dieIdx = combat[`${sk}Die`]; const faceIdx = parseInt(choice, 10);
      const die = combat.defenseDiceResults?.[dieIdx];
      const newFace = (ctx?.getDiceData?.().defense?.[die?.color] || [])[faceIdx];
      if (die && newFace) {
        const roll = applyDefenseDieTurn(combat, dieIdx, newFace, dodgeConversion);
        thread?.send(`**${name}** — die #${dieIdx + 1} → ${newFace.block || 0}b/${newFace.evade || 0}e${newFace.dodge ? (dodgeConversion ? ' (Dodge → 2 Blocks + 1 Evade)' : '/dodge') : ''}. Defense now ${roll?.block || 0}b/${roll?.evade || 0}e${roll?.dodge ? '/dodge' : ''}.`).catch(discordCatch);
      }
      delete combat[`${sk}Stage`]; delete combat[`${sk}Die`];
      return undefined;
    },
  };
}

/**
 * Data-driven combat-ability resolvers (alexanbv 2026-06-14). Each ability
 * "points into" the pipeline by registering how it resolves when the player
 * picks it — the gate handlers are GENERIC and never name a specific ability.
 *   prompt(args) → { content, buttons: [[choice,label,style?]], mentionUserId? }
 *                  or null to apply immediately (no sub-choice).
 *   apply(choice, args) → mutate combat; may return { followUp: true } for a
 *                  multi-stage ability that posted its next prompt.
 *   args = { game, combat, thread, ctx, side, gameId, id }
 * Abilities not yet in this map fall back to the legacy inline handling.
 */
/**
 * Capitalize (CC) — alexanbv 2026-06-17. The attacker plays it while attacking
 * to reroll 1 die of EITHER pool (attack OR defense — unlike Battlefield
 * Awareness which is attack-only). Offer every selectable die as a<i>/d<i>;
 * clicking discards the CC (playCC) and rerolls the chosen die via the shared
 * lock. No figure-picker (it's the attacker's own hand card).
 */

// Die-order for Force Exhaustion picker (weakest first).
const _FE_DIE_ORDER = Object.freeze({ yellow: 0, green: 1, blue: 2, red: 3 });

// Shared tail of Force Exhaustion after the die is removed: apply Weaken to
// the attacker, then either force a miss (target is The Child) or proceed.
// Mirrors _resolveForceExhaustionAfterDiePick in combat-reactions.js but lives
// here to avoid a circular import (combat-reactions.js → combat.js).
async function _resolveFeAfterDiePick(game, combat, fe, thread, ctx, removedColor) {
  const atkFk = combat?.attackerFigureKey ?? fe.attackerFigureKey;
  if (atkFk && !isConditionImmune(game, atkFk)) {
    applyCondition(game, atkFk, 'Weaken');
    if (combat && Array.isArray(combat.attackerConds) && !combat.attackerConds.includes('Weaken')) {
      combat.attackerConds.push('Weaken');
    }
  }
  if (fe.targetIsChild) {
    if (combat?.attackerFigureKey) {
      filterCondition(game, combat.attackerFigureKey, 'Focus');
      filterCondition(game, combat.attackerFigureKey, 'Hide');
      if (Array.isArray(combat.attackerConds)) {
        combat.attackerConds = combat.attackerConds.filter((c) => c !== 'Focus' && c !== 'Hide');
      }
    }
    if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, `**Force Exhaustion** — The Child became Incapacitated.${removedColor ? ` 1 ${removedColor} attack die removed,` : ''} attacker Weakened, and the attack misses.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    if (combat) {
      combat.forceMiss = true;
      await _forceMissAndStep8(thread, game, combat, ctx, `**Force Exhaustion** — **The Child** is now **Incapacitated**. The attack **misses** — no dice are rolled.`);
    }
  } else {
    if (thread) await thread.send(`**Force Exhaustion** — **The Child** is now **Incapacitated**. Attacker is **Weakened**. The attack proceeds with the reduced dice.`).catch(discordCatch);
    if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, `**Force Exhaustion** — The Child became Incapacitated.${removedColor ? ` 1 ${removedColor} attack die removed,` : ''} attacker Weakened. Attack proceeds.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
}

function _makeCapitalizeResolver() {
  const lbl = (p, d) => p === 'attack'
    ? `${d?.acc || 0}a/${d?.dmg || 0}d/${d?.surge || 0}s`
    : `${d?.block || 0}b/${d?.evade || 0}e${d?.dodge ? '/dodge' : ''}`;
  return {
    prompt: ({ combat }) => {
      const atk = _selectableDieIndices(combat, { pool: 'attack' });
      const def = _selectableDieIndices(combat, { pool: 'defense' });
      if (atk.length + def.length === 0) return { content: '**Capitalize** — no eligible die to reroll.', buttons: [['skip', 'OK', 'secondary']] };
      const ad = combat.attackDiceResults || [], dd = combat.defenseDiceResults || [];
      return {
        content: '**Capitalize** — choose any die; the player that rolled it rerolls it:',
        buttons: [
          ...atk.map((i) => [`a${i}`, `Attack #${i + 1} (${lbl('attack', ad[i])})`]),
          ...def.map((i) => [`d${i}`, `Defense #${i + 1} (${lbl('defense', dd[i])})`]),
          ['skip', 'Skip', 'secondary'],
        ],
      };
    },
    apply: async (choice, { game, combat, ctx, thread }) => {
      if (choice === 'skip') { await thread?.send('**Capitalize** — Skipped.').catch(discordCatch); return undefined; }
      // Capitalize is already discarded at gate-pick (Negate/Comms ran first); this
      // resolver now runs post-window, so it just rerolls — no playCC here.
      const p = choice[0] === 'd' ? 'defense' : 'attack';
      const idx = parseInt(choice.slice(1), 10);
      const res = _rerollDie(combat, ctx, { pool: p, index: idx });
      if (res.ok) await _sendRerollResult(thread, p, `**Capitalize** — rerolled ${p} die #${idx + 1} → ${lbl(p, res.newDie)}.`, res.newDie);
      else await thread?.send(`**Capitalize** — die #${idx + 1} not rerolled (${res.reason}).`).catch(discordCatch);
      return undefined;
    },
  };
}

export const COMBAT_RESOLVERS = {
  // Capitalize (CC) — attacker rerolls any attack/defense die (pool 'any').
  capitalize: _makeCapitalizeResolver(),
  // Resourceful (Lando Calrissian) — staged resolver folding in Gambit
  // (color-swap) + Shrewd Scoundrel (deferred double). alexanbv 2026-06-16.
  'reroll:lando_calrissian:attacker': _makeResourcefulResolver('attacker'),
  'reroll:lando_calrissian:defender': _makeResourcefulResolver('defender'),
  // Twin Sabers (Ahsoka Tano) — bespoke reroll resolver (alexanbv 2026-06-16:
  // "rerolls ALL attack dice or ALL defense dice, except dice already
  // rerolled"). The attacker chooses to reroll all of their own attack pool, OR
  // force the defender to reroll all of their defense pool. selectableDieIndices
  // already excludes already-rerolled dice (the combined lock).
  'reroll:ahsoka_tano:attacker': {
    prompt: ({ combat }) => {
      const atkN = _selectableDieIndices(combat, { pool: 'attack' }).length;
      const defN = _selectableDieIndices(combat, { pool: 'defense' }).length;
      return {
        content: '**Twin Sabers** — reroll ALL of one pool (dice already rerolled are excluded):',
        buttons: [
          ['atk', `Reroll all my attack dice (${atkN})`],
          ['def', `Force defender to reroll all defense dice (${defN})`],
          ['skip', 'Skip', 'secondary'],
        ],
      };
    },
    apply: async (choice, { combat, ctx, thread }) => {
      if (choice === 'skip') { thread?.send('**Twin Sabers** — Skipped.').catch(discordCatch); return; }
      const pool = choice === 'def' ? 'defense' : 'attack';
      let n = 0;
      for (const i of _selectableDieIndices(combat, { pool })) {
        if (_rerollDie(combat, ctx, { pool, index: i }).ok) n++;
      }
      await _sendRerollResult(thread, pool,
        `**Twin Sabers** — rerolled all ${pool} dice (${n}).`,
        pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults);
    },
  },
  // Soresu Form (Kanan Jarrus) — bespoke reroll resolver (alexanbv 2026-06-16):
  // the reroll is a normal defense-die reroll, but its RIDERS (convert each
  // Dodge → 2 Block + 1 Evade, and Kanan suffers 1 Strain unless the rerolling
  // figure is a FORCE USER) fire ONLY when the reroll is actually taken. So we
  // mark combat.soresuFormFigKey here (on a real reroll), and the resolve-step
  // handler applies the conversion + conditional Kanan strain.
  'reroll:kanan_jarrus:defender': {
    prompt: (a) => _makeRerollResolver({ name: 'Soresu Form', pool: 'defense', side: 'defender', stageKey: 'rr_soresu' }).prompt(a),
    apply: async (choice, a) => {
      const r = await _makeRerollResolver({ name: 'Soresu Form', pool: 'defense', side: 'defender', stageKey: 'rr_soresu' }).apply(choice, a);
      if (choice !== 'skip' && !(r && r.followUp)) {
        const { game, combat } = a;
        const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
        const mapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
        const defPos = combat.target?.figureKey ? game.figurePositions?.[defPN]?.[combat.target.figureKey] : null;
        const eff = getDcEffectsGlobal() || {};
        const _soresuBlockedEdges = getClosedDoorEdges(game);
        for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
          const fn = dcNameFromFigureKey(fk);
          const fe = eff[fn] || eff[(fn || '').replace(/\s*\[.*\]\s*$/, '')];
          if (!(fe?.specialAbilityIds || []).includes('soresu_form')) continue;
          if (mapSp && defPos && _isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defPos).toLowerCase(), 3, _soresuBlockedEdges, game)) {
            combat.soresuFormFigKey = fk; // resolve-step handler does the Dodge conversion + Kanan strain
            break;
          }
        }
      }
      return r;
    },
  },
  // Diala Passil's Defensive Stance reroll RIDER — gate-rework 2026-06-18. The
  // rider on a real defense-die reroll: "if you do, convert each Dodge result to 2 Block and 1
  // Evade." Modeled on the Soresu rider — a normal defense-die reroll, and ONLY on
  // a non-skip reroll does the Dodge conversion fire. Diala is the defender herself
  // (no third-party figure), so convert combat.defenseRoll inline after the reroll.
  // Mirrors the resolve-step Diala conversion (which keeps firing for the auto
  // Dodge-conversion keyword path); this handles the reroll-rider variant.
  'reroll:diala_passil:defender': {
    prompt: (a) => _makeRerollResolver({ name: 'Defensive Stance', pool: 'defense', side: 'defender', stageKey: 'rr_diala' }).prompt(a),
    apply: async (choice, a) => {
      const r = await _makeRerollResolver({ name: 'Defensive Stance', pool: 'defense', side: 'defender', stageKey: 'rr_diala' }).apply(choice, a);
      if (choice !== 'skip' && !(r && r.followUp)) {
        const { combat, thread } = a;
        const dr = combat.defenseRoll || {};
        if (dr.dodge) {
          // Convert EACH Dodge — scale by the counted Dodge value.
          const _dod = typeof dr.dodge === 'number' ? dr.dodge : 1;
          combat.defenseRoll = { block: (dr.block || 0) + 2 * _dod, evade: (dr.evade || 0) + 1 * _dod, dodge: false };
          await thread?.send(`**Defensive Stance** — ${_dod} Dodge converted to +${2 * _dod} Block, +${1 * _dod} Evade.`).catch(discordCatch);
        }
      }
      return r;
    },
  },
  // Much to Learn (Ezra Bridger) — gate-rework 2026-06-18. "You may reroll 1 attack
  // die; if that figure is a FORCE USER you may turn that attack die to any side
  // instead." The attacking figure being a FORCE USER unlocks the turn-to-any-side
  // ALTERNATIVE (via the existing _makeDieTurnResolver). Non-FORCE-USER attackers
  // get just the plain attack-die reroll.
  'reroll:ezra_bridger:attacker': {
    prompt: ({ game, combat, ctx }) => {
      const eff = getDcEffectsGlobal() || {};
      const an = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
      const e = eff[an] || eff[(an || '').replace(/\s*\[.*\]\s*$/, '')];
      const kws = [...(e?.keywords || []), ...(e?.traits || [])].map((k) => String(k).toUpperCase());
      const isForceUser = kws.includes('FORCE USER');
      if (!isForceUser) {
        return _makeRerollResolver({ name: 'Much to Learn', pool: 'attack', side: 'attacker', stageKey: 'rr_ezra' }).prompt({ game, combat, ctx });
      }
      const n = _selectableDieIndices(combat, { pool: 'attack' }).length;
      if (!n) return { content: '**Much to Learn** — no eligible attack die.', buttons: [['skip', 'OK', 'secondary']] };
      return {
        content: '**Much to Learn** — FORCE USER: reroll 1 attack die, OR turn 1 attack die to any side instead:',
        buttons: [['reroll', 'Reroll 1 attack die'], ['turn', 'Turn 1 attack die to any side'], ['skip', 'Skip', 'secondary']],
      };
    },
    apply: async (choice, a) => {
      const { combat, thread } = a;
      const eff = getDcEffectsGlobal() || {};
      const an = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
      const e = eff[an] || eff[(an || '').replace(/\s*\[.*\]\s*$/, '')];
      const kws = [...(e?.keywords || []), ...(e?.traits || [])].map((k) => String(k).toUpperCase());
      const isForceUser = kws.includes('FORCE USER');
      const rerollR = _makeRerollResolver({ name: 'Much to Learn', pool: 'attack', side: 'attacker', stageKey: 'rr_ezra' });
      const turnR = _makeDieTurnResolver({ name: 'Much to Learn', eligible: (dice) => dice.map((_d, i) => i), stageKey: 'mtl_turn' });
      if (!isForceUser) return rerollR.apply(choice, a);
      // FORCE USER: the first click selects the MODE; subsequent clicks belong to
      // the chosen sub-resolver (tracked on combat so the gate's follow-up routes back).
      const mode = combat._mtlMode;
      if (!mode) {
        if (choice === 'skip') { await thread?.send('**Much to Learn** — Skipped.').catch(discordCatch); return undefined; }
        combat._mtlMode = choice === 'turn' ? 'turn' : 'reroll';
        const sub = combat._mtlMode === 'turn' ? turnR : rerollR;
        const p = await sub.prompt(a);
        if (p && p.buttons) {
          await thread?.send(sanitizeMentions({ content: p.content, components: chunkButtonsToRows(p.buttons.map(([c, l, s]) => new ButtonBuilder().setCustomId(`combat_modsub_${a.gameId}_${c}_${a.id}`).setLabel(l).setStyle(_modsStyle(s)))) })).catch(discordCatch);
          return { followUp: true };
        }
        delete combat._mtlMode;
        return undefined;
      }
      const sub = mode === 'turn' ? turnR : rerollR;
      const res = await sub.apply(choice, a);
      if (!(res && res.followUp)) delete combat._mtlMode;
      return res;
    },
  },
  spray_fire: {
    prompt: () => ({ content: '**Spray Fire** — apply **-3 Accuracy, +1 Surge**?', buttons: [['apply', 'Apply (-3 Acc, +1 Surge)'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { combat, thread }) => {
      if (choice === 'apply') { const b = applySprayFire(combat); combat.bonusAccuracy = b.bonusAccuracy; combat.surgeBonus = b.surgeBonus; thread?.send('**Spray Fire** — -3 Accuracy, +1 Surge applied.').catch(discordCatch); }
      else thread?.send('**Spray Fire** — Skipped.').catch(discordCatch);
      combat.sprayFireResolved = true;
    },
  },
  defensible: {
    prompt: () => ({ content: '**Defensible** — apply +1 Block or +1 Evade?', buttons: [['block', '+1 Block'], ['evade', '+1 Evade'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { combat, thread }) => {
      if (choice === 'block') { combat.bonusBlock = (combat.bonusBlock || 0) + 1; thread?.send('**Defensible** — Applied +1 Block.').catch(discordCatch); }
      else if (choice === 'evade') { combat.bonusEvade = (combat.bonusEvade || 0) + 1; thread?.send('**Defensible** — Applied +1 Evade.').catch(discordCatch); }
      else thread?.send('**Defensible** — Skipped.').catch(discordCatch);
      combat.defensibleResolved = true;
    },
  },
  agile: {
    prompt: () => ({ content: '**Agile** — convert 1 Block to 1 Evade?', buttons: [['apply', 'Apply (Block→Evade)'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { combat, thread }) => {
      if (choice === 'apply') {
        const conv = applyAgileConversion({ block: combat.defenseRoll?.block, bonusBlock: combat.bonusBlock, bonusEvade: combat.bonusEvade });
        if (conv.applied) { combat.bonusBlock = conv.bonusBlock; combat.bonusEvade = conv.bonusEvade; thread?.send('**Agile** — Converted 1 Block to 1 Evade.').catch(discordCatch); }
        else thread?.send('**Agile** — No Block available to convert.').catch(discordCatch);
      } else thread?.send('**Agile** — Skipped.').catch(discordCatch);
      combat.agileJetTrooperApplied = true;
    },
  },
  take_cover: {
    prompt: () => ({ content: '**Take Cover** (Jawa Scavenger) — apply **+1 Block and -1 Evade**?', buttons: [['apply', 'Apply (+1 Block, -1 Evade)'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { combat, thread }) => {
      if (choice === 'apply') {
        const bump = applyTakeCoverBonus({ bonusBlock: combat.bonusBlock, bonusEvade: combat.bonusEvade });
        combat.bonusBlock = bump.bonusBlock;
        combat.bonusEvade = bump.bonusEvade;
        thread?.send('**Take Cover** — Applied +1 Block, -1 Evade.').catch(discordCatch);
      } else thread?.send('**Take Cover** — Skipped.').catch(discordCatch);
      combat.takeCoverResolved = true;
    },
  },
  call_the_shots: {
    prompt: () => ({ content: '**Call the Shots** — apply +2 Accuracy, +1 Damage, or +1 Surge?', buttons: [['acc', '+2 Accuracy'], ['hit', '+1 Damage'], ['surge', '+1 Surge'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { game, combat, thread }) => {
      // Once-per-round limit is spent ONLY when a bonus is actually applied; Skip
      // must not burn Call the Shots (spec: "you MAY apply ..."). Mirrors get_down.
      const fk = _findModsFigKey('call_the_shots', game, combat);
      const _ctsStamp = () => { if (fk) { game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {}; game.roundFigureAbilityUsed[`${fk}_call_the_shots`] = true; } };
      if (choice === 'acc') { _ctsStamp(); combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2; thread?.send('**Call the Shots** — Applied +2 Accuracy.').catch(discordCatch); }
      else if (choice === 'hit') { _ctsStamp(); combat.bonusHits = (combat.bonusHits || 0) + 1; thread?.send('**Call the Shots** — Applied +1 Damage.').catch(discordCatch); }
      else if (choice === 'surge') { _ctsStamp(); combat.surgeBonus = (combat.surgeBonus || 0) + 1; thread?.send('**Call the Shots** — Applied +1 Surge.').catch(discordCatch); }
      else thread?.send('**Call the Shots** — Skipped.').catch(discordCatch);
      combat.callTheShotsResolved = true;
    },
  },
  // Charge Generators (AT-DP) — alexanbv 2026-06-18 FIX-3. +1 Damage (always)
  // and an optional reroll of 1 attack die. Both halves of the single
  // attack:modifiers CSV row. The +1 Damage applies on either choice; the reroll
  // half is taken only on "reroll". The gate marks it used (once per attack) via
  // params after this resolves.
  // Charge Generators (AT-DP) — MODS half (FIX-1 split). Applies ONLY +1 Damage;
  // the 1-attack-die reroll is the SEPARATE rerolls-window button
  // ('charge_generators_reroll' → _makeRerollResolver). No sub-choice — clicking
  // the button applies the bonus immediately.
  charge_generators: {
    apply: async (_choice, { combat, thread }) => {
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      thread?.send('**Charge Generators** — +1 Damage applied.').catch(discordCatch);
      return undefined;
    },
  },
  get_down: {
    prompt: () => ({ content: '**Get Down** — apply +1 Block or +1 Evade?', buttons: [['block', '+1 Block'], ['evade', '+1 Evade'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { game, combat, thread }) => {
      // Once-per-round limit is spent ONLY when a bonus is actually applied; Skip
      // must not burn Get Down (spec: "you MAY apply +1 Block or +1 Evade").
      const fk = _findModsFigKey('get_down', game, combat);
      const _gdStamp = () => { if (fk) { game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {}; game.roundFigureAbilityUsed[`${fk}_get_down`] = true; } };
      if (choice === 'block') { _gdStamp(); combat.bonusBlock = (combat.bonusBlock || 0) + 1; thread?.send('**Get Down** — Applied +1 Block.').catch(discordCatch); }
      else if (choice === 'evade') { _gdStamp(); combat.bonusEvade = (combat.bonusEvade || 0) + 1; thread?.send('**Get Down** — Applied +1 Evade.').catch(discordCatch); }
      else thread?.send('**Get Down** — Skipped.').catch(discordCatch);
      combat.getDownResolved = true;
    },
  },
  heavy_repeater: {
    prompt: () => ({ content: '**Heavy Repeater** — suffer 1 Strain for a bonus?', buttons: [['hit', '+1 Damage (1 Strain)'], ['blast', 'Blast 2 (1 Strain)'], ['acc', '+3 Acc (1 Strain)'], ['skip', 'Skip', 'secondary']] }),
    apply: async (choice, { game, combat, thread, ctx }) => {
      let strain = false;
      if (choice === 'hit') { combat.bonusHits = (combat.bonusHits || 0) + 1; strain = true; thread?.send('**Heavy Repeater** — +1 Damage (1 Strain).').catch(discordCatch); }
      else if (choice === 'blast') { combat.blastDamage = Math.max(combat.blastDamage || 0, 2); strain = true; thread?.send('**Heavy Repeater** — Blast 2 (1 Strain).').catch(discordCatch); }
      else if (choice === 'acc') { combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 3; strain = true; thread?.send('**Heavy Repeater** — +3 Accuracy (1 Strain).').catch(discordCatch); }
      else thread?.send('**Heavy Repeater** — Skipped.').catch(discordCatch);
      combat.heavyRepeaterResolved = true;
      if (strain) await applyStrain(game, ctx, { figureKey: combat.attackerFigureKey, controllerPlayerNum: combat.attackerPlayerNum, amount: 1, source: 'Heavy Repeater' });
    },
  },
  // Query (HK-47) — TWO-TIMING: played/chosen at on_declare (the defender
  // decides). "Become Bleeding" resolves IMMEDIATELY (Bleed token now);
  // "accept +1 Damage" stashes a mods-window pending modifier (+1 Damage) that the
  // 'pending_modifiers_drain' passive applies when the mods window runs.
  query: {
    prompt: () => ({ content: '🤖 **Query (HK-47)** — become Bleeding (avoid +1 Damage) or accept +1 Damage?', buttons: [['bleed', 'Become Bleeding'], ['accept', 'Accept +1 Damage', 'danger']] }),
    apply: async (choice, { game, combat, thread }) => {
      if (choice === 'bleed') {
        // IMMEDIATE branch — apply the Bleed token now (no later modifier).
        if (combat.target?.figureKey) { const { applyCondition } = await import('../game/conditions.js'); applyCondition(game, combat.target.figureKey, 'Bleed'); }
        thread?.send('🩸 **Query** — Defender became Bleeding (no damage bonus).').catch(discordCatch);
      } else {
        // MODS branch — the +1 Damage takes effect in the modifiers window.
        stashPendingModifier(combat, 'mods', { source: 'Query (HK-47)', effect: { bonusHits: 1 } });
        thread?.send('💢 **Query** — Defender accepted +1 Damage (applied in the modifiers window).').catch(discordCatch);
      }
      combat.queryResolved = true; delete combat.queryNeedsPrompt;
    },
  },
  // Negotiate (Hondo) — TWO-TIMING: Hondo's attacker ability played/chosen at
  // on_declare; the DEFENDER decides (mention them). "Pay 2 VP" resolves
  // IMMEDIATELY (defender loses 2 VP now, no further effect). "Accept +2 Damage"
  // stashes a mods-window pending modifier (+2 Damage) applied when the mods window
  // runs (via 'pending_modifiers_drain').
  negotiate: {
    prompt: ({ game, combat }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const defVp = (defPN === 1 ? game.player1VP?.total : game.player2VP?.total) ?? 0;
      // Defender with <2 VP can't pay → only the +2 Damage branch is offered.
      const buttons = defVp >= 2
        ? [['pay', 'Pay 2 VP'], ['accept', 'Accept +2 Damage', 'danger']]
        : [['accept', 'Accept +2 Damage (cannot pay)', 'danger']];
      return { content: `<@${game[`player${defPN}Id`]}> **Negotiate (Hondo)** — pay **2 VP** to avoid +2 Damage, or accept +2 Damage:`, buttons, mentionUserId: game[`player${defPN}Id`] };
    },
    apply: async (choice, { game, combat, thread, ctx }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      if (choice === 'pay') {
        // IMMEDIATE branch — defender pays 2 VP now; the attack gets no bonus.
        deductVp(game, defPN, 2); awardObjectiveVp(game, combat.attackerPlayerNum, 2);
        thread?.send('**Negotiate** — Defender paid 2 VP to Hondo. No bonus damage.').catch(discordCatch);
        if (ctx?.checkWinConditions) await ctx.checkWinConditions(game, ctx.client ?? thread?.client);
      } else {
        // MODS branch — the +2 Damage takes effect in the modifiers window.
        stashPendingModifier(combat, 'mods', { source: 'Negotiate (Hondo)', effect: { bonusHits: 2 } });
        thread?.send('**Negotiate** — +2 Damage will be applied in the modifiers window.').catch(discordCatch);
      }
      combat.negotiateResolved = true;
    },
  },
  elusive: {
    // 2-stage (alexanbv 2026-06-22): the card reads "choose 1 attack die ... then
    // remove all symbols on A DEFENSE DIE" — the DEFENDER picks BOTH dice, it is
    // NOT auto-worst. Stage 1 picks the attack die to nullify; stage 2 (posted as
    // a combat_modsub follow-up) picks the defense die to nullify.
    prompt: ({ combat }) => {
      const atkDice = combat.attackDiceResults || [];
      const buttons = atkDice.map((d, i) => [String(i), `#${i + 1} ${d.color}: ${d.dmg || 0}H/${d.surge || 0}S/${d.acc || 0}A`.slice(0, 80)]);
      buttons.push(['skip', 'Skip', 'secondary']);
      return { content: '**Elusive** — choose an attack die to nullify, then choose a defense die to nullify:', buttons };
    },
    apply: async (choice, { combat, thread, gameId, id }) => {
      const sk = '_elusive';
      // Stage 2: the defender chose which defense die to nullify.
      if (combat[`${sk}Stage`] === 'def') {
        const defDice = combat.defenseDiceResults;
        const di = parseInt(choice, 10);
        if (choice !== 'skip' && defDice && di >= 0 && di < defDice.length) {
          const oldDef = defDice[di];
          defDice[di] = { ...oldDef, block: 0, evade: 0, dodge: false };
          combat.defenseRoll = { block: 0, evade: 0, dodge: false };
          for (const d of defDice) { combat.defenseRoll.block += (d.block || 0); combat.defenseRoll.evade += (d.evade || 0); if (d.dodge) combat.defenseRoll.dodge = true; }
          thread?.send(`**Elusive** — nullified defense die #${di + 1} (${oldDef.color}): -${oldDef.block || 0} Block, -${oldDef.evade || 0} Evade${oldDef.dodge ? ', -Dodge' : ''}.`).catch(discordCatch);
        } else {
          thread?.send('**Elusive** — no defense die nullified.').catch(discordCatch);
        }
        delete combat[`${sk}Stage`];
        combat.elusiveResolved = true;
        return undefined;
      }
      // Stage 1: the defender chose which attack die to nullify.
      if (choice === 'skip') { combat.elusiveResolved = true; thread?.send('**Elusive** — Skipped.').catch(discordCatch); return undefined; }
      const dieIdx = parseInt(choice, 10);
      const atkDice = combat.attackDiceResults; const defDice = combat.defenseDiceResults;
      if (atkDice && dieIdx >= 0 && dieIdx < atkDice.length) {
        const oldAtk = atkDice[dieIdx];
        // alexanbv 2026-06-22: "remove all SYMBOLS on the chosen die" — Accuracy
        // is NOT a symbol (it's a number/range), so it is KEPT. Only the card
        // worded "results" (e.g. Lando) would also remove Accuracy.
        atkDice[dieIdx] = { ...oldAtk, dmg: 0, surge: 0 };
        combat.attackRoll = { dmg: 0, surge: 0, acc: 0 };
        for (const d of atkDice) { combat.attackRoll.dmg += (d.dmg || 0); combat.attackRoll.surge += (d.surge || 0); combat.attackRoll.acc += (d.acc || 0); }
        thread?.send(`**Elusive** — nullified attack die #${dieIdx + 1} (${oldAtk.color}) symbols: -${oldAtk.dmg || 0} Hit, -${oldAtk.surge || 0} Surge (Accuracy unaffected).`).catch(discordCatch);
        // If there are defense dice, the DEFENDER now picks which one to nullify.
        if (defDice && defDice.length > 0) {
          combat[`${sk}Stage`] = 'def';
          const btns = defDice.map((d, i) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${i}_${id}`).setLabel(`#${i + 1} ${d.color}: ${d.block || 0}B/${d.evade || 0}E${d.dodge ? '/Dodge' : ''}`.slice(0, 80)).setStyle(ButtonStyle.Primary));
          btns.push(new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_skip_${id}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
          await thread?.send({ content: '**Elusive** — choose a defense die to nullify:', components: chunkButtonsToRows(btns) }).catch(discordCatch);
          return { followUp: true };
        }
      }
      combat.elusiveResolved = true;
      return undefined;
    },
  },
  crate_block_sink: {
    prompt: ({ game, combat }) => {
      const rule = game?.selectedMission?.rules?.persistent?.crateBlockSink;
      const fk = combat.target?.figureKey;
      const healthPer = rule?.healthPerCrate || 5;
      const blocks = [...(game.lineOfFireCrateBlock?.[fk] || [])];
      const carry = typeof game.figureContraband?.[fk] === 'number' ? game.figureContraband[fk] : (game.figureContraband?.[fk] ? 1 : 0);
      while (blocks.length < carry) blocks.push(0);
      const remHp = blocks.slice(0, carry).reduce((s, b) => s + Math.max(0, healthPer - (b || 0)), 0);
      const max = Math.min(rule?.maxBlockPerAttack || 3, remHp);
      const buttons = [];
      for (let n = 0; n <= max; n++) buttons.push([String(n), n === 0 ? 'Skip (0)' : `${n} dmg → +${n} Block`, n === 0 ? 'secondary' : undefined]);
      return { content: '📦 **Line of Fire** — choose damage to your carried crate(s) for +Block:', buttons };
    },
    apply: (choice, { game, combat, thread }) => {
      const n = Math.max(0, parseInt(choice, 10) || 0);
      const fk = combat.target?.figureKey;
      if (n > 0 && fk) {
        const rule = game?.selectedMission?.rules?.persistent?.crateBlockSink;
        const healthPer = rule?.healthPerCrate || 5;
        game.lineOfFireCrateBlock = game.lineOfFireCrateBlock || {};
        const blocks = game.lineOfFireCrateBlock[fk] || [];
        const carry = typeof game.figureContraband?.[fk] === 'number' ? game.figureContraband[fk] : (game.figureContraband?.[fk] ? 1 : 0);
        while (blocks.length < carry) blocks.push(0);
        let rem = n;
        for (let i = 0; i < blocks.length && rem > 0; i++) { const avail = Math.max(0, healthPer - (blocks[i] || 0)); const take = Math.min(avail, rem); blocks[i] = (blocks[i] || 0) + take; rem -= take; }
        const after = blocks.filter((b) => (b || 0) < healthPer);
        game.lineOfFireCrateBlock[fk] = after;
        if (after.length <= 0) { delete game.lineOfFireCrateBlock[fk]; if (game.figureContraband?.[fk]) delete game.figureContraband[fk]; }
        else if (typeof game.figureContraband[fk] === 'number') { game.figureContraband[fk] = after.length; }
        combat.bonusBlock = (combat.bonusBlock || 0) + n;
        thread?.send(`📦 **Line of Fire — Crate Block** — ${n} damage to crate; +${n} Block.`).catch(discordCatch);
      } else thread?.send('📦 **Line of Fire — Crate Block** — Skipped.').catch(discordCatch);
      combat.crateBlockSinkResolved = true;
    },
  },
  // ── on_declare ─────────────────────────────────────────────────────────────
  merciless: {
    prompt: ({ combat }) => combat.mercilessAvailable
      ? { content: `⚡ **Merciless** — deal 1 Damage to **${combat.mercilessAvailable.targetLabel}** (has a HARMFUL condition)?`, buttons: [['use', 'Use Merciless'], ['skip', 'Skip', 'secondary']] }
      : { content: '**Merciless** — no eligible target.', buttons: [['skip', 'OK', 'secondary']] },
    apply: async (choice, { game, combat, thread, ctx }) => {
      const info = combat.mercilessAvailable;
      if (choice === 'use' && info) {
        const conds = game.figureConditions?.[info.targetFigureKey] || [];
        if (['Bleed', 'Stun', 'Weaken'].some((c) => conds.includes(c))) {
          const m = info.targetFigureKey.match(/-(\d+)-(\d+)$/); const fi = m ? parseInt(m[2], 10) : 0;
          // Routes through the shared damage pipeline (alexanbv: use existing pipeline).
          await _applyDamage(game, { dcHealthState: ctx?.dcHealthState, logGameAction: ctx?.logGameAction, client: ctx?.client }, {
            figureKey: info.targetFigureKey, msgId: info.targetMsgId, figIndex: fi, amount: 1,
            controllerPlayerNum: info.defenderPlayerNum, attackerPlayerNum: info.attackerPlayerNum, source: 'Merciless',
          });
          thread?.send(`⚡ **Merciless** — **${info.targetLabel}** suffers 1 Damage.`).catch(discordCatch);
        } else thread?.send('**Merciless** — Defender no longer has a HARMFUL condition; no effect.').catch(discordCatch);
      } else thread?.send('**Merciless** — Skipped.').catch(discordCatch);
      combat.mercilessUsed = true; delete combat.mercilessAvailable;
    },
  },
  front_line: {
    // +2 Accuracy (in range) and an optional blue→red attack-die pool swap.
    prompt: () => ({ content: '**Front Line** — +2 Accuracy. Also swap a blue attack die to red?', buttons: [['swap', '+2 Acc & swap blue→red'], ['noswap', '+2 Acc only', 'secondary']] }),
    apply: (choice, { combat, thread }) => {
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
      if (choice === 'swap' && combat.attackInfo?.dice) {
        const swap = applyFrontLineDieSwap(combat.attackInfo.dice); // shared helper (parity)
        if (swap.applied) { combat.attackInfo = { ...combat.attackInfo, dice: swap.dice }; thread?.send('**Front Line** — +2 Accuracy; 1 blue die → red.').catch(discordCatch); }
        else thread?.send('**Front Line** — +2 Accuracy (no blue die to swap).').catch(discordCatch);
      } else thread?.send('**Front Line** — +2 Accuracy (swap skipped).').catch(discordCatch);
      combat._frontLineSwapDecided = true;
    },
  },
  vanguard: {
    // Replace one chosen non-red attack die with Red (target within 3).
    prompt: ({ combat }) => {
      const nonRed = [...new Set((combat.attackInfo?.dice || []).filter((d) => d !== 'red'))];
      if (nonRed.length === 0) return { content: '**Vanguard** — no non-red die to swap.', buttons: [['skip', 'OK', 'secondary']] };
      return { content: '**Vanguard** — replace one attack die with Red:', buttons: [...nonRed.map((c) => [c, `${c[0].toUpperCase() + c.slice(1)} → Red`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: (choice, { combat, thread }) => {
      if (choice !== 'skip' && combat.attackInfo?.dice) {
        const dice = [...combat.attackInfo.dice]; const idx = dice.indexOf(choice);
        if (idx >= 0) { dice[idx] = 'red'; combat.attackInfo = { ...combat.attackInfo, dice }; thread?.send(`**Vanguard** — ${choice} → Red.`).catch(discordCatch); }
        else thread?.send('**Vanguard** — that die is gone.').catch(discordCatch);
      } else thread?.send('**Vanguard** — Skipped.').catch(discordCatch);
      combat._vanguardOnDeclareDecided = true;
    },
  },
  ee3_carbine: {
    // EE-3 Carbine (Boba Fett): replace one non-red die with Red; costs 2 MP.
    prompt: ({ combat }) => {
      const nonRed = [...new Set((combat.attackInfo?.dice || []).filter((d) => d !== 'red'))];
      if (nonRed.length === 0) return { content: '**EE-3 Carbine** — no non-red die to swap.', buttons: [['skip', 'OK', 'secondary']] };
      return { content: '**EE-3 Carbine** — replace one attack die with Red (costs 2 MP):', buttons: [...nonRed.map((c) => [c, `${c[0].toUpperCase() + c.slice(1)} → Red (-2 MP)`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: (choice, { game, combat, thread }) => {
      if (choice !== 'skip' && combat.attackInfo?.dice) {
        const dice = [...combat.attackInfo.dice]; const idx = dice.indexOf(choice);
        if (idx >= 0) {
          dice[idx] = 'red'; combat.attackInfo = { ...combat.attackInfo, dice };
          const _fi = parseInt(String(combat.attackerFigureKey || '').split('-').pop(), 10);
          const fi = Number.isInteger(_fi) ? _fi : (game.dcActionsData?.[combat.attackerMsgId]?.selectedFigure ?? 0);
          consumeMovementPoints(game, combat.attackerMsgId, 2, fi);
          thread?.send(`**EE-3 Carbine** — ${choice} → Red (-2 MP).`).catch(discordCatch);
        } else thread?.send('**EE-3 Carbine** — that die is gone.').catch(discordCatch);
      } else thread?.send('**EE-3 Carbine** — Skipped.').catch(discordCatch);
      combat._ee3OnDeclareDecided = true;
    },
  },
  // Shock and Awe (Cara Dune) — on_declare PLAYER CHOICE, once per round
  // (alexanbv 2026-06-18 FIX-1). Replace 1 Yellow attack die with 1 Red die.
  // The once-per-round limit is marked by the gate's _markGateAbilityUsed via the
  // ability's params (Cara Dune:Shock and Awe); this resolver only does the swap.
  shock_and_awe: {
    prompt: ({ combat }) => {
      const hasYellow = (combat.attackInfo?.dice || []).includes('yellow');
      if (!hasYellow) return { content: '**Shock and Awe** — no Yellow die to swap.', buttons: [['skip', 'OK', 'secondary']] };
      return { content: '**Shock and Awe** — replace 1 Yellow attack die with 1 Red die?', buttons: [['use', 'Yellow → Red'], ['skip', 'Skip', 'secondary']] };
    },
    apply: (choice, { combat, thread }) => {
      if (choice === 'use' && combat.attackInfo?.dice) {
        const r = applyShockAndAweDieSwap(combat.attackInfo.dice);
        if (r.applied) { combat.attackInfo = { ...combat.attackInfo, dice: r.dice }; thread?.send('**Shock and Awe** — 1 Yellow die replaced with Red.').catch(discordCatch); }
        else thread?.send('**Shock and Awe** — no Yellow die to swap.').catch(discordCatch);
      } else thread?.send('**Shock and Awe** — Skipped.').catch(discordCatch);
      combat._shockAndAweDecided = true;
    },
  },
  // ── special (sample) ─────────────────────────────────────────────────────
  zillo_technique_pierce_cancel: {
    // NO sub-prompt (alexanbv 2026-06-26): the zillo window itself is the
    // Exhaust/Skip choice — its only button is "Exhaust Zillo Technique → Pierce
    // −2" (this resolver, applies directly on pick) and the window's "Skip"
    // (Done) declines. No submenu, no CCs in this step.
    apply: (_choice, { game, combat, thread }) => {
      // EXHAUST the card (alexanbv 2026-06-16 re-audit: the gate path was
      // cancelling 2 Pierce for free every attack). Re-find the defender's
      // [Zillo Technique] msgId (mirrors the detection in combat-abilities-zillo.js).
      const defPN = combat.defenderPlayerNum;
      const dcList = getDcList(game, defPN) || [];
      const dcMsgIds = getDcMessageIds(game, defPN) || [];
      let ztMsgId = null;
      for (let i = 0; i < dcList.length; i++) {
        if (dcList[i]?.dcName === '[Zillo Technique]') { ztMsgId = dcMsgIds[i] || null; break; }
      }
      if (ztMsgId) exhaustAttachment(game, ztMsgId, 'Zillo Technique');
      combat.defenderReducePierce = (combat.defenderReducePierce || 0) + 2;
      thread?.send('🛡️ **Zillo Technique** — Exhausted: this attack’s Pierce reduced by 2.').catch(discordCatch);
      combat.zilloPierceResolved = true;
    },
  },
  // ── FIX-2 spend-resource mods resolvers ──────────────────────────────────
  // Rogue One ([Rogue One] upgrade) — discard 1 Power Token from ANOTHER friendly
  // figure → +1 Damage. Stage 1 lists each ally token (figureKey#index labelled by
  // token type); spending removes that token; bonus = +1 Damage.
  rogue_one: _makeSpendResourceResolver({
    name: 'Rogue One',
    options: (game, combat) => getRogueOneDonors(game, combat).map((d) =>
      [`${d.figureKey}#${d.tokenIndex}`, `${d.dcName}: ${d.tokenType} token`]),
    spend: (choice, { game }) => {
      const hash = choice.lastIndexOf('#');
      const figureKey = choice.slice(0, hash);
      const index = parseInt(choice.slice(hash + 1), 10);
      const tokens = game.figurePowerTokens?.[figureKey] || [];
      if (index < 0 || index >= tokens.length) return null;
      const type = tokens[index];
      removeSpentToken(game, figureKey, index);
      return `${dcNameFromFigureKey(figureKey)}'s ${type} Power Token`;
    },
    bonus: (combat) => { combat.bonusHits = (combat.bonusHits || 0) + 1; return '+1 Damage'; },
  }),
  // Illicit Arms (Bib Fortuna, DC) — discard 1 Command card from hand → +1 Damage,
  // only while army affiliation is SCUM (gated in `applies`). Lists the attacker's
  // CC hand as options.
  illicit_arms: _makeSpendResourceResolver({
    name: 'Illicit Arms (Bib Fortuna)',
    ephemeral: true, // lists the attacker's HAND — keep it private
    options: (game, combat) => [...new Set(getCcHand(game, combat.attackerPlayerNum) || [])].map((c) => [c, c]),
    // Route the cost-discard through the central discardCc choke point so it
    // REVEALS the card publicly AND fires when-discarded passives (Built on
    // Hope / De Wanna Wanga / Windfall). alexanbv 2026-06-26.
    spend: async (choice, { game, combat, ctx }) => {
      const res = await discardCc(game, combat.attackerPlayerNum, choice, { client: ctx?.client, logGameAction: ctx?.logGameAction });
      return res.moved ? `Command card "${choice}"` : null;
    },
    bonus: (combat) => { combat.bonusHits = (combat.bonusHits || 0) + 1; return '+1 Damage'; },
  }),
  // Zillo Technique — Block Boost ([Zillo Technique] upgrade) — discard 1 Command
  // card → +1 Block (defender). DISTINCT from the pierce-cancel exhaust.
  zillo_technique_discard: _makeSpendResourceResolver({
    name: 'Zillo Technique: discard a Command Card → +1 Block',
    ephemeral: true, // lists the defender's HAND — keep it private
    options: (game, combat) => {
      const defPn = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      return [...new Set(getCcHand(game, defPn) || [])].map((c) => [c, c]);
    },
    spend: async (choice, { game, combat, ctx }) => {
      const defPn = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      // Central discardCc choke point: REVEAL publicly + fire when-discarded
      // passives. alexanbv 2026-06-26.
      const res = await discardCc(game, defPn, choice, { client: ctx?.client, logGameAction: ctx?.logGameAction });
      return res.moved ? `Command card "${choice}"` : null;
    },
    bonus: (combat) => { combat.bonusBlock = (combat.bonusBlock || 0) + 1; return '+1 Block'; },
  }),
  // Guidance Systems ([Mortar Trooper] attachment). IACP 2026-06-21: -1 Damage +
  // +2 Accuracy, LIMIT once per attack. No sub-choice — clicking applies the
  // trade immediately and marks the once-per-attack limit so it is not re-offered.
  guidance_systems: {
    apply: async (_choice, { combat, thread }) => {
      combat.bonusHits = (combat.bonusHits || 0) - 1;
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
      combat._abilityUsedThisAttack = combat._abilityUsedThisAttack || {};
      // Mirror GUIDANCE_SYSTEMS_LIMIT_KEY in combat-abilities-mods.js.
      combat._abilityUsedThisAttack['[Mortar Trooper]:Guidance Systems'] = true;
      thread?.send('**Guidance Systems** — -1 Damage, +2 Accuracy applied (once per attack).').catch(discordCatch);
      return undefined;
    },
  },
  // Zeb (Lasat Honor Guard): turn one single-symbol attack die to any side.
  lasat_honor_guard: _makeDieTurnResolver({
    name: 'Lasat Honor Guard (Zeb)',
    eligible: (dice) => dice.map((d, i) => ({ d, i })).filter(({ d }) => ((d.dmg || 0) + (d.surge || 0)) === 1).map(({ i }) => i),
    phaseFlag: 'lasatHonorGuardPhase', stageKey: 'lasat',
  }),
  // Rapid Recalibration: turn one attack die to any side (before defender rerolls).
  rapid_recalibration: _makeDieTurnResolver({
    name: 'Rapid Recalibration',
    eligible: (dice) => dice.map((_d, i) => i),
    phaseFlag: null, stageKey: 'rapidRecal',
  }),

  // ── On-declare gate resolvers (alexanbv 2026-07-03 gate migration) ────────────

  // Strike Me Down (Obi-Wan Kenobi) — defender gate button. Clicking it defeats
  // Obi-Wan with a VP cost reduced by 3 and cancels the attack.
  strike_me_down: {
    apply: async (choice, { game, combat, thread, ctx }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const fk = combat.target?.figureKey;
      const atkPN = combat.attackerPlayerNum;
      if (!fk) { if (thread) await thread.send('**Strike Me Down** — no valid target.').catch(discordCatch); return; }
      const fkMatch = fk.match(/-(\d+)-(\d+)$/);
      const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
      const targetMsgId = ctx.findDcMessageIdForFigure?.(game.gameId, defPN, fk);
      if (targetMsgId && ctx.dcHealthState) {
        const healthState = ctx.dcHealthState.get(targetMsgId) || [];
        const entry = healthState[figIdx];
        if (entry && entry[0] > 0) {
          await _applyDamage(game, { dcHealthState: ctx.dcHealthState, logGameAction: ctx.logGameAction, client: ctx.client }, {
            figureKey: fk, msgId: targetMsgId, figIndex: figIdx,
            amount: entry[0], controllerPlayerNum: defPN, source: 'Strike Me Down',
          });
        }
      }
      const dcName = dcNameFromFigureKey(fk);
      const stats = ctx.getDcStats?.(dcName);
      const baseCost = stats?.cost ?? 5;
      const reducedCost = Math.max(0, baseCost - 3);
      if (reducedCost > 0) awardKillVp(game, atkPN, reducedCost);
      resolvePendingCombat(game);
      if (thread) await thread.send(`**Strike Me Down** — Obi-Wan is defeated (VP cost reduced by 3: ${reducedCost} VP awarded to attacker). Attack ended.`).catch(discordCatch);
      if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, `**Strike Me Down** — Obi-Wan chose to be defeated. Attacker gains ${reducedCost} VP. Attack cancelled.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
      if (ctx.processFigureDefeat) {
        await ctx.processFigureDefeat(game, {
          defeatedPlayerNum: defPN, figureKey: fk, attackerPlayerNum: atkPN,
          msgId: targetMsgId, dcName, displayName: dcName,
          source: 'Strike Me Down', awardVp: false,
        });
      }
    },
  },

  // The Force is With Me (Chirrut Imwe) — defender gate button on Ranged attacks.
  // prompt lists adjacent attacker figures; apply deals 1 Damage to chosen one
  // and reduces attack Damage by 1.
  the_force_is_with_me: {
    prompt: ({ game, combat }) => {
      if (!combat.isRanged) return null;
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const targetCoord = game.figurePositions?.[defPN]?.[combat.target?.figureKey];
      const mapSpaces = getMapData(game.selectedMap?.id);
      if (!mapSpaces || !targetCoord) return null;
      const adj = (mapSpaces.adjacency?.[String(targetCoord).toLowerCase()] || []).map((s) => String(s).toLowerCase());
      const adjacentHostiles = Object.entries(game.figurePositions?.[combat.attackerPlayerNum] || {})
        .filter(([, pos]) => adj.includes(String(pos).toLowerCase()))
        .map(([fk]) => fk);
      if (!adjacentHostiles.length) return null;
      const defOwnerId = getPlayerId(game, defPN);
      return {
        content: `**The Force is With Me** — Ranged attack targeting Chirrut. Choose an adjacent hostile figure to take 1 Damage (and apply **-1 Damage** to the attack results), or Skip:`,
        mentionUserId: defOwnerId,
        buttons: [
          ...adjacentHostiles.slice(0, 24).map((fk, i) => [String(i), `Hit ${dcNameFromFigureKey(fk)}`]),
          ['skip', 'Skip', 'secondary'],
        ],
      };
    },
    apply: async (choice, { game, combat, thread, ctx }) => {
      if (choice === 'skip' || choice === null) {
        if (thread) await thread.send('**The Force is With Me** — Skipped.').catch(discordCatch);
        return;
      }
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const targetCoord = game.figurePositions?.[defPN]?.[combat.target?.figureKey];
      const mapSpaces = getMapData(game.selectedMap?.id);
      if (!mapSpaces || !targetCoord) return;
      const adj = (mapSpaces.adjacency?.[String(targetCoord).toLowerCase()] || []).map((s) => String(s).toLowerCase());
      const adjacentHostiles = Object.entries(game.figurePositions?.[combat.attackerPlayerNum] || {})
        .filter(([, pos]) => adj.includes(String(pos).toLowerCase()))
        .map(([fk]) => fk);
      const pickedIdx = parseInt(choice, 10);
      const chosenFk = adjacentHostiles[pickedIdx];
      if (!chosenFk) { if (thread) await thread.send('**The Force is With Me** — Invalid pick.').catch(discordCatch); return; }
      combat.defenderDamageReduction = (combat.defenderDamageReduction || 0) + 1;
      const chosenDcName = dcNameFromFigureKey(chosenFk);
      const _fkMatch = chosenFk.match(/^(.+)-(\d+)-(\d+)$/);
      if (_fkMatch && ctx.dcHealthState) {
        const [, _dcN, , _fiStr] = _fkMatch;
        const _msgIds = getDcMessageIds(game, combat.attackerPlayerNum) || [];
        const _dcList = getDcList(game, combat.attackerPlayerNum) || [];
        let _chosenMsgId = null;
        for (let i = 0; i < _msgIds.length; i++) {
          if (_dcList[i]?.dcName === _dcN) { _chosenMsgId = _msgIds[i]; break; }
        }
        if (_chosenMsgId) {
          await _applyDamage(game, { dcHealthState: ctx.dcHealthState, logGameAction: ctx.logGameAction, client: ctx.client }, {
            figureKey: chosenFk, msgId: _chosenMsgId, figIndex: parseInt(_fiStr, 10),
            amount: 1, controllerPlayerNum: combat.attackerPlayerNum, source: 'The Force is With Me',
          });
        }
      }
      if (thread) await thread.send(`**The Force is With Me** — **${chosenDcName}** suffers 1 Damage; -1 Damage applied to the attack results.`).catch(discordCatch);
      if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, `**The Force is With Me** — Chirrut picks ${chosenDcName} (1 dmg) and reduces attack damage by 1.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    },
  },

  // Force Exhaustion (The Child / Clan of Two) — defender gate button. Clicking
  // incapacitates The Child; then the ATTACKER picks which die to remove via the
  // existing fe_die_pick_* sub-step (handleForceExhaustionDiePick).
  force_exhaustion: {
    apply: async (choice, { game, combat, thread, ctx }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const targetDcName = dcNameFromFigureKey(combat.target?.figureKey);
      const targetMsgId = ctx.findDcMessageIdForFigure?.(game.gameId, defPN, combat.target?.figureKey) || null;
      const upgrades = targetMsgId ? (game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || []) : [];
      const _feDecision = canOfferForceExhaustion(game, defPN, targetDcName, upgrades);
      if (!_feDecision.eligible) { if (thread) await thread.send('**Force Exhaustion** — no longer eligible.').catch(discordCatch); return; }
      game.childIncapacitated = true;
      if (_feDecision.childFigureKey && game.figureConditions?.[_feDecision.childFigureKey]) {
        delete game.figureConditions[_feDecision.childFigureKey];
      }
      const poolDice = combat?.attackInfo?.dice || [];
      const targetIsChild = _feDecision.reasonCode === 'target-is-child';
      const feInfo = {
        defenderPlayerNum: defPN, attackerPlayerNum: combat.attackerPlayerNum,
        targetIsChild, childFigureKey: _feDecision.childFigureKey,
        attackerFigureKey: combat.attackerFigureKey, combatThreadId: combat.combatThreadId,
      };
      if (!combat || poolDice.length <= 1) {
        let removedColor = null;
        if (combat?.attackInfo) {
          const r = removeForceExhaustionDie(combat.attackInfo.dice);
          removedColor = r.removedColor;
          combat.attackInfo = { ...combat.attackInfo, dice: r.dice };
          if (removedColor && thread) await thread.send(`**Force Exhaustion** — Removed 1 **${removedColor}** attack die.`).catch(discordCatch);
        }
        await _resolveFeAfterDiePick(game, combat, feInfo, thread, ctx, removedColor);
        return;
      }
      const atkPN = combat.attackerPlayerNum;
      game.pendingForceExhaustionDiePick = {
        gameId: game.gameId, attackerPlayerNum: atkPN, defenderPlayerNum: defPN,
        targetIsChild, attackerFigureKey: combat.attackerFigureKey, combatThreadId: combat.combatThreadId,
      };
      const indexed = poolDice.map((color, idx) => ({ color, idx }))
        .sort((a, b) => (_FE_DIE_ORDER[a.color] ?? 99) - (_FE_DIE_ORDER[b.color] ?? 99) || a.idx - b.idx);
      const feBtns = indexed.map(({ color, idx }) =>
        new ButtonBuilder().setCustomId(`fe_die_pick_${game.gameId}_${idx}`)
          .setLabel(`${color.charAt(0).toUpperCase() + color.slice(1)} die`).setStyle(ButtonStyle.Primary));
      const atkOwnerId = getPlayerId(game, atkPN);
      if (thread) await thread.send(sanitizeMentions({
        content: `<@${atkOwnerId}> **Force Exhaustion** — **The Child** is now **Incapacitated**. You must remove 1 die from your attack pool — choose which.`,
        components: chunkButtonsToRows(feBtns), allowedMentions: { users: [atkOwnerId] },
      })).catch(discordCatch);
      if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, '**Force Exhaustion** — The Child became Incapacitated. Attacker must choose 1 attack die to remove.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    },
  },

  // Slow on the Draw (Greedo) — defender gate button. Clicking pushes the
  // current combat onto the stack so the defender can attack Greedo first.
  slow_on_the_draw: {
    apply: async (choice, { game, combat, thread, ctx }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      pushNestedCombat(game);
      const defOwnerId = getPlayerId(game, defPN);
      if (thread) await thread.send(sanitizeMentions({
        content: `**Slow on the Draw** — <@${defOwnerId}>, you may now perform an attack targeting **Greedo**. Greedo's original attack will resume automatically once the interrupt attack resolves.`,
        allowedMentions: { users: [defOwnerId] },
      })).catch(discordCatch);
      if (ctx.logGameAction) await ctx.logGameAction(game, ctx.client, '**Slow on the Draw** — Defender interrupts to attack Greedo first.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    },
  },

  // Keep the Peace (Wing Guard Regular) — defender gate button. Clicking makes
  // the defender AND the attacker each suffer 1 Strain (limit once per attack).
  keep_the_peace_regular: {
    apply: async (choice, { game, combat, thread, ctx }) => {
      if (combat._ktpRegularUsed) return;
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const targetCoord = game.figurePositions?.[defPN]?.[combat.target?.figureKey];
      const mapSpaces = getMapData(game.selectedMap?.id);
      if (!mapSpaces || !targetCoord) return;
      const all = getDcEffectsGlobal() || {};
      const adjToTarget = new Set((mapSpaces.adjacency?.[String(targetCoord).toLowerCase()] || []).map((s) => String(s).toLowerCase()));
      const defFigPos = game.figurePositions?.[defPN] || {};
      for (const [fk, pos] of Object.entries(defFigPos)) {
        if (!adjToTarget.has(String(pos).toLowerCase())) continue;
        const fkName = dcNameFromFigureKey(fk);
        const fkEff = all[fkName] || all[(fkName || '').replace(/\s*\[.*\]\s*$/, '')];
        if (!hasKtpRegularAbility(fkEff?.specialAbilityIds || [])) continue;
        combat._ktpRegularUsed = true;
        await applyStrain(game, ctx, { figureKey: fk, controllerPlayerNum: defPN, amount: 1, source: `Keep the Peace (${fkName})` });
        await applyStrain(game, ctx, { figureKey: combat.attackerFigureKey, controllerPlayerNum: combat.attackerPlayerNum, amount: 1, source: `Keep the Peace (${fkName})` });
        if (thread) await thread.send(`**Keep the Peace** (${fkName}) — defender suffered 1 Strain; attacker suffers 1 Strain.`).catch(discordCatch);
        break;
      }
    },
  },
};

/**
 * Resolve a gate ability id to its resolver: a hand-wired COMBAT_RESOLVERS entry,
 * or — for DATA-DRIVEN abilities carrying registry params (every reroll ability
 * registered from docs/combat-spec.csv) — a generic resolver built from those
 * params. New reroll abilities need NO hand-coded function: gate + this dispatch
 * + the generic rerollDie serve them all (alexanbv "should not be doing these
 * with ad hoc functions").
 */
// Ability-name → COMBAT_RESOLVERS key, for the few whose resolver key isn't the
// slug of the ability name. (Most are: 'Call the Shots' → call_the_shots.)
const _RESOLVER_ALIAS = { 'line of fire': 'crate_block_sink', 'line of fire (crate block)': 'crate_block_sink', 'soresu form': 'soresu' };
function _resolverForAbilityName(ability) {
  const lc = String(ability || '').toLowerCase().trim();
  const key = _RESOLVER_ALIAS[lc] || lc.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return COMBAT_RESOLVERS[key] || null;
}
/**
 * Resolver for a third-party-figure CC (alexanbv 2026-06-16): the figure that
 * plays it isn't the attacker/defender, so the player first picks WHICH eligible
 * friendly figure plays it (stage 1 prompt → buttons indexed into the eligible
 * list), then playCC validates+disposes for that figure and the card's bespoke
 * combat effect is applied (stage 2 apply).
 */
function _makeThirdPartyCcResolver({ specKey, card }) {
  const _label = (fk) => {
    const base = dcNameFromFigureKey(fk);
    const tail = String(fk).split('-').slice(-2).join('-');
    return `${base} (${tail})`.slice(0, 80);
  };
  return {
    prompt: ({ game, combat, ctx }) => {
      const figs = eligibleThirdPartyCcFigures(game, specKey, combat, _gateDeps(ctx));
      if (!figs.length) return null;
      return { content: `**${card}** — choose which figure plays it:`, buttons: figs.map((fk, i) => [String(i), _label(fk)]) };
    },
    apply: async (choice, { game, combat, thread, ctx, side, gameId, window, id }) => {
      const figs = eligibleThirdPartyCcFigures(game, specKey, combat, _gateDeps(ctx));
      const fk = figs[parseInt(choice, 10)] ?? figs[0];
      if (!fk) return;
      const pn = side === 'attacker' ? combat.attackerPlayerNum : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
      const res = await playCcFull(game, gameId, pn, fk, card, { skipExecute: true }, ctx, ctx.client);
      if (!res.ok || res.cancelled) return;
      // Survived — apply bespoke combat effect
      const { applyCondition } = await import('../game/conditions.js');
      const { grantMovementPoints } = await import('../game/game-helpers.js');
      // findDcMessageIdForFigure + grantMovementPoints were never passed here,
      // so Opportunistic's 3 MP always fell through to "MP grant deps missing"
      // and silently did nothing in real games. Its unit test supplies its own
      // deps, which is why the gap survived. alexanbv 2026-08-12.
      const combatRes = applyThirdPartyCcEffect(specKey, game, combat, fk, {
        applyCondition,
        grantMovementPoints,
        findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
        gameId: game.gameId,
      });
      if (thread) await thread.send(`**${card}** played by ${_label(fk)}${combatRes.log?.length ? ` — ${combatRes.log.join(', ')}` : ''}.`).catch(discordCatch);
      if (combatRes?.reopenDefenderOnDeclare) {
        combat.onDeclareGate = buildOnDeclareGate(game, combat, _gateDeps(ctx));
        if (combat.onDeclareGate?.attacker) { combat.onDeclareGate.attacker.passivesFired = true; combat.onDeclareGate.attacker.passed = true; }
        await _driveGatePath('on_declare', thread, game, combat, ctx);
        return { followUp: true };
      }
    },
  };
}

/**
 * Battlefield Awareness (CC) — alexanbv 2026-06-17. A LEADER plays it after
 * ANOTHER friendly figure within 3 attacks, to reroll 1 of the attack dice.
 * Staged: pick the LEADER (figure-picker) → play the CC → pick an attack die →
 * (if the chosen Leader is Lando, a Gambit color-swap stage) → reroll. The
 * "Leader playing it is the one rerolling" only matters for Lando: if Lando is
 * the playing Leader, his Gambit lets the die be recolored first (Destruct's
 * "Battlefield Awareness" interaction). The reroll uses the shared lock
 * (_rerollDie / _rerolledDieIds), so a BA-rerolled die can't be rerolled again.
 */
function _makeBattlefieldAwarenessResolver() {
  const sk = '_baStage';
  const label = (fk) => {
    const base = dcNameFromFigureKey(fk);
    const tail = String(fk).split('-').slice(-2).join('-');
    return `${base} (${tail})`.slice(0, 80);
  };
  const isLando = (fk) => (getDcEffectsGlobal()[dcNameFromFigureKey(fk)]?.specialAbilityIds || []).includes('gambit_lando');
  const postSub = (thread, gameId, id, content, btns) => thread?.send(sanitizeMentions({
    content,
    components: chunkButtonsToRows(btns.map(([c, l, s]) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${id}`).setLabel(l).setStyle(_modsStyle(s)))),
  })).catch(discordCatch);
  const dieLabel = (d) => `${d?.acc || 0}a/${d?.dmg || 0}d/${d?.surge || 0}s`;
  return {
    prompt: ({ game, combat, ctx }) => {
      const figs = eligibleThirdPartyCcFigures(game, 'Battlefield Awareness', combat, _gateDeps(ctx));
      if (!figs.length) return null;
      return { content: '**Battlefield Awareness** — choose the LEADER who plays it:', buttons: figs.map((fk, i) => [String(i), label(fk)]) };
    },
    apply: async (choice, { game, combat, thread, ctx, gameId, id }) => {
      const st = combat[sk] || {};
      const reroll = async (newColor) => {
        const res = _rerollDie(combat, ctx, { pool: 'attack', index: st.index, newColor });
        if (res.ok) await _sendRerollResult(thread, 'attack', `**Battlefield Awareness** — rerolled attack die #${st.index + 1} → ${dieLabel(res.newDie)}.`, res.newDie);
        else await thread?.send(`**Battlefield Awareness** — die #${st.index + 1} not rerolled (${res.reason}).`).catch(discordCatch);
        delete combat[sk];
      };
      if (!st.stage) {
        // Stage 1: a Leader was chosen → pick a die. The card is already
        // discarded at gate-pick (Negate/Comms ran first), so no playCC here.
        const figs = eligibleThirdPartyCcFigures(game, 'Battlefield Awareness', combat, _gateDeps(ctx));
        const fk = figs[parseInt(choice, 10)] ?? figs[0];
        if (!fk) return undefined;
        st.leader = fk; st.gambit = isLando(fk);
        const idxs = _selectableDieIndices(combat, { pool: 'attack' });
        if (!idxs.length) {
          await thread?.send(`**Battlefield Awareness** played by ${label(fk)} — no attack die available to reroll.`).catch(discordCatch);
          return undefined;
        }
        st.stage = 'die'; combat[sk] = st;
        const dice = combat.attackDiceResults || [];
        await postSub(thread, gameId, id, `**Battlefield Awareness** played by ${label(fk)} — choose an attack die to reroll${st.gambit ? ' (Lando: Gambit available)' : ''}:`,
          [...idxs.map((i) => [String(i), `Die #${i + 1} (${dieLabel(dice[i])})`]), ['skip', 'Skip', 'secondary']]);
        return { followUp: true };
      }
      if (st.stage === 'die') {
        if (choice === 'skip') { delete combat[sk]; await thread?.send('**Battlefield Awareness** — Skipped.').catch(discordCatch); return undefined; }
        st.index = parseInt(choice, 10);
        if (st.gambit) {
          st.stage = 'color';
          const die = combat.attackDiceResults?.[st.index];
          await postSub(thread, gameId, id, `**Gambit** — replace die #${st.index + 1} with another attack die of any color, or keep:`,
            [...['blue', 'green', 'red', 'yellow'].map((c) => [c, c, 'primary']), ['keep', `Keep ${die?.color || 'color'}`, 'secondary']]);
          return { followUp: true };
        }
        await reroll(undefined); return undefined;
      }
      if (st.stage === 'color') {
        const newColor = ['blue', 'green', 'red', 'yellow'].includes(choice) ? choice : undefined;
        await reroll(newColor); return undefined;
      }
      return undefined;
    },
  };
}

/**
 * There Is No Try (Yoda) — a third-party die-turn (alexanbv 2026-06-16). Yoda is
 * unique, so there's no figure-picker: discard the card (played by the Yoda
 * figure) then go straight to the die-turn. Attacker version turns an attack die;
 * defender version turns a defense die and converts a Dodge on it to 2 Blocks + 1
 * Evade.
 */
function _makeYodaResolver({ specKey, side }) {
  const turn = side === 'defender'
    ? _makeDefenseDieTurnResolver({ name: 'There Is No Try', stageKey: 'yoda_def', dodgeConversion: true })
    : _makeDieTurnResolver({ name: 'There Is No Try', eligible: (dice) => dice.map((_d, i) => i), stageKey: 'yoda_atk' });
  return {
    prompt: async ({ game, combat, ctx, gameId, window: gateWindow, side: _gateSide, id }) => {
      const figs = eligibleThirdPartyCcFigures(game, specKey, combat, _gateDeps(ctx));
      const fk = figs[0];
      if (!fk) return turn.prompt({ game, combat, ctx }); // no eligible Yoda — skip to die-pick
      const pn = side === 'attacker' ? combat.attackerPlayerNum : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
      const res = await playCcFull(game, gameId, pn, fk, 'There Is No Try', { skipExecute: true }, ctx, ctx.client);
      if (!res.ok) return turn.prompt({ game, combat, ctx }); // can't play — skip to die-pick
      if (res.cancelled) return null; // cancelled — gate re-drives; handleModsPick apply(null) no-ops
      return turn.prompt({ game, combat, ctx }); // survived — show die-turn picker
    },
    apply: async (choice, args) => {
      if (choice === null) return; // cancelled: prompt returned null → no-op
      return turn.apply(choice, args);
    },
  };
}

/**
 * Power-token spend as an on_declare gate option (alexanbv 2026-06-16). MAX ONE
 * token per player per attack — pick one token, spend it, done (no "spend
 * another"). Includes Ko-Tun Squad Cohesion: when active (the figure is within 3
 * of a friendly Ko-Tun), the eligible power tokens on friendlies within 3 of the
 * figure are offered too, each labeled with its owner's name.
 */
function _makeTokenResolver({ side }) {
  const allowed = side === 'attacker' ? ['Damage', 'Surge'] : ['Block', 'Evade'];
  // The combined list of spendable tokens (own + Squad Cohesion donors).
  const _list = (game, combat) => {
    const out = [];
    const fk = tokenSpenderFigureKey(combat, side);
    for (const type of (game.figurePowerTokens?.[fk] || [])) {
      if (allowed.includes(type)) out.push({ figureKey: fk, type, label: `${type} Token` });
    }
    // Squad Cohesion (Ko-Tun) is ATTACKER-only — the defender can't spend nearby
    // friendlies' tokens (alexanbv 2026-06-16).
    const sc = side === 'attacker' ? getSquadCohesionTokens(game, combat, side) : null;
    if (sc?.cohesionTokens?.length) {
      for (const t of sc.cohesionTokens) {
        if (allowed.includes(t.type)) out.push({ figureKey: t.figureKey, type: t.type, label: `${t.type} (${t.ownerName})` });
      }
    }
    return out;
  };
  return {
    prompt: ({ game, combat }) => {
      const list = _list(game, combat);
      if (!list.length) return null;
      return { content: 'Spend ONE power token (max 1 per attack):', buttons: list.map((t, i) => [String(i), `Spend ${t.label}`]) };
    },
    apply: async (choice, { game, combat, thread }) => {
      const list = _list(game, combat);
      const tok = list[parseInt(choice, 10)];
      if (!tok) return undefined;
      const held = game.figurePowerTokens?.[tok.figureKey] || [];
      const idx = held.indexOf(tok.type);
      if (idx < 0) return undefined;
      held.splice(idx, 1);
      let msg = '';
      if (tok.type === 'Damage') { combat.bonusHits = (combat.bonusHits || 0) + 1; msg = '+1 Damage'; }
      else if (tok.type === 'Surge') { combat.surgeBonus = (combat.surgeBonus || 0) + 1; msg = '+1 Surge'; }
      else if (tok.type === 'Block') {
        combat.bonusBlock = (combat.bonusBlock || 0) + 1;
        combat.bonusBlockSources = combat.bonusBlockSources || [];
        combat.bonusBlockSources.push({ label: 'Block token', amount: 1, type: 'token' });
        msg = '+1 Block';
      }
      else if (tok.type === 'Evade') {
        combat.bonusEvade = (combat.bonusEvade || 0) + 1;
        combat.bonusEvadeSources = combat.bonusEvadeSources || [];
        combat.bonusEvadeSources.push({ label: 'Evade token', amount: 1, type: 'token' });
        msg = '+1 Evade';
      }
      // Personal Combat Shield (Gar Saxon): a Block token spent while defending → +1 Evade.
      // (Bo-Katan lost Personal Combat Shield in the IACP 2026-06-21 update — she now has
      // Beskar Armor instead, so personal_combat_shield_bokatan is no longer present.)
      if (tok.type === 'Block' && side === 'defender') {
        const ids = (getDcEffectsGlobal()[dcNameFromFigureKey(tok.figureKey)]?.specialAbilityIds) || [];
        if (ids.includes('personal_combat_shield_gar_saxon') || ids.includes('personal_combat_shield_bokatan')) { combat.bonusEvade = (combat.bonusEvade || 0) + 1; msg += ', +1 Evade (Personal Combat Shield)'; }
      }
      if (thread) await thread.send(`**Power Token** — ${dcNameFromFigureKey(tok.figureKey)} spent a ${tok.type} token: ${msg}.`).catch(discordCatch);
      // Max one per attack — return (record + re-drive); spend_token won't re-offer.
      return undefined;
    },
  };
}

function _resolverFor(pick) {
  if (COMBAT_RESOLVERS[pick]) return COMBAT_RESOLVERS[pick];
  const reg = getCombatAbility(pick);
  if (reg?.params?.kind === 'token') {
    return _makeTokenResolver({ side: reg.params.side });
  }
  if (reg?.params?.kind === 'reroll') {
    return _makeRerollResolver({ name: reg.name, pool: reg.params.pool, side: reg.side, colorSwap: !!reg.params.colorSwap, dieColor: reg.params.dieColor || null, strainCost: reg.params.strainCost || 0, stageKey: `rr_${String(pick).replace(/[^a-z0-9]/gi, '').slice(0, 24)}` });
  }
  if (reg?.params?.kind === 'forced_reroll') {
    return _makeForcedRerollResolver({ slot: reg.params.slot, side: reg.params.side });
  }
  if (reg?.params?.kind === 'exhaust_bonus') {
    return _makeExhaustBonusResolver({ card: reg.params.card, effect: reg.params.effect, label: reg.params.label });
  }
  if (reg?.params?.kind === 'third_party_cc' && String(reg.params.specKey).startsWith('There Is No Try')) {
    return _makeYodaResolver({ specKey: reg.params.specKey, side: reg.side });
  }
  if (reg?.params?.kind === 'third_party_cc' && reg.params.specKey === 'Battlefield Awareness') {
    return _makeBattlefieldAwarenessResolver();
  }
  if (reg?.params?.kind === 'third_party_cc') {
    return _makeThirdPartyCcResolver({ specKey: reg.params.specKey, card: reg.params.card || thirdPartyCardName(reg.params.specKey) });
  }
  // Data-driven ability (csv:<card>:<window>:<side>): reference its specialized
  // effect resolver by ability name (Destruct's "resolver per ability, referenced
  // in the pipeline"). No resolver yet → null → diagnostic no-op button.
  if (reg?.params?.ability) {
    const r = _resolverForAbilityName(reg.params.ability);
    if (r) return r;
  }
  return null;
}

const _modsStyle = (s) => (s === 'secondary' ? ButtonStyle.Secondary : s === 'danger' ? ButtonStyle.Danger : ButtonStyle.Primary);

/**
 * Handle a click in the gate-driven mods choose window
 * (combat_mods_pick_<gameId>_<id|done>). GENERIC: on 'done' the active side
 * passes; on an ability id it looks up that ability's resolver and posts its
 * sub-choice prompt (or applies immediately), never naming a specific ability.
 * Abilities not yet in COMBAT_RESOLVERS fall back to the legacy path.
 * (Gated off by useModsGate; not yet live.)
 */
export async function handleModsPick(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  // GENERIC across windows (alexanbv 2026-06-15): the window is recovered from
  // the per-window pick prefix (combat_<window>_pick_), so one handler drives
  // mods / on_declare / rerolls / after_resolve / special identically.
  const window = _windowForPickCustomId(interaction.customId);
  if (!window) return;
  const cfg = _GATE_WINDOWS[window];
  const rest = parseCustomId(interaction.customId, cfg.pickPrefix);
  // gameId is the first token; the pick id may itself contain underscores
  // (e.g. spray_fire), so split on the FIRST underscore, not the last.
  const u1 = rest.indexOf('_');
  const gameId = rest.substring(0, u1);
  const pick = rest.substring(u1 + 1);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat[cfg.field]) return;
  const gate = combat[cfg.field];
  // Lock the window to the player it's prompted for (alexanbv 2026-06-23): the
  // attacker must NOT be able to click the defender's Done/ability buttons (or
  // vice versa) — doing so desynced the sequence and got it stuck. Guard BEFORE
  // deferUpdate / clearing the buttons, so a wrong-player click is a no-op that
  // leaves the window intact for the correct player.
  const _activeSide = _modsActiveSide(gate);
  if (_activeSide && !game.isTestGame) {
    const _sidePn = _activeSide === 'attacker'
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const _sideId = getPlayerId(game, _sidePn);
    if (_sideId && interaction.user.id !== _sideId) {
      await interaction.followUp({ content: `That's the ${_activeSide}'s window — only they can use these buttons.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Neutral "Play a Command Card" button → ephemeral PRIVATE list of THIS side's
  // playable CCs (alexanbv 2026-06-25). Handled BEFORE the deferUpdate/message
  // clear below so the public window stays intact: the player can play another CC
  // (re-click Play-CC) or hit Done afterward. The interaction was already
  // deferUpdate'd by the central dispatcher, so followUp(ephemeral) works and the
  // public message is untouched. Only the active side reaches here (lock check above).
  if (pick === 'playcc') {
    const _ccPn = (_activeSide === 'attacker')
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const _ccList = (_activeSide ? _pendingInteractive(gate, _activeSide) : []).filter((id) => _isGateCc(id, _ccPn, game));
    if (!_ccList.length) {
      await interaction.followUp({ content: '🃏 You have no Command Cards playable in this window right now.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const _ccBtns = _ccList.map((id) => new ButtonBuilder()
      .setCustomId(`${cfg.pickPrefix}${gameId}_${id}`)
      .setLabel((getCombatAbility(id)?.name || id).slice(0, 80))
      .setStyle(ButtonStyle.Primary));
    await interaction.followUp({
      content: '🃏 **Play a Command Card** — only you can see this. Pick one (you can play more, or just hit **Done** in the combat thread when finished):',
      components: chunkButtonsToRows(_ccBtns),
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const side = _modsActiveSide(gate);
  if (!side) return;
  if (pick === 'done') {
    passModsSide(gate, side);
    await _driveGatePath(window, thread, game, combat, ctx);
  } else if (getCombatAbility(pick)?.params?.kind === 'cc') {
    // Command-Card button in the combat sequence — routed through the UNIFIED
    // counter-window like a hand play (alexanbv 2026-06-17). The attack gate
    // PAUSES for the Negate/Comms window and re-drives (back to this phase's
    // options) after the play resolves or is cancelled, via
    // _resolveCcCounterWindow → resumeCombatGateAfterCc. No snapshot, no revert.
    const _ccReg = getCombatAbility(pick);
    const _ccCard = _ccReg.params.card;
    // Stale-click guard: the player may have opened the ephemeral CC list during
    // the attacker gate, then clicked Done in the thread (advancing the gate to
    // defender), then clicked a CC from the now-stale ephemeral list. The ability's
    // registered side (e.g., 'attacker') no longer matches the current active side
    // ('defender'), so `ccPn` would resolve to the wrong player, causing a spurious
    // "timing or play-restriction" error (EoS: isAttacker=false). Re-drive silently.
    if (_ccReg.side && _ccReg.side !== side) {
      await _driveGatePath(window, thread, game, combat, ctx);
    } else {
    // False Orders / Lure: the controller plays the attacker-side CC.
    const ccPn = side === 'attacker'
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const ccFig = side === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
    const _ccCheck = canPlayCC(game, ccPn, ccFig, _ccCard, { allowNotInHand: false });
    if (!_ccCheck.ok) {
      if (thread) await thread.send(`⚠️ Can't play ${_ccCard}: ${_ccCheck.reason}`).catch(discordCatch);
      await _driveGatePath(window, thread, game, combat, ctx);
    } else {
      recordModsChoice(gate, side, pick);
      _markGateAbilityUsed(game, combat, pick);
      await playCcFull(game, gameId, ccPn, ccFig, _ccCard, {
        extraStackEntry: {
          figureKey: ccFig,
          msgId: side === 'attacker' ? combat.attackerMsgId : null,
          combat: true,
        },
      }, ctx, interaction.client);
      await _driveGatePath(window, thread, game, combat, ctx);
    }
    }
  } else if (_isRerollCcPick(pick, side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
    : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum)), game)) {
    // Reroll Command card: Negate/Comms FIRST (before the die-picker). Counter
    // window runs via playCC + injected promptOpponentCancel — suspends inline.
    // If survived, show die-picker immediately (no resume indirection needed).
    // Cancelled → no die-pick, no reroll.
    const _rReg = getCombatAbility(pick);
    const _rCard = _rerollCcCardName(_rReg, pick);
    const _rPn = side === 'attacker'
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const _rFig = side === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
    const _rChk = canPlayCC(game, _rPn, _rFig, _rCard, { allowNotInHand: false });
    if (!_rChk.ok) {
      if (thread) await thread.send(`⚠️ Can't play ${_rCard}: ${_rChk.reason}`).catch(discordCatch);
      await _driveGatePath(window, thread, game, combat, ctx);
    } else {
      recordModsChoice(gate, side, pick);
      _markGateAbilityUsed(game, combat, pick);
      const _rRes = await playCcFull(game, gameId, _rPn, _rFig, _rCard, { skipExecute: true }, ctx, interaction.client);
      if (!_rRes.cancelled) {
        // Survived — post the die-picker now (same path as handleModsSubChoice would)
        const r = _resolverFor(pick);
        const p = r?.prompt ? await r.prompt({ game, combat, thread, ctx, side, gameId, id: pick, window }) : null;
        if (p?.buttons) {
          const rows = chunkButtonsToRows(p.buttons.map(([c, l, s]) =>
            new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${pick}`).setLabel(l).setStyle(_modsStyle(s))));
          await thread?.send(sanitizeMentions({ content: p.content, components: rows, allowedMentions: p.mentionUserId ? { users: [p.mentionUserId] } : undefined })).catch(discordCatch);
          // handleModsSubChoice → apply → reroll → _driveGateOrOfferToughLuck
        } else {
          if (r?.apply) await r.apply(null, { game, combat, thread, ctx, side, gameId, id: pick, window });
          await _driveGateOrOfferToughLuck(window, thread, game, combat, ctx);
        }
      } else {
        // Cancelled — re-drive gate (no die-pick, no reroll)
        await _driveGatePath(window, thread, game, combat, ctx);
      }
    }
  } else {
    const r = _resolverFor(pick);
    if (r) {
      // Generic, data-driven: post the ability's sub-choice prompt, or apply
      // immediately if it has none. The handler never names the ability.
      const p = r.prompt ? await r.prompt({ game, combat, thread, ctx, side, gameId, id: pick, window }) : null;
      if (p?.buttons) {
        const rows = chunkButtonsToRows(p.buttons.map(([c, l, s]) =>
          new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${pick}`).setLabel(l).setStyle(_modsStyle(s))));
        if (p.ephemeral) {
          // Hand-revealing sub-choice (CC-discard): post PRIVATELY to the picking
          // player so the opponent never sees their hand (alexanbv 2026-06-26).
          // The interaction was already deferUpdate'd, so followUp(ephemeral) works.
          await interaction.followUp({ content: p.content, components: rows, ephemeral: true }).catch(discordCatch);
        } else {
          await thread.send(sanitizeMentions({ content: p.content, components: rows, allowedMentions: p.mentionUserId ? { users: [p.mentionUserId] } : undefined })).catch(discordCatch);
        }
        // wait for the sub-choice (handleModsSubChoice resolves + re-drives)
      } else {
        delete combat._lastRerolledDie;
        if (r.apply) await r.apply(null, { game, combat, thread, ctx, side, gameId, id: pick, window });
        // If the resolver cancelled the combat (Strike Me Down, Slow on the Draw),
        // game.pendingCombat will be null/different — bail before re-driving the gate.
        if (!game.pendingCombat || game.pendingCombat.gameId !== gameId) {
          saveGames?.(game.gameId);
          return;
        }
        recordModsChoice(gate, side, pick);
        _markGateAbilityUsed(game, combat, pick); // once/round-etc. → owner used-list
        await _driveGateOrOfferToughLuck(window, thread, game, combat, ctx);
      }
    } else {
      // Unknown id (no resolver registered) — record + skip so the gate never
      // stalls. (Every combat ability should register a resolver.)
      recordModsChoice(gate, side, pick);
      _markGateAbilityUsed(game, combat, pick);
      await _driveGatePath(window, thread, game, combat, ctx);
    }
  }
  saveGames?.(game.gameId);
}

/**
 * Re-find the friendly figure key that grants a proximity mods ability (gate
 * path) so its once-per-round flag can be marked. Mirrors the detection in
 * combat-abilities-mods.js. Returns the figure key or null.
 */
function _findModsFigKey(id, game, combat) {
  const effOf = (fk) => {
    const all = getDcEffectsGlobal() || {};
    const n = dcNameFromFigureKey(fk);
    return all[n] || all[(n || '').replace(/\s*\[.*\]\s*$/, '')] || null;
  };
  const mapSp = getMapData(game.selectedMap?.id);
  const blockedEdges = getClosedDoorEdges(game);
  if (id === 'call_the_shots') {
    const friendly = game.figurePositions?.[combat.attackerPlayerNum] || {};
    const atkCoord = friendly[combat.attackerFigureKey];
    if (!atkCoord || !mapSp) return null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === combat.attackerFigureKey) continue;
      if (!(effOf(fk)?.specialAbilityIds || []).includes('call_the_shots_hera')) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_call_the_shots`]) continue;
      if (_isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkCoord).toLowerCase(), 3, blockedEdges, game)) return fk;
    }
  } else if (id === 'get_down') {
    const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const friendly = game.figurePositions?.[defPN] || {};
    const defCoord = friendly[combat.target?.figureKey];
    if (!defCoord || !mapSp) return null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!(effOf(fk)?.specialAbilityIds || []).includes('get_down_onar')) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_get_down`]) continue;
      if (_isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 2, blockedEdges, game)) return fk;
    }
  }
  return null;
}

/**
 * Resolve a gate-path mods sub-choice (combat_modsub_<gameId>_<choice>_<id>):
 * apply the effect, record the ability on the gate, re-drive. Self-contained —
 * does not touch the legacy handleCombatPassive. (Gated off by useModsGate.)
 */
export async function handleModsSubChoice(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const rest = parseCustomId(interaction.customId, 'combat_modsub_');
  const u1 = rest.indexOf('_');
  const gameId = rest.substring(0, u1);
  const r2 = rest.substring(u1 + 1);
  const u2 = r2.indexOf('_');
  const choice = r2.substring(0, u2);
  const id = r2.substring(u2 + 1);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  // GENERIC across windows: the sub-choice belongs to whichever gate is live.
  const window = _activeGateWindow(combat);
  if (!window) return;
  const gate = combat[_GATE_WINDOWS[window].field];
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  const side = _modsActiveSide(gate);
  // Lock to the prompted player (alexanbv 2026-06-23) — guard BEFORE deferring /
  // clearing buttons so a wrong-player click leaves the window intact.
  if (side && !game.isTestGame) {
    const _sidePn = side === 'attacker'
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const _sideId = getPlayerId(game, _sidePn);
    if (_sideId && interaction.user.id !== _sideId) {
      await interaction.followUp({ content: `That's the ${side}'s window — only they can use these buttons.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Generic, data-driven resolution: look up the ability's resolver and apply
  // the chosen option, then record + re-drive. Never names a specific ability.
  const _resolver = _resolverFor(id);
  if (_resolver) {
    delete combat._lastRerolledDie;
    const _res = _resolver.apply ? await _resolver.apply(choice, { game, combat, thread, ctx, side, gameId, id, window }) : null;
    // Multi-stage abilities (e.g. pick die → pick face) return { followUp: true }
    // after posting their next prompt; don't record/advance until they finish.
    if (_res?.followUp) { saveGames?.(game.gameId); return; }
    if (side) { try { recordModsChoice(gate, side, id); } catch { /* not pending */ } }
    _markGateAbilityUsed(game, combat, id); // once/round-etc. → owner used-list (after the multi-stage resolve completes)
    await _driveGateOrOfferToughLuck(window, thread, game, combat, ctx);
    saveGames?.(game.gameId);
    return;
  }


  if (side) { try { recordModsChoice(gate, side, id); } catch { /* not pending */ } }
  _markGateAbilityUsed(game, combat, id);
  await _driveGatePath(window, thread, game, combat, ctx);
  saveGames?.(game.gameId);
}

/**
 * Tough Luck gate response (alexanbv 2026-06-17). The relevant player (offered by
 * _offerToughLuck) either removes the rerolled die's RESULT (zeroes its icons +
 * recalc, and discards the Tough Luck CC) or skips; then the rerolls window
 * resumes. customId: tlgate_remove_<gameId>_<pool>_<idx> | tlgate_skip_<gameId>.
 */
// CC plays in combat all route through playCcFull (unified pipeline).
// Params-less reroll-CC registrations (card detected in `applies`, not params).
const _REROLL_CC_CARD_BY_ID = { rapid_recalibration: 'Rapid Recalibration' };
/** The Command-card name a reroll gate ability plays, across param shapes. */
function _rerollCcCardName(reg, pick) {
  return reg?.params?.card || reg?.params?.specKey || _REROLL_CC_CARD_BY_ID[pick] || null;
}
/** True iff a picked gate ability is a reroll backed by a CC in hand. Scoped to
 * the verified reroll CCs — NOT all third-party CCs (Bodyguard etc. use the
 * generic resolver with its own playCC and would double-dispose). */
function _isRerollCcPick(pick, ccPn, game) {
  const reg = getCombatAbility(pick);
  const card = _rerollCcCardName(reg, pick);
  if (!card) return false;
  const isReroll = reg.params?.kind === 'reroll' || reg.params?.kind === 'capitalize' || /^reroll:/.test(pick)
    || pick === 'rapid_recalibration'
    // Reroll third-party CCs (Battlefield Awareness, Guardian Stance, …) are the
    // ones registered in the 'rerolls' window; the on_declare third-party CCs
    // (Bodyguard, …) are NOT rerolls and keep their own resolver path.
    || (reg.params?.kind === 'third_party_cc' && (reg.windows || []).includes('rerolls'));
  if (!isReroll) return false;
  const lc = String(card).toLowerCase();
  return (getCcHand(game, ccPn) || []).some((n) => String(n).toLowerCase() === lc);
}


export async function handleToughLuckGate(interaction, ctx) {
  const { getGame, saveGames, replyIfGameEnded } = ctx;
  const isRemove = interaction.customId.startsWith('tlgate_remove_');
  const parts = splitCustomId(interaction.customId, isRemove ? 'tlgate_remove_' : 'tlgate_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded?.(game, interaction)) return;
  const combat = game.pendingCombat;
  const tl = combat?._pendingToughLuck;
  if (!tl) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, tl.playerNum, canActAsPlayer, 'Only the Tough Luck player may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  const dice = tl.pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults;
  const die = dice?.[tl.idx];
  if (isRemove && die) {
    // skipTimingCheck: 'afteropponentreroll' returns false from isCcPlayableNow
    // (dedicated gate, not the hand dropdown). skipExecute: die-removal runs inline.
    const tlPool = tl.pool, tlIdx = tl.idx, tlPlayerNum = tl.playerNum;
    delete combat._pendingToughLuck;
    const res = await playCcFull(game, game.gameId, tlPlayerNum, null, 'Tough Luck', {
      skipExecute: true, skipTimingCheck: true,
    }, ctx, interaction.client);
    if (res.ok && !res.cancelled) {
      // Apply die-removal inline (survived Negate/Comms).
      const dice = tlPool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults;
      const die2 = dice?.[tlIdx];
      if (die2) {
        if (tlPool === 'attack') { die2.acc = 0; die2.dmg = 0; die2.surge = 0; }
        else { die2.block = 0; die2.evade = 0; die2.dodge = false; }
        const recalc = tlPool === 'attack' ? _recalcAttackTotals : _recalcDefenseTotals;
        combat[tlPool === 'attack' ? 'attackRoll' : 'defenseRoll'] = recalc(dice);
        await thread?.send(`**Tough Luck** — removed the rerolled ${die2.color} ${tlPool} die's result.`).catch(discordCatch);
      }
    }
    // Re-drive the rerolls gate whether the card was cancelled or not.
    await _driveGateOrOfferToughLuck('rerolls', thread, game, combat, ctx);
    saveGames?.(game.gameId);
    return;
  }
  // Skip (or the die vanished) — no play, no counter-window. Tough Luck has now
  // resolved, so re-enter the post-reroll driver: it will offer Double or Nothing
  // next (combat._lastRerolledDie still flags _toughLuckOffered), then resume.
  if (!isRemove) await thread?.send('**Tough Luck** — Skipped.').catch(discordCatch);
  delete combat._pendingToughLuck;
  await _driveGateOrOfferToughLuck('rerolls', thread, game, combat, ctx);
  saveGames?.(game.gameId);
}

/**
 * End-of-rerolls Tough Luck picker (alexanbv 2026-06-30). The defender picks any
 * one rerolled attack die to cancel; then the attacker picks any one rerolled
 * defense die (if applicable). Posted by _offerToughLuckFinal at end of rerolls.
 * customId: tl_final_remove_${gameId}_${pool}_${idx}  OR  tl_final_skip_${gameId}
 */
export async function handleToughLuckFinalPick(interaction, ctx) {
  const { getGame, saveGames, replyIfGameEnded } = ctx;
  const isRemove = interaction.customId.startsWith('tl_final_remove_');
  const parts = splitCustomId(interaction.customId, isRemove ? 'tl_final_remove_' : 'tl_final_skip_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded?.(game, interaction)) return;
  const combat = game.pendingCombat;
  const pend = combat?._pendingToughLuckFinal;
  if (!pend) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, pend.playerNum, canActAsPlayer, 'Only the Tough Luck player may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  if (isRemove) {
    const tlPool = parts[1]; // 'attack' or 'defense'
    const tlIdx = parseInt(parts[2], 10);
    const tlPlayerNum = pend.playerNum;
    delete combat._pendingToughLuckFinal;

    const res = await playCcFull(game, game.gameId, tlPlayerNum, null, 'Tough Luck', {
      skipExecute: true, skipTimingCheck: true,
    }, ctx, interaction.client);
    if (res.ok && !res.cancelled) {
      const dice = tlPool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults;
      const die = dice?.[tlIdx];
      if (die) {
        if (tlPool === 'attack') { die.acc = 0; die.dmg = 0; die.surge = 0; }
        else { die.block = 0; die.evade = 0; die.dodge = false; }
        const recalc = tlPool === 'attack' ? _recalcAttackTotals : _recalcDefenseTotals;
        combat[tlPool === 'attack' ? 'attackRoll' : 'defenseRoll'] = recalc(dice);
        await thread?.send(`**Tough Luck** — removed the rerolled ${die.color} ${tlPool} die's result.`).catch(discordCatch);
      }
    }
  } else {
    // Skip
    delete combat._pendingToughLuckFinal;
    await thread?.send('**Tough Luck** — Skipped.').catch(discordCatch);
  }

  // Check if the other player also gets a TL window; if so, picker is already posted.
  if (await _offerToughLuckFinal(thread, game, combat, ctx)) {
    saveGames?.(game.gameId);
    return;
  }
  // Both TL windows resolved (or not needed) — clean up and advance the attack.
  delete combat._rerolledDice;
  if (combat._seqActive) {
    await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
  }
  saveGames?.(game.gameId);
}

/** Apply a passive mods ability automatically (no player decision). */
export async function _fireModsPassive(side, id, thread, game, combat, ctx) {
  // Two-timing model (alexanbv 2026-06-18): GENERAL drain of pending modifiers
  // stashed for the mods window by an ability played at an earlier timing
  // (Hondo/HK-47 +Damage, Cavalry Charge round buff, …). Applies each structured
  // delta onto the combat counters and reports the source. Not card-specific.
  if (id === 'pending_modifiers_drain') {
    for (const { source, effect } of drainPendingModifiers(combat, 'mods')) {
      applyPendingEffect(combat, effect);
      if (source) await thread?.send(`**${source}** — applied (deferred to modifiers).`).catch(discordCatch);
    }
    return;
  }
  // Automatic attachment passives migrated off the eager declaration path
  // (combat-abilities-attachment-auto.js). alexanbv 2026-06-17.
  if (id === 'driven_by_hatred_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Driven by Hatred** — +1 Damage.').catch(discordCatch);
    return;
  }
  if (id === 'wookiee_avenger_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Wookiee Avenger** — +1 Damage while attacking.').catch(discordCatch);
    return;
  }
  if (id === 'combat_suit_reduce_pierce') {
    combat.defenderReducePierce = (combat.defenderReducePierce || 0) + 1;
    await thread?.send('**Combat Suit** — reduce the attack\'s Pierce by 1.').catch(discordCatch);
    return;
  }
  if (id === 'heir_to_the_jedi_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Heir to the Jedi** — +1 Damage (Ranged attack).').catch(discordCatch);
    return;
  }
  if (id === 'prey_on_the_weak') {
    combat.bonusPierce = (combat.bonusPierce || 0) + 1;
    combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 1;
    await thread?.send('**Prey on the Weak** — +1 Pierce, +1 Accuracy (target costs less).').catch(discordCatch);
    return;
  }
  if (id === 'explosive_armaments_surge') {
    (combat.bonusSurgeAbilities = combat.bonusSurgeAbilities || []).push('damage 1, blast 1');
    return;
  }
  if (id === 'feeding_frenzy_surge') {
    (combat.bonusSurgeAbilities = combat.bonusSurgeAbilities || []).push('recover 2');
    return;
  }
  if (id === 'wookiee_avenger_defend') { combat.wookieeAvengerDefend = true; return; }
  if (id === 'rogue_smuggler_distracting') { combat.rougeSmuggler_loseDistracting = true; return; }
  if (id === 'pulse_cannon') {
    combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 4;
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    combat.pulseCannonResolved = true;
    await thread.send('**Pulse Cannon** — Power Token spent: **+4 Accuracy, +1 Damage**.').catch(discordCatch);
  } else if (id === 'fury_kashyyyk_pierce') {
    combat.bonusPierce = (combat.bonusPierce || 0) + 1;
    await thread.send('**Fury of Kashyyyk** — +1 Pierce (elite WOOKIEE, target within 2, friendly WOOKIEE within 2 of the defender).').catch(discordCatch);
  } else if (id === 'protector' || id === 'sentinel') {
    // "1 Sentinel or Protector per attack" — a single combined +1 Block. Both can
    // be eligible this attack; only the first fired applies (shared flag).
    if (!combat._sentinelProtectorApplied) {
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      combat._sentinelProtectorApplied = true;
      const label = id === 'protector' ? 'Protector' : 'Sentinel';
      await thread.send(`**${label}** — adjacent to the targeted space: +1 Block for the defender.`).catch(discordCatch);
    }
  } else if (id === 'supporting_fire') {
    combat.bonusPierce = (combat.bonusPierce || 0) + 1;
    game.activationAbilityUsed = game.activationAbilityUsed || {};
    game.activationAbilityUsed['J4X-7:Supporting Fire'] = true; // once per activation
    await thread.send('**Supporting Fire** (J4X-7) — friendly attacking a figure adjacent to J4X-7: +1 Pierce.').catch(discordCatch);
  } else if (id === 'air_support') {
    combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
    await thread.send('✈️ **Air Support** (Bodhi Rook) — friendly spent a Power Token while unfocused: +2 Accuracy.').catch(discordCatch);
  } else if (id === 'the_generals_ranks') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread.send("**The General's Ranks** — +1 Damage (attack outside your activation).").catch(discordCatch);
  } else if (id === 'fury_wookiee') {
    combat.surgeBonus = (combat.surgeBonus || 0) + 1;
    await thread.send('**Fury** — Wookiee Warrior has suffered 5+ Damage: +1 Surge.').catch(discordCatch);
  } else if (id === 'slippery') {
    const bump = applySlipperyBonus({ bonusAccuracy: combat.bonusAccuracy });
    combat.bonusAccuracy = bump.bonusAccuracy;
    await thread.send('**Slippery** — Defender applies -2 Accuracy to the attack.').catch(discordCatch);
  // 'take_cover' is now INTERACTIVE (Apply/Skip) — handled by
  // COMBAT_RESOLVERS.take_cover, not this passive branch (CSV resolution=prompt,
  // "you MAY apply +1 Block and -1 Evade").
  } else if (id === 'gamorrean_honor_guard') {
    const { bonusBlock } = applyGamorreanHonorGuardBonus(combat);
    combat.bonusBlock = bonusBlock;
    await thread.send('**Gamorrean Honor Guard** — +1 Block (defending against Ranged attack).').catch(discordCatch);
  } else if (id === 'composite_plating') {
    const { bonusBlock } = applyCompositePlatingBonus(combat);
    combat.bonusBlock = bonusBlock;
    await thread.send('**Composite Plating** — +1 Block (attacker 4+ spaces away).').catch(discordCatch);
  } else if (id === 'disposable') {
    const bump = applyEvadeDebuff(combat);
    combat.bonusEvade = bump.bonusEvade;
    await thread.send("**Disposable** — −1 Evade applied to defender's defense results.").catch(discordCatch);
  } else if (id === 'cortosis_weave') {
    const r = applyCortosisWeave(combat);
    combat.bonusPierce = r.bonusPierce;
    await thread.send('**Cortosis Weave** — Pierce reduced by 2 (min 0).').catch(discordCatch);
  } else if (id === 'conclusion') {
    combat.conclusionDodgeCancel = true;
    await thread.send('**Conclusion** — −1 Dodge: any Dodge rolled by defender is cancelled.').catch(discordCatch);
  } else if (id === 'dead_precise_dodge') {
    combat.bonusDodge = (combat.bonusDodge || 0) - 1;
    await thread.send('**Dead Precise** (Ko-Tun within 3, Power Token spent) — −1 Dodge to the attack results.').catch(discordCatch);
  } else if (id === 'deadly_precision') {
    combat.bonusDodge = (combat.bonusDodge || 0) - 1;
    await thread.send('**Deadly Precision** — −1 Dodge to the defense results (this round).').catch(discordCatch);
  } else if (id === 'cunning') {
    const r = applyCunningFlag(combat);
    combat.hasCunning = r.hasCunning;
  } else if (id === 'find_weakness') {
    // Card: "While attacking, apply +3 Accuracy and -1 Evade to the results."
    // The Accuracy portion was missing (alexanbv audit 2026-06-22).
    const r = applyFindWeaknessEvade(combat);
    combat.bonusEvade = r.bonusEvade;
    combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 3;
    await thread.send('**Find Weakness** — +3 Accuracy and −1 Evade applied to the attack results.').catch(discordCatch);
  } else if (id === 'scattergun') {
    const atkName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || '');
    const sids = (getDcEffectsGlobal()[atkName] || getDcEffectsGlobal()[(atkName || '').replace(/\s*\[.*\]\s*$/, '')])?.specialAbilityIds || [];
    if (hasAcpScattergun(sids)) {
      const r = applyScattergunHits(combat, ACP_SCATTERGUN_HIT_DELTA);
      combat.bonusHits = r.bonusHits;
      await thread.send('**ACP Scattergun** — adjacent to target: +2 Hits.').catch(discordCatch);
    } else {
      const r = applyScattergunHits(combat, SCATTERGUN_HIT_DELTA);
      combat.bonusHits = r.bonusHits;
      await thread.send('**Scattergun** — adjacent to target: +1 Damage.').catch(discordCatch);
    }
  } else if (id === 'forest_fighters') {
    const r = applyForestFightersHit(combat);
    combat.bonusHits = r.bonusHits;
    await thread.send('**Forest Fighters** — +1 Damage (Hidden, Melee attack).').catch(discordCatch);
  } else if (id === 'exploit_weakness') {
    const r = applyExploitWeaknessSurge(combat);
    combat.surgeBonus = r.surgeBonus;
    await thread.send('**Exploit Weakness** — defender has a harmful condition, +1 Surge.').catch(discordCatch);
  } else if (id === 'shared_intuition') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread.send('**Shared Intuition** (4-LOM) — friendly HUNTER within 3 has LOS to the target: +1 Damage.').catch(discordCatch);
  } else if (id === 'set_your_sights') {
    combat.bonusPierce = (combat.bonusPierce || 0) + 1;
    await thread.send('**Set Your Sights** (Loku) — target has a Recon token: Pierce 1.').catch(discordCatch);
  } else if (id === 'distracting') {
    const r = applyDistractingEvade(combat);
    combat.bonusEvade = r.bonusEvade;
    // Find the specific figure that triggered Distracting (adjacent to target).
    const _distDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _distTargetCoord = combat.target?.coord
      ? String(combat.target.coord).toLowerCase()
      : (game.figurePositions?.[_distDefPN]?.[combat.target?.figureKey]
        ? String(game.figurePositions[_distDefPN][combat.target.figureKey]).toLowerCase()
        : null);
    let _distractingFigName = null;
    if (_distTargetCoord && game.selectedMap?.id) {
      const _distMapSp = getMapData(game.selectedMap.id);
      const _distBlocked = getClosedDoorEdges(game);
      for (const [_fk, _pos] of Object.entries(game.figurePositions?.[_distDefPN] || {})) {
        if (!_pos) continue;
        const _dn = dcNameFromFigureKey(_fk);
        const _eff = getDcEffectsGlobal()[_dn];
        if (!hasDistractingAbility(_eff?.specialAbilityIds)) continue;
        if (_fk === combat.target?.figureKey) continue;
        if (_isWithinSpaces(_distMapSp, String(_pos).toLowerCase(), _distTargetCoord, 1, _distBlocked)) {
          _distractingFigName = _dn;
          break;
        }
      }
    }
    const _distLabel = _distractingFigName || 'Han Solo / C-3PO';
    await thread.send(`🎭 **Distracting** — **${_distLabel}** is adjacent to target space: **+1 Evade** for the defender.`).catch(discordCatch);
  } else if (id === 'hunker_down') {
    combat.bonusEvade = (combat.bonusEvade || 0) + 1;
    await thread.send('**Hunker Down** (Cara Dune) — adjacent to blocking/impassable/difficult terrain: +1 Evade.').catch(discordCatch);
  } else if (id === 'improvised_cover_verena') {
    combat.bonusBlock = (combat.bonusBlock || 0) + 1;
    await thread.send('**Improvised Cover** (Verena Talos) — adjacent to an object or non-friendly figure: +1 Block.').catch(discordCatch);
  } else if (id === 'vague_and_unconvincing') {
    await thread.send('**Vague and Unconvincing** (K-2SO) — while K-2SO defends, neither player may spend Power Tokens or play Command cards this attack.').catch(discordCatch);
  // 'negotiate' is no longer a mods passive (two-timing: moved to the on_declare
  // gate; its +2 Damage now lands here via the generic 'pending_modifiers_drain'
  // above). No mods-passive branch needed.
  } else if (id === 'defensive_stance') {
    // "Convert EACH Dodge to 2 Block and 1 Evade" — Dodge is COUNTED, so scale
    // by the rolled Dodge count (mirrors Wookiee Avenger, src/game/combat.js).
    const dr = combat.defenseRoll || {};
    const _dod = typeof dr.dodge === 'number' ? dr.dodge : (dr.dodge ? 1 : 0);
    combat.defenseRoll = { block: (dr.block || 0) + 2 * _dod, evade: (dr.evade || 0) + 1 * _dod, dodge: false };
    await thread.send(`**Defensive Stance** — ${_dod} Dodge converted to +${2 * _dod} Block, +${1 * _dod} Evade.`).catch(discordCatch);
  } else if (id === 'lucky') {
    // R2-D2 Lucky — automatic: a BLANK defense-die result is present, so add +1
    // Dodge. combat.bonusDodge is summed into total Dodge at resolution
    // (src/game/combat.js). No prompt (resolution=automatic). alexanbv 2026-06-26.
    combat.bonusDodge = (combat.bonusDodge || 0) + 1;
    await thread.send('🍀 **Lucky** (R2-D2) — rolled a blank result: **+1 Dodge**.').catch(discordCatch);
  } else if (id === 'soresu') {
    // Convert EACH Dodge → +2 Block / +1 Evade (Dodge is counted), then — per
    // the card — if the rerolling (defending) figure is NOT a FORCE USER, Kanan
    // suffers 1 Strain. (Previously the conditional Strain was never applied.)
    const dr = combat.defenseRoll || {};
    const _dod = typeof dr.dodge === 'number' ? dr.dodge : (dr.dodge ? 1 : 0);
    combat.defenseRoll = { block: (dr.block || 0) + 2 * _dod, evade: (dr.evade || 0) + 1 * _dod, dodge: false };
    await thread.send(`**Soresu Form** — ${_dod} Dodge converted to +${2 * _dod} Block, +${1 * _dod} Evade.`).catch(discordCatch);
    // Rerolling figure = the defender (combat.target). If it lacks FORCE USER,
    // Kanan (combat.soresuFormFigKey) suffers 1 Strain.
    const _kananFk = combat.soresuFormFigKey;
    const _defFk = combat.target?.figureKey;
    if (_kananFk && _defFk) {
      const _eff = getDcEffectsGlobal() || {};
      const _defName = dcNameFromFigureKey(_defFk);
      const _e = _eff[_defName] || _eff[(_defName || '').replace(/\s*\[.*\]\s*$/, '')];
      const _kws = [...(_e?.keywords || []), ...(_e?.traits || [])].map((k) => String(k).toUpperCase());
      if (!_kws.includes('FORCE USER')) {
        const _defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
        await applyStrain(game, ctx, { figureKey: _kananFk, controllerPlayerNum: _defPN, amount: 1, source: 'Soresu Form' });
        await thread.send('**Soresu Form** — rerolling figure is not a FORCE USER: Kanan suffers 1 Strain.').catch(discordCatch);
      }
    }
    combat.soresuFormFigKey = null;
  }
}

// On-declare passive effects (fire in the on_declare gate, BEFORE the roll —
// these add a die / apply a condition to the pool, so they must precede the
// roll mechanic). Moved from the inline declaration block in handleAttackTarget
// per alexanbv 2026-06-16 "implement at the right timing". Each auto-Focus
// ability applies the Focus condition + adds a bonus die to the attack pool
// (mirrors applyConditionWithDie at declaration).
export async function _fireOnDeclarePassive(side, id, thread, game, combat, ctx) {
  const AUTO_FOCUS = {
    battle_meditation: { cond: 'Focus', die: 'green', label: 'Battle Meditation' },
    mystic_hunter:     { cond: 'Focus', die: 'green', label: 'Mystic Hunter' },
    full_of_rage:      { cond: 'Focus', die: 'green', label: 'Full of Rage' },
    sharpshooter:      { cond: 'Focus', die: 'green', label: 'Sharpshooter' },
  };
  const af = AUTO_FOCUS[id];
  if (af) {
    const r = applyConditionWithDie(game, combat.attackerFigureKey, af.cond, combat.attackInfo, af.die);
    if (r.applied) {
      combat.attackInfo = r.attackInfo;
      // BT-1 carries this ability under the name "Assassin", not "Battle
      // Meditation" (alexanbv 2026-06-24) — use the per-DC label.
      const label = id === 'battle_meditation'
        ? battleMeditationLabel(combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey || ''))
        : af.label;
      await thread.send(`**${label}** — auto-Focus: +1 ${af.die} die.`).catch(discordCatch);
    }
    return;
  }
  // Fly-By (Jet Trooper Elite) — add a blue die when the target is within 2
  // (no Focus condition, just an extra attack die).
  if (id === 'fly_by') {
    combat.attackInfo = { ...combat.attackInfo, dice: [...(combat.attackInfo.dice || []), 'blue'] };
    await thread.send('**Fly-By** — target within 2 spaces: +1 blue die.').catch(discordCatch);
  }
}

/** Post the player-ordered choose window for a side's pending interactive mods abilities. */
/** Post a step's player-ordered choose window (generic). */
/**
 * Is this gate-window pick a Command-Card PLAY (secret hand info) vs. a public DC
 * ability? CC plays = registry params.kind 'cc'/'cc_interactive', plus reroll CCs.
 * Used to keep CC offers OUT of the shared combat thread (hand-secrecy, alexanbv
 * 2026-06-25).
 */
export function _isGateCc(id, ccPn, game) {
  const k = getCombatAbility(id)?.params?.kind;
  if (k === 'cc' || k === 'cc_interactive') return true;
  return _isRerollCcPick(id, ccPn, game);
}

export async function _postGateChooseWindow(window, side, pending, thread, game, combat) {
  // ARCHITECTURE NOTE (alexanbv 2026-06-25): this is the UNIFIED gate window's
  // choose-ability poster, with the neutral "Play a Command Card" secrecy button
  // below (handleModsPick 'playcc'). The "After Attack Resolves" window is the
  // ONE combat window NOT driven from here — it lives in
  // src/handlers/after-attack-resolve.js (postPostResolveWindow + the aar_*
  // handlers) and has its OWN copy of the Play-CC secrecy button. Any change to
  // this CC-secrecy / button-locking pattern must be mirrored THERE too until
  // after_resolve is migrated onto this gate framework. See the big ARCHITECTURE
  // NOTE on postPostResolveWindow.
  const cfg = _GATE_WINDOWS[window];
  // Hidden/Weakened notes belong to the MODS stage, not the surge-spend step
  // (alexanbv 2026-07-10) — post once per side when its mods window first opens.
  if (window === 'mods') {
    combat._condNotesPosted = combat._condNotesPosted || {};
    if (!combat._condNotesPosted[side]) {
      combat._condNotesPosted[side] = true;
      const notes = [];
      if (side === 'attacker' && !combat.attackerCondEffectsSuppressed) {
        if (combat.attackerConds?.includes('Hide')) notes.push('🫥 **Hidden** — attacker: **+1 Surge** result.');
        if (combat.attackerConds?.includes('Weaken')) notes.push('🌀 **Weakened** — attacker: **−1 Surge** result.');
      } else if (side === 'defender' && !combat.defenderCondEffectsSuppressed) {
        if (combat.defenderConds?.includes('Hide')) notes.push('🫥 **Hidden** — defender: attacker suffers **−2 Accuracy**.');
        if (combat.defenderConds?.includes('Weaken')) notes.push('🌀 **Weakened** — defender: **−1 Evade** result.');
      }
      for (const n of notes) await thread.send(n).catch(discordCatch);
    }
  }
  // False Orders / Lure: the controller acts on the attacker side.
  const sidePlayerNum = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
    : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
  const sideId = game[`player${sidePlayerNum}Id`];
  // Hand secrecy (alexanbv 2026-06-25): a CC-play button in the SHARED combat
  // thread reveals the player's hand to the opponent — and its ABSENCE reveals
  // the player holds no relevant CC. Split offers: public DC-ability buttons go
  // in the thread; CC plays go behind a NEUTRAL, ALWAYS-PRESENT "Play a Command
  // Card" button that opens an EPHEMERAL private list (handleModsPick 'playcc').
  // The Play-CC button shows even with zero playable CC, so presence/absence
  // leaks nothing. Multi-CC: it stays clickable until the player hits Done.
  const ccIds = pending.filter((id) => _isGateCc(id, sidePlayerNum, game));
  const dcIds = pending.filter((id) => !ccIds.includes(id));
  const btns = dcIds.map((id) => {
    const reg = getCombatAbility(id);
    return new ButtonBuilder()
      .setCustomId(`${cfg.pickPrefix}${game.gameId}_${id}`)
      .setLabel((reg?.name || id).slice(0, 80))
      .setStyle(ButtonStyle.Primary);
  });
  // Windows that have no CCs (Special = Zeb die-turn, Zillo = exhaust) omit the
  // Play-CC button (alexanbv 2026-06-26).
  if (!cfg.noCcPlay) {
    btns.push(new ButtonBuilder().setCustomId(`${cfg.pickPrefix}${game.gameId}_playcc`).setLabel('🃏 Play a Command Card').setStyle(ButtonStyle.Success));
  }
  btns.push(new ButtonBuilder().setCustomId(`${cfg.pickPrefix}${game.gameId}_done`).setLabel(cfg.doneLabel || 'Done (no more)').setStyle(ButtonStyle.Secondary));
  await thread.send(sanitizeMentions({
    content: `<@${sideId}> **${cfg.title}** (${side}) — resolve your abilities in any order, then **Done**:`,
    components: chunkButtonsToRows(btns),
    allowedMentions: { users: [sideId] },
  })).catch(discordCatch);
}

/** Mods-step convenience wrapper. */
async function _postModsChooseWindow(side, pending, thread, game, combat) {
  return _postGateChooseWindow('mods', side, pending, thread, game, combat);
}



/**
 * Resume the surge choice UI (or send ready-to-resolve if surges are done).
 * Shared helper used by overflow resolution, Spread the Pain, and power token choice handlers.
 */
export async function resumeSurgeChoiceOrResolve(game, gameId, combat, thread, ctx) {
  if ((combat.surgeRemaining || 0) <= 0) {
    combat.surgeRemaining = 0;
    await sendReadyToResolveRolls(thread, gameId, game, ctx);
    return;
  }
  const surgeAbilities = ctx.getAttackerSurgeAbilities ? ctx.getAttackerSurgeAbilities(combat) : [];
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS?.[id]) || id);
  const remaining = combat.surgeRemaining || 0;
  const atkEff = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  const maxUses = (atkEff?.specialAbilityIds || []).includes('overload_saboteur') ? 2 : 1;
  const kdfX = combat.attackRoll?.surge ?? 0;
  const kdfHas = (atkEff?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
  const surgeRows = [];
  for (let i = 0; i < surgeAbilities.length; i++) {
    const k = surgeAbilities[i];
    const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
    if (cost > remaining) continue;
    if (((combat.surgeSpentCount || {})[i] || 0) >= maxUses) continue;
    let label = (getSurgeLabel(k) || k).slice(0, 80);
    if (kdfHas && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(kdfX));
    const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
    surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_${i}`).setLabel(btnLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary));
  }
  if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
    surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_bleed_prevention`).setLabel('Spend 1 Surge — Prevent Bleed').setStyle(ButtonStyle.Secondary));
  }
  surgeRows.push(...buildRogueOneSurgeButton(game, combat));
  surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
  const surgeRowsRendered = chunkButtonsToRows(surgeRows);
  // @ the attacker so they get a notification when surge spending opens.
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const atkOwnerId = atkPlayerNum === 1 ? game.player1Id : game.player2Id;
  await thread.send({
    content: `<@${atkOwnerId}> — **Spend surge?** You have **${remaining}** surge left. Choose an ability or Done.`,
    components: surgeRowsRendered,
    allowedMentions: { users: [atkOwnerId] },
  }).catch(discordCatch);
}

/**
 * Resolve strain that was deferred while waiting for player's damage-vs-CC choice.
 * Applies HP damage, defeat logic, Submit or Fight, etc. — mirrors the tail of applyStrainToFigure.
 */
async function resolveStrainDamage(game, hpDamage, pending, ctx, thread) {
  const {
    dcHealthState, logGameAction, getDcEffects, client,
    processFigureDefeat: ctxProcessFigureDefeat,
  } = ctx;
  const { playerNum, figureKey, dcName, msgId, figureIndex, abilityLabel } = pending;
  if (hpDamage <= 0) return;
  const { newHp: newCur, prevHp: _strainPrev } = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
    figureKey, msgId, figIndex: figureIndex,
    amount: hpDamage, controllerPlayerNum: playerNum,
    source: abilityLabel || 'Strain',
    viaStrain: true,
  });
  await thread.send(`**${abilityLabel}** — **${dcName}** takes ${hpDamage} HP Strain damage (${_strainPrev} → ${newCur} HP).`).catch(discordCatch);
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** suffered ${hpDamage} Strain as damage.`, { phase: 'ROUND', icon: 'attack' });
  }
  // Submit or Fight (Paz Vizsla) REMOVED 2026-06-20 — now the canonical
  // PAZ_RETURN_FROM_DISCARD strain-prevention option in the applyStrain
  // pipeline (see strain-handler.js). Legacy damage-based trigger dropped.
  if (newCur <= 0) {
    if (ctxProcessFigureDefeat) {
      await ctxProcessFigureDefeat(game, {
        defeatedPlayerNum: playerNum,
        figureKey,
        attackerPlayerNum: opponentPlayerNum(playerNum),
        msgId,
        dcName,
        source: abilityLabel,
      });
    }
  }
}

// ── Strain choice handlers ──────────────────────────────────────────────────

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, updateDcActionsMessage, ACTION_ICONS, ThreadAutoArchiveDuration, resolveCombatAfterRolls, saveGames, client, dcHealthState, findDcMessageIdForFigure, logGameAction, isGroupDefeated, checkWinConditions, updateActivationsMessage
 */
/**
 * Large-target square declaration pick (alexanbv 2026-06-16): the attacker chose
 * which square of a large target to attack. Record target._declaredSquare and
 * re-invoke handleAttackTarget (proxy overrides the customId) so the attack
 * proceeds with the declared square. customId: attack_tgtsq_<msgId>_<figIdx>_<tgtIdx>_<sqIdx>.
 */
export async function handleTargetSquarePick(interaction, ctx) {
  const m = interaction.customId.match(/^attack_tgtsq_(.+)_(\d+)_(\d+)_(\d+)$/);
  if (!m) return;
  const [, msgId, figIdxStr, tgtIdxStr, sqIdxStr] = m;
  const meta = ctx.dcMessageMeta.get(msgId);
  if (!meta) { await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch); return; }
  const game = await requireGame(interaction, ctx.getGame, meta.gameId);
  if (!game) return;
  const targets = game.attackTargets?.[`${msgId}_${parseInt(figIdxStr, 10)}`];
  const target = targets?.[parseInt(tgtIdxStr, 10)];
  if (!target) { await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch); return; }
  // Same LOS-filtered list as the picker so the button index maps to the same square.
  const _atkDg = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _atkFk = `${meta.dcName}-${_atkDg}-${parseInt(figIdxStr, 10)}`;
  const sqs = getDeclarableSquares(game, meta.playerNum, _atkFk, opponentPlayerNum(meta.playerNum), target.figureKey);
  const sq = sqs[parseInt(sqIdxStr, 10)];
  if (sq) target._declaredSquare = sq;
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const proxy = Object.create(interaction);
  proxy.customId = `attack_target_${msgId}_${figIdxStr}_${tgtIdxStr}`;
  await handleAttackTarget(proxy, ctx);
}

export async function handleAttackTarget(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getDcStats,
    getDcEffects,
    updateDcActionsMessage,
    dcHealthState,
    findDcMessageIdForFigure,
    logGameAction,
    isGroupDefeated,
    checkWinConditions,
    updateActivationsMessage,
    updateAttachmentMessageForDc,
    ACTION_ICONS,
    ThreadAutoArchiveDuration,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^attack_target_(.+)_(\d+)_(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr, targetIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const targetIndex = parseInt(targetIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
  const target = targets?.[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = meta.playerNum;
  // Compute attacker's figureKey early so per-figure flags (Fell Swoop,
  // Pounce, Pummel, IR multi-attack, Focus Fire, Multi-Fire) can be
  // read uniformly. Per alexanbv 2026-05-13: the default per-figure
  // scope unless card text says "group" explicitly.
  const _attackerDgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _attackerFkEarly = `${meta.dcName}-${_attackerDgIdx}-${figureIndex}`;
  const { hasLineOfSight, hasLineOfSightByCoord, getFigureSize } = ctx;
  // Compute graph-distance dependencies for countSpaces calls
  const _csMapId = game.selectedMap?.id;
  const _csRawMs = _csMapId ? getMapData(_csMapId) : null;
  const _csAllDoors = (_csMapId && getMapTokensData) ? (getMapTokensData()[_csMapId]?.doors || []) : [];
  const _csOpenedSet = new Set((game.openedDoors || []).map(k => String(k).toLowerCase()));
  const _csClosedDoorEdges = new Set(
    _csAllDoors
      .filter(e => { const a = String(e[0]).toLowerCase(), b = String(e[1]).toLowerCase(); return !_csOpenedSet.has(`${a}|${b}`) && !_csOpenedSet.has(`${b}|${a}`); })
      .map(e => edgeKey(e[0], e[1]))
  );
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the owner can attack.')) return;
  if (target.hasLOS === false && !target.requiresMarksman) {
    await interaction.followUp({ content: '🚫 No line of sight to that target. You cannot attack through blocking terrain or solid walls.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Large-target square declaration (alexanbv 2026-06-16): targeting a large
  // figure requires declaring WHICH square is attacked — it affects LOS and
  // blast/target-square abilities (not range). Post a square-picker and pause;
  // handleTargetSquarePick re-invokes this handler with target._declaredSquare set.
  if (!target._declaredSquare && isLargeTarget(game, target.figureKey)) {
    const _tsqDefPn = opponentPlayerNum(attackerPlayerNum);
    // Only offer squares the attacker has LOS to (the declaration affects LOS).
    const _tsqs = getDeclarableSquares(game, attackerPlayerNum, _attackerFkEarly, _tsqDefPn, target.figureKey);
    if (_tsqs.length > 1) {
      const _tsqBtns = _tsqs.map((sq, i) => new ButtonBuilder()
        .setCustomId(`attack_tgtsq_${msgId}_${figureIndex}_${targetIndex}_${i}`)
        .setLabel(String(sq).toUpperCase()).setStyle(ButtonStyle.Primary));
      await interaction.followUp(sanitizeMentions({
        content: `**${target.dcName || 'Target'}** is a large figure — declare which square you are attacking:`,
        components: chunkButtonsToRows(_tsqBtns),
      })).catch(discordCatch);
      return;
    }
    if (_tsqs.length === 1) target._declaredSquare = _tsqs[0];
  }
  // Marksman auto-play: target requires it (no normal LOS but figures-don't-block
  // LOS exists). Routes through playCcFull so Jammer + counter window apply.
  // skipExecute: the LOS flag is set here only if NOT cancelled.
  if (target.requiresMarksman) {
    if (!(game[ccHandKey(attackerPlayerNum)] || []).includes('Marksman')) {
      await interaction.followUp({ content: '🚫 Marksman is no longer in your hand.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const _mmRes = await playCcFull(game, game.gameId, attackerPlayerNum, _attackerFkEarly, 'Marksman', {
      skipTimingCheck: true,
      skipExecute: true,
      skipLog: true,
      onPostCommit: async () => {
        await logGameAction(game, client, `🎯 **Marksman** played — figures do not block LOS for this Ranged attack.`, { phase: 'ROUND', icon: 'card' });
      },
    }, ctx, interaction.client);
    if (!_mmRes.ok || _mmRes.cancelled) {
      await interaction.followUp({ content: '🚫 **Marksman** was cancelled — cannot proceed without line of sight.', ephemeral: true }).catch(discordCatch);
      return;
    }
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[_attackerFkEarly] = true;
  }
  // Etiquette and Protocol: block attacks between paired figures this round
  const etiqPairs = game.etiquetteBlockPairs || [];
  if (etiqPairs.length && target.figureKey) {
    const dgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const atkFkCheck = `${meta.dcName}-${dgIdx}-${figureIndex}`;
    const tgtFkCheck = target.figureKey;
    const blocked = etiqPairs.some(([a, b]) => (a === atkFkCheck && b === tgtFkCheck) || (b === atkFkCheck && a === tgtFkCheck));
    if (blocked) {
      await interaction.followUp({ content: '🚫 **Etiquette and Protocol**: these two figures cannot attack each other this round.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Still Faster Than You: free attack must target a different hostile than the activating one
  // Per alexanbv 2026-05-13: fellSwoopFreeAttack is figureKey-keyed.
  if (game.fellSwoopFreeAttack?.[_attackerFkEarly] && game.stillFasterExcludeMsgId && target.figureKey && !target.isNpc) {
    const excMeta = dcMessageMeta?.get(game.stillFasterExcludeMsgId);
    if (excMeta && target.figureKey.startsWith(`${excMeta.dcName}-`)) {
      await interaction.followUp({ content: '🚫 **Still Faster Than You** — must target a **different** hostile figure than the one that just activated.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Per alexanbv 2026-05-13: reuse the early-computed figureKey for
  // all per-figure gates below (Focus Fire, Multi-Fire, etc.).
  const _atkFkForGate = _attackerFkEarly;

  // Forced attack target validation (Mandalorian Whip, Focus Fire, etc.) — must target a specific figure.
  // Per alexanbv 2026-05-13: keyed by attacker figureKey so a forced-
  // target lock on figure 0 does not bleed onto figure 1's free choice.
  // Firing Squad lock is per-invocation (across multiple troopers whose
  // figureKey isn't known until each picks); read it as a fallback when
  // no figureKey-keyed lock is set for this attacker.
  let _forcedTargetFk = game.forcedAttackTarget?.[_attackerFkEarly] || null;
  let _forcedTargetFromFiringSquad = false;
  if (!_forcedTargetFk && Array.isArray(game.pendingFiringSquad)) {
    const _fsEntryForGate = game.pendingFiringSquad.find(p => p.forMsgId === msgId);
    if (_fsEntryForGate) {
      _forcedTargetFk = game.firingSquadLockedTarget?.[_fsEntryForGate.triggeredByMsgId] || null;
      _forcedTargetFromFiringSquad = !!_forcedTargetFk;
    }
  }
  if (_forcedTargetFk && target.figureKey) {
    if (target.figureKey !== _forcedTargetFk) {
      const forcedName = dcNameFromFigureKey(_forcedTargetFk);
      const reason = _forcedTargetFromFiringSquad
        ? 'Firing Squad — must target the **same figure** as the first Trooper'
        : (game.focusFireActive?.[_atkFkForGate] ? 'Focus Fire — must target the **same figure**' : 'You must target the specified figure');
      await interaction.followUp({ content: `**${reason}** (**${forcedName.replace(/_/g, ' ')}**).`, ephemeral: true }).catch(discordCatch);
      return;
    }
    // Consume the per-figureKey lock only — Firing Squad lock lives in
    // firingSquadLockedTarget and is cleaned when its queue empties.
    if (!_forcedTargetFromFiringSquad && game.forcedAttackTarget?.[_attackerFkEarly]) {
      delete game.forcedAttackTarget[_attackerFkEarly];
    }
  }
  // Multi-Fire: second attack must target a DIFFERENT figure
  if (game.multiFireBlockedTarget?.[_atkFkForGate] && target.figureKey) {
    if (target.figureKey === game.multiFireBlockedTarget[_atkFkForGate]) {
      await interaction.followUp({ content: '**Multi-Fire** — Second attack must target a **different figure**.', ephemeral: true }).catch(discordCatch);
      return;
    }
    delete game.multiFireBlockedTarget[_atkFkForGate];
  }
  // Brutality / Sarlacc Sweep (differentTargetsRequired): when a multi-attack
  // free-attack chain is active, each attack must target a different figure
  // than any previously-attacked target in the chain. destruct 2026-05-06:
  // "Brutality is one action to perform 2 attacks targeting different figures."
  // freeAttackDifferentTargets[figureKey] tracks figureKeys already
  // attacked. Per alexanbv 2026-05-13: per-figure.
  if (Array.isArray(game.freeAttackDifferentTargets?.[_attackerFkEarly]) && target.figureKey) {
    if (game.freeAttackDifferentTargets[_attackerFkEarly].includes(target.figureKey)) {
      await interaction.followUp({ content: '🚫 **Different target required** — this multi-attack ability requires each attack to target a different figure. Pick another target.', ephemeral: true }).catch(discordCatch);
      return;
    }
    game.freeAttackDifferentTargets[_attackerFkEarly].push(target.figureKey);
  }
  // Droid Arm (Migs Mayfeld): deduct 1 Power Token when attacking a target only visible via Droid Arm
  if (target.droidArmLOS) {
    const _daTokens = game.figurePowerTokens?.[`${meta.dcName}-${(meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1}-${figureIndex}`] || [];
    if (_daTokens.length > 0) {
      _daTokens.splice(0, 1); // remove first token
    }
  }
  // Arcing Shot: validate target is adjacent to an empty space in attacker's LOS
  if (game.arcingShotActive?.[_attackerFkEarly] || game.arcingShotActiveScalar) {
    const _arcValid = target.arcingShotValid;
    if (_arcValid === false) {
      // Warn but allow override (bot may not have perfect LOS/map data)
      await interaction.followUp({
        content: `\u26a0\ufe0f **Arcing Shot** — No empty space adjacent to **${target.label}** was found in attacker's LOS. The target may not be valid for Arcing Shot. Proceeding with attack.`,
        ephemeral: false,
      }).catch(discordCatch);
    }
    // Clear the flag now that an attack target has been selected
    if (game.arcingShotActive?.[_attackerFkEarly]) delete game.arcingShotActive[_attackerFkEarly];
    if (game.arcingShotActiveScalar) delete game.arcingShotActiveScalar;
  }
  // Ballistics Matrix / Marksman: capture the per-attack flag and clear it.
  // Both paths arm by msgId 2026-05-09 (Ballistics Matrix bug fix aligned
  // with Marksman). Snapshot the value into a local — pendingCombat is
  // created downstream (line ~1633) and needs the flag preserved so the
  // post-declare LoS probe in handleCombatRoll keeps the figures-don't-
  // block semantic for THIS attack. Without the snapshot, the probe sees
  // marksmanActive=false and may abort an attack the picker correctly
  // allowed.
  // Per alexanbv 2026-05-13: per-figureKey.
  const _atkIgnoredFigureLOS = !!game.nextAttackIgnoreFigureLOS?.[_attackerFkEarly];
  if (_atkIgnoredFigureLOS) delete game.nextAttackIgnoreFigureLOS[_attackerFkEarly];
  delete game.attackTargets[`${msgId}_${figureIndex}`];
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    const pendingBL = game.pendingBattlefieldLeadership;
    const isBLFreeAttack = pendingBL?.forMsgId === msgId;
    // Per alexanbv 2026-05-13: fellSwoopFreeAttack is figureKey-keyed.
    const isFellSwoopFreeAttack = !!game.fellSwoopFreeAttack?.[_attackerFkEarly];
    const isEmperorFreeAttack = game.pendingEmperorInterrupt?.forMsgId === msgId;
    const isExecOrderFreeAttack = game.pendingExecutiveOrder?.forMsgId === msgId;
    const isBombardmentFreeAttack = game.pendingBombardmentSorin?.forMsgId === msgId;
    const isFiringSquadFreeAttack = (game.pendingFiringSquad || []).some(p => p.forMsgId === msgId);
    const isCoordinatedRaidFreeAttack = game.pendingCoordinatedRaid?.forMsgId === msgId;
    if (isBLFreeAttack) {
      clearPendingBattlefieldLeadership(game);
    } else if (isFellSwoopFreeAttack) {
      delete game.fellSwoopFreeAttack[_attackerFkEarly];
      // Clear SFTY exclude once the free attack fires
      if (game.stillFasterExcludeMsgId) game.stillFasterExcludeMsgId = null;
    } else if (isEmperorFreeAttack) {
      clearPendingEmperorInterrupt(game);
    } else if (isExecOrderFreeAttack) {
      clearPendingExecutiveOrder(game);
    } else if (isBombardmentFreeAttack) {
      clearPendingBombardmentSorin(game);
    } else if (isFiringSquadFreeAttack) {
      // Firing Squad same-target lock (alexanbv 2026-05-11): the first
      // chosen Trooper's target locks the target for any remaining
      // Troopers in the same Firing Squad invocation. Captured on the
      // entry's `triggeredByMsgId` (Kayn's msgId). Per alexanbv 2026-05-13:
      // forcedAttackTarget keyed by attacker figureKey, but Firing Squad
      // locks the target across MULTIPLE troopers whose attacking figureKey
      // isn't known until each trooper picks. So the lock lives entirely
      // in firingSquadLockedTarget[triggeredByMsgId] and the attack-declare
      // gate above already pulls it via the Firing-Squad fallback (see
      // `_fsLockFallbackTarget` block).
      const _fsEntry = (game.pendingFiringSquad || []).find(p => p.forMsgId === msgId);
      if (_fsEntry && target?.figureKey) {
        game.firingSquadLockedTarget = game.firingSquadLockedTarget || {};
        if (!game.firingSquadLockedTarget[_fsEntry.triggeredByMsgId]) {
          game.firingSquadLockedTarget[_fsEntry.triggeredByMsgId] = target.figureKey;
        }
      }
      game.pendingFiringSquad = (game.pendingFiringSquad || []).filter(p => p.forMsgId !== msgId);
      if (game.pendingFiringSquad.length === 0) {
        delete game.pendingFiringSquad;
        // Clean up the per-invocation lock when the queue empties.
        if (_fsEntry && game.firingSquadLockedTarget) {
          delete game.firingSquadLockedTarget[_fsEntry.triggeredByMsgId];
          if (Object.keys(game.firingSquadLockedTarget).length === 0) delete game.firingSquadLockedTarget;
        }
      }
    } else if (isCoordinatedRaidFreeAttack) {
      clearPendingCoordinatedRaid(game);
    } else {
      consumeActionForCurrentFigure(actionsData, 1, game, msgId);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }
  }

  // Squad Upgrade figure (Flame Trooper / Z-6 Trooper / Mortar Trooper) attacks
  // with its OWN dice, surges and innate abilities — NOT the host group's
  // (alexanbv 2026-06-22). When the attacking figure is the SU figure (matched by
  // nickname), resolve its attack stats from the SU card; the SU card name is
  // stamped on the combat (suAttackerCard) so the surge list + innate bonuses
  // also come from it.
  const _atkFigKeyForStats = `${meta.dcName}-${(meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1}-${figureIndex}`;
  const _suAttackerCard = squadUpgradeFigureCard(game, _atkFigKeyForStats);
  const attackerStats = _suAttackerCard ? (getDcStats(_suAttackerCard) || getDcStats(meta.dcName)) : getDcStats(meta.dcName);
  let attackInfo = attackerStats.attack || { dice: ['red'], range: [1, 3] };

  // attackTypeOverride (Overheated → 'melee'): per-FIGURE attack-type
  // swap that survives across attacks until activation cleanup. Per
  // IACP rule 2026-05-09 keyed by the attacker's figureKey so each
  // figure in a multifigure group has its own override.
  const _atkFkForOverride = `${meta.dcName}-${(meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1}-${figureIndex}`;
  const _attackTypeOverride = game.attackTypeOverride?.[_atkFkForOverride];
  if (_attackTypeOverride === 'melee') {
    attackInfo = { ...attackInfo, range: [1, 1], attackType: 'Melee' };
  } else if (_attackTypeOverride === 'ranged') {
    attackInfo = { ...attackInfo, range: [attackInfo.range?.[0] ?? 1, Math.max(attackInfo.range?.[1] ?? 3, 99)], attackType: 'Ranged' };
  }

  // pendingOverrideAttackDice (Saber Strike, Bo-Rifle Staff Strike, Definition: 'Love'): replace dice/type/pierce for this attack.
  // Per alexanbv 2026-05-13: keyed by attacker figureKey.
  const overrideDice = game.pendingOverrideAttackDice?.[_attackerFkEarly];
  const overrideDiceSource = overrideDice?.source; // capture before deletion for Heir to the Jedi check
  if (overrideDice) {
    if (overrideDice.dice) attackInfo = { ...attackInfo, dice: overrideDice.dice };
    if (overrideDice.type === 'melee') attackInfo = { ...attackInfo, range: [1, 1] };
    if (overrideDice.type === 'ranged') attackInfo = { ...attackInfo, attackType: 'Ranged', range: [attackInfo.range?.[0] ?? 1, Math.max(attackInfo.range?.[1] ?? 3, 99)] };
    if (overrideDice.removeDieColor) {
      const newDice = [...(attackInfo.dice || [])];
      const idx = newDice.indexOf(overrideDice.removeDieColor);
      if (idx >= 0) newDice.splice(idx, 1);
      attackInfo = { ...attackInfo, dice: newDice };
    }
    // Lightsaber Throw: must target non-adjacent figure
    if (overrideDice.mustTargetNonAdjacent && target.dist != null && target.dist <= 1) {
      await interaction.followUp({ content: '**Lightsaber Throw** requires targeting a non-adjacent figure. Choose a different target.', ephemeral: true }).catch(discordCatch);
      return;
    }
    // Tusken Cycler: no surge abilities during this attack — stored on pendingCombat
    if (overrideDice.blockSurgeAbilities) {
      game._pendingBlockSurgeAbilities = true;
    }
    delete game.pendingOverrideAttackDice[_attackerFkEarly];
  }
  // Close Quarters: override attack with adjacent hostile's dice/type, +1 Accuracy, -1 defense die
  if (game.closeQuartersActive?.[attackerFigureKey]) {
    // The arm value may be { source: <figureKey> } (player/auto-chosen which
    // adjacent hostile to copy — Verena Talos multi-figure pick) or `true`
    // (legacy: copy the first adjacent hostile). alexanbv 2026-06-21.
    const cqChosenSourceFk = game.closeQuartersActive[attackerFigureKey]?.source || null;
    delete game.closeQuartersActive[attackerFigureKey];
    const cqMapId = game.selectedMap?.id;
    if (cqMapId) {
      const cqActData = game.dcActionsData?.[msgId];
      const cqSelFig = cqActData?.selectedFigure ?? 0;
      const cqDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const cqDgIdx = cqDgMatch ? cqDgMatch[1] : '1';
      const cqAttackerFk = `${meta.dcName}-${cqDgIdx}-${cqSelFig}`;
      const cqAttackerPos = game.figurePositions?.[meta.playerNum]?.[cqAttackerFk];
      if (cqAttackerPos) {
        const cqMapSpaces = getMapData(cqMapId);
        const cqAdjSpaces = new Set(cqMapSpaces?.adjacency?.[cqAttackerPos] || []);
        const cqOppNum = opponentPlayerNum(meta.playerNum);
        const cqOppPositions = game.figurePositions?.[cqOppNum] || {};
        let cqHostileName = null;
        // Prefer the threaded source figure (player's pick) when it is still
        // adjacent; else fall back to the first adjacent hostile.
        if (cqChosenSourceFk && cqOppPositions[cqChosenSourceFk] && cqAdjSpaces.has(cqOppPositions[cqChosenSourceFk])) {
          cqHostileName = dcNameFromFigureKey(cqChosenSourceFk);
        } else {
          for (const [fk, pos] of Object.entries(cqOppPositions)) {
            if (pos && cqAdjSpaces.has(pos)) { cqHostileName = dcNameFromFigureKey(fk); break; }
          }
        }
        if (cqHostileName) {
          const cqHostileStats = getDcStats(cqHostileName);
          const cqAttack = cqHostileStats?.attack;
          if (cqAttack?.dice) {
            attackInfo = { ...attackInfo, dice: cqAttack.dice };
            // Borrow the hostile weapon's attack TYPE/range too. Raw attack data
            // uses .type with values 'melee'/'range' (isRanged is computed as
            // attackInfo.type === 'range' at combat.js:4063/11671), so set both
            // .type and .range to match the borrowed weapon.
            const cqType = cqAttack.type?.toLowerCase();
            if (cqType === 'melee') {
              attackInfo = { ...attackInfo, type: 'melee', attackType: 'Melee', range: [1, 1] };
            } else if (cqType === 'range') {
              attackInfo = { ...attackInfo, type: 'range', attackType: 'Ranged', range: [1, 99] };
            }
            game._closeQuartersBonusAcc = 1;
            game.pendingCombat.defensePoolRemoveMax = (game.pendingCombat.defensePoolRemoveMax || 0) + 1;
            await withDiscordRetry(() => thread.send(`**Close Quarters** — Using **${cqHostileName}**'s attack pool [${cqAttack.dice.join(', ')}], +1 Accuracy, remove 1 defense die (picker will fire at defense roll).`));
          }
        }
      }
    }
  }
  // NPC targets (thugs, Krykna) have synthesized stats — no DC lookup
  let targetDcName, targetStats, targetEff, npcDefenseBonus;
  if (target.isNpc) {
    if (target.npcType === 'crate') {
      // Crate (Devaron B): Health 5, Defense 1 Block (fixed), no die
      targetDcName = 'Crate';
      targetStats = { defense: null, cost: 0, subCost: null, figures: 1 };
      npcDefenseBonus = 1; // 1 fixed block result
      targetEff = {};
    } else {
      targetDcName = target.npcType === 'thug' ? 'Thug' : 'Krykna';
      // Thug: Health 4, Defense 1 black die. Krykna: Health 8, Defense 2 blocks (no dice, +2 bonusBlock).
      targetStats = {
        defense: target.npcType === 'thug' ? 'black' : null,
        cost: 0, // VP awarded separately from NPC HP tracking
        subCost: null,
        figures: 1,
      };
      if (target.npcType === 'krykna') npcDefenseBonus = 2; // 2 fixed block results
      targetEff = {};
    }
  } else {
    // targetDcName stays the host group (identity/logs); but a Squad Upgrade
    // figure's STATS (defense, cost, passives, surges) are its OWN — resolve them
    // from the SU card (alexanbv 2026-06-22).
    targetDcName = dcNameFromFigureKey(target.figureKey);
    const _targetEffName = effectiveDcNameForFigure(game, target.figureKey);
    targetStats = getDcStats(_targetEffName);
    targetEff = getDcEffect(_targetEffName);
  }
  // Reverse Engineer: capture flag before building pendingCombat, then clear it
  const reverseEngineerActive = !!(game.reverseEngineerActive?.[attackerPlayerNum]);
  if (reverseEngineerActive) delete game.reverseEngineerActive[attackerPlayerNum];
  const attackerDisplayName = meta.displayName || meta.dcName;
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const attackerFigureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const attackerConds = game.figureConditions?.[attackerFigureKey] || [];
  const defenderConds = game.figureConditions?.[target.figureKey] || [];
  // Slice 8.4 follow-up: capture per-side condition-effects-suppression flags
  // at combat init so computeCombatResult can skip Weaken/Stun/etc. modifiers
  // when the figure's effects are inert (YWNDM-on-Fifth-Brother).
  const _attackerCondEffectsSuppressed = areConditionEffectsSuppressed(game, attackerFigureKey);
  const _defenderCondEffectsSuppressed = areConditionEffectsSuppressed(game, target.figureKey);
  // Focus: attacker gains 1 green die on their next attack; consumed after attacking
  if (attackerConds.includes('Focus')) {
    attackInfo = { ...attackInfo, dice: [...(attackInfo.dice || []), 'green'] };
  }
  const _atkEff = getDcEffects()?.[meta.dcName];
  // Mystic Hunter (Zuckuss) + Full of Rage (Krrsantan) — MOVED to the on_declare
  // window (combat-abilities-ondeclare.js passives → _fireOnDeclarePassive) per
  // alexanbv 2026-06-16.
  // Fly-By (Jet Trooper Elite) — MOVED to the on_declare window
  // (combat-abilities-ondeclare.js 'fly_by' passive → _fireOnDeclarePassive).
  // Utinni! (roundUtinniJawaBuffs): Jawa Scavenger gets +1 Accuracy and a VP-earning surge ability
  // Per-figure 2026-05-09 (multifigure-independent-activation rule).
  if (game.roundUtinniJawaBuffs && meta.dcName?.toLowerCase().includes('jawa scavenger')) {
    game.nextAttackBonusAccuracy = game.nextAttackBonusAccuracy || {};
    game.nextAttackBonusAccuracy[attackerFigureKey] = (game.nextAttackBonusAccuracy[attackerFigureKey] || 0) + 1;
    game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
    game.nextAttackBonusSurgeAbilities[attackerFigureKey] = game.nextAttackBonusSurgeAbilities[attackerFigureKey] || [];
    game.nextAttackBonusSurgeAbilities[attackerFigureKey].push('utinni_vp_1');
  }
  // Merciless (HK Assassin Droid Elite): "When you declare an attack,
  // if the defender has any HARMFUL conditions, it suffers 1 Damage."
  // Per alexanbv 2026-05-13: this is an on-declare ability and the
  // attacker controls when it fires (other on-declare effects may
  // add HARMFUL conditions first). Register eligibility for the
  // on-declare ability bucket; the actual damage application fires
  // when the attacker clicks "Use Merciless" via handleMercilessUse.
  // The click re-checks the HARMFUL condition at click time so the
  // ability respects mid-window condition changes.
  if ((_atkEff?.passives || []).includes('Merciless')) {
    const _merDefConds = game.figureConditions?.[target.figureKey] || [];
    const _merHarmful = ['Bleed', 'Stun', 'Weaken'].some(c => _merDefConds.includes(c));
    if (_merHarmful) {
      const _merDefPn2 = opponentPlayerNum(attackerPlayerNum);
      const _merTargetMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, _merDefPn2, target.figureKey) : null;
      if (_merTargetMsgId) {
        // Eligibility recorded for the on-declare bucket; the actual
        // damage fires on user click (handleMercilessUse).
        game.pendingCombat.mercilessAvailable = {
          targetFigureKey: target.figureKey,
          targetMsgId: _merTargetMsgId,
          attackerPlayerNum,
          defenderPlayerNum: _merDefPn2,
          targetLabel: target.label,
        };
      }
    }
  }
  // Aim (Rebel Trooper Regular AND Elite): "If you have not exited your
  // space during this activation, apply +1 Damage and +2 Accuracy to
  // your attack results."
  //
  // Per alexanbv 2026-05-13: BOTH Regular and Elite use the same Aim
  // mechanic — per-FIGURE activation, checked against the attacker's
  // own movement history (game.figureMoved[attackerFigureKey]).
  //
  // NOTE: The Elite card art as printed reads "during your group's
  // activation" but alexanbv has confirmed this is INCORRECT card text;
  // the actual ruling is the same per-figure scope as Regular. Treat
  // both variants identically until the printed card is errata-corrected.
  // Aim is carried as a specialAbilityId (aim_rebel_trooper_elite / _reg), not a
  // passive keyword. BOTH variants share the identical per-FIGURE mechanic: the
  // bonus applies only if THIS attacking figure has not exited its space during
  // its own activation (game.figureMoved[attackerFigureKey]).
  let _aimFired = false;
  if (hasAimAbility(_atkEff?.specialAbilityIds) && aimBonusApplies(attackerFigureKey, game.figureMoved)) {
    _aimFired = true;
  }
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const attackerUserName = getPlayerDisplayName(game, attackerPlayerNum, client);
  const defenderUserName = getPlayerDisplayName(game, defenderPlayerNum, client);
  const combatDeclare = `**${attackerUserName}**'s **${attackerDisplayName}** is attacking **${defenderUserName}**'s **${target.label}**!`;

  const generalChannel = await fetchGameChannel(client, game.generalId);
  const declareMsg = await generalChannel.send({
    content: `${ACTION_ICONS.attack || '⚔️'} <t:${Math.floor(Date.now() / 1000)}:t> — ${combatDeclare}`,
    allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) },
  });
  // Discord thread name limit is 100 chars; truncate components conservatively.
  const _threadAtk = `${attackerUserName}: ${attackerDisplayName}`.slice(0, 45);
  const _threadDef = `${defenderUserName}: ${target.label}`.slice(0, 45);
  const thread = await declareMsg.startThread({
    name: `Combat — ${_threadAtk} → ${_threadDef}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
  });
  const preCombatMsg = await withDiscordRetry(() => thread.send({
    content: `<@${game.player1Id}> <@${game.player2Id}> — **Combat opened.** Each side: on-declare CCs / abilities / power tokens (combined window), then click Ready. Dice auto-roll once both sides are ready.`,
    allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) },
  }));
  if (target.droidArmLOS) await thread.send(`**Droid Arm** — LOS drawn from adjacent space (1 Power Token discarded).`).catch(discordCatch);
  if (_aimFired) await thread.send(`🎯 **Aim** — You have not exited your space this activation: +1 Damage, +2 Accuracy.`).catch(discordCatch);
  // Per-figure 2026-05-09: next-attack bonuses keyed by attackerFigureKey
  // (multifigure-independent-activation rule).
  const nextSurge = [
    ...(game.nextAttackBonusSurgeAbilities?.[attackerFigureKey] || []),
    // Close and Personal / Lightbow: replacement surge abilities granted by the
    // override (paired with blockSurgeAbilities, which suppresses native surges).
    ...(Array.isArray(overrideDice?.bonusSurgeAbilities) ? overrideDice.bonusSurgeAbilities : []),
  ];
  // Expose Weakness: target-keyed pierce — "the next attack TARGETING that figure
  // gains Pierce 3". Keyed by the DEFENDER's figureKey (not the attacker), so it
  // applies only when the chosen hostile is the one being attacked. alexanbv 2026-06-20.
  const _defKeyForPierce = target?.figureKey || null;
  const nextPierce = (game.nextAttackBonusPierce?.[attackerFigureKey] || 0)
    + (_defKeyForPierce ? (game.nextAttackPierceVsDefender?.[_defKeyForPierce] || 0) : 0)
    + (overrideDice?.pierce || 0);
  const nextBonusAcc = (game.nextAttackBonusAccuracy?.[attackerFigureKey] || 0) + (overrideDice?.bonusAccuracy || 0) + (game._closeQuartersBonusAcc || 0);
  const isRanged = attackInfo.type === 'range';
  const distanceToTarget = target.dist ?? 1;
  // Slice 7.2 (destruct 2026-05-05, nested attack frames): if there's an
  // outer attack already in progress (Parting Shot, Final Stand, Extra
  // Protection, Counterattack, Electrobatons Flurry interrupts), preserve
  // its state on game.combatStack before this nested attack overwrites
  // game.pendingCombat. The pop happens at combat resolution (slice 7.3).
  if (game.pendingCombat) {
    pushNestedCombat(game);
  }
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum,
    defenderPlayerNum: opponentPlayerNum(attackerPlayerNum),
    attackerMsgId: msgId,
    attackerDcName: meta.dcName,
    // The Squad Upgrade figure attacks with the SU card's own dice/surges/innate.
    // Kept alongside attackerDcName (which stays the host for identity/logs).
    suAttackerCard: _suAttackerCard || undefined,
    defenderDcName: targetDcName,
    // Snapshot Marksman/Ballistics Matrix "figures don't block" semantic
    // for this attack — read by handleCombatRoll's post-declare LoS probe.
    attackIgnoredFigureLOS: _atkIgnoredFigureLOS || undefined,
    reverseEngineerActive: reverseEngineerActive || undefined,
    bonusSurgeAbilities: [...nextSurge],
    bonusPierce: nextPierce,
    bonusAccuracy: nextBonusAcc || undefined,
    attackerDisplayName,
    attackerFigureIndex: figureIndex,
    attackerFigureKey,
    attackerConds,
    defenderConds,
    target: { ...target },
    // Declared square for a large target (alexanbv 2026-06-16) — the square the
    // attack is aimed at; feeds blast/target-square abilities. 1x1 targets use
    // their own coord.
    targetSquare: target._declaredSquare || game.figurePositions?.[opponentPlayerNum(attackerPlayerNum)]?.[target.figureKey] || null,
    targetStats: {
      defense: target.isNpc
        ? (targetStats.defense || null)
        : (Array.isArray(targetStats.defense) ? targetStats.defense : (targetStats.defense ? [targetStats.defense] : ['white'])),
      cost: target.isNpc ? 2 : (targetStats.cost ?? 5), // NPC kill = 2 VP
      subCost: target.isNpc ? null : targetEff?.subCost,
      figures: 1,
    },
    bonusBlock: npcDefenseBonus || undefined, // Krykna: 2 fixed blocks
    blockSurgeAbilities: game._pendingBlockSurgeAbilities || false, // Tusken Cycler
    // defensePoolRemoveMax now incremented directly when CQ / Element of
    // Surprise / Wild Fire apply (alexanbv 2026-05-11). Generic picker
    // at defense-roll time consumes _defPickRemoveIdxList.
    defensePoolRemoveMax: 0,
    attackInfo,
    isRanged,
    distanceToTarget,
    combatThreadId: thread.id,
    combatDeclareMsgId: declareMsg.id,
    combatPreMsgId: preCombatMsg.id,
    // Session 11 retirement: legacy p1Ready/p2Ready replaced by per-step
    // `acked` map. currentStep is the authoritative gate; the acked map
    // tracks per-player confirmation within the current sub-window and
    // resets whenever currentStep advances.
    currentStep: 'step1+2-attacker',
    acked: {},
    // Slice 8.4 follow-up: per-side condition-effect-suppression flags
    // (YWNDM-on-Fifth-Brother). Used by computeCombatResult to skip Weaken
    // penalties when the figure's condition effects are inert.
    attackerCondEffectsSuppressed: _attackerCondEffectsSuppressed,
    defenderCondEffectsSuppressed: _defenderCondEffectsSuppressed,
    attackRoll: null,
    defenseRoll: null,
    attackTargetMsgId: interaction.message.id,
    darksaberBlastToCleave: overrideDice?.darksaberBlastToCleave || false,
  };
  // Aim (Rebel Trooper Elite/Regular): apply +1 Damage +2 Accuracy to pendingCombat.
  if (_aimFired) {
    const _aimed = applyAimBonus({ bonusHits: game.pendingCombat.bonusHits, bonusAccuracy: game.pendingCombat.bonusAccuracy });
    game.pendingCombat.bonusHits = _aimed.bonusHits;
    game.pendingCombat.bonusAccuracy = _aimed.bonusAccuracy;
  }
  // Surge-granting auras (Gar Saxon, General Sorin, …): a friendly owner figure
  // within range grants its surge abilities to qualifying friendlies — so an
  // attacker standing in the aura sees those surges in the spend_surges step.
  // Owner-centric / footprint-aware eligibility via the condition engine; granted
  // surges are data-driven (the owner's surgeAbilities). alexanbv 2026-06-16.
  game.pendingCombat.bonusSurgeAbilities.push(..._auraGrantedSurges(game, game.pendingCombat));
  // Scrap Battalion (Ugnaught Tinkerer): the Junk Droid "may use YOUR surge
  // abilities." When the Junk Droid attacks, borrow the host Ugnaught's surge
  // abilities (Bleed, Pierce N) so they appear in the spend_surges step.
  game.pendingCombat.bonusSurgeAbilities.push(..._scrapBattalionGrantedSurges(game, attackerPlayerNum, meta.dcName));
  // CC Passive Redraw (per CRR card text 2026-05-09): K&D / Targeting
  // Network grant the relevant figure (FORCE USER / DROID) a NEW
  // surge ability "Re-draw this card" while the card is in discard.
  // Player chooses whether to spend a surge on it among their other
  // surge options (instead of auto-firing on any surge spend).
  {
    const _redrawDiscardKey = ccDiscardKey(attackerPlayerNum);
    const _redrawDiscard = game[_redrawDiscardKey] || [];
    const _redrawAtkEff = getDcEffect(meta.dcName);
    const _redrawAtkKws = (_redrawAtkEff?.keywords || []).map(k => String(k).toUpperCase());
    if (_redrawDiscard.includes('Knowledge and Defense') && _redrawAtkKws.includes('FORCE USER')) {
      game.pendingCombat.bonusSurgeAbilities.push('kd_redraw');
    }
    if (_redrawDiscard.includes('Targeting Network') && _redrawAtkKws.includes('DROID')) {
      game.pendingCombat.bonusSurgeAbilities.push('tn_redraw');
    }
  }
  // Imperial Loadout (Purge Trooper Elite): inject loadout surge abilities + store post-attack hook
  const _loadoutChoice = getConfig(game, attackerFigureKey)?.loadout;
  if (_loadoutChoice) {
    const _loadoutCard = getLoadoutCards()[_loadoutChoice];
    if (_loadoutCard?.surgeKeys) game.pendingCombat.bonusSurgeAbilities.push(..._loadoutCard.surgeKeys);
    if (_loadoutCard?.postAttack) game.pendingCombat.loadoutPostAttack = _loadoutCard.postAttack;
  }
  // Clawdite Form: inject form surge abilities, passives, and Rifleman dice replacement
  const _formChoice = getConfig(game, attackerFigureKey)?.form;
  if (_formChoice) {
    const _formCard = getFormCards()[_formChoice];
    if (_formCard?.surgeKeys) game.pendingCombat.bonusSurgeAbilities.push(..._formCard.surgeKeys);
    if (_formCard?.combatPassives) game.pendingCombat.formCombatPassives = _formCard.combatPassives;
    // Streetrat Assassin's Blade post-attack hook
    if (_formChoice === 'Streetrat') game.pendingCombat.formPostAttack = 'assassins_blade';
    // Scout Rifleman: replace 1 non-red die with 1 blue die
    if (_formChoice === 'Scout') {
      const dice = [...(game.pendingCombat.attackInfo.dice || [])];
      const replaceOrder = ['yellow', 'green']; // prefer replacing weaker dice
      let replaced = false;
      for (const color of replaceOrder) {
        const idx = dice.indexOf(color);
        if (idx !== -1) { dice[idx] = 'blue'; replaced = true; break; }
      }
      if (replaced) {
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice };
        await thread.send(`🎯 **Rifleman** — Replaced 1 attack die with 1 blue die.`).catch(discordCatch);
      }
    }
  }
  // Covering Fire: round-scoped TROOPER Surge: Stun (if already Stunned, +2 Damage instead)
  if (game.roundTrooperSurgeStun?.[attackerPlayerNum]) {
    const _cfKws = (_atkEff?.keywords || []).map(k => String(k).toUpperCase());
    if (_cfKws.includes('TROOPER')) {
      // Check if target is already Stunned — if so, grant +2 Damage surge instead of Stun
      const _defConds = game.figureConditions?.[target.figureKey] || [];
      if (_defConds.includes('Stun')) {
        game.pendingCombat.bonusSurgeAbilities.push('damage 2');
        await thread.send('🔫 **Covering Fire** — Target already Stunned: Surge: +2 Damage added.').catch(discordCatch);
      } else {
        game.pendingCombat.bonusSurgeAbilities.push('stun');
        await thread.send('🔫 **Covering Fire** — Surge: Stun added to attack pool.').catch(discordCatch);
      }
    }
  }
  // Clean up temp flags after transferring to combat object
  if (game._pendingBlockSurgeAbilities) delete game._pendingBlockSurgeAbilities;
  if (game._closeQuartersBonusAcc) delete game._closeQuartersBonusAcc;
  // Apply printed passive stat bonuses from attacker only (NPC has no passives)
  // Merge form passives (e.g. "+2 Accuracy") and form combat passives (e.g. "Professional") with DC passives
  // SU-aware: attackerStats / targetStats were resolved from the SU card when the
  // figure is a Squad Upgrade figure, so its OWN passives apply (not the host's).
  const attackerPassives = [...(attackerStats.passives || [])];
  if (_formChoice) {
    const _fCard = getFormCards()[_formChoice];
    if (_fCard?.passives) attackerPassives.push(..._fCard.passives);
    if (_fCard?.combatPassives) attackerPassives.push(..._fCard.combatPassives);
  }
  const defenderPassives = target.isNpc ? [] : (targetStats.passives || []);
  applyDcPassivesToCombat(game.pendingCombat, attackerPassives, defenderPassives, {
    attackerDcName: meta.dcName,
    defenderDcName: target.isNpc ? '' : targetDcName,
  });

  // Blood Feud: persistent +1 Damage when attacking a DC marked with Blood Feud
  if (game.bloodFeudTargets?.[target.msgId] === attackerPlayerNum) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    game.pendingCombat.bloodFeudApplied = true;
  }

  // Forward Mounted Blasters (74-Z Speeder Bike): updated per destruct
  // 2026-05-08. Card text: "While attacking, if the target space
  // occupies the same row as both of your spaces, you may reroll one
  // attack die. Otherwise, apply −1 Damage to the attack results."
  // "Row" here means a row OR column — i.e. the speeder's two cells +
  // target are colinear (inline) on either axis. The speeder's two
  // cells are always edge-adjacent, so they're always inline on one
  // axis; the test reduces to: target row matches both speeder rows
  // (horizontal alignment) OR target column matches both speeder
  // columns (vertical alignment).
  if ((attackerStats.passives || []).includes('Forward Mounted Blasters')) {
    const _fmbSize = game.figureOrientations?.[attackerFigureKey] || getFigureSize(meta.dcName);
    const _fmbPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    const _fmbTargetPos = game.figurePositions?.[opponentPlayerNum(attackerPlayerNum)]?.[target.figureKey];
    if (_fmbPos && _fmbTargetPos) {
      const _fmbCells = getFootprintCells(_fmbPos, _fmbSize);
      const _fmbTarget = parseCoord(_fmbTargetPos);
      const _fmbSameRow = _fmbCells.every((c) => parseCoord(c).row === _fmbTarget.row);
      const _fmbSameCol = _fmbCells.every((c) => parseCoord(c).col === _fmbTarget.col);
      const _fmbInline = _fmbSameRow || _fmbSameCol;
      if (_fmbInline) {
        // Inline → +1 attacker reroll (player chooses which die in the
        // reroll window). alexanbv 2026-05-13: register as named
        // forced-queue entry — surfaces as a "Use Forward Mounted
        // Blasters" bucket button.
        game.pendingCombat.forcedRerollQueue = game.pendingCombat.forcedRerollQueue || [];
        game.pendingCombat.forcedRerollQueue.push({
          controlPlayer: attackerPlayerNum,
          pool: 'attack',
          remaining: 1,
          source: 'Forward Mounted Blasters',
        });
        await thread.send('🎯 **Forward Mounted Blasters** — Target inline with speeder: may reroll 1 attack die.').catch(discordCatch);
      } else {
        // Not inline → −1 Damage (bonusHits is the same modifier slot
        // used for ±Damage adjustments to the attack results).
        game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
        await thread.send('🎯 **Forward Mounted Blasters** — Target NOT inline with speeder: −1 Damage to attack results.').catch(discordCatch);
      }
    }
  }
  // --- Skirmish Upgrade attachment combat effects ---
  const _atkUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  const _defMsgId = target.isNpc ? null : (findDcMessageIdForFigure?.(game.gameId, game.pendingCombat.defenderPlayerNum, target.figureKey) || null);
  const _defUpgrades = _defMsgId ? (game.p1DcAttachments?.[_defMsgId] || game.p2DcAttachments?.[_defMsgId] || []) : [];
  if (_atkUpgrades.length || _defUpgrades.length) {
    const _pc = game.pendingCombat;
    // Targeting Computer (attachment) — reroll MOVED to the gate rerolls window
    // (CSV [Targeting Computer] row, attachment-presence). Dead count removed.

    // Driven by Hatred (Darth Vader): +1 Damage. The reroll is offered by the gate
    // ([Driven by Hatred] attachment reroll row); the old eager rerollOneAttackDie
    // count is dead (its consumer is in the retired legacy block). Brutality loss
    // is handled separately.
    // Driven by Hatred (+1 Damage) and Wookiee Avenger (+1 Damage) are now gate mods
    // passives (combat-abilities-attachment-auto.js → _fireModsPassive), fired in
    // the modifiers window instead of eagerly here. alexanbv 2026-06-17.
    // Heir to the Jedi (Luke): +1 Damage on Ranged is now a gate mods passive
    // (heir_to_the_jedi_hit). Saber Strike pre-attack Focus is still handled
    // below (a declaration-time die effect, not a modifier). alexanbv 2026-06-17.
    // Rogue Smuggler (Han Solo) — reroll MOVED to the gate rerolls window
    // (CSV [Rogue Smuggler] row). Distracting-loss is handled separately below.
    // Cross Training: defend-only ability (no attack effect)
    // Guidance Systems (Mortar Trooper): optional -1 Damage, +2 Accuracy per use (multiple times per attack)
    if (cardNameIncludes(_atkUpgrades, 'Mortar Trooper')) {
      _pc.guidanceSystemsAvailable = true;
    }
    // Prey on the Weak (HUNTER): Pierce 1 + Accuracy 1 vs lower-cost figure is
    // now a gate mods passive (prey_on_the_weak, cost comparison in its applies).
    // Explosive Armaments Surge (+1 Damage, Blast 1) and Feeding Frenzy Surge
    // (Recover 2 while adjacent) are now gate mods passives
    // (combat-abilities-attachment-auto.js → _fireModsPassive). alexanbv 2026-06-17.
    // Focused on the Kill (IG-88): lose Surge: Recover 3, gain Surge: Pierce 1; pre-attack Focus
    if (cardNameIncludes(_atkUpgrades, 'Focused on the Kill')) {
      _pc.removeSurgeKeys = (_pc.removeSurgeKeys || []).concat(['recover 3']);
      _pc.bonusSurgeAbilities.push('pierce 1');
      // Pre-attack Focus: apply Focus if not already Focused
      if (!attackerConds.includes('Focus')) {
        const _fotkResult = applyConditionWithDie(game, attackerFigureKey, 'Focus', _pc.attackInfo, 'green');
        if (_fotkResult.applied) {
          _pc.attackInfo = _fotkResult.attackInfo;
          await thread.send('**Focused on the Kill** — IG-88 becomes Focused before attacking.').catch(discordCatch);
        }
      }
    }
    // Heir to the Jedi: Saber Strike pre-attack Focus (when using Saber Strike override)
    if (cardNameIncludes(_atkUpgrades, 'Heir to the Jedi') && overrideDiceSource === 'saber_strike') {
      if (!attackerConds.includes('Focus')) {
        const _httjResult = applyConditionWithDie(game, attackerFigureKey, 'Focus', _pc.attackInfo, 'green');
        if (_httjResult.applied) {
          _pc.attackInfo = _httjResult.attackInfo;
          await thread.send('**Heir to the Jedi** — Luke becomes Focused before Saber Strike.').catch(discordCatch);
        }
      }
    }
    // --- Defender attachments ---
    // Combat Suit: reduce Pierce by 1 — now a gate mods passive
    // (combat-abilities-attachment-auto.js → _fireModsPassive). alexanbv 2026-06-17.
    // Wookiee Avenger (defending): convert Dodge → Evade — now a gate defender
    // mods passive (wookiee_avenger_defend → _fireModsPassive). alexanbv 2026-06-17.
    // Cross Training (defending): exhaust to reroll 1 defense die with color swap (flagged for reroll window)
    if (cardNameIncludes(_defUpgrades, 'Cross Training')) {
      const _ctExh = game.exhaustedSkirmishUpgrades?.[_defMsgId] || [];
      if (!cardNameIncludes(_ctExh, 'Cross Training')) {
        _pc.crossTrainingAvailable = true;
        _pc.crossTrainingDefMsgId = _defMsgId;
      }
    }
    // Rogue Smuggler (defender): lose Distracting — now a gate defender mods
    // passive (rogue_smuggler_distracting → _fireModsPassive). alexanbv 2026-06-17.
    // --- Exhaust-based attacker attachments ---
    // Scavenged Weaponry (+1 Damage, on_declare), Explosive Armaments (Blast 1,
    // mods), Feeding Frenzy (+1 Damage vs a damaged target, mods) are now OFFERED in
    // their gate windows as interactive exhaust-on-use buttons (combat-abilities-
    // exhaust.js) — applied only when the player chooses them, exhausting the
    // card on use. The eager auto-apply here was removed to kill the double
    // handling (it fired the effect + exhausted at declaration while the gate
    // also offered a no-op button). alexanbv 2026-06-17. The Darksaber reroll is
    // likewise gate-handled (attack:rerolls row, params.exhaustOnUse).
    // Zillo Technique (I51-I52) defender's team SU: both effects moved out of
    // declare-time per CRR step-4 modifier timing + Destruct.
    //   - Exhaust to cancel 2 Pierce: post-surge prompt (slice 3,
    //     maybePromptZilloPierceCancel inside sendReadyToResolveRolls).
    //   - Discard 1 CC for +1 Block: step-4 defender-modifier prompt
    //     (slice 6, maybePromptZilloDiscardForBlock inside proceedAfterRerolls'
    //     DEF block).
  }
  // Z-6 Trooper Rotary Cannon: before attacking, become Focused — FIGURE-SCOPED:
  // only when the Z-6 Squad Upgrade FIGURE itself is the attacker, not any
  // group-mate. alexanbv 2026-06-17.
  if (cardNameIncludes(_atkUpgrades, 'Z-6 Trooper') && squadUpgradeFigureCard(game, attackerFigureKey) === 'Z-6 Trooper') {
    if (!attackerConds.includes('Focus')) {
      const _z6Result = applyConditionWithDie(game, attackerFigureKey, 'Focus', game.pendingCombat.attackInfo, 'green');
      if (_z6Result.applied) {
        game.pendingCombat.attackInfo = _z6Result.attackInfo;
        await thread.send('**Rotary Cannon** — Z-6 Trooper becomes Focused before attacking.').catch(discordCatch);
      }
    }
  }
  // The General's Ranks: +1 Damage on a non-activation attack — now a gate mods
  // passive (combat-abilities-mods.js 'the_generals_ranks' → _fireModsPassive),
  // fired in the modifiers window. The eager declaration-time detection was
  // deleted to kill the double handling. alexanbv 2026-06-18.
  // Scavenged Walker: -1 Damage penalty on end-of-round interrupt attack
  if (game.scavengedWalkerAttackPenalty?.[msgId]) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
    delete game.scavengedWalkerAttackPenalty[msgId];
    await thread.send('**Scavenged Walker** — -1 Damage applied to this interrupt attack.').catch(discordCatch);
  }
  // Driven by Hatred: remove 1 die from attack pool on end-of-round attack.
  // Per destruct 2026-05-06: any ability with multiple legal options must
  // prompt the player — never auto-decided. Vader's controller picks
  // which die to remove. Gate: handleCombatRoll refuses if pendingDbhDiePick
  // is still set when the roll button is clicked.
  if (game.drivenByHatredAttackPenalty?.[msgId]) {
    const _dbhDice = [...(game.pendingCombat.attackInfo.dice || [])];
    if (_dbhDice.length > 0) {
      // Build one button per UNIQUE die color, with a count suffix when
      // there are duplicates (e.g. two reds → both buttons drop the same
      // color but the player still gets a single click).
      const _dbhCounts = _dbhDice.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
      const _dbhUnique = Object.keys(_dbhCounts);
      const _dbhBtns = _dbhUnique.map((color) => {
        const count = _dbhCounts[color];
        const label = count > 1 ? `${color} (×${count})` : color;
        return new ButtonBuilder()
          .setCustomId(`dbh_pick_die_${game.gameId}_${color}`)
          .setLabel(label.charAt(0).toUpperCase() + label.slice(1))
          .setStyle(ButtonStyle.Primary);
      });
      game.pendingDbhDiePick = { msgId, attackerPlayerNum: game.pendingCombat.attackerPlayerNum, dice: _dbhDice };
      const _dbhAtkOwnerId = game[`player${game.pendingCombat.attackerPlayerNum}Id`];
      await thread.send({
        content: `<@${_dbhAtkOwnerId}> **Driven by Hatred** — choose 1 die to remove from your attack pool. (You cannot roll until you pick.)`,
        components: [new ActionRowBuilder().addComponents(_dbhBtns)],
        allowedMentions: { users: [_dbhAtkOwnerId] },
      }).catch(discordCatch);
      delete game.drivenByHatredAttackPenalty[msgId];
    }
  }
  // Flame Trooper Fireproof: only the Flame Trooper FIGURE itself is immune to
  // Strain/Bleed — mark the flag only when the attacking/defending figure IS the
  // Flame Trooper Squad Upgrade figure, not any group-mate. alexanbv 2026-06-17.
  if (squadUpgradeFigureCard(game, attackerFigureKey) === 'Flame Trooper') {
    game.pendingCombat.attackerFireproof = true;
  }
  if (squadUpgradeFigureCard(game, game.pendingCombat.target?.figureKey) === 'Flame Trooper') {
    game.pendingCombat.defenderFireproof = true;
  }
  // Autofire: add chain attack surge ability + mark on combat
  if (game.autofireActive?.[attackerFigureKey]) {
    game.pendingCombat.bonusSurgeAbilities.push('autofire_chain');
    game.pendingCombat.autofireAttack = true;
    delete game.autofireActive[attackerFigureKey]; // consumed
  }
  // Barrage (CT-1701) second attack: mark on combat so defender adds 1
  // white die. Per-figureKey 2026-05-13 (alexanbv).
  if (game.barrageDefenseBonus?.[attackerFigureKey]) {
    game.pendingCombat.barrageAttack = true;
    delete game.barrageDefenseBonus[attackerFigureKey]; // consumed
  }
  // Fire Mission: +Blast 1
  if (game.fireMissionActive?.[attackerFigureKey]) {
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + 1;
    game.pendingCombat.fireMissionAttack = true;
    delete game.fireMissionActive[attackerFigureKey]; // consumed
    await thread.send('**Fire Mission** — +Blast 1 applied to this attack.').catch(discordCatch);
  }
  // Sniper Configuration: LOS-from-any-friendly is a one-attack effect — consume
  // the flag once this attack is declared so it does not bleed into later attacks.
  if (game.sniperConfigLosAnyFriendly?.[attackerFigureKey]) {
    delete game.sniperConfigLosAnyFriendly[attackerFigureKey];
  }

  // Spectre Cell (attacker) — MOVED to the mods window
  // (combat-abilities-mods.js 'spectre_cell_atk' passive).

  // Unhinged Director (Krennic): TROOPER/GUARDIAN within 2 (3 with ACS) get +2 from power tokens instead of +1.
  // We compute the FULL set of eligible spender figure keys on the attacker's
  // side (not just the attacker), so Squad Cohesion + Wild-cohesion spends
  // from a friendly nearby figure can also fire the +1/+2 prompt.
  {
    const _udEligibleFigureKeys = (pn) => {
      const out = new Set();
      const dcList = getDcList(game, pn) || [];
      const dcMsgIds = getDcMessageIds(game, pn) || [];
      // Find every Krennic on this side and its range (ACS = 3, else 2).
      const krennicSources = [];
      for (let i = 0; i < dcList.length; i++) {
        const dc = dcList[i];
        const dn = dc?.dcName || dc;
        const eff = getDcEffectsGlobal()[dn];
        if (!(eff?.specialAbilityIds || []).includes('unhinged_director_krennic')) continue;
        const dgIdx = (dc?.displayName || dn).match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
        const kFk = `${dn}-${dgIdx}-0`;
        const kPos = game.figurePositions?.[pn]?.[kFk];
        if (!kPos) continue;
        const kMsgId = dcMsgIds[i];
        const kAtts = kMsgId ? (game.p1DcAttachments?.[kMsgId] || game.p2DcAttachments?.[kMsgId] || []) : [];
        const hasACS = cardNameIncludes(kAtts, 'Advanced Com Systems');
        krennicSources.push({ pos: kPos, maxRange: hasACS ? 3 : 2 });
      }
      if (krennicSources.length === 0) return out;
      // Walk every friendly figure on this side; include if TROOPER/GUARDIAN
      // and within range of any Krennic source.
      const kwMap = getDcKeywordsGlobal(game);
      const positions = game.figurePositions?.[pn] || {};
      for (const figKey of Object.keys(positions)) {
        const figPos = positions[figKey];
        if (!figPos) continue;
        const figDcName = dcNameFromFigureKey(figKey);
        const figKws = (kwMap[figDcName] || []).map(k => String(k).toUpperCase());
        if (!figKws.includes('TROOPER') && !figKws.includes('GUARDIAN')) continue;
        for (const k of krennicSources) {
          if (countSpaces(_csRawMs, k.pos, figPos, _csClosedDoorEdges, 50, game) <= k.maxRange) {
            out.add(figKey);
            break;
          }
        }
      }
      return out;
    };
    const eligibleSet = _udEligibleFigureKeys(attackerPlayerNum);
    game.pendingCombat.unhingedEligibleSpenders = Array.from(eligibleSet);
    if (eligibleSet.has(attackerFigureKey)) {
      game.pendingCombat.attackerUnhingedBonus = true;
    }
    // Defender-side check intentionally absent — the card text reads
    // "while declaring an attack," so only the attacker side can trigger
    // it. Defender never spends Hit/Surge tokens during an attack.
  }

  // Fury of Kashyyyk (elite WOOKIEE → Pierce 1) is applied by the gate mods
  // passive 'fury_kashyyyk_pierce' (combat-abilities-mods.js). The legacy inline
  // here was removed in the gate cutover (alexanbv 2026-06-16 "replace the old
  // code with the new gate machine").

  // Payback (Dengar CC reaction): if attacker has a pending Payback
  // surge bonus, apply it now. Per alexanbv 2026-05-13: per-figureKey.
  const paybackBonus = game.paybackBonusSurge?.[attackerFigureKey];
  if (paybackBonus) {
    game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + paybackBonus;
    delete game.paybackBonusSurge[attackerFigureKey];
    await thread.send(`**Payback** — +${paybackBonus} Surge applied to this counter-attack.`).catch(discordCatch);
  }

  // Vanish: clear immunity when the protected figure starts attacking
  const vanishEntry = game.vanishImmunityUntilNextActivation?.[attackerPlayerNum];
  if (vanishEntry?.msgId === msgId) {
    delete game.vanishImmunityUntilNextActivation[attackerPlayerNum];
  }

  // "No Cheating": remove N attack dice from debuffed player's attack
  const noCheatingDebuff = game.roundDebuffNextHostileActivation;
  if (noCheatingDebuff && (3 - noCheatingDebuff.playerNum) === attackerPlayerNum && noCheatingDebuff.removeAttackDie > 0) {
    const dice = [...(game.pendingCombat.attackInfo.dice || [])];
    const removeOrder = ['yellow', 'green', 'blue', 'red'];
    let toRemove = noCheatingDebuff.removeAttackDie;
    for (const color of removeOrder) {
      if (toRemove <= 0) break;
      const idx = dice.indexOf(color);
      if (idx !== -1) { dice.splice(idx, 1); toRemove--; }
    }
    game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice };
    delete game.roundDebuffNextHostileActivation;
    await thread.send('⚠️ **No Cheating** is active — 1 attack die removed.').catch(discordCatch);
  }

  // Lord of the Sith / [Driven by Hatred]: when the granted free
  // attack declares, prompt the player to remove 1 die from the
  // attack pool. Reuses the existing pendingDbhDiePick + handleDbhPickDie
  // flow so the player picks WHICH die to drop (not auto-removed).
  // Per alexanbv 2026-05-13: per-figureKey.
  if (game.attackDicePenaltyForMsgId?.[attackerFigureKey] > 0) {
    const _adpLabel = game.attackDicePenaltyLabel || 'Attack penalty';
    const _adpDice = [...(game.pendingCombat.attackInfo.dice || [])];
    const _adpToRemove = game.attackDicePenaltyForMsgId[attackerFigureKey];
    if (_adpDice.length === 0 || _adpToRemove <= 0) {
      delete game.attackDicePenaltyForMsgId[attackerFigureKey];
      if (Object.keys(game.attackDicePenaltyForMsgId).length === 0) delete game.attackDicePenaltyForMsgId;
      delete game.attackDicePenaltyLabel;
    } else {
      const _adpCounts = _adpDice.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
      const _adpUnique = Object.keys(_adpCounts);
      const _adpBtns = _adpUnique.map((color) => {
        const count = _adpCounts[color];
        const label = count > 1 ? `${color} (×${count})` : color;
        return new ButtonBuilder()
          .setCustomId(`dbh_pick_die_${game.gameId}_${color}`)
          .setLabel(label.charAt(0).toUpperCase() + label.slice(1))
          .setStyle(ButtonStyle.Primary);
      });
      // pendingDbhDiePick gates the roll until the player picks.
      game.pendingDbhDiePick = { msgId, attackerPlayerNum, dice: _adpDice };
      delete game.attackDicePenaltyForMsgId[attackerFigureKey];
      if (Object.keys(game.attackDicePenaltyForMsgId).length === 0) delete game.attackDicePenaltyForMsgId;
      delete game.attackDicePenaltyLabel;
      const _adpAtkOwnerId = game[`player${attackerPlayerNum}Id`];
      await thread.send({
        content: `<@${_adpAtkOwnerId}> **${_adpLabel}** — choose 1 die to remove from your attack pool. (You cannot roll until you pick.)`,
        components: [new ActionRowBuilder().addComponents(_adpBtns)],
        allowedMentions: { users: [_adpAtkOwnerId] },
      }).catch(discordCatch);
    }
  }

  // --- Passive-auto ability wiring ---
  const atkEff = getDcEffect(meta.dcName);
  const defEff = getDcEffect(targetDcName);
  const atkSpecialIds = atkEff?.specialAbilityIds || [];
  const defSpecialIds = defEff?.specialAbilityIds || [];

  // (Health-state read for HP-conditional abilities removed: Full of Rage moved
  // to on_declare, Fury to the mods gate — neither computes suffered-damage here
  // any longer. alexanbv 2026-06-18.)

  // Battle Meditation / Assassin (Diala Passil, BT-1): auto-Focus before attacking
  // Battle Meditation — MOVED to the on_declare window (combat-abilities-
  // ondeclare.js 'battle_meditation' passive → _fireOnDeclarePassive) per
  // alexanbv 2026-06-16.

  // Full of Rage (Krrsantan) — MOVED to the on_declare window
  // (combat-abilities-ondeclare.js 'full_of_rage' passive → _fireOnDeclarePassive)
  // per alexanbv 2026-06-16. (Both the early + late declaration sites removed.)

  // Fury (Wookiee Warriors): +1 Surge if 5+ damage — now a gate mods passive
  // (combat-abilities-mods.js 'fury_wookiee' → _fireModsPassive, +1 surgeBonus),
  // fired in the modifiers window. The eager declaration-time detection was
  // deleted to kill the double handling. alexanbv 2026-06-18.

  // Cunning (Han Solo, Jyn Odan, Nexu): while defending, +1 Block per Evade result
  // Cunning — MOVED to the mods window (combat-abilities-mods.js 'cunning' passive).

  // Distracting (Han Solo, C-3PO) MOVED to step-4 defender via sendModsYn —
  // per alexanbv 2026-05-13: the adjacency check should happen at step 4,
  // not on-declare, because figures may move (CC plays, Wild Beast, etc.)
  // between declare and damage resolution. See `_applyDistractingStep4`.
  const mapSpaces = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
  const targetCoord = target.coord ? String(target.coord).toLowerCase() : null;

  // Hunker Down (Cara Dune) — MOVED to the mods window (combat-abilities-mods.js
  // 'hunker_down' passive → _fireModsPassive, +1 Evade) per alexanbv 2026-06-16
  // "implement at the right timing". The eager declaration-time inline (which only
  // fired when target.coord was set + mis-timed the modifier) was deleted to kill
  // the double handling. Now gated on the reusable near_terrain_type primitive.

  // On a Diplomatic Mission: +1 Evade on defense for rest of round
  if (_defMsgId && game.diplomaticMissionEvade?.[_defMsgId]) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + 1;
    await thread.send("**On a Diplomatic Mission** — +1 Evade on defense (rest of round).");
  }

  // Relentless (Trandoshan Hunter, IG-88, Fifth Brother): 1 Strain to target within 3
  // destruct 2026-05-06: routed through applyStrain so the target's controller
  // gets the per-strain choice prompt + Under Duress pre-prompt fires for the
  // attacker (UD prompt fires regardless of who caused the strain).
  if (hasRelentlessAbility(atkSpecialIds) && relentlessInRange(distanceToTarget, atkSpecialIds)) {
    await applyStrain(game, ctx, {
      figureKey: target.figureKey,
      controllerPlayerNum: defenderPlayerNum,
      amount: RELENTLESS_STRAIN_AMOUNT,
      source: 'Relentless',
    });
  }

  // Advanced Targeting Computer (Dark Trooper Mk III): auto-Focus on declare
  if (hasAdvTargetingComputerAbility(atkSpecialIds)) {
    const _atcResult = applyConditionWithDie(game, attackerFigureKey, ADV_TARGETING_COMPUTER_CONDITION, game.pendingCombat.attackInfo, ADV_TARGETING_COMPUTER_BONUS_DIE);
    if (_atcResult.applied) {
      game.pendingCombat.attackInfo = _atcResult.attackInfo;
      await thread.send('**Advanced Targeting Computer** — Dark Trooper Mk III is **Focused** before attacking (+1 green die).');
    }
  }

  // Flawless Execution (Cad Bane): "Before you declare an attack, you
  // become Focused. If you are already Focused, you may gain 1 Power
  // Token and add 1 attack die of any color to your attack pool instead
  // of 1 green die."
  //
  // Per alexanbv 2026-05-13: when already-Focused, Cad Bane CHOOSES the
  // die color AND the power token type (and he may immediately spend
  // that token on this attack). For AI play, default to red die +
  // damage token.
  if (atkSpecialIds.includes('flawless_execution')) {
    if (!attackerConds.includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      resetCondition(game, attackerFigureKey, 'Focus');
      await thread.send('**Flawless Execution** — Cad Bane is **Focused** before attacking (+1 green die).');
    } else {
      const attackerOwnerId = getPlayerId(game, attackerPlayerNum);
      const isAiAttacker = game.selfPlay || isAiUserId(attackerOwnerId);
      if (isAiAttacker) {
        // AI default: red die + damage token. Token is granted via the
        // attacker's power-token bank so it can be spent immediately in
        // the upcoming token phase (or carried).
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'red'] };
        // Route through grantPowerTokens so the >2 cap / overflow-discard (and
        // Migs's cap of 3) apply uniformly (alexanbv 2026-06-22 gain-PT pipeline).
        grantPowerTokens(game, attackerFigureKey, 'Damage', 1);
        await thread.send('**Flawless Execution** — Cad Bane was already Focused: +1 **red** die and +1 **Damage** token (AI default).');
      } else {
        // Human attacker: post die-color + power-token-type pickers.
        // Set pending state so the click handlers know to add the
        // chosen die to attackInfo + grant the chosen token. The
        // attacker can click both before clicking Ready on the
        // on-declare gate, so the modifications land before rolls.
        game.pendingFlawlessExecution = {
          gameId: game.gameId,
          attackerPlayerNum,
          attackerFigureKey,
          attackerDcName: meta.dcName,
          dieChosen: false,
          tokenChosen: false,
        };
        const _feDieBtns = ['red', 'blue', 'green', 'yellow'].map((c) =>
          new ButtonBuilder()
            .setCustomId(`flawless_die_${game.gameId}_${c}`)
            .setLabel(c.charAt(0).toUpperCase() + c.slice(1))
            .setStyle(ButtonStyle.Primary)
        );
        const _feTokBtns = ['Damage', 'Surge', 'Block', 'Evade'].map((t) =>
          new ButtonBuilder()
            .setCustomId(`flawless_token_${game.gameId}_${t.toLowerCase()}`)
            .setLabel(t)
            .setStyle(ButtonStyle.Secondary)
        );
        await thread.send(sanitizeMentions({
          content: `<@${attackerOwnerId}> **Flawless Execution** — Cad Bane was already Focused. Pick an extra **attack die** AND a **power token** type (you may immediately spend the token on this attack):`,
          components: [
            new ActionRowBuilder().addComponents(..._feDieBtns),
            new ActionRowBuilder().addComponents(..._feTokBtns),
          ],
          allowedMentions: { users: [attackerOwnerId] },
        }));
      }
    }
  }

  // Shock and Awe (Cara Dune): MOVED to the on_declare gate as a PLAYER CHOICE
  // (alexanbv 2026-06-18 FIX-1). Previously auto-applied the yellow→red swap here
  // as an AI default; the card reads "you MAY replace", once per round, so it is
  // now an interactive on_declare ability (combat-abilities-ondeclare.js
  // 'shock_and_awe' + COMBAT_RESOLVERS.shock_and_awe) with the once-per-round
  // limit enforced by the gate's limitGuard / _markGateAbilityUsed.

  // Vanguard (AT-RT): now driven by a pre-target player-choice picker
  // in dc-play-area.js (mirrors EE-3 Carbine). The swap, if any, is
  // already applied via pendingOverrideAttackDice before combat starts.
  // Here we just log the post-target outcome + revert if the chosen
  // target ended up out-of-range (>3 spaces) so the card text's
  // "while attacking a figure within 3 spaces" precondition holds.
  if (hasVanguardAbility(atkSpecialIds) && game.pendingVanguardSwap?.[game.pendingCombat.attackerMsgId] === 'swapped') {
    if (vanguardInRange(distanceToTarget)) {
      await thread.send(`**Vanguard** — swap applied (target within ${distanceToTarget} spaces).`);
    } else {
      // Target is out of Vanguard's 3-space range; the pre-target swap
      // shouldn't have applied. Log it; the swap stays mechanically
      // (player accepted it) but card-text-strict the swap is invalid.
      await thread.send(`⚠️ **Vanguard** — target is ${distanceToTarget} spaces away (>3); the pre-target swap was committed but per card text only applies within 3 spaces.`);
    }
    if (game.pendingVanguardSwap) game.pendingVanguardSwap[game.pendingCombat.attackerMsgId] = 'decided';
  }

  // Scattergun / ACP Scattergun — MOVED to the mods window
  // (combat-abilities-mods.js 'scattergun' passive).

  // Shared Intuition (4-LOM): +1 Damage while attacking if another
  // friendly HUNTER within 3 has LOS to target. Per dc-effects.json
  // 'shared_intuition' is on 4-LOM only (alexanbv correction
  // 2026-05-10 — the legacy comment named Tress Hacnua but only 4-LOM
  // carries the slug).
  // PP suppression: if this 4-LOM has had Preservation Protocol played,
  // Shared Intuition is lost for the rest of the game. The
  // figureKey-keyed flag matches naturally — only fires for the 4-LOM
  // figure that took PP.
  const _siPpSuppressed = !!(game.preservationProtocolUsed?.[attackerPlayerNum]?.[attackerFigureKey]);
  if (hasSharedIntuitionAbility(atkSpecialIds) && !_siPpSuppressed && hasLineOfSight && mapSpaces && targetCoord) {
    const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    if (attackerPos) {
      const friendlyPoses = game.figurePositions?.[attackerPlayerNum] || {};
      let found = false;
      for (const [fk, pos] of Object.entries(friendlyPoses)) {
        if (found || fk === attackerFigureKey) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffect(fkDcName);
        if (!isHunterFriendly(fkEff)) continue;
        if (!sharedIntuitionInRange(countSpaces(_csRawMs, attackerPos, pos, _csClosedDoorEdges, 50, game))) continue;
        if (!hasLineOfSightByCoord(game, pos, targetCoord, mapSpaces, getFigureSize, { blocking: null })) continue;
        const r = applySharedIntuitionHit(game.pendingCombat);
        game.pendingCombat.bonusHits = r.bonusHits;
        await thread.send(`**Shared Intuition** — ${fkDcName} (HUNTER) is within 3 spaces with LOS to target: +1 Damage.`);
        found = true;
      }
    }
  }

  // Sharpshooter (Fennec Shand): auto-Focus if target is 5+ spaces away
  // Sharpshooter (Fennec Shand) — MOVED to the on_declare window
  // (combat-abilities-ondeclare.js 'sharpshooter' passive → _fireOnDeclarePassive).

  // Find Weakness (Scout Trooper Elite): -1 Evade to defense results (accuracy handled via passives)
  // Find Weakness — MOVED to the mods window (combat-abilities-mods.js 'find_weakness' passive).

  // Exploit Weakness (Scout Trooper Elite): +1 Surge if defender has a harmful condition
  // Exploit Weakness — MOVED to the mods window (combat-abilities-mods.js
  // 'exploit_weakness' passive).

  // Conclusion (HK-47): −1 Dodge to defense results while attacking.
  // Per destruct 2026-05-08: applies to Dodge, not Evade. computeCombatResult
  // reads conclusionDodgeCancel and clears defRoll.dodge.
  // Conclusion (HK-47) — MOVED to the mods window (combat-abilities-mods.js
  // 'conclusion' attacker passive) per alexanbv 2026-06-16.

  // Query (HK-47): TWO-TIMING (alexanbv 2026-06-18). On the live sequence path
  // Query is now OFFERED + CHOSEN at the on_declare gate (combat-abilities-
  // ondeclare.js 'query'; the defender picks "become Bleeding" NOW or "accept
  // +1 Damage" as a mods pending modifier). The queryNeedsPrompt flag remains
  // only as the guard for the LEGACY proceedAfterRerolls path (non-sequence /
  // selfPlay fallback); it is a no-op on the live gate path.
  if (hasQueryAbility(atkSpecialIds)) {
    game.pendingCombat.queryNeedsPrompt = true;
  }

  // Disposable (Hired Gun Regular) — MOVED to the mods window
  // (combat-abilities-mods.js 'disposable' passive) per alexanbv 2026-06-16.

  // Front Line (Echo Base Trooper): within 3 spaces. The blue→red swap is
  // OPTIONAL (per alexanbv 2026-05-11) and applies to BOTH variants. The +2
  // Accuracy is ELITE-only (CSV row 230 Elite vs row 232 Regular) — gated on the
  // 'front_line_accuracy' id which only the Elite carries.
  if (hasFrontLineAbility(atkSpecialIds) && frontLineInRange(distanceToTarget)) {
    const flAccuracy = hasFrontLineAccuracy(atkSpecialIds);
    if (flAccuracy) {
      game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
    }
    const accNote = flAccuracy ? ' + +2 Accuracy' : '';
    if (game.pendingCombat._frontLineSwap) {
      const swap = applyFrontLineDieSwap(game.pendingCombat.attackInfo.dice || []);
      if (swap.applied) {
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: swap.dice };
        await thread.send(`**Front Line** — 1 blue die replaced with red${accNote} (target within ${distanceToTarget} spaces).`);
      } else {
        await thread.send(`**Front Line** — ${flAccuracy ? '+2 Accuracy applied (no blue die to swap; ' : '(no blue die to swap; '}target within ${distanceToTarget} spaces).`);
      }
    } else {
      await thread.send(`**Front Line** — Target within ${distanceToTarget} spaces:${flAccuracy ? ' +2 Accuracy applied.' : ''} (Blue→Red swap skipped.)`);
    }
  }

  // Cortosis Weave (Echo Base Trooper Elite) — MOVED to the mods window
  // (combat-abilities-mods.js 'cortosis_weave' passive) per alexanbv 2026-06-16.

  // Spectre Cell (defender) — MOVED to the mods window
  // (combat-abilities-mods.js 'spectre_cell_def' passive).

  // Gamorrean Honor Guard / Composite Plating: MOVED to the mods window
  // (combat-abilities-mods.js 'gamorrean_honor_guard' / 'composite_plating'
  // passives) per alexanbv 2026-06-16 — declaration is the wrong timing.

  // Sniper (Alliance Ranger Regular): forced +1 reroll at 5+ spaces (no "may")
  // Sniper / Elite Sniper (Alliance Ranger) — MOVED to the gate: offered as
  // distance-gated rerolls in the rerolls window (CSV rows; +1 / up to +2).
  // The old eager rerollOneAttackDie count is dead in the gate. alexanbv 2026-06-16.

  // Much to Learn (Ezra Bridger): per alexanbv 2026-05-11 — surface as a
  // controlled-reroll bucket entry. If a friendly FORCE USER unique is
  // within 3, mode='turn' (die-face picker, no restriction). Else if
  // any friendly unique within 3, mode='reroll' (standard reroll).
  // The button appears in Ezra's attacker reroll bucket; click → sub-
  // picker shows attack dice (reroll mode rolls them; turn mode posts
  // a face picker).
  if (hasMuchToLearnAbility(atkSpecialIds) && _csRawMs) {
    const atkPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    if (atkPos) {
      const friendlyPos = game.figurePositions?.[attackerPlayerNum] || {};
      // Which of the two outcomes is legal is decided by resolveMuchToLearnMode:
      // another friendly UNIQUE within 3 gives a reroll, and a FORCE USER among
      // them upgrades that to a die turn. Kept in the helper so the rule is
      // testable on its own (alexanbv 2026-08-31: "for Ezra make sure there is a
      // logic path to detect which option is legal").
      const _mtlCandidates = Object.entries(friendlyPos).map(([fk, pos]) => {
        const fkDcName = dcNameFromFigureKey(fk);
        return {
          figureKey: fk,
          dcName: fkDcName,
          effect: getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')],
          distance: countSpaces(_csRawMs, atkPos, pos, _csClosedDoorEdges, 50, game),
        };
      });
      const _mtlPick = resolveMuchToLearnMode(_mtlCandidates, attackerFigureKey);
      const _mtlMode = _mtlPick?.mode || null;
      const _mtlSourceName = _mtlPick?.sourceName || null;
      if (_mtlMode) {
        game.pendingCombat.forcedRerollQueue = game.pendingCombat.forcedRerollQueue || [];
        game.pendingCombat.forcedRerollQueue.push({
          controlPlayer: attackerPlayerNum,
          pool: 'attack',
          remaining: 1,
          source: _mtlMode === 'turn' ? 'Much to Learn (turn)' : 'Much to Learn (reroll)',
          mtlMode: _mtlMode,
        });
        await thread.send(`**Much to Learn** — ${_mtlSourceName} within 3 spaces; ${_mtlMode === 'turn' ? 'may turn 1 attack die to any side' : 'may reroll 1 attack die'} (appears in attacker reroll bucket).`);
      }
    }
  }

  // Forest Fighters (Ewok Warrior Elite) — MOVED to the mods window
  // (combat-abilities-mods.js 'forest_fighters' passive).

  // Sentinel / Protector (defender, +1 Block adjacent to the targeted space) and
  // Supporting Fire (J4X-7 attacker, +1 Pierce) are now gate mods passives
  // (combat-abilities-mods.js 'protector'/'sentinel'/'supporting_fire' →
  // _fireModsPassive), fired in the modifiers window. The eager declaration-time
  // detection was deleted to kill the double handling. The Wookiee-Avenger-
  // replaces-Protector case is handled by stripping `protector` from the upgraded
  // Chewbacca's specials at deploy time (parallel to DBH stripping Brutality).

  // Keep the Peace Elite (Wing Guard Elite): attacker suffers 1 Strain when attacking space adjacent to you
  // Limit 1 per group activation — track per activation via roundFigureAbilityUsed
  if (mapSpaces && targetCoord && !target.isNpc) {
    const adjToTargetKP = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    const defFigPosKP = game.figurePositions?.[defenderPlayerNum] || {};
    let ktpApplied = false;
    for (const [fk, pos] of Object.entries(defFigPosKP)) {
      if (ktpApplied) break;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      const fkAbilityIds = fkEff?.specialAbilityIds || [];
      if (!adjToTargetKP.has(String(pos).toLowerCase())) continue;
      // Elite: automatic, limit 1 per ENEMY group activation (per user
      // clarification 2026-05-09). Keyed by attacker's msgId so a
      // second attacker group's activation in the same round can
      // independently trigger KTP. Routed through applyStrain so the
      // attacker (strained party) gets the per-strain choice prompt
      // + UD pre-prompt fires.
      if (hasKtpEliteAbility(fkAbilityIds)) {
        if (!isKtpAlreadyUsed(game.roundFigureAbilityUsed, fkDcName, msgId)) {
          if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
          game.roundFigureAbilityUsed[buildKtpRoundKey(fkDcName, msgId)] = true;
          await applyStrain(game, ctx, {
            figureKey: attackerFigureKey,
            controllerPlayerNum: attackerPlayerNum,
            amount: KTP_STRAIN_AMOUNT,
            source: `Keep the Peace (${fkDcName})`,
          });
          ktpApplied = true;
        }
      }
      // Regular: INTERACTIVE — now handled as an on_declare gate button
      // (COMBAT_RESOLVERS['keep_the_peace_regular']). The gate offers it to the
      // defender when any adjacent friendly has KTP-Regular; the resolver applies
      // the strain exchange. No hardcoded standalone buttons here.
    }
  }

  // Bespin Security (Wing Guard Elite): adjacent friendly LEADER or SCUM TROOPER attacker gets +1 reroll
  if (mapSpaces) {
    const atkPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    if (attackerQualifiesForBespin(atkEff?.keywords || [], atkEff?.affiliation) && atkPos) {
      const adjToAtk = new Set((mapSpaces.adjacency?.[String(atkPos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
      const friendlyPos = game.figurePositions?.[attackerPlayerNum] || {};
      let bespinApplied = false;
      for (const [fk, pos] of Object.entries(friendlyPos)) {
        if (bespinApplied) break;
        if (fk === attackerFigureKey) continue;
        if (!adjToAtk.has(String(pos).toLowerCase())) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (hasBespinSecurityAbility(fkEff?.specialAbilityIds)) {
          const r = applyBespinSecurityReroll(game.pendingCombat);
          game.pendingCombat.rerollOneAttackDie = r.rerollOneAttackDie;
          await thread.send(`**Bespin Security** (${fkDcName}) — adjacent to attacker, +1 attack reroll.`);
          bespinApplied = true;
        }
      }
    }
  }

  // Airborne Commander (Gar Saxon): friendly Mobile figures within 4 spaces may use Gar Saxon's surge abilities
  if (_csRawMs) {
    const atkPosAC = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    const atkKwsAC = (getDcKeywordsGlobal(game)[meta.dcName] || []).map(k => String(k).toUpperCase());
    const attackerIsMobile = atkKwsAC.includes('MOBILE');
    if (atkPosAC) {
      const friendlyPosAC = game.figurePositions?.[attackerPlayerNum] || {};
      for (const [fk, pos] of Object.entries(friendlyPosAC)) {
        if (!pos) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(fkEff?.specialAbilityIds || []).includes('airborne_commander_gar_saxon')) continue;
        if (fk === attackerFigureKey) continue; // "OTHER friendly Mobile figures" — Saxon cannot share with himself
        if (countSpaces(_csRawMs, atkPosAC, pos, _csClosedDoorEdges, 50, game) > 4) continue;
        if (!attackerIsMobile) {
          await thread.send(`**Airborne Commander** — ${fkDcName} is within 4 spaces, but **${meta.dcName}** does not have the **Mobile** keyword. Surge sharing skipped.`).catch(discordCatch);
          break;
        }
        const saxonSurges = fkEff?.surgeAbilities || [];
        if (saxonSurges.length) {
          game.pendingCombat.bonusSurgeAbilities.push(...saxonSurges);
          await thread.send(`**Airborne Commander** (${fkDcName}) — **${meta.dcName}** is Mobile and within 4 spaces: Gar Saxon's surge abilities added (${saxonSurges.join(', ')}).`).catch(discordCatch);
        }
        break; // only one Airborne Commander source
      }
    }
  }

  // Advanced Firepower (General Sorin): adjacent friendly DROID or VEHICLE may use Sorin's surge abilities.
  // With Advanced Com Systems attached: ACS reads "abilities on your DC
  // that choose or affect adjacent friendly figures OR friendly figures
  // within 2 spaces can choose or affect other friendly figures within 3
  // spaces instead." Sorin's text targets ADJACENT, so ACS extends to 3.
  // (Previously incorrectly capped at 2 — destruct flagged 2026-05-06.)
  if (mapSpaces) {
    const atkPosAF = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    const atkKwsAF = (getDcKeywordsGlobal(game)[meta.dcName] || []).map(k => String(k).toUpperCase());
    const attackerIsDroidOrVehicle = atkKwsAF.includes('DROID') || atkKwsAF.includes('VEHICLE');
    if (atkPosAF) {
      const friendlyPosAF = game.figurePositions?.[attackerPlayerNum] || {};
      for (const [fk, pos] of Object.entries(friendlyPosAF)) {
        if (fk === attackerFigureKey || !pos) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(fkEff?.specialAbilityIds || []).includes('advanced_firepower_sorin')) continue;
        // Check range: adjacent normally, within 3 with ACS
        const _afSorinMsgId = findDcMessageIdForFigure?.(game.gameId, attackerPlayerNum, fk);
        const _afAtts = _afSorinMsgId ? (game.p1DcAttachments?.[_afSorinMsgId] || game.p2DcAttachments?.[_afSorinMsgId] || []) : [];
        const _afHasACS = cardNameIncludes(_afAtts, 'Advanced Com Systems');
        const _afMaxRange = _afHasACS ? 3 : 1;
        const _afDist = _csRawMs ? countSpaces(_csRawMs, atkPosAF, pos, _csClosedDoorEdges, 50, game) : Infinity;
        if (_afDist > _afMaxRange) continue;
        if (!attackerIsDroidOrVehicle) {
          await thread.send(`**Advanced Firepower** — ${fkDcName} is within range, but **${meta.dcName}** is not a DROID or VEHICLE. Surge sharing skipped.`).catch(discordCatch);
          break;
        }
        const sorinSurges = fkEff?.surgeAbilities || [];
        if (sorinSurges.length) {
          game.pendingCombat.bonusSurgeAbilities.push(...sorinSurges);
          const rangeNote = _afHasACS && _afDist > 1 ? ' (ACS: extended range)' : '';
          await thread.send(`**Advanced Firepower** (${fkDcName}) — **${meta.dcName}** is a DROID/VEHICLE within range${rangeNote}: Sorin's surge abilities added (${sorinSurges.join(', ')}).`).catch(discordCatch);
        }
        break; // only one Advanced Firepower source
      }
    }
  }

  // Awkward (AT-ST): cannot attack adjacent figures
  if (hasAwkwardAbility(atkSpecialIds) && awkwardBlocks(distanceToTarget)) {
    await thread.send('**Awkward** — Cannot attack adjacent figures. Attack cancelled.');
    resolvePendingCombat(game);
    saveGames(game.gameId);
    return;
  }

  // Camouflage (Mak, Scout Trooper Elite): hostile figures 4+ spaces away cannot draw LOS
  const camouflageIds = ['camouflage_mak', 'camouflage_scout_trooper'];
  if (defSpecialIds.some(id => camouflageIds.includes(id)) && isRanged && distanceToTarget >= 4) {
    const camName = defSpecialIds.includes('camouflage_mak') ? 'Mak' : 'Scout Trooper';
    await thread.send(`**Camouflage** (${camName}) — Hostile figures 4+ spaces away cannot target this figure. Attack cancelled.`);
    resolvePendingCombat(game);
    saveGames(game.gameId);
    return;
  }

  // In the Shadows (CC): hostile figures 4+ spaces away have NO line of sight
  // to this figure (alexanbv 2026-06-20). Unlike Camouflage this is a pure LOS
  // denial (not ranged-only) — though at 4+ spaces a melee attack can't reach
  // anyway. Post-declare safety net mirroring the target-picker filter.
  if (figureHasInTheShadows(game, target.figureKey) && distanceToTarget >= 4) {
    await thread.send('**In the Shadows** — Hostile figures 4+ spaces away have no line of sight to this figure. Attack cancelled.');
    resolvePendingCombat(game);
    saveGames(game.gameId);
    return;
  }

  // Slippery (Alliance Smuggler E/R): while defending, apply -2 Accuracy.
  // MOVED to the mods window (combat-abilities-mods.js 'slippery' passive +
  // _fireModsPassive) per alexanbv 2026-06-16 — declaration is the wrong timing.

  // Take Cover (Jawa Scavenger E/R): while defending, +1 Block and -1 Evade.
  // MOVED to the mods window (combat-abilities-mods.js 'take_cover' passive).

  // Aim (Rebel Trooper) — MOVED to the mods window (combat-abilities-mods.js
  // 'aim' passive) per alexanbv 2026-06-16 "Aim is a mod".

  // Dead Precise (Ko-Tun Feralo) — MOVED to the gate (alexanbv 2026-06-16):
  // the REROLL is offered in the rerolls window (CSV Dead Precise row, token-
  // gated aura) and the −1 Dodge RIDER is the mods-window 'dead_precise_dodge'
  // passive (same conditions, independent of whether the reroll is used).

  // Spray Fire (Heavy Stormtrooper Elite): "you may apply -3 Accuracy
  // and +1 Surge to the attack results." Player choice — surfaced at
  // step-4 attacker modifier window (proceedAfterRerolls) via the
  // combat_passive_ prompt pattern.

  // Improvised Cover (Verena Talos): +1 Block is now applied by the LIVE mods-gate
  // passive ('improvised_cover_verena' → _fireModsPassive), with the broader
  // object-OR-enemy-figure condition. The old inline +Block here was removed to
  // avoid a DOUBLE Block (Batch 2 added the gate passive but left this inline).

  // Inside Job (Hoth Battle Station A): defense modifier based on deployment zone
  {
    const _ijMapId = game.selectedMap?.id;
    const _ijVariant = game.selectedMission?.variant;
    if (_ijMapId && _ijVariant) {
      const _ijMissions = getMissionCardsData()?.[_ijMapId];
      const _ijRules = _ijMissions?.[_ijVariant]?.rules?.persistent?.defenseModifierByZone;
      if (_ijRules) {
        const _ijZoneData = getDeploymentZones()?.[_ijMapId];
        if (_ijZoneData && target.coord) {
          const _ijInitPn = getInitiativePlayerNum(game);
          const _ijDefZoneColor = defenderPlayerNum === _ijInitPn ? game.deploymentZoneChosen : (game.deploymentZoneChosen === 'red' ? 'blue' : 'red');
          const _ijOppZoneColor = _ijDefZoneColor === 'red' ? 'blue' : 'red';
          const _ijOwnSpaces = new Set((_ijZoneData[_ijDefZoneColor] || []).map(s => String(s).toLowerCase()));
          const _ijOppSpaces = new Set((_ijZoneData[_ijOppZoneColor] || []).map(s => String(s).toLowerCase()));
          const _ijDefCoord = String(target.coord).toLowerCase();
          if (_ijOwnSpaces.has(_ijDefCoord) && _ijRules.ownZone?.blockBonus) {
            game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + _ijRules.ownZone.blockBonus;
            await thread.send(`**Inside Job** — Defender in own deployment zone: ${_ijRules.ownZone.blockBonus} Block.`);
          }
          if (_ijOppSpaces.has(_ijDefCoord) && _ijRules.opponentZone?.evadeBonus) {
            game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + _ijRules.opponentZone.evadeBonus;
            await thread.send(`**Inside Job** — Defender in opponent's deployment zone: +${_ijRules.opponentZone.evadeBonus} Evade.`);
          }
        }
      }
    }
  }

  // Tripod (E-Web E/R): if figure has moved this activation, cannot attack
  if (tripodBlocksAttack({ specialAbilityIds: atkSpecialIds, moved: game.figureMoved?.[attackerFigureKey] })) {
    await thread.send('**Tripod** — Has exited space this activation. Cannot attack.');
    resolvePendingCombat(game);
    saveGames(game.gameId);
    return;
  }

  // Log override dice if active (Saber Strike, Bo-Rifle Staff Strike)
  if (overrideDice?.dice) {
    const diceStr = overrideDice.dice.join(', ');
    const typeStr = overrideDice.type === 'melee' ? ' (Melee)' : '';
    const pierceStr = overrideDice.pierce > 0 ? `, Pierce ${overrideDice.pierce}` : '';
    await thread.send(`**Override dice** — Attack uses [${diceStr}]${typeStr}${pierceStr}.`);
  }
  // Apply bonusHits from overrideDice (e.g. Overheated: -1 Damage, Flurry of Blows: +1 Damage)
  if (overrideDice?.bonusHits) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + overrideDice.bonusHits;
    if (overrideDice.bonusHits < 0) {
      await thread.send(`**Overheated** — −${Math.abs(overrideDice.bonusHits)} Hit applied automatically.`).catch(discordCatch);
    } else if (overrideDice.bonusHits > 0) {
      await thread.send(`**+${overrideDice.bonusHits} Hit** applied to attack results.`).catch(discordCatch);
    }
  }
  // Optimal Bombardment: apply +Blast bonus if this figure was granted one.
  // Keyed by the attacker's figureKey (matching the setter at abilities.js:10464)
  // — was wrongly read by msgId so the bonus never applied (alexanbv 2026-06-20).
  const _obFk = game.pendingCombat?.attackerFigureKey;
  if (_obFk && game.optimalBombardmentBlastBonus?.[_obFk]) {
    const _obBlast = game.optimalBombardmentBlastBonus[_obFk];
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + _obBlast;
    await thread.send(`**Optimal Bombardment** — +${_obBlast} Blast added to this attack.`).catch(discordCatch);
    delete game.optimalBombardmentBlastBonus[_obFk];
  }

  // The Force is With Me, Strike Me Down, Slow on the Draw, Force Exhaustion:
  // all migrated to the on_declare gate (COMBAT_RESOLVERS in this file +
  // registrations in combat-abilities-ondeclare.js). No hardcoded standalone
  // buttons here — they appear as gate choices alongside other on_declare abilities.

  // Loku Recon Token — player-sensitive (game.reconTokens[playerNum], so a mirror
  // match keeps each player's token separate) and only active while a Loku with
  // the ability is ALIVE on that player's team. alexanbv 2026-06-17: "abilities
  // like this should be player-sensitive and only work while the figure is alive."
  const _myRecon = game.reconTokens?.[attackerPlayerNum];
  const _reconOnTarget = _myRecon?.figureKey === target.figureKey;
  // Set Your Sights Pierce 1 is now applied by the LIVE mods-gate passive
  // ('set_your_sights' → _fireModsPassive), so the old inline +Pierce here was
  // removed to avoid a DOUBLE Pierce once the gate passive's recon-token
  // condition was corrected to the owner-keyed shape (commit 6c661702). The
  // gate passive uses the same condition (target carries the attacker's Recon
  // token + a live Loku), so behaviour is unchanged — just single, not double.
  // Mon Cala SF — Loku becomes Focused when LOKU attacks the tokened figure
  // (inherently requires the attacker to be a live Loku).
  if (_reconOnTarget && hasMonCalaSfLokuAbility(atkSpecialIds)) {
    applyCondition(game, attackerFigureKey, MON_CALA_SF_LOKU_CONDITION);
    await thread.send('**Mon Cala Special Forces** — Loku gains Focus for attacking Recon-tokened figure.');
  }

  // Illicit Arms (Bib Fortuna): MOVED to proceedAfterRerolls (step-4
  // attacker modifier) per alexanbv 2026-05-09 — was incorrectly firing at
  // attack-declare. The +1 Damage applies as a step-4 modifier alongside
  // Pulse Cannon / Negotiate / Call the Shots / Heavy Repeater.

  // Per-figure 2026-05-09: clear next-attack bonuses keyed by attackerFigureKey.
  if (nextSurge.length) delete game.nextAttackBonusSurgeAbilities?.[attackerFigureKey];
  if (nextPierce) delete game.nextAttackBonusPierce?.[attackerFigureKey];
  if (nextBonusAcc) delete game.nextAttackBonusAccuracy?.[attackerFigureKey];
  // Expose Weakness: consume the target-keyed pierce once the chosen defender is attacked.
  if (_defKeyForPierce && game.nextAttackPierceVsDefender?.[_defKeyForPierce]) {
    delete game.nextAttackPierceVsDefender[_defKeyForPierce];
  }
  if (game.nextAttackReach?.[attackerFigureKey]) delete game.nextAttackReach[attackerFigureKey];
  delete game.lastAttackTargetSpacesForRubble;
  delete game.lastAttackAttackerPlayerNum;

  await interaction.message.edit({
    content: `**Combat declared** — See thread in Game Log.`,
    components: [],
  }).catch(discordCatch);

  // Auto-prompt defender for playable reaction cards (whenAttackDeclaredOnYou, etc.)
  try {
    const defReactions = getPlayableReactionCardsForTiming(game, defenderPlayerNum, [
      'whenAttackDeclaredOnYou',
      'whenAttackDeclaredOnAdjacentFriendly',
      'whenAttackDeclaredTargetingFriendlySmallFigureCost10OrLessWithin3Spaces',
      'whenFigureWithin3SpacesDefending',
      'whileDefending',
      'whileAdjacentFriendlyFigureDefending',
    ]);
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    if (defReactions.length) {
      await sendPrivateReactionPrompt(client, game, defenderPlayerNum, defReactions.length, 'attack declared on you');
    }
    // Auto-prompt attacker for whenYouDeclareAttack cards
    const atkReactions = getPlayableReactionCardsForTiming(game, attackerPlayerNum, [
      'whenYouDeclareAttack',
      'whenYouDeclareAttackTargetingHostileWithHighestFigureCost',
      'beforeYouDeclareAttack',
      'duringAttack',
      'whenAnotherFriendlyTrooperDeclaresAttackTargetingInYourLineOfSight',
    ]);
    const atkOwnerId = getPlayerId(game, attackerPlayerNum);
    if (atkReactions.length) {
      await sendPrivateReactionPrompt(client, game, attackerPlayerNum, atkReactions.length, 'attack declared');
    }
  } catch (err) {
    console.error('Reaction prompt error:', err?.message ?? err);
  }

  // GATE CUTOVER (alexanbv 2026-06-16 "replace the old code with the new gate
  // machine"): every declared attack walks the gate sequence (on_declare → roll
  // → rerolls → special → mods → spend_surges → zillo → damage → after_resolve).
  // The legacy sendOnDeclareYn ad-hoc chain is retired.
  await runAttackSequence(thread, game, game.pendingCombat, ctx);
  saveGames(game.gameId);
}

/**
 * Post-declare miss-and-step-8 path. Called when handleCombatRoll's
 * validity probe aborts the attack (attacker removed, target removed,
 * or LoS lost). Per CRR: a LoS-loss after declaration still counts as
 * a missed attack — step 8 abilities (Migs Mayfeld gain-tokens, Han's
 * Return Fire, etc.) still resolve. We synthesize a miss state on
 * combat, enqueue step-8 effects for both sides, drain via
 * postPostResolveWindow, then clean up.
 */
export async function _forceMissAndStep8(thread, game, combat, ctx, message) {
  if (thread) await thread.send(message).catch(discordCatch);
  // Synthesize miss state — step-8 enqueuers read _step7Hit/_step7Damage.
  combat._step7Hit = false;
  combat._step7Damage = 0;
  combat.aborted = true;
  combat.abortReason = 'los_or_attacker_gone';
  // Step 8: defender-side enqueuers (Return Fire, Migs auto-tokens, etc.)
  // The attacker-side enqueuer is hit/damage-gated internally, so it
  // safely skips Blast / Cleave / damage-conditions on a miss.
  try {
    const { enqueueAttackerStep8Effects, enqueueDefenderStep8Effects, enqueueAttackerPerDcEffects, enqueueAfterResolveGateAbilities, postPostResolveWindow } = await import('./after-attack-resolve.js');
    // LIVE-PATH BUG (alexanbv 2026-07-10, C-3P0 at 1 HP got no Disruptor
    // offer): this deps bag lacked dcHealthState, so the after-resolve
    // enumerators' HP reads (Disruptor Rifle's exactly-1-HP gate) came back
    // undefined on the Discord-driven path and silently dropped the offer —
    // while the headless path (tests) passed full deps and stayed green.
    // Pass everything the enumerators consume.
    const _step8Deps = {
      getDcEffects: ctx.getDcEffects,
      findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
      dcNameFromFigureKey,
      dcHealthState: ctx.dcHealthState,
      getDcList,
    };
    // alexanbv ruling 2026-06-26: the FULL after-attack window fires on a forced
    // miss (discard conditions like Focus/Hidden, after-resolve DC abilities, gate
    // after-resolve abilities) — not just the Return-Fire/token subset. Damage-
    // gated effects (Blast/Cleave/conditions needing >0 damage) self-skip since
    // _step7Damage=0; surge-only abilities (Fighting Knife) correctly can't fire
    // because no dice were rolled (spend-surges step skipped). Enqueue all four
    // sources, same as the normal runAfterResolveWindow.
    enqueueAttackerStep8Effects(combat);
    enqueueAttackerPerDcEffects(combat, game, _step8Deps);
    enqueueDefenderStep8Effects(combat, game, _step8Deps);
    enqueueAfterResolveGateAbilities(combat, game, _step8Deps);
    if (thread) {
      await postPostResolveWindow(thread, game, combat, 'defender', ctx);
      await postPostResolveWindow(thread, game, combat, 'attacker', ctx);
    }
  } catch (err) {
    console.error('[forceMiss] step8 drain failed:', err?.message ?? err);
  }
  resolvePendingCombat(game);
  if (ctx.saveGames) ctx.saveGames(game.gameId);
}



/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, rollAttackDice, rollDefenseDice, getAttackerSurgeAbilities, SURGE_LABELS, getSurgeAbilityLabel, resolveCombatAfterRolls, saveGames
 */
export async function handleCombatRoll(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    rollAttackDice,
    rollDefenseDice,
    getAttackerSurgeAbilities,
    SURGE_LABELS,
    resolveCombatAfterRolls,
    saveGames,
  } = ctx;
  // New format: combat_roll_<role>_<gameId> where role is 'atk' or 'def'.
  // Legacy format: combat_roll_<gameId> (single button, sequential rolls).
  // Held semantics only fire for the new format; legacy IDs fall through
  // unchanged for any in-flight combat that posted the old button.
  const _roleMatch = interaction.customId.match(/^combat_roll_(atk|def)_(.+)$/);
  const role = _roleMatch?.[1] ?? null;
  const gameId = _roleMatch?.[2] ?? parseCustomId(interaction.customId, 'combat_roll_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !await requirePlayer(interaction, game, interaction.user.id, 2, canActAsPlayer, 'Only players in this game can roll.')) return;
  // Driven by Hatred die-pick gate (destruct 2026-05-06): the EOR penalty
  // requires the attacker to choose a die before rolling. Refuse the roll
  // until pendingDbhDiePick is cleared by the dbh_pick_die_ handler.
  if (game.pendingDbhDiePick) {
    await interaction.followUp({
      content: '**Driven by Hatred** — pick a die to remove from your attack pool first (button in combat thread).',
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  // Force Exhaustion (The Child / Clan of Two): the defender's incap decision is
  // made at attack-declare (on_declare, defender) and MUST be resolved before any
  // dice are rolled (alexanbv ruling: an incap forces the attack to miss with no
  // dice rolled). Refuse the roll while the FE decision is still pending — the
  // force_exhaustion_yes_/no_ buttons drive resolution; "No" lets the gate roll.
  if (game.pendingForceExhaustion || game.pendingForceExhaustionDiePick) {
    await interaction.followUp({
      content: game.pendingForceExhaustionDiePick
        ? '**Force Exhaustion** — the attacker must choose which attack die to remove first (button in combat thread).'
        : '**Force Exhaustion** — The Child\'s owner must resolve the incapacitate decision first (button in combat thread).',
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) throw new Error(`handleCombatRoll: combat thread is null (threadId=${combat.combatThreadId}, gameId=${gameId})`);
  const effectiveAttackerPlayerNum = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;

  // Attacker-validity probe (per user 2026-05-09): after defender on-declare
  // reactions resolve and just before dice are rolled, verify the attacker
  // is still on the board AND still has effective LOS to the target.
  // Aborts combat for cases like:
  //   - SoD interrupt defeated the attacker (this combat resumes with
  //     attacker removed)
  //   - Cara Dune CC / Ahsoka CC / Force Push removed the attacker
  //   - LAM repositioned the target out of LOS
  // CRITICAL: this probe MUST match the picker's LoS check exactly —
  // both go through hasLosFromFigureToFigure (game/effective-los.js), the
  // single team-agnostic LoS oracle. Camo / PT / MASSIVE / Clawdite
  // Scout / Marksman / multi-cell footprints all resolve identically.
  // Marksman flag is consumed at declare time (combat.js:1343) so we
  // read combat.attackIgnoredFigureLOS (snapshot taken at declare).
  if (combat.attackerFigureKey && combat.target?.figureKey) {
    const _avAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    if (!_avAtkPos) {
      await _forceMissAndStep8(thread, game, combat, ctx, '🚫 **Attack aborted (counted as a miss)** — attacker is no longer on the board.');
      return;
    }
    // Target may be on either side: Lure of the Dark Side forces a
    // friendly figure to attack ANOTHER friendly figure (same team as
    // attacker). False Orders / regular attacks target the opposing
    // team. Resolve the target's actual team by lookup rather than
    // assuming opponent — combat.target.playerNum is sometimes unset.
    let _avTgtPlayerNum = combat.target.playerNum;
    let _avTgtPosNow = _avTgtPlayerNum != null
      ? game.figurePositions?.[_avTgtPlayerNum]?.[combat.target.figureKey]
      : null;
    if (!_avTgtPosNow) {
      // Fallback: search both teams (covers undefined target.playerNum
      // for both regular attacks and Lure).
      for (const pn of [1, 2]) {
        const pos = game.figurePositions?.[pn]?.[combat.target.figureKey];
        if (pos) { _avTgtPosNow = pos; _avTgtPlayerNum = pn; break; }
      }
    }
    if (!_avTgtPosNow) {
      await _forceMissAndStep8(thread, game, combat, ctx, '🚫 **Attack aborted (counted as a miss)** — target is no longer on the board.');
      return;
    }
    if (game.selectedMap?.id) {
      // Team-agnostic LoS via the shared hasLosFromFigureToFigure helper.
      // Same calculator used (or usable by) Gideon Argus / Force
      // Deflection / Distracting Fire / any future same-team LoS check.
      // Shims missing combat-ctx helpers (getFootprintCells,
      // getMapTokensData — see context-factory.js COMBAT_DEPS gap).
      let _avAtkScoutForm = false;
      try {
        const { getConfig } = await import('../game/figure-config.js');
        _avAtkScoutForm = getConfig(game, combat.attackerFigureKey)?.form === 'Scout';
      } catch { /* optional */ }
      const { hasLosFromFigureToFigure } = await import('../game/effective-los.js');
      const _avLosCtx = {
        getDcEffects: ctx.getDcEffects || getDcEffectsGlobal,
        getFigureSize: ctx.getFigureSize || getFigureSize,
        getFootprintCells,
        getMapData,
        getMapTokensData,
      };
      const _avLos = hasLosFromFigureToFigure(
        game,
        combat.attackerFigureKey,
        combat.target.figureKey,
        _avLosCtx,
        {
          marksmanActive: !!combat.attackIgnoredFigureLOS,
          attackerIgnoresFigureBlocking: _avAtkScoutForm,
        },
      );
      if (!_avLos) {
        await _forceMissAndStep8(thread, game, combat, ctx, '🚫 **Attack aborted (counted as a miss)** — attacker no longer has line of sight to the target.');
        saveGames(game.gameId);
        return;
      }
    }
  }

  // Held-roll early gates: when role is specified (new buttons), reject
  // if that side already rolled. Old single-button path skips this.
  if (role === 'atk' && combat.attackRoll) {
    await interaction.followUp({ content: 'Attack dice already rolled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (role === 'def' && combat.defenseRoll) {
    await interaction.followUp({ content: 'Defense dice already rolled.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Held-roll mode is signaled by the new-format button's role suffix.
  // First press of either button: compute that side's roll, store it,
  // edit the prompt to show readiness, and return without revealing the
  // dice. Second press: enter the existing roll branch, which posts its
  // own image, then we inject the held side's image at the right spot.
  // Known limitation: if Veteran Instincts / Guidance Systems / Doubt
  // fire after the second press, their handlers expect the user to
  // re-click the (now spent) Roll button. Held-flow combats with those
  // abilities active will get stuck — fix follow-up.
  const _heldRollFlow = role !== null;

  if (_heldRollFlow && role === 'atk' && !combat.attackRoll && !combat.defenseRoll) {
    if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttackerPlayerNum, canActAsPlayer, `Only the attacker (**${getPlayerDisplayName(game, effectiveAttackerPlayerNum, interaction.client)}**) may roll attack dice.`)) return;
    // Run for Cover (defender removes 1) / Savage Vigor (attacker keeps 2): when
    // the pool offers a real choice, post the attack-die picker and wait for it.
    const _atkTrim = _resolveAttackPoolTrim(combat);
    if (_atkTrim.needPicker) {
      await _postAttackDiePicker(thread, game, combat, _atkTrim.pool, _atkTrim.target, _atkTrim.owner, _atkTrim.mode);
      await interaction.followUp({ content: `⏳ Pick ${_atkTrim.target} attack die${_atkTrim.target > 1 ? 's' : ''} to ${_atkTrim.mode === 'keep' ? 'keep' : 'remove'} — see the picker prompt.`, ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    let dice = _atkTrim.dice;
    const addYellowUntil = combat.attackPoolAddYellowUntilTotal;
    if (typeof addYellowUntil === 'number' && addYellowUntil > 0 && dice.length < addYellowUntil) {
      const toAdd = addYellowUntil - dice.length;
      for (let i = 0; i < toAdd; i++) dice.push('yellow');
      if (combat.superchargeStrainAfterAttack) combat.superchargeStrainAfterAttackCount = toAdd;
    }
    const result = rollAttackDice(dice);
    combat.attackRoll = { acc: result.acc, dmg: result.dmg, surge: result.surge };
    combat.attackDiceResults = result.dice;
    await _updateRollPromptStatus(thread, game, combat, interaction.client);
    saveGames(game.gameId);
    return;
  }

  if (_heldRollFlow && role === 'def' && !combat.defenseRoll && !combat.attackRoll) {
    if (!await requirePlayer(interaction, game, interaction.user.id, defenderPlayerNum, canActAsPlayer, `Only the defender (**${getPlayerDisplayName(game, defenderPlayerNum, interaction.client)}**) may roll defense dice.`)) return;
    const baseDef = combat.targetStats?.defense || 'white';
    const baseDice = Array.isArray(baseDef) ? baseDef : [baseDef];
    const bonusDice = combat.defenseBonusDice || [];
    const pool = [...baseDice, ...bonusDice];
    if (combat.autofireAttack) pool.push('white');
    if (combat.barrageAttack) pool.push('white');
    // Generalized defender-die pick (alexanbv 2026-05-11): when any
    // attacker effect removes a defense die AND the FULL pool (base +
    // bonus) has >1 die, the attacker picks which to remove. Covers
    // Verena Close Quarters, Element of Surprise, Wild Fire — Wild Fire
    // matters because Barrage/Autofire add a white bonus die to the
    // pool (e.g. AT-ST + Barrage = bbw), and the attacker may pick from
    // ALL of them.
    const _defRemoveMaxRaw = combat.defensePoolRemoveAll ? pool.length : (combat.defensePoolRemoveMax || 0);
    const _defPicksNeeded = Math.min(_defRemoveMaxRaw, pool.length > 1 ? pool.length : 0);
    if (_defPicksNeeded > 0 && !Array.isArray(combat._defPickRemoveIdxList)) {
      await _postDefenseDieRemovePicker(thread, game, combat, pool, _defPicksNeeded);
      await interaction.followUp({ content: `⏳ Pick ${_defPicksNeeded} defense die${_defPicksNeeded > 1 ? 's' : ''} to remove from the defense pool — see the picker prompt.`, ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    const removeMax = _defRemoveMaxRaw;
    const removeCount = Math.min(removeMax, pool.length);
    let diceToRoll;
    if (Array.isArray(combat._defPickRemoveIdxList) && combat._defPickRemoveIdxList.length > 0 && pool.length > 1) {
      const _drop = new Set(combat._defPickRemoveIdxList);
      diceToRoll = pool.filter((_, i) => !_drop.has(i));
    } else {
      diceToRoll = pool.slice(0, pool.length - removeCount);
    }
    const defDiceResults = [];
    let block = 0, evade = 0, dodge = 0;
    for (const color of diceToRoll) {
      const r = rollDefenseDice(color);
      defDiceResults.push(r);
      block += r.block;
      evade += r.evade;
      if (r.dodge) dodge += 1;
    }
    combat.defenseRoll = { block, evade, dodge };
    combat.defenseDiceResults = defDiceResults;
    combat.defenseDiceCount = diceToRoll.length;
    await _updateRollPromptStatus(thread, game, combat, interaction.client);
    saveGames(game.gameId);
    return;
  }

  // General rule (alexanbv 2026-06-22): if the ATTACKER itself was defeated
  // MID-ATTACK — e.g. by a defender reaction that damages the attacker on-declare
  // (Ambush's move-adjacent + 2 Damage, Ahsoka / Fennec CCs) — the attack cannot
  // happen. Skip straight to after-resolve as a miss, exactly like On the Lam
  // (forceMiss → step 8). A defeated figure has had its board position removed.
  if (!combat.attackRoll && combat.attackerFigureKey
      && !game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey]) {
    await _forceMissAndStep8(thread, game, combat, ctx, `**${combat.attackerDcName}** was defeated before the attack resolved — the attack is canceled.`);
    return;
  }

  // C4: On the Lam — recheck target eligibility before rolling. Per CRR
  // p.10 (lines 442-446): "if the attacker's line of sight to the target
  // space changes or if the defender moves, the attacker must then re-
  // declare a target space" + "If the target of a melee attack ends its
  // movement such that it is no longer adjacent to the attacker (or within
  // 2 spaces and in line of sight if the attack has Reach), the attack misses."
  // Old code only re-checked LOS; this also re-checks adjacency/Reach for
  // melee attacks.
  if (game.onTheLamActive && !combat.attackRoll) {
    delete game.onTheLamActive;
    const _otlMapId = game.selectedMap?.id;
    const _otlMapSpaces = _otlMapId ? getMapData(_otlMapId) : null;
    const _otlAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    const _otlDefPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target?.figureKey];
    if (_otlMapSpaces && _otlAtkPos && _otlDefPos && ctx.hasLineOfSightByCoord) {
      const _otlHasLOS = ctx.hasLineOfSightByCoord(
        game,
        String(_otlAtkPos).toLowerCase(),
        String(_otlDefPos).toLowerCase(),
        _otlMapSpaces,
        ctx.getFigureSize,
        { blocking: null },
      );
      // Adjacency / Reach re-check for melee attacks (CRR 445-446)
      let _otlAdjFail = false;
      let _otlMissReason = null;
      const _otlIsMelee = !combat.isRanged;
      if (_otlIsMelee && _otlHasLOS) {
        // Reach detection: keyword OR passive OR nextAttackReach flag
        const _otlAtkEff = ctx.getDcEffects?.()?.[combat.attackerDcName] || {};
        const _otlReachKws = (_otlAtkEff.keywords || []).map(k => String(k).toUpperCase());
        const _otlReachPassives = (_otlAtkEff.passives || []).map(p => String(p).toUpperCase());
        const _otlHasReach = _otlReachKws.includes('REACH')
          || _otlReachPassives.includes('REACH')
          || !!game.nextAttackReach?.[combat.attackerFigureKey];
        const _otlMaxRange = _otlHasReach ? 2 : 1;
        const _otlInRange = _isWithinSpaces(
          _otlMapSpaces,
          String(_otlAtkPos).toLowerCase(),
          String(_otlDefPos).toLowerCase(),
          _otlMaxRange,
          getClosedDoorEdges(game),
        );
        if (!_otlInRange) {
          _otlAdjFail = true;
          _otlMissReason = _otlHasReach
            ? 'Target moved out of Reach (>2 spaces from attacker).'
            : 'Target moved out of melee adjacency.';
        }
      }
      if (!_otlHasLOS || _otlAdjFail) {
        combat.forceMiss = true;
        combat.attackRoll = { acc: 0, dmg: 0, surge: 0 };
        combat.attackDiceResults = [];
        combat.defenseRoll = { block: 0, evade: 0, dodge: false };
        combat.defenseDiceResults = [];
        combat.defenseDiceCount = 0;
        const _otlMsg = _otlMissReason || 'Target moved out of line of sight.';
        await thread.send(`**On the Lam** — ${_otlMsg} The attack misses.`);
        await sendReadyToResolveRolls(thread, game.gameId, game, ctx);
        saveGames(game.gameId);
        return;
      }
    }
  }

  if (!combat.attackRoll) {
    if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttackerPlayerNum, canActAsPlayer, `Only the attacker (**${getPlayerDisplayName(game, effectiveAttackerPlayerNum, interaction.client)}**) may roll attack dice.`)) return;
    // Run for Cover (defender removes 1) / Savage Vigor (attacker keeps 2): when
    // the pool offers a real choice, post the attack-die picker and wait for it.
    const _atkTrim = _resolveAttackPoolTrim(combat);
    if (_atkTrim.needPicker) {
      await _postAttackDiePicker(thread, game, combat, _atkTrim.pool, _atkTrim.target, _atkTrim.owner, _atkTrim.mode);
      await interaction.followUp({ content: `⏳ Pick ${_atkTrim.target} attack die${_atkTrim.target > 1 ? 's' : ''} to ${_atkTrim.mode === 'keep' ? 'keep' : 'remove'} — see the picker prompt.`, ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    let dice = _atkTrim.dice;
    const addYellowUntil = combat.attackPoolAddYellowUntilTotal;
    if (typeof addYellowUntil === 'number' && addYellowUntil > 0 && dice.length < addYellowUntil) {
      const toAdd = addYellowUntil - dice.length;
      for (let i = 0; i < toAdd; i++) dice.push('yellow');
      if (combat.superchargeStrainAfterAttack) combat.superchargeStrainAfterAttackCount = toAdd;
    }
    const result = rollAttackDice(dice);
    combat.attackRoll = { acc: result.acc, dmg: result.dmg, surge: result.surge };
    combat.attackDiceResults = result.dice;
    const _atkRollerName = getPlayerDisplayName(game, attackerPlayerNum, interaction.client);
    const _atkRollContent = `🎲 **${_atkRollerName}** rolled attack — **${result.acc}** accuracy, **${result.dmg}** damage, **${result.surge}** surge`;
    const _atkRollImg = await renderAttackDiceImage(result.dice).catch(() => null);
    if (_atkRollImg) {
      await thread.send({ content: _atkRollContent, files: [new AttachmentBuilder(_atkRollImg, { name: 'attack-roll.png' })] }).catch(discordCatch);
    } else {
      const diceDetail = result.dice.map((d) => `${d.color}(${d.acc}a/${d.dmg}d/${d.surge}s)`).join(', ');
      await thread.send(`${_atkRollContent}  [${diceDetail}]`).catch(discordCatch);
    }
    // Held-roll second-press (case B: def held → atk pressed): defender's
    // dice were computed but not posted on first press. Post them now,
    // immediately after the atk image, then clear the held-roll prompt buttons.
    if (_heldRollFlow && combat.defenseRoll) {
      await _postDefenseRollImage(thread, combat, game, interaction.client);
      if (combat.rollMessageId) {
        try {
          const msg = await thread.messages.fetch(combat.rollMessageId);
          await _updateRollPromptStatus(thread, game, combat, interaction.client);
          await msg.edit({ components: [] }).catch(discordCatch);
        } catch {}
      }
    }
    // (Vet Instincts attacker + Guidance Systems prompts moved to the
    // modifier step per CRR step 4 — see sendModsYn 2026-05-04 migration.
    // Removing them from the attack-roll block lets auto-roll work for
    // every combat without the held-unsafe predicate.)
    saveGames(game.gameId);
    return;
  }

  if (!combat.defenseRoll) {
    if (!await requirePlayer(interaction, game, interaction.user.id, defenderPlayerNum, canActAsPlayer, `Only the defender (**${getPlayerDisplayName(game, defenderPlayerNum, interaction.client)}**) may roll defense dice.`)) return;
    // Held-roll second-press (case A: atk held → def pressed): attacker's
    // dice were computed but not posted on first press. Post atk image
    // FIRST so the thread reads atk → def in chronological order.
    if (_heldRollFlow && combat.attackRoll) {
      await _postAttackRollImage(thread, combat, game, interaction.client);
      if (combat.rollMessageId) {
        try {
          const msg = await thread.messages.fetch(combat.rollMessageId);
          await msg.edit({ components: [] }).catch(discordCatch);
        } catch {}
      }
    }
    const baseDef = combat.targetStats.defense || 'white';
    const baseDice = Array.isArray(baseDef) ? baseDef : [baseDef];
    const bonusDice = combat.defenseBonusDice || [];
    const pool = [...baseDice, ...bonusDice];
    // Autofire: defender adds 1 white die.
    // NB: check the per-combat flag (set when the attack was declared), not
    // game.autofireActive — that game-level flag is deleted at attack-declare
    // time (see the autofire setup block that pushes 'autofire_chain' into
    // bonusSurgeAbilities), so reading it here would always miss.
    if (combat.autofireAttack) {
      pool.push('white');
      await thread.send('**Autofire** — Defender adds 1 white die to defense pool.').catch(discordCatch);
    }
    // Barrage (CT-1701) second attack: defender adds 1 white die
    if (combat.barrageAttack) {
      pool.push('white');
      await thread.send('**Barrage** — Defender adds 1 white die to defense pool (second attack).').catch(discordCatch);
    }
    // Generalized defender-die pick (alexanbv 2026-05-11) — uses FULL
    // pool (base + bonus, e.g. AT-ST + Barrage = bbw).
    const _defRemoveMaxRaw = combat.defensePoolRemoveAll ? pool.length : (combat.defensePoolRemoveMax || 0);
    const _defPicksNeeded = Math.min(_defRemoveMaxRaw, pool.length > 1 ? pool.length : 0);
    if (_defPicksNeeded > 0 && !Array.isArray(combat._defPickRemoveIdxList)) {
      await _postDefenseDieRemovePicker(thread, game, combat, pool, _defPicksNeeded);
      await interaction.followUp({ content: `⏳ Pick ${_defPicksNeeded} defense die${_defPicksNeeded > 1 ? 's' : ''} to remove from the defense pool — see the picker prompt.`, ephemeral: true }).catch(discordCatch);
      saveGames(game.gameId);
      return;
    }
    const removeMax = _defRemoveMaxRaw;
    const removeCount = Math.min(removeMax, pool.length);
    let diceToRoll;
    if (Array.isArray(combat._defPickRemoveIdxList) && combat._defPickRemoveIdxList.length > 0 && pool.length > 1) {
      const _drop = new Set(combat._defPickRemoveIdxList);
      diceToRoll = pool.filter((_, i) => !_drop.has(i));
    } else {
      diceToRoll = pool.slice(0, pool.length - removeCount);
    }
    const defDiceResults = [];
    let block = 0, evade = 0, dodge = 0;
    for (const color of diceToRoll) {
      const r = rollDefenseDice(color);
      defDiceResults.push(r);
      block += r.block;
      evade += r.evade;
      if (r.dodge) dodge += 1;
    }
    combat.defenseRoll = { block, evade, dodge };
    combat.defenseDiceResults = defDiceResults;
    combat.defenseDiceCount = diceToRoll.length;
    const dodgeText = dodge ? ' **DODGE!**' : '';
    const _defRollerName = getPlayerDisplayName(game, defenderPlayerNum, interaction.client);
    const _defRollContent = `🛡️ **${_defRollerName}** rolled defense — **${block}** block, **${evade}** evade${dodgeText}`;
    const _defRollImg = await renderDefenseDiceImage(defDiceResults).catch(() => null);
    if (_defRollImg) {
      await thread.send({ content: _defRollContent, files: [new AttachmentBuilder(_defRollImg, { name: 'defense-roll.png' })] }).catch(discordCatch);
    } else {
      const diceDetail = defDiceResults.map((d) => `${d.color}(${d.block}b/${d.evade}e${d.dodge ? '/dodge' : ''})`).join(', ');
      await thread.send(`${_defRollContent}  [${diceDetail}]`).catch(discordCatch);
    }

    // There Is No Try (TINT). The card reads "when a friendly REBEL FORCE USER
    // within 4 spaces rolls ANY NUMBER OF DICE" — so it covers the ATTACK roll
    // as well as the defense roll. It used to offer defense dice only, so
    // playing it on an attack did nothing (alexanbv 2026-08-31: "Yoda CC works
    // for attack or defense"). Both pools are rolled by this point, so both are
    // offered here, each gated on ITS OWN roller being a friendly REBEL FORCE
    // USER of the There Is No Try player.
    //
    // NOTE: the "within 4 spaces of Yoda" clause is still not enforced, here or
    // before — pre-existing, called out rather than silently carried.
    if (game.thereIsNoTryPlayerNum && !combat.tintResolved) {
      const _tintPn = game.thereIsNoTryPlayerNum;
      // "within 4 spaces" is measured from the Yoda that played the card. This
      // was not enforced at all before 2026-08-31, so any friendly REBEL FORCE
      // USER qualified from anywhere on the board.
      // NOTE: _csRawMs / _csClosedDoorEdges belong to handleAttackTarget, NOT to
      // this function — reaching for them here would be a ReferenceError at
      // runtime that no import smoke test would catch. Read the map locally.
      const _tintMapId = game.selectedMap?.id;
      const _tintMapSpaces = _tintMapId ? getMapData(_tintMapId) : null;
      const _tintYodaFk = resolveThereIsNoTrySourceFigure(game, _tintPn, dcNameFromFigureKey);
      const _tintYodaPos = _tintYodaFk ? game.figurePositions?.[_tintPn]?.[_tintYodaFk] : null;
      const _tintEligible = (figureKey) => {
        const _n = dcNameFromFigureKey(figureKey || '');
        if (!_n) return false;
        const _st = ctx.getDcStats?.(_n) || {};
        const _kws = [...(_st.keywords || []), ...(_st.traits || [])];
        if (!thereIsNoTryRollerEligible(_kws)) return false;
        // No Yoda on the board (defeated, or a pre-existing save with no
        // recorded source) means no anchor to measure from, so no ability.
        if (!_tintYodaPos || !_tintMapSpaces) return false;
        const _rollerPos = game.figurePositions?.[_tintPn]?.[figureKey];
        if (!_rollerPos) return false;
        return thereIsNoTryInRange(countSpaces(_tintMapSpaces, _tintYodaPos, _rollerPos, getClosedDoorEdges(game), 50, game));
      };
      const _tintIsRebelForceUser = _tintEligible;
      const _tintBtns = [];
      // Defense dice — offered when the DEFENDER is the TINT player's REBEL FORCE USER.
      if (defenderPlayerNum === _tintPn && _tintIsRebelForceUser(combat.target?.figureKey)) {
        (combat.defenseDiceResults || []).forEach((d, i) => {
          _tintBtns.push(new ButtonBuilder()
            .setCustomId(`there_is_no_try_die_${gameId}_defense_${i}`)
            .setLabel(`Def #${i + 1}: ${d.block}B/${d.evade}E${d.dodge ? '/Dodge' : ''}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary));
        });
      }
      // Attack dice — offered when the ATTACKER is the TINT player's REBEL FORCE USER.
      if (attackerPlayerNum === _tintPn && _tintIsRebelForceUser(combat.attackerFigureKey)) {
        (combat.attackDiceResults || []).forEach((d, i) => {
          _tintBtns.push(new ButtonBuilder()
            .setCustomId(`there_is_no_try_die_${gameId}_attack_${i}`)
            .setLabel(`Atk #${i + 1}: ${d.dmg || 0}d/${d.surge || 0}s/${d.acc || 0}a`.slice(0, 80))
            .setStyle(ButtonStyle.Primary));
        });
      }
      if (_tintBtns.length) {
        setPendingThereIsNoTry(game, { defenderPlayerNum, playerNum: _tintPn });
        _tintBtns.push(new ButtonBuilder().setCustomId(`there_is_no_try_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({ content: `**There Is No Try** — <@${game[`player${_tintPn}Id`] ?? ''}> choose a die to turn to any other side:`, components: chunkButtonsToRows(_tintBtns) }).catch(discordCatch);
        saveGames(game.gameId);
        return; // Wait for TINT response before entering reroll window
      }
    }

    // Legacy per-side reroll-index trackers (the gate uses _rerolledDieIds);
    // initialized here for any legacy-handler back-compat.
    combat.attackerRerolledIndices = [];
    combat.defenderRerolledIndices = [];
    // Roll is complete → advance the sequence to the rerolls window.
    await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
    saveGames(game.gameId);
    return;
  }
  saveGames(game.gameId);
}

/** Chunk buttons into ActionRows of up to 5 (Discord limit). Max 5 rows = 25 buttons. */
function buildActionRows(buttons) {
  return chunkButtonsToRows(buttons);
}

/**
 * Send a "you have N reaction card(s) playable now" notice to the player's
 * private Hand channel. Posting this in the combat thread leaks information —
 * the opponent can infer card availability and adjust play. Hand channels are
 * permission-restricted to the owner so the prompt stays private.
 *
 * Falls back silently if the hand channel is unreachable; the player can
 * still see playable cards in the Hand channel UI itself.
 */
async function sendPrivateReactionPrompt(client, game, playerNum, count, contextLabel) {
  if (!count || count <= 0) return;
  const handId = getHandChannelId(game, playerNum);
  if (!handId) return;
  try {
    const handCh = await fetchGameChannel(client, handId);
    const ownerId = getPlayerId(game, playerNum);
    const ctx = contextLabel ? ` (${contextLabel})` : '';
    await handCh.send(sanitizeMentions({
      content: `<@${ownerId}> — You have **${count}** reaction card(s) playable now${ctx}. Check your hand below.`,
      allowedMentions: { users: [ownerId] },
    })).catch(discordCatch);
  } catch (err) {
    console.error('sendPrivateReactionPrompt: hand channel unreachable', err?.message ?? err);
  }
}

/**
 * One die per row layout for reroll UI: each die button on its own row so
 * the dice values are easy to read top-to-bottom. Trailing control buttons
 * (Done / Skip / Cross Training) share the final row.
 *
 * Discord caps message components at 5 rows × 5 buttons. When dice count
 * would exceed 4 rows (leaving 1 for controls), we fall back to packed
 * rows so all buttons remain reachable.
 */
function buildRerollRows(dieButtons, trailingButtons) {
  const trailing = trailingButtons || [];
  const MAX_ROWS = 5;
  const rows = [];
  if (dieButtons.length <= MAX_ROWS - (trailing.length > 0 ? 1 : 0)) {
    for (const btn of dieButtons) rows.push(new ActionRowBuilder().addComponents(btn));
    if (trailing.length > 0) rows.push(new ActionRowBuilder().addComponents(...trailing.slice(0, 5)));
    return rows;
  }
  // Fallback: pack dice into rows of 5, reserve last row for trailing controls
  for (let i = 0; i < dieButtons.length; i += 5) {
    if (rows.length >= MAX_ROWS - (trailing.length > 0 ? 1 : 0)) break;
    rows.push(new ActionRowBuilder().addComponents(...dieButtons.slice(i, i + 5)));
  }
  if (trailing.length > 0 && rows.length < MAX_ROWS) {
    rows.push(new ActionRowBuilder().addComponents(...trailing.slice(0, 5)));
  }
  return rows;
}

/** Format individual dice for display in reroll UI */
function formatAttackDie(d, i) {
  return `${d.color} #${i + 1}: ${d.acc}acc/${d.dmg}dmg/${d.surge}surge`;
}
function formatDefenseDie(d, i) {
  return `${d.color} #${i + 1}: ${d.block}blk/${d.evade}evd${d.dodge ? '/DODGE' : ''}`;
}

/**
 * Helper (alexanbv 2026-05-13): count unused reroll-queue entries
 * controlled by a player and applicable to a given die pool. Replaces
 * the deprecated combat.attackerRerollsRemaining / defenderRerollsRemaining
 * count fields after the unified-reroll refactor.
 *
 * @param {object} combat - game.pendingCombat
 * @param {number} controlPlayer - 1 or 2
 * @param {'attack'|'defense'} pool - which die pool to consider
 * @returns {number} sum of remaining uses across matching queue entries
 */
/**
 * Per alexanbv 2026-05-13: when a forcedRerollQueue entry is consumed
 * (player actually rerolled a die), fire any deferred exhaust or
 * deplete side-effects encoded on the entry. Skipping the reroll via
 * Continue leaves the source card unspent — abilities
 * should NEVER auto-use.
 *
 * Supported side-effect shapes on the entry:
 *   - exhaustAttachment: { msgId, name } — exhausts a specific
 *     skirmish-upgrade attachment on the DC at msgId.
 *   - depleteDc: { msgId, playerNum } — depletes the DC card itself.
 *
 * @param {object} game
 * @param {object} entry - the queue entry just consumed
 * @param {object|null} thread - combat thread (optional, for log)
 */
async function _fireExhaustOnConsume(game, entry, thread) {
  if (!entry) return;
  if (entry.exhaustAttachment && entry.exhaustAttachment.msgId && entry.exhaustAttachment.name) {
    const _msgId = entry.exhaustAttachment.msgId;
    const _name = entry.exhaustAttachment.name;
    if (exhaustAttachment(game, _msgId, _name) && thread) {
      await thread.send(`**${_name}** — Attachment exhausted on use.`).catch(() => {});
    }
  }
  if (entry.depleteDc && entry.depleteDc.msgId && entry.depleteDc.playerNum) {
    depleteDc(game, entry.depleteDc.msgId, entry.depleteDc.playerNum);
  }
}

/**
 * Per alexanbv 2026-05-13: Merciless (HK Assassin Droid Elite) is an
 * on-declare ability the ATTACKER controls. Card text: "When you
 * declare an attack, if the defender has any HARMFUL conditions, it
 * suffers 1 Damage." Surfaces as a "Use Merciless" button in the
 * attacker's on-declare window. Click → re-check defender has a
 * HARMFUL condition (skip if not — mid-window changes respected) →
 * apply 1 Damage via the pipeline → mark used.
 *
 * Skip button: `merciless_skip_<gameId>` records the player's
 * decision so the bucket button doesn't re-render after a sub-window
 * re-entry. The ability stays unused for the rest of the attack.
 */
export async function handleMerciless(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames, client, dcHealthState, logGameAction } = ctx;
  const isUse = interaction.customId.startsWith('merciless_use_');
  const isSkip = interaction.customId.startsWith('merciless_skip_');
  const gameId = parseCustomId(interaction.customId, isUse ? 'merciless_use_' : 'merciless_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || !combat.mercilessAvailable) {
    await interaction.followUp({ content: 'Merciless is no longer available.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _mercInfo = combat.mercilessAvailable;
  if (!await requirePlayer(interaction, game, interaction.user.id, _mercInfo.attackerPlayerNum, canActAsPlayer, 'Only the attacker can resolve Merciless.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  try {
    const _disabledRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (_disabledRows.length > 0) await interaction.message.edit({ components: _disabledRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (isSkip) {
    combat.mercilessUsed = true; // record decision; ability won't re-prompt
    delete combat.mercilessAvailable;
    if (thread) await thread.send('**Merciless** — Skipped.').catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Re-check HARMFUL condition at click time — mid-window effects may
  // have added or removed conditions.
  const _mercConds = game.figureConditions?.[_mercInfo.targetFigureKey] || [];
  const _mercHarmful = ['Bleed', 'Stun', 'Weaken'].some(c => _mercConds.includes(c));
  if (!_mercHarmful) {
    combat.mercilessUsed = true;
    delete combat.mercilessAvailable;
    if (thread) await thread.send(`**Merciless** — Defender no longer has a HARMFUL condition; ability has no effect.`).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  const _mercFkMatch = _mercInfo.targetFigureKey.match(/-(\d+)-(\d+)$/);
  const _mercFigIdx = _mercFkMatch ? parseInt(_mercFkMatch[2], 10) : 0;
  await _applyDamage(game, { dcHealthState, logGameAction, client }, {
    figureKey: _mercInfo.targetFigureKey,
    msgId: _mercInfo.targetMsgId,
    figIndex: _mercFigIdx,
    amount: 1,
    controllerPlayerNum: _mercInfo.defenderPlayerNum,
    attackerPlayerNum: _mercInfo.attackerPlayerNum,
    source: 'Merciless',
  });
  if (logGameAction) await logGameAction(game, client, `⚡ **Merciless** — **${_mercInfo.targetLabel}** suffers 1 Damage (has HARMFUL condition).`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  if (thread) await thread.send(`⚡ **Merciless** — **${_mercInfo.targetLabel}** suffers 1 Damage.`).catch(discordCatch);
  combat.mercilessUsed = true;
  delete combat.mercilessAvailable;
  saveGames(game.gameId);
}

/**
 * Keep the Peace (Wing Guard REGULAR) gate — the defender's optional Strain
 * exchange. `ktpreg_use_<gameId>` makes the DEFENDER suffer 1 Strain and, if
 * successful, the ATTACKER suffers 1 Strain too. `ktpreg_skip_<gameId>` declines.
 * Once-per-attack: combat._ktpRegularUsed is set on resolve so it cannot re-fire.
 * Routed through applyStrain on BOTH figures so the per-strain CC-discard /
 * Headhunter prompts fire. alexanbv 2026-06-26 (audit fix).
 *
 * NOTE: requires registration in src/handlers/index.js (the interaction router):
 *   register('ktpreg_use_',  handleKtpRegularGate, 'combat');
 *   register('ktpreg_skip_', handleKtpRegularGate, 'combat');
 * (index.js is outside this change's editable scope — see the task report.)
 */
export async function handleKtpRegularGate(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const isUse = interaction.customId.startsWith('ktpreg_use_');
  const gameId = parseCustomId(interaction.customId, isUse ? 'ktpreg_use_' : 'ktpreg_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  const ktp = combat?._ktpRegular;
  if (!combat || !ktp || combat._ktpRegularUsed) {
    await interaction.followUp({ content: 'Keep the Peace is no longer available.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, ktp.defenderPlayerNum, canActAsPlayer, 'Only the defender may resolve Keep the Peace.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  // Disable the buttons so the choice can't be repeated.
  try {
    const _disabledRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) newRow.addComponents(ButtonBuilder.from(c).setDisabled(true));
      return newRow;
    });
    if (_disabledRows.length > 0) await interaction.message.edit({ components: _disabledRows }).catch(discordCatch);
  } catch { /* non-fatal */ }
  // Mark used FIRST so a re-entrant strain prompt can't re-trigger this gate.
  combat._ktpRegularUsed = true;
  delete combat._ktpRegular;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!isUse) {
    if (thread) await thread.send('**Keep the Peace** — Skipped.').catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // Defender suffers 1 Strain; if they do, the attacker suffers 1 Strain too.
  await applyStrain(game, ctx, {
    figureKey: ktp.defenderFigureKey,
    controllerPlayerNum: ktp.defenderPlayerNum,
    amount: 1,
    source: `Keep the Peace (${ktp.dcName})`,
  });
  await applyStrain(game, ctx, {
    figureKey: ktp.attackerFigureKey,
    controllerPlayerNum: ktp.attackerPlayerNum,
    amount: 1,
    source: `Keep the Peace (${ktp.dcName})`,
  });
  if (thread) await thread.send(`**Keep the Peace** (${ktp.dcName}) — defender suffered 1 Strain; the attacker suffers 1 Strain.`).catch(discordCatch);
  saveGames(game.gameId);
}

/**
 * Flawless Execution (Cad Bane) — already-Focused branch picker.
 *
 * Per alexanbv 2026-05-13: Cad Bane chooses the extra die color AND
 * the power token type. Each runs on a separate button click so the
 * two choices are independent.
 *
 * Buttons:
 *   flawless_die_<gameId>_<color>     → add an attack die of the chosen color
 *   flawless_token_<gameId>_<type>    → grant a Damage/Surge/Block/Evade token
 *
 * Each click is one-shot (gated by combat.pendingFlawlessExecution flags
 * dieChosen / tokenChosen) so the player can't double-tap.
 */
export async function handleFlawlessDie(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const rest = parseCustomId(interaction.customId, 'flawless_die_');
  const [gameId, color] = rest.split('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingFlawlessExecution;
  if (!pending) {
    await interaction.followUp({ content: 'No pending Flawless Execution.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick.')) return;
  if (pending.dieChosen) {
    await interaction.followUp({ content: 'Already picked the extra die.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  const validColors = ['red', 'blue', 'green', 'yellow'];
  if (!validColors.includes(color)) return;
  if (game.pendingCombat) {
    game.pendingCombat.attackInfo = {
      ...game.pendingCombat.attackInfo,
      dice: [...(game.pendingCombat.attackInfo.dice || []), color],
    };
  }
  pending.dieChosen = color;
  await interaction.channel.send(`**Flawless Execution** — Added 1 **${color}** attack die.`).catch(discordCatch);
  // If both picks done, clear pending. (Token picker can fire in any order.)
  if (pending.dieChosen && pending.tokenChosen) delete game.pendingFlawlessExecution;
  saveGames(game.gameId);
}

export async function handleFlawlessToken(interaction, ctx) {
  const { getGame, saveGames, logGameAction, client } = ctx;
  const rest = parseCustomId(interaction.customId, 'flawless_token_');
  const [gameId, typeLower] = rest.split('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingFlawlessExecution;
  if (!pending) {
    await interaction.followUp({ content: 'No pending Flawless Execution.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick.')) return;
  if (pending.tokenChosen) {
    await interaction.followUp({ content: 'Already picked the power token.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  const typeMap = { damage: 'Damage', surge: 'Surge', block: 'Block', evade: 'Evade' };
  const tokenType = typeMap[typeLower];
  if (!tokenType) return;
  // Route through grantPowerTokens so the >2 cap / overflow-discard (and Migs's
  // cap of 3) apply uniformly (alexanbv 2026-06-22 gain-PT pipeline).
  grantPowerTokens(game, pending.attackerFigureKey, tokenType, 1);
  pending.tokenChosen = tokenType;
  await interaction.channel.send(`**Flawless Execution** — Cad Bane gains 1 **${tokenType}** token (may be spent immediately on this attack).`).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `**Flawless Execution** — +1 ${tokenType} token to Cad Bane.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  if (pending.dieChosen && pending.tokenChosen) delete game.pendingFlawlessExecution;
  // If gaining the token pushed the figure over its cap, prompt the discard-down.
  if (game.pendingPowerTokenOverflow?.length) {
    await sendPowerTokenOverflowUI(game, game.gameId, interaction.channel, pending.attackerPlayerNum, saveGames).catch(discordCatch);
  }
  saveGames(game.gameId);
}

/**
 * Per alexanbv 2026-05-13: shared post-reroll trigger helper. The
 * legacy voluntary-reroll decrement path (lines ~4830) and the
 * controlled-reroll sub-picker path (lines ~4700) both need to fire:
 *   - Advanced Targeting Computer (Dark Trooper Mk III): rerolled
 *     atk die has fewer Hits → +1 Damage, limit once per attack.
 *   - Tough Luck eligibility prompt: per CRR + alexanbv 2026-05-13,
 *     EITHER the die's owner OR the player who caused the reroll
 *     may play Tough Luck on the rerolled die.
 *
 * Without this helper the sub-picker path would skip both triggers,
 * silently dropping ATC's conditional bonus and the rerolling
 * player's Tough Luck window.
 */
async function _fireAttackerPostRerollTriggers({ game, combat, thread, ctx, gameId, oldDie, newDie, idx, attackerPlayerNum, defenderPlayerNum, abilityHolderPN }) {
  // Advanced Targeting Computer (atk-side, limit 1/attack)
  if (!combat.advTcBonusApplied) {
    try {
      const _atcDcEff = ctx?.getDcEffects ? ctx.getDcEffects() : {};
      const _atcDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
      const _atcEff = _atcDcEff[_atcDcName] || _atcDcEff[_atcDcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (hasAdvTargetingComputerAbility(_atcEff?.specialAbilityIds || [])) {
        if (advTcRerollLostHits(oldDie, newDie)) {
          const _atcBonus = applyAdvTcHitBonus(combat);
          combat.bonusHits = _atcBonus.bonusHits;
          combat.advTcBonusApplied = true;
          if (thread) await thread.send('**Advanced Targeting Computer** — Rerolled die has fewer Hits: +1 Damage applied.').catch(() => {});
        }
      }
    } catch { /* non-fatal */ }
  }
  // Tough Luck is now handled exclusively by the discrete gate reaction
  // (_offerToughLuck → tlgate_* in the gate reroll path), NOT here. The old
  // round-long game.toughLuckPlayerNum offer was removed 2026-06-18 — Tough Luck
  // is a one-shot post-reroll reaction consumed from hand, not a round arm.
}

function _countQueueRerollsForSide(combat, controlPlayer, pool) {
  if (!combat) return 0;
  const queueCount = (combat.forcedRerollQueue || [])
    .filter(e => e.controlPlayer === controlPlayer && (e.pool === pool || e.pool === 'any'))
    .reduce((n, e) => n + Math.max(0, e.remaining ?? 0), 0);
  // Back-compat (alexanbv 2026-05-13): tests and a handful of legacy
  // callers still set combat.attackerRerollsRemaining /
  // defenderRerollsRemaining directly without populating the queue.
  // Treat any positive legacy count as an additional available
  // reroll so those paths continue to function during the migration.
  // Will be removed once tests are rewritten to use queue entries.
  const atkPN = combat.attackerPlayerNum || 1;
  if (controlPlayer === atkPN && pool === 'attack') {
    return queueCount + Math.max(0, combat.attackerRerollsRemaining ?? 0);
  }
  const defPN = combat.defenderPlayerNum ?? (atkPN === 1 ? 2 : 1);
  if (controlPlayer === defPN && pool === 'defense') {
    return queueCount + Math.max(0, combat.defenderRerollsRemaining ?? 0);
  }
  return queueCount;
}

/** Show reroll UI for the current phase (attacker or defender) */
/**
 * Post a Y/N prompt asking whether the player wants to reroll, before
 * showing the dice picker. Per Destruct's UX request — clearer
 * signposting per CRR step 3 (Rerolls). Returns true if the prompt was
 * sent (caller should return); false to fall through to the picker.
 *
 * Skips the prompt for forced rerolls (they're not optional) and for
 * pre-reroll abilities (they have their own prompt format).
 */
/**
 * Per alexanbv 2026-05-13: step-3 reroll abilities are classified as
 * either SIMPLE (just grant +1 reroll — folded into
 * attackerRerollsRemaining / defenderRerollsRemaining as a die-pick)
 * or COMPLEX (have player choices — render as their own "Use X"
 * button in the holder's bucket). Complex abilities are tracked on
 * combat.rerollAbilities[name] = { playerNum, used }.
 *
 * Bucket routing: each complex ability surfaces in the bucket of the
 * side that holds it (attacker or defender). Resourceful (Lando) can
 * be either — routed by the playerNum stored on the ability entry.
 */
const _REROLL_ABILITY_LABELS = {
  twinSabers: 'Use Twin Sabers',
  resourceful: 'Use Resourceful',
  shrewdScoundrel: 'Use Shrewd Scoundrel',
  trained: 'Use Trained',
  powerConverter: 'Use Power Converter (Saska)',
};

function _countUnusedRerollAbilitiesForPlayer(combat, playerNum) {
  const abilities = combat.rerollAbilities || {};
  let count = 0;
  for (const key of Object.keys(_REROLL_ABILITY_LABELS)) {
    const ab = abilities[key];
    if (!ab || ab.used) continue;
    if (ab.playerNum !== playerNum) continue;
    count += 1;
  }
  return count;
}

function _appendRerollAbilityButtonsForPlayer(gameId, combat, playerNum, buttons) {
  const abilities = combat.rerollAbilities || {};
  let added = 0;
  for (const [key, label] of Object.entries(_REROLL_ABILITY_LABELS)) {
    const ab = abilities[key];
    if (!ab || ab.used) continue;
    if (ab.playerNum !== playerNum) continue;
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pre_reroll_${gameId}_open_${key}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary),
    );
    added += 1;
  }
  return added;
}

// Backwards-compatible attacker-side helpers (callers in
// combat-reactions.js + the attacker bucket use these wrappers).
function _countUnusedAttackerRerollAbilities(combat) {
  return _countUnusedRerollAbilitiesForPlayer(combat, combat.attackerPlayerNum || 1);
}
function _appendAttackerRerollAbilityButtons(gameId, combat, buttons) {
  return _appendRerollAbilityButtonsForPlayer(gameId, combat, combat.attackerPlayerNum || 1, buttons);
}



// _advancePreRerollChain retired 2026-05-13. Per alexanbv: there is no
// pre-reroll queue — step-3 reroll abilities live as buttons inside the
// attacker bucket and resolution returns to that same bucket via
// sendRerollUI(... 'attacker'). The legacy chain advanced through a
// sequential pendingPreRerolls queue, which forced a fixed order; the
// bucket renderer iterates combat.rerollAbilities directly so the
// player picks any order.

// Delegate to src/game/spatial.js (canonical implementation)
const isWithinSpaces = _isWithinSpaces;

// --- DC passive stat helpers ---

/**
 * Parse the dc-effects.json `passives` array for a figure and apply printed
 * card stat bonuses to the pending combat object.
 *
 * Attacker bonuses: +N Hit, +N Accuracy, Pierce N, +N Surge, Blast N
 * Defender bonuses: Block N, +N Evade
 * Combined entries (e.g. "+1 Damage, +1 Accuracy, +1 Block") split by comma —
 * each part is applied to whichever role is relevant.
 */
function applyDcPassivesToCombat(combat, attackerPassives, defenderPassives, dcNames = {}) {
  const { defenderDcName = '' } = dcNames;
  const parts = (str) => str.split(',').map((s) => s.trim().toLowerCase());

  for (const passive of (attackerPassives || [])) {
    for (const p of parts(passive)) {
      const hit  = p.match(/^\+(\d+)\s+hit(s?)$/);   if (hit)    { combat.bonusHits      = (combat.bonusHits      || 0) + parseInt(hit[1],    10); continue; }
      // "+N Damage" passive (Tusken Raider Elite, etc.) — IACP treats
      // this as a static result-side hit bonus. Wired identically to
      // "+N hit" per alexanbv 2026-05-11 verification.
      const dmg  = p.match(/^\+(\d+)\s+damage$/);     if (dmg)    { combat.bonusHits      = (combat.bonusHits      || 0) + parseInt(dmg[1],    10); continue; }
      const acc  = p.match(/^\+(\d+)\s+accur/);       if (acc)    { combat.bonusAccuracy  = (combat.bonusAccuracy  || 0) + parseInt(acc[1],    10); continue; }
      const pier = p.match(/^pierce\s+(\d+)$/i);      if (pier)   { combat.bonusPierce    = (combat.bonusPierce    || 0) + parseInt(pier[1],   10); continue; }
      const surg = p.match(/^\+(\d+)\s+surge$/);      if (surg)   { combat.surgeBonus     = (combat.surgeBonus     || 0) + parseInt(surg[1],   10); continue; }
      const blas = p.match(/^blast\s+(\d+)$/);        if (blas)   { combat.bonusBlast     = (combat.bonusBlast     || 0) + parseInt(blas[1],   10); continue; }
      const clv  = p.match(/^cleave\s+(\d+)$/);       if (clv)    { const _cv = parseInt(clv[1], 10); combat.passiveCleave  = (combat.passiveCleave  || 0) + _cv; (combat.cleaveSources = combat.cleaveSources || []).push({ value: _cv, label: `Cleave ${_cv} (passive)` }); continue; }
      if (p === 'bleed')        { combat.bonusConditions = (combat.bonusConditions || []).concat(['Bleed']); continue; }
      if (p === 'professional') { combat.rerollOneAttackDie = (combat.rerollOneAttackDie || 0) + 1; combat._professionalPassivePushed = true; continue; }
    }
  }

  for (const passive of (defenderPassives || [])) {
    for (const p of parts(passive)) {
      const blk  = p.match(/^(?:block\s+(\d+)|\+(\d+)\s+block)$/i);
      if (blk) {
        const _blkAmt = parseInt(blk[1] ?? blk[2], 10);
        combat.bonusBlock = (combat.bonusBlock || 0) + _blkAmt;
        if (defenderDcName) {
          combat.bonusBlockSources = combat.bonusBlockSources || [];
          combat.bonusBlockSources.push({ label: defenderDcName, amount: _blkAmt, type: 'innate' });
        }
        continue;
      }
      const evd  = p.match(/^\+(\d+)\s+evade$/);
      if (evd) {
        const _evdAmt = parseInt(evd[1], 10);
        combat.bonusEvade = (combat.bonusEvade || 0) + _evdAmt;
        if (defenderDcName) {
          combat.bonusEvadeSources = combat.bonusEvadeSources || [];
          combat.bonusEvadeSources.push({ label: defenderDcName, amount: _evdAmt, type: 'innate' });
        }
        continue;
      }
      // Professional is "While attacking, reroll 1 attack die" — attack-only.
      // Removed defender-side branch 2026-05-06 per destruct's clarification:
      // it incorrectly granted defense rerolls to figures (Royal Guard etc.)
      // who only get the bonus while attacking.
    }
  }
}

// --- Power token helpers ---

/** Returns [{type, index}] of tokens the role is allowed to spend.
 *  Per destruct 2026-05-08: attackers spend Damage/Surge only, defenders
 *  spend Block/Evade only. Wild tokens are a gain-time selector (CRR
 *  p.50) and never persist as a stored type — excluded from allowed
 *  list. */
function getEligibleTokens(game, figureKey, role) {
  const allowed = role === 'attacker' ? ['Damage', 'Surge'] : ['Block', 'Evade'];
  return (game.figurePowerTokens?.[figureKey] || [])
    .map((type, index) => ({ type, index }))
    .filter(t => allowed.includes(t.type));
}

/**
 * Squad Cohesion (Ko-Tun Feralo): gather spendable tokens from nearby friendly REBEL figures.
 * Returns { cohesionTokens: [{type, index, figureKey, ownerName}], announced: bool }
 * or null if Squad Cohesion is not active for this combat figure.
 *
 * Condition: Ko-Tun must be alive on the same team, the combat figure must be REBEL and
 * within 3 spaces of Ko-Tun, and donor figures must be REBEL and within 3 spaces of
 * the combat figure.
 */
function getSquadCohesionTokens(game, combat, role) {
  const combatFigureKey = role === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
  if (!combatFigureKey) return null;
  const playerNum = role === 'attacker' ? combat.attackerPlayerNum : (combat.target?.playerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
  const friendlyPos = game.figurePositions?.[playerNum] || {};
  const combatPos = friendlyPos[combatFigureKey];
  if (!combatPos) return null;

  const dcEff = getDcEffectsGlobal();
  const combatDcName = dcNameFromFigureKey(combatFigureKey);
  const combatEff = dcEff[combatDcName] || dcEff[combatDcName?.replace(/\s*\[.*\]\s*$/, '')];
  // The combat figure must be a REBEL
  if (String(combatEff?.affiliation || '').toLowerCase() !== 'rebel') return null;

  const mapSp = getMapData(game.selectedMap?.id);
  if (!mapSp) return null;
  const combatPosLc = String(combatPos).toLowerCase();
  const _scBlockedEdges = getClosedDoorEdges(game);

  // Find Ko-Tun on the same team with squad_cohesion_kotun
  let koTunInRange = false;
  for (const [fk, pos] of Object.entries(friendlyPos)) {
    if (fk === combatFigureKey) continue;
    const fDcName = dcNameFromFigureKey(fk);
    const fEff = dcEff[fDcName] || dcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(fEff?.specialAbilityIds || []).includes('squad_cohesion_kotun')) continue;
    if (isWithinSpaces(mapSp, String(pos).toLowerCase(), combatPosLc, 3, _scBlockedEdges, game)) {
      koTunInRange = true;
      break;
    }
  }
  if (!koTunInRange) return null;

  // Gather tokens from friendly REBEL figures within 3 spaces of the combat figure
  // Per destruct 2026-05-08: attackers spend Damage/Surge only, defenders
  // spend Block/Evade only. 'Wild' is a gain-time selector (CRR p.50)
  // and never persists in figurePowerTokens at runtime — removed from
  // the allowed list to match the canonical token spend rules.
  const allowed = role === 'attacker' ? ['Damage', 'Surge'] : ['Block', 'Evade'];
  const cohesionTokens = [];
  for (const [fk, pos] of Object.entries(friendlyPos)) {
    if (fk === combatFigureKey) continue; // skip own tokens (already shown normally)
    const fDcName = dcNameFromFigureKey(fk);
    const fEff = dcEff[fDcName] || dcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (String(fEff?.affiliation || '').toLowerCase() !== 'rebel') continue;
    if (!isWithinSpaces(mapSp, String(pos).toLowerCase(), combatPosLc, 3, _scBlockedEdges, game)) continue;
    const tokens = game.figurePowerTokens?.[fk] || [];
    tokens.forEach((type, index) => {
      if (allowed.includes(type)) {
        cohesionTokens.push({ type, index, figureKey: fk, ownerName: fDcName });
      }
    });
  }
  return cohesionTokens.length > 0 ? { cohesionTokens } : null;
}

/**
 * Sends the spending window with one button per UNIQUE token type
 * (not per token instance — only 1 token can be spent per attack roll
 * per CRR, so duplicates are useless). Buttons match the Extra Armor
 * visual style; clicking a token button highlights it green, disables
 * others, then advances. Skip stays grey.
 */
async function sendTokenWindow(thread, gameId, role, tokens, displayName, combat, ownerId) {
  const prefix = role === 'attacker' ? 'att' : 'def';

  // Dedupe by type; keep the first index per type for the spend lookup.
  const seen = new Map();
  for (const { type, index } of tokens) {
    if (!seen.has(type)) seen.set(type, { type, index, count: 1 });
    else seen.get(type).count += 1;
  }
  const uniqueTokens = [...seen.values()];

  // Per alexanbv 2026-05-13: Wild is gain-time only and never in the
  // bank — the `allowed` filter above excludes it from this list.
  const btns = uniqueTokens.slice(0, 4).map(({ type, index, count }) =>
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_${prefix}_${index}`)
      .setLabel(`Spend ${type}${count > 1 ? ` (have ${count})` : ''}`)
      .setStyle(ButtonStyle.Secondary)
  );

  // Squad Cohesion: tokens borrowed from nearby friendly REBEL figures.
  // Keep these per-figure (different ownership), but dedupe by (type+ownerName).
  const scTokens = combat?.squadCohesionTokens?.[role] || [];
  if (scTokens.length > 0) {
    if (!combat.squadCohesionTokenMap) combat.squadCohesionTokenMap = {};
    const scSeen = new Map();
    scTokens.forEach((sc, scIdx) => {
      const k = `${sc.type}__${sc.ownerName}`;
      if (scSeen.has(k)) return;
      scSeen.set(k, true);
      const scKey = `${prefix}_sc${scIdx}`;
      combat.squadCohesionTokenMap[scKey] = { figureKey: sc.figureKey, tokenIndex: sc.index, type: sc.type, ownerName: sc.ownerName };
      btns.push(
        new ButtonBuilder()
          .setCustomId(`combat_token_${gameId}_${prefix}_sc${scIdx}`)
          .setLabel(`${sc.type} from ${sc.ownerName}`)
          .setStyle(ButtonStyle.Secondary)
      );
    });
  }

  btns.push(
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_${prefix}_skip`)
      .setLabel('Skip (no token)')
      .setStyle(ButtonStyle.Primary)
  );
  const rows = chunkButtonsToRows(btns);
  const mention = ownerId ? `<@${ownerId}> — ` : '';
  let content = `${mention}**Power Token — ${role === 'attacker' ? 'Attacker' : 'Defender'}** (${displayName}): spend one token (max 1 per attack) or skip.`;
  if (scTokens.length > 0) content += '\n*Squad Cohesion (Ko-Tun Feralo): tokens from nearby friendly Rebel figures are also available.*';
  await thread.send({
    content,
    components: rows,
    allowedMentions: ownerId ? { users: [ownerId] } : undefined,
  });
}

/** Sends Wild type selection: attacker picks Hit/Surge; defender picks Block/Evade */
async function sendWildTypeWindow(thread, gameId, role) {
  const types = role === 'attacker' ? ['Damage', 'Surge'] : ['Block', 'Evade'];
  const btns = types.map(t =>
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_wild_${t.toLowerCase()}`)
      .setLabel(`+1 ${t}`)
      .setStyle(ButtonStyle.Secondary)
  );
  await thread.send({
    content: '**Wild token** — Choose which type to apply:',
    components: [new ActionRowBuilder().addComponents(btns)],
  });
}

/**
 * If the given spend qualifies for Krennic's Unhinged Director +1/+2 prompt,
 * set the pending interrupt + send the prompt + return true. Otherwise
 * return false (caller proceeds with normal applyTokenBonus + token spend).
 *
 * Card text: "When a friendly TROOPER or GUARDIAN within 2 spaces spends a
 * Damage Token or Surge Token while declaring an attack, it MAY suffer 1
 * Strain to apply +2 of the chosen symbol instead of +1."
 *
 * Eligibility uses combat.unhingedEligibleSpenders (computed at combat
 * start) so it works for ANY spending figure on the attacker's side, not
 * just the attacker — covering Squad Cohesion and Wild-from-cohesion
 * paths. The strain target = the spending figure.
 */
async function _maybePromptUnhinged(thread, game, gameId, combat, opts) {
  const { tokenType, spenderFigureKey, tokenIndex, atkPlayerNum, isAttacker } = opts;
  if (!isAttacker) return false;
  if (tokenType !== 'Damage' && tokenType !== 'Surge') return false;
  // Eligibility: prefer the precomputed set; fall back to the legacy
  // attackerUnhingedBonus bool for in-flight combats from before the
  // upgrade and for unit-test fixtures that don't seed the set.
  let eligible;
  if (combat.unhingedEligibleSpenders) {
    eligible = combat.unhingedEligibleSpenders.includes(spenderFigureKey);
  } else {
    eligible = !!combat.attackerUnhingedBonus && spenderFigureKey === combat.attackerFigureKey;
  }
  if (!eligible) return false;
  setPendingUnhingedDirector(game, {
    gameId,
    tokenType,
    figureKey: spenderFigureKey,
    tokenIndex,
    atkPlayerNum,
    sourceLabel: opts.sourceLabel || null,
  });
  const _udOwnerId = getPlayerId(game, atkPlayerNum);
  const _udRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`unhinged_director_${gameId}_plus1`)
      .setLabel(`+1 ${tokenType} (free)`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`unhinged_director_${gameId}_plus2`)
      .setLabel(`+2 ${tokenType} (suffer 1 Strain)`)
      .setStyle(ButtonStyle.Danger),
  );
  const _srcLbl = opts.sourceLabel ? ` (${opts.sourceLabel})` : '';
  await thread.send({
    content: `<@${_udOwnerId}> — **Unhinged Director**${_srcLbl} — Spend the **${tokenType}** token: +1 free, or +2 if **${dcNameFromFigureKey(spenderFigureKey)}** suffers 1 Strain?`,
    components: [_udRow],
    allowedMentions: { users: [_udOwnerId].filter(Boolean) },
  }).catch(discordCatch);
  return true;
}

/**
 * Apply token bonus to combat state. Krennic's Unhinged Director triggers
 * "while declaring an attack" (per card text) on Hit or Surge tokens —
 * attacker-side, attack-result only. The +2 effect requires the figure
 * to suffer 1 Strain (player choice).
 *
 * The main-spend path detects Unhinged eligibility before calling this
 * helper and routes through a dedicated prompt + applyUnhingedTokenSpend
 * instead. Wild and Squad-Cohesion paths still call applyTokenBonus
 * directly; for those we default unhingedAllowed=false so the +2 path
 * doesn't fire silently without the player choosing to pay Strain.
 */
function applyTokenBonus(combat, type, isAttacker, opts = {}) {
  const { unhingedAllowed = false } = opts;
  const isAttackResult = type === 'Damage' || type === 'Surge';
  const unhingedActive = isAttacker && combat.attackerUnhingedBonus && unhingedAllowed;
  const bonus = (isAttackResult && unhingedActive) ? 2 : 1;
  if (type === 'Damage') combat.bonusHits  = (combat.bonusHits  || 0) + bonus;
  if (type === 'Surge') combat.tokenSurgeBonus = (combat.tokenSurgeBonus || 0) + bonus;
  if (type === 'Block') combat.bonusBlock = (combat.bonusBlock || 0) + bonus;
  if (type === 'Evade') combat.bonusEvade = (combat.bonusEvade || 0) + bonus;
}

/** Send a 4-button prompt asking the player to choose a power token type (Hit/Surge/Block/Evade) */
export async function sendPowerTokenChoicePrompt(thread, gameId, grants) {
  const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
  const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
  const countLabel = totalCount > 1 ? `${totalCount} tokens` : '1 token';
  const btns = ['Damage', 'Surge', 'Block', 'Evade'].map(t =>
    new ButtonBuilder()
      .setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`)
      .setLabel(t)
      .setStyle(ButtonStyle.Secondary)
  );
  await thread.send({
    content: `**Choose power token type** for **${figNames}** (${countLabel}):`,
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
}

/** Remove token from game.figurePowerTokens by index */
function removeSpentToken(game, figureKey, index) {
  if (!game.figurePowerTokens?.[figureKey]) return;
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey].filter((_, i) => i !== index);
  if (game.figurePowerTokens[figureKey].length === 0) delete game.figurePowerTokens[figureKey];
}

// Air Support (Bodhi Rook) — "When a friendly figure spends a Power Token while
// attacking, apply +2 Accuracy" (only while the attacker is NOT Focused, per
// alexanbv 2026-05-13) — migrated to a gate mods passive ('air_support' →
// _fireModsPassive), gated on combat.attackerSpentPowerToken + unfocused +
// Bodhi-in-play. The token-spend-time _maybeApplyAirSupport calls were removed
// to kill the double handling. alexanbv 2026-06-18.

// --- Rogue One token sharing helpers ---

const ROGUE_ONE_FIGURES = ['Baze Malbus', 'Bodhi Rook', 'Cassian Andor', 'Chirrut Imwe', 'Jyn Erso', 'K-2SO'];

/**
 * Check if Rogue One token sharing is available for the current attacker.
 * Returns an array of { figureKey, dcName, tokenIndex, tokenType } for eligible donor figures,
 * or an empty array if not applicable.
 */
function getRogueOneDonors(game, combat) {
  const attackerPlayerNum = combat.attackerPlayerNum;
  const attackerDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
  if (!ROGUE_ONE_FIGURES.some(name => attackerDcName.includes(name))) return [];
  const dcList = getDcList(game, attackerPlayerNum) || [];
  const hasRogueOne = dcList.some(dc => dc?.dcName?.includes('Rogue One'));
  if (!hasRogueOne) return [];
  const friendlyPositions = game.figurePositions?.[attackerPlayerNum] || {};
  const donors = [];
  for (const fk of Object.keys(friendlyPositions)) {
    if (fk === combat.attackerFigureKey) continue;
    const tokens = game.figurePowerTokens?.[fk] || [];
    for (let i = 0; i < tokens.length; i++) {
      donors.push({ figureKey: fk, dcName: dcNameFromFigureKey(fk), tokenIndex: i, tokenType: tokens[i] });
    }
  }
  return donors;
}

/** Build a single Rogue One button for the surge UI if eligible and donors exist. */
function buildRogueOneSurgeButton(game, combat) {
  const donors = getRogueOneDonors(game, combat);
  if (donors.length === 0) return [];
  return [
    new ButtonBuilder()
      .setCustomId(`combat_surge_${game.gameId}_rogue_one`)
      .setLabel('Rogue One: +1 Damage (discard ally token)')
      .setStyle(ButtonStyle.Success)
  ];
}

/**
 * Advance to next phase: attacker done → check defender; both done → next phase.
 * Pre-roll (no attackRoll yet) → post the Roll Combat Dice button.
 * Post-roll (legacy callers) → continue to passive checks + surge spending.
 */
async function advanceTokenPhase(thread, game, combat, completedRole, ctx) {
  // On-declare merge (destruct 2026-05-08): token spends inside the
  // on_declare per-player window must NOT auto-advance — the player
  // still owns the window and clicks the gate Ready button to hand
  // off. Just clear tokenPhase so further token clicks reject.
  if (combat.onDeclareTokenContext) {
    combat.tokenPhase = null;
    return;
  }
  combat.tokenPhase = null;
  if (completedRole === 'attacker') {
    const defTokens = getEligibleTokens(game, combat.target.figureKey, 'defender');
    const hasDefCohesion = (combat.squadCohesionTokens?.defender || []).length > 0;
    if (defTokens.length > 0 || hasDefCohesion) {
      combat.tokenPhase = 'defender';
      const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
      const defOwnerId = getPlayerId(game, defenderPlayerNum);
      await sendTokenWindow(thread, game.gameId, 'defender', defTokens, combat.target.label, combat, defOwnerId);
      return;
    }
  }
  if (!combat.attackRoll) {
    await postRollDiceButton(thread, game, combat, ctx);
    return;
  }
  await proceedAfterTokens(thread, game, combat, ctx);
}


/**
 * Sequential per-player "Apply on-declare effects? Y/N" prompt (CRR
 * steps 1+2). Per alexanbv 2026-05-12: matches the step-4 sendModsYn
 * format — single Y/N per player, attacker first, sequential.
 *
 * - Yes → posts a "Done with on-declare — continue" button and the
 *   token-spend window inline (so the player has CC + token UI in
 *   their own moment), then advances when they click Continue.
 * - No → immediately advances to the next role (or to the dice roll
 *   when the defender finishes).
 *
 * Replaces the parallel Ready-button gate + auto-posted token window
 * that posted both prompts simultaneously to each player.
 */
// RETIRED in the gate cutover (alexanbv 2026-06-16): sendOnDeclareYn +
// handleCombatOnDeclareYn (the legacy sequential on-declare Y/N chain) are gone.
// Every attack now walks the gate sequence — the on_declare gate window
// (buildOnDeclareGate / handleModsPick) offers on-declare CCs / abilities /
// power tokens before the roll step. The on-declare token spend is
// sendOnDeclareTokenWindow (kept — shared by the gate + recover.js).





/**
 * On-declare merge (destruct 2026-05-08): post the active player's
 * token-spend window inline with their on_declare gate, so cards
 * (played from hand) and tokens land in the SAME window. After the
 * spend is recorded, advanceTokenPhase short-circuits — the player
 * still owns the window until they click the gate Ready button.
 *
 * Sets combat.onDeclareTokenContext = true so handleCombatToken's
 * advance-after-spend is suppressed. Cleared in
 * dispatchCombatGateAdvance('on_declare') when both players ack.
 *
 * Idempotent for same role: safe to call from sendCombatGate(on_declare)
 * AND from the attacker→defender transition in handleCombatGateReady.
 */
export async function sendOnDeclareTokenWindow(thread, game, combat, role, ctx) {
  if (game.selfPlay) return;
  // Vague & Unconvincing (K-2S0): blocks tokens AND cards while defending.
  // Run the prep once per combat — flagged on combat after first call.
  if (!combat._onDeclarePrepared) {
    if (combat.target?.figureKey) {
      const _vuDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const _vuDefDcName = dcNameFromFigureKey(combat.target.figureKey);
      const _vuDefEff = _vuDcEff[_vuDefDcName] || _vuDcEff[(_vuDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      if ((_vuDefEff?.specialAbilityIds || []).includes('vague_and_unconvincing_k2s0')) {
        combat.vagueAndUnconvincing = true;
        await thread.send('**Vague and Unconvincing** — Neither player may spend Power Tokens or play Command Cards during this attack.');
      }
    }
    if (!combat.vagueAndUnconvincing) {
      combat.squadCohesionTokens = combat.squadCohesionTokens || {};
      const scAtk = getSquadCohesionTokens(game, combat, 'attacker');
      if (scAtk) combat.squadCohesionTokens.attacker = scAtk.cohesionTokens;
      const scDef = getSquadCohesionTokens(game, combat, 'defender');
      if (scDef) combat.squadCohesionTokens.defender = scDef.cohesionTokens;
    }
    combat._onDeclarePrepared = true;
  }
  if (combat.vagueAndUnconvincing) return;
  const figKey = role === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
  if (!figKey) return;
  // Per alexanbv 2026-05-10: on-declare die-swap abilities (Vanguard,
  // EE-3 Carbine) fire in step 1/2 of the attack sequence — inside the
  // attacker's on-declare window, alongside on-declare CCs / tokens.
  // Post the picker(s) once per attack BEFORE the token window opens.
  if (role === 'attacker') {
    await _postOnDeclareDieSwapPrompts(thread, game, combat, ctx);
    // Per alexanbv 2026-05-13: Merciless (HK Assassin Elite) is an
    // on-declare ability the attacker controls. Surface as a "Use
    // Merciless" button if eligibility was registered at attack
    // declare (combat.mercilessAvailable). Click re-checks the
    // HARMFUL condition at click time so mid-window changes are
    // respected.
    if (combat.mercilessAvailable && !combat.mercilessUsed) {
      const _mercBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`merciless_use_${game.gameId}`)
          .setLabel(`Use Merciless (1 Damage to ${combat.mercilessAvailable.targetLabel})`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`merciless_skip_${game.gameId}`)
          .setLabel('Skip Merciless')
          .setStyle(ButtonStyle.Secondary),
      );
      const _mercOwnerId = combat.mercilessAvailable.attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
      await thread.send(sanitizeMentions({
        content: `<@${_mercOwnerId}> **Merciless** — On-declare: deal 1 Damage to the defender (currently has HARMFUL condition).`,
        allowedMentions: { users: [_mercOwnerId] },
        components: [_mercBtn],
      })).catch(discordCatch);
    }
  }
  const ownTokens = getEligibleTokens(game, figKey, role);
  const cohesion = (combat.squadCohesionTokens?.[role] || []);
  if (ownTokens.length === 0 && cohesion.length === 0) return;
  const ownerPN = role === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
    : opponentPlayerNum(combat.attackerPlayerNum);
  const ownerId = getPlayerId(game, ownerPN);
  const displayName = role === 'attacker' ? combat.attackerDisplayName : combat.target?.label;
  combat.tokenPhase = role;
  combat.onDeclareTokenContext = true;
  await sendTokenWindow(thread, game.gameId, role, ownTokens, displayName, combat, ownerId);
}

/**
 * Post die-swap picker(s) for on-declare DC abilities (Vanguard, EE-3
 * Carbine). Fires inside the attacker's on-declare window, after target
 * has been declared so range checks are accurate.
 *
 * Per alexanbv 2026-05-10:
 *  - Vanguard (AT-RT): replace one die with red; target must be within 3.
 *  - EE-3 Carbine (Boba Fett): replace one die with red; costs 2 MP;
 *    available only if MP bank >= 2.
 *
 * Buttons modify combat.attackInfo.dice in place; player Ready'ing the
 * gate advances to roll.
 */
async function _postOnDeclareDieSwapPrompts(thread, game, combat, ctx) {
  if (combat._onDeclareDieSwapsPosted) return;
  combat._onDeclareDieSwapsPosted = true;
  const atkMsgId = combat.attackerMsgId;
  if (!atkMsgId) return;
  const dcEffects = ctx?.getDcEffects?.() || {};
  const atkDcName = dcNameFromFigureKey(combat.attackerFigureKey);
  const atkEff = dcEffects[atkDcName] || dcEffects[(atkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  const atkSIds = atkEff?.specialAbilityIds || [];
  const dice = combat.attackInfo?.dice || [];
  const nonRedDice = [...new Set(dice.filter((d) => d !== 'red'))];
  if (nonRedDice.length === 0) return;
  const gameId = game.gameId;
  const distance = combat.distanceAtDeclare ?? combat.target?.distance ?? null;

  // Vanguard (AT-RT): only if target within 3 spaces.
  if (atkSIds.includes('vanguard') && !combat._vanguardOnDeclareDecided && (distance == null || distance <= 3)) {
    const btns = nonRedDice.map((color) =>
      new ButtonBuilder()
        .setCustomId(`od_dieswap_v_${color}_${gameId}`)
        .setLabel(`Vanguard: ${color[0].toUpperCase() + color.slice(1)} → Red`)
        .setStyle(ButtonStyle.Success)
    );
    btns.push(
      new ButtonBuilder()
        .setCustomId(`od_dieswap_v_skip_${gameId}`)
        .setLabel('Skip Vanguard')
        .setStyle(ButtonStyle.Secondary)
    );
    await thread.send({
      content: `**Vanguard** — replace one attack die with Red (target within 3 spaces):`,
      components: chunkButtonsToRows(btns).slice(0, 5),
    }).catch(discordCatch);
  }

  // Front Line (Echo Base Trooper Elite): per alexanbv 2026-05-11 — the
  // blue→red swap is optional. +2 Accuracy fires unconditionally
  // (handled in handleAttackTarget). This prompt only governs the swap.
  if (atkSIds.includes('front_line') && !combat._frontLineSwapDecided && (combat.distanceAtDeclare ?? combat.target?.dist ?? 99) <= 3) {
    const hasBlue = (combat.attackInfo?.dice || []).includes('blue');
    if (hasBlue) {
      const _flBtns = [
        new ButtonBuilder()
          .setCustomId(`od_dieswap_f_swap_${gameId}`)
          .setLabel('Front Line: Swap Blue → Red')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`od_dieswap_f_skip_${gameId}`)
          .setLabel('Skip Front Line swap')
          .setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Front Line** — Target within 3 spaces. May swap 1 blue die for 1 red die (optional):`,
        components: chunkButtonsToRows(_flBtns).slice(0, 5),
      }).catch(discordCatch);
    }
  }

  // EE-3 Carbine (Boba Fett): costs 2 MP. Only offer if bank >= 2.
  if (atkSIds.includes('ee3_carbine') && !combat._ee3OnDeclareDecided) {
    const _ee3FigIdx = parseInt(String(combat.attackerFigureKey || '').split('-').pop(), 10);
    const ee3FigIdx = Number.isInteger(_ee3FigIdx)
      ? _ee3FigIdx
      : (game.dcActionsData?.[atkMsgId]?.selectedFigure ?? 0);
    const mp = figureMpRemaining(game, atkMsgId, ee3FigIdx);
    if (mp >= 2) {
      const btns = nonRedDice.map((color) =>
        new ButtonBuilder()
          .setCustomId(`od_dieswap_e_${color}_${gameId}`)
          .setLabel(`EE-3 (2 MP): ${color[0].toUpperCase() + color.slice(1)} → Red`)
          .setStyle(ButtonStyle.Success)
      );
      btns.push(
        new ButtonBuilder()
          .setCustomId(`od_dieswap_e_skip_${gameId}`)
          .setLabel('Skip EE-3')
          .setStyle(ButtonStyle.Secondary)
      );
      await thread.send({
        content: `**EE-3 Carbine** — spend 2 MP (${mp} available) to replace one attack die with Red:`,
        components: chunkButtonsToRows(btns).slice(0, 5),
      }).catch(discordCatch);
    }
  }
}

// proceedToTokenPhase removed 2026-05-08 per destruct: tokens are now
// merged into the on_declare per-player window via
// sendOnDeclareTokenWindow. The legacy two-step flow (gate ack →
// sequential token windows → roll) is gone. Token window prep that
// used to live here is now inside sendOnDeclareTokenWindow's first-
// call init block (Vague & Unconvincing check + Squad Cohesion gather).

/** Auto-roll both sides' dice without a user click (per Destruct's UX
 * feedback 2026-05-04: "the dice can auto roll, no need for prompt in
 * future"). Reuses handleCombatRoll's existing logic by invoking it
 * twice with synthetic interactions:
 *   - First synth (role=atk): stores combat.attackRoll, no image yet.
 *   - Second synth (role=def): computes defense, posts BOTH images
 *     (Case A flow), runs reroll-window setup, sendCombatGate('post_roll').
 *
 * Safe for every combat now that the previously-blocking abilities have
 * landing pads outside the roll button:
 *   - Vet Instincts (atk) + Guidance Systems → migrated to sendModsYn
 *     (CRR step 4). 2026-05-04 migration.
 *   - Vet Instincts (def), There Is No Try, Doubt SU → fire from inside
 *     the def synth's defense-roll block, and their handlers re-enter
 *     via sendRerollUI / proceedAfterRerolls without needing a re-click.
 */
async function autoRollDice(thread, game, combat, ctx) {
  const atkPN = combat.attackerPlayerNum;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(atkPN);
  // False Orders / Lure: the CONTROLLER rolls the attack — handleCombatRoll's
  // attack-roll permission uses falseOrdersControllerPlayerNum, so the synthesized
  // atk press must carry the controller's id. No-op for normal attacks.
  const atkOwnerId = getPlayerId(game, combat.falseOrdersControllerPlayerNum ?? atkPN);
  const defOwnerId = getPlayerId(game, defPN);
  const gameId = game.gameId;

  const synth = (role, ownerId) => ({
    customId: `combat_roll_${role}_${gameId}`,
    user: { id: ownerId },
    client: ctx.client,
    followUp: async () => {},
    deferUpdate: async () => {},
    message: { components: [], edit: async () => ({}) },
  });

  // First "press" (atk): held early-return path stores combat.attackRoll
  // + computes attackDiceResults; no image posted yet (image posts on
  // the second press, in chronological atk→def order).
  try {
    await handleCombatRoll(synth('atk', atkOwnerId), ctx);
  } catch (err) {
    console.error('[autoRollDice] attack synth failed:', err);
    return;
  }

  // Second "press" (def): enters the !combat.defenseRoll block (Case A
  // flow), which posts the atk image first, computes defense roll, posts
  // the def image, runs the reroll-window setup (innate + ability-based
  // rerolls, Power Converter check, etc.), then calls
  // sendCombatGate('post_roll', ctx).
  try {
    await handleCombatRoll(synth('def', defOwnerId), ctx);
  } catch (err) {
    console.error('[autoRollDice] defense synth failed:', err);
  }
}

/** Auto-roll both sides' dice once both players have readied + the
 * pre-roll token phase has resolved. Per Destruct's UX feedback
 * 2026-05-04 ("the dice can auto roll, no need for prompt in future"):
 * no roll-button prompt — dice compute and images post immediately.
 *
 * The legacy `combat_roll_<gameId>` button is still parsed by
 * handleCombatRoll (recover.js re-posts it after a stuck combat), but
 * the production path no longer offers it.
 */
async function postRollDiceButton(thread, game, combat, ctx) {
  await autoRollDice(thread, game, combat, ctx);
}

/** Edit the roll prompt to reflect which sides have rolled (held). Called
 * after the first press; on the second press, the roll-image flow takes
 * over and the prompt's components are cleared. */
async function _updateRollPromptStatus(thread, game, combat, client) {
  if (!combat.rollMessageId) return;
  try {
    const msg = await thread.messages.fetch(combat.rollMessageId);
    const atkPN = combat.attackerPlayerNum;
    const defPN = opponentPlayerNum(atkPN);
    const atkId = getPlayerId(game, atkPN);
    const defId = getPlayerId(game, defPN);
    const atkName = getPlayerDisplayName(game, atkPN, client);
    const defName = getPlayerDisplayName(game, defPN, client);
    const atkMark = combat.attackRoll ? '✅' : '⏳';
    const defMark = combat.defenseRoll ? '✅' : '⏳';
    const status = `<@${atkId}> **${atkName}** (ATK) ${atkMark} | <@${defId}> **${defName}** (DEF) ${defMark}`;
    await msg.edit({ content: status }).catch(discordCatch);
  } catch (err) {
    console.error('updateRollPromptStatus: edit failed', err);
  }
}

/** Post a reroll result WITH the die image (alexanbv 2026-07-10: "when dice
 * are rerolled the die image should be shown"). Falls back to text-only when
 * rendering fails. `dice` = array of the rerolled die/dice results. */
async function _sendRerollResult(thread, pool, text, dice) {
  if (!thread) return;
  const render = pool === 'attack' ? renderAttackDiceImage : renderDefenseDiceImage;
  const img = await render(Array.isArray(dice) ? dice : [dice]).catch(() => null);
  if (img) await thread.send({ content: text, files: [new AttachmentBuilder(img, { name: 'reroll.png' })] }).catch(discordCatch);
  else await thread.send(text).catch(discordCatch);
}

/** Render and post the attack roll image. Used by held-roll second-press
 * reveal to surface a roll that was computed but not posted on first press. */
async function _postAttackRollImage(thread, combat, game, client) {
  if (!combat.attackRoll || !Array.isArray(combat.attackDiceResults)) return;
  const r = combat.attackRoll;
  const dice = combat.attackDiceResults;
  const rollerName = getPlayerDisplayName(game, combat.attackerPlayerNum, client);
  const content = `🎲 **${rollerName}** rolled attack — **${r.acc}** accuracy, **${r.dmg}** damage, **${r.surge}** surge`;
  const img = await renderAttackDiceImage(dice).catch(() => null);
  if (img) {
    await thread.send({ content, files: [new AttachmentBuilder(img, { name: 'attack-roll.png' })] }).catch(discordCatch);
  } else {
    const detail = dice.map((d) => `${d.color}(${d.acc}a/${d.dmg}d/${d.surge}s)`).join(', ');
    await thread.send(`${content}  [${detail}]`).catch(discordCatch);
  }
}

/** Render and post the defense roll image. Used by held-roll second-press
 * reveal to surface a roll that was computed but not posted on first press. */
async function _postDefenseRollImage(thread, combat, game, client) {
  if (!combat.defenseRoll || !Array.isArray(combat.defenseDiceResults)) return;
  const dr = combat.defenseRoll;
  const dice = combat.defenseDiceResults;
  const dodgeText = dr.dodge ? ' **DODGE!**' : '';
  const rollerName = getPlayerDisplayName(game, opponentPlayerNum(combat.attackerPlayerNum), client);
  const content = `🛡️ **${rollerName}** rolled defense — **${dr.block}** block, **${dr.evade}** evade${dodgeText}`;
  const img = await renderDefenseDiceImage(dice).catch(() => null);
  if (img) {
    await thread.send({ content, files: [new AttachmentBuilder(img, { name: 'defense-roll.png' })] }).catch(discordCatch);
  } else {
    const detail = dice.map((d) => `${d.color}(${d.block}b/${d.evade}e${d.dodge ? '/dodge' : ''})`).join(', ');
    await thread.send(`${content}  [${detail}]`).catch(discordCatch);
  }
}

/**
 * After token windows are resolved: evade cancellation, surge spending, or ready-to-resolve.
 */
async function proceedAfterTokens(thread, game, combat, ctx) {
  const saveGames = ctx.saveGames;

  // Survival is Strength (Armorer) moved to the forced-reroll queue (step 3 timing
  // per CRR p.10). Pulse Cannon and Negotiate moved to proceedAfterRerolls
  // (step-4 attacker modifiers, slice 2).

  const { getAttackerSurgeAbilities, SURGE_LABELS } = ctx;
  const getAbility = ctx.getAbility || (() => null);
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (SURGE_LABELS && SURGE_LABELS[id]) || id);
  const defRoll = combat.defenseRoll;

  // Evade cancels surge
  const roll = combat.attackRoll;
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const perDefDieSurge = (combat.bonusSurgePerDefenseDie || 0) * defenseDiceCount;
  // Hidden on attacker is NOT a surge bonus — it grants +1 Damage per the
  // canonical condition card text. The damage bonus lives in
  // computeCombatResult (src/game/combat.js); here we keep zero so the
  // surge total isn't double-credited. (Audit 2026-05-05 fix.)
  // Fury (Wookiee Warriors): +1 surge if 5+ damage (set at attack declare time)
  const furyBonus = combat.furyBonus || 0;
  // Per-figure attacker round-surge (Smuggled Supplies). Evaluated against THIS
  // attacking figure's conditions (alexanbv 2026-06-20) — replaces the per-player
  // roundAttackSurgeBonus flag, so an ineligible figure gets nothing.
  const _atkSurgeMods = combat.attackerFigureKey
    ? evaluateRoundModifiers(game, { side: 'attack', figureKey: combat.attackerFigureKey, playerNum: attackerPlayerNum, combat })
    : { surge: 0 };
  const roundAtkSurge = _atkSurgeMods.surge || 0;
  const surgeBonus = (combat.surgeBonus || 0) + roundAtkSurge + perDefDieSurge + furyBonus;
  // Weakened on attacker: -1 to Surge results (canonical Weakened condition
  // card — destruct 2026-05-07: "Weakened affects surges and evades.")
  // Skipped if condition effects are suppressed (YWNDM-on-Fifth-Brother).
  const _attackerWeakened = combat.attackerConds?.includes('Weaken')
    && !combat.attackerCondEffectsSuppressed;
  const _weakenSurgePenalty = _attackerWeakened ? 1 : 0;
  // Hidden on attacker: +1 to Surge results (destruct 2026-05-07 correction
  // — earlier audit misread the canonical card icon as Damage; it's Surge).
  // Skipped if condition effects are suppressed.
  const _attackerHiddenSurge = combat.attackerConds?.includes('Hide')
    && !combat.attackerCondEffectsSuppressed;
  const _hiddenSurgeBonus = _attackerHiddenSurge ? 1 : 0;
  // (Hidden/Weakened notes are posted at the MODS stage — alexanbv 2026-07-10;
  // only the arithmetic lives here.)
  const rawSurge = Math.max(0, roll.surge + surgeBonus + (combat.tokenSurgeBonus || 0) - _weakenSurgePenalty + _hiddenSurgeBonus);
  // Per-figure defender round-Evade for the surge-cancel step (Survival
  // Instincts, Armed Escort, Fuel Upgrade, etc.). Evaluated against THIS
  // defending figure (alexanbv 2026-06-20) — replaces roundDefenseBonusEvade[pn].
  const _defEvadeMods = combat.target?.figureKey
    ? evaluateRoundModifiers(game, { side: 'defense', figureKey: combat.target.figureKey, playerNum: defPlayerNum, combat })
    : { evade: 0 };
  const roundEvade = _defEvadeMods.evade || 0;
  // Overwhelming Impact (destruct 2026-05-06): "OI ignores non-die bonuses."
  // Passive +Evade and round-of-defense +Evade aren't on the rolled die, so
  // they're dropped under OI. Mirror of the bonusBlock gate at game/combat.js:322.
  const _evadeNonDieDropped = !!combat.ignoreDefenseResultsNotOnDice;
  // Weakened on defender: -1 to Evade results.
  const _defenderWeakened = combat.defenderConds?.includes('Weaken')
    && !combat.defenderCondEffectsSuppressed;
  const _weakenEvadePenalty = _defenderWeakened ? 1 : 0;
  const totalEvade = Math.max(0, defRoll.evade + (_evadeNonDieDropped ? 0 : ((combat.bonusEvade || 0) + roundEvade)) - _weakenEvadePenalty);
  const evadeCancelled = Math.min(rawSurge, totalEvade);
  const totalSurge = rawSurge - evadeCancelled;
  combat.evadeCancelledSurge = evadeCancelled;
  if (evadeCancelled > 0) {
    await thread.send(`**Evade cancels surge:** ${evadeCancelled} evade cancelled ${evadeCancelled} surge → **${totalSurge}** surge remaining`);
  }

  // Surge spending
  const surgeAbilities = getAttackerSurgeAbilities(combat);
  const remaining = totalSurge;
  const affordable = surgeAbilities.filter((key) => ((key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1))) <= remaining);
  // Rogue One: even with 0 surge, show the surge UI if the attacker can gain surge via token sharing
  const _rogueOneBtns = buildRogueOneSurgeButton(game, combat);
  const hasRogueOneOption = _rogueOneBtns.length > 0;
  if ((totalSurge > 0 && (affordable.length > 0 || combat.attackerConds?.includes('Bleed'))) || hasRogueOneOption) {
    combat.surgeRemaining = totalSurge;
    combat.surgeDamage = 0;
    combat.surgePierce = 0;
    combat.surgeAccuracy = 0;
    combat.surgeConditions = [];
    const surgeRows = [];
    // Krayt Dragon Fury (Tress Hacnua): resolve X in surge labels to actual surge count
    const _kdfXVal = combat.attackRoll?.surge ?? 0;
    const _kdfDcEffL = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _kdfAtkDcNameL = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _kdfAtkEffL = _kdfDcEffL[_kdfAtkDcNameL] || _kdfDcEffL[(_kdfAtkDcNameL || '').replace(/\s*\[.*\]\s*$/, '')];
    const _kdfHasL = (_kdfAtkEffL?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      let label = (getSurgeLabel(key) || key).slice(0, 80);
      // Substitute X with actual value for Krayt Dragon Fury
      if (_kdfHasL && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXVal));
      const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${game.gameId}_${i}`)
          .setLabel(btnLabel.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    if (combat.attackerConds?.includes('Bleed')) {
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${game.gameId}_bleed_prevention`)
          .setLabel('Spend 1 Surge — Prevent Bleed')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    // Rogue One: discard a power token from a friendly figure for +1 Damage
    surgeRows.push(..._rogueOneBtns);
    surgeRows.push(
      new ButtonBuilder()
        .setCustomId(`combat_surge_${game.gameId}_done`)
        .setLabel('Done (no more surge)')
        .setStyle(ButtonStyle.Primary)
    );
    const surgeRowsRendered = chunkButtonsToRows(surgeRows);
    const roundSurge = roundAtkSurge;
    const ccSurge = (combat.surgeBonus || 0);
    const surgeDisplay = (ccSurge > 0 || roundSurge > 0 || furyBonus > 0)
      ? `${roll.surge}${ccSurge ? ` + ${ccSurge} (CC)` : ''}${roundSurge ? ` + ${roundSurge} (round)` : ''}${furyBonus ? ` + ${furyBonus} (Fury)` : ''} = **${totalSurge}**`
      : `**${totalSurge}**`;
    // @ the attacker so they get a notification when surge spending opens.
    const _surgeAtkPN = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
    const _surgeAtkOwnerId = getPlayerId(game, _surgeAtkPN);
    await thread.send({
      content: `<@${_surgeAtkOwnerId}> — **Spend surge?** You have ${surgeDisplay} surge. Choose an ability or Done.`,
      components: surgeRowsRendered,
      allowedMentions: { users: [_surgeAtkOwnerId].filter(Boolean) },
    });
    return;
  }
  // Nothing to spend (no surges rolled, or no affordable abilities). Self-play
  // advances straight through; a live game still prompts the attacker with a
  // Done button so the surge window is never auto-skipped (alexanbv 2026-06-23).
  if (game.selfPlay) {
    await sendReadyToResolveRolls(thread, game.gameId, game, ctx);
    return;
  }
  combat.surgeRemaining = totalSurge;
  combat.surgeDamage = 0;
  combat.surgePierce = 0;
  combat.surgeAccuracy = 0;
  combat.surgeConditions = [];
  const _noSurgeAtkPN = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  const _noSurgeAtkOwnerId = getPlayerId(game, _noSurgeAtkPN);
  const _noSurgeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_surge_${game.gameId}_done`)
      .setLabel('Done (no surge to spend)')
      .setStyle(ButtonStyle.Primary),
  );
  await thread.send({
    content: `<@${_noSurgeAtkOwnerId}> — **No surge to spend** (${totalSurge} surge). Click **Done** to continue.`,
    components: [_noSurgeRow],
    allowedMentions: { users: [_noSurgeAtkOwnerId].filter(Boolean) },
  });
}


/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, getAttackerSurgeAbilities, SURGE_LABELS, getSurgeAbilityLabel, resolveSurgeAbility, parseSurgeEffect, resolveCombatAfterRolls, saveGames
 */
export async function handleCombatSurge(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    getAttackerSurgeAbilities,
    SURGE_LABELS,
    getSurgeAbilityLabel,
    resolveSurgeAbility,
    parseSurgeEffect,
    resolveCombatAfterRolls,
    saveGames,
  } = ctx;
  const getAbility = ctx.getAbility || (() => null);
  const resolveSurge = resolveSurgeAbility || parseSurgeEffect;
  const getSurgeLabel = getSurgeAbilityLabel || ((id) => (SURGE_LABELS && SURGE_LABELS[id]) || id);
  const match = interaction.customId.match(/^combat_surge_([^_]+)_(done|\d+|bleed_prevention|rogue_one)$/);
  if (!match) return;
  const [, gameId, choice] = match;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  // Allow rogue_one even with 0 surgeRemaining (it adds surge)
  if (!combat || combat.gameId !== gameId || (choice !== 'rogue_one' && choice !== 'done' && !combat.surgeRemaining)) {
    await interaction.followUp({ content: 'No surge step or already resolved.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Player check FIRST. Defender clicks must reject without mutating the
  // message's button state — earlier this ran AFTER the visual toggle, so
  // a wrong-player click visibly highlighted/disabled buttons even though
  // their click was rejected.
  const attackerPlayerNum = combat.attackerPlayerNum;
  const effectiveAttackerForSurge = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttackerForSurge, canActAsPlayer, 'Only the attacker may spend surge.')) return;
  // Visual feedback: highlight the clicked surge button green, disable
  // others. Same Extra-Armor-style toggle pattern as power-token spend.
  // (Wrapped in try/catch + early-return — IIFE scoped block.)
  try {
    const clickedId = interaction.customId;
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        btn.setDisabled(true);
        if (c.customId === clickedId) {
          btn.setStyle(choice === 'done' ? ButtonStyle.Secondary : ButtonStyle.Success);
        }
        newRow.addComponents(btn);
      }
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch (_e) { /* non-fatal */ }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) throw new Error(`handleCombatSurge: combat thread is null (threadId=${combat.combatThreadId}, gameId=${gameId})`);
  // Overload (Rebel Saboteur): may trigger the same surge ability up to twice per attack
  const getDcEffS = ctx.getDcEffects || (() => ({}));
  const atkEffS = getDcEffS()[combat.attackerDcName] || getDcEffS()[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  const overloadActive = (atkEffS?.specialAbilityIds || []).includes('overload_saboteur');
  if (choice === 'rogue_one') {
    // Rogue One: show a picker for which friendly figure's token to discard
    const donors = getRogueOneDonors(game, combat);
    if (donors.length === 0) {
      await thread.send('**Rogue One** — No friendly figures with power tokens available.').catch(discordCatch);
    } else {
      setPendingRogueOneTokenPick(game, { gameId, combatThreadId: combat.combatThreadId, attackerPlayerNum: combat.attackerPlayerNum });
      const btns = [];
      // Group by figure and show one button per token
      for (let d = 0; d < donors.length && d < 20; d++) {
        const donor = donors[d];
        btns.push(
          new ButtonBuilder()
            .setCustomId(`rogue_one_token_${gameId}_${donor.figureKey}_${donor.tokenIndex}`)
            .setLabel(`${donor.dcName}: ${donor.tokenType}`.slice(0, 80))
            .setStyle(ButtonStyle.Danger)
        );
      }
      btns.push(
        new ButtonBuilder()
          .setCustomId(`rogue_one_token_${gameId}_skip`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
      const rows = chunkButtonsToRows(btns);
      await thread.send({
        content: '**Rogue One** — Choose a power token to discard from a friendly figure for **+1 Damage**:',
        components: rows,
      }).catch(discordCatch);
      saveGames(game.gameId);
      return; // wait for player to pick a token
    }
  } else if (choice === 'bleed_prevention') {
    combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - 1);
    combat.surgePreventBleed = true;
    await thread.send('Spent 1 surge — Bleeding will be prevented this activation.').catch(discordCatch);
  } else if (choice !== 'done') {
    // Disable: disabled figures cannot use Surge abilities
    if (game.disabledFigures?.includes(combat.attackerDisplayName)) {
      await thread.send(`**${combat.attackerDisplayName}** is Disabled — cannot use Surge abilities this round.`).catch(discordCatch);
      await interaction.deferUpdate().catch(discordCatch);
      return;
    }
    const idx = parseInt(choice, 10);
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const key = surgeAbilities[idx];
    if (key) {
      // Overload: check if this surge has already been used the max number of times
      const maxUses = overloadActive ? 2 : 1;
      const usedCount = (combat.surgeSpentCount || {})[idx] || 0;
      if (usedCount >= maxUses) {
        await interaction.deferUpdate().catch(discordCatch);
        return;
      }
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      const mod = resolveSurge(key);
      combat.surgeDamage = (combat.surgeDamage || 0) + (mod.damage ?? 0);
      combat.surgePierce = (combat.surgePierce || 0) + (mod.pierce ?? 0);
      combat.surgeAccuracy = (combat.surgeAccuracy || 0) + (mod.accuracy ?? 0);
      if (mod.conditions?.length) combat.surgeConditions = (combat.surgeConditions || []).concat(mod.conditions);
      // "-ed" surge conditions (e.g. Zuckuss Stun Net) — resolve on a NOT-MISS
      // even at 0 damage, so they go to a separate not-miss bucket rather than the
      // damage-gated surgeConditions (alexanbv 2026-06-22).
      if (mod.noMissConditions?.length) combat.surgeNoMissConditions = (combat.surgeNoMissConditions || []).concat(mod.noMissConditions);
      combat.surgeBlast = (combat.surgeBlast || 0) + (mod.blast ?? 0);
      combat.surgeRecover = (combat.surgeRecover || 0) + (mod.recover ?? 0);
      if (mod.cleave) {
        const _cv = mod.cleave ?? 0;
        combat.surgeCleave = (combat.surgeCleave || 0) + _cv;
        (combat.cleaveSources = combat.cleaveSources || []).push({ value: _cv, label: `Cleave ${_cv} (surge)` });
      }
      // Cancel: remove N block results from defender (like Pierce but applied to results)
      if (mod.surgeCancel) combat.surgeCancel = (combat.surgeCancel || 0) + mod.surgeCancel;
      // Named surge flags
      if (mod.replaceWithStun) combat.attackResultReplaceWithStun = true; // Set for Stun (CC): hit, damage>0 gated
      if (mod.missAndStun) combat.attackMissAndStun = true; // Shocking Palm (0-0-0): MISS + unconditional Stun
      if (mod.surgeCancelDodge) combat.surgeCancelDodge = true;
      if (mod.surgeDeadlySpinDodge) combat.surgeDeadlySpinDodge = true; // Deadly Spin: -1 Dodge (counted)
      if (mod.surgeHarass) combat.surgeHarass = (combat.surgeHarass || 0) + mod.surgeHarass;
      if (mod.surgeSquadCommand) combat.surgeSquadCommand = true;
      if (mod.surgeStalkPrey) combat.surgeStalkPrey = true;
      if (mod.surgeCriticalHit) {
        combat.surgeCriticalHit = true;
        // Mak Eshka'rey "Critical Hit": "This attack gains Pierce 2; if the
        // target suffered 1 or more Damage during this attack, it may not play
        // command cards this round." The CC-lockout is conditional on the
        // target actually suffering >=1 Damage, which isn't known at surge-spend
        // time. Defer it: set a pending flag here and apply
        // game.criticalHitBlockedPlayer in step-7/step-8 resolution (combat-
        // bridge) only when combat._step7Damage >= 1. (Pierce 2 is generic.)
        combat.surgeCriticalHitPending = true;
      }
      if (mod.surgeSuppressionStrain) combat.surgeSuppressionStrain = true;
      if (mod.surgeFightingKnife) combat.surgeFightingKnife = true;
      if (mod.surgeConcussiveBolt) combat.surgeConcussiveBolt = true;
      if (mod.surgeOpenMinded) combat.surgeOpenMinded = true;
      // Shrapnel (Drokkatta): mark for picker — Blast 2 vs Splash. The
      // gate at the "Done" transition (sendReadyToResolveRolls call)
      // posts the choice picker if shrapnelChoicePending is set.
      if (mod.surgeShrapnel) {
        combat.surgeShrapnel = true;
        combat.shrapnelChoicePending = true;
      }
      if (mod.surgeAgitate) combat.surgeAgitate = true;
      if (mod.surgeFellSwoop) combat.surgeFellSwoop = true;
      if (mod.surgeMastery) combat.surgeMastery = true;
      if (mod.surgeInterrogate) combat.surgeInterrogate = true;
      if (mod.surgeMilitaryEfficiency) combat.surgeMilitaryEfficiency = true;
      // Autofire chain attack: mark pending so applyDamageAndFinishCombat grants free attack
      if (key === 'autofire_chain') {
        const _afTargetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[combat.target?.figureKey];
        combat.autofireChainPending = true;
        combat.autofireChainTargetSpace = _afTargetPos || null;
        // Cost is deducted by the general decrement below (line with `combat.surgeRemaining -= cost`)
        await thread.send('**Autofire** — Chain attack queued! After this attack resolves, perform another attack targeting within 3 of the target space.').catch(discordCatch);
      }
      // K&D / Targeting Network re-draw (per CRR 2026-05-09): spend a
      // surge to move the named CC from discard back to hand.
      if (key === 'kd_redraw' || key === 'tn_redraw') {
        const _redrawCard = key === 'kd_redraw' ? 'Knowledge and Defense' : 'Targeting Network';
        const { moveDiscardToHand: _moveD2H } = await import('../game/cc-passive-redraw.js');
        const _moved = _moveD2H(game, attackerPlayerNum, _redrawCard);
        if (_moved) {
          await thread.send(`**Surge: Re-draw** — **${_redrawCard}** moved from discard pile to hand.`).catch(discordCatch);
          if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Surge: Re-draw** — **${_redrawCard}** re-drawn from discard (surge spent by **${combat.attackerDcName}**).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
          if (ctx.updateHandVisualMessage) await ctx.updateHandVisualMessage(game, attackerPlayerNum, ctx.client || interaction.client).catch(discordCatch);
          if (ctx.updateDiscardPileMessage) await ctx.updateDiscardPileMessage(game, attackerPlayerNum, ctx.client || interaction.client).catch(discordCatch);
        }
      }
      // Utinni! (Jawa Scavenger): spending this surge earns 1 VP
      if (key === 'utinni_vp_1') {
        awardObjectiveVp(game, attackerPlayerNum, 1);
        // Cost is deducted by the general decrement below (line with `combat.surgeRemaining -= cost`)
        const _utinniVpKey = vpKey(attackerPlayerNum);
        await thread.send(`**Utinni!** — +1 VP earned (${game[_utinniVpKey].total} total).`).catch(discordCatch);
        if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Utinni!** — Jawa Scavenger earned +1 VP.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
        if (checkWinConditions) await checkWinConditions(game, client);
      }
      // Gain VP (Senator/Streetrat form surge): spending this surge earns N VP
      if (mod.surgeVpGain && mod.surgeVpGain > 0) {
        awardObjectiveVp(game, attackerPlayerNum, mod.surgeVpGain);
        const _gvpKey = vpKey(attackerPlayerNum);
        await thread.send(`**+${mod.surgeVpGain} VP** earned (${game[_gvpKey].total} total).`).catch(discordCatch);
        if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Surge: +${mod.surgeVpGain} VP** (${game[_gvpKey].total} total).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
        if (checkWinConditions) await checkWinConditions(game, client);
      }
      // Bargain (Jawa Scavenger Elite): inline VP exchange during surge phase
      if (mod.surgeBargain) {
        const _bargainVpKey = vpKey(attackerPlayerNum);
        game[_bargainVpKey] = game[_bargainVpKey] || { total: 0, kills: 0, objectives: 0 };
        const vp = game[_bargainVpKey];
        if ((vp.total || 0) >= 1) {
          vp.total -= 1;
          if ((vp.objectives || 0) > 0) vp.objectives -= 1;
          else vp.kills = Math.max(0, (vp.kills || 0) - 1);
          const rollFn = ctx.rollSingleAttackDie;
          const bargainDie = rollFn ? rollFn('green') : { dmg: 0, surge: 0 };
          const gained = bargainDie.dmg || 0;
          if (gained > 0) { vp.total += gained; vp.objectives += gained; }
          const net = gained - 1;
          await thread.send(`**Bargain** — Spent 1 VP, rolled green die (${bargainDie.dmg ?? 0}dmg): gained **${gained} VP** (net ${net >= 0 ? '+' : ''}${net}).`).catch(discordCatch);
          if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Bargain** — Spent 1 VP, gained ${gained} VP (net ${net >= 0 ? '+' : ''}${net})`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
        } else {
          await thread.send('**Bargain** — No VP available to spend; ability has no effect.').catch(discordCatch);
        }
      }
      // Self-condition surges: defer application until AFTER the post-attack
      // Focus/Hidden discard step (combat-bridge.js:1626-1630). destruct
      // 2026-05-07: "hidden is discarded, and then reacquired. Technically
      // the player could choose either order, but the only logical one is
      // to gain it after discarding." Same logic applies to Focus.
      if (mod.surgeSelfFocus && combat.attackerFigureKey) {
        combat.deferredSurgeFocus = true;
      }
      if (mod.surgeSelfHide && combat.attackerFigureKey) {
        combat.deferredSurgeHide = true;
      }
      // Power token grants to attacker's figurePowerTokens
      if ((mod.surgeGrantHitToken || 0) > 0 && combat.attackerFigureKey) {
        grantPowerTokens(game, combat.attackerFigureKey, 'Damage', mod.surgeGrantHitToken);
      }
      if ((mod.surgeGrantBlockToken || 0) > 0 && combat.attackerFigureKey) {
        grantPowerTokens(game, combat.attackerFigureKey, 'Block', mod.surgeGrantBlockToken);
      }
      if ((mod.surgeGrantPowerToken || 0) > 0 && combat.attackerFigureKey) {
        const figName = dcNameFromFigureKey(combat.attackerFigureKey);
        game.pendingPowerTokenGrant = { grants: [{ figureKey: combat.attackerFigureKey, figName, count: mod.surgeGrantPowerToken }], channelId: null, playerNum: combat.attackerPlayerNum };
      }
      if ((mod.surgeGrantEvade || 0) > 0 && combat.attackerFigureKey) {
        grantPowerTokens(game, combat.attackerFigureKey, 'Evade', mod.surgeGrantEvade);
      }
      if ((mod.surgeAttackerBlock || 0) > 0 && combat.attackerFigureKey) {
        grantPowerTokens(game, combat.attackerFigureKey, 'Block', mod.surgeAttackerBlock);
      }
      // Surge-for-surge: add back to remaining before the cost decrement below
      if ((mod.surgeGrantExtraSurge || 0) > 0) {
        combat.surgeRemaining = (combat.surgeRemaining || 0) + mod.surgeGrantExtraSurge;
      }
      if (mod.surgeComplex) {
        // Krayt Dragon Fury (Tress Hacnua): X = number of Surge rolled on the attack dice
        const _kdfDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
        const _kdfAtkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
        const _kdfAtkEff = _kdfDcEff[_kdfAtkDcName] || _kdfDcEff[(_kdfAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
        const _kdfHas = (_kdfAtkEff?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
        if (_kdfHas) {
          const _kdfX = combat.attackRoll?.surge ?? 0;
          if (mod.surgeComplex === 'cleave x') {
            if (_kdfX > 0) {
              combat.surgeCleave = (combat.surgeCleave || 0) + _kdfX;
              (combat.cleaveSources = combat.cleaveSources || []).push({ value: _kdfX, label: `Cleave ${_kdfX} (Krayt Dragon Fury)` });
            }
            await thread.send(`**Krayt Dragon Fury** — Cleave ${_kdfX} (${_kdfX} Surge rolled).`).catch(discordCatch);
          } else if (mod.surgeComplex === 'recover x') {
            combat.surgeRecover = (combat.surgeRecover || 0) + _kdfX;
            await thread.send(`**Krayt Dragon Fury** — Recover ${_kdfX} (${_kdfX} Surge rolled).`).catch(discordCatch);
          }
        } else {
          const cThread = await fetchCombatThread(interaction.client, combat.combatThreadId);
          await cThread.send(`⚠️ **${getSurgeLabel(key)}** — complex surge applied (see ability text for details).`).catch(discordCatch);
        }
      }
      combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - cost);
      // Track how many times each surge index has been spent (for Overload)
      if (!combat.surgeSpentCount) combat.surgeSpentCount = {};
      combat.surgeSpentCount[idx] = (combat.surgeSpentCount[idx] || 0) + 1;
      const label = getSurgeLabel(key);
      await thread.send(`**Surge spent (${cost}):** ${label}`).catch(discordCatch);
      // K&D / Targeting Network passive redraw is now a SURGE OPTION
      // (key === 'kd_redraw' / 'tn_redraw'), handled above. The legacy
      // auto-fire-after-any-surge-spend behavior (checkSurgePassiveRedraws)
      // was incorrect per CRR (the cards grant a NEW surge ability, not
      // a free trigger). Removed 2026-05-09.
      // Hunter Protocol: offer to trigger the same surge ability once more
      if (game.surgeDoublingActive?.[attackerPlayerNum] && key && !combat.surgeDoubledAbility && !key.startsWith('double:') && key !== 'utinni_vp_1') {
        if ((combat.surgeRemaining || 0) >= cost) {
          combat.surgeDoubledAbility = key;
          setPendingHunterProtocol(game, { key, cost });
          const _hpRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`hunter_protocol_trigger_${gameId}`).setLabel(`Trigger again: ${label}`.slice(0, 80)).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`hunter_protocol_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Hunter Protocol** — Trigger **${label}** once more?`, components: [_hpRow] }).catch(discordCatch);
          saveGames(game.gameId);
          return;
        }
      }
      // If this surge granted a power token, send the type-choice prompt now
      if (game.pendingPowerTokenGrant?.channelId === null) {
        game.pendingPowerTokenGrant.channelId = thread.id;
        await sendPowerTokenChoicePrompt(thread, gameId, game.pendingPowerTokenGrant.grants);
        saveGames(game.gameId);
        return; // wait for player to choose token type before continuing surge
      }
      // Spread the Pain (Dengar): prompt attacker to choose a HARMFUL condition
      if (mod.surgeSpreadThePain) {
        const already = combat.spreadThePainConditions || [];
        const available = ['Stun', 'Weaken', 'Bleed'].filter((c) => !already.includes(c));
        game.pendingSpreadThePainCondPick = { gameId, combatThreadId: combat.combatThreadId, attackerPlayerNum: combat.attackerPlayerNum };
        const btns = available.map((c) =>
          new ButtonBuilder()
            .setCustomId(`spread_pain_cond_${gameId}_${c.toLowerCase()}`)
            .setLabel(c)
            .setStyle(ButtonStyle.Primary)
        );
        btns.push(new ButtonBuilder().setCustomId(`spread_pain_cond_${gameId}_skip`).setLabel('Skip (no condition)').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `**Spread the Pain** — Choose a HARMFUL condition (not already chosen this attack):`,
          components: [new ActionRowBuilder().addComponents(btns.slice(0, 5))],
        }).catch(discordCatch);
        saveGames(game.gameId);
        return; // wait for player to choose condition before continuing surge
      }
    }
  }
  // Check for power token overflow before showing next surge choices
  if (game.pendingPowerTokenOverflow?.length > 0) {
    setPendingSurgeOverflow(game, { combatThreadId: combat.combatThreadId, attackerPlayerNum: combat.attackerPlayerNum });
    await sendPowerTokenOverflowUI(game, gameId, thread, combat.attackerPlayerNum, saveGames);
    return; // pause surge — overflow handler will resume
  }
  if (combat.surgeRemaining <= 0 || choice === 'done') {
    combat.surgeRemaining = 0;
    // Shrapnel (Drokkatta) picker — fires once between surge-spend and
    // ready-to-resolve. Blast 2 must be set BEFORE damage step (step 7);
    // Splash queues for post-resolve (step 8). Player picks one.
    if (combat.shrapnelChoicePending) {
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${gameId}_shrapnel_blast`).setLabel('Blast 2 (this attack)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${gameId}_shrapnel_splash`).setLabel('Splash (1 Dmg within 2 of target, post-resolve)').setStyle(ButtonStyle.Primary),
      ];
      await thread.send({
        content: `🧨 **Shrapnel** — Choose: **Blast 2** on this attack, OR **Splash** (each figure/object within 2 spaces of the target suffers 1 Damage after the attack resolves, if it didn't miss).`,
        components: [new ActionRowBuilder().addComponents(btns)],
      }).catch(discordCatch);
      saveGames?.(game.gameId);
      return;
    }
    await sendReadyToResolveRolls(thread, gameId, game, ctx);
  } else {
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const remaining = combat.surgeRemaining || 0;
    const maxSurgeUses = overloadActive ? 2 : 1;
    // Krayt Dragon Fury: resolve X in labels
    const _kdfXValR = combat.attackRoll?.surge ?? 0;
    const _kdfDcEffR = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _kdfAtkDcNameR = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _kdfAtkEffR = _kdfDcEffR[_kdfAtkDcNameR] || _kdfDcEffR[(_kdfAtkDcNameR || '').replace(/\s*\[.*\]\s*$/, '')];
    const _kdfHasR = (_kdfAtkEffR?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      // Skip surges that have been used the max number of times
      if (((combat.surgeSpentCount || {})[i] || 0) >= maxSurgeUses) continue;
      let label = (getSurgeLabel(key) || key).slice(0, 80);
      if (_kdfHasR && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXValR));
      const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${gameId}_${i}`)
          .setLabel(btnLabel.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
    if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${gameId}_bleed_prevention`)
          .setLabel('Spend 1 Surge — Prevent Bleed')
          .setStyle(ButtonStyle.Secondary)
      );
    }
    // Rogue One: discard a power token from a friendly figure for +1 Damage
    surgeRows.push(...buildRogueOneSurgeButton(game, combat));
    surgeRows.push(
      new ButtonBuilder()
        .setCustomId(`combat_surge_${gameId}_done`)
        .setLabel('Done (no more surge)')
        .setStyle(ButtonStyle.Primary)
    );
    const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
    await thread.send({
      content: `**Spend surge?** **${combat.surgeRemaining}** surge left. Choose an ability or Done.`,
      components: [surgeRow],
    });
  }
  saveGames(game.gameId);
}

/**
 * Personal Combat Shield: "Whenever you spend a Block while defending, apply +1
 * Evade to the defense results." Applies to (a) Gar Saxon natively (the
 * personal_combat_shield_gar_saxon DC special) and (b) any friendly MOBILE figure
 * granted the shield this round via Choose a Side (SCUM) — excluding the figure
 * that played Choose a Side. Returns a note string if +1 Evade was applied, else ''.
 */
export function applyPersonalCombatShieldOnBlockSpend(game, combat, ctx) {
  const defFk = combat?.target?.figureKey || '';
  if (!defFk) return '';
  const dcEff = ctx?.getDcEffects ? ctx.getDcEffects() : {};
  const defDcName = dcNameFromFigureKey(defFk);
  const eff = dcEff[defDcName] || dcEff[(defDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  // Native Gar Saxon.
  if ((eff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
    combat.bonusEvade = (combat.bonusEvade || 0) + 1;
    return '**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.';
  }
  // Choose a Side (SCUM) round grant to OTHER friendly MOBILE figures. Evaluated
  // PER-FIGURE (alexanbv 2026-06-20): the defending figure gets the shield only IF
  // it is MOBILE and is not the card-playing figure (excludeSourceFigure), via the
  // active round-modifier registry — replaces roundMobilePersonalCombatShield[pn].
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const _shieldMods = evaluateRoundModifiers(game, { side: 'defense', figureKey: defFk, playerNum: defPN, combat });
  if (_shieldMods.personalCombatShield) {
    combat.bonusEvade = (combat.bonusEvade || 0) + 1;
    return '**Personal Combat Shield** (Choose a Side) — Mobile figure spent a Block token: +1 Evade.';
  }
  return '';
}

/**
 * Handle power token spending buttons (combat_token_).
 * Custom ID patterns:
 *   combat_token_{gameId}_att_{n|skip}  — attacker spends token index n, or skips
 *   combat_token_{gameId}_def_{n|skip}  — defender spends token index n, or skips
 */
export async function handleCombatToken(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames, logGameAction } = ctx;
  // Match both att/def (spend/skip) and wild (type resolution) patterns
  const m = interaction.customId.match(/^combat_token_([^_]+)_(att|def|wild)_(.+)$/);
  if (!m) return;
  const [, gameId, role, choice] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  // Permission check FIRST — per alexanbv 2026-05-12: pre-fix the
  // visual-feedback block below ran BEFORE the requirePlayer check at
  // line ~7312, so a wrong-player click (e.g. attacker clicking the
  // defender's token prompt) would disable every button on the
  // message via interaction.message.edit, locking the actual owner
  // out of their own prompt. Compute the expected player from the
  // role/state and reject early if the clicker is the wrong player.
  let _expectedPlayerNum = null;
  if (role === 'wild') {
    if (combat.pendingWildRole) {
      _expectedPlayerNum = combat.pendingWildRole === 'attacker'
        ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
        : opponentPlayerNum(combat.attackerPlayerNum);
    }
  } else {
    const _isAtkRole = role === 'att';
    _expectedPlayerNum = _isAtkRole
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : opponentPlayerNum(combat.attackerPlayerNum);
  }
  if (_expectedPlayerNum != null) {
    if (!await requirePlayer(interaction, game, interaction.user.id, _expectedPlayerNum, canActAsPlayer, 'Only the correct player may spend their token.')) return;
  }

  // Visual feedback: highlight the clicked button green, disable all others.
  // Matches the Extra Armor color-toggle pattern. Only runs AFTER the
  // permission check passes so wrong-player clicks don't disable the
  // actual owner's prompt.
  try {
    const clickedId = interaction.customId;
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        btn.setDisabled(true);
        if (c.customId === clickedId) {
          btn.setStyle(choice === 'skip' ? ButtonStyle.Secondary : ButtonStyle.Success);
        }
        newRow.addComponents(btn);
      }
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch (_e) { /* non-fatal */ }

  // Wild type resolution: combat_token_{gameId}_wild_{hit|surge|block|evade}
  if (role === 'wild') {
    if (!combat.pendingWildRole || combat.pendingWildTokenIndex == null) return;
    const typeMap = { damage: 'Damage', surge: 'Surge', block: 'Block', evade: 'Evade' };
    const resolvedType = typeMap[choice];
    if (!resolvedType) return;
    // Squad Cohesion: if the Wild token came from a cohesion source, use that figure key
    const figKey = combat.pendingWildCohesionFigureKey
      || (combat.pendingWildRole === 'attacker' ? combat.attackerFigureKey : combat.target.figureKey);
    const isCohesion = !!combat.pendingWildCohesionFigureKey;
    const cohesionOwner = combat.pendingWildCohesionOwnerName || '';
    const wildIsAttacker = combat.pendingWildRole === 'attacker';
    // Krennic's Unhinged Director — Wild attacker spend (main or cohesion).
    // Spender = the figure that owned the Wild token.
    const wildAtkPN = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
    if (wildIsAttacker && await _maybePromptUnhinged(thread, game, gameId, combat, {
      tokenType: resolvedType,
      spenderFigureKey: figKey,
      tokenIndex: combat.pendingWildTokenIndex,
      atkPlayerNum: wildAtkPN,
      isAttacker: true,
      sourceLabel: isCohesion ? `Wild · Squad Cohesion · ${cohesionOwner}` : 'Wild',
    })) {
      // Clear wild state; the unhinged-choice handler completes the spend.
      combat.pendingWildRole = null;
      combat.pendingWildTokenIndex = null;
      combat.pendingWildCohesionFigureKey = null;
      combat.pendingWildCohesionOwnerName = null;
      saveGames(game.gameId);
      return;
    }
    applyTokenBonus(combat, resolvedType, wildIsAttacker);
    removeSpentToken(game, figKey, combat.pendingWildTokenIndex);
    if (isCohesion) {
      await thread.send(`**Power Token spent (Squad Cohesion):** Wild → +1 ${resolvedType} (from ${cohesionOwner})`);
      logGameAction?.(game, interaction.client, `🎯 **Power Token spent (Squad Cohesion)** — ${combat.pendingWildRole === 'attacker' ? 'Attacker' : 'Defender'}: Wild → +1 ${resolvedType} from ${cohesionOwner}`, { phase: 'ROUND', icon: 'attack' });
    } else {
      await thread.send(`**Power Token spent:** Wild → +1 ${resolvedType}`);
      logGameAction?.(game, interaction.client, `🎯 **Power Token spent** — ${combat.pendingWildRole === 'attacker' ? 'Attacker' : 'Defender'}: Wild → +1 ${resolvedType}`, { phase: 'ROUND', icon: 'attack' });
    }
    // Track attacker Power Token spending for Pulse Cannon (Iden Versio)
    if (combat.pendingWildRole === 'attacker') combat.attackerSpentPowerToken = true;
    // Field Supply (CC row 654): mark a Hit (Damage) / Surge token spend (the Wild
    // resolved to that type) by the attacker — gates Field Supply's rerolls option.
    if (combat.pendingWildRole === 'attacker' && (resolvedType === 'Damage' || resolvedType === 'Surge')) combat.attackerSpentHitOrSurgeToken = true;
    // Air Support (Bodhi Rook) — now a gate mods passive ('air_support' →
    // _fireModsPassive), gated on combat.attackerSpentPowerToken + unfocused.
    // Track defender modifications for Quick Strike (Electrostaff loadout)
    if (combat.pendingWildRole === 'defender') combat.defenderRerolledOrModified = true;
    // Track Block spending for Mandalorian Steel / Personal Combat Shield
    if (combat.pendingWildRole === 'defender' && resolvedType === 'Block') {
      combat.defenderSpentBlock = true;
      const _pcsNote = applyPersonalCombatShieldOnBlockSpend(game, combat, ctx);
      if (_pcsNote) await thread.send(_pcsNote);
    }
    const completedRole = combat.pendingWildRole;
    combat.pendingWildRole = null;
    combat.pendingWildTokenIndex = null;
    combat.pendingWildCohesionFigureKey = null;
    combat.pendingWildCohesionOwnerName = null;
    await advanceTokenPhase(thread, game, combat, completedRole, ctx);
    saveGames(game.gameId);
    return;
  }

  const isAttacker = role === 'att';
  const expectedPhase = isAttacker ? 'attacker' : 'defender';
  if (combat.tokenPhase !== expectedPhase) return;
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const playerNum = isAttacker ? atkPlayerNum : opponentPlayerNum(combat.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the correct player may spend their token.')) return;

  // Skip
  if (choice === 'skip') {
    await thread.send(`**Power Token — ${isAttacker ? 'Attacker' : 'Defender'}:** No token spent.`);
    await advanceTokenPhase(thread, game, combat, expectedPhase, ctx);
    saveGames(game.gameId);
    return;
  }

  // Squad Cohesion: spend a token from a nearby friendly REBEL figure
  if (choice.startsWith('sc')) {
    const scKey = `${role}_${choice}`;
    const scEntry = combat.squadCohesionTokenMap?.[scKey];
    if (!scEntry) return;
    const scTokens = game.figurePowerTokens?.[scEntry.figureKey] || [];
    const scTokenType = scTokens[scEntry.tokenIndex];
    if (!scTokenType) return;
    // Wild: prompt for type selection, store the cohesion source info
    if (scTokenType === 'Wild') {
      combat.pendingWildRole = expectedPhase;
      combat.pendingWildTokenIndex = scEntry.tokenIndex;
      combat.pendingWildCohesionFigureKey = scEntry.figureKey;
      combat.pendingWildCohesionOwnerName = scEntry.ownerName;
      await sendWildTypeWindow(thread, game.gameId, expectedPhase);
      saveGames(game.gameId);
      return;
    }
    // Krennic's Unhinged Director — Squad Cohesion attacker spend.
    // Spender = cohesion source figure (must be in eligibility set).
    if (await _maybePromptUnhinged(thread, game, gameId, combat, {
      tokenType: scTokenType,
      spenderFigureKey: scEntry.figureKey,
      tokenIndex: scEntry.tokenIndex,
      atkPlayerNum,
      isAttacker,
      sourceLabel: `Squad Cohesion · ${scEntry.ownerName}`,
    })) {
      saveGames(game.gameId);
      return;
    }
    applyTokenBonus(combat, scTokenType, isAttacker);
    removeSpentToken(game, scEntry.figureKey, scEntry.tokenIndex);
    await thread.send(`**Power Token spent (Squad Cohesion):** +1 ${scTokenType} (from ${scEntry.ownerName})`);
    logGameAction?.(game, interaction.client, `🎯 **Power Token spent (Squad Cohesion)** — ${isAttacker ? 'Attacker' : 'Defender'}: +1 ${scTokenType} from ${scEntry.ownerName}`, { phase: 'ROUND', icon: 'attack' });
    if (isAttacker) combat.attackerSpentPowerToken = true;
    // Field Supply (CC row 654): mark that a Hit (Damage) / Surge token was spent
    // by the attacker this attack — gates Field Supply's attacker-rerolls option.
    if (isAttacker && (scTokenType === 'Damage' || scTokenType === 'Surge')) combat.attackerSpentHitOrSurgeToken = true;
    // Air Support (Bodhi Rook) — now a gate mods passive ('air_support').
    if (!isAttacker) combat.defenderRerolledOrModified = true;
    if (!isAttacker && scTokenType === 'Block') {
      combat.defenderSpentBlock = true;
      const _pcsNote = applyPersonalCombatShieldOnBlockSpend(game, combat, ctx);
      if (_pcsNote) await thread.send(_pcsNote);
    }
    await advanceTokenPhase(thread, game, combat, expectedPhase, ctx);
    saveGames(game.gameId);
    return;
  }

  // Spend token
  const tokenIndex = parseInt(choice, 10);
  const figureKey = isAttacker ? combat.attackerFigureKey : combat.target.figureKey;
  const tokens = game.figurePowerTokens?.[figureKey] || [];
  const tokenType = tokens[tokenIndex];
  if (!tokenType) return;

  // Wild: prompt for type selection first
  if (tokenType === 'Wild') {
    combat.pendingWildRole = expectedPhase;
    combat.pendingWildTokenIndex = tokenIndex;
    await sendWildTypeWindow(thread, game.gameId, expectedPhase);
    saveGames(game.gameId);
    return;
  }

  // Krennic's Unhinged Director — main attacker-spend path.
  if (await _maybePromptUnhinged(thread, game, gameId, combat, {
    tokenType,
    spenderFigureKey: figureKey,
    tokenIndex,
    atkPlayerNum,
    isAttacker,
  })) {
    saveGames(game.gameId);
    return;
  }
  applyTokenBonus(combat, tokenType, isAttacker);
  const _tokenBonusAmt = 1;
  removeSpentToken(game, figureKey, tokenIndex);
  await thread.send(`**Power Token spent:** +${_tokenBonusAmt} ${tokenType}`);
  logGameAction?.(game, interaction.client, `🎯 **Power Token spent** — ${isAttacker ? 'Attacker' : 'Defender'}: +1 ${tokenType}`, { phase: 'ROUND', icon: 'attack' });
  // Track attacker Power Token spending for Pulse Cannon (Iden Versio)
  if (isAttacker) combat.attackerSpentPowerToken = true;
  // Field Supply (CC row 654): mark that a Hit (Damage) / Surge token was spent
  // by the attacker this attack — gates Field Supply's attacker-rerolls option.
  if (isAttacker && (tokenType === 'Damage' || tokenType === 'Surge')) combat.attackerSpentHitOrSurgeToken = true;
  // Air Support (Bodhi Rook) — now a gate mods passive ('air_support').
  // Track defender modifications for Quick Strike (Electrostaff loadout)
  if (!isAttacker) combat.defenderRerolledOrModified = true;
  // Track Block token spending for Mandalorian Steel + Personal Combat Shield
  // (Gar Saxon natively, or Mobile figures granted it via Choose a Side this round).
  if (!isAttacker && tokenType === 'Block') {
    combat.defenderSpentBlock = true;
    const _pcsNote = applyPersonalCombatShieldOnBlockSpend(game, combat, ctx);
    if (_pcsNote) await thread.send(_pcsNote);
  }
  await advanceTokenPhase(thread, game, combat, expectedPhase, ctx);
  saveGames(game.gameId);
}

/**
 * Krennic / Unhinged Director — handle the +1/+2 strain-tradeoff choice.
 *
 * customId shape: `unhinged_director_<gameId>_<plus1|plus2>`
 *
 * Per card text: "...it MAY suffer 1 Strain to apply +2 of the chosen
 * symbol to the results instead of +1." Player picks +1 (free) or +2
 * (figure suffers 1 Strain). On +2, full IACP Strain semantics apply:
 * if the spender's CC deck has cards, a follow-up prompt
 * (handleUnhingedStrainAbsorb) lets them discard the top CC to absorb
 * the Strain, otherwise take 1 HP damage; empty deck auto-applies HP.
 * Strain target = the spending figure (resolved via pending.figureKey),
 * which may be the attacker or a Squad Cohesion / Wild-from-cohesion
 * source figure.
 */
export async function handleUnhingedDirectorChoice(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames, logGameAction, dcHealthState, findDcMessageIdForFigure } = ctx;
  const m = interaction.customId.match(/^unhinged_director_(.+?)_(plus1|plus2)$/);
  if (!m) return;
  const [, gameId, choice] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  const pending = game.pendingUnhingedDirector;
  if (!combat || combat.gameId !== gameId || !pending) {
    await interaction.followUp({ content: 'No pending Unhinged Director choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const atkPN = pending.atkPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, atkPN, canActAsPlayer, 'Only the attacker may resolve Unhinged Director.')) return;

  // Visual: disable both buttons, highlight the chosen one.
  try {
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        btn.setDisabled(true);
        if (c.customId === interaction.customId) {
          btn.setStyle(ButtonStyle.Success);
        }
        newRow.addComponents(btn);
      }
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch (_e) { /* non-fatal */ }

  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  const { tokenType, figureKey, tokenIndex, sourceLabel } = pending;
  const isPlus2 = choice === 'plus2';
  const bonusAmt = isPlus2 ? 2 : 1;
  const _srcSuffix = sourceLabel ? ` · ${sourceLabel}` : '';

  // Apply bonus directly. Bypass applyTokenBonus's unhinged check —
  // the player's choice here is the sole source of +1 vs +2.
  if (tokenType === 'Damage') combat.bonusHits = (combat.bonusHits || 0) + bonusAmt;
  if (tokenType === 'Surge')  combat.tokenSurgeBonus = (combat.tokenSurgeBonus || 0) + bonusAmt;
  removeSpentToken(game, figureKey, tokenIndex);

  await thread.send(`**Power Token spent:** +${bonusAmt} ${tokenType}${isPlus2 ? ' (Unhinged Director)' : ''}${_srcSuffix}`).catch(discordCatch);
  logGameAction?.(game, interaction.client, `🎯 **Power Token spent** — Attacker: +${bonusAmt} ${tokenType}${isPlus2 ? ' (Unhinged Director)' : ''}${_srcSuffix}`, { phase: 'ROUND', icon: 'attack' });

  // Track attacker Power Token spending for Pulse Cannon (Iden Versio).
  combat.attackerSpentPowerToken = true;
  // Field Supply (CC row 654): Unhinged Director spends are always the attacker;
  // mark a Hit (Damage) / Surge token spend for Field Supply's rerolls option.
  if (tokenType === 'Damage' || tokenType === 'Surge') combat.attackerSpentHitOrSurgeToken = true;
  clearPendingUnhingedDirector(game);

  if (!isPlus2) {
    await advanceTokenPhase(thread, game, combat, 'attacker', ctx);
    saveGames(game.gameId);
    return;
  }

  // +2 path — the SPENDING figure (not necessarily the attacker, e.g.
  // Squad Cohesion / Wild-from-cohesion) suffers 1 Strain. Per IACP,
  // Strain may be paid by discarding the TOP card of the player's CC
  // deck (1 CC = 1 Strain) or by taking 1 Damage. Player chooses;
  // empty deck → auto 1 Damage.
  const deckKey = ccDeckKey(atkPN);
  const deck = game[deckKey] || [];
  const strainDcName = dcNameFromFigureKey(figureKey);
  // Resolve the spender's DC msg + figure index from the figureKey.
  const strainMsgId = findDcMessageIdForFigure
    ? findDcMessageIdForFigure(gameId, atkPN, figureKey)
    : combat.attackerMsgId; // fallback for safety
  const _figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const strainFigIdx = _figMatch ? parseInt(_figMatch[2], 10) : 0;

  // Single applyStrain call handles BOTH the empty-deck and per-strain
  // choice cases — the canonical pipeline posts the CC-vs-damage prompt
  // (or auto-applies damage if hand is empty), runs Fireproof / Headhunter
  // / Under Duress / Paz, and chains the token-phase advance via the
  // 'unhinged_director_resume' followup.
  await applyStrain(game, ctx, {
    figureKey,
    controllerPlayerNum: atkPN,
    amount: 1,
    source: 'Unhinged Director',
    followup: {
      type: 'unhinged_director_resume',
      payload: { combatThreadId: combat.combatThreadId, gameId },
    },
  });
  saveGames(game.gameId);
}

// Strain followup for Unhinged Director: after the strain choice
// resolves, advance the token-spend phase. (Replaces the old custom
// pendingUnhingedStrain absorb prompt.)
registerStrainFollowup('unhinged_director_resume', async (game, ctx, payload) => {
  const _udThread = await fetchCombatThread(ctx.client, payload.combatThreadId);
  const _udCombat = game.pendingCombat;
  if (_udThread && _udCombat) {
    await advanceTokenPhase(_udThread, game, _udCombat, 'attacker', ctx);
  }
});

// handleUnhingedStrainAbsorb RETIRED 2026-05-09 — the custom CC-vs-damage
// prompt was a duplicate of applyStrain's per-strain choice. Strain now
// flows through the canonical applyStrain pipeline at the +2 click site
// (handleUnhingedDirectorChoice → applyStrain with 'unhinged_director_resume'
// followup that advances the token phase).

/**
 * F6 Cleave: Apply cleave damage to chosen target in melee; finish combat resolution.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcHealthState, findDcMessageIdForFigure, getDcStats, getDcEffects, logGameAction, isGroupDefeated, checkWinConditions, finishCombatResolution, updateActivationsMessage, saveGames, client
 */
export async function handleCleaveTarget(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcHealthState,
    findDcMessageIdForFigure,
    getDcStats,
    getDcEffects,
    logGameAction,
    isGroupDefeated,
    checkWinConditions,
    finishCombatResolution,
    updateActivationsMessage,
    updateAttachmentMessageForDc,
    saveGames,
    client,
    calculateKillVp,
    checkHuntDissent,
    checkThisIsTheWay,
    decrementActivationIfGroupDefeated,
    checkFriendlyDefeatedPassiveRedraws: ctxCheckFriendlyRedraws,
    checkNefariousGains: ctxCheckNefariousGains,
    ccAttachmentsKey: ctxCcAttachmentsKey,
  } = ctx;
  const match = interaction.customId.match(/^cleave_target_([^_]+)_(\d+)$/);
  if (!match) return;
  const [, gameId, indexStr] = match;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingCleave;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No cleave target selection in progress.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== pending.ownerId) {
    await interaction.followUp({ content: 'Only the attacker may choose the cleave target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const targetIndex = parseInt(indexStr, 10);
  const target = pending.targets[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { figureKey: cleaveFigureKey, playerNum: cleavePlayerNum } = target;
  const attackerPlayerNum = pending.attackerPlayerNum;
  const ownerId = pending.ownerId;
  const cleaveMsgId = findDcMessageIdForFigure(game.gameId, cleavePlayerNum, cleaveFigureKey);
  if (cleaveMsgId) {
    const cleaveM = cleaveFigureKey.match(/-(\d+)-(\d+)$/);
    const cleaveFigIndex = cleaveM ? parseInt(cleaveM[2], 10) : 0;
    const cleaveDmg = pending.surgeCleave || 0;
    const { newHp: newCCur, wasDefeated: cleaveDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client: interaction.client }, {
      figureKey: cleaveFigureKey, msgId: cleaveMsgId, figIndex: cleaveFigIndex,
      amount: cleaveDmg, controllerPlayerNum: cleavePlayerNum,
      attackerPlayerNum, source: 'Cleave',
    });
    // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage, become Focused
    if (cleaveDmg >= 3 && newCCur > 0) {
      const _fokCleaveDcList = getDcList(game, cleavePlayerNum) || [];
      if (_fokCleaveDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) {
        const _fokCleaveName = dcNameFromFigureKey(cleaveFigureKey);
        const _fokCleaveKws = (getDcKeywordsGlobal(game)[_fokCleaveName] || []).map(k => String(k).toUpperCase());
        if (_fokCleaveKws.includes('WOOKIEE')) {
          if (applyCondition(game, cleaveFigureKey, 'Focus')) {
            await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokCleaveName}** became **Focused** (suffered ${cleaveDmg} Cleave Damage).`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
    }
    {
      const cleaveDcIds = getDcMessageIds(game, cleavePlayerNum);
      const cleaveDcList = getDcList(game, cleavePlayerNum);
      const cleaveIdx = (cleaveDcIds || []).indexOf(cleaveMsgId);
      const cleaveLabel = target.label || cleaveDcList?.[cleaveIdx]?.displayName || cleaveFigureKey;
      await logGameAction(game, client, `Cleave: <@${ownerId}> dealt **${pending.surgeCleave}** damage to **${cleaveLabel}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      if (newCCur <= 0) {
        const cleaveDcName = cleaveDcList[cleaveIdx]?.dcName;
        await processFigureDefeat(game, {
          defeatedPlayerNum: cleavePlayerNum,
          figureKey: cleaveFigureKey,
          attackerPlayerNum,
          attackerFigureKey: pending.combat?.attackerFigureKey || null,
          msgId: cleaveMsgId,
          dcIdx: cleaveIdx,
          dcName: cleaveDcName,
          displayName: cleaveLabel,
          source: 'Cleave',
        }, {
          removeFigurePosition,
          calculateKillVp: calculateKillVp || ((name) => {
            const s = getDcStats(name); const e = getDcEffects()?.[name];
            return (s?.figures > 1 && e?.subCost != null) ? e.subCost : (s?.cost ?? 5);
          }),
          awardKillVp,
          dcNameFromFigureKey,
          logGameAction,
          client,
          decrementActivationIfGroupDefeated,
          ccAttachmentsKey: ctxCcAttachmentsKey || ccAttachmentsKey,
          updateAttachmentMessageForDc,
          checkFriendlyDefeatedPassiveRedraws: ctxCheckFriendlyRedraws || checkFriendlyDefeatedPassiveRedraws,
          checkNefariousGains: ctxCheckNefariousGains || checkNefariousGains,
          checkHuntDissent,
          checkThisIsTheWay,
          checkWinConditions,
        });
      }
    }
  }
  try {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
  } catch {}
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (cleaveMsgId) embedRefreshMsgIds.add(cleaveMsgId);
  // 2026-05-09 migration: when invoked from the step-8 queue
  // (fromStep8Queue: true on pendingCleave), each cleave source is
  // its own queued effect and DOES NOT chain to a next source — the
  // remaining sources will surface as their own buttons in the
  // post-resolve window. Skip the chain block + finishCombatResolution
  // and let the step-8 window handle the next click.
  if (pending.fromStep8Queue) {
    clearPendingCleave(game);
    saveGames(game.gameId);
    try {
      const { postPostResolveWindow } = await import('./after-attack-resolve.js');
      const cThread = await fetchCombatThread(client, pending.combat.combatThreadId);
      if (cThread && postPostResolveWindow) {
        await postPostResolveWindow(cThread, game, pending.combat, 'attacker', { ...ctx, client });
      }
    } catch (err) {
      console.error('[handleCleaveTarget] step-8 reopen failed:', err?.message ?? err);
    }
    return;
  }
  // CRR-CLV-005: if more Cleave sources remain, re-prompt with the next
  // source's value and a fresh eligible-target list (defeated figures drop out
  // naturally; surviving prior-cleaved targets remain eligible since each
  // Cleave independently chooses its target per the rule).
  const cleaveQueue = Array.isArray(pending.cleaveQueue) ? pending.cleaveQueue.slice() : [];
  if (cleaveQueue.length > 0) {
    const {
      computeCleaveEligibleTargets: ctxComputeCleaveEligibleTargets,
      getCleaveTargetButtons: ctxGetCleaveTargetButtons,
      getFiguresAdjacentToCoord, getMapData, getEffectiveMapSpaces, isWithinN,
      hasFigureLineOfSight, getFigureFootprint, getFigureSize, getFigureLabel,
    } = ctx;
    if (ctxComputeCleaveEligibleTargets && ctxGetCleaveTargetButtons) {
      const defPN = pending.defenderPlayerNum ?? opponentPlayerNum(pending.attackerPlayerNum);
      const nextTargets = ctxComputeCleaveEligibleTargets(game, pending.combat, defPN, {
        getFiguresAdjacentToCoord, getMapData, getEffectiveMapSpaces, isWithinN,
        hasFigureLineOfSight, getFigureFootprint, getFigureSize, getFigureLabel,
      });
      if (nextTargets.length > 0) {
        const nextSource = cleaveQueue.shift();
        const cThread = await fetchCombatThread(client, pending.combat.combatThreadId);
        setPendingCleave(game, {
          ...pending,
          surgeCleave: nextSource.value,
          sourceLabel: nextSource.label,
          cleaveQueue,
          targets: nextTargets,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        });
        if (cThread) {
          const nextRows = ctxGetCleaveTargetButtons(game.gameId, nextTargets);
          await cThread.send(sanitizeMentions({
            content: `**${nextSource.label}:** <@${pending.ownerId}> \u2014 Choose one eligible target to apply cleave damage:`,
            allowedMentions: { users: [pending.ownerId] },
            components: nextRows,
          })).catch(discordCatch);
        }
        saveGames(game.gameId);
        return;
      }
    }
  }
  clearPendingCleave(game);
  const { checkPostCombatSurges } = ctx;
  if (checkPostCombatSurges) {
    const defPN = opponentPlayerNum(pending.attackerPlayerNum);
    const cThread = await fetchCombatThread(client, pending.combat.combatThreadId);
    if (cThread) {
      const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, embedRefreshMsgIds, cThread, pending.ownerId, defPN);
      if (triggered) { saveGames(game.gameId); return; }
    }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames(game.gameId);
}

/**
 * Handle power token type-choice buttons (power_token_choice_).
 * Fired after any ability grants a generic "power token"; player picks Hit/Surge/Block/Evade.
 */
export async function handlePowerTokenChoice(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames } = ctx;
  const match = interaction.customId.match(/^power_token_choice_([^_]+)_(damage|hit|surge|block|evade)$/);
  if (!match) { await interaction.followUp({ content: 'Invalid token choice.', ephemeral: true }).catch(discordCatch); return; }
  const [, gameId, typeRaw] = match;
  const type = typeRaw === 'damage' ? 'Damage' : typeRaw === 'hit' ? 'Damage' : typeRaw[0].toUpperCase() + typeRaw.slice(1); // 'Damage', 'Surge', 'Block', 'Evade'
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingPowerTokenGrant?.grants?.length) { await interaction.followUp({ content: 'No pending token grant found.', ephemeral: true }).catch(discordCatch); return; }
  const { grants, channelId, playerNum } = game.pendingPowerTokenGrant;
  if (playerNum && !await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Not your token choice.')) return;
  game.figurePowerTokens = game.figurePowerTokens || {};
  const lines = [];
  for (const { figureKey, figName, count } of grants) {
    grantPowerTokens(game, figureKey, type, count);
    lines.push(`${figName}: ${count > 1 ? `${count}× ` : ''}**${type}**`);
  }
  // deferredMoveX (Final Stand and similar): the originating dispatch
  // staged a Move-X picker behind the power-token-choice prompt so
  // the order is "token type → move → free attack." Now that the
  // type is locked, stamp pendingMoveX and post the picker.
  const _deferredMoveX = game.pendingPowerTokenGrant?.deferredMoveX || null;
  game.pendingPowerTokenGrant = null;
  if (_deferredMoveX && _deferredMoveX.msgId && _deferredMoveX.figureKey) {
    try {
      const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
      stampPendingMoveX(game, _deferredMoveX);
      const _dmxCtx = {
        client: interaction.client, saveGames,
        logGameAction: ctx.logGameAction,
        dcMessageMeta: ctx.dcMessageMeta,
      };
      await postMoveXPicker(game, _dmxCtx, _deferredMoveX.msgId);
    } catch (err) {
      console.error('[handlePowerTokenChoice] deferredMoveX failed:', err?.message ?? err);
    }
  }
  if (channelId) {
    const ch = await fetchGameChannel(interaction.client, channelId);
    if (ch) {
      await ch.send(`**Power Token(s) granted:** ${lines.join(', ')}`).catch(discordCatch);
      // Check for overflow and prompt discard if needed
      if (game.pendingPowerTokenOverflow?.length > 0) {
        const _ptCombat = game.pendingCombat;
        if (_ptCombat && (_ptCombat.surgeRemaining || 0) > 0) {
          setPendingSurgeOverflow(game, { combatThreadId: channelId, attackerPlayerNum: playerNum });
        }
        await sendPowerTokenOverflowUI(game, gameId, ch, playerNum, saveGames);
        return; // wait for overflow resolution before continuing
      }
    }
  }
  // If mid-surge, resume surge choice UI (only if surges remain — avoids
  // incorrectly sending "ready to resolve" for non-surge token grants like Flawless Execution)
  const combat = game.pendingCombat;
  if (combat && channelId && (combat.surgeRemaining || 0) > 0) {
    const thread = await fetchCombatThread(interaction.client, channelId);
    if (thread) {
      await resumeSurgeChoiceOrResolve(game, gameId, combat, thread, ctx);
    }
  }
  saveGames(game.gameId);
}

/**
 * Handle Spread the Pain condition choice during surge phase.
 * Custom ID: spread_pain_cond_{gameId}_{stun|weaken|bleed|skip}
 */
export async function handleSpreadThePainCondPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^spread_pain_cond_([^_]+)_(stun|weaken|bleed|skip)$/);
  if (!m) { await interaction.followUp({ content: 'Invalid condition choice.', ephemeral: true }).catch(discordCatch); return; }
  const [, gameId, condRaw] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingSpreadThePainCondPick) { await interaction.followUp({ content: 'No pending condition pick.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum, combatThreadId } = game.pendingSpreadThePainCondPick;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Not your choice.')) return;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  game.pendingSpreadThePainCondPick = null;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) { saveGames(game.gameId); return; }

  const thread = await fetchCombatThread(interaction.client, combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  if (condRaw !== 'skip') {
    const cond = condRaw[0].toUpperCase() + condRaw.slice(1); // 'Stun' | 'Weaken' | 'Bleed'
    combat.spreadThePainConditions = [...(combat.spreadThePainConditions || []), cond];
    await thread.send(`**Spread the Pain** — **${cond}** chosen. Will apply post-combat.`).catch(discordCatch);
  }

  // Check for power token overflow before resuming surge
  if (game.pendingPowerTokenOverflow?.length > 0) {
    setPendingSurgeOverflow(game, { combatThreadId, attackerPlayerNum });
    await sendPowerTokenOverflowUI(game, gameId, thread, attackerPlayerNum, saveGames);
    return;
  }
  // Resume surge phase
  await resumeSurgeChoiceOrResolve(game, gameId, combat, thread, ctx);
  saveGames(game.gameId);
}

/**
 * Handle Rogue One token pick: player selects which friendly figure's power token to discard.
 * Custom ID: rogue_one_token_{gameId}_{figureKey}_{tokenIndex}  or  rogue_one_token_{gameId}_skip
 */
export async function handleRogueOneTokenPick(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames } = ctx;
  const customId = interaction.customId;
  // Parse: rogue_one_token_{gameId}_skip  OR  rogue_one_token_{gameId}_{figureKey}_{tokenIndex}
  const skipMatch = customId.match(/^rogue_one_token_([^_]+)_skip$/);
  if (skipMatch) {
    const [, gameId] = skipMatch;
    const game = await requireGame(interaction, getGame, gameId, { silent: true });
    if (!game) return;
    if (!game.pendingRogueOneTokenPick) {
      await interaction.followUp({ content: 'No pending Rogue One token pick.', ephemeral: true }).catch(discordCatch);
      return;
    }
    // Per alexanbv 2026-05-12: permission check FIRST. Wrong-player skip
    // click previously cleared the pending state AND wiped the buttons —
    // locking the real attacker out of their own Rogue One choice.
    const { attackerPlayerNum: _r1AttPN } = game.pendingRogueOneTokenPick;
    if (!await requirePlayer(interaction, game, interaction.user.id, _r1AttPN, canActAsPlayer, 'Only the attacker may skip Rogue One.')) return;
    clearPendingRogueOneTokenPick(game);
    const combat = game.pendingCombat;
    if (!combat) return;
    const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
    if (!thread) { saveGames(game.gameId); return; }
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    await thread.send('**Rogue One** — Cancelled, no token discarded.').catch(discordCatch);
    // Re-show surge UI
    await _resumeRogueOneSurgeUI(thread, game, combat, gameId, ctx);
    saveGames(game.gameId);
    return;
  }
  // Parse figureKey and tokenIndex — figureKey can contain hyphens (e.g. "Cassian Andor-1-0")
  // Format: rogue_one_token_{gameId}_{dcName}-{dgIdx}-{figIdx}_{tokenIndex}
  const prefix = 'rogue_one_token_';
  const rest = customId.slice(prefix.length); // gameId_figureKey_tokenIndex
  const firstUnderscore = rest.indexOf('_');
  if (firstUnderscore < 0) return;
  const gameId = rest.slice(0, firstUnderscore);
  const remainder = rest.slice(firstUnderscore + 1); // figureKey_tokenIndex
  const lastUnderscore = remainder.lastIndexOf('_');
  if (lastUnderscore < 0) return;
  const figureKey = remainder.slice(0, lastUnderscore);
  const tokenIndex = parseInt(remainder.slice(lastUnderscore + 1), 10);
  if (isNaN(tokenIndex)) return;

  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingRogueOneTokenPick) {
    await interaction.followUp({ content: 'No pending Rogue One token pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { attackerPlayerNum } = game.pendingRogueOneTokenPick;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Not your choice.')) return;
  clearPendingRogueOneTokenPick(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) { saveGames(game.gameId); return; }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  // Validate the token still exists
  const tokens = game.figurePowerTokens?.[figureKey] || [];
  if (tokenIndex >= tokens.length) {
    await thread.send('**Rogue One** — That token is no longer available.').catch(discordCatch);
    await _resumeRogueOneSurgeUI(thread, game, combat, gameId, ctx);
    saveGames(game.gameId);
    return;
  }
  const tokenType = tokens[tokenIndex];
  const donorDcName = dcNameFromFigureKey(figureKey);
  removeSpentToken(game, figureKey, tokenIndex);

  // Add +1 Damage to the attack
  combat.bonusHits = (combat.bonusHits || 0) + 1;
  combat.rogueOneHitsGained = (combat.rogueOneHitsGained || 0) + 1;
  await thread.send(`**Rogue One** — Discarded **${tokenType}** token from **${donorDcName}** → **+1 Damage**.`).catch(discordCatch);

  // Re-show surge UI
  await _resumeRogueOneSurgeUI(thread, game, combat, gameId, ctx);
  saveGames(game.gameId);
}

/** Helper to re-show the surge UI after Rogue One token pick resolves. */
async function _resumeRogueOneSurgeUI(thread, game, combat, gameId, ctx) {
  const remaining = combat.surgeRemaining || 0;
  if (remaining <= 0 && getRogueOneDonors(game, combat).length === 0) {
    await sendReadyToResolveRolls(thread, gameId, game, ctx);
    return;
  }
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS?.[id]) || id);
  const surgeAbilities = ctx.getAttackerSurgeAbilities ? ctx.getAttackerSurgeAbilities(combat) : [];
  // Overload (Rebel Saboteur): allow same surge to be used twice
  const _roAtkEff = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  const _roMaxUses = (_roAtkEff?.specialAbilityIds || []).includes('overload_saboteur') ? 2 : 1;
  const surgeRows = [];
  for (let i = 0; i < surgeAbilities.length; i++) {
    const k = surgeAbilities[i];
    const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
    if (cost > remaining) continue;
    if (((combat.surgeSpentCount || {})[i] || 0) >= _roMaxUses) continue;
    const label = (getSurgeLabel(k) || k).slice(0, 80);
    const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
    surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_${i}`).setLabel(btnLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary));
  }
  if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
    surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_bleed_prevention`).setLabel('Spend 1 Surge — Prevent Bleed').setStyle(ButtonStyle.Secondary));
  }
  // Rogue One: may still be usable if more donor tokens exist
  surgeRows.push(...buildRogueOneSurgeButton(game, combat));
  surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
  const surgeRowsRendered = chunkButtonsToRows(surgeRows);
  // @ the attacker so they get a notification when surge spending opens.
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const atkOwnerId = atkPlayerNum === 1 ? game.player1Id : game.player2Id;
  await thread.send({
    content: `<@${atkOwnerId}> — **Spend surge?** You have **${remaining}** surge left. Choose an ability or Done.`,
    components: surgeRowsRendered,
    allowedMentions: { users: [atkOwnerId] },
  }).catch(discordCatch);
}

// handleFigureheadDecision (combat-DAMAGE redirect) REMOVED 2026-06-20.
// Figurehead is a STRAIN reaction now (alexanbv: "Figurehead is for STRAIN not
// damage"). The trigger lives in the applyStrain pipeline and the decision is
// handled by handleFigureheadStrainDecision in strain-handler.js.

/**
 * Handle bl_friendly_ button: player picked the friendly figure to
 * make Battlefield Leadership's free attack (or skipped).
 *
 * customId: bl_friendly_{gameId}_{friendlyFigureKey|skip}
 *
 * On pick: sets up pendingMoveX (range 1, bypassCosts=true) for the
 * chosen friendly + freeAttackPrompt continuation; populates
 * game.forcedAttackTarget[friendlyMsgId] with Leia's captured target
 * so the chosen friendly's free attack is forced to the same target;
 * marks pendingBattlefieldLeadership so the attack is treated as free.
 */
export async function handleBlFriendlyPick(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames, findDcMessageIdForFigure, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^bl_friendly_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, pickRaw] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const pendingBL = game.pendingBattlefieldLeadership;
  if (!pendingBL) {
    await interaction.followUp({ content: 'No pending Battlefield Leadership.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Authority: Leia's player only.
  const ownerPN = pendingBL.playerNum;
  const ownerId = game[`player${ownerPN}Id`];
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: `Only Player ${ownerPN} (Leia's controller) may decide.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  if (pickRaw === 'skip') {
    delete game.pendingBattlefieldLeadership;
    await interaction.message.channel.send('**Battlefield Leadership** — Skipped.').catch(discordCatch);
    if (saveGames) saveGames(game.gameId);
    return;
  }
  const friendlyFigureKey = pickRaw;
  if (!pendingBL.eligibleFigureKeys.includes(friendlyFigureKey)) {
    await interaction.followUp({ content: 'That figure is not eligible.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const friendlyMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, ownerPN, friendlyFigureKey) : null;
  if (!friendlyMsgId) {
    await interaction.followUp({ content: `Could not locate the DC message for ${friendlyFigureKey}.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const capturedTarget = pendingBL.capturedTargetFigureKey;
  // Mark the friendly's upcoming attack as a BL free attack (so combat
  // treats it as no-action-cost) via the canonical interrupt module.
  const { setPendingBattlefieldLeadership: _setBL } = await import('../game/interrupts.js');
  _setBL(game, {
    forMsgId: friendlyMsgId,
    chosenFigureKey: friendlyFigureKey,
    triggeredByMsgId: pendingBL.leiaMsgId,
  });
  // Force the friendly's attack to target the figure Leia just attacked.
  // Per alexanbv 2026-05-13: keyed by friendly figureKey.
  game.forcedAttackTarget = game.forcedAttackTarget || {};
  game.forcedAttackTarget[friendlyFigureKey] = capturedTarget;
  // Set up the 1-space MOVE-X with bypassCosts + free-attack prompt.
  game.pendingMoveX = game.pendingMoveX || {};
  game.pendingMoveX[friendlyMsgId] = {
    remaining: 1,
    source: 'Battlefield Leadership',
    playerNum: ownerPN,
    figureKey: friendlyFigureKey,
    dcName: dcNameFromFigureKey(friendlyFigureKey),
    threadId: null,
    msgId: friendlyMsgId,
    bypassCosts: true,
    nextAction: {
      type: 'freeAttackPrompt',
      payload: {
        msgId: friendlyMsgId,
        playerNum: ownerPN,
        figureKey: friendlyFigureKey,
        sourceLabel: 'Battlefield Leadership',
      },
    },
  };
  delete game.pendingBattlefieldLeadership;
  await logGameAction?.(game, client,
    `**Battlefield Leadership** — **${dcNameFromFigureKey(friendlyFigureKey)}** may move up to 1 space (terrain ignored), then perform a free attack against **${dcNameFromFigureKey(capturedTarget)}**.`,
    { phase: 'ROUND', icon: 'attack' });
  // Post the Move-X picker to kick off the move + free-attack chain.
  const { postMoveXPicker } = await import('./move-x-handler.js');
  await postMoveXPicker(game, ctx, friendlyMsgId).catch((err) => console.error('BL move-X picker failed:', err));
  if (saveGames) saveGames(game.gameId);
}

/**
 * Handle on-declare die-swap button: Vanguard (AT-RT) or EE-3 Carbine
 * (Boba Fett). Fires inside the attacker's on-declare window in step
 * 1/2 of the attack sequence, alongside on-declare CCs/tokens.
 *
 * customId: od_dieswap_{v|e}_{color|skip}_{gameId}
 *   v = vanguard (no MP cost; target must be within 3)
 *   e = ee3_carbine (2 MP cost)
 */
/**
 * Generic defender-die-removal picker (alexanbv 2026-05-11). Fires at
 * the defense roll when any attacker effect (Verena CQ, Element of
 * Surprise, Wild Fire, etc.) targets a multi-die defender. Builds one
 * button per base die + sends a ping to the attacker.
 */
async function _postDefenseDieRemovePicker(thread, game, combat, baseDice, picksNeeded) {
  const attackerPN = combat.attackerPlayerNum;
  const ownerId = getPlayerId(game, attackerPN);
  const buttons = baseDice.map((color, idx) =>
    new ButtonBuilder()
      .setCustomId(`def_remove_pick_${game.gameId}_${idx}`)
      .setLabel(`Remove ${color} die #${idx + 1}`)
      .setStyle(ButtonStyle.Danger),
  );
  combat._defPickRemovePool = baseDice;
  combat._defPickRemoveTargetCount = picksNeeded;
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> — Pick **${picksNeeded}** defense die${picksNeeded > 1 ? 's' : ''} to remove from defender's pool [${baseDice.join(', ')}]:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(buttons)],
  })).catch(discordCatch);
}

/**
 * def_remove_pick_{gameId}_{idx}: attacker picks a defense die to remove.
 * Multi-pick supported (e.g. Wild Fire removes 2). Picks accumulate in
 * combat._defPickRemoveIdxList; once length === target, the next
 * defense Roll click proceeds. Backward-compat alias for the legacy
 * cq_def_pick_ prefix routes here too.
 */
export async function handleCqDefPick(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const m = interaction.customId.match(/^(?:def_remove_pick|cq_def_pick)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const idx = parseInt(idxStr, 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPN = combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPN, canActAsPlayer, 'Only the attacker may pick.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  const pool = combat._defPickRemovePool || [];
  const target = combat._defPickRemoveTargetCount || 1;
  combat._defPickRemoveIdxList = combat._defPickRemoveIdxList || [];
  if (idx < 0 || idx >= pool.length) {
    await interaction.followUp({ content: 'Invalid die index.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (combat._defPickRemoveIdxList.includes(idx)) {
    await interaction.followUp({ content: 'That die is already picked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  combat._defPickRemoveIdxList.push(idx);
  const chosenColor = pool[idx];
  if (combat._defPickRemoveIdxList.length >= target) {
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    const picks = combat._defPickRemoveIdxList.map((i) => `${pool[i]} #${i + 1}`).join(', ');
    await interaction.message.channel.send(`✅ Removing **${picks}** from defender's pool.`).catch(discordCatch);
  } else {
    await interaction.message.channel.send(`Picked **${chosenColor}** #${idx + 1}. Pick ${target - combat._defPickRemoveIdxList.length} more.`).catch(discordCatch);
  }
  if (saveGames) saveGames(game.gameId);
}

/**
 * Build the attacker's attack-die POOL (base + bonus dice colors), before any
 * remove/keep trimming. Shared by both attack-roll sites and the attack-die
 * picker so the index space the picker shows matches the pool that gets rolled.
 */
function _buildAttackPool(combat) {
  const baseDice = combat.attackInfo?.dice || [];
  const bonusDice = combat.attackBonusDice || 0;
  const bonusColors = combat.attackBonusDiceColors || [];
  const primaryColor = baseDice[0] || 'red';
  const dice = [...baseDice];
  for (let i = 0; i < bonusDice; i++) dice.push(bonusColors[i] ?? primaryColor);
  return dice;
}

/**
 * Resolve a choice-driven attack-pool trim for Run for Cover (defender chooses
 * 1+ die to REMOVE) / Savage Vigor (attacker chooses 2 to KEEP). Returns:
 *   { needPicker, owner, mode, target, pool } when a picker must be posted, or
 *   { dice }                                   when no choice is needed.
 * `combat._atkPickIdxList` (set by the picker handler) takes precedence and is
 * consulted to produce the final dice list. No-choice cases keep the legacy
 * slice() behavior (single-die pools, homogeneous, or no flag).
 */
function _resolveAttackPoolTrim(combat) {
  const pool = _buildAttackPool(combat);
  const removeMax = combat.attackPoolRemoveMax || 0;
  const keepMax = (typeof combat.attackPoolKeepMax === 'number') ? combat.attackPoolKeepMax : null;
  // How many dice the player must pick, and who picks: Run for Cover (defender,
  // remove N) takes precedence over Savage Vigor (attacker, keep N); a pool can
  // realistically carry only one of these flags per attack.
  let mode = null, target = 0, owner = null;
  if (removeMax > 0) {
    mode = 'remove';
    target = Math.min(removeMax, pool.length);
    owner = combat.defenderPlayerNum ?? (combat.attackerPlayerNum ? opponentPlayerNum(combat.attackerPlayerNum) : null);
  } else if (keepMax != null && keepMax > 0 && pool.length > keepMax) {
    mode = 'keep';
    target = keepMax;
    owner = combat.attackerPlayerNum;
  }
  // If a pick list is already recorded, apply it.
  if (Array.isArray(combat._atkPickIdxList) && combat._atkPickIdxList.length > 0 && pool.length > 1) {
    const picked = new Set(combat._atkPickIdxList);
    const dice = combat._atkPickMode === 'keep'
      ? pool.filter((_, i) => picked.has(i))   // keep the picked dice
      : pool.filter((_, i) => !picked.has(i)); // remove the picked dice
    return { dice };
  }
  // Only offer a picker when there is a real choice (heterogeneous pool with
  // >1 die and more dice than the trim leaves). Otherwise fall back to slice().
  const distinctColors = new Set(pool.map((c) => String(c).toLowerCase())).size;
  const picksMeaningful = mode && pool.length > 1 && target > 0 && target < pool.length && distinctColors > 1;
  if (picksMeaningful && owner != null) {
    return { needPicker: true, owner, mode, target, pool };
  }
  // No meaningful choice — preserve legacy deterministic trim.
  let dice = [...pool];
  if (removeMax > 0) dice = dice.slice(0, Math.max(0, dice.length - removeMax));
  if (keepMax != null && keepMax > 0 && dice.length > keepMax) dice = dice.slice(0, keepMax);
  return { dice };
}

/**
 * Post the attack-die picker (Run for Cover / Savage Vigor). One button per
 * pool die; pings the OWNER (defender for remove, attacker for keep). The
 * `handleAtkPick` handler accumulates picks into combat._atkPickIdxList and the
 * next attack-roll click consumes them. Mirrors _postDefenseDieRemovePicker.
 */
async function _postAttackDiePicker(thread, game, combat, pool, target, owner, mode) {
  const ownerId = getPlayerId(game, owner);
  const verb = mode === 'keep' ? 'Keep' : 'Remove';
  const buttons = pool.map((color, idx) =>
    new ButtonBuilder()
      .setCustomId(`atk_die_pick_${game.gameId}_${idx}`)
      .setLabel(`${verb} ${color} die #${idx + 1}`)
      .setStyle(mode === 'keep' ? ButtonStyle.Primary : ButtonStyle.Danger),
  );
  combat._atkPickPool = pool;
  combat._atkPickTargetCount = target;
  combat._atkPickMode = mode;
  combat._atkPickOwnerPN = owner;
  combat._atkPickIdxList = combat._atkPickIdxList || [];
  const what = mode === 'keep' ? 'keep' : 'remove';
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> — Pick **${target}** attack die${target > 1 ? 's' : ''} to ${what} from the attack pool [${pool.join(', ')}]:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(buttons)],
  })).catch(discordCatch);
}

/**
 * atk_die_pick_{gameId}_{idx}: owner picks an attack die (remove → Run for
 * Cover, keep → Savage Vigor). Picks accumulate in combat._atkPickIdxList; once
 * length === target, the next attack Roll click proceeds with the trimmed pool.
 */
export async function handleAtkDiePick(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const m = interaction.customId.match(/^atk_die_pick_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const idx = parseInt(idxStr, 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ownerPN = combat._atkPickOwnerPN;
  if (!await requirePlayer(interaction, game, interaction.user.id, ownerPN, canActAsPlayer, 'Only the choosing player may pick.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  const pool = combat._atkPickPool || [];
  const target = combat._atkPickTargetCount || 1;
  const mode = combat._atkPickMode || 'remove';
  combat._atkPickIdxList = combat._atkPickIdxList || [];
  if (idx < 0 || idx >= pool.length) {
    await interaction.followUp({ content: 'Invalid die index.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (combat._atkPickIdxList.includes(idx)) {
    await interaction.followUp({ content: 'That die is already picked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  combat._atkPickIdxList.push(idx);
  const chosenColor = pool[idx];
  const verb = mode === 'keep' ? 'Keeping' : 'Removing';
  if (combat._atkPickIdxList.length >= target) {
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    const picks = combat._atkPickIdxList.map((i) => `${pool[i]} #${i + 1}`).join(', ');
    await interaction.message.channel.send(`✅ ${verb} **${picks}** ${mode === 'keep' ? 'in' : 'from'} the attack pool. The attacker may now roll.`).catch(discordCatch);
  } else {
    await interaction.message.channel.send(`Picked **${chosenColor}** #${idx + 1}. Pick ${target - combat._atkPickIdxList.length} more.`).catch(discordCatch);
  }
  if (saveGames) saveGames(game.gameId);
}

export async function handleOnDeclareDieSwap(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames, client } = ctx;
  // Front Line variant (kind='f'): choice is 'swap' or 'skip' (no color
  // since Front Line is always blue→red).
  const m = interaction.customId.match(/^od_dieswap_([vef])_([^_]+)_(.+)$/);
  if (!m) return;
  const [, kind, choice, gameId] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat) {
    await interaction.followUp({ content: 'No pending attack.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Authority: attacker only.
  const ownerPN = combat.attackerPlayerNum;
  const ownerId = game[`player${ownerPN}Id`];
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: `Only the attacker (Player ${ownerPN}) may decide this.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  const decidedFlag = kind === 'v' ? '_vanguardOnDeclareDecided'
    : kind === 'e' ? '_ee3OnDeclareDecided'
    : '_frontLineSwapDecided';
  if (combat[decidedFlag]) {
    await interaction.followUp({ content: 'Already decided for this attack.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Front Line variant: 'swap' or 'skip'.
  if (kind === 'f') {
    if (choice === 'skip') {
      combat[decidedFlag] = true;
      try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
      await interaction.message.channel.send('**Front Line** — Swap skipped (+2 Accuracy still applies).').catch(discordCatch);
      if (saveGames) saveGames(game.gameId);
      return;
    }
    // 'swap': set flag — actual swap happens in handleAttackTarget's
    // modifier block (consults combat._frontLineSwap).
    combat._frontLineSwap = true;
    combat[decidedFlag] = true;
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    await interaction.message.channel.send('**Front Line** — Blue → Red swap will apply.').catch(discordCatch);
    if (saveGames) saveGames(game.gameId);
    return;
  }
  // For EE-3 (kind='e'): re-check 2 MP available, deduct on apply.
  if (kind === 'e' && choice !== 'skip') {
    const _ee3FigIdx = parseInt(String(combat.attackerFigureKey || '').split('-').pop(), 10);
    const ee3FigIdx = Number.isInteger(_ee3FigIdx)
      ? _ee3FigIdx
      : (game.dcActionsData?.[combat.attackerMsgId]?.selectedFigure ?? 0);
    const mp = figureMpRemaining(game, combat.attackerMsgId, ee3FigIdx);
    if (mp < 2) {
      await interaction.followUp({ content: `EE-3 Carbine needs 2 MP (you have ${mp}).`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // For Vanguard (kind='v'): re-check target within 3.
  if (kind === 'v' && choice !== 'skip') {
    const distance = combat.distanceAtDeclare ?? combat.target?.distance ?? null;
    if (distance != null && distance > 3) {
      await interaction.followUp({ content: `Vanguard target must be within 3 spaces (target is ${distance}).`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }

  if (choice === 'skip') {
    combat[decidedFlag] = true;
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    const label = kind === 'v' ? 'Vanguard' : 'EE-3 Carbine';
    await interaction.message.channel.send(`**${label}** — Skipped.`).catch(discordCatch);
    if (saveGames) saveGames(game.gameId);
    return;
  }

  // Apply the swap: replace one die of `choice` color with red in
  // combat.attackInfo.dice. EE-3 also deducts 2 MP.
  const dice = [...(combat.attackInfo?.dice || [])];
  const idx = dice.indexOf(choice);
  if (idx === -1) {
    await interaction.followUp({ content: `No ${choice} die in the attack pool.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  dice[idx] = 'red';
  combat.attackInfo = { ...combat.attackInfo, dice };
  combat[decidedFlag] = true;
  if (kind === 'e') {
    const _ee3FigIdx = parseInt(String(combat.attackerFigureKey || '').split('-').pop(), 10);
    const ee3FigIdx = Number.isInteger(_ee3FigIdx)
      ? _ee3FigIdx
      : (game.dcActionsData?.[combat.attackerMsgId]?.selectedFigure ?? 0);
    consumeMovementPoints(game, combat.attackerMsgId, 2, ee3FigIdx);
  }
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  const label = kind === 'v' ? 'Vanguard' : 'EE-3 Carbine';
  const costSuffix = kind === 'e' ? ' (-2 MP)' : '';
  await interaction.message.channel.send(`**${label}** — ${choice[0].toUpperCase() + choice.slice(1)} → Red${costSuffix}.`).catch(discordCatch);
  if (saveGames) saveGames(game.gameId);
}

// ─── False Orders combat handler ──────────────────────────────────────────────

/**
 * Handle false_orders_atk_ button: set up combat with the controlled figure attacking a target.
 * customId: false_orders_atk_{gameId}_{msgId}_{targetIdx}
 */
export async function handleFalseOrdersAtkPick(interaction, ctx) {
  const m = interaction.customId.match(/^false_orders_atk_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, msgId, targetIdxStr] = m;
  const targetIdx = parseInt(targetIdxStr, 10);
  const { getGame, replyIfGameEnded, getDcStats, getDcEffects, dcHealthState, logGameAction, ACTION_ICONS, ThreadAutoArchiveDuration, saveGames, client } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const fo = game.pendingFalseOrders;
  if (!fo || (!fo.isLure && fo.murneRinMsgId !== msgId)) {
    await interaction.followUp({ content: 'No pending False Orders / Lure.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { controllerPlayerNum, controlledFigureKey, controlledPlayerNum } = fo;
  if (!await requirePlayer(interaction, game, interaction.user.id, controllerPlayerNum, canActAsPlayer, 'Only the controller may choose.')) return;
  // Per alexanbv 2026-05-13: keyed by controlledFigureKey.
  const targets = game.falseOrdersAttackTargets?.[controlledFigureKey];
  const target = targets?.[targetIdx];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (game.falseOrdersAttackTargets) delete game.falseOrdersAttackTargets[controlledFigureKey];
  clearPendingFalseOrders(game);
  const controlledName = dcNameFromFigureKey(controlledFigureKey);
  const controlledStats = getDcStats(controlledName);
  const attackInfo = controlledStats?.attack || { dice: ['red'], range: [1, 3] };
  const targetDcName = dcNameFromFigureKey(target.figureKey);
  const targetStats = getDcStats(targetDcName);
  const targetEff = getDcEffect(targetDcName);
  const defenderPlayerNum = opponentPlayerNum(controlledPlayerNum);
  const controllerUserName = getPlayerDisplayName(game, controllerPlayerNum, client);
  const defenderUserName = getPlayerDisplayName(game, defenderPlayerNum, client);
  const combatDeclare = `**False Orders** — ${controllerUserName} controls **${controlledName}** attacking **${defenderUserName}**'s **${target.label}**!`;
  const generalChannel = await fetchGameChannel(client, game.generalId);
  const declareMsg = await generalChannel.send({
    content: `${ACTION_ICONS?.attack || '⚔️'} <t:${Math.floor(Date.now() / 1000)}:t> — ${combatDeclare}`,
    allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) },
  });
  const _foThreadCtl = `${controllerUserName}: ${controlledName}`.slice(0, 40);
  const _foThreadDef = `${defenderUserName}: ${target.label}`.slice(0, 40);
  const thread = await declareMsg.startThread({
    name: `Combat (False Orders) — ${_foThreadCtl} → ${_foThreadDef}`,
    autoArchiveDuration: ThreadAutoArchiveDuration?.OneWeek ?? 10080,
  });
  const preCombatMsg = await thread.send({
    content: `<@${game.player1Id}> <@${game.player2Id}> — **Combat opened (False Orders).** Each side: on-declare CCs / abilities / power tokens (combined window), then click Ready. Dice auto-roll once both sides are ready.`,
    allowedMentions: { users: snowflakeUsers([game.player1Id, game.player2Id]) },
  });
  const isRanged = attackInfo.type === 'range';
  // Slice 7.2: same nested-frame guard as the primary attack-init path.
  if (game.pendingCombat) {
    pushNestedCombat(game);
  }
  game.pendingCombat = {
    gameId,
    attackerPlayerNum: controlledPlayerNum,
    defenderPlayerNum,
    attackerMsgId: msgId,
    attackerDcName: controlledName,
    attackerDisplayName: controlledName,
    attackerFigureKey: controlledFigureKey,
    attackerConds: game.figureConditions?.[controlledFigureKey] || [],
    defenderConds: game.figureConditions?.[target.figureKey] || [],
    // Slice 8.4 follow-up: per-side condition-effects-suppression flags
    // (YWNDM-on-Fifth-Brother). Mirrors primary attack init.
    attackerCondEffectsSuppressed: areConditionEffectsSuppressed(game, controlledFigureKey),
    defenderCondEffectsSuppressed: areConditionEffectsSuppressed(game, target.figureKey),
    target: { ...target },
    targetStats: {
      defense: targetStats?.defense || 'white',
      cost: targetStats?.cost ?? 5,
      subCost: targetEff?.subCost,
      figures: targetStats?.figures ?? 1,
    },
    attackInfo,
    isRanged,
    distanceToTarget: target.dist ?? 1,
    combatThreadId: thread.id,
    combatDeclareMsgId: declareMsg.id,
    combatPreMsgId: preCombatMsg.id,
    // Session 11 retirement: legacy p1Ready/p2Ready replaced by per-step
    // `acked` map. See primary attack init for context.
    currentStep: 'step1+2-attacker',
    acked: {},
    attackRoll: null,
    defenseRoll: null,
    attackTargetMsgId: interaction.message.id,
    falseOrdersControllerPlayerNum: controllerPlayerNum,
    isLure: !!fo.isLure,
    lurePostAttackStrain: fo.postAttackStrain || 0,
    // Per destruct 2026-05-07: "No figures are considered friendly during
    // this attack" (Lure of the Dark Side / False Orders). All
    // attacker-side AND defender-side "friendly" gates (Sentinel,
    // Protector, Get Behind Me, Fury of Kashyyyk Pierce, This is the
    // Way, Coordinated Hunt, etc.) consult this flag and treat all
    // figures as non-friendly when set.
    noFriendliesActive: true,
  };
  const controlledEff = getDcEffect(controlledName);
  const defEff = getDcEffect(targetDcName);
  applyDcPassivesToCombat(game.pendingCombat, controlledStats?.passives || [], targetStats?.passives || [], {
    attackerDcName: controlledName,
    defenderDcName: targetDcName,
  });
  const abilityLabel = fo.isLure ? 'Lure of the Dark Side' : 'False Orders';
  await interaction.message.edit({ content: `**${abilityLabel} — Attack declared**. See thread in Game Log.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `⚔️ **${abilityLabel}** — **${controllerUserName}** controlling **${controlledName}** attacks **${targetDcName}**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  // GATE CUTOVER (alexanbv 2026-06-16): False Orders / Lure attacks walk the
  // gate sequence like every other attack. The gate is False-Orders-aware
  // (on-declare/mods CC offers + the attack roll route through
  // falseOrdersControllerPlayerNum).
  await runAttackSequence(thread, game, game.pendingCombat, ctx);
  saveGames(game.gameId);
}

/**
 * Cover Fire — Block Token distribution picker.
 * cover_fire_block_{gameId}_{playerNum}_{figureKey}
 */
export async function handleCoverFireBlock(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client, findDcMessageIdForFigure } = ctx;
  const match = interaction.customId.match(/^cover_fire_block_(\d+)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, playerNumStr, figureKey] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the attacker can choose.')) return;
  grantPowerTokens(game, figureKey, 'Block', 1);
  clearPendingCoverFire(game);
  const dcName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({ content: `🛡️ **Cover Fire** — **${dcName}** received 1 Block Token.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `🛡️ **Cover Fire** — **${dcName}** gained 1 Block Token.`, { phase: 'ROUND', icon: 'card' });
  // G73: Check for power token overflow
  if (game.pendingPowerTokenOverflow?.length > 0) {
    const ch = await fetchGameChannel(interaction.client, interaction.channelId);
    if (ch) await sendPowerTokenOverflowUI(game, gameId, ch, playerNum, saveGames);
    return;
  }
  saveGames(game.gameId);
}

/**
 * Squad Command (Kayn Somos) — Focus a chosen adjacent friendly TROOPER.
 * squad_command_focus_{gameId}_{playerNum}_{figureKey}
 * Posted by combat-bridge when 2+ TROOPERs are eligible (player chooses which).
 */
export async function handleSquadCommandFocus(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  const match = interaction.customId.match(/^squad_command_focus_(\d+)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, playerNumStr, figureKey] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the attacker can choose.')) return;
  // Guard double-clicks / ensure this figure was a valid candidate.
  const pend = game.pendingSquadCommand;
  if (!pend || !Array.isArray(pend.candidates) || !pend.candidates.includes(figureKey)) {
    await interaction.message.edit({ content: '**Squad Command** — already resolved.', components: [] }).catch(discordCatch);
    return;
  }
  const hasACS = !!pend.hasACS;
  delete game.pendingSquadCommand;
  const dcName = dcNameFromFigureKey(figureKey);
  applyCondition(game, figureKey, 'Focus');
  await interaction.message.edit({ content: `**Squad Command**${hasACS ? ' (ACS within 3)' : ''} — **${dcName}** is now **Focused**.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `**Squad Command**${hasACS ? ' (ACS within 3)' : ''} — **${dcName}** is now **Focused**`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

/**
 * Cover Fire — Discard a condition or Power Token from the target.
 * cover_fire_discard_{gameId}_{type}_{index}_{figureKey}
 * cover_fire_discard_skip_{gameId}
 */
export async function handleCoverFireDiscard(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, logGameAction, client } = ctx;
  // Skip button
  if (interaction.customId.startsWith('cover_fire_discard_skip_')) {
    const skipGameId = parseCustomId(interaction.customId, 'cover_fire_discard_skip_');
    const skipGame = await requireGame(interaction, getGame, skipGameId, { silent: true });
    if (skipGame) clearPendingCoverFire(skipGame);
    await interaction.message.edit({ content: '🛡️ **Cover Fire** — Skipped condition/token removal.', components: [] }).catch(discordCatch);
    if (skipGame) saveGames(game.gameId);
    return;
  }
  const match = interaction.customId.match(/^cover_fire_discard_(\d+)_(condition|token)_(\d+)_(.+)$/);
  if (!match) return;
  const [, gameId, type, indexStr, figureKey] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const dcName = dcNameFromFigureKey(figureKey);
  clearPendingCoverFire(game);
  if (type === 'condition') {
    const conds = game.figureConditions?.[figureKey] || [];
    const idx = parseInt(indexStr, 10);
    if (idx < conds.length) {
      const removed = conds[idx];
      filterCondition(game, figureKey, removed);
      await interaction.message.edit({ content: `🛡️ **Cover Fire** — Discarded **${removed}** from **${dcName}**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `🛡️ **Cover Fire** — Discarded **${removed}** from **${dcName}**.`, { phase: 'ROUND', icon: 'card' });
    }
  } else if (type === 'token') {
    const tokens = game.figurePowerTokens?.[figureKey] || [];
    const idx = parseInt(indexStr, 10);
    if (idx < tokens.length) {
      const removed = tokens[idx];
      tokens.splice(idx, 1);
      game.figurePowerTokens[figureKey] = tokens;
      await interaction.message.edit({ content: `🛡️ **Cover Fire** — Discarded **${removed} Token** from **${dcName}**.`, components: [] }).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `🛡️ **Cover Fire** — Discarded **${removed} Token** from **${dcName}**.`, { phase: 'ROUND', icon: 'card' });
    }
  }
  saveGames(game.gameId);
}

/**
 * Handle the post-surge Zillo Pierce cancel prompt. On "use", exhaust the
 * Zillo Technique card and add 2 to defenderReducePierce. Either way,
 * re-enter sendReadyToResolveRolls to advance to the pre_resolve gate.
 */
export async function handleZilloPierceCancel(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isUse = interaction.customId.startsWith('zillo_pierce_use_');
  const gameId = parseCustomId(interaction.customId, isUse ? 'zillo_pierce_use_' : 'zillo_pierce_skip_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }
  const defPN = combat.defenderPlayerNum;
  const ownerId = getPlayerId(game, defPN);
  if (interaction.user.id !== ownerId && !game.isTestGame) {
    await interaction.followUp({ content: 'Only the defender can choose this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (isUse) {
    const ztMsgId = combat.zilloPierceCancelMsgId;
    if (ztMsgId) {
      exhaustAttachment(game, ztMsgId, 'Zillo Technique');
    }
    combat.defenderReducePierce = (combat.defenderReducePierce || 0) + 2;
    await interaction.message.edit({
      content: '**Zillo Technique** — Exhausted: Pierce reduced by 2 for this attack.',
      components: [],
    }).catch(discordCatch);
  } else {
    await interaction.message.edit({
      content: '**Zillo Technique** — Skipped (Pierce not cancelled).',
      components: [],
    }).catch(discordCatch);
  }
  saveGames(game.gameId);
  if (thread) await sendReadyToResolveRolls(thread, gameId, game, ctx);
}

// ─── Power Token Overflow (G73) ─────────────────────────────────────────────

// sendPowerTokenOverflowUI + TOKEN_EMOJI live in src/discord/power-token-prompts.js
// (re-exported below for back-compat with handlers that import from here).

/**
 * Handle overflow discard button: pt_overflow_{gameId}_{playerNum}_{figureKey}_{tokenIndex}
 */
export async function handlePowerTokenOverflowDiscard(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames } = ctx;
  const match = interaction.customId.match(/^pt_overflow_(\d+)_(\d+)_(.+)_(\d+)$/);
  if (!match) {
    await interaction.followUp({ content: 'Invalid overflow discard.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, playerNumStr, figureKey, indexStr] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const tokenIndex = parseInt(indexStr, 10);
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Not your token to discard.')) return;

  // Validate we still have a pending overflow for this figure
  const overflowArr = game.pendingPowerTokenOverflow;
  if (!overflowArr?.length || !overflowArr.some(e => e.figureKey === figureKey && e.discardCount > 0)) {
    await interaction.followUp({ content: 'No pending overflow for this figure.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const { discarded, remaining } = resolveOverflowDiscard(game, figureKey, tokenIndex);
  if (!discarded) {
    await interaction.followUp({ content: 'Invalid token index.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const figName = dcNameFromFigureKey(figureKey);
  const emoji = TOKEN_EMOJI[discarded] || '';

  if (remaining > 0) {
    // Still need more discards — rebuild the buttons with updated indices
    const tokens = game.figurePowerTokens?.[figureKey] || [];
    const btns = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const te = TOKEN_EMOJI[t] || '';
      btns.push(
        new ButtonBuilder()
          .setCustomId(`pt_overflow_${gameId}_${playerNum}_${figureKey}_${i}`)
          .setLabel(`${te} ${t}`.trim())
          .setStyle(ButtonStyle.Secondary)
      );
    }
    const rows = chunkButtonsToRows(btns);
    const max = getMaxPowerTokens(figureKey);
    const tokenList = tokens.map(t => `${TOKEN_EMOJI[t] || ''} ${t}`).join(', ');
    await interaction.message.edit({
      content: `⚠️ **Power Token Overflow** — **${figName}** discarded ${emoji} **${discarded}**. Still has **${tokens.length}** tokens (max ${max}). ` +
        `Discard **${remaining}** more.\n` +
        `Current tokens: ${tokenList}\n` +
        `Choose which token to discard:`,
      components: rows,
    }).catch(discordCatch);
  } else {
    // Overflow resolved
    const tokens = game.figurePowerTokens?.[figureKey] || [];
    const tokenList = tokens.map(t => `${TOKEN_EMOJI[t] || ''} ${t}`).join(', ');
    await interaction.message.edit({
      content: `✅ **${figName}** discarded ${emoji} **${discarded}**. Tokens: ${tokenList || 'none'}`,
      components: [],
    }).catch(discordCatch);

    // Check if there are more figures with overflow
    if (game.pendingPowerTokenOverflow?.length > 0) {
      const nextEntry = game.pendingPowerTokenOverflow[0];
      const ch = await fetchGameChannel(interaction.client, nextEntry.channelId || interaction.channelId);
      if (ch) {
        await sendPowerTokenOverflowUI(game, gameId, ch, nextEntry.playerNum || playerNum, saveGames);
        return; // saveGames already called
      }
    }

    // Resume surge flow if overflow originated from surge resolution
    if (game.pendingSurgeOverflow) {
      const { combatThreadId, attackerPlayerNum: atkNum } = game.pendingSurgeOverflow;
      clearPendingSurgeOverflow(game);
      const combat = game.pendingCombat;
      if (combat && combatThreadId) {
        const surgeThread = await fetchCombatThread(interaction.client, combatThreadId);
        if (surgeThread) {
          await resumeSurgeChoiceOrResolve(game, gameId, combat, surgeThread, ctx);
        }
      }
    }
  }
  saveGames(game.gameId);
}

/**
 * Driven by Hatred die-pick handler — Vader's controller picks which die
 * to remove from the attack pool on the EOR interrupt attack. Card text:
 * "When you declare this attack, remove 1 die from your attack pool."
 *
 * Per destruct 2026-05-06: any ability with multiple legal options must
 * prompt the player. The previous auto-pick (weakest die first) was
 * removed at combat.js:1778 and replaced with a button prompt that sets
 * game.pendingDbhDiePick. This handler resolves that prompt.
 *
 * customId format: dbh_pick_die_<gameId>_<color>
 */
export async function handleDbhPickDie(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  const m = interaction.customId.match(/^dbh_pick_die_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, color] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingDbhDiePick;
  if (!pending) {
    await interaction.followUp({ content: 'Driven by Hatred die-pick is no longer pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const combat = game.pendingCombat;
  if (!combat) {
    delete game.pendingDbhDiePick;
    saveGames(game.gameId);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only Vader\'s controller can pick the die.')) return;
  const dice = [...(combat.attackInfo?.dice || [])];
  const idx = dice.indexOf(color);
  if (idx < 0) {
    await interaction.followUp({ content: `No ${color} die in the attack pool.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  dice.splice(idx, 1);
  combat.attackInfo = { ...combat.attackInfo, dice };
  delete game.pendingDbhDiePick;
  await interaction.message.edit({
    content: `**Driven by Hatred** — ${color} die removed from attack pool. Pool is now: ${dice.length ? dice.join(', ') : '(empty)'}.`,
    components: [],
  }).catch(discordCatch);
  saveGames(game.gameId);
}
