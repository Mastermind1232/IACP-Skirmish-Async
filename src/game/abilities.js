/**
 * F1 Ability library: lookup by id, resolve surge (code-per-ability). No Discord.
 * Surge resolution uses combat.parseSurgeEffect; DCs still reference keys in dc-effects (surgeAbilities array).
 */
import { getAbilityLibrary, getDcStats, getDcEffects } from '../data-loader.js';

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
  const entry = abilityId ? getAbility(abilityId) : null;
  if (!entry || entry.type === 'surge') {
    return { applied: false, manualMessage: 'Resolve manually (see rules).' };
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

  // ccEffect: Focus — requires active activation
  if (abilityId === 'Focus') {
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

  return { applied: false, manualMessage: entry.label ? `Resolve manually: ${entry.label}` : 'Resolve manually (see rules).' };
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
