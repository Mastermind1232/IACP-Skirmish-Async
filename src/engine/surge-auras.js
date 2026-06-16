// Surge-granting auras (alexanbv 2026-06-16: "figures that have an aura that
// grants use of surge abilities have figures within their aura display those
// surges in the spend surges step"). A friendly OWNER figure within range grants
// its OWN surge abilities to friendly figures matching a keyword filter. Reuses
// the owner-centric / footprint-aware condition engine for eligibility; the
// granted surges are data-driven (the owner's dc-effects surgeAbilities). The
// attacker's spend_surges step adds these to its surge list at declaration.

import { getDcEffects } from '../data-loader.js';
import { makeCondition } from './combat-conditions.js';

const norm = (s) => String(s || '').replace(/\s*\[.*\]\s*$/, '').trim();
function ownerSurges(card) {
  const all = getDcEffects() || {};
  return (all[card] || all[norm(card)])?.surgeAbilities || [];
}

/**
 * Each aura: owner card, range, and the keyword(s) a figure must have to receive
 * the grant. `acsRange` is an optional extended range under a self-buff (Sorin's
 * Armored Cavalry Support — wired when that flag lands).
 */
export const SURGE_AURAS = [
  { owner: 'Gar Saxon', range: 4, keywords: ['MOBILE'] },
  { owner: 'General Sorin', range: 1, acsRange: 3, keywords: ['DROID', 'VEHICLE'] },
  // CC / no-range grants (Covering Fire → your TROOPERS this round; Targeting
  // Network → your DROIDS) graduate next — they need the CC/round-scope source.
];

/**
 * Surge-ability keys granted to the ATTACKER by friendly surge-auras it stands in.
 * For each aura: a friendly owner figure of the card must be within range of the
 * attacker (within_n_of_source — owner-centric, footprint-aware) AND the attacker
 * must match the aura's keyword filter. Returns the union of those owners'
 * surgeAbilities. Deduped by the caller.
 */
export function auraGrantedSurges(game, combat) {
  const out = [];
  for (const a of SURGE_AURAS) {
    const range = a.range; // ACS-extended range wired with its flag later
    const inRange = makeCondition({ type: 'within_n_of_source', card: a.owner, n: range, side: 'attacker' });
    if (!inRange(game, combat)) continue;
    const hasKw = (a.keywords || []).some((kw) => makeCondition({ type: 'attacker_has_keyword', keyword: kw })(game, combat));
    if (!hasKw) continue;
    for (const s of ownerSurges(a.owner)) out.push(s);
  }
  return out;
}
