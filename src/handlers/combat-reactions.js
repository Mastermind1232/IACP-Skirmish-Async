import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { opponentPlayerNum, getPlayerId, getDcList, getDcMessageIds } from '../game/player-helpers.js';
import { reduceHp, dcNameFromFigureKey, awardKillVp } from '../game/index.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

export async function handleToughLuck(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    recalcAttackTotals, recalcDefenseTotals,
    sendRerollUI, proceedAfterRerolls,
    logGameAction,
  } = ctx;

  const buttonKey = interaction.customId.startsWith('tough_luck_remove_') ? 'tough_luck_remove_' : 'tough_luck_skip_';

  // Tough Luck: remove a rerolled die or skip, then continue reroll flow
  const parts = interaction.customId.split('_');
  const gameId = parts[3];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingToughLuck) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(() => {}); return; }
  const tlData = game.pendingToughLuck;
  const combat = game.pendingCombat;
  const responder = game.toughLuckPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, responder, canActAsPlayer, 'Only the Tough Luck player may respond.')) return;
  if (buttonKey === 'tough_luck_remove_') {
    const dieIdx = parseInt(parts[4], 10);
    if (tlData.side === 'atk' && combat?.attackDiceResults?.[dieIdx]) {
      const die = combat.attackDiceResults[dieIdx];
      combat.attackDiceResults.splice(dieIdx, 1);
      const t = recalcAttackTotals(combat.attackDiceResults);
      combat.attackRoll = { acc: t.acc, dmg: t.dmg, surge: t.surge };
      await logGameAction(game, client, `**Tough Luck** — Removed rerolled ${die.color} attack die. New totals: ${t.acc} acc, ${t.dmg} dmg, ${t.surge} surge.`, { phase: 'ROUND', icon: 'card' });
    } else if (tlData.side === 'def' && combat?.defenseDiceResults?.[dieIdx]) {
      const die = combat.defenseDiceResults[dieIdx];
      combat.defenseDiceResults.splice(dieIdx, 1);
      const t = recalcDefenseTotals(combat.defenseDiceResults);
      combat.defenseRoll = { block: t.block, evade: t.evade, dodge: t.dodge };
      await logGameAction(game, client, `**Tough Luck** — Removed rerolled ${die.color} defense die. New totals: ${t.block} block, ${t.evade} evade.`, { phase: 'ROUND', icon: 'card' });
    }
  } else {
    await logGameAction(game, client, '**Tough Luck** — Skipped.', { phase: 'ROUND', icon: 'card' });
  }
  game.pendingToughLuck = null;
  // Continue reroll flow
  const thread = await client.channels.fetch(combat?.combatThreadId).catch(() => null);
  if (thread && combat) {
    const side = tlData.side;
    const atkRem = combat.attackerRerollsRemaining || 0;
    const defRem = combat.defenderRerollsRemaining || 0;
    if (side === 'atk' && atkRem > 0) {
      await sendRerollUI(thread, game, combat, 'attacker');
    } else if (side === 'def' && defRem > 0) {
      await sendRerollUI(thread, game, combat, 'defender');
    } else if (side === 'atk' && defRem > 0) {
      combat.rerollPhase = 'defender';
      await sendRerollUI(thread, game, combat, 'defender');
    } else {
      combat.rerollPhase = null;
      await proceedAfterRerolls(thread, game, combat, ctx);
    }
  }
  saveGames(); return;
}

export async function handleThereIsNoTry(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
  } = ctx;

  // There Is No Try: die picker → face picker → apply, then enter reroll window
  const parts = interaction.customId.split('_');
  // Prefix pattern: there_is_no_try_{die|face|skip}_ → parts[0..4] are the prefix words
  const type = parts[4]; // 'die', 'face', or 'skip'
  const gameId = parts[5];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  const defNum = combat?.defenderPlayerNum ?? opponentPlayerNum(combat?.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, defNum, canActAsPlayer, 'Only the defender may respond.')) return;
  if (!game.pendingThereIsNoTry && type !== 'skip') {
    await interaction.followUp({ content: 'No pending There Is No Try.', ephemeral: true }).catch(() => {}); return;
  }
  const thread = await client.channels.fetch(combat?.combatThreadId).catch(() => null);
  if (type === 'die') {
    const dieIdx = parseInt(parts[6], 10);
    const defDice = combat?.defenseDiceResults || [];
    const die = defDice[dieIdx];
    if (!die) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(() => {}); return; }
    game.pendingThereIsNoTry.pickedDieIdx = dieIdx;
    // Build face options based on die color (white/black)
    const color = die.color || 'white';
    // Standard defense die faces: white: 0/0, 1/0, 1/1, 0/0/dodge; black: 0/0, 1/0, 2/0, 1/1, 0/1, dodge
    const faceOptions = color === 'black'
      ? [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 2, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 1 }, { block: 0, evade: 0, dodge: true }]
      : [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 0, dodge: true }];
    const faceBtns = faceOptions.map((face) =>
      new ButtonBuilder()
        .setCustomId(`there_is_no_try_face_${gameId}_${dieIdx}_${face.block ?? 0}_${face.evade ?? 0}_${face.dodge ? 1 : 0}`)
        .setLabel(`${face.block ?? 0}B/${face.evade ?? 0}E${face.dodge ? '/Dodge' : ''}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    if (thread) await thread.send({ content: `**There Is No Try** — Choose any face for die #${dieIdx + 1} (${color}):`, components: [new ActionRowBuilder().addComponents(...faceBtns.slice(0, 5))] }).catch(() => {});
    saveGames(); return;
  }
  if (type === 'face') {
    const dieIdx = parseInt(parts[6], 10);
    const block = parseInt(parts[7], 10) || 0;
    const evade = parseInt(parts[8], 10) || 0;
    const dodgeFlag = parseInt(parts[9], 10) === 1;
    const defDice = combat?.defenseDiceResults || [];
    if (defDice[dieIdx]) {
      const old = defDice[dieIdx];
      // Apply chosen face; convert any Dodge results on this die to Block+Block+Evade
      defDice[dieIdx] = { ...old, block, evade, dodge: dodgeFlag };
      // Convert Dodge on this die to +2 Block +1 Evade (no dice dodge result)
      if (dodgeFlag) {
        defDice[dieIdx] = { ...old, block: block + 2, evade: evade + 1, dodge: false };
      }
      combat.defenseDiceResults = defDice;
      const newTotal = defDice.reduce((acc, d) => ({ block: acc.block + (d.block ?? 0), evade: acc.evade + (d.evade ?? 0), dodge: acc.dodge || !!d.dodge }), { block: 0, evade: 0, dodge: false });
      combat.defenseRoll = { block: newTotal.block, evade: newTotal.evade, dodge: newTotal.dodge };
      if (thread) await thread.send(`**There Is No Try** — Die set to ${block}B/${evade}E${dodgeFlag ? ' (Dodge→+2B+1E)' : ''}. New defense totals: ${combat.defenseRoll.block} block, ${combat.defenseRoll.evade} evade.`).catch(() => {});
    }
    game.pendingThereIsNoTry = null;
    combat.tintResolved = true;
  } else {
    // Skip
    game.pendingThereIsNoTry = null;
    combat.tintResolved = true;
    if (thread) await thread.send('**There Is No Try** — Skipped.').catch(() => {});
  }
  // After TINT resolves (face set or skipped): enter reroll window
  if (thread && combat) {
    const atkRem = combat.attackerRerollsRemaining || 0;
    const defRem = combat.defenderRerollsRemaining || 0;
    if (atkRem > 0 || defRem > 0) {
      combat.rerollPhase = atkRem > 0 ? 'attacker' : 'defender';
      await sendRerollUI(thread, game, combat, combat.rerollPhase);
    } else {
      combat.rerollPhase = null;
      await proceedAfterRerolls(thread, game, combat, ctx);
    }
  }
  saveGames(); return;
}

export async function handleVetInstincts(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
  } = ctx;

  // Veteran Instincts: attacker adds +1 Hit/Surge, defender adds +1 Block/Evade
  const parts = interaction.customId.split('_');
  const gameId = parts[3];
  const choice = parts[4]; // hit/surge/block/evade/skip
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(() => {}); return; }
  const atkPN = combat.attackerPlayerNum;
  const defPN = opponentPlayerNum(atkPN);
  // Determine phase: block/evade = defense; hit/surge = attack; skip depends on which phase is pending
  const isDefPhase = choice === 'block' || choice === 'evade' || (choice === 'skip' && combat.vetInstinctsAttackApplied);
  const expectedPlayer = isDefPhase ? defPN : atkPN;
  if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayer, canActAsPlayer, `Only P${expectedPlayer} may respond to Veteran Instincts.`)) return;
  const thread = await client.channels.fetch(combat.combatThreadId).catch(() => null);
  if (choice === 'hit') {
    combat.attackRoll = { ...combat.attackRoll, dmg: (combat.attackRoll?.dmg || 0) + 1 };
    combat.vetInstinctsAttackApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Hit added to attack roll.').catch(() => {});
  } else if (choice === 'surge') {
    combat.attackRoll = { ...combat.attackRoll, surge: (combat.attackRoll?.surge || 0) + 1 };
    combat.vetInstinctsAttackApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Surge added to attack roll.').catch(() => {});
  } else if (choice === 'block') {
    combat.defenseRoll = { ...combat.defenseRoll, block: (combat.defenseRoll?.block || 0) + 1 };
    combat.vetInstinctsDefenseApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Block added to defense roll.').catch(() => {});
  } else if (choice === 'evade') {
    combat.defenseRoll = { ...combat.defenseRoll, evade: (combat.defenseRoll?.evade || 0) + 1 };
    combat.vetInstinctsDefenseApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Evade added to defense roll.').catch(() => {});
  } else {
    // skip
    if (!combat.vetInstinctsAttackApplied) {
      combat.vetInstinctsAttackApplied = true;
      if (thread) await thread.send('**Veteran Instincts** — Attack bonus skipped.').catch(() => {});
    } else {
      combat.vetInstinctsDefenseApplied = true;
      if (thread) await thread.send('**Veteran Instincts** — Defense bonus skipped.').catch(() => {});
    }
  }
  if (isDefPhase && thread && combat) {
    // Enter or continue the reroll window using stored pending counts
    const atkRem = combat.viPendingAtkRerolls || 0;
    const defRem = combat.viPendingDefRerolls || 0;
    const hasForced = (combat.forcedRerollQueue || []).length > 0;
    const hasPreRerolls = (combat.pendingPreRerolls || []).length > 0;
    if (atkRem > 0 || defRem > 0 || hasForced || hasPreRerolls) {
      combat.attackerRerollsRemaining = atkRem;
      combat.defenderRerollsRemaining = defRem;
      if (atkRem > 0 || hasPreRerolls) {
        combat.rerollPhase = 'attacker';
        await sendRerollUI(thread, game, combat, 'attacker');
      } else if (hasForced) {
        combat.rerollPhase = 'forced';
        await sendRerollUI(thread, game, combat, 'forced');
      } else {
        combat.rerollPhase = 'defender';
        await sendRerollUI(thread, game, combat, 'defender');
      }
    } else {
      combat.rerollPhase = null;
      await proceedAfterRerolls(thread, game, combat, ctx);
    }
  }
  saveGames(); return;
}

export async function handleHunterProtocol(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendReadyToResolveRolls,
    getAttackerSurgeAbilities, SURGE_LABELS, parseSurgeEffect, getAbility, resolveSurgeAbility, getSurgeAbilityLabel,
    getDcEffects,
  } = ctx;

  const buttonKey = interaction.customId.startsWith('hunter_protocol_trigger_') ? 'hunter_protocol_trigger_' : 'hunter_protocol_skip_';

  // Hunter Protocol: re-trigger the same surge ability once
  const _hpGameId = interaction.customId.replace(/^hunter_protocol_(?:trigger|skip)_/, '');
  const _hpGame = await requireGame(interaction, getGame, _hpGameId);
  if (!_hpGame) return;
  const _hpCombat = _hpGame.pendingCombat;
  if (!_hpCombat || !_hpGame.pendingHunterProtocol) { await interaction.followUp({ content: 'No pending Hunter Protocol.', ephemeral: true }).catch(() => {}); return; }
  const _hpAtk = _hpCombat.attackerPlayerNum;
  if (!await requirePlayer(interaction, _hpGame, interaction.user.id, _hpAtk, canActAsPlayer, 'Only the attacker may respond to Hunter Protocol.')) return;
  const _hpThread = await client.channels.fetch(_hpCombat.combatThreadId).catch(() => null);
  const { key: _hpKey, cost: _hpCost } = _hpGame.pendingHunterProtocol;
  _hpGame.pendingHunterProtocol = null;
  if (buttonKey === 'hunter_protocol_trigger_' && _hpKey) {
    const _hpResolveSurge = resolveSurgeAbility || parseSurgeEffect;
    const _hpMod = _hpResolveSurge ? _hpResolveSurge(_hpKey) : {};
    _hpCombat.surgeDamage = (_hpCombat.surgeDamage || 0) + (_hpMod.damage ?? 0);
    _hpCombat.surgePierce = (_hpCombat.surgePierce || 0) + (_hpMod.pierce ?? 0);
    _hpCombat.surgeAccuracy = (_hpCombat.surgeAccuracy || 0) + (_hpMod.accuracy ?? 0);
    if (_hpMod.conditions?.length) _hpCombat.surgeConditions = (_hpCombat.surgeConditions || []).concat(_hpMod.conditions);
    _hpCombat.surgeBlast = (_hpCombat.surgeBlast || 0) + (_hpMod.blast ?? 0);
    _hpCombat.surgeRecover = (_hpCombat.surgeRecover || 0) + (_hpMod.recover ?? 0);
    _hpCombat.surgeCleave = (_hpCombat.surgeCleave || 0) + (_hpMod.cleave ?? 0);
    _hpCombat.surgeRemaining = Math.max(0, (_hpCombat.surgeRemaining || 0) - _hpCost);
    // Track surge spend count for Overload compatibility
    if (!_hpCombat.surgeSpentCount) _hpCombat.surgeSpentCount = {};
    const _hpSurgeList = getAttackerSurgeAbilities(_hpCombat);
    const _hpKeyIdx = _hpSurgeList.indexOf(_hpKey);
    if (_hpKeyIdx >= 0) _hpCombat.surgeSpentCount[_hpKeyIdx] = (_hpCombat.surgeSpentCount[_hpKeyIdx] || 0) + 1;
    const _hpLabel = (SURGE_LABELS && SURGE_LABELS[_hpKey]) || getSurgeAbilityLabel?.(_hpKey) || _hpKey;
    if (_hpThread) await _hpThread.send(`**Hunter Protocol** — Triggered **${_hpLabel}** again (cost: ${_hpCost}). Surge remaining: ${_hpCombat.surgeRemaining}`).catch(() => {});
  } else {
    if (_hpThread) await _hpThread.send('**Hunter Protocol** — Skipped second trigger.').catch(() => {});
  }
  // Continue surge flow
  if ((_hpCombat.surgeRemaining || 0) <= 0) {
    _hpCombat.surgeRemaining = 0;
    if (_hpThread) await sendReadyToResolveRolls(_hpThread, _hpGameId);
  } else {
    const _hpSurgeAbilities = getAttackerSurgeAbilities(_hpCombat);
    const _hpRemaining = _hpCombat.surgeRemaining || 0;
    // Overload (Rebel Saboteur): allow same surge to be used twice
    const _hpAtkEff = getDcEffects()?.[_hpCombat.attackerDcName] || getDcEffects()?.[((_hpCombat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, ''))];
    const _hpOverload = (_hpAtkEff?.specialAbilityIds || []).includes('overload_saboteur');
    const _hpMaxUses = _hpOverload ? 2 : 1;
    const _hpRows = [];
    for (let _hi = 0; _hi < _hpSurgeAbilities.length; _hi++) {
      const _hpSkey = _hpSurgeAbilities[_hi];
      const _hpScost = (_hpSkey?.startsWith?.('double:') ? 2 : (getAbility?.(_hpSkey)?.surgeCost ?? 1));
      if (_hpScost > _hpRemaining) continue;
      if (((_hpCombat.surgeSpentCount || {})[_hi] || 0) >= _hpMaxUses) continue;
      const _hpSlabel = ((SURGE_LABELS && SURGE_LABELS[_hpSkey]) || getSurgeAbilityLabel?.(_hpSkey) || _hpSkey).slice(0, 80);
      _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_${_hi}`).setLabel((_hpScost > 1 ? `Spend ${_hpScost} surge: ${_hpSlabel}` : `Spend 1 surge: ${_hpSlabel}`).slice(0, 80)).setStyle(ButtonStyle.Secondary));
    }
    if (_hpCombat.attackerConds?.includes('Bleed') && !_hpCombat.surgePreventBleed) {
      _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_bleed_prevention`).setLabel('Spend 1 Surge — Prevent Bleed').setStyle(ButtonStyle.Secondary));
    }
    _hpRows.push(new ButtonBuilder().setCustomId(`combat_surge_${_hpGameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
    if (_hpThread) await _hpThread.send({ content: `**Spend surge?** **${_hpRemaining}** surge left.`, components: [new ActionRowBuilder().addComponents(_hpRows.slice(0, 5))] }).catch(() => {});
  }
  saveGames(); return;
}

/**
 * Handle strike_me_down_yes_ / strike_me_down_no_ buttons.
 * Strike Me Down (Obi-Wan): when attack declared on Obi-Wan, may reduce VP cost by 3 and be defeated, ending the attack.
 */
export async function handleStrikeMeDown(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    dcHealthState, findDcMessageIdForFigure,
    removeFigurePosition, logGameAction, isGroupDefeated,
    updateActivationsMessage, getDcStats,
    checkWinConditions,
  } = ctx;

  const isYes = interaction.customId.startsWith('strike_me_down_yes_');
  const gameId = interaction.customId.replace(/^strike_me_down_(?:yes|no)_/, '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingStrikeMeDown) {
    await interaction.followUp({ content: 'No pending Strike Me Down.', ephemeral: true }).catch(() => {});
    return;
  }
  const smd = game.pendingStrikeMeDown;
  const defPN = smd.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only the defender (Obi-Wan\'s owner) may respond.')) return;
  await interaction.deferUpdate().catch(() => {});

  const thread = await client.channels.fetch(smd.combatThreadId).catch(() => null);

  // Clear the buttons from the picker message
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(() => {});

  if (isYes) {
    // Defeat Obi-Wan: set HP to 0, remove position
    const fk = smd.defenderFigureKey;
    const fkMatch = fk.match(/-(\d+)-(\d+)$/);
    const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
    const targetMsgId = findDcMessageIdForFigure?.(gameId, defPN, fk);

    if (targetMsgId && dcHealthState) {
      const healthState = dcHealthState.get(targetMsgId) || [];
      const entry = healthState[figIdx];
      if (entry) {
        const curHp = entry[0];
        if (curHp > 0) reduceHp(dcHealthState, game, targetMsgId, figIdx, curHp, defPN);
      }
    }

    // Remove position
    if (removeFigurePosition) removeFigurePosition(game, defPN, fk);

    // Clean up conditions
    if (game.figureConditions?.[fk]) delete game.figureConditions[fk];

    // Award VP (reduced by 3, min 0) to the attacker
    const dcName = dcNameFromFigureKey(fk);
    const stats = getDcStats?.(dcName);
    const baseCost = stats?.cost ?? 5;
    const reducedCost = Math.max(0, baseCost - 3);
    const atkPN = smd.attackerPlayerNum;
    if (reducedCost > 0) awardKillVp(game, atkPN, reducedCost);

    // Cancel the pending combat (attack ends)
    game.pendingCombat = null;

    // Check if group fully defeated → decrement activations
    if (targetMsgId) {
      const dcMsgIds = getDcMessageIds(game, defPN);
      const dcIdx = dcMsgIds?.indexOf(targetMsgId) ?? -1;
      if (dcIdx >= 0 && isGroupDefeated?.(game, defPN, dcIdx)) {
        if (updateActivationsMessage) await updateActivationsMessage(game, defPN, client);
      }
    }

    if (thread) await thread.send(`**Strike Me Down** — Obi-Wan is defeated (VP cost reduced by 3: ${reducedCost} VP awarded to attacker). Attack ended.`).catch(() => {});
    if (logGameAction) await logGameAction(game, client, `**Strike Me Down** — Obi-Wan chose to be defeated. Attacker gains ${reducedCost} VP (cost reduced by 3). Attack cancelled.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});

    // Check win conditions
    if (checkWinConditions) await checkWinConditions(game, client);
  } else {
    if (thread) await thread.send('**Strike Me Down** — Declined. Attack continues normally.').catch(() => {});
  }

  game.pendingStrikeMeDown = null;
  saveGames();
}

/**
 * Handle slow_on_draw_yes_ / slow_on_draw_no_ buttons.
 * Slow on the Draw (Greedo): defender may interrupt to attack Greedo before the current attack resolves.
 */
export async function handleSlowOnTheDraw(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    logGameAction,
  } = ctx;

  const isYes = interaction.customId.startsWith('slow_on_draw_yes_');
  const gameId = interaction.customId.replace(/^slow_on_draw_(?:yes|no)_/, '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingSlowOnTheDraw) {
    await interaction.followUp({ content: 'No pending Slow on the Draw.', ephemeral: true }).catch(() => {});
    return;
  }
  const sotd = game.pendingSlowOnTheDraw;
  const defPN = sotd.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only the defender may respond.')) return;
  await interaction.deferUpdate().catch(() => {});

  const thread = await client.channels.fetch(sotd.combatThreadId).catch(() => null);

  // Clear the buttons from the picker message
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(() => {});

  if (isYes) {
    // Queue a free attack for the defender targeting Greedo
    // Store the current combat state so it can resume after the free attack
    game.slowOnTheDrawInterrupt = {
      suspendedCombat: game.pendingCombat,
      attackerFigureKey: sotd.attackerFigureKey,
      attackerPlayerNum: sotd.attackerPlayerNum,
      defenderPlayerNum: defPN,
    };
    // Clear pendingCombat so the defender can start a new attack
    game.pendingCombat = null;

    const defOwnerId = getPlayerId(game, defPN);
    if (thread) await thread.send({ content: `**Slow on the Draw** — <@${defOwnerId}>, you may now perform an attack targeting **Greedo**. Use your DC's Attack action. After the interrupt attack resolves, click **Resume Original Attack** below to continue.`, allowedMentions: { users: [defOwnerId] } }).catch(() => {});

    // Post a resume button in the thread for after the interrupt attack
    const resumeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`slow_on_draw_resume_${gameId}`)
        .setLabel('Resume Original Attack')
        .setStyle(ButtonStyle.Success),
    );
    if (thread) await thread.send({ content: 'When the interrupt attack is complete (or if you choose not to attack), click below to resume Greedo\'s attack.', components: [resumeRow] }).catch(() => {});

    if (logGameAction) await logGameAction(game, client, `**Slow on the Draw** — Defender interrupts to attack Greedo first.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  } else {
    if (thread) await thread.send('**Slow on the Draw** — Declined. Attack continues normally.').catch(() => {});
  }

  game.pendingSlowOnTheDraw = null;
  saveGames();
}

/**
 * Handle slow_on_draw_resume_ button: restore the suspended combat after the interrupt attack.
 */
export async function handleSlowOnTheDrawResume(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    logGameAction,
  } = ctx;

  const gameId = interaction.customId.replace('slow_on_draw_resume_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.slowOnTheDrawInterrupt) {
    await interaction.followUp({ content: 'No suspended Slow on the Draw combat.', ephemeral: true }).catch(() => {});
    return;
  }
  // Either player can click resume
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can resume.', ephemeral: true }).catch(() => {});
    return;
  }
  await interaction.deferUpdate().catch(() => {});

  // Clear the resume button
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(() => {});

  // Restore the suspended combat
  game.pendingCombat = game.slowOnTheDrawInterrupt.suspendedCombat;
  const combatThreadId = game.pendingCombat?.combatThreadId;
  game.slowOnTheDrawInterrupt = null;

  const thread = combatThreadId ? await client.channels.fetch(combatThreadId).catch(() => null) : null;
  if (thread) await thread.send('**Slow on the Draw** — Interrupt complete. Greedo\'s attack resumes.').catch(() => {});
  if (logGameAction) await logGameAction(game, client, '**Slow on the Draw** — Interrupt resolved. Original attack resumed.', { phase: 'ROUND', icon: 'card' }).catch(() => {});

  saveGames();
}

/**
 * Power Converter (Saska Teft): once per round, while a friendly figure with a Device token is attacking,
 * may reroll 1 attack die. Before rerolling, you may replace that die with another attack die of any color.
 *
 * Button prefixes: power_converter_approve_, power_converter_skip_, power_converter_die_, power_converter_color_
 */
export async function handlePowerConverter(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
    rollSingleAttackDie, recalcAttackTotals,
    logGameAction,
  } = ctx;
  const customId = interaction.customId;
  const isApprove = customId.startsWith('power_converter_approve_');
  const isSkip = customId.startsWith('power_converter_skip_');
  const isDie = customId.startsWith('power_converter_die_');
  const isColor = customId.startsWith('power_converter_color_');

  let gameId;
  if (isApprove) gameId = customId.replace('power_converter_approve_', '');
  else if (isSkip) gameId = customId.replace('power_converter_skip_', '');
  else if (isDie) gameId = customId.split('_')[3]; // power_converter_die_{gameId}_{index}
  else if (isColor) gameId = customId.split('_')[3]; // power_converter_color_{gameId}_{color}

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(() => {}); return; }
  const atkPN = combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, atkPN, canActAsPlayer, 'Only the attacker may respond to Power Converter.')) return;
  await interaction.deferUpdate().catch(() => {});
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(() => {});

  const thread = await client.channels.fetch(combat.combatThreadId).catch(() => null);

  // Helper: resume normal reroll flow from stored pending counts
  const _resumeRerollFlow = async () => {
    const atkRem = combat.pcPendingAtkRerolls || 0;
    const defRem = combat.pcPendingDefRerolls || 0;
    const defPN = opponentPlayerNum(atkPN);
    // Check Veteran Instincts defense (may have been pending when PC interrupted)
    if (game.vetInstinctsActiveThisActivation?.[defPN] && !combat.vetInstinctsDefenseApplied && thread) {
      combat.viPendingAtkRerolls = atkRem;
      combat.viPendingDefRerolls = defRem;
      const _viRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Veteran Instincts** — <@${game[`player${defPN}Id`] ?? ''}> add +1 Block or +1 Evade to the defense roll?`, components: [_viRow] }).catch(() => {});
      return; // VI handler will resume reroll flow
    }
    const hasForced = (combat.forcedRerollQueue || []).length > 0;
    combat.attackerRerollsRemaining = atkRem;
    combat.defenderRerollsRemaining = defRem;
    if (!combat.pendingPreRerolls) combat.pendingPreRerolls = [];
    if (atkRem > 0 || defRem > 0 || hasForced) {
      if (atkRem > 0) {
        combat.rerollPhase = 'attacker';
        if (thread) await sendRerollUI(thread, game, combat, 'attacker');
      } else if (hasForced) {
        combat.rerollPhase = 'forced';
        if (thread) await sendRerollUI(thread, game, combat, 'forced');
      } else {
        combat.rerollPhase = 'defender';
        if (thread) await sendRerollUI(thread, game, combat, 'defender');
      }
    } else {
      combat.rerollPhase = null;
      if (thread) await proceedAfterRerolls(thread, game, combat, ctx);
    }
  };

  if (isSkip) {
    game.pendingPowerConverter = null;
    if (thread) await thread.send('**Power Converter** — Skipped.').catch(() => {});
    await _resumeRerollFlow();
    saveGames();
    return;
  }

  if (isApprove) {
    game.pendingPowerConverter = null;
    // Show die picker in combat thread
    const dice = combat.attackDiceResults || [];
    if (!dice.length || !thread) {
      await _resumeRerollFlow();
      saveGames();
      return;
    }
    const buttons = [];
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i];
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`power_converter_die_${gameId}_${i}`)
          .setLabel(`${d.color} #${i + 1}: ${d.acc}a/${d.dmg}d/${d.surge}s`)
          .setStyle(ButtonStyle.Secondary)
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`power_converter_skip_${gameId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger)
    );
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    await thread.send({ content: `⚡ **Power Converter** — <@${game[`player${atkPN}Id`] ?? ''}> Pick an attack die to reroll (you may swap its color first):`, components: rows.slice(0, 5) }).catch(() => {});
    saveGames();
    return;
  }

  if (isDie) {
    const dieIdx = parseInt(customId.split('_')[4], 10);
    combat.powerConverterDieIndex = dieIdx;
    if (!thread) { await _resumeRerollFlow(); saveGames(); return; }
    // Show color swap options
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_red`).setLabel('Swap to Red').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_blue`).setLabel('Swap to Blue').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_green`).setLabel('Swap to Green').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_yellow`).setLabel('Swap to Yellow').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_skip`).setLabel('Keep Current').setStyle(ButtonStyle.Secondary),
    );
    const d = (combat.attackDiceResults || [])[dieIdx];
    await thread.send({ content: `⚡ **Power Converter** — Replace **${d?.color || '?'} #${dieIdx + 1}** with a different color die, or keep current:`, components: [row] }).catch(() => {});
    saveGames();
    return;
  }

  if (isColor) {
    const colorChoice = customId.split('_')[4]; // red/blue/green/yellow/skip
    const dieIdx = combat.powerConverterDieIndex ?? 0;
    const dice = combat.attackDiceResults || [];
    if (dieIdx >= 0 && dieIdx < dice.length) {
      const oldDie = dice[dieIdx];
      const newColor = colorChoice === 'skip' ? oldDie.color : colorChoice;
      // Roll the new die
      const newDie = rollSingleAttackDie(newColor);
      dice[dieIdx] = newDie;
      combat.attackDiceResults = dice;
      const totals = recalcAttackTotals(dice);
      combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
      game.powerConverterUsedThisRound = true;
      const swapMsg = colorChoice !== 'skip' && newColor !== oldDie.color ? ` (swapped ${oldDie.color} → ${newColor})` : '';
      if (thread) await thread.send(`⚡ **Power Converter** — Rerolled${swapMsg} #${dieIdx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`).catch(() => {});
      if (logGameAction) await logGameAction(game, client, `⚡ **Power Converter** — Rerolled attack die${swapMsg}.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
    }
    delete combat.powerConverterDieIndex;
    await _resumeRerollFlow();
    saveGames();
    return;
  }
}
