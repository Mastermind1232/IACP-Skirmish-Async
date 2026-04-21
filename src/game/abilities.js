/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary, getDcEffects, getDiceData, getCcEffect, getCcEffectsData, getMapData, getMapTokensData } from '../data-loader.js';
import { parseCoord, normalizeCoord, getFootprintCells, edgeKey } from './coords.js';
import { dcNameFromFigureKey, parseFigureKey, getMaxPowerTokens, figureChoiceLabels } from './dc-helpers.js';
import { grantPowerTokens } from './game-helpers.js';
import { reduceHp, healHp } from './damage-helpers.js';
import { awardObjectiveVp, deductVp } from './vp-helpers.js';
import { countGameSpaces } from './board-helpers.js';


/**
 * Decrement a figure's HP in a healthState array.
 * @param {Array} hs - healthState array for the DC (from dcHealthState.get(msgId))
 * @param {number} figIdx - figure index within the group
 * @param {number} amount - damage/strain to apply
 * @returns {{ prev: number, cur: number, max: number } | null} - HP change info, or null if no figure
 */
function decrementFigureHealth(hs, figIdx, amount) {
  if (!hs?.[figIdx]) return null;
  const [cur, max] = hs[figIdx];
  const prev = cur ?? max;
  const newCur = Math.max(0, prev - amount);
  hs[figIdx] = [newCur, max ?? newCur];
  return { prev, cur: newCur, max: max ?? newCur };
}

/**
 * Get uppercased keywords for a DC by name.
 * @param {string} dcName - DC name (e.g. from dcNameFromFigureKey)
 * @returns {string[]} - uppercased keyword array (e.g. ['MOBILE', 'TROOPER'])
 */
function getKeywordsUpper(dcName) {
  return (getDcEffects()?.[dcName]?.keywords || []).map(k => String(k).toUpperCase());
}

/** Look up DC stats by name (handles display variants). */
function getStatsForDc(dcName) {
  const map = getDcEffects() || {};
  const base = (dcName || '').replace(/\s*\[.*\]\s*$/, '').trim();
  return map[base] || map[dcName] || (() => {
    const key = Object.keys(map).find((k) => k.toLowerCase() === (base || dcName || '').toLowerCase());
    return key ? map[key] : {};
  })();
}
import { applyCondition, resetCondition, filterCondition, isConditionImmune, HARMFUL_CONDITIONS } from './conditions.js';
import { parseSurgeEffect } from './combat.js';
import { getFiguresAdjacentToTarget, getBoardStateForMovement, getMovementProfile, getReachableSpaces, getEffectiveMapSpaces } from './movement.js';
import { getDcList, getDcMessageIds, getPlayerId, getCcDiscard, getSquad, ccHandKey, ccDiscardKey, ccDeckKey, vpKey, armyCostModifierKey, activatedDcIndicesKey, opponentPlayerNum, syncHealthStateToList, pushFigure } from './player-helpers.js';
import { hasLineOfSight } from './spatial.js';
import { checkDeckDiscardPassiveRedraws } from './cc-passive-redraw.js';


/**
 * Compute BFS shortest path between two spaces, then detect hostile figures
 * whose adjacency the pushed figure exits along the way.
 * Used by Force Push, Force Throw, Wrist Cord, etc. to log intermediate spaces
 * and warn about Parting Blow / similar triggers.
 *
 * @param {object} game
 * @param {string} fromPos - starting position (will be normalized)
 * @param {string} toPos - destination position (will be normalized)
 * @param {number} pushedFigurePlayerNum - which player owns the pushed figure
 * @returns {{ pathStr: string, warnings: Array<{name:string, space:string}> }}
 */
function computePushPathAndWarnings(game, fromPos, toPos, pushedFigurePlayerNum) {
  const result = { pathStr: '', warnings: [] };
  const mapId = game.selectedMap?.id;
  const rawMapSpaces = mapId ? getMapData(mapId) : null;
  if (!fromPos || !rawMapSpaces) return result;
  const adjacency = rawMapSpaces.adjacency || {};
  const startNorm = normalizeCoord(fromPos);
  const destNorm = normalizeCoord(toPos);
  if (startNorm === destNorm) return result;

  // BFS to find shortest path (ignoring occupied spaces — pushed figures pass through)
  const visited = new Map(); // coord → parent coord
  visited.set(startNorm, null);
  const queue = [startNorm];
  let found = false;
  while (queue.length > 0 && !found) {
    const cur = queue.shift();
    for (const neighbor of (adjacency[cur] || []).map(n => normalizeCoord(n))) {
      if (visited.has(neighbor)) continue;
      visited.set(neighbor, cur);
      if (neighbor === destNorm) { found = true; break; }
      queue.push(neighbor);
    }
  }
  // Reconstruct path
  const path = [];
  if (found) {
    let node = destNorm;
    while (node !== null) {
      path.unshift(node);
      node = visited.get(node) ?? null;
    }
  }
  if (path.length > 2) {
    const intermediates = path.slice(1, -1);
    result.pathStr = ` via ${intermediates.map(c => `**${c.toUpperCase()}**`).join(' \u2192 ')}`;
  }

  // Check at each space along the path if the pushed figure exits adjacency to any hostile figure
  if (path.length >= 2) {
    const hostilePn = pushedFigurePlayerNum === 1 ? 2 : 1;
    const hostilePositions = game.figurePositions?.[hostilePn] || {};
    const seenKeys = new Set();
    for (let i = 0; i < path.length - 1; i++) {
      const exitingSpace = path[i];
      const enteringSpace = path[i + 1];
      const exitAdj = new Set((adjacency[exitingSpace] || []).map(n => normalizeCoord(n)));
      const enterAdj = new Set((adjacency[enteringSpace] || []).map(n => normalizeCoord(n)));
      for (const [hfk, hPos] of Object.entries(hostilePositions)) {
        if (!hPos) continue;
        const hPosNorm = normalizeCoord(hPos);
        const hDcName = dcNameFromFigureKey(hfk);
        const hSize = game.figureOrientations?.[hfk] || '1x1';
        const hCells = getFootprintCells(hPosNorm, hSize).map(c => normalizeCoord(c));
        const isAdjacentBefore = hCells.some(c => exitAdj.has(c));
        if (!isAdjacentBefore) continue;
        const isAdjacentAfter = hCells.some(c => enterAdj.has(c) || c === enteringSpace);
        if (!isAdjacentAfter) {
          const warnKey = `${hfk}@${exitingSpace}`;
          if (seenKeys.has(warnKey)) continue;
          seenKeys.add(warnKey);
          const warnName = hDcName.replace(/_/g, ' ');
          result.warnings.push({ name: warnName, space: exitingSpace.toUpperCase() });
        }
      }
    }
  }
  return result;
}

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
  const deckKey = ccDeckKey(playerNum);
  const handKey = ccHandKey(playerNum);
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
 * Add N movement points to a figure's movement bank.
 * Initializes game.movementBank and the per-msgId entry if needed.
 * @param {object} game - Game state
 * @param {string} msgId - DC message ID
 * @param {number} n - Movement points to add
 */
function addMovementPoints(game, msgId, n) {
  game.movementBank = game.movementBank || {};
  const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
  bank.total = (bank.total ?? 0) + n;
  bank.remaining = (bank.remaining ?? 0) + n;
  game.movementBank[msgId] = bank;
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
      for (const fk of figureKeys) {
        applyCondition(game, fk, 'Focus');
      }
      parts.push('Became **Focused**');
    }
    // Grant bonus cleave for next attack via surge
    if (typeof chosen.nextAttackCleave === 'number' && chosen.nextAttackCleave > 0 && game && playerNum) {
      game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
      const existing = game.nextAttackBonusSurgeAbilities[playerNum] || [];
      game.nextAttackBonusSurgeAbilities[playerNum] = [...existing, `cleave ${chosen.nextAttackCleave}`];
    }
    // Grant Reach for next attack (melee range extended to 2)
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
    if (game.restInPeaceActive) return { applied: true, logMessage: '**Military Efficiency** — Blocked by **Rest in Peace** (cannot retrieve from discard this round).' };
    const discardKey = ccDiscardKey(playerNum);
    const deckKey = ccDeckKey(playerNum);
    const discard = game[discardKey] || [];
    if (discard.length === 0) return { applied: true, logMessage: '**Military Efficiency** — No cards in discard to return.' };
    // Shuffle the most-recently-discarded card back (auto-picks last discarded)
    const toReturn = discard[discard.length - 1];
    const newDiscard = discard.slice(0, -1);
    const deck = [...(game[deckKey] || [])];
    const insertIdx = Math.floor(Math.random() * (deck.length + 1));
    deck.splice(insertIdx, 0, toReturn);
    game[discardKey] = newDiscard;
    game[deckKey] = deck;
    return { applied: true, logMessage: `**Military Efficiency** — **${toReturn}** shuffled from discard back into your Command deck.`, refreshDiscard: true };
  }

  // dcSpecial: pushTargetWithinRange (Force Throw, Wrist Cord, Mandalorian Whip) — pick a target, then pick landing space, then push.
  // Phase 1 (no targetFigureKey): enumerate valid targets → requiresChoice.
  // Phase 2 (targetFigureKey set, no chosenSpace): enumerate valid landing spaces → requiresSpaceChoice.
  // Phase 3 (targetFigureKey + chosenSpace set): apply position update.
  if (entry.type === 'dcSpecial' && entry.pushTargetWithinRange && typeof entry.pushTargetWithinRange === 'object') {
    const { range = 3, requiresSmall = false, requiresLos = false, hostileOnly = false } = entry.pushTargetWithinRange;
    const { mustAdjacentToActivator = false, maxDistanceFromTarget } = entry.pushLandingEffect || {};
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSight: losCheck, getRange: getRng, getMapData: getMs, targetFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
    const enemyNum = opponentPlayerNum(playerNum);
    const label = entry.label || 'Push';
    // Resolve which player owns a given figure key (needed when targeting friendly or any figure)
    const _findOwner = (fk) => {
      if (game.figurePositions?.[1]?.[fk] != null) return 1;
      if (game.figurePositions?.[2]?.[fk] != null) return 2;
      return enemyNum; // fallback
    };

    // Phase 3: apply push to chosen space
    if (targetFigureKey && chosenSpace) {
      // Spiked Boots: cannot be pushed except by MASSIVE figures
      const _pushTargetDcName = dcNameFromFigureKey(targetFigureKey);
      const _pushTargetStats = getStatsForDc(_pushTargetDcName);
      const _pushTargetSIds = _pushTargetStats?.specialAbilityIds || [];
      if (_pushTargetSIds.includes('spiked_boots_snowtrooper')) {
        const pusherDcName = meta?.dcName || '';
        const pusherStats = getStatsForDc(pusherDcName);
        const pusherKws = (pusherStats?.keywords || []).map(k => String(k).toUpperCase());
        if (!pusherKws.includes('MASSIVE')) {
          return { applied: false, manualMessage: `**Spiked Boots** — **${_pushTargetDcName}** cannot be pushed except by MASSIVE figures.` };
        }
      }
      const targetOwner = _findOwner(targetFigureKey);
      const { prevPos } = pushFigure(game, targetOwner, targetFigureKey, chosenSpace) || { prevPos: null };
      // Deduct MP cost if applicable
      if (entry.mpCostToActivate && game.movementBank?.[msgId]) {
        game.movementBank[msgId].remaining = Math.max(0, game.movementBank[msgId].remaining - entry.mpCostToActivate);
      }
      const dcDisplay = meta?.displayName || meta?.dcName || label;
      const targetName = dcNameFromFigureKey(targetFigureKey);
      // Post-push free attack (Mandalorian Whip): grant free attack targeting the pushed figure
      if (entry.postPushFreeAttack) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[msgId] = true;
        game.forcedAttackTarget = game.forcedAttackTarget || {};
        game.forcedAttackTarget[msgId] = targetFigureKey;
      }
      // Compute path and adjacency-exit warnings for the push
      const { pathStr: _pushPathStr, warnings: _pushWarnings } = computePushPathAndWarnings(game, prevPos, chosenSpace, targetOwner);
      let _pushLogMsg = `**${label}** — **${dcDisplay}** pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} to ${String(chosenSpace).toUpperCase()}${_pushPathStr}.${entry.postPushFreeAttack ? ' Now attack that figure (free action).' : ''}`;
      if (_pushWarnings.length > 0) {
        const _warnList = _pushWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _pushLogMsg += `\n⚠️ Exits adjacency to: ${_warnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      return {
        applied: true,
        logMessage: _pushLogMsg,
        refreshBoard: true,
        refreshMovementBank: !!entry.mpCostToActivate,
        activeMsgId: msgId,
      };
    }

    // Phase 2: target chosen — enumerate valid landing spaces
    if (targetFigureKey && !chosenSpace) {
      const targetOwnerP2 = _findOwner(targetFigureKey);
      const targetPos = game.figurePositions?.[targetOwnerP2]?.[targetFigureKey];
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
      const _allCoords = mapSpaces.spaces || Object.keys(mapSpaces.adjacency || {});
      for (const coord of _allCoords) {
        if (occupiedSet.has(coord)) continue;
        if (maxDistanceFromTarget != null) {
          if (countGameSpaces(game, targetPos, coord) > maxDistanceFromTarget) continue;
        }
        if (mustAdjacentToActivator && attackerPos) {
          if (countGameSpaces(game, attackerPos, coord) !== 1) continue;
        }
        validSpaces.push(coord);
      }
      if (validSpaces.length === 0) return { applied: false, manualMessage: `**${label}** — no valid landing spaces. Resolve manually.` };
      return { applied: false, requiresSpaceChoice: true, validSpaces, targetFigureKey, spaceChoiceLabel: `**${label}** — Pick a landing space for **${dcNameFromFigureKey(targetFigureKey)}**:` };
    }

    // Phase 1: enumerate valid SMALL targets within range (hostile only if hostileOnly flag set)
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const attackerKey = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const attackerPos = attackerKey ? game.figurePositions?.[playerNum]?.[attackerKey] : null;
    const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
    const validTargets = [];
    // Build candidate pool: hostile only, or both sides
    const _candidateEntries = [];
    _candidateEntries.push(...Object.entries(game.figurePositions?.[enemyNum] || {}));
    if (!hostileOnly) {
      // Include friendly figures, but exclude the activating figure itself
      for (const [fk, coord] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (fk === attackerKey) continue;
        _candidateEntries.push([fk, coord]);
      }
    }
    for (const [fk, coord] of _candidateEntries) {
      if (!coord) continue;
      // SMALL check: figures with LARGE or MASSIVE keywords are not small
      const targetDcName = dcNameFromFigureKey(fk);
      const targetStats = getStatsForDc(targetDcName);
      const kwds = (targetStats?.keywords || []).map((k) => String(k).toUpperCase());
      if (requiresSmall && (kwds.includes('LARGE') || kwds.includes('MASSIVE'))) continue;
      // Spiked Boots: cannot be pushed except by MASSIVE figures
      const _pushTargetSIdsP1 = targetStats?.specialAbilityIds || [];
      if (_pushTargetSIdsP1.includes('spiked_boots_snowtrooper')) {
        const _pusherDcName = meta?.dcName || '';
        const _pusherStats = getStatsForDc(_pusherDcName);
        const _pusherKws = (_pusherStats?.keywords || []).map(k => String(k).toUpperCase());
        if (!_pusherKws.includes('MASSIVE')) continue;
      }
      // Range check
      if (attackerPos && countGameSpaces(game, attackerPos, coord) > range) continue;
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
        syncHealthStateToList(game, playerNum, msgId, healthState);
        strainApplied = true;
      }
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
      refreshDcEmbed: strainApplied,
    };
  }

  // dcSpecial: targetHostileFigure (Force Choke, Force Lightning) — pick enemy target, apply damage/strain/condition
  // First call: returns requiresChoice with enemy figure list; second call: applies effect to chosen figure.
  if (entry.type === 'dcSpecial' && entry.targetHostileFigure && typeof entry.targetHostileFigure === 'object') {
    const { damage = 0, strain = 0, applyCondition: condToApply, requiresLos = false, range: maxRange = 999, splashDamageNote, splashDamage = 0, splashConditions = [] } = entry.targetHostileFigure;
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSight: losCheck, getRange: getRng, getMapData: getMs, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.logMessage || `Resolve ${entry.label} manually.` };
    const enemyPlayerNum = opponentPlayerNum(playerNum);
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
          syncHealthStateToList(game, enemyPlayerNum, targetMsgId, healthState);
          const dmgStr = damage > 0 && strain > 0 ? `${damage} Damage + ${strain} Strain` : damage > 0 ? `${damage} Damage` : `${strain} Strain`;
          parts.push(`suffered ${dmgStr} (HP: ${cur ?? max} → ${newCur})`);
        } else {
          parts.push(`(HP not tracked — apply ${damage > 0 ? `${damage} Damage` : ''}${strain > 0 ? ` ${strain} Strain` : ''} manually)`);
        }
      } else if (totalDmg > 0) {
        const dmgStr = damage > 0 && strain > 0 ? `${damage} Damage + ${strain} Strain` : damage > 0 ? `${damage} Damage` : `${strain} Strain`;
        parts.push(`(apply ${dmgStr} manually)`);
      }
      if (condToApply) {
        if (applyCondition(game, targetFigureKey, condToApply)) {
          parts.push(`became **${condToApply}**`);
        }
      }
      const dcName = dcNameFromFigureKey(targetFigureKey);
      // Splash damage: apply splashDamage to all figures adjacent to the chosen target
      const splashParts = [];
      if (splashDamage > 0 || splashConditions.length > 0) {
        const mapId = game.selectedMap?.id;
        if (mapId) {
          const adjacent = getFiguresAdjacentToTarget(game, targetFigureKey, mapId);
          for (const { figureKey: adjFk, playerNum: adjPnum } of adjacent) {
            const adjMsgId = findMsgIdForFigureKey(game, adjPnum, adjFk, dcMessageMeta);
            const adjName = dcNameFromFigureKey(adjFk);
            if (splashDamage > 0 && dcHealthState && adjMsgId) {
              const adjHs = dcHealthState.get(adjMsgId) || [];
              const adjFkMatch = adjFk.match(/-(\d+)-(\d+)$/);
              const adjFigIdx = adjFkMatch ? parseInt(adjFkMatch[2], 10) : 0;
              const adjEntry = adjHs[adjFigIdx];
              if (adjEntry) {
                const [aCur, aMax] = adjEntry;
                const aNew = Math.max(0, (aCur ?? aMax) - splashDamage);
                adjHs[adjFigIdx] = [aNew, aMax ?? aNew];
                dcHealthState.set(adjMsgId, adjHs);
                syncHealthStateToList(game, adjPnum, adjMsgId, adjHs);
                splashParts.push(`**${adjName}** ${splashDamage} Damage (${aCur ?? aMax}→${aNew})`);
              } else {
                splashParts.push(`**${adjName}** (apply ${splashDamage} Damage manually)`);
              }
            } else if (splashDamage > 0) {
              splashParts.push(`**${adjName}** (apply ${splashDamage} Damage manually)`);
            }
            if (splashConditions.length > 0) {
              const adjToAdd = splashConditions.filter((c) => applyCondition(game, adjFk, c));
              if (adjToAdd.length > 0) {
                splashParts.push(`**${adjName}** gains ${adjToAdd.join(', ')}`);
              }
            }
          }
        }
      }
      const splashLog = splashParts.length > 0 ? `\nSplash — ${splashParts.join('; ')}` : splashDamageNote ? `\n> ${splashDamageNote}` : '';
      // selfCondition: apply a condition to the activating figure (e.g. Invasive Procedure → Focus self)
      let selfCondLog = '';
      if (entry.selfCondition) {
        const figureKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
        const selfKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
        if (selfKey) {
          applyCondition(game, selfKey, entry.selfCondition);
          selfCondLog = ` You became **${entry.selfCondition}ed**.`;
        }
      }
      return { applied: true, freeAction: !!entry.freeAction, logMessage: `**${entry.label}** — **${dcName}** ${parts.join(', ') || 'targeted'}.${splashLog}${selfCondLog}`, refreshDcEmbed: true };
    }
    // First call: enumerate valid enemy targets with range/LOS filter
    const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const attackerKey = activatingKeys.find((k) => k.endsWith(`-${selectedFig}`)) || activatingKeys[0];
    const attackerPos = attackerKey ? (game.figurePositions?.[playerNum]?.[attackerKey]) : null;
    const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
    // Terminal adjacency: activator must be on/adjacent to token (System Shock)
    const _thfActTokenType = entry.targetHostileFigure.activatorMustBeAdjacentToToken;
    if (_thfActTokenType && attackerPos) {
      const mapId = game.selectedMap?.id;
      const mapTokens = mapId ? (getMapTokensData()?.[mapId]) : null;
      const tokenPositions = mapTokens?.[_thfActTokenType + 's'] || [];
      if (tokenPositions.length > 0) {
        const posLower = String(attackerPos).toLowerCase();
        const adjSpaces = mapSpaces?.adjacency?.[attackerPos] || [];
        const isNear = tokenPositions.some(t => String(t).toLowerCase() === posLower) ||
                       tokenPositions.some(t => adjSpaces.includes(t));
        if (!isNear) return { applied: false, manualMessage: `**${entry.label}** — You must be on or adjacent to a ${_thfActTokenType}.` };
      }
    }
    // Terminal adjacency: filter targets to on/adjacent to token (System Shock)
    const _thfTgtTokenType = entry.targetHostileFigure.targetMustBeAdjacentToToken;
    let _tgtTokenPositions = [];
    if (_thfTgtTokenType) {
      const mapId = game.selectedMap?.id;
      const mapTokens = mapId ? (getMapTokensData()?.[mapId]) : null;
      _tgtTokenPositions = mapTokens?.[_thfTgtTokenType + 's'] || [];
    }
    const validTargets = [];
    for (const [fk, coord] of Object.entries(enemyPositions)) {
      if (!coord) continue;
      if (attackerPos && maxRange < 999) {
        const dist = countGameSpaces(game, attackerPos, coord);
        if (dist > maxRange) continue;
      }
      if (requiresLos && losCheck && attackerPos && mapSpaces) {
        if (!losCheck(attackerPos, coord, mapSpaces)) continue;
      }
      // Token adjacency filter (System Shock: target must be on/adjacent to terminal)
      if (_thfTgtTokenType && _tgtTokenPositions.length > 0) {
        const coordLower = String(coord).toLowerCase();
        const adjCoords = mapSpaces?.adjacency?.[coord] || [];
        const isNear = _tgtTokenPositions.some(t => String(t).toLowerCase() === coordLower) ||
                       _tgtTokenPositions.some(t => adjCoords.includes(t));
        if (!isNear) continue;
      }
      validTargets.push({ fk, name: dcNameFromFigureKey(fk) });
    }
    if (validTargets.length === 0) {
      // I36: If ability has selfCondition (e.g. Invasive Procedure), apply it even with no targets
      if (entry.selfCondition && attackerKey) {
        applyCondition(game, attackerKey, entry.selfCondition);
        return { applied: true, freeAction: !!entry.freeAction, logMessage: `**${entry.label}** — No adjacent targets. You became **${entry.selfCondition}ed**.`, refreshDcEmbed: true };
      }
      return { applied: false, manualMessage: `No valid targets in range/LOS. Apply **${entry.label}** manually.` };
    }
    return { applied: false, requiresChoice: true, choiceOptions: validTargets.map((t) => t.name), targetFigureKeys: validTargets.map((t) => t.fk) };
  }

  // dcSpecial: targetFriendlyFigureAdjacent (Gifted Mechanic) — pick adjacent friendly figure with trait, apply effect to both
  if (entry.type === 'dcSpecial' && entry.targetFriendlyFigureAdjacent && typeof entry.targetFriendlyFigureAdjacent === 'object') {
    const { traits = [], recoverSelf = 0, recoverTarget = 0, hitTokenSelf = 0, hitTokenTarget = 0, powerTokenTarget = 0 } = entry.targetFriendlyFigureAdjacent;
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve ${entry.label} manually.` };
    const mapId = game.selectedMap?.id;
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    // Helper: add Hit tokens to a figure key — overflow handled by grantPowerTokens
    function addHitToken(fk, n) {
      if (n <= 0) return;
      grantPowerTokens(game, fk, 'Damage', n);
    }
    // Second call: apply effects to self + chosen target
    if (choiceIndex != null && targetFigureKey) {
      const parts = [];
      // Recover self
      if (recoverSelf > 0 && dcHealthState) {
        const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const { healed: recovered } = healHp(dcHealthState, game, msgId, selectedFig, recoverSelf, playerNum);
        if (recovered > 0) parts.push(`you recovered ${recovered} Damage`);
      }
      // Recover target
      if (recoverTarget > 0 && dcHealthState) {
        const targetMsgId = findMsgIdForFigureKey(game, playerNum, targetFigureKey, dcMessageMeta);
        if (targetMsgId) {
          const figIdx = parseFigureKey(targetFigureKey).figureIndex;
          healHp(dcHealthState, game, targetMsgId, figIdx, recoverTarget, playerNum);
        }
        parts.push(`${dcNameFromFigureKey(targetFigureKey)} recovered ${recoverTarget} Damage`);
      }
      // Hit tokens
      if (hitTokenSelf > 0) { const sfk = activatingKeys[0]; if (sfk) { addHitToken(sfk, hitTokenSelf); parts.push(`you gained ${hitTokenSelf} Damage Token`); } }
      if (hitTokenTarget > 0) { addHitToken(targetFigureKey, hitTokenTarget); parts.push(`${dcNameFromFigureKey(targetFigureKey)} gained ${hitTokenTarget} Damage Token`); }
      // Power Token grant (player chooses type via pendingPowerTokenGrant)
      if (powerTokenTarget > 0) {
        const tName = dcNameFromFigureKey(targetFigureKey);
        game.pendingPowerTokenGrant = { grants: [{ figureKey: targetFigureKey, figName: tName, count: powerTokenTarget }], channelId: null, playerNum };
        parts.push(`${tName} gains ${powerTokenTarget} Power Token — choose type`);
        return { applied: true, requiresPowerTokenChoice: true, logMessage: `**${entry.label}** — ${parts.join(', ')}.`, refreshDcEmbed: true };
      }
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
      const dn = dcNameFromFigureKey(fk);
      const kws = (dcEffs[dn]?.keywords || []).map((k) => String(k).toUpperCase());
      return traits.length === 0 || traits.some((t) => kws.includes(t.toUpperCase()));
    }).map((fk) => ({ fk, name: dcNameFromFigureKey(fk) }));
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
      if (attackerPos) {
        const dist = countGameSpaces(game, attackerPos, coord);
        if (dist > maxRange) continue;
      }
      const dn = dcNameFromFigureKey(fk);
      const dcStats = dcEffs[dn];
      const diceCount = dcStats?.attack?.dice?.length ?? (dcStats?.attack ? 1 : 0);
      if (diceCount > maxDiceCount) continue;
      candidates.push(fk);
    }
    if (candidates.length === 0) return { applied: true, logMessage: `**${entry.label}** — No qualifying friendly figures within ${maxRange} spaces (≤${maxDiceCount} attack dice).` };
    const toHide = candidates.slice(0, maxTargets);
    const skipped = candidates.length > maxTargets ? ` (${candidates.length - maxTargets} additional candidates not hidden — choose manually if needed)` : '';
    const hidden = [];
    for (const fk of toHide) {
      if (applyCondition(game, fk, 'Hide')) { hidden.push(dcNameFromFigureKey(fk)); }
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
      const chosenName = dcNameFromFigureKey(targetFigureKey);
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
      if (countGameSpaces(game, activatingPos, pos) > 3) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Battlefield Leadership** — No other friendly figures within 3 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // emperor_interrupt (Emperor Palpatine): choose a friendly figure within 4 spaces; it gets a free attack
  if (abilityId === 'emperor_interrupt') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Emperor** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingEmperorInterrupt = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Emperor** — **${chosenName}** may interrupt to perform a free attack (no action cost). Use their **Attack** button.` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Emperor** — No position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 4) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Emperor** — No other friendly figures within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // You Have Something I Want (Moff Gideon): choose hostile with token within 4, transfer or 3 damage
  if (abilityId === 'you_have_something_i_want_gideon') {
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, choiceIndex, targetFigureKey, getRange: getRng } = context;
    if (!game || !playerNum || !meta || !msgId) return { applied: false, manualMessage: 'Resolve **You Have Something I Want** manually.' };

    // Phase 2: target+token chosen → set up opponent decision
    if (choiceIndex != null) {
      const options = game.yhsiwOptions || [];
      const chosen = options[choiceIndex];
      if (!chosen) return { applied: false, manualMessage: 'Invalid choice.' };
      const { figureKey: targetFk, token, playerNum: oppNum } = chosen;

      // Get Moff Gideon's figure key
      const actionsData = game.dcActionsData?.[msgId];
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';
      const gideonFk = `${meta.dcName}-${dgIndex}-${selectedFig}`;

      // Store pending YHSIW for opponent to respond
      game.pendingYHSIW = {
        targetFk, token, gideonFk, gideonPlayerNum: playerNum, oppPlayerNum: oppNum,
        msgId, gameId: game.gameId,
      };
      delete game.yhsiwOptions;

      return {
        applied: true,
        freeAction: true,
        yhsiwPending: true,
        logMessage: `**You Have Something I Want** — **Moff Gideon** targets **${dcNameFromFigureKey(targetFk)}**'s **${token}** token. Opponent must choose: **transfer** the token or **suffer 3 Damage**.`,
      };
    }

    // Phase 1: enumerate hostile figures within 4 spaces with power/condition tokens
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const gideonFk = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    const gideonPos = game.figurePositions?.[playerNum]?.[gideonFk];
    if (!gideonPos) return { applied: false, freeAction: true, manualMessage: 'Moff Gideon position unknown.' };

    const oppNum = opponentPlayerNum(playerNum);
    const oppPositions = game.figurePositions?.[oppNum] || {};

    const targets = [];
    for (const [fk, pos] of Object.entries(oppPositions)) {
      if (!pos) continue;
      const dist = countGameSpaces(game, gideonPos, pos);
      if (dist > 4) continue;
      // Power tokens
      const powerTokens = game.figurePowerTokens?.[fk] || [];
      for (const token of [...new Set(powerTokens)]) {
        targets.push({ fk, token, pn: oppNum, label: `${dcNameFromFigureKey(fk)} — ${token} Token` });
      }
      // Condition tokens
      const conditions = game.figureConditions?.[fk] || [];
      for (const cond of conditions) {
        targets.push({ fk, token: cond, pn: oppNum, label: `${dcNameFromFigureKey(fk)} — ${cond}` });
      }
    }

    if (targets.length === 0) return { applied: false, freeAction: true, manualMessage: 'No hostile figures within 4 spaces have Power Tokens or condition tokens.' };

    // Store options for Phase 2 lookup
    game.yhsiwOptions = targets.map(t => ({ figureKey: t.fk, token: t.token, playerNum: t.pn }));

    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: targets.map(t => t.label),
      targetFigureKeys: targets.map(t => t.fk),
    };
  }

  // tempt (Emperor Palpatine): choose any figure within 4 spaces; 1 damage + 1 Damage Token
  if (abilityId === 'tempt') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, dcMessageMeta, dcHealthState, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Tempt** manually.' };
    const enemyNum = opponentPlayerNum(playerNum);
    if (choiceIndex != null && targetFigureKey) {
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      // Determine which player owns the target figure (Tempt can target friendly or hostile)
      const targetOwnerNum = game.figurePositions?.[playerNum]?.[targetFigureKey] ? playerNum : enemyNum;
      // Apply 1 HP damage via reduceHp (canonical damage path — handles syncDcList + totalDamageReceived)
      let hpNote = '';
      let defeated = false;
      const targetMsgId = findMsgIdForFigureKey(game, targetOwnerNum, targetFigureKey, dcMessageMeta);
      if (dcHealthState && targetMsgId) {
        const { figureIndex: figIdx } = parseFigureKey(targetFigureKey);
        const { prevHp, newHp, wasDefeated } = reduceHp(dcHealthState, game, targetMsgId, figIdx, 1, targetOwnerNum);
        hpNote = ` (HP: ${prevHp} → ${newHp})`;
        if (wasDefeated) {
          defeated = true;
        }
      }
      // Grant 1 Damage Token to target (skip if defeated)
      if (!defeated) grantPowerTokens(game, targetFigureKey, 'Damage', 1);
      const tokenNote = defeated ? '' : ' and gains 1 Damage Token';
      const temptResult = { applied: true, logMessage: `**Tempt** — **${chosenName}** suffers 1 Damage${hpNote}${tokenNote}.`, refreshDcEmbed: true, refreshBoard: defeated };
      if (defeated) {
        temptResult.defeatedFigures = [{ figureKey: targetFigureKey, defeatedPlayerNum: targetOwnerNum, attackerPlayerNum: opponentPlayerNum(targetOwnerNum), source: 'Tempt' }];
      }
      return temptResult;
    }
    // Enumerate all figures (friendly + hostile) within 4 spaces except self
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Tempt** — No position on the board. Resolve manually.' };
    const validTargets = [];
    for (const pn of [playerNum, enemyNum]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (fk === activatingKey || !pos) continue;
        if (countGameSpaces(game, activatingPos, pos) > 4) continue;
        validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Tempt** — No figures within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // on_my_mark (Gideon Argus): choose a friendly figure — it becomes Focused
  if (abilityId === 'on_my_mark') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **On My Mark** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      applyCondition(game, targetFigureKey, 'Focus');
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**On My Mark** — **${chosenName}** is now **Focused** (+1 green die on next attack).`, refreshDcEmbed: true };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const validTargets = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk !== activatingKey && game.figurePositions[playerNum][fk]);
    if (validTargets.length === 0) return { applied: false, manualMessage: '**On My Mark** — No other friendly figures on the board.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // tactical_maneuver (Gideon Argus): choose a friendly figure — it gains 2 MP
  if (abilityId === 'tactical_maneuver') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Tactical Maneuver** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        addMovementPoints(game, chosenMsgId, 2);
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Tactical Maneuver** — **${chosenName}** gained **2 movement points**.`, orderMovePrompt: { figureKey: targetFigureKey, msgId: chosenMsgId, name: chosenName, mp: 2, label: 'Tactical Maneuver' } };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const validTargets = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk !== activatingKey && game.figurePositions[playerNum][fk]);
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Tactical Maneuver** — No other friendly figures on the board.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // executive_order (Imperial Officer Elite): choose an Imperial figure within 2 spaces; it interrupts to move or attack
  if (abilityId === 'executive_order') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Executive Order** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingExecutiveOrder = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Executive Order** — **${chosenName}** may interrupt to perform a free move or attack (no action cost). Use their **Move** or **Attack** button.` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Executive Order** — No position on the board. Resolve manually.' };
    const validTargets = [];
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 2) continue;
      // Must be Imperial affiliation
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      if (fkEff?.affiliation && fkEff.affiliation !== 'Imperial') continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Executive Order** — No friendly Imperial figures within 2 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // officer_order (Imperial Officer Regular): choose a friendly figure within 2 spaces; it gains 2 MP
  if (abilityId === 'officer_order') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Order** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        addMovementPoints(game, chosenMsgId, 2);
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Order** — **${chosenName}** gained **2 movement points**.`, orderMovePrompt: { figureKey: targetFigureKey, msgId: chosenMsgId, name: chosenName, mp: 2, label: 'Order' } };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Order** — No position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 2) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Order** — No other friendly figures within 2 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // bombardment_sorin (General Sorin): choose an adjacent friendly; it interrupts to attack with Blast 1 + Accuracy 1
  if (abilityId === 'bombardment_sorin') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Bombardment** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingBombardmentSorin = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
        // Grant Blast 1 + Accuracy 1 bonus for the next attack
        game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
        game.nextAttacksBonusHits[playerNum] = { count: 1, bonus: 0, blast: 1, accuracy: 1 };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Bombardment** — **${chosenName}** may interrupt to perform a free attack with **+1 Accuracy** and **Blast 1** (no action cost). Use their **Attack** button.` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Bombardment** — No position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 1) continue; // adjacent = within 1
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Bombardment** — No adjacent friendly figures.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // firing_squad (Kayn Somos): choose up to 2 adjacent Troopers; each interrupts to attack same target
  if (abilityId === 'firing_squad') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Firing Squad** manually.' };
    // Phase 2: first trooper chosen
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingFiringSquad = game.pendingFiringSquad || [];
        game.pendingFiringSquad.push({ forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      // Check if this is the second pick or if we should offer another
      if ((game.pendingFiringSquad || []).length >= 2) {
        const names = game.pendingFiringSquad.map(p => dcNameFromFigureKey(p.chosenFigureKey));
        return { applied: true, logMessage: `**Firing Squad** — **${names.join('** and **')}** may each interrupt to perform a free attack targeting the same hostile figure (no action cost). Use their **Attack** buttons.` };
      }
      // Offer second pick (or allow finishing with 1)
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
      const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
      const alreadyChosen = new Set((game.pendingFiringSquad || []).map(p => p.chosenFigureKey));
      const dcEffects = typeof getEff === 'function' ? getEff() : null;
      const moreTargets = [];
      if (activatingPos) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
          if (fk === activatingKey || !pos || alreadyChosen.has(fk)) continue;
          if (countGameSpaces(game, activatingPos, pos) > 1) continue;
          const fkDcName = dcNameFromFigureKey(fk);
          const fkEff = dcEffects?.[fkDcName];
          const fkKeywords = (fkEff?.keywords || []).map(k => k.toUpperCase());
          if (!fkKeywords.includes('TROOPER')) continue;
          moreTargets.push(fk);
        }
      }
      if (moreTargets.length === 0) {
        return { applied: true, logMessage: `**Firing Squad** — **${chosenName}** may interrupt to perform a free attack (no action cost). Use their **Attack** button.` };
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: ['(Done — no second Trooper)', ...figureChoiceLabels(moreTargets)],
        targetFigureKeys: [null, ...moreTargets],
      };
    }
    // Phase 1: enumerate adjacent Troopers
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Firing Squad** — No position on the board. Resolve manually.' };
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 1) continue; // adjacent
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      const fkKeywords = (fkEff?.keywords || []).map(k => k.toUpperCase());
      if (!fkKeywords.includes('TROOPER')) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Firing Squad** — No adjacent friendly Troopers.' };
    game.pendingFiringSquad = [];
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // scheme_jabba (Jabba the Hutt): draw 1 CC card
  if (abilityId === 'scheme_jabba') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Scheme** manually.' };
    const drew = drawCcCards(game, playerNum, 1);
    if (drew.length > 0) return { applied: true, logMessage: `**Scheme** — Drew 1 Command card.`, refreshHand: true };
    return { applied: true, logMessage: '**Scheme** — No cards left in CC deck.' };
  }

  // incentivize_jabba (Jabba the Hutt): choose any elite figure → Focus
  if (abilityId === 'incentivize_jabba') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Incentivize** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      applyCondition(game, targetFigureKey, 'Focus');
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Incentivize** — **${chosenName}** is now **Focused**.`, refreshDcEmbed: true };
    }
    // Enumerate all elite figures on the board (both players)
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const enemyNum = opponentPlayerNum(playerNum);
    const validTargets = [];
    for (const pn of [playerNum, enemyNum]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = dcEffects?.[fkDcName];
        if (!fkEff?.elite) continue;
        if (fkEff.affiliation !== 'Scum') continue;
        validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Incentivize** — No elite figures on the board.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // do_or_do_not_yoda (Yoda): choose a friendly REBEL FORCE USER within 4 → Focus
  if (abilityId === 'do_or_do_not_yoda') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getRange: getRng, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Do or Do Not** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      applyCondition(game, targetFigureKey, 'Focus');
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Do or Do Not** — **${chosenName}** is now **Focused**.`, refreshDcEmbed: true };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Do or Do Not** — No position on the board. Resolve manually.' };
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 4) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      if (!fkEff) continue;
      const fkKw = (fkEff.keywords || []).map(k => k.toUpperCase());
      if (!fkKw.includes('FORCE USER')) continue;
      if (fkEff.affiliation !== 'Rebel') continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Do or Do Not** — No friendly REBEL FORCE USER within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // coordinated_raid_elite (ISB Infiltrator Elite): choose a friendly IMPERIAL figure (cost ≤4) within 4 spaces → interrupt to attack
  if (abilityId === 'coordinated_raid_elite') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getRange: getRng, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Coordinated Raid** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingCoordinatedRaid = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Coordinated Raid** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Coordinated Raid** — No position. Resolve manually.' };
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 4) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      if (!fkEff) continue;
      if (fkEff.affiliation !== 'Imperial') continue;
      if ((fkEff.subCost || fkEff.cost || 99) > 4) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Coordinated Raid** — No friendly IMPERIAL figure (cost ≤4) within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // coordinated_raid_regular (ISB Infiltrator Regular): another figure in your group interrupts to attack
  if (abilityId === 'coordinated_raid_regular') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Coordinated Raid** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingCoordinatedRaid = { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Coordinated Raid** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.` };
    }
    // Find other figures in the same group (same DC message ID)
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const otherGroupFigures = figureKeys.filter(fk => fk !== activatingKey && game.figurePositions?.[playerNum]?.[fk]);
    if (otherGroupFigures.length === 0) return { applied: false, manualMessage: '**Coordinated Raid** — No other figures in your group on the board.' };
    if (otherGroupFigures.length === 1) {
      // Auto-select the only other figure
      const onlyFk = otherGroupFigures[0];
      game.pendingCoordinatedRaid = { forMsgId: msgId, chosenFigureKey: onlyFk, triggeredByMsgId: msgId };
      const chosenName = dcNameFromFigureKey(onlyFk);
      return { applied: true, logMessage: `**Coordinated Raid** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.` };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(otherGroupFigures),
      targetFigureKeys: otherGroupFigures,
    };
  }

  // bartered_information (Bib Fortuna): choose a friendly SCUM figure within 2 → Focus
  if (abilityId === 'bartered_information') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getRange: getRng, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Bartered Information** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      applyCondition(game, targetFigureKey, 'Focus');
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Bartered Information** — **${chosenName}** is now **Focused**. *(You may also spend 1 VP to Focus another friendly SCUM within 2.)*`, refreshDcEmbed: true };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Bartered Information** — No position. Resolve manually.' };
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 2) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      if (!fkEff) continue;
      if (fkEff.affiliation !== 'Scum') continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Bartered Information** — No friendly SCUM figure within 2 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // fresh_catch_lothcat (Loth-cat Elite): you or an adjacent CREATURE gains 1 Power Token (choose recipient + type)
  if (abilityId === 'fresh_catch_lothcat') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: 'Resolve **Fresh Catch** manually.' };
    const mapId = game.selectedMap?.id;
    // Phase 2: target chosen — grant 1 power token (triggers type choice)
    if (choiceIndex != null && targetFigureKey) {
      const tName = dcNameFromFigureKey(targetFigureKey);
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[targetFigureKey] = game.figurePowerTokens[targetFigureKey] || [];
      const current = game.figurePowerTokens[targetFigureKey].length;
      const toAdd = Math.min(1, getMaxPowerTokens(targetFigureKey) - current);
      if (toAdd <= 0) return { applied: true, logMessage: `**Fresh Catch** — **${tName}** already has max Power Tokens.` };
      game.pendingPowerTokenGrant = { grants: [{ figureKey: targetFigureKey, figName: tName, count: toAdd }], channelId: null, playerNum };
      return { applied: true, requiresPowerTokenChoice: true, logMessage: `**Fresh Catch** — **${tName}** gains 1 Power Token — choose type.`, refreshDcEmbed: true };
    }
    // Phase 1: enumerate self + adjacent CREATUREs
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const dcEffects = getDcEffects() || {};
    const validTargets = [];
    // Include self
    if (activatingKey) validTargets.push(activatingKey);
    // Include adjacent friendly CREATUREs
    if (mapId && activatingKey) {
      const adj = getFiguresAdjacentToTarget(game, activatingKey, mapId);
      for (const { figureKey: fk, playerNum: p } of adj) {
        if (p !== playerNum) continue;
        if (validTargets.includes(fk)) continue;
        const dn = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dn]?.keywords || []).map(k => String(k).toUpperCase());
        if (kws.includes('CREATURE')) validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Fresh Catch** — No valid targets.' };
    if (validTargets.length === 1) {
      // Auto-select the only target
      const tName = dcNameFromFigureKey(validTargets[0]);
      game.figurePowerTokens = game.figurePowerTokens || {};
      game.figurePowerTokens[validTargets[0]] = game.figurePowerTokens[validTargets[0]] || [];
      const current = game.figurePowerTokens[validTargets[0]].length;
      const toAdd = Math.min(1, getMaxPowerTokens(validTargets[0]) - current);
      if (toAdd <= 0) return { applied: true, logMessage: `**Fresh Catch** — **${tName}** already has max Power Tokens.` };
      game.pendingPowerTokenGrant = { grants: [{ figureKey: validTargets[0], figName: tName, count: toAdd }], channelId: null, playerNum };
      return { applied: true, requiresPowerTokenChoice: true, logMessage: `**Fresh Catch** — **${tName}** gains 1 Power Token — choose type.`, refreshDcEmbed: true };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // rat_catcher_lothcat (Loth-cat Regular): you or an adjacent CREATURE gains 1 Block Token
  if (abilityId === 'rat_catcher_lothcat') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: 'Resolve **Rat Catcher** manually.' };
    const mapId = game.selectedMap?.id;
    // Phase 2: target chosen — grant 1 Block Token
    if (choiceIndex != null && targetFigureKey) {
      const tName = dcNameFromFigureKey(targetFigureKey);
      grantPowerTokens(game, targetFigureKey, 'Block', 1);
      return { applied: true, logMessage: `**Rat Catcher** — **${tName}** gained 1 **Block Token**.`, refreshDcEmbed: true };
    }
    // Phase 1: enumerate self + adjacent CREATUREs
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const dcEffects = getDcEffects() || {};
    const validTargets = [];
    if (activatingKey) validTargets.push(activatingKey);
    if (mapId && activatingKey) {
      const adj = getFiguresAdjacentToTarget(game, activatingKey, mapId);
      for (const { figureKey: fk, playerNum: p } of adj) {
        if (p !== playerNum) continue;
        if (validTargets.includes(fk)) continue;
        const dn = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dn]?.keywords || []).map(k => String(k).toUpperCase());
        if (kws.includes('CREATURE')) validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Rat Catcher** — No valid targets.' };
    if (validTargets.length === 1) {
      const tName = dcNameFromFigureKey(validTargets[0]);
      grantPowerTokens(game, validTargets[0], 'Block', 1);
      return { applied: true, logMessage: `**Rat Catcher** — **${tName}** gained 1 **Block Token**.`, refreshDcEmbed: true };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // neurostim_hemlock (Hemlock): choose adjacent friendly, roll 1 yellow die → Hit: Damage Token, Surge: Surge Token
  if (abilityId === 'neurostim_hemlock') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: 'Resolve **Neurostim** manually.' };
    const mapId = game.selectedMap?.id;
    // Phase 2: target chosen — roll yellow die and apply result
    if (choiceIndex != null && targetFigureKey) {
      const tName = dcNameFromFigureKey(targetFigureKey);
      const faces = getDiceData().attack?.yellow;
      if (!faces?.length) return { applied: false, manualMessage: 'Dice data unavailable.' };
      const face = faces[Math.floor(Math.random() * faces.length)];
      const hits = face.dmg ?? 0;
      const surges = face.surge ?? 0;
      const parts = [];
      if (hits) parts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
      if (surges) parts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
      const diceResult = parts.length ? parts.join(', ') : 'blank';
      const effectParts = [];
      if (hits > 0) {
        grantPowerTokens(game, targetFigureKey, 'Damage', 1);
        effectParts.push(`**${tName}** gained 1 **Damage Token**`);
      }
      if (surges > 0) {
        grantPowerTokens(game, targetFigureKey, 'Surge', 1);
        effectParts.push(`**${tName}** gained 1 **Surge Token**`);
      }
      if (effectParts.length === 0) effectParts.push('no effect');
      return { applied: true, logMessage: `**Neurostim** — Targeting **${tName}**. Rolled 1 yellow die: **${diceResult}**. ${effectParts.join('; ')}.`, refreshDcEmbed: true };
    }
    // Phase 1: enumerate adjacent friendly figures
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const validTargets = [];
    if (mapId && activatingKey) {
      const adj = getFiguresAdjacentToTarget(game, activatingKey, mapId);
      for (const { figureKey: fk, playerNum: p } of adj) {
        if (p !== playerNum) continue;
        if (figureKeys.includes(fk)) continue; // exclude self (same DG)
        validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Neurostim** — No adjacent friendly figures.' };
    if (validTargets.length === 1) {
      // Auto-select and roll
      const tFk = validTargets[0];
      const tName = dcNameFromFigureKey(tFk);
      const faces = getDiceData().attack?.yellow;
      if (!faces?.length) return { applied: false, manualMessage: 'Dice data unavailable.' };
      const face = faces[Math.floor(Math.random() * faces.length)];
      const hits = face.dmg ?? 0;
      const surges = face.surge ?? 0;
      const parts = [];
      if (hits) parts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
      if (surges) parts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
      const diceResult = parts.length ? parts.join(', ') : 'blank';
      const effectParts = [];
      if (hits > 0) {
        grantPowerTokens(game, tFk, 'Damage', 1);
        effectParts.push(`**${tName}** gained 1 **Damage Token**`);
      }
      if (surges > 0) {
        grantPowerTokens(game, tFk, 'Surge', 1);
        effectParts.push(`**${tName}** gained 1 **Surge Token**`);
      }
      if (effectParts.length === 0) effectParts.push('no effect');
      return { applied: true, logMessage: `**Neurostim** — Targeting **${tName}**. Rolled 1 yellow die: **${diceResult}**. ${effectParts.join('; ')}.`, refreshDcEmbed: true };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // continually_unexpected (K-2S0): if 2+ Hit/Surge tokens, perform a free Ranged attack
  if (abilityId === 'continually_unexpected') {
    const { game, playerNum, meta, msgId } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: 'Resolve **Continually Unexpected** manually.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const fk = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    if (!fk) return { applied: false, manualMessage: '**Continually Unexpected** — No figure found.' };
    const tokens = game.figurePowerTokens?.[fk] || [];
    const hitCount = tokens.filter(t => t === 'Damage' || t === 'Hit').length;
    const surgeCount = tokens.filter(t => t === 'Surge').length;
    if (hitCount + surgeCount < 2) {
      return { applied: false, manualMessage: `**Continually Unexpected** — Need 2 Damage/Surge Tokens (have ${hitCount} Damage + ${surgeCount} Surge).` };
    }
    // Grant free Ranged attack using own attack pool
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { type: 'ranged', dice: null, pierce: 0, bonusAccuracy: 0 };
    return { applied: true, logMessage: `**Continually Unexpected** — K-2S0 has ${hitCount} Damage + ${surgeCount} Surge Tokens. Your next attack costs no action and is **Ranged** (uses your normal dice pool). *(Token requirement met — no tokens consumed.)*` };
  }

  // false_orders (Murne Rin): choose a hostile figure (cost ≤ 4, within 4 spaces); perform move or attack with it
  if (abilityId === 'false_orders') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getRange: getRng } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **False Orders** manually.' };
    const enemyNum = opponentPlayerNum(playerNum);
    // Phase 2: figure chosen — set pending state and return marker for Move/Attack choice
    if (choiceIndex != null && targetFigureKey) {
      game.pendingFalseOrders = {
        controlledFigureKey: targetFigureKey,
        controlledPlayerNum: enemyNum,
        controllerPlayerNum: playerNum,
        murneRinMsgId: msgId,
      };
      const controlledName = dcNameFromFigureKey(targetFigureKey);
      return { applied: false, falseOrdersActionPick: true, logMessage: `**False Orders** — Choose Move or Attack with **${controlledName}**.` };
    }
    // Phase 1: enumerate hostile figures with cost ≤ N within N spaces (default 4; Fatal Deception upgrades to 5)
    const foUpgrade = game.falseOrdersUpgrade?.[playerNum];
    const foMaxCost = foUpgrade?.maxCost ?? 4;
    const foMaxRange = foUpgrade?.maxRange ?? 4;
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**False Orders** — Murne Rin has no position on the board. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[enemyNum] || {})) {
      if (!pos) continue;
      const targetDcName = dcNameFromFigureKey(fk);
      const targetStats = getStatsForDc(targetDcName);
      if ((targetStats?.cost ?? 99) > foMaxCost) continue;
      if (countGameSpaces(game, activatingPos, pos) > foMaxRange) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**False Orders** — No hostile figures with cost ≤ 4 within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // dcSpecial: chooseFriendlyToFocus (Incentivize, Do or Do Not) — pick a friendly figure matching criteria → Focus it
  if (entry.type === 'dcSpecial' && entry.chooseFriendlyToFocus) {
    const { game, msgId, meta, playerNum, targetFigureKey, dcMessageMeta, dcHealthState } = context;
    if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
    const dcEffects = getDcEffects() || {};
    // Phase 2: figure chosen → apply Focus
    if (targetFigureKey) {
      applyCondition(game, targetFigureKey, 'Focus');
      const dcName = dcNameFromFigureKey(targetFigureKey);
      // autoDeductVp (Order Hit): deduct VP from player's total
      if (entry.autoDeductVp > 0) {
        deductVp(game, playerNum, entry.autoDeductVp);
      }
      // grantFreeAttackToTarget (Order Hit): grant free attack + MP to chosen figure
      if (entry.grantFreeAttackToTarget) {
        const tgtMsgId = findMsgIdForFigureKey(game, playerNum, targetFigureKey, dcMessageMeta);
        if (tgtMsgId) {
          game.freeAttackBonusPending = game.freeAttackBonusPending || {};
          game.freeAttackBonusPending[tgtMsgId] = true;
          if (entry.grantMpToTarget > 0) {
            addMovementPoints(game, tgtMsgId, entry.grantMpToTarget);
          }
          return { applied: true, logMessage: `**${entry.label}** — **${dcName}** may interrupt to perform a free attack and gains ${entry.grantMpToTarget || 0} MP.${entry.autoDeductVp ? ` (−${entry.autoDeductVp} VP)` : ''}`, refreshDcEmbed: true };
        }
      }
      return { applied: true, logMessage: `**${entry.label}** — **${dcName}** is now **Focused**.`, refreshDcEmbed: true };
    }
    // Phase 1: enumerate valid friendly figures
    // VP cost check (Order Hit: requires 2 VP to use)
    if (entry.autoDeductVp > 0) {
      const vk = vpKey(playerNum);
      const currentVp = game[vk]?.total || 0;
      if (currentVp < entry.autoDeductVp) {
        return { applied: false, manualMessage: `**${entry.label}** requires ${entry.autoDeductVp} VP but you only have ${currentVp}.` };
      }
    }
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    const activatingPos = game.figurePositions?.[playerNum]?.[activatingFigureKey];
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      if (entry.choiceExcludeSelf && fk === activatingFigureKey) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const eff = dcEffects[fkDcName];
      // Range check
      if (entry.choiceRange && activatingPos) {
        const dist = countGameSpaces(game, activatingPos, pos);
        if (dist > entry.choiceRange) continue;
      }
      // Elite check
      if (entry.choiceRequiresElite && !eff?.elite) continue;
      // Keyword check
      if (Array.isArray(entry.choiceRequiresKeywords)) {
        const kw = (eff?.keywords || []).map(k => String(k).toLowerCase());
        const aff = (eff?.affiliation || '').toLowerCase();
        if (!entry.choiceRequiresKeywords.every(rk => kw.includes(rk.toLowerCase()) || aff === rk.toLowerCase())) continue;
      }
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**${entry.label}** — No valid targets found.` };
    if (validTargets.length === 1) {
      // Auto-select the only valid target
      return resolveAbility(abilityId, { ...context, targetFigureKey: validTargets[0] });
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // Sling Barrage (Ewok Warrior Elite): perform a Ranged attack with printed pool;
  // during that attack, reroll up to 1 atk die per OTHER group-mate with LOS to defender.
  if (entry.type === 'dcSpecial' && entry.slingBarrageReroll) {
    const { game, msgId } = context;
    if (game && msgId) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Sling Barrage' };
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[msgId] = { type: 'ranged', dice: null, pierce: 0, bonusAccuracy: 0 };
      game.pendingSlingBarrage = game.pendingSlingBarrage || {};
      game.pendingSlingBarrage[msgId] = true;
    }
    return {
      applied: true,
      logMessage: '**Sling Barrage** — Perform a **Ranged** attack with your printed pool. You may reroll up to **1 attack die per other group-mate with line of sight to the defender**. Use the **Attack** button.',
    };
  }

  // Focus Fire (SC2-M2 Tank): Double Action — perform 2 attacks targeting the same figure
  if (entry.type === 'dcSpecial' && entry.focusFireDoubleAttack) {
    const { game, msgId } = context;
    if (game && msgId) {
      // Grant a free attack for the second shot; after first attack resolves, grant another
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Focus Fire' };
      // Track that Focus Fire is active — second attack must target the same figure
      game.focusFireActive = game.focusFireActive || {};
      game.focusFireActive[msgId] = { attacksRemaining: 2 };
    }
    return {
      applied: true,
      logMessage: '**Focus Fire** — Perform 2 attacks targeting the **same figure**. Use the **Attack** button for each attack.',
    };
  }

  // Multi-Fire (HK Assassin Droid): 2 attacks, different targets, -1 Hit each
  if (entry.type === 'dcSpecial' && entry.multiFireDoubleAttack) {
    const { game, msgId } = context;
    if (game && msgId) {
      // Grant a free attack for the second shot
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = { from: 'Multi-Fire' };
      // Apply -1 Hit to all attacks during Multi-Fire
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[msgId] = { bonusHits: -1 };
      // Track Multi-Fire state: second attack must target different figure
      game.multiFireActive = game.multiFireActive || {};
      game.multiFireActive[msgId] = { attacksRemaining: 2, firstTargetFigureKey: null };
    }
    return {
      applied: true,
      logMessage: '**Multi-Fire** — Perform 2 attacks with **different targets**. **−1 Hit** applied to each attack. Use the **Attack** button for each attack.',
    };
  }

  // Overclock (Elite Ugnaught): Junk Droid companion may interrupt to perform a move or attack
  if (entry.type === 'dcSpecial' && entry.overclockCompanionInterrupt) {
    const { game, msgId, playerNum } = context;
    if (game && msgId) {
      // Find the Junk Droid companion DC msgId for this player
      const companionMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
      const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
      let junkDroidMsgId = null;
      if (companionMsgIds) {
        for (let i = 0; i < companionMsgIds.length; i++) {
          if (companionMsgIds[i]) {
            const parentMeta = context.dcMessageMeta?.get?.(dcMsgIds?.[i]);
            if (parentMeta?.dcName?.includes('Ugnaught')) {
              junkDroidMsgId = companionMsgIds[i];
              break;
            }
          }
        }
      }
      if (junkDroidMsgId) {
        // Grant Junk Droid companion 4 MP (its Speed) and a free attack
        game.movementBank = game.movementBank || {};
        game.movementBank[junkDroidMsgId] = { remaining: 4, total: 4 };
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[junkDroidMsgId] = { from: 'Overclock' };
      }
    }
    return {
      applied: true,
      logMessage: '**Overclock** — Your **Junk Droid** companion may interrupt to perform a **move** (4 MP granted) or **attack** (free attack granted). Use the Junk Droid\'s Move/Attack buttons.',
    };
  }

  // Spot Weld (Ugnaught): Place a Junk Droid companion in an adjacent space
  if (entry.type === 'dcSpecial' && entry.spotWeldCompanionPlace) {
    const { game, msgId, playerNum } = context;
    if (game && msgId) {
      // Mark that Spot Weld is pending — the companion needs to be placed
      game.spotWeldPending = game.spotWeldPending || {};
      game.spotWeldPending[msgId] = true;
    }
    return {
      applied: true,
      logMessage: '**Spot Weld** — Place your **Junk Droid** companion in a space **adjacent to this figure**. Deploy the Junk Droid using its deploy button if not yet on the board, or move it to an adjacent space.',
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
        syncHealthStateToList(game, playerNum, msgId, healthState);
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
    if (!game || !msgId) {
      const diceDesc = entry.overrideAttackDice.join(' + ');
      const pierceNote = entry.overrideAttackPierce ? `, Pierce ${entry.overrideAttackPierce}` : '';
      const accNote = entry.overrideBonusAccuracy ? `, +${entry.overrideBonusAccuracy} Accuracy` : '';
      const typeNote = entry.overrideAttackType ? ` ${entry.overrideAttackType}` : '';
      return { applied: true, logMessage: `**${entry.label || 'Override Attack'}** — Free${typeNote} attack: ${diceDesc}${pierceNote}${accNote}. Resolve manually (no active activation).` };
    }
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    // Saber Orbit: up to N free melee attacks with override dice
    if (entry.saberOrbitChain > 1) {
      game.freeAttackBonusPending[msgId] = entry.saberOrbitChain;
      game.saberOrbitAttacksRemaining = game.saberOrbitAttacksRemaining || {};
      game.saberOrbitAttacksRemaining[msgId] = entry.saberOrbitChain;
    } else {
      game.freeAttackBonusPending[msgId] = true;
    }
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = {
      dice: entry.overrideAttackDice,
      type: entry.overrideAttackType || null,
      pierce: entry.overrideAttackPierce || 0,
      bonusAccuracy: entry.overrideBonusAccuracy || 0,
      mustTargetNonAdjacent: entry.mustTargetNonAdjacent || false,
      blockSurgeAbilities: entry.blockSurgeAbilities || false,
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
        syncHealthStateToList(game, playerNum, msgId, healthState);
        strainNote = ` You suffered ${entry.strainCostToSelf} Strain (${cur ?? max} → ${newCur} HP).`;
      } else {
        strainNote = ` (Apply ${entry.strainCostToSelf} Strain to self manually.)`;
      }
    }
    // mpBonus alongside overrideAttackDice (Close and Personal: move + override attack)
    let odMpNote = '';
    if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
      addMovementPoints(game, msgId, entry.mpBonus);
      odMpNote = ` Gained ${entry.mpBonus} MP.`;
    }
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      refreshDcEmbed: entry.strainCostToSelf > 0,
      refreshMovementBank: typeof entry.mpBonus === 'number' && entry.mpBonus > 0,
      activeMsgId: msgId,
      logMessage: (entry.logMessage || `**${entry.label}** — Click Attack to proceed.`) + strainNote + odMpNote,
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
    // Stay Down: mark to apply Stun to the attacker figure when the free attack is consumed
    if (entry.label === 'Stay Down') {
      game.stayDownPendingMsgId = game.stayDownPendingMsgId || {};
      game.stayDownPendingMsgId[msgId] = true;
    }
    // Burst Fire: mark so adjacent Stun is applied when the free attack resolves with damage
    if (entry.label === 'Burst Fire') {
      game.burstFirePendingMsgId = game.burstFirePendingMsgId || {};
      game.burstFirePendingMsgId[msgId] = true;
    }
    // Crippling Blow: mark so Stun is applied to defender if attack doesn't miss
    if (entry.label === 'Crippling Blow') {
      game.cripplingBlowPending = game.cripplingBlowPending || {};
      game.cripplingBlowPending[msgId] = true;
    }
    // Disruptor Rifle: mark so extra damage is applied if defender at 1 HP after non-miss attack
    if (entry.label === 'Disruptor Rifle') {
      game.disruptorRiflePending = game.disruptorRiflePending || {};
      game.disruptorRiflePending[msgId] = true;
    }
    // Tonfa Strike: mark so second free attack is granted after first resolves
    if (entry.label === 'Tonfa Strike') {
      game.tonfaStrikeSecondAttack = game.tonfaStrikeSecondAttack || {};
      game.tonfaStrikeSecondAttack[msgId] = true;
    }
    // Barrage (CT-1701): mark so second free attack is granted after first resolves (defender +1 white die, within 3 of first target)
    if (entry.label === 'Barrage') {
      game.barrageSecondAttack = game.barrageSecondAttack || {};
      game.barrageSecondAttack[msgId] = true;
    }
    // Close Quarters: at attack time, override dice with adjacent hostile's pool + remove 1 defense die
    if (entry.closeQuartersOverride) {
      game.closeQuartersActive = game.closeQuartersActive || {};
      game.closeQuartersActive[msgId] = true;
    }
    // overrideAttackType (Face to Face, Dying Lunge, Final Stand, Lightsaber Throw): force attack type without overriding dice
    if (entry.overrideAttackType) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[msgId] = {
        type: entry.overrideAttackType, dice: null, pierce: 0,
        bonusAccuracy: entry.overrideBonusAccuracy || 0,
        mustTargetNonAdjacent: entry.mustTargetNonAdjacent || false,
        blockSurgeAbilities: entry.blockSurgeAbilities || false,
      };
    }
    // selfDefeatsAfterAttack (Dying Lunge, Final Stand): attacker figure defeated when free attack resolves
    if (entry.selfDefeatsAfterAttack) {
      game.selfDefeatsAfterAttackMsgId = game.selfDefeatsAfterAttackMsgId || {};
      game.selfDefeatsAfterAttackMsgId[msgId] = true;
    }
    // postActivationConditions (Wild Fury): apply conditions after last free attack
    if (Array.isArray(entry.postActivationConditions) && entry.postActivationConditions.length > 0) {
      game.postActivationConditions = game.postActivationConditions || {};
      game.postActivationConditions[msgId] = entry.postActivationConditions;
    }
    // nextAttackBonusAccuracy (Charged Shot): grant bonus accuracy on next attack
    if (typeof entry.nextAttackBonusAccuracy === 'number' && entry.nextAttackBonusAccuracy > 0) {
      game.nextAttackBonusAccuracy = game.nextAttackBonusAccuracy || {};
      game.nextAttackBonusAccuracy[playerNum] = (game.nextAttackBonusAccuracy[playerNum] || 0) + entry.nextAttackBonusAccuracy;
    }
    // mpBonus alongside freeAttackBonus (Face to Face, Final Stand: gain MP + free attack)
    let fabMpNote = '';
    let fabMpRefresh = false;
    if (typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
      addMovementPoints(game, msgId, entry.mpBonus);
      fabMpNote = ` Gained ${entry.mpBonus} MP.`;
      fabMpRefresh = true;
    }
    const label = entry.label || 'Heroic';
    const countNote = (entry.freeAttackBonusCount ?? 1) > 1 ? ` (${entry.freeAttackBonusCount} times, each targeting a different figure)` : '';
    const accNote = entry.nextAttackBonusAccuracy ? ` +${entry.nextAttackBonusAccuracy} Accuracy.` : '';
    return { applied: true, freeAction: true, refreshMovementBank: fabMpRefresh, activeMsgId: msgId, logMessage: entry.logMessage || (`**${label}** — Your next attack${countNote} costs no action.${accNote} Click Attack when ready.` + fabMpNote) };
  }

  // dcSpecial: spendMpForBlockToken (Shield Gauntlets) — spend N MP to gain 1 Block power token
  if (entry.type === 'dcSpecial' && typeof entry.spendMpForBlockToken === 'number') {
    const { game, msgId, meta, playerNum } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const bank = game.movementBank?.[msgId];
    const remaining = bank?.remaining ?? 0;
    const mpCost = entry.spendMpForBlockToken;
    if (remaining < mpCost) return { applied: false, manualMessage: `**${entry.label}** requires ${mpCost} MP (you have ${remaining}).` };
    bank.remaining -= mpCost;
    // Grant 1 Block token
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    grantPowerTokens(game, figureKey, 'Block', 1);
    return { applied: true, freeAction: !!entry.freeAction, refreshMovementBank: true, activeMsgId: msgId, refreshDcEmbed: true, logMessage: `**${entry.label}** — Spent ${mpCost} MP → gained 1 **Block Token** (${remaining - mpCost} MP remaining).` };
  }

  // dcSpecial: freeMoveEqualToSpeed (Wall Run, Charge) — gain free MP equal to DC's Speed
  if (entry.type === 'dcSpecial' && entry.freeMoveEqualToSpeed) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const dcStats = getStatsForDc(meta.dcName);
    const speed = typeof dcStats?.speed === 'number' ? dcStats.speed : 4;
    addMovementPoints(game, msgId, speed);
    // Charge (and similar): also grant a free attack after the move
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
    }
    const label = entry.label || 'Wall Run';
    const extraMsg = entry.freeAttackBonus ? ' Then your next attack costs no action.' : ' You may ignore terrain adjacent to walls during this movement.';
    return { applied: true, logMessage: entry.logMessage || `**${label}** — Gained ${speed} free movement points (your Speed).${extraMsg}`, refreshMovementBank: true, activeMsgId: msgId };
  }

  // dcSpecial/ccEffect: rollOneDie (Slam, Smash, Grenadier, Parting Gift) — roll one die with optional targeting
  if ((entry.type === 'dcSpecial' || entry.type === 'ccEffect') && entry.rollOneDie) {
    const { game, playerNum, dcMessageMeta, dcHealthState, targetFigureKey, chosenSpace } = context;
    let { msgId, meta } = context;
    // For ccEffect: fall back to active activation for figure-position lookup
    if (entry.type === 'ccEffect' && !msgId && dcMessageMeta && playerNum && game) {
      msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta) || null;
      meta = msgId ? dcMessageMeta.get(msgId) : null;
    }
    // Combat-context fallback: for after-attack CCs (e.g. Gauntlet Blade), use defender/attacker figure key
    const _rollOneDieCombat = context.combat || game?.combat || game?.pendingCombat;
    let _rollOneDieSelfFigureKey = null;
    if (entry.type === 'ccEffect' && !meta && _rollOneDieCombat && playerNum) {
      // The CC player is the defender → use defenderFigureKey; or attacker → use attackerFigureKey
      if (_rollOneDieCombat.defenderPlayerNum === playerNum && _rollOneDieCombat.defenderFigureKey) {
        _rollOneDieSelfFigureKey = _rollOneDieCombat.defenderFigureKey;
      } else if (_rollOneDieCombat.attackerPlayerNum === playerNum && _rollOneDieCombat.attackerFigureKey) {
        _rollOneDieSelfFigureKey = _rollOneDieCombat.attackerFigureKey;
      }
    }
    // Also set selfFigureKey from activation context if available
    if (!_rollOneDieSelfFigureKey && meta && game) {
      const _actD = game.dcActionsData?.[msgId];
      const _selF = _actD?.selectedFigure ?? 0;
      const _dgM2 = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _dgI2 = _dgM2 ? _dgM2[1] : '1';
      _rollOneDieSelfFigureKey = `${meta.dcName}-${_dgI2}-${_selF}`;
    }

    // ── Electrified Knuckledusters style: pick adjacent hostile, then roll + apply ──
    if (entry.rollOneDieTarget === 'adjacentHostile') {
      // Phase 3: push space chosen (Smash/Slam/Ram) → move target figure to chosen space
      if (context.chosenSpace && targetFigureKey && entry.rollOneDiePushSmall) {
        const oppNum = opponentPlayerNum(playerNum || 1);
        const _pushDcName = dcNameFromFigureKey(targetFigureKey);
        const _pushStats = getStatsForDc(_pushDcName);
        if ((_pushStats?.specialAbilityIds || []).includes('spiked_boots_snowtrooper')) {
          const pusherStats = getStatsForDc(meta?.dcName || '');
          if (!(pusherStats?.keywords || []).some(k => /massive/i.test(k))) {
            return { applied: true, logMessage: `**Spiked Boots** — **${_pushDcName}** cannot be pushed.`, refreshDcEmbed: true, refreshBoard: true };
          }
        }
        const { prevPos: _slamPrevPos } = pushFigure(game, oppNum, targetFigureKey, context.chosenSpace) || { prevPos: null };
        const { pathStr: _slamPathStr, warnings: _slamWarnings } = computePushPathAndWarnings(game, _slamPrevPos, context.chosenSpace, oppNum);
        let _slamLogMsg = `**${entry.label}** — Pushed **${_pushDcName}** to **${String(context.chosenSpace).toUpperCase()}**${_slamPathStr}.`;
        if (_slamWarnings.length > 0) {
          const _slamWarnList = _slamWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
          _slamLogMsg += `\n⚠️ Exits adjacency to: ${_slamWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
        }
        return { applied: true, logMessage: _slamLogMsg, refreshDcEmbed: true, refreshBoard: true };
      }
      // Multi-target variant (Trample): auto-target all adjacent hostiles (up to N), single die roll
      if (entry.rollOneDieMaxTargets && entry.rollOneDieMaxTargets > 1) {
        const maxTgts = entry.rollOneDieMaxTargets;
        const pendingKey = msgId;
        const pendingMT = game.pendingMultiTargetRoll?.[pendingKey];
        // Helper: roll once and apply to all targets
        const _rollAndApplyMulti = (targets) => {
          const color = entry.rollOneDie;
          const faces = getDiceData().attack?.[color.toLowerCase()];
          if (!faces?.length) return { applied: false, manualMessage: `Roll 1 ${color} die manually.` };
          const face = faces[Math.floor(Math.random() * faces.length)];
          const hits = face.dmg ?? 0;
          const surges = face.surge ?? 0;
          const dieParts = [];
          if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
          if (surges) dieParts.push(`${surges} Surge${surges !== 1 ? 's' : ''}`);
          const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
          const enemyPN = opponentPlayerNum(playerNum || 1);
          const parts = [];
          for (const tFk of targets) {
            const tName = dcNameFromFigureKey(tFk);
            const subParts = [];
            if (hits > 0) {
              const tMsgId = findMsgIdForFigureKey(game, enemyPN, tFk, dcMessageMeta);
              if (dcHealthState && tMsgId) {
                const hs = dcHealthState.get(tMsgId) || [];
                const fkM = tFk.match(/-(\d+)-(\d+)$/);
                const fIdx = fkM ? parseInt(fkM[2], 10) : 0;
                const hpE = hs[fIdx];
                if (hpE) {
                  const [cur, max] = hpE;
                  const newCur = Math.max(0, (cur ?? max) - hits);
                  hs[fIdx] = [newCur, max ?? newCur];
                  dcHealthState.set(tMsgId, hs);
                  syncHealthStateToList(game, enemyPN, tMsgId, hs);
                  subParts.push(`${hits} Dmg (HP: ${cur ?? max}→${newCur})`);
                }
              }
            }
            if (entry.rollOneDieSurgeCondition && surges >= 1) {
              if (applyCondition(game, tFk, entry.rollOneDieSurgeCondition)) {
                subParts.push(`**${entry.rollOneDieSurgeCondition}**`);
              }
            }
            parts.push(`**${tName}**: ${subParts.length ? subParts.join(', ') : 'unaffected'}`);
          }
          return { applied: true, logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. ${parts.join('; ')}.`, refreshDcEmbed: true };
        };
        // Phase 2+: accumulate sequential picks (only when > maxTargets adjacent)
        if (targetFigureKey && pendingMT) {
          if (targetFigureKey === '__done__') {
            delete game.pendingMultiTargetRoll[pendingKey];
            if (pendingMT.targets.length === 0) return { applied: false, manualMessage: `**${entry.label}** — No targets selected.` };
            return _rollAndApplyMulti(pendingMT.targets);
          }
          pendingMT.targets.push(targetFigureKey);
          if (pendingMT.targets.length >= maxTgts) {
            delete game.pendingMultiTargetRoll[pendingKey];
            return _rollAndApplyMulti(pendingMT.targets);
          }
          const remaining = pendingMT.allTargets.filter(fk => !pendingMT.targets.includes(fk));
          const opts = [...remaining.map(fk => dcNameFromFigureKey(fk)), 'Done selecting'];
          const fKeys = [...remaining, '__done__'];
          return { applied: false, requiresChoice: true, choiceOptions: opts, targetFigureKeys: fKeys, choicePrompt: `**${entry.label}** — Selected ${pendingMT.targets.length}/${maxTgts}. Choose another or Done:` };
        }
        // Phase 1: enumerate adjacent hostiles
        if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
        const mapId = game.selectedMap?.id;
        if (!mapId) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
        const actionsData = game.dcActionsData?.[msgId];
        const selectedFig = actionsData?.selectedFigure ?? 0;
        const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
        const adjacentAll = getFiguresAdjacentToTarget(game, activatingFigureKey, mapId);
        const enemyPlayerNum = opponentPlayerNum(playerNum || 1);
        const validTargetFks = adjacentAll.filter(f => f.playerNum === enemyPlayerNum).map(f => f.figureKey);
        if (validTargetFks.length === 0) return { applied: false, manualMessage: `No adjacent hostile figures for **${entry.label}**.` };
        if (validTargetFks.length <= maxTgts) {
          // Auto-target all — no choice needed
          return _rollAndApplyMulti(validTargetFks);
        }
        // More than max — sequential picks
        game.pendingMultiTargetRoll = game.pendingMultiTargetRoll || {};
        game.pendingMultiTargetRoll[pendingKey] = { targets: [], allTargets: validTargetFks, max: maxTgts };
        const choices = [...validTargetFks.map(fk => dcNameFromFigureKey(fk)), 'Done selecting'];
        const fKeysDone = [...validTargetFks, '__done__'];
        return { applied: false, requiresChoice: true, choiceOptions: choices, targetFigureKeys: fKeysDone, choicePrompt: `**${entry.label}** — Choose up to ${maxTgts} adjacent hostile figures:` };
      }
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
        const enemyPlayerNum = opponentPlayerNum(playerNum || 1);
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
              syncHealthStateToList(game, enemyPlayerNum, targetMsgId, healthState);
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
          applyCondition(game, targetFigureKey, surgeCondition);
          resultParts.push(`became **${surgeCondition}**`);
        }
        // Gauntlet Blade: on Surge, grant self a Power Token (player chooses type)
        if (entry.rollOneDieSurgeSelfPowerToken && surges >= 1) {
          const _selfFk = _rollOneDieSelfFigureKey;
          if (_selfFk) {
            const selfName = dcNameFromFigureKey(_selfFk);
            game.pendingPowerTokenGrant = { grants: [{ figureKey: _selfFk, figName: selfName, count: 1 }], channelId: null, playerNum };
            resultParts.push(`you gain 1 Power Token — choose type`);
          }
        }
        const targetName = dcNameFromFigureKey(targetFigureKey);
        // SMALL push check (Smash, Slam, Ram): after damage, offer space picker for push
        if (entry.rollOneDiePushSmall && hits > 0) {
          const targetStats = getStatsForDc(targetName);
          const isSmall = !(targetStats?.keywords || []).some(k => /large|massive/i.test(k));
          if (isSmall) {
            const mapId = game.selectedMap?.id;
            if (mapId) {
              const _actData = game.dcActionsData?.[msgId];
              const _selFig = _actData?.selectedFigure ?? 0;
              const _dgM = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
              const _dgI = _dgM ? _dgM[1] : '1';
              const activFk = `${meta.dcName}-${_dgI}-${_selFig}`;
              const activPos = game.figurePositions?.[playerNum]?.[activFk];
              if (activPos) {
                const mapSpaces = getMapData(mapId);
                const adjSpaces = mapSpaces?.adjacency?.[activPos] || [];
                const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
                const targetCurPos = game.figurePositions?.[enemyPlayerNum]?.[targetFigureKey];
                const validPushSpaces = adjSpaces.filter(s => !occupiedSet.has(s) || s === targetCurPos);
                if (validPushSpaces.length > 0) {
                  return {
                    applied: false,
                    requiresSpaceChoice: true,
                    validSpaces: validPushSpaces,
                    targetFigureKey,
                    spaceChoiceLabel: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}. Push **${targetName}** to which adjacent space?`,
                  };
                }
              }
            }
          }
        }
        const _rodResult = {
          applied: true,
          logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}.`,
          refreshDcEmbed: true,
        };
        if (entry.rollOneDieSurgeSelfPowerToken && surges >= 1 && game.pendingPowerTokenGrant) {
          _rodResult.requiresPowerTokenChoice = true;
        }
        return _rodResult;
      }
      // Phase 1: enumerate adjacent hostile figures
      // Use combat-context fallback when no activation (e.g. Gauntlet Blade after attack)
      let activatingFigureKey;
      if (meta && game) {
        const actionsData = game.dcActionsData?.[msgId];
        const selectedFig = actionsData?.selectedFigure ?? 0;
        const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
      } else if (_rollOneDieSelfFigureKey) {
        activatingFigureKey = _rollOneDieSelfFigureKey;
      }
      if (!game || !activatingFigureKey) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
      const mapId = game.selectedMap?.id;
      if (!mapId) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
      const adjacentAll = getFiguresAdjacentToTarget(game, activatingFigureKey, mapId);
      const enemyPlayerNum = opponentPlayerNum(playerNum || 1);
      const validTargets = adjacentAll.filter((f) => f.playerNum === enemyPlayerNum);
      if (validTargets.length === 0) return { applied: false, manualMessage: `No adjacent hostile figures. Resolve **${entry.label}** manually.` };
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(validTargets.map((t) => t.figureKey)),
        targetFigureKeys: validTargets.map((t) => t.figureKey),
      };
    }

    // ── Jetpack Rocket style: pick hostile within range (+ LOS), spend MP, roll + apply damage ──
    if (entry.rollOneDieTarget === 'hostileWithinRange') {
      const maxRange = entry.rollOneDieTargetRange || 3;
      const requiresLos = entry.rollOneDieRequiresLos !== false;
      const mpCost = entry.rollOneDieMpCost || 0;
      // Phase 2: target chosen → check MP cost, roll die, apply damage
      if (targetFigureKey) {
        // Check MP cost
        if (mpCost > 0 && msgId) {
          const bank = game.movementBank?.[msgId];
          const remaining = bank?.remaining ?? 0;
          if (remaining < mpCost) return { applied: false, manualMessage: `**${entry.label}** requires ${mpCost} MP (you have ${remaining}).` };
          bank.remaining -= mpCost;
        }
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
        const totalDmg = hits; // only Hits count as damage
        const enemyPlayerNum = opponentPlayerNum(playerNum || 1);
        const resultParts = [];
        if (totalDmg > 0) {
          const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
          if (dcHealthState && targetMsgId) {
            const healthState = dcHealthState.get(targetMsgId) || [];
            const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const entryHp = healthState[figIdx];
            if (entryHp) {
              const [cur, max] = entryHp;
              const newCur = Math.max(0, (cur ?? max) - totalDmg);
              healthState[figIdx] = [newCur, max ?? newCur];
              dcHealthState.set(targetMsgId, healthState);
              syncHealthStateToList(game, enemyPlayerNum, targetMsgId, healthState);
              resultParts.push(`${totalDmg} Damage (HP: ${cur ?? max} → ${newCur})`);
            } else {
              resultParts.push(`apply ${totalDmg} Damage manually`);
            }
          } else {
            resultParts.push(`apply ${totalDmg} Damage manually`);
          }
        }
        const targetName = dcNameFromFigureKey(targetFigureKey);
        const mpNote = mpCost > 0 ? ` Spent ${mpCost} MP.` : '';
        return {
          applied: true,
          logMessage: `**${entry.label}** —${mpNote} Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}.`,
          refreshDcEmbed: true,
          refreshMovementBank: mpCost > 0,
          activeMsgId: msgId,
        };
      }
      // Phase 1: enumerate hostile figures within range (+ optional LOS)
      if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
      // Check MP cost upfront
      if (mpCost > 0 && msgId) {
        const bank = game.movementBank?.[msgId];
        const remaining = bank?.remaining ?? 0;
        if (remaining < mpCost) return { applied: false, manualMessage: `**${entry.label}** requires ${mpCost} MP (you have ${remaining}).` };
      }
      const mapId = game.selectedMap?.id;
      const actionsData = game.dcActionsData?.[msgId];
      const selectedFig = actionsData?.selectedFigure ?? 0;
      const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';
      const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
      const activatingPos = game.figurePositions?.[playerNum]?.[activatingFigureKey];
      if (!mapId || !activatingPos) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (position unknown).` };
      const enemyPlayerNum = opponentPlayerNum(playerNum || 1);
      const enemyPositions = game.figurePositions?.[enemyPlayerNum] || {};
      const { hasLineOfSight: losCheck, getRange: getRng } = context;
      const validTargets = [];
      for (const [fk, pos] of Object.entries(enemyPositions)) {
        if (!pos) continue;
        const dist = countGameSpaces(game, activatingPos, pos);
        if (dist > maxRange) continue;
        if (requiresLos && typeof losCheck === 'function' && !losCheck(activatingPos, pos, getMapData(mapId))) continue;
        validTargets.push({ figureKey: fk, dist });
      }
      if (validTargets.length === 0) return { applied: false, manualMessage: `No hostile figures within ${maxRange} spaces${requiresLos ? ' and LOS' : ''}. **${entry.label}** has no valid targets.` };
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(validTargets.map((t) => t.figureKey)).map((lbl, i) => `${lbl} (${validTargets[i].dist} sp)`),
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
                  syncHealthStateToList(game, pn, figMsgId, healthState);
                  affected.push(`${dcNameFromFigureKey(fk)} -${hits}HP (→${newCur})`);
                } else {
                  affected.push(`${dcNameFromFigureKey(fk)} (-${hits}HP, apply manually)`);
                }
              } else {
                affected.push(`${dcNameFromFigureKey(fk)} (-${hits}HP, apply manually)`);
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
      // freeMoveBonus (Mortar Launcher): grant MP before the space pick so player can move first.
      // CRR MOVE-017: "Move X spaces" effects ignore MP costs from terrain/figures; tag the bank
      // with moveXBypassActive so the commit path sets ignoreDifficult / ignoreFigureCost.
      if (entry.freeMoveBonus > 0 && msgId) {
        addMovementPoints(game, msgId, entry.freeMoveBonus);
        game.moveXBypassActive = game.moveXBypassActive || {};
        game.moveXBypassActive[msgId] = true;
      }
      const moveNote = entry.freeMoveBonus > 0 ? ` (Move up to ${entry.freeMoveBonus} spaces first, then choose a target space.)` : '';
      return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**${entry.label}** — Choose a target space within ${range}:${moveNote}`, refreshMovementBank: entry.freeMoveBonus > 0, activeMsgId: msgId };
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
      const adj = entry.fixedAreaTargetOnly ? [] : (boardState?.mapSpaces?.adjacency?.[spaceNorm] || []);
      const affectedSpaces = new Set([spaceNorm, ...adj.map((s) => String(s).toLowerCase())]);
      const results = [];
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
          const dcName = dcNameFromFigureKey(fk);
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
                syncHealthStateToList(game, pn, figMsgId, hs);
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
            const added = conditions.filter((c) => applyCondition(game, fk, c));
            if (added.length) parts.push(added.join(', '));
          }
          // fixedAreaDiscardToken (Gar Saxon Flamethrower): discard 1 Power Token per affected figure
          if (entry.fixedAreaDiscardToken) {
            const tokens = game.figurePowerTokens?.[fk];
            if (tokens?.length) {
              const removed = tokens.shift();
              parts.push(`discarded ${removed} Token`);
            }
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
          syncHealthStateToList(game, playerNum, msgId, selfHs);
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
    let validSet = new Set([String(activatingPos).toLowerCase(), ...reachable.map((s) => String(s).toLowerCase())]);
    if (entry.fixedAreaRequiresAdjacentHostile) {
      const hostilePlayer = playerNum === 1 ? 2 : 1;
      const hostileSpaces = new Set(Object.values(game.figurePositions?.[hostilePlayer] || {}).filter(Boolean).map((s) => String(s).toLowerCase()));
      const adjMap = boardState.mapSpaces?.adjacency || {};
      validSet = new Set([...validSet].filter((sp) => {
        if (hostileSpaces.has(sp)) return true;
        const adj = (adjMap[sp] || []).map((s) => String(s).toLowerCase());
        return adj.some((a) => hostileSpaces.has(a));
      }));
    }
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
    addMovementPoints(game, msgId, entry.freeMoveBonus);
    // CRR MOVE-017: "Move X spaces" effects ignore MP costs from terrain/figures.
    game.moveXBypassActive = game.moveXBypassActive || {};
    game.moveXBypassActive[msgId] = true;
    // Also grant free attack if specified (e.g. Executor)
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
    }
    // mobileMovement (Lift Off): grant Mobile movement for these MP
    if (entry.mobileMovement) {
      game.mobileMovementActive = game.mobileMovementActive || {};
      game.mobileMovementActive[msgId] = true;
    }
    // Rush (Onar): after movement MP are exhausted, trigger adjacent SMALL push + mutual damage
    if (entry.rushPostMovePush) {
      game.rushPending = game.rushPending || {};
      game.rushPending[msgId] = true;
    }
    // Shoulder Rush (KX-Series Security Droid): after movement MP exhausted, choose adjacent hostile → push if SMALL + enter space → free attack
    if (entry.shoulderRushPostMove) {
      game.shoulderRushPending = game.shoulderRushPending || {};
      game.shoulderRushPending[msgId] = { playerNum: context.playerNum };
    }
    return { applied: true, freeAction: !!entry.freeAction, logMessage: entry.logMessage || `**${entry.label}** — Gained ${entry.freeMoveBonus} free movement points.`, refreshMovementBank: true, activeMsgId: msgId };
  }

  // dcSpecial: freeMoveBonus + nextAttacksBonusHits (On the Hunt — gain free MP, next attack gets +N Hit)
  if (entry.type === 'dcSpecial' && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && entry.nextAttacksBonusHits) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    addMovementPoints(game, msgId, entry.freeMoveBonus);
    // CRR MOVE-017: "Move X spaces" effects ignore MP costs from terrain/figures.
    game.moveXBypassActive = game.moveXBypassActive || {};
    game.moveXBypassActive[msgId] = true;
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
    game.shadowOpsBlockedPlayer = opponentPlayerNum(playerNum);
    return {
      applied: true,
      logMessage: 'Shadow Ops active — opponent cannot play Command cards this round.',
    };
  }

  // ccEffect: interactBlockRange + controlBlockRange (A Powerful Influence — hostile figures within range cannot interact / count for control)
  if (entry.type === 'ccEffect' && entry.interactBlockRange && entry.controlBlockRange) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.powerfulInfluencePlayerNum = playerNum;
    return {
      applied: true,
      logMessage: entry.logMessage || entry.label,
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
    syncHealthStateToList(game, playerNum, msgId, healthState);
    if (mpBonus > 0) {
      addMovementPoints(game, msgId, mpBonus);
    }
    if (doFocus) {
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      for (const fk of figureKeys) {
        applyCondition(game, fk, 'Focus');
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
    if (game.restInPeaceActive) return { applied: false, manualMessage: '**Rest in Peace** is active — players cannot retrieve Command cards from discard piles this round.' };
    const discardKey = ccDiscardKey(playerNum);
    const handKey = ccHandKey(playerNum);
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
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };

    // Apply strain cost to activating figure (e.g. Fool Me Once costs 2 Strain)
    let strainNote = '';
    let refreshDcEmbed = false;
    if (entry.strainCostToSelf > 0 && dcMessageMeta && dcHealthState) {
      const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (selfMsgId) {
        const selectedFig = game.dcActionsData?.[selfMsgId]?.selectedFigure ?? 0;
        const healthState = dcHealthState.get(selfMsgId) || [];
        if (healthState[selectedFig]) {
          const [cur, max] = healthState[selectedFig];
          const newCur = Math.max(0, (cur ?? max) - entry.strainCostToSelf);
          healthState[selectedFig] = [newCur, max ?? newCur];
          dcHealthState.set(selfMsgId, healthState);
          syncHealthStateToList(game, playerNum, selfMsgId, healthState);
          strainNote = ` You suffered ${entry.strainCostToSelf} Strain (${cur ?? max} → ${newCur} HP).`;
          refreshDcEmbed = true;
        } else {
          strainNote = ` (Apply ${entry.strainCostToSelf} Strain to yourself manually.)`;
        }
      } else {
        strainNote = ` (Apply ${entry.strainCostToSelf} Strain to yourself manually.)`;
      }
    }

    const oppNum = opponentPlayerNum(playerNum);
    const discardKey = ccDiscardKey(oppNum);
    const removedCards = (game[discardKey] || []).slice();
    const cleared = removedCards.length;
    game[discardKey] = [];
    // Move removed cards to gameBox (permanently out of the game)
    game.gameBox = game.gameBox || [];
    game.gameBox.push(...removedCards);
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
      logMessage: (parts.length ? parts.join('; ') + '.' : 'Opponent discard cleared.') + strainNote,
      drewCards: drew.length ? drew : undefined,
      refreshOpponentDiscard: cleared > 0,
      refreshDcEmbed,
    };
  }

  // ccEffect: Draw N, then discard 1, gain VP = cost of discarded (Black Market Prices)
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0 && entry.drawThenDiscardOneGainVp) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const drew = drawCcCards(game, playerNum, entry.draw);
    if (drew.length === 0) return { applied: true, logMessage: 'No cards to draw.' };
    const toDiscard = drew[drew.length - 1];
    const handKey = ccHandKey(playerNum);
    const discardKey = ccDiscardKey(playerNum);
    const hand = (game[handKey] || []).slice();
    const idx = hand.indexOf(toDiscard);
    if (idx >= 0) hand.splice(idx, 1);
    game[handKey] = hand;
    game[discardKey] = (game[discardKey] || []).concat(toDiscard);
    const eff = getCcEffect(toDiscard);
    const cost = typeof eff?.cost === 'number' ? eff.cost : 0;
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total ?? 0) + cost;
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
      const handKey = ccHandKey(playerNum);
      const discardKey = ccDiscardKey(playerNum);
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

  // ccEffect: restInPeaceEffect (Rest in Peace) — block all discard-pile access for the round; draw 1 (end-of-round draw)
  if (entry.type === 'ccEffect' && entry.restInPeaceEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.restInPeaceActive = true;
    const drew = drawCcCards(game, playerNum, entry.draw || 1);
    return {
      applied: true,
      drewCards: drew.length > 0 ? drew : undefined,
      logMessage: '**Rest in Peace** — Players cannot choose, play, or re-draw Command cards in discard piles this round.',
    };
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
    addMovementPoints(game, msgId, n);
    // C4: On the Lam — flag for post-move LOS recheck (attack misses if target moves out of LOS)
    if (context.cardName === 'On the Lam' && game.pendingCombat) {
      game.onTheLamActive = true;
    }
    // C77: Urgency requires all MP to be spent at once
    if (entry.mustSpendAll) {
      game.urgencyMustSpendAll = game.urgencyMustSpendAll || {};
      game.urgencyMustSpendAll[msgId] = true;
    }
    const allNote = entry.mustSpendAll ? ' (must spend all at once)' : '';
    const msg = n === 1 ? `Gained 1 movement point${allNote}.` : `Gained ${n} movement points${allNote}.`;
    return { applied: true, logMessage: msg, refreshMovementBank: true, activeMsgId: msgId };
  }

  // ccEffect: discardUpToNHarmful + mpBonus combo (optionally + recoverDamage) — Heart of Freedom, Price of Glory, Worth Every Credit
  if (entry.type === 'ccEffect' && typeof entry.discardUpToNHarmful === 'number' && typeof entry.mpBonus === 'number') {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    // Price of Glory Phase 1: present token combo choice before applying any effects
    if (entry.optionalPowerTokenOnConditionDiscard && !chosenFigureKey) {
      return {
        requiresChoice: true,
        choiceOptions: [
          'Discard condition + gain MP (no tokens)',
          'Damage self — Surge + Damage tokens',
          'Damage self — Damage + Block tokens',
          'Damage self — Block + Evade tokens',
        ],
        choiceValues: ['skip', 'Surge+Damage', 'Damage+Block', 'Block+Evade'],
      };
    }
    const HARMFUL = HARMFUL_CONDITIONS;
    const limit = entry.discardUpToNHarmful;
    let discarded = 0;
    game.figureConditions = game.figureConditions || {};
    for (const fk of figureKeys) {
      if (discarded >= limit) break;
      const existing = [...(game.figureConditions[fk] || [])];
      const harmful = existing.filter((c) => HARMFUL.includes(c));
      for (const h of harmful) {
        if (discarded >= limit) break;
        const before = (game.figureConditions[fk] || []).length;
        filterCondition(game, fk, h);
        const after = (game.figureConditions[fk] || []).length;
        if (after < before) discarded++;
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
        syncHealthStateToList(game, playerNum, msgId, healthState);
      }
    }
    const mp = entry.mpBonus;
    addMovementPoints(game, msgId, mp);
    const parts = [];
    if (discarded > 0) parts.push(`Discarded ${discarded} HARMFUL condition(s)`);
    if (recovered > 0) parts.push(`recovered ${recovered} Damage`);
    parts.push(`gained ${mp} MP`);
    // Worth Every Credit: set VP bonus for next hostile defeat this activation
    if (typeof entry.nextHostileDefeatVpBonus === 'number' && entry.nextHostileDefeatVpBonus > 0) {
      game.nextHostileDefeatVpBonus = game.nextHostileDefeatVpBonus || {};
      game.nextHostileDefeatVpBonus[playerNum] = { amount: entry.nextHostileDefeatVpBonus, msgId };
      parts.push(`+${entry.nextHostileDefeatVpBonus} VP if hostile defeated this activation`);
    }
    // Price of Glory Phase 2: apply token combo + self-damage (chosenFigureKey = 'Surge+Hit' etc.)
    let tokenRefresh = false;
    if (entry.optionalPowerTokenOnConditionDiscard && chosenFigureKey && chosenFigureKey !== 'skip' && dcHealthState) {
      const combo = String(chosenFigureKey).split('+');
      const selfHs = (dcHealthState.get(msgId) || []).slice();
      if (selfHs.length > 0 && Array.isArray(selfHs[0])) {
        const [sCur, sMax] = selfHs[0];
        selfHs[0] = [Math.max(0, (sCur ?? sMax ?? 0) - 1), sMax];
        dcHealthState.set(msgId, selfHs);
        syncHealthStateToList(game, playerNum, msgId, selfHs);
      }
      const activatingFk = figureKeys[0];
      for (const tok of combo) grantPowerTokens(game, activatingFk, tok, 1);
      parts.push(`suffered 1 Damage, gained ${combo.length} Power Token(s): ${combo.join(' + ')}`);
      tokenRefresh = true;
    }
    return { applied: true, logMessage: parts.join(', ') + '.', refreshDcEmbed: recovered > 0 || tokenRefresh };
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
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
      applyCondition(game, fk, 'Hide');
    }
    const fk = figureKeys[0];
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    const current = game.figurePowerTokens[fk].length;
    const toAdd = Math.min(entry.powerTokenGain, getMaxPowerTokens(fk) - current);
    addMovementPoints(game, msgId, entry.mpBonus);
    if (toAdd > 0) {
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: meta?.displayName || fk, count: toAdd }], channelId: null, playerNum };
    }
    // Apex Predator: set activation-long recover-on-defeat flag
    if (typeof entry.recoverOnHostileDefeat === 'number' && entry.recoverOnHostileDefeat > 0) {
      game.recoverOnHostileDefeat = game.recoverOnHostileDefeat || {};
      game.recoverOnHostileDefeat[playerNum] = { amount: entry.recoverOnHostileDefeat, range: entry.recoverOnHostileDefeatRange ?? 2, msgId };
    }
    const apParts = ['Became Focused', 'Hidden', toAdd > 0 ? `gained ${toAdd} Power Token(s) — choose type` : null, `gained ${entry.mpBonus} MP`];
    if (typeof entry.recoverOnHostileDefeat === 'number' && entry.recoverOnHostileDefeat > 0) apParts.push(`recover ${entry.recoverOnHostileDefeat} Damage if hostile within ${entry.recoverOnHostileDefeatRange ?? 2} is defeated this activation`);
    const parts = apParts.filter(Boolean);
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
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
    }
    addMovementPoints(game, msgId, entry.mpBonus);
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

  // ccEffect: attackTargetSwap + mpBonus (Bodyguard, Get Behind Me!) — swap combat target to the activating figure
  if (entry.type === 'ccEffect' && entry.attackTargetSwap && typeof entry.mpBonus === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    const isGetBehindMe = !!entry.getsBehindMe;
    const cardLabel = isGetBehindMe ? 'Get Behind Me!' : 'Bodyguard';
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const n = entry.mpBonus;
    addMovementPoints(game, msgId, n);
    const mpNote = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;

    // Attempt to swap the combat target to the activating figure
    const combat = game.pendingCombat || game.combat;
    if (!combat || !combat.target) {
      return { applied: true, logMessage: `${mpNote} No active combat found — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
    }
    const defenderPlayerNum = combat.defenderPlayerNum;
    // Card is played by the defender's side (the player whose friendly is being attacked)
    if (playerNum !== defenderPlayerNum) {
      return { applied: true, logMessage: `${mpNote} ${cardLabel} target swap — resolve manually (player mismatch).`, refreshMovementBank: true, activeMsgId: msgId };
    }
    const originalTargetCoord = combat.target?.coord ? String(combat.target.coord).toLowerCase() : null;
    const mapId = game.selectedMap?.id;
    const mapSpaces = mapId ? getMapData(mapId) : null;
    const adjToTarget = (mapSpaces && originalTargetCoord) ? new Set((mapSpaces.adjacency?.[originalTargetCoord] || []).map(s => String(s).toLowerCase())) : null;

    // Find the activating figure — it's the currently selected figure for the active DC
    const meta = dcMessageMeta.get(msgId);
    const figureKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const selectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const swapperFk = figureKeys[selectedIdx] || figureKeys[0];
    if (!swapperFk) {
      return { applied: true, logMessage: `${mpNote} Could not identify ${cardLabel} figure — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
    }
    const swapperPos = game.figurePositions?.[playerNum]?.[swapperFk];
    const swapperPosNorm = swapperPos ? String(swapperPos).toLowerCase() : null;

    // Verify keyword: Bodyguard requires GUARDIAN; Get Behind Me requires GUARDIAN or FORCE USER
    const swapperDcName = dcNameFromFigureKey(swapperFk);
    const swapperEff = getDcEffects()?.[swapperDcName] || getDcEffects()?.[swapperDcName?.replace(/\s*\[.*\]\s*$/, '')];
    const swapperKws = (swapperEff?.keywords || []).map(k => String(k).toUpperCase());
    if (isGetBehindMe) {
      if (!swapperKws.includes('GUARDIAN') && !swapperKws.includes('FORCE USER')) {
        return { applied: true, logMessage: `${mpNote} Activating figure is not a GUARDIAN or FORCE USER — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
      }
    } else {
      if (!swapperKws.includes('GUARDIAN')) {
        return { applied: true, logMessage: `${mpNote} Activating figure is not a GUARDIAN — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
      }
    }

    // Get Behind Me! additional validation: original target must be Small, cost ≤ 10, within 3 spaces of card player
    if (isGetBehindMe) {
      const origTargetFk = combat.target?.figureKey;
      const origTargetDcName = origTargetFk ? dcNameFromFigureKey(origTargetFk) : null;
      const origTargetStats = origTargetDcName ? getStatsForDc(origTargetDcName) : null;
      // Small check: not LARGE or MASSIVE (keywords or passives)
      const origKws = (origTargetStats?.keywords || []).map(k => String(k).toUpperCase());
      const origPassives = (origTargetStats?.passives || []).map(p => String(p).toUpperCase());
      const isSmall = !origKws.includes('LARGE') && !origKws.includes('MASSIVE') && !origPassives.includes('MASSIVE');
      if (!isSmall) {
        return { applied: true, logMessage: `${mpNote} Original target is not a Small figure — resolve manually.`, refreshMovementBank: true, activeMsgId: msgId };
      }
      // Cost check: figure cost ≤ 10
      const origCost = origTargetStats?.cost ?? 99;
      if (origCost > 10) {
        return { applied: true, logMessage: `${mpNote} Original target cost (${origCost}) exceeds 10 — resolve manually.`, refreshMovementBank: true, activeMsgId: msgId };
      }
      // Range check: original target within 3 spaces of the card player
      if (swapperPosNorm && originalTargetCoord && countGameSpaces(game, swapperPosNorm, originalTargetCoord) > 3) {
        return { applied: true, logMessage: `${mpNote} Original target is not within 3 spaces of activating figure — resolve manually.`, refreshMovementBank: true, activeMsgId: msgId };
      }
    }

    // The figure must be adjacent to the original target (or will move there with the granted MP).
    // Per the rules, the player gains MP to move into position first, then the swap happens.
    // We swap the target now; the player is responsible for actually moving the figure adjacent.
    const isAdjacentNow = adjToTarget && swapperPosNorm && adjToTarget.has(swapperPosNorm);
    const adjacencyNote = isAdjacentNow ? '' : ' (Use the granted MP to move adjacent to the original target.)';

    // Perform the combat target swap
    const swapperStats = getStatsForDc(swapperDcName);
    const swapperLabel = swapperDcName.replace(/_/g, ' ');
    const originalLabel = combat.target?.label || 'unknown';
    combat.target.figureKey = swapperFk;
    combat.target.coord = swapperPos || combat.target.coord;
    combat.target.label = swapperLabel;
    combat.defenderDcName = swapperDcName;
    combat.targetStats = {
      ...combat.targetStats,
      defense: swapperStats?.defense || 'white',
      cost: swapperStats?.cost ?? combat.targetStats?.cost ?? 5,
    };
    // Update defender conditions from the new target figure
    const swapperConds = game.figureConditions?.[playerNum]?.[swapperFk] || [];
    combat.defenderConds = swapperConds;

    // C20: When target changes via Get Behind Me, cancel defender-side CC effects on the combat
    // (defense bonuses that were applied for the original defender no longer apply)
    if (isGetBehindMe) {
      const cancelledEffects = [];
      if (combat.bonusBlock) { cancelledEffects.push(`+${combat.bonusBlock} Block`); delete combat.bonusBlock; }
      if (combat.bonusEvade) { cancelledEffects.push(`+${combat.bonusEvade} Evade`); delete combat.bonusEvade; }
      if (combat.defenseBonusDice && combat.defenseBonusDice.length > 0) {
        cancelledEffects.push(`bonus defense dice (${combat.defenseBonusDice.join(', ')})`);
        combat.defenseBonusDice = [];
      }
      if (combat.defensePoolRemoveMax) { cancelledEffects.push(`defense pool remove limit`); delete combat.defensePoolRemoveMax; }
      if (combat.defensePoolRemoveAll) { cancelledEffects.push(`defense pool remove all`); delete combat.defensePoolRemoveAll; }
      if (cancelledEffects.length > 0) {
        const cancelNote = ` Cancelled prior defender CC effects: ${cancelledEffects.join(', ')}.`;
        const swapLog = `${mpNote} **${cardLabel}** — Attack target swapped from **${originalLabel}** to **${swapperLabel}**.${adjacencyNote}${cancelNote}`;
        return { applied: true, logMessage: swapLog, refreshMovementBank: true, activeMsgId: msgId };
      }
    }

    const swapLog = `${mpNote} **${cardLabel}** — Attack target swapped from **${originalLabel}** to **${swapperLabel}**.${adjacencyNote}`;
    return { applied: true, logMessage: swapLog, refreshMovementBank: true, activeMsgId: msgId };
  }

  // ccEffect: +N MP (Fleet Footed, Rank and File, Opportunistic, etc.)
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
    const { game, playerNum, dcMessageMeta, cardName, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    // Opportunistic (C66): playable outside activation when a hostile suffers damage.
    // Phase 1: show DC picker. Phase 2 (choiceIndex set): grant MP to chosen DC.
    if (!msgId) {
      const ccEffect = getCcEffect(cardName);
      const timing = (ccEffect?.timing || '').toLowerCase().replace(/\s+/g, '');
      if (timing === 'afterhostilefiguresuffersdamage') {
        const n = entry.mpBonus;
        // Phase 2: choice resolved — grant MP to chosen DC
        if (choiceIndex !== undefined && choiceIndex !== null && chosenFigureKey) {
          const chosenMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
          if (chosenMsgId) {
            addMovementPoints(game, chosenMsgId, n);
            game.opportunisticMustSpendNow = game.opportunisticMustSpendNow || {};
            game.opportunisticMustSpendNow[playerNum] = { mp: n, card: cardName, msgId: chosenMsgId };
            return { applied: true, logMessage: `**Opportunistic** — **${dcNameFromFigureKey(chosenFigureKey)}** gained **${n} MP** (must be spent immediately).` };
          }
          return { applied: true, logMessage: `Gained **${n} MP** (outside activation — spend on the chosen figure immediately).` };
        }
        // Phase 1: enumerate friendly figures for choice
        const dcMsgIds = getDcMessageIds(game, playerNum) || [];
        const dcListOpp = getDcList(game, playerNum) || [];
        const choiceOptions = [];
        const choiceValues = [];
        for (let i = 0; i < dcMsgIds.length; i++) {
          const dcObj = dcListOpp[i];
          if (!dcObj || dcObj.defeated) continue;
          const dcN = typeof dcObj === 'object' ? (dcObj.dcName || dcObj.displayName) : dcObj;
          const fks = getFigureKeysForDcMsg(game, playerNum, dcMessageMeta.get(dcMsgIds[i]));
          if (fks.length === 0) continue;
          choiceOptions.push(dcN);
          choiceValues.push(fks[0]); // Use first figure key as identifier
        }
        if (choiceOptions.length === 0) {
          return { applied: true, logMessage: `Gained **${n} MP** but no friendly figures available to move.` };
        }
        return { requiresChoice: true, choiceOptions, choiceValues };
      }
      return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    }
    const n = entry.mpBonus;
    addMovementPoints(game, msgId, n);
    let msg = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
    // Rank and File: each other friendly TROOPER also gains N MP immediately
    if (entry.trooperMpBonusRound) {
      const bonus = entry.trooperMpBonusRound;
      const dcMsgIds = getDcMessageIds(game, playerNum) || [];
      const dcList = getDcList(game, playerNum) || [];
      let trooperCount = 0;
      for (let i = 0; i < dcMsgIds.length; i++) {
        const dMsgId = dcMsgIds[i];
        if (dMsgId === msgId) continue;
        const dc = dcList[i];
        if (!dc?.dcName) continue;
        const eff = getDcEffects()?.[dc.dcName] || getDcEffects()?.[dc.dcName?.replace(/\s*\[.*\]\s*$/, '')];
        const kws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
        if (!kws.includes('TROOPER')) continue;
        addMovementPoints(game, dMsgId, bonus);
        trooperCount++;
      }
      if (trooperCount > 0) msg += ` Each of ${trooperCount} other friendly TROOPER(s) also gained ${bonus} MP.`;
    }
    // mobileMovement (Force Jump): during this move ignore figures and doors for pathing; cannot end in blocking terrain
    if (entry.mobileMovement) {
      game.mobileMovementActive = game.mobileMovementActive || {};
      game.mobileMovementActive[msgId] = true;
      msg += ' MOBILE movement active \u2014 treat doors and figures as open terrain; cannot end in blocking terrain.';
    }
    return { applied: true, logMessage: entry.logMessage || msg, refreshMovementBank: true, activeMsgId: msgId };
  }

  // ccEffect: distributeHitTokensEqualToRound (Combat Resupply) — 1 Power Token + distribute Hit tokens = round# among friendly figures within 3 spaces
  if (entry.type === 'ccEffect' && entry.distributeHitTokensEqualToRound && typeof entry.powerTokenGain === 'number') {
    const { game, playerNum, dcMessageMeta, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const fk = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatorPos = fk ? game.figurePositions?.[playerNum]?.[fk] : null;
    const roundNum = game.currentRound || 1;

    // Find friendly figures within 3 spaces (including self)
    const eligible = [];
    for (const [efk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || !activatorPos) continue;
      if (countGameSpaces(game, activatorPos, pos) > 3) continue;
      const existing = (game.figurePowerTokens?.[efk] || []).length;
      if (existing >= getMaxPowerTokens(efk)) continue; // already at max tokens
      eligible.push(efk);
    }

    // Phase 2+: sequential allocation — player picks one figure at a time to receive a Hit token
    const pending = game.pendingCombatResupply?.[msgId];
    if (pending && choiceIndex != null && targetFigureKey) {
      grantPowerTokens(game, targetFigureKey, 'Damage', 1);
      pending.remaining -= 1;
      const tName = dcNameFromFigureKey(targetFigureKey);
      if (pending.remaining <= 0) {
        delete game.pendingCombatResupply[msgId];
        return { applied: true, logMessage: `**Combat Resupply** — **${tName}** gained 1 Damage Token. Distribution complete.`, refreshDcEmbed: true };
      }
      // Still more to distribute — re-check eligible (some may now be full)
      const stillEligible = eligible.filter((efk) => (game.figurePowerTokens[efk] || []).length < getMaxPowerTokens(efk));
      if (stillEligible.length === 0) {
        delete game.pendingCombatResupply[msgId];
        return { applied: true, logMessage: `**Combat Resupply** — **${tName}** gained 1 Damage Token. No more eligible figures (all at max tokens).`, refreshDcEmbed: true };
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(stillEligible),
        targetFigureKeys: stillEligible,
        logMessage: `**${tName}** gained 1 Damage Token. ${pending.remaining} more to assign.`,
      };
    }

    // Phase 1: initial call — grant Power Token + start Hit token distribution
    // Grant the 1 Power Token first
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    const current = game.figurePowerTokens[fk].length;
    const ptToAdd = Math.min(entry.powerTokenGain, getMaxPowerTokens(fk) - current);
    if (ptToAdd > 0) {
      game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: fk, count: ptToAdd }], channelId: null, playerNum };
    }

    if (eligible.length === 0) {
      return { applied: true, requiresPowerTokenChoice: ptToAdd > 0, logMessage: `Gained ${ptToAdd > 0 ? ptToAdd + ' Power Token(s)' : 'no Power Tokens (max)'}. No friendly figures within 3 spaces eligible for Hit tokens.` };
    }

    // Auto-distribute if only 1 eligible figure
    if (eligible.length === 1) {
      const tokensToAdd = roundNum; // grantPowerTokens handles overflow
      grantPowerTokens(game, eligible[0], 'Damage', tokensToAdd);
      const eName = dcNameFromFigureKey(eligible[0]);
      return { applied: true, requiresPowerTokenChoice: ptToAdd > 0, logMessage: `Gained ${ptToAdd} Power Token(s). **${eName}** gained ${tokensToAdd} Damage Token(s) (round ${roundNum}).`, refreshDcEmbed: true };
    }

    // Multiple eligible — start sequential picker
    game.pendingCombatResupply = game.pendingCombatResupply || {};
    game.pendingCombatResupply[msgId] = { remaining: roundNum };
    return {
      applied: false,
      requiresChoice: true,
      requiresPowerTokenChoice: ptToAdd > 0,
      choiceOptions: figureChoiceLabels(eligible),
      targetFigureKeys: eligible,
      logMessage: `Gained ${ptToAdd} Power Token(s). Distribute ${roundNum} Damage Token(s) among friendly figures within 3 spaces (round ${roundNum}). Pick a figure:`,
    };
  }

  // ccEffect: Power Token gain (Battle Scars, etc.) — requires active activation
  // Skip if a more specific handler owns the ability (lookingForAFightChoice, apexPredator, etc.)
  if (entry.type === 'ccEffect' && (typeof entry.powerTokenGain === 'number' || entry.powerTokenGainIfDamagedGte)
    && !entry.lookingForAFightChoice) {
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
      const dcMessageIds = getDcMessageIds(game, playerNum) || [];
      const dcList = getDcList(game, playerNum) || [];
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
    if (figureKeys.length > 1 && !context.chosenFigureKey) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(figureKeys),
        targetFigureKeys: figureKeys,
        logMessage: `Choose which figure gains ${n} Power Token(s):`,
      };
    }
    const fk = context.chosenFigureKey || figureKeys[0];
    game.figurePowerTokens = game.figurePowerTokens || {};
    game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || [];
    const current = game.figurePowerTokens[fk].length;
    // conditionalExteriorPowerToken (Marked Territory): +1 if figure is in an exterior space
    let conditionalPtBonus = 0;
    let conditionalPtNote = '';
    if (typeof entry.conditionalExteriorPowerToken === 'number' && entry.conditionalExteriorPowerToken > 0 && game.selectedMap?.id) {
      const _mapExt = getMapData(game.selectedMap.id)?.exterior || {};
      const _figPos = game.figurePositions?.[playerNum]?.[fk];
      if (_figPos && (_mapExt[String(_figPos).toLowerCase()] || _mapExt[String(_figPos).toUpperCase()])) {
        conditionalPtBonus += entry.conditionalExteriorPowerToken;
        conditionalPtNote += ` (exterior: +${entry.conditionalExteriorPowerToken} bonus token)`;
      }
    }
    // conditionalAdjacentLeaderPowerToken (Prepared for Battle): +1 if adjacent to a friendly LEADER
    if (typeof entry.conditionalAdjacentLeaderPowerToken === 'number' && entry.conditionalAdjacentLeaderPowerToken > 0 && game.selectedMap?.id) {
      const _adjAll = getFiguresAdjacentToTarget(game, fk, game.selectedMap.id);
      const _hasLeader = _adjAll.some(({ figureKey: _afk, playerNum: _apn }) => {
        if (_apn !== playerNum) return false;
        const _adcName = dcNameFromFigureKey(_afk);
        const _aEff = getDcEffects()?.[_adcName] || getDcEffects()?.[_adcName?.replace(/\s*\[.*\]\s*$/, '')];
        return (_aEff?.keywords || []).map(k => String(k).toUpperCase()).includes('LEADER');
      });
      if (_hasLeader) {
        conditionalPtBonus += entry.conditionalAdjacentLeaderPowerToken;
        conditionalPtNote += ` (adjacent LEADER: +${entry.conditionalAdjacentLeaderPowerToken} bonus token)`;
      }
    }
    const nTotal = n + conditionalPtBonus;
    const toAdd = Math.min(nTotal, getMaxPowerTokens(fk) - current);
    if (toAdd <= 0) return { applied: false, manualMessage: `That figure already has ${getMaxPowerTokens(fk)} Power Tokens (max).` };
    game.pendingPowerTokenGrant = { grants: [{ figureKey: fk, figName: fk, count: toAdd }], channelId: null, playerNum };
    const msg = (toAdd === 1 ? 'Gained 1 Power Token' : `Gained ${toAdd} Power Tokens`) + conditionalPtNote + ' — choose type.';
    // Veteran Instincts: set activation-long flag so attacker/defender may add +1 Hit/Surge or Block/Evade
    if (entry.vetInstinctsActiveThisActivation) {
      game.vetInstinctsActiveThisActivation = game.vetInstinctsActiveThisActivation || {};
      game.vetInstinctsActiveThisActivation[playerNum] = true;
    }
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
    for (const fk of adjacent) {
      applyCondition(game, fk, 'Focus');
    }
    return { applied: true, logMessage: `${adjacent.length} adjacent figure(s) became Focused.`, refreshBoard: true };
  }

  // ccEffect: Against the Odds — end of round, VP condition, Focus up to 3 figures
  if (entry.type === 'ccEffect' && typeof entry.focusGainToUpToNFigures === 'number' && entry.vpCondition?.opponentHasAtLeastMore != null) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const playerVP = (game[vpKey(playerNum)])?.total ?? 0;
    const oppVP = (game[vpKey(oppNum)])?.total ?? 0;
    const diff = entry.vpCondition.opponentHasAtLeastMore;
    if (oppVP - playerVP < diff) return { applied: true };
    const poses = game.figurePositions?.[playerNum] || {};
    const allKeys = Object.keys(poses);
    if (allKeys.length === 0) return { applied: true };
    const n = Math.min(entry.focusGainToUpToNFigures, allKeys.length);
    if (allKeys.length > n) return { applied: false, manualMessage: `Resolve manually: choose up to ${n} of your ${allKeys.length} figures to become Focused.` };
    for (const fk of allKeys) {
      applyCondition(game, fk, 'Focus');
    }
    return { applied: true, logMessage: `${allKeys.length} figure(s) became Focused.`, refreshBoard: true };
  }

  // ccEffect: dioxisFumesEffect — each non-DROID figure suffers 1 Strain (damage); set round flag
  if (entry.type === 'ccEffect' && entry.dioxisFumesEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: '**Dioxis Fumes** — Each non-DROID figure suffers 1 Strain. Non-DROID figures cannot recover Strain this round. Resolve manually.' };
    const parts = [];
    const refreshMsgIds = [];
    let anyDefeated = false;
    const defeatedFigures = [];
    for (const pn of [1, 2]) {
      const poses = game.figurePositions?.[pn] || {};
      for (const fk of Object.keys(poses)) {
        const dcName = dcNameFromFigureKey(fk);
        const stats = getStatsForDc(dcName);
        const isDroid = (stats?.keywords || []).some(k => /^droid$/i.test(k));
        if (isDroid) continue;
        const tMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
        if (!tMsgId) continue;
        const hs = dcHealthState.get(tMsgId) || [];
        const { figureIndex: fIdx } = parseFigureKey(fk);
        const hpE = hs[fIdx];
        if (!Array.isArray(hpE) || hpE.length < 1) continue;
        const [cur, max] = hpE;
        const newCur = Math.max(0, (cur ?? max) - 1);
        hs[fIdx] = [newCur, max ?? cur];
        dcHealthState.set(tMsgId, hs);
        syncHealthStateToList(game, pn, tMsgId, hs);
        if (newCur <= 0) {
          parts.push(`**${dcName}** (${cur ?? max}→0, DEFEATED)`);
          anyDefeated = true;
          defeatedFigures.push({ figureKey: fk, defeatedPlayerNum: pn, attackerPlayerNum: opponentPlayerNum(pn), source: 'Dioxis Fumes' });
        } else {
          parts.push(`**${dcName}** (${cur ?? max}→${newCur})`);
        }
        if (!refreshMsgIds.includes(tMsgId)) refreshMsgIds.push(tMsgId);
      }
    }
    // Set round flag: non-DROID figures cannot recover Strain this round
    game.roundDioxisActive = true;
    const affected = parts.length > 0 ? parts.join(', ') : 'no non-DROID figures on the board';
    const dioxisResult = { applied: true, logMessage: `**Dioxis Fumes** — 1 Strain to each non-DROID: ${affected}.\n⚠️ Non-DROID figures cannot recover Strain for the rest of this round.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshMsgIds, refreshBoard: anyDefeated };
    if (defeatedFigures.length > 0) dioxisResult.defeatedFigures = defeatedFigures;
    return dioxisResult;
  }

  // ccEffect: vpGainSelf + vpGainOpponent (e.g. Dangerous Bargains — start of round, if self VP ≤ N, both gain VP)
  if (entry.type === 'ccEffect' && typeof entry.vpGainSelf === 'number' && typeof entry.vpGainOpponent === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const selfKey = vpKey(playerNum);
    const oppKey = vpKey(3 - playerNum);
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
      syncHealthStateToList(game, playerNum, actMsgId, healthState);
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
    if (adjacent.length > 1 && !context.chosenFigureKey) {
      let nPreview = entry.recoverDamageToAdjacent;
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(adjacent),
        choiceValues: adjacent,
        targetFigureKeys: adjacent,
        logMessage: `Choose which of ${adjacent.length} adjacent figures recovers ${nPreview} Damage:`,
      };
    }
    const targetFk = context.chosenFigureKey && adjacent.includes(context.chosenFigureKey)
      ? context.chosenFigureKey
      : adjacent[0];
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
    syncHealthStateToList(game, playerNum, targetMsgId, healthState);
    return { applied: true, logMessage: `Adjacent figure recovered ${heal} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [targetMsgId] };
  }

  // ccEffect: recoverDamage (Recovery) — recover N damage on activating figure(s); requires dcHealthState, msgId
  if (entry.type === 'ccEffect' && typeof entry.recoverDamage === 'number' && entry.recoverDamage > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState, msgId } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const actMsgId = msgId || findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!actMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: recovery requires health state.' };
    // Sustained by Rage: cannot recover damage
    const actMeta = dcMessageMeta.get(actMsgId);
    const _sbrRecoverDcEff = actMeta?.dcName ? (getDcEffects()?.[actMeta.dcName]) : null;
    if ((_sbrRecoverDcEff?.specialAbilityIds || []).includes('sustained_by_rage')) {
      return { applied: true, logMessage: '**Sustained by Rage** — cannot recover Damage.' };
    }
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
      syncHealthStateToList(game, playerNum, actMsgId, healthState);
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
    const HARMFUL = HARMFUL_CONDITIONS;
    game.figureConditions = game.figureConditions || {};
    let discarded = 0;
    for (const fk of adjacent) {
      const existing = [...(game.figureConditions[fk] || [])];
      for (const c of existing) {
        if (!HARMFUL.includes(c)) continue;
        const before = (game.figureConditions[fk] || []).length;
        filterCondition(game, fk, c);
        const after = (game.figureConditions[fk] || []).length;
        if (after < before) discarded++;
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
    const HARMFUL = HARMFUL_CONDITIONS;
    game.figureConditions = game.figureConditions || {};
    let discarded = 0;
    for (const fk of figureKeys) {
      const existing = [...(game.figureConditions[fk] || [])];
      for (const c of existing) {
        if (!HARMFUL.includes(c)) continue;
        const before = (game.figureConditions[fk] || []).length;
        filterCondition(game, fk, c);
        const after = (game.figureConditions[fk] || []).length;
        if (after < before) discarded++;
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
    const defenderPlayerNum = cbt.defenderPlayerNum ?? opponentPlayerNum(cbt.attackerPlayerNum);
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
    let n = entry.defenderStrain;
    // Escalating Hostility: +1 Strain per other copy of this card in the discard pile
    if (entry.defenderStrainPlusDiscardCopies && context.cardName && playerNum) {
      const discardKey = ccDiscardKey(playerNum);
      const discard = game[discardKey] || [];
      const copiesInDiscard = discard.filter(c => c === context.cardName).length;
      n += copiesInDiscard;
    }
    const [cur, max] = entry_;
    const newCur = Math.max(0, (cur ?? max ?? 0) - n);
    healthState[targetIdx] = [newCur, max];
    dcHealthState.set(targetMsgId, healthState);
    syncHealthStateToList(game, defenderPlayerNum, targetMsgId, healthState);
    const bonusNote = n > entry.defenderStrain ? ` (+${n - entry.defenderStrain} from copies in discard)` : '';
    return {
      applied: true,
      logMessage: `Defender suffered ${n} Strain${bonusNote}.`,
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
    // Primary Target: validate target is the highest-cost hostile figure on the map
    if (entry.requireHighestCostTarget && dcMessageMeta) {
      const defPn = cbt.defenderPlayerNum ?? opponentPlayerNum(playerNum);
      const targetDcName = dcNameFromFigureKey(cbt.target?.figureKey || '');
      const allEffects = getDcEffects() || {};
      const targetCost = allEffects[targetDcName]?.cost ?? 0;
      // Check all living hostile figures for any with higher cost
      const defDcIds = getDcMessageIds(game, defPn) || [];
      const defDcList = getDcList(game, defPn) || [];
      let higherExists = false;
      for (let i = 0; i < defDcIds.length; i++) {
        const dc = defDcList[i];
        if (!dc || dc.defeated) continue;
        const eff = allEffects[dc.dcName] || {};
        if ((eff.cost ?? 0) > targetCost) { higherExists = true; break; }
      }
      if (higherExists) {
        return { applied: false, manualMessage: `Cannot play: target (${targetDcName}, cost ${targetCost}) is not the highest-cost hostile figure on the map.` };
      }
    }
    let focusApplied = false;
    if (dcMessageMeta) {
      const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (msgId) {
        const meta = dcMessageMeta.get(msgId);
        if (meta) {
          const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
          if (figureKeys.length > 0) {
            for (const fk of figureKeys) {
              applyCondition(game, fk, 'Focus');
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
            for (const fk of figureKeys) {
              applyCondition(game, fk, 'Focus');
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
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
    }
    return { applied: true, logMessage: `Spent ${entry.mpCost} MP and became Focused.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
  }

  // ccEffect: Focus / Meditation — apply Focus to activating figures; requires active activation
  // Optional: readyActiveDc: true → also unexhaust/ready the active DC embed (e.g. Debts Repaid)
  // Excluded: conditionalFocusIfDamagedGte entries (e.g. Furious Charge) — handled in their own block below
  if ((abilityId === 'Focus' || (entry.type === 'ccEffect' && entry.applyFocus)) && !entry.conditionalFocusIfDamagedGte) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
    }
    if (entry.readyActiveDc) {
      return { applied: true, logMessage: 'Became Focused. Readied active Deployment card.', readyDcMsgIds: [msgId], refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
    }
    const extraParts = [];
    // extraActionBonus (All in a Day's Work): increment remaining actions for active DC
    if (typeof entry.extraActionBonus === 'number' && entry.extraActionBonus > 0) {
      const actData = game.dcActionsData?.[msgId];
      if (actData) {
        actData.remaining = (actData.remaining ?? 0) + entry.extraActionBonus;
        extraParts.push(`Gained ${entry.extraActionBonus} extra action${entry.extraActionBonus !== 1 ? 's' : ''}.`);
      }
    }
    // nextActivationFreeAttack (Meditation): store flag for next activation free attack
    if (entry.nextActivationFreeAttack) {
      game.nextActivationFreeAttack = game.nextActivationFreeAttack || {};
      game.nextActivationFreeAttack[playerNum] = entry.nextActivationFreeAttack;
    }
    // Fatal Deception: upgrade False Orders targeting (cost 5, range 5) this round
    if (entry.falseOrdersUpgrade) {
      game.falseOrdersUpgrade = game.falseOrdersUpgrade || {};
      game.falseOrdersUpgrade[playerNum] = entry.falseOrdersUpgrade;
      extraParts.push('False Orders upgraded to cost 5, range 5 this round.');
    }
    const baseMsg = entry.logMessage || 'Became Focused.';
    const fullMsg = extraParts.length > 0 ? `${baseMsg} ${extraParts.join(' ')}` : baseMsg;
    return { applied: true, logMessage: fullMsg, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true, conditionCardsToPost: ['Focus'] };
  }

  // dcSpecial: mpBonus + applyFocus (e.g. Get into Position — gain MP and become Focused)
  if (entry.type === 'dcSpecial' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0 && entry.applyFocus) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const playerNum = meta.playerNum;
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    // Add MP to movement bank
    addMovementPoints(game, msgId, entry.mpBonus);
    // Apply Focus to all figures in group
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
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
    for (const fk of figureKeys) {
      applyCondition(game, fk, cond);
    }
    return { applied: true, logMessage: `Became ${cond}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true, conditionCardsToPost: [cond] };
  }

  // dcSpecial: envRecoveryGearEffect — self + adjacent friendly TROOPERs: recover 1 HP or discard 1 harmful condition
  if (entry.type === 'dcSpecial' && entry.envRecoveryGearEffect) {
    const { game, msgId, meta, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !msgId || !meta || !dcHealthState) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
    const mapId = game.selectedMap?.id;
    const dcEffects = getDcEffects() || {};
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    const pNum = playerNum || meta.playerNum;
    const harmfulConditions = ['Stun', 'Bleed', 'Weaken'];
    // Helper: recover 1 HP if damaged, else discard 1 harmful condition if at full HP
    const applyRecoveryOrDiscard = (figKey, figMsgId, figIdx) => {
      const dcName = dcNameFromFigureKey(figKey);
      const hs = dcHealthState.get(figMsgId) || [];
      const hpEntry = hs[figIdx];
      if (hpEntry) {
        const [cur, max] = hpEntry;
        if (cur < max) {
          hs[figIdx] = [Math.min(max, cur + 1), max];
          dcHealthState.set(figMsgId, hs);
          syncHealthStateToList(game, pNum, figMsgId, hs);
          return `**${dcName}** recovered 1 HP`;
        }
      }
      // At full HP — try discarding 1 harmful condition
      const conds = game.figureConditions?.[figKey] || [];
      // Disarm permanent Weakened: skip locked Weaken when choosing which condition to discard
      const harmful = conds.filter(c => harmfulConditions.includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[figKey]));
      if (harmful.length > 0) {
        const removed = harmful[0];
        filterCondition(game, figKey, removed);
        return `**${dcName}** discarded **${removed}**`;
      }
      return null;
    };
    const results = [];
    // Self
    const selfResult = applyRecoveryOrDiscard(activatingFigureKey, msgId, selectedFig);
    if (selfResult) results.push(selfResult);
    // Adjacent friendly TROOPERs
    if (mapId) {
      const adjacentAll = getFiguresAdjacentToTarget(game, activatingFigureKey, mapId);
      for (const { figureKey: fk, playerNum: pn } of adjacentAll) {
        if (pn !== pNum) continue;
        if (fk === activatingFigureKey) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const eff = dcEffects[fkDcName];
        const kws = (eff?.keywords || []).map(k => String(k).toUpperCase());
        if (!kws.includes('TROOPER')) continue;
        const tMsgId = findMsgIdForFigureKey(game, pNum, fk, dcMessageMeta);
        if (!tMsgId) continue;
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const r = applyRecoveryOrDiscard(fk, tMsgId, figIdx);
        if (r) results.push(r);
      }
    }
    return {
      applied: true,
      logMessage: results.length > 0
        ? `**${entry.label}** — ${results.join('; ')}.`
        : `**${entry.label}** — No figures needed healing or condition removal.`,
      refreshDcEmbed: true,
    };
  }

  // dcSpecial: recoverSelf — recover N damage from own activating figure(s)
  if (entry.type === 'dcSpecial' && typeof entry.recoverSelf === 'number' && entry.recoverSelf > 0) {
    const { game, msgId, meta, dcHealthState } = context;
    if (!game || !msgId || !meta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Sustained by Rage: cannot recover damage
    const _sbrDcEff = meta?.dcName ? (getDcEffects()?.[meta.dcName]) : null;
    if ((_sbrDcEff?.specialAbilityIds || []).includes('sustained_by_rage')) {
      return { applied: true, logMessage: '**Sustained by Rage** — cannot recover Damage.' };
    }
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
    syncHealthStateToList(game, meta.playerNum, msgId, healthState);
    const freeMovePart = entry.freeMoveBonus > 0 ? ` Gained ${entry.freeMoveBonus} free movement point${entry.freeMoveBonus !== 1 ? 's' : ''} — use the Move button.` : '';
    if (entry.freeMoveBonus > 0) {
      addMovementPoints(game, msgId, entry.freeMoveBonus);
      // CRR MOVE-017: "Move X spaces" effects ignore MP costs from terrain/figures.
      game.moveXBypassActive = game.moveXBypassActive || {};
      game.moveXBypassActive[msgId] = true;
    }
    return {
      applied: true,
      logMessage: totalRecovered > 0 ? `Recovered ${totalRecovered} Damage.${freeMovePart}` : `Already at full health.${freeMovePart}`,
      refreshDcEmbed: true,
    };
  }

  // dcSpecial: medicalLoadoutEffect — you or an adjacent friendly recovers 3 Damage (Medical Loadout)
  // Phase 1 (no targetFigureKey): find adjacent friendlies → requiresChoice; Phase 2: apply heal
  if (entry.type === 'dcSpecial' && entry.medicalLoadoutEffect) {
    const { game, msgId, meta, dcMessageMeta, dcHealthState, targetFigureKey } = context;
    if (!game || !msgId || !meta || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    // Helper: apply up to 3 HP heal to a DC (by message ID)
    const applyHeal3 = (healMsgId) => {
      const hs = (dcHealthState.get(healMsgId) || []).slice();
      let totalHealed = 0;
      let remaining = 3;
      for (let i = 0; i < hs.length && remaining > 0; i++) {
        if (!Array.isArray(hs[i])) continue;
        const [cur, max] = hs[i];
        if (cur == null || max == null) continue;
        const healed = Math.min(max - cur, remaining);
        hs[i] = [cur + healed, max];
        totalHealed += healed;
        remaining -= healed;
      }
      dcHealthState.set(healMsgId, hs);
      syncHealthStateToList(game, playerNum, healMsgId, hs);
      return totalHealed;
    };
    // Phase 2: apply heal to chosen figure
    if (targetFigureKey) {
      if (targetFigureKey === 'self') {
        const healed = applyHeal3(msgId);
        return { applied: true, logMessage: `**Medical Loadout** — Recovered ${healed} Damage (self).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId] };
      }
      const tMsgId = findMsgIdForFigureKey(game, playerNum, targetFigureKey, dcMessageMeta);
      if (!tMsgId) return { applied: false, manualMessage: 'Could not find adjacent friendly DC — resolve manually.' };
      const tMeta = dcMessageMeta.get(tMsgId);
      const healed = applyHeal3(tMsgId);
      const tName = tMeta?.displayName || tMeta?.dcName || dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Medical Loadout** — **${tName}** recovered ${healed} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [tMsgId] };
    }
    // Phase 1: find adjacent friendly figures
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const adjFriendlyKeys = [];
    if (mapId) {
      for (const fk of activatingKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p === playerNum && !activatingKeys.includes(figureKey) && !adjFriendlyKeys.includes(figureKey)) {
            adjFriendlyKeys.push(figureKey);
          }
        }
      }
    }
    if (adjFriendlyKeys.length === 0) {
      const healed = applyHeal3(msgId);
      return { applied: true, logMessage: `**Medical Loadout** — Recovered ${healed} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId] };
    }
    const selfName = meta.displayName || meta.dcName || 'self';
    const opts = [`Heal self (${selfName})`];
    const tFks = ['self'];
    for (const fk of adjFriendlyKeys) {
      const fMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      const fMeta = fMsgId ? dcMessageMeta.get(fMsgId) : null;
      const fName = fMeta?.displayName || fMeta?.dcName || dcNameFromFigureKey(fk);
      opts.push(`Heal: ${fName}`);
      tFks.push(fk);
    }
    return { requiresChoice: true, choiceOptions: opts, targetFigureKeys: tFks };
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
      syncHealthStateToList(game, adjMeta2?.playerNum, adjMsgId, adjHealthState);
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
    const HARMFUL = HARMFUL_CONDITIONS;
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
            const dList = getDcList(game, adjMeta2?.playerNum);
            syncHealthStateToList(game, adjMeta2?.playerNum, adjMsgId, adjHealth);
            parts.push('recovered 1 Damage');
          } else {
            parts.push('already at full health');
          }
        }
      }
      const existing = game.figureConditions?.[fk] || [];
      // Disarm permanent Weakened: skip locked Weaken when choosing which condition to discard
      const harmful = existing.find((c) => HARMFUL.includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[fk]));
      if (harmful) {
        filterCondition(game, fk, harmful);
        parts.push(`discarded ${harmful}`);
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
      const conditioned = [];
      for (const fk of targets) {
        if (applyCondition(game, fk, 'Focus')) {
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
    const drew = drawCcCards(game, meta.playerNum, n);
    if (!drew.length) return { applied: false, manualMessage: 'No Command cards left in deck to draw.' };
    return {
      applied: true,
      logMessage: `**Scomp Link** — R2-D2 is adjacent to terminal **${String(adjacentTerminal).toUpperCase()}**. Drew ${drew.length} Command card${drew.length !== 1 ? 's' : ''}.`,
      drewCards: drew,
    };
  }

  // ccEffect: coveringFireEffect — start of round: up to 3 friendly TROOPERs become Hidden;
  // this round, each of your TROOPERs gains Surge: Stun (+2 Damage if target already Stunned).
  if (entry.type === 'ccEffect' && entry.coveringFireEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const dcEffectsMap = getDcEffects() || {};
    // Find all friendly TROOPER figure keys
    const trooperFks = [];
    const friendlyPositions = game.figurePositions?.[playerNum] || {};
    for (const fk of Object.keys(friendlyPositions)) {
      const fkDcName = dcNameFromFigureKey(fk);
      const fkStats = dcEffectsMap[fkDcName];
      if ((fkStats?.keywords || []).some(kw => String(kw).toUpperCase() === 'TROOPER')) {
        trooperFks.push(fk);
      }
    }
    // Apply Hide to up to 3 friendly TROOPERs
    const toHide = trooperFks.slice(0, 3);
    const hiddenNames = [];
    for (const fk of toHide) {
      applyCondition(game, fk, 'Hide');
      hiddenNames.push(dcNameFromFigureKey(fk));
    }
    // Set round-scoped flag: friendly TROOPERs gain Surge: Stun (+2 Damage if already Stunned)
    game.roundTrooperSurgeStun = game.roundTrooperSurgeStun || {};
    game.roundTrooperSurgeStun[playerNum] = true;
    const hideMsg = toHide.length > 0 ? `${hiddenNames.join(', ')} became Hidden. ` : '';
    return { applied: true, logMessage: `**Covering Fire** — ${hideMsg}This round, your TROOPERs gain Surge: Stun (if already Stunned, +2 Damage instead).`, refreshDcEmbed: true };
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
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Hide');
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

  // ccEffect: vpGain (Reactive Loyalties SCUM, I Can Feel It VP option) — award VP to this player
  if (entry.type === 'ccEffect' && typeof entry.vpGain === 'number' && entry.vpGain > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    awardObjectiveVp(game, playerNum, entry.vpGain);
    const vk = vpKey(playerNum);
    return { applied: true, logMessage: `Gained **${entry.vpGain} VP** (total: ${game[vk].total}).` };
  }

  // ccEffect: applyDamageToAttacker (Reactive Loyalties IMPERIAL) — deal N damage to the last attacker
  if (entry.type === 'ccEffect' && typeof entry.applyDamageToAttacker === 'number' && entry.applyDamageToAttacker > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: `Resolve manually: attacker suffers ${entry.applyDamageToAttacker} Damage.` };
    const attMsgId = game.lastAttackAttackerMsgId;
    if (!attMsgId) return { applied: false, manualMessage: `Resolve manually: attacker suffers ${entry.applyDamageToAttacker} Damage (no recent attack stored).` };
    const attHS = dcHealthState.get(attMsgId) || [];
    const attFigIdx = game.lastAttackAttackerFigureIndex ?? 0;
    const attEntry = attHS[attFigIdx];
    if (!attEntry) return { applied: false, manualMessage: `Resolve manually: attacker suffers ${entry.applyDamageToAttacker} Damage.` };
    const [aC, aM] = attEntry;
    const aNew = Math.max(0, (aC ?? aM) - entry.applyDamageToAttacker);
    attHS[attFigIdx] = [aNew, aM ?? aNew];
    dcHealthState.set(attMsgId, attHS);
    const attP = game.lastAttackAttackerPlayerNum ?? opponentPlayerNum(playerNum);
    syncHealthStateToList(game, attP, attMsgId, attHS);
    const attDcName = attDcList?.[attIdx]?.displayName || attMsgId;
    return { applied: true, logMessage: `Attacker (**${attDcName}**) suffers **${entry.applyDamageToAttacker} Damage** (HP: ${aC ?? aM} → ${aNew}).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [attMsgId] };
  }

  // ccEffect: flatDamageToFigureWithin (Collateral Damage) — pick a figure within N of last attack target, deal N damage
  if (entry.type === 'ccEffect' && entry.flatDamageToFigureWithin) {
    const { game, playerNum, dcMessageMeta, dcHealthState, targetFigureKey: chosenTargetFk } = context;
    const { range = 2, damage: flatDmg = 2 } = entry.flatDamageToFigureWithin;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: `Resolve manually: choose a figure within ${range} spaces of the attack target; it suffers ${flatDmg} Damage.` };
    const lastTargetFk = game.lastAttackTargetFigureKey;
    const mapId = game.selectedMap?.id;
    if (!lastTargetFk || !mapId) return { applied: false, manualMessage: `Resolve manually: choose a figure within ${range} spaces of the attack target; it suffers ${flatDmg} Damage.` };
    // Phase 2: apply damage to chosen figure
    if (chosenTargetFk) {
      const cftMsgId = (() => { for (const [mid, m] of dcMessageMeta) { if (m.playerNum !== playerNum) { const ks = getFigureKeysForDcMsg(game, m.playerNum, m); if (ks.includes(chosenTargetFk)) return mid; } } return null; })();
      if (!cftMsgId) return { applied: false, manualMessage: `Resolve manually: could not locate target DC.` };
      const cftHS = dcHealthState.get(cftMsgId) || [];
      const cftMatch = chosenTargetFk.match(/-(\d+)-(\d+)$/);
      const cftIdx = cftMatch ? parseInt(cftMatch[2], 10) : 0;
      const cftEntry = cftHS[cftIdx];
      if (!cftEntry) return { applied: false, manualMessage: `Apply ${flatDmg} Damage to chosen figure manually.` };
      const [cC, cM] = cftEntry;
      const cNew = Math.max(0, (cC ?? cM) - flatDmg);
      cftHS[cftIdx] = [cNew, cM ?? cNew];
      dcHealthState.set(cftMsgId, cftHS);
      const cftP = dcMessageMeta.get(cftMsgId)?.playerNum;
      syncHealthStateToList(game, cftP, cftMsgId, cftHS);
      const cftName = dcNameFromFigureKey(chosenTargetFk);
      return { applied: true, logMessage: `**Collateral Damage** — **${cftName}** suffers **${flatDmg} Damage** (HP: ${cC ?? cM} → ${cNew}).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [cftMsgId] };
    }
    // Phase 1: find all figures (hostile to attacker) within N spaces of last attack target
    const oppNum = opponentPlayerNum(playerNum);
    const lastTargetPos = game.figurePositions?.[oppNum]?.[lastTargetFk];
    if (!lastTargetPos) return { applied: false, manualMessage: `Resolve manually: choose a figure within ${range} spaces of the attack target; it suffers ${flatDmg} Damage.` };
    const boardState = getBoardStateForMovement(game, null);
    const reachable = boardState?.mapSpaces ? getReachableSpaces(lastTargetPos, range, boardState.mapSpaces, []) : [];
    const validSet = new Set([String(lastTargetPos).toLowerCase(), ...reachable.map(s => String(s).toLowerCase())]);
    const targets = [];
    for (const pn of [1, 2]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!validSet.has(String(pos).toLowerCase())) continue;
        const dcName = dcNameFromFigureKey(fk);
        targets.push({ figureKey: fk, playerNum: pn, label: dcName });
      }
    }
    if (targets.length === 0) return { applied: false, manualMessage: `No figures within ${range} spaces of attack target.` };
    if (targets.length === 1) {
      // Auto-apply to single target
      const solo = targets[0];
      const soloMsgId = (() => { for (const [mid, m] of dcMessageMeta) { if (m.playerNum === solo.playerNum) { const ks = getFigureKeysForDcMsg(game, m.playerNum, m); if (ks.includes(solo.figureKey)) return mid; } } return null; })();
      if (soloMsgId) {
        const sHS = dcHealthState.get(soloMsgId) || [];
        const sMatch = solo.figureKey.match(/-(\d+)-(\d+)$/);
        const sIdx = sMatch ? parseInt(sMatch[2], 10) : 0;
        const sEntry = sHS[sIdx];
        if (sEntry) {
          const [sC, sM] = sEntry; const sNew = Math.max(0, (sC ?? sM) - flatDmg);
          sHS[sIdx] = [sNew, sM ?? sNew]; dcHealthState.set(soloMsgId, sHS);
          syncHealthStateToList(game, solo.playerNum, soloMsgId, sHS);
          return { applied: true, logMessage: `**Collateral Damage** — **${solo.label}** suffers **${flatDmg} Damage** (HP: ${sC ?? sM} → ${sNew}).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [soloMsgId] };
        }
      }
    }
    return { applied: false, requiresChoice: true, choiceOptions: targets.map(t => t.label), targetFigureKeys: targets.map(t => t.figureKey) };
  }

  // ccEffect: conditionalFocusIfDamagedGte (Furious Charge) — become Focused if suffered >= N damage from this attack
  if (entry.type === 'ccEffect' && typeof entry.conditionalFocusIfDamagedGte === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: `Become Focused if you suffer ${entry.conditionalFocusIfDamagedGte}+ Damage from this attack (resolve manually).` };
    game.conditionalFocusIfDamagedGte = { playerNum, threshold: entry.conditionalFocusIfDamagedGte };
    return { applied: true, logMessage: `**Furious Charge** — will automatically become Focused if you suffer ${entry.conditionalFocusIfDamagedGte}+ Damage from this attack.` };
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
      logMessage: `Your next attack gains +${entry.nextAttackBonusPierce} Pierce.`,
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
    if (entry.mutualExcludeAttackCc && (cbt.attackCcCount || 0) > 1) {
      return { applied: false, manualMessage: 'Assassinate must be the first Command card played this attack. Another CC was already played.' };
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + entry.attackBonusHits;
    if (entry.mutualExcludeAttackCc) cbt.ccLockedOut = true;
    return {
      applied: true,
      logMessage: `+${entry.attackBonusHits} Hit added to this attack.${entry.mutualExcludeAttackCc ? ' No other CCs may be played during this attack.' : ''}`,
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

  // ccEffect: Arcing Shot — +1 Accuracy AND set arcingShotActive flag for targeting validation
  if (entry.type === 'ccEffect' && entry.arcingShotTargeting) {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play before declaring an attack (as the attacker).' };
    }
    cbt.bonusAccuracy = (cbt.bonusAccuracy || 0) + (entry.attackAccuracyBonus || 0);
    // Set flag so target selection validates adjacent empty space in attacker's LOS
    const msgId = context.msgId || (dcMessageMeta && cbt.attackerMsgId);
    if (msgId) {
      game.arcingShotActive = game.arcingShotActive || {};
      game.arcingShotActive[msgId] = true;
    } else {
      // Fallback: set scalar flag
      game.arcingShotActiveScalar = true;
    }
    return {
      applied: true,
      logMessage: `**Arcing Shot** — +${entry.attackAccuracyBonus || 0} Accuracy. Target must be adjacent to an empty space in attacker's LOS.`,
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
    // Hunter Protocol: set activation-long flag allowing a surge ability to be triggered twice
    if (entry.surgeDoublingActive) {
      game.surgeDoublingActive = game.surgeDoublingActive || {};
      game.surgeDoublingActive[playerNum] = true;
    }
    // Bladestorm: set post-attack AoE flag on combat object
    if (entry.postAttackAoeDamage > 0) {
      cbt.postAttackAoeDamage = entry.postAttackAoeDamage;
      cbt.postAttackAoeRange = entry.postAttackAoeRange || 2;
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
    // Element of Surprise: check target had no LOS to attacker at activation start
    if (entry.requireNoLosAtActivationStart) {
      const atkStartPos = game.activationStartPositions?.[cbt.attackerFigureKey];
      const defCoord = cbt.target?.coord;
      const mapSp = game.selectedMap?.id ? getEffectiveMapSpaces(game, getMapData(game.selectedMap.id)) : null;
      if (atkStartPos && defCoord && mapSp) {
        const targetHadLos = hasLineOfSight(String(defCoord).toLowerCase(), String(atkStartPos).toLowerCase(), mapSp);
        if (targetHadLos) {
          return { applied: false, manualMessage: 'Element of Surprise: target had LOS to you at activation start — card cannot be applied. Override if incorrect.' };
        }
      }
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

  // ccEffect: attackBonusDice (Tools for the Job, Concentrated Fire) — add N dice to attack pool when declaring attack; attacker only
  if (entry.type === 'ccEffect' && typeof entry.attackBonusDice === 'number' && entry.attackBonusDice > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    // requireRangedAttackType gate (Concentrated Fire): die bonus only if a non-attacker
    // friendly TROOPER has Ranged attack type. Card text: "If you have the Ranged attack
    // type" — "you" is the supporting TROOPER playing the CC, so must be both TROOPER and Ranged.
    let dieBlocked = false;
    if (entry.requireRangedAttackType) {
      const dcEffectsMap = getDcEffects() || {};
      const friendlyPositions = game.figurePositions?.[playerNum] || {};
      const attackerKey = cbt.attackerFigureKey;
      const hasRangedTrooperNonAttacker = Object.keys(friendlyPositions).some(fk => {
        if (fk === attackerKey) return false;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkStats = dcEffectsMap[fkDcName];
        const fkKws = (fkStats?.keywords || []).map(k => String(k).toUpperCase());
        return fkStats?.attack?.type === 'range' && fkKws.includes('TROOPER');
      });
      if (!hasRangedTrooperNonAttacker) dieBlocked = true;
    }
    if (!dieBlocked) {
      cbt.attackBonusDice = (cbt.attackBonusDice || 0) + entry.attackBonusDice;
      if (entry.attackBonusDiceColor) {
        cbt.attackBonusDiceColors = cbt.attackBonusDiceColors || [];
        const color = String(entry.attackBonusDiceColor).toLowerCase();
        for (let i = 0; i < entry.attackBonusDice; i++) cbt.attackBonusDiceColors.push(color);
      }
    }
    // applySelfStunAfterAttack (Concentrated Fire): unconditional — stun applies regardless of die gate
    if (entry.applySelfStunAfterAttack) {
      game.applySelfStunAfterAttackPlayerNum = game.applySelfStunAfterAttackPlayerNum || {};
      game.applySelfStunAfterAttackPlayerNum[playerNum] = combat.attackerMsgId || true;
    }
    const dieMsg = dieBlocked
      ? 'No Ranged non-attacker available — die bonus skipped.'
      : `Added ${entry.attackBonusDice} attack die to the attack pool.`;
    return {
      applied: true,
      logMessage: dieMsg + (entry.applySelfStunAfterAttack ? ' You become Stunned after this attack resolves.' : ''),
    };
  }

  // ccEffect: defenseBonusDice (Brace for Impact) — add N dice of color to defense pool; defender only
  if (entry.type === 'ccEffect' && typeof entry.defenseBonusDice === 'number' && entry.defenseBonusDice > 0 && entry.defenseBonusDiceColor) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    const defenderPlayerNum = cbt?.attackerPlayerNum ? opponentPlayerNum(cbt.attackerPlayerNum) : null;
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
    const defenderPlayerNum = cbt?.attackerPlayerNum ? opponentPlayerNum(cbt.attackerPlayerNum) : null;
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
    const defenderPlayerNum = cbt?.attackerPlayerNum ? opponentPlayerNum(cbt.attackerPlayerNum) : null;
    if (!game || !playerNum || !cbt?.target?.figureKey || defenderPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared (as the defender).' };
    }
    const figureKey = cbt.target.figureKey;
    applyCondition(game, figureKey, 'Hide');
    return { applied: true, logMessage: 'Became Hidden.' };
  }

  // ccEffect: roundDefenseBonusBlock / roundDefenseBonusEvade / roundDefenseAccuracyPenalty (Take Position, Survival Instincts, Cavalry Charge, Take Cover, Deflection) — until end of round
  if (entry.type === 'ccEffect' && ((typeof entry.roundDefenseBonusBlock === 'number' && entry.roundDefenseBonusBlock > 0) || (typeof entry.roundDefenseBonusEvade === 'number' && entry.roundDefenseBonusEvade > 0) || (typeof entry.roundDefenseAccuracyPenalty === 'number' && entry.roundDefenseAccuracyPenalty > 0)) && !entry.roundDefenderBonusBlockPerEvade) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundDefenseBonusBlock = game.roundDefenseBonusBlock || {};
    game.roundDefenseBonusEvade = game.roundDefenseBonusEvade || {};
    const block = entry.roundDefenseBonusBlock || 0;
    const evade = entry.roundDefenseBonusEvade || 0;
    if (block) game.roundDefenseBonusBlock[playerNum] = (game.roundDefenseBonusBlock[playerNum] || 0) + block;
    if (evade) game.roundDefenseBonusEvade[playerNum] = (game.roundDefenseBonusEvade[playerNum] || 0) + evade;
    // Accuracy penalty (Take Cover, Deflection) — accumulates additively
    const accPenalty = entry.roundDefenseAccuracyPenalty || 0;
    if (accPenalty) {
      game.roundDefenseAccuracyPenalty = game.roundDefenseAccuracyPenalty || {};
      game.roundDefenseAccuracyPenalty[playerNum] = (game.roundDefenseAccuracyPenalty[playerNum] || 0) + accPenalty;
    }
    const parts = [];
    if (block) parts.push(`+${block} Block`);
    if (evade) parts.push(`+${evade} Evade`);
    if (accPenalty) parts.push(`-${accPenalty} Accuracy`);
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
    // Deflection: after attack resolves, attacker suffers N damage
    if (entry.deflectionCounterDamage) {
      game.deflectionPending = game.deflectionPending || {};
      game.deflectionPending[playerNum] = (game.deflectionPending[playerNum] || 0) + entry.deflectionCounterDamage;
      if (entry.deflectionCounterUnconditional) {
        game.deflectionUnconditional = game.deflectionUnconditional || {};
        game.deflectionUnconditional[playerNum] = true;
      }
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
        for (const fk of figureKeys) {
          grantPowerTokens(game, fk, 'Evade', entry.evadeTokenGain);
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
    const oppNum = opponentPlayerNum(playerNum);
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
      syncHealthStateToList(game, oppNum, targetMsgId, healthState);
      const strainPart2 = strain > 0 ? ` and ${strain} Strain` : '';
      const tName = targetMeta.displayName || targetMeta.dcName || chosenFigureKey;
      return { applied: true, logMessage: `**${tName}** suffered ${damage > 0 ? `${damage} Damage${strainPart2}` : `${strain} Strain`}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [targetMsgId] };
    }
    // First call: grant MP, then find adjacent hostiles and auto-apply or offer choice
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    addMovementPoints(game, msgId, entry.mpBonus);
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
        const figIdx = parseFigureKey(fk).figureIndex;
        const suffix = figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
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
    syncHealthStateToList(game, oppNum, targetMsgId, healthState);
    const strainPart = strain > 0 ? ` and ${strain} Strain` : '';
    return {
      applied: true,
      logMessage: `Gained ${entry.mpBonus} MP. Adjacent hostile suffered ${damage > 0 ? `${damage} Damage${strainPart}` : `${strain} Strain`} (${totalDamage} total).`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
  }

  // ccEffect: lureOfTheDarkSide (Lure of the Dark Side) — G25-G28, C3
  // Choose hostile figure in LOS, give +2 Hit tokens, perform attack with that figure, then 2 Strain.
  // Phase 1: find hostiles in LOS from activating figure, return picker
  // Phase 2: chosen hostile → set up pendingLure for combat delegation (like False Orders)
  if (entry.type === 'ccEffect' && entry.lureOfTheDarkSide) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, hasLineOfSight: losCheck, getMapData: getMs } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    // Find activating figure (the FORCE USER playing this card)
    const activatingMsgId = game.dcActionsData ? Object.keys(game.dcActionsData).find(mid => game.dcActionsData[mid]?.threadId) : null;
    const activatingMeta = activatingMsgId ? dcMessageMeta.get(activatingMsgId) : null;
    const activatingFk = activatingMeta ? `${activatingMeta.dcName}-${(activatingMeta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '0'}-0` : null;
    const activatingPos = activatingFk ? game.figurePositions?.[playerNum]?.[activatingFk] : null;

    if (chosenFigureKey) {
      // Phase 2: Player chose the hostile figure — set up Lure attack delegation
      const hostilePos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      if (!hostilePos) return { applied: false, manualMessage: 'Hostile figure has no position.' };
      // Grant +2 Hit power tokens to the hostile figure
      grantPowerTokens(game, chosenFigureKey, 'Damage', 2);
      // Set up Lure attack (analogous to False Orders)
      game.pendingLure = {
        controllerPlayerNum: playerNum,        // force user's player
        controlledFigureKey: chosenFigureKey,   // hostile being controlled
        controlledPlayerNum: oppNum,            // hostile's owner
        maxRange: 4,                            // target must be within 4 spaces
        postAttackStrain: 2,                    // hostile suffers 2 strain after attack
      };
      return {
        applied: true,
        lureActionPick: true,
        logMessage: `**Lure of the Dark Side** — **${dcNameFromFigureKey(chosenFigureKey)}** gains 2 Damage Tokens. ${dcNameFromFigureKey(activatingFk || '')} will perform an attack with that figure.`,
      };
    }

    // Phase 1: find hostile figures in activating figure's LOS
    if (!activatingPos) return { applied: false, manualMessage: 'Cannot determine activating figure position for LOS check.' };
    const hostilePoses = game.figurePositions?.[oppNum] || {};
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'No map selected.' };
    const mapSpaces = mapId && getMs ? getMs(mapId) : null;
    const candidates = [];
    for (const [fk, pos] of Object.entries(hostilePoses)) {
      // Check LOS from activating figure to hostile
      const inLos = losCheck && mapSpaces ? losCheck(activatingPos, pos, mapSpaces) : true;
      if (inLos) {
        candidates.push({ figureKey: fk, label: dcNameFromFigureKey(fk) });
      }
    }
    if (candidates.length === 0) return { applied: false, manualMessage: 'No hostile figures in line of sight.' };
    if (candidates.length === 1) {
      // Auto-select the only candidate
      return resolveAbility(entry, { ...context, chosenFigureKey: candidates[0].figureKey });
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceLabel: 'Choose a hostile figure in LOS for Lure of the Dark Side:',
      choices: candidates.map(c => c.label),
      choiceValues: candidates.map(c => c.figureKey),
    };
  }

  // ccEffect: Blood Feud — place on hostile DC; persistent +1 Hit when attacking that group
  if (entry.type === 'ccEffect' && entry.bloodFeudEffect) {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring an attack.' };
    }
    // Apply +1 Hit to current attack AND mark the hostile DC for persistent bonus
    cbt.bonusHits = (cbt.bonusHits || 0) + 1;
    const defMsgId = cbt.defenderMsgId;
    if (defMsgId) {
      game.bloodFeudTargets = game.bloodFeudTargets || {};
      game.bloodFeudTargets[defMsgId] = playerNum;
    }
    return { applied: true, logMessage: `**Blood Feud** — +1 Hit this attack. Future attacks on this group also gain +1 Hit.` };
  }

  // ccEffect: Telekinetic Throw — choose hostile within 3 with LOS, roll 2 blue dice, deal Hits as Damage
  if (entry.type === 'ccEffect' && entry.telekineticThrowEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    if (chosenFigureKey) {
      // Phase 2: roll 2 blue dice and apply Hits as damage
      const faces = getDiceData().attack?.blue || [];
      let totalHits = 0;
      const rollParts = [];
      for (let i = 0; i < 2; i++) {
        const face = faces[Math.floor(Math.random() * faces.length)];
        totalHits += face?.dmg ?? 0;
        const p = []; if (face?.dmg) p.push(`${face.dmg} Hit`); if (face?.surge) p.push(`${face.surge} Surge`); if (face?.acc) p.push(`${face.acc} Acc`);
        rollParts.push(p.length ? p.join('/') : 'blank');
      }
      const targetMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      if (targetMsgId && dcHealthState && totalHits > 0) {
        const hs = dcHealthState.get(targetMsgId) || [];
        const fkMatch = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          hs[figIdx] = [Math.max(0, (cur ?? max) - totalHits), max];
          dcHealthState.set(targetMsgId, hs);
          syncHealthStateToList(game, oppNum, targetMsgId, hs);
        }
      }
      return { applied: true, logMessage: `**Telekinetic Throw** — Rolled 2 blue dice: [${rollParts.join('], [')}] → **${totalHits} Damage** to **${dcNameFromFigureKey(chosenFigureKey)}**.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: targetMsgId ? [targetMsgId] : [] };
    }
    // Phase 1: find hostiles within 3 + LOS
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: 'Resolve manually.' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
    if (!activatorPos) return { applied: false, manualMessage: 'Resolve manually: position unknown.' };
    const losCheck = context.hasLineOfSight ?? null;
    const mapId = game.selectedMap?.id;
    const mapSpaces = mapId ? getMapData(mapId) : null;
    const hostiles = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      if (!coord) continue;
      if (countGameSpaces(game, activatorPos, coord) > 3) continue;
      if (losCheck && mapSpaces && !losCheck(activatorPos, coord, mapSpaces)) continue;
      hostiles.push(fk);
    }
    if (hostiles.length === 0) return { applied: true, logMessage: 'No hostile within 3 spaces with LOS.' };
    if (hostiles.length === 1) return resolveAbility(entry, { ...context, chosenFigureKey: hostiles[0] });
    return { applied: false, requiresChoice: true, choiceOptions: figureChoiceLabels(hostiles), choiceValues: hostiles };
  }

  // ccEffect: Chaotic Force — roll 1 green die, all figures on both sides suffer Strain = Accuracy
  if (entry.type === 'ccEffect' && entry.chaoticForceEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const faces = getDiceData().attack?.green || [];
    if (!faces.length) return { applied: false, manualMessage: 'Roll 1 green die manually.' };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const acc = face.acc ?? 0;
    if (acc === 0) return { applied: true, logMessage: '**Chaotic Force** — Rolled 1 green die: **0 Accuracy** — no Strain applied.' };
    const refreshIds = [];
    const parts = [];
    for (const pn of [1, 2]) {
      for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!coord) continue;
        const fMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
        if (!fMsgId) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          hs[figIdx] = [Math.max(0, (cur ?? max) - acc), max];
          dcHealthState.set(fMsgId, hs);
          syncHealthStateToList(game, pn, fMsgId, hs);
          parts.push(`${dcNameFromFigureKey(fk)}: ${cur ?? max}→${Math.max(0, (cur ?? max) - acc)}`);
          if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
        }
      }
    }
    return { applied: true, logMessage: `**Chaotic Force** — Rolled 1 green die: **${acc} Accuracy** → ${acc} Strain to all figures.\n${parts.join(', ')}`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
  }

  // ccEffect: Corrupting Force — roll 1 blue die, all figures on both sides suffer Damage = Hits
  if (entry.type === 'ccEffect' && entry.corruptingForceEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const faces = getDiceData().attack?.blue || [];
    if (!faces.length) return { applied: false, manualMessage: 'Roll 1 blue die manually.' };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const hits = face.dmg ?? 0;
    if (hits === 0) return { applied: true, logMessage: '**Corrupting Force** — Rolled 1 blue die: **0 Hits** — no Damage applied.' };
    const refreshIds = [];
    const parts = [];
    for (const pn of [1, 2]) {
      for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!coord) continue;
        const fMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
        if (!fMsgId) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          hs[figIdx] = [Math.max(0, (cur ?? max) - hits), max];
          dcHealthState.set(fMsgId, hs);
          syncHealthStateToList(game, pn, fMsgId, hs);
          parts.push(`${dcNameFromFigureKey(fk)}: ${cur ?? max}→${Math.max(0, (cur ?? max) - hits)}`);
          if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
        }
      }
    }
    return { applied: true, logMessage: `**Corrupting Force** — Rolled 1 blue die: **${hits} Hit${hits !== 1 ? 's' : ''}** → ${hits} Damage to all figures.\n${parts.join(', ')}`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
  }

  // ccEffect: Balancing Force — roll 1 red die, all damaged friendly figures recover Damage = Hits
  if (entry.type === 'ccEffect' && entry.balancingForceEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const faces = getDiceData().attack?.red || [];
    if (!faces.length) return { applied: false, manualMessage: 'Roll 1 red die manually.' };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const hits = face.dmg ?? 0;
    const healAmt = Math.max(1, hits); // minimum 1 recovery guaranteed
    const refreshIds = [];
    const parts = [];
    // Apply to ALL damaged figures on both sides (card says "each player chooses up to 3" — auto-heal all)
    for (const pn of [1, 2]) {
      for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!coord) continue;
        const fMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
        if (!fMsgId) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          const damage = (max ?? cur) - (cur ?? 0);
          if (damage <= 0) continue;
          const heal = Math.min(healAmt, damage);
          hs[figIdx] = [(cur ?? 0) + heal, max];
          dcHealthState.set(fMsgId, hs);
          syncHealthStateToList(game, pn, fMsgId, hs);
          parts.push(`${dcNameFromFigureKey(fk)}: +${heal} HP`);
          if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
        }
      }
    }
    return { applied: true, logMessage: `**Balancing Force** — Rolled 1 red die: **${hits} Hit${hits !== 1 ? 's' : ''}** → all damaged figures recover ${healAmt} Damage.\n${parts.length ? parts.join(', ') : 'No damaged figures.'}`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
  }

  // ccEffect: Whistling Birds — gain 2 MP, roll 1 red die, all hostiles within 2 suffer Hits as Damage
  if (entry.type === 'ccEffect' && entry.whistlingBirdsEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    // Grant 2 MP
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (msgId) addMovementPoints(game, msgId, 2);
    // Roll 1 red die
    const faces = getDiceData().attack?.red || [];
    if (!faces.length) return { applied: true, logMessage: 'Gained 2 MP. Roll 1 red die manually for Whistling Birds.' };
    const face = faces[Math.floor(Math.random() * faces.length)];
    const hits = face.dmg ?? 0;
    if (hits === 0) return { applied: true, logMessage: '**Whistling Birds** — Gained 2 MP. Rolled 1 red die: **0 Hits** — no Damage applied.', refreshMovementBank: true };
    // Apply to all hostiles within 2 spaces (up to 3)
    const oppNum = opponentPlayerNum(playerNum);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
    const refreshIds = [];
    const parts = [];
    let count = 0;
    if (activatorPos && dcHealthState) {
      for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!coord || count >= 3) continue;
        if (countGameSpaces(game, activatorPos, coord) > 2) continue;
        const fMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
        if (!fMsgId) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const hp = hs[figIdx];
        if (hp) {
          const [cur, max] = hp;
          hs[figIdx] = [Math.max(0, (cur ?? max) - hits), max];
          dcHealthState.set(fMsgId, hs);
          syncHealthStateToList(game, oppNum, fMsgId, hs);
          parts.push(`${dcNameFromFigureKey(fk)}: ${hits} Dmg`);
          if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
          count++;
        }
      }
    }
    return { applied: true, logMessage: `**Whistling Birds** — Gained 2 MP. Rolled 1 red die: **${hits} Hit${hits !== 1 ? 's' : ''}** → ${parts.length ? parts.join(', ') : 'no hostiles within 2 spaces'}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshMovementBank: true };
  }

  // ccEffect: Second Chance — place on DC as attachment; triggers defeat prevention + EOR recovery
  if (entry.type === 'ccEffect' && entry.secondChanceEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Store Second Chance on this DC for defeat prevention
    game.secondChanceDcMsgId = game.secondChanceDcMsgId || {};
    game.secondChanceDcMsgId[msgId] = playerNum;
    return { applied: true, logMessage: `**Second Chance** placed on this DC. Will trigger: recover 2 Damage before defeat, or at end of round.` };
  }

  // ccEffect: Self-Augmentation — attachment: DROID trait + reroll 1 attack die (scoped to attached DC)
  if (entry.type === 'ccEffect' && entry.selfAugmentationEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Store reroll bonus scoped to the specific DC (not the whole player)
    game.selfAugmentationMsgId = game.selfAugmentationMsgId || {};
    game.selfAugmentationMsgId[msgId] = true;
    // DROID trait injection happens via getDcKeywords in data-loader.js (already implemented)
    return { applied: true, logMessage: `**Self-Augmentation** — Attached. Gained DROID trait + may reroll 1 attack die while attacking.` };
  }

  // ccEffect: wookieeRageEffect — Special Action: choose up to 3 adjacent hostiles; each suffers 1 Damage per
  // Damage you've suffered (max 3). Multi-target with scaling damage based on activating figure's health loss.
  // Uses multi-choice flow: first call enumerates adjacent hostiles; subsequent calls accumulate chosen targets
  // until 3 are chosen or player clicks "Done"; then applies damage to all chosen targets at once.
  if (entry.type === 'ccEffect' && entry.wookieeRageEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!selfMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Calculate damage suffered by activating figure (max - current, summed across group figures)
    const selfHs = dcHealthState?.get(selfMsgId) || [];
    const selectedFig = game.dcActionsData?.[selfMsgId]?.selectedFigure ?? 0;
    const selfEntry = selfHs[selectedFig];
    const damageSuffered = selfEntry ? Math.max(0, (selfEntry[1] ?? 0) - (selfEntry[0] ?? selfEntry[1] ?? 0)) : 0;
    const damagePerTarget = Math.min(3, damageSuffered);
    // "Done" signal: apply accumulated targets
    if (chosenFigureKey === 'wookiee_rage_done') {
      const targets = game._wookieeRageTargets || [];
      if (targets.length === 0) return { applied: true, logMessage: '**Wookiee Rage** — No targets chosen.' };
      const refreshIds = [];
      const hitParts = [];
      for (const fk of targets) {
        if (damagePerTarget > 0 && dcHealthState) {
          const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
          if (tMsgId) {
            const tHs = dcHealthState.get(tMsgId) || [];
            const fkMatch = fk.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const tEntry = tHs[figIdx];
            if (tEntry) {
              const [cur, max] = tEntry;
              const newCur = Math.max(0, (cur ?? max) - damagePerTarget);
              tHs[figIdx] = [newCur, max];
              dcHealthState.set(tMsgId, tHs);
              syncHealthStateToList(game, oppNum, tMsgId, tHs);
              hitParts.push(`**${dcNameFromFigureKey(fk)}** ${cur ?? max} → ${newCur}`);
              if (!refreshIds.includes(tMsgId)) refreshIds.push(tMsgId);
            }
          }
        }
      }
      delete game._wookieeRageTargets;
      return { applied: true, logMessage: `**Wookiee Rage** — ${damagePerTarget} Damage to each: ${hitParts.join(', ')}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
    }
    // Accumulate a chosen target
    if (chosenFigureKey) {
      game._wookieeRageTargets = game._wookieeRageTargets || [];
      if (!game._wookieeRageTargets.includes(chosenFigureKey)) {
        game._wookieeRageTargets.push(chosenFigureKey);
      }
      // If 3 targets chosen, auto-finalize
      if (game._wookieeRageTargets.length >= 3) {
        return resolveAbility(abilityId, { ...context, chosenFigureKey: 'wookiee_rage_done' });
      }
      // Otherwise, show remaining choices (re-enumerate minus already chosen)
      const alreadyChosen = new Set(game._wookieeRageTargets);
      const selfMeta = dcMessageMeta.get(selfMsgId);
      const selfKeys = selfMeta ? getFigureKeysForDcMsg(game, playerNum, selfMeta) : [];
      const selfFk = selfKeys[selectedFig] || selfKeys[0];
      const selfPos = selfFk ? game.figurePositions?.[playerNum]?.[selfFk] : null;
      const choiceValues = [];
      if (selfPos) {
        const oppPositions = game.figurePositions?.[oppNum] || {};
        for (const [fk, coord] of Object.entries(oppPositions)) {
          if (!coord || alreadyChosen.has(fk)) continue;
          const dist = countGameSpaces(game, selfPos, coord);
          if (dist <= 1) choiceValues.push(fk);
        }
      }
      if (choiceValues.length === 0) {
        // No more adjacent hostiles — finalize
        return resolveAbility(abilityId, { ...context, chosenFigureKey: 'wookiee_rage_done' });
      }
      const choiceOptions = [...figureChoiceLabels(choiceValues)];
      choiceOptions.push(`Done (${game._wookieeRageTargets.length} target${game._wookieeRageTargets.length > 1 ? 's' : ''} chosen)`);
      choiceValues.push('wookiee_rage_done');
      return { applied: true, requiresChoice: true, choiceOptions, choiceValues, logMessage: `**Wookiee Rage** — ${damagePerTarget} Damage per target (${damageSuffered} Damage suffered). Choose another target or Done.` };
    }
    // First call: enumerate adjacent hostiles
    if (damagePerTarget === 0) return { applied: true, logMessage: '**Wookiee Rage** — 0 Damage suffered; no damage dealt.' };
    game._wookieeRageTargets = [];
    const selfMeta = dcMessageMeta.get(selfMsgId);
    const selfKeys = selfMeta ? getFigureKeysForDcMsg(game, playerNum, selfMeta) : [];
    const selfFk = selfKeys[selectedFig] || selfKeys[0];
    const selfPos = selfFk ? game.figurePositions?.[playerNum]?.[selfFk] : null;
    const choiceValues = [];
    if (selfPos) {
      const oppPositions = game.figurePositions?.[oppNum] || {};
      for (const [fk, coord] of Object.entries(oppPositions)) {
        if (!coord) continue;
        const dist = countGameSpaces(game, selfPos, coord);
        if (dist <= 1) choiceValues.push(fk);
      }
    }
    if (choiceValues.length === 0) return { applied: false, manualMessage: '**Wookiee Rage** — No adjacent hostile figures.' };
    if (choiceValues.length === 1) {
      // Only 1 adjacent hostile — auto-choose and finalize
      game._wookieeRageTargets.push(choiceValues[0]);
      return resolveAbility(abilityId, { ...context, chosenFigureKey: 'wookiee_rage_done' });
    }
    const choiceOptions = [...figureChoiceLabels(choiceValues)];
    choiceOptions.push('Done (0 targets chosen)');
    choiceValues.push('wookiee_rage_done');
    return { applied: true, requiresChoice: true, choiceOptions, choiceValues, logMessage: `**Wookiee Rage** — ${damagePerTarget} Damage per target (${damageSuffered} Damage suffered). Choose up to 3 adjacent hostiles.` };
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
    const strain = scaleStrainToRound ? (game.currentRound || 1) : (cah.strain || 0);
    const totalDamage = damage + strain;
    const targetConditions = [
      ...(cah.weaken ? ['Weaken'] : []),
      ...(cah.stun ? ['Stun'] : []),
      ...(cah.bleed ? ['Bleed'] : []),
    ];
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
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
      syncHealthStateToList(game, oppNum, targetMsgId, healthState);
      // Apply conditions to target
      if (targetConditions.length > 0) {
        for (const c of targetConditions) applyCondition(game, targetFk, c);
      }
      // Disarm: lock the Weakened condition so it cannot be removed until end of round
      if (abilityId === 'Disarm' && targetConditions.includes('Weaken')) {
        game.disarmPermanentWeakened = game.disarmPermanentWeakened || {};
        game.disarmPermanentWeakened[targetFk] = true;
      }
      // Disorient: discard one beneficial condition from target
      if (cah.discardBeneficialCondition) {
        const BENEFICIAL = ['Focus', 'Hidden'];
        const targetConds = game.figureConditions?.[targetFk] || [];
        const toDiscard = targetConds.find(c => BENEFICIAL.includes(c));
        if (toDiscard) filterCondition(game, targetFk, toDiscard);
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
        if (isConditionImmune(game, actualFk)) {
          return { applied: true, logMessage: `**${tName}** is immune to harmful conditions — Stun skipped.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: tMsgId ? [tMsgId] : [] };
        }
        applyCondition(game, actualFk, 'Stun');
        return { applied: true, logMessage: `**${tName}** becomes Stunned.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: tMsgId ? [tMsgId] : [] };
      }
      const strainKey = typeof chosenFigureKey === 'string' && chosenFigureKey.startsWith('strain:') ? chosenFigureKey.slice(7) : chosenFigureKey;
      const mainResult = applyToFigureKey(strainKey);
      // Splash: apply cah.splashDamage / cah.splashConditions to figures adjacent to the chosen target
      const splashDmg = cah.splashDamage ?? 0;
      const splashConds = cah.splashConditions ?? [];
      if ((splashDmg > 0 || splashConds.length > 0) && mainResult.applied) {
        const mapId = game.selectedMap?.id;
        if (mapId) {
          const adjacent = getFiguresAdjacentToTarget(game, strainKey, mapId);
          const splashParts = [];
          for (const { figureKey: adjFk, playerNum: adjPnum } of adjacent) {
            const adjMsgId = findMsgIdForFigureKey(game, adjPnum, adjFk, dcMessageMeta);
            const adjName = dcNameFromFigureKey(adjFk);
            if (splashDmg > 0 && dcHealthState && adjMsgId) {
              const adjHs = (dcHealthState.get(adjMsgId) || []).slice();
              const adjMatch = adjFk.match(/-(\d+)-(\d+)$/);
              const adjFi = adjMatch ? parseInt(adjMatch[2], 10) : 0;
              const adjE = adjHs[adjFi];
              if (adjE) {
                const [aCur, aMax] = adjE;
                const aNew = Math.max(0, (aCur ?? aMax) - splashDmg);
                adjHs[adjFi] = [aNew, aMax ?? aNew];
                dcHealthState.set(adjMsgId, adjHs);
                syncHealthStateToList(game, adjPnum, adjMsgId, adjHs);
                splashParts.push(`**${adjName}** ${splashDmg} Damage (${aCur ?? aMax}→${aNew})`);
              }
            } else if (splashDmg > 0) {
              splashParts.push(`**${adjName}** (apply ${splashDmg} Damage manually)`);
            }
            if (splashConds.length > 0) {
              for (const c of splashConds) applyCondition(game, adjFk, c);
            }
          }
          if (splashParts.length > 0 && mainResult.logMessage) {
            mainResult.logMessage += `\nSplash — ${splashParts.join('; ')}`;
          }
          if (mainResult.refreshDcEmbedMsgIds) {
            // also refresh any adjacent DC embeds
            for (const { figureKey: adjFk, playerNum: adjPnum } of adjacent) {
              const adjMsgId = findMsgIdForFigureKey(game, adjPnum, adjFk, dcMessageMeta);
              if (adjMsgId && !mainResult.refreshDcEmbedMsgIds.includes(adjMsgId)) mainResult.refreshDcEmbedMsgIds.push(adjMsgId);
            }
          }
        }
      }
      return mainResult;
    }
    // First pass: find valid hostile targets (adjacent, or range+LOS if specified)
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const cahRange = cah.range ?? 1;
    const cahLos = cah.requiresLos ?? false;
    const cahAll = cah.targetAll ?? false;
    const losCheck = context.hasLineOfSight ?? null;
    const mapSpacesForLos = cahLos ? getMapData(mapId) : null;
    // Activator position for range/LOS checks
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
    const hostileSet = new Set();
    if (cahRange <= 1) {
      // Original path: adjacent figures via adjacency graph
      for (const fk of activatingKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p === oppNum) hostileSet.add(figureKey);
        }
      }
    } else {
      // Extended path: range + optional LOS filter
      for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!coord) continue;
        if (activatorPos && countGameSpaces(game, activatorPos, coord) > cahRange) continue;
        if (cahLos && losCheck && activatorPos && mapSpacesForLos) {
          if (!losCheck(activatorPos, coord, mapSpacesForLos)) continue;
        }
        hostileSet.add(fk);
      }
    }
    let hostiles = [...hostileSet];
    // Disorient: filter to hostiles with a beneficial condition (Focus or Hidden)
    if (cah.requireBeneficialCondition) {
      const BENEFICIAL = ['Focus', 'Hidden'];
      hostiles = hostiles.filter(fk => {
        const conds = game.figureConditions?.[fk] || [];
        return conds.some(c => BENEFICIAL.includes(c));
      });
    }
    if (hostiles.length === 0) return { applied: true, logMessage: 'No valid hostile figure in range.' };
    // Helper to get a display label for a figure key
    const getFigLabel = (fk) => {
      const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
      const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
      const baseName = tMeta?.displayName || tMeta?.dcName || fk;
      const figIdx = parseFigureKey(fk).figureIndex;
      const suffix = figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
      return `${baseName}${suffix}`;
    };
    // targetAll: apply to every matching figure at once (no picker)
    if (cahAll) {
      const allMsgIds = [];
      const allParts = [];
      for (const fk of hostiles) {
        const r = applyToFigureKey(fk);
        if (r.logMessage) allParts.push(r.logMessage);
        if (r.refreshDcEmbedMsgIds) for (const id of r.refreshDcEmbedMsgIds) { if (!allMsgIds.includes(id)) allMsgIds.push(id); }
      }
      return { applied: true, logMessage: allParts.join(' ') || 'Effect applied to all hostiles in range.', refreshDcEmbed: true, refreshDcEmbedMsgIds: allMsgIds };
    }
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
    // Multiple hostiles in range: prompt player to pick one
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
    const totalToAdd = Math.min(entry.powerTokenGainToGroup, figureKeys.reduce((sum, fk) => sum + getMaxPowerTokens(fk), 0));
    game.figurePowerTokens = game.figurePowerTokens || {};
    const grants = [];
    let remaining = totalToAdd;
    for (const fk of figureKeys) {
      if (remaining <= 0) break;
      const current = (game.figurePowerTokens[fk] || []).length;
      const cap = getMaxPowerTokens(fk) - current;
      const toAdd = Math.min(remaining, Math.max(0, cap));
      if (toAdd > 0) grants.push({ figureKey: fk, figName: fk, count: toAdd });
      remaining -= toAdd;
    }
    if (grants.length > 0) {
      game.pendingPowerTokenGrant = { grants, channelId: null, playerNum };
    }
    return { applied: true, requiresPowerTokenChoice: grants.length > 0, logMessage: `Distributed ${totalToAdd} Power Token(s) among figures in your group — choose type.` };
  }

  // ccEffect: damageTokenGainToGroup (Ready Weapons) — distribute N Damage tokens among figures in activating group (auto-assign, no type choice)
  if (entry.type === 'ccEffect' && typeof entry.damageTokenGainToGroup === 'number' && entry.damageTokenGainToGroup > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress (play as Special Action during your activation).' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures in group.' };
    game.figurePowerTokens = game.figurePowerTokens || {};
    let remaining = entry.damageTokenGainToGroup;
    let totalAdded = 0;
    const parts = [];
    for (const fk of figureKeys) {
      if (remaining <= 0) break;
      const current = (game.figurePowerTokens[fk] || []).filter(t => t === 'Damage').length;
      const cap = getMaxPowerTokens(fk) - (game.figurePowerTokens[fk] || []).length;
      const toAdd = Math.min(remaining, Math.max(0, cap));
      if (toAdd > 0) {
        grantPowerTokens(game, fk, 'Damage', toAdd);
        totalAdded += toAdd;
        parts.push(`${dcNameFromFigureKey(fk)} +${toAdd}`);
      }
      remaining -= toAdd;
    }
    return { applied: true, logMessage: `Distributed ${totalAdded} Damage Token(s): ${parts.join(', ')}.`, refreshDcEmbed: true };
  }

  // ccEffect: claimInitiative only (I Make My Own Luck) — optional firstActivationFigureName
  if (entry.type === 'ccEffect' && entry.claimInitiative && !entry.exhaustOneDeploymentCard) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.initiativePlayerId = getPlayerId(game, playerNum);
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
    game.initiativePlayerId = getPlayerId(game, playerNum);
    return {
      applied: true,
      logMessage: 'Claimed the initiative token. Exhaust one of your Deployment cards (use the Exhaust button on your DC).',
    };
  }

  // ccEffect: discardRandomFromHand + opponentDiscardRandomFromHand (Hostile Negotiation)
  if (entry.type === 'ccEffect' && typeof entry.discardRandomFromHand === 'number' && typeof entry.opponentDiscardRandomFromHand === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const handKey = ccHandKey(playerNum);
    const discardKey = ccDiscardKey(playerNum);
    const oppNum = opponentPlayerNum(playerNum);
    const oppHandKey = ccHandKey(oppNum);
    const oppDiscardKey = ccDiscardKey(oppNum);
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
    const oppNum = opponentPlayerNum(playerNum);
    const oppHandKey = ccHandKey(oppNum);
    const oppDiscardKey = ccDiscardKey(oppNum);
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
      // Build choice list from friendly DCs (player picks an adjacent one)
      const dcList = getDcList(game, playerNum) || [];
      const opts = dcList
        .filter((dc) => dc && !dc.defeated)
        .map((dc) => (typeof dc === 'object' ? dc.displayName || dc.dcName : dc))
        .filter(Boolean);
      if (opts.length === 0) return { applied: false, manualMessage: 'No friendly Deployment cards to ready. Resolve manually.' };
      return { applied: false, requiresChoice: true, choiceOptions: opts };
    }
    const dcList = getDcList(game, playerNum) || [];
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
    const dcList = getDcList(game, playerNum) || [];
    const dcMessageIds = getDcMessageIds(game, playerNum) || [];
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
    if (game.restInPeaceActive) return { applied: false, manualMessage: '**Rest in Peace** is active — players cannot retrieve Command cards from discard piles this round.' };
    const discardKey = ccDiscardKey(playerNum);
    const deckKey = ccDeckKey(playerNum);
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
    const oppNum = opponentPlayerNum(playerNum);
    const deckKey = ccDeckKey(oppNum);
    const discardKey = ccDiscardKey(oppNum);
    const deck = (game[deckKey] || []).slice();
    if (entry.elseGainVp != null) {
      // Merciless: opponent may discard 2 from deck; if not (or deck has < 2), you gain 3 VP
      if (deck.length >= entry.opponentDiscardDeckTop) {
        const n = entry.opponentDiscardDeckTop;
        const removed = deck.splice(0, n);
        game[deckKey] = deck;
        game[discardKey] = (game[discardKey] || []).concat(removed);
        // CC Passive Redraw: deck-discard trigger (Built on Hope)
        const _prRedrawn = [];
        for (const _prCard of removed) {
          const _prResult = checkDeckDiscardPassiveRedraws(game, oppNum, _prCard);
          _prRedrawn.push(..._prResult.redrawn);
        }
        const _prMsg = _prRedrawn.length > 0
          ? ` Passive Redraw: ${_prRedrawn.map(c => `**${c}**`).join(', ')} re-drawn from discard (discarded from deck).`
          : '';
        return {
          applied: true,
          logMessage: `Opponent discarded top ${n} card(s) of their Command deck.${_prMsg}`,
          refreshOpponentDiscard: true,
        };
      }
      const vk = vpKey(playerNum);
      game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
      game[vk].total = (game[vk].total ?? 0) + entry.elseGainVp;
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
    // CC Passive Redraw: deck-discard trigger (Built on Hope)
    const _stmRedrawn = [];
    for (const _stmCard of removed) {
      const _stmResult = checkDeckDiscardPassiveRedraws(game, oppNum, _stmCard);
      _stmRedrawn.push(..._stmResult.redrawn);
    }
    const _stmMsg = _stmRedrawn.length > 0
      ? ` Passive Redraw: ${_stmRedrawn.map(c => `**${c}**`).join(', ')} re-drawn from discard (discarded from deck).`
      : '';
    return {
      applied: true,
      logMessage: `Defender was defeated. Opponent discarded top ${n} card(s) of their Command deck.${_stmMsg}`,
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
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total ?? 0) + entry.celebrationVp;
    const costKey = armyCostModifierKey(playerNum);
    game[costKey] = (game[costKey] || 0) + entry.increaseArmyCostBy;
    return {
      applied: true,
      logMessage: `Defender defeated. Gained ${entry.celebrationVp} VP and increased your figure cost by ${entry.increaseArmyCostBy}.`,
    };
  }

  // ccEffect: celebrationVp only (Celebration) — gain N VP after a unique hostile is defeated (no armyCost modifier)
  if (entry.type === 'ccEffect' && typeof entry.celebrationVp === 'number' && !entry.increaseArmyCostBy) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Validate: at least one hostile was defeated this activation
    const killCounts = game.activationKills || {};
    const totalKills = Object.values(killCounts).reduce((sum, n) => sum + (n || 0), 0);
    if (totalKills < 1) {
      return { applied: false, manualMessage: 'Celebration: No unique hostile defeated this activation.' };
    }
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total ?? 0) + entry.celebrationVp;
    return {
      applied: true,
      logMessage: `**Celebration** — Gained ${entry.celebrationVp} VP (a unique hostile was defeated this activation).`,
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

  // ccEffect: elusiveEffect (Elusive) — while defending, choose 1 attack die to nullify results, then 1 defense die is also nullified
  if (entry.type === 'ccEffect' && entry.elusiveEffect) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: while defending, choose 1 attack die and remove its results, then remove 1 defense die results.' };
    cbt.elusiveActive = true;
    return { applied: true, logMessage: 'Elusive — After rerolls, choose 1 attack die to nullify. 1 defense die will also be nullified.' };
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
    const oppNum = opponentPlayerNum(playerNum);
    if (!chosenFigureKey) {
      // Build choice list from opponent DCs (player picks an adjacent hostile DC)
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
    let stunned = 0;
    let skipped = 0;
    for (const fk of figureKeys.slice(0, entry.applyStunToUpToNAdjacentHostiles)) {
      if (isConditionImmune(game, fk)) { skipped++; continue; }
      applyCondition(game, fk, 'Stun');
      stunned++;
    }
    const label = targetMeta.displayName || targetMeta.dcName || 'hostile figure(s)';
    const immuneNote = skipped > 0 ? ` (${skipped} immune)` : '';
    return {
      applied: true,
      logMessage: `**${label}** — ${stunned} figure(s) became Stunned.${immuneNote}`,
    };
  }

  // ccEffect: pushFriendlyWithin3Spaces (Reposition) — pick a SMALL friendly figure, then pick landing space
  // Phase 1 (no targetFigureKey): enumerate valid SMALL friendly figures → requiresChoice.
  // Phase 2 (targetFigureKey set, no chosenSpace): enumerate valid landing spaces → requiresSpaceChoice.
  // Phase 3 (targetFigureKey + chosenSpace set): apply position update.
  if (entry.type === 'ccEffect' && typeof entry.pushFriendlyWithin3Spaces === 'number' && entry.pushFriendlyWithin3Spaces > 0) {
    const pushDist = entry.pushFriendlyWithin3Spaces;
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace, getRange: getRng, getMapData: getMs } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const targetFigureKey = chosenFigureKey;

    // Phase 3: apply push
    if (targetFigureKey && chosenSpace) {
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[playerNum] = game.figurePositions[playerNum] || {};
      const { prevPos } = pushFigure(game, playerNum, targetFigureKey, chosenSpace) || { prevPos: null };
      const targetName = dcNameFromFigureKey(targetFigureKey);
      const { pathStr: _rpPathStr, warnings: _rpWarnings } = computePushPathAndWarnings(game, prevPos, chosenSpace, playerNum);
      let _rpLogMsg = `**Reposition** — pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} to ${String(chosenSpace).toUpperCase()}${_rpPathStr}.`;
      if (_rpWarnings.length > 0) {
        const _warnList = _rpWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _rpLogMsg += `\n⚠️ Exits adjacency to: ${_warnList} — opponent may play interrupts.`;
      }
      return { applied: true, logMessage: _rpLogMsg, refreshBoard: true };
    }

    // Phase 2: figure chosen — enumerate valid landing spaces (up to N spaces away)
    if (targetFigureKey && !chosenSpace) {
      const targetPos = game.figurePositions?.[playerNum]?.[targetFigureKey];
      if (!targetPos) return { applied: false, manualMessage: 'Reposition — target has no position.' };
      const mapSpaces = getMs ? getMs(game.selectedMap?.id) : null;
      if (!mapSpaces) return { applied: false, manualMessage: 'Reposition — map data unavailable. Resolve manually.' };
      const occupiedSet = new Set([
        ...Object.values(game.figurePositions?.[1] || {}),
        ...Object.values(game.figurePositions?.[2] || {}),
      ].filter(Boolean));
      occupiedSet.delete(targetPos);
      const validSpaces = [];
      const _allCoords = mapSpaces.spaces || Object.keys(mapSpaces.adjacency || {});
      for (const coord of _allCoords) {
        if (occupiedSet.has(coord)) continue;
        if (countGameSpaces(game, targetPos, coord) > pushDist) continue;
        validSpaces.push(coord);
      }
      if (validSpaces.length === 0) return { applied: false, manualMessage: 'Reposition — no valid landing spaces.' };
      return { applied: false, requiresSpaceChoice: true, validSpaces, chosenFigureKey: targetFigureKey, spaceChoiceLabel: `**Reposition** — Pick a landing space for **${dcNameFromFigureKey(targetFigureKey)}** (up to ${pushDist} spaces):` };
    }

    // Phase 1: enumerate valid SMALL friendly figures
    const dcEffects = getDcEffects() || {};
    const validTargets = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!coord) continue;
      const dcN = dcNameFromFigureKey(fk);
      const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('LARGE') || kws.includes('MASSIVE')) continue; // SMALL only
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: 'No SMALL friendly figures to push.' };
    const choiceOptions = figureChoiceLabels(validTargets);
    return { applied: false, requiresChoice: true, choiceOptions, choiceValues: validTargets };
  }

  // ccEffect: opponentHandRandomToDeckTop (Stall for Time)
  if (entry.type === 'ccEffect' && typeof entry.opponentHandRandomToDeckTop === 'number' && entry.opponentHandRandomToDeckTop > 0) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const handKey = ccHandKey(oppNum);
    const deckKey = ccDeckKey(oppNum);
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
    // Grant 1 extra action
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData && typeof actionsData.remaining === 'number') {
      actionsData.remaining = Math.min(actionsData.total ?? 2, actionsData.remaining + 1);
    }
    game.activationExtraActionThenStun = game.activationExtraActionThenStun || {};
    game.activationExtraActionThenStun[msgId] = true;
    // Determine the activating figure key for immunity check
    const meta = dcMessageMeta.get(msgId);
    const figureKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const figureKey = figureKeys[selectedFig] || figureKeys[0];
    // C76: Check harmful condition immunity before applying Stun
    if (figureKey && isConditionImmune(game, figureKey)) {
      return { applied: true, logMessage: 'Perform 1 additional action. Figure is immune to HARMFUL conditions — Stun skipped.', refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId] };
    }
    // Apply Stun
    if (figureKey) {
      applyCondition(game, figureKey, 'Stun');
    }
    return { applied: true, logMessage: 'Perform 1 additional action; then you become Stunned.', refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], conditionCardsToPost: ['Stun'] };
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
    const oppNum = opponentPlayerNum(playerNum);
    const yourVpKey = vpKey(playerNum);
    const oppVpKey = vpKey(oppNum);
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
    // Find the just-activated group's base deployment cost
    const sinDcList = getDcList(game, playerNum) || [];
    const sinActivated = game[activatedDcIndicesKey(playerNum)] || [];
    let sinTriggerCost = 0;
    let sinTriggerName = '';
    if (sinActivated.length > 0) {
      const lastIdx = sinActivated[sinActivated.length - 1];
      const lastDc = sinDcList[lastIdx];
      if (lastDc) {
        const stats = getStatsForDc(lastDc.dcName);
        sinTriggerCost = stats?.cost ?? 0;
        sinTriggerName = lastDc.displayName || lastDc.dcName;
      }
    }
    game.strengthInNumbersPlayerNum = playerNum;
    game.strengthInNumbersData = { playerNum, triggeringGroupCost: sinTriggerCost, triggeringGroupName: sinTriggerName };
    return { applied: true, logMessage: `You may immediately activate another group (combined deployment cost of the two groups cannot exceed 12). Triggering group: **${sinTriggerName}** (cost ${sinTriggerCost}).` };
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

  // ccEffect: rebelGraffitiVp (Rebel Graffiti) — end of activation: gain 2 VP only if no adjacent hostile figures
  if (entry.type === 'ccEffect' && typeof entry.rebelGraffitiVp === 'number' && entry.rebelGraffitiVp > 0) {
    const { game, playerNum, dcMessageMeta, meta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Validate: activating figure must not have any adjacent hostile figures
    const oppNum = opponentPlayerNum(playerNum);
    const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const activatingPositions = activatingKeys.map((k) => game.figurePositions?.[playerNum]?.[k]).filter(Boolean);
    if (activatingPositions.length > 0) {
      const hostilePositions = Object.values(game.figurePositions?.[oppNum] || {}).filter(Boolean);
      const hasAdjacentHostile = activatingPositions.some((aPos) =>
        hostilePositions.some((hPos) => countGameSpaces(game, String(aPos).toLowerCase(), String(hPos).toLowerCase()) <= 1)
      );
      if (hasAdjacentHostile) {
        return { applied: false, manualMessage: 'Rebel Graffiti: Cannot gain VP — there are adjacent hostile figures.' };
      }
    }
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total ?? 0) + entry.rebelGraffitiVp;
    return { applied: true, logMessage: `Gained ${entry.rebelGraffitiVp} VP (end of activation; no adjacent hostiles verified).` };
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
    const deckKey = ccDeckKey(targetNum);
    const handKey = ccHandKey(targetNum);
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
        for (const fk of figKeys) {
          grantPowerTokens(game, fk, 'Block', 1);
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
    for (const fk of qualified) {
      grantPowerTokens(game, fk, 'Block', 1);
      applyCondition(game, fk, 'Hide');
    }
    if (qualified.length === 0) return { applied: true, logMessage: `**Guerilla Warfare** — No isolated friendly figures (all have adjacent friendlies).` };
    const names = qualified.map((fk) => dcNameFromFigureKey(fk)).join(', ');
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

  // ccEffect: deployGarrisonEffect (Deploy the Garrison) — each friendly Trooper/Guardian within 4 gains 2 MP or 1 Damage Token (choice)
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
      const dcName = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcName] || dcEffects[dcName.replace(/\s*\[.*\]\s*$/, '')] || {};
      const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes('TROOPER') && !kws.includes('GUARDIAN')) continue;
      if (countGameSpaces(game, selfPos, pos) > 4) continue;
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
      // Phase 1: ask player to choose MP or Damage Token
      return {
        requiresChoice: true,
        choiceOptions: [`2 Movement Points to each (${qualifyingNames.join(', ')})`, `1 Damage Token to each (${qualifyingNames.join(', ')})`],
      };
    }

    // Phase 2: apply chosen effect to all qualifying figures
    const grantMp = choiceIndex === 0;
    const results = [];
    for (let i = 0; i < qualifyingMsgIds.length; i++) {
      const mid = qualifyingMsgIds[i];
      const nm = qualifyingNames[i];
      if (grantMp) {
        addMovementPoints(game, mid, 2);
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
            grantPowerTokens(game, fkForMid, 'Damage', 1);
            results.push(`**${nm}** +Damage Token`);
          }
        }
      }
    }
    const effectLabel = grantMp ? '2 MP each' : '1 Damage Token each';
    return {
      applied: true,
      logMessage: `**Deploy the Garrison** — Granted ${effectLabel}: ${results.join(', ')}.`,
      refreshMovementBank: grantMp,
    };
  }

  // ccEffect: grantHitTokensToActivating (Transmit the Plans) — grant N Damage Tokens to activating figure
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
    grantPowerTokens(game, fk, 'Damage', count);
    const vpNote = entry.vpNoteIfAdjacentTerminal ? ` If adjacent to a terminal, use \`/editvp +${entry.vpNoteIfAdjacentTerminal}\` to gain ${entry.vpNoteIfAdjacentTerminal} VP.` : '';
    return { applied: true, logMessage: `**${entry.label}** — Granted **${count} Damage Token${count !== 1 ? 's' : ''}** to ${meta.dcName}.${vpNote}` };
  }

  // ccEffect: protectOldWaysBonus (Protect the Old Ways) — +X Block this round (X = 1 + FORCE USER CCs in discard)
  if (entry.type === 'ccEffect' && entry.protectOldWaysBonus) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const discardKey = ccDiscardKey(playerNum);
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
    const oppNum = opponentPlayerNum(playerNum);
    const adjAll = mapId ? getFiguresAdjacentToTarget(game, dioFk, mapId) : [];
    const hostiles = adjAll.filter(({ playerNum: p }) => p !== playerNum).map((a) => a.figureKey);
    if (hostiles.length === 0) {
      return { applied: true, logMessage: '**Static Pulse** — No hostile figures adjacent to Dio.' };
    }
    if (choiceIndex === undefined || choiceIndex === null) {
      const hostileNames = hostiles.map((fk) => dcNameFromFigureKey(fk)).join(', ');
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
      const dcName = dcNameFromFigureKey(fk);
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
            syncHealthStateToList(game, oppNum, figMsgId, hs);
            results.push(`**${dcName}** 2 Strain (${cur ?? max}→${newCur})`);
          } else {
            results.push(`**${dcName}** 2 Strain (apply manually)`);
          }
        } else {
          results.push(`**${dcName}** 2 Strain (apply manually)`);
        }
      } else {
        if (isConditionImmune(game, fk)) {
          results.push(`**${dcName}** immune to Weaken`);
        } else {
          applyCondition(game, fk, 'Weaken');
          results.push(`**${dcName}** Weakened`);
        }
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
        const dcName = dcNameFromFigureKey(fk);
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
              syncHealthStateToList(game, p, figMsgId, hs);
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
      syncHealthStateToList(game, playerNum, msgId, selfHs);
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
  // G37/C21: max 1 copy per EOR phase
  if (entry.type === 'ccEffect' && entry.jundlandTerrorEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    game.jundlandTerrorPlayedThisEor = true;
    const traits = ['Tusken Raider', 'Bantha Rider'];
    const dcEffects = getDcEffects();
    const squadDcList = getSquad(game, playerNum)?.dcList || [];
    const dcIds = getDcMessageIds(game, playerNum);
    const matchingMsgIds = [];
    const matchingNames = [];
    for (let i = 0; i < squadDcList.length; i++) {
      const entry = squadDcList[i];
      const dcName = typeof entry === 'object' ? (entry.dcName || entry.displayName) : entry;
      if (!dcName || !dcIds?.[i]) continue;
      const dcBase = String(dcName).replace(/\s*\[.*\]\s*$/, '');
      const eff = dcEffects[dcName] || dcEffects[dcBase] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      const matchesTrait = traits.some((t) => kws.includes(t.toUpperCase()) || dcBase.toUpperCase().includes(t.toUpperCase()));
      if (matchesTrait) {
        matchingMsgIds.push(dcIds[i]);
        matchingNames.push(dcBase);
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
    const oppNum = opponentPlayerNum(playerNum);
    const oppDeckKey = ccDeckKey(oppNum);
    const oppDiscardKey = ccDiscardKey(oppNum);
    const ownDeckKey = ccDeckKey(playerNum);
    const ownHandKey = ccHandKey(playerNum);
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
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
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
        syncHealthStateToList(game, playerNum, targetMsgId, hs);
      }
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const baseCost = getDcEffects()[dcName]?.cost ?? 0;
      // IACP ruling: halve (base + positive attachments), then subtract
      // negative-cost attachments AFTER halving (not half the subtracted cost).
      // Covers DC attachments (Scavenged Walker -1, Wookiee Avenger -4, etc.)
      // which were previously omitted entirely, plus CC attachments.
      let posAttCost = 0;
      let negAttCost = 0;
      const _addAtt = (c) => {
        if (typeof c !== 'number') return;
        if (c < 0) negAttCost += c; else posAttCost += c;
      };
      const _evCcAtts = (playerNum === 1 ? game.p1CcAttachments : game.p2CcAttachments)?.[targetMsgId];
      if (Array.isArray(_evCcAtts)) {
        for (const ccName of _evCcAtts) _addAtt(getCcEffect(ccName)?.cost);
      }
      const _evDcAtts = (playerNum === 1 ? game.p1DcAttachments : game.p2DcAttachments)?.[targetMsgId];
      if (Array.isArray(_evDcAtts)) {
        const _dcEffs = getDcEffects();
        for (const name of _evDcAtts) {
          const entry = _dcEffs?.[`[${name}]`] || _dcEffs?.[name];
          if (entry?.attachment) _addAtt(entry.cost);
        }
      }
      const halfVp = Math.max(0, Math.ceil((baseCost + posAttCost) / 2) + negAttCost);
      const _hadAtts = (Array.isArray(_evCcAtts) && _evCcAtts.length) || (Array.isArray(_evDcAtts) && _evDcAtts.length);
      return { applied: true, logMessage: `**Evacuate** — **${dcName}** is defeated. Opponent gains ${halfVp > 0 ? halfVp + ' VP (half the deployment cost' + (_hadAtts ? ' incl. attachments' : '') + ' — use `/editvp -' + halfVp + '` to adjust)' : 'no VP'} from this defeat.`, refreshDcEmbed: true };
    }
    // Phase 1: find friendly figures within 2 spaces (not self)
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingPos = activatingKeys.length ? game.figurePositions?.[playerNum]?.[activatingKeys[0]] : null;
    if (!activatingPos) return { applied: false, manualMessage: 'Resolve manually: activating figure has no position.' };
    const friendlyFigureKeys = [];
    const friendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || activatingKeys.includes(fk)) continue;
      const dcName = dcNameFromFigureKey(fk);
      if (countGameSpaces(game, activatingPos, pos) > 2) continue;
      friendlyFigureKeys.push(fk);
      friendlyLabels.push(dcName);
    }
    if (friendlyFigureKeys.length === 0) return { applied: false, manualMessage: 'No friendly figures within 2 spaces to evacuate.' };
    return { requiresChoice: true, choiceOptions: friendlyLabels.map((n) => `Defeat ${n}`), choiceValues: friendlyFigureKeys };
  }

  // ccEffect: induceRageEffect (Induce Rage) — chosen figures discard all conditions, gain 1 Damage Token per condition
  if (entry.type === 'ccEffect' && entry.induceRageEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const results = [];
    let figuresProcessed = 0;
    for (const pn of [1, 2]) {
      for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
        const conds = [...(game.figureConditions?.[fk] || [])];
        if (!conds.length || figuresProcessed >= 2) continue;
        // Remove each condition through filterCondition (respects disarm lock)
        for (const c of conds) filterCondition(game, fk, c);
        const remaining = (game.figureConditions?.[fk] || []).length;
        const count = conds.length - remaining;
        if (count > 0) grantPowerTokens(game, fk, 'Damage', count);
        const dcName = dcNameFromFigureKey(fk);
        results.push(`**${dcName}** lost [${conds.filter(c => !(game.figureConditions?.[fk] || []).includes(c)).join(', ')}] → +${count} Damage Token${count !== 1 ? 's' : ''}`);
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
        findMsgIdForFigureKey(game, opponentPlayerNum(playerNum), chosenFigureKey, dcMessageMeta);
      if (!creatureMsgId) return { applied: false, manualMessage: 'Resolve manually: could not locate creature figure.' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[creatureMsgId] = true;
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return { applied: true, logMessage: `**Ferocity** — **${dcName}** may perform 1 free attack (use their Attack button).` };
    }
    // Phase 1: find CREATURE figures from both players
    const dcEffects = getDcEffects();
    const creatureKeys = [];
    const creatureLabels = [];
    for (const pn of [1, 2]) {
      for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
        const dcName = dcNameFromFigureKey(fk);
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
        return { applied: true, logMessage: `**Ferocity** — **${dcNameFromFigureKey(creatureKeys[0])}** may perform 1 free attack (use their Attack button).` };
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
    applyCondition(game, j4xFk, 'Focus');
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
          const dcName = dcNameFromFigureKey(fk);
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
              syncHealthStateToList(game, pn, figMsgId, hs);
              results.push(`**${dcName}**: 2 Dmg (HP: ${cur ?? max}→${newCur})`);
            } else {
              results.push(`**${dcName}**: apply 2 Dmg manually`);
            }
          } else {
            results.push(`apply 2 Dmg to ${dcNameFromFigureKey(dcName)} manually`);
          }
        }
      }
      return { applied: true, logMessage: `**Hidden Trap** — Terminal at **${String(chosenSpace).toUpperCase()}**. ${results.length ? results.join('; ') : 'No figures adjacent.'}`, refreshDcEmbed: results.length > 0 };
    }
    // Phase 1: space picker — show all spaces within 8 of activating figure
    const boardState = getBoardStateForMovement(game, null);
    const adj = boardState?.mapSpaces?.adjacency;
    if (!adj) return { applied: true, logMessage: '**Hidden Trap** — Choose a terminal space; each adjacent figure suffers 2 Damage. Resolve manually (no map data).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const allSpaces = Object.keys(adj);
    let validSpaces = allSpaces;
    if (actPos) {
      validSpaces = allSpaces.filter((sp) => countGameSpaces(game, actPos, sp) <= 8);
    }
    if (!validSpaces.length) validSpaces = allSpaces.slice(0, 25);
    return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: '**Hidden Trap** — Choose the terminal space:' };
  }

  // ccEffect: fieldSupplyEffect (Field Supply) — up to 2 friendly figures within 3 each gain 1 Damage Token
  if (entry.type === 'ccEffect' && entry.fieldSupplyEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant Damage Token to chosen figure
    if (chosenFigureKey) {
      grantPowerTokens(game, chosenFigureKey, 'Damage', 1);
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return { applied: true, logMessage: `**Field Supply** — **${dcName}** gained 1 Damage Token. (Surge Token also allowed; for a 2nd figure, apply manually.)` };
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
      const targets = fks.slice(0, 2);
      const names = targets.map((fk) => { grantPowerTokens(game, fk, 'Damage', 1); return dcNameFromFigureKey(fk); });
      return { applied: true, logMessage: `**Field Supply** — Damage Token granted to: ${names.join(', ')}.` };
    }
    const nearbyKeys = [];
    const nearbyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (countGameSpaces(game, actPos, pos) > 3) continue;
      nearbyKeys.push(fk);
      nearbyLabels.push(dcNameFromFigureKey(fk));
    }
    if (!nearbyKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces.' };
    return { requiresChoice: true, choiceOptions: nearbyLabels.map((n) => `Damage Token → ${n}`), choiceValues: nearbyKeys };
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
      const dcN = dcNameFromFigureKey(fk);
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
    const blastBonus = entry.blastBonusToAdjacentVehiclesDroidHW || 0;
    for (const fk of targets.slice(0, 3)) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (figMsgId) {
        game.freeAttackBonusPending[figMsgId] = true;
        if (blastBonus > 0) {
          game.optimalBombardmentBlastBonus = game.optimalBombardmentBlastBonus || {};
          game.optimalBombardmentBlastBonus[figMsgId] = blastBonus;
        }
        count++;
      }
      names.push(dcNameFromFigureKey(fk));
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
        syncHealthStateToList(game, playerNum, msgId, hs);
        strainNote = `4 Strain (HP: ${cur ?? max}→${newCur})`;
      }
    }
    // Override next attack to melee (with -1 Hit); grant 1 free attack (for 2 total)
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { type: 'melee', bonusHits: -1 };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    return { applied: true, logMessage: `**Overheated** — **${meta.dcName}**: ${strainNote}. 2 Melee attacks queued; −1 Hit applied automatically per attack.`, refreshDcEmbed: true };
  }

  // ccEffect: setTheChargesEffect (Set the Charges) — pick a space within 3; roll blue die; apply Hit+Surge as damage; open doors
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
            const dcN = dcNameFromFigureKey(fk);
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
                syncHealthStateToList(game, pn, figMsgId, hs);
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

  // ccEffect: faceMeEffect (Face Me!) — pick a unique hostile; push them to a space adjacent to you; grant free melee attack
  // Phase 1: pick unique hostile; Phase 2: pick push landing space; Phase 3: push + grant free melee attack
  if (entry.type === 'ccEffect' && entry.faceMeEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Phase 3: push hostile to chosen space, grant free melee attack
    if (chosenFigureKey && chosenSpace) {
      const { prevPos: _fmPrevPos } = pushFigure(game, oppNum, chosenFigureKey, chosenSpace) || { prevPos: null };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[msgId] = true;
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[msgId] = { type: 'melee' };
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const { pathStr: _fmPathStr, warnings: _fmWarnings } = computePushPathAndWarnings(game, _fmPrevPos, chosenSpace, oppNum);
      let _fmLogMsg = `**Face Me!** — Pushed **${dcName}** to ${String(chosenSpace).toUpperCase()}${_fmPathStr}. Use the Melee Attack button for 1 free attack.`;
      if (_fmWarnings.length > 0) {
        const _fmWarnList = _fmWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _fmLogMsg += `\n⚠️ Exits adjacency to: ${_fmWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      return { applied: true, logMessage: _fmLogMsg, refreshBoard: true };
    }
    // Phase 2: find spaces adjacent to activating figure for the push landing
    if (chosenFigureKey && !chosenSpace) {
      const mapId = game.selectedMap?.id;
      const meta = dcMessageMeta.get(msgId);
      const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
      const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
      const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
      if (!activatorPos || !mapId) {
        // Fallback: grant free attack without push
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[msgId] = true;
        const nm = dcNameFromFigureKey(chosenFigureKey);
        return { applied: true, logMessage: `**Face Me!** — Move **${nm}** adjacent manually. Then use Melee Attack button for 1 free attack.` };
      }
      const mapSpaces = getMapData(mapId);
      const adjacentSpaces = mapSpaces?.adjacency?.[activatorPos] || [];
      const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
      const targetCurrentPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      const validSpaces = adjacentSpaces.filter((s) => !occupiedSet.has(s) || s === targetCurrentPos);
      if (!validSpaces.length) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[msgId] = true;
        const nm = dcNameFromFigureKey(chosenFigureKey);
        return { applied: true, logMessage: `**Face Me!** — No free adjacent space for push; move **${nm}** adjacent manually. Use Melee Attack button for 1 free attack.` };
      }
      const nm = dcNameFromFigureKey(chosenFigureKey);
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey, spaceChoiceLabel: `**Face Me!** — Push **${nm}** to which adjacent space?` };
    }
    // Phase 1: hostile figure picker (unique figures only)
    const dcEffects = getDcEffects();
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      if (eff.unique) { hostileKeys.push(fk); hostileLabels.push(dcN); }
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No unique hostile figures in play. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Push & attack: ${n}`), choiceValues: hostileKeys };
  }

  // ccEffect: stimulantsEffect — you or an adjacent friendly suffers 1 Damage; gain 1 MP and become Focused
  // Phase 1: pick self or adjacent friendly; Phase 2: apply 1 damage to chosen + grant 1 MP + Focus
  if (entry.type === 'ccEffect' && entry.stimulantsEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    // Apply 1 MP + Focus to activating figure (used in both phases)
    const applyMpAndFocus = () => {
      addMovementPoints(game, msgId, 1);
      applyCondition(game, activatorFk, 'Focus');
    };
    // Phase 2: apply damage to chosen (chosenFigureKey = 'self' or a friendly figure key)
    if (chosenFigureKey) {
      if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
      const targetIsActivator = chosenFigureKey === 'self' || chosenFigureKey === activatorFk;
      const damageMsgId = targetIsActivator ? msgId : findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      const damageFk = targetIsActivator ? activatorFk : chosenFigureKey;
      const targetHs = (dcHealthState.get(damageMsgId) || []).slice();
      const targetMeta = damageMsgId ? dcMessageMeta.get(damageMsgId) : null;
      const targetKeys = targetMeta ? getFigureKeysForDcMsg(game, playerNum, targetMeta) : [damageFk];
      const fi = Math.max(0, targetKeys.indexOf(damageFk));
      if (targetHs[fi] && Array.isArray(targetHs[fi])) {
        const [cur, max] = targetHs[fi];
        targetHs[fi] = [Math.max(0, (cur ?? max ?? 0) - 1), max];
        dcHealthState.set(damageMsgId, targetHs);
        syncHealthStateToList(game, playerNum, damageMsgId, targetHs);
      }
      applyMpAndFocus();
      const targetName = targetIsActivator ? (meta.displayName || meta.dcName) : dcNameFromFigureKey(damageFk);
      const refreshIds = [msgId];
      if (damageMsgId && !refreshIds.includes(damageMsgId)) refreshIds.push(damageMsgId);
      return { applied: true, logMessage: `**Stimulants** — **${targetName}** suffered 1 Damage; gained 1 MP and Focus.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, conditionCardsToPost: ['Focus'] };
    }
    // Phase 1: find adjacent friendly figures to offer as damage targets
    const mapId = game.selectedMap?.id;
    const adjFriendlyKeys = [];
    if (mapId) {
      for (const fk of activatingKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p === playerNum && !activatingKeys.includes(figureKey) && !adjFriendlyKeys.includes(figureKey)) {
            adjFriendlyKeys.push(figureKey);
          }
        }
      }
    }
    if (adjFriendlyKeys.length === 0) {
      // No adjacent friendly — auto-apply to self
      if (dcHealthState) {
        const selfHs = (dcHealthState.get(msgId) || []).slice();
        const activatorIdx = activatingKeys.indexOf(activatorFk);
        const fi = Math.max(0, activatorIdx);
        if (selfHs[fi] && Array.isArray(selfHs[fi])) {
          const [cur, max] = selfHs[fi];
          selfHs[fi] = [Math.max(0, (cur ?? max ?? 0) - 1), max];
          dcHealthState.set(msgId, selfHs);
          syncHealthStateToList(game, playerNum, msgId, selfHs);
        }
      }
      applyMpAndFocus();
      return { applied: true, logMessage: `**Stimulants** — Suffered 1 Damage (self); gained 1 MP and Focus.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], conditionCardsToPost: ['Focus'] };
    }
    // Show choice: self or an adjacent friendly
    const selfName = meta.displayName || meta.dcName || 'self';
    const opts = [`Damage self (${selfName})`];
    const vals = ['self'];
    for (const fk of adjFriendlyKeys) {
      const fMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      const fMeta = fMsgId ? dcMessageMeta.get(fMsgId) : null;
      const fName = fMeta?.displayName || fMeta?.dcName || dcNameFromFigureKey(fk);
      opts.push(`Damage: ${fName}`);
      vals.push(fk);
    }
    return { requiresChoice: true, choiceOptions: opts, choiceValues: vals };
  }

  // ccEffect: darkEnergyEffect — choose SMALL hostile within 3; push 1 space; deal 1 Damage
  // Phase 1: SMALL within-3 picker; Phase 2: pick landing space for push; Phase 3: push + deal 1 Damage
  if (entry.type === 'ccEffect' && entry.darkEnergyEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    const mapId = game.selectedMap?.id;
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Phase 3: apply push + deal 1 Damage
    if (chosenFigureKey && chosenSpace) {
      const { prevPos: _dePrevPos } = pushFigure(game, oppNum, chosenFigureKey, chosenSpace) || { prevPos: null };
      const targetName = dcNameFromFigureKey(chosenFigureKey);
      const targetMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      const refreshIds = [];
      if (targetMsgId) refreshIds.push(targetMsgId);
      if (dcHealthState && targetMsgId) {
        const targetMeta = dcMessageMeta.get(targetMsgId);
        const targetKeys = targetMeta ? getFigureKeysForDcMsg(game, oppNum, targetMeta) : [chosenFigureKey];
        const fi = Math.max(0, targetKeys.indexOf(chosenFigureKey));
        const targetHs = (dcHealthState.get(targetMsgId) || []).slice();
        if (targetHs[fi] && Array.isArray(targetHs[fi])) {
          const [cur, max] = targetHs[fi];
          targetHs[fi] = [Math.max(0, (cur ?? max ?? 0) - 1), max];
          dcHealthState.set(targetMsgId, targetHs);
          syncHealthStateToList(game, oppNum, targetMsgId, targetHs);
        }
      }
      const { pathStr: _dePathStr, warnings: _deWarnings } = computePushPathAndWarnings(game, _dePrevPos, chosenSpace, oppNum);
      let _deLogMsg = `**Dark Energy** — Pushed **${targetName}** to ${String(chosenSpace).toUpperCase()}${_dePathStr}, dealt 1 Damage.`;
      if (_deWarnings.length > 0) {
        const _deWarnList = _deWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _deLogMsg += `\n⚠️ Exits adjacency to: ${_deWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      return { applied: true, logMessage: _deLogMsg, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
    }
    // Phase 2: pick landing space adjacent to target (1-space push in any direction)
    if (chosenFigureKey && !chosenSpace) {
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      if (!targetPos || !mapId) return { applied: false, manualMessage: 'Resolve Dark Energy push manually.' };
      const mapSpaces = getMapData(mapId);
      const adjacentSpaces = mapSpaces?.adjacency?.[targetPos] || [];
      const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
      occupiedSet.delete(targetPos); // target's current space is available (they're moving)
      const validSpaces = adjacentSpaces.filter((s) => !occupiedSet.has(s));
      if (!validSpaces.length) return { applied: false, manualMessage: 'No valid push space — resolve Dark Energy push manually.' };
      const nm = dcNameFromFigureKey(chosenFigureKey);
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey, spaceChoiceLabel: `**Dark Energy** — Push **${nm}** to which space?` };
    }
    // Phase 1: find SMALL hostiles within 3 of activating figure
    if (!mapId) return { applied: false, manualMessage: 'Resolve Dark Energy manually (no map).' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
    const validTargets = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      if (!coord) continue;
      if (activatorPos && countGameSpaces(game, activatorPos, coord) > 3) continue;
      // SMALL check: skip LARGE and MASSIVE figures
      const targetDcName = dcNameFromFigureKey(fk);
      const targetStats = getStatsForDc(targetDcName);
      const kwds = (targetStats?.keywords || []).map((k) => String(k).toUpperCase());
      if (kwds.includes('LARGE') || kwds.includes('MASSIVE')) continue;
      validTargets.push(fk);
    }
    if (!validTargets.length) return { applied: true, logMessage: 'No SMALL hostile within 3 for Dark Energy.' };
    const getFigLbl = (fk) => {
      const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
      const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
      return tMeta?.displayName || tMeta?.dcName || dcNameFromFigureKey(fk);
    };
    if (validTargets.length === 1) {
      // Auto-select single target, go to Phase 2 immediately
      const fk = validTargets[0];
      const targetPos = game.figurePositions?.[oppNum]?.[fk];
      const mapSpaces = getMapData(mapId);
      const adjacentSpaces = mapSpaces?.adjacency?.[targetPos] || [];
      const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
      occupiedSet.delete(targetPos);
      const validSpaces = adjacentSpaces.filter((s) => !occupiedSet.has(s));
      if (!validSpaces.length) return { applied: false, manualMessage: `No valid push space for **${getFigLbl(fk)}** — resolve manually.` };
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey: fk, spaceChoiceLabel: `**Dark Energy** — Push **${getFigLbl(fk)}** to which space?` };
    }
    return { requiresChoice: true, choiceOptions: validTargets.map(getFigLbl), choiceValues: validTargets };
  }

  // ccEffect: lookingForAFightChoice — gain 1 Power Token; then move 2 spaces or push an adjacent hostile 1 space
  // Must come before the general powerTokenGain handler to take priority.
  // Phase 1 (no chosenFigureKey): grant Wild token + present Move/Push choice
  // Phase 2a (chosenFigureKey='move2'): add 2 MP
  // Phase 2b (chosenFigureKey=hostile fk): present space picker for push
  // Phase 3 (chosenFigureKey + chosenSpace): push hostile to space
  if (entry.type === 'ccEffect' && entry.powerTokenGain && entry.lookingForAFightChoice) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (!figureKeys.length) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const activatorFk = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    // Phase 3: push hostile to chosen space
    if (chosenFigureKey && chosenFigureKey !== 'move2' && chosenSpace) {
      const { prevPos: _lffPrevPos } = pushFigure(game, oppNum, chosenFigureKey, chosenSpace) || { prevPos: null };
      const nm = dcNameFromFigureKey(chosenFigureKey);
      const { pathStr: _lffPathStr, warnings: _lffWarnings } = computePushPathAndWarnings(game, _lffPrevPos, chosenSpace, oppNum);
      let _lffLogMsg = `**Looking for a Fight** — Pushed **${nm}** to ${String(chosenSpace).toUpperCase()}${_lffPathStr}.`;
      if (_lffWarnings.length > 0) {
        const _lffWarnList = _lffWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _lffLogMsg += `\n⚠️ Exits adjacency to: ${_lffWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      const lffTokenFk = game._lffPendingTokenFigureKey;
      delete game._lffPendingTokenFigureKey;
      if (lffTokenFk) {
        game.pendingPowerTokenGrant = { grants: [{ figureKey: lffTokenFk, figName: dcNameFromFigureKey(lffTokenFk), count: 1 }], channelId: null, playerNum };
      }
      return { applied: true, logMessage: _lffLogMsg, refreshBoard: true, requiresPowerTokenChoice: !!lffTokenFk };
    }
    // Phase 2a: Move 2 spaces
    if (chosenFigureKey === 'move2') {
      addMovementPoints(game, msgId, 2);
      const lffTokenFk = game._lffPendingTokenFigureKey;
      delete game._lffPendingTokenFigureKey;
      if (lffTokenFk) {
        game.pendingPowerTokenGrant = { grants: [{ figureKey: lffTokenFk, figName: dcNameFromFigureKey(lffTokenFk), count: 1 }], channelId: null, playerNum };
      }
      return { applied: true, logMessage: `**Looking for a Fight** — Chose to move 2 spaces.`, refreshMovementBank: true, activeMsgId: msgId, requiresPowerTokenChoice: !!lffTokenFk };
    }
    // Phase 2b: Push hostile — find spaces adjacent to the chosen hostile
    if (chosenFigureKey && chosenFigureKey !== 'move2' && !chosenSpace) {
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      const mapId = game.selectedMap?.id;
      if (!targetPos || !mapId) return { applied: false, manualMessage: 'Resolve push manually.' };
      const mapSpaces = getMapData(mapId);
      const adjacentSpaces = mapSpaces?.adjacency?.[targetPos] || [];
      const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
      occupiedSet.delete(targetPos);
      const validSpaces = adjacentSpaces.filter((s) => !occupiedSet.has(s));
      if (!validSpaces.length) return { applied: true, logMessage: `No valid push space — push **${dcNameFromFigureKey(chosenFigureKey)}** manually.` };
      const nm = dcNameFromFigureKey(chosenFigureKey);
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey, spaceChoiceLabel: `**Looking for a Fight** — Push **${nm}** to which space?` };
    }
    // Phase 1: defer power token choice + present Move/Push choice
    game._lffPendingTokenFigureKey = activatorFk;
    const mapId = game.selectedMap?.id;
    const adjHostileFks = [];
    if (mapId) {
      for (const fk of figureKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p === oppNum && !adjHostileFks.includes(figureKey)) adjHostileFks.push(figureKey);
        }
      }
    }
    const opts = ['Move 2 spaces'];
    const vals = ['move2'];
    for (const hfk of adjHostileFks) {
      const hMsgId = findMsgIdForFigureKey(game, oppNum, hfk, dcMessageMeta);
      const hMeta = hMsgId ? dcMessageMeta.get(hMsgId) : null;
      const hName = hMeta?.displayName || hMeta?.dcName || dcNameFromFigureKey(hfk);
      opts.push(`Push: ${hName}`);
      vals.push(hfk);
    }
    return { requiresChoice: true, choiceOptions: opts, choiceValues: vals };
  }

  // ccEffect: supportSpecialistEffect (Support Specialist) — choose DROID/TECHNICIAN/TROOPER within 3; grant free move (extra MP)
  if (entry.type === 'ccEffect' && entry.supportSpecialistEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: grant bonus MP (free move) to chosen figure
    if (chosenFigureKey) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find figure DC — apply action manually.' };
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      addMovementPoints(game, figMsgId, figSpeed);
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
      if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
      const dcN = dcNameFromFigureKey(fk);
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
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      addMovementPoints(game, figMsgId, figSpeed);
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
      if (actPos && countGameSpaces(game, actPos, pos) > 2) continue;
      validKeys.push(fk); validLabels.push(dcNameFromFigureKey(fk));
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
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      addMovementPoints(game, figMsgId, figSpeed);
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[figMsgId] = true;
      return { applied: true, logMessage: `**Call the Vanguard** — **${dcName}** gains ${figSpeed} MP + 1 free attack (interrupt). Use their Move and Attack buttons.` };
    }
    // Phase 1: find TROOPER figures with cost 4+ (any range, any player's table)
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('TROOPER') && (eff.cost ?? 0) >= 4) { validKeys.push(fk); validLabels.push(`${dcN} (cost ${eff.cost})`); }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No TROOPER figures with cost 4+ in play.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Interrupt: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: triangulateEffect (Triangulate) — move DROIDs manually; pick hostile; deal damage = # friendly DROIDs in play
  if (entry.type === 'ccEffect' && entry.triangulateEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    // Phase 2: apply damage to chosen hostile = # friendly DROIDs in play
    if (chosenFigureKey) {
      const oppNum = opponentPlayerNum(playerNum);
      const droidCount = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => {
        const dcN = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('DROID');
      }).length;
      if (!droidCount) return { applied: false, manualMessage: 'No friendly DROIDs in play to deal damage.' };
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const figMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      let dmgNote = `${droidCount} Dmg to ${dcName}`;
      if (figMsgId && dcHealthState) {
        const hs = dcHealthState.get(figMsgId) || [];
        const fkM = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const fi = fkM ? parseInt(fkM[2], 10) : 0;
        if (hs[fi]) {
          const [cur, max] = hs[fi];
          const newCur = Math.max(0, (cur ?? max) - droidCount);
          hs[fi] = [newCur, max ?? newCur];
          dcHealthState.set(figMsgId, hs);
          syncHealthStateToList(game, oppNum, figMsgId, hs);
          dmgNote = `${droidCount} Dmg (HP: ${cur ?? max}→${newCur})`;
        }
      }
      return { applied: true, logMessage: `**Triangulate** — **${dcName}**: ${dmgNote}. (Max = ${droidCount} DROIDs in play.)`, refreshDcEmbed: !!figMsgId };
    }
    // Phase 1: hostile figure picker (move DROIDs first manually)
    const oppNum = opponentPlayerNum(playerNum);
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      hostileKeys.push(fk); hostileLabels.push(dcNameFromFigureKey(fk));
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No hostile figures to target.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Target: ${n} (move DROIDs first)`), choiceValues: hostileKeys };
  }

  // ccEffect: packAlphaEffect (Pack Alpha) — move CREATUREs manually; pick hostile; deal damage = # adjacent CREATUREs
  if (entry.type === 'ccEffect' && entry.packAlphaEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    const oppNum = opponentPlayerNum(playerNum);
    // Phase 2: count CREATUREs adjacent to chosen hostile, apply damage
    if (chosenFigureKey) {
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      const boardState = getBoardStateForMovement(game, null);
      const adjRaw = targetPos ? (boardState?.mapSpaces?.adjacency?.[String(targetPos).toLowerCase()] || []) : [];
      const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
      const adjacentCreatures = Object.entries(game.figurePositions?.[playerNum] || {}).filter(([fk, pos]) => {
        if (!pos || !adjSet.has(String(pos).toLowerCase())) return false;
        const dcN = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('CREATURE');
      });
      const dmg = adjacentCreatures.length;
      const dcName = dcNameFromFigureKey(chosenFigureKey);
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
          syncHealthStateToList(game, oppNum, figMsgId, hs);
          dmgNote = `${dmg} Dmg (HP: ${cur ?? max}→${newCur})`;
        }
      }
      return { applied: true, logMessage: `**Pack Alpha** — **${dcName}**: ${dmgNote}. (${adjacentCreatures.map(([fk]) => dcNameFromFigureKey(fk)).join(', ')} adjacent)`, refreshDcEmbed: !!figMsgId };
    }
    // Phase 1: hostile figure picker (move CREATUREs first manually)
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      hostileKeys.push(fk); hostileLabels.push(dcNameFromFigureKey(fk));
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
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return { applied: true, logMessage: `**Coordinated Attack** — **${meta.dcName}** and **${dcName}** each gain 1 free attack. Both must target the same hostile figure. LOS: figures don't block for these attacks.` };
    }
    // Phase 1: friendly figure picker within 3
    const actKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
      validKeys.push(fk); validLabels.push(dcNameFromFigureKey(fk));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces for Coordinated Attack.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Co-attacker: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: forcePushEffect (Force Push) — pick SMALL figure within 3; pick destination within 2 of target; move target
  if (entry.type === 'ccEffect' && entry.forcePushEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 3: move target figure to chosen space (space-by-space path with trigger checks)
    if (chosenFigureKey && chosenSpace) {
      const targetPn = game.figurePositions?.[1]?.[chosenFigureKey] != null ? 1 : 2;
      const { prevPos: oldPos, newPos: destLower } = pushFigure(game, targetPn, chosenFigureKey, chosenSpace) || { prevPos: null, newPos: String(chosenSpace).toLowerCase() };
      const dcName = dcNameFromFigureKey(chosenFigureKey);

      const { pathStr, warnings } = computePushPathAndWarnings(game, oldPos, destLower, targetPn);
      let logMsg = `**Force Push** — **${dcName}** pushed from **${String(oldPos || '?').toUpperCase()}** to **${String(chosenSpace).toUpperCase()}**${pathStr}.`;
      if (warnings.length > 0) {
        const warnList = warnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        logMsg += `\n⚠️ Exits adjacency to: ${warnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      return { applied: true, logMessage: logMsg, refreshBoard: true };
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
      return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**Force Push** — Choose destination (within 2 of ${dcNameFromFigureKey(chosenFigureKey)}):`, chosenFigureKey };
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
        const dcN = dcNameFromFigureKey(fk);
        const eff = dcEffects[dcN] || {};
        const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
        if (kws.includes('MASSIVE') || kws.includes('LARGE')) continue; // only SMALL figures
        if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
        validKeys.push(fk); validLabels.push(`${dcN} (P${pn})`);
      }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No SMALL figures within 3 spaces to push.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Push: ${n}`), choiceValues: validKeys };
  }

  // dcSpecial: hopOnPush (Kuiil Hop On!) — pick friendly SMALL figure, push up to 4 spaces
  if (entry.type === 'dcSpecial' && entry.hopOnPush) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 3: move target figure to chosen space
    if (chosenFigureKey && chosenSpace) {
      const targetPn = playerNum; // always friendly
      const { prevPos: oldPos, newPos: destLower } = pushFigure(game, targetPn, chosenFigureKey, chosenSpace) || { prevPos: null, newPos: String(chosenSpace).toLowerCase() };
      const dcName = dcNameFromFigureKey(chosenFigureKey);

      const { pathStr, warnings } = computePushPathAndWarnings(game, oldPos, destLower, targetPn);
      let logMsg = `**Hop On!** — **${dcName}** pushed from **${String(oldPos || '?').toUpperCase()}** to **${String(chosenSpace).toUpperCase()}**${pathStr}.`;
      if (warnings.length > 0) {
        const warnList = warnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        logMsg += `\n⚠️ Exits adjacency to: ${warnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      return { applied: true, logMessage: logMsg, refreshBoard: true };
    }
    // Phase 2: space picker within 4 of chosen figure's current position
    if (chosenFigureKey) {
      const targetPos = game.figurePositions?.[playerNum]?.[chosenFigureKey];
      if (!targetPos) return { applied: false, manualMessage: 'Could not locate target figure position. Push manually.' };
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Push manually (no map data).' };
      const occ = boardState.occupiedSet;
      const occArr = occ instanceof Set ? [...occ] : (occ || []);
      const reachable = getReachableSpaces(targetPos, 4, boardState.mapSpaces, occArr);
      const validSpaces = reachable.map((s) => String(s).toLowerCase()).filter((s) => !occArr.includes(s));
      if (!validSpaces.length) return { applied: false, manualMessage: 'No empty spaces within 4 to push the figure to.' };
      return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: `**Hop On!** — Choose destination (within 4 of ${dcNameFromFigureKey(chosenFigureKey)}):`, chosenFigureKey };
    }
    // Phase 1: pick friendly SMALL figure
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('MASSIVE') || kws.includes('LARGE')) continue; // only SMALL figures
      validKeys.push(fk); validLabels.push(dcN);
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly SMALL figures to push.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Push: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: devotionEffect (Devotion) — pick adjacent friendly; search deck for matching CC; draw + shuffle
  if (entry.type === 'ccEffect' && entry.devotionEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (chosenFigureKey) {
      // Phase 3: card chosen → draw it + shuffle deck
      if (chosenFigureKey.startsWith('devotion_draw|')) {
        const cardName = chosenFigureKey.slice('devotion_draw|'.length);
        const deckKey = ccDeckKey(playerNum);
        const deck = game[deckKey] || [];
        const cardIdx = deck.indexOf(cardName);
        if (cardIdx >= 0) deck.splice(cardIdx, 1);
        // Add to hand
        const handKey = ccHandKey(playerNum);
        game[handKey] = game[handKey] || [];
        game[handKey].push(cardName);
        // Shuffle remaining deck (Fisher-Yates)
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        game[deckKey] = deck;
        return { applied: true, logMessage: `**Devotion** — Drew **${cardName}** from Command deck. Deck shuffled (${deck.length} cards remaining).` };
      }
      // Phase 2: figure chosen → search deck for cards matching figure's traits
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const dcEffectsMap = getDcEffects();
      const figEff = dcEffectsMap[dcName] || {};
      const figKws = new Set((figEff.keywords || []).map(k => String(k).toUpperCase()));
      figKws.add(dcName.toUpperCase()); // figure name also counts as a restriction match
      const deckKey = ccDeckKey(playerNum);
      const deck = game[deckKey] || [];
      const matches = [];
      for (const cardName of deck) {
        const ccEff = getCcEffect(cardName);
        if (!ccEff?.playableBy) continue;
        const restriction = String(ccEff.playableBy).toUpperCase();
        if (restriction === 'ANY FIGURE') continue; // skip generic cards
        // Check if any of the figure's keywords/name matches the restriction words
        const rWords = restriction.split(/\s+(?:OR)\s+|[,]/i).map(w => w.trim());
        const found = rWords.some(rw => {
          const parts = rw.split(/\s+/);
          return parts.every(p => figKws.has(p));
        });
        if (found) matches.push(cardName);
      }
      if (matches.length === 0) {
        // No matches — still shuffle the deck
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        game[deckKey] = deck;
        return { applied: true, logMessage: `**Devotion** — No cards in Command deck match **${dcName}**'s traits. Deck shuffled.` };
      }
      if (matches.length === 1) {
        // Auto-draw the single match
        const cardName = matches[0];
        const cardIdx = deck.indexOf(cardName);
        if (cardIdx >= 0) deck.splice(cardIdx, 1);
        const handKey = ccHandKey(playerNum);
        game[handKey] = game[handKey] || [];
        game[handKey].push(cardName);
        for (let i = deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        game[deckKey] = deck;
        return { applied: true, logMessage: `**Devotion** — Drew **${cardName}** (matched **${dcName}**). Deck shuffled (${deck.length} cards remaining).` };
      }
      return { requiresChoice: true, choiceOptions: matches.map(c => `Draw: ${c}`), choiceValues: matches.map(c => `devotion_draw|${c}`) };
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
      validKeys.push(fk); validLabels.push(dcNameFromFigureKey(fk));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No adjacent friendly figures. Resolve Devotion manually.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Search for: ${n} trait`), choiceValues: validKeys };
  }

  // ccEffect: learnByExampleEffect (Learn by Example) — copy a FORCE USER CC in any discard pile
  if (entry.type === 'ccEffect' && entry.learnByExampleEffect) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (game.restInPeaceActive) return { applied: false, manualMessage: '**Rest in Peace** is active — players cannot choose Command cards from discard piles this round.' };
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
      const dcName = dcNameFromFigureKey(chosenFigureKey);
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
      if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
      validKeys.push(fk); validLabels.push(dcNameFromFigureKey(fk));
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly figures within 3 spaces. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Grant reroll: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: letsMakeADealEffect (Let's Make a Deal) — pay X VP to opponent for -X Hits in combat + become Focused
  if (entry.type === 'ccEffect' && entry.letsMakeADealEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex, combat } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || "Resolve manually — pay VP to opponent to reduce hits, then become Focused." };
    const oppNum = opponentPlayerNum(playerNum);
    const ownVpKey = vpKey(playerNum);
    const oppVpKey = vpKey(oppNum);
    const ownVp = game[ownVpKey]?.total ?? 0;
    // Incoming hits = rolled dmg + bonus hits (before defense) — cap options to actual incoming hits
    const incomingHits = Math.max(0, (combat?.attackRoll?.dmg || 0) + (combat?.bonusHits || 0) + (combat?.surgeDamage || 0));
    const maxPay = Math.min(ownVp, incomingHits > 0 ? incomingHits : 5);
    // Phase 2: apply the deal
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const X = choiceIndex; // options: 0 VP (skip), 1 VP = index 1, 2 VP = index 2, etc.
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
      actKeys.forEach((fk) => { applyCondition(game, fk, 'Focus'); });
      const ownNew = game[ownVpKey]?.total ?? 0;
      const oppNew = game[oppVpKey]?.total ?? 0;
      return { applied: true, logMessage: `**Let's Make a Deal** — Paid ${X} VP (your total: ${ownNew}, theirs: ${oppNew}). ${X > 0 ? `Applied −${X} Hits to this attack.` : 'No VP paid.'} Hondo becomes Focused.` };
    }
    // Phase 1: show VP options matching incoming hits
    const options = ['Pay 0 VP (just apply Focus)'];
    for (let i = 1; i <= maxPay; i++) options.push(`Pay ${i} VP → −${i} Hit${i !== 1 ? 's' : ''}`);
    return { requiresChoice: true, choiceOptions: options };
  }

  // ccEffect: demoralizingMonologueEffect (Demoralizing Monologue) — force defender to reroll 1 die during attack
  if (entry.type === 'ccEffect' && entry.demoralizingMonologueEffect) {
    const { game, playerNum, combat } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    // If already in reroll phase, increment defender's remaining rerolls directly
    if (combat.defenderRerollsRemaining != null) {
      combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
      return { applied: true, logMessage: "**Demoralizing Monologue** — Added 1 forced reroll to defender (attacker chooses which die)." };
    }
    // Otherwise set flag to be consumed when the reroll window opens
    game.forceDefenderRerollOne = { attackerPlayerNum: combat.attackerPlayerNum };
    return { applied: true, logMessage: "**Demoralizing Monologue** — Defender will be forced to reroll 1 die. Flag set — applies when reroll window opens." };
  }

  // ccEffect: doubleOrNothingEffect (Double or Nothing) — choose a die; reroll it; if same icon type, may double those icons
  if (entry.type === 'ccEffect' && entry.doubleOrNothingEffect) {
    const { game, playerNum, combat, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      if (choiceIndex === 0) {
        // Attacker die — set DON flag so the doubling check fires after the reroll
        combat.attackerRerollsRemaining = (combat.attackerRerollsRemaining || 0) + 1;
        game.doubleMatchingIconsOnReroll = { playerNum, side: 'atk' };
        return { applied: true, logMessage: "**Double or Nothing** — Attacker rerolls 1 die; if dominant icon type matches, that icon is doubled automatically." };
      } else {
        // Defender die
        combat.defenderRerollsRemaining = (combat.defenderRerollsRemaining || 0) + 1;
        game.doubleMatchingIconsOnReroll = { playerNum, side: 'def' };
        return { applied: true, logMessage: "**Double or Nothing** — Defender rerolls 1 die; if dominant icon type matches, that icon is doubled automatically." };
      }
    }
    return { requiresChoice: true, choiceOptions: ['Reroll an attack die', 'Reroll a defense die'] };
  }

  // ccEffect: lordOfTheSithEffect (Lord of the Sith) — when hostile defeated: grant 2 MP + choice: Force Choke adjacent hostile OR free attack
  if (entry.type === 'ccEffect' && entry.lordOfTheSithEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    // Phase 3: Force Choke chosen figure (deal 2 Dmg + 2 Strain)
    if (chosenFigureKey) {
      const oppNum = opponentPlayerNum(playerNum);
      const figMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      let dmgNote = 'apply 2 Dmg + 2 Strain manually';
      if (figMsgId && dcHealthState) {
        const hs = dcHealthState.get(figMsgId) || [];
        const fkM = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const fi = fkM ? parseInt(fkM[2], 10) : 0;
        if (hs[fi]) {
          const [cur, max] = hs[fi];
          const newCur = Math.max(0, (cur ?? max) - 4); // 2 dmg + 2 strain = 4 total
          hs[fi] = [newCur, max ?? newCur];
          dcHealthState.set(figMsgId, hs);
          syncHealthStateToList(game, oppNum, figMsgId, hs);
          dmgNote = `2 Dmg + 2 Strain (HP: ${cur ?? max}→${newCur})`;
        }
      }
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return { applied: true, logMessage: `**Lord of the Sith** — Force Choke **${dcName}**: ${dmgNote}. (2 MP already added)`, refreshDcEmbed: !!figMsgId };
    }
    // Grant 2 MP to Vader
    addMovementPoints(game, msgId, 2);
    if (choiceIndex !== undefined && choiceIndex !== null) {
      if (choiceIndex === 1) {
        // Free melee attack
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[msgId] = true;
        return { applied: true, logMessage: '**Lord of the Sith** — Darth Vader moves up to 2 spaces (MP added). Free Melee attack granted — use the Attack button.' };
      }
      // Force Choke: pick adjacent hostile
      const meta = dcMessageMeta.get(msgId);
      const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
      const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
      const boardState = getBoardStateForMovement(game, null);
      const adjRaw = actPos ? (boardState?.mapSpaces?.adjacency?.[String(actPos).toLowerCase()] || []) : [];
      const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
      const oppNum = opponentPlayerNum(playerNum);
      const validKeys = [];
      const validLabels = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!pos || !adjSet.has(String(pos).toLowerCase())) continue;
        validKeys.push(fk); validLabels.push(dcNameFromFigureKey(fk));
      }
      if (!validKeys.length) return { applied: true, logMessage: '**Lord of the Sith** — No adjacent hostile for Force Choke. 2 MP added.' };
      return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Force Choke: ${n}`), choiceValues: validKeys };
    }
    return { requiresChoice: true, choiceOptions: ['Force Choke adjacent hostile (2 Dmg + 2 Strain)', 'Perform free Melee attack'] };
  }

  // ccEffect: dangerousPreyEffect (Dangerous Prey) — attacker in combat suffers 1 or 3 dmg; Fennec moves 2
  if (entry.type === 'ccEffect' && entry.dangerousPreyEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, combat, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    // Determine attacker info from combat
    const attackerFk = combat?.attackerFigureKey || null;
    const attackerPn = combat?.attackerPlayerNum || opponentPlayerNum(playerNum);
    // Check adjacency (for 3 dmg vs 1 dmg)
    let isAdjacent = false;
    if (actPos && attackerFk) {
      const attackerPos = game.figurePositions?.[attackerPn]?.[attackerFk];
      if (attackerPos) {
        const boardState = getBoardStateForMovement(game, null);
        const adjRaw = boardState?.mapSpaces?.adjacency?.[String(actPos).toLowerCase()] || [];
        isAdjacent = adjRaw.map((s) => String(s).toLowerCase()).includes(String(attackerPos).toLowerCase());
      }
    }
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const dmg = choiceIndex === 0 ? (isAdjacent ? 3 : 1) : 0;
      let dmgNote = `Apply ${dmg} Dmg to attacker manually`;
      if (dmg > 0 && attackerFk && dcHealthState) {
        const figMsgId = findMsgIdForFigureKey(game, attackerPn, attackerFk, dcMessageMeta);
        if (figMsgId) {
          const hs = dcHealthState.get(figMsgId) || [];
          const fkM = attackerFk.match(/-(\d+)-(\d+)$/);
          const fi = fkM ? parseInt(fkM[2], 10) : 0;
          if (hs[fi]) {
            const [cur, max] = hs[fi];
            const newCur = Math.max(0, (cur ?? max) - dmg);
            hs[fi] = [newCur, max ?? newCur];
            dcHealthState.set(figMsgId, hs);
            syncHealthStateToList(game, attackerPn, figMsgId, hs);
            dmgNote = `${dmg} Dmg (HP: ${cur ?? max}→${newCur})`;
          }
        }
      }
      // Grant 2 MP to Fennec
      if (msgId) {
        addMovementPoints(game, msgId, 2);
      }
      const atkName = attackerFk ? dcNameFromFigureKey(attackerFk) : 'attacker';
      return { applied: true, logMessage: `**Dangerous Prey** — **${atkName}**: ${dmgNote}${isAdjacent ? ' (adjacent — 3 dmg)' : ' (within 4 — 1 dmg)'}. Fennec gains 2 MP.`, refreshDcEmbed: dmg > 0 };
    }
    const dmgLabel = isAdjacent ? '3 Damage (adjacent)' : attackerFk ? '1 Damage (within 4)' : '1 Damage';
    return { requiresChoice: true, choiceOptions: [`Apply ${dmgLabel} to attacker + move 2`, 'Just move 2 (skip damage)'] };
  }

  // ccEffect: rightBackAtYaEffect (Right Back At Ya!) — attacker suffers 1 dmg (3 if Block Token spent)
  if (entry.type === 'ccEffect' && entry.rightBackAtYaEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, combat, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const attackerFk = combat?.attackerFigureKey || null;
    const attackerPn = combat?.attackerPlayerNum || opponentPlayerNum(playerNum);
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const dmg = choiceIndex === 0 ? 1 : 3; // 0 = "1 dmg", 1 = "spent Block Token → 3 dmg"
      let dmgNote = `Apply ${dmg} Dmg to attacker manually`;
      if (attackerFk && dcHealthState) {
        const figMsgId = findMsgIdForFigureKey(game, attackerPn, attackerFk, dcMessageMeta);
        if (figMsgId) {
          const hs = dcHealthState.get(figMsgId) || [];
          const fkM = attackerFk.match(/-(\d+)-(\d+)$/);
          const fi = fkM ? parseInt(fkM[2], 10) : 0;
          if (hs[fi]) {
            const [cur, max] = hs[fi];
            const newCur = Math.max(0, (cur ?? max) - dmg);
            hs[fi] = [newCur, max ?? newCur];
            dcHealthState.set(figMsgId, hs);
            syncHealthStateToList(game, attackerPn, figMsgId, hs);
            dmgNote = `${dmg} Dmg (HP: ${cur ?? max}→${newCur})`;
          }
        }
      }
      const atkName = attackerFk ? dcNameFromFigureKey(attackerFk) : 'attacker';
      return { applied: true, logMessage: `**Right Back At Ya!** — **${atkName}**: ${dmgNote}${choiceIndex === 1 ? ' (Block Token spent)' : ''}.`, refreshDcEmbed: !!attackerFk };
    }
    // Check if Ahsoka has a Block Token to offer 3 dmg option
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const hasBlockToken = actKeys.some((fk) => (game.figurePowerTokens?.[fk] || []).includes('Block'));
    const opts = ['1 Damage to attacker'];
    if (hasBlockToken) opts.push('Spend Block Token → 3 Damage to attacker');
    return { requiresChoice: true, choiceOptions: opts };
  }

  // ccEffect: paybackEffect (Payback) — after attack: Dengar interrupts to attack attacker with +2 Surge
  if (entry.type === 'ccEffect' && entry.paybackEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.roundAttackSurgeBonus = game.roundAttackSurgeBonus || {};
    game.roundAttackSurgeBonus[playerNum] = (game.roundAttackSurgeBonus[playerNum] || 0) + 2;
    const meta = dcMessageMeta.get(msgId);
    return { applied: true, logMessage: `**Payback** — **${meta?.dcName || 'Dengar'}** may perform 1 free attack against the attacker. +2 Surge applied to that attack.` };
  }

  // ccEffect: overchargedWeaponsEffect (Overcharged Weapons) — interrupt: free attack with Pierce 2 + exhaust + Weaken self
  if (entry.type === 'ccEffect' && entry.overchargedWeaponsEffect) {
    const { game, playerNum, dcMessageMeta, dcExhaustedState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    const meta = dcMessageMeta.get(msgId);
    // Grant free attack with Pierce 2
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[msgId] = { ...(game.pendingOverrideAttackDice[msgId] || {}), pierce: (game.pendingOverrideAttackDice[msgId]?.pierce || 0) + 2 };
    // Apply Weaken to activating figure (respects immunity)
    const actKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    actKeys.forEach((fk) => { if (!isConditionImmune(game, fk)) applyCondition(game, fk, 'Weaken'); });
    // Exhaust the DC card (persist for restart survival)
    if (dcExhaustedState) dcExhaustedState.set(msgId, true);
    if (game) {
      game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
      if (!game.abilityExhaustedMsgIds.includes(msgId)) game.abilityExhaustedMsgIds.push(msgId);
    }
    return { applied: true, logMessage: `**Overcharged Weapons** — **${meta?.dcName || 'VEHICLE'}** gains 1 free attack (+Pierce 2). ${meta?.dcName || 'Vehicle'} is exhausted and Weakened.` };
  }

  // ccEffect: partingBlowEffect (Parting Blow) — interrupt: free attack on hostile exiting adjacent + become Stunned (once per move)
  if (entry.type === 'ccEffect' && entry.partingBlowEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    // Once per move: check if already used this move
    game.partingShotTriggered = game.partingShotTriggered || {};
    if (game.partingShotTriggered[msgId]) {
      return { applied: false, manualMessage: 'Parting Blow already used this move.' };
    }
    const meta = dcMessageMeta.get(msgId);
    // Grant free attack
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    // Mark as used this move (cleared when a new Move action starts — G36)
    game.partingShotTriggered[msgId] = true;
    // Apply Stun to activating figure (respects immunity)
    const actKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const _pbImmune = actKeys.length > 0 && actKeys.every(fk => isConditionImmune(game, fk));
    if (!_pbImmune) actKeys.forEach((fk) => { if (!isConditionImmune(game, fk)) applyCondition(game, fk, 'Stun'); });
    const stunNote = _pbImmune ? ' (immune to Stun)' : ' becomes Stunned';
    return { applied: true, logMessage: `**Parting Blow** — **${meta?.dcName || 'BRAWLER'}** gains 1 free attack before the hostile finishes exiting. ${meta?.dcName || 'Figure'}${stunNote}.` };
  }

  // ccEffect: chooseASideEffect (Choose a Side) — SCUM: round defense block +1 for Mobile friendlies; IMPERIAL: free flamethrower-style attack
  if (entry.type === 'ccEffect' && entry.chooseASideEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const dcEffects = getDcEffects();
      const mobileKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => {
        const dcN = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('MOBILE') && (msgId ? !getFigureKeysForDcMsg(game, playerNum, dcMessageMeta?.get(msgId)).includes(fk) : true);
      });
      if (choiceIndex === 0) {
        // SCUM: Personal Combat Shield — +1 Block per attack for Mobile friendlies only
        game.roundMobileDefenseBonusBlock = game.roundMobileDefenseBonusBlock || {};
        game.roundMobileDefenseBonusBlock[playerNum] = (game.roundMobileDefenseBonusBlock[playerNum] || 0) + 1;
        return { applied: true, logMessage: `**Choose a Side (SCUM)** — This round, **+1 Block** when defending for your **Mobile** figures (${mobileKeys.length} figure${mobileKeys.length !== 1 ? 's' : ''}).` };
      } else {
        // IMPERIAL: Gar Saxon Flamethrower — grant free Flamethrower attack to ALL Mobile friendlies
        const dcMsgIds = getDcMessageIds(game, playerNum) || [];
        const dcListAll = getDcList(game, playerNum) || [];
        let grantedNames = [];
        for (let i = 0; i < dcMsgIds.length; i++) {
          const mid = dcMsgIds[i];
          const dcObj = dcListAll[i];
          if (!dcObj || dcObj.defeated) continue;
          const dcN = typeof dcObj === 'object' ? (dcObj.dcName || dcObj.displayName) : dcObj;
          const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
          if (kws.includes('MOBILE')) {
            game.freeAttackBonusPending = game.freeAttackBonusPending || {};
            game.freeAttackBonusPending[mid] = { from: 'Choose a Side (Flamethrower)' };
            grantedNames.push(dcN);
          }
        }
        return { applied: true, logMessage: `**Choose a Side (IMPERIAL)** — This round, all **Mobile** friendlies gain a free Flamethrower attack: ${grantedNames.length ? grantedNames.join(', ') : 'none found'}.` };
      }
    }
    return { requiresChoice: true, choiceOptions: ['SCUM: Personal Combat Shield (+1 Block for Mobile figures)', "IMPERIAL: Gar Saxon's Flamethrower (area attack)"] };
  }

  // ccEffect: reverseEngineerEffect (Reverse Engineer) — free attack with +1 Surge using defender's surge abilities
  if (entry.type === 'ccEffect' && entry.reverseEngineerEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[msgId] = true;
    game.roundAttackSurgeBonus = game.roundAttackSurgeBonus || {};
    game.roundAttackSurgeBonus[playerNum] = (game.roundAttackSurgeBonus[playerNum] || 0) + 1;
    // Flag: swap to defender's surge abilities when attack resolves
    game.reverseEngineerActive = game.reverseEngineerActive || {};
    game.reverseEngineerActive[playerNum] = true;
    const meta = dcMessageMeta.get(msgId);
    return { applied: true, logMessage: `**Reverse Engineer** — **${meta?.dcName || 'Figure'}** performs 1 free attack with +1 Surge. The **defender's** DC surge abilities will be used instead of your own.` };
  }

  // ccEffect: navigationUpgradeEffect (Navigation Upgrade) — Strain 1 to self; choose friendly DROID for +1 MP
  if (entry.type === 'ccEffect' && entry.navigationUpgradeEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const applyStrain = () => {
      let strainNote = 'apply 1 Strain manually';
      if (msgId && dcHealthState) {
        const hs = dcHealthState.get(msgId) || [];
        if (hs[0]) {
          const [cur, max] = hs[0];
          const newCur = Math.max(0, (cur ?? max) - 1);
          hs[0] = [newCur, max ?? newCur];
          dcHealthState.set(msgId, hs);
          syncHealthStateToList(game, playerNum, msgId, hs);
          strainNote = `1 Strain (HP: ${cur ?? max}→${newCur})`;
        }
      }
      return strainNote;
    };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const strainNote = applyStrain();
      let mpNote = '';
      if (chosenFigureKey) {
        const droidMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
        if (droidMsgId) {
          addMovementPoints(game, droidMsgId, 1);
          mpNote = ` **${dcNameFromFigureKey(chosenFigureKey)}** gains 1 MP.`;
        }
      }
      return { applied: true, logMessage: `**Navigation Upgrade** — ${strainNote}.${mpNote} Placed as Attachment — exhaust during any friendly DROID's activation for +1 MP.`, refreshDcEmbed: true };
    }
    const dcEffects = getDcEffects();
    const droidFks = [];
    const droidLabels = [];
    for (const [fk] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      const dcN = dcNameFromFigureKey(fk);
      const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('DROID')) { droidFks.push(fk); droidLabels.push(dcN); }
    }
    if (!droidFks.length) {
      const strainNote = applyStrain();
      return { applied: true, logMessage: `**Navigation Upgrade** — ${strainNote}. No friendly DROIDs on board. Placed as Attachment (exhaust during DROID activation for +1 MP).`, refreshDcEmbed: true };
    }
    return { requiresChoice: true, choiceOptions: droidLabels.map((n) => `Give 1 MP to ${n}`), choiceValues: droidFks };
  }

  // ccEffect: findsmanMeditationEffect (Findsman Meditation) — pick opponent group; Zuckuss may interrupt their first action
  if (entry.type === 'ccEffect' && entry.findsmanMeditationEffect) {
    const { game, playerNum, choiceIndex, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const chosenDcName = String(chosenOption ?? '').replace(/^Watch:\s*/, '');
      game.findsmanMeditationTarget = game.findsmanMeditationTarget || {};
      game.findsmanMeditationTarget[playerNum] = chosenDcName;
      return { applied: true, logMessage: `**Findsman Meditation** — Zuckuss will interrupt when **${chosenDcName}** activates this round. Before their first action, announce the interrupt: Zuckuss may move up to 2 spaces or perform an attack.` };
    }
    const oppIds = getDcMessageIds(game, oppNum) || [];
    const oppList = getDcList(game, oppNum) || [];
    const oppNames = oppIds.map((id, i) => oppList[i]?.dcName).filter(Boolean);
    if (!oppNames.length) return { applied: false, manualMessage: 'No opponent deployment groups found. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: oppNames.map((n) => `Watch: ${n}`) };
  }

  // ccEffect: ballisticsMatrixEffect (Ballistics Matrix) — next attack ignores figure LOS blocking
  if (entry.type === 'ccEffect' && entry.ballisticsMatrixEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[playerNum] = true;
    return { applied: true, logMessage: `**Ballistics Matrix** — For your next attack, intervening figures do **not** block line of sight. Declare your attack normally.` };
  }

  // ccEffect: etiquetteAndProtocolEffect (Etiquette and Protocol) — block attacks between one hostile and one friendly this round
  if (entry.type === 'ccEffect' && entry.etiquetteAndProtocolEffect) {
    const { game, playerNum, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (choiceIndex !== undefined && choiceIndex !== null && chosenFigureKey) {
      // chosenFigureKey is encoded as "hostileFk|friendlyFk"
      const sep = chosenFigureKey.indexOf('|');
      const hostileFk = sep >= 0 ? chosenFigureKey.slice(0, sep) : chosenFigureKey;
      const friendlyFk = sep >= 0 ? chosenFigureKey.slice(sep + 1) : '';
      game.etiquetteBlockPairs = game.etiquetteBlockPairs || [];
      game.etiquetteBlockPairs.push([hostileFk, friendlyFk]);
      const hName = dcNameFromFigureKey(hostileFk);
      const fName = dcNameFromFigureKey(friendlyFk);
      return { applied: true, logMessage: `**Etiquette and Protocol** — **${hName}** and **${fName}** cannot declare attacks targeting each other until end of round.` };
    }
    const oppNum = opponentPlayerNum(playerNum);
    const hostileFks = Object.keys(game.figurePositions?.[oppNum] || {}).filter((fk) => game.figurePositions[oppNum][fk]);
    const friendlyFks = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => game.figurePositions[playerNum][fk]);
    const opts = [];
    const vals = [];
    for (const hfk of hostileFks) {
      for (const ffk of friendlyFks) {
        opts.push(`${dcNameFromFigureKey(hfk)} ↔ ${dcNameFromFigureKey(ffk)}`);
        vals.push(`${hfk}|${ffk}`);
      }
    }
    if (!opts.length) return { applied: false, manualMessage: 'No valid figure pairs found. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: opts, choiceValues: vals };
  }

  // ccEffect: changeOfPlansEffect (Change of Plans) — exhaust one DC, ready another that shares a keyword/trait
  if (entry.type === 'ccEffect' && entry.changeOfPlansEffect) {
    const { game, playerNum, dcMessageMeta, dcExhaustedState, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (choiceIndex !== undefined && choiceIndex !== null && chosenFigureKey) {
      // chosenFigureKey is encoded as "exhaustMsgId|readyMsgId"
      const sep = chosenFigureKey.indexOf('|');
      const exhaustMsgId = sep >= 0 ? chosenFigureKey.slice(0, sep) : chosenFigureKey;
      const readyMsgId = sep >= 0 ? chosenFigureKey.slice(sep + 1) : '';
      const exhaustMeta = dcMessageMeta?.get(exhaustMsgId);
      const readyMeta = dcMessageMeta?.get(readyMsgId);
      if (dcExhaustedState && exhaustMsgId) dcExhaustedState.set(exhaustMsgId, true);
      if (dcExhaustedState && readyMsgId) dcExhaustedState.set(readyMsgId, false);
      // Persist ability-driven exhaustion/readying for restart survival
      if (game) {
        game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
        if (exhaustMsgId && !game.abilityExhaustedMsgIds.includes(exhaustMsgId)) game.abilityExhaustedMsgIds.push(exhaustMsgId);
        if (readyMsgId) game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds.filter(id => id !== readyMsgId);
      }
      return { applied: true, logMessage: `**Change of Plans** — **${exhaustMeta?.dcName || exhaustMsgId}** exhausted → **${readyMeta?.dcName || readyMsgId}** readied (shared trait). DC embeds will update on next interaction.` };
    }
    // Phase 1: enumerate valid (exhaust→ready) pairs that share at least one keyword/trait
    const dcEffects = getDcEffects();
    const dcIds = getDcMessageIds(game, playerNum) || [];
    const dcList = getDcList(game, playerNum) || [];
    const playerDcs = dcIds.map((id, i) => ({ msgId: id, dcName: dcList[i]?.dcName })).filter((d) => d.dcName);
    const opts = [];
    const vals = [];
    for (const dca of playerDcs) {
      // dca is the card to exhaust — it must currently be readied (not exhausted)
      if (dcExhaustedState?.get(dca.msgId) !== false) continue;
      const effA = dcEffects[dca.dcName] || {};
      const kwA = new Set((effA.keywords || []).map((k) => String(k).toUpperCase()));
      const costA = effA.cost ?? 0;
      for (const dcb of playerDcs) {
        if (dca.msgId === dcb.msgId) continue;
        // dcb is the card to ready — it must currently be exhausted
        if (dcExhaustedState?.get(dcb.msgId) !== true) continue;
        const effB = dcEffects[dcb.dcName] || {};
        const costB = effB.cost ?? 0;
        // Ready DC must have equal or lower deployment cost
        if (costB > costA) continue;
        const kwB = (effB.keywords || []).map((k) => String(k).toUpperCase());
        const shared = kwB.find((k) => kwA.has(k));
        if (shared && opts.length < 25) {
          opts.push(`Exhaust ${dca.dcName} → Ready ${dcb.dcName} (${shared})`);
          vals.push(`${dca.msgId}|${dcb.msgId}`);
        }
      }
    }
    if (!opts.length) return { applied: false, manualMessage: 'No valid exhaust→ready pairs with shared traits found. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: opts, choiceValues: vals };
  }

  // ccEffect: cheatToWinEffect (Cheat to Win) — after Gambit die rolled, choose its new result
  if (entry.type === 'ccEffect' && entry.cheatToWinEffect) {
    const { game, playerNum, choiceIndex, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      return { applied: true, logMessage: `**Cheat to Win** — Gambit die changed to: **${chosenOption}**. Apply this result in the combat thread.` };
    }
    // Show all die face results grouped by color (25 options max, 5 per row)
    const opts = [
      // Red attack die faces
      'Red: 3 Hits + Surge', 'Red: 3 Hits', 'Red: 2 Hits + Surge', 'Red: 2 Hits', 'Red: 1 Hit',
      // Blue attack die faces
      'Blue: 2 Hits + 1 Acc', 'Blue: 1 Hit + Surge', 'Blue: 2 Hits', 'Blue: 1 Hit', 'Blue: 1 Acc',
      // Green attack die faces
      'Green: 2 Hits', 'Green: 1 Hit + Surge', 'Green: 1 Hit', 'Green: 2 Acc', 'Green: Surge',
      // Black defense die faces
      'Black: 1 Evade + 1 Block', 'Black: 2 Blocks', 'Black: 1 Block', 'Black: 1 Evade', 'Black: Blank',
      // White defense die faces
      'White: 2 Acc', 'White: 1 Acc + Surge', 'White: 1 Hit + Surge', 'White: Surge', 'White: 1 Acc',
    ];
    return { requiresChoice: true, choiceOptions: opts };
  }

  // ccEffect: commDisruptionEffect (Comm Disruption) — cancel an opponent CC play (cost ≤ friendly SPY groups)
  if (entry.type === 'ccEffect' && entry.commDisruptionEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    const dcList = getDcList(game, playerNum) || [];
    const spyCount = dcList.filter((dc) => {
      const kws = (dcEffects[dc.dcName]?.keywords || []).map((k) => String(k).toUpperCase());
      return kws.includes('SPY');
    }).length;
    const oppNum = opponentPlayerNum(playerNum);
    const oppDiscard = getCcDiscard(game, oppNum) || [];
    const lastCard = oppDiscard[oppDiscard.length - 1] || null;
    const cancelNote = lastCard ? `Opponent's most recent card: **${lastCard}**` : 'No recent opponent card found — identify the card manually.';
    return { applied: true, logMessage: `**Comm Disruption** — You have **${spyCount}** friendly SPY group${spyCount !== 1 ? 's' : ''}: can cancel any opponent CC with cost ≤ ${spyCount}. ${cancelNote} Discard that card and cancel its effects.` };
  }

  // ccEffect: setATrapEffect (Set a Trap) — choose a space; at round end a friendly on that space may attack a hostile on it
  if (entry.type === 'ccEffect' && entry.setATrapEffect) {
    const { game, playerNum, chosenSpace } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (chosenSpace) {
      game.setTrapSpace = game.setTrapSpace || {};
      game.setTrapSpace[playerNum] = chosenSpace;
      return { applied: true, logMessage: `**Set a Trap** — Trap placed at space **${chosenSpace}**. At end of round, if a friendly figure is on that space, they interrupt to attack a hostile on it (announce the interrupt at round end).` };
    }
    // Space picker: all currently occupied spaces (friendly + hostile) as candidates
    const oppNum = opponentPlayerNum(playerNum);
    const occupied = new Set();
    for (const [, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) { if (pos) occupied.add(String(pos).toLowerCase()); }
    for (const [, pos] of Object.entries(game.figurePositions?.[oppNum] || {})) { if (pos) occupied.add(String(pos).toLowerCase()); }
    if (!occupied.size) {
      // Fall back to all map spaces
      const boardState = getBoardStateForMovement(game, null);
      const allSpaces = Object.keys(boardState?.mapSpaces?.spaces || {});
      if (!allSpaces.length) return { applied: false, manualMessage: 'No map spaces found. Note the trap location manually.' };
      return { requiresSpaceChoice: true, validSpaces: allSpaces.slice(0, 25) };
    }
    return { requiresSpaceChoice: true, validSpaces: [...occupied] };
  }

  // dcSpecial: headbuttMove (Tauntaun Rider Headbutt) — move up to N spaces, choose adjacent hostile, roll 1 die
  if (entry.type === 'dcSpecial' && entry.headbuttMove) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenSpace, targetFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = context.msgId || findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId) || context.meta;
    if (!meta) return { applied: false, manualMessage: 'Resolve manually: no activation meta.' };
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const activatingFigureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;

    // Phase 3: target chosen → roll die, apply damage
    if (targetFigureKey) {
      const color = entry.headbuttDie || 'red';
      const faces = getDiceData().attack?.[color.toLowerCase()];
      if (!faces?.length) return { applied: false, manualMessage: `Roll 1 ${color} die manually.` };
      const face = faces[Math.floor(Math.random() * faces.length)];
      const hits = face.dmg ?? 0;
      const dieParts = [];
      if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
      if (face.surge) dieParts.push(`${face.surge} Surge${face.surge !== 1 ? 's' : ''}`);
      const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
      const targetName = dcNameFromFigureKey(targetFigureKey);
      const resultParts = [];
      if (hits > 0) {
        const enemyPlayerNum = opponentPlayerNum(playerNum);
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
            syncHealthStateToList(game, enemyPlayerNum, targetMsgId, healthState);
            resultParts.push(`${hits} Damage (HP: ${cur ?? max} → ${newCur})`);
          } else {
            resultParts.push(`apply ${hits} Damage manually`);
          }
        } else {
          resultParts.push(`apply ${hits} Damage manually`);
        }
      }
      return {
        applied: true,
        logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}.`,
        refreshDcEmbed: true,
      };
    }

    // Phase 2: space chosen → move figure, then enumerate adjacent hostiles
    if (chosenSpace) {
      game.figurePositions = game.figurePositions || {};
      game.figurePositions[playerNum] = game.figurePositions[playerNum] || {};
      game.figurePositions[playerNum][activatingFigureKey] = chosenSpace;
      game.figureMoved = game.figureMoved || {};
      game.figureMoved[activatingFigureKey] = true;
      const mapId = game.selectedMap?.id;
      if (!mapId) return { applied: true, logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. No map data — resolve attack manually.`, refreshBoard: true };
      const adjacentAll = getFiguresAdjacentToTarget(game, activatingFigureKey, mapId);
      const enemyPlayerNum = opponentPlayerNum(playerNum);
      const validTargets = adjacentAll.filter(f => f.playerNum === enemyPlayerNum);
      if (validTargets.length === 0) {
        return { applied: true, logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. No adjacent hostile figures.`, refreshBoard: true };
      }
      if (validTargets.length === 1) {
        // Auto-target single adjacent hostile: roll immediately
        const singleTarget = validTargets[0].figureKey;
        const color = entry.headbuttDie || 'red';
        const faces = getDiceData().attack?.[color.toLowerCase()];
        if (!faces?.length) return { applied: true, logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. Roll 1 ${color} die against **${dcNameFromFigureKey(singleTarget)}** manually.`, refreshBoard: true };
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (face.surge) dieParts.push(`${face.surge} Surge${face.surge !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const tName = dcNameFromFigureKey(singleTarget);
        const resParts = [];
        if (hits > 0) {
          const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, singleTarget, dcMessageMeta);
          if (dcHealthState && targetMsgId) {
            const healthState = dcHealthState.get(targetMsgId) || [];
            const fkMatch = singleTarget.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const entryHp = healthState[figIdx];
            if (entryHp) {
              const [cur, max] = entryHp;
              const newCur = Math.max(0, (cur ?? max) - hits);
              healthState[figIdx] = [newCur, max ?? newCur];
              dcHealthState.set(targetMsgId, healthState);
              syncHealthStateToList(game, enemyPlayerNum, targetMsgId, healthState);
              resParts.push(`${hits} Damage (HP: ${cur ?? max} → ${newCur})`);
            }
          }
        }
        return {
          applied: true,
          logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. Rolled 1 ${color} die: **${diceResult}**. **${tName}** ${resParts.join(', ') || 'unaffected'}.`,
          refreshDcEmbed: true,
          refreshBoard: true,
        };
      }
      // Multiple adjacent hostiles: let player choose
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(validTargets.map(t => t.figureKey)),
        targetFigureKeys: validTargets.map(t => t.figureKey),
        choicePrompt: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. Choose an adjacent hostile figure:`,
        refreshBoard: true,
      };
    }

    // Phase 1: enumerate reachable spaces within headbuttMove
    const activatingPos = game.figurePositions?.[playerNum]?.[activatingFigureKey];
    if (!activatingPos) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (position unknown).` };
    const boardState = getBoardStateForMovement(game, activatingFigureKey);
    if (!boardState?.mapSpaces) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (map not loaded).` };
    const occ = boardState.occupiedSet;
    const occArr = occ instanceof Set ? [...occ] : (occ || []);
    const reachable = getReachableSpaces(activatingPos, entry.headbuttMove, boardState.mapSpaces, occArr);
    // Include current position (move 0 spaces)
    const validSet = new Set([String(activatingPos).toLowerCase(), ...reachable.map(s => String(s).toLowerCase())]);
    const validSpaces = [...validSet];
    if (validSpaces.length === 0) return { applied: false, manualMessage: `No valid spaces for **${entry.label}**.` };
    return {
      requiresSpaceChoice: true,
      validSpaces,
      spaceChoiceLabel: `**${entry.label}** — Move up to ${entry.headbuttMove} spaces:`,
    };
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
    // Second call: teleport figure to chosen space, grant free pounce attack (unless pounceNoAttack)
    game.figurePositions = game.figurePositions || {};
    game.figurePositions[playerNum] = game.figurePositions[playerNum] || {};
    game.figurePositions[playerNum][fk] = chosenSpace;
    game.figureMoved = game.figureMoved || {};
    game.figureMoved[fk] = true;
    if (entry.pounceNoAttack) {
      return {
        applied: true,
        logMessage: `**${entry.label || 'Force Leap'}**: placed at **${String(chosenSpace).toUpperCase()}**.`,
        refreshBoard: true,
      };
    }
    game.pounceAttackPending = game.pounceAttackPending || {};
    game.pounceAttackPending[msgId] = { figureKey: fk, figureIndex: 0 };
    return {
      applied: true,
      logMessage: `**Pounce**: placed at **${String(chosenSpace).toUpperCase()}**. May now perform an attack (free — use Attack button).`,
      refreshBoard: true,
    };
  }

  // (Duplicate mpBonus handler removed — primary handler at line ~3072 covers all cases)

  // ccEffect: adrenalineEffect (Adrenaline) — +5 Health to each friendly WOOKIEE this round; at end of round each suffers 5 Damage
  if (entry.type === 'ccEffect' && entry.adrenalineEffect) {
    const { game, playerNum, dcHealthState } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve manually: apply +5 Health to each of your WOOKIEEs this round.' };
    const dcEffects = getDcEffects() || {};
    const dcList = getDcList(game, playerNum) || [];
    const dcIds = getDcMessageIds(game, playerNum) || [];
    const boosted = [];
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      if (!dc || dc.defeated) continue;
      const mid = dcIds[i];
      if (!mid) continue;
      const baseName = (dc.dcName || '').replace(/\s*\[.*\]\s*$/, '').trim();
      const eff = dcEffects[baseName] || dcEffects[dc.dcName] || {};
      const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes('WOOKIEE') && !kws.includes('WOOKIE')) continue;
      // Boost each figure in this DC's healthState by +5 max and +5 current
      const healthState = dcHealthState ? dcHealthState.get(mid) : (dc.healthState || null);
      if (!healthState || !Array.isArray(healthState)) continue;
      for (let fi = 0; fi < healthState.length; fi++) {
        if (!Array.isArray(healthState[fi])) continue;
        const [cur, max] = healthState[fi];
        const curHp = cur ?? max ?? 0;
        const maxHp = max ?? cur ?? 0;
        healthState[fi] = [curHp + 5, maxHp + 5];
      }
      if (dcHealthState) {
        dcHealthState.set(mid, healthState);
        syncHealthStateToList(game, playerNum, mid, healthState);
      } else {
        dc.healthState = [...healthState];
      }
      boosted.push({ msgId: mid, dcName: dc.displayName || dc.dcName, figureCount: healthState.length });
    }
    if (boosted.length === 0) {
      return { applied: false, manualMessage: 'No friendly WOOKIEE figures found. Resolve manually if applicable.' };
    }
    // Store tracking data for end-of-round cleanup
    game.adrenalineBonuses = game.adrenalineBonuses || {};
    for (const b of boosted) {
      game.adrenalineBonuses[b.msgId] = { playerNum, dcName: b.dcName, figureCount: b.figureCount };
    }
    const names = boosted.map(b => `**${b.dcName}**`).join(', ');
    return { applied: true, logMessage: `**Adrenaline** — ${names} gained **+5 Health** this round.` };
  }

  // ccEffect: readyOwnDeploymentCard (Son of Skywalker — ready your DC after any activation)
  if (entry.type === 'ccEffect' && entry.readyOwnDeploymentCard) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const activatedKey = activatedDcIndicesKey(playerNum);
    const dcMessageIds = getDcMessageIds(game, playerNum) || [];
    const idx = dcMessageIds.indexOf(msgId);
    if (idx >= 0 && Array.isArray(game[activatedKey])) {
      game[activatedKey] = game[activatedKey].filter((i) => i !== idx);
    }
    // Set persistent flag so Luke's DC auto-readies after every subsequent activation this round
    game.sonOfSkywalkerActive = { playerNum, dcMsgId: msgId };
    return {
      applied: true,
      logMessage: 'Your Deployment card is now **Readied** and will auto-ready after each activation this round.',
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
      logMessage: 'This round, when your opponent rerolls a die, remove that die from the results.',
    };
  }

  // ccEffect: setsTherIsNoTry (There Is No Try — REBEL FORCE USER die manipulation this round)
  if (entry.type === 'ccEffect' && entry.setsTherIsNoTry) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.thereIsNoTryPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, when a friendly REBEL FORCE USER rolls dice: set 1 die to any side and convert Dodge results to your choice.',
    };
  }

  // ccEffect: setsYouWillNotDenyMe (You Will Not Deny Me — Fifth Brother immortal + recover 2 on each hostile defeat)
  if (entry.type === 'ccEffect' && entry.setsYouWillNotDenyMe) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.youWillNotDenyMeActive = { playerNum };
    return {
      applied: true,
      logMessage: '**You Will Not Deny Me** active — Fifth Brother cannot be defeated, ignores conditions, and recovers 2 Damage each time a hostile figure is defeated this round.',
    };
  }

  // ccEffect: setsMandaAsteel (Mandalorian Steel — recover 1 Damage when friendly spends a Block Token)
  if (entry.type === 'ccEffect' && entry.setsMandaAsteel) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.mandaAsteelPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, when a friendly figure spends a Block Token during defense, recover 1 Damage on that figure.',
    };
  }

  // ccEffect: setsStillFaster (Still Faster Than You — interrupt at start of hostile activation)
  if (entry.type === 'ccEffect' && entry.setsStillFaster) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.stillFasterPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, at the start of a hostile activation: interrupt to move 2 spaces and attack a different hostile figure.',
    };
  }

  // ccEffect: disablesFigure (Disable — chosen hostile cannot use Surge or Special Actions this round)
  if (entry.type === 'ccEffect' && entry.disablesFigure) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = getDcList(game, 3 - playerNum) || [];
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to disable.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.disabledFigures = game.disabledFigures || [];
    if (!game.disabledFigures.includes(chosenOption)) game.disabledFigures.push(chosenOption);
    return {
      applied: true,
      logMessage: `**${chosenOption}** is Disabled — cannot use Surge abilities or Special Actions this round.`,
    };
  }

  // ccEffect: setsHoldGround (Hold Ground — SMALL hostiles cannot voluntarily exit spaces adjacent to player's figures)
  if (entry.type === 'ccEffect' && entry.setsHoldGround) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.holdGroundPlayerNum = playerNum;
    return {
      applied: true,
      logMessage: 'This round, SMALL hostile figures cannot voluntarily exit spaces adjacent to your figures.',
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
    const oppDcList = getDcList(game, 3 - playerNum) || [];
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to place a bounty on.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.priceBounties = game.priceBounties || {};
    game.priceBounties[chosenOption] = { amount: 4, playerNum };
    return {
      applied: true,
      logMessage: `Bounty on **${chosenOption}**: +4 VP when that group is defeated (auto-awarded on defeat).`,
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
    const oppHandKey = ccHandKey(3 - playerNum);
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
    const oppDeckKey = ccDeckKey(3 - playerNum);
    const oppDeck = game[oppDeckKey] || [];
    const topCards = oppDeck.slice(0, n);
    const deckText = topCards.length > 0 ? topCards.map((c) => `**${c}**`).join(', ') : '*(empty)*';
    return {
      applied: true,
      requiresReorder: topCards.length > 1 ? { cards: topCards, deckKey: oppDeckKey } : null,
      revealToPlayer: `**Top ${topCards.length} card${topCards.length !== 1 ? 's' : ''} of opponent's deck:** ${deckText}`,
      logMessage: `Looked at top ${topCards.length} card(s) of opponent's Command deck.`,
    };
  }

  // ccEffect: stealsFromOpponentDiscard (Data Theft) — take a CC from opponent's discard pile
  if (entry.type === 'ccEffect' && entry.stealsFromOpponentDiscard) {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (game.restInPeaceActive) return { applied: false, manualMessage: '**Rest in Peace** is active — players cannot choose Command cards from discard piles this round.' };
    const oppDiscardKey = ccDiscardKey(3 - playerNum);
    const oppDiscard = (game[oppDiscardKey] || []).slice();
    if (chosenOption == null) {
      if (oppDiscard.length === 0) return { applied: false, manualMessage: "Opponent's discard pile is empty." };
      return { requiresChoice: true, choiceOptions: [...oppDiscard] };
    }
    const stealIdx = oppDiscard.indexOf(chosenOption);
    if (stealIdx < 0) return { applied: false, manualMessage: `"${chosenOption}" not found in opponent's discard.` };
    oppDiscard.splice(stealIdx, 1);
    game[oppDiscardKey] = oppDiscard;
    const ownHandKey = ccHandKey(playerNum);
    game[ownHandKey] = [...(game[ownHandKey] || []), chosenOption];
    // Track stolen card for end-of-round return if unplayed
    game.dataTheftStolenCard = { playerNum, cardName: chosenOption };
    return {
      applied: true,
      drewCards: [chosenOption],
      refreshHand: true,
      refreshDiscard: true,
      logMessage: `Took **${chosenOption}** from opponent's discard. It may be played once this round (returns at end of round if unplayed).`,
    };
  }

  // dcSpecial: searchDeckForCC (Sith Acolyte) — search own CC deck for matching card, add to hand, shuffle
  if (entry.searchDeckForCC && typeof entry.searchDeckForCC === 'object') {
    const { game, playerNum, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
    const deck = game[deckKey] || [];
    const { playableBy, maxCost } = entry.searchDeckForCC;
    const ccEffects = getCcEffectsData() || {};
    const cards = ccEffects.cards || ccEffects;
    // Filter deck for eligible cards
    const eligible = deck.filter(cardName => {
      const ccData = cards[cardName];
      if (!ccData) return false;
      if (typeof maxCost === 'number' && (ccData.cost ?? 99) > maxCost) return false;
      if (Array.isArray(playableBy) && playableBy.length > 0) {
        const cardPlayableBy = (ccData.playableBy || '').toLowerCase();
        const match = playableBy.some(trait => cardPlayableBy.includes(trait.toLowerCase()));
        if (!match) return false;
      }
      return true;
    });
    if (chosenOption == null) {
      if (eligible.length === 0) return { applied: true, logMessage: `**${entry.label}** — No eligible cards found in deck.` };
      return { requiresChoice: true, choiceOptions: [...new Set(eligible)], choiceLabel: `Choose a card (${entry.label})` };
    }
    const idx = deck.indexOf(chosenOption);
    if (idx < 0) return { applied: false, manualMessage: `"${chosenOption}" not found in deck.` };
    deck.splice(idx, 1);
    // Shuffle remaining deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    game[deckKey] = deck;
    game[handKey] = [...(game[handKey] || []), chosenOption];
    return {
      applied: true,
      drewCards: [chosenOption],
      refreshHand: true,
      logMessage: `**${entry.label}** — Searched deck and added **${chosenOption}** to hand. Deck shuffled.`,
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
    const oppDcList = getDcList(game, 3 - playerNum) || [];
    if (chosenOption == null) {
      const options = oppDcList.filter((dc) => dc && !dc.defeated).map((dc) => dc.displayName || dc.dcName).filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No active hostile figures to cripple.' };
      return { requiresChoice: true, choiceOptions: options };
    }
    game.crippledFigures = game.crippledFigures || [];
    if (!game.crippledFigures.includes(chosenOption)) game.crippledFigures.push(chosenOption);
    return {
      applied: true,
      logMessage: `**${chosenOption}** is Crippled — cannot voluntarily exit its space this round.`,
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
    // C25: Reinforcements max 1 per SOR phase
    if (entry.label === 'Reinforcements' && !chosenFigureKey) game.reinforcementsPlayedThisSor = true;
    const dcList = getDcList(game, playerNum) || [];
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
        const deckKey = ccDeckKey(playerNum);
        const discardKey = ccDiscardKey(playerNum);
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
      // C11: If entire group is now back on board, ready the DC (so respawned group can activate)
      const _pdfResult = {
        applied: true,
        logMessage: `Placed **${figLabel}** at **${String(chosenSpace).toUpperCase()}**.${shuffleMsg}`,
        refreshBoard: true,
        ...(pdf.shuffleBackToDeck ? { refreshDiscard: true } : {}),
      };
      const _pdfDcName = dcNameFromFigureKey(chosenFigureKey);
      const _pdfStats = getStatsForDc(_pdfDcName);
      const _pdfFigCount = _pdfStats?.figures ?? 1;
      if (_pdfFigCount >= 1) {
        const { dgIndex: _pdfDgIdx } = parseFigureKey(chosenFigureKey);
        const _pdfAllOnBoard = Array.from({ length: _pdfFigCount }, (_, fi) =>
          `${_pdfDcName}-${_pdfDgIdx}-${fi}`
        ).every(fk => game.figurePositions?.[playerNum]?.[fk]);
        if (_pdfAllOnBoard) {
          const dcMsgIds = getDcMessageIds(game, playerNum) || [];
          const dcListAll = getDcList(game, playerNum) || [];
          for (let di = 0; di < dcListAll.length; di++) {
            const dcEntry = dcListAll[di];
            const entryName = typeof dcEntry === 'object' ? (dcEntry.dcName || dcEntry.displayName) : dcEntry;
            if (entryName === _pdfDcName && dcEntry?.exhausted) {
              dcEntry.exhausted = false;
              if (dcMsgIds[di]) {
                _pdfResult.readyDcMsgIds = [dcMsgIds[di]];
                _pdfResult.logMessage += ` Group **readied** (can activate this round).`;
              }
              break;
            }
          }
        }
      }
      return _pdfResult;
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
      const ms = getMapData(game.selectedMap?.id);
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
    // Register companion → host relationship so isCompanionHostDefeated() works
    if (calFigKey) {
      game.companionHostMap = game.companionHostMap || {};
      game.companionHostMap[bd1Key] = { hostFigureKey: calFigKey, playerNum };
    }
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
  const dcList = getDcList(game, playerNum) || [];
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
