/**
 * Combat special-effect handlers extracted from index.js:
 * bleed, sidewinder, boltslinger, indiscriminate fire, fighting knife,
 * concussive bolt, spread the pain, missile salvo.
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { reduceHp, awardKillVp, opponentPlayerNum, parseFigureKey, dcNameFromFigureKey, checkNefariousGains, applyCondition } from '../game/index.js';
import { getPlayAreaId, getPlayerId, getDcList, getDcMessageIds, ccDeckKey, ccDiscardKey, removeFigurePosition } from '../game/player-helpers.js';
import { getDcKeywords } from '../data-loader.js';
import { checkDeckDiscardPassiveRedraws, checkFriendlyDefeatedPassiveRedraws } from '../game/cc-passive-redraw.js';
import { discordCatch } from '../error-handling.js';
import { requirePlayer } from '../utils/guards.js';

// ── Internal helpers ─────────────────────────────

/** Apply Indiscriminate Fire splash damage/strain to all figures within 2 of target. */
export async function applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, splashTargets, thread, ctx) {
  const {
    client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, getDcEffects, logGameAction,
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
    const { newHp, maxHp: splashMaxHp } = reduceHp(dcHealthState, game, mid, figIdx, totalEffect, t.playerNum);
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
      removeFigurePosition(game, t.playerNum, t.figureKey);
      if (game.figureConditions?.[t.figureKey]) delete game.figureConditions[t.figureKey];
      const splashDcEff = getDcEffects()?.[dcNameFromFigureKey(t.figureKey)];
      const splashVP = splashDcEff?.cost ?? 1;
      awardKillVp(game, attackerPlayerNum, splashVP);
      lines.push(`  → **${t.label} defeated!** +${splashVP} VP`);
      // Nefarious Gains (Jabba): Indiscriminate Fire defeat
      const _ngIF = checkNefariousGains(game, t.playerNum);
      if (_ngIF) lines.push(`  → 💰 **Nefarious Gains** — Jabba gains 1 VP (P${_ngIF.jabbaOwnerPN} VP: ${_ngIF.vpTotal})`);
    }
    try {
      const tMeta = dcMessageMeta.get(mid);
      if (tMeta) {
        const ch = await client.channels.fetch(getPlayAreaId(game, tMeta.playerNum));
        const msg = await ch.messages.fetch(mid);
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(mid) ?? false, tMeta.displayName, dcHealthState.get(mid) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, mid), null, null, getNicknamesForDcMessage?.(game, tMeta));
        await msg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch {}
  }
  const msg = `**Indiscriminate Fire** — ${dieDesc}:\n${lines.join('\n')}`;
  await thread.send(msg).catch(discordCatch);
  await logGameAction(game, client, `**Indiscriminate Fire** — ${dieDesc}:\n${lines.join('\n')}`, { phase: 'ROUND', icon: 'attack' });
  saveGames();
}

/** Show next Spread the Pain figure-pick prompt, or finish if all conditions applied. */
async function advanceSpreadThePain(game, pending, ctx) {
  const {
    client, saveGames, finishCombatResolution, getMapSpaces, getFigureLabel,
  } = ctx;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client); saveGames(); return; }
  if (pending.conditionIdx >= pending.conditions.length) {
    delete game.pendingSpreadThePain;
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames();
    return;
  }
  const nextCond = pending.conditions[pending.conditionIdx];
  const targetPos = game.figurePositions?.[pending.defenderPlayerNum]?.[pending.combat.target?.figureKey];
  const figuresAtSpaces = [];
  if (targetPos && game.selectedMap?.id) {
    const ms = getMapSpaces(game.selectedMap.id);
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
    delete game.pendingSpreadThePain;
    await finishCombatResolution(game, pending.combat, pending.resultText, new Set(pending.initialEmbedRefreshMsgIds || []), client);
    saveGames();
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
  saveGames();
}

// ── Exported handlers ───────────────────────────────────────────────────────

/** Handle bleed_accept_ / bleed_prevent_ button clicks. */
export async function handleBleedResolve(interaction, ctx) {
  const {
    getGame, saveGames, client, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, logGameAction, calculateKillVp,
    decrementActivationIfGroupDefeated, checkWinConditions, canActAsPlayer,
    filterCondition,
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
      const { newHp, wasDefeated } = reduceHp(dcHealthState, game, msgId, figureIndex, 1, playerNum);
      if (dcHealthState.get(msgId)?.[figureIndex]) {
        await logGameAction(game, interaction.client, `\u{1FA78} **Bleeding** — **${dcName}** suffered 1 damage.`, { phase: 'ROUND', icon: 'attack' });
        const dcIds = getDcMessageIds(game, playerNum);
        const dcList = getDcList(game, playerNum);
        const idx = (dcIds || []).indexOf(msgId);
        if (wasDefeated) {
          removeFigurePosition(game, playerNum, figureKey);
          const oppPN = opponentPlayerNum(playerNum);
          const vp = calculateKillVp(dcName);
          awardKillVp(game, oppPN, vp);
          await logGameAction(game, interaction.client, `\u{1FA78} **Bleeding** — **${dcName}** was defeated! +${vp} VP to P${oppPN}`, { phase: 'ROUND', icon: 'attack' });
          // CC Passive Redraw: friendly-defeated trigger (Shared Experience) — Bleed defeat
          {
            const _bleedPrResult = checkFriendlyDefeatedPassiveRedraws(game, playerNum, dcName);
            for (const _bleedPrCard of _bleedPrResult.redrawn) {
              await logGameAction(game, interaction.client, `**Passive Redraw** — **${_bleedPrCard}** re-drawn from discard (friendly **${dcName}** defeated by Bleeding).`, { phase: 'ROUND', icon: 'card' });
            }
          }
          // Nefarious Gains (Jabba): Bleeding defeat
          const _ngBleed = checkNefariousGains(game, playerNum);
          if (_ngBleed) await logGameAction(game, interaction.client, `💰 **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${_ngBleed.jabbaOwnerPN} VP: ${_ngBleed.vpTotal}`, { phase: 'ROUND', icon: 'card' });
          if (idx >= 0) {
            await decrementActivationIfGroupDefeated(game, playerNum, idx, interaction.client);
          }
          await checkWinConditions(game, interaction.client);
        }
        // Refresh DC embed
        try {
          const meta = dcMessageMeta.get(msgId);
          if (meta) {
            const channelId = getPlayAreaId(game, playerNum);
            const ch = await interaction.client.channels.fetch(channelId);
            const dcMsg = await ch.messages.fetch(msgId);
            const exhausted = dcExhaustedState.get(msgId) ?? false;
            const health = dcHealthState.get(msgId) || [];
            const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, health, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId), null, null, getNicknamesForDcMessage?.(game, meta));
            await dcMsg.edit({ embeds: [embed], files }).catch(discordCatch);
          }
        } catch (err) {
          console.error('Failed to update DC embed after Bleeding:', err);
        }
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
  }
  filterCondition(game, figureKey, 'Bleed');
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
}

/** Sidewinder (Jyn Odan): apply 1 Strain + grant 2 MP after attack. */
export async function handleSidewinderApply(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, logGameAction, ensureMovementBankMessage,
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
  reduceHp(dcHealthState, game, attackerMsgId, figureIndex, 1, meta.playerNum);
  // Grant 2 MP
  game.movementBank = game.movementBank || {};
  const bank = game.movementBank[attackerMsgId] || { total: 0, remaining: 0 };
  bank.total = (bank.total ?? 0) + 2;
  bank.remaining = (bank.remaining ?? 0) + 2;
  game.movementBank[attackerMsgId] = bank;
  // Mark used this round
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[swKey] = true;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await interaction.message.channel.send('**Sidewinder** — Jyn Odan suffered 1 Strain and gained +2 MP.');
  await logGameAction(game, client, `**Sidewinder** — Jyn Odan suffered 1 Strain and gained +2 MP.`, { phase: 'ROUND', icon: 'card' });
  await ensureMovementBankMessage(game, attackerMsgId, client);
  try {
    const ch = await client.channels.fetch(getPlayAreaId(game, meta.playerNum));
    const msg = await ch.messages.fetch(attackerMsgId);
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, dcExhaustedState.get(attackerMsgId) ?? false, meta.displayName, dcHealthState.get(attackerMsgId) || [], getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, attackerMsgId), null, null, getNicknamesForDcMessage?.(game, meta));
    await msg.edit({ embeds: [embed], files }).catch(discordCatch);
  } catch (e) { console.error('Failed to refresh Sidewinder DC embed:', e); }
  saveGames();
}

export async function handleSidewinderSkip(interaction, ctx) {
  const { saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
}

/** Boltslinger (Vinto Hreeda): deal 1 Dmg to chosen nearby hostile. */
export async function handleBoltslingerTarget(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, logGameAction, findDcMessageIdForFigure,
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
    const { newHp: bsNewHp } = reduceHp(dcHealthState, game, targetMsgId, figIdx, 1, target.playerNum);
    try {
      const tMeta = dcMessageMeta.get(targetMsgId);
      if (tMeta) {
        const ch = await client.channels.fetch(getPlayAreaId(game, tMeta.playerNum));
        const msg = await ch.messages.fetch(targetMsgId);
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(targetMsgId) ?? false, tMeta.displayName, dcHealthState.get(targetMsgId) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, targetMsgId), null, null, getNicknamesForDcMessage?.(game, tMeta));
        await msg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch (e) { console.error('Failed to refresh Boltslinger target embed:', e); }
  }
  const blThread = await client.channels.fetch(combatThreadId).catch(() => null);
  if (blThread) await blThread.send(`**Boltslinger** — **${target.label}** suffers 1 Damage.`);
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Boltslinger** — **${target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
  delete game.pendingBoltslinger;
  saveGames();
}

export async function handleBoltslingerSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^boltslinger_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (game) delete game.pendingBoltslinger;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
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
  delete game.pendingIndiscriminateFire;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  const thread = await client.channels.fetch(combatThreadId).catch(() => null);
  if (thread) await applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, targets, thread, ctx);
  saveGames();
}

/** Indiscriminate Fire skip button: indiscriminate_skip_{gameId} */
export async function handleIndiscriminateFireSkip(interaction, ctx) {
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^indiscriminate_skip_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  await interaction.deferUpdate().catch(discordCatch);
  if (game) delete game.pendingIndiscriminateFire;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
}

/** Fighting Knife target pick: fighting_knife_target_{gameId}_{index} */
export async function handleFightingKnifeTarget(interaction, ctx) {
  const {
    getGame, saveGames, client, canActAsPlayer, dcMessageMeta, dcHealthState,
    dcExhaustedState, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, logGameAction, findDcMessageIdForFigure,
    calculateKillVp, decrementActivationIfGroupDefeated, checkWinConditions,
    finishCombatResolution, rollSingleAttackDie,
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
  delete game.pendingFightingKnife;
  // Roll 1 red die
  const die = rollSingleAttackDie('red');
  const hits = die.dmg || 0;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (hits > 0 && target.msgId) {
    const { figureIndex: figIndex } = parseFigureKey(target.figureKey);
    const { newHp: newCur, wasDefeated: fkDefeated } = reduceHp(dcHealthState, game, target.msgId, figIndex, hits, target.playerNum);
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
    if (fkDefeated) {
      removeFigurePosition(game, target.playerNum, target.figureKey);
      const dcName = dcNameFromFigureKey(target.figureKey);
      const vp = calculateKillVp(dcName);
      awardKillVp(game, pending.attackerPlayerNum, vp);
      await logGameAction(game, client, `**Fighting Knife** — **${target.label}** was defeated! +${vp} VP`, { phase: 'ROUND', icon: 'attack' });
      // Nefarious Gains (Jabba): Fighting Knife defeat
      const _ngFK = checkNefariousGains(game, target.playerNum);
      if (_ngFK) await logGameAction(game, client, `💰 **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${_ngFK.jabbaOwnerPN} VP: ${_ngFK.vpTotal}`, { phase: 'ROUND', icon: 'card' });
      const dcIds = getDcMessageIds(game, target.playerNum);
      const idx = (dcIds || []).indexOf(target.msgId);
      if (idx >= 0) {
        await decrementActivationIfGroupDefeated(game, target.playerNum, idx, client);
      }
      await checkWinConditions(game, client);
    }
  }
  const dieDesc = `${die.dmg}dmg${die.surge ? `/${die.surge}\u21AF` : ''}`;
  await logGameAction(game, client, `**Fighting Knife** — ${target.label}: rolled 1 red die (${dieDesc}), dealt **${hits}** damage`, { phase: 'ROUND', icon: 'attack' });
  await thread.send(`**Fighting Knife** — Rolled 1 red die on **${target.label}**: ${dieDesc} \u2192 **${hits} Damage**.`).catch(discordCatch);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
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
  delete game.pendingFightingKnife;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
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
  delete game.pendingConcussiveBolt;
  // Move the figure to the chosen space
  game.figurePositions = game.figurePositions || {};
  game.figurePositions[pending.defenderPlayerNum] = game.figurePositions[pending.defenderPlayerNum] || {};
  game.figurePositions[pending.defenderPlayerNum][pending.figureKey] = space;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await logGameAction(game, client, `**Concussive Bolt** — **${pending.figureLabel}** pushed from ${String(pending.currentPos).toUpperCase()} to **${space.toUpperCase()}**`, { phase: 'ROUND', icon: 'attack' });
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
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
  delete game.pendingConcussiveBolt;
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
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
  const salvoThread = threadId ? await client.channels.fetch(threadId).catch(() => null) : null;
  const ownerId = getPlayerId(game, playerNum);
  const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
  const msg = `<@${ownerId}> **Missile Salvo** — **${colorLabel} die** selected (+3 Accuracy). Click **Attack** to target a different hostile figure. This attack costs no action.`;
  if (salvoThread) await salvoThread.send({ content: msg, allowedMentions: { users: [ownerId] } }).catch(discordCatch);
  saveGames();
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
  const _dcAphraDcList = getDcList(game, playerNum) || [];
  const _dcAphraAlive = _dcAphraDcList.some(dc => dc?.dcName === 'Doctor Aphra') &&
    Object.keys(game.figurePositions?.[playerNum] || {}).some(fk => fk.startsWith('Doctor Aphra-'));
  if (_dcAphraAlive) {
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      actionsData.remaining = Math.min((actionsData.total ?? 2) + 1, actionsData.remaining + 1);
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
  saveGames();
}

// ── Heavy Fire handlers ─────────────────────────────────────────────────────

/** Internal helper: advance to next Heavy Fire target pick, or finish. */
async function advanceHeavyFirePick(game, pending, ctx) {
  const { client, saveGames, logGameAction } = ctx;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }

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
  const btns = available.slice(0, 4).map((t, i) =>
    new ButtonBuilder()
      .setCustomId(`heavy_fire_tgt_${game.gameId}_${i}`)
      .setLabel(t.label)
      .setStyle(ButtonStyle.Danger)
  );
  btns.push(new ButtonBuilder().setCustomId(`heavy_fire_tgt_done_${game.gameId}`).setLabel('Done Picking').setStyle(ButtonStyle.Secondary));
  // Stash available snapshot for index lookup
  pending.availableSnapshot = available;
  await thread.send({
    content: `<@${ownerId}> **Heavy Fire** — Pick hostile target ${pending.chosenTargets.length + 1}/${pending.diceCount} (within 2 of target space). ${remaining} pick${remaining !== 1 ? 's' : ''} left:`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch(discordCatch);
  saveGames();
}

/** Internal helper: apply damage to all chosen targets, then start opponent condition picking. */
async function startHeavyFireConditions(game, pending, ctx) {
  const {
    client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, getDcEffects, logGameAction, calculateKillVp,
    decrementActivationIfGroupDefeated, checkWinConditions,
  } = ctx;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }

  if (pending.chosenTargets.length === 0) {
    await thread.send('**Heavy Fire** — No targets chosen. Effect skipped.').catch(discordCatch);
    delete game.pendingHeavyFire;
    saveGames();
    return;
  }

  // Apply 1 Damage to each chosen hostile
  const lines = [];
  const defeatedTargets = [];
  for (const t of pending.chosenTargets) {
    const mid = findDcMessageIdForFigure(game.gameId, t.playerNum, t.figureKey);
    if (!mid) continue;
    const { figureIndex: figIdx } = parseFigureKey(t.figureKey);
    const { newHp, wasDefeated } = reduceHp(dcHealthState, game, mid, figIdx, 1, t.playerNum);
    lines.push(`• **${t.label}** suffers 1 Damage`);
    if (wasDefeated) {
      removeFigurePosition(game, t.playerNum, t.figureKey);
      if (game.figureConditions?.[t.figureKey]) delete game.figureConditions[t.figureKey];
      const dcEff = getDcEffects()?.[dcNameFromFigureKey(t.figureKey)];
      const vp = dcEff?.cost ?? 1;
      awardKillVp(game, pending.attackerPlayerNum, vp);
      lines.push(`  → **${t.label} defeated!** +${vp} VP`);
      defeatedTargets.push(t);
      const _ngHF = checkNefariousGains(game, t.playerNum);
      if (_ngHF) lines.push(`  → **Nefarious Gains** — Jabba gains 1 VP (P${_ngHF.jabbaOwnerPN} VP: ${_ngHF.vpTotal})`);
      const dcIds = getDcMessageIds(game, t.playerNum);
      const idx = (dcIds || []).indexOf(mid);
      if (idx >= 0) {
        await decrementActivationIfGroupDefeated(game, t.playerNum, idx, client);
      }
      await checkWinConditions(game, client);
    }
    // Refresh DC embed
    try {
      const tMeta = dcMessageMeta.get(mid);
      if (tMeta) {
        const ch = await client.channels.fetch(getPlayAreaId(game, tMeta.playerNum));
        const msg = await ch.messages.fetch(mid);
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(mid) ?? false, tMeta.displayName, dcHealthState.get(mid) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, mid), null, null, getNicknamesForDcMessage?.(game, tMeta));
        await msg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch {}
  }
  const dmgMsg = `**Heavy Fire** — Splash damage:\n${lines.join('\n')}`;
  await thread.send(dmgMsg).catch(discordCatch);
  await logGameAction(game, client, dmgMsg, { phase: 'ROUND', icon: 'attack' });

  // Filter out defeated targets from condition penalty list
  const defeatedKeys = new Set(defeatedTargets.map(t => t.figureKey));
  const survivingChosen = pending.chosenTargets.filter(t => !defeatedKeys.has(t.figureKey));
  pending.conditionsOwed = survivingChosen.length;

  if (pending.conditionsOwed <= 0) {
    await thread.send('**Heavy Fire** — No conditions owed (all targeted figures were defeated).').catch(discordCatch);
    delete game.pendingHeavyFire;
    saveGames();
    return;
  }

  // Opponent picks 1 harmful condition per surviving chosen target to apply to the attacker
  pending.conditionsApplied = 0;
  await advanceHeavyFireConditionPick(game, pending, ctx);
}

/** Internal helper: prompt opponent to pick 1 harmful condition for the attacker. */
async function advanceHeavyFireConditionPick(game, pending, ctx) {
  const { client, saveGames } = ctx;
  const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }

  if (pending.conditionsApplied >= pending.conditionsOwed) {
    await thread.send(`**Heavy Fire** — All ${pending.conditionsOwed} harmful condition${pending.conditionsOwed !== 1 ? 's' : ''} applied to **${pending.attackerDcName}**.`).catch(discordCatch);
    delete game.pendingHeavyFire;
    saveGames();
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
  saveGames();
}

/** Heavy Fire "Use" button: heavy_fire_use_{gameId} */
export async function handleHeavyFireUse(interaction, ctx) {
  const { getGame, saveGames, client, canActAsPlayer, dcExhaustedState,
    dcMessageMeta, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getNicknamesForDcMessage, getDcUpgradeAttachments, logGameAction } = ctx;
  const m = interaction.customId.match(/^heavy_fire_use_([^_]+)$/);
  if (!m) return;
  const game = getGame(m[1]);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can use Heavy Fire.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ components: [] }).catch(discordCatch);

  // Exhaust the Heavy Fire card
  if (pending.hfMsgId) {
    dcExhaustedState.set(pending.hfMsgId, true);
    // Refresh the Heavy Fire DC embed
    try {
      const hfMeta = dcMessageMeta.get(pending.hfMsgId);
      if (hfMeta) {
        const ch = await client.channels.fetch(getPlayAreaId(game, hfMeta.playerNum));
        const msg = await ch.messages.fetch(pending.hfMsgId);
        const { embed, files } = await buildDcEmbedAndFiles(hfMeta.dcName, true, hfMeta.displayName, [], getConditionsForDcMessage(game, hfMeta), getDcUpgradeAttachments(game, pending.hfMsgId), null, null, getNicknamesForDcMessage?.(game, hfMeta));
        await msg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch {}
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
  if (game) delete game.pendingHeavyFire;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  saveGames();
}

/** Heavy Fire target pick: heavy_fire_tgt_{gameId}_{index} */
export async function handleHeavyFireTarget(interaction, ctx) {
  const { getGame, saveGames, canActAsPlayer } = ctx;
  const m = interaction.customId.match(/^heavy_fire_tgt_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = getGame(gameId);
  if (!game?.pendingHeavyFire) return;
  const pending = game.pendingHeavyFire;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.attackerPlayerNum, canActAsPlayer, 'Only the attacker can pick Heavy Fire targets.')) return;
  const available = pending.availableSnapshot || [];
  const target = available[parseInt(idxStr, 10)];
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
    const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
    if (thread) await thread.send(`**Heavy Fire** — **${pending.attackerDcName}** is immune to conditions; **${condition}** not applied.`).catch(discordCatch);
    await logGameAction(game, client, `**Heavy Fire** — **${pending.attackerDcName}** is immune to conditions; **${condition}** not applied.`, { phase: 'ROUND', icon: 'card' });
  } else {
    applyCondition(game, attackerFk, condition);
    const thread = await client.channels.fetch(pending.combatThreadId).catch(() => null);
    if (thread) await thread.send(`**Heavy Fire** — **${pending.attackerDcName}** gains **${condition}** (opponent's choice).`).catch(discordCatch);
    await logGameAction(game, client, `**Heavy Fire** — **${pending.attackerDcName}** gains **${condition}** (opponent's choice).`, { phase: 'ROUND', icon: 'card' });
  }

  pending.conditionsApplied++;
  await advanceHeavyFireConditionPick(game, pending, ctx);
}
