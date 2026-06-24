import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';

import { resolvePendingCombat, pushNestedCombat } from '../game/combat-stack.js';
import { opponentPlayerNum, getPlayerId, getDcList, getCcHand, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { reduceHp, dcNameFromFigureKey, awardKillVp, applyCondition, isConditionImmune, checkNefariousGains } from '../game/index.js';
import { filterCondition } from '../game/conditions.js';
import { getDcEffect } from '../game/dc-helpers.js';
import { getDistinctDieFaces } from '../data-loader.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { removeForceExhaustionDie } from '../game/force-exhaustion-helpers.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { discordCatch } from '../error-handling.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { fetchCombatThread, sanitizeMentions } from '../discord/channel-helpers.js';
import { sendPowerTokenOverflowUI, resumeGateAfterRollInterrupt, _forceMissAndStep8 } from './combat.js';
import { clearPendingThereIsNoTry, clearPendingStrikeMeDown, clearPendingSlowOnTheDraw, clearPendingForceExhaustion, clearPendingHunterProtocol, clearPendingForceIsWithMe } from '../game/interrupts.js';
import { getDcMessageIds as _getDcMessageIdsFiwm } from '../game/player-helpers.js';

// handleToughLuck (legacy round-long tough_luck_* reaction) removed 2026-06-18.
// Tough Luck is now a discrete one-shot post-reroll reaction handled entirely by
// _offerToughLuck + handleToughLuckGate (tlgate_* customIds) in handlers/combat.js.
// The proactive round-arm (setsToughLuck / game.toughLuckPlayerNum) is gone.

export async function handleThereIsNoTry(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
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
    // Selectable faces come from the single canonical source (data/dice.json via
    // getDistinctDieFaces) so "set to any face" always lists the die's REAL
    // faces (alexanbv 2026-06-21). White has a Dodge face; black does not.
    const faceOptions = getDistinctDieFaces('defense', color);
    const faceBtns = faceOptions.map((face) =>
      new ButtonBuilder()
        .setCustomId(`there_is_no_try_face_${gameId}_${dieIdx}_${face.block ?? 0}_${face.evade ?? 0}_${face.dodge ? 1 : 0}`)
        .setLabel(`${face.block ?? 0}B/${face.evade ?? 0}E${face.dodge ? '/Dodge' : ''}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    if (thread) await thread.send({ content: `**There Is No Try** — Choose any face for die #${dieIdx + 1} (${color}):`, components: chunkButtonsToRows(faceBtns) }).catch(discordCatch);
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
  // After TINT resolves (face set or skipped): enter reroll window.
  // Gate cutover (alexanbv 2026-06-16): on a gate attack the roll step paused
  // for TINT — resume by advancing the sequence into the rerolls window (the
  // gate reads the reroll queue itself), instead of the legacy reroll UI.
  if (thread && combat && combat._seqActive) {
    await resumeGateAfterRollInterrupt(thread, game, combat, ctx);
    saveGames(game.gameId); return;
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
    if (_hpThread) await _hpThread.send({ content: `**Spend surge?** **${_hpRemaining}** surge left.`, components: chunkButtonsToRows(_hpRows) }).catch(discordCatch);
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
 * The Force is With Me (Chirrut Imwe): defender (Chirrut's owner) picks an
 * adjacent hostile figure when a Ranged attack targets Chirrut. The chosen
 * hostile takes 1 Damage AND -1 Damage is applied to the attack results
 * (defender modifier — combat.defenderDamageReduction).
 *
 * Per alexanbv 2026-05-13: previously auto-picked the first adjacent
 * hostile and incorrectly subtracted from bonusHits. Both fixed.
 *
 * Button prefixes:
 *   force_with_me_pick_<gameId>_<idx>  → pick adjacent hostile at idx
 *   force_with_me_skip_<gameId>        → decline
 */
export async function handleForceIsWithMe(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, dcHealthState } = ctx;
  const customId = interaction.customId;
  const isSkip = customId.startsWith('force_with_me_skip_');
  const gameId = parseCustomId(customId, isSkip ? 'force_with_me_skip_' : 'force_with_me_pick_').split('_')[0];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingForceIsWithMe;
  if (!pending) {
    await interaction.followUp({ content: 'No pending Force is With Me.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const defPN = pending.defenderPlayerNum;
  if (!await requirePlayer(interaction, game, interaction.user.id, defPN, canActAsPlayer, 'Only Chirrut\'s owner may respond.')) return;
  await interaction.deferUpdate().catch(discordCatch);
  await interaction.message.edit({ content: interaction.message.content, components: [] }).catch(discordCatch);

  if (isSkip) {
    await interaction.channel.send('**The Force is With Me** — Skipped.').catch(discordCatch);
    if (logGameAction) await logGameAction(game, client, '**The Force is With Me** — Chirrut declined.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    clearPendingForceIsWithMe(game);
    saveGames(game.gameId);
    return;
  }

  // Parse the picked index from `force_with_me_pick_<gameId>_<idx>`.
  const rest = parseCustomId(customId, 'force_with_me_pick_');
  const parts = rest.split('_');
  const pickedIdx = parseInt(parts[1] ?? parts[0], 10);
  const chosenFk = pending.adjacentHostiles?.[pickedIdx];
  if (!chosenFk) {
    await interaction.followUp({ content: 'Invalid pick.', ephemeral: true }).catch(discordCatch);
    return;
  }

  // Apply -1 Damage to the attack results (defender modifier — kicks in
  // at computeCombatResult via combat.defenderDamageReduction).
  if (game.pendingCombat) {
    game.pendingCombat.defenderDamageReduction = (game.pendingCombat.defenderDamageReduction || 0) + 1;
  }

  // Apply 1 Damage to the chosen adjacent hostile via the damage pipeline.
  const chosenDcName = dcNameFromFigureKey(chosenFk);
  const _fkMatch = chosenFk.match(/^(.+)-(\d+)-(\d+)$/);
  if (_fkMatch && dcHealthState) {
    const [, _dcN, , _fiStr] = _fkMatch;
    const _msgIds = _getDcMessageIdsFiwm(game, pending.attackerPlayerNum) || [];
    const _dcList = getDcList(game, pending.attackerPlayerNum) || [];
    let _chosenMsgId = null;
    for (let i = 0; i < _msgIds.length; i++) {
      if (_dcList[i]?.dcName === _dcN) { _chosenMsgId = _msgIds[i]; break; }
    }
    if (_chosenMsgId) {
      await _applyDamage(game, { dcHealthState, logGameAction, client }, {
        figureKey: chosenFk,
        msgId: _chosenMsgId,
        figIndex: parseInt(_fiStr, 10),
        amount: 1,
        controllerPlayerNum: pending.attackerPlayerNum,
        source: 'The Force is With Me',
      });
    }
  }

  await interaction.channel.send(`**The Force is With Me** — **${chosenDcName}** suffers 1 Damage; -1 Damage applied to the attack results.`).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `**The Force is With Me** — Chirrut picks ${chosenDcName} (1 dmg) and reduces attack damage by 1.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);

  clearPendingForceIsWithMe(game);
  saveGames(game.gameId);
}



/**
 * Handle force_exhaustion_yes_ / force_exhaustion_no_ buttons.
 *
 * Force Exhaustion (The Child / Clan of Two) — per alexanbv's refined ruling:
 * when an attack targeting The Child (or a Clan-of-Two-attached figure) is
 * declared, The Child's owner may have The Child become **Incapacitated**.
 *
 * On incap (BOTH cases): remove 1 attack die (weakest-first) AND the attacker
 * becomes **Weakened** (respecting condition immunity).
 *
 * ADDITIONALLY, only when The Child ITSELF is the target (fe.targetIsChild):
 * the attack also MISSES with NO dice rolled — the pipeline skips directly to
 * the "after resolving an attack" step, exactly like On the Lam forcing a miss.
 * The attacker still loses Focus and Hidden (the forced-miss drain does NOT
 * consume them, so we strip them explicitly here).
 *
 * When a Clan-of-Two-ATTACHED figure is the target (not fe.targetIsChild): only
 * the die-removal + Weaken happen; the attack PROCEEDS normally with the reduced
 * dice. We clear pendingForceExhaustion so the on_declare gate resumes to roll.
 *
 * "No" (decline): the attack proceeds as normal (gate continues to roll).
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

    const combat = game.pendingCombat;

    // alexanbv 2026-06-19: the die removed is now the ATTACKER's choice (not an
    // auto weakest-first pick). Hand off to the attacker via a per-die picker.
    // The incap has already happened; the FE pending decision is replaced by a
    // pendingForceExhaustionDiePick that the gate roll/Ready guards also block on,
    // so no dice are rolled between the incap and the attacker's die pick.
    const poolDice = combat?.attackInfo?.dice || [];

    // Fallback: if there is no live combat or no die to pick (≤1 die — nothing to
    // choose between), skip the interactive picker and resolve immediately using
    // the weakest-first default (removeForceExhaustionDie). This also guards the
    // empty-pool edge case.
    if (!combat || poolDice.length <= 1) {
      clearPendingForceExhaustion(game);
      let removedColor = null;
      if (combat?.attackInfo) {
        const r = removeForceExhaustionDie(combat.attackInfo.dice);
        removedColor = r.removedColor;
        combat.attackInfo = { ...combat.attackInfo, dice: r.dice };
        if (removedColor && thread) {
          await thread.send(`**Force Exhaustion** — Removed 1 **${removedColor}** attack die.`).catch(discordCatch);
        }
      }
      await _resolveForceExhaustionAfterDiePick(game, combat, fe, thread, ctx, removedColor);
      saveGames(game.gameId);
      return;
    }

    // Replace the Yes/No decision with the attacker's die-pick decision.
    clearPendingForceExhaustion(game);
    const attackerPlayerNum = combat.attackerPlayerNum ?? fe.attackerPlayerNum;
    game.pendingForceExhaustionDiePick = {
      gameId: game.gameId,
      attackerPlayerNum,
      defenderPlayerNum: defPN,
      targetIsChild: !!fe.targetIsChild,
      attackerFigureKey: combat.attackerFigureKey ?? fe.attackerFigureKey,
      combatThreadId: fe.combatThreadId,
    };

    // Build one button per attack pool die, keyed by INDEX so duplicate colors
    // remove the exact slot picked. List weakest-first (yellow>green>blue>red)
    // so the first option is the sensible default (matches removeForceExhaustionDie),
    // which is what self-play / first-action selection will choose.
    const indexed = poolDice.map((color, idx) => ({ color, idx }));
    indexed.sort((a, b) => {
      const ra = FE_DIE_ORDER_INDEX[a.color] ?? 99;
      const rb = FE_DIE_ORDER_INDEX[b.color] ?? 99;
      return ra !== rb ? ra - rb : a.idx - b.idx;
    });
    const feBtns = indexed.map(({ color, idx }) => new ButtonBuilder()
      .setCustomId(`fe_die_pick_${game.gameId}_${idx}`)
      .setLabel(`${color.charAt(0).toUpperCase() + color.slice(1)} die`)
      .setStyle(ButtonStyle.Primary));
    const atkOwnerId = getPlayerId(game, attackerPlayerNum);
    if (thread) {
      await thread.send(sanitizeMentions({
        content: `<@${atkOwnerId}> **Force Exhaustion** — **The Child** is now **Incapacitated**. You must remove 1 die from your attack pool — choose which. (You cannot roll until you pick.)`,
        components: chunkButtonsToRows(feBtns),
        allowedMentions: { users: [atkOwnerId] },
      })).catch(discordCatch);
    }
    if (logGameAction) await logGameAction(game, client, '**Force Exhaustion** — The Child became Incapacitated. Attacker must choose 1 attack die to remove.', { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }

  if (thread) await thread.send('**Force Exhaustion** — Declined.').catch(discordCatch);
  clearPendingForceExhaustion(game);
  saveGames(game.gameId);
}

/** Weakest-first priority used to order/default the FE die picker. */
const FE_DIE_ORDER_INDEX = Object.freeze({ yellow: 0, green: 1, blue: 2, red: 3 });

/**
 * Handle fe_die_pick_<gameId>_<dieIndex>: the ATTACKER chooses which attack pool
 * die Force Exhaustion removes. customId carries the pool index so the exact slot
 * is removed even with duplicate colors. Applies Weaken to the attacker, then
 * branches: target-is-child → forceMiss drain (Focus+Hidden stripped); clan-of-two
 * → attack proceeds with the reduced pool. Clears pendingForceExhaustionDiePick
 * so the gate's roll/Ready guards release.
 */
export async function handleForceExhaustionDiePick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client } = ctx;
  const m = interaction.customId.match(/^fe_die_pick_(.+)_(\d+)$/);
  if (!m) return;
  const [, gameId, idxStr] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pick = game.pendingForceExhaustionDiePick;
  if (!pick) {
    await interaction.followUp({ content: 'No pending Force Exhaustion die pick.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, pick.attackerPlayerNum, canActAsPlayer, 'Only the attacker may choose the die to remove.')) return;
  await interaction.deferUpdate().catch(discordCatch);

  const thread = await fetchCombatThread(client, pick.combatThreadId);
  const combat = game.pendingCombat;
  const idx = Number(idxStr);
  const dice = [...(combat?.attackInfo?.dice || [])];
  let removedColor = null;
  if (combat?.attackInfo && idx >= 0 && idx < dice.length) {
    removedColor = dice[idx];
    dice.splice(idx, 1);
    combat.attackInfo = { ...combat.attackInfo, dice };
  }

  // Clear the picker buttons.
  await interaction.message.edit({
    content: removedColor
      ? `**Force Exhaustion** — Removed 1 **${removedColor}** attack die. Pool is now: ${dice.length ? dice.join(', ') : '(empty)'}.`
      : interaction.message.content,
    components: [],
  }).catch(discordCatch);

  delete game.pendingForceExhaustionDiePick;
  await _resolveForceExhaustionAfterDiePick(game, combat, pick, thread, ctx, removedColor);
  saveGames(game.gameId);
}

/**
 * Shared tail for Force Exhaustion once the die (if any) is removed: Weaken the
 * attacker (respecting condition immunity), then branch on targetIsChild.
 *  - target-is-child → strip attacker Focus+Hidden, forceMiss drain (no dice).
 *  - clan-of-two     → attack proceeds with the reduced pool.
 * `fe` is the FE/diePick payload (carries targetIsChild + attackerFigureKey).
 */
async function _resolveForceExhaustionAfterDiePick(game, combat, fe, thread, ctx, removedColor) {
  const { client, logGameAction } = ctx;

  const atkFk = combat?.attackerFigureKey ?? fe.attackerFigureKey;
  if (atkFk && !isConditionImmune(game, atkFk)) {
    applyCondition(game, atkFk, 'Weaken');
    if (combat && Array.isArray(combat.attackerConds) && !combat.attackerConds.includes('Weaken')) {
      combat.attackerConds.push('Weaken');
    }
  }

  if (fe.targetIsChild) {
    // The Child ITSELF is the target: ALSO skip the attack (force a miss).
    // "Attacker still loses Focus and Hidden if relevant." On a normal attack
    // these are consumed in the after-resolve window's Focus/Hide discard
    // (combat-bridge.js runAfterResolveWindow). The forced-miss drain below
    // uses postPostResolveWindow, which does NOT run that discard — so strip
    // the attacker's Focus + Hidden explicitly here, mirroring a resolved attack.
    if (combat?.attackerFigureKey) {
      filterCondition(game, combat.attackerFigureKey, 'Focus');
      filterCondition(game, combat.attackerFigureKey, 'Hide');
      if (Array.isArray(combat.attackerConds)) {
        combat.attackerConds = combat.attackerConds.filter((c) => c !== 'Focus' && c !== 'Hide');
      }
    }

    if (logGameAction) await logGameAction(game, client, `**Force Exhaustion** — The Child became Incapacitated.${removedColor ? ` 1 ${removedColor} attack die removed,` : ''} attacker Weakened, and the attack misses (no dice rolled).`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);

    // Abort the attack as a MISS using the On the Lam mechanism: synthesize a
    // miss state (forceMiss=true, no dice), then run the after-resolve drain for
    // both sides so step-8 / "after resolving an attack" effects still fire.
    if (combat) {
      combat.forceMiss = true;
      await _forceMissAndStep8(
        thread, game, combat, ctx,
        `**Force Exhaustion** — **The Child** is now **Incapacitated**. The attack **misses** — no dice are rolled.`,
      );
    }
    return;
  }

  // Clan-of-Two-attached figure is the target: die removed + attacker Weakened,
  // but the attack PROCEEDS. The pending die-pick has already been cleared so the
  // on_declare gate's roll/Ready guards no longer block — the player can roll the
  // reduced pool.
  if (thread) await thread.send(`**Force Exhaustion** — **The Child** is now **Incapacitated**. Attacker is **Weakened**. The attack proceeds with the reduced dice.`).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `**Force Exhaustion** — The Child became Incapacitated.${removedColor ? ` 1 ${removedColor} attack die removed,` : ''} attacker Weakened. Attack proceeds.`, { phase: 'ROUND', icon: 'card' }).catch(discordCatch);
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
