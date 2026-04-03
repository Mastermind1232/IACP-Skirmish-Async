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
  getDcList, getDcMessageIds, dcMatchesPlayableBy,
} from '../game/player-helpers.js';
import { getRange } from '../game/spatial.js';

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

  // Filter by playableBy restriction using shared helper
  const ccEffect = getCcEffect(cardName);
  const playableBy = (ccEffect?.playableBy || '').trim();
  const hasRestriction = playableBy && playableBy.toLowerCase() !== 'any figure';

  let eligible = dcMsgIds.map((msgId, i) => ({ msgId, dc: dcList[i], index: i }));

  if (hasRestriction) {
    eligible = eligible.filter(({ dc }) => {
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      return dcMatchesPlayableBy(dcName, playableBy, getDcEffectsFn, getDcKeywordsFn, game);
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
    // Graceful no-op: precondition passed but ability couldn't resolve (race condition / edge case).
    // Card stays in hand; no game state mutation; no bad training signal.
    return { played: false, skipped: true, reason: result.manualMessage };
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
    // Graceful no-op: card already in discard (cost=0 path), no effect applied.
    // Better than throwing — no [CC FAIL] training noise.
    return { played: true, skipped: true, reason: result.manualMessage };
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
  let ctx = { ...context };

  // Handle cascaded choices (e.g., chooseOne → powerTokenGain figure selection)
  for (let i = 0; i < 5 && result.requiresChoice && result.choiceOptions?.length > 0; i++) {
    const choiceIndex = Math.floor(Math.random() * result.choiceOptions.length);
    const chosenFigureKey = result.choiceValues?.[choiceIndex]
      ?? result.targetFigureKeys?.[choiceIndex]
      ?? null;
    ctx = {
      ...ctx,
      choiceIndex,
      chosenOption: result.choiceOptions[choiceIndex],
      chosenFigureKey,
    };
    result = resolveAbility(abilityId, ctx);
  }

  // Handle requiresSpaceChoice → pick random valid space
  if (result.requiresSpaceChoice && result.validSpaces?.length > 0) {
    const chosenSpace = result.validSpaces[Math.floor(Math.random() * result.validSpaces.length)];
    result = resolveAbility(abilityId, {
      ...ctx,
      chosenSpace,
      chosenFigureKey: result.chosenFigureKey ?? ctx.chosenFigureKey ?? null,
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

// Timing sets for combat-phase CCs
const ATTACKER_TIMINGS = new Set([
  'whenyoudeclareattack', 'beforeyoudeclareattack', 'beforedeclaringrangedattack',
  'duringattack', 'afterattack',
  'afteryouresolveattackthatdidnotmissduetoaccuracy',
  'afteryouresolveattacktargetingfigure',
  'whileattackingbeforedefenderrerolls',
  'whenyoudeclareattacktargetinghostilewithhighestfigurecost',
  'whenyoudeclareclosequarters', 'whenyoudeclareindiscriminatefire',
  'whenyouperformrapidfire',
]);
const DEFENDER_TIMINGS = new Set([
  'whenattackdeclaredonyou', 'whiledefending',
  'afterattacktargetingyouresolved',
]);
const COMBAT_ANY_TIMINGS = new Set([
  'afterattackdice', 'afterdamage',
  'whenfigurewithin3spacesdefending',
  'whileadjacentfriendlyfiguredefending',
  'whenfriendlyrebelforceuserwithin4spacesrollsdice',
  'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight',
]);
const EVENT_DRIVEN_TIMINGS = new Set([
  'whenhostilefigureexitsadjacentspace',
  'whenhostilefigureentersadjacentspace',
]);

/** Extract base DC name from a figure key like "Stormtrooper-1-0" → "Stormtrooper". */
function figKeyToDcName(figureKey) {
  return figureKey.replace(/-\d+-\d+$/, '');
}

/** Get the position of the "source" figure for a CC — the figure that's playing it. */
function getSourceFigurePos(game, playerNum, activeMsgId, cbt, timing, dcMessageMeta) {
  // Combat: use attacker/defender figure position
  if (ATTACKER_TIMINGS.has(timing) && cbt?.attackerFigureKey) {
    return game.figurePositions?.[cbt.attackerPlayerNum]?.[cbt.attackerFigureKey] || null;
  }
  if (DEFENDER_TIMINGS.has(timing) && cbt?.defenderFigureKey) {
    return game.figurePositions?.[cbt.defenderPlayerNum]?.[cbt.defenderFigureKey] || null;
  }
  if (COMBAT_ANY_TIMINGS.has(timing) && cbt?.attackerFigureKey) {
    return game.figurePositions?.[cbt.attackerPlayerNum]?.[cbt.attackerFigureKey] || null;
  }
  // Activation: use active DC's first alive figure
  if (activeMsgId && dcMessageMeta) {
    const meta = dcMessageMeta.get(activeMsgId);
    if (meta?.dcName) {
      const poses = game.figurePositions?.[playerNum] || {};
      for (const [fk, pos] of Object.entries(poses)) {
        if (figKeyToDcName(fk) === meta.dcName) return pos;
      }
    }
  }
  return null;
}

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
  const {
    getCcEffect, getAbility,
    getDcEffects: getDcEffectsFn, getDcStats: getDcStatsFn, getDcKeywords: getDcKeywordsFn,
  } = deps;
  const effectData = getCcEffect(cardName);
  const abilityId = effectData?.abilityId ?? cardName;
  const entry = getAbility(abilityId);
  if (!entry) return false;

  // Negation: reactive only — never played proactively
  if (abilityId === 'Negation' || entry.negateCostZeroCc) return false;

  const timing = (effectData?.timing || '').toLowerCase().trim();
  const cbt = game.combat || game.pendingCombat;
  const oppNum = opponentPlayerNum(playerNum);

  // ── 1. COMBAT TIMING GATES ──────────────────────────────────────────────────
  // Combat-phase CCs need active combat with the correct role (attacker/defender).

  if (ATTACKER_TIMINGS.has(timing)) {
    if (!cbt || cbt.attackerPlayerNum !== playerNum) return false;
  }
  if (DEFENDER_TIMINGS.has(timing)) {
    if (!cbt || cbt.defenderPlayerNum !== playerNum) return false;
  }
  if (COMBAT_ANY_TIMINGS.has(timing)) {
    if (!cbt) return false;
  }

  // Event-driven reactive CCs: triggered by movement/death events, never proactively playable
  if (EVENT_DRIVEN_TIMINGS.has(timing)) return false;

  // ── 2. ACTIVE DC REQUIREMENT ────────────────────────────────────────────────
  // Activation-phase CCs need an active DC. Combat/round/event CCs use combat context.

  const ALL_NO_DC_TIMINGS = new Set([
    ...ATTACKER_TIMINGS, ...DEFENDER_TIMINGS, ...COMBAT_ANY_TIMINGS, ...EVENT_DRIVEN_TIMINGS,
    'startofround', 'startofstatusphase', 'endofround',
  ]);

  let activeMsgId = null;
  if (!ALL_NO_DC_TIMINGS.has(timing)) {
    activeMsgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    if (!activeMsgId) return false;
  }

  // ── 3. PLAYABLE-BY KEYWORD RESTRICTION ──────────────────────────────────────
  // The figure playing the CC must match the keyword restriction.
  // During activation → activating DC. During combat → attacker/defender figure.

  const playableBy = (effectData?.playableBy || '').trim();
  const hasRestriction = playableBy && playableBy.toLowerCase() !== 'any figure';
  const isAttachment = deps.isCcAttachment ? deps.isCcAttachment(cardName) : false;

  // Attachment CCs with playableBy: verify at least one DC matches BEFORE handleAttachment
  if (hasRestriction && isAttachment) {
    const dcMsgIds = getDcMessageIds(game, playerNum) || [];
    if (dcMsgIds.length === 0) return false;
    const hasEligibleDc = dcMsgIds.some(msgId => {
      const meta = deps.dcMessageMeta?.get(msgId);
      const dcName = meta?.dcName || '';
      return dcMatchesPlayableBy(dcName, playableBy, getDcEffectsFn, getDcKeywordsFn, game);
    });
    if (!hasEligibleDc) return false;
  }

  if (hasRestriction && !isAttachment) {
    let checkDcName = null;
    if (activeMsgId) {
      // Activation phase: check the activating DC
      const meta = deps.dcMessageMeta?.get(activeMsgId);
      checkDcName = meta?.dcName || null;
    } else if (ATTACKER_TIMINGS.has(timing) && cbt?.attackerFigureKey) {
      // Attacker combat CC: check the attacking figure's DC
      checkDcName = figKeyToDcName(cbt.attackerFigureKey);
    } else if (DEFENDER_TIMINGS.has(timing) && cbt?.defenderFigureKey) {
      // Defender combat CC: check the defending figure's DC
      checkDcName = figKeyToDcName(cbt.defenderFigureKey);
    }
    if (checkDcName && !dcMatchesPlayableBy(checkDcName, playableBy, getDcEffectsFn, getDcKeywordsFn, game)) {
      return false;
    }
  }

  // ── 4. SPECIFIC ABILITY PRECONDITIONS ───────────────────────────────────────

  // Reactive CCs whose handlers call findActiveActivationMsgId on the defending player.
  // During the attacker's turn, the defender doesn't have an active activation,
  // so these fail unless the defender happens to have an active DC from their turn.
  if ((typeof entry.mpBonusFromSpeed === 'number' || entry.mpBonus > 0 || entry.paybackEffect)
    && DEFENDER_TIMINGS.has(timing)) {
    const defenderMsgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    if (!defenderMsgId) return false;
  }

  // Lure of the Dark Side: multi-step hostile-figure-choice flow, not headless-resolvable
  if (entry.lureOfTheDarkSide) return false;

  // Reduce to Rubble (placeRubbleOnTargetAndAdjacent): needs stored attack target
  if (entry.placeRubbleOnTargetAndAdjacent) {
    if (!game.lastAttackTargetSpacesForRubble?.length) return false;
    if (game.lastAttackAttackerPlayerNum !== playerNum) return false;
  }

  // Assassinate (mutualExcludeAttackCc): must be first CC this attack
  if (entry.mutualExcludeAttackCc) {
    if (!cbt || (cbt.attackCcCount || 0) > 0) return false;
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
    const msgId = activeMsgId || findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    const bank = game.movementBank?.[msgId];
    if (!bank || (bank.remaining ?? 0) < entry.mpCost) return false;
  }

  // ferocityEffect: requires CREATURE in play
  if (entry.ferocityEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const hasCre = [1, 2].some(pn =>
      Object.keys(game.figurePositions?.[pn] || {}).some(fk => {
        const dcN = figKeyToDcName(fk);
        return (dcEffects[dcN]?.keywords || []).some(k => k.toUpperCase() === 'CREATURE');
      }));
    if (!hasCre) return false;
  }

  // callTheVanguardEffect: requires TROOPER cost 4+ in play for this player
  if (entry.callTheVanguardEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const hasTrooper4 = Object.keys(game.figurePositions?.[playerNum] || {}).some(fk => {
      const dcN = figKeyToDcName(fk);
      const eff = dcEffects[dcN] || {};
      return (eff.keywords || []).some(k => k.toUpperCase() === 'TROOPER') && (eff.cost ?? 0) >= 4;
    });
    if (!hasTrooper4) return false;
  }

  // requireHighestCostTarget (Primary Target): requires combat target
  if (entry.requireHighestCostTarget) {
    if (!cbt?.defenderFigureKey) return false;
  }

  // opponentDiscardFromHandChoice (Intelligence Leak): requires opponent hand non-empty
  if (entry.opponentDiscardFromHandChoice) {
    const oppHand = game[ccHandKey(oppNum)] || [];
    if (oppHand.length === 0) return false;
  }

  // forcePushEffect (Force Push): needs SMALL hostile within 3 spaces of source figure
  if (entry.forcePushEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const oppPoses = game.figurePositions?.[oppNum] || {};
    const srcPos = getSourceFigurePos(game, playerNum, activeMsgId, cbt, timing, deps.dcMessageMeta);
    const hasSmallInRange = Object.entries(oppPoses).some(([fk, pos]) => {
      const dcN = figKeyToDcName(fk);
      const isSmall = (dcEffects[dcN]?.keywords || []).some(k => k.toUpperCase() === 'SMALL');
      if (!isSmall) return false;
      if (srcPos && pos) return getRange(srcPos, pos) <= 4; // 3 range + 1 Massive buffer
      return true; // no position info — be conservative
    });
    if (!hasSmallInRange) return false;
  }

  // darkEnergyEffect (Dark Energy): needs SMALL hostile within 3 spaces of source figure
  if (entry.darkEnergyEffect) {
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const oppPoses = game.figurePositions?.[oppNum] || {};
    const srcPos = getSourceFigurePos(game, playerNum, activeMsgId, cbt, timing, deps.dcMessageMeta);
    const hasSmallInRange = Object.entries(oppPoses).some(([fk, pos]) => {
      const dcN = figKeyToDcName(fk);
      const isSmall = (dcEffects[dcN]?.keywords || []).some(k => k.toUpperCase() === 'SMALL');
      if (!isSmall) return false;
      if (srcPos && pos) return getRange(srcPos, pos) <= 4; // 3 range + 1 Massive buffer
      return true; // no position info — be conservative
    });
    if (!hasSmallInRange) return false;
  }

  // supportSpecialistEffect (Support Specialist): needs friendly DROID/TECHNICIAN/TROOPER within 3 of source
  if (entry.supportSpecialistEffect) {
    if (!activeMsgId) activeMsgId = findActiveActivationMsgIdLocal(game, playerNum, deps.dcMessageMeta);
    if (!activeMsgId) return false;
    const dcEffects = (getDcEffectsFn ? getDcEffectsFn() : null) || {};
    const myPoses = game.figurePositions?.[playerNum] || {};
    const SUPPORT_KW = new Set(['droid', 'technician', 'trooper']);
    const srcPos = getSourceFigurePos(game, playerNum, activeMsgId, cbt, timing, deps.dcMessageMeta);
    const hasEligible = Object.entries(myPoses).some(([fk, pos]) => {
      const dcN = figKeyToDcName(fk);
      const hasKw = (dcEffects[dcN]?.keywords || []).some(k => SUPPORT_KW.has(k.toLowerCase()));
      if (!hasKw) return false;
      if (srcPos && pos) return getRange(srcPos, pos) <= 3;
      return true; // no position info — be conservative
    });
    if (!hasEligible) return false;
  }

  // chooseAdjacentHostileThen: need a hostile within range of the source figure
  if (entry.chooseAdjacentHostileThen) {
    const cah = entry.chooseAdjacentHostileThen;
    const cahRange = cah.range ?? 1;
    if (cahRange < 99) { // range 99 = targetAll (all with LOS), no proximity check
      const srcPos = getSourceFigurePos(game, playerNum, activeMsgId, cbt, timing, deps.dcMessageMeta);
      if (srcPos) {
        const oppPoses = game.figurePositions?.[oppNum] || {};
        // +1 buffer for Massive figure footprints (2x2 anchor offset)
        const hasInRange = Object.values(oppPoses).some(pos =>
          pos && getRange(srcPos, pos) <= cahRange + 1
        );
        if (!hasInRange) return false;
      }
    }
  }

  // chooseAdjacentHostileThen with requireBeneficialCondition (Disorient): needs hostile with Focus/Hidden
  if (entry.chooseAdjacentHostileThen?.requireBeneficialCondition) {
    const oppPoses = game.figurePositions?.[oppNum] || {};
    const oppFigures = Object.keys(oppPoses);
    if (oppFigures.length === 0) return false;
    // Check if any opponent figure has a beneficial condition (Focus or Hidden)
    const hasBeneficial = oppFigures.some(fk => {
      const conds = game.figureConditions?.[fk] || [];
      return conds.includes('Focus') || conds.includes('Hide');
    });
    if (!hasBeneficial) return false;
  }

  // Collateral Damage (flatDamageToFigureWithin): needs combat target to know where to look
  if (entry.flatDamageToFigureWithin) {
    if (!cbt?.defenderFigureKey) return false;
  }

  // Sniper Configuration (attackAccuracyBonus + attackBonusPierce, specialAction):
  // Card says "Special Action: Perform an attack" — initiates combat, not headless-resolvable.
  // The ability only adds bonuses to an existing combat, but no combat exists during a Special Action.
  if (entry.attackAccuracyBonus && entry.attackBonusPierce && timing === 'specialaction') {
    return false;
  }

  // Devotion (devotionEffect): needs adjacent friendly figure to the activating DC
  if (entry.devotionEffect) {
    if (!activeMsgId) return false;
    const meta = deps.dcMessageMeta?.get(activeMsgId);
    if (!meta?.dcName) return false;
    const poses = game.figurePositions?.[playerNum] || {};
    // Find activating figure position
    const actFk = Object.keys(poses).find(fk => figKeyToDcName(fk) === meta.dcName);
    const actPos = actFk ? poses[actFk] : null;
    if (!actPos) return false;
    // Check for at least one adjacent friendly (not self)
    const hasAdj = Object.entries(poses).some(([fk, pos]) => {
      if (fk === actFk || !pos) return false;
      return getRange(actPos, pos) <= 1;
    });
    if (!hasAdj) return false;
  }

  // Smoke Grenade (chooseSpaceWithin2OfActivating): needs at least one valid space within 2
  if (entry.chooseSpaceWithin2OfActivating) {
    if (!activeMsgId) return false;
    const meta = deps.dcMessageMeta?.get(activeMsgId);
    if (!meta?.dcName) return false;
    const poses = game.figurePositions?.[playerNum] || {};
    const actFk = Object.keys(poses).find(fk => figKeyToDcName(fk) === meta.dcName);
    const actPos = actFk ? poses[actFk] : null;
    if (!actPos) return false;
    // Verify at least one map space within range 2 exists (handles edge-case map geometry)
    if (deps.getBoardStateForMovement) {
      const bs = deps.getBoardStateForMovement(game, null);
      const adj = bs?.mapSpaces?.adjacency;
      if (adj) {
        const posKey = String(actPos).toLowerCase();
        const ring1 = adj[posKey] || [];
        if (ring1.length === 0) return false; // completely isolated
        const ring2 = new Set(ring1.map(s => String(s).toLowerCase()));
        for (const s of ring1) {
          for (const s2 of (adj[String(s).toLowerCase()] || [])) ring2.add(String(s2).toLowerCase());
        }
        ring2.delete(posKey);
        if (ring2.size === 0) return false;
      }
    }
  }

  // powerTokenGain (Looking for a Fight, Apex Predator, etc.): at least one allied figure needs room
  if (entry.powerTokenGain > 0) {
    const myPoses = game.figurePositions?.[playerNum] || {};
    const MAX_TOKENS = 2; // Standard IA max (3 for Locked and Loaded, but safe floor)
    const hasRoom = Object.keys(myPoses).some(fk => {
      const tokens = game.figurePowerTokens?.[fk] || [];
      return tokens.length < MAX_TOKENS;
    });
    if (!hasRoom) return false;
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
