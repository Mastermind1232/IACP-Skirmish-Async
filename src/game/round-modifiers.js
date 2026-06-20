/**
 * Active round-modifier registry (alexanbv 2026-06-20 ruling).
 *
 * "There is no such thing as a per-player modifier. Restructure all the bonuses
 *  so they apply during the MODIFIERS stage, per-figure, IF the figure meets the
 *  conditions. They should apply to a given figure at the time that figure is
 *  attacking or defending, if it meets the criteria."
 *
 * Replaces the old per-player round-scoped COMBAT bonus flags
 * (game.roundDefenseBonusBlock[pn] etc.) with a single array of descriptors that
 * is evaluated PER-FIGURE at the combat modifiers stage. A bonus applies to a
 * figure only if THAT figure meets the card's conditions at the moment it
 * attacks/defends — so an End-of-Round-phase attack by a figure that does NOT
 * meet a card's conditions correctly gets nothing.
 *
 * Descriptor shape:
 *   {
 *     id,                         // string — de-dupe key
 *     card,                       // display name (for logging)
 *     ownerPlayerNum,             // 1|2 — whose army the bonus belongs to
 *     sourceFigureKey | null,     // the card-playing / anchoring figure
 *     side: 'attack' | 'defense',
 *     duration: 'during-round' | 'until-eor',
 *     conditions: {
 *       selfKeyword?,             // 'VEHICLE'|'TROOPER'|'MOBILE'|... — fk's DC keyword
 *       selfIsSourceFigure?,      // true → fk === sourceFigureKey ("you"/"your")
 *       excludeSourceFigure?,     // true → fk !== sourceFigureKey ("OTHER friendly")
 *       withinSpacesOfSource?,    // N → countGameSpaces(pos(fk),pos(source)) <= N
 *       attackType?,              // 'range'|'melee' — combat attack type
 *       affiliationScum?,         // true → fk's affiliation is Scum
 *     },
 *     effect: {
 *       block?, evade?, accuracyPenalty?, hit?, surge?,
 *       rerollAttackDice?, blockPerEvade?, personalCombatShield?,
 *     },
 *   }
 *
 * The module is PURE / unit-testable: it takes board state via injected helpers
 * (getDcEffect / countGameSpaces / dcNameFromFigureKey) imported lazily so the
 * evaluator has no Discord/engine dependency.
 */

import { getDcEffect } from './dc-helpers.js';
import { dcNameFromFigureKey } from './dc-helpers.js';
import { countGameSpaces } from './board-helpers.js';

/** Effect keys aggregated by evaluateRoundModifiers. */
const EFFECT_KEYS = [
  'block',
  'evade',
  'accuracyPenalty',
  'hit',
  'surge',
  'rerollAttackDice',
  'blockPerEvade',
  'personalCombatShield',
];

/**
 * Register a round-modifier descriptor. De-dupes by descriptor.id so replaying
 * the same card-play (idempotent dispatch) does not stack twice.
 * @param {object} game
 * @param {object} descriptor
 * @returns {boolean} true if newly added, false if a same-id descriptor existed
 */
export function registerRoundModifier(game, descriptor) {
  if (!game || !descriptor || !descriptor.id) return false;
  if (!Array.isArray(game.activeRoundModifiers)) game.activeRoundModifiers = [];
  if (game.activeRoundModifiers.some((d) => d && d.id === descriptor.id)) return false;
  game.activeRoundModifiers.push(descriptor);
  return true;
}

/**
 * Clear 'until-eor' descriptors (called at the START of the EOR/status phase so
 * "until the end of the round" bonuses fall off BEFORE EOR scoring/triggers).
 * 'during-round' descriptors are left in place; they clear at the round boundary
 * (cleanupRoundStart resets game.activeRoundModifiers to []).
 * @param {object} game
 */
export function clearRoundModifiersUntilEor(game) {
  if (!game || !Array.isArray(game.activeRoundModifiers)) return;
  game.activeRoundModifiers = game.activeRoundModifiers.filter(
    (d) => d && d.duration !== 'until-eor'
  );
}

/** Position of a figureKey on the board (any player's map — figureKeys are unique). */
function figurePos(game, figureKey) {
  if (!game || !figureKey) return null;
  const p1 = game.figurePositions?.[1]?.[figureKey];
  if (p1) return p1;
  const p2 = game.figurePositions?.[2]?.[figureKey];
  if (p2) return p2;
  return null;
}

/** Uppercased keyword list for a figureKey's DC. */
function keywordsForFigureKey(figureKey) {
  const dcName = dcNameFromFigureKey(figureKey);
  const eff = getDcEffect(dcName);
  return (eff?.keywords || []).map((k) => String(k).toUpperCase());
}

/**
 * True if figureKey `fk` satisfies ALL conditions on a descriptor right now.
 * @param {object} game
 * @param {object} descriptor
 * @param {string} fk          benefiting figureKey
 * @param {object} combat      current combat (for attackType)
 */
export function figureMeetsConditions(game, descriptor, fk, combat) {
  const c = descriptor.conditions || {};
  if (c.selfKeyword) {
    const kws = keywordsForFigureKey(fk);
    if (!kws.includes(String(c.selfKeyword).toUpperCase())) return false;
  }
  if (c.selfIsSourceFigure) {
    if (!descriptor.sourceFigureKey || fk !== descriptor.sourceFigureKey) return false;
  }
  if (c.excludeSourceFigure) {
    if (descriptor.sourceFigureKey && fk === descriptor.sourceFigureKey) return false;
  }
  if (typeof c.withinSpacesOfSource === 'number') {
    const src = descriptor.sourceFigureKey;
    if (!src) return false;
    if (fk === src) {
      // "within N of the source" — the source itself is at distance 0, but
      // these cards are phrased as buffing OTHER figures within range; the
      // excludeSourceFigure condition (when present) handles self-exclusion.
      // Distance 0 trivially satisfies the range test.
    } else {
      const a = figurePos(game, fk);
      const b = figurePos(game, src);
      if (!a || !b) return false;
      if (countGameSpaces(game, a, b) > c.withinSpacesOfSource) return false;
    }
  }
  if (c.attackType) {
    const isRanged = !!combat?.isRanged;
    if (c.attackType === 'range' && !isRanged) return false;
    if (c.attackType === 'melee' && isRanged) return false;
  }
  if (c.affiliationScum) {
    const dcName = dcNameFromFigureKey(fk);
    const eff = getDcEffect(dcName);
    if ((eff?.affiliation || '') !== 'Scum') return false;
  }
  return true;
}

/**
 * Aggregate all active round modifiers that apply to a given figure right now.
 * @param {object} game
 * @param {object} params
 * @param {'attack'|'defense'} params.side
 * @param {string} params.figureKey   the attacking/defending figureKey
 * @param {number} params.playerNum   owner of that figure
 * @param {object} params.combat
 * @returns {{block:number,evade:number,accuracyPenalty:number,hit:number,
 *            surge:number,rerollAttackDice:number,blockPerEvade:number,
 *            personalCombatShield:boolean, sources:Array}}
 */
export function evaluateRoundModifiers(game, { side, figureKey, playerNum, combat }) {
  const out = {
    block: 0,
    evade: 0,
    accuracyPenalty: 0,
    hit: 0,
    surge: 0,
    rerollAttackDice: 0,
    blockPerEvade: 0,
    personalCombatShield: false,
    sources: [],
  };
  if (!game || !Array.isArray(game.activeRoundModifiers) || !figureKey) return out;
  for (const d of game.activeRoundModifiers) {
    if (!d || d.side !== side) continue;
    if (d.ownerPlayerNum !== playerNum) continue;
    if (!figureMeetsConditions(game, d, figureKey, combat)) continue;
    const e = d.effect || {};
    let contributed = false;
    for (const k of EFFECT_KEYS) {
      if (e[k] == null) continue;
      if (k === 'personalCombatShield') {
        if (e[k]) { out.personalCombatShield = true; contributed = true; }
      } else if (typeof e[k] === 'number') {
        out[k] += e[k];
        contributed = true;
      }
    }
    if (contributed) out.sources.push({ id: d.id, card: d.card });
  }
  return out;
}
