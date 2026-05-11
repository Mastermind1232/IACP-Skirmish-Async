/**
 * Combat handlers: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { COLORS } from '../discord/colors.js';
import { setPendingCelebration, setPendingCleave, clearPendingCleave, clearPendingCoverFire, clearPendingFalseOrders, setPendingStrainChoice, clearPendingStrainChoice, setPendingIllicitArms, setPendingThereIsNoTry, setPendingPowerConverter, setPendingZilloDiscard, clearPendingZilloDiscard, clearPendingFieldTactics, clearPendingExecutiveOrder, clearPendingCoordinatedRaid, setPendingSurgeOverflow, clearPendingSurgeOverflow, setPendingToughLuck, setPendingRogueOneTokenPick, clearPendingRogueOneTokenPick, setPendingStrikeMeDown, setPendingSlowOnTheDraw, setPendingForceExhaustion, clearPendingFigurehead, clearPendingEmperorInterrupt, clearPendingBombardmentSorin, clearPendingBattlefieldLeadership, setPendingHunterProtocol, setPendingUnhingedDirector, clearPendingUnhingedDirector, } from '../game/interrupts.js';
import { sendPowerTokenOverflowUI, TOKEN_EMOJI } from '../discord/power-token-prompts.js';
import { applyStrain, registerStrainFollowup } from './strain-handler.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { consumeActionForCurrentFigure } from '../game/activation-state.js';
export { sendPowerTokenOverflowUI };
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { pushNestedCombat, resolvePendingCombat } from '../game/combat-stack.js';
import { getMapData, getMapTokensData, getDcEffects as getDcEffectsGlobal, getDcKeywords as getDcKeywordsGlobal, getLoadoutCards, getFormCards, getFigureSize, getDeploymentZones, getMissionCardsData } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { isWithinSpaces as _isWithinSpaces, countSpaces } from '../game/spatial.js';
import { cardNameIncludes } from '../game/card-names.js';
import { canOfferForceExhaustion } from '../game/force-exhaustion-helpers.js';
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
import {
  hasHunkerDownAbility,
  hasQualifyingTerrainAdjacent,
  applyHunkerDownEvade,
} from '../game/hunker-down-helpers.js';
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
import {
  hasMuchToLearnAbility,
  muchToLearnInRange,
  isUniqueFriendly,
  isForceUserFriendly,
  applyMuchToLearnReroll,
} from '../game/much-to-learn-helpers.js';
import {
  hasAdvTargetingComputerAbility,
  advTcRerollLostHits,
  applyAdvTcHitBonus,
  ADV_TARGETING_COMPUTER_CONDITION,
  ADV_TARGETING_COMPUTER_BONUS_DIE,
} from '../game/adv-targeting-computer-helpers.js';
import {
  hasShockAndAweAbility,
  buildShockAndAweRoundKey,
  isShockAndAweAlreadyUsed,
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
import {
  hasFuryAbility,
  furyDamageTriggered,
  FURY_SURGE_BONUS,
} from '../game/fury-helpers.js';
import {
  hasMonCalaSfLokuAbility,
  MON_CALA_SF_LOKU_CONDITION,
} from '../game/mon-cala-sf-loku-helpers.js';
import {
  hasSlowOnTheDrawAbility,
} from '../game/slow-on-the-draw-helpers.js';
import {
  isIllicitArmsEligibleFigure,
} from '../game/illicit-arms-helpers.js';
import {
  hasDisposableAbility,
  hasConclusionAbility,
  applyEvadeDebuff,
} from '../game/evade-debuff-helpers.js';
import { reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, applyCondition, applyConditionWithDie, resetCondition, filterCondition, dcNameFromFigureKey, parseCoord, getFootprintCells, checkNefariousGains, getMaxPowerTokens, grantPowerTokens, resolveOverflowDiscard, getEffectiveMapSpaces, edgeKey } from '../game/index.js';
import { getPlayerDisplayName } from '../discord/user-helpers.js';
import { renderAttackDiceImage, renderDefenseDiceImage } from '../discord/dice-renderer.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getCcHand, getCcDeck, getActivatedDcIndices,
  recomputeActivationCounts,
  ccDiscardKey, ccHandKey, ccDeckKey, ccAttachmentsKey, vpKey,
  opponentPlayerNum, getInitiativePlayerNum,
  removeFigurePosition, getHandChannelId,
} from '../game/player-helpers.js';
import { checkFriendlyDefeatedPassiveRedraws, checkDeckDiscardPassiveRedraws } from '../game/cc-passive-redraw.js';
import { getPlayableReactionCardsForTiming } from '../game/cc-timing.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchCombatThread, fetchGameChannel, snowflakeUsers, sanitizeMentions } from '../discord/channel-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';

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
  // Slice 6.10: explicit step transition into the Zillo special window.
  if (game?.pendingCombat && game.pendingCombat.currentStep === 'step5') {
    game.pendingCombat.currentStep = 'zillo-window';
  }
  if (await maybePromptZilloPierceCancel(thread, game, ctx)) return;
  if (game?.pendingCombat) {
    await sendCombatGate(thread, game, game.pendingCombat, 'pre_resolve', ctx);
    return;
  }
  // Fallback: legacy single-button (shouldn't happen in normal flow)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_resolve_ready_${gameId}`)
      .setLabel('Ready to resolve rolls')
      .setStyle(ButtonStyle.Success)
  );
  await withDiscordRetry(() => thread.send({
    content: '**Confirm** — When both players have seen the rolls (and any surge), click **Ready to resolve rolls** to apply damage.',
    components: [row],
  }));
}

// ── Combat Sub-Phase Gates ─────────────────────────────────────────────────
// Between each major combat step, both players must click "Ready" before
// the game proceeds.  This prevents information leakage in async play
// (e.g. "I'd only Zillo if you Bib").

const COMBAT_GATE_LABELS = {
  // Combat just declared: combined on-declare window per player — CCs,
  // DC abilities (Cara Dune's Shock and Awe, etc.), AND power tokens
  // all spent/played in one window per destruct 2026-05-08. Both
  // players click Ready when done; dice auto-roll. Self-play auto-
  // advances.
  on_declare:             '⚔️ **Combat declared** — play any on-declare CCs / abilities / power tokens (combined window), then click Ready. Next: roll.',
  post_roll:              '🎲 **Dice rolled** (CRR step 2). Next: rerolls (step 3).',
  post_attacker_reroll:   '🔄 **Attacker rerolls done**. Next: defender rerolls (if any).',
  // Step 4 of an attack per CRR: Apply Modifiers. This is when CCs that
  // modify the attack (Take Cover, Concentrated Fire, etc.) and ability
  // triggers fire. Both players: play any modifier CCs from your hand
  // channel, then click Ready to advance to step 5 (surge).
  post_defender_reroll:   '🛠️ **Apply Modifiers** (CRR step 4) — play any CCs or abilities that modify this attack. Click Ready when done. Next: spend surge (step 5).',
  pre_resolve:            '⚔️ Resolving attack...',
};

/**
 * Sub-phases that auto-advance without posting a "Both players ready"
 * button — used by sendCombatGate to bypass the gate UI for steps where
 * Destruct's UX feedback says the bot should just proceed (e.g. damage
 * applies automatically per CRR step 7).
 */
// All post-reroll gates auto-advance per destruct 2026-05-08: rerolls
// are sequential per-player (sendRerollUI handles the attacker window,
// then forced, then defender) — a "Both Ready" check between them just
// adds a redundant click. The per-player Mods Y/N at step 4 is the
// modifier window itself; the legacy "Apply Modifiers — Ready" gate
// also went away here.
const AUTO_ADVANCE_SUB_PHASES = new Set([
  'pre_resolve',
  'post_attacker_reroll',
  'post_defender_reroll',
]);

/**
 * Send a combat sub-phase gate to the combat thread.
 * Both players must click Ready before the combat flow continues.
 * Self-play games skip the gate and advance immediately.
 */
export async function sendCombatGate(thread, game, combat, subPhase, ctx) {
  // Self-play: skip gates entirely
  if (game.selfPlay) {
    await dispatchCombatGateAdvance(thread, game, combat, subPhase, ctx);
    return;
  }
  // Auto-advance sub-phases (e.g. pre_resolve): skip the "Both ready" UI
  // and dispatch the advance immediately. Per Destruct's UX: damage
  // applies without a ready check; the result text already shows the math.
  if (AUTO_ADVANCE_SUB_PHASES.has(subPhase)) {
    delete combat.combatGate;
    await dispatchCombatGateAdvance(thread, game, combat, subPhase, ctx);
    return;
  }

  const label = COMBAT_GATE_LABELS[subPhase] || 'Combat checkpoint — confirm to proceed.';
  // Sequential gate (destruct 2026-05-06): attacker acks first, then
  // defender. activePlayer rotates after each ack; only the activePlayer
  // can click. acked map tracks who has confirmed at this gate.
  const atkPn = combat.attackerPlayerNum || 1;
  const defPn = opponentPlayerNum(atkPn);
  combat.combatGate = { phase: subPhase, acked: {}, activePlayer: atkPn };

  const atkId = getPlayerId(game, atkPn);
  const defId = getPlayerId(game, defPn);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_gate_${game.gameId}`)
      .setLabel('✅ Ready')
      .setStyle(ButtonStyle.Success),
  );

  const atkName = getPlayerDisplayName(game, atkPn, ctx?.client);
  const defName = getPlayerDisplayName(game, defPn, ctx?.client);
  const atkLabel = atkId ? `<@${atkId}> **${atkName}**` : `**${atkName}**`;
  const defLabel = defId ? `<@${defId}> **${defName}**` : `**${defName}**`;
  const content = `🔔 ${label}\n${atkLabel} (ATK) 👈 your turn | ${defLabel} (DEF) ⏳ waits\n**${atkName}**: click **Ready** after playing Command Cards / reactions. Defender will get the prompt next.`;

  await withDiscordRetry(() => thread.send({
    content,
    components: [row],
    allowedMentions: { users: [atkId].filter(Boolean) },
  }));
}

/**
 * Handle combat_gate_ button click.
 */
export async function handleCombatGateReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'combat_gate_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;

  const combat = game.pendingCombat;
  if (!combat?.combatGate) {
    await interaction.followUp({ content: 'No pending combat gate.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const gate = combat.combatGate;
  const userId = interaction.user.id;
  const isP1 = userId === game.player1Id;
  const isP2 = userId === game.player2Id;
  if (!isP1 && !isP2 && !game.isTestGame) {
    await interaction.followUp({ content: 'Only players in this game can use this.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Sequential gate (destruct 2026-05-06): only the activePlayer can ack.
  // Test game: P1 acts for both — clicker is whoever is currently active.
  gate.acked = gate.acked || {};
  let effectivePn = isP1 ? 1 : 2;
  if (game.isTestGame && isP1) {
    effectivePn = gate.activePlayer || 1;
  }

  if (effectivePn !== gate.activePlayer) {
    const _whose = gate.activePlayer === (combat.attackerPlayerNum || 1) ? 'attacker' : 'defender';
    await interaction.followUp({
      content: `Sequential gate: waiting on the ${_whose} (P${gate.activePlayer}) to ack first.`,
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }
  if (gate.acked[effectivePn]) {
    await interaction.followUp({ content: "You're already ready.", ephemeral: true }).catch(discordCatch);
    return;
  }
  gate.acked[effectivePn] = true;

  const label = COMBAT_GATE_LABELS[gate.phase] || 'Combat checkpoint';
  const atkPn = combat.attackerPlayerNum || 1;
  const defPn = opponentPlayerNum(atkPn);
  const atkId = getPlayerId(game, atkPn);
  const defId = getPlayerId(game, defPn);
  const atkName = getPlayerDisplayName(game, atkPn, interaction.client);
  const defName = getPlayerDisplayName(game, defPn, interaction.client);
  const atkLabel = atkId ? `<@${atkId}> **${atkName}**` : `**${atkName}**`;
  const defLabel = defId ? `<@${defId}> **${defName}**` : `**${defName}**`;
  const atkStatus = gate.acked[atkPn] ? '✅' : (gate.activePlayer === atkPn ? '👈 your turn' : '⏳');
  const defStatus = gate.acked[defPn] ? '✅' : (gate.activePlayer === defPn ? '👈 your turn' : '⏳');

  // Both acked? advance. Otherwise rotate activePlayer to the opponent.
  const bothAcked = gate.acked[atkPn] && gate.acked[defPn];
  if (!bothAcked) {
    gate.activePlayer = effectivePn === atkPn ? defPn : atkPn;
    const _nextName = gate.activePlayer === atkPn ? atkName : defName;
    const content = `🔔 ${label}\n${atkLabel} (ATK) ${atkStatus} | ${defLabel} (DEF) ${defStatus}\n**${_nextName}**: click **Ready** to confirm.`;
    await interaction.message.edit({
      content,
      components: interaction.message.components,
      allowedMentions: { users: [gate.activePlayer === 1 ? game.player1Id : game.player2Id].filter(Boolean) },
    }).catch(discordCatch);
    // On-declare merge (destruct 2026-05-08): after attacker's ack, post
    // the defender's combined on-declare token window so cards + tokens
    // land in one window for the defender too. Without this, the defender
    // sees only the gate Ready button and gets no token-spend UI.
    if (gate.phase === 'on_declare' && effectivePn === atkPn) {
      const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
      if (thread) await sendOnDeclareTokenWindow(thread, game, combat, 'defender', ctx);
    }
    saveGames(game.gameId);
    return;
  }

  // Both ready — advance
  await interaction.message.edit({
    content: `✅ ${label} — Both players ready. Proceeding...`,
    components: [],
  }).catch(discordCatch);

  const subPhase = gate.phase;
  delete combat.combatGate;

  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  await dispatchCombatGateAdvance(thread, game, combat, subPhase, ctx);
  saveGames(game.gameId);
}

/**
 * Defender reroll-phase entry. Defender's window covers (own rerolls +
 * controlled cross-side rerolls). If neither, falls through to step 4.
 * Sets controlledRerollSide so the forced-UI filter knows which side
 * owns the active controlled-reroll window. Per destruct 2026-05-08.
 */
async function _enterDefenderRerollPhase(thread, game, combat, ctx, defPN) {
  // Per alexanbv 2026-05-11: defender bucket = voluntary defender rerolls
  // + defender-owned controlled abilities (any pool). Cross Training also
  // lives here. If none → step 4.
  const _defCtrl = (combat.forcedRerollQueue || []).some(e => e.controlPlayer === defPN && (e.remaining ?? 0) > 0);
  const _defCtAvail = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
  if ((combat.defenderRerollsRemaining || 0) > 0 || _defCtrl || _defCtAvail) {
    combat.rerollPhase = 'defender';
    combat.controlledRerollSide = defPN;
    combat.currentStep = 'step3-defender';
    await sendRerollUI(thread, game, combat, 'defender');
    return;
  }
  await _enterStep4(thread, game, combat, ctx);
}

/**
 * Step-4 entry. Self-play skips Mods Y/N entirely; humans get the
 * sequential per-player Mods Y/N starting with the attacker.
 */
async function _enterStep4(thread, game, combat, ctx) {
  combat.rerollPhase = null;
  combat.controlledRerollSide = null;
  combat.currentStep = 'step4-attacker';
  // Lasat Honor Guard (Zeb Orrelios): per alexanbv 2026-05-11, fires
  // STRICTLY between the reroll buckets and step-4 modifiers — not
  // mid-step-4. Run the picker here; on resume the post-Lasat path
  // continues into sendModsYn (or directly to proceedAfterRerolls for
  // self-play). The legacy in-proceedAfterRerolls firing site is gone.
  if (!combat.lasatHonorGuardUsed && combat.attackDiceResults?.length > 0) {
    const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _atkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _atkEff = getDcEff[_atkDcName] || getDcEff[(_atkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_atkEff?.specialAbilityIds || []).includes('lasat_honor_guard')) {
      const _eligibleIdxs = combat.attackDiceResults
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => ((d.dmg || 0) + (d.surge || 0)) === 1)
        .map(({ i }) => i);
      if (_eligibleIdxs.length > 0) {
        combat.lasatHonorGuardPhase = true;
        combat.lasatHonorGuardUsed = true;
        combat.lasatEligibleDiceIndices = _eligibleIdxs;
        await sendLasatDiePicker(thread, game.gameId, combat, _eligibleIdxs, ctx);
        ctx.saveGames?.(game.gameId);
        return;
      }
    }
  }
  if (game.selfPlay) {
    combat.currentStep = 'step5';
    await proceedAfterRerolls(thread, game, combat, ctx);
  } else {
    await sendModsYn(thread, game, combat, 'attacker');
  }
}

/**
 * Dispatch to the next combat step after a gate is cleared.
 */
async function dispatchCombatGateAdvance(thread, game, combat, subPhase, ctx) {
  const saveGames = ctx.saveGames;

  switch (subPhase) {
    case 'on_declare': {
      // Both players Ready'd after combat declaration. Per destruct
      // 2026-05-08: tokens were merged into each player's on_declare
      // window (sendOnDeclareTokenWindow), so the legacy
      // proceedToTokenPhase pass is skipped. Clear the merge flag and
      // post the Roll Combat Dice button (auto-roll runs from there).
      combat.onDeclareTokenContext = false;
      combat.tokenPhase = null;
      await postRollDiceButton(thread, game, combat, ctx);
      break;
    }

    case 'post_roll': {
      // Per alexanbv 2026-05-11: two reroll buckets — attacker side and
      // defender side. Each bucket = (own voluntary rerolls + own
      // controlled cross-side abilities). Owner picks any order in their
      // bucket. Legacy `forced` middle phase fully retired.
      const atkPN = combat.attackerPlayerNum || 1;
      const defPN = opponentPlayerNum(atkPN);
      const _atkCtrl = (combat.forcedRerollQueue || []).some(e => e.controlPlayer === atkPN && (e.remaining ?? 0) > 0);
      if ((combat.attackerRerollsRemaining || 0) > 0 || _atkCtrl) {
        combat.rerollPhase = 'attacker';
        combat.controlledRerollSide = atkPN;
        combat.currentStep = 'step3-attacker';
        await sendRerollUI(thread, game, combat, 'attacker');
      } else {
        await _enterDefenderRerollPhase(thread, game, combat, ctx, defPN);
      }
      break;
    }

    case 'post_attacker_reroll': {
      // Attacker's bucket done — defender opens next (or step 4).
      // Mark the canonical CRR sub-window between buckets so any CC
      // wired to `step3-rapidrecal` (Rapid Recalibration) sees the
      // expected currentStep. The window is engine-driven (auto-advance
      // through the gate); a CC playing at this step would have been
      // queued in attacker's bucket and resolved before we got here.
      const atkPN = combat.attackerPlayerNum || 1;
      const defPN = opponentPlayerNum(atkPN);
      combat.currentStep = 'step3-rapidrecal';
      await _enterDefenderRerollPhase(thread, game, combat, ctx, defPN);
      break;
    }

    case 'post_defender_reroll': {
      // Defender's bucket done — step 4.
      await _enterStep4(thread, game, combat, ctx);
      break;
    }

    case 'pre_resolve': {
      // Combat-pipeline rebuild (slice 3.7-3.8): pre_resolve dispatch happens
      // after surge spending is done. Mark currentStep = 'zillo-window' so the
      // unique special-case Zillo exhaust prompt window has a clean step. Then
      // the resolveCombatAfterRolls flow walks through step6/step7/step8 to
      // resolved (mostly engine-driven from this point).
      if (combat.currentStep === 'step5') combat.currentStep = 'zillo-window';
      const { resolveCombatAfterRolls } = ctx;
      if (resolveCombatAfterRolls) {
        await resolveCombatAfterRolls(game, combat, ctx.client);
      }
      break;
    }

    default:
      console.warn(`[combat-gate] Unknown sub-phase: ${subPhase}`);
  }
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
  const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
  // @ the attacker so they get a notification when surge spending opens.
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const atkOwnerId = atkPlayerNum === 1 ? game.player1Id : game.player2Id;
  await thread.send({
    content: `<@${atkOwnerId}> — **Spend surge?** You have **${remaining}** surge left. Choose an ability or Done.`,
    components: [surgeRow],
    allowedMentions: { users: [atkOwnerId] },
  }).catch(discordCatch);
}

/**
 * Apply direct unpreventable strain/damage to a figure (Relentless, etc.).
 * Handles defeat, VP, activations update.
 */
async function applyStrainToFigure(game, playerNum, figureKey, amount, abilityLabel, sourceLabel, ctx, thread) {
  const {
    dcHealthState, findDcMessageIdForFigure, logGameAction, getDcStats, getDcEffects, client,
    processFigureDefeat: ctxProcessFigureDefeat,
  } = ctx;
  if (!dcHealthState || !findDcMessageIdForFigure) return;
  const msgId = findDcMessageIdForFigure(game.gameId, playerNum, figureKey);
  if (!msgId) return;
  // Flame Trooper Fireproof: cannot suffer Strain
  const _fpUpg = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (cardNameIncludes(_fpUpg, 'Flame Trooper')) {
    const dcName = dcNameFromFigureKey(figureKey);
    await thread.send(`**Fireproof** — **${dcName}** is immune to Strain from ${abilityLabel}.`).catch(discordCatch);
    return;
  }
  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dcName = dcNameFromFigureKey(figureKey);
  const healthState = dcHealthState.get(msgId) || [];
  const entry = healthState[figureIndex];
  if (!entry) return;
  const [cur, max] = entry;

  // Headhunter: when a hostile figure suffers Strain during the Headhunter owner's activation
  let headhunterTriggered = false;
  let headhunterDmg = 0;
  const _hhOwnerNum = 3 - playerNum;
  const _hhOwnerMsgIds = getDcMessageIds(game, _hhOwnerNum) || [];
  const _hhOwnerAtts = getDcAttachments(game, _hhOwnerNum) || {};
  const _hhInActivation = _hhOwnerMsgIds.some(mid => game.dcActionsData?.[mid]?.threadId);
  if (_hhInActivation) {
    for (const _hhMid of _hhOwnerMsgIds) {
      const _hhAtts = _hhOwnerAtts[_hhMid] || [];
      const _hhExh = game.exhaustedSkirmishUpgrades?.[_hhMid] || [];
      if (_hhAtts.includes('Headhunter') && !_hhExh.includes('Headhunter')) {
        headhunterTriggered = true;
        amount = Math.max(0, amount - 1); // reduce Strain by 1
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[_hhMid] = [..._hhExh, 'Headhunter'];
        // Opponent discards random CC or figure suffers 1 Damage
        const oppHand = getCcHand(game, playerNum) || [];
        if (oppHand.length > 0) {
          const randIdx = Math.floor(Math.random() * oppHand.length);
          const discarded = oppHand.splice(randIdx, 1)[0];
          const discardKey = ccDiscardKey(playerNum);
          game[discardKey] = game[discardKey] || [];
          game[discardKey].push(discarded);
          const _hhUserName = getPlayerDisplayName(game, playerNum, client);
          await thread.send(`**Headhunter** — Strain reduced by 1. **${_hhUserName}** discards **${discarded}** from hand.`).catch(discordCatch);
          if (logGameAction) await logGameAction(game, client, `**Headhunter** — Reduced Strain on **${dcName}**; **${_hhUserName}** discards **${discarded}**.`, { phase: 'ROUND', icon: 'card' });
        } else {
          headhunterDmg = 1;
          const _hhUserName2 = getPlayerDisplayName(game, playerNum, client);
          await thread.send(`**Headhunter** — Strain reduced by 1, but **${_hhUserName2}** has no CCs. **${dcName}** suffers 1 Damage instead.`).catch(discordCatch);
          if (logGameAction) await logGameAction(game, client, `**Headhunter** — Reduced Strain on **${dcName}**; **${_hhUserName2}** has no CCs, dealt 1 Damage.`, { phase: 'ROUND', icon: 'card' });
        }
        break;
      }
    }
  }

  const totalHpLoss = amount + headhunterDmg;
  if (totalHpLoss <= 0 && headhunterTriggered) {
    // Headhunter fully prevented strain + opponent had CCs to discard
    return;
  }

  // ── Under Duress detection (M79-M80) ──
  // Check if the opponent has [Under Duress] in their army (standalone SU DC card).
  const _udOpponentNum = 3 - playerNum;
  const _udDcList = getDcList(game, _udOpponentNum) || [];
  const _udMsgIds = getDcMessageIds(game, _udOpponentNum) || [];
  const _udDepletedIds = _udOpponentNum === 1 ? (game.p1DepletedDcMessageIds || []) : (game.p2DepletedDcMessageIds || []);
  let _udActive = false;   // passive: each CC discard costs 2 CCs instead of 1
  let _udCanDeplete = false; // deplete available: opponent can take over the choice
  let _udDepleteMsgId = null;
  for (let _udIdx = 0; _udIdx < _udDcList.length; _udIdx++) {
    const _udDc = _udDcList[_udIdx];
    const _udDcName = typeof _udDc === 'object' ? (_udDc.dcName || _udDc.displayName) : _udDc;
    if (_udDcName !== '[Under Duress]') continue;
    _udActive = true;
    const _udMid = _udMsgIds[_udIdx];
    if (_udMid && !_udDepletedIds.includes(_udMid)) {
      _udCanDeplete = true;
      _udDepleteMsgId = _udMid;
    }
    break;
  }

  // ── Strain choice: player may discard CCs from deck top instead of taking HP damage ──
  // Rules: "discard one Command card from the top of their deck for each damage prevented"
  // Headhunter damage is always HP damage (not strain), so only `amount` can be allocated to CC discards.
  const ownerDeck = getCcDeck(game, playerNum) || [];
  // Under Duress passive: each CC discard costs 2 CCs instead of 1
  const ccCostPerStrain = _udActive ? 2 : 1;
  const maxDiscards = amount > 0 ? Math.min(amount, Math.floor(ownerDeck.length / ccCostPerStrain)) : 0;
  if (amount > 0 && ownerDeck.length > 0 && maxDiscards > 0) {
    // Player has CCs — offer the choice
    const ownerId = getPlayerId(game, playerNum);
    // Save pending state so the button handler can finish resolution
    setPendingStrainChoice(game, {
      figureKey, playerNum, amount, headhunterDmg,
      abilityLabel, sourceLabel, dcName, msgId, figureIndex,
      threadId: thread.id, discardedCount: 0,
      underDuressActive: _udActive,
      ccCostPerStrain,
    });
    // Apply headhunter direct damage immediately (it's not strain — no choice)
    if (headhunterDmg > 0) {
      await _applyDamage(game, { dcHealthState, logGameAction, client: thread?.client }, {
        figureKey, msgId, figIndex: figureIndex,
        amount: headhunterDmg, controllerPlayerNum: playerNum,
        source: 'Headhunter',
      });
      await thread.send(`**${abilityLabel}** — **${dcName}** suffers ${headhunterDmg} Damage from Headhunter.`).catch(discordCatch);
    }

    // Under Duress deplete: opponent can take control of the strain choice
    if (_udCanDeplete) {
      game.pendingStrainChoice.underDuressDepleteMsgId = _udDepleteMsgId;
      game.pendingStrainChoice.underDuressOpponentNum = _udOpponentNum;
      const udOwnerId = getPlayerId(game, _udOpponentNum);
      const udBtns = [
        new ButtonBuilder()
          .setCustomId(`ud_deplete_use_${game.gameId}`)
          .setLabel('Deplete Under Duress (take control)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`ud_deplete_skip_${game.gameId}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      ];
      await withDiscordRetry(() => thread.send(sanitizeMentions({
        content: `**[Under Duress]** — <@${udOwnerId}>, **${dcName}** (opponent) suffers ${amount} Strain from **${abilityLabel}**.`
          + ` You may **deplete** Under Duress to resolve strain choices for your opponent (each CC discard costs 2 CCs).`,
        components: [new ActionRowBuilder().addComponents(udBtns)],
        allowedMentions: { users: [udOwnerId] },
      })));
      // Don't show strain choice yet — wait for UD owner's decision
      return;
    }

    // No deplete available — show strain choice to figure owner directly
    const udNote = _udActive ? ' (**Under Duress**: each CC discard costs 2 CCs)' : '';
    const btns = [
      new ButtonBuilder()
        .setCustomId(`strain_choice_alldmg_${game.gameId}`)
        .setLabel(`All as Damage (${amount} HP)`)
        .setStyle(ButtonStyle.Danger),
    ];
    // Offer individual CC discard buttons for each point of strain (up to CCs available)
    for (let i = 1; i <= maxDiscards; i++) {
      const hpRemaining = amount - i;
      const ccCost = i * ccCostPerStrain;
      btns.push(
        new ButtonBuilder()
          .setCustomId(`strain_choice_discard_${game.gameId}_${i}`)
          .setLabel(`Discard ${ccCost} CC${ccCost > 1 ? 's' : ''}${hpRemaining > 0 ? ` + ${hpRemaining} HP` : ''}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    // Discord limits 5 buttons per row; split into rows of 5
    const rows = chunkButtonsToRows(btns);
    await withDiscordRetry(() => thread.send(sanitizeMentions({
      content: `**Strain** — <@${ownerId}>, **${dcName}** (${cur}/${max} HP) suffers ${amount} Strain from **${abilityLabel}** (${sourceLabel}).`
        + ` You have ${ownerDeck.length} CC${ownerDeck.length > 1 ? 's' : ''} in deck.`
        + ` Choose how to allocate: take HP damage or discard CC${maxDiscards > 1 ? 's' : ''} from deck top.${udNote}`,
      components: rows,
      allowedMentions: { users: [ownerId] },
    })));
    // Don't apply strain HP damage yet — wait for player's choice
    return;
  }

  const { newHp: newCur, prevHp: _strainPrev } = await _applyDamage(game, { dcHealthState, logGameAction, client: thread?.client }, {
    figureKey, msgId, figIndex: figureIndex,
    amount: totalHpLoss, controllerPlayerNum: playerNum,
    source: sourceLabel || 'Strain',
    viaStrain: true,
  });
  if (!headhunterTriggered) {
    await withDiscordRetry(() => thread.send(`**${abilityLabel}** (${sourceLabel}) — **${dcName}** suffers 1 Strain (${_strainPrev} → ${newCur} HP).`));
  } else {
    await withDiscordRetry(() => thread.send(`**${abilityLabel}** — **${dcName}** suffers 1 Damage from Headhunter (${_strainPrev} → ${newCur} HP).`));
  }
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** suffered 1 Strain.`, { phase: 'ROUND', icon: 'attack' });
  }
  // Submit or Fight (Paz Vizsla): after suffering Strain damage, may return CCs from discard to heal
  {
    const _sofEff = getDcEffects?.()?.[dcName] || getDcEffects?.()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((_sofEff?.specialAbilityIds || []).includes('submit_or_fight_paz') && newCur > 0 && !game.restInPeaceActive) {
      const _sofDiscardKey = ccDiscardKey(playerNum);
      const _sofDiscard = game[_sofDiscardKey] || [];
      if (_sofDiscard.length > 0) {
        const _sofOwnerId = getPlayerId(game, playerNum);
        const _sofBtns = [
          new ButtonBuilder().setCustomId(`submit_fight_use_${game.gameId}_${msgId}_${figureIndex}`).setLabel('Use Submit or Fight').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`submit_fight_skip_${game.gameId}_${msgId}_${figureIndex}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        ];
        await withDiscordRetry(() => thread.send(sanitizeMentions({
          content: `🛡️ **Submit or Fight** — <@${_sofOwnerId}>, **${dcName}** may return a CC from discard to game box to heal 1 Strain damage (${_sofDiscard.length} CC${_sofDiscard.length > 1 ? 's' : ''} in discard).`,
          components: [new ActionRowBuilder().addComponents(_sofBtns)],
          allowedMentions: { users: [_sofOwnerId] },
        })));
      }
    }
  }
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
  // Submit or Fight (Paz Vizsla)
  {
    const _sofEff = getDcEffects?.()?.[dcName] || getDcEffects?.()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((_sofEff?.specialAbilityIds || []).includes('submit_or_fight_paz') && newCur > 0 && !game.restInPeaceActive) {
      const _sofDiscardKey = ccDiscardKey(playerNum);
      const _sofDiscard = game[_sofDiscardKey] || [];
      if (_sofDiscard.length > 0) {
        const _sofOwnerId = getPlayerId(game, playerNum);
        const _sofBtns = [
          new ButtonBuilder().setCustomId(`submit_fight_use_${game.gameId}_${msgId}_${figureIndex}`).setLabel('Use Submit or Fight').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`submit_fight_skip_${game.gameId}_${msgId}_${figureIndex}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        ];
        await withDiscordRetry(() => thread.send(sanitizeMentions({
          content: `🛡️ **Submit or Fight** — <@${_sofOwnerId}>, **${dcName}** may return a CC from discard to game box to heal 1 Strain damage (${_sofDiscard.length} CC${_sofDiscard.length > 1 ? 's' : ''} in discard).`,
          components: [new ActionRowBuilder().addComponents(_sofBtns)],
          allowedMentions: { users: [_sofOwnerId] },
        })));
      }
    }
  }
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
 * Handle strain_choice_alldmg_ and strain_choice_discard_ buttons.
 * Player chose how to allocate strain: all as HP damage, or N as CC discards.
 */
export async function handleStrainChoice(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, client } = ctx;
  const customId = interaction.customId;
  const isAllDmg = customId.startsWith('strain_choice_alldmg_');
  const prefix = isAllDmg ? 'strain_choice_alldmg_' : 'strain_choice_discard_';
  const suffix = customId.replace(prefix, '');

  let gameId, discardCount;
  if (isAllDmg) {
    gameId = suffix;
    discardCount = 0;
  } else {
    const lastUnderscore = suffix.lastIndexOf('_');
    gameId = suffix.slice(0, lastUnderscore);
    discardCount = parseInt(suffix.slice(lastUnderscore + 1), 10);
  }

  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingStrainChoice;
  if (!pending) {
    await interaction.followUp({ content: 'No pending strain choice found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Under Duress deplete: if active, the UD owner controls the choice, not the figure owner
  const _udController = pending.underDuressControllerPlayerNum || pending.playerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, _udController, canActAsPlayer, _udController !== pending.playerNum ? 'Only the Under Duress owner may choose.' : 'Only the figure owner may choose.')) return;

  // Edit the choice message to remove buttons
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const thread = await fetchCombatThread(client, pending.threadId);
  if (!thread) {
    clearPendingStrainChoice(game);
    saveGames(game.gameId);
    return;
  }

  if (isAllDmg || discardCount === 0) {
    // All strain as HP damage (headhunterDmg already applied when pending was created)
    clearPendingStrainChoice(game);
    await resolveStrainDamage(game, pending.amount, pending, ctx, thread);
    saveGames(game.gameId);
    return;
  }

  // Player wants to discard N CCs — blind discard from deck top (rules: "from the top of their deck")
  const deckKey = ccDeckKey(pending.playerNum);
  const deck = game[deckKey] || [];
  const ccCostPerStrain = pending.ccCostPerStrain || 1;
  const totalCcToDiscard = discardCount * ccCostPerStrain;
  const actualDiscard = Math.min(totalCcToDiscard, deck.length);
  const actualStrainPrevented = Math.floor(actualDiscard / ccCostPerStrain);

  if (actualDiscard === 0) {
    // No deck cards available — fall back to all damage
    clearPendingStrainChoice(game);
    await resolveStrainDamage(game, pending.amount, pending, ctx, thread);
    saveGames(game.gameId);
    return;
  }

  // Discard from deck top
  const discKey = ccDiscardKey(pending.playerNum);
  game[discKey] = game[discKey] || [];
  const discardedCards = deck.splice(0, actualDiscard);
  game[deckKey] = deck;
  for (const card of discardedCards) {
    game[discKey].push(card);
  }

  // Log each discarded card
  const cardList = discardedCards.map(c => `**${c}**`).join(', ');
  const udNote = ccCostPerStrain > 1 ? ' (Under Duress: 2 CCs per strain point)' : '';
  await thread.send(`**Strain** — **${pending.dcName}** discards ${discardedCards.length} CC${discardedCards.length > 1 ? 's' : ''} from deck top: ${cardList}${udNote} — prevents ${actualStrainPrevented} Strain damage.`).catch(discordCatch);
  if (ctx.logGameAction) {
    await ctx.logGameAction(game, client, `⚡ **Strain Choice** — **${pending.dcName}** discards ${discardedCards.length} CC${discardedCards.length > 1 ? 's' : ''} from deck top (prevents ${actualStrainPrevented} Strain).`, { phase: 'ROUND', icon: 'card' });
  }

  // CC Passive Redraw: deck-discard trigger (Built on Hope) — check each discarded card
  for (const card of discardedCards) {
    const _bprResult = checkDeckDiscardPassiveRedraws(game, pending.playerNum, card);
    for (const _bprCard of _bprResult.redrawn) {
      if (ctx.logGameAction) await ctx.logGameAction(game, client, `**Passive Redraw** — **${_bprCard}** re-drawn from discard (discarded from deck).`, { phase: 'ROUND', icon: 'card' });
    }
  }
  // Update discard pile + hand visuals (discard changed, hand may change from passive redraws)
  if (ctx.updateDiscardPileMessage) await ctx.updateDiscardPileMessage(game, pending.playerNum, client).catch(discordCatch);
  if (ctx.updateHandVisualMessage) await ctx.updateHandVisualMessage(game, pending.playerNum, client).catch(discordCatch);

  // Apply remaining strain as HP damage
  const hpDmg = pending.amount - actualStrainPrevented;
  const pendingCopy = { ...pending };
  clearPendingStrainChoice(game);
  if (hpDmg > 0) {
    await resolveStrainDamage(game, hpDmg, pendingCopy, ctx, thread);
  } else {
    await thread.send(`**Strain** — All ${pending.amount} Strain resolved via CC discard${pending.amount > 1 ? 's' : ''}.`).catch(discordCatch);
  }
  saveGames(game.gameId);
}

// ── Under Duress deplete handler (M79-M80) ──────────────────────────────────
// ud_deplete_use_{gameId} / ud_deplete_skip_{gameId}
// Opponent of the straining figure decides whether to deplete Under Duress.
export async function handleUnderDuress(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, saveGames, client } = ctx;
  const customId = interaction.customId;
  const isUse = customId.startsWith('ud_deplete_use_');
  const prefix = isUse ? 'ud_deplete_use_' : 'ud_deplete_skip_';
  const gameId = customId.replace(prefix, '');

  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingStrainChoice;
  if (!pending) {
    await interaction.followUp({ content: 'No pending strain choice found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const udOwnerNum = pending.underDuressOpponentNum;
  if (!udOwnerNum) {
    await interaction.followUp({ content: 'No Under Duress prompt pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, udOwnerNum, canActAsPlayer, 'Only the Under Duress owner may decide.')) return;

  // Remove the UD prompt buttons
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  const thread = await fetchCombatThread(client, pending.threadId);
  if (!thread) {
    clearPendingStrainChoice(game);
    saveGames(game.gameId);
    return;
  }

  if (isUse) {
    // Deplete Under Duress — mark as depleted
    const udMsgId = pending.underDuressDepleteMsgId;
    if (udMsgId) {
      const depKey = udOwnerNum === 1 ? 'p1DepletedDcMessageIds' : 'p2DepletedDcMessageIds';
      game[depKey] = game[depKey] || [];
      if (!game[depKey].includes(udMsgId)) game[depKey].push(udMsgId);
    }
    // The UD owner now controls the strain choice
    pending.underDuressControllerPlayerNum = udOwnerNum;
    delete pending.underDuressDepleteMsgId;
    delete pending.underDuressOpponentNum;

    const _udOwnerName = getPlayerDisplayName(game, udOwnerNum, client);
    await thread.send(`**[Under Duress]** — Depleted! **${_udOwnerName}** now resolves strain choices for **${pending.dcName}**.`).catch(discordCatch);
    if (ctx.logGameAction) {
      await ctx.logGameAction(game, client, `**[Under Duress]** — Depleted by **${_udOwnerName}**. Controlling strain choice for **${pending.dcName}**.`, { phase: 'ROUND', icon: 'card' });
    }

    // Show strain choice buttons to the UD owner (discards come from figure owner's deck top)
    const controllerId = getPlayerId(game, udOwnerNum);
    const ownerDeck = getCcDeck(game, pending.playerNum) || [];
    const ccCostPerStrain = pending.ccCostPerStrain || 1;
    const maxDiscards = Math.min(pending.amount, Math.floor(ownerDeck.length / ccCostPerStrain));

    if (maxDiscards <= 0) {
      // No CC discards possible — all damage
      clearPendingStrainChoice(game);
      await resolveStrainDamage(game, pending.amount, pending, ctx, thread);
      saveGames(game.gameId);
      return;
    }

    const btns = [
      new ButtonBuilder()
        .setCustomId(`strain_choice_alldmg_${gameId}`)
        .setLabel(`All as Damage (${pending.amount} HP)`)
        .setStyle(ButtonStyle.Danger),
    ];
    for (let i = 1; i <= maxDiscards; i++) {
      const hpRemaining = pending.amount - i;
      const ccCost = i * ccCostPerStrain;
      btns.push(
        new ButtonBuilder()
          .setCustomId(`strain_choice_discard_${gameId}_${i}`)
          .setLabel(`Discard ${ccCost} CC${ccCost > 1 ? 's' : ''}${hpRemaining > 0 ? ` + ${hpRemaining} HP` : ''}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    const rows = chunkButtonsToRows(btns);
    await withDiscordRetry(() => thread.send(sanitizeMentions({
      content: `**[Under Duress]** — <@${controllerId}>, choose how **${pending.dcName}** allocates ${pending.amount} Strain:`
        + ` take HP damage or discard from opponent's deck top (${ownerDeck.length} CC${ownerDeck.length > 1 ? 's' : ''}, costs ${ccCostPerStrain} CC${ccCostPerStrain > 1 ? 's' : ''} per strain).`,
      components: rows,
      allowedMentions: { users: [controllerId] },
    })));
  } else {
    // Skip — show normal strain choice to figure owner
    delete pending.underDuressDepleteMsgId;
    delete pending.underDuressOpponentNum;

    await thread.send(`**[Under Duress]** — Skipped deplete.`).catch(discordCatch);

    const ownerId = getPlayerId(game, pending.playerNum);
    const ownerDeck = getCcDeck(game, pending.playerNum) || [];
    const ccCostPerStrain = pending.ccCostPerStrain || 1;
    const maxDiscards = Math.min(pending.amount, Math.floor(ownerDeck.length / ccCostPerStrain));

    if (maxDiscards <= 0) {
      // No CC discards possible — all damage
      clearPendingStrainChoice(game);
      await resolveStrainDamage(game, pending.amount, pending, ctx, thread);
      saveGames(game.gameId);
      return;
    }

    const udNote = pending.underDuressActive ? ' (**Under Duress**: each CC discard costs 2 CCs)' : '';
    const btns = [
      new ButtonBuilder()
        .setCustomId(`strain_choice_alldmg_${gameId}`)
        .setLabel(`All as Damage (${pending.amount} HP)`)
        .setStyle(ButtonStyle.Danger),
    ];
    for (let i = 1; i <= maxDiscards; i++) {
      const hpRemaining = pending.amount - i;
      const ccCost = i * ccCostPerStrain;
      btns.push(
        new ButtonBuilder()
          .setCustomId(`strain_choice_discard_${gameId}_${i}`)
          .setLabel(`Discard ${ccCost} CC${ccCost > 1 ? 's' : ''}${hpRemaining > 0 ? ` + ${hpRemaining} HP` : ''}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    const rows = chunkButtonsToRows(btns);
    await withDiscordRetry(() => thread.send(sanitizeMentions({
      content: `**Strain** — <@${ownerId}>, **${pending.dcName}** suffers ${pending.amount} Strain from **${pending.abilityLabel}** (${pending.sourceLabel}).`
        + ` You have ${ownerDeck.length} CC${ownerDeck.length > 1 ? 's' : ''} in deck.`
        + ` Choose how to allocate: take HP damage or discard CC${maxDiscards > 1 ? 's' : ''} from deck top.${udNote}`,
      components: rows,
      allowedMentions: { users: [ownerId] },
    })));
  }
  saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, updateDcActionsMessage, ACTION_ICONS, ThreadAutoArchiveDuration, resolveCombatAfterRolls, saveGames, client, dcHealthState, findDcMessageIdForFigure, logGameAction, isGroupDefeated, checkWinConditions, updateActivationsMessage
 */
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
  // Marksman auto-play: target was rendered as [Marksman] (no normal LOS,
  // but figures-don't-block LOS exists). Move the card from hand to discard
  // and arm nextAttackIgnoreFigureLOS so the attack resolves with no
  // figure-blocking. Single-use, consumed by handleAttackTarget below.
  if (target.requiresMarksman) {
    const _mmHand = game[ccHandKey(attackerPlayerNum)] || [];
    const _mmIdx = _mmHand.indexOf('Marksman');
    if (_mmIdx < 0) {
      await interaction.followUp({ content: '🚫 Marksman is no longer in your hand.', ephemeral: true }).catch(discordCatch);
      return;
    }
    _mmHand.splice(_mmIdx, 1);
    game[ccHandKey(attackerPlayerNum)] = _mmHand;
    const _mmDiscardKey = ccDiscardKey(attackerPlayerNum);
    game[_mmDiscardKey] = [...(game[_mmDiscardKey] || []), 'Marksman'];
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[msgId] = true;
    await logGameAction(game, client, `🎯 **Marksman** played — figures do not block LOS for this Ranged attack.`, { phase: 'ROUND', icon: 'card' });
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
  if (game.fellSwoopFreeAttack?.[msgId] && game.stillFasterExcludeMsgId && target.figureKey && !target.isNpc) {
    const excMeta = dcMessageMeta?.get(game.stillFasterExcludeMsgId);
    if (excMeta && target.figureKey.startsWith(`${excMeta.dcName}-`)) {
      await interaction.followUp({ content: '🚫 **Still Faster Than You** — must target a **different** hostile figure than the one that just activated.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Compute the attacker's figureKey for per-figure once-per-activation
  // gates (Focus Fire, Multi-Fire) per IACP rule 2026-05-09.
  const _atkDgForGate = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  const _atkFkForGate = `${meta.dcName}-${_atkDgForGate}-${figureIndex}`;

  // Forced attack target validation (Mandalorian Whip, Focus Fire, etc.) — must target a specific figure
  if (game.forcedAttackTarget?.[msgId] && target.figureKey) {
    if (target.figureKey !== game.forcedAttackTarget[msgId]) {
      const forcedName = dcNameFromFigureKey(game.forcedAttackTarget[msgId]);
      const reason = game.focusFireActive?.[_atkFkForGate] ? 'Focus Fire — must target the **same figure**' : 'You must target the specified figure';
      await interaction.followUp({ content: `**${reason}** (**${forcedName.replace(/_/g, ' ')}**).`, ephemeral: true }).catch(discordCatch);
      return;
    }
    delete game.forcedAttackTarget[msgId];
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
  // freeAttackDifferentTargets[msgId] tracks figureKeys already attacked.
  if (Array.isArray(game.freeAttackDifferentTargets?.[msgId]) && target.figureKey) {
    if (game.freeAttackDifferentTargets[msgId].includes(target.figureKey)) {
      await interaction.followUp({ content: '🚫 **Different target required** — this multi-attack ability requires each attack to target a different figure. Pick another target.', ephemeral: true }).catch(discordCatch);
      return;
    }
    game.freeAttackDifferentTargets[msgId].push(target.figureKey);
  }
  // Droid Arm (Migs Mayfeld): deduct 1 Power Token when attacking a target only visible via Droid Arm
  if (target.droidArmLOS) {
    const _daTokens = game.figurePowerTokens?.[`${meta.dcName}-${(meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1}-${figureIndex}`] || [];
    if (_daTokens.length > 0) {
      _daTokens.splice(0, 1); // remove first token
    }
  }
  // Arcing Shot: validate target is adjacent to an empty space in attacker's LOS
  if (game.arcingShotActive?.[msgId] || game.arcingShotActiveScalar) {
    const _arcValid = target.arcingShotValid;
    if (_arcValid === false) {
      // Warn but allow override (bot may not have perfect LOS/map data)
      await interaction.followUp({
        content: `\u26a0\ufe0f **Arcing Shot** — No empty space adjacent to **${target.label}** was found in attacker's LOS. The target may not be valid for Arcing Shot. Proceeding with attack.`,
        ephemeral: false,
      }).catch(discordCatch);
    }
    // Clear the flag now that an attack target has been selected
    if (game.arcingShotActive?.[msgId]) delete game.arcingShotActive[msgId];
    if (game.arcingShotActiveScalar) delete game.arcingShotActiveScalar;
  }
  // Ballistics Matrix / Marksman: clear per-attack flag after this attack proceeds.
  // Both paths arm by msgId 2026-05-09 (Ballistics Matrix bug fix aligned with Marksman).
  if (game.nextAttackIgnoreFigureLOS?.[msgId]) delete game.nextAttackIgnoreFigureLOS[msgId];
  delete game.attackTargets[`${msgId}_${figureIndex}`];
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    const pendingBL = game.pendingBattlefieldLeadership;
    const isBLFreeAttack = pendingBL?.forMsgId === msgId;
    const isFellSwoopFreeAttack = !!game.fellSwoopFreeAttack?.[msgId];
    const isEmperorFreeAttack = game.pendingEmperorInterrupt?.forMsgId === msgId;
    const isExecOrderFreeAttack = game.pendingExecutiveOrder?.forMsgId === msgId;
    const isBombardmentFreeAttack = game.pendingBombardmentSorin?.forMsgId === msgId;
    const isFiringSquadFreeAttack = (game.pendingFiringSquad || []).some(p => p.forMsgId === msgId);
    const isCoordinatedRaidFreeAttack = game.pendingCoordinatedRaid?.forMsgId === msgId;
    const isFieldTacticsFreeAttack = game.pendingFieldTactics?.forMsgId === msgId;
    if (isBLFreeAttack) {
      clearPendingBattlefieldLeadership(game);
    } else if (isFellSwoopFreeAttack) {
      delete game.fellSwoopFreeAttack[msgId];
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
      // entry's `triggeredByMsgId` (Kayn's msgId) — populated on first
      // attack, read on subsequent attacks via forcedAttackTarget.
      const _fsEntry = (game.pendingFiringSquad || []).find(p => p.forMsgId === msgId);
      if (_fsEntry && target?.figureKey) {
        game.firingSquadLockedTarget = game.firingSquadLockedTarget || {};
        const _fsLock = game.firingSquadLockedTarget[_fsEntry.triggeredByMsgId];
        if (!_fsLock) {
          // First Trooper to attack — record the target and apply forced
          // target to every OTHER pending entry for this invocation.
          game.firingSquadLockedTarget[_fsEntry.triggeredByMsgId] = target.figureKey;
          game.forcedAttackTarget = game.forcedAttackTarget || {};
          for (const _fsOther of (game.pendingFiringSquad || [])) {
            if (_fsOther.triggeredByMsgId !== _fsEntry.triggeredByMsgId) continue;
            if (_fsOther.forMsgId === msgId) continue;
            game.forcedAttackTarget[_fsOther.forMsgId] = target.figureKey;
          }
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
    } else if (isFieldTacticsFreeAttack) {
      clearPendingFieldTactics(game);
    } else {
      consumeActionForCurrentFigure(actionsData, 1, game, msgId);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }
  }

  const attackerStats = getDcStats(meta.dcName);
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

  // pendingOverrideAttackDice (Saber Strike, Bo-Rifle Staff Strike, Definition: 'Love'): replace dice/type/pierce for this attack
  const overrideDice = game.pendingOverrideAttackDice?.[msgId];
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
    delete game.pendingOverrideAttackDice[msgId];
  }
  // Close Quarters: override attack with adjacent hostile's dice/type, +1 Accuracy, -1 defense die
  if (game.closeQuartersActive?.[msgId]) {
    delete game.closeQuartersActive[msgId];
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
        for (const [fk, pos] of Object.entries(cqOppPositions)) {
          if (pos && cqAdjSpaces.has(pos)) { cqHostileName = dcNameFromFigureKey(fk); break; }
        }
        if (cqHostileName) {
          const cqHostileStats = getDcStats(cqHostileName);
          const cqAttack = cqHostileStats?.attack;
          if (cqAttack?.dice) {
            attackInfo = { ...attackInfo, dice: cqAttack.dice };
            if (cqAttack.attackType?.toLowerCase() === 'melee') attackInfo = { ...attackInfo, range: [1, 1] };
            else if (cqAttack.attackType?.toLowerCase() === 'ranged') attackInfo = { ...attackInfo, range: [1, 99] };
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
    targetDcName = dcNameFromFigureKey(target.figureKey);
    targetStats = getDcStats(targetDcName);
    targetEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName.replace(/\s*\[.*\]\s*$/, '')];
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
  // Mystic Hunter (Zuckuss): when you declare an attack, become Focused
  const _atkEff = getDcEffects()?.[meta.dcName];
  let _mysticHunterFired = false;
  if ((_atkEff?.passives || []).includes('Mystic Hunter')) {
    ({ attackInfo, applied: _mysticHunterFired } = applyConditionWithDie(game, attackerFigureKey, 'Focus', attackInfo, 'green'));
  }
  // Full of Rage (Krrsantan): auto-Focus before attacking if 3+ damage suffered
  let _fullOfRageFired = false;
  let _fullOfRageDmg = 0;
  if (hasFullOfRageAbility(_atkEff?.specialAbilityIds || []) && !attackerConds.includes('Focus')) {
    const _forHpArr = dcHealthState?.get(msgId) || [];
    const _forFigHp = _forHpArr[figureIndex];
    _fullOfRageDmg = _forFigHp ? Math.max(0, (_forFigHp[1] ?? _forFigHp[0] ?? 0) - (_forFigHp[0] ?? 0)) : 0;
    if (fullOfRageDamageTriggered(_fullOfRageDmg)) {
      ({ attackInfo, applied: _fullOfRageFired } = applyConditionWithDie(game, attackerFigureKey, FULL_OF_RAGE_CONDITION, attackInfo, FULL_OF_RAGE_BONUS_DIE));
    }
  }
  // Fly-By (Jet Trooper Elite): if target within 2 spaces, add 1 blue die
  let _flyByFired = false;
  if ((_atkEff?.passives || []).includes('Fly-By') && target.dist != null && target.dist <= 2) {
    attackInfo = { ...attackInfo, dice: [...(attackInfo.dice || []), 'blue'] };
    _flyByFired = true;
  }
  // Utinni! (roundUtinniJawaBuffs): Jawa Scavenger gets +1 Accuracy and a VP-earning surge ability
  // Per-figure 2026-05-09 (multifigure-independent-activation rule).
  if (game.roundUtinniJawaBuffs && meta.dcName?.toLowerCase().includes('jawa scavenger')) {
    game.nextAttackBonusAccuracy = game.nextAttackBonusAccuracy || {};
    game.nextAttackBonusAccuracy[attackerFigureKey] = (game.nextAttackBonusAccuracy[attackerFigureKey] || 0) + 1;
    game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
    game.nextAttackBonusSurgeAbilities[attackerFigureKey] = game.nextAttackBonusSurgeAbilities[attackerFigureKey] || [];
    game.nextAttackBonusSurgeAbilities[attackerFigureKey].push('utinni_vp_1');
  }
  // Merciless (HK Assassin Droid Elite): if defender has harmful conditions, 1 Damage
  if ((_atkEff?.passives || []).includes('Merciless')) {
    const _merDefConds = game.figureConditions?.[target.figureKey] || [];
    const _merHarmful = ['Bleed', 'Stun', 'Weaken'].some(c => _merDefConds.includes(c));
    if (_merHarmful) {
      const _merDefPn2 = opponentPlayerNum(attackerPlayerNum);
      const _merTargetMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, _merDefPn2, target.figureKey) : null;
      if (_merTargetMsgId && dcHealthState) {
        const _merFkMatch = target.figureKey.match(/-(\d+)-(\d+)$/);
        const _merFigIdx = _merFkMatch ? parseInt(_merFkMatch[2], 10) : 0;
        await _applyDamage(game, { dcHealthState, logGameAction, client }, {
          figureKey: target.figureKey, msgId: _merTargetMsgId, figIndex: _merFigIdx,
          amount: 1, controllerPlayerNum: _merDefPn2,
          attackerPlayerNum, source: 'Merciless',
        });
      }
      await logGameAction(game, client, `⚡ **Merciless** — **${target.label}** suffers 1 Damage (has harmful condition).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Aim (Rebel Trooper Elite): if the target has already suffered damage during this group's activation, +1 Hit +2 Accuracy
  let _aimFired = false;
  if ((_atkEff?.passives || []).includes('Aim')) {
    const _aimDamaged = game.activationDamagedFigures?.[msgId] || [];
    if (target.figureKey && _aimDamaged.includes(target.figureKey)) {
      _aimFired = true;
    }
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
  if (_mysticHunterFired) await thread.send(`🔮 **Mystic Hunter** — **${meta.dcName}** becomes **Focused** (+1 green die).`).catch(discordCatch);
  if (_fullOfRageFired) await thread.send(`**Full of Rage** — Krrsantan becomes **Focused** before attacking (${_fullOfRageDmg} damage suffered, +1 green die).`).catch(discordCatch);
  if (_flyByFired) await thread.send(`🚀 **Fly-By** — Target within 2 spaces: +1 blue die to attack pool.`).catch(discordCatch);
  if (_aimFired) await thread.send(`🎯 **Aim** — Target already suffered damage this activation: +1 Hit, +2 Accuracy.`).catch(discordCatch);
  // Per-figure 2026-05-09: next-attack bonuses keyed by attackerFigureKey
  // (multifigure-independent-activation rule).
  const nextSurge = game.nextAttackBonusSurgeAbilities?.[attackerFigureKey] || [];
  const nextPierce = (game.nextAttackBonusPierce?.[attackerFigureKey] || 0) + (overrideDice?.pierce || 0);
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
    defenderDcName: targetDcName,
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
  // Aim (Rebel Trooper Elite): apply +1 Hit +2 Accuracy to pendingCombat
  if (_aimFired) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
  }
  // CC Passive Redraw (per CRR card text 2026-05-09): K&D / Targeting
  // Network grant the relevant figure (FORCE USER / DROID) a NEW
  // surge ability "Re-draw this card" while the card is in discard.
  // Player chooses whether to spend a surge on it among their other
  // surge options (instead of auto-firing on any surge spend).
  {
    const _redrawDiscardKey = ccDiscardKey(attackerPlayerNum);
    const _redrawDiscard = game[_redrawDiscardKey] || [];
    const _redrawAtkEff = getDcEffects()?.[meta.dcName] || getDcEffects()?.[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
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
  const attackerPassives = [...(getDcStats(meta.dcName).passives || [])];
  if (_formChoice) {
    const _fCard = getFormCards()[_formChoice];
    if (_fCard?.passives) attackerPassives.push(..._fCard.passives);
    if (_fCard?.combatPassives) attackerPassives.push(..._fCard.combatPassives);
  }
  const defenderPassives = target.isNpc ? [] : (getDcStats(targetDcName).passives || []);
  applyDcPassivesToCombat(game.pendingCombat, attackerPassives, defenderPassives);

  // Blood Feud: persistent +1 Hit when attacking a DC marked with Blood Feud
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
  if ((getDcStats(meta.dcName).passives || []).includes('Forward Mounted Blasters')) {
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
        // reroll window).
        game.pendingCombat.attackerRerollsRemaining = (game.pendingCombat.attackerRerollsRemaining || 0) + 1;
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
    // Targeting Computer (attachment): +1 atk reroll while attacking
    if (cardNameIncludes(_atkUpgrades, 'Targeting Computer')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Driven by Hatred (Darth Vader): +1 Hit, reroll 1 atk die (Brutality loss handled separately)
    if (cardNameIncludes(_atkUpgrades, 'Driven by Hatred')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Heir to the Jedi (Luke): reroll 1 atk die; +1 Hit on Ranged; Saber Strike Focus handled at declaration
    if (cardNameIncludes(_atkUpgrades, 'Heir to the Jedi')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
      if (isRanged) _pc.bonusHits = (_pc.bonusHits || 0) + 1;
    }
    // Rogue Smuggler (Han Solo): reroll 1 atk die (Distracting loss handled separately)
    if (cardNameIncludes(_atkUpgrades, 'Rogue Smuggler')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Wookiee Avenger (Chewbacca): +1 Hit while attacking
    if (cardNameIncludes(_atkUpgrades, 'Wookiee Avenger')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
    }
    // Cross Training: defend-only ability (no attack effect)
    // Guidance Systems (Mortar Trooper): optional -1 Hit, +2 Accuracy per use (multiple times per attack)
    if (cardNameIncludes(_atkUpgrades, 'Mortar Trooper')) {
      _pc.guidanceSystemsAvailable = true;
    }
    // Prey on the Weak (HUNTER): Pierce 1 + Accuracy 1 vs lower-cost figure
    if (cardNameIncludes(_atkUpgrades, 'Prey on the Weak')) {
      const _potwAtkCost = getDcStats(meta.dcName)?.cost ?? 0;
      const _potwDefCost = _pc.targetStats?.cost ?? 99;
      if (_potwAtkCost > _potwDefCost) {
        _pc.bonusPierce = (_pc.bonusPierce || 0) + 1;
        _pc.bonusAccuracy = (_pc.bonusAccuracy || 0) + 1;
      }
    }
    // Explosive Armaments (HUNTER/DROID): Surge: +1 Damage, Blast 1
    if (cardNameIncludes(_atkUpgrades, 'Explosive Armaments')) {
      _pc.bonusSurgeAbilities.push('damage 1, blast 1');
    }
    // Feeding Frenzy (CREATURE): Surge: Recover 2 while attacking adjacent
    if (cardNameIncludes(_atkUpgrades, 'Feeding Frenzy') && distanceToTarget <= 1) {
      _pc.bonusSurgeAbilities.push('recover 2');
    }
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
    // Combat Suit: reduce Pierce value of attack results by 1 (min 0, handled in computeCombatResult)
    if (cardNameIncludes(_defUpgrades, 'Combat Suit')) {
      _pc.defenderReducePierce = (_pc.defenderReducePierce || 0) + 1;
    }
    // Wookiee Avenger (defending): convert Dodge → Evade (handled in computeCombatResult)
    if (cardNameIncludes(_defUpgrades, 'Wookiee Avenger')) {
      _pc.wookieeAvengerDefend = true;
    }
    // Cross Training (defending): exhaust to reroll 1 defense die with color swap (flagged for reroll window)
    if (cardNameIncludes(_defUpgrades, 'Cross Training')) {
      const _ctExh = game.exhaustedSkirmishUpgrades?.[_defMsgId] || [];
      if (!cardNameIncludes(_ctExh, 'Cross Training')) {
        _pc.crossTrainingAvailable = true;
        _pc.crossTrainingDefMsgId = _defMsgId;
      }
    }
    // Rogue Smuggler (defender): lose Distracting — negate the passive if present
    if (cardNameIncludes(_defUpgrades, 'Rogue Smuggler')) {
      _pc.rougeSmuggler_loseDistracting = true;
    }
    // --- Exhaust-based attacker attachments (auto-applied, once per round) ---
    const _exh = game.exhaustedSkirmishUpgrades?.[msgId] || [];
    // Scavenged Weaponry: exhaust when declare attack → +1 Hit
    if (cardNameIncludes(_atkUpgrades, 'Scavenged Weaponry') && !cardNameIncludes(_exh, 'Scavenged Weaponry')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [..._exh, 'Scavenged Weaponry'];
      await thread.send('**Scavenged Weaponry** — Exhausted: +1 Hit applied to this attack.').catch(discordCatch);
    }
    // Explosive Armaments: exhaust while attacking → Blast 1
    if (cardNameIncludes(_atkUpgrades, 'Explosive Armaments') && !cardNameIncludes(_exh, 'Explosive Armaments')) {
      _pc.bonusBlast = (_pc.bonusBlast || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'Explosive Armaments'];
      await thread.send('**Explosive Armaments** — Exhausted: Blast 1 applied to this attack.').catch(discordCatch);
    }
    // The Darksaber: exhaust while attacking → reroll 1 attack die
    if (cardNameIncludes(_atkUpgrades, 'The Darksaber') && !cardNameIncludes(_exh, 'The Darksaber')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'The Darksaber'];
      await thread.send('**The Darksaber** — Exhausted: +1 attack reroll.').catch(discordCatch);
    }
    // Feeding Frenzy: exhaust while attacking a damaged figure → +1 Hit
    if (cardNameIncludes(_atkUpgrades, 'Feeding Frenzy') && !cardNameIncludes(_exh, 'Feeding Frenzy')) {
      const _ffDefHs = _defMsgId ? dcHealthState?.get(_defMsgId) : null;
      const _ffDefFi = target.figureKey ? parseInt((target.figureKey.match(/-(\d+)$/) || [])[1] || '0', 10) : 0;
      const _ffHp = _ffDefHs?.[_ffDefFi];
      if (_ffHp && _ffHp[0] < _ffHp[1]) {
        _pc.bonusHits = (_pc.bonusHits || 0) + 1;
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'Feeding Frenzy'];
        await thread.send('**Feeding Frenzy** — Exhausted: target has suffered damage, +1 Hit applied.').catch(discordCatch);
      }
    }
    // Zillo Technique (I51-I52) defender's team SU: both effects moved out of
    // declare-time per CRR step-4 modifier timing + Destruct.
    //   - Exhaust to cancel 2 Pierce: post-surge prompt (slice 3,
    //     maybePromptZilloPierceCancel inside sendReadyToResolveRolls).
    //   - Discard 1 CC for +1 Block: step-4 defender-modifier prompt
    //     (slice 6, maybePromptZilloDiscardForBlock inside proceedAfterRerolls'
    //     DEF block).
  }
  // Z-6 Trooper Rotary Cannon: before attacking, become Focused
  if (cardNameIncludes(_atkUpgrades, 'Z-6 Trooper')) {
    if (!attackerConds.includes('Focus')) {
      const _z6Result = applyConditionWithDie(game, attackerFigureKey, 'Focus', game.pendingCombat.attackInfo, 'green');
      if (_z6Result.applied) {
        game.pendingCombat.attackInfo = _z6Result.attackInfo;
        await thread.send('**Rotary Cannon** — Z-6 Trooper becomes Focused before attacking.').catch(discordCatch);
      }
    }
  }
  // The General's Ranks: +1 Hit when attacking during a non-activation (not this group's activation)
  if (cardNameIncludes(_atkUpgrades, "The General's Ranks")) {
    const _tgrActionsData = game.dcActionsData?.[msgId];
    if (!_tgrActionsData?.threadId) {
      // Not in this group's activation — non-activation attack
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
      await thread.send("**The General's Ranks** — +1 Hit (non-activation attack).").catch(discordCatch);
    }
  }
  // Scavenged Walker: -1 Hit penalty on end-of-round interrupt attack
  if (game.scavengedWalkerAttackPenalty?.[msgId]) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
    delete game.scavengedWalkerAttackPenalty[msgId];
    await thread.send('**Scavenged Walker** — -1 Hit applied to this interrupt attack.').catch(discordCatch);
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
      game.pendingDbhDiePick = { msgId, attackerPlayerNum: combat.attackerPlayerNum, dice: _dbhDice };
      const _dbhAtkOwnerId = game[`player${combat.attackerPlayerNum}Id`];
      await thread.send({
        content: `<@${_dbhAtkOwnerId}> **Driven by Hatred** — choose 1 die to remove from your attack pool. (You cannot roll until you pick.)`,
        components: [new ActionRowBuilder().addComponents(_dbhBtns)],
        allowedMentions: { users: [_dbhAtkOwnerId] },
      }).catch(discordCatch);
      delete game.drivenByHatredAttackPenalty[msgId];
    }
  }
  // Flame Trooper Fireproof: this figure cannot suffer Strain (mark on combat object for handlers)
  if (cardNameIncludes(_atkUpgrades, 'Flame Trooper')) {
    game.pendingCombat.attackerFireproof = true;
  }
  if (cardNameIncludes(_defUpgrades, 'Flame Trooper')) {
    game.pendingCombat.defenderFireproof = true;
  }
  // Autofire: add chain attack surge ability + mark on combat
  if (game.autofireActive?.[msgId]) {
    game.pendingCombat.bonusSurgeAbilities.push('autofire_chain');
    game.pendingCombat.autofireAttack = true;
    delete game.autofireActive[msgId]; // consumed
  }
  // Barrage (CT-1701) second attack: mark on combat so defender adds 1 white die
  if (game.barrageDefenseBonus?.[msgId]) {
    game.pendingCombat.barrageAttack = true;
    delete game.barrageDefenseBonus[msgId]; // consumed
  }
  // Fire Mission: +Blast 1
  if (game.fireMissionActive?.[msgId]) {
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + 1;
    game.pendingCombat.fireMissionAttack = true;
    delete game.fireMissionActive[msgId]; // consumed
    await thread.send('**Fire Mission** — +Blast 1 applied to this attack.').catch(discordCatch);
  }

  // Spectre Cell: passive +1 Hit for all friendly figures while attacking
  if ((getDcList(game, attackerPlayerNum) || []).some(dc => (dc.dcName || dc) === '[Spectre Cell]')) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    await thread.send('**Spectre Cell** — +1 Hit (passive).').catch(discordCatch);
  }

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
          if (countSpaces(_csRawMs, k.pos, figPos, _csClosedDoorEdges) <= k.maxRange) {
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

  // Fury of Kashyyyk: elite WOOKIEE attacking within 2 + another friendly WOOKIEE within 2 of defender → Pierce 1
  // Per destruct 2026-05-07: skip during Lure / False Orders attacks ("no figures friendly").
  if (!game.pendingCombat?.noFriendliesActive) {
    const _fokAtkDcList = getDcList(game, attackerPlayerNum) || [];
    if (_fokAtkDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) {
      const _fokKwMap = getDcKeywordsGlobal(game);
      const _fokAtkKws = (_fokKwMap[meta.dcName] || []).map(k => String(k).toUpperCase());
      const _fokAtkEff = getDcEffectsGlobal()[meta.dcName];
      const _fokIsElite = meta.dcName?.includes('(Elite)') || _fokAtkEff?.elite === true;
      if (_fokAtkKws.includes('WOOKIEE') && _fokIsElite && distanceToTarget <= 2 && !target.isNpc) {
        const defPos = game.figurePositions?.[game.pendingCombat.defenderPlayerNum]?.[target.figureKey];
        if (defPos) {
          const friendlyPositions = game.figurePositions?.[attackerPlayerNum] || {};
          const hasFriendlyWookiee = Object.entries(friendlyPositions).some(([fk, pos]) => {
            if (!pos || fk === attackerFigureKey) return false;
            const fkDcName = dcNameFromFigureKey(fk);
            const fkKws = (_fokKwMap[fkDcName] || []).map(k => String(k).toUpperCase());
            return fkKws.includes('WOOKIEE') && countSpaces(_csRawMs, pos, defPos, _csClosedDoorEdges) <= 2;
          });
          if (hasFriendlyWookiee) {
            game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 1;
            await thread.send('**Fury of Kashyyyk** — Another friendly WOOKIEE within 2 spaces of defender: Pierce 1 applied.').catch(discordCatch);
          }
        }
      }
    }
  }

  // Payback (Dengar CC reaction): if attacker has a pending Payback surge bonus, apply it now
  const paybackBonus = game.paybackBonusSurge?.[msgId];
  if (paybackBonus) {
    game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + paybackBonus;
    delete game.paybackBonusSurge[msgId];
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
  if (game.attackDicePenaltyForMsgId?.[msgId] > 0) {
    const _adpLabel = game.attackDicePenaltyLabel || 'Attack penalty';
    const _adpDice = [...(game.pendingCombat.attackInfo.dice || [])];
    const _adpToRemove = game.attackDicePenaltyForMsgId[msgId];
    if (_adpDice.length === 0 || _adpToRemove <= 0) {
      delete game.attackDicePenaltyForMsgId[msgId];
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
      delete game.attackDicePenaltyForMsgId[msgId];
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
  const atkEff = getDcEffects()[meta.dcName] || getDcEffects()[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
  const defEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName?.replace(/\s*\[.*\]\s*$/, '')];
  const atkSpecialIds = atkEff?.specialAbilityIds || [];
  const defSpecialIds = defEff?.specialAbilityIds || [];

  // Health state for HP-conditional abilities (Full of Rage, Fury)
  const atkHpArr = dcHealthState?.get(msgId) || [];
  const atkFigHp = atkHpArr[figureIndex];
  const atkDamageSuffered = atkFigHp ? Math.max(0, (atkFigHp[1] ?? atkFigHp[0] ?? 0) - (atkFigHp[0] ?? 0)) : 0;

  // Battle Meditation / Assassin (Diala Passil, BT-1): auto-Focus before attacking
  if (hasBattleMeditationAbility(atkSpecialIds)) {
    const _bmResult = applyConditionWithDie(game, attackerFigureKey, BATTLE_MEDITATION_CONDITION, game.pendingCombat.attackInfo, BATTLE_MEDITATION_BONUS_DIE);
    if (_bmResult.applied) {
      game.pendingCombat.attackInfo = _bmResult.attackInfo;
      const bm_label = battleMeditationLabel(meta.dcName);
      await thread.send(`**${bm_label}** — **${meta.dcName}** is **Focused** before attacking (+1 green die).`);
    }
  }

  // Full of Rage (Krrsantan): auto-Focus if 3+ damage suffered
  if (hasFullOfRageAbility(atkSpecialIds) && fullOfRageDamageTriggered(atkDamageSuffered)) {
    const _forResult = applyConditionWithDie(game, attackerFigureKey, FULL_OF_RAGE_CONDITION, game.pendingCombat.attackInfo, FULL_OF_RAGE_BONUS_DIE);
    if (_forResult.applied) {
      game.pendingCombat.attackInfo = _forResult.attackInfo;
      await thread.send(`**Full of Rage** — Krrsantan is **Focused** before attacking (${atkDamageSuffered} damage suffered, +1 green die).`);
    }
  }

  // Fury (Wookiee Warriors): +1 Surge if 5+ damage
  if (hasFuryAbility(atkSpecialIds) && furyDamageTriggered(atkDamageSuffered)) {
    game.pendingCombat.furyBonus = FURY_SURGE_BONUS;
    await thread.send(`**Fury** — Wookiee Warrior is **Furious** (+1 Surge, having suffered ${atkDamageSuffered} damage).`);
  }

  // Cunning (Han Solo, Jyn Odan, Nexu): while defending, +1 Block per Evade result
  if (hasCunningAbility(defSpecialIds)) {
    const r = applyCunningFlag(game.pendingCombat);
    game.pendingCombat.hasCunning = r.hasCunning;
  }

  // Distracting (Han Solo, C-3PO): if this figure is adjacent to the targeted space, +1 Evade for defender
  // "Friendly figure defending" — check if any friendly figure with distracting is adjacent to target.coord
  const mapSpaces = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
  const targetCoord = target.coord ? String(target.coord).toLowerCase() : null;
  if (mapSpaces && targetCoord) {
    const adjToTarget = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    adjToTarget.add(targetCoord); // figure in same space also counts
    const defenderFigPositions = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(defenderFigPositions)) {
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (!hasDistractingAbility(fkEff?.specialAbilityIds)) continue;
      if (!adjToTarget.has(String(pos).toLowerCase())) continue;
      // Rogue Smuggler: "You lose Distracting" — skip if this figure's DC has the attachment
      const _distMsgId = findDcMessageIdForFigure?.(game.gameId, defenderPlayerNum, fk);
      const _distUpg = _distMsgId ? (game.p1DcAttachments?.[_distMsgId] || game.p2DcAttachments?.[_distMsgId] || []) : [];
      if (cardNameIncludes(_distUpg, 'Rogue Smuggler')) continue;
      const r = applyDistractingEvade(game.pendingCombat);
      game.pendingCombat.bonusEvade = r.bonusEvade;
      await thread.send(`**Distracting** (${fkDcName}) — adjacent to target, +1 Evade for defender.`);
      break; // only one Distracting bonus
    }
  }

  // Hunker Down (Cara Dune): if defender shares edge/corner with blocking/impassable/difficult terrain, +1 Evade
  if (hasHunkerDownAbility(defSpecialIds) && mapSpaces && targetCoord) {
    const adjToDefender = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    if (hasQualifyingTerrainAdjacent(adjToDefender, mapSpaces.terrain || {})) {
      const r = applyHunkerDownEvade(game.pendingCombat);
      game.pendingCombat.bonusEvade = r.bonusEvade;
      await thread.send('**Hunker Down** — Cara Dune is adjacent to terrain, +1 Evade.');
    }
  }

  // On a Diplomatic Mission: +1 Evade on defense for rest of round
  if (_defMsgId && game.diplomaticMissionEvade?.[_defMsgId]) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + 1;
    await thread.send("**On a Diplomatic Mission** — +1 Evade on defense (rest of round).");
  }

  // Relentless (Trandoshan Hunter, IG-88, Fifth Brother): 1 Strain to target within 3
  // destruct 2026-05-06: routed through applyStrain so the target's controller
  // gets the per-strain choice prompt + Under Duress pre-prompt fires for the
  // attacker (UD prompt fires regardless of who caused the strain).
  if (hasRelentlessAbility(atkSpecialIds) && relentlessInRange(distanceToTarget)) {
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

  // Flawless Execution (Cad Bane): become Focused; if already Focused → Wild token + yellow die
  if (atkSpecialIds.includes('flawless_execution')) {
    if (!attackerConds.includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      resetCondition(game, attackerFigureKey, 'Focus');
      await thread.send('**Flawless Execution** — Cad Bane is **Focused** before attacking (+1 green die).');
    } else {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'yellow'] };
      game.pendingPowerTokenGrant = { grants: [{ figureKey: attackerFigureKey, figName: meta.dcName, count: 1 }], channelId: thread.id, playerNum: attackerPlayerNum };
      await thread.send('**Flawless Execution** — Cad Bane was already Focused: +1 yellow die. Choose a power token type:');
      await sendPowerTokenChoicePrompt(thread, game.gameId, game.pendingPowerTokenGrant.grants);
    }
  }

  // Shock and Awe (Cara Dune): once per round, replace 1 Yellow die with Red
  if (hasShockAndAweAbility(atkSpecialIds)) {
    const sawKey = buildShockAndAweRoundKey(attackerFigureKey);
    if (!isShockAndAweAlreadyUsed(game.roundFigureAbilityUsed, sawKey)) {
      const r = applyShockAndAweDieSwap(game.pendingCombat.attackInfo.dice || []);
      if (r.applied) {
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: r.dice };
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[sawKey] = true;
        await thread.send('**Shock and Awe** — 1 Yellow die replaced with Red.');
      }
    }
  }

  // Vanguard (AT-RT): now driven by a pre-target player-choice picker
  // in dc-play-area.js (mirrors EE-3 Carbine). The swap, if any, is
  // already applied via pendingOverrideAttackDice before combat starts.
  // Here we just log the post-target outcome + revert if the chosen
  // target ended up out-of-range (>3 spaces) so the card text's
  // "while attacking a figure within 3 spaces" precondition holds.
  if (hasVanguardAbility(atkSpecialIds) && game.pendingVanguardSwap?.[combat.attackerMsgId] === 'swapped') {
    if (vanguardInRange(distanceToTarget)) {
      await thread.send(`**Vanguard** — swap applied (target within ${distanceToTarget} spaces).`);
    } else {
      // Target is out of Vanguard's 3-space range; the pre-target swap
      // shouldn't have applied. Log it; the swap stays mechanically
      // (player accepted it) but card-text-strict the swap is invalid.
      await thread.send(`⚠️ **Vanguard** — target is ${distanceToTarget} spaces away (>3); the pre-target swap was committed but per card text only applies within 3 spaces.`);
    }
    if (game.pendingVanguardSwap) game.pendingVanguardSwap[combat.attackerMsgId] = 'decided';
  }

  // ACP Scattergun (Trandoshan Hunter Elite) / Scattergun (Trandoshan Hunter Regular): +Hits when adjacent to target
  if (scattergunInRange(distanceToTarget)) {
    if (hasAcpScattergun(atkSpecialIds)) {
      const r = applyScattergunHits(game.pendingCombat, ACP_SCATTERGUN_HIT_DELTA);
      game.pendingCombat.bonusHits = r.bonusHits;
      await thread.send('**ACP Scattergun** — adjacent to target: +2 Hits.');
    } else if (hasScattergun(atkSpecialIds)) {
      const r = applyScattergunHits(game.pendingCombat, SCATTERGUN_HIT_DELTA);
      game.pendingCombat.bonusHits = r.bonusHits;
      await thread.send('**Scattergun** — adjacent to target: +1 Hit.');
    }
  }

  // Shared Intuition (4-LOM): +1 Hit while attacking if another
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
        const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!isHunterFriendly(fkEff)) continue;
        if (!sharedIntuitionInRange(countSpaces(_csRawMs, attackerPos, pos, _csClosedDoorEdges))) continue;
        if (!hasLineOfSightByCoord(game, pos, targetCoord, mapSpaces, getFigureSize, { blocking: null })) continue;
        const r = applySharedIntuitionHit(game.pendingCombat);
        game.pendingCombat.bonusHits = r.bonusHits;
        await thread.send(`**Shared Intuition** — ${fkDcName} (HUNTER) is within 3 spaces with LOS to target: +1 Hit.`);
        found = true;
      }
    }
  }

  // Sharpshooter (Fennec Shand): auto-Focus if target is 5+ spaces away
  if (hasSharpshooterAbility(atkSpecialIds) && sharpshooterInRange(distanceToTarget)) {
    const _ssResult = applyConditionWithDie(game, attackerFigureKey, SHARPSHOOTER_CONDITION, game.pendingCombat.attackInfo, SHARPSHOOTER_BONUS_DIE);
    if (_ssResult.applied) {
      game.pendingCombat.attackInfo = _ssResult.attackInfo;
      await thread.send(`**Sharpshooter** — **${meta.dcName}** is **Focused** (target ${distanceToTarget} spaces away, +1 green die).`);
    }
  }

  // Find Weakness (Scout Trooper Elite): -1 Evade to defense results (accuracy handled via passives)
  if (hasFindWeaknessAbility(atkSpecialIds)) {
    const r = applyFindWeaknessEvade(game.pendingCombat);
    game.pendingCombat.bonusEvade = r.bonusEvade;
    await thread.send('**Find Weakness** — −1 Evade applied to defense results.');
  }

  // Exploit Weakness (Scout Trooper Elite): +1 Surge if defender has a harmful condition
  if (hasExploitWeaknessAbility(atkSpecialIds)) {
    const defConds = game.figureConditions?.[target.figureKey] || [];
    if (defenderHasHarmfulCondition(defConds)) {
      const r = applyExploitWeaknessSurge(game.pendingCombat);
      game.pendingCombat.surgeBonus = r.surgeBonus;
      await thread.send('**Exploit Weakness** — defender has a harmful condition, +1 Surge.');
    }
  }

  // Conclusion (HK-47): −1 Dodge to defense results while attacking.
  // Per destruct 2026-05-08: applies to Dodge, not Evade. computeCombatResult
  // reads conclusionDodgeCancel and clears defRoll.dodge.
  if (hasConclusionAbility(atkSpecialIds)) {
    game.pendingCombat.conclusionDodgeCancel = true;
    await thread.send('**Conclusion** — −1 Dodge: any Dodge rolled by defender is cancelled.');
  }

  // Query (HK-47): defender prompt deferred to proceedAfterRerolls
  // (modifier step) — same pattern as Negotiate. Per destruct 2026-05-08
  // defender chooses "become Bleeding" or "accept +1 Damage". Tagged
  // here at declare time; resolved at modifier step.
  if (hasQueryAbility(atkSpecialIds)) {
    game.pendingCombat.queryNeedsPrompt = true;
  }

  // Disposable (Hired Gun Regular): -1 Evade to own defense results
  if (hasDisposableAbility(defSpecialIds)) {
    const bump = applyEvadeDebuff(game.pendingCombat);
    game.pendingCombat.bonusEvade = bump.bonusEvade;
    await thread.send('**Disposable** — −1 Evade applied to defender\'s defense results.');
  }

  // Front Line (Echo Base Trooper): within 3 spaces, +2 Accuracy ALWAYS,
  // blue→red swap is OPTIONAL (per alexanbv 2026-05-11). +2 Accuracy
  // applied here; swap is offered via the on-declare die-swap window
  // (combat._frontLineSwapDecided flag, populated by od_dieswap_f_*).
  if (hasFrontLineAbility(atkSpecialIds) && frontLineInRange(distanceToTarget)) {
    game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
    if (game.pendingCombat._frontLineSwap) {
      const swap = applyFrontLineDieSwap(game.pendingCombat.attackInfo.dice || []);
      if (swap.applied) {
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: swap.dice };
        await thread.send(`**Front Line** — 1 blue die replaced with red + +2 Accuracy (target within ${distanceToTarget} spaces).`);
      } else {
        await thread.send(`**Front Line** — +2 Accuracy applied (no blue die to swap; target within ${distanceToTarget} spaces).`);
      }
    } else {
      await thread.send(`**Front Line** — Target within ${distanceToTarget} spaces: +2 Accuracy applied. (Blue→Red swap skipped.)`);
    }
  }

  // Cortosis Weave (Echo Base Trooper Elite): reduce Pierce by 2
  if (hasCortosisWeaveAbility(defSpecialIds)) {
    const r = applyCortosisWeave(game.pendingCombat);
    game.pendingCombat.bonusPierce = r.bonusPierce;
    await thread.send('**Cortosis Weave** — Pierce reduced by 2 (min 0).');
  }

  // Spectre Cell: passive +1 Block for all friendly figures while defending
  if (!target.isNpc && (getDcList(game, game.pendingCombat.defenderPlayerNum) || []).some(dc => (dc.dcName || dc) === '[Spectre Cell]')) {
    game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
    await thread.send('**Spectre Cell** — +1 Block (passive).').catch(discordCatch);
  }

  // Gamorrean Honor Guard: +1 Block while defending during Ranged attack
  if (hasGamorreanHonorGuardAbility(defSpecialIds) && gamorreanHonorGuardApplies(isRanged)) {
    const { bonusBlock } = applyGamorreanHonorGuardBonus(game.pendingCombat);
    game.pendingCombat.bonusBlock = bonusBlock;
    await thread.send('**Gamorrean Honor Guard** — +1 Block (defending against Ranged attack).');
  }

  // Composite Plating (Heavy Stormtrooper Regular): +1 Block if attacker 4+ spaces away
  if (hasCompositePlatingAbility(defSpecialIds) && compositePlatingApplies(distanceToTarget)) {
    const { bonusBlock } = applyCompositePlatingBonus(game.pendingCombat);
    game.pendingCombat.bonusBlock = bonusBlock;
    await thread.send(`**Composite Plating** — +1 Block (attacker ${distanceToTarget} spaces away).`);
  }

  // Sniper (Alliance Ranger Regular): forced +1 reroll at 5+ spaces (no "may")
  if (hasSniperAbility(atkSpecialIds) && sniperGateOpen(distanceToTarget)) {
    const { rerollOneAttackDie } = applySniperRerolls(game.pendingCombat, false);
    game.pendingCombat.rerollOneAttackDie = rerollOneAttackDie;
    await thread.send(`**Sniper** — +1 attack reroll (target ${distanceToTarget} spaces away).`);
  }

  // Elite Sniper (Alliance Ranger Elite): +2 reroll at 5+ spaces
  if (hasEliteSniperAbility(atkSpecialIds) && sniperGateOpen(distanceToTarget)) {
    const { rerollOneAttackDie } = applySniperRerolls(game.pendingCombat, true);
    game.pendingCombat.rerollOneAttackDie = rerollOneAttackDie;
    await thread.send(`**Elite Sniper** — +2 attack rerolls (target ${distanceToTarget} spaces away).`);
  }

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
      let _mtlMode = null;
      let _mtlSourceName = null;
      // Prefer FORCE USER (turn mode is strictly better); fall back to non-FU unique.
      for (const [fk, pos] of Object.entries(friendlyPos)) {
        if (fk === attackerFigureKey) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!isUniqueFriendly(fkEff)) continue;
        if (!muchToLearnInRange(countSpaces(_csRawMs, atkPos, pos, _csClosedDoorEdges))) continue;
        if (isForceUserFriendly(fkEff)) {
          _mtlMode = 'turn';
          _mtlSourceName = fkDcName;
          break;
        }
        if (!_mtlMode) {
          _mtlMode = 'reroll';
          _mtlSourceName = fkDcName;
        }
      }
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

  // Forest Fighters (Ewok Warrior Elite): +1 Hit during melee attack if Hidden
  if (hasForestFightersAbility(atkSpecialIds)) {
    const atkConds = game.figureConditions?.[attackerFigureKey] || [];
    if (forestFightersQualifies({ isRanged, attackerConditions: atkConds })) {
      const r = applyForestFightersHit(game.pendingCombat);
      game.pendingCombat.bonusHits = r.bonusHits;
      await thread.send('**Forest Fighters** — +1 Hit (Hidden, Melee attack).');
    }
  }

  // Sentinel / Protector: scan defender's friendlies for adjacent-to-target, +1 Block. Limit 1 per attack.
  // Per destruct 2026-05-07: "No figures are considered friendly during" Lure / False Orders attacks.
  // Sentinel/Protector are friendly-gated defender-side reactions — skip entirely when noFriendliesActive.
  if (mapSpaces && targetCoord && !target.isNpc && !game.pendingCombat?.noFriendliesActive) {
    const adjToTargetSP = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    adjToTargetSP.add(targetCoord);
    const defFigPos = game.figurePositions?.[defenderPlayerNum] || {};
    const defenderKws = (defEff?.keywords || []).map(k => String(k).toUpperCase());
    const defenderIsGuardian = defenderKws.includes('GUARDIAN');
    let sentinelApplied = false;
    for (const [fk, pos] of Object.entries(defFigPos)) {
      if (sentinelApplied) break;
      if (fk === target.figureKey) continue; // skip the defender itself
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      const fkAbilityIds = fkEff?.specialAbilityIds || [];
      if (!adjToTargetSP.has(String(pos).toLowerCase())) continue;
      // Sentinel: only defends non-GUARDIAN figures
      if (fkAbilityIds.includes('sentinel') && !defenderIsGuardian) {
        game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
        await thread.send(`**Sentinel** (${fkDcName}) — adjacent to target space, +1 Block for defender.`);
        sentinelApplied = true;
      }
      // Protector (Chewbacca): works for ALL friendly defenders (no GUARDIAN restriction).
      // Wookiee Avenger replaces Protector — the upgraded card lists WA in its
      // specials slot instead of Protector. Skip Protector when WA is attached
      // to this Chewbacca's DC (parallel to DBH stripping Brutality).
      if (!sentinelApplied && fkAbilityIds.includes('protector')) {
        const _protMsgId = findDcMessageIdForFigure?.(game.gameId, defenderPlayerNum, fk);
        const _protAtts = _protMsgId
          ? (game.p1DcAttachments?.[_protMsgId] || game.p2DcAttachments?.[_protMsgId] || [])
          : [];
        const _protReplaced = cardNameIncludes(_protAtts, 'Wookiee Avenger');
        if (!_protReplaced) {
          game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
          await thread.send(`**Protector** (${fkDcName}) — adjacent to target space, +1 Block for defender.`);
          sentinelApplied = true;
        }
      }
    }
  }

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
      // Regular: optional — remind defender they may spend 1 Strain to deal 1 Strain to attacker
      if (!ktpApplied && hasKtpRegularAbility(fkAbilityIds)) {
        // Check: target space must not contain a friendly GUARDIAN
        const targetFigKws = (defEff?.keywords || []).map(k => String(k).toUpperCase());
        if (!targetFigKws.includes('GUARDIAN')) {
          await thread.send(`**Keep the Peace** reminder — **${fkDcName}** is adjacent to the target space. Defender may suffer 1 Strain to make the attacker suffer 1 Strain.`);
          ktpApplied = true;
        }
      }
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
        if (countSpaces(_csRawMs, atkPosAC, pos, _csClosedDoorEdges) > 4) continue;
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
        const _afDist = _csRawMs ? countSpaces(_csRawMs, atkPosAF, pos, _csClosedDoorEdges) : Infinity;
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

  // Slippery (Alliance Smuggler E/R): while defending, apply -2 Accuracy
  if (hasSlipperyAbility(defSpecialIds)) {
    const bump = applySlipperyBonus({ bonusAccuracy: game.pendingCombat.bonusAccuracy });
    game.pendingCombat.bonusAccuracy = bump.bonusAccuracy;
    await thread.send('**Slippery** — Defender applies -2 Accuracy to the attack.');
  }

  // Take Cover (Jawa Scavenger E/R): while defending, +1 Block and -1 Evade
  if (hasTakeCoverAbility(defSpecialIds)) {
    const bump = applyTakeCoverBonus({
      bonusBlock: game.pendingCombat.bonusBlock,
      bonusEvade: game.pendingCombat.bonusEvade,
    });
    game.pendingCombat.bonusBlock = bump.bonusBlock;
    game.pendingCombat.bonusEvade = bump.bonusEvade;
    await thread.send('**Take Cover** — Defender applies +1 Block, -1 Evade.');
  }

  // Aim (Rebel Trooper E/R): +1 Hit, +2 Accuracy if figure has not moved this activation
  if (hasAimAbility(atkSpecialIds)) {
    if (aimBonusApplies(attackerFigureKey, game.figureMoved)) {
      const bump = applyAimBonus({
        bonusHits: game.pendingCombat.bonusHits,
        bonusAccuracy: game.pendingCombat.bonusAccuracy,
      });
      game.pendingCombat.bonusHits = bump.bonusHits;
      game.pendingCombat.bonusAccuracy = bump.bonusAccuracy;
      await thread.send('**Aim** — Has not moved this activation: +1 Hit, +2 Accuracy.');
    }
  }

  // Dead Precise (Ko-Tun Feralo) — per destruct 2026-05-08:
  // "When a figure within 3 spaces of Ko-Tun is attacking, if it spent
  //  a Power Token, it may reroll 1 attack die and apply −1 Dodge to
  //  the attack results. Also applies to Ko-Tun herself and stacks
  //  with Professional."
  //
  // Aura: triggers when attacker is within 3 of ANY friendly Ko-Tun
  // (including Ko-Tun herself, since distance 0 is within 3) AND has
  // spent a Power Token this attack. Effects:
  //   +1 attacker reroll (stacks with Professional, Targeting Computer,
  //    Heir to the Jedi, etc.)
  //   −1 Dodge to attack results (cancels 1 of the defender's Dodges
  //    via the numeric bonusDodge model wired earlier this session).
  if (game.pendingCombat.attackerSpentPowerToken && !game.pendingCombat.deadPreciseApplied) {
    const _dpAtkPos = game.pendingCombat.attackerFigureKey
      ? (game.figurePositions?.[attackerPlayerNum]?.[game.pendingCombat.attackerFigureKey])
      : null;
    const _dpMapId = game.selectedMap?.id;
    const _dpMs = _dpMapId ? getMapData?.(_dpMapId) : null;
    if (_dpAtkPos && _dpMs) {
      let _dpFound = false;
      for (const [_dpFk, _dpPos] of Object.entries(game.figurePositions?.[attackerPlayerNum] || {})) {
        if (!_dpPos) continue;
        if (dcNameFromFigureKey(_dpFk) !== 'Ko-Tun Feralo') continue;
        if (!isWithinSpaces(_dpMs, String(_dpPos).toLowerCase(), String(_dpAtkPos).toLowerCase(), 3)) continue;
        _dpFound = true;
        break;
      }
      if (_dpFound) {
        game.pendingCombat.attackerRerollsRemaining = (game.pendingCombat.attackerRerollsRemaining || 0) + 1;
        game.pendingCombat.bonusDodge = (game.pendingCombat.bonusDodge || 0) - 1;
        game.pendingCombat.deadPreciseApplied = true;
        await thread.send('**Dead Precise** (Ko-Tun within 3) — attacker spent a Power Token: +1 attack-die reroll, −1 Dodge to attack results.');
      }
    }
  }

  // Spray Fire (Heavy Stormtrooper Elite): "you may apply -3 Accuracy
  // and +1 Surge to the attack results." Player choice — surfaced at
  // step-4 attacker modifier window (proceedAfterRerolls) via the
  // combat_passive_ prompt pattern.

  // Improvised Cover (Verena Talos): +1 Block if adjacent to object or non-friendly, non-attacker figure
  if (defSpecialIds.includes('improvised_cover_verena') && mapSpaces && targetCoord) {
    const adjToDefIC = (mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase());
    // Check for adjacent hostile/neutral figures (attacker's figures that aren't the attacker)
    const atkFigPosIC = game.figurePositions?.[attackerPlayerNum] || {};
    let icFound = false;
    for (const [fk, pos] of Object.entries(atkFigPosIC)) {
      if (fk === attackerFigureKey) continue;
      if (adjToDefIC.includes(String(pos).toLowerCase())) { icFound = true; break; }
    }
    if (icFound) {
      game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
      await thread.send('**Improvised Cover** — Adjacent to non-friendly figure (not attacker): +1 Block.');
    }
  }

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
  // Apply bonusHits from overrideDice (e.g. Overheated: -1 Hit, Flurry of Blows: +1 Hit)
  if (overrideDice?.bonusHits) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + overrideDice.bonusHits;
    if (overrideDice.bonusHits < 0) {
      await thread.send(`**Overheated** — −${Math.abs(overrideDice.bonusHits)} Hit applied automatically.`).catch(discordCatch);
    } else if (overrideDice.bonusHits > 0) {
      await thread.send(`**+${overrideDice.bonusHits} Hit** applied to attack results.`).catch(discordCatch);
    }
  }
  // Optimal Bombardment: apply +Blast bonus if this figure was granted one
  if (game.optimalBombardmentBlastBonus?.[msgId]) {
    const _obBlast = game.optimalBombardmentBlastBonus[msgId];
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + _obBlast;
    await thread.send(`**Optimal Bombardment** — +${_obBlast} Blast added to this attack.`).catch(discordCatch);
    delete game.optimalBombardmentBlastBonus[msgId];
  }

  // The Force is With Me (Chirrut): ranged attack targeting Chirrut — choose adjacent hostile; -1 Hit + 1 dmg to chosen
  if (isRanged && defSpecialIds.includes('the_force_is_with_me_chirrut') && mapSpaces && targetCoord) {
    const adjToChirrut = (mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase());
    const atkFigPos = game.figurePositions?.[attackerPlayerNum] || {};
    let _tfiwmTarget = null;
    for (const [fk, pos] of Object.entries(atkFigPos)) {
      if (adjToChirrut.includes(String(pos).toLowerCase())) {
        _tfiwmTarget = fk;
        break;
      }
    }
    if (_tfiwmTarget) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
      const _tfiwmDcName = dcNameFromFigureKey(_tfiwmTarget);
      // Deal 1 damage to the adjacent hostile
      const _tfiwmMatch = _tfiwmTarget.match(/^(.+)-(\d+)-(\d+)$/);
      if (_tfiwmMatch) {
        const [, _tfDcN, _tfDgI, _tfFiStr] = _tfiwmMatch;
        const _tfMsgIds = getDcMessageIds(game, attackerPlayerNum) || [];
        const _tfDcList = getDcList(game, attackerPlayerNum) || [];
        const _tfDcHs = ctx.dcHealthState;
        if (_tfDcHs) {
          let _tfMsgId = null;
          for (let i = 0; i < _tfMsgIds.length; i++) {
            if (_tfDcList[i]?.dcName === _tfDcN) { _tfMsgId = _tfMsgIds[i]; break; }
          }
          if (_tfMsgId) {
            const _tfFi = parseInt(_tfFiStr, 10);
            await _applyDamage(game, { dcHealthState: _tfDcHs, logGameAction, client }, {
              figureKey: _tfiwmTarget, msgId: _tfMsgId, figIndex: _tfFi,
              amount: 1, controllerPlayerNum: attackerPlayerNum,
              source: 'The Force is With Me',
            });
          }
        }
      }
      await thread.send(`**The Force is With Me** — Ranged attack targeting Chirrut. Adjacent hostile **${_tfiwmDcName}** suffers 1 Damage. -1 Hit applied to attack.`);
    }
  }

  // Loku Recon Token: Set Your Sights — Pierce 1 when attacking figure with recon token
  if (game.reconToken?.figureKey === target.figureKey && game.reconToken?.playerNum === attackerPlayerNum) {
    game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 1;
    await thread.send('**Set Your Sights** — Attacking figure with Recon token: +Pierce 1.');
  }
  // Loku Recon Token: Mon Cala SF — Loku becomes Focused when attacking recon-tokened figure
  if (game.reconToken?.figureKey === target.figureKey && game.reconToken?.playerNum === attackerPlayerNum) {
    if (hasMonCalaSfLokuAbility(atkSpecialIds)) {
      applyCondition(game, attackerFigureKey, MON_CALA_SF_LOKU_CONDITION);
      await thread.send('**Mon Cala Special Forces** — Loku gains Focus for attacking Recon-tokened figure.');
    }
  }

  // Strike Me Down (Obi-Wan): when attack targeting Obi-Wan is declared, may reduce VP cost by 3 and be defeated (ending the attack)
  if (defSpecialIds.includes('strike_me_down_obiwan')) {
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    setPendingStrikeMeDown(game, {
      gameId: game.gameId,
      defenderPlayerNum,
      attackerPlayerNum,
      defenderFigureKey: target.figureKey,
      defenderLabel: target.label,
      combatThreadId: thread.id,
    });
    const smdRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`strike_me_down_yes_${game.gameId}`).setLabel('Use Strike Me Down').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`strike_me_down_no_${game.gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
    );
    await thread.send(sanitizeMentions({ content: `<@${defOwnerId}> **Strike Me Down** — Obi-Wan may choose to reduce his figure cost by 3 and be defeated, ending this attack. Use this ability?`, components: [smdRow], allowedMentions: { users: [defOwnerId] } }));
  }

  // Slow on the Draw (Greedo): when Greedo declares an attack, defender may interrupt to attack Greedo first
  if (hasSlowOnTheDrawAbility(atkSpecialIds)) {
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    setPendingSlowOnTheDraw(game, {
      gameId: game.gameId,
      defenderPlayerNum,
      attackerPlayerNum,
      attackerFigureKey: attackerFigureKey,
      attackerMsgId: msgId,
      attackerLabel: attackerDisplayName,
      combatThreadId: thread.id,
    });
    const sotdRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`slow_on_draw_yes_${game.gameId}`).setLabel('Interrupt: Attack Greedo first').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`slow_on_draw_no_${game.gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
    );
    await thread.send(sanitizeMentions({ content: `<@${defOwnerId}> **Slow on the Draw** — You may interrupt to perform an attack targeting **Greedo** before this attack resolves. Use this ability?`, components: [sotdRow], allowedMentions: { users: [defOwnerId] } }));
  }

  // Illicit Arms (Bib Fortuna): MOVED to proceedAfterRerolls (step-4
  // attacker modifier) per alexanbv 2026-05-09 — was incorrectly firing at
  // attack-declare. The +1 Hit applies as a step-4 modifier alongside
  // Pulse Cannon / Negotiate / Call the Shots / Heavy Repeater.

  // Force Exhaustion (The Child / Clan of Two): when attack targets The Child or a figure with Clan of Two,
  // The Child's owner may choose to incapacitate The Child to remove 1 attack die and Weaken the attacker.
  {
    const _feDefMsgId = target.isNpc ? null : (findDcMessageIdForFigure?.(game.gameId, defenderPlayerNum, target.figureKey) || null);
    const _feDefUpgrades = _feDefMsgId ? (game.p1DcAttachments?.[_feDefMsgId] || game.p2DcAttachments?.[_feDefMsgId] || []) : [];
    const _feDecision = canOfferForceExhaustion(game, defenderPlayerNum, targetDcName, _feDefUpgrades);
    if (_feDecision.eligible) {
      const defOwnerId = getPlayerId(game, defenderPlayerNum);
      setPendingForceExhaustion(game, {
        gameId: game.gameId,
        defenderPlayerNum,
        attackerPlayerNum,
        attackerFigureKey,
        childFigureKey: _feDecision.childFigureKey,
        combatThreadId: thread.id,
      });
      const feRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`force_exhaustion_yes_${game.gameId}`).setLabel('Use Force Exhaustion (Incapacitate The Child)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`force_exhaustion_no_${game.gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
      );
      await thread.send(sanitizeMentions({ content: `<@${defOwnerId}> **Force Exhaustion** — The Child may become **Incapacitated** to remove 1 attack die and apply **Weakened** to the attacker. Use this ability?`, components: [feRow], allowedMentions: { users: [defOwnerId] } }));
    }
  }

  // Per-figure 2026-05-09: clear next-attack bonuses keyed by attackerFigureKey.
  if (nextSurge.length) delete game.nextAttackBonusSurgeAbilities?.[attackerFigureKey];
  if (nextPierce) delete game.nextAttackBonusPierce?.[attackerFigureKey];
  if (nextBonusAcc) delete game.nextAttackBonusAccuracy?.[attackerFigureKey];
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

  // On-declare per-player window. Per destruct 2026-05-08: each player
  // gets a single combined window for cards-from-hand AND tokens; the
  // player picks the order. Token window posts inline with the gate
  // (sendOnDeclareTokenWindow); CCs are played from each player's hand
  // channel as usual; the gate Ready button advances to the next role.
  await sendCombatGate(thread, game, game.pendingCombat, 'on_declare', ctx);
  await sendOnDeclareTokenWindow(thread, game, game.pendingCombat, 'attacker', ctx);
  saveGames(game.gameId);
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client
 */
export async function handleCombatReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const gameId = parseCustomId(interaction.customId, 'combat_ready_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.followUp({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Session 11 retirement: combat.acked replaces legacy p1Ready/p2Ready.
  // The acked map is per-step — it's reset whenever currentStep advances.
  // currentStep itself is the authoritative gate; acked tracks who has
  // confirmed at the current step.
  combat.acked = combat.acked || {};
  // In test games, human (P1) can click for both sides; first click = P1, second = P2
  let playerNum = clickerIsP1 ? 1 : 2;
  if (game.isTestGame && clickerIsP1) {
    playerNum = combat.acked[1] ? 2 : 1;
  }
  combat.acked[playerNum] = true;
  // Advance currentStep based on acked state. Attacker ready → defender's
  // pre-roll window opens; both ready → roll happens. Sub-steps (step3-* /
  // step4-* / step5 / zillo / step6 / step7 / step8) are advanced in
  // their respective handlers (audited by currentstep-transition-audit.test.js).
  const attackerIsReady = Boolean(combat.acked[combat.attackerPlayerNum]);
  const defenderPn = combat.attackerPlayerNum === 1 ? 2 : 1;
  const defenderIsReady = Boolean(combat.acked[defenderPn]);
  if (attackerIsReady && defenderIsReady) {
    combat.currentStep = 'roll';
    // Step transition: reset per-step ack map for the next gate.
    combat.acked = {};
  } else if (attackerIsReady) {
    combat.currentStep = 'step1+2-defender';
  }
  if (!interaction.message?.channel) throw new Error(`handleCombatReady: interaction.message.channel is null (gameId=${gameId}, generalId=${game.generalId})`);
  const _readyName = getPlayerDisplayName(game, playerNum, interaction.client);
  await interaction.message.channel.send(`**${_readyName}** is ready to roll combat.`);
  if (combat.currentStep === 'step1+2-attacker' || combat.currentStep === 'step1+2-defender') {
    // Attacker just acked → defender's window is now active. Post the
    // defender's on-declare token window so cards + tokens land in one
    // combined window for the defender too (destruct 2026-05-08).
    if (combat.currentStep === 'step1+2-defender' && !game.selfPlay) {
      const _ondThread = await fetchCombatThread(interaction.client, combat.combatThreadId);
      if (_ondThread) {
        await sendOnDeclareTokenWindow(_ondThread, game, combat, 'defender', ctx);
      }
    }
    saveGames(game.gameId);
    return;
  }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) throw new Error(`handleCombatReady: combat thread is null (threadId=${combat.combatThreadId}, gameId=${gameId})`);
  try {
    const preMsg = await thread.messages.fetch(combat.combatPreMsgId);
    await preMsg.edit({ components: [] }).catch(discordCatch);
  } catch {}
  // Per destruct 2026-05-08: tokens are spent inside the on_declare
  // per-player window now (sendOnDeclareTokenWindow), so by the time
  // both players have ack'd this gate the token phase is already done.
  // Just post the Roll Combat Dice button — auto-roll runs from there.
  combat.onDeclareTokenContext = false;
  combat.tokenPhase = null;
  await postRollDiceButton(thread, game, combat, ctx);
  saveGames(game.gameId);
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
  const getInnateRerolls = ctx.getInnateRerolls || (() => ({ attackReroll: 0, defenseReroll: 0 }));
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
  // Uses the shared hasEffectiveLineOfSight helper so the LOS treatment
  // matches buildAndSendAttackTargets exactly (closed doors / shields /
  // smoke / broken walls / Marksman / Priority Target / Massive /
  // Clawdite Scout / multi-cell footprints).
  if (combat.attackerFigureKey && combat.target?.figureKey) {
    const _avAtkPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    if (!_avAtkPos) {
      await thread.send('🚫 **Attack aborted** — attacker is no longer on the board.').catch(discordCatch);
      resolvePendingCombat(game);
      saveGames(game.gameId);
      return;
    }
    if (game.selectedMap?.id) {
      const { hasEffectiveLineOfSight } = await import('../game/effective-los.js');
      const _avLos = hasEffectiveLineOfSight(
        game,
        attackerPlayerNum, combat.attackerFigureKey,
        defenderPlayerNum, combat.target.figureKey,
        ctx,
        { marksmanActive: !!game.nextAttackIgnoreFigureLOS?.[combat.attackerMsgId] },
      );
      if (!_avLos) {
        await thread.send('🚫 **Attack aborted** — attacker no longer has line of sight to the target.').catch(discordCatch);
        resolvePendingCombat(game);
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
    const baseDice = combat.attackInfo?.dice || [];
    const bonusDice = combat.attackBonusDice || 0;
    const bonusColors = combat.attackBonusDiceColors || [];
    const primaryColor = baseDice[0] || 'red';
    let dice = [...baseDice];
    for (let i = 0; i < bonusDice; i++) dice.push(bonusColors[i] ?? primaryColor);
    const removeMax = combat.attackPoolRemoveMax || 0;
    if (removeMax > 0) dice = dice.slice(0, Math.max(0, dice.length - removeMax));
    const keepMax = combat.attackPoolKeepMax;
    if (typeof keepMax === 'number' && keepMax > 0 && dice.length > keepMax) dice = dice.slice(0, keepMax);
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
    const baseDice = combat.attackInfo?.dice || [];
    const bonusDice = combat.attackBonusDice || 0;
    const bonusColors = combat.attackBonusDiceColors || [];
    const primaryColor = baseDice[0] || 'red';
    let dice = [...baseDice];
    for (let i = 0; i < bonusDice; i++) dice.push(bonusColors[i] ?? primaryColor);
    const removeMax = combat.attackPoolRemoveMax || 0;
    if (removeMax > 0) dice = dice.slice(0, Math.max(0, dice.length - removeMax));
    const keepMax = combat.attackPoolKeepMax;
    if (typeof keepMax === 'number' && keepMax > 0 && dice.length > keepMax) dice = dice.slice(0, keepMax);
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

    // There Is No Try (TINT): if thereIsNoTryPlayerNum is set for the defender, and the defending DC has REBEL + FORCE USER keywords
    if (game.thereIsNoTryPlayerNum === defenderPlayerNum && !combat.tintResolved) {
      const _tintDefDcName = dcNameFromFigureKey(combat.target?.figureKey || '');
      const _tintStats = ctx.getDcStats?.(_tintDefDcName) || {};
      const _tintAllKws = [...(_tintStats.keywords || []), ...(_tintStats.traits || [])].map((k) => String(k).toUpperCase());
      if (_tintAllKws.includes('REBEL') && _tintAllKws.includes('FORCE USER')) {
        setPendingThereIsNoTry(game, { defenderPlayerNum });
        const _tintDice = combat.defenseDiceResults || [];
        const _tintBtns = _tintDice.map((d, i) =>
          new ButtonBuilder()
            .setCustomId(`there_is_no_try_die_${gameId}_${i}`)
            .setLabel(`Die #${i + 1}: ${d.block}B/${d.evade}E${d.dodge ? '/Dodge' : ''}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        _tintBtns.push(new ButtonBuilder().setCustomId(`there_is_no_try_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const _tintRows = chunkButtonsToRows(_tintBtns);
        await thread.send({ content: `**There Is No Try** — <@${game[`player${defenderPlayerNum}Id`] ?? ''}> choose a defense die to set to any face:`, components: _tintRows }).catch(discordCatch);
        saveGames(game.gameId);
        return; // Wait for TINT response before entering reroll window
      }
    }

    // --- Enter reroll window ---
    const atkInnate = getInnateRerolls(combat.attackerDcName);
    const defenderDcName = dcNameFromFigureKey(combat.target?.figureKey ?? '');
    const defInnate = getInnateRerolls(defenderDcName);

    // Ability-based rerolls from specialAbilityIds
    const getDcEff = ctx.getDcEffects || (() => ({}));
    const dcHS = ctx.dcHealthState;
    const atkEffR = getDcEff()[combat.attackerDcName] || getDcEff()[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const defEffR = getDcEff()[defenderDcName] || getDcEff()[(defenderDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const atkSIds = atkEffR?.specialAbilityIds || [];
    const defSIds = defEffR?.specialAbilityIds || [];
    let atkSpecialReroll = 0;
    let defSpecialReroll = 0;
    // Targeting Computer family (HK Assassin Elite, IG-11, Probe Droid Elite,
    // Sentry Droid Elite/Reg, AT-ST, Dark Trooper Mk III ATC): +1 atk reroll
    if (hasTargetingComputerAbility(atkSIds)) atkSpecialReroll = applyTargetingComputerReroll(atkSpecialReroll);
    // Overpower (Royal Guard Champion): +1 atk reroll restricted to RED die when
    // attacking, +1 def reroll restricted to BLACK die when defending. destruct
    // 2026-05-06: "overpower is restricted to red die when attacking, and black
    // die when defending." The +1 enters the standard rerolls budget but
    // handleCombatReroll's voluntary path enforces color via combat.overpower*
    // flags (one slot of the budget is locked to the matching color).
    if (hasOverpowerAbility(atkSIds)) {
      atkSpecialReroll = applyOverpowerAttackerReroll(atkSpecialReroll);
      combat.overpowerAtkColorLocked = 'red';
      combat.overpowerAtkLockedAvailable = true;
    }
    if (hasOverpowerAbility(defSIds)) {
      defSpecialReroll = applyOverpowerDefenderReroll(defSpecialReroll);
      combat.overpowerDefColorLocked = 'black';
      combat.overpowerDefLockedAvailable = true;
    }
    // Foresight (Darth Vader defending): +1 def reroll
    if (hasForesightAbility(defSIds)) defSpecialReroll = applyDefensiveReroll(defSpecialReroll);
    // Defensive Stance (Diala Passil defending): +1 def reroll
    // (Dodge-conversion clause lives in later phase, see ~line 4400)
    if (hasDefensiveStanceAbility(defSIds)) defSpecialReroll = applyDefensiveReroll(defSpecialReroll);
    // Charge Generators (AT-DP attacking): +1 atk reroll + +1 Hit if < 9 damage suffered
    if (hasChargeGeneratorsAbility(atkSIds)) {
      const atkHpA = dcHS?.get(combat.attackerMsgId) || [];
      const atkFHp = atkHpA[combat.attackerFigureIndex ?? 0];
      const atkDs = atkFHp ? Math.max(0, (atkFHp[1] ?? atkFHp[0] ?? 0) - (atkFHp[0] ?? 0)) : 0;
      if (chargeGeneratorsApplies(atkDs)) {
        const { bonusHits, atkSpecialReroll: newReroll } = applyChargeGeneratorsBonus(combat, atkSpecialReroll);
        combat.bonusHits = bonusHits;
        atkSpecialReroll = newReroll;
      }
    }
    // Inspiring (Luke Skywalker on attacker's team): +1 atk reroll for another friendly within 3 spaces
    {
      const atkFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const mapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const atkPos = atkFigs[combat.attackerFigureKey];
      for (const [fk, pos] of Object.entries(atkFigs)) {
        if (fk === combat.attackerFigureKey) continue;
        const fn = dcNameFromFigureKey(fk);
        const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
        if (!hasInspiringAbility(fe?.specialAbilityIds)) continue;
        if (atkPos && isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkPos).toLowerCase(), INSPIRING_RANGE)) {
          const r = applyInspiringReroll({ atkSpecialReroll });
          atkSpecialReroll = r.atkSpecialReroll;
          await thread.send(`**Inspiring** (${fn}) — friendly within 3 spaces, +1 attack reroll granted.`).catch(discordCatch);
          break;
        }
      }
    }
    // Soresu Form (Kanan Jarrus on defender's team): +1 def reroll for a friendly within 3 spaces
    {
      const defFigs = game.figurePositions?.[defenderPlayerNum] || {};
      const mapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const defPos = combat.target?.coord;
      for (const [fk, pos] of Object.entries(defFigs)) {
        const fn = dcNameFromFigureKey(fk);
        const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
        if (!(fe?.specialAbilityIds || []).includes('soresu_form')) continue;
        if (defPos && isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defPos).toLowerCase(), 3)) {
          defSpecialReroll += 1;
          combat.soresuFormFigKey = fk;
          break;
        }
      }
    }

    // Cower (C-3PO, Imperial Officer Regular): +1 def reroll if adjacent to a friendly figure.
    // CRR p.21 COMPANIONS: "A companion is adjacent to each figure and
    // object in its space" — same-space figures count as adjacent. We
    // therefore include same-space (distance 0) AND map-adjacent
    // (distance 1) cells.
    const cowerIds = ['cower_c3po', 'cower_imperial_officer_reg'];
    if (defSIds.some(id => cowerIds.includes(id))) {
      const defFigsC = game.figurePositions?.[defenderPlayerNum] || {};
      const mapSpC = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const defPosC = combat.target?.coord;
      if (defPosC && mapSpC) {
        const _defPosLower = String(defPosC).toLowerCase();
        const adjToDefC = new Set((mapSpC.adjacency?.[_defPosLower] || []).map(s => String(s).toLowerCase()));
        adjToDefC.add(_defPosLower); // CRR companion-same-space rule
        for (const [fk, pos] of Object.entries(defFigsC)) {
          if (fk === combat.target?.figureKey) continue;
          if (adjToDefC.has(String(pos).toLowerCase())) {
            defSpecialReroll += 1;
            break;
          }
        }
      }
    }

    // Squad Training (Shoretrooper E, Stormtrooper E/R): +1 atk reroll if adjacent friendly TROOPER
    if (hasSquadTrainingAbility(atkSIds)) {
      const stFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const stMap = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const stPos = stFigs[combat.attackerFigureKey];
      if (stPos && stMap) {
        const _stPosLower = String(stPos).toLowerCase();
        const stAdj = new Set((stMap.adjacency?.[_stPosLower] || []).map(s => String(s).toLowerCase()));
        // CRR p.21 COMPANIONS: same-space figures count as adjacent.
        stAdj.add(_stPosLower);
        for (const [fk, pos] of Object.entries(stFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          if (!stAdj.has(String(pos).toLowerCase())) continue;
          const fn = dcNameFromFigureKey(fk);
          const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
          if ((fe?.keywords || []).some(k => String(k).toUpperCase() === 'TROOPER')) {
            atkSpecialReroll = applySquadTrainingReroll(atkSpecialReroll); break;
          }
        }
      }
    }
    // Coordinated Hunt (Purge Commander Elite): +1 atk reroll for self or HUNTER with PC in LOS. Limit 1 per attack.
    // Self-branch (attacker IS the PC) fires regardless — the figure uses its own ability.
    // Other-friendly-with-PC-in-LOS branch is friendly-gated; skip during Lure/False Orders
    // (destruct 2026-05-07: no figures friendly during this attack).
    {
      let _chApplied = false;
      if (atkSIds.includes('coordinated_hunt_purge_commander')) {
        atkSpecialReroll += 1; _chApplied = true;
      }
      if (!_chApplied && !combat.noFriendliesActive) {
        const atkKwsCH = (atkEffR?.keywords || []).map(k => String(k).toUpperCase());
        if (atkKwsCH.includes('HUNTER')) {
          const chFigs = game.figurePositions?.[attackerPlayerNum] || {};
          const chMapSp = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
          const chAtkPos = chFigs[combat.attackerFigureKey];
          if (chAtkPos && chMapSp && ctx.hasLineOfSightByCoord) {
            for (const [fk, pos] of Object.entries(chFigs)) {
              if (fk === combat.attackerFigureKey) continue;
              const fn = dcNameFromFigureKey(fk);
              const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
              if (!(fe?.specialAbilityIds || []).includes('coordinated_hunt_purge_commander')) continue;
              if (pos && ctx.hasLineOfSightByCoord(game, String(pos).toLowerCase(), String(chAtkPos).toLowerCase(), chMapSp, ctx.getFigureSize)) {
                atkSpecialReroll += 1; _chApplied = true; break;
              }
            }
          }
        }
      }
    }
    // Light It Up (Rebel Pathfinder Elite): +1 atk reroll if target had no LOS to attacker at activation start
    if (atkSIds.includes('light_it_up_rebel_pathfinder')) {
      const liuStartPos = game.activationStartPositions?.[combat.attackerFigureKey];
      const liuMapSp = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
      if (liuStartPos && combat.target?.coord && liuMapSp && ctx.hasLineOfSightByCoord) {
        const targetHadLos = ctx.hasLineOfSightByCoord(game, String(combat.target.coord).toLowerCase(), String(liuStartPos).toLowerCase(), liuMapSp, ctx.getFigureSize);
        if (!targetHadLos) atkSpecialReroll += 1;
      }
    }

    // Sling Barrage (Ewok Warrior Elite): +1 atk reroll per OTHER figure in the same group with LOS to defender.
    // "Group" = same DC name + same deployment-group index (figure-key prefix `${dcName}-${dgIndex}-`).
    if (game.pendingSlingBarrage?.[combat.attackerMsgId]) {
      delete game.pendingSlingBarrage[combat.attackerMsgId];
      const sbMapSp = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
      const sbDefCoord = combat.target?.coord ? String(combat.target.coord).toLowerCase() : null;
      if (sbMapSp && sbDefCoord && ctx.hasLineOfSightByCoord) {
        const parts = String(combat.attackerFigureKey).split('-');
        const sbGroupPrefix = parts.length >= 3 ? `${parts.slice(0, -1).join('-')}-` : null;
        if (sbGroupPrefix) {
          const sbFigs = game.figurePositions?.[attackerPlayerNum] || {};
          let sbBonus = 0;
          for (const [fk, pos] of Object.entries(sbFigs)) {
            if (fk === combat.attackerFigureKey) continue;
            if (!fk.startsWith(sbGroupPrefix)) continue;
            if (!pos) continue;
            if (ctx.hasLineOfSightByCoord(game, String(pos).toLowerCase(), sbDefCoord, sbMapSp, ctx.getFigureSize)) sbBonus += 1;
          }
          if (sbBonus > 0) {
            atkSpecialReroll += sbBonus;
            await thread.send(`**Sling Barrage** — ${sbBonus} other group-mate${sbBonus === 1 ? '' : 's'} with LOS to defender: +${sbBonus} attack reroll${sbBonus === 1 ? '' : 's'}.`).catch(discordCatch);
          }
        }
      }
    }

    // Build forced reroll queue for Batch 2B abilities
    combat.forcedRerollQueue = [];
    // Versatile Weaponry (HK Assassin Elite): attacker forces 1 def die reroll
    if (atkSIds.includes('versatile_weaponry_hk_elite')) {
      combat.forcedRerollQueue.push({ controlPlayer: attackerPlayerNum, pool: 'defense', remaining: 1, source: 'Versatile Weaponry' });
    }
    // Shared Calculations (Zuckuss): attacker forces 1 def die reroll if friendly DROID within 3 + LOS to target
    if (atkSIds.includes('shared_calculations_zuckuss') && combat.target?.coord) {
      const scFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const scMapSp = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
      if (scMapSp) {
        for (const [fk, pos] of Object.entries(scFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          const fn = dcNameFromFigureKey(fk);
          const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
          if (!(fe?.keywords || []).some(k => String(k).toUpperCase() === 'DROID')) continue;
          if (!pos) continue;
          if (!isWithinSpaces(scMapSp, String(pos).toLowerCase(), String(combat.target.coord).toLowerCase(), 3)) continue;
          if (ctx.hasLineOfSightByCoord && ctx.hasLineOfSightByCoord(game, String(pos).toLowerCase(), String(combat.target.coord).toLowerCase(), scMapSp, ctx.getFigureSize)) {
            combat.forcedRerollQueue.push({ controlPlayer: attackerPlayerNum, pool: 'defense', remaining: 1, source: 'Shared Calculations' });
            break;
          }
        }
      }
    }
    // Raider (Weequay Elite/Reg): attacker chooses any 1 die, force reroll
    if (hasRaiderAbility(atkSIds)) {
      combat.forcedRerollQueue.push(buildRaiderForcedReroll(attackerPlayerNum));
    }
    // Precision (Grand Inquisitor): if attacking/defending against adjacent, choose any 1 die to force reroll
    if (atkSIds.includes('precision_grand_inquisitor') || defSIds.includes('precision_grand_inquisitor')) {
      const precMapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const precAtkPos = (game.figurePositions?.[attackerPlayerNum] || {})[combat.attackerFigureKey];
      const precDefPos = combat.target?.coord;
      if (precAtkPos && precDefPos && precMapSp) {
        const precAdj = (precMapSp.adjacency?.[String(precAtkPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
        if (precAdj.includes(String(precDefPos).toLowerCase())) {
          const precPlayer = atkSIds.includes('precision_grand_inquisitor') ? attackerPlayerNum : defenderPlayerNum;
          combat.forcedRerollQueue.push({ controlPlayer: precPlayer, pool: 'any', remaining: 1, source: 'Precision' });
        }
      }
    }
    // Fyrnock Style (Tress Hacnua): while attacking or defending, choose 1 attack die to force reroll
    if (atkSIds.includes('fyrnock_style_tress') || defSIds.includes('fyrnock_style_tress')) {
      const fsPlayer = atkSIds.includes('fyrnock_style_tress') ? attackerPlayerNum : defenderPlayerNum;
      combat.forcedRerollQueue.push({ controlPlayer: fsPlayer, pool: 'attack', remaining: 1, source: 'Fyrnock Style' });
    }
    // Survival is Strength (Armorer): if defender spent a Block (PT) during this attack
    // and an Armorer with the ability is within 3 spaces of the defender, that Armorer's
    // player may force 1 attack-die reroll. Per CRR p.10 step 3, all rerolls fire here
    // (not at modifier or post-modifier stage). Once-per-round tracked on the Armorer's
    // figureKey: marked-used only when the player actually rerolls (skip preserves the
    // ability). The defenderSpentBlock trigger is set during the pre-roll PT phase.
    if (combat.defenderSpentBlock && combat.target?.figureKey) {
      const _sisFriendlyFigs = game.figurePositions?.[defenderPlayerNum] || {};
      const _sisDefCoord = _sisFriendlyFigs[combat.target.figureKey];
      const _sisMapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      if (_sisDefCoord && _sisMapSp) {
        for (const [_sisFk, _sisPos] of Object.entries(_sisFriendlyFigs)) {
          const _sisDcName = dcNameFromFigureKey(_sisFk);
          const _sisEff = getDcEff()[_sisDcName] || getDcEff()[_sisDcName?.replace(/\s*\[.*\]\s*$/, '')];
          if (!(_sisEff?.specialAbilityIds || []).includes('survival_is_strength_armorer')) continue;
          if (game.roundFigureAbilityUsed?.[`${_sisFk}_survival_is_strength`]) continue;
          if (!_sisPos) continue;
          if (isWithinSpaces(_sisMapSp, String(_sisPos).toLowerCase(), String(_sisDefCoord).toLowerCase(), 3)) {
            combat.forcedRerollQueue.push({
              controlPlayer: defenderPlayerNum,
              pool: 'attack',
              remaining: 1,
              source: 'Survival is Strength',
              armorerFigKey: _sisFk,
            });
            break; // first eligible Armorer triggers; once-per-round per Armorer
          }
        }
      }
    }

    // Demoralizing Monologue moved to forced-reroll queue (per CRR: ATTACKER
    // chooses the die; controller forces reroll). Old defender-reroll-grant
    // path removed; the queue entry is added by the abilities.js dispatcher
    // when the card is played, and resolves through the standard forced-
    // reroll handler with a post-reveal-hand prompt.
    // Power Converter (Saska): now handled as combat-time prompt (see PC check after reroll counts calc)
    // Trusted Ally (Skirmish Upgrade): if a friendly DROID within 3 has this attachment (not exhausted), +1 atk reroll
    {
      const _taFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const _taMapSp = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const _taAtkPos = _taFigs[combat.attackerFigureKey];
      if (_taAtkPos && _taMapSp) {
        for (const [fk, pos] of Object.entries(_taFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          const fn = dcNameFromFigureKey(fk);
          if (!isWithinSpaces(_taMapSp, String(pos).toLowerCase(), String(_taAtkPos).toLowerCase(), 3)) continue;
          // Check if this figure's DC has Trusted Ally attachment and it's not exhausted
          const _taMsgIds = getDcMessageIds(game, attackerPlayerNum) || [];
          const _taDcList = getDcList(game, attackerPlayerNum) || [];
          for (let i = 0; i < _taDcList.length; i++) {
            if (_taDcList[i]?.dcName !== fn) continue;
            const _taMid = _taMsgIds[i];
            const _taAtts = game.p1DcAttachments?.[_taMid] || game.p2DcAttachments?.[_taMid] || [];
            if (!cardNameIncludes(_taAtts, 'Trusted Ally')) break;
            if (cardNameIncludes(game.exhaustedSkirmishUpgrades?.[_taMid], 'Trusted Ally')) break;
            // Auto-exhaust and grant reroll
            game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
            game.exhaustedSkirmishUpgrades[_taMid] = [...(game.exhaustedSkirmishUpgrades[_taMid] || []), 'Trusted Ally'];
            atkSpecialReroll += 1;
            await thread.send(`**Trusted Ally** (${fn}) — Exhausted: friendly within 3 spaces, +1 attack reroll granted.`).catch(discordCatch);
            break;
          }
          if (atkSpecialReroll > 0) break; // only one Trusted Ally bonus per attack
        }
      }
    }
    const selfAugReroll = game.selfAugmentationMsgId?.[combat.attackerMsgId] ? 1 : 0;
    const atkRerolls = (combat.rerollOneAttackDie || 0) + (game.roundAttackRerollDice?.[attackerPlayerNum] || 0) + atkInnate.attackReroll + atkSpecialReroll + selfAugReroll;
    const defRerolls = (combat.defenderRerollDiceMax || 0) + defInnate.defenseReroll + defSpecialReroll;
    // Build pre-reroll prompt queue early (before any interrupts that might save+return)
    combat.pendingPreRerolls = [];
    if (atkSIds.includes('twin_sabers_ahsoka')) {
      combat.pendingPreRerolls.push({ type: 'twin_sabers', playerNum: attackerPlayerNum });
    }
    if (atkSIds.includes('resourceful_lando') || defSIds.includes('resourceful_lando')) {
      const _resPlayer = atkSIds.includes('resourceful_lando') ? attackerPlayerNum : defenderPlayerNum;
      const _resSIds = atkSIds.includes('resourceful_lando') ? atkSIds : defSIds;
      if (_resSIds.includes('shrewd_scoundrel_lando')) {
        combat.pendingPreRerolls.push({ type: 'shrewd_scoundrel', playerNum: _resPlayer });
      }
      if (_resSIds.includes('gambit_lando')) combat.gambitActive = true;
      combat.pendingPreRerolls.push({ type: 'resourceful', playerNum: _resPlayer });
    }
    if (atkSIds.includes('trained_rancor')) {
      combat.pendingPreRerolls.push({ type: 'trained', playerNum: attackerPlayerNum });
    }
    // Power Converter (Saska Teft): if attacker has Device token and a friendly DC has power_converter_saska, ping hand channel
    if (!game.powerConverterUsedThisRound && !combat.powerConverterChecked
        && (game.deviceTokens?.[combat.attackerFigureKey] || 0) > 0) {
      // Scan attacker's DCs for power_converter_saska
      const _pcDcList = getDcList(game, attackerPlayerNum) || [];
      let _pcFound = false;
      for (let i = 0; i < _pcDcList.length; i++) {
        const _pcDcName = _pcDcList[i]?.dcName;
        const _pcEff = getDcEff()[_pcDcName] || getDcEff()[(_pcDcName || '').replace(/\s*\[.*\]\s*$/, '')];
        if ((_pcEff?.specialAbilityIds || []).includes('power_converter_saska')) { _pcFound = true; break; }
      }
      if (_pcFound) {
        // Store reroll counts so the handler can resume
        combat.pcPendingAtkRerolls = atkRerolls;
        combat.pcPendingDefRerolls = defRerolls;
        combat.powerConverterChecked = true;
        setPendingPowerConverter(game, { gameId });
        // Send prompt to attacker's hand channel
        const _pcHandId = attackerPlayerNum === 1 ? game.p1HandId : game.p2HandId;
        if (_pcHandId) {
          const _pcHand = await fetchGameChannel(interaction.client, _pcHandId);
          if (_pcHand) {
            const _pcRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`power_converter_approve_${gameId}`).setLabel('Use Power Converter').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`power_converter_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
            );
            await _pcHand.send({ content: `⚡ **Power Converter** — **${combat.attackerDcName}** has a Device token. Reroll 1 attack die (may swap die color first)?\n<@${game[`player${attackerPlayerNum}Id`] ?? ''}>`, components: [_pcRow] }).catch(discordCatch);
          }
        }
        saveGames(game.gameId);
        return;
      }
    }
    // Veteran Instincts defense prompt REMOVED 2026-05-09: card is a
    // one-time token distributor, not a per-attack/defense bonus
    // opportunity. Tokens are granted on play; the legacy "active
    // during attacks/defenses" flag was an over-implementation.
    // [Doubt] SU: defender may deplete to force 1 attack die reroll
    if (!combat.doubtRerollChecked) {
      const _dbtDcList = getDcList(game, defenderPlayerNum) || [];
      const _dbtMsgIds = getDcMessageIds(game, defenderPlayerNum) || [];
      for (let i = 0; i < _dbtDcList.length; i++) {
        const _dbtDc = _dbtDcList[i];
        if ((_dbtDc?.dcName || _dbtDc) !== '[Doubt]') continue;
        const _dbtMid = _dbtMsgIds[i];
        if (!_dbtMid) continue;
        const _dbtDepleted = (game.p1DepletedDcMessageIds || []).includes(_dbtMid) || (game.p2DepletedDcMessageIds || []).includes(_dbtMid);
        if (_dbtDepleted) continue;
        // Found usable Doubt — prompt defender
        combat.doubtRerollChecked = true;
        combat.doubtPendingAtkRerolls = atkRerolls;
        combat.doubtPendingDefRerolls = defRerolls;
        combat.doubtMsgId = _dbtMid;
        const defId = game[`player${defenderPlayerNum}Id`] || '';
        const _dbtRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`doubt_reroll_use_${gameId}`).setLabel('Use Doubt (Deplete → force 1 ATK reroll)').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`doubt_reroll_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**[Doubt]** — <@${defId}> Deplete to force your opponent to reroll 1 attack die?`, components: [_dbtRow] }).catch(discordCatch);
        saveGames(game.gameId);
        return;
      }
    }
    combat.attackerRerollsRemaining = atkRerolls;
    combat.defenderRerollsRemaining = defRerolls;
    // G12: Track which die indices have been rerolled (each die max once)
    combat.attackerRerolledIndices = [];
    combat.defenderRerolledIndices = [];
    // Combat gate: both players review dice results before reroll window
    await sendCombatGate(thread, game, combat, 'post_roll', ctx);
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
async function maybePromptRerollYn(thread, game, combat, phase) {
  const gameId = game.gameId;
  if (phase === 'attacker') {
    if (combat.rerollYnAskedAttacker) return false;
    if ((combat.pendingPreRerolls || []).length > 0) return false; // pre-roll abilities use their own prompts
    const remaining = combat.attackerRerollsRemaining || 0;
    if (remaining <= 0) return false;
    combat.rerollYnAskedAttacker = true;
    const atkPn = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1;
    const atkOwnerId = atkPn === 1 ? game.player1Id : game.player2Id;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_atk_yes`)
        .setLabel(`Yes — pick dice (${remaining} reroll${remaining !== 1 ? 's' : ''})`)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_atk_no`)
        .setLabel('No — skip')
        .setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: `<@${atkOwnerId}> — **Reroll attack dice?**`,
      components: [row],
      allowedMentions: { users: [atkOwnerId] },
    }).catch(discordCatch);
    return true;
  }
  if (phase === 'defender') {
    if (combat.rerollYnAskedDefender) return false;
    const remaining = combat.defenderRerollsRemaining || 0;
    const ctAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    if (remaining <= 0 && !ctAvailable) return false;
    combat.rerollYnAskedDefender = true;
    const defPn = opponentPlayerNum(combat.attackerPlayerNum ?? 1);
    const defOwnerId = defPn === 1 ? game.player1Id : game.player2Id;
    const parts = [];
    if (remaining > 0) parts.push(`${remaining} reroll${remaining !== 1 ? 's' : ''}`);
    if (ctAvailable) parts.push('Cross Training');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_def_yes`)
        .setLabel(`Yes — pick (${parts.join(' + ')})`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_def_no`)
        .setLabel('No — skip')
        .setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: `<@${defOwnerId}> — **Reroll defense dice?**`,
      components: [row],
      allowedMentions: { users: [defOwnerId] },
    }).catch(discordCatch);
    return true;
  }
  return false;
}

export async function sendRerollUI(thread, game, combat, phase) {
  const gameId = game.gameId;
  // Q5a: post a Y/N prompt before the dice picker for attacker/defender
  // (forced rerolls are not optional and skip the gate).
  if (phase === 'attacker' || phase === 'defender') {
    if (await maybePromptRerollYn(thread, game, combat, phase)) return;
  }
  // Helper: advance after a controlled (formerly "forced") reroll
  // entry resolves. Per destruct 2026-05-08, controlled entries belong
  // to the side whose controlPlayer matches their owning figure. If
  // more entries remain on the active side, keep the window open. When
  // none remain on this side, hand off:
  //   - active side = attacker → defender reroll window opens
  //                                (own + def-controlled cross-side)
  //   - active side = defender → step 4
  // Advance from an empty bucket (caller already verified nothing left).
  // Per alexanbv 2026-05-11: attacker bucket → defender bucket → step 4.
  // The `forced` re-entry is retired; controlled abilities now live in
  // the side's main bucket.
  const _advanceFromForced = async () => {
    const atkPN = combat.attackerPlayerNum || 1;
    const defPN = opponentPlayerNum(atkPN);
    const activeSidePN = combat.controlledRerollSide ?? atkPN;
    if (activeSidePN === atkPN) {
      await _enterDefenderRerollPhase(thread, game, combat, /*ctx*/ undefined, defPN);
      return;
    }
    combat.rerollPhase = null;
    combat.controlledRerollSide = null;
  };
  // Per alexanbv 2026-05-11: rerolls are bucketed by which player's
  // ABILITY triggered them (attacker-owned vs defender-owned), not by
  // whose dice get rerolled. Within a bucket, the owning player picks
  // any order (Versatile Weaponry first, then Targeting Computer, etc.)
  // and every reroll is individually skippable. The legacy `forced`
  // sub-phase between attacker and defender windows is gone; controlled
  // cross-side rerolls (e.g. HK forcing a DEF reroll, Tress while
  // defending forcing an ATK reroll) now live inside the owner's
  // attacker/defender window as additional buttons.
  //
  // Sub-picker mode: when the user clicks a "Use X" button for a
  // controlled ability, combat.controlledRerollActiveIdx is set to
  // its forcedRerollQueue index and we re-render here showing only
  // pool dice for that entry + Cancel. Picking a die resolves it
  // (drops the entry) and returns to the main bucket UI.
  if ((phase === 'attacker' || phase === 'defender') && combat.controlledRerollActiveIdx != null) {
    const _ctrlEntry = (combat.forcedRerollQueue || [])[combat.controlledRerollActiveIdx];
    if (_ctrlEntry && (_ctrlEntry.remaining ?? 0) > 0) {
      const _ctrlButtons = [];
      const _ctrlAtkRr = combat.attackerRerolledIndices || [];
      const _ctrlDefRr = combat.defenderRerolledIndices || [];
      if (_ctrlEntry.pool === 'attack' || _ctrlEntry.pool === 'any') {
        const aDice = combat.attackDiceResults || [];
        for (let i = 0; i < aDice.length; i++) {
          if (_ctrlAtkRr.includes(i)) continue;
          _ctrlButtons.push(
            new ButtonBuilder()
              .setCustomId(`combat_reroll_${gameId}_atk_${i}`)
              .setLabel(`Force ATK ${formatAttackDie(aDice[i], i)}`)
              .setStyle(ButtonStyle.Danger),
          );
        }
      }
      if (_ctrlEntry.pool === 'defense' || _ctrlEntry.pool === 'any') {
        const dDice = combat.defenseDiceResults || [];
        for (let i = 0; i < dDice.length; i++) {
          if (_ctrlDefRr.includes(i)) continue;
          _ctrlButtons.push(
            new ButtonBuilder()
              .setCustomId(`combat_reroll_${gameId}_def_${i}`)
              .setLabel(`Force DEF ${formatDefenseDie(dDice[i], i)}`)
              .setStyle(ButtonStyle.Danger),
          );
        }
      }
      const _ctrlTrailing = [
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_cancelctrl`)
          .setLabel('Cancel (return to reroll menu)')
          .setStyle(ButtonStyle.Secondary),
      ];
      const _ctrlPoolLabel = _ctrlEntry.pool === 'any' ? '' : `${_ctrlEntry.pool} `;
      await thread.send({
        content: `**${_ctrlEntry.source}** — Pick a ${_ctrlPoolLabel}die to reroll (${_ctrlEntry.remaining} remaining), or Cancel to return.`,
        components: buildRerollRows(_ctrlButtons, _ctrlTrailing),
      });
      return;
    }
    // Stale flag — drop and fall through to main UI.
    combat.controlledRerollActiveIdx = null;
  }

  if (phase === 'attacker') {
    // Pre-reroll prompts: show before any reroll dice are offered
    if (!combat.preRerollsProcessed && (combat.pendingPreRerolls || []).length > 0) {
      const pr = combat.pendingPreRerolls[0];
      const playerId = game[`player${pr.playerNum}Id`] ?? '';
      if (pr.type === 'twin_sabers') {
        const atkCount = (combat.attackDiceResults || []).length;
        const defCount = (combat.defenseDiceResults || []).length;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_atk`).setLabel(`Reroll all ${atkCount} ATK dice`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_def`).setLabel(`Force reroll all ${defCount} DEF dice`).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Twin Sabers** — <@${playerId}> choose:`, components: [row] });
        return;
      }
      if (pr.type === 'shrewd_scoundrel') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_0`).setLabel('Guess 0 Damage').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_1`).setLabel('Guess 1 Damage').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_2`).setLabel('Guess 2 Damage').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip (no guess)').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Shrewd Scoundrel** — <@${playerId}> guess the number of Hit results after rerolls (0-2):`, components: [row] });
        return;
      }
      if (pr.type === 'resourceful') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_atk`).setLabel('Reroll 1 ATK die').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_def`).setLabel('Reroll 1 DEF die').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Resourceful** — <@${playerId}> choose:`, components: [row] });
        return;
      }
      if (pr.type === 'trained') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_yes`).setLabel('Suffer 1 Strain, +1 ATK reroll').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_no`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Trained** — <@${playerId}> suffer 1 Strain to reroll 1 attack die?`, components: [row] });
        return;
      }
      // Unknown type — skip it
      combat.pendingPreRerolls.shift();
    }
    const remaining = combat.attackerRerollsRemaining || 0;
    const atkPN = combat.attackerPlayerNum || 1;
    const _atkCtrl = (combat.forcedRerollQueue || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.controlPlayer === atkPN && (e.remaining ?? 0) > 0);
    if (remaining <= 0 && _atkCtrl.length === 0) {
      await _advanceFromForced();
      return;
    }
    const dice = combat.attackDiceResults || [];
    const alreadyRerolled = combat.attackerRerolledIndices || [];
    const dieButtons = [];
    if (remaining > 0) {
      for (let i = 0; i < dice.length; i++) {
        if (alreadyRerolled.includes(i)) continue; // G12: each die rerolled max once
        dieButtons.push(
          new ButtonBuilder()
            .setCustomId(`combat_reroll_${gameId}_atk_${i}`)
            .setLabel(`Reroll ${formatAttackDie(dice[i], i)}`)
            .setStyle(ButtonStyle.Secondary)
        );
      }
    }
    // Attacker-owned controlled abilities (Versatile Weaponry, Shared
    // Calculations, Precision, Fyrnock Style while attacking, Imperial
    // Raider, etc.) appear as additional buttons. Each is voluntary
    // and the attacker picks any order; clicking opens the pool die
    // sub-picker via combat.controlledRerollActiveIdx.
    for (const { e, i } of _atkCtrl) {
      const _poolHint = e.pool === 'any' ? '' : ` (${e.pool})`;
      dieButtons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_ctrl_${i}`)
          .setLabel(`Use ${e.source}${_poolHint}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    const trailing = [
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_atk_done`)
        .setLabel('Done (skip remaining)')
        .setStyle(ButtonStyle.Primary),
    ];
    const _atkParts = [];
    if (remaining > 0) _atkParts.push(`${remaining} voluntary reroll${remaining > 1 ? 's' : ''}`);
    if (_atkCtrl.length > 0) _atkParts.push(`${_atkCtrl.length} ability button${_atkCtrl.length > 1 ? 's' : ''}`);
    await thread.send({
      content: `**Reroll Window (Attacker)** — ${_atkParts.join(' + ')}. Pick any in any order, or Done.`,
      components: buildRerollRows(dieButtons, trailing),
    });
  } else {
    const remaining = combat.defenderRerollsRemaining || 0;
    const ctAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    const defPN = opponentPlayerNum(combat.attackerPlayerNum || 1);
    const _defCtrl = (combat.forcedRerollQueue || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.controlPlayer === defPN && (e.remaining ?? 0) > 0);
    if (remaining <= 0 && !ctAvailable && _defCtrl.length === 0) {
      combat.rerollPhase = null;
      return;
    }
    const dice = combat.defenseDiceResults || [];
    const alreadyRerolled = combat.defenderRerolledIndices || [];
    const dieButtons = [];
    if (remaining > 0) {
      for (let i = 0; i < dice.length; i++) {
        if (alreadyRerolled.includes(i)) continue; // G12: each die rerolled max once
        dieButtons.push(
          new ButtonBuilder()
            .setCustomId(`combat_reroll_${gameId}_def_${i}`)
            .setLabel(`Reroll ${formatDefenseDie(dice[i], i)}`)
            .setStyle(ButtonStyle.Secondary)
        );
      }
    }
    // Defender-owned controlled abilities (Fyrnock Style while defending,
    // Precision when defender is GI, Survival is Strength, Doubt, etc.)
    for (const { e, i } of _defCtrl) {
      const _poolHint = e.pool === 'any' ? '' : ` (${e.pool})`;
      dieButtons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_ctrl_${i}`)
          .setLabel(`Use ${e.source}${_poolHint}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    const trailing = [];
    if (ctAvailable) {
      trailing.push(
        new ButtonBuilder()
          .setCustomId(`ct_reroll_${gameId}_pick`)
          .setLabel('⚔️ Cross Training (Exhaust)')
          .setStyle(ButtonStyle.Primary)
      );
    }
    trailing.push(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_def_done`)
        .setLabel('Done (skip remaining)')
        .setStyle(ButtonStyle.Primary)
    );
    const actionRows = buildRerollRows(dieButtons, trailing);
    const parts = [];
    if (remaining > 0) parts.push(`${remaining} voluntary reroll${remaining > 1 ? 's' : ''}`);
    if (ctAvailable) parts.push('Cross Training');
    if (_defCtrl.length > 0) parts.push(`${_defCtrl.length} ability button${_defCtrl.length > 1 ? 's' : ''}`);
    await thread.send({
      content: `**Reroll Window (Defender)** — ${parts.join(' + ')}. Pick any in any order, or Done.`,
      components: actionRows,
    });
  }
}

/**
 * Handle the explicit "Reroll? Y/N" prompt that fires before the dice
 * picker. Yes → call sendRerollUI, which now sees the YnAsked flag set
 * and falls through to the picker. No → emit a "done" interaction so
 * the existing handleCombatReroll handles advancing the phase.
 */
export async function handleCombatRerollYn(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const match = interaction.customId.match(/^combat_reroll_yn_([^_]+)_(atk|def)_(yes|no)$/);
  if (!match) return;
  const [, gameId, side, choice] = match;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  // Color-toggle the clicked button green, disable the other.
  try {
    const clickedId = interaction.customId;
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        btn.setDisabled(true);
        if (c.customId === clickedId) {
          btn.setStyle(choice === 'yes' ? ButtonStyle.Success : ButtonStyle.Secondary);
        }
        newRow.addComponents(btn);
      }
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch (_e) { /* non-fatal */ }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) return;
  if (choice === 'yes') {
    // Show the picker. The YnAsked flag is set so sendRerollUI falls through.
    await sendRerollUI(thread, game, combat, side === 'atk' ? 'attacker' : 'defender');
    saveGames(game.gameId);
    return;
  }
  // No: advance as if the user clicked "Done (no rerolls)" on the picker.
  // Synthesize a 'done' click on combat_reroll_<gameId>_<side>_done.
  const fakeInteraction = {
    ...interaction,
    customId: `combat_reroll_${gameId}_${side}_done`,
    deferUpdate: async () => {},
    followUp: async () => {},
  };
  await handleCombatReroll(fakeInteraction, ctx);
}

/**
 * Handle reroll button clicks (combat_reroll_{gameId}_{atk|def}_{index|done})
 */
export async function handleCombatReroll(interaction, ctx) {
  const { getGame, replyIfGameEnded, rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals, recalcDefenseTotals, saveGames } = ctx;
  // Match the standard "pick a die / done" pattern. New variants
  // (`ctrl_${idx}` to fire a controlled ability, `cancelctrl` to exit the
  // sub-picker) get their own match branches below.
  const _ctrlMatch = interaction.customId.match(/^combat_reroll_([^_]+)_(ctrl_\d+|cancelctrl)$/);
  const match = _ctrlMatch || interaction.customId.match(/^combat_reroll_([^_]+)_(atk|def)_(done|\d+)$/);
  if (!match) return;
  const gameId = match[1];
  const side = _ctrlMatch ? null : match[2];
  const choice = _ctrlMatch ? null : match[3];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.rerollPhase) {
    await interaction.followUp({ content: 'No reroll phase active.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Branch A: "Use {ability}" button — set the sub-picker flag and
  // re-render the side bucket. Permission gate: only the owner of the
  // current bucket can pick.
  if (_ctrlMatch) {
    const _ctrlGameId = match[1];
    const _ctrlOp = match[2];
    const _ctrlAtkPN = combat.attackerPlayerNum || 1;
    const _ctrlDefPN = opponentPlayerNum(_ctrlAtkPN);
    const _ctrlExpectedPN = combat.rerollPhase === 'attacker' ? _ctrlAtkPN : _ctrlDefPN;
    if (!await requirePlayer(interaction, game, interaction.user.id, _ctrlExpectedPN, canActAsPlayer, `Only **${getPlayerDisplayName(game, _ctrlExpectedPN, interaction.client)}** can use abilities in this reroll window.`)) return;
    const _ctrlThread = await fetchCombatThread(interaction.client, combat.combatThreadId);
    if (!_ctrlThread) throw new Error(`handleCombatReroll: thread missing (threadId=${combat.combatThreadId})`);
    if (_ctrlOp === 'cancelctrl') {
      combat.controlledRerollActiveIdx = null;
      await sendRerollUI(_ctrlThread, game, combat, combat.rerollPhase);
      saveGames(game.gameId);
      return;
    }
    // _ctrlOp like "ctrl_3"
    const _ctrlIdx = parseInt(_ctrlOp.slice(5), 10);
    const _ctrlEntry = (combat.forcedRerollQueue || [])[_ctrlIdx];
    if (!_ctrlEntry || (_ctrlEntry.remaining ?? 0) <= 0 || _ctrlEntry.controlPlayer !== _ctrlExpectedPN) {
      await interaction.followUp({ content: 'That ability is no longer available.', ephemeral: true }).catch(discordCatch);
      return;
    }
    combat.controlledRerollActiveIdx = _ctrlIdx;
    await sendRerollUI(_ctrlThread, game, combat, combat.rerollPhase);
    saveGames(game.gameId);
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const effectiveAtk = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  // Phase validation. In sub-picker mode (controlledRerollActiveIdx set)
  // both atk and def die clicks are valid — the entry's pool restricts.
  if (combat.controlledRerollActiveIdx == null) {
    const expectedPhase = side === 'atk' ? 'attacker' : 'defender';
    if (combat.rerollPhase !== expectedPhase) {
      await interaction.followUp({ content: `It's the ${combat.rerollPhase}'s turn to reroll.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  const expectedPlayer = combat.controlledRerollActiveIdx != null
    ? (combat.rerollPhase === 'attacker' ? effectiveAtk : defenderPlayerNum)
    : (side === 'atk' ? effectiveAtk : defenderPlayerNum);
  if (!expectedPlayer || !await requirePlayer(interaction, game, interaction.user.id, expectedPlayer, canActAsPlayer, `Only **${getPlayerDisplayName(game, expectedPlayer, interaction.client)}** can reroll ${combat.controlledRerollActiveIdx != null ? 'these' : (side === 'atk' ? 'attack' : 'defense')} dice.`)) return;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) throw new Error(`handleCombatReroll: combat thread is null (threadId=${combat.combatThreadId}, gameId=${gameId})`);

  // Helper: get the dominant icon type of a die result for Double or Nothing
  const _getDomIcon = (d) => {
    if (!d) return null;
    const { dmg: _dd = 0, surge: _ds = 0, acc: _da = 0 } = d;
    if (_dd === 0 && _ds === 0 && _da === 0) return null;
    if (_dd >= _ds && _dd >= _da) return 'dmg';
    if (_ds >= _dd && _ds >= _da) return 'surge';
    return 'acc';
  };

  // --- Sub-picker for an attacker/defender bucket controlled ability ---
  // (Modern path: user clicked "Use {ability}", now picking a pool die.)
  if (combat.controlledRerollActiveIdx != null && combat.rerollPhase !== 'forced') {
    const _spIdx = combat.controlledRerollActiveIdx;
    const _spEntry = (combat.forcedRerollQueue || [])[_spIdx];
    if (!_spEntry || (_spEntry.remaining ?? 0) <= 0) {
      combat.controlledRerollActiveIdx = null;
      await sendRerollUI(thread, game, combat, combat.rerollPhase);
      saveGames(game.gameId);
      return;
    }
    if (choice === 'done') {
      // Done in sub-picker is a no-op (user should use Cancel). Re-render.
      await sendRerollUI(thread, game, combat, combat.rerollPhase);
      saveGames(game.gameId);
      return;
    }
    const idx = parseInt(choice, 10);
    if (side === 'atk' && (_spEntry.pool === 'attack' || _spEntry.pool === 'any')) {
      const dice = combat.attackDiceResults || [];
      const _spAtkRr = combat.attackerRerolledIndices || [];
      if (idx >= 0 && idx < dice.length && !_spAtkRr.includes(idx)) {
        // Much to Learn (turn mode): no reroll — open a face picker so
        // the attacker chooses the new die face (no restriction on
        // which face) per alexanbv 2026-05-11.
        if (_spEntry.mtlMode === 'turn') {
          combat.mtlTurnPhase = true;
          combat.mtlTurnQueueIdx = _spIdx;
          combat.mtlTurnDieIdx = idx;
          combat.controlledRerollActiveIdx = null;
          await sendMtlFacePicker(thread, gameId, combat, idx, ctx);
          saveGames(game.gameId);
          return;
        }
        const oldDie = dice[idx];
        const newDie = rollSingleAttackDie(oldDie.color);
        dice[idx] = newDie;
        combat.attackDiceResults = dice;
        const totals = recalcAttackTotals(dice);
        combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
        _spEntry.remaining -= 1;
        if (!combat.attackerRerolledIndices) combat.attackerRerolledIndices = [];
        if (!combat.attackerRerolledIndices.includes(idx)) combat.attackerRerolledIndices.push(idx);
        if (_spEntry.source === 'Survival is Strength' && _spEntry.armorerFigKey) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          game.roundFigureAbilityUsed[`${_spEntry.armorerFigKey}_survival_is_strength`] = true;
        }
        await thread.send(`**${_spEntry.source}** reroll ATK ${oldDie.color} #${idx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`);
      }
    } else if (side === 'def' && (_spEntry.pool === 'defense' || _spEntry.pool === 'any')) {
      const dice = combat.defenseDiceResults || [];
      const _spDefRr = combat.defenderRerolledIndices || [];
      if (idx >= 0 && idx < dice.length && !_spDefRr.includes(idx)) {
        const oldDie = dice[idx];
        const newDie = rollSingleDefenseDie(oldDie.color);
        dice[idx] = newDie;
        combat.defenseDiceResults = dice;
        const totals = recalcDefenseTotals(dice);
        combat.defenseRoll = { block: totals.block, evade: totals.evade, dodge: totals.dodge };
        _spEntry.remaining -= 1;
        if (!combat.defenderRerolledIndices) combat.defenderRerolledIndices = [];
        if (!combat.defenderRerolledIndices.includes(idx)) combat.defenderRerolledIndices.push(idx);
        const dodgeTag = newDie.dodge ? '/DODGE' : '';
        await thread.send(`**${_spEntry.source}** reroll DEF ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
        // Demoralizing Monologue post-reroll reveal prompt (preserved).
        if (_spEntry.demoralizingMonologue) {
          const _dmCasterPN = _spEntry.casterPlayerNum || combat.attackerPlayerNum;
          const _dmCasterId = getPlayerId(game, _dmCasterPN);
          combat.demoralizingMonologuePending = {
            rerolledDieIdx: idx,
            rerolledDieBlock: newDie.block || 0,
            rerolledDieEvade: newDie.evade || 0,
            rerolledDieDodge: !!newDie.dodge,
            casterPlayerNum: _dmCasterPN,
          };
          const _dmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`demoralizing_reveal_use_${gameId}`).setLabel('Reveal Hand (need ≥2 cards)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`demoralizing_reveal_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send(sanitizeMentions({
            content: `<@${_dmCasterId}> **Demoralizing Monologue** — Reveal your hand publicly? If you have 2+ cards, the rerolled die's results are removed from defense.`,
            allowedMentions: { users: [_dmCasterId] },
            components: [_dmRow],
          })).catch(discordCatch);
          saveGames(game.gameId);
          return;
        }
      }
    }
    // Entry exhausted → drop from queue; clear sub-picker; re-render main.
    if ((_spEntry.remaining ?? 0) <= 0) {
      const _spRemoveAt = combat.forcedRerollQueue.indexOf(_spEntry);
      if (_spRemoveAt >= 0) combat.forcedRerollQueue.splice(_spRemoveAt, 1);
    }
    combat.controlledRerollActiveIdx = null;
    await sendRerollUI(thread, game, combat, combat.rerollPhase);
    saveGames(game.gameId);
    return;
  }

  // --- Reroll phase handling (attacker / defender bucket) ---
  let _tlTriggered = false;
  if (choice !== 'done') {
    const idx = parseInt(choice, 10);
    if (side === 'atk') {
      const dice = combat.attackDiceResults || [];
      const _atkAlreadyRerolled = combat.attackerRerolledIndices || [];
      // Overpower (RGC): one slot of the attacker reroll budget is locked to
      // the configured color (red). Picking a non-locked-color die requires
      // at least 1 non-Overpower slot remaining; picking a matching-color die
      // consumes the locked slot first.
      if (idx >= 0 && idx < dice.length && combat.attackerRerollsRemaining > 0 && !_atkAlreadyRerolled.includes(idx)) {
        const _opLockColor = combat.overpowerAtkColorLocked;
        const _opLockAvail = !!combat.overpowerAtkLockedAvailable;
        const _opPickColor = dice[idx]?.color;
        if (_opLockColor && _opPickColor && _opPickColor !== _opLockColor) {
          const _opNonLocked = combat.attackerRerollsRemaining - (_opLockAvail ? 1 : 0);
          if (_opNonLocked <= 0) {
            await interaction.followUp({ content: `🚫 **Overpower** restricts this reroll to **${_opLockColor}** dice — no other reroll budget available for a ${_opPickColor} die.`, ephemeral: true }).catch(discordCatch);
            return;
          }
        }
        const oldDie = dice[idx];
        const newDie = rollSingleAttackDie(oldDie.color);
        dice[idx] = newDie;
        combat.attackDiceResults = dice;
        const totals = recalcAttackTotals(dice);
        combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
        combat.attackerRerollsRemaining -= 1;
        // Overpower locked-slot bookkeeping: prefer to consume locked slot
        // when the picked die matches the locked color.
        if (_opLockColor && _opLockAvail && _opPickColor === _opLockColor) {
          combat.overpowerAtkLockedAvailable = false;
        }
        // G12: mark this die index as rerolled
        combat.attackerRerolledIndices = [..._atkAlreadyRerolled, idx];
        await thread.send(`**Rerolled** attack ${oldDie.color} #${idx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`);
        // Double or Nothing: if DON flag is set for attack side, check dominant icon match
        if (game.doubleMatchingIconsOnReroll?.side === 'atk' && !combat.doubleOrNothingApplied) {
          const _domOld = _getDomIcon(oldDie);
          const _domNew = _getDomIcon(newDie);
          if (_domOld && _domOld === _domNew) {
            dice[idx][_domNew] = (newDie[_domNew] || 0) * 2;
            const t2 = recalcAttackTotals(dice);
            combat.attackRoll = { acc: t2.acc, dmg: t2.dmg, surge: t2.surge };
            await thread.send(`**Double or Nothing** — Dominant icon matched (${_domNew})! Doubled to ${dice[idx][_domNew]}. New totals: ${t2.acc} acc, ${t2.dmg} dmg, ${t2.surge} surge.`);
          } else {
            await thread.send(`**Double or Nothing** — Icon changed (${_domOld ?? 'blank'} → ${_domNew ?? 'blank'}). No doubling.`);
          }
          combat.doubleOrNothingApplied = true;
          game.doubleMatchingIconsOnReroll = null;
        }
        // Advanced Targeting Computer (Dark Trooper Mk III): if rerolled die has fewer Hits, +1 Hit
        if (!combat.advTcBonusApplied) {
          const _atcDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
          const _atcDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
          const _atcEff = _atcDcEff[_atcDcName] || _atcDcEff[_atcDcName?.replace(/\s*\[.*\]\s*$/, '')];
          if (hasAdvTargetingComputerAbility(_atcEff?.specialAbilityIds || [])) {
            if (advTcRerollLostHits(oldDie, newDie)) {
              const _atcBonus = applyAdvTcHitBonus(combat);
              combat.bonusHits = _atcBonus.bonusHits;
              combat.advTcBonusApplied = true;
              await thread.send('**Advanced Targeting Computer** — Rerolled die has fewer Hits: +1 Hit applied.');
            }
          }
        }
        // Tough Luck: if defender set TL, they may remove this rerolled die
        if (game.toughLuckPlayerNum === defenderPlayerNum) {
          setPendingToughLuck(game, { side: 'atk', idx });
          const _tlOwner = game[`player${defenderPlayerNum}Id`] ?? '';
          const _tlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tough_luck_remove_${gameId}_${idx}`).setLabel(`Remove rerolled ${newDie.color} die`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tough_luck_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Tough Luck** — <@${_tlOwner}> may remove the rerolled attack die.`, components: [_tlRow] }).catch(discordCatch);
          _tlTriggered = true;
        }
      }
    } else {
      const dice = combat.defenseDiceResults || [];
      const _defAlreadyRerolled = combat.defenderRerolledIndices || [];
      // Overpower (RGC): one slot of defender reroll budget is locked to
      // the configured color (black) — same scheme as the attacker side.
      if (idx >= 0 && idx < dice.length && combat.defenderRerollsRemaining > 0 && !_defAlreadyRerolled.includes(idx)) {
        const _opDefLockColor = combat.overpowerDefColorLocked;
        const _opDefLockAvail = !!combat.overpowerDefLockedAvailable;
        const _opDefPickColor = dice[idx]?.color;
        if (_opDefLockColor && _opDefPickColor && _opDefPickColor !== _opDefLockColor) {
          const _opDefNonLocked = combat.defenderRerollsRemaining - (_opDefLockAvail ? 1 : 0);
          if (_opDefNonLocked <= 0) {
            await interaction.followUp({ content: `🚫 **Overpower** restricts this reroll to **${_opDefLockColor}** dice — no other reroll budget available for a ${_opDefPickColor} die.`, ephemeral: true }).catch(discordCatch);
            return;
          }
        }
        const oldDie = dice[idx];
        const newDie = rollSingleDefenseDie(oldDie.color);
        dice[idx] = newDie;
        combat.defenseDiceResults = dice;
        const totals = recalcDefenseTotals(dice);
        combat.defenseRoll = { block: totals.block, evade: totals.evade, dodge: totals.dodge };
        combat.defenderRerollsRemaining -= 1;
        if (_opDefLockColor && _opDefLockAvail && _opDefPickColor === _opDefLockColor) {
          combat.overpowerDefLockedAvailable = false;
        }
        // G12: mark this die index as rerolled
        combat.defenderRerolledIndices = [..._defAlreadyRerolled, idx];
        combat.defenderRerolledOrModified = true; // Track for Quick Strike (Electrostaff loadout)
        const dodgeTag = newDie.dodge ? '/DODGE' : '';
        await thread.send(`**Rerolled** defense ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
        // Double or Nothing: if DON flag is set for defense side, check dominant icon match
        if (game.doubleMatchingIconsOnReroll?.side === 'def' && !combat.doubleOrNothingApplied) {
          const _domOldD = _getDomIcon({ dmg: oldDie.block, surge: oldDie.evade, acc: oldDie.dodge ? 1 : 0 });
          const _domNewD = _getDomIcon({ dmg: newDie.block, surge: newDie.evade, acc: newDie.dodge ? 1 : 0 });
          if (_domOldD && _domOldD === _domNewD) {
            if (_domNewD === 'dmg') { dice[idx].block = (newDie.block || 0) * 2; }
            else if (_domNewD === 'surge') { dice[idx].evade = (newDie.evade || 0) * 2; }
            const t2d = recalcDefenseTotals(dice);
            combat.defenseRoll = { block: t2d.block, evade: t2d.evade, dodge: t2d.dodge };
            await thread.send(`**Double or Nothing** — Dominant defense icon matched (${_domNewD === 'dmg' ? 'Block' : 'Evade'})! Doubled. New totals: ${t2d.block} block, ${t2d.evade} evade.`);
          } else {
            await thread.send(`**Double or Nothing** — Icon changed. No doubling.`);
          }
          combat.doubleOrNothingApplied = true;
          game.doubleMatchingIconsOnReroll = null;
        }
        // Tough Luck: if attacker set TL, they may remove this rerolled defense die
        if (game.toughLuckPlayerNum === attackerPlayerNum) {
          setPendingToughLuck(game, { side: 'def', idx });
          const _tlOwner = game[`player${attackerPlayerNum}Id`] ?? '';
          const _tlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tough_luck_remove_${gameId}_${idx}`).setLabel(`Remove rerolled ${newDie.color} die`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tough_luck_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Tough Luck** — <@${_tlOwner}> may remove the rerolled defense die.`, components: [_tlRow] }).catch(discordCatch);
          _tlTriggered = true;
        }
      }
    }
  }
  if (_tlTriggered) { saveGames(game.gameId); return; }

  // Check if current side is done (clicked done or exhausted rerolls)
  if (side === 'atk' && (choice === 'done' || combat.attackerRerollsRemaining <= 0)) {
    // Combat gate: both players review attacker rerolls before proceeding
    await sendCombatGate(thread, game, combat, 'post_attacker_reroll', ctx);
    saveGames(game.gameId);
    return;
  }
  if (side === 'def' && (choice === 'done' || (combat.defenderRerollsRemaining <= 0 && !(combat.crossTrainingAvailable && !combat.crossTrainingUsed)))) {
    // Combat gate: both players review defender rerolls before modifications
    await sendCombatGate(thread, game, combat, 'post_defender_reroll', ctx);
    saveGames(game.gameId);
    return;
  }

  // Still has rerolls — show updated UI
  await sendRerollUI(thread, game, combat, combat.rerollPhase);
  saveGames(game.gameId);
}

/**
 * Handle Cross Training reroll flow:
 *   ct_reroll_{gameId}_pick         → show die picker
 *   ct_reroll_{gameId}_die_{index}  → show color picker
 *   ct_reroll_{gameId}_color_{index}_{color} → swap color, reroll, exhaust
 */
export async function handleCrossTrainingReroll(interaction, ctx) {
  const { getGame, replyIfGameEnded, rollSingleDefenseDie, recalcDefenseTotals, saveGames } = ctx;
  const match = interaction.customId.match(/^ct_reroll_([^_]+)_(pick|die_(\d+)|color_(\d+)_(\w+))$/);
  if (!match) return;
  const [, gameId] = match;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || combat.rerollPhase !== 'defender') {
    await interaction.followUp({ content: 'No defender reroll phase active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, defenderPlayerNum, canActAsPlayer, `Only the defender (**${getPlayerDisplayName(game, defenderPlayerNum, interaction.client)}**) may use Cross Training.`)) return;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  const action = interaction.customId.replace(`ct_reroll_${gameId}_`, '');

  if (action === 'pick') {
    // Step 1: Show die picker — which die to swap & reroll
    const dice = combat.defenseDiceResults || [];
    const alreadyRerolled = combat.defenderRerolledIndices || [];
    const buttons = [];
    for (let i = 0; i < dice.length; i++) {
      if (alreadyRerolled.includes(i)) continue; // G12: each die max once
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`ct_reroll_${gameId}_die_${i}`)
          .setLabel(`${formatDefenseDie(dice[i], i)}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_def_done`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    );
    await thread.send({
      content: '**Cross Training** — Pick a defense die to replace & reroll:',
      components: buildActionRows(buttons),
    });
    saveGames(game.gameId);
    return;
  }

  const dieMatch = action.match(/^die_(\d+)$/);
  if (dieMatch) {
    // Step 2: Player picked a die — show color picker
    const dieIdx = parseInt(dieMatch[1], 10);
    const dice = combat.defenseDiceResults || [];
    if (dieIdx < 0 || dieIdx >= dice.length) return;
    const currentColor = dice[dieIdx].color;
    const availableColors = ['white', 'black'].filter(c => c !== currentColor);
    const buttons = availableColors.map(color =>
      new ButtonBuilder()
        .setCustomId(`ct_reroll_${gameId}_color_${dieIdx}_${color}`)
        .setLabel(`Swap to ${color}`)
        .setStyle(ButtonStyle.Primary)
    );
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ct_reroll_${gameId}_pick`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    );
    await thread.send({
      content: `**Cross Training** — Replace ${currentColor} die #${dieIdx + 1} with:`,
      components: buildActionRows(buttons),
    });
    saveGames(game.gameId);
    return;
  }

  const colorMatch = action.match(/^color_(\d+)_(\w+)$/);
  if (colorMatch) {
    // Step 3: Swap color, reroll, exhaust
    const dieIdx = parseInt(colorMatch[1], 10);
    const newColor = colorMatch[2];
    const dice = combat.defenseDiceResults || [];
    if (dieIdx < 0 || dieIdx >= dice.length) return;
    const alreadyRerolled = combat.defenderRerolledIndices || [];
    if (alreadyRerolled.includes(dieIdx)) {
      await interaction.followUp({ content: 'That die has already been rerolled.', ephemeral: true }).catch(discordCatch);
      return;
    }
    const oldDie = dice[dieIdx];
    const oldColor = oldDie.color;
    // Swap color and reroll
    const newDie = rollSingleDefenseDie(newColor);
    dice[dieIdx] = newDie;
    combat.defenseDiceResults = dice;
    const totals = recalcDefenseTotals(dice);
    combat.defenseRoll = { block: totals.block, evade: totals.evade, dodge: totals.dodge };
    // Mark die as rerolled (G12)
    combat.defenderRerolledIndices = [...alreadyRerolled, dieIdx];
    combat.defenderRerolledOrModified = true;
    // Mark Cross Training as used
    combat.crossTrainingUsed = true;
    // Exhaust the upgrade
    const ctMsgId = combat.crossTrainingDefMsgId;
    if (ctMsgId) {
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[ctMsgId] = [...(game.exhaustedSkirmishUpgrades[ctMsgId] || []), 'Cross Training'];
    }
    const dodgeTag = newDie.dodge ? '/DODGE' : '';
    await thread.send(`**Cross Training** — Exhausted. Swapped ${oldColor} → ${newColor} die #${dieIdx + 1}, rerolled: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);

    // Check if defender still has rerolls or should finish
    const ctStillAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    if (combat.defenderRerollsRemaining <= 0 && !ctStillAvailable) {
      await sendCombatGate(thread, game, combat, 'post_defender_reroll', ctx);
      saveGames(game.gameId);
      return;
    }
    // Still has rerolls — show updated UI
    await sendRerollUI(thread, game, combat, 'defender');
    saveGames(game.gameId);
    return;
  }
}

/**
 * Handle pre-reroll button clicks (pre_reroll_{gameId}_{choice})
 * Choices: twin_sabers_atk, twin_sabers_def, resourceful_atk, resourceful_def,
 *   trained_yes, trained_no, shrewd_0/1/2, skip
 */
export async function handlePreReroll(interaction, ctx) {
  const { getGame, replyIfGameEnded, rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals, recalcDefenseTotals, saveGames } = ctx;
  const match = interaction.customId.match(/^pre_reroll_([^_]+)_(.+)$/);
  if (!match) return;
  const [, gameId, choice] = match;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pr = (combat.pendingPreRerolls || [])[0];
  if (!pr) { await interaction.followUp({ content: 'No pending pre-reroll.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, pr.playerNum, canActAsPlayer, `Only **${getPlayerDisplayName(game, pr.playerNum, interaction.client)}** can make this choice.`)) return;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  // Process choice
  if (choice === 'skip') {
    combat.pendingPreRerolls.shift();
    await thread.send(`Pre-reroll choice skipped.`);
  } else if (choice === 'twin_sabers_atk') {
    // R28/R29: Reroll ALL attack dice that haven't been rerolled yet.
    // Per alexanbv 2026-05-10: "a die can only be rerolled once. If an
    // attack die is rerolled from some other ability that is not twin
    // sabers, then reroll all OTHER attack dice." All rerolled dice
    // are then marked simultaneously so subsequent abilities exclude them.
    const atkDice = combat.attackDiceResults || [];
    const alreadyRerolled = new Set(combat.attackerRerolledIndices || []);
    const rerolledIndices = [];
    const details = [];
    const skipped = [];
    for (let i = 0; i < atkDice.length; i++) {
      if (alreadyRerolled.has(i)) {
        skipped.push(`#${i + 1} (already rerolled)`);
        continue;
      }
      const oldDie = atkDice[i];
      const newDie = rollSingleAttackDie(oldDie.color);
      atkDice[i] = newDie;
      rerolledIndices.push(i);
      details.push(`#${i + 1} ${oldDie.color}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s**`);
    }
    combat.attackDiceResults = atkDice;
    const atkTotals = recalcAttackTotals(atkDice);
    combat.attackRoll = { acc: atkTotals.acc, dmg: atkTotals.dmg, surge: atkTotals.surge };
    combat.attackerRerolledIndices = [...(combat.attackerRerolledIndices || []), ...rerolledIndices];
    combat.pendingPreRerolls.shift();
    const skipNote = skipped.length > 0 ? `\nSkipped (already rerolled): ${skipped.join(', ')}` : '';
    await thread.send(`**Twin Sabers** — Rerolled ${rerolledIndices.length} attack die${rerolledIndices.length === 1 ? '' : 's'} simultaneously:\n${details.join('\n') || '(no eligible dice)'}\nNew totals: ${atkTotals.acc} acc, ${atkTotals.dmg} dmg, ${atkTotals.surge} surge${skipNote}`);
  } else if (choice === 'twin_sabers_def') {
    // R28/R29: Force reroll ALL defense dice that haven't been rerolled yet.
    // Per alexanbv 2026-05-10: a die can only be rerolled once.
    const defDice = combat.defenseDiceResults || [];
    const alreadyRerolled = new Set(combat.defenderRerolledIndices || []);
    const rerolledIndices = [];
    const details = [];
    const skipped = [];
    for (let i = 0; i < defDice.length; i++) {
      if (alreadyRerolled.has(i)) {
        skipped.push(`#${i + 1} (already rerolled)`);
        continue;
      }
      const oldDie = defDice[i];
      const newDie = rollSingleDefenseDie(oldDie.color);
      defDice[i] = newDie;
      rerolledIndices.push(i);
      const dodgeTag = newDie.dodge ? '/DODGE' : '';
      details.push(`#${i + 1} ${oldDie.color}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}**`);
    }
    combat.defenseDiceResults = defDice;
    const defTotals = recalcDefenseTotals(defDice);
    combat.defenseRoll = { block: defTotals.block, evade: defTotals.evade, dodge: defTotals.dodge };
    combat.defenderRerolledIndices = [...(combat.defenderRerolledIndices || []), ...rerolledIndices];
    combat.pendingPreRerolls.shift();
    const skipNote = skipped.length > 0 ? `\nSkipped (already rerolled): ${skipped.join(', ')}` : '';
    await thread.send(`**Twin Sabers** — Force rerolled ${rerolledIndices.length} defense die${rerolledIndices.length === 1 ? '' : 's'} simultaneously:\n${details.join('\n') || '(no eligible dice)'}\nNew totals: ${defTotals.block} block, ${defTotals.evade} evade${defTotals.dodge ? ' DODGE' : ''}${skipNote}`);
  } else if (choice === 'resourceful_atk') {
    combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
    combat.resourcefulSide = 'atk';
    combat.pendingPreRerolls.shift();
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — +1 attack reroll.${gambitNote}`);
  } else if (choice === 'resourceful_def') {
    combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
    combat.resourcefulSide = 'def';
    combat.pendingPreRerolls.shift();
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — +1 defense reroll.${gambitNote}`);
  } else if (choice === 'trained_yes') {
    // Trained Rancor: "While attacking, you may suffer 1 Strain to reroll
    // 1 attack die." Strain routed through the new applyStrain handler so
    // the player gets the deck-discard option (+ Paz exception, UD pre-
    // prompt). Reroll is granted in the followup AFTER strain resolves.
    combat.pendingPreRerolls.shift();
    await applyStrain(game, ctx, {
      figureKey: combat.attackerFigureKey,
      controllerPlayerNum: combat.attackerPlayerNum,
      amount: 1,
      source: 'Trained',
      followup: { type: 'trained_grant_reroll', payload: { gameId: game.gameId } },
    });
    saveGames(game.gameId);
    return;
  } else if (choice === 'trained_no') {
    combat.pendingPreRerolls.shift();
    await thread.send(`**Trained** — Skipped.`);
  } else if (choice.startsWith('shrewd_')) {
    const guess = parseInt(choice.replace('shrewd_', ''), 10);
    if (!isNaN(guess)) {
      combat.shrewdScoundrelGuess = guess;
      await thread.send(`**Shrewd Scoundrel** — Guessed **${guess}** Hit result${guess !== 1 ? 's' : ''}.`);
    }
    combat.pendingPreRerolls.shift();
  } else {
    combat.pendingPreRerolls.shift();
  }

  await _advancePreRerollChain(game, ctx, combat, thread);
}

/**
 * Advance the pre-reroll queue: if more pre-roll abilities remain prompt
 * the next one; otherwise transition into the actual reroll window
 * (attacker → forced → defender → proceedAfterRerolls).
 *
 * Extracted so strain followups (Trained Rancor) can re-enter the
 * post-choice flow after the strain prompt resolves async.
 */
async function _advancePreRerollChain(game, ctx, combat, thread) {
  const { saveGames } = ctx;
  // Check if more pre-rerolls remain
  if ((combat.pendingPreRerolls || []).length > 0) {
    combat.rerollPhase = 'attacker';
    await sendRerollUI(thread, game, combat, 'attacker');
    saveGames(game.gameId);
    return;
  }

  // All pre-rerolls done — enter the actual reroll window
  combat.preRerollsProcessed = true;
  const hasForcedRerolls = (combat.forcedRerollQueue || []).length > 0;
  const atkR = combat.attackerRerollsRemaining || 0;
  const defR = combat.defenderRerollsRemaining || 0;
  if (atkR > 0 || defR > 0 || hasForcedRerolls) {
    if (atkR > 0) {
      combat.rerollPhase = 'attacker';
      await sendRerollUI(thread, game, combat, 'attacker');
    } else if (hasForcedRerolls) {
      combat.rerollPhase = 'forced';
      await sendRerollUI(thread, game, combat, 'forced');
    } else {
      combat.rerollPhase = 'defender';
      await sendRerollUI(thread, game, combat, 'defender');
    }
    saveGames(game.gameId);
    return;
  }
  // No rerolls — proceed directly
  combat.rerollPhase = null;
  await proceedAfterRerolls(thread, game, combat, ctx);
  saveGames(game.gameId);
}

// Strain followup: Trained Rancor "suffer 1 strain to reroll 1 attack die".
// After applyStrain resolves the player's choice (damage / deck-discard /
// Paz-return), grant the +1 attack reroll and continue the pre-reroll
// chain (handlePreReroll's tail logic, extracted to _advancePreRerollChain).
registerStrainFollowup('trained_grant_reroll', async (game, ctx, _payload) => {
  const combat = game.pendingCombat;
  if (!combat) return;
  const thread = await fetchCombatThread(ctx.client, combat.combatThreadId);
  if (!thread) return;
  combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
  await thread.send('**Trained** — +1 attack reroll granted.').catch(discordCatch);
  await _advancePreRerollChain(game, ctx, combat, thread);
});

// Delegate to src/game/spatial.js (canonical implementation)
const isWithinSpaces = _isWithinSpaces;

// --- DC passive stat helpers ---

/**
 * Parse the dc-effects.json `passives` array for a figure and apply printed
 * card stat bonuses to the pending combat object.
 *
 * Attacker bonuses: +N Hit, +N Accuracy, Pierce N, +N Surge, Blast N
 * Defender bonuses: Block N, +N Evade
 * Combined entries (e.g. "+1 Hit, +1 Accuracy, +1 Block") split by comma —
 * each part is applied to whichever role is relevant.
 */
function applyDcPassivesToCombat(combat, attackerPassives, defenderPassives) {
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
      if (p === 'professional') { combat.rerollOneAttackDie = (combat.rerollOneAttackDie || 0) + 1; continue; }
    }
  }

  for (const passive of (defenderPassives || [])) {
    for (const p of parts(passive)) {
      const blk  = p.match(/^(?:block\s+(\d+)|\+(\d+)\s+block)$/i); if (blk) { combat.bonusBlock = (combat.bonusBlock || 0) + parseInt(blk[1] ?? blk[2], 10); continue; }
      const evd  = p.match(/^\+(\d+)\s+evade$/);      if (evd)    { combat.bonusEvade     = (combat.bonusEvade     || 0) + parseInt(evd[1],    10); continue; }
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

  // Find Ko-Tun on the same team with squad_cohesion_kotun
  let koTunInRange = false;
  for (const [fk, pos] of Object.entries(friendlyPos)) {
    if (fk === combatFigureKey) continue;
    const fDcName = dcNameFromFigureKey(fk);
    const fEff = dcEff[fDcName] || dcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if (!(fEff?.specialAbilityIds || []).includes('squad_cohesion_kotun')) continue;
    if (isWithinSpaces(mapSp, String(pos).toLowerCase(), combatPosLc, 3)) {
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
    if (!isWithinSpaces(mapSp, String(pos).toLowerCase(), combatPosLc, 3)) continue;
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

  const btns = uniqueTokens.slice(0, 4).map(({ type, index, count }) =>
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_${prefix}_${index}`)
      .setLabel(type === 'Wild'
        ? `Wild${count > 1 ? ` (${count})` : ''}`
        : `Spend ${type}${count > 1 ? ` (have ${count})` : ''}`)
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
          .setLabel(sc.type === 'Wild' ? `Wild from ${sc.ownerName}` : `${sc.type} from ${sc.ownerName}`)
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
 * Hit Token or Surge Token while declaring an attack, it MAY suffer 1
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
      .setLabel('Rogue One: +1 Hit (discard ally token)')
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
 * Handle combat_passive_ buttons: Defensible, Get Down, Call the Shots choices.
 * After applying the choice, re-enters proceedAfterRerolls.
 */
export async function handleCombatPassive(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const m = interaction.customId.match(/^combat_passive_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, rest] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  // Parse ability and choice
  const parts = rest.split('_');
  const abilityKey = parts[0]; // defensible, getdown, cts
  const choice = parts.slice(1).join('_'); // block, evade, skip, acc, hit, surge

  if (abilityKey === 'defensible') {
    if (choice === 'block') {
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      await thread.send('**Defensible** — Applied +1 Block.');
    } else if (choice === 'evade') {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Defensible** — Applied +1 Evade.');
    } else {
      await thread.send('**Defensible** — Skipped.');
    }
    combat.defensibleResolved = true;
    delete combat.pendingCombatPassive;
  } else if (abilityKey === 'shrapnel') {
    // Drokkatta Shrapnel: Blast 2 vs Splash. Blast applies to this
    // attack's damage; Splash queues a post-resolve AoE. After choice
    // resolves, fall through to sendReadyToResolveRolls so combat
    // resumes (was paused at the surge-done gate).
    if (choice === 'blast') {
      combat.surgeBlast = (combat.surgeBlast || 0) + 2;
      await thread.send('🧨 **Shrapnel** — **Blast 2** applied to this attack.');
    } else if (choice === 'splash') {
      combat.surgeShrapnelSplash = true;
      await thread.send('🧨 **Shrapnel** — **Splash** queued (1 Damage to each figure/object within 2 of target, post-resolve if attack didn\'t miss).');
    }
    delete combat.shrapnelChoicePending;
    saveGames(game.gameId);
    await sendReadyToResolveRolls(thread, gameId, game, ctx);
    return;
  } else if (abilityKey === 'getdown') {
    if (combat.getDownFigKey) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${combat.getDownFigKey}_get_down`] = true;
    }
    if (choice === 'block') {
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      await thread.send('**Get Down** — Applied +1 Block.');
    } else if (choice === 'evade') {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Get Down** — Applied +1 Evade.');
    } else {
      await thread.send('**Get Down** — Skipped.');
    }
    combat.getDownResolved = true;
    delete combat.pendingCombatPassive;
    delete combat.getDownFigKey;
  } else if (abilityKey === 'cts') {
    if (combat.callTheShotsFigKey) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${combat.callTheShotsFigKey}_call_the_shots`] = true;
    }
    if (choice === 'acc') {
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
      await thread.send('**Call the Shots** — Applied +2 Accuracy.');
    } else if (choice === 'hit') {
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      await thread.send('**Call the Shots** — Applied +1 Hit.');
    } else if (choice === 'surge') {
      combat.surgeBonus = (combat.surgeBonus || 0) + 1;
      await thread.send('**Call the Shots** — Applied +1 Surge.');
    } else {
      await thread.send('**Call the Shots** — Skipped.');
    }
    combat.callTheShotsResolved = true;
    delete combat.pendingCombatPassive;
    delete combat.callTheShotsFigKey;
  } else if (abilityKey === 'agile') {
    // Agile passive — defender click handler (apply/skip block→evade).
    if (choice === 'apply') {
      const conv = applyAgileConversion({
        block: combat.defenseRoll?.block,
        bonusBlock: combat.bonusBlock,
        bonusEvade: combat.bonusEvade,
      });
      if (conv.applied) {
        combat.bonusBlock = conv.bonusBlock;
        combat.bonusEvade = conv.bonusEvade;
        await thread.send('**Agile** — Converted 1 Block to 1 Evade.');
      } else {
        await thread.send('**Agile** — No Block available to convert.');
      }
    } else {
      await thread.send('**Agile** — Skipped.');
    }
    combat.agileJetTrooperApplied = true;
    delete combat.pendingCombatPassive;
  } else if (abilityKey === 'sf') {
    // Spray Fire (Heavy Stormtrooper Elite) — player chose apply or skip.
    if (choice === 'apply') {
      const bump = applySprayFire(combat);
      combat.bonusAccuracy = bump.bonusAccuracy;
      combat.surgeBonus = bump.surgeBonus;
      await thread.send('**Spray Fire** — -3 Accuracy, +1 Surge applied.');
    } else {
      await thread.send('**Spray Fire** — Skipped.');
    }
    combat.sprayFireResolved = true;
    delete combat.pendingCombatPassive;
  } else if (abilityKey === 'hr') {
    // Heavy Repeater (Paz Vizsla) — three options each cost 1 strain.
    // destruct 2026-05-06: routed through applyStrain so the player gets
    // the per-strain choice prompt (Paz's discard-return option will
    // surface automatically since pazReturnAvailable matches dcName).
    let _hrApplyStrain = false;
    if (choice === 'hit') {
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      await thread.send('**Heavy Repeater** — Applied +1 Hit. Paz Vizsla suffers 1 Strain.');
      _hrApplyStrain = true;
    } else if (choice === 'blast') {
      combat.blastDamage = Math.max(combat.blastDamage || 0, 2);
      await thread.send('**Heavy Repeater** — Applied Blast 2. Paz Vizsla suffers 1 Strain.');
      _hrApplyStrain = true;
    } else if (choice === 'acc') {
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 3;
      await thread.send('**Heavy Repeater** — Applied +3 Accuracy. Paz Vizsla suffers 1 Strain.');
      _hrApplyStrain = true;
    } else {
      await thread.send('**Heavy Repeater** — Skipped.');
    }
    combat.heavyRepeaterResolved = true;
    delete combat.pendingCombatPassive;
    if (_hrApplyStrain) {
      await applyStrain(game, ctx, {
        figureKey: combat.attackerFigureKey,
        controllerPlayerNum: combat.attackerPlayerNum,
        amount: 1,
        source: 'Heavy Repeater',
      });
    }
  } else if (abilityKey === 'elusive') {
    // Elusive: defender chose an attack die to nullify, then worst defense die is also nullified
    if (choice === 'skip') {
      await thread.send('**Elusive** — Skipped.');
    } else {
      const dieIdx = parseInt(choice, 10);
      const atkDice = combat.attackDiceResults;
      const defDice = combat.defenseDiceResults;
      if (atkDice && dieIdx >= 0 && dieIdx < atkDice.length) {
        const oldAtk = atkDice[dieIdx];
        const atkRemovedDmg = oldAtk.dmg || 0;
        const atkRemovedSurge = oldAtk.surge || 0;
        const atkRemovedAcc = oldAtk.acc || 0;
        // Nullify the chosen attack die
        atkDice[dieIdx] = { ...oldAtk, dmg: 0, surge: 0, acc: 0 };
        // Recalculate attack totals
        combat.attackRoll = { dmg: 0, surge: 0, acc: 0 };
        for (const d of atkDice) {
          combat.attackRoll.dmg += (d.dmg || 0);
          combat.attackRoll.surge += (d.surge || 0);
          combat.attackRoll.acc += (d.acc || 0);
        }
        let defMsg = '';
        // Nullify the worst defense die (lowest total contribution)
        if (defDice && defDice.length > 0) {
          let worstIdx = 0;
          let worstVal = Infinity;
          for (let di = 0; di < defDice.length; di++) {
            const val = (defDice[di].block || 0) + (defDice[di].evade || 0) + (defDice[di].dodge ? 100 : 0);
            if (val < worstVal) { worstVal = val; worstIdx = di; }
          }
          const oldDef = defDice[worstIdx];
          const defRemovedBlock = oldDef.block || 0;
          const defRemovedEvade = oldDef.evade || 0;
          const hadDodge = !!oldDef.dodge;
          defDice[worstIdx] = { ...oldDef, block: 0, evade: 0, dodge: false };
          // Recalculate defense totals
          combat.defenseRoll = { block: 0, evade: 0, dodge: false };
          for (const d of defDice) {
            combat.defenseRoll.block += (d.block || 0);
            combat.defenseRoll.evade += (d.evade || 0);
            if (d.dodge) combat.defenseRoll.dodge = true;
          }
          defMsg = ` Defense die #${worstIdx + 1} (${oldDef.color}) nullified: -${defRemovedBlock} Block, -${defRemovedEvade} Evade${hadDodge ? ', -Dodge' : ''}.`;
        }
        await thread.send(`**Elusive** — Attack die #${dieIdx + 1} (${oldAtk.color}) nullified: -${atkRemovedDmg} Hit, -${atkRemovedSurge} Surge, -${atkRemovedAcc} Acc.${defMsg}`);
      }
    }
    combat.elusiveResolved = true;
    delete combat.pendingCombatPassive;
  } else if (abilityKey === 'query') {
    // HK-47 Query: defender chose. 'bleed' = apply Bleed to defender,
    // skip the +1 Damage. 'accept' = no Bleed, +1 Damage.
    if (choice === 'bleed') {
      // Apply Bleed to defender via the standard condition pipeline.
      // Already-Bleeding defender: applyCondition is a no-op (Bleed
      // doesn't stack); choosing Bleed still avoids the +1 Damage.
      if (combat.target?.figureKey) {
        const { applyCondition } = await import('../game/conditions.js');
        applyCondition(game, combat.target.figureKey, 'Bleed');
      }
      await thread.send('🩸 **Query** — Defender chose to become **Bleeding** (no damage bonus).');
    } else {
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      await thread.send('💢 **Query** — Defender accepted **+1 Damage** to the attack results.');
    }
    combat.queryResolved = true;
    delete combat.queryNeedsPrompt;
    delete combat.pendingCombatPassive;
    saveGames(game.gameId);
    await proceedAfterRerolls(thread, game, combat, ctx);
    return;
  } else if (abilityKey === 'cbs') {
    // Line of Fire crate-block-sink: defender chose N damage → +N Block.
    // Apply N to the first carried crate (capped at remaining HP), set
    // bonus block, mark resolved, re-enter modifier sequence.
    const _cbsN = Math.max(0, parseInt(choice, 10) || 0);
    if (_cbsN > 0 && combat.target?.figureKey) {
      const _cbsRule = game?.selectedMission?.rules?.persistent?.crateBlockSink;
      const _cbsHealthPer = _cbsRule?.healthPerCrate || 5;
      const _cbsFk = combat.target.figureKey;
      game.lineOfFireCrateBlock = game.lineOfFireCrateBlock || {};
      const _cbsBlocks = game.lineOfFireCrateBlock[_cbsFk] || [];
      const _cbsCarryCnt = typeof game.figureContraband?.[_cbsFk] === 'number'
        ? game.figureContraband[_cbsFk]
        : (game.figureContraband?.[_cbsFk] ? 1 : 0);
      while (_cbsBlocks.length < _cbsCarryCnt) _cbsBlocks.push(0);
      // Apply damage to crates from first to last; cap each at healthPer.
      let _cbsRem = _cbsN;
      for (let _i = 0; _i < _cbsBlocks.length && _cbsRem > 0; _i++) {
        const _cbsAvail = Math.max(0, _cbsHealthPer - (_cbsBlocks[_i] || 0));
        const _cbsTake = Math.min(_cbsAvail, _cbsRem);
        _cbsBlocks[_i] = (_cbsBlocks[_i] || 0) + _cbsTake;
        _cbsRem -= _cbsTake;
      }
      // Discard any crate that hit healthPerCrate.
      const _cbsBefore = _cbsCarryCnt;
      const _cbsAfterBlocks = [];
      for (let _i = 0; _i < _cbsBlocks.length; _i++) {
        if ((_cbsBlocks[_i] || 0) >= _cbsHealthPer) {
          // Crate destroyed — drop entry
        } else {
          _cbsAfterBlocks.push(_cbsBlocks[_i]);
        }
      }
      const _cbsAfter = _cbsAfterBlocks.length;
      game.lineOfFireCrateBlock[_cbsFk] = _cbsAfterBlocks;
      if (_cbsAfter <= 0) {
        delete game.lineOfFireCrateBlock[_cbsFk];
        if (game.figureContraband?.[_cbsFk]) delete game.figureContraband[_cbsFk];
      } else if (typeof game.figureContraband[_cbsFk] === 'number') {
        game.figureContraband[_cbsFk] = _cbsAfter;
      }
      combat.bonusBlock = (combat.bonusBlock || 0) + _cbsN;
      const _cbsLost = _cbsBefore - _cbsAfter;
      const _cbsLostNote = _cbsLost > 0 ? ` (${_cbsLost} crate${_cbsLost !== 1 ? 's' : ''} destroyed)` : '';
      await thread.send(`📦 **Line of Fire — Crate Block Sink** — ${_cbsN} damage to crate; +${_cbsN} Block to defense${_cbsLostNote}.`);
    } else {
      await thread.send('📦 **Line of Fire — Crate Block Sink** — Skipped (0 damage / 0 Block).');
    }
    combat.crateBlockSinkResolved = true;
    delete combat.pendingCombatPassive;
    saveGames(game.gameId);
    await proceedAfterRerolls(thread, game, combat, ctx);
    return;
  } else if (abilityKey === 'negotiate') {
    const _negDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    if (choice === 'pay') {
      // Defender pays 2 VP to attacker (Hondo)
      deductVp(game, _negDefPN, 2);
      awardObjectiveVp(game, combat.attackerPlayerNum, 2);
      await thread.send(`**Negotiate** — Defender paid 2 VP to Hondo. No bonus damage applied.`);
      if (checkWinConditions) await checkWinConditions(game, client);
    } else {
      // Accept +2 Damage
      combat.bonusHits = (combat.bonusHits || 0) + 2;
      await thread.send('**Negotiate** — +2 Damage applied to attack results.');
    }
    combat.negotiateResolved = true;
    delete combat.pendingCombatPassive;
    saveGames(game.gameId);
    // After Negotiate (ATK modifier) resolves, re-enter the modifier sequence so
    // Call the Shots / Heavy Repeater / Lasat Honor Guard / DEF blocks can fire.
    await proceedAfterRerolls(thread, game, combat, ctx);
    return;
  }

  saveGames(game.gameId);
  await proceedAfterRerolls(thread, game, combat, ctx);
}

/**
 * Sequential per-player "Apply modifiers? Y/N" prompt (CRR step 4).
 * Attacker prompts first; after they respond, defender prompts; after
 * defender responds, advance to surge via proceedAfterRerolls.
 *
 * Per Destruct's UX: each player gets explicit Y/N rather than a
 * shared "Both ready" gate. Y means "I'm playing modifiers, give me
 * a moment" (player applies CCs from their hand channel, then clicks
 * Done). N means "no modifiers, advance".
 */
export async function sendModsYn(thread, game, combat, role) {
  const gameId = game.gameId;
  const isAtk = role === 'attacker';
  const playerNum = isAtk
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;

  // 2026-05-04 migration: Guidance Systems is a CRR step-4 modifier —
  // fire it HERE, not in the attack-roll block. Its handler re-enters
  // sendModsYn after resolving. Veteran Instincts attack-prompt was
  // REMOVED 2026-05-09 (card is a one-time token distributor only).
  if (isAtk) {
    if (combat.guidanceSystemsAvailable && !combat.guidanceSystemsCompleted) {
      combat.guidanceSystemsPrompted = true;
      const _gsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`guidance_systems_${gameId}_use`).setLabel('Use (-1 Damage, +2 Acc)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`guidance_systems_${gameId}_done`).setLabel('Done').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({
        content: `**Guidance Systems** — <@${ownerId}> Apply -1 Hit and +2 Accuracy? (May use multiple times.)`,
        components: [_gsRow],
        allowedMentions: { users: [ownerId] },
      }).catch(discordCatch);
      return;
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_mods_yn_${gameId}_${isAtk ? 'atk' : 'def'}_yes`)
      .setLabel('Yes — applying modifiers')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`combat_mods_yn_${gameId}_${isAtk ? 'atk' : 'def'}_no`)
      .setLabel('No — skip')
      .setStyle(ButtonStyle.Secondary),
  );
  const label = isAtk ? 'Attacker' : 'Defender';
  await thread.send({
    content: `<@${ownerId}> — **${label}: Apply modifiers?** (CRR step 4) Play any CCs / abilities that modify this attack from your hand channel, then click below.`,
    components: [row],
    allowedMentions: { users: [ownerId] },
  }).catch(discordCatch);
}

/**
 * Handle the sequential "Apply modifiers? Y/N" buttons. Yes posts a
 * follow-up "Done with modifiers?" Continue button so the player can
 * take their time playing CCs. No skips immediately.
 *
 * Sequence:
 *   atk_yes → "Continue" button → atk done → defender Y/N
 *   atk_no  → defender Y/N immediately
 *   def_yes → "Continue" button → def done → proceedAfterRerolls
 *   def_no  → proceedAfterRerolls immediately
 */
export async function handleCombatModsYn(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const m = interaction.customId.match(/^combat_mods_yn_([^_]+)_(atk|def)_(yes|no|continue)$/);
  if (!m) return;
  const [, gameId, side, choice] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;

  // Permission check: only the role's player can click their own button.
  const isAtk = side === 'atk';
  const expectedPn = isAtk
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const expectedId = expectedPn === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== expectedId) {
    await interaction.followUp({
      content: `Only the ${isAtk ? 'attacker' : 'defender'} can click that button.`,
      ephemeral: true,
    }).catch(discordCatch);
    return;
  }

  // Color-toggle the clicked button green, disable the others.
  try {
    const clickedId = interaction.customId;
    const newRows = (interaction.message?.components || []).map((row) => {
      const newRow = new ActionRowBuilder();
      for (const c of row.components) {
        const btn = ButtonBuilder.from(c);
        btn.setDisabled(true);
        if (c.customId === clickedId) {
          btn.setStyle(choice === 'no' ? ButtonStyle.Secondary : ButtonStyle.Success);
        }
        newRow.addComponents(btn);
      }
      return newRow;
    });
    if (newRows.length > 0) await interaction.message.edit({ components: newRows }).catch(discordCatch);
  } catch (_e) { /* non-fatal */ }

  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (!thread) return;

  if (choice === 'yes') {
    // Post a follow-up "Continue" button so the player can take their time.
    const continueRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_mods_yn_${gameId}_${side}_continue`)
        .setLabel('Done with modifiers — continue')
        .setStyle(ButtonStyle.Primary),
    );
    await thread.send({
      content: `<@${expectedId}> — Apply your modifier CCs / abilities now. Click **Continue** when done.`,
      components: [continueRow],
      allowedMentions: { users: [expectedId] },
    }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  // 'no' or 'continue' — advance.
  // Combat-pipeline rebuild (slice 3.7-3.8): step4 transitions. Attacker done with
  // modifiers → defender's modifier sub-window opens. Defender done → step 5.
  if (isAtk) {
    combat.currentStep = 'step4-defender';
    await sendModsYn(thread, game, combat, 'defender');
  } else {
    combat.currentStep = 'step5';
    await proceedAfterRerolls(thread, game, combat, ctx);
  }
  saveGames(game.gameId);
}

/**
 * After rerolls are complete: check dodge, then gate through token windows if eligible tokens exist.
 */
export async function proceedAfterRerolls(thread, game, combat, ctx) {
  const saveGames = ctx.saveGames;

  // Shrewd Scoundrel (Lando): check hit guess after all rerolls
  if (typeof combat.shrewdScoundrelGuess === 'number') {
    const hitCount = combat.attackRoll?.dmg ?? 0;
    const guess = combat.shrewdScoundrelGuess;
    if (hitCount === guess) {
      const ssPlayerNum = combat.attackerPlayerNum; // Lando must be attacker or defender
      // Find which player is Lando
      const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const atkSIds = (getDcEff[combat.attackerDcName] || getDcEff[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')])?.specialAbilityIds || [];
      const defDcN = dcNameFromFigureKey(combat.target?.figureKey || '');
      const defSIds = (getDcEff[defDcN] || getDcEff[(defDcN || '').replace(/\s*\[.*\]\s*$/, '')])?.specialAbilityIds || [];
      const landoPN = atkSIds.includes('shrewd_scoundrel_lando') ? combat.attackerPlayerNum : (defSIds.includes('shrewd_scoundrel_lando') ? opponentPlayerNum(combat.attackerPlayerNum) : null);
      if (landoPN) {
        awardObjectiveVp(game, landoPN, 2);
        await thread.send(`**Shrewd Scoundrel** — Guessed ${guess} Hits, rolled ${hitCount} Hits. **Correct! +2 VP!**`);
        if (checkWinConditions) await checkWinConditions(game, client);
      }
    } else {
      await thread.send(`**Shrewd Scoundrel** — Guessed ${guess} Hits, rolled ${hitCount} Hits. Incorrect.`);
    }
    delete combat.shrewdScoundrelGuess;
  }

  // ── CRR step 4: ATTACKER modifiers (fire BEFORE defender modifiers per CRR p.10
  //    + Destruct: "modifiers stage. Attacker modifiers first, then defender.") ──

  // Pulse Cannon (Iden Versio): if attacker spent a Power Token, apply +4 Accuracy and +1 Hit
  if (combat.attackerSpentPowerToken && !combat.pulseCannonResolved) {
    const _pcDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _pcAtkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _pcAtkEff = _pcDcEff[_pcAtkDcName] || _pcDcEff[(_pcAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_pcAtkEff?.specialAbilityIds || []).includes('pulse_cannon_iden')) {
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 4;
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      await thread.send('**Pulse Cannon** — Iden Versio spent a Power Token: **+4 Accuracy, +1 Hit** applied.');
    }
    combat.pulseCannonResolved = true;
  }

  // Spray Fire (Heavy Stormtrooper Elite): card text "you may apply -3
  // Accuracy and +1 Surge to the attack results." Step-4 attacker
  // modifier; player chooses Apply or Skip.
  if (!combat.sprayFireResolved && combat.attackerFigureKey) {
    const _sfDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _sfAtkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _sfAtkEff = _sfDcEff[_sfAtkDcName] || _sfDcEff[(_sfAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if (hasSprayFireAbility(_sfAtkEff?.specialAbilityIds || [])) {
      combat.pendingCombatPassive = 'spray_fire';
      const _sfRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_sf_apply`).setLabel('Apply (-3 Acc, +1 Surge)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_sf_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({
        content: `**Spray Fire** — **${_sfAtkDcName}** may apply **-3 Accuracy** and **+1 Surge** to this attack:`,
        components: [_sfRow],
      });
      saveGames?.(game.gameId);
      return;
    }
    combat.sprayFireResolved = true;
  }

  // Negotiate (Hondo): +2 Damage unless defender pays 2 VP
  if (!combat.negotiateResolved) {
    const _negDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _negAtkDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const _negAtkEff = _negDcEff[_negAtkDcName] || _negDcEff[(_negAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_negAtkEff?.specialAbilityIds || []).includes('negotiate_hondo')) {
      const _negDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      const _negDefVpKey = _negDefPN === 1 ? 'player1VP' : 'player2VP';
      const _negDefVpTotal = game[_negDefVpKey]?.total ?? 0;
      if (_negDefVpTotal < 2) {
        combat.bonusHits = (combat.bonusHits || 0) + 2;
        combat.negotiateResolved = true;
        await thread.send('**Negotiate** — Defender has fewer than 2 VP; +2 Damage auto-applied.');
      } else {
        const _negDefId = getPlayerId(game, _negDefPN);
        combat.pendingCombatPassive = 'negotiate';
        const _negRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_negotiate_pay`).setLabel('Pay 2 VP (avoid +2 Damage)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_negotiate_accept`).setLabel('Accept +2 Damage').setStyle(ButtonStyle.Danger),
        );
        await thread.send(sanitizeMentions({
          content: `<@${_negDefId}> **Negotiate** — Hondo demands tribute! Pay **2 VP** to avoid +2 Damage, or accept the +2 Damage:`,
          allowedMentions: { users: [_negDefId] },
          components: [_negRow],
        })).catch(discordCatch);
        saveGames?.(game.gameId);
        return;
      }
    }
  }

  // Call the Shots (Hera): while a friendly within 3 is attacking, apply +2 Acc, +1 Hit, or +1 Surge (once/round)
  if (!combat.callTheShotsResolved && combat.attackerFigureKey) {
    const _ctsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const atkPlayerNum = combat.attackerPlayerNum;
    const friendlyFigs = game.figurePositions?.[atkPlayerNum] || {};
    const atkCoord = friendlyFigs[combat.attackerFigureKey];
    const mapSp = getMapData(game.selectedMap?.id);
    let _ctsHeraFk = null;
    if (atkCoord && mapSp) {
      for (const [fk, pos] of Object.entries(friendlyFigs)) {
        if (fk === combat.attackerFigureKey) continue; // "another friendly"
        const fDcName = dcNameFromFigureKey(fk);
        const fEff = _ctsDcEff[fDcName] || _ctsDcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(fEff?.specialAbilityIds || []).includes('call_the_shots_hera')) continue;
        if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkCoord).toLowerCase(), 3)) {
          _ctsHeraFk = fk;
          break;
        }
      }
    }
    if (_ctsHeraFk && !game.roundFigureAbilityUsed?.[`${_ctsHeraFk}_call_the_shots`]) {
      combat.pendingCombatPassive = 'call_the_shots';
      combat.callTheShotsFigKey = _ctsHeraFk;
      const _ctsHeraDcName = dcNameFromFigureKey(_ctsHeraFk);
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_acc`).setLabel('+2 Accuracy').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_hit`).setLabel('+1 Damage').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_surge`).setLabel('+1 Surge').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Call the Shots** (${_ctsHeraDcName}): Apply +2 Accuracy, +1 Damage, or +1 Surge to **${combat.attackerDcName}**'s attack?`,
        components: [new ActionRowBuilder().addComponents(btns)],
      });
      saveGames?.(game.gameId);
      return;
    }
    combat.callTheShotsResolved = true;
  }

  // Heavy Repeater (Paz Vizsla): during ranged attack, suffer 1 Strain for +1 Hit, Blast 2, or +3 Accuracy
  if (!combat.heavyRepeaterResolved) {
    const getDcEffHR = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const hrDcName = dcNameFromFigureKey(combat.attackerFigureKey || '');
    const hrEff = getDcEffHR[hrDcName] || getDcEffHR[hrDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((hrEff?.specialAbilityIds || []).includes('heavy_repeater_paz') && (hrEff?.attack?.type === 'range' || combat.attackType === 'Ranged')) {
      combat.pendingCombatPassive = 'heavy_repeater';
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_hr_hit`).setLabel('+1 Damage (1 Strain)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_hr_blast`).setLabel('Blast 2 (1 Strain)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_hr_acc`).setLabel('+3 Accuracy (1 Strain)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_hr_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Heavy Repeater** — **${hrDcName}** may suffer 1 Strain to apply a bonus:`,
        components: [new ActionRowBuilder().addComponents(btns)],
      });
      saveGames?.(game.gameId);
      return;
    }
    combat.heavyRepeaterResolved = true;
  }

  // Illicit Arms (Bib Fortuna): step-4 attacker modifier — while a friendly
  // figure with Illicit Arms is in the attacker's army, attacker may
  // discard 1 CC from hand to apply +1 Hit to this attack. Limit once per
  // attack. Moved here from attack-declare per alexanbv 2026-05-09.
  if (!combat.illicitArmsResolved && !game.pendingIllicitArms) {
    const _iaDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const friendlyPosIA = game.figurePositions?.[combat.attackerPlayerNum] || {};
    let bibFound = false;
    for (const [fk, pos] of Object.entries(friendlyPosIA)) {
      if (bibFound) break;
      if (!pos) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = _iaDcEff[fkDcName] || _iaDcEff[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (!isIllicitArmsEligibleFigure(fkEff)) continue;
      const bibOwnerHand = getCcHand(game, combat.attackerPlayerNum) || [];
      if (bibOwnerHand.length === 0) {
        combat.illicitArmsResolved = true;
        bibFound = true;
        break;
      }
      const atkOwnerId = getPlayerId(game, combat.attackerPlayerNum);
      setPendingIllicitArms(game, {
        gameId: game.gameId,
        playerNum: combat.attackerPlayerNum,
        bibFigureKey: fk,
        bibDcName: fkDcName,
        combatThreadId: thread.id,
      });
      const iaRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`illicit_arms_use_${game.gameId}`).setLabel('Use Illicit Arms (+1 Damage)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`illicit_arms_skip_${game.gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
      );
      await thread.send(sanitizeMentions({
        content: `<@${atkOwnerId}> **Illicit Arms** (${fkDcName}) — Step 4 modifier: discard 1 Command card to apply **+1 Hit** to this attack?`,
        components: [iaRow],
        allowedMentions: { users: [atkOwnerId] },
      })).catch(discordCatch);
      saveGames?.(game.gameId);
      return;
    }
  }

  // Lasat Honor Guard moved to _enterStep4 per alexanbv 2026-05-11
  // (strictly between reroll buckets and step-4 modifiers). lasatHonorGuardUsed
  // is set there before proceedAfterRerolls runs; this block stays
  // intentionally empty as a marker.

  // ── CRR step 4: DEFENDER modifiers (after attacker modifiers per CRR p.10
  //    + Destruct: "modifiers stage. Attacker modifiers first, then defender.") ──

  // Agile (Jet Trooper E/R): "you may convert 1 Block to 1 Evade" while
  // defending. Per alexanbv 2026-05-11: player-opt-in prompt during the
  // defender modifier window (step-4 defender).
  if (combat.target?.figureKey && !combat.agileJetTrooperApplied) {
    const _agDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _agDefDcName = dcNameFromFigureKey(combat.target.figureKey);
    const _agDefEff = _agDcEff[_agDefDcName] || _agDcEff[(_agDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if (hasAgileAbility(_agDefEff?.specialAbilityIds)) {
      // Only offer if there's a Block to convert (own roll or bonusBlock).
      const _agBlock = (combat.defenseRoll?.block || 0) + (combat.bonusBlock || 0);
      if (_agBlock > 0) {
        combat.pendingCombatPassive = 'agile';
        const _agRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_agile_apply`).setLabel('Apply (Block → Evade)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_agile_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({
          content: `**Agile** — **${_agDefDcName}** may convert 1 Block to 1 Evade:`,
          components: [_agRow],
        });
        saveGames?.(game.gameId);
        return;
      }
      combat.agileJetTrooperApplied = true;
    }
  }

  // Query (HK-47): defender chooses become-Bleeding or accept +1 Damage.
  // Per destruct 2026-05-08. Already-Bleeding defender can still
  // "choose" Bleeding (no-op) to avoid the damage bonus.
  if (combat.queryNeedsPrompt && !combat.queryResolved) {
    const _qDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _qDefId = getPlayerId(game, _qDefPN);
    combat.pendingCombatPassive = 'query';
    const _qBtns = [
      new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_query_bleed`).setLabel('Become Bleeding (avoid +1 Damage)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_query_accept`).setLabel('Accept +1 Damage').setStyle(ButtonStyle.Danger),
    ];
    await thread.send(sanitizeMentions({
      content: `<@${_qDefId}> **Query (HK-47)** — choose: become **Bleeding** (no damage bonus), or accept **+1 Damage** to the attack results.`,
      allowedMentions: { users: [_qDefId] },
      components: [new ActionRowBuilder().addComponents(_qBtns)],
    })).catch(discordCatch);
    saveGames?.(game.gameId);
    return;
  }

  // Line of Fire (Anchorhead B): crateBlockSink — at the modifier step,
  // the defender (a small figure carrying ≥1 crate) may choose 0–3
  // damage to apply to a carried crate; +X Block is added to defense
  // results (Pierce can still bypass). Crate suffers up to its remaining
  // health, never more. Per destruct 2026-05-08.
  if (!combat.crateBlockSinkResolved && combat.target?.figureKey) {
    const _cbsRule = game?.selectedMission?.rules?.persistent?.crateBlockSink;
    const _cbsTargetFk = combat.target.figureKey;
    if (_cbsRule && game.figureContraband?.[_cbsTargetFk]) {
      // Defender size = 1×1 (small)
      const _cbsRawSize = ctx.getFigureSize ? ctx.getFigureSize(dcNameFromFigureKey(_cbsTargetFk)) : null;
      const _cbsSize = game.figureOrientations?.[_cbsTargetFk] || _cbsRawSize;
      const _cbsIsSmall = Array.isArray(_cbsSize) ? (_cbsSize[0] === 1 && _cbsSize[1] === 1) : true;
      if (_cbsIsSmall) {
        // Compute remaining HP across all carried crates
        const _cbsHealthPer = _cbsRule.healthPerCrate || 5;
        const _cbsBlocks = game.lineOfFireCrateBlock?.[_cbsTargetFk] || [];
        const _cbsCarryCnt = typeof game.figureContraband[_cbsTargetFk] === 'number'
          ? game.figureContraband[_cbsTargetFk]
          : 1;
        // Pad blocks array to carry count (lazy init: each new crate = 0 block)
        while (_cbsBlocks.length < _cbsCarryCnt) _cbsBlocks.push(0);
        const _cbsTotalRemainingHp = _cbsBlocks
          .slice(0, _cbsCarryCnt)
          .reduce((sum, b) => sum + Math.max(0, _cbsHealthPer - (b || 0)), 0);
        const _cbsMax = Math.min(_cbsRule.maxBlockPerAttack || 3, _cbsTotalRemainingHp);
        if (_cbsMax > 0) {
          combat.pendingCombatPassive = 'cbs';
          const _cbsDefId = getPlayerId(game, combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
          const _cbsBtns = [];
          for (let _n = 0; _n <= _cbsMax; _n++) {
            _cbsBtns.push(
              new ButtonBuilder()
                .setCustomId(`combat_passive_${game.gameId}_cbs_${_n}`)
                .setLabel(_n === 0 ? 'Skip (0)' : `${_n} dmg → +${_n} Block`)
                .setStyle(_n === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary),
            );
          }
          await thread.send(sanitizeMentions({
            content: `<@${_cbsDefId}> **Line of Fire — Crate Block Sink**: choose 0–${_cbsMax} damage to apply to your carried crate. Each point becomes **+1 Block** to defense results (Pierce still bypasses).`,
            components: [new ActionRowBuilder().addComponents(_cbsBtns.slice(0, 5))],
            allowedMentions: { users: [_cbsDefId] },
          })).catch(discordCatch);
          saveGames?.(game.gameId);
          return;
        }
      }
    }
    combat.crateBlockSinkResolved = true;
  }

  // Defensible (SC2-M): while defending, apply +1 Block or +1 Evade (player chooses)
  if (!combat.defensibleResolved && combat.target?.figureKey) {
    const _defsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _defsDefDcName = dcNameFromFigureKey(combat.target.figureKey);
    const _defsDefEff = _defsDcEff[_defsDefDcName] || _defsDcEff[(_defsDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_defsDefEff?.specialAbilityIds || []).includes('defensible_sc2m')) {
      combat.pendingCombatPassive = 'defensible';
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Defensible** (${_defsDefDcName}): Apply +1 Block or +1 Evade?`,
        components: [new ActionRowBuilder().addComponents(btns)],
      });
      saveGames?.(game.gameId);
      return;
    }
    combat.defensibleResolved = true;
  }

  // Get Down (Onar Koma): while a SMALL figure within 2 is defending, apply +1 Block or +1 Evade (once/round)
  if (!combat.getDownResolved && combat.target?.figureKey) {
    const _gdDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _gdDefDcName = dcNameFromFigureKey(combat.target.figureKey);
    const _gdDefEff = _gdDcEff[_gdDefDcName] || _gdDcEff[(_gdDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    // Defender must be SMALL (no LARGE/MASSIVE keyword)
    const _gdDefKws = (_gdDefEff?.keywords || []).map(k => String(k).toUpperCase());
    const _gdIsSmall = !_gdDefKws.includes('LARGE') && !_gdDefKws.includes('MASSIVE');
    if (_gdIsSmall) {
      const defPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
      const friendlyFigs = game.figurePositions?.[defPlayerNum] || {};
      const defCoord = friendlyFigs[combat.target.figureKey];
      const mapSp = getMapData(game.selectedMap?.id);
      let _gdOnarFk = null;
      if (defCoord && mapSp) {
        // Get Down card text (Onar Koma): "While a small figure within 2
        // spaces is defending..." — note "a" not "another", so Onar IS
        // eligible to use Get Down on himself when he's the defender.
        // Distance 0 from self trivially passes the within-2 check.
        for (const [fk, pos] of Object.entries(friendlyFigs)) {
          const fDcName = dcNameFromFigureKey(fk);
          const fEff = _gdDcEff[fDcName] || _gdDcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
          if (!(fEff?.specialAbilityIds || []).includes('get_down_onar')) continue;
          if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 2)) {
            _gdOnarFk = fk;
            break;
          }
        }
      }
      if (_gdOnarFk && !game.roundFigureAbilityUsed?.[`${_gdOnarFk}_get_down`]) {
        combat.pendingCombatPassive = 'get_down';
        combat.getDownFigKey = _gdOnarFk;
        const _gdOnarDcName = dcNameFromFigureKey(_gdOnarFk);
        const btns = [
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        ];
        await thread.send({
          content: `**Get Down** (${_gdOnarDcName}): Apply +1 Block or +1 Evade to **${_gdDefDcName}**'s defense?`,
          components: [new ActionRowBuilder().addComponents(btns)],
        });
        saveGames?.(game.gameId);
        return;
      }
    }
    combat.getDownResolved = true;
  }

  // Zillo Technique (I51-I52) — discard 1 CC for +1 Block. CRR step 4 result
  // modifier ("Apply Modifiers" stage; defender modifiers fire after attacker
  // modifiers per Destruct). Once-per-attack via combat.zilloDiscardResolved.
  if (!combat.zilloDiscardResolved && combat.target?.figureKey && !combat.target.isNpc) {
    const _ztDefPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _ztDcList = getDcList(game, _ztDefPN) || [];
    const _ztDcMsgIds = getDcMessageIds(game, _ztDefPN) || [];
    let _ztMsgId = null;
    for (let _ztI = 0; _ztI < _ztDcList.length; _ztI++) {
      if (_ztDcList[_ztI]?.dcName === '[Zillo Technique]') { _ztMsgId = _ztDcMsgIds[_ztI] || null; break; }
    }
    if (_ztMsgId) {
      const _ztHandKey = ccHandKey(_ztDefPN);
      const _ztHand = game[_ztHandKey] || [];
      if (_ztHand.length > 0) {
        const _ztDefOwnerId = getPlayerId(game, _ztDefPN);
        // Privacy: post a Yes/No prompt in the combat thread (no card names),
        // then if Yes the defender gets a private card picker in their hand
        // channel. Avoids leaking the defender's hand to the attacker.
        setPendingZilloDiscard(game, { defenderPN: _ztDefPN, combatThreadId: thread.id });
        const _ztYesNoRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`zillo_use_yes_${game.gameId}`)
            .setLabel('Yes — discard 1 CC for +1 Block')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`zillo_discard_skip_${game.gameId}`)
            .setLabel('No — skip')
            .setStyle(ButtonStyle.Secondary),
        );
        await thread.send(sanitizeMentions({
          content: `<@${_ztDefOwnerId}> **Zillo Technique** — Discard 1 Command card for **+1 Block**? (once per attack)`,
          allowedMentions: { users: [_ztDefOwnerId] },
          components: [_ztYesNoRow],
        })).catch(discordCatch);
        saveGames?.(game.gameId);
        return;
      }
    }
    combat.zilloDiscardResolved = true;
  }

  // Elusive (CC): while defending, defender chooses 1 attack die to nullify, then worst defense die also nullified
  if (combat.elusiveActive && !combat.elusiveResolved && combat.attackDiceResults?.length > 0) {
    combat.pendingCombatPassive = 'elusive';
    const atkDice = combat.attackDiceResults;
    const btns = atkDice.map((d, i) =>
      new ButtonBuilder()
        .setCustomId(`combat_passive_${game.gameId}_elusive_${i}`)
        .setLabel(`#${i + 1} ${d.color}: ${d.dmg || 0}H/${d.surge || 0}S/${d.acc || 0}A`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    btns.push(new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_elusive_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
    const rows = chunkButtonsToRows(btns);
    const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const defenderId = game[`player${defenderPlayerNum}Id`] ?? '';
    await thread.send({
      content: `**Elusive** — <@${defenderId}> choose an attack die to nullify (its results will be removed). One defense die will also be nullified.`,
      components: rows,
    });
    saveGames?.(game.gameId);
    return;
  }

  const defRoll = combat.defenseRoll;

  // Defensive Stance (Diala Passil): if a Dodge is rolled while defending, convert it to +2 Block, +1 Evade
  if (defRoll.dodge && combat.target?.figureKey) {
    const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const defDcName = dcNameFromFigureKey(combat.target.figureKey);
    const defEff = getDcEff[defDcName] || getDcEff[defDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((defEff?.specialAbilityIds || []).includes('defensive_stance')) {
      combat.defenseRoll = { block: (defRoll.block || 0) + 2, evade: (defRoll.evade || 0) + 1, dodge: false };
      await thread.send('**Defensive Stance** — Dodge converted to +2 Block, +1 Evade.');
    }
  }

  // Soresu Form (Kanan Jarrus): if Kanan granted a reroll (soresuFormFigKey set) and a Dodge result remains, convert it
  if (combat.soresuFormFigKey && combat.defenseRoll.dodge && combat.target?.figureKey) {
    const sr = combat.defenseRoll;
    combat.defenseRoll = { block: (sr.block || 0) + 2, evade: (sr.evade || 0) + 1, dodge: false };
    const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const defDcName = dcNameFromFigureKey(combat.target.figureKey);
    const defEff = getDcEff[defDcName] || getDcEff[defDcName?.replace(/\s*\[.*\]\s*$/, '')];
    const allKws = [...(defEff?.keywords || []), ...(defEff?.traits || [])].map((k) => String(k).toUpperCase());
    const isFORCE_USER = allKws.includes('FORCE USER');
    const kananPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const strainNote = isFORCE_USER ? '' : ' Kanan suffers 1 Strain.';
    await thread.send(`**Soresu Form** — Dodge converted to +2 Block, +1 Evade.${strainNote}`);
    if (!isFORCE_USER) {
      // Routed through applyStrain so Kanan's controller gets the per-strain
      // choice prompt + UD pre-prompt fires.
      await applyStrain(game, ctx, {
        figureKey: combat.soresuFormFigKey,
        controllerPlayerNum: kananPlayerNum,
        amount: 1,
        source: 'Soresu Form',
      });
    }
    combat.soresuFormFigKey = null;
  }

  // Lucky (R2-D2): while defending, if Dodge rolled, recover 2 damage
  if (combat.defenseRoll.dodge && combat.target?.figureKey) {
    const _luckyDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _luckyDefDcName = dcNameFromFigureKey(combat.target.figureKey);
    const _luckyDefEff = _luckyDcEff[_luckyDefDcName] || _luckyDcEff[(_luckyDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_luckyDefEff?.specialAbilityIds || []).includes('lucky_r2d2') && ctx.dcHealthState) {
      const _luckyFkMatch = combat.target.figureKey.match(/^(.+)-(\d+)-(\d+)$/);
      if (_luckyFkMatch) {
        const targetMsgId = combat.target.msgId;
        if (targetMsgId) {
          const _luckyFi = parseInt(_luckyFkMatch[3], 10);
          const _luckyDefPn = combat.target.playerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
          const { healed: _luckyHealed, newHp: _lNew } = healHp(ctx.dcHealthState, game, targetMsgId, _luckyFi, 2, _luckyDefPn);
          if (_luckyHealed > 0) {
            const _lPrev = _lNew - _luckyHealed;
            await thread.send(`🍀 **Lucky** — R2-D2 rolled a Dodge! Recovered 2 damage (HP: ${_lPrev}→${_lNew}).`);
          }
        }
      }
    }
  }

  // Dodge check (now AFTER rerolls and Defensive Stance conversion)
  if (combat.defenseRoll.dodge) {
    await thread.send('**DODGE!** The attack misses — all damage and effects negated.');
    await sendReadyToResolveRolls(thread, game.gameId, game, ctx);
    return;
  }

  // Power-token phase already ran pre-roll (see proceedToTokenPhase); fall through.
  await proceedAfterTokens(thread, game, combat, ctx);
}

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
    const mp = game.movementBank?.[atkMsgId]?.remaining ?? 0;
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
  const defPN = opponentPlayerNum(atkPN);
  const atkOwnerId = getPlayerId(game, atkPN);
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
  const surgeBonus = (combat.surgeBonus || 0) + (game.roundAttackSurgeBonus?.[attackerPlayerNum] || 0) + perDefDieSurge + furyBonus;
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
  const rawSurge = Math.max(0, roll.surge + surgeBonus + (combat.tokenSurgeBonus || 0) - _weakenSurgePenalty + _hiddenSurgeBonus);
  const roundEvade = game.roundDefenseBonusEvade?.[defPlayerNum] || 0;
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
    // Rogue One: discard a power token from a friendly figure for +1 Hit
    surgeRows.push(..._rogueOneBtns);
    surgeRows.push(
      new ButtonBuilder()
        .setCustomId(`combat_surge_${game.gameId}_done`)
        .setLabel('Done (no more surge)')
        .setStyle(ButtonStyle.Primary)
    );
    const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
    const roundSurge = game.roundAttackSurgeBonus?.[attackerPlayerNum] || 0;
    const ccSurge = (combat.surgeBonus || 0);
    const surgeDisplay = (ccSurge > 0 || roundSurge > 0 || furyBonus > 0)
      ? `${roll.surge}${ccSurge ? ` + ${ccSurge} (CC)` : ''}${roundSurge ? ` + ${roundSurge} (round)` : ''}${furyBonus ? ` + ${furyBonus} (Fury)` : ''} = **${totalSurge}**`
      : `**${totalSurge}**`;
    // @ the attacker so they get a notification when surge spending opens.
    const _surgeAtkPN = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
    const _surgeAtkOwnerId = getPlayerId(game, _surgeAtkPN);
    await thread.send({
      content: `<@${_surgeAtkOwnerId}> — **Spend surge?** You have ${surgeDisplay} surge. Choose an ability or Done.`,
      components: [surgeRow],
      allowedMentions: { users: [_surgeAtkOwnerId].filter(Boolean) },
    });
    return;
  }
  await sendReadyToResolveRolls(thread, game.gameId, game, ctx);
}

/**
 * F10: Confirm rolls then resolve. Call resolveCombatAfterRolls when user clicks "Ready to resolve rolls".
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client
 */
export async function handleCombatResolveReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client } = ctx;
  const gameId = parseCustomId(interaction.customId, 'combat_resolve_ready_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !await requirePlayer(interaction, game, interaction.user.id, 2, canActAsPlayer, 'Only players in this game can confirm.')) return;
  await resolveCombatAfterRolls(game, combat, client);
  saveGames(game.gameId);
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
  if (!combat || combat.gameId !== gameId || (choice !== 'rogue_one' && !combat.surgeRemaining)) {
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
      if (mod.replaceWithStun) combat.attackResultReplaceWithStun = true;
      if (mod.surgeCancelDodge) combat.surgeCancelDodge = true;
      if (mod.surgeHarass) combat.surgeHarass = (combat.surgeHarass || 0) + mod.surgeHarass;
      if (mod.surgeSquadCommand) combat.surgeSquadCommand = true;
      if (mod.surgeStalkPrey) combat.surgeStalkPrey = true;
      if (mod.surgeCriticalHit) {
        combat.surgeCriticalHit = true;
        // Per user 2026-05-09: Critical Hit is a surge that's not a
        // keyword — it applies IMMEDIATELY when the surge is spent
        // (during surge-spend phase), not in step 7 or step 8.
        // Sets the per-round CC-block flag for the defender.
        game.criticalHitBlockedPlayer = combat.defenderPlayerNum;
        await thread.send(`\u{1F3AF} **Critical Hit** — Defender's Command cards are blocked for the rest of this round.`).catch(discordCatch);
      }
      if (mod.surgeSuppressionStrain) combat.surgeSuppressionStrain = true;
      if (mod.surgeFightingKnife) combat.surgeFightingKnife = true;
      if (mod.surgeConcussiveBolt) combat.surgeConcussiveBolt = true;
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
    // Rogue One: discard a power token from a friendly figure for +1 Hit
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
  // Visual feedback: highlight the clicked button green, disable all others.
  // Matches the Extra Armor color-toggle pattern.
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
    // Track defender modifications for Quick Strike (Electrostaff loadout)
    if (combat.pendingWildRole === 'defender') combat.defenderRerolledOrModified = true;
    // Track Block spending for Mandalorian Steel / Personal Combat Shield
    if (combat.pendingWildRole === 'defender' && resolvedType === 'Block') {
      combat.defenderSpentBlock = true;
      const _pcsWDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const _pcsWDefDcName = dcNameFromFigureKey(combat.target?.figureKey || '');
      const _pcsWDefEff = _pcsWDcEff[_pcsWDefDcName] || _pcsWDcEff[(_pcsWDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      if ((_pcsWDefEff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
        combat.bonusEvade = (combat.bonusEvade || 0) + 1;
        await thread.send('**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.');
      }
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
    if (!isAttacker) combat.defenderRerolledOrModified = true;
    if (!isAttacker && scTokenType === 'Block') combat.defenderSpentBlock = true;
    if (!isAttacker && scTokenType === 'Block') {
      const _pcsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const _pcsDefDcName = dcNameFromFigureKey(combat.target?.figureKey || '');
      const _pcsDefEff = _pcsDcEff[_pcsDefDcName] || _pcsDcEff[(_pcsDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      if ((_pcsDefEff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
        combat.bonusEvade = (combat.bonusEvade || 0) + 1;
        await thread.send('**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.');
      }
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
  // Track defender modifications for Quick Strike (Electrostaff loadout)
  if (!isAttacker) combat.defenderRerolledOrModified = true;
  // Track Block token spending for Mandalorian Steel
  if (!isAttacker && tokenType === 'Block') combat.defenderSpentBlock = true;
  // Personal Combat Shield (Gar Saxon): when spending a Block token while defending, +1 Evade
  if (!isAttacker && tokenType === 'Block') {
    const _pcsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _pcsDefDcName = dcNameFromFigureKey(combat.target?.figureKey || '');
    const _pcsDefEff = _pcsDcEff[_pcsDefDcName] || _pcsDcEff[(_pcsDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_pcsDefEff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.');
    }
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

  // Add +1 Hit to the attack
  combat.bonusHits = (combat.bonusHits || 0) + 1;
  combat.rogueOneHitsGained = (combat.rogueOneHitsGained || 0) + 1;
  await thread.send(`**Rogue One** — Discarded **${tokenType}** token from **${donorDcName}** → **+1 Hit**.`).catch(discordCatch);

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
  const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
  // @ the attacker so they get a notification when surge spending opens.
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const atkOwnerId = atkPlayerNum === 1 ? game.player1Id : game.player2Id;
  await thread.send({
    content: `<@${atkOwnerId}> — **Spend surge?** You have **${remaining}** surge left. Choose an ability or Done.`,
    components: [surgeRow],
    allowedMentions: { users: [atkOwnerId] },
  }).catch(discordCatch);
}

/**
 * Handle Figurehead ability decision (use or skip).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - combat context
 */
export async function handleFigureheadDecision(interaction, ctx) {
  const { getGame, client, saveGames, applyDamageAndFinishCombat, isDcUnique, getCelebrationButtons, dcHealthState, logGameAction, getDcStats, getDcEffects, processFigureDefeat: ctxProcessFigureDefeat } = ctx;
  const isUse = interaction.customId.startsWith('figurehead_use_');
  const gameId = parseCustomId(interaction.customId, isUse ? 'figurehead_use_' : 'figurehead_skip_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  await interaction.deferUpdate().catch(discordCatch);
  const pending = game.pendingFigurehead;
  if (!pending) {
    await interaction.followUp({ content: 'No pending Figurehead decision.', ephemeral: true }).catch(discordCatch);
    return;
  }
  clearPendingFigurehead(game);
  const combat = game.pendingCombat;
  if (!combat) {
    await interaction.followUp({ content: 'Combat data missing.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex, fhFigKey, fhMsgId, fhFigIndex, fhLabel } = pending;
  const thread = await fetchCombatThread(client, combat.combatThreadId);

  if (isUse) {
    const fhDamage = Math.max(0, damage - 1);
    let fhResultText = '';
    if (fhMsgId && fhFigKey && dcHealthState) {
      const _fhRes = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
        figureKey: fhFigKey, msgId: fhMsgId, figIndex: fhFigIndex,
        amount: fhDamage, controllerPlayerNum: defenderPlayerNum,
        attackerPlayerNum, source: 'Figurehead',
      });
      const fhNew = _fhRes.newHp;
      const fhPrev = _fhRes.prevHp;
      const fhMaxHp = dcHealthState.get(fhMsgId)?.[fhFigIndex]?.[1] ?? 0;
      if (fhMaxHp > 0) {
        fhResultText = `**Figurehead** — ${fhLabel || 'Murne Rin'} suffers **${fhDamage} damage** (${fhPrev} — ${fhNew} HP); ${combat.target.label} suffers 0.`;
        if (fhNew <= 0) {
          // Murne Rin defeated — centralized defeat pipeline
          const fhDcName = dcNameFromFigureKey(fhFigKey);
          if (ctxProcessFigureDefeat) {
            const defeatResult = await ctxProcessFigureDefeat(game, {
              defeatedPlayerNum: defenderPlayerNum,
              figureKey: fhFigKey,
              attackerPlayerNum,
              msgId: fhMsgId,
              dcName: fhDcName,
              displayName: fhLabel || fhDcName,
              source: 'Figurehead',
            });
            fhResultText += ` — **${fhLabel || 'Murne Rin'} defeated!** +${defeatResult?.vp ?? 0} VP`;
          }
          // Post-defeat: Celebration (unique figure defeated → offer Celebration CC play)
          const fhAtkerOwnerId = getPlayerId(game, attackerPlayerNum);
          if (!game.pendingCelebration && isDcUnique?.(fhDcName)) {
            setPendingCelebration(game, { attackerPlayerNum, combatThreadId: combat.combatThreadId });
            await thread.send(sanitizeMentions({
              content: `<@${fhAtkerOwnerId}> — You defeated a unique figure (Figurehead). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [fhAtkerOwnerId] },
            })).catch(discordCatch);
          }
        }
      }
    }
    if (fhResultText) await thread.send(fhResultText);
    await applyDamageAndFinishCombat(game, combat, { damage: 0, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client);
  } else {
    await thread.send('**Figurehead** skipped.');
    await applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client);
  }
  if (isUse && fhMsgId && ctx.updateAttachmentMessageForDc) {
    await ctx.updateAttachmentMessageForDc(game, defenderPlayerNum, fhMsgId, client).catch(discordCatch);
  }
  await interaction.editReply({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

// ─── Lasat Honor Guard helpers ────────────────────────────────────────────────

/** Send die picker for Lasat Honor Guard (multiple eligible dice). */
async function sendLasatDiePicker(thread, gameId, combat, eligibleIdxs, ctx) {
  const attackerPN = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const ownerId = ctx?.getGame ? (() => { const g = ctx.getGame(gameId); return g?.[`player${attackerPN}Id`]; })() : null;
  const mention = ownerId ? `<@${ownerId}> ` : '';
  const buttons = eligibleIdxs.map((idx) => {
    const die = combat.attackDiceResults[idx];
    const face = `${die.acc || 0}a/${die.dmg || 0}d/${die.surge || 0}s`;
    return new ButtonBuilder()
      .setCustomId(`lasat_die_${gameId}_${idx}`)
      .setLabel(`${(die.color || 'die').charAt(0).toUpperCase() + (die.color || 'die').slice(1)} [${face}]`)
      .setStyle(ButtonStyle.Secondary);
  });
  // Per card text "you may turn 1 die" — optional. Add a Skip button so
  // the attacker can decline without forcing a die turn.
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`lasat_die_${gameId}_skip`)
      .setLabel('Skip Lasat Honor Guard')
      .setStyle(ButtonStyle.Primary)
  );
  const rows = buildActionRows(buttons);
  const content = `${mention}**Lasat Honor Guard** — Step 3→4 window: you may turn 1 attack die showing only a single Damage or Surge symbol to any other side. Accuracy numbers do not count as symbols.`;
  await thread.send({
    content,
    components: rows,
    ...(ownerId ? { allowedMentions: { users: [ownerId] } } : {}),
  });
}

/** Send face picker for Lasat Honor Guard (player selects new face). */
async function sendLasatFacePicker(thread, gameId, combat, dieIdx, ctx) {
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) {
    await thread.send('**Lasat Honor Guard** — Dice data unavailable; ability skipped.');
    return;
  }
  const die = combat.attackDiceResults[dieIdx];
  const faces = getDiceData().attack?.[die.color] || [];
  const currentKey = `${die.acc || 0}/${die.dmg || 0}/${die.surge || 0}`;
  const otherFaces = faces
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => `${f.acc || 0}/${f.dmg || 0}/${f.surge || 0}` !== currentKey);
  if (otherFaces.length === 0) {
    await thread.send('**Lasat Honor Guard** — No other faces available; ability skipped.');
    return;
  }
  const buttons = otherFaces.map(({ f, i }) =>
    new ButtonBuilder()
      .setCustomId(`lasat_face_${gameId}_${dieIdx}_${i}`)
      .setLabel(`${f.acc || 0}a/${f.dmg || 0}d/${f.surge || 0}s`)
      .setStyle(ButtonStyle.Primary)
  );
  const rows = buildActionRows(buttons.slice(0, 25));
  await thread.send({ content: `**Lasat Honor Guard** — Turn die ${dieIdx + 1} (${die.color || '?'}) to:`, components: rows });
}

/**
 * Send a face picker for Much to Learn (turn mode): no restriction on
 * which face to turn to (per alexanbv 2026-05-11 — strictly stronger
 * than Lasat's "1 attack icon only" restriction).
 */
async function sendMtlFacePicker(thread, gameId, combat, dieIdx, ctx) {
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) {
    await thread.send('**Much to Learn** — Dice data unavailable; ability skipped.');
    return;
  }
  const die = combat.attackDiceResults[dieIdx];
  const faces = getDiceData().attack?.[die.color] || [];
  if (faces.length === 0) {
    await thread.send('**Much to Learn** — No faces for this die color; ability skipped.');
    return;
  }
  const buttons = faces.map((f, i) =>
    new ButtonBuilder()
      .setCustomId(`mtl_face_${gameId}_${dieIdx}_${i}`)
      .setLabel(`${f.acc || 0}a/${f.dmg || 0}d/${f.surge || 0}s`)
      .setStyle(ButtonStyle.Primary)
  );
  const rows = buildActionRows(buttons.slice(0, 25));
  await thread.send({ content: `**Much to Learn (turn)** — Turn die ${dieIdx + 1} (${die.color || '?'}) to:`, components: rows });
}

/**
 * mtl_face_{gameId}_{dieIdx}_{faceIdx} click: apply the chosen face to
 * the attack die. Consume the Much to Learn queue entry, drop it, and
 * re-render the attacker reroll bucket.
 */
export async function handleMtlFacePick(interaction, ctx) {
  const m = interaction.customId.match(/^mtl_face_([^_]+)_(\d+)_(\d+)$/);
  if (!m) return;
  const [, gameId, dieIdxStr, faceIdxStr] = m;
  const dieIdx = parseInt(dieIdxStr, 10);
  const faceIdx = parseInt(faceIdxStr, 10);
  const { getGame, replyIfGameEnded, saveGames, getDiceData, recalcAttackTotals } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.mtlTurnPhase) {
    await interaction.followUp({ content: 'No Much to Learn turn pending.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttacker, canActAsPlayer, 'Only the attacker may choose.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  const dice = combat.attackDiceResults || [];
  const die = dice[dieIdx];
  if (!die) {
    await interaction.followUp({ content: 'That die no longer exists.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const faces = getDiceData?.()?.attack?.[die.color] || [];
  const newFace = faces[faceIdx];
  if (!newFace) {
    await interaction.followUp({ content: 'That face is invalid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const oldDieDesc = `${die.acc || 0}a/${die.dmg || 0}d/${die.surge || 0}s`;
  dice[dieIdx] = { ...die, acc: newFace.acc || 0, dmg: newFace.dmg || 0, surge: newFace.surge || 0 };
  const totals = recalcAttackTotals(dice);
  combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
  combat.attackDiceResults = dice;
  // Mark this die as touched (G12 — prevents future rerolls).
  combat.attackerRerolledIndices = combat.attackerRerolledIndices || [];
  if (!combat.attackerRerolledIndices.includes(dieIdx)) combat.attackerRerolledIndices.push(dieIdx);
  // Drop the Much to Learn queue entry now that turn resolved.
  const entry = combat.forcedRerollQueue?.[combat.mtlTurnQueueIdx];
  if (entry) {
    combat.forcedRerollQueue.splice(combat.mtlTurnQueueIdx, 1);
  }
  combat.mtlTurnPhase = false;
  combat.mtlTurnQueueIdx = null;
  combat.mtlTurnDieIdx = null;
  if (thread) {
    await thread.send(`**Much to Learn (turn)** — ATK ${die.color} #${dieIdx + 1}: ${oldDieDesc} → **${newFace.acc || 0}a/${newFace.dmg || 0}d/${newFace.surge || 0}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`).catch(discordCatch);
    await sendRerollUI(thread, game, combat, combat.rerollPhase || 'attacker');
  }
  if (saveGames) saveGames(game.gameId);
}

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
  game.forcedAttackTarget = game.forcedAttackTarget || {};
  game.forcedAttackTarget[friendlyMsgId] = capturedTarget;
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
    const mp = game.movementBank?.[combat.attackerMsgId]?.remaining ?? 0;
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
    const bank = game.movementBank?.[combat.attackerMsgId];
    if (bank) bank.remaining = Math.max(0, (bank.remaining || 0) - 2);
  }
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  const label = kind === 'v' ? 'Vanguard' : 'EE-3 Carbine';
  const costSuffix = kind === 'e' ? ' (-2 MP)' : '';
  await interaction.message.channel.send(`**${label}** — ${choice[0].toUpperCase() + choice.slice(1)} → Red${costSuffix}.`).catch(discordCatch);
  if (saveGames) saveGames(game.gameId);
}

/**
 * Handle lasat_die_ button: player selects which eligible die to turn.
 * customId: lasat_die_{gameId}_{dieIdx}
 */
export async function handleLasatDiePick(interaction, ctx) {
  // customId: lasat_die_{gameId}_{dieIdx|skip}
  const skipMatch = interaction.customId.match(/^lasat_die_([^_]+)_skip$/);
  const dieMatch = interaction.customId.match(/^lasat_die_([^_]+)_(\d+)$/);
  if (!skipMatch && !dieMatch) return;
  const gameId = (skipMatch || dieMatch)[1];
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat die choice active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttacker, canActAsPlayer, 'Only the attacker may choose.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (skipMatch) {
    combat.lasatHonorGuardPhase = false;
    if (thread) await thread.send('**Lasat Honor Guard** — Skipped.').catch(discordCatch);
    // Resume the modifier step now that Lasat is decided.
    await _resumeAttackerModifiersAfterLasat(thread, game, combat, ctx);
    saveGames(game.gameId);
    return;
  }
  const dieIdx = parseInt(dieMatch[2], 10);
  if (!(combat.lasatEligibleDiceIndices || []).includes(dieIdx)) {
    await interaction.followUp({ content: 'That die is not eligible.', ephemeral: true }).catch(discordCatch);
    return;
  }
  combat.lasatChosenDieIndex = dieIdx;
  if (thread) await sendLasatFacePicker(thread, gameId, combat, dieIdx, ctx);
  saveGames(game.gameId);
}

/**
 * Resume combat after Lasat Honor Guard is skipped or committed.
 * Re-enters proceedAfterRerolls — the canonical entry point for the
 * attacker modifier step, matching the resume path used by
 * handleLasatFacePick.
 */
async function _resumeAttackerModifiersAfterLasat(thread, game, combat, ctx) {
  combat.lasatHonorGuardPhase = false;
  combat.lasatEligibleDiceIndices = null;
  combat.lasatChosenDieIndex = null;
  // Post-Lasat (per alexanbv 2026-05-11): Lasat fires strictly between
  // reroll buckets and step-4 modifiers. After it resolves, advance into
  // the step-4 modifier window the same way _enterStep4 does normally.
  if (!thread) return;
  if (game.selfPlay) {
    combat.currentStep = 'step5';
    if (typeof proceedAfterRerolls === 'function') {
      await proceedAfterRerolls(thread, game, combat, ctx).catch((err) => console.error('Lasat resume failed:', err));
    }
  } else {
    combat.currentStep = 'step4-attacker';
    await sendModsYn(thread, game, combat, 'attacker').catch((err) => console.error('Lasat resume failed:', err));
  }
}

/**
 * Handle lasat_face_ button: player selects the new face for the chosen die.
 * customId: lasat_face_{gameId}_{dieIdx}_{faceIdx}
 */
export async function handleLasatFacePick(interaction, ctx) {
  const m = interaction.customId.match(/^lasat_face_([^_]+)_(\d+)_(\d+)$/);
  if (!m) return;
  const [, gameId, dieIdxStr, faceIdxStr] = m;
  const dieIdx = parseInt(dieIdxStr, 10);
  const faceIdx = parseInt(faceIdxStr, 10);
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat face choice active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, effectiveAttacker, canActAsPlayer, 'Only the attacker may choose.')) return;
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) { await interaction.followUp({ content: 'Dice data unavailable.', ephemeral: true }).catch(discordCatch); return; }
  const die = combat.attackDiceResults?.[dieIdx];
  if (!die) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(discordCatch); return; }
  const faces = getDiceData().attack?.[die.color] || [];
  const newFace = faces[faceIdx];
  if (!newFace) { await interaction.followUp({ content: 'Invalid face selection.', ephemeral: true }).catch(discordCatch); return; }
  // Subtract old face contribution, add new face values
  combat.attackRoll.acc = Math.max(0, (combat.attackRoll.acc || 0) - (die.acc || 0)) + (newFace.acc || 0);
  combat.attackRoll.dmg = Math.max(0, (combat.attackRoll.dmg || 0) - (die.dmg || 0)) + (newFace.dmg || 0);
  combat.attackRoll.surge = Math.max(0, (combat.attackRoll.surge || 0) - (die.surge || 0)) + (newFace.surge || 0);
  combat.attackDiceResults[dieIdx] = { ...die, acc: newFace.acc || 0, dmg: newFace.dmg || 0, surge: newFace.surge || 0 };
  combat.lasatHonorGuardPhase = false;
  await interaction.deferUpdate().catch(discordCatch);
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  await thread.send(`**Lasat Honor Guard** — Turned die to ${newFace.acc || 0}a/${newFace.dmg || 0}d/${newFace.surge || 0}s. New total: ${combat.attackRoll.acc}a/${combat.attackRoll.dmg}d/${combat.attackRoll.surge}s.`);
  await proceedAfterRerolls(thread, game, combat, ctx);
  saveGames(game.gameId);
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
  const targets = game.falseOrdersAttackTargets?.[msgId];
  const target = targets?.[targetIdx];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  delete game.falseOrdersAttackTargets?.[msgId];
  clearPendingFalseOrders(game);
  const controlledName = dcNameFromFigureKey(controlledFigureKey);
  const controlledStats = getDcStats(controlledName);
  const attackInfo = controlledStats?.attack || { dice: ['red'], range: [1, 3] };
  const targetDcName = dcNameFromFigureKey(target.figureKey);
  const targetStats = getDcStats(targetDcName);
  const targetEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName?.replace(/\s*\[.*\]\s*$/, '')];
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
  const controlledEff = getDcEffects()[controlledName] || getDcEffects()[controlledName?.replace(/\s*\[.*\]\s*$/, '')];
  const defEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName?.replace(/\s*\[.*\]\s*$/, '')];
  applyDcPassivesToCombat(game.pendingCombat, controlledStats?.passives || [], targetStats?.passives || []);
  const abilityLabel = fo.isLure ? 'Lure of the Dark Side' : 'False Orders';
  await interaction.message.edit({ content: `**${abilityLabel} — Attack declared**. See thread in Game Log.`, components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `⚔️ **${abilityLabel}** — **${controllerUserName}** controlling **${controlledName}** attacks **${targetDcName}**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  // Per destruct 2026-05-08: tokens are merged into the on_declare
  // per-player window. Even for False Orders / Lure attacks, the
  // controller (acting as attacker) and the target's owner each get
  // a window for cards + tokens. Post the gate + attacker token
  // window; defender token window posts on the gate transition.
  await sendCombatGate(thread, game, game.pendingCombat, 'on_declare', ctx);
  await sendOnDeclareTokenWindow(thread, game, game.pendingCombat, 'attacker', ctx);
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

/** Guidance Systems (Mortar Trooper): apply -1 Hit, +2 Accuracy. May be used multiple times. */
export async function handleGuidanceSystems(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const parts = splitCustomId(interaction.customId, 'guidance_systems_');
  const gameId = parts[0];
  const action = parts[1]; // 'use' or 'done'
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  if (action === 'use') {
    combat.attackRoll.dmg = Math.max(0, (combat.attackRoll.dmg || 0) - 1);
    combat.attackRoll.acc = (combat.attackRoll.acc || 0) + 2;
    combat.guidanceSystemsCount = (combat.guidanceSystemsCount || 0) + 1;
    const gsCount = combat.guidanceSystemsCount;
    const _gsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`guidance_systems_${gameId}_use`).setLabel('Use again (-1 Damage, +2 Acc)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`guidance_systems_${gameId}_done`).setLabel('Done').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.edit({
      content: `**Guidance Systems** — Applied ${gsCount}x (-${gsCount} Hit, +${gsCount * 2} Acc). Current: ${combat.attackRoll.acc} acc, ${combat.attackRoll.dmg} dmg, ${combat.attackRoll.surge} surge. Use again?`,
      components: [_gsRow],
    }).catch(discordCatch);
    saveGames(game.gameId);
  } else {
    // Done — mark complete and advance to next modifier check
    // (post-2026-05-04 migration: Guidance Systems is a CRR step-4
    // modifier; sendModsYn for attacker will fall through to the
    // mods_yn YES/NO now that this ability is resolved).
    combat.guidanceSystemsCompleted = true;
    const gsCount = combat.guidanceSystemsCount || 0;
    await interaction.message.edit({
      content: `**Guidance Systems** — Applied ${gsCount}x. Final attack: ${combat.attackRoll.acc} acc, ${combat.attackRoll.dmg} dmg, ${combat.attackRoll.surge} surge.`,
      components: [],
    }).catch(discordCatch);
    if (thread) await sendModsYn(thread, game, combat, 'attacker');
    saveGames(game.gameId);
  }
}

/**
 * Zillo Technique exhaust prompt: offer the defender the chance to cancel
 * 2 Pierce by exhausting their Zillo Technique skirmish upgrade card.
 *
 * Timing: between step-5 surge spending and step-7 damage calc — i.e. once
 * the attacker's total Pierce is finalized. Per CRR step-4 + Destruct's
 * read: "exhaust for Zillo has a special timing window here, to cancel 2
 * pierce, after attacker decides whether or not to surge for pierce".
 *
 * Returns true if the prompt was sent (caller must defer the resolve gate
 * until handleZilloPierceCancel re-enters sendReadyToResolveRolls). Returns
 * false when no prompt fires (no Zillo, already exhausted, or no pierce to
 * cancel) — caller continues normally.
 */
async function maybePromptZilloPierceCancel(thread, game, ctx) {
  const combat = game?.pendingCombat;
  if (!combat) return false;
  if (combat.zilloPierceCancelPrompted) return false; // once per attack
  if (combat.target?.isNpc) return false;
  const defPN = combat.defenderPlayerNum;
  if (!defPN) return false;
  // Only offer when there's pierce worth cancelling.
  const totalPierce = (combat.bonusPierce || 0)
    + (combat.surgePierce || 0)
    + (combat.attackInfo?.pierce || 0)
    - (combat.defenderReducePierce || 0);
  if (totalPierce <= 0) return false;
  // Locate Zillo Technique card on defender's side and check exhaust state.
  const dcList = getDcList(game, defPN) || [];
  const dcMsgIds = getDcMessageIds(game, defPN) || [];
  let ztMsgId = null;
  for (let i = 0; i < dcList.length; i++) {
    if (dcList[i]?.dcName === '[Zillo Technique]') { ztMsgId = dcMsgIds[i] || null; break; }
  }
  if (!ztMsgId) return false;
  const exh = game.exhaustedSkirmishUpgrades?.[ztMsgId] || [];
  if (cardNameIncludes(exh, 'Zillo Technique')) return false;
  const depleted = (game.p1DepletedDcMessageIds || []).includes(ztMsgId)
    || (game.p2DepletedDcMessageIds || []).includes(ztMsgId);
  if (depleted) return false;
  combat.zilloPierceCancelPrompted = true;
  combat.zilloPierceCancelMsgId = ztMsgId;
  const defOwnerId = getPlayerId(game, defPN);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`zillo_pierce_use_${game.gameId}`).setLabel('Exhaust Zillo: cancel 2 Pierce').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`zillo_pierce_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  await thread.send(sanitizeMentions({
    content: `<@${defOwnerId}> **Zillo Technique** — Attacker has **${totalPierce}** Pierce. Exhaust **Zillo Technique** to reduce Pierce by 2 (min 0)?`,
    allowedMentions: { users: [defOwnerId] },
    components: [row],
  })).catch(discordCatch);
  if (ctx?.saveGames) ctx.saveGames(game.gameId);
  return true;
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
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      const exh = game.exhaustedSkirmishUpgrades[ztMsgId] || [];
      game.exhaustedSkirmishUpgrades[ztMsgId] = [...exh, 'Zillo Technique'];
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

/**
 * Zillo Technique — defender clicked "Yes". Hide the combat-thread prompt
 * and post the actual CC picker in the defender's PRIVATE hand channel,
 * so card names stay invisible to the attacker. Picking a card flows
 * back through handleZilloDiscard which applies the discard + +1 Block.
 */
export async function handleZilloUseYes(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const parts = splitCustomId(interaction.customId, 'zillo_use_yes_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingZilloDiscard;
  if (!pending) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }
  const defPN = pending.defenderPN;
  const defOwnerId = getPlayerId(game, defPN);
  if (interaction.user.id !== defOwnerId) {
    await interaction.followUp({ content: 'Only the defender can choose to use Zillo Technique.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const handChannelId = defPN === 1 ? game.p1HandId : game.p2HandId;
  const handKey = ccHandKey(defPN);
  const hand = game[handKey] || [];
  if (hand.length === 0 || !handChannelId) {
    await interaction.message.edit({ content: '**Zillo Technique** — No cards in hand to discard.', components: [] }).catch(discordCatch);
    return;
  }
  // Replace combat-thread prompt with a "choosing..." note so the attacker
  // knows what's happening without seeing card names.
  await interaction.message.edit({
    content: `**Zillo Technique** — Defender is choosing a card to discard...`,
    components: [],
  }).catch(discordCatch);
  // Private picker in the defender's hand channel.
  try {
    const handCh = await fetchGameChannel(client, handChannelId);
    const btns = hand.slice(0, 20).map((c, i) =>
      new ButtonBuilder()
        .setCustomId(`zillo_discard_${gameId}_${defPN}_${i}`)
        .setLabel(String(c).slice(0, 80))
        .setStyle(ButtonStyle.Danger),
    );
    btns.push(new ButtonBuilder().setCustomId(`zillo_discard_skip_${gameId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    const rows = [];
    for (let r = 0; r < btns.length; r += 5) rows.push(new ActionRowBuilder().addComponents(btns.slice(r, r + 5)));
    await handCh.send({
      content: `🛡️ **Zillo Technique** — pick a Command Card to discard for +1 Block:`,
      components: rows.slice(0, 5),
    }).catch(discordCatch);
  } catch (err) {
    console.error('Zillo Technique private picker failed:', err);
  }
  saveGames(game.gameId);
}

/**
 * Zillo Technique: defender discards a CC from hand for +1 Block, or skips.
 */
export async function handleZilloDiscard(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isSkip = interaction.customId.startsWith('zillo_discard_skip_');
  const parts = splitCustomId(interaction.customId, isSkip ? 'zillo_discard_skip_' : 'zillo_discard_');
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  const pending = game.pendingZilloDiscard;
  if (!combat || !pending) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (isSkip) {
    clearPendingZilloDiscard(game);
    await interaction.message.edit({ content: '**Zillo Technique** — Skipped (no Block applied).', components: [] }).catch(discordCatch);
  } else {
    const defPN = pending.defenderPN;
    const cardIdx = parseInt(parts[1], 10);
    const handKey = ccHandKey(defPN);
    const hand = game[handKey] || [];
    if (cardIdx >= 0 && cardIdx < hand.length) {
      const cardName = hand[cardIdx];
      hand.splice(cardIdx, 1);
      const discKey = ccDiscardKey(defPN);
      game[discKey] = game[discKey] || [];
      game[discKey].push(cardName);
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      clearPendingZilloDiscard(game);
      await interaction.message.edit({ content: `**Zillo Technique** — Discarded **${cardName}**: +1 Block applied to defense.`, components: [] }).catch(discordCatch);
      if (thread) await thread.send(`**Zillo Technique** — Defender discarded **${cardName}** for **+1 Block**.`).catch(discordCatch);
    }
  }
  // Mark resolved (Skip or use): per-attack once-per-attack limit. Re-enter the
  // step-4 modifier sequence so subsequent DEF / surge / resolve steps continue.
  combat.zilloDiscardResolved = true;
  saveGames(game.gameId);
  if (thread) await proceedAfterRerolls(thread, game, combat, ctx);
}

/**
 * Demoralizing Monologue (Moff Gideon) post-reroll prompt handler.
 *
 * Card text: "Use while attacking to choose and reroll 1 defense die. Then
 * you may reveal your hand. If you reveal 2 or more cards this way, remove
 * the chosen die's results from the defense results."
 *
 * Prompts the caster after the forced defense-die reroll fires. On "Reveal":
 * post the caster's hand publicly to the combat thread; if hand size ≥ 2,
 * subtract the rerolled die's block/evade/dodge from defense totals. On
 * "Skip": no further effect. Either way, advance the forced-reroll queue.
 */
export async function handleDemoralizingMonologueReveal(interaction, ctx) {
  const { getGame, saveGames, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isUse = interaction.customId.startsWith('demoralizing_reveal_use_');
  const gameId = parseCustomId(interaction.customId, isUse ? 'demoralizing_reveal_use_' : 'demoralizing_reveal_skip_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const combat = game.pendingCombat;
  const pending = combat?.demoralizingMonologuePending;
  if (!combat || !pending) {
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    return;
  }
  const casterPN = pending.casterPlayerNum;
  const ownerId = getPlayerId(game, casterPN);
  if (interaction.user.id !== ownerId && !game.isTestGame) {
    await interaction.followUp({ content: 'Only the caster can choose this.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (isUse) {
    const handKey = ccHandKey(casterPN);
    const hand = game[handKey] || [];
    const handSize = hand.length;
    // Reveal publicly
    if (thread) {
      const handList = handSize > 0 ? hand.map((c) => `\`${c}\``).join(', ') : '_(empty)_';
      await thread.send(`**Demoralizing Monologue — Hand Revealed**: ${handList} (${handSize} card${handSize === 1 ? '' : 's'})`).catch(discordCatch);
    }
    if (handSize >= 2) {
      // Remove the rerolled die's results from defense
      const def = combat.defenseRoll || { block: 0, evade: 0, dodge: false };
      const newBlock = Math.max(0, (def.block || 0) - (pending.rerolledDieBlock || 0));
      const newEvade = Math.max(0, (def.evade || 0) - (pending.rerolledDieEvade || 0));
      const newDodge = pending.rerolledDieDodge ? false : !!def.dodge;
      combat.defenseRoll = { block: newBlock, evade: newEvade, dodge: newDodge };
      // Also strip the die's contribution from defenseDiceResults so totals stay consistent
      if (Array.isArray(combat.defenseDiceResults) && combat.defenseDiceResults[pending.rerolledDieIdx]) {
        combat.defenseDiceResults[pending.rerolledDieIdx] = { ...combat.defenseDiceResults[pending.rerolledDieIdx], block: 0, evade: 0, dodge: false };
      }
      if (thread) await thread.send(`**Demoralizing Monologue** — 2+ cards revealed: rerolled die results removed. New defense: ${newBlock} block, ${newEvade} evade${newDodge ? ' DODGE' : ''}.`).catch(discordCatch);
      await interaction.message.edit({ content: '**Demoralizing Monologue** — Hand revealed; die results removed.', components: [] }).catch(discordCatch);
    } else {
      if (thread) await thread.send(`**Demoralizing Monologue** — Fewer than 2 cards revealed: rerolled die results stand.`).catch(discordCatch);
      await interaction.message.edit({ content: '**Demoralizing Monologue** — Hand revealed; <2 cards, no removal.', components: [] }).catch(discordCatch);
    }
  } else {
    await interaction.message.edit({ content: '**Demoralizing Monologue** — Skipped (no reveal).', components: [] }).catch(discordCatch);
  }
  delete combat.demoralizingMonologuePending;
  // Advance the forced-reroll queue: shift the entry (it's now resolved) and continue.
  if (Array.isArray(combat.forcedRerollQueue) && combat.forcedRerollQueue.length > 0) {
    const _entry = combat.forcedRerollQueue[0];
    if (_entry?.demoralizingMonologue) combat.forcedRerollQueue.shift();
  }
  saveGames(game.gameId);
  if (thread) {
    if ((combat.forcedRerollQueue || []).length > 0) {
      await sendRerollUI(thread, game, combat, 'forced');
    } else {
      await sendCombatGate(thread, game, combat, 'post_forced_reroll', ctx);
    }
  }
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
