/**
 * Combat handlers: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';

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
    await interaction.reply({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr, targetIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const targetIndex = parseInt(targetIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.reply({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
  const target = targets?.[targetIndex];
  if (!target) {
    await interaction.reply({ content: 'Target no longer valid.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = meta.playerNum;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.reply({ content: 'Only the owner can attack.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (target.hasLOS === false) {
    await interaction.reply({ content: '🚫 No line of sight to that target. You cannot attack through blocking terrain or solid walls.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const nextSurge = game.nextAttackBonusSurgeAbilities?.[attackerPlayerNum] || [];
  const nextPierce = game.nextAttackBonusPierce?.[attackerPlayerNum] || 0;
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const isRanged = minRange >= 2 || maxRange >= 3;
  const distanceToTarget = target.dist ?? 1;
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum,
    defenderPlayerNum: attackerPlayerNum === 1 ? 2 : 1,
    attackerMsgId: msgId,
    attackerDcName: meta.dcName,
    bonusSurgeAbilities: [...nextSurge],
    bonusPierce: nextPierce,
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
    isRanged,
    distanceToTarget,
    combatThreadId: thread.id,
    combatDeclareMsgId: declareMsg.id,
    combatPreMsgId: preCombatMsg.id,
    p1Ready: false,
    p2Ready: false,
    attackRoll: null,
    defenseRoll: null,
    attackTargetMsgId: interaction.message.id,
  };
  if (nextSurge.length) delete game.nextAttackBonusSurgeAbilities?.[attackerPlayerNum];
  if (nextPierce) delete game.nextAttackBonusPierce?.[attackerPlayerNum];
  delete game.lastAttackTargetSpacesForRubble;
  delete game.lastAttackAttackerPlayerNum;

  await interaction.message.edit({
    content: `**Combat declared** — See thread in Game Log.`,
    components: [],
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.reply({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  // In test games, human (P1) can click for both sides; first click = P1, second = P2
  let playerNum = clickerIsP1 ? 1 : 2;
  if (game.isTestGame && clickerIsP1) {
    playerNum = combat.p1Ready ? 2 : 1;
  }
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
    await preMsg.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  const getInnateRerolls = ctx.getInnateRerolls || (() => ({ attackReroll: 0, defenseReroll: 0 }));
  const gameId = interaction.customId.replace('combat_roll_', '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.reply({ content: 'Only players in this game can roll.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  if (!combat.attackRoll) {
    if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
      await interaction.reply({ content: `Only the attacker (P${attackerPlayerNum}) may roll attack dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
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
    await interaction.deferUpdate();
    const diceDetail = result.dice.map((d, i) => `${d.color}(${d.acc}a/${d.dmg}d/${d.surge}s)`).join(', ');
    await thread.send(`**Attack roll** — ${result.acc} accuracy, ${result.dmg} damage, ${result.surge} surge  [${diceDetail}]`);
    saveGames();
    return;
  }

  if (!combat.defenseRoll) {
    if (!canActAsPlayer(game, interaction.user.id, defenderPlayerNum)) {
      await interaction.reply({ content: `Only the defender (P${defenderPlayerNum}) may roll defense dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
    const baseColor = combat.targetStats.defense || 'white';
    const bonusDice = combat.defenseBonusDice || [];
    const pool = [baseColor, ...bonusDice];
    const removeMax = combat.defensePoolRemoveAll ? pool.length : (combat.defensePoolRemoveMax || 0);
    const removeCount = Math.min(removeMax, pool.length);
    const diceToRoll = pool.slice(0, pool.length - removeCount);
    const defDiceResults = [];
    let block = 0, evade = 0, dodge = false;
    for (const color of diceToRoll) {
      const r = rollDefenseDice(color);
      defDiceResults.push(r);
      block += r.block;
      evade += r.evade;
      if (r.dodge) dodge = true;
    }
    combat.defenseRoll = { block, evade, dodge };
    combat.defenseDiceResults = defDiceResults;
    combat.defenseDiceCount = diceToRoll.length;
    await interaction.deferUpdate();
    const diceDetail = defDiceResults.map((d) => `${d.color}(${d.block}b/${d.evade}e${d.dodge ? '/dodge' : ''})`).join(', ');
    const dodgeText = dodge ? ' **DODGE!**' : '';
    await thread.send(`**Defense roll** — ${block} block, ${evade} evade${dodgeText}  [${diceDetail}]`);

    // --- Enter reroll window ---
    const atkInnate = getInnateRerolls(combat.attackerDcName);
    const defenderDcName = combat.target?.figureKey?.replace(/-\d+-\d+$/, '') || '';
    const defInnate = getInnateRerolls(defenderDcName);
    const atkRerolls = (combat.rerollOneAttackDie || 0) + (game.roundAttackRerollDice?.[attackerPlayerNum] || 0) + atkInnate.attackReroll;
    const defRerolls = (combat.defenderRerollDiceMax || 0) + defInnate.defenseReroll;
    if (atkRerolls > 0 || defRerolls > 0) {
      combat.rerollPhase = 'attacker';
      combat.attackerRerollsRemaining = atkRerolls;
      combat.defenderRerollsRemaining = defRerolls;
      await sendRerollUI(thread, game, combat, 'attacker');
      saveGames();
      return;
    }
    // No rerolls available — proceed directly
    await proceedAfterRerolls(thread, game, combat, ctx);
    saveGames();
    return;
  }
  saveGames();
}

/** Chunk buttons into ActionRows of up to 5 (Discord limit). Max 5 rows = 25 buttons. */
function buildActionRows(buttons) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows.slice(0, 5);
}

/** Format individual dice for display in reroll UI */
function formatAttackDie(d, i) {
  return `${d.color} #${i + 1}: ${d.acc}acc/${d.dmg}dmg/${d.surge}surge`;
}
function formatDefenseDie(d, i) {
  return `${d.color} #${i + 1}: ${d.block}blk/${d.evade}evd${d.dodge ? '/DODGE' : ''}`;
}

/** Show reroll UI for the current phase (attacker or defender) */
async function sendRerollUI(thread, game, combat, phase) {
  const gameId = game.gameId;
  if (phase === 'attacker') {
    const remaining = combat.attackerRerollsRemaining || 0;
    if (remaining <= 0) {
      combat.rerollPhase = 'defender';
      if ((combat.defenderRerollsRemaining || 0) > 0) {
        await sendRerollUI(thread, game, combat, 'defender');
        return;
      }
      combat.rerollPhase = null;
      return;
    }
    const dice = combat.attackDiceResults || [];
    const buttons = [];
    for (let i = 0; i < dice.length; i++) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_atk_${i}`)
          .setLabel(`Reroll ${formatAttackDie(dice[i], i)}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_atk_done`)
        .setLabel('Done (no rerolls)')
        .setStyle(ButtonStyle.Primary)
    );
    const actionRows = buildActionRows(buttons);
    await thread.send({
      content: `**Reroll Window (Attacker)** — ${remaining} reroll${remaining > 1 ? 's' : ''} available. Choose an attack die to reroll, or Done.`,
      components: actionRows,
    });
  } else {
    const remaining = combat.defenderRerollsRemaining || 0;
    if (remaining <= 0) {
      combat.rerollPhase = null;
      return;
    }
    const dice = combat.defenseDiceResults || [];
    const buttons = [];
    for (let i = 0; i < dice.length; i++) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`combat_reroll_${gameId}_def_${i}`)
          .setLabel(`Reroll ${formatDefenseDie(dice[i], i)}`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_def_done`)
        .setLabel('Done (no rerolls)')
        .setStyle(ButtonStyle.Primary)
    );
    const actionRows = buildActionRows(buttons);
    await thread.send({
      content: `**Reroll Window (Defender)** — ${remaining} reroll${remaining > 1 ? 's' : ''} available. Choose a defense die to reroll, or Done.`,
      components: actionRows,
    });
  }
}

/**
 * Handle reroll button clicks (combat_reroll_{gameId}_{atk|def}_{index|done})
 */
export async function handleCombatReroll(interaction, ctx) {
  const { getGame, replyIfGameEnded, rollSingleAttackDie, rollSingleDefenseDie, recalcAttackTotals, recalcDefenseTotals, saveGames } = ctx;
  const match = interaction.customId.match(/^combat_reroll_([^_]+)_(atk|def)_(done|\d+)$/);
  if (!match) return;
  const [, gameId, side, choice] = match;
  const game = getGame(gameId);
  if (!game) { await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.rerollPhase) {
    await interaction.reply({ content: 'No reroll phase active.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const expectedPhase = side === 'atk' ? 'attacker' : 'defender';
  if (combat.rerollPhase !== expectedPhase) {
    await interaction.reply({ content: `It's the ${combat.rerollPhase}'s turn to reroll.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const expectedPlayer = side === 'atk' ? attackerPlayerNum : defenderPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, expectedPlayer)) {
    await interaction.reply({ content: `Only P${expectedPlayer} can reroll ${side === 'atk' ? 'attack' : 'defense'} dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });

  if (choice !== 'done') {
    const idx = parseInt(choice, 10);
    if (side === 'atk') {
      const dice = combat.attackDiceResults || [];
      if (idx >= 0 && idx < dice.length && combat.attackerRerollsRemaining > 0) {
        const oldDie = dice[idx];
        const newDie = rollSingleAttackDie(oldDie.color);
        dice[idx] = newDie;
        combat.attackDiceResults = dice;
        const totals = recalcAttackTotals(dice);
        combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
        combat.attackerRerollsRemaining -= 1;
        await thread.send(`**Rerolled** attack ${oldDie.color} #${idx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`);
      }
    } else {
      const dice = combat.defenseDiceResults || [];
      if (idx >= 0 && idx < dice.length && combat.defenderRerollsRemaining > 0) {
        const oldDie = dice[idx];
        const newDie = rollSingleDefenseDie(oldDie.color);
        dice[idx] = newDie;
        combat.defenseDiceResults = dice;
        const totals = recalcDefenseTotals(dice);
        combat.defenseRoll = { block: totals.block, evade: totals.evade, dodge: totals.dodge };
        combat.defenderRerollsRemaining -= 1;
        const dodgeTag = newDie.dodge ? '/DODGE' : '';
        await thread.send(`**Rerolled** defense ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
      }
    }
  }

  // Check if current side is done (clicked done or exhausted rerolls)
  if (side === 'atk' && (choice === 'done' || combat.attackerRerollsRemaining <= 0)) {
    combat.rerollPhase = 'defender';
    if ((combat.defenderRerollsRemaining || 0) > 0) {
      await sendRerollUI(thread, game, combat, 'defender');
      saveGames();
      return;
    }
    combat.rerollPhase = null;
    await proceedAfterRerolls(thread, game, combat, ctx);
    saveGames();
    return;
  }
  if (side === 'def' && (choice === 'done' || combat.defenderRerollsRemaining <= 0)) {
    combat.rerollPhase = null;
    await proceedAfterRerolls(thread, game, combat, ctx);
    saveGames();
    return;
  }

  // Still has rerolls — show updated UI
  await sendRerollUI(thread, game, combat, combat.rerollPhase);
  saveGames();
}

/**
 * After rerolls are complete: check dodge, evade cancellation, surge spending, or ready-to-resolve.
 * This is the continuation of the defense roll path.
 */
async function proceedAfterRerolls(thread, game, combat, ctx) {
  const { getAttackerSurgeAbilities, SURGE_LABELS, saveGames } = ctx;
  const getAbility = ctx.getAbility || (() => null);
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (SURGE_LABELS && SURGE_LABELS[id]) || id);
  const defRoll = combat.defenseRoll;

  // Dodge check (now AFTER rerolls, so rerolls can potentially remove dodge)
  if (defRoll.dodge) {
    await thread.send('**DODGE!** The attack misses — all damage and effects negated.');
    await sendReadyToResolveRolls(thread, game.gameId);
    return;
  }

  // Evade cancels surge
  const roll = combat.attackRoll;
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const perDefDieSurge = (combat.bonusSurgePerDefenseDie || 0) * defenseDiceCount;
  const surgeBonus = (combat.surgeBonus || 0) + (game.roundAttackSurgeBonus?.[attackerPlayerNum] || 0) + perDefDieSurge;
  const rawSurge = roll.surge + surgeBonus;
  const roundEvade = game.roundDefenseBonusEvade?.[defPlayerNum] || 0;
  const totalEvade = defRoll.evade + (combat.bonusEvade || 0) + roundEvade;
  const evadeCancelled = Math.min(rawSurge, totalEvade);
  const totalSurge = rawSurge - evadeCancelled;
  combat.evadeCancelledSurge = evadeCancelled;
  if (evadeCancelled > 0) {
    await thread.send(`**Evade cancels surge:** ${evadeCancelled} evade cancelled ${evadeCancelled} surge → **${totalSurge}** surge remaining`);
  }

  // Surge spending
  const surgeAbilities = getAttackerSurgeAbilities(combat);
  const remaining = totalSurge;
  const affordable = surgeAbilities.filter((key) => (getAbility(key)?.surgeCost ?? 1) <= remaining);
  if (totalSurge > 0 && affordable.length > 0) {
    combat.surgeRemaining = totalSurge;
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
    const roundSurge = game.roundAttackSurgeBonus?.[attackerPlayerNum] || 0;
    const ccSurge = (combat.surgeBonus || 0);
    const surgeDisplay = (ccSurge > 0 || roundSurge > 0)
      ? `${roll.surge}${ccSurge ? ` + ${ccSurge} (CC)` : ''}${roundSurge ? ` + ${roundSurge} (round)` : ''} = **${totalSurge}**`
      : `**${totalSurge}**`;
    await thread.send({
      content: `**Spend surge?** You have ${surgeDisplay} surge. Choose an ability or Done.`,
      components: [surgeRow],
    });
    return;
  }
  await sendReadyToResolveRolls(thread, game.gameId);
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.reply({ content: 'No pending combat to resolve.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.reply({ content: 'Only players in this game can confirm.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.surgeRemaining) {
    await interaction.reply({ content: 'No surge step or already resolved.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.reply({ content: 'Only the attacker may spend surge.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
      await thread.send(`**Surge spent (${cost}):** ${label}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  if (combat.surgeRemaining <= 0 || choice === 'done') {
    combat.surgeRemaining = 0;
    await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
    await sendReadyToResolveRolls(thread, gameId);
  } else {
    await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    updateAttachmentMessageForDc,
    saveGames,
    client,
  } = ctx;
  const match = interaction.customId.match(/^cleave_target_([^_]+)_(\d+)$/);
  if (!match) return;
  const [, gameId, indexStr] = match;
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingCleave;
  if (!pending || pending.gameId !== gameId) {
    await interaction.reply({ content: 'No cleave target selection in progress.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== pending.ownerId) {
    await interaction.reply({ content: 'Only the attacker may choose the cleave target.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const targetIndex = parseInt(indexStr, 10);
  const target = pending.targets[targetIndex];
  if (!target) {
    await interaction.reply({ content: 'Invalid target.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate().catch((err) => { console.error('[discord]', err?.message ?? err); });
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
          const cleaveCcAttachKey = cleavePlayerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
          if (game[cleaveCcAttachKey]?.[cleaveMsgId]?.length) {
            delete game[cleaveCcAttachKey][cleaveMsgId];
            if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, cleavePlayerNum, cleaveMsgId, client);
          }
        }
        await checkWinConditions(game, client);
      }
    }
  }
  try {
    await interaction.message.edit({ components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  } catch {}
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (cleaveMsgId) embedRefreshMsgIds.add(cleaveMsgId);
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}
