/**
 * Combat damage resolution handlers:
 *   applyNpcDamageToFigure, applyDirectDamageToFigure, sendBleedingPrompt,
 *   resolveCombatAfterRolls, applyDamageAndFinishCombat,
 *   checkPostCombatSurges, finishCombatResolution
 *
 * All exported functions accept a `ctx` context object containing shared dependencies.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { discordCatch } from '../error-handling.js';
import {
  dcNameFromFigureKey, reduceHp, healHp, awardKillVp, awardObjectiveVp,
  applyCondition as _applyCondition, parseFigureKey, computeCombatResult,
  getEffectiveFigureSize, getFiguresAdjacentToTarget, getDcEffect,
  opponentPlayerNum, filterCondition as _filterCondition,
  isConditionImmune as _isConditionImmune, HARMFUL_CONDITIONS as _HARMFUL_CONDITIONS,
  getFootprintCells, normalizeCoord, getBoardStateForMovement,
} from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getPlayAreaId,
  getCcHand, getActivatedDcIndices,
  ccDeckKey, ccHandKey, ccDiscardKey, ccAttachmentsKey, vpKey,
  removeFigurePosition,
} from '../game/player-helpers.js';
import {
  getMapSpaces, getDcEffects, getDcKeywords, getDiceData, getDcStats,
  getCcEffectsData, getCcEffect, isDcUnique,
} from '../data-loader.js';
import { getRange as _getRange } from '../game/spatial.js';
import { checkAndPostAchievements } from '../discord/achievement-helpers.js';

const getRange = _getRange;
const filterCondition = _filterCondition;
const isConditionImmune = _isConditionImmune;
const HARMFUL_CONDITIONS = _HARMFUL_CONDITIONS;

/** BFS distance check on mapSpaces adjacency (used for Figurehead, Boltslinger, etc.). */
function isWithinN(posA, posB, maxDist, mapId) {
  const ms = getMapSpaces(mapId);
  if (!ms?.adjacency || !posA || !posB) return false;
  const a = String(posA).toLowerCase(), b = String(posB).toLowerCase();
  if (a === b) return true;
  const visited = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= maxDist; d++) {
    const next = [];
    for (const c of frontier) {
      for (const adj of (ms.adjacency[c] || [])) {
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

/** Check if a Figurehead-capable figure is available to intercept damage for targetFigureKey. Returns { figureKey, msgId, figIndex, label } or null. */
function findFigureheadFigure(game, defenderPlayerNum, targetFigureKey, ctx) {
  const { findDcMessageIdForFigure } = ctx;
  if (!game.selectedMap?.id) return null;
  const targetPos = game.figurePositions?.[defenderPlayerNum]?.[targetFigureKey];
  if (!targetPos) return null;
  const dcList = getDcList(game, defenderPlayerNum);
  if (!dcList) return null;
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    if (!dc) continue;
    const dcName = dc.dcName;
    const eff = getDcEffect(dcName);
    if (!(eff?.specialAbilityIds || []).includes('figurehead')) continue;
    const figures = game.figurePositions?.[defenderPlayerNum] || {};
    for (const [fk, pos] of Object.entries(figures)) {
      if (fk === targetFigureKey) continue;
      if (dcNameFromFigureKey(fk) !== dcName) continue;
      if (!isWithinN(pos, targetPos, 4, game.selectedMap.id)) continue;
      const msgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, fk);
      const { figureIndex: figIndex } = parseFigureKey(fk);
      return { figureKey: fk, msgId, figIndex, label: dc.displayName || dcName };
    }
  }
  return null;
}

export async function applyNpcDamageToFigure(game, playerNum, figureKey, damage, sourceLabel, logGameAction, client, dcHealthState, dcMessageMeta) {
  const dcName = dcNameFromFigureKey(figureKey);
  const { dgIndex, figureIndex } = parseFigureKey(figureKey);

  // Locate the DC message for this figure
  let msgId = null;
  for (const [mid, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
    const dn = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    if (meta.dcName === dcName && dn && String(dn[1]) === String(dgIndex)) { msgId = mid; break; }
  }

  if (msgId) {
    const { newHp, maxHp, wasDefeated } = reduceHp(dcHealthState, game, msgId, figureIndex, damage, playerNum);
    if (dcHealthState.get(msgId)?.[figureIndex]) {
      if (wasDefeated) {
        removeFigurePosition(game, playerNum, figureKey);
        const oppPN = opponentPlayerNum(playerNum);
        const vp = calculateKillVp(dcName);
        awardKillVp(game, oppPN, vp);
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** was defeated! +${vp} VP to Player ${oppPN}.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (${newHp}/${maxHp} HP remaining).`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  } else {
    await logGameAction(game, client, `**${sourceLabel}:** **${dcName}** suffered **${damage} damage** (HP not found in memory — update DC card manually).`, { phase: 'ROUND', icon: 'attack' });
  }
}

export async function applyDirectDamageToFigure(game, playerNum, figKey, msgId, damage, client, thread, sourceName, ctx) {
  const { dcHealthState, checkWinConditions, calculateKillVp } = ctx;
  if (!msgId) return;
  const figMatch = figKey.match(/-\d+-(\d+)$/);
  const figIdx = figMatch ? parseInt(figMatch[1], 10) : 0;
  const { newHp, wasDefeated } = reduceHp(dcHealthState, game, msgId, figIdx, damage, playerNum);
  const figName = dcNameFromFigureKey(figKey);
  if (thread) await thread.send(`**${sourceName}** — ${figName} suffers **${damage} Damage**.`).catch(discordCatch);
  const dcIds = getDcMessageIds(game, playerNum);
  const dcList = getDcList(game, playerNum);
  const idx = (dcIds || []).indexOf(msgId);
  if (wasDefeated && idx >= 0) {
    removeFigurePosition(game, playerNum, figKey);
    // VP goes to the opponent (the one dealing the damage)
    const oppPN = opponentPlayerNum(playerNum);
    const vp = calculateKillVp(dcList[idx]?.dcName);
    awardKillVp(game, oppPN, vp);
    if (thread) await thread.send(`**${sourceName}** — ${figName} was **defeated**! +${vp} VP.`).catch(discordCatch);
    await checkWinConditions(game, client);
  }
}

export async function sendBleedingPrompt(game, channel, figureKey, playerNum, displayName) {
  const deckKey = ccDeckKey(playerNum);
  const deckCount = (game[deckKey] || []).length;
  const acceptBtn = new ButtonBuilder()
    .setCustomId(`bleed_accept_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel('Take 1 damage')
    .setStyle(ButtonStyle.Danger);
  const preventBtn = new ButtonBuilder()
    .setCustomId(`bleed_prevent_${game.gameId}_${playerNum}_${figureKey}`)
    .setLabel(`Prevent (discard CC, ${deckCount} left)`)
    .setStyle(ButtonStyle.Primary)
    .setDisabled(deckCount === 0);
  const row = new ActionRowBuilder().addComponents(acceptBtn, preventBtn);
  await channel.send({
    content: `🩸 **Bleeding** — **${displayName}** suffers 1 damage after resolving their action. Take damage or discard top CC to prevent?`,
    components: [row],
  }).catch(discordCatch);
}

/** Resolve combat after rolls (and optional surge). Applies damage, VP, updates embeds/board, clears pendingCombat.
 * @param {object} ctx - shared dependencies context
 */
export async function resolveCombatAfterRolls(game, combat, client, ctx) {
  const { logGameAction, findDcMessageIdForFigure, saveGames } = ctx;
  // Beatdown / nextAttacksBonusHits: consume one charge and add bonus to this attack
  const pending = game.nextAttacksBonusHits?.[combat.attackerPlayerNum];
  if (pending && pending.count > 0 && pending.bonus > 0) {
    combat.bonusHits = (combat.bonusHits || 0) + pending.bonus;
    pending.count -= 1;
    if (pending.count <= 0) delete game.nextAttacksBonusHits[combat.attackerPlayerNum];
  }
  // Size Advantage / nextAttacksBonusConditions: consume and add conditions to defender
  const condPending = game.nextAttacksBonusConditions?.[combat.attackerPlayerNum];
  if (condPending && condPending.count > 0 && condPending.conditions?.length) {
    combat.bonusConditions = combat.bonusConditions || [];
    combat.bonusConditions.push(...condPending.conditions);
    condPending.count -= 1;
    if (condPending.count <= 0) delete game.nextAttacksBonusConditions[combat.attackerPlayerNum];
  }
  const defenderPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
  const roundBlock = game.roundDefenseBonusBlock?.[defenderPlayerNum] || 0;
  const roundEvade = game.roundDefenseBonusEvade?.[defenderPlayerNum] || 0;
  if (roundBlock) combat.bonusBlock = (combat.bonusBlock || 0) + roundBlock;
  if (roundEvade) combat.bonusEvade = (combat.bonusEvade || 0) + roundEvade;
  const perEvade = game.roundDefenderBonusBlockPerEvade?.[defenderPlayerNum] || 0;
  if (perEvade && combat.defenseRoll) combat.bonusBlock = (combat.bonusBlock || 0) + (combat.defenseRoll.evade || 0) * perEvade;
  // Harsh Environment: exterior spaces -1 Evade; interior spaces +1 Block (applied once per combat resolution)
  if (game.harshEnvironmentActive && !combat.harshEnvApplied) {
    const _heMapId = game.selectedMap?.id;
    const _heMsData = _heMapId ? getMapSpaces(_heMapId) : null;
    const _heFigKey = combat.target?.figureKey;
    const _hePos = _heFigKey ? (game.figurePositions?.[defenderPlayerNum]?.[_heFigKey]) : null;
    if (_heMsData && _hePos) {
      combat.harshEnvApplied = true;
      const _heExterior = !!_heMsData.exterior?.[_hePos];
      if (_heExterior) {
        combat.bonusEvade = (combat.bonusEvade || 0) - 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on exterior space: \u22121 Evade.`, { phase: 'ROUND', icon: 'attack' });
      } else {
        combat.bonusBlock = (combat.bonusBlock || 0) + 1;
        await logGameAction(game, client, `\u26A1 **Harsh Environment** \u2014 **${combat.target.label}** on interior space: +1 Block.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Cavalry Charge: round TROOPER attack hit bonus
  const trooperHitBonus = game.roundTrooperAttackHitBonus?.[combat.attackerPlayerNum] || 0;
  if (trooperHitBonus) {
    const attackerEff = getDcEffect(combat.attackerDcName);
    const attackerKws = (attackerEff?.keywords || []).map((k) => String(k).toUpperCase());
    if (attackerKws.includes('TROOPER')) combat.bonusHits = (combat.bonusHits || 0) + trooperHitBonus;
  }
  let { hit, damage, resultText } = computeCombatResult(combat);
  const totalBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
  const attackerPlayerNum = combat.attackerPlayerNum;
  // Store target + adjacent spaces for Reduce to Rubble (only when attack hit)
  if (hit && game.selectedMap?.id) {
    const targetCoord = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetCoord) {
      const board = getBoardStateForMovement(game, null);
      if (board?.adjacency) {
        const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const targetSize = getEffectiveFigureSize(game, combat.target.figureKey, targetDcName);
        const targetCells = getFootprintCells(targetCoord, targetSize || '1x1').map((c) => normalizeCoord(c));
        const rubbleSet = new Set(targetCells);
        for (const c of targetCells) {
          for (const n of board.adjacency[c] || []) rubbleSet.add(normalizeCoord(n));
        }
        game.lastAttackTargetSpacesForRubble = [...rubbleSet];
        game.lastAttackAttackerPlayerNum = attackerPlayerNum;
      }
    }
  }
  const ownerId = getPlayerId(game, attackerPlayerNum);
  const targetMsgId = findDcMessageIdForFigure(game.gameId, defenderPlayerNum, combat.target.figureKey);
  const { figureIndex: targetFigIndex } = parseFigureKey(combat.target.figureKey);

  // Figurehead (Murne Rin): before friendly figure suffers damage, may redirect to self (prevent 1)
  if (damage > 0 && hit) {
    const fhResult = findFigureheadFigure(game, defenderPlayerNum, combat.target.figureKey, ctx);
    if (fhResult) {
      const fhOwnerId = getPlayerId(game, defenderPlayerNum);
      const fhThread = await client.channels.fetch(combat.combatThreadId);
      game.pendingFigurehead = {
        damage, hit, resultText, totalBlast,
        defenderPlayerNum, attackerPlayerNum, ownerId,
        targetMsgId, targetFigIndex,
        fhFigKey: fhResult.figureKey, fhMsgId: fhResult.msgId, fhFigIndex: fhResult.figIndex,
        fhLabel: fhResult.label,
      };
      await fhThread.send({
        content: `<@${fhOwnerId}> — **Figurehead**: **${combat.target.label}** is about to suffer **${damage} damage**. Murne Rin suffers **${Math.max(0, damage - 1)} damage** instead (prevents 1)?`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`figurehead_use_${game.gameId}`).setLabel('Use Figurehead').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`figurehead_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
        allowedMentions: { users: [fhOwnerId] },
      });
      return;
    }
  }
  await applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client, ctx);
}

/** Apply damage, conditions, defeat logic, and finish combat resolution. Called from resolveCombatAfterRolls and handleFigureheadDecision.
 * @param {object} ctx - shared dependencies context
 */
export async function applyDamageAndFinishCombat(game, combat, { damage, hit, resultText, totalBlast, defenderPlayerNum, attackerPlayerNum, ownerId, targetMsgId, targetFigIndex }, client, ctx) {
  const {
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    findDcMessageIdForFigure, calculateKillVp, lookupFigureDcIndex, getFigureLabel,
    checkWinConditions, decrementActivationIfGroupDefeated, updateAttachmentMessageForDc,
    buildDcEmbedAndFiles, getConditionsForDcMessage, getDcUpgradeAttachments,
    getCelebrationButtons, getCleaveTargetButtons, getFightingKnifeTargetButtons,
    buildBoardMapPayload, updateDcActionsMessage, ensureMovementBankMessage,
    updateMovementBankMessage, isDbConfigured, achievementsChannelId,
    checkAndGrantAchievements, postAchievementNotification,
    getFiguresOnOrAdjacentToSpace, applyIndiscriminateFireSplash, getFigureSize,
  } = ctx;
  const thread = await client.channels.fetch(combat.combatThreadId);
  // Store last attack metadata for post-attack CC effect handlers
  game.lastAttackAttackerMsgId = combat.attackerMsgId ?? null;
  game.lastAttackAttackerFigureIndex = combat.attackerFigureIndex ?? 0;
  game.lastAttackTargetFigureKey = combat.target?.figureKey ?? null;
  // Track that an attack was performed during this activation (for On a Diplomatic Mission, etc.)
  if (combat.attackerMsgId) {
    game.attackPerformedThisActivation = game.attackPerformedThisActivation || {};
    game.attackPerformedThisActivation[combat.attackerMsgId] = true;
  }

  // NPC target (thug / Krykna / Crate): apply damage directly, skip dcHealthState
  if (combat.target?.isNpc) {
    // Crate target (Devaron B)
    if (combat.target.npcType === 'crate') {
      const origCoord = combat.target.crateOrigCoord;
      if (origCoord && game.cratePositions?.[origCoord] !== undefined) {
        game.crateHealth = game.crateHealth || {};
        if (typeof game.crateHealth[origCoord] !== 'number') game.crateHealth[origCoord] = 5;
        if (damage > 0 && hit) {
          game.crateHealth[origCoord] = Math.max(0, game.crateHealth[origCoord] - damage);
          const curCoord = String(game.cratePositions[origCoord] || origCoord).toUpperCase();
          resultText += ` — Crate @ ${curCoord}: ${game.crateHealth[origCoord]}/5 HP remaining.`;
          if (game.crateHealth[origCoord] <= 0) {
            resultText += ` **Crate DESTROYED! Adjacent figures suffer 2 Damage.**`;
            const curCoordLow = String(game.cratePositions[origCoord] || origCoord).toLowerCase();
            delete game.cratePositions[origCoord];
            await logGameAction(game, client, `💥 Crate at **${curCoord}** destroyed! All adjacent figures suffer 2 Damage.`, { phase: 'ROUND', icon: 'attack' });
            for (const pn of [1, 2]) {
              for (const figKey of getFiguresOnOrAdjacentToSpace(game, pn, curCoordLow, 'devaron-garrison')) {
                await applyNpcDamageToFigure(game, pn, figKey, 2, 'Crate explosion', logGameAction, client, dcHealthState, dcMessageMeta);
              }
            }
            await checkWinConditions(game, client);
          }
        }
      }
      await thread.send({ content: resultText || '(No effect)', components: [] });
      saveGames();
      return;
    }
    // Thug / Krykna
    const npcArray = combat.target.npcType === 'thug' ? game.npcThugs : game.npcKrykna;
    const npc = npcArray?.[combat.target.npcIndex];
    if (npc && !npc.defeated) {
      if (damage > 0 && hit) {
        npc.hp = Math.max(0, npc.hp - damage);
        resultText += ` — ${combat.target.label}: ${npc.hp}/${npc.maxHp} HP remaining.`;
        if (npc.hp <= 0) {
          npc.defeated = true;
          awardKillVp(game, attackerPlayerNum, 2);
          resultText += ` **${combat.target.label} defeated! +2 VP**`;
          // Krykna claim: track on game state for end-of-round deploy option
          if (combat.target.npcType === 'krykna') {
            game.claimedKrykna = game.claimedKrykna || { 1: 0, 2: 0 };
            game.claimedKrykna[attackerPlayerNum] = (game.claimedKrykna[attackerPlayerNum] || 0) + 1;
          }
          await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+2 VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          await checkWinConditions(game, client);
        }
      }
    }
    await thread.send({ content: resultText || '(No effect)', components: [] });
    saveGames();
    return;
  }

  let _fdNeedsEmbedRefresh = false;
  if (damage > 0 && targetMsgId) {
    let { newHp: newCur } = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, damage, defenderPlayerNum);
    if (dcHealthState.get(targetMsgId)?.[targetFigIndex]) {
      // Achievement: Devastator (10+ damage in a single attack)
      if (damage >= 10 && isDbConfigured() && achievementsChannelId) {
        const _devUserId = getPlayerId(game, attackerPlayerNum);
        checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _devUserId, 'single_attack_damage', damage)
          .catch((err) => console.error('[Achievements] Devastator check failed:', err.message));
      }
      const dcMessageIds = getDcMessageIds(game, defenderPlayerNum);
      const dcList = getDcList(game, defenderPlayerNum);
      const idx = (dcMessageIds || []).indexOf(targetMsgId);
      let allConditions = [...(combat.surgeConditions || []), ...(combat.bonusConditions || [])];
      // Condition Immunity: filter out harmful conditions for immune figures
      if (allConditions.length && isConditionImmune(game, combat.target.figureKey)) {
        const blocked = allConditions.filter((c) => HARMFUL_CONDITIONS.includes(c));
        allConditions = allConditions.filter((c) => !HARMFUL_CONDITIONS.includes(c));
        if (blocked.length) {
          await logGameAction(game, client, `**Condition Immunity** — **${combat.target.label}** is immune to ${blocked.join(', ')}.`, { phase: 'ROUND', icon: 'card' });
        }
      }
      for (const _ac of allConditions) _applyCondition(game, combat.target.figureKey, _ac);
      // Furious Charge: if defender's player played this CC, and suffered >= threshold damage, grant Focus
      if (game.conditionalFocusIfDamagedGte?.playerNum === defenderPlayerNum && damage >= game.conditionalFocusIfDamagedGte.threshold) {
        if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
          await logGameAction(game, client, `**Furious Charge** — **${combat.target.label}** is now **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
        }
        game.conditionalFocusIfDamagedGte = null;
      }
      // Stun Batons (Riot Trooper E/R): after attack, if target suffered damage, target suffers 1 Strain
      if (damage > 0) {
        const _sbAttDcName = combat.attackerDcName || '';
        const _sbAttEff = getDcEffects()?.[_sbAttDcName];
        if ((_sbAttEff?.passives || []).includes('Stun Batons')) {
          // Flame Trooper Fireproof: cannot suffer Strain
          const _sbTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
          if (_sbTargetUpgrades.includes('Flame Trooper')) {
            await logGameAction(game, client, `**Fireproof** — **${combat.target.label}** is immune to Strain from Stun Batons.`, { phase: 'ROUND', icon: 'card' });
          } else {
          game.figureConditions = game.figureConditions || {};
          game.figureConditions[combat.target.figureKey] = game.figureConditions[combat.target.figureKey] || [];
          // Strain = 1 direct HP damage (apply via health reduction)
          const _sbResult = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          newCur = _sbResult.newHp;
          await logGameAction(game, client, `⚡ **Stun Batons** — **${combat.target.label}** suffers 1 Strain (1 HP damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Self-Preservation (Hired Gun Elite): when you suffer damage, become Focused
      if (newCur > 0) {
        const _spDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _spEff = getDcEffects()?.[_spDcName];
        if ((_spEff?.passives || []).includes('Self-Preservation')) {
          if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
            await logGameAction(game, client, `🛡️ **Self-Preservation** — **${_spDcName}** became **Focused** (suffered damage).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Fury of Kashyyyk (army-wide): when a friendly WOOKIEE suffers 3+ damage and survives, become Focused
      if (damage >= 3 && newCur > 0) {
        const _fokDefDcList = getDcList(game, defenderPlayerNum) || [];
        const _fokHasFury = _fokDefDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]');
        if (_fokHasFury) {
          const _fokTargetName = dcNameFromFigureKey(combat.target.figureKey);
          const _fokTargetKws = (getDcKeywords()[_fokTargetName] || []).map(k => String(k).toUpperCase());
          if (_fokTargetKws.includes('WOOKIEE')) {
            if (_applyCondition(game, combat.target.figureKey, 'Focus')) {
              await logGameAction(game, client, `**Fury of Kashyyyk** — **${_fokTargetName}** became **Focused** (suffered ${damage} Damage).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
      }
      // Guerilla (Rebel Pathfinder E/R, Alliance Ranger E): after attack, if defender defeated, attacker becomes Hidden
      if (newCur <= 0) {
        const _guerAttEff = getDcEffects()?.[combat.attackerDcName];
        if ((_guerAttEff?.abilityText || '').includes('Guerilla') || (_guerAttEff?.abilityText || '').includes('guerilla')) {
          if (_applyCondition(game, combat.attackerFigureKey, 'Hide')) {
            await logGameAction(game, client, `🥷 **Guerilla** — **${combat.attackerDcName}** became **Hidden** (defender defeated).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Jets (Sabine Wren): after attack, if target within 2 spaces, gain 1 MP
      if (combat.attackerDcName === 'Sabine Wren' && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
        const _jetsMsgId = combat.attackerMsgId;
        if (_jetsMsgId && game.movementBank?.[_jetsMsgId]) {
          game.movementBank[_jetsMsgId].total = (game.movementBank[_jetsMsgId].total || 0) + 1;
          game.movementBank[_jetsMsgId].remaining = (game.movementBank[_jetsMsgId].remaining || 0) + 1;
          await logGameAction(game, client, `🚀 **Jets** — **Sabine Wren** gains 1 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
        }
      }
      // Fly-By (Jet Trooper Elite): after attack, gain 2 MP if target was within 2 spaces
      {
        const _fbAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_fbAtkEff?.passives || []).includes('Fly-By') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _fbMsgId = combat.attackerMsgId;
          if (_fbMsgId) {
            grantMovementBank(game, _fbMsgId, 2);
            await logGameAction(game, client, `🚀 **Fly-By** — **${combat.attackerDcName}** gains 2 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Jets (Jet Trooper Regular): after attack, gain 1 MP if target within 2 spaces
      {
        const _jtAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_jtAtkEff?.passives || []).includes('Jets') && combat.distanceToTarget != null && combat.distanceToTarget <= 2) {
          const _jtMsgId = combat.attackerMsgId;
          if (_jtMsgId) {
            grantMovementBank(game, _jtMsgId, 1);
            await logGameAction(game, client, `🚀 **Jets** — **${combat.attackerDcName}** gains 1 MP (target within 2 spaces).`, { phase: 'ROUND', icon: 'attack' });
          }
        }
      }
      // Leg Hydraulics (Tress Hacnua): handled via specialAbilityIds check below (not passives) to avoid double-granting
      // Locked and Loaded (Migs Mayfeld): after attack, gain 2 Power Tokens (max 3 total)
      {
        const _llAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_llAtkEff?.passives || []).includes('Locked and Loaded')) {
          const _llFk = combat.attackerFigureKey;
          if (_llFk) {
            game.figurePowerTokens = game.figurePowerTokens || {};
            game.figurePowerTokens[_llFk] = game.figurePowerTokens[_llFk] || [];
            const _llCurrent = game.figurePowerTokens[_llFk].length;
            const _llGain = Math.min(2, 3 - _llCurrent);
            if (_llGain > 0) {
              game.pendingPowerTokenGrant = { grants: [{ figureKey: _llFk, figName: combat.attackerDcName, count: _llGain }], channelId: combat.combatThreadId, playerNum: attackerPlayerNum };
              const _llBtns = ['Hit', 'Surge', 'Block', 'Evade'].map(t =>
                new ButtonBuilder().setCustomId(`power_token_choice_${game.gameId}_${t.toLowerCase()}`).setLabel(t).setStyle(ButtonStyle.Secondary)
              );
              await thread.send({
                content: `🔫 **Locked and Loaded** — **${combat.attackerDcName}** gains ${_llGain} Power Token${_llGain > 1 ? 's' : ''} (${_llCurrent} → ${_llCurrent + _llGain}, max 3). Choose type:`,
                components: [new ActionRowBuilder().addComponents(_llBtns)],
              }).catch(discordCatch);
            } else {
              await logGameAction(game, client, `🔫 **Locked and Loaded** — **${combat.attackerDcName}** already at max 3 Power Tokens; no tokens gained.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
      // Open-Minded (Del Meeko): after attack, gain 1 MP or 1 Power Token (choice)
      {
        const _omAtkEff = getDcEffects()?.[combat.attackerDcName];
        if ((_omAtkEff?.passives || []).includes('Open-Minded')) {
          const _omMsgId = combat.attackerMsgId;
          const _omFk = combat.attackerFigureKey;
          if (_omMsgId && _omFk) {
            const _omBtns = [
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_mp`).setLabel('Gain 1 MP').setStyle(ButtonStyle.Primary),
              new ButtonBuilder().setCustomId(`act_passive_${game.gameId}_${_omMsgId}_openminded_token`).setLabel('Gain 1 Power Token').setStyle(ButtonStyle.Secondary),
            ];
            await thread.send({
              content: `🧠 **Open-Minded** — **${combat.attackerDcName}**: Choose one:`,
              components: [new ActionRowBuilder().addComponents(_omBtns)],
            }).catch(discordCatch);
          }
        }
      }
      // Nimble (Asajj Ventress): after attack resolves, defender gains 2 MP per Block result
      {
        const _nimDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _nimEff = getDcEffects()?.[_nimDcName];
        if ((_nimEff?.specialAbilityIds || []).includes('nimble_asajj') && combat.defenseRoll) {
          const _nimTotalBlock = combat.defenseRoll.block || 0;
          if (_nimTotalBlock > 0) {
            const _nimMp = _nimTotalBlock * 2;
            const _nimMsgId = targetMsgId;
            if (_nimMsgId) {
              grantMovementBank(game, _nimMsgId, _nimMp);
            }
            await logGameAction(game, client, `🦎 **Nimble** — **${_nimDcName}** gained ${_nimMp} MP (${_nimTotalBlock} Block result${_nimTotalBlock !== 1 ? 's' : ''} × 2).`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
          }
        }
      }
      // Slippery (Alliance Smuggler E/R): after attack resolves, defender gains 2 MP
      {
        const _slipDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _slipEff = getDcEffects()?.[_slipDcName];
        if ((_slipEff?.specialAbilityIds || []).some(id => id === 'slippery_smuggler_elite' || id === 'slippery_smuggler_reg')) {
          const _slipMsgId = targetMsgId;
          if (_slipMsgId) {
            grantMovementBank(game, _slipMsgId, 2);
          }
          await logGameAction(game, client, `🏃 **Slippery** — **${_slipDcName}** gains 2 MP after being attacked.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Leg Hydraulics (Tress Hacnua): after resolving an attack, attacker gains 1 MP
      {
        const _lhAtkDcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
        const _lhEff = getDcEffects()?.[_lhAtkDcName];
        if ((_lhEff?.specialAbilityIds || []).includes('leg_hydraulics_tress') && combat.attackerMsgId) {
          grantMovementBank(game, combat.attackerMsgId, 1);
          await logGameAction(game, client, `🦿 **Leg Hydraulics** — **${_lhAtkDcName}** gains 1 MP after attacking.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Loku Recon Token: Set Your Sights — after Loku's attack resolves, place recon token on target
      {
        const _lkAtkDcName = combat.attackerDcName || dcNameFromFigureKey(combat.attackerFigureKey);
        const _lkAtkEff = getDcEffects()?.[_lkAtkDcName];
        if ((_lkAtkEff?.specialAbilityIds || []).includes('set_your_sights_loku') && combat.target?.figureKey) {
          game.reconToken = { figureKey: combat.target.figureKey, playerNum: combat.attackerPlayerNum };
          await logGameAction(game, client, `🎯 **Set Your Sights** — Recon token placed on **${dcNameFromFigureKey(combat.target.figureKey)}**.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
        }
      }
      // Force Deflection (Yoda): after attack targeting Yoda or adjacent friendly REBEL resolves,
      // attacker suffers Damage = number of attack dice rolled. Limit once per round.
      {
        const _fdDefDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _fdDefEff = getDcEffects()?.[_fdDefDcName];
        const _fdDefIsTarget = (_fdDefEff?.specialAbilityIds || []).includes('force_deflection_yoda');
        let _fdYodaFigKey = null;
        if (_fdDefIsTarget) {
          // Yoda is the defender — use Yoda's own figure key for round tracking
          _fdYodaFigKey = combat.target.figureKey;
        } else {
          // Check if any Yoda figure on defender's team is adjacent to the target space AND defender is REBEL
          const _fdDefAffil = _fdDefEff?.affiliation || '';
          if (_fdDefAffil === 'Rebel') {
            const _fdFriendlyFigs = game.figurePositions?.[defenderPlayerNum] || {};
            const _fdTargetCoord = _fdFriendlyFigs[combat.target.figureKey];
            if (_fdTargetCoord) {
              for (const [fk, fCoord] of Object.entries(_fdFriendlyFigs)) {
                if (fk === combat.target.figureKey) continue;
                const fDcName = dcNameFromFigureKey(fk);
                const fEff = getDcEffects()?.[fDcName];
                if (!(fEff?.specialAbilityIds || []).includes('force_deflection_yoda')) continue;
                // Check adjacency (within 1 space)
                if (isWithinN(fCoord, _fdTargetCoord, 1, game.selectedMap?.id)) {
                  _fdYodaFigKey = fk;
                  break;
                }
              }
            }
          }
        }
        if (_fdYodaFigKey) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          const _fdKey = `${_fdYodaFigKey}_force_deflection`;
          if (!game.roundFigureAbilityUsed[_fdKey]) {
            game.roundFigureAbilityUsed[_fdKey] = true;
            const _fdDiceCount = combat.attackDiceResults?.length || 0;
            if (_fdDiceCount > 0 && combat.attackerMsgId) {
              const _fdAtkFigIdx = combat.attackerFigureIndex ?? 0;
              const { newHp: _fdAtkNew, prevHp: _fdAtkPrev, wasDefeated: _fdAtkDefeated } = reduceHp(dcHealthState, game, combat.attackerMsgId, _fdAtkFigIdx, _fdDiceCount, attackerPlayerNum);
              if (_fdAtkPrev > 0) {
                _fdNeedsEmbedRefresh = true;
                const _fdYodaDcName = dcNameFromFigureKey(_fdYodaFigKey);
                await logGameAction(game, client, `🔵 **Force Deflection** — **${_fdYodaDcName}** deflects! **${combat.attackerDcName}** suffers **${_fdDiceCount} Damage** (${_fdDiceCount} attack dice rolled). HP: ${_fdAtkPrev} → ${_fdAtkNew}.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
                // Check if attacker was defeated by Force Deflection
                if (_fdAtkDefeated) {
                  removeFigurePosition(game, attackerPlayerNum, combat.attackerFigureKey);
                  if (game.figureConditions?.[combat.attackerFigureKey]) delete game.figureConditions[combat.attackerFigureKey];
                  const _fdAtkStats = getDcStats(combat.attackerDcName);
                  const _fdAtkEffects = getDcEffects()?.[combat.attackerDcName];
                  const _fdAtkFigures = _fdAtkStats?.figures ?? 1;
                  const _fdAtkVp = (_fdAtkFigures > 1 && _fdAtkEffects?.subCost != null) ? _fdAtkEffects.subCost : (_fdAtkStats?.cost ?? 5);
                  awardKillVp(game, defenderPlayerNum, _fdAtkVp);
                  await logGameAction(game, client, `**Force Deflection** — **${combat.attackerDcName}** was defeated! +${_fdAtkVp} VP to Player ${defenderPlayerNum}.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
                }
              }
            }
          }
        }
      }
      // You Will Not Deny Me: prevent Fifth Brother from being defeated (restore HP to 1)
      if (newCur <= 0 && game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum) {
        const _ywndmDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        if (_ywndmDcName?.toLowerCase().includes('fifth')) {
          const { newHp: _ywndmNew } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          newCur = _ywndmNew;
          game.youWillNotDenyMeActive = null;
          await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother cannot be defeated! HP restored to 1.`, { phase: 'ROUND', icon: 'card' });
        }
      }
      // Sustained by Rage (Maul): cannot be defeated if has not activated this round — set HP to 1
      let _sbrImmune = false;
      if (newCur <= 0) {
        const _sbrDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _sbrEff = getDcEffects()?.[_sbrDcName];
        if ((_sbrEff?.specialAbilityIds || []).includes('sustained_by_rage')) {
          const _sbrActivatedIndices = getActivatedDcIndices(game, defenderPlayerNum) || [];
          if (idx >= 0 && !_sbrActivatedIndices.includes(idx)) {
            _sbrImmune = true;
            const { newHp: _sbrNew } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
            newCur = _sbrNew;
            await logGameAction(game, client, `**Sustained by Rage** — **${_sbrDcName}** cannot be defeated (has not activated this round)! HP set to 1.`, { phase: 'ROUND', icon: 'card' });
          }
        }
      }
      // Self-Destruct Protocol: pre-defeat interrupt — prompt owner to use ability before defeat
      if (newCur <= 0 && !game.selfDestructProtocolTriggered?.[targetMsgId]) {
        const _sdpDcName2 = idx >= 0 ? dcList?.[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _sdpEff2 = getDcEffects()?.[_sdpDcName2];
        if ((_sdpEff2?.specialAbilityIds || []).includes('self_destruct_protocol')) {
          game.selfDestructProtocolTriggered = game.selfDestructProtocolTriggered || {};
          game.selfDestructProtocolTriggered[targetMsgId] = true;
          game.pendingSelfDestruct = { targetMsgId, defenderPlayerNum, attackerPlayerNum, damage, hit, resultText, totalBlast, ownerId, targetFigIndex };
          const _sdpOwnerId2 = game[`player${defenderPlayerNum}Id`];
          const _sdpRow2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`self_destruct_protocol_use_${game.gameId}_${targetMsgId}`).setLabel('Use Self-Destruct').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`self_destruct_protocol_skip_${game.gameId}_${targetMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await logGameAction(game, client, `<@${_sdpOwnerId2}> **Self-Destruct Protocol** — **${combat.target.label || _sdpDcName2}** is about to be defeated! Roll 1 red die, apply Hits to adjacent figures, then the figure is defeated.`, { components: [_sdpRow2], allowedMentions: { users: [_sdpOwnerId2] } });
          saveGames();
          return;
        }
      }
      // Parting Shot (Greedo, Hired Gun): pre-defeat interrupt — may perform an attack before being defeated
      if (newCur <= 0 && !_sbrImmune && !game.partingShotTriggered?.[targetMsgId]) {
        const _psDcName = idx >= 0 ? dcList?.[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _psEff = getDcEffects()?.[_psDcName];
        const _psSIds = _psEff?.specialAbilityIds || [];
        const _psHas = _psSIds.some(id => id.startsWith('parting_shot_'));
        if (_psHas) {
          game.partingShotTriggered = game.partingShotTriggered || {};
          game.partingShotTriggered[targetMsgId] = true;
          const _psOwnerId = game[`player${defenderPlayerNum}Id`];
          await logGameAction(game, client, `<@${_psOwnerId}> ⚠️ **Parting Shot** — **${combat.target.label || _psDcName}** is about to be defeated! You may interrupt to perform an attack before defeat. Use the DC's Attack action to fire your parting shot, then click End Turn to proceed with defeat.`, { allowedMentions: { users: [_psOwnerId] } });
        }
      }
      // Last Resort (Skirmish Upgrade): pre-defeat interrupt — roll 1 red die, adjacent figures suffer Hits as damage
      if (newCur <= 0 && !_sbrImmune && !game.lastResortTriggered?.[targetMsgId]) {
        const _lrUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
        if (_lrUpgrades.includes('Last Resort')) {
          game.lastResortTriggered = game.lastResortTriggered || {};
          game.lastResortTriggered[targetMsgId] = true;
          game.pendingLastResort = { targetMsgId, defenderPlayerNum, attackerPlayerNum, damage, hit, resultText, totalBlast, ownerId, targetFigIndex };
          const _lrOwnerId = game[`player${defenderPlayerNum}Id`];
          const _lrRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`last_resort_use_${game.gameId}_${targetMsgId}`).setLabel('Use Last Resort').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`last_resort_skip_${game.gameId}_${targetMsgId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await logGameAction(game, client, `<@${_lrOwnerId}> **Last Resort** — **${combat.target.label}** is about to be defeated! Deplete to roll 1 red die — adjacent figures suffer Hits as Damage.`, { components: [_lrRow], allowedMentions: { users: [_lrOwnerId] } });
          saveGames();
          return;
        }
      }
      if (newCur <= 0 && !_sbrImmune && !(game.youWillNotDenyMeActive?.playerNum === defenderPlayerNum && ((idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey))?.toLowerCase().includes('fifth')))) {
        // F7: Keep healthState, figurePositions, and DC embed in sync when one figure in a group dies.
        removeFigurePosition(game, defenderPlayerNum, combat.target.figureKey);
        if (game.figureConditions?.[combat.target.figureKey]) delete game.figureConditions[combat.target.figureKey];
        const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
        const vp = calculateKillVp(targetDcName);
        const _vpK = vpKey(attackerPlayerNum);
        awardKillVp(game, attackerPlayerNum, vp);
        // Achievement: activation kill streak (Double Kill / Triple Kill / PENTAKILL)
        if (combat.attackerMsgId) {
          game.activationKills = game.activationKills || {};
          game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
          if (isDbConfigured() && achievementsChannelId) {
            const _akUserId = getPlayerId(game, attackerPlayerNum);
            checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId, 'activation_kills', game.activationKills[combat.attackerMsgId])
              .catch((err) => console.error('[Achievements] activation_kills check failed:', err.message));
          }
        }
        // Of No Importance: reduce VP gained when CC owner's own non-unique figure is defeated
        if (game.nextDefeatedFriendlyVpReduction?.playerNum === defenderPlayerNum) {
          const _noImportDcName = idx >= 0 ? dcList[idx]?.dcName : null;
          if (_noImportDcName && !isDcUnique(_noImportDcName)) {
            const _reduceAmt = game.nextDefeatedFriendlyVpReduction.amount || 0;
            const _reduced = Math.min(_reduceAmt, vp);
            game[_vpK].kills = Math.max(0, game[_vpK].kills - _reduced);
            game[_vpK].total = Math.max(0, game[_vpK].total - _reduced);
            resultText += ` (−${_reduced} VP: Of No Importance)`;
            await logGameAction(game, client, `**Of No Importance** — VP reduced by ${_reduced}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.nextDefeatedFriendlyVpReduction = null;
        }
        // Price on Their Heads: award bounty VP to setter when target group is defeated
        const _priceBounty = game.priceBounties?.[combat.target.label];
        if (_priceBounty) {
          const _bountyAmt = typeof _priceBounty === 'object' ? _priceBounty.amount : _priceBounty;
          const _bountySetterNum = typeof _priceBounty === 'object' ? _priceBounty.playerNum : attackerPlayerNum;
          awardObjectiveVp(game, _bountySetterNum, _bountyAmt);
          delete game.priceBounties[combat.target.label];
          const _bountyVpK = vpKey(_bountySetterNum);
          await logGameAction(game, client, `**Price on Their Heads** — +${_bountyAmt} VP bounty awarded to P${_bountySetterNum} (${game[_bountyVpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // Paid in Beskar: grant Block tokens when hostile is defeated within range
        if (game.whenDefeatHostileWithin3GainBlockTokens) {
          const _beskarData = game.whenDefeatHostileWithin3GainBlockTokens;
          const _beskarDist = combat.distanceToTarget ?? 0;
          const _beskarRange = _beskarData.range ?? 3;
          if (_beskarDist <= _beskarRange) {
            const _beskarTokens = _beskarData.tokens ?? 1;
            const _beskarFigKey = combat.attackerFigureKey;
            grantPowerTokens(game, _beskarFigKey, 'Block', _beskarTokens);
            await logGameAction(game, client, `**Paid in Beskar** — +${_beskarTokens} Block Token${_beskarTokens !== 1 ? 's' : ''} granted to ${combat.attackerDisplayName}.`, { phase: 'ROUND', icon: 'card' });
          }
          game.whenDefeatHostileWithin3GainBlockTokens = null;
        }
        // Worth Every Credit: bonus VP when hostile is defeated this activation
        if (game.nextHostileDefeatVpBonus?.[attackerPlayerNum]) {
          const _wecData = game.nextHostileDefeatVpBonus[attackerPlayerNum];
          const _wecAmt = typeof _wecData === 'object' ? (_wecData.amount ?? 2) : _wecData;
          awardObjectiveVp(game, attackerPlayerNum, _wecAmt);
          delete game.nextHostileDefeatVpBonus[attackerPlayerNum];
          await logGameAction(game, client, `**Worth Every Credit** — +${_wecAmt} bonus VP (${game[_vpK].total} total).`, { phase: 'ROUND', icon: 'card' });
        }
        // You Will Not Deny Me: prevent Fifth Brother defeat; on any hostile defeat recover 2 HP
        if (game.youWillNotDenyMeActive) {
          const _ywndmData = game.youWillNotDenyMeActive;
          const _fifthKey = Object.keys(game.figurePositions?.[_ywndmData.playerNum] || {}).find(k => dcNameFromFigureKey(k).toLowerCase() === 'fifth brother' || dcNameFromFigureKey(k) === 'fifth-brother');
          if (_fifthKey) {
            const _fifthMsgId = (() => { for (const [mid, mm] of dcMessageMeta) { if (mm.playerNum === _ywndmData.playerNum && mm.dcName?.toLowerCase().includes('fifth')) return mid; } return null; })();
            if (_fifthMsgId) {
              const { healed: _fifthHealed } = healHp(dcHealthState, game, _fifthMsgId, 0, 2, _ywndmData.playerNum);
              if (_fifthHealed > 0) {
                await logGameAction(game, client, `**You Will Not Deny Me** — Fifth Brother recovered 2 HP after hostile defeat.`, { phase: 'ROUND', icon: 'card' });
              }
              game.youWillNotDenyMeActive = null;
            }
          }
        }
        // Apex Predator: recover HP when a hostile within range is defeated this activation
        if (game.recoverOnHostileDefeat?.[attackerPlayerNum]) {
          const _apData = game.recoverOnHostileDefeat[attackerPlayerNum];
          const _apRange = _apData.range ?? 2;
          const _apDist = combat.distanceToTarget ?? 0;
          if (_apDist <= _apRange) {
            const _apMsgId = _apData.msgId ?? combat.attackerMsgId;
            const _apAmt = _apData.amount ?? 2;
            if (_apMsgId) {
              const _apFigIdx = combat.attackerFigureIndex ?? 0;
              const { healed: _apHealed } = healHp(dcHealthState, game, _apMsgId, _apFigIdx, _apAmt, attackerPlayerNum);
              if (_apHealed > 0) {
                await logGameAction(game, client, `**Apex Predator** — Recovered ${_apAmt} HP after defeating hostile within ${_apRange}.`, { phase: 'ROUND', icon: 'card' });
              }
            }
          }
          delete game.recoverOnHostileDefeat[attackerPlayerNum];
        }
        // Last Stand (Stormtrooper Elite): when defeated, another figure in the group becomes Focused
        const _lsDcName = idx >= 0 ? dcList[idx]?.dcName : dcNameFromFigureKey(combat.target.figureKey);
        const _lsEff = getDcEffects()?.[_lsDcName];
        if ((_lsEff?.passives || []).includes('Last Stand')) {
          const _lsDgMatch = (combat.target.figureKey || '').match(/-(\d+)-\d+$/);
          const _lsDgIdx = _lsDgMatch ? _lsDgMatch[1] : '1';
          const _lsPrefix = `${_lsDcName}-${_lsDgIdx}-`;
          const _lsAlive = Object.keys(game.figurePositions?.[defenderPlayerNum] || {}).filter(k => k.startsWith(_lsPrefix) && k !== combat.target.figureKey);
          if (_lsAlive.length > 0) {
            const _lsTarget = _lsAlive[0];
            if (_applyCondition(game, _lsTarget, 'Focus')) {
              const _lsName = dcNameFromFigureKey(_lsTarget);
              await logGameAction(game, client, `⚡ **Last Stand** — **${_lsName}** becomes **Focused** (another figure in the group was defeated).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Nefarious Gains (Jabba): when a hostile figure is defeated, Jabba's owner gains 1 VP
        const _jabbaOwner = attackerPlayerNum; // attacker defeated the hostile, so Jabba must be on attacker's side
        for (const pn of [1, 2]) {
          if (pn === defenderPlayerNum) continue; // Jabba's owner must be the one who defeated someone
          const _jabbaOnBoard = Object.keys(game.figurePositions?.[pn] || {}).some(fk => fk.startsWith('Jabba the Hutt-'));
          if (_jabbaOnBoard) {
            const vpObj = game[vpKey(pn)];
            if (vpObj) {
              vpObj.total = (vpObj.total || 0) + 1;
              vpObj.objectives = (vpObj.objectives || 0) + 1;
            }
            await logGameAction(game, client, `💰 **Nefarious Gains** — **Jabba the Hutt** gains 1 VP (hostile defeated). P${pn} VP: ${vpObj?.total ?? 0}`, { phase: 'ROUND', icon: 'card' });
          }
        }
        // Into the Force (Obi-Wan): when defeated, a friendly figure becomes Focused
        if (_lsDcName === 'Obi-Wan Kenobi') {
          const _obiAlive = Object.keys(game.figurePositions?.[defenderPlayerNum] || {}).filter(k => !k.startsWith('Obi-Wan Kenobi-'));
          if (_obiAlive.length > 0) {
            const _obiTarget = _obiAlive[0];
            if (_applyCondition(game, _obiTarget, 'Focus')) {
              const _obiName = dcNameFromFigureKey(_obiTarget);
              await logGameAction(game, client, `✨ **Into the Force** — **${_obiName}** becomes **Focused** (Obi-Wan was defeated).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Vengeance (Royal Guard Regular): when adjacent friendly non-GUARDIAN defeated, become Focused
        {
          const _defPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
          if (_defPos) {
            const _defDcEff = getDcEffects()?.[_lsDcName];
            const _defKws = (_defDcEff?.keywords || []).map(k => k.toUpperCase());
            const _defIsGuardian = _defKws.includes('GUARDIAN');
            if (!_defIsGuardian) {
              const _ms = getMapSpaces(game.selectedMap?.id);
              const _defAdj = (_ms?.adjacency?.[String(_defPos).toLowerCase()] || []).map(a => String(a).toLowerCase());
              for (const [rgFk, rgPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
                if (!rgPos || rgFk === combat.target.figureKey) continue;
                if (!_defAdj.includes(String(rgPos).toLowerCase())) continue;
                const rgDcName = dcNameFromFigureKey(rgFk);
                if (rgDcName !== 'Royal Guard (Regular)' && rgDcName !== 'Royal Guard (Elite)') continue;
                if (_applyCondition(game, rgFk, 'Focus')) {
                  const vLabel = rgDcName === 'Royal Guard (Elite)' ? 'Forward Vengeance' : 'Vengeance';
                  await logGameAction(game, client, `⚔️ **${vLabel}** — **${rgDcName}** becomes **Focused** (adjacent friendly defeated).`, { phase: 'ROUND', icon: 'card' });
                }
              }
            }
          }
        }
        // This is the Way (The Armorer): when attacker defeats defender, attacker gains 1 Block Token
        {
          const _armorerOnBoard = Object.keys(game.figurePositions?.[attackerPlayerNum] || {}).some(fk => fk.startsWith('The Armorer-'));
          if (_armorerOnBoard) {
            const _armorerGranted = grantPowerTokens(game, combat.attackerFigureKey, 'Block', 1, 2);
            if (_armorerGranted > 0) {
              await logGameAction(game, client, `🛡️ **This is the Way** — **${combat.attackerDcName}** gains 1 **Block Token** (defeated hostile).`, { phase: 'ROUND', icon: 'card' });
            }
          }
        }
        // Bounty (Fennec Shand): when defeated, opponent (= attacker) gains 2 VP
        {
          const _bountyDcName = _lsDcName;
          const _bountyEff = getDcEffects()?.[_bountyDcName];
          if ((_bountyEff?.passives || []).includes('Bounty')) {
            awardObjectiveVp(game, attackerPlayerNum, 2);
            const _bountyVpK2 = vpKey(attackerPlayerNum);
            await logGameAction(game, client, `💰 **Bounty** — **${_bountyDcName}** was defeated. Opponent (P${attackerPlayerNum}) gains **2 VP** (${game[_bountyVpK2].total} total).`, { phase: 'ROUND', icon: 'card' });
          }
        }
        // Brutal Tactics (Saw Gerrerra): when a hostile figure is defeated, each hostile within 3 of that figure becomes Weakened
        {
          const _btPlayerNum = attackerPlayerNum; // attacker's side has Saw
          const _btAllFigs = Object.keys(game.figurePositions?.[_btPlayerNum] || {});
          const _btHasSaw = _btAllFigs.some(fk => {
            const dcN = dcNameFromFigureKey(fk);
            return (getDcEffects()?.[dcN]?.passives || []).includes('Brutal Tactics');
          });
          if (_btHasSaw) {
            // defeated figure's position
            const _btDefPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey || ''];
            if (_btDefPos) {
              const _btEnemyPos = game.figurePositions?.[defenderPlayerNum] || {};
              let _btWeakened = 0;
              for (const [fk, pos] of Object.entries(_btEnemyPos)) {
                if (!pos || fk === (combat.target.figureKey || '')) continue;
                const dist = getRange(_btDefPos, pos);
                if (dist <= 3) {
                  if (isConditionImmune(game, fk)) continue; // Condition Immunity: skip Weaken
                  if (_applyCondition(game, fk, 'Weaken')) {
                    _btWeakened++;
                  }
                }
              }
              if (_btWeakened > 0) {
                await logGameAction(game, client, `⚔️ **Brutal Tactics** — ${_btWeakened} hostile figure${_btWeakened !== 1 ? 's' : ''} within 3 spaces of the defeated figure became **Weakened**.`, { phase: 'ROUND', icon: 'card' });
              }
            }
          }
        }
        resultText += ` — **${combat.target.label} defeated!** +${vp} VP`;
        await logGameAction(game, client, `<@${ownerId}> defeated **${combat.target.label}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (idx >= 0) {
          await decrementActivationIfGroupDefeated(game, defenderPlayerNum, idx, client);
          const ccAttachKey = ccAttachmentsKey(defenderPlayerNum);
          if (game[ccAttachKey]?.[targetMsgId]?.length) {
            delete game[ccAttachKey][targetMsgId];
            await updateAttachmentMessageForDc(game, defenderPlayerNum, targetMsgId, client);
          }
        }
        await checkWinConditions(game, client);
        // Celebration: after unique hostile defeated, offer attacker a chance to play it
        const defeatedDcName = idx >= 0 ? dcList[idx]?.dcName : null;
        if (isDcUnique(defeatedDcName)) {
          game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
          await thread.send({
            content: `<@${ownerId}> — You defeated a unique figure. Play **Celebration** to gain 4 VP?`,
            components: [getCelebrationButtons(game.gameId)],
            allowedMentions: { users: [ownerId] },
          }).catch(discordCatch);
        }
        // Auto-prompt for defeat-triggered reaction cards
        try {
          const ccCards = getCcEffectsData?.()?.cards || {};
          const _defeatTimings = new Set([
            'whenHostileFigureDefeatedNotYourActivation',
            'whenHostileFigureWithin3SpacesDefeated',
            'afterUniqueHostileDefeated',
          ]);
          const _ownDefeatTimings = new Set([
            'whenOneOfYourFiguresDefeated',
          ]);
          // Notify attacker about hostile-defeat reactions in hand
          const atkHand = getCcHand(game, attackerPlayerNum) || [];
          const atkDefeatCards = [...new Set(atkHand)].filter(c => ccCards[c]?.timing && _defeatTimings.has(ccCards[c].timing));
          if (atkDefeatCards.length) {
            await thread.send({ content: `<@${ownerId}> — Hostile defeated! You have ${atkDefeatCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [ownerId] } }).catch(() => {});
          }
          // Notify defender about own-figure-defeat reactions in hand
          const defId = getPlayerId(game, defenderPlayerNum);
          const defHand = getCcHand(game, defenderPlayerNum) || [];
          const defDefeatCards = [...new Set(defHand)].filter(c => ccCards[c]?.timing && _ownDefeatTimings.has(ccCards[c].timing));
          if (defDefeatCards.length) {
            await thread.send({ content: `<@${defId}> — Your figure was defeated! You have ${defDefeatCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [defId] } }).catch(() => {});
          }
        } catch (_defeatPromptErr) {
          console.error('Defeat reaction prompt error:', _defeatPromptErr?.message ?? _defeatPromptErr);
        }
      }
    }
    // Sustained by Rage: block recovery for figures with this passive
    const _sbrBlockRecover = getDcEffects()?.[combat.attackerDcName]?.specialAbilityIds?.includes('sustained_by_rage');
    if (combat.surgeRecover > 0 && combat.attackerMsgId != null && !_sbrBlockRecover) {
      healHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, combat.surgeRecover || 0, combat.attackerPlayerNum);
    }
    if (combat.superchargeStrainAfterAttackCount > 0 && combat.attackerMsgId != null) {
      reduceHp(dcHealthState, game, combat.attackerMsgId, combat.attackerFigureIndex ?? 0, combat.superchargeStrainAfterAttackCount || 0, combat.attackerPlayerNum);
    }
    // The Darksaber: convert Blast X → Cleave X during Darksaber Strike attack (before blast applies)
    let effectiveBlast = totalBlast;
    if (combat.darksaberBlastToCleave && (combat.surgeBlast || 0) > 0) {
      combat.surgeCleave = (combat.surgeCleave || 0) + combat.surgeBlast;
      const _dsConvertedBlast = combat.surgeBlast;
      combat.surgeBlast = 0;
      effectiveBlast = (combat.surgeBlast || 0) + (combat.bonusBlast || 0);
      await logGameAction(game, client, `**The Darksaber** — Blast ${_dsConvertedBlast} converted to Cleave ${_dsConvertedBlast}.`, { phase: 'ROUND', icon: 'card' });
    }
    if (effectiveBlast > 0 && hit && damage > 0 && game.selectedMap?.id) {
      const adjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
      for (const { figureKey: blastFigureKey, playerNum: blastPlayerNum } of adjacent) {
        // Flame Trooper Fireproof: own Blast does not affect friendly figures
        if (blastPlayerNum === attackerPlayerNum && _ftAtkUpgrades.includes('Flame Trooper')) continue;
        const blastMsgId = findDcMessageIdForFigure(game.gameId, blastPlayerNum, blastFigureKey);
        if (!blastMsgId) continue;
        const { figureIndex: blastFigIndex } = parseFigureKey(blastFigureKey);
        const { newHp: newBCur, wasDefeated: blastDefeated } = reduceHp(dcHealthState, game, blastMsgId, blastFigIndex, effectiveBlast, blastPlayerNum);
        const { dcList: blastDcList, idx: blastIdx } = lookupFigureDcIndex(game, blastPlayerNum, blastFigureKey);
        if (blastDefeated) {
          removeFigurePosition(game, blastPlayerNum, blastFigureKey);
          if (game.figureConditions?.[blastFigureKey]) delete game.figureConditions[blastFigureKey];
          const vp = calculateKillVp(blastDcList[blastIdx]?.dcName);
          awardKillVp(game, attackerPlayerNum, vp);
          // Achievement: count blast kills for activation streak
          if (combat.attackerMsgId) {
            game.activationKills = game.activationKills || {};
            game.activationKills[combat.attackerMsgId] = (game.activationKills[combat.attackerMsgId] || 0) + 1;
            if (isDbConfigured() && achievementsChannelId) {
              const _akUserId2 = getPlayerId(game, attackerPlayerNum);
              checkAndPostAchievements(checkAndGrantAchievements, postAchievementNotification, client, achievementsChannelId, _akUserId2, 'activation_kills', game.activationKills[combat.attackerMsgId])
                .catch((err) => console.error('[Achievements] blast activation_kills check failed:', err.message));
            }
          }
          const blastLabel = blastDcList[blastIdx]?.displayName || blastFigureKey;
          await logGameAction(game, client, `Blast: <@${ownerId}> defeated **${blastLabel}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
          if (blastIdx >= 0) {
            await decrementActivationIfGroupDefeated(game, blastPlayerNum, blastIdx, client);
            const blastCcAttachKey = ccAttachmentsKey(blastPlayerNum);
            if (game[blastCcAttachKey]?.[blastMsgId]?.length) {
              delete game[blastCcAttachKey][blastMsgId];
              await updateAttachmentMessageForDc(game, blastPlayerNum, blastMsgId, client);
            }
          }
          await checkWinConditions(game, client);
          const blastDefeatedDcName = blastDcList[blastIdx]?.dcName;
          if (!game.pendingCelebration && isDcUnique(blastDefeatedDcName)) {
            game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
            await thread.send({
              content: `<@${ownerId}> — You defeated a unique figure (Blast). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [ownerId] },
            }).catch(discordCatch);
          }
        }
      }
    }
  } else if (hit && damage === 0) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — blocked`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (!hit) {
    await logGameAction(game, client, `<@${ownerId}> attacked **${combat.target.label}** — miss`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  } else if (damage > 0) {
    await logGameAction(game, client, `<@${ownerId}> dealt **${damage}** damage to **${combat.target.label}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
  }
  // Discard consumed conditions post-combat
  if (combat.attackerFigureKey) {
    const _hadFocus = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Focus');
    filterCondition(game, combat.attackerFigureKey, 'Focus');  // Focus consumed after attacking
    if (_hadFocus) await logGameAction(game, client, `🎯 **Focus** consumed on **${combat.attackerDcName}** \u2014 used in this attack.`, { phase: 'ROUND', icon: 'attack' });
    const _atkHidden = (game.figureConditions?.[combat.attackerFigureKey] || []).includes('Hide');
    filterCondition(game, combat.attackerFigureKey, 'Hide');   // Attacker loses Hidden after resolving an attack
    if (_atkHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.attackerDcName}** \u2014 resolved an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  if (combat.target?.figureKey) {
    const _defHidden = (game.figureConditions?.[combat.target.figureKey] || []).includes('Hide');
    filterCondition(game, combat.target.figureKey, 'Hide');    // Defender loses Hidden after being attacked
    if (_defHidden) await logGameAction(game, client, `\uD83D\uDC7B **Hidden** removed from **${combat.target.label}** \u2014 was targeted by an attack.`, { phase: 'ROUND', icon: 'attack' });
  }
  // Burst Fire: apply Stun to all figures adjacent to target if target suffered damage
  if (game.burstFirePendingMsgId?.[combat.attackerMsgId]) {
    const _bfPending = game.burstFirePendingMsgId[combat.attackerMsgId];
    delete game.burstFirePendingMsgId[combat.attackerMsgId];
    if (damage > 0 && combat.target?.figureKey) {
      const _bfMapId = game.selectedMap?.id;
      const _bfMs = _bfMapId ? getMapSpaces(_bfMapId) : null;
      const _bfTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_bfMs && _bfTargetPos) {
        const _bfAdj = _bfMs.adjacency?.[_bfTargetPos] || [];
        for (const _bfPn of [1, 2]) {
          for (const [_bfFk, _bfPos] of Object.entries(game.figurePositions?.[_bfPn] || {})) {
            if (!_bfAdj.includes(_bfPos)) continue;
            if (_bfFk === combat.target.figureKey) continue;
            if (isConditionImmune(game, _bfFk)) continue; // Condition Immunity: skip Stun
            if (_applyCondition(game, _bfFk, 'Stun')) {
              const _bfDcName = dcNameFromFigureKey(_bfFk);
              await logGameAction(game, client, `\uD83D\uDCA5 **Burst Fire** \u2014 **${_bfDcName}** (adjacent) is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
            }
          }
        }
      }
    }
  }
  // Crippling Blow: Stun defender if attack didn't miss
  if (game.cripplingBlowPending?.[combat.attackerMsgId]) {
    delete game.cripplingBlowPending[combat.attackerMsgId];
    if (hit && combat.target?.figureKey) {
      if (!isConditionImmune(game, combat.target.figureKey)) {
        if (_applyCondition(game, combat.target.figureKey, 'Stun')) {
          await logGameAction(game, client, `⚡ **Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is now **Stunned**.`, { phase: 'ROUND', icon: 'attack' });
        }
      } else {
        await logGameAction(game, client, `**Crippling Blow** — **${combat.target.label || dcNameFromFigureKey(combat.target.figureKey)}** is immune to Stun.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Disruptor Rifle: if attack didn't miss and defender at exactly 1 HP, deal 1 more damage
  if (game.disruptorRiflePending?.[combat.attackerMsgId]) {
    delete game.disruptorRiflePending[combat.attackerMsgId];
    if (hit && targetMsgId) {
      const _drHS = dcHealthState.get(targetMsgId) || [];
      const _drEntry = _drHS[targetFigIndex];
      if (_drEntry) {
        const [_drCur] = _drEntry;
        if (_drCur === 1) {
          reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
          await logGameAction(game, client, `💀 **Disruptor Rifle** — **${combat.target?.label || ''}** had 1 HP remaining — suffers 1 additional Damage and is **defeated**.`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
  }
  // Tonfa Strike: grant second free attack after first resolves
  if (game.tonfaStrikeSecondAttack?.[combat.attackerMsgId]) {
    delete game.tonfaStrikeSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerMsgId] = true;
    await thread.send('**Tonfa Strike** — You may perform an additional attack (use Attack button).');
  }
  // Imperial Loadout post-attack effects
  if (combat.loadoutPostAttack) {
    const _lpa = combat.loadoutPostAttack;
    // Electro-pulse (Electrohammer): each other figure adjacent to target suffers 1 Damage
    if (_lpa === 'electro_pulse' && combat.target?.figureKey) {
      const _epTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_epTargetPos) {
        const _epLines = [];
        for (const [pNum, poses] of [[1, game.figurePositions?.[1] || {}], [2, game.figurePositions?.[2] || {}]]) {
          for (const [fk, pos] of Object.entries(poses)) {
            if (fk === combat.target.figureKey) continue;
            if (getRange(pos, _epTargetPos) !== 1) continue;
            const _epFkDcName = dcNameFromFigureKey(fk);
            const _epMid = getDcMessageIds(game, pNum) || [];
            const _epDcL = getDcList(game, pNum);
            const { dgIndex: _epDgIdx, figureIndex: _epFigIdx } = parseFigureKey(fk);
            const _epMsgId = _epMid.find((mid, idx) => _epDcL?.[idx]?.dcName === _epFkDcName && _epDcL?.[idx]?.dgIndex === _epDgIdx);
            if (_epMsgId) {
              reduceHp(dcHealthState, game, _epMsgId, _epFigIdx, 1, pNum);
            }
            _epLines.push(`**${_epFkDcName}** suffers 1 Damage`);
          }
        }
        if (_epLines.length > 0) {
          await logGameAction(game, client, `⚡ **Electro-pulse** — Adjacent figures:\n${_epLines.join('\n')}`, { phase: 'ROUND', icon: 'attack' });
        }
      }
    }
    // Quick Strike (Electrostaff): if defender rerolled/modified dice, defender suffers 1 Damage
    if (_lpa === 'quick_strike' && hit && combat.target?.figureKey && targetMsgId) {
      const _qsModified = combat.defenderRerolledOrModified;
      if (_qsModified) {
        reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
        await logGameAction(game, client, `⚡ **Quick Strike** — Defender modified dice/results: **${combat.target.label}** suffers 1 Damage.`, { phase: 'ROUND', icon: 'attack' });
      }
    }
    // Flurry of Blows (Electrobatons): free melee attack with 1 green die + +1 Hit, limit once per activation
    if (_lpa === 'flurry_of_blows' && hit && combat.attackerMsgId) {
      const _fobKey = `flurryOfBlows_${combat.attackerMsgId}`;
      if (!game.roundFigureAbilityUsed?.[_fobKey]) {
        if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
        game.roundFigureAbilityUsed[_fobKey] = true;
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[combat.attackerMsgId] = true;
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[combat.attackerMsgId] = { dice: ['green'], type: 'melee', bonusHits: 1 };
        await thread.send('**Flurry of Blows** — You may perform a Melee attack using 1 green die (+1 Hit). Use the Attack button.');
      }
    }
  }
  // Clawdite Streetrat Assassin's Blade post-attack: choose an adjacent hostile, roll 1 red die, deal Hits
  if (combat.formPostAttack === 'assassins_blade' && combat.attackerFigureKey) {
    const _abAttackerPos = game.figurePositions?.[attackerPlayerNum]?.[combat.attackerFigureKey];
    if (_abAttackerPos) {
      // Find adjacent hostile figures
      const _abAdjacentHostiles = [];
      for (const [_abFk, _abPos] of Object.entries(game.figurePositions?.[defenderPlayerNum] || {})) {
        if (!_abPos) continue;
        if (getRange(_abAttackerPos, _abPos) === 1) _abAdjacentHostiles.push({ fk: _abFk, pos: _abPos });
      }
      if (_abAdjacentHostiles.length === 0) {
        await thread.send(`🗡️ **Assassin's Blade** — No adjacent hostile figures.`).catch(discordCatch);
      } else {
        const _abDiceData = getDiceData();
        const _abRedFaces = _abDiceData?.attack?.red || [];
        if (_abRedFaces.length > 0) {
          const _abRoll = _abRedFaces[Math.floor(Math.random() * _abRedFaces.length)];
          const _abHits = (_abRoll.damage || 0);
          const _abRollStr = Object.entries(_abRoll).filter(([k,v]) => v > 0 && k !== 'blank').map(([k,v]) => `${v} ${k}`).join(', ') || 'blank';
          if (_abAdjacentHostiles.length === 1 && _abHits > 0) {
            // Auto-apply to the only adjacent hostile
            const { fk: _abFk2 } = _abAdjacentHostiles[0];
            const _abDcName = dcNameFromFigureKey(_abFk2);
            for (const [_abMsgId, _abMeta] of dcMessageMeta) {
              if (_abMeta.gameId !== game.gameId || _abMeta.playerNum !== defenderPlayerNum || _abMeta.dcName !== _abDcName) continue;
              const _abFigIdx = parseInt(_abFk2.split('-').pop(), 10) || 0;
              reduceHp(dcHealthState, game, _abMsgId, _abFigIdx, _abHits, defenderPlayerNum);
              break;
            }
            await thread.send(`🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. **${_abDcName}** suffers **${_abHits} Damage**.`).catch(discordCatch);
            await logGameAction(game, client, `🗡️ **Assassin's Blade** — **${_abDcName}** suffers **${_abHits} Damage**.`, { phase: 'ROUND', icon: 'attack' });
          } else if (_abHits > 0) {
            // Multiple adjacent hostiles — honor system for the choice
            const _abNames = _abAdjacentHostiles.map(({ fk }) => dcNameFromFigureKey(fk)).join(', ');
            await thread.send(`🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}** (${_abHits} Damage). Choose an adjacent hostile figure to apply damage: ${_abNames}. *(Honor system.)*`).catch(discordCatch);
          } else {
            await thread.send(`🗡️ **Assassin's Blade** — Rolled 1 red die: **${_abRollStr}**. No hits.`).catch(discordCatch);
          }
        }
      }
    }
  }
  // Suppressive Fire (Skirmish Upgrade): exhaust after Ranged attack → Weaken target + 2 MP to SMALL friendly within 3
  const _sfUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  const _sfExh = game.exhaustedSkirmishUpgrades?.[combat.attackerMsgId] || [];
  if (_sfUpgrades.includes('Suppressive Fire') && !_sfExh.includes('Suppressive Fire') && combat.isRanged && damage > 0) {
    game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
    game.exhaustedSkirmishUpgrades[combat.attackerMsgId] = [..._sfExh, 'Suppressive Fire'];
    // Apply Weaken to the target
    const _sfTargetFk = combat.target?.figureKey;
    if (_sfTargetFk && !isConditionImmune(game, _sfTargetFk)) {
      _applyCondition(game, _sfTargetFk, 'Weaken');
    }
    const _sfTargetName = dcNameFromFigureKey(combat.target?.figureKey) || combat.defenderDcName;
    await thread.send(`**Suppressive Fire** — Exhausted: **${_sfTargetName}** becomes Weakened. You may choose a SMALL friendly figure within 3 spaces to gain 2 MP. *(Honor system for MP grant.)*`).catch(discordCatch);
    await logGameAction(game, client, `**Suppressive Fire** — **${_sfTargetName}** Weakened after Ranged attack.`, { phase: 'ROUND', icon: 'card' });
  }
  // Flame Trooper Incinerate: after attacking, each figure that suffered damage suffers 1 Strain (HP loss). Place Rubble in target space.
  const _ftAtkUpgrades = combat.attackerMsgId ? (game.p1DcAttachments?.[combat.attackerMsgId] || game.p2DcAttachments?.[combat.attackerMsgId] || []) : [];
  if (_ftAtkUpgrades.includes('Flame Trooper') && hit) {
    // Apply 1 Strain (1 HP loss) to target if it suffered damage and survived
    if (damage > 0 && targetMsgId) {
      // Fireproof: target immune to Strain if it also has Flame Trooper attachment
      const _ftTargetUpgrades = game.p1DcAttachments?.[targetMsgId] || game.p2DcAttachments?.[targetMsgId] || [];
      if (_ftTargetUpgrades.includes('Flame Trooper')) {
        await thread.send('**Incinerate** — Target is **Fireproof**, immune to Strain.').catch(discordCatch);
      } else {
        const _ftHsBefore = dcHealthState.get(targetMsgId);
        if (_ftHsBefore?.[targetFigIndex]?.[0] > 0) {
            const { newHp: _ftNew } = reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
            await thread.send(`**Incinerate** — **${combat.target.label}** suffers 1 Strain (1 HP damage).`).catch(discordCatch);
            if (_ftNew <= 0) {
              await thread.send(`⚠️ **${combat.target.label}** may be defeated from Incinerate Strain. *(Apply defeat manually.)*`).catch(() => {});
            }
        }
      }
    }
    // Blast damage also triggers Incinerate Strain on adjacent damaged figures — honor system
    if (effectiveBlast > 0) {
      await thread.send('**Incinerate** — Figures that suffered Blast damage also suffer 1 Strain. *(Honor system.)*').catch(() => {});
    }
    // Place Rubble token in target space (if attack didn't miss)
    if (combat.target?.figureKey) {
      const _ftTargetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      if (_ftTargetPos) {
        game.rubbleTokens = game.rubbleTokens || [];
        const _ftCoord = String(_ftTargetPos).toLowerCase();
        if (!game.rubbleTokens.includes(_ftCoord)) {
          game.rubbleTokens.push(_ftCoord);
        }
        await thread.send(`**Incinerate** — Rubble token placed at **${String(_ftTargetPos).toUpperCase()}**.`).catch(() => {});
      }
    }
  }

  const embedRefreshMsgIds = new Set(damage > 0 && targetMsgId ? [targetMsgId] : []);
  if (combat.surgeRecover > 0 && combat.attackerMsgId != null) embedRefreshMsgIds.add(combat.attackerMsgId);
  // Force Deflection embed refresh (flag set earlier in pre-defeat section)
  if (_fdNeedsEmbedRefresh && combat.attackerMsgId) embedRefreshMsgIds.add(combat.attackerMsgId);

  // Concentrated Fire: apply Stun to the attacker figure after attack resolves
  if (game.applySelfStunAfterAttackPlayerNum?.[attackerPlayerNum] && combat.attackerMsgId) {
    delete game.applySelfStunAfterAttackPlayerNum[attackerPlayerNum];
    const _cfaFigKey = combat.attackerFigureKey;
    if (_cfaFigKey && !isConditionImmune(game, _cfaFigKey)) {
      if (_applyCondition(game, _cfaFigKey, 'Stun')) {
        const _cfaDcName = dcNameFromFigureKey(_cfaFigKey);
        await logGameAction(game, client, `**Concentrated Fire** — **${_cfaDcName}** is now **Stunned**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Wild Fury: after final free attack, apply postActivationConditions (Stun + Bleed) to attacker figure
  if (game.pendingPostAttackConditions?.[combat.attackerMsgId] && combat.attackerFigureKey) {
    let _ppaConditions = game.pendingPostAttackConditions[combat.attackerMsgId];
    delete game.pendingPostAttackConditions[combat.attackerMsgId];
    if (Array.isArray(_ppaConditions) && _ppaConditions.length > 0) {
      // Condition Immunity: filter out harmful conditions for immune figures
      if (isConditionImmune(game, combat.attackerFigureKey)) {
        _ppaConditions = _ppaConditions.filter((c) => !HARMFUL_CONDITIONS.includes(c));
      }
      if (_ppaConditions.length > 0) {
        for (const _ppaC of _ppaConditions) {
          _applyCondition(game, combat.attackerFigureKey, _ppaC);
        }
        const _ppaDcName = dcNameFromFigureKey(combat.attackerFigureKey);
        await logGameAction(game, client, `**Wild Fury** — **${_ppaDcName}** is now **${_ppaConditions.join(' + ')}**.`, { phase: 'ROUND', icon: 'card' });
        embedRefreshMsgIds.add(combat.attackerMsgId);
      }
    }
  }
  // Dying Lunge / Final Stand: attacker defeats itself after the attack resolves
  if (game.selfDefeatsAfterAttackMsgId?.[combat.attackerMsgId] && combat.attackerMsgId) {
    delete game.selfDefeatsAfterAttackMsgId[combat.attackerMsgId];
    const _sdaMsgId = combat.attackerMsgId;
    const _sdaFigKey = combat.attackerFigureKey;
    const _sdaFigIdx = combat.attackerFigureIndex ?? 0;
    if (_sdaFigKey) {
      const _sdaPrevHs = dcHealthState.get(_sdaMsgId);
      if (_sdaPrevHs?.[_sdaFigIdx]) {
        const _sdaMaxHp = _sdaPrevHs[_sdaFigIdx][1] ?? _sdaPrevHs[_sdaFigIdx][0] ?? 99;
        reduceHp(dcHealthState, game, _sdaMsgId, _sdaFigIdx, _sdaMaxHp, attackerPlayerNum);
        const _sdaDcIds = getDcMessageIds(game, attackerPlayerNum);
        const _sdaDcList = getDcList(game, attackerPlayerNum);
        const _sdaIdx = (_sdaDcIds || []).indexOf(_sdaMsgId);
        removeFigurePosition(game, attackerPlayerNum, _sdaFigKey);
        if (game.figureConditions?.[_sdaFigKey]) delete game.figureConditions[_sdaFigKey];
        const _sdaName = _sdaDcList?.[_sdaIdx]?.displayName || dcNameFromFigureKey(_sdaFigKey);
        const _sdaStats = _sdaIdx >= 0 ? getDcStats(_sdaDcList[_sdaIdx]?.dcName) : null;
        const _sdaVp = _sdaStats?.cost ?? 5;
        awardKillVp(game, defenderPlayerNum, _sdaVp);
        embedRefreshMsgIds.add(_sdaMsgId);
        await logGameAction(game, client, `**${_sdaName}** defeated itself (self-sacrifice). Opponent gains **${_sdaVp} VP**.`, { phase: 'ROUND', icon: 'attack' });
        await checkWinConditions(game, client);
      }
    }
  }

  // --- Named surge post-combat effects ---
  if (hit && targetMsgId) {
    // Harass: defender suffers N Strain after a non-miss
    if ((combat.surgeHarass || 0) > 0) {
      reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, combat.surgeHarass, defenderPlayerNum);
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Harass** — **${combat.target.label}** suffers **${combat.surgeHarass}** Strain`, { phase: 'ROUND', icon: 'attack' });
    }
    // Suppression: target suffers Strain = min(block + evade + [1 if dodge], 2)
    if (combat.surgeSuppressionStrain) {
      const supRoll = combat.defenseRoll || {};
      const supAmt = Math.min((supRoll.block || 0) + (supRoll.evade || 0) + (supRoll.dodge ? 1 : 0), 2);
      if (supAmt > 0) {
        reduceHp(dcHealthState, game, targetMsgId, targetFigIndex, supAmt, defenderPlayerNum);
        embedRefreshMsgIds.add(targetMsgId);
        await logGameAction(game, client, `**Suppression** — **${combat.target.label}** suffers **${supAmt}** Strain (${supRoll.block || 0} block, ${supRoll.evade || 0} evade${supRoll.dodge ? ', 1 dodge' : ''})`, { phase: 'ROUND', icon: 'attack' });
      }
    }
  }
  // Mandalorian Steel: if defender spent a Block Token this attack, recover 1 Damage on the defending figure
  if (combat.defenderSpentBlock && game.mandaAsteelPlayerNum === defenderPlayerNum && targetMsgId) {
    const { healed } = healHp(dcHealthState, game, targetMsgId, targetFigIndex, 1, defenderPlayerNum);
    if (healed > 0) {
      embedRefreshMsgIds.add(targetMsgId);
      await logGameAction(game, client, `**Mandalorian Steel** — **${combat.target.label}** spent a Block Token; recovered 1 Damage`, { phase: 'ROUND', icon: 'card' });
    }
  }

  // Stalk Prey: attacker gains +2 MP and +1 Hit Token on hit
  if (hit && combat.surgeStalkPrey && combat.attackerMsgId) {
    game.movementBank = game.movementBank || {};
    const spBank = game.movementBank[combat.attackerMsgId] || { total: 0, remaining: 0 };
    spBank.total = (spBank.total ?? 0) + 2;
    spBank.remaining = (spBank.remaining ?? 0) + 2;
    game.movementBank[combat.attackerMsgId] = spBank;
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[combat.attackerFigureKey] = [...(game.figurePowerTokens[combat.attackerFigureKey] || []), 'Hit'];
    await logGameAction(game, client, `**Stalk Prey** — **${combat.attackerDcName}** gained +2 MP and +1 Hit Token`, { phase: 'ROUND', icon: 'card' });
    await ensureMovementBankMessage(game, combat.attackerMsgId, client);
    embedRefreshMsgIds.add(combat.attackerMsgId);
  }
  // Squad Command: Focus an adjacent friendly TROOPER
  if (hit && combat.surgeSquadCommand && game.selectedMap?.id && combat.attackerFigureKey) {
    const sqAdj = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id);
    for (const { figureKey: sqFk, playerNum: sqPn } of sqAdj) {
      if (sqPn !== attackerPlayerNum) continue;
      const sqDcName = dcNameFromFigureKey(sqFk);
      const sqEff = getDcEffect(sqDcName);
      const sqKws = (sqEff?.keywords || []).map((k) => String(k).toUpperCase());
      if (!sqKws.includes('TROOPER')) continue;
      if (_applyCondition(game, sqFk, 'Focus')) {
        const sqMsgId = findDcMessageIdForFigure(game.gameId, sqPn, sqFk);
        if (sqMsgId) embedRefreshMsgIds.add(sqMsgId);
        await logGameAction(game, client, `**Squad Command** — **${sqDcName}** is now **Focused**`, { phase: 'ROUND', icon: 'card' });
      }
    }
  }

  // Bleed: attacker prompted to take 1 damage or prevent by discarding CC after Attack action
  // (skipped if player spent a surge to prevent Bleed during the surge window)
  if (combat.attackerConds?.includes('Bleed') && !combat.surgePreventBleed) {
    const bleedThread = await client.channels.fetch(combat.combatThreadId);
    await sendBleedingPrompt(game, bleedThread, combat.attackerFigureKey, combat.attackerPlayerNum, combat.attackerDisplayName);
  }
  // Deflection: if defender took 0 damage (attack hit but was fully blocked), attacker suffers N damage
  const deflectDmg = game.deflectionPending?.[defenderPlayerNum];
  if (deflectDmg && deflectDmg > 0 && hit && damage === 0) {
    delete game.deflectionPending[defenderPlayerNum];
    const attMsgId = combat.attackerMsgId;
    const attFigIdx = combat.attackerFigureIndex ?? 0;
    if (attMsgId) {
      const { maxHp: deflectMax } = reduceHp(dcHealthState, game, attMsgId, attFigIdx, deflectDmg, attackerPlayerNum);
      if (deflectMax > 0) {
        embedRefreshMsgIds.add(attMsgId);
        const defOwnerId = getPlayerId(game, defenderPlayerNum);
        await logGameAction(game, client, `<@${defOwnerId}> **Deflection** — Attacker suffers **${deflectDmg} Damage** (you took no damage).`, { allowedMentions: { users: [defOwnerId] }, phase: 'ROUND', icon: 'card' });
      }
    }
  }
  // Embed refresh for Blast damage already applied earlier in this function
  if (totalBlast > 0 && hit && game.selectedMap?.id) {
    const blastAdjacent = getFiguresAdjacentToTarget(game, combat.target.figureKey, game.selectedMap.id);
    for (const { figureKey: bk, playerNum: bp } of blastAdjacent) {
      const mid = findDcMessageIdForFigure(game.gameId, bp, bk);
      if (mid) embedRefreshMsgIds.add(mid);
    }
  }
  // F6 Cleave: attacker may choose one other figure in melee (adjacent to attacker) to apply cleave damage
  // Triggered by either surge Cleave ability or Cleave N passive on deployment card
  const effectiveCleave = (combat.surgeCleave || 0) + (combat.passiveCleave || 0);
  if (hit && damage > 0 && effectiveCleave > 0 && game.selectedMap?.id) {
    const attMeta = combat.attackerMsgId ? dcMessageMeta.get(combat.attackerMsgId) : null;
    const attDg = (attMeta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const attackerFigureKey = attMeta ? `${attMeta.dcName}-${attDg}-${combat.attackerFigureIndex ?? 0}` : null;
    if (attackerFigureKey) {
      const adjacentToAttacker = getFiguresAdjacentToTarget(game, attackerFigureKey, game.selectedMap.id);
      const cleaveTargets = adjacentToAttacker.filter(
        (c) => c.playerNum === defenderPlayerNum && c.figureKey !== combat.target.figureKey
      );
      if (cleaveTargets.length > 0) {
        const targetsWithLabels = cleaveTargets.map((c) => {
          const { msgId, label } = getFigureLabel(game, c.playerNum, c.figureKey, c.figureKey);
          return { figureKey: c.figureKey, playerNum: c.playerNum, label };
        });
        game.pendingCleave = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          surgeCleave: effectiveCleave,
          attackerPlayerNum,
          ownerId,
          targets: targetsWithLabels,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const cleaveRows = getCleaveTargetButtons(game.gameId, targetsWithLabels);
        await thread.send({
          content: `**Cleave (${effectiveCleave} damage):** <@${ownerId}> — Choose one target in melee to apply cleave damage:`,
          allowedMentions: { users: [ownerId] },
          components: cleaveRows,
        });
        return;
      }
    }
  }
  const fkTriggered = await checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, ctx);
  if (!fkTriggered) await finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client, ctx);
}

/**
 * Check for post-combat surge effects that need UI interaction, before finishCombatResolution.
 * Returns true if a pending interaction was triggered (caller should NOT call finishCombatResolution yet).
 * Returns false if nothing triggered (caller should call finishCombatResolution).
 */
export async function checkPostCombatSurges(game, combat, resultText, embedRefreshMsgIds, thread, ownerId, defenderPlayerNum, ctx) {
  const { getFigureLabel, getFigureSize, getFightingKnifeTargetButtons, saveGames, dcMessageMeta, updateMovementBankMessage } = ctx;
  const hit = !resultText.includes('**Miss**');
  // Fighting Knife (Verena Talos): after non-miss, choose adjacent hostile, roll 1 red die, apply hits
  if (hit && combat.surgeFightingKnife && combat.attackerFigureKey && game.selectedMap?.id) {
    const adjHostiles = getFiguresAdjacentToTarget(game, combat.attackerFigureKey, game.selectedMap.id)
      .filter((c) => c.playerNum === defenderPlayerNum);
    if (adjHostiles.length > 0) {
      const targetsWithLabels = adjHostiles.map((c) => {
        const { msgId: mid, label } = getFigureLabel(game, c.playerNum, c.figureKey);
        return { figureKey: c.figureKey, playerNum: c.playerNum, label, msgId: mid };
      });
      game.pendingFightingKnife = {
        gameId: game.gameId,
        combatThreadId: combat.combatThreadId,
        attackerPlayerNum: combat.attackerPlayerNum,
        ownerId,
        targets: targetsWithLabels,
        resultText,
        combat,
        initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
      };
      const rows = getFightingKnifeTargetButtons(game.gameId, targetsWithLabels);
      await thread.send({
        content: `<@${ownerId}> **Fighting Knife** — Choose an adjacent hostile figure to roll 1 red die:`,
        allowedMentions: { users: [ownerId] },
        components: rows,
      }).catch(discordCatch);
      return true;
    }
  }
  // Concussive Bolt (4-LOM): after non-miss on SMALL target, push target 1 space (attacker picks direction)
  if (hit && combat.surgeConcussiveBolt && combat.target?.figureKey && game.selectedMap?.id) {
    const targetDcName = dcNameFromFigureKey(combat.target.figureKey);
    const targetSize = getFigureSize(targetDcName);
    if (targetSize === '1x1') {
      const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
      const ms = getMapSpaces(game.selectedMap.id);
      const adjSpaces = (ms?.adjacency?.[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase());
      if (adjSpaces.length > 0) {
        const { msgId: targetMsgId, label: targetLabel } = getFigureLabel(game, defenderPlayerNum, combat.target.figureKey, targetDcName);
        game.pendingConcussiveBolt = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          figureKey: combat.target.figureKey,
          figureLabel: String(targetLabel).slice(0, 80),
          currentPos: targetPos,
          adjSpaces,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const btns = adjSpaces.slice(0, 4).map((sp) =>
          new ButtonBuilder().setCustomId(`concussive_bolt_push_${game.gameId}_${sp}`).setLabel(sp.toUpperCase()).setStyle(ButtonStyle.Danger)
        );
        btns.push(new ButtonBuilder().setCustomId(`concussive_bolt_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${ownerId}> **Concussive Bolt** — Push **${targetLabel}** 1 space. Choose a destination:`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Spread the Pain (Dengar): after non-miss, apply each chosen HARMFUL condition to a figure on/adjacent to target
  if (hit && combat.spreadThePainConditions?.length > 0 && combat.target?.figureKey && game.selectedMap?.id) {
    const conditions = [...combat.spreadThePainConditions];
    const targetPos = game.figurePositions?.[defenderPlayerNum]?.[combat.target.figureKey];
    if (targetPos) {
      const ms = getMapSpaces(game.selectedMap.id);
      const adjacency = ms?.adjacency || {};
      const candSpaces = new Set([String(targetPos).toLowerCase(), ...(adjacency[String(targetPos).toLowerCase()] || []).map((s) => String(s).toLowerCase())]);
      const figuresAtSpaces = [];
      for (const p of [1, 2]) {
        for (const [figKey, figPos] of Object.entries(game.figurePositions?.[p] || {})) {
          if (candSpaces.has(String(figPos).toLowerCase())) {
            const { msgId: mid, label } = getFigureLabel(game, p, figKey, undefined, 70);
            figuresAtSpaces.push({ figureKey: figKey, playerNum: p, label, msgId: mid });
          }
        }
      }
      if (figuresAtSpaces.length > 0) {
        const firstCond = conditions[0];
        game.pendingSpreadThePain = {
          gameId: game.gameId,
          combatThreadId: combat.combatThreadId,
          attackerPlayerNum: combat.attackerPlayerNum,
          defenderPlayerNum,
          ownerId,
          conditions,
          conditionIdx: 0,
          resultText,
          combat,
          initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
        };
        const btns = figuresAtSpaces.slice(0, 4).map((f) =>
          new ButtonBuilder()
            .setCustomId(`spread_pain_fig_${game.gameId}_${f.figureKey}`)
            .setLabel(f.label)
            .setStyle(f.playerNum === defenderPlayerNum ? ButtonStyle.Danger : ButtonStyle.Secondary)
        );
        btns.push(new ButtonBuilder().setCustomId(`spread_pain_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${ownerId}> **Spread the Pain** — Apply **${firstCond}** to a figure at or adjacent to target (${String(targetPos).toUpperCase()}):`,
          allowedMentions: { users: [ownerId] },
          components: [new ActionRowBuilder().addComponents(btns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Post-attack reactions: check if defender has Payback, Dangerous Prey, or Right Back At Ya!
  const defenderHand = getCcHand(game, defenderPlayerNum) || [];
  const REACTION_CARDS = [
    { name: 'Payback', targetDcName: 'Dengar' },
    { name: 'Dangerous Prey', targetDcName: 'Bossk' },
    { name: "Right Back At Ya!", targetDcName: 'Boba Fett' },
  ];
  combat.promptedReactions = combat.promptedReactions || new Set();
  for (const { name, targetDcName } of REACTION_CARDS) {
    if (combat.promptedReactions.has(name)) continue;
    if (!defenderHand.includes(name)) continue;
    const targetFigKey = combat.target?.figureKey || '';
    if (!targetFigKey.startsWith(targetDcName + '-')) continue;
    // Prompt the defender for this reaction
    combat.promptedReactions.add(name);
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    // Tentatively remove from hand to prevent double-prompt; restored on skip
    const handKey = ccHandKey(defenderPlayerNum);
    const cardIdx = (game[handKey] || []).indexOf(name);
    if (cardIdx >= 0) game[handKey].splice(cardIdx, 1);
    game.pendingReaction = {
      gameId: game.gameId,
      combatThreadId: combat.combatThreadId,
      attackerPlayerNum: combat.attackerPlayerNum,
      defenderPlayerNum,
      ownerId: defOwnerId,
      cardName: name,
      targetDcName,
      targetFigKey,
      attackerFigKey: combat.attackerFigureKey,
      attackerMsgId: combat.attackerMsgId,
      resultText,
      combat,
      initialEmbedRefreshMsgIds: [...embedRefreshMsgIds],
    };
    const btnUse = new ButtonBuilder()
      .setCustomId(`reaction_use_${game.gameId}`)
      .setLabel(`React: ${name}`)
      .setStyle(ButtonStyle.Danger);
    const btnSkip = new ButtonBuilder()
      .setCustomId(`reaction_skip_${game.gameId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary);
    await thread.send({
      content: `<@${defOwnerId}> — You have **${name}** in hand! React to this attack?`,
      allowedMentions: { users: [defOwnerId] },
      components: [new ActionRowBuilder().addComponents(btnUse, btnSkip)],
    }).catch(discordCatch);
    return true;
  }
  // Agitate (Cam Droid): on hit, defender's group must activate next, if able
  if (hit && combat.surgeAgitate && combat.target?.figureKey) {
    const defenderDcName = dcNameFromFigureKey(combat.target.figureKey);
    game.agitateNextActivation = { playerNum: defenderPlayerNum, dcName: defenderDcName };
    const defLabel = combat.target.label || defenderDcName;
    await thread.send(`**Agitate** — **${defLabel}**'s group must be the next to activate this round, if able.`).catch(discordCatch);
  }
  // Fell Swoop (Davith Elso): after attack, become Hidden, gain 2 MP, free attack. Limit once per round.
  if (combat.surgeFellSwoop && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const fsKey = `${combat.attackerFigureKey}_fell_swoop`;
    if (!game.roundFigureAbilityUsed[fsKey]) {
      game.roundFigureAbilityUsed[fsKey] = true;
      _applyCondition(game, combat.attackerFigureKey, 'Hide');
      if (game.movementBank?.[combat.attackerMsgId]) {
        game.movementBank[combat.attackerMsgId].remaining += 2;
        game.movementBank[combat.attackerMsgId].total += 2;
        updateMovementBankMessage(game, combat.attackerMsgId, client).catch(() => {});
      }
      game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
      game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
      const attName = combat.attackerDisplayName || dcNameFromFigureKey(combat.attackerFigureKey);
      await thread.send(`**Fell Swoop** — **${attName}** becomes **Hidden** and gains **2 Movement Points**. Use Move in the DC thread, then click Attack for a free Fell Swoop attack (costs no action).`).catch(discordCatch);
    }
  }
  // Mastery (Second Sister): redraw a FORCE USER CC of cost ≤ 1 from discard. Limit once per round.
  if (combat.surgeMastery && combat.attackerFigureKey) {
    game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
    const mastKey = `${combat.attackerFigureKey}_mastery`;
    if (!game.roundFigureAbilityUsed[mastKey]) {
      game.roundFigureAbilityUsed[mastKey] = true;
      const mastPlayerNum = combat.attackerPlayerNum;
      const mastDiscardKey = ccDiscardKey(mastPlayerNum);
      const mastDiscard = game[mastDiscardKey] || [];
      const mastEligible = mastDiscard.filter((cardName) => {
        const entry = getCcEffect(cardName);
        return entry && (entry.cost ?? 99) <= 1 && String(entry.playableBy || '').toUpperCase().includes('FORCE USER');
      });
      if (mastEligible.length === 0) {
        await thread.send(`**Mastery** — No eligible FORCE USER Command cards (cost ≤ 1) in your discard pile.`).catch(discordCatch);
      } else {
        game.pendingMastery = { gameId: game.gameId, attackerPlayerNum: mastPlayerNum, discardKey: mastDiscardKey, eligible: mastEligible, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
        const mastOwnerId = getPlayerId(game, mastPlayerNum);
        const mastBtns = mastEligible.slice(0, 4).map((cardName, i) =>
          new ButtonBuilder().setCustomId(`mastery_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Primary)
        );
        mastBtns.push(new ButtonBuilder().setCustomId(`mastery_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        await thread.send({
          content: `<@${mastOwnerId}> **Mastery** — Choose a FORCE USER CC (cost ≤ 1) from your discard pile to return to hand:`,
          allowedMentions: { users: [mastOwnerId] },
          components: [new ActionRowBuilder().addComponents(mastBtns)],
        }).catch(discordCatch);
        return true;
      }
    }
  }
  // Interrogate (Agent Blaise): look at opponent's hand, choose a CC; may discard equal/greater cost to force discard.
  if (combat.surgeInterrogate) {
    const intAttackerPlayerNum = combat.attackerPlayerNum;
    const intOpponentPlayerNum = defenderPlayerNum;
    const intOpponentHandKey = ccHandKey(intOpponentPlayerNum);
    const intOpponentHand = game[intOpponentHandKey] || [];
    if (intOpponentHand.length === 0) {
      await thread.send(`**Interrogate** — Opponent's hand is empty; no card to choose.`).catch(discordCatch);
    } else {
      game.pendingInterrogate = { gameId: game.gameId, attackerPlayerNum: intAttackerPlayerNum, opponentPlayerNum: intOpponentPlayerNum, opponentHandSnapshot: [...intOpponentHand], chosenCardName: null, resultText, combat, initialEmbedRefreshMsgIds: [...embedRefreshMsgIds], defenderPlayerNum };
      const intOwnerId = getPlayerId(game, intAttackerPlayerNum);
      const intBtns = intOpponentHand.slice(0, 4).map((cardName, i) =>
        new ButtonBuilder().setCustomId(`interrogate_pick_${game.gameId}_${i}`).setLabel(cardName.slice(0, 80)).setStyle(ButtonStyle.Danger)
      );
      await thread.send({
        content: `<@${intOwnerId}> **Interrogate** — ⚠️ *Opponent: look away!* Pick the card you want to target:`,
        allowedMentions: { users: [intOwnerId] },
        components: [new ActionRowBuilder().addComponents(intBtns)],
      }).catch(discordCatch);
      return true;
    }
  }
  return false;
}

/** Send result to thread, clear combat/roll UI, refresh DC embeds and board. */
export async function finishCombatResolution(game, combat, resultText, embedRefreshMsgIds, client, ctx) {
  const {
    logGameAction, saveGames, dcHealthState, dcMessageMeta, dcExhaustedState,
    findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
    getDcUpgradeAttachments, buildBoardMapPayload, updateDcActionsMessage,
    ensureMovementBankMessage, updateMovementBankMessage,
    applyIndiscriminateFireSplash, getFigureLabel,
  } = ctx;
  const thread = await client.channels.fetch(combat.combatThreadId);
  await thread.send(resultText);
  // Hit and Run: add pending MP when attack resolves
  const pending = game.hitAndRunPendingMp;
  if (pending && pending.msgId === combat.attackerMsgId && pending.amount > 0) {
    const n = pending.amount;
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[pending.msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + n;
    bank.remaining = (bank.remaining ?? 0) + n;
    game.movementBank[pending.msgId] = bank;
    const ownerId = getPlayerId(game, combat.attackerPlayerNum);
    await logGameAction(game, client, `Hit and Run: <@${ownerId}> gained **${n}** movement point${n === 1 ? '' : 's'} after the attack.`, { allowedMentions: { users: [ownerId] }, phase: 'ACTION', icon: 'card' });
    await ensureMovementBankMessage(game, pending.msgId, client);
    delete game.hitAndRunPendingMp;
  }
  // --- Post-combat ability prompts (before clearing pendingCombat) ---
  const pcAttEff = getDcEffect(combat.attackerDcName);
  const pcAttIds = pcAttEff?.specialAbilityIds || [];
  const pcOwnerId = getPlayerId(game, combat.attackerPlayerNum);
  // Sidewinder (Jyn Odan): suffer 1 Strain to move 2 after attack (once/round)
  if (pcAttIds.includes('sidewinder') && combat.attackerMsgId != null) {
    const swKey = combat.attackerFigureKey + '_sidewinder';
    if (!game.roundFigureAbilityUsed?.[swKey]) {
      await thread.send({
        content: `<@${pcOwnerId}> **Sidewinder** — Suffer 1 Strain to move up to 2 spaces? (once per round)`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`sidewinder_apply_${game.gameId}_${combat.attackerMsgId}_${combat.attackerFigureIndex ?? 0}`).setLabel('Suffer 1 Strain → +2 MP').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`sidewinder_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary),
        )],
      }).catch(discordCatch);
    }
  }
  // Boltslinger (Vinto Hreeda): deal 1 Dmg to another hostile within 3 after attack
  if (pcAttIds.includes('boltslinger') && game.selectedMap?.id && combat.attackerFigureKey) {
    const blDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const atkPos = game.figurePositions?.[combat.attackerPlayerNum]?.[combat.attackerFigureKey];
    const defFigs = game.figurePositions?.[blDefPlayerNum] || {};
    const boltslingerTargets = [];
    for (const [fk, pos] of Object.entries(defFigs)) {
      if (fk === combat.target?.figureKey) continue;
      if (!isWithinN(atkPos, pos, 3, game.selectedMap.id)) continue;
      const { label: blLabel } = getFigureLabel(game, blDefPlayerNum, fk);
      boltslingerTargets.push({ figureKey: fk, playerNum: blDefPlayerNum, label: blLabel });
    }
    if (boltslingerTargets.length > 0) {
      game.pendingBoltslinger = { gameId: game.gameId, attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: boltslingerTargets };
      const btns = boltslingerTargets.slice(0, 4).map((t, i) =>
        new ButtonBuilder().setCustomId(`boltslinger_target_${game.gameId}_${i}`).setLabel(t.label).setStyle(ButtonStyle.Danger)
      );
      btns.push(new ButtonBuilder().setCustomId(`boltslinger_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
      await thread.send({
        content: `<@${pcOwnerId}> **Boltslinger** — Choose a hostile within 3 spaces to deal 1 Damage (verify LOS):`,
        allowedMentions: { users: [pcOwnerId] },
        components: [new ActionRowBuilder().addComponents(btns)],
      }).catch(discordCatch);
    }
  }
  // Indiscriminate Fire (Bossk): after attack, if not a miss, choose 1 non-red attack die;
  // each figure within 2 spaces of target (other than the defender) suffers Damage = Hits and Strain = Surges on that die.
  if (pcAttIds.includes('indiscriminate_fire') && !resultText.includes('**Miss**') && game.selectedMap?.id && combat.target?.figureKey) {
    const ifDefPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const targetPos = game.figurePositions?.[ifDefPlayerNum]?.[combat.target.figureKey];
    const rolledDice = combat.attackRoll?.dice || [];
    const nonRedDice = rolledDice.filter((d) => (d.color || '').toLowerCase() !== 'red');
    if (nonRedDice.length > 0 && targetPos) {
      const splashTargets = [];
      for (const pn of [1, 2]) {
        const figs = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(figs)) {
          if (fk === combat.target.figureKey) continue;
          if (!isWithinN(pos, targetPos, 2, game.selectedMap.id)) continue;
          const { label: lbl } = getFigureLabel(game, pn, fk);
          splashTargets.push({ figureKey: fk, playerNum: pn, label: lbl });
        }
      }
      if (nonRedDice.length === 1) {
        await applyIndiscriminateFireSplash(game, combat.attackerPlayerNum, combat.combatThreadId, nonRedDice[0], splashTargets, thread, {
          client, saveGames, dcMessageMeta, dcHealthState, dcExhaustedState,
          findDcMessageIdForFigure, buildDcEmbedAndFiles, getConditionsForDcMessage,
          getDcUpgradeAttachments, getDcEffects, logGameAction,
        });
      } else {
        game.pendingIndiscriminateFire = { attackerPlayerNum: combat.attackerPlayerNum, combatThreadId: combat.combatThreadId, targets: splashTargets, availableDice: nonRedDice };
        const ifBtns = nonRedDice.slice(0, 5).map((d, i) =>
          new ButtonBuilder().setCustomId(`indiscriminate_die_${game.gameId}_${i}`).setLabel(`${String(d.color).slice(0, 1).toUpperCase()}${String(d.color).slice(1)} (${d.dmg}dmg/${d.surge}↯)`).setStyle(ButtonStyle.Secondary)
        );
        ifBtns.push(new ButtonBuilder().setCustomId(`indiscriminate_skip_${game.gameId}`).setLabel('Skip').setStyle(ButtonStyle.Primary));
        await thread.send({
          content: `<@${pcOwnerId}> **Indiscriminate Fire** — Choose 1 non-red attack die for splash:`,
          allowedMentions: { users: [pcOwnerId] },
          components: [new ActionRowBuilder().addComponents(ifBtns)],
        }).catch(discordCatch);
      }
    }
  }

  // Missile Salvo: after each salvo attack, record target + show remaining die buttons
  if (combat.attackerMsgId && game.pendingMissileSalvo?.[combat.attackerMsgId]) {
    const ms = game.pendingMissileSalvo[combat.attackerMsgId];
    if (combat.target?.figureKey) ms.targetsFired = [...(ms.targetsFired || []), combat.target.figureKey];
    if (ms.diceAvailable?.length > 0) {
      const salvoOwnerId = getPlayerId(game, combat.attackerPlayerNum);
      const colorStyle = { blue: ButtonStyle.Primary, red: ButtonStyle.Danger, yellow: ButtonStyle.Secondary };
      const salvoBtns = ms.diceAvailable.map((c) =>
        new ButtonBuilder().setCustomId(`missile_salvo_die_${c}_${game.gameId}_${combat.attackerMsgId}`).setLabel(`${c.charAt(0).toUpperCase() + c.slice(1)} Die`).setStyle(colorStyle[c] || ButtonStyle.Secondary)
      );
      salvoBtns.push(new ButtonBuilder().setCustomId(`missile_salvo_done_${game.gameId}_${combat.attackerMsgId}`).setLabel('End Salvo').setStyle(ButtonStyle.Success));
      await thread.send({
        content: `<@${salvoOwnerId}> **Missile Salvo** — ${ms.diceAvailable.length} shot${ms.diceAvailable.length !== 1 ? 's' : ''} remaining. Choose a die for your next attack (different target):`,
        components: [new ActionRowBuilder().addComponents(salvoBtns)],
        allowedMentions: { users: [salvoOwnerId] },
      }).catch(discordCatch);
    } else {
      delete game.pendingMissileSalvo[combat.attackerMsgId];
      await thread.send('**Missile Salvo** — All shots fired. Salvo complete.').catch(discordCatch);
    }
  }

  // Auto-prompt for post-attack reaction cards (Counter Attack, Dangerous Prey, Payback, etc.)
  try {
    const _ccCardsAll = getCcEffectsData?.()?.cards || {};
    const _postAtkTimings = new Set([
      'afterAttackTargetingYouResolved',
      'afterAttack',
      'afterDamage',
      'afterHostileFigureSuffersDamage',
      'afterYouResolveAttackTargetingFigure',
    ]);
    // Defender: cards triggered by being attacked
    const _defPostPn = combat.defenderPlayerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
    const _defPostId = getPlayerId(game, _defPostPn);
    const _defPostHand = getCcHand(game, _defPostPn) || [];
    const _defPostCards = [...new Set(_defPostHand)].filter(c => _ccCardsAll[c]?.timing && _postAtkTimings.has(_ccCardsAll[c].timing));
    if (_defPostCards.length) {
      await thread.send({ content: `<@${_defPostId}> — Attack resolved! You have ${_defPostCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [_defPostId] } }).catch(() => {});
    }
    // Attacker: cards triggered by resolving an attack
    const _atkPostTimings = new Set(['afterAttack', 'afterYouResolveAttackTargetingFigure', 'afterYouResolveAttackThatDidNotMissDueToAccuracy']);
    const _atkPostId = getPlayerId(game, combat.attackerPlayerNum);
    const _atkPostHand = getCcHand(game, combat.attackerPlayerNum) || [];
    const _atkPostCards = [...new Set(_atkPostHand)].filter(c => _ccCardsAll[c]?.timing && _atkPostTimings.has(_ccCardsAll[c].timing));
    if (_atkPostCards.length) {
      await thread.send({ content: `<@${_atkPostId}> — Attack resolved! You have ${_atkPostCards.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [_atkPostId] } }).catch(() => {});
    }
  } catch (_postAtkErr) {
    console.error('Post-attack reaction prompt error:', _postAtkErr?.message ?? _postAtkErr);
  }

  delete game.pendingCombat;
  delete game.pendingCleave;
  if (combat.rollMessageId) {
    try {
      const rollMsg = await thread.messages.fetch(combat.rollMessageId);
      await rollMsg.edit({ components: [] }).catch(discordCatch);
    } catch {}
  }
  // Autofire chain attack: grant free attack restricted to within 3 of target
  if (combat.autofireChainPending && combat.attackerMsgId) {
    game.fellSwoopFreeAttack = game.fellSwoopFreeAttack || {};
    game.fellSwoopFreeAttack[combat.attackerMsgId] = true;
    if (combat.autofireChainTargetSpace) {
      game.autofireChainTargetSpace = game.autofireChainTargetSpace || {};
      game.autofireChainTargetSpace[combat.attackerMsgId] = combat.autofireChainTargetSpace;
    }
    await logGameAction(game, client, `**Autofire** — Chain attack available! Target must be within 3 of the original target space.`, { phase: 'ROUND', icon: 'attack' });
  }
  // The Darksaber: "then you may perform an attack" — grant second free attack
  if (game.darksaberSecondAttack?.[combat.attackerMsgId]) {
    delete game.darksaberSecondAttack[combat.attackerMsgId];
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[combat.attackerMsgId] = { from: 'Darksaber Strike' };
    // Clear the override so the second attack uses normal dice
    if (game.pendingOverrideAttackDice?.[combat.attackerMsgId]) delete game.pendingOverrideAttackDice[combat.attackerMsgId];
    await thread.send('**The Darksaber** — You may now perform a normal attack (use Attack button).').catch(() => {});
  }

  for (const msgId of embedRefreshMsgIds) {
    try {
      const meta = dcMessageMeta.get(msgId);
      if (meta) {
        const channelId = getPlayAreaId(game, meta.playerNum);
        const channel = await client.channels.fetch(channelId);
        const dcMsg = await channel.messages.fetch(msgId);
        const exhausted = dcExhaustedState.get(msgId) ?? false;
        const healthState = dcHealthState.get(msgId) || [];
        const { embed, files } = await buildDcEmbedAndFiles(meta.dcName, exhausted, meta.displayName, healthState, getConditionsForDcMessage(game, meta), getDcUpgradeAttachments(game, msgId));
        await dcMsg.edit({ embeds: [embed], files }).catch(discordCatch);
      }
    } catch (err) {
      console.error('Failed to update DC embed:', err);
    }
  }
  if (game.boardId && game.selectedMap) {
    try {
      const boardChannel = await client.channels.fetch(game.boardId);
      const payload = await buildBoardMapPayload(game.gameId, game.selectedMap, game);
      await boardChannel.send(payload);
    } catch (err) {
      console.error('Failed to update map after attack:', err);
    }
  }
  // Refresh activation thread minimap after combat (conditions/actions may have changed)
  if (combat.attackerMsgId) {
    await updateDcActionsMessage(game, combat.attackerMsgId, client).catch(discordCatch);
  }
}
