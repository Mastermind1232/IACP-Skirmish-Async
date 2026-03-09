/**
 * Interrupt handlers: still_faster, squad_swarm, overdrive, self_destruct_probe,
 * self_destruct_protocol, last_resort, scavenged_walker, on_diplomatic, bel_reorder
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { getDcList, getDcMessageIds, getActivatedDcIndices, getPlayAreaId, dcAttachmentsKey, getHandChannelId, opponentPlayerNum } from '../game/player-helpers.js';
import { reduceHp, awardObjectiveVp } from '../game/index.js';
import { discordCatch } from '../error-handling.js';

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
  const sftGame = getGame(sftGameId);
  if (!sftGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(discordCatch); return; }

  if (buttonKey === 'still_faster_skip_') {
    const sftPlayerNum = sftGame.pendingStillFaster?.sftPlayerNum;
    if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch(discordCatch); return; }
    delete sftGame.pendingStillFaster;
    sftGame.stillFasterPlayerNum = null;
    await interaction.deferUpdate().catch(() => {});
    await interaction.followUp({ content: '**Still Faster Than You** — Skipped.', ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  if (buttonKey === 'still_faster_use_') {
    const sftPending = sftGame.pendingStillFaster;
    if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch(discordCatch); return; }
    const { sftPlayerNum } = sftPending;
    if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch(discordCatch); return; }
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
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: '**Still Faster Than You** — No eligible figures to interrupt with.', ephemeral: false }).catch(discordCatch);
      saveGames();
      return;
    }
    const sftRows = [];
    for (let i = 0; i < sftButtons.length; i += 5) sftRows.push(new ActionRowBuilder().addComponents(sftButtons.slice(i, i + 5)));
    await interaction.deferUpdate().catch(() => {});
    await interaction.followUp({ content: '**Still Faster Than You** — Choose which figure interrupts (move 2 + attack):', components: sftRows.slice(0, 5), ephemeral: false }).catch(discordCatch);
    saveGames();
    return;
  }

  if (buttonKey === 'still_faster_dc_pick_') {
    const sftPending = sftGame.pendingStillFaster;
    if (!sftPending) { await interaction.followUp({ content: 'No pending Still Faster Than You.', ephemeral: true }).catch(discordCatch); return; }
    const { sftPlayerNum } = sftPending;
    if (!canActAsPlayer(sftGame, interaction.user.id, sftPlayerNum)) { await interaction.followUp({ content: 'Only the Still Faster Than You player may respond.', ephemeral: true }).catch(discordCatch); return; }
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
    await interaction.deferUpdate().catch(() => {});
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
  const _swGame = getGame(_swGameId);
  if (!_swGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
  const _swMeta = dcMessageMeta.get(_swMsgId);
  if (_swMeta && !canActAsPlayer(_swGame, interaction.user.id, _swMeta.playerNum)) {
    await interaction.followUp({ content: 'Only the Squad Swarm player may respond.', ephemeral: true }).catch(() => {}); return;
  }
  _swGame.squadSwarmPlayerNum = null;
  if (buttonKey === 'squad_swarm_yes_') {
    const _swTargetName = _swTargetMsgId ? (dcMessageMeta.get(_swTargetMsgId)?.displayName || 'another figure') : 'another figure';
    await logGameAction(_swGame, client, `**Squad Swarm** — Activating **${_swTargetName}**. Click its card to begin.`, { phase: 'ROUND', icon: 'activate' });
  } else {
    await logGameAction(_swGame, client, `**Squad Swarm** — Skipped.`, { phase: 'ROUND', icon: 'activate' });
  }
  saveGames(); return;
}

// ── 3. Overdrive ────────────────────────────────────────────────────────────
export async function handleOverdrive(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, dcHealthState, DC_ACTIONS_PER_ACTIVATION, updateDcActionsMessage, buildDcEmbedAndFiles, getConditionsForDcMessage, getDcPlayAreaComponents } = ctx;

  const _odMsgId = interaction.customId.replace('overdrive_use_', '');
  const _odMeta = dcMessageMeta.get(_odMsgId);
  if (!_odMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(() => {}); return; }
  const _odGame = getGame(_odMeta.gameId);
  if (!_odGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
  if (!canActAsPlayer(_odGame, interaction.user.id, _odMeta.playerNum)) {
    await interaction.followUp({ content: 'Only the DC owner can use Overdrive.', ephemeral: true }).catch(() => {}); return;
  }
  const _odActionsData = _odGame.dcActionsData?.[_odMsgId];
  if (!_odActionsData) { await interaction.followUp({ content: 'No active activation found.', ephemeral: true }).catch(() => {}); return; }
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
  const { embed: _odEmbed, files: _odFiles } = await buildDcEmbedAndFiles(_odMeta.dcName, true, _odDisplayName, _odHS, getConditionsForDcMessage?.(_odGame, _odMeta), (_odGame?.p1DcAttachments?.[_odMsgId] || _odGame?.p2DcAttachments?.[_odMsgId] || []));
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
  const _sdpGame = getGame(_sdpGameId);
  if (!_sdpGame) { await interaction.followUp({ content: 'Game not found.', ephemeral: true }).catch(() => {}); return; }
  const _sdpMeta = dcMessageMeta.get(_sdpMsgId);
  if (!_sdpMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(() => {}); return; }
  if (!canActAsPlayer(_sdpGame, interaction.user.id, _sdpMeta.playerNum)) {
    await interaction.followUp({ content: 'Only the DC owner can respond.', ephemeral: true }).catch(() => {}); return;
  }
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

  await interaction.deferUpdate().catch(() => {});
  const _sdcpSuffix = interaction.customId.replace(buttonKey, '');
  const _sdcpParts = _sdcpSuffix.split('_');
  const _sdcpGameId = _sdcpParts[0]; const _sdcpTargetMsgId = _sdcpParts[1];
  const _sdcpGame = getGame(_sdcpGameId);
  if (!_sdcpGame || !_sdcpGame.pendingSelfDestruct) {
    await interaction.followUp({ content: 'No pending Self-Destruct Protocol.', ephemeral: true }).catch(() => {}); return;
  }
  const _sdcpPending = _sdcpGame.pendingSelfDestruct;
  if (!canActAsPlayer(_sdcpGame, interaction.user.id, _sdcpPending.defenderPlayerNum)) {
    await interaction.followUp({ content: 'Only the DC owner may respond.', ephemeral: true }).catch(() => {}); return;
  }
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

// ── 6. Last Resort ──────────────────────────────────────────────────────────
export async function handleLastResort(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapSpaces, applyDamageAndFinishCombat } = ctx;
  const buttonKey = interaction.customId.startsWith('last_resort_use_') ? 'last_resort_use_' : 'last_resort_skip_';

  await interaction.deferUpdate().catch(() => {});
  const _lrSuffix = interaction.customId.replace(buttonKey, '');
  const _lrParts = _lrSuffix.split('_');
  const _lrGameId = _lrParts[0]; const _lrTargetMsgId = _lrParts[1];
  const _lrGame = getGame(_lrGameId);
  if (!_lrGame || !_lrGame.pendingLastResort) {
    await interaction.followUp({ content: 'No pending Last Resort.', ephemeral: true }).catch(() => {}); return;
  }
  const _lrPending = _lrGame.pendingLastResort;
  if (!canActAsPlayer(_lrGame, interaction.user.id, _lrPending.defenderPlayerNum)) {
    await interaction.followUp({ content: 'Only the DC owner may respond.', ephemeral: true }).catch(() => {}); return;
  }
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

  await interaction.deferUpdate().catch(() => {});
  const _swSuffix = interaction.customId.replace(buttonKey, '');
  const _swParts = _swSuffix.split('_');
  const _swGameId = _swParts[0]; const _swMsgId = _swParts[1];
  const _swGame = getGame(_swGameId);
  const _swMeta = dcMessageMeta.get(_swMsgId);
  if (!_swGame || !_swMeta) { await interaction.followUp({ content: 'Game or DC not found.', ephemeral: true }).catch(() => {}); return; }
  if (!canActAsPlayer(_swGame, interaction.user.id, _swMeta.playerNum)) {
    await interaction.followUp({ content: 'Only the DC owner may respond.', ephemeral: true }).catch(() => {}); return;
  }
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

  await interaction.deferUpdate().catch(() => {});
  const _odmSuffix = interaction.customId.replace('on_diplomatic_', '');
  const _odmParts = _odmSuffix.split('_');
  const _odmGameId = _odmParts[0]; const _odmMsgId = _odmParts[1]; const _odmChoice = _odmParts[2];
  const _odmGame = getGame(_odmGameId);
  const _odmMeta = dcMessageMeta.get(_odmMsgId);
  if (!_odmGame || !_odmMeta) {
    await interaction.followUp({ content: 'Game or DC not found.', ephemeral: true }).catch(() => {}); return;
  }
  if (!canActAsPlayer(_odmGame, interaction.user.id, _odmMeta.playerNum)) {
    await interaction.followUp({ content: 'Only the DC owner may respond.', ephemeral: true }).catch(() => {}); return;
  }
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
  const _belGame = getGame(_belGameId);
  if (!_belGame || !_belGame.pendingBELReorder) { await interaction.followUp({ content: 'No pending deck reorder.', ephemeral: true }).catch(() => {}); return; }
  const _belData = _belGame.pendingBELReorder;
  if (!canActAsPlayer(_belGame, interaction.user.id, _belData.playerNum)) {
    await interaction.followUp({ content: 'Only the card owner may reorder.', ephemeral: true }).catch(() => {}); return;
  }
  if (buttonKey === 'bel_reorder_1_') {
    _belData.picked = [_belCardIdx];
    const _belRem = _belData.cards.filter((_, i) => i !== _belCardIdx);
    const _belBtns2 = _belRem.map((c, i) => {
      const _origIdx = _belData.cards.indexOf(c);
      return new ButtonBuilder().setCustomId(`bel_reorder_2_${_belGameId}_${_origIdx}`).setLabel(`2nd: ${c}`.slice(0, 80)).setStyle(ButtonStyle.Primary);
    });
    const _belHandId = _belData.playerNum === 1 ? _belGame.p1HandId : _belGame.p2HandId;
    const _belHandCh2 = await client.channels.fetch(_belHandId).catch(() => null);
    if (_belHandCh2) await _belHandCh2.send({ content: `**Behind Enemy Lines** — **${_belData.cards[_belCardIdx]}** goes 1st. Choose 2nd card:`, components: [new ActionRowBuilder().addComponents(..._belBtns2.slice(0, 5))] }).catch(() => {});
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
