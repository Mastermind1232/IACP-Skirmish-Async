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
import { getMapData, getDcEffects } from '../data-loader.js';
import { isWithinSpaces } from '../game/spatial.js';

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
    // Aura: the ability emanates from the OWNER figure (the card's figure on the
    // board), NOT the attacker. The attacker benefits iff it is within N spaces of
    // an owner figure. (alexanbv 2026-06-16 "auras are relative to the figure that
    // owns the ability".)
    case 'within_n_of_source': {
      const card = norm(spec.card);
      const n = spec.n ?? 3;
      return (game, combat) => {
        const pn = combat?.attackerPlayerNum;
        const atkPos = game?.figurePositions?.[pn]?.[combat?.attackerFigureKey];
        const mapId = game?.selectedMap?.id;
        if (!atkPos || !mapId) return false;
        const mapSp = getMapData(mapId);
        if (!mapSp) return false;
        const friendly = game.figurePositions?.[pn] || {};
        for (const [fk, pos] of Object.entries(friendly)) {
          if (norm(dcNameFromFigureKey(fk)) !== card) continue; // an owner figure of this ability's card
          if (isWithinSpaces(mapSp, String(pos).toLowerCase(), String(atkPos).toLowerCase(), n)) return true;
        }
        return false;
      };
    }
    // Group: the attacker is a figure of the owner's group (same deployment card).
    case 'in_group_of_source': {
      const card = norm(spec.card);
      return (game, combat) => attackerDcName(combat) === card;
    }
    // Adjacent = within 1 of an owner figure (special-case of the range aura).
    case 'adjacent_to_source':
      return makeCondition({ type: 'within_n_of_source', card: spec.card, n: 1 });
    // The attacking figure has a given keyword (e.g. "friendly TROOPER" abilities).
    case 'attacker_has_keyword': {
      const kw = String(spec.keyword || '').toUpperCase();
      return (game, combat) => {
        const e = (getDcEffects() || {})[combat?.attackerDcName] || (getDcEffects() || {})[norm(combat?.attackerDcName)];
        return (e?.keywords || []).map((k) => String(k).toUpperCase()).includes(kw);
      };
    }
    // A token was spent on this attack (any), or a specific type.
    case 'spent_any_token':
      return (game, combat) => !!(combat?.attackerSpentPowerToken || combat?.attackerSpentToken || combat?.spentTokenThisAttack);
    default:
      return () => true;
  }
}

/**
 * Guard predicate from the CSV `conditional` column (ANDed with the affects-based
 * usability). Data-derived per type; unknown prose → no extra restriction (the
 * affects-based check already scoped usage). One sub-method per recognised guard.
 */
export function conditionalGuard(conditional, card) {
  const s = String(conditional || '').toLowerCase();
  if (!s || s === 'none') return () => true;
  if (/spend (a|any|1).*token|after you spend|spent a.*token|power token/.test(s)) return makeCondition({ type: 'spent_any_token' });
  // target space is N or more / fewer spaces away (ranged sniper conditions).
  const dm = s.match(/target space is (\d+) or more/);
  if (dm) {
    const n = parseInt(dm[1], 10) || 0;
    return (game, combat) => (combat?.distanceToTarget ?? 0) >= n;
  }
  if (/did not (perform|make) an attack this activation/.test(s)) {
    return (game, combat) => !(game?.attackPerformedThisActivation?.[combat?.attackerFigureKey]);
  }
  return () => true; // unmodeled prose → no extra restriction yet (TODO: graduate)
}

/**
 * Sub-method for the "others" axis: a predicate for whether the ATTACKER is in an
 * ability's affects_others set, derived (owner-centric) from the CSV
 * affects_others prose. Returns null when the others-set can't grant the attacker
 * usage (e.g. it targets enemies). One small sub-method per condition type.
 */
function othersPredicate(affectsOthers, ownerCard) {
  const s = String(affectsOthers || '').toLowerCase();
  if (!s || s === 'none') return null;
  const m = s.match(/within\s+(\d+)/);
  if (m) return makeCondition({ type: 'within_n_of_source', card: ownerCard, n: parseInt(m[1], 10) || 3 });
  if (s.includes('adjacent')) return makeCondition({ type: 'adjacent_to_source', card: ownerCard });
  if (s.includes('group')) return makeCondition({ type: 'in_group_of_source', card: ownerCard });
  return null; // enemy-/unmodeled-targeting others → no attacker-usability grant
}

/**
 * Build an ability's usability condition from a CSV row in the recommended order:
 * check "self" FIRST (affects_self → the attacker is the owner) THEN "others"
 * (affects_others → the attacker is in the owner-centric affected set). Usable iff
 * either holds — so one self-method + a few others-sub-methods covers self-only /
 * others-only / both, instead of N×M combined functions (alexanbv 2026-06-16).
 * Reusable at EVERY timing instance, not just combat.
 */
export function conditionForRow(row) {
  const affectsSelf = String(row?.affects_self).toUpperCase() === 'TRUE';
  const selfPred = affectsSelf ? makeCondition({ type: 'attacker_is_self', card: row.card }) : null;
  const othersPred = othersPredicate(row?.affects_others, row?.card);
  const guard = conditionalGuard(row?.conditional, row?.card);
  return (game, combat) => {
    // self first, then others — usable iff the attacker is in the affected set …
    const usable = (selfPred && selfPred(game, combat)) || (othersPred && othersPred(game, combat));
    if (!usable) return false;
    // … AND the conditional-column guard holds.
    return guard(game, combat);
  };
}
