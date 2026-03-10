/**
 * Combat special-effect handlers extracted from index.js:
 * bleed, sidewinder, boltslinger, indiscriminate fire, fighting knife,
 * concussive bolt, spread the pain, missile salvo.
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { reduceHp, awardKillVp, opponentPlayerNum, parseFigureKey, dcNameFromFigureKey } from '../game/index.js';
import { getPlayAreaId, getPlayerId, getDcList, getDcMessageIds, ccDeckKey, removeFigurePosition } from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requirePlayer } from '../utils/guards.js';

// ── Internal helpers ─────────────────────────────

/** Apply Indiscriminate Fire splash damage/strain to all figures within 2 of target. */
export async function applyIndiscriminateFireSplash(game, attackerPlayerNum, combatThreadId, die, splashTargets, thread, ctx) {
  const {
    client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
    findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getDcUpgradeAttachments, getDcEffects, logGameAction,
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
    }
    try {
      const tMeta = dcMessageMeta.get(mid);
      if (tMeta) {
        const ch = await client.channels.fetch(getPlayAreaId(game, tMeta.playerNum));
        const msg = await ch.messages.fetch(mid);
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(mid) ?? false, tMeta.displayName, dcHealthState.get(mid) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, mid));
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
    getDcUpgradeAttachments, logGameAction, calculateKillVp,
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
            const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, health, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
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
    await logGameAction(game, interaction.client, `\u{1FA78} **Bleeding** — **${dcName}** prevented 1 damage (discarded **${discardedCard}** from deck top).`, { phase: 'ROUND', icon: 'card' });
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
    getDcUpgradeAttachments, logGameAction, ensureMovementBankMessage,
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
    const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, dcExhaustedState.get(attackerMsgId) ?? false, meta.displayName, dcHealthState.get(attackerMsgId) || [], getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, attackerMsgId));
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
    getDcUpgradeAttachments, logGameAction, findDcMessageIdForFigure,
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
        const { embed, files } = await buildDcEmbedAndFiles(tMeta.dcName, dcExhaustedState.get(targetMsgId) ?? false, tMeta.displayName, dcHealthState.get(targetMsgId) || [], getConditionsForDcMessage(game, tMeta), getDcUpgradeAttachments(game, targetMsgId));
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
    getDcUpgradeAttachments, logGameAction, findDcMessageIdForFigure,
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
    embedRefreshMsgIds.add(target.msgId);
    if (fkDefeated) {
      removeFigurePosition(game, target.playerNum, target.figureKey);
      const dcName = dcNameFromFigureKey(target.figureKey);
      const vp = calculateKillVp(dcName);
      awardKillVp(game, pending.attackerPlayerNum, vp);
      await logGameAction(game, client, `**Fighting Knife** — **${target.label}** was defeated! +${vp} VP`, { phase: 'ROUND', icon: 'attack' });
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
  const { getGame, saveGames, canActAsPlayer } = ctx;
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
  saveGames();
}
