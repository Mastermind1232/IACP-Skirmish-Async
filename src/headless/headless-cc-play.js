/**
 * Headless CC play: bypasses the Discord 3-step UI and calls resolveAbility()
 * directly. Replicates the game-state flow from handleCcConfirmPlay in
 * src/handlers/cc-hand.js without any Discord I/O.
 *
 * Three play paths:
 *   Path 1 — Attachment CCs (attach to a DC)
 *   Path 2 — Cost > 0, non-attachment (resolve before moving card)
 *   Path 3 — Cost = 0, non-attachment (move card, check Negation, then resolve)
 */

import {
  ccHandKey, ccDiscardKey, ccAttachmentsKey, opponentPlayerNum,
  getDcList, getDcMessageIds,
} from '../game/player-helpers.js';

/**
 * Play a command card headlessly. All pre-selection checks (timing, legality,
 * preconditions) happen in canResolveCcHeadless() BEFORE the AI selects this
 * action. If we reach here, the CC MUST resolve. Any failure is a hard error.
 *
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - CC name
 * @param {object} deps - Headless deps bag (from harness.getDeps())
 * @returns {{ played: true, pendingNegation?: boolean }}
 */
export async function playCommandCardHeadless(game, playerNum, cardName, deps) {
  const {
    getCcEffect, isCcAttachment, resolveAbility,
    dcMessageMeta, dcHealthState, dcExhaustedState,
    getDcEffects: getDcEffectsFn, getDcKeywords: getDcKeywordsFn,
  } = deps;

  const effectData = getCcEffect(cardName);
  const cost = typeof effectData?.cost === 'number' ? effectData.cost : 0;
  const abilityId = effectData?.abilityId ?? cardName;
  const handKey = ccHandKey(playerNum);
  const discardKey = ccDiscardKey(playerNum);
  const hand = game[handKey] || [];
  const idx = hand.indexOf(cardName);
  if (idx < 0) throw new Error(`CC "${cardName}" not found in hand`);

  // Track CC count on combat (matching handler: if (_cbt) _cbt.attackCcCount++)
  const _cbt = game.combat || game.pendingCombat;
  if (_cbt) _cbt.attackCcCount = (_cbt.attackCcCount || 0) + 1;

  // PATH 1: Attachment CCs
  if (isCcAttachment(cardName)) {
    return handleAttachment(game, playerNum, cardName, idx, hand, handKey, abilityId, deps);
  }

  // Build context for resolveAbility
  const baseContext = {
    game,
    playerNum,
    cardName,
    dcMessageMeta,
    dcHealthState,
    dcExhaustedState,
    combat: game.combat || game.pendingCombat,
  };

  // PATH 2: Cost > 0 (resolve before moving card)
  if (cost > 0) {
    return handleCostPositive(game, playerNum, cardName, abilityId, idx, hand,
      handKey, discardKey, baseContext, deps);
  }

  // PATH 3: Cost = 0 (move card first, then negation/resolve)
  return handleCostZero(game, playerNum, cardName, abilityId, idx, hand,
    handKey, discardKey, baseContext, deps);
}

// ── Path 1: Attachment CCs ──────────────────────────────────────────────────

function handleAttachment(game, playerNum, cardName, idx, hand, handKey, abilityId, deps) {
  const {
    getCcEffect, getDcEffects: getDcEffectsFn, getDcKeywords: getDcKeywordsFn,
    resolveAbility, dcMessageMeta, dcHealthState, dcExhaustedState,
  } = deps;

  const dcMsgIds = getDcMessageIds(game, playerNum) || [];
  const dcList = getDcList(game, playerNum) || [];
  if (dcMsgIds.length === 0) throw new Error(`No DCs to attach "${cardName}" to`);

  // Filter by playableBy restriction (mirrors cc-hand.js lines 380-438)
  const ccEffect = getCcEffect(cardName);
  const playableBy = (ccEffect?.playableBy || '').trim();
  const hasRestriction = playableBy && playableBy.toLowerCase() !== 'any figure';

  let eligible = dcMsgIds.map((msgId, i) => ({ msgId, dc: dcList[i], index: i }));

  if (hasRestriction) {
    const allDcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const allKeywords = (getDcKeywordsFn ? getDcKeywordsFn(game) : null) || {};
    const AFFILIATIONS = new Set(['imperial', 'rebel', 'scum', 'mercenary']);
    const alternatives = playableBy.split(/\s+or\s+/i).map(a => a.trim().replace(/^"|"$/g, '').toLowerCase());

    eligible = eligible.filter(({ dc }) => {
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const dcBase = String(dcName || '').replace(/\s*\[(?:DG|Group) \d+\]$/i, '').replace(/\s*\((?:Elite|Regular)\)\s*$/i, '').trim();
      const dcData = allDcEffects[dcName] || allDcEffects[dcBase];
      const affiliationLower = (dcData?.affiliation || '').toLowerCase();
      const kw = allKeywords[dcName] || allKeywords[dcBase] || [];
      const kwLower = kw.map(k => String(k).toLowerCase());

      for (const alt of alternatives) {
        if (alt === 'unique' || alt === 'any unique figure') {
          if (dcData?.unique) return true;
          continue;
        }
        if (alt === 'any small figure') {
          if (kwLower.includes('small')) return true;
          continue;
        }
        const dcLow = dcBase.toLowerCase();
        if (dcLow.includes(alt) || alt.includes(dcLow)) return true;
        const words = alt.split(/\s+/);
        let reqAff = null;
        const reqKwWords = [];
        for (const w of words) {
          if (AFFILIATIONS.has(w) && !reqAff) reqAff = w;
          else reqKwWords.push(w);
        }
        const reqKw = reqKwWords.join(' ');
        if (reqAff && affiliationLower !== reqAff && affiliationLower !== 'any') continue;
        if (reqKw && !kwLower.includes(reqKw)) continue;
        if (reqAff || reqKw) return true;
      }
      return false;
    });
  }

  if (eligible.length === 0) throw new Error(`No eligible DCs for attachment "${cardName}" (playableBy: ${playableBy})`);

  // Pick random eligible DC
  const pick = eligible[Math.floor(Math.random() * eligible.length)];

  // Remove from hand
  hand.splice(idx, 1);
  game[handKey] = hand;

  // Add to ccAttachments
  const attachKey = ccAttachmentsKey(playerNum);
  game[attachKey] = game[attachKey] || {};
  game[attachKey][pick.msgId] = game[attachKey][pick.msgId] || [];
  game[attachKey][pick.msgId].push(cardName);

  // Resolve the attachment's ability effect if any
  const context = {
    game, playerNum, cardName,
    dcMessageMeta: deps.dcMessageMeta,
    dcHealthState: deps.dcHealthState,
    dcExhaustedState: deps.dcExhaustedState,
    combat: game.combat || game.pendingCombat,
    msgId: pick.msgId,
  };
  const result = resolveAbility(abilityId, context);
  if (result.applied) {
    applyReadyDcMsgIds(result, deps);
  }

  return { played: true };
}

// ── Path 2: Cost > 0 (resolve first) ────────────────────────────────────────

function handleCostPositive(game, playerNum, cardName, abilityId, idx, hand,
  handKey, discardKey, baseContext, deps) {
  const { resolveAbility } = deps;

  const result = resolveInline(abilityId, baseContext, deps);

  if (!result.applied && result.manualMessage) {
    throw new Error(`Headless CC play failed for "${cardName}": ${result.manualMessage}`);
  }

  if (result.applied) {
    // Move card from hand to discard
    const handNow = (game[handKey] || []).slice();
    const idxNow = handNow.indexOf(cardName);
    if (idxNow >= 0) handNow.splice(idxNow, 1);
    game[handKey] = handNow;
    game[discardKey] = (game[discardKey] || []).concat(cardName);
    applyReadyDcMsgIds(result, deps);
  }

  return { played: true };
}

// ── Path 3: Cost = 0 (move card, check Negation, then resolve) ──────────────

function handleCostZero(game, playerNum, cardName, abilityId, idx, hand,
  handKey, discardKey, baseContext, deps) {
  const { resolveAbility } = deps;

  // Move card from hand to discard FIRST
  hand.splice(idx, 1);
  game[handKey] = hand;
  game[discardKey] = game[discardKey] || [];
  game[discardKey].push(cardName);

  // Check for Negation in opponent's hand
  const oppNum = opponentPlayerNum(playerNum);
  const oppHandKey = ccHandKey(oppNum);
  const oppHand = game[oppHandKey] || [];
  const hasNegation = oppHand.includes('Negation');

  if (hasNegation) {
    // Set pendingNegation — game loop picks up negation_play/negation_let_resolve
    game.pendingNegation = {
      playedBy: playerNum,
      card: cardName,
      fromDc: false,
      handChannelId: null,
    };
    return { played: true, pendingNegation: true };
  }

  // No Negation — resolve directly
  const result = resolveInline(abilityId, baseContext, deps);

  if (!result.applied && result.manualMessage) {
    throw new Error(`Headless CC play failed for "${cardName}": ${result.manualMessage}`);
  }

  if (result.applied) {
    applyReadyDcMsgIds(result, deps);
  }

  return { played: true };
}

// ── resolveInline: handles choice/space chains ──────────────────────────────

function resolveInline(abilityId, context, deps) {
  const { resolveAbility } = deps;

  let result = resolveAbility(abilityId, context);

  // Handle requiresChoice → pick random option
  if (result.requiresChoice && result.choiceOptions?.length > 0) {
    const choiceIndex = Math.floor(Math.random() * result.choiceOptions.length);
    const chosenFigureKey = result.choiceValues?.[choiceIndex]
      ?? result.targetFigureKeys?.[choiceIndex]
      ?? null;
    result = resolveAbility(abilityId, {
      ...context,
      choiceIndex,
      chosenOption: result.choiceOptions[choiceIndex],
      chosenFigureKey,
    });
  }

  // Handle requiresSpaceChoice → pick random valid space
  if (result.requiresSpaceChoice && result.validSpaces?.length > 0) {
    const chosenSpace = result.validSpaces[Math.floor(Math.random() * result.validSpaces.length)];
    result = resolveAbility(abilityId, {
      ...context,
      chosenSpace,
      chosenFigureKey: result.chosenFigureKey ?? context.chosenFigureKey ?? null,
    });
  }

  return result;
}

// ── applyReadyDcMsgIds: the ONLY game-state side effect from applyAbilityResult ─

function applyReadyDcMsgIds(result, deps) {
  if (result.readyDcMsgIds?.length && deps.dcExhaustedState) {
    for (const id of result.readyDcMsgIds) {
      deps.dcExhaustedState.set(id, false);
    }
  }
}

// ── canResolveCcHeadless: pre-selection deep precondition filter ──────────────

/**
 * Check whether a CC can actually resolve headlessly given current game state.
 * Called in the training loop to filter out play_cc actions before the AI sees them.
 * Returns false for CCs whose timing passes but deep preconditions fail.
 *
 * @param {object} game - Game state
 * @param {number} playerNum - 1 or 2
 * @param {string} cardName - CC name
 * @param {object} deps - Headless deps bag
 * @returns {boolean}
 */
export function canResolveCcHeadless(game, playerNum, cardName, deps) {
  const { getCcEffect, getAbility, getDcEffects: getDcEffectsFn, getDcStats: getDcStatsFn } = deps;
  const effectData = getCcEffect(cardName);
  const abilityId = effectData?.abilityId ?? cardName;
  const entry = getAbility(abilityId);
  if (!entry) return false;

  // Negation: reactive only — never played proactively
  if (abilityId === 'Negation' || entry.negateCostZeroCc) return false;

  // Attack-declaration CCs: timing maps to duringActivation but handler needs active combat as attacker
  const timing = (effectData?.timing || '').toLowerCase().trim();
  if (['whenyoudeclareattack', 'beforeyoudeclareattack', 'beforedeclaringrangedattack'].includes(timing)) {
    const cbt = game.combat || game.pendingCombat;
    if (!cbt || cbt.attackerPlayerNum !== playerNum) return false;
  }

  // Most CCs played during activation need an active DC to resolve — their handlers call
  // findActiveActivationMsgId to find the activating figure. Combat-phase and round-phase
  // CCs don't need this (they use combat context or global game state).
  const TIMING_NO_DC_NEEDED = new Set([
    'startofround', 'startofstatusphase', 'endofround',
    'duringattack', 'whiledefending', 'whenattackdeclaredonyou',
    'afterattack', 'afterattackdice',
    'afteryouresolveattackthatdidnotmissduetoaccuracy',
    'afterattacktargetingyouresolved',
    'whileattackingbeforedefenderrerolls',
    'afteryouresolveattacktargetingfigure',
    'whenyoudeclareattacktargetinghostilewithhighestfigurecost',
    'whenyoudeclareclosequarters', 'whenyoudeclareindiscriminatefire',
    'whenyouperformrapidfire',
    'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight',
    'whenfigurewithin3spacesdefending',
    'whenfriendlyrebelforceuserwithin4spacesrollsdice',
    'whileadjacentfriendlyfiguredefending',
    // Attack-declaration timings (handled above by combat check)
    'whenyoudeclareattack', 'beforeyoudeclareattack', 'beforedeclaringrangedattack',
  ]);
  if (!TIMING_NO_DC_NEEDED.has(timing)) {
    const activeMsgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    if (!activeMsgId) return false;
  }

  // Celebration: requires kill during this activation
  if (entry.celebrationVp && !entry.increaseArmyCostBy) {
    const killCounts = game.activationKills || {};
    const totalKills = Object.values(killCounts).reduce((sum, n) => sum + (n || 0), 0);
    if (totalKills < 1) return false;
  }

  // placeDefeatedFigure (Reinforcements, Cloned Reinforcements): requires defeated eligible figures
  if (entry.placeDefeatedFigure) {
    const dcList = getDcList(game, playerNum) || [];
    const poses = game.figurePositions?.[playerNum] || {};
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    let hasDefeated = false;
    for (const dc of dcList) {
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const baseName = dcName.replace(/\s*\[(?:DG|Group) \d+\]$/i, '').trim();
      const stats = getDcStatsFn ? getDcStatsFn(baseName) : null;
      const figCount = stats?.figures ?? 1;
      const dgMatch = (dc.displayName || dcName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : '1';
      const prefix = `${baseName}-${dgIndex}-`;
      let alive = 0;
      for (const k of Object.keys(poses)) {
        if (k.startsWith(prefix)) alive++;
      }
      if (alive < figCount) { hasDefeated = true; break; }
    }
    if (!hasDefeated) return false;
  }

  // mpCost (Shared Experience): requires movement points
  if (entry.mpCost > 0 && entry.applyFocus) {
    const msgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    const bank = game.movementBank?.[msgId];
    if (!bank || (bank.remaining ?? 0) < entry.mpCost) return false;
  }

  // ferocityEffect: requires CREATURE in play
  if (entry.ferocityEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const hasCre = [1, 2].some(pn =>
      Object.keys(game.figurePositions?.[pn] || {}).some(fk => {
        const dcN = fk.replace(/-\d+-\d+$/, '');
        return (dcEffects[dcN]?.keywords || []).some(k => k.toUpperCase() === 'CREATURE');
      }));
    if (!hasCre) return false;
  }

  // callTheVanguardEffect: requires TROOPER cost 4+ in play for this player
  if (entry.callTheVanguardEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const hasTrooper4 = Object.keys(game.figurePositions?.[playerNum] || {}).some(fk => {
      const dcN = fk.replace(/-\d+-\d+$/, '');
      const eff = dcEffects[dcN] || {};
      return (eff.keywords || []).some(k => k.toUpperCase() === 'TROOPER') && (eff.cost ?? 0) >= 4;
    });
    if (!hasTrooper4) return false;
  }

  // requireHighestCostTarget (Primary Target): requires combat target
  if (entry.requireHighestCostTarget) {
    const cbt = game.combat || game.pendingCombat;
    if (!cbt?.defenderFigureKey) return false;
  }

  // opponentDiscardFromHandChoice (Intelligence Leak): requires opponent hand non-empty
  if (entry.opponentDiscardFromHandChoice) {
    const oppHand = game[ccHandKey(opponentPlayerNum(playerNum))] || [];
    if (oppHand.length === 0) return false;
  }

  // supportSpecialistEffect: requires active activation
  if (entry.supportSpecialistEffect) {
    const msgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    if (!msgId) return false;
  }

  return true;
}

// ── Local helper: find active activation msg ID (mirrors abilities.js:9343) ──

function findActiveActivationMsgIdLocal(game, playerNum, dcMessageMeta) {
  if (!game?.dcActionsData || !dcMessageMeta) return null;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId === game.gameId && meta?.playerNum === playerNum && game.dcActionsData?.[msgId]) {
      return msgId;
    }
  }
  return null;
}
