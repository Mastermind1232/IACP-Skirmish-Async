/**
 * Fire handlers for step-8 / after-attack-resolves effects.
 *
 * Each handler implements the actual application logic for one effect
 * type. Called from after-attack-resolve.js when the attacker (or
 * defender) clicks an effect's button in the post-resolve window.
 *
 * Effect types map to handlers via the `fireEffect` dispatcher:
 *   - 'recover'    → fireRecover    (heal attacker by N)
 *   - 'blast'      → fireBlast      (CRR step 8 splash; TODO follow-up)
 *   - 'cleave'     → fireCleave     (target picker; TODO follow-up)
 *   - 'condition'  → fireCondition  (apply 1 condition; TODO follow-up)
 *   - per-DC      → followup commits per ability
 *
 * Slice 2b first cut (this commit): only `recover` is wired live.
 * Other types throw a not-yet-wired error — they continue to fire via
 * the legacy inline-apply path inside applyDamageAndFinishCombat until
 * their follow-up commit migrates them.
 */
import { discordCatch } from '../error-handling.js';
import { healHp } from '../game/damage-helpers.js';
import {
  grantMovementBank, grantPowerTokens, opponentPlayerNum,
  parseFigureKey, dcNameFromFigureKey,
  applyCondition, isConditionImmune, HARMFUL_CONDITIONS,
} from '../game/index.js';
import { getDcList, getPlayerId, getDcMessageIds } from '../game/player-helpers.js';
import { applyDamage } from '../game/damage-pipeline.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import { lookupFigureDcIndex } from '../engine/game-readers.js';
import { applyNpcDamageToFigure } from '../engine/combat-bridge.js';
import { getFiguresAdjacentToCoord } from '../game/movement.js';
import { getFiguresOnOrAdjacentToSpace } from '../game/board-helpers.js';
import { getDcKeywords, getDcEffects } from '../data-loader.js';
import { cardNameIncludes } from '../game/card-names.js';
import { applyStrain } from './strain-handler.js';
import { setupPendingMoveX } from './move-x-handler.js';

/**
 * Recover N — heals the attacker by N HP. Applies even on a miss
 * (CRR Recover keyword). Sustained by Rage blocks own Recover; that
 * gate is enforced upstream when the entry is enqueued.
 */
async function fireRecover(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client } = ctx;
  if (!dcHealthState || combat.attackerMsgId == null) return;
  const amount = Number(effect.payload?.amount ?? combat.surgeRecover ?? 0);
  if (amount <= 0) return;
  healHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, amount, combat.attackerPlayerNum);
  // Clear surgeRecover so it doesn't get re-applied if the inline
  // path runs (e.g. self-play double-fire safety).
  combat.surgeRecover = 0;
  if (logGameAction && thread) {
    await logGameAction(game, client, `\u{1F49A} **Recover ${amount}** — **${combat.attackerDcName}** healed ${amount} HP.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Blast N (CRR step 8): all figures and objects on or adjacent to the
 * target's pre-defeat space suffer N damage. Multiple Blast sources sum
 * into one splash event (CRR-BST-010); enqueueAttackerStep8Effects pushes
 * a single 'blast' entry with the summed amount.
 *
 * Reads combat._blastTargetCoord / combat._blastTargetSize / combat._blastFireproofFriendly
 * (stashed by applyDamageAndFinishCombat before the queue ran).
 */
async function fireBlast(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, dcMessageMeta, findDcMessageIdForFigure, getMapData, deps } = ctx;
  const amount = Number(effect.payload?.amount ?? 0);
  if (amount <= 0) return;
  if (!combat._blastTargetCoord || !game.selectedMap?.id) return;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const ftFireproofFriendly = !!combat._blastFireproofFriendly;
  const adjacent = getFiguresAdjacentToCoord(
    game,
    combat._blastTargetCoord,
    game.selectedMap.id,
    combat.target?.figureKey,
    combat._blastTargetSize,
  );
  const dCtx = { dcHealthState, logGameAction, client, deps, thread };
  for (const { figureKey, playerNum } of adjacent) {
    if (playerNum === attackerPlayerNum && ftFireproofFriendly) continue;
    const msgId = findDcMessageIdForFigure?.(game.gameId, playerNum, figureKey);
    if (!msgId) continue;
    const { figureIndex } = parseFigureKey(figureKey);
    const { newHp, wasDefeated } = await applyDamage(game, dCtx, {
      figureKey, msgId, figIndex: figureIndex,
      amount, controllerPlayerNum: playerNum,
      attackerPlayerNum, attackerFigureKey: combat.attackerFigureKey,
      source: 'Blast', combat,
    });
    const { dcList: bDcList, idx: bIdx } = lookupFigureDcIndex(game, playerNum, figureKey, {
      dcMessageMeta, getDcMessageIds, getDcList,
    });
    // Fury of Kashyyyk (army-wide passive on a CC): friendly WOOKIEE
    // suffering 3+ damage becomes Focused.
    if (amount >= 3 && newHp > 0) {
      const fokDcList = getDcList(game, playerNum) || [];
      if (fokDcList.some((dc) => dc.dcName === '[Fury of Kashyyyk]')) {
        const fokName = dcNameFromFigureKey(figureKey);
        const fokKws = (getDcKeywords(game)[fokName] || []).map((k) => String(k).toUpperCase());
        if (fokKws.includes('WOOKIEE') && applyCondition(game, figureKey, 'Focus')) {
          if (logGameAction) {
            await logGameAction(game, client, `**Fury of Kashyyyk** — **${fokName}** became **Focused** (suffered ${amount} Blast Damage).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
          }
        }
      }
    }
    if (wasDefeated) {
      const blastLabel = bDcList[bIdx]?.displayName || figureKey;
      const blastDcName = bDcList[bIdx]?.dcName;
      await processFigureDefeat(game, {
        defeatedPlayerNum: playerNum,
        figureKey,
        attackerPlayerNum,
        attackerFigureKey: combat.attackerFigureKey,
        msgId,
        dcIdx: bIdx,
        dcName: blastDcName,
        displayName: blastLabel,
        source: 'Blast',
      }, { ...(deps || {}), client });
      if (combat.attackerMsgId) {
        game.activationKills = game.activationKills || {};
        game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
      }
    }
  }
  // Crate splash (CRR step 8 also hits adjacent objects).
  if (game.cratePositions && getMapData) {
    const rawMs = getMapData(game.selectedMap.id);
    const adjacency = rawMs?.adjacency || {};
    const targetNorm = String(combat._blastTargetCoord).toLowerCase();
    const adjSet = new Set((adjacency[targetNorm] || []).map((c) => String(c).toLowerCase()));
    adjSet.add(targetNorm);
    const checkWinConditions = deps?.checkWinConditions || ctx.checkWinConditions;
    for (const [origCoord, curCoord] of Object.entries(game.cratePositions)) {
      const crateNorm = String(curCoord).toLowerCase();
      if (!adjSet.has(crateNorm)) continue;
      game.crateHealth = game.crateHealth || {};
      if (typeof game.crateHealth[origCoord] !== 'number') game.crateHealth[origCoord] = 5;
      game.crateHealth[origCoord] = Math.max(0, game.crateHealth[origCoord] - amount);
      if (logGameAction) {
        await logGameAction(game, client, `\u{1F4A5} **Blast ${amount}** — Crate @ ${String(curCoord).toUpperCase()} suffers ${amount} damage (${game.crateHealth[origCoord]}/5 HP).`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
      }
      if (game.crateHealth[origCoord] <= 0) {
        delete game.cratePositions[origCoord];
        const bcCurLow = String(curCoord).toLowerCase();
        if (logGameAction) {
          await logGameAction(game, client, `\u{1F4A5} Crate at **${String(curCoord).toUpperCase()}** destroyed by Blast! All figures on or adjacent suffer 2 Damage.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
        }
        for (const pn of [1, 2]) {
          for (const figKey of getFiguresOnOrAdjacentToSpace(game, pn, bcCurLow, game.selectedMap?.id)) {
            await applyNpcDamageToFigure(game, pn, figKey, 2, 'Crate explosion (Blast)', logGameAction, client, dcHealthState, dcMessageMeta);
          }
        }
        if (checkWinConditions) await checkWinConditions(game, client);
      }
    }
  }
}

/**
 * Apply 1 condition (CRR step 8). One queue entry per condition source
 * (surge, CC bonus, passive); each click applies that single condition,
 * routed to attacker (Focus/Hide — beneficial) or target (Bleed/Stun/
 * Weaken — harmful). At apply time fireCondition checks Condition Immunity
 * (Onar, Snowtrooper) + Fireproof (Flame Trooper Bleed) and triggers the
 * Punishing Strike replacement prompt when a harmful condition lands.
 *
 * Per destruct 2026-05-08: even "auto-dealt" conditions (Gaarkhan Bleed,
 * Riot Trooper Weaken passives) flow through this path so Punishing
 * Strike has a chance to fire.
 */
async function fireCondition(thread, game, combat, effect, ctx) {
  const { logGameAction, client, ButtonBuilder, ButtonStyle, ActionRowBuilder, deps } = ctx;
  const cond = effect.payload?.condition;
  if (!cond) return;
  const recipient = effect.payload?.recipient || (HARMFUL_CONDITIONS.includes(cond) ? 'target' : 'attacker');
  const recipientFigKey = recipient === 'target'
    ? combat.target?.figureKey
    : combat.attackerFigureKey;
  if (!recipientFigKey) return;
  const recipientLabel = recipient === 'target'
    ? (combat.target?.label || dcNameFromFigureKey(recipientFigKey))
    : (combat.attackerDcName || dcNameFromFigureKey(recipientFigKey));
  // Condition Immunity (Onar, Snowtrooper, etc.) — only filters HARMFUL.
  if (HARMFUL_CONDITIONS.includes(cond) && isConditionImmune(game, recipientFigKey)) {
    if (logGameAction) {
      await logGameAction(game, client, `**Condition Immunity** — **${recipientLabel}** is immune to ${cond}.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    }
    return;
  }
  // Fireproof (Flame Trooper) — cannot Bleed.
  if (cond === 'Bleed' && combat.defenderFireproof && recipient === 'target') {
    if (logGameAction) {
      await logGameAction(game, client, `**Fireproof** — **${recipientLabel}** is immune to Bleed.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    }
    return;
  }
  const applied = applyCondition(game, recipientFigKey, cond);
  if (logGameAction) {
    const verb = recipient === 'attacker' ? 'gains' : 'is now';
    await logGameAction(game, client, `**${cond}** — **${recipientLabel}** ${verb} **${cond}**.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  // Punishing Strike (Skirmish Upgrade): when one of your figures applies
  // a HARMFUL condition, exhaust to discard that condition and apply a
  // different harmful condition instead. Only prompts when condition
  // actually landed (applied=true) on a target.
  if (applied && HARMFUL_CONDITIONS.includes(cond) && recipient === 'target') {
    const psAtkDcList = getDcList(game, combat.attackerPlayerNum) || [];
    const psHasPS = psAtkDcList.some((dc) => dc.dcName === '[Punishing Strike]');
    const psExhKey = `ps_army_p${combat.attackerPlayerNum}`;
    const psAlreadyExhausted = cardNameIncludes(game.exhaustedSkirmishUpgrades?.[psExhKey], 'Punishing Strike');
    if (psHasPS && !psAlreadyExhausted && thread && ButtonBuilder && ActionRowBuilder) {
      const { setPendingPunishingStrike } = await import('../game/interrupts.js');
      const otherConds = HARMFUL_CONDITIONS.filter((c) => c !== cond);
      const psBtns = otherConds.map((c) =>
        new ButtonBuilder()
          .setCustomId(`ps_replace_${game.gameId}_${recipientFigKey}_${cond}_${c}`)
          .setLabel(`Replace with ${c}`)
          .setStyle(ButtonStyle.Primary),
      );
      psBtns.push(
        new ButtonBuilder()
          .setCustomId(`ps_replace_${game.gameId}_${recipientFigKey}_${cond}_skip`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      );
      setPendingPunishingStrike(game, {
        attackerPlayerNum: combat.attackerPlayerNum,
        targetFigureKey: recipientFigKey,
        originalCondition: cond,
      });
      await thread.send({
        content: `**Punishing Strike** — **${recipientLabel}** was applied **${cond}**. Exhaust Punishing Strike to replace it with a different harmful condition?`,
        components: [new ActionRowBuilder().addComponents(psBtns)],
      }).catch(discordCatch);
    }
  }
}

/**
 * Leg Hydraulics (Tress Hacnua) — attacker after-resolve: "After you
 * resolve an attack, move up to 1 space."
 *
 * Move-X effect: per-effect 1-space budget, no MP banked. Routes
 * through pendingMoveX so the bypass (MOVE-017 + MOVE-020) is scoped
 * to the budget being consumed and discarded when complete or stopped.
 */
async function fireLegHydraulics(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null || !combat.attackerFigureKey) return;
  await setupPendingMoveX(game, ctx, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 1,
    source: 'Leg Hydraulics',
    threadId: combat.combatThreadId,
  });
}

/**
 * Stun Batons (Riot Trooper E/R) — attacker after-resolve: target
 * suffers 1 Strain on damage. Routes through the strain pipeline
 * (applyStrain), which handles Fireproof, Headhunter, opponent's
 * strain-prevention CCs, and the underlying damage application —
 * which fires when-damaged hooks + defeat checks correctly.
 * destruct 2026-05-08.
 */
async function fireStunBatons(thread, game, combat, effect, ctx) {
  if (!combat?.target?.figureKey) return;
  const defenderPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  await applyStrain(game, ctx, {
    figureKey: combat.target.figureKey,
    controllerPlayerNum: defenderPN,
    amount: 1,
    source: 'Stun Batons',
  });
}

/**
 * Stalk Prey (Bossk CC) — attacker after-resolve: +2 MP + 1 Damage
 * Token. Triggered by combat.surgeStalkPrey flag set when the CC
 * was played; this fire handler clears the flag.
 */
async function fireStalkPrey(thread, game, combat, effect, ctx) {
  const { logGameAction, client, ensureMovementBankMessage } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  game.movementBank = game.movementBank || {};
  const bank = game.movementBank[combat.attackerMsgId] || { total: 0, remaining: 0 };
  bank.total = (bank.total ?? 0) + 2;
  bank.remaining = (bank.remaining ?? 0) + 2;
  game.movementBank[combat.attackerMsgId] = bank;
  grantPowerTokens(game, combat.attackerFigureKey, 'Damage', 1);
  delete combat.surgeStalkPrey;
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `**Stalk Prey** — **${combat.attackerDcName}** gained +2 MP and +1 Damage Token`,
      { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
  if (ensureMovementBankMessage) {
    await ensureMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
  }
}

/**
 * Slippery (Alliance Smuggler E/R) — defender after-resolve: "After
 * an attack targeting you resolves, gain 2 movement points." This
 * is an OUT-OF-ACTIVATION MP gain (the defender isn't activating)
 * so per the gain-MP rules the points must be spent IMMEDIATELY by
 * interrupt — not banked. Routes through setupPendingMoveX so the
 * 1-space-at-a-time picker fires; remaining points are discarded
 * when the picker closes.
 */
async function fireSlippery(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  const msgId = effect.payload?.msgId;
  const figureKey = effect.payload?.figureKey;
  const playerNum = effect.payload?.playerNum;
  const threadId = effect.payload?.threadId || null;
  if (!msgId || !figureKey || !playerNum) return;
  if (logGameAction && thread) {
    await logGameAction(game, client,
      `\u{1F3C3} **Slippery** — **${effect.payload?.defenderDcName || combat.target?.label}** gains 2 MP to spend immediately (interrupt; remaining discarded).`,
      { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  // Slippery is a regular MP gain (not Move-X) — bypassCosts: false
  // makes the picker honor +1 difficult-terrain and +1 hostile-figure
  // adders, with the figure's profile (Mobile / Massive / Efficient
  // Travel) overriding via getMovementProfile.
  await setupPendingMoveX(game, ctx, {
    msgId,
    figureKey,
    playerNum,
    spaces: 2,
    source: 'Slippery',
    threadId,
    bypassCosts: false,
  });
}

/**
 * Cleave N (CRR-CLV-005): each Cleave-X source independently picks
 * its own target from the eligible set. The step-8 queue surfaces
 * one button per accumulating source (passive Cleave, Surge: Cleave,
 * Krayt Dragon Fury, Darksaber Blast→Cleave conversion, etc.); each
 * click posts a target picker for THAT source's value alone, and the
 * existing handleCleaveTarget applies damage + defeat finalization
 * via _applyDamage.
 *
 * Per the user's correction: Blast SUMS multiple sources into one
 * splash event (handled by fireBlast); Cleave does NOT sum — each
 * source resolves separately with its own target choice.
 */
async function fireCleave(thread, game, combat, effect, ctx) {
  const { client, logGameAction } = ctx;
  const amount = Number(effect.payload?.amount ?? 0);
  if (amount <= 0 || !combat?.target?.figureKey) return;
  const sourceLabel = effect.payload?.sourceLabel || `Cleave ${amount}`;
  const defenderPlayerNum = combat.defenderPlayerNum
    ?? (combat.attackerPlayerNum === 1 ? 2 : 1);
  // Use the engine's existing cleave-eligibility helper + button
  // builder + pendingCleave state so the click flow matches the
  // legacy inline path exactly. The only difference: cleaveQueue is
  // empty here — each source is its own queued effect, so
  // handleCleaveTarget returns to the step-8 window when this source
  // resolves rather than chaining to a "next source" reprompt.
  let computeCleaveEligibleTargets, getCleaveTargetButtons, deps;
  try {
    ({ computeCleaveEligibleTargets } = await import('../engine/combat-bridge.js'));
    deps = ctx.deps || ctx;
    getCleaveTargetButtons = deps?.getCleaveTargetButtons || ctx?.getCleaveTargetButtons;
  } catch (err) {
    console.error('[after-attack-fire] fireCleave import failed:', err?.message ?? err);
    return;
  }
  if (!computeCleaveEligibleTargets) return;
  const cleaveTargets = computeCleaveEligibleTargets(game, combat, defenderPlayerNum, deps);
  if (cleaveTargets.length === 0) {
    if (logGameAction && thread) {
      await logGameAction(game, client, `**${sourceLabel}** — no eligible targets in range; effect skipped.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  const { setPendingCleave } = await import('../game/interrupts.js');
  const ownerId = game[`player${combat.attackerPlayerNum}Id`];
  setPendingCleave(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    surgeCleave: amount,
    sourceLabel,
    // Empty queue: each source is its own step-8 effect entry, so
    // handleCleaveTarget should NOT chain to a next source — it
    // should return to the post-resolve window for the next button.
    cleaveQueue: [],
    attackerPlayerNum: combat.attackerPlayerNum,
    defenderPlayerNum,
    ownerId,
    targets: cleaveTargets,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  if (thread && getCleaveTargetButtons) {
    const cleaveRows = getCleaveTargetButtons(game.gameId, cleaveTargets);
    await thread.send({
      content: `**${sourceLabel}** — <@${ownerId}>, choose one eligible target to apply Cleave damage:`,
      components: cleaveRows,
      allowedMentions: { users: [ownerId] },
    }).catch(discordCatch);
  }
}

/**
 * Vader's Finest (Attack+Move special action) — attacker after-resolve:
 * 1-space Move-X picker, bypassCosts true. The attack already fired
 * via freeAttackBonusPending; this is the move that follows.
 */
async function fireVadersFinestMove(thread, game, combat, effect, ctx) {
  if (combat.attackerMsgId == null || !combat.attackerFigureKey) return;
  await setupPendingMoveX(game, ctx, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 1,
    source: "Vader's Finest",
    threadId: combat.combatThreadId,
    bypassCosts: true,
  });
}

/**
 * Effect dispatcher. Adds an entry here as each effect type's fire
 * handler lands.
 */
export async function fireEffect(thread, game, combat, effect, ctx) {
  switch (effect.type) {
    case 'recover':
      await fireRecover(thread, game, combat, effect, ctx);
      return;
    case 'slippery':
      await fireSlippery(thread, game, combat, effect, ctx);
      return;
    case 'leg_hydraulics':
      await fireLegHydraulics(thread, game, combat, effect, ctx);
      return;
    case 'stalk_prey':
      await fireStalkPrey(thread, game, combat, effect, ctx);
      return;
    case 'stun_batons':
      await fireStunBatons(thread, game, combat, effect, ctx);
      return;
    case 'vaders_finest_move':
      await fireVadersFinestMove(thread, game, combat, effect, ctx);
      return;
    case 'cleave':
      await fireCleave(thread, game, combat, effect, ctx);
      return;
    case 'blast':
      await fireBlast(thread, game, combat, effect, ctx);
      return;
    case 'condition':
      await fireCondition(thread, game, combat, effect, ctx);
      return;
    // 'blast', 'cleave', 'condition', and per-DC types land in
    // follow-up commits. For now they fall through; the inline
    // applicator in combat-bridge.js still handles them.
    default:
      // Unknown / not-yet-wired type — log and drop. The effect was
      // already consumed from the queue by the caller.
      console.warn(`[after-attack-fire] effect type "${effect.type}" not yet wired; skipping`);
      return;
  }
}
