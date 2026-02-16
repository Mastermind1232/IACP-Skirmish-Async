/**
 * Combat handlers: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** F10: Send "Ready to resolve rolls" confirmation step in combat thread; caller should return after. */
async function sendReadyToResolveRolls(thread, gameId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_resolve_ready_${gameId}`)
      .setLabel('Ready to resolve rolls')
      .setStyle(ButtonStyle.Success)
  );
  await thread.send({
    content: '**Confirm** — When both players have seen the rolls (and any surge), click **Ready to resolve rolls** to apply damage.',
    components: [row],
  });
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, dcMessageMeta, getDcStats, getDcEffects, updateDcActionsMessage, ACTION_ICONS, ThreadAutoArchiveDuration, resolveCombatAfterRolls, saveGames, client
 */
export async function handleAttackTarget(interaction, ctx) {
  const {
    getGame,
    replyIfGameEnded,
    dcMessageMeta,
    getDcStats,
    getDcEffects,
    updateDcActionsMessage,
    ACTION_ICONS,
    ThreadAutoArchiveDuration,
    saveGames,
    client,
  } = ctx;
  const m = interaction.customId.match(/^attack_target_(.+)_(\d+)_(\d+)$/);
  if (!m) {
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch(() => {});
    return;
  }
  const [, msgId, figureIndexStr, targetIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const targetIndex = parseInt(targetIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch(() => {});
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
  const target = targets?.[targetIndex];
  if (!target) {
    await interaction.reply({ content: 'Target no longer valid.', ephemeral: true }).catch(() => {});
    return;
  }
  const attackerPlayerNum = meta.playerNum;
  const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the owner can attack.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate();
  delete game.attackTargets[`${msgId}_${figureIndex}`];
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    actionsData.remaining = Math.max(0, actionsData.remaining - 1);
    await updateDcActionsMessage(game, msgId, interaction.client);
  }

  const attackerStats = getDcStats(meta.dcName);
  const attackInfo = attackerStats.attack || { dice: ['red'], range: [1, 3] };
  const targetDcName = target.figureKey.replace(/-\d+-\d+$/, '');
  const targetStats = getDcStats(targetDcName);
  const targetEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName.replace(/\s*\[.*\]\s*$/, '')];
  const attackerDisplayName = meta.displayName || meta.dcName;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const combatDeclare = `**P${attackerPlayerNum}:** "${attackerDisplayName}" is attacking **P${defenderPlayerNum}:** "${target.label}"!`;

  const generalChannel = await client.channels.fetch(game.generalId);
  const declareMsg = await generalChannel.send({
    content: `${ACTION_ICONS.attack || '⚔️'} <t:${Math.floor(Date.now() / 1000)}:t> — ${combatDeclare}`,
    allowedMentions: { users: [game.player1Id, game.player2Id] },
  });
  if (target && target.hasLOS === false) {
    await generalChannel.send({
      content: '⚠️ *The bot thinks you do not have line of sight to this target. If that\'s wrong, ignore this and continue.*',
    }).catch(() => {});
  }
  const thread = await declareMsg.startThread({
    name: `Combat: P${attackerPlayerNum} vs P${defenderPlayerNum}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
  });
  const readyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_ready_${game.gameId}`)
      .setLabel('Ready to roll combat dice')
      .setStyle(ButtonStyle.Secondary)
  );
  const preCombatMsg = await thread.send({
    content: '**Pre-combat window** — Both players: resolve any Command Cards, add/remove dice, apply/block damage, etc. When ready, click **Ready to roll combat dice** below.',
    components: [readyRow],
  });
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum,
    attackerMsgId: msgId,
    attackerDcName: meta.dcName,
    attackerDisplayName,
    attackerFigureIndex: figureIndex,
    target: { ...target },
    targetStats: {
      defense: targetStats.defense || 'white',
      cost: targetStats.cost ?? 5,
      subCost: targetEff?.subCost,
      figures: targetStats.figures ?? 1,
    },
    attackInfo,
    combatThreadId: thread.id,
    combatDeclareMsgId: declareMsg.id,
    combatPreMsgId: preCombatMsg.id,
    p1Ready: false,
    p2Ready: false,
    attackRoll: null,
    defenseRoll: null,
    attackTargetMsgId: interaction.message.id,
  };

  await interaction.message.edit({
    content: `**Combat declared** — See thread in Game Log.`,
    components: [],
  }).catch(() => {});
  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client
 */
export async function handleCombatReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const gameId = interaction.customId.replace('combat_ready_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch(() => {});
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.reply({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch(() => {});
    return;
  }
  const playerNum = clickerIsP1 ? 1 : 2;
  if (playerNum === 1) combat.p1Ready = true;
  else combat.p2Ready = true;
  await interaction.deferUpdate();
  await interaction.message.channel.send(`**Player ${playerNum}** has indicated they are ready to roll combat.`);
  if (!combat.p1Ready || !combat.p2Ready) {
    saveGames();
    return;
  }
  const combatRound = game.currentRound ?? 1;
  const combatEmbed = new EmbedBuilder()
    .setTitle(`COMBAT: ROUND ${combatRound}`)
    .setColor(0xe67e22)
    .setDescription(`Attacker rolls offense, Defender rolls defense.`);
  const rollRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_roll_${gameId}`)
      .setLabel('Roll Combat Dice')
      .setStyle(ButtonStyle.Danger)
  );
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  const rollMsgSent = await thread.send({
    embeds: [combatEmbed],
    components: [rollRow],
  });
  combat.rollMessageId = rollMsgSent.id;
  try {
    const preMsg = await thread.messages.fetch(combat.combatPreMsgId);
    await preMsg.edit({ components: [] }).catch(() => {});
  } catch {}
  saveGames();
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
  const gameId = interaction.customId.replace('combat_roll_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch(() => {});
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.reply({ content: 'Only players in this game can roll.', ephemeral: true }).catch(() => {});
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  if (!combat.attackRoll) {
    if (!clickerIsP1 && attackerPlayerNum === 1) {
      await interaction.reply({ content: 'Only the attacker (P1) may roll attack dice.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!clickerIsP2 && attackerPlayerNum === 2) {
      await interaction.reply({ content: 'Only the attacker (P2) may roll attack dice.', ephemeral: true }).catch(() => {});
      return;
    }
    combat.attackRoll = rollAttackDice(combat.attackInfo.dice);
    await interaction.deferUpdate();
    await thread.send(`**Attack roll** — ${combat.attackRoll.acc} accuracy, ${combat.attackRoll.dmg} damage, ${combat.attackRoll.surge} surge`);
    saveGames();
    return;
  }

  if (!combat.defenseRoll) {
    if (!clickerIsP1 && defenderPlayerNum === 1) {
      await interaction.reply({ content: 'Only the defender (P1) may roll defense dice.', ephemeral: true }).catch(() => {});
      return;
    }
    if (!clickerIsP2 && defenderPlayerNum === 2) {
      await interaction.reply({ content: 'Only the defender (P2) may roll defense dice.', ephemeral: true }).catch(() => {});
      return;
    }
    combat.defenseRoll = rollDefenseDice(combat.targetStats.defense);
    await interaction.deferUpdate();
    await thread.send(`**Defense roll** — ${combat.defenseRoll.block} block, ${combat.defenseRoll.evade} evade`);
    const roll = combat.attackRoll;
    const defRoll = combat.defenseRoll;
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const getAbility = ctx.getAbility || (() => null);
    const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS && ctx.SURGE_LABELS[id]) || id);
    const remaining = roll.surge;
    const affordable = surgeAbilities.filter((key) => (getAbility(key)?.surgeCost ?? 1) <= remaining);
    const hasSurgeStep = roll.surge > 0 && affordable.length > 0;
    if (hasSurgeStep) {
      combat.surgeRemaining = roll.surge;
      combat.surgeDamage = 0;
      combat.surgePierce = 0;
      combat.surgeAccuracy = 0;
      combat.surgeConditions = [];
      const surgeRows = [];
      for (let i = 0; i < surgeAbilities.length; i++) {
        const key = surgeAbilities[i];
        const cost = getAbility(key)?.surgeCost ?? 1;
        if (cost > remaining) continue;
        const label = (getSurgeLabel(key) || key).slice(0, 80);
        const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
        surgeRows.push(
          new ButtonBuilder()
            .setCustomId(`combat_surge_${game.gameId}_${i}`)
            .setLabel(btnLabel.slice(0, 80))
            .setStyle(ButtonStyle.Secondary)
        );
      }
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${game.gameId}_done`)
          .setLabel('Done (no more surge)')
          .setStyle(ButtonStyle.Primary)
      );
      const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
      await thread.send({
        content: `**Spend surge?** You have **${roll.surge}** surge. Choose an ability or Done.`,
        components: [surgeRow],
      });
      saveGames();
      return;
    }
    await sendReadyToResolveRolls(thread, game.gameId);
    saveGames();
    return;
  }
  saveGames();
}

/**
 * F10: Confirm rolls then resolve. Call resolveCombatAfterRolls when user clicks "Ready to resolve rolls".
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client
 */
export async function handleCombatResolveReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client } = ctx;
  const gameId = interaction.customId.replace('combat_resolve_ready_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat to resolve.', ephemeral: true }).catch(() => {});
    return;
  }
  const isP1 = interaction.user.id === game.player1Id;
  const isP2 = interaction.user.id === game.player2Id;
  if (!isP1 && !isP2) {
    await interaction.reply({ content: 'Only players in this game can confirm.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  await resolveCombatAfterRolls(game, combat, client);
  saveGames();
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
  const match = interaction.customId.match(/^combat_surge_([^_]+)_(done|\d+)$/);
  if (!match) return;
  const [, gameId, choice] = match;
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.surgeRemaining) {
    await interaction.reply({ content: 'No surge step or already resolved.', ephemeral: true }).catch(() => {});
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const ownerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: 'Only the attacker may spend surge.', ephemeral: true }).catch(() => {});
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  if (choice !== 'done') {
    const idx = parseInt(choice, 10);
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const key = surgeAbilities[idx];
    if (key) {
      const cost = getAbility(key)?.surgeCost ?? 1;
      const mod = resolveSurge(key);
      combat.surgeDamage = (combat.surgeDamage || 0) + (mod.damage ?? 0);
      combat.surgePierce = (combat.surgePierce || 0) + (mod.pierce ?? 0);
      combat.surgeAccuracy = (combat.surgeAccuracy || 0) + (mod.accuracy ?? 0);
      if (mod.conditions?.length) combat.surgeConditions = (combat.surgeConditions || []).concat(mod.conditions);
      combat.surgeBlast = (combat.surgeBlast || 0) + (mod.blast ?? 0);
      combat.surgeRecover = (combat.surgeRecover || 0) + (mod.recover ?? 0);
      combat.surgeCleave = (combat.surgeCleave || 0) + (mod.cleave ?? 0);
      combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - cost);
      const label = getSurgeLabel(key);
      await thread.send(`**Surge spent (${cost}):** ${label}`).catch(() => {});
    }
  }
  if (combat.surgeRemaining <= 0 || choice === 'done') {
    combat.surgeRemaining = 0;
    await interaction.deferUpdate().catch(() => {});
    await sendReadyToResolveRolls(thread, gameId);
  } else {
    await interaction.deferUpdate().catch(() => {});
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const remaining = combat.surgeRemaining || 0;
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = getAbility(key)?.surgeCost ?? 1;
      if (cost > remaining) continue;
      const label = (getSurgeLabel(key) || key).slice(0, 80);
      const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${gameId}_${i}`)
          .setLabel(btnLabel.slice(0, 80))
          .setStyle(ButtonStyle.Secondary)
      );
    }
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
  saveGames();
}

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
    saveGames,
    client,
  } = ctx;
  const match = interaction.customId.match(/^cleave_target_([^_]+)_(\d+)$/);
  if (!match) return;
  const [, gameId, indexStr] = match;
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingCleave;
  if (!pending || pending.gameId !== gameId) {
    await interaction.reply({ content: 'No cleave target selection in progress.', ephemeral: true }).catch(() => {});
    return;
  }
  if (interaction.user.id !== pending.ownerId) {
    await interaction.reply({ content: 'Only the attacker may choose the cleave target.', ephemeral: true }).catch(() => {});
    return;
  }
  const targetIndex = parseInt(indexStr, 10);
  const target = pending.targets[targetIndex];
  if (!target) {
    await interaction.reply({ content: 'Invalid target.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  const { figureKey: cleaveFigureKey, playerNum: cleavePlayerNum } = target;
  const attackerPlayerNum = pending.attackerPlayerNum;
  const ownerId = pending.ownerId;
  const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
  const cleaveMsgId = findDcMessageIdForFigure(game.gameId, cleavePlayerNum, cleaveFigureKey);
  if (cleaveMsgId) {
    const cleaveM = cleaveFigureKey.match(/-(\d+)-(\d+)$/);
    const cleaveFigIndex = cleaveM ? parseInt(cleaveM[2], 10) : 0;
    const cleaveHS = dcHealthState.get(cleaveMsgId) || [];
    const cleaveEntry = cleaveHS[cleaveFigIndex];
    if (cleaveEntry) {
      const [cCur, cMax] = cleaveEntry;
      const cleaveDmg = pending.surgeCleave || 0;
      const newCCur = Math.max(0, (cCur ?? cMax) - cleaveDmg);
      cleaveHS[cleaveFigIndex] = [newCCur, cMax ?? newCCur];
      dcHealthState.set(cleaveMsgId, cleaveHS);
      const cleaveDcIds = cleavePlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const cleaveDcList = cleavePlayerNum === 1 ? game.p1DcList : game.p2DcList;
      const cleaveIdx = (cleaveDcIds || []).indexOf(cleaveMsgId);
      if (cleaveIdx >= 0 && cleaveDcList?.[cleaveIdx]) cleaveDcList[cleaveIdx].healthState = [...cleaveHS];
      const cleaveLabel = target.label || cleaveDcList?.[cleaveIdx]?.displayName || cleaveFigureKey;
      await logGameAction(game, client, `Cleave: <@${ownerId}> dealt **${pending.surgeCleave}** damage to **${cleaveLabel}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      if (newCCur <= 0) {
        if (game.figurePositions?.[cleavePlayerNum]) delete game.figurePositions[cleavePlayerNum][cleaveFigureKey];
        const cleaveStats = getDcStats(cleaveDcList[cleaveIdx]?.dcName);
        const cost = cleaveStats?.cost ?? 5;
        const figures = cleaveStats?.figures ?? 1;
        const subCost = getDcEffects()[cleaveDcList[cleaveIdx]?.dcName]?.subCost;
        const vp = (figures > 1 && subCost != null) ? subCost : cost;
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        game[vpKey].kills += vp;
        game[vpKey].total += vp;
        await logGameAction(game, client, `Cleave: <@${ownerId}> defeated **${cleaveLabel}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (cleaveIdx >= 0 && isGroupDefeated(game, cleavePlayerNum, cleaveIdx)) {
          const activatedIndices = cleavePlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
          if (!activatedIndices.includes(cleaveIdx)) {
            if (cleavePlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
            else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
            await updateActivationsMessage(game, cleavePlayerNum, client);
          }
        }
        await checkWinConditions(game, client);
      }
    }
  }
  try {
    await interaction.message.edit({ components: [] }).catch(() => {});
  } catch {}
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (cleaveMsgId) embedRefreshMsgIds.add(cleaveMsgId);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}
