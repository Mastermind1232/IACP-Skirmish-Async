// Condition-predicate layer (alexanbv 2026-06-16: "even generic rr have a
// condition — the figure with that ability has to be the one attacking ... check
// condition then show button then resolve in order of player choice ... should
// apply for ALL abilities acting at a given timing instance").
//
// Every gate ability carries a condition {type, ...params}. At a timing instance
// the gate evaluates it against the LIVE attack to decide whether to offer the
// button. Parameterized + reusable across every timing window (on_declare,
// rerolls, special, mods, zillo, after_resolve) — one condition engine, repeated
// per timing. Auras matter: an ability on Luke's card can apply to Baze's attack,
// so conditions are evaluated relative to the attacker, not the card holder.

import { dcNameFromFigureKey } from '../game/index.js';

/** Normalize a DC name for comparison (strip the [variant] suffix, lowercase). */
const norm = (s) => String(s || '').replace(/\s*\[.*\]\s*$/, '').trim().toLowerCase();

/** The attacking figure's DC name for this combat. */
export function attackerDcName(combat) {
  return norm(combat?.attackerDcName || dcNameFromFigureKey(combat?.attackerFigureKey || ''));
}

/**
 * Build a condition predicate `(game, combat) => boolean` from a spec
 * `{ type, ...params }`. Unknown/empty types default to always-true so an
 * ability is at worst offered (never silently dropped); real predicates narrow
 * it. Known types:
 *  - always                  : no extra condition.
 *  - attacker_is_self {card} : the ability's figure is the one attacking (the
 *                              base condition for every "self" ability).
 *  - spent_power_token       : a Power Token was spent on this attack (Ko-Tun).
 */
export function makeCondition(spec) {
  if (!spec || !spec.type) return () => true;
  switch (spec.type) {
    case 'always':
      return () => true;
    case 'attacker_is_self': {
      const card = norm(spec.card);
      return (game, combat) => attackerDcName(combat) === card;
    }
    case 'spent_power_token':
      return (game, combat) => !!combat?.attackerSpentPowerToken;
    default:
      return () => true;
  }
}
