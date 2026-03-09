import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { opponentPlayerNum } from '../game/player-helpers.js';
import { requireGame } from '../utils/guards.js';

export async function handleToughLuck(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    recalcAttackTotals, recalcDefenseTotals,
    sendRerollUI, proceedAfterRerolls,
    logGameAction, combatContext,
  } = ctx;

  const buttonKey = interaction.customId.startsWith('tough_luck_remove_') ? 'tough_luck_remove_' : 'tough_luck_skip_';

  // Tough Luck: remove a rerolled die or skip, then continue reroll flow
  const _tlParts = interaction.customId.split('_');
  const _tlGameId = _tlParts[3];
  const _tlGame = getGame(_tlGameId);
  if (!_tlGame?.pendingToughLuck) { await interaction.followUp({ content: 'No pending Tough Luck.', ephemeral: true }).catch(() => {}); return; }
  const _tlData = _tlGame.pendingToughLuck;
  const _tlCombat = _tlGame.pendingCombat;
  const _tlAtk = _tlCombat?.attackerPlayerNum;
  const _tlDef = opponentPlayerNum(_tlAtk);
  // TL player is the one who set toughLuckPlayerNum
  const _tlResponder = _tlGame.toughLuckPlayerNum;
  if (!canActAsPlayer(_tlGame, interaction.user.id, _tlResponder)) {
    await interaction.followUp({ content: 'Only the Tough Luck player may respond.', ephemeral: true }).catch(() => {}); return;
  }
  if (buttonKey === 'tough_luck_remove_') {
    const _tlDieIdx = parseInt(_tlParts[4], 10);
    if (_tlData.side === 'atk' && _tlCombat?.attackDiceResults?.[_tlDieIdx]) {
      const _tlDie = _tlCombat.attackDiceResults[_tlDieIdx];
      _tlCombat.attackDiceResults.splice(_tlDieIdx, 1);
      const t = recalcAttackTotals(_tlCombat.attackDiceResults);
      _tlCombat.attackRoll = { acc: t.acc, dmg: t.dmg, surge: t.surge };
      await logGameAction(_tlGame, client, `**Tough Luck** — Removed rerolled ${_tlDie.color} attack die. New totals: ${t.acc} acc, ${t.dmg} dmg, ${t.surge} surge.`, { phase: 'ROUND', icon: 'card' });
    } else if (_tlData.side === 'def' && _tlCombat?.defenseDiceResults?.[_tlDieIdx]) {
      const _tlDie = _tlCombat.defenseDiceResults[_tlDieIdx];
      _tlCombat.defenseDiceResults.splice(_tlDieIdx, 1);
      const t = recalcDefenseTotals(_tlCombat.defenseDiceResults);
      _tlCombat.defenseRoll = { block: t.block, evade: t.evade, dodge: t.dodge };
      await logGameAction(_tlGame, client, `**Tough Luck** — Removed rerolled ${_tlDie.color} defense die. New totals: ${t.block} block, ${t.evade} evade.`, { phase: 'ROUND', icon: 'card' });
    }
  } else {
    await logGameAction(_tlGame, client, '**Tough Luck** — Skipped.', { phase: 'ROUND', icon: 'card' });
  }
  _tlGame.pendingToughLuck = null;
  // Continue reroll flow
  const _tlThread = await client.channels.fetch(_tlCombat?.combatThreadId).catch(() => null);
  if (_tlThread && _tlCombat) {
    const _tlSide = _tlData.side;
    const _tlAtkRem = _tlCombat.attackerRerollsRemaining || 0;
    const _tlDefRem = _tlCombat.defenderRerollsRemaining || 0;
    if (_tlSide === 'atk' && _tlAtkRem > 0) {
      await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'attacker');
    } else if (_tlSide === 'def' && _tlDefRem > 0) {
      await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'defender');
    } else if (_tlSide === 'atk' && _tlDefRem > 0) {
      _tlCombat.rerollPhase = 'defender';
      await sendRerollUI(_tlThread, _tlGame, _tlCombat, 'defender');
    } else {
      _tlCombat.rerollPhase = null;
      await proceedAfterRerolls(_tlThread, _tlGame, _tlCombat, combatContext);
    }
  }
  saveGames(); return;
}

export async function handleThereIsNoTry(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls, combatContext,
  } = ctx;

  // There Is No Try: die picker → face picker → apply, then enter reroll window
  const _tintParts = interaction.customId.split('_');
  // Prefix pattern: there_is_no_try_{die|face|skip}_ → parts[0..4] are the prefix words
  const _tintType = _tintParts[4]; // 'die', 'face', or 'skip'
  const _tintGameId = _tintParts[5];
  const _tintGame = await requireGame(interaction, getGame, _tintGameId);
  if (!_tintGame) return;
  const _tintCombat = _tintGame.pendingCombat;
  const _tintDefNum = _tintCombat?.defenderPlayerNum ?? opponentPlayerNum(_tintCombat?.attackerPlayerNum);
  if (!canActAsPlayer(_tintGame, interaction.user.id, _tintDefNum)) {
    await interaction.followUp({ content: 'Only the defender may respond.', ephemeral: true }).catch(() => {}); return;
  }
  if (!_tintGame.pendingThereIsNoTry && _tintType !== 'skip') {
    await interaction.followUp({ content: 'No pending There Is No Try.', ephemeral: true }).catch(() => {}); return;
  }
  const _tintThread = await client.channels.fetch(_tintCombat?.combatThreadId).catch(() => null);
  if (_tintType === 'die') {
    const _tintDieIdx = parseInt(_tintParts[6], 10);
    const _tintDefDice = _tintCombat?.defenseDiceResults || [];
    const _tintDie = _tintDefDice[_tintDieIdx];
    if (!_tintDie) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(() => {}); return; }
    _tintGame.pendingThereIsNoTry.pickedDieIdx = _tintDieIdx;
    // Build face options based on die color (white/black)
    const _tintColor = _tintDie.color || 'white';
    // Standard defense die faces: white: 0/0, 1/0, 1/1, 0/0/dodge; black: 0/0, 1/0, 2/0, 1/1, 0/1, dodge
    const _tintFaceOptions = _tintColor === 'black'
      ? [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 2, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 1 }, { block: 0, evade: 0, dodge: true }]
      : [{ block: 0, evade: 0 }, { block: 1, evade: 0 }, { block: 1, evade: 1 }, { block: 0, evade: 0, dodge: true }];
    const _tintFaceBtns = _tintFaceOptions.map((face, fi) =>
      new ButtonBuilder()
        .setCustomId(`there_is_no_try_face_${_tintGameId}_${_tintDieIdx}_${face.block ?? 0}_${face.evade ?? 0}_${face.dodge ? 1 : 0}`)
        .setLabel(`${face.block ?? 0}B/${face.evade ?? 0}E${face.dodge ? '/Dodge' : ''}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    if (_tintThread) await _tintThread.send({ content: `**There Is No Try** — Choose any face for die #${_tintDieIdx + 1} (${_tintColor}):`, components: [new ActionRowBuilder().addComponents(..._tintFaceBtns.slice(0, 5))] }).catch(() => {});
    saveGames(); return;
  }
  if (_tintType === 'face') {
    const _tintDieIdxF = parseInt(_tintParts[6], 10);
    const _tintBlock = parseInt(_tintParts[7], 10) || 0;
    const _tintEvade = parseInt(_tintParts[8], 10) || 0;
    const _tintDodgeFlag = parseInt(_tintParts[9], 10) === 1;
    const _tintDefDiceF = _tintCombat?.defenseDiceResults || [];
    if (_tintDefDiceF[_tintDieIdxF]) {
      const _tintOld = _tintDefDiceF[_tintDieIdxF];
      // Apply chosen face; convert any Dodge results on this die to Block+Block+Evade
      _tintDefDiceF[_tintDieIdxF] = { ..._tintOld, block: _tintBlock, evade: _tintEvade, dodge: _tintDodgeFlag };
      // Convert Dodge on this die to +2 Block +1 Evade (no dice dodge result)
      if (_tintDodgeFlag) {
        _tintDefDiceF[_tintDieIdxF] = { ..._tintOld, block: _tintBlock + 2, evade: _tintEvade + 1, dodge: false };
      }
      _tintCombat.defenseDiceResults = _tintDefDiceF;
      const _tintNewTotal = _tintDefDiceF.reduce((acc, d) => ({ block: acc.block + (d.block ?? 0), evade: acc.evade + (d.evade ?? 0), dodge: acc.dodge || !!d.dodge }), { block: 0, evade: 0, dodge: false });
      _tintCombat.defenseRoll = { block: _tintNewTotal.block, evade: _tintNewTotal.evade, dodge: _tintNewTotal.dodge };
      if (_tintThread) await _tintThread.send(`**There Is No Try** — Die set to ${_tintBlock}B/${_tintEvade}E${_tintDodgeFlag ? ' (Dodge→+2B+1E)' : ''}. New defense totals: ${_tintCombat.defenseRoll.block} block, ${_tintCombat.defenseRoll.evade} evade.`).catch(() => {});
    }
    _tintGame.pendingThereIsNoTry = null;
    _tintCombat.tintResolved = true;
  } else {
    // Skip
    _tintGame.pendingThereIsNoTry = null;
    _tintCombat.tintResolved = true;
    if (_tintThread) await _tintThread.send('**There Is No Try** — Skipped.').catch(() => {});
  }
  // After TINT resolves (face set or skipped): enter reroll window
  if (_tintThread && _tintCombat) {
    const _tintAtkRem = _tintCombat.attackerRerollsRemaining || 0;
    const _tintDefRem = _tintCombat.defenderRerollsRemaining || 0;
    if (_tintAtkRem > 0 || _tintDefRem > 0) {
      _tintCombat.rerollPhase = _tintAtkRem > 0 ? 'attacker' : 'defender';
      await sendRerollUI(_tintThread, _tintGame, _tintCombat, _tintCombat.rerollPhase);
    } else {
      _tintCombat.rerollPhase = null;
      await proceedAfterRerolls(_tintThread, _tintGame, _tintCombat, combatContext);
    }
  }
  saveGames(); return;
}

export async function handleVetInstincts(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client,
    sendRerollUI, proceedAfterRerolls, combatContext,
  } = ctx;

  // Veteran Instincts: attacker adds +1 Hit/Surge, defender adds +1 Block/Evade
  const _viParts = interaction.customId.split('_');
  const _viGameId = _viParts[3];
  const _viChoice = _viParts[4]; // hit/surge/block/evade/skip
  const _viGame = await requireGame(interaction, getGame, _viGameId);
  if (!_viGame) return;
  const _viCombat = _viGame.pendingCombat;
  if (!_viCombat) { await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(() => {}); return; }
  const _viAtk = _viCombat.attackerPlayerNum;
  const _viDef = opponentPlayerNum(_viAtk);
  // Determine phase: block/evade = defense; hit/surge = attack; skip depends on which phase is pending
  const _viIsDefPhase = _viChoice === 'block' || _viChoice === 'evade' || (_viChoice === 'skip' && _viCombat.vetInstinctsAttackApplied);
  const _viExpectedPlayer = _viIsDefPhase ? _viDef : _viAtk;
  if (!canActAsPlayer(_viGame, interaction.user.id, _viExpectedPlayer)) {
    await interaction.followUp({ content: `Only P${_viExpectedPlayer} may respond to Veteran Instincts.`, ephemeral: true }).catch(() => {}); return;
  }
  const _viThread = await client.channels.fetch(_viCombat.combatThreadId).catch(() => null);
  if (_viChoice === 'hit') {
    _viCombat.attackRoll = { ..._viCombat.attackRoll, dmg: (_viCombat.attackRoll?.dmg || 0) + 1 };
    _viCombat.vetInstinctsAttackApplied = true;
    if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Hit added to attack roll.').catch(() => {});
  } else if (_viChoice === 'surge') {
    _viCombat.attackRoll = { ..._viCombat.attackRoll, surge: (_viCombat.attackRoll?.surge || 0) + 1 };
    _viCombat.vetInstinctsAttackApplied = true;
    if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Surge added to attack roll.').catch(() => {});
  } else if (_viChoice === 'block') {
    _viCombat.defenseRoll = { ..._viCombat.defenseRoll, block: (_viCombat.defenseRoll?.block || 0) + 1 };
    _viCombat.vetInstinctsDefenseApplied = true;
    if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Block added to defense roll.').catch(() => {});
  } else if (_viChoice === 'evade') {
    _viCombat.defenseRoll = { ..._viCombat.defenseRoll, evade: (_viCombat.defenseRoll?.evade || 0) + 1 };
    _viCombat.vetInstinctsDefenseApplied = true;
    if (_viThread) await _viThread.send('**Veteran Instincts** — +1 Evade added to defense roll.').catch(() => {});
  } else {
    // skip
    if (!_viCombat.vetInstinctsAttackApplied) {
      _viCombat.vetInstinctsAttackApplied = true;
      if (_viThread) await _viThread.send('**Veteran Instincts** — Attack bonus skipped.').catch(() => {});
    } else {
      _viCombat.vetInstinctsDefenseApplied = true;
      if (_viThread) await _viThread.send('**Veteran Instincts** — Defense bonus skipped.').catch(() => {});
    }
  }
  if (_viIsDefPhase && _viThread && _viCombat) {
    // Enter or continue the reroll window using stored pending counts
    const _viAtkRem = _viCombat.viPendingAtkRerolls || 0;
    const _viDefRem = _viCombat.viPendingDefRerolls || 0;
    const _viHasForced = (_viCombat.forcedRerollQueue || []).length > 0;
    const _viHasPreRerolls = (_viCombat.pendingPreRerolls || []).length > 0;
    if (_viAtkRem > 0 || _viDefRem > 0 || _viHasForced || _viHasPreRerolls) {
      _viCombat.attackerRerollsRemaining = _viAtkRem;
      _viCombat.defenderRerollsRemaining = _viDefRem;
      if (_viAtkRem > 0 || _viHasPreRerolls) {
        _viCombat.rerollPhase = 'attacker';
        await sendRerollUI(_viThread, _viGame, _viCombat, 'attacker');
      } else if (_viHasForced) {
        _viCombat.rerollPhase = 'forced';
        await sendRerollUI(_viThread, _viGame, _viCombat, 'forced');
      } else {
        _viCombat.rerollPhase = 'defender';
        await sendRerollUI(_viThread, _viGame, _viCombat, 'defender');
      }
    } else {
      _viCombat.rerollPhase = null;
      await proceedAfterRerolls(_viThread, _viGame, _viCombat, combatContext);
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
  if (!canActAsPlayer(_hpGame, interaction.user.id, _hpAtk)) {
    await interaction.followUp({ content: 'Only the attacker may respond to Hunter Protocol.', ephemeral: true }).catch(() => {}); return;
  }
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
