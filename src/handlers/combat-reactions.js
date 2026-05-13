import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';

/**
 * Local shim (alexanbv 2026-05-13): count unused step-3 reroll
 * abilities on combat.rerollAbilities. Same logic as the helper in
 * handlers/combat.js — duplicated here to avoid a cross-file import
 * cycle (combat.js already imports from combat-reactions.js).
 */
function _countUnusedAttackerRerollAbilitiesShim(combat) {
  const abilities = combat?.rerollAbilities || {};
  let count = 0;
  for (const key of ['twinSabers', 'resourceful', 'shrewdScoundrel', 'trained']) {
    if (abilities[key] && !abilities[key].used) count += 1;
  }
  return count;
}
import { resolvePendingCombat, pushNestedCombat } from '../game/combat-stack.js';
import { opponentPlayerNum, getPlayerId, getDcList, getCcHand, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { reduceHp, dcNameFromFigureKey, awardKillVp, applyCondition, isConditionImmune, checkNefariousGains } from '../game/index.js';
import { getDcEffect } from '../game/dc-helpers.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { removeForceExhaustionDie } from '../game/force-exhaustion-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchCombatThread, sanitizeMentions } from '../discord/channel-helpers.js';
import { sendPowerTokenOverflowUI, sendModsYn } from './combat.js';
import { clearPendingIllicitArms, clearPendingThereIsNoTry, clearPendingPowerConverter, clearPendingToughLuck, clearPendingStrikeMeDown, clearPendingSlowOnTheDraw, clearPendingForceExhaustion, clearPendingHunterProtocol } from '../game/interrupts.js';

export async function handleToughLuck(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    recalcAttackTotals, recalcDefenseTotals,
    sendRerollUI, proceedAfterRerolls,
    logGameAction,
  } = ctx;

  const buttonKey = interaction.customId.startsWith('tough_luck_remove_') ? 'tough_luck_remove_' : 'tough_luck_skip_';

  // Tough Luck: remove a rerolled die or skip, then continue reroll flow
  const parts = splitCustomId(interaction.customId, buttonKey);
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingToughLuck) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(discordCatch); return; }
  const tlData = game.pendingToughLuck;
  const combat = game.pendingCombat;
  const responder = game.toughLuckPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, responder, canActAsPlayer, 'Only the Tough Luck player may respond.')) return;
  if (buttonKey === 'tough_luck_remove_') {
    const dieIdx = parseInt(parts[1], 10);
    if (tlData.side === 'atk' && combat?.attackDiceResults?.[dieIdx]) {
      const die = combat.attackDiceResults[dieIdx];
      combat.attackDiceResults.splice(dieIdx, 1);
      // Fix stale reroll tracking: removed die's index is gone, higher indices shift down
      if (combat.attackerRerolledIndices) {
        combat.attackerRerolledIndices = combat.attackerRerolledIndices
          .filter(i => i !== dieIdx)
          .map(i => i > dieIdx ? i - 1 : i);
      }
      const t = recalcAttackTotals(combat.attackDiceResults);
      combat.attackRoll = { acc: t.acc, dmg: t.dmg, surge: t.surge };
      await logGameAction(game, client, `**Tough Luck** — Removed rerolled ${die.color} attack die. New totals: ${t.acc} acc, ${t.dmg} dmg, ${t.surge} surge.`, { phase: 'ROUND', icon: 'card' });
    } else if (tlData.side === 'def' && combat?.defenseDiceResults?.[dieIdx]) {
      const die = combat.defenseDiceResults[dieIdx];
      combat.defenseDiceResults.splice(dieIdx, 1);
      // Fix stale reroll tracking: removed die's index is gone, higher indices shift down
      if (combat.defenderRerolledIndices) {
        combat.defenderRerolledIndices = combat.defenderRerolledIndices
          .filter(i => i !== dieIdx)
          .map(i => i > dieIdx ? i - 1 : i);
      }
      const t = recalcDefenseTotals(combat.defenseDiceResults);
      combat.defenseRoll = { block: t.block, evade: t.evade, dodge: t.dodge };
      await logGameAction(game, client, `**Tough Luck** — Removed rerolled ${die.color} defense die. New totals: ${t.block} block, ${t.evade} evade.`, { phase: 'ROUND', icon: 'card' });
    }
  } else {
    await logGameAction(game, client, '**Tough Luck** — Skipped.', { phase: 'ROUND', icon: 'card' });
  }
  clearPendingToughLuck(game);
  // Continue reroll flow
  const thread = await fetchCombatThread(client, combat?.combatThreadId);
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
  saveGames(game.gameId); return;
}

export async function handleThereIsNoTry(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
  } = ctx;

  // There Is No Try: die picker → face picker → apply, then enter reroll window
  const type = interaction.customId.startsWith('there_is_no_try_die_') ? 'die'
    : interaction.customId.startsWith('there_is_no_try_face_') ? 'face' : 'skip';
  const parts = splitCustomId(interaction.customId, `there_is_no_try_${type}_`);
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  const defNum = combat?.defenderPlayerNum ?? opponentPlayerNum(combat?.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, defNum, canActAsPlayer, 'Only the defender may respond.')) return;
  if (!game.pendingThereIsNoTry && type !== 'skip') {
    await interaction.followUp({ content: 'No pending There Is No Try.', ephemeral: true }).catch(discordCatch); return;
  }
  const thread = await fetchCombatThread(client, combat?.combatThreadId);
  if (type === 'die') {
    const dieIdx = parseInt(parts[1], 10);
    const defDice = combat?.defenseDiceResults || [];
    const die = defDice[dieIdx];
    if (!die) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(discordCatch); return; }
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
    if (thread) await thread.send({ content: `**There Is No Try** — Choose any face for die #${dieIdx + 1} (${color}):`, components: [new ActionRowBuilder().addComponents(...faceBtns.slice(0, 5))] }).catch(discordCatch);
    saveGames(game.gameId); return;
  }
  if (type === 'face') {
    const dieIdx = parseInt(parts[1], 10);
    const block = parseInt(parts[2], 10) || 0;
    const evade = parseInt(parts[3], 10) || 0;
    const dodgeFlag = parseInt(parts[4], 10) === 1;
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
      const newTotal = defDice.reduce((acc, d) => ({ block: acc.block + (d.block ?? 0), evade: acc.evade + (d.evade ?? 0), dodge: acc.dodge + (d.dodge ? 1 : 0) }), { block: 0, evade: 0, dodge: 0 });
      combat.defenseRoll = { block: newTotal.block, evade: newTotal.evade, dodge: newTotal.dodge };
      if (thread) await thread.send(`**There Is No Try** — Die set to ${block}B/${evade}E${dodgeFlag ? ' (Dodge→+2B+1E)' : ''}. New defense totals: ${combat.defenseRoll.block} block, ${combat.defenseRoll.evade} evade.`).catch(discordCatch);
    }
    clearPendingThereIsNoTry(game);
    combat.tintResolved = true;
  } else {
    // Skip
    clearPendingThereIsNoTry(game);
    combat.tintResolved = true;
    if (thread) await thread.send('**There Is No Try** — Skipped.').catch(discordCatch);
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
  saveGames(game.gameId); return;
}

export async function handleVetInstincts(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
  } = ctx;

  // Veteran Instincts: attacker adds +1 Hit/Surge, defender adds +1 Block/Evade
  const parts = splitCustomId(interaction.customId, 'vet_instincts_pick_');
  const gameId = parts[0];
  const choice = parts[1]; // hit/surge/block/evade/skip
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(discordCatch); return; }
  const atkPN = combat.attackerPlayerNum;
  const defPN = opponentPlayerNum(atkPN);
  // Determine phase: block/evade = defense; hit/surge = attack; skip depends on which phase is pending
  const isDefPhase = choice === 'block' || choice === 'evade' || (choice === 'skip' && combat.vetInstinctsAttackApplied);
  const expectedPlayer = isDefPhase ? defPN : atkPN;
  if (!await requirePlayer(interaction, game, interaction.user.id, expectedPlayer, canActAsPlayer, `Only P${expectedPlayer} may respond to Veteran Instincts.`)) return;
  const thread = await fetchCombatThread(client, combat.combatThreadId);
  if (choice === 'hit') {
    combat.attackRoll = { ...combat.attackRoll, dmg: (combat.attackRoll?.dmg || 0) + 1 };
    combat.vetInstinctsAttackApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Damage added to attack roll.').catch(discordCatch);
  } else if (choice === 'surge') {
    combat.attackRoll = { ...combat.attackRoll, surge: (combat.attackRoll?.surge || 0) + 1 };
    combat.vetInstinctsAttackApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Surge added to attack roll.').catch(discordCatch);
  } else if (choice === 'block') {
    combat.defenseRoll = { ...combat.defenseRoll, block: (combat.defenseRoll?.block || 0) + 1 };
    combat.vetInstinctsDefenseApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Block added to defense roll.').catch(discordCatch);
  } else if (choice === 'evade') {
    combat.defenseRoll = { ...combat.defenseRoll, evade: (combat.defenseRoll?.evade || 0) + 1 };
    combat.vetInstinctsDefenseApplied = true;
    if (thread) await thread.send('**Veteran Instincts** — +1 Evade added to defense roll.').catch(discordCatch);
  } else {
    // skip
    if (!combat.vetInstinctsAttackApplied) {
      combat.vetInstinctsAttackApplied = true;
      if (thread) await thread.send('**Veteran Instincts** — Attack bonus skipped.').catch(discordCatch);
    } else {
      combat.vetInstinctsDefenseApplied = true;
      if (thread) await thread.send('**Veteran Instincts** — Defense bonus skipped.').catch(discordCatch);
    }
  }
  if (isDefPhase && thread && combat) {
    // Enter or continue the reroll window using stored pending counts
    const atkRem = combat.viPendingAtkRerolls || 0;
    const defRem = combat.viPendingDefRerolls || 0;
    const hasForced = (combat.forcedRerollQueue || []).length > 0;
    // Per alexanbv 2026-05-13: step-3 reroll abilities live on
    // combat.rerollAbilities; the bucket renderer surfaces unused
    // entries as "Use X" buttons. Treat any unused ability as a
    // reason to open the attacker bucket.
    const hasStep3Abilities = _countUnusedAttackerRerollAbilitiesShim(combat) > 0;
    if (atkRem > 0 || defRem > 0 || hasForced || hasStep3Abilities) {
      combat.attackerRerollsRemaining = atkRem;
      combat.defenderRerollsRemaining = defRem;
      // G12: ensure per-die reroll tracking arrays exist
      if (!combat.attackerRerolledIndices) combat.attackerRerolledIndices = [];
      if (!combat.defenderRerolledIndices) combat.defenderRerolledIndices = [];
      if (atkRem > 0 || hasStep3Abilities) {
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
  } else if (thread && combat) {
    // Attacker-side Vet Instincts resolved — re-enter the modifier step
    // (per CRR step 4 migration 2026-05-04). sendModsYn will check for
    // Guidance Systems next, then fall through to the mods_yn YES/NO.
    await sendModsYn(thread, game, combat, 'attacker');
  }
  saveGames(game.gameId); return;
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
  const _hpGameId = parseCustomId(interaction.customId, buttonKey);
  const _hpGame = await requireGame(interaction, getGame, _hpGameId);
  if (!_hpGame) return;
  const _hpCombat = _hpGame.pendingCombat;
  if (!_hpCombat || !_hpGame.pendingHunterProtocol) { await interaction.followUp({ content: 'No pending Hunter Protocol.', ephemeral: true }).catch(discordCatch); return; }
  const _hpAtk = _hpCombat.attackerPlayerNum;
  if (!await requirePlayer(interaction, _hpGame, interaction.user.id, _hpAtk, canActAsPlayer, 'Only the attacker may respond to Hunter Protocol.')) return;
  const _hpThread = await fetchCombatThread(client, _hpCombat.combatThreadId);
  const { key: _hpKey, cost: _hpCost } = _hpGame.pendingHunterProtocol;
  clearPendingHunterProtocol(_hpGame);
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
    if (_hpThread) await _hpThread.send(`**Hunter Protocol** — Triggered **${_hpLabel}** again (cost: ${_hpCost}). Surge remaining: ${_hpCombat.surgeRemaining}`).catch(discordCatch);
  } else {
    if (_hpThread) await _hpThread.send('**Hunter Protocol** — Skipped second trigger.').catch(discordCatch);
  }
  // Check for power token overflow before resuming surge
  if (_hpGame.pendingPowerTokenOverflow?.length > 0) {
    _hpGame.pendingSurgeOverflow = { combatThreadId: _hpCombat.combatThreadId, attackerPlayerNum: _hpAtk };
    if (_hpThread) await sendPowerTokenOverflowUI(_hpGame, _hpGameId, _hpThread, _hpAtk, saveGames);
    return;
  }
  // Continue surge flow
  if ((_hpCombat.surgeRemaining || 0) <= 0) {
    _hpCombat.surgeRemaining = 0;
    if (_hpThread) await sendReadyToResolveRolls(_hpThread, _hpGameId, _hpGame, ctx);
  } else {
    const _hpSurgeAbilities = getAttackerSurgeAbilities(_hpCombat);
    const _hpRemaining = _hpCombat.surgeRemaining || 0;
    // Overload (Rebel Saboteur): allow same surge to be used twice
    const _hpAtkEff = getDcEffect(_hpCombat.attackerDcName);
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
    if (_hpThread) await _hpThread.send({ content: `**Spend surge?** **${_hpRemaining}** surge left.`, components: [new ActionRowBuilder().addComponents(_hpRows.slice(0, 5))] }).catch(discordCatch);
  }
  saveGames(_hpGame.gameId); return;
}

/**
 * Handle strike_me_down_yes_ / strike_me_down_no_ buttons.
 * Strike Me Down (Obi-Wan): when attack declared on Obi-Wan, may reduce VP cost by 3 and be defeated, ending the attack.
 */
export async function handleStrikeMeDown(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    dcHealthState, findDcMessageIdForFigure,
    logGameAction, getDcStats,
    processFigureDefeat,
  } = ctx;

  const isYes = interaction.customId.startsWith('strike_me_down_yes_');
  const gameId = parseCustomId(interaction.customId, isYes ? 'strike_me_down_yes_' : 'strike_me_down_no_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingStrikeMeDown) {
    await interaction.followUp({ content: 'No pending Strike Me Down.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const smd = game.pendingStrikeMeDown;
  const defPN = smd.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only the defender (Obi-Wan\'s owner) may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);

  const thread = await fetchCombatThread(client, smd.combatThreadId);

  // Clear the buttons from the picker message
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  if (isYes) {
    // Defeat Obi-Wan: set HP to 0 in embed
    const fk = smd.defenderFigureKey;
    const fkMatch = fk.match(/-(\d+)-(\d+)$/);
    const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
    const targetMsgId = findDcMessageIdForFigure?.(gameId, defPN, fk);

    if (targetMsgId && dcHealthState) {
      const healthState = dcHealthState.get(targetMsgId) || [];
      const entry = healthState[figIdx];
      if (entry) {
        const curHp = entry[0];
        if (curHp > 0) {
          await _applyDamage(game, { dcHealthState, logGameAction, client }, {
            figureKey: fk, msgId: targetMsgId, figIndex: figIdx,
            amount: curHp, controllerPlayerNum: defPN,
            source: 'Strike Me Down',
          });
        }
      }
    }

    // Strike Me Down special VP: reduced by 3, min 0
    const dcName = dcNameFromFigureKey(fk);
    const stats = getDcStats?.(dcName);
    const baseCost = stats?.cost ?? 5;
    const reducedCost = Math.max(0, baseCost - 3);
    const atkPN = smd.attackerPlayerNum;
    if (reducedCost > 0) awardKillVp(game, atkPN, reducedCost);

    // Cancel the pending combat (attack ends)
    resolvePendingCombat(game);

    if (thread) await thread.send(`**Strike Me Down** — Obi-Wan is defeated (VP cost reduced by 3: ${reducedCost} VP awarded to attacker). Attack ended.`).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, `**Strike Me Down** — Obi-Wan chose to be defeated. Attacker gains ${reducedCost} VP (cost reduced by 3). Attack cancelled.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);

    // Route through centralized defeat handler with awardVp: false (VP already awarded above with special reduction).
    // Handles: position removal, conditions cleanup, CC attachments, passive redraws,
    // Nefarious Gains, Hunt Dissent, Heroic Effort, Scavenged Weaponry, activation decrement, win conditions.
    if (processFigureDefeat) {
      await processFigureDefeat(game, {
        defeatedPlayerNum: defPN,
        figureKey: fk,
        attackerPlayerNum: atkPN,
        msgId: targetMsgId,
        dcName,
        displayName: dcName,
        source: 'Strike Me Down',
        awardVp: false,
      });
    }
  } else {
    if (thread) await thread.send('**Strike Me Down** — Declined. Attack continues normally.').catch(discordCatch);
  }

  clearPendingStrikeMeDown(game);
  saveGames(game.gameId);
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
  const gameId = parseCustomId(interaction.customId, isYes ? 'slow_on_draw_yes_' : 'slow_on_draw_no_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingSlowOnTheDraw) {
    await interaction.followUp({ content: 'No pending Slow on the Draw.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const sotd = game.pendingSlowOnTheDraw;
  const defPN = sotd.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only the defender may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);

  const thread = await fetchCombatThread(client, sotd.combatThreadId);

  // Clear the buttons from the picker message
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  if (isYes) {
    // Architectural fix (alexanbv 2026-05-09): use the canonical
    // combat-stack push/pop instead of a SoTD-specific side channel.
    // pushNestedCombat saves the outer (Greedo→Migs) onto game.combatStack
    // and clears game.pendingCombat. The defender then declares the
    // interrupt attack via the standard Attack action — combat.js attack-
    // declare sees pendingCombat=null and runs as a fresh frame; when
    // inner-1 finishes, finishCombatResolution → resolvePendingCombat
    // pops the outer back automatically. No Resume button needed.
    pushNestedCombat(game);

    const defOwnerId = getPlayerId(game, defPN);
    if (thread) await thread.send(sanitizeMentions({ content: `**Slow on the Draw** — <@${defOwnerId}>, you may now perform an attack targeting **Greedo**. Use your DC's Attack action. Greedo's original attack will resume automatically once the interrupt attack resolves.`, allowedMentions: { users: [defOwnerId] } })).catch(discordCatch);

    if (logGameAction) await logGameAction(game, client, `**Slow on the Draw** — Defender interrupts to attack Greedo first.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  } else {
    if (thread) await thread.send('**Slow on the Draw** — Declined. Attack continues normally.').catch(discordCatch);
  }

  clearPendingSlowOnTheDraw(game);
  saveGames(game.gameId);
}

/**
 * Handle slow_on_draw_resume_ button: restore the suspended combat after the interrupt attack.
 */
export async function handleSlowOnTheDrawResume(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    logGameAction,
  } = ctx;

  const gameId = parseCustomId(interaction.customId, 'slow_on_draw_resume_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.slowOnTheDrawInterrupt) {
    await interaction.followUp({ content: 'No suspended Slow on the Draw combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Either player can click resume
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can resume.', ephemeral: true }).catch(discordCatch);
    return;
  }
  await interaction.deferUpdate().catch(discordCatch);

  // Clear the resume button
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  // Restore the suspended combat
  game.pendingCombat = game.slowOnTheDrawInterrupt.suspendedCombat;
  const combatThreadId = game.pendingCombat?.combatThreadId;
  game.slowOnTheDrawInterrupt = null;

  const thread = await fetchCombatThread(client, combatThreadId);
  if (thread) await thread.send('**Slow on the Draw** — Interrupt complete. Greedo\'s attack resumes.').catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, '**Slow on the Draw** — Interrupt resolved. Original attack resumed.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);

  saveGames(game.gameId);
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
  if (isApprove) gameId = parseCustomId(customId, 'power_converter_approve_');
  else if (isSkip) gameId = parseCustomId(customId, 'power_converter_skip_');
  else if (isDie) gameId = customId.split('_')[3]; // power_converter_die_{gameId}_{index}
  else if (isColor) gameId = customId.split('_')[3]; // power_converter_color_{gameId}_{color}

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(discordCatch); return; }
  const atkPN = combat.attackerPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, atkPN, canActAsPlayer, 'Only the attacker may respond to Power Converter.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  const thread = await fetchCombatThread(client, combat.combatThreadId);

  // Helper: resume normal reroll flow from stored pending counts
  const _resumeRerollFlow = async () => {
    const atkRem = combat.pcPendingAtkRerolls || 0;
    const defRem = combat.pcPendingDefRerolls || 0;
    const defPN = opponentPlayerNum(atkPN);
    // Check Veteran Instincts defense (may have been pending when PC interrupted).
    // Per-figure 2026-05-09: VI is keyed by the defender figureKey (multifigure-
    // independent-activation rule).
    if (game.vetInstinctsActiveThisActivation?.[combat.target?.figureKey] && !combat.vetInstinctsDefenseApplied && thread) {
      combat.viPendingAtkRerolls = atkRem;
      combat.viPendingDefRerolls = defRem;
      const _viRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${game.gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Veteran Instincts** — <@${game[`player${defPN}Id`] ?? ''}> add +1 Block or +1 Evade to the defense roll?`, components: [_viRow] }).catch(discordCatch);
      return; // VI handler will resume reroll flow
    }
    const hasForced = (combat.forcedRerollQueue || []).length > 0;
    combat.attackerRerollsRemaining = atkRem;
    combat.defenderRerollsRemaining = defRem;
    // G12: ensure per-die reroll tracking arrays exist
    if (!combat.attackerRerolledIndices) combat.attackerRerolledIndices = [];
    if (!combat.defenderRerolledIndices) combat.defenderRerolledIndices = [];
    // pre-reroll queue retired 2026-05-13 — step-3 abilities live on
    // combat.rerollAbilities (initialized at attack-roll time).
    combat.rerollAbilities = combat.rerollAbilities || {};
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
    clearPendingPowerConverter(game);
    if (thread) await thread.send('**Power Converter** — Skipped.').catch(discordCatch);
    await _resumeRerollFlow();
    saveGames(game.gameId);
    return;
  }

  if (isApprove) {
    clearPendingPowerConverter(game);
    // Show die picker in combat thread
    const dice = combat.attackDiceResults || [];
    if (!dice.length || !thread) {
      await _resumeRerollFlow();
      saveGames(game.gameId);
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
    const rows = chunkButtonsToRows(buttons);
    await thread.send({ content: `⚡ **Power Converter** — <@${game[`player${atkPN}Id`] ?? ''}> Pick an attack die to reroll (you may swap its color first):`, components: rows }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  if (isDie) {
    const dieIdx = parseInt(customId.split('_')[4], 10);
    combat.powerConverterDieIndex = dieIdx;
    if (!thread) { await _resumeRerollFlow(); saveGames(game.gameId); return; }
    // Show color swap options
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_red`).setLabel('Swap to Red').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_blue`).setLabel('Swap to Blue').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_green`).setLabel('Swap to Green').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_yellow`).setLabel('Swap to Yellow').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`power_converter_color_${gameId}_skip`).setLabel('Keep Current').setStyle(ButtonStyle.Secondary),
    );
    const d = (combat.attackDiceResults || [])[dieIdx];
    await thread.send({ content: `⚡ **Power Converter** — Replace **${d?.color || '?'} #${dieIdx + 1}** with a different color die, or keep current:`, components: [row] }).catch(discordCatch);
    saveGames(game.gameId);
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
      // G12: mark this die index as rerolled (cannot be voluntarily rerolled again)
      if (!combat.attackerRerolledIndices) combat.attackerRerolledIndices = [];
      if (!combat.attackerRerolledIndices.includes(dieIdx)) combat.attackerRerolledIndices.push(dieIdx);
      const swapMsg = colorChoice !== 'skip' && newColor !== oldDie.color ? ` (swapped ${oldDie.color} → ${newColor})` : '';
      if (thread) await thread.send(`⚡ **Power Converter** — Rerolled${swapMsg} #${dieIdx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client, `⚡ **Power Converter** — Rerolled attack die${swapMsg}.`, { phase: 'ROUND', icon: 'attack' }).catch(discordCatch);
    }
    delete combat.powerConverterDieIndex;
    await _resumeRerollFlow();
    saveGames(game.gameId);
    return;
  }
}

/**
 * Handle illicit_arms_use_ / illicit_arms_skip_ / illicit_arms_pick_ buttons.
 * Illicit Arms (Bib Fortuna): while a friendly figure is attacking, if army
 * affiliation is SCUM, may discard 1 CC from hand to apply +1 Hit.
 * Limit once per attack.
 */
export async function handleIllicitArms(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    logGameAction,
  } = ctx;

  const customId = interaction.customId;
  const isUse = customId.startsWith('illicit_arms_use_');
  const isSkip = customId.startsWith('illicit_arms_skip_');
  const isPick = customId.startsWith('illicit_arms_pick_');

  let gameId;
  if (isPick) {
    // illicit_arms_pick_{gameId}_{cardName}
    const match = customId.match(/^illicit_arms_pick_([^_]+)_(.+)$/);
    if (!match) return;
    gameId = match[1];
  } else {
    gameId = customId.replace(/^illicit_arms_(?:use|skip)_/, '');
  }

  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingIllicitArms) {
    await interaction.followUp({ content: 'No pending Illicit Arms.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const ia = game.pendingIllicitArms;
  if (!await requirePlayer(interaction, game, interaction.user.id, ia.playerNum, canActAsPlayer, 'Only the attacker\'s owner may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);

  const thread = await fetchCombatThread(client, ia.combatThreadId);

  // Clear buttons from the picker message
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  if (isSkip) {
    if (thread) await thread.send('**Illicit Arms** — Declined.').catch(discordCatch);
    clearPendingIllicitArms(game);
    if (game.pendingCombat) game.pendingCombat.illicitArmsResolved = true;
    saveGames(game.gameId);
    if (thread && game.pendingCombat) {
      const { proceedAfterRerolls } = await import('./combat.js');
      await proceedAfterRerolls(thread, game, game.pendingCombat, ctx);
    }
    return;
  }

  if (isUse) {
    // Show CC pick buttons from hand
    const hand = getCcHand(game, ia.playerNum) || [];
    if (hand.length === 0) {
      if (thread) await thread.send('**Illicit Arms** — No Command cards in hand to discard.').catch(discordCatch);
      clearPendingIllicitArms(game);
      saveGames(game.gameId);
      return;
    }
    // Build buttons for each CC in hand — encode card name (not index) for staleness safety
    const btns = hand.slice(0, 25).map((card) => {
      const label = String(card).slice(0, 80);
      return new ButtonBuilder()
        .setCustomId(`illicit_arms_pick_${gameId}_${card}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Primary);
    });
    const rows = chunkButtonsToRows(btns);
    const ownerId = getPlayerId(game, ia.playerNum);
    if (thread) {
      await thread.send({
        content: `<@${ownerId}> **Illicit Arms** — Choose a Command card to discard for **+1 Hit**:`,
        components: rows,
        allowedMentions: { users: [ownerId] },
      }).catch(discordCatch);
    }
    saveGames(game.gameId);
    return;
  }

  if (isPick) {
    const match = customId.match(/^illicit_arms_pick_([^_]+)_(.+)$/);
    const cardName = match?.[2];
    const handKey = ccHandKey(ia.playerNum);
    const hand = game[handKey] || [];
    const ccIndex = hand.findIndex(c => String(c) === cardName);
    if (!cardName || ccIndex < 0) {
      if (thread) await thread.send('**Illicit Arms** — Card no longer in hand.').catch(discordCatch);
      clearPendingIllicitArms(game);
      saveGames(game.gameId);
      return;
    }
    const discarded = hand.splice(ccIndex, 1)[0];
    game[handKey] = hand;
    const discKey = ccDiscardKey(ia.playerNum);
    game[discKey] = game[discKey] || [];
    game[discKey].push(discarded);

    // Apply +1 Hit
    if (game.pendingCombat) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    }

    if (thread) await thread.send(`**Illicit Arms** (${ia.bibDcName}) — Discarded **${discarded}** for **+1 Hit**.`).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, `**Illicit Arms** (${ia.bibDcName}) — Discarded **${discarded}** for +1 Hit.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);

    // De Wanna Wanga passive: when discarded from hand, may shuffle
    // back into the deck instead of staying in discard. Per user
    // 2026-05-09: hand-discard reshuffle isn't Bib-specific but
    // should be wired to work with his ability — call the existing
    // helper here so Illicit Arms triggers it.
    try {
      const { checkHandDiscardPassiveReshuffle } = await import('../game/cc-passive-redraw.js');
      const _dwwResult = checkHandDiscardPassiveReshuffle(game, ia.playerNum, discarded);
      if (_dwwResult?.reshuffled && logGameAction) {
        await logGameAction(game, client, `**De Wanna Wanga** (passive) — Shuffled back into command deck instead of staying in discard.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
      }
    } catch (err) {
      console.error('[Illicit Arms] De Wanna Wanga reshuffle check failed:', err?.message ?? err);
    }

    clearPendingIllicitArms(game);
    if (game.pendingCombat) game.pendingCombat.illicitArmsResolved = true;
    saveGames(game.gameId);
    if (thread && game.pendingCombat) {
      const { proceedAfterRerolls } = await import('./combat.js');
      await proceedAfterRerolls(thread, game, game.pendingCombat, ctx);
    }
    return;
  }
}

/**
 * Handle force_exhaustion_yes_ / force_exhaustion_no_ buttons.
 * Force Exhaustion (The Child): when attack declared targeting The Child or a Clan of Two figure,
 * The Child may become Incapacitated to remove 1 attack die and Weaken the attacker.
 */
export async function handleForceExhaustion(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    logGameAction,
  } = ctx;

  const isYes = interaction.customId.startsWith('force_exhaustion_yes_');
  const gameId = parseCustomId(interaction.customId, isYes ? 'force_exhaustion_yes_' : 'force_exhaustion_no_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!game.pendingForceExhaustion) {
    await interaction.followUp({ content: 'No pending Force Exhaustion.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const fe = game.pendingForceExhaustion;
  const defPN = fe.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only The Child\'s owner may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);

  const thread = await fetchCombatThread(client, fe.combatThreadId);

  // Clear buttons
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  if (isYes) {
    // Incapacitate The Child
    game.childIncapacitated = true;

    // CRR-INCP-002: "When a figure is incapacitated, it discards all
    // conditions". Clear any conditions currently on The Child at the
    // moment of incapacitation. applyCondition() enforces the second half
    // of the rule ("conditions cannot be applied to that figure").
    if (fe.childFigureKey && game.figureConditions?.[fe.childFigureKey]) {
      delete game.figureConditions[fe.childFigureKey];
    }

    // Remove 1 attack die (weakest first: yellow > green > blue > red)
    if (game.pendingCombat) {
      const { dice, removedColor } = removeForceExhaustionDie(game.pendingCombat.attackInfo.dice);
      if (removedColor && thread) {
        await thread.send(`**Force Exhaustion** — Removed 1 **${removedColor}** attack die.`).catch(discordCatch);
      }
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice };

      // Apply Weakened to the attacker (respects immunity)
      const atkFk = fe.attackerFigureKey;
      if (!isConditionImmune(game, atkFk)) {
        applyCondition(game, atkFk, 'Weaken');
        if (!game.pendingCombat.attackerConds.includes('Weaken')) {
          game.pendingCombat.attackerConds.push('Weaken');
        }
      }
    }

    if (thread) await thread.send(`**Force Exhaustion** — **The Child** is now **Incapacitated**. Attacker is **Weakened**.`).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, '**Force Exhaustion** — The Child became Incapacitated. 1 attack die removed, attacker Weakened.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
  } else {
    if (thread) await thread.send('**Force Exhaustion** — Declined.').catch(discordCatch);
  }

  clearPendingForceExhaustion(game);
  saveGames(game.gameId);
}

/**
 * Handle doubt_reroll_use_ / doubt_reroll_skip_ — defender decides whether to deplete [Doubt] for forced reroll.
 */
export async function handleDoubtReroll(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls,
  } = ctx;
  // doubt_reroll_use_{gameId} or doubt_reroll_skip_{gameId}
  const action = interaction.customId.startsWith('doubt_reroll_use_') ? 'use' : 'skip';
  const parts = splitCustomId(interaction.customId, `doubt_reroll_${action}_`);
  const gameId = parts[0];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const combat = game.pendingCombat;
  if (!combat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(discordCatch); return; }
  const defPN = combat.defenderPlayerNum || opponentPlayerNum(combat.attackerPlayerNum);
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, `Only P${defPN} may respond to Doubt.`)) return;

  const thread = await fetchCombatThread(client, combat.combatThreadId);

  try { await interaction.update({ components: [] }); } catch { try { await interaction.deferUpdate(); } catch { /* already handled */ } }

  if (action === 'use') {
    // Deplete the Doubt card
    const dbtMsgId = combat.doubtMsgId;
    if (dbtMsgId) {
      const depKey = defPN === 1 ? 'p1DepletedDcMessageIds' : 'p2DepletedDcMessageIds';
      game[depKey] = game[depKey] || [];
      if (!game[depKey].includes(dbtMsgId)) game[depKey].push(dbtMsgId);
    }
    // Add forced reroll to queue
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    combat.forcedRerollQueue.push({ controlPlayer: defPN, pool: 'attack', remaining: 1, source: 'Doubt' });
    if (thread) await thread.send('**[Doubt]** — Depleted. Defender forces 1 attack die reroll.').catch(discordCatch);
  } else {
    if (thread) await thread.send('**[Doubt]** — Skipped.').catch(discordCatch);
  }

  // Resume the reroll window (same pattern as Vet Instincts)
  const atkRem = combat.doubtPendingAtkRerolls || 0;
  const defRem = combat.doubtPendingDefRerolls || 0;
  const hasForced = (combat.forcedRerollQueue || []).length > 0;
  // Per alexanbv 2026-05-13: step-3 abilities live on combat.rerollAbilities;
  // bucket renderer surfaces unused entries as "Use X" buttons.
  const hasStep3Abilities = _countUnusedAttackerRerollAbilitiesShim(combat) > 0;

  if (thread && (atkRem > 0 || defRem > 0 || hasForced || hasStep3Abilities)) {
    combat.attackerRerollsRemaining = atkRem;
    combat.defenderRerollsRemaining = defRem;
    if (!combat.attackerRerolledIndices) combat.attackerRerolledIndices = [];
    if (!combat.defenderRerolledIndices) combat.defenderRerolledIndices = [];
    if (atkRem > 0 || hasStep3Abilities) {
      combat.rerollPhase = 'attacker';
      await sendRerollUI(thread, game, combat, 'attacker');
    } else if (hasForced) {
      combat.rerollPhase = 'forced';
      await sendRerollUI(thread, game, combat, 'forced');
    } else {
      combat.rerollPhase = 'defender';
      await sendRerollUI(thread, game, combat, 'defender');
    }
  } else if (thread) {
    combat.rerollPhase = null;
    await proceedAfterRerolls(thread, game, combat, ctx);
  }
  saveGames(game.gameId);
}

/**
 * Handle last_stand_pick_{gameId}_{figureKey|skip}: Stormtrooper Elite
 * defeat → owner picks another group-mate to Focus. Per alexanbv 2026-05-11.
 */
export async function handleLastStandPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client } = ctx;
  const m = interaction.customId.match(/^last_stand_pick_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, pickRaw] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingLastStand;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending Last Stand.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.controllerPlayerNum, canActAsPlayer, 'Only the owner of the defeated figure may pick.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
  if (pickRaw === 'skip') {
    await interaction.message.channel.send('⚡ **Last Stand** — Skipped.').catch(discordCatch);
  } else {
    if (!pending.eligibleFigureKeys.includes(pickRaw)) {
      await interaction.followUp({ content: 'That figure is not eligible.', ephemeral: true }).catch(discordCatch);
      return;
    }
    if (applyCondition(game, pickRaw, 'Focus')) {
      const targetName = dcNameFromFigureKey(pickRaw);
      await interaction.message.channel.send(`⚡ **Last Stand** — **${targetName}** becomes **Focused**.`).catch(discordCatch);
      if (logGameAction) await logGameAction(game, client,
        `⚡ **Last Stand** — **${targetName}** becomes **Focused** (another figure in the group was defeated).`,
        { phase: 'ROUND', icon: 'card' }).catch(() => {});
    }
  }
  delete game.pendingLastStand;
  if (saveGames) saveGames(game.gameId);
}

/**
 * Handle erg_pick_{gameId}_{figureKey|skip_all}_{recover|discard}:
 * Snowtrooper Environmental Recovery Gear per-figure picker
 * (alexanbv 2026-05-11). Each click resolves one figure; when the
 * pending list empties, the prompt closes.
 */
export async function handleErgPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, logGameAction, client, dcHealthState } = ctx;
  // skip_all variant has no trailing choice
  const mSkip = interaction.customId.match(/^erg_pick_([^_]+)_skip_all$/);
  const mPick = !mSkip ? interaction.customId.match(/^erg_pick_([^_]+)_(.+)_(recover|discard)$/) : null;
  if (!mSkip && !mPick) return;
  const gameId = (mSkip || mPick)[1];
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const pending = game.pendingErgChoices;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending ERG choices.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.controllerPlayerNum, canActAsPlayer, 'Only the activator may pick.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  if (mSkip) {
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    await interaction.message.channel.send(`🧰 **${pending.sourceLabel}** — Remaining choices skipped.`).catch(discordCatch);
    delete game.pendingErgChoices;
    if (saveGames) saveGames(game.gameId);
    return;
  }
  const [, , figureKey, choice] = mPick;
  const figIdx = pending.figures.findIndex(f => f.figureKey === figureKey);
  if (figIdx < 0) {
    await interaction.followUp({ content: 'That figure is no longer eligible.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const f = pending.figures[figIdx];
  let resultText = '';
  if (choice === 'discard') {
    const cond = f.harmful?.[0];
    if (cond) {
      const { filterCondition } = await import('../game/conditions.js');
      filterCondition(game, f.figureKey, cond);
      resultText = `**${f.dcName}** discarded **${cond}**`;
    }
  } else if (choice === 'recover') {
    const hs = dcHealthState?.get?.(f.msgId) || [];
    const hpEntry = hs[f.figIdx];
    if (hpEntry) {
      const [cur, max] = hpEntry;
      if (cur < max) {
        hs[f.figIdx] = [Math.min(max, cur + 1), max];
        dcHealthState.set(f.msgId, hs);
        const { syncHealthStateToList } = await import('../game/health-state.js');
        syncHealthStateToList(game, f.controllerPlayerNum, f.msgId, hs);
        resultText = `**${f.dcName}** recovered 1 HP`;
      }
    }
  }
  pending.figures.splice(figIdx, 1);
  if (resultText) {
    await interaction.message.channel.send(`🧰 **${pending.sourceLabel}** — ${resultText}.`).catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, `🧰 **${pending.sourceLabel}** — ${resultText}.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
  }
  if (pending.figures.length === 0) {
    try { await interaction.message.edit({ components: [] }).catch(discordCatch); } catch {}
    delete game.pendingErgChoices;
  }
  if (saveGames) saveGames(game.gameId);
}
