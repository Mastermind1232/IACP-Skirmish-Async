/**
 * Combat handlers: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getMapSpaces } from '../data-loader.js';

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
 * Apply direct unpreventable strain/damage to a figure (Relentless, etc.).
 * Handles defeat, VP, activations update.
 */
async function applyStrainToFigure(game, playerNum, figureKey, amount, abilityLabel, sourceLabel, ctx, thread) {
  const {
    dcHealthState, findDcMessageIdForFigure, logGameAction, isGroupDefeated, checkWinConditions,
    updateActivationsMessage, updateAttachmentMessageForDc, getDcStats, getDcEffects, client,
  } = ctx;
  if (!dcHealthState || !findDcMessageIdForFigure) return;
  const msgId = findDcMessageIdForFigure(game.gameId, playerNum, figureKey);
  if (!msgId) return;
  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const healthState = dcHealthState.get(msgId) || [];
  const entry = healthState[figureIndex];
  if (!entry) return;
  const [cur, max] = entry;
  const newCur = Math.max(0, (cur ?? max) - amount);
  healthState[figureIndex] = [newCur, max ?? newCur];
  dcHealthState.set(msgId, healthState);
  const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
  const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
  const idx = (dcIds || []).indexOf(msgId);
  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
  await thread.send(`**${abilityLabel}** (${sourceLabel}) — **${dcName}** suffers 1 Strain (${cur ?? max} → ${newCur} HP).`);
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** suffered 1 Strain.`, { phase: 'ROUND', icon: 'attack' });
  }
  if (newCur <= 0) {
    const attackerPlayerNum = playerNum === 1 ? 2 : 1;
    if (game.figurePositions?.[playerNum]) delete game.figurePositions[playerNum][figureKey];
    const stats = getDcStats?.(dcName);
    const effects = getDcEffects?.()?.[dcName];
    const figures = stats?.figures ?? 1;
    const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
    const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].kills += vp;
    game[vpKey].total += vp;
    if (logGameAction) {
      await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** was defeated! +${vp} VP`, { phase: 'ROUND', icon: 'attack' });
    }
    if (idx >= 0 && isGroupDefeated?.(game, playerNum, idx)) {
      const activatedIndices = playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
      if (!activatedIndices.includes(idx)) {
        if (playerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
        else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
        if (updateActivationsMessage) await updateActivationsMessage(game, playerNum, client);
      }
      const ccAttachKey = playerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
      if (game[ccAttachKey]?.[msgId]?.length) {
        delete game[ccAttachKey][msgId];
        if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, playerNum, msgId, client);
      }
    }
    await checkWinConditions?.(game, client);
  }
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const [, msgId, figureIndexStr, targetIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const targetIndex = parseInt(targetIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const game = getGame(meta.gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
  const target = targets?.[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = meta.playerNum;
  const { getRange, hasLineOfSight } = ctx;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the owner can attack.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (target.hasLOS === false) {
    await interaction.followUp({ content: '🚫 No line of sight to that target. You cannot attack through blocking terrain or solid walls.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  // Etiquette and Protocol: block attacks between paired figures this round
  const etiqPairs = game.etiquetteBlockPairs || [];
  if (etiqPairs.length && target.figureKey) {
    const dgIdx = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
    const atkFkCheck = `${meta.dcName}-${dgIdx}-${figureIndex}`;
    const tgtFkCheck = target.figureKey;
    const blocked = etiqPairs.some(([a, b]) => (a === atkFkCheck && b === tgtFkCheck) || (b === atkFkCheck && a === tgtFkCheck));
    if (blocked) {
      await interaction.followUp({ content: '🚫 **Etiquette and Protocol**: these two figures cannot attack each other this round.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
      return;
    }
  }
  // Ballistics Matrix: clear per-attack flag after this attack proceeds
  if (game.nextAttackIgnoreFigureLOS?.[attackerPlayerNum]) delete game.nextAttackIgnoreFigureLOS[attackerPlayerNum];
  delete game.attackTargets[`${msgId}_${figureIndex}`];
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    const pendingBL = game.pendingBattlefieldLeadership;
    const isBLFreeAttack = pendingBL?.forMsgId === msgId;
    if (isBLFreeAttack) {
      delete game.pendingBattlefieldLeadership;
    } else {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }
  }

  const attackerStats = getDcStats(meta.dcName);
  let attackInfo = attackerStats.attack || { dice: ['red'], range: [1, 3] };

  // pendingOverrideAttackDice (Saber Strike, Bo-Rifle Staff Strike, Definition: 'Love'): replace dice/type/pierce for this attack
  const overrideDice = game.pendingOverrideAttackDice?.[msgId];
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
    delete game.pendingOverrideAttackDice[msgId];
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
    targetDcName = target.figureKey.replace(/-\d+-\d+$/, '');
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
  // Focus: attacker gains 1 green die on their next attack; consumed after attacking
  if (attackerConds.includes('Focus')) {
    attackInfo = { ...attackInfo, dice: [...(attackInfo.dice || []), 'green'] };
  }
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
  const nextPierce = (game.nextAttackBonusPierce?.[attackerPlayerNum] || 0) + (overrideDice?.pierce || 0);
  const nextBonusAcc = (game.nextAttackBonusAccuracy?.[attackerPlayerNum] || 0) + (overrideDice?.bonusAccuracy || 0);
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const isRanged = minRange >= 2 || maxRange >= 3;
  const distanceToTarget = target.dist ?? 1;
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum,
    defenderPlayerNum: attackerPlayerNum === 1 ? 2 : 1,
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
      defense: target.isNpc ? (targetStats.defense || null) : (targetStats.defense || 'white'),
      cost: target.isNpc ? 2 : (targetStats.cost ?? 5), // NPC kill = 2 VP
      subCost: target.isNpc ? null : targetEff?.subCost,
      figures: 1,
    },
    bonusBlock: npcDefenseBonus || undefined, // Krykna: 2 fixed blocks
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
  // Apply printed passive stat bonuses from attacker only (NPC has no passives)
  const attackerPassives = getDcStats(meta.dcName).passives || [];
  const defenderPassives = target.isNpc ? [] : (getDcStats(targetDcName).passives || []);
  applyDcPassivesToCombat(game.pendingCombat, attackerPassives, defenderPassives);

  // Payback (Dengar CC reaction): if attacker has a pending Payback surge bonus, apply it now
  const paybackBonus = game.paybackBonusSurge?.[msgId];
  if (paybackBonus) {
    game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + paybackBonus;
    delete game.paybackBonusSurge[msgId];
    await thread.send(`**Payback** — +${paybackBonus} Surge applied to this counter-attack.`).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await thread.send('⚠️ **No Cheating** is active — 1 attack die removed.').catch((err) => { console.error('[discord]', err?.message ?? err); });
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
  if (atkSpecialIds.includes('battle_meditation') && !game.pendingCombat.attackerConds.includes('Focus') &&
      !(game.figureConditions?.[attackerFigureKey] || []).includes('Focus')) {
    game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
    if (!game.figureConditions) game.figureConditions = {};
    game.figureConditions[attackerFigureKey] = [...(game.figureConditions[attackerFigureKey] || []).filter(c => c !== 'Focus'), 'Focus'];
    const bm_label = meta.dcName === 'BT-1' ? 'Assassin' : 'Battle Meditation';
    await thread.send(`**${bm_label}** — **${meta.dcName}** is **Focused** before attacking (+1 green die).`);
  }

  // Full of Rage (Krrsantan): auto-Focus if 3+ damage suffered
  if (atkSpecialIds.includes('full_of_rage') && !game.pendingCombat.attackerConds.includes('Focus') &&
      !(game.figureConditions?.[attackerFigureKey] || []).includes('Focus') && atkDamageSuffered >= 3) {
    game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
    if (!game.figureConditions) game.figureConditions = {};
    game.figureConditions[attackerFigureKey] = [...(game.figureConditions[attackerFigureKey] || []).filter(c => c !== 'Focus'), 'Focus'];
    await thread.send(`**Full of Rage** — Krrsantan is **Focused** before attacking (${atkDamageSuffered} damage suffered, +1 green die).`);
  }

  // Fury (Wookiee Warriors): +1 Surge if 5+ damage
  const furyIds = ['fury_wookiee_elite', 'fury_wookiee_reg'];
  if (atkSpecialIds.some(id => furyIds.includes(id)) && atkDamageSuffered >= 5) {
    game.pendingCombat.furyBonus = 1;
    await thread.send(`**Fury** — Wookiee Warrior is **Furious** (+1 Surge, having suffered ${atkDamageSuffered} damage).`);
  }

  // Cunning (Han Solo, Jyn Odan, Nexu): while defending, +1 Block per Evade result
  const cunningIds = ['cunning_han', 'cunning_jyn', 'cunning_nexu_elite', 'cunning_nexu_reg'];
  if (defSpecialIds.some(id => cunningIds.includes(id))) {
    game.pendingCombat.hasCunning = true;
  }

  // Distracting (Han Solo, C-3PO): if this figure is adjacent to the targeted space, +1 Evade for defender
  // "Friendly figure defending" — check if any friendly figure with distracting is adjacent to target.coord
  const distractingIds = ['distracting_han', 'distracting_c3po'];
  const mapSpaces = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
  const targetCoord = target.coord ? String(target.coord).toLowerCase() : null;
  if (mapSpaces && targetCoord) {
    const adjToTarget = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    adjToTarget.add(targetCoord); // figure in same space also counts
    const defenderFigPositions = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(defenderFigPositions)) {
      const fkDcName = fk.replace(/-\d+-\d+$/, '');
      const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      if (!(fkEff?.specialAbilityIds || []).some(id => distractingIds.includes(id))) continue;
      if (!adjToTarget.has(String(pos).toLowerCase())) continue;
      game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + 1;
      await thread.send(`**Distracting** (${fkDcName}) — adjacent to target, +1 Evade for defender.`);
      break; // only one Distracting bonus
    }
  }

  // Hunker Down (Cara Dune): if defender shares edge/corner with blocking/impassable/difficult terrain, +1 Evade
  if (defSpecialIds.includes('hunker_down') && mapSpaces && targetCoord) {
    const adjToDefender = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    const terrain = mapSpaces.terrain || {};
    const hunkerTerrain = ['blocking', 'impassable', 'difficult'];
    const hasNearbyTerrain = [...adjToDefender].some(s => hunkerTerrain.includes((terrain[s] || 'normal').toLowerCase()));
    if (hasNearbyTerrain) {
      game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + 1;
      await thread.send('**Hunker Down** — Cara Dune is adjacent to terrain, +1 Evade.');
    }
  }

  // Relentless (Trandoshan Hunter, IG-88, Fifth Brother): 1 Strain to target within 3
  const relentlessIds = ['relentless_trandoshan_elite', 'relentless_trandoshan_reg', 'relentless_ig88', 'fifth_brother_relentless'];
  if (atkSpecialIds.some(id => relentlessIds.includes(id)) && distanceToTarget <= 3) {
    await applyStrainToFigure(game, defenderPlayerNum, target.figureKey, 1, 'Relentless', meta.dcName, ctx, thread);
  }

  // Flawless Execution (Cad Bane): become Focused; if already Focused → Wild token + yellow die
  if (atkSpecialIds.includes('flawless_execution')) {
    if (!attackerConds.includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      if (!game.figureConditions) game.figureConditions = {};
      game.figureConditions[attackerFigureKey] = [...(game.figureConditions[attackerFigureKey] || []).filter(c => c !== 'Focus'), 'Focus'];
      await thread.send('**Flawless Execution** — Cad Bane is **Focused** before attacking (+1 green die).');
    } else {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'yellow'] };
      game.pendingPowerTokenGrant = { grants: [{ figureKey: attackerFigureKey, figName: meta.dcName, count: 1 }], channelId: thread.id, playerNum: attackerPlayerNum };
      await thread.send('**Flawless Execution** — Cad Bane was already Focused: +1 yellow die. Choose a power token type:');
      await sendPowerTokenChoicePrompt(thread, gameId, game.pendingPowerTokenGrant.grants);
    }
  }

  // Shock and Awe (Cara Dune): once per round, replace 1 Yellow die with Red
  if (atkSpecialIds.includes('shock_and_awe')) {
    const sawKey = attackerFigureKey + '_shock_and_awe';
    if (!game.roundFigureAbilityUsed?.[sawKey]) {
      const dice = game.pendingCombat.attackInfo.dice || [];
      const yellIdx = dice.findIndex(d => d === 'yellow');
      if (yellIdx >= 0) {
        const newDice = [...dice];
        newDice[yellIdx] = 'red';
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: newDice };
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[sawKey] = true;
        await thread.send('**Shock and Awe** — 1 Yellow die replaced with Red.');
      }
    }
  }

  // Vanguard (AT-RT): within 3 spaces, replace 1 non-red die with Red
  if (atkSpecialIds.includes('vanguard') && distanceToTarget <= 3) {
    const dice = game.pendingCombat.attackInfo.dice || [];
    const nonRedIdx = dice.findIndex(d => d !== 'red');
    if (nonRedIdx >= 0) {
      const newDice = [...dice];
      newDice[nonRedIdx] = 'red';
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: newDice };
      await thread.send(`**Vanguard** — 1 ${dice[nonRedIdx]} die replaced with Red (target within ${distanceToTarget} spaces).`);
    }
  }

  // ACP Scattergun (Trandoshan Hunter Elite) / Scattergun (Trandoshan Hunter Regular): +Hits when adjacent to target
  if (distanceToTarget <= 1) {
    if (atkSpecialIds.includes('acp_scattergun')) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 2;
      await thread.send('**ACP Scattergun** — adjacent to target: +2 Hits.');
    } else if (atkSpecialIds.includes('scattergun')) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
      await thread.send('**Scattergun** — adjacent to target: +1 Hit.');
    }
  }

  // Shared Intuition (Tress Hacnua): +1 Hit while attacking if another friendly HUNTER within 3 has LOS to target
  if (atkSpecialIds.includes('shared_intuition') && getRange && hasLineOfSight && mapSpaces && targetCoord) {
    const attackerPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    if (attackerPos) {
      const friendlyPoses = game.figurePositions?.[attackerPlayerNum] || {};
      let found = false;
      for (const [fk, pos] of Object.entries(friendlyPoses)) {
        if (found || fk === attackerFigureKey) continue;
        const fkDcName = fk.replace(/-\d+-\d+$/, '');
        const fkEff = getDcEffects()[fkDcName] || getDcEffects()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        const fkKeywords = (fkEff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!fkKeywords.includes('HUNTER')) continue;
        if (getRange(attackerPos, pos) > 3) continue;
        if (!hasLineOfSight(pos, targetCoord, mapSpaces, null)) continue;
        game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
        await thread.send(`**Shared Intuition** — ${fkDcName} (HUNTER) is within 3 spaces with LOS to target: +1 Hit.`);
        found = true;
      }
    }
  }

  // Log override dice if active (Saber Strike, Bo-Rifle Staff Strike)
  if (overrideDice?.dice) {
    const diceStr = overrideDice.dice.join(', ');
    const typeStr = overrideDice.type === 'melee' ? ' (Melee)' : '';
    const pierceStr = overrideDice.pierce > 0 ? `, Pierce ${overrideDice.pierce}` : '';
    await thread.send(`**Override dice** — Attack uses [${diceStr}]${typeStr}${pierceStr}.`);
  }

  if (nextSurge.length) delete game.nextAttackBonusSurgeAbilities?.[attackerPlayerNum];
  if (nextPierce) delete game.nextAttackBonusPierce?.[attackerPlayerNum];
  if (nextBonusAcc) delete game.nextAttackBonusAccuracy?.[attackerPlayerNum];
  if (game.nextAttackReach?.[attackerPlayerNum]) delete game.nextAttackReach[attackerPlayerNum];
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
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.followUp({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  // In test games, human (P1) can click for both sides; first click = P1, second = P2
  let playerNum = clickerIsP1 ? 1 : 2;
  if (game.isTestGame && clickerIsP1) {
    playerNum = combat.p1Ready ? 2 : 1;
  }
  if (playerNum === 1) combat.p1Ready = true;
  else combat.p2Ready = true;
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
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can roll.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  const effectiveAttackerPlayerNum = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;

  if (!combat.attackRoll) {
    if (!canActAsPlayer(game, interaction.user.id, effectiveAttackerPlayerNum)) {
      await interaction.followUp({ content: `Only the attacker (P${effectiveAttackerPlayerNum}) may roll attack dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    const diceDetail = result.dice.map((d, i) => `${d.color}(${d.acc}a/${d.dmg}d/${d.surge}s)`).join(', ');
    await thread.send(`**Attack roll** — ${result.acc} accuracy, ${result.dmg} damage, ${result.surge} surge  [${diceDetail}]`);
    saveGames();
    return;
  }

  if (!combat.defenseRoll) {
    if (!canActAsPlayer(game, interaction.user.id, defenderPlayerNum)) {
      await interaction.followUp({ content: `Only the defender (P${defenderPlayerNum}) may roll defense dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    const diceDetail = defDiceResults.map((d) => `${d.color}(${d.block}b/${d.evade}e${d.dodge ? '/dodge' : ''})`).join(', ');
    const dodgeText = dodge ? ' **DODGE!**' : '';
    await thread.send(`**Defense roll** — ${block} block, ${evade} evade${dodgeText}  [${diceDetail}]`);

    // --- Enter reroll window ---
    const atkInnate = getInnateRerolls(combat.attackerDcName);
    const defenderDcName = combat.target?.figureKey?.replace(/-\d+-\d+$/, '') || '';
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
    // Targeting Computer (HK Assassin elite, IG-11, Probe Droid elite, Sentry Droid elite/reg): +1 atk reroll
    const tcIds = ['targeting_computer_hk_elite', 'targeting_computer_ig11', 'targeting_computer_probe_elite', 'targeting_computer_sentry_elite', 'targeting_computer_sentry_reg'];
    if (atkSIds.some(id => tcIds.includes(id))) atkSpecialReroll += 1;
    // Overpower (Royal Guard Champion): +1 atk reroll when attacking, +1 def reroll when defending
    if (atkSIds.includes('overpower')) atkSpecialReroll += 1;
    if (defSIds.includes('overpower')) defSpecialReroll += 1;
    // Foresight (Darth Vader defending): +1 def reroll
    if (defSIds.includes('foresight')) defSpecialReroll += 1;
    // Defensive Stance (Diala Passil defending): +1 def reroll
    if (defSIds.includes('defensive_stance')) defSpecialReroll += 1;
    // Charge Generators (AT-DP attacking): +1 atk reroll + +1 Hit if < 9 damage suffered
    if (atkSIds.includes('charge_generators')) {
      const atkHpA = dcHS?.get(combat.attackerMsgId) || [];
      const atkFHp = atkHpA[combat.attackerFigureIndex ?? 0];
      const atkDs = atkFHp ? Math.max(0, (atkFHp[1] ?? atkFHp[0] ?? 0) - (atkFHp[0] ?? 0)) : 0;
      if (atkDs < 9) { atkSpecialReroll += 1; combat.bonusHits = (combat.bonusHits || 0) + 1; }
    }
    // Inspiring (Luke Skywalker on attacker's team): +1 atk reroll for another friendly within 3 spaces
    {
      const atkFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const mapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const atkPos = atkFigs[combat.attackerFigureKey];
      for (const [fk, pos] of Object.entries(atkFigs)) {
        if (fk === combat.attackerFigureKey) continue;
        const fn = fk.replace(/-\d+-\d+$/, '');
        const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
        if (!(fe?.specialAbilityIds || []).includes('inspiring')) continue;
        if (atkPos && isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkPos).toLowerCase(), 3)) {
          atkSpecialReroll += 1; break;
        }
      }
    }
    // Soresu Form (Kanan Jarrus on defender's team): +1 def reroll for a friendly within 3 spaces
    {
      const defFigs = game.figurePositions?.[defenderPlayerNum] || {};
      const mapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const defPos = combat.target?.coord;
      for (const [fk, pos] of Object.entries(defFigs)) {
        const fn = fk.replace(/-\d+-\d+$/, '');
        const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
        if (!(fe?.specialAbilityIds || []).includes('soresu_form')) continue;
        if (defPos && isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defPos).toLowerCase(), 3)) {
          defSpecialReroll += 1;
          combat.soresuFormFigKey = fk;
          break;
        }
      }
    }

    const atkRerolls = (combat.rerollOneAttackDie || 0) + (game.roundAttackRerollDice?.[attackerPlayerNum] || 0) + atkInnate.attackReroll + atkSpecialReroll;
    const defRerolls = (combat.defenderRerollDiceMax || 0) + defInnate.defenseReroll + defSpecialReroll;
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
  if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.rerollPhase) {
    await interaction.followUp({ content: 'No reroll phase active.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const expectedPhase = side === 'atk' ? 'attacker' : 'defender';
  if (combat.rerollPhase !== expectedPhase) {
    await interaction.followUp({ content: `It's the ${combat.rerollPhase}'s turn to reroll.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const effectiveAtk = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  const expectedPlayer = side === 'atk' ? effectiveAtk : defenderPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, expectedPlayer)) {
    await interaction.followUp({ content: `Only P${expectedPlayer} can reroll ${side === 'atk' ? 'attack' : 'defense'} dice.`, ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

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

/** BFS check: is coordB reachable from coordA within maxDist hops via mapSpaces adjacency? */
function isWithinSpaces(mapSpaces, coordA, coordB, maxDist) {
  if (!mapSpaces?.adjacency || !coordA || !coordB) return false;
  const a = coordA.toLowerCase(), b = coordB.toLowerCase();
  if (a === b) return true;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      for (const adj of (mapSpaces.adjacency[c] || [])) {
        const s = String(adj).toLowerCase();
        if (s === b) return true;
        if (!visited.has(s)) { visited.add(s); next.push(s); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return false;
}

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
      const acc  = p.match(/^\+(\d+)\s+accur/);       if (acc)    { combat.bonusAccuracy  = (combat.bonusAccuracy  || 0) + parseInt(acc[1],    10); continue; }
      const pier = p.match(/^pierce\s+(\d+)$/i);      if (pier)   { combat.bonusPierce    = (combat.bonusPierce    || 0) + parseInt(pier[1],   10); continue; }
      const surg = p.match(/^\+(\d+)\s+surge$/);      if (surg)   { combat.surgeBonus     = (combat.surgeBonus     || 0) + parseInt(surg[1],   10); continue; }
      const blas = p.match(/^blast\s+(\d+)$/);        if (blas)   { combat.bonusBlast     = (combat.bonusBlast     || 0) + parseInt(blas[1],   10); continue; }
      const clv  = p.match(/^cleave\s+(\d+)$/);       if (clv)    { combat.passiveCleave  = (combat.passiveCleave  || 0) + parseInt(clv[1],    10); continue; }
      if (p === 'bleed')        { combat.bonusConditions = (combat.bonusConditions || []).concat(['Bleed']); continue; }
      if (p === 'professional') { combat.rerollOneAttackDie = (combat.rerollOneAttackDie || 0) + 1; continue; }
    }
  }

  for (const passive of (defenderPassives || [])) {
    for (const p of parts(passive)) {
      const blk  = p.match(/^(?:block\s+(\d+)|\+(\d+)\s+block)$/i); if (blk) { combat.bonusBlock = (combat.bonusBlock || 0) + parseInt(blk[1] ?? blk[2], 10); continue; }
      const evd  = p.match(/^\+(\d+)\s+evade$/);      if (evd)    { combat.bonusEvade     = (combat.bonusEvade     || 0) + parseInt(evd[1],    10); continue; }
      if (p === 'professional') { combat.defenderRerollDiceMax = (combat.defenderRerollDiceMax || 0) + 1; continue; }
    }
  }
}

// --- Power token helpers ---

/** Returns [{type, index}] of tokens the role is allowed to spend */
function getEligibleTokens(game, figureKey, role) {
  const allowed = role === 'attacker' ? ['Hit', 'Surge', 'Wild'] : ['Block', 'Evade', 'Wild'];
  return (game.figurePowerTokens?.[figureKey] || [])
    .map((type, index) => ({ type, index }))
    .filter(t => allowed.includes(t.type));
}

/** Sends the spending window with up to 4 token buttons + Skip */
async function sendTokenWindow(thread, gameId, role, tokens, displayName) {
  const prefix = role === 'attacker' ? 'att' : 'def';
  const btns = tokens.slice(0, 4).map(({ type, index }) =>
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_${prefix}_${index}`)
      .setLabel(type === 'Wild' ? 'Wild (choose type)' : `Spend ${type} (+1 ${type})`)
      .setStyle(ButtonStyle.Secondary)
  );
  btns.push(
    new ButtonBuilder()
      .setCustomId(`combat_token_${gameId}_${prefix}_skip`)
      .setLabel('Skip (no token)')
      .setStyle(ButtonStyle.Primary)
  );
  await thread.send({
    content: `**Power Token — ${role === 'attacker' ? 'Attacker' : 'Defender'}** (${displayName}): spend a token or skip.`,
    components: [new ActionRowBuilder().addComponents(btns)],
  });
}

/** Sends Wild type selection: attacker picks Hit/Surge; defender picks Block/Evade */
async function sendWildTypeWindow(thread, gameId, role) {
  const types = role === 'attacker' ? ['Hit', 'Surge'] : ['Block', 'Evade'];
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

/** Apply token bonus to combat state */
function applyTokenBonus(combat, type) {
  if (type === 'Hit')   combat.bonusHits  = (combat.bonusHits  || 0) + 1;
  if (type === 'Surge') combat.tokenSurgeBonus = (combat.tokenSurgeBonus || 0) + 1;
  if (type === 'Block') combat.bonusBlock = (combat.bonusBlock || 0) + 1;
  if (type === 'Evade') combat.bonusEvade = (combat.bonusEvade || 0) + 1;
}

/** Send a 4-button prompt asking the player to choose a power token type (Hit/Surge/Block/Evade) */
async function sendPowerTokenChoicePrompt(thread, gameId, grants) {
  const totalCount = grants.reduce((sum, g) => sum + g.count, 0);
  const figNames = [...new Set(grants.map(g => g.figName))].join(', ');
  const countLabel = totalCount > 1 ? `${totalCount} tokens` : '1 token';
  const btns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
    new ButtonBuilder()
      .setCustomId(`power_token_choice_${gameId}_${t.toLowerCase()}`)
      .setLabel(t)
      .setStyle(ButtonStyle.Secondary)
  );
  await thread.send({
    content: `**Choose power token type** for **${figNames}** (${countLabel}):`,
    components: [new ActionRowBuilder().addComponents(btns)],
  }).catch((err) => { console.error('[discord]', err?.message ?? err); });
}

/** Remove token from game.figurePowerTokens by index */
function removeSpentToken(game, figureKey, index) {
  if (!game.figurePowerTokens?.[figureKey]) return;
  game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey].filter((_, i) => i !== index);
  if (game.figurePowerTokens[figureKey].length === 0) delete game.figurePowerTokens[figureKey];
}

/** Advance to next phase: attacker done → check defender; defender done → proceedAfterTokens */
async function advanceTokenPhase(thread, game, combat, completedRole, ctx) {
  combat.tokenPhase = null;
  if (completedRole === 'attacker') {
    const defTokens = getEligibleTokens(game, combat.target.figureKey, 'defender');
    if (defTokens.length > 0) {
      combat.tokenPhase = 'defender';
      await sendTokenWindow(thread, game.gameId, 'defender', defTokens, combat.target.label);
      return;
    }
  }
  await proceedAfterTokens(thread, game, combat, ctx);
}

/**
 * After rerolls are complete: check dodge, then gate through token windows if eligible tokens exist.
 */
async function proceedAfterRerolls(thread, game, combat, ctx) {
  const saveGames = ctx.saveGames;

  // Lasat Honor Guard (Zeb Orrelios): after rerolls, may turn 1 die showing only a single attack icon to any other side
  if (!combat.lasatHonorGuardUsed && combat.attackDiceResults?.length > 0) {
    const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const atkDcName = (combat.attackerFigureKey || '').replace(/-\d+-\d+$/, '');
    const atkEff = getDcEff[atkDcName] || getDcEff[atkDcName?.replace(/\s*\[.*\]\s*$/, '')];
    if ((atkEff?.specialAbilityIds || []).includes('lasat_honor_guard')) {
      const eligibleIdxs = combat.attackDiceResults
        .map((d, i) => ({ d, i }))
        .filter(({ d }) => (d.acc || 0) + (d.dmg || 0) + (d.surge || 0) === 1)
        .map(({ i }) => i);
      if (eligibleIdxs.length > 0) {
        combat.lasatHonorGuardPhase = true;
        combat.lasatHonorGuardUsed = true;
        combat.lasatEligibleDiceIndices = eligibleIdxs;
        await sendLasatDiePicker(thread, game.gameId, combat, eligibleIdxs, ctx);
        saveGames?.();
        return;
      }
    }
  }

  const defRoll = combat.defenseRoll;

  // Defensive Stance (Diala Passil): if a Dodge is rolled while defending, convert it to +2 Block, +1 Evade
  if (defRoll.dodge && combat.target?.figureKey) {
    const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const defDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
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
    const defDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const defEff = getDcEff[defDcName] || getDcEff[defDcName?.replace(/\s*\[.*\]\s*$/, '')];
    const allKws = [...(defEff?.keywords || []), ...(defEff?.traits || [])].map((k) => String(k).toUpperCase());
    const isFORCE_USER = allKws.includes('FORCE USER');
    const kananPlayerNum = combat.attackerPlayerNum === 1 ? 2 : 1;
    const strainNote = isFORCE_USER ? '' : ' Kanan suffers 1 Strain.';
    await thread.send(`**Soresu Form** — Dodge converted to +2 Block, +1 Evade.${strainNote}`);
    if (!isFORCE_USER) {
      await applyStrainToFigure(game, kananPlayerNum, combat.soresuFormFigKey, 1, 'Soresu Form', 'Kanan Jarrus', ctx, thread);
    }
    combat.soresuFormFigKey = null;
  }

  // Dodge check (now AFTER rerolls and Defensive Stance conversion)
  if (combat.defenseRoll.dodge) {
    await thread.send('**DODGE!** The attack misses — all damage and effects negated.');
    await sendReadyToResolveRolls(thread, game.gameId);
    return;
  }

  const attackerTokens = getEligibleTokens(game, combat.attackerFigureKey, 'attacker');
  const defenderTokens = getEligibleTokens(game, combat.target.figureKey, 'defender');
  if (attackerTokens.length > 0) {
    combat.tokenPhase = 'attacker';
    await sendTokenWindow(thread, game.gameId, 'attacker', attackerTokens, combat.attackerDisplayName);
    return;
  }
  if (defenderTokens.length > 0) {
    combat.tokenPhase = 'defender';
    await sendTokenWindow(thread, game.gameId, 'defender', defenderTokens, combat.target.label);
    return;
  }
  await proceedAfterTokens(thread, game, combat, ctx);
}

/**
 * After token windows are resolved: evade cancellation, surge spending, or ready-to-resolve.
 */
async function proceedAfterTokens(thread, game, combat, ctx) {
  const { getAttackerSurgeAbilities, SURGE_LABELS } = ctx;
  const getAbility = ctx.getAbility || (() => null);
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (SURGE_LABELS && SURGE_LABELS[id]) || id);
  const defRoll = combat.defenseRoll;

  // Evade cancels surge
  const roll = combat.attackRoll;
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defPlayerNum = attackerPlayerNum === 1 ? 2 : 1;
  const perDefDieSurge = (combat.bonusSurgePerDefenseDie || 0) * defenseDiceCount;
  // Hidden on attacker: +1 surge
  const hiddenSurgeBonus = combat.attackerConds?.includes('Hide') ? 1 : 0;
  // Fury (Wookiee Warriors): +1 surge if 5+ damage (set at attack declare time)
  const furyBonus = combat.furyBonus || 0;
  const surgeBonus = (combat.surgeBonus || 0) + (game.roundAttackSurgeBonus?.[attackerPlayerNum] || 0) + perDefDieSurge + hiddenSurgeBonus + furyBonus;
  const rawSurge = roll.surge + surgeBonus + (combat.tokenSurgeBonus || 0);
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
  const affordable = surgeAbilities.filter((key) => ((key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1))) <= remaining);
  if (totalSurge > 0 && (affordable.length > 0 || combat.attackerConds?.includes('Bleed'))) {
    combat.surgeRemaining = totalSurge;
    combat.surgeDamage = 0;
    combat.surgePierce = 0;
    combat.surgeAccuracy = 0;
    combat.surgeConditions = [];
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
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
    if (combat.attackerConds?.includes('Bleed')) {
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${game.gameId}_bleed_prevention`)
          .setLabel('Spend 1 Surge — Prevent Bleed')
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
    const surgeDisplay = (ccSurge > 0 || roundSurge > 0 || hiddenSurgeBonus > 0 || furyBonus > 0)
      ? `${roll.surge}${ccSurge ? ` + ${ccSurge} (CC)` : ''}${roundSurge ? ` + ${roundSurge} (round)` : ''}${hiddenSurgeBonus ? ` + 1 (Hidden)` : ''}${furyBonus ? ` + ${furyBonus} (Fury)` : ''} = **${totalSurge}**`
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
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat to resolve.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can confirm.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
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
  const match = interaction.customId.match(/^combat_surge_([^_]+)_(done|\d+|bleed_prevention)$/);
  if (!match) return;
  const [, gameId, choice] = match;
  const game = getGame(gameId);
  if (!game) {
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.surgeRemaining) {
    await interaction.followUp({ content: 'No surge step or already resolved.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const effectiveAttackerForSurge = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttackerForSurge)) {
    await interaction.followUp({ content: 'Only the attacker may spend surge.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  if (choice === 'bleed_prevention') {
    combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - 1);
    combat.surgePreventBleed = true;
    await thread.send('Spent 1 surge — Bleeding will be prevented this activation.').catch((err) => { console.error('[discord]', err?.message ?? err); });
  } else if (choice !== 'done') {
    const idx = parseInt(choice, 10);
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const key = surgeAbilities[idx];
    if (key) {
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      const mod = resolveSurge(key);
      combat.surgeDamage = (combat.surgeDamage || 0) + (mod.damage ?? 0);
      combat.surgePierce = (combat.surgePierce || 0) + (mod.pierce ?? 0);
      combat.surgeAccuracy = (combat.surgeAccuracy || 0) + (mod.accuracy ?? 0);
      if (mod.conditions?.length) combat.surgeConditions = (combat.surgeConditions || []).concat(mod.conditions);
      combat.surgeBlast = (combat.surgeBlast || 0) + (mod.blast ?? 0);
      combat.surgeRecover = (combat.surgeRecover || 0) + (mod.recover ?? 0);
      combat.surgeCleave = (combat.surgeCleave || 0) + (mod.cleave ?? 0);
      // Named surge flags
      if (mod.replaceWithStun) combat.attackResultReplaceWithStun = true;
      if (mod.surgeCancelDodge) combat.surgeCancelDodge = true;
      if (mod.surgeHarass) combat.surgeHarass = (combat.surgeHarass || 0) + mod.surgeHarass;
      if (mod.surgeSquadCommand) combat.surgeSquadCommand = true;
      if (mod.surgeStalkPrey) combat.surgeStalkPrey = true;
      if (mod.surgeCriticalHit) combat.surgeCriticalHit = true;
      if (mod.surgeSuppressionStrain) combat.surgeSuppressionStrain = true;
      if (mod.surgeFightingKnife) combat.surgeFightingKnife = true;
      if (mod.surgeConcussiveBolt) combat.surgeConcussiveBolt = true;
      // Bargain (Jawa Scavenger Elite): inline VP exchange during surge phase
      if (mod.surgeBargain) {
        const vpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
        game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
        const vp = game[vpKey];
        if ((vp.total || 0) >= 1) {
          vp.total -= 1;
          if ((vp.objectives || 0) > 0) vp.objectives -= 1;
          else vp.kills = Math.max(0, (vp.kills || 0) - 1);
          const rollFn = ctx.rollSingleAttackDie;
          const bargainDie = rollFn ? rollFn('green') : { dmg: 0, surge: 0 };
          const gained = bargainDie.dmg || 0;
          if (gained > 0) { vp.total += gained; vp.objectives += gained; }
          const net = gained - 1;
          await thread.send(`**Bargain** — Spent 1 VP, rolled green die (${bargainDie.dmg ?? 0}dmg): gained **${gained} VP** (net ${net >= 0 ? '+' : ''}${net}).`).catch((err) => { console.error('[discord]', err?.message ?? err); });
          if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Bargain** — Spent 1 VP, gained ${gained} VP (net ${net >= 0 ? '+' : ''}${net})`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
        } else {
          await thread.send('**Bargain** — No VP available to spend; ability has no effect.').catch((err) => { console.error('[discord]', err?.message ?? err); });
        }
      }
      // Self-condition surges: apply condition to attacker's own figure
      if (mod.surgeSelfFocus && combat.attackerFigureKey) {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[combat.attackerFigureKey] || [];
        if (!existing.includes('Focus')) game.figureConditions[combat.attackerFigureKey] = [...existing, 'Focus'];
      }
      if (mod.surgeSelfHide && combat.attackerFigureKey) {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[combat.attackerFigureKey] || [];
        if (!existing.includes('Hide')) game.figureConditions[combat.attackerFigureKey] = [...existing, 'Hide'];
      }
      // Power token grants to attacker's figurePowerTokens
      if ((mod.surgeGrantHitToken || 0) > 0 && combat.attackerFigureKey) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[combat.attackerFigureKey] = game.figurePowerTokens[combat.attackerFigureKey] || [];
        for (let _i = 0; _i < mod.surgeGrantHitToken; _i++) game.figurePowerTokens[combat.attackerFigureKey].push('Hit');
      }
      if ((mod.surgeGrantBlockToken || 0) > 0 && combat.attackerFigureKey) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[combat.attackerFigureKey] = game.figurePowerTokens[combat.attackerFigureKey] || [];
        for (let _i = 0; _i < mod.surgeGrantBlockToken; _i++) game.figurePowerTokens[combat.attackerFigureKey].push('Block');
      }
      if ((mod.surgeGrantPowerToken || 0) > 0 && combat.attackerFigureKey) {
        const figName = combat.attackerFigureKey.replace(/-\d+-\d+$/, '');
        game.pendingPowerTokenGrant = { grants: [{ figureKey: combat.attackerFigureKey, figName, count: mod.surgeGrantPowerToken }], channelId: null, playerNum: combat.attackerPlayerNum };
      }
      if ((mod.surgeGrantEvade || 0) > 0 && combat.attackerFigureKey) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[combat.attackerFigureKey] = game.figurePowerTokens[combat.attackerFigureKey] || [];
        for (let _i = 0; _i < mod.surgeGrantEvade; _i++) game.figurePowerTokens[combat.attackerFigureKey].push('Evade');
      }
      if ((mod.surgeAttackerBlock || 0) > 0 && combat.attackerFigureKey) {
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[combat.attackerFigureKey] = game.figurePowerTokens[combat.attackerFigureKey] || [];
        for (let _i = 0; _i < mod.surgeAttackerBlock; _i++) game.figurePowerTokens[combat.attackerFigureKey].push('Block');
      }
      // Surge-for-surge: add back to remaining before the cost decrement below
      if ((mod.surgeGrantExtraSurge || 0) > 0) {
        combat.surgeRemaining = (combat.surgeRemaining || 0) + mod.surgeGrantExtraSurge;
      }
      if (mod.surgeComplex) {
        const cThread = await interaction.client.channels.fetch(combat.combatThreadId);
        await cThread.send(`⚠️ **${getSurgeLabel(key)}** — resolve manually (see ability text).`).catch((err) => { console.error('[discord]', err?.message ?? err); });
      }
      combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - cost);
      const label = getSurgeLabel(key);
      await thread.send(`**Surge spent (${cost}):** ${label}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
      // If this surge granted a power token, send the type-choice prompt now
      if (game.pendingPowerTokenGrant?.channelId === null) {
        game.pendingPowerTokenGrant.channelId = thread.id;
        await sendPowerTokenChoicePrompt(thread, gameId, game.pendingPowerTokenGrant.grants);
        saveGames();
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
        }).catch((err) => { console.error('[discord]', err?.message ?? err); });
        saveGames();
        return; // wait for player to choose condition before continuing surge
      }
    }
  }
  if (combat.surgeRemaining <= 0 || choice === 'done') {
    combat.surgeRemaining = 0;
    await sendReadyToResolveRolls(thread, gameId);
  } else {
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const remaining = combat.surgeRemaining || 0;
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
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
    if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
      surgeRows.push(
        new ButtonBuilder()
          .setCustomId(`combat_surge_${gameId}_bleed_prevention`)
          .setLabel('Spend 1 Surge — Prevent Bleed')
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
 * Handle power token spending buttons (combat_token_).
 * Custom ID patterns:
 *   combat_token_{gameId}_att_{n|skip}  — attacker spends token index n, or skips
 *   combat_token_{gameId}_def_{n|skip}  — defender spends token index n, or skips
 */
export async function handleCombatToken(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  // Match both att/def (spend/skip) and wild (type resolution) patterns
  const m = interaction.customId.match(/^combat_token_([^_]+)_(att|def|wild)_(.+)$/);
  if (!m) return;
  const [, gameId, role, choice] = m;
  const game = getGame(gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  // Wild type resolution: combat_token_{gameId}_wild_{hit|surge|block|evade}
  if (role === 'wild') {
    if (!combat.pendingWildRole || combat.pendingWildTokenIndex == null) return;
    const typeMap = { hit: 'Hit', surge: 'Surge', block: 'Block', evade: 'Evade' };
    const resolvedType = typeMap[choice];
    if (!resolvedType) return;
    applyTokenBonus(combat, resolvedType);
    const figKey = combat.pendingWildRole === 'attacker' ? combat.attackerFigureKey : combat.target.figureKey;
    removeSpentToken(game, figKey, combat.pendingWildTokenIndex);
    await thread.send(`**Power Token spent:** Wild → +1 ${resolvedType}`);
    const completedRole = combat.pendingWildRole;
    combat.pendingWildRole = null;
    combat.pendingWildTokenIndex = null;
    await advanceTokenPhase(thread, game, combat, completedRole, ctx);
    saveGames();
    return;
  }

  const isAttacker = role === 'att';
  const expectedPhase = isAttacker ? 'attacker' : 'defender';
  if (combat.tokenPhase !== expectedPhase) return;
  const atkPlayerNum = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  const playerNum = isAttacker ? atkPlayerNum : (combat.attackerPlayerNum === 1 ? 2 : 1);
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the correct player may spend their token.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }

  // Skip
  if (choice === 'skip') {
    await thread.send(`**Power Token — ${isAttacker ? 'Attacker' : 'Defender'}:** No token spent.`);
    await advanceTokenPhase(thread, game, combat, expectedPhase, ctx);
    saveGames();
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
    saveGames();
    return;
  }

  applyTokenBonus(combat, tokenType);
  removeSpentToken(game, figureKey, tokenIndex);
  await thread.send(`**Power Token spent:** +1 ${tokenType}`);
  await advanceTokenPhase(thread, game, combat, expectedPhase, ctx);
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
    await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingCleave;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No cleave target selection in progress.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (interaction.user.id !== pending.ownerId) {
    await interaction.followUp({ content: 'Only the attacker may choose the cleave target.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const targetIndex = parseInt(indexStr, 10);
  const target = pending.targets[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
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
  delete game.pendingCleave;
  const { checkPostCombatSurges } = ctx;
  if (checkPostCombatSurges) {
    const defPN = pending.attackerPlayerNum === 1 ? 2 : 1;
    const cThread = await client.channels.fetch(pending.combat.combatThreadId).catch(() => null);
    if (cThread) {
      const triggered = await checkPostCombatSurges(game, pending.combat, pending.resultText, embedRefreshMsgIds, cThread, pending.ownerId, defPN);
      if (triggered) { saveGames(); return; }
    }
  }
  await finishCombatResolution(game, pending.combat, pending.resultText, embedRefreshMsgIds, client);
  saveGames();
}

/**
 * Handle power token type-choice buttons (power_token_choice_).
 * Fired after any ability grants a generic "power token"; player picks Hit/Surge/Block/Evade.
 */
export async function handlePowerTokenChoice(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const { getGame, saveGames, canActAsPlayer } = ctx;
  const match = interaction.customId.match(/^power_token_choice_([^_]+)_(hit|surge|block|evade)$/);
  if (!match) return;
  const [, gameId, typeRaw] = match;
  const type = typeRaw[0].toUpperCase() + typeRaw.slice(1); // 'Hit', 'Surge', 'Block', 'Evade'
  const game = getGame(gameId);
  if (!game?.pendingPowerTokenGrant?.grants?.length) return;
  const { grants, channelId, playerNum } = game.pendingPowerTokenGrant;
  if (playerNum && !canActAsPlayer(game, interaction.user.id, playerNum)) return;
  game.figurePowerTokens = game.figurePowerTokens || {};
  const lines = [];
  for (const { figureKey, figName, count } of grants) {
    game.figurePowerTokens[figureKey] = game.figurePowerTokens[figureKey] || [];
    for (let i = 0; i < count; i++) game.figurePowerTokens[figureKey].push(type);
    lines.push(`${figName}: ${count > 1 ? `${count}× ` : ''}**${type}**`);
  }
  game.pendingPowerTokenGrant = null;
  if (channelId) {
    const ch = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (ch) await ch.send(`**Power Token(s) granted:** ${lines.join(', ')}`).catch((err) => { console.error('[discord]', err?.message ?? err); });
  }
  // If we're mid-surge and there are still surges remaining, continue the surge flow
  const combat = game.pendingCombat;
  if (combat?.surgeRemaining > 0 && channelId) {
    const thread = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (thread) {
      const surgeAbilities = ctx.getAttackerSurgeAbilities ? ctx.getAttackerSurgeAbilities(combat) : [];
      const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS?.[id]) || id);
      const remaining = combat.surgeRemaining || 0;
      const surgeRows = [];
      for (let i = 0; i < surgeAbilities.length; i++) {
        const k = surgeAbilities[i];
        const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
        if (cost > remaining) continue;
        const label = (getSurgeLabel(k) || k).slice(0, 80);
        const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
        surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_${i}`).setLabel(btnLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary));
      }
      surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
      const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
      await thread.send({ content: `**Spend surge?** **${remaining}** surge left. Choose an ability or Done.`, components: [surgeRow] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    }
  }
  saveGames();
}

/**
 * Handle Spread the Pain condition choice during surge phase.
 * Custom ID: spread_pain_cond_{gameId}_{stun|weaken|bleed|skip}
 */
export async function handleSpreadThePainCondPick(interaction, ctx) {
  await interaction.deferUpdate().catch(() => {});
  const { getGame, saveGames } = ctx;
  const m = interaction.customId.match(/^spread_pain_cond_([^_]+)_(stun|weaken|bleed|skip)$/);
  if (!m) return;
  const [, gameId, condRaw] = m;
  const game = getGame(gameId);
  if (!game?.pendingSpreadThePainCondPick) return;
  const { attackerPlayerNum, combatThreadId } = game.pendingSpreadThePainCondPick;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) return;
  await interaction.message.edit({ components: [] }).catch(() => {});
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  game.pendingSpreadThePainCondPick = null;

  const thread = await interaction.client.channels.fetch(combatThreadId).catch(() => null);
  if (!thread) { saveGames(); return; }

  if (condRaw !== 'skip') {
    const cond = condRaw[0].toUpperCase() + condRaw.slice(1); // 'Stun' | 'Weaken' | 'Bleed'
    combat.spreadThePainConditions = [...(combat.spreadThePainConditions || []), cond];
    await thread.send(`**Spread the Pain** — **${cond}** chosen. Will apply post-combat.`).catch(() => {});
  }

  // Resume surge phase
  if ((combat.surgeRemaining || 0) > 0) {
    const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS?.[id]) || id);
    const surgeAbilities = ctx.getAttackerSurgeAbilities ? ctx.getAttackerSurgeAbilities(combat) : [];
    const remaining = combat.surgeRemaining;
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const k = surgeAbilities[i];
      const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      const label = (getSurgeLabel(k) || k).slice(0, 80);
      const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
      surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_${i}`).setLabel(btnLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary));
    }
    if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
      surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_bleed_prevention`).setLabel('Spend 1 Surge — Prevent Bleed').setStyle(ButtonStyle.Secondary));
    }
    surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
    const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
    await thread.send({ content: `**Spend surge?** **${remaining}** surge left. Choose an ability or Done.`, components: [surgeRow] }).catch(() => {});
  } else {
    await sendReadyToResolveRolls(thread, gameId);
  }
  saveGames();
}

/**
 * Handle Figurehead ability decision (use or skip).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - combat context
 */
export async function handleFigureheadDecision(interaction, ctx) {
  const { getGame, client, saveGames, applyDamageAndFinishCombat, isDcUnique, getCelebrationButtons, dcHealthState, findDcMessageIdForFigure, logGameAction, isGroupDefeated, checkWinConditions, updateActivationsMessage, updateAttachmentMessageForDc, getDcStats, getDcEffects } = ctx;
  const isUse = interaction.customId.startsWith('figurehead_use_');
  const gameId = interaction.customId.replace(/^figurehead_(?:use|skip)_/, '');
  const game = getGame(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game not found.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  const pending = game.pendingFigurehead;
  if (!pending) {
    await interaction.followUp({ content: 'No pending Figurehead decision.', ephemeral: true }).catch(() => {});
    return;
  }
  delete game.pendingFigurehead;
  const combat = game.pendingCombat;
  if (!combat) {
    await interaction.followUp({ content: 'Combat data missing.', ephemeral: true }).catch(() => {});
    return;
  }
  const { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex, fhFigKey, fhMsgId, fhFigIndex, fhLabel } = pending;
  const thread = await client.channels.fetch(combat.combatThreadId);

  if (isUse) {
    const fhDamage = Math.max(0, damage - 1);
    let fhResultText = '';
    if (fhMsgId && fhFigKey) {
      const fhHS = (dcHealthState && dcHealthState.get(fhMsgId)) || [];
      const fhEntry = fhHS[fhFigIndex];
      if (fhEntry) {
        const [fhCur, fhMax] = fhEntry;
        const fhNew = Math.max(0, (fhCur ?? fhMax) - fhDamage);
        fhHS[fhFigIndex] = [fhNew, fhMax ?? fhNew];
        if (dcHealthState) dcHealthState.set(fhMsgId, fhHS);
        const fhDcIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const fhDcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
        const fhIdx = (fhDcIds || []).indexOf(fhMsgId);
        if (fhIdx >= 0 && fhDcList?.[fhIdx]) fhDcList[fhIdx].healthState = [...fhHS];
        fhResultText = `**Figurehead** — ${fhLabel || 'Murne Rin'} suffers **${fhDamage} damage** (${fhCur ?? fhMax} — ${fhNew} HP); ${combat.target.label} suffers 0.`;
        if (fhNew <= 0) {
          // Murne Rin defeated
          if (game.figurePositions?.[defenderPlayerNum]) delete game.figurePositions[defenderPlayerNum][fhFigKey];
          if (game.figureConditions?.[fhFigKey]) delete game.figureConditions[fhFigKey];
          const fhDcName = fhFigKey.replace(/-\d+-\d+$/, '');
          const fhStats = getDcStats?.(fhDcName);
          const fhEff = getDcEffects?.()?.[fhDcName];
          const fhFigures = fhStats?.figures ?? 1;
          const fhVp = (fhFigures > 1 && fhEff?.subCost != null) ? fhEff.subCost : (fhStats?.cost ?? 4);
          const fhVpKey = attackerPlayerNum === 1 ? 'player1VP' : 'player2VP';
          game[fhVpKey] = game[fhVpKey] || { total: 0, kills: 0, objectives: 0 };
          game[fhVpKey].kills += fhVp;
          game[fhVpKey].total += fhVp;
          fhResultText += ` — **${fhLabel || 'Murne Rin'} defeated!** +${fhVp} VP`;
          if (logGameAction) await logGameAction(game, client, `**Figurehead** — ${fhLabel || 'Murne Rin'} was defeated! +${fhVp} VP`, { phase: 'ROUND', icon: 'attack' });
          if (fhIdx >= 0 && isGroupDefeated?.(game, defenderPlayerNum, fhIdx)) {
            const fhActivated = defenderPlayerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []);
            if (!fhActivated.includes(fhIdx)) {
              if (defenderPlayerNum === 1) game.p1ActivationsRemaining = Math.max(0, (game.p1ActivationsRemaining ?? 0) - 1);
              else game.p2ActivationsRemaining = Math.max(0, (game.p2ActivationsRemaining ?? 0) - 1);
              if (updateActivationsMessage) await updateActivationsMessage(game, defenderPlayerNum, client);
            }
            const fhCcAttachKey = defenderPlayerNum === 1 ? 'p1CcAttachments' : 'p2CcAttachments';
            if (game[fhCcAttachKey]?.[fhMsgId]?.length) {
              delete game[fhCcAttachKey][fhMsgId];
              if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, defenderPlayerNum, fhMsgId, client);
            }
          }
          await checkWinConditions?.(game, client);
          const fhAtkerOwnerId = attackerPlayerNum === 1 ? game.player1Id : game.player2Id;
          if (!game.pendingCelebration && isDcUnique?.(fhDcName)) {
            game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
            await thread.send({
              content: `<@${fhAtkerOwnerId}> — You defeated a unique figure (Figurehead). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [fhAtkerOwnerId] },
            }).catch((err) => { console.error('[discord]', err?.message ?? err); });
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
    await ctx.updateAttachmentMessageForDc(game, defenderPlayerNum, fhMsgId, client).catch(() => {});
  }
  await interaction.editReply({ components: [] }).catch(() => {});
  saveGames();
}

// ─── Lasat Honor Guard helpers ────────────────────────────────────────────────

/** Send die picker for Lasat Honor Guard (multiple eligible dice). */
async function sendLasatDiePicker(thread, gameId, combat, eligibleIdxs, ctx) {
  if (eligibleIdxs.length === 1) {
    await sendLasatFacePicker(thread, gameId, combat, eligibleIdxs[0], ctx);
    return;
  }
  const buttons = eligibleIdxs.map((idx) => {
    const die = combat.attackDiceResults[idx];
    const face = `${die.acc || 0}a/${die.dmg || 0}d/${die.surge || 0}s`;
    return new ButtonBuilder()
      .setCustomId(`lasat_die_${gameId}_${idx}`)
      .setLabel(`${(die.color || 'die').charAt(0).toUpperCase() + (die.color || 'die').slice(1)} [${face}]`)
      .setStyle(ButtonStyle.Secondary);
  });
  const rows = buildActionRows(buttons);
  await thread.send({ content: '**Lasat Honor Guard** — Choose which die to turn:', components: rows });
}

/** Send face picker for Lasat Honor Guard (player selects new face). */
async function sendLasatFacePicker(thread, gameId, combat, dieIdx, ctx) {
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) {
    await thread.send('**Lasat Honor Guard** — Resolve manually (dice data unavailable).');
    return;
  }
  const die = combat.attackDiceResults[dieIdx];
  const faces = getDiceData().attack?.[die.color] || [];
  const currentKey = `${die.acc || 0}/${die.dmg || 0}/${die.surge || 0}`;
  const otherFaces = faces
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => `${f.acc || 0}/${f.dmg || 0}/${f.surge || 0}` !== currentKey);
  if (otherFaces.length === 0) {
    await thread.send('**Lasat Honor Guard** — No other faces available. Resolve manually.');
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
 * Handle lasat_die_ button: player selects which eligible die to turn.
 * customId: lasat_die_{gameId}_{dieIdx}
 */
export async function handleLasatDiePick(interaction, ctx) {
  const m = interaction.customId.match(/^lasat_die_([^_]+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const dieIdx = parseInt(idxStr, 10);
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const game = getGame(gameId);
  if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat die choice active.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttacker)) {
    await interaction.followUp({ content: 'Only the attacker may choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  if (!(combat.lasatEligibleDiceIndices || []).includes(dieIdx)) {
    await interaction.followUp({ content: 'That die is not eligible.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  await interaction.deferUpdate().catch(() => {});
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  combat.lasatChosenDieIndex = dieIdx;
  await sendLasatFacePicker(thread, gameId, combat, dieIdx, ctx);
  saveGames();
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
  const game = getGame(gameId);
  if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat face choice active.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttacker)) {
    await interaction.followUp({ content: 'Only the attacker may choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) { await interaction.followUp({ content: 'Dice data unavailable.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  const die = combat.attackDiceResults?.[dieIdx];
  if (!die) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  const faces = getDiceData().attack?.[die.color] || [];
  const newFace = faces[faceIdx];
  if (!newFace) { await interaction.followUp({ content: 'Invalid face selection.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  // Subtract old face contribution, add new face values
  combat.attackRoll.acc = Math.max(0, (combat.attackRoll.acc || 0) - (die.acc || 0)) + (newFace.acc || 0);
  combat.attackRoll.dmg = Math.max(0, (combat.attackRoll.dmg || 0) - (die.dmg || 0)) + (newFace.dmg || 0);
  combat.attackRoll.surge = Math.max(0, (combat.attackRoll.surge || 0) - (die.surge || 0)) + (newFace.surge || 0);
  combat.attackDiceResults[dieIdx] = { ...die, acc: newFace.acc || 0, dmg: newFace.dmg || 0, surge: newFace.surge || 0 };
  combat.lasatHonorGuardPhase = false;
  await interaction.deferUpdate().catch(() => {});
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  await thread.send(`**Lasat Honor Guard** — Turned die to ${newFace.acc || 0}a/${newFace.dmg || 0}d/${newFace.surge || 0}s. New total: ${combat.attackRoll.acc}a/${combat.attackRoll.dmg}d/${combat.attackRoll.surge}s.`);
  await proceedAfterRerolls(thread, game, combat, ctx);
  saveGames();
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
  const game = getGame(gameId);
  if (!game) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); }); return; }
  if (await replyIfGameEnded(game, interaction)) return;
  const fo = game.pendingFalseOrders;
  if (!fo || fo.murneRinMsgId !== msgId) {
    await interaction.followUp({ content: 'No pending False Orders.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const { controllerPlayerNum, controlledFigureKey, controlledPlayerNum } = fo;
  if (!canActAsPlayer(game, interaction.user.id, controllerPlayerNum)) {
    await interaction.followUp({ content: 'Only the controller may choose.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  const targets = game.falseOrdersAttackTargets?.[msgId];
  const target = targets?.[targetIdx];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch((err) => { console.error('[discord]', err?.message ?? err); });
    return;
  }
  delete game.falseOrdersAttackTargets?.[msgId];
  delete game.pendingFalseOrders;
  const controlledName = controlledFigureKey.replace(/-\d+-\d+$/, '');
  const controlledStats = getDcStats(controlledName);
  const attackInfo = controlledStats?.attack || { dice: ['red'], range: [1, 3] };
  const targetDcName = target.figureKey.replace(/-\d+-\d+$/, '');
  const targetStats = getDcStats(targetDcName);
  const targetEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName?.replace(/\s*\[.*\]\s*$/, '')];
  const defenderPlayerNum = controlledPlayerNum === 1 ? 2 : 1;
  const combatDeclare = `**False Orders** — P${controllerPlayerNum} controls "${controlledName}" attacking "${target.label}"!`;
  const generalChannel = await client.channels.fetch(game.generalId);
  const declareMsg = await generalChannel.send({
    content: `${ACTION_ICONS?.attack || '⚔️'} <t:${Math.floor(Date.now() / 1000)}:t> — ${combatDeclare}`,
    allowedMentions: { users: [game.player1Id, game.player2Id] },
  });
  const thread = await declareMsg.startThread({
    name: `Combat (False Orders): P${controllerPlayerNum} vs P${defenderPlayerNum}`,
    autoArchiveDuration: ThreadAutoArchiveDuration?.OneWeek ?? 10080,
  });
  const readyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`combat_ready_${gameId}`)
      .setLabel('Ready to roll combat dice')
      .setStyle(ButtonStyle.Secondary)
  );
  const preCombatMsg = await thread.send({
    content: '**Pre-combat window** — Both players: resolve any Command Cards, etc. When ready, click **Ready to roll combat dice** below.',
    components: [readyRow],
  });
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const isRanged = minRange >= 2 || maxRange >= 3;
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
    p1Ready: false,
    p2Ready: false,
    attackRoll: null,
    defenseRoll: null,
    attackTargetMsgId: interaction.message.id,
    falseOrdersControllerPlayerNum: controllerPlayerNum,
  };
  const controlledEff = getDcEffects()[controlledName] || getDcEffects()[controlledName?.replace(/\s*\[.*\]\s*$/, '')];
  const defEff = getDcEffects()[targetDcName] || getDcEffects()[targetDcName?.replace(/\s*\[.*\]\s*$/, '')];
  applyDcPassivesToCombat(game.pendingCombat, controlledStats?.passives || [], targetStats?.passives || []);
  await interaction.message.edit({ content: '**False Orders — Attack declared**. See thread in Game Log.', components: [] }).catch((err) => { console.error('[discord]', err?.message ?? err); });
  if (logGameAction) await logGameAction(game, client, `⚔️ **False Orders** — P${controllerPlayerNum} controlling **${controlledName}** attacks **${targetDcName}**.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  saveGames();
}
