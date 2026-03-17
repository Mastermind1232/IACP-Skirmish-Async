/**
 * Interrupt handlers: still_faster, squad_swarm, overdrive, self_destruct_probe,
 * self_destruct_protocol, last_resort, scavenged_walker, on_diplomatic, bel_reorder,
 * ab_blade_pick, sf_mp_pick, force_slow_pick, excavation_pick
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { getDcList, getDcMessageIds, getActivatedDcIndices, getPlayAreaId, dcAttachmentsKey, getHandChannelId, opponentPlayerNum, getPlayerId, getCcDiscard, getCcHand, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { reduceHp, awardObjectiveVp, deductVp, awardKillVp, dcNameFromFigureKey, parseFigureKey, getMaxPowerTokens, applyCondition, filterCondition, HARMFUL_CONDITIONS } from '../game/index.js';
import { getCcEffect } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';

// ── 1. Still Faster Than You ────────────────────────────────────────────────
export async function handleStillFaster(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('still_faster_dc_pick_') ? 'still_faster_dc_pick_'
    : interaction.customId.startsWith('still_faster_skip_') ? 'still_faster_skip_'
    : 'still_faster_use_';

  const sftParts = interaction.customId.split('_');
  // still_faster_use_{gameId}_{activatingMsgId}
  // still_faster_skip_{gameId}_{activatingMsgId}
  // still_faster_dc_pick_{gameId}_{sftDcMsgId}_{activatingMsgId}
  let sftGameId, sftActivatingMsgId, sftPickedMsgId;
  if (buttonKey === 'still_faster_dc_pick_') {
    // still_faster_dc_pick_ prefix is 21 chars; remainder: gameId_sftDcMsgId_activatingMsgId
    const rem = interaction.customId.slice('still_faster_dc_pick_'.length);
    const remParts = rem.split('_');
    sftGameId = remParts[0];
    sftPickedMsgId = remParts[1];
    sftActivatingMsgId = remParts.slice(2).join('_');
  } else {
    const rem = interaction.customId.slice(buttonKey.length);
    const remParts = rem.split('_');
    sftGameId = remParts[0];
    sftActivatingMsgId = remParts.slice(1).join('_');
  }
  const sftGame = await requireGame(interaction, getGame, sftGameId);
  if (!sftGame) return;

  if (buttonKey === 'still_faster_skip_') {
    const sftPlayerNum = sftGame.pendingStillFaster?.sftPlayerNum;
    if (!await requirePlayer(interaction, sftGame, interaction.user.id, sftPlayerNum, canActAsPlayer, 'Only the Still Faster Than You player may respond.')) return;
    delete sftGame.pendingStillFaster;
    sftGame.stillFasterPlayerNum = null;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: '**Still Faster Than You** — Skipped.', ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  if (buttonKey === 'still_faster_use_') {
    const sftPending = sftGame.pendingStillFaster;
    if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch(discordCatch); return; }
    const { sftPlayerNum } = sftPending;
    if (!await requirePlayer(interaction, sftGame, interaction.user.id, sftPlayerNum, canActAsPlayer, 'Only the Still Faster Than You player may respond.')) return;
    // Show the SFTY player's non-exhausted DCs as picker buttons
    const sftDcList = sftPlayerNum === 1 ? (sftGame.p1DcList || []) : (sftGame.p2DcList || []);
    const sftMsgIds = sftPlayerNum === 1 ? (sftGame.p1DcMessageIds || []) : (sftGame.p2DcMessageIds || []);
    const sftActivatedIndices = sftPlayerNum === 1 ? (sftGame.p1ActivatedDcIndices || []) : (sftGame.p2ActivatedDcIndices || []);
    const sftButtons = [];
    for (let i = 0; i < sftDcList.length; i++) {
      const dc = sftDcList[i];
      if (!dc || dc.defeated || sftActivatedIndices.includes(i)) continue;
      const dcMsgId = sftMsgIds[i];
      if (!dcMsgId) continue;
      sftButtons.push(new ButtonBuilder()
        .setCustomId(`still_faster_dc_pick_${sftGameId}_${dcMsgId}_${sftActivatingMsgId}`)
        .setLabel((dc.displayName || dc.dcName).slice(0, 80))
        .setStyle(ButtonStyle.Primary));
    }
    if (sftButtons.length === 0) {
      delete sftGame.pendingStillFaster;
      sftGame.stillFasterPlayerNum = null;
      await interaction.deferUpdate().catch(discordCatch);
      await interaction.followUp({ content: '**Still Faster Than You** — No eligible figures to interrupt with.', ephemeral: false }).catch(discordCatch);
      saveGames();
      return;
    }
    const sftRows = [];
    for (let i = 0; i < sftButtons.length; i += 5) sftRows.push(new ActionRowBuilder().addComponents(sftButtons.slice(i, i + 5)));
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: '**Still Faster Than You** — Choose which figure interrupts (move 2 + attack):', components: sftRows.slice(0, 5), ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  if (buttonKey === 'still_faster_dc_pick_') {
    const sftPending = sftGame.pendingStillFaster;
    if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch(discordCatch); return; }
    const { sftPlayerNum } = sftPending;
    if (!await requirePlayer(interaction, sftGame, interaction.user.id, sftPlayerNum, canActAsPlayer, 'Only the Still Faster Than You player may respond.')) return;
    // Grant 2MP to the picked DC's movement bank and a free attack (excluding the activating hostile)
    sftGame.movementBank = sftGame.movementBank || {};
    const sftBank = sftGame.movementBank[sftPickedMsgId] || { total: 0, remaining: 0 };
    sftBank.total = (sftBank.total ?? 0) + 2;
    sftBank.remaining = (sftBank.remaining ?? 0) + 2;
    sftGame.movementBank[sftPickedMsgId] = sftBank;
    // Free attack: mark this DC with a free attack, excluding the activating hostile
    sftGame.fellSwoopFreeAttack = sftGame.fellSwoopFreeAttack || {};
    sftGame.fellSwoopFreeAttack[sftPickedMsgId] = true;
    // Store exclusion so handleAttackTarget can reject wrong target
    sftGame.stillFasterExcludeMsgId = sftActivatingMsgId;
    // Clear the flag (once-per-round CC; clear so it can't be used again)
    sftGame.stillFasterPlayerNum = null;
    delete sftGame.pendingStillFaster;
    const sftMeta = dcMessageMeta.get(sftPickedMsgId);
    const sftLabel = sftMeta?.displayName || sftMeta?.dcName || sftPickedMsgId;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: `**Still Faster Than You** — **${sftLabel}** gains 2 MP and a free Attack. The attack must target a **different hostile** than the one that just activated.`, ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }
  return;
}

// ── 2. Squad Swarm ──────────────────────────────────────────────────────────
export async function handleSquadSwarm(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('squad_swarm_yes_') ? 'squad_swarm_yes_' : 'squad_swarm_no_';

  const _swParts = interaction.customId.split('_');
  // squad_swarm_yes_{gameId}_{msgId}_{targetMsgId} OR squad_swarm_no_{gameId}_{msgId}
  const _swGameId = _swParts[3]; const _swMsgId = _swParts[4]; const _swTargetMsgId = _swParts[5];
  const _swGame = await requireGame(interaction, getGame, _swGameId);
  if (!_swGame) return;
  const _swMeta = dcMessageMeta.get(_swMsgId);
  if (_swMeta && !await requirePlayer(interaction, _swGame, interaction.user.id, _swMeta.playerNum, canActAsPlayer, 'Only the Squad Swarm player may respond.')) return;
  _swGame.squadSwarmPlayerNum = null;
  if (buttonKey === 'squad_swarm_yes_') {
    // Keep cumulative cost so next activation continues the tally
    const _swTargetName = _swTargetMsgId ? (dcMessageMeta.get(_swTargetMsgId)?.displayName || 'another figure') : 'another figure';
    await logGameAction(_swGame, client, `**Squad Swarm** — Activating **${_swTargetName}**. Click its card to begin.`, { phase: 'ROUND', icon: 'activate' });
  } else {
    // G4: Clear cumulative cost when skipping
    delete _swGame.squadSwarmCumulativeCost;
    await logGameAction(_swGame, client, `**Squad Swarm** — Skipped.`, { phase: 'ROUND', icon: 'activate' });
  }
  saveGames(); return;
}

// ── 3. Overdrive ────────────────────────────────────────────────────────────
export async function handleOverdrive(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, dcHealthState, DC_ACTIONS_PER_ACTIVATION, updateDcActionsMessage, buildDcEmbedAndFiles, getConditionsForDcMessage, getNicknamesForDcMessage, getDcPlayAreaComponents } = ctx;

  const _odMsgId = interaction.customId.replace('overdrive_use_', '');
  const _odMeta = dcMessageMeta.get(_odMsgId);
  if (!_odMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  const _odGame = await requireGame(interaction, getGame, _odMeta.gameId);
  if (!_odGame) return;
  if (!await requirePlayer(interaction, _odGame, interaction.user.id, _odMeta.playerNum, canActAsPlayer, 'Only the DC owner can use Overdrive.')) return;
  const _odActionsData = _odGame.dcActionsData?.[_odMsgId];
  if (!_odActionsData) { await interaction.followUp({ content: 'No active activation found.', ephemeral: true }).catch(discordCatch); return; }
  const { prevHp: _odPrevHp, newHp: _odNewHp, maxHp: _odMaxHp } = reduceHp(dcHealthState, _odGame, _odMsgId, 0, 1, _odMeta.playerNum);
  const _odHS = dcHealthState.get(_odMsgId) || [];
  let _odHpNote = '';
  if (_odMaxHp > 0) {
    _odHpNote = ` (HP: ${_odPrevHp}→${_odNewHp})`;
  }
  _odActionsData.remaining = Math.min((_odActionsData.total ?? DC_ACTIONS_PER_ACTIVATION) + 1, (_odActionsData.remaining || 0) + 1);
  const _odDgIdx = (_odMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? 1;
  _odGame.overdriveUsedThisActivation = _odGame.overdriveUsedThisActivation || {};
  _odGame.overdriveUsedThisActivation[`${_odMeta.dcName}-${_odDgIdx}-0`] = true;
  await logGameAction(_odGame, client, `**Overdrive** — **${_odMeta.displayName || _odMeta.dcName}** took 1 Damage${_odHpNote}; +1 Action granted.`, { phase: 'ROUND', icon: 'activate' });
  await updateDcActionsMessage(_odGame, _odMsgId, client);
  const _odDisplayName = _odMeta.displayName || _odMeta.dcName;
  const { embed: _odEmbed, files: _odFiles } = await buildDcEmbedAndFiles(_odMeta.dcName, true, _odDisplayName, _odHS, getConditionsForDcMessage?.(_odGame, _odMeta), (_odGame?.p1DcAttachments?.[_odMsgId] || _odGame?.p2DcAttachments?.[_odMsgId] || []), null, null, getNicknamesForDcMessage?.(_odGame, _odMeta));
  try {
    const _odCh = await client.channels.fetch(_odMeta.playerNum === 1 ? _odGame.p1PlayAreaId : _odGame.p2PlayAreaId);
    const _odMsg = await _odCh.messages.fetch(_odMsgId);
    await _odMsg.edit({ embeds: [_odEmbed], files: _odFiles, components: getDcPlayAreaComponents(_odMsgId, true, _odGame, _odMeta.dcName) });
  } catch (err) { console.error('Overdrive embed refresh failed:', err); }
  saveGames(); return;
}

// ── 4. Self-Destruct Probe ──────────────────────────────────────────────────
export async function handleSelfDestructProbe(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapSpaces } = ctx;
  const buttonKey = interaction.customId.startsWith('self_destruct_probe_use_') ? 'self_destruct_probe_use_' : 'self_destruct_probe_skip_';

  const _sdpSuffix = interaction.customId.replace(buttonKey, '');
  const _sdpParts = _sdpSuffix.split('_');
  const _sdpGameId = _sdpParts[0]; const _sdpMsgId = _sdpParts.slice(1).join('_');
  const _sdpGame = await requireGame(interaction, getGame, _sdpGameId);
  if (!_sdpGame) return;
  const _sdpMeta = dcMessageMeta.get(_sdpMsgId);
  if (!_sdpMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, _sdpGame, interaction.user.id, _sdpMeta.playerNum, canActAsPlayer, 'Only the DC owner can respond.')) return;
  if (buttonKey === 'self_destruct_probe_skip_') {
    await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName} skipped.`, { phase: 'ROUND', icon: 'card' });
    saveGames(); return;
  }
  // Use: roll 1 red die, apply Hits to adjacent hostile figures, defeat probe
  const _sdpDiceData = getDiceData ? getDiceData() : null;
  const _sdpFaces = _sdpDiceData?.attack?.red || [];
  const _sdpFace = _sdpFaces[Math.floor(Math.random() * Math.max(_sdpFaces.length, 1))] || {};
  const _sdpHits = _sdpFace.dmg ?? 0;
  const _sdpFaceLabel = `${_sdpHits}H`;
  const _sdpPos = (() => { for (const [, pos] of Object.entries(_sdpGame.figurePositions?.[_sdpMeta.playerNum] || {})) { const fk = `${_sdpMeta.dcName}-1-0`; return _sdpGame.figurePositions?.[_sdpMeta.playerNum]?.[fk] || null; } return null; })();
  let _sdpResultLog = `Rolled red die: **${_sdpFaceLabel}** — `;
  if (_sdpHits > 0 && _sdpPos) {
    const _sdpMs = getMapSpaces ? getMapSpaces(_sdpGame.selectedMap?.id) : null;
    const _sdpAdj = _sdpMs?.adjacency?.[String(_sdpPos).toLowerCase()] || [];
    const _sdpAllAdjSpaces = new Set([String(_sdpPos).toLowerCase(), ..._sdpAdj.map(s => String(s).toLowerCase())]);
    const _sdpHostileNum = opponentPlayerNum(_sdpMeta.playerNum);
    const _sdpDamaged = [];
    for (const [_sdpFk, _sdpFkPos] of Object.entries(_sdpGame.figurePositions?.[_sdpHostileNum] || {})) {
      if (!_sdpFkPos || !_sdpAllAdjSpaces.has(String(_sdpFkPos).toLowerCase())) continue;
      let _sdpHMsgId = null;
      for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _sdpHostileNum && _sdpFk.startsWith(mm.dcName + '-')) { _sdpHMsgId = mid; break; } }
      if (!_sdpHMsgId) continue;
      const _sdpHM = dcMessageMeta.get(_sdpHMsgId);
      const _sdpFkMatch = _sdpFk.match(/^(.+)-(\d+)-(\d+)$/);
      if (!_sdpFkMatch) continue;
      const _sdpHFigIdx = parseInt(_sdpFkMatch[3], 10);
      const { prevHp: _hc, newHp: _hnc, maxHp: _sdpMaxHp } = reduceHp(dcHealthState, _sdpGame, _sdpHMsgId, _sdpHFigIdx, _sdpHits, _sdpHostileNum);
      if (_sdpMaxHp === 0 || _hc === null || _hc <= 0) continue;
      _sdpDamaged.push(`${_sdpHM?.displayName || _sdpFkMatch[1]} (HP: ${_hc}→${_hnc})`);
    }
    _sdpResultLog += _sdpDamaged.length ? _sdpDamaged.join(', ') : 'No adjacent hostiles.';
  } else {
    _sdpResultLog += 'No hits.';
  }
  // Defeat the probe
  const { maxHp: _sdpProbeMax } = reduceHp(dcHealthState, _sdpGame, _sdpMsgId, 0, 9999, _sdpMeta.playerNum);
  if (_sdpGame.figurePositions?.[_sdpMeta.playerNum]) delete _sdpGame.figurePositions[_sdpMeta.playerNum][`${_sdpMeta.dcName}-1-0`];
  await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName}: ${_sdpResultLog} Probe defeated.`, { phase: 'ROUND', icon: 'attack' });
  saveGames(); return;
}

// ── 5. Self-Destruct Protocol ───────────────────────────────────────────────
export async function handleSelfDestructProtocol(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapSpaces, applyDamageAndFinishCombat } = ctx;
  const buttonKey = interaction.customId.startsWith('self_destruct_protocol_use_') ? 'self_destruct_protocol_use_' : 'self_destruct_protocol_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _sdcpSuffix = interaction.customId.replace(buttonKey, '');
  const _sdcpParts = _sdcpSuffix.split('_');
  const _sdcpGameId = _sdcpParts[0]; const _sdcpTargetMsgId = _sdcpParts[1];
  const _sdcpGame = await requireGame(interaction, getGame, _sdcpGameId, { silent: true });
  if (!_sdcpGame) return;
  if (!_sdcpGame.pendingSelfDestruct) {
    await interaction.followUp({ content: 'No pending Self-Destruct Protocol.', ephemeral: true }).catch(discordCatch); return;
  }
  const _sdcpPending = _sdcpGame.pendingSelfDestruct;
  if (!await requirePlayer(interaction, _sdcpGame, interaction.user.id, _sdcpPending.defenderPlayerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  delete _sdcpGame.pendingSelfDestruct;
  const _sdcpCombat = _sdcpGame.pendingCombat;
  if (buttonKey === 'self_destruct_protocol_use_') {
    // Roll 1 red die, apply Hit results as Damage to adjacent hostile figures
    const _sdcpDiceData = getDiceData ? getDiceData() : null;
    const _sdcpFaces = _sdcpDiceData?.attack?.red || [];
    const _sdcpFace = _sdcpFaces[Math.floor(Math.random() * Math.max(_sdcpFaces.length, 1))] || {};
    const _sdcpHits = _sdcpFace.dmg ?? 0;
    const _sdcpFaceLabel = `${_sdcpHits}H`;
    const _sdcpFigKey = _sdcpCombat?.target?.figureKey;
    const _sdcpPos = _sdcpFigKey ? _sdcpGame.figurePositions?.[_sdcpPending.defenderPlayerNum]?.[_sdcpFigKey] : null;
    let _sdcpResultLog = `Rolled red die: **${_sdcpFaceLabel}** — `;
    if (_sdcpHits > 0 && _sdcpPos && _sdcpGame.selectedMap?.id) {
      const _sdcpMs = getMapSpaces ? getMapSpaces(_sdcpGame.selectedMap.id) : null;
      const _sdcpAdj = _sdcpMs?.adjacency?.[String(_sdcpPos).toLowerCase()] || [];
      const _sdcpAllAdj = new Set([String(_sdcpPos).toLowerCase(), ..._sdcpAdj.map(s => String(s).toLowerCase())]);
      const _sdcpHostileNum = opponentPlayerNum(_sdcpPending.defenderPlayerNum);
      const _sdcpDamaged = [];
      for (const [_sfk, _sfkPos] of Object.entries(_sdcpGame.figurePositions?.[_sdcpHostileNum] || {})) {
        if (!_sfkPos || !_sdcpAllAdj.has(String(_sfkPos).toLowerCase())) continue;
        if (_sfk === _sdcpFigKey) continue;
        let _sfkMsgId = null;
        for (const [_mid, _mm] of dcMessageMeta) { if (_mm.playerNum === _sdcpHostileNum && _sfk.startsWith(_mm.dcName + '-')) { _sfkMsgId = _mid; break; } }
        if (!_sfkMsgId) continue;
        const _sfkFigMatch = _sfk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!_sfkFigMatch) continue;
        const _sfkFigIdx = parseInt(_sfkFigMatch[3], 10);
        const { prevHp: _shc, newHp: _shnc, maxHp: _sfkMaxHp } = reduceHp(dcHealthState, _sdcpGame, _sfkMsgId, _sfkFigIdx, _sdcpHits, _sdcpHostileNum);
        if (_sfkMaxHp === 0 || _shc === null || _shc <= 0) continue;
        _sdcpDamaged.push(`${dcMessageMeta.get(_sfkMsgId)?.displayName || _sfkFigMatch[1]} (HP: ${_shc}→${_shnc})`);
      }
      _sdcpResultLog += _sdcpDamaged.length ? _sdcpDamaged.join(', ') : 'No adjacent hostiles.';
    } else {
      _sdcpResultLog += 'No hits.';
    }
    await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — ${_sdcpCombat?.target?.label || 'Figure'}: ${_sdcpResultLog}`, { phase: 'ROUND', icon: 'attack' });
  } else {
    await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — Skipped. ${_sdcpCombat?.target?.label || 'Figure'} is defeated.`, { phase: 'ROUND', icon: 'card' });
  }
  // Finalize defeat by re-calling applyDamageAndFinishCombat (SDP flag already set so no re-trigger)
  await applyDamageAndFinishCombat(_sdcpGame, _sdcpCombat, {
    damage: _sdcpPending.damage, hit: _sdcpPending.hit, resultText: _sdcpPending.resultText,
    totalBlast: _sdcpPending.totalBlast, defenderPlayerNum: _sdcpPending.defenderPlayerNum,
    attackerPlayerNum: _sdcpPending.attackerPlayerNum, ownerId: _sdcpPending.ownerId,
    targetMsgId: _sdcpPending.targetMsgId, targetFigIndex: _sdcpPending.targetFigIndex,
  }, client);
  saveGames(); return;
}

// ── 5b. You Have Something I Want (Moff Gideon) ────────────────────────────
export async function handleYHSIW(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction } = ctx;
  const isTransfer = interaction.customId.startsWith('yhsiw_transfer_');
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = interaction.customId.replace(isTransfer ? 'yhsiw_transfer_' : 'yhsiw_damage_', '');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingYHSIW) {
    await interaction.followUp({ content: 'No pending You Have Something I Want.', ephemeral: true }).catch(discordCatch); return;
  }
  const pending = game.pendingYHSIW;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.oppPlayerNum, canActAsPlayer, 'Only the targeted player may respond.')) return;
  delete game.pendingYHSIW;

  if (isTransfer) {
    // Transfer the token from target to Moff Gideon
    const { targetFk, token, gideonFk, gideonPlayerNum, oppPlayerNum } = pending;
    const isPowerToken = ['Block', 'Evade', 'Hit', 'Surge'].includes(token);
    if (isPowerToken) {
      // Remove from target
      const tTokens = game.figurePowerTokens?.[targetFk] || [];
      const tIdx = tTokens.indexOf(token);
      if (tIdx >= 0) tTokens.splice(tIdx, 1);
      // Add to Gideon
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[gideonFk] = game.figurePowerTokens[gideonFk] || [];
      if (game.figurePowerTokens[gideonFk].length < getMaxPowerTokens(gideonFk)) {
        game.figurePowerTokens[gideonFk].push(token);
      }
    } else {
      // Condition token: remove from target, apply to Gideon
      game.figureConditions = game.figureConditions || {};
      game.figureConditions[targetFk] = (game.figureConditions[targetFk] || []).filter(c => c !== token);
      game.figureConditions[gideonFk] = game.figureConditions[gideonFk] || [];
      if (!game.figureConditions[gideonFk].includes(token)) {
        game.figureConditions[gideonFk].push(token);
      }
    }
    const targetName = dcNameFromFigureKey(targetFk);
    await logGameAction(game, client, `**You Have Something I Want** — **${targetName}** transfers **${token}** to **Moff Gideon**.`, { phase: 'ROUND', icon: 'card' });
  } else {
    // Suffer 3 Damage
    const { targetFk, oppPlayerNum } = pending;
    const targetName = dcNameFromFigureKey(targetFk);
    let tMsgId = null;
    for (const [mid, mm] of dcMessageMeta) {
      if (mm.playerNum === oppPlayerNum && targetFk.startsWith(mm.dcName + '-')) { tMsgId = mid; break; }
    }
    if (tMsgId && dcHealthState) {
      const fkMatch = targetFk.match(/-(\d+)-(\d+)$/);
      const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
      const { prevHp, newHp } = reduceHp(dcHealthState, game, tMsgId, figIdx, 3, oppPlayerNum);
      await logGameAction(game, client, `**You Have Something I Want** — **${targetName}** suffers **3 Damage** (HP: ${prevHp}→${newHp}).`, { phase: 'ROUND', icon: 'attack' });
    } else {
      await logGameAction(game, client, `**You Have Something I Want** — **${targetName}** suffers **3 Damage** (apply manually).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Disable the buttons
  try { await interaction.message.edit({ components: [] }); } catch {}
  saveGames();
}

// ── 6. Last Resort ──────────────────────────────────────────────────────────
export async function handleLastResort(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapSpaces, applyDamageAndFinishCombat } = ctx;
  const buttonKey = interaction.customId.startsWith('last_resort_use_') ? 'last_resort_use_' : 'last_resort_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _lrSuffix = interaction.customId.replace(buttonKey, '');
  const _lrParts = _lrSuffix.split('_');
  const _lrGameId = _lrParts[0]; const _lrTargetMsgId = _lrParts[1];
  const _lrGame = await requireGame(interaction, getGame, _lrGameId, { silent: true });
  if (!_lrGame) return;
  if (!_lrGame.pendingLastResort) {
    await interaction.followUp({ content: 'No pending Last Resort.', ephemeral: true }).catch(discordCatch); return;
  }
  const _lrPending = _lrGame.pendingLastResort;
  if (!await requirePlayer(interaction, _lrGame, interaction.user.id, _lrPending.defenderPlayerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  delete _lrGame.pendingLastResort;
  const _lrCombat = _lrGame.pendingCombat;
  if (buttonKey === 'last_resort_use_') {
    // Deplete: remove Last Resort from attachments
    const _lrAttKey = dcAttachmentsKey(_lrPending.defenderPlayerNum);
    const _lrAtts = _lrGame[_lrAttKey]?.[_lrPending.targetMsgId];
    if (_lrAtts) {
      _lrGame[_lrAttKey][_lrPending.targetMsgId] = _lrAtts.filter(a => a !== 'Last Resort');
    }
    // Roll 1 red die, apply Hit results as Damage to adjacent figures (both players)
    const _lrDiceData = getDiceData ? getDiceData() : null;
    const _lrFaces = _lrDiceData?.attack?.red || [];
    const _lrFace = _lrFaces[Math.floor(Math.random() * Math.max(_lrFaces.length, 1))] || {};
    const _lrHits = _lrFace.dmg ?? 0;
    const _lrFaceLabel = `${_lrHits}H`;
    const _lrFigKey = _lrCombat?.target?.figureKey;
    const _lrPos = _lrFigKey ? _lrGame.figurePositions?.[_lrPending.defenderPlayerNum]?.[_lrFigKey] : null;
    let _lrResultLog = `Rolled red die: **${_lrFaceLabel}** — `;
    if (_lrHits > 0 && _lrPos && _lrGame.selectedMap?.id) {
      const _lrMs = getMapSpaces ? getMapSpaces(_lrGame.selectedMap.id) : null;
      const _lrAdj = _lrMs?.adjacency?.[String(_lrPos).toLowerCase()] || [];
      const _lrDamaged = [];
      for (const pn of [1, 2]) {
        for (const [_lfk, _lfkPos] of Object.entries(_lrGame.figurePositions?.[pn] || {})) {
          if (!_lfkPos) continue;
          if (_lfk === _lrFigKey) continue; // skip the dying figure itself
          if (!_lrAdj.includes(String(_lfkPos).toLowerCase()) && String(_lfkPos).toLowerCase() !== String(_lrPos).toLowerCase()) continue;
          let _lfkMsgId = null;
          for (const [_mid, _mm] of dcMessageMeta) { if (_mm.playerNum === pn && _lfk.startsWith(_mm.dcName + '-')) { _lfkMsgId = _mid; break; } }
          if (!_lfkMsgId) continue;
          const _lfkMatch = _lfk.match(/^(.+)-(\d+)-(\d+)$/);
          if (!_lfkMatch) continue;
          const _lfkFigIdx = parseInt(_lfkMatch[3], 10);
          const { prevHp: _lhc, newHp: _lhnc, maxHp: _lfkMaxHp } = reduceHp(dcHealthState, _lrGame, _lfkMsgId, _lfkFigIdx, _lrHits, pn);
          if (_lfkMaxHp === 0 || _lhc === null || _lhc <= 0) continue;
          _lrDamaged.push(`${dcMessageMeta.get(_lfkMsgId)?.displayName || _lfkMatch[1]} (HP: ${_lhc}→${_lhnc})`);
        }
      }
      _lrResultLog += _lrDamaged.length ? _lrDamaged.join(', ') : 'No adjacent figures.';
    } else {
      _lrResultLog += 'No hits.';
    }
    await logGameAction(_lrGame, client, `**Last Resort** — ${_lrCombat?.target?.label || 'Figure'}: ${_lrResultLog}`, { phase: 'ROUND', icon: 'attack' });
  } else {
    await logGameAction(_lrGame, client, `**Last Resort** — Skipped.`, { phase: 'ROUND', icon: 'card' });
  }
  // Finalize defeat by re-calling applyDamageAndFinishCombat (lastResortTriggered flag already set)
  await applyDamageAndFinishCombat(_lrGame, _lrCombat, {
    damage: _lrPending.damage, hit: _lrPending.hit, resultText: _lrPending.resultText,
    totalBlast: _lrPending.totalBlast, defenderPlayerNum: _lrPending.defenderPlayerNum,
    attackerPlayerNum: _lrPending.attackerPlayerNum, ownerId: _lrPending.ownerId,
    targetMsgId: _lrPending.targetMsgId, targetFigIndex: _lrPending.targetFigIndex,
  }, client);
  saveGames(); return;
}

// ── 7. Scavenged Walker ─────────────────────────────────────────────────────
export async function handleScavengedWalker(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('scavenged_walker_attack_') ? 'scavenged_walker_attack_' : 'scavenged_walker_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _swSuffix = interaction.customId.replace(buttonKey, '');
  const _swParts = _swSuffix.split('_');
  const _swGameId = _swParts[0]; const _swMsgId = _swParts[1];
  const _swGame = await requireGame(interaction, getGame, _swGameId);
  if (!_swGame) return;
  const _swMeta = dcMessageMeta.get(_swMsgId);
  if (!_swMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, _swGame, interaction.user.id, _swMeta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  if (buttonKey === 'scavenged_walker_attack_') {
    // Set -1 Hit penalty flag for the next attack from this DC
    _swGame.scavengedWalkerAttackPenalty = _swGame.scavengedWalkerAttackPenalty || {};
    _swGame.scavengedWalkerAttackPenalty[_swMsgId] = true;
    await logGameAction(_swGame, client, `**Scavenged Walker** — **${_swMeta.displayName || _swMeta.dcName}** will perform an interrupt attack with -1 Hit. Use the Attack button.`, { phase: 'ROUND', icon: 'card' });
  } else {
    await logGameAction(_swGame, client, `**Scavenged Walker** — **${_swMeta.displayName || _swMeta.dcName}** skipped end-of-round attack.`, { phase: 'ROUND', icon: 'card' });
  }
  saveGames(); return;
}

// ── 8. On a Diplomatic Mission ──────────────────────────────────────────────
export async function handleOnDiplomatic(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, checkWinConditions } = ctx;

  await interaction.deferUpdate().catch(discordCatch);
  const _odmSuffix = interaction.customId.replace('on_diplomatic_', '');
  const _odmParts = _odmSuffix.split('_');
  const _odmGameId = _odmParts[0]; const _odmMsgId = _odmParts[1]; const _odmChoice = _odmParts[2];
  const _odmGame = await requireGame(interaction, getGame, _odmGameId);
  if (!_odmGame) return;
  const _odmMeta = dcMessageMeta.get(_odmMsgId);
  if (!_odmMeta) {
    await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return;
  }
  if (!await requirePlayer(interaction, _odmGame, interaction.user.id, _odmMeta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  if (_odmChoice === 'skip') {
    await logGameAction(_odmGame, client, '**On a Diplomatic Mission** — Skipped.', { phase: 'ROUND', icon: 'card' });
  } else {
    // Exhaust the card
    _odmGame.exhaustedSkirmishUpgrades = _odmGame.exhaustedSkirmishUpgrades || {};
    _odmGame.exhaustedSkirmishUpgrades[_odmMsgId] = [...(_odmGame.exhaustedSkirmishUpgrades[_odmMsgId] || []), 'On a Diplomatic Mission'];
    if (_odmChoice === 'mp') {
      _odmGame.movementBank = _odmGame.movementBank || {};
      if (!_odmGame.movementBank[_odmMsgId]) {
        _odmGame.movementBank[_odmMsgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: _odmMeta.displayName || _odmMeta.dcName };
      } else {
        _odmGame.movementBank[_odmMsgId].total += 2;
        _odmGame.movementBank[_odmMsgId].remaining += 2;
      }
      await logGameAction(_odmGame, client, `**On a Diplomatic Mission** — **${_odmMeta.displayName || _odmMeta.dcName}** gains 2 MP.`, { phase: 'ROUND', icon: 'card' });
    } else if (_odmChoice === 'evade') {
      _odmGame.diplomaticMissionEvade = _odmGame.diplomaticMissionEvade || {};
      _odmGame.diplomaticMissionEvade[_odmMsgId] = true;
      await logGameAction(_odmGame, client, `**On a Diplomatic Mission** — **${_odmMeta.displayName || _odmMeta.dcName}** gains +1 Evade on defense for the rest of the round.`, { phase: 'ROUND', icon: 'card' });
    } else if (_odmChoice === 'vp') {
      awardObjectiveVp(_odmGame, _odmMeta.playerNum, 1);
      await logGameAction(_odmGame, client, `**On a Diplomatic Mission** — **${_odmMeta.displayName || _odmMeta.dcName}** gains 1 VP.`, { phase: 'ROUND', icon: 'card' });
      await checkWinConditions(_odmGame, client);
    }
  }
  saveGames(); return;
}

// ── 9. Behind Enemy Lines (Bel Reorder) ─────────────────────────────────────
export async function handleBelReorder(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('bel_reorder_1_') ? 'bel_reorder_1_' : 'bel_reorder_2_';

  const _belParts = interaction.customId.replace(buttonKey, '').split('_');
  const _belGameId = _belParts[0]; const _belCardIdx = parseInt(_belParts[1], 10);
  const _belGame = await requireGame(interaction, getGame, _belGameId, { silent: true });
  if (!_belGame) return;
  if (!_belGame.pendingBELReorder) { await interaction.followUp({ content: 'No pending deck reorder.', ephemeral: true }).catch(discordCatch); return; }
  const _belData = _belGame.pendingBELReorder;
  if (!await requirePlayer(interaction, _belGame, interaction.user.id, _belData.playerNum, canActAsPlayer, 'Only the card owner may reorder.')) return;
  if (buttonKey === 'bel_reorder_1_') {
    _belData.picked = [_belCardIdx];
    const _belRem = _belData.cards.filter((_, i) => i !== _belCardIdx);
    const _belBtns2 = _belRem.map((c, i) => {
      const _origIdx = _belData.cards.indexOf(c);
      return new ButtonBuilder().setCustomId(`bel_reorder_2_${_belGameId}_${_origIdx}`).setLabel(`2nd: ${c}`.slice(0, 80)).setStyle(ButtonStyle.Primary);
    });
    const _belHandId = _belData.playerNum === 1 ? _belGame.p1HandId : _belGame.p2HandId;
    const _belHandCh2 = await client.channels.fetch(_belHandId).catch(() => null);
    if (_belHandCh2) await _belHandCh2.send({ content: `**Behind Enemy Lines** — **${_belData.cards[_belCardIdx]}** goes 1st. Choose 2nd card:`, components: [new ActionRowBuilder().addComponents(..._belBtns2.slice(0, 5))] }).catch(discordCatch);
    saveGames(); return;
  }
  // bel_reorder_2_: finalize order
  const _belFirst = _belData.picked[0];
  const _belSecond = _belCardIdx;
  const _belThird = _belData.cards.findIndex((_, i) => i !== _belFirst && i !== _belSecond);
  const _belNewOrder = [_belData.cards[_belFirst], _belData.cards[_belSecond], _belData.cards[_belThird]];
  const _belDeck = _belGame[_belData.deckKey] || [];
  _belGame[_belData.deckKey] = [..._belNewOrder, ..._belDeck.slice(_belData.cards.length)];
  _belGame.pendingBELReorder = null;
  await logGameAction(_belGame, client, `**Behind Enemy Lines** — Opponent's deck top 3 reordered to: ${_belNewOrder.map(c => `**${c}**`).join(', ')}.`, { phase: 'ROUND', icon: 'card' });
  saveGames(); return;
}

// ── 10. Assassin's Blade pick ──────────────────────────────────────────────
// NEW PREFIX: ab_blade_pick_ — add to router.js
export async function handleAssassinsBladePickTarget(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // ab_blade_pick_{gameId}_{figureKey}
  const suffix = interaction.customId.replace('ab_blade_pick_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const figureKey = parts.slice(1).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingAssassinsBlade;
  if (!pending) { await interaction.followUp({ content: 'No pending Assassin\'s Blade.', ephemeral: true }).catch(discordCatch); return; }
  const { hits, rollStr, defenderPlayerNum, attackerPlayerNum } = pending;
  if (canActAsPlayer && !canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the attacker can pick the target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  delete game.pendingAssassinsBlade;
  const dcName = dcNameFromFigureKey(figureKey);
  // Find the DC message for this figure and apply damage
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== defenderPlayerNum || meta.dcName !== dcName) continue;
    const figIdx = parseFigureKey(figureKey).figureIndex;
    reduceHp(dcHealthState, game, msgId, figIdx, hits, defenderPlayerNum);
    break;
  }
  await interaction.message.edit({ content: `🗡️ **Assassin's Blade** — Rolled 1 red die: **${rollStr}**. **${dcName}** suffers **${hits} Damage**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `🗡️ **Assassin's Blade** — **${dcName}** suffers **${hits} Damage**.`, { phase: 'ROUND', icon: 'attack' });
  saveGames(); return;
}

// ── 11. Suppressive Fire MP pick ───────────────────────────────────────────
// NEW PREFIX: sf_mp_pick_ — add to router.js
export async function handleSuppressiveFireMpPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // sf_mp_pick_{gameId}_{figureKey}
  const suffix = interaction.customId.replace('sf_mp_pick_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const figureKey = parts.slice(1).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingSuppressiveFireMp;
  if (!pending) { await interaction.followUp({ content: 'No pending Suppressive Fire MP.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum } = pending;
  delete game.pendingSuppressiveFireMp;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the attacker may choose.')) return;
  const dcName = dcNameFromFigureKey(figureKey);
  // Find the msgId for this figure
  let targetMsgId = null;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== attackerPlayerNum || meta.dcName !== dcName) continue;
    targetMsgId = msgId;
    break;
  }
  if (!targetMsgId) { await interaction.followUp({ content: 'Could not find DC for this figure.', ephemeral: true }).catch(discordCatch); return; }
  game.movementBank = game.movementBank || {};
  if (!game.movementBank[targetMsgId]) {
    game.movementBank[targetMsgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: dcName };
  } else {
    game.movementBank[targetMsgId].total += 2;
    game.movementBank[targetMsgId].remaining += 2;
  }
  await interaction.message.edit({ content: `**Suppressive Fire** — **${dcName}** gains **2 MP**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Suppressive Fire** — **${dcName}** gains 2 MP.`, { phase: 'ROUND', icon: 'card' });
  saveGames(); return;
}

// ── 12. Force Slow pick ────────────────────────────────────────────────────
// NEW PREFIX: force_slow_pick_ — add to router.js
export async function handleForceSlowPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // force_slow_pick_{gameId}_{playerNum}_{figureKey}
  const suffix = interaction.customId.replace('force_slow_pick_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const ownerPlayerNum = parseInt(parts[1], 10);
  const figureKey = parts.slice(2).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, ownerPlayerNum, canActAsPlayer, 'Only the DC owner may choose.')) return;
  game.forceSlowSkipActivation = game.forceSlowSkipActivation || {};
  game.forceSlowSkipActivation[figureKey] = true;
  const dcName = dcNameFromFigureKey(figureKey);
  await interaction.message.edit({ content: `🐌 **Force Slow** — **${dcName}** will skip its next activation.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `🐌 **Force Slow** — **${dcName}** will skip its next activation.`, { phase: 'ROUND', icon: 'round' });
  saveGames(); return;
}

// ── 13. Excavation pick ────────────────────────────────────────────────────
// NEW PREFIX: excavation_pick_ — add to router.js
export async function handleExcavationPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, updateHandChannelMessages } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // excavation_pick_{gameId}_{playerNum}_{cardIndex}
  const suffix = interaction.customId.replace('excavation_pick_', '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const cardIndex = parseInt(parts[2], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the DC owner may choose.')) return;
  // Rest in Peace: block discard-pile retrieval
  if (game.restInPeaceActive) {
    await interaction.message.edit({ content: '**Excavation** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).', components: [] }).catch(discordCatch);
    return;
  }
  const discardKey = ccDiscardKey(playerNum);
  const handKey = ccHandKey(playerNum);
  const discard = game[discardKey] || [];
  if (cardIndex < 0 || cardIndex >= discard.length) {
    await interaction.followUp({ content: 'Invalid card selection.', ephemeral: true }).catch(discordCatch); return;
  }
  const cardName = discard[cardIndex];
  // Move card from discard to hand
  game[discardKey] = discard.filter((_, i) => i !== cardIndex);
  game[handKey] = game[handKey] || [];
  game[handKey].push(cardName);
  await interaction.message.edit({ content: `⛏️ **Excavation** — **${cardName}** moved from discard to hand.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `⛏️ **Excavation** — retrieved **${cardName}** from discard pile.`, { phase: 'ROUND', icon: 'round' });
  if (updateHandChannelMessages) await updateHandChannelMessages(game, client);
  saveGames(); return;
}

// ── 14. Driven by Hatred (Darth Vader EOR) ──────────────────────────────────
export async function handleDrivenByHatred(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);

  // Determine which button was pressed
  let buttonKey;
  if (interaction.customId.startsWith('dbh_force_choke_')) buttonKey = 'dbh_force_choke_';
  else if (interaction.customId.startsWith('dbh_attack_')) buttonKey = 'dbh_attack_';
  else buttonKey = 'dbh_skip_';

  const _dbhSuffix = interaction.customId.replace(buttonKey, '');
  const _dbhParts = _dbhSuffix.split('_');
  const _dbhGameId = _dbhParts[0]; const _dbhMsgId = _dbhParts[1];
  const _dbhGame = await requireGame(interaction, getGame, _dbhGameId);
  if (!_dbhGame) return;
  const _dbhMeta = dcMessageMeta.get(_dbhMsgId);
  if (!_dbhMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, _dbhGame, interaction.user.id, _dbhMeta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;

  const _dbhDisplayName = _dbhMeta.displayName || _dbhMeta.dcName;

  if (buttonKey === 'dbh_skip_') {
    await logGameAction(_dbhGame, client, `**Driven by Hatred** — **${_dbhDisplayName}** skipped end-of-round move + attack.`, { phase: 'ROUND', icon: 'card' });
  } else {
    // Grant 2 MP for movement
    _dbhGame.movementBank = _dbhGame.movementBank || {};
    if (!_dbhGame.movementBank[_dbhMsgId]) {
      _dbhGame.movementBank[_dbhMsgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: _dbhDisplayName };
    } else {
      _dbhGame.movementBank[_dbhMsgId].total += 2;
      _dbhGame.movementBank[_dbhMsgId].remaining += 2;
    }

    if (buttonKey === 'dbh_force_choke_') {
      // Flag that Vader should use Force Choke after moving (manual resolution — player uses Force Choke special action button)
      _dbhGame.drivenByHatredForceChoke = _dbhGame.drivenByHatredForceChoke || {};
      _dbhGame.drivenByHatredForceChoke[_dbhMsgId] = true;
      await logGameAction(_dbhGame, client, `**Driven by Hatred** — **${_dbhDisplayName}** gains 2 MP. After moving, use the **Force Choke** special action button.`, { phase: 'ROUND', icon: 'card' });
    } else {
      // dbh_attack_: Grant free attack with -1 die (remove weakest die from pool)
      _dbhGame.drivenByHatredAttackPenalty = _dbhGame.drivenByHatredAttackPenalty || {};
      _dbhGame.drivenByHatredAttackPenalty[_dbhMsgId] = true;
      _dbhGame.freeAttackBonusPending = _dbhGame.freeAttackBonusPending || {};
      _dbhGame.freeAttackBonusPending[_dbhMsgId] = true;
      await logGameAction(_dbhGame, client, `**Driven by Hatred** — **${_dbhDisplayName}** gains 2 MP. After moving, use the **Attack** button (1 die will be removed from the attack pool).`, { phase: 'ROUND', icon: 'card' });
    }
  }
  saveGames(); return;
}

// ── Submit or Fight (Paz Vizsla) ────────────────────────────────────────────
export async function handleSubmitOrFight(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction } = ctx;
  const isUse = interaction.customId.startsWith('submit_fight_use_');
  const prefix = isUse ? 'submit_fight_use_' : 'submit_fight_skip_';
  const suffix = interaction.customId.replace(prefix, '');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const figureIndex = parseInt(parts[parts.length - 1], 10);
  const msgId = parts.slice(1, -1).join('_');

  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  const meta = dcMessageMeta?.get(msgId);

  if (isUse) {
    const playerNum = meta?.playerNum || (game.player1Id === interaction.user.id ? 1 : 2);
    if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
    // Rest in Peace: block discard-pile access
    if (game.restInPeaceActive) {
      await interaction.message.edit({ content: '**Submit or Fight** — Blocked by **Rest in Peace** (cannot access discard piles this round).', components: [] }).catch(discordCatch);
      return;
    }
    const discardKey = `p${playerNum}CcDiscard`;
    const discard = game[discardKey] || [];
    if (discard.length === 0) {
      await interaction.followUp({ content: 'No CCs in discard pile.', ephemeral: true }).catch(discordCatch);
      return;
    }
    // Return last CC from discard to game box (permanently removed)
    const returnedCc = discard.pop();
    // Heal 1 HP (reverse the strain damage)
    const healthState = dcHealthState?.get(msgId);
    if (healthState?.[figureIndex]) {
      healthState[figureIndex][0] = Math.min(healthState[figureIndex][0] + 1, healthState[figureIndex][1]);
    }
    const dcName = meta?.dcName || 'Paz Vizsla';
    await interaction.message.edit({ content: `🛡️ **Submit or Fight** — **${dcName}** returned **${returnedCc}** to game box to heal 1 Strain damage.`, components: [] }).catch(discordCatch);
    if (logGameAction) {
      await logGameAction(game, client, `🛡️ **Submit or Fight** — **${dcName}** returned **${returnedCc}** to prevent Strain damage.`, { phase: 'ROUND', icon: 'defend' });
    }
  } else {
    await interaction.message.edit({ content: '**Submit or Fight** — Skipped.', components: [] }).catch(discordCatch);
  }
  saveGames();
}

// ── [Black Market] SU ────────────────────────────────────────────────────────
/**
 * Handle [Black Market] EOR choices: draw (spend VP), discard (gain VP), return to top, or skip.
 * Buttons: bm_draw_, bm_discard_, bm_return_, bm_skip_
 */
export async function handleBlackMarket(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcHealthState, dcMessageMeta, logGameAction, checkWinConditions } = ctx;
  await interaction.deferUpdate().catch(discordCatch);

  // Parse customId: bm_{choice}_{gameId}_{msgId}_{playerNum}
  const _bmPrefixes = ['bm_draw_', 'bm_discard_', 'bm_return_', 'bm_skip_'];
  const _bmPrefix = _bmPrefixes.find(p => interaction.customId.startsWith(p));
  if (!_bmPrefix) return;
  const _bmChoice = _bmPrefix.replace('bm_', '').replace(/_$/, ''); // draw | discard | return | skip
  const _bmSuffix = interaction.customId.replace(_bmPrefix, '');
  const _bmParts = _bmSuffix.split('_');
  const _bmGameId = _bmParts[0];
  const _bmMsgId = _bmParts[1];
  const _bmPn = parseInt(_bmParts[2], 10);

  const game = await requireGame(interaction, getGame, _bmGameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, _bmPn, canActAsPlayer, 'Only the card owner may respond.')) return;

  const pending = game.pendingBlackMarket?.[_bmPn];
  if (!pending) {
    await interaction.followUp({ content: '[Black Market] — No pending choice found.', ephemeral: true }).catch(discordCatch);
    return;
  }

  const { topCard, cardCost, smugglerFk, smugglerMsgId, smugglerFigIdx } = pending;
  const smugglerName = dcNameFromFigureKey(smugglerFk);
  const deckKey = _bmPn === 1 ? 'player1CcDeck' : 'player2CcDeck';

  if (_bmChoice === 'skip') {
    delete game.pendingBlackMarket[_bmPn];
    await interaction.message.edit({ content: '**[Black Market]** — Skipped. No Strain suffered.', components: [] }).catch(discordCatch);
    saveGames();
    return;
  }

  // Apply 1 Strain (= 1 HP damage) to the SMUGGLER
  const _bmHs = dcHealthState.get(smugglerMsgId);
  if (_bmHs?.[smugglerFigIdx] && Array.isArray(_bmHs[smugglerFigIdx])) {
    const [cur, max] = _bmHs[smugglerFigIdx];
    _bmHs[smugglerFigIdx] = [Math.max(0, (cur ?? max) - 1), max];
    dcHealthState.set(smugglerMsgId, _bmHs);
    // Sync to dcList
    const _bmDcIds = getDcMessageIds(game, _bmPn) || [];
    const _bmDcList = getDcList(game, _bmPn) || [];
    const _bmDcIdx = _bmDcIds.indexOf(smugglerMsgId);
    if (_bmDcIdx >= 0 && _bmDcList[_bmDcIdx]) _bmDcList[_bmDcIdx].healthState = [..._bmHs];
  }

  // Remove top card from deck (it was only peeked before)
  const deck = game[deckKey] || [];
  if (deck.length > 0 && deck[0] === topCard) {
    deck.shift();
  }

  let resultMsg = '';
  if (_bmChoice === 'draw') {
    // Spend VP equal to cost, draw the card
    if (cardCost > 0) {
      deductVp(game, _bmPn, cardCost);
    }
    const handKey = _bmPn === 1 ? 'player1CcHand' : 'player2CcHand';
    game[handKey] = [...(game[handKey] || []), topCard];
    resultMsg = `Drew **${topCard}** (spent ${cardCost} VP). **${smugglerName}** suffered 1 Strain.`;
  } else if (_bmChoice === 'discard') {
    // Discard the card, gain VP equal to cost
    const discardKey = _bmPn === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    game[discardKey] = [...(game[discardKey] || []), topCard];
    if (cardCost > 0) {
      awardObjectiveVp(game, _bmPn, cardCost);
    }
    resultMsg = `Discarded **${topCard}** (gained ${cardCost} VP). **${smugglerName}** suffered 1 Strain.`;
  } else if (_bmChoice === 'return') {
    // Return card to top of deck (put it back)
    deck.unshift(topCard);
    resultMsg = `Returned **${topCard}** to top of deck. **${smugglerName}** suffered 1 Strain.`;
  }

  delete game.pendingBlackMarket[_bmPn];
  await interaction.message.edit({ content: `**[Black Market]** — ${resultMsg}`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**[Black Market]** — ${resultMsg}`, { phase: 'ROUND', icon: 'card' });
  if (_bmChoice === 'draw' || _bmChoice === 'discard') {
    await checkWinConditions(game, client);
  }
  saveGames();
}

// ── Punishing Strike (Skirmish Upgrade) ─────────────────────────────────────
// ps_replace_{gameId}_{targetFigureKey}_{originalCondition}_{newCondition|skip}
export async function handlePunishingStrike(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const m = interaction.customId.match(/^ps_replace_([^_]+)_(.+?)_(Stun|Bleed|Weaken)_(Stun|Bleed|Weaken|skip)$/);
  if (!m) return;
  const [, gameId, targetFigureKey, originalCondition, choice] = m;
  const game = getGame(gameId);
  if (!game) return;
  const pending = game.pendingPunishingStrike;
  if (!pending) {
    await interaction.message.edit({ content: '**Punishing Strike** — No longer pending.', components: [] }).catch(discordCatch);
    return;
  }
  const attackerPn = pending.attackerPlayerNum;
  const playerId = getPlayerId(game, attackerPn);
  if (!canActAsPlayer(game, interaction.user.id, attackerPn)) {
    await interaction.reply({ content: 'Only the attacker\'s player can choose.', ephemeral: true }).catch(discordCatch);
    return;
  }

  if (choice === 'skip') {
    delete game.pendingPunishingStrike;
    await interaction.message.edit({ content: `**Punishing Strike** — Skipped. **${originalCondition}** remains on **${dcNameFromFigureKey(targetFigureKey)}**.`, components: [] }).catch(discordCatch);
    saveGames();
    return;
  }

  // Exhaust Punishing Strike
  const _psExhKey = `ps_army_p${attackerPn}`;
  game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
  game.exhaustedSkirmishUpgrades[_psExhKey] = [...(game.exhaustedSkirmishUpgrades[_psExhKey] || []), 'Punishing Strike'];

  // Remove original condition, apply new one
  filterCondition(game, targetFigureKey, originalCondition);
  applyCondition(game, targetFigureKey, choice);

  const targetName = dcNameFromFigureKey(targetFigureKey);
  delete game.pendingPunishingStrike;
  await interaction.message.edit({ content: `**Punishing Strike** — Exhausted: replaced **${originalCondition}** with **${choice}** on **${targetName}**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**[Punishing Strike]** — Replaced **${originalCondition}** with **${choice}** on **${targetName}**.`, { phase: 'ROUND', icon: 'card' });
  saveGames();
}

// ── Executor (Royal Guard Champion) ──────────────────────────────────────────
// When a friendly figure within 3 spaces is defeated, RGC may interrupt to
// move up to 2 spaces and then perform an attack. Limit once per round.
export async function handleExecutor(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, applyDamageAndFinishCombat } = ctx;
  const buttonKey = interaction.customId.startsWith('executor_use_') ? 'executor_use_' : 'executor_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _exSuffix = interaction.customId.replace(buttonKey, '');
  const _exParts = _exSuffix.split('_');
  const _exGameId = _exParts[0];
  const _exRgcMsgId = _exParts[1];
  const _exGame = await requireGame(interaction, getGame, _exGameId, { silent: true });
  if (!_exGame) return;
  if (!_exGame.pendingExecutorInterrupt) {
    await interaction.followUp({ content: 'No pending Executor interrupt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _exPending = _exGame.pendingExecutorInterrupt;
  if (!await requirePlayer(interaction, _exGame, interaction.user.id, _exPending.rgcPlayerNum, canActAsPlayer, 'Only the RGC owner may respond.')) return;
  delete _exGame.pendingExecutorInterrupt;
  const _exCombat = _exGame.pendingCombat;

  if (buttonKey === 'executor_use_') {
    // Mark once-per-round usage
    _exGame.roundFigureAbilityUsed = _exGame.roundFigureAbilityUsed || {};
    _exGame.roundFigureAbilityUsed[`${_exPending.rgcFigKey}_executor`] = true;

    // Grant 2 free movement points to RGC
    _exGame.movementBank = _exGame.movementBank || {};
    if (!_exGame.movementBank[_exPending.rgcMsgId]) {
      _exGame.movementBank[_exPending.rgcMsgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: _exPending.rgcDcName };
    } else {
      _exGame.movementBank[_exPending.rgcMsgId].total = (_exGame.movementBank[_exPending.rgcMsgId].total || 0) + 2;
      _exGame.movementBank[_exPending.rgcMsgId].remaining = (_exGame.movementBank[_exPending.rgcMsgId].remaining || 0) + 2;
    }

    // Grant free attack (next attack costs no action)
    _exGame.freeAttackBonusPending = _exGame.freeAttackBonusPending || {};
    _exGame.freeAttackBonusPending[_exPending.rgcMsgId] = true;

    await logGameAction(_exGame, client, `**Executor** — **${_exPending.rgcDcName}** gains 2 MP and a free attack (friendly **${_exPending.defeatedLabel}** defeated). Use Move/Attack buttons on the DC.`, { phase: 'ROUND', icon: 'card' });
  } else {
    await logGameAction(_exGame, client, `**Executor** — Skipped.`, { phase: 'ROUND', icon: 'card' });
  }

  // Finalize defeat by re-calling applyDamageAndFinishCombat (executorTriggered flag already set)
  await applyDamageAndFinishCombat(_exGame, _exCombat, {
    damage: _exPending.damage, hit: _exPending.hit, resultText: _exPending.resultText,
    totalBlast: _exPending.totalBlast, defenderPlayerNum: _exPending.defenderPlayerNum,
    attackerPlayerNum: _exPending.attackerPlayerNum, ownerId: _exPending.ownerId,
    targetMsgId: _exPending.targetMsgId, targetFigIndex: _exPending.targetFigIndex,
  }, client);
  saveGames();
  return;
}

// ── Extra Protection (Onar Koma CC) ─────────────────────────────────────────
// When another friendly figure within 2 spaces suffers 3+ Damage from an attack,
// Onar may play Extra Protection to move up to 2 spaces and perform an attack.
export async function handleExtraProtection(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, applyDamageAndFinishCombat } = ctx;
  const isPlay = interaction.customId.startsWith('extra_protection_play_');
  const buttonKey = isPlay ? 'extra_protection_play_' : 'extra_protection_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _epGameId = interaction.customId.replace(buttonKey, '');
  const _epGame = await requireGame(interaction, getGame, _epGameId, { silent: true });
  if (!_epGame) return;
  if (!_epGame.pendingExtraProtection) {
    await interaction.followUp({ content: 'No pending Extra Protection prompt.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const _epPending = _epGame.pendingExtraProtection;
  if (!await requirePlayer(interaction, _epGame, interaction.user.id, _epPending.playerNum, canActAsPlayer, 'Only the defending player may respond.')) return;
  delete _epGame.pendingExtraProtection;
  const _epCombat = _epGame.pendingCombat;

  if (isPlay) {
    // Remove Extra Protection from hand, add to discard
    const _epHandKey = _epPending.playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const _epDiscardKey = _epPending.playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const _epHand = _epGame[_epHandKey] || [];
    const _epIdx = _epHand.indexOf('Extra Protection');
    if (_epIdx >= 0) _epHand.splice(_epIdx, 1);
    _epGame[_epDiscardKey] = _epGame[_epDiscardKey] || [];
    _epGame[_epDiscardKey].push('Extra Protection');

    // Grant 2 free movement points to Onar Koma
    _epGame.movementBank = _epGame.movementBank || {};
    if (!_epGame.movementBank[_epPending.onarMsgId]) {
      _epGame.movementBank[_epPending.onarMsgId] = { total: 2, remaining: 2, threadId: null, messageId: null, displayName: _epPending.onarDcName };
    } else {
      _epGame.movementBank[_epPending.onarMsgId].total = (_epGame.movementBank[_epPending.onarMsgId].total || 0) + 2;
      _epGame.movementBank[_epPending.onarMsgId].remaining = (_epGame.movementBank[_epPending.onarMsgId].remaining || 0) + 2;
    }

    // Grant free attack (next attack costs no action)
    _epGame.freeAttackBonusPending = _epGame.freeAttackBonusPending || {};
    _epGame.freeAttackBonusPending[_epPending.onarMsgId] = true;

    await logGameAction(_epGame, client, `**Extra Protection** — **${_epPending.onarDcName}** plays Extra Protection! Gains 2 MP and a free attack. Use Move/Attack buttons on the DC.`, { phase: 'ROUND', icon: 'card' });
  } else {
    await logGameAction(_epGame, client, `**Extra Protection** — Skipped.`, { phase: 'ROUND', icon: 'card' });
  }

  // Continue post-combat flow by re-calling applyDamageAndFinishCombat
  // (extraProtectionTriggeredThisCombat flag prevents re-trigger)
  await applyDamageAndFinishCombat(_epGame, _epCombat, {
    damage: _epPending.damage, hit: _epPending.hit, resultText: _epPending.resultText,
    totalBlast: _epPending.totalBlast, defenderPlayerNum: _epPending.defenderPlayerNum,
    attackerPlayerNum: _epPending.attackerPlayerNum, ownerId: _epPending.ownerId,
    targetMsgId: _epPending.targetMsgId, targetFigIndex: _epPending.targetFigIndex,
  }, client);
  saveGames();
  return;
}
