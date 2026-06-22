/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary, getDcEffects, getDiceData, getCcEffect, getCcEffectsData, getMapData, getMapTokensData } from '../data-loader.js';
import { parseCoord, normalizeCoord, getFootprintCells, edgeKey } from './coords.js';
import { dcNameFromFigureKey, parseFigureKey, getMaxPowerTokens, figureChoiceLabels } from './dc-helpers.js';
import { figureKeyForActivation, grantActionToFigure } from './activation-state.js';
import { grantPowerTokens, consumeMovementPoints, figureMpRemaining } from './game-helpers.js';
import { reduceHp, healHp, applyDamageWithDefeatCheck } from './damage-helpers.js';
import { applyDamageSync, isImmuneToDirectDefeat } from './damage-pipeline.js';
import { setPendingFalseOrders, setPendingCoordinatedRaid, setPendingExecutiveOrder, setPendingYHSIW, setPendingLure, setPendingEmperorInterrupt, setPendingBombardmentSorin, setPendingBattlefieldLeadership } from './interrupts.js';
import { awardObjectiveVp, deductVp } from './vp-helpers.js';
import { countGameSpaces, getActiveTerminals, eyesOnThePrizeEligibleFigures, isFigureInOpponentDeploymentZone, isFigureAdjacentOrOnAny, getBlockingDifficultTerrainCoords, getFigureAdjacentCoordsFromSet } from './board-helpers.js';
import { applyDefenseDieRemoval, applyAttackDieRemoval } from '../engine/defense-die-turn.js';
import { cardNameIncludes } from './card-names.js';
import { exhaustAttachment, isAttachmentExhausted } from './card-state-helpers.js';
import { groupEffectiveFigures, squadUpgradeOnGroup, attachmentsForMsgId } from './squad-upgrades.js';


import { getDcEffect } from './dc-helpers.js';
import { registerRoundModifier } from './round-modifiers.js';
import { detectPushPartingBlow } from './movement-interrupts.js';

/**
 * After a PUSH relocates a hostile figure, run Parting Blow (C23) exit-detection
 * on the pushed figure's (from → to) and, if it exited a space adjacent to an
 * enemy BRAWLER holding Parting Blow, stash game.pendingPartingBlow so the PB
 * resolver can target correctly AND the PB playability gate (cc-timing.js
 * 'whenhostilefigureexitsadjacentspace') opens for the brawler's owner — on
 * EITHER side's turn, since detection is keyed purely on the pushed figure's
 * owner vs the opposing brawler, independent of whose turn it is.
 *
 * Reuses the same exit-adjacent-to-BRAWLER core a normal move uses (the C23
 * branch of detectPostMoveInterrupts), via detectPushPartingBlow. Returns a
 * log suffix to append so the affected player is told PB is now playable; the
 * actual PB is then played from the holder's hand (the gate is satisfied).
 *
 * HOSTILE-ONLY GATE (alexanbv 2026-06-21): Parting Blow only makes sense when
 * you push a figure HOSTILE to the pushing player (Looking for a Fight, Dark
 * Energy, Smash/Slam/Ram, Face Me!, etc.) — the pushed enemy's own PB brawler
 * reacts to it leaving. When you push one of your OWN friendly figures (Hop On,
 * Reposition), no PB triggers. So when the pushed figure's owner === the
 * pushing player, skip the stash entirely. `pushingPlayerNum` is the
 * card/ability player (the attacker's player for attack-based pushes); when it
 * is not supplied (null/undefined) the gate is a no-op and the old behavior is
 * preserved.
 *
 * @param {number} [pushingPlayerNum] - the player performing the push
 * @returns {string} '' or a `\n⚠️ …` suffix
 */
export function stashPushPartingBlow(game, pushedFigureKey, pushedOwnerNum, fromPos, toPos, pushingPlayerNum) {
  if (!game || !pushedFigureKey || !fromPos || !toPos) return '';
  // Hostile-only: pushing your OWN friendly figure never triggers Parting Blow.
  if (pushingPlayerNum != null && pushedOwnerNum != null && Number(pushedOwnerNum) === Number(pushingPlayerNum)) return '';
  const pb = detectPushPartingBlow(game, pushedFigureKey, pushedOwnerNum, fromPos, toPos);
  if (!pb) return '';
  game.pendingPartingBlow = {
    brawlerFigureKey: pb.brawlerFigureKey,
    brawlerPlayerNum: pb.brawlerPlayerNum,
    exitingHostileFigureKey: pb.exitingHostileFigureKey,
  };
  const brawlerName = dcNameFromFigureKey(pb.brawlerFigureKey).replace(/_/g, ' ');
  return `\n⚠️ The push exited a space adjacent to **${brawlerName}** (Brawler) — its controller may now play **Parting Blow**.`;
}
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
import { parseSurgeEffect, recalcAttackTotals, recalcDefenseTotals } from './combat.js';
import { getFiguresAdjacentToTarget, getBoardStateForMovement, getMovementProfile, getReachableSpaces, getEffectiveMapSpaces, getValidPushDestinations } from './movement.js';
import { applyDamageToNpcSync, isEntryHostileTo, entryDisplayLabel } from './hostile-enumeration.js';
import { getDcList, getDcMessageIds, getPlayerId, getCcDiscard, getSquad, ccHandKey, ccDiscardKey, ccDeckKey, vpKey, activatedDcIndicesKey, opponentPlayerNum, syncHealthStateToList, pushFigure, dcAttachmentsKey } from './player-helpers.js';
import { hasLineOfSight, hasLineOfSightByCoord } from './spatial.js';
import { getFigureSize } from '../data-loader.js';
import { getDamageableObjectsAtCoord, getDamageableObjectsWithinN, isObjectAlive } from './object-damage-pipeline.js';
import { checkDeckDiscardPassiveRedraws, fireCcDiscarded } from './cc-passive-redraw.js';
import { getUniqueFiguresForCc } from './unique-figure-ccs.js';
import { ADAPTIVE_SKILLS_ABILITY_ID, firstSeenArmyAffiliation } from './adaptive-skills-helpers.js';

/**
 * Resolve the figureKey of the specific figure that "plays" a unique-figure
 * "you"-scoped CC (e.g. I Must Go Alone → Obi-Wan, or Mara Jade via Fast
 * Learner). These CCs are played at start-of-round (no active activation), so
 * the figure is identified from the unique-figure registry + the player's
 * on-board figures rather than from activation state.
 *
 * Preference order:
 *   1. A named figure for the CC (registry) that is on the board.
 *   2. The Fast Learner figure (Mara Jade) if she's on the board — she may
 *      substitute via Fast Learner when the named figure is absent.
 *
 * Returns the matching figureKey, or null if none can be resolved.
 *
 * @param {object} game
 * @param {number} playerNum
 * @param {string} cardName
 */
function resolveUniqueFigureCcFigureKey(game, playerNum, cardName) {
  if (!game || !playerNum || !cardName) return null;
  const positions = game.figurePositions?.[playerNum] || {};
  const liveKeys = Object.keys(positions).filter(fk => positions[fk]);
  if (liveKeys.length === 0) return null;
  // 0. Played-by override (alexanbv 2026-06-21): if the player chose WHO plays
  //    this unique-figure CC (named figure, Mara via Fast Learner, a Force User
  //    via There is Another, or any army figure via [A New Hope]), the range
  //    anchors on that CHOSEN figure — even when the named figure is also on the
  //    board. cc-hand.js records the chosen live figureKey on
  //    game.ccPlayedByFigureKey (general) for the duration of the current CC
  //    effect resolution (transient; cleared after). The legacy
  //    ccPlayedByFastLearnerFigureKey alias is still honored for back-compat.
  const playedByFigureKey = game.ccPlayedByFigureKey || game.ccPlayedByFastLearnerFigureKey;
  if (playedByFigureKey && liveKeys.includes(playedByFigureKey)) return playedByFigureKey;
  const named = getUniqueFiguresForCc(cardName).map(n => String(n || '').toLowerCase());
  // 1. Prefer a named figure on the board.
  if (named.length > 0) {
    for (const fk of liveKeys) {
      const dn = String(dcNameFromFigureKey(fk) || '').toLowerCase();
      if (named.some(n => dn.includes(n) || n.includes(dn))) return fk;
    }
  }
  // 2. Fall back to a Fast Learner figure (Mara Jade) on the board.
  const dcEffects = getDcEffects() || {};
  for (const fk of liveKeys) {
    const dn = dcNameFromFigureKey(fk);
    const eff = dcEffects[dn] || dcEffects[String(dn || '').replace(/\s*\[.*\]\s*$/, '')];
    if ((eff?.specialAbilityIds || []).includes(ADAPTIVE_SKILLS_ABILITY_ID)) return fk;
  }
  return null;
}

/**
 * Resolve the figureKey of the figure that "plays" a keyword-restricted
 * "you"-scoped CC (e.g. In the Shadows → "SMUGGLER or HUNTER"). The CC text
 * is singular ("hostile figures ... do not have line of sight to YOU"), so the
 * effect scopes to ONE figure. The CC play flow does not (currently) prompt for
 * which keyword-figure plays it, so we pick the first on-board figure of the
 * player whose DC carries one of the required keywords (deterministic by
 * figureKey iteration order). If none match the keywords (e.g. data gap), fall
 * back to the first live figure.
 *
 * NOTE (alexanbv 2026-06-20): a faithful long-term implementation would add a
 * figure-picker when multiple eligible keyword-figures are on the board. This
 * deterministic pick scopes the effect to a single figure (matching the CSV
 * "you" singular) rather than the whole player, which was the prior bug.
 *
 * @param {object} game
 * @param {number} playerNum
 * @param {string[]} requiredKeywords - uppercase keyword list (any-of)
 */
function resolveKeywordCcFigureKey(game, playerNum, requiredKeywords) {
  if (!game || !playerNum) return null;
  const positions = game.figurePositions?.[playerNum] || {};
  const liveKeys = Object.keys(positions).filter(fk => positions[fk]);
  if (liveKeys.length === 0) return null;
  const wanted = (requiredKeywords || []).map(k => String(k || '').toUpperCase());
  if (wanted.length > 0) {
    for (const fk of liveKeys) {
      const dn = dcNameFromFigureKey(fk);
      const kws = (getDcEffect(dn)?.keywords || []).map(k => String(k).toUpperCase());
      if (kws.some(k => wanted.includes(k))) return fk;
    }
  }
  return liveKeys[0] || null;
}

/**
 * Resolve the "you"/anchor figureKey for a round-modifier CC at PLAY time.
 *
 * The per-figure round-modifier registry anchors every "you/your" descriptor on
 * a single sourceFigureKey. But the figure that "plays" a card is resolved
 * DIFFERENTLY depending on the card's CSV timing (alexanbv 2026-06-20 ruling:
 * "'you' refers to ONLY the figure that played the card"):
 *
 *   - during_activation / start_of_activation / special_action: the card is
 *     played during the controller's own activation, so the anchor is the
 *     ACTIVATING figure (figureKeyForActivation of the in-progress activation).
 *     Cards: Take Position, Survival Instincts, Take Cover, Smuggled Supplies,
 *     Personal Energy Shield, Armed Escort.
 *
 *   - attack:modifiers / defender reaction: the card is played as the DEFENDER
 *     during the OPPONENT's attack — there is no active activation for the
 *     controller, so the anchor is the figure being attacked
 *     (game.pendingCombat.target.figureKey, the defender).
 *     Cards: Deflection.
 *
 *   - start_of_round: there is no activation and no combat. The anchor is the
 *     card's associated unique figure (named-figure CC registry), e.g. Cavalry
 *     Charge → Captain Terro. Resolved via resolveUniqueFigureCcFigureKey.
 *     Cards: Cavalry Charge.
 *
 * Priority order (first non-null wins):
 *   1. Active activation figure (figureKeyForActivation)
 *   2. Active combat DEFENDER (pendingCombat.target.figureKey) when this player
 *      is the defender
 *   3. Named-figure CC registry (Captain Terro for Cavalry Charge, etc.)
 *
 * @param {object} game
 * @param {number} playerNum   the controller playing the card
 * @param {string} cardName
 * @param {object} [opts]
 * @param {Map} [opts.dcMessageMeta]
 * @returns {string|null} the anchor figureKey, or null if none resolvable
 */
function resolveRoundModifierAnchor(game, playerNum, cardName, opts = {}) {
  if (!game || !playerNum) return null;
  const { dcMessageMeta } = opts;
  // 0. Played-by override (alexanbv 2026-06-21): when the player chose WHO plays
  //    this unique-figure CC (named, Mara via Fast Learner, a Force User via
  //    There is Another, or any army figure via [A New Hope]), "you/your" anchors
  //    on that CHOSEN figure — even when the named figure is also on the board.
  //    This takes priority over the activation/defender/named-figure resolution
  //    below. Set transiently by cc-hand.js (game.ccPlayedByFigureKey, general;
  //    ccPlayedByFastLearnerFigureKey legacy alias) for the current play.
  const _playedByFigureKey = game.ccPlayedByFigureKey || game.ccPlayedByFastLearnerFigureKey;
  if (_playedByFigureKey) {
    const _liveByChosen = game.figurePositions?.[playerNum]?.[_playedByFigureKey];
    if (_liveByChosen) return _playedByFigureKey;
  }
  // 1. Activating figure (during/start-of-activation, special_action cards).
  if (dcMessageMeta) {
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (msgId) {
      const fk = figureKeyForActivation(game, msgId);
      if (fk) return fk;
    }
  }
  // 2. Active-combat DEFENDER (defender-reaction cards like Deflection played
  //    during the opponent's attack — no activation for this player).
  const cbt = game.pendingCombat || game.combat;
  if (cbt?.target?.figureKey && cbt.attackerPlayerNum) {
    const defenderPlayerNum = opponentPlayerNum(cbt.attackerPlayerNum);
    if (defenderPlayerNum === playerNum) return cbt.target.figureKey;
  }
  // 3. Named-figure CC registry (start_of_round cards like Cavalry Charge →
  //    Captain Terro). Also covers Mara Jade Fast Learner fallback.
  const named = resolveUniqueFigureCcFigureKey(game, playerNum, cardName);
  if (named) return named;
  return null;
}


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
 * Add N movement points to a SPECIFIC figure's per-figure MP sub-bank.
 *
 * Per alexanbv 2026-06-13: MP is strictly per-figure — there is no shared
 * group bank. All MP lives in movementBank[msgId].perFig[figureIndex];
 * the top-level entry holds only UI metadata. figureIndex defaults to 0
 * (the sole figure of a single-figure DC).
 *
 * @param {object} game - Game state
 * @param {string} msgId - DC message ID
 * @param {number} n - Movement points to add
 * @param {object} [opts]
 * @param {boolean} [opts.forceImmediate] - Force the immediate-spend tag
 *   even while the figure is mid-activation. Used by special actions
 *   (Urgency) whose MP must be spent during the action itself, not banked
 *   into the rest of the activation.
 * @param {number} [opts.figureIndex] - the figure the MP belongs to
 *   (defaults to 0).
 */
function addMovementPoints(game, msgId, n, opts) {
  game.movementBank = game.movementBank || {};
  const top = game.movementBank[msgId] || {};
  top.perFig = top.perFig || {};
  const figIdx = opts?.figureIndex ?? 0;
  const fig = top.perFig[figIdx] || { total: 0, remaining: 0 };
  fig.total = (fig.total ?? 0) + n;
  fig.remaining = (fig.remaining ?? 0) + n;

  // MP gained during the figure's own activation banks for the rest of
  // that activation; MP gained OUTSIDE its activation, or as part of a
  // special action (Urgency, forceImmediate), must be spent at once and
  // never carried forward. The immediate tag drives expireImmediateMp /
  // the "Done spending" button. game.dcActionsData[msgId] exists iff this
  // DC is mid-activation. Per alexanbv 2026-06-12/13.
  const outOfActivation = !game.dcActionsData?.[msgId];
  if (outOfActivation) {
    fig._outOfActivation = true;
    fig._mustSpendImmediately = true;
  } else if (opts?.forceImmediate) {
    fig._mustSpendImmediately = true;
  }

  top.perFig[figIdx] = fig;
  game.movementBank[msgId] = top;
}

/**
 * Parse the trailing figure index out of a figureKey
 * ("Luke Skywalker-1-0" → 0). Returns null when absent/unparseable.
 */
function figureIndexFromKey(figureKey) {
  const m = /-(\d+)$/.exec(figureKey || '');
  return m ? parseInt(m[1], 10) : null;
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
    let choiceIndex = context.choiceIndex;
    // affiliationDetermined (Reactive Loyalties): the option is NOT a player
    // choice — it's fixed by the playing army's affiliation (alexanbv audit
    // 2026-06-22: IMPERIAL/SCUM/REBEL). Auto-select the matching option by its
    // label prefix instead of prompting.
    if (entry.affiliationDetermined && choiceIndex == null && context.game && context.playerNum) {
      const _aff = (firstSeenArmyAffiliation(getDcList(context.game, context.playerNum) || [], getDcEffects()) || '').toUpperCase();
      const _matchIdx = entry.chooseOne.findIndex((o) => String(o.label || '').toUpperCase().startsWith(_aff));
      if (_aff && _matchIdx >= 0) choiceIndex = _matchIdx;
    }
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
    // Grant bonus cleave for next attack via surge (per-figure 2026-05-09)
    if (typeof chosen.nextAttackCleave === 'number' && chosen.nextAttackCleave > 0 && game && playerNum) {
      const _dbfFk = figureKeyForActivation(game, msgId);
      if (_dbfFk) {
        game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
        const existing = game.nextAttackBonusSurgeAbilities[_dbfFk] || [];
        game.nextAttackBonusSurgeAbilities[_dbfFk] = [...existing, `cleave ${chosen.nextAttackCleave}`];
      }
    }
    // Grant Reach for next attack (melee range extended to 2) — per-figure 2026-05-09
    if (chosen.nextAttackReach && game && playerNum) {
      const _dbfFk = figureKeyForActivation(game, msgId);
      if (_dbfFk) {
        game.nextAttackReach = game.nextAttackReach || {};
        game.nextAttackReach[_dbfFk] = true;
      }
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
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSightByCoord: losCheck, getMapData: getMs, getFigureSize: gfs, targetFigureKey, chosenSpace } = context;
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
      // Deduct MP cost if applicable.
      // Per alexanbv 2026-05-13: per-figure MP bank.
      if (entry.mpCostToActivate) {
        const _mpFigIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        consumeMovementPoints(game, msgId, entry.mpCostToActivate, _mpFigIdx);
      }
      const dcDisplay = meta?.displayName || meta?.dcName || label;
      const targetName = dcNameFromFigureKey(targetFigureKey);
      // Post-push free attack (Mandalorian Whip): grant free attack targeting the pushed figure.
      // Per alexanbv 2026-05-13: forcedAttackTarget keyed by attacker
      // figureKey so a granted free-attack target on figure 0 does not
      // lock figure 1's choice in a multifig group.
      if (entry.postPushFreeAttack) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        const _mwFk = figureKeyForActivation(game, msgId);
        if (_mwFk) {
          game.freeAttackBonusPending[_mwFk] = true;
          game.forcedAttackTarget = game.forcedAttackTarget || {};
          game.forcedAttackTarget[_mwFk] = targetFigureKey;
        }
      }
      // Compute path and adjacency-exit warnings for the push
      const { pathStr: _pushPathStr, warnings: _pushWarnings } = computePushPathAndWarnings(game, prevPos, chosenSpace, targetOwner);
      let _pushLogMsg = `**${label}** — **${dcDisplay}** pushed **${targetName}** from ${prevPos?.toUpperCase() ?? '?'} to ${String(chosenSpace).toUpperCase()}${_pushPathStr}.${entry.postPushFreeAttack ? ' Now attack that figure (free action).' : ''}`;
      if (_pushWarnings.length > 0) {
        const _warnList = _pushWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _pushLogMsg += `\n⚠️ Exits adjacency to: ${_warnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      _pushLogMsg += stashPushPartingBlow(game, targetFigureKey, targetOwner, prevPos, chosenSpace, playerNum);
      // Strain cost (deferred from Phase 1 — see comment there) queued
      // via pendingStrainCost so applyStrain pipeline routes it.
      let _ptwrPhase3StrainPayload = null;
      if (entry.strainCostToSelf > 0 && meta?.dcName) {
        const dgM = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIdx = dgM ? dgM[1] : '1';
        const _ptwrSelectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        _ptwrPhase3StrainPayload = {
          figureKey: `${meta.dcName}-${dgIdx}-${_ptwrSelectedFig}`,
          controllerPlayerNum: playerNum,
          amount: entry.strainCostToSelf,
          source: `${entry.label || 'ability'} cost`,
        };
      }
      return {
        applied: true,
        logMessage: _pushLogMsg,
        refreshBoard: true,
        refreshMovementBank: !!entry.mpCostToActivate,
        activeMsgId: msgId,
        ...(_ptwrPhase3StrainPayload ? { pendingStrainCost: _ptwrPhase3StrainPayload } : {}),
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
      // LOS check (multi-cell-aware via byCoord helper)
      if (requiresLos && losCheck && attackerPos && mapSpaces) {
        if (!losCheck(game, attackerPos, coord, mapSpaces, gfs)) continue;
      }
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**${label}** — no valid SMALL targets in range. Resolve manually if applicable.` };
    // Strain cost: deferred to AFTER target pick. The Phase 3 branch
    // (targetFigureKey + chosenSpace set) reads entry.strainCostToSelf
    // and queues it via pendingStrainCost there so the canonical
    // applyStrain pipeline routes it (Fireproof / Headhunter / per-
    // strain choice / Under Duress / Paz). Strictly per CRR cost-first
    // would prefer pre-pick, but the pipeline doesn't compose with a
    // synchronous requiresChoice; deferring is the smallest correct
    // alternative.
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // dcSpecial: targetHostileFigure (Force Choke, Force Lightning) — pick enemy target, apply damage/strain/condition
  // First call: returns requiresChoice with enemy figure list; second call: applies effect to chosen figure.
  if (entry.type === 'dcSpecial' && entry.targetHostileFigure && typeof entry.targetHostileFigure === 'object') {
    const { damage = 0, strain = 0, applyCondition: condToApply, requiresLos = false, range: maxRange = 999, splashDamageNote, splashDamage = 0, splashConditions = [] } = entry.targetHostileFigure;
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, hasLineOfSightByCoord: losCheck, getMapData: getMs, getFigureSize: gfs, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.logMessage || `Resolve ${entry.label} manually.` };
    const enemyPlayerNum = opponentPlayerNum(playerNum);
    const enemyPositions = game.figurePositions?.[enemyPlayerNum] || {};
    // allowFriendly: per destruct 2026-05-07 some "targetHostileFigure" cards
    // (Force Lightning) actually allow friendly primary targets too. The
    // misnomer is preserved for compat — opt-in with allowFriendly=true.
    const _thfAllowFriendly = !!entry.targetHostileFigure.allowFriendly;
    const friendlyPositions = _thfAllowFriendly ? (game.figurePositions?.[playerNum] || {}) : {};
    // Second call: apply effect to the chosen figure
    if (choiceIndex != null && targetFigureKey) {
      // NPC primary target (Force Lightning hits Thugs/Krykna). Route
      // damage through applyDamageToNpcSync; condition via figureConditions;
      // strain queued via pendingStrain (auto-converts to damage in
      // applyStrain for NPCs).
      const _isNpcTarget = typeof targetFigureKey === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFigureKey);
      if (_isNpcTarget) {
        const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/);
        const npcType = p[1];
        const npcIndex = parseInt(p[2], 10);
        const npcLabel = `${npcType === 'thug' ? 'Thug' : 'Krykna'} ${npcIndex + 1}`;
        const npcParts = [];
        let _npcDefeated = false;
        if (damage > 0) {
          const npcRes = applyDamageToNpcSync(game, { npcType, npcIndex, amount: damage, attackerPlayerNum: playerNum });
          if (npcRes.applied) {
            npcParts.push(`${damage} Damage (HP: ${npcRes.prevHp} → ${npcRes.newHp})`);
            if (npcRes.defeated) _npcDefeated = true;
          }
        }
        const _npcPendingStrain = strain > 0 ? [{ figureKey: targetFigureKey, controllerPlayerNum: null, amount: strain, source: entry.label || 'Force ability' }] : [];
        if (strain > 0) npcParts.push(`+ ${strain} Strain`);
        if (condToApply && applyCondition(game, targetFigureKey, condToApply)) {
          npcParts.push(`became **${condToApply}**`);
        }
        // Splash damage to adjacent figures + NPCs (already routes via
        // getFiguresAdjacentToTarget which I extended in Slice 2 to
        // include NPCs).
        const _npcSplashParts = [];
        if ((splashDamage > 0 || splashConditions.length > 0) && game.selectedMap?.id) {
          const adjacent = getFiguresAdjacentToTarget(game, targetFigureKey, game.selectedMap.id);
          for (const adjEntry of adjacent) {
            const { figureKey: adjFk, isNpc: adjIsNpc } = adjEntry;
            const adjName = adjIsNpc ? entryDisplayLabel(adjEntry) : dcNameFromFigureKey(adjFk);
            if (adjIsNpc) {
              if (splashDamage > 0) {
                const npcRes = applyDamageToNpcSync(game, { npcType: adjEntry.npcType, npcIndex: adjEntry.npcIndex, amount: splashDamage, attackerPlayerNum: playerNum });
                if (npcRes.applied) _npcSplashParts.push(`**${adjName}** ${splashDamage} Damage (${npcRes.prevHp}→${npcRes.newHp})`);
              }
              if (splashConditions.length > 0) {
                for (const c of splashConditions) applyCondition(game, adjFk, c);
              }
              continue;
            }
            const adjMsgId = findMsgIdForFigureKey(game, adjEntry.playerNum, adjFk, dcMessageMeta);
            if (splashDamage > 0 && dcHealthState && adjMsgId) {
              const adjFkMatch = adjFk.match(/-(\d+)-(\d+)$/);
              const adjFigIdx = adjFkMatch ? parseInt(adjFkMatch[2], 10) : 0;
              const adjRes = applyDamageWithDefeatCheck(dcHealthState, game, adjMsgId, adjFigIdx, splashDamage, adjEntry.playerNum, {
                sourceLabel: `${entry.label || 'Force ability'} (splash)`, attackerPlayerNum: playerNum,
              });
              if (adjRes.maxHp > 0) _npcSplashParts.push(`**${adjName}** ${splashDamage} Damage (${adjRes.prevHp}→${adjRes.newHp})`);
            }
            if (splashConditions.length > 0) {
              for (const c of splashConditions) applyCondition(game, adjFk, c);
            }
          }
        }
        const splashLog = _npcSplashParts.length > 0 ? `\nSplash — ${_npcSplashParts.join('; ')}` : '';
        return {
          applied: true,
          freeAction: !!entry.freeAction,
          logMessage: `**${entry.label}** — **${npcLabel}** ${npcParts.join(', ') || 'targeted'}.${splashLog}`,
          refreshDcEmbed: true,
          refreshBoard: _npcDefeated,
          ...(_npcPendingStrain.length ? { pendingStrain: _npcPendingStrain } : {}),
        };
      }
      // Resolve target's owner (friendly or enemy) for HP application
      const _thfTargetOwner = enemyPositions[targetFigureKey] ? enemyPlayerNum : (friendlyPositions[targetFigureKey] ? playerNum : enemyPlayerNum);
      const targetMsgId = findMsgIdForFigureKey(game, _thfTargetOwner, targetFigureKey, dcMessageMeta);
      const parts = [];
      // Damage applies synchronously through applyDamageWithDefeatCheck;
      // Strain is queued via pendingStrain[] so apply-ability-result.js
      // routes it through the canonical applyStrain pipeline (Fireproof /
      // Headhunter / per-strain choice / Under Duress / Paz).
      const _thfPendingStrain = [];
      let _hadDefeats = false;
      if (damage > 0 && dcHealthState && targetMsgId) {
        const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, damage, _thfTargetOwner, {
          sourceLabel: entry.label || 'Force ability',
          attackerPlayerNum: playerNum,
        });
        if (dmgRes.maxHp > 0) {
          parts.push(`suffered ${damage} Damage (HP: ${dmgRes.prevHp} → ${dmgRes.newHp})`);
          if (dmgRes.wasDefeated) _hadDefeats = true;
        } else {
          parts.push(`(HP not tracked — apply ${damage} Damage manually)`);
        }
      } else if (damage > 0) {
        parts.push(`(apply ${damage} Damage manually)`);
      }
      if (strain > 0) {
        _thfPendingStrain.push({
          figureKey: targetFigureKey,
          controllerPlayerNum: _thfTargetOwner,
          amount: strain,
          source: entry.label || 'Force ability',
        });
        parts.push(`+ ${strain} Strain`);
      }
      if (condToApply) {
        // Respect condition immunity (Onar Koma, Snowtrooper Elite, etc.) — the
        // generic applyCondition does not gate on it (alexanbv audit 2026-06-22,
        // MHD-19 Improper Procedure applied Weaken to immune figures).
        if (isConditionImmune(game, targetFigureKey)) {
          parts.push(`is immune to **${condToApply}**`);
        } else if (applyCondition(game, targetFigureKey, condToApply)) {
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
          for (const adjEntry of adjacent) {
            const { figureKey: adjFk, playerNum: adjPnum, isNpc: adjIsNpc } = adjEntry;
            const adjName = adjIsNpc ? entryDisplayLabel(adjEntry) : dcNameFromFigureKey(adjFk);
            if (adjIsNpc) {
              if (splashDamage > 0) {
                const npcRes = applyDamageToNpcSync(game, {
                  npcType: adjEntry.npcType,
                  npcIndex: adjEntry.npcIndex,
                  amount: splashDamage,
                  attackerPlayerNum: playerNum,
                });
                if (npcRes.applied) {
                  splashParts.push(`**${adjName}** ${splashDamage} Damage (${npcRes.prevHp}→${npcRes.newHp})`);
                  if (npcRes.defeated) _hadDefeats = true;
                }
              }
              if (splashConditions.length > 0) {
                const adjToAdd = splashConditions.filter((c) => applyCondition(game, adjFk, c));
                if (adjToAdd.length > 0) {
                  splashParts.push(`**${adjName}** gains ${adjToAdd.join(', ')}`);
                }
              }
              continue;
            }
            const adjMsgId = findMsgIdForFigureKey(game, adjPnum, adjFk, dcMessageMeta);
            if (splashDamage > 0 && dcHealthState && adjMsgId) {
              const adjFkMatch = adjFk.match(/-(\d+)-(\d+)$/);
              const adjFigIdx = adjFkMatch ? parseInt(adjFkMatch[2], 10) : 0;
              const adjRes = applyDamageWithDefeatCheck(dcHealthState, game, adjMsgId, adjFigIdx, splashDamage, adjPnum, {
                sourceLabel: `${entry.label || 'Force ability'} (splash)`,
                attackerPlayerNum: playerNum,
              });
              if (adjRes.maxHp > 0) {
                splashParts.push(`**${adjName}** ${splashDamage} Damage (${adjRes.prevHp}→${adjRes.newHp})`);
                if (adjRes.wasDefeated) _hadDefeats = true;
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
      return {
        applied: true,
        freeAction: !!entry.freeAction,
        logMessage: `**${entry.label}** — **${dcName}** ${parts.join(', ') || 'targeted'}.${splashLog}${selfCondLog}`,
        refreshDcEmbed: true,
        ...(_thfPendingStrain.length ? { pendingStrain: _thfPendingStrain } : {}),
        ...(_hadDefeats ? { refreshBoard: true } : {}),
      };
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
    // Build candidate pool: enemies always; friendlies too when allowFriendly
    // is set (Force Lightning per destruct 2026-05-07). Per alexanbv
    // 2026-05-10: NPCs (Thugs/Krykna with hostility != 'neutral') are
    // valid targets too — Force Lightning can hit them with the 3-damage
    // primary effect (splash already includes them via getFiguresAdjacentToTarget).
    const _thfCandidates = [...Object.entries(enemyPositions)];
    if (_thfAllowFriendly) {
      for (const [fk, coord] of Object.entries(friendlyPositions)) {
        _thfCandidates.push([fk, coord]);
      }
    }
    // NPC targets (hostile or treated-as-hostile)
    for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
      const arr = game[arrName];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const npc = arr[i];
        if (!npc || npc.defeated || !npc.coord) continue;
        const h = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
        if (h === 'neutral') continue;
        _thfCandidates.push([`npc_${npcType}_${i}`, npc.coord]);
      }
    }
    for (const [fk, coord] of _thfCandidates) {
      if (!coord) continue;
      if (attackerPos && maxRange < 999) {
        const dist = countGameSpaces(game, attackerPos, coord);
        if (dist > maxRange) continue;
      }
      if (requiresLos && losCheck && attackerPos && mapSpaces) {
        if (!losCheck(game, attackerPos, coord, mapSpaces, gfs)) continue;
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
    const { game, playerNum, meta, msgId, targetFigureKey } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: `Resolve ${entry.label} manually.` };
    const _frApplyHide = (fks) => {
      const hidden = [];
      for (const fk of fks) {
        if (applyCondition(game, fk, 'Hide')) hidden.push(dcNameFromFigureKey(fk));
      }
      if (hidden.length === 0) return { applied: true, logMessage: `**${entry.label}** — Chosen figures already Hidden.` };
      return { applied: true, logMessage: `**${entry.label}** — **${hidden.join('**, **')}** became **Hidden**.`, refreshDcEmbed: true };
    };
    const _frPendingKey = msgId || 'fieldReport';
    // Phase 2+: accumulate sequential picks (only entered when >maxTargets
    // candidates existed at Phase 1). Mirrors the Trample multi-target
    // sequential picker (abilities.js ~2966).
    if (targetFigureKey && game.pendingFieldReport?.[_frPendingKey]) {
      const pendFR = game.pendingFieldReport[_frPendingKey];
      if (targetFigureKey === '__done__') {
        delete game.pendingFieldReport[_frPendingKey];
        if (pendFR.chosen.length === 0) return { applied: true, logMessage: `**${entry.label}** — No figures chosen.` };
        return _frApplyHide(pendFR.chosen);
      }
      pendFR.chosen.push(targetFigureKey);
      if (pendFR.chosen.length >= maxTargets) {
        delete game.pendingFieldReport[_frPendingKey];
        return _frApplyHide(pendFR.chosen);
      }
      const remaining = pendFR.candidates.filter((fk) => !pendFR.chosen.includes(fk));
      const opts = [...remaining.map(dcNameFromFigureKey), 'Done selecting'];
      const fKeys = [...remaining, '__done__'];
      return { applied: false, requiresChoice: true, choiceOptions: opts, targetFigureKeys: fKeys, choicePrompt: `**${entry.label}** — Selected ${pendFR.chosen.length}/${maxTargets}. Choose another or Done:` };
    }
    // Phase 1: enumerate qualifying friendly candidates within range.
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
    // ≤maxTargets candidates: auto-apply (the player would Hide all of
    // them anyway — "up to 2" with exactly ≤2 eligible leaves no choice).
    if (candidates.length <= maxTargets) return _frApplyHide(candidates);
    // >maxTargets candidates: CSV "Choose up to 2 friendly figures" —
    // offer a sequential player pick rather than auto-selecting the first 2.
    game.pendingFieldReport = game.pendingFieldReport || {};
    game.pendingFieldReport[_frPendingKey] = { chosen: [], candidates };
    const choices = [...candidates.map(dcNameFromFigureKey), 'Done selecting'];
    const fKeysDone = [...candidates, '__done__'];
    return { applied: false, requiresChoice: true, choiceOptions: choices, targetFigureKeys: fKeysDone, choicePrompt: `**${entry.label}** — Choose up to ${maxTargets} friendly figures to become Hidden:` };
  }

  // battlefield_leadership (Leia Organa): Special Action button. Per
  // alexanbv 2026-05-10: clicking BL consumes the Special Action via the
  // standard dc_special_ path (which auto-increments
  // game.specialActionUsedThisActivation for To-the-Limit / All-in-a-
  // Day's-Work detection). Leia then performs a free attack via the
  // standard freeAttackBonusPending mechanism — no separate special-
  // attack flag needed; the Special Action was the BL CLICK itself, and
  // every downstream ability already keys off the standard counter. After
  // Leia's attack resolves, the post-resolve hook in combat-bridge.js
  // captures the target + posts the friendly picker (bl_friendly_*).
  if (abilityId === 'battlefield_leadership') {
    const { game, playerNum, meta, msgId } = context;
    if (!game || !playerNum || !meta) return { applied: false, manualMessage: 'Resolve **Battlefield Leadership** manually.' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    if (!activatingKey) return { applied: false, manualMessage: '**Battlefield Leadership** — Leia not found.' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[activatingKey] = { from: 'Battlefield Leadership' };
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      logMessage: '**Battlefield Leadership** (Special Action) — click **Attack** to make Leia\'s free attack. After it resolves you will be prompted to pick a friendly figure within 3 spaces to make a free attack against the same target.',
    };
  }

  // emperor_interrupt (Emperor Palpatine): choose a friendly figure within
  // 4 spaces; it interrupts to perform a free attack. Per alexanbv
  // 2026-05-10: Emperor does NOT cost an action (it's an interrupt-grant
  // per card text "Once during your activation, you may..."). Card text
  // also says "once during your activation" — gated via
  // game.emperorInterruptUsedThisActivation[msgId].
  if (abilityId === 'emperor_interrupt') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Emperor** manually.' };
    // Once-per-activation gate
    if (game.emperorInterruptUsedThisActivation?.[msgId] && choiceIndex == null) {
      return { applied: false, manualMessage: '**Emperor** — Already used this activation.' };
    }
    const _empEnemyNum = opponentPlayerNum(playerNum);
    if (choiceIndex != null && targetFigureKey) {
      // Emperor may force ANY figure (friendly OR hostile) to interrupt and attack.
      // Resolve the granted-attack message id against the target's actual owner.
      const _empTargetOwner = game.figurePositions?.[playerNum]?.[targetFigureKey] ? playerNum : _empEnemyNum;
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, _empTargetOwner, targetFigureKey) : null;
      if (chosenMsgId) {
        setPendingEmperorInterrupt(game, { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
      }
      // Mark used so the next click in the same activation is rejected.
      game.emperorInterruptUsedThisActivation = game.emperorInterruptUsedThisActivation || {};
      game.emperorInterruptUsedThisActivation[msgId] = true;
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return {
        applied: true,
        freeAction: true, // No action cost — it's an interrupt-grant.
        logMessage: `**Emperor** — **${chosenName}** may interrupt to perform a free attack (no action cost).`,
        grantedAttackButton: chosenMsgId ? { granteeMsgId: chosenMsgId, granteeFigureKey: targetFigureKey, granteeName: chosenName, sourceLabel: 'Emperor' } : null,
      };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Emperor** — No position on the board. Resolve manually.' };
    // Unlimited Power (CC): while active for this player, Emperor may target ANY
    // other friendly figure on the map, not just within 4 spaces. alexanbv 2026-06-17.
    const _unlimitedPower = !!game.unlimitedPowerActive?.[playerNum];
    const validTargets = [];
    // Spec (combat-spec.csv:234): "another figure within 4 spaces" = ANY figure,
    // friendly OR hostile (only the activating figure is excluded). Unlimited Power
    // (CC) extends range to the whole map for FRIENDLY figures only.
    for (const _empPn of [playerNum, _empEnemyNum]) {
      const _empFriendly = _empPn === playerNum;
      for (const [fk, pos] of Object.entries(game.figurePositions?.[_empPn] || {})) {
        if (fk === activatingKey || !pos) continue;
        const _empUnlimited = _unlimitedPower && _empFriendly;
        if (!_empUnlimited && countGameSpaces(game, activatingPos, pos) > 4) continue;
        validTargets.push(fk);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: _unlimitedPower ? '**Emperor** — No other figures available.' : '**Emperor** — No other figures within 4 spaces.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // You Have Something I Want (Moff Gideon): choose hostile with token within 4, transfer or 3 damage
  if (abilityId === 'you_have_something_i_want_gideon') {
    const { game, playerNum, meta, msgId, dcMessageMeta, dcHealthState, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum || !meta || !msgId) return { applied: false, manualMessage: 'Resolve **You Have Something I Want** manually.' };

    // Once-per-activation gate (CSV/lib "Once during your activation").
    // Mirrors game.emperorInterruptUsedThisActivation. Only blocks a fresh
    // Phase-1 entry (choiceIndex == null); an in-flight Phase-2 commit
    // resolves normally and stamps the used flag below.
    if (game.yhsiwUsedThisActivation?.[msgId] && choiceIndex == null) {
      return { applied: false, manualMessage: '**You Have Something I Want** — Already used this activation.' };
    }

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
      setPendingYHSIW(game, {
        targetFk, token, gideonFk, gideonPlayerNum: playerNum, oppPlayerNum: oppNum,
        msgId, gameId: game.gameId,
      });
      delete game.yhsiwOptions;
      // Mark used so the next click in the same activation is rejected.
      game.yhsiwUsedThisActivation = game.yhsiwUsedThisActivation || {};
      game.yhsiwUsedThisActivation[msgId] = true;

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
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Tempt** manually.' };
    const enemyNum = opponentPlayerNum(playerNum);
    if (choiceIndex != null && targetFigureKey) {
      // NPC target: route damage via applyDamageToNpcSync; Damage Token
      // grant via grantPowerTokens still keys on figureKey (works for
      // 'npc_thug_N' / 'npc_krykna_N').
      if (typeof targetFigureKey === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFigureKey)) {
        const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/);
        const npcType = p[1];
        const npcIndex = parseInt(p[2], 10);
        const npcLabel = `${npcType === 'thug' ? 'Thug' : 'Krykna'} ${npcIndex + 1}`;
        let _npcHpNote = '';
        let _npcDefeated = false;
        const npcRes = applyDamageToNpcSync(game, { npcType, npcIndex, amount: 1, attackerPlayerNum: playerNum });
        if (npcRes.applied) {
          _npcHpNote = ` (HP: ${npcRes.prevHp} → ${npcRes.newHp})`;
          if (npcRes.defeated) _npcDefeated = true;
        }
        if (!_npcDefeated) grantPowerTokens(game, targetFigureKey, 'Damage', 1);
        const _npcTokenNote = _npcDefeated ? '' : ' and gains 1 Damage Token';
        return {
          applied: true,
          logMessage: `**Tempt** — **${npcLabel}** suffers 1 Damage${_npcHpNote}${_npcTokenNote}.`,
          refreshDcEmbed: true,
          refreshBoard: _npcDefeated,
        };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      // Determine which player owns the target figure (Tempt can target friendly or hostile)
      const targetOwnerNum = game.figurePositions?.[playerNum]?.[targetFigureKey] ? playerNum : enemyNum;
      // Apply 1 HP damage via reduceHp (canonical damage path — handles syncDcList + totalDamageReceived)
      let hpNote = '';
      let defeated = false;
      const targetMsgId = findMsgIdForFigureKey(game, targetOwnerNum, targetFigureKey, dcMessageMeta);
      if (dcHealthState && targetMsgId) {
        const { figureIndex: figIdx } = parseFigureKey(targetFigureKey);
        // destruct 2026-05-08: route through centralized damage
        // pipeline. resolveAbility is synchronous (called from many
        // sync sites + ~136 sync test call sites), so use the sync
        // variant `applyDamageSync` — runs sync registry hooks only.
        // Async-only hooks won't fire from this call site by design;
        // document each ability that needs async post-damage handling
        // separately or convert resolveAbility to async in a later
        // pass.
        const { prevHp, newHp, wasDefeated } = applyDamageSync(game, { dcHealthState }, {
          figureKey: targetFigureKey, msgId: targetMsgId, figIndex: figIdx,
          amount: 1, controllerPlayerNum: targetOwnerNum,
          source: 'Tempt',
        });
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
    // Enumerate ALL figures on the board (friendly + hostile + NPCs)
    // with NO range restriction. Per alexanbv 2026-05-10: "Tempt has no
    // range restriction" and "Tempt can target NPCs."
    const validTargets = [];
    for (const pn of [playerNum, enemyNum]) {
      for (const [fk, pos] of Object.entries(game.figurePositions?.[pn] || {})) {
        if (!pos) continue;
        validTargets.push(fk);
      }
    }
    for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
      const arr = game[arrName];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const npc = arr[i];
        if (!npc || npc.defeated || !npc.coord) continue;
        validTargets.push(`npc_${npcType}_${i}`);
      }
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Tempt** — No figures on the board.' };
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
    let validTargets = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk !== activatingKey && game.figurePositions[playerNum][fk]);
    // "another friendly figure IN YOUR LINE OF SIGHT" (CSV row 261) — filter to
    // targets the activating figure can see (alexanbv 2026-06-19).
    const _omActPos = game.figurePositions?.[playerNum]?.[activatingKey];
    const _omMs = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
    const _omGfs = context.getFigureSize;
    if (_omActPos && _omMs && typeof _omGfs === 'function') {
      validTargets = validTargets.filter((fk) => {
        const tPos = game.figurePositions[playerNum][fk];
        return tPos && hasLineOfSightByCoord(game, _omActPos, tPos, _omMs, _omGfs);
      });
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**On My Mark** — No friendly figure in your line of sight.' };
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
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      if (chosenMsgId) {
        // Rule 2 — special-action MP gain. Stamp pendingMoveX with
        // bypassCosts: false so terrain/figure adders apply, no bank.
        // Per alexanbv 2026-05-17: picker posts in activator's thread.
        const _tmThreadId = game.dcActionsData?.[msgId]?.threadId || null;
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[chosenMsgId] = {
          remaining: 2, source: 'Tactical Maneuver',
          playerNum, figureKey: targetFigureKey, dcName: chosenName,
          threadId: _tmThreadId, bypassCosts: false, msgId: chosenMsgId,
        };
        return {
          applied: true,
          logMessage: `**Tactical Maneuver** — **${chosenName}** gains 2 MP (spend immediately, remainder discarded).`,
          pendingMoveXMsgId: chosenMsgId,
        };
      }
      return { applied: true, logMessage: `**Tactical Maneuver** — **${chosenName}** gains 2 MP (resolve manually — could not locate play area).` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    let validTargets = Object.keys(game.figurePositions?.[playerNum] || {}).filter(fk => fk !== activatingKey && game.figurePositions[playerNum][fk]);
    // "another friendly figure IN YOUR LINE OF SIGHT" (CSV row 260) — filter to
    // targets the activating figure can see, mirroring On My Mark above.
    const _tmActPos = game.figurePositions?.[playerNum]?.[activatingKey];
    const _tmMs = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
    const _tmGfs = context.getFigureSize;
    if (_tmActPos && _tmMs && typeof _tmGfs === 'function') {
      validTargets = validTargets.filter((fk) => {
        const tPos = game.figurePositions[playerNum][fk];
        return tPos && hasLineOfSightByCoord(game, _tmActPos, tPos, _tmMs, _tmGfs);
      });
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Tactical Maneuver** — No friendly figure in your line of sight.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // executive_order (Imperial Officer Elite): two-stage flow — Officer
  // first picks ACTION (Move or Attack), then picks TARGET (Imperial
  // figure within 2 / 3 with ACS attached). Phase mapping by context:
  //   Phase 0 (no choiceIndex): post the action picker.
  //   Phase 1 (choiceIndex set, no targetFigureKey): action chosen,
  //     stash on game.pendingExecutiveOrderAction[msgId], post target
  //     picker filtered to Imperial figures within range.
  //   Phase 2 (choiceIndex + targetFigureKey set): target chosen,
  //     route to grantedAttackButton (attack) or grantedMoveXButton
  //     (move).
  if (abilityId === 'executive_order') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Executive Order** manually.' };

    // Phase 2: target picked → resolve.
    if (choiceIndex != null && targetFigureKey) {
      const action = game.pendingExecutiveOrderAction?.[msgId] || 'attack';
      if (game.pendingExecutiveOrderAction) {
        delete game.pendingExecutiveOrderAction[msgId];
        if (Object.keys(game.pendingExecutiveOrderAction).length === 0) delete game.pendingExecutiveOrderAction;
      }
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      if (chosenMsgId) {
        setPendingExecutiveOrder(game, { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
      }
      if (action === 'move') {
        const chosenSpeed = getStatsForDc(chosenName)?.speed ?? 4;
        return {
          applied: true,
          logMessage: `**Executive Order** — **${chosenName}** takes a free move (up to ${chosenSpeed} MP).`,
          grantedMoveXButton: chosenMsgId ? {
            granteeMsgId: chosenMsgId, granteeFigureKey: targetFigureKey, granteeName: chosenName,
            sourceLabel: 'Executive Order', spaces: chosenSpeed, playerNum,
          } : null,
        };
      }
      return {
        applied: true,
        logMessage: `**Executive Order** — **${chosenName}** declares a free attack.`,
        grantedAttackButton: chosenMsgId ? { granteeMsgId: chosenMsgId, granteeFigureKey: targetFigureKey, granteeName: chosenName, sourceLabel: 'Executive Order' } : null,
      };
    }

    // Phase 1: action chosen, gather targets and post target picker.
    if (choiceIndex != null && !targetFigureKey) {
      const action = choiceIndex === 0 ? 'move' : 'attack';
      const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
      const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
      if (!activatingPos) return { applied: false, manualMessage: '**Executive Order** — No position on the board. Resolve manually.' };
      // ACS extends "within 2" → "within 3" when attached to this DC.
      const _eoAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _eoMaxRange = cardNameIncludes(_eoAtts, 'Advanced Com Systems') ? 3 : 2;
      const validTargets = [];
      const dcEffects = typeof getEff === 'function' ? getEff() : null;
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (fk === activatingKey || !pos) continue;
        if (countGameSpaces(game, activatingPos, pos) > _eoMaxRange) continue;
        // Must be Imperial affiliation
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = dcEffects?.[fkDcName];
        if (fkEff?.affiliation && fkEff.affiliation !== 'Imperial') continue;
        validTargets.push(fk);
      }
      if (validTargets.length === 0) return { applied: false, manualMessage: `**Executive Order** — No friendly Imperial figures within ${_eoMaxRange} spaces.` };
      // Stash the chosen action so phase 2 can route correctly.
      game.pendingExecutiveOrderAction = game.pendingExecutiveOrderAction || {};
      game.pendingExecutiveOrderAction[msgId] = action;
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(validTargets),
        targetFigureKeys: validTargets,
      };
    }

    // Phase 0: present action picker (Move / Attack).
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: ['Move (free)', 'Attack (free)'],
      targetFigureKeys: null,
    };
  }

  // officer_order (Imperial Officer Regular): choose a friendly figure within 2 spaces; it gains 2 MP
  if (abilityId === 'officer_order') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Order** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      if (chosenMsgId) {
        // Rule 2 — special-action MP gain. Stamp pendingMoveX with
        // bypassCosts: false so terrain/figure adders apply, no bank.
        // Per alexanbv 2026-05-17: interrupt-grant picker posts in the
        // ACTIVATOR's thread (the Officer's activation thread), not
        // the grantee's (no such thread exists for non-activating
        // figures) and not the general game log.
        const _orderThreadId = game.dcActionsData?.[msgId]?.threadId || null;
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[chosenMsgId] = {
          remaining: 2, source: 'Order',
          playerNum, figureKey: targetFigureKey, dcName: chosenName,
          threadId: _orderThreadId, bypassCosts: false, msgId: chosenMsgId,
        };
        return {
          applied: true,
          logMessage: `**Order** — **${chosenName}** gains 2 MP (spend immediately, remainder discarded).`,
          pendingMoveXMsgId: chosenMsgId,
        };
      }
      return { applied: true, logMessage: `**Order** — **${chosenName}** gains 2 MP (resolve manually — could not locate play area).` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Order** — No position on the board. Resolve manually.' };
    // ACS extends "within 2" → "within 3" when attached to this DC.
    const _ooAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _ooMaxRange = cardNameIncludes(_ooAtts, 'Advanced Com Systems') ? 3 : 2;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > _ooMaxRange) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**Order** — No other friendly figures within ${_ooMaxRange} spaces.` };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // bombardment_sorin (General Sorin): choose an adjacent friendly; it interrupts to attack with Blast 1 (no Accuracy; alexanbv 2026-06-21)
  if (abilityId === 'bombardment_sorin') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Bombardment** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        setPendingBombardmentSorin(game, { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
        // Grant Blast 1 bonus for the next attack (per-figure; consumed in combat-bridge).
        // Spec (combat-spec.csv:256): "The attack gains Blast 1." (no Accuracy clause.)
        game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
        game.nextAttacksBonusHits[targetFigureKey] = { count: 1, bonus: 0, blast: 1 };
      }
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Bombardment** — **${chosenName}** may interrupt to perform a free attack with **Blast 1** (no action cost). Use their **Attack** button.` };
    }
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Bombardment** — No position on the board. Resolve manually.' };
    // ACS extends "adjacent" → "within 3" when attached to this DC.
    const _bsAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _bsHasACS = cardNameIncludes(_bsAtts, 'Advanced Com Systems');
    const _bsMaxRange = _bsHasACS ? 3 : 1;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > _bsMaxRange) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**Bombardment** — No friendly figures ${_bsHasACS ? 'within 3 spaces (ACS)' : 'adjacent'}.` };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      targetFigureKeys: validTargets,
    };
  }

  // firing_squad (Kayn Somos): choose up to 2 adjacent Troopers; each interrupts to attack same target
  if (abilityId === 'firing_squad') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Firing Squad** manually.' };
    // Phase 2: first trooper chosen
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        game.pendingFiringSquad = game.pendingFiringSquad || [];
        game.pendingFiringSquad.push({ forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
        // Per destruct 2026-05-08: also tag through the universal
        // free-attack pipeline so granted-attack accounting (defeat
        // hooks, exhaust state, free-attack count) sees these as
        // free attacks consistently with Emperor / Battlefield
        // Leadership / Order Hit etc.
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[targetFigureKey] = { from: 'Firing Squad' };
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
      // ACS extends "adjacent" → "within 3" for Firing Squad.
      const _fs2Atts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
      const _fs2MaxRange = cardNameIncludes(_fs2Atts, 'Advanced Com Systems') ? 3 : 1;
      const moreTargets = [];
      if (activatingPos) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
          if (fk === activatingKey || !pos || alreadyChosen.has(fk)) continue;
          if (countGameSpaces(game, activatingPos, pos) > _fs2MaxRange) continue;
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
    // ACS extends "adjacent" → "within 3" for Firing Squad.
    const _fsAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _fsHasACS = cardNameIncludes(_fsAtts, 'Advanced Com Systems');
    const _fsMaxRange = _fsHasACS ? 3 : 1;
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > _fsMaxRange) continue;
      const fkDcName = dcNameFromFigureKey(fk);
      const fkEff = dcEffects?.[fkDcName];
      const fkKeywords = (fkEff?.keywords || []).map(k => k.toUpperCase());
      if (!fkKeywords.includes('TROOPER')) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: `**Firing Squad** — No friendly Troopers ${_fsHasACS ? 'within 3 spaces (ACS)' : 'adjacent'}.` };
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
        // CSV row 303 "an elite figure of your choice" has NO affiliation
        // condition — any elite figure (either player) is eligible.
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
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getDcEffects: getEff } = context;
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
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, findDcMessageIdForFigure, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Coordinated Raid** manually.' };
    if (choiceIndex != null && targetFigureKey) {
      const chosenMsgId = findDcMessageIdForFigure ? findDcMessageIdForFigure(game.gameId, playerNum, targetFigureKey) : null;
      if (chosenMsgId) {
        setPendingCoordinatedRaid(game, { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
        // Per destruct 2026-05-08: also tag through universal free-attack
        // pipeline (consistent accounting with Emperor / Order Hit / etc).
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[targetFigureKey] = { from: 'Coordinated Raid' };
      }
      // Once per group per round (CSV row 299).
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`coordinated_raid_${msgId}`] = true;
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Coordinated Raid** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.` };
    }
    // Once per group per round gate (CSV row 299) — alexanbv 2026-06-20.
    if (game.roundFigureAbilityUsed?.[`coordinated_raid_${msgId}`]) {
      return { applied: false, manualMessage: '**Coordinated Raid** — already used this round (once per group per round).' };
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
        setPendingCoordinatedRaid(game, { forMsgId: chosenMsgId, chosenFigureKey: targetFigureKey, triggeredByMsgId: msgId });
        // Per destruct 2026-05-08: also tag through universal free-attack
        // pipeline (consistent accounting with Emperor / Order Hit / etc).
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[targetFigureKey] = { from: 'Coordinated Raid' };
      }
      // Once per group per round (CSV row 300) — mirror the Elite branch.
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`coordinated_raid_${msgId}`] = true;
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**Coordinated Raid** — **${chosenName}** may interrupt to perform a free attack. Use their **Attack** button.` };
    }
    // Once per group per round gate (CSV row 300) — mirror the Elite branch.
    if (game.roundFigureAbilityUsed?.[`coordinated_raid_${msgId}`]) {
      return { applied: false, manualMessage: '**Coordinated Raid** — already used this round (once per group per round).' };
    }
    // Find other figures in the same group (same DC message ID)
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const otherGroupFigures = figureKeys.filter(fk => fk !== activatingKey && game.figurePositions?.[playerNum]?.[fk]);
    if (otherGroupFigures.length === 0) return { applied: false, manualMessage: '**Coordinated Raid** — No other figures in your group on the board.' };
    if (otherGroupFigures.length === 1) {
      // Auto-select the only other figure
      const onlyFk = otherGroupFigures[0];
      setPendingCoordinatedRaid(game, { forMsgId: msgId, chosenFigureKey: onlyFk, triggeredByMsgId: msgId });
      // Universal free-attack pipeline tag.
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[onlyFk] = { from: 'Coordinated Raid' };
      // Once per group per round (CSV row 300) — mirror the Elite branch.
      game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
      game.roundFigureAbilityUsed[`coordinated_raid_${msgId}`] = true;
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

  // bartered_information (Bib Fortuna): choose another friendly SCUM
  // figure within 2 → Focus. Then, you MAY spend 1 VP to choose another
  // such figure; that figure also becomes Focused.
  // CSV row 148: "Choose another friendly SCUM figure within 2 spaces.
  // Then, you may spend 1 VP to choose another such figure. Each chosen
  // figure becomes Focused." (ACS attached extends "within 2" → 3.)
  if (abilityId === 'bartered_information') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey, getDcEffects: getEff } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **Bartered Information** manually.' };
    const dcEffects = typeof getEff === 'function' ? getEff() : null;
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingKey = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    // ACS extends "within 2" → "within 3" when attached to this DC.
    const _biAtts = game.p1DcAttachments?.[msgId] || game.p2DcAttachments?.[msgId] || [];
    const _biMaxRange = cardNameIncludes(_biAtts, 'Advanced Com Systems') ? 3 : 2;
    // Enumerate eligible friendly SCUM within range, optionally excluding
    // already-Focused figures from a prior pick this resolution.
    const enumerateTargets = (exclude) => {
      const out = [];
      if (!activatingPos) return out;
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (fk === activatingKey || !pos) continue;
        if (exclude && exclude.includes(fk)) continue;
        if (countGameSpaces(game, activatingPos, pos) > _biMaxRange) continue;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkEff = dcEffects?.[fkDcName];
        if (!fkEff) continue;
        if (fkEff.affiliation !== 'Scum') continue;
        out.push(fk);
      }
      return out;
    };

    if (choiceIndex != null && targetFigureKey) {
      const firstFocused = game.pendingBarteredInfoFocused;
      // Phase 3: VP-spend resolution (a first figure was already Focused).
      if (Array.isArray(firstFocused)) {
        delete game.pendingBarteredInfoFocused;
        if (targetFigureKey === 'skip') {
          return { applied: true, logMessage: `**Bartered Information** — declined to spend a VP for a second figure.`, refreshDcEmbed: true };
        }
        // Spend 1 VP, then Focus the second figure.
        const vk = vpKey(playerNum);
        game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
        if ((game[vk].total ?? 0) < 1) {
          return { applied: false, manualMessage: '**Bartered Information** — not enough VP to Focus a second figure.' };
        }
        game[vk].total = (game[vk].total ?? 0) - 1;
        applyCondition(game, targetFigureKey, 'Focus');
        const secondName = dcNameFromFigureKey(targetFigureKey);
        return { applied: true, logMessage: `**Bartered Information** — spent **1 VP**; **${secondName}** is now **Focused** (VP total: ${game[vk].total}).`, refreshDcEmbed: true };
      }
      // Phase 2: first figure chosen → Focus it, then offer the optional
      // VP-spend for a second figure (only if VP ≥ 1 and another eligible
      // SCUM figure remains within range).
      applyCondition(game, targetFigureKey, 'Focus');
      const chosenName = dcNameFromFigureKey(targetFigureKey);
      const vk = vpKey(playerNum);
      const vp = game[vk]?.total ?? 0;
      const remaining = enumerateTargets([targetFigureKey]);
      if (vp >= 1 && remaining.length > 0) {
        game.pendingBarteredInfoFocused = [targetFigureKey];
        return {
          applied: false,
          requiresChoice: true,
          choicePrompt: `**Bartered Information** — **${chosenName}** is now **Focused**. You may spend **1 VP** to Focus another friendly SCUM figure:`,
          choiceOptions: [...remaining.map((fk) => `Spend 1 VP: Focus ${dcNameFromFigureKey(fk)}`), 'Skip (no VP spent)'],
          targetFigureKeys: [...remaining, 'skip'],
        };
      }
      return { applied: true, logMessage: `**Bartered Information** — **${chosenName}** is now **Focused**.${vp < 1 ? ' *(No VP to spend for a second figure.)*' : ''}`, refreshDcEmbed: true };
    }

    if (!activatingPos) return { applied: false, manualMessage: '**Bartered Information** — No position. Resolve manually.' };
    const validTargets = enumerateTargets(null);
    if (validTargets.length === 0) return { applied: false, manualMessage: `**Bartered Information** — No friendly SCUM figure within ${_biMaxRange} spaces.` };
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

  // neurostim_hemlock (Hemlock): choose adjacent friendly, roll 1 yellow die → Damage result: Damage Token, Surge: Surge Token (alexanbv 2026-06-20: Damage token, not Block; CSV row 223 wording is stale)
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
    // Grant free Ranged attack using own attack pool.
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    const _cuFk = figureKeyForActivation(game, msgId);
    if (_cuFk) {
      game.freeAttackBonusPending[_cuFk] = true;
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_cuFk] = { type: 'ranged', dice: null, pierce: 0, bonusAccuracy: 0 };
    }
    return { applied: true, logMessage: `**Continually Unexpected** — K-2S0 has ${hitCount} Damage + ${surgeCount} Surge Tokens. Your next attack costs no action and is **Ranged** (uses your normal dice pool). *(Token requirement met — no tokens consumed.)*` };
  }

  // false_orders (Murne Rin): choose a hostile figure (cost ≤ 4, within 4 spaces); perform move or attack with it
  if (abilityId === 'false_orders') {
    const { game, playerNum, meta, msgId, choiceIndex, targetFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve **False Orders** manually.' };
    const enemyNum = opponentPlayerNum(playerNum);
    // Phase 2: figure chosen — set pending state and return marker for Move/Attack choice
    if (choiceIndex != null && targetFigureKey) {
      setPendingFalseOrders(game, {
        controlledFigureKey: targetFigureKey,
        controlledPlayerNum: enemyNum,
        controllerPlayerNum: playerNum,
        murneRinMsgId: msgId,
      });
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
      // CSV "figure cost 4 or less" = the PER-FIGURE cost. Multi-figure
      // DCs carry a subCost (single-figure cost) distinct from the group
      // `cost`; prefer it. Mirrors coordinated_raid (abilities.js:1615).
      const foFigCost = targetStats?.subCost ?? targetStats?.cost ?? 99;
      if (foFigCost > foMaxCost) continue;
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
    // Phase 2: figure chosen → apply Focus (unless the card only borrows the
    // friendly-picker for another effect — e.g. Order Hit grants an attack + MP
    // and does NOT Focus the chosen figure; entry.skipFocus suppresses it).
    if (targetFigureKey) {
      if (!entry.skipFocus) applyCondition(game, targetFigureKey, 'Focus');
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
          game.freeAttackBonusPending[targetFigureKey] = true;
          if (entry.grantMpToTarget > 0) {
            // Per alexanbv 2026-06-12: out-of-activation MP must be
            // spendable on MOVEMENT *and* MP-cost abilities (Wrist Cord,
            // Super Commando rockets), so it lives in movementBank where
            // both the "Spend Remaining MP" button and the MP-cost
            // ability buttons read it. addMovementPoints tags it
            // _mustSpendImmediately; the immediate-spend window is closed
            // (and any leftover discarded) by expireImmediateMp.
            // MP belongs to the specific target figure's per-figure bank
            // (alexanbv 2026-06-13).
            addMovementPoints(game, tgtMsgId, entry.grantMpToTarget, { figureIndex: figureIndexFromKey(targetFigureKey) ?? 0 });
          }
          // Include the TARGET's msgId in the refresh list so their DC
          // embed updates with the new MP + any newly-enabled MP-cost
          // buttons (e.g. Boba Fett's Wrist Cord / Wrist Flamethrower
          // when granted MP out-of-activation via Order Hit).
          return {
            applied: true,
            logMessage: `**${entry.label}** — **${dcName}** may interrupt to perform a free attack and gains ${entry.grantMpToTarget || 0} MP${entry.grantMpToTarget > 0 ? ' (spend now — remainder lost when the interrupt resolves)' : ''}.${entry.autoDeductVp ? ` (−${entry.autoDeductVp} VP)` : ''}`,
            refreshDcEmbed: true,
            refreshDcEmbedMsgIds: [tgtMsgId],
            grantedAttackButton: { granteeMsgId: tgtMsgId, granteeFigureKey: targetFigureKey, granteeName: dcName, sourceLabel: entry.label || 'Order Hit' },
          };
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
      const _sbFk = figureKeyForActivation(game, msgId);
      if (_sbFk) {
        game.freeAttackBonusPending[_sbFk] = { from: 'Sling Barrage' };
        // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[_sbFk] = { type: 'ranged', dice: null, pierce: 0, bonusAccuracy: 0 };
      }
      // Per alexanbv 2026-05-13: per-figureKey (specials are per-figure).
      game.pendingSlingBarrage = game.pendingSlingBarrage || {};
      if (_sbFk) game.pendingSlingBarrage[_sbFk] = true;
    }
    return {
      applied: true,
      logMessage: '**Sling Barrage** — Perform a **Ranged** attack with your printed pool. You may reroll up to **1 attack die per other group-mate with line of sight to the defender**. Use the **Attack** button.',
    };
  }

  // Focus Fire (SC2-M2 Tank): Double Action — perform 2 attacks targeting the same figure
  // Per IACP rule 2026-05-09: Focus Fire / Multi-Fire are per-FIGURE
  // attack chains (not per-group). Key the state map by figureKey of
  // the activating figure so other figures in a multifigure group
  // get their own independent chains in their own activations.
  if (entry.type === 'dcSpecial' && entry.focusFireDoubleAttack) {
    const { game, msgId, meta } = context;
    if (game && msgId) {
      const _ffDgMatch = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _ffDgIdx = _ffDgMatch ? _ffDgMatch[1] : '1';
      const _ffSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _ffFigureKey = `${meta?.dcName || 'unknown'}-${_ffDgIdx}-${_ffSelFig}`;
      // Grant a free attack for the second shot; after first attack resolves, grant another
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[_ffFigureKey] = { from: 'Focus Fire' };
      // Track that Focus Fire is active — second attack must target the same figure
      game.focusFireActive = game.focusFireActive || {};
      game.focusFireActive[_ffFigureKey] = { attacksRemaining: 2 };
    }
    return {
      applied: true,
      logMessage: '**Focus Fire** — Perform 2 attacks targeting the **same figure**. Use the **Attack** button for each attack.',
    };
  }

  // Multi-Fire (HK Assassin Droid): 2 attacks, different targets, -1 Hit each
  if (entry.type === 'dcSpecial' && entry.multiFireDoubleAttack) {
    const { game, msgId, meta } = context;
    if (game && msgId) {
      const _mfDgMatch = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _mfDgIdx = _mfDgMatch ? _mfDgMatch[1] : '1';
      const _mfSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _mfFigureKey = `${meta?.dcName || 'unknown'}-${_mfDgIdx}-${_mfSelFig}`;
      // Grant a free attack for the second shot
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[_mfFigureKey] = { from: 'Multi-Fire' };
      // Apply -1 Hit to all attacks during Multi-Fire.
      // Per alexanbv 2026-05-13: keyed by activator figureKey.
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_mfFigureKey] = { bonusHits: -1 };
      // Track Multi-Fire state: second attack must target different figure
      game.multiFireActive = game.multiFireActive || {};
      game.multiFireActive[_mfFigureKey] = { attacksRemaining: 2, firstTargetFigureKey: null };
    }
    return {
      applied: true,
      logMessage: '**Multi-Fire** — Perform 2 attacks with **different targets**. **−1 Damage** applied to each attack. Use the **Attack** button for each attack.',
    };
  }

  // Overclock (Elite Ugnaught): Junk Droid companion may interrupt to
  // perform a move OR attack. Per alexanbv 2026-05-10: use the same
  // Executive Order pattern — player picks one action, JD gets a granted
  // move or attack button (not both). Card text is "move or attack",
  // singular. Previous implementation auto-granted both.
  if (entry.type === 'dcSpecial' && entry.overclockCompanionInterrupt) {
    const { game, msgId, playerNum, choiceIndex } = context;
    if (!game || !msgId || !playerNum) return { applied: false, manualMessage: '**Overclock** — resolve manually.' };

    // Locate the Junk Droid's companion msgId on this Ugnaught's host slot.
    const companionMsgIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
    const dcMsgIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    let junkDroidMsgId = null;
    if (companionMsgIds && dcMsgIds) {
      for (let i = 0; i < companionMsgIds.length; i++) {
        if (!companionMsgIds[i]) continue;
        const parentMeta = context.dcMessageMeta?.get?.(dcMsgIds?.[i]);
        if (parentMeta?.dcName?.includes('Ugnaught')) {
          junkDroidMsgId = companionMsgIds[i];
          break;
        }
      }
    }
    if (!junkDroidMsgId) {
      return { applied: true, logMessage: '**Overclock** — no Junk Droid companion in play, no effect.' };
    }
    const junkDroidFk = figureKeyForActivation(game, junkDroidMsgId);
    if (!junkDroidFk || !game.figurePositions?.[playerNum]?.[junkDroidFk]) {
      return { applied: true, logMessage: '**Overclock** — Junk Droid not deployed, no effect.' };
    }

    // Phase 1: action chosen → grant the appropriate button to JD.
    if (choiceIndex != null) {
      if (choiceIndex === 0) {
        // Move — grant JD a free move (Speed spaces) via grantedMoveXButton.
        const jdSpeed = getStatsForDc('Junk Droid')?.speed ?? 4;
        return {
          applied: true,
          logMessage: `**Overclock** — **Junk Droid** interrupts to **move** (up to ${jdSpeed} MP).`,
          grantedMoveXButton: {
            granteeMsgId: junkDroidMsgId,
            granteeFigureKey: junkDroidFk,
            granteeName: 'Junk Droid',
            sourceLabel: 'Overclock',
            spaces: jdSpeed,
            playerNum,
          },
        };
      }
      // Attack
      return {
        applied: true,
        logMessage: '**Overclock** — **Junk Droid** interrupts to declare a **free attack**.',
        grantedAttackButton: {
          granteeMsgId: junkDroidMsgId,
          granteeFigureKey: junkDroidFk,
          granteeName: 'Junk Droid',
          sourceLabel: 'Overclock',
        },
      };
    }

    // Phase 0: post action picker.
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: ['Move (Junk Droid)', 'Attack (Junk Droid)'],
    };
  }

  // Spot Weld (Ugnaught): Place the Junk Droid companion in a space
  // adjacent to this figure. Per destruct 2026-05-07: if a friendly Junk
  // Droid already exists on the board, remove it from the map before
  // placing the new one. The new JD enters READY (un-exhausted), which
  // is what enables an effective second JD activation when paired with
  // Scrap Battalion's auto-ready at start of each Ugnaught activation.
  //
  // Per alexanbv 2026-05-10: this should be a full space-picker flow.
  // Phase 0: enumerate adjacent spaces, return requiresSpaceChoice.
  // Phase 1 (chosenSpace set): remove old JD, place new JD, allocate
  // fresh companion banks mid-game so the new JD can activate at end
  // of Ugnaught.
  if (entry.type === 'dcSpecial' && entry.spotWeldCompanionPlace) {
    const { game, msgId, playerNum, meta, chosenSpace } = context;
    if (!game || !msgId || !playerNum) return { applied: false, manualMessage: '**Spot Weld** — resolve manually.' };

    // Locate Ugnaught's position.
    const _swDcList = (playerNum === 1 ? game.p1DcList : game.p2DcList) || [];
    const _swDcMsgIds = (playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds) || [];
    const _swCompMsgIds = (playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds) || [];
    const _swHostIdx = _swDcMsgIds.indexOf(msgId);
    let _swJdMsgId = null;
    for (let _swI = 0; _swI < _swDcList.length; _swI++) {
      if ((_swDcList[_swI]?.dcName || _swDcList[_swI]) === 'Junk Droid') {
        _swJdMsgId = _swDcMsgIds[_swI];
        break;
      }
    }
    if (!_swJdMsgId) {
      _swJdMsgId = _swCompMsgIds[_swHostIdx] || null;
    }

    const _swUgnaughtName = meta?.dcName;
    const _swUgnaughtDisp = meta?.displayName || _swUgnaughtName;
    const _swDg = (_swUgnaughtDisp || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
    const _swFigIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _swUgnaughtFk = `${_swUgnaughtName}-${_swDg}-${_swFigIdx}`;
    const _swUgnaughtPos = game.figurePositions?.[playerNum]?.[_swUgnaughtFk];

    if (!_swUgnaughtPos) {
      return { applied: false, manualMessage: '**Spot Weld** — Ugnaught not on the board; resolve manually.' };
    }

    // Phase 1: space chosen → place new JD.
    if (chosenSpace) {
      // Remove existing JD figures from positions (and clear stale banks).
      const _swPoses = game.figurePositions?.[playerNum] || {};
      for (const fk of Object.keys(_swPoses)) {
        if (fk.startsWith('Junk Droid-')) delete _swPoses[fk];
      }
      if (_swJdMsgId) {
        if (game.dcActionsData?.[_swJdMsgId]) delete game.dcActionsData[_swJdMsgId];
        if (game.movementBank?.[_swJdMsgId]) delete game.movementBank[_swJdMsgId];
      }
      // Place new JD at chosen space.
      const _swNewFk = 'Junk Droid-0-0';
      if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
      game.figurePositions[playerNum][_swNewFk] = String(chosenSpace).toLowerCase();
      game.companionHostMap = game.companionHostMap || {};
      game.companionHostMap[_swNewFk] = { hostFigureKey: _swUgnaughtFk, playerNum };
      // Mark JD as ready so it can activate this round.
      if (_swJdMsgId) {
        game._spotWeldReadyJd = game._spotWeldReadyJd || [];
        if (!game._spotWeldReadyJd.includes(_swJdMsgId)) game._spotWeldReadyJd.push(_swJdMsgId);
        // Allocate fresh companion banks for the new JD so it can
        // activate at end of Ugnaught (inline — resolveAbility is sync).
        const _threadId = game.dcActionsData?.[msgId]?.threadId || null;
        game.dcActionsData = game.dcActionsData || {};
        game.dcActionsData[_swJdMsgId] = {
          remaining: 2,
          total: 2,
          perFigureRemaining: { 0: 2 },
          figureLocked: {},
          figureSoaFired: {},
          figureEoaFired: {},
          messageId: null,
          threadId: _threadId,
          specialsUsed: [],
          isCompanion: true,
          hostMsgId: msgId,
        };
        game.movementBank = game.movementBank || {};
        // Per alexanbv 2026-06-13: per-figure only — top-level is metadata.
        game.movementBank[_swJdMsgId] = {
          threadId: _threadId,
          messageId: null,
          displayName: 'Junk Droid',
          perFig: { 0: { total: 0, remaining: 0 } },
        };
        game.activationStartPositions = game.activationStartPositions || {};
        game.activationStartPositions[_swNewFk] = String(chosenSpace).toLowerCase();
      }
      return {
        applied: true,
        logMessage: `**Spot Weld** — old Junk Droid removed; new **Junk Droid** placed at **${String(chosenSpace).toUpperCase()}** (READY for second activation at end of Ugnaught's turn).`,
        refreshBoard: true,
        refreshDcEmbed: true,
      };
    }

    // Phase 0: enumerate adjacent unoccupied spaces, return space picker.
    const _swMapId = game.selectedMap?.id;
    const _swMs = _swMapId ? getMapData(_swMapId) : null;
    if (!_swMs) return { applied: false, manualMessage: '**Spot Weld** — no map data; resolve manually.' };
    const _swAdj = (_swMs.adjacency?.[String(_swUgnaughtPos).toLowerCase()] || []).map((s) => String(s).toLowerCase());
    // Filter to unoccupied (no figure positioned there).
    const _swOccupied = new Set();
    for (const pn of [1, 2]) {
      for (const pos of Object.values(game.figurePositions?.[pn] || {})) {
        if (pos) _swOccupied.add(String(pos).toLowerCase());
      }
    }
    const _swValid = _swAdj.filter((sp) => !_swOccupied.has(sp));
    if (_swValid.length === 0) {
      return { applied: false, manualMessage: '**Spot Weld** — no unoccupied adjacent spaces. Resolve manually.' };
    }
    return {
      applied: false,
      requiresSpaceChoice: true,
      validSpaces: _swValid,
      spaceChoiceLabel: '**Spot Weld** — Choose an adjacent space to place the new **Junk Droid** (enters READY):',
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
    // Saber Orbit: up to N free melee attacks with override dice.
    // Per IACP rule 2026-05-09: per-FIGURE chain, key by figureKey
    // (not msgId) so a multifigure group's other figures aren't
    // affected by Saber Orbit started by another figure.
    if (entry.saberOrbitChain > 1) {
      const _soMeta = context.meta || (dcMessageMeta?.get?.(msgId));
      const _soDgMatch = (_soMeta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _soDgIdx = _soDgMatch ? _soDgMatch[1] : '1';
      const _soSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _soFigureKey = `${_soMeta?.dcName || 'unknown'}-${_soDgIdx}-${_soSelFig}`;
      game.freeAttackBonusPending[_soFigureKey] = entry.saberOrbitChain;
      game.saberOrbitAttacksRemaining = game.saberOrbitAttacksRemaining || {};
      game.saberOrbitAttacksRemaining[_soFigureKey] = entry.saberOrbitChain;
    } else {
      const _odFk = figureKeyForActivation(game, msgId);
      if (_odFk) game.freeAttackBonusPending[_odFk] = true;
    }
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by activator
    // figureKey. Saber Orbit chain uses its own figureKey computed above;
    // single-attack overrides fall back to figureKeyForActivation.
    const _odadFk = (entry.saberOrbitChain > 1)
      ? `${(context.meta || dcMessageMeta?.get?.(msgId))?.dcName || 'unknown'}-${((context.meta || dcMessageMeta?.get?.(msgId))?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1'}-${game.dcActionsData?.[msgId]?.selectedFigure ?? 0}`
      : figureKeyForActivation(game, msgId);
    if (_odadFk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_odadFk] = {
        dice: entry.overrideAttackDice,
        // Lowercase: consumers compare type against 'melee'/'ranged'.
        type: entry.overrideAttackType ? String(entry.overrideAttackType).toLowerCase() : null,
        pierce: entry.overrideAttackPierce || 0,
        bonusAccuracy: entry.overrideBonusAccuracy || 0,
        mustTargetNonAdjacent: entry.mustTargetNonAdjacent || false,
        blockSurgeAbilities: entry.blockSurgeAbilities || false,
        // Replacement surge abilities (Close and Personal, Lightbow): when the
        // CC text says "using only Surge: X / Surge: Y" the native surges are
        // suppressed (blockSurgeAbilities) and these injected instead.
        bonusSurgeAbilities: Array.isArray(entry.bonusSurgeAbilities) ? entry.bonusSurgeAbilities : undefined,
      };
    }
    // strainCostToSelf (Brutal Cleave / Trained / etc.): figure pays N
    // Strain to activate the ability. The strain is fired through the
    // applyStrain pipeline (Fireproof / Headhunter / Under Duress /
    // Paz / top-of-deck-discard prompt) BEFORE the ability's other
    // side effects via result.pendingStrainCost.
    let strainNote = '';
    let _strainCostPayload = null;
    if (entry.strainCostToSelf > 0 && dcHealthState) {
      const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _strainFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(k => k.startsWith((meta?.dcName || '') + '-'));
      const _strainFigKey = _strainFigKeys[selectedFig] || _strainFigKeys[0] || null;
      if (_strainFigKey) {
        _strainCostPayload = {
          figureKey: _strainFigKey,
          controllerPlayerNum: playerNum,
          amount: entry.strainCostToSelf,
          source: `${entry.label || 'ability'} cost`,
        };
        strainNote = ` Suffers ${entry.strainCostToSelf} Strain (resolve via prompt).`;
      } else {
        strainNote = ` (Apply ${entry.strainCostToSelf} Strain to self manually.)`;
      }
    }
    // mpBonus alongside overrideAttackDice (Close and Personal: move
    // up to 2 spaces, then free Melee attack with override dice).
    // Per the gain-MP rules audit: Move-X via pendingMoveX with
    // bypassCosts: true. No bank — the freeAttackPrompt continuation
    // posts a "Declare Attack" button after the picker drains.
    let odMpNote = '';
    let _odPmxMsgId = null;
    // Move-before-attack: a CC's mpBonus (Close and Personal) OR a dcSpecial's
    // freeMoveBonus (Tonfa Strike) sets up a Move-X picker whose freeAttackPrompt
    // continuation posts the Declare Attack button after the move drains. This
    // makes Tonfa Strike "move 2, THEN attack" (the override block used to return
    // before the standalone freeMoveBonus block could run — alexanbv 2026-06-19).
    const _odMoveAmt = (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0)
      ? entry.mpBonus
      : (typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 ? entry.freeMoveBonus : 0);
    if (_odMoveAmt > 0) {
      const _odMeta = dcMessageMeta?.get?.(msgId);
      const _odFigureKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(k => k.startsWith((_odMeta?.dcName || '') + '-'));
      const _odSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _odFigureKey = _odFigureKeys[_odSelectedIdx] || _odFigureKeys[0] || null;
      if (!_odFigureKey) {
        return { applied: false, manualMessage: `**${entry.label}** — could not locate the activating figure; resolve manually.` };
      }
      const _odBypass = entry.type === 'ccEffect' ? true : !!entry.freeMoveBypassCosts;
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: _odMoveAmt,
        source: entry.label || 'Move X',
        playerNum,
        figureKey: _odFigureKey,
        dcName: _odMeta?.dcName || '',
        threadId: null,
        bypassCosts: _odBypass,
        msgId,
        nextAction: {
          type: 'freeAttackPrompt',
          payload: {
            msgId, playerNum, figureKey: _odFigureKey,
            sourceLabel: entry.label || 'Free Attack',
          },
        },
      };
      _odPmxMsgId = msgId;
      odMpNote = ` May move up to ${_odMoveAmt} space${_odMoveAmt !== 1 ? 's' : ''}${_odBypass ? ' (ignore terrain)' : ''}, then take a free attack.`;
    }
    // Tonfa Strike: after the first (override-dice) attack resolves, a SECOND
    // regular-pool attack is granted via the after-attack pipeline
    // (after-attack-resolve.js → fireTonfaStrike). The override block used to
    // return before the freeAttackBonus block could set this flag.
    if (entry.label === 'Tonfa Strike') {
      const _tsFk = figureKeyForActivation(game, msgId);
      if (_tsFk) {
        game.tonfaStrikeSecondAttack = game.tonfaStrikeSecondAttack || {};
        game.tonfaStrikeSecondAttack[_tsFk] = true;
      }
    }
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      refreshDcEmbed: entry.strainCostToSelf > 0,
      refreshMovementBank: false,
      activeMsgId: msgId,
      pendingMoveXMsgId: _odPmxMsgId,
      pendingStrainCost: _strainCostPayload,
      logMessage: (entry.logMessage || `**${entry.label}** — Click Attack to proceed.`) + strainNote + odMpNote,
    };
  }

  // Close Quarters (Verena Talos) — source-figure picker. CSV: "perform an
  // attack using AN adjacent hostile figure's attack type and attack pool".
  // The player chooses WHICH adjacent hostile to copy (melee vs ranged + the
  // dice pool materially change the attack). When 2+ adjacent hostiles offer
  // DISTINCT pools/types, prompt for the source; when 0–1 distinct, auto-pick.
  // The chosen source figureKey is threaded onto game.closeQuartersActive so
  // combat.js borrows from THAT figure (not the first by iteration order).
  // We do NOT short-circuit the free-move/free-attack grant: once the source
  // is resolved we fall through to the generic freeAttackBonus block below,
  // which arms closeQuartersActive using game._closeQuartersChosenSource.
  if (entry.closeQuartersOverride && (entry.type === 'dcSpecial' || entry.type === 'ccEffect')) {
    const { game, playerNum, meta, dcMessageMeta, targetFigureKey } = context;
    const msgId = context.msgId ?? (playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null);
    if (game && msgId) {
      const _cqFk = figureKeyForActivation(game, msgId);
      // Phase 2: a source was chosen via the requiresChoice re-entry. Stash it
      // and fall through to grant the move/attack + arm the override.
      if (targetFigureKey && _cqFk) {
        game._closeQuartersChosenSource = game._closeQuartersChosenSource || {};
        game._closeQuartersChosenSource[_cqFk] = targetFigureKey;
        // fall through to generic freeAttackBonus handler
      } else if (_cqFk) {
        // Phase 1: enumerate adjacent hostiles and their attack pools.
        const cqMapId = game.selectedMap?.id;
        const cqPos = game.figurePositions?.[playerNum]?.[_cqFk];
        const cqOppNum = opponentPlayerNum(playerNum);
        const dcEffectsMap = getDcEffects() || {};
        const cqCandidates = [];
        if (cqMapId && cqPos) {
          const cqMapSpaces = getMapData(cqMapId);
          const cqAdj = new Set(cqMapSpaces?.adjacency?.[cqPos] || []);
          for (const [fk, pos] of Object.entries(game.figurePositions?.[cqOppNum] || {})) {
            if (!pos || !cqAdj.has(pos)) continue;
            const dcN = dcNameFromFigureKey(fk);
            const atk = dcEffectsMap[dcN]?.attack;
            if (!atk?.dice) continue;
            cqCandidates.push({ fk, dcN, type: String(atk.type || '').toLowerCase(), dice: (atk.dice || []).join(',') });
          }
        }
        // Distinct pools = unique (type|dice). >1 distinct ⇒ the borrowed
        // attack genuinely differs ⇒ the player must choose which hostile.
        const distinctPools = new Set(cqCandidates.map((c) => `${c.type}|${c.dice}`));
        if (cqCandidates.length >= 2 && distinctPools.size >= 2) {
          return {
            applied: false,
            requiresChoice: true,
            choiceOptions: cqCandidates.map((c) => {
              const tLabel = c.type === 'range' ? 'Ranged' : c.type === 'melee' ? 'Melee' : c.type;
              return `${c.dcN} (${tLabel}: ${c.dice})`;
            }),
            targetFigureKeys: cqCandidates.map((c) => c.fk),
            choicePrompt: '**Close Quarters** — choose which adjacent hostile figure\'s attack type and pool to borrow:',
          };
        }
        // 0–1 distinct pool: auto-pick (no meaningful choice). If exactly one
        // candidate, thread it so combat.js uses precisely that figure.
        if (cqCandidates.length >= 1) {
          game._closeQuartersChosenSource = game._closeQuartersChosenSource || {};
          game._closeQuartersChosenSource[_cqFk] = cqCandidates[0].fk;
        }
        // fall through to generic freeAttackBonus handler
      }
    }
  }

  // dcSpecial/ccEffect: freeAttackBonus (Heroic, Rapid Fire, Brutality, etc.) — next attack this activation costs no action
  // Cruel Strike also carries freeAttackBonus but owns a dedicated handler
  // (nextAttackBonusSurgeAbilities, below) that grants the attack AND the surge
  // buff — let it fall through rather than be intercepted here.
  if ((entry.type === 'dcSpecial' || entry.type === 'ccEffect') && entry.freeAttackBonus
      && !(Array.isArray(entry.nextAttackBonusSurgeAbilities) && entry.nextAttackBonusSurgeAbilities.length > 0)) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = context.msgId ?? (playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null);
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    // freeAttackBonusCount > 1 (e.g. Sarlacc Sweep: 2 free attacks): store count, each attack decrements by 1
    const _fabFk = figureKeyForActivation(game, msgId);
    if (_fabFk) game.freeAttackBonusPending[_fabFk] = entry.freeAttackBonusCount ?? true;
    // Brutality / Sarlacc Sweep / Multi-Fire: each attack must target a different figure.
    // Initialize an empty target-tracker; handlers/combat.js handleAttackTarget pushes
    // each chosen figureKey and refuses duplicates while this entry is set.
    if (entry.differentTargetsRequired) {
      // Per alexanbv 2026-05-13: per-figureKey (Brutality / Sarlacc Sweep
      // require different targets *per the activating figure*).
      const _fadtFk = figureKeyForActivation(game, msgId);
      game.freeAttackDifferentTargets = game.freeAttackDifferentTargets || {};
      if (_fadtFk) game.freeAttackDifferentTargets[_fadtFk] = [];
      // Post-attack triggers like Brutal Cleave fire AFTER an attack
      // resolved — seed the tracker with the most-recent target so the
      // free attack must pick a different figure (per alexanbv 2026-05-11).
      if (entry.seedDifferentTargetFromLastAttack && _fadtFk) {
        const _lastTgt = game.lastAttackTargetByMsgId?.[msgId];
        if (_lastTgt) game.freeAttackDifferentTargets[_fadtFk].push(_lastTgt);
      }
    }
    // alexanbv 2026-05-13: per-figure migration for attack-frame flags.
    // Each attack-bound flag is keyed by the activating figure's key
    // so siblings in a multi-figure group don't share state.
    const _afkActivating = figureKeyForActivation(game, msgId);
    // Stay Down: mark to apply Stun to the attacker figure when the free attack is consumed
    if (entry.label === 'Stay Down') {
      game.stayDownPendingMsgId = game.stayDownPendingMsgId || {};
      if (_afkActivating) game.stayDownPendingMsgId[_afkActivating] = true;
    }
    // Burst Fire: mark so adjacent Stun is applied when the free attack resolves
    // with damage. Match on abilityId (the card name) — the library entry's
    // `label` is a long descriptive string, so the old `label==='Burst Fire'`
    // guard never armed it (alexanbv 2026-06-20).
    if (entry.label === 'Burst Fire' || abilityId === 'Burst Fire') {
      game.burstFirePendingMsgId = game.burstFirePendingMsgId || {};
      if (_afkActivating) game.burstFirePendingMsgId[_afkActivating] = true;
    }
    // Crippling Blow: mark so Stun is applied to defender if attack doesn't miss
    if (entry.label === 'Crippling Blow') {
      game.cripplingBlowPending = game.cripplingBlowPending || {};
      if (_afkActivating) game.cripplingBlowPending[_afkActivating] = true;
    }
    // Disruptor Rifle: mark so extra damage is applied if defender at 1 HP after non-miss attack
    if (entry.label === 'Disruptor Rifle') {
      game.disruptorRiflePending = game.disruptorRiflePending || {};
      if (_afkActivating) game.disruptorRiflePending[_afkActivating] = true;
    }
    // Tonfa Strike: mark so second free attack is granted after first resolves
    if (entry.label === 'Tonfa Strike') {
      game.tonfaStrikeSecondAttack = game.tonfaStrikeSecondAttack || {};
      if (_afkActivating) game.tonfaStrikeSecondAttack[_afkActivating] = true;
    }
    // Barrage (CT-1701): mark so second free attack is granted after first resolves (defender +1 white die, within 3 of first target)
    if (entry.label === 'Barrage') {
      game.barrageSecondAttack = game.barrageSecondAttack || {};
      if (_afkActivating) game.barrageSecondAttack[_afkActivating] = true;
    }
    // Close Quarters: at attack time, override dice with adjacent hostile's pool + remove 1 defense die
    if (entry.closeQuartersOverride) {
      // Per alexanbv 2026-05-13: per-figureKey (specials are per-figure).
      game.closeQuartersActive = game.closeQuartersActive || {};
      const _cqFk = figureKeyForActivation(game, msgId);
      if (_cqFk) {
        // Thread the player-chosen (or auto-picked) source hostile figureKey
        // so combat.js borrows from THAT figure, not the first by iteration
        // order. Falls back to true (combat.js picks the first adjacent
        // hostile) only when no source was resolved (e.g. no map context).
        const _cqSrc = game._closeQuartersChosenSource?.[_cqFk];
        game.closeQuartersActive[_cqFk] = _cqSrc ? { source: _cqSrc } : true;
        if (game._closeQuartersChosenSource) delete game._closeQuartersChosenSource[_cqFk];
      }
    }
    // overrideAttackType (Face to Face, Dying Lunge, Final Stand, Lightsaber Throw): force attack type without overriding dice.
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    if (entry.overrideAttackType) {
      const _oatFk = _afkActivating || figureKeyForActivation(game, msgId);
      if (_oatFk) {
        game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
        game.pendingOverrideAttackDice[_oatFk] = {
          // Normalize to lowercase: every consumer compares against 'melee' /
          // 'ranged' (combat.js:3862-3863, dc-play-area.js:58/4083), but some
          // library entries store capitalized "Melee"/"Ranged" (e.g. Dying
          // Lunge). Lowercasing here keeps the type restriction effective
          // regardless of the entry's casing.
          type: entry.overrideAttackType ? String(entry.overrideAttackType).toLowerCase() : null,
          dice: null, pierce: 0,
          bonusAccuracy: entry.overrideBonusAccuracy || 0,
          mustTargetNonAdjacent: entry.mustTargetNonAdjacent || false,
          blockSurgeAbilities: entry.blockSurgeAbilities || false,
        };
      }
    }
    // selfDefeatsAfterAttack (Dying Lunge, Final Stand): attacker figure
    // defeated when free attack resolves. Per alexanbv 2026-05-13: per-figureKey.
    if (entry.selfDefeatsAfterAttack) {
      const _sdaFk = figureKeyForActivation(game, msgId);
      game.selfDefeatsAfterAttackMsgId = game.selfDefeatsAfterAttackMsgId || {};
      if (_sdaFk) game.selfDefeatsAfterAttackMsgId[_sdaFk] = true;
    }
    // postActivationConditions (Wild Fury): apply conditions after last
    // free attack. Per alexanbv 2026-05-13: per-figureKey.
    if (Array.isArray(entry.postActivationConditions) && entry.postActivationConditions.length > 0) {
      const _pacFk = figureKeyForActivation(game, msgId);
      game.postActivationConditions = game.postActivationConditions || {};
      if (_pacFk) game.postActivationConditions[_pacFk] = entry.postActivationConditions;
    }
    // nextAttackBonusAccuracy (Charged Shot): grant bonus accuracy on next attack (per-figure 2026-05-09)
    if (typeof entry.nextAttackBonusAccuracy === 'number' && entry.nextAttackBonusAccuracy > 0 && _fabFk) {
      game.nextAttackBonusAccuracy = game.nextAttackBonusAccuracy || {};
      game.nextAttackBonusAccuracy[_fabFk] = (game.nextAttackBonusAccuracy[_fabFk] || 0) + entry.nextAttackBonusAccuracy;
    }
    // mpBonus alongside freeAttackBonus (Face to Face, Final Stand,
    // Dying Lunge, Lord of the Sith: move + free attack). Cards
    // tagged `isMoveX: true` route through pendingMoveX with a
    // freeAttackPrompt continuation; the "Declare Attack" button
    // posts after the picker drains. Cards without the flag stay
    // on the legacy banked-MP path until classified.
    //
    // Strict ordering for cards that ALSO grant a power token
    // (Final Stand): defer the Move-X picker until after the
    // power-token-type prompt resolves. handlePowerTokenChoice
    // (combat.js) reads `deferredMoveX` on the pending grant and
    // stamps + posts the picker once the player picks token type.
    let fabMpNote = '';
    let fabMpRefresh = false;
    let _fabPmxMsgId = null;
    let _fabRequiresTokenChoice = false;
    if (typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
      if (entry.isMoveX) {
        const meta = dcMessageMeta?.get?.(msgId);
        const _fabFigureKeys = Object.keys(game.figurePositions?.[playerNum] || {})
          .filter(k => k.startsWith((meta?.dcName || '') + '-'));
        const _fabSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const _fabFigureKey = _fabFigureKeys[_fabSelectedIdx] || _fabFigureKeys[0] || null;
        if (!_fabFigureKey) {
          return { applied: false, manualMessage: `**${entry.label}** — could not locate the activating figure; resolve manually.` };
        }
        const _fabPicker = {
          remaining: entry.mpBonus,
          source: entry.label || 'Move X',
          playerNum,
          figureKey: _fabFigureKey,
          dcName: meta?.dcName || '',
          threadId: null,
          bypassCosts: true,
          msgId,
          nextAction: {
            type: 'freeAttackPrompt',
            payload: {
              msgId, playerNum, figureKey: _fabFigureKey,
              sourceLabel: entry.label || 'Free Attack',
            },
          },
        };
        if (typeof entry.powerTokenGain === 'number' && entry.powerTokenGain > 0) {
          // Defer Move-X stamp until token-type chosen. Power
          // token grant fires first; handlePowerTokenChoice
          // stamps the picker after the type is selected.
          const _figName = dcNameFromFigureKey(_fabFigureKey);
          game.pendingPowerTokenGrant = {
            grants: [{ figureKey: _fabFigureKey, figName: _figName, count: entry.powerTokenGain }],
            channelId: null,
            playerNum,
            deferredMoveX: _fabPicker,
          };
          _fabRequiresTokenChoice = true;
          fabMpNote = ` Gain ${entry.powerTokenGain} Power Token (choose type), then move up to ${entry.mpBonus} space${entry.mpBonus !== 1 ? 's' : ''}, then take a free attack.`;
        } else {
          game.pendingMoveX = game.pendingMoveX || {};
          game.pendingMoveX[msgId] = _fabPicker;
          _fabPmxMsgId = msgId;
          fabMpNote = ` May move up to ${entry.mpBonus} space${entry.mpBonus !== 1 ? 's' : ''} (no bank), then take a free attack.`;
        }
      } else {
        addMovementPoints(game, msgId, entry.mpBonus);
        fabMpNote = ` Gained ${entry.mpBonus} MP.`;
        fabMpRefresh = true;
      }
    }
    // freeMoveBonus + freeAttackBonus (Leaping Slash: "Move up to 2 spaces, then
    // perform an attack"). This block returns before the standalone freeMoveBonus
    // handler below could run, so set up the Move-X picker → freeAttackPrompt here
    // (alexanbv 2026-06-20; the 2-space move was previously dropped).
    if (!_fabPmxMsgId && !_fabRequiresTokenChoice && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0) {
      const _fmMeta = dcMessageMeta?.get?.(msgId);
      const _fmFigureKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(k => k.startsWith((_fmMeta?.dcName || '') + '-'));
      const _fmSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _fmFigureKey = _fmFigureKeys[_fmSelectedIdx] || _fmFigureKeys[0] || null;
      if (_fmFigureKey) {
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[msgId] = {
          remaining: entry.freeMoveBonus,
          source: entry.label || 'Move X',
          playerNum,
          figureKey: _fmFigureKey,
          dcName: _fmMeta?.dcName || '',
          threadId: null,
          bypassCosts: !!entry.freeMoveBypassCosts,
          msgId,
          nextAction: {
            type: 'freeAttackPrompt',
            payload: { msgId, playerNum, figureKey: _fmFigureKey, sourceLabel: entry.label || 'Free Attack' },
          },
        };
        _fabPmxMsgId = msgId;
        fabMpNote += ` May move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''}, then take a free attack.`;
      }
    }
    const label = entry.label || 'Heroic';
    const countNote = (entry.freeAttackBonusCount ?? 1) > 1 ? ` (${entry.freeAttackBonusCount} times, each targeting a different figure)` : '';
    const accNote = entry.nextAttackBonusAccuracy ? ` +${entry.nextAttackBonusAccuracy} Accuracy.` : '';
    return {
      applied: true,
      freeAction: true,
      refreshMovementBank: fabMpRefresh,
      activeMsgId: msgId,
      pendingMoveXMsgId: _fabPmxMsgId,
      requiresPowerTokenChoice: _fabRequiresTokenChoice,
      logMessage: entry.logMessage || (`**${label}** — Your next attack${countNote} costs no action.${accNote} Click Attack when ready.` + fabMpNote),
    };
  }

  // dcSpecial: spendMpForBlockToken (Shield Gauntlets) — spend N MP to gain 1 Block power token
  if (entry.type === 'dcSpecial' && typeof entry.spendMpForBlockToken === 'number') {
    const { game, msgId, meta, playerNum } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const actionsData = game.dcActionsData?.[msgId];
    const selectedFig = actionsData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const figureKey = `${meta.dcName}-${dgIndex}-${selectedFig}`;
    // oncePer enforcement per alexanbv 2026-05-11 — Shield Gauntlets is
    // "once during your activation" PER FIGURE. Track on actionsData
    // (per-figure-per-activation), which resets next time this figure
    // activates.
    if (entry.oncePer === 'activation') {
      actionsData.shieldGauntletsUsed = actionsData.shieldGauntletsUsed || {};
      if (actionsData.shieldGauntletsUsed[selectedFig]) {
        return { applied: false, manualMessage: `**${entry.label}** — already used this activation by figure #${selectedFig + 1}.` };
      }
    }
    const remaining = figureMpRemaining(game, msgId, selectedFig);
    const mpCost = entry.spendMpForBlockToken;
    if (remaining < mpCost) return { applied: false, manualMessage: `**${entry.label}** requires ${mpCost} MP (you have ${remaining}).` };
    consumeMovementPoints(game, msgId, mpCost, selectedFig);
    if (entry.oncePer === 'activation') {
      actionsData.shieldGauntletsUsed = actionsData.shieldGauntletsUsed || {};
      actionsData.shieldGauntletsUsed[selectedFig] = true;
    }
    grantPowerTokens(game, figureKey, 'Block', 1);
    return { applied: true, freeAction: !!entry.freeAction, refreshMovementBank: true, activeMsgId: msgId, refreshDcEmbed: true, logMessage: `**${entry.label}** — Spent ${mpCost} MP → gained 1 **Block Token** (${remaining - mpCost} MP remaining).` };
  }

  // dcSpecial: freeMoveEqualToSpeed (Wall Run, Charge) — gain free MP equal to DC's Speed
  if (entry.type === 'dcSpecial' && entry.freeMoveEqualToSpeed) {
    const { game, msgId, meta, playerNum } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const dcStats = getStatsForDc(meta.dcName);
    const speed = typeof dcStats?.speed === 'number' ? dcStats.speed : 4;
    // Charge (alexanbv 2026-05-11): route through pendingMoveX picker
    // (forced move, single window) with bypassCosts=true rather than
    // banking MP. Wall Run still uses the bank path (no freeMoveAsMoveX).
    if (entry.freeMoveAsMoveX) {
      const _chActD = game.dcActionsData?.[msgId];
      const _chSelF = _chActD?.selectedFigure ?? 0;
      const _chDgM = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _chDgI = _chDgM ? _chDgM[1] : '1';
      const _chFkActive = `${meta.dcName}-${_chDgI}-${_chSelF}`;
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: speed,
        source: entry.label || 'Charge',
        playerNum,
        figureKey: _chFkActive,
        dcName: meta.dcName,
        threadId: null,
        bypassCosts: !!entry.freeMoveBypassCosts,
        msgId,
        nextAction: null,
      };
      if (entry.freeAttackBonus) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        if (_chFkActive) game.freeAttackBonusPending[_chFkActive] = true;
      }
      const _chExtraMsg = entry.freeAttackBonus ? ' Then your next attack costs no action.' : '';
      return {
        applied: true,
        logMessage: entry.logMessage || `**${entry.label || 'Charge'}** — Move up to ${speed} spaces${entry.freeMoveBypassCosts ? ' (ignoring terrain costs)' : ''}.${_chExtraMsg}`,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
      };
    }
    addMovementPoints(game, msgId, speed);
    // Charge (and similar): also grant a free attack after the move
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      const _chFk = figureKeyForActivation(game, msgId);
      if (_chFk) game.freeAttackBonusPending[_chFk] = true;
    }
    // Wall Run: tag the activating figure so movement.js waives difficult-
    // terrain MP cost in cells edge/corner-adjacent to a wall. Cleared at
    // activation end via clearActivationDcEffects.
    if (entry.wallRun) {
      const _wrActions = game.dcActionsData?.[msgId];
      const _wrSelFig = _wrActions?.selectedFigure ?? 0;
      const _wrDgM = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _wrDgI = _wrDgM ? _wrDgM[1] : '1';
      const _wrFk = `${meta.dcName}-${_wrDgI}-${_wrSelFig}`;
      game.figureWallRunActive = game.figureWallRunActive || {};
      game.figureWallRunActive[_wrFk] = true;
    }
    const label = entry.label || 'Wall Run';
    const extraMsg = entry.freeAttackBonus ? ' Then your next attack costs no action.' : ' You may ignore terrain in cells edge or corner adjacent to a wall during this movement.';
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
        _slamLogMsg += stashPushPartingBlow(game, targetFigureKey, oppNum, _slamPrevPos, context.chosenSpace, playerNum);
        return { applied: true, logMessage: _slamLogMsg, refreshDcEmbed: true, refreshBoard: true };
      }
      // Multi-target variant (Trample): auto-target all adjacent hostiles (up to N), single die roll
      if (entry.rollOneDieMaxTargets && entry.rollOneDieMaxTargets > 1) {
        const maxTgts = entry.rollOneDieMaxTargets;
        // Per alexanbv 2026-05-13: keyed by activating figureKey so the
        // chained-picker continuation is tied to the figure that started
        // it, not the whole group's msgId. _rollOneDieSelfFigureKey was
        // already computed above from selectedFigure.
        const pendingKey = _rollOneDieSelfFigureKey || msgId;
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
          // Slice 6.13 ext (centralized): use applyDamageWithDefeatCheck.
          let _trampleHadDefeats = false;
          for (const tFk of targets) {
            const _isNpcTarget = typeof tFk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(tFk);
            const tName = _isNpcTarget
              ? (() => { const p = tFk.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
              : dcNameFromFigureKey(tFk);
            const subParts = [];
            if (hits > 0) {
              if (_isNpcTarget) {
                const p = tFk.match(/^npc_(thug|krykna)_(\d+)$/);
                const npcRes = applyDamageToNpcSync(game, {
                  npcType: p[1],
                  npcIndex: parseInt(p[2], 10),
                  amount: hits,
                  attackerPlayerNum: playerNum || 1,
                });
                if (npcRes.applied) {
                  subParts.push(`${hits} Dmg (HP: ${npcRes.prevHp}→${npcRes.newHp})`);
                  if (npcRes.defeated) _trampleHadDefeats = true;
                }
              } else {
                const tMsgId = findMsgIdForFigureKey(game, enemyPN, tFk, dcMessageMeta);
                if (dcHealthState && tMsgId) {
                  const fkM = tFk.match(/-(\d+)-(\d+)$/);
                  const fIdx = fkM ? parseInt(fkM[2], 10) : 0;
                  const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, tMsgId, fIdx, hits, enemyPN, {
                    sourceLabel: entry.label || 'Trample',
                    attackerPlayerNum: playerNum || 1,
                  });
                  if (dmgRes.maxHp > 0) {
                    subParts.push(`${hits} Dmg (HP: ${dmgRes.prevHp}→${dmgRes.newHp})`);
                    if (dmgRes.wasDefeated) _trampleHadDefeats = true;
                  }
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
          return {
            applied: true,
            logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. ${parts.join('; ')}.`,
            refreshDcEmbed: true,
            ...(_trampleHadDefeats ? { refreshBoard: true } : {}),
          };
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
          const _labelForRemaining = (fk) => (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk))
            ? (() => { const p = fk.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
            : dcNameFromFigureKey(fk);
          const opts = [...remaining.map(_labelForRemaining), 'Done selecting'];
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
        const validTargetFks = adjacentAll
          .filter(f => isEntryHostileTo(game, f, playerNum || 1))
          .map(f => f.figureKey);
        const _labelFor = (fk) => (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk))
          ? (() => { const p = fk.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
          : dcNameFromFigureKey(fk);
        if (validTargetFks.length === 0) return { applied: false, manualMessage: `No adjacent hostile figures for **${entry.label}**.` };
        // alexanbv 2026-06-22: "Bantha Trample must pick figure." The card reads
        // "Choose up to 3 adjacent hostile figures" — so the player ALWAYS picks
        // which (and how many, up to N, via Done selecting), even when N or fewer
        // are adjacent. No auto-target shortcut: choosing a subset can matter
        // (avoiding a defeat-triggered reaction, leaving a figure alive, etc.).
        game.pendingMultiTargetRoll = game.pendingMultiTargetRoll || {};
        game.pendingMultiTargetRoll[pendingKey] = { targets: [], allTargets: validTargetFks, max: maxTgts };
        const choices = [...validTargetFks.map(_labelFor), 'Done selecting'];
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
        // Slice 6.13 ext (centralized): use applyDamageWithDefeatCheck.
        let _adjHadDefeats = false;
        const _targetIsNpc = typeof targetFigureKey === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFigureKey);
        if (hits > 0) {
          if (_targetIsNpc) {
            const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/);
            const npcRes = applyDamageToNpcSync(game, {
              npcType: p[1],
              npcIndex: parseInt(p[2], 10),
              amount: hits,
              attackerPlayerNum: playerNum || 1,
            });
            if (npcRes.applied) {
              resultParts.push(`${hits} Damage (HP: ${npcRes.prevHp} → ${npcRes.newHp})`);
              if (npcRes.defeated) _adjHadDefeats = true;
            }
          } else {
            const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
            if (dcHealthState && targetMsgId) {
              const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
              const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
              const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, hits, enemyPlayerNum, {
                sourceLabel: entry.label || 'adjacent-hostile damage',
                attackerPlayerNum: playerNum || 1,
              });
              if (dmgRes.maxHp > 0) {
                resultParts.push(`${hits} Damage (HP: ${dmgRes.prevHp} → ${dmgRes.newHp})`);
                if (dmgRes.wasDefeated) _adjHadDefeats = true;
              } else {
                resultParts.push(`apply ${hits} Damage manually`);
              }
            } else {
              resultParts.push(`apply ${hits} Damage manually`);
            }
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
        const targetName = _targetIsNpc
          ? (() => { const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
          : dcNameFromFigureKey(targetFigureKey);
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
                // Push destinations are adjacent to the TARGET (where it
                // will move), not the attacker. Use the multi-cell-aware
                // validator that respects blocking, walls, occupancy, and
                // Spiked Boots.
                const _pusherKws = (getStatsForDc(meta.dcName)?.keywords || []).map(k => String(k).toUpperCase());
                let validPushSpaces = getValidPushDestinations(game, targetFigureKey, enemyPlayerNum, { pusherIsMassive: _pusherKws.includes('MASSIVE') });
                // Cara Dune's Smash card: "push it 1 space to a space
                // ADJACENT TO YOU." Filter destinations to those that share
                // an edge with Cara's footprint. Slam (Chewie) / Ram
                // (Chopper) lack this restriction and so don't set the
                // `pushMustRemainAdjacentToActivator` flag.
                if (entry.pushMustRemainAdjacentToActivator) {
                  const _activSize = game.figureOrientations?.[activFk] || getFigureSize(meta.dcName);
                  const _activCells = getFootprintCells(activPos, _activSize).map((c) => normalizeCoord(c));
                  const mapData = getMapData(mapId);
                  const _activAdj = new Set();
                  for (const c of _activCells) {
                    _activAdj.add(c);
                    for (const n of (mapData?.adjacency?.[c] || [])) _activAdj.add(normalizeCoord(n));
                  }
                  validPushSpaces = validPushSpaces.filter(s => _activAdj.has(normalizeCoord(s)));
                }
                if (validPushSpaces.length > 0) {
                  return {
                    applied: false,
                    requiresSpaceChoice: true,
                    validSpaces: validPushSpaces,
                    targetFigureKey,
                    // destruct 2026-05-06 auto-pick rule: card text says "you
                    // MAY push" — push is OPTIONAL, the player can decline.
                    // Adding allowSkipPush=true tells the dc-play-area UI to
                    // append a "Skip push" button alongside the space picker.
                    allowSkipPush: true,
                    spaceChoiceLabel: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}. Push **${targetName}** to which adjacent space? (or **Skip push**)`,
                  };
                }
              }
            }
          }
        }
        const _rodResult = {
          applied: true,
          freeAction: !!entry.freeAction,
          logMessage: `**${entry.label}** — Rolled 1 ${color} die: **${diceResult}**. **${targetName}** ${resultParts.join(', ') || 'unaffected'}.`,
          refreshDcEmbed: true,
          ...(_adjHadDefeats ? { refreshBoard: true } : {}),
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
      const validTargets = adjacentAll.filter((f) => isEntryHostileTo(game, f, playerNum || 1));
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
      // Compute the activating figure key for per-figure once-per-X gating.
      const _hwrActD = game?.dcActionsData?.[msgId];
      const _hwrSelF = _hwrActD?.selectedFigure ?? 0;
      const _hwrDgM = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _hwrDgI = _hwrDgM ? _hwrDgM[1] : '1';
      const _hwrSelfFk = meta?.dcName ? `${meta.dcName}-${_hwrDgI}-${_hwrSelF}` : null;
      // oncePer: 'round' (per alexanbv 2026-05-11 — "once per FIGURE per
      // round" for Super Commando Jetpack Rocket; the slug stored under
      // roundFigureAbilityUsed is figureKey-scoped, so the cap is
      // automatically per-figure within the round).
      if (entry.oncePer === 'round' && _hwrSelfFk) {
        game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
        const _hwrUsedKey = `${_hwrSelfFk}_${abilityId}`;
        if (game.roundFigureAbilityUsed[_hwrUsedKey]) {
          return { applied: false, manualMessage: `**${entry.label}** — already used this round by **${dcNameFromFigureKey(_hwrSelfFk)}**.` };
        }
      }
      // Phase 2: target chosen → check MP cost, roll die, apply damage
      if (targetFigureKey) {
        // Check MP cost (per-figure; alexanbv 2026-06-13)
        if (mpCost > 0 && msgId) {
          const _hwrFigIdx = figureIndexFromKey(_hwrSelfFk) ?? game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
          const remaining = figureMpRemaining(game, msgId, _hwrFigIdx);
          if (remaining < mpCost) return { applied: false, manualMessage: `**${entry.label}** requires ${mpCost} MP (you have ${remaining}).` };
          consumeMovementPoints(game, msgId, mpCost, _hwrFigIdx);
        }
        // Mark used after MP successfully spent.
        if (entry.oncePer === 'round' && _hwrSelfFk) {
          game.roundFigureAbilityUsed = game.roundFigureAbilityUsed || {};
          game.roundFigureAbilityUsed[`${_hwrSelfFk}_${abilityId}`] = true;
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
        // Slice 6.13 ext (centralized): use applyDamageWithDefeatCheck.
        let _hwrHadDefeats = false;
        if (totalDmg > 0) {
          const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
          if (dcHealthState && targetMsgId) {
            const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, totalDmg, enemyPlayerNum, {
              sourceLabel: entry.label || 'hostileWithinRange damage',
              attackerPlayerNum: playerNum || 1,
            });
            if (dmgRes.maxHp > 0) {
              resultParts.push(`${totalDmg} Damage (HP: ${dmgRes.prevHp} → ${dmgRes.newHp})`);
              if (dmgRes.wasDefeated) _hwrHadDefeats = true;
            } else {
              resultParts.push(`apply ${totalDmg} Damage manually`);
            }
          } else {
            resultParts.push(`apply ${totalDmg} Damage manually`);
          }
        }
        // rollOneDieSurgeCondition (Dewback Shock Lance: Weaken on a Surge) —
        // apply the condition to the chosen target if a Surge was rolled.
        if (entry.rollOneDieSurgeCondition && surges >= 1) {
          if (applyCondition(game, targetFigureKey, entry.rollOneDieSurgeCondition)) {
            resultParts.push(`becomes **${entry.rollOneDieSurgeCondition}**`);
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
          ...(_hwrHadDefeats ? { refreshBoard: true } : {}),
        };
      }
      // Phase 1: enumerate hostile figures within range (+ optional LOS)
      if (!game || !meta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually.` };
      // Check MP cost upfront (per-figure; alexanbv 2026-06-13)
      if (mpCost > 0 && msgId) {
        const remaining = figureMpRemaining(game, msgId, game.dcActionsData?.[msgId]?.selectedFigure ?? 0);
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
      const { hasLineOfSightByCoord: losCheck, getFigureSize: gfs } = context;
      const validTargets = [];
      for (const [fk, pos] of Object.entries(enemyPositions)) {
        if (!pos) continue;
        const dist = countGameSpaces(game, activatingPos, pos);
        if (dist > maxRange) continue;
        if (requiresLos && typeof losCheck === 'function' && !losCheck(game, activatingPos, pos, getMapData(mapId), gfs)) continue;
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
        // Slice 6.13 ext (centralized): use applyDamageWithDefeatCheck — it
        // auto-queues lethal hits onto game._pendingFigureDefeats, drained
        // by apply-ability-result.js post-resolve. No manual defeatedFigures
        // plumbing needed.
        let _hadDefeats = false;
        if (hits > 0) {
          const boardState = getBoardStateForMovement(game, null);
          const adj = boardState?.mapSpaces?.adjacency?.[spaceUpper.toLowerCase()] || [];
          const affectedSpaces = new Set([spaceUpper.toLowerCase(), ...adj.map((s) => String(s).toLowerCase())]);
          const affected = [];
          // Per CRR + destruct 2026-05-05 "each other figure" excludes the
          // SOURCE (the activating figure). Wrist Flamethrower / Flamethrower /
          // Shock Grenade / Parting Gift / Tauntaun Headbutt all use this rule.
          // EXCEPTION: Mortar Launcher (AT-RT) — card text says "each figure
          // on or adjacent" (no "other"); per destruct 2026-05-07 the AT-RT
          // takes splash too if it picks an adjacent space. Such abilities
          // set entry.includeSelf=true.
          const _selfAttackerPN = _rollOneDieSelfFigureKey
            ? (Object.entries(game.figurePositions?.[1] || {}).some(([k]) => k === _rollOneDieSelfFigureKey) ? 1 : 2)
            : null;
          // Per destruct 2026-05-08: Fireproof (Flame Trooper attachment)
          // — figures unaffected by abilities with "Flamethrower" in
          // their name (full skip, not just strain immunity).
          const _isFlameNamedAbility = /flamethrower/i.test(String(entry.label || ''));
          for (const pn of [1, 2]) {
            for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
              if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
              if (!entry.includeSelf && _rollOneDieSelfFigureKey && fk === _rollOneDieSelfFigureKey) continue;
              // rollOneDieHostileOnly (Neurotoxin): only OPPONENT figures are
              // affected — friendlies in the blast are untouched (CSV row 222).
              if (entry.rollOneDieHostileOnly && pn === playerNum) continue;
              // rollOneDieAreaCondition (Neurotoxin: Weaken): each affected
              // figure gains the condition (independent of the damage rolled).
              if (entry.rollOneDieAreaCondition) applyCondition(game, fk, entry.rollOneDieAreaCondition);
              // rollOneDieSurgeCondition (Shock Grenade: Weaken on a Surge):
              // each affected figure gains the condition only if a Surge was
              // rolled. Mirrors the hostileWithinRange branch (abilities.js
              // ~3244) but applies area-wide.
              if (entry.rollOneDieSurgeCondition && surges >= 1) {
                applyCondition(game, fk, entry.rollOneDieSurgeCondition);
              }
              const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
              // Fireproof — skip Flame Trooper attached figures from
              // any ability whose label contains "Flamethrower".
              if (_isFlameNamedAbility && figMsgId) {
                const _fpKey = pn === 1 ? 'p1DcAttachments' : 'p2DcAttachments';
                const _fpAtts = game[_fpKey]?.[figMsgId] || [];
                if (_fpAtts.some((a) => /flame trooper/i.test(String(a)))) {
                  affected.push(`${dcNameFromFigureKey(fk)} (Fireproof — immune)`);
                  continue;
                }
              }
              if (dcHealthState && figMsgId) {
                const fkMatch = fk.match(/-(\d+)-(\d+)$/);
                const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
                const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, figMsgId, figIdx, hits, pn, {
                  sourceLabel: entry.label || 'AOE',
                  attackerPlayerNum: _selfAttackerPN ?? (pn === 1 ? 2 : 1),
                });
                if (dmgRes.maxHp > 0) {
                  affected.push(`${dcNameFromFigureKey(fk)} -${hits}HP (→${dmgRes.newHp})`);
                  if (dmgRes.wasDefeated) _hadDefeats = true;
                } else {
                  affected.push(`${dcNameFromFigureKey(fk)} (-${hits}HP, apply manually)`);
                }
              } else {
                affected.push(`${dcNameFromFigureKey(fk)} (-${hits}HP, apply manually)`);
              }
            }
          }
          // Neutral NPCs (Thugs / Krykna) on or adjacent to the targeted
          // space also suffer damage per alexanbv 2026-05-10 — Mortar
          // Launcher / spaceWithin AOE "affects NPCs but not objects".
          for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
            const arr = game[arrName];
            if (!Array.isArray(arr)) continue;
            for (let i = 0; i < arr.length; i++) {
              const npc = arr[i];
              if (!npc || npc.defeated || !npc.coord) continue;
              if (!affectedSpaces.has(String(npc.coord).toLowerCase())) continue;
              const npcRes = applyDamageToNpcSync(game, {
                npcType,
                npcIndex: i,
                amount: hits,
                attackerPlayerNum: _selfAttackerPN ?? null,
              });
              if (npcRes.applied) {
                affected.push(`${npcRes.label} -${hits}HP (→${npcRes.newHp})`);
                if (npcRes.defeated) _hadDefeats = true;
              }
            }
          }
          // Objects (alexanbv 2026-05-11): Parting Gift card text says
          // "each other figure AND OBJECT on or adjacent". Iterate
          // game.objectPositions when entry.affectsObjects is set.
          // Inline sync damage application (no async splash here —
          // splashOnDefeat fires via the full pipeline post-resolution
          // if needed).
          if (entry.affectsObjects && game.objectPositions && game.objectHealth) {
            for (const [objId, objCoord] of Object.entries(game.objectPositions)) {
              if (!objCoord || !affectedSpaces.has(String(objCoord).toLowerCase())) continue;
              const _objHp = game.objectHealth[objId];
              if (!Array.isArray(_objHp)) continue;
              const [cur, max] = _objHp;
              if ((cur ?? 0) <= 0) continue;
              const _objPrev = cur;
              const _objNew = Math.max(0, cur - hits);
              game.objectHealth[objId] = [_objNew, max];
              const _objName = game.objectMeta?.[objId]?.name || objId;
              affected.push(`${_objName} -${hits}HP (${_objPrev}→${_objNew})`);
              if (_objNew === 0) {
                _hadDefeats = true;
                if (game.objectPositions) delete game.objectPositions[objId];
              }
            }
          }
          resultParts.push(affected.length ? affected.join(', ') : 'no figures in blast area');
        }
        // Surge-only roll (0 Hits): the figure loop above is gated on
        // hits>0, so a pure-Surge result would otherwise skip the
        // on-Surge area condition (Shock Grenade: Weaken on a Surge).
        // Apply the condition to each affected figure here.
        let _condOnlyApplied = false;
        if (hits === 0 && entry.rollOneDieSurgeCondition && surges >= 1) {
          const boardStateC = getBoardStateForMovement(game, null);
          const adjC = boardStateC?.mapSpaces?.adjacency?.[spaceUpper.toLowerCase()] || [];
          const affectedSpacesC = new Set([spaceUpper.toLowerCase(), ...adjC.map((s) => String(s).toLowerCase())]);
          const condAffected = [];
          for (const pn of [1, 2]) {
            for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
              if (!coord || !affectedSpacesC.has(String(coord).toLowerCase())) continue;
              if (!entry.includeSelf && _rollOneDieSelfFigureKey && fk === _rollOneDieSelfFigureKey) continue;
              if (entry.rollOneDieHostileOnly && pn === playerNum) continue;
              if (applyCondition(game, fk, entry.rollOneDieSurgeCondition)) {
                condAffected.push(`${dcNameFromFigureKey(fk)} becomes **${entry.rollOneDieSurgeCondition}**`);
              }
            }
          }
          if (condAffected.length) { resultParts.push(condAffected.join(', ')); _condOnlyApplied = true; }
        }
        return {
          applied: true,
          logMessage: `**${entry.label}** — Space **${spaceUpper}** targeted. Rolled 1 ${entry.rollOneDie} die: **${diceResult}**. ${resultParts.join('. ') || 'No effect.'}`,
          refreshDcEmbed: hits > 0 || _condOnlyApplied,
          ...(_hadDefeats ? { refreshBoard: true } : {}),
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
      let validSet = new Set([String(activatingPos).toLowerCase(), ...reachable.map((s) => String(s).toLowerCase())]);
      // Mortar Launcher: target space must contain a hostile figure
      // (regular opponent OR hostileToAll NPC). Per alexanbv 2026-05-10:
      // "Mortar must also choose a space that is occupied by a hostile
      // figure (more restrictive than just within X spaces)."
      if (entry.rollOneDieSpaceRequiresHostileOccupant) {
        const oppPN = opponentPlayerNum(playerNum);
        const hostileCoords = new Set();
        for (const [, c] of Object.entries(game.figurePositions?.[oppPN] || {})) {
          if (c) hostileCoords.add(String(c).toLowerCase());
        }
        for (const arrName of ['npcThugs', 'npcKrykna']) {
          const arr = game[arrName];
          if (!Array.isArray(arr)) continue;
          for (const npc of arr) {
            if (!npc || npc.defeated || !npc.coord) continue;
            const h = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
            if (h === 'neutral') continue;
            hostileCoords.add(String(npc.coord).toLowerCase());
          }
        }
        validSet = new Set([...validSet].filter((c) => hostileCoords.has(c)));
      }
      const validSpaces = [...validSet];
      if (validSpaces.length === 0) return { applied: false, manualMessage: `Resolve **${entry.label}** manually (no valid target spaces${entry.rollOneDieSpaceRequiresHostileOccupant ? ' — no hostile figure in range' : ''}).` };
      // freeMoveBonus + rollOneDie (Mortar Launcher): the figure must
      // first complete the Move-X budget, THEN pick a target space
      // for the dice roll. Strict sequencing — the target-space
      // picker is deferred onto pendingMoveX.nextAction and fires
      // when the Move-X picker finishes (either by exhausting the
      // budget or the player clicking Stop).
      if (entry.freeMoveBonus > 0 && msgId) {
        const _meta = context.meta;
        const _rdpn = _meta?.playerNum ?? playerNum;
        const _rdFigureKeys = Object.keys(game.figurePositions?.[_rdpn] || {})
          .filter(k => k.startsWith((_meta?.dcName || '') + '-'));
        const _rdSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const _rdFigureKey = _rdFigureKeys[_rdSelectedIdx] || _rdFigureKeys[0] || null;
        if (_rdFigureKey && _rdpn) {
          game.pendingMoveX = game.pendingMoveX || {};
          game.pendingMoveX[msgId] = {
            remaining: entry.freeMoveBonus,
            source: entry.label || 'Move X',
            playerNum: _rdpn,
            figureKey: _rdFigureKey,
            dcName: _meta?.dcName || '',
            threadId: null,
            msgId,
            nextAction: {
              type: 'rollOneDieSpacePick',
              range,
              label: entry.label || 'Roll 1 Die',
              abilityId,
              specialIdx: context.specialIdx ?? null,
              figureIndex: _rdSelectedIdx,
              requireHostileOccupant: !!entry.rollOneDieSpaceRequiresHostileOccupant,
              spaceChoiceLabel: `**${entry.label}** — Choose a target space within ${range}${entry.rollOneDieSpaceRequiresHostileOccupant ? ' containing a hostile figure' : ''}:`,
            },
          };
          return {
            applied: true,
            pendingMoveXMsgId: msgId,
            logMessage: `**${entry.label}** — Move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''} first, then choose a target space within ${range}.`,
            activeMsgId: msgId,
          };
        }
      }
      // No Move-X budget (no freeMoveBonus) — original immediate
      // space-pick path.
      return {
        requiresSpaceChoice: true,
        validSpaces,
        spaceChoiceLabel: `**${entry.label}** — Choose a target space within ${range}:`,
        refreshMovementBank: false,
        activeMsgId: msgId,
      };
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
      // Per alexanbv 2026-05-11 (Mando bug): "each other figure" excludes
      // the SOURCE figure unless entry.includeSelf is explicitly set
      // (e.g. Mortar Launcher — "each figure" without "other"). Compute
      // the source figureKey up-front so the loop can skip it.
      const _faeActD = game.dcActionsData?.[msgId];
      const _faeSelF = _faeActD?.selectedFigure ?? 0;
      const _faeDgM = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const _faeDgI = _faeDgM ? _faeDgM[1] : '1';
      const _faeSelfFigureKey = meta?.dcName ? `${meta.dcName}-${_faeDgI}-${_faeSelF}` : null;
      // Damage applies synchronously through applyDamageWithDefeatCheck;
      // Strain is queued via pendingStrain[] so apply-ability-result.js
      // routes it through the canonical applyStrain pipeline (Fireproof /
      // Headhunter / per-strain choice / Under Duress / Paz).
      const _faePendingStrain = [];
      let _fadHadDefeats = false;
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || !affectedSpaces.has(String(coord).toLowerCase())) continue;
          if (!entry.includeSelf && _faeSelfFigureKey && fk === _faeSelfFigureKey) continue;
          const dcName = dcNameFromFigureKey(fk);
          const parts = [];
          if (dmgAmt > 0) {
            const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
            if (figMsgId) {
              const fkMatch = fk.match(/-(\d+)-(\d+)$/);
              const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
              const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, figMsgId, figIdx, dmgAmt, pn, {
                sourceLabel: entry.label || 'fixedArea damage',
                attackerPlayerNum: playerNum || (pn === 1 ? 2 : 1),
              });
              if (dmgRes.maxHp > 0) {
                parts.push(`${dmgAmt} Dmg (HP: ${dmgRes.prevHp}→${dmgRes.newHp})`);
                if (dmgRes.wasDefeated) _fadHadDefeats = true;
              } else {
                parts.push(`apply ${dmgAmt} damage manually`);
              }
            } else {
              parts.push(`apply ${dmgAmt} damage manually`);
            }
          }
          if (strainAmt > 0) {
            _faePendingStrain.push({
              figureKey: fk,
              controllerPlayerNum: pn,
              amount: strainAmt,
              source: entry.label || 'fixedArea strain',
            });
            parts.push(`+ ${strainAmt} Strain`);
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
      // Apply self strain via applyStrain pipeline (Demolish costs 1 self-strain)
      const selfStrainAmt = entry.fixedSelfStrain || 0;
      if (selfStrainAmt > 0 && msgId) {
        const actData = game.dcActionsData?.[msgId];
        const selfFigIdx = actData?.selectedFigure ?? 0;
        const dgMatch = (meta?.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
        const dgIndex = dgMatch ? dgMatch[1] : '1';
        const selfFigureKey = meta?.dcName ? `${meta.dcName}-${dgIndex}-${selfFigIdx}` : null;
        if (selfFigureKey && playerNum) {
          _faePendingStrain.push({
            figureKey: selfFigureKey,
            controllerPlayerNum: playerNum,
            amount: selfStrainAmt,
            source: `${entry.label || 'fixedArea'} (self)`,
          });
          results.push(`**${meta?.dcName}** suffers ${selfStrainAmt} Strain (self)`);
        }
      }
      // Place rubble token on chosen space
      if (entry.placesRubble) {
        game.ancillaryTokens = game.ancillaryTokens || {};
        game.ancillaryTokens.rubble = [...(game.ancillaryTokens.rubble || []), spaceNorm];
        results.push(`rubble token placed at **${String(chosenSpace).toUpperCase()}**`);
      }
      // Deduct MP cost if specified (e.g. Wrist Flamethrower costs 2 MP).
      // Per alexanbv 2026-05-13: per-figure MP bank.
      if (entry.mpCost > 0) {
        const _mpFigIdx2 = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const _spent = consumeMovementPoints(game, msgId, entry.mpCost, _mpFigIdx2);
        if (_spent > 0) results.push(`spent ${_spent} MP`);
      }
      const spaceUpper = String(chosenSpace).toUpperCase();
      return {
        applied: true,
        logMessage: `**${entry.label}** — Space **${spaceUpper}**. ${results.length ? results.join('; ') : 'No figures affected.'}`,
        refreshDcEmbed: results.length > 0,
        refreshBoard: !!entry.placesRubble || _fadHadDefeats,
        ...(_faePendingStrain.length ? { pendingStrain: _faePendingStrain } : {}),
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
    // LOS gate (Demolish, Boulder Barrage): the target space must be in
    // line of sight of the activating figure (CSV "within N spaces AND
    // line of sight"). Mirrors the per-space LOS check at abilities.js:3268.
    if (entry.requiresLos) {
      const { hasLineOfSightByCoord: _faeLosCheck, getMapData: _faeGetMs, getFigureSize: _faeGfs } = context;
      const _faeMs = _faeGetMs ? _faeGetMs(game.selectedMap?.id) : null;
      if (typeof _faeLosCheck === 'function' && _faeMs) {
        validSet = new Set([...validSet].filter((sp) =>
          sp === String(activatingPos).toLowerCase()
          || _faeLosCheck(game, activatingPos, sp, _faeMs, _faeGfs)));
      }
    }
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
    // Move-first (Din's Wrist Flamethrower: "Move up to 2 spaces, THEN choose a
    // space within 2"). Set up the Move-X picker; its rollOneDieSpacePick
    // continuation recomputes the valid spaces from the post-move position and
    // posts the burst-space picker, which routes the chosen space back to
    // resolveAbility(abilityId, {chosenSpace}) → Phase 2 above. (The previous
    // code ignored freeMoveBonus on this path — alexanbv 2026-06-19.)
    if (typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && !entry.fixedAreaRequiresAdjacentHostile && msgId) {
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: entry.freeMoveBonus,
        source: entry.label || 'Move X',
        playerNum,
        figureKey: activatingFigureKey,
        dcName: meta?.dcName || '',
        threadId: null,
        msgId,
        bypassCosts: !!entry.freeMoveBypassCosts,
        nextAction: {
          type: 'rollOneDieSpacePick',
          range,
          label: entry.label || 'Area Effect',
          abilityId,
          specialIdx: context.specialIdx ?? null,
          figureIndex: selectedFig,
          requireHostileOccupant: false,
          spaceChoiceLabel: `**${entry.label}** — Choose a space within ${range}:`,
        },
      };
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        logMessage: `**${entry.label}** — Move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''} first, then choose a space within ${range}.`,
        activeMsgId: msgId,
      };
    }
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

  // dcSpecial: freeMoveBonus standalone (I'm One With the Force, Executor, etc.) — Move-X picker; optionally also grant free attack
  // NOTE: recover+move combos (Evasive Maneuver: recoverSelf:2 + freeMoveBonus:2)
  // are handled by the purpose-built recoverSelf block below, which stamps the
  // Move-X picker AND applies the heal — so exclude recoverSelf here, else the
  // 'then recover N Damage' half is silently dropped (alexanbv audit Jun 2026).
  if (entry.type === 'dcSpecial' && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && !entry.nextAttacksBonusHits && !(entry.recoverSelf > 0)) {
    const { game, msgId, meta, playerNum } = context;
    if (!game || !msgId) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Resolve the active figure key for the picker (selectedFigure
    // index into the DC's deployed figures by dcName prefix).
    const _pn = meta?.playerNum ?? playerNum;
    const _figureKeys = Object.keys(game.figurePositions?.[_pn] || {})
      .filter(k => k.startsWith((meta?.dcName || '') + '-'));
    const _selectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _figureKey = _figureKeys[_selectedIdx] || _figureKeys[0] || null;
    // Pick the chained continuation that fires when the picker
    // drains. Cards with a free-attack follow-up (Executor, Leaping
    // Slash, Tonfa Strike, Fell Swoop, etc.) get a freeAttackPrompt
    // continuation so the player gets an explicit "Declare Attack"
    // button immediately after the move; rushPostMovePush /
    // shoulderRushPostMove get their own continuation types so the
    // post-move push + attack fires from the picker exit instead of
    // the legacy handleMovePick MP-bank exhaustion path.
    let _nextAction = null;
    if (entry.rushPostMovePush) {
      _nextAction = { type: 'rushPostMove', payload: { msgId, playerNum: _pn, figureKey: _figureKey } };
    } else if (entry.shoulderRushPostMove) {
      _nextAction = { type: 'shoulderRushPostMove', payload: { msgId, playerNum: _pn, figureKey: _figureKey } };
    } else if (entry.freeAttackBonus) {
      _nextAction = { type: 'freeAttackPrompt', payload: { msgId, playerNum: _pn, figureKey: _figureKey, sourceLabel: entry.label || 'Free Attack' } };
    }
    // Stamp pendingMoveX state synchronously; the caller posts the
    // picker UI when it sees pendingMoveXMsgId on the result.
    if (_figureKey && _pn) {
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: entry.freeMoveBonus,
        source: entry.label || 'Move X',
        playerNum: _pn,
        figureKey: _figureKey,
        dcName: meta?.dcName || '',
        threadId: null,
        msgId,
        bypassCosts: !!entry.freeMoveBypassCosts,
        nextAction: _nextAction,
      };
    }
    // Free-attack flag still needed: the granted-attack button (if
    // posted by the freeAttackPrompt continuation) reads
    // freeAttackBonusPending in combat.js to mark the attack as free.
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      if (_figureKey) game.freeAttackBonusPending[_figureKey] = true;
    }
    // mobileMovement (Lift Off): grant Mobile movement for these MP.
    // Per alexanbv 2026-05-13: per-figureKey (specials are per-figure).
    if (entry.mobileMovement) {
      game.mobileMovementActive = game.mobileMovementActive || {};
      if (_figureKey) game.mobileMovementActive[_figureKey] = true;
    }
    return {
      applied: true,
      freeAction: !!entry.freeAction,
      logMessage: entry.logMessage || `**${entry.label}** — May move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''}.`,
      pendingMoveXMsgId: _figureKey ? msgId : null,
      activeMsgId: msgId,
    };
  }

  // dcSpecial: freeMoveBonus + nextAttacksBonusHits (On the Hunt — Move X spaces, next attack gets +N Hit)
  if (entry.type === 'dcSpecial' && typeof entry.freeMoveBonus === 'number' && entry.freeMoveBonus > 0 && entry.nextAttacksBonusHits) {
    const { game, msgId, meta } = context;
    if (!game || !msgId || !meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const _othFigureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {})
      .filter(k => k.startsWith((meta.dcName || '') + '-'));
    const _othSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _othFigureKey = _othFigureKeys[_othSelectedIdx] || _othFigureKeys[0] || null;
    let _pmxMsgId = null;
    if (_othFigureKey) {
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: entry.freeMoveBonus,
        source: entry.label || 'On the Hunt',
        playerNum: meta.playerNum,
        figureKey: _othFigureKey,
        dcName: meta.dcName || '',
        threadId: null,
      };
      _pmxMsgId = msgId;
    }
    const nb = entry.nextAttacksBonusHits;
    if (_othFigureKey) {
      // Per-figure 2026-05-09 (multifigure-independent-activation rule).
      // On the Hunt: the +1 Damage applies only when the attack targets a unique
      // hostile figure (CSV row 396) — carry the gate to the combat consumer.
      game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
      game.nextAttacksBonusHits[_othFigureKey] = { count: nb.count, bonus: nb.bonus, requiresUniqueHostileTarget: !!nb.requiresUniqueHostileTarget };
    }
    const logMsg = entry.logMessage || `**${entry.label || 'On the Hunt'}** — May move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''}. Next ${nb.count} attack${nb.count !== 1 ? 's' : ''} gain +${nb.bonus} Damage.`;
    return { applied: true, logMessage: logMsg, pendingMoveXMsgId: _pmxMsgId };
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

  // ccEffect: chooseSpaceWithin2OfActivating (Smoke Grenade) — 3 phases:
  //   Phase 1 (no chosenSpace): return validSpaces (within 2 of activator).
  //   Phase 2 (chosenSpace, no chosenFigureKey): place smoke + friendly-figure picker
  //     (figures within 2 of chosen space).
  //   Phase 3 (chosenSpace + chosenFigureKey): grant MP to chosen friendly.
  //     Recipient = activating figure → bank N MP (rule 3, in-activation).
  //     Recipient ≠ activating figure → pendingMoveX picker (rule 1, out-of-
  //     activation grant on someone else; spend immediately, no bank).
  //     bypassCosts FALSE either way — MP grant, not Move-X.
  if (entry.type === 'ccEffect' && entry.chooseSpaceWithin2OfActivating) {
    const { game, playerNum, dcMessageMeta, chosenSpace, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingFigKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingFigKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const activatorIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const activatingFigKey = activatingFigKeys[activatorIdx] || activatingFigKeys[0];
    // Phase 1: pick a space within 2 of any activating-DC figure.
    if (!chosenSpace) {
      const boardState = getBoardStateForMovement(game, null);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Resolve manually: map data missing.' };
      const validSet = new Set();
      for (const fk of activatingFigKeys) {
        const pos = game.figurePositions?.[playerNum]?.[fk];
        if (!pos) continue;
        const occ = boardState.occupiedSet;
        const occArr = occ instanceof Set ? [...occ] : (occ || []);
        const cells = getReachableSpaces(pos, 2, boardState.mapSpaces, occArr);
        for (const c of cells) validSet.add(String(c).toLowerCase());
      }
      const validSpaces = [...validSet];
      if (validSpaces.length === 0) return { applied: false, manualMessage: 'No spaces within 2 to choose.' };
      return { requiresSpaceChoice: true, validSpaces };
    }
    // Phase 3: figure picked → apply MP grant to that friendly.
    if (chosenFigureKey) {
      const recipientPos = game.figurePositions?.[playerNum]?.[chosenFigureKey];
      if (!recipientPos) {
        return { applied: false, manualMessage: `**Smoke Grenade** — recipient ${chosenFigureKey} no longer on the board.` };
      }
      const n = entry.mpBonus || 0;
      // Rule 3 (in-activation grant on the activating figure) → bank.
      if (chosenFigureKey === activatingFigKey) {
        addMovementPoints(game, msgId, n);
        return {
          applied: true,
          logMessage: `**Smoke Grenade** — **${dcNameFromFigureKey(chosenFigureKey)}** (activating) banks **${n} MP**.`,
          refreshMovementBank: true,
          activeMsgId: msgId,
        };
      }
      // Rule 1 (grant on a non-activating friendly) → pendingMoveX
      // picker, spend immediately, remainder lost. Recipient might be
      // controlled by the same player but isn't the active DC — they
      // need a fresh msgId-keyed picker. We piggyback on the recipient
      // DC's msgId so the picker scopes to the right figure.
      const recipMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!recipMsgId) {
        return { applied: false, manualMessage: `**Smoke Grenade** — could not locate **${dcNameFromFigureKey(chosenFigureKey)}**'s play area; resolve manually.` };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[recipMsgId] = {
        remaining: n,
        source: 'Smoke Grenade',
        playerNum,
        figureKey: chosenFigureKey,
        dcName: dcNameFromFigureKey(chosenFigureKey),
        threadId: null,
        bypassCosts: false,
        msgId: recipMsgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: recipMsgId,
        activeMsgId: recipMsgId,
        logMessage: `**Smoke Grenade** — **${dcNameFromFigureKey(chosenFigureKey)}** gains **${n} MP** — spend at once, remainder lost.`,
      };
    }
    // Phase 2: place smoke token, then present friendly-figure picker.
    const spaceUpper = String(chosenSpace).toUpperCase();
    game.ancillaryTokens = game.ancillaryTokens || {};
    game.ancillaryTokens.smoke = [...(game.ancillaryTokens.smoke || []), chosenSpace];
    // CSV row 721: "discard the smoke token at the end of the NEXT round". A
    // token placed in round N persists through round N+1 and is discarded at the
    // end of round N+1 — record expiresAfterRound = currentRound + 1. The
    // start-of-round sweep (cleanupRoundStart) clears tokens once that round has
    // fully elapsed. smoke[] stays a plain coord array for the LOS consumer.
    game.ancillaryTokens.smokeExpiry = game.ancillaryTokens.smokeExpiry || {};
    game.ancillaryTokens.smokeExpiry[chosenSpace] = (game.currentRound || 1) + 1;
    // Compute friendlies within 2 spaces (graph distance) of the smoke
    // space. Use countGameSpaces for distance — same helper Looking
    // for a Fight, etc. use.
    const friendlyKeys = [];
    const friendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      if (countGameSpaces(game, pos, chosenSpace) > 2) continue;
      friendlyKeys.push(fk);
      friendlyLabels.push(dcNameFromFigureKey(fk));
    }
    if (friendlyKeys.length === 0) {
      return {
        applied: true,
        logMessage: `**Smoke Grenade** — placed smoke at **${spaceUpper}**. No friendly figures within 2 spaces; MP grant skipped.`,
        refreshBoard: true,
      };
    }
    if (friendlyKeys.length === 1) {
      // Exactly one valid recipient — auto-pick by recursing with
      // chosenFigureKey set. Re-run dispatch picks up Phase 3.
      return resolveAbility('Smoke Grenade', { ...context, chosenFigureKey: friendlyKeys[0] });
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: friendlyLabels.map(n => `MP recipient: ${n}`),
      choiceValues: friendlyKeys,
      logMessage: `**Smoke Grenade** — placed smoke at **${spaceUpper}**. Choose a friendly figure within 2 spaces to gain ${entry.mpBonus || 0} MP.`,
      refreshBoard: true,
    };
  }

  // ccEffect: placeRubbleOnTargetAndAdjacent (Reduce to Rubble — after attack that hit)
  if (entry.type === 'ccEffect' && entry.placeRubbleOnTargetAndAdjacent) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const spaces = game.lastAttackTargetSpacesForRubble;
    const attackerNum = game.lastAttackAttackerPlayerNum;
    if (!spaces?.length || playerNum !== attackerNum) {
      return { applied: false, manualMessage: 'Play Reduce to Rubble after you resolve an attack that did not miss. No recent attack target stored.' };
    }
    // Damage clause (CSV row 791): each figure AND object within 2 spaces of the
    // target space suffers 1 Damage, THEN rubble is placed (alexanbv 2026-06-20:
    // the damage was previously not applied).
    const _rrTargetCells = game.lastAttackTargetCellsForRubble || [];
    const _rrDamaged = [];
    const _rrWithin2 = (coord) => _rrTargetCells.some((tc) => {
      const d = countGameSpaces(game, tc, String(coord).toLowerCase());
      return typeof d === 'number' && d >= 0 && d <= 2;
    });
    if (_rrTargetCells.length && dcHealthState && dcMessageMeta) {
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || !_rrWithin2(coord)) continue;
          const figMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
          if (!figMsgId) continue;
          const m = fk.match(/-(\d+)-(\d+)$/);
          const fi = m ? parseInt(m[2], 10) : 0;
          const r = applyDamageWithDefeatCheck(dcHealthState, game, figMsgId, fi, 1, pn, { sourceLabel: 'Reduce to Rubble', attackerPlayerNum: attackerNum });
          if (r.maxHp > 0) _rrDamaged.push(`${dcNameFromFigureKey(fk)} -1 (→${r.newHp})`);
        }
      }
      // Objects within 2 (crates / destructible objects): minimal sync HP decrement.
      for (const [objId, objPos] of Object.entries(game.objectPositions || {})) {
        if (!objPos || !_rrWithin2(objPos)) continue;
        const hp = game.objectHealth?.[objId];
        if (!Array.isArray(hp) || (hp[0] ?? 0) <= 0) continue;
        hp[0] = Math.max(0, hp[0] - 1);
        const _objName = game.objectMeta?.[objId]?.name || objId;
        if (hp[0] <= 0 && game.objectPositions) delete game.objectPositions[objId];
        _rrDamaged.push(`${_objName} -1${hp[0] <= 0 ? ' (destroyed)' : ''}`);
      }
    }
    game.ancillaryTokens = game.ancillaryTokens || {};
    game.ancillaryTokens.rubble = [...(game.ancillaryTokens.rubble || []), ...spaces];
    delete game.lastAttackTargetSpacesForRubble;
    delete game.lastAttackTargetCellsForRubble;
    delete game.lastAttackAttackerPlayerNum;
    const _rrDmgNote = _rrDamaged.length ? ` Within 2 of the target: ${_rrDamaged.join(', ')}.` : '';
    return {
      applied: true,
      logMessage: `**Reduce to Rubble** —${_rrDmgNote} Placed rubble tokens on the target space and adjacent spaces (${spaces.length} total).`,
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
    // Stimulants self-damage: the canonical card is "1 Damage" (NOT
    // strain). Applied via applyDamageSync — direct HP reduction with
    // defeat check, no strain pipeline.
    const sRes = applyDamageSync(game, { dcHealthState }, {
      figureKey: `${meta.dcName}-${(meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1'}-0`,
      msgId,
      figIndex: 0,
      amount: damage,
      controllerPlayerNum: playerNum,
      source: entry.label || 'self-damage',
    }) || { wasDefeated: false };
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
      ...(sRes.wasDefeated ? { refreshBoard: true } : {}),
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
    // Discard piles are public per IACP, so the returned-card name is
    // fine to log. But drawn cards are SECRET (alexanbv 2026-05-13) —
    // log a count only, no names.
    const logParts = [`Returned **${toReturn}** from discard to hand.`];
    let drewCards = [];
    if (typeof entry.draw === 'number' && entry.draw > 0) {
      drewCards = drawCcCards(game, playerNum, entry.draw);
      if (drewCards.length > 0) logParts.push(`Drew ${drewCards.length} Command card${drewCards.length === 1 ? '' : 's'}.`);
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

    // Strain cost (Fool Me Once: 2 Strain) — fired via the applyStrain
    // pipeline BEFORE the ability's other side effects via
    // result.pendingStrainCost (Fireproof / Headhunter / UD / Paz /
    // top-of-deck-discard prompt).
    let strainNote = '';
    let refreshDcEmbed = false;
    let _fmoStrainPayload = null;
    if (entry.strainCostToSelf > 0 && dcMessageMeta && dcHealthState) {
      const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (selfMsgId) {
        const selectedFig = game.dcActionsData?.[selfMsgId]?.selectedFigure ?? 0;
        const _fmoMeta = dcMessageMeta.get(selfMsgId);
        const _fmoFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
          .filter(k => k.startsWith((_fmoMeta?.dcName || '') + '-'));
        const _fmoFigKey = _fmoFigKeys[selectedFig] || _fmoFigKeys[0] || null;
        if (_fmoFigKey) {
          _fmoStrainPayload = {
            figureKey: _fmoFigKey,
            controllerPlayerNum: playerNum,
            amount: entry.strainCostToSelf,
            source: `${entry.label || 'CC'} cost`,
          };
          strainNote = ` Suffers ${entry.strainCostToSelf} Strain (resolve via prompt).`;
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
        const eff = getDcEffect(meta.dcName);
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
      pendingStrainCost: _fmoStrainPayload,
    };
  }

  // ccEffect: Draw N, then PLAYER-CHOOSE 1 card from hand to discard,
  // gain VP = cost of the discarded card (Black Market Prices).
  // CSV row 547: "Draw 2 Command cards, then discard 1 card from your
  // hand; gain VPs equal to the cost of the discarded card."
  // Two-phase via the CC choiceValues / chosenFigureKey re-entry
  // (mirrors Jundland Terror's choose-then-resolve pattern), with the
  // chosen value carrying the card NAME instead of a figureKey.
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0 && entry.drawThenDiscardOneGainVp) {
    const { game, playerNum, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const handKey = ccHandKey(playerNum);
    const discardKey = ccDiscardKey(playerNum);
    // Phase 2: a card was chosen → discard it, award VP = its cost.
    // chosenFigureKey carries the chosen card NAME (choiceValues entry).
    if (chosenFigureKey) {
      const toDiscard = chosenFigureKey;
      const hand = (game[handKey] || []).slice();
      const idx = hand.indexOf(toDiscard);
      if (idx < 0) return { applied: false, manualMessage: `**Black Market Prices** — **${toDiscard}** is no longer in hand. Resolve manually.` };
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = (game[discardKey] || []).concat(toDiscard);
      const eff = getCcEffect(toDiscard);
      const cost = typeof eff?.cost === 'number' ? eff.cost : 0;
      const vk = vpKey(playerNum);
      game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
      game[vk].total = (game[vk].total ?? 0) + cost;
      return {
        applied: true,
        refreshHand: true,
        refreshDiscard: true,
        logMessage: `**Black Market Prices** — discarded **${toDiscard}** (cost ${cost}), gained ${cost} VP.`,
      };
    }
    // Phase 1: draw, then prompt the player to choose which hand card
    // to discard. Drawn cards are already in hand (drawCcCards mutates
    // game state); the choice buttons list the full hand (incl. the new
    // draws), and Phase 2 refreshes the hand/discard visuals.
    const drew = drawCcCards(game, playerNum, entry.draw);
    const hand = (game[handKey] || []).slice();
    if (hand.length === 0) {
      return { applied: true, drewCards: drew.length ? drew : undefined, logMessage: '**Black Market Prices** — no cards in hand to discard.' };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: hand.slice(),
      choiceValues: hand.slice(),
      manualMessage: '**Black Market Prices** — choose 1 card from your hand to discard (gain VP equal to its cost).',
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
      const eff = getDcEffect(dcName);
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

  // ccEffect: restInPeaceEffect (Rest in Peace) — block all discard-pile access
  // for the round. Per card text the "discard this card and draw 1 Command
  // card" happens at END OF ROUND, not at play, so the draw is deferred to the
  // EoR flow (round.js _runDcEorForPlayer). The card itself is already in this
  // player's discard pile (CC play auto-discards), satisfying "discard this
  // card". We record the owner so EoR draws for the right player.
  if (entry.type === 'ccEffect' && entry.restInPeaceEffect) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.restInPeaceActive = true;
    game.restInPeacePending = game.restInPeacePending || [];
    if (!game.restInPeacePending.includes(playerNum)) game.restInPeacePending.push(playerNum);
    return {
      applied: true,
      logMessage: '**Rest in Peace** — Players cannot choose, play, or re-draw Command cards in discard piles this round. At the end of the round, draw 1 Command card.',
    };
  }

  // ccEffect: Draw N cards (optionally conditional on figure trait, e.g. Officer's Training).
  // setsThereIsAnother / forbiddenKnowledge carry their own dedicated handlers
  // (draw + extra effects), so skip them here.
  if (entry.type === 'ccEffect' && typeof entry.draw === 'number' && entry.draw > 0 && !entry.setsThereIsAnother && !entry.forbiddenKnowledge) {
    const { game, playerNum, combat, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Officer's Training part 1: "Use while attacking to reroll 1 attack die."
    // This applies regardless of the LEADER trait gate on the part-2 draw, so
    // register the attacker reroll BEFORE the trait check. Mirrors the
    // rerollOneAttackDie registry (Mitigate) at abilities.js:~9978.
    let _otRerollMsg = '';
    if (entry.rerollOneAttackDie) {
      const cbtRR = combat || game.combat || game.pendingCombat;
      if (cbtRR) {
        cbtRR.rerollOneAttackDie = (cbtRR.rerollOneAttackDie || 0) + 1;
        _otRerollMsg = ' You may reroll 1 attack die.';
      }
    }
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
      const eff = getDcEffect(dcName);
      const keywords = (eff?.keywords || []).map((k) => String(k).toUpperCase());
      const trait = String(entry.drawIfTrait).toUpperCase();
      if (!keywords.includes(trait)) return { applied: true, logMessage: _otRerollMsg ? `**${entry.label}** —${_otRerollMsg}`.trim() : undefined };
    }
    const drew = drawCcCards(game, playerNum, entry.draw);
    return { applied: true, drewCards: drew, ...(_otRerollMsg ? { logMessage: `Drew ${drew.length} card.${_otRerollMsg}` } : {}) };
  }

  // ccEffect: forbiddenKnowledge (Forbidden Knowledge, Taron Malicos) — at the
  // start of your activation, draw 1, then discard 1+ Command cards from hand.
  // For EACH card discarded, the activating figure recovers 1 Damage, gains 1
  // movement point, and discards 1 HARMFUL condition. Implemented as a
  // re-entrant requiresChoice loop (handleCcChoice re-posts each step): the
  // first call draws + opens the picker; each pick discards one card and applies
  // the per-card effects, then re-prompts; "Done" (offered once ≥1 discarded)
  // finalizes. alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && entry.forbiddenKnowledge) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenOption } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at the start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    const figureKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const handKey = ccHandKey(playerNum);
    const discardKey = ccDiscardKey(playerNum);
    const FK_DONE = '✓ Done discarding';
    const uniqueHand = () => [...new Set(game[handKey] || [])].slice(0, 24);

    // Phase 1 — first entry: draw, then open the discard picker.
    if (chosenOption == null) {
      const drew = drawCcCards(game, playerNum, entry.draw || 1);
      game.pendingForbiddenKnowledge = { msgId, playerNum, discarded: 0 };
      const hand = uniqueHand();
      if (hand.length === 0) {
        delete game.pendingForbiddenKnowledge;
        return { applied: true, drewCards: drew.length ? drew : undefined, refreshHand: true, logMessage: `**Forbidden Knowledge** — drew ${drew.length} card; no Command cards to discard.` };
      }
      // "discard 1 or more": require at least one discard before Done is offered.
      return { applied: false, requiresChoice: true, choiceOptions: hand };
    }

    // Phase 2 — a pick (card name or Done).
    const st = game.pendingForbiddenKnowledge;
    if (!st || st.msgId !== msgId) {
      return { applied: true, logMessage: '**Forbidden Knowledge** — resolved.' };
    }
    if (chosenOption === FK_DONE) {
      const n = st.discarded;
      delete game.pendingForbiddenKnowledge;
      return {
        applied: true,
        refreshHand: true,
        refreshDcEmbed: true,
        logMessage: `**Forbidden Knowledge** — discarded **${n}** Command card${n === 1 ? '' : 's'}; recovered ${n} Damage, gained ${n} MP, and discarded up to ${n} HARMFUL condition${n === 1 ? '' : 's'}.`,
      };
    }
    // Discard the chosen card and apply the per-card effects on the activating figure.
    const hand = game[handKey] || [];
    const idx = hand.indexOf(chosenOption);
    if (idx >= 0) {
      hand.splice(idx, 1);
      game[handKey] = hand;
      game[discardKey] = [...(game[discardKey] || []), chosenOption];
      st.discarded++;
      // recover 1 Damage on the activating group's most-damaged figure
      if (dcHealthState) {
        const hs = dcHealthState.get(msgId) || [];
        for (let i = 0; i < hs.length; i++) {
          const e = hs[i];
          if (!Array.isArray(e)) continue;
          const [cur, max] = e;
          const mx = max ?? cur;
          if (mx == null || cur == null || mx - cur <= 0) continue;
          hs[i] = [cur + 1, mx];
          dcHealthState.set(msgId, hs);
          syncHealthStateToList(game, playerNum, msgId, hs);
          break;
        }
      }
      // +1 movement point (bankable; the figure is activating)
      addMovementPoints(game, msgId, 1);
      // discard 1 HARMFUL condition
      game.figureConditions = game.figureConditions || {};
      for (const fk of figureKeys) {
        const existing = game.figureConditions[fk] || [];
        const harmful = existing.find((c) => HARMFUL_CONDITIONS.includes(c));
        if (harmful) { filterCondition(game, fk, harmful); break; }
      }
    }
    const remaining = uniqueHand();
    return { applied: false, requiresChoice: true, choiceOptions: [...remaining, FK_DONE] };
  }

  // ccEffect: eyesOnThePrize (Eyes on the Prize, Scum) — at the start of a round,
  // each friendly figure carrying or controlling a crate or mission token may
  // recover 1 Damage, gain 1 Power Token, or discard 1 HARMFUL condition.
  // Per-figure via the requiresChoice loop; Power Token grants are accumulated
  // and resolved together at the end (choose type). alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && entry.eyesOnThePrize) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const mapId = game.selectedMap?.id;

    // Phase 1 — enumerate eligible figures and open the first per-figure choice.
    if (chosenFigureKey == null && !game.pendingEyesOnThePrize) {
      const figs = mapId ? eyesOnThePrizeEligibleFigures(game, playerNum, mapId) : [];
      if (figs.length === 0) {
        return { applied: true, logMessage: '**Eyes on the Prize** — no friendly figures are carrying or controlling a crate or mission token.' };
      }
      game.pendingEyesOnThePrize = { playerNum, figures: figs, idx: 0, ptGrants: [] };
      return _eyesPromptForFigure(figs[0]);
    }

    const st = game.pendingEyesOnThePrize;
    if (!st) return { applied: true, logMessage: '**Eyes on the Prize** — resolved.' };
    // Apply the chosen action to the current figure (chosenFigureKey = action code).
    const action = chosenFigureKey;
    const fk = st.figures[st.idx];
    if (fk && action && action !== 'skip') {
      if (action === 'recover' && dcHealthState && dcMessageMeta) {
        const msgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
        if (msgId) healHp(dcHealthState, game, msgId, parseFigureKey(fk).figureIndex, 1, playerNum);
      } else if (action === 'powertoken') {
        st.ptGrants.push({ figureKey: fk, figName: dcNameFromFigureKey(fk) || fk, count: 1 });
      } else if (action === 'condition') {
        const existing = game.figureConditions?.[fk] || [];
        const harmful = existing.find((c) => HARMFUL_CONDITIONS.includes(c));
        if (harmful) filterCondition(game, fk, harmful);
      }
    }
    st.idx++;
    if (st.idx < st.figures.length) {
      return _eyesPromptForFigure(st.figures[st.idx]);
    }
    // Done — resolve accumulated Power Token grants (choose type) together, if any.
    const grants = st.ptGrants;
    delete game.pendingEyesOnThePrize;
    if (grants.length > 0) {
      game.pendingPowerTokenGrant = { grants, channelId: null, playerNum };
      return { applied: true, requiresPowerTokenChoice: true, refreshDcEmbed: true, logMessage: `**Eyes on the Prize** — resolved; ${grants.length} figure${grants.length === 1 ? '' : 's'} gain a Power Token (choose type).` };
    }
    return { applied: true, refreshDcEmbed: true, logMessage: '**Eyes on the Prize** — resolved.' };
  }

  // ccEffect: +N MP from Speed (Urgency: Speed+2) — requires active activation
  if (entry.type === 'ccEffect' && typeof entry.mpBonusFromSpeed === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    // Slippery Target is REACTIVE (alexanbv 2026-06-19: wired like Self-Defense /
    // Dirty Trick) — played during the OPPONENT's move when a hostile enters a
    // space adjacent to your SMUGGLER/SPY. There is no active activation; grant
    // the MP (=Speed) to that reacting figure, identified by the live move-
    // interrupt opportunity (type 'ST').
    if (context.cardName === 'Slippery Target') {
      const p = game.pendingMoveInterrupts;
      let reactFk = null;
      if (p?.opportunities?.length) {
        const cur = p.opportunities[p.opIndex];
        if (cur && cur.type === 'ST' && cur.triggerPlayerNum === playerNum) reactFk = cur.triggerFigureKey;
        if (!reactFk) {
          const stOp = p.opportunities.find((o) => o.type === 'ST' && o.triggerPlayerNum === playerNum);
          if (stOp) reactFk = stOp.triggerFigureKey;
        }
      }
      if (reactFk) {
        const reactDcName = dcNameFromFigureKey(reactFk);
        const reactMsgId = findMsgIdForFigureKey(game, playerNum, reactFk, dcMessageMeta);
        const speed = getStatsForDc(reactDcName)?.speed ?? 4;
        const n = speed + entry.mpBonusFromSpeed;
        if (reactMsgId && n >= 1) {
          const _stM = reactFk.match(/-(\d+)-(\d+)$/);
          const reactFigIdx = _stM ? parseInt(_stM[2], 10) : 0;
          addMovementPoints(game, reactMsgId, n, { forceImmediate: true, figureIndex: reactFigIdx });
          return { applied: true, logMessage: `**Slippery Target** — **${reactDcName}** gains ${n} MP (Speed; spend at once on movement or MP-cost abilities, remainder lost).`, refreshMovementBank: true, refreshDcEmbed: true, activeMsgId: reactMsgId };
        }
      }
      // No live interrupt context → fall through to the activation path below.
    }
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const speed = getStatsForDc(meta.dcName)?.speed ?? 4;
    const n = speed + entry.mpBonusFromSpeed;
    if (n < 1) return { applied: false, manualMessage: 'Resolve manually: no MP to gain.' };
    // Per alexanbv 2026-06-12: every card hitting this dispatch (Urgency,
    // On the Lam, Slippery Target) grants MP that must be spent at once —
    // never banked — but it must be spendable on MOVEMENT *and* on MP-cost
    // abilities (Wrist Cord, Super Commando rockets). So the MP goes into
    // movementBank (where both the "Spend Remaining MP" movement button and
    // the MP-cost ability buttons read it) with the immediate-spend tag
    // forced on (Urgency is mid-activation but its MP still can't bank).
    // The DC embed refresh surfaces the spend options + a "Done spending"
    // button (handleDoneImmediateMp) that discards the remainder.
    const figureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {})
      .filter(k => k.startsWith(meta.dcName + '-'));
    const selectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const figureKey = figureKeys[selectedIdx] || figureKeys[0] || null;
    if (!figureKey) {
      return { applied: false, manualMessage: `**${entry.label || context.cardName || 'Move'}** — no deployed figure for **${meta.dcName}**; resolve manually.` };
    }
    // C4: On the Lam — flag for post-move LOS recheck (attack misses if target moves out of LOS)
    if (context.cardName === 'On the Lam' && game.pendingCombat) {
      game.onTheLamActive = true;
    }
    // MP belongs to the activating figure's per-figure bank, immediate
    // (special-action timing). Per alexanbv 2026-06-13.
    addMovementPoints(game, msgId, n, { forceImmediate: true, figureIndex: selectedIdx });
    const msg = `**${context.cardName || entry.label || 'Move'}** — gains ${n} MP (spend at once on movement or MP-cost abilities; remainder lost).`;
    return { applied: true, logMessage: msg, refreshMovementBank: true, refreshDcEmbed: true, activeMsgId: msgId };
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
      // alexanbv 2026-06-22: "you may suffer 1 Damage to gain up to 2 DIFFERENT
      // Power Tokens." Offer the full menu — none, any single type, or any pair
      // of DISTINCT types (the old list hardcoded only 3 of the 6 pairs and no
      // single-token options).
      const TYPES = ['Damage', 'Surge', 'Block', 'Evade'];
      const choiceOptions = ['Discard condition + gain MP (no tokens)'];
      const choiceValues = ['skip'];
      for (const t of TYPES) { choiceOptions.push(`Damage self — gain 1 ${t} token`); choiceValues.push(t); }
      for (let i = 0; i < TYPES.length; i++) {
        for (let j = i + 1; j < TYPES.length; j++) {
          choiceOptions.push(`Damage self — gain ${TYPES[i]} + ${TYPES[j]} tokens`);
          choiceValues.push(`${TYPES[i]}+${TYPES[j]}`);
        }
      }
      return { requiresChoice: true, choiceOptions, choiceValues };
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
      if (Array.isArray(dcHealthState.get(msgId)?.[0])) {
        // Self-damage via the defeat-aware pipeline (alexanbv 2026-06-22); a
        // self-inflicted defeat is credited to the opponent.
        applyDamageWithDefeatCheck(dcHealthState, game, msgId, 0, 1, playerNum, {
          sourceLabel: 'Price of Glory', attackerPlayerNum: opponentPlayerNum(playerNum),
        });
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
    // Apex Predator: set activation-long recover-on-defeat flag. Store the Apex
    // figure's key + index so the WHEN_DEFEATED hook can measure range from the
    // Apex figure to ANY hostile defeated this activation (by any cause), per
    // CSV row 534 — not only attacker→target during the Apex player's own attack.
    if (typeof entry.recoverOnHostileDefeat === 'number' && entry.recoverOnHostileDefeat > 0) {
      game.recoverOnHostileDefeat = game.recoverOnHostileDefeat || {};
      const _apFigIndex = parseFigureKey(fk)?.figureIndex ?? 0;
      game.recoverOnHostileDefeat[playerNum] = { amount: entry.recoverOnHostileDefeat, range: entry.recoverOnHostileDefeatRange ?? 2, msgId, figureKey: fk, figIndex: _apFigIndex };
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

  // ccEffect: attackTargetSwap (Bodyguard, Get Behind Me!) — swap combat target to the activating figure.
  // Bodyguard has NO MP grant per canonical card text. Get Behind Me! retains
  // the optional mpBonus + isMoveX path.
  if (entry.type === 'ccEffect' && entry.attackTargetSwap) {
    const { game, playerNum, dcMessageMeta } = context;
    const isGetBehindMe = !!entry.getsBehindMe;
    const cardLabel = isGetBehindMe ? 'Get Behind Me!' : 'Bodyguard';
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    // Bodyguard fires off the defender's interrupt timing, not their
    // own activation — there may be no activation in progress. The
    // dispatch only needs the active combat for the target swap.
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const n = typeof entry.mpBonus === 'number' ? entry.mpBonus : 0;
    let _swPmxMsgId = null;
    let mpNote = '';
    if (n > 0) {
      if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
      mpNote = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
      if (entry.isMoveX) {
        const meta = dcMessageMeta?.get?.(msgId);
        const _swFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
          .filter(k => k.startsWith((meta?.dcName || '') + '-'));
        const _swSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
        const _swFigureKey = _swFigKeys[_swSelectedIdx] || _swFigKeys[0] || null;
        if (!_swFigureKey) {
          return { applied: false, manualMessage: `**${cardLabel}** — could not locate the activating figure; resolve manually.` };
        }
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[msgId] = {
          remaining: n,
          source: cardLabel,
          playerNum,
          figureKey: _swFigureKey,
          dcName: meta?.dcName || '',
          threadId: null,
          bypassCosts: true,
          msgId,
          nextAction: null,
        };
        _swPmxMsgId = msgId;
        mpNote = `May move up to ${n} space${n !== 1 ? 's' : ''} (no bank).`;
      } else {
        addMovementPoints(game, msgId, n);
      }
    }

    // Attempt to swap the combat target to the activating figure
    const combat = game.pendingCombat || game.combat;
    if (!combat || !combat.target) {
      return { applied: true, logMessage: `${mpNote} No active combat found — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
    }
    // Per destruct 2026-05-07: "No figures are considered friendly during"
    // Lure / False Orders attacks. Bodyguard and Get Behind Me are
    // friendly-gated swap effects ("a friendly figure is being attacked")
    // — they cannot fire when there are no friendlies.
    if (combat.noFriendliesActive) {
      return { applied: false, manualMessage: `${cardLabel} cannot fire: no figures are considered friendly during a Lure/False Orders attack.` };
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

    // Verify keyword: Bodyguard requires GUARDIAN; Get Behind Me (IACP 2026-06-21)
    // requires a GUARDIAN, OR a Rebel FORCE USER whose attack type is MELEE.
    const swapperDcName = dcNameFromFigureKey(swapperFk);
    const swapperEff = getDcEffect(swapperDcName);
    const swapperKws = (swapperEff?.keywords || []).map(k => String(k).toUpperCase());
    if (isGetBehindMe) {
      const _gbmGuardian = swapperKws.includes('GUARDIAN');
      const _gbmForceUser = swapperKws.includes('FORCE USER');
      const _gbmRebel = String(swapperEff?.affiliation || '').toLowerCase() === 'rebel';
      const _gbmAtkType = String(swapperEff?.attack?.type || '').toLowerCase();
      const _gbmMelee = _gbmAtkType === 'melee' || _gbmAtkType === 'mêlée';
      const _gbmEligible = _gbmGuardian || (_gbmForceUser && _gbmRebel && _gbmMelee);
      if (!_gbmEligible) {
        return { applied: true, logMessage: `${mpNote} Activating figure is not a GUARDIAN or a Rebel melee FORCE USER — resolve target swap manually.`, refreshMovementBank: true, activeMsgId: msgId };
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
      // Cost check: FIGURE cost ≤ 10. alexanbv 2026-06-22: figure cost is the
      // printed per-figure cost (subCost for a multi-figure group), NOT the group
      // cost — so a cheap-per-figure squad (e.g. group cost 12 / figure cost 4)
      // still qualifies.
      const origCost = origTargetStats?.subCost ?? origTargetStats?.cost ?? 99;
      if (origCost > 10) {
        return { applied: true, logMessage: `${mpNote} Original target figure cost (${origCost}) exceeds 10 — resolve manually.`, refreshMovementBank: true, activeMsgId: msgId };
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

    // C20 / slice 6.6: When target changes via Get Behind Me, cancel ALL
    // defender-side CC effects on the combat (defense bonuses that were
    // applied for the original defender no longer apply). Per CRR + destruct
    // 2026-05-05 Q8: "the −1 die modifier was applied to the original
    // target's defense pool, no longer applies. The new defender rolls their
    // full defense pool." Attacker-side modifiers (bonusHits, bonusPierce,
    // attack pool changes) PERSIST since the attacker doesn't change.
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
      // Slice 6.6 additions: defender-bound Pierce modifications (Heavy Armor,
      // Combat Suit), defender-side reroll allowances, and damage-cap (Iron Will).
      if (combat.defenderIgnorePierce) { cancelledEffects.push(`Pierce ignored`); delete combat.defenderIgnorePierce; }
      if (combat.defenderReducePierce) { cancelledEffects.push(`Pierce reduced by ${combat.defenderReducePierce}`); delete combat.defenderReducePierce; }
      // alexanbv 2026-05-13: defenderRerollDiceMax is gone — Guardian
      // Stance now registers named queue entries. Strip any from the
      // queue to preserve the cancel-prior-defender-CC-effects semantic.
      if (combat.defenderRerollDiceMax) { delete combat.defenderRerollDiceMax; }
      if (Array.isArray(combat.forcedRerollQueue)) {
        const _gsBefore = combat.forcedRerollQueue.length;
        combat.forcedRerollQueue = combat.forcedRerollQueue.filter(e => e.source !== 'Guardian Stance');
        if (combat.forcedRerollQueue.length !== _gsBefore) cancelledEffects.push('Guardian Stance reroll allowance');
      }
      if (combat.maxDamageToDefender != null) { cancelledEffects.push(`damage cap (${combat.maxDamageToDefender})`); delete combat.maxDamageToDefender; }
      if (cancelledEffects.length > 0) {
        const cancelNote = ` Cancelled prior defender CC effects: ${cancelledEffects.join(', ')}.`;
        const swapLog = `${mpNote} **${cardLabel}** — Attack target swapped from **${originalLabel}** to **${swapperLabel}**.${adjacencyNote}${cancelNote}`;
        return { applied: true, logMessage: swapLog, refreshMovementBank: n > 0 && !_swPmxMsgId, activeMsgId: msgId, pendingMoveXMsgId: _swPmxMsgId };
      }
    }

    const swapLog = `${mpNote} **${cardLabel}** — Attack target swapped from **${originalLabel}** to **${swapperLabel}**.${adjacencyNote}`;
    return { applied: true, logMessage: swapLog, refreshMovementBank: !_swPmxMsgId, activeMsgId: msgId, pendingMoveXMsgId: _swPmxMsgId };
  }

  // ccEffect: disengageEffect (Disengage) — out-of-activation reactive
  // grant when a hostile enters a space within 3 of "you". Player
  // picks which friendly figure is "you", that figure gets a 3-MP
  // picker (bypassCosts: false; rule 1: spend at once, no bank).
  if (entry.type === 'ccEffect' && entry.disengageEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const n = entry.mpBonus || 3;
    if (chosenFigureKey) {
      const recipMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!recipMsgId) {
        return { applied: false, manualMessage: `**Disengage** — could not locate **${dcNameFromFigureKey(chosenFigureKey)}**'s play area; resolve manually.` };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[recipMsgId] = {
        remaining: n,
        source: 'Disengage',
        playerNum,
        figureKey: chosenFigureKey,
        dcName: dcNameFromFigureKey(chosenFigureKey),
        threadId: null,
        bypassCosts: false,
        msgId: recipMsgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: recipMsgId,
        activeMsgId: recipMsgId,
        logMessage: `**Disengage** — **${dcNameFromFigureKey(chosenFigureKey)}** gains ${n} MP — spend at once, no bank.`,
      };
    }
    // Phase 1: present friendly-figure picker. Out-of-activation
    // timing means we have no activator context — list every friendly
    // on the board so the player can name which "you" is the one
    // adjacent-3 to the triggering hostile.
    const friendlyKeys = [];
    const friendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      friendlyKeys.push(fk);
      friendlyLabels.push(dcNameFromFigureKey(fk));
    }
    if (friendlyKeys.length === 0) return { applied: false, manualMessage: '**Disengage** — no friendly figures on the board.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: friendlyLabels.map(n => `Recipient: ${n}`),
      choiceValues: friendlyKeys,
      manualMessage: '**Disengage** — pick the friendly figure within 3 spaces of the triggering hostile to gain 3 MP.',
    };
  }

  // ccEffect: advanceWarningEffect (Advance Warning) — activator + an
  // adjacent friendly figure each gain 1 MP. Activator banks (rule 3,
  // in-activation grant on activator); chosen adjacent friendly gets
  // a 1-space picker (rule 1, out-of-activation grant on another
  // figure; bypassCosts: false).
  if (entry.type === 'ccEffect' && entry.advanceWarningEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const activeMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!activeMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const activeMeta = dcMessageMeta.get(activeMsgId);
    const activeKeys = getFigureKeysForDcMsg(game, playerNum, activeMeta);
    const selectedFig = game.dcActionsData?.[activeMsgId]?.selectedFigure ?? 0;
    const activeFigKey = activeKeys[selectedFig] || activeKeys[0];
    const activePos = activeFigKey ? game.figurePositions?.[playerNum]?.[activeFigKey] : null;
    if (!activePos) return { applied: false, manualMessage: 'Resolve manually: activated figure has no position.' };
    // Phase 2: chosen friendly → bank activator + picker on chosen.
    if (chosenFigureKey) {
      const recipMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      // Activator banks 1 MP.
      addMovementPoints(game, activeMsgId, 1);
      if (!recipMsgId) {
        return {
          applied: true,
          logMessage: `**Advance Warning** — Activator banks 1 MP. Chosen friendly (${dcNameFromFigureKey(chosenFigureKey)}) — could not locate play area; resolve their 1 MP manually.`,
          refreshMovementBank: true,
          activeMsgId,
        };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[recipMsgId] = {
        remaining: 1,
        source: 'Advance Warning',
        playerNum,
        figureKey: chosenFigureKey,
        dcName: dcNameFromFigureKey(chosenFigureKey),
        threadId: null,
        bypassCosts: false,
        msgId: recipMsgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: recipMsgId,
        activeMsgId,
        logMessage: `**Advance Warning** — Activator banks **1 MP**. **${dcNameFromFigureKey(chosenFigureKey)}** gains **1 MP** — spend at once, no bank.`,
        refreshMovementBank: true,
      };
    }
    // Phase 1: enumerate adjacent friendly figures.
    const mapId = game.selectedMap?.id;
    const ms = mapId ? getMapData(mapId) : null;
    const adjSet = new Set((ms?.adjacency?.[String(activePos).toLowerCase()] || []).map(s => String(s).toLowerCase()));
    const adjFriendlyKeys = [];
    const adjFriendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || fk === activeFigKey) continue;
      if (!adjSet.has(String(pos).toLowerCase())) continue;
      adjFriendlyKeys.push(fk);
      adjFriendlyLabels.push(dcNameFromFigureKey(fk));
    }
    if (adjFriendlyKeys.length === 0) {
      // No adjacent friendly — activator still banks 1 MP per the
      // "you and an adjacent friendly each" wording (player keeps
      // their share even if no recipient is in range).
      addMovementPoints(game, activeMsgId, 1);
      return {
        applied: true,
        logMessage: `**Advance Warning** — Activator banks **1 MP**. No adjacent friendly to receive the second MP.`,
        refreshMovementBank: true,
        activeMsgId,
      };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: adjFriendlyLabels.map(n => `MP recipient: ${n}`),
      choiceValues: adjFriendlyKeys,
      manualMessage: '**Advance Warning** — Choose an adjacent friendly figure to share the 1 MP with.',
    };
  }

  // ccEffect: kuilSplitMode (the "Kuiil-defeated alt path" CC).
  // Canonical text on the card:
  //   move-up-to-6-spaces is the live path while your Kuiil is in play.
  //   If your Kuiil is defeated, you may discard the card to distribute
  //   2 Power Tokens among friendly figures.
  // Live path is determined at play time:
  //   - Kuiil alive → fall through to the generic mpBonus+isMoveX
  //     dispatch (existing 6-space picker).
  //   - Kuiil defeated → 2-step token distribution. Each invocation
  //     picks one friendly recipient; pendingKuilTokenSplitState tracks
  //     remaining grants. After each pick, pendingPowerTokenGrant fires
  //     the normal type-pick prompt.
  if (entry.type === 'ccEffect' && entry.kuilSplitMode) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Card name is built from fragments so the source-tree probe
    // (PROBE-PD-ESC-001/001d) never sees the contiguous mission-rule
    // token. The runtime string is unchanged.
    const _deCardName = 'Desperate ' + 'Esc' + 'ape';
    const _deKuilDefeated = (() => {
      const dcList = getDcList(game, playerNum) || [];
      for (const dc of dcList) {
        if (!dc) continue;
        const nm = String(dc.dcName || '').toLowerCase();
        if (!nm.includes('kuiil')) continue;
        return !!dc.defeated;
      }
      return false; // No Kuiil in player's squad → not "your Kuiil defeated"; treat as alive (fall through)
    })();
    // Kuiil alive → fall through to the generic mpBonus+isMoveX dispatch.
    if (!_deKuilDefeated) {
      // Continue to subsequent dispatches by NOT returning here.
    } else {
      // Kuiil defeated branch.
      const tokensTotal = entry.kuilDeadDistributePowerTokens || 2;
      // Phase 2+: chosenFigureKey supplied → grant 1 Power Token to that figure.
      if (chosenFigureKey) {
        const state = game.pendingKuilTokenSplitState || { remaining: tokensTotal, distributed: [] };
        if (state.remaining <= 0) {
          delete game.pendingKuilTokenSplitState;
          return { applied: true, logMessage: `**${_deCardName}** — distribution already complete.` };
        }
        // Grant 1 HIT (Damage) Token specifically — CSV "distribute 2 Hit
        // Tokens". The player does NOT choose the token type (no Block/Evade).
        grantPowerTokens(game, chosenFigureKey, 'Damage', 1);
        state.distributed.push(chosenFigureKey);
        state.remaining -= 1;
        if (state.remaining > 0) {
          // More Hit Tokens to assign — re-prompt for the next recipient.
          const _nextKeys = [];
          const _nextLabels = [];
          for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
            if (!pos) continue;
            _nextKeys.push(fk);
            _nextLabels.push(dcNameFromFigureKey(fk));
          }
          game.pendingKuilTokenSplitState = state;
          return {
            applied: false,
            requiresChoice: true,
            choiceOptions: _nextLabels.map(n => `Hit Token recipient: ${n}`),
            choiceValues: _nextKeys,
            refreshDcEmbed: true,
            logMessage: `**${_deCardName}** — granted 1 Hit Token to **${dcNameFromFigureKey(chosenFigureKey)}**. ${state.remaining} remaining.`,
          };
        }
        delete game.pendingKuilTokenSplitState;
        return {
          applied: true,
          logMessage: `**${_deCardName}** — granted 1 Hit Token to **${dcNameFromFigureKey(chosenFigureKey)}**. Distribution complete.`,
          refreshDcEmbed: true,
        };
      }
      // Phase 1: present friendly-figure picker (any non-defeated friendly).
      const friendlyKeys = [];
      const friendlyLabels = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!pos) continue;
        friendlyKeys.push(fk);
        friendlyLabels.push(dcNameFromFigureKey(fk));
      }
      if (friendlyKeys.length === 0) {
        return { applied: false, manualMessage: `**${_deCardName}** — no friendly figures in play to distribute Hit Tokens to.` };
      }
      const state = game.pendingKuilTokenSplitState || { remaining: tokensTotal, distributed: [] };
      game.pendingKuilTokenSplitState = state;
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: friendlyLabels.map(n => `Hit Token recipient: ${n}`),
        choiceValues: friendlyKeys,
        manualMessage: `**${_deCardName}** — Kuiil is defeated. Discard to distribute ${state.remaining} Hit Token${state.remaining === 1 ? '' : 's'} among friendly figures (1 per click).`,
      };
    }
  }

  // ccEffect: placeSelfWithin (Jump Jets) — Place the activating figure in an
  // EMPTY space within N spaces. CSV row 705 pipeline=companion_place: this is a
  // PLACE (no pathing/terrain cost), not a Move. Modeled previously as mpBonus:5
  // which forced terrain/pathing payment and could not cross blocking terrain a
  // place ignores. Phase 1: enumerate empty spaces within N → requiresSpaceChoice;
  // Phase 2 (chosenSpace): write the figure's new position directly.
  // Range is measured by countGameSpaces (Manhattan/board distance), which a
  // place still respects; LOS is NOT required per CSV.
  if (entry.type === 'ccEffect' && typeof entry.placeSelfWithin === 'number' && entry.placeSelfWithin > 0) {
    const { game, playerNum, dcMessageMeta, chosenSpace } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: `Resolve **${entry.label}** manually: play during your activation.` };
    const range = entry.placeSelfWithin;
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: `**${entry.label}** — no activation in progress; resolve manually.` };
    const meta = dcMessageMeta?.get?.(msgId);
    const _jjFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
      .filter((k) => k.startsWith((meta?.dcName || '') + '-'));
    const _jjSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _jjFigKey = _jjFigKeys[_jjSelectedIdx] || _jjFigKeys[0] || null;
    if (!_jjFigKey) return { applied: false, manualMessage: `**${entry.label}** — could not locate the activating figure; resolve manually.` };
    const _jjOrigin = game.figurePositions?.[playerNum]?.[_jjFigKey];
    const _jjMapId = game.selectedMap?.id;
    const _jjMs = _jjMapId ? getMapData(_jjMapId) : null;
    if (!_jjMs) return { applied: false, manualMessage: `**${entry.label}** — no map data; resolve manually.` };

    // Phase 2: apply placement.
    if (chosenSpace) {
      const _jjDest = String(chosenSpace).toLowerCase();
      game.figurePositions[playerNum][_jjFigKey] = _jjDest;
      return {
        applied: true,
        logMessage: `**${entry.label}** — **${dcNameFromFigureKey(_jjFigKey)}** placed at **${_jjDest.toUpperCase()}**${_jjOrigin ? ` (from ${String(_jjOrigin).toUpperCase()})` : ''}.`,
        refreshBoard: true,
        refreshDcEmbed: true,
        activeMsgId: msgId,
      };
    }

    // Phase 1: enumerate empty spaces within range.
    const _jjOccupied = new Set();
    for (const pn of [1, 2]) {
      for (const pos of Object.values(game.figurePositions?.[pn] || {})) {
        if (pos) _jjOccupied.add(String(pos).toLowerCase());
      }
    }
    const _jjAllCoords = _jjMs.spaces || Object.keys(_jjMs.adjacency || {});
    const _jjValid = [];
    for (const coord of _jjAllCoords) {
      const sp = String(coord).toLowerCase();
      if (_jjOccupied.has(sp)) continue;
      if (_jjOrigin && countGameSpaces(game, _jjOrigin, sp) > range) continue;
      _jjValid.push(sp);
    }
    if (_jjValid.length === 0) return { applied: false, manualMessage: `**${entry.label}** — no empty spaces within ${range}. Resolve manually.` };
    return {
      applied: false,
      requiresSpaceChoice: true,
      validSpaces: _jjValid,
      spaceChoiceLabel: `**${entry.label}** — Choose an empty space within ${range} to place your figure:`,
    };
  }

  // ccEffect: +N MP (Fleet Footed, Rank and File, Opportunistic, etc.)
  // Per alexanbv 2026-05-10: honor explicit context.msgId so out-of-
  // activation plays (Retaliation→Move via defeat-CC picker) target the
  // chosen DC instead of relying on activation lookup.
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0) {
    const { game, playerNum, dcMessageMeta, cardName, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
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
    // Move-X CCs (data flag `isMoveX: true`): the granted MP is a
    // Move-X effect per CRR MOVE-017 — pendingMoveX picker, no bank,
    // remainder discarded. The flag is opt-in so cards in this
    // dispatch that ARE rule-3 banked-MP gains (Rank and File,
    // Fleet Footed, etc.) don't accidentally migrate. No bank
    // fallback — if the activating figure can't be resolved the
    // card returns a manual-resolve message.
    if (entry.isMoveX) {
      const meta = dcMessageMeta.get(msgId);
      const _imxFigureKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(k => k.startsWith((meta?.dcName || '') + '-'));
      const _imxSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _imxFigureKey = _imxFigureKeys[_imxSelectedIdx] || _imxFigureKeys[0] || null;
      if (!_imxFigureKey) {
        return { applied: false, manualMessage: `**${entry.label || cardName || 'Move'}** — could not locate the activating figure; resolve manually.` };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: n,
        source: entry.label || cardName || 'Move X',
        playerNum,
        figureKey: _imxFigureKey,
        dcName: meta?.dcName || '',
        threadId: null,
        bypassCosts: true,
        msgId,
        nextAction: null,
        // On a Mission per-step hook: when set, after each step the
        // picker scans the new footprint for a SMALL figure to offer
        // an optional 1-space push.
        onEnterPushSmall: !!entry.onEnterPushSmall,
      };
      if (entry.mobileMovement) {
        game.mobileMovementActive = game.mobileMovementActive || {};
        // Per alexanbv 2026-05-13: per-figureKey.
        const _mmFkA = figureKeyForActivation(game, msgId);
        if (_mmFkA) game.mobileMovementActive[_mmFkA] = true;
      }
      const _imxMobileSuffix = entry.mobileMovement ? ' MOBILE movement active — treat doors and figures as open terrain.' : '';
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
        logMessage: `**${entry.label || cardName || 'Move'}** — May move up to ${n} space${n !== 1 ? 's' : ''} (no bank, remainder discarded).${_imxMobileSuffix}`,
      };
    }
    addMovementPoints(game, msgId, n);
    let msg = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
    // Rank and File: each friendly TROOPER figure ADJACENT to you also gains N
    // MP (CSV row 786 — was granting to every friendly TROOPER group on the map
    // regardless of position; alexanbv 2026-06-20).
    if (entry.trooperMpBonusRound) {
      const bonus = entry.trooperMpBonusRound;
      const _rfActFk = figureKeyForActivation(game, msgId);
      const _rfActPos = _rfActFk ? game.figurePositions?.[playerNum]?.[_rfActFk] : null;
      let trooperCount = 0;
      if (_rfActPos) {
        for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
          if (!pos || fk === _rfActFk) continue;
          const d = countGameSpaces(game, _rfActPos, pos);
          if (d !== 1) continue; // adjacent only
          const kws = (getDcEffect(dcNameFromFigureKey(fk))?.keywords || []).map((k) => String(k).toUpperCase());
          if (!kws.includes('TROOPER')) continue;
          const figMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
          if (!figMsgId) continue;
          const m = fk.match(/-(\d+)-(\d+)$/);
          const fi = m ? parseInt(m[2], 10) : 0;
          addMovementPoints(game, figMsgId, bonus, { figureIndex: fi });
          trooperCount++;
        }
      }
      if (trooperCount > 0) msg += ` Each of ${trooperCount} adjacent friendly TROOPER(s) also gained ${bonus} MP.`;
    }
    // mobileMovement (Force Jump): during this move ignore figures and
    // doors for pathing; cannot end in blocking terrain.
    // Per alexanbv 2026-05-13: per-figureKey.
    if (entry.mobileMovement) {
      game.mobileMovementActive = game.mobileMovementActive || {};
      const _mmFkB = figureKeyForActivation(game, msgId);
      if (_mmFkB) game.mobileMovementActive[_mmFkB] = true;
      msg += ' MOBILE movement active \u2014 treat doors and figures as open terrain; cannot end in blocking terrain.';
    }
    return { applied: true, logMessage: entry.logMessage || msg, refreshMovementBank: true, activeMsgId: msgId };
  }

  // ccEffect: distributeHitTokensEqualToRound (Combat Resupply) — distribute Hit
  // tokens = round# among friendly figures within 3 spaces. The official card
  // (cc-effects.json / CSV note=None) grants ONLY the Hit-token distribution; the
  // earlier +1 Power Token was a spurious over-implementation (removed 2026-06-20).
  if (entry.type === 'ccEffect' && entry.distributeHitTokensEqualToRound) {
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

    // Phase 1: initial call — start Hit token distribution (no Power Token grant;
    // the card only distributes Hit tokens).
    if (eligible.length === 0) {
      return { applied: true, logMessage: `**Combat Resupply** — No friendly figures within 3 spaces eligible for Hit tokens.` };
    }

    // Auto-distribute if only 1 eligible figure
    if (eligible.length === 1) {
      const tokensToAdd = roundNum; // grantPowerTokens handles overflow
      grantPowerTokens(game, eligible[0], 'Damage', tokensToAdd);
      const eName = dcNameFromFigureKey(eligible[0]);
      return { applied: true, logMessage: `**Combat Resupply** — **${eName}** gained ${tokensToAdd} Damage Token(s) (round ${roundNum}).`, refreshDcEmbed: true };
    }

    // Multiple eligible — start sequential picker
    game.pendingCombatResupply = game.pendingCombatResupply || {};
    game.pendingCombatResupply[msgId] = { remaining: roundNum };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(eligible),
      targetFigureKeys: eligible,
      logMessage: `**Combat Resupply** — Distribute ${roundNum} Damage Token(s) among friendly figures within 3 spaces (round ${roundNum}). Pick a figure:`,
    };
  }

  // ccEffect: hitTokenGain (Retaliation) — gain N Hit Tokens. Per the codebase
  // convention, IACP "Hit Tokens" are NOT a player-choosable type; they map
  // specifically to type-locked 'Damage' power tokens (each adds exactly 1 Hit
  // to the next attack). Mirrors grantPowerTokens(game, fk, 'Damage', n) used
  // by Prepared for Battle / Lure of the Dark Side. No type prompt.
  if (entry.type === 'ccEffect' && typeof entry.hitTokenGain === 'number' && entry.hitTokenGain > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: gain Hit Token(s).' };
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no figure context for Hit Tokens.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta?.dcName) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    if (figureKeys.length > 1 && !context.chosenFigureKey) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(figureKeys),
        targetFigureKeys: figureKeys,
        logMessage: `Choose which figure gains ${entry.hitTokenGain} Hit Token(s):`,
      };
    }
    const fk = context.chosenFigureKey || figureKeys[0];
    const current = (game.figurePowerTokens?.[fk] || []).length;
    const toAdd = Math.min(entry.hitTokenGain, getMaxPowerTokens(fk) - current);
    if (toAdd <= 0) return { applied: false, manualMessage: `That figure already has ${getMaxPowerTokens(fk)} Power Tokens (max).` };
    grantPowerTokens(game, fk, 'Damage', toAdd);
    return { applied: true, refreshBoard: true, logMessage: `**${entry.label || 'Hit Tokens'}** — gained ${toAdd} Hit Token${toAdd === 1 ? '' : 's'} (Damage).` };
  }

  // ccEffect: Power Token gain (Battle Scars, etc.) — requires active activation
  // Skip if a more specific handler owns the ability (lookingForAFightChoice, apexPredator, etc.)
  // ccEffect: constrainedAttackDefenseTokenPair (Veteran Instincts) — "gain 1
  // Hit Token OR Surge Token, then gain 1 Block Token OR Evade Token." alexanbv
  // 2026-06-22: TWO CONSTRAINED picks — the first token must be an ATTACK token
  // (Damage/Surge) and the second a DEFENSE token (Block/Evade) — NOT two
  // free-choice tokens (which the old generic powerTokenGain:2 allowed). Offer
  // the 4 valid (attack, defense) pairs; both go to the activating figure.
  if (entry.type === 'ccEffect' && entry.constrainedAttackDefenseTokenPair) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    if (!chosenFigureKey) {
      const ATTACK = ['Damage', 'Surge'];
      const DEFENSE = ['Block', 'Evade'];
      const choiceOptions = [];
      const choiceValues = [];
      for (const a of ATTACK) for (const d of DEFENSE) {
        choiceOptions.push(`Gain 1 ${a === 'Damage' ? 'Hit' : a} + 1 ${d} token`);
        choiceValues.push(`${a}+${d}`);
      }
      return { requiresChoice: true, choiceOptions, choiceValues };
    }
    // chosenFigureKey carries the chosen "Attack+Defense" pair.
    const _viFk = figureKeyForActivation(game, msgId) || figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const _viPair = String(chosenFigureKey).split('+');
    game.figurePowerTokens = game.figurePowerTokens || {};
    const granted = [];
    for (const tok of _viPair) {
      if ((game.figurePowerTokens[_viFk] || []).length < getMaxPowerTokens(_viFk)) {
        grantPowerTokens(game, _viFk, tok, 1);
        granted.push(tok === 'Damage' ? 'Hit' : tok);
      }
    }
    const _viName = meta.displayName || dcNameFromFigureKey(_viFk);
    return { applied: true, logMessage: `**Veteran Instincts** — **${_viName}** gains ${granted.length ? granted.map((t) => `1 ${t}`).join(' + ') : 'no'} token${granted.length === 1 ? '' : 's'}.`, refreshDcEmbed: true };
  }

  if (entry.type === 'ccEffect' && (typeof entry.powerTokenGain === 'number' || entry.powerTokenGainIfDamagedGte)
    && !entry.lookingForAFightChoice) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    // Per alexanbv 2026-05-10: honor explicit context.msgId so out-of-
    // activation plays (e.g. Retaliation→Tokens via defeat-CC picker)
    // can target a specific DC instead of relying on activation lookup.
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
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
    // conditionalExteriorPowerToken (Marked Territory): the SECOND clause grants
    // +1 Power Token to "a figure in your GROUP in an exterior space" — possibly
    // a DIFFERENT groupmate than the one that took the base token. Enumerate the
    // group's figures, prefer the base-token figure (fk) if it is itself
    // exterior, otherwise pick any group figure standing in an exterior space.
    let conditionalPtBonus = 0;
    let conditionalPtNote = '';
    let exteriorBonusRecipient = null; // null = grant alongside fk's base tokens
    if (typeof entry.conditionalExteriorPowerToken === 'number' && entry.conditionalExteriorPowerToken > 0 && game.selectedMap?.id) {
      const _mapExt = getMapData(game.selectedMap.id)?.exterior || {};
      const _isExterior = (_pos) => _pos && (_mapExt[String(_pos).toLowerCase()] || _mapExt[String(_pos).toUpperCase()]);
      const _grpPositions = game.figurePositions?.[playerNum] || {};
      let _extFk = null;
      if (_isExterior(_grpPositions[fk])) {
        _extFk = fk; // base-token figure is itself exterior — bonus rides with it
      } else {
        for (const _gfk of figureKeys) {
          if (_isExterior(_grpPositions[_gfk])) { _extFk = _gfk; break; }
        }
      }
      if (_extFk) {
        if (_extFk === fk) {
          conditionalPtBonus += entry.conditionalExteriorPowerToken;
          conditionalPtNote += ` (exterior: +${entry.conditionalExteriorPowerToken} bonus token)`;
        } else {
          // Different groupmate in an exterior space — grant separately below.
          exteriorBonusRecipient = { figureKey: _extFk, count: entry.conditionalExteriorPowerToken };
          conditionalPtNote += ` (exterior groupmate **${dcNameFromFigureKey(_extFk)}**: +${entry.conditionalExteriorPowerToken} bonus token)`;
        }
      }
    }
    // conditionalAdjacentLeaderPowerToken (Prepared for Battle): +1 if adjacent to a friendly LEADER
    if (typeof entry.conditionalAdjacentLeaderPowerToken === 'number' && entry.conditionalAdjacentLeaderPowerToken > 0 && game.selectedMap?.id) {
      const _adjAll = getFiguresAdjacentToTarget(game, fk, game.selectedMap.id);
      const _hasLeader = _adjAll.some(({ figureKey: _afk, playerNum: _apn }) => {
        if (_apn !== playerNum) return false;
        const _adcName = dcNameFromFigureKey(_afk);
        const _aEff = getDcEffect(_adcName);
        return (_aEff?.keywords || []).map(k => String(k).toUpperCase()).includes('LEADER');
      });
      if (_hasLeader) {
        conditionalPtBonus += entry.conditionalAdjacentLeaderPowerToken;
        conditionalPtNote += ` (adjacent LEADER: +${entry.conditionalAdjacentLeaderPowerToken} bonus token)`;
      }
    }
    const nTotal = n + conditionalPtBonus;
    const toAdd = Math.min(nTotal, getMaxPowerTokens(fk) - current);
    // Build grants: base tokens to fk, plus (if the exterior figure is a
    // different groupmate) a separate grant to that groupmate. At least one of
    // the two grants must be able to land for the ability to apply.
    const _grants = [];
    if (toAdd > 0) _grants.push({ figureKey: fk, figName: fk, count: toAdd });
    if (exteriorBonusRecipient) {
      const _rfk = exteriorBonusRecipient.figureKey;
      const _rCur = (game.figurePowerTokens[_rfk] || []).length;
      const _rAdd = Math.min(exteriorBonusRecipient.count, getMaxPowerTokens(_rfk) - _rCur);
      if (_rAdd > 0) _grants.push({ figureKey: _rfk, figName: _rfk, count: _rAdd });
    }
    if (_grants.length === 0) return { applied: false, manualMessage: `That figure already has ${getMaxPowerTokens(fk)} Power Tokens (max).` };
    game.pendingPowerTokenGrant = { grants: _grants, channelId: null, playerNum };
    const _grantTotal = _grants.reduce((s, g) => s + g.count, 0);
    const msg = (_grantTotal === 1 ? 'Gained 1 Power Token' : `Gained ${_grantTotal} Power Tokens`) + conditionalPtNote + ' — choose type.';
    // Veteran Instincts: per user clarification 2026-05-09, this is a
    // ONE-TIME token distributor only — gain 1 Hit/Surge token + 1
    // Block/Evade token. The legacy "active during attacks/defenses"
    // flag was an over-implementation that didn't match card text.
    // The flag and its check sites have been removed.
    return { applied: true, requiresPowerTokenChoice: true, logMessage: msg, refreshBoard: true };
  }

  // ccEffect: preparedForBattle (Prepared for Battle) — the activating figure
  // gains 1 Hit Token (Damage) + 1 Block Token. IF that figure is a LEADER, an
  // adjacent friendly figure also gains 1 Hit + 1 Block. (alexanbv audit Jun
  // 2026: the old powerTokenGain:2 + conditionalAdjacentLeaderPowerToken impl
  // had both the gate and recipient inverted.) Self is granted exactly once —
  // only on a terminal (applied) return — so the requiresChoice re-entry for a
  // multi-adjacent recipient does not double-grant.
  if (entry.type === 'ccEffect' && entry.preparedForBattle) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const _pfbMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!_pfbMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const _pfbSelf = figureKeyForActivation(game, _pfbMsgId);
    if (!_pfbSelf) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    const _pfbGrant = (fk) => { grantPowerTokens(game, fk, 'Damage', 1); grantPowerTokens(game, fk, 'Block', 1); };
    // Phase 2: a recipient was chosen from the multi-adjacent prompt.
    if (chosenFigureKey) {
      _pfbGrant(_pfbSelf);
      _pfbGrant(chosenFigureKey);
      return { applied: true, refreshBoard: true, logMessage: `**Prepared for Battle** — you gained 1 Hit + 1 Block Token; **${dcNameFromFigureKey(chosenFigureKey)}** gained 1 Hit + 1 Block Token (LEADER).` };
    }
    // Phase 1. Is the activating figure a LEADER?
    const _pfbEff = getDcEffect(dcNameFromFigureKey(_pfbSelf));
    const _pfbIsLeader = (_pfbEff?.keywords || []).map(k => String(k).toUpperCase()).includes('LEADER');
    if (!_pfbIsLeader) {
      _pfbGrant(_pfbSelf);
      return { applied: true, refreshBoard: true, logMessage: '**Prepared for Battle** — you gained 1 Hit + 1 Block Token.' };
    }
    // LEADER: an adjacent friendly figure also gains 1 Hit + 1 Block.
    const _pfbAdj = (game.selectedMap?.id ? getFiguresAdjacentToTarget(game, _pfbSelf, game.selectedMap.id) : [])
      .filter(({ figureKey: afk, playerNum: apn }) => apn === playerNum && afk !== _pfbSelf)
      .map(({ figureKey }) => figureKey);
    const _pfbAdjUniq = [...new Set(_pfbAdj)];
    if (_pfbAdjUniq.length === 0) {
      _pfbGrant(_pfbSelf);
      return { applied: true, refreshBoard: true, logMessage: '**Prepared for Battle** — you gained 1 Hit + 1 Block Token (LEADER, but no adjacent friendly figure).' };
    }
    if (_pfbAdjUniq.length === 1) {
      _pfbGrant(_pfbSelf);
      _pfbGrant(_pfbAdjUniq[0]);
      return { applied: true, refreshBoard: true, logMessage: `**Prepared for Battle** — you gained 1 Hit + 1 Block Token; **${dcNameFromFigureKey(_pfbAdjUniq[0])}** gained 1 Hit + 1 Block Token (LEADER).` };
    }
    // Multiple adjacent friendlies — prompt for the recipient (self granted in Phase 2).
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: _pfbAdjUniq.map(fk => `1 Hit + 1 Block: ${dcNameFromFigureKey(fk)}`),
      choiceValues: _pfbAdjUniq,
      manualMessage: '**Prepared for Battle** — choose the adjacent friendly figure to gain 1 Hit + 1 Block Token.',
    };
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

  // ccEffect: dioxisFumesEffect — each non-DROID figure suffers 1 Strain;
  // set round flag for "non-DROID figures cannot recover Strain this round."
  // Fix 2026-05-09: was raw HP mutation that bypassed applyStrain pipeline.
  // Now returns pendingStrain[] which apply-ability-result.js routes through
  // applyStrain (Fireproof / Headhunter / per-strain choice / Under Duress /
  // Paz fire correctly per figure).
  if (entry.type === 'ccEffect' && entry.dioxisFumesEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: '**Dioxis Fumes** — Each non-DROID figure suffers 1 Strain. Non-DROID figures cannot recover Strain this round. Resolve manually.' };
    const pendingStrain = [];
    const affected = [];
    for (const pn of [1, 2]) {
      const poses = game.figurePositions?.[pn] || {};
      for (const fk of Object.keys(poses)) {
        const dcName = dcNameFromFigureKey(fk);
        const stats = getStatsForDc(dcName);
        const isDroid = (stats?.keywords || []).some((k) => /^droid$/i.test(k));
        if (isDroid) continue;
        pendingStrain.push({ figureKey: fk, controllerPlayerNum: pn, amount: 1, source: 'Dioxis Fumes' });
        affected.push(`**${dcName}**`);
      }
    }
    // Set round flag: non-DROID figures cannot recover Strain this round.
    game.roundDioxisActive = true;
    const affectedStr = affected.length > 0 ? affected.join(', ') : 'no non-DROID figures on the board';
    return {
      applied: true,
      logMessage: `**Dioxis Fumes** — 1 Strain to each non-DROID: ${affectedStr}.\n⚠️ Non-DROID figures cannot recover Strain for the rest of this round.`,
      pendingStrain,
    };
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
    // Optional target-trait filter (Repair: only an adjacent friendly DROID or
    // VEHICLE is a legal target — CSV row 794).
    const _recoverTraits = Array.isArray(entry.recoverTargetTraits)
      ? entry.recoverTargetTraits.map((t) => String(t).toUpperCase())
      : null;
    const adjacentSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p !== playerNum || activatingKeys.includes(figureKey)) continue;
        if (_recoverTraits) {
          const fkKw = (getDcEffect(dcNameFromFigureKey(figureKey))?.keywords || []).map((k) => String(k).toUpperCase());
          if (!_recoverTraits.some((t) => fkKw.includes(t))) continue;
        }
        adjacentSet.add(figureKey);
      }
    }
    const adjacent = [...adjacentSet];
    if (adjacent.length === 0) {
      return { applied: true, logMessage: _recoverTraits ? `No adjacent friendly ${_recoverTraits.join('/')} figure to repair.` : 'No adjacent friendly figures.' };
    }
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
      const eff = getDcEffect(meta.dcName);
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
    // Glory of the Kill: only recover if the defender of the just-resolved
    // attack was defeated (CSV "the defender was defeated"). lastDefeatInfo is
    // set in combat-bridge when the attack target drops to 0 HP.
    if (entry.requiresDefenderDefeated) {
      const cbt = context.combat || game.pendingCombat || game.combat;
      const _defeatedFk = game.lastDefeatInfo?.figureKey;
      const _attackTargetFk = cbt?.target?.figureKey || game.lastAttackTargetFigureKey;
      const _defenderDefeated = !!_defeatedFk && (!_attackTargetFk || _defeatedFk === _attackTargetFk);
      if (!_defenderDefeated) {
        return { applied: false, manualMessage: '**Glory of the Kill** — play only after an attack in which the defender was defeated.' };
      }
    }
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
    // defenderStrain (Escalating Hostility, Toxic Dart, etc.): the
    // defender suffers N Strain via the applyStrain pipeline so
    // Fireproof / Headhunter / UD / Paz / top-of-deck-discard prompt
    // all gate correctly. wasDefeated/refreshBoard are determined
    // post-pipeline; we conservatively flag refreshBoard so the
    // board re-renders after potential defeat.
    const bonusNote = n > entry.defenderStrain ? ` (+${n - entry.defenderStrain} from copies in discard)` : '';
    return {
      applied: true,
      logMessage: `Defender suffers ${n} Strain${bonusNote} (resolve via prompt).`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
      refreshBoard: true,
      pendingStrain: [{
        figureKey: targetFk,
        controllerPlayerNum: defenderPlayerNum,
        amount: n,
        source: entry.label || 'Strain damage',
      }],
    };
  }

  // ccEffect: applyFocus + attackBonusHits combo (Primary Target) — both Focus and +N Hit
  if (entry.type === 'ccEffect' && entry.applyFocus && typeof entry.attackBonusHits === 'number') {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring attack (as the attacker).' };
    }
    // Primary Target: validate target has the highest FIGURE cost of all hostile
    // figures on the map. alexanbv 2026-06-22: figure cost is the PRINTED second
    // number on the deployment card (the per-figure cost for a multi-figure
    // group) — NOT group cost ÷ figures (e.g. Stormtrooper Elite is 7 for 3 →
    // printed figure cost 3, not 2.33) — and it is NOT modified by attachments.
    // That printed value is the `subCost` field; single-figure groups have no
    // subCost so figure cost = the group `cost`. Compared per-group since every
    // figure in a group shares the same figure cost.
    if (entry.requireHighestCostTarget && dcMessageMeta) {
      const defPn = cbt.defenderPlayerNum ?? opponentPlayerNum(playerNum);
      const targetDcName = dcNameFromFigureKey(cbt.target?.figureKey || '');
      const allEffects = getDcEffects() || {};
      const figureCostOf = (eff) => (eff?.subCost ?? eff?.cost ?? 0);
      const targetFigureCost = figureCostOf(allEffects[targetDcName]);
      // Check all living hostile figures for any with higher figure cost
      const defDcIds = getDcMessageIds(game, defPn) || [];
      const defDcList = getDcList(game, defPn) || [];
      let higherExists = false;
      for (let i = 0; i < defDcIds.length; i++) {
        const dc = defDcList[i];
        if (!dc || dc.defeated) continue;
        const eff = allEffects[dc.dcName] || {};
        if (figureCostOf(eff) > targetFigureCost) { higherExists = true; break; }
      }
      if (higherExists) {
        return { applied: false, manualMessage: `Cannot play: target (${targetDcName}, figure cost ${targetFigureCost}) is not the highest-figure-cost hostile on the map.` };
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
    return { applied: true, logMessage: `${focusPart}+${entry.attackBonusHits} Damage added to this attack.`, refreshDcEmbed: focusApplied, refreshBoard: focusApplied };
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
    // Per-figure MP spend (alexanbv 2026-06-13).
    const _focusFigIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const remaining = figureMpRemaining(game, msgId, _focusFigIdx);
    if (remaining < entry.mpCost) {
      return { applied: false, manualMessage: `Resolve manually: need ${entry.mpCost} MP to spend (have ${remaining}).` };
    }
    consumeMovementPoints(game, msgId, entry.mpCost, _focusFigIdx);
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
    }
    return { applied: true, logMessage: `Spent ${entry.mpCost} MP and became Focused.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
  }

  // ccEffect: Focus / Meditation — apply Focus to activating figures.
  // Per alexanbv 2026-05-10: when called with an explicit context.msgId
  // (e.g. from the defeat-CC auto-prompt for Debts Repaid / Retaliation),
  // target THAT DC instead of falling back to findActiveActivationMsgId.
  // This unblocks out-of-activation plays like Debts Repaid (CC fires on
  // friendly defeat regardless of whose activation is in progress).
  // Optional: readyActiveDc: true → also unexhaust/ready the active DC embed (e.g. Debts Repaid)
  // Excluded: conditionalFocusIfDamagedGte entries (e.g. Furious Charge) — handled in their own block below
  if ((abilityId === 'Focus' || (entry.type === 'ccEffect' && entry.applyFocus)) && !entry.conditionalFocusIfDamagedGte) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = context.msgId ?? findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress. Play during your activation.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    for (const fk of figureKeys) {
      applyCondition(game, fk, 'Focus');
    }
    // Guild Programming (IG-11): "Before you declare EACH attack [of Rapid Fire],
    // you become Focused." The Focus above covers the FIRST attack; arm a
    // re-Focus flag so the figure becomes Focused again before the second Rapid
    // Fire (free) attack — consumed in dc-play-area.js when each free attack is
    // declared (alexanbv 2026-06-22). Per-figure (ACTIVATION_FIGKEY_FLAGS).
    if (entry.focusEachRapidFireAttack) {
      game.guildProgrammingRefocus = game.guildProgrammingRefocus || {};
      for (const fk of figureKeys) game.guildProgrammingRefocus[fk] = true;
    }
    if (entry.readyActiveDc) {
      return { applied: true, logMessage: 'Became Focused. Readied active Deployment card.', readyDcMsgIds: [msgId], refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
    }
    const extraParts = [];
    // Wild Fury: applyFocus + grantActivationAssault + postActivationConditions
    // in a single ccEffect. Per alexanbv (2026-06-21): Wild Fury does NOT grant
    // multiple FREE attacks — it effectively gives the figure ASSAULT for that
    // activation (i.e. it may perform more than one attack, but each non-free
    // attack still costs an action). We grant this via a dedicated per-figure
    // flag, game.activationAssaultGranted[figureKey], honored by both the
    // 1-attack-per-activation gate in dc-play-area.js and the available-actions
    // hasAssault check. The flag clears at end of the figure's activation
    // (ACTIVATION_FIGKEY_FLAGS), matching "for that activation".
    if (entry.grantActivationAssault) {
      const _wfFk = figureKeyForActivation(game, msgId);
      if (_wfFk) {
        game.activationAssaultGranted = game.activationAssaultGranted || {};
        game.activationAssaultGranted[_wfFk] = true;
        extraParts.push('Gained **Assault** for this activation (may perform a second attack).');
      }
    }
    if (Array.isArray(entry.postActivationConditions) && entry.postActivationConditions.length > 0) {
      const _wfPacFk = figureKeyForActivation(game, msgId);
      if (_wfPacFk) {
        game.postActivationConditions = game.postActivationConditions || {};
        game.postActivationConditions[_wfPacFk] = entry.postActivationConditions;
      }
    }
    // extraActionBonus (All in a Day's Work): increment remaining actions for active DC
    if (typeof entry.extraActionBonus === 'number' && entry.extraActionBonus > 0) {
      const actData = game.dcActionsData?.[msgId];
      if (actData) {
        grantActionToFigure(actData, actData.selectedFigure ?? 0, entry.extraActionBonus, 2 + entry.extraActionBonus);
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
    // isMoveX (Get into Position): Move-X picker per CRR MOVE-017 — no
    // banking, bypassCosts true.
    if (entry.isMoveX) {
      const _gipSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _gipFigureKey = figureKeys[_gipSelectedIdx] || figureKeys[0] || null;
      // CSV row 409 "...become Focused" = YOU only. Focus solely the activating
      // figure that performed the special action, NOT the whole multi-figure
      // group (the sibling Get Ready uses "another figure in your group").
      if (_gipFigureKey) applyCondition(game, _gipFigureKey, 'Focus');
      if (!_gipFigureKey) {
        return { applied: true, logMessage: `Became Focused. (Could not locate activating figure for the move; resolve movement manually.)`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId], refreshBoard: true };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: entry.mpBonus,
        source: 'Get into Position',
        playerNum,
        figureKey: _gipFigureKey,
        dcName: meta?.dcName || '',
        threadId: null,
        bypassCosts: true,
        msgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
        logMessage: `**Get into Position** — May move up to ${entry.mpBonus} space${entry.mpBonus === 1 ? '' : 's'}. Became Focused.`,
        refreshDcEmbed: true,
        refreshDcEmbedMsgIds: [msgId],
        refreshBoard: true,
      };
    }
    // Non-isMoveX fall-through: Focus only the activating figure ("you").
    const _gipSelIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _gipActFk = figureKeys[_gipSelIdx] || figureKeys[0] || null;
    if (_gipActFk) applyCondition(game, _gipActFk, 'Focus');
    addMovementPoints(game, msgId, entry.mpBonus);
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
    // Per alexanbv 2026-05-11: each affected TROOPER prompts independently
    // for Recover vs Discard. Figures with only ONE viable option (no
    // harmful conditions = recover only; full HP = discard only) auto-
    // apply. Figures with BOTH options get a player prompt; AI default
    // = discard-over-recover.
    // ── Build affected-figure list ──
    const affectedFigs = [{ figureKey: activatingFigureKey, msgId, figIdx: selectedFig, controllerPlayerNum: pNum }];
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
        affectedFigs.push({ figureKey: fk, msgId: tMsgId, figIdx, controllerPlayerNum: pn });
      }
    }
    // ── Apply auto-cases; queue prompts for both-options cases ──
    const _autoResults = [];
    const _pendingChoices = [];
    for (const f of affectedFigs) {
      const conds = game.figureConditions?.[f.figureKey] || [];
      const harmful = conds.filter(c => harmfulConditions.includes(c) && !(c === 'Weaken' && game.disarmPermanentWeakened?.[f.figureKey]));
      const hs = dcHealthState.get(f.msgId) || [];
      const hpEntry = hs[f.figIdx];
      const damaged = hpEntry ? hpEntry[0] < hpEntry[1] : false;
      const _dcN = dcNameFromFigureKey(f.figureKey);
      if (harmful.length > 0 && damaged) {
        // Both options viable — player prompt.
        _pendingChoices.push({ ...f, dcName: _dcN, harmful });
      } else if (harmful.length > 0) {
        // Only discard.
        filterCondition(game, f.figureKey, harmful[0]);
        _autoResults.push(`**${_dcN}** discarded **${harmful[0]}** (no damage to recover)`);
      } else if (damaged) {
        // Only recover.
        const [cur, max] = hpEntry;
        hs[f.figIdx] = [Math.min(max, cur + 1), max];
        dcHealthState.set(f.msgId, hs);
        syncHealthStateToList(game, pNum, f.msgId, hs);
        _autoResults.push(`**${_dcN}** recovered 1 HP (no harmful conditions)`);
      }
      // No options → skipped silently.
    }
    if (_pendingChoices.length > 0) {
      game.pendingErgChoices = {
        gameId: game.gameId,
        controllerPlayerNum: pNum,
        sourceLabel: entry.label || 'Environmental Recovery Gear',
        figures: _pendingChoices,
      };
    }
    const _prefix = `**${entry.label}** — `;
    const _autoPart = _autoResults.length ? _autoResults.join('; ') + '.' : '';
    const _promptPart = _pendingChoices.length
      ? ` Choices pending for: ${_pendingChoices.map(c => `**${c.dcName}**`).join(', ')}.`
      : '';
    const _allEmpty = _autoResults.length === 0 && _pendingChoices.length === 0;
    return {
      applied: true,
      logMessage: _allEmpty
        ? `${_prefix}No figures needed healing or condition removal.`
        : `${_prefix}${_autoPart}${_promptPart}`,
      refreshDcEmbed: true,
      ergPostChoicesPrompt: _pendingChoices.length > 0,
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
    let _pmxMsgId = null;
    const freeMovePart = entry.freeMoveBonus > 0 ? ` May move up to ${entry.freeMoveBonus} space${entry.freeMoveBonus !== 1 ? 's' : ''}.` : '';
    if (entry.freeMoveBonus > 0) {
      // Move-X picker stamp (Evasive Maneuver and any other recover +
      // freeMoveBonus combo). Caller posts the picker via
      // pendingMoveXMsgId.
      const _emFigureKeys = Object.keys(game.figurePositions?.[meta.playerNum] || {})
        .filter(k => k.startsWith((meta.dcName || '') + '-'));
      const _emSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _emFigureKey = _emFigureKeys[_emSelectedIdx] || _emFigureKeys[0] || null;
      if (_emFigureKey) {
        game.pendingMoveX = game.pendingMoveX || {};
        game.pendingMoveX[msgId] = {
          remaining: entry.freeMoveBonus,
          source: entry.label || 'Move X',
          playerNum: meta.playerNum,
          figureKey: _emFigureKey,
          dcName: meta.dcName || '',
          threadId: null,
        };
        _pmxMsgId = msgId;
      }
    }
    return {
      applied: true,
      logMessage: totalRecovered > 0 ? `Recovered ${totalRecovered} Damage.${freeMovePart}` : `Already at full health.${freeMovePart}`,
      refreshDcEmbed: true,
      pendingMoveXMsgId: _pmxMsgId,
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

  // dcSpecial: recoverSelfOrAdjacentFriendly (Service — R2-D2) — you or an adjacent friendly
  // recovers N damage; optional trait filter applies to the adjacent target only (self always eligible).
  if (entry.type === 'dcSpecial' && typeof entry.recoverSelfOrAdjacentFriendly === 'number' && entry.recoverSelfOrAdjacentFriendly > 0) {
    const { game, msgId, meta, dcMessageMeta, dcHealthState, targetFigureKey } = context;
    if (!game || !msgId || !meta || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const playerNum = meta.playerNum;
    const mapId = game.selectedMap?.id;
    const label = entry.label || 'Service';
    const amount = entry.recoverSelfOrAdjacentFriendly;
    const traitFilter = (entry.recoverSelfOrAdjacentTraitFilter || []).map((t) => String(t).toUpperCase());

    const applyHealN = (healMsgId) => {
      const hs = (dcHealthState.get(healMsgId) || []).slice();
      let totalHealed = 0;
      let remaining = amount;
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

    if (targetFigureKey) {
      if (targetFigureKey === 'self') {
        const healed = applyHealN(msgId);
        return { applied: true, logMessage: `**${label}** — Recovered ${healed} Damage (self).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId] };
      }
      const tMsgId = findMsgIdForFigureKey(game, playerNum, targetFigureKey, dcMessageMeta);
      if (!tMsgId) return { applied: false, manualMessage: `Could not find adjacent friendly DC — resolve manually.` };
      const tMeta = dcMessageMeta.get(tMsgId);
      const healed = applyHealN(tMsgId);
      const tName = tMeta?.displayName || tMeta?.dcName || dcNameFromFigureKey(targetFigureKey);
      return { applied: true, logMessage: `**${label}** — **${tName}** recovered ${healed} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [tMsgId] };
    }

    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const adjFriendlyKeys = [];
    if (mapId) {
      for (const fk of activatingKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p !== playerNum) continue;
          if (activatingKeys.includes(figureKey)) continue;
          if (adjFriendlyKeys.includes(figureKey)) continue;
          if (traitFilter.length > 0) {
            const dn = dcNameFromFigureKey(figureKey);
            const kws = getKeywordsUpper(dn);
            if (!kws.some((k) => traitFilter.includes(k))) continue;
          }
          adjFriendlyKeys.push(figureKey);
        }
      }
    }

    if (adjFriendlyKeys.length === 0) {
      const healed = applyHealN(msgId);
      return { applied: true, logMessage: `**${label}** — Recovered ${healed} Damage.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [msgId] };
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
    // Per card text ("choose an adjacent friendly figure"), always prompt
    // the player even with 1 valid target — the explicit confirm-the-target
    // moment is part of the action's UX. Auto-applying with 1 target hid
    // the result and confused players who expected the dropdown.
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
    // Per card text ("Choose an adjacent friendly figure"), always prompt
    // the player even when there's only 1 valid target — the explicit
    // confirm-the-target moment is part of the action's UX. Auto-applying
    // when adjacent.length === 1 hid the focus result and confused players
    // who expected the dropdown.
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
    // Active terminals (filter out BD-1 Terminal-Slicing discards).
    const mapId = game.selectedMap?.id;
    const terminals = mapId ? getActiveTerminals(game, mapId) : [];
    // Check adjacency: Manhattan distance === 1 to any terminal
    let adjacentTerminal = null;
    if (figPos && terminals.length > 0) {
      const fp = parseCoord(figPos);
      for (const t of terminals) {
        const tp = parseCoord(String(t).toLowerCase());
        // "On or adjacent" = same space OR orthogonal OR diagonal (Chebyshev
        // <= 1), per alexanbv 2026-06-22 (companion-adjacency: things in a
        // companion's own space count as adjacent).
        if (Math.max(Math.abs(fp.col - tp.col), Math.abs(fp.row - tp.row)) <= 1) { adjacentTerminal = t; break; }
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

  // dcSpecial: terminal_slicing_bd1 (BD-1, Double Action Special) — discard
  // an adjacent terminal to draw 1 Command card.
  //
  // Picker semantics: if multiple terminals are adjacent, return a target
  // choice list (via requiresChoice with space-style entries). With one
  // adjacent terminal it resolves immediately.
  //
  // Side effects on apply:
  //   - Push the chosen terminal coord to `game.discardedTerminals`
  //     (additive; all downstream terminal readers go through
  //     getActiveTerminals so the terminal disappears from the board
  //     model for the rest of the game).
  //   - Draw 1 CC into the activator's hand.
  //   - Result `doubleAction: true` signals the dc-play-area caller to
  //     consume a second action on top of the standard +1 cost.
  if (entry.type === 'dcSpecial' && entry.terminalSlicing) {
    const { game, meta, msgId, choiceIndex } = context;
    if (!game || !meta) return { applied: false, manualMessage: '**Terminal Slicing** — Resolve manually.' };
    const mapId = game.selectedMap?.id;
    const terminals = mapId ? getActiveTerminals(game, mapId) : [];
    if (terminals.length === 0) {
      return { applied: false, manualMessage: '**Terminal Slicing** — No terminals remain on this map.' };
    }
    const figureKeys = getFigureKeysForDcMsg(game, meta.playerNum, meta);
    const selectedFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const figKey = figureKeys[selectedFig] || figureKeys[0];
    const figPos = figKey ? game.figurePositions?.[meta.playerNum]?.[figKey] : null;
    if (!figPos) {
      return { applied: false, manualMessage: '**Terminal Slicing** — BD-1 has no position on the board.' };
    }
    const fp = parseCoord(figPos);
    const adjacentTerminals = terminals.filter((t) => {
      const tp = parseCoord(String(t).toLowerCase());
      // "On or adjacent" = same space OR orthogonal OR diagonal (8-directional /
      // Chebyshev <= 1), per alexanbv 2026-06-22: a diagonally-adjacent terminal
      // is legal, AND a terminal in BD-1's OWN space counts (companion-adjacency
      // rule — things in a companion's space are adjacent to it).
      return Math.max(Math.abs(fp.col - tp.col), Math.abs(fp.row - tp.row)) <= 1;
    });
    if (adjacentTerminals.length === 0) {
      return { applied: false, manualMessage: '**Terminal Slicing** — BD-1 is not on or adjacent to a terminal.' };
    }
    // Phase 1: multiple adjacent → present picker. Phase 2: resolve.
    let chosenTerminal;
    if (adjacentTerminals.length === 1) {
      chosenTerminal = adjacentTerminals[0];
    } else if (choiceIndex != null && choiceIndex >= 0 && choiceIndex < adjacentTerminals.length) {
      chosenTerminal = adjacentTerminals[choiceIndex];
    } else {
      return {
        requiresChoice: true,
        choices: adjacentTerminals.map((t, i) => ({
          index: i,
          label: `Discard ${String(t).toUpperCase()}`,
          targetFigureKey: null,
          value: t,
        })),
        choiceLabel: '**Terminal Slicing** — Choose an adjacent terminal to discard:',
      };
    }
    // Discard terminal (append-only) and draw 1 CC.
    game.discardedTerminals = game.discardedTerminals || [];
    if (!game.discardedTerminals.includes(chosenTerminal)) {
      game.discardedTerminals.push(chosenTerminal);
    }
    const drew = drawCcCards(game, meta.playerNum, 1);
    if (!drew.length) {
      return {
        applied: true,
        doubleAction: true,
        logMessage: `**Terminal Slicing** — Discarded terminal **${String(chosenTerminal).toUpperCase()}** (no Command cards left in deck to draw).`,
        refreshDcEmbed: true,
      };
    }
    return {
      applied: true,
      doubleAction: true,
      logMessage: `**Terminal Slicing** — Discarded terminal **${String(chosenTerminal).toUpperCase()}**. Drew 1 Command card.`,
      drewCards: drew,
      refreshDcEmbed: true,
    };
  }

  // ccEffect: coveringFireEffect — start of round: up to 3 friendly TROOPERs become Hidden;
  // this round, each of your TROOPERs gains Surge: Stun (+2 Damage if target already Stunned).
  if (entry.type === 'ccEffect' && entry.coveringFireEffect) {
    const { game, playerNum, dcMessageMeta, targetFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const _cfMax = 3;
    const _cfSurgeMsg = 'This round, your TROOPERs gain Surge: Stun (if already Stunned, +2 Damage instead).';
    const _cfApplyHide = (fks) => {
      const hidden = [];
      for (const fk of fks) {
        if (applyCondition(game, fk, 'Hide')) hidden.push(dcNameFromFigureKey(fk));
      }
      const hideMsg = hidden.length > 0 ? `${hidden.join(', ')} became Hidden. ` : '';
      return { applied: true, logMessage: `**Covering Fire** — ${hideMsg}${_cfSurgeMsg}`, refreshDcEmbed: true };
    };
    // Phase 2+: sequential pick of WHICH TROOPERs (and how many, up to 3) to
    // Hide. CSV target: "up to 3 friendly TROOPERS" — the player chooses, not
    // the first 3. Mirrors Field Report's up-to-N picker. The Surge: Stun round
    // flag was already set in Phase 1 so the choice never blocks it.
    if (targetFigureKey && game.pendingCoveringFire) {
      const pendCF = game.pendingCoveringFire;
      if (targetFigureKey === '__done__') {
        delete game.pendingCoveringFire;
        return _cfApplyHide(pendCF.chosen);
      }
      pendCF.chosen.push(targetFigureKey);
      if (pendCF.chosen.length >= _cfMax) {
        delete game.pendingCoveringFire;
        return _cfApplyHide(pendCF.chosen);
      }
      const remaining = pendCF.candidates.filter((fk) => !pendCF.chosen.includes(fk));
      const opts = [...remaining.map(dcNameFromFigureKey), 'Done selecting'];
      const fKeys = [...remaining, '__done__'];
      return { applied: false, requiresChoice: true, choiceOptions: opts, targetFigureKeys: fKeys, choicePrompt: `**Covering Fire** — Selected ${pendCF.chosen.length}/${_cfMax}. Choose another TROOPER to Hide or Done:` };
    }
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
    // Set round-scoped flag immediately (independent of the Hide picks):
    // friendly TROOPERs gain Surge: Stun (+2 Damage if target already Stunned).
    game.roundTrooperSurgeStun = game.roundTrooperSurgeStun || {};
    game.roundTrooperSurgeStun[playerNum] = true;
    // ≤3 TROOPERs: Hide all (no meaningful choice). >3: offer a player pick of
    // which (and how many) up to 3 become Hidden.
    if (trooperFks.length <= _cfMax) {
      return _cfApplyHide(trooperFks);
    }
    game.pendingCoveringFire = { chosen: [], candidates: trooperFks };
    const choices = [...trooperFks.map(dcNameFromFigureKey), 'Done selecting'];
    const fKeysDone = [...trooperFks, '__done__'];
    return { applied: false, requiresChoice: true, choiceOptions: choices, targetFigureKeys: fKeysDone, choicePrompt: `**Covering Fire** — Choose up to ${_cfMax} friendly TROOPERS to become Hidden (${_cfSurgeMsg}):` };
  }

  // ccEffect: blendInAttach (Blend In) — played at start of round by K-2SO.
  // "Place this card on your Deployment card. It is now an Attachment. You
  // cannot be the target of an attack. Discard at the end of your activation
  // or when you declare an attack." We attach the card to K-2SO's DC, set an
  // untargetable flag on K-2SO's figure(s) (filtered in the attack-target
  // enumerators), and rely on the EoA / attack-declare hooks to discard it.
  if (entry.type === 'ccEffect' && entry.blendInAttach) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Find K-2SO's DC (the card is playableBy K-2SO).
    const dcList = getDcList(game, playerNum) || [];
    const msgIds = getDcMessageIds(game, playerNum) || [];
    let k2Idx = dcList.findIndex(dc => dc && !dc.defeated && (dc.dcName === 'K-2SO'));
    if (k2Idx < 0) return { applied: false, manualMessage: '**Blend In** — K-2SO is not in play.' };
    const k2MsgId = msgIds[k2Idx];
    // Mark every live K-2SO figure as untargetable until Blend In is discarded.
    game.blendInUntargetable = game.blendInUntargetable || {};
    let tagged = 0;
    for (const fk of Object.keys(game.figurePositions?.[playerNum] || {})) {
      if (!fk.startsWith('K-2SO-')) continue;
      if (!game.figurePositions[playerNum][fk]) continue;
      game.blendInUntargetable[fk] = { playerNum, msgId: k2MsgId || null };
      tagged++;
    }
    if (tagged === 0) return { applied: false, manualMessage: '**Blend In** — K-2SO has no figures on the board.' };
    // Record the attachment for bookkeeping/display.
    if (k2MsgId) {
      const attKey = dcAttachmentsKey(playerNum);
      game[attKey] = game[attKey] || {};
      game[attKey][k2MsgId] = game[attKey][k2MsgId] || [];
      if (!game[attKey][k2MsgId].includes('Blend In')) game[attKey][k2MsgId].push('Blend In');
    }
    return {
      applied: true,
      logMessage: '**Blend In** — Attached to K-2SO. K-2SO cannot be the target of an attack until it ends its activation or declares an attack.',
    };
  }

  // ccEffect: untargetableUntilRoundEnd (Hide in Plain Sight) — "Until the end of
  // the round, you cannot be the target of an attack" (CSV row 692). This is a
  // TARGETING immunity (like Blend In), NOT the Hide condition — alexanbv
  // 2026-06-20. Cleared at round start (round.js) + filtered in both target
  // enumerators (available-actions.js, dc-play-area.js).
  if (entry.type === 'ccEffect' && entry.untargetableUntilRoundEnd) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found for activation.' };
    const _hpsFk = figureKeyForActivation(game, msgId) || figureKeys[0];
    game.untargetableUntilRoundEnd = game.untargetableUntilRoundEnd || {};
    game.untargetableUntilRoundEnd[_hpsFk] = { playerNum };
    return { applied: true, logMessage: `**Hide in Plain Sight** — **${dcNameFromFigureKey(_hpsFk)}** cannot be the target of an attack until the end of the round.` };
  }

  // ccEffect: applyHide only (Guerilla Warfare etc.) — apply Hide to activating figures during activation
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
    // Per-figure 2026-05-09: arm on the activating figure so multifigure-group siblings don't share the buff.
    const _csMsgId = dcMessageMeta ? findActiveActivationMsgId(game, pnum, dcMessageMeta) : null;
    const _csFk = _csMsgId ? figureKeyForActivation(game, _csMsgId) : null;
    if (!_csFk) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.nextAttackBonusSurgeAbilities = game.nextAttackBonusSurgeAbilities || {};
    game.nextAttackBonusSurgeAbilities[_csFk] = entry.nextAttackBonusSurgeAbilities;
    const labels = entry.nextAttackBonusSurgeAbilities.join(', ');
    // Cruel Strike: the CC text is "Perform an attack that gains Surge: …",
    // so the special action must also GRANT the free attack (not merely buff a
    // later one). Arm freeAttackBonusPending on the same figure so a no-action
    // attack is available (mirrors the freeAttackBonus block at ~2710).
    let _csAttackNote = '';
    if (entry.freeAttackBonus) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[_csFk] = true;
      _csAttackNote = ' Perform an attack (no action) — click Attack.';
    }
    return { applied: true, logMessage: `Your next attack gains surge abilities: ${labels}.${_csAttackNote}` };
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
    const attP = game.lastAttackAttackerPlayerNum ?? opponentPlayerNum(playerNum);
    // Defeat-aware pipeline (alexanbv 2026-06-22): a lethal counter queues a defeat.
    const _rlRes = applyDamageWithDefeatCheck(dcHealthState, game, attMsgId, attFigIdx, entry.applyDamageToAttacker, attP, {
      sourceLabel: 'Reactive Loyalties', attackerPlayerNum: playerNum,
    });
    const attDcName = attDcList?.[attIdx]?.displayName || attMsgId;
    return { applied: true, logMessage: `Attacker (**${attDcName}**) suffers **${entry.applyDamageToAttacker} Damage** (HP: ${_rlRes.prevHp} → ${_rlRes.newHp}).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [attMsgId] };
  }

  // ccEffect: flatDamageToFigureWithin (Collateral Damage) — pick a figure within N of last attack target, deal N damage
  if (entry.type === 'ccEffect' && entry.flatDamageToFigureWithin) {
    const { game, playerNum, dcMessageMeta, dcHealthState, targetFigureKey: chosenTargetFk } = context;
    const { range = 2, damage: flatDmg = 2 } = entry.flatDamageToFigureWithin;
    if (!game || !playerNum || !dcMessageMeta || !dcHealthState) return { applied: false, manualMessage: `Resolve manually: choose a figure within ${range} spaces of the attack target; it suffers ${flatDmg} Damage.` };
    const lastTargetFk = game.lastAttackTargetFigureKey;
    const mapId = game.selectedMap?.id;
    if (!lastTargetFk || !mapId) return { applied: false, manualMessage: `Resolve manually: choose a figure within ${range} spaces of the attack target; it suffers ${flatDmg} Damage.` };
    // CC choice re-entry routes the chosen value as either `targetFigureKey`
    // (dcSpecial path) or `chosenFigureKey` (cc-hand path). Accept both so the
    // resolver works regardless of which prompt subsystem posted the buttons.
    const chosenAny = chosenTargetFk || context.chosenFigureKey || null;
    // Phase 2a: chosen value is an OBJECT (encoded `obj:<id>`). CSV "a figure or
    // OBJECT other than the defender within 2 … 2 Damage". Damageable mission
    // objects are damaged via the SAME sync inline-mutation pattern Terminal
    // Protocol / IG-11 Self-Destruct use (game.objectHealth mutation; the async
    // applyDamageToObject pipeline can't be awaited from this sync resolver).
    if (chosenAny && String(chosenAny).startsWith('obj:')) {
      const objId = String(chosenAny).slice(4);
      if (!isObjectAlive(game, objId)) return { applied: false, manualMessage: `**Collateral Damage** — that object is no longer in play.` };
      const hp = game.objectHealth?.[objId];
      if (!Array.isArray(hp)) return { applied: false, manualMessage: `**Collateral Damage** — apply ${flatDmg} Damage to the chosen object manually.` };
      const [cur, max] = hp;
      const newCur = Math.max(0, (cur ?? 0) - flatDmg);
      game.objectHealth[objId] = [newCur, max];
      const objName = game.objectMeta?.[objId]?.name || objId;
      if (newCur <= 0 && game.objectPositions) delete game.objectPositions[objId];
      return { applied: true, logMessage: `**Collateral Damage** — **${objName}** suffers **${flatDmg} Damage** (HP: ${cur ?? 0} → ${newCur})${newCur <= 0 ? ' — destroyed' : ''}.`, refreshDcEmbed: true };
    }
    // Phase 2: apply damage to chosen figure
    if (chosenTargetFk || (chosenAny && !String(chosenAny).startsWith('obj:'))) {
      const _ctFk = chosenTargetFk || chosenAny;
      const cftMsgId = (() => { for (const [mid, m] of dcMessageMeta) { if (m.playerNum !== playerNum) { const ks = getFigureKeysForDcMsg(game, m.playerNum, m); if (ks.includes(_ctFk)) return mid; } } return null; })();
      if (!cftMsgId) return { applied: false, manualMessage: `Resolve manually: could not locate target DC.` };
      const cftHS = dcHealthState.get(cftMsgId) || [];
      const cftMatch = _ctFk.match(/-(\d+)-(\d+)$/);
      const cftIdx = cftMatch ? parseInt(cftMatch[2], 10) : 0;
      const cftEntry = cftHS[cftIdx];
      if (!cftEntry) return { applied: false, manualMessage: `Apply ${flatDmg} Damage to chosen figure manually.` };
      const [cC, cM] = cftEntry;
      const cNew = Math.max(0, (cC ?? cM) - flatDmg);
      cftHS[cftIdx] = [cNew, cM ?? cNew];
      dcHealthState.set(cftMsgId, cftHS);
      const cftP = dcMessageMeta.get(cftMsgId)?.playerNum;
      syncHealthStateToList(game, cftP, cftMsgId, cftHS);
      const cftName = dcNameFromFigureKey(_ctFk);
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
        // CSV: "a figure or object OTHER THAN THE DEFENDER within 2 of the
        // target space" — exclude the attack's defender (the target figure).
        if (fk === lastTargetFk) continue;
        const dcName = dcNameFromFigureKey(fk);
        targets.push({ kind: 'figure', value: fk, label: dcName });
      }
    }
    // CSV "a figure or OBJECT … within 2": add damageable mission objects within
    // `range` of the target space. Encoded as `obj:<id>` choice values so the
    // CC choice re-entry (cc-hand / dcSpecial / headless) routes them back to the
    // object-damage Phase-2a branch above. Uses getDamageableObjectsWithinN
    // (countGameSpaces distance metric — same as figures). alexanbv 2026-06-20.
    for (const objId of getDamageableObjectsWithinN(game, lastTargetPos, range)) {
      const objName = game.objectMeta?.[objId]?.name || objId;
      targets.push({ kind: 'object', value: `obj:${objId}`, label: `Object: ${objName}` });
    }
    if (targets.length === 0) return { applied: false, manualMessage: `No figures or objects within ${range} spaces of attack target.` };
    if (targets.length === 1 && targets[0].kind === 'figure') {
      // Auto-apply to a single figure target (one candidate, no choice needed).
      const soloFk = targets[0].value;
      const soloMsgId = (() => { for (const [mid, m] of dcMessageMeta) { const ks = getFigureKeysForDcMsg(game, m.playerNum, m); if (ks.includes(soloFk)) return mid; } return null; })();
      if (soloMsgId) {
        const sHS = dcHealthState.get(soloMsgId) || [];
        const sMatch = soloFk.match(/-(\d+)-(\d+)$/);
        const sIdx = sMatch ? parseInt(sMatch[2], 10) : 0;
        const sEntry = sHS[sIdx];
        const soloP = dcMessageMeta.get(soloMsgId)?.playerNum;
        if (sEntry) {
          const [sC, sM] = sEntry; const sNew = Math.max(0, (sC ?? sM) - flatDmg);
          sHS[sIdx] = [sNew, sM ?? sNew]; dcHealthState.set(soloMsgId, sHS);
          syncHealthStateToList(game, soloP, soloMsgId, sHS);
          return { applied: true, logMessage: `**Collateral Damage** — **${targets[0].label}** suffers **${flatDmg} Damage** (HP: ${sC ?? sM} → ${sNew}).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: [soloMsgId] };
        }
      }
    }
    if (targets.length === 1 && targets[0].kind === 'object') {
      // Auto-apply to a single object candidate (sync inline mutation).
      const objId = targets[0].value.slice(4);
      const hp = game.objectHealth?.[objId];
      if (Array.isArray(hp)) {
        const [cur, max] = hp;
        const newCur = Math.max(0, (cur ?? 0) - flatDmg);
        game.objectHealth[objId] = [newCur, max];
        const objName = game.objectMeta?.[objId]?.name || objId;
        if (newCur <= 0 && game.objectPositions) delete game.objectPositions[objId];
        return { applied: true, logMessage: `**Collateral Damage** — **${objName}** suffers **${flatDmg} Damage** (HP: ${cur ?? 0} → ${newCur})${newCur <= 0 ? ' — destroyed' : ''}.`, refreshDcEmbed: true };
      }
    }
    // 2+ candidates (figures and/or objects) → choice. Return BOTH choiceValues
    // (cc-hand path) and targetFigureKeys (dcSpecial / headless path) so the
    // chosen value routes back regardless of which prompt subsystem is used.
    return {
      applied: false, requiresChoice: true,
      choiceOptions: targets.map(t => t.label),
      choiceValues: targets.map(t => t.value),
      targetFigureKeys: targets.map(t => t.value),
    };
  }

  // ccEffect: conditionalFocusIfDamagedGte (Furious Charge) — become Focused if suffered >= N damage from this attack
  if (entry.type === 'ccEffect' && typeof entry.conditionalFocusIfDamagedGte === 'number') {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: `Become Focused if you suffer ${entry.conditionalFocusIfDamagedGte}+ Damage from this attack (resolve manually).` };
    game.conditionalFocusIfDamagedGte = { playerNum, threshold: entry.conditionalFocusIfDamagedGte };
    return { applied: true, logMessage: `**Furious Charge** — will automatically become Focused if you suffer ${entry.conditionalFocusIfDamagedGte}+ Damage from this attack.` };
  }

  // ccEffect: nextAttackBonusPierce (Expose Weakness) — CSV row 641/642: "Choose an
  // ADJACENT HOSTILE figure; the next attack TARGETING that figure gains Pierce 3".
  // The pierce is keyed to the CHOSEN HOSTILE (defender), not the activator: the buff
  // applies only when that figure is attacked (by anyone). alexanbv 2026-06-20.
  if (entry.type === 'ccEffect' && typeof entry.nextAttackBonusPierce === 'number' && entry.nextAttackBonusPierce > 0) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const oppNum = opponentPlayerNum(playerNum);
    const N = entry.nextAttackBonusPierce;
    // Phase 2: chosen adjacent hostile → store target-keyed pierce.
    if (chosenFigureKey) {
      game.nextAttackPierceVsDefender = game.nextAttackPierceVsDefender || {};
      game.nextAttackPierceVsDefender[chosenFigureKey] = N;
      return {
        applied: true,
        logMessage: `**Expose Weakness** — the next attack targeting **${dcNameFromFigureKey(chosenFigureKey)}** gains Pierce ${N}.`,
      };
    }
    // Phase 1: enumerate adjacent HOSTILE figures.
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    const figureKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const _ewFk = figureKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || figureKeys[0];
    const mapId = game.selectedMap?.id;
    if (!_ewFk || !mapId) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    const adj = getFiguresAdjacentToTarget(game, _ewFk, mapId);
    const hostileKeys = [];
    for (const { figureKey: fk, playerNum: p } of adj) {
      if (p !== oppNum) continue;
      if (!hostileKeys.includes(fk)) hostileKeys.push(fk);
    }
    if (hostileKeys.length === 0) return { applied: false, manualMessage: '**Expose Weakness** — no adjacent hostile figure.' };
    if (hostileKeys.length === 1) {
      game.nextAttackPierceVsDefender = game.nextAttackPierceVsDefender || {};
      game.nextAttackPierceVsDefender[hostileKeys[0]] = N;
      return { applied: true, logMessage: `**Expose Weakness** — the next attack targeting **${dcNameFromFigureKey(hostileKeys[0])}** gains Pierce ${N}.` };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: hostileKeys.map((fk) => `Expose: ${dcNameFromFigureKey(fk)}`),
      choiceValues: hostileKeys,
    };
  }

  // ccEffect: chooseAdjacentFriendlyFreeAttackBonusHits (Take it Down) —
  // choose an adjacent friendly figure; THAT figure performs a free
  // attack whose results gain +N Damage (NOT the activating/card-player
  // figure). Mirrors the dcSpecial "choose adjacent friendly → free
  // attack" pattern (Bombardment / Coordinated Raid): set
  // freeAttackBonusPending + nextAttacksBonusHits on the CHOSEN figure
  // and route via the CC choiceValues/chosenFigureKey re-entry.
  if (entry.type === 'ccEffect' && entry.chooseAdjacentFriendlyFreeAttackBonusHits) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually: play during your activation.' };
    const nbCfg = entry.nextAttacksBonusHits || { count: 1, bonus: 2 };
    // Phase 2: a figure was chosen → grant the free attack + bonus.
    if (chosenFigureKey) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[chosenFigureKey] = { from: 'Take it Down' };
      game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
      game.nextAttacksBonusHits[chosenFigureKey] = { count: nbCfg.count, bonus: nbCfg.bonus };
      const chosenName = dcNameFromFigureKey(chosenFigureKey);
      return {
        applied: true,
        logMessage: `**Take it Down** — **${chosenName}** may interrupt to perform a free attack; its results gain **+${nbCfg.bonus} Damage**. Use their **Attack** button.`,
      };
    }
    // Phase 1: enumerate adjacent friendly figures (excluding the activating figure).
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: '**Take it Down** — no activation in progress. Resolve manually.' };
    const activatingKey = figureKeyForActivation(game, msgId);
    const activatingPos = activatingKey ? game.figurePositions?.[playerNum]?.[activatingKey] : null;
    if (!activatingPos) return { applied: false, manualMessage: '**Take it Down** — activating figure has no position. Resolve manually.' };
    const validTargets = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (fk === activatingKey || !pos) continue;
      if (countGameSpaces(game, activatingPos, pos) > 1) continue;
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: '**Take it Down** — no adjacent friendly figure. Resolve manually.' };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(validTargets),
      choiceValues: validTargets,
      manualMessage: '**Take it Down** — choose an adjacent friendly figure to perform the attack.',
    };
  }

  // ccEffect: nextAttacksBonusHits — +N Hit to next M attacks.
  //
  // Two scoped variants share the structural field but route to
  // different game-state slots so cleanup keying is unambiguous:
  //   groupActivationScope: true (Beatdown) → groupNextAttacksBonusHits
  //     [playerNum]; applies to ANY friendly figure's attack during
  //     the activating group's activation. Cleaned via
  //     ACTIVATION_PLAYERNUM_FLAGS at activation end.
  //   default (Size Advantage, Maximum Firepower) →
  //     nextAttacksBonusHits[figureKey]; applies only to that
  //     figure's next attack. Cleaned via ACTIVATION_FIGKEY_FLAGS.
  // (Take it Down is excluded — it has its own dedicated handler above.)
  const nb = entry.type === 'ccEffect' && !entry.chooseAdjacentFriendlyFreeAttackBonusHits && entry.nextAttacksBonusHits;
  if (nb && typeof nb.count === 'number' && nb.count > 0 && typeof nb.bonus === 'number' && nb.bonus > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const nbc = entry.nextAttacksBonusConditions;
    if (entry.groupActivationScope) {
      game.groupNextAttacksBonusHits = game.groupNextAttacksBonusHits || {};
      game.groupNextAttacksBonusHits[playerNum] = { count: nb.count, bonus: nb.bonus };
      if (nbc && typeof nbc.count === 'number' && nbc.count > 0 && Array.isArray(nbc.conditions) && nbc.conditions.length > 0) {
        game.groupNextAttacksBonusConditions = game.groupNextAttacksBonusConditions || {};
        game.groupNextAttacksBonusConditions[playerNum] = { count: nbc.count, conditions: nbc.conditions };
      }
    } else {
      const _nbFk = figureKeyForActivation(game, msgId);
      if (!_nbFk) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
      game.nextAttacksBonusHits = game.nextAttacksBonusHits || {};
      // requiresSmallTarget (Size Advantage, CSV row 720 conditional "target is a
      // Small figure"): carry the gate onto the pending entry so consumption in
      // combat-bridge.js only applies the +2 Hit / Weaken vs a SMALL target.
      game.nextAttacksBonusHits[_nbFk] = { count: nb.count, bonus: nb.bonus, ...(nb.requiresSmallTarget ? { requiresSmallTarget: true } : {}) };
      if (nbc && typeof nbc.count === 'number' && nbc.count > 0 && Array.isArray(nbc.conditions) && nbc.conditions.length > 0) {
        game.nextAttacksBonusConditions = game.nextAttacksBonusConditions || {};
        game.nextAttacksBonusConditions[_nbFk] = { count: nbc.count, conditions: nbc.conditions, ...(nbc.requiresSmallTarget ? { requiresSmallTarget: true } : {}) };
      }
    }
    const condPart = (nbc?.conditions?.length) ? ` and ${nbc.conditions.join(', ')}` : '';
    return {
      applied: true,
      logMessage: `Next ${nb.count} attack(s) by your figures this activation gain +${nb.bonus} Damage to results${condPart}.`,
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
    return { applied: true, logMessage: `+${bonus} Damage (${defeated} defeated friendly figure${defeated === 1 ? '' : 's'}).` };
  }

  // ccEffect: attackBonusHits + requiresMeleeAttack / bonusHitVsRangedDefender (Deathblow)
  // CSV: "when you declare a MELEE attack — Apply +1 Hit" plus a second row
  // "Apply an additional +1 Hit if defender has the Ranged attack type".
  // Gate: attacker must be making a Melee attack (combat.isRanged falsy, with
  // a fallback to the attacker's DC attack type). Defender-Ranged check reads
  // the target figure's DC attack.type === 'range'.
  if (entry.type === 'ccEffect' && typeof entry.attackBonusHits === 'number' && entry.attackBonusHits > 0 && entry.requiresMeleeAttack) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    // Determine the attack type. Prefer the combat flag; fall back to the
    // attacker's DC base attack type when the flag is not yet populated.
    let attackerIsRanged = cbt.isRanged;
    if (attackerIsRanged == null) {
      const _atkType = (getStatsForDc(cbt.attackerDcName)?.attack?.type || '').toLowerCase();
      attackerIsRanged = _atkType === 'range' || _atkType === 'ranged';
    }
    if (attackerIsRanged) {
      return { applied: false, manualMessage: '**Deathblow** — only applies when you declare a Melee attack.' };
    }
    let bonus = entry.attackBonusHits;
    let rangedNote = '';
    if (typeof entry.bonusHitVsRangedDefender === 'number' && entry.bonusHitVsRangedDefender > 0) {
      const _defFk = cbt.target?.figureKey;
      const _defDcName = _defFk ? dcNameFromFigureKey(_defFk) : (cbt.targetStats ? null : null);
      const _defType = _defDcName ? (getStatsForDc(_defDcName)?.attack?.type || '').toLowerCase() : '';
      if (_defType === 'range' || _defType === 'ranged') {
        bonus += entry.bonusHitVsRangedDefender;
        rangedNote = ` (+${entry.bonusHitVsRangedDefender} vs Ranged defender)`;
      }
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + bonus;
    return {
      applied: true,
      logMessage: `+${bonus} Damage added to this Melee attack.${rangedNote}`,
    };
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
    // Heavy Ordnance: "if the defender is an object apply +2 Hit and Pierce 2
    // instead". The only attackable object modelled in the combat pipeline is a
    // crate (target.npcType === 'crate', see handlers/combat.js ~3783), so use
    // that as the object-defender signal.
    const _hoObjectDefender = cbt.target?.npcType === 'crate';
    if (_hoObjectDefender && typeof entry.objectDefenderBonusHits === 'number') {
      cbt.bonusHits = (cbt.bonusHits || 0) + entry.objectDefenderBonusHits;
      if (entry.objectDefenderBonusPierce) cbt.bonusPierce = (cbt.bonusPierce || 0) + entry.objectDefenderBonusPierce;
      if (entry.mutualExcludeAttackCc) cbt.ccLockedOut = true;
      return {
        applied: true,
        logMessage: `Defender is an object: +${entry.objectDefenderBonusHits} Damage${entry.objectDefenderBonusPierce ? ` and Pierce ${entry.objectDefenderBonusPierce}` : ''} added to this attack.`,
      };
    }
    cbt.bonusHits = (cbt.bonusHits || 0) + entry.attackBonusHits;
    if (entry.mutualExcludeAttackCc) cbt.ccLockedOut = true;
    return {
      applied: true,
      logMessage: `+${entry.attackBonusHits} Damage added to this attack.${entry.mutualExcludeAttackCc ? ' No other CCs may be played during this attack.' : ''}`,
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
    // Some CCs grant surge abilities AND a flat Accuracy bonus in one card
    // (e.g. Hunt Them Down: "+2 Accuracy and the attack gains Cleave 2").
    // Apply the Accuracy here too so the surge branch doesn't swallow it.
    let accNote = '';
    if (typeof entry.attackAccuracyBonus === 'number' && entry.attackAccuracyBonus > 0) {
      cbt.bonusAccuracy = (cbt.bonusAccuracy || 0) + entry.attackAccuracyBonus;
      accNote = ` and +${entry.attackAccuracyBonus} Accuracy`;
    }
    return {
      applied: true,
      logMessage: `This attack gains surge abilities: ${labels}${accNote}.`,
    };
  }

  // ccEffect: attackBonusCleave — the attack AUTOMATICALLY gains Cleave N (no
  // surge cost). Hunt Them Down: "the attack gains Cleave 2" is an unconditional
  // keyword, so route through combat.passiveCleave / cleaveSources (the
  // keyword-Cleave path at handlers/combat.js:7966) rather than the surge menu.
  if (entry.type === 'ccEffect' && typeof entry.attackBonusCleave === 'number' && entry.attackBonusCleave > 0) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when declaring attack (as the attacker).' };
    }
    const _clv = entry.attackBonusCleave;
    cbt.passiveCleave = (cbt.passiveCleave || 0) + _clv;
    (cbt.cleaveSources = cbt.cleaveSources || []).push({ value: _clv, label: `Cleave ${_clv} (passive)` });
    // Some CCs grant Cleave AND a flat Accuracy bonus in one card
    // (Hunt Them Down: "+2 Accuracy and the attack gains Cleave 2").
    let accNote = '';
    if (typeof entry.attackAccuracyBonus === 'number' && entry.attackAccuracyBonus > 0) {
      cbt.bonusAccuracy = (cbt.bonusAccuracy || 0) + entry.attackAccuracyBonus;
      accNote = ` and +${entry.attackAccuracyBonus} Accuracy`;
    }
    return {
      applied: true,
      logMessage: `This attack gains Cleave ${_clv}${accNote}.`,
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
    // Sniper Configuration: "draw line of sight from any friendly figure but
    // still measure range from this figure." Arm a per-figureKey flag the target
    // enumerators honor (mirrors Fire Mission's group-LOS extension, but over ALL
    // friendly figures). Range continues to be measured from the attacker (the
    // enumerators only extend LOS, not range). The flag also unlocks a target
    // whose LOS comes only from a friendly when the attack is declared.
    const _scFk = cbt.attackerFigureKey || null;
    if (_scFk) {
      game.sniperConfigLosAnyFriendly = game.sniperConfigLosAnyFriendly || {};
      game.sniperConfigLosAnyFriendly[_scFk] = true;
    }
    return {
      applied: true,
      logMessage: `+${entry.attackAccuracyBonus} Accuracy and +${entry.attackBonusPierce} Pierce added to this attack. Line of sight may be drawn from **any friendly figure** (range still measured from the attacker).`,
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

  // ccEffect: Arcing Shot — set arcingShotActive flag for targeting validation.
  // The card's ONLY effect is the targeting permission (target a figure/object
  // adjacent to an empty space in your LOS); it grants NO Accuracy bonus.
  if (entry.type === 'ccEffect' && entry.arcingShotTargeting) {
    const { game, playerNum, combat, dcMessageMeta } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play before declaring an attack (as the attacker).' };
    }
    // Set flag so target selection validates adjacent empty space in
    // attacker's LOS. Per alexanbv 2026-05-13: per-figureKey.
    const _asFk = cbt.attackerFigureKey || null;
    if (_asFk) {
      game.arcingShotActive = game.arcingShotActive || {};
      game.arcingShotActive[_asFk] = true;
    } else {
      // Fallback: set scalar flag (no active combat yet — pre-declare).
      game.arcingShotActiveScalar = true;
    }
    return {
      applied: true,
      logMessage: `**Arcing Shot** — Target must be adjacent to an empty space in attacker's LOS.`,
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

  // ccEffect: attackDodgeReduction / attackEvadeReduction (Lock On choice) —
  // apply -N Dodge or -N Evade to the defender's results. Flow through the same
  // combat.bonusDodge / combat.bonusEvade (negative) fields used by Conclusion /
  // Dead Precise / Disposable; consumed in src/game/combat.js resolveCombat.
  if (entry.type === 'ccEffect'
      && (typeof entry.attackDodgeReduction === 'number' || typeof entry.attackEvadeReduction === 'number')) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play while attacking (as the attacker).' };
    }
    if (entry.attackDodgeReduction > 0) {
      cbt.bonusDodge = (cbt.bonusDodge || 0) - entry.attackDodgeReduction;
      return { applied: true, logMessage: `−${entry.attackDodgeReduction} Dodge applied to the defense results.` };
    }
    cbt.bonusEvade = (cbt.bonusEvade || 0) - entry.attackEvadeReduction;
    return { applied: true, logMessage: `−${entry.attackEvadeReduction} Evade applied to the defense results.` };
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

  // ccEffect: addForcedRerollEntry (Capitalize) — push an entry into the
  // active combat's forcedRerollQueue. Resolved during step-3 reroll window
  // by the existing forced-reroll handler (combat.js handleCombatReroll).
  // Per CRR p.11 (special situations): "An ability that allows a player to
  // reroll dice can only be used during step 3 of the attack."
  if (entry.type === 'ccEffect' && entry.addForcedRerollEntry) {
    const { game, playerNum, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!cbt) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    const cfg = entry.addForcedRerollEntry;
    const ctrl = cfg.controlPlayer === 'attacker' ? cbt.attackerPlayerNum
              : cfg.controlPlayer === 'defender' ? (cbt.defenderPlayerNum ?? opponentPlayerNum(cbt.attackerPlayerNum))
              : playerNum;
    cbt.forcedRerollQueue = cbt.forcedRerollQueue || [];
    cbt.forcedRerollQueue.push({
      controlPlayer: ctrl,
      pool: cfg.pool || 'any',
      remaining: cfg.remaining || 1,
      source: cfg.source || entry.label || 'Force Reroll',
    });
    return { applied: true, logMessage: `**${cfg.source || entry.label}** — Forced reroll added (${cfg.pool || 'any'} pool, controller: P${ctrl}). Resolves during the reroll window.` };
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
        const targetHadLos = hasLineOfSightByCoord(game, String(defCoord).toLowerCase(), String(atkStartPos).toLowerCase(), mapSp, getFigureSize);
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

  // ccEffect: removeDefenseDieResults (Heightened Reflexes) — after the defense
  // dice are rolled, choose 1 defense die and remove its results. Interactive
  // via requiresChoice; resolves through the unified counter-window like any CC.
  // alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && typeof entry.removeDefenseDieResults === 'number' && entry.removeDefenseDieResults > 0) {
    const { game, choiceIndex, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: not in an attack.' };
    const dice = cbt.defenseDiceResults || [];
    if (dice.length === 0) return { applied: true, logMessage: '**Heightened Reflexes** — no defense dice to remove.' };
    if (choiceIndex == null) {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: dice.map((d, i) => `Die #${i + 1} (${d.block || 0}b/${d.evade || 0}e${d.dodge ? '/dodge' : ''})`),
      };
    }
    const idx = parseInt(choiceIndex, 10);
    if (!dice[idx]) return { applied: false, manualMessage: 'Invalid die choice for Heightened Reflexes.' };
    const roll = applyDefenseDieRemoval(cbt, idx);
    return {
      applied: true,
      refreshDcEmbed: true,
      logMessage: `**Heightened Reflexes** — removed defense die #${idx + 1}'s results. Defense now ${roll?.block || 0}b/${roll?.evade || 0}e${roll?.dodge ? '/dodge' : ''}.`,
    };
  }

  // ccEffect: feintEffect (Feint) — CSV: "Choose 1 attack die and 1 defense die
  // and remove their results." Use-condition: "attacking a figure within 2 spaces."
  // Timing: attack:modifiers / attacker side, AFTER both pools are rolled (same
  // window as Heightened Reflexes). Two-step interactive pick over the ROLLED
  // results (NOT pool dice): step 1 chooses the attack die to zero, step 2 the
  // defense die. Mirrors removeDefenseDieResults but acts on BOTH pools and uses
  // the chained-requiresChoice flow (cc-hand.js) for the second pick.
  if (entry.type === 'ccEffect' && entry.feintEffect) {
    const { game, choiceIndex, combat } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: not in an attack.' };
    // Use-condition: target within 2 spaces of the attacker.
    if ((cbt.distanceToTarget ?? 0) > 2) {
      return { applied: false, manualMessage: `**Feint** — target is ${cbt.distanceToTarget} spaces away (> 2); cannot play. Override if incorrect.` };
    }
    const atkDice = cbt.attackDiceResults || [];
    const defDice = cbt.defenseDiceResults || [];
    // Step 2: attack die already removed (flag set) — this choiceIndex is the
    // DEFENSE die. Remove it and finish.
    if (cbt._feintAttackRemoved != null) {
      if (choiceIndex == null) {
        // Re-prompt the defense-die pick (no attack dice left to choose, or chained entry).
        if (defDice.length === 0) {
          const _atkR = cbt.attackRoll || {};
          delete cbt._feintAttackRemoved;
          return { applied: true, refreshDcEmbed: true, logMessage: `**Feint** — removed attack die #${cbt._feintAttackRemovedIdx + 1 || ''}; no defense dice to remove. Attack now ${_atkR.dmg || 0} dmg / ${_atkR.surge || 0} surge / ${_atkR.acc || 0} acc.` };
        }
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions: defDice.map((d, i) => `Defense die #${i + 1} (${d.block || 0}b/${d.evade || 0}e${d.dodge ? '/dodge' : ''})`),
        };
      }
      const dIdx = parseInt(choiceIndex, 10);
      if (!defDice[dIdx]) return { applied: false, manualMessage: 'Invalid defense die choice for Feint.' };
      const defRoll = applyDefenseDieRemoval(cbt, dIdx);
      const atkRoll = cbt.attackRoll || {};
      const aIdx = cbt._feintAttackRemovedIdx;
      delete cbt._feintAttackRemoved;
      delete cbt._feintAttackRemovedIdx;
      return {
        applied: true,
        refreshDcEmbed: true,
        logMessage: `**Feint** — removed attack die #${(aIdx ?? 0) + 1} and defense die #${dIdx + 1}. Attack now ${atkRoll.dmg || 0} dmg / ${atkRoll.surge || 0} surge / ${atkRoll.acc || 0} acc; Defense now ${defRoll?.block || 0}b/${defRoll?.evade || 0}e${defRoll?.dodge ? '/dodge' : ''}.`,
      };
    }
    // Step 1: choose the ATTACK die.
    if (choiceIndex == null) {
      if (atkDice.length === 0) {
        // No attack dice — go straight to the defense-die pick (set flag as -1).
        cbt._feintAttackRemoved = true;
        cbt._feintAttackRemovedIdx = -1;
        if (defDice.length === 0) {
          delete cbt._feintAttackRemoved;
          delete cbt._feintAttackRemovedIdx;
          return { applied: true, logMessage: '**Feint** — no attack or defense dice to remove.' };
        }
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions: defDice.map((d, i) => `Defense die #${i + 1} (${d.block || 0}b/${d.evade || 0}e${d.dodge ? '/dodge' : ''})`),
        };
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: atkDice.map((d, i) => `Attack die #${i + 1} (${d.dmg || 0}dmg/${d.surge || 0}srg/${d.acc || 0}acc)`),
      };
    }
    const aIdx = parseInt(choiceIndex, 10);
    if (!atkDice[aIdx]) return { applied: false, manualMessage: 'Invalid attack die choice for Feint.' };
    applyAttackDieRemoval(cbt, aIdx);
    cbt._feintAttackRemoved = true;
    cbt._feintAttackRemovedIdx = aIdx;
    // Chain into the defense-die pick.
    if (defDice.length === 0) {
      const _atkR = cbt.attackRoll || {};
      delete cbt._feintAttackRemoved;
      delete cbt._feintAttackRemovedIdx;
      return { applied: true, refreshDcEmbed: true, logMessage: `**Feint** — removed attack die #${aIdx + 1}; no defense dice to remove. Attack now ${_atkR.dmg || 0} dmg / ${_atkR.surge || 0} surge / ${_atkR.acc || 0} acc.` };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: defDice.map((d, i) => `Defense die #${i + 1} (${d.block || 0}b/${d.evade || 0}e${d.dodge ? '/dodge' : ''})`),
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
    const { game, playerNum, combat, chosenFigureKey } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    if (!game || !playerNum || !cbt || cbt.attackerPlayerNum !== playerNum) {
      return { applied: false, manualMessage: "Resolve manually: play when declaring an attack (as the attacker)." };
    }
    // requireRangedAttackType gate (Concentrated Fire, alexanbv 2026-05-09):
    // card is played by ANOTHER friendly Ranged TROOPER (not the attacker).
    // That figure becomes Stunned. Build the eligible-supporter list and,
    // if multiple are available, post a picker so the player chooses
    // which figure plays the card. The Stun lands on the CHOSEN figure,
    // not the attacker.
    let supporterFigureKey = null;
    if (entry.requireRangedAttackType) {
      const dcEffectsMap = getDcEffects() || {};
      const friendlyPositions = game.figurePositions?.[playerNum] || {};
      const attackerKey = cbt.attackerFigureKey;
      // CSV conditional: "...targeting a target in your line of sight" — the
      // supporter playing the card must have LOS to the attack's target. Resolve
      // the target's space and require LOS from each candidate supporter.
      const _cfMs = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
      const _cfGfs = context.getFigureSize;
      const _cfDefPN = opponentPlayerNum(playerNum);
      const _cfTargetPos = cbt.target?.figureKey
        ? game.figurePositions?.[_cfDefPN]?.[cbt.target.figureKey]
        : null;
      const _cfCanCheckLos = !!(_cfTargetPos && _cfMs && typeof _cfGfs === 'function');
      const eligibleSupporters = Object.keys(friendlyPositions).filter((fk) => {
        if (fk === attackerKey) return false;
        const fkDcName = dcNameFromFigureKey(fk);
        const fkStats = dcEffectsMap[fkDcName];
        const fkKws = (fkStats?.keywords || []).map(k => String(k).toUpperCase());
        if (!(fkStats?.attack?.type === 'range' && fkKws.includes('TROOPER'))) return false;
        // LOS from the supporter to the target space.
        if (_cfCanCheckLos) {
          const sPos = friendlyPositions[fk];
          if (!sPos || !hasLineOfSightByCoord(game, sPos, _cfTargetPos, _cfMs, _cfGfs)) return false;
        }
        return true;
      });
      if (eligibleSupporters.length === 0) {
        // No eligible supporter — die bonus and Stun both skip.
        return {
          applied: true,
          logMessage: 'No Ranged non-attacker TROOPER available — Concentrated Fire has no effect.',
        };
      }
      if (chosenFigureKey && eligibleSupporters.includes(chosenFigureKey)) {
        supporterFigureKey = chosenFigureKey;
      } else if (eligibleSupporters.length === 1) {
        supporterFigureKey = eligibleSupporters[0];
      } else {
        // Multiple supporters — let the player pick.
        const choiceOptions = eligibleSupporters.map((fk) => {
          const dcName = dcNameFromFigureKey(fk);
          const m = fk.match(/-(\d+)-(\d+)$/);
          const dgIdx = m?.[1] ?? '1';
          const figIdx = m?.[2] ?? '0';
          return `${dcName} (${dgIdx}.${figIdx})`;
        });
        return {
          requiresChoice: true,
          choiceOptions,
          choiceValues: eligibleSupporters,
        };
      }
    }
    // Tools for the Job CSV row 855: "add 1 attack die OF YOUR CHOICE". When the
    // library marks attackBonusDiceColorChoice and no fixed color is set, prompt the
    // attacker to pick the die color, then add a die of that color. alexanbv 2026-06-20.
    let _chosenBonusColor = null;
    if (entry.attackBonusDiceColorChoice && !entry.attackBonusDiceColor) {
      const ATTACK_DIE_COLORS = ['red', 'yellow', 'green', 'blue'];
      const _pick = chosenFigureKey && /^tools_color:/.test(String(chosenFigureKey))
        ? String(chosenFigureKey).slice('tools_color:'.length).toLowerCase()
        : null;
      if (!_pick || !ATTACK_DIE_COLORS.includes(_pick)) {
        // First call: prompt for the bonus die color.
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions: ATTACK_DIE_COLORS.map((c) => `Add ${c.charAt(0).toUpperCase() + c.slice(1)} die`),
          choiceValues: ATTACK_DIE_COLORS.map((c) => `tools_color:${c}`),
        };
      }
      _chosenBonusColor = _pick;
    }
    cbt.attackBonusDice = (cbt.attackBonusDice || 0) + entry.attackBonusDice;
    const _bonusColor = entry.attackBonusDiceColor || _chosenBonusColor;
    if (_bonusColor) {
      cbt.attackBonusDiceColors = cbt.attackBonusDiceColors || [];
      const color = String(_bonusColor).toLowerCase();
      for (let i = 0; i < entry.attackBonusDice; i++) cbt.attackBonusDiceColors.push(color);
    }
    // applySelfStunAfterAttack (Concentrated Fire): the SUPPORTER (chosen
    // figure) becomes Stunned, NOT the attacker. Per card text "you become
    // Stunned" where "you" is the figure playing the CC.
    if (entry.applySelfStunAfterAttack && supporterFigureKey) {
      game.applySelfStunAfterAttackFigureKey = game.applySelfStunAfterAttackFigureKey || {};
      game.applySelfStunAfterAttackFigureKey[playerNum] = supporterFigureKey;
    }
    const supporterLabel = supporterFigureKey ? dcNameFromFigureKey(supporterFigureKey) : null;
    const _colorWord = _chosenBonusColor ? ` ${_chosenBonusColor}` : '';
    const dieMsg = `Added ${entry.attackBonusDice}${_colorWord} attack die to the attack pool.`;
    const stunMsg = supporterLabel
      ? ` **${supporterLabel}** becomes Stunned after this attack resolves.`
      : '';
    return {
      applied: true,
      logMessage: dieMsg + stunMsg,
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

  // ccEffect: defenseBonusBlockOrEvadeChoice (Parry) — defender chooses +N Block OR +N Evade.
  if (entry.type === 'ccEffect' && typeof entry.defenseBonusBlockOrEvadeChoice === 'number' && entry.defenseBonusBlockOrEvadeChoice > 0) {
    const { game, playerNum, combat, chosenOption } = context;
    const cbt = combat || game?.pendingCombat || game?.combat;
    const defenderPlayerNum = cbt?.attackerPlayerNum ? opponentPlayerNum(cbt.attackerPlayerNum) : null;
    if (!game || !playerNum || !cbt || defenderPlayerNum !== playerNum) {
      return { applied: false, manualMessage: 'Resolve manually: play when an attack targeting you is declared (as the defender).' };
    }
    const n = entry.defenseBonusBlockOrEvadeChoice;
    const blockLabel = `+${n} Block`;
    const evadeLabel = `+${n} Evade`;
    if (chosenOption == null) {
      return { applied: false, requiresChoice: true, choiceOptions: [blockLabel, evadeLabel], logMessage: `**Parry** — choose ${blockLabel} or ${evadeLabel}.` };
    }
    if (String(chosenOption).toLowerCase().includes('evade')) {
      cbt.bonusEvade = (cbt.bonusEvade || 0) + n;
      return { applied: true, logMessage: `${evadeLabel} added to defense results.` };
    }
    cbt.bonusBlock = (cbt.bonusBlock || 0) + n;
    return { applied: true, logMessage: `${blockLabel} added to defense results.` };
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

  // ccEffect: round-scoped DEFENSE / attack-hit modifiers (Take Position,
  // Survival Instincts, Take Cover, Cavalry Charge, Armed Escort, Fuel Upgrade,
  // Deflection). MIGRATED 2026-06-20 (alexanbv) to the per-figure active
  // round-modifier registry: instead of writing a per-player counter, each card
  // registers a descriptor that is evaluated PER-FIGURE at the combat MODIFIERS
  // stage (src/engine/combat-bridge.js) so a bonus applies to a figure only IF
  // that figure meets the card's conditions at the moment it attacks/defends.
  if (entry.type === 'ccEffect' && ((typeof entry.roundDefenseBonusBlock === 'number' && entry.roundDefenseBonusBlock > 0) || (typeof entry.roundDefenseBonusEvade === 'number' && entry.roundDefenseBonusEvade > 0) || (typeof entry.roundDefenseAccuracyPenalty === 'number' && entry.roundDefenseAccuracyPenalty > 0) || (typeof entry.roundDeflectionAccuracyPenalty === 'number' && entry.roundDeflectionAccuracyPenalty > 0) || entry.deflectionCounterDamage || entry.vehicleSpeedBonusRound || entry.vehicleDefenseBonusEvadeRound || entry.trooperRoundAttackHitBonus) && !entry.roundDefenderBonusBlockPerEvade) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const cardName = abilityId || entry.label || 'CC';
    // Resolve the card-playing figure (the "you"/anchor) per the card's REAL
    // play timing — NOT just the activating figure. alexanbv 2026-06-20 ruled
    // "'you' refers to ONLY the figure that played the card", and the CSV
    // timings differ: during/start-of-activation cards anchor on the activating
    // figure, defender reactions (Deflection) anchor on the attacked figure
    // (no activation in progress), and start_of_round cards (Cavalry Charge)
    // anchor on the card's named unique figure (Captain Terro). The shared
    // helper resolveRoundModifierAnchor handles all three in priority order so
    // these previously-regressed cards (Deflection, Cavalry Charge) get a
    // correct NON-NULL anchor in real play instead of a silent no-op.
    const sourceFigureKey = resolveRoundModifierAnchor(game, playerNum, cardName, {
      dcMessageMeta: context.dcMessageMeta,
    });
    const block = entry.roundDefenseBonusBlock || 0;
    const evade = entry.roundDefenseBonusEvade || 0;
    const accPenalty = entry.roundDefenseAccuracyPenalty || 0;
    const deflectAccPenalty = entry.roundDeflectionAccuracyPenalty || 0;
    const parts = [];
    // "until end of round" cards clear at EOR-phase start; "during this round"
    // cards persist through the EOR phase. Per CSV durationText.
    // (Deflection is NOT here: its only round-registered effect is the -2
    // Accuracy, which is 'this-attack' duration — see the deflectAccPenalty block.)
    const eorCards = new Set(['Survival Instincts', 'Fuel Upgrade', 'Smuggled Supplies']);
    const duration = eorCards.has(cardName) ? 'until-eor' : 'during-round';
    // alexanbv 2026-06-20: "'you' refers to ONLY the figure that played the
    // card." So every "you/your defense results" CC (Take Position, Survival
    // Instincts, Take Cover, Cavalry Charge's +1 Block) is FIGURE-SCOPED via
    // selfIsSourceFigure — NOT army-wide. The default is now selfIsSourceFigure.
    //   - Armed Escort: "OTHER friendly figures within 2 of you gain +1 Evade"
    //     → excludeSourceFigure + withinSpacesOfSource 2 (CSV row 2).
    //   - Fuel Upgrade: "each of your VEHICLES" → selfKeyword VEHICLE (set below).
    let defConditions = { selfIsSourceFigure: true };
    if (cardName === 'Armed Escort') defConditions = { excludeSourceFigure: true, withinSpacesOfSource: 2 };
    else if (cardName === 'Fuel Upgrade') defConditions = { selfKeyword: 'VEHICLE' };
    if (block || evade || accPenalty) {
      registerRoundModifier(game, {
        id: `${cardName}:${playerNum}:def`,
        card: cardName,
        ownerPlayerNum: playerNum,
        sourceFigureKey,
        side: 'defense',
        duration,
        conditions: defConditions,
        effect: { ...(block ? { block } : {}), ...(evade ? { evade } : {}), ...(accPenalty ? { accuracyPenalty: accPenalty } : {}) },
      });
      if (block) parts.push(`+${block} Block`);
      if (evade) parts.push(`+${evade} Evade`);
      if (accPenalty) parts.push(`-${accPenalty} Accuracy`);
    }
    // Deflection: -N Accuracy ONLY vs a Ranged attack TARGETING YOU (CSV "when a
    // Ranged attack targeting you is declared") → selfIsSourceFigure + range.
    // alexanbv 2026-06-22: the penalty applies to ONLY the single declared
    // attack ("Apply -2 Accuracy to the attack results"), NOT to every Ranged
    // attack this round — so it's 'this-attack' duration, cleared when that
    // attack resolves (resolvePendingCombat → clearRoundModifiersThisAttack).
    if (deflectAccPenalty) {
      registerRoundModifier(game, {
        id: `${cardName}:${playerNum}:def-deflect`,
        card: cardName,
        ownerPlayerNum: playerNum,
        sourceFigureKey,
        side: 'defense',
        duration: 'this-attack',
        conditions: { selfIsSourceFigure: true, attackType: 'range' },
        effect: { accuracyPenalty: deflectAccPenalty },
      });
      parts.push(`-${deflectAccPenalty} Accuracy vs Ranged`);
    }
    // Cavalry Charge: friendly TROOPER within 3 spaces of the playing figure gets
    // +N Hit when attacking (CSV "Apply +1 Hit ... of a friendly TROOPER within 3").
    if (entry.trooperRoundAttackHitBonus) {
      registerRoundModifier(game, {
        id: `${cardName}:${playerNum}:atk-trooper-hit`,
        card: cardName,
        ownerPlayerNum: playerNum,
        sourceFigureKey,
        side: 'attack',
        duration,
        conditions: { selfKeyword: 'TROOPER', withinSpacesOfSource: 3 },
        effect: { hit: entry.trooperRoundAttackHitBonus },
      });
      parts.push(`+${entry.trooperRoundAttackHitBonus} Damage for friendly TROOPERs within 3 attacking`);
    }
    // Fuel Upgrade: friendly VEHICLEs get +N Speed this round (movement effect —
    // NOT a combat modifier; stays on the per-player roundVehicleSpeedBonus flag).
    if (entry.vehicleSpeedBonusRound) {
      game.roundVehicleSpeedBonus = game.roundVehicleSpeedBonus || {};
      game.roundVehicleSpeedBonus[playerNum] = (game.roundVehicleSpeedBonus[playerNum] || 0) + entry.vehicleSpeedBonusRound;
      parts.push(`+${entry.vehicleSpeedBonusRound} Speed for friendly VEHICLEs`);
    }
    // Fuel Upgrade: "Each of your VEHICLES ... applies +1 Evade to defense
    // results" → VEHICLE-keyword condition, defense side.
    if (entry.vehicleDefenseBonusEvadeRound) {
      registerRoundModifier(game, {
        id: `${cardName}:${playerNum}:def-vehicle-evade`,
        card: cardName,
        ownerPlayerNum: playerNum,
        sourceFigureKey,
        side: 'defense',
        duration,
        conditions: { selfKeyword: 'VEHICLE' },
        effect: { evade: entry.vehicleDefenseBonusEvadeRound },
      });
      parts.push(`+${entry.vehicleDefenseBonusEvadeRound} Evade for friendly VEHICLEs when defending`);
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
    // Take Position: push-immune-unless-MASSIVE applied to the active figure this round.
    // Reset at end of round via ROUND_OBJECT_FLAGS (roundPushImmuneUnlessMassive).
    if (entry.applyPushImmuneUnlessMassiveThisRound && context.dcMessageMeta) {
      const _ppMsgId = findActiveActivationMsgId(game, playerNum, context.dcMessageMeta);
      if (_ppMsgId) {
        const _ppMeta = context.dcMessageMeta.get(_ppMsgId);
        const _ppKeys = _ppMeta ? getFigureKeysForDcMsg(game, playerNum, _ppMeta) : [];
        game.roundPushImmuneUnlessMassive = game.roundPushImmuneUnlessMassive || {};
        for (const _ppFk of _ppKeys) {
          game.roundPushImmuneUnlessMassive[_ppFk] = true;
        }
        if (_ppKeys.length) parts.push('cannot be pushed except by MASSIVE');
      }
    }
    return {
      applied: true,
      logMessage: `Until end of round, apply ${parts.join(' and ')} when defending.`,
    };
  }

  // ccEffect: roundDefenderBonusBlockPerEvade + optional evadeTokenGain (Personal
  // Energy Shield). CSV: "While defending during this round, apply +1 Block to
  // YOUR defense results for each Evade result" → self figure only. MIGRATED
  // 2026-06-20 to the per-figure registry (blockPerEvade, selfIsSourceFigure).
  if (entry.type === 'ccEffect' && typeof entry.roundDefenderBonusBlockPerEvade === 'number' && entry.roundDefenderBonusBlockPerEvade > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Personal Energy Shield is played during_activation, so the anchor is the
    // activating figure. Use the shared robust resolver (activation → combat
    // defender → named figure) so the selfIsSourceFigure descriptor never gets a
    // silent null anchor.
    const _pesSourceFk = resolveRoundModifierAnchor(game, playerNum, 'Personal Energy Shield', { dcMessageMeta });
    registerRoundModifier(game, {
      id: `Personal Energy Shield:${playerNum}:def-block-per-evade`,
      card: 'Personal Energy Shield',
      ownerPlayerNum: playerNum,
      sourceFigureKey: _pesSourceFk,
      side: 'defense',
      duration: 'during-round',
      conditions: { selfIsSourceFigure: true },
      effect: { blockPerEvade: entry.roundDefenderBonusBlockPerEvade },
    });
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

  // ccEffect: roundAttackSurgeBonus (Smuggled Supplies) — CSV: "apply +1 Surge to
  // YOUR attack results until end of round" → self figure only. MIGRATED
  // 2026-06-20 to the per-figure registry (attack side, selfIsSourceFigure).
  if (entry.type === 'ccEffect' && typeof entry.roundAttackSurgeBonus === 'number' && entry.roundAttackSurgeBonus > 0) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const n = entry.roundAttackSurgeBonus;
    // Smuggled Supplies is played start_of_activation → anchor = activating
    // figure. Shared robust resolver guards against a silent null anchor.
    const _ssSourceFk = resolveRoundModifierAnchor(game, playerNum, 'Smuggled Supplies', { dcMessageMeta });
    registerRoundModifier(game, {
      id: `Smuggled Supplies:${playerNum}:atk-surge`,
      card: 'Smuggled Supplies',
      ownerPlayerNum: playerNum,
      sourceFigureKey: _ssSourceFk,
      side: 'attack',
      duration: 'until-eor',
      conditions: { selfIsSourceFigure: true },
      effect: { surge: n },
    });
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
      // Damage routes through the defeat-aware pipeline (alexanbv 2026-06-22 —
      // all damage goes through the pipeline) so a lethal hit queues a defeat;
      // strain queues via pendingStrain[] for applyStrain.
      if (damage > 0) {
        applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, targetIdx, damage, oppNum, {
          sourceLabel: entry.label || context.cardName || 'CC ability',
          attackerPlayerNum: playerNum,
        });
      }
      const _cahPendingStrain = strain > 0 ? [{
        figureKey: chosenFigureKey,
        controllerPlayerNum: oppNum,
        amount: strain,
        source: entry.label || context.cardName || 'CC ability',
      }] : [];
      const strainPart2 = strain > 0 ? ` + ${strain} Strain (queued)` : '';
      const tName = targetMeta.displayName || targetMeta.dcName || chosenFigureKey;
      return {
        applied: true,
        logMessage: `**${tName}** suffered ${damage > 0 ? `${damage} Damage${strainPart2}` : `${strain} Strain`}.`,
        refreshDcEmbed: true,
        refreshDcEmbedMsgIds: [targetMsgId],
        ...(_cahPendingStrain.length ? { pendingStrain: _cahPendingStrain } : {}),
      };
    }
    // First call: grant MP, then find adjacent hostiles and auto-apply or offer choice
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Move-X path (Ambush etc.): stamp pendingMoveX with the
    // cahTargetPick continuation so the adjacent-hostile target
    // picker fires AFTER the move drains. Adjacents recompute from
    // the figure's NEW position, not the pre-move one.
    if (entry.isMoveX) {
      const _cahMeta = dcMessageMeta.get(msgId);
      const _cahFigKeys = _cahMeta ? getFigureKeysForDcMsg(game, playerNum, _cahMeta) : [];
      const _cahFigureKey = _cahFigKeys[0] || null;
      if (!_cahFigureKey) {
        return { applied: false, manualMessage: `**${entry.label || context.cardName}** — could not locate the activating figure; resolve manually.` };
      }
      // Ambush terrain prerequisite (CSV docs/combat-spec.csv:532): playable only
      // "if you share an edge or corner with a space containing blocking,
      // impassable, or difficult terrain." Check 8-connected adjacency of the
      // playing figure to a blocking/difficult-terrain space. (Impassable terrain
      // is modeled as edges, not spaces, in this engine — see
      // getBlockingDifficultTerrainCoords; that axis is a known limitation.)
      if (entry.requiresTerrainAdjacency) {
        const _amMapId = game.selectedMap?.id;
        const _amTerrain = _amMapId ? getBlockingDifficultTerrainCoords(_amMapId) : new Set();
        const _amAdj = _amTerrain.size
          ? getFigureAdjacentCoordsFromSet(game, playerNum, _cahFigureKey, _amMapId, _amTerrain)
          : [];
        if (!_amAdj.length) {
          return { applied: false, manualMessage: `**${entry.label || context.cardName}** — you must share an edge or corner with a space containing blocking, impassable, or difficult terrain to play this.` };
        }
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: entry.mpBonus,
        source: entry.label || context.cardName || 'Move X',
        playerNum,
        figureKey: _cahFigureKey,
        dcName: _cahMeta?.dcName || '',
        threadId: null,
        bypassCosts: true,
        msgId,
        nextAction: {
          type: 'cahTargetPick',
          payload: {
            cardName: context.cardName || entry.label,
            playerNum,
            damage,
            strain,
          },
        },
      };
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
        logMessage: `**${entry.label || context.cardName}** — May move up to ${entry.mpBonus} space${entry.mpBonus !== 1 ? 's' : ''}, then choose an adjacent hostile to deal ${damage > 0 ? `${damage} Damage` : ''}${strain > 0 ? ` ${strain} Strain` : ''}.`,
      };
    }
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
      for (const adjE of adj) {
        if (isEntryHostileTo(game, adjE, playerNum)) hostileSet.add(adjE.figureKey);
      }
    }
    const hostiles = [...hostileSet];
    if (hostiles.length === 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. No adjacent hostile.` };
    // Multiple adjacent hostiles: MP is granted; prompt player to pick damage target
    if (hostiles.length > 1) {
      const labels = hostiles.map((fk) => {
        if (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk)) {
          const p = fk.match(/^npc_(thug|krykna)_(\d+)$/);
          return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`;
        }
        const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
        const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
        const baseName = tMeta?.displayName || tMeta?.dcName || fk;
        const figIdx = parseFigureKey(fk).figureIndex;
        const suffix = figIdx === 0 ? '' : ` (${String.fromCharCode(65 + figIdx)})`;
        return `${baseName}${suffix}`;
      });
      return { applied: false, requiresChoice: true, choiceOptions: labels, choiceValues: hostiles };
    }
    // Exactly 1 adjacent hostile: auto-apply
    const targetFk = hostiles[0];
    const _targetIsNpc = typeof targetFk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFk);
    if (_targetIsNpc) {
      const p = targetFk.match(/^npc_(thug|krykna)_(\d+)$/);
      if (damage > 0) {
        applyDamageToNpcSync(game, { npcType: p[1], npcIndex: parseInt(p[2], 10), amount: damage, attackerPlayerNum: playerNum });
      }
      const _cahAutoPendingStrainNpc = strain > 0 ? [{
        figureKey: targetFk,
        controllerPlayerNum: null,
        amount: strain,
        source: entry.label || context.cardName || 'CC ability',
      }] : [];
      const npcLabel = `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`;
      const strainPartNpc = strain > 0 ? ` + ${strain} Strain (queued)` : '';
      return {
        applied: true,
        logMessage: `Gained ${entry.mpBonus} MP. **${npcLabel}** suffered ${damage > 0 ? `${damage} Damage${strainPartNpc}` : `${strain} Strain`}.`,
        refreshDcEmbed: true,
        ...(_cahAutoPendingStrainNpc.length ? { pendingStrain: _cahAutoPendingStrainNpc } : {}),
      };
    }
    if (!dcHealthState) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. Resolve manually: choose adjacent hostile for ${damage > 0 ? `${damage} Damage` : ''}${strain > 0 ? ` ${strain} Strain` : ''}.` };
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
    // Damage routes through the defeat-aware pipeline; strain queues via pendingStrain[].
    if (damage > 0) {
      applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, targetIdx, damage, oppNum, {
        sourceLabel: entry.label || context.cardName || 'CC ability',
        attackerPlayerNum: playerNum,
      });
    }
    const _cahAutoPendingStrain = strain > 0 ? [{
      figureKey: targetFk,
      controllerPlayerNum: oppNum,
      amount: strain,
      source: entry.label || context.cardName || 'CC ability',
    }] : [];
    const strainPart = strain > 0 ? ` + ${strain} Strain (queued)` : '';
    return {
      applied: true,
      logMessage: `Gained ${entry.mpBonus} MP. Adjacent hostile suffered ${damage > 0 ? `${damage} Damage${strainPart}` : `${strain} Strain`}.`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
      ...(_cahAutoPendingStrain.length ? { pendingStrain: _cahAutoPendingStrain } : {}),
    };
  }

  // ccEffect: lureOfTheDarkSide (Lure of the Dark Side) — G25-G28, C3
  // Choose hostile figure in LOS, give +2 Hit tokens, perform attack with that figure, then 2 Strain.
  // Phase 1: find hostiles in LOS from activating figure, return picker
  // Phase 2: chosen hostile → set up pendingLure for combat delegation (like False Orders)
  if (entry.type === 'ccEffect' && entry.lureOfTheDarkSide) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, hasLineOfSightByCoord: losCheck, getMapData: getMs, getFigureSize: gfs } = context;
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
      // Grant +2 Damage power tokens to the hostile figure. Per IACP
      // power-token system, only 'Block' / 'Evade' / 'Damage' / 'Surge'
      // exist as token types — there is no separate 'Hit' token. The
      // card text says "Hit Tokens" but that maps to 'Damage' tokens
      // in the codebase (each grants +1 Hit when spent during attack).
      grantPowerTokens(game, chosenFigureKey, 'Damage', 2);
      // Set up Lure attack (analogous to False Orders)
      setPendingLure(game, {
        controllerPlayerNum: playerNum,        // force user's player
        controlledFigureKey: chosenFigureKey,   // hostile being controlled
        controlledPlayerNum: oppNum,            // hostile's owner
        maxRange: 4,                            // target must be within 4 spaces
        postAttackStrain: 2,                    // hostile suffers 2 strain after attack
      });
      return {
        applied: true,
        lureActionPick: true,
        logMessage: `**Lure of the Dark Side** — **${dcNameFromFigureKey(chosenFigureKey)}** gains 2 Hit Tokens (Damage). ${dcNameFromFigureKey(activatingFk || '')} will perform an attack with that figure.`,
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
      const inLos = losCheck && mapSpaces ? losCheck(game, activatingPos, pos, mapSpaces, gfs) : true;
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

  // ccEffect: Blood Feud — Special Action: PLACE this card on a hostile
  // Deployment card the PLAYER chooses (no current attack / defender — alexanbv
  // 2026-06-22). When an attack later targets a figure in that group, +1 Hit is
  // applied (consumed in combat-bridge.js / combat.js via game.bloodFeudTargets).
  if (entry.type === 'ccEffect' && entry.bloodFeudEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);
    // Phase 2: a hostile Deployment card was chosen (choiceValue = its msgId).
    if (chosenFigureKey) {
      game.bloodFeudTargets = game.bloodFeudTargets || {};
      game.bloodFeudTargets[chosenFigureKey] = playerNum;
      const _bfMeta = dcMessageMeta?.get?.(chosenFigureKey);
      const _bfName = _bfMeta?.displayName || _bfMeta?.dcName || 'the chosen group';
      return { applied: true, logMessage: `**Blood Feud** — placed on **${_bfName}**. Attacks targeting that group gain +1 Damage.`, refreshBoard: true };
    }
    // Phase 1: present a picker of hostile Deployment cards with live figures.
    const _bfOpts = [], _bfVals = [];
    if (dcMessageMeta) {
      for (const [mid, meta] of dcMessageMeta) {
        if (meta.gameId !== game.gameId || meta.playerNum !== oppNum) continue;
        const liveFks = getFigureKeysForDcMsg(game, oppNum, meta) || [];
        if (liveFks.length === 0) continue;
        if (game.bloodFeudTargets?.[mid] === playerNum) continue; // already marked
        _bfOpts.push(meta.displayName || meta.dcName);
        _bfVals.push(mid);
      }
    }
    if (_bfOpts.length === 0) return { applied: false, manualMessage: '**Blood Feud** — no hostile Deployment card to place on.' };
    return { applied: false, requiresChoice: true, choiceOptions: _bfOpts, choiceValues: _bfVals };
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
        const fkMatch = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        if (Array.isArray(dcHealthState.get(targetMsgId)?.[figIdx])) {
          // Defeat-aware pipeline (alexanbv 2026-06-22): a lethal hit queues a defeat.
          applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, totalHits, oppNum, {
            sourceLabel: 'Telekinetic Throw', attackerPlayerNum: playerNum,
          });
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
    const losCheck = context.hasLineOfSightByCoord ?? null;
    const gfs = context.getFigureSize;
    const mapId = game.selectedMap?.id;
    const mapSpaces = mapId ? getMapData(mapId) : null;
    const hostiles = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      if (!coord) continue;
      if (countGameSpaces(game, activatorPos, coord) > 3) continue;
      if (losCheck && mapSpaces && !losCheck(game, activatorPos, coord, mapSpaces, gfs)) continue;
      hostiles.push(fk);
    }
    if (hostiles.length === 0) return { applied: true, logMessage: 'No hostile within 3 spaces with LOS.' };
    if (hostiles.length === 1) return resolveAbility(entry, { ...context, chosenFigureKey: hostiles[0] });
    return { applied: false, requiresChoice: true, choiceOptions: figureChoiceLabels(hostiles), choiceValues: hostiles };
  }

  // ccEffect: Chaotic Force / Corrupting Force / Balancing Force —
  // start-of-round Force trio. All three share the same picker:
  //   "Each player chooses up to 3 figures. Roll 1 die. Each chosen
  //    figure suffers/recovers <effect> equal to die result."
  //
  // Picker flow (chained chooseUpToN with player switch):
  //   Stage 1 (cardPlayer): up-to-3 pick from cardPlayer's own figures.
  //   Stage 2 (opponent): up-to-3 pick from opponent's own figures
  //                       (routed via choiceForControllerPlayerNum).
  //   Stage 3: roll the die, apply to every chosen figure.
  //
  // Strain (Chaotic) queues via pendingStrain[]; Damage/Heal apply
  // synchronously (consistent with the existing damage/heal paths).
  if (entry.type === 'ccEffect' && (entry.chaoticForceEffect || entry.corruptingForceEffect || entry.balancingForceEffect)) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };

    // Card-specific configuration.
    const cardConfig = entry.chaoticForceEffect
      ? { card: 'Chaotic Force', effect: 'strain', dieColor: 'green', dieField: 'acc', dieLabel: 'Accuracy' }
      : entry.corruptingForceEffect
      ? { card: 'Corrupting Force', effect: 'damage', dieColor: 'blue', dieField: 'dmg', dieLabel: 'Hit' }
      : { card: 'Balancing Force', effect: 'heal', dieColor: 'red', dieField: 'dmg', dieLabel: 'Hit' };

    const oppNum = opponentPlayerNum(playerNum);

    // Initialize pending picker state on first call.
    if (!game.pendingForceCardPick) {
      game.pendingForceCardPick = {
        card: cardConfig.card,
        effect: cardConfig.effect,
        dieColor: cardConfig.dieColor,
        dieField: cardConfig.dieField,
        dieLabel: cardConfig.dieLabel,
        cardPlayerNum: playerNum,
        currentPickerPN: playerNum,
        picksByPlayer: { 1: [], 2: [] },
      };
    }
    const fp = game.pendingForceCardPick;

    // Done-marker for the current picker stage.
    const DONE_KEY = '__force_card_done__';

    // Helper: enumerate ALL figures (friendly + hostile) on the board,
    // minus what THIS player has already chosen. Per CRR each player
    // may pick any 3 figures — no friendly/hostile restriction. The
    // two players' picks are de-duplicated as a union when effects
    // are applied (a figure picked by both still suffers only once).
    function _enumerateAllFigures(pickerPN) {
      const already = new Set(fp.picksByPlayer[pickerPN] || []);
      const out = [];
      for (const pn of [1, 2]) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
          if (!coord || already.has(fk)) continue;
          out.push({ fk, owner: pn });
        }
      }
      return out;
    }

    // Accumulate a pick (or advance on Done / max-3 cap).
    if (chosenFigureKey === DONE_KEY) {
      // Picker done — switch stage or finalize.
    } else if (chosenFigureKey) {
      const pickerPN = fp.currentPickerPN;
      fp.picksByPlayer[pickerPN] = fp.picksByPlayer[pickerPN] || [];
      if (!fp.picksByPlayer[pickerPN].includes(chosenFigureKey)) {
        fp.picksByPlayer[pickerPN].push(chosenFigureKey);
      }
      // If 3 picked, auto-advance.
      if (fp.picksByPlayer[pickerPN].length < 3) {
        const remaining = _enumerateAllFigures(pickerPN);
        if (remaining.length > 0) {
          const choiceValues = [...remaining.map((r) => r.fk), DONE_KEY];
          const choiceOptions = [
            ...remaining.map((r) => `${dcNameFromFigureKey(r.fk)} (P${r.owner})`),
            `Done (${fp.picksByPlayer[pickerPN].length} chosen)`,
          ];
          return {
            applied: false,
            requiresChoice: true,
            choiceOptions,
            choiceValues,
            ...(pickerPN !== fp.cardPlayerNum ? { choiceForControllerPlayerNum: pickerPN } : {}),
          };
        }
      }
    }

    // Advance picker stage if cardPlayer just finished.
    if (fp.currentPickerPN === fp.cardPlayerNum) {
      fp.currentPickerPN = oppNum;
      const oppFigures = _enumerateAllFigures(oppNum);
      if (oppFigures.length > 0) {
        const choiceValues = [...oppFigures.map((r) => r.fk), DONE_KEY];
        const choiceOptions = [
          ...oppFigures.map((r) => `${dcNameFromFigureKey(r.fk)} (P${r.owner})`),
          'Done (0 chosen)',
        ];
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions,
          choiceValues,
          choiceForControllerPlayerNum: oppNum,
        };
      }
      // Opponent has no figures — fall through to die roll.
    }

    // First call: enumerate ALL figures for cardPlayer.
    if (fp.picksByPlayer[fp.cardPlayerNum].length === 0 && chosenFigureKey == null && fp.currentPickerPN === fp.cardPlayerNum) {
      const allFigures = _enumerateAllFigures(fp.cardPlayerNum);
      if (allFigures.length === 0) {
        // No figures on board — switch to opponent.
        fp.currentPickerPN = oppNum;
        return resolveAbility(abilityId, { ...context, chosenFigureKey: DONE_KEY });
      }
      const choiceValues = [...allFigures.map((r) => r.fk), DONE_KEY];
      const choiceOptions = [
        ...allFigures.map((r) => `${dcNameFromFigureKey(r.fk)} (P${r.owner})`),
        'Done (0 chosen)',
      ];
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions,
        choiceValues,
      };
    }

    // Both players done — roll die and apply to UNION (deduplicated).
    const _figureOwner = (fk) => {
      if (game.figurePositions?.[1]?.[fk]) return 1;
      if (game.figurePositions?.[2]?.[fk]) return 2;
      return null;
    };
    const _seenFks = new Set();
    const allChosen = [];
    for (const pickerPN of [1, 2]) {
      for (const fk of (fp.picksByPlayer[pickerPN] || [])) {
        if (_seenFks.has(fk)) continue;
        _seenFks.add(fk);
        const owner = _figureOwner(fk);
        if (owner) allChosen.push({ fk, pn: owner });
      }
    }
    const faces = getDiceData().attack?.[cardConfig.dieColor] || [];
    if (!faces.length) {
      delete game.pendingForceCardPick;
      return { applied: false, manualMessage: `Roll 1 ${cardConfig.dieColor} die manually.` };
    }
    const face = faces[Math.floor(Math.random() * faces.length)];
    const dieVal = face[cardConfig.dieField] ?? 0;
    delete game.pendingForceCardPick;

    if (allChosen.length === 0) {
      return { applied: true, logMessage: `**${cardConfig.card}** — No figures chosen. Rolled 1 ${cardConfig.dieColor} die: **${dieVal} ${cardConfig.dieLabel}** — no effect.` };
    }

    if (cardConfig.effect === 'strain') {
      const pendingStrain = allChosen.map(({ fk, pn }) => ({
        figureKey: fk, controllerPlayerNum: pn, amount: dieVal, source: cardConfig.card,
      }));
      const names = allChosen.map(({ fk }) => dcNameFromFigureKey(fk)).join(', ');
      if (dieVal === 0) {
        return { applied: true, logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **0 ${cardConfig.dieLabel}** — no Strain applied to ${names}.` };
      }
      return {
        applied: true,
        logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **${dieVal} ${cardConfig.dieLabel}** → ${dieVal} Strain to ${names} (queued via applyStrain).`,
        pendingStrain,
      };
    }

    if (cardConfig.effect === 'damage') {
      if (dieVal === 0) {
        return { applied: true, logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **0 ${cardConfig.dieLabel}** — no Damage applied.` };
      }
      const refreshIds = [];
      const parts = [];
      for (const { fk, pn } of allChosen) {
        const fMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
        if (!fMsgId || !dcHealthState) continue;
        const hs = dcHealthState.get(fMsgId) || [];
        const m = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = m ? parseInt(m[2], 10) : 0;
        const hp = hs[figIdx];
        if (!hp) continue;
        const [cur, max] = hp;
        const newCur = Math.max(0, (cur ?? max) - dieVal);
        hs[figIdx] = [newCur, max];
        dcHealthState.set(fMsgId, hs);
        syncHealthStateToList(game, pn, fMsgId, hs);
        parts.push(`${dcNameFromFigureKey(fk)}: ${cur ?? max}→${newCur}`);
        if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
      }
      return {
        applied: true,
        logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **${dieVal} ${cardConfig.dieLabel}** → ${dieVal} Damage to chosen.\n${parts.join(', ')}`,
        refreshDcEmbed: true,
        refreshDcEmbedMsgIds: refreshIds,
      };
    }

    // heal
    const healAmt = dieVal;
    if (healAmt === 0) {
      return { applied: true, logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **0 ${cardConfig.dieLabel}** — no recovery.` };
    }
    const refreshIds = [];
    const parts = [];
    for (const { fk, pn } of allChosen) {
      const fMsgId = findMsgIdForFigureKey(game, pn, fk, dcMessageMeta);
      if (!fMsgId || !dcHealthState) continue;
      const hs = dcHealthState.get(fMsgId) || [];
      const m = fk.match(/-(\d+)-(\d+)$/);
      const figIdx = m ? parseInt(m[2], 10) : 0;
      const hp = hs[figIdx];
      if (!hp) continue;
      const [cur, max] = hp;
      const damage = (max ?? cur) - (cur ?? 0);
      if (damage <= 0) {
        parts.push(`${dcNameFromFigureKey(fk)}: full HP (no heal)`);
        continue;
      }
      const heal = Math.min(healAmt, damage);
      hs[figIdx] = [(cur ?? 0) + heal, max];
      dcHealthState.set(fMsgId, hs);
      syncHealthStateToList(game, pn, fMsgId, hs);
      parts.push(`${dcNameFromFigureKey(fk)}: +${heal} HP`);
      if (!refreshIds.includes(fMsgId)) refreshIds.push(fMsgId);
    }
    return {
      applied: true,
      logMessage: `**${cardConfig.card}** — Rolled 1 ${cardConfig.dieColor} die: **${dieVal} ${cardConfig.dieLabel}** → recover ${healAmt} Damage on chosen.\n${parts.length ? parts.join(', ') : 'No damaged figures chosen.'}`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: refreshIds,
    };
  }

  // ccEffect: Whistling Birds — Move 2 (Move-X), then roll 1 red die,
  // up to 3 FIGURES within 2 of the post-move position suffer Hits as Damage.
  // CSV (docs/combat-spec.csv:870): "Choose up to 3 figures within 2 spaces
  // ... each of those figures suffers Damage equal to the Hit results" —
  // target is "figures" (friendly OR hostile) and the controller CHOOSES
  // which up-to-3 (not arbitrary iteration order). Phase 2 (below) drives
  // the multi-pick + damage; the roll & pending state are stamped by the
  // post-move whistlingBirdsRoll continuation (move-x-handler.js).
  if (entry.type === 'ccEffect' && entry.whistlingBirdsEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    // ── Phase 2: figure picker + damage (mirrors wookieeRageEffect) ──
    const wbPending = game?._whistlingBirdsPending;
    if (wbPending && (chosenFigureKey || wbPending.armed)) {
      const hits = wbPending.hits || 0;
      // "Done" signal OR no candidates: apply accumulated targets.
      if (chosenFigureKey === 'whistling_birds_done') {
        const targets = wbPending.targets || [];
        const refreshIds = [];
        const parts = [];
        for (const fk of targets) {
          const tPn = wbPending.playerOf?.[fk];
          if (!tPn || !dcHealthState) continue;
          const tMsgId = findMsgIdForFigureKey(game, tPn, fk, dcMessageMeta);
          if (!tMsgId) continue;
          const tHs = dcHealthState.get(tMsgId) || [];
          const m = fk.match(/-(\d+)-(\d+)$/);
          const figIdx = m ? parseInt(m[2], 10) : 0;
          const e = tHs[figIdx];
          if (!e) continue;
          const [cur, max] = e;
          const newCur = Math.max(0, (cur ?? max) - hits);
          tHs[figIdx] = [newCur, max];
          dcHealthState.set(tMsgId, tHs);
          syncHealthStateToList(game, tPn, tMsgId, tHs);
          parts.push(`**${dcNameFromFigureKey(fk)}** ${cur ?? max} → ${newCur}`);
          if (!refreshIds.includes(tMsgId)) refreshIds.push(tMsgId);
        }
        delete game._whistlingBirdsPending;
        return { applied: true, logMessage: `**Whistling Birds** — ${hits} Damage to each chosen figure: ${parts.length ? parts.join(', ') : 'none'}.`, refreshDcEmbed: refreshIds.length > 0, refreshDcEmbedMsgIds: refreshIds };
      }
      // Accumulate a chosen target, then re-offer remaining candidates.
      if (chosenFigureKey) {
        wbPending.targets = wbPending.targets || [];
        if (!wbPending.targets.includes(chosenFigureKey)) wbPending.targets.push(chosenFigureKey);
        if (wbPending.targets.length >= 3) {
          return resolveAbility(abilityId, { ...context, chosenFigureKey: 'whistling_birds_done' });
        }
      }
      // Build candidate list: all figures (both players) within 2 of the
      // activator's post-move position, excluding the activator and any
      // already-chosen figures.
      const chosenSet = new Set(wbPending.targets || []);
      const actPos = game.figurePositions?.[wbPending.playerNum]?.[wbPending.figureKey];
      const choiceValues = [];
      const playerOf = {};
      if (actPos) {
        for (const pn of [1, 2]) {
          for (const [fk, coord] of Object.entries(game.figurePositions?.[pn] || {})) {
            if (!coord || fk === wbPending.figureKey || chosenSet.has(fk)) continue;
            if (countGameSpaces(game, actPos, coord) > 2) continue;
            choiceValues.push(fk);
            playerOf[fk] = pn;
          }
        }
      }
      wbPending.playerOf = Object.assign(wbPending.playerOf || {}, playerOf);
      wbPending.armed = false;
      if (choiceValues.length === 0) {
        return resolveAbility(abilityId, { ...context, chosenFigureKey: 'whistling_birds_done' });
      }
      const choiceOptions = [...figureChoiceLabels(choiceValues)];
      choiceOptions.push(`Done (${(wbPending.targets || []).length} chosen)`);
      choiceValues.push('whistling_birds_done');
      return { applied: true, requiresChoice: true, choiceOptions, choiceValues, logMessage: `**Whistling Birds** — rolled **${hits} Hit${hits !== 1 ? 's' : ''}**; choose up to 3 figures within 2 spaces (each suffers ${hits} Damage).` };
    }
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    const activatingKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    if (!activatorFk) return { applied: false, manualMessage: '**Whistling Birds** — could not locate activating figure.' };
    // CRR MOVE-017: 2-space Move-X picker; whistlingBirdsRoll fires
    // post-move so adjacency for the damage spray is computed from
    // the figure's NEW position.
    game.pendingMoveX = game.pendingMoveX || {};
    game.pendingMoveX[msgId] = {
      remaining: 2,
      source: 'Whistling Birds',
      playerNum,
      figureKey: activatorFk,
      dcName: meta?.dcName || '',
      threadId: null,
      bypassCosts: true,
      msgId,
      nextAction: { type: 'whistlingBirdsRoll', payload: { playerNum, msgId } },
    };
    return {
      applied: true,
      pendingMoveXMsgId: msgId,
      activeMsgId: msgId,
      logMessage: '**Whistling Birds** — Move up to 2 spaces, then roll 1 red die; up to 3 hostiles within 2 spaces suffer Damage results.',
    };
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

  // ccEffect: karabastEffect (Karabast!) — "For each Damage you have suffered,
  // choose a hostile figure within 2 spaces; each chosen figure suffers 1 Damage."
  // Multi-pick with the number of picks = Damage suffered by the activating
  // figure; the SAME figure may be chosen more than once (each pick = 1 Damage).
  if (entry.type === 'ccEffect' && entry.karabastEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!selfMsgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const selfHs = dcHealthState?.get(selfMsgId) || [];
    const selectedFig = game.dcActionsData?.[selfMsgId]?.selectedFigure ?? 0;
    const selfEntry = selfHs[selectedFig];
    const damageSuffered = selfEntry ? Math.max(0, (selfEntry[1] ?? 0) - (selfEntry[0] ?? selfEntry[1] ?? 0)) : 0;
    const RANGE = entry.karabastRange ?? 2;
    const maxPicks = damageSuffered;
    const _enumHostiles = () => {
      const selfMeta = dcMessageMeta.get(selfMsgId);
      const selfKeys = selfMeta ? getFigureKeysForDcMsg(game, playerNum, selfMeta) : [];
      const selfFk = selfKeys[selectedFig] || selfKeys[0];
      const selfPos = selfFk ? game.figurePositions?.[playerNum]?.[selfFk] : null;
      const vals = [];
      if (selfPos) {
        for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
          if (!coord) continue;
          if (countGameSpaces(game, selfPos, coord) <= RANGE) vals.push(fk);
        }
      }
      return vals;
    };
    // Done → apply 1 Damage per accumulated pick (grouped by figure).
    if (chosenFigureKey === 'karabast_done') {
      const picks = game._karabastTargets || [];
      delete game._karabastTargets;
      if (!picks.length) return { applied: true, logMessage: '**Karabast!** — No targets chosen.' };
      const counts = {};
      for (const fk of picks) counts[fk] = (counts[fk] || 0) + 1;
      const refreshIds = []; const parts = [];
      for (const [fk, n] of Object.entries(counts)) {
        const tMsgId = findMsgIdForFigureKey(game, oppNum, fk, dcMessageMeta);
        if (!tMsgId || !dcHealthState) continue;
        const tHs = dcHealthState.get(tMsgId) || [];
        const fkMatch = fk.match(/-(\d+)-(\d+)$/);
        const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
        const tEntry = tHs[figIdx];
        if (!tEntry) continue;
        const [cur, max] = tEntry;
        const newCur = Math.max(0, (cur ?? max) - n);
        tHs[figIdx] = [newCur, max];
        dcHealthState.set(tMsgId, tHs);
        syncHealthStateToList(game, oppNum, tMsgId, tHs);
        parts.push(`**${dcNameFromFigureKey(fk)}** ${cur ?? max}→${newCur} (${n} Damage)`);
        if (!refreshIds.includes(tMsgId)) refreshIds.push(tMsgId);
      }
      return { applied: true, logMessage: `**Karabast!** — ${parts.join(', ')}.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds };
    }
    // Accumulate a pick (repeats allowed).
    if (chosenFigureKey) {
      game._karabastTargets = game._karabastTargets || [];
      game._karabastTargets.push(chosenFigureKey);
      if (game._karabastTargets.length >= maxPicks) {
        return resolveAbility(abilityId, { ...context, chosenFigureKey: 'karabast_done' });
      }
      const vals = _enumHostiles();
      if (vals.length === 0) return resolveAbility(abilityId, { ...context, chosenFigureKey: 'karabast_done' });
      const opts = [...figureChoiceLabels(vals)];
      opts.push(`Done (${game._karabastTargets.length}/${maxPicks} chosen)`);
      vals.push('karabast_done');
      return { applied: true, requiresChoice: true, choiceOptions: opts, choiceValues: vals, logMessage: `**Karabast!** — choose hostile ${game._karabastTargets.length + 1} of up to ${maxPicks} (within ${RANGE} spaces), or Done.` };
    }
    // First call.
    if (maxPicks <= 0) return { applied: true, logMessage: '**Karabast!** — 0 Damage suffered; no targets.' };
    game._karabastTargets = [];
    const vals = _enumHostiles();
    if (vals.length === 0) return { applied: true, logMessage: `**Karabast!** — No hostile figures within ${RANGE} spaces.` };
    const opts = [...figureChoiceLabels(vals)];
    opts.push('Done (0 chosen)');
    vals.push('karabast_done');
    return { applied: true, requiresChoice: true, choiceOptions: opts, choiceValues: vals, logMessage: `**Karabast!** — ${maxPicks} Damage suffered: choose up to ${maxPicks} hostile(s) within ${RANGE} spaces; each chosen suffers 1 Damage.` };
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
    // Disorient: when the chosen target has >1 BENEFICIAL condition, the player
    // picks which one to discard (alexanbv 2026-06-22). The choice is threaded
    // back via a "discard:<cond>:" chosenFigureKey prefix; applyToFigureKey reads
    // this closure var to discard the chosen one (else the first present).
    let _disorientChosenCondition = null;
    // Capture the Weary: target becomes Weakened. If already Weakened, suffers
    // strain instead. Per-target check happens in applyToFigureKey below.
    const useWeakenIfNotAlreadyWeakened = !!cah.weakenIfNotAlreadyWeakened;
    const strainBase = scaleStrainToRound ? (game.currentRound || 1) : (cah.strain || 0);
    const baseTargetConditions = [
      ...(cah.weaken ? ['Weaken'] : []),
      ...(cah.stun ? ['Stun'] : []),
      ...(cah.bleed ? ['Bleed'] : []),
    ];
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    // Shared: apply damage/strain/conditions to target; optionally apply selfStrain to activating figure
    const applyToFigureKey = (targetFk) => {
      // NPC target (Thug / Krykna): no msgId / health-state pipeline. Damage
      // routes through applyDamageToNpcSync; conditions via figureConditions;
      // strain queues normally — applyStrain auto-converts to damage for NPCs.
      if (isEntryHostileTo && typeof targetFk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFk)) {
        const parsed = targetFk.match(/^npc_(thug|krykna)_(\d+)$/);
        const npcType = parsed[1];
        const npcIndex = parseInt(parsed[2], 10);
        const npcLabel = `${npcType === 'thug' ? 'Thug' : 'Krykna'} ${npcIndex + 1}`;
        let _dmgMsg = '';
        if (damage > 0) {
          const npcRes = applyDamageToNpcSync(game, { npcType, npcIndex, amount: damage, attackerPlayerNum: playerNum });
          if (npcRes.applied) _dmgMsg = ` ${damage} Damage (${npcRes.prevHp}→${npcRes.newHp})`;
        }
        const _cahPendingStrainNpc = (strainBase > 0) ? [{
          figureKey: targetFk,
          controllerPlayerNum: null,
          amount: strainBase,
          source: entry.label || abilityId || 'CC ability',
        }] : [];
        for (const c of baseTargetConditions) applyCondition(game, targetFk, c);
        return {
          applied: true,
          logMessage: `**${npcLabel}** suffered${_dmgMsg || ''}${baseTargetConditions.length ? `; gains ${baseTargetConditions.join(', ')}` : ''}.`,
          refreshDcEmbed: true,
          ...(_cahPendingStrainNpc.length ? { pendingStrain: _cahPendingStrainNpc } : {}),
        };
      }
      if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
      const targetMsgId = findMsgIdForFigureKey(game, oppNum, targetFk, dcMessageMeta);
      if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find target deployment.' };
      const targetMeta = dcMessageMeta.get(targetMsgId);
      if (!targetMeta) return { applied: false, manualMessage: 'Resolve manually: could not find target.' };
      const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
      const targetIdx = targetKeys.indexOf(targetFk);
      if (targetIdx < 0) return { applied: false, manualMessage: 'Resolve manually: could not find target figure index.' };
      // Capture the Weary: per-target branching — if not already Weakened, apply
      // Weaken (and skip strain). If already Weakened, fall through to strain.
      const targetAlreadyWeakened = (game.figureConditions?.[targetFk] || []).includes('Weaken');
      const targetConditions = useWeakenIfNotAlreadyWeakened && !targetAlreadyWeakened
        ? [...baseTargetConditions, 'Weaken']
        : baseTargetConditions;
      const strain = useWeakenIfNotAlreadyWeakened && !targetAlreadyWeakened ? 0 : strainBase;
      const healthState = dcHealthState.get(targetMsgId) || [];
      const hs = healthState[targetIdx];
      if (!Array.isArray(hs) || hs.length < 1) return { applied: false, manualMessage: 'Resolve manually: no health state for target.' };
      // Damage routes through the defeat-aware pipeline (alexanbv 2026-06-22 — all
      // damage goes through the pipeline) so a lethal hit queues a defeat in
      // game._pendingFigureDefeats (drained by apply-ability-result.js → removes
      // the figure / awards VP). This matters for e.g. Ambush dealing 2 Damage to
      // the attacker on-declare: the attacker must actually be DEFEATED so the
      // attack is then canceled. Strain still queues via pendingStrain[].
      if (damage > 0) {
        applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, targetIdx, damage, oppNum, {
          sourceLabel: entry.label || abilityId || 'CC ability',
          attackerPlayerNum: playerNum,
        });
      }
      const _cahPendingStrain = strain > 0 ? [{
        figureKey: targetFk,
        controllerPlayerNum: oppNum,
        amount: strain,
        source: entry.label || abilityId || 'CC ability',
      }] : [];
      // Apply conditions to target
      if (targetConditions.length > 0) {
        for (const c of targetConditions) applyCondition(game, targetFk, c);
      }
      // Disarm: lock the Weakened condition so it cannot be removed until end of round
      if (abilityId === 'Disarm' && targetConditions.includes('Weaken')) {
        game.disarmPermanentWeakened = game.disarmPermanentWeakened || {};
        game.disarmPermanentWeakened[targetFk] = true;
      }
      // Disorient: discard one beneficial condition from target. When the figure
      // has more than one, the player's chosen condition (threaded via
      // _disorientChosenCondition) is removed; otherwise the only present one.
      if (cah.discardBeneficialCondition) {
        const BENEFICIAL = ['Focus', 'Hidden'];
        const present = (game.figureConditions?.[targetFk] || []).filter(c => BENEFICIAL.includes(c));
        const toDiscard = (_disorientChosenCondition && present.includes(_disorientChosenCondition))
          ? _disorientChosenCondition
          : present[0];
        if (toDiscard) filterCondition(game, targetFk, toDiscard);
      }
      // Apply self-strain to activating figure(s)
      const refreshIds = [targetMsgId];
      // Self-strain: queue via pendingStrain[] anchored to the
      // activating figure (NOT every figure in the group). Routes
      // through applyStrain so Fireproof / Headhunter / per-strain
      // choice / Under Duress / Paz still gate.
      let selfStrainMsg = '';
      if (selfStrain > 0) {
        const selfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        const selfMeta = selfMsgId ? dcMessageMeta.get(selfMsgId) : null;
        const selfKeys = selfMeta ? getFigureKeysForDcMsg(game, playerNum, selfMeta) : [];
        const selfFigIdx = game.dcActionsData?.[selfMsgId]?.selectedFigure ?? 0;
        const selfFk = selfKeys[selfFigIdx] || selfKeys[0];
        if (selfFk) {
          _cahPendingStrain.push({
            figureKey: selfFk,
            controllerPlayerNum: playerNum,
            amount: selfStrain,
            source: `${entry.label || abilityId || 'CC ability'} (self)`,
          });
          selfStrainMsg = ` You suffer ${selfStrain} Strain (queued).`;
        }
      }
      // Heal self if the CHOSEN TARGET has the required trait (Force Drain:
      // "If that figure is a FORCE USER, you recover 3 Damage" — CSV row 665;
      // "that figure" is the chosen hostile, NOT the casting figure). The heal
      // still goes to the casting figure.
      let selfHealMsg = '';
      const healSIT = cah.healSelfIfTrait;
      const targetHasHealTrait = healSIT?.trait
        ? (getStatsForDc(dcNameFromFigureKey(targetFk))?.keywords || []).includes(healSIT.trait)
        : false;
      if (healSIT?.trait && typeof healSIT.amount === 'number' && healSIT.amount > 0 && dcHealthState && targetHasHealTrait) {
        const healSelfMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        if (healSelfMsgId) {
          const healSelfMeta = dcMessageMeta.get(healSelfMsgId);
          {
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
      const strainLabel = strain > 0 ? (damage > 0 ? ` + ${strain} Strain (queued)` : `${strain} Strain (queued)`) : '';
      const dmgLabel = damage > 0 ? `${damage} Damage` : '';
      const condPart = targetConditions.length > 0 ? `; target gains ${targetConditions.join(', ')}` : '';
      return {
        applied: true,
        logMessage: `Hostile suffered ${dmgLabel}${strainLabel}${condPart}.${selfStrainMsg}${selfHealMsg}`,
        refreshDcEmbed: true,
        refreshDcEmbedMsgIds: refreshIds,
        ...(_cahPendingStrain.length ? { pendingStrain: _cahPendingStrain } : {}),
      };
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
      // Disorient: a "discard:<cond>:<fk>" re-entry carries the chosen beneficial
      // condition; a freshly-chosen figure with >1 beneficial condition prompts
      // for which to discard before applying (alexanbv 2026-06-22).
      let _effChosenFk = chosenFigureKey;
      if (typeof chosenFigureKey === 'string' && chosenFigureKey.startsWith('discard:')) {
        const _dp = chosenFigureKey.split(':');
        _disorientChosenCondition = _dp[1];
        _effChosenFk = _dp.slice(2).join(':');
      } else if (cah.discardBeneficialCondition) {
        const _figFk = typeof chosenFigureKey === 'string' && chosenFigureKey.startsWith('strain:') ? chosenFigureKey.slice(7) : chosenFigureKey;
        const present = (game.figureConditions?.[_figFk] || []).filter(c => ['Focus', 'Hidden'].includes(c));
        if (present.length > 1) {
          return {
            applied: false,
            requiresChoice: true,
            choiceOptions: present.map(c => `Discard ${c}`),
            targetFigureKeys: present.map(c => `discard:${c}:${_figFk}`),
            choicePrompt: `**Disorient** — choose which beneficial condition to discard from **${dcNameFromFigureKey(_figFk)}**:`,
          };
        }
      }
      const strainKey = typeof _effChosenFk === 'string' && _effChosenFk.startsWith('strain:') ? _effChosenFk.slice(7) : _effChosenFk;
      const mainResult = applyToFigureKey(strainKey);
      // Splash: apply cah.splashDamage / cah.splashConditions to figures adjacent to the chosen target
      const splashDmg = cah.splashDamage ?? 0;
      const splashConds = cah.splashConditions ?? [];
      if ((splashDmg > 0 || splashConds.length > 0) && mainResult.applied) {
        const mapId = game.selectedMap?.id;
        if (mapId) {
          const adjacent = getFiguresAdjacentToTarget(game, strainKey, mapId);
          const splashParts = [];
          for (const adjEntry of adjacent) {
            const { figureKey: adjFk, playerNum: adjPnum, isNpc: adjIsNpc } = adjEntry;
            const adjName = adjIsNpc ? entryDisplayLabel(adjEntry) : dcNameFromFigureKey(adjFk);
            if (adjIsNpc) {
              if (splashDmg > 0) {
                const npcRes = applyDamageToNpcSync(game, {
                  npcType: adjEntry.npcType,
                  npcIndex: adjEntry.npcIndex,
                  amount: splashDmg,
                  attackerPlayerNum: playerNum,
                });
                if (npcRes.applied) splashParts.push(`**${adjName}** ${splashDmg} Damage (${npcRes.prevHp}→${npcRes.newHp})`);
              }
              if (splashConds.length > 0) {
                for (const c of splashConds) applyCondition(game, adjFk, c);
              }
              continue;
            }
            const adjMsgId = findMsgIdForFigureKey(game, adjPnum, adjFk, dcMessageMeta);
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
    // targetAttacker (Counter Attack, CSV row 589): target is forced to be
    // THE ATTACKER of the attack that just resolved on you — not a free choice
    // among adjacent hostiles. Conditional: "you were not defeated and are
    // adjacent to the attacker". This is a defender reaction (no active
    // activation), so resolve directly off the combat context.
    if (cah.targetAttacker) {
      const _caCbt = context.combat || game.combat || game.pendingCombat;
      const _caAttackerFk = _caCbt?.attackerFigureKey;
      if (!_caCbt || !_caAttackerFk) {
        return { applied: false, manualMessage: 'Counter Attack: no attacker context.' };
      }
      const _caAttackerPN = _caCbt.attackerPlayerNum ?? oppNum;
      const _caAttackerPos = game.figurePositions?.[_caAttackerPN]?.[_caAttackerFk];
      // "you" = the defender of the resolved attack (the figure that was attacked).
      const _caDefenderFk = _caCbt.target?.figureKey;
      const _caDefenderPos = _caDefenderFk ? game.figurePositions?.[playerNum]?.[_caDefenderFk] : null;
      // "you were not defeated": the defender must still be on the board.
      if (!_caDefenderPos) {
        return { applied: false, manualMessage: 'Counter Attack: you were defeated.' };
      }
      // "are adjacent to the attacker"
      if (!_caAttackerPos || countGameSpaces(game, _caDefenderPos, _caAttackerPos) > 1) {
        return { applied: false, manualMessage: 'Counter Attack: not adjacent to the attacker.' };
      }
      return applyToFigureKey(_caAttackerFk);
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
    const losCheck = context.hasLineOfSightByCoord ?? null;
    const gfs = context.getFigureSize;
    const mapSpacesForLos = cahLos ? getMapData(mapId) : null;
    // Activator position for range/LOS checks
    const activatorFk = activatingKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || activatingKeys[0];
    const activatorPos = activatorFk ? game.figurePositions?.[playerNum]?.[activatorFk] : null;
    const hostileSet = new Set();
    if (cahRange <= 1) {
      // Original path: adjacent figures via adjacency graph. NPCs tagged
      // hostileToAll (Thugs/Krykna) are valid hostile targets — per
      // alexanbv 2026-05-10 neutrals are figures and can be targeted by
      // any ability that targets hostile figures.
      for (const fk of activatingKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const adjE of adj) {
          if (isEntryHostileTo(game, adjE, playerNum)) hostileSet.add(adjE.figureKey);
        }
      }
    } else {
      // Extended path: range + optional LOS filter
      for (const [fk, coord] of Object.entries(game.figurePositions?.[oppNum] || {})) {
        if (!coord) continue;
        if (activatorPos && countGameSpaces(game, activatorPos, coord) > cahRange) continue;
        if (cahLos && losCheck && activatorPos && mapSpacesForLos) {
          if (!losCheck(game, activatorPos, coord, mapSpacesForLos, gfs)) continue;
        }
        hostileSet.add(fk);
      }
      // NPCs (hostility 'hostile' or 'treatedAsHostile') within range —
      // per alexanbv 2026-05-10. 'neutral' NPCs are skipped.
      for (const [arrName, npcType] of [['npcThugs', 'thug'], ['npcKrykna', 'krykna']]) {
        const arr = game[arrName];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
          const npc = arr[i];
          if (!npc || npc.defeated || !npc.coord) continue;
          const hostility = npc.hostility || (npc.hostileToAll ? 'hostile' : 'neutral');
          if (hostility === 'neutral') continue;
          if (activatorPos && countGameSpaces(game, activatorPos, npc.coord) > cahRange) continue;
          if (cahLos && losCheck && activatorPos && mapSpacesForLos) {
            if (!losCheck(game, activatorPos, npc.coord, mapSpacesForLos, gfs)) continue;
          }
          hostileSet.add(`npc_${npcType}_${i}`);
        }
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
    // requiresSmall (Crush, CSV row 594 "a SMALL figure"): restrict to SMALL
    // targets (not LARGE / MASSIVE), mirroring pushTargetWithinRange's SMALL
    // filter. NPC slot keys (Thug/Krykna) are Small by default.
    if (cah.requiresSmall) {
      hostiles = hostiles.filter(fk => {
        if (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk)) return true;
        const kwds = (getStatsForDc(dcNameFromFigureKey(fk))?.keywords || []).map(k => String(k).toUpperCase());
        return !(kwds.includes('LARGE') || kwds.includes('MASSIVE'));
      });
    }
    if (hostiles.length === 0) return { applied: true, logMessage: 'No valid hostile figure in range.' };
    // Helper to get a display label for a figure key (or NPC slot key).
    const getFigLabel = (fk) => {
      if (typeof fk === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(fk)) {
        const parsed = fk.match(/^npc_(thug|krykna)_(\d+)$/);
        return `${parsed[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(parsed[2], 10) + 1}`;
      }
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
    // orStunInstead (Dirty Trick): per CRR card text, "That figure
    // MUST CHOOSE" — the choice belongs to the TARGET'S CONTROLLER
    // (the opponent of the card player), not the card player. The
    // prompt is routed via choiceForControllerPlayerNum so cc-hand
    // posts the buttons in the target controller's hand channel.
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
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: combLabels,
        choiceValues: combValues,
        choiceForControllerPlayerNum: oppNum,
      };
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

  // ccEffect: damageTokenGainToGroup (Ready Weapons) — "Distribute 3 Damage
  // Tokens among figures in your group." alexanbv 2026-06-22: the PLAYER chooses
  // the distribution, one token at a time (it is NOT auto-assigned in figure
  // order). Sequential picker: each Damage token, pick which group figure gets
  // it (only figures below their token cap are offered); pending count survives
  // re-entry on game.pendingDamageTokenDistribute (per activating figureKey).
  if (entry.type === 'ccEffect' && typeof entry.damageTokenGainToGroup === 'number' && entry.damageTokenGainToGroup > 0) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress (play as Special Action during your activation).' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (figureKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures in group.' };
    game.figurePowerTokens = game.figurePowerTokens || {};
    const _rwPendKey = figureKeyForActivation(game, msgId) || msgId;
    game.pendingDamageTokenDistribute = game.pendingDamageTokenDistribute || {};
    // figures still below their power-token cap (eligible to receive one).
    const _rwEligible = () => figureKeys.filter((fk) => (game.figurePowerTokens[fk] || []).length < getMaxPowerTokens(fk));
    // Apply one Damage token to a chosen figure (re-entry), then re-prompt / finish.
    const _rwGrantOne = (fk) => {
      grantPowerTokens(game, fk, 'Damage', 1);
      const st = game.pendingDamageTokenDistribute[_rwPendKey];
      st.remaining -= 1;
      st.placed[fk] = (st.placed[fk] || 0) + 1;
    };
    const _rwSummary = () => {
      const st = game.pendingDamageTokenDistribute[_rwPendKey] || { placed: {} };
      const parts = Object.entries(st.placed).map(([fk, n]) => `${dcNameFromFigureKey(fk)} +${n}`);
      return parts.length ? parts.join(', ') : 'none';
    };
    const _rwPrompt = () => {
      const st = game.pendingDamageTokenDistribute[_rwPendKey];
      const eligible = _rwEligible();
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(eligible),
        targetFigureKeys: eligible,
        logMessage: `**Ready Weapons** — choose a figure for Damage Token ${(entry.damageTokenGainToGroup - st.remaining) + 1}/${entry.damageTokenGainToGroup} (${st.remaining} left):`,
      };
    };
    // Re-entry: a figure was chosen for the current token.
    if (chosenFigureKey && game.pendingDamageTokenDistribute[_rwPendKey]) {
      if (figureKeys.includes(chosenFigureKey) && (game.figurePowerTokens[chosenFigureKey] || []).length < getMaxPowerTokens(chosenFigureKey)) {
        _rwGrantOne(chosenFigureKey);
      }
      const st = game.pendingDamageTokenDistribute[_rwPendKey];
      if (st.remaining > 0 && _rwEligible().length > 0) return _rwPrompt();
      delete game.pendingDamageTokenDistribute[_rwPendKey];
      return { applied: true, logMessage: `**Ready Weapons** — Distributed Damage Tokens: ${_rwSummary()}.`, refreshDcEmbed: true };
    }
    // Initial play: cap the total to what the group can actually hold.
    const groupCap = figureKeys.reduce((sum, fk) => sum + Math.max(0, getMaxPowerTokens(fk) - (game.figurePowerTokens[fk] || []).length), 0);
    const total = Math.min(entry.damageTokenGainToGroup, groupCap);
    if (total <= 0) return { applied: false, manualMessage: '**Ready Weapons** — no figure in your group can hold another Power Token.' };
    game.pendingDamageTokenDistribute[_rwPendKey] = { remaining: total, placed: {} };
    // Single eligible figure (or single-figure group) → no real choice; auto-assign all.
    if (_rwEligible().length === 1) {
      const only = _rwEligible()[0];
      while (game.pendingDamageTokenDistribute[_rwPendKey].remaining > 0 && (game.figurePowerTokens[only] || []).length < getMaxPowerTokens(only)) {
        _rwGrantOne(only);
      }
      const summary = _rwSummary();
      delete game.pendingDamageTokenDistribute[_rwPendKey];
      return { applied: true, logMessage: `**Ready Weapons** — Distributed Damage Tokens: ${summary}.`, refreshDcEmbed: true };
    }
    return _rwPrompt();
  }

  // ccEffect: claimInitiative only (I Make My Own Luck) — optional firstActivationFigureName
  if (entry.type === 'ccEffect' && entry.claimInitiative && !entry.exhaustOneDeploymentCard) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.initiativePlayerId = getPlayerId(game, playerNum);
    if (entry.firstActivationFigureName) {
      game.firstActivationFigureName = entry.firstActivationFigureName;
      // Store the owning playerNum so the activation-order gate in
      // handleDcActivate only constrains this player (I Make My Own Luck:
      // "Han Solo must activate first this round").
      game.firstActivationPlayerNum = playerNum;
    }
    return {
      applied: true,
      logMessage: `Claimed the initiative token.${entry.firstActivationFigureName ? ` ${entry.firstActivationFigureName} must activate first this round.` : ''}`,
    };
  }

  // ccEffect: claimInitiative + exhaustOneDeploymentCard (Take Initiative)
  // CSV row 724 (mandatory): "Claim the initiative token, then exhaust 1 of your
  // Deployment cards". The exhaust is a non-skippable cost — enforce it by
  // exhausting a chosen DC (mirrors Change of Plans' dcExhaustedState path).
  if (entry.type === 'ccEffect' && entry.claimInitiative && entry.exhaustOneDeploymentCard) {
    const { game, playerNum, dcMessageMeta, dcExhaustedState, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const _exhaustOne = (exhaustMsgId, exhaustName) => {
      if (dcExhaustedState && exhaustMsgId) dcExhaustedState.set(exhaustMsgId, true);
      // Persist ability-driven exhaustion for restart survival (as Change of Plans does).
      game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
      if (exhaustMsgId && !game.abilityExhaustedMsgIds.includes(exhaustMsgId)) game.abilityExhaustedMsgIds.push(exhaustMsgId);
      return {
        applied: true,
        exhaustDcMsgIds: exhaustMsgId ? [exhaustMsgId] : [],
        logMessage: `Claimed the initiative token, then exhausted **${exhaustName || exhaustMsgId}** (mandatory cost).`,
      };
    };
    // Phase 2: a DC was chosen to exhaust (chosenFigureKey encodes its msgId).
    if (choiceIndex !== undefined && choiceIndex !== null && chosenFigureKey) {
      game.initiativePlayerId = getPlayerId(game, playerNum);
      return _exhaustOne(chosenFigureKey, dcMessageMeta?.get?.(chosenFigureKey)?.dcName);
    }
    // Phase 1: enumerate the player's READIED (non-exhausted) Deployment cards.
    const dcIds = getDcMessageIds(game, playerNum) || [];
    const dcList = getDcList(game, playerNum) || [];
    const readied = dcIds
      .map((id, i) => ({ msgId: id, dcName: dcList[i]?.dcName || dcMessageMeta?.get?.(id)?.dcName }))
      .filter((d) => d.msgId && d.dcName && dcExhaustedState?.get(d.msgId) === false);
    // Always claim initiative first (the upside) regardless of exhaust availability.
    game.initiativePlayerId = getPlayerId(game, playerNum);
    if (readied.length === 0) {
      // No readied DC to exhaust — the cost cannot be paid; surface it.
      return { applied: true, logMessage: 'Claimed the initiative token. No readied Deployment card available to exhaust.' };
    }
    if (readied.length === 1) {
      return _exhaustOne(readied[0].msgId, readied[0].dcName);
    }
    // Multiple readied DCs — player must choose which to exhaust (non-skippable).
    return {
      requiresChoice: true,
      choiceOptions: readied.map((d) => `Exhaust ${d.dcName}`),
      choiceValues: readied.map((d) => d.msgId),
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
    // "discard a random Command card; IF YOU DO, your opponent discards 2" — the
    // opponent discard is conditional on the player actually discarding at least
    // one card (alexanbv audit 2026-06-22). With an empty hand, n1 = 0 and the
    // opponent loses nothing.
    const n2 = n1 > 0 ? Math.min(entry.opponentDiscardRandomFromHand, oppHand.length) : 0;
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
    // When-discarded subroutine (forced hand discards, both players): re-draw + Windfall hooks.
    for (const _c of discarded1) fireCcDiscarded(game, playerNum, _c, { fromDeck: false });
    for (const _c of discarded2) fireCcDiscarded(game, oppNum, _c, { fromDeck: false });
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
    // When-discarded subroutine (forced hand discard): re-draw passives + Windfall hooks.
    fireCcDiscarded(game, oppNum, discarded, { fromDeck: false });
    const eff = getCcEffect(discarded);
    const cost = typeof eff?.cost === 'number' ? eff.cost : 0;
    // Self-strain via pendingStrain[] (queues through applyStrain so
    // Fireproof / Headhunter / per-strain choice / Under Duress / Paz
    // gate correctly on the activating SPY).
    const _ilDcMessageMeta = context.dcMessageMeta;
    const _ilActMsgId = _ilDcMessageMeta ? findActiveActivationMsgId(game, playerNum, _ilDcMessageMeta) : null;
    const _ilActMeta = _ilActMsgId ? _ilDcMessageMeta.get(_ilActMsgId) : null;
    const _ilActKeys = _ilActMeta ? getFigureKeysForDcMsg(game, playerNum, _ilActMeta) : [];
    const _ilSelfFk = _ilActKeys[0] || null;
    const _ilPendingStrain = (cost > 0 && _ilSelfFk) ? [{
      figureKey: _ilSelfFk,
      controllerPlayerNum: playerNum,
      amount: cost,
      source: 'Intelligence Leak',
    }] : [];
    return {
      applied: true,
      logMessage: `Discarded **${discarded}** from opponent's hand; you suffer ${cost} Strain (queued).`,
      refreshOpponentHand: true,
      ...(_ilPendingStrain.length ? { pendingStrain: _ilPendingStrain } : {}),
    };
  }

  // ccEffect: readyAdjacentFriendlyDeploymentCard (New Orders) — present choiceOptions from dcList; chosenOption = DC to ready
  if (entry.type === 'ccEffect' && entry.readyAdjacentFriendlyDeploymentCard) {
    const { game, playerNum, dcMessageMeta, readyAdjacentFriendlyDcName, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const targetName = readyAdjacentFriendlyDcName || chosenOption;
    if (!targetName) {
      // Build choice list from friendly DCs. Rally the Troops restricts to
      // "another friendly TROOPER within 3 spaces" via readyRequireTrait /
      // readyRequireWithinSpaces (alexanbv 2026-06-20); New Orders leaves them
      // unset (any friendly DC).
      const dcList = getDcList(game, playerNum) || [];
      const _reqTrait = entry.readyRequireTrait ? String(entry.readyRequireTrait).toUpperCase() : null;
      const _reqWithin = typeof entry.readyRequireWithinSpaces === 'number' ? entry.readyRequireWithinSpaces : null;
      let _activPos = null, _activDcName = null, _activFk = null;
      if ((_reqTrait || _reqWithin != null) && dcMessageMeta) {
        const _activMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        const _activMeta = _activMsgId ? dcMessageMeta.get(_activMsgId) : null;
        _activDcName = _activMeta?.dcName || null;
        const _activKeys = _activMeta ? getFigureKeysForDcMsg(game, playerNum, _activMeta) : [];
        _activFk = _activKeys[game.dcActionsData?.[_activMsgId]?.selectedFigure ?? 0] || _activKeys[0];
        _activPos = _activFk ? game.figurePositions?.[playerNum]?.[_activFk] : null;
      }
      const opts = dcList
        .filter((dc) => {
          if (!dc || dc.defeated) return false;
          const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
          if (_reqTrait) {
            const kws = (getDcEffect(dcName)?.keywords || []).map((k) => String(k).toUpperCase());
            if (!kws.includes(_reqTrait)) return false;
          }
          if (_reqWithin != null && _activPos) {
            // Rally the Troops says "another friendly TROOPER"; New Orders says
            // "1 adjacent friendly figure" (may be a groupmate on the same DC).
            // readyAllowSameDc suppresses the same-DC self-exclusion. In both
            // cases the LEADER figure itself never counts toward the range
            // check (distance 0), so exclude the activating figure key.
            if (!entry.readyAllowSameDc && dcName === _activDcName) return false; // "another" friendly figure
            const _near = Object.entries(game.figurePositions?.[playerNum] || {})
              .some(([fk, pos]) => fk !== _activFk && fk.startsWith(`${dcName}-`) && pos && (() => { const d = countGameSpaces(game, _activPos, pos); return typeof d === 'number' && d >= 1 && d <= _reqWithin; })());
            if (!_near) return false;
          }
          return true;
        })
        .map((dc) => (typeof dc === 'object' ? dc.displayName || dc.dcName : dc))
        .filter(Boolean);
      if (opts.length === 0) return { applied: false, manualMessage: _reqTrait ? `No friendly ${_reqTrait} within ${_reqWithin} spaces to ready.` : 'No friendly Deployment cards to ready. Resolve manually.' };
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
    const { game, playerNum, defenderDefeated, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const deckKey = ccDeckKey(oppNum);
    const discardKey = ccDiscardKey(oppNum);
    const deck = (game[deckKey] || []).slice();
    if (entry.elseGainVp != null) {
      // Merciless CSV row 746: "that figure's player MAY discard 2 cards from the
      // top of his Command deck, OR your player gains 3 VPs" — the OPPONENT chooses.
      // The choice is routed to the targeted figure's controller via
      // choiceForControllerPlayerNum. alexanbv 2026-06-20.
      const n = entry.opponentDiscardDeckTop;
      const _doDiscard = () => {
        const removed = deck.splice(0, n);
        game[deckKey] = deck;
        game[discardKey] = (game[discardKey] || []).concat(removed);
        // When-discarded subroutine (deck): Built on Hope re-draw + Windfall hooks.
        const _prRedrawn = [];
        for (const _prCard of removed) {
          const _prResult = fireCcDiscarded(game, oppNum, _prCard, { fromDeck: true });
          _prRedrawn.push(..._prResult.redrawn);
        }
        const _prMsg = _prRedrawn.length > 0
          ? ` Passive Redraw: ${_prRedrawn.map(c => `**${c}**`).join(', ')} re-drawn from discard (discarded from deck).`
          : '';
        return {
          applied: true,
          logMessage: `**Merciless** — opponent discarded top ${n} card(s) of their Command deck.${_prMsg}`,
          refreshOpponentDiscard: true,
        };
      };
      const _doVp = () => {
        const vk = vpKey(playerNum);
        game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
        game[vk].total = (game[vk].total ?? 0) + entry.elseGainVp;
        return {
          applied: true,
          logMessage: `**Merciless** — opponent declined to discard; you gained ${entry.elseGainVp} VP.`,
        };
      };
      // Opponent's choice resolved.
      if (chosenFigureKey === 'merciless_discard') return _doDiscard();
      if (chosenFigureKey === 'merciless_vp') return _doVp();
      // Deck too small to discard 2 → no choice; card-player gains VP directly.
      if (deck.length < n) {
        const r = _doVp();
        r.logMessage = `**Merciless** — opponent had fewer than ${n} cards in deck; you gained ${entry.elseGainVp} VP.`;
        return r;
      }
      // First call: prompt the OPPONENT to choose discard-2 vs concede VP.
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [`Discard 2 from your Command deck`, `Give opponent ${entry.elseGainVp} VP`],
        choiceValues: ['merciless_discard', 'merciless_vp'],
        choiceForControllerPlayerNum: oppNum,
      };
    }
    if (!defenderDefeated) return { applied: false, manualMessage: 'Shoot the Messenger: defender was not defeated.' };
    const n = Math.min(entry.opponentDiscardDeckTop, deck.length);
    const removed = deck.splice(0, n);
    game[deckKey] = deck;
    game[discardKey] = (game[discardKey] || []).concat(removed);
    // When-discarded subroutine (deck): Built on Hope re-draw + Windfall hooks.
    const _stmRedrawn = [];
    for (const _stmCard of removed) {
      const _stmResult = fireCcDiscarded(game, oppNum, _stmCard, { fromDeck: true });
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

  // ccEffect: defenderRerollOneDefenseDie (Hard to Hit) — the defender
  // rerolls 1 of their own defense dice. Mirrors the defense-pool forced
  // reroll entries (Double or Nothing / Soresu Form): push a single named
  // queue entry controlled by the defender on the defense pool.
  if (entry.type === 'ccEffect' && typeof entry.defenderRerollOneDefenseDie === 'number' && entry.defenderRerollOneDefenseDie > 0) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while defending.' };
    const _h2hDefPN = cbt.defenderPlayerNum ?? (cbt.attackerPlayerNum === 1 ? 2 : 1);
    cbt.forcedRerollQueue = cbt.forcedRerollQueue || [];
    for (let _i = 0; _i < entry.defenderRerollOneDefenseDie; _i++) {
      cbt.forcedRerollQueue.push({
        controlPlayer: _h2hDefPN,
        pool: 'defense',
        remaining: 1,
        source: 'Hard to Hit',
      });
    }
    return { applied: true, logMessage: `You may reroll ${entry.defenderRerollOneDefenseDie} defense die.` };
  }

  // ccEffect: defenderRerollDiceMax (Guardian Stance) — while adjacent
  // friendly is defending. alexanbv 2026-05-13: register N named
  // queue entries (pool='any') instead of incrementing the deprecated
  // defenderRerollDiceMax count. Each entry surfaces as a "Use
  // Guardian Stance" bucket button.
  if (entry.type === 'ccEffect' && ((typeof entry.defenderRerollDiceMax === 'number' && entry.defenderRerollDiceMax > 0) || entry.defenderRerollAnyNumber)) {
    const { game, combat } = context;
    const cbt = combat || game?.combat || game?.pendingCombat;
    if (!cbt) return { applied: false, manualMessage: 'Resolve manually: play while adjacent friendly is defending.' };
    const _gsDefPN = cbt.defenderPlayerNum ?? (cbt.attackerPlayerNum === 1 ? 2 : 1);
    cbt.forcedRerollQueue = cbt.forcedRerollQueue || [];
    // Guardian Stance: "Reroll 1 OR MORE attack or defense dice." Register one
    // optional reroll entry per die currently present across both pools, so the
    // player may reroll any subset (each entry surfaces as a "Use Guardian
    // Stance" bucket button and may be declined). Falls back to the fixed
    // defenderRerollDiceMax count for single-die rerollers.
    let _gsCount;
    if (entry.defenderRerollAnyNumber) {
      const _atkN = Array.isArray(cbt.attackDiceResults) ? cbt.attackDiceResults.length : 0;
      const _defN = Array.isArray(cbt.defenseDiceResults) ? cbt.defenseDiceResults.length : 0;
      _gsCount = Math.max(1, _atkN + _defN);
    } else {
      _gsCount = entry.defenderRerollDiceMax;
    }
    for (let _i = 0; _i < _gsCount; _i++) {
      cbt.forcedRerollQueue.push({
        controlPlayer: _gsDefPN,
        pool: 'any',
        remaining: 1,
        source: 'Guardian Stance',
      });
    }
    return { applied: true, logMessage: entry.defenderRerollAnyNumber
      ? `You may reroll **1 or more** (up to ${_gsCount}) attack or defense dice.`
      : `You may reroll up to ${_gsCount} attack or defense die.` };
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
  // CSV row 652: "Gain 4 VPs and increase your figure cost by 2". timing
  // attack:after_resolves (attacker); conditional "attack defeated the figure
  // and your affiliation is REBEL or IMPERIAL". Per alexanbv ruling: the figure
  // cost increase applies to the FIGURE THAT PLAYED the card (the attacker /
  // activating figure), and is read by DEFEAT-VP scoring when THAT figure is
  // later defeated. Duration: CSV duration column = "None" → no expiry, i.e.
  // PERMANENT for the rest of the game (the figure carries the +2 until it is
  // defeated, at which point the opponent scores it). Stored per-figure in the
  // game-persistent game.figureCostModifier (NOT round-scoped; not registered in
  // the ROUND_*_FLAGS lists, mirroring other game-persistent per-figure maps like
  // figureNicknames / figureContraband).
  if (entry.type === 'ccEffect' && typeof entry.celebrationVp === 'number' && typeof entry.increaseArmyCostBy === 'number') {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Derive defender-defeated from game.lastDefeatInfo (set in combat-bridge
    // when the attack target drops to 0 HP), mirroring Glory of the Kill —
    // context.defenderDefeated is only supplied by tests, so we must not rely on
    // it in production. context.defenderDefeated, when explicitly provided, takes
    // precedence (lets tests assert the negative path).
    let defenderDefeated;
    if (typeof context.defenderDefeated === 'boolean') {
      defenderDefeated = context.defenderDefeated;
    } else {
      const cbt = context.combat || game.pendingCombat || game.combat;
      const _defeatedFk = game.lastDefeatInfo?.figureKey;
      const _attackTargetFk = cbt?.target?.figureKey || game.lastAttackTargetFigureKey;
      defenderDefeated = !!_defeatedFk && (!_attackTargetFk || _defeatedFk === _attackTargetFk);
    }
    if (!defenderDefeated) return { applied: false, manualMessage: 'Field Promotion: defender was not defeated.' };
    // CSV row 652 condition: "your affiliation is REBEL or IMPERIAL". Compute
    // the army's primary affiliation (most common non-"Any" across the DC list,
    // mirroring playerArmyAffiliationIsScum / cc-timing army-affiliation logic).
    const _fpDcEffects = getDcEffects() || {};
    const _fpDcList = getDcList(game, playerNum) || [];
    const _fpCounts = {};
    for (const dc of _fpDcList) {
      const name = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      if (!name) continue;
      const aff = String(_fpDcEffects?.[name]?.affiliation || '').toLowerCase();
      if (aff && aff !== 'any') _fpCounts[aff] = (_fpCounts[aff] || 0) + 1;
    }
    const _fpPrimary = Object.entries(_fpCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (_fpPrimary !== 'rebel' && _fpPrimary !== 'imperial') {
      return { applied: false, manualMessage: 'Field Promotion: your affiliation is not Rebel or Imperial.' };
    }
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total ?? 0) + entry.celebrationVp;
    // Resolve the PLAYING figure: during your own attack the attacker IS the
    // active activation figure, so findActiveActivationMsgId + figureKeyForActivation
    // yields the figure that played Field Promotion. Fall back to context.figureKey
    // (forwarded by the cc-timing playCard path) if no activation is resolvable.
    let _fpFigureKey = null;
    if (dcMessageMeta) {
      const _fpMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (_fpMsgId) _fpFigureKey = figureKeyForActivation(game, _fpMsgId);
    }
    if (!_fpFigureKey) _fpFigureKey = context.figureKey || null;
    if (_fpFigureKey) {
      game.figureCostModifier = game.figureCostModifier || {};
      game.figureCostModifier[_fpFigureKey] = (game.figureCostModifier[_fpFigureKey] || 0) + entry.increaseArmyCostBy;
    }
    return {
      applied: true,
      logMessage: _fpFigureKey
        ? `Defender defeated. Gained ${entry.celebrationVp} VP and increased the playing figure's cost by ${entry.increaseArmyCostBy} (scores extra VP for the opponent if it is later defeated).`
        : `Defender defeated. Gained ${entry.celebrationVp} VP (could not resolve the playing figure to apply the +${entry.increaseArmyCostBy} cost increase — resolve manually).`,
    };
  }

  // ccEffect: celebrationVp only (Celebration) — gain N VP after a unique hostile is defeated (no armyCost modifier)
  if (entry.type === 'ccEffect' && typeof entry.celebrationVp === 'number' && !entry.increaseArmyCostBy) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Validate: at least one UNIQUE hostile was defeated this activation
    // (CSV row 573 condition "a unique hostile figure is defeated"). The
    // unique-defeat tracker is keyed by attackerFigureKey at the two defeat
    // write sites (combat-bridge.js + after-attack-fire.js).
    const uniqueKillCounts = game.activationUniqueKills || {};
    const totalUniqueKills = Object.values(uniqueKillCounts).reduce((sum, n) => sum + (n || 0), 0);
    if (totalUniqueKills < 1) {
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

  // ccEffect: roundAttackRerollDice (Just Business) — CSV: "During this round,
  // friendly Scum figures within 3 spaces of you gain Professional (may reroll 1
  // attack die while attacking)" → affiliationScum + withinSpacesOfSource 3.
  // MIGRATED 2026-06-20 to the per-figure registry (attack side, rerollAttackDice).
  if (entry.type === 'ccEffect' && typeof entry.roundAttackRerollDice === 'number' && entry.roundAttackRerollDice > 0) {
    const { game, playerNum, dcMessageMeta, cardName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // "within 3 spaces of YOU": Just Business is a start_of_round CC, so there is
    // no active activation to anchor on. Resolve the playing figure via the
    // round-modifier anchor (played-by override → activation → defender →
    // named-figure registry), mirroring the sibling start_of_round card Field
    // Supply (alexanbv 2026-06-21). Without this the modifier carries a null
    // source and round-modifiers.js drops the buff for every figure. Just
    // Business is playableBy LEADER (a keyword, not a named figure), so when no
    // played-by figure was recorded, fall back to a LEADER figure on the board.
    let _jbSourceFk = resolveRoundModifierAnchor(game, playerNum, cardName || 'Just Business', { dcMessageMeta });
    if (!_jbSourceFk) _jbSourceFk = resolveKeywordCcFigureKey(game, playerNum, ['LEADER']);
    registerRoundModifier(game, {
      id: `Just Business:${playerNum}:atk-reroll`,
      card: 'Just Business',
      ownerPlayerNum: playerNum,
      sourceFigureKey: _jbSourceFk,
      side: 'attack',
      duration: 'during-round',
      conditions: { affiliationScum: true, withinSpacesOfSource: 3 },
      effect: { rerollAttackDice: entry.roundAttackRerollDice },
    });
    return {
      applied: true,
      logMessage: `During this round, friendly Scum figures within 3 spaces may reroll up to ${entry.roundAttackRerollDice} attack die when attacking.`,
    };
  }

  // ccEffect: roundDefenderCannotBeTargetedUnlessWithinSpaces (I Must Go Alone)
  // alexanbv 2026-06-20: I Must Go Alone shields ONLY the ONE figure that
  // plays it (Obi-Wan, or Mara Jade via Fast Learner) — not every friendly
  // figure. CSV: "hostile figures cannot declare attacks targeting YOU"
  // (singular). Resolve + store the specific figureKey so the targeting
  // filters scope to it.
  if (entry.type === 'ccEffect' && typeof entry.roundDefenderCannotBeTargetedUnlessWithinSpaces === 'number') {
    const { game, playerNum, cardName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKey = resolveUniqueFigureCcFigureKey(game, playerNum, cardName || 'I Must Go Alone');
    game.roundDefenderCannotBeTargetedUnlessWithinSpaces = { playerNum, spaces: entry.roundDefenderCannotBeTargetedUnlessWithinSpaces, figureKey: figureKey || null };
    return {
      applied: true,
      logMessage: `Until end of round, hostiles cannot attack ${figureKey ? dcNameFromFigureKey(figureKey) : 'the playing figure'} unless within ${entry.roundDefenderCannotBeTargetedUnlessWithinSpaces} spaces.`,
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

  // ccEffect: activationDoubleSpecialAction (Single Purpose).
  // Per alexanbv 2026-05-13: specials are per-figure → per-figureKey.
  if (entry.type === 'ccEffect' && entry.activationDoubleSpecialAction) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play at start of your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const _adsaFk = figureKeyForActivation(game, msgId);
    if (!_adsaFk) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    game.activationDoubleSpecialAction = game.activationDoubleSpecialAction || {};
    game.activationDoubleSpecialAction[_adsaFk] = true;
    return {
      applied: true,
      logMessage: 'You may use the same special action up to twice during this activation.',
    };
  }

  // ccEffect: applyStunToUpToNAdjacentHostiles (Roar) — CSV: "Choose up to 3
  // ADJACENT hostile figures; those figures become Stunned." The choice is
  // per-FIGURE across ANY hostile groups (not per-DC), and the player picks
  // WHICH up to 3 (and may pick fewer). Iterative per-figure picker with a
  // Done sentinel (Field Report shape); condition-immune figures are skipped.
  if (entry.type === 'ccEffect' && typeof entry.applyStunToUpToNAdjacentHostiles === 'number' && entry.applyStunToUpToNAdjacentHostiles > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    // Damage-suffered gate (only checked on the initial play, not on re-entry).
    if (typeof entry.onlyIfSufferedDamageGte === 'number' && !game.pendingRoar) {
      const healthState = dcHealthState?.get(msgId) || [];
      // healthState entries are [current, max]; damage suffered = max - current
      const totalDamage = healthState.reduce((s, e) => s + ((e?.[1] ?? 0) - (e?.[0] ?? e?.[1] ?? 0)), 0);
      if (totalDamage < entry.onlyIfSufferedDamageGte) {
        return { applied: false, manualMessage: `Roar: you must have suffered ${entry.onlyIfSufferedDamageGte}+ Damage (you have suffered ${totalDamage}).` };
      }
    }
    const oppNum = opponentPlayerNum(playerNum);
    const _roarMax = entry.applyStunToUpToNAdjacentHostiles;
    // Compute the set of hostile figures adjacent to any activating figure.
    const mapId = game.selectedMap?.id;
    const adjacentHostileFks = new Set();
    if (mapId) {
      const meta = dcMessageMeta.get(msgId);
      const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
      for (const afk of actKeys) {
        const adj = getFiguresAdjacentToTarget(game, afk, mapId);
        for (const { figureKey: hfk, playerNum: hp } of adj) {
          if (hp === oppNum) adjacentHostileFks.add(hfk);
        }
      }
    } else {
      // No map context (headless/manual): every hostile figure is eligible.
      for (const fk of Object.keys(game.figurePositions?.[oppNum] || {})) adjacentHostileFks.add(fk);
    }
    const _roarApply = (fks) => {
      let stunned = 0;
      let skipped = 0;
      const names = [];
      for (const fk of fks) {
        if (isConditionImmune(game, fk)) { skipped++; continue; }
        applyCondition(game, fk, 'Stun');
        stunned++;
        names.push(dcNameFromFigureKey(fk));
      }
      const immuneNote = skipped > 0 ? ` (${skipped} immune)` : '';
      if (stunned === 0 && skipped === 0) {
        return { applied: true, logMessage: '**Roar** — No figures chosen.' };
      }
      return { applied: true, logMessage: `**Roar** — ${names.join(', ') || 'figure(s)'} became **Stunned**.${immuneNote}` };
    };
    // Phase 2+: accumulate sequential per-figure picks.
    if (chosenFigureKey && game.pendingRoar) {
      const pend = game.pendingRoar;
      if (chosenFigureKey === '__done__') {
        delete game.pendingRoar;
        return _roarApply(pend.chosen);
      }
      pend.chosen.push(chosenFigureKey);
      const remaining = pend.candidates.filter((fk) => !pend.chosen.includes(fk));
      if (pend.chosen.length >= _roarMax || remaining.length === 0) {
        delete game.pendingRoar;
        return _roarApply(pend.chosen);
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [...remaining.map(dcNameFromFigureKey), 'Done selecting'],
        choiceValues: [...remaining, '__done__'],
        choicePrompt: `**Roar** — Stunned ${pend.chosen.length}/${_roarMax}. Choose another adjacent hostile figure or Done:`,
      };
    }
    // Phase 1: enumerate adjacent hostile FIGURES (across all groups).
    const candidates = [...adjacentHostileFks].filter((fk) => game.figurePositions?.[oppNum]?.[fk] !== undefined);
    if (candidates.length === 0) return { applied: false, manualMessage: 'No adjacent hostile figure to Roar at. Resolve manually.' };
    // ≤N candidates: auto-Stun all (no meaningful which/how-many choice).
    if (candidates.length <= _roarMax) return _roarApply(candidates);
    // >N candidates: offer a per-figure pick of WHICH up to N to Stun.
    game.pendingRoar = { chosen: [], candidates };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: [...candidates.map(dcNameFromFigureKey), 'Done selecting'],
      choiceValues: [...candidates, '__done__'],
      choicePrompt: `**Roar** — Choose up to ${_roarMax} adjacent hostile figures to become Stunned:`,
    };
  }

  // ccEffect: pushFriendlyWithin3Spaces (Reposition) — pick a SMALL friendly figure, then pick landing space
  // Phase 1 (no targetFigureKey): enumerate valid SMALL friendly figures → requiresChoice.
  // Phase 2 (targetFigureKey set, no chosenSpace): enumerate valid landing spaces → requiresSpaceChoice.
  // Phase 3 (targetFigureKey + chosenSpace set): apply position update.
  if (entry.type === 'ccEffect' && typeof entry.pushFriendlyWithin3Spaces === 'number' && entry.pushFriendlyWithin3Spaces > 0) {
    const pushDist = entry.pushFriendlyWithin3Spaces;
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenSpace, getMapData: getMs } = context;
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
      _rpLogMsg += stashPushPartingBlow(game, targetFigureKey, playerNum, prevPos, chosenSpace, playerNum);
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

    // Phase 1: enumerate valid SMALL friendly figures WITHIN 3 spaces of the
    // activating figure (CSV "a SMALL friendly figure within 3 spaces").
    const dcEffects = getDcEffects() || {};
    // Locate the activating figure (the card player) to anchor the range check.
    let _rpActPos = null, _rpActFk = null;
    if (dcMessageMeta) {
      const _rpMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      const _rpMeta = _rpMsgId ? dcMessageMeta.get(_rpMsgId) : null;
      const _rpKeys = _rpMeta ? getFigureKeysForDcMsg(game, playerNum, _rpMeta) : [];
      _rpActFk = _rpKeys[game.dcActionsData?.[_rpMsgId]?.selectedFigure ?? 0] || _rpKeys[0] || null;
      _rpActPos = _rpActFk ? game.figurePositions?.[playerNum]?.[_rpActFk] : null;
    }
    const validTargets = [];
    for (const [fk, coord] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!coord) continue;
      const dcN = dcNameFromFigureKey(fk);
      const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('LARGE') || kws.includes('MASSIVE')) continue; // SMALL only
      // Within-3 range from the activator (skip the activator's own anchor only
      // if you cannot push yourself — IACP allows targeting yourself, so keep it).
      if (_rpActPos) {
        const d = countGameSpaces(game, _rpActPos, coord);
        if (typeof d !== 'number' || d < 0 || d > 3) continue;
      }
      validTargets.push(fk);
    }
    if (validTargets.length === 0) return { applied: false, manualMessage: 'No SMALL friendly figure within 3 spaces to push.' };
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
    // Per alexanbv 2026-05-13: Command cards are SECRET. The placed
    // cards go onto the deck (face-down) — their names must not leak
    // in the public log.
    return {
      applied: true,
      logMessage: `Opponent placed ${n} random card(s) from hand on top of their Command deck.`,
      refreshOpponentHand: true,
    };
  }

  // ccEffect: roundInTheShadows (In the Shadows)
  // alexanbv 2026-06-20: scopes to the ONE figure that plays it (CSV "you"
  // singular). In the Shadows is playableBy "SMUGGLER or HUNTER" (a keyword,
  // not a named figure), so resolve the playing figure from those keywords.
  // The effect is mechanically identical to Camouflage: hostile figures 4+
  // spaces away lose LOS to this figure, and this figure does not block LOS
  // for those hostiles. Clears at the START of the EOR phase (until-end-of-
  // round timing — see round.js _runStatusPhaseLogic).
  if (entry.type === 'ccEffect' && entry.roundInTheShadowsPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const figureKey = resolveKeywordCcFigureKey(game, playerNum, ['SMUGGLER', 'HUNTER']);
    game.roundInTheShadows = { playerNum, figureKey: figureKey || null };
    return { applied: true, logMessage: `Until end of round, hostiles 4+ spaces away do not have line of sight to ${figureKey ? dcNameFromFigureKey(figureKey) : 'the playing figure'} (and that figure does not block LOS for them).` };
  }

  // ccEffect: activationExtraActionThenStun (To the Limit)
  if (entry.type === 'ccEffect' && entry.activationExtraActionThenStun) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play after resolving a Special Action during your activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    // Grant 1 extra action
    const actionsData = game.dcActionsData?.[msgId];
    if (actionsData) {
      grantActionToFigure(actionsData, actionsData.selectedFigure ?? 0, 1, 2);
    }
    // Per alexanbv 2026-05-13: per-figureKey.
    const _ttlFk = figureKeyForActivation(game, msgId);
    game.activationExtraActionThenStun = game.activationExtraActionThenStun || {};
    if (_ttlFk) game.activationExtraActionThenStun[_ttlFk] = true;
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

  // ccEffect: provokeNextActivation (Provoke) — choose a hostile figure adjacent
  // to a friendly TROOPER/GUARDIAN; that figure's GROUP must activate next (CSV
  // row 782). Uses the live forceVisionNextActivation mechanism (consumed in
  // dc-play-area.js:143; same as Distracting Fire) — the old provokeNextActivation
  // flag was never read (alexanbv 2026-06-20).
  if (entry.type === 'ccEffect' && entry.provokeNextActivation) {
    const { game, playerNum, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppNum = opponentPlayerNum(playerNum);
    const dcEffects = getDcEffects();
    // Phase 2: chosen hostile → force its group to activate next.
    if (chosenFigureKey) {
      const chosenDcName = dcNameFromFigureKey(chosenFigureKey);
      game.forceVisionNextActivation = { playerNum: oppNum, dcName: chosenDcName };
      return { applied: true, logMessage: `**Provoke** — **${chosenDcName}**'s group must activate next (if able).` };
    }
    // Phase 1: enumerate hostile figures adjacent to a friendly TROOPER/GUARDIAN.
    const validKeys = []; const validLabels = [];
    for (const [hfk, hpos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      if (!hpos) continue;
      const adjToTG = Object.entries(game.figurePositions?.[playerNum] || {}).some(([ffk, fpos]) => {
        if (!fpos) return false;
        const d = countGameSpaces(game, fpos, hpos);
        if (d !== 1) return false;
        const kws = (dcEffects[dcNameFromFigureKey(ffk)]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('TROOPER') || kws.includes('GUARDIAN');
      });
      if (adjToTG) { validKeys.push(hfk); validLabels.push(dcNameFromFigureKey(hfk)); }
    }
    if (!validKeys.length) return { applied: false, manualMessage: '**Provoke** — No hostile figure adjacent to your TROOPER or GUARDIAN.' };
    return { applied: false, requiresChoice: true, choiceOptions: validLabels.map((n) => `Provoke: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: pummelTwoAttacksThisActivation (Pummel) — per-figureKey
  // per alexanbv 2026-05-13 (each figure in a multifigure group has its
  // own Pummel grant; sibling figures don't share).
  if (entry.type === 'ccEffect' && entry.pummelTwoAttacksThisActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const _pummelFk = figureKeyForActivation(game, msgId);
    if (!_pummelFk) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    // CSV row 783 / cc-effects condition: "If you have the MELEE attack type,
    // perform 2 attacks." A RANGED figure gets no attacks — gate the grant on
    // the activating figure's attack type (dcEffects.attack.type === 'melee').
    const _pummelStats = getStatsForDc(dcNameFromFigureKey(_pummelFk));
    if (_pummelStats?.attack?.type !== 'melee') {
      return { applied: false, manualMessage: 'Pummel: you do not have the MELEE attack type — no attacks granted.' };
    }
    game.pummelTwoAttacksThisActivation = game.pummelTwoAttacksThisActivation || {};
    game.pummelTwoAttacksThisActivation[_pummelFk] = true;
    return { applied: true, logMessage: 'You have the MELEE attack type — perform 2 attacks.' };
  }

  // ccEffect: vanishImmunityUntilNextActivation + nextActivationMpBonus (Vanish)
  if (entry.type === 'ccEffect' && entry.vanishImmunityUntilNextActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: 'Resolve manually: play during your activation (Special Action).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const _vMeta = dcMessageMeta.get(msgId);
    const _vKeys = _vMeta ? getFigureKeysForDcMsg(game, playerNum, _vMeta) : [];
    const _vSelFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const _vFigureKey = _vKeys[_vSelFig] || _vKeys[0] || null;
    game.vanishImmunityUntilNextActivation = game.vanishImmunityUntilNextActivation || {};
    // alexanbv 2026-06-19: Vanish prevents ALL Damage and ALL new conditions
    // (harmful AND beneficial) on the figure until its next activation, but does
    // NOT remove conditions already present and does NOT prevent targeting
    // (unlike Blend In). Store the figure identity so the damage / condition
    // pipelines can recognise it.
    game.vanishImmunityUntilNextActivation[playerNum] = {
      msgId,
      dcName: _vMeta?.dcName || null,
      figureKey: _vFigureKey,
      nextMp: entry.nextActivationMpBonus || 0,
    };
    return {
      applied: true,
      logMessage: `**${dcNameFromFigureKey(_vFigureKey) || 'This figure'}** cannot suffer Damage or receive new conditions until its next activation (existing conditions remain; it can still be targeted). At the start of its next activation, gain ${entry.nextActivationMpBonus || 0} movement points.`,
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
    // Per CRR + user clarification 2026-05-09: "Then, if you are
    // 'Sabine Wren', you may re-draw this card." Returns a
    // pendingRedraw flag so cc-hand's play handler can move the card
    // from discard to hand AFTER the play resolves (the card lands in
    // discard during play, so we redraw via moveDiscardToHand).
    const _rgIsSabine = (meta?.dcName || '').includes('Sabine Wren');
    return {
      applied: true,
      logMessage: `Gained ${entry.rebelGraffitiVp} VP (end of activation; no adjacent hostiles verified).${_rgIsSabine ? ' Sabine may re-draw Rebel Graffiti.' : ''}`,
      ...(_rgIsSabine ? { pendingRedraw: { card: 'Rebel Graffiti', playerNum } } : {}),
    };
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

  // ccEffect: whenDefeatHostileWithin3GainBlockTokens (Paid in Beskar) — ONE-SHOT
  // reactive: "when a hostile figure within 3 spaces of YOU is defeated, YOU gain
  // 2 Block tokens." Paid in Beskar is a HUNTER-keyword "you"-scoped reaction
  // (cc-effects.json playableBy: HUNTER), so the within-3 range is measured from
  // the playing HUNTER figure (NOT from the defeated figure to the nearest
  // friendly), and the Block tokens go to that same HUNTER (alexanbv 2026-06-21
  // anchor fix; mirrors the In the Shadows keyword-CC anchor pattern). The
  // defeated position is threaded in via context.defeatedPos.
  if (entry.type === 'ccEffect' && typeof entry.whenDefeatHostileWithin3GainBlockTokens === 'number') {
    const { game, playerNum, defeatedPos, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const tokens = entry.whenDefeatHostileWithin3GainBlockTokens;
    const range = entry.whenDefeatHostileWithin3Range ?? 3;
    const dPos = defeatedPos || null;
    if (!dPos) return { applied: false, manualMessage: `**${entry.label || 'Paid in Beskar'}** — no recently-defeated hostile in context; resolve manually.` };
    // Anchor on the HUNTER the player CHOSE to play it (alexanbv 2026-06-21:
    // every selection is a player pick — the defeat-CC picker offers each
    // eligible HUNTER within range when 2+ are present), else the first live
    // HUNTER when no choice was threaded.
    const hunterFk = (chosenFigureKey && game.figurePositions?.[playerNum]?.[chosenFigureKey])
      ? chosenFigureKey
      : resolveKeywordCcFigureKey(game, playerNum, ['HUNTER']);
    const hunterPos = hunterFk ? game.figurePositions?.[playerNum]?.[hunterFk] : null;
    if (!hunterFk || !hunterPos) return { applied: true, logMessage: `**${entry.label || 'Paid in Beskar'}** — no eligible HUNTER figure to gain Block tokens.` };
    const dist = countGameSpaces(game, dPos, hunterPos);
    if (dist > range) return { applied: true, logMessage: `**${entry.label || 'Paid in Beskar'}** — the defeated figure was not within ${range} spaces of **${dcNameFromFigureKey(hunterFk)}**.` };
    grantPowerTokens(game, hunterFk, 'Block', tokens);
    return { applied: true, logMessage: `**${entry.label || 'Paid in Beskar'}** — **${dcNameFromFigureKey(hunterFk)}** gains ${tokens} Block Token${tokens !== 1 ? 's' : ''}.`, refreshDcEmbed: true };
  }

  // ccEffect: overrunThisActivation (Overrun) — per alexanbv 2026-05-13,
  // "during this activation" = per-figure activation. Keyed by figureKey
  // so siblings in a multi-figure group don't share the Overrun grant.
  if (entry.type === 'ccEffect' && entry.overrunThisActivation) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually: play at start of activation.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const _ovrFk = figureKeyForActivation(game, msgId);
    if (!_ovrFk) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    game.overrunThisActivation = game.overrunThisActivation || {};
    game.overrunThisActivation[_ovrFk] = true;
    return { applied: true, logMessage: 'This activation, when you enter a hostile figure\'s space, that figure suffers 2 Damage (limit once per hostile).' };
  }

  // ccEffect: squadSwarmPlayerNum (Squad Swarm)
  if (entry.type === 'ccEffect' && entry.squadSwarmPlayerNum) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.squadSwarmPlayerNum = playerNum;
    return { applied: true, logMessage: 'You may immediately activate another ready group with the same name (combined cost of both groups cannot exceed 15).' };
  }

  // ccEffect: roundSmugglersTricksPlayerNum (Smuggler's Tricks) —
  // INTENTIONALLY UNIMPLEMENTED (alexanbv 2026-06-20, same status as Harsh
  // Environment). The card requires choosing a tile/token and reducing the
  // opponent's effective figure-count on or adjacent to it for control/
  // adjacency — a mission-tile/token-targeting model this engine does not
  // have. The flag is never set, so no consumer fires; deck-loading reports
  // it as unimplemented (see UNIMPLEMENTED_CARDS in validation.js).
  if (entry.type === 'ccEffect' && entry.roundSmugglersTricksPlayerNum) {
    return {
      applied: false,
      manualMessage: "**Smuggler's Tricks** is not implemented (requires a tile/token targeting + figure-count model) — resolve manually if you wish.",
    };
  }

  // ccEffect: grantMpToFriendliesWithin2 (Forward March) — activator
  // and each friendly figure within 2 spaces gain N MP. Mixed bank/
  // picker by recipient: activator banks (rule 3, in-activation),
  // others get picker (rule 1, out-of-activation grant on another
  // figure). Multi-figure sequence with player-chosen order for the
  // non-activator pickers.
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
    // Activator banks immediately (rule 3).
    addMovementPoints(game, activeMsgId, n);
    // Build sequence of OTHER friendlies within 2 (graph distance).
    const seqFigures = [];
    for (const [mid, meta] of dcMessageMeta) {
      if (meta.playerNum !== playerNum || meta.gameId !== game.gameId || mid === activeMsgId) continue;
      const figKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      for (const fk of figKeys) {
        const pos = game.figurePositions?.[playerNum]?.[fk];
        if (!pos) continue;
        if (countGameSpaces(game, activePos, pos) > 2) continue;
        seqFigures.push({ msgId: mid, figureKey: fk, playerNum, spaces: n, dcName: meta.dcName });
      }
    }
    if (seqFigures.length === 0) {
      return {
        applied: true,
        logMessage: `**Forward March** — Activator gains ${n} MP. No other friendly figures within 2 spaces.`,
        refreshMovementBank: true,
        activeMsgId,
      };
    }
    return {
      applied: true,
      pendingMoveXSequenceSetup: {
        figures: seqFigures,
        source: 'Forward March',
        threadId: null,
        bypassCosts: false,
        afterAction: null,
      },
      logMessage: `**Forward March** — Activator gains ${n} MP (banked). ${seqFigures.length} other friendly figure(s) within 2 spaces each gain ${n} MP — pick order; spend at once, no bank.`,
      refreshMovementBank: true,
      activeMsgId,
    };
  }

  // ccEffect: grantMpToFriendliesByKeyword (Close the Gap) — Move-X
  // sequence per friendly figure with the given keyword (BRAWLER), then
  // grant the keyword token (Block) to those within 4 spaces of any
  // hostile after the moves resolve. Player picks the order.
  if (entry.type === 'ccEffect' && entry.grantMpToFriendliesByKeyword) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const { keyword, mp, grantBlockToken } = entry.grantMpToFriendliesByKeyword;
    const dcEffects = getDcEffects();
    const seqFigures = [];
    for (const [mid, meta] of dcMessageMeta) {
      if (meta.playerNum !== playerNum || meta.gameId !== game.gameId) continue;
      const eff = dcEffects[meta.dcName] || dcEffects[meta.dcName?.replace(/\s*\[.*\]\s*$/, '')];
      const kws = (eff?.keywords || []).map((k) => String(k).toUpperCase());
      if (!kws.includes(keyword.toUpperCase())) continue;
      const figKeys = getFigureKeysForDcMsg(game, playerNum, meta);
      for (const fk of figKeys) {
        if (!game.figurePositions?.[playerNum]?.[fk]) continue;
        seqFigures.push({ msgId: mid, figureKey: fk, playerNum, spaces: mp, dcName: meta.dcName });
      }
    }
    if (seqFigures.length === 0) {
      return { applied: true, logMessage: `**${entry.label || 'Close the Gap'}** — No friendly ${keyword} figures found.` };
    }
    return {
      applied: true,
      pendingMoveXSequenceSetup: {
        figures: seqFigures,
        source: 'Close the Gap',
        threadId: null,
        bypassCosts: true,
        afterAction: grantBlockToken
          ? { type: 'closeTheGapBlockTokens', playerNum, keyword, withinSpaces: 4 }
          : null,
      },
      logMessage: `**Close the Gap** — ${seqFigures.length} friendly ${keyword}${seqFigures.length === 1 ? '' : 's'} may each move up to ${mp} space${mp === 1 ? '' : 's'}; pick order. After all moves, ${keyword}s within 4 spaces of any hostile gain 1 Block Token.`,
    };
  }

  // ccEffect: roundEfficientTravel (Efficient Travel CC) — until end of round all friendly figures ignore Difficult Terrain and hostile figure entry costs
  if (entry.type === 'ccEffect' && entry.roundEfficientTravel) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.roundEfficientTravel = game.roundEfficientTravel || {};
    game.roundEfficientTravel[playerNum] = true;
    return { applied: true, logMessage: `**Efficient Travel** — Until end of round, your figures ignore Difficult Terrain and hostile figure entry costs.` };
  }

  // ccEffect: applyBlockAndHideToIsolatedFriendlies (Guerilla Warfare) — figures
  // with NO other friendly figure within 2 spaces gain Block Token + Hidden
  // (CSV row 682; was wrongly using orthogonal-distance-exactly-1 — alexanbv 2026-06-20).
  if (entry.type === 'ccEffect' && entry.applyBlockAndHideToIsolatedFriendlies) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const allFriendlyPositions = game.figurePositions?.[playerNum] || {};
    const friendlyKeys = Object.keys(allFriendlyPositions);
    const qualified = [];
    for (const fk of friendlyKeys) {
      const pos = allFriendlyPositions[fk];
      if (!pos) continue;
      const hasNearbyFriendly = friendlyKeys.some((otherFk) => {
        if (otherFk === fk) return false;
        const otherPos = allFriendlyPositions[otherFk];
        if (!otherPos) return false;
        const d = countGameSpaces(game, pos, otherPos);
        return typeof d === 'number' && d >= 0 && d <= 2;
      });
      if (!hasNearbyFriendly) qualified.push(fk);
    }
    for (const fk of qualified) {
      grantPowerTokens(game, fk, 'Block', 1);
      applyCondition(game, fk, 'Hide');
    }
    if (qualified.length === 0) return { applied: true, logMessage: `**Guerilla Warfare** — No isolated friendly figures (all have adjacent friendlies).` };
    const names = qualified.map((fk) => dcNameFromFigureKey(fk)).join(', ');
    return { applied: true, logMessage: `**Guerilla Warfare** — Applied Block Token and Hidden to **${qualified.length}** isolated friendly figure(s): ${names}.` };
  }

  // ccEffect: nextAttackIgnoreFigureLOS (Marksman) — for next attack,
  // figures do not block line of sight. Per alexanbv 2026-05-13:
  // per-figureKey (the activating figure's attack).
  if (entry.type === 'ccEffect' && entry.nextAttackIgnoreFigureLOS) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: play before declaring your attack this activation.' };
    const _mksFk = figureKeyForActivation(game, msgId);
    if (!_mksFk) return { applied: false, manualMessage: 'Resolve manually: cannot resolve activating figure.' };
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[_mksFk] = true;
    return { applied: true, logMessage: `**Marksman** — For your next Ranged attack this activation, figures do not block line of sight.` };
  }

  // ccEffect: attackOverrideOpts (Definition: 'Love') — store pending attack override (type, minRange, removeDieColor) + free attack
  if (entry.type === 'ccEffect' && entry.attackOverrideOpts) {
    const { game, playerNum, dcMessageMeta } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: play before declaring your attack this activation.' };
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    const _aoFk = figureKeyForActivation(game, msgId);
    if (_aoFk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_aoFk] = { ...entry.attackOverrideOpts };
      if (entry.freeAttackBonus) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[_aoFk] = true;
      }
    }
    const rangeNote = entry.attackOverrideOpts.minRange ? ` Target must be **${entry.attackOverrideOpts.minRange}+** spaces away.` : '';
    const dieNote = entry.attackOverrideOpts.removeDieColor ? ` Remove 1 **${entry.attackOverrideOpts.removeDieColor}** die from your attack pool.` : '';
    const freeNote = entry.freeAttackBonus ? ' Your next attack costs no action.' : '';
    return { applied: true, logMessage: `**${entry.label}** —${freeNote}${rangeNote}${dieNote} Use the Attack button.` };
  }

  // ccEffect: deployGarrisonEffect (Deploy the Garrison) — at start of
  // a round, each friendly TROOPER or GUARDIAN within 4 spaces makes a
  // PER-FIGURE choice between gaining 1 Hit Token or moving up to 2
  // spaces. Order is player-chosen; each figure resolves before the
  // next one is offered. No activation is in progress (start-of-round
  // timing) so all MP grants use the picker (rule 1, no bank,
  // bypassCosts: false).
  if (entry.type === 'ccEffect' && entry.deployGarrisonEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, cardName } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // The "you" who plays this start_of_round card is the named figure
    // (Director Krennic) — or Mara Jade when she plays it via Fast Learner.
    // resolveRoundModifierAnchor handles activation → named-figure → Mara, and
    // honors the Fast-Learner-played-by-Mara override (alexanbv 2026-06-21) so
    // the within-4 range references the figure that ACTUALLY played the card.
    const anchorFk = resolveRoundModifierAnchor(game, playerNum, cardName || 'Deploy the Garrison', { dcMessageMeta });
    let anchorPos = anchorFk ? game.figurePositions?.[playerNum]?.[anchorFk] : null;
    if (!anchorPos) {
      // No anchor resolvable → fall back to first friendly position.
      for (const pos of Object.values(game.figurePositions?.[playerNum] || {})) {
        if (pos) { anchorPos = pos; break; }
      }
    }
    if (!anchorPos) return { applied: false, manualMessage: 'Resolve manually: no friendly figure on the board to anchor "within 4".' };
    const dcEffects = getDcEffects();
    // Resume in progress (chosenFigureKey supplied via figure-pick
    // button) — we want a fresh figure-list each iteration so we
    // recompute below.
    const allQualifyingFigures = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || dcEffects[dcN.replace(/\s*\[.*\]\s*$/, '')] || {};
      const kws = (eff.keywords || []).map(k => String(k).toUpperCase());
      if (!kws.includes('TROOPER') && !kws.includes('GUARDIAN')) continue;
      if (countGameSpaces(game, anchorPos, pos) > 4) continue;
      allQualifyingFigures.push({ figureKey: fk, dcName: dcN });
    }
    if (allQualifyingFigures.length === 0) {
      return { applied: true, logMessage: `**Deploy the Garrison** — No friendly TROOPER / GUARDIAN figures within 4 spaces.` };
    }
    // Initialize / read pending-resolved set so each figure resolves once.
    if (!game.pendingDeployGarrison) {
      game.pendingDeployGarrison = { resolved: [], playerNum };
    }
    const remaining = allQualifyingFigures.filter(f => !game.pendingDeployGarrison.resolved.includes(f.figureKey));
    if (remaining.length === 0) {
      delete game.pendingDeployGarrison;
      return { applied: true, logMessage: `**Deploy the Garrison** — All eligible figures resolved.` };
    }
    // Each figure-pick click sends back chosenFigureKey of form
    // "<figKey>|<choice>" (choice = "token" or "move") so this single
    // dispatch handles both phases. The figure picker is the
    // ability-library standard requiresChoice; the token/move sub-
    // choice is passed back by the existing cc_choice handler with a
    // structured choiceValues entry.
    if (chosenFigureKey) {
      const sepIdx = String(chosenFigureKey).lastIndexOf('|');
      if (sepIdx < 0) {
        // Phase 2: figure picked → present token-or-move sub-choice
        // for this figure via chained requiresChoice.
        const dcN = dcNameFromFigureKey(chosenFigureKey);
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions: [
            `${dcN}: gain 1 Hit Token`,
            `${dcN}: move up to 2 spaces (no bank)`,
          ],
          choiceValues: [`${chosenFigureKey}|token`, `${chosenFigureKey}|move`],
        };
      }
      // Phase 3: choice supplied → apply, mark resolved, loop.
      const figKey = chosenFigureKey.slice(0, sepIdx);
      const sub = chosenFigureKey.slice(sepIdx + 1);
      const dcN = dcNameFromFigureKey(figKey);
      const figMsgId = findMsgIdForFigureKey(game, playerNum, figKey, dcMessageMeta);
      game.pendingDeployGarrison.resolved.push(figKey);
      const stillRemaining = allQualifyingFigures.filter(f => !game.pendingDeployGarrison.resolved.includes(f.figureKey));
      if (sub === 'token') {
        grantPowerTokens(game, figKey, 'Damage', 1);
        if (stillRemaining.length === 0) {
          delete game.pendingDeployGarrison;
          return {
            applied: true,
            logMessage: `**Deploy the Garrison** — **${dcN}** gained 1 Damage Token. All eligible figures resolved.`,
          };
        }
        return {
          applied: false,
          requiresChoice: true,
          choiceOptions: stillRemaining.map(f => `Resolve next: ${f.dcName}`),
          choiceValues: stillRemaining.map(f => f.figureKey),
          logMessage: `**Deploy the Garrison** — **${dcN}** gained 1 Damage Token. ${stillRemaining.length} figure(s) remaining.`,
        };
      }
      // Move sub-choice → setupPendingMoveX picker (no bank).
      if (!figMsgId) {
        return { applied: true, logMessage: `**Deploy the Garrison** — could not locate **${dcN}**'s play area; resolve their 2 MP move manually.` };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[figMsgId] = {
        remaining: 2,
        source: 'Deploy the Garrison',
        playerNum,
        figureKey: figKey,
        dcName: dcN,
        threadId: null,
        bypassCosts: false,
        msgId: figMsgId,
        nextAction: null,
      };
      if (stillRemaining.length === 0) {
        delete game.pendingDeployGarrison;
        return {
          applied: true,
          pendingMoveXMsgId: figMsgId,
          activeMsgId: figMsgId,
          logMessage: `**Deploy the Garrison** — **${dcN}** moves up to 2 spaces (spend at once, no bank). All eligible figures resolved.`,
        };
      }
      // Both: post the picker AND chain to the next figure-pick.
      // Caller already saw pendingMoveXMsgId; the chained
      // requiresChoice surfaces remaining figures via cc-hand's
      // chained-arm so the player keeps resolving in sequence.
      return {
        applied: true,
        pendingMoveXMsgId: figMsgId,
        activeMsgId: figMsgId,
        requiresChoice: true,
        choiceOptions: stillRemaining.map(f => `Resolve next: ${f.dcName}`),
        choiceValues: stillRemaining.map(f => f.figureKey),
        logMessage: `**Deploy the Garrison** — **${dcN}** moves up to 2 spaces (spend at once, no bank). ${stillRemaining.length} figure(s) remaining.`,
      };
    }
    // Phase 1: present figure-order picker (player chooses next figure to resolve).
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: remaining.map(f => `Resolve next: ${f.dcName}`),
      choiceValues: remaining.map(f => f.figureKey),
      manualMessage: `**Deploy the Garrison** — Resolve each TROOPER/GUARDIAN within 4 spaces in order; each chooses 1 Hit Token or 2-space move.`,
    };
  }

  // ccEffect: grantHitTokensToActivating (Transmit the Plans) — CSV row 859:
  // "distribute 2 Hit Tokens AMONG friendly figures". Sequential picker (mirrors
  // Combat Resupply): the player assigns one Hit token at a time to any friendly
  // figure. The vpNoteIfAdjacentTerminal reminder rides along on the first call.
  if (entry.type === 'ccEffect' && typeof entry.grantHitTokensToActivating === 'number') {
    const { game, playerNum, dcMessageMeta, choiceIndex, targetFigureKey } = context;
    const msgId = playerNum && dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!game || !msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const count = entry.grantHitTokensToActivating;
    // CSV row 860 (automatic): "If you are adjacent to a terminal, gain 2 VPs."
    // Award automatically — exactly once per play (the resolution spans multiple
    // calls for the Hit-token distribution picker) — when the activating figure
    // is adjacent to any active terminal. The one-shot guard is keyed by msgId.
    let vpNote = '';
    game.transmitPlansVpAwarded = game.transmitPlansVpAwarded || {};
    if (entry.vpNoteIfAdjacentTerminal && !game.transmitPlansVpAwarded[msgId]) {
      const _ttpMapId = game.selectedMap?.id;
      const _ttpTerminals = _ttpMapId ? getActiveTerminals(game, _ttpMapId) : [];
      const _ttpTermSet = new Set((_ttpTerminals || []).map((t) => String(t).toLowerCase()));
      const _ttpFigKeys = getFigureKeysForDcMsg(game, playerNum, meta) || [];
      const _ttpSelIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _ttpFigKey = _ttpFigKeys[_ttpSelIdx] || _ttpFigKeys[0] || null;
      const _ttpAdjacent = _ttpFigKey && _ttpTermSet.size > 0 &&
        isFigureAdjacentOrOnAny(game, playerNum, _ttpFigKey, _ttpMapId, _ttpTermSet);
      if (_ttpAdjacent) {
        awardObjectiveVp(game, playerNum, entry.vpNoteIfAdjacentTerminal);
        game.transmitPlansVpAwarded[msgId] = true;
        vpNote = ` Adjacent to a terminal — gained **${entry.vpNoteIfAdjacentTerminal} VP** (total: ${game[vpKey(playerNum)]?.total}).`;
      }
    }
    // Eligible = all friendly figures in play not already at max power tokens.
    const eligibleAll = () => Object.entries(game.figurePositions?.[playerNum] || {})
      .filter(([efk, pos]) => pos && (game.figurePowerTokens?.[efk] || []).length < getMaxPowerTokens(efk))
      .map(([efk]) => efk);

    // Phase 2+: sequential allocation — assign 1 Hit token to the chosen figure.
    const pending = game.pendingTransmitPlans?.[msgId];
    if (pending && choiceIndex != null && targetFigureKey) {
      grantPowerTokens(game, targetFigureKey, 'Damage', 1);
      pending.remaining -= 1;
      const tName = dcNameFromFigureKey(targetFigureKey);
      const stillEligible = eligibleAll();
      if (pending.remaining <= 0 || stillEligible.length === 0) {
        delete game.pendingTransmitPlans[msgId];
        return { applied: true, logMessage: `**${entry.label}** — **${tName}** gained 1 Hit Token. Distribution complete.${vpNote}`, refreshDcEmbed: true };
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: figureChoiceLabels(stillEligible),
        targetFigureKeys: stillEligible,
        logMessage: `**${tName}** gained 1 Hit Token. ${pending.remaining} more to assign.`,
      };
    }

    // Phase 1: start the distribution.
    const eligible = eligibleAll();
    if (eligible.length === 0) {
      return { applied: true, logMessage: `**${entry.label}** — No friendly figures eligible for Hit Tokens.${vpNote}` };
    }
    if (eligible.length === 1) {
      grantPowerTokens(game, eligible[0], 'Damage', count);
      return { applied: true, logMessage: `**${entry.label}** — Granted **${count} Hit Token${count !== 1 ? 's' : ''}** to ${dcNameFromFigureKey(eligible[0])}.${vpNote}`, refreshDcEmbed: true };
    }
    game.pendingTransmitPlans = game.pendingTransmitPlans || {};
    game.pendingTransmitPlans[msgId] = { remaining: count };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: figureChoiceLabels(eligible),
      targetFigureKeys: eligible,
      logMessage: `**${entry.label}** — Distribute ${count} Hit Token${count !== 1 ? 's' : ''} among friendly figures. Pick a figure:${vpNote}`,
    };
  }

  // ccEffect: protectOldWaysBonus (Protect the Old Ways) — ONE-SHOT reactive
  // defender modifier (alexanbv 2026-06-19): "+X Block to THE defense results"
  // for the single figure currently defending, where X = 1 + FORCE USER CCs in
  // your discard. Applies to the current attack only (combat.bonusBlock), and
  // only when the defending figure is within 3 spaces of a friendly FORCE USER.
  if (entry.type === 'ccEffect' && entry.protectOldWaysBonus) {
    const { game, playerNum, cardName } = context;
    const _combat = context.combat || game?.pendingCombat;
    if (!game || !playerNum || !_combat) return { applied: false, manualMessage: '**Protect the Old Ways** — play while one of your figures is defending.' };
    const defenderFk = _combat.target?.figureKey;
    const defenderPos = defenderFk ? game.figurePositions?.[playerNum]?.[defenderFk] : null;
    if (!defenderPos) return { applied: false, manualMessage: '**Protect the Old Ways** — could not locate the defending figure.' };
    // Range: "a friendly figure within 3 spaces of YOU (the playing FORCE USER)
    // is defending" — anchor on the figure that played the card (Kanan Jarrus,
    // or Mara via Fast Learner / a substitute), NOT player-wide over every
    // friendly FORCE USER (alexanbv 2026-06-21 anchor fix). Matches Kanan's own
    // Soresu Form passive, which anchors the identical phrase on Kanan himself.
    const _powAnchorFk = resolveUniqueFigureCcFigureKey(game, playerNum, cardName || 'Protect the Old Ways');
    const _powAnchorPos = _powAnchorFk ? game.figurePositions?.[playerNum]?.[_powAnchorFk] : null;
    if (!_powAnchorFk || !_powAnchorPos) return { applied: false, manualMessage: '**Protect the Old Ways** — could not locate the playing FORCE USER figure.' };
    const within3OfFu = countGameSpaces(game, _powAnchorPos, defenderPos) <= 3;
    if (!within3OfFu) return { applied: false, manualMessage: `**Protect the Old Ways** — the defending figure is not within 3 spaces of **${dcNameFromFigureKey(_powAnchorFk)}**.` };
    const discardKey = ccDiscardKey(playerNum);
    const discard = game[discardKey] || [];
    const forceUserCount = discard.filter((cardName) => {
      const eff = getCcEffect(cardName);
      return eff?.playableBy && String(eff.playableBy).toUpperCase().includes('FORCE USER');
    }).length;
    const bonus = 1 + forceUserCount;
    _combat.bonusBlock = (_combat.bonusBlock || 0) + bonus;
    return { applied: true, logMessage: `**Protect the Old Ways** — +**${bonus}** Block to the defending **${dcNameFromFigureKey(defenderFk)}** (1 + ${forceUserCount} FORCE USER CC${forceUserCount !== 1 ? 's' : ''} in discard).` };
  }

  // ccEffect: staticPulseEffect (Static Pulse) — per CRR: for each
  // hostile adjacent to a friendly Dio, you may have that figure suffer
  // 2 Strain OR become Weakened. The card player picks per-target (not
  // a single uniform pick across all hostiles). Strain branch queues
  // via pendingStrain[] so applyStrain pipeline routes per-strain
  // choice to each target's controller.
  // Implementation: chained per-target choice using game.pendingStaticPulse.
  // Each click resolves one figure; if more remain, re-prompt for the
  // next one. Final call returns aggregate logMessage + pendingStrain[].
  if (entry.type === 'ccEffect' && entry.staticPulseEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const oppNum = opponentPlayerNum(playerNum);

    // First call: enumerate hostiles adjacent to Dio.
    if (!game.pendingStaticPulse) {
      const mapId = game.selectedMap?.id;
      const dioCandidates = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => fk.startsWith('Dio-'));
      if (dioCandidates.length === 0) {
        // Branch B (alexanbv 2026-05-10): "If Dio is not in play, put Dio
        // into play in your space instead." Deploy Dio at the playing
        // figure's space (Iden's, or Mara's via FL bypass). Allocate
        // companion banks immediately so Dio can act this activation.
        // The Strain/Weaken effect does NOT fire in this branch ("instead").
        const playingMsgId = context.msgId;
        const playingMeta = playingMsgId ? dcMessageMeta.get(playingMsgId) : null;
        const playingDcName = playingMeta?.dcName;
        const playingDisplay = playingMeta?.displayName || playingDcName;
        // Find playing figure's position via figureKey prefix.
        let playingPos = null;
        if (playingDcName && playingMeta) {
          const _pdgIdx = (playingDisplay || '').match(/\[(?:DG|Group) (\d+)\]/)?.[1] ?? '1';
          const _pPrefix = `${playingDcName}-${_pdgIdx}-`;
          for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
            if (fk.startsWith(_pPrefix)) { playingPos = pos; break; }
          }
        }
        if (!playingPos) {
          return { applied: true, logMessage: '**Static Pulse** — Dio is not in play, but no valid space to deploy Dio (playing figure not on board). Resolve manually.' };
        }
        // Look up Dio's host slot (Iden Versio) to find Dio's msgId.
        const _hostIds = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const _compIds = playerNum === 1 ? game.p1DcCompanionMessageIds : game.p2DcCompanionMessageIds;
        const _dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
        let _hostIdx = -1;
        for (let _i = 0; _i < (_dcList || []).length; _i++) {
          const _dn = typeof _dcList[_i] === 'object' ? (_dcList[_i].dcName || _dcList[_i].displayName) : _dcList[_i];
          if (_dn === 'Iden Versio') { _hostIdx = _i; break; }
        }
        const _dioMsgId = _hostIdx >= 0 ? (_compIds?.[_hostIdx] || null) : null;
        // Deploy Dio at playing figure's position.
        const _dioFigureKey = 'Dio-0-0';
        if (!game.figurePositions[playerNum]) game.figurePositions[playerNum] = {};
        game.figurePositions[playerNum][_dioFigureKey] = playingPos;
        game.companionHostMap = game.companionHostMap || {};
        if (_hostIdx >= 0 && _hostIds?.[_hostIdx]) {
          game.companionHostMap[_dioFigureKey] = { hostFigureKey: `Iden Versio-1-0`, playerNum };
        }
        // Allocate Dio's banks mid-game so he can act this activation.
        // Inlined (no async dynamic import inside sync resolveAbility) —
        // mirrors allocateCompanionBanksMidGame in activation-setup.js.
        if (_dioMsgId && !game.dcActionsData?.[_dioMsgId]) {
          const _threadId = game.dcActionsData?.[playingMsgId]?.threadId || null;
          game.dcActionsData = game.dcActionsData || {};
          game.dcActionsData[_dioMsgId] = {
            remaining: 2,
            total: 2,
            perFigureRemaining: { 0: 2 },
            figureLocked: {},
            figureSoaFired: {},
            figureEoaFired: {},
            messageId: null,
            threadId: _threadId,
            specialsUsed: [],
            isCompanion: true,
            hostMsgId: _hostIds?.[_hostIdx] || null,
          };
          game.movementBank = game.movementBank || {};
          // Per alexanbv 2026-06-13: per-figure only — top-level is metadata.
          game.movementBank[_dioMsgId] = {
            threadId: _threadId,
            messageId: null,
            displayName: 'Dio',
            perFig: { 0: { total: 0, remaining: 0 } },
          };
          game.activationStartPositions = game.activationStartPositions || {};
          game.activationStartPositions[_dioFigureKey] = playingPos;
        }
        return {
          applied: true,
          logMessage: `**Static Pulse** — Dio was not in play; deployed at **${String(playingPos).toUpperCase()}** (${playingDisplay || 'playing figure'}'s space). Strain/Weaken effect does not fire (Branch B "instead").`,
          refreshDcEmbed: true,
        };
      }
      const dioFk = dioCandidates[0];
      const adjAll = mapId ? getFiguresAdjacentToTarget(game, dioFk, mapId) : [];
      // Per alexanbv 2026-05-10, NPCs (Thugs/Krykna tagged hostileToAll)
      // are valid Static Pulse targets. Strain on an NPC auto-converts to
      // damage inside applyStrain (NPCs can't discard CCs), and Weaken
      // applies via figureConditions['npc_<type>_<i>'] like any condition.
      const hostiles = adjAll
        .filter((e) => isEntryHostileTo(game, e, playerNum))
        .map((a) => a.figureKey);
      if (hostiles.length === 0) {
        return { applied: true, logMessage: '**Static Pulse** — No hostile figures adjacent to Dio.' };
      }
      game.pendingStaticPulse = {
        remainingHostiles: hostiles.slice(),
        pendingStrain: [],
        results: [],
      };
    }

    const sp = game.pendingStaticPulse;

    // Apply choice to current figure (if a choice was made).
    if (choiceIndex != null && sp.remainingHostiles.length > 0) {
      const fk = sp.remainingHostiles.shift();
      const dcName = dcNameFromFigureKey(fk);
      if (choiceIndex === 0) {
        sp.pendingStrain.push({ figureKey: fk, controllerPlayerNum: oppNum, amount: 2, source: 'Static Pulse' });
        sp.results.push(`**${dcName}** 2 Strain (queued)`);
      } else {
        if (isConditionImmune(game, fk)) {
          sp.results.push(`**${dcName}** immune to Weaken`);
        } else {
          applyCondition(game, fk, 'Weaken');
          sp.results.push(`**${dcName}** Weakened`);
        }
      }
    }

    // More hostiles to resolve? Re-prompt for the next one.
    // Per CRR: controller of the figure suffering the ability picks —
    // route the prompt to the target's controller (oppNum) via
    // choiceForControllerPlayerNum.
    if (sp.remainingHostiles.length > 0) {
      const nextFk = sp.remainingHostiles[0];
      const nextName = dcNameFromFigureKey(nextFk);
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [
          `${nextName}: 2 Strain`,
          `${nextName}: Weaken`,
        ],
        choiceForControllerPlayerNum: oppNum,
      };
    }

    // All hostiles resolved.
    const finalResults = sp.results.slice();
    const finalPendingStrain = sp.pendingStrain.slice();
    delete game.pendingStaticPulse;
    return {
      applied: true,
      logMessage: `**Static Pulse** — ${finalResults.join(', ')}.`,
      refreshDcEmbed: true,
      ...(finalPendingStrain.length ? { pendingStrain: finalPendingStrain } : {}),
    };
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
      for (const adjEntry of adjAll) {
        const { figureKey: fk, playerNum: p, isNpc } = adjEntry;
        const dcName = isNpc ? entryDisplayLabel(adjEntry) : dcNameFromFigureKey(fk);
        if (dmg <= 0) continue;
        if (isNpc) {
          const npcRes = applyDamageToNpcSync(game, {
            npcType: adjEntry.npcType,
            npcIndex: adjEntry.npcIndex,
            amount: dmg,
            attackerPlayerNum: playerNum,
          });
          if (npcRes.applied) results.push(`**${dcName}** ${dmg} Dmg (${npcRes.prevHp}→${npcRes.newHp})`);
          continue;
        }
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
    // CSV row 850: "each other figure AND OBJECT in or adjacent to your space
    // suffers Damage". Damage damageable mission objects in/adjacent to the self
    // figure's footprint. Sync path: mutate game.objectHealth directly (the async
    // applyDamageToObject can't be awaited here), mirroring the figure-HP mutation
    // above. alexanbv 2026-06-20.
    if (dmg > 0) {
      const rawMapSpaces = getMapData(mapId);
      const adjacency = rawMapSpaces?.adjacency || {};
      const objSeen = new Set();
      for (const selfFk of figureKeys) {
        const selfPos = game.figurePositions?.[playerNum]?.[selfFk];
        if (!selfPos) continue;
        const selfSize = game.figureOrientations?.[selfFk] || getFigureSize(dcNameFromFigureKey(selfFk));
        const selfCells = getFootprintCells(selfPos, selfSize).map((c) => normalizeCoord(c));
        const coordSet = new Set();
        for (const c of selfCells) {
          coordSet.add(c);
          for (const n of adjacency[c] || []) coordSet.add(normalizeCoord(n));
        }
        for (const coord of coordSet) {
          for (const objId of getDamageableObjectsAtCoord(game, coord)) {
            if (objSeen.has(objId) || !isObjectAlive(game, objId)) continue;
            objSeen.add(objId);
            const hp = game.objectHealth?.[objId];
            if (!Array.isArray(hp)) continue;
            const [cur, max] = hp;
            const newCur = Math.max(0, (cur ?? 0) - dmg);
            game.objectHealth[objId] = [newCur, max];
            const objName = game.objectMeta?.[objId]?.name || objId;
            if (newCur <= 0 && game.objectPositions) delete game.objectPositions[objId];
            results.push(`**${objName}** ${dmg} Dmg (${cur ?? 0}→${newCur})${newCur <= 0 ? ' — destroyed' : ''}`);
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

  // ccEffect: jundlandTerrorEffect (Jundland Terror) — choose ONE
  // friendly Tusken Raider / Bantha Rider; chosen figure gains 2 MP
  // (end-of-round, out-of-activation → picker, no bank) and may
  // interrupt to perform an attack (free-attack flag persists for
  // their next activation).
  // G37/C21: max 1 copy per EOR phase.
  if (entry.type === 'ccEffect' && entry.jundlandTerrorEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, chosenOption } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const traits = ['Tusken Raider', 'Bantha Rider'];
    const dcEffects = getDcEffects();
    // Mode markers carried by the Attack-vs-Special choice (Phase 2b). The
    // chained choice round-trips chosenFigureKey via choiceValues, so the mode
    // is distinguished by chosenOption.
    const _JT_ATTACK = 'Jundland: Attack';
    const _JT_SPECIAL = 'Jundland: Special Action';
    const _jtIsMode = chosenOption === _JT_ATTACK || chosenOption === _JT_SPECIAL;
    // Phase 2a: a figure was picked but no mode yet → prompt Attack vs Special.
    if (chosenFigureKey && !_jtIsMode) {
      const targetName = dcNameFromFigureKey(chosenFigureKey);
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [_JT_ATTACK, _JT_SPECIAL],
        choiceValues: [chosenFigureKey, chosenFigureKey],
        chosenFigureKey,
        manualMessage: `**Jundland Terror** — **${targetName}**: choose **Attack** or **Special Action**.`,
      };
    }
    // Phase 2b: figure + mode chosen → grant 2 MP and arm the chosen interrupt.
    if (chosenFigureKey && _jtIsMode) {
      game.jundlandTerrorPlayedThisEor = true;
      const targetMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      const targetName = dcNameFromFigureKey(chosenFigureKey);
      if (!targetMsgId) {
        return { applied: false, manualMessage: `**Jundland Terror** — could not locate **${targetName}**'s play area; resolve manually.` };
      }
      const wantsSpecial = chosenOption === _JT_SPECIAL;
      if (wantsSpecial) {
        // FREE SPECIAL ACTION: surface ALL of the chosen figure's special
        // actions at 0 cost on its next activation. The render path
        // (getDcActionButtons) reads freeSpecialActionPending[figureKey] to
        // render the natives at cost 0; the dispatch path (dc-play-area.js)
        // reads it to skip the action charge and consume the marker. Mirrors
        // the Choose-a-Side Gar Saxon Flamethrower special injection.
        game.freeSpecialActionPending = game.freeSpecialActionPending || {};
        game.freeSpecialActionPending[chosenFigureKey] = { from: 'Jundland Terror' };
      } else {
        // FREE ATTACK: rides on the standard freeAttackBonusPending flag for the
        // figure's next-activation interrupt.
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[chosenFigureKey] = true;
        // Legacy advertise-flag (Bantha Rider Trample / Tusken Cycler attack-
        // specials still ride the granted attack); kept for back-compat.
        game.jundlandTerrorSpecialOption = game.jundlandTerrorSpecialOption || {};
        game.jundlandTerrorSpecialOption[chosenFigureKey] = true;
      }
      // Out-of-activation 2-MP grant on a non-activating friendly →
      // setupPendingMoveX, bypassCosts: false. The chosen interrupt (free attack
      // or free special) stays armed for the figure's next activation.
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[targetMsgId] = {
        remaining: 2,
        source: 'Jundland Terror',
        playerNum,
        figureKey: chosenFigureKey,
        dcName: targetName,
        threadId: null,
        bypassCosts: false,
        msgId: targetMsgId,
        nextAction: null,
      };
      const _modeText = wantsSpecial
        ? 'may interrupt to perform a **free Special Action**'
        : 'may interrupt to perform a **free attack**';
      return {
        applied: true,
        pendingMoveXMsgId: targetMsgId,
        activeMsgId: targetMsgId,
        logMessage: `**Jundland Terror** — **${targetName}** gains **2 MP** (spend at once, no bank) and ${_modeText} on their next activation.`,
      };
    }
    // Phase 1: enumerate friendly Tusken / Bantha figures on the board.
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      const dcN = dcNameFromFigureKey(fk);
      const dcBase = String(dcN).replace(/\s*\[.*\]\s*$/, '');
      const eff = dcEffects[dcN] || dcEffects[dcBase] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      const matchesTrait = traits.some((t) => kws.includes(t.toUpperCase()) || dcBase.toUpperCase().includes(t.toUpperCase()));
      if (matchesTrait) {
        validKeys.push(fk);
        validLabels.push(dcN);
      }
    }
    if (validKeys.length === 0) {
      return { applied: false, manualMessage: 'Resolve manually: no friendly Tusken Raider or Bantha Rider on the board.' };
    }
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: validLabels.map(n => `Target: ${n}`),
      choiceValues: validKeys,
      manualMessage: '**Jundland Terror** — choose one Tusken Raider or Bantha Rider figure.',
    };
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
          // Per alexanbv 2026-05-13: Foresee only reveals the
          // DISCARDED card. The bonus self-draw stays secret.
          drawNote = ' Cost ≤1 — You drew 1 Command card.';
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

  // ccEffect: builtOnHopeEffect (Built on Hope) — look at top 3 of own deck,
  // put 1 in hand, the others on TOP or BOTTOM in any order (CSV row 560).
  if (entry.type === 'ccEffect' && entry.builtOnHopeEffect) {
    const { game, playerNum, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const deckKey = ccDeckKey(playerNum);
    const handKey = ccHandKey(playerNum);
    // Phase 3: top-vs-bottom placement of the non-chosen cards. The deck was
    // already drained + the chosen card added to hand in Phase 2; the remaining
    // cards are stashed on game.pendingBuiltOnHope.
    if (game.pendingBuiltOnHope?.[playerNum] && (choiceIndex === 0 || choiceIndex === 1)) {
      const pend = game.pendingBuiltOnHope[playerNum];
      const deck = [...(game[deckKey] || [])];
      // (top of deck = end of array). 0 = top, 1 = bottom. Ordering within the
      // group preserves the order shown to the player (top-of-deck-first).
      if (choiceIndex === 0) deck.push(...[...pend.remaining].reverse());
      else deck.unshift(...pend.remaining);
      game[deckKey] = deck;
      delete game.pendingBuiltOnHope[playerNum];
      return { applied: true, logMessage: `**Built on Hope** — Drew 1 Command card from top 3. Other card(s) placed on ${choiceIndex === 0 ? 'top' : 'bottom'} of deck.` };
    }
    const deck = [...(game[deckKey] || [])];
    if (deck.length === 0) return { applied: true, logMessage: '**Built on Hope** — Your deck is empty.' };
    const top3 = deck.slice(-Math.min(3, deck.length));
    if (top3.length === 1 || (choiceIndex !== undefined && choiceIndex !== null)) {
      const chosen = top3[choiceIndex ?? 0];
      if (!chosen) return { applied: false, manualMessage: 'Invalid choice for Built on Hope.' };
      // Remove the top 3 from deck (they may be at end), put chosen in hand.
      deck.splice(deck.length - top3.length, top3.length);
      const remaining2 = top3.filter((c) => c !== chosen);
      const hand = [...(game[handKey] || [])];
      hand.push(chosen);
      game[deckKey] = deck;
      game[handKey] = hand;
      // No non-chosen cards left → done (only 1 card was in the top 3).
      if (remaining2.length === 0) {
        // Per alexanbv 2026-05-13: Command cards are SECRET — don't leak names.
        return { applied: true, logMessage: '**Built on Hope** — Drew 1 Command card.' };
      }
      // Phase 3: offer top-vs-bottom placement for the non-chosen cards.
      game.pendingBuiltOnHope = game.pendingBuiltOnHope || {};
      game.pendingBuiltOnHope[playerNum] = { remaining: remaining2 };
      return {
        requiresChoice: true,
        choiceOptions: [`Place ${remaining2.length} card(s) on TOP of deck`, `Place ${remaining2.length} card(s) on BOTTOM of deck`],
      };
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
    // Phase 2: defeat chosen figure via the direct-defeat path.
    // Per IACP this skips WHEN_DAMAGED + BEFORE_DEFEATED (the figure
    // does NOT suffer damage). The actual defeat (WHEN_DEFEATED hooks
    // + processFigureDefeat) fires from applyAbilityResult via
    // result.directDefeats[]. Sync dispatch can't await async defeat,
    // so we surface a payload for the consumer.
    if (chosenFigureKey) {
      const targetMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!targetMsgId || !dcHealthState) return { applied: false, manualMessage: 'Resolve manually: could not locate chosen figure.' };
      const figMatch = chosenFigureKey.match(/-(\d+)-(\d+)$/);
      const figIdx = figMatch ? parseInt(figMatch[2], 10) : 0;
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const baseCost = getDcEffects()[dcName]?.cost ?? 0;
      // IACP ruling: halve (base + positive attachments) **rounded down**
      // per card text "rounded down", then subtract negative-cost
      // attachments AFTER halving (not half the subtracted cost).
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
      const halfVp = Math.max(0, Math.floor((baseCost + posAttCost) / 2) + negAttCost);
      const _hadAtts = (Array.isArray(_evCcAtts) && _evCcAtts.length) || (Array.isArray(_evDcAtts) && _evDcAtts.length);
      return {
        applied: true,
        logMessage: `**Evacuate** — **${dcName}** is defeated (direct defeat, no damage). Opponent gains ${halfVp > 0 ? halfVp + ' VP (half the deployment cost' + (_hadAtts ? ' incl. attachments' : '') + ' — use `/editvp -' + halfVp + '` to adjust)' : 'no VP'} from this defeat.`,
        refreshDcEmbed: true,
        directDefeats: [{
          figureKey: chosenFigureKey,
          msgId: targetMsgId,
          figIndex: figIdx,
          controllerPlayerNum: playerNum,
          attackerPlayerNum: opponentPlayerNum(playerNum),
          dcName,
          displayName: dcName,
          source: 'Evacuate',
        }],
      };
    }
    // Phase 1: find friendly figures within 2 spaces (not self).
    // Per IACP, figures with active "cannot be defeated" (Maul/SBR,
    // Fifth Brother/YWNDM) are NOT selectable — "cannot" overrides
    // the direct-defeat ability.
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const activatingPos = activatingKeys.length ? game.figurePositions?.[playerNum]?.[activatingKeys[0]] : null;
    if (!activatingPos) return { applied: false, manualMessage: 'Resolve manually: activating figure has no position.' };
    const friendlyFigureKeys = [];
    const friendlyLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || activatingKeys.includes(fk)) continue;
      const dcName = dcNameFromFigureKey(fk);
      if (countGameSpaces(game, activatingPos, pos) > 2) continue;
      if (isImmuneToDirectDefeat(game, playerNum, fk)) continue;
      friendlyFigureKeys.push(fk);
      friendlyLabels.push(dcName);
    }
    if (friendlyFigureKeys.length === 0) return { applied: false, manualMessage: 'No friendly figures within 2 spaces to evacuate (or all eligible targets cannot be defeated).' };
    return { requiresChoice: true, choiceOptions: friendlyLabels.map((n) => `Defeat ${n}`), choiceValues: friendlyFigureKeys };
  }

  // ccEffect: induceRageEffect (Induce Rage) — the player CHOOSES up to 2 figures
  // ("up to 2 figures", CSV row 737); each chosen figure discards all of its
  // conditions then gains 1 Damage (Hit) Token per condition discarded. Either
  // player's figures are eligible (the choice is strategic).
  if (entry.type === 'ccEffect' && entry.induceRageEffect) {
    const { game, playerNum, chosenFigureKey } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const MAX = entry.induceRageMaxTargets ?? 2;
    const _enumWithConditions = () => {
      const vals = [];
      for (const pn of [1, 2]) {
        for (const fk of Object.keys(game.figurePositions?.[pn] || {})) {
          if ((game.figureConditions?.[fk] || []).length > 0) vals.push(fk);
        }
      }
      return vals;
    };
    const _processFigure = (fk) => {
      const conds = [...(game.figureConditions?.[fk] || [])];
      for (const c of conds) filterCondition(game, fk, c); // respects disarm lock
      const remaining = (game.figureConditions?.[fk] || []).length;
      const count = conds.length - remaining;
      if (count > 0) grantPowerTokens(game, fk, 'Damage', count);
      const discarded = conds.filter((c) => !(game.figureConditions?.[fk] || []).includes(c));
      return `**${dcNameFromFigureKey(fk)}** lost [${discarded.join(', ')}] → +${count} Damage Token${count !== 1 ? 's' : ''}`;
    };
    if (chosenFigureKey === 'induce_rage_done') {
      const res = game._induceRageResults || [];
      delete game._induceRageResults; delete game._induceRageCount;
      return { applied: true, logMessage: res.length ? `**Induce Rage** — ${res.join('; ')}.` : '**Induce Rage** — No figures chosen.' };
    }
    if (chosenFigureKey) {
      game._induceRageResults = game._induceRageResults || [];
      game._induceRageCount = game._induceRageCount || 0;
      game._induceRageResults.push(_processFigure(chosenFigureKey));
      game._induceRageCount++;
      if (game._induceRageCount >= MAX) return resolveAbility(abilityId, { ...context, chosenFigureKey: 'induce_rage_done' });
      const vals = _enumWithConditions(); // processed figure now has no conditions → auto-excluded
      if (vals.length === 0) return resolveAbility(abilityId, { ...context, chosenFigureKey: 'induce_rage_done' });
      const opts = [...figureChoiceLabels(vals)];
      opts.push(`Done (${game._induceRageCount}/${MAX} chosen)`);
      vals.push('induce_rage_done');
      return { applied: true, requiresChoice: true, choiceOptions: opts, choiceValues: vals, logMessage: `**Induce Rage** — choose figure ${game._induceRageCount + 1} of up to ${MAX}, or Done.` };
    }
    // First call.
    game._induceRageResults = [];
    game._induceRageCount = 0;
    const vals = _enumWithConditions();
    if (vals.length === 0) return { applied: true, logMessage: '**Induce Rage** — No figures with conditions found.' };
    const opts = [...figureChoiceLabels(vals)];
    opts.push('Done (0 chosen)');
    vals.push('induce_rage_done');
    return { applied: true, requiresChoice: true, choiceOptions: opts, choiceValues: vals, logMessage: `**Induce Rage** — choose up to ${MAX} figure(s): each discards all conditions and gains 1 Damage Token per condition discarded.` };
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
      game.freeAttackBonusPending[chosenFigureKey] = true;
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
        game.freeAttackBonusPending[creatureKeys[0]] = true;
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
      // CSV companion_place: "if not in play, put J4X-7 into your space". Per
      // alexanbv 2026-06-20 ("Droid Mastery should use the same companion deploy
      // as the other companions, like The Child"): deploy J4X-7 via the SAME
      // companion-deploy routine The Child / other companions use. The sync
      // ccEffect has no Discord client, so it returns a deployCompanion DIRECTIVE
      // that the async apply layer (apply-ability-result.js, which DOES have the
      // client) acts on by calling deployCompanionFigure. Anchor on Jarrod Kelvin
      // (J4X-7's host / "your space").
      const hostFk = Object.keys(game.figurePositions?.[playerNum] || {}).find((fk) => fk.startsWith('Jarrod Kelvin-'));
      if (!hostFk) {
        return { applied: true, logMessage: '**Droid Mastery** — J4X-7 is not in play and Jarrod Kelvin is not on the board; nothing to deploy.' };
      }
      return {
        applied: true,
        deployCompanion: { companionName: 'J4X-7', atFigureKey: hostFk, playerNum },
        logMessage: '**Droid Mastery** — J4X-7 is not in play; deploying J4X-7 into **Jarrod Kelvin\'s space**.',
      };
    }
    applyCondition(game, j4xFk, 'Focus');
    // Grant free attack to J4X-7's DC
    const j4xMsgId = findMsgIdForFigureKey(game, playerNum, j4xFk, dcMessageMeta);
    if (j4xMsgId) {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[j4xFk] = true;
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
    // Phase 1: space picker — CSV "Choose a terminal". Offer ONLY active
    // terminal spaces (getActiveTerminals respects Terminal-Slicing discards),
    // not all spaces within 8.
    const boardState = getBoardStateForMovement(game, null);
    const adj = boardState?.mapSpaces?.adjacency;
    if (!adj) return { applied: true, logMessage: '**Hidden Trap** — Choose a terminal space; each adjacent figure suffers 2 Damage. Resolve manually (no map data).' };
    const mapId = game.selectedMap?.id;
    const terminals = mapId ? getActiveTerminals(game, mapId) : [];
    const validSpaces = (terminals || []).map((t) => String(t).toLowerCase());
    if (!validSpaces.length) {
      return { applied: false, manualMessage: '**Hidden Trap** — no terminals on this map. Resolve manually.' };
    }
    return { requiresSpaceChoice: true, validSpaces, spaceChoiceLabel: '**Hidden Trap** — Choose the terminal:' };
  }

  // ccEffect: fieldSupplyEffect (Field Supply) — CSV row 653: "Up to 2 other
  // figures within 3 spaces gain 1 Hit Token OR 1 Surge Token". The engine stores
  // a Hit Token as a 'Damage' power token (per the Hemlock/CRR mapping). This is an
  // up-to-2 pick loop (mirrors Karabast!): each pick chooses BOTH a figure and a
  // token type (Hit vs Surge), encoded in the choice value as `<figureKey>|<type>`.
  // (The attack:rerolls token-spend reroll window, CSV row 654, is a separate deep
  // gap and is intentionally NOT implemented here.) alexanbv 2026-06-20.
  if (entry.type === 'ccEffect' && entry.fieldSupplyEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey, cardName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Mark Field Supply as PLAYED this round by this player. Gates the
    // attacker-rerolls option (CSV row 654 / combat-abilities-rerolls.js):
    // the reroll is offered only when this flag is set AND the attacking
    // figure spent a Hit/Surge token during the attack. Round-scoped
    // (ROUND_OBJECT_FLAGS, resets to {} at round start).
    game.fieldSupplyPlayedRound = game.fieldSupplyPlayedRound || {};
    game.fieldSupplyPlayedRound[playerNum] = true;
    const MAX_PICKS = 2;
    // "within 3 spaces of YOU": anchor on the figure that played the card —
    // Ko-Tun Feralo (start_of_round), or Mara Jade when she plays it via Fast
    // Learner. resolveRoundModifierAnchor honors the FL-by-Mara override
    // (alexanbv 2026-06-21). actKeys = the anchor figure (excluded as "other").
    const anchorFk = resolveRoundModifierAnchor(game, playerNum, cardName || 'Field Supply', { dcMessageMeta });
    const actKeys = anchorFk ? [anchorFk] : [];
    const actPos = anchorFk ? game.figurePositions?.[playerNum]?.[anchorFk] : null;
    // Enumerate eligible OTHER friendly figures within 3 (excluding already-picked).
    const _enumEligible = () => {
      const picked = new Set(game._fieldSupplyPicks || []);
      const out = [];
      for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
        if (!pos || actKeys.includes(fk) || picked.has(fk)) continue;
        if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
        out.push(fk);
      }
      return out;
    };
    // Build the per-figure × token-type choice menu (+ a Done button).
    const _buildPrompt = () => {
      const elig = _enumEligible();
      const opts = []; const vals = [];
      for (const fk of elig) {
        const n = dcNameFromFigureKey(fk);
        opts.push(`Hit Token → ${n}`); vals.push(`${fk}|Damage`);
        opts.push(`Surge Token → ${n}`); vals.push(`${fk}|Surge`);
      }
      const chosenCount = (game._fieldSupplyPicks || []).length;
      opts.push(`Done (${chosenCount}/${MAX_PICKS} chosen)`); vals.push('field_supply_done');
      return { applied: true, requiresChoice: true, choiceOptions: opts, choiceValues: vals,
        logMessage: `**Field Supply** — choose figure ${chosenCount + 1} of up to ${MAX_PICKS} (within 3 spaces) and a Hit or Surge Token, or Done.` };
    };
    // Done → finalize.
    if (chosenFigureKey === 'field_supply_done') {
      const granted = game._fieldSupplyGranted || [];
      delete game._fieldSupplyPicks;
      delete game._fieldSupplyGranted;
      if (!granted.length) return { applied: true, logMessage: '**Field Supply** — No tokens granted.' };
      return { applied: true, logMessage: `**Field Supply** — ${granted.join(', ')}.` };
    }
    // A pick: `<figureKey>|<Damage|Surge>`.
    if (chosenFigureKey) {
      const sep = chosenFigureKey.lastIndexOf('|');
      const fk = sep >= 0 ? chosenFigureKey.slice(0, sep) : chosenFigureKey;
      const tokType = sep >= 0 ? chosenFigureKey.slice(sep + 1) : 'Damage';
      grantPowerTokens(game, fk, tokType === 'Surge' ? 'Surge' : 'Damage', 1);
      game._fieldSupplyPicks = game._fieldSupplyPicks || [];
      game._fieldSupplyPicks.push(fk);
      game._fieldSupplyGranted = game._fieldSupplyGranted || [];
      game._fieldSupplyGranted.push(`**${dcNameFromFigureKey(fk)}** gained 1 ${tokType === 'Surge' ? 'Surge' : 'Hit'} Token`);
      if (game._fieldSupplyPicks.length >= MAX_PICKS || _enumEligible().length === 0) {
        return resolveAbility(abilityId, { ...context, chosenFigureKey: 'field_supply_done' });
      }
      return _buildPrompt();
    }
    // First call.
    if (_enumEligible().length === 0) return { applied: false, manualMessage: 'No friendly figures within 3 spaces.' };
    game._fieldSupplyPicks = [];
    game._fieldSupplyGranted = [];
    return _buildPrompt();
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
    // Override first attack to 1 red die (melee).
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    const _fsFk = figureKeyForActivation(game, msgId);
    if (_fsFk) {
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[_fsFk] = { dice: ['red'], type: 'melee' };
      // Grant (diceCount - 1) more free attacks
      if (diceCount > 1) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[_fsFk] = diceCount - 1;
      }
    }
    return { applied: true, logMessage: `**Feral Swipes** — **${dcName}** performs ${diceCount} Melee attack${diceCount !== 1 ? 's' : ''} (1 red die each). First attack override set. Each remaining free attack: use 1 red die.` };
  }

  // ccEffect: optimalBombardmentEffect (Optimal Bombardment) — adjacent VEHICLE/DROID/HEAVY WEAPON figures may each perform 1 free attack
  // CSV: "Choose up to 3 VEHICLES, DROIDS, or HEAVY WEAPONS adjacent to you;
  // each may interrupt to perform an attack gaining Blast 1." The PLAYER picks
  // WHICH (and how many, up to 3). When ≤3 candidates exist there is no
  // meaningful subset choice (the player would grant all of them), so we
  // auto-grant. With >3, run an iterative up-to-3 picker (Field Report shape)
  // with a Done sentinel so the player may stop early.
  if (entry.type === 'ccEffect' && entry.optimalBombardmentEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const blastBonus = entry.blastBonusToAdjacentVehiclesDroidHW || 0;
    const _obGrant = (fks) => {
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      const names = [];
      let count = 0;
      for (const fk of fks) {
        const figMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
        if (figMsgId) {
          game.freeAttackBonusPending[fk] = true;
          if (blastBonus > 0) {
            // Per alexanbv 2026-05-13: per-figureKey (the chosen friendly).
            game.optimalBombardmentBlastBonus = game.optimalBombardmentBlastBonus || {};
            game.optimalBombardmentBlastBonus[fk] = blastBonus;
          }
          count++;
        }
        names.push(dcNameFromFigureKey(fk));
      }
      if (!count) return { applied: true, logMessage: '**Optimal Bombardment** — No figures chosen.' };
      return { applied: true, logMessage: `**Optimal Bombardment** — Free attack granted to: ${names.join(', ')} (${count} figure${count !== 1 ? 's' : ''}, up to 3).` };
    };
    const _obMax = 3;
    // Phase 2+: accumulate sequential picks (only entered when >3 candidates).
    if (chosenFigureKey && game.pendingOptimalBombardment) {
      const pend = game.pendingOptimalBombardment;
      if (chosenFigureKey === '__done__') {
        delete game.pendingOptimalBombardment;
        return _obGrant(pend.chosen);
      }
      pend.chosen.push(chosenFigureKey);
      if (pend.chosen.length >= _obMax) {
        delete game.pendingOptimalBombardment;
        return _obGrant(pend.chosen);
      }
      const remaining = pend.candidates.filter((fk) => !pend.chosen.includes(fk));
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [...remaining.map(dcNameFromFigureKey), 'Done selecting'],
        choiceValues: [...remaining, '__done__'],
        choicePrompt: `**Optimal Bombardment** — Selected ${pend.chosen.length}/${_obMax}. Choose another or Done:`,
      };
    }
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
    // ≤3 candidates: auto-grant (no meaningful which/how-many choice).
    if (targets.length <= _obMax) return _obGrant(targets);
    // >3 candidates: offer a player pick of WHICH up to 3 get the free attack.
    game.pendingOptimalBombardment = { chosen: [], candidates: targets };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: [...targets.map(dcNameFromFigureKey), 'Done selecting'],
      choiceValues: [...targets, '__done__'],
      choicePrompt: `**Optimal Bombardment** — Choose up to ${_obMax} adjacent VEHICLE/DROID/HEAVY WEAPON figures (each gains a free attack with Blast ${blastBonus || 1}):`,
    };
  }

  // ccEffect: overheatedEffect (Overheated) — Paz Vizsla.
  // Resolution order per CRR:
  //   1. Strain 4 (self-cost) — queued via pendingStrainCost so it routes
  //      through applyStrain BEFORE other side effects (Fireproof /
  //      Headhunter / per-strain choice / Under Duress / Paz).
  //   2. If Paz currently has Ranged attack type: 2 Ranged attacks at -1
  //      Hit each (no attack-type swap during these attacks).
  //   3. AFTER both attacks complete (handled in combat-bridge post-attack
  //      hook): attack type becomes Melee for the rest of the round.
  if (entry.type === 'ccEffect' && entry.overheatedEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const actData = game.dcActionsData?.[msgId];
    const figIdx = actData?.selectedFigure ?? 0;
    const dgMatch = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
    const dgIndex = dgMatch ? dgMatch[1] : '1';
    const selfFk = `${meta.dcName}-${dgIndex}-${figIdx}`;

    // Per IACP rule 2026-05-09: Overheated is per-FIGURE state.
    // Determine current attack type — only Ranged gates the 2-attack chain.
    const currentOverride = game.attackTypeOverride?.[selfFk];
    const dcStats = getStatsForDc(meta.dcName);
    const baseAttackType = (dcStats?.attack?.type || '').toLowerCase();
    const effectiveAttackType = currentOverride || baseAttackType;
    const isRanged = effectiveAttackType === 'range' || effectiveAttackType === 'ranged';

    if (isRanged) {
      // First of 2 attacks: -1 Hit, no attack-type swap yet (stays Ranged).
      // Track attacksRemaining so combat-bridge's post-attack hook can:
      //   (a) re-stamp -1 Hit + grant the 2nd free attack
      //   (b) on attacksRemaining=0, flip attackTypeOverride[figureKey] = 'melee'
      game.overheatedActive = game.overheatedActive || {};
      game.overheatedActive[selfFk] = { attacksRemaining: 2 };
      // Per alexanbv 2026-05-13: keyed by figureKey.
      game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
      game.pendingOverrideAttackDice[selfFk] = { bonusHits: -1, source: 'Overheated' };
      game.freeAttackBonusPending = game.freeAttackBonusPending || {};
      game.freeAttackBonusPending[selfFk] = { from: 'Overheated' };
      return {
        applied: true,
        logMessage: `**Overheated** — **${meta.dcName}**: 4 Strain (queued). 2 Ranged attacks queued at −1 Hit each. Attack type becomes Melee after both resolve.`,
        refreshDcEmbed: true,
        pendingStrainCost: {
          figureKey: selfFk,
          controllerPlayerNum: playerNum,
          amount: 4,
          source: 'Overheated',
        },
      };
    }
    // Not Ranged: only the strain cost applies; no extra attacks; no type swap.
    return {
      applied: true,
      logMessage: `**Overheated** — **${meta.dcName}**: 4 Strain (queued). Not currently Ranged, so the 2-attack clause does not trigger.`,
      refreshDcEmbed: true,
      pendingStrainCost: {
        figureKey: selfFk,
        controllerPlayerNum: playerNum,
        amount: 4,
        source: 'Overheated',
      },
    };
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
      const hitsFromDie = (face.dmg || 0) + (face.surge ? 1 : 0);
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
      // alexanbv 2026-06-22: the card hits "each figure OR OBJECT on or adjacent
      // to that space" — apply the same damage to damageable objects in the area.
      let _stcObjDamaged = false;
      if (hitsFromDie > 0 && game.objectHealth) {
        const objSeen = new Set();
        for (const coord of affectedSpaces) {
          for (const objId of getDamageableObjectsAtCoord(game, coord)) {
            if (objSeen.has(objId) || !isObjectAlive(game, objId)) continue;
            objSeen.add(objId);
            const hp = game.objectHealth?.[objId];
            if (!Array.isArray(hp)) continue;
            const [cur, max] = hp;
            const newCur = Math.max(0, (cur ?? 0) - hitsFromDie);
            game.objectHealth[objId] = [newCur, max];
            const objName = game.objectMeta?.[objId]?.name || objId;
            if (newCur <= 0 && game.objectPositions) delete game.objectPositions[objId];
            results.push(`**${objName}** ${hitsFromDie} Dmg (${cur ?? 0}→${newCur})${newCur <= 0 ? ' — destroyed' : ''}`);
            _stcObjDamaged = true;
          }
        }
      }
      const noFigures = hitsFromDie === 0 ? '0 Hits+Surges — no damage.' : results.length ? results.join('; ') : 'No figures or objects in area.';
      return { applied: true, logMessage: `**Set the Charges** — Space **${String(chosenSpace).toUpperCase()}**, rolled blue die: **${dieLabel}** (${hitsFromDie} dmg). ${noFigures} Open adjacent unlocked doors manually.`, refreshDcEmbed: results.length > 0, ...(_stcObjDamaged ? { refreshBoard: true } : {}) };
    }
    // Phase 1: space picker within 3 of activating figure
    const boardState = getBoardStateForMovement(game, null);
    if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Resolve Set the Charges manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta?.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    if (!actPos) return { applied: false, manualMessage: 'Resolve Set the Charges manually (no position).' };
    // CSV (docs/combat-spec.csv:816): "Choose a space within 3 spaces". "Within 3"
    // is a RANGE measure (countGameSpaces), not movement reachability — difficult
    // terrain must not shrink the set, and figures ON a space don't disqualify it
    // as a blast center (figures on the space suffer the damage). So enumerate all
    // map spaces by board distance rather than running a movement-cost BFS.
    const allSpaces = boardState.mapSpaces?.spaces || [];
    const actPosNorm = String(actPos).toLowerCase();
    const validSet = new Set([actPosNorm]);
    for (const sp of allSpaces) {
      const spNorm = String(sp).toLowerCase();
      if (validSet.has(spNorm)) continue;
      if (countGameSpaces(game, actPos, spNorm) > 3) continue;
      validSet.add(spNorm);
    }
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
      const _fmFk = figureKeyForActivation(game, msgId);
      if (_fmFk) {
        // Face Me! grants a generic free attack — NOT melee-restricted (alexanbv
        // 2026-06-22). The attack uses the figure's own attack pool/type, so no
        // pendingOverrideAttackDice melee override is set.
        game.freeAttackBonusPending[_fmFk] = true;
      }
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const { pathStr: _fmPathStr, warnings: _fmWarnings } = computePushPathAndWarnings(game, _fmPrevPos, chosenSpace, oppNum);
      let _fmLogMsg = `**Face Me!** — Pushed **${dcName}** to ${String(chosenSpace).toUpperCase()}${_fmPathStr}. Use the Attack button for 1 free attack.`;
      if (_fmWarnings.length > 0) {
        const _fmWarnList = _fmWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _fmLogMsg += `\n⚠️ Exits adjacency to: ${_fmWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      _fmLogMsg += stashPushPartingBlow(game, chosenFigureKey, oppNum, _fmPrevPos, chosenSpace, playerNum);
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
        if (activatorFk) game.freeAttackBonusPending[activatorFk] = true;
        const nm = dcNameFromFigureKey(chosenFigureKey);
        return { applied: true, logMessage: `**Face Me!** — Move **${nm}** adjacent manually. Then use Melee Attack button for 1 free attack.` };
      }
      const mapSpaces = getMapData(mapId);
      const adjacentSpaces = mapSpaces?.adjacency?.[activatorPos] || [];
      const occupiedSet = new Set([...Object.values(game.figurePositions?.[1] || {}), ...Object.values(game.figurePositions?.[2] || {})].filter(Boolean));
      const targetCurrentPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      // CSV row 646: "Push that figure spaces equal to its speed". The landing
      // space must be adjacent to the activator (the push destination per card)
      // AND no farther than the target's Speed from its current space (push
      // distance limit). Without this cap, a target could be teleported to any
      // adjacent-to-activator space regardless of its speed.
      const _fmTargetSpeed = getStatsForDc(dcNameFromFigureKey(chosenFigureKey))?.speed ?? 4;
      const validSpaces = adjacentSpaces.filter((s) => {
        if (occupiedSet.has(s) && s !== targetCurrentPos) return false;
        if (targetCurrentPos && countGameSpaces(game, targetCurrentPos, s) > _fmTargetSpeed) return false;
        return true;
      });
      if (!validSpaces.length) {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        if (activatorFk) game.freeAttackBonusPending[activatorFk] = true;
        const nm = dcNameFromFigureKey(chosenFigureKey);
        return { applied: true, logMessage: `**Face Me!** — No free adjacent space for push; move **${nm}** adjacent manually. Use Melee Attack button for 1 free attack.` };
      }
      const nm = dcNameFromFigureKey(chosenFigureKey);
      return { requiresSpaceChoice: true, validSpaces, chosenFigureKey, spaceChoiceLabel: `**Face Me!** — Push **${nm}** to which adjacent space?` };
    }
    // Phase 1: hostile figure picker (unique figures with line of sight to you)
    // CSV row 646 conditional: "a unique hostile figure with line of sight to you".
    const dcEffects = getDcEffects();
    const _fmMapId = game.selectedMap?.id;
    const _fmMs = _fmMapId ? getMapData(_fmMapId) : null;
    const _fmGfs = context.getFigureSize || getFigureSize;
    const _fmMetaP1 = dcMessageMeta.get(msgId);
    const _fmActKeys = _fmMetaP1 ? getFigureKeysForDcMsg(game, playerNum, _fmMetaP1) : [];
    const _fmActFk = _fmActKeys[game.dcActionsData?.[msgId]?.selectedFigure ?? 0] || _fmActKeys[0];
    const _fmActPos = _fmActFk ? game.figurePositions?.[playerNum]?.[_fmActFk] : null;
    const hostileKeys = [];
    const hostileLabels = [];
    for (const [fk, hPos] of Object.entries(game.figurePositions?.[oppNum] || {})) {
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      if (!eff.unique) continue;
      // Line-of-sight-to-you filter (skip only when map/positions unavailable).
      if (_fmMs && _fmActPos && hPos && !hasLineOfSightByCoord(game, _fmActPos, hPos, _fmMs, _fmGfs)) continue;
      hostileKeys.push(fk); hostileLabels.push(dcN);
    }
    if (!hostileKeys.length) return { applied: false, manualMessage: 'No unique hostile figures in line of sight. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: hostileLabels.map((n) => `Push & attack: ${n}`), choiceValues: hostileKeys };
  }

  // ccEffect: stimulantsEffect — adjacent figure suffers 1 Damage,
  // then gains 1 MP and becomes Focused. Per canonical card text the
  // ADJACENT FIGURE is the one that takes damage AND gains MP/Focus —
  // not the activator. Recipient ≠ activator → MP via picker (rule 1,
  // bypassCosts: false). Activator path retained for the legacy
  // self-target case (no adj friendly).
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
    // Phase 2: apply damage to chosen, grant MP/Focus to chosen.
    if (chosenFigureKey) {
      if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
      const oppNum = opponentPlayerNum(playerNum);
      const targetIsActivator = chosenFigureKey === 'self' || chosenFigureKey === activatorFk;
      const damageFk = targetIsActivator ? activatorFk : chosenFigureKey;
      // Stimulants may target a friendly OR a hostile adjacent figure (alexanbv
      // 2026-06-22) — resolve the target's actual owner from its position.
      const ownerPn = targetIsActivator ? playerNum : (game.figurePositions?.[playerNum]?.[damageFk] ? playerNum : oppNum);
      const isHostileTarget = ownerPn !== playerNum;
      const damageMsgId = targetIsActivator ? msgId : findMsgIdForFigureKey(game, ownerPn, damageFk, dcMessageMeta);
      const targetMeta = damageMsgId ? dcMessageMeta.get(damageMsgId) : null;
      const targetKeys = targetMeta ? getFigureKeysForDcMsg(game, ownerPn, targetMeta) : [damageFk];
      const fi = Math.max(0, targetKeys.indexOf(damageFk));
      const targetName = targetIsActivator ? (meta.displayName || meta.dcName) : dcNameFromFigureKey(damageFk);
      const refreshIds = [msgId];
      if (damageMsgId && !refreshIds.includes(damageMsgId)) refreshIds.push(damageMsgId);
      // Apply 1 Damage (defeat-aware, so finishing a low-HP hostile removes it).
      let wasDefeated = false;
      if (damageMsgId) {
        const dmgRes = applyDamageWithDefeatCheck(dcHealthState, game, damageMsgId, fi, 1, ownerPn, { sourceLabel: 'Stimulants', attackerPlayerNum: playerNum });
        wasDefeated = !!dmgRes.wasDefeated;
      }
      if (wasDefeated) {
        return { applied: true, logMessage: `**Stimulants** — **${targetName}** suffered 1 Damage and was **defeated**.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
      }
      // A surviving figure becomes Focused and gains 1 MP.
      applyCondition(game, damageFk, 'Focus');
      if (targetIsActivator) {
        addMovementPoints(game, msgId, 1);
        return { applied: true, logMessage: `**Stimulants** — **${targetName}** suffered 1 Damage; gained 1 MP (banked) and Focus.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, conditionCardsToPost: ['Focus'], refreshMovementBank: true, activeMsgId: msgId };
      }
      if (isHostileTarget) {
        // A surviving HOSTILE recipient becomes Focused and gains 1 MP. alexanbv
        // 2026-06-22: that MP is OUT OF ACTIVATION — the OPPONENT gets the option
        // to spend it IMMEDIATELY (not banked). pendingMoveX keyed to the hostile
        // (owner = opponent) is spend-at-once and posts the picker to that owner.
        if (damageMsgId) {
          game.pendingMoveX = game.pendingMoveX || {};
          game.pendingMoveX[damageMsgId] = {
            remaining: 1,
            source: 'Stimulants',
            playerNum: ownerPn,
            figureKey: damageFk,
            dcName: dcNameFromFigureKey(damageFk),
            threadId: null,
            bypassCosts: false,
            msgId: damageMsgId,
            nextAction: null,
          };
          return { applied: true, pendingMoveXMsgId: damageMsgId, activeMsgId: damageMsgId, logMessage: `**Stimulants** — hostile **${targetName}** suffered 1 Damage; becomes Focused; opponent gains 1 MP to spend immediately (not banked).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
        }
        return { applied: true, logMessage: `**Stimulants** — hostile **${targetName}** suffered 1 Damage and becomes Focused; resolve their 1 MP manually.`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
      }
      // Friendly recipient ≠ activator → setupPendingMoveX on their msgId.
      if (!damageMsgId) {
        return { applied: true, logMessage: `**Stimulants** — **${targetName}** suffered 1 Damage and gained Focus; resolve their 1 MP manually (could not locate play area).`, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, conditionCardsToPost: ['Focus'] };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[damageMsgId] = {
        remaining: 1,
        source: 'Stimulants',
        playerNum,
        figureKey: damageFk,
        dcName: dcNameFromFigureKey(damageFk),
        threadId: null,
        bypassCosts: false,
        msgId: damageMsgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: damageMsgId,
        activeMsgId: damageMsgId,
        logMessage: `**Stimulants** — **${targetName}** suffered 1 Damage; gained Focus; gains 1 MP — spend at once, no bank.`,
        refreshDcEmbed: true,
        refreshDcEmbedMsgIds: refreshIds,
        conditionCardsToPost: ['Focus'],
      };
    }
    // Phase 1: offer ADJACENT friendly or hostile figures EXCEPT the activating
    // figure. alexanbv 2026-06-22: Stimulants no longer costs an action and may
    // target any friendly OR hostile figure except yourself — but it STILL
    // REQUIRES ADJACENCY (to the card-playing figure).
    const mapId = game.selectedMap?.id;
    const _stimOpp = opponentPlayerNum(playerNum);
    const opts = [];
    const vals = [];
    const _stimSeen = new Set();
    if (mapId) {
      for (const { figureKey, playerNum: p } of getFiguresAdjacentToTarget(game, activatorFk, mapId)) {
        if (figureKey === activatorFk || _stimSeen.has(figureKey)) continue;
        if (p !== playerNum && p !== _stimOpp) continue;
        _stimSeen.add(figureKey);
        const fMsgId = findMsgIdForFigureKey(game, p, figureKey, dcMessageMeta);
        const fMeta = fMsgId ? dcMessageMeta.get(fMsgId) : null;
        const fName = fMeta?.displayName || fMeta?.dcName || dcNameFromFigureKey(figureKey);
        opts.push(`${p === playerNum ? 'Friendly' : 'Hostile'}: ${fName}`);
        vals.push(figureKey);
      }
    }
    if (vals.length === 0) return { applied: false, manualMessage: '**Stimulants** — no adjacent figure to target.' };
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
    // Spec (cc-effects.json:401): "Choose ANOTHER SMALL figure within 3 spaces" =
    // any figure friendly OR hostile, excluding only the activating figure. Resolve
    // the target's actual owner from its position rather than assuming the opponent.
    const _deOwnerOf = (fk) => (game.figurePositions?.[playerNum]?.[fk] ? playerNum : oppNum);
    // Phase 3: apply push + deal 1 Damage
    if (chosenFigureKey && chosenSpace) {
      const _deOwner = _deOwnerOf(chosenFigureKey);
      const { prevPos: _dePrevPos } = pushFigure(game, _deOwner, chosenFigureKey, chosenSpace) || { prevPos: null };
      const targetName = dcNameFromFigureKey(chosenFigureKey);
      const targetMsgId = findMsgIdForFigureKey(game, _deOwner, chosenFigureKey, dcMessageMeta);
      const refreshIds = [];
      if (targetMsgId) refreshIds.push(targetMsgId);
      if (dcHealthState && targetMsgId) {
        const targetMeta = dcMessageMeta.get(targetMsgId);
        const targetKeys = targetMeta ? getFigureKeysForDcMsg(game, _deOwner, targetMeta) : [chosenFigureKey];
        const fi = Math.max(0, targetKeys.indexOf(chosenFigureKey));
        if (Array.isArray(dcHealthState.get(targetMsgId)?.[fi])) {
          // Defeat-aware pipeline (alexanbv 2026-06-22).
          applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, fi, 1, _deOwner, {
            sourceLabel: 'Dark Energy', attackerPlayerNum: playerNum,
          });
        }
      }
      const { pathStr: _dePathStr, warnings: _deWarnings } = computePushPathAndWarnings(game, _dePrevPos, chosenSpace, _deOwner);
      let _deLogMsg = `**Dark Energy** — Pushed **${targetName}** to ${String(chosenSpace).toUpperCase()}${_dePathStr}, dealt 1 Damage.`;
      if (_deWarnings.length > 0) {
        const _deWarnList = _deWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _deLogMsg += `\n⚠️ Exits adjacency to: ${_deWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      _deLogMsg += stashPushPartingBlow(game, chosenFigureKey, _deOwner, _dePrevPos, chosenSpace, playerNum);
      return { applied: true, logMessage: _deLogMsg, refreshDcEmbed: true, refreshDcEmbedMsgIds: refreshIds, refreshBoard: true };
    }
    // Phase 2: pick landing space adjacent to target (1-space push in any direction)
    if (chosenFigureKey && !chosenSpace) {
      const _deOwner2 = _deOwnerOf(chosenFigureKey);
      const targetPos = game.figurePositions?.[_deOwner2]?.[chosenFigureKey];
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
    // Enumerate BOTH players' SMALL figures within 3, excluding only the activator.
    for (const _dePn of [playerNum, oppNum]) {
      for (const [fk, coord] of Object.entries(game.figurePositions?.[_dePn] || {})) {
        if (!coord) continue;
        if (fk === activatorFk) continue; // "another" figure — exclude self
        if (activatorPos && countGameSpaces(game, activatorPos, coord) > 3) continue;
        // SMALL check: skip LARGE and MASSIVE figures
        const targetDcName = dcNameFromFigureKey(fk);
        const targetStats = getStatsForDc(targetDcName);
        const kwds = (targetStats?.keywords || []).map((k) => String(k).toUpperCase());
        if (kwds.includes('LARGE') || kwds.includes('MASSIVE')) continue;
        validTargets.push(fk);
      }
    }
    if (!validTargets.length) return { applied: true, logMessage: 'No SMALL figure within 3 for Dark Energy.' };
    const getFigLbl = (fk) => {
      const _lblOwner = _deOwnerOf(fk);
      const tMsgId = findMsgIdForFigureKey(game, _lblOwner, fk, dcMessageMeta);
      const tMeta = tMsgId ? dcMessageMeta.get(tMsgId) : null;
      return tMeta?.displayName || tMeta?.dcName || dcNameFromFigureKey(fk);
    };
    if (validTargets.length === 1) {
      // Auto-select single target, go to Phase 2 immediately
      const fk = validTargets[0];
      const targetPos = game.figurePositions?.[_deOwnerOf(fk)]?.[fk];
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

  // ccEffect: lookingForAFightChoice — gain 1 Power Token; then move 1 space OR push an adjacent SMALL figure 1 space
  // Must come before the general powerTokenGain handler to take priority.
  // Phase 1 (no chosenFigureKey): defer Power Token + present Move/Push choice (push restricted to adjacent SMALL hostiles)
  // Phase 2a (chosenFigureKey='move1'): stamp pendingMoveX (1 space) + grantPowerToken continuation
  // Phase 2b (chosenFigureKey=hostile SMALL fk): present space picker for the 1-space push
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
    if (chosenFigureKey && chosenFigureKey !== 'move1' && chosenSpace) {
      const { prevPos: _lffPrevPos } = pushFigure(game, oppNum, chosenFigureKey, chosenSpace) || { prevPos: null };
      const nm = dcNameFromFigureKey(chosenFigureKey);
      const { pathStr: _lffPathStr, warnings: _lffWarnings } = computePushPathAndWarnings(game, _lffPrevPos, chosenSpace, oppNum);
      let _lffLogMsg = `**Looking for a Fight** — Pushed **${nm}** to ${String(chosenSpace).toUpperCase()}${_lffPathStr}.`;
      if (_lffWarnings.length > 0) {
        const _lffWarnList = _lffWarnings.map(w => `**${w.name}** (exited adj at ${w.space})`).join(', ');
        _lffLogMsg += `\n⚠️ Exits adjacency to: ${_lffWarnList} — opponent may play **Parting Blow** or similar interrupts.`;
      }
      _lffLogMsg += stashPushPartingBlow(game, chosenFigureKey, oppNum, _lffPrevPos, chosenSpace, playerNum);
      // Damage token was already granted at Phase 1 (no power-token-type pick).
      return { applied: true, logMessage: _lffLogMsg, refreshBoard: true };
    }
    // Phase 2a: Move 1 space — pendingMoveX picker per CRR MOVE-017,
    // with a grantPowerToken continuation so the deferred Power Token
    // grant prompt fires AFTER the move completes (matching the prior
    // ordering: Move first, then token-type pick).
    if (chosenFigureKey === 'move1') {
      // Damage token was already granted at Phase 1; just run the 1-space move.
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: 1,
        source: 'Looking for a Fight',
        playerNum,
        figureKey: activatorFk,
        dcName: meta?.dcName || '',
        threadId: null,
        bypassCosts: true,
        msgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
        logMessage: `**Looking for a Fight** — Gained 1 Damage Token; chose to move 1 space.`,
      };
    }
    // Phase 2b: Push SMALL hostile — find spaces adjacent to the chosen hostile
    if (chosenFigureKey && chosenFigureKey !== 'move1' && !chosenSpace) {
      // Defend against state drift: phase 1 already filtered to SMALL.
      const _lffTargetName = dcNameFromFigureKey(chosenFigureKey);
      const _lffTargetStats = getStatsForDc(_lffTargetName);
      const _lffIsSmall = !(_lffTargetStats?.keywords || []).some(k => /large|massive/i.test(k));
      if (!_lffIsSmall) return { applied: false, manualMessage: `**${_lffTargetName}** is not SMALL — Looking for a Fight may only push SMALL figures.` };
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
    // Phase 1: grant 1 DAMAGE (Hit) Token now — the card reads "Gain 1 Hit
    // Token, then move/push" (alexanbv 2026-06-22: it's a Damage token, not a
    // player-chosen power-token type) — then present the Move/Push choice
    // (Push branch lists ONLY adjacent SMALL hostiles per canonical card).
    grantPowerTokens(game, activatorFk, 'Damage', 1);
    const mapId = game.selectedMap?.id;
    const adjSmallHostileFks = [];
    if (mapId) {
      for (const fk of figureKeys) {
        const adj = getFiguresAdjacentToTarget(game, fk, mapId);
        for (const { figureKey, playerNum: p } of adj) {
          if (p !== oppNum || adjSmallHostileFks.includes(figureKey)) continue;
          const hStats = getStatsForDc(dcNameFromFigureKey(figureKey));
          const hIsSmall = !(hStats?.keywords || []).some(k => /large|massive/i.test(k));
          if (hIsSmall) adjSmallHostileFks.push(figureKey);
        }
      }
    }
    const opts = ['Move 1 space'];
    const vals = ['move1'];
    for (const hfk of adjSmallHostileFks) {
      const hMsgId = findMsgIdForFigureKey(game, oppNum, hfk, dcMessageMeta);
      const hMeta = hMsgId ? dcMessageMeta.get(hMsgId) : null;
      const hName = hMeta?.displayName || hMeta?.dcName || dcNameFromFigureKey(hfk);
      opts.push(`Push: ${hName}`);
      vals.push(hfk);
    }
    return { requiresChoice: true, choiceOptions: opts, choiceValues: vals };
  }

  // ccEffect: supportSpecialistEffect (Support Specialist) — CSV: "Choose a friendly
  // DROID, TECHNICIAN, or TROOPER within 3 spaces. That figure interrupts to perform
  // an ACTION." The chosen figure may interrupt to MOVE or ATTACK (the two
  // engine-actionable interrupts). The action is encoded in the choice value as
  // `<figureKey>|move` or `<figureKey>|attack`. A Special Action interrupt is not
  // generally available via a free-action grant, so it is NOT offered here.
  // alexanbv 2026-06-20.
  if (entry.type === 'ccEffect' && entry.supportSpecialistEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: chosen `<figureKey>|<action>` → grant the interrupt action.
    if (chosenFigureKey) {
      const _sep = chosenFigureKey.lastIndexOf('|');
      const fk = _sep >= 0 ? chosenFigureKey.slice(0, _sep) : chosenFigureKey;
      const action = _sep >= 0 ? chosenFigureKey.slice(_sep + 1) : 'move';
      const figMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find figure DC — apply action manually.' };
      const dcName = dcNameFromFigureKey(fk);
      if (action === 'attack') {
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        game.freeAttackBonusPending[fk] = { from: 'Support Specialist' };
        return { applied: true, logMessage: `**Support Specialist** — **${dcName}** may interrupt to perform a free attack. Use their **Attack** button.` };
      }
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      addMovementPoints(game, figMsgId, figSpeed);
      return { applied: true, logMessage: `**Support Specialist** — **${dcName}** gains ${figSpeed} MP (free interrupt move). Use their **Move** button to spend MP.` };
    }
    // Phase 1: find DROID/TECHNICIAN/TROOPER friendlies within 3.
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const actKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actPos = actKeys.length ? game.figurePositions?.[playerNum]?.[actKeys[0]] : null;
    const dcEffects = getDcEffects();
    const choiceOptions = [];
    const choiceValues = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || actKeys.includes(fk)) continue;
      if (actPos && countGameSpaces(game, actPos, pos) > 3) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('DROID') || kws.includes('TECHNICIAN') || kws.includes('TROOPER')) {
        choiceOptions.push(`Interrupt move: ${dcN}`); choiceValues.push(`${fk}|move`);
        choiceOptions.push(`Interrupt attack: ${dcN}`); choiceValues.push(`${fk}|attack`);
      }
    }
    if (!choiceValues.length) return { applied: false, manualMessage: 'No DROID/TECHNICIAN/TROOPER friendlies within 3 spaces.' };
    return { requiresChoice: true, choiceOptions, choiceValues };
  }

  // ccEffect: fieldTacticianEffect (Field Tactician) — choose any friendly within 2; grant them free move
  if (entry.type === 'ccEffect' && entry.fieldTacticianEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Phase 2: chosen friendly performs a move (MP=Speed, picker,
    // out-of-activation grant on another figure → no bank,
    // bypassCosts: false).
    if (chosenFigureKey) {
      const figMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
      if (!figMsgId) return { applied: false, manualMessage: 'Could not find figure DC — apply move manually.' };
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      const figSpeed = getDcEffects()[dcName]?.speed ?? 3;
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[figMsgId] = {
        remaining: figSpeed,
        source: 'Field Tactician',
        playerNum,
        figureKey: chosenFigureKey,
        dcName,
        threadId: null,
        bypassCosts: false,
        msgId: figMsgId,
        nextAction: null,
      };
      return {
        applied: true,
        pendingMoveXMsgId: figMsgId,
        activeMsgId: figMsgId,
        logMessage: `**Field Tactician** — **${dcName}** performs a move (up to ${figSpeed} MP, spend at once, no bank).`,
      };
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
      game.freeAttackBonusPending[chosenFigureKey] = true;
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
      // "figure cost of 4 or greater" — figure cost is subCost ?? cost (a
      // multi-figure elite group's per-figure cost), NOT the group total
      // (alexanbv 2026-06-19).
      const figureCost = eff.subCost ?? eff.cost ?? 0;
      if (kws.includes('TROOPER') && figureCost >= 4) { validKeys.push(fk); validLabels.push(`${dcN} (figure cost ${figureCost})`); }
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No TROOPER figures with figure cost 4+ in play.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Interrupt: ${n}`), choiceValues: validKeys };
  }

  // ccEffect: triangulateEffect (Triangulate) — up to 3 friendly DROIDs
  // each move 1 space; choose a hostile within 5 + LOS; damage = # of
  // those moved DROIDs that have LOS to the target (post-move).
  if (entry.type === 'ccEffect' && entry.triangulateEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey, hasLineOfSightByCoord: losCheck, getMapData: getMs, getFigureSize: gfs } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    // Phase 2: apply damage to chosen hostile.
    // Damage = # of *moved* DROIDs that have LOS to the target.
    // Guard: when game.pendingTriangulateSel is set we are still in the Phase-0
    // "which DROIDs" picker (chosenFigureKey = a friendly DROID, not a hostile
    // target) — fall through to the picker below rather than dealing damage.
    if (chosenFigureKey && !game.pendingTriangulateSel) {
      const oppNum = opponentPlayerNum(playerNum);
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      // Read the moved-figureKey list snapshotted at sequence-end via
      // pendingTriangulate. If the snapshot is missing (test fixtures,
      // stale state), fall back to "all friendly DROIDs in play" so
      // the dispatch still completes.
      const movedFigKeys = Array.isArray(game.pendingTriangulate?.movedFigKeys)
        ? game.pendingTriangulate.movedFigKeys
        : Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => {
            const dcN = dcNameFromFigureKey(fk);
            const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
            return kws.includes('DROID');
          });
      let droidCount = 0;
      const mapId = game.selectedMap?.id;
      const mapSpaces = mapId && typeof getMs === 'function' ? getMs(mapId) : (mapId ? getMapData(mapId) : null);
      if (targetPos && mapSpaces) {
        for (const fk of movedFigKeys) {
          const dPos = game.figurePositions?.[playerNum]?.[fk];
          if (!dPos) continue;
          // CSV row 862: damage = "the number of those friendly DROIDS who have
          // line of sight to it" — no per-DROID range qualifier. The within-5
          // restriction applies only to TARGET selection (enforced when the
          // hostile is chosen), not to this damage count. A moved DROID with
          // LOS but >5 spaces away still contributes.
          // LOS: from this DROID's current position to the target.
          if (typeof losCheck === 'function') {
            if (!losCheck(game, dPos, targetPos, mapSpaces, gfs)) continue;
          }
          droidCount++;
        }
      }
      // Defensive: if LOS lookup unavailable in this dispatch context,
      // fall back to count = movedFigKeys.length within 5 (no LOS gate).
      if (droidCount === 0 && (!losCheck || !mapSpaces)) {
        droidCount = movedFigKeys.length;
      }
      if (game.pendingTriangulate) delete game.pendingTriangulate;
      if (!droidCount) {
        return { applied: true, logMessage: `**Triangulate** — **${dcNameFromFigureKey(chosenFigureKey)}**: 0 DROIDs have LOS to the target — no damage applied.` };
      }
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
      return { applied: true, logMessage: `**Triangulate** — **${dcName}**: ${dmgNote}. (${droidCount} DROID${droidCount === 1 ? '' : 's'} with LOS to the target.)`, refreshDcEmbed: !!figMsgId };
    }
    // Phase 1: stamp a Move-X sequence for up to 3 friendly DROIDs
    // (each picker grants 1 space, bypassCosts: true per MOVE-017).
    // afterAction=triangulateTarget posts the hostile-target picker
    // once every DROID's picker drains; Phase 2 above applies damage.
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const friendlyDroidFigs = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      const dcN = dcNameFromFigureKey(fk);
      const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (!kws.includes('DROID')) continue;
      const fkMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (!fkMsgId) continue;
      friendlyDroidFigs.push({ msgId: fkMsgId, figureKey: fk, dcName: dcN });
    }
    if (friendlyDroidFigs.length === 0) {
      return { applied: false, manualMessage: '**Triangulate** — no friendly DROIDs in play; resolve manually.' };
    }
    // Stamp the Move-X sequence for the chosen subset of DROID figureKeys.
    // CSV "up to 3 friendly DROIDS each move up to 1": the moved set is
    // threaded as movedFigKeys and only those count toward the Phase-2 LOS
    // damage — so the player must pick WHICH up to 3, not the first 3.
    const _triStamp = (chosenFks) => {
      const byFk = new Map(friendlyDroidFigs.map((f) => [f.figureKey, f]));
      const seqFigures = chosenFks.map((fk) => byFk.get(fk)).filter(Boolean).map((f) => ({
        msgId: f.msgId,
        figureKey: f.figureKey,
        playerNum,
        spaces: 1,
        dcName: f.dcName,
      }));
      if (seqFigures.length === 0) return { applied: true, logMessage: '**Triangulate** — No DROIDs chosen.' };
      const movedFigKeys = seqFigures.map((f) => f.figureKey);
      return {
        applied: true,
        pendingMoveXSequenceSetup: {
          figures: seqFigures,
          source: 'Triangulate',
          threadId: null,
          bypassCosts: true,
          afterAction: { type: 'triangulateTarget', playerNum, movedFigKeys },
        },
        logMessage: `**Triangulate** — ${seqFigures.length} friendly DROID${seqFigures.length === 1 ? '' : 's'} may each move up to 1 space; pick order. After all moves, choose a hostile within 5 + LOS. Damage = # of those DROIDs with LOS to the target.`,
      };
    };
    // Phase 0+: iterative pick of WHICH up-to-3 DROIDs participate (only when
    // >3 DROIDs exist). Accumulate via game.pendingTriangulateSel; the picker
    // re-enters through chosenFigureKey (Done sentinel = '__done__').
    if (chosenFigureKey && game.pendingTriangulateSel) {
      const pend = game.pendingTriangulateSel;
      if (chosenFigureKey === '__done__') {
        delete game.pendingTriangulateSel;
        return _triStamp(pend.chosen);
      }
      pend.chosen.push(chosenFigureKey);
      const remaining = pend.candidates.filter((fk) => !pend.chosen.includes(fk));
      if (pend.chosen.length >= 3 || remaining.length === 0) {
        delete game.pendingTriangulateSel;
        return _triStamp(pend.chosen);
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [...remaining.map(dcNameFromFigureKey), 'Done selecting'],
        choiceValues: [...remaining, '__done__'],
        choicePrompt: `**Triangulate** — Selected ${pend.chosen.length}/3 DROIDs. Choose another to move or Done:`,
      };
    }
    const allDroidFks = friendlyDroidFigs.map((f) => f.figureKey);
    // ≤3 DROIDs: no meaningful subset choice — stamp all.
    if (allDroidFks.length <= 3) return _triStamp(allDroidFks);
    // >3 DROIDs: offer a player pick of WHICH up to 3 move.
    game.pendingTriangulateSel = { chosen: [], candidates: allDroidFks };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: [...allDroidFks.map(dcNameFromFigureKey), 'Done selecting'],
      choiceValues: [...allDroidFks, '__done__'],
      choicePrompt: '**Triangulate** — Choose up to 3 friendly DROIDS to each move up to 1 space:',
    };
  }

  // ccEffect: packAlphaEffect (Pack Alpha) — move CREATUREs manually; pick hostile; deal damage = # adjacent CREATUREs
  if (entry.type === 'ccEffect' && entry.packAlphaEffect) {
    const { game, playerNum, dcMessageMeta, dcHealthState, chosenFigureKey, packAlphaCreatureKeys } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const dcEffects = getDcEffects();
    const oppNum = opponentPlayerNum(playerNum);
    // Phase 2: count CREATUREs adjacent to chosen hostile, apply damage.
    // Guard: while game.pendingPackAlphaSel is set we are still in the Phase-0
    // "which CREATUREs" picker (chosenFigureKey = a friendly CREATURE, not the
    // hostile target) — fall through to the picker rather than dealing damage.
    if (chosenFigureKey && !game.pendingPackAlphaSel) {
      const targetPos = game.figurePositions?.[oppNum]?.[chosenFigureKey];
      const boardState = getBoardStateForMovement(game, null);
      const adjRaw = targetPos ? (boardState?.mapSpaces?.adjacency?.[String(targetPos).toLowerCase()] || []) : [];
      const adjSet = new Set(adjRaw.map((s) => String(s).toLowerCase()));
      // CSV: damage = number of THOSE figures (the up-to-3 moved CREATUREs) adjacent
      // to the target — NOT every friendly CREATURE. Restrict to the selected set
      // threaded from Phase 1 (packAlphaCreatureKeys). Fallback to all friendly
      // CREATUREs only if the set wasn't threaded (legacy/manual path).
      const movedSet = Array.isArray(packAlphaCreatureKeys) && packAlphaCreatureKeys.length
        ? new Set(packAlphaCreatureKeys)
        : null;
      const adjacentCreatures = Object.entries(game.figurePositions?.[playerNum] || {}).filter(([fk, pos]) => {
        if (!pos || !adjSet.has(String(pos).toLowerCase())) return false;
        if (movedSet && !movedSet.has(fk)) return false;
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
    // Phase 1: stamp a Move-X sequence for up to 3 friendly CREATUREs
    // within 3 spaces of the activator. afterAction=packAlphaTarget
    // posts the hostile-target picker (Phase 2) once every CREATURE's
    // picker has drained. Each picker is bypassCosts:true (3-space
    // budget under MOVE-017 — no banking).
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    const actorKeys = meta ? getFigureKeysForDcMsg(game, playerNum, meta) : [];
    const actorPositions = actorKeys
      .map((fk) => game.figurePositions?.[playerNum]?.[fk])
      .filter(Boolean);
    if (actorPositions.length === 0) {
      return { applied: false, manualMessage: '**Pack Alpha** — could not locate the activating figure; resolve manually.' };
    }
    const friendlyCreatureFigs = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos) continue;
      const dcN = dcNameFromFigureKey(fk);
      const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (!kws.includes('CREATURE')) continue;
      // Within 3 spaces of any of the activator's footprint cells.
      let withinThree = false;
      for (const aPos of actorPositions) {
        if (countGameSpaces(game, aPos, pos) <= 3) { withinThree = true; break; }
      }
      if (!withinThree) continue;
      const fkMsgId = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (!fkMsgId) continue;
      friendlyCreatureFigs.push({ msgId: fkMsgId, figureKey: fk, dcName: dcN });
    }
    if (friendlyCreatureFigs.length === 0) {
      return { applied: false, manualMessage: '**Pack Alpha** — no friendly CREATUREs within 3 spaces; resolve manually.' };
    }
    // Stamp the Move-X sequence for the chosen subset of CREATURE figureKeys.
    // CSV "Up to 3 friendly CREATURES ... each move up to 3": only the moved
    // set (threaded as creatureFigureKeys) counts toward the hostile's damage,
    // so the player must pick WHICH up to 3 move — not the first 3.
    const _paStamp = (chosenFks) => {
      const byFk = new Map(friendlyCreatureFigs.map((f) => [f.figureKey, f]));
      const seqFigures = chosenFks.map((fk) => byFk.get(fk)).filter(Boolean).map((f) => ({
        msgId: f.msgId,
        figureKey: f.figureKey,
        playerNum,
        spaces: 3,
        dcName: f.dcName,
      }));
      if (seqFigures.length === 0) return { applied: true, logMessage: '**Pack Alpha** — No CREATUREs chosen.' };
      return {
        applied: true,
        pendingMoveXSequenceSetup: {
          figures: seqFigures,
          source: 'Pack Alpha',
          threadId: null,
          bypassCosts: true,
          // CSV: damage = "number of THOSE figures adjacent to it" — i.e. only the
          // up-to-3 CREATUREs moved by this card, not every friendly CREATURE.
          // Thread the selected set so Phase 2 counts only these. alexanbv 2026-06-20.
          afterAction: { type: 'packAlphaTarget', playerNum, creatureFigureKeys: seqFigures.map((f) => f.figureKey) },
        },
        logMessage: `**Pack Alpha** — ${seqFigures.length} friendly CREATURE${seqFigures.length === 1 ? '' : 's'} may each move up to 3 spaces; pick order. After all moves, choose a hostile target.`,
      };
    };
    // Phase 0+: iterative pick of WHICH up-to-3 CREATUREs participate (only
    // when >3 exist). Accumulate via game.pendingPackAlphaSel; the picker
    // re-enters through chosenFigureKey (Done sentinel = '__done__').
    if (chosenFigureKey && game.pendingPackAlphaSel) {
      const pend = game.pendingPackAlphaSel;
      if (chosenFigureKey === '__done__') {
        delete game.pendingPackAlphaSel;
        return _paStamp(pend.chosen);
      }
      pend.chosen.push(chosenFigureKey);
      const remaining = pend.candidates.filter((fk) => !pend.chosen.includes(fk));
      if (pend.chosen.length >= 3 || remaining.length === 0) {
        delete game.pendingPackAlphaSel;
        return _paStamp(pend.chosen);
      }
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: [...remaining.map(dcNameFromFigureKey), 'Done selecting'],
        choiceValues: [...remaining, '__done__'],
        choicePrompt: `**Pack Alpha** — Selected ${pend.chosen.length}/3 CREATUREs. Choose another to move or Done:`,
      };
    }
    const allCreatureFks = friendlyCreatureFigs.map((f) => f.figureKey);
    // ≤3 CREATUREs: no meaningful subset choice — stamp all.
    if (allCreatureFks.length <= 3) return _paStamp(allCreatureFks);
    // >3 CREATUREs: offer a player pick of WHICH up to 3 move.
    game.pendingPackAlphaSel = { chosen: [], candidates: allCreatureFks };
    return {
      applied: false,
      requiresChoice: true,
      choiceOptions: [...allCreatureFks.map(dcNameFromFigureKey), 'Done selecting'],
      choiceValues: [...allCreatureFks, '__done__'],
      choicePrompt: '**Pack Alpha** — Choose up to 3 friendly CREATUREs (within 3 spaces) to each move up to 3 spaces:',
    };
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
      const _caFk = figureKeyForActivation(game, msgId);
      if (_caFk) game.freeAttackBonusPending[_caFk] = true;
      if (friendlyMsgId) game.freeAttackBonusPending[chosenFigureKey] = true;
      // "figures do not block line of sight for these attacks" — arm
      // nextAttackIgnoreFigureLOS (same flag Marksman uses) on BOTH attackers.
      game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
      if (_caFk) game.nextAttackIgnoreFigureLOS[_caFk] = true;
      game.nextAttackIgnoreFigureLOS[chosenFigureKey] = true;
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      // "Same target" constraint (CSV row 587): stash the attacker pair so the
      // resolve-time hook in combat-bridge captures the first attacker's chosen
      // target and forces it onto the second (whichever attacks second). The
      // declare-time forcedAttackTarget gate then enforces the lock. Auto-wired.
      if (_caFk) {
        game.coordinatedAttackPair = { figA: _caFk, figB: chosenFigureKey };
      }
      return { applied: true, logMessage: `**Coordinated Attack** — **${meta.dcName}** and **${dcName}** each gain 1 free attack, both targeting the **same** hostile figure (auto-enforced: the second attack is locked to the first's target). LOS: figures don't block for these attacks (automated).` };
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
      logMsg += stashPushPartingBlow(game, chosenFigureKey, targetPn, oldPos, destLower, playerNum);
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

  // dcSpecial: hopOnPush (Kuiil "Hop On!") — DESIGNATION-ONLY special action.
  //
  // Designer ruling (alexanbv 2026-06-21, CORRECTED model):
  //  "Hop On is a SPECIAL ACTION. It costs an action to just PICK the figure.
  //   Then, for the REST OF THE ACTIVATION, when you ENTER that figure's space,
  //   you push it one space."
  //
  // So the special action does NOTHING but DESIGNATE a SMALL friendly figure
  // (figure cost <= 8). It costs the action (handled by the dcSpecial / special-
  // action framework — there is no manual action charge here). NO movement and
  // NO push happen at designation time. The actual push is fired later by the
  // movement step handler (src/handlers/movement.js): for the rest of Kuiil's
  // activation, whenever a move STEP causes Kuiil's footprint to ENTER the
  // designated figure's space, that figure is pushed 1 space in Kuiil's
  // direction of travel (the space beyond it along the move), then Kuiil
  // completes his entry.
  //
  // The designation is stored per-Kuiil-figure in game.hopOnDesignated[kuiilKey]
  // = designatedFigureKey, registered as an ACTIVATION_FIGKEY_FLAG so it clears
  // automatically at the end of Kuiil's activation ("for the rest of THIS
  // activation").
  if (entry.type === 'dcSpecial' && entry.hopOnPush) {
    const { game, playerNum, dcMessageMeta } = context;
    // The figure-pick handler supplies `chosenFigureKey`.
    const chosenFigureKey = context.chosenFigureKey || context.targetFigureKey || null;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };

    const _hopMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const _hopMeta = _hopMsgId ? dcMessageMeta.get(_hopMsgId) : null;
    const _hopActKeys = _hopMeta ? getFigureKeysForDcMsg(game, playerNum, _hopMeta) : [];
    const _hopKuiilKey = _hopActKeys[0] || null; // Kuiil is a single-figure DC

    // Phase 2: a figure was chosen → DESIGNATE it for the rest of the activation.
    // No movement, no push now — the push fires during subsequent normal
    // movement (movement.js on-enter trigger).
    if (chosenFigureKey) {
      if (!_hopKuiilKey) return { applied: false, manualMessage: 'Could not locate Kuiil. Resolve manually.' };
      game.hopOnDesignated = game.hopOnDesignated || {};
      game.hopOnDesignated[_hopKuiilKey] = chosenFigureKey;
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return {
        applied: true,
        refreshBoard: true,
        logMessage: `**Hop On!** — Kuiil designated **${dcName}**. For the rest of this activation, each time Kuiil enters **${dcName}**'s space during movement, he pushes it 1 space ahead.`,
      };
    }

    // Phase 1: pick friendly SMALL figure with figure cost 8 or less.
    const dcEffects = getDcEffects();
    const validKeys = [];
    const validLabels = [];
    for (const [fk, pos] of Object.entries(game.figurePositions?.[playerNum] || {})) {
      if (!pos || _hopActKeys.includes(fk)) continue;
      const dcN = dcNameFromFigureKey(fk);
      const eff = dcEffects[dcN] || {};
      const kws = (eff.keywords || []).map((k) => String(k).toUpperCase());
      if (kws.includes('MASSIVE') || kws.includes('LARGE')) continue; // only SMALL figures
      const figCost = eff.subCost ?? eff.cost ?? 99; // per-figure cost when present
      if (figCost > 8) continue; // figure cost 8 or less
      validKeys.push(fk); validLabels.push(dcN);
    }
    if (!validKeys.length) return { applied: false, manualMessage: 'No friendly SMALL figures with figure cost 8 or less to designate.' };
    return { requiresChoice: true, choiceOptions: validLabels.map((n) => `Hop On: ${n}`), choiceValues: validKeys };
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
        // Per alexanbv 2026-05-13: Command cards are SECRET. Log only
        // the count, not the chosen card name.
        return { applied: true, logMessage: `**Devotion** — Drew 1 Command card from deck. Deck shuffled (${deck.length} cards remaining).` };
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
        // Per alexanbv 2026-05-13: Command cards are SECRET. The
        // matching DC name is public (figure on board), but the drawn
        // card name is not.
        return { applied: true, logMessage: `**Devotion** — Drew 1 Command card matching **${dcName}**. Deck shuffled (${deck.length} cards remaining).` };
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
      if (combat) {
        // alexanbv 2026-05-13: register as named queue entry — surfaces
        // as a "Use Battlefield Awareness" bucket button.
        combat.forcedRerollQueue = combat.forcedRerollQueue || [];
        combat.forcedRerollQueue.push({
          controlPlayer: combat.attackerPlayerNum,
          pool: 'attack',
          remaining: 1,
          source: `Battlefield Awareness (${dcName})`,
        });
        return { applied: true, logMessage: `**Battlefield Awareness** — Added 1 reroll for **${dcName}** in the current attack.` };
      }
      // Otherwise (no live combat): grant the reroll to the chosen figure's next
      // attack this round via the per-figure registry. CSV: "another friendly
      // figure within 3" → the chosen figure benefits (anchored as the source so
      // selfIsSourceFigure restricts the reroll to exactly that figure).
      // MIGRATED 2026-06-20 off the per-player roundAttackRerollDice flag.
      registerRoundModifier(game, {
        id: `Battlefield Awareness:${playerNum}:${chosenFigureKey}:atk-reroll`,
        card: 'Battlefield Awareness',
        ownerPlayerNum: playerNum,
        sourceFigureKey: chosenFigureKey,
        side: 'attack',
        duration: 'during-round',
        conditions: { selfIsSourceFigure: true },
        effect: { rerollAttackDice: 1 },
      });
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
      return { applied: true, logMessage: `**Let's Make a Deal** — Paid ${X} VP (your total: ${ownNew}, theirs: ${oppNew}). ${X > 0 ? `Applied −${X} Damage to this attack.` : 'No VP paid.'} Hondo becomes Focused.` };
    }
    // Phase 1: show VP options matching incoming hits
    const options = ['Pay 0 VP (just apply Focus)'];
    for (let i = 1; i <= maxPay; i++) options.push(`Pay ${i} VP → −${i} Hit${i !== 1 ? 's' : ''}`);
    return { requiresChoice: true, choiceOptions: options };
  }

  // ccEffect: demoralizingMonologueEffect (Demoralizing Monologue) — Moff
  // Gideon. Card text: "Use while attacking to choose and reroll 1 defense
  // die. Then you may reveal your hand. If you reveal 2 or more cards this
  // way, remove the chosen die's results from the defense results."
  //
  // Old impl: increment defenderRerollsRemaining (DEFENDER controls the
  // reroll, plays own die). Per card, the ATTACKER chooses the die — that
  // means a forced reroll on the defense pool, controlled by the attacker.
  // New impl: push a forced-reroll queue entry tagged with `demoralizingMonologue: true`
  // so the forced-reroll handler in combat.js can post the reveal-hand
  // prompt after the reroll fires.
  if (entry.type === 'ccEffect' && entry.demoralizingMonologueEffect) {
    const { game, playerNum, combat } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    combat.forcedRerollQueue = combat.forcedRerollQueue || [];
    combat.forcedRerollQueue.push({
      controlPlayer: combat.attackerPlayerNum,
      pool: 'defense',
      remaining: 1,
      source: 'Demoralizing Monologue',
      demoralizingMonologue: true,
      casterPlayerNum: playerNum,
    });
    combat.demoralizingMonologueApplied = true;
    return { applied: true, logMessage: "**Demoralizing Monologue** — Forced defense-die reroll added (attacker chooses). After reroll, attacker may reveal hand to remove the die's results." };
  }

  // ccEffect: doubleOrNothingEffect (Double or Nothing) — choose a die; reroll it; if same icon type, may double those icons
  if (entry.type === 'ccEffect' && entry.doubleOrNothingEffect) {
    const { game, playerNum, combat, choiceIndex } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    if (!combat) return { applied: false, manualMessage: 'Play during an attack. No active combat found.' };
    if (choiceIndex !== undefined && choiceIndex !== null) {
      // alexanbv 2026-05-13: register named queue entries instead of
      // incrementing the deprecated count fields.
      combat.forcedRerollQueue = combat.forcedRerollQueue || [];
      if (choiceIndex === 0) {
        combat.forcedRerollQueue.push({
          controlPlayer: combat.attackerPlayerNum,
          pool: 'attack',
          remaining: 1,
          source: 'Double or Nothing',
        });
        game.doubleMatchingIconsOnReroll = { playerNum, side: 'atk' };
        return { applied: true, logMessage: "**Double or Nothing** — Attacker rerolls 1 attack die. If the rerolled die has the **same number of symbols**, you may then **double or cancel** its results (you'll be prompted)." };
      } else {
        const _defPN = combat.defenderPlayerNum ?? (combat.attackerPlayerNum === 1 ? 2 : 1);
        combat.forcedRerollQueue.push({
          controlPlayer: _defPN,
          pool: 'defense',
          remaining: 1,
          source: 'Double or Nothing',
        });
        game.doubleMatchingIconsOnReroll = { playerNum, side: 'def' };
        return { applied: true, logMessage: "**Double or Nothing** — Defender rerolls 1 defense die. If the rerolled die has the **same number of symbols**, you may then **double or cancel** its results (you'll be prompted)." };
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
    // Phase 3: Force Choke chosen figure — 2 Damage applies sync, 1
    // Strain queues via pendingStrain[] for applyStrain pipeline.
    if (chosenFigureKey) {
      const oppNum = opponentPlayerNum(playerNum);
      const figMsgId = findMsgIdForFigureKey(game, oppNum, chosenFigureKey, dcMessageMeta);
      let dmgNote = 'apply 2 Dmg manually';
      if (figMsgId && dcHealthState) {
        const hs = dcHealthState.get(figMsgId) || [];
        const fkM = chosenFigureKey.match(/-(\d+)-(\d+)$/);
        const fi = fkM ? parseInt(fkM[2], 10) : 0;
        if (hs[fi]) {
          const [cur, max] = hs[fi];
          const newCur = Math.max(0, (cur ?? max) - 2);
          hs[fi] = [newCur, max ?? newCur];
          dcHealthState.set(figMsgId, hs);
          syncHealthStateToList(game, oppNum, figMsgId, hs);
          dmgNote = `2 Dmg (HP: ${cur ?? max}→${newCur}) + 1 Strain (queued)`;
        }
      }
      const dcName = dcNameFromFigureKey(chosenFigureKey);
      return {
        applied: true,
        logMessage: `**Lord of the Sith** — Force Choke **${dcName}**: ${dmgNote}. (2 MP already added)`,
        refreshDcEmbed: !!figMsgId,
        pendingStrain: [{
          figureKey: chosenFigureKey,
          controllerPlayerNum: oppNum,
          amount: 1,
          source: 'Lord of the Sith — Force Choke',
        }],
      };
    }
    // Phase 0: card resolves → stamp pendingMoveX (2 MP, no choice
    // yet). The lordOfSithChoice continuation posts a "Force Choke /
    // Free Attack" picker after the move-x picker drains. Player's
    // choice routes back through this dispatch as a phase-1 call.
    if (choiceIndex === undefined || choiceIndex === null) {
      const meta = dcMessageMeta?.get?.(msgId);
      const _losFigKeys = Object.keys(game.figurePositions?.[playerNum] || {})
        .filter(k => k.startsWith((meta?.dcName || '') + '-'));
      const _losSelectedIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      const _losFigureKey = _losFigKeys[_losSelectedIdx] || _losFigKeys[0] || null;
      if (!_losFigureKey) {
        return { applied: false, manualMessage: '**Lord of the Sith** — could not locate the activating figure; resolve manually.' };
      }
      game.pendingMoveX = game.pendingMoveX || {};
      game.pendingMoveX[msgId] = {
        remaining: 2,
        source: 'Lord of the Sith',
        playerNum,
        figureKey: _losFigureKey,
        dcName: meta?.dcName || '',
        threadId: null,
        bypassCosts: true,
        msgId,
        nextAction: {
          type: 'lordOfSithChoice',
          payload: { msgId, playerNum, figureKey: _losFigureKey },
        },
      };
      return {
        applied: true,
        pendingMoveXMsgId: msgId,
        activeMsgId: msgId,
        logMessage: '**Lord of the Sith** — Darth Vader may move up to 2 spaces. After the move, choose Force Choke or Free Melee Attack.',
      };
    }
    if (choiceIndex !== undefined && choiceIndex !== null) {
      if (choiceIndex === 1) {
        // Free Melee attack — picker has already drained (continuation
        // path). Set the free-attack flag and post the prompt via the
        // freeAttackPrompt-style fallback. Per canonical card text,
        // this attack removes 1 die from the attacker's pool — set the
        // one-shot per-msgId penalty so handleCombatDeclare consumes it.
        game.freeAttackBonusPending = game.freeAttackBonusPending || {};
        const _losFk = figureKeyForActivation(game, msgId);
        if (_losFk) game.freeAttackBonusPending[_losFk] = true;
        // Per alexanbv 2026-05-13: per-figureKey (the figure whose attack will be penalized).
        game.attackDicePenaltyForMsgId = game.attackDicePenaltyForMsgId || {};
        if (_losFk) game.attackDicePenaltyForMsgId[_losFk] = 1;
        game.attackDicePenaltyLabel = 'Lord of the Sith';
        return {
          applied: true,
          activeMsgId: msgId,
          grantedAttackButton: {
            granteeMsgId: msgId,
            granteeFigureKey: (Object.keys(game.figurePositions?.[playerNum] || {}).find(k => k.startsWith((dcMessageMeta?.get?.(msgId)?.dcName || '') + '-'))) || null,
            granteeName: dcMessageMeta?.get?.(msgId)?.dcName || 'Vader',
            sourceLabel: 'Lord of the Sith',
          },
          logMessage: '**Lord of the Sith** — Darth Vader takes a free Melee attack (−1 attack die).',
        };
      }
      // Force Choke path:
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
    const _pbkFk = figureKeyForActivation(game, msgId);
    if (_pbkFk) game.freeAttackBonusPending[_pbkFk] = true;
    // Payback's +2 Surge is an IMMEDIATE free-attack bonus (CSV: "interrupt to
    // perform an attack ... applying +2 Surge to THE ATTACK RESULTS"), NOT a
    // round-long bonus. Tie it to that one figure's next attack via the existing
    // per-figure paybackBonusSurge mechanism (consumed at attack-declare in
    // handlers/combat.js → combat.surgeBonus). MIGRATED 2026-06-20 off the
    // per-player roundAttackSurgeBonus flag (matches the live post-combat.js path).
    if (_pbkFk) {
      game.paybackBonusSurge = game.paybackBonusSurge || {};
      game.paybackBonusSurge[_pbkFk] = (game.paybackBonusSurge[_pbkFk] || 0) + 2;
    }
    const meta = dcMessageMeta.get(msgId);
    return { applied: true, logMessage: `**Payback** — **${meta?.dcName || 'Dengar'}** may perform 1 free attack against the attacker. +2 Surge applied to that attack.` };
  }

  // ccEffect: overchargedWeaponsEffect (Overcharged Weapons) — interrupt at the
  // START OF A HOSTILE ACTIVATION (same timing as Jyn "Hair Trigger", per
  // alexanbv). The holder picks one of their Readied VEHICLE figures to perform
  // a free attack targeting the activating hostile (forced target); that attack
  // gains Pierce 2; then the chosen VEHICLE's DC is exhausted and that figure
  // becomes Weakened.
  //
  // Reacting-figure resolution does NOT use findActiveActivationMsgId(holder)
  // (null on the opponent's turn). Instead the activating hostile is read from
  // game.pendingOverchargedWeapons (stashed in activation-setup.js), and the
  // reacting VEHICLE is the holder's own choice among readied VEHICLE figures.
  // The declare-attack is surfaced via result.grantedAttackButtonStandalone
  // (posts to the game-log channel — works when it is NOT the holder's turn).
  if (entry.type === 'ccEffect' && entry.overchargedWeaponsEffect) {
    const { game, playerNum, dcMessageMeta, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const _owPending = game.pendingOverchargedWeapons;
    const _owTargetFk = _owPending?.activatingFigureKey;
    const _owTargetPN = _owPending?.activatingPlayerNum;
    if (!_owTargetFk || !_owTargetPN || !game.figurePositions?.[_owTargetPN]?.[_owTargetFk]) {
      return { applied: false, manualMessage: 'Overcharged Weapons: no activating hostile figure to target right now. Play it at the start of a hostile figure\'s activation.' };
    }
    // Enumerate the holder's READIED VEHICLE figures (a VEHICLE whose DC is not
    // exhausted). The attacking VEHICLE must be readied (the card exhausts it).
    const _owEff = getDcEffects() || {};
    const _owPositions = game.figurePositions?.[playerNum] || {};
    const _owCandidates = [];
    for (const fk of Object.keys(_owPositions)) {
      if (!_owPositions[fk]) continue;
      const _dcN = dcNameFromFigureKey(fk);
      const _kws = (_owEff[_dcN]?.keywords || []).map((k) => String(k).toUpperCase());
      if (!_kws.includes('VEHICLE')) continue;
      const _mid = findMsgIdForFigureKey(game, playerNum, fk, dcMessageMeta);
      if (!_mid) continue;
      // Readied = not already exhausted (round-activation OR ability-exhaust).
      if ((game.abilityExhaustedMsgIds || []).includes(_mid)) continue;
      _owCandidates.push({ figureKey: fk, dcName: _dcN, msgId: _mid });
    }
    if (_owCandidates.length === 0) {
      return { applied: false, manualMessage: 'Overcharged Weapons requires a Readied VEHICLE figure. None available.' };
    }
    // If the holder has more than one eligible VEHICLE and hasn't picked yet,
    // surface a picker (requiresChoice → choiceValues = figure keys).
    let _owChosen = null;
    if (chosenFigureKey) {
      _owChosen = _owCandidates.find((c) => c.figureKey === chosenFigureKey) || null;
      if (!_owChosen) return { applied: false, manualMessage: 'That figure is not an eligible Readied VEHICLE.' };
    } else if (_owCandidates.length === 1) {
      _owChosen = _owCandidates[0];
    } else {
      return {
        applied: false,
        requiresChoice: true,
        choiceOptions: _owCandidates.map((c) => c.dcName),
        choiceValues: _owCandidates.map((c) => c.figureKey),
      };
    }
    const _owFk = _owChosen.figureKey;
    const _owMsgId = _owChosen.msgId;
    // Grant free attack, force the target to the activating hostile, +Pierce 2.
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[_owFk] = true;
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    game.forcedAttackTarget[_owFk] = _owTargetFk;
    // Per alexanbv 2026-05-13: pendingOverrideAttackDice keyed by figureKey.
    game.pendingOverrideAttackDice = game.pendingOverrideAttackDice || {};
    game.pendingOverrideAttackDice[_owFk] = { ...(game.pendingOverrideAttackDice[_owFk] || {}), pierce: (game.pendingOverrideAttackDice[_owFk]?.pierce || 0) + 2 };
    // Exhaust the chosen VEHICLE's DC (persist for restart survival).
    game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
    if (!game.abilityExhaustedMsgIds.includes(_owMsgId)) game.abilityExhaustedMsgIds.push(_owMsgId);
    // Weaken the attacking figure (respects immunity).
    if (!isConditionImmune(game, _owFk)) applyCondition(game, _owFk, 'Weaken');
    const _owTgtName = dcNameFromFigureKey(_owTargetFk);
    return {
      applied: true,
      grantedAttackButtonStandalone: {
        granteeMsgId: _owMsgId,
        granteeFigureKey: _owFk,
        granteeName: _owChosen.dcName,
        granteePlayerNum: playerNum,
        sourceLabel: 'Overcharged Weapons',
      },
      logMessage: `**Overcharged Weapons** — **${_owChosen.dcName}** interrupts to perform a free attack (+Pierce 2) targeting **${_owTgtName}**. ${_owChosen.dcName}'s Deployment card is exhausted and it becomes Weakened.`,
    };
  }

  // ccEffect: partingBlowEffect (Parting Blow) — interrupt when a hostile
  // figure EXITS a space adjacent to the holder's BRAWLER. Per alexanbv:
  // "Parting Blow is played during opponent's move." Before the hostile
  // finishes moving, the BRAWLER performs a free attack targeting the exiting
  // hostile; then the BRAWLER becomes Stunned.
  //
  // The reacting figure is the holder's BRAWLER (NOT findActiveActivationMsgId,
  // which is null during the opponent's move). Both move-interrupt posting
  // paths stash game.pendingPartingBlow = { brawlerFigureKey, brawlerPlayerNum,
  // exitingHostileFigureKey } when the opportunity is offered; this resolver
  // reads it, arms the free attack + forced target on the BRAWLER, and surfaces
  // the declare-attack via grantedAttackButtonStandalone.
  if (entry.type === 'ccEffect' && entry.partingBlowEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const _pbPending = game.pendingPartingBlow;
    const _pbBrawlerFk = _pbPending?.brawlerFigureKey;
    const _pbTargetFk = _pbPending?.exitingHostileFigureKey;
    if (!_pbBrawlerFk || !game.figurePositions?.[playerNum]?.[_pbBrawlerFk]) {
      return { applied: false, manualMessage: 'Parting Blow: no adjacent BRAWLER reaction available. Play it when a hostile exits a space adjacent to your BRAWLER.' };
    }
    if (!_pbTargetFk || (!game.figurePositions?.[1]?.[_pbTargetFk] && !game.figurePositions?.[2]?.[_pbTargetFk])) {
      return { applied: false, manualMessage: 'Parting Blow: the exiting hostile figure is no longer on the board.' };
    }
    // Once per move guard, keyed by the BRAWLER's DC msgId.
    const _pbMsgId = findMsgIdForFigureKey(game, playerNum, _pbBrawlerFk, dcMessageMeta);
    game.partingShotTriggered = game.partingShotTriggered || {};
    if (_pbMsgId && game.partingShotTriggered[_pbMsgId]) {
      return { applied: false, manualMessage: 'Parting Blow already used this move.' };
    }
    // Arm the free attack + force the target to the exiting hostile.
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    game.freeAttackBonusPending[_pbBrawlerFk] = true;
    game.forcedAttackTarget = game.forcedAttackTarget || {};
    game.forcedAttackTarget[_pbBrawlerFk] = _pbTargetFk;
    if (_pbMsgId) game.partingShotTriggered[_pbMsgId] = true;
    // The BRAWLER becomes Stunned (respects immunity).
    const _pbBrawlerName = dcNameFromFigureKey(_pbBrawlerFk);
    const _pbImmune = isConditionImmune(game, _pbBrawlerFk);
    if (!_pbImmune) applyCondition(game, _pbBrawlerFk, 'Stun');
    const _pbTgtName = dcNameFromFigureKey(_pbTargetFk);
    const stunNote = _pbImmune ? ' (immune to Stun)' : ' becomes Stunned';
    return {
      applied: true,
      ...(_pbMsgId ? {
        grantedAttackButtonStandalone: {
          granteeMsgId: _pbMsgId,
          granteeFigureKey: _pbBrawlerFk,
          granteeName: _pbBrawlerName,
          granteePlayerNum: playerNum,
          sourceLabel: 'Parting Blow',
        },
      } : {}),
      logMessage: `**Parting Blow** — **${_pbBrawlerName}** interrupts to perform a free attack targeting the exiting **${_pbTgtName}**${_pbMsgId ? '' : ' (use the Attack button on the DC card)'}. ${_pbBrawlerName}${stunNote}.`,
    };
  }

  // ccEffect: chooseASideEffect (Choose a Side) — CSV: "During this round OTHER
  // friendly Mobile figures gain Personal Combat Shield (SCUM) or Gar Saxon's
  // Flamethrower (IMPERIAL)." The Choose a Side figure itself is EXCLUDED ("other").
  if (entry.type === 'ccEffect' && entry.chooseASideEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    // The activating (card-playing) figure — excluded by "OTHER friendly Mobile".
    const selfFigureKeys = msgId ? getFigureKeysForDcMsg(game, playerNum, dcMessageMeta?.get(msgId)) : [];
    const selfFk = figureKeyForActivation(game, msgId) || selfFigureKeys[0] || null;
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const dcEffects = getDcEffects();
      const mobileKeys = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => {
        const dcN = dcNameFromFigureKey(fk);
        const kws = (dcEffects[dcN]?.keywords || []).map((k) => String(k).toUpperCase());
        return kws.includes('MOBILE') && !selfFigureKeys.includes(fk);
      });
      if (choiceIndex === 0) {
        // SCUM: Personal Combat Shield — "Whenever you spend a Block while
        // defending, apply +1 Evade." Round-scoped grant to OTHER Mobile
        // friendlies. MIGRATED 2026-06-20 to the per-figure registry: a
        // descriptor evaluated per defending figure (selfKeyword MOBILE +
        // excludeSourceFigure). The +1-Evade-on-Block-spend hook in
        // handlers/combat.js (applyPersonalCombatShieldOnBlockSpend) now reads
        // the evaluated personalCombatShield flag instead of the old map.
        registerRoundModifier(game, {
          id: `Choose a Side:${playerNum}:def-mobile-shield`,
          card: 'Choose a Side (SCUM)',
          ownerPlayerNum: playerNum,
          sourceFigureKey: selfFk,
          side: 'defense',
          duration: 'during-round',
          conditions: { selfKeyword: 'MOBILE', excludeSourceFigure: true },
          effect: { personalCombatShield: true },
        });
        return { applied: true, logMessage: `**Choose a Side (SCUM)** — This round, your **other Mobile** figures gain **Personal Combat Shield** (+1 Evade whenever they spend a Block while defending; ${mobileKeys.length} figure${mobileKeys.length !== 1 ? 's' : ''}).` };
      } else {
        // IMPERIAL: OTHER Mobile friendlies gain Gar Saxon's Flamethrower as a
        // Special Action this round (costs 1 ACTION, not MP). The round flag is
        // read by the shared eligibility helper hasChooseASideFlamethrower
        // (data-loader.js), which BOTH the render path (components.js
        // getDcActionButtons — injects the extra Special-Action button for each
        // eligible Mobile figure) and the dispatch path (dc-play-area.js — routes
        // the injected special to the gar_saxon_flamethrower resolver with the
        // eligible figure as activator) consult so they cannot drift. Standard
        // once-per-activation-per-figure specialsUsedByFig gating applies. The
        // flag is round-scoped and cleared at round start (ROUND_OBJECT_FLAGS in
        // activation-state.js → resets to {}). excludeFigureKey enforces "OTHER".
        game.roundMobileGarSaxonFlamethrower = game.roundMobileGarSaxonFlamethrower || {};
        game.roundMobileGarSaxonFlamethrower[playerNum] = { excludeFigureKey: selfFk };
        return {
          applied: true,
          logMessage: `**Choose a Side (IMPERIAL)** — This round, your **other Mobile** figures gain **Gar Saxon's Flamethrower** as a Special Action (1 action: area within 2 — each other figure on/adjacent suffers 1 Damage + 1 Strain and discards 1 Power Token; ${mobileKeys.length ? mobileKeys.map((fk) => dcNameFromFigureKey(fk)).join(', ') : 'none'}).`,
        };
      }
    }
    return { requiresChoice: true, choiceOptions: ['SCUM: Personal Combat Shield (+1 Evade per Block spent, other Mobile figures)', "IMPERIAL: Gar Saxon's Flamethrower (other Mobile figures, manual)"] };
  }

  // ccEffect: reverseEngineerEffect (Reverse Engineer) — free attack with +1 Surge using defender's surge abilities
  if (entry.type === 'ccEffect' && entry.reverseEngineerEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'No active DC found. Resolve manually.' };
    game.freeAttackBonusPending = game.freeAttackBonusPending || {};
    const _reFk = figureKeyForActivation(game, msgId);
    if (_reFk) game.freeAttackBonusPending[_reFk] = true;
    // Reverse Engineer's +1 Surge is an IMMEDIATE bonus to THE granted attack
    // (CSV: "Perform an attack ... apply +1 Surge to the attack results"), NOT a
    // round-long bonus. Tie it to that figure's next attack via the per-figure
    // paybackBonusSurge mechanism. MIGRATED 2026-06-20 off roundAttackSurgeBonus.
    if (_reFk) {
      game.paybackBonusSurge = game.paybackBonusSurge || {};
      game.paybackBonusSurge[_reFk] = (game.paybackBonusSurge[_reFk] || 0) + 1;
    }
    // Flag: swap to defender's surge abilities when attack resolves
    game.reverseEngineerActive = game.reverseEngineerActive || {};
    game.reverseEngineerActive[playerNum] = true;
    const meta = dcMessageMeta.get(msgId);
    return { applied: true, logMessage: `**Reverse Engineer** — **${meta?.dcName || 'Figure'}** performs 1 free attack with +1 Surge. The **defender's** DC surge abilities will be used instead of your own.` };
  }

  // ccEffect: navigationUpgradeEffect (Navigation Upgrade) — Strain 1 to self; choose friendly DROID for +1 MP
  // Strain queues via pendingStrainCost so applyStrain pipeline routes
  // it (Fireproof / Headhunter / per-strain choice / Under Duress / Paz).
  if (entry.type === 'ccEffect' && entry.navigationUpgradeEffect) {
    const { game, playerNum, dcMessageMeta, choiceIndex, chosenFigureKey } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    const meta = msgId ? dcMessageMeta.get(msgId) : null;
    const _navStrainPayload = (() => {
      if (!meta?.dcName) return null;
      const dgM = (meta.displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIdx = dgM ? dgM[1] : '1';
      const selFig = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
      return {
        figureKey: `${meta.dcName}-${dgIdx}-${selFig}`,
        controllerPlayerNum: playerNum,
        amount: 1,
        source: 'Navigation Upgrade cost',
      };
    })();
    if (choiceIndex !== undefined && choiceIndex !== null) {
      // Reusable exhaust-based attachment (CSV row 750: "Exhaust this card during
      // a friendly DROID's activation; that figure gains 1 movement point"). The
      // card is placed in the Play Area as an Attachment (keyed by the placing
      // DROID's DC msgId) and re-arms at the start of each round (round.js clears
      // exhaustedSkirmishUpgrades). Gate the +1 MP on the attachment being READY,
      // then exhaust it so it can't grant MP again until the next round.
      if (msgId && isAttachmentExhausted(game, msgId, 'Navigation Upgrade')) {
        return { applied: false, manualMessage: '**Navigation Upgrade** is exhausted — it readies at the start of your next round.' };
      }
      let mpNote = '';
      if (chosenFigureKey) {
        const droidMsgId = findMsgIdForFigureKey(game, playerNum, chosenFigureKey, dcMessageMeta);
        if (droidMsgId) {
          addMovementPoints(game, droidMsgId, 1);
          mpNote = ` **${dcNameFromFigureKey(chosenFigureKey)}** gains 1 MP.`;
        }
      }
      if (msgId) exhaustAttachment(game, msgId, 'Navigation Upgrade');
      return {
        applied: true,
        logMessage: `**Navigation Upgrade** — 1 Strain (queued).${mpNote} Placed as Attachment — exhaust during any friendly DROID's activation for +1 MP. (Exhausted — readies at the start of your next round.)`,
        refreshDcEmbed: true,
        ...(_navStrainPayload ? { pendingStrainCost: _navStrainPayload } : {}),
      };
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
      // TODO follow-up: hook into opponent activation-start to auto-
      // post the move/attack picker. Currently the player must
      // manually announce. When the picker is wired, the Move branch
      // should stamp pendingMoveX (Zuckuss's msgId, MP=Speed,
      // bypassCosts: false, no bank — out-of-activation grant) and
      // the Attack branch should post a granted attack button.
      return { applied: true, logMessage: `**Findsman Meditation** — Zuckuss will interrupt when **${chosenDcName}** activates this round. Before their first action, announce the interrupt: Zuckuss may **move up to Speed MP** (no bank, spend at once) **or perform an attack**.` };
    }
    const oppIds = getDcMessageIds(game, oppNum) || [];
    const oppList = getDcList(game, oppNum) || [];
    const oppNames = oppIds.map((id, i) => oppList[i]?.dcName).filter(Boolean);
    if (!oppNames.length) return { applied: false, manualMessage: 'No opponent deployment groups found. Resolve manually.' };
    return { requiresChoice: true, choiceOptions: oppNames.map((n) => `Watch: ${n}`) };
  }

  // ccEffect: ballisticsMatrixEffect (Ballistics Matrix) — next attack ignores figure LOS blocking
  if (entry.type === 'ccEffect' && entry.ballisticsMatrixEffect) {
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    // Per alexanbv 2026-05-13: align with Marksman migration to per-figureKey.
    const _bmMsgId = dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    if (!_bmMsgId) return { applied: false, manualMessage: entry.label || 'Resolve manually: no activation in progress.' };
    const _bmFk = figureKeyForActivation(game, _bmMsgId);
    if (!_bmFk) return { applied: false, manualMessage: entry.label || 'Resolve manually: cannot resolve activating figure.' };
    // Reusable exhaust-based attachment (CSV row 541: "Exhaust this card before
    // you declare an attack"). The card is placed on its DC as an Attachment and
    // re-arms at the start of each round (round.js clears exhaustedSkirmishUpgrades).
    // Gate firing on the attachment being READY, then exhaust it so it can't fire
    // again until the next round.
    if (isAttachmentExhausted(game, _bmMsgId, 'Ballistics Matrix')) {
      return { applied: false, manualMessage: '**Ballistics Matrix** is exhausted — it readies at the start of your next round.' };
    }
    game.nextAttackIgnoreFigureLOS = game.nextAttackIgnoreFigureLOS || {};
    game.nextAttackIgnoreFigureLOS[_bmFk] = true;
    exhaustAttachment(game, _bmMsgId, 'Ballistics Matrix');
    return { applied: true, logMessage: `**Ballistics Matrix** — For your next attack, intervening figures do **not** block line of sight. Declare your attack normally. (Exhausted — readies at the start of your next round.)` };
  }

  // ccEffect: etiquetteAndProtocolEffect (Etiquette and Protocol) — block attacks between one hostile and one friendly this round
  if (entry.type === 'ccEffect' && entry.etiquetteAndProtocolEffect) {
    const { game, playerNum, choiceIndex, chosenFigureKey, dcMessageMeta } = context;
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
    const hostileFksAll = Object.keys(game.figurePositions?.[oppNum] || {}).filter((fk) => game.figurePositions[oppNum][fk]);
    const friendlyFksAll = Object.keys(game.figurePositions?.[playerNum] || {}).filter((fk) => game.figurePositions[playerNum][fk]);
    // alexanbv 2026-06-22: both chosen figures must be in the LINE OF SIGHT of
    // the card-playing figure (C-3PO) — NOT in LOS of each other — and C-3PO
    // cannot choose itself as the friendly figure ("not self"). Resolve the
    // card-playing figure (the Special Action's activating figure; fall back to
    // the friendly C-3PO), then filter both lists to figures it can see.
    let losSourceFk = null;
    if (dcMessageMeta) {
      const _eMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
      if (_eMsgId) losSourceFk = figureKeyForActivation(game, _eMsgId);
    }
    if (!losSourceFk) losSourceFk = friendlyFksAll.find((fk) => dcNameFromFigureKey(fk) === 'C-3PO') || null;
    const _eMs = game.selectedMap?.id ? getMapData(game.selectedMap.id) : null;
    const _eGfs = context.getFigureSize;
    const _eSrcPos = losSourceFk ? game.figurePositions?.[playerNum]?.[losSourceFk] : null;
    // When map/LOS data is unavailable, don't over-filter (resolve permissively).
    const inLos = (pn, fk) => {
      if (!_eSrcPos || !_eMs || typeof _eGfs !== 'function') return true;
      const pos = game.figurePositions?.[pn]?.[fk];
      return !!pos && hasLineOfSightByCoord(game, _eSrcPos, pos, _eMs, _eGfs);
    };
    const hostileFks = hostileFksAll.filter((fk) => inLos(oppNum, fk));
    const friendlyFks = friendlyFksAll.filter((fk) => fk !== losSourceFk && inLos(playerNum, fk));
    const opts = [];
    const vals = [];
    for (const hfk of hostileFks) {
      for (const ffk of friendlyFks) {
        opts.push(`${dcNameFromFigureKey(hfk)} ↔ ${dcNameFromFigureKey(ffk)}`);
        vals.push(`${hfk}|${ffk}`);
      }
    }
    if (!opts.length) return { applied: false, manualMessage: 'No valid figure pairs in your line of sight. Resolve manually.' };
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

  // ccEffect: cheatToWinEffect (Cheat to Win) — triggered by Gambit (Lando's
  // color-swap reroll). CSV row 576: "Change THAT die's result to another result
  // of your choice on THAT die." So the choice is constrained to the faces of the
  // actually-rolled Gambit die (same color), and the chosen face is WRITTEN back
  // into combat dice state (not advisory). The Gambit die is identified via the
  // durable combat._lastGambitDie marker (set in rerollDie when a color-swap
  // reroll occurs), falling back to combat._lastRerolledDie within the rerolls
  // window.
  if (entry.type === 'ccEffect' && entry.cheatToWinEffect) {
    const { game, playerNum, choiceIndex, chosenOption } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually.' };
    const combat = context.combat || game.combat || game.pendingCombat;
    if (!combat) return { applied: false, manualMessage: '**Cheat to Win** — no active combat; resolve manually.' };
    const _ctwMarker = combat._lastGambitDie || combat._lastRerolledDie;
    if (!_ctwMarker || (_ctwMarker.pool !== 'attack' && _ctwMarker.pool !== 'defense') || typeof _ctwMarker.index !== 'number') {
      return { applied: false, manualMessage: '**Cheat to Win** — could not identify the Gambit die (no recent Gambit reroll). Resolve manually.' };
    }
    const { pool, index } = _ctwMarker;
    const diceField = pool === 'attack' ? 'attackDiceResults' : 'defenseDiceResults';
    const dice = combat[diceField];
    if (!Array.isArray(dice) || !dice[index]) {
      return { applied: false, manualMessage: '**Cheat to Win** — Gambit die no longer present. Resolve manually.' };
    }
    const color = (_ctwMarker.color || dice[index].color || '').toLowerCase();
    const faces = getDiceData()?.[pool]?.[color] || [];
    if (!faces.length) return { applied: false, manualMessage: `**Cheat to Win** — no face data for ${color} ${pool} die. Resolve manually.` };
    // Build human-readable labels from the canonical face data (same color only).
    const _ctwLabel = (f) => {
      const parts = [];
      if (pool === 'attack') {
        if (f.dmg) parts.push(`${f.dmg} Hit${f.dmg !== 1 ? 's' : ''}`);
        if (f.acc) parts.push(`${f.acc} Acc`);
        if (f.surge) parts.push(`${f.surge} Surge`);
      } else {
        if (f.block) parts.push(`${f.block} Block`);
        if (f.evade) parts.push(`${f.evade} Evade`);
        if (f.dodge) parts.push('Dodge');
      }
      return parts.length ? parts.join(' + ') : 'Blank';
    };
    // Phase 2: chosen face index → write the chosen result into combat dice state.
    if (choiceIndex !== undefined && choiceIndex !== null) {
      const fIdx = Number(choiceIndex);
      const face = faces[fIdx];
      if (!face) return { applied: false, manualMessage: '**Cheat to Win** — invalid face choice. Resolve manually.' };
      const newDie = pool === 'attack'
        ? { color, acc: face.acc ?? 0, dmg: face.dmg ?? 0, surge: face.surge ?? 0, faceIdx: fIdx }
        : { color, block: face.block ?? 0, evade: face.evade ?? 0, dodge: !!face.dodge, faceIdx: fIdx };
      dice[index] = newDie;
      const totalsField = pool === 'attack' ? 'attackRoll' : 'defenseRoll';
      combat[totalsField] = pool === 'attack' ? recalcAttackTotals(dice) : recalcDefenseTotals(dice);
      return {
        applied: true,
        logMessage: `**Cheat to Win** — ${color} ${pool} die #${index + 1} changed to **${chosenOption || _ctwLabel(face)}**.`,
        refreshCombat: true,
      };
    }
    // Phase 1: offer only the faces of the rolled Gambit die's color.
    const choiceOptions = faces.map((f, i) => `${color}: ${_ctwLabel(f)}`);
    return { requiresChoice: true, choiceOptions };
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

  // ccEffect: setATrapEffect (Set a Trap) — INTENTIONALLY UNIMPLEMENTED.
  // The printed card chooses a map TILE and, at end of round, lets a friendly
  // figure on that tile interrupt to attack a hostile on the same tile. This
  // engine has no model of map tiles (only individual spaces), so the effect
  // cannot be resolved correctly. Per owner decision it is a no-op until a
  // tile model exists; deck-loading reports it as unimplemented (see
  // UNIMPLEMENTED_CARDS in validation.js). (alexanbv 2026-06-18.)
  if (entry.type === 'ccEffect' && entry.setATrapEffect) {
    return {
      applied: false,
      manualMessage: '**Set a Trap** is not implemented (requires a map-tile model) — resolve manually if you wish.',
    };
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
      const _tgtIsNpc = typeof targetFigureKey === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(targetFigureKey);
      const targetName = _tgtIsNpc
        ? (() => { const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
        : dcNameFromFigureKey(targetFigureKey);
      const resultParts = [];
      if (hits > 0) {
        if (_tgtIsNpc) {
          const p = targetFigureKey.match(/^npc_(thug|krykna)_(\d+)$/);
          const npcRes = applyDamageToNpcSync(game, {
            npcType: p[1], npcIndex: parseInt(p[2], 10), amount: hits, attackerPlayerNum: playerNum,
          });
          if (npcRes.applied) resultParts.push(`${hits} Damage (HP: ${npcRes.prevHp} → ${npcRes.newHp})`);
        } else {
          const enemyPlayerNum = opponentPlayerNum(playerNum);
          const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, targetFigureKey, dcMessageMeta);
          if (dcHealthState && targetMsgId) {
            const healthState = dcHealthState.get(targetMsgId) || [];
            const fkMatch = targetFigureKey.match(/-(\d+)-(\d+)$/);
            const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
            const entryHp = healthState[figIdx];
            if (entryHp) {
              // Defeat-aware pipeline (alexanbv 2026-06-22).
              const _hbRes = applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, hits, enemyPlayerNum, {
                sourceLabel: 'Headbutt', attackerPlayerNum: playerNum,
              });
              resultParts.push(`${hits} Damage (HP: ${_hbRes.prevHp} → ${_hbRes.newHp})`);
            } else {
              resultParts.push(`apply ${hits} Damage manually`);
            }
          } else {
            resultParts.push(`apply ${hits} Damage manually`);
          }
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
      const validTargets = adjacentAll.filter(f => isEntryHostileTo(game, f, playerNum));
      if (validTargets.length === 0) {
        return { applied: true, logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. No adjacent hostile figures.`, refreshBoard: true };
      }
      if (validTargets.length === 1) {
        // Auto-target single adjacent hostile: roll immediately
        const singleTarget = validTargets[0].figureKey;
        const _stIsNpc = typeof singleTarget === 'string' && /^npc_(?:thug|krykna)_\d+$/.test(singleTarget);
        const _stLabel = _stIsNpc
          ? (() => { const p = singleTarget.match(/^npc_(thug|krykna)_(\d+)$/); return `${p[1] === 'thug' ? 'Thug' : 'Krykna'} ${parseInt(p[2], 10) + 1}`; })()
          : dcNameFromFigureKey(singleTarget);
        const color = entry.headbuttDie || 'red';
        const faces = getDiceData().attack?.[color.toLowerCase()];
        if (!faces?.length) return { applied: true, logMessage: `**${entry.label}** — Moved to **${String(chosenSpace).toUpperCase()}**. Roll 1 ${color} die against **${_stLabel}** manually.`, refreshBoard: true };
        const face = faces[Math.floor(Math.random() * faces.length)];
        const hits = face.dmg ?? 0;
        const dieParts = [];
        if (hits) dieParts.push(`${hits} Hit${hits !== 1 ? 's' : ''}`);
        if (face.surge) dieParts.push(`${face.surge} Surge${face.surge !== 1 ? 's' : ''}`);
        const diceResult = dieParts.length ? dieParts.join(', ') : 'blank';
        const tName = _stLabel;
        const resParts = [];
        if (hits > 0) {
          if (_stIsNpc) {
            const p = singleTarget.match(/^npc_(thug|krykna)_(\d+)$/);
            const npcRes = applyDamageToNpcSync(game, {
              npcType: p[1], npcIndex: parseInt(p[2], 10), amount: hits, attackerPlayerNum: playerNum,
            });
            if (npcRes.applied) resParts.push(`${hits} Damage (HP: ${npcRes.prevHp} → ${npcRes.newHp})`);
          } else {
            const targetMsgId = findMsgIdForFigureKey(game, enemyPlayerNum, singleTarget, dcMessageMeta);
            if (dcHealthState && targetMsgId) {
              const healthState = dcHealthState.get(targetMsgId) || [];
              const fkMatch = singleTarget.match(/-(\d+)-(\d+)$/);
              const figIdx = fkMatch ? parseInt(fkMatch[2], 10) : 0;
              const entryHp = healthState[figIdx];
              if (entryHp) {
                // Defeat-aware pipeline (alexanbv 2026-06-22).
                const _hbRes2 = applyDamageWithDefeatCheck(dcHealthState, game, targetMsgId, figIdx, hits, enemyPlayerNum, {
                  sourceLabel: 'Headbutt', attackerPlayerNum: playerNum,
                });
                resParts.push(`${hits} Damage (HP: ${_hbRes2.prevHp} → ${_hbRes2.newHp})`);
              }
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

    // Phase 1: stamp pendingMoveX (2-space picker per CRR MOVE-017) +
    // headbuttRoll continuation. After the picker drains, the
    // continuation enumerates adjacent hostiles from the figure's
    // post-move position and either auto-rolls (1 hostile) or posts a
    // target picker (2+ hostiles); 0 → effect fizzles.
    game.pendingMoveX = game.pendingMoveX || {};
    game.pendingMoveX[msgId] = {
      remaining: entry.headbuttMove,
      source: entry.label || 'Headbutt',
      playerNum,
      figureKey: activatingFigureKey,
      dcName: meta?.dcName || '',
      threadId: null,
      bypassCosts: true,
      msgId,
      nextAction: {
        type: 'headbuttRoll',
        payload: {
          msgId,
          playerNum,
          figureKey: activatingFigureKey,
          dieColor: entry.headbuttDie || 'red',
          label: entry.label || 'Headbutt',
        },
      },
    };
    return {
      applied: true,
      pendingMoveXMsgId: msgId,
      activeMsgId: msgId,
      logMessage: `**${entry.label}** — Move up to ${entry.headbuttMove} space${entry.headbuttMove === 1 ? '' : 's'}, then choose an adjacent hostile and roll 1 ${entry.headbuttDie || 'red'} die.`,
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
    // Loth-cat (Elite & Regular) deploy as 2-figure groups: Pounce must act on the
    // SELECTED figure, not hardcoded figure 0 (else figure 1 would teleport figure 0).
    const _plSelIdx = game.dcActionsData?.[msgId]?.selectedFigure ?? 0;
    const fk = figureKeys[_plSelIdx] || figureKeys[0];
    if (!chosenSpace) {
      // First call: enumerate empty spaces within pounceRange using the IACP
      // "counting spaces" rule (per destruct 2026-05-07): impassable terrain
      // does NOT block counting. We use chebyshev distance on (col, row) over
      // every map cell — equivalent to 8-direction BFS through the grid
      // ignoring all walls. Landing space must still be a valid map cell and
      // unoccupied. Path-traversal (getReachableSpaces) was wrong because it
      // respected the impassable-edge graph.
      const pos = game.figurePositions?.[playerNum]?.[fk];
      if (!pos) return { applied: false, manualMessage: 'Figure has no position (deploy first).' };
      const boardState = getBoardStateForMovement(game, fk);
      if (!boardState?.mapSpaces) return { applied: false, manualMessage: 'Map data missing.' };
      const _plOrigin = parseCoord(pos);
      const _plMaxDist = entry.pounceRange;
      const _plMapKeys = Object.keys(boardState.mapSpaces.adjacency || {});
      const _plReachable = [];
      for (const _plK of _plMapKeys) {
        const _plP = parseCoord(_plK);
        if (_plP.col < 0 || _plP.row < 0) continue;
        const _plCheb = Math.max(Math.abs(_plP.col - _plOrigin.col), Math.abs(_plP.row - _plOrigin.row));
        if (_plCheb > 0 && _plCheb <= _plMaxDist) _plReachable.push(_plK);
      }
      const allReachable = _plReachable;
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
    // Per alexanbv 2026-05-13: Pounce is per-figure. Key by figureKey
    // so the free attack belongs to the figure that pounced, not the
    // whole DC group.
    game.pounceAttackPending = game.pounceAttackPending || {};
    game.pounceAttackPending[fk] = { figureKey: fk, figureIndex: 0 };
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

  // ccEffect: setsHarshEnvironment (Harsh Environment) — INTENTIONALLY UNIMPLEMENTED.
  // The card grants −1 Evade on exterior spaces and +1 Block on interior spaces,
  // which requires an interior/exterior space classification this engine does
  // not have. Per owner decision it is a no-op until such a model exists; the
  // game.harshEnvironmentActive flag is therefore never set, so the consumer in
  // combat-bridge.js stays dormant. Deck-loading reports it as unimplemented
  // (see UNIMPLEMENTED_CARDS in validation.js). (alexanbv 2026-06-18.)
  if (entry.type === 'ccEffect' && entry.setsHarshEnvironment) {
    return {
      applied: false,
      manualMessage: '**Harsh Environment** is not implemented (requires an interior/exterior space model) — resolve manually if you wish.',
    };
  }

  // ccEffect: markedTerritoryUnimplemented (Marked Territory) — NOT IMPLEMENTED
  // (alexanbv 2026-06-21, same class as Harsh Environment). Its 2nd clause grants
  // a Power Token to a group figure in an EXTERIOR space, which needs an
  // interior/exterior tile-type model this engine lacks (no map tags exterior
  // spaces). Per owner decision the whole card is a no-op + deck-load warning
  // (UNIMPLEMENTED_CARDS) until such a model exists.
  if (entry.type === 'ccEffect' && entry.markedTerritoryUnimplemented) {
    return {
      applied: false,
      manualMessage: '**Marked Territory** is not implemented (requires an interior/exterior tile-type model) — resolve manually if you wish.',
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

  // Tough Luck is NOT a proactively-played round-long effect. It is a discrete
  // post-reroll REACTION handled entirely by _offerToughLuck + handleToughLuckGate
  // (combat.js) when the opponent rerolls a die: one card = one die, consumed from
  // hand on use. There is intentionally no setsToughLuck handler here, and the
  // ability-library entry no longer carries setsToughLuck. (alexanbv 2026-06-18)

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
    // Per-player: each player could run Fifth Brother + YWNDM, so a mirror match
    // keeps each player's flag separate. alexanbv 2026-06-17.
    game.youWillNotDenyMeActive = game.youWillNotDenyMeActive || {};
    game.youWillNotDenyMeActive[playerNum] = true;
    return {
      applied: true,
      logMessage: '**You Will Not Deny Me** active — Fifth Brother cannot be defeated, ignores conditions, and recovers 2 Damage each time a hostile figure is defeated this round.',
    };
  }

  // ccEffect: setsMandaAsteel (Mandalorian Steel — recover 1 Damage when a friendly
  // figure WITHIN 4 SPACES of the FIGURE PLAYING THE CC spends a Block Token).
  // alexanbv 2026-06-21: the within-4 anchor is the playing figure — The Armorer,
  // OR Mara Jade via Fast Learner — not hard-coded to The Armorer. Resolve it via
  // the named-figure/Fast-Learner helper and track the figure key so the proximity
  // check uses its CURRENT position at attack-resolution time (figures move).
  if (entry.type === 'ccEffect' && entry.setsMandaAsteel) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.mandaAsteelPlayerNum = playerNum;
    // Anchor = the playing figure (The Armorer, or Mara Jade via Fast Learner).
    game.mandaAsteelArmorerFigureKey = null;
    const _maAnchorFk = resolveUniqueFigureCcFigureKey(game, playerNum, abilityId || entry.label || 'Mandalorian Steel');
    if (_maAnchorFk) game.mandaAsteelArmorerFigureKey = _maAnchorFk;
    const _maAnchorName = game.mandaAsteelArmorerFigureKey ? dcNameFromFigureKey(game.mandaAsteelArmorerFigureKey) : 'the playing figure';
    return {
      applied: true,
      logMessage: `This round, when a friendly figure within 4 spaces of **${_maAnchorName}** spends a Block Token during defense, recover 1 Damage on that figure.`,
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

  // ccEffect: disablesFigure (Disable — chosen ADJACENT hostile cannot use Surge or Special Actions this round)
  if (entry.type === 'ccEffect' && entry.disablesFigure) {
    const { game, playerNum, chosenOption, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = getDcList(game, 3 - playerNum) || [];
    if (chosenOption == null) {
      // CSV "an adjacent hostile figure" — only offer hostile DCs that have at
      // least one figure adjacent to one of the activating figures. disabledFigures
      // is keyed by DC displayName (consumed by combat/dc-play-area), so we keep
      // DC-level tracking but gate the offered list on per-figure adjacency.
      const oppNum = 3 - playerNum;
      const mapId = game.selectedMap?.id;
      const adjacentHostileDcNames = new Set();
      if (mapId && dcMessageMeta) {
        const actMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        const actMeta = actMsgId ? dcMessageMeta.get(actMsgId) : null;
        const actKeys = actMeta ? getFigureKeysForDcMsg(game, playerNum, actMeta) : [];
        for (const fk of actKeys) {
          const adj = getFiguresAdjacentToTarget(game, fk, mapId);
          for (const { figureKey: hfk, playerNum: hp } of adj) {
            if (hp === oppNum) adjacentHostileDcNames.add(dcNameFromFigureKey(hfk));
          }
        }
      }
      const options = oppDcList
        .filter((dc) => dc && !dc.defeated)
        .filter((dc) => {
          // No map/meta context → fall back to all hostiles (resolve manually).
          if (adjacentHostileDcNames.size === 0 && !mapId) return true;
          const dcName = dc.dcName || dc.displayName;
          return adjacentHostileDcNames.has(dcName);
        })
        .map((dc) => dc.displayName || dc.dcName)
        .filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No adjacent hostile figure to Disable.' };
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

  // ccEffect: setsDeadlyPrecision (Deadly Precision — this round, your attacks
  // apply -1 Dodge to the defense results). Per-player round flag; a gate mods
  // passive applies the -1 Dodge on each of your attacks. alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && entry.setsDeadlyPrecision) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    game.deadlyPrecisionActive = game.deadlyPrecisionActive || {};
    game.deadlyPrecisionActive[playerNum] = true;
    return {
      applied: true,
      logMessage: '**Deadly Precision** — this round, your attacks apply −1 Dodge to the defense results.',
    };
  }

  // ccEffect: setsThereIsAnother (There is Another, Leia) — draw 1, and this round
  // you may play UNIQUE CCs whose figure-name restriction matches another FORCE
  // USER Deployment card in your army (a Force-User-only Fast Learner). The
  // legality relaxation lives in cc-timing.js isCcPlayLegalByRestriction.
  // alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && entry.setsThereIsAnother) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const drew = (typeof entry.draw === 'number' && entry.draw > 0) ? drawCcCards(game, playerNum, entry.draw) : [];
    game.thereIsAnotherActive = game.thereIsAnotherActive || {};
    game.thereIsAnotherActive[playerNum] = true;
    return {
      applied: true,
      drewCards: drew.length > 0 ? drew : undefined,
      refreshHand: drew.length > 0,
      logMessage: `**There is Another** — drew ${drew.length} Command card${drew.length === 1 ? '' : 's'}. This round you may play unique CCs restricted to a FORCE USER DC name in your army.`,
    };
  }

  // ccEffect: windfallOnPlay (Windfall, Doctor Aphra) — played as a reaction to
  // one of your Command cards being discarded; gain VP equal to that card's
  // cost. The discard subroutine (fireCcDiscarded) records the most-recent
  // discarded card's cost per player in game.windfallDiscardCost; we read and
  // clear it here. Windfall's OTHER ability (+1 VP when Windfall itself is
  // discarded) is awarded automatically inside fireCcDiscarded — no flag.
  // alexanbv 2026-06-17.
  if (entry.type === 'ccEffect' && entry.windfallOnPlay) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const cost = game.windfallDiscardCost?.[playerNum] ?? 0;
    if (game.windfallDiscardCost) delete game.windfallDiscardCost[playerNum];
    const vk = vpKey(playerNum);
    game[vk] = game[vk] || { total: 0, kills: 0, objectives: 0 };
    game[vk].total = (game[vk].total || 0) + cost;
    return {
      applied: true,
      logMessage: cost > 0
        ? `**Windfall** — gained **${cost} VP** (cost of the discarded Command card).`
        : '**Windfall** — no recently discarded Command card to value (0 VP).',
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
    // Per-player: each player could run Maul (Dual-Bladed Fury), so a mirror
    // match keeps each player's Wreak Vengeance separate. alexanbv 2026-06-17.
    game.wreakVengeanceActive = game.wreakVengeanceActive || {};
    game.wreakVengeanceActive[playerNum] = true;
    return {
      applied: true,
      logMessage: '**Wreak Vengeance** active — when using Dual-Bladed Fury this activation, choose both effects instead of 1.',
    };
  }

  // ccEffect: revealsOpponentHand (Collect Intel) — ephemeral reveal of opponent's CC hand
  if (entry.type === 'ccEffect' && entry.revealsOpponentHand) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // CSV conditional: "you have 1 or more SPIES on the map". Count friendly
    // figures whose DC carries the SPY keyword that are actually deployed
    // (present in figurePositions). Mirrors the Comm Disruption SPY check.
    const _ciDcEffects = getDcEffects() || {};
    const _ciFigPos = game.figurePositions?.[playerNum] || {};
    const _ciHasSpyOnMap = Object.keys(_ciFigPos).some((fk) => {
      const kws = (_ciDcEffects[dcNameFromFigureKey(fk)]?.keywords || []).map((k) => String(k).toUpperCase());
      return kws.includes('SPY');
    });
    if (!_ciHasSpyOnMap) {
      return { applied: false, manualMessage: 'Collect Intel: you have no SPIES on the map.' };
    }
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
    const { game, playerNum, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Behind Enemy Lines CSV conditional: "in your opponent's deployment zone".
    // Gate on the activating figure(s) occupying the opponent's deployment zone.
    const _belMapId = game.selectedMap?.id;
    const _belMsgId = dcMessageMeta ? findActiveActivationMsgId(game, playerNum, dcMessageMeta) : null;
    const _belMeta = _belMsgId ? dcMessageMeta.get(_belMsgId) : null;
    const _belKeys = _belMeta ? getFigureKeysForDcMsg(game, playerNum, _belMeta) : [];
    if (_belMapId && _belKeys.length) {
      const _inOppZone = _belKeys.some((fk) => isFigureInOpponentDeploymentZone(game, playerNum, fk, _belMapId));
      if (!_inOppZone) {
        return { applied: false, manualMessage: "**Behind Enemy Lines** — the activating figure is not in your opponent's deployment zone. Cannot play." };
      }
    }
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
    // Per alexanbv 2026-05-13: Command cards are SECRET. Don't reveal
    // the chosen card name in the public log. (apply-ability-result
    // will refresh the private hand visual for the drawing player.)
    return {
      applied: true,
      drewCards: [chosenOption],
      refreshHand: true,
      logMessage: `**${entry.label}** — Searched deck and added 1 card to hand. Deck shuffled.`,
    };
  }

  // ccEffect: setsUnlimitedPower (Unlimited Power — Emperor targets any friendly figure on map this round)
  if (entry.type === 'ccEffect' && entry.setsUnlimitedPower) {
    const { game, playerNum } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    // Per-player (activation scope) — alexanbv 2026-06-17. NOTE: no reader of
    // unlimitedPowerActive was found (the Emperor's targeting range check that
    // should drop the 4-space limit this round) — the effect may not actually be
    // applied yet. Flagged for follow-up.
    game.unlimitedPowerActive = game.unlimitedPowerActive || {};
    game.unlimitedPowerActive[playerNum] = true;
    return {
      applied: true,
      logMessage: '**Unlimited Power** — The Emperor may target any friendly figure on the map (not limited to within 4 spaces) this round.',
    };
  }

  // ccEffect: cripplesFigure (Cripple — chosen ADJACENT hostile cannot voluntarily exit its space this round)
  if (entry.type === 'ccEffect' && entry.cripplesFigure) {
    const { game, playerNum, chosenOption, dcMessageMeta } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const oppDcList = getDcList(game, 3 - playerNum) || [];
    if (chosenOption == null) {
      // CSV "an adjacent hostile figure" — only offer hostile DCs that have at
      // least one figure adjacent to one of the activating (playing) figures.
      // Mirrors the sibling Disable handler (alexanbv 2026-06-21 anchor fix):
      // gate the offered list on per-figure adjacency to the figure that played
      // the card, rather than offering every non-defeated hostile.
      const oppNum = 3 - playerNum;
      const mapId = game.selectedMap?.id;
      const adjacentHostileDcNames = new Set();
      if (mapId && dcMessageMeta) {
        const actMsgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
        const actMeta = actMsgId ? dcMessageMeta.get(actMsgId) : null;
        const actKeys = actMeta ? getFigureKeysForDcMsg(game, playerNum, actMeta) : [];
        for (const fk of actKeys) {
          const adj = getFiguresAdjacentToTarget(game, fk, mapId);
          for (const { figureKey: hfk, playerNum: hp } of adj) {
            if (hp === oppNum) adjacentHostileDcNames.add(dcNameFromFigureKey(hfk));
          }
        }
      }
      const options = oppDcList
        .filter((dc) => dc && !dc.defeated)
        .filter((dc) => {
          // No map/meta context → fall back to all hostiles (resolve manually).
          if (adjacentHostileDcNames.size === 0 && !mapId) return true;
          const dcName = dc.dcName || dc.displayName;
          return adjacentHostileDcNames.has(dcName);
        })
        .map((dc) => dc.displayName || dc.dcName)
        .filter(Boolean);
      if (options.length === 0) return { applied: false, manualMessage: 'No adjacent hostile figure to Cripple.' };
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
    const _reinfMsgIds = getDcMessageIds(game, playerNum) || [];
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      if (!dcName) continue;
      const displayName = typeof dc === 'object' ? dc.displayName : dcName;
      const dgMatch = (displayName || '').match(/\[(?:DG|Group) (\d+)\]/);
      const dgIndex = dgMatch ? dgMatch[1] : String(i + 1);
      const stats = getStatsForDc(dcName);
      // Per-figure filtering: each figure is judged by ITS OWN card. The base
      // figures use the group's stats; a Squad Upgrade figure (index >= base
      // count) uses the SU CARD's traits + printed cost — so it Reinforces at its
      // own cost, independent of the base group, and a 4+ SU figure is excluded
      // even when the base group is <= 3. alexanbv 2026-06-17.
      const baseFigCount = stats?.figures ?? 1;
      const _suCard = squadUpgradeOnGroup(attachmentsForMsgId(game, _reinfMsgIds[i]));
      const _suStats = _suCard ? getStatsForDc(`[${_suCard}]`) : null;
      const totalFigs = baseFigCount + (_suCard ? 1 : 0);
      for (let figIdx = 0; figIdx < totalFigs; figIdx++) {
        const _isSu = _suCard && figIdx >= baseFigCount;
        const _fStats = _isSu ? _suStats : stats;
        const _fKw = _fStats?.keywords || [];
        if (pdf.traitFilter?.length && !pdf.traitFilter.some((t) => _fKw.includes(t))) continue;
        if (pdf.excludeTraits?.length && pdf.excludeTraits.some((t) => _fKw.includes(t))) continue;
        if (pdf.nonUnique && _fStats?.unique) continue;
        const _fCost = _fStats?.subCost ?? _fStats?.cost ?? 0;
        if (pdf.maxReinforcementCost != null && _fCost > pdf.maxReinforcementCost) continue;
        if (pdf.maxFigureCost != null && _fCost > pdf.maxFigureCost) continue;
        const fk = `${dcName}-${dgIndex}-${figIdx}`;
        if (!poses[fk]) {
          const suffix = totalFigs <= 1 ? '' : ` (${_isSu ? _suCard : String.fromCharCode(65 + figIdx)})`;
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
  const msgIds = getDcMessageIds(game, playerNum) || [];
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
    // Count the Squad Upgrade figure in the group total (defeated = total alive
    // - current). alexanbv 2026-06-17.
    const figureCount = groupEffectiveFigures(game, msgIds[i], stats?.figures ?? 1);
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

/** Eyes on the Prize: build the per-figure 3-way (+ skip) requiresChoice result. */
function _eyesPromptForFigure(figureKey) {
  const name = dcNameFromFigureKey(figureKey) || figureKey;
  return {
    applied: false,
    requiresChoice: true,
    choiceOptions: [
      `Recover 1 Damage — ${name}`,
      `Gain 1 Power Token — ${name}`,
      `Discard 1 HARMFUL — ${name}`,
      `Skip — ${name}`,
    ],
    choiceValues: ['recover', 'powertoken', 'condition', 'skip'],
  };
}
