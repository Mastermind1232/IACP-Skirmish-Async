/**
 * Combat special-effect handlers extracted from index.js:
 * bleed, sidewinder, boltslinger, indiscriminate fire, fighting knife,
 * concussive bolt, spread the pain, missile salvo.
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { splitCustomId } from '../discord/custom-id.js';
import { reduceHp, opponentPlayerNum, parseFigureKey, dcNameFromFigureKey, applyCondition } from '../game/index.js';
import { getPlayAreaId, getPlayerId, getDcList, getDcMessageIds, ccDeckKey, ccHandKey, ccDiscardKey, pushFigure } from '../game/player-helpers.js';
import { getDcKeywords } from '../data-loader.js';
import { checkDeckDiscardPassiveRedraws } from '../game/cc-passive-redraw.js';
import { isAphraAlive, applyDubiousCounterpartsActionBump } from '../game/dubious-counterparts-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requirePlayer } from '../utils/guards.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { fetchCombatThread, fetchGameChannel, sanitizeMentions } from '../discord/channel-helpers.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';
import { clearPendingBoltslinger, clearPendingHeavyFire, clearPendingWantonDestruction, clearPendingHavocShot, clearPendingFightingKnife, clearPendingSpreadThePain, clearPendingDeflect, clearPendingDurasteelFistPush, clearPendingIndiscriminateFire, clearPendingConcussiveBolt } from '../game/interrupts.js';
import { setupPendingMoveX } from './move-x-handler.js';

// ── Internal helpers ─────────────────────────────

/** Apply Indiscriminate Fire splash damage/strain to all figures within 2 of target. */
export async function applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, splashTargets, thread, ctx) {
  const {
    client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, renderDcEmbed, getDcEffects, logGameAction,
    checkWinConditions, processFigureDefeat,
  } = ctx;
  const totalDmg = die.dmg || 0;
  const totalStrain = die.surge || 0;
  const totalEffect = totalDmg + totalStrain;
  const dieColor = String(die.color || '').replace(/^\w/, (c) => c.toUpperCase());
  const dieDesc = `${dieColor} die (${totalDmg} dmg, ${totalStrain} strain)`;
  if (splashTargets.length === 0) {
    await thread.send(`**Indiscriminate Fire** — ${dieDesc}: No figures within 2 spaces of the target.`).catch(discordCatch);
    return;
  }
  if (totalEffect === 0) {
    await thread.send(`**Indiscriminate Fire** — ${dieDesc}: 0 effect on splash targets.`).catch(discordCatch);
    return;
  }
  const lines = [];
  for (const t of splashTargets) {
    const mid = findDcMessageIdForFigure(game.gameId, t.playerNum, t.figureKey);
    if (!mid) continue;
    const { figureIndex: figIdx } = parseFigureKey(t.figureKey);
    const _spRes = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: t.figureKey, msgId: mid, figIndex: figIdx,
      amount: totalEffect, controllerPlayerNum: t.playerNum,
      source: 'Splash',
    });
    const newHp = _spRes.newHp;
    const splashMaxHp = dcHealthState.get(mid)?.[figIdx]?.[1] ?? 0;
    if (splashMaxHp === 0) continue;
    // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage, become Focused
    if (totalEffect >= 3 && newHp > 0) {
      const _fokSplashDcList = getDcList(game, t.playerNum) || [];
      if (_fokSplashDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) {
        const _fokSplashName = dcNameFromFigureKey(t.figureKey);
        const _fokSplashKws = (getDcKeywords(game)[_fokSplashName] || []).map(k => String(k).toUpperCase());
        if (_fokSplashKws.includes('WOOKIEE')) {
          if (applyCondition(game, t.figureKey, 'Focus')) {
            await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokSplashName}** became **Focused** (suffered ${totalEffect} Damage from Indiscriminate Fire).`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
    }
    const parts = [];
    if (totalDmg > 0) parts.push(`${totalDmg} Damage`);
    if (totalStrain > 0) parts.push(`${totalStrain} Strain`);
    lines.push(`• **${t.label}** suffers ${parts.join(' + ')}`);
    if (newHp <= 0) {
      const defeatResult = processFigureDefeat ? await processFigureDefeat(game, {
        defeatedPlayerNum: t.playerNum,
        figureKey: t.figureKey,
        attackerPlayerNum,
        source: 'Indiscriminate Fire',
      }) : null;
      const splashVP = defeatResult?.vp ?? 0;
      lines.push(`  → **${t.label} defeated!** +${splashVP} VP`);
    }
    await updateDcCardMessage(client, game, mid, ctx);
  }
  const msg = `**Indiscriminate Fire** — ${dieDesc}:\n${lines.join('\n')}`;
  await thread.send(msg).catch(discordCatch);
  await logGameAction(game, client, `**Indiscriminate Fire** — ${dieDesc}:\n${lines.join('\n')}`, { phase: 'ROUND', icon: 'attack' });
  saveGames(game.gameId);
}

/** Show next Spread the Pain figure-pick prompt, or finish if all conditions applied. */
async function advanceSpreadThePain(game, pending, ctx) {
  const {
    client, saveGames, finishCombatResolution, getMapData, getFigureLabel,
  } = ctx;
  const thread = await fetchCombatThread(client, pending.combatThreadId);
  if (!thread) { await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client); saveGames(game.gameId); return; }
  if (pending.conditionIdx >= pending.conditions.length) {
    clearPendingSpreadThePain(game);
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames(game.gameId);
    return;
  }
  const nextCond = pending.conditions[pending.conditionIdx];
  const targetPos = game.figurePositions?.[pending.defenderPlayerNum]?.[pending.combat.target?.figureKey];
  const figuresAtSpaces = [];
  if (targetPos && game.selectedMap?.id) {
    const ms = getMapData(game.selectedMap.id);
    const adjacency = ms?.adjacency || {};
    const candSpaces = new Set([String(targetPos).toLowerCase(), ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase())]);
    for (const p of [1, 2]) {
      for (const [figKey, figPos] of Object.entries(game.figurePositions?.[p] || {})) {
        if (candSpaces.has(String(figPos).toLowerCase())) {
          const { label } = getFigureLabel(game, p, figKey, undefined, 70);
          figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label });
        }
      }
    }
  }
  if (figuresAtSpaces.length === 0) {
    clearPendingSpreadThePain(game);
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames(game.gameId);
    return;
  }
  const btns = figuresAtSpaces.slice(0, 4).map((f) =>
    new ButtonBuilder()
      .setCustomId(`spread_pain_fig_${game.gameId}_${f.figureKey}`)
      .setLabel(f.label)
      .setStyle(f.playerNum === pending.defenderPlayerNum ? ButtonStyle.Danger : ButtonStyle.Secondary)
  );
  btns.push(new ButtonBuilder().setCustomId(`spread_pain_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
  await thread.send({
    content: `<@${pending.ownerId}> **Spread the Pain** — Apply **${nextCond}** to a figure at or adjacent to target (${String(targetPos).toUpperCase()}):`,
    allowedMentions: { users: [pending.ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
  saveGames(game.gameId);
}

// ── Exported handlers ───────────────────────────────────────────────────────

/** Handle bleed_accept_ / bleed_prevent_ button clicks. */
export async function handleBleedResolve(interaction, ctx) {
  const {
    getGame, saveGames, client, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, renderDcEmbed, logGameAction, calculateKillVp,
    decrementActivationIfGroupDefeated, checkWinConditions, canActAsPlayer,
    filterCondition,
    updateHandVisualMessage, updateDiscardPileMessage,
    processFigureDefeat,
  } = ctx;
  const match = interaction.customId.match(/^bleed_(accept|prevent)_(\d+)_(1|2)_(.+)$/);
  if (!match) return;
  const [, action, gameId, playerNumStr, figureKey] = match;
  const playerNum = parseInt(playerNumStr, 10);
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const playerId = getPlayerId(game, playerNum);
  if (interaction.user.id !== playerId && !game.isTestGame) {
    await interaction.followUp({ content: 'Only the figure owner can resolve Bleeding.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const msgId = findDcMessageIdForFigure(gameId, playerNum, figureKey);
  const { figureIndex } = parseFigureKey(figureKey);
  const dcName = dcNameFromFigureKey(figureKey);

  if (action === 'accept') {
    if (msgId) {
      const { newHp, wasDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client: interaction.client }, {
        figureKey, msgId, figIndex: figureIndex,
        amount: 1, controllerPlayerNum: playerNum,
        source: 'Bleeding', viaStrain: true,
      });
      if (dcHealthState.get(msgId)?.[figureIndex]) {
        await logGameAction(game, interaction.client, `\u{1FA78} **Bleeding** — **${dcName}** suffered 1 damage.`, { phase: 'ROUND', icon: 'attack' });
        const dcIds = getDcMessageIds(game, playerNum);
        const dcList = getDcList(game, playerNum);
        const idx = (dcIds || []).indexOf(msgId);
        if (wasDefeated) {
          const oppPN = opponentPlayerNum(playerNum);
          // Route through centralized defeat handler (VP, CC attachments, passive redraws,
          // Heroic Effort, Scavenged Weaponry, Hunt Dissent, activation decrement, win conditions)
          if (processFigureDefeat) {
            await processFigureDefeat(game, {
              defeatedPlayerNum: playerNum,
              figureKey,
              attackerPlayerNum: oppPN,
              msgId,
              dcIdx: idx,
              dcName,
              source: 'Bleeding',
            });
          }
          // Bespoke cleanup: clear game sub-states tied to this DC when group fully defeated
          const _bleedHs = dcHealthState.get(msgId);
          if (_bleedHs && _bleedHs.every(fig => fig && fig[0] <= 0)) {
            if (game.dcActionsData?.[msgId]) delete game.dcActionsData[msgId];
            if (game.movementBank?.[msgId]) delete game.movementBank[msgId];
          }
          if (game.pendingDcAbilityChoice) {
            for (const k of Object.keys(game.pendingDcAbilityChoice)) {
              if (k.startsWith(`${msgId}_`)) delete game.pendingDcAbilityChoice[k];
            }
            if (Object.keys(game.pendingDcAbilityChoice).length === 0) delete game.pendingDcAbilityChoice;
          }
          if (game.pendingPounceSpaceChoice?.[msgId]) {
            delete game.pendingPounceSpaceChoice[msgId];
            if (Object.keys(game.pendingPounceSpaceChoice).length === 0) delete game.pendingPounceSpaceChoice;
          }
        }
        // Refresh DC embed
        await updateDcCardMessage(interaction.client, game, msgId, ctx, { errorContext: 'Failed to update DC embed after Bleeding:' });
      }
    }
  } else {
    // prevent: discard top CC from deck
    const deckKey = ccDeckKey(playerNum);
    const deck = game[deckKey] || [];
    if (deck.length === 0) {
      await interaction.followUp({ content: 'No CCs in deck to discard!', ephemeral: true }).catch(discordCatch);
      return;
    }
    const discardedCard = deck.splice(0, 1)[0];
    game[deckKey] = deck;
    const bleedDiscardKey = ccDiscardKey(playerNum);
    game[bleedDiscardKey] = [...(game[bleedDiscardKey] || []), discardedCard];
    await logGameAction(game, interaction.client, `\u{1FA78} **Bleeding** — **${dcName}** prevented 1 damage (discarded **${discardedCard}** from deck top).`, { phase: 'ROUND', icon: 'card' });
    // CC Passive Redraw: deck-discard trigger (Built on Hope)
    const _bprResult = checkDeckDiscardPassiveRedraws(game, playerNum, discardedCard);
    for (const _bprCard of _bprResult.redrawn) {
      await logGameAction(game, interaction.client, `**Passive Redraw** — **${_bprCard}** re-drawn from discard (discarded from deck).`, { phase: 'ROUND', icon: 'card' });
    }
    // Discard pile changed (card added from deck + possibly redrawn to hand)
    if (updateDiscardPileMessage) await updateDiscardPileMessage(game, playerNum, interaction.client).catch(discordCatch);
    if (_bprResult.redrawn.length > 0) {
      if (updateHandVisualMessage) await updateHandVisualMessage(game, playerNum, interaction.client).catch(discordCatch);
    }
  }
  filterCondition(game, figureKey, 'Bleed');
  delete game.pendingBleeding; // Clear headless pending state if present
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Sidewinder (Jyn Odan): apply 1 Strain + grant 2 MP after attack. */
export async function handleSidewinderApply(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, renderDcEmbed, logGameAction, ensureMovementBankMessage,
  } = ctx;
  const m = interaction.customId.match(/^sidewinder_apply_([^_]+)_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, attackerMsgId, figIndexStr] = m;
  const game = getGame(gameId);
  if (!game) return;
  const figureIndex = parseInt(figIndexStr, 10);
  const meta = dcMessageMeta.get(attackerMsgId);
  if (!meta) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the attacker can use Sidewinder.')) return;
  const dgIndex = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKey = `${meta.dcName}-${dgIndex}-${figureIndex}`;
  const swKey = figureKey + '_sidewinder';
  if (game.roundFigureAbilityUsed?.[swKey]) {
    await interaction.followUp({ content: 'Sidewinder already used this round.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);
  // Apply 1 Strain
  await _applyDamage(game, { dcHealthState, logGameAction, client: interaction.client }, {
    figureKey, msgId: attackerMsgId, figIndex: figureIndex,
    amount: 1, controllerPlayerNum: meta.playerNum,
    source: 'Sidewinder', viaStrain: true,
  });
  // Mark used this round so a second after-attack within the same
  // round does not re-offer Sidewinder.
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[swKey] = true;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction(game, client,
    `\u{1F578}\u{FE0F} **Sidewinder** — Jyn Odan suffered 1 Strain and may move up to 2 spaces.`,
    { phase: 'ROUND', icon: 'card' });
  await updateDcCardMessage(client, game, attackerMsgId, ctx, { errorContext: 'Failed to refresh Sidewinder DC embed:' });
  // "Move 2 spaces" effect (CRR MOVE-017): pendingMoveX with bypass.
  await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
    msgId: attackerMsgId,
    figureKey,
    playerNum: meta.playerNum,
    spaces: 2,
    source: 'Sidewinder',
    threadId: interaction.message?.channelId || null,
  });
}

export async function handleSidewinderSkip(interaction, ctx) {
  const { saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Boltslinger (Vinto Hreeda): deal 1 Dmg to chosen nearby hostile. */
export async function handleBoltslingerTarget(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, renderDcEmbed, logGameAction, findDcMessageIdForFigure,
    processFigureDefeat,
  } = ctx;
  const m = interaction.customId.match(/^boltslinger_target_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingBoltslinger) return;
  const { attackerPlayerNum, combatThreadId, targets } = game.pendingBoltslinger;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the attacker can use Boltslinger.')) return;
  const target = targets[parseInt(idxStr, 10)];
  if (!target) return;
  await interaction.deferUpdate().catch(discordCatch);
  const targetMsgId = findDcMessageIdForFigure(gameId, target.playerNum, target.figureKey);
  if (targetMsgId) {
    const { figureIndex: figIdx } = parseFigureKey(target.figureKey);
    const { newHp: bsNewHp, wasDefeated: bsDied } = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: targetMsgId, figIndex: figIdx,
      amount: 1, controllerPlayerNum: target.playerNum,
      attackerPlayerNum, source: 'Boltslinger',
    });
    await updateDcCardMessage(client, game, targetMsgId, ctx, { errorContext: 'Failed to refresh Boltslinger target embed:' });
    if (bsDied && processFigureDefeat) {
      const _bsDcIds = getDcMessageIds(game, target.playerNum) || [];
      const _bsIdx = _bsDcIds.indexOf(targetMsgId);
      const _bsDcName = dcNameFromFigureKey(target.figureKey);
      await processFigureDefeat(game, {
        defeatedPlayerNum: target.playerNum,
        figureKey: target.figureKey,
        attackerPlayerNum,
        msgId: targetMsgId,
        dcIdx: _bsIdx,
        dcName: _bsDcName,
        displayName: target.label,
        source: 'Boltslinger',
      });
    }
  }
  const blThread = await fetchCombatThread(client, combatThreadId);
  if (blThread) await blThread.send(`**Boltslinger** — **${target.label}** suffers 1 Damage.`);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Boltslinger** — **${target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
  clearPendingBoltslinger(game);
  saveGames(game.gameId);
}

export async function handleBoltslingerSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^boltslinger_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingBoltslinger(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Indiscriminate Fire die choice button: indiscriminate_die_{gameId}_{dieIndex} */
export async function handleIndiscriminateFireDie(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer } = ctx;
  const m = interaction.customId.match(/^indiscriminate_die_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingIndiscriminateFire) return;
  const { attackerPlayerNum, combatThreadId, targets, availableDice } = game.pendingIndiscriminateFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the attacker can choose the Indiscriminate Fire die.')) return;
  const die = availableDice[parseInt(idxStr, 10)];
  if (!die) return;
  await interaction.deferUpdate().catch(discordCatch);
  clearPendingIndiscriminateFire(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const thread = await fetchCombatThread(client, combatThreadId);
  if (thread) await applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, targets, thread, ctx);
  saveGames(game.gameId);
}

/** Indiscriminate Fire skip button: indiscriminate_skip_{gameId} */
export async function handleIndiscriminateFireSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^indiscriminate_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  await interaction.deferUpdate().catch(discordCatch);
  if (game) clearPendingIndiscriminateFire(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Fighting Knife target pick: fighting_knife_target_{gameId}_{index} */
export async function handleFightingKnifeTarget(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, renderDcEmbed, logGameAction, findDcMessageIdForFigure,
    finishCombatResolution, rollSingleAttackDie,
    processFigureDefeat,
  } = ctx;
  const m = interaction.customId.match(/^fighting_knife_target_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingFightingKnife) return;
  const pending = game.pendingFightingKnife;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick the Fighting Knife target.')) return;
  const target = pending.targets[parseInt(idxStr, 10)];
  if (!target) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  clearPendingFightingKnife(game);
  // Roll 1 red die
  const die = rollSingleAttackDie('red');
  const hits = die.dmg || 0;
  const thread = await fetchCombatThread(client, pending.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (hits > 0 && target.msgId) {
    const { figureIndex: figIndex } = parseFigureKey(target.figureKey);
    const { newHp: newCur, wasDefeated: fkDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: target.msgId, figIndex,
      amount: hits, controllerPlayerNum: target.playerNum,
      attackerPlayerNum: pending.attackerPlayerNum, source: 'Fighting Knife',
    });
    // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage, become Focused
    if (hits >= 3 && newCur > 0) {
      const _fokFkDcList = getDcList(game, target.playerNum) || [];
      if (_fokFkDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) {
        const _fokFkName = dcNameFromFigureKey(target.figureKey);
        const _fokFkKws = (getDcKeywords(game)[_fokFkName] || []).map(k => String(k).toUpperCase());
        if (_fokFkKws.includes('WOOKIEE')) {
          if (applyCondition(game, target.figureKey, 'Focus')) {
            await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokFkName}** became **Focused** (suffered ${hits} Damage from Fighting Knife).`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
    }
    embedRefreshMsgIds.add(target.msgId);
    if (fkDefeated && processFigureDefeat) {
      await processFigureDefeat(game, {
        defeatedPlayerNum: target.playerNum,
        figureKey: target.figureKey,
        attackerPlayerNum: pending.attackerPlayerNum,
        msgId: target.msgId,
        dcName: dcNameFromFigureKey(target.figureKey),
        displayName: target.label,
        source: 'Fighting Knife',
      });
    }
  }
  const dieDesc = `${die.dmg}dmg${die.surge ? `/${die.surge}\u21AF` : ''}`;
  await logGameAction(game, client, `**Fighting Knife** — ${target.label}: rolled 1 red die (${dieDesc}), dealt **${hits}** damage`, { phase: 'ROUND', icon: 'attack' });
  await thread.send(`**Fighting Knife** — Rolled 1 red die on **${target.label}**: ${dieDesc} \u2192 **${hits} Damage**.`).catch(discordCatch);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames(game.gameId);
}

/** Fighting Knife skip: fighting_knife_skip_{gameId} */
export async function handleFightingKnifeSkip(interaction, ctx) {
  const { getGame, saveGames, client, finishCombatResolution } = ctx;
  const m = interaction.customId.match(/^fighting_knife_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingFightingKnife) return;
  const pending = game.pendingFightingKnife;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  clearPendingFightingKnife(game);
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames(game.gameId);
}

/** Concussive Bolt push target: concussive_bolt_push_{gameId}_{space} */
export async function handleConcussiveBoltPush(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, logGameAction, finishCombatResolution } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^concussive_bolt_push_([^_]+)_([a-z0-9]+)$/);
  if (!m) return;
  const [, gameId, space] = m;
  const game = getGame(gameId);
  if (!game?.pendingConcussiveBolt) return;
  const pending = game.pendingConcussiveBolt;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can choose the Concussive Bolt push direction.')) return;
  if (!pending.adjSpaces.includes(space)) {
    await interaction.followUp({ content: 'Invalid push destination.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const fromStep8Queue = !!pending.fromStep8Queue;
  clearPendingConcussiveBolt(game);
  // Move the figure to the chosen space
  pushFigure(game, pending.defenderPlayerNum, pending.figureKey, space);
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await logGameAction(game, client, `**Concussive Bolt** — **${pending.figureLabel}** pushed from ${String(pending.currentPos).toUpperCase()} to **${space.toUpperCase()}**`, { phase: 'ROUND', icon: 'attack' });
  if (fromStep8Queue) {
    // 2026-05-09: triggered from a step-8 attacker button — return to
    // the attacker post-resolve window instead of closing combat. The
    // remaining attacker effects (and any defender effects) still need
    // their own clicks before combat actually closes.
    try {
      const { postPostResolveWindow } = await import('./after-attack-resolve.js');
      const cThread = await fetchCombatThread(client, pending.combat.combatThreadId);
      if (cThread) await postPostResolveWindow(cThread, game, pending.combat, 'attacker', { ...ctx, client });
    } catch (err) {
      console.error('[handleConcussiveBoltPush] step-8 reopen failed:', err?.message ?? err);
    }
    saveGames(game.gameId);
    return;
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames(game.gameId);
}

/** Durasteel Fist push: durasteel_push_{gameId}_{space} */
export async function handleDurasteelPush(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^durasteel_push_([^_]+)_([a-z0-9]+)$/);
  if (!m) return;
  const [, gameId, space] = m;
  const game = getGame(gameId);
  if (!game?.pendingDurasteelFistPush) return;
  const pending = game.pendingDurasteelFistPush;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can choose the Durasteel Fist push direction.')) return;
  if (!pending.legalSpaces.includes(space)) {
    await interaction.followUp({ content: 'Invalid push destination.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const { prevPos, newPos } = pushFigure(game, pending.targetPlayerNum, pending.targetFigureKey, space) || {};
  await logGameAction(game, client, `**Durasteel Fist** — Pushed **${pending.targetDcName}** from ${String(prevPos).toUpperCase()} to **${String(newPos).toUpperCase()}**.`, { phase: 'ACTIVATION', icon: 'activate' });
  clearPendingDurasteelFistPush(game);
  saveGames(game.gameId);
}

/** Concussive Bolt skip: concussive_bolt_skip_{gameId} */
export async function handleConcussiveBoltSkip(interaction, ctx) {
  const { getGame, saveGames, client, finishCombatResolution } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^concussive_bolt_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingConcussiveBolt) return;
  const pending = game.pendingConcussiveBolt;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const fromStep8Queue = !!pending.fromStep8Queue;
  clearPendingConcussiveBolt(game);
  if (fromStep8Queue) {
    try {
      const { postPostResolveWindow } = await import('./after-attack-resolve.js');
      const cThread = await fetchCombatThread(client, pending.combat.combatThreadId);
      if (cThread) await postPostResolveWindow(cThread, game, pending.combat, 'attacker', { ...ctx, client });
    } catch (err) {
      console.error('[handleConcussiveBoltSkip] step-8 reopen failed:', err?.message ?? err);
    }
    saveGames(game.gameId);
    return;
  }
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames(game.gameId);
}

/** Spread the Pain figure pick: spread_pain_fig_{gameId}_{figureKey} */
export async function handleSpreadThePainFigPick(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, logGameAction,
    isConditionImmune, applyCondition, HARMFUL_CONDITIONS,
  } = ctx;
  const m = interaction.customId.match(/^spread_pain_fig_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, figureKey] = m;
  const game = getGame(gameId);
  if (!game?.pendingSpreadThePain) return;
  const pending = game.pendingSpreadThePain;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can choose the Spread the Pain target.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const cond = pending.conditions[pending.conditionIdx];
  // Apply condition to figureKey
  const dcName = dcNameFromFigureKey(figureKey);
  if (HARMFUL_CONDITIONS.includes(cond) && isConditionImmune(game, figureKey)) {
    await logGameAction(game, client, `**Condition Immunity** — **${dcName}** is immune to **${cond}** (Spread the Pain).`, { phase: 'ROUND', icon: 'card' });
  } else {
    applyCondition(game, figureKey, cond);
    await logGameAction(game, client, `**Spread the Pain** — **${dcName}** gains **${cond}**`, { phase: 'ROUND', icon: 'attack' });
  }
  pending.conditionIdx++;
  await advanceSpreadThePain(game, pending, ctx);
}

/** Spread the Pain skip: spread_pain_skip_{gameId} */
export async function handleSpreadThePainSkip(interaction, ctx) {
  const { getGame } = ctx;
  const m = interaction.customId.match(/^spread_pain_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingSpreadThePain) return;
  const pending = game.pendingSpreadThePain;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  pending.conditionIdx++;
  await advanceSpreadThePain(game, pending, ctx);
}

/** Missile Salvo die choice: missile_salvo_die_{color}_{gameId}_{msgId} */
export async function handleMissileSalvoDie(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^missile_salvo_die_([a-z]+)_([^_]+)_(.+)$/);
  if (!m) return;
  const [, color, gameId, msgId] = m;
  const game = getGame(gameId);
  if (!game?.pendingMissileSalvo?.[msgId]) return;
  const { playerNum, diceAvailable } = game.pendingMissileSalvo[msgId];
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the activating player can choose the Missile Salvo die.')) return;
  if (!diceAvailable.includes(color)) {
    await interaction.followUp({ content: `The ${color} die is no longer available for this salvo.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  // Remove chosen die from available pool
  game.pendingMissileSalvo[msgId].diceAvailable = diceAvailable.filter((c) => c !== color);
  // Set up overridden ranged attack with this die + +3 accuracy
  game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
  game.pendingOverrideAttackDice[msgId] = { dice: [color], type: 'ranged', bonusAccuracy: 3 };
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[msgId] = true;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const threadId = game.pendingMissileSalvo[msgId].threadId || game.dcActionsData?.[msgId]?.threadId;
  const salvoThread = await fetchCombatThread(client, threadId);
  const ownerId = getPlayerId(game, playerNum);
  const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
  const msg = `<@${ownerId}> **Missile Salvo** — **${colorLabel} die** selected (+3 Accuracy). Click **Attack** to target a different hostile figure. This attack costs no action.`;
  if (salvoThread) await salvoThread.send(sanitizeMentions({ content: msg, allowedMentions: { users: [ownerId] } })).catch(discordCatch);
  saveGames(game.gameId);
}

/** Missile Salvo done: missile_salvo_done_{gameId}_{msgId} */
export async function handleMissileSalvoDone(interaction, ctx) {
  const { getGame, saveGames, canActAsPlayer, dcMessageMeta, updateDcActionsMessage, client } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^missile_salvo_done_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, msgId] = m;
  const game = getGame(gameId);
  if (!game?.pendingMissileSalvo?.[msgId]) return;
  const { playerNum } = game.pendingMissileSalvo[msgId];
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the activating player can end the salvo.')) return;
  delete game.pendingMissileSalvo[msgId];
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  // Dubious Counterparts (Doctor Aphra): after a friendly DROID resolves Missile Salvo,
  // that figure may perform 1 additional action
  if (isAphraAlive(game, playerNum)) {
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      applyDubiousCounterpartsActionBump(actionsData, 2);
      if (updateDcActionsMessage) await updateDcActionsMessage(game, msgId, client || interaction.client);
      const _dcMeta = dcMessageMeta?.get(msgId);
      const _dcDisplayName = _dcMeta?.displayName || _dcMeta?.dcName || 'BT-1';
      const _dcThreadId = actionsData.threadId;
      const _dcThread = _dcThreadId ? await (client || interaction.client).channels.fetch(_dcThreadId).catch(() => null) : interaction.channel;
      if (_dcThread) {
        await _dcThread.send(`**Dubious Counterparts** (Doctor Aphra) — **${_dcDisplayName}** gains 1 additional action after resolving **Missile Salvo**.`).catch(discordCatch);
      }
    }
  }
  saveGames(game.gameId);
}

// ── Heavy Fire handlers ─────────────────────────────────────────────────────

/** Internal helper: advance to next Heavy Fire target pick, or finish. */
async function advanceHeavyFirePick(game, pending, ctx) {
  const { client, saveGames, logGameAction } = ctx;
  const thread = await fetchCombatThread(client, pending.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  const remaining = pending.diceCount - pending.chosenTargets.length;
  if (remaining <= 0 || pending.hostiles.length === 0) {
    await startHeavyFireConditions(game, pending, ctx);
    return;
  }

  // Filter out already-chosen targets
  const chosenKeys = new Set(pending.chosenTargets.map(t => t.figureKey));
  const available = pending.hostiles.filter(t => !chosenKeys.has(t.figureKey));
  if (available.length === 0) {
    await startHeavyFireConditions(game, pending, ctx);
    return;
  }

  const ownerId = getPlayerId(game, pending.attackerPlayerNum);
  const btns = available.slice(0, 4).map((t) =>
    new ButtonBuilder()
      .setCustomId(`heavy_fire_tgt_${game.gameId}_${t.figureKey}`)
      .setLabel(t.label)
      .setStyle(ButtonStyle.Danger)
  );
  btns.push(new ButtonBuilder().setCustomId(`heavy_fire_tgt_done_${game.gameId}`).setLabel('Done Picking').setStyle(ButtonStyle.Secondary));
  await thread.send({
    content: `<@${ownerId}> **Heavy Fire** — Pick hostile target ${pending.chosenTargets.length + 1}/${pending.diceCount} (within 2 of target space). ${remaining} pick${remaining !== 1 ? 's' : ''} left:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Internal helper: apply damage to all chosen targets, then start opponent condition picking. */
async function startHeavyFireConditions(game, pending, ctx) {
  const {
    client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, renderDcEmbed, getDcEffects, logGameAction,
    processFigureDefeat,
  } = ctx;
  const thread = await fetchCombatThread(client, pending.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  if (pending.chosenTargets.length === 0) {
    await thread.send('**Heavy Fire** — No targets chosen. Effect skipped.').catch(discordCatch);
    clearPendingHeavyFire(game);
    saveGames(game.gameId);
    return;
  }

  // Apply 1 Damage to each chosen hostile
  const lines = [];
  const defeatedTargets = [];
  for (const t of pending.chosenTargets) {
    const mid = findDcMessageIdForFigure(game.gameId, t.playerNum, t.figureKey);
    if (!mid) continue;
    const { figureIndex: figIdx } = parseFigureKey(t.figureKey);
    const { newHp, wasDefeated } = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: t.figureKey, msgId: mid, figIndex: figIdx,
      amount: 1, controllerPlayerNum: t.playerNum,
      attackerPlayerNum: pending.attackerPlayerNum, source: 'Heavy Fire',
    });
    lines.push(`• **${t.label}** suffers 1 Damage`);
    if (wasDefeated && processFigureDefeat) {
      const defeatResult = await processFigureDefeat(game, {
        defeatedPlayerNum: t.playerNum,
        figureKey: t.figureKey,
        attackerPlayerNum: pending.attackerPlayerNum,
        msgId: mid,
        dcName: dcNameFromFigureKey(t.figureKey),
        displayName: t.label,
        source: 'Heavy Fire',
      });
      lines.push(`  → **${t.label} defeated!** +${defeatResult?.vp ?? 0} VP`);
      defeatedTargets.push(t);
    }
    // Refresh DC embed
    await updateDcCardMessage(client, game, mid, ctx);
  }
  const dmgMsg = `**Heavy Fire** — Splash damage:\n${lines.join('\n')}`;
  await thread.send(dmgMsg).catch(discordCatch);
  await logGameAction(game, client, dmgMsg, { phase: 'ROUND', icon: 'attack' });

  // Card text: "Then, for each chosen figure, the figure that attacked
  // gains 1 HARMFUL condition of your opponent's choice." Per canonical
  // text the attacker owes 1 condition per chosen figure regardless of
  // whether that figure was defeated by Heavy Fire — "chose" is past-
  // tense; the chosen figures don't need to still be on the board for
  // the attacker's penalty to apply.
  pending.conditionsOwed = pending.chosenTargets.length;

  if (pending.conditionsOwed <= 0) {
    await thread.send('**Heavy Fire** — No targets chosen, no conditions owed.').catch(discordCatch);
    clearPendingHeavyFire(game);
    saveGames(game.gameId);
    return;
  }

  // Opponent picks 1 harmful condition per surviving chosen target to apply to the attacker
  pending.conditionsApplied = 0;
  await advanceHeavyFireConditionPick(game, pending, ctx);
}

/** Internal helper: prompt opponent to pick 1 harmful condition for the attacker. */
async function advanceHeavyFireConditionPick(game, pending, ctx) {
  const { client, saveGames } = ctx;
  const thread = await fetchCombatThread(client, pending.combatThreadId);
  if (!thread) { saveGames(game.gameId); return; }

  if (pending.conditionsApplied >= pending.conditionsOwed) {
    await thread.send(`**Heavy Fire** — All ${pending.conditionsOwed} harmful condition${pending.conditionsOwed !== 1 ? 's' : ''} applied to **${pending.attackerDcName}**.`).catch(discordCatch);
    clearPendingHeavyFire(game);
    saveGames(game.gameId);
    return;
  }

  const oppPN = opponentPlayerNum(pending.attackerPlayerNum);
  const oppId = getPlayerId(game, oppPN);
  const conditions = ['Stun', 'Bleed', 'Weaken'];
  const btns = conditions.map(c =>
    new ButtonBuilder()
      .setCustomId(`heavy_fire_cond_${game.gameId}_${c}`)
      .setLabel(c)
      .setStyle(ButtonStyle.Danger)
  );
  const condNum = pending.conditionsApplied + 1;
  await thread.send({
    content: `<@${oppId}> **Heavy Fire** — Choose a harmful condition to apply to **${pending.attackerDcName}** (${condNum}/${pending.conditionsOwed}):`,
    allowedMentions: { users: [oppId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Heavy Fire "Use" button: heavy_fire_use_{gameId} */
export async function handleHeavyFireUse(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcExhaustedState,
    dcMessageMeta, renderDcEmbed, logGameAction } = ctx;
  const m = interaction.customId.match(/^heavy_fire_use_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can use Heavy Fire.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Exhaust the Heavy Fire card (persist for restart survival)
  if (pending.hfMsgId) {
    dcExhaustedState.set(pending.hfMsgId, true);
    game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
    if (!game.abilityExhaustedMsgIds.includes(pending.hfMsgId)) game.abilityExhaustedMsgIds.push(pending.hfMsgId);
    // Refresh the Heavy Fire DC embed AND its components — exhaust just
    // changed, so the toggle row's button label needs to update too.
    // Previously this site edited only { embeds, files } which preserved
    // stale buttons (Heavy Fire is figureless; the toggle row depends on
    // `bothDrawn` and `exhausted`). Fixed by routing through
    // updateDcCardMessage which always rebuilds components from current state.
    await updateDcCardMessage(client, game, pending.hfMsgId, ctx, { exhausted: true, errorContext: 'Heavy Fire DC refresh failed:' });
  }
  await logGameAction(game, client, `**Heavy Fire** — Exhausted by P${pending.attackerPlayerNum} after **${pending.attackerDcName}** resolved an attack.`, { phase: 'ROUND', icon: 'card' });

  // Start target picking
  await advanceHeavyFirePick(game, pending, ctx);
}

/** Heavy Fire skip (don't use): heavy_fire_skip_{gameId} */
export async function handleHeavyFireSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^heavy_fire_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  await interaction.deferUpdate().catch(discordCatch);
  if (game) clearPendingHeavyFire(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

/** Heavy Fire target pick: heavy_fire_tgt_{gameId}_{figureKey} */
export async function handleHeavyFireTarget(interaction, ctx) {
  const { getGame, saveGames, canActAsPlayer } = ctx;
  const parts = splitCustomId(interaction.customId, 'heavy_fire_tgt_');
  const gameId = parts[0];
  const figureKey = parts.slice(1).join('_');
  if (!gameId || !figureKey) return;
  const game = getGame(gameId);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick Heavy Fire targets.')) return;
  const target = pending.hostiles.find(t => t.figureKey === figureKey);
  if (!target) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  pending.chosenTargets.push(target);

  // Check if we've picked enough or can pick more
  if (pending.chosenTargets.length >= pending.diceCount) {
    await startHeavyFireConditions(game, pending, ctx);
  } else {
    await advanceHeavyFirePick(game, pending, ctx);
  }
}

/** Heavy Fire "Done Picking" button: heavy_fire_tgt_done_{gameId} */
export async function handleHeavyFireDone(interaction, ctx) {
  const { getGame, saveGames, canActAsPlayer } = ctx;
  const m = interaction.customId.match(/^heavy_fire_tgt_done_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can finish Heavy Fire picking.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Finish picking — apply damage to whatever was chosen
  await startHeavyFireConditions(game, pending, ctx);
}

/** Heavy Fire condition choice by opponent: heavy_fire_cond_{gameId}_{condition} */
export async function handleHeavyFireCondition(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, applyCondition,
    isConditionImmune, logGameAction } = ctx;
  const m = interaction.customId.match(/^heavy_fire_cond_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, condition] = m;
  const game = getGame(gameId);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  const oppPN = opponentPlayerNum(pending.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, oppPN, canActAsPlayer, 'Only the opponent can choose the Heavy Fire condition.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Apply the chosen harmful condition to the attacker figure
  const attackerFk = pending.attackerFigureKey;
  if (isConditionImmune(game, attackerFk)) {
    const thread = await fetchCombatThread(client, pending.combatThreadId);
    if (thread) await thread.send(`**Heavy Fire** — **${pending.attackerDcName}** is immune to conditions; **${condition}** not applied.`).catch(discordCatch);
    await logGameAction(game, client, `**Heavy Fire** — **${pending.attackerDcName}** is immune to conditions; **${condition}** not applied.`, { phase: 'ROUND', icon: 'card' });
  } else {
    applyCondition(game, attackerFk, condition);
    const thread = await fetchCombatThread(client, pending.combatThreadId);
    if (thread) await thread.send(`**Heavy Fire** — **${pending.attackerDcName}** gains **${condition}** (opponent's choice).`).catch(discordCatch);
    await logGameAction(game, client, `**Heavy Fire** — **${pending.attackerDcName}** gains **${condition}** (opponent's choice).`, { phase: 'ROUND', icon: 'card' });
  }

  pending.conditionsApplied++;
  await advanceHeavyFireConditionPick(game, pending, ctx);
}

// ── Havoc Shot (Fenn Signis) ─────────────────────────────────────────────
export async function handleHavocShotUse(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcHealthState, dcMessageMeta,
    dcExhaustedState, findDcMessageIdForFigure, renderDcEmbed, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^havoc_shot_use_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingHavocShot) return;
  const hs = game.pendingHavocShot;
  if (!await requirePlayer(interaction, game, interaction.user.id, hs.attackerPlayerNum, canActAsPlayer, 'Only the attacker can use Havoc Shot.')) return;
  // Suffer 1 Strain (HP damage) to attacker
  const atkMsgId = hs.attackerMsgId;
  if (atkMsgId) {
    await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: hs.attackerFigureKey, msgId: atkMsgId, figIndex: hs.attackerFigureIndex,
      amount: 1, controllerPlayerNum: hs.attackerPlayerNum,
      source: 'Havoc Shot', viaStrain: true,
    });
    // Refresh attacker embed
    await updateDcCardMessage(client, game, atkMsgId, ctx);
  }
  // Show figure picker
  const btns = hs.targets.slice(0, 4).map((t, i) =>
    new ButtonBuilder().setCustomId(`havoc_shot_pick_${game.gameId}_${i}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger)
  );
  btns.push(new ButtonBuilder().setCustomId(`havoc_shot_done_${game.gameId}`).setLabel('Done (skip remaining)').setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns);
  await interaction.message.edit({
    content: `**Havoc Shot** — Suffered 1 Strain. Choose up to ${hs.maxPicks} figure(s) to deal 1 Damage:`,
    components: rows,
  }).catch(discordCatch);
  await logGameAction(game, client, `**Havoc Shot** — **${dcNameFromFigureKey(hs.attackerFigureKey)}** suffered 1 Strain.`, { phase: 'ROUND', icon: 'attack' });
  saveGames(game.gameId);
}

export async function handleHavocShotSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^havoc_shot_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingHavocShot(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

export async function handleHavocShotPick(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcHealthState, dcMessageMeta,
    dcExhaustedState, findDcMessageIdForFigure, renderDcEmbed, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^havoc_shot_pick_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingHavocShot) return;
  const hs = game.pendingHavocShot;
  if (!await requirePlayer(interaction, game, interaction.user.id, hs.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick.')) return;
  const target = hs.targets[parseInt(idxStr, 10)];
  if (!target) return;
  // Apply 1 Damage
  const targetMsgId = findDcMessageIdForFigure(gameId, target.playerNum, target.figureKey);
  if (targetMsgId) {
    const { figureIndex: figIdx } = parseFigureKey(target.figureKey);
    await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: targetMsgId, figIndex: figIdx,
      amount: 1, controllerPlayerNum: target.playerNum,
      attackerPlayerNum: hs.attackerPlayerNum, source: 'Havoc Shot',
    });
    await updateDcCardMessage(client, game, targetMsgId, ctx);
  }
  hs.chosen.push(target.figureKey);
  const thread = await fetchCombatThread(client, hs.combatThreadId);
  if (thread) await thread.send(`**Havoc Shot** — **${target.label}** suffers 1 Damage.`).catch(discordCatch);
  await logGameAction(game, client, `**Havoc Shot** — **${target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
  // If more picks available and more targets
  const remaining = hs.maxPicks - hs.chosen.length;
  const remainingTargets = hs.targets.filter((t, i) => !hs.chosen.includes(t.figureKey));
  const remaining2 = remainingTargets;
  if (remaining > 0 && remaining2.length > 0) {
    const btns2 = remaining2.slice(0, 4).map((t) => {
      const origIdx = hs.targets.indexOf(t);
      return new ButtonBuilder().setCustomId(`havoc_shot_pick_${gameId}_${origIdx}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger);
    });
    btns2.push(new ButtonBuilder().setCustomId(`havoc_shot_done_${gameId}`).setLabel('Done').setStyle(ButtonStyle.Secondary));
    const rows2 = chunkButtonsToRows(btns2);
    await interaction.message.edit({ content: `**Havoc Shot** — ${remaining} pick(s) remaining:`, components: rows2 }).catch(discordCatch);
  } else {
    clearPendingHavocShot(game);
    await interaction.message.edit({ content: `**Havoc Shot** — Complete.`, components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

export async function handleHavocShotDone(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^havoc_shot_done_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingHavocShot(game);
  await interaction.message.edit({ content: `**Havoc Shot** — Complete.`, components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

// ── Deflect (Luke Skywalker JK) ──────────────────────────────────────────
export async function handleDeflectPick(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcHealthState, dcMessageMeta,
    dcExhaustedState, findDcMessageIdForFigure, renderDcEmbed, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^deflect_pick_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingDeflect) return;
  const df = game.pendingDeflect;
  if (!await requirePlayer(interaction, game, interaction.user.id, df.deflectorPlayerNum, canActAsPlayer, 'Only the Deflect owner can pick.')) return;
  const target = df.hostiles[parseInt(idxStr, 10)];
  if (!target) return;
  const targetMsgId = findDcMessageIdForFigure(gameId, target.playerNum, target.figureKey);
  if (targetMsgId) {
    const { figureIndex: figIdx } = parseFigureKey(target.figureKey);
    await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: targetMsgId, figIndex: figIdx,
      amount: 1, controllerPlayerNum: target.playerNum,
      source: 'Deflect',
    });
    await updateDcCardMessage(client, game, targetMsgId, ctx);
  }
  const dfThread = await fetchCombatThread(client, df.combatThreadId);
  if (dfThread) await dfThread.send(`**Deflect** — **${df.deflectorDcName}**: **${target.label}** suffers 1 Damage.`).catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Deflect** — **${df.deflectorDcName}** redirects 1 Damage to **${target.label}**.`, { phase: 'ROUND', icon: 'attack' });
  clearPendingDeflect(game);
  saveGames(game.gameId);
}

export async function handleDeflectSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^deflect_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingDeflect(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

// ── Wanton Destruction (Saw Gerrera) ─────────────────────────────────────
export async function handleWantonUse(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^wanton_use_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingWantonDestruction) return;
  const wd = game.pendingWantonDestruction;
  if (!await requirePlayer(interaction, game, interaction.user.id, wd.ownerPlayerNum, canActAsPlayer, 'Only the attacker\'s team can use Wanton Destruction.')) return;
  // Discard the first CC card from hand (auto-pick cheapest)
  const hKey = ccHandKey(wd.ownerPlayerNum);
  const hand = game[hKey] || [];
  if (hand.length === 0) {
    await interaction.followUp({ content: 'No Command cards in hand to discard.', ephemeral: true }).catch(discordCatch);
    clearPendingWantonDestruction(game);
    await interaction.message.edit({ components: [] }).catch(discordCatch);
    saveGames(game.gameId); return;
  }
  // Show CC cards as buttons for the player to pick which to discard
  // Discord allows max 25 buttons (5 rows x 5)
  const ccBtns = [...new Set(hand)].slice(0, 25).map((card, i) =>
    new ButtonBuilder().setCustomId(`wanton_cc_${game.gameId}_${i}_${card.replace(/\s+/g, '_').slice(0, 40)}`).setLabel(card.slice(0, 80)).setStyle(ButtonStyle.Secondary)
  );
  const ccRows = chunkButtonsToRows(ccBtns);
  await interaction.message.edit({
    content: `**Wanton Destruction** — Choose a Command card to discard:`,
    components: ccRows,
  }).catch(discordCatch);
  saveGames(game.gameId);
}

export async function handleWantonCcPick(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcHealthState, dcMessageMeta,
    dcExhaustedState, findDcMessageIdForFigure, renderDcEmbed, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // wanton_cc_{gameId}_{index}_{cardNameSlug}
  const m = interaction.customId.match(/^wanton_cc_([^_]+)_(\d+)_(.+)$/);
  if (!m) return;
  const [, gameId, idxStr, cardSlug] = m;
  const game = getGame(gameId);
  if (!game?.pendingWantonDestruction) return;
  const wd = game.pendingWantonDestruction;
  if (!await requirePlayer(interaction, game, interaction.user.id, wd.ownerPlayerNum, canActAsPlayer, 'Not your choice.')) return;
  // Find and discard the CC card
  const hKey = ccHandKey(wd.ownerPlayerNum);
  const dKey = ccDiscardKey(wd.ownerPlayerNum);
  const hand = game[hKey] || [];
  const uniqueCards = [...new Set(hand)];
  const cardIdx = parseInt(idxStr, 10);
  const cardName = uniqueCards[cardIdx];
  if (!cardName) return;
  // Remove from hand, add to discard
  const hIdx = hand.indexOf(cardName);
  if (hIdx >= 0) hand.splice(hIdx, 1);
  game[hKey] = hand;
  game[dKey] = [...(game[dKey] || []), cardName];
  await logGameAction(game, client, `**Wanton Destruction** — Discarded **${cardName}**.`, { phase: 'ROUND', icon: 'card' });
  // Show figure picker — Discord allows max 25 buttons (5 rows x 5); reserve 1 for Done
  const btns = wd.targets.slice(0, 24).map((t, i) =>
    new ButtonBuilder().setCustomId(`wanton_pick_${gameId}_${i}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger)
  );
  btns.push(new ButtonBuilder().setCustomId(`wanton_done_${gameId}`).setLabel('Done').setStyle(ButtonStyle.Secondary));
  const rows = chunkButtonsToRows(btns);
  await interaction.message.edit({
    content: `**Wanton Destruction** — CC discarded. Choose up to ${wd.maxPicks} figures to deal 1 Damage:`,
    components: rows,
  }).catch(discordCatch);
  saveGames(game.gameId);
}

export async function handleWantonPick(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcHealthState, dcMessageMeta,
    dcExhaustedState, findDcMessageIdForFigure, renderDcEmbed, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^wanton_pick_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingWantonDestruction) return;
  const wd = game.pendingWantonDestruction;
  if (!await requirePlayer(interaction, game, interaction.user.id, wd.ownerPlayerNum, canActAsPlayer, 'Not your pick.')) return;
  const target = wd.targets[parseInt(idxStr, 10)];
  if (!target) return;
  const targetMsgId = findDcMessageIdForFigure(gameId, target.playerNum, target.figureKey);
  if (targetMsgId) {
    const { figureIndex: figIdx } = parseFigureKey(target.figureKey);
    await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey: target.figureKey, msgId: targetMsgId, figIndex: figIdx,
      amount: 1, controllerPlayerNum: target.playerNum,
      attackerPlayerNum: wd.ownerPlayerNum, source: 'Wanton Destruction',
    });
    await updateDcCardMessage(client, game, targetMsgId, ctx);
  }
  wd.chosen.push(target.figureKey);
  const thread = await fetchCombatThread(client, wd.combatThreadId);
  if (thread) await thread.send(`**Wanton Destruction** — **${target.label}** suffers 1 Damage.`).catch(discordCatch);
  await logGameAction(game, client, `**Wanton Destruction** — **${target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
  const remaining = wd.maxPicks - wd.chosen.length;
  const remTargets = wd.targets.filter(t => !wd.chosen.includes(t.figureKey));
  if (remaining > 0 && remTargets.length > 0) {
    // Discord allows max 25 buttons (5 rows x 5); reserve 1 for Done
    const btns2 = remTargets.slice(0, 24).map(t => {
      const origIdx = wd.targets.indexOf(t);
      return new ButtonBuilder().setCustomId(`wanton_pick_${gameId}_${origIdx}`).setLabel(t.label.slice(0, 80)).setStyle(ButtonStyle.Danger);
    });
    btns2.push(new ButtonBuilder().setCustomId(`wanton_done_${gameId}`).setLabel('Done').setStyle(ButtonStyle.Secondary));
    const rows2 = chunkButtonsToRows(btns2);
    await interaction.message.edit({ content: `**Wanton Destruction** — ${remaining} pick(s) remaining:`, components: rows2 }).catch(discordCatch);
  } else {
    clearPendingWantonDestruction(game);
    await interaction.message.edit({ content: `**Wanton Destruction** — Complete.`, components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

export async function handleWantonDone(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^wanton_done_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingWantonDestruction(game);
  await interaction.message.edit({ content: `**Wanton Destruction** — Complete.`, components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}

export async function handleWantonSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^wanton_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) clearPendingWantonDestruction(game);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames(game.gameId);
}
