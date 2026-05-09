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
  parseFigureKey, dcNameFromFigureKey, getDcEffect,
  applyCondition, isConditionImmune, HARMFUL_CONDITIONS,
} from '../game/index.js';
import { isWithinN } from '../engine/utils.js';
import { getFigureLabel } from '../engine/game-readers.js';
import { getFigureFootprint, getAllFigureFootprints, hasFigureLineOfSight } from '../game/spatial.js';
import { sanitizeMentions } from '../discord/channel-helpers.js';
import {
  setPendingBoltslinger, setPendingHeavyFire, setPendingHavocShot,
  setPendingIndiscriminateFire, setPendingConcussiveBolt,
} from '../game/interrupts.js';
import { getDcList, getPlayerId, getDcMessageIds } from '../game/player-helpers.js';
import { applyDamage } from '../game/damage-pipeline.js';
import { processFigureDefeat } from '../engine/defeat-handler.js';
import { lookupFigureDcIndex } from '../engine/game-readers.js';
import { applyNpcDamageToFigure } from '../engine/combat-bridge.js';
import { getFiguresAdjacentToCoord } from '../game/movement.js';
import { getFiguresOnOrAdjacentToSpace } from '../game/board-helpers.js';
import { getDcKeywords, getDcEffects, getFigureSize } from '../data-loader.js';
import { getFootprintCells } from '../game/coords.js';
import { countGameSpaces } from '../game/board-helpers.js';
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
 * Burst Fire (Imperial Loadout): on damage, every figure adjacent to the
 * target's pre-defeat space (excluding target) is Stunned. Condition
 * Immunity blocks the Stun. Reads combat._blastTargetCoord/_blastTargetSize
 * (stashed at step-7 close, same as Blast).
 */
async function fireBurstFire(thread, game, combat, effect, ctx) {
  const { logGameAction, client, getMapData } = ctx;
  if (combat.attackerMsgId && game.burstFirePendingMsgId?.[combat.attackerMsgId]) {
    delete game.burstFirePendingMsgId[combat.attackerMsgId];
  }
  if (!combat._blastTargetCoord || !game.selectedMap?.id) return;
  const ms = getMapData?.(game.selectedMap.id);
  if (!ms) return;
  const targetSize = combat._blastTargetSize || (combat.target?.figureKey ? getFigureSize(dcNameFromFigureKey(combat.target.figureKey)) : null) || '1x1';
  const targetCells = getFootprintCells(combat._blastTargetCoord, targetSize);
  const adjSet = new Set();
  for (const cell of targetCells) {
    for (const a of (ms.adjacency?.[cell] || [])) adjSet.add(a);
  }
  for (const cell of targetCells) adjSet.delete(cell);
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      const fkSize = getFigureSize(dcNameFromFigureKey(fk)) || '1x1';
      const fkCells = getFootprintCells(pos, fkSize);
      if (!fkCells.some((c) => adjSet.has(c))) continue;
      if (fk === combat.target?.figureKey) continue;
      if (isConditionImmune(game, fk)) continue;
      if (applyCondition(game, fk, 'Stun') && logGameAction) {
        await logGameAction(game, client, `\u{1F4A5} **Burst Fire** — **${dcNameFromFigureKey(fk)}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
      }
    }
  }
}

/**
 * Crippling Blow (Imperial Loadout): on hit, defender is Stunned.
 * Condition Immunity logs and skips.
 */
async function fireCripplingBlow(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  if (combat.attackerMsgId && game.cripplingBlowPending?.[combat.attackerMsgId]) {
    delete game.cripplingBlowPending[combat.attackerMsgId];
  }
  const fk = combat.target?.figureKey;
  if (!fk) return;
  const label = combat.target.label || dcNameFromFigureKey(fk);
  if (isConditionImmune(game, fk)) {
    if (logGameAction) {
      await logGameAction(game, client, `**Crippling Blow** — **${label}** is immune to Stun.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  if (applyCondition(game, fk, 'Stun') && logGameAction) {
    await logGameAction(game, client, `⚡ **Crippling Blow** — **${label}** is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Disruptor Rifle (Imperial Loadout): if attack hit and defender currently
 * at exactly 1 HP, deal 1 more damage. The HP read is at click time so
 * other step-8 effects (e.g. Bleed apply) that lowered HP don't double-fire.
 */
async function fireDisruptorRifle(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps } = ctx;
  if (combat.attackerMsgId && game.disruptorRiflePending?.[combat.attackerMsgId]) {
    delete game.disruptorRiflePending[combat.attackerMsgId];
  }
  const fk = combat.target?.figureKey;
  const targetMsgId = combat.target?.msgId;
  if (!fk || !targetMsgId) return;
  const { figureIndex } = parseFigureKey(fk);
  const hs = dcHealthState?.get?.(targetMsgId) || [];
  const entry = hs[figureIndex];
  if (!entry) return;
  const [cur] = entry;
  if (cur !== 1) {
    if (logGameAction) {
      await logGameAction(game, client, `**Disruptor Rifle** — **${combat.target.label}** is not at 1 HP; effect skipped.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    return;
  }
  await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: fk, msgId: targetMsgId, figIndex: figureIndex,
    amount: 1, controllerPlayerNum: combat.defenderPlayerNum,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    source: 'Disruptor Rifle', combat,
  });
  if (logGameAction) {
    await logGameAction(game, client, `\u{1F480} **Disruptor Rifle** — **${combat.target.label}** had 1 HP — suffers 1 additional Damage and is **defeated**.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  const { idx } = lookupFigureDcIndex(game, combat.defenderPlayerNum, fk, {
    dcMessageMeta: ctx.dcMessageMeta,
    getDcMessageIds, getDcList,
  });
  await processFigureDefeat(game, {
    defeatedPlayerNum: combat.defenderPlayerNum,
    figureKey: fk,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    msgId: targetMsgId,
    dcIdx: idx,
    dcName: dcNameFromFigureKey(fk),
    displayName: combat.target.label,
    source: 'Disruptor Rifle',
  }, { ...(deps || {}), client });
}

/**
 * Electro-pulse (Electrohammer post-attack): each other figure adjacent
 * to the target space suffers 1 Damage. Source PT is excluded; target
 * itself takes the splash too (CRR slice 6.11 destruct fix).
 */
async function fireElectroPulse(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, findDcMessageIdForFigure, deps } = ctx;
  combat.loadoutPostAttack = null;
  const targetFk = combat.target?.figureKey;
  if (!targetFk) return;
  const targetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[targetFk] || combat._blastTargetCoord;
  if (!targetPos) return;
  const lines = [];
  for (const pNum of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pNum] || {})) {
      if (pNum === combat.attackerPlayerNum && fk === combat.attackerFigureKey) continue;
      if (countGameSpaces(game, pos, targetPos) > 1) continue;
      const msgId = findDcMessageIdForFigure?.(game.gameId, pNum, fk);
      if (!msgId) continue;
      const { figureIndex } = parseFigureKey(fk);
      await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
        figureKey: fk, msgId, figIndex: figureIndex,
        amount: 1, controllerPlayerNum: pNum,
        attackerPlayerNum: combat.attackerPlayerNum,
        attackerFigureKey: combat.attackerFigureKey,
        source: 'Electro-pulse', combat,
      });
      lines.push(`**${dcNameFromFigureKey(fk)}** suffers 1 Damage`);
    }
  }
  if (lines.length && logGameAction) {
    await logGameAction(game, client, `⚡ **Electro-pulse** — Adjacent figures:\n${lines.join('\n')}`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Quick Strike (Electrostaff post-attack): if defender modified dice
 * (rerolled or +/-N), defender suffers 1 Damage. Hit-gating already
 * happened at queue time.
 */
async function fireQuickStrike(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, deps } = ctx;
  combat.loadoutPostAttack = null;
  const fk = combat.target?.figureKey;
  const targetMsgId = combat.target?.msgId;
  if (!fk || !targetMsgId) return;
  const { figureIndex } = parseFigureKey(fk);
  await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
    figureKey: fk, msgId: targetMsgId, figIndex: figureIndex,
    amount: 1, controllerPlayerNum: combat.defenderPlayerNum,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerFigureKey: combat.attackerFigureKey,
    source: 'Quick Strike', combat,
  });
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **Quick Strike** — Defender modified dice/results: **${combat.target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
}

/**
 * Stage a chain-attack prompt for after-defender-Done. The fire handlers
 * below populate combat._pendingChainAttacks; combat-bridge's
 * _finishCombatResolution iterates and posts each prompt + sets the
 * matching pending flag so the player gets the new attack only AFTER
 * the defender's step-8 window has closed (per user 2026-05-09 spec).
 */
function _stageChainAttack(combat, entry) {
  combat._pendingChainAttacks = combat._pendingChainAttacks || [];
  combat._pendingChainAttacks.push(entry);
}

/**
 * Tonfa Strike (Imperial Loadout): "after this attack, you may make an
 * additional attack." Stage the chain attack — combat-close will post
 * the Declare Attack prompt + arm freeAttackBonusPending after the
 * defender step-8 window closes.
 */
async function fireTonfaStrike(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  if (game.tonfaStrikeSecondAttack?.[combat.attackerMsgId]) {
    delete game.tonfaStrikeSecondAttack[combat.attackerMsgId];
  }
  _stageChainAttack(combat, {
    source: 'Tonfa Strike',
    msgId: combat.attackerMsgId,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    message: '**Tonfa Strike** — You may perform an additional attack (use Attack button).',
  });
}

/**
 * Barrage (CT-1701): "after first attack, perform a second attack
 * (target within 3 of first; defender +1 white die)." Stages target
 * window + defense bonus alongside the chain attack.
 */
async function fireBarrage(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  if (game.barrageSecondAttack?.[combat.attackerMsgId]) {
    delete game.barrageSecondAttack[combat.attackerMsgId];
  }
  // Capture target's position now (target may move/be removed during
  // defender step 8); chain-attack post-close uses this for the within-3 gate.
  const targetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[combat.target?.figureKey];
  _stageChainAttack(combat, {
    source: 'Barrage',
    msgId: combat.attackerMsgId,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    barrageTargetSpace: targetPos || null,
    barrageDefenseBonus: true,
    message: '**Barrage** — You may perform a second attack (target within 3 of first target, defender +1 white die). Use the **Attack** button.',
  });
}

/**
 * Flurry of Blows (Electrobaton loadout): hit-gated free 1-green-die
 * melee attack with +1 Hit, once per activation. Stages override-dice +
 * the chain attack.
 */
async function fireFlurryOfBlows(thread, game, combat, effect, ctx) {
  if (!combat.attackerMsgId) return;
  combat.loadoutPostAttack = null;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[`flurryOfBlows_${combat.attackerMsgId}`] = true;
  _stageChainAttack(combat, {
    source: 'Flurry of Blows',
    msgId: combat.attackerMsgId,
    flagKey: 'freeAttackBonusPending',
    flagValue: true,
    pendingOverrideAttackDice: { dice: ['green'], type: 'melee', bonusHits: 1 },
    message: '**Flurry of Blows** — You may perform a Melee attack using 1 green die (+1 Hit). Use the Attack button.',
  });
}

/**
 * Fell Swoop (Davith Elso surge): apply Hide, present Move 2 picker,
 * then stage the chain attack for after defender step 8 closes. The
 * Move-X picker fires immediately on click; after it drains, the new
 * attack waits until the defender Done.
 */
async function fireFellSwoop(thread, game, combat, effect, ctx) {
  const { logGameAction, client, saveGames } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
  if (game.roundFigureAbilityUsed[fsKey]) return;
  game.roundFigureAbilityUsed[fsKey] = true;
  applyCondition(game, combat.attackerFigureKey, 'Hide');
  const attName = combat.attackerDisplayName || dcNameFromFigureKey(combat.attackerFigureKey);
  if (logGameAction) {
    await logGameAction(game, client, `**Fell Swoop** — **${attName}** becomes **Hidden** and may **move up to 2 spaces**, then make a free attack.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
  }
  _stageChainAttack(combat, {
    source: 'Fell Swoop',
    msgId: combat.attackerMsgId,
    flagKey: 'fellSwoopFreeAttack',
    flagValue: true,
    message: null, // deferred prompt is posted via freeAttackPrompt continuation when Move-X drains
  });
  const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
  stampPendingMoveX(game, {
    msgId: combat.attackerMsgId,
    figureKey: combat.attackerFigureKey,
    playerNum: combat.attackerPlayerNum,
    spaces: 2,
    source: 'Fell Swoop',
    threadId: combat.combatThreadId,
    nextAction: {
      type: 'freeAttackPrompt',
      payload: {
        msgId: combat.attackerMsgId,
        playerNum: combat.attackerPlayerNum,
        figureKey: combat.attackerFigureKey,
        sourceLabel: 'Fell Swoop',
      },
    },
  });
  await postMoveXPicker(game, { client, logGameAction, saveGames }, combat.attackerMsgId);
}

/**
 * Bladestorm (CC effect): after attack, all hostiles within N spaces of
 * the attacker suffer N AoE damage. Reads combat.postAttackAoeDamage +
 * combat.postAttackAoeRange (set by the CC). Routes through the central
 * damage pipeline so when-damaged / before-defeated / when-defeated
 * hooks fire — this is an upgrade over the inline path which mutated
 * dcHealthState directly and bypassed the hooks.
 */
async function fireBladestorm(thread, game, combat, effect, ctx) {
  const { dcHealthState, logGameAction, client, findDcMessageIdForFigure, deps } = ctx;
  const aoeDmg = combat.postAttackAoeDamage || 0;
  const aoeRange = combat.postAttackAoeRange || 2;
  combat.postAttackAoeDamage = 0;
  if (aoeDmg <= 0) return;
  const atkFk = combat.attackerFigureKey;
  const atkPos = atkFk ? game.figurePositions?.[combat.attackerPlayerNum]?.[atkFk] : null;
  const defPn = combat.defenderPlayerNum;
  if (!atkPos || !defPn) return;
  const lines = [];
  for (const [fk, coord] of Object.entries(game.figurePositions?.[defPn] || {})) {
    if (!coord || fk === combat.target?.figureKey) continue;
    if (countGameSpaces(game, atkPos, coord) > aoeRange) continue;
    const fMsgId = findDcMessageIdForFigure?.(game.gameId, defPn, fk);
    if (!fMsgId) continue;
    const { figureIndex } = parseFigureKey(fk);
    const { prevHp, newHp } = await applyDamage(game, { dcHealthState, logGameAction, client, deps, thread }, {
      figureKey: fk, msgId: fMsgId, figIndex: figureIndex,
      amount: aoeDmg, controllerPlayerNum: defPn,
      attackerPlayerNum: combat.attackerPlayerNum,
      attackerFigureKey: atkFk,
      source: 'Bladestorm', combat,
    });
    lines.push(`**${dcNameFromFigureKey(fk)}** ${aoeDmg} Dmg (${prevHp}→${newHp})`);
  }
  if (lines.length && thread) {
    await thread.send(`**Bladestorm** — Hostiles within ${aoeRange} spaces: ${lines.join(', ')}`).catch(discordCatch);
  }
}

/**
 * Wild Fury (post-activation conditions): apply queued conditions to the
 * attacker figure. Condition Immunity filters harmful out per CRR.
 */
async function fireWildFury(thread, game, combat, effect, ctx) {
  const { logGameAction, client } = ctx;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  let conds = game.pendingPostAttackConditions?.[combat.attackerMsgId];
  delete game.pendingPostAttackConditions?.[combat.attackerMsgId];
  if (!Array.isArray(conds) || conds.length === 0) return;
  if (isConditionImmune(game, combat.attackerFigureKey)) {
    conds = conds.filter((c) => !HARMFUL_CONDITIONS.includes(c));
  }
  if (conds.length === 0) return;
  for (const c of conds) applyCondition(game, combat.attackerFigureKey, c);
  if (logGameAction) {
    const dcName = dcNameFromFigureKey(combat.attackerFigureKey);
    await logGameAction(game, client, `**Wild Fury** — **${dcName}** is now **${conds.join(' + ')}**.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  }
}

/**
 * Sidewinder (Jyn Odan): "after this attack, suffer 1 Strain to move
 * up to 2 spaces. Limit once per round." Posts the same yes/skip prompt
 * the inline path used to auto-post after combat close. Existing
 * handleSidewinderApply / handleSidewinderSkip (combat-special-effects.js)
 * own the click flow — no combat-close coupling, so the step-8 wrap is
 * a clean lift.
 */
async function fireSidewinder(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !ButtonBuilder || !ActionRowBuilder) return;
  if (!combat.attackerMsgId || !combat.attackerFigureKey) return;
  const swKey = combat.attackerFigureKey + '_sidewinder';
  if (game.roundFigureAbilityUsed?.[swKey]) return;
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  await thread.send({
    content: `<@${ownerId}> **Sidewinder** — Suffer 1 Strain to move up to 2 spaces? (once per round)`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sidewinder_apply_${game.gameId}_${combat.attackerMsgId}_${combat.attackerFigureIndex ?? 0}`)
        .setLabel('Suffer 1 Strain → Move up to 2 spaces')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`sidewinder_skip_${game.gameId}`)
        .setLabel('Skip')
        .setStyle(ButtonStyle.Primary),
    )],
  }).catch(discordCatch);
}

/**
 * Boltslinger (Vinto Hreeda): after attack, deal 1 Damage to a hostile
 * within 3 spaces. Posts the existing target picker; the click handler
 * (handleBoltslingerTarget) does the apply + defeat handling and does
 * NOT close combat, so no fromStep8Queue bypass needed.
 */
async function fireBoltslinger(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !ButtonBuilder || !ActionRowBuilder) return;
  if (!combat.attackerFigureKey || !game.selectedMap?.id) return;
  const defPN = opponentPlayerNum(combat.attackerPlayerNum);
  const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
  if (!atkPos) return;
  const targets = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
    if (fk === combat.target?.figureKey) continue;
    if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
    const { label } = getFigureLabel(game, defPN, fk, undefined, 80, {
      dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
    });
    targets.push({ figureKey: fk, playerNum: defPN, label });
  }
  if (targets.length === 0) return;
  setPendingBoltslinger(game, {
    gameId: game.gameId,
    attackerPlayerNum: combat.attackerPlayerNum,
    combatThreadId: combat.combatThreadId,
    targets,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  const btns = targets.slice(0, 4).map((t, i) =>
    new ButtonBuilder().setCustomId(`boltslinger_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`boltslinger_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Boltslinger** — Choose a hostile within 3 spaces to deal 1 Damage (verify LOS):`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Indiscriminate Fire (Bossk): on hit, choose 1 non-red attack die;
 * each OTHER figure within 2 spaces of target (excluding defender +
 * Bossk himself) suffers Damage = Hits and Strain = Surges on that die.
 * If only one non-red die was rolled, the splash auto-applies via the
 * existing applyIndiscriminateFireSplash helper (no decision needed);
 * otherwise the die-picker prompt fires.
 */
async function fireIndiscriminateFire(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder, deps } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey) return;
  const defPN = opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const rolledDice = combat.attackRoll?.dice || [];
  const nonRedDice = rolledDice.filter((d) => (d.color || '').toLowerCase() !== 'red');
  if (nonRedDice.length === 0) return;
  const splashTargets = [];
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (fk === combat.target.figureKey) continue;
      if (fk === combat.attackerFigureKey) continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      const { label } = getFigureLabel(game, pn, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      splashTargets.push({ figureKey: fk, playerNum: pn, label });
    }
  }
  const applyIndiscriminateFireSplash = deps?.applyIndiscriminateFireSplash || ctx.applyIndiscriminateFireSplash;
  if (nonRedDice.length === 1 && applyIndiscriminateFireSplash) {
    await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, deps);
    return;
  }
  setPendingIndiscriminateFire(game, {
    attackerPlayerNum: combat.attackerPlayerNum,
    combatThreadId: combat.combatThreadId,
    targets: splashTargets,
    availableDice: nonRedDice,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  const btns = nonRedDice.slice(0, 5).map((d, i) =>
    new ButtonBuilder()
      .setCustomId(`indiscriminate_die_${game.gameId}_${i}`)
      .setLabel(`${String(d.color).slice(0, 1).toUpperCase()}${String(d.color).slice(1)} (${d.dmg}dmg/${d.surge}↯)`)
      .setStyle(ButtonStyle.Secondary));
  btns.push(new ButtonBuilder().setCustomId(`indiscriminate_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Indiscriminate Fire** — Choose 1 non-red attack die for splash:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
}

/**
 * Heavy Fire (Skirmish Upgrade): if the attacker is a friendly VEHICLE
 * or HEAVY WEAPON and the [Heavy Fire] DC is in the army and not
 * exhausted, the attacker may deal 1 Damage to up to N hostiles within
 * 2 of target (where N = printed attack-pool dice count). For each
 * chosen target, attacker gains 1 HARMFUL condition picked by opponent.
 */
async function fireHeavyFire(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder, dcExhaustedState } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey || !combat.attackerDcName) return;
  const playerNum = combat.attackerPlayerNum;
  const dcList = getDcList(game, playerNum) || [];
  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const hfIdx = dcList.findIndex((dc) => dc.dcName === '[Heavy Fire]');
  if (hfIdx < 0) return;
  const hfMsgId = dcMsgIds[hfIdx];
  if (!hfMsgId) return;
  if (dcExhaustedState?.get?.(hfMsgId)) return;
  const atkKws = (ctx.getDcKeywords?.(game) || {})[combat.attackerDcName] || [];
  // Note: getDcKeywords is imported, but ctx may also pass it; use either.
  const upper = atkKws.map((k) => String(k).toUpperCase());
  if (!upper.includes('VEHICLE') && !upper.includes('HEAVY WEAPON')) return;
  const attEff = getDcEffect(combat.attackerDcName);
  const printed = attEff?.attack?.dice || [];
  const diceCount = printed.length;
  if (diceCount === 0) return;
  const defPN = opponentPlayerNum(playerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey] || combat._blastTargetCoord;
  if (!targetPos) return;
  const hostiles = [];
  for (const [fk, pos] of Object.entries(game.figurePositions?.[defPN] || {})) {
    if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
    const { label } = getFigureLabel(game, defPN, fk, undefined, 80, {
      dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
    });
    hostiles.push({ figureKey: fk, playerNum: defPN, label });
  }
  if (hostiles.length === 0) return;
  setPendingHeavyFire(game, {
    attackerPlayerNum: playerNum,
    attackerFigureKey: combat.attackerFigureKey,
    attackerDcName: combat.attackerDcName,
    attackerMsgId: combat.attackerMsgId,
    combatThreadId: combat.combatThreadId,
    hfMsgId,
    diceCount,
    hostiles,
    chosenTargets: [],
    conditionsOwed: 0,
  });
  const ownerId = getPlayerId(game, playerNum);
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Heavy Fire** — Your **${combat.attackerDcName}** resolved an attack (printed pool: ${diceCount} dice). Exhaust Heavy Fire to deal 1 Damage to up to ${diceCount} hostile figure${diceCount !== 1 ? 's' : ''} within 2 spaces of the target. Then, for each chosen figure, **${combat.attackerDcName}** gains 1 HARMFUL condition of your opponent's choice.`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`heavy_fire_use_${game.gameId}`).setLabel(`Use Heavy Fire (${diceCount} target${diceCount !== 1 ? 's' : ''})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`heavy_fire_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    )],
  })).catch(discordCatch);
}

/**
 * Havoc Shot (Fenn Signis): on hit, suffer 1 Strain to deal 1 Damage to
 * up to 2 figures within 2 of target in attacker's LOS. Original target
 * IS eligible to be re-picked (per ruling); only attacker is excluded.
 */
async function fireHavocShot(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !game.selectedMap?.id || !combat.target?.figureKey || !combat.attackerFigureKey) return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey] || combat._blastTargetCoord;
  const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
  if (!targetPos || !atkPos) return;
  const ms = ctx.getMapData?.(game.selectedMap.id);
  if (!ms) return;
  const allFp = getAllFigureFootprints(game, getFigureSize);
  const atkFp = getFigureFootprint(game, combat.attackerPlayerNum, combat.attackerFigureKey, getFigureSize);
  const eligible = [];
  for (const pn of [1, 2]) {
    for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
      if (!pos || fk === combat.attackerFigureKey) continue;
      if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
      const candFp = getFigureFootprint(game, pn, fk, getFigureSize);
      if (!hasFigureLineOfSight(atkFp, candFp, ms, allFp)) continue;
      const { label } = getFigureLabel(game, pn, fk, undefined, 80, {
        dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
      });
      eligible.push({ figureKey: fk, playerNum: pn, label });
    }
  }
  if (eligible.length === 0) return;
  setPendingHavocShot(game, {
    gameId: game.gameId,
    attackerPlayerNum: combat.attackerPlayerNum,
    attackerMsgId: combat.attackerMsgId,
    attackerFigureKey: combat.attackerFigureKey,
    attackerFigureIndex: combat.attackerFigureIndex ?? 0,
    combatThreadId: combat.combatThreadId,
    targets: eligible,
    chosen: [],
    maxPicks: 2,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Havoc Shot** — Suffer 1 Strain to deal 1 Damage to up to 2 figures within 2 spaces of the target in your LOS?`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`havoc_shot_use_${game.gameId}`).setLabel('Use Havoc Shot (1 Strain)').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`havoc_shot_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
    )],
  })).catch(discordCatch);
}

/**
 * Concussive Bolt (4-LOM): on hit, push 1x1 target 1 space (attacker
 * picks direction). Posts the same push-destination prompt as the
 * inline path; pending state carries fromStep8Queue so the click
 * handler re-posts the attacker step-8 window instead of closing combat.
 */
async function fireConcussiveBolt(thread, game, combat, effect, ctx) {
  const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = ctx;
  if (!thread || !combat.target?.figureKey || !game.selectedMap?.id) return;
  const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
  if (getFigureSize(targetDcName) !== '1x1') return;
  const defPN = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
  const targetPos = game.figurePositions?.[defPN]?.[combat.target.figureKey];
  if (!targetPos) return;
  const { getValidPushDestinations } = await import('../game/movement.js');
  const pusherDc = combat.attackerFigureKey ? dcNameFromFigureKey(combat.attackerFigureKey) : null;
  const pusherKws = pusherDc ? (getDcEffect(pusherDc)?.keywords || []).map((k) => String(k).toUpperCase()) : [];
  const adjSpaces = getValidPushDestinations(game, combat.target.figureKey, defPN, { pusherIsMassive: pusherKws.includes('MASSIVE') });
  if (adjSpaces.length === 0) return;
  const { label } = getFigureLabel(game, defPN, combat.target.figureKey, targetDcName, 80, {
    dcMessageMeta: ctx.dcMessageMeta, getDcMessageIds, getDcList, dcNameFromFigureKey,
  });
  const ownerId = getPlayerId(game, combat.attackerPlayerNum);
  setPendingConcussiveBolt(game, {
    gameId: game.gameId,
    combatThreadId: combat.combatThreadId,
    attackerPlayerNum: combat.attackerPlayerNum,
    defenderPlayerNum: defPN,
    ownerId,
    figureKey: combat.target.figureKey,
    figureLabel: String(label).slice(0, 80),
    currentPos: targetPos,
    adjSpaces,
    resultText: combat._step7ResultText || '',
    combat,
    initialEmbedRefreshMsgIds: [],
    fromStep8Queue: true,
  });
  const btns = adjSpaces.slice(0, 4).map((sp) =>
    new ButtonBuilder().setCustomId(`concussive_bolt_push_${game.gameId}_${sp}`).setLabel(sp.toUpperCase()).setStyle(ButtonStyle.Danger));
  btns.push(new ButtonBuilder().setCustomId(`concussive_bolt_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  await thread.send(sanitizeMentions({
    content: `<@${ownerId}> **Concussive Bolt** — Push **${label}** 1 space. Choose a destination:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  })).catch(discordCatch);
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
    case 'burst_fire':
      await fireBurstFire(thread, game, combat, effect, ctx);
      return;
    case 'crippling_blow':
      await fireCripplingBlow(thread, game, combat, effect, ctx);
      return;
    case 'disruptor_rifle':
      await fireDisruptorRifle(thread, game, combat, effect, ctx);
      return;
    case 'electro_pulse':
      await fireElectroPulse(thread, game, combat, effect, ctx);
      return;
    case 'quick_strike':
      await fireQuickStrike(thread, game, combat, effect, ctx);
      return;
    case 'tonfa_strike':
      await fireTonfaStrike(thread, game, combat, effect, ctx);
      return;
    case 'barrage':
      await fireBarrage(thread, game, combat, effect, ctx);
      return;
    case 'flurry_of_blows':
      await fireFlurryOfBlows(thread, game, combat, effect, ctx);
      return;
    case 'fell_swoop':
      await fireFellSwoop(thread, game, combat, effect, ctx);
      return;
    case 'bladestorm':
      await fireBladestorm(thread, game, combat, effect, ctx);
      return;
    case 'wild_fury':
      await fireWildFury(thread, game, combat, effect, ctx);
      return;
    case 'sidewinder':
      await fireSidewinder(thread, game, combat, effect, ctx);
      return;
    case 'boltslinger':
      await fireBoltslinger(thread, game, combat, effect, ctx);
      return;
    case 'indiscriminate_fire':
      await fireIndiscriminateFire(thread, game, combat, effect, ctx);
      return;
    case 'heavy_fire':
      await fireHeavyFire(thread, game, combat, effect, ctx);
      return;
    case 'havoc_shot':
      await fireHavocShot(thread, game, combat, effect, ctx);
      return;
    case 'concussive_bolt':
      await fireConcussiveBolt(thread, game, combat, effect, ctx);
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
