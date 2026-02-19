/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary, getDcStats, getDcEffects, getCcEffect } from '../data-loader.js';

/** Look up DC stats by name (handles display variants). */
function getStatsForDc(dcName) {
  const map = getDcStats() || {};
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
  return abilityId || '';
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
 * @returns {{ applied: boolean, manualMessage?: string, drewCards?: string[] }}
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
    return { applied: true, logMessage: msg };
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
    for (let i = 0; i < toAdd; i++) game.figurePowerTokens[fk].push('Wild');
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    const parts = ['Became Focused', 'Hidden', toAdd > 0 ? `gained ${toAdd} Power Token(s)` : null, `gained ${entry.mpBonus} MP`].filter(Boolean);
    return { applied: true, logMessage: parts.join(', ') + '.' };
  }

  // ccEffect: +N MP (Fleet Footed, Force Rush, etc.) — requires active activation
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
    const msg = n === 1 ? 'Gained 1 movement point.' : `Gained ${n} movement points.`;
    return { applied: true, logMessage: msg };
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
    for (let i = 0; i < toAdd; i++) game.figurePowerTokens[fk].push('Wild');
    const msg = toAdd === 1 ? 'Gained 1 Power Token.' : `Gained ${toAdd} Power Tokens.`;
    return { applied: true, logMessage: msg };
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
    return { applied: true, logMessage: `${adjacent.length} adjacent figure(s) became Focused.` };
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
    return { applied: true, logMessage: `${allKeys.length} figure(s) became Focused.` };
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
    return { applied: true, logMessage: `${focusPart}+${entry.attackBonusHits} Hit added to this attack.` };
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
    return { applied: true, logMessage: `${focusPart}+${n} Surge added to this attack.` };
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
    return { applied: true, logMessage: `Spent ${entry.mpCost} MP and became Focused.` };
  }

  // ccEffect: Focus / Meditation — apply Focus to activating figures; requires active activation
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
    return { applied: true, logMessage: 'Became Focused.' };
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
        game.figureEvadeTokens = game.figureEvadeTokens || {};
        for (const fk of figureKeys) {
          game.figureEvadeTokens[fk] = (game.figureEvadeTokens[fk] || 0) + entry.evadeTokenGain;
        }
      }
    }
    return {
      applied: true,
      logMessage: `Gained ${entry.evadeTokenGain || 0} Evade Token(s). Until end of round, when defending apply +${entry.roundDefenderBonusBlockPerEvade} Block per Evade result.`,
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
  if (entry.type === 'ccEffect' && typeof entry.mpBonus === 'number' && entry.mpBonus > 0 && entry.chooseAdjacentHostileThen) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    game.movementBank = game.movementBank || {};
    const bank = game.movementBank[msgId] || { total: 0, remaining: 0 };
    bank.total = (bank.total ?? 0) + entry.mpBonus;
    bank.remaining = (bank.remaining ?? 0) + entry.mpBonus;
    game.movementBank[msgId] = bank;
    const { damage = 0, strain = 0 } = entry.chooseAdjacentHostileThen;
    const totalDamage = damage + strain;
    if (totalDamage <= 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    const mapId = game.selectedMap?.id;
    if (!mapId || activatingKeys.length === 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const oppNum = playerNum === 1 ? 2 : 1;
    const hostileSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === oppNum) hostileSet.add(figureKey);
      }
    }
    const hostiles = [...hostileSet];
    if (hostiles.length === 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. No adjacent hostile.` };
    if (hostiles.length > 1 || !dcHealthState) {
      return { applied: true, logMessage: `Gained ${entry.mpBonus} MP. Resolve manually: choose adjacent hostile for ${damage} Damage, ${strain} Strain.` };
    }
    const targetFk = hostiles[0];
    const targetMsgId = findMsgIdForFigureKey(game, oppNum, targetFk, dcMessageMeta);
    if (!targetMsgId) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const targetMeta = dcMessageMeta.get(targetMsgId);
    if (!targetMeta) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
    const targetIdx = targetKeys.indexOf(targetFk);
    if (targetIdx < 0) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const healthState = dcHealthState.get(targetMsgId) || [];
    const entry_ = healthState[targetIdx];
    if (!Array.isArray(entry_) || entry_.length < 1) return { applied: true, logMessage: `Gained ${entry.mpBonus} MP.` };
    const [cur, max] = entry_;
    const newCur = Math.max(0, (cur ?? max ?? 0) - totalDamage);
    healthState[targetIdx] = [newCur, max];
    dcHealthState.set(targetMsgId, healthState);
    const dcMessageIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = oppNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(targetMsgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    const strainPart = strain > 0 ? ` and ${strain} Strain` : '';
    return {
      applied: true,
      logMessage: `Gained ${entry.mpBonus} MP. Adjacent hostile suffered ${damage} Damage${strainPart} (${totalDamage} total).`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
  }

  // ccEffect: chooseAdjacentHostileThen — choose one adjacent hostile figure, apply damage and/or strain (strain applied as damage)
  if (entry.type === 'ccEffect' && entry.chooseAdjacentHostileThen && (entry.chooseAdjacentHostileThen.damage > 0 || entry.chooseAdjacentHostileThen.strain > 0)) {
    const { game, playerNum, dcMessageMeta, dcHealthState } = context;
    const { damage = 0, strain = 0 } = entry.chooseAdjacentHostileThen;
    const totalDamage = damage + strain;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: no activation in progress.' };
    const meta = dcMessageMeta.get(msgId);
    if (!meta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const activatingKeys = getFigureKeysForDcMsg(game, playerNum, meta);
    if (activatingKeys.length === 0) return { applied: false, manualMessage: 'Resolve manually: no figures found.' };
    const mapId = game.selectedMap?.id;
    if (!mapId) return { applied: false, manualMessage: 'Resolve manually: no map selected.' };
    const oppNum = playerNum === 1 ? 2 : 1;
    const hostileSet = new Set();
    for (const fk of activatingKeys) {
      const adj = getFiguresAdjacentToTarget(game, fk, mapId);
      for (const { figureKey, playerNum: p } of adj) {
        if (p === oppNum) hostileSet.add(figureKey);
      }
    }
    const hostiles = [...hostileSet];
    if (hostiles.length === 0) return { applied: true, logMessage: 'No adjacent hostile figure.' };
    if (hostiles.length > 1) {
      return { applied: false, manualMessage: `Resolve manually: choose which of ${hostiles.length} adjacent hostile figures.` };
    }
    if (!dcHealthState) return { applied: false, manualMessage: 'Resolve manually: health state required.' };
    const targetFk = hostiles[0];
    const targetMsgId = findMsgIdForFigureKey(game, oppNum, targetFk, dcMessageMeta);
    if (!targetMsgId) return { applied: false, manualMessage: 'Resolve manually: could not find target deployment.' };
    const targetMeta = dcMessageMeta.get(targetMsgId);
    if (!targetMeta) return { applied: false, manualMessage: 'Resolve manually: could not find target.' };
    const targetKeys = getFigureKeysForDcMsg(game, oppNum, targetMeta);
    const targetIdx = targetKeys.indexOf(targetFk);
    if (targetIdx < 0) return { applied: false, manualMessage: 'Resolve manually: could not find target figure index.' };
    const healthState = dcHealthState.get(targetMsgId) || [];
    const entry_ = healthState[targetIdx];
    if (!Array.isArray(entry_) || entry_.length < 1) return { applied: false, manualMessage: 'Resolve manually: no health state for target.' };
    const [cur, max] = entry_;
    const newCur = Math.max(0, (cur ?? max ?? 0) - totalDamage);
    healthState[targetIdx] = [newCur, max];
    dcHealthState.set(targetMsgId, healthState);
    const dcMessageIds = oppNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcList = oppNum === 1 ? game.p1DcList : game.p2DcList;
    const idx = (dcMessageIds || []).indexOf(targetMsgId);
    if (idx >= 0 && dcList?.[idx]) dcList[idx].healthState = [...healthState];
    const strainPart = strain > 0 ? ` and ${strain} Strain` : '';
    return {
      applied: true,
      logMessage: `Adjacent hostile figure suffered ${damage} Damage${strainPart} (${totalDamage} total).`,
      refreshDcEmbed: true,
      refreshDcEmbedMsgIds: [targetMsgId],
    };
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
    let remaining = totalToAdd;
    for (const fk of figureKeys) {
      if (remaining <= 0) break;
      const current = (game.figurePowerTokens[fk] || []).length;
      const cap = 2 - current;
      const toAdd = Math.min(remaining, Math.max(0, cap));
      for (let i = 0; i < toAdd; i++) (game.figurePowerTokens[fk] = game.figurePowerTokens[fk] || []).push('Wild');
      remaining -= toAdd;
    }
    return { applied: true, logMessage: `Distributed ${totalToAdd} Hit Token(s) among figures in your group.` };
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

  // ccEffect: readyAdjacentFriendlyDeploymentCard (New Orders) — context.readyAdjacentFriendlyDcName from handler
  if (entry.type === 'ccEffect' && entry.readyAdjacentFriendlyDeploymentCard) {
    const { game, playerNum, readyAdjacentFriendlyDcName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (!readyAdjacentFriendlyDcName) {
      return {
        applied: false,
        requiresChoice: true,
        choiceTarget: 'readyAdjacentFriendlyDeploymentCard',
        manualMessage: 'Choose 1 adjacent friendly figure to ready its Deployment card.',
      };
    }
    const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
    const nameLower = String(readyAdjacentFriendlyDcName).toLowerCase().trim();
    for (let i = 0; i < dcList.length; i++) {
      const dc = dcList[i];
      const dcName = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
      const displayName = typeof dc === 'object' ? dc.displayName : dcName;
      const matchName = (displayName || dcName || '').toLowerCase();
      if (!matchName || (!matchName.includes(nameLower) && !nameLower.includes(matchName))) continue;
      if (typeof dc === 'object') dcList[i] = { ...dc, exhausted: false };
      else dcList[i] = { dcName, displayName: dcName, exhausted: false };
      return { applied: true, logMessage: `Readied **${displayName || dcName}**'s Deployment card.` };
    }
    return { applied: false, manualMessage: `Could not find Deployment card matching "${readyAdjacentFriendlyDcName}".` };
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

  // ccEffect: applyStunToUpToNAdjacentHostiles (Roar) — only if suffered damage >= N
  if (entry.type === 'ccEffect' && typeof entry.applyStunToUpToNAdjacentHostiles === 'number' && entry.applyStunToUpToNAdjacentHostiles > 0) {
    const { game, playerNum, dcMessageMeta, dcHealthState, stunnedFigureKeys } = context;
    if (!game || !playerNum || !dcMessageMeta) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    const msgId = findActiveActivationMsgId(game, playerNum, dcMessageMeta);
    if (!msgId) return { applied: false, manualMessage: 'Resolve manually: play during your activation.' };
    if (typeof entry.onlyIfSufferedDamageGte === 'number') {
      const healthState = dcHealthState?.get(msgId) || [];
      const totalDamage = healthState.reduce((s, e) => s + (e?.damage ?? 0), 0);
      if (totalDamage < entry.onlyIfSufferedDamageGte) {
        return { applied: false, manualMessage: `Roar: you must have suffered ${entry.onlyIfSufferedDamageGte}+ Damage (you have suffered ${totalDamage}).` };
      }
    }
    if (!Array.isArray(stunnedFigureKeys) || stunnedFigureKeys.length === 0) {
      return {
        applied: false,
        requiresChoice: true,
        choiceTarget: 'applyStunToAdjacentHostiles',
        choiceCount: Math.min(entry.applyStunToUpToNAdjacentHostiles, 3),
        manualMessage: `Choose up to ${entry.applyStunToUpToNAdjacentHostiles} adjacent hostile figures to become Stunned.`,
      };
    }
    game.figureConditions = game.figureConditions || {};
    for (const fk of stunnedFigureKeys.slice(0, entry.applyStunToUpToNAdjacentHostiles)) {
      const existing = game.figureConditions[fk] || [];
      if (!existing.includes('Stun')) game.figureConditions[fk] = [...existing, 'Stun'];
    }
    return {
      applied: true,
      logMessage: `${stunnedFigureKeys.length} adjacent hostile figure(s) became Stunned.`,
    };
  }

  // ccEffect: pushFriendlyWithin3Spaces (Reposition)
  if (entry.type === 'ccEffect' && typeof entry.pushFriendlyWithin3Spaces === 'number' && entry.pushFriendlyWithin3Spaces > 0) {
    const { game, playerNum, repositionFriendlyDcName } = context;
    if (!game || !playerNum) return { applied: false, manualMessage: entry.label || 'Resolve manually (see rules).' };
    if (!repositionFriendlyDcName) {
      return {
        applied: false,
        requiresChoice: true,
        choiceTarget: 'pushFriendlyWithin3Spaces',
        manualMessage: `Choose a SMALL friendly figure within 3 spaces to push up to ${entry.pushFriendlyWithin3Spaces} spaces.`,
      };
    }
    return {
      applied: true,
      logMessage: `Push **${repositionFriendlyDcName}** up to ${entry.pushFriendlyWithin3Spaces} spaces (resolve movement).`,
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
