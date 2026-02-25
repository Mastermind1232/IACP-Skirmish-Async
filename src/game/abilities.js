/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary, getDcEffects, getDiceData, getCcEffect, getMapSpaces, getMapTokensData } from '../data-loader.js';
import { parseCoord } from './coords.js';

/** Look up DC stats by name (handles display variants). */
function getStatsForDc(dcName) {
  const map = getDcEffects() || {};
  const base = (dcName || '').replace(/\s*\[.*\]\s*$/, '').trim();
  return map[base] || map[dcName] || (() => {
    const key = Object.keys(map).find((k) => k.toLowerCase() === (base || dcName || '').toLowerCase());
    return key ? map[key] : {};
  })();
}
import { parseSurgeEffect } from './combat.js';
import { getFiguresAdjacentToTarget, getBoardStateForMovement, getMovementProfile, getReachableSpaces } from './movement.js';

/** Get ability metadata by id. Returns { type, surgeCost?, label?, ... } or null. */
export function getAbility(id) {
  const lib = getAbilityLibrary();
  return (lib?.abilities && lib.abilities[id]) || null;
}

/**
 * Resolve a surge ability id (same as key in dc-effects surgeAbilities) to modifiers.
 * Code-per-ability: surge effects are resolved via parseSurgeEffect (combat).
 * @param {string} abilityId - e.g. "damage 1", "pierce 2", "damage 1, stun"
 * @returns {{ damage: number, pierce: number, accuracy: number, conditions: string[] }}
 */
export function resolveSurgeAbility(abilityId) {
  return parseSurgeEffect(abilityId);
}

/**
 * Display label for a surge ability. Uses ability library when present, else raw id (for composites not in library).
 * @param {string} abilityId
 * @returns {string}
 */
export function getSurgeAbilityLabel(abilityId) {
  const entry = getAbility(abilityId);
  if (entry?.label) return entry.label;
  // Strip double-surge prefix for display
  return String(abilityId || '').replace(/^double:/, '');
}

/**
 * Draw N command cards from deck to hand.
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {number} n - Number of cards to draw
 * @returns {string[]} - Cards drawn (may be fewer if deck has fewer than n cards)
 */
function drawCcCards(game, playerNum, n) {
  const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
  const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
  const deck = (game[deckKey] || []).slice();
  const hand = (game[handKey] || []).slice();
  const drew = [];
  for (let i = 0; i < n && deck.length > 0; i++) {
    const card = deck.shift();
    hand.push(card);
    drew.push(card);
  }
  game[deckKey] = deck;
  game[handKey] = hand;
  return drew;
}

/**
 * F3/F4: Resolve a non-surge ability by id (DC special or CC effect). Code-per-ability; most return manual.
 * @param {string|null|undefined} abilityId - Library id or synthetic key (e.g. dc_special:DCName:0 or CC card name).
 * @param {object} context - { game, ... } plus optional msgId, meta, playerNum, cardName, specialLabel.
 * @returns {{ applied: boolean, manualMessage?: string, drewCards?: string[], freeAction?: boolean, grantsAction?: boolean, requiresSpaceChoice?: boolean, validSpaces?: string[] }}
 *   freeAction: true — ability costs no action; the caller will restore the action point that was decremented.
 */
export function resolveAbility(abilityId, context) {
  let entry = abilityId ? getAbility(abilityId) : null;
  if (!entry || entry.type === 'surge') {
    return { applied: false, manualMessage: 'Resolve manually (see rules).' };
  }

  // ccEffect: chooseOne — player must pick one option; when choiceIndex is provided, resolve that option
  if (entry.type === 'ccEffect' && Array.isArray(entry.chooseOne) && entry.chooseOne.length > 0) {
    const choiceIndex = context.choiceIndex;
    if (choiceIndex == null || choiceIndex < 0 || choiceIndex >= entry.chooseOne.length) {
      const choiceOptions = entry.chooseOne.map((o, i) => o.label || `Option ${i + 1}`);
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions,
        choiceCount: entry.chooseOne.length,
        manualMessage: `Choose one: ${choiceOptions.join(', ')}.`,
      };
    }
    const chosen = entry.chooseOne[choiceIndex];
    entry = { type: 'ccEffect', ...chosen };
  }

  // ccEffect: informational / log-only (e.g. Collect Intel — look at opponent hand)
  if (entry.type === 'ccEffect' && entry.informational && (entry.logMessage != null || entry.label)) {
    return {
      applied: true,
      logMessage: entry.logMessage || entry.label || 'Resolve manually (see rules).',
    };
  }

  // dcSpecial: chooseOne — player picks an option (e.g. Dual-Bladed Fury); resolve chosen option on second call
  if (entry.type === 'dcSpecial' && Array.isArray(entry.chooseOne) && entry.chooseOne.length > 0) {
    const choiceIndex = context.choiceIndex;
    if (choiceIndex == null || choiceIndex < 0 || choiceIndex >= entry.chooseOne.length) {
      const choiceOptions = entry.chooseOne.map((o, i) => o.label || `Option ${i + 1}`);
      return { applied: false, requiresChoice: true, choiceOptions, choiceCount: entry.chooseOne.length };
    }
    // Second call: resolve chosen sub-entry
    const chosen = entry.chooseOne[choiceIndex];
    // Apply Focus to self
    const { game, msgId, meta, playerNum } = context;
    const parts = [];
    if (chosen.applyFocusToSelf && game && meta) {
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      game.figureConditions = game.figureConditions || {};
      for (const fk of figureKeys) {
        const existing = game.figureConditions[fk] || [];
        if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
      }
      parts.push('Became **Focused**');
    }
    // Grant bonus cleave for next attack via surge
    if (typeof chosen.nextAttackCleave === 'number' && chosen.nextAttackCleave > 0 && game && playerNum) {
      game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
      const existing = game.nextAttackBonusSurgeAbilities[playerNum] || [];
      game.nextAttackBonusSurgeAbilities[playerNum] = [...existing, `cleave ${chosen.nextAttackCleave}`];
    }
    // Grant Reach for next attack (melee range extended to 2, honor system for diagonal)
    if (chosen.nextAttackReach && game && playerNum) {
      game.nextAttackReach = game.nextAttackReach || {};
      game.nextAttackReach[playerNum] = true;
    }
    if (chosen.nextAttackReach || chosen.nextAttackCleave) parts.push(`Next attack gains **${chosen.nextAttackReach ? 'Reach + ' : ''}Cleave ${chosen.nextAttackCleave || 0}** (attack targets up to 2 spaces away if Reach)`);
    return { applied: true, logMessage: `**${entry.label}**: ${parts.join(' and ')}.`, refreshDcEmbed: !!chosen.applyFocusToSelf };
  }

  // dcSpecial: shuffleOneDiscardToDeck (Military Efficiency) — after attack, shuffle 1 CC from discard back to deck
  if (entry.type === 'dcSpecial' && entry.shuffleOneDiscardToDeck) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const discard = game[discardKey] || [];
    if (discard.length === 0) return { applied: true, logMessage: '**Military Efficiency** — No cards in discard to return.' };
    // Shuffle the most-recently-discarded card back (player chooses in practice — honour system for which card)
    const toReturn = discard[discard.length - 1];
    const newDiscard = discard.slice(0, -1);
    const deck = [...(game[deckKey] || [])];
    const insertIdx = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(insertIdx, 0, toReturn);
    game[discardKey] = newDiscard;
    game[deckKey] = deck;
    return { applied: true, logMessage: `**Military Efficiency** — **${toReturn}** shuffled from discard back into your Command deck. (Honour system: choose which card to return — bot uses most-recently-discarded.)`, refreshDiscard: true };
  }

  // dcSpecial: pushTargetWithinRange (Force Throw, Wrist Cord) — pick a SMALL enemy, then pick landing space, then push.
  // Phase 1 (no targetFigureKey): enumerate valid SMALL enemies → requiresChoice.
  // Phase 2 (targetFigureKey set, no chosenSpace): enumerate valid landing spaces → requiresSpaceChoice.
  // Phase 3 (targetFigureKey + chosenSpace set): apply position update.
  if (entry.type === 'dcSpecial' && entry.pushTargetWithinRange && typeof entry.pushTargetWithinRange === 'object') {
    const { range = 3, requiresSmall = false, requiresLos = false } = entry.pushTargetWithinRange;
    const { mustAdjacentToActivator = false, maxDistanceFromTarget } = entry.pushLandingEffect || {};
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSight: losCheck, getRange: getRng, getMapSpaces: getMs, targetFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
    const enemyNum = playerNum === 1 ? 2 : 1;
    const label = entry.label || 'Push';

    // Phase 3: apply push to chosen space
    if (targetFigureKey && chosenSpace) {
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[enemyNum] = game.figurePositions[enemyNum] || {};
      const prevPos = game.figurePositions[enemyNum][targetFigureKey];
      game.figurePositions[enemyNum][targetFigureKey] = chosenSpace;
      // Deduct MP cost if applicable
      if (entry.mpCostToActivate && game.movementBank?.[msgId]) {
        game.movementBank[msgId].remaining = Math.max(0, game.movementBank[msgId].remaining - entry.mpCostToActivate);
      }
      const dcDisplay = meta?.displayName || meta?.dcName || label;
      const targetName = targetFigureKey.replace(/-\d+-\d+$/, '');
      return {
        applied: true,
        logMessage: `**${label}** — **${dcDisplay}** pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} to ${String(chosenSpace).toUpperCase()}.`,
        refreshBoard: true,
        refreshMovementBank: !!entry.mpCostToActivate,
        activeMsgId: msgId,
      };
    }

    // Phase 2: target chosen — enumerate valid landing spaces
    if (targetFigureKey && !chosenSpace) {
      const targetPos = game.figurePositions?.[enemyNum]?.[targetFigureKey];
      if (!targetPos) return { applied: false, manualMessage: `**${label}** — target figure has no position.` };
      const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      const attackerKey = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
      const attackerPos = attackerKey ? game.figurePositions?.[playerNum]?.[attackerKey] : null;
      const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
      if (!mapSpaces) return { applied: false, manualMessage: `**${label}** — map data not available. Resolve manually.` };
      // All occupied positions except the target (it can vacate its own space)
      const occupiedSet = new Set([
        ...Object.values(game.figurePositions?.[1] || {}),
        ...Object.values(game.figurePositions?.[2] || {}),
      ].filter(Boolean));
      occupiedSet.delete(targetPos);
      const validSpaces = [];
      for (const coord of Object.keys(mapSpaces)) {
        if (occupiedSet.has(coord)) continue;
        if (maxDistanceFromTarget != null && getRng) {
          if (getRng(targetPos, coord) > maxDistanceFromTarget) continue;
        }
        if (mustAdjacentToActivator && attackerPos && getRng) {
          if (getRng(attackerPos, coord) !== 1) continue;
        }
        validSpaces.push(coord);
      }
      if (validSpaces.length === 0) return { applied: false, manualMessage: `**${label}** — no valid landing spaces. Resolve manually.` };
      return { applied: false, requiresSpaceChoice: true, validSpaces, targetFigureKey, spaceChoiceLabel: `**${label}** — Pick a landing space for **${targetFigureKey.replace(/-\d+-\d+$/, '')}**:` };
    }

    // Phase 1: enumerate valid SMALL hostile targets within range
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const attackerKey = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const attackerPos = attackerKey ? game.figurePositions?.[playerNum]?.[attackerKey] : null;
    const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
    const validTargets = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
      if (!coord) continue;
      // SMALL check: figures with LARGE or MASSIVE keywords are not small
      const targetDcName = fk.replace(/-\d+-\d+$/, '');
      const targetStats = getStatsForDc(targetDcName);
      const kwds = (targetStats?.keywords || []).map((k) => String(k).toUpperCase());
      if (requiresSmall && (kwds.includes('LARGE') || kwds.includes('MASSIVE'))) continue;
      // Range check
      if (getRng && attackerPos && getRng(attackerPos, coord) > range) continue;
      // LOS check
      if (requiresLos && losCheck && attackerPos && mapSpaces) {
        if (!losCheck(attackerPos, coord, mapSpaces)) continue;
      }
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**${label}** — no valid SMALL targets in range. Resolve manually if applicable.` };
    // Deduct strain cost on activation (paid when ability is triggered, not when target is resolved)
    let strainApplied = false;
    if (entry.strainCostToSelf > 0 && dcHealthState && msgId) {
      const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const healthState = dcHealthState.get(msgId) || [];
      if (healthState[selectedFig]) {
        const [cur, max] = healthState[selectedFig];
        const newCur = Math.max(0, (cur ?? max) - entry.strainCostToSelf);
        healthState[selectedFig] = [newCur, max ?? newCur];
        dcHealthState.set(msgId, healthState);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = dcIds ? dcIds.indexOf(msgId) : -1;
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
        strainApplied = true;
      }
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: validTargets.map((fk) => fk.replace(/-\d+-\d+$/, '')),
      targetFigureKeys: validTargets,
      refreshDcEmbed: strainApplied,
    };
  }

  // dcSpecial: targetHostileFigure (Force Choke, Force Lightning) — pick enemy target, apply damage/strain/condition
  // First call: returns requiresChoice with enemy figure list; second call: applies effect to chosen figure.
  if (entry.type === 'dcSpecial' && entry.targetHostileFigure && typeof entry.targetHostileFigure === 'object') {
    const { damage = 0, strain = 0, applyCondition, requiresLos = false, range: maxRange = 999, splashDamageNote } = entry.targetHostileFigure;
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSight: losCheck, getRange: getRng, getMapSpaces: getMs, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.logMessage || `Resolve ${entry.label} manually.` };
    const enemyPlayerNum = playerNum === 1 ? 2 : 1;
    const enemyPositions = game.figurePositions?.[enemyPlayerNum] || {};
    // Second call: apply effect to the chosen figure
    if (choiceIndex != null && targetFigureKey) {
      const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
      const parts = [];
      const totalDmg = damage + strain;
      if (totalDmg > 0 && dcHealthState && targetMsgId) {
        const healthState = dcHealthState.get(targetMsgId) || [];
        const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const entryHp = healthState[figIdx];
        if (entryHp) {
          const [cur, max] = entryHp;
          const newCur = Math.max(0, (cur ?? max) - totalDmg);
          healthState[figIdx] = [newCur, max ?? newCur];
          dcHealthState.set(targetMsgId, healthState);
          const dcIds = enemyPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = enemyPlayerNum === 1 ? game.p1DcList : game.p2DcList;
          const idx = (dcIds || []).indexOf(targetMsgId);
          if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
          const dmgStr = damage > 0 && strain > 0 ? `${damage} Damage + ${strain} Strain` : damage > 0 ? `${damage} Damage` : `${strain} Strain`;
          parts.push(`suffered ${dmgStr} (HP: ${cur ?? max} → ${newCur})`);
        } else {
          parts.push(`(HP not tracked — apply ${damage > 0 ? `${damage} Damage` : ''}${strain > 0 ? ` ${strain} Strain` : ''} manually)`);
        }
      } else if (totalDmg > 0) {
        const dmgStr = damage > 0 && strain > 0 ? `${damage} Damage + ${strain} Strain` : damage > 0 ? `${damage} Damage` : `${strain} Strain`;
        parts.push(`(apply ${dmgStr} manually)`);
      }
      if (applyCondition) {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[targetFigureKey] || [];
        if (!existing.includes(applyCondition)) {
          game.figureConditions[targetFigureKey] = [...existing, applyCondition];
          parts.push(`became **${applyCondition}**`);
        }
      }
      const dcName = targetFigureKey.replace(/-\d+-\d+$/, '');
      const splashNote = splashDamageNote ? `\n> ${splashDamageNote}` : '';
      return { applied: true, freeAction: !!entry.freeAction, logMessage: `**${entry.label}** — **${dcName}** ${parts.join(', ') || 'targeted'}.${splashNote}`, refreshDcEmbed: true };
    }
    // First call: enumerate valid enemy targets with range/LOS filter
    const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const attackerKey = activatingKeys.find((k) => k.endsWith(`-${selectedFig}`)) || activatingKeys[0];
    const attackerPos = attackerKey ? (game.figurePositions?.[playerNum]?.[attackerKey]) : null;
    const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
    const validTargets = [];
    for (const [fk, coord] of Object.entries(enemyPositions)) {
      if (!coord) continue;
      if (getRng && attackerPos && maxRange < 999) {
        const dist = getRng(attackerPos, coord);
        if (dist > maxRange) continue;
      }
      if (requiresLos && losCheck && attackerPos && mapSpaces) {
        if (!losCheck(attackerPos, coord, mapSpaces)) continue;
      }
      validTargets.push({ fk, name: fk.replace(/-\d+-\d+$/, '') });
    }
    if (validTargets.length === 0) {
      return { applied: false, manualMessage: `No valid targets in range/LOS. Apply **${entry.label}** manually.` };
    }
    return { applied: false, requiresChoice: true, choiceOptions: validTargets.map((t) => t.name), targetFigureKeys: validTargets.map((t) => t.fk) };
  }

  // dcSpecial: targetFriendlyFigureAdjacent (Gifted Mechanic) — pick adjacent friendly figure with trait, apply effect to both
  if (entry.type === 'dcSpecial' && entry.targetFriendlyFigureAdjacent && typeof entry.targetFriendlyFigureAdjacent === 'object') {
    const { traits = [], recoverSelf = 0, recoverTarget = 0, hitTokenSelf = 0, hitTokenTarget = 0 } = entry.targetFriendlyFigureAdjacent;
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve ${entry.label} manually.` };
    const mapId = game.selectedMap?.id;
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    // Helper: add Hit tokens to a figure key (up to max 2) — specifically Hit tokens, not generic power tokens
    function addHitToken(fk, n) {
      if (n <= 0) return;
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      const current = game.figurePowerTokens[fk].length;
      for (let i = 0; i < Math.min(n, 2 - current); i++) game.figurePowerTokens[fk].push('Hit');
    }
    // Second call: apply effects to self + chosen target
    if (choiceIndex != null && targetFigureKey) {
      const parts = [];
      // Recover self
      if (recoverSelf > 0 && dcHealthState) {
        const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const healthState = dcHealthState.get(msgId) || [];
        let recovered = 0;
        if (healthState[selectedFig]) {
          const [cur, max] = healthState[selectedFig];
          const heal = Math.min(recoverSelf, (max ?? cur) - cur);
          if (heal > 0) { healthState[selectedFig] = [cur + heal, max ?? cur]; dcHealthState.set(msgId, healthState); recovered = heal; }
        }
        if (recovered > 0) parts.push(`you recovered ${recovered} Damage`);
      }
      // Recover target
      if (recoverTarget > 0 && dcHealthState) {
        const targetMsgId = findMsgIdForFigureKey(game, playerNum, targetFigureKey, dcMessageMeta);
        if (targetMsgId) {
          const healthState = dcHealthState.get(targetMsgId) || [];
          const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
          const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
          if (healthState[figIdx]) {
            const [cur, max] = healthState[figIdx];
            const heal = Math.min(recoverTarget, (max ?? cur) - cur);
            if (heal > 0) { healthState[figIdx] = [cur + heal, max ?? cur]; dcHealthState.set(targetMsgId, healthState); }
            const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
            const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
            const idx = (dcIds || []).indexOf(targetMsgId);
            if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
          }
        }
        parts.push(`${targetFigureKey.replace(/-\d+-\d+$/, '')} recovered ${recoverTarget} Damage`);
      }
      // Hit tokens
      if (hitTokenSelf > 0) { const sfk = activatingKeys[0]; if (sfk) { addHitToken(sfk, hitTokenSelf); parts.push(`you gained ${hitTokenSelf} Hit Token`); } }
      if (hitTokenTarget > 0) { addHitToken(targetFigureKey, hitTokenTarget); parts.push(`${targetFigureKey.replace(/-\d+-\d+$/, '')} gained ${hitTokenTarget} Hit Token`); }
      return { applied: true, logMessage: `**${entry.label}** — ${parts.join(', ')}.`, refreshDcEmbed: true };
    }
    // First call: enumerate adjacent friendly figures matching traits
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      if (!mapId) continue;
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const dcEffs = getDcEffects() || {};
    const validTargets = [...adjacentSet].filter((fk) => {
      const dn = fk.replace(/-\d+-\d+$/, '');
      const kws = (dcEffs[dn]?.keywords || []).map((k) => String(k).toUpperCase());
      return traits.length === 0 || traits.some((t) => kws.includes(t.toUpperCase()));
    }).map((fk) => ({ fk, name: fk.replace(/-\d+-\d+$/, '') }));
    if (validTargets.length === 0) {
      return { applied: false, manualMessage: `No adjacent friendly ${traits.join('/')} found. Resolve **${entry.label}** manually.` };
    }
    return { applied: false, requiresChoice: true, choiceOptions: validTargets.map((t) => t.name), targetFigureKeys: validTargets.map((t) => t.fk) };
  }

  // dcSpecial: applyHideToFriendlyWithinRange (Field Report) — apply Hide condition to qualifying friendly figures within range
  if (entry.type === 'dcSpecial' && entry.applyHideToFriendlyWithinRange && typeof entry.applyHideToFriendlyWithinRange === 'object') {
    const { range: maxRange = 4, maxDiceCount = 2, maxTargets = 2 } = entry.applyHideToFriendlyWithinRange;
    const { game, playerNum, meta, msgId, getRange: getRng } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve ${entry.label} manually.` };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const attackerKey = activatingKeys.find((k) => k.endsWith(`-${selectedFig}`)) || activatingKeys[0];
    const attackerPos = attackerKey ? game.figurePositions?.[playerNum]?.[attackerKey] : null;
    const allFriendlyPositions = game.figurePositions?.[playerNum] || {};
    const dcEffs = getDcEffects() || {};
    const candidates = [];
    for (const [fk, coord] of Object.entries(allFriendlyPositions)) {
      if (!coord || activatingKeys.includes(fk)) continue;
      if (getRng && attackerPos) {
        const dist = getRng(attackerPos, coord);
        if (dist > maxRange) continue;
      }
      const dn = fk.replace(/-\d+-\d+$/, '');
      const dcStats = dcEffs[dn];
      const diceCount = dcStats?.attack?.dice?.length ?? (dcStats?.attack ? 1 : 0);
      if (diceCount > maxDiceCount) continue;
      candidates.push(fk);
    }
    if (candidates.length === 0) return { applied: true, logMessage: `**${entry.label}** — No qualifying friendly figures within ${maxRange} spaces (≤${maxDiceCount} attack dice).` };
    const toHide = candidates.slice(0, maxTargets);
    const skipped = candidates.length > maxTargets ? ` (${candidates.length - maxTargets} additional candidates not hidden — choose manually if needed)` : '';
    game.figureConditions = game.figureConditions || {};
    const hidden = [];
    for (const fk of toHide) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Hide')) { game.figureConditions[fk] = [...existing, 'Hide']; hidden.push(fk.replace(/-\d+-\d+$/, '')); }
    }
    if (hidden.length === 0) return { applied: true, logMessage: `**${entry.label}** — Qualifying figures already Hidden.` };
    return { applied: true, logMessage: `**${entry.label}** — **${hidden.join('**, **')}** became **Hidden**.${skipped}`, refreshDcEmbed: true };
  }

  // battlefield_leadership (Leia Organa): pick a friendly figure within 3 spaces; it gets a free attack
  if (abilityId === 'battlefield_leadership') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Battlefield Leadership** manually.' };
    // Phase 2: figure chosen — set pending flag and return applied
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingBattlefieldLeadership = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
      }
      const chosenName = targetFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Battlefield Leadership** — **${chosenName}** may interrupt to move up to 1 space and perform a free attack (no action cost). Use their **Attack** button.` };
    }
    // Phase 1: enumerate friendly figures within 3 spaces (not Leia herself)
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Battlefield Leadership** — Leia has no position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (getRng && getRng(activatingPos, pos) > 3) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Battlefield Leadership** — No other friendly figures within 3 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: validTargets.map((fk) => fk.replace(/-\d+-\d+$/, '')),
      targetFigureKeys: validTargets,
    };
  }

  // false_orders (Murne Rin): choose a hostile figure (cost ≤ 4, within 4 spaces); perform move or attack with it
  if (abilityId === 'false_orders') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **False Orders** manually.' };
    const enemyNum = playerNum === 1 ? 2 : 1;
    // Phase 2: figure chosen — set pending state and return marker for Move/Attack choice
    if (choiceIndex != null && targetFigureKey) {
      game.pendingFalseOrders = {
        controlledFigureKey: targetFigureKey,
        controlledPlayerNum: enemyNum,
        controllerPlayerNum: playerNum,
        murneRinMsgId: msgId,
      };
      const controlledName = targetFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: false, falseOrdersActionPick: true, logMessage: `**False Orders** — Choose Move or Attack with **${controlledName}**.` };
    }
    // Phase 1: enumerate hostile figures with cost ≤ 4 within 4 spaces
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**False Orders** — Murne Rin has no position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
      if (!pos) continue;
      const targetDcName = fk.replace(/-\d+-\d+$/, '');
      const targetStats = getStatsForDc(targetDcName);
      if ((targetStats?.cost ?? 99) > 4) continue;
      if (getRng && getRng(activatingPos, pos) > 4) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**False Orders** — No hostile figures with cost ≤ 4 within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: validTargets.map((fk) => fk.replace(/-\d+-\d+$/, '')),
      targetFigureKeys: validTargets,
    };
  }

  // dcSpecial: informational — manual resolution with instruction message (no automated game-state change)
  // Supports strainCostToSelf: auto-deducts HP from activating figure if specified.
  if (entry.type === 'dcSpecial' && entry.informational && !entry.freeMoveBonus && !entry.nextAttacksBonusHits) {
    const { game, msgId, dcHealthState, playerNum } = context;
    let strainNote = '';
    if (entry.strainCostToSelf > 0 && game && msgId && dcHealthState) {
      const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const healthState = dcHealthState.get(msgId) || [];
      if (healthState[selectedFig]) {
        const [cur, max] = healthState[selectedFig];
        const newCur = Math.max(0, (cur ?? max) - entry.strainCostToSelf);
        healthState[selectedFig] = [newCur, max ?? newCur];
        dcHealthState.set(msgId, healthState);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = dcIds ? dcIds.indexOf(msgId) : -1;
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
        strainNote = ` You suffered ${entry.strainCostToSelf} Strain (${cur ?? max} \u2192 ${newCur} HP).`;
      } else {
        strainNote = ` (Apply ${entry.strainCostToSelf} Strain to yourself manually.)`;
      }
    }
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      refreshDcEmbed: entry.strainCostToSelf > 0,
      logMessage: (entry.logMessage || entry.label || 'Resolve manually (see rules).') + strainNote,
      manualMessage: entry.logMessage || entry.label,
    };
  }

  // dcSpecial: actionBonus (Expertise) — restore 1 action after using Special (grants an extra action for free)
  if (entry.type === 'dcSpecial' && typeof entry.actionBonus === 'number' && entry.actionBonus > 0) {
    const label = entry.label || 'Expertise';
    return { applied: true, freeAction: true, logMessage: `**${label}** — You may perform ${entry.actionBonus} additional action${entry.actionBonus !== 1 ? 's' : ''} this activation. Action counter restored.` };
  }

  // dcSpecial/ccEffect: overrideAttackDice (Saber Strike, Bo-Rifle Staff Strike, Brutal Cleave, Improvised Weapons) — next attack uses specific dice/type/pierce
  // Must run BEFORE freeAttackBonus to take precedence when both are present.
  if ((entry.type === 'dcSpecial' || entry.type === 'ccEffect') && Array.isArray(entry.overrideAttackDice)) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = context.msgId ?? (playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null);
    const dcHealthState = context.dcHealthState;
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = {
      dice: entry.overrideAttackDice,
      type: entry.overrideAttackType || null,
      pierce: entry.overrideAttackPierce || 0,
      bonusAccuracy: entry.overrideBonusAccuracy || 0,
    };
    // strainCostToSelf (Brutal Cleave): reduce activating figure's HP by strain amount
    let strainNote = '';
    if (entry.strainCostToSelf > 0 && dcHealthState) {
      const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const healthState = dcHealthState.get(msgId) || [];
      if (healthState[selectedFig]) {
        const [cur, max] = healthState[selectedFig];
        const newCur = Math.max(0, (cur ?? max) - entry.strainCostToSelf);
        healthState[selectedFig] = [newCur, max ?? newCur];
        dcHealthState.set(msgId, healthState);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = dcIds ? dcIds.indexOf(msgId) : -1;
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
        strainNote = ` You suffered ${entry.strainCostToSelf} Strain (${cur ?? max} → ${newCur} HP).`;
      } else {
        strainNote = ` (Apply ${entry.strainCostToSelf} Strain to self manually.)`;
      }
    }
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      refreshDcEmbed: entry.strainCostToSelf > 0,
      logMessage: (entry.logMessage || `**${entry.label}** — Click Attack to proceed.`) + strainNote,
    };
  }

  // dcSpecial/ccEffect: freeAttackBonus (Heroic, Rapid Fire, Brutality, etc.) — next attack this activation costs no action
  if ((entry.type === 'dcSpecial' || entry.type === 'ccEffect') && entry.freeAttackBonus) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = context.msgId ?? (playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null);
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    // freeAttackBonusCount > 1 (e.g. Sarlacc Sweep: 2 free attacks): store count, each attack decrements by 1
    game.freeAttackBonusPending[msgId] = entry.freeAttackBonusCount ?? true;
    const label = entry.label || 'Heroic';
    const countNote = (entry.freeAttackBonusCount ?? 1) > 1 ? ` (${entry.freeAttackBonusCount} times, each targeting a different figure)` : '';
    return { applied: true, freeAction: true, logMessage: entry.logMessage || `**${label}** — Your next attack${countNote} costs no action. Click Attack when ready.` };
  }

  // dcSpecial: freeMoveEqualToSpeed (Wall Run, Charge) — gain free MP equal to DC's Speed
  if (entry.type === 'dcSpecial' && entry.freeMoveEqualToSpeed) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const dcStats = getStatsForDc(meta.dcName);
    const speed = typeof dcStats?.speed === 'number' ? dcStats.speed : 4;
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + speed;
    bank.remaining = (bank.remaining ?? 0) + speed;
    game.movementBank[msgId] = bank;
    // Charge (and similar): also grant a free attack after the move
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
    }
    const label = entry.label || 'Wall Run';
    const extraMsg = entry.freeAttackBonus ? ' Then your next attack costs no action.' : ' You may ignore terrain adjacent to walls during this movement (honour system).';
    return { applied: true, logMessage: entry.logMessage || `**${label}** — Gained ${speed} free movement points (your Speed).${extraMsg}`, refreshMovementBank: true, activeMsgId: msgId };
  }

  // dcSpecial: rollOneDie (Slam, Smash, Electrified Knuckledusters, Parting Gift) — roll one die with optional targeting
  if (entry.type === 'dcSpecial' && entry.rollOneDie) {
    const { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, targetFigureKey, chosenSpace } = context;

    // ── Electrified Knuckledusters style: pick adjacent hostile, then roll + apply ──
    if (entry.rollOneDieTarget === 'adjacentHostile') {
      // Phase 2: target chosen → roll die, apply damage + optional surge condition
      if (targetFigureKey) {
        const color = entry.rollOneDie;
        const faces = getDiceData().attack?.[color.toLowerCase()];
        if (!faces?.length) return { applied: false, manualMessage: `Roll 1 ${color} die manually and apply results.` };
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const surges = face.surge ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const enemyPlayerNum = (playerNum || 1) === 1 ? 2 : 1;
        const resultParts = [];
        if (hits > 0) {
          const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
          if (dcHealthState && targetMsgId) {
            const healthState = dcHealthState.get(targetMsgId) || [];
            const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const entryHp = healthState[figIdx];
            if (entryHp) {
              const [cur, max] = entryHp;
              const newCur = Math.max(0, (cur ?? max) - hits);
              healthState[figIdx] = [newCur, max ?? newCur];
              dcHealthState.set(targetMsgId, healthState);
              const dcIds = enemyPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
              const dcList = enemyPlayerNum === 1 ? game.p1DcList : game.p2DcList;
              const idx = (dcIds || []).indexOf(targetMsgId);
              if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
              resultParts.push(`${hits} Damage (HP: ${cur ?? max} → ${newCur})`);
            } else {
              resultParts.push(`apply ${hits} Damage manually`);
            }
          } else {
            resultParts.push(`apply ${hits} Damage manually`);
          }
        }
        const surgeCondition = entry.rollOneDieSurgeCondition;
        if (surgeCondition && surges >= 1) {
          game.figureConditions = game.figureConditions || {};
          const existing = game.figureConditions[targetFigureKey] || [];
          if (!existing.includes(surgeCondition)) game.figureConditions[targetFigureKey] = [...existing, surgeCondition];
          resultParts.push(`became **${surgeCondition}**`);
        }
        const targetName = targetFigureKey.replace(/-\d+-\d+$/, '');
        const pushNote = entry.rollOneDiePushSmallHonor ? ' If that figure is SMALL, you may push it 1 space adjacent to you (apply manually).' : '';
        return {
          applied: true,
          logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}.${pushNote}`,
          refreshDcEmbed: true,
        };
      }
      // Phase 1: enumerate adjacent hostile figures
      if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
      const mapId = game.selectedMap?.id;
      const actionsData = game.dcActionsData?.[msgId];
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';
      const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
      if (!mapId) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
      const adjacentAll = getFiguresAdjacentToTarget(game, activatingFigureKey, mapId);
      const enemyPlayerNum = (playerNum || 1) === 1 ? 2 : 1;
      const validTargets = adjacentAll.filter((f) => f.playerNum === enemyPlayerNum);
      if (validTargets.length === 0) return { applied: false, manualMessage: `No adjacent hostile figures. Resolve **${entry.label}** manually.` };
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: validTargets.map((t) => t.figureKey.replace(/-\d+-\d+$/, '')),
        targetFigureKeys: validTargets.map((t) => t.figureKey),
      };
    }

    // ── Parting Gift style: pick space within N, then roll + apply to figures on/adjacent ──
    if (entry.rollOneDieTarget === 'spaceWithin') {
      const range = entry.rollOneDieRange || 3;
      // Phase 2: space chosen → roll die, apply damage to all figures on or adjacent to that space
      if (chosenSpace) {
        const color = entry.rollOneDie;
        const faces = getDiceData().attack?.[color.toLowerCase()];
        if (!faces?.length) return { applied: false, manualMessage: `Roll 1 ${color} die manually and apply results.` };
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const surges = face.surge ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const spaceUpper = String(chosenSpace).toUpperCase();
        const resultParts = [];
        if (hits > 0) {
          const boardState = getBoardStateForMovement(game, null);
          const adj = boardState?.mapSpaces?.adjacency?.[spaceUpper.toLowerCase()] || [];
          const affectedSpaces = new Set([spaceUpper.toLowerCase(), ...adj.map((s) => String(s).toLowerCase())]);
          const affected = [];
          for (const pn of [1, 2]) {
            for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
              if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
              const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
              if (dcHealthState && figMsgId) {
                const healthState = dcHealthState.get(figMsgId) || [];
                const fkMatch = fk.match(/-(\d+)-(\d+)$/);
                const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
                const entryHp = healthState[figIdx];
                if (entryHp) {
                  const [cur, max] = entryHp;
                  const newCur = Math.max(0, (cur ?? max) - hits);
                  healthState[figIdx] = [newCur, max ?? newCur];
                  dcHealthState.set(figMsgId, healthState);
                  const dcIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
                  const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
                  const idx = (dcIds || []).indexOf(figMsgId);
                  if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
                  affected.push(`${fk.replace(/-\d+-\d+$/, '')} -${hits}HP (→${newCur})`);
                } else {
                  affected.push(`${fk.replace(/-\d+-\d+$/, '')} (-${hits}HP, apply manually)`);
                }
              } else {
                affected.push(`${fk.replace(/-\d+-\d+$/, '')} (-${hits}HP, apply manually)`);
              }
            }
          }
          resultParts.push(affected.length ? affected.join(', ') : 'no figures in blast area');
        }
        return {
          applied: true,
          logMessage: `**${entry.label}** — Space **${spaceUpper}** targeted. Rolled 1 ${entry.rollOneDie} die: **${diceResult}**. ${resultParts.join('. ') || 'No effect.'}`,
          refreshDcEmbed: hits > 0,
        };
      }
      // Phase 1: enumerate valid spaces within N
      if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
      const actionsData = game.dcActionsData?.[msgId];
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';
      const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
      const activatingPos = game.figurePositions?.[playerNum]?.[activatingFigureKey];
      if (!activatingPos) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (position unknown).` };
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
      const occ = boardState.occupiedSet;
      const occArr = occ instanceof Set ? [...occ] : (occ || []);
      const reachable = getReachableSpaces(activatingPos, range, boardState.mapSpaces, occArr);
      const validSet = new Set([String(activatingPos).toLowerCase(), ...reachable.map((s) => String(s).toLowerCase())]);
      const validSpaces = [...validSet];
      if (validSpaces.length === 0) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (no spaces in range).` };
      return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**${entry.label}** — Choose a space within ${range}:` };
    }

    // ── Plain rollOneDie: report results only (Slam, Smash) ──
    const color = entry.rollOneDie;
    const faces = getDiceData().attack?.[color.toLowerCase()];
    if (!faces?.length) return { applied: false, manualMessage: `Roll 1 ${color} die and apply results manually.` };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const hits = face.dmg ?? 0;
    const surges = face.surge ?? 0;
    const acc = face.acc ?? 0;
    const parts = [];
    if (hits) parts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
    if (surges) parts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
    if (acc) parts.push(`${acc} Accuracy`);
    const diceResult = parts.length ? parts.join(', ') : 'blank';
    const surgeMsg = entry.rollOneDieSurgeCondition && surges >= 1 ? ` (1+ Surge → apply **${entry.rollOneDieSurgeCondition}** condition!)` : '';
    const noteMsg = entry.rollOneDieNote ? `\n> ${entry.rollOneDieNote}` : '';
    return {
      applied: true,
      logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**${surgeMsg}${noteMsg}`,
    };
  }

  // dcSpecial: fixedAreaEffect (Demolish, Wrist Flamethrower) — space choice, then apply fixed damage/conditions to area
  if (entry.type === 'dcSpecial' && entry.fixedAreaEffect) {
    const { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState, chosenSpace } = context;
    const range = entry.fixedAreaRange || 3;
    const dmgAmt = entry.fixedAreaDamage || 0;
    const strainAmt = entry.fixedAreaStrain || 0;
    const totalPerFig = dmgAmt + strainAmt;
    const conditions = entry.fixedAreaConditions || [];

    if (chosenSpace) {
      // Phase 2: apply fixed damage/strain/conditions to all figures on or adjacent to chosenSpace
      if (!game || !dcHealthState) return { applied: false, manualMessage: `Apply ${entry.label} effects manually.` };
      const boardState = getBoardStateForMovement(game, null);
      const spaceNorm = String(chosenSpace).toLowerCase();
      const adj = boardState?.mapSpaces?.adjacency?.[spaceNorm] || [];
      const affectedSpaces = new Set([spaceNorm, ...adj.map((s) => String(s).toLowerCase())]);
      const results = [];
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
          const dcName = fk.replace(/-\d+-\d+$/, '');
          const parts = [];
          if (totalPerFig > 0) {
            const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
            if (figMsgId) {
              const hs = dcHealthState.get(figMsgId) || [];
              const fkMatch = fk.match(/-(\d+)-(\d+)$/);
              const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
              const hp = hs[figIdx];
              if (hp) {
                const [cur, max] = hp;
                const newCur = Math.max(0, (cur ?? max) - totalPerFig);
                hs[figIdx] = [newCur, max ?? newCur];
                dcHealthState.set(figMsgId, hs);
                const dcIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
                const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
                const idx = (dcIds || []).indexOf(figMsgId);
                if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...hs];
                const dmgLabel = [dmgAmt > 0 ? `${dmgAmt} Dmg` : null, strainAmt > 0 ? `${strainAmt} Strain` : null].filter(Boolean).join('+');
                parts.push(`${dmgLabel} (HP: ${cur ?? max}→${newCur})`);
              } else {
                parts.push(`apply ${totalPerFig} damage manually`);
              }
            } else {
              parts.push(`apply ${totalPerFig} damage manually`);
            }
          }
          if (conditions.length) {
            game.figureConditions = game.figureConditions || {};
            const existing = game.figureConditions[fk] || [];
            game.figureConditions[fk] = [...new Set([...existing, ...conditions])];
            const added = conditions.filter((c) => !existing.includes(c));
            if (added.length) parts.push(added.join(', '));
          }
          if (parts.length) results.push(`**${dcName}**: ${parts.join(', ')}`);
        }
      }
      // Apply self strain
      const selfStrainAmt = entry.fixedSelfStrain || 0;
      if (selfStrainAmt > 0 && dcHealthState && msgId) {
        const actData = game.dcActionsData?.[msgId];
        const selfFigIdx = actData?.selectedFigure ?? 0;
        const dgMatch = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const selfHs = dcHealthState.get(msgId) || [];
        const selfHp = selfHs[selfFigIdx];
        if (selfHp) {
          const [cur, max] = selfHp;
          const newCur = Math.max(0, (cur ?? max) - selfStrainAmt);
          selfHs[selfFigIdx] = [newCur, max ?? newCur];
          dcHealthState.set(msgId, selfHs);
          const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
          const idx = (dcIds || []).indexOf(msgId);
          if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...selfHs];
          results.push(`**${meta?.dcName}** suffers ${selfStrainAmt} Strain (self)`);
        }
      }
      // Place rubble token on chosen space
      if (entry.placesRubble) {
        game.ancillaryTokens = game.ancillaryTokens || {};
        game.ancillaryTokens.rubble = [...(game.ancillaryTokens.rubble || []), spaceNorm];
        results.push(`rubble token placed at **${String(chosenSpace).toUpperCase()}**`);
      }
      // Deduct MP cost if specified (e.g. Wrist Flamethrower costs 2 MP)
      if (entry.mpCost > 0 && game.movementBank?.[msgId]) {
        game.movementBank[msgId].remaining = Math.max(0, (game.movementBank[msgId].remaining || 0) - entry.mpCost);
        results.push(`spent ${entry.mpCost} MP`);
      }
      const spaceUpper = String(chosenSpace).toUpperCase();
      return {
        applied: true,
        logMessage: `**${entry.label}** — Space **${spaceUpper}**. ${results.length ? results.join('; ') : 'No figures affected.'}`,
        refreshDcEmbed: results.length > 0,
        refreshBoard: !!entry.placesRubble,
      };
    }
    // Phase 1: pick a space within range
    if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    const activatingPos = game.figurePositions?.[playerNum]?.[activatingFigureKey];
    if (!activatingPos) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (position unknown).` };
    const boardState = getBoardStateForMovement(game, null);
    if (!boardState?.mapSpaces) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
    const occ = boardState.occupiedSet;
    const occArr = occ instanceof Set ? [...occ] : (occ || []);
    const reachable = getReachableSpaces(activatingPos, range, boardState.mapSpaces, occArr);
    const validSet = new Set([String(activatingPos).toLowerCase(), ...reachable.map((s) => String(s).toLowerCase())]);
    const validSpaces = [...validSet];
    if (validSpaces.length === 0) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (no spaces in range).` };
    return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**${entry.label}** — Choose a space within ${range}:` };
  }

  // dcSpecial: missileSalvoStart (BT-1 Missile Salvo) — set up multi-attack salvo state
  if (entry.type === 'dcSpecial' && entry.missileSalvoStart) {
    const { game, msgId, meta, playerNum } = context;
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const threadId = game.dcActionsData?.[msgId]?.threadId || null;
    game.pendingMissileSalvo = game.pendingMissileSalvo || {};
    game.pendingMissileSalvo[msgId] = { gameId: game.gameId, playerNum, threadId, diceAvailable: ['blue', 'red', 'yellow'], targetsFired: [] };
    return {
      applied: true,
      missileSalvoStart: true,
      logMessage: `**${entry.label}** — Salvo initiated. Choose a die color for each attack (+3 Accuracy per attack, different targets, each die color once).`,
    };
  }

  // dcSpecial: freeMoveBonus standalone (I'm One With the Force, Executor, etc.) — add N free MP; optionally also grant free attack
  if (entry.type === 'dcSpecial' && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && !entry.nextAttacksBonusHits) {
    const { game, msgId } = context;
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.freeMoveBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.freeMoveBonus;
    game.movementBank[msgId] = bank;
    // Also grant free attack if specified (e.g. Executor)
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
    }
    return { applied: true, freeAction: !!entry.freeAction, logMessage: entry.logMessage || `**${entry.label}** — Gained ${entry.freeMoveBonus} free movement points.`, refreshMovementBank: true, activeMsgId: msgId };
  }

  // dcSpecial: freeMoveBonus + nextAttacksBonusHits (On the Hunt — gain free MP, next attack gets +N Hit)
  if (entry.type === 'dcSpecial' && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && entry.nextAttacksBonusHits) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.freeMoveBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.freeMoveBonus;
    game.movementBank[msgId] = bank;
    const nb = entry.nextAttacksBonusHits;
    game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
    game.nextAttacksBonusHits[meta.playerNum] = { count: nb.count, bonus: nb.bonus };
    const logMsg = entry.logMessage || `Gained ${entry.freeMoveBonus} free MP. Next ${nb.count} attack${nb.count !== 1 ? 's' : ''} gain +${nb.bonus} Hit.`;
    return { applied: true, logMessage: logMsg };
  }

  // ccEffect: noCommandDrawThisRound (Cut Lines — players cannot draw CCs this round)
  if (entry.type === 'ccEffect' && entry.noCommandDrawThisRound) {
    const { game } = context;
    if (!game) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.noCommandDrawThisRound = true;
    return {
      applied: true,
      logMessage: 'Players cannot draw Command cards during this round.',
    };
  }

  // ccEffect: opponentCannotPlayCCsThisRound (Shadow Ops — opponent cannot play any CCs this round)
  if (entry.type === 'ccEffect' && entry.opponentCannotPlayCCsThisRound) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.shadowOpsBlockedPlayer = playerNum === 1 ? 2 : 1;
    return {
      applied: true,
      logMessage: 'Shadow Ops active — opponent cannot play Command cards this round.',
    };
  }

  // ccEffect: chooseSpaceWithin2OfActivating (Smoke Grenade) — first call: return validSpaces; second call: apply with chosenSpace
  if (entry.type === 'ccEffect' && entry.chooseSpaceWithin2OfActivating) {
    const { game, playerNum, dcMessageMeta, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (!chosenSpace) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
      const meta = dcMessageMeta.get(msgId);
      if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Resolve manually: map data missing.' };
      const validSet = new Set();
      for (const fk of figureKeys) {
        const pos = game.figurePositions?.[playerNum]?.[fk];
        if (!pos) continue;
        const profile = getMovementProfile(meta.dcName, fk, game);
        const occ = boardState.occupiedSet;
        const occArr = occ instanceof Set ? [...occ] : (occ || []);
        const cells = getReachableSpaces(pos, 2, boardState.mapSpaces, occArr);
        for (const c of cells) validSet.add(String(c).toLowerCase());
      }
      const validSpaces = [...validSet];
      if (validSpaces.length === 0) return { applied: false, manualMessage: 'No spaces within 2 to choose.' };
      return { requiresSpaceChoice: true, validSpaces };
    }
    const spaceUpper = String(chosenSpace).toUpperCase();
    game.ancillaryTokens = game.ancillaryTokens || {};
    game.ancillaryTokens.smoke = [...(game.ancillaryTokens.smoke || []), chosenSpace];
    const mpLabel = entry.mpBonus ? `; choose a friendly figure within 2 of that space to gain ${entry.mpBonus} MP` : '';
    return {
      applied: true,
      logMessage: `Chose space **${spaceUpper}**. Placed smoke token there${mpLabel}.`,
      refreshBoard: true,
    };
  }

  // ccEffect: placeRubbleOnTargetAndAdjacent (Reduce to Rubble — after attack that hit)
  if (entry.type === 'ccEffect' && entry.placeRubbleOnTargetAndAdjacent) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const spaces = game.lastAttackTargetSpacesForRubble;
    const attackerNum = game.lastAttackAttackerPlayerNum;
    if (!spaces?.length || playerNum !== attackerNum) {
      return { applied: false, manualMessage: 'Play Reduce to Rubble after you resolve an attack that did not miss. No recent attack target stored.' };
    }
    game.ancillaryTokens = game.ancillaryTokens || {};
    game.ancillaryTokens.rubble = [...(game.ancillaryTokens.rubble || []), ...spaces];
    delete game.lastAttackTargetSpacesForRubble;
    delete game.lastAttackAttackerPlayerNum;
    return {
      applied: true,
      logMessage: `Placed rubble tokens on target space and adjacent spaces (${spaces.length} total).`,
      refreshBoard: true,
    };
  }

  // ccEffect: selfDamageThenMpAndFocus (Stimulants — you suffer N damage, then gain MP and Focus)
  if (entry.type === 'ccEffect' && entry.selfDamageThenMpAndFocus) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    const { damage = 1, mpBonus = 0, applyFocus: doFocus = false } = entry.selfDamageThenMpAndFocus;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const healthState = dcHealthState.get(msgId) || [];
    if (!healthState.length || !Array.isArray(healthState[0])) return { applied: false, manualMessage: 'Resolve manually: no health state for this DC.' };
    const [cur, max] = healthState[0];
    const newCur = Math.max(0, (cur ?? max ?? 0) - damage);
    healthState[0] = [newCur, max ?? cur];
    dcHealthState.set(msgId, healthState);
    const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(msgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    if (mpBonus > 0) {
      game.movementBank = game.movementBank || {};
      const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
      bank.total = (bank.total ?? 0) + mpBonus;
      bank.remaining = (bank.remaining ?? 0) + mpBonus;
      game.movementBank[msgId] = bank;
    }
    if (doFocus) {
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      game.figureConditions = game.figureConditions || {};
      for (const fk of figureKeys) {
        const existing = game.figureConditions[fk] || [];
        if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
      }
    }
    const parts = [`Suffered ${damage} Damage.`];
    if (mpBonus > 0) parts.push(`Gained ${mpBonus} MP.`);
    if (doFocus) parts.push('Became Focused.');
    return {
      applied: true,
      logMessage: parts.join(' '),
      refreshDcEmbed: true,
    };
  }

  // ccEffect: returnDiscardToHand — move one card from discard to hand (the card that was last in discard before the current play)
  if (entry.type === 'ccEffect' && entry.returnDiscardToHand) {
    const { game, playerNum, cardName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discard = (game[discardKey] || []).slice();
    const hand = (game[handKey] || []).slice();
    if (discard.length < 2) return { applied: false, manualMessage: 'No other card in discard to return to hand.' };
    const lastIndex = discard.length - 1;
    const isCurrentCardLast = cardName && discard[lastIndex] === cardName;
    const toReturnIndex = isCurrentCardLast ? lastIndex - 1 : lastIndex;
    if (toReturnIndex < 0) return { applied: false, manualMessage: 'No other card in discard to return to hand.' };
    const toReturn = discard.splice(toReturnIndex, 1)[0];
    hand.push(toReturn);
    game[discardKey] = discard;
    game[handKey] = hand;
    const logParts = [`Returned **${toReturn}** from discard to hand.`];
    let drewCards = [];
    if (typeof entry.draw === 'number' && entry.draw > 0) {
      drewCards = drawCcCards(game, playerNum, entry.draw);
      if (drewCards.length > 0) logParts.push(`Drew ${drewCards.map((c) => `**${c}**`).join(', ')}.`);
    }
    return {
      applied: true,
      logMessage: logParts.join(' '),
      drewCards: drewCards.length > 0 ? drewCards : undefined,
      refreshHand: true,
      refreshDiscard: true,
    };
  }

  // ccEffect: clearOpponentDiscard + optional draw with drawIfTrait (Fool Me Once)
  if (entry.type === 'ccEffect' && entry.clearOpponentDiscard) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const discardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const cleared = (game[discardKey] || []).length;
    game[discardKey] = [];
    let drew = [];
    if (typeof entry.draw === 'number' && entry.draw > 0 && entry.drawIfTrait && dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      const meta = msgId ? dcMessageMeta.get(msgId) : null;
      if (meta?.dcName) {
        const eff = getDcEffects()?.[meta.dcName] || getDcEffects()?.[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
        const trait = String(entry.drawIfTrait).toUpperCase();
        if (keywords.includes(trait)) {
          drew = drawCcCards(game, playerNum, entry.draw);
        }
      }
    }
    const parts = [];
    if (cleared > 0) parts.push(`Returned ${cleared} card(s) from opponent's discard to the game box`);
    if (drew.length > 0) parts.push(`drew ${drew.length} card(s)`);
    return {
      applied: true,
      logMessage: parts.length ? parts.join('; ') + '.' : 'Opponent discard cleared.',
      drewCards: drew.length ? drew : undefined,
      refreshOpponentDiscard: cleared > 0,
    };
  }

  // ccEffect: Draw N, then discard 1, gain VP = cost of discarded (Black Market Prices)
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0 && entry.drawThenDiscardOneGainVp) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const drew = drawCcCards(game, playerNum, entry.draw);
    if (drew.length === 0) return { applied: true, logMessage: 'No cards to draw.' };
    const toDiscard = drew[drew.length - 1];
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const hand = (game[handKey] || []).slice();
    const idx = hand.indexOf(toDiscard);
    if (idx >= 0) hand.splice(idx, 1);
    game[handKey] = hand;
    game[discardKey] = (game[discardKey] || []).concat(toDiscard);
    const eff = getCcEffect(toDiscard);
    const cost = typeof eff?.cost === 'number' ? eff.cost : 0;
    const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].total = (game[vpKey].total ?? 0) + cost;
    const kept = drew.slice(0, -1);
    return {
      applied: true,
      drewCards: kept,
      logMessage: `Drew 2, discarded **${toDiscard}** (cost ${cost}), gained ${cost} VP.`,
    };
  }

  // ccEffect: Draw N, then discard M of drawn if figure does NOT have trait (Planning)
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0 && entry.discardIfNotTrait && typeof entry.discardFromDrawn === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const drew = drawCcCards(game, playerNum, entry.draw);
    if (drew.length === 0) return { applied: true, logMessage: 'No cards to draw.' };
    let dcName = null;
    if (dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      const meta = msgId ? dcMessageMeta.get(msgId) : null;
      if (meta?.dcName) dcName = meta.dcName;
    }
    const hasTrait = dcName ? (() => {
      const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
      return keywords.includes(String(entry.discardIfNotTrait).toUpperCase());
    })() : true;
    if (!hasTrait && entry.discardFromDrawn > 0) {
      const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
      const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
      const hand = game[handKey] || [];
      const toDiscard = Math.min(entry.discardFromDrawn, drew.length);
      const discarded = [];
      for (let i = 0; i < toDiscard; i++) {
        const card = drew[drew.length - 1 - i];
        const idx = hand.lastIndexOf(card);
        if (idx >= 0) {
          hand.splice(idx, 1);
          discarded.push(card);
        }
      }
      game[handKey] = hand;
      game[discardKey] = (game[discardKey] || []).concat(discarded);
      const kept = drew.filter((c) => !discarded.includes(c));
      return {
        applied: true,
        drewCards: kept,
        logMessage: `Drew 2, discarded ${discarded.length} (not LEADER).`,
      };
    }
    return { applied: true, drewCards: drew };
  }

  // ccEffect: Draw N cards (optionally conditional on figure trait, e.g. Officer's Training)
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0) {
    const { game, playerNum, combat, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (entry.drawIfTrait) {
      let dcName = null;
      const cbt = combat || game.combat || game.pendingCombat;
      if (cbt && cbt.attackerPlayerNum === playerNum && cbt.attackerDcName) {
        dcName = cbt.attackerDcName;
      } else if (dcMessageMeta) {
        const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        const meta = msgId ? dcMessageMeta.get(msgId) : null;
        if (meta?.dcName) dcName = meta.dcName;
      }
      if (!dcName) return { applied: false, manualMessage: 'Resolve manually: could not determine figure for trait check.' };
      const eff = getDcEffects()?.[dcName] || getDcEffects()?.[dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
      const trait = String(entry.drawIfTrait).toUpperCase();
      if (!keywords.includes(trait)) return { applied: true };
    }
    const drew = drawCcCards(game, playerNum, entry.draw);
    return { applied: true, drewCards: drew };
  }

  // ccEffect: +N MP from Speed (Urgency: Speed+2) — requires active activation
  if (entry.type === 'ccEffect' && typeof entry.mpBonusFromSpeed === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const speed = getStatsForDc(meta.dcName)?.speed ?? 4;
    const n = speed + entry.mpBonusFromSpeed;
    if (n < 1) return { applied: false, manualMessage: 'Resolve manually: no MP to gain.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + n;
    bank.remaining = (bank.remaining ?? 0) + n;
    game.movementBank[msgId] = bank;
    const msg = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
    return { applied: true, logMessage: msg, refreshMovementBank: true, activeMsgId: msgId };
  }

  // ccEffect: discardUpToNHarmful + mpBonus combo (optionally + recoverDamage) — Heart of Freedom, Price of Glory
  if (entry.type === 'ccEffect' && typeof entry.discardUpToNHarmful === 'number' && typeof entry.mpBonus === 'number') {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const HARMFUL = ['Stun', 'Weaken', 'Bleed'];
    const limit = entry.discardUpToNHarmful;
    let discarded = 0;
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      if (discarded >= limit) break;
      const existing = game.figureConditions[fk] || [];
      const harmful = existing.filter((c) => HARMFUL.includes(c));
      if (harmful.length > 0) {
        const toRemove = Math.min(harmful.length, limit - discarded);
        const kept = [...existing];
        for (let i = 0; i < toRemove; i++) {
          const idx = kept.findIndex((c) => HARMFUL.includes(c));
          if (idx >= 0) kept.splice(idx, 1);
        }
        game.figureConditions[fk] = kept.length ? kept : [];
        discarded += toRemove;
      }
    }
    let recovered = 0;
    if (dcHealthState && typeof entry.recoverDamage === 'number' && entry.recoverDamage > 0) {
      const healthState = dcHealthState.get(msgId) || [];
      for (let i = 0; i < healthState.length && recovered < entry.recoverDamage; i++) {
        const entry_ = healthState[i];
        if (!Array.isArray(entry_)) continue;
        const [cur, max] = entry_;
        const mx = max ?? cur;
        if (mx == null || cur == null) continue;
        const damage = mx - cur;
        if (damage <= 0) continue;
        const heal = Math.min(entry.recoverDamage - recovered, damage);
        healthState[i] = [cur + heal, mx];
        recovered += heal;
      }
      if (recovered > 0) {
        dcHealthState.set(msgId, healthState);
        const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx = (dcMessageIds || []).indexOf(msgId);
        if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      }
    }
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    const mp = entry.mpBonus;
    bank.total = (bank.total ?? 0) + mp;
    bank.remaining = (bank.remaining ?? 0) + mp;
    game.movementBank[msgId] = bank;
    const parts = [];
    if (discarded > 0) parts.push(`Discarded ${discarded} HARMFUL condition(s)`);
    if (recovered > 0) parts.push(`recovered ${recovered} Damage`);
    parts.push(`gained ${mp} MP`);
    return { applied: true, logMessage: parts.join(', ') + '.', refreshDcEmbed: recovered > 0 };
  }

  // ccEffect: Apex Predator combo — Focus + Hide + powerTokenGain + mpBonus (must run before individual branches)
  if (entry.type === 'ccEffect' && entry.applyFocus && entry.applyHide && typeof entry.powerTokenGain === 'number' && typeof entry.mpBonus === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    if (figureKeys.length > 1) return { applied: false, manualMessage: 'Resolve manually: choose which figure gains Power Tokens.' };
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      const updated = [...existing];
      if (!updated.includes('Focus')) updated.push('Focus');
      if (!updated.includes('Hide')) updated.push('Hide');
      game.figureConditions[fk] = updated;
    }
    const fk = figureKeys[0];
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    const current = game.figurePowerTokens[fk].length;
    const toAdd = Math.min(entry.powerTokenGain, 2 - current);
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    if (toAdd > 0) {
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: meta?.displayName || fk, count: toAdd }], channelId: null, playerNum };
    }
    const parts = ['Became Focused', 'Hidden', toAdd > 0 ? `gained ${toAdd} Power Token(s) — choose type` : null, `gained ${entry.mpBonus} MP`].filter(Boolean);
    return { applied: true, requiresPowerTokenChoice: toAdd > 0, logMessage: parts.join(', ') + '.', refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true, conditionCardsToPost: ['Focus', 'Hidden'] };
  }

  // ccEffect: applyFocus + mpBonus combo (Stimulants) — Focus and MP together; damage to self/adjacent is manual
  if (entry.type === 'ccEffect' && entry.applyFocus && typeof entry.mpBonus === 'number' && entry.mpBonus > 0 && !entry.applyHide) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    const n = entry.mpBonus;
    const mpMsg = n === 1 ? '1 movement point' : `${n} movement points`;
    return {
      applied: true,
      logMessage: `Became Focused, gained ${mpMsg}. **Apply Damage manually** as required by the card.`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [msgId],
      refreshBoard: true,
    };
  }

  // ccEffect: +N MP (Fleet Footed, Rank and File, etc.) — requires active activation
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    const n = entry.mpBonus;
    bank.total = (bank.total ?? 0) + n;
    bank.remaining = (bank.remaining ?? 0) + n;
    game.movementBank[msgId] = bank;
    let msg = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
    // Rank and File: each other friendly TROOPER also gains N MP immediately
    if (entry.trooperMpBonusRound) {
      const bonus = entry.trooperMpBonusRound;
      const dcMsgIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      let trooperCount = 0;
      for (let i = 0; i < dcMsgIds.length; i++) {
        const dMsgId = dcMsgIds[i];
        if (dMsgId === msgId) continue;
        const dc = dcList[i];
        if (!dc?.dcName) continue;
        const eff = getDcEffects()?.[dc.dcName] || getDcEffects()?.[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const kws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!kws.includes('TROOPER')) continue;
        const dBank = game.movementBank[dMsgId] || { total: 0, remaining: 0 };
        dBank.total = (dBank.total ?? 0) + bonus;
        dBank.remaining = (dBank.remaining ?? 0) + bonus;
        game.movementBank[dMsgId] = dBank;
        trooperCount++;
      }
      if (trooperCount > 0) msg += ` Each of ${trooperCount} other friendly TROOPER(s) also gained ${bonus} MP.`;
    }
    return { applied: true, logMessage: entry.logMessage || msg };
  }

  // ccEffect: Power Token gain (Battle Scars, etc.) — requires active activation
  if (entry.type === 'ccEffect' && (typeof entry.powerTokenGain === 'number' || entry.powerTokenGainIfDamagedGte)) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    let n = typeof entry.powerTokenGain === 'number' ? entry.powerTokenGain : 1;
    const ifDamaged = entry.powerTokenGainIfDamagedGte;
    if (ifDamaged && typeof ifDamaged === 'object') {
      const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const idx = dcMessageIds.indexOf(msgId);
      const dc = idx >= 0 ? dcList[idx] : null;
      const healthState = dc?.healthState || [];
      let maxDamage = 0;
      for (const [cur, max] of healthState) {
        if (cur != null && max != null) maxDamage = Math.max(maxDamage, max - cur);
      }
      for (const [thresh, val] of Object.entries(ifDamaged)) {
        if (maxDamage >= parseInt(thresh, 10) && val > n) n = val;
      }
    }
    if (n < 1) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (figureKeys.length > 1) return { applied: false, manualMessage: 'Resolve manually: choose which figure gains the Power Token(s).' };
    const fk = figureKeys[0];
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    const current = game.figurePowerTokens[fk].length;
    const toAdd = Math.min(n, 2 - current);
    if (toAdd <= 0) return { applied: false, manualMessage: 'That figure already has 2 Power Tokens (max).' };
    game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: fk, count: toAdd }], channelId: null, playerNum };
    const msg = toAdd === 1 ? 'Gained 1 Power Token — choose type.' : `Gained ${toAdd} Power Tokens — choose type.`;
    return { applied: true, requiresPowerTokenChoice: true, logMessage: msg, refreshBoard: true };
  }

  // ccEffect: focusGainToAdjacentUpToN (Inspiring Speech) — Focus up to N friendly figures adjacent to activating figure(s)
  if (entry.type === 'ccEffect' && typeof entry.focusGainToAdjacentUpToN === 'number' && entry.focusGainToAdjacentUpToN > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    const n = Math.min(entry.focusGainToAdjacentUpToN, adjacent.length);
    if (adjacent.length === 0) return { applied: true, logMessage: 'No adjacent friendly figures.' };
    if (adjacent.length > entry.focusGainToAdjacentUpToN) {
      return { applied: false, manualMessage: `Resolve manually: choose up to ${entry.focusGainToAdjacentUpToN} of ${adjacent.length} adjacent friendly figures to become Focused.` };
    }
    game.figureConditions = game.figureConditions || {};
    for (const fk of adjacent) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    return { applied: true, logMessage: `${adjacent.length} adjacent figure(s) became Focused.`, refreshBoard: true };
  }

  // ccEffect: Against the Odds — end of round, VP condition, Focus up to 3 figures
  if (entry.type === 'ccEffect' && typeof entry.focusGainToUpToNFigures === 'number' && entry.vpCondition?.opponentHasAtLeastMore != null) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const playerVP = (playerNum === 1 ? game.player1VP : game.player2VP)?.total ?? 0;
    const oppVP = (oppNum === 1 ? game.player1VP : game.player2VP)?.total ?? 0;
    const diff = entry.vpCondition.opponentHasAtLeastMore;
    if (oppVP - playerVP < diff) return { applied: true };
    const poses = game.figurePositions?.[playerNum] || {};
    const allKeys = Object.keys(poses);
    if (allKeys.length === 0) return { applied: true };
    const n = Math.min(entry.focusGainToUpToNFigures, allKeys.length);
    if (allKeys.length > n) return { applied: false, manualMessage: `Resolve manually: choose up to ${n} of your ${allKeys.length} figures to become Focused.` };
    game.figureConditions = game.figureConditions || {};
    for (const fk of allKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    return { applied: true, logMessage: `${allKeys.length} figure(s) became Focused.`, refreshBoard: true };
  }

  // ccEffect: vpGainSelf + vpGainOpponent (e.g. Dangerous Bargains — start of round, if self VP ≤ N, both gain VP)
  if (entry.type === 'ccEffect' && typeof entry.vpGainSelf === 'number' && typeof entry.vpGainOpponent === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const selfKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    const oppKey = playerNum === 1 ? 'player2VP' : 'player1VP';
    const selfVP = (game[selfKey]?.total ?? 0);
    if (entry.vpCondition?.selfHasAtMost != null && selfVP > entry.vpCondition.selfHasAtMost) {
      return { applied: true, logMessage: `Condition not met — player has ${selfVP} VP (must have ${entry.vpCondition.selfHasAtMost} or fewer). No VP gained.` };
    }
    game[selfKey] = game[selfKey] || { total: 0, kills: 0, objectives: 0 };
    game[oppKey] = game[oppKey] || { total: 0, kills: 0, objectives: 0 };
    game[selfKey].total = (game[selfKey].total ?? 0) + entry.vpGainSelf;
    game[oppKey].total = (game[oppKey].total ?? 0) + entry.vpGainOpponent;
    return {
      applied: true,
      logMessage: `Both players gained ${entry.vpGainSelf} VP! (Player: ${game[selfKey].total} VP total, Opponent: ${game[oppKey].total} VP total)`,
    };
  }

  // ccEffect: recoverDamageFromRound (Hour of Need) — recover damage equal to current round number
  if (entry.type === 'ccEffect' && entry.recoverDamageFromRound) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const actMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!actMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: recovery requires health state.' };
    const healthState = dcHealthState.get(actMsgId) || [];
    if (!healthState.length) return { applied: false, manualMessage: 'Resolve manually: no health state for this DC.' };
    const n = Math.max(1, game.currentRound || 1);
    let recovered = 0;
    for (let i = 0; i < healthState.length && recovered < n; i++) {
      const entry_ = healthState[i];
      if (!Array.isArray(entry_)) continue;
      const [cur, max] = entry_;
      const mx = max ?? cur;
      if (mx == null || cur == null) continue;
      const damage = mx - cur;
      if (damage <= 0) continue;
      const heal = Math.min(n - recovered, damage);
      healthState[i] = [cur + heal, mx];
      recovered += heal;
    }
    if (recovered > 0) {
      dcHealthState.set(actMsgId, healthState);
      const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcMessageIds || []).indexOf(actMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      return { applied: true, logMessage: `Recovered ${recovered} Damage (round ${n}).`, refreshDcEmbed: true };
    }
    return { applied: true, logMessage: 'No damage to recover.' };
  }

  // ccEffect: recoverDamageToAdjacent (Emergency Aid) — adjacent friendly recovers N (or more if trait)
  if (entry.type === 'ccEffect' && typeof entry.recoverDamageToAdjacent === 'number') {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) return { applied: true, logMessage: 'No adjacent friendly figures.' };
    if (adjacent.length > 1) return { applied: false, manualMessage: `Resolve manually: choose which of ${adjacent.length} adjacent figures recovers.` };
    const targetFk = adjacent[0];
    let n = entry.recoverDamageToAdjacent;
    const ifTrait = entry.recoverDamageToAdjacentIfTrait;
    if (ifTrait && meta?.dcName) {
      const eff = getDcEffects()?.[meta.dcName] || getDcEffects()?.[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const keywords = ((eff?.keywords || []).map((k) => String(k).toUpperCase())) || [];
      for (const [trait, val] of Object.entries(ifTrait)) {
        if (keywords.includes(String(trait).toUpperCase()) && val > n) n = val;
      }
    }
    const targetMsgId = findMsgIdForFigureKey(game, playerNum, targetFk, dcMessageMeta);
    if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find target health state.' };
    const healthState = dcHealthState.get(targetMsgId) || [];
    const tm = targetFk.match(/-(\d+)-(\d+)$/);
    const targetFigIndex = tm ? parseInt(tm[2], 10) : 0;
    const entry_ = healthState[targetFigIndex];
    if (!entry_ || !Array.isArray(entry_)) return { applied: true, logMessage: 'Target has no damage to recover.' };
    const [cur, max] = entry_;
    const mx = max ?? cur;
    if (mx == null || cur == null) return { applied: true, logMessage: 'No damage to recover.' };
    const damage = mx - cur;
    if (damage <= 0) return { applied: true, logMessage: 'No damage to recover.' };
    const heal = Math.min(n, damage);
    healthState[targetFigIndex] = [cur + heal, mx];
    dcHealthState.set(targetMsgId, healthState);
    const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(targetMsgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    return { applied: true, logMessage: `Adjacent figure recovered ${heal} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [targetMsgId] };
  }

  // ccEffect: recoverDamage (Recovery) — recover N damage on activating figure(s); requires dcHealthState, msgId
  if (entry.type === 'ccEffect' && typeof entry.recoverDamage === 'number' && entry.recoverDamage > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState, msgId } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const actMsgId = msgId || findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!actMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: recovery requires health state.' };
    const healthState = dcHealthState.get(actMsgId) || [];
    if (!healthState.length) return { applied: false, manualMessage: 'Resolve manually: no health state for this DC.' };
    const n = entry.recoverDamage;
    let recovered = 0;
    for (let i = 0; i < healthState.length; i++) {
      const entry_ = healthState[i];
      if (!Array.isArray(entry_)) continue;
      const [cur, max] = entry_;
      const mx = max ?? cur;
      if (mx == null || cur == null) continue;
      const damage = mx - cur;
      if (damage <= 0) continue;
      const heal = Math.min(n, damage);
      healthState[i] = [cur + heal, mx];
      recovered = heal;
      break;
    }
    if (recovered > 0) {
      dcHealthState.set(actMsgId, healthState);
      const dcMessageIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcMessageIds || []).indexOf(actMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
      return { applied: true, logMessage: `Recovered ${recovered} Damage.`, refreshDcEmbed: true };
    }
    return { applied: true, logMessage: 'No damage to recover.' };
  }

  // ccEffect: discardHarmfulFromAdjacentFigures (Regroup) — discard Stun, Weaken, Bleed from adjacent friendly figures
  if (entry.type === 'ccEffect' && entry.discardHarmfulFromAdjacentFigures) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) return { applied: true, logMessage: 'No adjacent friendly figures.' };
    const HARMFUL = ['Stun', 'Weaken', 'Bleed'];
    game.figureConditions = game.figureConditions || {};
    let discarded = 0;
    for (const fk of adjacent) {
      const existing = game.figureConditions[fk] || [];
      const kept = existing.filter((c) => !HARMFUL.includes(c));
      if (kept.length < existing.length) {
        game.figureConditions[fk] = kept.length ? kept : [];
        discarded += existing.length - kept.length;
      }
    }
    return {
      applied: true,
      logMessage: discarded > 0 ? `Discarded ${discarded} HARMFUL condition(s) from ${adjacent.length} adjacent figure(s).` : 'No HARMFUL conditions on adjacent figures.',
      refreshBoard: discarded > 0,
    };
  }

  // ccEffect: discardHarmfulConditions (Rally) — discard Stun, Weaken, Bleed from activating figures
  if (entry.type === 'ccEffect' && entry.discardHarmfulConditions) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const HARMFUL = ['Stun', 'Weaken', 'Bleed'];
    game.figureConditions = game.figureConditions || {};
    let discarded = 0;
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      const kept = existing.filter((c) => !HARMFUL.includes(c));
      if (kept.length < existing.length) {
        game.figureConditions[fk] = kept.length ? kept : [];
        discarded += existing.length - kept.length;
      }
    }
    return {
      applied: true,
      logMessage: discarded > 0 ? `Discarded ${discarded} HARMFUL condition(s).` : 'No HARMFUL conditions to discard.',
      refreshDcEmbed: discarded > 0,
      refreshDcEmbedMsgIds: discarded > 0 ? [msgId] : undefined,
      refreshBoard: discarded > 0,
    };
  }

  // ccEffect: defenderStrain (Escalating Hostility) — after attack, defender suffers N Strain (strain applied as damage to health)
  if (entry.type === 'ccEffect' && typeof entry.defenderStrain === 'number' && entry.defenderStrain > 0) {
    const { game, playerNum, combat, dcMessageMeta, dcHealthState } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !cbt?.target?.figureKey) return { applied: false, manualMessage: 'Resolve manually: play after an attack (defender must be the target).' };
    const defenderPlayerNum = cbt.defenderPlayerNum ?? (cbt.attackerPlayerNum === 1 ? 2 : 1);
    const targetFk = cbt.target.figureKey;
    if (!dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
    const targetMsgId = findMsgIdForFigureKey(game, defenderPlayerNum, targetFk, dcMessageMeta);
    if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find defender.' };
    const targetMeta = dcMessageMeta.get(targetMsgId);
    if (!targetMeta) return { applied: false, manualMessage: 'Resolve manually: could not find defender deployment.' };
    const targetKeys = getFigureKeysForDcMsg(game, defenderPlayerNum, targetMeta);
    const targetIdx = targetKeys.indexOf(targetFk);
    if (targetIdx < 0) return { applied: false, manualMessage: 'Resolve manually: could not find defender figure index.' };
    const healthState = dcHealthState.get(targetMsgId) || [];
    const entry_ = healthState[targetIdx];
    if (!Array.isArray(entry_) || entry_.length < 1) return { applied: false, manualMessage: 'Resolve manually: no health state for defender.' };
    const n = entry.defenderStrain;
    const [cur, max] = entry_;
    const newCur = Math.max(0, (cur ?? max ?? 0) - n);
    healthState[targetIdx] = [newCur, max];
    dcHealthState.set(targetMsgId, healthState);
    const dcMessageIds = defenderPlayerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = defenderPlayerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(targetMsgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    return {
      applied: true,
      logMessage: `Defender suffered ${n} Strain.`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
  }

  // ccEffect: applyFocus + attackBonusHits combo (Primary Target) — both Focus and +N Hit
  if (entry.type === 'ccEffect' && entry.applyFocus && typeof entry.attackBonusHits === 'number') {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring attack (as the attacker).' };
    }
    let focusApplied = false;
    if (dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (msgId) {
        const meta = dcMessageMeta.get(msgId);
        if (meta) {
          const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
          if (figureKeys.length > 0) {
            game.figureConditions = game.figureConditions || {};
            for (const fk of figureKeys) {
              const existing = game.figureConditions[fk] || [];
              if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
            }
            focusApplied = true;
          }
        }
      }
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + entry.attackBonusHits;
    const focusPart = focusApplied ? 'Became Focused. ' : '';
    return { applied: true, logMessage: `${focusPart}+${entry.attackBonusHits} Hit added to this attack.`, refreshDcEmbed: focusApplied, refreshBoard: focusApplied };
  }

  // ccEffect: applyFocus + attackSurgeBonus combo (Master Operative) — both Focus and +1 Surge
  if (entry.type === 'ccEffect' && entry.applyFocus && typeof entry.attackSurgeBonus === 'number') {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring attack (as the attacker).' };
    }
    let focusApplied = false;
    if (dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (msgId) {
        const meta = dcMessageMeta.get(msgId);
        if (meta) {
          const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
          if (figureKeys.length > 0) {
            game.figureConditions = game.figureConditions || {};
            for (const fk of figureKeys) {
              const existing = game.figureConditions[fk] || [];
              if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
            }
            focusApplied = true;
          }
        }
      }
    }
    const n = entry.attackSurgeBonus;
    if (cbt.surgeRemaining != null) cbt.surgeRemaining = (cbt.surgeRemaining || 0) + n;
    else cbt.surgeBonus = (cbt.surgeBonus || 0) + n;
    const focusPart = focusApplied ? 'Became Focused. ' : '';
    return { applied: true, logMessage: `${focusPart}+${n} Surge added to this attack.`, refreshDcEmbed: focusApplied, refreshBoard: focusApplied };
  }

  // ccEffect: mpCost + applyFocus (e.g. Shared Experience — spend 3 MP to become Focused)
  if (entry.type === 'ccEffect' && entry.applyFocus && typeof entry.mpCost === 'number' && entry.mpCost > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    const remaining = bank.remaining ?? 0;
    if (remaining < entry.mpCost) {
      return { applied: false, manualMessage: `Resolve manually: need ${entry.mpCost} MP to spend (have ${remaining}).` };
    }
    bank.remaining = remaining - entry.mpCost;
    game.movementBank[msgId] = bank;
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    return { applied: true, logMessage: `Spent ${entry.mpCost} MP and became Focused.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
  }

  // ccEffect: Focus / Meditation — apply Focus to activating figures; requires active activation
  // Optional: readyActiveDc: true → also unexhaust/ready the active DC embed (e.g. Debts Repaid)
  if (abilityId === 'Focus' || (entry.type === 'ccEffect' && entry.applyFocus)) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    if (entry.readyActiveDc) {
      return { applied: true, logMessage: 'Became Focused. Readied active Deployment card.', readyDcMsgIds: [msgId], refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
    }
    return { applied: true, logMessage: entry.logMessage || 'Became Focused.', refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true, conditionCardsToPost: ['Focus'] };
  }

  // dcSpecial: mpBonus + applyFocus (e.g. Get into Position — gain MP and become Focused)
  if (entry.type === 'dcSpecial' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0 && entry.applyFocus) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const playerNum = meta.playerNum;
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    // Add MP to movement bank
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    // Apply Focus to all figures in group
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Focus')) game.figureConditions[fk] = [...existing, 'Focus'];
    }
    return { applied: true, logMessage: `Gained ${entry.mpBonus} movement point${entry.mpBonus !== 1 ? 's' : ''}. Became Focused.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
  }

  // dcSpecial: applySelfCondition — apply Focus or Hide to own activating figures (e.g. Prowl, Inform-self)
  if (entry.type === 'dcSpecial' && entry.applySelfCondition) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for this activation.' };
    const cond = entry.applySelfCondition;
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes(cond)) game.figureConditions[fk] = [...existing, cond];
    }
    return { applied: true, logMessage: `Became ${cond}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true, conditionCardsToPost: [cond] };
  }

  // dcSpecial: recoverSelf — recover N damage from own activating figure(s)
  if (entry.type === 'dcSpecial' && typeof entry.recoverSelf === 'number' && entry.recoverSelf > 0) {
    const { game, msgId, meta, dcHealthState } = context;
    if (!game || !msgId || !meta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const healthState = dcHealthState.get(msgId);
    if (!healthState?.length || !Array.isArray(healthState[0])) return { applied: false, manualMessage: 'Resolve manually: no health state found for this figure.' };
    let remaining = entry.recoverSelf;
    let totalRecovered = 0;
    for (let i = 0; i < healthState.length && remaining > 0; i++) {
      const [cur, max] = healthState[i];
      if (cur == null || max == null) continue;
      const healed = Math.min(max - cur, remaining);
      healthState[i] = [cur + healed, max];
      totalRecovered += healed;
      remaining -= healed;
    }
    dcHealthState.set(msgId, healthState);
    const dcMessageIds = meta.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = meta.playerNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(msgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    const freeMovePart = entry.freeMoveBonus > 0 ? ` Gained ${entry.freeMoveBonus} free movement point${entry.freeMoveBonus !== 1 ? 's' : ''} — use the Move button.` : '';
    if (entry.freeMoveBonus > 0) {
      game.movementBank = game.movementBank || {};
      const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
      bank.total = (bank.total ?? 0) + entry.freeMoveBonus;
      bank.remaining = (bank.remaining ?? 0) + entry.freeMoveBonus;
      game.movementBank[msgId] = bank;
    }
    return {
      applied: true,
      logMessage: totalRecovered > 0 ? `Recovered ${totalRecovered} Damage.${freeMovePart}` : `Already at full health.${freeMovePart}`,
      refreshDcEmbed: true,
    };
  }

  // dcSpecial: healFriendlyAdjacent (Stim Canister) — one adjacent friendly recovers N damage
  if (entry.type === 'dcSpecial' && typeof entry.healFriendlyAdjacent === 'number' && entry.healFriendlyAdjacent > 0) {
    const { game, msgId, meta, dcMessageMeta, dcHealthState, targetFigureKey } = context;
    if (!game || !msgId || !meta || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const label = entry.label || 'Stim Canister';

    // Helper: apply heal to a chosen figureKey
    const applyHealTo = (fk) => {
      const fkMatch = fk.match(/^(.+)-(\d+)-(\d+)$/);
      let adjMsgId = null;
      if (fkMatch) {
        const [, adjDcName, adjDgIndex] = fkMatch;
        for (const [id, m] of dcMessageMeta) {
          if (m.playerNum !== meta.playerNum) continue;
          const mDg = (m.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
          if (m.dcName === adjDcName && mDg === adjDgIndex) { adjMsgId = id; break; }
        }
      }
      const adjLabel = fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk;
      if (!adjMsgId) return { applied: false, manualMessage: `Resolve manually: could not locate DC for ${adjLabel}.` };
      const adjHealthState = dcHealthState.get(adjMsgId);
      if (!adjHealthState?.length || !Array.isArray(adjHealthState[0])) return { applied: false, manualMessage: `Resolve manually: health state not found for ${adjLabel}.` };
      let remaining = entry.healFriendlyAdjacent;
      let totalRecovered = 0;
      for (let i = 0; i < adjHealthState.length && remaining > 0; i++) {
        const [cur, max] = adjHealthState[i];
        if (cur == null || max == null) continue;
        const healed = Math.min(max - cur, remaining);
        adjHealthState[i] = [cur + healed, max];
        totalRecovered += healed;
        remaining -= healed;
      }
      dcHealthState.set(adjMsgId, adjHealthState);
      const adjMeta2 = dcMessageMeta.get(adjMsgId);
      const dcMsgIds = adjMeta2?.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = adjMeta2?.playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx = (dcMsgIds || []).indexOf(adjMsgId);
      if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...adjHealthState];
      const msg = totalRecovered > 0 ? `**${label}** — ${adjLabel} recovered ${totalRecovered} Damage.` : `**${label}** — ${adjLabel} is already at full health.`;
      return { applied: true, logMessage: msg, refreshDcEmbed: true, refreshDcEmbedMsgIds: [adjMsgId] };
    };

    // Second call: player chose a target
    if (targetFigureKey != null) return applyHealTo(targetFigureKey);

    // First call: enumerate adjacent friendly figures
    const activatingKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === meta.playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) return { applied: true, logMessage: `**${label}** — No adjacent friendly figure to heal.` };
    if (adjacent.length === 1) return applyHealTo(adjacent[0]);
    // Multiple adjacents: let player choose
    const choiceOptions = adjacent.map((fk) => fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk);
    return { applied: false, requiresChoice: true, choiceOptions, targetFigureKeys: adjacent };
  }

  // dcSpecial: healAndClearConditionFriendlyAdjacent (Force Heal) — chosen adjacent friendly recovers 1 Damage and discards 1 HARMFUL condition
  if (entry.type === 'dcSpecial' && entry.healAndClearConditionFriendlyAdjacent) {
    const HARMFUL = ['Stun', 'Weaken', 'Bleed'];
    const { game, msgId, meta, dcMessageMeta, dcHealthState, targetFigureKey } = context;
    if (!game || !msgId || !meta || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };

    // Helper to apply heal+condition-clear to a specific figureKey
    const applyTo = (fk) => {
      const fkMatch = fk.match(/^(.+)-(\d+)-(\d+)$/);
      let adjMsgId = null;
      if (fkMatch) {
        const [, adjDcName, adjDgIndex] = fkMatch;
        for (const [id, m] of dcMessageMeta) {
          if (m.playerNum !== meta.playerNum) continue;
          const mDg = (m.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
          if (m.dcName === adjDcName && mDg === adjDgIndex) { adjMsgId = id; break; }
        }
      }
      const adjLabel = fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk;
      const parts = [];
      if (adjMsgId) {
        const adjHealth = dcHealthState.get(adjMsgId);
        if (adjHealth?.length && Array.isArray(adjHealth[0])) {
          const [cur, max] = adjHealth[0];
          if (cur != null && max != null && cur < max) {
            adjHealth[0] = [cur + 1, max];
            dcHealthState.set(adjMsgId, adjHealth);
            const adjMeta2 = dcMessageMeta.get(adjMsgId);
            const dList = adjMeta2?.playerNum === 1 ? game.p1DcList : game.p2DcList;
            const dIds = adjMeta2?.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
            const idx = (dIds || []).indexOf(adjMsgId);
            if (idx >= 0 && dList?.[idx]) dList[idx].healthState = [...adjHealth];
            parts.push('recovered 1 Damage');
          } else {
            parts.push('already at full health');
          }
        }
      }
      game.figureConditions = game.figureConditions || {};
      const existing = game.figureConditions[fk] || [];
      const harmfulIdx = existing.findIndex((c) => HARMFUL.includes(c));
      if (harmfulIdx !== -1) {
        const removed = existing[harmfulIdx];
        game.figureConditions[fk] = existing.filter((_, i) => i !== harmfulIdx);
        parts.push(`discarded ${removed}`);
      } else {
        parts.push('no HARMFUL condition to discard');
      }
      return { adjMsgId, adjLabel, parts };
    };

    // If a choice was already made (second call via handleDcAbilityChoice):
    if (targetFigureKey != null) {
      const { adjMsgId, adjLabel, parts } = applyTo(targetFigureKey);
      const refreshIds = adjMsgId ? [adjMsgId] : [];
      return { applied: true, logMessage: `**Force Heal** — ${adjLabel}: ${parts.join(', ')}.`, refreshDcEmbed: refreshIds.length > 0, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
    }

    // First call: enumerate adjacent friendly targets
    const activatingKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === meta.playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) return { applied: true, logMessage: '**Force Heal** — No adjacent friendly figure to heal.' };
    if (adjacent.length === 1) {
      const { adjMsgId, adjLabel, parts } = applyTo(adjacent[0]);
      const refreshIds = adjMsgId ? [adjMsgId] : [];
      return { applied: true, logMessage: `**Force Heal** — ${adjLabel}: ${parts.join(', ')}.`, refreshDcEmbed: refreshIds.length > 0, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
    }
    // Multiple options: show choice buttons
    const choiceOptions = adjacent.map((fk) => fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk);
    return { applied: false, requiresChoice: true, choiceOptions, targetFigureKeys: adjacent };
  }

  // dcSpecial: focusFriendlyAdjacent (Inform) — 1 adjacent friendly becomes Focused
  if (entry.type === 'dcSpecial' && typeof entry.focusFriendlyAdjacent === 'number' && entry.focusFriendlyAdjacent > 0) {
    const { game, msgId, meta, targetFigureKey } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const label = entry.label || 'Inform';

    const applyFocus = (targets) => {
      game.figureConditions = game.figureConditions || {};
      const conditioned = [];
      for (const fk of targets) {
        const existing = game.figureConditions[fk] || [];
        if (!existing.includes('Focus')) {
          game.figureConditions[fk] = [...existing, 'Focus'];
          conditioned.push(fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk);
        }
      }
      const msg = conditioned.length > 0
        ? `**${label}** — ${conditioned.join(', ')} became Focused.`
        : `**${label}** — Adjacent figure is already Focused.`;
      return { applied: true, logMessage: msg, refreshBoard: true, conditionCardsToPost: conditioned.length > 0 ? ['Focus'] : [] };
    };

    // Second call: player chose a target
    if (targetFigureKey != null) return applyFocus([targetFigureKey]);

    const activatingKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === meta.playerNum && !activatingKeys.includes(figureKey)) adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) return { applied: true, logMessage: `**${label}** — No adjacent friendly figure to apply Focused to.` };
    if (adjacent.length <= entry.focusFriendlyAdjacent) return applyFocus(adjacent.slice(0, entry.focusFriendlyAdjacent));
    // Multiple options: let player choose
    const choiceOptions = adjacent.map((fk) => fk.match(/^(.+)-\d+-\d+$/)?.[1] || fk);
    return { applied: false, requiresChoice: true, choiceOptions, targetFigureKeys: adjacent };
  }

  // dcSpecial: drawCCIfAdjacentTerminal (Scomp Link) — draw N CC only if the activating figure is adjacent to a terminal
  if (entry.type === 'dcSpecial' && typeof entry.drawCCIfAdjacentTerminal === 'number' && entry.drawCCIfAdjacentTerminal > 0) {
    const { game, meta, msgId } = context;
    if (!game || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Find activating figure's position
    const figureKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const figKey = figureKeys[selectedFig] || figureKeys[0];
    const figPos = figKey ? game.figurePositions?.[meta.playerNum]?.[figKey] : null;
    // Get terminal positions for current map
    const mapId = game.selectedMap?.id;
    const terminals = (mapId && getMapTokensData) ? (getMapTokensData()[mapId]?.terminals || []) : [];
    // Check adjacency: Manhattan distance === 1 to any terminal
    let adjacentTerminal = null;
    if (figPos && terminals.length > 0) {
      const fp = parseCoord(figPos);
      for (const t of terminals) {
        const tp = parseCoord(String(t).toLowerCase());
        if (Math.abs(fp.col - tp.col) + Math.abs(fp.row - tp.row) === 1) { adjacentTerminal = t; break; }
      }
    }
    if (!adjacentTerminal) {
      return { applied: false, manualMessage: `**Scomp Link** — R2-D2 is not adjacent to a terminal${terminals.length === 0 ? ' (no terminals found for this map)' : ''}.` };
    }
    const n = entry.drawCCIfAdjacentTerminal;
    const drew = drawCards(game, meta.playerNum, n);
    if (!drew.length) return { applied: false, manualMessage: 'No Command cards left in deck to draw.' };
    return {
      applied: true,
      logMessage: `**Scomp Link** — R2-D2 is adjacent to terminal **${String(adjacentTerminal).toUpperCase()}**. Drew ${drew.length} Command card${drew.length !== 1 ? 's' : ''}.`,
      drewCards: drew,
    };
  }

  // ccEffect: applyHide only (Hide in Plain Sight, Guerilla Warfare) — apply Hide to activating figures during activation
  if (entry.type === 'ccEffect' && entry.applyHide && !entry.applyFocus) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Hide')) game.figureConditions[fk] = [...existing, 'Hide'];
    }
    return { applied: true, logMessage: 'Became Hidden.' };
  }

  // ccEffect: nextAttackBonusSurgeAbilities (Cruel Strike) — next attack gains surge options; consumed when combat starts
  if (entry.type === 'ccEffect' && Array.isArray(entry.nextAttackBonusSurgeAbilities) && entry.nextAttackBonusSurgeAbilities.length > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    let pnum = playerNum;
    if (!pnum && dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, 1, dcMessageMeta) || findActiveActivationMsgId(game, 2, dcMessageMeta);
      const meta = msgId ? dcMessageMeta.get(msgId) : null;
      pnum = meta?.playerNum;
    }
    if (!pnum) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
    game.nextAttackBonusSurgeAbilities[pnum] = entry.nextAttackBonusSurgeAbilities;
    const labels = entry.nextAttackBonusSurgeAbilities.join(', ');
    return { applied: true, logMessage: `Your next attack gains surge abilities: ${labels}.` };
  }

  // ccEffect: nextAttackBonusPierce (Expose Weakness) — next attack gains +N Pierce; consumed when combat declared
  if (entry.type === 'ccEffect' && typeof entry.nextAttackBonusPierce === 'number' && entry.nextAttackBonusPierce > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.nextAttackBonusPierce = game.nextAttackBonusPierce || {};
    game.nextAttackBonusPierce[playerNum] = entry.nextAttackBonusPierce;
    return {
      applied: true,
      logMessage: `Your next attack gains +${entry.nextAttackBonusPierce} Pierce (honor: use vs the chosen adjacent hostile).`,
    };
  }

  // ccEffect: nextAttacksBonusHits (Beatdown) — +N Hit to next M attacks by this player
  const nb = entry.type === 'ccEffect' && entry.nextAttacksBonusHits;
  if (nb && typeof nb.count === 'number' && nb.count > 0 && typeof nb.bonus === 'number' && nb.bonus > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
    game.nextAttacksBonusHits[playerNum] = { count: nb.count, bonus: nb.bonus };
    const nbc = entry.nextAttacksBonusConditions;
    if (nbc && typeof nbc.count === 'number' && nbc.count > 0 && Array.isArray(nbc.conditions) && nbc.conditions.length > 0) {
      game.nextAttacksBonusConditions = game.nextAttacksBonusConditions || {};
      game.nextAttacksBonusConditions[playerNum] = { count: nbc.count, conditions: nbc.conditions };
    }
    const condPart = (nbc?.conditions?.length) ? ` and ${nbc.conditions.join(', ')}` : '';
    return {
      applied: true,
      logMessage: `Next ${nb.count} attack(s) by your figures this activation gain +${nb.bonus} Hit to results${condPart}.`,
    };
  }

  // ccEffect: attackBonusHitsFromDefeatedFriendly (Honoring the Fallen) — +N Hit per defeated friendly figure, cap M
  if (entry.type === 'ccEffect' && typeof entry.attackBonusHitsFromDefeatedFriendly === 'number' && typeof entry.attackBonusHitsFromDefeatedMax === 'number') {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    const defeated = countDefeatedFriendlyFigures(game, playerNum);
    const bonus = Math.min(defeated * entry.attackBonusHitsFromDefeatedFriendly, entry.attackBonusHitsFromDefeatedMax);
    if (bonus <= 0) {
      return { applied: true, logMessage: 'No defeated friendly figures; no bonus.' };
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + bonus;
    return { applied: true, logMessage: `+${bonus} Hit (${defeated} defeated friendly figure${defeated === 1 ? '' : 's'}).` };
  }

  // ccEffect: attackBonusHits (Positioning Advantage) — +N Hit to this attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackBonusHits === 'number' && entry.attackBonusHits > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + entry.attackBonusHits;
    return {
      applied: true,
      logMessage: `+${entry.attackBonusHits} Hit added to this attack.`,
    };
  }

  // ccEffect: attackBonusSurgeAbilities (Spinning Kick) — add surge options to this attack; attacker only
  if (entry.type === 'ccEffect' && Array.isArray(entry.attackBonusSurgeAbilities) && entry.attackBonusSurgeAbilities.length > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play while attacking (as the attacker)." };
    }
    cbt.bonusSurgeAbilities = cbt.bonusSurgeAbilities || [];
    for (const key of entry.attackBonusSurgeAbilities) {
      if (key && !cbt.bonusSurgeAbilities.includes(key)) cbt.bonusSurgeAbilities.push(key);
    }
    const labels = entry.attackBonusSurgeAbilities.join(', ');
    return {
      applied: true,
      logMessage: `This attack gains surge abilities: ${labels}.`,
    };
  }

  // ccEffect: attackBonusBlast — +N Blast to this attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackBonusBlast === 'number' && entry.attackBonusBlast > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring attack (as the attacker).' };
    }
    cbt.bonusBlast = (cbt.bonusBlast || 0) + entry.attackBonusBlast;
    return {
      applied: true,
      logMessage: `This attack gains Blast ${entry.attackBonusBlast}.`,
    };
  }

  // ccEffect: attackAccuracyBonus + attackBonusPierce (Sniper Configuration) — both in one branch so both apply
  if (entry.type === 'ccEffect' && typeof entry.attackAccuracyBonus === 'number' && typeof entry.attackBonusPierce === 'number') {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    if (entry.attackAccuracyBonus > 0) cbt.bonusAccuracy = (cbt.bonusAccuracy || 0) + entry.attackAccuracyBonus;
    if (entry.attackBonusPierce > 0) cbt.bonusPierce = (cbt.bonusPierce || 0) + entry.attackBonusPierce;
    return {
      applied: true,
      logMessage: `+${entry.attackAccuracyBonus} Accuracy and +${entry.attackBonusPierce} Pierce added to this attack.`,
    };
  }

  // ccEffect: attackBonusPierce — +N Pierce to this attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackBonusPierce === 'number' && entry.attackBonusPierce > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    cbt.bonusPierce = (cbt.bonusPierce || 0) + entry.attackBonusPierce;
    return {
      applied: true,
      logMessage: `+${entry.attackBonusPierce} Pierce added to this attack.`,
    };
  }

  // ccEffect: attackAccuracyBonus (Deadeye) — +N Accuracy to this attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackAccuracyBonus === 'number' && entry.attackAccuracyBonus > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    cbt.bonusAccuracy = (cbt.bonusAccuracy || 0) + entry.attackAccuracyBonus;
    return {
      applied: true,
      logMessage: `+${entry.attackAccuracyBonus} Accuracy added to this attack.`,
    };
  }

  // ccEffect: attackSurgeBonus (Blitz) — +N Surge during attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackSurgeBonus === 'number' && entry.attackSurgeBonus > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    const n = entry.attackSurgeBonus;
    if (cbt.surgeRemaining != null) {
      cbt.surgeRemaining = (cbt.surgeRemaining || 0) + n;
    } else {
      cbt.surgeBonus = (cbt.surgeBonus || 0) + n;
    }
    return {
      applied: true,
      logMessage: `+${n} Surge added to this attack.`,
    };
  }

  // ccEffect: defensePoolRemoveAll only when NOT attacker's activation (One in a Million)
  if (entry.type === 'ccEffect' && entry.defensePoolRemoveAll && entry.defensePoolRemoveOnlyWhenNotAttackerActivation) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    const attackerMsgId = cbt.attackerMsgId;
    if (game.dcActionsData?.[attackerMsgId]) {
      return { applied: false, manualMessage: "Resolve manually: One in a Million applies only when it is NOT your activation (e.g. Overwatch)." };
    }
    cbt.defensePoolRemoveAll = true;
    return { applied: true, logMessage: "Removed all dice from the defense pool." };
  }

  // ccEffect: defensePoolRemoveMax (Wild Fire) — attacker removes up to N dice from defender's pool when declaring attack
  if (entry.type === 'ccEffect' && typeof entry.defensePoolRemoveMax === 'number' && entry.defensePoolRemoveMax > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    cbt.defensePoolRemoveMax = (cbt.defensePoolRemoveMax || 0) + entry.defensePoolRemoveMax;
    return {
      applied: true,
      logMessage: `Remove up to ${entry.defensePoolRemoveMax} dice from the defense pool.`,
    };
  }

  // ccEffect: defenseBonusDiceFromAttacker + optional attackBonusDice (Wild Attack) — must run before attackBonusDice when both exist
  if (entry.type === 'ccEffect' && typeof entry.defenseBonusDiceFromAttacker === 'number' && entry.defenseBonusDiceFromAttacker > 0 && entry.defenseBonusDiceFromAttackerColor) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    const msgs = [];
    if (typeof entry.attackBonusDice === 'number' && entry.attackBonusDice > 0) {
      cbt.attackBonusDice = (cbt.attackBonusDice || 0) + entry.attackBonusDice;
      if (entry.attackBonusDiceColor) {
        cbt.attackBonusDiceColors = cbt.attackBonusDiceColors || [];
        const ac = String(entry.attackBonusDiceColor).toLowerCase();
        for (let i = 0; i < entry.attackBonusDice; i++) cbt.attackBonusDiceColors.push(ac);
      }
      msgs.push(`Added ${entry.attackBonusDice} attack die to the attack pool`);
    }
    cbt.defenseBonusDice = cbt.defenseBonusDice || [];
    const color = String(entry.defenseBonusDiceFromAttackerColor).toLowerCase();
    for (let i = 0; i < entry.defenseBonusDiceFromAttacker; i++) cbt.defenseBonusDice.push(color);
    const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
    msgs.push(`added ${entry.defenseBonusDiceFromAttacker} ${colorLabel} die to defense pool`);
    return { applied: true, logMessage: msgs.join('; ') + '.' };
  }

  // ccEffect: attackBonusDice (Tools for the Job) — add N dice to attack pool when declaring attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackBonusDice === 'number' && entry.attackBonusDice > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    cbt.attackBonusDice = (cbt.attackBonusDice || 0) + entry.attackBonusDice;
    if (entry.attackBonusDiceColor) {
      cbt.attackBonusDiceColors = cbt.attackBonusDiceColors || [];
      const color = String(entry.attackBonusDiceColor).toLowerCase();
      for (let i = 0; i < entry.attackBonusDice; i++) cbt.attackBonusDiceColors.push(color);
    }
    return {
      applied: true,
      logMessage: `Added ${entry.attackBonusDice} attack die to the attack pool.`,
    };
  }

  // ccEffect: defenseBonusDice (Brace for Impact) — add N dice of color to defense pool; defender only
  if (entry.type === 'ccEffect' && typeof entry.defenseBonusDice === 'number' && entry.defenseBonusDice > 0 && entry.defenseBonusDiceColor) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    const defenderPlayerNum = cbt?.attackerPlayerNum ? (cbt.attackerPlayerNum === 1 ? 2 : 1) : null;
    if (!game || !playerNum || !cbt || defenderPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while defending (as the defender).' };
    }
    cbt.defenseBonusDice = cbt.defenseBonusDice || [];
    const color = String(entry.defenseBonusDiceColor).toLowerCase();
    for (let i = 0; i < entry.defenseBonusDice; i++) cbt.defenseBonusDice.push(color);
    const colorLabel = color.charAt(0).toUpperCase() + color.slice(1);
    return {
      applied: true,
      logMessage: `Added ${entry.defenseBonusDice} ${colorLabel} die to defense pool.`,
    };
  }

  // ccEffect: applyDefenseBonusBlock and/or applyDefenseBonusEvade (Brace Yourself, Stroke of Brilliance)
  if (entry.type === 'ccEffect' && ((typeof entry.applyDefenseBonusBlock === 'number' && entry.applyDefenseBonusBlock > 0) || (typeof entry.applyDefenseBonusEvade === 'number' && entry.applyDefenseBonusEvade > 0))) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    const defenderPlayerNum = cbt?.attackerPlayerNum ? (cbt.attackerPlayerNum === 1 ? 2 : 1) : null;
    if (!game || !playerNum || !cbt || defenderPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when an attack targeting you is declared (as the defender)." };
    }
    if (entry.defenseBonusOnlyWhenNotAttackerActivation) {
      const attackerMsgId = cbt.attackerMsgId;
      if (game.dcActionsData?.[attackerMsgId]) {
        return { applied: false, manualMessage: "Resolve manually: +2 Block applies only when it is NOT the attacker's activation (e.g. Overwatch)." };
      }
    }
    const block = entry.applyDefenseBonusBlock || 0;
    const evade = entry.applyDefenseBonusEvade || 0;
    if (block) cbt.bonusBlock = (cbt.bonusBlock || 0) + block;
    if (evade) cbt.bonusEvade = (cbt.bonusEvade || 0) + evade;
    const parts = [];
    if (block) parts.push(`+${block} Block`);
    if (evade) parts.push(`+${evade} Evade`);
    return {
      applied: true,
      logMessage: `${parts.join(' and ')} added to defense results.`,
    };
  }

  // ccEffect: applyHideWhenDefending (Camouflage) — apply Hide to defender when attack declared on you
  if (entry.type === 'ccEffect' && entry.applyHideWhenDefending) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    const defenderPlayerNum = cbt?.attackerPlayerNum ? (cbt.attackerPlayerNum === 1 ? 2 : 1) : null;
    if (!game || !playerNum || !cbt?.target?.figureKey || defenderPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared (as the defender).' };
    }
    const figureKey = cbt.target.figureKey;
    game.figureConditions = game.figureConditions || {};
    const existing = game.figureConditions[figureKey] || [];
    if (!existing.includes('Hide')) {
      game.figureConditions[figureKey] = [...existing, 'Hide'];
    }
    return { applied: true, logMessage: 'Became Hidden.' };
  }

  // ccEffect: roundDefenseBonusBlock / roundDefenseBonusEvade (Take Position, Survival Instincts, Cavalry Charge) — until end of round
  if (entry.type === 'ccEffect' && ((typeof entry.roundDefenseBonusBlock === 'number' && entry.roundDefenseBonusBlock > 0) || (typeof entry.roundDefenseBonusEvade === 'number' && entry.roundDefenseBonusEvade > 0)) && !entry.roundDefenderBonusBlockPerEvade) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDefenseBonusBlock = game.roundDefenseBonusBlock || {};
    game.roundDefenseBonusEvade = game.roundDefenseBonusEvade || {};
    const block = entry.roundDefenseBonusBlock || 0;
    const evade = entry.roundDefenseBonusEvade || 0;
    if (block) game.roundDefenseBonusBlock[playerNum] = (game.roundDefenseBonusBlock[playerNum] || 0) + block;
    if (evade) game.roundDefenseBonusEvade[playerNum] = (game.roundDefenseBonusEvade[playerNum] || 0) + evade;
    const parts = [];
    if (block) parts.push(`+${block} Block`);
    if (evade) parts.push(`+${evade} Evade`);
    // Cavalry Charge: friendly TROOPERs get +N Hit when attacking this round
    if (entry.trooperRoundAttackHitBonus) {
      game.roundTrooperAttackHitBonus = game.roundTrooperAttackHitBonus || {};
      game.roundTrooperAttackHitBonus[playerNum] = (game.roundTrooperAttackHitBonus[playerNum] || 0) + entry.trooperRoundAttackHitBonus;
      parts.push(`+${entry.trooperRoundAttackHitBonus} Hit for friendly TROOPERs attacking`);
    }
    // Fuel Upgrade: friendly VEHICLEs get +N Speed this round
    if (entry.vehicleSpeedBonusRound) {
      game.roundVehicleSpeedBonus = game.roundVehicleSpeedBonus || {};
      game.roundVehicleSpeedBonus[playerNum] = (game.roundVehicleSpeedBonus[playerNum] || 0) + entry.vehicleSpeedBonusRound;
      parts.push(`+${entry.vehicleSpeedBonusRound} Speed for friendly VEHICLEs`);
    }
    // Deflection: if defender takes 0 damage this round, attacker suffers N damage after combat
    if (entry.deflectionCounterDamage) {
      game.deflectionPending = game.deflectionPending || {};
      game.deflectionPending[playerNum] = (game.deflectionPending[playerNum] || 0) + entry.deflectionCounterDamage;
    }
    return {
      applied: true,
      logMessage: `Until end of round, apply ${parts.join(' and ')} when defending.`,
    };
  }

  // ccEffect: roundDefenderBonusBlockPerEvade + optional evadeTokenGain (Personal Energy Shield)
  if (entry.type === 'ccEffect' && typeof entry.roundDefenderBonusBlockPerEvade === 'number' && entry.roundDefenderBonusBlockPerEvade > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDefenderBonusBlockPerEvade = game.roundDefenderBonusBlockPerEvade || {};
    game.roundDefenderBonusBlockPerEvade[playerNum] = (game.roundDefenderBonusBlockPerEvade[playerNum] || 0) + entry.roundDefenderBonusBlockPerEvade;
    if (entry.evadeTokenGain && dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (msgId) {
        const meta = dcMessageMeta.get(msgId);
        const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
        game.figurePowerTokens = game.figurePowerTokens || {};
        for (const fk of figureKeys) {
          game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
          for (let i = 0; i < entry.evadeTokenGain; i++) game.figurePowerTokens[fk].push('Evade');
        }
      }
    }
    const evadeNote = entry.evadeTokenGain ? `Gained ${entry.evadeTokenGain} Evade Token(s). ` : '';
    return {
      applied: true,
      logMessage: `${evadeNote}Until end of round, when defending apply +${entry.roundDefenderBonusBlockPerEvade} Block per Evade result.`,
    };
  }

  // ccEffect: roundAttackSurgeBonus (e.g. Smuggled Supplies) — until end of round, +N Surge when attacking
  if (entry.type === 'ccEffect' && typeof entry.roundAttackSurgeBonus === 'number' && entry.roundAttackSurgeBonus > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundAttackSurgeBonus = game.roundAttackSurgeBonus || {};
    const n = entry.roundAttackSurgeBonus;
    game.roundAttackSurgeBonus[playerNum] = (game.roundAttackSurgeBonus[playerNum] || 0) + n;
    return {
      applied: true,
      logMessage: `Until end of round, apply +${n} Surge to your attack results.`,
    };
  }

  // ccEffect: mpAfterAttack (Hit and Run) — set pending; MP added when combat resolves
  if (entry.type === 'ccEffect' && typeof entry.mpAfterAttack === 'number' && entry.mpAfterAttack > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.hitAndRunPendingMp = { msgId, amount: entry.mpAfterAttack };
    return {
      applied: true,
      logMessage: `Perform an attack. After it resolves, you gain ${entry.mpAfterAttack} movement point${entry.mpAfterAttack === 1 ? '' : 's'}.`,
    };
  }

  // ccEffect: mpBonus + chooseAdjacentHostileThen (e.g. Force Surge — gain 1 MP then choose adjacent hostile for damage/strain)
  // Second call (chosenFigureKey set): only apply damage, MP was already granted on first call.
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0 && entry.chooseAdjacentHostileThen) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const cah = entry.chooseAdjacentHostileThen;
    const { damage = 0, strain = 0 } = cah;
    const totalDamage = damage + strain;
    const oppNum = playerNum === 1 ? 2 : 1;
    // Second call: apply damage/conditions to chosen target (MP was already granted)
    if (chosenFigureKey) {
      if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
      const targetMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find target.' };
      const targetMeta = dcMessageMeta.get(targetMsgId);
      if (!targetMeta) return { applied: false, manualMessage: 'Resolve manually: could not find target.' };
      const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
      const targetIdx = targetKeys.indexOf(chosenFigureKey);
      if (targetIdx < 0) return { applied: false, manualMessage: 'Resolve manually: could not find target figure index.' };
      const healthState = dcHealthState.get(targetMsgId) || [];
      const hs = healthState[targetIdx];
      if (!Array.isArray(hs) || hs.length < 1) return { applied: false, manualMessage: 'Resolve manually: no health state for target.' };
      const [cur, max] = hs;
      healthState[targetIdx] = [Math.max(0, (cur ?? max ?? 0) - totalDamage), max];
      dcHealthState.set(targetMsgId, healthState);
      const dcMsgIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcListArr = oppNum === 1 ? game.p1DcList : game.p2DcList;
      const idx2 = (dcMsgIds || []).indexOf(targetMsgId);
      if (idx2 >= 0 && dcListArr?.[idx2]) dcListArr[idx2].healthState = [...healthState];
      const strainPart2 = strain > 0 ? ` and ${strain} Strain` : '';
      const tName = targetMeta.displayName || targetMeta.dcName || chosenFigureKey;
      return { applied: true, logMessage: `**${tName}** suffered ${damage > 0 ? `${damage} Damage${strainPart2}` : `${strain} Strain`}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [targetMsgId] };
    }
    // First call: grant MP, then find adjacent hostiles and auto-apply or offer choice
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    if (totalDamage <= 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const mapId = game.selectedMap?.id;
    if (!mapId || activatingKeys.length === 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const hostileSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === oppNum) hostileSet.add(figureKey);
      }
    }
    const hostiles = [...hostileSet];
    if (hostiles.length === 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. No adjacent hostile.` };
    // Multiple adjacent hostiles: MP is granted; prompt player to pick damage target
    if (hostiles.length > 1) {
      const labels = hostiles.map((fk) => {
        const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
        const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
        const baseName = tMeta?.displayName || tMeta?.dcName || fk;
        const figIdx = parseInt(fk.split('-').pop(), 10);
        const suffix = isNaN(figIdx) || figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
        return `${baseName}${suffix}`;
      });
      return { applied: false, requiresChoice: true, choiceOptions: labels, choiceValues: hostiles };
    }
    // Exactly 1 adjacent hostile: auto-apply if dcHealthState available
    if (!dcHealthState) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. Resolve manually: choose adjacent hostile for ${damage > 0 ? `${damage} Damage` : ''}${strain > 0 ? ` ${strain} Strain` : ''}.` };
    const targetFk = hostiles[0];
    const targetMsgId = findMsgIdForFigureKey(game, oppNum, targetFk, dcMessageMeta);
    if (!targetMsgId) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const targetMeta = dcMessageMeta.get(targetMsgId);
    if (!targetMeta) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
    const targetIdx = targetKeys.indexOf(targetFk);
    if (targetIdx < 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const healthState = dcHealthState.get(targetMsgId) || [];
    const hs0 = healthState[targetIdx];
    if (!Array.isArray(hs0) || hs0.length < 1) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const [cur, max] = hs0;
    healthState[targetIdx] = [Math.max(0, (cur ?? max ?? 0) - totalDamage), max];
    dcHealthState.set(targetMsgId, healthState);
    const dcMsgIds2 = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcListArr2 = oppNum === 1 ? game.p1DcList : game.p2DcList;
    const idx2 = (dcMsgIds2 || []).indexOf(targetMsgId);
    if (idx2 >= 0 && dcListArr2?.[idx2]) dcListArr2[idx2].healthState = [...healthState];
    const strainPart = strain > 0 ? ` and ${strain} Strain` : '';
    return {
      applied: true,
      logMessage: `Gained ${entry.mpBonus} MP. Adjacent hostile suffered ${damage > 0 ? `${damage} Damage${strainPart}` : `${strain} Strain`} (${totalDamage} total).`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
  }

  // ccEffect: chooseAdjacentHostileThen — choose one adjacent hostile figure, apply damage and/or strain.
  // Supports: damage, strain, scaleStrainToRound, weaken/stun/bleed (conditions on target), selfStrain (cost),
  //           healSelfIfTrait: {trait, amount} — recover N damage if activating DC has the named trait.
  // First call: finds adjacent hostiles; if exactly 1, auto-resolves; if 2+, returns requiresChoice so a picker is shown.
  // Second call: context.chosenFigureKey is set (from pendingCcChoice.choiceValues[choiceIndex]); applies directly.
  if (entry.type === 'ccEffect' && entry.chooseAdjacentHostileThen && (entry.chooseAdjacentHostileThen.damage > 0 || entry.chooseAdjacentHostileThen.strain > 0)) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    const cah = entry.chooseAdjacentHostileThen;
    const { damage = 0, selfStrain = 0, scaleStrainToRound = false } = cah;
    const strain = scaleStrainToRound ? (game?.round || 1) : (cah.strain || 0);
    const totalDamage = damage + strain;
    const targetConditions = [
      ...(cah.weaken ? ['Weaken'] : []),
      ...(cah.stun ? ['Stun'] : []),
      ...(cah.bleed ? ['Bleed'] : []),
    ];
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    // Shared: apply damage/strain/conditions to target; optionally apply selfStrain to activating figure
    const applyToFigureKey = (targetFk) => {
      if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
      const targetMsgId = findMsgIdForFigureKey(game, oppNum, targetFk, dcMessageMeta);
      if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find target deployment.' };
      const targetMeta = dcMessageMeta.get(targetMsgId);
      if (!targetMeta) return { applied: false, manualMessage: 'Resolve manually: could not find target.' };
      const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
      const targetIdx = targetKeys.indexOf(targetFk);
      if (targetIdx < 0) return { applied: false, manualMessage: 'Resolve manually: could not find target figure index.' };
      const healthState = dcHealthState.get(targetMsgId) || [];
      const hs = healthState[targetIdx];
      if (!Array.isArray(hs) || hs.length < 1) return { applied: false, manualMessage: 'Resolve manually: no health state for target.' };
      const [cur, max] = hs;
      healthState[targetIdx] = [Math.max(0, (cur ?? max ?? 0) - totalDamage), max];
      dcHealthState.set(targetMsgId, healthState);
      const dcMessageIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList2 = oppNum === 1 ? game.p1DcList : game.p2DcList;
      const idx2 = (dcMessageIds || []).indexOf(targetMsgId);
      if (idx2 >= 0 && dcList2?.[idx2]) dcList2[idx2].healthState = [...healthState];
      // Apply conditions to target
      if (targetConditions.length > 0) {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[targetFk] || [];
        const toAdd = targetConditions.filter((c) => !existing.includes(c));
        if (toAdd.length > 0) game.figureConditions[targetFk] = [...existing, ...toAdd];
      }
      // Apply self-strain to activating figure(s)
      const refreshIds = [targetMsgId];
      let selfStrainMsg = '';
      if (selfStrain > 0) {
        const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        if (selfMsgId && dcHealthState) {
          const selfMeta = dcMessageMeta.get(selfMsgId);
          const selfKeys = selfMeta ? getFigureKeysForDcMsg(game, playerNum, selfMeta) : [];
          const selfHs = (dcHealthState.get(selfMsgId) || []).slice();
          for (let si = 0; si < selfKeys.length; si++) {
            const shs = selfHs[si];
            if (Array.isArray(shs) && shs.length >= 1) {
              const [sCur, sMax] = shs;
              selfHs[si] = [Math.max(0, (sCur ?? sMax ?? 0) - selfStrain), sMax];
            }
          }
          dcHealthState.set(selfMsgId, selfHs);
          if (!refreshIds.includes(selfMsgId)) refreshIds.push(selfMsgId);
          selfStrainMsg = ` You suffered ${selfStrain} Strain.`;
        }
      }
      // Heal self if activating figure has the required trait (e.g. Force Drain: recover 3 if FORCE USER)
      let selfHealMsg = '';
      const healSIT = cah.healSelfIfTrait;
      if (healSIT?.trait && typeof healSIT.amount === 'number' && healSIT.amount > 0 && dcHealthState) {
        const healSelfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        if (healSelfMsgId) {
          const healSelfMeta = dcMessageMeta.get(healSelfMsgId);
          const selfDcStats = healSelfMeta ? getStatsForDc(healSelfMeta.dcName) : null;
          if (selfDcStats?.keywords?.includes(healSIT.trait)) {
            const selfKeys = healSelfMeta ? getFigureKeysForDcMsg(game, playerNum, healSelfMeta) : [];
            const selfHs = (dcHealthState.get(healSelfMsgId) || []).slice();
            let remaining = healSIT.amount;
            let totalHealed = 0;
            for (let si = 0; si < selfKeys.length && remaining > 0; si++) {
              const shs = selfHs[si];
              if (Array.isArray(shs) && shs.length >= 2) {
                const [sCur, sMax] = shs;
                const healAmt = Math.min(sMax - (sCur ?? 0), remaining);
                if (healAmt > 0) {
                  selfHs[si] = [(sCur ?? 0) + healAmt, sMax];
                  totalHealed += healAmt;
                  remaining -= healAmt;
                }
              }
            }
            if (totalHealed > 0) {
              dcHealthState.set(healSelfMsgId, selfHs);
              if (!refreshIds.includes(healSelfMsgId)) refreshIds.push(healSelfMsgId);
              selfHealMsg = ` You recovered ${totalHealed} Damage.`;
            }
          }
        }
      }
      const strainLabel = strain > 0 ? (damage > 0 ? ` and ${strain} Strain` : `${strain} Strain`) : '';
      const dmgLabel = damage > 0 ? `${damage} Damage` : '';
      const condPart = targetConditions.length > 0 ? `; target gains ${targetConditions.join(', ')}` : '';
      return { applied: true, logMessage: `Hostile suffered ${dmgLabel}${strainLabel}${condPart}.${selfStrainMsg}${selfHealMsg}`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
    };
    // Second pass: user already picked a figure (or an orStunInstead prefixed choice)
    if (chosenFigureKey) {
      if (typeof chosenFigureKey === 'string' && chosenFigureKey.startsWith('stun:')) {
        // orStunInstead: player chose to apply Stun instead of the main strain/damage effect
        const actualFk = chosenFigureKey.slice(5);
        const tMsgId = findMsgIdForFigureKey(game, oppNum, actualFk, dcMessageMeta);
        const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
        const tName = tMeta?.displayName || tMeta?.dcName || actualFk;
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[actualFk] || [];
        if (!existing.includes('Stun')) game.figureConditions[actualFk] = [...existing, 'Stun'];
        return { applied: true, logMessage: `**${tName}** becomes Stunned.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: tMsgId ? [tMsgId] : [] };
      }
      const strainKey = typeof chosenFigureKey === 'string' && chosenFigureKey.startsWith('strain:') ? chosenFigureKey.slice(7) : chosenFigureKey;
      return applyToFigureKey(strainKey);
    }
    // First pass: find adjacent hostiles
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const hostileSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === oppNum) hostileSet.add(figureKey);
      }
    }
    const hostiles = [...hostileSet];
    if (hostiles.length === 0) return { applied: true, logMessage: 'No adjacent hostile figure.' };
    // Helper to get a display label for a figure key
    const getFigLabel = (fk) => {
      const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
      const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
      const baseName = tMeta?.displayName || tMeta?.dcName || fk;
      const figIdx = parseInt(fk.split('-').pop(), 10);
      const suffix = isNaN(figIdx) || figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
      return `${baseName}${suffix}`;
    };
    // orStunInstead: present "N Strain" vs "Stun" choices (combined with target if multiple hostiles)
    if (cah.orStunInstead) {
      const strainN = (cah.strain || 0);
      const strainDesc = strainN > 0 ? `${strainN} Strain` : 'Strain effect';
      const combLabels = [];
      const combValues = [];
      for (const fk of hostiles) {
        const lbl = getFigLabel(fk);
        combLabels.push(hostiles.length > 1 ? `${strainDesc} on ${lbl}` : strainDesc);
        combValues.push(`strain:${fk}`);
        combLabels.push(hostiles.length > 1 ? `Stun ${lbl}` : 'Stun');
        combValues.push(`stun:${fk}`);
      }
      return { applied: false, requiresChoice: true, choiceOptions: combLabels, choiceValues: combValues };
    }
    if (hostiles.length === 1) return applyToFigureKey(hostiles[0]);
    // Multiple adjacent hostiles: prompt player to pick one
    const labels = hostiles.map(getFigLabel);
    return { applied: false, requiresChoice: true, choiceOptions: labels, choiceValues: hostiles };
  }

  // ccEffect: powerTokenGainToGroup (Ready Weapons) — distribute up to N tokens among figures in activating group (max 2 per figure)
  if (entry.type === 'ccEffect' && typeof entry.powerTokenGainToGroup === 'number' && entry.powerTokenGainToGroup > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress (play as Special Action during your activation).' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures in group.' };
    const totalToAdd = Math.min(entry.powerTokenGainToGroup, figureKeys.length * 2);
    game.figurePowerTokens = game.figurePowerTokens || {};
    const grants = [];
    let remaining = totalToAdd;
    for (const fk of figureKeys) {
      if (remaining <= 0) break;
      const current = (game.figurePowerTokens[fk] || []).length;
      const cap = 2 - current;
      const toAdd = Math.min(remaining, Math.max(0, cap));
      if (toAdd > 0) grants.push({ figureKey: fk, figName: fk, count: toAdd });
      remaining -= toAdd;
    }
    if (grants.length > 0) {
      game.pendingPowerTokenGrant = { grants, channelId: null, playerNum };
    }
    return { applied: true, requiresPowerTokenChoice: grants.length > 0, logMessage: `Distributed ${totalToAdd} Power Token(s) among figures in your group — choose type.` };
  }

  // ccEffect: claimInitiative only (I Make My Own Luck) — optional firstActivationFigureName
  if (entry.type === 'ccEffect' && entry.claimInitiative && !entry.exhaustOneDeploymentCard) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.initiativePlayerId = playerNum === 1 ? game.player1Id : game.player2Id;
    if (entry.firstActivationFigureName) game.firstActivationFigureName = entry.firstActivationFigureName;
    return {
      applied: true,
      logMessage: `Claimed the initiative token.${entry.firstActivationFigureName ? ` ${entry.firstActivationFigureName} must activate first this round.` : ''}`,
    };
  }

  // ccEffect: claimInitiative + exhaustOneDeploymentCard (Take Initiative)
  if (entry.type === 'ccEffect' && entry.claimInitiative && entry.exhaustOneDeploymentCard) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.initiativePlayerId = playerNum === 1 ? game.player1Id : game.player2Id;
    return {
      applied: true,
      logMessage: 'Claimed the initiative token. Exhaust one of your Deployment cards (use the Exhaust button on your DC).',
    };
  }

  // ccEffect: discardRandomFromHand + opponentDiscardRandomFromHand (Hostile Negotiation)
  if (entry.type === 'ccEffect' && typeof entry.discardRandomFromHand === 'number' && typeof entry.opponentDiscardRandomFromHand === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const oppNum = playerNum === 1 ? 2 : 1;
    const oppHandKey = oppNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const oppDiscardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const hand = (game[handKey] || []).slice();
    const oppHand = (game[oppHandKey] || []).slice();
    const n1 = Math.min(entry.discardRandomFromHand, hand.length);
    const n2 = Math.min(entry.opponentDiscardRandomFromHand, oppHand.length);
    const discarded1 = [];
    for (let i = 0; i < n1; i++) {
      const idx = Math.floor(Math.random() * hand.length);
      discarded1.push(hand.splice(idx, 1)[0]);
    }
    const discarded2 = [];
    for (let i = 0; i < n2; i++) {
      const idx = Math.floor(Math.random() * oppHand.length);
      discarded2.push(oppHand.splice(idx, 1)[0]);
    }
    game[handKey] = hand;
    game[discardKey] = (game[discardKey] || []).concat(discarded1);
    game[oppHandKey] = oppHand;
    game[oppDiscardKey] = (game[oppDiscardKey] || []).concat(discarded2);
    const parts = [];
    if (discarded1.length) parts.push(`You discarded ${discarded1.map((c) => `**${c}**`).join(', ')}`);
    if (discarded2.length) parts.push(`opponent discarded ${discarded2.length} card(s)`);
    return {
      applied: true,
      logMessage: parts.join('; ') + '.',
      refreshHand: true,
      refreshDiscard: true,
    };
  }

  // ccEffect: opponentDiscardFromHandChoice + selfStrainFromDiscardedCost (Intelligence Leak) — choiceIndex = index in opponent hand
  if (entry.type === 'ccEffect' && entry.opponentDiscardFromHandChoice && entry.selfStrainFromDiscardedCost) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const oppHandKey = oppNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const oppDiscardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const oppHand = (game[oppHandKey] || []).slice();
    const choiceIndex = context.choiceIndex;
    if (oppHand.length === 0) return { applied: false, manualMessage: "Opponent's hand is empty." };
    if (choiceIndex == null || choiceIndex < 0 || choiceIndex >= oppHand.length) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: oppHand.map((c, i) => `${i + 1}. ${c}`),
        choiceCount: oppHand.length,
        manualMessage: "Choose a card from opponent's hand to discard (you will suffer Strain equal to its cost).",
      };
    }
    const discarded = oppHand.splice(choiceIndex, 1)[0];
    game[oppHandKey] = oppHand;
    game[oppDiscardKey] = (game[oppDiscardKey] || []).concat(discarded);
    const eff = getCcEffect(discarded);
    const cost = typeof eff?.cost === 'number' ? eff.cost : 0;
    game.figureStrain = game.figureStrain || {};
    const msgId = context.msgId;
    const strainKey = msgId ? `msg:${msgId}` : `p${playerNum}`;
    game.figureStrain[strainKey] = (game.figureStrain[strainKey] || 0) + cost;
    return {
      applied: true,
      logMessage: `Discarded **${discarded}** from opponent's hand; you suffer ${cost} Strain.`,
      refreshOpponentHand: true,
    };
  }

  // ccEffect: readyAdjacentFriendlyDeploymentCard (New Orders) — present choiceOptions from dcList; chosenOption = DC to ready
  if (entry.type === 'ccEffect' && entry.readyAdjacentFriendlyDeploymentCard) {
    const { game, playerNum, dcMessageMeta, readyAdjacentFriendlyDcName, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const targetName = readyAdjacentFriendlyDcName || chosenOption;
    if (!targetName) {
      // Build choice list from friendly DCs (honor system: player picks an adjacent one)
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const opts = dcList
        .filter((dc) => dc && !dc.defeated)
        .map((dc) => (typeof dc === 'object' ? dc.displayName || dc.dcName : dc))
        .filter(Boolean);
      if (opts.length === 0) return { applied: false, manualMessage: 'No friendly Deployment cards to ready. Resolve manually.' };
      return { applied: false, requiresChoice: true, choiceOptions: opts };
    }
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const nameLower = String(targetName).toLowerCase().trim();
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const displayName = typeof dc === 'object' ? dc.displayName : dcName;
      const matchName = (displayName || dcName || '').toLowerCase();
      if (!matchName || (!matchName.includes(nameLower) && !nameLower.includes(matchName))) continue;
      if (typeof dc === 'object') dcList[i] = { ...dc, exhausted: false };
      else dcList[i] = { dcName, displayName: dcName, exhausted: false };
      // Also find msgId to refresh the DC embed
      let readyMsgId = null;
      if (dcMessageMeta) {
        for (const [msgId, meta] of dcMessageMeta) {
          if (meta.playerNum !== playerNum) continue;
          const metaName = (meta.displayName || meta.dcName || '').toLowerCase();
          if (metaName === matchName || metaName.includes(nameLower) || nameLower.includes(metaName)) {
            readyMsgId = msgId;
            break;
          }
        }
      }
      const result = { applied: true, logMessage: `Readied **${displayName || dcName}**'s Deployment card (New Orders).` };
      if (readyMsgId) {
        result.readyDcMsgIds = [readyMsgId];
        result.refreshDcEmbed = true;
        result.refreshDcEmbedMsgIds = [readyMsgId];
      }
      return result;
    }
    return { applied: false, manualMessage: `Could not find Deployment card matching "${targetName}".` };
  }

  // ccEffect: readyOwnDeploymentCard + endOfRoundSelfDamage (Blaze of Glory) — choiceOptions = your DCs; chosenOption = displayName to ready
  if (entry.type === 'ccEffect' && entry.readyOwnDeploymentCard && typeof entry.endOfRoundSelfDamage === 'number') {
    const { game, playerNum, dcMessageMeta, chosenOption } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (!chosenOption) {
      const choiceOptions = [];
      for (const [, meta] of dcMessageMeta) {
        if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
        const name = meta.displayName || meta.dcName;
        if (name) choiceOptions.push(name);
      }
      if (choiceOptions.length === 0) return { applied: false, manualMessage: 'No Deployment cards to ready.' };
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions,
        choiceCount: choiceOptions.length,
        manualMessage: 'Choose which Deployment card to ready.',
      };
    }
    const nameLower = String(chosenOption).toLowerCase().trim();
    let targetMsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId || meta.playerNum !== playerNum) continue;
      const displayName = meta.displayName || meta.dcName || '';
      if ((displayName || '').toLowerCase() === nameLower || displayName.toLowerCase().includes(nameLower) || nameLower.includes(displayName.toLowerCase())) {
        targetMsgId = msgId;
        break;
      }
    }
    if (!targetMsgId) return { applied: false, manualMessage: `Could not find Deployment card matching "${chosenOption}".` };
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const idx = dcMessageIds.indexOf(targetMsgId);
    if (idx >= 0 && dcList[idx]) {
      const dc = dcList[idx];
      dcList[idx] = typeof dc === 'object' ? { ...dc, exhausted: false } : { dcName: dc, displayName: dc, exhausted: false };
    }
    game.endOfRoundSelfDamage = game.endOfRoundSelfDamage || {};
    game.endOfRoundSelfDamage[playerNum] = {
      damage: entry.endOfRoundSelfDamage,
      msgId: game.lastActivationMsgIdByPlayer?.[playerNum] ?? targetMsgId,
    };
    return {
      applied: true,
      logMessage: `Readied your Deployment card. At end of round you will suffer ${entry.endOfRoundSelfDamage} Damage.`,
      readyDcMsgIds: [targetMsgId],
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
  }

  // ccEffect: shuffleOneFromDiscardIntoDeck (De Wanna Wanga) — choiceIndex = index in discard to shuffle in
  if (entry.type === 'ccEffect' && entry.shuffleOneFromDiscardIntoDeck) {
    const { game, playerNum, cardName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const discard = (game[discardKey] || []).slice();
    const deck = (game[deckKey] || []).slice();
    const choiceIndex = context.choiceIndex;
    if (discard.length === 0) return { applied: false, manualMessage: 'No cards in discard to shuffle into deck.' };
    if (choiceIndex == null || choiceIndex < 0 || choiceIndex >= discard.length) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: discard.map((c, i) => `${i + 1}. ${c}`),
        choiceCount: discard.length,
        manualMessage: 'Choose which card to shuffle into your deck (by index).',
      };
    }
    const card = discard.splice(choiceIndex, 1)[0];
    deck.push(card);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    game[discardKey] = discard;
    game[deckKey] = deck;
    return {
      applied: true,
      logMessage: `Shuffled **${card}** from discard into your Command deck.`,
      refreshDiscard: true,
    };
  }

  // ccEffect: opponentDiscardDeckTop (Shoot the Messenger) — when defender was defeated; or with elseGainVp (Merciless) — no defender required
  if (entry.type === 'ccEffect' && typeof entry.opponentDiscardDeckTop === 'number' && entry.opponentDiscardDeckTop > 0) {
    const { game, playerNum, defenderDefeated } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const deckKey = oppNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const discardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const deck = (game[deckKey] || []).slice();
    if (entry.elseGainVp != null) {
      // Merciless: opponent may discard 2 from deck; if not (or deck has < 2), you gain 3 VP
      if (deck.length >= entry.opponentDiscardDeckTop) {
        const n = entry.opponentDiscardDeckTop;
        const removed = deck.splice(0, n);
        game[deckKey] = deck;
        game[discardKey] = (game[discardKey] || []).concat(removed);
        return {
          applied: true,
          logMessage: `Opponent discarded top ${n} card(s) of their Command deck.`,
          refreshOpponentDiscard: true,
        };
      }
      const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
      game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
      game[vpKey].total = (game[vpKey].total ?? 0) + entry.elseGainVp;
      return {
        applied: true,
        logMessage: `Opponent had fewer than ${entry.opponentDiscardDeckTop} cards in deck; you gained ${entry.elseGainVp} VP.`,
      };
    }
    if (!defenderDefeated) return { applied: false, manualMessage: 'Shoot the Messenger: defender was not defeated.' };
    const n = Math.min(entry.opponentDiscardDeckTop, deck.length);
    const removed = deck.splice(0, n);
    game[deckKey] = deck;
    game[discardKey] = (game[discardKey] || []).concat(removed);
    return {
      applied: true,
      logMessage: `Defender was defeated. Opponent discarded top ${n} card(s) of their Command deck.`,
      refreshOpponentDiscard: n > 0,
    };
  }

  // ccEffect: maxDamageFromAttack (Iron Will) — store on combat; defender cannot suffer more than N from this attack
  if (entry.type === 'ccEffect' && typeof entry.maxDamageFromAttack === 'number' && entry.maxDamageFromAttack > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared.' };
    cbt.maxDamageToDefender = Math.min(cbt.maxDamageToDefender ?? 999, entry.maxDamageFromAttack);
    return { applied: true, logMessage: `You cannot suffer more than ${entry.maxDamageFromAttack} Damage from this attack.` };
  }

  // ccEffect: defenderIgnorePierce (Heavy Armor)
  if (entry.type === 'ccEffect' && entry.defenderIgnorePierce) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while defending.' };
    cbt.defenderIgnorePierce = true;
    return { applied: true, logMessage: 'During this attack, Pierce has no effect.' };
  }

  // ccEffect: rerollOneAttackDie (Mitigate)
  if (entry.type === 'ccEffect' && entry.rerollOneAttackDie) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while attacking.' };
    cbt.rerollOneAttackDie = (cbt.rerollOneAttackDie || 0) + 1;
    return { applied: true, logMessage: 'You may reroll 1 attack die.' };
  }

  // ccEffect: defenderRerollDiceMax (Guardian Stance) — while adjacent friendly is defending
  if (entry.type === 'ccEffect' && typeof entry.defenderRerollDiceMax === 'number' && entry.defenderRerollDiceMax > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while adjacent friendly is defending.' };
    cbt.defenderRerollDiceMax = (cbt.defenderRerollDiceMax || 0) + entry.defenderRerollDiceMax;
    return { applied: true, logMessage: `You may reroll up to ${entry.defenderRerollDiceMax} attack or defense die.` };
  }

  // ccEffect: bonusDamagePerDefenseDie + bonusSurgePerDefenseDie + ignoreDefenseResultsNotOnDice (Overwhelming Impact)
  if (entry.type === 'ccEffect' && (typeof entry.bonusDamagePerDefenseDie === 'number' || typeof entry.bonusSurgePerDefenseDie === 'number' || entry.ignoreDefenseResultsNotOnDice)) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while attacking.' };
    if (typeof entry.bonusDamagePerDefenseDie === 'number') cbt.bonusDamagePerDefenseDie = (cbt.bonusDamagePerDefenseDie || 0) + entry.bonusDamagePerDefenseDie;
    if (typeof entry.bonusSurgePerDefenseDie === 'number') cbt.bonusSurgePerDefenseDie = (cbt.bonusSurgePerDefenseDie || 0) + entry.bonusSurgePerDefenseDie;
    if (entry.ignoreDefenseResultsNotOnDice) cbt.ignoreDefenseResultsNotOnDice = true;
    return { applied: true, logMessage: 'This attack: +1 Damage and +1 Surge per defense die; ignore defense results not on dice.' };
  }

  // ccEffect: celebrationVp + increaseArmyCostBy (Field Promotion)
  if (entry.type === 'ccEffect' && typeof entry.celebrationVp === 'number' && typeof entry.increaseArmyCostBy === 'number') {
    const { game, playerNum, defenderDefeated } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (!defenderDefeated) return { applied: false, manualMessage: 'Field Promotion: defender was not defeated.' };
    const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].total = (game[vpKey].total ?? 0) + entry.celebrationVp;
    const costKey = playerNum === 1 ? 'player1ArmyCostModifier' : 'player2ArmyCostModifier';
    game[costKey] = (game[costKey] || 0) + entry.increaseArmyCostBy;
    return {
      applied: true,
      logMessage: `Defender defeated. Gained ${entry.celebrationVp} VP and increased your figure cost by ${entry.increaseArmyCostBy}.`,
    };
  }

  // ccEffect: celebrationVp only (Celebration) — gain N VP after a unique hostile is defeated (honor system, no armyCost modifier)
  if (entry.type === 'ccEffect' && typeof entry.celebrationVp === 'number' && !entry.increaseArmyCostBy) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].total = (game[vpKey].total ?? 0) + entry.celebrationVp;
    return {
      applied: true,
      logMessage: `**Celebration** — Gained ${entry.celebrationVp} VP (honor: play after a unique hostile figure is defeated).`,
    };
  }

  // ccEffect: roundAttackRerollDice (Just Business) — until end of round, may reroll 1 attack die when attacking
  if (entry.type === 'ccEffect' && typeof entry.roundAttackRerollDice === 'number' && entry.roundAttackRerollDice > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundAttackRerollDice = game.roundAttackRerollDice || {};
    game.roundAttackRerollDice[playerNum] = (game.roundAttackRerollDice[playerNum] || 0) + entry.roundAttackRerollDice;
    return {
      applied: true,
      logMessage: `Until end of round, friendly figures may reroll up to ${entry.roundAttackRerollDice} attack die when attacking.`,
    };
  }

  // ccEffect: roundDefenderCannotBeTargetedUnlessWithinSpaces (I Must Go Alone)
  if (entry.type === 'ccEffect' && typeof entry.roundDefenderCannotBeTargetedUnlessWithinSpaces === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDefenderCannotBeTargetedUnlessWithinSpaces = { playerNum, spaces: entry.roundDefenderCannotBeTargetedUnlessWithinSpaces };
    return {
      applied: true,
      logMessage: `Until end of round, hostiles cannot attack you unless within ${entry.roundDefenderCannotBeTargetedUnlessWithinSpaces} spaces.`,
    };
  }

  // ccEffect: roundDebuffNextHostileActivation (No Cheating)
  if (entry.type === 'ccEffect' && entry.roundDebuffNextHostileActivation) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDebuffNextHostileActivation = { playerNum, ...entry.roundDebuffNextHostileActivation };
    return {
      applied: true,
      logMessage: 'Next hostile activation in your LOS: that figure\'s attack becomes Melee and removes 1 attack die this round.',
    };
  }

  // ccEffect: nextDefeatedFriendlyVpReduction (Of No Importance)
  if (entry.type === 'ccEffect' && typeof entry.nextDefeatedFriendlyVpReduction === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.nextDefeatedFriendlyVpReduction = { playerNum, amount: entry.nextDefeatedFriendlyVpReduction };
    return {
      applied: true,
      logMessage: `Next time one of your non-unique figures is defeated, that figure is worth ${entry.nextDefeatedFriendlyVpReduction} fewer VP.`,
    };
  }

  // ccEffect: attackPoolRemoveMax (Run for Cover) — when defending, remove up to N dice from attack pool
  if (entry.type === 'ccEffect' && typeof entry.attackPoolRemoveMax === 'number' && entry.attackPoolRemoveMax > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared.' };
    cbt.attackPoolRemoveMax = (cbt.attackPoolRemoveMax || 0) + entry.attackPoolRemoveMax;
    return { applied: true, logMessage: 'Choose 1 attack die and remove it from the attack pool.' };
  }

  // ccEffect: attackPoolKeepMax (Savage Vigor) — attacker keeps only N dice
  if (entry.type === 'ccEffect' && typeof entry.attackPoolKeepMax === 'number' && entry.attackPoolKeepMax > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared.' };
    cbt.attackPoolKeepMax = Math.min(cbt.attackPoolKeepMax ?? 99, entry.attackPoolKeepMax);
    return { applied: true, logMessage: `Attacker chooses ${entry.attackPoolKeepMax} attack dice and removes the rest.` };
  }

  // ccEffect: attackResultReplaceWithStun (Set for Stun)
  if (entry.type === 'ccEffect' && entry.attackResultReplaceWithStun) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play when declaring a Special Action attack.' };
    cbt.attackResultReplaceWithStun = true;
    return { applied: true, logMessage: 'If this attack would deal 1+ Damage, reduce to 0 and target becomes Stunned.' };
  }

  // ccEffect: roundDroidExtraActionCostDamage (Overdrive)
  if (entry.type === 'ccEffect' && typeof entry.roundDroidExtraActionCostDamage === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDroidExtraActionCostDamage = { playerNum, damage: entry.roundDroidExtraActionCostDamage };
    return {
      applied: true,
      logMessage: `Until end of round, each of your DROIDs may suffer ${entry.roundDroidExtraActionCostDamage} Damage during its activation to perform 1 additional action (once per DROID).`,
    };
  }

  // ccEffect: sitTightPlayerNum (Sit Tight)
  if (entry.type === 'ccEffect' && entry.sitTightPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.sitTightPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: "You do not activate any groups this round until you have more ready Deployment cards than your opponent.",
    };
  }

  // ccEffect: activationDoubleSpecialAction (Single Purpose)
  if (entry.type === 'ccEffect' && entry.activationDoubleSpecialAction) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.activationDoubleSpecialAction = game.activationDoubleSpecialAction || {};
    game.activationDoubleSpecialAction[msgId] = true;
    return {
      applied: true,
      logMessage: 'You may use the same special action up to twice during this activation.',
    };
  }

  // ccEffect: applyStunToUpToNAdjacentHostiles (Roar) — choose opponent DC; all its figures become Stunned
  if (entry.type === 'ccEffect' && typeof entry.applyStunToUpToNAdjacentHostiles === 'number' && entry.applyStunToUpToNAdjacentHostiles > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    if (typeof entry.onlyIfSufferedDamageGte === 'number') {
      const healthState = dcHealthState?.get(msgId) || [];
      // healthState entries are [current, max]; damage suffered = max - current
      const totalDamage = healthState.reduce((s, e) => s + ((e?.[1] ?? 0) - (e?.[0] ?? e?.[1] ?? 0)), 0);
      if (totalDamage < entry.onlyIfSufferedDamageGte) {
        return { applied: false, manualMessage: `Roar: you must have suffered ${entry.onlyIfSufferedDamageGte}+ Damage (you have suffered ${totalDamage}).` };
      }
    }
    const oppNum = playerNum === 1 ? 2 : 1;
    if (!chosenFigureKey) {
      // Build choice list from opponent DCs (honor: player picks an adjacent hostile DC)
      const choiceOptions = [];
      const choiceValues = [];
      for (const [dcMsgId, meta] of dcMessageMeta) {
        if (meta.playerNum !== oppNum) continue;
        const name = meta.displayName || meta.dcName;
        if (!name) continue;
        choiceOptions.push(name);
        choiceValues.push(dcMsgId);
      }
      if (choiceOptions.length === 0) return { applied: false, manualMessage: 'No hostile figures found. Resolve manually.' };
      return { applied: false, requiresChoice: true, choiceOptions, choiceValues };
    }
    // Apply Stun to all figures of the chosen hostile DC
    const targetMeta = dcMessageMeta.get(chosenFigureKey);
    if (!targetMeta) return { applied: false, manualMessage: `Could not find hostile DC. Resolve manually.` };
    const figureKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
    game.figureConditions = game.figureConditions || {};
    let stunned = 0;
    for (const fk of figureKeys.slice(0, entry.applyStunToUpToNAdjacentHostiles)) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Stun')) game.figureConditions[fk] = [...existing, 'Stun'];
      stunned++;
    }
    const label = targetMeta.displayName || targetMeta.dcName || 'hostile figure(s)';
    return {
      applied: true,
      logMessage: `**${label}** — ${stunned} figure(s) became Stunned.`,
    };
  }

  // ccEffect: pushFriendlyWithin3Spaces (Reposition) — choiceOptions from dcList; chosenOption = figure to push
  if (entry.type === 'ccEffect' && typeof entry.pushFriendlyWithin3Spaces === 'number' && entry.pushFriendlyWithin3Spaces > 0) {
    const { game, playerNum, repositionFriendlyDcName, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const targetName = repositionFriendlyDcName || chosenOption;
    if (!targetName) {
      // Build choice list from friendly DCs (honor: player picks a SMALL figure within 3 spaces)
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const opts = dcList
        .filter((dc) => dc && !dc.defeated)
        .map((dc) => (typeof dc === 'object' ? dc.displayName || dc.dcName : dc))
        .filter(Boolean);
      if (opts.length === 0) return { applied: false, manualMessage: 'No friendly figures to push. Resolve manually.' };
      return { applied: false, requiresChoice: true, choiceOptions: opts };
    }
    return {
      applied: true,
      logMessage: `Push **${targetName}** up to ${entry.pushFriendlyWithin3Spaces} spaces (resolve movement manually).`,
    };
  }

  // ccEffect: opponentHandRandomToDeckTop (Stall for Time)
  if (entry.type === 'ccEffect' && typeof entry.opponentHandRandomToDeckTop === 'number' && entry.opponentHandRandomToDeckTop > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const handKey = oppNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const deckKey = oppNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const hand = (game[handKey] || []).slice();
    const deck = (game[deckKey] || []).slice();
    const n = Math.min(entry.opponentHandRandomToDeckTop, hand.length);
    if (n === 0) return { applied: true, logMessage: "Opponent's hand is empty; no card placed on deck." };
    const picked = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * hand.length);
      picked.push(hand.splice(idx, 1)[0]);
    }
    game[handKey] = hand;
    deck.unshift(...picked);
    game[deckKey] = deck;
    return {
      applied: true,
      logMessage: `Opponent placed ${n} random card(s) from hand on top of their Command deck: ${picked.map((c) => `**${c}**`).join(', ')}.`,
      refreshOpponentHand: true,
    };
  }

  // ccEffect: roundInTheShadowsPlayerNum (In the Shadows)
  if (entry.type === 'ccEffect' && entry.roundInTheShadowsPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundInTheShadowsPlayerNum = playerNum;
    return { applied: true, logMessage: 'Until end of round, hostiles 4+ spaces away do not have line of sight to you.' };
  }

  // ccEffect: activationExtraActionThenStun (To the Limit)
  if (entry.type === 'ccEffect' && entry.activationExtraActionThenStun) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play after resolving a Special Action during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.activationExtraActionThenStun = game.activationExtraActionThenStun || {};
    game.activationExtraActionThenStun[msgId] = true;
    return { applied: true, logMessage: 'Perform 1 additional action; then you become Stunned.' };
  }

  // ccEffect: pickpocketVpByAccuracy (Pickpocket) — choiceIndex 0–3 = green die Accuracy result
  if (entry.type === 'ccEffect' && entry.pickpocketVpByAccuracy) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const accuracy = choiceIndex != null && choiceIndex >= 0 && choiceIndex <= 3 ? choiceIndex : null;
    if (accuracy === null) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: ['0 (miss)', '1', '2', '3'],
        choiceCount: 4,
        manualMessage: 'Roll 1 green die; enter the Accuracy result (0–3). Opponent loses that many VP and you gain that many VP.',
      };
    }
    const oppNum = playerNum === 1 ? 2 : 1;
    const yourVpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    const oppVpKey = oppNum === 1 ? 'player1VP' : 'player2VP';
    game[yourVpKey] = game[yourVpKey] || { total: 0, kills: 0, objectives: 0 };
    game[oppVpKey] = game[oppVpKey] || { total: 0, kills: 0, objectives: 0 };
    game[yourVpKey].total = (game[yourVpKey].total ?? 0) + accuracy;
    game[oppVpKey].total = Math.max(0, (game[oppVpKey].total ?? 0) - accuracy);
    return { applied: true, logMessage: `Green die Accuracy ${accuracy}: you gain ${accuracy} VP, opponent loses ${accuracy} VP.` };
  }

  // ccEffect: attackPoolAddYellowUntilTotal + superchargeStrainAfterAttack (Supercharge)
  if (entry.type === 'ccEffect' && typeof entry.attackPoolAddYellowUntilTotal === 'number' && entry.attackPoolAddYellowUntilTotal > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play when declaring a Special Action attack.' };
    cbt.attackPoolAddYellowUntilTotal = entry.attackPoolAddYellowUntilTotal;
    if (entry.superchargeStrainAfterAttack) cbt.superchargeStrainAfterAttack = true;
    return { applied: true, logMessage: `Add yellow dice to attack pool until ${entry.attackPoolAddYellowUntilTotal} total; after attack resolve, suffer Strain equal to dice added.` };
  }

  // ccEffect: strengthInNumbersPlayerNum (Strength in Numbers)
  if (entry.type === 'ccEffect' && entry.strengthInNumbersPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.strengthInNumbersPlayerNum = playerNum;
    return { applied: true, logMessage: 'You may immediately activate another group (combined deployment cost of the two groups cannot exceed 12).' };
  }

  // ccEffect: provokeNextActivation (Provoke)
  if (entry.type === 'ccEffect' && entry.provokeNextActivation) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.provokeNextActivation = { playerNum };
    return { applied: true, logMessage: "Choose a hostile figure adjacent to your TROOPER or GUARDIAN; that figure's group must activate next if able." };
  }

  // ccEffect: pummelTwoAttacksThisActivation (Pummel)
  if (entry.type === 'ccEffect' && entry.pummelTwoAttacksThisActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.pummelTwoAttacksThisActivation = game.pummelTwoAttacksThisActivation || {};
    game.pummelTwoAttacksThisActivation[msgId] = true;
    return { applied: true, logMessage: 'If you have MELEE attack type, perform 2 attacks.' };
  }

  // ccEffect: vanishImmunityUntilNextActivation + nextActivationMpBonus (Vanish)
  if (entry.type === 'ccEffect' && entry.vanishImmunityUntilNextActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.vanishImmunityUntilNextActivation = game.vanishImmunityUntilNextActivation || {};
    game.vanishImmunityUntilNextActivation[playerNum] = { msgId, nextMp: entry.nextActivationMpBonus || 0 };
    return {
      applied: true,
      logMessage: `You cannot suffer Damage or receive conditions until your next activation. At the start of your next activation, gain ${entry.nextActivationMpBonus || 0} movement points.`,
    };
  }

  // ccEffect: rebelGraffitiVp (Rebel Graffiti) — end of activation: gain 2 VP (honor: only when no adjacent hostiles)
  if (entry.type === 'ccEffect' && typeof entry.rebelGraffitiVp === 'number' && entry.rebelGraffitiVp > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const vpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    game[vpKey] = game[vpKey] || { total: 0, kills: 0, objectives: 0 };
    game[vpKey].total = (game[vpKey].total ?? 0) + entry.rebelGraffitiVp;
    return { applied: true, logMessage: `Gained ${entry.rebelGraffitiVp} VP (end of activation; honor: no adjacent hostiles).` };
  }

  // ccEffect: shuffleHandIntoDeckThenDraw (Strategic Shift) — chosen player shuffles hand into deck, then draws N; choiceIndex 0 = P1, 1 = P2
  if (entry.type === 'ccEffect' && typeof entry.shuffleHandIntoDeckThenDraw === 'number' && entry.shuffleHandIntoDeckThenDraw > 0) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const targetNum = choiceIndex === 0 ? 1 : choiceIndex === 1 ? 2 : null;
    if (targetNum === null) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: ['Player 1', 'Player 2'],
        choiceCount: 2,
        manualMessage: 'Choose which player shuffles their hand into their deck, then draws 2.',
      };
    }
    const deckKey = targetNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = targetNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const hand = (game[handKey] || []).slice();
    const deck = (game[deckKey] || []).slice();
    const combined = [...hand, ...deck];
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }
    game[deckKey] = combined;
    game[handKey] = [];
    const drew = drawCcCards(game, targetNum, entry.shuffleHandIntoDeckThenDraw);
    return {
      applied: true,
      drewCards: drew,
      logMessage: `Player ${targetNum} shuffled hand into deck and drew ${drew.length} card(s).`,
    };
  }

  // ccEffect: roundUtinniJawaBuffs (Utinni!)
  if (entry.type === 'ccEffect' && entry.roundUtinniJawaBuffs) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundUtinniJawaBuffs = true;
    return { applied: true, logMessage: 'This round, each friendly Jawa Scavenger gains +1 Speed, +1 Accuracy, and Surge: gain 1 VP when attacking a figure.' };
  }

  // ccEffect: whenDefeatHostileWithin3GainBlockTokens (Paid in Beskar)
  if (entry.type === 'ccEffect' && typeof entry.whenDefeatHostileWithin3GainBlockTokens === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.whenDefeatHostileWithin3GainBlockTokens = { playerNum, tokens: entry.whenDefeatHostileWithin3GainBlockTokens };
    return { applied: true, logMessage: `When you defeat a hostile figure within 3 spaces, gain ${entry.whenDefeatHostileWithin3GainBlockTokens} Block tokens.` };
  }

  // ccEffect: overrunThisActivation (Overrun) — keyed by activation msgId
  if (entry.type === 'ccEffect' && entry.overrunThisActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually: play at start of activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.overrunThisActivation = game.overrunThisActivation || {};
    game.overrunThisActivation[msgId] = true;
    return { applied: true, logMessage: 'This activation, when you enter a hostile figure\'s space, that figure suffers 2 Damage (limit once per hostile).' };
  }

  // ccEffect: squadSwarmPlayerNum (Squad Swarm)
  if (entry.type === 'ccEffect' && entry.squadSwarmPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.squadSwarmPlayerNum = playerNum;
    return { applied: true, logMessage: 'You may immediately activate another ready group with the same name (combined cost of both groups cannot exceed 15).' };
  }

  // ccEffect: roundSmugglersTricksPlayerNum (Smuggler's Tricks)
  if (entry.type === 'ccEffect' && entry.roundSmugglersTricksPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundSmugglersTricksPlayerNum = playerNum;
    return { applied: true, logMessage: 'Choose a tile or token you are on or adjacent to; until start of next round, opponent counts 1 fewer figure on or adjacent to it.' };
  }

  // ccEffect: grantMpToFriendliesWithin2 (Forward March) — grant N MP to each friendly DC within 2 spaces of activated figure
  if (entry.type === 'ccEffect' && typeof entry.grantMpToFriendliesWithin2 === 'number' && entry.grantMpToFriendliesWithin2 > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const activeMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!activeMsgId) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const activeMeta = dcMessageMeta.get(activeMsgId);
    const activeKeys = getFigureKeysForDcMsg(game, playerNum, activeMeta);
    const selectedFig = game.dcActionsData?.[activeMsgId]?.selectedFigure ?? 0;
    const activeFigKey = activeKeys[selectedFig] || activeKeys[0];
    const activePos = activeFigKey ? game.figurePositions?.[playerNum]?.[activeFigKey] : null;
    if (!activePos) return { applied: false, manualMessage: 'Resolve manually: activated figure has no position.' };
    const n = entry.grantMpToFriendliesWithin2;
    const grantedNames = [];
    game.pendingMpBonus = game.pendingMpBonus || {};
    for (const [mid, meta] of dcMessageMeta) {
      if (meta.playerNum !== playerNum || meta.gameId !== game.gameId || mid === activeMsgId) continue;
      const figKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      let anyWithin = false;
      for (const fk of figKeys) {
        const pos = game.figurePositions?.[playerNum]?.[fk];
        if (!pos) continue;
        try {
          const pa = parseCoord(activePos);
          const pb = parseCoord(pos);
          if (Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row) <= 2) { anyWithin = true; break; }
        } catch { continue; }
      }
      if (!anyWithin) continue;
      // If already activated (bank exists and has a thread), add directly; otherwise store as pending
      const existingBank = game.movementBank?.[mid];
      if (existingBank?.threadId) {
        existingBank.total = (existingBank.total || 0) + n;
        existingBank.remaining = (existingBank.remaining || 0) + n;
      } else {
        game.pendingMpBonus[mid] = (game.pendingMpBonus[mid] || 0) + n;
      }
      grantedNames.push(meta.displayName || meta.dcName);
    }
    if (grantedNames.length === 0) return { applied: true, logMessage: `**Forward March** — No other friendly figures within 2 spaces.` };
    return { applied: true, logMessage: `**Forward March** — Granted +${n} MP to **${grantedNames.length}** friendly figure(s): ${grantedNames.join(', ')}.`, refreshMovementBank: true };
  }

  // ccEffect: grantMpToFriendliesByKeyword (Close the Gap) — grant N MP to each friendly DC with a given keyword
  if (entry.type === 'ccEffect' && entry.grantMpToFriendliesByKeyword) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const { keyword, mp, grantBlockToken } = entry.grantMpToFriendliesByKeyword;
    const dcEffects = getDcEffects();
    const grantedNames = [];
    game.pendingMpBonus = game.pendingMpBonus || {};
    for (const [mid, meta] of dcMessageMeta) {
      if (meta.playerNum !== playerNum || meta.gameId !== game.gameId) continue;
      const eff = dcEffects[meta.dcName] || dcEffects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const kws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
      if (!kws.includes(keyword.toUpperCase())) continue;
      // Grant MP
      const existingBank = game.movementBank?.[mid];
      if (existingBank?.threadId) {
        existingBank.total = (existingBank.total || 0) + mp;
        existingBank.remaining = (existingBank.remaining || 0) + mp;
      } else {
        game.pendingMpBonus[mid] = (game.pendingMpBonus[mid] || 0) + mp;
      }
      // Grant Block Token (stand-in for Armor Token)
      if (grantBlockToken) {
        const figKeys = getFigureKeysForDcMsg(game, playerNum, meta);
        game.figurePowerTokens = game.figurePowerTokens || {};
        for (const fk of figKeys) {
          game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
          game.figurePowerTokens[fk].push('Block');
        }
      }
      grantedNames.push(meta.displayName || meta.dcName);
    }
    if (grantedNames.length === 0) return { applied: true, logMessage: `**${entry.label || 'Close the Gap'}** — No friendly ${keyword} figures found.` };
    const tokenNote = grantBlockToken ? ' and gained a Block Token (Armor Token)' : '';
    return { applied: true, logMessage: `**Close the Gap** — Granted +${mp} MP${tokenNote} to **${grantedNames.length}** friendly ${keyword} figure(s): ${grantedNames.join(', ')}.`, refreshMovementBank: true };
  }

  // ccEffect: roundEfficientTravel (Efficient Travel CC) — until end of round all friendly figures ignore Difficult Terrain and hostile figure entry costs
  if (entry.type === 'ccEffect' && entry.roundEfficientTravel) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundEfficientTravel = game.roundEfficientTravel || {};
    game.roundEfficientTravel[playerNum] = true;
    return { applied: true, logMessage: `**Efficient Travel** — Until end of round, your figures ignore Difficult Terrain and hostile figure entry costs.` };
  }

  // ccEffect: applyBlockAndHideToIsolatedFriendlies (Guerilla Warfare) — figures with no adjacent friendly gain Block Token + Hidden
  if (entry.type === 'ccEffect' && entry.applyBlockAndHideToIsolatedFriendlies) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const allFriendlyPositions = game.figurePositions?.[playerNum] || {};
    const friendlyKeys = Object.keys(allFriendlyPositions);
    const qualified = [];
    for (const fk of friendlyKeys) {
      const pos = allFriendlyPositions[fk];
      if (!pos) continue;
      const hasAdjacentFriendly = friendlyKeys.some((otherFk) => {
        if (otherFk === fk) return false;
        const otherPos = allFriendlyPositions[otherFk];
        if (!otherPos) return false;
        try {
          const pa = parseCoord(pos);
          const pb = parseCoord(otherPos);
          return Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row) === 1;
        } catch { return false; }
      });
      if (!hasAdjacentFriendly) qualified.push(fk);
    }
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figureConditions = game.figureConditions || {};
    for (const fk of qualified) {
      game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
      game.figurePowerTokens[fk].push('Block');
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Hide')) game.figureConditions[fk] = [...existing, 'Hide'];
    }
    if (qualified.length === 0) return { applied: true, logMessage: `**Guerilla Warfare** — No isolated friendly figures (all have adjacent friendlies).` };
    const names = qualified.map((fk) => fk.replace(/-\d+-\d+$/, '')).join(', ');
    return { applied: true, logMessage: `**Guerilla Warfare** — Applied Block Token and Hidden to **${qualified.length}** isolated friendly figure(s): ${names}.` };
  }

  // ccEffect: nextAttackIgnoreFigureLOS (Marksman) — for next attack, figures do not block line of sight
  if (entry.type === 'ccEffect' && entry.nextAttackIgnoreFigureLOS) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: play before declaring your attack this activation.' };
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[msgId] = true;
    return { applied: true, logMessage: `**Marksman** — For your next Ranged attack this activation, figures do not block line of sight.` };
  }

  // ccEffect: attackOverrideOpts (Definition: 'Love') — store pending attack override (type, minRange, removeDieColor) + free attack
  if (entry.type === 'ccEffect' && entry.attackOverrideOpts) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: play before declaring your attack this activation.' };
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { ...entry.attackOverrideOpts };
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
    }
    const rangeNote = entry.attackOverrideOpts.minRange ? ` Target must be **${entry.attackOverrideOpts.minRange}+** spaces away.` : '';
    const dieNote = entry.attackOverrideOpts.removeDieColor ? ` Remove 1 **${entry.attackOverrideOpts.removeDieColor}** die from your attack pool.` : '';
    const freeNote = entry.freeAttackBonus ? ' Your next attack costs no action.' : '';
    return { applied: true, logMessage: `**${entry.label}** —${freeNote}${rangeNote}${dieNote} Use the Attack button.` };
  }

  // ccEffect: deployGarrisonEffect (Deploy the Garrison) — each friendly Trooper/Guardian within 4 gains 2 MP or 1 Hit Token (choice)
  if (entry.type === 'ccEffect' && entry.deployGarrisonEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const actData = game.dcActionsData?.[msgId];
    const selfFigIdx = actData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const selfFigKey = `${meta.dcName}-${dgIndex}-${selfFigIdx}`;
    const selfPos = game.figurePositions?.[playerNum]?.[selfFigKey];
    if (!selfPos) return { applied: false, manualMessage: 'Resolve manually: activated figure has no position.' };
    const boardState = getBoardStateForMovement(game, null);
    const mapSpaces = boardState?.mapSpaces;

    // Helper: collect qualifying friendly figures within 4 (TROOPER or GUARDIAN keyword, not the activating figure)
    const dcEffects = getDcEffects();
    const qualifyingMsgIds = [];
    const qualifyingNames = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      const dcName = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcName] || dcEffects[dcName.replace(/\s*\[.*\]\s*$/, '')] || {};
      const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes('TROOPER') && !kws.includes('GUARDIAN')) continue;
      // Compute distance via getRange if available (Manhattan); fallback to include all
      const dist = mapSpaces ? null : 0; // we'll use getRange from context if present
      // Use getRange from imports if possible — it's not directly imported but we can compute
      const [r1, c1] = String(selfPos).toUpperCase().split(/(\d+)/).filter(Boolean);
      const [r2, c2] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
      const rowDist = Math.abs((r1?.charCodeAt(0) ?? 0) - (r2?.charCodeAt(0) ?? 0));
      const colDist = Math.abs(parseInt(c1 || '0') - parseInt(c2 || '0'));
      const approxDist = rowDist + colDist;
      if (approxDist > 4) continue;
      // Find the msgId for this figure
      const figMid = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (!figMid) continue;
      if (!qualifyingMsgIds.includes(figMid)) {
        qualifyingMsgIds.push(figMid);
        qualifyingNames.push(dcName);
      }
    }
    if (qualifyingMsgIds.length === 0) {
      return { applied: true, logMessage: `**Deploy the Garrison** — No friendly Trooper/Guardian figures within 4 spaces.` };
    }

    if (choiceIndex === undefined || choiceIndex === null) {
      // Phase 1: ask player to choose MP or Hit Token
      return {
        requiresChoice: true,
        choiceOptions: [`2 Movement Points to each (${qualifyingNames.join(', ')})`, `1 Hit Token to each (${qualifyingNames.join(', ')})`],
      };
    }

    // Phase 2: apply chosen effect to all qualifying figures
    const grantMp = choiceIndex === 0;
    const results = [];
    for (let i = 0; i < qualifyingMsgIds.length; i++) {
      const mid = qualifyingMsgIds[i];
      const nm = qualifyingNames[i];
      if (grantMp) {
        game.movementBank = game.movementBank || {};
        const bank = game.movementBank[mid] || { total: 0, remaining: 0 };
        bank.total = (bank.total ?? 0) + 2;
        bank.remaining = (bank.remaining ?? 0) + 2;
        game.movementBank[mid] = bank;
        results.push(`**${nm}** +2 MP`);
      } else {
        game.figurePowerTokens = game.figurePowerTokens || {};
        // Grant Hit token to the first figure in that DC group (index 0)
        const metaForMid = dcMessageMeta.get(mid);
        if (metaForMid?.dcName) {
          const actD = game.dcActionsData?.[mid];
          const figIdx = actD?.selectedFigure ?? 0;
          const fkForMid = Object.keys(game.figurePositions?.[playerNum] || {}).find(fk => fk.startsWith(`${metaForMid.dcName}-`) && fk.endsWith(`-${figIdx}`));
          if (fkForMid) {
            game.figurePowerTokens[fkForMid] = [...(game.figurePowerTokens[fkForMid] || []), 'Hit'];
            results.push(`**${nm}** +Hit Token`);
          }
        }
      }
    }
    const effectLabel = grantMp ? '2 MP each' : '1 Hit Token each';
    return {
      applied: true,
      logMessage: `**Deploy the Garrison** — Granted ${effectLabel}: ${results.join(', ')}.`,
      refreshMovementBank: grantMp,
    };
  }

  // ccEffect: grantHitTokensToActivating (Transmit the Plans) — grant N Hit Tokens to activating figure
  if (entry.type === 'ccEffect' && typeof entry.grantHitTokensToActivating === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (!figureKeys.length) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const fk = figureKeys[0];
    const count = entry.grantHitTokensToActivating;
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = [...(game.figurePowerTokens[fk] || [])];
    for (let i = 0; i < count; i++) game.figurePowerTokens[fk].push('Hit');
    const vpNote = entry.vpNoteIfAdjacentTerminal ? ` If adjacent to a terminal, use \`/editvp +${entry.vpNoteIfAdjacentTerminal}\` to gain ${entry.vpNoteIfAdjacentTerminal} VP.` : '';
    return { applied: true, logMessage: `**${entry.label}** — Granted **${count} Hit Token${count !== 1 ? 's' : ''}** to ${meta.dcName}.${vpNote}` };
  }

  // ccEffect: protectOldWaysBonus (Protect the Old Ways) — +X Block this round (X = 1 + FORCE USER CCs in discard)
  if (entry.type === 'ccEffect' && entry.protectOldWaysBonus) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const discard = game[discardKey] || [];
    const forceUserCount = discard.filter((cardName) => {
      const eff = getCcEffect(cardName);
      return eff?.playableBy && String(eff.playableBy).toUpperCase().includes('FORCE USER');
    }).length;
    const bonus = 1 + forceUserCount;
    game.roundDefenseBonusBlock = game.roundDefenseBonusBlock || {};
    game.roundDefenseBonusBlock[playerNum] = (game.roundDefenseBonusBlock[playerNum] || 0) + bonus;
    return { applied: true, logMessage: `**Protect the Old Ways** — +**${bonus}** Block to your defense this round (1 + ${forceUserCount} FORCE USER CC${forceUserCount !== 1 ? 's' : ''} in discard).` };
  }

  // ccEffect: staticPulseEffect (Static Pulse) — for each hostile adjacent to Dio: 2 Strain or Weaken (single choice for all)
  if (entry.type === 'ccEffect' && entry.staticPulseEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, choiceIndex } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const mapId = game.selectedMap?.id;
    const dioCandidates = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => fk.startsWith('Dio-'));
    if (dioCandidates.length === 0) {
      return { applied: true, logMessage: '**Static Pulse** — Dio is not in play. Deploy Dio to your space then apply the effect manually.' };
    }
    const dioFk = dioCandidates[0];
    const oppNum = playerNum === 1 ? 2 : 1;
    const adjAll = mapId ? getFiguresAdjacentToTarget(game, dioFk, mapId) : [];
    const hostiles = adjAll.filter(({ playerNum: p }) => p !== playerNum).map((a) => a.figureKey);
    if (hostiles.length === 0) {
      return { applied: true, logMessage: '**Static Pulse** — No hostile figures adjacent to Dio.' };
    }
    if (choiceIndex === undefined || choiceIndex === null) {
      const hostileNames = hostiles.map((fk) => fk.replace(/-\d+-\d+$/, '')).join(', ');
      return {
        requiresChoice: true,
        choiceOptions: [
          `2 Strain to each (${hostileNames})`,
          `Weaken each (${hostileNames})`,
        ],
      };
    }
    const applyStrain = choiceIndex === 0;
    const results = [];
    for (const fk of hostiles) {
      const dcName = fk.replace(/-\d+-\d+$/, '');
      if (applyStrain) {
        const figMsgId = dcHealthState ? findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta) : null;
        if (figMsgId && dcHealthState) {
          const hs = dcHealthState.get(figMsgId) || [];
          const figMatch = fk.match(/-(\d+)-(\d+)$/);
          const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
          const hp = hs[figIdx];
          if (hp) {
            const [cur, max] = hp;
            const newCur = Math.max(0, (cur ?? max) - 2);
            hs[figIdx] = [newCur, max ?? newCur];
            dcHealthState.set(figMsgId, hs);
            const dcIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
            const dcList = oppNum === 1 ? game.p1DcList : game.p2DcList;
            const idx2 = (dcIds || []).indexOf(figMsgId);
            if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
            results.push(`**${dcName}** 2 Strain (${cur ?? max}→${newCur})`);
          } else {
            results.push(`**${dcName}** 2 Strain (apply manually)`);
          }
        } else {
          results.push(`**${dcName}** 2 Strain (apply manually)`);
        }
      } else {
        game.figureConditions = game.figureConditions || {};
        const existing = game.figureConditions[fk] || [];
        if (!existing.includes('Weaken')) game.figureConditions[fk] = [...existing, 'Weaken'];
        results.push(`**${dcName}** Weakened`);
      }
    }
    return { applied: true, logMessage: `**Static Pulse** — ${results.join(', ')}.`, refreshDcEmbed: true };
  }

  // ccEffect: terminalProtocolEffect (Terminal Protocol) — roll 1 green die, adjacent figures suffer Damage = result, self is defeated
  if (entry.type === 'ccEffect' && entry.terminalProtocolEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (!figureKeys.length) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: map not loaded.' };
    const faces = getDiceData().attack?.green;
    if (!faces?.length) return { applied: false, manualMessage: 'Resolve manually: dice data missing.' };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const dmg = face.dmg ?? 0;
    const results = [];
    const seenMsgIds = new Set();
    for (const selfFk of figureKeys) {
      const adjAll = getFiguresAdjacentToTarget(game, selfFk, mapId);
      for (const { figureKey: fk, playerNum: p } of adjAll) {
        const dcName = fk.replace(/-\d+-\d+$/, '');
        if (dmg > 0) {
          const figMsgId = findMsgIdForFigureKey(game, p, fk, dcMessageMeta);
          if (figMsgId) {
            const hs = dcHealthState.get(figMsgId) || [];
            const figMatch = fk.match(/-(\d+)-(\d+)$/);
            const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
            const hp = hs[figIdx];
            if (hp) {
              const [cur, max] = hp;
              const newCur = Math.max(0, (cur ?? max) - dmg);
              hs[figIdx] = [newCur, max ?? newCur];
              dcHealthState.set(figMsgId, hs);
              const dcIds = p === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
              const dcList = p === 1 ? game.p1DcList : game.p2DcList;
              const idx2 = (dcIds || []).indexOf(figMsgId);
              if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
              seenMsgIds.add(figMsgId);
              results.push(`**${dcName}** ${dmg} Dmg (${cur ?? max}→${newCur})`);
            } else {
              results.push(`**${dcName}** ${dmg} Dmg (apply manually)`);
            }
          }
        }
      }
    }
    // Defeat activating figure (set HP to 0)
    const selfHs = dcHealthState.get(msgId) || [];
    const actData = game.dcActionsData?.[msgId];
    const selfFigIdx = actData?.selectedFigure ?? 0;
    if (selfHs[selfFigIdx]) {
      const [cur, max] = selfHs[selfFigIdx];
      selfHs[selfFigIdx] = [0, max ?? cur];
      dcHealthState.set(msgId, selfHs);
      const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
      const idx2 = (dcIds || []).indexOf(msgId);
      if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...selfHs];
    }
    const dieDesc = dmg > 0 ? `${dmg} Damage` : 'blank (0 Damage)';
    const adjDesc = results.length ? results.join(', ') : 'No adjacent figures affected.';
    return {
      applied: true,
      logMessage: `**Terminal Protocol** — Rolled 1 green die: **${dieDesc}**. ${adjDesc} **${meta.dcName}** is defeated (HP → 0).`,
      refreshDcEmbed: true,
    };
  }

  // ccEffect: jundlandTerrorEffect (Jundland Terror) — grant 2 MP + free attack to Tusken Raider / Bantha Rider next activation
  if (entry.type === 'ccEffect' && entry.jundlandTerrorEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const traits = ['Tusken Raider', 'Bantha Rider'];
    const dcEffects = getDcEffects();
    const squadDcList = playerNum === 1 ? (game.player1Squad?.dcList || []) : (game.player2Squad?.dcList || []);
    const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const matchingMsgIds = [];
    const matchingNames = [];
    for (let i = 0; i < squadDcList.length; i++) {
      const dcName = squadDcList[i];
      if (!dcIds?.[i]) continue;
      const eff = dcEffects[dcName] || dcEffects[dcName?.replace(/\s*\[.*\]\s*$/, '')] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      const matchesTrait = traits.some((t) => kws.includes(t.toUpperCase()) || dcName?.toUpperCase().includes(t.toUpperCase()));
      if (matchesTrait) {
        matchingMsgIds.push(dcIds[i]);
        matchingNames.push(dcName);
      }
    }
    if (matchingMsgIds.length === 0) {
      return { applied: false, manualMessage: 'Resolve manually: no friendly Tusken Raider or Bantha Rider found.' };
    }
    game.pendingMpBonus = game.pendingMpBonus || {};
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    for (const mid of matchingMsgIds) {
      game.pendingMpBonus[mid] = (game.pendingMpBonus[mid] || 0) + 2;
      game.freeAttackBonusPending[mid] = true;
    }
    return { applied: true, logMessage: `**Jundland Terror** — **${matchingNames.join(', ')}**: next activation +2 MP and 1 free attack.` };
  }

  // ccEffect: foreseeEffect (Foresee) — look at top 2 of opponent's deck, discard 1; if cost ≤1, draw 1 from own deck
  if (entry.type === 'ccEffect' && entry.foreseeEffect) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const oppDeckKey = oppNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const oppDiscardKey = oppNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
    const ownDeckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const ownHandKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const oppDeck = [...(game[oppDeckKey] || [])];
    if (oppDeck.length === 0) return { applied: true, logMessage: "**Foresee** — Opponent's deck is empty." };
    const top2 = oppDeck.slice(-Math.min(2, oppDeck.length));
    // Helper: discard a card from opponent deck and optionally draw for self
    const resolveDiscard = (cardName) => {
      const idx = oppDeck.lastIndexOf(cardName);
      if (idx >= 0) oppDeck.splice(idx, 1);
      game[oppDeckKey] = oppDeck;
      const oppDiscard = [...(game[oppDiscardKey] || [])];
      oppDiscard.push(cardName);
      game[oppDiscardKey] = oppDiscard;
      const cardEff = getCcEffect(cardName);
      const cost = cardEff?.cost ?? 99;
      let drawNote = '';
      if (cost <= 1) {
        const ownDeck = [...(game[ownDeckKey] || [])];
        if (ownDeck.length > 0) {
          const drawn = ownDeck.pop();
          game[ownDeckKey] = ownDeck;
          const ownHand = [...(game[ownHandKey] || [])];
          ownHand.push(drawn);
          game[ownHandKey] = ownHand;
          drawNote = ` Cost ≤1 — You drew **${drawn}**.`;
        } else {
          drawNote = ' Cost ≤1 but your deck is empty (no draw).';
        }
      }
      return { discardedCard: cardName, cost, drawNote };
    };
    if (top2.length === 1 || (choiceIndex !== undefined && choiceIndex !== null)) {
      // Auto-resolve or chosen: discard selected card
      const cardName = top2[choiceIndex ?? 0];
      if (!cardName) return { applied: false, manualMessage: 'Invalid choice for Foresee.' };
      const { cost, drawNote } = resolveDiscard(cardName);
      return { applied: true, logMessage: `**Foresee** — Discarded opponent's **${cardName}** (cost ${cost}).${drawNote}` };
    }
    // Phase 1: ask player which to discard
    return {
      requiresChoice: true,
      choiceOptions: top2.map((card) => `Discard "${card}" (cost: ${getCcEffect(card)?.cost ?? '?'})`),
    };
  }

  // ccEffect: builtOnHopeEffect (Built on Hope) — look at top 3 of own deck, put 1 in hand, others returned to top
  if (entry.type === 'ccEffect' && entry.builtOnHopeEffect) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
    const handKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    const deck = [...(game[deckKey] || [])];
    if (deck.length === 0) return { applied: true, logMessage: '**Built on Hope** — Your deck is empty.' };
    const top3 = deck.slice(-Math.min(3, deck.length));
    if (top3.length === 1 || (choiceIndex !== undefined && choiceIndex !== null)) {
      const chosen = top3[choiceIndex ?? 0];
      if (!chosen) return { applied: false, manualMessage: 'Invalid choice for Built on Hope.' };
      // Remove the top 3 from deck (they may be at end), put chosen in hand, others back on top
      deck.splice(deck.length - top3.length, top3.length);
      const remaining = top3.filter((c) => c !== chosen || (() => { const i = top3.indexOf(chosen); top3.splice(i, 1); return false; })());
      const remaining2 = top3.filter((c) => c !== chosen);
      if (remaining2.length) deck.push(...remaining2); // put non-chosen back on top (end of array)
      const hand = [...(game[handKey] || [])];
      hand.push(chosen);
      game[deckKey] = deck;
      game[handKey] = hand;
      return { applied: true, logMessage: `**Built on Hope** — Drew **${chosen}** from top 3. Other card(s) returned to top of deck.` };
    }
    return {
      requiresChoice: true,
      choiceOptions: top3.map((card) => `Add "${card}" to hand (cost: ${getCcEffect(card)?.cost ?? '?'})`),
    };
  }

  // ccEffect: evacuateEffect (Evacuate) — defeat a chosen friendly within 2 spaces; opponent gains only half VP
  if (entry.type === 'ccEffect' && entry.evacuateEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: defeat chosen figure
    if (chosenFigureKey) {
      const targetMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!targetMsgId || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually: could not locate chosen figure.' };
      const hs = dcHealthState.get(targetMsgId) || [];
      const figMatch = chosenFigureKey.match(/-(\d+)-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
      if (hs[figIdx]) {
        const [cur, max] = hs[figIdx];
        hs[figIdx] = [0, max ?? cur];
        dcHealthState.set(targetMsgId, hs);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx2 = (dcIds || []).indexOf(targetMsgId);
        if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
      }
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      const targetStats = getDcEffects()[dcName]?.cost ?? 0;
      const halfVp = Math.ceil((typeof targetStats === 'number' ? targetStats : 0) / 2);
      return { applied: true, logMessage: `**Evacuate** — **${dcName}** is defeated. Opponent gains ${halfVp > 0 ? halfVp + ' VP (half the deployment cost — use `/editvp -' + halfVp + '` to adjust)' : 'no VP'} from this defeat.`, refreshDcEmbed: true };
    }
    // Phase 1: find friendly figures within 2 spaces (not self)
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingPos = activatingKeys.length ? game.figurePositions?.[playerNum]?.[activatingKeys[0]] : null;
    if (!activatingPos) return { applied: false, manualMessage: 'Resolve manually: activating figure has no position.' };
    const friendlyFigureKeys = [];
    const friendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || activatingKeys.includes(fk)) continue;
      const dcName = fk.replace(/-\d+-\d+$/, '');
      // Rough distance check (Manhattan)
      const [r1, c1] = String(activatingPos).toUpperCase().split(/(\d+)/).filter(Boolean);
      const [r2, c2] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
      const rowDist = Math.abs((r1?.charCodeAt(0) ?? 0) - (r2?.charCodeAt(0) ?? 0));
      const colDist = Math.abs(parseInt(c1 || '0') - parseInt(c2 || '0'));
      if (rowDist + colDist > 2) continue;
      friendlyFigureKeys.push(fk);
      friendlyLabels.push(dcName);
    }
    if (friendlyFigureKeys.length === 0) return { applied: false, manualMessage: 'No friendly figures within 2 spaces to evacuate.' };
    return { requiresChoice: true, choiceOptions: friendlyLabels.map((n) => `Defeat ${n}`), choiceValues: friendlyFigureKeys };
  }

  // ccEffect: induceRageEffect (Induce Rage) — chosen figures discard all conditions, gain 1 Hit Token per condition
  if (entry.type === 'ccEffect' && entry.induceRageEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const results = [];
    let figuresProcessed = 0;
    for (const pn of [1, 2]) {
      for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
        const conds = game.figureConditions?.[fk] || [];
        if (!conds.length || figuresProcessed >= 2) continue;
        const count = conds.length;
        game.figureConditions[fk] = [];
        game.figurePowerTokens = game.figurePowerTokens || {};
        game.figurePowerTokens[fk] = [...(game.figurePowerTokens[fk] || [])];
        for (let i = 0; i < count; i++) game.figurePowerTokens[fk].push('Hit');
        const dcName = fk.replace(/-\d+-\d+$/, '');
        results.push(`**${dcName}** lost [${conds.join(', ')}] → +${count} Hit Token${count !== 1 ? 's' : ''}`);
        figuresProcessed++;
      }
    }
    if (!results.length) return { applied: true, logMessage: '**Induce Rage** — No figures with conditions found.' };
    return { applied: true, logMessage: `**Induce Rage** — ${results.join('; ')}.` };
  }

  // ccEffect: ferocityEffect (Ferocity) — choose a CREATURE figure, it performs 1 free attack
  if (entry.type === 'ccEffect' && entry.ferocityEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant free attack to chosen figure's DC
    if (chosenFigureKey) {
      const creatureMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta) ||
        findMsgIdForFigureKey(game, playerNum === 1 ? 2 : 1, chosenFigureKey, dcMessageMeta);
      if (!creatureMsgId) return { applied: false, manualMessage: 'Resolve manually: could not locate creature figure.' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[creatureMsgId] = true;
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Ferocity** — **${dcName}** may perform 1 free attack (use their Attack button).` };
    }
    // Phase 1: find CREATURE figures from both players
    const dcEffects = getDcEffects();
    const creatureKeys = [];
    const creatureLabels = [];
    for (const pn of [1, 2]) {
      for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
        const dcName = fk.replace(/-\d+-\d+$/, '');
        const eff = dcEffects[dcName] || dcEffects[dcName.replace(/\s*\[.*\]\s*$/, '')] || {};
        const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
        if (kws.includes('CREATURE')) {
          creatureKeys.push(fk);
          creatureLabels.push(`${dcName} (P${pn})`);
        }
      }
    }
    if (creatureKeys.length === 0) return { applied: false, manualMessage: 'No CREATURE figures in play.' };
    if (creatureKeys.length === 1) {
      // Auto-apply
      const mid = findMsgIdForFigureKey(game, 1, creatureKeys[0], dcMessageMeta) || findMsgIdForFigureKey(game, 2, creatureKeys[0], dcMessageMeta);
      if (mid) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[mid] = true;
        return { applied: true, logMessage: `**Ferocity** — **${creatureKeys[0].replace(/-\d+-\d+$/, '')}** may perform 1 free attack (use their Attack button).` };
      }
    }
    return { requiresChoice: true, choiceOptions: creatureLabels, choiceValues: creatureKeys };
  }

  // ccEffect: droidMasteryEffect (Droid Mastery) — J4X-7 gains Focus; may then perform 1 free attack
  if (entry.type === 'ccEffect' && entry.droidMasteryEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Find J4X-7 figure
    const j4xFk = Object.keys(game.figurePositions?.[playerNum] || {}).find((fk) => fk.startsWith('J4X-7-'));
    if (!j4xFk) {
      return { applied: true, logMessage: '**Droid Mastery** — J4X-7 is not in play. Deploy J4X-7 to Jarrod Kelvin\'s space manually, then apply this card again.' };
    }
    game.figureConditions = game.figureConditions || {};
    const existing = game.figureConditions[j4xFk] || [];
    if (!existing.includes('Focus')) game.figureConditions[j4xFk] = [...existing, 'Focus'];
    // Grant free attack to J4X-7's DC
    const j4xMsgId = findMsgIdForFigureKey(game, playerNum, j4xFk, dcMessageMeta);
    if (j4xMsgId) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[j4xMsgId] = true;
    }
    return { applied: true, logMessage: '**Droid Mastery** — J4X-7 is now **Focused**. J4X-7 may perform 1 free attack (use J4X-7\'s Attack button).' };
  }

  // ccEffect: hiddenTrapEffect (Hidden Trap) — pick a terminal space, deal 2 damage to all adjacent figures
  if (entry.type === 'ccEffect' && entry.hiddenTrapEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenSpace } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (chosenSpace) {
      // Phase 2: apply 2 damage to all figures adjacent to chosen space
      if (!dcHealthState) return { applied: false, manualMessage: 'Apply 2 Damage to each figure adjacent to the terminal manually.' };
      const boardState = getBoardStateForMovement(game, null);
      const spaceNorm = String(chosenSpace).toLowerCase();
      const adjRaw = boardState?.mapSpaces?.adjacency?.[spaceNorm] || [];
      const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
      const results = [];
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || !adjSet.has(String(coord).toLowerCase())) continue;
          const dcName = fk.replace(/-\d+-\d+$/, '');
          const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
          if (figMsgId) {
            const hs = dcHealthState.get(figMsgId) || [];
            const fkMatch = fk.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const hp = hs[figIdx];
            if (hp) {
              const [cur, max] = hp;
              const newCur = Math.max(0, (cur ?? max) - 2);
              hs[figIdx] = [newCur, max ?? newCur];
              dcHealthState.set(figMsgId, hs);
              const dcIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
              const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
              const idx2 = (dcIds || []).indexOf(figMsgId);
              if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
              results.push(`**${dcName}**: 2 Dmg (HP: ${cur ?? max}→${newCur})`);
            } else {
              results.push(`**${dcName}**: apply 2 Dmg manually`);
            }
          } else {
            results.push(`apply 2 Dmg to ${dcName.replace(/-\d+-\d+$/, '')} manually`);
          }
        }
      }
      return { applied: true, logMessage: `**Hidden Trap** — Terminal at **${String(chosenSpace).toUpperCase()}**. ${results.length ? results.join('; ') : 'No figures adjacent.'}`, refreshDcEmbed: results.length > 0 };
    }
    // Phase 1: space picker — show all spaces within 8 of activating figure
    const boardState = getBoardStateForMovement(game, null);
    const adj = boardState?.mapSpaces?.adjacency;
    if (!adj) return { applied: false, manualMessage: 'Apply Hidden Trap manually (no map data).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const allSpaces = Object.keys(adj);
    let validSpaces = allSpaces;
    if (actPos) {
      const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
      validSpaces = allSpaces.filter((sp) => {
        const [sr, sc] = String(sp).toUpperCase().split(/(\d+)/).filter(Boolean);
        return Math.abs((ar?.charCodeAt(0) ?? 0) - (sr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(sc || '0')) <= 8;
      });
    }
    if (!validSpaces.length) validSpaces = allSpaces.slice(0, 25);
    return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: '**Hidden Trap** — Choose the terminal space:' };
  }

  // ccEffect: fieldSupplyEffect (Field Supply) — up to 2 friendly figures within 3 each gain 1 Hit Token
  if (entry.type === 'ccEffect' && entry.fieldSupplyEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant Hit Token to chosen figure
    if (chosenFigureKey) {
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[chosenFigureKey] = [...(game.figurePowerTokens[chosenFigureKey] || []), 'Hit'];
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Field Supply** — **${dcName}** gained 1 Hit Token. (Surge Token also allowed; for a 2nd figure, apply manually.)` };
    }
    // Phase 1: find friendly figures within 3
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    if (!actPos) {
      // Auto-grant to nearest friendly if no position data
      const fks = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => !actKeys.includes(fk));
      if (!fks.length) return { applied: false, manualMessage: 'No friendly figures to grant tokens to.' };
      game.figurePowerTokens = game.figurePowerTokens || {};
      const targets = fks.slice(0, 2);
      const names = targets.map((fk) => { game.figurePowerTokens[fk] = [...(game.figurePowerTokens[fk] || []), 'Hit']; return fk.replace(/-\d+-\d+$/, ''); });
      return { applied: true, logMessage: `**Field Supply** — Hit Token granted to: ${names.join(', ')}.` };
    }
    const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
    const nearbyKeys = [];
    const nearbyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
      if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 3) continue;
      nearbyKeys.push(fk);
      nearbyLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!nearbyKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces.' };
    return { requiresChoice: true, choiceOptions: nearbyLabels.map((n) => `Hit Token → ${n}`), choiceValues: nearbyKeys };
  }

  // ccEffect: feralSwipesEffect (Feral Swipes) — 1 Melee attack per die in pool, each using 1 red die
  if (entry.type === 'ccEffect' && entry.feralSwipesEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcName = meta.dcName;
    const dcEffects = getDcEffects();
    const normalDice = dcEffects[dcName]?.attack?.dice || ['red'];
    const diceCount = normalDice.length;
    // Override first attack to 1 red die (melee)
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { dice: ['red'], type: 'melee' };
    // Grant (diceCount - 1) more free attacks
    if (diceCount > 1) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = diceCount - 1;
    }
    return { applied: true, logMessage: `**Feral Swipes** — **${dcName}** performs ${diceCount} Melee attack${diceCount !== 1 ? 's' : ''} (1 red die each). First attack override set. Each remaining free attack: use 1 red die.` };
  }

  // ccEffect: optimalBombardmentEffect (Optimal Bombardment) — adjacent VEHICLE/DROID/HEAVY WEAPON figures may each perform 1 free attack
  if (entry.type === 'ccEffect' && entry.optimalBombardmentEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    if (!actPos || !meta) return { applied: false, manualMessage: 'Resolve manually: no activation position.' };
    const boardState = getBoardStateForMovement(game, null);
    const adjRaw = boardState?.mapSpaces?.adjacency?.[String(actPos).toLowerCase()] || [];
    const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
    const dcEffects = getDcEffects();
    const targets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk) || !adjSet.has(String(pos).toLowerCase())) continue;
      const dcN = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('VEHICLE') || kws.includes('DROID') || kws.includes('HEAVY WEAPON')) {
        targets.push(fk);
      }
    }
    if (!targets.length) return { applied: false, manualMessage: 'No adjacent VEHICLE/DROID/HEAVY WEAPON figures to activate.' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    const names = [];
    let count = 0;
    for (const fk of targets.slice(0, 3)) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (figMsgId) { game.freeAttackBonusPending[figMsgId] = true; count++; }
      names.push(fk.replace(/-\d+-\d+$/, ''));
    }
    return { applied: true, logMessage: `**Optimal Bombardment** — Free attack granted to: ${names.join(', ')} (${count} figure${count !== 1 ? 's' : ''}, up to 3).` };
  }

  // ccEffect: overheatedEffect (Overheated) — Strain 4; override next attack(s) to Melee; 2 total attacks if originally Ranged
  if (entry.type === 'ccEffect' && entry.overheatedEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Apply 4 Strain to activating figure
    let strainNote = '4 Strain applied manually (HP not found)';
    if (dcHealthState) {
      const actData = game.dcActionsData?.[msgId];
      const figIdx = actData?.selectedFigure ?? 0;
      const hs = dcHealthState.get(msgId) || [];
      if (hs[figIdx]) {
        const [cur, max] = hs[figIdx];
        const newCur = Math.max(0, (cur ?? max) - 4);
        hs[figIdx] = [newCur, max ?? newCur];
        dcHealthState.set(msgId, hs);
        const dcIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idx2 = (dcIds || []).indexOf(msgId);
        if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
        strainNote = `4 Strain (HP: ${cur ?? max}→${newCur})`;
      }
    }
    // Override next attack to melee; grant 1 free attack (for 2 total)
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { type: 'melee' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    return { applied: true, logMessage: `**Overheated** — **${meta.dcName}**: ${strainNote}. 2 Melee attacks queued (apply −1 Hit per attack manually). Attack type is now Melee.`, refreshDcEmbed: true };
  }

  // ccEffect: setTheChargesEffect (Set the Charges) — pick a space within 3; roll blue die; apply Hit+Surge as damage; open doors (honor)
  if (entry.type === 'ccEffect' && entry.setTheChargesEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenSpace } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (chosenSpace) {
      // Phase 2: roll blue die, apply total to adjacent figures
      const diceData = getDiceData?.();
      const blueFaces = diceData?.attack?.blue || [];
      const faceIdx = Math.floor(Math.random() * Math.max(blueFaces.length, 1));
      const face = blueFaces[faceIdx] || {};
      const hitsFromDie = (face.hits || 0) + (face.surge ? 1 : 0);
      const dieLabel = face.label || JSON.stringify(face);
      const boardState = getBoardStateForMovement(game, null);
      const spaceNorm = String(chosenSpace).toLowerCase();
      const adjRaw = boardState?.mapSpaces?.adjacency?.[spaceNorm] || [];
      const affectedSpaces = new Set([spaceNorm, ...adjRaw.map((s) => String(s).toLowerCase())]);
      const results = [];
      if (dcHealthState && hitsFromDie > 0) {
        for (const pn of [1, 2]) {
          for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
            if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
            const dcN = fk.replace(/-\d+-\d+$/, '');
            const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
            if (figMsgId) {
              const hs = dcHealthState.get(figMsgId) || [];
              const fkM = fk.match(/-(\d+)-(\d+)$/);
              const fi = fkM ? parseInt(fkM[2], 10) : 0;
              const hp = hs[fi];
              if (hp) {
                const [cur, max] = hp;
                const newCur = Math.max(0, (cur ?? max) - hitsFromDie);
                hs[fi] = [newCur, max ?? newCur];
                dcHealthState.set(figMsgId, hs);
                const dcIds = pn === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
                const dcList = pn === 1 ? game.p1DcList : game.p2DcList;
                const idx2 = (dcIds || []).indexOf(figMsgId);
                if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
                results.push(`**${dcN}**: ${hitsFromDie} Dmg (HP: ${cur ?? max}→${newCur})`);
              } else { results.push(`**${dcN}**: apply ${hitsFromDie} Dmg manually`); }
            }
          }
        }
      }
      const noFigures = hitsFromDie === 0 ? '0 Hits+Surges — no damage.' : results.length ? results.join('; ') : 'No figures in area.';
      return { applied: true, logMessage: `**Set the Charges** — Space **${String(chosenSpace).toUpperCase()}**, rolled blue die: **${dieLabel}** (${hitsFromDie} dmg). ${noFigures} Open adjacent unlocked doors manually.`, refreshDcEmbed: results.length > 0 };
    }
    // Phase 1: space picker within 3 of activating figure
    const boardState = getBoardStateForMovement(game, null);
    if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Resolve Set the Charges manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    if (!actPos) return { applied: false, manualMessage: 'Resolve Set the Charges manually (no position).' };
    const occ = boardState.occupiedSet;
    const occArr = occ instanceof Set ? [...occ] : (occ || []);
    const reachable = getReachableSpaces(actPos, 3, boardState.mapSpaces, occArr);
    const validSet = new Set([String(actPos).toLowerCase(), ...reachable.map((s) => String(s).toLowerCase())]);
    const validSpaces = [...validSet];
    if (!validSpaces.length) return { applied: false, manualMessage: 'Resolve Set the Charges manually (no spaces in range).' };
    return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: '**Set the Charges** — Choose a space within 3:' };
  }

  // ccEffect: faceMeEffect (Face Me!) — pick a unique hostile in LOS; push them to adjacent (manual); grant free melee attack
  if (entry.type === 'ccEffect' && entry.faceMeEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Phase 2: grant free attack
    if (chosenFigureKey) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Face Me!** — Move **${dcName}** adjacent manually (push = their Speed spaces). Then use your Melee Attack button for 1 free attack.` };
    }
    // Phase 1: hostile figure picker (unique figures only)
    const oppNum = playerNum === 1 ? 2 : 1;
    const dcEffects = getDcEffects();
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      const dcN = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcN] || {};
      if (eff.unique) { hostileKeys.push(fk); hostileLabels.push(dcN); }
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No unique hostile figures in play. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Push & attack: ${n}`), choiceValues: hostileKeys };
  }

  // ccEffect: supportSpecialistEffect (Support Specialist) — choose DROID/TECHNICIAN/TROOPER within 3; grant free move (extra MP)
  if (entry.type === 'ccEffect' && entry.supportSpecialistEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant bonus MP (free move) to chosen figure
    if (chosenFigureKey) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find figure DC — apply action manually.' };
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      game.movementBank = game.movementBank || {};
      const bank = game.movementBank[figMsgId] || { total: 0, remaining: 0 };
      bank.total = (bank.total || 0) + figSpeed;
      bank.remaining = (bank.remaining || 0) + figSpeed;
      game.movementBank[figMsgId] = bank;
      return { applied: true, logMessage: `**Support Specialist** — **${dcName}** gains ${figSpeed} MP (free interrupt move). Use their Move button to spend MP.` };
    }
    // Phase 1: find DROID/TECHNICIAN/TROOPER friendlies within 3
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos) {
        const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
        const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
        if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 3) continue;
      }
      const dcN = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('DROID') || kws.includes('TECHNICIAN') || kws.includes('TROOPER')) {
        validKeys.push(fk); validLabels.push(dcN);
      }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No DROID/TECHNICIAN/TROOPER friendlies within 3 spaces.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Interrupt move: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: fieldTacticianEffect (Field Tactician) — choose any friendly within 2; grant them free move
  if (entry.type === 'ccEffect' && entry.fieldTacticianEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant move MP to chosen figure
    if (chosenFigureKey) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find figure DC — apply move manually.' };
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      game.movementBank = game.movementBank || {};
      const bank = game.movementBank[figMsgId] || { total: 0, remaining: 0 };
      bank.total = (bank.total || 0) + figSpeed;
      bank.remaining = (bank.remaining || 0) + figSpeed;
      game.movementBank[figMsgId] = bank;
      return { applied: true, logMessage: `**Field Tactician** — **${dcName}** gains ${figSpeed} MP (interrupt move). Use their Move button.` };
    }
    // Phase 1: any friendly within 2
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos) {
        const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
        const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
        if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 2) continue;
      }
      validKeys.push(fk); validLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly figures within 2 spaces.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Interrupt move: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: callTheVanguardEffect (Call the Vanguard) — choose TROOPER cost 4+ within range; grant move + free attack
  if (entry.type === 'ccEffect' && entry.callTheVanguardEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant move MP + free attack to chosen figure
    if (chosenFigureKey) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find TROOPER DC — apply interrupt manually.' };
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      game.movementBank = game.movementBank || {};
      const bank = game.movementBank[figMsgId] || { total: 0, remaining: 0 };
      bank.total = (bank.total || 0) + figSpeed;
      bank.remaining = (bank.remaining || 0) + figSpeed;
      game.movementBank[figMsgId] = bank;
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[figMsgId] = true;
      return { applied: true, logMessage: `**Call the Vanguard** — **${dcName}** gains ${figSpeed} MP + 1 free attack (interrupt). Use their Move and Attack buttons.` };
    }
    // Phase 1: find TROOPER figures with cost 4+ (any range, any player's table)
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      const dcN = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('TROOPER') && (eff.cost ?? 0) >= 4) { validKeys.push(fk); validLabels.push(`${dcN} (cost ${eff.cost})`); }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No TROOPER figures with cost 4+ in play.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Interrupt: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: triangulateEffect (Triangulate) — move DROIDs manually (honor); pick hostile; deal damage = # friendly DROIDs in play (LOS honor)
  if (entry.type === 'ccEffect' && entry.triangulateEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    // Phase 2: apply damage to chosen hostile = # friendly DROIDs in play
    if (chosenFigureKey) {
      const oppNum = playerNum === 1 ? 2 : 1;
      const droidCount = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => {
        const dcN = fk.replace(/-\d+-\d+$/, '');
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('DROID');
      }).length;
      if (!droidCount) return { applied: false, manualMessage: 'No friendly DROIDs in play to deal damage.' };
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      const figMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      let dmgNote = `${droidCount} Dmg to ${dcName} manually`;
      if (figMsgId && dcHealthState) {
        const hs = dcHealthState.get(figMsgId) || [];
        const fkM = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const fi = fkM ? parseInt(fkM[2], 10) : 0;
        if (hs[fi]) {
          const [cur, max] = hs[fi];
          const newCur = Math.max(0, (cur ?? max) - droidCount);
          hs[fi] = [newCur, max ?? newCur];
          dcHealthState.set(figMsgId, hs);
          const dcIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = oppNum === 1 ? game.p1DcList : game.p2DcList;
          const idx2 = (dcIds || []).indexOf(figMsgId);
          if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
          dmgNote = `${droidCount} Dmg (HP: ${cur ?? max}→${newCur})`;
        }
      }
      return { applied: true, logMessage: `**Triangulate** — **${dcName}**: ${dmgNote}. (Max = ${droidCount} DROIDs in play — verify LOS manually for each.)`, refreshDcEmbed: !!figMsgId };
    }
    // Phase 1: hostile figure picker (move DROIDs first manually)
    const oppNum = playerNum === 1 ? 2 : 1;
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      hostileKeys.push(fk); hostileLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No hostile figures to target.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Target: ${n} (move DROIDs first)`), choiceValues: hostileKeys };
  }

  // ccEffect: packAlphaEffect (Pack Alpha) — move CREATUREs manually; pick hostile; deal damage = # adjacent CREATUREs
  if (entry.type === 'ccEffect' && entry.packAlphaEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    const oppNum = playerNum === 1 ? 2 : 1;
    // Phase 2: count CREATUREs adjacent to chosen hostile, apply damage
    if (chosenFigureKey) {
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      const boardState = getBoardStateForMovement(game, null);
      const adjRaw = targetPos ? (boardState?.mapSpaces?.adjacency?.[String(targetPos).toLowerCase()] || []) : [];
      const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
      const adjacentCreatures = Object.entries(game.figurePositions?.[playerNum] || {}).filter(([fk, pos]) => {
        if (!pos || !adjSet.has(String(pos).toLowerCase())) return false;
        const dcN = fk.replace(/-\d+-\d+$/, '');
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('CREATURE');
      });
      const dmg = adjacentCreatures.length;
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      if (!dmg) return { applied: true, logMessage: `**Pack Alpha** — No friendly CREATUREs adjacent to **${dcName}** (move them first next time).` };
      const figMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      let dmgNote = `${dmg} Dmg to ${dcName} manually`;
      if (figMsgId && dcHealthState) {
        const hs = dcHealthState.get(figMsgId) || [];
        const fkM = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const fi = fkM ? parseInt(fkM[2], 10) : 0;
        if (hs[fi]) {
          const [cur, max] = hs[fi];
          const newCur = Math.max(0, (cur ?? max) - dmg);
          hs[fi] = [newCur, max ?? newCur];
          dcHealthState.set(figMsgId, hs);
          const dcIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
          const dcList = oppNum === 1 ? game.p1DcList : game.p2DcList;
          const idx2 = (dcIds || []).indexOf(figMsgId);
          if (idx2 >= 0 && dcList?.[idx2]) dcList[idx2].healthState = [...hs];
          dmgNote = `${dmg} Dmg (HP: ${cur ?? max}→${newCur})`;
        }
      }
      return { applied: true, logMessage: `**Pack Alpha** — **${dcName}**: ${dmgNote}. (${adjacentCreatures.map(([fk]) => fk.replace(/-\d+-\d+$/, '')).join(', ')} adjacent)`, refreshDcEmbed: !!figMsgId };
    }
    // Phase 1: hostile figure picker (move CREATUREs first manually)
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      hostileKeys.push(fk); hostileLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No hostile figures to target.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Target: ${n} (move CREATUREs first)`), choiceValues: hostileKeys };
  }

  // ccEffect: coordinatedAttackEffect (Coordinated Attack) — pick friendly within 3; grant both Loku and that figure 1 free attack
  if (entry.type === 'ccEffect' && entry.coordinatedAttackEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant free attack to both figures
    if (chosenFigureKey) {
      const friendlyMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
      if (friendlyMsgId) game.freeAttackBonusPending[friendlyMsgId] = true;
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Coordinated Attack** — **${meta.dcName}** and **${dcName}** each gain 1 free attack. Both must target the same hostile figure. LOS: figures don't block for these attacks (honor system).` };
    }
    // Phase 1: friendly figure picker within 3
    const actKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos) {
        const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
        const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
        if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 3) continue;
      }
      validKeys.push(fk); validLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces for Coordinated Attack.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Co-attacker: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: forcePushEffect (Force Push) — pick SMALL figure within 3; pick destination within 2 of target; move target
  if (entry.type === 'ccEffect' && entry.forcePushEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 3: move target figure to chosen space
    if (chosenFigureKey && chosenSpace) {
      const targetPn = game.figurePositions?.[1]?.[chosenFigureKey] != null ? 1 : 2;
      const oldPos = game.figurePositions?.[targetPn]?.[chosenFigureKey];
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[targetPn] = game.figurePositions[targetPn] || {};
      game.figurePositions[targetPn][chosenFigureKey] = String(chosenSpace).toLowerCase();
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Force Push** — **${dcName}** pushed from **${String(oldPos || '?').toUpperCase()}** to **${String(chosenSpace).toUpperCase()}**.`, refreshBoard: true };
    }
    // Phase 2: space picker within 2 of chosen figure's current position
    if (chosenFigureKey) {
      const targetPn = game.figurePositions?.[1]?.[chosenFigureKey] != null ? 1 : 2;
      const targetPos = game.figurePositions?.[targetPn]?.[chosenFigureKey];
      if (!targetPos) return { applied: false, manualMessage: 'Could not locate target figure position. Push manually.' };
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Push manually (no map data).' };
      const occ = boardState.occupiedSet;
      const occArr = occ instanceof Set ? [...occ] : (occ || []);
      const reachable = getReachableSpaces(targetPos, 2, boardState.mapSpaces, occArr);
      const validSpaces = reachable.map((s) => String(s).toLowerCase()).filter((s) => !occArr.includes(s));
      if (!validSpaces.length) return { applied: false, manualMessage: 'No empty spaces within 2 to push the figure to.' };
      return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**Force Push** — Choose destination (within 2 of ${chosenFigureKey.replace(/-\d+-\d+$/, '')}):`, chosenFigureKey };
    }
    // Phase 1: pick SMALL figure within 3
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const pn of [1, 2]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos || actKeys.includes(fk)) continue;
        const dcN = fk.replace(/-\d+-\d+$/, '');
        const eff = dcEffects[dcN] || {};
        const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
        if (kws.includes('MASSIVE') || kws.includes('LARGE')) continue; // only SMALL figures
        if (actPos) {
          const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
          const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
          if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 3) continue;
        }
        validKeys.push(fk); validLabels.push(`${dcN} (P${pn})`);
      }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No SMALL figures within 3 spaces to push.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Push: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: devotionEffect (Devotion) — pick adjacent friendly; note trait to search; shuffle deck
  if (entry.type === 'ccEffect' && entry.devotionEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: log trait to search for + shuffle deck
    if (chosenFigureKey) {
      const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
      const deck = [...(game[deckKey] || [])];
      // Shuffle deck (Fisher-Yates)
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      game[deckKey] = deck;
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      return { applied: true, logMessage: `**Devotion** — Search your Command deck for a card with **${dcName}** as a trait and draw it (honor system). Deck shuffled (${deck.length} cards).` };
    }
    // Phase 1: adjacent friendly picker
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const boardState = getBoardStateForMovement(game, null);
    const adjRaw = actPos ? (boardState?.mapSpaces?.adjacency?.[String(actPos).toLowerCase()] || []) : [];
    const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (!adjSet.has(String(pos).toLowerCase())) continue;
      validKeys.push(fk); validLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No adjacent friendly figures. Resolve Devotion manually.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Search for: ${n} trait`), choiceValues: validKeys };
  }

  // ccEffect: learnByExampleEffect (Learn by Example) — copy a FORCE USER CC in any discard pile
  if (entry.type === 'ccEffect' && entry.learnByExampleEffect) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const allDiscards = [...new Set([...(game.player1CcDiscard || []), ...(game.player2CcDiscard || [])])];
    const forceUserCards = allDiscards.filter((card) => {
      const eff = getCcEffect(card);
      return eff && (String(eff.playableBy || '').includes('FORCE USER') || String(eff.playableBy || '').includes('Force User'));
    });
    if (!forceUserCards.length) return { applied: false, manualMessage: 'No FORCE USER Command cards in any discard pile.' };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const chosenCard = forceUserCards[choiceIndex];
      if (!chosenCard) return { applied: false, manualMessage: 'Invalid choice.' };
      const chosenAbilityId = getCcEffect(chosenCard)?.abilityId ?? chosenCard;
      // Recursively resolve the chosen card's ability with same context
      const result = resolveAbility(chosenAbilityId, { ...context, cardName: chosenCard });
      if (result.applied || result.requiresChoice || result.requiresSpaceChoice) return result;
      return { applied: true, logMessage: `**Learn by Example** — Copying **${chosenCard}**. ${result.manualMessage || result.logMessage || 'Apply effect manually.'}` };
    }
    return { requiresChoice: true, choiceOptions: forceUserCards.map((c) => `Copy: ${c} (${getCcEffect(c)?.playableBy ?? '?'})`) };
  }

  // ccEffect: battlefieldAwarenessEffect (Battlefield Awareness) — grant +1 attack reroll to a friendly figure within 3
  if (entry.type === 'ccEffect' && entry.battlefieldAwarenessEffect) {
    const { game, playerNum, dcMessageMeta, combat, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: apply the reroll
    if (chosenFigureKey) {
      const dcName = chosenFigureKey.replace(/-\d+-\d+$/, '');
      if (combat?.attackerRerollsRemaining != null) {
        // Mid-combat: add directly to attacker rerolls (the friendly just rolled dice)
        combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
        return { applied: true, logMessage: `**Battlefield Awareness** — Added 1 reroll for **${dcName}** in the current attack.` };
      }
      // Otherwise: grant +1 to round attack reroll pool for this player
      game.roundAttackRerollDice = game.roundAttackRerollDice || {};
      game.roundAttackRerollDice[playerNum] = (game.roundAttackRerollDice[playerNum] || 0) + 1;
      return { applied: true, logMessage: `**Battlefield Awareness** — +1 attack reroll granted (for **${dcName}**'s next attack this round).` };
    }
    // Phase 1: pick friendly within 3
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos) {
        const [ar, ac] = String(actPos).toUpperCase().split(/(\d+)/).filter(Boolean);
        const [fr, fc] = String(pos).toUpperCase().split(/(\d+)/).filter(Boolean);
        if (Math.abs((ar?.charCodeAt(0) ?? 0) - (fr?.charCodeAt(0) ?? 0)) + Math.abs(parseInt(ac || '0') - parseInt(fc || '0')) > 3) continue;
      }
      validKeys.push(fk); validLabels.push(fk.replace(/-\d+-\d+$/, ''));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Grant reroll: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: letsMakeADealEffect (Let's Make a Deal) — pay X VP to opponent for -X Hits in combat + become Focused
  if (entry.type === 'ccEffect' && entry.letsMakeADealEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex, combat } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || "Resolve manually — pay VP to opponent to reduce hits, then become Focused." };
    const oppNum = playerNum === 1 ? 2 : 1;
    const ownVpKey = playerNum === 1 ? 'player1VP' : 'player2VP';
    const oppVpKey = oppNum === 1 ? 'player1VP' : 'player2VP';
    const ownVp = game[ownVpKey]?.total ?? 0;
    const maxPay = Math.min(ownVp, 5);
    // Phase 2: apply the deal
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const X = choiceIndex; // options: 0 VP (skip), 1 VP, 2 VP, etc.
      if (X > 0) {
        game[ownVpKey] = game[ownVpKey] || { total: 0, kills: 0, objectives: 0 };
        game[ownVpKey].total = Math.max(0, game[ownVpKey].total - X);
        game[oppVpKey] = game[oppVpKey] || { total: 0, kills: 0, objectives: 0 };
        game[oppVpKey].total = (game[oppVpKey].total || 0) + X;
        if (combat) combat.bonusHits = (combat.bonusHits || 0) - X;
      }
      // Apply Focus to Hondo's figure
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      const meta = msgId ? dcMessageMeta?.get(msgId) : null;
      const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
      game.figureConditions = game.figureConditions || {};
      actKeys.forEach((fk) => { game.figureConditions[fk] = [...new Set([...(game.figureConditions[fk] || []), 'Focus'])]; });
      const ownNew = game[ownVpKey]?.total ?? 0;
      const oppNew = game[oppVpKey]?.total ?? 0;
      return { applied: true, logMessage: `**Let's Make a Deal** — Paid ${X} VP (your total: ${ownNew}, theirs: ${oppNew}). ${X > 0 ? `Applied −${X} Hits to attack.` : 'No VP paid.'} Hondo becomes Focused.` };
    }
    // Phase 1: show VP options
    const options = ['Pay 0 VP (just apply Focus)'];
    for (let i = 1; i <= maxPay; i++) options.push(`Pay ${i} VP → −${i} Hits`);
    if (ownVp === 0) return { requiresChoice: true, choiceOptions: ['Pay 0 VP (just apply Focus)'] };
    return { requiresChoice: true, choiceOptions: options };
  }

  // ccEffect: demoralizingMonologueEffect (Demoralizing Monologue) — force defender to reroll 1 die during attack
  if (entry.type === 'ccEffect' && entry.demoralizingMonologueEffect) {
    const { game, playerNum, combat } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    // Add 1 forced reroll to defender's pool
    if (combat.defenderRerollsRemaining != null) {
      combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
    } else {
      combat.defenderRerollDiceMax = (combat.defenderRerollDiceMax || 0) + 1;
    }
    return { applied: true, logMessage: "**Demoralizing Monologue** — Defender gains +1 forced reroll. Moff Gideon chooses which die to reroll (honor system). If 2+ cards revealed, remove that die's result (honor system)." };
  }

  // ccEffect: doubleOrNothingEffect (Double or Nothing) — choose a die; reroll it; if same icon type, may double those icons
  if (entry.type === 'ccEffect' && entry.doubleOrNothingEffect) {
    const { game, playerNum, combat, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      if (choiceIndex === 0) {
        // Attacker die
        combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
        return { applied: true, logMessage: "**Double or Nothing** — Attacker rerolls 1 die of choice. If same icon type, attacker may double those icons (honor system)." };
      } else {
        // Defender die
        combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
        return { applied: true, logMessage: "**Double or Nothing** — Defender rerolls 1 die of choice. If same icon type, defender may double those icons (honor system)." };
      }
    }
    return { requiresChoice: true, choiceOptions: ['Reroll an attack die', 'Reroll a defense die'] };
  }

  // dcSpecial: pounceRange (Nexu Pounce) — place figure in empty space within N, then may attack free
  if (entry.type === 'dcSpecial' && entry.pounceRange) {
    const { game, playerNum, dcMessageMeta, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = context.msgId || findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: 'Resolve manually: no activation meta.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (!figureKeys.length) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const fk = figureKeys[0];
    if (!chosenSpace) {
      // First call: compute valid empty spaces within pounceRange (path through open spaces, ignore occupancy for traversal)
      const pos = game.figurePositions?.[playerNum]?.[fk];
      if (!pos) return { applied: false, manualMessage: 'Figure has no position (deploy first).' };
      const boardState = getBoardStateForMovement(game, fk);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Map data missing.' };
      // Travel path ignores other figures (place effect); collect all occupied spaces as blocked destinations only
      const allReachable = getReachableSpaces(pos, entry.pounceRange, boardState.mapSpaces, []);
      const occupied = new Set();
      for (const pNum of [1, 2]) {
        for (const coord of Object.values(game.figurePositions?.[pNum] || {})) {
          if (coord) occupied.add(String(coord).toLowerCase());
        }
      }
      const validSpaces = allReachable.filter((s) => !occupied.has(String(s).toLowerCase()));
      if (!validSpaces.length) return { applied: false, manualMessage: 'No empty spaces within 3 to pounce to.' };
      return { requiresSpaceChoice: true, validSpaces };
    }
    // Second call: teleport figure to chosen space, grant free pounce attack
    game.figurePositions = game.figurePositions || {};
    game.figurePositions[playerNum] = game.figurePositions[playerNum] || {};
    game.figurePositions[playerNum][fk] = chosenSpace;
    game.pounceAttackPending = game.pounceAttackPending || {};
    game.pounceAttackPending[msgId] = { figureKey: fk, figureIndex: 0 };
    return {
      applied: true,
      logMessage: `**Pounce**: placed at **${String(chosenSpace).toUpperCase()}**. May now perform an attack (free — use Attack button).`,
      refreshBoard: true,
    };
  }

  // ccEffect: mpBonus (Adrenaline — gain N MP during your activation; standalone, no damage or condition cost)
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    return { applied: true, logMessage: `Gained **${entry.mpBonus} MP**.` };
  }

  // ccEffect: readyOwnDeploymentCard (Son of Skywalker — ready your DC after any activation)
  if (entry.type === 'ccEffect' && entry.readyOwnDeploymentCard) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const activatedKey = playerNum === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices';
    const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
    const idx = dcMessageIds.indexOf(msgId);
    if (idx >= 0 && Array.isArray(game[activatedKey])) {
      game[activatedKey] = game[activatedKey].filter((i) => i !== idx);
    }
    return {
      applied: true,
      logMessage: 'Your Deployment card is now **Readied**. Use **Refresh All** to update the DC embed.',
      refreshDcEmbed: true,
    };
  }

  // ccEffect: signalJammer (Signal Jammer — cancel the next CC played by either player)
  if (entry.type === 'ccEffect' && entry.signalJammer) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.signalJammerActive = { playerNum };
    return {
      applied: true,
      logMessage: '**Signal Jammer** is now active. The next Command card played by either player will be cancelled and both cards discarded.',
    };
  }

  // ccEffect: setsHarshEnvironment (Harsh Environment — round-scoped modifier flag)
  if (entry.type === 'ccEffect' && entry.setsHarshEnvironment) {
    const { game } = context;
    if (!game) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.harshEnvironmentActive = true;
    return {
      applied: true,
      logMessage: '**Harsh Environment** is now active this round. Figures on **exterior** spaces: −1 Evade. Figures on **interior** spaces: +1 Block. Track manually during defense rolls.',
    };
  }

  // ccEffect: setsTerminalControl (Terminal Network — control all terminals this round)
  if (entry.type === 'ccEffect' && entry.setsTerminalControl) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.terminalControlPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: '**Terminal Network** active — you control all terminals until start of next round, regardless of adjacency.',
    };
  }

  // ccEffect: setsToughLuck (Tough Luck — when opponent rerolls a die, remove it from results this round)
  if (entry.type === 'ccEffect' && entry.setsToughLuck) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.toughLuckPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, when your opponent rerolls a die, remove that die from the results (honor).',
    };
  }

  // ccEffect: setsTherIsNoTry (There Is No Try — REBEL FORCE USER die manipulation this round)
  if (entry.type === 'ccEffect' && entry.setsTherIsNoTry) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.thereIsNoTryPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, when a friendly REBEL FORCE USER rolls dice: set 1 die to any side and convert Dodge results to your choice (honor).',
    };
  }

  // ccEffect: setsYouWillNotDenyMe (You Will Not Deny Me — Fifth Brother immortal + recover 2 on each hostile defeat)
  if (entry.type === 'ccEffect' && entry.setsYouWillNotDenyMe) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.youWillNotDenyMeActive = { playerNum };
    return {
      applied: true,
      logMessage: '**You Will Not Deny Me** active — Fifth Brother cannot be defeated, ignores conditions, and recovers 2 Damage each time a hostile figure is defeated this round (honor).',
    };
  }

  // ccEffect: setsMandaAsteel (Mandalorian Steel — recover 1 Damage when friendly spends a Block Token)
  if (entry.type === 'ccEffect' && entry.setsMandaAsteel) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.mandaAsteelPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, when a friendly figure spends a Block Token during defense, recover 1 Damage on that figure (honor).',
    };
  }

  // ccEffect: setsStillFaster (Still Faster Than You — interrupt at start of hostile activation)
  if (entry.type === 'ccEffect' && entry.setsStillFaster) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.stillFasterPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, at the start of a hostile activation: interrupt to move 2 spaces and attack a different hostile figure (honor).',
    };
  }

  // ccEffect: disablesFigure (Disable — chosen hostile cannot use Surge or Special Actions this round)
  if (entry.type === 'ccEffect' && entry.disablesFigure) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = playerNum === 1 ? (game.p2DcList || []) : (game.p1DcList || []);
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to disable.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.disabledFigures = game.disabledFigures || [];
    if (!game.disabledFigures.includes(chosenOption)) game.disabledFigures.push(chosenOption);
    return {
      applied: true,
      logMessage: `**${chosenOption}** is Disabled — cannot use Surge abilities or Special Actions this round (honor).`,
    };
  }

  // ccEffect: setsHoldGround (Hold Ground — SMALL hostiles cannot voluntarily exit spaces adjacent to player's figures)
  if (entry.type === 'ccEffect' && entry.setsHoldGround) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.holdGroundPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, SMALL hostile figures cannot voluntarily exit spaces adjacent to your figures (honor).',
    };
  }

  // ccEffect: setsWindfall (Windfall — gain VP equal to cost when CCs are discarded from hand)
  if (entry.type === 'ccEffect' && entry.setsWindfall) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.windfallActive = { playerNum };
    return {
      applied: true,
      logMessage: '**Windfall** active — each time a Command card is played, you gain VP equal to its cost.',
    };
  }

  // ccEffect: setsBounty (Price on Their Heads — +4 VP when chosen hostile group is defeated)
  if (entry.type === 'ccEffect' && entry.setsBounty) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = playerNum === 1 ? (game.p2DcList || []) : (game.p1DcList || []);
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to place a bounty on.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.priceBounties = game.priceBounties || {};
    game.priceBounties[chosenOption] = (game.priceBounties[chosenOption] || 0) + 4;
    return {
      applied: true,
      logMessage: `Bounty on **${chosenOption}**: +4 VP when that group is defeated — apply via **/editvp** when it happens.`,
    };
  }

  // ccEffect: setsWreakVengeance (Wreak Vengeance — use both Dual-Bladed Fury effects instead of 1)
  if (entry.type === 'ccEffect' && entry.setsWreakVengeance) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.wreakVengeanceActive = { playerNum };
    return {
      applied: true,
      logMessage: '**Wreak Vengeance** active — when using Dual-Bladed Fury this activation, choose both effects instead of 1.',
    };
  }

  // ccEffect: revealsOpponentHand (Collect Intel) — ephemeral reveal of opponent's CC hand
  if (entry.type === 'ccEffect' && entry.revealsOpponentHand) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppHandKey = playerNum === 1 ? 'player2CcHand' : 'player1CcHand';
    const oppHand = game[oppHandKey] || [];
    const handText = oppHand.length > 0 ? oppHand.map((c) => `**${c}**`).join(', ') : '*(empty)*';
    return {
      applied: true,
      revealToPlayer: `**Opponent's hand (${oppHand.length} card${oppHand.length !== 1 ? 's' : ''}):** ${handText}`,
      logMessage: "Looked at opponent's Command hand.",
    };
  }

  // ccEffect: revealsOpponentDeckTop (Behind Enemy Lines) — ephemeral reveal of top N cards of opponent's deck
  if (entry.type === 'ccEffect' && typeof entry.revealsOpponentDeckTop === 'number' && entry.revealsOpponentDeckTop > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const n = entry.revealsOpponentDeckTop;
    const oppDeckKey = playerNum === 1 ? 'player2CcDeck' : 'player1CcDeck';
    const oppDeck = game[oppDeckKey] || [];
    const topCards = oppDeck.slice(0, n);
    const deckText = topCards.length > 0 ? topCards.map((c) => `**${c}**`).join(', ') : '*(empty)*';
    return {
      applied: true,
      revealToPlayer: `**Top ${topCards.length} card${topCards.length !== 1 ? 's' : ''} of opponent's deck:** ${deckText}\nReturn them in any order (honor).`,
      logMessage: `Looked at top ${topCards.length} card(s) of opponent's Command deck.`,
    };
  }

  // ccEffect: stealsFromOpponentDiscard (Data Theft) — take a CC from opponent's discard pile
  if (entry.type === 'ccEffect' && entry.stealsFromOpponentDiscard) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDiscardKey = playerNum === 1 ? 'player2CcDiscard' : 'player1CcDiscard';
    const oppDiscard = (game[oppDiscardKey] || []).slice();
    if (chosenOption == null) {
      if (oppDiscard.length === 0) return { applied: false, manualMessage: "Opponent's discard pile is empty." };
      return { requiresChoice: true, choiceOptions: [...oppDiscard] };
    }
    const stealIdx = oppDiscard.indexOf(chosenOption);
    if (stealIdx < 0) return { applied: false, manualMessage: `"${chosenOption}" not found in opponent's discard.` };
    oppDiscard.splice(stealIdx, 1);
    game[oppDiscardKey] = oppDiscard;
    const ownHandKey = playerNum === 1 ? 'player1CcHand' : 'player2CcHand';
    game[ownHandKey] = [...(game[ownHandKey] || []), chosenOption];
    return {
      applied: true,
      drewCards: [chosenOption],
      refreshHand: true,
      refreshDiscard: true,
      logMessage: `Took **${chosenOption}** from opponent's discard. It may be played once this round.`,
    };
  }

  // ccEffect: setsUnlimitedPower (Unlimited Power — Emperor targets any friendly figure on map this round)
  if (entry.type === 'ccEffect' && entry.setsUnlimitedPower) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.unlimitedPowerActive = { playerNum };
    return {
      applied: true,
      logMessage: '**Unlimited Power** — The Emperor may target any friendly figure on the map (not limited to within 4 spaces) this round.',
    };
  }

  // ccEffect: cripplesFigure (Cripple — chosen adjacent hostile cannot voluntarily exit its space this round)
  if (entry.type === 'ccEffect' && entry.cripplesFigure) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = playerNum === 1 ? (game.p2DcList || []) : (game.p1DcList || []);
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to cripple.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.crippledFigures = game.crippledFigures || [];
    if (!game.crippledFigures.includes(chosenOption)) game.crippledFigures.push(chosenOption);
    return {
      applied: true,
      logMessage: `**${chosenOption}** is Crippled — cannot voluntarily exit its space this round (honor).`,
    };
  }

  // ccEffect: placeDefeatedFigure (Reinforcements, Cloned Reinforcements, Endless Reserves)
  // placeDefeatedFigure: { traitFilter?, excludeTraits?, nonUnique?, maxReinforcementCost?, maxFigureCost?, placementAnchor, shuffleBackToDeck? }
  // Flow: 1st call → find candidates (requiresChoice if >1, or requiresSpaceChoice if =1);
  //        2nd call (chosenFigureKey, no chosenSpace) → compute valid spaces → requiresSpaceChoice;
  //        3rd call (chosenFigureKey + chosenSpace) → place figure, optionally shuffle card back.
  if (entry.type === 'ccEffect' && entry.placeDefeatedFigure) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    const pdf = entry.placeDefeatedFigure;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const poses = game.figurePositions?.[playerNum] || {};

    // Helper: compute valid placement spaces for a chosen figure key
    const computeValidSpaces = (fk) => {
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return [];
      const occupied = new Set();
      for (const pNum of [1, 2]) {
        for (const coord of Object.values(game.figurePositions?.[pNum] || {})) {
          if (coord) occupied.add(String(coord).toLowerCase());
        }
      }
      let anchorPositions = [];
      if (pdf.placementAnchor === 'sameGroup') {
        for (const dc of dcList) {
          const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
          if (!dcName) continue;
          const displayName = typeof dc === 'object' ? dc.displayName : dcName;
          const dgMatch = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
          const dgIndex = dgMatch ? dgMatch[1] : '1';
          const prefix = `${dcName}-${dgIndex}-`;
          if (fk.startsWith(prefix)) {
            for (const [k, coord] of Object.entries(poses)) {
              if (k.startsWith(prefix) && coord) anchorPositions.push(coord);
            }
            break;
          }
        }
      } else if (pdf.placementAnchor === 'activatingFigure') {
        if (dcMessageMeta) {
          const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
          if (msgId) {
            const meta = dcMessageMeta.get(msgId);
            if (meta) {
              for (const k of getFigureKeysForDcMsg(game, playerNum, meta)) {
                const pos = poses[k];
                if (pos) anchorPositions.push(pos);
              }
            }
          }
        }
      }
      if (anchorPositions.length === 0) return [];
      const validSet = new Set();
      for (const anchor of anchorPositions) {
        for (const s of getReachableSpaces(anchor, 1, boardState.mapSpaces, [])) {
          if (!occupied.has(String(s).toLowerCase())) validSet.add(String(s).toLowerCase());
        }
      }
      return [...validSet];
    };

    // Helper: build a display label for a figure key
    const getFigLabel = (fk) => {
      for (const dc of dcList) {
        const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
        if (!dcName) continue;
        const displayName = typeof dc === 'object' ? dc.displayName : dcName;
        const dgMatch = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const prefix = `${dcName}-${dgIndex}-`;
        if (fk.startsWith(prefix)) {
          const figIdx = parseInt(fk.replace(prefix, ''), 10);
          const figCount = getStatsForDc(dcName)?.figures ?? 1;
          const suffix = figCount <= 1 || isNaN(figIdx) || figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
          return `${displayName || dcName}${suffix}`;
        }
      }
      return fk;
    };

    // 3rd call: place figure at chosen space
    if (chosenFigureKey && chosenSpace) {
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[playerNum] = game.figurePositions[playerNum] || {};
      game.figurePositions[playerNum][chosenFigureKey] = String(chosenSpace).toLowerCase();
      const figLabel = getFigLabel(chosenFigureKey);
      let shuffleMsg = '';
      if (pdf.shuffleBackToDeck) {
        const deckKey = playerNum === 1 ? 'player1CcDeck' : 'player2CcDeck';
        const discardKey = playerNum === 1 ? 'player1CcDiscard' : 'player2CcDiscard';
        const discard = (game[discardKey] || []).slice();
        const cardIdx = discard.lastIndexOf(abilityId);
        if (cardIdx >= 0) {
          discard.splice(cardIdx, 1);
          game[discardKey] = discard;
          const deck = (game[deckKey] || []).slice();
          deck.push(abilityId);
          for (let k = deck.length - 1; k > 0; k--) {
            const j = Math.floor(Math.random() * (k + 1));
            [deck[k], deck[j]] = [deck[j], deck[k]];
          }
          game[deckKey] = deck;
          shuffleMsg = ` **${abilityId}** shuffled back into deck.`;
        }
      }
      return {
        applied: true,
        logMessage: `Placed **${figLabel}** at **${String(chosenSpace).toUpperCase()}**.${shuffleMsg}`,
        refreshBoard: true,
        ...(pdf.shuffleBackToDeck ? { refreshDiscard: true } : {}),
      };
    }

    // 2nd call: figure chosen, compute valid spaces
    if (chosenFigureKey) {
      const validSpaces = computeValidSpaces(chosenFigureKey);
      if (validSpaces.length === 0) {
        return { applied: false, manualMessage: `No empty spaces adjacent to ${pdf.placementAnchor === 'activatingFigure' ? 'activating figure' : 'same group'}. Resolve manually.` };
      }
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey };
    }

    // 1st call: find eligible defeated figures
    const candidates = [];
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      if (!dcName) continue;
      const displayName = typeof dc === 'object' ? dc.displayName : dcName;
      const dgMatch = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : String(i + 1);
      const stats = getStatsForDc(dcName);
      const keywords = stats?.keywords || [];
      if (pdf.traitFilter?.length && !pdf.traitFilter.some((t) => keywords.includes(t))) continue;
      if (pdf.excludeTraits?.length && pdf.excludeTraits.some((t) => keywords.includes(t))) continue;
      if (pdf.nonUnique && stats?.unique) continue;
      const figureCost = stats?.subCost ?? stats?.cost ?? 0;
      if (pdf.maxReinforcementCost != null && figureCost > pdf.maxReinforcementCost) continue;
      if (pdf.maxFigureCost != null && figureCost > pdf.maxFigureCost) continue;
      const figureCount = stats?.figures ?? 1;
      for (let figIdx = 0; figIdx < figureCount; figIdx++) {
        const fk = `${dcName}-${dgIndex}-${figIdx}`;
        if (!poses[fk]) {
          const suffix = figureCount <= 1 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
          candidates.push({ figureKey: fk, label: `${displayName || dcName}${suffix}` });
        }
      }
    }

    if (candidates.length === 0) return { applied: false, manualMessage: 'No eligible defeated figures found.' };

    if (candidates.length === 1) {
      const { figureKey } = candidates[0];
      const validSpaces = computeValidSpaces(figureKey);
      if (validSpaces.length === 0) {
        return { applied: false, manualMessage: `No empty spaces adjacent to ${pdf.placementAnchor === 'activatingFigure' ? 'activating figure' : 'same group'}. Resolve manually.` };
      }
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey: figureKey };
    }

    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: candidates.map((c) => c.label),
      choiceValues: candidates.map((c) => c.figureKey),
    };
  }

  // Cal's Buddy: deploy BD-1 companion to Cal's space or an adjacent space
  if (abilityId === "Cal's Buddy") {
    const { game, playerNum, chosenSpace } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: "Resolve **Cal's Buddy** manually." };
    const playerPositions = game.figurePositions?.[playerNum] || {};
    const calFigKey = Object.keys(playerPositions).find((k) => k.startsWith('Cal Kestis-'));
    const calPos = calFigKey ? playerPositions[calFigKey] : null;

    if (!chosenSpace) {
      // Phase 1: build valid deployment spaces (Cal's space + adjacent)
      if (!calPos) return { applied: false, manualMessage: "**Cal's Buddy** — Cal Kestis has no position on the board. Resolve manually." };
      const ms = getMapSpaces(game.selectedMap?.id);
      const adjacent = ms?.adjacency?.[calPos] || [];
      const validSpaces = [calPos, ...adjacent];
      return {
        requiresSpaceChoice: true,
        validSpaces,
        spaceChoiceLabel: `**Cal's Buddy** — Deploy BD-1 to Cal's space or an adjacent space:`,
      };
    }

    // Phase 2: place BD-1 at chosen space
    const existingBd1Key = Object.keys(playerPositions).find((k) => k.startsWith('BD-1-'));
    const bd1Key = existingBd1Key || 'BD-1-1-0';
    game.figurePositions[playerNum][bd1Key] = String(chosenSpace).toLowerCase();
    return {
      applied: true,
      logMessage: `**Cal's Buddy** — BD-1 deployed to **${String(chosenSpace).toUpperCase()}**. BD-1 activates at the start or end of Cal's activation.`,
      refreshBoard: true,
    };
  }

  return { applied: false, manualMessage: entry.label ? `Resolve manually: ${entry.label}` : 'Resolve manually (see rules).' };
}

/** Count defeated friendly figures for player (deployed but no longer on map). */
function countDefeatedFriendlyFigures(game, playerNum) {
  const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
  const poses = game.figurePositions?.[playerNum] || {};
  let defeated = 0;
  for (let i = 0; i < dcList.length; i++) {
    const dc = dcList[i];
    const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!dcName) continue;
    const displayName = typeof dc === 'object' ? dc.displayName : dcName;
    const dgMatch = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : String(i + 1);
    const stats = getStatsForDc(dcName);
    const figureCount = stats?.figures ?? 1;
    const prefix = `${dcName}-${dgIndex}-`;
    let current = 0;
    for (const k of Object.keys(poses)) {
      if (k.startsWith(prefix)) current++;
    }
    defeated += Math.max(0, figureCount - current);
  }
  return defeated;
}

/** Find msgId of the DC currently being activated by playerNum (has dcActionsData). */
function findActiveActivationMsgId(game, playerNum, dcMessageMeta) {
  if (!game?.dcActionsData || !dcMessageMeta) return null;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId === game.gameId && meta?.playerNum === playerNum && game.dcActionsData?.[msgId]) {
      return msgId;
    }
  }
  return null;
}

/** Get figure keys for the DC represented by meta (msgId). */
function getFigureKeysForDcMsg(game, playerNum, meta) {
  const dcName = meta?.dcName;
  if (!dcName) return [];
  const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
  const dgIndex = dgMatch ? dgMatch[1] : '1';
  const prefix = `${dcName}-${dgIndex}-`;
  const positions = game.figurePositions?.[playerNum] || {};
  return Object.keys(positions).filter((k) => k.startsWith(prefix));
}

/** Find msgId for a figure key (for dcHealthState lookup). */
function findMsgIdForFigureKey(game, playerNum, figureKey, dcMessageMeta) {
  if (!dcMessageMeta) return null;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId !== game.gameId || meta?.playerNum !== playerNum) continue;
    const keys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (keys.includes(figureKey)) return msgId;
  }
  return null;
}
