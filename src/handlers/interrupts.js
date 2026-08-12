/**
 * Interrupt handlers: still_faster, squad_swarm, overdrive, self_destruct_probe,
 * self_destruct_protocol, last_resort, scavenged_walker, on_diplomatic, bel_reorder,
 * ab_blade_pick, sf_mp_pick, force_slow_pick, excavation_pick
 */
import { ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { parseCustomId, splitCustomId } from '../discord/custom-id.js';
import { chunkButtonsToRows } from '../discord/components.js';
import { getDcList, getDcMessageIds, dcAttachmentsKey, ccAttachmentsKey, getHandChannelId, opponentPlayerNum, getPlayerId, ccDiscardKey } from '../game/player-helpers.js';
import { reduceHp, healHp, awardObjectiveVp, deductVp, dcNameFromFigureKey, parseFigureKey, grantPowerTokens, applyCondition, filterCondition, grantMovementBank, grantImmediateMoveX, HARMFUL_CONDITIONS } from '../game/index.js';
import { getCcEffect } from '../data-loader.js';
import { discordCatch } from '../error-handling.js';
import { requireGame, requirePlayer } from '../utils/guards.js';
import { fetchGameChannel } from '../discord/channel-helpers.js';
import { resolveStartOfRoundEffect } from './round.js';
import { resumeSequenceAfterInterrupt } from './combat.js';
import { clearPendingLastResort, clearPendingPunishingStrike, clearPendingYHSIW, clearPendingSuppressiveFireMp, clearPendingSuppressiveFireOptin, clearPendingAssassinsBlade, clearPendingStillFaster, clearPendingSelfDestruct, clearPendingExecutorInterrupt, clearPendingBELReorder } from '../game/interrupts.js';
import { updateDcCardMessage } from '../engine/message-updaters.js';
import { applyDamage as _applyDamage } from '../game/damage-pipeline.js';
import { getDamageableObjectsAtCoord, applyDamageToObject } from '../game/object-damage-pipeline.js';
import { exhaustAttachment, isAttachmentExhausted } from '../game/card-state-helpers.js';
import { figureKeyForActivation } from '../game/activation-state.js';
import { cardNameIncludes } from '../game/card-names.js';

/**
 * Render a single rolled die FACE to a Discord attachment (mirrors combat).
 * Returns an array suitable for logGameAction's `files` option, or [] on any
 * failure — never throws into the interrupt flow. `die` = { color, faceIdx, ... }.
 */
async function _renderDieFiles(die) {
  try {
    if (!die || !(die.faceIdx >= 0)) return [];
    const { renderAttackDiceImage } = await import('../discord/dice-renderer.js');
    const img = await renderAttackDiceImage([die]).catch(() => null);
    if (!img) return [];
    const { AttachmentBuilder } = await import('discord.js');
    return [new AttachmentBuilder(img, { name: 'die-roll.png' })];
  } catch {
    return [];
  }
}

/** Compact text label for a red attack die face (e.g. "2 Damage, 1 Surge" / "Blank"). */
function _formatRedFace(face) {
  const parts = [];
  if (face?.dmg) parts.push(`${face.dmg} Damage`);
  if (face?.surge) parts.push(`${face.surge} Surge`);
  return parts.length ? parts.join(', ') : 'Blank';
}

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
    // CRR MOVE-017: 2-space Move-X (no bank, ignores extra costs).
    // Stamp the picker so the player walks 1 space at a time, then the
    // freeAttackPrompt continuation surfaces the "Declare Attack" UI.
    // Free-attack exclusion (must target a DIFFERENT hostile than the
    // activating one) is set via stillFasterExcludeMsgId before the
    // picker fires; handleAttackTarget reads it during the attack pass.
    sftGame.stillFasterExcludeMsgId = sftActivatingMsgId;
    sftGame.stillFasterPlayerNum = null;
    clearPendingStillFaster(sftGame);
    const sftMeta = dcMessageMeta.get(sftPickedMsgId);
    const sftLabel = sftMeta?.displayName || sftMeta?.dcName || sftPickedMsgId;
    const sftPickerFigKeys = sftPlayerNum === 1
      ? Object.keys(sftGame.figurePositions?.[1] || {}).filter(k => k.startsWith((sftMeta?.dcName || '') + '-'))
      : Object.keys(sftGame.figurePositions?.[2] || {}).filter(k => k.startsWith((sftMeta?.dcName || '') + '-'));
    const sftFigureKey = sftPickerFigKeys[0] || null;
    // Per alexanbv 2026-05-13: fellSwoopFreeAttack is figureKey-keyed.
    // Set after we've resolved the picked figure so the free attack
    // belongs to that specific figure.
    if (sftFigureKey) {
      sftGame.fellSwoopFreeAttack = sftGame.fellSwoopFreeAttack || {};
      sftGame.fellSwoopFreeAttack[sftFigureKey] = true;
    }
    if (!sftFigureKey) {
      await interaction.deferUpdate().catch(discordCatch);
      await interaction.followUp({ content: `**Still Faster Than You** — could not locate **${sftLabel}**'s figure; resolve manually.`, ephemeral: false }).catch(discordCatch);
      saveGames(sftGame.gameId);
      return;
    }
    const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
    stampPendingMoveX(sftGame, {
      msgId: sftPickedMsgId,
      figureKey: sftFigureKey,
      playerNum: sftPlayerNum,
      spaces: 2,
      source: 'Still Faster Than You',
      threadId: null,
      bypassCosts: true,
      nextAction: { type: 'freeAttackPrompt', payload: { msgId: sftPickedMsgId, label: 'Still Faster Than You', excludeMsgId: sftActivatingMsgId } },
    });
    await interaction.deferUpdate().catch(discordCatch);
    await interaction.followUp({ content: `**Still Faster Than You** — **${sftLabel}** moves up to 2 spaces, then gets a free Attack vs a **different hostile** than the one that just activated.`, ephemeral: false }).catch(discordCatch);
    await postMoveXPicker(sftGame, { client, logGameAction, saveGames }, sftPickedMsgId);
    saveGames(sftGame.gameId);
    return;
  }
  return;
}

// ── 2. Squad Swarm ──────────────────────────────────────────────────────────
// Squad Swarm's handleSquadSwarm handler was removed 2026-08-12. Its buttons
// were posted from handleDcEndActivation, which fires before the card can be
// played; the card now resolves in abilities.js on the Strength in Numbers
// timing (alexanbv), so nothing emits those customIds any more.

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
  // Overdrive: suffer 2 Damage to gain 1 additional action (CSV row 761;
  // was hardcoded to 1 — alexanbv 2026-06-20).
  const _odRes = await _applyDamage(_odGame, { dcHealthState, logGameAction, client: interaction.client }, {
    figureKey: `${_odMeta.dcName}-1-0`, msgId: _odMsgId, figIndex: 0,
    amount: 2, controllerPlayerNum: _odMeta.playerNum,
    source: 'Overdrive',
  });
  const _odPrevHp = _odRes.prevHp;
  const _odNewHp = _odRes.newHp;
  const _odMaxHp = dcHealthState.get(_odMsgId)?.[0]?.[1] ?? 0;
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
  await logGameAction(_odGame, client, `**Overdrive** — **${_odMeta.displayName || _odMeta.dcName}** took 2 Damage${_odHpNote}${_odDefeatNote}; +1 Action granted.`, { phase: 'ROUND', icon: 'activate' });
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

// ── Attachment exhaust: Ballistics Matrix ───────────────────────────────────
// CSV row 541: "Exhaust this card before you declare an attack; figures do not
// block line of sight during this attack." In-activation button surfaced on the
// wearer's DC (components.js). On click: if readied, exhaust + set
// nextAttackIgnoreFigureLOS for that figure's next attack (consumed at declare,
// already wired in combat-bridge). Re-arms at start of round (round.js).
export async function handleExhaustBallistics(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, updateDcActionsMessage } = ctx;
  const _bmMsgId = parseCustomId(interaction.customId, 'dc_exhaust_ballistics_');
  const _bmMeta = dcMessageMeta.get(_bmMsgId);
  if (!_bmMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  const _bmGame = await requireGame(interaction, getGame, _bmMeta.gameId);
  if (!_bmGame) return;
  if (!await requirePlayer(interaction, _bmGame, interaction.user.id, _bmMeta.playerNum, canActAsPlayer, 'Only the DC owner can exhaust this attachment.')) return;
  const _bmAttKey = ccAttachmentsKey(_bmMeta.playerNum);
  if (!cardNameIncludes(_bmGame[_bmAttKey]?.[_bmMsgId], 'Ballistics Matrix')) {
    await interaction.followUp({ content: 'Ballistics Matrix is not attached to this DC.', ephemeral: true }).catch(discordCatch); return;
  }
  if (isAttachmentExhausted(_bmGame, _bmMsgId, 'Ballistics Matrix')) {
    await interaction.followUp({ content: '**Ballistics Matrix** is already exhausted — it readies at the start of your next round.', ephemeral: true }).catch(discordCatch); return;
  }
  const _bmFk = figureKeyForActivation(_bmGame, _bmMsgId) || `${_bmMeta.dcName}-1-0`;
  _bmGame.nextAttackIgnoreFigureLOS = _bmGame.nextAttackIgnoreFigureLOS || {};
  _bmGame.nextAttackIgnoreFigureLOS[_bmFk] = true;
  exhaustAttachment(_bmGame, _bmMsgId, 'Ballistics Matrix');
  await logGameAction(_bmGame, client, `**Ballistics Matrix** — **${_bmMeta.displayName || _bmMeta.dcName}** exhausts the attachment: figures do **not** block line of sight for its next attack. (Exhausted — readies at the start of your next round.)`, { phase: 'ROUND', icon: 'card' });
  if (updateDcActionsMessage) await updateDcActionsMessage(_bmGame, _bmMsgId, client);
  await updateDcCardMessage(client, _bmGame, _bmMsgId, ctx, { exhausted: true, errorContext: 'Ballistics Matrix embed refresh failed:' });
  saveGames(_bmGame.gameId); return;
}

// ── Attachment exhaust: Navigation Upgrade ──────────────────────────────────
// CSV row 750: "Exhaust this card during a friendly DROID's activation; that
// figure gains 1 movement point." The attachment may live on a DIFFERENT
// friendly DC; the MP goes to the ACTIVATING DROID. Button surfaced on any
// friendly DROID's activation while a Navigation Upgrade attachment is readied
// (components.js). On click: locate the readied attachment, exhaust it, grant
// 1 MP to the activating DROID. Re-arms at start of round (round.js).
export async function handleExhaustNavUpgrade(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction, updateDcActionsMessage } = ctx;
  const _nuMsgId = parseCustomId(interaction.customId, 'dc_exhaust_navupgrade_');
  const _nuMeta = dcMessageMeta.get(_nuMsgId);
  if (!_nuMeta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  const _nuGame = await requireGame(interaction, getGame, _nuMeta.gameId);
  if (!_nuGame) return;
  if (!await requirePlayer(interaction, _nuGame, interaction.user.id, _nuMeta.playerNum, canActAsPlayer, 'Only the DC owner can exhaust this attachment.')) return;
  // Locate a readied Navigation Upgrade attachment among this player's DCs.
  const _nuAttKey = ccAttachmentsKey(_nuMeta.playerNum);
  const _nuAtts = _nuGame[_nuAttKey] || {};
  let _nuAttMsgId = null;
  for (const [mid, atts] of Object.entries(_nuAtts)) {
    if (cardNameIncludes(atts, 'Navigation Upgrade') && !isAttachmentExhausted(_nuGame, mid, 'Navigation Upgrade')) {
      _nuAttMsgId = mid; break;
    }
  }
  if (!_nuAttMsgId) {
    await interaction.followUp({ content: 'No readied **Navigation Upgrade** attachment — it readies at the start of your next round.', ephemeral: true }).catch(discordCatch); return;
  }
  // Grant 1 MP to the activating DROID (the figure whose activation this is).
  const _nuDgIdx = (_nuMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const _nuSelFig = _nuGame.dcActionsData?.[_nuMsgId]?.selectedFigure ?? 0;
  grantMovementBank(_nuGame, _nuMsgId, 1, _nuSelFig);
  exhaustAttachment(_nuGame, _nuAttMsgId, 'Navigation Upgrade');
  await logGameAction(_nuGame, client, `**Navigation Upgrade** — exhausted: **${_nuMeta.displayName || _nuMeta.dcName}** gains **1 MP**. (Exhausted — readies at the start of your next round.)`, { phase: 'ROUND', icon: 'card' });
  if (updateDcActionsMessage) await updateDcActionsMessage(_nuGame, _nuMsgId, client);
  await updateDcCardMessage(client, _nuGame, _nuAttMsgId, ctx, { exhausted: true, errorContext: 'Navigation Upgrade embed refresh failed:' }).catch(() => {});
  saveGames(_nuGame.gameId); return;
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
  const _sdpFaceIdx = _sdpFaces.length ? Math.floor(Math.random() * _sdpFaces.length) : -1;
  const _sdpFace = _sdpFaces[_sdpFaceIdx] || {};
  const _sdpHits = _sdpFace.dmg ?? 0;
  // Show the rolled die FACE in the game log (mirrors combat). Render to a buffer
  // and attach it to the roll-result message via logGameAction's `files`.
  const _sdpFiles = await _renderDieFiles({ color: 'red', faceIdx: _sdpFaceIdx, dmg: _sdpHits, surge: _sdpFace.surge ?? 0 });
  const _sdpFaceLabel = _formatRedFace(_sdpFace);
  const _sdpPos = (() => { for (const [, pos] of Object.entries(_sdpGame.figurePositions?.[_sdpMeta.playerNum] || {})) { const fk = `${_sdpMeta.dcName}-1-0`; return _sdpGame.figurePositions?.[_sdpMeta.playerNum]?.[fk] || null; } return null; })();
  let _sdpResultLog = `Rolled red die: **${_sdpFaceLabel}** — `;
  const _sdpDamaged = [];
  const _sdpDefeated = [];
  if (_sdpHits > 0 && _sdpPos) {
    const _sdpMs = getMapData ? getMapData(_sdpGame.selectedMap?.id) : null;
    const _sdpAdj = _sdpMs?.adjacency?.[String(_sdpPos).toLowerCase()] || [];
    const _sdpAllAdjSpaces = new Set([String(_sdpPos).toLowerCase(), ..._sdpAdj.map(s => String(s).toLowerCase())]);
    const _sdpProbeFk = `${_sdpMeta.dcName}-1-0`;
    // CSV: "each adjacent figure or object suffers Damage". Hit BOTH players'
    // figures (excluding the probe itself) AND any adjacent damageable object —
    // matching IG-11's Self-Destruct Protocol (alexanbv re-audit Jun 19).
    for (const _sdpPN of [1, 2]) {
      for (const [_sdpFk, _sdpFkPos] of Object.entries(_sdpGame.figurePositions?.[_sdpPN] || {})) {
        if (!_sdpFkPos || !_sdpAllAdjSpaces.has(String(_sdpFkPos).toLowerCase())) continue;
        if (_sdpPN === _sdpMeta.playerNum && _sdpFk === _sdpProbeFk) continue;
        let _sdpHMsgId = null;
        for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _sdpPN && _sdpFk.startsWith(mm.dcName + '-')) { _sdpHMsgId = mid; break; } }
        if (!_sdpHMsgId) continue;
        const _sdpHM = dcMessageMeta.get(_sdpHMsgId);
        const _sdpFkMatch = _sdpFk.match(/^(.+)-(\d+)-(\d+)$/);
        if (!_sdpFkMatch) continue;
        const _sdpHFigIdx = parseInt(_sdpFkMatch[3], 10);
        const _sdpRes = await _applyDamage(_sdpGame, { dcHealthState, logGameAction, client }, {
          figureKey: _sdpFk, msgId: _sdpHMsgId, figIndex: _sdpHFigIdx,
          amount: _sdpHits, controllerPlayerNum: _sdpPN,
          attackerPlayerNum: _sdpMeta.playerNum, source: 'Self-Destruct',
        });
        const _hc = _sdpRes.prevHp;
        const _hnc = _sdpRes.newHp;
        const _sdpMaxHp = dcHealthState.get(_sdpHMsgId)?.[_sdpHFigIdx]?.[1] ?? 0;
        if (_sdpMaxHp === 0 || _hc === null || _hc <= 0) continue;
        const _sdpDefNote = _hnc <= 0 ? ' **(defeated)**' : '';
        const _sdpSide = _sdpPN === _sdpMeta.playerNum ? 'friendly' : 'hostile';
        _sdpDamaged.push(`${_sdpSide} ${_sdpHM?.displayName || _sdpFkMatch[1]} (HP: ${_hc}→${_hnc})${_sdpDefNote}`);
        if (_hnc <= 0) _sdpDefeated.push({ figureKey: _sdpFk, playerNum: _sdpPN });
      }
    }
    // Adjacent damageable objects (crates / destructible mission objects).
    for (const _sdpSpace of _sdpAllAdjSpaces) {
      for (const _sdpObjId of getDamageableObjectsAtCoord(_sdpGame, _sdpSpace)) {
        const _sdpObjRes = await applyDamageToObject(_sdpGame, { logGameAction, client }, {
          objectId: _sdpObjId, amount: _sdpHits, attackerPlayerNum: _sdpMeta.playerNum, source: 'Self-Destruct',
        });
        if (_sdpObjRes.applied) {
          const _sdpObjName = _sdpGame.objectMeta?.[_sdpObjId]?.name || _sdpObjId;
          _sdpDamaged.push(`${_sdpObjName} (HP: ${_sdpObjRes.prevHp}→${_sdpObjRes.newHp})${_sdpObjRes.defeated ? ' **(destroyed)**' : ''}`);
        }
      }
    }
    _sdpResultLog += _sdpDamaged.length ? _sdpDamaged.join(', ') : 'No adjacent figures or objects.';
  } else {
    _sdpResultLog += 'No hits.';
  }
  // Defeat the probe via centralized defeat pipeline
  await _applyDamage(_sdpGame, { dcHealthState, logGameAction, client }, {
    figureKey: `${_sdpMeta.dcName}-1-0`, msgId: _sdpMsgId, figIndex: 0,
    amount: 9999, controllerPlayerNum: _sdpMeta.playerNum,
    source: 'Self-Destruct (probe defeats itself)',
  });
  await logGameAction(_sdpGame, client, `**Self-Destruct** — ${_sdpMeta.displayName || _sdpMeta.dcName}: ${_sdpResultLog}`, { phase: 'ROUND', icon: 'attack', ...(_sdpFiles.length ? { files: _sdpFiles } : {}) });
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

export async function _runSelfDestructExplode(game, pending, ctx) {
  const { client, dcMessageMeta, dcHealthState, logGameAction, getDiceData, getMapData, applyDamageAndFinishCombat, processFigureDefeat, saveGames } = ctx;
  const combat = game.pendingCombat;
  const diceData = getDiceData ? getDiceData() : null;
  const faces = diceData?.attack?.red || [];
  const _sdcFaceIdx = faces.length ? Math.floor(Math.random() * faces.length) : -1;
  const face = faces[_sdcFaceIdx] || {};
  const hits = face.dmg ?? 0;
  const faceLabel = `${hits} Hit${hits === 1 ? '' : 's'}`;
  // Show the rolled die FACE in the game log (mirrors combat).
  const _sdcFiles = await _renderDieFiles({ color: 'red', faceIdx: _sdcFaceIdx, dmg: hits, surge: face.surge ?? 0 });
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
        const _ig11Res = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
          figureKey: sfk, msgId: sfkMsgId, figIndex: sfkFigIdx,
          amount: hits, controllerPlayerNum: eachPN,
          attackerPlayerNum: pending.defenderPlayerNum, source: 'IG-11 Self-Destruct',
        });
        const prevHp = _ig11Res.prevHp;
        const newHp = _ig11Res.newHp;
        const maxHp = dcHealthState.get(sfkMsgId)?.[sfkFigIdx]?.[1] ?? 0;
        if (maxHp === 0 || prevHp === null || prevHp <= 0) { continue; }
        const defNote = newHp <= 0 ? ' **(defeated)**' : '';
        const sideLabel = eachPN === pending.defenderPlayerNum ? 'friendly' : 'hostile';
        damaged.push(`${sideLabel} ${dcMessageMeta.get(sfkMsgId)?.displayName || figMatch[1]} (HP: ${prevHp}→${newHp}, ${hits} Damage)${defNote}`);
        if (newHp <= 0) defeated.push({ figureKey: sfk, playerNum: eachPN });
      }
    }
    // Adjacent damageable objects (crates / destructible objects) — CSV: "each
    // figure OR OBJECT adjacent to you" (alexanbv 2026-06-20; objects were
    // previously skipped).
    for (const _igSpace of allAdj) {
      for (const _igObjId of getDamageableObjectsAtCoord(game, _igSpace)) {
        const _igObjRes = await applyDamageToObject(game, { logGameAction, client }, {
          objectId: _igObjId, amount: hits, attackerPlayerNum: pending.defenderPlayerNum, source: 'IG-11 Self-Destruct',
        });
        if (_igObjRes.applied) {
          const _igObjName = game.objectMeta?.[_igObjId]?.name || _igObjId;
          damaged.push(`${_igObjName} (HP: ${_igObjRes.prevHp}→${_igObjRes.newHp})${_igObjRes.defeated ? ' **(destroyed)**' : ''}`);
        }
      }
    }
    resultLog += damaged.length ? damaged.join('; ') : 'No adjacent figures or objects.';
  } else {
    resultLog += 'No hits.';
  }
  await logGameAction(game, client, `**Self-Destruct Protocol** — ${combat?.target?.label || 'Figure'}: ${resultLog}`, { phase: 'ROUND', icon: 'attack', ...(_sdcFiles.length ? { files: _sdcFiles } : {}) });
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
  // Finalize SDP figure's defeat via shared deferred-defeat helper.
  // Per destruct 2026-05-08 migration: HP already at 0 (BEFORE_DEFEATED
  // hook ran after reduceHp). completeDeferredDefeat fires
  // WHEN_DEFEATED hooks + processFigureDefeat.
  const { completeDeferredDefeat: _sdpComplete } = await import('../game/deferred-defeat.js');
  const _sdpFigKey = combat?.target?.figureKey;
  const _sdpFigIdxMatch = String(_sdpFigKey || '').match(/-(\d+)-(\d+)$/);
  const _sdpFigIdx = _sdpFigIdxMatch ? parseInt(_sdpFigIdxMatch[2], 10) : (pending.targetFigIndex ?? 0);
  await _sdpComplete(game, ctx, {
    figureKey: _sdpFigKey,
    msgId: pending.targetMsgId,
    figIndex: _sdpFigIdx,
    controllerPlayerNum: pending.defenderPlayerNum,
    attackerPlayerNum: pending.attackerPlayerNum,
    source: 'Self-Destruct Protocol',
  });
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
    // Skip → no splash, finalize the figure's defeat directly.
    const { completeDeferredDefeat: _sdpSkipComplete } = await import('../game/deferred-defeat.js');
    const _sdpSkipFigKey = _sdcpCombat?.target?.figureKey;
    const _sdpSkipFigIdxMatch = String(_sdpSkipFigKey || '').match(/-(\d+)-(\d+)$/);
    const _sdpSkipFigIdx = _sdpSkipFigIdxMatch ? parseInt(_sdpSkipFigIdxMatch[2], 10) : (_sdcpPending.targetFigIndex ?? 0);
    await _sdpSkipComplete(_sdcpGame, ctx, {
      figureKey: _sdpSkipFigKey,
      msgId: _sdcpPending.targetMsgId,
      figIndex: _sdpSkipFigIdx,
      controllerPlayerNum: _sdcpPending.defenderPlayerNum,
      attackerPlayerNum: _sdcpPending.attackerPlayerNum,
      source: 'Self-Destruct Protocol skipped',
    });
    saveGames(_sdcpGame.gameId); return;
  }

  // Use → route through the unified Move-X picker. The picker's
  // "Stop (discard remaining)" button replaces the legacy
  // "Stay (explode here)" affordance. After the picker drains
  // (exhaust budget OR Stop), the sdpExplode continuation runs
  // _runSelfDestructExplode at IG-11's current position.
  const _sdcpCombat = _sdcpGame.pendingCombat;
  const _sdcpFigKey = _sdcpCombat?.target?.figureKey;
  clearPendingSelfDestruct(_sdcpGame);
  if (!_sdcpFigKey) {
    await logGameAction(_sdcpGame, client, `**Self-Destruct Protocol** — figure missing; resolving manually.`, { phase: 'ROUND', icon: 'card' });
    saveGames(_sdcpGame.gameId);
    return;
  }
  const _sdcpFigIdxMatch = String(_sdcpFigKey).match(/-(\d+)-(\d+)$/);
  const _sdcpFigIdx = _sdcpFigIdxMatch ? parseInt(_sdcpFigIdxMatch[2], 10) : 0;
  // Stamp pendingMoveX with the sdpExplode continuation BEFORE
  // posting the picker — postMoveXPicker may auto-finish on zero
  // legal destinations, which now routes through _finishPicker so
  // the continuation still fires (figure stays put, explodes).
  const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
  stampPendingMoveX(_sdcpGame, {
    msgId: _sdcpPending.targetMsgId,
    figureKey: _sdcpFigKey,
    playerNum: _sdcpPending.defenderPlayerNum,
    spaces: 3,
    source: 'Self-Destruct Protocol',
    threadId: null,
    nextAction: {
      type: 'sdpExplode',
      payload: {
        defenderPlayerNum: _sdcpPending.defenderPlayerNum,
        attackerPlayerNum: _sdcpPending.attackerPlayerNum,
        targetMsgId: _sdcpPending.targetMsgId,
        targetFigIndex: _sdcpFigIdx,
      },
    },
  });
  await postMoveXPicker(_sdcpGame, { client, logGameAction, saveGames, dcMessageMeta: ctx.dcMessageMeta, dcHealthState: ctx.dcHealthState, getDiceData: ctx.getDiceData, getMapData: ctx.getMapData, processFigureDefeat: ctx.processFigureDefeat, applyDamageAndFinishCombat: ctx.applyDamageAndFinishCombat }, _sdcpPending.targetMsgId);
  saveGames(_sdcpGame.gameId);
}

// handleSelfDestructMovePick removed — destination picker is now the
// unified Move-X picker (move_x_step_ / move_x_done_) and the
// explosion fires from move-x-handler's `sdpExplode` continuation.

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
      // Condition token: per destruct 2026-05-07, if Gideon already
      // has the condition the target just loses it (no double-apply).
      // If Gideon does not have it yet, transfer = target loses it +
      // Gideon gains it.
      filterCondition(game, targetFk, token);
      const _gConds = game.figureConditions?.[gideonFk] || [];
      if (!_gConds.includes(token)) applyCondition(game, gideonFk, token);
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
      const _yhRes = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
        figureKey: targetFk, msgId: tMsgId, figIndex: figIdx,
        amount: 3, controllerPlayerNum: oppPlayerNum,
        source: 'You Have Something I Want',
      });
      const prevHp = _yhRes.prevHp;
      const newHp = _yhRes.newHp;
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
    const _lrFaceIdx = _lrFaces.length ? Math.floor(Math.random() * _lrFaces.length) : -1;
    const _lrFace = _lrFaces[_lrFaceIdx] || {};
    const _lrHits = _lrFace.dmg ?? 0;
    // Show the rolled die FACE in the game log (mirrors combat).
    const _lrFiles = await _renderDieFiles({ color: 'red', faceIdx: _lrFaceIdx, dmg: _lrHits, surge: _lrFace.surge ?? 0 });
    const _lrFaceLabel = _formatRedFace(_lrFace);
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
          const _lrRes = await _applyDamage(_lrGame, { dcHealthState, logGameAction, client }, {
            figureKey: _lfk, msgId: _lfkMsgId, figIndex: _lfkFigIdx,
            amount: _lrHits, controllerPlayerNum: pn,
            source: 'Last Resort',
          });
          const _lhc = _lrRes.prevHp;
          const _lhnc = _lrRes.newHp;
          const _lfkMaxHp = dcHealthState.get(_lfkMsgId)?.[_lfkFigIdx]?.[1] ?? 0;
          if (_lfkMaxHp === 0 || _lhc === null || _lhc <= 0) continue;
          const _lrDefNote = _lhnc <= 0 ? ' **(defeated)**' : '';
          _lrDamaged.push(`${dcMessageMeta.get(_lfkMsgId)?.displayName || _lfkMatch[1]} (HP: ${_lhc}→${_lhnc})${_lrDefNote}`);
          if (_lhnc <= 0) _lrDefeated.push({ figureKey: _lfk, playerNum: pn });
        }
      }
      // Spec (combat-spec.csv:49): "each figure AND object on or adjacent to it
      // suffers Damage." Also damage neutral NPCs (thugs/krykna) and damageable
      // objects on or adjacent to the dying figure's space. Mirror Self-Destruct
      // (object loop) and the Blast pipeline (NPC loop).
      const _lrExplosionSpaces = [String(_lrPos).toLowerCase(), ..._lrAdj.map((s) => String(s).toLowerCase())];
      const _lrAttackerPn = opponentPlayerNum(_lrPending.defenderPlayerNum);
      // Neutral NPCs (thugs / krykna) on or adjacent to the dying figure.
      try {
        const { applyDamageToNpc } = await import('../game/hostile-enumeration.js');
        const { awardObjectiveVp: _lrVp } = await import('../game/vp-helpers.js');
        for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
          const arr = _lrGame[arrName];
          if (!Array.isArray(arr)) continue;
          for (let i = 0; i < arr.length; i++) {
            const npc = arr[i];
            if (!npc || npc.defeated) continue;
            if (!_lrExplosionSpaces.includes(String(npc.coord).toLowerCase())) continue;
            const _lrNpcRes = await applyDamageToNpc(_lrGame, { logGameAction, client, awardObjectiveVp: _lrVp }, {
              npcType, npcIndex: i, amount: _lrHits, attackerPlayerNum: _lrAttackerPn, source: 'Last Resort',
            });
            if (_lrNpcRes?.applied) {
              _lrDamaged.push(`${npcType} (HP: ${_lrNpcRes.prevHp}→${_lrNpcRes.newHp})${_lrNpcRes.defeated ? ' **(defeated)**' : ''}`);
            }
          }
        }
      } catch (err) {
        console.error('[lastResort] npc damage iteration failed:', err?.message ?? err);
      }
      // Damageable objects (crates / destructible mission objects).
      for (const _lrSpace of _lrExplosionSpaces) {
        for (const _lrObjId of getDamageableObjectsAtCoord(_lrGame, _lrSpace)) {
          const _lrObjRes = await applyDamageToObject(_lrGame, { logGameAction, client }, {
            objectId: _lrObjId, amount: _lrHits, attackerPlayerNum: _lrAttackerPn, source: 'Last Resort',
          });
          if (_lrObjRes.applied) {
            const _lrObjName = _lrGame.objectMeta?.[_lrObjId]?.name || _lrObjId;
            _lrDamaged.push(`${_lrObjName} (HP: ${_lrObjRes.prevHp}→${_lrObjRes.newHp})${_lrObjRes.defeated ? ' **(destroyed)**' : ''}`);
          }
        }
      }
      _lrResultLog += _lrDamaged.length ? _lrDamaged.join(', ') : 'No adjacent figures or objects.';
    } else {
      _lrResultLog += 'No hits.';
    }
    await logGameAction(_lrGame, client, `**Last Resort** — ${_lrCombat?.target?.label || 'Figure'}: ${_lrResultLog}`, { phase: 'ROUND', icon: 'attack', ...(_lrFiles.length ? { files: _lrFiles } : {}) });
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
  // Finalize defeat via shared deferred-defeat helper. Per destruct
  // 2026-05-08: HP is already 0 (BEFORE_DEFEATED hook ran after
  // reduceHp). completeDeferredDefeat checks SC/MW heal and YWNDM,
  // then fires WHEN_DEFEATED hooks + processFigureDefeat.
  const { completeDeferredDefeat } = await import('../game/deferred-defeat.js');
  const _lrFigKey2 = _lrCombat?.target?.figureKey;
  const _lrFigIdxMatch = String(_lrFigKey2 || '').match(/-(\d+)-(\d+)$/);
  const _lrFigIdx = _lrFigIdxMatch ? parseInt(_lrFigIdxMatch[2], 10) : (_lrPending.targetFigIndex ?? 0);
  // Pass full ctx so processFigureDefeat has its required deps
  // (removeFigurePosition, calculateKillVp, etc.).
  await completeDeferredDefeat(_lrGame, ctx, {
    figureKey: _lrFigKey2,
    msgId: _lrPending.targetMsgId,
    figIndex: _lrFigIdx,
    controllerPlayerNum: _lrPending.defenderPlayerNum,
    attackerPlayerNum: _lrPending.attackerPlayerNum,
    source: 'Last Resort',
  });
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

// ── 7b. Mortar Launcher (AT-RT) end-of-round ────────────────────────────────
// At the end of the round, may move up to 2 spaces, then choose a space within
// 3 containing a hostile figure and roll 1 red die (area damage). Reuses the
// pendingMoveX → rollOneDieSpacePick continuation that the (now-removed) mid-
// activation special action used. customId:
//   mortar_eor_use_{gameId}_{msgId} / mortar_eor_skip_{gameId}_{msgId}
export async function handleMortarEor(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const buttonKey = interaction.customId.startsWith('mortar_eor_use_') ? 'mortar_eor_use_' : 'mortar_eor_skip_';
  const suffix = parseCustomId(interaction.customId, buttonKey);
  const parts = suffix.split('_');
  const gameId = parts[0]; const msgId = parts[1];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  const displayName = meta.displayName || meta.dcName;
  await interaction.message.edit({ components: [] }).catch(discordCatch);
  if (buttonKey === 'mortar_eor_skip_') {
    await logGameAction(game, client, `💥 **Mortar Launcher** — **${displayName}** skipped the end-of-round mortar.`, { phase: 'ROUND', icon: 'round' });
    saveGames(game.gameId);
    return;
  }
  const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figureKey = `${meta.dcName}-${dgIdx}-0`;
  if (!game.figurePositions?.[meta.playerNum]?.[figureKey]) {
    await logGameAction(game, client, `💥 **Mortar Launcher** — **${displayName}** is not on the board; mortar skipped.`, { phase: 'ROUND', icon: 'round' });
    saveGames(game.gameId);
    return;
  }
  const range = 3;
  try {
    const { setupPendingMoveX } = await import('./move-x-handler.js');
    await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
      msgId,
      figureKey,
      playerNum: meta.playerNum,
      spaces: 2,
      source: 'Mortar Launcher',
      threadId: null,
      bypassCosts: true,
      nextAction: {
        type: 'rollOneDieSpacePick',
        range,
        label: 'Mortar Launcher',
        abilityId: 'mortar_launcher',
        specialIdx: null,
        figureIndex: 0,
        requireHostileOccupant: true,
        spaceChoiceLabel: `**Mortar Launcher** — Choose a target space within ${range} containing a hostile figure:`,
      },
    });
    await logGameAction(game, client, `💥 **Mortar Launcher** — **${displayName}** may move up to 2 spaces, then choose a target space within ${range}.`, { phase: 'ROUND', icon: 'round' });
  } catch (err) {
    console.error('[interrupts] Mortar Launcher EoR stamp failed:', err?.message ?? err);
  }
  saveGames(game.gameId);
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
    exhaustAttachment(_odmGame, _odmMsgId, 'On a Diplomatic Mission');
    if (_odmChoice === 'mp') {
      // Immediate spend, so it goes through pendingMoveX rather than the bank
      // (alexanbv 2026-08-12: "Any immediate spending in ANY place must use
      // pending Move XP"). This fires at end of activation, i.e. out of
      // activation, and grantMovementBank does no immediate tagging at all —
      // so the 2 MP used to land untagged and could persist instead of
      // expiring.
      //
      // bypassCosts stays FALSE: this is MP, so it pays terrain. Force Surge is
      // the one that moves in spaces.
      const _odmFigKeys = Object.keys(_odmGame.figurePositions?.[_odmMeta.playerNum] || {})
        .filter((k) => k.startsWith(`${_odmMeta.dcName}-`));
      const _odmFigKey = _odmFigKeys[0] || null;
      const _odmStaged = _odmFigKey && grantImmediateMoveX(_odmGame, {
        msgId: _odmMsgId,
        playerNum: _odmMeta.playerNum,
        figureKey: _odmFigKey,
        amount: 2,
        source: 'On a Diplomatic Mission',
        dcName: _odmMeta.dcName,
      });
      await logGameAction(_odmGame, client, _odmStaged
        ? `**On a Diplomatic Mission** — **${_odmMeta.displayName || _odmMeta.dcName}** gains 2 MP (spend immediately, remainder discarded).`
        : `**On a Diplomatic Mission** — **${_odmMeta.displayName || _odmMeta.dcName}** gains 2 MP (resolve manually — could not locate the figure).`,
      { phase: 'ROUND', icon: 'card' });
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
  // Per alexanbv 2026-05-13: Command cards are SECRET. The reordering
  // player saw the cards in their private picker, but the public log
  // must not name them — the cards stay face-down on opponent's deck.
  await logGameAction(_belGame, client, `**Behind Enemy Lines** — Opponent's deck top 3 reordered.`, { phase: 'ROUND', icon: 'card' });
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
    const result = await _applyDamage(game, { dcHealthState, logGameAction, client }, {
      figureKey, msgId, figIndex: figIdx,
      amount: hits, controllerPlayerNum: defenderPlayerNum,
      attackerPlayerNum, source: "Assassin's Blade",
    });
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
  // Recipient ≠ attacker (filtered) → spend at once, no bank.
  // setupPendingMoveX with bypassCosts: false.
  try {
    const { setupPendingMoveX } = await import('./move-x-handler.js');
    await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
      msgId: targetMsgId,
      figureKey,
      playerNum: attackerPlayerNum,
      spaces: 2,
      source: 'Suppressive Fire',
      threadId: null,
      bypassCosts: false,
    });
  } catch (err) {
    console.error('[interrupts] Suppressive Fire picker stamp failed:', err?.message ?? err);
  }
  await interaction.message.edit({ content: `**Suppressive Fire** — **${dcName}** gains **2 MP** — spend at once, no bank.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `**Suppressive Fire** — **${dcName}** gains 2 MP (spend immediately, no bank).`, { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId); return;
}

// ── 11b. Suppressive Fire opt-in (Exhaust… may) ─────────────────────────────
// NEW PREFIXES: sf_optin_yes_, sf_optin_no_
export async function handleSuppressiveFireOptin(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isYes = interaction.customId.startsWith('sf_optin_yes_');
  const gameId = parseCustomId(interaction.customId, isYes ? 'sf_optin_yes_' : 'sf_optin_no_');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const pending = game.pendingSuppressiveFireOptin;
  if (!pending) { await interaction.followUp({ content: 'No pending Suppressive Fire.', ephemeral: true }).catch(discordCatch); return; }
  const { attackerPlayerNum, targetName } = pending;
  if (!await requirePlayer(interaction, game, interaction.user.id, attackerPlayerNum, canActAsPlayer, 'Only the attacker may choose.')) return;
  clearPendingSuppressiveFireOptin(game);
  if (!isYes) {
    await interaction.message.edit({ content: `**Suppressive Fire** — skipped (not exhausted).`, components: [] }).catch(discordCatch);
    saveGames(game.gameId); return;
  }
  await interaction.message.edit({ content: `**Suppressive Fire** — exhausting… **${targetName}** becomes Weakened.`, components: [] }).catch(discordCatch);
  const channel = interaction.channel;
  const send = async (content, components) => {
    await channel?.send(components ? { content, components } : content).catch(discordCatch);
  };
  try {
    const { applySuppressiveFireEffect } = await import('../engine/combat-bridge.js');
    await applySuppressiveFireEffect(game, { send, client, logGameAction, saveGames }, pending);
  } catch (err) {
    console.error('[interrupts] Suppressive Fire opt-in apply failed:', err?.message ?? err);
  }
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
// NEW PREFIX: excavation_pick_ / excavation_skip_ — add to router.js
//
// Per Aphra's "Excavation" rule: card stays in its discard pile. Aphra's
// player may play it once this round directly from the discard (handled by
// the play surface, not here); after play it goes to game box. If anything
// redraws the card out of discard before play, Aphra loses the option.
export async function handleExcavationPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isSkip = interaction.customId.startsWith('excavation_skip_');
  // pick: excavation_pick_{gameId}_{aphraPN}_{sourcePN}_{optionIdx}
  // skip: excavation_skip_{gameId}_{aphraPN}
  const suffix = isSkip
    ? parseCustomId(interaction.customId, 'excavation_skip_')
    : parseCustomId(interaction.customId, 'excavation_pick_');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the DC owner may choose.')) return;
  if (game.restInPeaceActive) {
    await interaction.message.edit({ content: '**Excavation** — Blocked by **Rest in Peace** (cannot retrieve from discard piles this round).', components: [] }).catch(discordCatch);
    if (game.aphraExcavationOptions) delete game.aphraExcavationOptions[playerNum];
    await resolveStartOfRoundEffect(game, ctx);
    saveGames(game.gameId);
    return;
  }
  if (isSkip) {
    await interaction.message.edit({ content: `⛏️ **Excavation** — skipped (no card marked this round).`, components: [] }).catch(discordCatch);
    await logGameAction(game, client, `⛏️ **Excavation** — skipped.`, { phase: 'ROUND', icon: 'round' });
    if (game.aphraExcavationOptions) delete game.aphraExcavationOptions[playerNum];
    await resolveStartOfRoundEffect(game, ctx);
    saveGames(game.gameId);
    return;
  }
  const sourcePN = parseInt(parts[2], 10);
  const optIdx = parseInt(parts[3], 10);
  const options = game.aphraExcavationOptions?.[playerNum] || [];
  const choice = options[optIdx];
  if (!choice || choice.sourcePN !== sourcePN) {
    await interaction.followUp({ content: 'Invalid Excavation selection (state expired).', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Validate the card is still in the source's discard pile (defends against
  // race with other start-of-round redraws).
  const sourceDiscardKey = ccDiscardKey(sourcePN);
  const sourceDiscard = game[sourceDiscardKey] || [];
  if (!sourceDiscard.includes(choice.name)) {
    await interaction.message.edit({ content: `⛏️ **Excavation** — **${choice.name}** is no longer in P${sourcePN}'s discard pile. Pick again.`, components: [] }).catch(discordCatch);
    return;
  }
  // Set marker — card stays in discard; play surface handles the actual play.
  game.aphraExcavationTarget = {
    excavatorPN: playerNum,
    sourcePN,
    cardName: choice.name,
    used: false,
  };
  if (game.aphraExcavationOptions) delete game.aphraExcavationOptions[playerNum];
  const sourceLabel = sourcePN === playerNum ? 'your' : `P${sourcePN}'s`;
  await interaction.message.edit({
    content: `⛏️ **Excavation** — **${choice.name}** marked for play from ${sourceLabel} discard pile this round. Play it once during the round; it returns to the game box after.`,
    components: [],
  }).catch(discordCatch);
  await logGameAction(game, client, `⛏️ **Excavation** — <@${interaction.user.id}> marked **${choice.name}** (in ${sourceLabel} discard) for play this round.`, { phase: 'ROUND', icon: 'round' });
  // Post the play button in Aphra's hand channel so the player can trigger
  // the actual play from discard at the right timing during the round.
  await _postAphraExcavationPlayButton(game, client).catch(discordCatch);
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId); return;
}

/**
 * Post the "Play [card] (Excavation)" button to Aphra's hand channel after
 * a SoR pick. Stores the message id on the marker so it can be edited when
 * the card is played, redrawn out, or the round ends.
 */
async function _postAphraExcavationPlayButton(game, client) {
  const tgt = game.aphraExcavationTarget;
  if (!tgt || tgt.used) return;
  const handChannelId = getHandChannelId(game, tgt.excavatorPN);
  if (!handChannelId) return;
  const handChannel = await fetchGameChannel(client, handChannelId);
  if (!handChannel) return;
  const sourceLabel = tgt.sourcePN === tgt.excavatorPN ? 'your discard' : `P${tgt.sourcePN}'s discard`;
  const ownerId = getPlayerId(game, tgt.excavatorPN);
  const btn = new ButtonBuilder()
    .setCustomId(`excavation_play_${game.gameId}`)
    .setLabel(`Play ${tgt.cardName.slice(0, 60)} (Excavation)`)
    .setStyle(ButtonStyle.Primary);
  const msg = await handChannel.send({
    content: `<@${ownerId}> ⛏️ **Excavation** — **${tgt.cardName}** is marked in ${sourceLabel}. Press to play it; the card returns to the game box afterward. Marker clears at end of round if unused.`,
    allowedMentions: { users: [ownerId] },
    components: [new ActionRowBuilder().addComponents(btn)],
  }).catch(() => null);
  if (msg) {
    tgt.playButtonChannelId = handChannel.id;
    tgt.playButtonMessageId = msg.id;
  }
}

// ── 13b. Last Wielder of the Darksaber (Bo-Katan Kryze, start-of-round) ──────
// "At the start of the round, you may attach [The Darksaber] to this group."
// Posted by round.js (_postLastWielderClaimPrompt) only when The Darksaber is
// currently attached to a DIFFERENT DC owned by the same player. On Claim, move
// the "The Darksaber" attachment string from the source DC's attachment array
// onto Bo-Katan's, then refresh both DC attachment messages. The Darksaber is
// already readied by the start-of-round SU ready pass, so no exhaust handling.
export async function handleLastWielderDarksaber(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, logGameAction, updateAttachmentMessageForDc } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const isSkip = interaction.customId.startsWith('last_wielder_skip_');
  // claim: last_wielder_claim_{gameId}_{playerNum}_{boMsgId}_{sourceMsgId}
  // skip:  last_wielder_skip_{gameId}_{playerNum}
  const suffix = isSkip
    ? parseCustomId(interaction.customId, 'last_wielder_skip_')
    : parseCustomId(interaction.customId, 'last_wielder_claim_');
  const parts = suffix.split('_');
  const gameId = parts[0];
  const playerNum = parseInt(parts[1], 10);
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, playerNum, canActAsPlayer, 'Only the DC owner may choose.')) return;

  if (isSkip) {
    await interaction.message.edit({ content: '🗡️ **Last Wielder of the Darksaber** — skipped (The Darksaber stays where it is).', components: [] }).catch(discordCatch);
    await logGameAction(game, client, '🗡️ **Last Wielder of the Darksaber** — skipped.', { phase: 'ROUND', icon: 'round' });
    await resolveStartOfRoundEffect(game, ctx);
    saveGames(game.gameId);
    return;
  }

  const boMsgId = parts[2];
  const sourceMsgId = parts[3];
  const attKey = dcAttachmentsKey(playerNum);
  game[attKey] = game[attKey] || {};
  const atts = game[attKey];
  const sourceList = atts[sourceMsgId] || [];
  const idx = sourceList.findIndex((n) => cardNameIncludes([n], 'The Darksaber'));
  // Defend against state drift (Darksaber moved/defeated between post and click).
  if (idx < 0 || cardNameIncludes(atts[boMsgId], 'The Darksaber')) {
    await interaction.message.edit({ content: '🗡️ **Last Wielder of the Darksaber** — The Darksaber is no longer claimable.', components: [] }).catch(discordCatch);
    await resolveStartOfRoundEffect(game, ctx);
    saveGames(game.gameId);
    return;
  }
  // Move the attachment string from source DC → Bo-Katan's DC.
  const [card] = sourceList.splice(idx, 1);
  if (sourceList.length === 0) delete atts[sourceMsgId];
  atts[boMsgId] = atts[boMsgId] || [];
  atts[boMsgId].push(card);

  // Refresh both DC attachment displays (source may now be empty → message
  // deleted; Bo-Katan gains the embed).
  if (updateAttachmentMessageForDc) {
    await updateAttachmentMessageForDc(game, playerNum, sourceMsgId, client).catch(discordCatch);
    await updateAttachmentMessageForDc(game, playerNum, boMsgId, client).catch(discordCatch);
  }

  const dcList = getDcList(game, playerNum) || [];
  const msgIds = getDcMessageIds(game, playerNum) || [];
  const boDc = dcList[msgIds.indexOf(boMsgId)];
  const boLabel = boDc?.displayName || boDc?.dcName || 'Bo-Katan Kryze';
  await interaction.message.edit({ content: `🗡️ **Last Wielder of the Darksaber** — **The Darksaber** attached to **${boLabel}**.`, components: [] }).catch(discordCatch);
  await logGameAction(game, client, `🗡️ **Last Wielder of the Darksaber** — <@${interaction.user.id}> attached **The Darksaber** to **${boLabel}**.`, { phase: 'ROUND', icon: 'round' });
  await resolveStartOfRoundEffect(game, ctx);
  saveGames(game.gameId);
  return;
}

// ── 14. Driven by Hatred (Darth Vader EOR) ──────────────────────────────────
// Per alexanbv 2026-05-10: choice (Force Choke / Attack / Skip) happens
// AFTER the 2-space move-X picker drains, not before. Top-level button is
// Move-or-Skip. The post-move picker is fired via the dbhPostMovePick
// continuation in move-x-handler.js.
export async function handleDrivenByHatred(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);

  let buttonKey;
  if (interaction.customId.startsWith('dbh_move_')) buttonKey = 'dbh_move_';
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
    saveGames(_dbhGame.gameId);
    return;
  }
  const _dbhFigKeys = Object.keys(_dbhGame.figurePositions?.[_dbhMeta.playerNum] || {})
    .filter(k => k.startsWith((_dbhMeta.dcName || '') + '-'));
  const _dbhFigKey = _dbhFigKeys[0] || null;
  if (!_dbhFigKey) {
    await logGameAction(_dbhGame, client, `**Driven by Hatred** — could not locate **${_dbhDisplayName}**'s figure; resolve manually.`, { phase: 'ROUND', icon: 'card' });
    saveGames(_dbhGame.gameId);
    return;
  }
  const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
  stampPendingMoveX(_dbhGame, {
    msgId: _dbhMsgId,
    figureKey: _dbhFigKey,
    playerNum: _dbhMeta.playerNum,
    spaces: 2,
    source: 'Driven by Hatred',
    threadId: null,
    bypassCosts: true,
    nextAction: { type: 'dbhPostMovePick', payload: { msgId: _dbhMsgId, playerNum: _dbhMeta.playerNum } },
  });
  await logGameAction(_dbhGame, client, `**Driven by Hatred** — **${_dbhDisplayName}** moves up to 2 spaces; choose Force Choke or free attack after move.`, { phase: 'ROUND', icon: 'card' });
  await postMoveXPicker(_dbhGame, { client, logGameAction, saveGames }, _dbhMsgId);
  saveGames(_dbhGame.gameId);
}

// Wild Beast (Bantha Rider) — per alexanbv 2026-05-10: when an attack is
// granted to Bantha, may perform Trample (Special Action) instead.
// Limit once per activation AND once per status phase (separate flags).
// Fires Trample via the existing trample_bantha resolveAbility entry.
export async function handleWildBeastTrample(interaction, ctx) {
  const {
    getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction,
    dcHealthState, getDcEffects, getMapData, getFigureSize, findDcMessageIdForFigure,
    hasLineOfSightByCoord,
  } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^wild_beast_trample_(.+)_(.+)_f(\d+)$/);
  if (!m) {
    await interaction.followUp({ content: 'Invalid Wild Beast button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, gameId, granteeMsgId] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(granteeMsgId);
  if (!meta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only Bantha\'s owner may respond.')) return;
  // Re-verify usage gate
  if (game.wildBeastUsedThisActivation?.[granteeMsgId] || game.wildBeastUsedThisStatusPhase?.[granteeMsgId]) {
    await interaction.followUp({ content: '**Wild Beast** already used in this window.', ephemeral: true }).catch(discordCatch);
    return;
  }
  // Detect activation vs status-phase context: if Bantha has an active
  // dcActionsData entry, she's mid-activation; otherwise this is an
  // out-of-activation grant (status phase / EoR).
  const _isActivationCtx = !!game.dcActionsData?.[granteeMsgId];
  if (_isActivationCtx) {
    game.wildBeastUsedThisActivation = game.wildBeastUsedThisActivation || {};
    game.wildBeastUsedThisActivation[granteeMsgId] = true;
  } else {
    game.wildBeastUsedThisStatusPhase = game.wildBeastUsedThisStatusPhase || {};
    game.wildBeastUsedThisStatusPhase[granteeMsgId] = true;
  }
  // Clear any granted-attack pending state targeting Bantha so the
  // grant doesn't auto-consume on a later Bantha attack. The specific
  // grantor's pending field (pendingExecutiveOrder, pendingEmperorInterrupt,
  // etc.) is left to its own cleanup — clearing freeAttackBonusPending is
  // enough to neutralize the free-attack flag.
  const dgIdx = (meta.displayName || meta.dcName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const banthaFk = `${meta.dcName}-${dgIdx}-0`;
  if (game.freeAttackBonusPending?.[banthaFk]) {
    delete game.freeAttackBonusPending[banthaFk];
  }
  // Fire Trample via resolveAbility (existing trample_bantha entry).
  // Trample is a 3-adjacent-hostile + red die effect.
  try {
    const { resolveAbility } = await import('../game/abilities.js');
    const { applyAbilityResult } = await import('../discord/apply-ability-result.js');
    const result = resolveAbility('trample_bantha', {
      game, playerNum: meta.playerNum, meta, msgId: granteeMsgId,
      dcMessageMeta, dcHealthState, getDcEffects,
      getMapData, getFigureSize, findDcMessageIdForFigure,
      hasLineOfSightByCoord,
    });
    await logGameAction(game, client, `🐃 **Wild Beast** — **Bantha Rider** performs **Trample** instead of the granted attack.`, { phase: 'ROUND', icon: 'attack' });
    await applyAbilityResult(result, { game, playerNum: meta.playerNum, msgId: granteeMsgId, client, ctx });
  } catch (err) {
    console.error('[wild_beast_trample] resolve failed:', err?.message ?? err);
    await logGameAction(game, client, `**Wild Beast** — failed to auto-resolve Trample; resolve manually.`, { phase: 'ROUND', icon: 'attack' });
  }
  saveGames(game.gameId);
}

// [Rogue Smuggler] — once-per-round EoR free attack (Han Solo).
// Gated on a round-scoped flag, not via card exhaust (deprecated per
// alexanbv 2026-05-10).
export async function handleRogueSmuggler(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  let buttonKey;
  if (interaction.customId.startsWith('rs_attack_')) buttonKey = 'rs_attack_';
  else buttonKey = 'rs_skip_';
  const suffix = parseCustomId(interaction.customId, buttonKey);
  const parts = suffix.split('_');
  const gameId = parts[0]; const msgId = parts[1];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) { await interaction.followUp({ content: 'DC not found.', ephemeral: true }).catch(discordCatch); return; }
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  const displayName = meta.displayName || meta.dcName;
  if (buttonKey === 'rs_skip_') {
    await logGameAction(game, client, `**[Rogue Smuggler]** — **${displayName}** skipped the end-of-round attack.`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  // Mark [Rogue Smuggler] as used for the round (round-scoped flag,
  // wiped at start of next round). Replaces the legacy "exhaust card"
  // gating. Per alexanbv 2026-06-13: keyed PER FIGURE (Han's figureKey),
  // matching the end-of-round prompt gate in round.js.
  const dgIdx = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
  const figKey = `${meta.dcName}-${dgIdx}-0`;
  game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
  game.roundFigureAbilityUsed[`${figKey}_rogueSmugglerEor`] = true;
  // Set free-attack pending on Han's figureKey so the next Attack click
  // on his DC card consumes the free-attack flag (no action cost).
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  game.freeAttackBonusPending[figKey] = true;
  const ownerId = getPlayerId(game, meta.playerNum);
  await logGameAction(game, client,
    `<@${ownerId}> **[Rogue Smuggler]** — **${displayName}** interrupts to perform a free attack. Use the **Attack** button on Han's DC card.`,
    { phase: 'ROUND', icon: 'attack', allowedMentions: { users: [ownerId] } });
  saveGames(game.gameId);
}

// Post-move pick for Driven by Hatred: fired from the move-x-handler
// dbhPostMovePick continuation, then routes to dbhForceChoke or sets up
// a free attack with -1 die penalty.
export async function handleDbhPostMove(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  let buttonKey;
  if (interaction.customId.startsWith('dbh_post_choke_')) buttonKey = 'dbh_post_choke_';
  else if (interaction.customId.startsWith('dbh_post_attack_')) buttonKey = 'dbh_post_attack_';
  else buttonKey = 'dbh_post_skip_';
  const suffix = parseCustomId(interaction.customId, buttonKey);
  const parts = suffix.split('_');
  const gameId = parts[0]; const msgId = parts[1];
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta.get(msgId);
  if (!meta) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, 'Only the DC owner may respond.')) return;
  const displayName = meta.displayName || meta.dcName;
  const figKey = Object.keys(game.figurePositions?.[meta.playerNum] || {}).find(k => k.startsWith((meta.dcName || '') + '-')) || null;
  if (buttonKey === 'dbh_post_skip_') {
    await logGameAction(game, client, `**Driven by Hatred** — **${displayName}** skipped the post-move action.`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  if (buttonKey === 'dbh_post_choke_') {
    // Reuse the existing dbhForceChoke continuation by faking a drained
    // pendingMoveX state. Simpler: call _runDbhForceChokeContinuation
    // directly from move-x-handler.
    const { _runDbhForceChokeContinuationDirect } = await import('./move-x-handler.js');
    if (_runDbhForceChokeContinuationDirect) {
      await _runDbhForceChokeContinuationDirect(game, { client, logGameAction, saveGames }, { msgId, playerNum: meta.playerNum, figureKey: figKey });
    }
    saveGames(game.gameId);
    return;
  }
  // dbh_post_attack_: set free-attack pending + -1 die penalty.
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  if (figKey) game.freeAttackBonusPending[figKey] = true;
  // Per alexanbv 2026-05-13: per-figureKey.
  game.attackDicePenaltyForMsgId = game.attackDicePenaltyForMsgId || {};
  if (figKey) game.attackDicePenaltyForMsgId[figKey] = 1;
  game.attackDicePenaltyLabel = 'Driven by Hatred';
  const ownerId = getPlayerId(game, meta.playerNum);
  await logGameAction(game, client,
    `<@${ownerId}> **Driven by Hatred** — **${displayName}** takes a free attack (-1 die). Use the **Attack** button on your DC card.`,
    { phase: 'ROUND', icon: 'attack', allowedMentions: { users: [ownerId] } });
  saveGames(game.gameId);
}

// ── Findsman Meditation (Zuckuss) ──────────────────────────────────────────
// At start of an opponent's marked activation, Zuckuss's controller
// chose Move / Attack / Skip. customId:
//   findsman_med_${gameId}_${zuckussMsgId}_${move|attack|skip}
export async function handleFindsmanMeditation(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames, client, dcMessageMeta, logGameAction } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const m = interaction.customId.match(/^findsman_med_([^_]+)_(.+)_(move|attack|skip)$/);
  if (!m) return;
  const [, gameId, zuckussMsgId, action] = m;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  const meta = dcMessageMeta?.get(zuckussMsgId);
  if (!meta) {
    await interaction.followUp({ content: 'Zuckuss DC not found.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!await requirePlayer(interaction, game, interaction.user.id, meta.playerNum, canActAsPlayer, "Only Zuckuss's controller may respond.")) return;
  // Once-per-round: clear the marker on first resolution so it
  // doesn't re-fire on subsequent activations of the same group.
  if (game.findsmanMeditationTarget?.[meta.playerNum]) {
    delete game.findsmanMeditationTarget[meta.playerNum];
    if (Object.keys(game.findsmanMeditationTarget).length === 0) delete game.findsmanMeditationTarget;
  }
  const zuckussFigKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {})
    .filter(k => k.startsWith('Zuckuss-'));
  const zuckussFk = zuckussFigKeys[0] || null;
  if (action === 'skip') {
    await interaction.message.edit({ content: '**Findsman Meditation** — Skipped.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  if (!zuckussFk) {
    await interaction.message.edit({ content: '**Findsman Meditation** — Zuckuss is not on the board; cannot resolve interrupt.', components: [] }).catch(discordCatch);
    saveGames(game.gameId);
    return;
  }
  if (action === 'move') {
    const speed = ctx.getDcStats?.('Zuckuss')?.speed ?? 4;
    const { setupPendingMoveX } = await import('./move-x-handler.js');
    await setupPendingMoveX(game, { client, logGameAction, saveGames }, {
      msgId: zuckussMsgId,
      figureKey: zuckussFk,
      playerNum: meta.playerNum,
      spaces: speed,
      source: 'Findsman Meditation',
      threadId: null,
      bypassCosts: false,
    });
    await interaction.message.edit({ content: `**Findsman Meditation** — **Zuckuss** performs a move (up to ${speed} MP, spend at once, no bank).`, components: [] }).catch(discordCatch);
    await logGameAction?.(game, client, `**Findsman Meditation** — Zuckuss performs a move (${speed} MP, spend immediately).`, { phase: 'ROUND', icon: 'card' });
    saveGames(game.gameId);
    return;
  }
  // action === 'attack'
  game.freeAttackBonusPending = game.freeAttackBonusPending || {};
  if (zuckussFk) game.freeAttackBonusPending[zuckussFk] = { from: 'Findsman Meditation' };
  await interaction.message.edit({ content: '**Findsman Meditation** — **Zuckuss** performs an attack. Use the Attack button.', components: [] }).catch(discordCatch);
  await logGameAction?.(game, client, '**Findsman Meditation** — Zuckuss performs an interrupt attack.', { phase: 'ROUND', icon: 'card' });
  saveGames(game.gameId);
  return;
}

// ── Submit or Fight (Paz Vizsla) ────────────────────────────────────────────
// REMOVED 2026-06-20 (alexanbv): the old damage-based handleSubmitOrFight
// (pop 1 CC + heal 1 HP) modeled Submit or Fight as post-damage healing. Per
// the ruling it is a STRAIN-prevention option — "return any number of Command
// cards from your discard pile to prevent that much Strain" — so it is now the
// canonical THIRD strain option (PAZ_RETURN_FROM_DISCARD) in the applyStrain
// pipeline (strain-handler.js / strain-resolver.js: pazReturnAvailable +
// handleStrainChoicePaz), applied BEFORE strain converts to HP loss and
// overridable by the opponent depleting Under Duress (which flips the chooser
// to the opponent, removing Paz's discard-return option for that event).

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

  // Apply 1 Strain via the canonical applyStrain pipeline. The CC
  // draw/discard/return + VP changes happen AFTER the strain choice
  // resolves (so a "discard top of deck" strain choice doesn't race
  // with the Black Market deck-top consumption). Wired via
  // registerStrainFollowup('black_market_resolve').
  const { applyStrain, registerStrainFollowup: _bmRegFu } = await import('./strain-handler.js');
  delete game.pendingBlackMarket[_bmPn];
  await interaction.message.edit({ content: `**[Black Market]** — strain resolving; effect applies after the strain choice.`, components: [] }).catch(discordCatch);
  await applyStrain(game, ctx, {
    figureKey: smugglerFk,
    controllerPlayerNum: _bmPn,
    amount: 1,
    source: 'Black Market',
    followup: {
      type: 'black_market_resolve',
      payload: { playerNum: _bmPn, choice: _bmChoice, topCard, cardCost, smugglerName },
    },
  });
  saveGames(game.gameId);
}

/**
 * [Black Market] smuggler pick (alexanbv 2026-06-21): when 2+ friendly
 * SMUGGLERs are alive, the player first chooses WHICH suffers the 1 Strain,
 * then the draw/discard/return prompt is posted.
 * Buttons: bm_smug_{gameId}_{msgId}_{playerNum}_{idx}
 */
export async function handleBlackMarketSmugglerPick(interaction, ctx) {
  const { getGame, canActAsPlayer, saveGames } = ctx;
  await interaction.deferUpdate().catch(discordCatch);
  const _suffix = parseCustomId(interaction.customId, 'bm_smug_');
  const _parts = _suffix.split('_');
  const _gameId = _parts[0];
  const _mid = _parts[1];
  const _pn = parseInt(_parts[2], 10);
  const _idx = parseInt(_parts[3], 10);
  const game = await requireGame(interaction, getGame, _gameId);
  if (!game) return;
  if (!await requirePlayer(interaction, game, interaction.user.id, _pn, canActAsPlayer, 'Only the card owner may respond.')) return;
  const pending = game.pendingBlackMarket?.[_pn];
  if (!pending || !Array.isArray(pending.smugglerCandidates)) {
    await interaction.followUp({ content: '[Black Market] — No pending smuggler choice.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const chosen = pending.smugglerCandidates[_idx];
  if (!chosen) {
    await interaction.followUp({ content: '[Black Market] — invalid smuggler.', ephemeral: true }).catch(discordCatch);
    return;
  }
  pending.smugglerFk = chosen.fk;
  pending.smugglerMsgId = chosen.msgId;
  pending.smugglerFigIdx = chosen.figIdx;
  delete pending.smugglerCandidates;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bm_draw_${_gameId}_${_mid}_${_pn}`).setLabel(`Draw (spend ${pending.cardCost} VP)`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bm_discard_${_gameId}_${_mid}_${_pn}`).setLabel(`Discard (gain ${pending.cardCost} VP)`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bm_return_${_gameId}_${_mid}_${_pn}`).setLabel('Return to top').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bm_skip_${_gameId}_${_mid}_${_pn}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
  );
  await interaction.message.edit({
    content: `**[Black Market]** — **${chosen.name}** will suffer 1 Strain. Top CC: **${pending.topCard}** (cost ${pending.cardCost}). Choose:`,
    components: [row],
  }).catch(discordCatch);
  saveGames(game.gameId);
}

// Black Market followup — run the CC draw/discard/return + VP swap
// AFTER the strain choice resolves.
import { registerStrainFollowup as _bmRegisterFollowup } from './strain-handler.js';
import { playCcFull } from './cc-pipeline.js';
_bmRegisterFollowup('black_market_resolve', async (game, ctx, payload) => {
  const { client, logGameAction, saveGames, checkWinConditions } = ctx;
  const { playerNum, choice, topCard, cardCost, smugglerName } = payload;
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
  const deck = game[deckKey] || [];
  // Top card was only peeked at trigger time; consume now if still present.
  if (deck.length > 0 && deck[0] === topCard) deck.shift();
  let resultMsg = '';
  if (choice === 'draw') {
    if (cardCost > 0) deductVp(game, playerNum, cardCost);
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    game[handKey] = [...(game[handKey] || []), topCard];
    resultMsg = `Drew **${topCard}** (spent ${cardCost} VP). **${smugglerName}** suffered 1 Strain.`;
  } else if (choice === 'discard') {
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    game[discardKey] = [...(game[discardKey] || []), topCard];
    if (cardCost > 0) awardObjectiveVp(game, playerNum, cardCost);
    resultMsg = `Discarded **${topCard}** (gained ${cardCost} VP). **${smugglerName}** suffered 1 Strain.`;
  } else if (choice === 'return') {
    deck.unshift(topCard);
    resultMsg = `Returned **${topCard}** to top of deck. **${smugglerName}** suffered 1 Strain.`;
  }
  await logGameAction?.(game, client, `**[Black Market]** — ${resultMsg}`, { phase: 'ROUND', icon: 'card' });
  await checkWinConditions?.(game, client);
  saveGames?.(game.gameId);
});

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

  // Remove original condition, apply new one, then exhaust Punishing Strike
  filterCondition(game, targetFigureKey, originalCondition);
  applyCondition(game, targetFigureKey, choice);
  const _psExhKey = `ps_army_p${attackerPn}`;
  exhaustAttachment(game, _psExhKey, 'Punishing Strike');

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

    // Per alexanbv 2026-05-11: Executor card text is "move up to 2
    // spaces and then perform an attack" — this is the Move-X-spaces
    // pipeline (spend immediately, no bank), NOT a 2-MP bank grant.
    // Grant free attack first (next attack costs no action), then
    // stamp the pendingMoveX picker so RGC can move up to 2 spaces.
    _exGame.freeAttackBonusPending = _exGame.freeAttackBonusPending || {};
    if (_exPending.rgcFigKey) _exGame.freeAttackBonusPending[_exPending.rgcFigKey] = true;

    await logGameAction(_exGame, client, `**Executor** — **${_exPending.rgcDcName}** moves up to 2 spaces, then performs a free attack (friendly **${_exPending.defeatedLabel}** defeated).`, { phase: 'ROUND', icon: 'card' });
    try {
      const { setupPendingMoveX } = await import('./move-x-handler.js');
      await setupPendingMoveX(_exGame, { client, logGameAction, saveGames }, {
        msgId: _exPending.rgcMsgId,
        figureKey: _exPending.rgcFigKey,
        playerNum: _exPending.rgcPlayerNum,
        spaces: 2,
        source: 'Executor',
        threadId: null,
        // Per alexanbv 2026-05-11: "Move X spaces" effects use
        // bypassCosts=true (each step consumes 1 budget regardless of
        // terrain). Executor card says "move up to 2 spaces" — that's
        // canonical Move-X, not an MP-gain. bypassCosts=false would be
        // for Slippery / Smooth Landing-style MP gains where terrain
        // cost still applies.
        bypassCosts: true,
      });
    } catch (err) {
      console.error('[interrupts] Executor Move-X stamp failed:', err?.message ?? err);
    }
  } else {
    await logGameAction(_exGame, client, `**Executor** — Skipped.`, { phase: 'ROUND', icon: 'card' });
  }

  // 2026-05-09: Executor migrated from BEFORE_DEFEATED to WHEN_DEFEATED.
  // The friendly's defeat is already finalized by processFigureDefeat
  // before the player clicks Use/Skip — no completeDeferredDefeat call
  // needed. RGC's MP + free attack are independent follow-up actions.
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
  // Frame-correctness fix (alexanbv 2026-05-09, B-NA-EP-002): use the
  // combat object captured at probe time, not `game.pendingCombat` at
  // click time. By the time the user clicks, the inner combat where EP
  // fired may have already popped (Slow on the Draw outer underneath),
  // and reading pendingCombat would re-finish the wrong frame.
  const _epCombat = _epPending.combatRef || _epGame.pendingCombat;

  if (isPlay) {
    const _epPlayRes = await playCcFull(_epGame, _epGameId, _epPending.playerNum, null, 'Extra Protection', {
      skipExecute: true, skipTimingCheck: true,
    }, ctx, client);
    if (_epPlayRes.ok && !_epPlayRes.cancelled) {
      // Resolve the playing figure's key for the picker. Prefer the figureKey
      // stashed at probe time (Onar Koma OR Mara via Fast Learner / a substitute —
      // alexanbv 2026-06-21), falling back to dcMessageMeta lookup.
      let _epOnarFigureKey = (_epPending.onarFigKey && _epGame.figurePositions?.[_epPending.playerNum]?.[_epPending.onarFigKey])
        ? _epPending.onarFigKey
        : null;
      const _epDcMsgMeta = ctx.dcMessageMeta;
      if (!_epOnarFigureKey && _epDcMsgMeta && _epDcMsgMeta.get?.(_epPending.onarMsgId)) {
        const _epMeta = _epDcMsgMeta.get(_epPending.onarMsgId);
        const _epFigKeys = Object.keys(_epGame.figurePositions?.[_epMeta.playerNum] || {})
          .filter(k => k.startsWith((_epMeta.dcName || '') + '-'));
        _epOnarFigureKey = _epFigKeys[0] || null;
      }
      _epGame.freeAttackBonusPending = _epGame.freeAttackBonusPending || {};
      if (_epOnarFigureKey) _epGame.freeAttackBonusPending[_epOnarFigureKey] = true;
      if (!_epOnarFigureKey) {
        await logGameAction(_epGame, client, `**Extra Protection** — could not locate **${_epPending.onarDcName}**'s figure; resolve manually.`, { phase: 'ROUND', icon: 'card' });
      } else {
        const { stampPendingMoveX, postMoveXPicker } = await import('./move-x-handler.js');
        stampPendingMoveX(_epGame, {
          msgId: _epPending.onarMsgId,
          figureKey: _epOnarFigureKey,
          playerNum: _epPending.playerNum,
          spaces: 2,
          source: 'Extra Protection',
          threadId: null,
          nextAction: {
            type: 'freeAttackPrompt',
            payload: {
              msgId: _epPending.onarMsgId,
              playerNum: _epPending.playerNum,
              figureKey: _epOnarFigureKey,
              sourceLabel: 'Extra Protection',
            },
          },
        });
        await postMoveXPicker(_epGame, { client, logGameAction, saveGames }, _epPending.onarMsgId);
        await logGameAction(_epGame, client, `**Extra Protection** — **${_epPending.onarDcName}** plays Extra Protection! Move up to 2 spaces, then take a free attack.`, { phase: 'ROUND', icon: 'card' });
      }
    }
    // If cancelled: effect skipped, fall through to applyDamageAndFinishCombat below.
  } else {
    await logGameAction(_epGame, client, `**Extra Protection** — Skipped.`, { phase: 'ROUND', icon: 'card' });
  }

  // Drain the WD window. All damage already ran before _runOrDeferAfterResolve
  // created pendingWhenDamagedCcWindow, so no re-entry into applyDamageAndFinishCombat
  // is needed — just drain, which either cascades into the defeat window or resumes
  // the gate sequence.
  await saveGames(_epGame.gameId);
  const { _drainWhenDamagedCcWindow } = await import('./when-damaged-cc-prompts.js').catch(() => ({}));
  if (typeof _drainWhenDamagedCcWindow === 'function') {
    await _drainWhenDamagedCcWindow(_epGame, 'extra_protection_onar_koma', ctx);
  }
  return;
}
