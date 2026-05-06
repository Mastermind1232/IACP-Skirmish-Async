/**
 * Interrupt handlers: still_faster, squad_swarm, overdrive, self_destruct_probe,
 * self_destruct_protocol, last_resort, scavenged_walker, on_diplomatic, bel_reorder,
 * ab_blade_pick, sf_mp_pick, force_slow_pick, excavation_pick
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { getDcList, getDcMessageIds, getActivatedDcIndices, getPlayAreaId, dcAttachmentsKey, getHandChannelId, opponentPlayerNum, getPlayerId, getCcDiscard, getCcHand, ccHandKey, ccDiscardKey } from '../game/player-helpers.js';
import { reduceHp, healHp, awardObjectiveVp, deductVp, awardKillVp, dcNameFromFigureKey, parseFigureKey, getMaxPowerTokens, grantPowerTokens, applyCondition, filterCondition, grantMovementBank, HARMFUL_CONDITIONS } from '../game/index.js';
import { getCcEffect } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { resolveStartOfRoundEffect } from './round.js';
import { clearPendingLastResort, clearPendingPunishingStrike, clearPendingYHSIW, clearPendingSuppressiveFireMp, clearPendingAssassinsBlade, clearPendingStillFaster, clearPendingSelfDestruct, clearPendingExecutorInterrupt, clearPendingBELReorder } from '../game/interrupts.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';

// ── 1. Still Faster Than You ────────────────────────────────────────────────
export async function handleStillFaster(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('still_faster_dc_pick_') ? 'still_faster_dc_pick_'
    : interaction.customId.startsWith('still_faster_skip_') ? 'still_faster_skip_'
    : 'still_faster_use_';

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
    clearPendingStillFaster(sftGame);
    sftGame.stillFasterPlayerNum = null;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: '**Still Faster Than You** — Skipped.', ephemeral: false }).catch(discordCatch);
    saveGames(sftGame.gameId);
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
      clearPendingStillFaster(sftGame);
      sftGame.stillFasterPlayerNum = null;
      await interaction.deferUpdate().catch(discordCatch);
      await interaction.followUp({ content: '**Still Faster Than You** — No eligible figures to interrupt with.', ephemeral: false }).catch(discordCatch);
      saveGames(sftGame.gameId);
      return;
    }
    const sftRows = chunkButtonsToRows(sftButtons);
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: '**Still Faster Than You** — Choose which figure interrupts (move 2 + attack):', components: sftRows, ephemeral: false }).catch(discordCatch);
    saveGames(sftGame.gameId);
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
    clearPendingStillFaster(sftGame);
    const sftMeta = dcMessageMeta.get(sftPickedMsgId);
    const sftLabel = sftMeta?.displayName || sftMeta?.dcName || sftPickedMsgId;
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: `**Still Faster Than You** — **${sftLabel}** gains 2 MP and a free Attack. The attack must target a **different hostile** than the one that just activated.`, ephemeral: false }).catch(discordCatch);
    saveGames(sftGame.gameId);
    return;
  }
  return;
}

// ── 2. Squad Swarm ──────────────────────────────────────────────────────────
export async function handleSquadSwarm(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('squad_swarm_yes_') ? 'squad_swarm_yes_' : 'squad_swarm_no_';

  const _swParts = splitCustomId(interaction.customId, buttonKey);
  // squad_swarm_yes_{gameId}_{msgId}_{targetMsgId} OR squad_swarm_no_{gameId}_{msgId}
  const _swGameId = _swParts[0]; const _swMsgId = _swParts[1]; const _swTargetMsgId = _swParts[2];
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
  saveGames(_swGame.gameId); return;
}

// ── 3. Overdrive ────────────────────────────────────────────────────────────
export async function handleOverdrive(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, dcHealthState, DC_ACTIONS_PER_ACTIVATION, updateDcActionsMessage, renderDcEmbed, getDcPlayAreaComponents, processFigureDefeat } = ctx;

  const _odMsgId = parseCustomId(interaction.customId, 'overdrive_use_');
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
  const _odDefeatNote = _odNewHp <= 0 ? ' **(defeated)**' : '';
  await logGameAction(_odGame, client, `**Overdrive** — **${_odMeta.displayName || _odMeta.dcName}** took 1 Damage${_odHpNote}${_odDefeatNote}; +1 Action granted.`, { phase: 'ROUND', icon: 'activate' });
  if (_odNewHp <= 0 && processFigureDefeat) {
    const _odFigKey = `${_odMeta.dcName}-${_odDgIdx}-0`;
    await processFigureDefeat(_odGame, {
      defeatedPlayerNum: _odMeta.playerNum,
      figureKey: _odFigKey,
      attackerPlayerNum: opponentPlayerNum(_odMeta.playerNum),
      source: 'Overdrive',
    });
  }
  await updateDcActionsMessage(_odGame, _odMsgId, client);
  await updateDcCardMessage(client, _odGame, _odMsgId, ctx, { exhausted: true, errorContext: 'Overdrive embed refresh failed:' });
  saveGames(_odGame.gameId); return;
}

// ── 4. Self-Destruct Probe ──────────────────────────────────────────────────
export async function handleSelfDestructProbe(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapData, processFigureDefeat } = ctx;
  const buttonKey = interaction.customId.startsWith('self_destruct_probe_use_') ? 'self_destruct_probe_use_' : 'self_destruct_probe_skip_';

  const _sdpSuffix = parseCustomId(interaction.customId, buttonKey);
  const _sdpParts = _sdpSuffix.split('_');
  const _sdpGameId = _sdpParts[0]; const _sdpMsgId = _sdpParts.slice(1).join('_');
  const _sdpGame = await requireGame(interaction, getGame, _sdpGameId);
  if (!_sdpGame) return;
  const _sdpMeta = dcMessageMeta.get(_sdpMsgId);
  if (!_sdpMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, _sdpGame, interaction.user.id, _sdpMeta.playerNum, canActAsPlayer, 'Only the DC owner can respond.')) return;
  if (buttonKey === 'self_destruct_probe_skip_') {
    await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName} skipped.`, { phase: 'ROUND', icon: 'card' });
    saveGames(_sdpGame.gameId); return;
  }
  // Use: roll 1 red die, apply Hits to adjacent hostile figures, defeat probe
  const _sdpDiceData = getDiceData ? getDiceData() : null;
  const _sdpFaces = _sdpDiceData?.attack?.red || [];
  const _sdpFace = _sdpFaces[Math.floor(Math.random() * Math.max(_sdpFaces.length, 1))] || {};
  const _sdpHits = _sdpFace.dmg ?? 0;
  const _sdpFaceLabel = `${_sdpHits}H`;
  const _sdpPos = (() => { for (const [, pos] of Object.entries(_sdpGame.figurePositions?.[_sdpMeta.playerNum] || {})) { const fk = `${_sdpMeta.dcName}-1-0`; return _sdpGame.figurePositions?.[_sdpMeta.playerNum]?.[fk] || null; } return null; })();
  let _sdpResultLog = `Rolled red die: **${_sdpFaceLabel}** — `;
  const _sdpDamaged = [];
  const _sdpDefeated = [];
  if (_sdpHits > 0 && _sdpPos) {
    const _sdpMs = getMapData ? getMapData(_sdpGame.selectedMap?.id) : null;
    const _sdpAdj = _sdpMs?.adjacency?.[String(_sdpPos).toLowerCase()] || [];
    const _sdpAllAdjSpaces = new Set([String(_sdpPos).toLowerCase(), ..._sdpAdj.map(s => String(s).toLowerCase())]);
    const _sdpHostileNum = opponentPlayerNum(_sdpMeta.playerNum);
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
      const _sdpDefNote = _hnc <= 0 ? ' **(defeated)**' : '';
      _sdpDamaged.push(`${_sdpHM?.displayName || _sdpFkMatch[1]} (HP: ${_hc}→${_hnc})${_sdpDefNote}`);
      if (_hnc <= 0) _sdpDefeated.push({ figureKey: _sdpFk, playerNum: _sdpHostileNum });
    }
    _sdpResultLog += _sdpDamaged.length ? _sdpDamaged.join(', ') : 'No adjacent hostiles.';
  } else {
    _sdpResultLog += 'No hits.';
  }
  // Defeat the probe via centralized defeat pipeline
  reduceHp(dcHealthState, _sdpGame, _sdpMsgId, 0, 9999, _sdpMeta.playerNum);
  await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName}: ${_sdpResultLog}`, { phase: 'ROUND', icon: 'attack' });
  const _sdpFigureKey = `${_sdpMeta.dcName}-1-0`;
  await processFigureDefeat(_sdpGame, {
    defeatedPlayerNum: _sdpMeta.playerNum,
    figureKey: _sdpFigureKey,
    attackerPlayerNum: opponentPlayerNum(_sdpMeta.playerNum),
    msgId: _sdpMsgId,
    dcName: _sdpMeta.dcName,
    displayName: _sdpMeta.displayName || _sdpMeta.dcName,
    source: 'Self-Destruct',
  });
  // Process defeats of hostile figures damaged by the explosion
  for (const _sdpDf of _sdpDefeated) {
    await processFigureDefeat(_sdpGame, {
      defeatedPlayerNum: _sdpDf.playerNum,
      figureKey: _sdpDf.figureKey,
      attackerPlayerNum: _sdpMeta.playerNum,
      source: 'Self-Destruct Probe',
    });
  }
  saveGames(_sdpGame.gameId); return;
}

// ── 5. Self-Destruct Protocol ───────────────────────────────────────────────
//
// Card text (IG-11): "you may move up to 3 spaces and roll 1 red die. Each
// figure or object adjacent to you suffers Damage equal to the Hit results.
// Then, you are defeated."
//
// Two-step flow:
//   1) handleSelfDestructProtocol — owner clicks Use → post a destination
//      picker (cells reachable in ≤3 MP from current position) + a "Stay
//      here" button. Pending state migrates from pendingSelfDestruct to
//      pendingSelfDestructMove.
//   2) handleSelfDestructMovePick — owner clicks a destination or Stay →
//      update IG-11's position if a destination was picked, then run the
//      explosion (red die + adjacency damage) at the new position, then
//      finalize defeat via applyDamageAndFinishCombat.
//
// destruct 2026-05-06 corrections honored: damage only (no strain), each
// adjacent figure (friendly + hostile, IG-11 excluded), move-first wired.

async function _runSelfDestructExplode(game, pending, ctx) {
  const { client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapData, applyDamageAndFinishCombat, processFigureDefeat, saveGames } = ctx;
  const combat = game.pendingCombat;
  const diceData = getDiceData ? getDiceData() : null;
  const faces = diceData?.attack?.red || [];
  const face = faces[Math.floor(Math.random() * Math.max(faces.length, 1))] || {};
  const hits = face.dmg ?? 0;
  const faceLabel = `${hits} Hit${hits === 1 ? '' : 's'}`;
  const figKey = combat?.target?.figureKey;
  // Read CURRENT position (may have just been updated by movement pick).
  const pos = figKey ? game.figurePositions?.[pending.defenderPlayerNum]?.[figKey] : null;
  let resultLog = `Rolled red die: **${faceLabel}** — `;
  const damaged = [];
  const defeated = [];
  if (hits > 0 && pos && game.selectedMap?.id) {
    const ms = getMapData ? getMapData(game.selectedMap.id) : null;
    const adj = ms?.adjacency?.[String(pos).toLowerCase()] || [];
    const allAdj = new Set([String(pos).toLowerCase(), ...adj.map(s => String(s).toLowerCase())]);
    // Walk BOTH players' positions so friendly figures sharing IG-11's
    // adjacency also take damage (CRR "each adjacent figure").
    for (const eachPN of [1, 2]) {
      for (const [sfk, sfkPos] of Object.entries(game.figurePositions?.[eachPN] || {})) {
        if (!sfkPos || !allAdj.has(String(sfkPos).toLowerCase())) continue;
        // Exclude IG-11 itself (the source).
        if (eachPN === pending.defenderPlayerNum && sfk === figKey) continue;
        let sfkMsgId = null;
        for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === eachPN && sfk.startsWith(mm.dcName + '-')) { sfkMsgId = mid; break; } }
        if (!sfkMsgId) continue;
        const figMatch = sfk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!figMatch) continue;
        const sfkFigIdx = parseInt(figMatch[3], 10);
        // Damage = hits (NO strain — destruct 2026-05-06 confirmed
        // "No strain involved" for IG-11 Self-Destruct Protocol).
        const { prevHp, newHp, maxHp } = reduceHp(dcHealthState, game, sfkMsgId, sfkFigIdx, hits, eachPN);
        if (maxHp === 0 || prevHp === null || prevHp <= 0) { continue; }
        const defNote = newHp <= 0 ? ' **(defeated)**' : '';
        const sideLabel = eachPN === pending.defenderPlayerNum ? 'friendly' : 'hostile';
        damaged.push(`${sideLabel} ${dcMessageMeta.get(sfkMsgId)?.displayName || figMatch[1]} (HP: ${prevHp}→${newHp}, ${hits} Damage)${defNote}`);
        if (newHp <= 0) defeated.push({ figureKey: sfk, playerNum: eachPN });
      }
    }
    resultLog += damaged.length ? damaged.join('; ') : 'No adjacent figures.';
  } else {
    resultLog += 'No hits.';
  }
  await logGameAction(game, client, `**Self-Destruct Protocol** — ${combat?.target?.label || 'Figure'}: ${resultLog}`, { phase: 'ROUND', icon: 'attack' });
  // Process defeats from the explosion (canonical defeat pipeline).
  for (const df of defeated) {
    if (processFigureDefeat) {
      await processFigureDefeat(game, {
        defeatedPlayerNum: df.playerNum,
        figureKey: df.figureKey,
        attackerPlayerNum: pending.defenderPlayerNum,
        source: 'Self-Destruct Protocol',
      });
    }
  }
  // Finalize defeat by re-calling applyDamageAndFinishCombat (SDP flag already set so no re-trigger).
  await applyDamageAndFinishCombat(game, combat, {
    damage: pending.damage, hit: pending.hit, resultText: pending.resultText,
    totalBlast: pending.totalBlast, defenderPlayerNum: pending.defenderPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum, ownerId: pending.ownerId,
    targetMsgId: pending.targetMsgId, targetFigIndex: pending.targetFigIndex,
  }, client);
  saveGames(game.gameId);
}

export async function handleSelfDestructProtocol(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, getMapData, getBoardStateForMovement, getMovementProfile, computeMovementCache, computeSpacesReachable } = ctx;
  const buttonKey = interaction.customId.startsWith('self_destruct_protocol_use_') ? 'self_destruct_protocol_use_' : 'self_destruct_protocol_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _sdcpSuffix = parseCustomId(interaction.customId, buttonKey);
  const _sdcpParts = _sdcpSuffix.split('_');
  const _sdcpGameId = _sdcpParts[0];
  const _sdcpGame = await requireGame(interaction, getGame, _sdcpGameId, { silent: true });
  if (!_sdcpGame) return;
  if (!_sdcpGame.pendingSelfDestruct) {
    await interaction.followUp({ content: 'No pending Self-Destruct Protocol.', ephemeral: true }).catch(discordCatch); return;
  }
  const _sdcpPending = _sdcpGame.pendingSelfDestruct;
  if (!await requirePlayer(interaction, _sdcpGame, interaction.user.id, _sdcpPending.defenderPlayerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;

  if (buttonKey === 'self_destruct_protocol_skip_') {
    clearPendingSelfDestruct(_sdcpGame);
    const _sdcpCombat = _sdcpGame.pendingCombat;
    await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — Skipped. ${_sdcpCombat?.target?.label || 'Figure'} is defeated.`, { phase: 'ROUND', icon: 'card' });
    const { applyDamageAndFinishCombat } = ctx;
    await applyDamageAndFinishCombat(_sdcpGame, _sdcpCombat, {
      damage: _sdcpPending.damage, hit: _sdcpPending.hit, resultText: _sdcpPending.resultText,
      totalBlast: _sdcpPending.totalBlast, defenderPlayerNum: _sdcpPending.defenderPlayerNum,
      attackerPlayerNum: _sdcpPending.attackerPlayerNum, ownerId: _sdcpPending.ownerId,
      targetMsgId: _sdcpPending.targetMsgId, targetFigIndex: _sdcpPending.targetFigIndex,
    }, client);
    saveGames(_sdcpGame.gameId); return;
  }

  // Use → first prompt destination picker (cells reachable within 3 MP).
  const _sdcpCombat = _sdcpGame.pendingCombat;
  const _sdcpFigKey = _sdcpCombat?.target?.figureKey;
  const _sdcpDcName = _sdcpFigKey ? dcNameFromFigureKey(_sdcpFigKey) : null;
  const _sdcpPos = _sdcpFigKey ? _sdcpGame.figurePositions?.[_sdcpPending.defenderPlayerNum]?.[_sdcpFigKey] : null;
  let _sdcpDestinations = [];
  if (_sdcpPos && _sdcpGame.selectedMap?.id && getBoardStateForMovement && getMovementProfile && (computeSpacesReachable || computeMovementCache)) {
    const _sdcpBoard = getBoardStateForMovement(_sdcpGame, _sdcpFigKey);
    if (_sdcpBoard) {
      const _sdcpProfile = getMovementProfile(_sdcpDcName, _sdcpFigKey, _sdcpGame);
      // SDP card text: "you may move up to 3 spaces" — spaces semantics, not
      // MP. computeSpacesReachable forces ignoreDifficult + ignoreFigureCost
      // so each cell costs exactly 1 of the 3-space budget. Falls back to
      // computeMovementCache for older ctx wiring.
      const _sdcpCache = (computeSpacesReachable || computeMovementCache)(_sdcpPos, 3, _sdcpBoard, _sdcpProfile);
      for (const [coord, node] of _sdcpCache.cells.entries()) {
        if (!node.canEnd) continue;
        if (coord === String(_sdcpPos).toLowerCase()) continue;
        _sdcpDestinations.push(coord);
      }
    }
  }
  // Migrate pending state — same payload, separate slot so the original
  // "use/skip" flag stays cleared and can't fire twice.
  clearPendingSelfDestruct(_sdcpGame);
  _sdcpGame.pendingSelfDestructMove = { ..._sdcpPending };

  const _sdcpButtons = [];
  // Cap destination buttons to 20 (Discord row limit ≈ 5 rows × 5 buttons,
  // minus the Stay button = 24). Sort by coord for determinism.
  const _sdcpSortedDests = _sdcpDestinations.sort();
  for (const coord of _sdcpSortedDests.slice(0, 23)) {
    _sdcpButtons.push(
      new ButtonBuilder()
        .setCustomId(`sdp_move_pick_${_sdcpGame.gameId}_${coord}`)
        .setLabel(coord.toUpperCase())
        .setStyle(ButtonStyle.Primary)
    );
  }
  _sdcpButtons.push(
    new ButtonBuilder()
      .setCustomId(`sdp_move_skip_${_sdcpGame.gameId}`)
      .setLabel('Stay (explode here)')
      .setStyle(ButtonStyle.Secondary)
  );
  const _sdcpRows = chunkButtonsToRows(_sdcpButtons).slice(0, 5);
  const _sdcpOwnerId = _sdcpGame[`player${_sdcpPending.defenderPlayerNum}Id`];
  const _sdcpLabel = _sdcpCombat?.target?.label || _sdcpDcName || 'Figure';
  if (_sdcpDestinations.length === 0) {
    await logGameAction(_sdcpGame, client, `<@${_sdcpOwnerId}> **Self-Destruct Protocol** — **${_sdcpLabel}** has no reachable destinations within 3 MP. Click below to explode in place.`, { components: _sdcpRows, allowedMentions: { users: [_sdcpOwnerId] } });
  } else {
    await logGameAction(_sdcpGame, client, `<@${_sdcpOwnerId}> **Self-Destruct Protocol** — **${_sdcpLabel}** may move up to 3 spaces before exploding. Pick a destination or Stay:`, { components: _sdcpRows, allowedMentions: { users: [_sdcpOwnerId] } });
  }
  saveGames(_sdcpGame.gameId);
}

export async function handleSelfDestructMovePick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const isPick = interaction.customId.startsWith('sdp_move_pick_');
  const buttonKey = isPick ? 'sdp_move_pick_' : 'sdp_move_skip_';
  await interaction.deferUpdate().catch(discordCatch);
  const _suffix = parseCustomId(interaction.customId, buttonKey);
  const _parts = _suffix.split('_');
  const _gameId = _parts[0];
  const _destCoord = isPick ? _parts.slice(1).join('_').toLowerCase() : null;
  const _game = await requireGame(interaction, getGame, _gameId, { silent: true });
  if (!_game) return;
  const _pending = _game.pendingSelfDestructMove;
  if (!_pending) {
    await interaction.followUp({ content: 'No pending Self-Destruct movement.', ephemeral: true }).catch(discordCatch); return;
  }
  if (!await requirePlayer(interaction, _game, interaction.user.id, _pending.defenderPlayerNum, canActAsPlayer, 'Only the DC owner may pick.')) return;

  const _combat = _game.pendingCombat;
  const _figKey = _combat?.target?.figureKey;
  const _dcLabel = _combat?.target?.label || (_figKey ? dcNameFromFigureKey(_figKey) : 'Figure');

  if (isPick && _destCoord && _figKey) {
    // Move IG-11 to the chosen destination.
    if (!_game.figurePositions) _game.figurePositions = { 1: {}, 2: {} };
    if (!_game.figurePositions[_pending.defenderPlayerNum]) _game.figurePositions[_pending.defenderPlayerNum] = {};
    _game.figurePositions[_pending.defenderPlayerNum][_figKey] = _destCoord;
    await logGameAction(_game, client, `🚶 **Self-Destruct Protocol** — **${_dcLabel}** moves to **${_destCoord.toUpperCase()}** before exploding.`, { phase: 'ROUND', icon: 'card' });
  } else {
    await logGameAction(_game, client, `**Self-Destruct Protocol** — **${_dcLabel}** stays in place.`, { phase: 'ROUND', icon: 'card' });
  }

  // Run the explosion at IG-11's CURRENT position (may have been updated above).
  delete _game.pendingSelfDestructMove;
  await _runSelfDestructExplode(_game, _pending, ctx);
}

// ── 5b. You Have Something I Want (Moff Gideon) ────────────────────────────
export async function handleYHSIW(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, processFigureDefeat } = ctx;
  const isTransfer = interaction.customId.startsWith('yhsiw_transfer_');
  await interaction.deferUpdate().catch(discordCatch);
  const gameId = parseCustomId(interaction.customId, isTransfer ? 'yhsiw_transfer_' : 'yhsiw_damage_');
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingYHSIW) {
    await interaction.followUp({ content: 'No pending You Have Something I Want.', ephemeral: true }).catch(discordCatch); return;
  }
  const pending = game.pendingYHSIW;
  if (!await requirePlayer(interaction, game, interaction.user.id, pending.oppPlayerNum, canActAsPlayer, 'Only the targeted player may respond.')) return;
  clearPendingYHSIW(game);

  if (isTransfer) {
    // Transfer the token from target to Moff Gideon
    const { targetFk, token, gideonFk, gideonPlayerNum, oppPlayerNum } = pending;
    const isPowerToken = ['Block', 'Evade', 'Damage', 'Surge'].includes(token);
    if (isPowerToken) {
      // Remove from target
      const tTokens = game.figurePowerTokens?.[targetFk] || [];
      const tIdx = tTokens.indexOf(token);
      if (tIdx >= 0) tTokens.splice(tIdx, 1);
      // Add to Gideon
      grantPowerTokens(game, gideonFk, token, 1);
    } else {
      // Condition token: remove from target, apply to Gideon
      filterCondition(game, targetFk, token);
      applyCondition(game, gideonFk, token);
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
      const _yhDefNote = newHp <= 0 ? ' **(defeated)**' : '';
      await logGameAction(game, client, `**You Have Something I Want** — **${targetName}** suffers **3 Damage**${_yhDefNote} (HP: ${prevHp}→${newHp}).`, { phase: 'ROUND', icon: 'attack' });
      if (newHp <= 0 && processFigureDefeat) {
        await processFigureDefeat(game, {
          defeatedPlayerNum: oppPlayerNum,
          figureKey: targetFk,
          attackerPlayerNum: pending.gideonPlayerNum,
          source: 'You Have Something I Want',
        });
      }
    } else {
      await logGameAction(game, client, `**You Have Something I Want** — **${targetName}** suffers **3 Damage** (apply manually).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  // Disable the buttons
  try { await interaction.message.edit({ components: [] }); } catch {}
  saveGames(game.gameId);
}

// ── 6. Last Resort ──────────────────────────────────────────────────────────
export async function handleLastResort(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapData, applyDamageAndFinishCombat, processFigureDefeat } = ctx;
  const buttonKey = interaction.customId.startsWith('last_resort_use_') ? 'last_resort_use_' : 'last_resort_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _lrSuffix = parseCustomId(interaction.customId, buttonKey);
  const _lrParts = _lrSuffix.split('_');
  const _lrGameId = _lrParts[0]; const _lrTargetMsgId = _lrParts[1];
  const _lrGame = await requireGame(interaction, getGame, _lrGameId, { silent: true });
  if (!_lrGame) return;
  if (!_lrGame.pendingLastResort) {
    await interaction.followUp({ content: 'No pending Last Resort.', ephemeral: true }).catch(discordCatch); return;
  }
  const _lrPending = _lrGame.pendingLastResort;
  if (!await requirePlayer(interaction, _lrGame, interaction.user.id, _lrPending.defenderPlayerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  clearPendingLastResort(_lrGame);
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
    const _lrDamaged = [];
    const _lrDefeated = [];
    if (_lrHits > 0 && _lrPos && _lrGame.selectedMap?.id) {
      const _lrMs = getMapData ? getMapData(_lrGame.selectedMap.id) : null;
      const _lrAdj = _lrMs?.adjacency?.[String(_lrPos).toLowerCase()] || [];
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
          const _lrDefNote = _lhnc <= 0 ? ' **(defeated)**' : '';
          _lrDamaged.push(`${dcMessageMeta.get(_lfkMsgId)?.displayName || _lfkMatch[1]} (HP: ${_lhc}→${_lhnc})${_lrDefNote}`);
          if (_lhnc <= 0) _lrDefeated.push({ figureKey: _lfk, playerNum: pn });
        }
      }
      _lrResultLog += _lrDamaged.length ? _lrDamaged.join(', ') : 'No adjacent figures.';
    } else {
      _lrResultLog += 'No hits.';
    }
    await logGameAction(_lrGame, client, `**Last Resort** — ${_lrCombat?.target?.label || 'Figure'}: ${_lrResultLog}`, { phase: 'ROUND', icon: 'attack' });
    // Process defeats of figures damaged by the explosion
    for (const _lrDf of _lrDefeated) {
      if (processFigureDefeat) {
        await processFigureDefeat(_lrGame, {
          defeatedPlayerNum: _lrDf.playerNum,
          figureKey: _lrDf.figureKey,
          attackerPlayerNum: opponentPlayerNum(_lrDf.playerNum),
          source: 'Last Resort',
        });
      }
    }
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
  saveGames(_lrGame.gameId); return;
}

// ── 7. Scavenged Walker ─────────────────────────────────────────────────────
export async function handleScavengedWalker(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('scavenged_walker_attack_') ? 'scavenged_walker_attack_' : 'scavenged_walker_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _swSuffix = parseCustomId(interaction.customId, buttonKey);
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
  saveGames(_swGame.gameId); return;
}

// ── 8. On a Diplomatic Mission ──────────────────────────────────────────────
export async function handleOnDiplomatic(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, checkWinConditions } = ctx;

  await interaction.deferUpdate().catch(discordCatch);
  const _odmSuffix = parseCustomId(interaction.customId, 'on_diplomatic_');
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
      grantMovementBank(_odmGame, _odmMsgId, 2);
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
  saveGames(_odmGame.gameId); return;
}

// ── 9. Behind Enemy Lines (Bel Reorder) ─────────────────────────────────────
export async function handleBelReorder(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  const buttonKey = interaction.customId.startsWith('bel_reorder_1_') ? 'bel_reorder_1_' : 'bel_reorder_2_';

  const _belParts = splitCustomId(interaction.customId, buttonKey);
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
    const _belHandCh2 = await fetchGameChannel(client, _belHandId);
    if (_belHandCh2) await _belHandCh2.send({ content: `**Behind Enemy Lines** — **${_belData.cards[_belCardIdx]}** goes 1st. Choose 2nd card:`, components: [new ActionRowBuilder().addComponents(..._belBtns2.slice(0, 5))] }).catch(discordCatch);
    saveGames(_belGame.gameId); return;
  }
  // bel_reorder_2_: finalize order
  const _belFirst = _belData.picked[0];
  const _belSecond = _belCardIdx;
  const _belThird = _belData.cards.findIndex((_, i) => i !== _belFirst && i !== _belSecond);
  const _belNewOrder = [_belData.cards[_belFirst], _belData.cards[_belSecond], _belData.cards[_belThird]];
  const _belDeck = _belGame[_belData.deckKey] || [];
  _belGame[_belData.deckKey] = [..._belNewOrder, ..._belDeck.slice(_belData.cards.length)];
  clearPendingBELReorder(_belGame);
  await logGameAction(_belGame, client, `**Behind Enemy Lines** — Opponent's deck top 3 reordered to: ${_belNewOrder.map(c => `**${c}**`).join(', ')}.`, { phase: 'ROUND', icon: 'card' });
  saveGames(_belGame.gameId); return;
}

// ── 10. Assassin's Blade pick ──────────────────────────────────────────────
// NEW PREFIX: ab_blade_pick_ — add to router.js
export async function handleAssassinsBladePickTarget(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction, processFigureDefeat } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // ab_blade_pick_{gameId}_{figureKey}
  const suffix = parseCustomId(interaction.customId, 'ab_blade_pick_');
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
  clearPendingAssassinsBlade(game);
  const dcName = dcNameFromFigureKey(figureKey);
  // Find the DC message for this figure and apply damage
  let _abNewHp = null;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== gameId || meta.playerNum !== defenderPlayerNum || meta.dcName !== dcName) continue;
    const figIdx = parseFigureKey(figureKey).figureIndex;
    const result = reduceHp(dcHealthState, game, msgId, figIdx, hits, defenderPlayerNum);
    _abNewHp = result.newHp;
    break;
  }
  const _abDefNote = (_abNewHp !== null && _abNewHp <= 0) ? ' **(defeated)**' : '';
  await interaction.message.edit({ content: `🗡️ **Assassin's Blade** — Rolled 1 red die: **${rollStr}**. **${dcName}** suffers **${hits} Damage**${_abDefNote}.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `🗡️ **Assassin's Blade** — **${dcName}** suffers **${hits} Damage**${_abDefNote}.`, { phase: 'ROUND', icon: 'attack' });
  if (_abNewHp !== null && _abNewHp <= 0 && processFigureDefeat) {
    await processFigureDefeat(game, {
      defeatedPlayerNum: defenderPlayerNum,
      figureKey: figureKey,
      attackerPlayerNum: attackerPlayerNum,
      source: "Assassin's Blade",
    });
  }
  saveGames(game.gameId); return;
}

// ── 11. Suppressive Fire MP pick ───────────────────────────────────────────
// NEW PREFIX: sf_mp_pick_ — add to router.js
export async function handleSuppressiveFireMpPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // sf_mp_pick_{gameId}_{figureKey}
  const suffix = parseCustomId(interaction.customId, 'sf_mp_pick_');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const figureKey = parts.slice(1).join('_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingSuppressiveFireMp;
  if (!pending) { await interaction.followUp({ content: 'No pending Suppressive Fire MP.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum } = pending;
  clearPendingSuppressiveFireMp(game);
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
  grantMovementBank(game, targetMsgId, 2);
  await interaction.message.edit({ content: `**Suppressive Fire** — **${dcName}** gains **2 MP**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Suppressive Fire** — **${dcName}** gains 2 MP.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId); return;
}

// ── 12. Force Slow pick ────────────────────────────────────────────────────
// NEW PREFIX: force_slow_pick_ — add to router.js
export async function handleForceSlowPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // force_slow_pick_{gameId}_{playerNum}_{figureKey}
  const suffix = parseCustomId(interaction.customId, 'force_slow_pick_');
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
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId); return;
}

// ── 13. Excavation pick ────────────────────────────────────────────────────
// NEW PREFIX: excavation_pick_ — add to router.js
export async function handleExcavationPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, updateHandChannelMessages } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  // excavation_pick_{gameId}_{playerNum}_{cardIndex}
  const suffix = parseCustomId(interaction.customId, 'excavation_pick_');
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
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId); return;
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

  const _dbhSuffix = parseCustomId(interaction.customId, buttonKey);
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
    grantMovementBank(_dbhGame, _dbhMsgId, 2);

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
  saveGames(_dbhGame.gameId); return;
}

// ── Submit or Fight (Paz Vizsla) ────────────────────────────────────────────
export async function handleSubmitOrFight(interaction, ctx) {
  await interaction.deferUpdate().catch(discordCatch);
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, dcHealthState, logGameAction } = ctx;
  const isUse = interaction.customId.startsWith('submit_fight_use_');
  const prefix = isUse ? 'submit_fight_use_' : 'submit_fight_skip_';
  const suffix = parseCustomId(interaction.customId, prefix);
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
    // Heal 1 HP (reverse the strain damage) — uses healHp for Map+dcList sync
    if (dcHealthState) healHp(dcHealthState, game, msgId, figureIndex, 1, playerNum);
    const dcName = meta?.dcName || 'Paz Vizsla';
    await interaction.message.edit({ content: `🛡️ **Submit or Fight** — **${dcName}** returned **${returnedCc}** to game box to heal 1 Strain damage.`, components: [] }).catch(discordCatch);
    if (logGameAction) {
      await logGameAction(game, client, `🛡️ **Submit or Fight** — **${dcName}** returned **${returnedCc}** to prevent Strain damage.`, { phase: 'ROUND', icon: 'defend' });
    }
  } else {
    await interaction.message.edit({ content: '**Submit or Fight** — Skipped.', components: [] }).catch(discordCatch);
  }
  saveGames(game.gameId);
}

// ── [Black Market] SU ────────────────────────────────────────────────────────
/**
 * Handle [Black Market] EOR choices: draw (spend VP), discard (gain VP), return to top, or skip.
 * Buttons: bm_draw_, bm_discard_, bm_return_, bm_skip_
 */
export async function handleBlackMarket(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcHealthState, dcMessageMeta, logGameAction, checkWinConditions, processFigureDefeat } = ctx;
  await interaction.deferUpdate().catch(discordCatch);

  // Parse customId: bm_{choice}_{gameId}_{msgId}_{playerNum}
  const _bmPrefixes = ['bm_draw_', 'bm_discard_', 'bm_return_', 'bm_skip_'];
  const _bmPrefix = _bmPrefixes.find(p => interaction.customId.startsWith(p));
  if (!_bmPrefix) return;
  const _bmChoice = _bmPrefix.replace('bm_', '').replace(/_$/, ''); // draw | discard | return | skip
  const _bmSuffix = parseCustomId(interaction.customId, _bmPrefix);
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
    saveGames(game.gameId);
    return;
  }

  // Apply 1 Strain (= 1 HP damage) to the SMUGGLER via canonical reduceHp path
  const { prevHp: _bmPrevHp, newHp: _bmNewHp } = reduceHp(dcHealthState, game, smugglerMsgId, smugglerFigIdx, 1, _bmPn);
  const _bmDefeatNote = _bmNewHp <= 0 ? ' **(defeated)**' : '';
  if (_bmNewHp <= 0 && processFigureDefeat) {
    await processFigureDefeat(game, {
      defeatedPlayerNum: _bmPn,
      figureKey: smugglerFk,
      attackerPlayerNum: opponentPlayerNum(_bmPn),
      source: 'Black Market strain',
    });
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
    resultMsg = `Drew **${topCard}** (spent ${cardCost} VP). **${smugglerName}** suffered 1 Strain (HP: ${_bmPrevHp}→${_bmNewHp})${_bmDefeatNote}.`;
  } else if (_bmChoice === 'discard') {
    // Discard the card, gain VP equal to cost
    const discardKey = _bmPn === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    game[discardKey] = [...(game[discardKey] || []), topCard];
    if (cardCost > 0) {
      awardObjectiveVp(game, _bmPn, cardCost);
    }
    resultMsg = `Discarded **${topCard}** (gained ${cardCost} VP). **${smugglerName}** suffered 1 Strain (HP: ${_bmPrevHp}→${_bmNewHp})${_bmDefeatNote}.`;
  } else if (_bmChoice === 'return') {
    // Return card to top of deck (put it back)
    deck.unshift(topCard);
    resultMsg = `Returned **${topCard}** to top of deck. **${smugglerName}** suffered 1 Strain (HP: ${_bmPrevHp}→${_bmNewHp})${_bmDefeatNote}.`;
  }

  delete game.pendingBlackMarket[_bmPn];
  await interaction.message.edit({ content: `**[Black Market]** — ${resultMsg}`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**[Black Market]** — ${resultMsg}`, { phase: 'ROUND', icon: 'card' });
  await checkWinConditions(game, client);
  saveGames(game.gameId);
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
    clearPendingPunishingStrike(game);
    await interaction.message.edit({ content: `**Punishing Strike** — Skipped. **${originalCondition}** remains on **${dcNameFromFigureKey(targetFigureKey)}**.`, components: [] }).catch(discordCatch);
    saveGames(game.gameId);
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
  clearPendingPunishingStrike(game);
  await interaction.message.edit({ content: `**Punishing Strike** — Exhausted: replaced **${originalCondition}** with **${choice}** on **${targetName}**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**[Punishing Strike]** — Replaced **${originalCondition}** with **${choice}** on **${targetName}**.`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
}

// ── Executor (Royal Guard Champion) ──────────────────────────────────────────
// When a friendly figure within 3 spaces is defeated, RGC may interrupt to
// move up to 2 spaces and then perform an attack. Limit once per round.
export async function handleExecutor(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, applyDamageAndFinishCombat } = ctx;
  const buttonKey = interaction.customId.startsWith('executor_use_') ? 'executor_use_' : 'executor_skip_';

  await interaction.deferUpdate().catch(discordCatch);
  const _exSuffix = parseCustomId(interaction.customId, buttonKey);
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
  clearPendingExecutorInterrupt(_exGame);
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
  saveGames(_exGame.gameId);
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
  const _epGameId = parseCustomId(interaction.customId, buttonKey);
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
  saveGames(_epGame.gameId);
  return;
}
