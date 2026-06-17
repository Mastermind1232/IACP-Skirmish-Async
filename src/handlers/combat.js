/**
 * Combat handlers: attack_target_, combat_gate_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import { COLORS } from '../discord/colors.js';
import { setPendingCelebration, setPendingCleave, clearPendingCleave, clearPendingCoverFire, clearPendingFalseOrders, setPendingStrainChoice, clearPendingStrainChoice, setPendingIllicitArms, setPendingThereIsNoTry, setPendingPowerConverter, setPendingZilloDiscard, clearPendingZilloDiscard, clearPendingFieldTactics, clearPendingExecutiveOrder, clearPendingCoordinatedRaid, setPendingSurgeOverflow, clearPendingSurgeOverflow, setPendingToughLuck, setPendingRogueOneTokenPick, clearPendingRogueOneTokenPick, setPendingStrikeMeDown, setPendingSlowOnTheDraw, setPendingForceExhaustion, clearPendingFigurehead, clearPendingEmperorInterrupt, clearPendingBombardmentSorin, clearPendingBattlefieldLeadership, setPendingHunterProtocol, setPendingUnhingedDirector, clearPendingUnhingedDirector, setPendingForceIsWithMe, clearPendingForceIsWithMe } from '../game/interrupts.js';
import { sendPowerTokenOverflowUI, TOKEN_EMOJI } from '../discord/power-token-prompts.js';
import { applyStrain, registerStrainFollowup } from './strain-handler.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { consumeActionForCurrentFigure } from '../game/activation-state.js';
import { getDcEffect } from '../game/dc-helpers.js';
export { sendPowerTokenOverflowUI };
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { areConditionEffectsSuppressed } from '../game/conditions.js';
import { pushNestedCombat, resolvePendingCombat } from '../game/combat-stack.js';
import { getMapData, getMapTokensData, getDcEffects as getDcEffectsGlobal, getDcKeywords as getDcKeywordsGlobal, getLoadoutCards, getFormCards, getFigureSize, getDeploymentZones, getMissionCardsData } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { figureMpRemaining, consumeMovementPoints } from '../game/game-helpers.js';
import { isWithinSpaces as _isWithinSpaces, countSpaces } from '../game/spatial.js';
import { cardNameIncludes } from '../game/card-names.js';
import { canOfferForceExhaustion } from '../game/force-exhaustion-helpers.js';
import { exhaustAttachment, depleteDc, combatSelfAttachmentMsgId } from '../game/card-state-helpers.js';
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
import { reduceHp, healHp, awardKillVp, awardObjectiveVp, deductVp, applyCondition, applyConditionWithDie, resetCondition, filterCondition, dcNameFromFigureKey, parseCoord, getFootprintCells, checkNefariousGains, getMaxPowerTokens, grantPowerTokens, resolveOverflowDiscard, getEffectiveMapSpaces, edgeKey, getInnateRerollAbilities } from '../game/index.js';
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
import { getPlayableReactionCardsForTiming, playCC } from '../game/cc-timing.js';
import { eligibleThirdPartyCcFigures, applyThirdPartyCcEffect, thirdPartyCardName } from '../engine/third-party-ccs.js';
import { applyDefenseDieTurn, applyDefenseDieRemoval } from '../engine/defense-die-turn.js';
import { isLargeTarget, getDeclarableSquares } from '../engine/large-target.js';
import { applyAbilityResult } from '../discord/apply-ability-result.js';
import { tokenSpenderFigureKey } from '../engine/combat-abilities-tokens.js';
import { onCcPlayed } from './cc-hand.js';
import { discordCatch, withDiscordRetry } from '../error-handling.js';
import { fetchCombatThread, fetchGameChannel, snowflakeUsers, sanitizeMentions, isAiUserId } from '../discord/channel-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
// Slice C: timing-window gate machine (flag-gated migration, default off).
import { buildModsGate, buildWindowGate } from '../engine/combat-mods-gate.js';
import { buildOnDeclareGate } from '../engine/combat-ondeclare-gate.js';
import { driveModsGate, recordModsChoice, passModsSide } from '../engine/combat-mods-orchestrator.js';
import { startSequence as _startSequence, advanceSequence as _advanceSequence } from '../engine/combat-sequence-driver.js';
import { rerollDie as _rerollDie, selectableDieIndices as _selectableDieIndices } from '../engine/combat-reroll.js';
import { auraGrantedSurges as _auraGrantedSurges } from '../engine/surge-auras.js';
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
}

/**
 * Is a figure with the given specialAbilityId currently ALIVE (on the board) for
 * a player? Aura/token abilities (Set Your Sights, etc.) end when their source
 * figure is defeated. alexanbv 2026-06-17.
 */
function _figureWithAbilityAlive(game, playerNum, abilityId) {
  const figs = game?.figurePositions?.[playerNum] || {};
  const eff = getDcEffectsGlobal() || {};
  for (const fk of Object.keys(figs)) {
    const n = dcNameFromFigureKey(fk);
    const e = eff[n] || eff[(n || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((e?.specialAbilityIds || []).includes(abilityId)) return true;
  }
  return false;
}

/**
 * Tough Luck (CC) — the single generic post-reroll reaction (alexanbv 2026-06-17:
 * "one or two functions, not multiple in each ability"). After ANY reroll, the
 * RELEVANT player by the die's POOL — attack die → the DEFENDER, defense die →
 * the ATTACKER, regardless of who did the rerolling — may play Tough Luck to
 * remove that die's result. If that player holds Tough Luck, post the window and
 * stash combat._pendingToughLuck so the gate pauses until they respond
 * (handleToughLuckGate resumes the rerolls window). Returns true iff a window
 * was posted. Called centrally by the gate after a reroll resolves.
 */
export async function _offerToughLuck(game, combat, ctx, thread, pool, idx) {
  if (!combat || idx == null) return false;
  const relevantPN = pool === 'attack'
    ? (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum))
    : combat.attackerPlayerNum;
  if (!relevantPN) return false;
  // INFO-LEAK TODO (alexanbv 2026-06-17): strictly, the window should be offered
  // to the relevant player REGARDLESS of whether they actually hold Tough Luck,
  // so that prompting (or not) doesn't reveal hand information. For now we only
  // prompt when they hold it — left as-is per Destruct; revisit to always prompt.
  if (!(getCcHand(game, relevantPN) || []).includes('Tough Luck')) return false;
  combat._pendingToughLuck = { pool, idx, playerNum: relevantPN };
  setPendingToughLuck(game, { side: pool === 'attack' ? 'atk' : 'def', idx });
  game.toughLuckPlayerNum = relevantPN;
  const ownerId = game[`player${relevantPN}Id`] ?? '';
  const die = (pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults)?.[idx];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tlgate_remove_${combat.gameId}_${pool}_${idx}`).setLabel(`Remove the rerolled ${die?.color || ''} die`.trim()).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`tlgate_skip_${combat.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  await thread?.send(sanitizeMentions({
    content: `**Tough Luck** — <@${ownerId}> may remove the rerolled ${pool} die's result.`,
    components: [row], allowedMentions: { users: [ownerId] },
  })).catch(discordCatch);
  return true;
}

/**
 * After a reroll resolver completes, offer Tough Luck on the die just rerolled
 * (combat._lastRerolledDie, set by rerollDie); if a window is posted the gate
 * PAUSES (handleToughLuckGate re-drives). Otherwise drive the window normally.
 * The single place the reroll → Tough Luck reaction is triggered.
 */
async function _driveGateOrOfferToughLuck(window, thread, game, combat, ctx) {
  if (window === 'rerolls' && combat?._lastRerolledDie) {
    const { pool, index } = combat._lastRerolledDie;
    delete combat._lastRerolledDie;
    if (await _offerToughLuck(game, combat, ctx, thread, pool, index)) return;
  }
  await _driveGatePath(window, thread, game, combat, ctx);
}
import { activeSide as _modsActiveSide } from '../engine/combat-ability-gate.js';

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
    // Mirror gate rotation onto combat.currentStep so the canonical CRR
    // step pointer stays accurate (audited by
    // currentstep-transition-audit). step1+2-attacker → step1+2-defender
    // when the attacker just acked during on-declare.
    if (gate.phase === 'on_declare' && effectivePn === atkPn) {
      combat.currentStep = 'step1+2-defender';
    }
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
  // Per alexanbv 2026-05-12: ALWAYS post the step-3 Y/N for the
  // defender. CCs like Targeting Network can be played in this moment
  // to grant a reroll, so the bot can't shortcut the prompt based on
  // pre-window counts. Mirrors the step-4 sendModsYn cadence — every
  // player gets exactly one prompt per step.
  // Self-play short-circuit: skip Y/N entirely. If pre-window
  // counts/controlled abilities exist, drive sendRerollUI; else
  // jump to step 4.
  if (game.selfPlay) {
    const _defCtrl = (combat.forcedRerollQueue || []).some(e => e.controlPlayer === defPN && (e.remaining ?? 0) > 0);
    const _defCtAvail = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    if (_countQueueRerollsForSide(combat, defPN, 'defense') > 0 || _defCtrl || _defCtAvail) {
      combat.rerollPhase = 'defender';
      combat.controlledRerollSide = defPN;
      combat.currentStep = 'step3-defender';
      await sendRerollUI(thread, game, combat, 'defender');
      return;
    }
    await _enterStep4(thread, game, combat, ctx);
    return;
  }
  combat.rerollPhase = 'defender';
  combat.controlledRerollSide = defPN;
  combat.currentStep = 'step3-defender';
  await sendRerollUI(thread, game, combat, 'defender');
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
  // Slice C (alexanbv 2026-06-14): gate-driven mods step, behind a migration
  // flag (default off). When enabled, the mods window is driven by the timing
  // registry → ability gate (passives auto-fire, interactive resolved in
  // player-chosen order, attacker gate then defender gate) instead of the
  // fixed-order proceedAfterRerolls + sendModsYn path. Off by default until the
  // remaining mods abilities (Illicit Arms / Guidance Systems / Zillo from
  // sendModsYn) are registered and self-play handles the choose buttons.
  if (combat.useModsGate) {
    combat.modsGate = buildModsGate(game, combat, {
      getDcEffects: ctx.getDcEffects, getMapData, isWithinSpaces: _isWithinSpaces, getFigureSize,
    });
    await _driveModsGatePath(thread, game, combat, ctx);
    return;
  }
  if (game.selfPlay) {
    combat.currentStep = 'step5';
    await proceedAfterRerolls(thread, game, combat, ctx);
  } else {
    await sendModsYn(thread, game, combat, 'attacker');
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
    onComplete: async (thread, game, combat, ctx) => { delete combat.specialGate; if (ctx._specialGateDone) await ctx._specialGateDone(thread, game, combat); },
  },
  // Zillo Technique exhaust window (pierce-cancel) — its own gate step AFTER
  // spend_surges (alexanbv 2026-06-15 "rewire all of the missing resolvers").
  // Previously absent from _GATE_WINDOWS, which would crash the sequence's zillo
  // step; the resolver (zillo_technique_pierce_cancel) already exists.
  zillo: {
    field: 'zilloGate', pickPrefix: 'combat_zillo_pick_', title: 'Zillo Technique',
    firePassive: null,
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
    firePassive: cfg.firePassive ? (side, id) => cfg.firePassive(side, id, thread, game, combat, ctx) : undefined,
    postChooseWindow: (side, pending) => _postGateChooseWindow(window, side, pending, thread, game, combat),
    onComplete: async () => {
      // When the full attack runs on the sequence driver, a window's completion
      // advances to the next step; otherwise fall back to the window's legacy
      // onComplete (existing flag-on-per-window behavior). Pick handlers re-enter
      // here on each player choice, so this branch must be consistent.
      if (combat._seqActive) {
        delete combat[cfg.field];
        await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
      } else {
        await cfg.onComplete(thread, game, combat, ctx);
      }
    },
  });
  ctx.saveGames?.(game.gameId);
}

// ── Full-attack sequence driver wiring (alexanbv 2026-06-15 rebuild) ──────────
// Shared gate-builder deps + per-window passive-firer.
function _gateDeps(ctx) {
  return { getDcEffects: ctx.getDcEffects, getMapData, isWithinSpaces: _isWithinSpaces, getFigureSize, getSquadCohesionTokens, dcHealthState: ctx.dcHealthState };
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
      c[cfg.field] = step === 'on_declare'
        ? buildOnDeclareGate(game, c, deps)
        : buildWindowGate(step, game, c, deps);
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
        if (c._afterResolveArgs) await _advanceSequence(c, handlers);
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
        if (res.ok) await thread?.send(`**Resourceful** — rerolled ${st.pool} die #${st.index + 1}.`).catch(discordCatch);
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

function _makeRerollResolver({ name, pool, side, eligible, colorSwap = false, stageKey = 'rr' }) {
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
        if (res.ok) thread?.send(`**${name}** — rerolled ${p} die #${idx + 1} → ${lbl(p, res.newDie)}.`).catch(discordCatch);
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
    apply: async (choice, { combat, thread, ctx, gameId, id }) => {
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
      if (res.ok) thread?.send(`**${name}** — rerolled ${pool} die #${idx + 1} → ${dieLabel(res.newDie)}.`).catch(discordCatch);
      else thread?.send(`**${name}** — die #${idx + 1} not rerolled (${res.reason}).`).catch(discordCatch);
      delete combat[`${sk}Stage`]; delete combat[`${sk}Die`];
      return undefined;
    },
  };
}

/**
 * Exhaust-attachment bonus resolver (Scavenged Weaponry +1 Hit, Explosive
 * Armaments Blast 1, Feeding Frenzy +1 Hit) — alexanbv 2026-06-17. No sub-choice:
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
        const faces = ctx?.getDiceData?.().attack?.[die?.color] || [];
        const btns = faces.map((f, fi) => new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${fi}_${id}`).setLabel(`${f.acc || 0}a/${f.dmg || 0}d/${f.surge || 0}s`.slice(0, 80)).setStyle(ButtonStyle.Primary));
        await thread?.send({ content: `**${name}** — choose the new face for die #${combat[`${sk}Die`] + 1}:`, components: chunkButtonsToRows(btns) }).catch(discordCatch);
        return { followUp: true };
      }
      const dieIdx = combat[`${sk}Die`]; const faceIdx = parseInt(choice, 10);
      const die = combat.attackDiceResults?.[dieIdx];
      const newFace = (ctx?.getDiceData?.().attack?.[die?.color] || [])[faceIdx];
      if (die && newFace) {
        combat.attackRoll = combat.attackRoll || { acc: 0, dmg: 0, surge: 0 };
        combat.attackRoll.acc = Math.max(0, (combat.attackRoll.acc || 0) - (die.acc || 0)) + (newFace.acc || 0);
        combat.attackRoll.dmg = Math.max(0, (combat.attackRoll.dmg || 0) - (die.dmg || 0)) + (newFace.dmg || 0);
        combat.attackRoll.surge = Math.max(0, (combat.attackRoll.surge || 0) - (die.surge || 0)) + (newFace.surge || 0);
        combat.attackDiceResults[dieIdx] = { ...die, acc: newFace.acc || 0, dmg: newFace.dmg || 0, surge: newFace.surge || 0 };
        thread?.send(`**${name}** — die #${dieIdx + 1} → ${newFace.acc || 0}a/${newFace.dmg || 0}d/${newFace.surge || 0}s.`).catch(discordCatch);
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
      await playCC(game, combat.attackerPlayerNum, combat.attackerFigureKey, 'Capitalize', { ctx, skipExecute: true });
      const p = choice[0] === 'd' ? 'defense' : 'attack';
      const idx = parseInt(choice.slice(1), 10);
      const res = _rerollDie(combat, ctx, { pool: p, index: idx });
      if (res.ok) await thread?.send(`**Capitalize** — rerolled ${p} die #${idx + 1} → ${lbl(p, res.newDie)}.`).catch(discordCatch);
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
      thread?.send(`**Twin Sabers** — rerolled all ${pool} dice (${n}).`).catch(discordCatch);
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
        for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
          const fn = dcNameFromFigureKey(fk);
          const fe = eff[fn] || eff[(fn || '').replace(/\s*\[.*\]\s*$/, '')];
          if (!(fe?.specialAbilityIds || []).includes('soresu_form')) continue;
          if (mapSp && defPos && _isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defPos).toLowerCase(), 3)) {
            combat.soresuFormFigKey = fk; // resolve-step handler does the Dodge conversion + Kanan strain
            break;
          }
        }
      }
      return r;
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
  call_the_shots: {
    prompt: () => ({ content: '**Call the Shots** — apply +2 Accuracy, +1 Hit, or +1 Surge?', buttons: [['acc', '+2 Accuracy'], ['hit', '+1 Hit'], ['surge', '+1 Surge'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { game, combat, thread }) => {
      const fk = _findModsFigKey('call_the_shots', game, combat);
      if (fk) { game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {}; game.roundFigureAbilityUsed[`${fk}_call_the_shots`] = true; }
      if (choice === 'acc') { combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2; thread?.send('**Call the Shots** — Applied +2 Accuracy.').catch(discordCatch); }
      else if (choice === 'hit') { combat.bonusHits = (combat.bonusHits || 0) + 1; thread?.send('**Call the Shots** — Applied +1 Hit.').catch(discordCatch); }
      else if (choice === 'surge') { combat.surgeBonus = (combat.surgeBonus || 0) + 1; thread?.send('**Call the Shots** — Applied +1 Surge.').catch(discordCatch); }
      else thread?.send('**Call the Shots** — Skipped.').catch(discordCatch);
      combat.callTheShotsResolved = true;
    },
  },
  get_down: {
    prompt: () => ({ content: '**Get Down** — apply +1 Block or +1 Evade?', buttons: [['block', '+1 Block'], ['evade', '+1 Evade'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { game, combat, thread }) => {
      const fk = _findModsFigKey('get_down', game, combat);
      if (fk) { game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {}; game.roundFigureAbilityUsed[`${fk}_get_down`] = true; }
      if (choice === 'block') { combat.bonusBlock = (combat.bonusBlock || 0) + 1; thread?.send('**Get Down** — Applied +1 Block.').catch(discordCatch); }
      else if (choice === 'evade') { combat.bonusEvade = (combat.bonusEvade || 0) + 1; thread?.send('**Get Down** — Applied +1 Evade.').catch(discordCatch); }
      else thread?.send('**Get Down** — Skipped.').catch(discordCatch);
      combat.getDownResolved = true;
    },
  },
  heavy_repeater: {
    prompt: () => ({ content: '**Heavy Repeater** — suffer 1 Strain for a bonus?', buttons: [['hit', '+1 Hit (1 Strain)'], ['blast', 'Blast 2 (1 Strain)'], ['acc', '+3 Acc (1 Strain)'], ['skip', 'Skip', 'secondary']] }),
    apply: async (choice, { game, combat, thread, ctx }) => {
      let strain = false;
      if (choice === 'hit') { combat.bonusHits = (combat.bonusHits || 0) + 1; strain = true; thread?.send('**Heavy Repeater** — +1 Hit (1 Strain).').catch(discordCatch); }
      else if (choice === 'blast') { combat.blastDamage = Math.max(combat.blastDamage || 0, 2); strain = true; thread?.send('**Heavy Repeater** — Blast 2 (1 Strain).').catch(discordCatch); }
      else if (choice === 'acc') { combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 3; strain = true; thread?.send('**Heavy Repeater** — +3 Accuracy (1 Strain).').catch(discordCatch); }
      else thread?.send('**Heavy Repeater** — Skipped.').catch(discordCatch);
      combat.heavyRepeaterResolved = true;
      if (strain) await applyStrain(game, ctx, { figureKey: combat.attackerFigureKey, controllerPlayerNum: combat.attackerPlayerNum, amount: 1, source: 'Heavy Repeater' });
    },
  },
  query: {
    prompt: () => ({ content: '🤖 **Query (HK-47)** — become Bleeding (avoid +1 Damage) or accept +1 Damage?', buttons: [['bleed', 'Become Bleeding'], ['accept', 'Accept +1 Damage', 'danger']] }),
    apply: async (choice, { game, combat, thread }) => {
      if (choice === 'bleed') {
        if (combat.target?.figureKey) { const { applyCondition } = await import('../game/conditions.js'); applyCondition(game, combat.target.figureKey, 'Bleed'); }
        thread?.send('🩸 **Query** — Defender became Bleeding (no damage bonus).').catch(discordCatch);
      } else { combat.bonusHits = (combat.bonusHits || 0) + 1; thread?.send('💢 **Query** — Defender accepted +1 Damage.').catch(discordCatch); }
      combat.queryResolved = true; delete combat.queryNeedsPrompt;
    },
  },
  negotiate: {
    // Hondo's attacker ability; the DEFENDER decides pay-or-accept (mention them).
    prompt: ({ game, combat }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      return { content: `<@${game[`player${defPN}Id`]}> **Negotiate (Hondo)** — pay **2 VP** to avoid +2 Damage, or accept +2 Damage:`, buttons: [['pay', 'Pay 2 VP'], ['accept', 'Accept +2 Damage', 'danger']], mentionUserId: game[`player${defPN}Id`] };
    },
    apply: async (choice, { game, combat, thread, ctx }) => {
      const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
      if (choice === 'pay') { deductVp(game, defPN, 2); awardObjectiveVp(game, combat.attackerPlayerNum, 2); thread?.send('**Negotiate** — Defender paid 2 VP to Hondo. No bonus damage.').catch(discordCatch); if (ctx?.checkWinConditions) await ctx.checkWinConditions(game, ctx.client ?? thread?.client); }
      else { combat.bonusHits = (combat.bonusHits || 0) + 2; thread?.send('**Negotiate** — +2 Damage applied.').catch(discordCatch); }
      combat.negotiateResolved = true;
    },
  },
  elusive: {
    prompt: ({ combat }) => {
      const atkDice = combat.attackDiceResults || [];
      const buttons = atkDice.map((d, i) => [String(i), `#${i + 1} ${d.color}: ${d.dmg || 0}H/${d.surge || 0}S/${d.acc || 0}A`.slice(0, 80)]);
      buttons.push(['skip', 'Skip', 'secondary']);
      return { content: '**Elusive** — choose an attack die to nullify (the worst defense die is also nullified):', buttons };
    },
    apply: (choice, { combat, thread }) => {
      if (choice !== 'skip') {
        const dieIdx = parseInt(choice, 10);
        const atkDice = combat.attackDiceResults; const defDice = combat.defenseDiceResults;
        if (atkDice && dieIdx >= 0 && dieIdx < atkDice.length) {
          atkDice[dieIdx] = { ...atkDice[dieIdx], dmg: 0, surge: 0, acc: 0 };
          combat.attackRoll = { dmg: 0, surge: 0, acc: 0 };
          for (const d of atkDice) { combat.attackRoll.dmg += (d.dmg || 0); combat.attackRoll.surge += (d.surge || 0); combat.attackRoll.acc += (d.acc || 0); }
          if (defDice && defDice.length > 0) {
            let wi = 0; let wv = Infinity;
            for (let di = 0; di < defDice.length; di++) { const v = (defDice[di].block || 0) + (defDice[di].evade || 0) + (defDice[di].dodge ? 100 : 0); if (v < wv) { wv = v; wi = di; } }
            defDice[wi] = { ...defDice[wi], block: 0, evade: 0, dodge: false };
            combat.defenseRoll = { block: 0, evade: 0, dodge: false };
            for (const d of defDice) { combat.defenseRoll.block += (d.block || 0); combat.defenseRoll.evade += (d.evade || 0); if (d.dodge) combat.defenseRoll.dodge = true; }
          }
          thread?.send(`**Elusive** — nullified attack die #${dieIdx + 1} and the worst defense die.`).catch(discordCatch);
        }
      } else thread?.send('**Elusive** — Skipped.').catch(discordCatch);
      combat.elusiveResolved = true;
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
  // ── special (sample) ─────────────────────────────────────────────────────
  zillo_technique_pierce_cancel: {
    prompt: () => ({ content: '**Zillo Technique** — exhaust to cancel 2 Pierce on this attack?', buttons: [['use', 'Exhaust → -2 Pierce'], ['skip', 'Skip', 'secondary']] }),
    apply: (choice, { game, combat, thread }) => {
      if (choice === 'use') {
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
        thread?.send('**Zillo Technique** — Exhausted: cancels 2 Pierce.').catch(discordCatch);
      } else thread?.send('**Zillo Technique** — Skipped.').catch(discordCatch);
      combat.zilloPierceResolved = true;
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
    apply: async (choice, { game, combat, thread, ctx, side }) => {
      const figs = eligibleThirdPartyCcFigures(game, specKey, combat, _gateDeps(ctx));
      const fk = figs[parseInt(choice, 10)] ?? figs[0];
      if (!fk) return;
      const pn = side === 'attacker' ? combat.attackerPlayerNum : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
      // Validate + dispose via playCC, but apply the combat effect ourselves
      // (it acts on the chosen figure, which resolveAbility doesn't know about).
      await playCC(game, pn, fk, card, { ctx, skipExecute: true });
      const { applyCondition } = await import('../game/conditions.js');
      const res = applyThirdPartyCcEffect(specKey, game, combat, fk, { applyCondition });
      if (thread) await thread.send(`**${card}** played by ${_label(fk)}${res.log?.length ? ` — ${res.log.join(', ')}` : ''}.`).catch(discordCatch);
      // Target-switch (Bodyguard / GBM): the NEW target gets a fresh defender
      // on_declare window. Rebuild the gate so eligibility (traits / square / auras)
      // is rechecked for the new target, mark the attacker side done (it already
      // completed on_declare), and re-drive — then signal followUp so the caller
      // doesn't record/advance against the old gate.
      if (res?.reopenDefenderOnDeclare) {
        combat.onDeclareGate = buildOnDeclareGate(game, combat, _gateDeps(ctx));
        if (combat.onDeclareGate?.attacker) {
          combat.onDeclareGate.attacker.passivesFired = true;
          combat.onDeclareGate.attacker.passed = true;
        }
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
        if (res.ok) await thread?.send(`**Battlefield Awareness** — rerolled attack die #${st.index + 1} → ${dieLabel(res.newDie)}.`).catch(discordCatch);
        else await thread?.send(`**Battlefield Awareness** — die #${st.index + 1} not rerolled (${res.reason}).`).catch(discordCatch);
        delete combat[sk];
      };
      if (!st.stage) {
        // Stage 1: a Leader was chosen → validate/dispose the CC, then pick a die.
        const figs = eligibleThirdPartyCcFigures(game, 'Battlefield Awareness', combat, _gateDeps(ctx));
        const fk = figs[parseInt(choice, 10)] ?? figs[0];
        if (!fk) return undefined;
        await playCC(game, combat.attackerPlayerNum, fk, 'Battlefield Awareness', { ctx, skipExecute: true });
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
    prompt: async ({ game, combat, ctx }) => {
      const figs = eligibleThirdPartyCcFigures(game, specKey, combat, _gateDeps(ctx));
      const fk = figs[0];
      if (fk) {
        const pn = side === 'attacker' ? combat.attackerPlayerNum : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
        await playCC(game, pn, fk, 'There Is No Try', { ctx, skipExecute: true });
      }
      return turn.prompt({ game, combat, ctx });
    },
    apply: turn.apply,
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
      else if (tok.type === 'Block') { combat.bonusBlock = (combat.bonusBlock || 0) + 1; msg = '+1 Block'; }
      else if (tok.type === 'Evade') { combat.bonusEvade = (combat.bonusEvade || 0) + 1; msg = '+1 Evade'; }
      // Personal Combat Shield (Gar Saxon): a Block token spent while defending → +1 Evade.
      if (tok.type === 'Block' && side === 'defender') {
        const ids = (getDcEffectsGlobal()[dcNameFromFigureKey(tok.figureKey)]?.specialAbilityIds) || [];
        if (ids.includes('personal_combat_shield')) { combat.bonusEvade = (combat.bonusEvade || 0) + 1; msg += ', +1 Evade (Personal Combat Shield)'; }
      }
      if (thread) await thread.send(`**Power Token** — ${dcNameFromFigureKey(tok.figureKey)} spent a ${tok.type} token: ${msg}.`).catch(discordCatch);
      // Max one per attack — return (record + re-drive); spend_token won't re-offer.
      return undefined;
    },
  };
}

/**
 * Heightened Reflexes (CC): "choose 1 defense die and remove its results."
 * Discard the card (played by the attacking HUNTER) then pick a defense die to
 * zero (alexanbv 2026-06-16 re-audit). Interactive — routed via cc_interactive.
 */
function _makeHeightenedReflexesResolver({ card }) {
  return {
    prompt: ({ combat }) => {
      const dice = combat.defenseDiceResults || [];
      if (!dice.length) return { content: `**${card}** — no defense dice to remove.`, buttons: [['skip', 'OK', 'secondary']] };
      return { content: `**${card}** — choose a defense die to remove its results:`, buttons: [...dice.map((d, i) => [String(i), `Die #${i + 1} (${d.block || 0}b/${d.evade || 0}e${d.dodge ? '/dodge' : ''})`]), ['skip', 'Skip', 'secondary']] };
    },
    apply: async (choice, { game, combat, thread, ctx }) => {
      if (choice === 'skip') { if (thread) await thread.send(`**${card}** — skipped (card not played).`).catch(discordCatch); return undefined; }
      const _snap = combat ? JSON.parse(JSON.stringify(combat)) : null;
      await playCC(game, combat.attackerPlayerNum, combat.attackerFigureKey, card, { ctx, skipExecute: true });
      const dieIdx = parseInt(choice, 10);
      const roll = applyDefenseDieRemoval(combat, dieIdx);
      if (thread) await thread.send(`**${card}** — removed defense die #${dieIdx + 1}'s results. Defense now ${roll?.block || 0}b/${roll?.evade || 0}e${roll?.dodge ? '/dodge' : ''}.`).catch(discordCatch);
      // Opponent counter-window (Negation/Comm-Disruption), same as plain CCs.
      const _cost = ctx.getCcEffect?.(card)?.cost ?? 0;
      await onCcPlayed(game, game.gameId, combat.attackerPlayerNum, card, _cost, { client: ctx.client }, ctx, { combatSnapshot: _snap });
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
  if (reg?.params?.kind === 'cc_interactive') {
    if (reg.params.card === 'Heightened Reflexes') return _makeHeightenedReflexesResolver({ card: reg.params.card });
    return null;
  }
  if (reg?.params?.kind === 'reroll') {
    return _makeRerollResolver({ name: reg.name, pool: reg.params.pool, side: reg.side, colorSwap: !!reg.params.colorSwap, stageKey: `rr_${String(pick).replace(/[^a-z0-9]/gi, '').slice(0, 24)}` });
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
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);
  await interaction.deferUpdate().catch(discordCatch);
  if (interaction.message) await interaction.message.edit({ components: [] }).catch(discordCatch);
  const side = _modsActiveSide(gate);
  if (!side) return;
  if (pick === 'done') {
    passModsSide(gate, side);
    await _driveGatePath(window, thread, game, combat, ctx);
  } else if (getCombatAbility(pick)?.params?.kind === 'cc') {
    // Command-Card button in the combat sequence (alexanbv 2026-06-16: "this is the
    // method that should be called whenever a button corresponding to a CC is
    // clicked in the combat sequence"). The figure is already populated — it's the
    // active side's combat figure. playCC validates (in-hand / figure / not-blocked
    // / timing), executes the effect, and disposes (discard or game box).
    // TODO(next): comms-jammer cancel + opponent negate/Comm-Disruption prompt
    // before execute, reusing cc-hand.js promptCommDisruption/Negation.
    const _ccReg = getCombatAbility(pick);
    // False Orders / Lure: the controller plays the attacker-side CC.
    const ccPn = side === 'attacker'
      ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
      : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
    const ccFig = side === 'attacker' ? combat.attackerFigureKey : combat.target?.figureKey;
    // Pre-play combat snapshot so a Comm-Disruption cancel can revert a combat-
    // modifying CC (Wild Attack's dice, etc.) (alexanbv 2026-06-16).
    const _ccSnap = combat ? JSON.parse(JSON.stringify(combat)) : null;
    const ccRes = await playCC(game, ccPn, ccFig, _ccReg.params.card, { ctx });
    if (!ccRes.ok && thread) await thread.send(`⚠️ Can't play ${_ccReg.params.card}: ${ccRes.reason}`).catch(discordCatch);
    else if (ccRes.cancelled && thread) await thread.send(`**${_ccReg.params.card}** was cancelled (${ccRes.cancelled}).`).catch(discordCatch);
    else {
      if (ccRes.result) await applyAbilityResult(ccRes.result, { game, playerNum: ccPn, msgId: side === 'attacker' ? combat.attackerMsgId : undefined, client: interaction.client, ctx });
      // Opponent counter-window: Negation (cost 0) / Comm Disruption (cost <= opponent SPY groups).
      const _ccCost = ctx.getCcEffect?.(_ccReg.params.card)?.cost ?? 0;
      await onCcPlayed(game, gameId, ccPn, _ccReg.params.card, _ccCost, interaction, ctx, { combatSnapshot: _ccSnap });
    }
    recordModsChoice(gate, side, pick);
    _markGateAbilityUsed(game, combat, pick);
    await _driveGatePath(window, thread, game, combat, ctx);
  } else {
    const r = _resolverFor(pick);
    if (r) {
      // Generic, data-driven: post the ability's sub-choice prompt, or apply
      // immediately if it has none. The handler never names the ability.
      const p = r.prompt ? await r.prompt({ game, combat, thread, ctx, side, gameId, id: pick, window }) : null;
      if (p?.buttons) {
        const rows = chunkButtonsToRows(p.buttons.map(([c, l, s]) =>
          new ButtonBuilder().setCustomId(`combat_modsub_${gameId}_${c}_${pick}`).setLabel(l).setStyle(_modsStyle(s))));
        await thread.send(sanitizeMentions({ content: p.content, components: rows, allowedMentions: p.mentionUserId ? { users: [p.mentionUserId] } : undefined })).catch(discordCatch);
        // wait for the sub-choice (handleModsSubChoice resolves + re-drives)
      } else {
        delete combat._lastRerolledDie;
        if (r.apply) await r.apply(null, { game, combat, thread, ctx, side, gameId, id: pick, window });
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
  if (id === 'call_the_shots') {
    const friendly = game.figurePositions?.[combat.attackerPlayerNum] || {};
    const atkCoord = friendly[combat.attackerFigureKey];
    if (!atkCoord || !mapSp) return null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (fk === combat.attackerFigureKey) continue;
      if (!(effOf(fk)?.specialAbilityIds || []).includes('call_the_shots_hera')) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_call_the_shots`]) continue;
      if (_isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkCoord).toLowerCase(), 3)) return fk;
    }
  } else if (id === 'get_down') {
    const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const friendly = game.figurePositions?.[defPN] || {};
    const defCoord = friendly[combat.target?.figureKey];
    if (!defCoord || !mapSp) return null;
    for (const [fk, pos] of Object.entries(friendly)) {
      if (!(effOf(fk)?.specialAbilityIds || []).includes('get_down_onar')) continue;
      if (game.roundFigureAbilityUsed?.[`${fk}_get_down`]) continue;
      if (_isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 2)) return fk;
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
  if (isRemove) {
    const dice = tl.pool === 'attack' ? combat.attackDiceResults : combat.defenseDiceResults;
    const die = dice?.[tl.idx];
    if (die) {
      // Tough Luck is played → discard it from the responder's hand.
      const hand = getCcHand(game, tl.playerNum) || [];
      const hi = hand.indexOf('Tough Luck');
      if (hi >= 0) { hand.splice(hi, 1); (getCcDiscard(game, tl.playerNum) || []).push('Tough Luck'); }
      // Remove that die's RESULT (zero its icons), then recalc the pool totals.
      if (tl.pool === 'attack') { die.acc = 0; die.dmg = 0; die.surge = 0; }
      else { die.block = 0; die.evade = 0; die.dodge = false; }
      const recalc = tl.pool === 'attack' ? ctx.recalcAttackTotals : ctx.recalcDefenseTotals;
      if (typeof recalc === 'function') combat[tl.pool === 'attack' ? 'attackRoll' : 'defenseRoll'] = recalc(dice);
      await thread?.send(`**Tough Luck** — removed the rerolled ${die.color} ${tl.pool} die's result.`).catch(discordCatch);
    }
  } else {
    await thread?.send('**Tough Luck** — Skipped.').catch(discordCatch);
  }
  delete combat._pendingToughLuck;
  game.pendingToughLuck = null;
  game.toughLuckPlayerNum = null;
  // Resume the rerolls window (more rerolls may be available, or it advances).
  await _driveGatePath('rerolls', thread, game, combat, ctx);
  saveGames?.(game.gameId);
}

/** Apply a passive mods ability automatically (no player decision). */
export async function _fireModsPassive(side, id, thread, game, combat, ctx) {
  // Automatic attachment passives migrated off the eager declaration path
  // (combat-abilities-attachment-auto.js). alexanbv 2026-06-17.
  if (id === 'driven_by_hatred_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Driven by Hatred** — +1 Hit.').catch(discordCatch);
    return;
  }
  if (id === 'wookiee_avenger_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Wookiee Avenger** — +1 Hit while attacking.').catch(discordCatch);
    return;
  }
  if (id === 'combat_suit_reduce_pierce') {
    combat.defenderReducePierce = (combat.defenderReducePierce || 0) + 1;
    await thread?.send('**Combat Suit** — reduce the attack\'s Pierce by 1.').catch(discordCatch);
    return;
  }
  if (id === 'heir_to_the_jedi_hit') {
    combat.bonusHits = (combat.bonusHits || 0) + 1;
    await thread?.send('**Heir to the Jedi** — +1 Hit (Ranged attack).').catch(discordCatch);
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
    await thread.send('**Pulse Cannon** — Power Token spent: **+4 Accuracy, +1 Hit**.').catch(discordCatch);
  } else if (id === 'fury_kashyyyk_pierce') {
    combat.bonusPierce = (combat.bonusPierce || 0) + 1;
    await thread.send('**Fury of Kashyyyk** — +1 Pierce (elite WOOKIEE, target within 2, friendly WOOKIEE within 2 of the defender).').catch(discordCatch);
  } else if (id === 'slippery') {
    const bump = applySlipperyBonus({ bonusAccuracy: combat.bonusAccuracy });
    combat.bonusAccuracy = bump.bonusAccuracy;
    await thread.send('**Slippery** — Defender applies -2 Accuracy to the attack.').catch(discordCatch);
  } else if (id === 'take_cover') {
    const bump = applyTakeCoverBonus({ bonusBlock: combat.bonusBlock, bonusEvade: combat.bonusEvade });
    combat.bonusBlock = bump.bonusBlock;
    combat.bonusEvade = bump.bonusEvade;
    await thread.send('**Take Cover** — Defender applies +1 Block, -1 Evade.').catch(discordCatch);
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
  } else if (id === 'cunning') {
    const r = applyCunningFlag(combat);
    combat.hasCunning = r.hasCunning;
  } else if (id === 'find_weakness') {
    const r = applyFindWeaknessEvade(combat);
    combat.bonusEvade = r.bonusEvade;
    await thread.send('**Find Weakness** — −1 Evade applied to defense results.').catch(discordCatch);
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
      await thread.send('**Scattergun** — adjacent to target: +1 Hit.').catch(discordCatch);
    }
  } else if (id === 'forest_fighters') {
    const r = applyForestFightersHit(combat);
    combat.bonusHits = r.bonusHits;
    await thread.send('**Forest Fighters** — +1 Hit (Hidden, Melee attack).').catch(discordCatch);
  } else if (id === 'exploit_weakness') {
    const r = applyExploitWeaknessSurge(combat);
    combat.surgeBonus = r.surgeBonus;
    await thread.send('**Exploit Weakness** — defender has a harmful condition, +1 Surge.').catch(discordCatch);
  } else if (id === 'negotiate') {
    combat.bonusHits = (combat.bonusHits || 0) + 2;
    combat.negotiateResolved = true;
    await thread.send('**Negotiate** — Defender has fewer than 2 VP; **+2 Damage** auto-applied.').catch(discordCatch);
  } else if (id === 'defensive_stance') {
    const dr = combat.defenseRoll || {};
    combat.defenseRoll = { block: (dr.block || 0) + 2, evade: (dr.evade || 0) + 1, dodge: false };
    await thread.send('**Defensive Stance** — Dodge converted to +2 Block, +1 Evade.').catch(discordCatch);
  } else if (id === 'lucky') {
    await thread.send('🍀 **Lucky** — R2-D2 rolled a Dodge (recover 2 damage handled at resolution).').catch(discordCatch);
  } else if (id === 'soresu') {
    const dr = combat.defenseRoll || {};
    combat.defenseRoll = { block: (dr.block || 0) + 2, evade: (dr.evade || 0) + 1, dodge: false };
    await thread.send('**Soresu Form** — Dodge converted to +2 Block, +1 Evade.').catch(discordCatch);
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
      await thread.send(`**${af.label}** — auto-Focus: +1 ${af.die} die.`).catch(discordCatch);
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
async function _postGateChooseWindow(window, side, pending, thread, game, combat) {
  const cfg = _GATE_WINDOWS[window];
  // False Orders / Lure: the controller acts on the attacker side.
  const sidePlayerNum = side === 'attacker'
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum)
    : (combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum));
  const sideId = game[`player${sidePlayerNum}Id`];
  const btns = pending.map((id) => {
    const reg = getCombatAbility(id);
    return new ButtonBuilder()
      .setCustomId(`${cfg.pickPrefix}${game.gameId}_${id}`)
      .setLabel((reg?.name || id).slice(0, 80))
      .setStyle(ButtonStyle.Primary);
  });
  btns.push(new ButtonBuilder().setCustomId(`${cfg.pickPrefix}${game.gameId}_done`).setLabel('Done (no more)').setStyle(ButtonStyle.Secondary));
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
 * Dispatch to the next combat step after a gate is cleared.
 */
async function dispatchCombatGateAdvance(thread, game, combat, subPhase, ctx) {
  const saveGames = ctx.saveGames;

  switch (subPhase) {
    case 'on_declare': {
      // Both players Ready'd after combat declaration. Per destruct
      // 2026-05-08: tokens were merged into each player's on_declare
      // window (sendOnDeclareTokenWindow), so the legacy
      // proceedToTokenPhase pass is skipped. Clear the merge flag,
      // transition the canonical CRR step pointer to 'roll', and post
      // the Roll Combat Dice button (auto-roll runs from there).
      combat.onDeclareTokenContext = false;
      combat.tokenPhase = null;
      combat.currentStep = 'roll';
      await postRollDiceButton(thread, game, combat, ctx);
      break;
    }

    case 'post_roll': {
      // Per alexanbv 2026-05-12: ALWAYS post the step-3 Y/N for the
      // attacker (and later the defender). Step 3 is an open window —
      // a CC like Targeting Network can be played in this moment to
      // grant a reroll, so the bot can't shortcut the prompt based on
      // pre-roll reroll counts. Each player gets one prompt per step,
      // matching the step-4 sendModsYn UX.
      const atkPN = combat.attackerPlayerNum || 1;
      const defPN = opponentPlayerNum(atkPN);
      // Self-play short-circuit: skip Y/N entirely. If pre-roll
      // counts/controlled abilities exist, drive the picker
      // automatically via sendRerollUI; else jump to defender entry
      // (which has the same selfPlay short-circuit), then step 4.
      if (game.selfPlay) {
        const _atkCtrl = (combat.forcedRerollQueue || []).some(e => e.controlPlayer === atkPN && (e.remaining ?? 0) > 0);
        if (_atkCtrl) {
          combat.rerollPhase = 'attacker';
          combat.controlledRerollSide = atkPN;
          combat.currentStep = 'step3-attacker';
          await sendRerollUI(thread, game, combat, 'attacker');
        } else {
          await _enterDefenderRerollPhase(thread, game, combat, ctx, defPN);
        }
        break;
      }
      combat.rerollPhase = 'attacker';
      combat.controlledRerollSide = atkPN;
      combat.currentStep = 'step3-attacker';
      await sendRerollUI(thread, game, combat, 'attacker');
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
  // Flame Trooper Fireproof: only the FLAME TROOPER FIGURE itself is immune to
  // Strain — not the whole group it's attached to. alexanbv 2026-06-17.
  if (squadUpgradeFigureCard(game, figureKey) === 'Flame Trooper') {
    const dcName = dcNameFromFigureKey(figureKey);
    await thread.send(`**Fireproof** — **${dcName}** (Flame Trooper) is immune to Strain from ${abilityLabel}.`).catch(discordCatch);
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
        exhaustAttachment(game, _hhMid, 'Headhunter');
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
      depleteDc(game, udMsgId, udOwnerNum);
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
    // Per alexanbv 2026-05-13: per-figureKey.
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[_attackerFkEarly] = true;
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
    const isFieldTacticsFreeAttack = game.pendingFieldTactics?.forMsgId === msgId;
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
    targetEff = getDcEffect(targetDcName);
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
  let _aimFired = false;
  if ((_atkEff?.passives || []).includes('Aim')) {
    if (!game.figureMoved?.[attackerFigureKey]) {
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
  // Aim (Rebel Trooper Elite): apply +1 Hit +2 Accuracy to pendingCombat
  if (_aimFired) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
  }
  // Surge-granting auras (Gar Saxon, General Sorin, …): a friendly owner figure
  // within range grants its surge abilities to qualifying friendlies — so an
  // attacker standing in the aura sees those surges in the spend_surges step.
  // Owner-centric / footprint-aware eligibility via the condition engine; granted
  // surges are data-driven (the owner's surgeAbilities). alexanbv 2026-06-16.
  game.pendingCombat.bonusSurgeAbilities.push(..._auraGrantedSurges(game, game.pendingCombat));
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

    // Driven by Hatred (Darth Vader): +1 Hit. The reroll is offered by the gate
    // ([Driven by Hatred] attachment reroll row); the old eager rerollOneAttackDie
    // count is dead (its consumer is in the retired legacy block). Brutality loss
    // is handled separately.
    // Driven by Hatred (+1 Hit) and Wookiee Avenger (+1 Hit) are now gate mods
    // passives (combat-abilities-attachment-auto.js → _fireModsPassive), fired in
    // the modifiers window instead of eagerly here. alexanbv 2026-06-17.
    // Heir to the Jedi (Luke): +1 Hit on Ranged is now a gate mods passive
    // (heir_to_the_jedi_hit). Saber Strike pre-attack Focus is still handled
    // below (a declaration-time die effect, not a modifier). alexanbv 2026-06-17.
    // Rogue Smuggler (Han Solo) — reroll MOVED to the gate rerolls window
    // (CSV [Rogue Smuggler] row). Distracting-loss is handled separately below.
    // Cross Training: defend-only ability (no attack effect)
    // Guidance Systems (Mortar Trooper): optional -1 Hit, +2 Accuracy per use (multiple times per attack)
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
    // Scavenged Weaponry (+1 Hit, on_declare), Explosive Armaments (Blast 1,
    // mods), Feeding Frenzy (+1 Hit vs a damaged target, mods) are now OFFERED in
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

  // Health state for HP-conditional abilities (Full of Rage, Fury)
  const atkHpArr = dcHealthState?.get(msgId) || [];
  const atkFigHp = atkHpArr[figureIndex];
  const atkDamageSuffered = atkFigHp ? Math.max(0, (atkFigHp[1] ?? atkFigHp[0] ?? 0) - (atkFigHp[0] ?? 0)) : 0;

  // Battle Meditation / Assassin (Diala Passil, BT-1): auto-Focus before attacking
  // Battle Meditation — MOVED to the on_declare window (combat-abilities-
  // ondeclare.js 'battle_meditation' passive → _fireOnDeclarePassive) per
  // alexanbv 2026-06-16.

  // Full of Rage (Krrsantan) — MOVED to the on_declare window
  // (combat-abilities-ondeclare.js 'full_of_rage' passive → _fireOnDeclarePassive)
  // per alexanbv 2026-06-16. (Both the early + late declaration sites removed.)

  // Fury (Wookiee Warriors): +1 Surge if 5+ damage
  if (hasFuryAbility(atkSpecialIds) && furyDamageTriggered(atkDamageSuffered)) {
    game.pendingCombat.furyBonus = FURY_SURGE_BONUS;
    await thread.send(`**Fury** — Wookiee Warrior is **Furious** (+1 Surge, having suffered ${atkDamageSuffered} damage).`);
  }

  // Cunning (Han Solo, Jyn Odan, Nexu): while defending, +1 Block per Evade result
  // Cunning — MOVED to the mods window (combat-abilities-mods.js 'cunning' passive).

  // Distracting (Han Solo, C-3PO) MOVED to step-4 defender via sendModsYn —
  // per alexanbv 2026-05-13: the adjacency check should happen at step 4,
  // not on-declare, because figures may move (CC plays, Wild Beast, etc.)
  // between declare and damage resolution. See `_applyDistractingStep4`.
  const mapSpaces = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
  const targetCoord = target.coord ? String(target.coord).toLowerCase() : null;

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
        game.figurePowerTokens = game.figurePowerTokens || {};
        const _curTokens = game.figurePowerTokens[attackerFigureKey] || [];
        game.figurePowerTokens[attackerFigureKey] = [..._curTokens, 'Damage'];
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
        const fkEff = getDcEffect(fkDcName);
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

  // Query (HK-47): defender prompt deferred to proceedAfterRerolls
  // (modifier step) — same pattern as Negotiate. Per destruct 2026-05-08
  // defender chooses "become Bleeding" or "accept +1 Damage". Tagged
  // here at declare time; resolved at modifier step.
  if (hasQueryAbility(atkSpecialIds)) {
    game.pendingCombat.queryNeedsPrompt = true;
  }

  // Disposable (Hired Gun Regular) — MOVED to the mods window
  // (combat-abilities-mods.js 'disposable' passive) per alexanbv 2026-06-16.

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

  // Forest Fighters (Ewok Warrior Elite) — MOVED to the mods window
  // (combat-abilities-mods.js 'forest_fighters' passive).

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

  // Supporting Fire (J4X-7): while ANOTHER friendly figure is attacking a figure
  // adjacent to J4X-7, apply Pierce 1 (once per activation). Attacker-side analog
  // of Sentinel/Protector. Companions share spaces, so "adjacent to J4X-7"
  // INCLUDES the target being IN J4X-7's own space — hence targetCoord is in the
  // set too (alexanbv 2026-06-17).
  if (mapSpaces && targetCoord && !target.isNpc && !game.pendingCombat?.noFriendliesActive) {
    const _sfKey = 'J4X-7:Supporting Fire';
    if (!game.activationAbilityUsed?.[_sfKey]) {
      const adjToTargetSF = new Set((mapSpaces.adjacency?.[targetCoord] || []).map((s) => String(s).toLowerCase()));
      adjToTargetSF.add(targetCoord); // J4X-7 may share the target's space (companion)
      const atkFigPos = game.figurePositions?.[attackerPlayerNum] || {};
      for (const [fk, pos] of Object.entries(atkFigPos)) {
        if (fk === attackerFigureKey) continue; // "another friendly figure"
        if (!adjToTargetSF.has(String(pos).toLowerCase())) continue;
        const _sfName = dcNameFromFigureKey(fk);
        const _sfEff = getDcEffectsGlobal()[_sfName] || getDcEffectsGlobal()[_sfName?.replace(/\s*\[.*\]\s*$/, '')];
        if ((_sfEff?.specialAbilityIds || []).includes('supporting_fire')) {
          game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 1;
          game.activationAbilityUsed = game.activationAbilityUsed || {};
          game.activationAbilityUsed[_sfKey] = true;
          await thread.send(`**Supporting Fire** (${_sfName}) — the target is adjacent to (or shares) its space, +1 Pierce.`).catch(discordCatch);
          break;
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

  // The Force is With Me (Chirrut Imwe): when a Ranged attack targeting
  // Chirrut is declared, Chirrut's owner may CHOOSE an adjacent hostile.
  // If they do, apply -1 Damage to the attack results (defender modifier
  // via combat.defenderDamageReduction) and the chosen hostile suffers
  // 1 Damage.
  //
  // Per alexanbv 2026-05-13: previously this auto-picked the first
  // adjacent hostile and incorrectly applied "-1 Hit". Both fixed —
  // it's now a player-choice picker AND a defender Damage modifier.
  if (isRanged && defSpecialIds.includes('the_force_is_with_me_chirrut') && mapSpaces && targetCoord) {
    const adjToChirrut = (mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase());
    const atkFigPos = game.figurePositions?.[attackerPlayerNum] || {};
    const adjacentHostiles = [];
    for (const [fk, pos] of Object.entries(atkFigPos)) {
      if (pos && adjToChirrut.includes(String(pos).toLowerCase())) {
        adjacentHostiles.push(fk);
      }
    }
    if (adjacentHostiles.length > 0) {
      setPendingForceIsWithMe(game, {
        gameId: game.gameId,
        defenderPlayerNum,
        attackerPlayerNum,
        chirrutFigureKey: target.figureKey,
        adjacentHostiles,
      });
      const defOwnerId = getPlayerId(game, defenderPlayerNum);
      // Cap at 4 picker buttons so the Skip still fits in a 5-button row.
      const _fiwmSlice = adjacentHostiles.slice(0, 4);
      const btns = _fiwmSlice.map((fk, i) =>
        new ButtonBuilder()
          .setCustomId(`force_with_me_pick_${game.gameId}_${i}`)
          .setLabel(`Hit ${dcNameFromFigureKey(fk)}`)
          .setStyle(ButtonStyle.Primary)
      );
      btns.push(
        new ButtonBuilder()
          .setCustomId(`force_with_me_skip_${game.gameId}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary)
      );
      await thread.send(sanitizeMentions({
        content: `<@${defOwnerId}> **The Force is With Me** — Ranged attack targeting Chirrut. Choose an adjacent hostile figure to take 1 Damage (and apply **-1 Damage** to the attack results), or Skip:`,
        components: [new ActionRowBuilder().addComponents(btns)],
        allowedMentions: { users: [defOwnerId] },
      }));
    }
  }

  // Loku Recon Token — player-sensitive (game.reconTokens[playerNum], so a mirror
  // match keeps each player's token separate) and only active while a Loku with
  // the ability is ALIVE on that player's team. alexanbv 2026-06-17: "abilities
  // like this should be player-sensitive and only work while the figure is alive."
  const _myRecon = game.reconTokens?.[attackerPlayerNum];
  const _reconOnTarget = _myRecon?.figureKey === target.figureKey;
  // Set Your Sights — Pierce 1 when ANY friendly figure attacks the tokened figure
  // (gated on Loku still being alive — the aura ends if its source is defeated).
  if (_reconOnTarget && _figureWithAbilityAlive(game, attackerPlayerNum, 'set_your_sights_loku')) {
    game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 1;
    await thread.send('**Set Your Sights** — Attacking figure with Recon token: +Pierce 1.');
  }
  // Mon Cala SF — Loku becomes Focused when LOKU attacks the tokened figure
  // (inherently requires the attacker to be a live Loku).
  if (_reconOnTarget && hasMonCalaSfLokuAbility(atkSpecialIds)) {
    applyCondition(game, attackerFigureKey, MON_CALA_SF_LOKU_CONDITION);
    await thread.send('**Mon Cala Special Forces** — Loku gains Focus for attacking Recon-tokened figure.');
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
async function _forceMissAndStep8(thread, game, combat, ctx, message) {
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
    const { enqueueAttackerStep8Effects, enqueueDefenderStep8Effects, postPostResolveWindow } = await import('./after-attack-resolve.js');
    const _step8Deps = {
      getDcEffects: ctx.getDcEffects,
      findDcMessageIdForFigure: ctx.findDcMessageIdForFigure,
      dcNameFromFigureKey,
    };
    enqueueAttackerStep8Effects(combat);
    enqueueDefenderStep8Effects(combat, game, _step8Deps);
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

    // --- Enter reroll window (LEGACY ad-hoc reroll engine) ---
    // Dead in gate mode: the gate drives rerolls via the data-driven rerolls
    // window + the _rerolledDieIds lock, not this forcedRerollQueue/bucket. The
    // legacy block also applied premature side effects (exhaust/deplete) before
    // the player rerolled — skipping it in gate mode fixes that. alexanbv 2026-06-16.
    if (!combat._seqActive) {
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
    // Per alexanbv 2026-05-13: every detected +1 reroll registers as
    // its own named entry in combat.forcedRerollQueue with the holder
    // as controlPlayer. The bucket renders one "Use X" button per
    // entry; the controlled-reroll sub-picker filters by pool when the
    // button is clicked. No anonymous count.
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    const _pushVoluntary = (controlPlayer, pool, source) => {
      combat.forcedRerollQueue.push({ controlPlayer, pool, remaining: 1, source });
    };
    let atkSpecialReroll = 0;
    let defSpecialReroll = 0;
    // Targeting Computer family (HK Assassin Elite, IG-11, Probe Droid Elite,
    // Sentry Droid Elite/Reg, AT-ST, Dark Trooper Mk III ATC): +1 atk reroll
    if (hasTargetingComputerAbility(atkSIds)) {
      _pushVoluntary(attackerPlayerNum, 'attack', 'Targeting Computer');
    }
    // Overpower (Royal Guard Champion): +1 atk reroll restricted to RED die when
    // attacking, +1 def reroll restricted to BLACK die when defending. Color
    // restriction is preserved on the combat.overpower* flags so the picker
    // can enforce it when the queue entry's sub-picker opens.
    if (hasOverpowerAbility(atkSIds)) {
      _pushVoluntary(attackerPlayerNum, 'attack', 'Overpower (red die only)');
      combat.overpowerAtkColorLocked = 'red';
      combat.overpowerAtkLockedAvailable = true;
    }
    if (hasOverpowerAbility(defSIds)) {
      _pushVoluntary(defenderPlayerNum, 'defense', 'Overpower (black die only)');
      combat.overpowerDefColorLocked = 'black';
      combat.overpowerDefLockedAvailable = true;
    }
    // Foresight (Darth Vader defending): +1 def reroll
    if (hasForesightAbility(defSIds)) {
      _pushVoluntary(defenderPlayerNum, 'defense', 'Foresight');
    }
    // Defensive Stance (Diala Passil defending): +1 def reroll. The
    // Dodge-conversion clause is handled at the post-reroll step where
    // combat.defensiveStanceUsed gates it; the queue entry surfaces the
    // ability as a "Use Defensive Stance" bucket button.
    if (hasDefensiveStanceAbility(defSIds)) {
      _pushVoluntary(defenderPlayerNum, 'defense', 'Defensive Stance');
    }
    // Charge Generators (AT-DP attacking): +1 atk reroll + +1 Hit if < 9 damage suffered
    if (hasChargeGeneratorsAbility(atkSIds)) {
      const atkHpA = dcHS?.get(combat.attackerMsgId) || [];
      const atkFHp = atkHpA[combat.attackerFigureIndex ?? 0];
      const atkDs = atkFHp ? Math.max(0, (atkFHp[1] ?? atkFHp[0] ?? 0) - (atkFHp[0] ?? 0)) : 0;
      if (chargeGeneratorsApplies(atkDs)) {
        // applyChargeGeneratorsBonus returns the +1 Hit; we only need
        // the bonusHits half here — the reroll piece registers as a
        // queue entry instead of summing into a count.
        const { bonusHits } = applyChargeGeneratorsBonus(combat, 0);
        combat.bonusHits = bonusHits;
        _pushVoluntary(attackerPlayerNum, 'attack', 'Charge Generators');
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
          _pushVoluntary(attackerPlayerNum, 'attack', `Inspiring (${fn})`);
          await thread.send(`**Inspiring** (${fn}) — friendly within 3 spaces, +1 attack reroll granted.`).catch(discordCatch);
          break;
        }
      }
    }
    // Soresu Form (Kanan Jarrus) — MOVED to the gate: the reroll is offered in
    // the rerolls window (CSV row), and its bespoke resolver
    // (COMBAT_RESOLVERS['reroll:kanan_jarrus:defender']) sets soresuFormFigKey
    // ONLY when the reroll is taken, so the resolve-step Dodge conversion + Kanan
    // strain fire on-use (not eagerly). alexanbv 2026-06-16.

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
            _pushVoluntary(defenderPlayerNum, 'defense', 'Cower');
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
            _pushVoluntary(attackerPlayerNum, 'attack', 'Squad Training'); break;
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
        _pushVoluntary(attackerPlayerNum, 'attack', 'Coordinated Hunt');
        _chApplied = true;
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
                _pushVoluntary(attackerPlayerNum, 'attack', `Coordinated Hunt (${fn})`);
                _chApplied = true; break;
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
        if (!targetHadLos) _pushVoluntary(attackerPlayerNum, 'attack', 'Light It Up');
      }
    }

    // Sling Barrage (Ewok Warrior Elite): +1 atk reroll per OTHER figure in the same group with LOS to defender.
    // "Group" = same DC name + same deployment-group index (figure-key prefix `${dcName}-${dgIndex}-`).
    if (combat.attackerFigureKey && game.pendingSlingBarrage?.[combat.attackerFigureKey]) {
      delete game.pendingSlingBarrage[combat.attackerFigureKey];
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
            for (let _sbI = 0; _sbI < sbBonus; _sbI++) {
              _pushVoluntary(attackerPlayerNum, 'attack', `Sling Barrage #${_sbI + 1}`);
            }
            await thread.send(`**Sling Barrage** — ${sbBonus} other group-mate${sbBonus === 1 ? '' : 's'} with LOS to defender: +${sbBonus} attack reroll${sbBonus === 1 ? '' : 's'}.`).catch(discordCatch);
          }
        }
      }
    }

    // Build forced reroll queue for Batch 2B abilities. NB (alexanbv
    // 2026-05-13): voluntary +1 reroll abilities also live on this
    // queue now via `_pushVoluntary` above, so we must NOT reset the
    // queue here — append-only.
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
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
          // Per alexanbv 2026-06-13: Survival is Strength is once per ATTACK,
          // not once per round — track on the per-attack combat object.
          if (combat._survivalIsStrengthUsed?.[_sisFk]) continue;
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
            // Per alexanbv 2026-05-13: register queue entry WITHOUT
            // exhausting the attachment. The exhaust fires only when
            // the player clicks "Use Trusted Ally" and resolves the
            // reroll (see _fireExhaustOnConsume in handleCombatReroll
            // sub-picker path). Skipping the reroll via Continue
            // leaves the attachment unexhausted.
            combat.forcedRerollQueue = combat.forcedRerollQueue || [];
            combat.forcedRerollQueue.push({
              controlPlayer: attackerPlayerNum,
              pool: 'attack',
              remaining: 1,
              source: `Trusted Ally (${fn})`,
              exhaustAttachment: { msgId: _taMid, name: 'Trusted Ally' },
            });
            combat._trustedAllyGrantedThisAttack = true;
            await thread.send(`**Trusted Ally** (${fn}) — friendly within 3 spaces: +1 attack reroll button added. Attachment exhausts only if you click "Use Trusted Ally".`).catch(discordCatch);
            break;
          }
          if (combat._trustedAllyGrantedThisAttack) break; // only one Trusted Ally bonus per attack
        }
      }
    }
    // Migrate remaining +1 reroll sources to named queue entries
    // (alexanbv 2026-05-13). atkSpecialReroll / defSpecialReroll are
    // 0 at this point — every special-ability detection above pushes
    // directly via _pushVoluntary. Innate text-parsed rerolls,
    // attachment grants, round CCs, and Self-Augmentation each push
    // their own named entry too.
    {
      // Innate text-parsed (Driven by Hatred, Saber Strike, Han Solo
      // Scoundrel, generic "While attacking, you may reroll N" cards).
      const _atkInnateAbs = getInnateRerollAbilities(combat.attackerDcName);
      for (const ab of _atkInnateAbs) {
        if (ab.pool !== 'attack' && ab.pool !== 'any') continue;
        for (let _i = 0; _i < (ab.remainingUses || 1); _i++) {
          _pushVoluntary(attackerPlayerNum, ab.pool, ab.label || 'Innate Attack Reroll');
        }
      }
      const _defInnateAbs = getInnateRerollAbilities(defenderDcName);
      for (const ab of _defInnateAbs) {
        if (ab.pool !== 'defense' && ab.pool !== 'any') continue;
        for (let _i = 0; _i < (ab.remainingUses || 1); _i++) {
          _pushVoluntary(defenderPlayerNum, ab.pool, ab.label || 'Innate Defense Reroll');
        }
      }
      // Targeting Computer attachment.
      for (let _i = 0; _i < (combat.rerollOneAttackDie || 0); _i++) {
        _pushVoluntary(attackerPlayerNum, 'attack', 'Targeting Computer (attachment)');
      }
      // Round-scoped CC effect that grants attack rerolls.
      for (let _i = 0; _i < (game.roundAttackRerollDice?.[attackerPlayerNum] || 0); _i++) {
        _pushVoluntary(attackerPlayerNum, 'attack', 'Round CC Reroll');
      }
      // Self-Augmentation attachment.
      if (game.selfAugmentationMsgId?.[combat.attackerMsgId]) {
        _pushVoluntary(attackerPlayerNum, 'attack', 'Self-Augmentation');
      }
      // Per alexanbv 2026-05-13: The Darksaber attachment (Maul or
      // Sabine Wren ONLY) — "Exhaust this card while attacking to
      // reroll 1 attack die." Detection: attacker's DC has the
      // attached SU "[The Darksaber]" AND it's not already exhausted.
      // Registered as a queue entry with exhaustAttachment payload
      // so the card exhausts ONLY when the player clicks "Use The
      // Darksaber" and resolves the reroll (lazy exhaust per
      // alexanbv 2026-05-13 rule).
      {
        const _dsAtts = game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || [];
        if (cardNameIncludes(_dsAtts, 'The Darksaber')) {
          const _dsExh = game.exhaustedSkirmishUpgrades?.[combat.attackerMsgId] || [];
          if (!cardNameIncludes(_dsExh, 'The Darksaber')) {
            combat.forcedRerollQueue = combat.forcedRerollQueue || [];
            combat.forcedRerollQueue.push({
              controlPlayer: attackerPlayerNum,
              pool: 'attack',
              remaining: 1,
              source: 'The Darksaber',
              exhaustAttachment: { msgId: combat.attackerMsgId, name: 'The Darksaber' },
            });
          }
        }
      }
      // Guardian Stance / defenderRerollDiceMax (CC that grants the
      // defender a flexible reroll pool). Each unit becomes one entry
      // with pool='any' so the picker shows attack + defense dice.
      for (let _i = 0; _i < (combat.defenderRerollDiceMax || 0); _i++) {
        _pushVoluntary(defenderPlayerNum, 'any', 'Guardian Stance');
      }
    }
    // Legacy count fields kept for back-compat with handleCombatReroll
    // decrement paths during the migration. Set from the queue size so
    // existing "remaining <= 0" exit conditions still work; will be
    // deleted in Slice 4 once the bucket renderer/done-condition use
    // queue length only.
    const atkRerolls = (combat.forcedRerollQueue || [])
      .filter(e => e.controlPlayer === attackerPlayerNum && (e.pool === 'attack' || e.pool === 'any'))
      .reduce((n, e) => n + (e.remaining ?? 0), 0);
    const defRerolls = (combat.forcedRerollQueue || [])
      .filter(e => e.controlPlayer === defenderPlayerNum && (e.pool === 'defense' || e.pool === 'any'))
      .reduce((n, e) => n + (e.remaining ?? 0), 0);
    // Per alexanbv 2026-05-13: there is no "pre-reroll" phase. Each
    // step-3 reroll ability surfaces as its own button in the
    // attacker/defender bucket and is user-controlled in any order.
    // Detect eligibility now; the bucket renderer in sendRerollUI
    // shows a "Use X" button per available ability. Each resolves
    // and marks itself used, then returns to the bucket.
    combat.rerollAbilities = combat.rerollAbilities || {};
    if (atkSIds.includes('twin_sabers_ahsoka')) {
      combat.rerollAbilities.twinSabers = { playerNum: attackerPlayerNum, used: false };
    }
    if (atkSIds.includes('resourceful_lando') || defSIds.includes('resourceful_lando')) {
      const _resPlayer = atkSIds.includes('resourceful_lando') ? attackerPlayerNum : defenderPlayerNum;
      const _resSIds = atkSIds.includes('resourceful_lando') ? atkSIds : defSIds;
      if (_resSIds.includes('shrewd_scoundrel_lando')) {
        combat.rerollAbilities.shrewdScoundrel = { playerNum: _resPlayer, used: false };
      }
      if (_resSIds.includes('gambit_lando')) combat.gambitActive = true;
      combat.rerollAbilities.resourceful = { playerNum: _resPlayer, used: false };
    }
    if (atkSIds.includes('trained_rancor')) {
      combat.rerollAbilities.trained = { playerNum: attackerPlayerNum, used: false };
    }
    // Per alexanbv 2026-05-13: Power Converter (Saska Teft) — was an
    // auto-prompt to attacker's hand channel. Now a complex
    // rerollAbilities entry that surfaces as a "Use Power Converter
    // (Saska)" attacker bucket button. Click → die picker → color
    // picker → swap + reroll → mark used. Skipping via Continue does
    // NOT consume the round flag. Eligibility: attacker has Device
    // token AND a friendly DC has power_converter_saska AND not
    // already used this round.
    // Per alexanbv 2026-06-13: once per round by ANY figure on this side
    // (multiple figures may hold device tokens) — keyed per player.
    if (!game.powerConverterUsedThisRound?.[attackerPlayerNum]
        && (game.deviceTokens?.[combat.attackerFigureKey] || 0) > 0) {
      const _pcDcList = getDcList(game, attackerPlayerNum) || [];
      let _pcFound = false;
      for (let i = 0; i < _pcDcList.length; i++) {
        const _pcDcName = _pcDcList[i]?.dcName;
        const _pcEff = getDcEff()[_pcDcName] || getDcEff()[(_pcDcName || '').replace(/\s*\[.*\]\s*$/, '')];
        if ((_pcEff?.specialAbilityIds || []).includes('power_converter_saska')) { _pcFound = true; break; }
      }
      if (_pcFound) {
        combat.rerollAbilities.powerConverter = { playerNum: attackerPlayerNum, used: false };
      }
    }
    // Veteran Instincts defense prompt REMOVED 2026-05-09: card is a
    // one-time token distributor, not a per-attack/defense bonus
    // opportunity. Tokens are granted on play; the legacy "active
    // during attacks/defenses" flag was an over-implementation.
    // [Doubt] SU: per alexanbv 2026-05-13 the deplete-to-force-atk-
    // reroll happens DURING step 3 (the reroll phase), not via an
    // auto-prompt between dice-roll and reroll buckets. Register as a
    // forcedRerollQueue entry with a depleteDc payload — defender
    // sees "Use [Doubt]" in their bucket and clicking it opens the
    // pool-filtered atk-die picker; reroll consumes the entry and
    // deplete fires lazily via _fireExhaustOnConsume.
    {
      const _dbtDcList = getDcList(game, defenderPlayerNum) || [];
      const _dbtMsgIds = getDcMessageIds(game, defenderPlayerNum) || [];
      for (let i = 0; i < _dbtDcList.length; i++) {
        const _dbtDc = _dbtDcList[i];
        if ((_dbtDc?.dcName || _dbtDc) !== '[Doubt]') continue;
        const _dbtMid = _dbtMsgIds[i];
        if (!_dbtMid) continue;
        const _dbtDepleted = (game.p1DepletedDcMessageIds || []).includes(_dbtMid) || (game.p2DepletedDcMessageIds || []).includes(_dbtMid);
        if (_dbtDepleted) continue;
        combat.forcedRerollQueue = combat.forcedRerollQueue || [];
        combat.forcedRerollQueue.push({
          controlPlayer: defenderPlayerNum,
          pool: 'attack',
          remaining: 1,
          source: '[Doubt]',
          depleteDc: { msgId: _dbtMid, playerNum: defenderPlayerNum },
        });
        break; // one Doubt per defender per attack
      }
    }
    // alexanbv 2026-05-13: deprecated count-field assignment removed.
    // Queue entries (combat.forcedRerollQueue) are now the single
    // source of truth for reroll availability; atkRerolls/defRerolls
    // are computed but unused — kept only because the back-compat
    // shim getInnateRerolls + the AI engine still read them.
    void atkRerolls; void defRerolls;
    } // end legacy reroll engine (skipped entirely in gate mode)
    // Legacy per-side reroll-index trackers (the gate uses _rerolledDieIds);
    // initialized here for any legacy-handler back-compat.
    combat.attackerRerolledIndices = [];
    combat.defenderRerolledIndices = [];
    if (combat._seqActive) {
      // Rebuild path: roll is complete → advance the sequence to the rerolls window.
      await _advanceSequence(combat, _seqHandlers(thread, game, combat, ctx));
    } else {
      // Combat gate: both players review dice results before reroll window
      await sendCombatGate(thread, game, combat, 'post_roll', ctx);
    }
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
  game.figurePowerTokens = game.figurePowerTokens || {};
  const _cur = game.figurePowerTokens[pending.attackerFigureKey] || [];
  game.figurePowerTokens[pending.attackerFigureKey] = [..._cur, tokenType];
  pending.tokenChosen = tokenType;
  await interaction.channel.send(`**Flawless Execution** — Cad Bane gains 1 **${tokenType}** token (may be spent immediately on this attack).`).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `**Flawless Execution** — +1 ${tokenType} token to Cad Bane.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  if (pending.dieChosen && pending.tokenChosen) delete game.pendingFlawlessExecution;
  saveGames(game.gameId);
}

/**
 * Per alexanbv 2026-05-13: shared post-reroll trigger helper. The
 * legacy voluntary-reroll decrement path (lines ~4830) and the
 * controlled-reroll sub-picker path (lines ~4700) both need to fire:
 *   - Advanced Targeting Computer (Dark Trooper Mk III): rerolled
 *     atk die has fewer Hits → +1 Hit, limit once per attack.
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
          if (thread) await thread.send('**Advanced Targeting Computer** — Rerolled die has fewer Hits: +1 Hit applied.').catch(() => {});
        }
      }
    } catch { /* non-fatal */ }
  }
  // Tough Luck — offer to BOTH the die-owner side AND the player who
  // caused the reroll, per user spec. The die just rerolled is an
  // atk die owned by the attacker; the rerolling player is whoever
  // controlled this queue entry (abilityHolderPN). If they differ,
  // either side may have TL.
  const _tlCandidates = new Set();
  if (game.toughLuckPlayerNum) {
    // The die's owner side (attacker for atk die). TL is the opponent
    // of the die-owner — for an atk die that's the defender.
    if (game.toughLuckPlayerNum === defenderPlayerNum) _tlCandidates.add(defenderPlayerNum);
    // The rerolling player — e.g. defender's Doubt that just rerolled
    // the attacker's die; if the rerolling player also has TL, they
    // get a prompt too. For a sub-picker path the holder is in
    // abilityHolderPN — TL ownership is read from game.toughLuckPlayerNum
    // which is set per-player when their TL prep fires.
    if (game.toughLuckPlayerNum === abilityHolderPN) _tlCandidates.add(abilityHolderPN);
  }
  for (const _tlPN of _tlCandidates) {
    setPendingToughLuck(game, { side: 'atk', idx });
    const _tlOwner = game[`player${_tlPN}Id`] ?? '';
    const _tlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tough_luck_remove_${gameId}_${idx}`).setLabel(`Remove rerolled ${newDie.color} die`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`tough_luck_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    );
    if (thread) await thread.send({ content: `**Tough Luck** — <@${_tlOwner}> may remove the rerolled attack die.`, components: [_tlRow] }).catch(() => {});
  }
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

async function maybePromptRerollYn(thread, game, combat, phase) {
  const gameId = game.gameId;
  // Per alexanbv 2026-05-12: always post the Y/N so each player gets
  // exactly one prompt per step (matches step-4 sendModsYn cadence).
  // The reroll pool is NOT finalized at step entry — Targeting Network
  // and similar CCs can be played in this window to grant a reroll —
  // so the bot must give the player a moment regardless of pre-window
  // counts. Self-play skips via the early returns in sendRerollUI.
  // Per alexanbv 2026-05-13: skip the Y/N when pre-roll abilities
  // (Twin Sabers, Resourceful, Shrewd Scoundrel, Trained) already
  // posted their own attacker-side prompts — those WERE the
  // attacker's step-3 moment, so a separate Y/N after them is a
  // redundant second prompt. Defender branch never has pre-rerolls
  // (they're attacker-side only).
  if (phase === 'attacker') {
    if (combat.rerollYnAskedAttacker) return false;
    // Per alexanbv 2026-05-13: there is no separate "pre-reroll" phase.
    // Twin Sabers / Resourceful / Shrewd Scoundrel / Trained are step-3
    // reroll abilities and belong inside the single unified attacker
    // step-3 Y/N window. The Y/N fires FIRST regardless of pending
    // ability prompts; on Yes, sendRerollUI's picker walks through
    // those abilities then voluntary die-picks; on No, all pending
    // attacker-side reroll abilities are skipped together.
    combat.rerollYnAskedAttacker = true;
    const atkPn = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1;
    const atkOwnerId = atkPn === 1 ? game.player1Id : game.player2Id;
    const _atkPnGate = combat.attackerPlayerNum || 1;
    const _atkQueueCount = _countQueueRerollsForSide(combat, _atkPnGate, 'attack');
    const yesLabel = _atkQueueCount > 0
      ? `Yes — open reroll bucket (${_atkQueueCount} ability button${_atkQueueCount === 1 ? '' : 's'})`
      : 'Yes — play a CC for a reroll';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_atk_yes`)
        .setLabel(yesLabel)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_atk_no`)
        .setLabel('No — skip')
        .setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: `<@${atkOwnerId}> — **Attacker: Reroll attack dice?** (CRR step 3) Play any CCs / abilities that grant rerolls from your hand channel, then click below.`,
      components: [row],
      allowedMentions: { users: [atkOwnerId] },
    }).catch(discordCatch);
    return true;
  }
  if (phase === 'defender') {
    if (combat.rerollYnAskedDefender) return false;
    combat.rerollYnAskedDefender = true;
    const defPn = opponentPlayerNum(combat.attackerPlayerNum ?? 1);
    const defOwnerId = defPn === 1 ? game.player1Id : game.player2Id;
    const ctAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    const _defPnGate = opponentPlayerNum(combat.attackerPlayerNum || 1);
    const _defQueueCount = _countQueueRerollsForSide(combat, _defPnGate, 'defense');
    const parts = [];
    if (_defQueueCount > 0) parts.push(`${_defQueueCount} ability button${_defQueueCount === 1 ? '' : 's'}`);
    if (ctAvailable) parts.push('Cross Training');
    const yesLabel = (_defQueueCount > 0 || ctAvailable)
      ? `Yes — open reroll bucket (${parts.join(' + ')})`.slice(0, 80)
      : 'Yes — play a CC for a reroll';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_def_yes`)
        .setLabel(yesLabel)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`combat_reroll_yn_${gameId}_def_no`)
        .setLabel('No — skip')
        .setStyle(ButtonStyle.Secondary),
    );
    await thread.send({
      content: `<@${defOwnerId}> — **Defender: Reroll defense dice?** (CRR step 3) Play any CCs / abilities that grant rerolls from your hand channel, then click below.`,
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
    // Per alexanbv 2026-05-13: defender side with nothing left to do
    // must actually advance to step 4. The prior shape just cleared
    // rerollPhase and returned, leaving combat stalled (the bug
    // triggered when neither player had reroll abilities and the
    // defender clicked Yes on the always-on step-3 Y/N).
    // Synthesize a defender 'done' click to route through the
    // existing post_defender_reroll dispatch which advances to step 4.
    combat.rerollPhase = null;
    combat.controlledRerollSide = null;
    await sendCombatGate(thread, game, combat, 'post_defender_reroll', {
      saveGames: () => {},
      // dispatchCombatGateAdvance('post_defender_reroll') calls
      // _enterStep4 which only uses ctx for the Lasat picker + the
      // selfPlay branch. In the always-Y/N path we're on, neither
      // is reachable here, so the stripped ctx is sufficient.
    });
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
    // Per alexanbv 2026-05-13: no pre-reroll phase. Step-3 reroll
    // abilities (Twin Sabers, Resourceful, Shrewd Scoundrel, Trained)
    // each render a "Use X" button in the bucket; the player picks
    // any order. Click → sub-picker → resolve → mark used → bucket
    // re-renders. Eligibility is tracked on combat.rerollAbilities.
    // Per alexanbv 2026-05-13: bucket renders ONLY named "Use X"
    // ability buttons. No anonymous die-picks — every reroll ability
    // (passive +1, forced, complex) is its own bucket button. Click
    // any ability button → controlled-reroll sub-picker filters by
    // pool and excludes alreadyRerolled.
    const atkPN = combat.attackerPlayerNum || 1;
    const _atkCtrl = (combat.forcedRerollQueue || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.controlPlayer === atkPN && (e.remaining ?? 0) > 0);
    const _atkAvailableAbilities = _countUnusedAttackerRerollAbilities(combat);
    if (_atkCtrl.length === 0 && _atkAvailableAbilities === 0) {
      await _advanceFromForced();
      return;
    }
    const dieButtons = [];
    for (const { e, i } of _atkCtrl) {
      const _poolHint = e.pool === 'any' ? '' : ` (${e.pool})`;
      dieButtons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_ctrl_${i}`)
          .setLabel(`Use ${e.source}${_poolHint}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    // Complex step-3 abilities (Twin Sabers, Resourceful, Shrewd
    // Scoundrel, Trained). Each opens its own sub-picker via
    // handlePreReroll.
    const _atkAbilityCount = _appendAttackerRerollAbilityButtons(gameId, combat, dieButtons);
    const trailing = [
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_atk_done`)
        .setLabel('Continue (no more rerolls)')
        .setStyle(ButtonStyle.Primary),
    ];
    const _atkParts = [];
    if (_atkCtrl.length > 0) _atkParts.push(`${_atkCtrl.length} reroll-ability button${_atkCtrl.length > 1 ? 's' : ''}`);
    if (_atkAbilityCount > 0) _atkParts.push(`${_atkAbilityCount} complex-ability button${_atkAbilityCount > 1 ? 's' : ''}`);
    await thread.send({
      content: `**Reroll Window (Attacker)** — ${_atkParts.join(' + ')}. Pick any in any order, or Continue.`,
      components: buildRerollRows(dieButtons, trailing),
    });
  } else {
    // Per alexanbv 2026-05-13: bucket renders ONLY named "Use X"
    // ability buttons. No anonymous die-picks. The deprecated
    // combat.defenderRerollsRemaining read is gone — the bucket
    // sources solely from forcedRerollQueue + rerollAbilities +
    // Cross Training.
    const ctAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    const defPN = opponentPlayerNum(combat.attackerPlayerNum || 1);
    const _defCtrl = (combat.forcedRerollQueue || [])
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.controlPlayer === defPN && (e.remaining ?? 0) > 0);
    const _defAvailableAbilities = _countUnusedRerollAbilitiesForPlayer(combat, defPN);
    if (!ctAvailable && _defCtrl.length === 0 && _defAvailableAbilities === 0) {
      await _advanceFromForced();
      return;
    }
    const dieButtons = [];
    for (const { e, i } of _defCtrl) {
      const _poolHint = e.pool === 'any' ? '' : ` (${e.pool})`;
      dieButtons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_ctrl_${i}`)
          .setLabel(`Use ${e.source}${_poolHint}`)
          .setStyle(ButtonStyle.Primary),
      );
    }
    // Complex step-3 abilities for the defender (Resourceful when
    // Lando is defender, Shrewd Scoundrel ditto, Guardian Stance).
    _appendRerollAbilityButtonsForPlayer(gameId, combat, defPN, dieButtons);
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
        .setLabel('Continue (no more rerolls)')
        .setStyle(ButtonStyle.Primary)
    );
    const actionRows = buildRerollRows(dieButtons, trailing);
    const parts = [];
    if (ctAvailable) parts.push('Cross Training');
    if (_defCtrl.length > 0) parts.push(`${_defCtrl.length} reroll-ability button${_defCtrl.length > 1 ? 's' : ''}`);
    if (_defAvailableAbilities > 0) parts.push(`${_defAvailableAbilities} complex-ability button${_defAvailableAbilities > 1 ? 's' : ''}`);
    await thread.send({
      content: `**Reroll Window (Defender)** — ${parts.join(' + ')}. Pick any in any order, or Continue.`,
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
  // No: advance directly via the post-reroll gate using the thread
  // we already fetched. Previous shape synthesized a 'combat_reroll_*_done'
  // click and called handleCombatReroll, which re-fetched the thread and
  // threw "combat thread is null" when the second fetch came back empty
  // (alexanbv 2026-05-13 live repro). Skip the synthetic interaction and
  // dispatch the gate directly with our verified thread reference.
  if (side === 'atk') {
    await sendCombatGate(thread, game, combat, 'post_attacker_reroll', ctx);
  } else {
    await sendCombatGate(thread, game, combat, 'post_defender_reroll', ctx);
  }
  saveGames(game.gameId);
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
  // alexanbv 2026-05-13: 'forced' phase retired; the guard is now just
  // "is an ability sub-picker open?".
  if (combat.controlledRerollActiveIdx != null) {
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
          // Once per ATTACK (alexanbv 2026-06-13): flag on the combat object,
          // which is scoped to this single attack and discarded after.
          combat._survivalIsStrengthUsed = combat._survivalIsStrengthUsed || {};
          combat._survivalIsStrengthUsed[_spEntry.armorerFigKey] = true;
        }
        // Per alexanbv 2026-05-13: lazy exhaust/deplete fires here, on
        // actual reroll consumption. Skipping via Continue leaves the
        // card unexhausted.
        await _fireExhaustOnConsume(game, _spEntry, thread);
        await thread.send(`**${_spEntry.source}** reroll ATK ${oldDie.color} #${idx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`);
        // Per alexanbv 2026-05-13: post-reroll conditional triggers
        // (Advanced Targeting Computer +1 Hit, Tough Luck prompt) must
        // fire whether the reroll came from the legacy voluntary path
        // or the controlled-reroll sub-picker. Shared helper covers
        // both.
        await _fireAttackerPostRerollTriggers({ game, combat, thread, ctx, gameId, oldDie, newDie, idx, attackerPlayerNum, defenderPlayerNum, abilityHolderPN: _spEntry.controlPlayer });
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
        await _fireExhaustOnConsume(game, _spEntry, thread);
        if (!combat.defenderRerolledIndices) combat.defenderRerolledIndices = [];
        if (!combat.defenderRerolledIndices.includes(idx)) combat.defenderRerolledIndices.push(idx);
        const dodgeTag = newDie.dodge ? '/DODGE' : '';
        await thread.send(`**${_spEntry.source}** reroll DEF ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
        // Demoralizing Monologue post-reroll reveal prompt. The
        // reveal-hand prompt is a follow-up; the queue entry itself
        // is consumed normally. Cleanup runs BEFORE the prompt so the
        // entry doesn't linger at remaining=0 between this consume
        // and the reveal-hand resolution.
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
          // Cleanup the consumed entry now so the bucket re-render
          // after the reveal-hand prompt resolves doesn't show a
          // stale "Use Demoralizing Monologue" button at remaining=0.
          if ((_spEntry.remaining ?? 0) <= 0) {
            const _dmRemoveAt = combat.forcedRerollQueue.indexOf(_spEntry);
            if (_dmRemoveAt >= 0) combat.forcedRerollQueue.splice(_dmRemoveAt, 1);
          }
          combat.controlledRerollActiveIdx = null;
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
  //
  // Per alexanbv 2026-05-13: the bucket no longer surfaces anonymous
  // die-pick buttons — every reroll fires via the controlled-reroll
  // sub-picker (combat.controlledRerollActiveIdx) handled earlier in
  // this function. The voluntary die-pick branches below are reached
  // only by stale customIds (e.g. a click on a button posted before
  // Slice 3 went live). We still process them so live games in
  // mid-attack don't strand; the die-pick decrements the matching
  // queue entry instead of the deleted attackerRerollsRemaining /
  // defenderRerollsRemaining count fields. Each branch consumes the
  // FIRST eligible voluntary queue entry (one whose pool matches the
  // die's pool and the active side).
  const _consumeQueueEntryForSide = (poolForSide) => {
    const _side = poolForSide === 'attack' ? attackerPlayerNum : defenderPlayerNum;
    const q = combat.forcedRerollQueue || [];
    for (const entry of q) {
      if (entry.controlPlayer !== _side) continue;
      if (entry.pool !== poolForSide && entry.pool !== 'any') continue;
      if ((entry.remaining ?? 0) <= 0) continue;
      entry.remaining = (entry.remaining ?? 0) - 1;
      return true;
    }
    // Back-compat: legacy callers/tests still set the count fields
    // directly (no queue entry). Decrement them as a fallback so the
    // die-reroll flow records the consumption.
    if (poolForSide === 'attack' && (combat.attackerRerollsRemaining ?? 0) > 0) {
      combat.attackerRerollsRemaining -= 1;
      return true;
    }
    if (poolForSide === 'defense' && (combat.defenderRerollsRemaining ?? 0) > 0) {
      combat.defenderRerollsRemaining -= 1;
      return true;
    }
    return false;
  };
  let _tlTriggered = false;
  if (choice !== 'done') {
    const idx = parseInt(choice, 10);
    if (side === 'atk') {
      const dice = combat.attackDiceResults || [];
      const _atkAlreadyRerolled = combat.attackerRerolledIndices || [];
      const _atkQueueAvail = _countQueueRerollsForSide(combat, attackerPlayerNum, 'attack');
      // Overpower (RGC): one slot of the attacker reroll budget is locked to
      // the configured color (red). Picking a non-locked-color die requires
      // at least 1 non-Overpower slot remaining; picking a matching-color die
      // consumes the locked slot first.
      if (idx >= 0 && idx < dice.length && _atkQueueAvail > 0 && !_atkAlreadyRerolled.includes(idx)) {
        const _opLockColor = combat.overpowerAtkColorLocked;
        const _opLockAvail = !!combat.overpowerAtkLockedAvailable;
        const _opPickColor = dice[idx]?.color;
        if (_opLockColor && _opPickColor && _opPickColor !== _opLockColor) {
          const _opNonLocked = _atkQueueAvail - (_opLockAvail ? 1 : 0);
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
        _consumeQueueEntryForSide('attack');
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
        // Per alexanbv 2026-05-13: ATC + Tough Luck triggers now live
        // in the shared _fireAttackerPostRerollTriggers helper so they
        // fire from both the legacy voluntary path and the
        // controlled-reroll sub-picker.
        await _fireAttackerPostRerollTriggers({
          game, combat, thread, ctx, gameId, oldDie, newDie, idx,
          attackerPlayerNum, defenderPlayerNum,
          abilityHolderPN: attackerPlayerNum, // voluntary path: attacker's own reroll
        });
        if (game.pendingToughLuck) _tlTriggered = true;
      }
    } else {
      const dice = combat.defenseDiceResults || [];
      const _defAlreadyRerolled = combat.defenderRerolledIndices || [];
      const _defQueueAvail = _countQueueRerollsForSide(combat, defenderPlayerNum, 'defense');
      // Overpower (RGC): one slot of defender reroll budget is locked to
      // the configured color (black) — same scheme as the attacker side.
      if (idx >= 0 && idx < dice.length && _defQueueAvail > 0 && !_defAlreadyRerolled.includes(idx)) {
        const _opDefLockColor = combat.overpowerDefColorLocked;
        const _opDefLockAvail = !!combat.overpowerDefLockedAvailable;
        const _opDefPickColor = dice[idx]?.color;
        if (_opDefLockColor && _opDefPickColor && _opDefPickColor !== _opDefLockColor) {
          const _opDefNonLocked = _defQueueAvail - (_opDefLockAvail ? 1 : 0);
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
        _consumeQueueEntryForSide('defense');
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
  if (side === 'atk' && (choice === 'done' || _countQueueRerollsForSide(combat, attackerPlayerNum, 'attack') <= 0)) {
    // Combat gate: both players review attacker rerolls before proceeding
    await sendCombatGate(thread, game, combat, 'post_attacker_reroll', ctx);
    saveGames(game.gameId);
    return;
  }
  if (side === 'def' && (choice === 'done' || (_countQueueRerollsForSide(combat, defenderPlayerNum, 'defense') <= 0 && !(combat.crossTrainingAvailable && !combat.crossTrainingUsed)))) {
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
      exhaustAttachment(game, ctMsgId, 'Cross Training');
    }
    const dodgeTag = newDie.dodge ? '/DODGE' : '';
    await thread.send(`**Cross Training** — Exhausted. Swapped ${oldColor} → ${newColor} die #${dieIdx + 1}, rerolled: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);

    // Check if defender still has rerolls or should finish
    const ctStillAvailable = combat.crossTrainingAvailable && !combat.crossTrainingUsed;
    if (_countQueueRerollsForSide(combat, defenderPlayerNum, 'defense') <= 0 && !ctStillAvailable) {
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
 * Handle step-3 reroll-ability button clicks
 * (pre_reroll_{gameId}_{choice}).
 *
 * Per alexanbv 2026-05-13: step-3 reroll abilities (Twin Sabers,
 * Resourceful, Shrewd Scoundrel, Trained) live as "Use X" buttons in
 * the attacker bucket and resolve in any player-chosen order. There is
 * no pre-reroll queue — eligibility is tracked on
 * combat.rerollAbilities[name] = { playerNum, used }.
 *
 * Customary shapes handled here:
 *   open_<ability>      — post the ability's sub-picker (atk/def/skip
 *                         for Twin Sabers, guess buttons for Shrewd
 *                         Scoundrel, suffer/skip for Trained, etc.).
 *   twin_sabers_(atk|def)        — resolve Twin Sabers choice.
 *   resourceful_(atk|def)        — resolve Resourceful choice.
 *   trained_(yes|no)             — resolve Trained choice.
 *   shrewd_(0|1|2)               — resolve Shrewd Scoundrel guess.
 *   skip                         — skip the most recently opened ability
 *                                  (used by Twin Sabers / Resourceful /
 *                                  Shrewd Scoundrel sub-picker Skip
 *                                  buttons).
 *
 * Every resolution path marks the corresponding
 * combat.rerollAbilities entry as used and re-renders the bucket so
 * the player can pick another ability or click Done.
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
  const abilities = combat.rerollAbilities || {};
  const thread = await fetchCombatThread(interaction.client, combat.combatThreadId);

  // Identify the ability this click belongs to. open_<X> posts a
  // sub-picker; the existing choice strings (twin_sabers_*, etc.)
  // resolve their ability. 'skip' is the most-recently-opened
  // ability's skip button — we read it off combat.openedRerollAbility.
  const abilityFromChoice = (c) => {
    if (c.startsWith('open_')) return c.slice('open_'.length);
    if (c.startsWith('twin_sabers_')) return 'twinSabers';
    if (c.startsWith('resourceful_')) return 'resourceful';
    if (c.startsWith('trained_')) return 'trained';
    if (c.startsWith('shrewd_')) return 'shrewdScoundrel';
    if (c === 'skip') return combat.openedRerollAbility || null;
    return null;
  };
  const abilityKey = abilityFromChoice(choice);
  if (!abilityKey) {
    await interaction.followUp({ content: 'Unknown reroll-ability choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const abilityState = abilities[abilityKey];
  if (!abilityState) {
    await interaction.followUp({ content: 'That reroll ability is no longer available.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, abilityState.playerNum, canActAsPlayer, `Only **${getPlayerDisplayName(game, abilityState.playerNum, interaction.client)}** can make this choice.`)) return;
  if (abilityState.used) {
    await interaction.followUp({ content: 'That reroll ability has already been used this attack.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // open_<X> — post the sub-picker, store opened ability for the
  // shared 'skip' button to know which ability to mark used.
  if (choice.startsWith('open_')) {
    combat.openedRerollAbility = abilityKey;
    const playerId = abilityState.playerNum === 1 ? game.player1Id : game.player2Id;
    if (abilityKey === 'twinSabers') {
      const atkCount = (combat.attackDiceResults || []).length;
      const defCount = (combat.defenseDiceResults || []).length;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_atk`).setLabel(`Reroll all ${atkCount} ATK dice`).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_def`).setLabel(`Force reroll all ${defCount} DEF dice`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Twin Sabers** — <@${playerId}> choose:`, components: [row] });
    } else if (abilityKey === 'shrewdScoundrel') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_0`).setLabel('Guess 0 Damage').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_1`).setLabel('Guess 1 Damage').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_2`).setLabel('Guess 2 Damage').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Cancel (no guess)').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Shrewd Scoundrel** — <@${playerId}> guess the number of Hit results after rerolls (0-2):`, components: [row] });
    } else if (abilityKey === 'resourceful') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_atk`).setLabel('Reroll 1 ATK die').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_def`).setLabel('Reroll 1 DEF die').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Resourceful** — <@${playerId}> choose:`, components: [row] });
    } else if (abilityKey === 'trained') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_yes`).setLabel('Suffer 1 Strain, +1 ATK reroll').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_no`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Trained** — <@${playerId}> suffer 1 Strain to reroll 1 attack die?`, components: [row] });
    } else if (abilityKey === 'powerConverter') {
      // Per alexanbv 2026-05-13: Power Converter (Saska) sub-picker
      // opens the existing handlePowerConverter die-pick UI inside
      // the combat thread (was previously auto-prompted to the
      // attacker's hand channel at attack-roll time).
      const dice = combat.attackDiceResults || [];
      const alreadyRerolled = combat.attackerRerolledIndices || [];
      const _pcDieBtns = [];
      for (let _i = 0; _i < dice.length; _i++) {
        if (alreadyRerolled.includes(_i)) continue;
        const _d = dice[_i];
        _pcDieBtns.push(
          new ButtonBuilder()
            .setCustomId(`power_converter_die_${gameId}_${_i}`)
            .setLabel(`Pick ${_d.color} #${_i + 1}: ${_d.acc}a/${_d.dmg}d/${_d.surge}s`)
            .setStyle(ButtonStyle.Primary),
        );
      }
      _pcDieBtns.push(
        new ButtonBuilder()
          .setCustomId(`pre_reroll_${gameId}_skip`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      );
      if (_pcDieBtns.length <= 1) {
        await thread.send(`**Power Converter** — No eligible attack dice (all already rerolled).`).catch(discordCatch);
        combat.openedRerollAbility = null;
        await sendRerollUI(thread, game, combat, 'attacker');
        saveGames(game.gameId);
        return;
      }
      const _pcRows = [];
      for (let _r = 0; _r < _pcDieBtns.length; _r += 5) _pcRows.push(new ActionRowBuilder().addComponents(_pcDieBtns.slice(_r, _r + 5)));
      await thread.send({ content: `⚡ **Power Converter** — <@${playerId}> pick an attack die. You'll choose its color next.`, components: _pcRows.slice(0, 5) });
    }
    saveGames(game.gameId);
    return;
  }

  // Process choice
  if (choice === 'skip') {
    abilityState.used = true;
    await thread.send(`Reroll ability skipped.`);
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
    abilityState.used = true;
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
    abilityState.used = true;
    const skipNote = skipped.length > 0 ? `\nSkipped (already rerolled): ${skipped.join(', ')}` : '';
    await thread.send(`**Twin Sabers** — Force rerolled ${rerolledIndices.length} defense die${rerolledIndices.length === 1 ? '' : 's'} simultaneously:\n${details.join('\n') || '(no eligible dice)'}\nNew totals: ${defTotals.block} block, ${defTotals.evade} evade${defTotals.dodge ? ' DODGE' : ''}${skipNote}`);
  } else if (choice === 'resourceful_atk') {
    // alexanbv 2026-05-13: register a named queue entry instead of
    // incrementing the count. Surfaces as "Use Resourceful (Reroll 1
    // ATK die)" in the bucket on the next render.
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    combat.forcedRerollQueue.push({ controlPlayer: abilityState.playerNum, pool: 'attack', remaining: 1, source: 'Resourceful (Reroll 1 ATK die)' });
    combat.resourcefulSide = 'atk';
    abilityState.used = true;
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — Reroll 1 attack die added to your bucket.${gambitNote}`);
  } else if (choice === 'resourceful_def') {
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    combat.forcedRerollQueue.push({ controlPlayer: abilityState.playerNum, pool: 'defense', remaining: 1, source: 'Resourceful (Reroll 1 DEF die)' });
    combat.resourcefulSide = 'def';
    abilityState.used = true;
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — Reroll 1 defense die added to your bucket.${gambitNote}`);
  } else if (choice === 'trained_yes') {
    // Trained Rancor: "While attacking, you may suffer 1 Strain to reroll
    // 1 attack die." Strain routed through the new applyStrain handler so
    // the player gets the deck-discard option (+ Paz exception, UD pre-
    // prompt). Reroll is granted in the followup AFTER strain resolves.
    abilityState.used = true;
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
    abilityState.used = true;
    await thread.send(`**Trained** — Skipped.`);
  } else if (choice.startsWith('shrewd_')) {
    const guess = parseInt(choice.replace('shrewd_', ''), 10);
    if (!isNaN(guess)) {
      combat.shrewdScoundrelGuess = guess;
      await thread.send(`**Shrewd Scoundrel** — Guessed **${guess}** Hit result${guess !== 1 ? 's' : ''}.`);
    }
    abilityState.used = true;
  } else {
    abilityState.used = true;
  }

  // Per alexanbv 2026-05-13: after the ability resolves, re-render the
  // attacker bucket so the player can pick another ability or click
  // Done. No queue-advancing — the bucket renderer iterates
  // combat.rerollAbilities directly and only shows unused entries.
  combat.openedRerollAbility = null;
  await sendRerollUI(thread, game, combat, 'attacker');
  saveGames(game.gameId);
}

// _advancePreRerollChain retired 2026-05-13. Per alexanbv: there is no
// pre-reroll queue — step-3 reroll abilities live as buttons inside the
// attacker bucket and resolution returns to that same bucket via
// sendRerollUI(... 'attacker'). The legacy chain advanced through a
// sequential pendingPreRerolls queue, which forced a fixed order; the
// bucket renderer iterates combat.rerollAbilities directly so the
// player picks any order.

// Strain followup: Trained Rancor "suffer 1 strain to reroll 1 attack
// die". After applyStrain resolves the player's choice (damage / deck-
// discard / Paz-return), grant the +1 attack reroll and re-render the
// attacker bucket so the player can pick another ability or click Done.
registerStrainFollowup('trained_grant_reroll', async (game, ctx, _payload) => {
  const combat = game.pendingCombat;
  if (!combat) return;
  const thread = await fetchCombatThread(ctx.client, combat.combatThreadId);
  if (!thread) return;
  // alexanbv 2026-05-13: register a named queue entry instead of
  // incrementing the deleted count.
  combat.forcedRerollQueue = combat.forcedRerollQueue || [];
  combat.forcedRerollQueue.push({
    controlPlayer: combat.attackerPlayerNum,
    pool: 'attack',
    remaining: 1,
    source: 'Trained (Reroll 1 ATK die)',
  });
  await thread.send('**Trained** — Reroll 1 attack die added to your bucket.').catch(discordCatch);
  await sendRerollUI(thread, game, combat, 'attacker');
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

/**
 * Air Support (Bodhi Rook): "When a friendly figure spends a Power Token
 * while attacking, apply +2 Accuracy to the attack results."
 *
 * Per alexanbv 2026-05-13 clarification: the +2 Accuracy fires only when
 * the **attacker is not Focused** at the moment of token-spend (canonical
 * card text — overrides the dc-effects.json paraphrase). Focus is checked
 * at click time so mid-attack Focus changes are respected.
 *
 * Trigger condition (all four must hold):
 *  - The token-spender is the attacker side (not defender).
 *  - At least one friendly figure on the attacker's team has the
 *    `air_support_bodhi` ability id.
 *  - The attacker does not currently have the Focus condition.
 *  - Bodhi is alive (has a position on the board).
 *
 * No range gate per card text — Bodhi grants air support board-wide.
 */
async function _maybeApplyAirSupport(thread, game, combat, ctx, isAttacker) {
  if (!isAttacker) return;
  const atkPN = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!atkPN) return;
  const dcEff = ctx?.getDcEffects ? ctx.getDcEffects() : getDcEffectsGlobal();
  if (!dcEff) return;
  const friendlyPositions = game.figurePositions?.[atkPN] || {};
  let bodhiFigKey = null;
  for (const [fk, pos] of Object.entries(friendlyPositions)) {
    if (!pos) continue;
    const fkDcName = dcNameFromFigureKey(fk);
    const fkEff = dcEff[fkDcName] || dcEff[(fkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((fkEff?.specialAbilityIds || []).includes('air_support_bodhi')) {
      bodhiFigKey = fk;
      break;
    }
  }
  if (!bodhiFigKey) return;
  const atkConds = game.figureConditions?.[combat.attackerFigureKey] || [];
  if (atkConds.includes('Focus')) return;
  combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
  const bodhiDcName = dcNameFromFigureKey(bodhiFigKey);
  if (thread) {
    await thread.send(`✈️ **Air Support** (${bodhiDcName}) — Attacker spent a Power Token while unfocused: **+2 Accuracy** applied.`).catch(discordCatch);
  }
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
 * Sequential per-player "Apply modifiers? Y/N" prompt (CRR step 4).
 * Attacker prompts first; after they respond, defender prompts; after
 * defender responds, advance to surge via proceedAfterRerolls.
 *
 * Per Destruct's UX: each player gets explicit Y/N rather than a
 * shared "Both ready" gate. Y means "I'm playing modifiers, give me
 * a moment" (player applies CCs from their hand channel, then clicks
 * Done). N means "no modifiers, advance".
 */
/**
 * Distracting (Han Solo, C-3PO) — step-4 defender passive check.
 *
 * Per alexanbv 2026-05-13: moved from on-declare to step-4 defender so
 * mid-attack movement (e.g., a CC repositions a Distracting figure) is
 * reflected in the +1 Evade decision.
 *
 * Rules:
 *  - Friendly defender figure with `distracting_*` ability id.
 *  - That figure is adjacent to the targeted space (or on it).
 *  - Rogue Smuggler attachment cancels the figure's Distracting.
 *  - Only one +1 Evade per attack (first eligible Distracting figure
 *    wins; subsequent figures are skipped).
 *
 * Posts a clear log line on the combat thread when the bonus applies.
 */
async function _applyDistractingStep4(thread, game, combat, ctx) {
  if (!combat || combat.distractingResolved) return;
  const target = combat.target;
  if (!target || target.isNpc) return;
  const targetCoord = target.coord ? String(target.coord).toLowerCase() : null;
  if (!targetCoord) return;
  const mapSpaces = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
  if (!mapSpaces) return;
  const defenderPlayerNum = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const adjToTarget = new Set((mapSpaces.adjacency?.[targetCoord] || []).map((s) => String(s).toLowerCase()));
  adjToTarget.add(targetCoord); // same-space counts.
  const defenderFigPositions = game.figurePositions?.[defenderPlayerNum] || {};
  const _findMid = ctx?.findDcMessageIdForFigure;
  for (const [fk, pos] of Object.entries(defenderFigPositions)) {
    if (!pos) continue;
    const fkDcName = dcNameFromFigureKey(fk);
    const fkEff = getDcEffect(fkDcName);
    if (!hasDistractingAbility(fkEff?.specialAbilityIds)) continue;
    if (!adjToTarget.has(String(pos).toLowerCase())) continue;
    const _distMsgId = _findMid ? _findMid(game.gameId, defenderPlayerNum, fk) : null;
    const _distUpg = _distMsgId ? (game.p1DcAttachments?.[_distMsgId] || game.p2DcAttachments?.[_distMsgId] || []) : [];
    if (cardNameIncludes(_distUpg, 'Rogue Smuggler')) continue;
    const r = applyDistractingEvade(combat);
    combat.bonusEvade = r.bonusEvade;
    if (thread) await thread.send(`🎭 **Distracting** (${fkDcName}) — adjacent to target at step 4: **+1 Evade** for the defender.`).catch(discordCatch);
    return; // only one Distracting bonus per attack
  }
}

export async function sendModsYn(thread, game, combat, role, ctx) {
  const gameId = game.gameId;
  const isAtk = role === 'attacker';
  const playerNum = isAtk
    ? (combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum ?? 1)
    : opponentPlayerNum(combat.attackerPlayerNum ?? 1);
  const ownerId = playerNum === 1 ? game.player1Id : game.player2Id;

  // Per alexanbv 2026-05-13 — step-4 announcements for passive auto-mods.
  //
  // (1) Distracting (Han Solo / C-3PO): at the moment of step-4 defender
  // modifiers, check if any friendly defender figure with the
  // `distracting_*` ability is adjacent to the targeted space, and apply
  // +1 Evade if so. Previously checked on-declare; moved here because
  // figures may relocate between declare and step 4 (CCs, Wild Beast,
  // etc.).
  //
  // (2) Hidden attacker: announce the auto +1 Surge that fires later in
  // computeCombatResult. The math is already applied at step 5 surge;
  // this is the player-facing notification.
  if (!isAtk && !combat.distractingResolved) {
    await _applyDistractingStep4(thread, game, combat, ctx);
    combat.distractingResolved = true;
  }
  if (isAtk && !combat.attackerHiddenAnnounced) {
    const _ahConds = combat.attackerConds || game.figureConditions?.[combat.attackerFigureKey] || [];
    if (_ahConds.includes('Hide') && !combat.attackerCondEffectsSuppressed) {
      await thread.send('🥷 **Hidden** — Attacker is Hidden: **+1 Surge** will be applied to the attack results (auto, step 5).').catch(discordCatch);
    }
    combat.attackerHiddenAnnounced = true;
  }

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
    // Per alexanbv 2026-05-13: Illicit Arms (Bib Fortuna passive) is a
    // step-4 ATTACKER modifier. Previously fired from proceedAfterRerolls
    // — AFTER both attacker and defender mods. That's the wrong stage.
    // Detect eligibility here and post the prompt before the basic Y/N;
    // handleIllicitArms re-enters sendModsYn(attacker) after resolution.
    if (!combat.illicitArmsResolved && !game.pendingIllicitArms) {
      const _iaDcEff = getDcEffectsGlobal() || {};
      const _iaFriendlyPos = game.figurePositions?.[combat.attackerPlayerNum] || {};
      for (const [_iaFk, _iaPos] of Object.entries(_iaFriendlyPos)) {
        if (!_iaPos) continue;
        const _iaFkDcName = dcNameFromFigureKey(_iaFk);
        const _iaFkEff = _iaDcEff[_iaFkDcName] || _iaDcEff[_iaFkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!isIllicitArmsEligibleFigure(_iaFkEff)) continue;
        const _iaHand = getCcHand(game, combat.attackerPlayerNum) || [];
        if (_iaHand.length === 0) { combat.illicitArmsResolved = true; break; }
        setPendingIllicitArms(game, {
          gameId: game.gameId,
          playerNum: combat.attackerPlayerNum,
          bibFigureKey: _iaFk,
          bibDcName: _iaFkDcName,
          combatThreadId: thread.id,
        });
        const _iaRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`illicit_arms_use_${gameId}`).setLabel('Use Illicit Arms (+1 Damage)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`illicit_arms_skip_${gameId}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
        );
        await thread.send(sanitizeMentions({
          content: `<@${ownerId}> **Illicit Arms** (${_iaFkDcName}) — Step 4 attacker modifier: discard 1 Command card to apply **+1 Hit** to this attack?`,
          components: [_iaRow],
          allowedMentions: { users: [ownerId] },
        })).catch(discordCatch);
        return;
      }
    }
  }

  // Per alexanbv 2026-05-12: Zillo Technique discard is a step-4
  // defender modifier (timing-wise it goes alongside other defender
  // step-4 choices — Guidance Systems analogue for the defense side).
  // Previously fired inside proceedAfterRerolls AFTER step 4 — that
  // produced a confusing second prompt after the mods Y/N. Fire it
  // here before the basic Y/N; the Zillo handler re-enters sendModsYn
  // after resolution so the defender still sees the Y/N gate.
  if (!isAtk && !combat.zilloDiscardResolved && combat.target?.figureKey && !combat.target.isNpc) {
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
        setPendingZilloDiscard(game, { defenderPN: _ztDefPN, combatThreadId: thread.id });
        const _ztYesNoRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`zillo_use_yes_${gameId}`)
            .setLabel('Yes — discard 1 CC for +1 Block')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`zillo_discard_skip_${gameId}`)
            .setLabel('No — skip')
            .setStyle(ButtonStyle.Secondary),
        );
        await thread.send(sanitizeMentions({
          content: `<@${_ztDefOwnerId}> **Zillo Technique** — Discard 1 Command card for **+1 Block**? (once per attack, CRR step 4)`,
          allowedMentions: { users: [_ztDefOwnerId] },
          components: [_ztYesNoRow],
        })).catch(discordCatch);
        return;
      }
      combat.zilloDiscardResolved = true;
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
    await sendModsYn(thread, game, combat, 'defender', ctx);
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

  // Shrewd Scoundrel (Lando) — REMOVED the old VP-award version (alexanbv
  // 2026-06-16: that was the wrong card; the IACP version DOUBLES the rerolled
  // die's results). Now handled by the gate Resourceful resolver +
  // _resolveShrewdScoundrel (deferred double at the end of the rerolls step).

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

  // Illicit Arms (Bib Fortuna) moved to sendModsYn(attacker) per
  // alexanbv 2026-05-13 — it's a step-4 ATTACKER modifier, so it
  // belongs alongside Guidance Systems in the attacker mods window,
  // BEFORE defender mods. Detection block lives in sendModsYn now.

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

  // Zillo Technique discard moved to sendModsYn(defender) per alexanbv
  // 2026-05-12 — it's a CRR step-4 defender modifier, posted alongside
  // (before) the basic mods Y/N. handleZilloDiscard re-enters
  // sendModsYn(defender) after resolution so the step-4 gate still
  // closes correctly.

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

  // Dodge is NO LONGER resolved-to-miss here. Per alexanbv 2026-06-14: the
  // dodge check belongs in the SAME step as the accuracy check
  // (computeCombatResult, step 6) — AFTER the surge-spend window — because some
  // surges CANCEL a Dodge (Deadly Spin / Deadly set combat.surgeCancelDodge).
  // Short-circuiting to a miss here skipped step 5, so those surges could never
  // be spent. Flow now always proceeds to the surge phase; computeCombatResult
  // turns any surviving Dodge into the miss (respecting surgeCancelDodge).
  // (Auto dodge-conversions Defensive Stance / Soresu / Lucky already ran above.)

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
    // Air Support (Bodhi Rook): +2 Accuracy when a friendly attacker spends a token (unfocused).
    await _maybeApplyAirSupport(thread, game, combat, ctx, combat.pendingWildRole === 'attacker');
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
    // Air Support (Bodhi Rook): +2 Accuracy when a friendly attacker spends a token (unfocused).
    await _maybeApplyAirSupport(thread, game, combat, ctx, isAttacker);
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
  // Air Support (Bodhi Rook): +2 Accuracy when a friendly attacker spends a token (unfocused).
  await _maybeApplyAirSupport(thread, game, combat, ctx, isAttacker);
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
  // Interrupts route through the sequence (alexanbv 2026-06-15): if this attack
  // is walking the gate sequence, the resume above stashed combat._afterResolveArgs
  // instead of finishing — advance into the after_resolve gate so the attack
  // continues IN sequence. No-op for legacy (non-_seqActive) attacks.
  await resumeSequenceAfterInterrupt(game, combat, ctx, thread);
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
  applyDcPassivesToCombat(game.pendingCombat, controlledStats?.passives || [], targetStats?.passives || []);
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
  // Mark resolved (Skip or use): per-attack once-per-attack limit. Per
  // alexanbv 2026-05-12 — Zillo discard is now a CRR step-4 defender
  // modifier, posted by sendModsYn(defender). Re-enter THAT (not
  // proceedAfterRerolls) so the defender still sees the basic mods
  // Y/N gate. Proceeding to step 5 happens after the Y/N closes.
  combat.zilloDiscardResolved = true;
  saveGames(game.gameId);
  if (thread) await sendModsYn(thread, game, combat, 'defender', ctx);
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
  // Per alexanbv 2026-05-13: the DM queue entry was already removed
  // by the sub-picker cleanup before the reveal-hand prompt fired
  // (combat.js DM branch in handleCombatReroll). No queue manipulation
  // needed here. Re-render the holder's bucket via the current
  // rerollPhase — no more retired 'forced' / 'post_forced_reroll'
  // phases.
  saveGames(game.gameId);
  if (thread) {
    await sendRerollUI(thread, game, combat, combat.rerollPhase || 'attacker');
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
