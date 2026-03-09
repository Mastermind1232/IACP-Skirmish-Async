/**
 * Combat handlers: attack_target_, combat_ready_, combat_roll_, combat_surge_, combat_resolve_ready_ (F10), cleave_target_ (F6)
 */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { COLORS } from '../discord/colors.js';
import { canActAsPlayer } from '../utils/can-act-as-player.js';
import { getMapSpaces, getCcEffectsData, getDcEffects as getDcEffectsGlobal, getDcKeywords as getDcKeywordsGlobal, getLoadoutCards, getFormCards } from '../data-loader.js';
import { getConfig } from '../game/figure-config.js';
import { isWithinSpaces as _isWithinSpaces, getRange as _getRange } from '../game/spatial.js';
import { reduceHp, healHp, awardKillVp, awardObjectiveVp, applyCondition, resetCondition } from '../game/index.js';
import {
  getPlayerId, getDcList, getDcMessageIds, getDcAttachments,
  getCcHand, getActivatedDcIndices,
  getActivationsRemaining, setActivationsRemaining,
  ccDiscardKey, ccAttachmentsKey, vpKey,
  opponentPlayerNum,
} from '../game/player-helpers.js';
import { discordCatch } from '../error-handling.js';
import { requireGame } from '../utils/guards.js';

/**
 * Check a player's hand for CC cards that match a timing trigger.
 * Returns an array of { cardName, timing, playableBy, cost } for cards that are playable.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string[]} timingTriggers - Timing values to match (e.g. ['whenAttackDeclaredOnYou'])
 * @returns {{ cardName: string, timing: string, playableBy: string, cost: number }[]}
 */
function getPlayableReactionCards(game, playerNum, timingTriggers) {
  const hand = getCcHand(game, playerNum) || [];
  if (!hand.length) return [];
  const ccData = getCcEffectsData()?.cards || {};
  const triggerSet = new Set(timingTriggers);
  const results = [];
  const seen = new Set();
  for (const cardName of hand) {
    if (seen.has(cardName)) continue;
    seen.add(cardName);
    const card = ccData[cardName];
    if (!card || !card.timing) continue;
    if (!triggerSet.has(card.timing)) continue;
    results.push({ cardName, timing: card.timing, playableBy: card.playableBy || 'Any Figure', cost: card.cost ?? 0 });
  }
  return results;
}

/**
 * Build a formatted notification for playable reaction cards.
 * @returns {string|null} - Message text or null if no cards are playable
 */
function buildReactionPrompt(cards, playerLabel) {
  if (!cards.length) return null;
  const cardList = cards.map(c => `**${c.cardName}** (cost ${c.cost})`).join(', ');
  return `${playerLabel} — you have reaction card(s) in hand: ${cardList}. Play from your Hand channel if desired.`;
}

/** F10: Send "Ready to resolve rolls" confirmation step in combat thread; caller should return after. */
export async function sendReadyToResolveRolls(thread, gameId) {
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
  // Flame Trooper Fireproof: cannot suffer Strain
  const _fpUpg = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  if (_fpUpg.includes('Flame Trooper')) {
    const dcName = figureKey.replace(/-\d+-\d+$/, '');
    await thread.send(`**Fireproof** — **${dcName}** is immune to Strain from ${abilityLabel}.`).catch(() => {});
    return;
  }
  const figMatch = figureKey.match(/-(\d+)-(\d+)$/);
  const figureIndex = figMatch ? parseInt(figMatch[2], 10) : 0;
  const dcName = figureKey.replace(/-\d+-\d+$/, '');
  const healthState = dcHealthState.get(msgId) || [];
  const entry = healthState[figureIndex];
  if (!entry) return;
  const [cur, max] = entry;

  // Headhunter: when a hostile figure suffers Strain during the Headhunter owner's activation
  let headhunterTriggered = false;
  let headhunterDmg = 0;
  const _hhOwnerNum = 3 - playerNum;
  const _hhOwnerMsgIds = getDcMessageIds(game, _hhOwnerNum) || [];
  const _hhOwnerAtts = getDcAttachments(game, _hhOwnerNum) || {};
  const _hhInActivation = _hhOwnerMsgIds.some(mid => game.dcActionsData?.[mid]?.threadId);
  if (_hhInActivation) {
    for (const _hhMid of _hhOwnerMsgIds) {
      const _hhAtts = _hhOwnerAtts[_hhMid] || [];
      const _hhExh = game.exhaustedSkirmishUpgrades?.[_hhMid] || [];
      if (_hhAtts.includes('Headhunter') && !_hhExh.includes('Headhunter')) {
        headhunterTriggered = true;
        amount = Math.max(0, amount - 1); // reduce Strain by 1
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[_hhMid] = [..._hhExh, 'Headhunter'];
        // Opponent discards random CC or figure suffers 1 Damage
        const oppHand = getCcHand(game, playerNum) || [];
        if (oppHand.length > 0) {
          const randIdx = Math.floor(Math.random() * oppHand.length);
          const discarded = oppHand.splice(randIdx, 1)[0];
          const discardKey = ccDiscardKey(playerNum);
          game[discardKey] = game[discardKey] || [];
          game[discardKey].push(discarded);
          await thread.send(`**Headhunter** — Strain reduced by 1. P${playerNum} discards **${discarded}** from hand.`).catch(() => {});
          if (logGameAction) await logGameAction(game, client, `**Headhunter** — Reduced Strain on **${dcName}**; P${playerNum} discards **${discarded}**.`, { phase: 'ROUND', icon: 'card' });
        } else {
          headhunterDmg = 1;
          await thread.send(`**Headhunter** — Strain reduced by 1, but P${playerNum} has no CCs. **${dcName}** suffers 1 Damage instead.`).catch(() => {});
          if (logGameAction) await logGameAction(game, client, `**Headhunter** — Reduced Strain on **${dcName}**; no CCs, dealt 1 Damage.`, { phase: 'ROUND', icon: 'card' });
        }
        break;
      }
    }
  }

  const totalHpLoss = amount + headhunterDmg;
  if (totalHpLoss <= 0 && headhunterTriggered) {
    // Headhunter fully prevented strain + opponent had CCs to discard
    return;
  }
  const { newHp: newCur, prevHp: _strainPrev } = reduceHp(dcHealthState, game, msgId, figureIndex, totalHpLoss, playerNum);
  if (!headhunterTriggered) {
    await thread.send(`**${abilityLabel}** (${sourceLabel}) — **${dcName}** suffers 1 Strain (${_strainPrev} → ${newCur} HP).`);
  } else {
    await thread.send(`**${abilityLabel}** — **${dcName}** suffers 1 Damage from Headhunter (${_strainPrev} → ${newCur} HP).`);
  }
  if (logGameAction) {
    await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** suffered 1 Strain.`, { phase: 'ROUND', icon: 'attack' });
  }
  if (newCur <= 0) {
    const attackerPlayerNum = opponentPlayerNum(playerNum);
    if (game.figurePositions?.[playerNum]) delete game.figurePositions[playerNum][figureKey];
    const stats = getDcStats?.(dcName);
    const effects = getDcEffects?.()?.[dcName];
    const figures = stats?.figures ?? 1;
    const vp = (figures > 1 && effects?.subCost != null) ? effects.subCost : (stats?.cost ?? 5);
    awardKillVp(game, attackerPlayerNum, vp);
    if (logGameAction) {
      await logGameAction(game, client, `⚡ **${abilityLabel}** — **${dcName}** was defeated! +${vp} VP`, { phase: 'ROUND', icon: 'attack' });
    }
    const dcIds = getDcMessageIds(game, playerNum);
    const idx = (dcIds || []).indexOf(msgId);
    if (idx >= 0 && isGroupDefeated?.(game, playerNum, idx)) {
      const activatedIndices = getActivatedDcIndices(game, playerNum) || [];
      if (!activatedIndices.includes(idx)) {
        setActivationsRemaining(game, playerNum, Math.max(0, (getActivationsRemaining(game, playerNum) ?? 0) - 1));
        if (updateActivationsMessage) await updateActivationsMessage(game, playerNum, client);
      }
      const ccAttachKey = ccAttachmentsKey(playerNum);
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
    await interaction.followUp({ content: 'Invalid button.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const [, msgId, figureIndexStr, targetIndexStr] = m;
  const figureIndex = parseInt(figureIndexStr, 10);
  const targetIndex = parseInt(targetIndexStr, 10);
  const meta = dcMessageMeta.get(msgId);
  if (!meta) {
    await interaction.followUp({ content: 'DC no longer tracked.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const game = await requireGame(interaction, getGame, meta.gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const targets = game.attackTargets?.[`${msgId}_${figureIndex}`];
  const target = targets?.[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = meta.playerNum;
  const { getRange, hasLineOfSight } = ctx;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) {
    await interaction.followUp({ content: 'Only the owner can attack.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (target.hasLOS === false) {
    await interaction.followUp({ content: '🚫 No line of sight to that target. You cannot attack through blocking terrain or solid walls.', ephemeral: true }).catch(discordCatch);
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
      await interaction.followUp({ content: '🚫 **Etiquette and Protocol**: these two figures cannot attack each other this round.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Still Faster Than You: free attack must target a different hostile than the activating one
  if (game.fellSwoopFreeAttack?.[msgId] && game.stillFasterExcludeMsgId && target.figureKey && !target.isNpc) {
    const excMeta = dcMessageMeta?.get(game.stillFasterExcludeMsgId);
    if (excMeta && target.figureKey.startsWith(`${excMeta.dcName}-`)) {
      await interaction.followUp({ content: '🚫 **Still Faster Than You** — must target a **different** hostile figure than the one that just activated.', ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Mandalorian Whip: forced attack target validation — must target the pushed figure
  if (game.forcedAttackTarget?.[msgId] && target.figureKey) {
    if (target.figureKey !== game.forcedAttackTarget[msgId]) {
      const forcedName = game.forcedAttackTarget[msgId].replace(/-\d+-\d+$/, '');
      await interaction.followUp({ content: `**Mandalorian Whip** — You must target the pushed figure (**${forcedName.replace(/_/g, ' ')}**).`, ephemeral: true }).catch(discordCatch);
      return;
    }
    delete game.forcedAttackTarget[msgId];
  }
  // Ballistics Matrix: clear per-attack flag after this attack proceeds
  if (game.nextAttackIgnoreFigureLOS?.[attackerPlayerNum]) delete game.nextAttackIgnoreFigureLOS[attackerPlayerNum];
  delete game.attackTargets[`${msgId}_${figureIndex}`];
  const actionsData = game.dcActionsData?.[msgId];
  if (actionsData) {
    const pendingBL = game.pendingBattlefieldLeadership;
    const isBLFreeAttack = pendingBL?.forMsgId === msgId;
    const isFellSwoopFreeAttack = !!game.fellSwoopFreeAttack?.[msgId];
    const isEmperorFreeAttack = game.pendingEmperorInterrupt?.forMsgId === msgId;
    const isExecOrderFreeAttack = game.pendingExecutiveOrder?.forMsgId === msgId;
    const isBombardmentFreeAttack = game.pendingBombardmentSorin?.forMsgId === msgId;
    const isFiringSquadFreeAttack = (game.pendingFiringSquad || []).some(p => p.forMsgId === msgId);
    const isCoordinatedRaidFreeAttack = game.pendingCoordinatedRaid?.forMsgId === msgId;
    if (isBLFreeAttack) {
      delete game.pendingBattlefieldLeadership;
    } else if (isFellSwoopFreeAttack) {
      delete game.fellSwoopFreeAttack[msgId];
      // Clear SFTY exclude once the free attack fires
      if (game.stillFasterExcludeMsgId) game.stillFasterExcludeMsgId = null;
    } else if (isEmperorFreeAttack) {
      delete game.pendingEmperorInterrupt;
    } else if (isExecOrderFreeAttack) {
      delete game.pendingExecutiveOrder;
    } else if (isBombardmentFreeAttack) {
      delete game.pendingBombardmentSorin;
    } else if (isFiringSquadFreeAttack) {
      game.pendingFiringSquad = (game.pendingFiringSquad || []).filter(p => p.forMsgId !== msgId);
      if (game.pendingFiringSquad.length === 0) delete game.pendingFiringSquad;
    } else if (isCoordinatedRaidFreeAttack) {
      delete game.pendingCoordinatedRaid;
    } else {
      actionsData.remaining = Math.max(0, actionsData.remaining - 1);
      await updateDcActionsMessage(game, msgId, interaction.client);
    }
  }

  const attackerStats = getDcStats(meta.dcName);
  let attackInfo = attackerStats.attack || { dice: ['red'], range: [1, 3] };

  // pendingOverrideAttackDice (Saber Strike, Bo-Rifle Staff Strike, Definition: 'Love'): replace dice/type/pierce for this attack
  const overrideDice = game.pendingOverrideAttackDice?.[msgId];
  const overrideDiceSource = overrideDice?.source; // capture before deletion for Heir to the Jedi check
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
    // Lightsaber Throw: must target non-adjacent figure
    if (overrideDice.mustTargetNonAdjacent && target.dist != null && target.dist <= 1) {
      await interaction.followUp({ content: '**Lightsaber Throw** requires targeting a non-adjacent figure. Choose a different target.', ephemeral: true }).catch(() => {});
      return;
    }
    // Tusken Cycler: no surge abilities during this attack — stored on pendingCombat
    if (overrideDice.blockSurgeAbilities) {
      game._pendingBlockSurgeAbilities = true;
    }
    delete game.pendingOverrideAttackDice[msgId];
  }
  // Close Quarters: override attack with adjacent hostile's dice/type, +1 Accuracy, -1 defense die
  if (game.closeQuartersActive?.[msgId]) {
    delete game.closeQuartersActive[msgId];
    const cqMapId = game.selectedMap?.id;
    if (cqMapId) {
      const cqActData = game.dcActionsData?.[msgId];
      const cqSelFig = cqActData?.selectedFigure ?? 0;
      const cqDgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const cqDgIdx = cqDgMatch ? cqDgMatch[1] : '1';
      const cqAttackerFk = `${meta.dcName}-${cqDgIdx}-${cqSelFig}`;
      const cqAttackerPos = game.figurePositions?.[meta.playerNum]?.[cqAttackerFk];
      if (cqAttackerPos) {
        const cqMapSpaces = getMapSpaces(cqMapId);
        const cqAdjSpaces = new Set(cqMapSpaces?.adjacency?.[cqAttackerPos] || []);
        const cqOppNum = opponentPlayerNum(meta.playerNum);
        const cqOppPositions = game.figurePositions?.[cqOppNum] || {};
        let cqHostileName = null;
        for (const [fk, pos] of Object.entries(cqOppPositions)) {
          if (pos && cqAdjSpaces.has(pos)) { cqHostileName = fk.replace(/-\d+-\d+$/, ''); break; }
        }
        if (cqHostileName) {
          const cqHostileStats = getDcStats(cqHostileName);
          const cqAttack = cqHostileStats?.attack;
          if (cqAttack?.dice) {
            attackInfo = { ...attackInfo, dice: cqAttack.dice };
            if (cqAttack.attackType?.toLowerCase() === 'melee') attackInfo = { ...attackInfo, range: [1, 1] };
            else if (cqAttack.attackType?.toLowerCase() === 'ranged') attackInfo = { ...attackInfo, range: [1, 99] };
            game._closeQuartersBonusAcc = 1;
            game._closeQuartersRemoveDefDie = true;
            await thread.send(`**Close Quarters** — Using **${cqHostileName}**'s attack pool [${cqAttack.dice.join(', ')}], +1 Accuracy, remove 1 defense die.`);
          }
        }
      }
    }
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
  // Mystic Hunter (Zuckuss): when you declare an attack, become Focused
  const _atkEff = getDcEffects()?.[meta.dcName];
  let _mysticHunterFired = false;
  if ((_atkEff?.passives || []).includes('Mystic Hunter')) {
    if (applyCondition(game, attackerFigureKey, 'Focus')) {
      attackInfo = { ...attackInfo, dice: [...(attackInfo.dice || []), 'green'] };
      _mysticHunterFired = true;
    }
  }
  // Fly-By (Jet Trooper Elite): if target within 2 spaces, add 1 blue die
  let _flyByFired = false;
  if ((_atkEff?.passives || []).includes('Fly-By') && target.dist != null && target.dist <= 2) {
    attackInfo = { ...attackInfo, dice: [...(attackInfo.dice || []), 'blue'] };
    _flyByFired = true;
  }
  // Utinni! (roundUtinniJawaBuffs): Jawa Scavenger gets +1 Accuracy and a VP-earning surge ability
  if (game.roundUtinniJawaBuffs && meta.dcName?.toLowerCase().includes('jawa scavenger')) {
    game.nextAttackBonusAccuracy = game.nextAttackBonusAccuracy || {};
    game.nextAttackBonusAccuracy[attackerPlayerNum] = (game.nextAttackBonusAccuracy[attackerPlayerNum] || 0) + 1;
    game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
    game.nextAttackBonusSurgeAbilities[attackerPlayerNum] = game.nextAttackBonusSurgeAbilities[attackerPlayerNum] || [];
    game.nextAttackBonusSurgeAbilities[attackerPlayerNum].push('utinni_vp_1');
  }
  // Merciless (HK Assassin Droid Elite): if defender has harmful conditions, 1 Damage
  if ((_atkEff?.passives || []).includes('Merciless')) {
    const _merDefConds = game.figureConditions?.[target.figureKey] || [];
    const _merHarmful = ['Bleed', 'Stun', 'Weaken'].some(c => _merDefConds.includes(c));
    if (_merHarmful) {
      const _merDefPn2 = opponentPlayerNum(attackerPlayerNum);
      const _merTargetMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, _merDefPn2, target.figureKey) : null;
      if (_merTargetMsgId && dcHealthState) {
        const _merFkMatch = target.figureKey.match(/-(\d+)-(\d+)$/);
        const _merFigIdx = _merFkMatch ? parseInt(_merFkMatch[2], 10) : 0;
        reduceHp(dcHealthState, game, _merTargetMsgId, _merFigIdx, 1, _merDefPn2);
      }
      await logGameAction(game, client, `⚡ **Merciless** — **${target.label}** suffers 1 Damage (has harmful condition).`, { phase: 'ROUND', icon: 'attack' });
    }
  }
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
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
  if (_mysticHunterFired) await thread.send(`🔮 **Mystic Hunter** — **${meta.dcName}** becomes **Focused** (+1 green die).`).catch(() => {});
  if (_flyByFired) await thread.send(`🚀 **Fly-By** — Target within 2 spaces: +1 blue die to attack pool.`).catch(() => {});
  const nextSurge = game.nextAttackBonusSurgeAbilities?.[attackerPlayerNum] || [];
  const nextPierce = (game.nextAttackBonusPierce?.[attackerPlayerNum] || 0) + (overrideDice?.pierce || 0);
  const nextBonusAcc = (game.nextAttackBonusAccuracy?.[attackerPlayerNum] || 0) + (overrideDice?.bonusAccuracy || 0) + (game._closeQuartersBonusAcc || 0);
  const [minRange, maxRange] = attackInfo.range || [1, 3];
  const isRanged = minRange >= 2 || maxRange >= 3;
  const distanceToTarget = target.dist ?? 1;
  game.pendingCombat = {
    gameId: game.gameId,
    attackerPlayerNum,
    defenderPlayerNum: opponentPlayerNum(attackerPlayerNum),
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
    blockSurgeAbilities: game._pendingBlockSurgeAbilities || false, // Tusken Cycler
    defensePoolRemoveMax: game._closeQuartersRemoveDefDie ? 1 : 0, // Close Quarters: remove 1 defense die
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
    darksaberBlastToCleave: overrideDice?.darksaberBlastToCleave || false,
  };
  // Imperial Loadout (Purge Trooper Elite): inject loadout surge abilities + store post-attack hook
  const _loadoutChoice = getConfig(game, attackerFigureKey)?.loadout;
  if (_loadoutChoice) {
    const _loadoutCard = getLoadoutCards()[_loadoutChoice];
    if (_loadoutCard?.surgeKeys) game.pendingCombat.bonusSurgeAbilities.push(..._loadoutCard.surgeKeys);
    if (_loadoutCard?.postAttack) game.pendingCombat.loadoutPostAttack = _loadoutCard.postAttack;
  }
  // Clawdite Form: inject form surge abilities, passives, and Rifleman dice replacement
  const _formChoice = getConfig(game, attackerFigureKey)?.form;
  if (_formChoice) {
    const _formCard = getFormCards()[_formChoice];
    if (_formCard?.surgeKeys) game.pendingCombat.bonusSurgeAbilities.push(..._formCard.surgeKeys);
    if (_formCard?.combatPassives) game.pendingCombat.formCombatPassives = _formCard.combatPassives;
    // Streetrat Assassin's Blade post-attack hook
    if (_formChoice === 'Streetrat') game.pendingCombat.formPostAttack = 'assassins_blade';
    // Scout Rifleman: replace 1 non-red die with 1 blue die
    if (_formChoice === 'Scout') {
      const dice = [...(game.pendingCombat.attackInfo.dice || [])];
      const replaceOrder = ['yellow', 'green']; // prefer replacing weaker dice
      let replaced = false;
      for (const color of replaceOrder) {
        const idx = dice.indexOf(color);
        if (idx !== -1) { dice[idx] = 'blue'; replaced = true; break; }
      }
      if (replaced) {
        game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice };
        await thread.send(`🎯 **Rifleman** — Replaced 1 attack die with 1 blue die.`).catch(discordCatch);
      }
    }
  }
  // Clean up temp flags after transferring to combat object
  if (game._pendingBlockSurgeAbilities) delete game._pendingBlockSurgeAbilities;
  if (game._closeQuartersBonusAcc) delete game._closeQuartersBonusAcc;
  if (game._closeQuartersRemoveDefDie) delete game._closeQuartersRemoveDefDie;
  // Apply printed passive stat bonuses from attacker only (NPC has no passives)
  // Merge form passives (e.g. "+2 Accuracy") and form combat passives (e.g. "Professional") with DC passives
  const attackerPassives = [...(getDcStats(meta.dcName).passives || [])];
  if (_formChoice) {
    const _fCard = getFormCards()[_formChoice];
    if (_fCard?.passives) attackerPassives.push(..._fCard.passives);
    if (_fCard?.combatPassives) attackerPassives.push(..._fCard.combatPassives);
  }
  const defenderPassives = target.isNpc ? [] : (getDcStats(targetDcName).passives || []);
  applyDcPassivesToCombat(game.pendingCombat, attackerPassives, defenderPassives);

  // --- Skirmish Upgrade attachment combat effects ---
  const _atkUpgrades = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
  const _defMsgId = target.isNpc ? null : (findDcMessageIdForFigure?.(game.gameId, game.pendingCombat.defenderPlayerNum, target.figureKey) || null);
  const _defUpgrades = _defMsgId ? (game.p1DcAttachments?.[_defMsgId] || game.p2DcAttachments?.[_defMsgId] || []) : [];
  if (_atkUpgrades.length || _defUpgrades.length) {
    const _pc = game.pendingCombat;
    // Targeting Computer (attachment): +1 atk reroll while attacking
    if (_atkUpgrades.includes('Targeting Computer')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Driven by Hatred (Darth Vader): +1 Hit, reroll 1 atk die (Brutality loss handled separately)
    if (_atkUpgrades.includes('Driven by Hatred')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Heir to the Jedi (Luke): reroll 1 atk die; +1 Hit on Ranged; Saber Strike Focus handled at declaration
    if (_atkUpgrades.includes('Heir to the Jedi')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
      if (isRanged) _pc.bonusHits = (_pc.bonusHits || 0) + 1;
    }
    // Rogue Smuggler (Han Solo): reroll 1 atk die (Distracting loss handled separately)
    if (_atkUpgrades.includes('Rogue Smuggler')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
    }
    // Wookiee Avenger (Chewbacca): +1 Hit while attacking
    if (_atkUpgrades.includes('Wookiee Avenger')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
    }
    // Prey on the Weak (HUNTER): Pierce 1 + Accuracy 1 vs lower-cost figure
    if (_atkUpgrades.includes('Prey on the Weak')) {
      const _potwAtkCost = getDcStats(meta.dcName)?.cost ?? 0;
      const _potwDefCost = _pc.targetStats?.cost ?? 99;
      if (_potwAtkCost > _potwDefCost) {
        _pc.bonusPierce = (_pc.bonusPierce || 0) + 1;
        _pc.bonusAccuracy = (_pc.bonusAccuracy || 0) + 1;
      }
    }
    // Explosive Armaments (HUNTER/DROID): Surge: +1 Damage, Blast 1
    if (_atkUpgrades.includes('Explosive Armaments')) {
      _pc.bonusSurgeAbilities.push('damage 1, blast 1');
    }
    // Feeding Frenzy (CREATURE): Surge: Recover 2 while attacking adjacent
    if (_atkUpgrades.includes('Feeding Frenzy') && distanceToTarget <= 1) {
      _pc.bonusSurgeAbilities.push('recover 2');
    }
    // Focused on the Kill (IG-88): lose Surge: Recover 3, gain Surge: Pierce 1; pre-attack Focus
    if (_atkUpgrades.includes('Focused on the Kill')) {
      _pc.removeSurgeKeys = (_pc.removeSurgeKeys || []).concat(['recover 3']);
      _pc.bonusSurgeAbilities.push('pierce 1');
      // Pre-attack Focus: apply Focus if not already Focused
      if (!attackerConds.includes('Focus')) {
        if (applyCondition(game, attackerFigureKey, 'Focus')) {
          _pc.attackInfo = { ..._pc.attackInfo, dice: [...(_pc.attackInfo.dice || []), 'green'] };
          await thread.send('**Focused on the Kill** — IG-88 becomes Focused before attacking.').catch(discordCatch);
        }
      }
    }
    // Heir to the Jedi: Saber Strike pre-attack Focus (when using Saber Strike override)
    if (_atkUpgrades.includes('Heir to the Jedi') && overrideDiceSource === 'saber_strike') {
      if (!attackerConds.includes('Focus')) {
        if (applyCondition(game, attackerFigureKey, 'Focus')) {
          _pc.attackInfo = { ..._pc.attackInfo, dice: [...(_pc.attackInfo.dice || []), 'green'] };
          await thread.send('**Heir to the Jedi** — Luke becomes Focused before Saber Strike.').catch(discordCatch);
        }
      }
    }
    // --- Defender attachments ---
    // Combat Suit: reduce Pierce value of attack results by 1 (min 0, handled in computeCombatResult)
    if (_defUpgrades.includes('Combat Suit')) {
      _pc.defenderReducePierce = (_pc.defenderReducePierce || 0) + 1;
    }
    // Wookiee Avenger (defending): convert Dodge → Evade (handled in computeCombatResult)
    if (_defUpgrades.includes('Wookiee Avenger')) {
      _pc.wookieeAvengerDefend = true;
    }
    // Cross Training (defending): replace 1 defense die with white die (handled in handleCombatRoll)
    if (_defUpgrades.includes('Cross Training')) {
      _pc.crossTrainingDefend = true;
    }
    // Rogue Smuggler (defender): lose Distracting — negate the passive if present
    if (_defUpgrades.includes('Rogue Smuggler')) {
      _pc.rougeSmuggler_loseDistracting = true;
    }
    // --- Exhaust-based attacker attachments (auto-applied, once per round) ---
    const _exh = game.exhaustedSkirmishUpgrades?.[msgId] || [];
    // Scavenged Weaponry: exhaust when declare attack → +1 Hit
    if (_atkUpgrades.includes('Scavenged Weaponry') && !_exh.includes('Scavenged Weaponry')) {
      _pc.bonusHits = (_pc.bonusHits || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [..._exh, 'Scavenged Weaponry'];
      await thread.send('**Scavenged Weaponry** — Exhausted: +1 Hit applied to this attack.').catch(discordCatch);
    }
    // Explosive Armaments: exhaust while attacking → Blast 1
    if (_atkUpgrades.includes('Explosive Armaments') && !_exh.includes('Explosive Armaments')) {
      _pc.bonusBlast = (_pc.bonusBlast || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'Explosive Armaments'];
      await thread.send('**Explosive Armaments** — Exhausted: Blast 1 applied to this attack.').catch(discordCatch);
    }
    // The Darksaber: exhaust while attacking → reroll 1 attack die
    if (_atkUpgrades.includes('The Darksaber') && !_exh.includes('The Darksaber')) {
      _pc.rerollOneAttackDie = (_pc.rerollOneAttackDie || 0) + 1;
      game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
      game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'The Darksaber'];
      await thread.send('**The Darksaber** — Exhausted: +1 attack reroll.').catch(discordCatch);
    }
    // Feeding Frenzy: exhaust while attacking a damaged figure → +1 Hit
    if (_atkUpgrades.includes('Feeding Frenzy') && !_exh.includes('Feeding Frenzy')) {
      const _ffDefHs = _defMsgId ? dcHealthState?.get(_defMsgId) : null;
      const _ffDefFi = target.figureKey ? parseInt((target.figureKey.match(/-(\d+)$/) || [])[1] || '0', 10) : 0;
      const _ffHp = _ffDefHs?.[_ffDefFi];
      if (_ffHp && _ffHp[0] < _ffHp[1]) {
        _pc.bonusHits = (_pc.bonusHits || 0) + 1;
        game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
        game.exhaustedSkirmishUpgrades[msgId] = [...(game.exhaustedSkirmishUpgrades[msgId] || []), 'Feeding Frenzy'];
        await thread.send('**Feeding Frenzy** — Exhausted: target has suffered damage, +1 Hit applied.').catch(discordCatch);
      }
    }
  }
  // Z-6 Trooper Rotary Cannon: before attacking, become Focused
  if (_atkUpgrades.includes('Z-6 Trooper')) {
    const _z6Pc = game.pendingCombat;
    if (!attackerConds.includes('Focus')) {
      if (applyCondition(game, attackerFigureKey, 'Focus')) {
        _z6Pc.attackInfo = { ..._z6Pc.attackInfo, dice: [...(_z6Pc.attackInfo.dice || []), 'green'] };
        await thread.send('**Rotary Cannon** — Z-6 Trooper becomes Focused before attacking.').catch(discordCatch);
      }
    }
  }
  // The General's Ranks: +1 Hit when attacking during a non-activation (not this group's activation)
  if (_atkUpgrades.includes("The General's Ranks")) {
    const _tgrActionsData = game.dcActionsData?.[msgId];
    if (!_tgrActionsData?.threadId) {
      // Not in this group's activation — non-activation attack
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
      await thread.send("**The General's Ranks** — +1 Hit (non-activation attack).").catch(discordCatch);
    }
  }
  // Scavenged Walker: -1 Hit penalty on end-of-round interrupt attack
  if (game.scavengedWalkerAttackPenalty?.[msgId]) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
    delete game.scavengedWalkerAttackPenalty[msgId];
    await thread.send('**Scavenged Walker** — -1 Hit applied to this interrupt attack.').catch(discordCatch);
  }
  // Flame Trooper Fireproof: this figure cannot suffer Strain (mark on combat object for handlers)
  if (_atkUpgrades.includes('Flame Trooper')) {
    game.pendingCombat.attackerFireproof = true;
  }
  if (_defUpgrades.includes('Flame Trooper')) {
    game.pendingCombat.defenderFireproof = true;
  }
  // Autofire: add chain attack surge ability + mark on combat
  if (game.autofireActive?.[msgId]) {
    game.pendingCombat.bonusSurgeAbilities.push('autofire_chain');
    game.pendingCombat.autofireAttack = true;
    delete game.autofireActive[msgId]; // consumed
  }
  // Fire Mission: +Blast 1
  if (game.fireMissionActive?.[msgId]) {
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + 1;
    game.pendingCombat.fireMissionAttack = true;
    delete game.fireMissionActive[msgId]; // consumed
    await thread.send('**Fire Mission** — +Blast 1 applied to this attack.').catch(() => {});
  }

  // Fury of Kashyyyk: elite WOOKIEE attacking within 2 + another friendly WOOKIEE within 2 of defender → Pierce 1
  {
    const _fokAtkDcList = getDcList(game, attackerPlayerNum) || [];
    if (_fokAtkDcList.some(dc => dc.dcName === '[Fury of Kashyyyk]')) {
      const _fokAtkKws = (getDcKeywordsGlobal()[meta.dcName] || []).map(k => String(k).toUpperCase());
      const _fokAtkEff = getDcEffectsGlobal()[meta.dcName];
      const _fokIsElite = meta.dcName?.includes('(Elite)') || _fokAtkEff?.elite === true;
      if (_fokAtkKws.includes('WOOKIEE') && _fokIsElite && distanceToTarget <= 2 && !target.isNpc) {
        const defPos = game.figurePositions?.[game.pendingCombat.defenderPlayerNum]?.[target.figureKey];
        if (defPos) {
          const friendlyPositions = game.figurePositions?.[attackerPlayerNum] || {};
          const hasFriendlyWookiee = Object.entries(friendlyPositions).some(([fk, pos]) => {
            if (!pos || fk === attackerFigureKey) return false;
            const fkDcName = fk.replace(/-\d+-\d+$/, '');
            const fkKws = (getDcKeywordsGlobal()[fkDcName] || []).map(k => String(k).toUpperCase());
            return fkKws.includes('WOOKIEE') && _getRange(pos, defPos) <= 2;
          });
          if (hasFriendlyWookiee) {
            game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 1;
            await thread.send('**Fury of Kashyyyk** — Another friendly WOOKIEE within 2 spaces of defender: Pierce 1 applied.').catch(discordCatch);
          }
        }
      }
    }
  }

  // Payback (Dengar CC reaction): if attacker has a pending Payback surge bonus, apply it now
  const paybackBonus = game.paybackBonusSurge?.[msgId];
  if (paybackBonus) {
    game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + paybackBonus;
    delete game.paybackBonusSurge[msgId];
    await thread.send(`**Payback** — +${paybackBonus} Surge applied to this counter-attack.`).catch(discordCatch);
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
    await thread.send('⚠️ **No Cheating** is active — 1 attack die removed.').catch(discordCatch);
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
    resetCondition(game, attackerFigureKey, 'Focus');
    const bm_label = meta.dcName === 'BT-1' ? 'Assassin' : 'Battle Meditation';
    await thread.send(`**${bm_label}** — **${meta.dcName}** is **Focused** before attacking (+1 green die).`);
  }

  // Full of Rage (Krrsantan): auto-Focus if 3+ damage suffered
  if (atkSpecialIds.includes('full_of_rage') && !game.pendingCombat.attackerConds.includes('Focus') &&
      !(game.figureConditions?.[attackerFigureKey] || []).includes('Focus') && atkDamageSuffered >= 3) {
    game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
    resetCondition(game, attackerFigureKey, 'Focus');
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
      // Rogue Smuggler: "You lose Distracting" — skip if this figure's DC has the attachment
      const _distMsgId = findDcMessageIdForFigure?.(game.gameId, defenderPlayerNum, fk);
      const _distUpg = _distMsgId ? (game.p1DcAttachments?.[_distMsgId] || game.p2DcAttachments?.[_distMsgId] || []) : [];
      if (_distUpg.includes('Rogue Smuggler')) continue;
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

  // On a Diplomatic Mission: +1 Evade on defense for rest of round
  if (_defMsgId && game.diplomaticMissionEvade?.[_defMsgId]) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) + 1;
    await thread.send("**On a Diplomatic Mission** — +1 Evade on defense (rest of round).");
  }

  // Relentless (Trandoshan Hunter, IG-88, Fifth Brother): 1 Strain to target within 3
  const relentlessIds = ['relentless_trandoshan_elite', 'relentless_trandoshan_reg', 'relentless_ig88', 'fifth_brother_relentless'];
  if (atkSpecialIds.some(id => relentlessIds.includes(id)) && distanceToTarget <= 3) {
    await applyStrainToFigure(game, defenderPlayerNum, target.figureKey, 1, 'Relentless', meta.dcName, ctx, thread);
  }

  // Advanced Targeting Computer (Dark Trooper Mk III): auto-Focus on declare
  if (atkSpecialIds.includes('adv_targeting_computer_dark_trooper')) {
    if (!attackerConds.includes('Focus') && !(game.figureConditions?.[attackerFigureKey] || []).includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      resetCondition(game, attackerFigureKey, 'Focus');
      await thread.send('**Advanced Targeting Computer** — Dark Trooper Mk III is **Focused** before attacking (+1 green die).');
    }
    // Focus already applied — still grant the green die from Focus condition (handled above at line ~286)
  }

  // Flawless Execution (Cad Bane): become Focused; if already Focused → Wild token + yellow die
  if (atkSpecialIds.includes('flawless_execution')) {
    if (!attackerConds.includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      resetCondition(game, attackerFigureKey, 'Focus');
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

  // Sharpshooter (Fennec Shand): auto-Focus if target is 5+ spaces away
  if (atkSpecialIds.includes('sharpshooter') && distanceToTarget >= 5) {
    if (!attackerConds.includes('Focus') && !(game.figureConditions?.[attackerFigureKey] || []).includes('Focus')) {
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: [...(game.pendingCombat.attackInfo.dice || []), 'green'] };
      resetCondition(game, attackerFigureKey, 'Focus');
      await thread.send(`**Sharpshooter** — **${meta.dcName}** is **Focused** (target ${distanceToTarget} spaces away, +1 green die).`);
    }
  }

  // Find Weakness (Scout Trooper Elite): -1 Evade to defense results (accuracy handled via passives)
  if (atkSpecialIds.includes('find_weakness')) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) - 1;
    await thread.send('**Find Weakness** — −1 Evade applied to defense results.');
  }

  // Exploit Weakness (Scout Trooper Elite): +1 Surge if defender has a harmful condition
  if (atkSpecialIds.includes('exploit_weakness')) {
    const harmfulConds = ['Bleed', 'Stun', 'Weaken'];
    const defConds = game.figureConditions?.[target.figureKey] || [];
    if (defConds.some(c => harmfulConds.includes(c))) {
      game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + 1;
      await thread.send('**Exploit Weakness** — defender has a harmful condition, +1 Surge.');
    }
  }

  // Conclusion (HK-47): -1 Evade to defense results while attacking
  if (atkSpecialIds.includes('conclusion')) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) - 1;
    await thread.send('**Conclusion** — −1 Evade applied to defense results.');
  }

  // Query (HK-47): +1 Hit unless defender becomes Bleeding
  if (atkSpecialIds.includes('query_hk47')) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
    await thread.send('**Query** — +1 Hit applied. (Note: if defender becomes Bleeding, this +1 Hit should not apply — honor system.)');
  }

  // Disposable (Hired Gun Regular): -1 Evade to own defense results
  if (defSpecialIds.includes('disposable')) {
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) - 1;
    await thread.send('**Disposable** — −1 Evade applied to defender\'s defense results.');
  }

  // Front Line (Echo Base Trooper): within 3 spaces, replace 1 blue die with red
  if (atkSpecialIds.includes('front_line') && distanceToTarget <= 3) {
    const dice = game.pendingCombat.attackInfo.dice || [];
    const blueIdx = dice.findIndex(d => d === 'blue');
    if (blueIdx >= 0) {
      const newDice = [...dice];
      newDice[blueIdx] = 'red';
      game.pendingCombat.attackInfo = { ...game.pendingCombat.attackInfo, dice: newDice };
      await thread.send(`**Front Line** — 1 blue die replaced with red (target within ${distanceToTarget} spaces).`);
    }
  }

  // Cortosis Weave (Echo Base Trooper Elite): reduce Pierce by 2
  if (defSpecialIds.includes('cortosis_weave')) {
    game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) - 2;
    await thread.send('**Cortosis Weave** — Pierce reduced by 2 (min 0).');
  }

  // Gamorrean Honor Guard: +1 Block while defending during Ranged attack
  if (defSpecialIds.includes('gamorrean_honor_guard') && isRanged) {
    game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
    await thread.send('**Gamorrean Honor Guard** — +1 Block (defending against Ranged attack).');
  }

  // Composite Plating (Heavy Stormtrooper Regular): +1 Block if attacker 4+ spaces away
  if (defSpecialIds.includes('composite_plating') && distanceToTarget >= 4) {
    game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
    await thread.send(`**Composite Plating** — +1 Block (attacker ${distanceToTarget} spaces away).`);
  }

  // Sniper (Alliance Ranger Regular): forced +1 reroll at 5+ spaces (no "may")
  if (atkSpecialIds.includes('sniper') && distanceToTarget >= 5) {
    game.pendingCombat.rerollOneAttackDie = (game.pendingCombat.rerollOneAttackDie || 0) + 1;
    await thread.send(`**Sniper** — +1 attack reroll (target ${distanceToTarget} spaces away).`);
  }

  // Elite Sniper (Alliance Ranger Elite): +2 reroll at 5+ spaces
  if (atkSpecialIds.includes('elite_sniper') && distanceToTarget >= 5) {
    game.pendingCombat.rerollOneAttackDie = (game.pendingCombat.rerollOneAttackDie || 0) + 2;
    await thread.send(`**Elite Sniper** — +2 attack rerolls (target ${distanceToTarget} spaces away).`);
  }

  // Much to Learn (Ezra Bridger): +1 reroll if friendly unique within 3 spaces
  if (atkSpecialIds.includes('much_to_learn') && getRange && mapSpaces) {
    const atkPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    if (atkPos) {
      const friendlyPos = game.figurePositions?.[attackerPlayerNum] || {};
      for (const [fk, pos] of Object.entries(friendlyPos)) {
        if (fk === attackerFigureKey) continue;
        const fkDcName = fk.replace(/-\d+-\d+$/, '');
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!fkEff?.unique) continue;
        if (getRange(atkPos, pos) > 3) continue;
        game.pendingCombat.rerollOneAttackDie = (game.pendingCombat.rerollOneAttackDie || 0) + 1;
        const isFU = (fkEff?.keywords || []).map(k => String(k).toUpperCase()).includes('FORCE USER');
        const note = isFU ? ' (FORCE USER nearby — may turn die to any side instead)' : '';
        await thread.send(`**Much to Learn** — ${fkDcName} is within 3 spaces, +1 attack reroll${note}.`);
        break;
      }
    }
  }

  // Forest Fighters (Ewok Warrior Elite): +1 Hit during melee attack if Hidden
  if (atkSpecialIds.includes('forest_fighters') && !isRanged) {
    const atkConds = game.figureConditions?.[attackerFigureKey] || [];
    if (atkConds.includes('Hide')) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
      await thread.send('**Forest Fighters** — +1 Hit (Hidden, Melee attack).');
    }
  }

  // Sentinel / Protector: scan defender's friendlies for adjacent-to-target, +1 Block. Limit 1 per attack.
  if (mapSpaces && targetCoord && !target.isNpc) {
    const adjToTargetSP = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    adjToTargetSP.add(targetCoord);
    const defFigPos = game.figurePositions?.[defenderPlayerNum] || {};
    const defenderKws = (defEff?.keywords || []).map(k => String(k).toUpperCase());
    const defenderIsGuardian = defenderKws.includes('GUARDIAN');
    let sentinelApplied = false;
    for (const [fk, pos] of Object.entries(defFigPos)) {
      if (sentinelApplied) break;
      if (fk === target.figureKey) continue; // skip the defender itself
      const fkDcName = fk.replace(/-\d+-\d+$/, '');
      const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      const fkAbilityIds = fkEff?.specialAbilityIds || [];
      if (!adjToTargetSP.has(String(pos).toLowerCase())) continue;
      // Sentinel: only defends non-GUARDIAN figures
      if (fkAbilityIds.includes('sentinel') && !defenderIsGuardian) {
        game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
        await thread.send(`**Sentinel** (${fkDcName}) — adjacent to target space, +1 Block for defender.`);
        sentinelApplied = true;
      }
      // Protector (Chewbacca): works for ALL friendly defenders (no GUARDIAN restriction)
      if (!sentinelApplied && fkAbilityIds.includes('protector')) {
        game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
        await thread.send(`**Protector** (${fkDcName}) — adjacent to target space, +1 Block for defender.`);
        sentinelApplied = true;
      }
    }
  }

  // Keep the Peace Elite (Wing Guard Elite): attacker suffers 1 Strain when attacking space adjacent to you
  // Limit 1 per group activation — track per activation via roundFigureAbilityUsed
  if (mapSpaces && targetCoord && !target.isNpc) {
    const adjToTargetKP = new Set((mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase()));
    const defFigPosKP = game.figurePositions?.[defenderPlayerNum] || {};
    let ktpApplied = false;
    for (const [fk, pos] of Object.entries(defFigPosKP)) {
      if (ktpApplied) break;
      const fkDcName = fk.replace(/-\d+-\d+$/, '');
      const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
      const fkAbilityIds = fkEff?.specialAbilityIds || [];
      if (!adjToTargetKP.has(String(pos).toLowerCase())) continue;
      // Elite: automatic, limit 1 per group activation
      if (fkAbilityIds.includes('keep_the_peace_elite')) {
        const ktpKey = `${fkDcName}_ktp_${game.currentRound || 0}`;
        if (!game.roundFigureAbilityUsed?.[ktpKey]) {
          if (!game.roundFigureAbilityUsed) game.roundFigureAbilityUsed = {};
          game.roundFigureAbilityUsed[ktpKey] = true;
          await applyStrainToFigure(game, attackerPlayerNum, attackerFigureKey, 1, 'Keep the Peace', fkDcName, ctx, thread);
          ktpApplied = true;
        }
      }
      // Regular: optional — remind defender they may spend 1 Strain to deal 1 Strain to attacker
      if (!ktpApplied && fkAbilityIds.includes('keep_the_peace_regular')) {
        // Check: target space must not contain a friendly GUARDIAN
        const targetFigKws = (defEff?.keywords || []).map(k => String(k).toUpperCase());
        if (!targetFigKws.includes('GUARDIAN')) {
          await thread.send(`**Keep the Peace** reminder — **${fkDcName}** is adjacent to the target space. Defender may suffer 1 Strain to make the attacker suffer 1 Strain.`);
          ktpApplied = true;
        }
      }
    }
  }

  // Bespin Security (Wing Guard Elite): adjacent friendly LEADER or SCUM TROOPER attacker gets +1 reroll
  if (mapSpaces) {
    const atkPos = game.figurePositions?.[attackerPlayerNum]?.[attackerFigureKey];
    const atkKws = (atkEff?.keywords || []).map(k => String(k).toUpperCase());
    const isLeaderOrScumTrooper = atkKws.includes('LEADER') || (atkKws.includes('TROOPER') && atkEff?.affiliation === 'Scum');
    if (isLeaderOrScumTrooper && atkPos) {
      const adjToAtk = new Set((mapSpaces.adjacency?.[String(atkPos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
      const friendlyPos = game.figurePositions?.[attackerPlayerNum] || {};
      let bespinApplied = false;
      for (const [fk, pos] of Object.entries(friendlyPos)) {
        if (bespinApplied) break;
        if (fk === attackerFigureKey) continue;
        if (!adjToAtk.has(String(pos).toLowerCase())) continue;
        const fkDcName = fk.replace(/-\d+-\d+$/, '');
        const fkEff = getDcEffectsGlobal()[fkDcName] || getDcEffectsGlobal()[fkDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if ((fkEff?.specialAbilityIds || []).includes('bespin_security')) {
          game.pendingCombat.rerollOneAttackDie = (game.pendingCombat.rerollOneAttackDie || 0) + 1;
          await thread.send(`**Bespin Security** (${fkDcName}) — adjacent to attacker, +1 attack reroll.`);
          bespinApplied = true;
        }
      }
    }
  }

  // Awkward (AT-ST): cannot attack adjacent figures
  if (atkSpecialIds.includes('awkward_atst') && distanceToTarget <= 1) {
    await thread.send('**Awkward** — Cannot attack adjacent figures. Attack cancelled.');
    delete game.pendingCombat;
    saveGames();
    return;
  }

  // Camouflage (Mak, Scout Trooper Elite): hostile figures 4+ spaces away cannot draw LOS
  const camouflageIds = ['camouflage_mak', 'camouflage_scout_trooper'];
  if (defSpecialIds.some(id => camouflageIds.includes(id)) && isRanged && distanceToTarget >= 4) {
    const camName = defSpecialIds.includes('camouflage_mak') ? 'Mak' : 'Scout Trooper';
    await thread.send(`**Camouflage** (${camName}) — Hostile figures 4+ spaces away cannot target this figure. Attack cancelled.`);
    delete game.pendingCombat;
    saveGames();
    return;
  }

  // Slippery (Alliance Smuggler E/R): while defending, apply -2 Accuracy
  const slipperyIds = ['slippery_smuggler_elite', 'slippery_smuggler_reg'];
  if (defSpecialIds.some(id => slipperyIds.includes(id))) {
    game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) - 2;
    await thread.send('**Slippery** — Defender applies -2 Accuracy to the attack.');
  }

  // Take Cover (Jawa Scavenger E/R): while defending, +1 Block and -1 Evade
  const takeCoverIds = ['take_cover_jawa_elite', 'take_cover_jawa_reg'];
  if (defSpecialIds.some(id => takeCoverIds.includes(id))) {
    game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
    game.pendingCombat.bonusEvade = (game.pendingCombat.bonusEvade || 0) - 1;
    await thread.send('**Take Cover** — Defender applies +1 Block, -1 Evade.');
  }

  // Aim (Rebel Trooper E/R): +1 Hit, +2 Accuracy if figure has not moved this activation
  const aimIds = ['aim_rebel_trooper_elite', 'aim_rebel_trooper_reg'];
  if (atkSpecialIds.some(id => aimIds.includes(id))) {
    if (!game.figureMoved?.[attackerFigureKey]) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + 1;
      game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
      await thread.send('**Aim** — Has not moved this activation: +1 Hit, +2 Accuracy.');
    }
  }

  // Dead Precise (Ko-Tun Feralo): +2 Accuracy if didn't move this activation
  if (atkSpecialIds.includes('dead_precise_kotun')) {
    if (!game.figureMoved?.[attackerFigureKey]) {
      game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) + 2;
      await thread.send('**Dead Precise** — Has not moved this activation: +2 Accuracy.');
    }
  }

  // Spray Fire (Heavy Stormtrooper Elite): -3 Accuracy, +1 Surge (always beneficial at melee range)
  if (atkSpecialIds.includes('spray_fire_heavy_stormtrooper')) {
    game.pendingCombat.bonusAccuracy = (game.pendingCombat.bonusAccuracy || 0) - 3;
    game.pendingCombat.surgeBonus = (game.pendingCombat.surgeBonus || 0) + 1;
    await thread.send('**Spray Fire** — -3 Accuracy, +1 Surge applied.');
  }

  // Improvised Cover (Verena Talos): +1 Block if adjacent to object or non-friendly, non-attacker figure
  if (defSpecialIds.includes('improvised_cover_verena') && mapSpaces && targetCoord) {
    const adjToDefIC = (mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase());
    // Check for adjacent hostile/neutral figures (attacker's figures that aren't the attacker)
    const atkFigPosIC = game.figurePositions?.[attackerPlayerNum] || {};
    let icFound = false;
    for (const [fk, pos] of Object.entries(atkFigPosIC)) {
      if (fk === attackerFigureKey) continue;
      if (adjToDefIC.includes(String(pos).toLowerCase())) { icFound = true; break; }
    }
    if (icFound) {
      game.pendingCombat.bonusBlock = (game.pendingCombat.bonusBlock || 0) + 1;
      await thread.send('**Improvised Cover** — Adjacent to non-friendly figure (not attacker): +1 Block.');
    }
  }

  // Tripod (E-Web E/R): if figure has moved this activation, cannot attack
  if (atkSpecialIds.includes('tripod_eweb') && game.figureMoved?.[attackerFigureKey]) {
    await thread.send('**Tripod** — Has exited space this activation. Cannot attack.');
    delete game.pendingCombat;
    saveGames();
    return;
  }

  // Log override dice if active (Saber Strike, Bo-Rifle Staff Strike)
  if (overrideDice?.dice) {
    const diceStr = overrideDice.dice.join(', ');
    const typeStr = overrideDice.type === 'melee' ? ' (Melee)' : '';
    const pierceStr = overrideDice.pierce > 0 ? `, Pierce ${overrideDice.pierce}` : '';
    await thread.send(`**Override dice** — Attack uses [${diceStr}]${typeStr}${pierceStr}.`);
  }
  // Apply bonusHits from overrideDice (e.g. Overheated: -1 Hit, Flurry of Blows: +1 Hit)
  if (overrideDice?.bonusHits) {
    game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) + overrideDice.bonusHits;
    if (overrideDice.bonusHits < 0) {
      await thread.send(`**Overheated** — −${Math.abs(overrideDice.bonusHits)} Hit applied automatically.`).catch(discordCatch);
    } else if (overrideDice.bonusHits > 0) {
      await thread.send(`**+${overrideDice.bonusHits} Hit** applied to attack results.`).catch(discordCatch);
    }
  }
  // Optimal Bombardment: apply +Blast bonus if this figure was granted one
  if (game.optimalBombardmentBlastBonus?.[msgId]) {
    const _obBlast = game.optimalBombardmentBlastBonus[msgId];
    game.pendingCombat.bonusBlast = (game.pendingCombat.bonusBlast || 0) + _obBlast;
    await thread.send(`**Optimal Bombardment** — +${_obBlast} Blast added to this attack.`).catch(discordCatch);
    delete game.optimalBombardmentBlastBonus[msgId];
  }

  // The Force is With Me (Chirrut): ranged attack targeting Chirrut — choose adjacent hostile; -1 Hit + 1 dmg to chosen
  if (isRanged && defSpecialIds.includes('the_force_is_with_me_chirrut') && mapSpaces && targetCoord) {
    const adjToChirrut = (mapSpaces.adjacency?.[targetCoord] || []).map(s => String(s).toLowerCase());
    const atkFigPos = game.figurePositions?.[attackerPlayerNum] || {};
    let _tfiwmTarget = null;
    for (const [fk, pos] of Object.entries(atkFigPos)) {
      if (adjToChirrut.includes(String(pos).toLowerCase())) {
        _tfiwmTarget = fk;
        break;
      }
    }
    if (_tfiwmTarget) {
      game.pendingCombat.bonusHits = (game.pendingCombat.bonusHits || 0) - 1;
      const _tfiwmDcName = _tfiwmTarget.replace(/-\d+-\d+$/, '');
      // Deal 1 damage to the adjacent hostile
      const _tfiwmMatch = _tfiwmTarget.match(/^(.+)-(\d+)-(\d+)$/);
      if (_tfiwmMatch) {
        const [, _tfDcN, _tfDgI, _tfFiStr] = _tfiwmMatch;
        const _tfMsgIds = getDcMessageIds(game, attackerPlayerNum) || [];
        const _tfDcList = getDcList(game, attackerPlayerNum) || [];
        const _tfDcHs = ctx.dcHealthState;
        if (_tfDcHs) {
          let _tfMsgId = null;
          for (let i = 0; i < _tfMsgIds.length; i++) {
            if (_tfDcList[i]?.dcName === _tfDcN) { _tfMsgId = _tfMsgIds[i]; break; }
          }
          if (_tfMsgId) {
            const _tfHs = _tfDcHs.get(_tfMsgId);
            const _tfFi = parseInt(_tfFiStr, 10);
            if (_tfHs?.[_tfFi]) {
              const [_tfCur, _tfMax] = _tfHs[_tfFi];
              if (_tfCur > 0) {
                const _tfNew = Math.max(0, _tfCur - 1);
                _tfHs[_tfFi] = [_tfNew, _tfMax];
                _tfDcHs.set(_tfMsgId, _tfHs);
                const _tfIdx = _tfMsgIds.indexOf(_tfMsgId);
                if (_tfIdx >= 0 && _tfDcList[_tfIdx]) _tfDcList[_tfIdx].healthState = [..._tfHs];
              }
            }
          }
        }
      }
      await thread.send(`**The Force is With Me** — Ranged attack targeting Chirrut. Adjacent hostile **${_tfiwmDcName}** suffers 1 Damage. -1 Hit applied to attack.`);
    }
  }

  // Loku Recon Token: Set Your Sights — Pierce 2 when attacking figure with recon token
  if (game.reconToken?.figureKey === targetFigureKey && game.reconToken?.playerNum === attackerPlayerNum) {
    game.pendingCombat.bonusPierce = (game.pendingCombat.bonusPierce || 0) + 2;
    await thread.send('**Set Your Sights** — Attacking figure with Recon token: +Pierce 2.');
  }
  // Loku Recon Token: Mon Cala SF — Loku becomes Focused when attacking recon-tokened figure
  if (game.reconToken?.figureKey === targetFigureKey && game.reconToken?.playerNum === attackerPlayerNum) {
    if (atkSpecialIds.includes('mon_cala_sf_loku')) {
      applyCondition(game, attackerFigureKey, 'Focus');
      await thread.send('**Mon Cala Special Forces** — Loku gains Focus for attacking Recon-tokened figure.');
    }
  }

  // Strike Me Down (Obi-Wan): when attack targeting Obi-Wan is declared, may reduce VP cost by 3 and be defeated
  // Auto-notify in thread; Obi-Wan's player must decide (handled as honor-system with log notification)
  if (defSpecialIds.includes('strike_me_down_obiwan')) {
    await thread.send('⚠️ **Strike Me Down** — Obi-Wan may choose to reduce his figure cost by 3 and be defeated (ending this attack). This is an honor-system choice — notify your opponent if you choose to activate it.');
  }

  // Slow on the Draw (Greedo): when Greedo declares an attack, defender may interrupt to attack Greedo first
  if (atkSpecialIds.includes('slow_on_the_draw_greedo')) {
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    await thread.send({ content: `⚠️ **Slow on the Draw** — <@${defOwnerId}>, you may interrupt to perform an attack targeting **Greedo** before this attack resolves. This is an honor-system choice — use your DC's attack action to target Greedo if desired.`, allowedMentions: { users: [defOwnerId] } });
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
  }).catch(discordCatch);

  // Auto-prompt defender for playable reaction cards (whenAttackDeclaredOnYou, etc.)
  try {
    const defReactions = getPlayableReactionCards(game, defenderPlayerNum, [
      'whenAttackDeclaredOnYou',
      'whenAttackDeclaredOnAdjacentFriendly',
      'whenAttackDeclaredTargetingFriendlySmallFigureCost10OrLessWithin3Spaces',
      'whenFigureWithin3SpacesDefending',
      'whileDefending',
      'whileAdjacentFriendlyFigureDefending',
    ]);
    const defOwnerId = getPlayerId(game, defenderPlayerNum);
    if (defReactions.length) {
      await thread.send({ content: `<@${defOwnerId}> — You have ${defReactions.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [defOwnerId] } }).catch(() => {});
    }
    // Auto-prompt attacker for whenYouDeclareAttack cards
    const atkReactions = getPlayableReactionCards(game, attackerPlayerNum, [
      'whenYouDeclareAttack',
      'whenYouDeclareAttackTargetingHostileWithHighestFigureCost',
      'beforeYouDeclareAttack',
      'duringAttack',
      'whenAnotherFriendlyTrooperDeclaresAttackTargetingInYourLineOfSight',
    ]);
    const atkOwnerId = getPlayerId(game, attackerPlayerNum);
    if (atkReactions.length) {
      await thread.send({ content: `<@${atkOwnerId}> — You have ${atkReactions.length} reaction card(s) playable now. Check your Hand channel.`, allowedMentions: { users: [atkOwnerId] } }).catch(() => {});
    }
  } catch (err) {
    console.error('Reaction prompt error:', err?.message ?? err);
  }

  saveGames();
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx - getGame, replyIfGameEnded, resolveCombatAfterRolls, saveGames, client
 */
export async function handleCombatReady(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const gameId = interaction.customId.replace('combat_ready_', '');
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const clickerIsP1 = interaction.user.id === game.player1Id;
  const clickerIsP2 = interaction.user.id === game.player2Id;
  if (!clickerIsP1 && !clickerIsP2) {
    await interaction.followUp({ content: 'Only players in this game can indicate ready.', ephemeral: true }).catch(discordCatch);
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
    .setColor(COLORS.ORANGE)
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
    await preMsg.edit({ components: [] }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can roll.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  const effectiveAttackerPlayerNum = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;

  if (!combat.attackRoll) {
    if (!canActAsPlayer(game, interaction.user.id, effectiveAttackerPlayerNum)) {
      await interaction.followUp({ content: `Only the attacker (P${effectiveAttackerPlayerNum}) may roll attack dice.`, ephemeral: true }).catch(discordCatch);
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
    // Veteran Instincts: attacker may add +1 Hit or +1 Surge to this roll
    if (game.vetInstinctsActiveThisActivation?.[attackerPlayerNum] && !combat.vetInstinctsAttackApplied) {
      const _viRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_hit`).setLabel('+1 Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_surge`).setLabel('+1 Surge').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Veteran Instincts** — <@${game[`player${attackerPlayerNum}Id`] ?? ''}> add +1 Hit or +1 Surge to the attack roll?`, components: [_viRow] }).catch(discordCatch);
      saveGames();
      return;
    }
    saveGames();
    return;
  }

  if (!combat.defenseRoll) {
    if (!canActAsPlayer(game, interaction.user.id, defenderPlayerNum)) {
      await interaction.followUp({ content: `Only the defender (P${defenderPlayerNum}) may roll defense dice.`, ephemeral: true }).catch(discordCatch);
      return;
    }
    const baseColor = combat.targetStats.defense || 'white';
    const bonusDice = combat.defenseBonusDice || [];
    const pool = [baseColor, ...bonusDice];
    // Cross Training (Skirmish Upgrade): replace 1 non-white defense die with white
    if (combat.crossTrainingDefend) {
      const _ctIdx = pool.findIndex(c => c !== 'white');
      if (_ctIdx !== -1) pool[_ctIdx] = 'white';
    }
    // Autofire: defender adds 1 white die
    if (game.autofireActive?.[combat.attackerMsgId]) {
      pool.push('white');
      await thread.send('**Autofire** — Defender adds 1 white die to defense pool.').catch(() => {});
    }
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

    // There Is No Try (TINT): if thereIsNoTryPlayerNum is set for the defender, and the defending DC has REBEL + FORCE USER keywords
    if (game.thereIsNoTryPlayerNum === defenderPlayerNum && !combat.tintResolved) {
      const _tintDefDcName = (combat.target?.figureKey || '').replace(/-\d+-\d+$/, '');
      const _tintStats = ctx.getDcStats?.(_tintDefDcName) || {};
      const _tintAllKws = [...(_tintStats.keywords || []), ...(_tintStats.traits || [])].map((k) => String(k).toUpperCase());
      if (_tintAllKws.includes('REBEL') && _tintAllKws.includes('FORCE USER')) {
        game.pendingThereIsNoTry = { defenderPlayerNum };
        const _tintDice = combat.defenseDiceResults || [];
        const _tintBtns = _tintDice.map((d, i) =>
          new ButtonBuilder()
            .setCustomId(`there_is_no_try_die_${gameId}_${i}`)
            .setLabel(`Die #${i + 1}: ${d.block}B/${d.evade}E${d.dodge ? '/Dodge' : ''}`.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
        _tintBtns.push(new ButtonBuilder().setCustomId(`there_is_no_try_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary));
        const _tintRows = [];
        for (let i = 0; i < _tintBtns.length; i += 5) _tintRows.push(new ActionRowBuilder().addComponents(_tintBtns.slice(i, i + 5)));
        await thread.send({ content: `**There Is No Try** — <@${game[`player${defenderPlayerNum}Id`] ?? ''}> choose a defense die to set to any face:`, components: _tintRows.slice(0, 5) }).catch(discordCatch);
        saveGames();
        return; // Wait for TINT response before entering reroll window
      }
    }

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
    const tcIds = ['targeting_computer_hk_elite', 'targeting_computer_ig11', 'targeting_computer_probe_elite', 'targeting_computer_sentry_elite', 'targeting_computer_sentry_reg', 'targeting_computer_atst', 'adv_targeting_computer_dark_trooper'];
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

    // Cower (C-3PO, Imperial Officer Regular): +1 def reroll if adjacent to a friendly figure
    const cowerIds = ['cower_c3po', 'cower_imperial_officer_reg'];
    if (defSIds.some(id => cowerIds.includes(id))) {
      const defFigsC = game.figurePositions?.[defenderPlayerNum] || {};
      const mapSpC = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const defPosC = combat.target?.coord;
      if (defPosC && mapSpC) {
        const adjToDefC = new Set((mapSpC.adjacency?.[String(defPosC).toLowerCase()] || []).map(s => String(s).toLowerCase()));
        for (const [fk, pos] of Object.entries(defFigsC)) {
          if (fk === combat.target?.figureKey) continue;
          if (adjToDefC.has(String(pos).toLowerCase())) {
            defSpecialReroll += 1;
            break;
          }
        }
      }
    }

    // Squad Training (Shoretrooper E, Stormtrooper E/R): +1 atk reroll if adjacent friendly TROOPER
    const squadTrainingIds = ['squad_training_shoretrooper_elite', 'squad_training_shoretrooper_reg', 'squad_training_stormtrooper_elite', 'squad_training_stormtrooper_reg'];
    if (atkSIds.some(id => squadTrainingIds.includes(id))) {
      const stFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const stMap = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const stPos = stFigs[combat.attackerFigureKey];
      if (stPos && stMap) {
        const stAdj = new Set((stMap.adjacency?.[String(stPos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
        for (const [fk, pos] of Object.entries(stFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          if (!stAdj.has(String(pos).toLowerCase())) continue;
          const fn = fk.replace(/-\d+-\d+$/, '');
          const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
          if ((fe?.keywords || []).some(k => String(k).toUpperCase() === 'TROOPER')) {
            atkSpecialReroll += 1; break;
          }
        }
      }
    }
    // Coordinated Hunt (Purge Commander Elite): +1 atk reroll for self or HUNTER with PC in LOS. Limit 1 per attack.
    {
      let _chApplied = false;
      if (atkSIds.includes('coordinated_hunt_purge_commander')) {
        atkSpecialReroll += 1; _chApplied = true;
      }
      if (!_chApplied) {
        const atkKwsCH = (atkEffR?.keywords || []).map(k => String(k).toUpperCase());
        if (atkKwsCH.includes('HUNTER')) {
          const chFigs = game.figurePositions?.[attackerPlayerNum] || {};
          const chMapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
          const chAtkPos = chFigs[combat.attackerFigureKey];
          if (chAtkPos && chMapSp && ctx.hasLineOfSight) {
            for (const [fk, pos] of Object.entries(chFigs)) {
              if (fk === combat.attackerFigureKey) continue;
              const fn = fk.replace(/-\d+-\d+$/, '');
              const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
              if (!(fe?.specialAbilityIds || []).includes('coordinated_hunt_purge_commander')) continue;
              if (pos && ctx.hasLineOfSight(String(pos).toLowerCase(), String(chAtkPos).toLowerCase(), chMapSp)) {
                atkSpecialReroll += 1; _chApplied = true; break;
              }
            }
          }
        }
      }
    }
    // Light It Up (Rebel Pathfinder Elite): +1 atk reroll if target had no LOS to attacker at activation start
    if (atkSIds.includes('light_it_up_rebel_pathfinder')) {
      const liuStartPos = game.activationStartPositions?.[combat.attackerFigureKey];
      const liuMapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      if (liuStartPos && combat.target?.coord && liuMapSp && ctx.hasLineOfSight) {
        const targetHadLos = ctx.hasLineOfSight(String(combat.target.coord).toLowerCase(), String(liuStartPos).toLowerCase(), liuMapSp);
        if (!targetHadLos) atkSpecialReroll += 1;
      }
    }

    // Build forced reroll queue for Batch 2B abilities
    combat.forcedRerollQueue = [];
    // Versatile Weaponry (HK Assassin Elite): attacker forces 1 def die reroll
    if (atkSIds.includes('versatile_weaponry_hk_elite')) {
      combat.forcedRerollQueue.push({ controlPlayer: attackerPlayerNum, pool: 'defense', remaining: 1, source: 'Versatile Weaponry' });
    }
    // Shared Calculations (Zuckuss): attacker forces 1 def die reroll if friendly DROID within 3 + LOS to target
    if (atkSIds.includes('shared_calculations_zuckuss') && combat.target?.coord) {
      const scFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const scMapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      if (scMapSp) {
        for (const [fk, pos] of Object.entries(scFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          const fn = fk.replace(/-\d+-\d+$/, '');
          const fe = getDcEff()[fn] || getDcEff()[(fn).replace(/\s*\[.*\]\s*$/, '')];
          if (!(fe?.keywords || []).some(k => String(k).toUpperCase() === 'DROID')) continue;
          if (!pos) continue;
          if (!isWithinSpaces(scMapSp, String(pos).toLowerCase(), String(combat.target.coord).toLowerCase(), 3)) continue;
          if (ctx.hasLineOfSight && ctx.hasLineOfSight(String(pos).toLowerCase(), String(combat.target.coord).toLowerCase(), scMapSp)) {
            combat.forcedRerollQueue.push({ controlPlayer: attackerPlayerNum, pool: 'defense', remaining: 1, source: 'Shared Calculations' });
            break;
          }
        }
      }
    }
    // Raider (Weequay Elite/Reg): attacker chooses any 1 die, force reroll
    const raiderIds = ['raider_weequay_elite', 'raider_weequay_reg'];
    if (atkSIds.some(id => raiderIds.includes(id))) {
      combat.forcedRerollQueue.push({ controlPlayer: attackerPlayerNum, pool: 'any', remaining: 1, source: 'Raider' });
    }
    // Precision (Grand Inquisitor): if attacking/defending against adjacent, choose any 1 die to force reroll
    if (atkSIds.includes('precision_grand_inquisitor') || defSIds.includes('precision_grand_inquisitor')) {
      const precMapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const precAtkPos = (game.figurePositions?.[attackerPlayerNum] || {})[combat.attackerFigureKey];
      const precDefPos = combat.target?.coord;
      if (precAtkPos && precDefPos && precMapSp) {
        const precAdj = (precMapSp.adjacency?.[String(precAtkPos).toLowerCase()] || []).map(s => String(s).toLowerCase());
        if (precAdj.includes(String(precDefPos).toLowerCase())) {
          const precPlayer = atkSIds.includes('precision_grand_inquisitor') ? attackerPlayerNum : defenderPlayerNum;
          combat.forcedRerollQueue.push({ controlPlayer: precPlayer, pool: 'any', remaining: 1, source: 'Precision' });
        }
      }
    }
    // Fyrnock Style (Tress Hacnua): while attacking or defending, choose 1 attack die to force reroll
    if (atkSIds.includes('fyrnock_style_tress') || defSIds.includes('fyrnock_style_tress')) {
      const fsPlayer = atkSIds.includes('fyrnock_style_tress') ? attackerPlayerNum : defenderPlayerNum;
      combat.forcedRerollQueue.push({ controlPlayer: fsPlayer, pool: 'attack', remaining: 1, source: 'Fyrnock Style' });
    }

    // Demoralizing Monologue: if flag set before reroll window, count 1 forced reroll for defender
    let _dmForcedReroll = 0;
    if (game.forceDefenderRerollOne && !combat.demoralizingMonologueApplied) {
      _dmForcedReroll = 1;
      combat.demoralizingMonologueApplied = true;
      game.forceDefenderRerollOne = null;
    }
    // Power Converter (Saska): device reroll grants +1 atk reroll to friendly figure
    if (game.deviceRerollGranted?.[combat.attackerMsgId]) {
      atkSpecialReroll += 1;
      delete game.deviceRerollGranted[combat.attackerMsgId];
    }
    // Trusted Ally (Skirmish Upgrade): if a friendly DROID within 3 has this attachment (not exhausted), +1 atk reroll
    {
      const _taFigs = game.figurePositions?.[attackerPlayerNum] || {};
      const _taMapSp = game.selectedMap?.id ? getMapSpaces(game.selectedMap.id) : null;
      const _taAtkPos = _taFigs[combat.attackerFigureKey];
      if (_taAtkPos && _taMapSp) {
        for (const [fk, pos] of Object.entries(_taFigs)) {
          if (fk === combat.attackerFigureKey) continue;
          const fn = fk.replace(/-\d+-\d+$/, '');
          if (!isWithinSpaces(_taMapSp, String(pos).toLowerCase(), String(_taAtkPos).toLowerCase(), 3)) continue;
          // Check if this figure's DC has Trusted Ally attachment and it's not exhausted
          const _taMsgIds = getDcMessageIds(game, attackerPlayerNum) || [];
          const _taDcList = getDcList(game, attackerPlayerNum) || [];
          for (let i = 0; i < _taDcList.length; i++) {
            if (_taDcList[i]?.dcName !== fn) continue;
            const _taMid = _taMsgIds[i];
            const _taAtts = game.p1DcAttachments?.[_taMid] || game.p2DcAttachments?.[_taMid] || [];
            if (!_taAtts.includes('Trusted Ally')) break;
            if ((game.exhaustedSkirmishUpgrades?.[_taMid] || []).includes('Trusted Ally')) break;
            // Auto-exhaust and grant reroll
            game.exhaustedSkirmishUpgrades = game.exhaustedSkirmishUpgrades || {};
            game.exhaustedSkirmishUpgrades[_taMid] = [...(game.exhaustedSkirmishUpgrades[_taMid] || []), 'Trusted Ally'];
            atkSpecialReroll += 1;
            await thread.send(`**Trusted Ally** (${fn}) — Exhausted: friendly within 3 spaces, +1 attack reroll granted.`).catch(discordCatch);
            break;
          }
          if (atkSpecialReroll > 0) break; // only one Trusted Ally bonus per attack
        }
      }
    }
    const atkRerolls = (combat.rerollOneAttackDie || 0) + (game.roundAttackRerollDice?.[attackerPlayerNum] || 0) + atkInnate.attackReroll + atkSpecialReroll;
    const defRerolls = (combat.defenderRerollDiceMax || 0) + defInnate.defenseReroll + defSpecialReroll + _dmForcedReroll;
    // Veteran Instincts: defender may add +1 Block or +1 Evade before the reroll window
    if (game.vetInstinctsActiveThisActivation?.[defenderPlayerNum] && !combat.vetInstinctsDefenseApplied) {
      combat.viPendingAtkRerolls = atkRerolls;
      combat.viPendingDefRerolls = defRerolls;
      const _viRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`vet_instincts_pick_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      );
      await thread.send({ content: `**Veteran Instincts** — <@${game[`player${defenderPlayerNum}Id`] ?? ''}> add +1 Block or +1 Evade to the defense roll?`, components: [_viRow] }).catch(discordCatch);
      saveGames();
      return;
    }
    combat.attackerRerollsRemaining = atkRerolls;
    combat.defenderRerollsRemaining = defRerolls;
    // Build pre-reroll prompt queue (2C abilities that need a choice before rerolls)
    combat.pendingPreRerolls = [];
    if (atkSIds.includes('twin_sabers_ahsoka')) {
      combat.pendingPreRerolls.push({ type: 'twin_sabers', playerNum: attackerPlayerNum });
    }
    if (atkSIds.includes('resourceful_lando') || defSIds.includes('resourceful_lando')) {
      const _resPlayer = atkSIds.includes('resourceful_lando') ? attackerPlayerNum : defenderPlayerNum;
      const _resSIds = atkSIds.includes('resourceful_lando') ? atkSIds : defSIds;
      if (_resSIds.includes('shrewd_scoundrel_lando')) {
        combat.pendingPreRerolls.push({ type: 'shrewd_scoundrel', playerNum: _resPlayer });
      }
      if (_resSIds.includes('gambit_lando')) combat.gambitActive = true;
      combat.pendingPreRerolls.push({ type: 'resourceful', playerNum: _resPlayer });
    }
    if (atkSIds.includes('trained_rancor')) {
      combat.pendingPreRerolls.push({ type: 'trained', playerNum: attackerPlayerNum });
    }
    const hasForcedRerolls = (combat.forcedRerollQueue || []).length > 0;
    if (atkRerolls > 0 || defRerolls > 0 || hasForcedRerolls) {
      if (atkRerolls > 0) {
        combat.rerollPhase = 'attacker';
        await sendRerollUI(thread, game, combat, 'attacker');
      } else if (hasForcedRerolls) {
        combat.rerollPhase = 'forced';
        await sendRerollUI(thread, game, combat, 'forced');
      } else {
        combat.rerollPhase = 'defender';
        await sendRerollUI(thread, game, combat, 'defender');
      }
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
export async function sendRerollUI(thread, game, combat, phase) {
  const gameId = game.gameId;
  // Helper: advance from forced to defender (or null)
  const _advanceFromForced = async () => {
    if ((combat.forcedRerollQueue || []).length > 0) {
      combat.rerollPhase = 'forced';
      await sendRerollUI(thread, game, combat, 'forced');
      return;
    }
    combat.rerollPhase = 'defender';
    if ((combat.defenderRerollsRemaining || 0) > 0) {
      await sendRerollUI(thread, game, combat, 'defender');
      return;
    }
    combat.rerollPhase = null;
  };
  if (phase === 'attacker') {
    // Pre-reroll prompts: show before any reroll dice are offered
    if (!combat.preRerollsProcessed && (combat.pendingPreRerolls || []).length > 0) {
      const pr = combat.pendingPreRerolls[0];
      const playerId = game[`player${pr.playerNum}Id`] ?? '';
      if (pr.type === 'twin_sabers') {
        const atkCount = (combat.attackDiceResults || []).length;
        const defCount = (combat.defenseDiceResults || []).length;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_atk`).setLabel(`Reroll all ${atkCount} ATK dice`).setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_twin_sabers_def`).setLabel(`Force reroll all ${defCount} DEF dice`).setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Twin Sabers** — <@${playerId}> choose:`, components: [row] });
        return;
      }
      if (pr.type === 'shrewd_scoundrel') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_0`).setLabel('Guess 0 Hits').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_1`).setLabel('Guess 1 Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_shrewd_2`).setLabel('Guess 2 Hits').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip (no guess)').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Shrewd Scoundrel** — <@${playerId}> guess the number of Hit results after rerolls (0-2):`, components: [row] });
        return;
      }
      if (pr.type === 'resourceful') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_atk`).setLabel('Reroll 1 ATK die').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_resourceful_def`).setLabel('Reroll 1 DEF die').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Resourceful** — <@${playerId}> choose:`, components: [row] });
        return;
      }
      if (pr.type === 'trained') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_yes`).setLabel('Suffer 1 Strain, +1 ATK reroll').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`pre_reroll_${gameId}_trained_no`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        );
        await thread.send({ content: `**Trained** — <@${playerId}> suffer 1 Strain to reroll 1 attack die?`, components: [row] });
        return;
      }
      // Unknown type — skip it
      combat.pendingPreRerolls.shift();
    }
    const remaining = combat.attackerRerollsRemaining || 0;
    if (remaining <= 0) {
      await _advanceFromForced();
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
  } else if (phase === 'forced') {
    const entry = (combat.forcedRerollQueue || [])[0];
    if (!entry || entry.remaining <= 0) {
      combat.forcedRerollQueue.shift();
      await _advanceFromForced();
      return;
    }
    const buttons = [];
    if (entry.pool === 'attack' || entry.pool === 'any') {
      const aDice = combat.attackDiceResults || [];
      for (let i = 0; i < aDice.length; i++) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`combat_reroll_${gameId}_atk_${i}`)
            .setLabel(`Force ATK ${formatAttackDie(aDice[i], i)}`)
            .setStyle(ButtonStyle.Danger)
        );
      }
    }
    if (entry.pool === 'defense' || entry.pool === 'any') {
      const dDice = combat.defenseDiceResults || [];
      for (let i = 0; i < dDice.length; i++) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`combat_reroll_${gameId}_def_${i}`)
            .setLabel(`Force DEF ${formatDefenseDie(dDice[i], i)}`)
            .setStyle(ButtonStyle.Danger)
        );
      }
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`combat_reroll_${gameId}_atk_done`)
        .setLabel('Skip (no forced reroll)')
        .setStyle(ButtonStyle.Secondary)
    );
    const actionRows = buildActionRows(buttons);
    const poolLabel = entry.pool === 'any' ? '' : entry.pool + ' ';
    await thread.send({
      content: `**${entry.source}** (Forced Reroll) — Pick a ${poolLabel}die to force reroll (${entry.remaining} remaining), or Skip.`,
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.rerollPhase) {
    await interaction.followUp({ content: 'No reroll phase active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defenderPlayerNum = opponentPlayerNum(attackerPlayerNum);
  const effectiveAtk = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  // Phase validation: accept 'forced' for both atk and def sides
  if (combat.rerollPhase === 'forced') {
    // Forced phase accepts both atk and def die picks
  } else {
    const expectedPhase = side === 'atk' ? 'attacker' : 'defender';
    if (combat.rerollPhase !== expectedPhase) {
      await interaction.followUp({ content: `It's the ${combat.rerollPhase}'s turn to reroll.`, ephemeral: true }).catch(discordCatch);
      return;
    }
  }
  // Permission: for forced phase, use controlPlayer from queue entry
  let expectedPlayer;
  if (combat.rerollPhase === 'forced') {
    expectedPlayer = (combat.forcedRerollQueue || [])[0]?.controlPlayer;
  } else {
    expectedPlayer = side === 'atk' ? effectiveAtk : defenderPlayerNum;
  }
  if (!expectedPlayer || !canActAsPlayer(game, interaction.user.id, expectedPlayer)) {
    await interaction.followUp({ content: `Only P${expectedPlayer} can reroll ${combat.rerollPhase === 'forced' ? 'forced' : (side === 'atk' ? 'attack' : 'defense')} dice.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  // Helper: get the dominant icon type of a die result for Double or Nothing
  const _getDomIcon = (d) => {
    if (!d) return null;
    const { dmg: _dd = 0, surge: _ds = 0, acc: _da = 0 } = d;
    if (_dd === 0 && _ds === 0 && _da === 0) return null;
    if (_dd >= _ds && _dd >= _da) return 'dmg';
    if (_ds >= _dd && _ds >= _da) return 'surge';
    return 'acc';
  };

  // --- Forced reroll phase handling ---
  if (combat.rerollPhase === 'forced') {
    const _frEntry = (combat.forcedRerollQueue || [])[0];
    if (choice !== 'done' && _frEntry && _frEntry.remaining > 0) {
      const idx = parseInt(choice, 10);
      if (side === 'atk') {
        const dice = combat.attackDiceResults || [];
        if (idx >= 0 && idx < dice.length) {
          const oldDie = dice[idx];
          const newDie = rollSingleAttackDie(oldDie.color);
          dice[idx] = newDie;
          combat.attackDiceResults = dice;
          const totals = recalcAttackTotals(dice);
          combat.attackRoll = { acc: totals.acc, dmg: totals.dmg, surge: totals.surge };
          _frEntry.remaining -= 1;
          await thread.send(`**${_frEntry.source}** forced reroll ATK ${oldDie.color} #${idx + 1}: ${oldDie.acc}a/${oldDie.dmg}d/${oldDie.surge}s → **${newDie.acc}a/${newDie.dmg}d/${newDie.surge}s** | New totals: ${totals.acc} acc, ${totals.dmg} dmg, ${totals.surge} surge`);
        }
      } else {
        const dice = combat.defenseDiceResults || [];
        if (idx >= 0 && idx < dice.length) {
          const oldDie = dice[idx];
          const newDie = rollSingleDefenseDie(oldDie.color);
          dice[idx] = newDie;
          combat.defenseDiceResults = dice;
          const totals = recalcDefenseTotals(dice);
          combat.defenseRoll = { block: totals.block, evade: totals.evade, dodge: totals.dodge };
          _frEntry.remaining -= 1;
          const dodgeTag = newDie.dodge ? '/DODGE' : '';
          await thread.send(`**${_frEntry.source}** forced reroll DEF ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
        }
      }
    }
    // Transition: done or entry exhausted
    if (choice === 'done' || !_frEntry || _frEntry.remaining <= 0) {
      if (_frEntry) combat.forcedRerollQueue.shift();
    }
    if ((combat.forcedRerollQueue || []).length > 0) {
      await sendRerollUI(thread, game, combat, 'forced');
      saveGames();
      return;
    }
    // All forced rerolls done — move to defender
    if (game.forceDefenderRerollOne && !combat.demoralizingMonologueApplied) {
      combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
      combat.demoralizingMonologueApplied = true;
      game.forceDefenderRerollOne = null;
    }
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

  // --- Voluntary reroll phase handling ---
  let _tlTriggered = false;
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
        // Double or Nothing: if DON flag is set for attack side, check dominant icon match
        if (game.doubleMatchingIconsOnReroll?.side === 'atk' && !combat.doubleOrNothingApplied) {
          const _domOld = _getDomIcon(oldDie);
          const _domNew = _getDomIcon(newDie);
          if (_domOld && _domOld === _domNew) {
            dice[idx][_domNew] = (newDie[_domNew] || 0) * 2;
            const t2 = recalcAttackTotals(dice);
            combat.attackRoll = { acc: t2.acc, dmg: t2.dmg, surge: t2.surge };
            await thread.send(`**Double or Nothing** — Dominant icon matched (${_domNew})! Doubled to ${dice[idx][_domNew]}. New totals: ${t2.acc} acc, ${t2.dmg} dmg, ${t2.surge} surge.`);
          } else {
            await thread.send(`**Double or Nothing** — Icon changed (${_domOld ?? 'blank'} → ${_domNew ?? 'blank'}). No doubling.`);
          }
          combat.doubleOrNothingApplied = true;
          game.doubleMatchingIconsOnReroll = null;
        }
        // Advanced Targeting Computer (Dark Trooper Mk III): if rerolled die has fewer Hits, +1 Hit
        if (!combat.advTcBonusApplied) {
          const _atcDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
          const _atcDcName = (combat.attackerFigureKey || '').replace(/-\d+-\d+$/, '');
          const _atcEff = _atcDcEff[_atcDcName] || _atcDcEff[_atcDcName?.replace(/\s*\[.*\]\s*$/, '')];
          if ((_atcEff?.specialAbilityIds || []).includes('adv_targeting_computer_dark_trooper')) {
            if ((newDie.dmg || 0) < (oldDie.dmg || 0)) {
              combat.bonusHits = (combat.bonusHits || 0) + 1;
              combat.advTcBonusApplied = true;
              await thread.send('**Advanced Targeting Computer** — Rerolled die has fewer Hits: +1 Hit applied.');
            }
          }
        }
        // Tough Luck: if defender set TL, they may remove this rerolled die
        if (game.toughLuckPlayerNum === defenderPlayerNum) {
          game.pendingToughLuck = { side: 'atk', idx };
          const _tlOwner = game[`player${defenderPlayerNum}Id`] ?? '';
          const _tlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tough_luck_remove_${gameId}_${idx}`).setLabel(`Remove rerolled ${newDie.color} die`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tough_luck_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Tough Luck** — <@${_tlOwner}> may remove the rerolled attack die.`, components: [_tlRow] }).catch(discordCatch);
          _tlTriggered = true;
        }
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
        combat.defenderRerolledOrModified = true; // Track for Quick Strike (Electrostaff loadout)
        const dodgeTag = newDie.dodge ? '/DODGE' : '';
        await thread.send(`**Rerolled** defense ${oldDie.color} #${idx + 1}: ${oldDie.block}b/${oldDie.evade}e${oldDie.dodge ? '/dodge' : ''} → **${newDie.block}b/${newDie.evade}e${dodgeTag}** | New totals: ${totals.block} block, ${totals.evade} evade${totals.dodge ? ' DODGE' : ''}`);
        // Double or Nothing: if DON flag is set for defense side, check dominant icon match
        if (game.doubleMatchingIconsOnReroll?.side === 'def' && !combat.doubleOrNothingApplied) {
          const _domOldD = _getDomIcon({ dmg: oldDie.block, surge: oldDie.evade, acc: oldDie.dodge ? 1 : 0 });
          const _domNewD = _getDomIcon({ dmg: newDie.block, surge: newDie.evade, acc: newDie.dodge ? 1 : 0 });
          if (_domOldD && _domOldD === _domNewD) {
            if (_domNewD === 'dmg') { dice[idx].block = (newDie.block || 0) * 2; }
            else if (_domNewD === 'surge') { dice[idx].evade = (newDie.evade || 0) * 2; }
            const t2d = recalcDefenseTotals(dice);
            combat.defenseRoll = { block: t2d.block, evade: t2d.evade, dodge: t2d.dodge };
            await thread.send(`**Double or Nothing** — Dominant defense icon matched (${_domNewD === 'dmg' ? 'Block' : 'Evade'})! Doubled. New totals: ${t2d.block} block, ${t2d.evade} evade.`);
          } else {
            await thread.send(`**Double or Nothing** — Icon changed. No doubling.`);
          }
          combat.doubleOrNothingApplied = true;
          game.doubleMatchingIconsOnReroll = null;
        }
        // Tough Luck: if attacker set TL, they may remove this rerolled defense die
        if (game.toughLuckPlayerNum === attackerPlayerNum) {
          game.pendingToughLuck = { side: 'def', idx };
          const _tlOwner = game[`player${attackerPlayerNum}Id`] ?? '';
          const _tlRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tough_luck_remove_${gameId}_${idx}`).setLabel(`Remove rerolled ${newDie.color} die`).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tough_luck_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Tough Luck** — <@${_tlOwner}> may remove the rerolled defense die.`, components: [_tlRow] }).catch(discordCatch);
          _tlTriggered = true;
        }
      }
    }
  }
  if (_tlTriggered) { saveGames(); return; }

  // Check if current side is done (clicked done or exhausted rerolls)
  if (side === 'atk' && (choice === 'done' || combat.attackerRerollsRemaining <= 0)) {
    // Route through forced reroll queue before defender
    if ((combat.forcedRerollQueue || []).length > 0) {
      combat.rerollPhase = 'forced';
      await sendRerollUI(thread, game, combat, 'forced');
      saveGames();
      return;
    }
    combat.rerollPhase = 'defender';
    // Demoralizing Monologue: if flag still pending, add forced reroll for defender now
    if (game.forceDefenderRerollOne && !combat.demoralizingMonologueApplied) {
      combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
      combat.demoralizingMonologueApplied = true;
      game.forceDefenderRerollOne = null;
    }
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

/**
 * Handle pre-reroll button clicks (pre_reroll_{gameId}_{choice})
 * Choices: twin_sabers_atk, twin_sabers_def, resourceful_atk, resourceful_def,
 *   trained_yes, trained_no, shrewd_0/1/2, skip
 */
export async function handlePreReroll(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const match = interaction.customId.match(/^pre_reroll_([^_]+)_(.+)$/);
  if (!match) return;
  const [, gameId, choice] = match;
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No active combat.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const pr = (combat.pendingPreRerolls || [])[0];
  if (!pr) { await interaction.followUp({ content: 'No pending pre-reroll.', ephemeral: true }).catch(discordCatch); return; }
  if (!canActAsPlayer(game, interaction.user.id, pr.playerNum)) {
    await interaction.followUp({ content: `Only P${pr.playerNum} can make this choice.`, ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  // Process choice
  if (choice === 'skip') {
    combat.pendingPreRerolls.shift();
    await thread.send(`Pre-reroll choice skipped.`);
  } else if (choice === 'twin_sabers_atk') {
    // Reroll all attack dice: set atkRerolls to number of dice
    combat.attackerRerollsRemaining = (combat.attackDiceResults || []).length;
    combat.pendingPreRerolls.shift();
    await thread.send(`**Twin Sabers** — Will reroll all ${combat.attackerRerollsRemaining} attack dice.`);
  } else if (choice === 'twin_sabers_def') {
    // Force reroll all defense dice: add to forced queue
    const defCount = (combat.defenseDiceResults || []).length;
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    combat.forcedRerollQueue.unshift({ controlPlayer: combat.attackerPlayerNum, pool: 'defense', remaining: defCount, source: 'Twin Sabers' });
    combat.pendingPreRerolls.shift();
    await thread.send(`**Twin Sabers** — Will force reroll all ${defCount} defense dice.`);
  } else if (choice === 'resourceful_atk') {
    combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
    combat.resourcefulSide = 'atk';
    combat.pendingPreRerolls.shift();
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — +1 attack reroll.${gambitNote}`);
  } else if (choice === 'resourceful_def') {
    combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
    combat.resourcefulSide = 'def';
    combat.pendingPreRerolls.shift();
    const gambitNote = combat.gambitActive ? ' (Gambit: you may swap die color before rerolling)' : '';
    await thread.send(`**Resourceful** — +1 defense reroll.${gambitNote}`);
  } else if (choice === 'trained_yes') {
    // Suffer 1 strain (= 1 HP damage) + +1 atk reroll
    const dcHS = ctx.dcHealthState;
    const atkMsgId = combat.attackerMsgId;
    if (atkMsgId && dcHS) {
      const hpArr = dcHS.get(atkMsgId);
      const figIdx = combat.attackerFigureIndex ?? 0;
      if (hpArr?.[figIdx]) {
        hpArr[figIdx][0] = Math.max(0, (hpArr[figIdx][0] ?? 0) - 1);
      }
    }
    combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
    combat.pendingPreRerolls.shift();
    await thread.send(`**Trained** — Suffered 1 Strain. +1 attack reroll.`);
  } else if (choice === 'trained_no') {
    combat.pendingPreRerolls.shift();
    await thread.send(`**Trained** — Skipped.`);
  } else if (choice.startsWith('shrewd_')) {
    const guess = parseInt(choice.replace('shrewd_', ''), 10);
    if (!isNaN(guess)) {
      combat.shrewdScoundrelGuess = guess;
      await thread.send(`**Shrewd Scoundrel** — Guessed **${guess}** Hit result${guess !== 1 ? 's' : ''}.`);
    }
    combat.pendingPreRerolls.shift();
  } else {
    combat.pendingPreRerolls.shift();
  }

  // Check if more pre-rerolls remain
  if ((combat.pendingPreRerolls || []).length > 0) {
    combat.rerollPhase = 'attacker';
    await sendRerollUI(thread, game, combat, 'attacker');
    saveGames();
    return;
  }

  // All pre-rerolls done — enter the actual reroll window
  combat.preRerollsProcessed = true;
  const hasForcedRerolls = (combat.forcedRerollQueue || []).length > 0;
  const atkR = combat.attackerRerollsRemaining || 0;
  const defR = combat.defenderRerollsRemaining || 0;
  if (atkR > 0 || defR > 0 || hasForcedRerolls) {
    if (atkR > 0) {
      combat.rerollPhase = 'attacker';
      await sendRerollUI(thread, game, combat, 'attacker');
    } else if (hasForcedRerolls) {
      combat.rerollPhase = 'forced';
      await sendRerollUI(thread, game, combat, 'forced');
    } else {
      combat.rerollPhase = 'defender';
      await sendRerollUI(thread, game, combat, 'defender');
    }
    saveGames();
    return;
  }
  // No rerolls — proceed directly
  combat.rerollPhase = null;
  await proceedAfterRerolls(thread, game, combat, ctx);
  saveGames();
}

// Delegate to src/game/spatial.js (canonical implementation)
const isWithinSpaces = _isWithinSpaces;

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
  }).catch(discordCatch);
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
 * Handle combat_passive_ buttons: Defensible, Get Down, Call the Shots choices.
 * After applying the choice, re-enters proceedAfterRerolls.
 */
export async function handleCombatPassive(interaction, ctx) {
  const { getGame, replyIfGameEnded, saveGames } = ctx;
  const m = interaction.customId.match(/^combat_passive_([^_]+)_(.+)$/);
  if (!m) return;
  const [, gameId, rest] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) return;
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);

  // Parse ability and choice
  const parts = rest.split('_');
  const abilityKey = parts[0]; // defensible, getdown, cts
  const choice = parts.slice(1).join('_'); // block, evade, skip, acc, hit, surge

  if (abilityKey === 'defensible') {
    if (choice === 'block') {
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      await thread.send('**Defensible** — Applied +1 Block.');
    } else if (choice === 'evade') {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Defensible** — Applied +1 Evade.');
    } else {
      await thread.send('**Defensible** — Skipped.');
    }
    combat.defensibleResolved = true;
    delete combat.pendingCombatPassive;
  } else if (abilityKey === 'getdown') {
    if (combat.getDownFigKey) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${combat.getDownFigKey}_get_down`] = true;
    }
    if (choice === 'block') {
      combat.bonusBlock = (combat.bonusBlock || 0) + 1;
      await thread.send('**Get Down** — Applied +1 Block.');
    } else if (choice === 'evade') {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Get Down** — Applied +1 Evade.');
    } else {
      await thread.send('**Get Down** — Skipped.');
    }
    combat.getDownResolved = true;
    delete combat.pendingCombatPassive;
    delete combat.getDownFigKey;
  } else if (abilityKey === 'cts') {
    if (combat.callTheShotsFigKey) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${combat.callTheShotsFigKey}_call_the_shots`] = true;
    }
    if (choice === 'acc') {
      combat.bonusAccuracy = (combat.bonusAccuracy || 0) + 2;
      await thread.send('**Call the Shots** — Applied +2 Accuracy.');
    } else if (choice === 'hit') {
      combat.bonusHits = (combat.bonusHits || 0) + 1;
      await thread.send('**Call the Shots** — Applied +1 Hit.');
    } else if (choice === 'surge') {
      combat.surgeBonus = (combat.surgeBonus || 0) + 1;
      await thread.send('**Call the Shots** — Applied +1 Surge.');
    } else {
      await thread.send('**Call the Shots** — Skipped.');
    }
    combat.callTheShotsResolved = true;
    delete combat.pendingCombatPassive;
    delete combat.callTheShotsFigKey;
  } else if (abilityKey === 'survival') {
    // Survival is Strength: reroll 1 attack die (chosen by defender's team)
    if (combat.survivalFigKey) {
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`${combat.survivalFigKey}_survival_is_strength`] = true;
    }
    if (choice === 'skip') {
      await thread.send('**Survival is Strength** — Skipped.');
    } else {
      const dieIdx = parseInt(choice, 10);
      const dice = combat.attackDiceResults;
      if (dice && dieIdx >= 0 && dieIdx < dice.length) {
        const getDiceData = ctx.getDiceData || (() => ({}));
        const diceData = getDiceData();
        const oldDie = dice[dieIdx];
        const color = oldDie.color;
        const faces = diceData?.[color];
        if (faces?.length) {
          const newFace = faces[Math.floor(Math.random() * faces.length)];
          // Update the die result
          dice[dieIdx] = { ...newFace, color };
          // Recalculate attackRoll totals
          combat.attackRoll = { dmg: 0, surge: 0, acc: 0 };
          for (const d of dice) {
            combat.attackRoll.dmg += (d.dmg || 0);
            combat.attackRoll.surge += (d.surge || 0);
            combat.attackRoll.acc += (d.acc || 0);
          }
          await thread.send(`**Survival is Strength** — Rerolled 1 ${color} attack die. New roll: ${newFace.dmg || 0} Hit, ${newFace.surge || 0} Surge, ${newFace.acc || 0} Acc.`);
        }
      }
    }
    combat.survivalResolved = true;
    delete combat.pendingCombatPassive;
    delete combat.survivalFigKey;
    // Survival triggers during token phase — resume there, not in reroll phase
    saveGames();
    await proceedAfterTokens(thread, game, combat, ctx);
    return;
  }

  saveGames();
  await proceedAfterRerolls(thread, game, combat, ctx);
}

/**
 * After rerolls are complete: check dodge, then gate through token windows if eligible tokens exist.
 */
export async function proceedAfterRerolls(thread, game, combat, ctx) {
  const saveGames = ctx.saveGames;

  // Shrewd Scoundrel (Lando): check hit guess after all rerolls
  if (typeof combat.shrewdScoundrelGuess === 'number') {
    const hitCount = combat.attackRoll?.dmg ?? 0;
    const guess = combat.shrewdScoundrelGuess;
    if (hitCount === guess) {
      const ssPlayerNum = combat.attackerPlayerNum; // Lando must be attacker or defender
      // Find which player is Lando
      const getDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const atkSIds = (getDcEff[combat.attackerDcName] || getDcEff[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')])?.specialAbilityIds || [];
      const defDcN = (combat.target?.figureKey || '').replace(/-\d+-\d+$/, '');
      const defSIds = (getDcEff[defDcN] || getDcEff[(defDcN || '').replace(/\s*\[.*\]\s*$/, '')])?.specialAbilityIds || [];
      const landoPN = atkSIds.includes('shrewd_scoundrel_lando') ? combat.attackerPlayerNum : (defSIds.includes('shrewd_scoundrel_lando') ? opponentPlayerNum(combat.attackerPlayerNum) : null);
      if (landoPN) {
        if (landoPN === 1) game.p1VictoryPoints = (game.p1VictoryPoints || 0) + 2;
        else game.p2VictoryPoints = (game.p2VictoryPoints || 0) + 2;
        await thread.send(`**Shrewd Scoundrel** — Guessed ${guess} Hits, rolled ${hitCount} Hits. **Correct! +2 VP!**`);
      }
    } else {
      await thread.send(`**Shrewd Scoundrel** — Guessed ${guess} Hits, rolled ${hitCount} Hits. Incorrect.`);
    }
    delete combat.shrewdScoundrelGuess;
  }

  // Agile (Jet Trooper E/R): while defending, convert 1 Block to 1 Evade
  if (combat.target?.figureKey && !combat.agileJetTrooperApplied) {
    const _agDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _agDefDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const _agDefEff = _agDcEff[_agDefDcName] || _agDcEff[(_agDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const _agDefSIds = _agDefEff?.specialAbilityIds || [];
    if (_agDefSIds.includes('agile_jet_trooper_elite') || _agDefSIds.includes('agile_jet_trooper_reg')) {
      const _agTotalBlock = (combat.defenseRoll?.block || 0) + (combat.bonusBlock || 0);
      if (_agTotalBlock > 0) {
        combat.bonusBlock = (combat.bonusBlock || 0) - 1;
        combat.bonusEvade = (combat.bonusEvade || 0) + 1;
        combat.agileJetTrooperApplied = true;
        await thread.send('**Agile** — Converted 1 Block to 1 Evade.');
      }
    }
  }

  // Defensible (SC2-M): while defending, apply +1 Block or +1 Evade (player chooses)
  if (!combat.defensibleResolved && combat.target?.figureKey) {
    const _defsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _defsDefDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const _defsDefEff = _defsDcEff[_defsDefDcName] || _defsDcEff[(_defsDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_defsDefEff?.specialAbilityIds || []).includes('defensible_sc2m')) {
      combat.pendingCombatPassive = 'defensible';
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_defensible_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Defensible** (${_defsDefDcName}): Apply +1 Block or +1 Evade?`,
        components: [new ActionRowBuilder().addComponents(btns)],
      });
      saveGames?.();
      return;
    }
    combat.defensibleResolved = true;
  }

  // Get Down (Onar Koma): while a SMALL figure within 2 is defending, apply +1 Block or +1 Evade (once/round)
  if (!combat.getDownResolved && combat.target?.figureKey) {
    const _gdDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _gdDefDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const _gdDefEff = _gdDcEff[_gdDefDcName] || _gdDcEff[(_gdDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    // Defender must be SMALL (no LARGE/MASSIVE keyword)
    const _gdDefKws = (_gdDefEff?.keywords || []).map(k => String(k).toUpperCase());
    const _gdIsSmall = !_gdDefKws.includes('LARGE') && !_gdDefKws.includes('MASSIVE');
    if (_gdIsSmall) {
      const defPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
      const friendlyFigs = game.figurePositions?.[defPlayerNum] || {};
      const defCoord = friendlyFigs[combat.target.figureKey];
      const mapSp = getMapSpaces(game.selectedMap?.id);
      let _gdOnarFk = null;
      if (defCoord && mapSp) {
        for (const [fk, pos] of Object.entries(friendlyFigs)) {
          if (fk === combat.target.figureKey) continue;
          const fDcName = fk.replace(/-\d+-\d+$/, '');
          const fEff = _gdDcEff[fDcName] || _gdDcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
          if (!(fEff?.specialAbilityIds || []).includes('get_down_onar')) continue;
          if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 2)) {
            _gdOnarFk = fk;
            break;
          }
        }
      }
      if (_gdOnarFk && !game.roundFigureAbilityUsed?.[`${_gdOnarFk}_get_down`]) {
        combat.pendingCombatPassive = 'get_down';
        combat.getDownFigKey = _gdOnarFk;
        const _gdOnarDcName = _gdOnarFk.replace(/-\d+-\d+$/, '');
        const btns = [
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_block`).setLabel('+1 Block').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_evade`).setLabel('+1 Evade').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_getdown_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
        ];
        await thread.send({
          content: `**Get Down** (${_gdOnarDcName}): Apply +1 Block or +1 Evade to **${_gdDefDcName}**'s defense?`,
          components: [new ActionRowBuilder().addComponents(btns)],
        });
        saveGames?.();
        return;
      }
    }
    combat.getDownResolved = true;
  }

  // Call the Shots (Hera): while a friendly within 3 is attacking, apply +2 Acc, +1 Hit, or +1 Surge (once/round)
  if (!combat.callTheShotsResolved && combat.attackerFigureKey) {
    const _ctsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const atkPlayerNum = combat.attackerPlayerNum;
    const friendlyFigs = game.figurePositions?.[atkPlayerNum] || {};
    const atkCoord = friendlyFigs[combat.attackerFigureKey];
    const mapSp = getMapSpaces(game.selectedMap?.id);
    let _ctsHeraFk = null;
    if (atkCoord && mapSp) {
      for (const [fk, pos] of Object.entries(friendlyFigs)) {
        if (fk === combat.attackerFigureKey) continue; // "another friendly"
        const fDcName = fk.replace(/-\d+-\d+$/, '');
        const fEff = _ctsDcEff[fDcName] || _ctsDcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(fEff?.specialAbilityIds || []).includes('call_the_shots_hera')) continue;
        if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkCoord).toLowerCase(), 3)) {
          _ctsHeraFk = fk;
          break;
        }
      }
    }
    if (_ctsHeraFk && !game.roundFigureAbilityUsed?.[`${_ctsHeraFk}_call_the_shots`]) {
      combat.pendingCombatPassive = 'call_the_shots';
      combat.callTheShotsFigKey = _ctsHeraFk;
      const _ctsHeraDcName = _ctsHeraFk.replace(/-\d+-\d+$/, '');
      const btns = [
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_acc`).setLabel('+2 Accuracy').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_hit`).setLabel('+1 Hit').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_surge`).setLabel('+1 Surge').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_cts_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
      ];
      await thread.send({
        content: `**Call the Shots** (${_ctsHeraDcName}): Apply +2 Accuracy, +1 Hit, or +1 Surge to **${combat.attackerDcName}**'s attack?`,
        components: [new ActionRowBuilder().addComponents(btns)],
      });
      saveGames?.();
      return;
    }
    combat.callTheShotsResolved = true;
  }

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
    const kananPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const strainNote = isFORCE_USER ? '' : ' Kanan suffers 1 Strain.';
    await thread.send(`**Soresu Form** — Dodge converted to +2 Block, +1 Evade.${strainNote}`);
    if (!isFORCE_USER) {
      await applyStrainToFigure(game, kananPlayerNum, combat.soresuFormFigKey, 1, 'Soresu Form', 'Kanan Jarrus', ctx, thread);
    }
    combat.soresuFormFigKey = null;
  }

  // Lucky (R2-D2): while defending, if Dodge rolled, recover 2 damage
  if (combat.defenseRoll.dodge && combat.target?.figureKey) {
    const _luckyDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _luckyDefDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const _luckyDefEff = _luckyDcEff[_luckyDefDcName] || _luckyDcEff[(_luckyDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_luckyDefEff?.specialAbilityIds || []).includes('lucky_r2d2') && ctx.dcHealthState) {
      const _luckyFkMatch = combat.target.figureKey.match(/^(.+)-(\d+)-(\d+)$/);
      if (_luckyFkMatch) {
        const targetMsgId = combat.target.msgId;
        if (targetMsgId) {
          const _luckyFi = parseInt(_luckyFkMatch[3], 10);
          const _luckyDefPn = combat.target.playerNum ?? opponentPlayerNum(combat.attackerPlayerNum);
          const { healed: _luckyHealed, newHp: _lNew } = healHp(ctx.dcHealthState, game, targetMsgId, _luckyFi, 2, _luckyDefPn);
          if (_luckyHealed > 0) {
            const _lPrev = _lNew - _luckyHealed;
            await thread.send(`🍀 **Lucky** — R2-D2 rolled a Dodge! Recovered 2 damage (HP: ${_lPrev}→${_lNew}).`);
          }
        }
      }
    }
  }

  // Dodge check (now AFTER rerolls and Defensive Stance conversion)
  if (combat.defenseRoll.dodge) {
    await thread.send('**DODGE!** The attack misses — all damage and effects negated.');
    await sendReadyToResolveRolls(thread, game.gameId);
    return;
  }

  // Vague and Unconvincing (K-2S0): while defending, neither player can spend power tokens
  let _vagueBlockTokens = false;
  if (combat.target?.figureKey) {
    const _vuDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _vuDefDcName = combat.target.figureKey.replace(/-\d+-\d+$/, '');
    const _vuDefEff = _vuDcEff[_vuDefDcName] || _vuDcEff[(_vuDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_vuDefEff?.specialAbilityIds || []).includes('vague_and_unconvincing_k2s0')) {
      _vagueBlockTokens = true;
      combat.vagueAndUnconvincing = true;
      await thread.send('**Vague and Unconvincing** — Neither player may spend Power Tokens or play Command Cards during this attack.');
    }
  }

  const attackerTokens = getEligibleTokens(game, combat.attackerFigureKey, 'attacker');
  const defenderTokens = getEligibleTokens(game, combat.target.figureKey, 'defender');
  if (!_vagueBlockTokens && attackerTokens.length > 0) {
    combat.tokenPhase = 'attacker';
    await sendTokenWindow(thread, game.gameId, 'attacker', attackerTokens, combat.attackerDisplayName);
    return;
  }
  if (!_vagueBlockTokens && defenderTokens.length > 0) {
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
  const saveGames = ctx.saveGames;

  // Survival is Strength (Armorer): after a friendly within 3 defending spent a Block,
  // Armorer's player may force reroll 1 attack die. Once per round.
  if (!combat.survivalResolved && combat.defenderSpentBlock && combat.target?.figureKey && combat.attackDiceResults?.length > 0) {
    const _sisDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const defPlayerNum = opponentPlayerNum(combat.attackerPlayerNum);
    const friendlyFigs = game.figurePositions?.[defPlayerNum] || {};
    const defCoord = friendlyFigs[combat.target.figureKey];
    const mapSp = getMapSpaces(game.selectedMap?.id);
    let _sisArmorerFk = null;
    if (defCoord && mapSp) {
      for (const [fk, pos] of Object.entries(friendlyFigs)) {
        const fDcName = fk.replace(/-\d+-\d+$/, '');
        const fEff = _sisDcEff[fDcName] || _sisDcEff[fDcName?.replace(/\s*\[.*\]\s*$/, '')];
        if (!(fEff?.specialAbilityIds || []).includes('survival_is_strength_armorer')) continue;
        if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(defCoord).toLowerCase(), 3)) {
          _sisArmorerFk = fk;
          break;
        }
      }
    }
    if (_sisArmorerFk && !game.roundFigureAbilityUsed?.[`${_sisArmorerFk}_survival_is_strength`]) {
      combat.pendingCombatPassive = 'survival';
      combat.survivalFigKey = _sisArmorerFk;
      const _sisArmorerDcName = _sisArmorerFk.replace(/-\d+-\d+$/, '');
      const dice = combat.attackDiceResults;
      const btns = dice.map((d, i) =>
        new ButtonBuilder()
          .setCustomId(`combat_passive_${game.gameId}_survival_${i}`)
          .setLabel(`${d.color} die (${d.dmg || 0}H/${d.surge || 0}S/${d.acc || 0}A)`)
          .setStyle(ButtonStyle.Danger)
      );
      btns.push(
        new ButtonBuilder().setCustomId(`combat_passive_${game.gameId}_survival_skip`).setLabel('Skip').setStyle(ButtonStyle.Secondary)
      );
      // Split into rows of 5 if needed
      const rows = [];
      for (let i = 0; i < btns.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(btns.slice(i, i + 5)));
      }
      await thread.send({
        content: `**Survival is Strength** (${_sisArmorerDcName}): Defender spent a Block token — choose an attack die to force reroll, or skip.`,
        components: rows,
      });
      saveGames?.();
      return;
    }
    combat.survivalResolved = true;
  }

  const { getAttackerSurgeAbilities, SURGE_LABELS } = ctx;
  const getAbility = ctx.getAbility || (() => null);
  const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (SURGE_LABELS && SURGE_LABELS[id]) || id);
  const defRoll = combat.defenseRoll;

  // Evade cancels surge
  const roll = combat.attackRoll;
  const defenseDiceCount = combat.defenseDiceCount ?? 1;
  const attackerPlayerNum = combat.attackerPlayerNum;
  const defPlayerNum = opponentPlayerNum(attackerPlayerNum);
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
    // Krayt Dragon Fury (Tress Hacnua): resolve X in surge labels to actual surge count
    const _kdfXVal = combat.attackRoll?.surge ?? 0;
    const _kdfDcEffL = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _kdfAtkDcNameL = (combat.attackerFigureKey || '').replace(/-\d+-\d+$/, '');
    const _kdfAtkEffL = _kdfDcEffL[_kdfAtkDcNameL] || _kdfDcEffL[(_kdfAtkDcNameL || '').replace(/\s*\[.*\]\s*$/, '')];
    const _kdfHasL = (_kdfAtkEffL?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      let label = (getSurgeLabel(key) || key).slice(0, 80);
      // Substitute X with actual value for Krayt Dragon Fury
      if (_kdfHasL && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXVal));
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId) {
    await interaction.followUp({ content: 'No pending combat to resolve.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!canActAsPlayer(game, interaction.user.id, 1) && !canActAsPlayer(game, interaction.user.id, 2)) {
    await interaction.followUp({ content: 'Only players in this game can confirm.', ephemeral: true }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.surgeRemaining) {
    await interaction.followUp({ content: 'No surge step or already resolved.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const attackerPlayerNum = combat.attackerPlayerNum;
  const effectiveAttackerForSurge = combat.falseOrdersControllerPlayerNum ?? attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttackerForSurge)) {
    await interaction.followUp({ content: 'Only the attacker may spend surge.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const thread = await interaction.client.channels.fetch(combat.combatThreadId);
  // Overload (Rebel Saboteur): may trigger the same surge ability up to twice per attack
  const getDcEffS = ctx.getDcEffects || (() => ({}));
  const atkEffS = getDcEffS()[combat.attackerDcName] || getDcEffS()[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
  const overloadActive = (atkEffS?.specialAbilityIds || []).includes('overload_saboteur');
  if (choice === 'bleed_prevention') {
    combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - 1);
    combat.surgePreventBleed = true;
    await thread.send('Spent 1 surge — Bleeding will be prevented this activation.').catch(discordCatch);
  } else if (choice !== 'done') {
    // Disable: disabled figures cannot use Surge abilities
    if (game.disabledFigures?.includes(combat.attackerDisplayName)) {
      await thread.send(`**${combat.attackerDisplayName}** is Disabled — cannot use Surge abilities this round.`).catch(discordCatch);
      await interaction.deferUpdate().catch(() => {});
      return;
    }
    const idx = parseInt(choice, 10);
    const surgeAbilities = getAttackerSurgeAbilities(combat);
    const key = surgeAbilities[idx];
    if (key) {
      // Overload: check if this surge has already been used the max number of times
      const maxUses = overloadActive ? 2 : 1;
      const usedCount = (combat.surgeSpentCount || {})[idx] || 0;
      if (usedCount >= maxUses) {
        await interaction.deferUpdate().catch(() => {});
        return;
      }
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      const mod = resolveSurge(key);
      combat.surgeDamage = (combat.surgeDamage || 0) + (mod.damage ?? 0);
      combat.surgePierce = (combat.surgePierce || 0) + (mod.pierce ?? 0);
      combat.surgeAccuracy = (combat.surgeAccuracy || 0) + (mod.accuracy ?? 0);
      if (mod.conditions?.length) combat.surgeConditions = (combat.surgeConditions || []).concat(mod.conditions);
      combat.surgeBlast = (combat.surgeBlast || 0) + (mod.blast ?? 0);
      combat.surgeRecover = (combat.surgeRecover || 0) + (mod.recover ?? 0);
      combat.surgeCleave = (combat.surgeCleave || 0) + (mod.cleave ?? 0);
      // Cancel: remove N block results from defender (like Pierce but applied to results)
      if (mod.surgeCancel) combat.surgeCancel = (combat.surgeCancel || 0) + mod.surgeCancel;
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
      if (mod.surgeAgitate) combat.surgeAgitate = true;
      if (mod.surgeFellSwoop) combat.surgeFellSwoop = true;
      if (mod.surgeMastery) combat.surgeMastery = true;
      if (mod.surgeInterrogate) combat.surgeInterrogate = true;
      // Autofire chain attack: mark pending so applyDamageAndFinishCombat grants free attack
      if (key === 'autofire_chain') {
        const _afTargetPos = game.figurePositions?.[combat.defenderPlayerNum]?.[combat.targetFigureKey];
        combat.autofireChainPending = true;
        combat.autofireChainTargetSpace = _afTargetPos || null;
        combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - 1);
        await thread.send('**Autofire** — Chain attack queued! After this attack resolves, perform another attack targeting within 3 of the target space.').catch(() => {});
      }
      // Utinni! (Jawa Scavenger): spending this surge earns 1 VP
      if (key === 'utinni_vp_1') {
        awardObjectiveVp(game, attackerPlayerNum, 1);
        combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - 1);
        const _utinniVpKey = vpKey(attackerPlayerNum);
        await thread.send(`**Utinni!** — +1 VP earned (${game[_utinniVpKey].total} total).`).catch(discordCatch);
        if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Utinni!** — Jawa Scavenger earned +1 VP.`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
      // Gain VP (Senator/Streetrat form surge): spending this surge earns N VP
      if (mod.surgeVpGain && mod.surgeVpGain > 0) {
        awardObjectiveVp(game, attackerPlayerNum, mod.surgeVpGain);
        const _gvpKey = vpKey(attackerPlayerNum);
        await thread.send(`**+${mod.surgeVpGain} VP** earned (${game[_gvpKey].total} total).`).catch(discordCatch);
        if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Surge: +${mod.surgeVpGain} VP** (${game[_gvpKey].total} total).`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
      }
      // Bargain (Jawa Scavenger Elite): inline VP exchange during surge phase
      if (mod.surgeBargain) {
        const _bargainVpKey = vpKey(attackerPlayerNum);
        game[_bargainVpKey] = game[_bargainVpKey] || { total: 0, kills: 0, objectives: 0 };
        const vp = game[_bargainVpKey];
        if ((vp.total || 0) >= 1) {
          vp.total -= 1;
          if ((vp.objectives || 0) > 0) vp.objectives -= 1;
          else vp.kills = Math.max(0, (vp.kills || 0) - 1);
          const rollFn = ctx.rollSingleAttackDie;
          const bargainDie = rollFn ? rollFn('green') : { dmg: 0, surge: 0 };
          const gained = bargainDie.dmg || 0;
          if (gained > 0) { vp.total += gained; vp.objectives += gained; }
          const net = gained - 1;
          await thread.send(`**Bargain** — Spent 1 VP, rolled green die (${bargainDie.dmg ?? 0}dmg): gained **${gained} VP** (net ${net >= 0 ? '+' : ''}${net}).`).catch(discordCatch);
          if (ctx.logGameAction && ctx.client) await ctx.logGameAction(game, ctx.client, `**Bargain** — Spent 1 VP, gained ${gained} VP (net ${net >= 0 ? '+' : ''}${net})`, { phase: 'ROUND', icon: 'card' }).catch(() => {});
        } else {
          await thread.send('**Bargain** — No VP available to spend; ability has no effect.').catch(discordCatch);
        }
      }
      // Self-condition surges: apply condition to attacker's own figure
      if (mod.surgeSelfFocus && combat.attackerFigureKey) {
        applyCondition(game, combat.attackerFigureKey, 'Focus');
      }
      if (mod.surgeSelfHide && combat.attackerFigureKey) {
        applyCondition(game, combat.attackerFigureKey, 'Hide');
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
        // Krayt Dragon Fury (Tress Hacnua): X = number of Surge rolled on the attack dice
        const _kdfDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
        const _kdfAtkDcName = (combat.attackerFigureKey || '').replace(/-\d+-\d+$/, '');
        const _kdfAtkEff = _kdfDcEff[_kdfAtkDcName] || _kdfDcEff[(_kdfAtkDcName || '').replace(/\s*\[.*\]\s*$/, '')];
        const _kdfHas = (_kdfAtkEff?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
        if (_kdfHas) {
          const _kdfX = combat.attackRoll?.surge ?? 0;
          if (mod.surgeComplex === 'cleave x') {
            combat.surgeCleave = (combat.surgeCleave || 0) + _kdfX;
            await thread.send(`**Krayt Dragon Fury** — Cleave ${_kdfX} (${_kdfX} Surge rolled).`).catch(discordCatch);
          } else if (mod.surgeComplex === 'recover x') {
            combat.surgeRecover = (combat.surgeRecover || 0) + _kdfX;
            await thread.send(`**Krayt Dragon Fury** — Recover ${_kdfX} (${_kdfX} Surge rolled).`).catch(discordCatch);
          }
        } else {
          const cThread = await interaction.client.channels.fetch(combat.combatThreadId);
          await cThread.send(`⚠️ **${getSurgeLabel(key)}** — resolve manually (see ability text).`).catch(discordCatch);
        }
      }
      combat.surgeRemaining = Math.max(0, (combat.surgeRemaining || 0) - cost);
      // Track how many times each surge index has been spent (for Overload)
      if (!combat.surgeSpentCount) combat.surgeSpentCount = {};
      combat.surgeSpentCount[idx] = (combat.surgeSpentCount[idx] || 0) + 1;
      const label = getSurgeLabel(key);
      await thread.send(`**Surge spent (${cost}):** ${label}`).catch(discordCatch);
      // Hunter Protocol: offer to trigger the same surge ability once more
      if (game.surgeDoublingActive?.[attackerPlayerNum] && key && !combat.surgeDoubledAbility && !key.startsWith('double:') && key !== 'utinni_vp_1') {
        if ((combat.surgeRemaining || 0) >= cost) {
          combat.surgeDoubledAbility = key;
          game.pendingHunterProtocol = { key, cost };
          const _hpRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`hunter_protocol_trigger_${gameId}`).setLabel(`Trigger again: ${label}`.slice(0, 80)).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`hunter_protocol_skip_${gameId}`).setLabel('Skip').setStyle(ButtonStyle.Secondary),
          );
          await thread.send({ content: `**Hunter Protocol** — Trigger **${label}** once more?`, components: [_hpRow] }).catch(discordCatch);
          saveGames();
          return;
        }
      }
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
        }).catch(discordCatch);
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
    const maxSurgeUses = overloadActive ? 2 : 1;
    // Krayt Dragon Fury: resolve X in labels
    const _kdfXValR = combat.attackRoll?.surge ?? 0;
    const _kdfDcEffR = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _kdfAtkDcNameR = (combat.attackerFigureKey || '').replace(/-\d+-\d+$/, '');
    const _kdfAtkEffR = _kdfDcEffR[_kdfAtkDcNameR] || _kdfDcEffR[(_kdfAtkDcNameR || '').replace(/\s*\[.*\]\s*$/, '')];
    const _kdfHasR = (_kdfAtkEffR?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const key = surgeAbilities[i];
      const cost = (key?.startsWith?.('double:') ? 2 : (getAbility(key)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      // Skip surges that have been used the max number of times
      if (((combat.surgeSpentCount || {})[i] || 0) >= maxSurgeUses) continue;
      let label = (getSurgeLabel(key) || key).slice(0, 80);
      if (_kdfHasR && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXValR));
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
  const { getGame, replyIfGameEnded, saveGames, logGameAction } = ctx;
  // Match both att/def (spend/skip) and wild (type resolution) patterns
  const m = interaction.customId.match(/^combat_token_([^_]+)_(att|def|wild)_(.+)$/);
  if (!m) return;
  const [, gameId, role, choice] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
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
    logGameAction?.(game, interaction.client, `🎯 **Power Token spent** — ${combat.pendingWildRole === 'attacker' ? 'Attacker' : 'Defender'}: Wild → +1 ${resolvedType}`, { phase: 'ROUND', icon: 'attack' });
    // Track defender modifications for Quick Strike (Electrostaff loadout)
    if (combat.pendingWildRole === 'defender') combat.defenderRerolledOrModified = true;
    // Track Block spending for Mandalorian Steel / Personal Combat Shield
    if (combat.pendingWildRole === 'defender' && resolvedType === 'Block') {
      combat.defenderSpentBlock = true;
      const _pcsWDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
      const _pcsWDefDcName = (combat.target?.figureKey || '').replace(/-\d+-\d+$/, '');
      const _pcsWDefEff = _pcsWDcEff[_pcsWDefDcName] || _pcsWDcEff[(_pcsWDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      if ((_pcsWDefEff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
        combat.bonusEvade = (combat.bonusEvade || 0) + 1;
        await thread.send('**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.');
      }
    }
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
  const playerNum = isAttacker ? atkPlayerNum : opponentPlayerNum(combat.attackerPlayerNum);
  if (!canActAsPlayer(game, interaction.user.id, playerNum)) {
    await interaction.followUp({ content: 'Only the correct player may spend their token.', ephemeral: true }).catch(discordCatch);
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
  logGameAction?.(game, interaction.client, `🎯 **Power Token spent** — ${isAttacker ? 'Attacker' : 'Defender'}: +1 ${tokenType}`, { phase: 'ROUND', icon: 'attack' });
  // Track defender modifications for Quick Strike (Electrostaff loadout)
  if (!isAttacker) combat.defenderRerolledOrModified = true;
  // Track Block token spending for Mandalorian Steel
  if (!isAttacker && tokenType === 'Block') combat.defenderSpentBlock = true;
  // Personal Combat Shield (Gar Saxon): when spending a Block token while defending, +1 Evade
  if (!isAttacker && tokenType === 'Block') {
    const _pcsDcEff = ctx.getDcEffects ? ctx.getDcEffects() : {};
    const _pcsDefDcName = (combat.target?.figureKey || '').replace(/-\d+-\d+$/, '');
    const _pcsDefEff = _pcsDcEff[_pcsDefDcName] || _pcsDcEff[(_pcsDefDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((_pcsDefEff?.specialAbilityIds || []).includes('personal_combat_shield_gar_saxon')) {
      combat.bonusEvade = (combat.bonusEvade || 0) + 1;
      await thread.send('**Personal Combat Shield** — Gar Saxon spent a Block token: +1 Evade.');
    }
  }
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const pending = game.pendingCleave;
  if (!pending || pending.gameId !== gameId) {
    await interaction.followUp({ content: 'No cleave target selection in progress.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (interaction.user.id !== pending.ownerId) {
    await interaction.followUp({ content: 'Only the attacker may choose the cleave target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const targetIndex = parseInt(indexStr, 10);
  const target = pending.targets[targetIndex];
  if (!target) {
    await interaction.followUp({ content: 'Invalid target.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { figureKey: cleaveFigureKey, playerNum: cleavePlayerNum } = target;
  const attackerPlayerNum = pending.attackerPlayerNum;
  const ownerId = pending.ownerId;
  const cleaveMsgId = findDcMessageIdForFigure(game.gameId, cleavePlayerNum, cleaveFigureKey);
  if (cleaveMsgId) {
    const cleaveM = cleaveFigureKey.match(/-(\d+)-(\d+)$/);
    const cleaveFigIndex = cleaveM ? parseInt(cleaveM[2], 10) : 0;
    const cleaveDmg = pending.surgeCleave || 0;
    const { newHp: newCCur, wasDefeated: cleaveDefeated } = reduceHp(dcHealthState, game, cleaveMsgId, cleaveFigIndex, cleaveDmg, cleavePlayerNum);
    {
      const cleaveDcIds = getDcMessageIds(game, cleavePlayerNum);
      const cleaveDcList = getDcList(game, cleavePlayerNum);
      const cleaveIdx = (cleaveDcIds || []).indexOf(cleaveMsgId);
      const cleaveLabel = target.label || cleaveDcList?.[cleaveIdx]?.displayName || cleaveFigureKey;
      await logGameAction(game, client, `Cleave: <@${ownerId}> dealt **${pending.surgeCleave}** damage to **${cleaveLabel}**`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
      if (newCCur <= 0) {
        if (game.figurePositions?.[cleavePlayerNum]) delete game.figurePositions[cleavePlayerNum][cleaveFigureKey];
        const cleaveStats = getDcStats(cleaveDcList[cleaveIdx]?.dcName);
        const cost = cleaveStats?.cost ?? 5;
        const figures = cleaveStats?.figures ?? 1;
        const subCost = getDcEffects()[cleaveDcList[cleaveIdx]?.dcName]?.subCost;
        const vp = (figures > 1 && subCost != null) ? subCost : cost;
        awardKillVp(game, attackerPlayerNum, vp);
        await logGameAction(game, client, `Cleave: <@${ownerId}> defeated **${cleaveLabel}** (+${vp} VP)`, { allowedMentions: { users: [ownerId] }, phase: 'ROUND', icon: 'attack' });
        if (cleaveIdx >= 0 && isGroupDefeated(game, cleavePlayerNum, cleaveIdx)) {
          const activatedIndices = getActivatedDcIndices(game, cleavePlayerNum) || [];
          if (!activatedIndices.includes(cleaveIdx)) {
            setActivationsRemaining(game, cleavePlayerNum, Math.max(0, (getActivationsRemaining(game, cleavePlayerNum) ?? 0) - 1));
            await updateActivationsMessage(game, cleavePlayerNum, client);
          }
          const cleaveCcAttachKey = ccAttachmentsKey(cleavePlayerNum);
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
    await interaction.message.edit({ components: [] }).catch(discordCatch);
  } catch {}
  const embedRefreshMsgIds = new Set(pending.initialEmbedRefreshMsgIds || []);
  if (cleaveMsgId) embedRefreshMsgIds.add(cleaveMsgId);
  delete game.pendingCleave;
  const { checkPostCombatSurges } = ctx;
  if (checkPostCombatSurges) {
    const defPN = opponentPlayerNum(pending.attackerPlayerNum);
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
  const { getGame, saveGames } = ctx;
  const match = interaction.customId.match(/^power_token_choice_([^_]+)_(hit|surge|block|evade)$/);
  if (!match) { await interaction.followUp({ content: 'Invalid token choice.', ephemeral: true }).catch(() => {}); return; }
  const [, gameId, typeRaw] = match;
  const type = typeRaw[0].toUpperCase() + typeRaw.slice(1); // 'Hit', 'Surge', 'Block', 'Evade'
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingPowerTokenGrant?.grants?.length) { await interaction.followUp({ content: 'No pending token grant found.', ephemeral: true }).catch(() => {}); return; }
  const { grants, channelId, playerNum } = game.pendingPowerTokenGrant;
  if (playerNum && !canActAsPlayer(game, interaction.user.id, playerNum)) { await interaction.followUp({ content: 'Not your token choice.', ephemeral: true }).catch(() => {}); return; }
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
    if (ch) await ch.send(`**Power Token(s) granted:** ${lines.join(', ')}`).catch(discordCatch);
  }
  // If we're mid-surge and there are still surges remaining, continue the surge flow
  const combat = game.pendingCombat;
  if (combat?.surgeRemaining > 0 && channelId) {
    const thread = await interaction.client.channels.fetch(channelId).catch(() => null);
    if (thread) {
      const surgeAbilities = ctx.getAttackerSurgeAbilities ? ctx.getAttackerSurgeAbilities(combat) : [];
      const getSurgeLabel = ctx.getSurgeAbilityLabel || ((id) => (ctx.SURGE_LABELS?.[id]) || id);
      const remaining = combat.surgeRemaining || 0;
      // Overload (Rebel Saboteur): allow same surge to be used twice
      const _ptAtkEff = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      const _ptMaxUses = (_ptAtkEff?.specialAbilityIds || []).includes('overload_saboteur') ? 2 : 1;
      // Krayt Dragon Fury: resolve X in labels
      const _kdfXValPT = combat.attackRoll?.surge ?? 0;
      const _kdfAtkEffPT = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
      const _kdfHasPT = (_kdfAtkEffPT?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
      const surgeRows = [];
      for (let i = 0; i < surgeAbilities.length; i++) {
        const k = surgeAbilities[i];
        const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
        if (cost > remaining) continue;
        if (((combat.surgeSpentCount || {})[i] || 0) >= _ptMaxUses) continue;
        let label = (getSurgeLabel(k) || k).slice(0, 80);
        if (_kdfHasPT && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXValPT));
        const btnLabel = cost > 1 ? `Spend ${cost} surge: ${label}` : `Spend 1 surge: ${label}`;
        surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_${i}`).setLabel(btnLabel.slice(0, 80)).setStyle(ButtonStyle.Secondary));
      }
      surgeRows.push(new ButtonBuilder().setCustomId(`combat_surge_${gameId}_done`).setLabel('Done (no more surge)').setStyle(ButtonStyle.Primary));
      const surgeRow = new ActionRowBuilder().addComponents(surgeRows.slice(0, 5));
      await thread.send({ content: `**Spend surge?** **${remaining}** surge left. Choose an ability or Done.`, components: [surgeRow] }).catch(discordCatch);
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
  if (!m) { await interaction.followUp({ content: 'Invalid condition choice.', ephemeral: true }).catch(() => {}); return; }
  const [, gameId, condRaw] = m;
  const game = await requireGame(interaction, getGame, gameId, { silent: true });
  if (!game) return;
  if (!game.pendingSpreadThePainCondPick) { await interaction.followUp({ content: 'No pending condition pick.', ephemeral: true }).catch(() => {}); return; }
  const { attackerPlayerNum, combatThreadId } = game.pendingSpreadThePainCondPick;
  if (!canActAsPlayer(game, interaction.user.id, attackerPlayerNum)) { await interaction.followUp({ content: 'Not your choice.', ephemeral: true }).catch(() => {}); return; }
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
    // Overload (Rebel Saboteur): allow same surge to be used twice
    const _spAtkEff = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const _spMaxUses = (_spAtkEff?.specialAbilityIds || []).includes('overload_saboteur') ? 2 : 1;
    // Krayt Dragon Fury: resolve X in labels
    const _kdfXValSP = combat.attackRoll?.surge ?? 0;
    const _kdfAtkEffSP = getDcEffectsGlobal()?.[combat.attackerDcName] || getDcEffectsGlobal()?.[(combat.attackerDcName || '').replace(/\s*\[.*\]\s*$/, '')];
    const _kdfHasSP = (_kdfAtkEffSP?.specialAbilityIds || []).includes('krayt_dragon_fury_tress');
    const surgeRows = [];
    for (let i = 0; i < surgeAbilities.length; i++) {
      const k = surgeAbilities[i];
      const cost = (k?.startsWith?.('double:') ? 2 : (ctx.getAbility?.(k)?.surgeCost ?? 1));
      if (cost > remaining) continue;
      if (((combat.surgeSpentCount || {})[i] || 0) >= _spMaxUses) continue;
      let label = (getSurgeLabel(k) || k).slice(0, 80);
      if (_kdfHasSP && /\bx\b/i.test(label)) label = label.replace(/\bX\b/gi, String(_kdfXValSP));
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
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
    if (fhMsgId && fhFigKey && dcHealthState) {
      const { newHp: fhNew, prevHp: fhPrev, maxHp: fhMaxHp } = reduceHp(dcHealthState, game, fhMsgId, fhFigIndex, fhDamage, defenderPlayerNum);
      if (fhMaxHp > 0) {
        fhResultText = `**Figurehead** — ${fhLabel || 'Murne Rin'} suffers **${fhDamage} damage** (${fhPrev} — ${fhNew} HP); ${combat.target.label} suffers 0.`;
        if (fhNew <= 0) {
          // Murne Rin defeated
          if (game.figurePositions?.[defenderPlayerNum]) delete game.figurePositions[defenderPlayerNum][fhFigKey];
          if (game.figureConditions?.[fhFigKey]) delete game.figureConditions[fhFigKey];
          const fhDcName = fhFigKey.replace(/-\d+-\d+$/, '');
          const fhStats = getDcStats?.(fhDcName);
          const fhEff = getDcEffects?.()?.[fhDcName];
          const fhFigures = fhStats?.figures ?? 1;
          const fhVp = (fhFigures > 1 && fhEff?.subCost != null) ? fhEff.subCost : (fhStats?.cost ?? 4);
          awardKillVp(game, attackerPlayerNum, fhVp);
          fhResultText += ` — **${fhLabel || 'Murne Rin'} defeated!** +${fhVp} VP`;
          if (logGameAction) await logGameAction(game, client, `**Figurehead** — ${fhLabel || 'Murne Rin'} was defeated! +${fhVp} VP`, { phase: 'ROUND', icon: 'attack' });
          const fhDcIds = getDcMessageIds(game, defenderPlayerNum);
          const fhIdx = (fhDcIds || []).indexOf(fhMsgId);
          if (fhIdx >= 0 && isGroupDefeated?.(game, defenderPlayerNum, fhIdx)) {
            const fhActivated = getActivatedDcIndices(game, defenderPlayerNum) || [];
            if (!fhActivated.includes(fhIdx)) {
              setActivationsRemaining(game, defenderPlayerNum, Math.max(0, (getActivationsRemaining(game, defenderPlayerNum) ?? 0) - 1));
              if (updateActivationsMessage) await updateActivationsMessage(game, defenderPlayerNum, client);
            }
            const fhCcAttachKey = ccAttachmentsKey(defenderPlayerNum);
            if (game[fhCcAttachKey]?.[fhMsgId]?.length) {
              delete game[fhCcAttachKey][fhMsgId];
              if (updateAttachmentMessageForDc) await updateAttachmentMessageForDc(game, defenderPlayerNum, fhMsgId, client);
            }
          }
          await checkWinConditions?.(game, client);
          const fhAtkerOwnerId = getPlayerId(game, attackerPlayerNum);
          if (!game.pendingCelebration && isDcUnique?.(fhDcName)) {
            game.pendingCelebration = { attackerPlayerNum, combatThreadId: combat.combatThreadId };
            await thread.send({
              content: `<@${fhAtkerOwnerId}> — You defeated a unique figure (Figurehead). Play **Celebration** to gain 4 VP?`,
              components: [getCelebrationButtons(game.gameId)],
              allowedMentions: { users: [fhAtkerOwnerId] },
            }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat die choice active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttacker)) {
    await interaction.followUp({ content: 'Only the attacker may choose.', ephemeral: true }).catch(discordCatch);
    return;
  }
  if (!(combat.lasatEligibleDiceIndices || []).includes(dieIdx)) {
    await interaction.followUp({ content: 'That die is not eligible.', ephemeral: true }).catch(discordCatch);
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const combat = game.pendingCombat;
  if (!combat || combat.gameId !== gameId || !combat.lasatHonorGuardPhase) {
    await interaction.followUp({ content: 'No Lasat face choice active.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const effectiveAttacker = combat.falseOrdersControllerPlayerNum ?? combat.attackerPlayerNum;
  if (!canActAsPlayer(game, interaction.user.id, effectiveAttacker)) {
    await interaction.followUp({ content: 'Only the attacker may choose.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const getDiceData = ctx.getDiceData;
  if (!getDiceData) { await interaction.followUp({ content: 'Dice data unavailable.', ephemeral: true }).catch(discordCatch); return; }
  const die = combat.attackDiceResults?.[dieIdx];
  if (!die) { await interaction.followUp({ content: 'Die not found.', ephemeral: true }).catch(discordCatch); return; }
  const faces = getDiceData().attack?.[die.color] || [];
  const newFace = faces[faceIdx];
  if (!newFace) { await interaction.followUp({ content: 'Invalid face selection.', ephemeral: true }).catch(discordCatch); return; }
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
  const game = await requireGame(interaction, getGame, gameId);
  if (!game) return;
  if (await replyIfGameEnded(game, interaction)) return;
  const fo = game.pendingFalseOrders;
  if (!fo || fo.murneRinMsgId !== msgId) {
    await interaction.followUp({ content: 'No pending False Orders.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const { controllerPlayerNum, controlledFigureKey, controlledPlayerNum } = fo;
  if (!canActAsPlayer(game, interaction.user.id, controllerPlayerNum)) {
    await interaction.followUp({ content: 'Only the controller may choose.', ephemeral: true }).catch(discordCatch);
    return;
  }
  const targets = game.falseOrdersAttackTargets?.[msgId];
  const target = targets?.[targetIdx];
  if (!target) {
    await interaction.followUp({ content: 'Target no longer valid.', ephemeral: true }).catch(discordCatch);
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
  const defenderPlayerNum = opponentPlayerNum(controlledPlayerNum);
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
  await interaction.message.edit({ content: '**False Orders — Attack declared**. See thread in Game Log.', components: [] }).catch(discordCatch);
  if (logGameAction) await logGameAction(game, client, `⚔️ **False Orders** — P${controllerPlayerNum} controlling **${controlledName}** attacks **${targetDcName}**.`, { phase: 'ROUND', icon: 'attack' }).catch(() => {});
  saveGames();
}
