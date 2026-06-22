/**
 * SURGE BUCKETS — single source of truth for surge-on-miss gating.
 *
 * alexanbv 2026-06-22: surges are spent FIRST (before the miss/accuracy/dodge
 * check). A MISS = an uncancelled Dodge OR insufficient Accuracy. A hit that is
 * fully blocked to 0 damage is NOT a miss. Every surge EFFECT falls into exactly
 * one of three buckets, which decides whether it still resolves:
 *
 *   - 'requires_damage'  — applies only on a HIT and when the target suffers
 *                          damage (>0). The inline condition keywords (Surge:
 *                          Stun/Weaken/Bleed/Immobilize on the target, and
 *                          Surge: Focus/Hide on self) and the Blast/Cleave
 *                          keywords live here.
 *   - 'did_not_miss'     — applies on a HIT (not-miss), with NO damage
 *                          requirement. The "after this attack resolves, if it
 *                          did not miss, X becomes Y" / post-resolution effects.
 *   - 'no_restriction'   — resolves EVEN ON A MISS. Gain-token / recover / VP /
 *                          card-manipulation / special movement surges.
 *
 * This table is keyed by the surge KEY that parseSurgeEffect (combat.js) parses.
 * It is the ONE place a surge's bucket is declared — parseSurgeEffect routes
 * condition surges to the damage-gated vs not-miss bucket by reading it, and the
 * surge-bucket completeness test pins it against the parser's key set. Changing a
 * surge's gating is a one-line edit here.
 *
 * NOTE: pure attack-pool MODIFIERS (damage / pierce / accuracy / -1 dodge /
 * cancel) are not listed — they alter the roll itself before the hit check and
 * have no separate post-resolution gate.
 */

export const SURGE_BUCKET = Object.freeze({
  // ── requires_damage ──────────────────────────────────────────────────────
  // Inline condition keywords applied to the target as part of dealing damage.
  stun: 'requires_damage',
  weaken: 'requires_damage',
  bleed: 'requires_damage',
  immobilize: 'requires_damage',
  // Self conditions (attacker becomes Focused / Hidden) — also require damage.
  focus: 'requires_damage',
  hide: 'requires_damage',
  // Keyword splash effects — require a damaging hit.
  blast: 'requires_damage',
  cleave: 'requires_damage',

  // ── did_not_miss ─────────────────────────────────────────────────────────
  stun_net: 'did_not_miss',          // Zuckuss: "if it did not miss, target becomes Stunned"
  harass: 'did_not_miss',            // Jawa: "Strain if did not miss"
  suppression: 'did_not_miss',       // Biv Bodhrik: "if did not miss DUE TO ACCURACY" (accuracy variant)
  concussive_bolt: 'did_not_miss',   // 4-LOM: push SMALL target "if did not miss"
  spread_the_pain: 'did_not_miss',   // Dengar: conditions near target, "if did not miss"
  // (Cam Droid "Agitate" is campaign-only — alexanbv 2026-06-22 — not modelled.)
  // (Overload (Rebel Saboteur) is NOT a surge effect — it's a use-the-same-surge-
  //  twice meta-ability, like Hunter Protocol — so it carries no bucket.)
  // Drokkatta Shrapnel is a TWO-OPTION surge: Blast 2 (requires_damage) OR splash
  // (did_not_miss) — the chosen branch carries its own gate; see handleCombatPassive.

  // ── no_restriction (resolves even on a miss) ─────────────────────────────
  shocking_palm: 'no_restriction',   // 0-0-0: the attack MISSES yet applies Stun
  squad_command: 'no_restriction',   // Kayn: Focus a friendly TROOPER (no clause)
  fighting_knife: 'no_restriction',  // Verena: roll a red die at an adjacent hostile
  fell_swoop: 'no_restriction',      // Davith: become Hidden, move, free attack
  open_minded: 'no_restriction',     // Del Meeko: gain 1 MP or Power Token
  stalk_prey: 'no_restriction',
  bargain: 'no_restriction',         // Jawa Elite: spend VP, roll for VP
  mastery: 'no_restriction',         // Second Sister: redraw a CC
  interrogate: 'no_restriction',     // Agent Blaise: view hand / force discard
  military_efficiency: 'no_restriction', // Leia: shuffle a CC back into the deck
  recover: 'no_restriction',         // self-heal
  'hit token': 'no_restriction',
  'hit token 2': 'no_restriction',
  'block token': 'no_restriction',
  'power token': 'no_restriction',
  'evade token': 'no_restriction',
  evade: 'no_restriction',
  'block 1': 'no_restriction',
  'surge 1': 'no_restriction',
});

/**
 * The bucket for a surge key. Unknown / pure-modifier keys default to
 * 'no_restriction' (they have no condition/effect that a miss would cancel).
 * @param {string} key
 * @returns {'requires_damage'|'did_not_miss'|'no_restriction'}
 */
export function getSurgeBucket(key) {
  const k = String(key || '').replace(/^double:/, '').replace(/\s*\([^)]*\)/g, '').toLowerCase().trim();
  if (SURGE_BUCKET[k]) return SURGE_BUCKET[k];
  // Numbered keyword surges ("blast 2", "cleave 3", "hit token 2") collapse to
  // their base keyword's bucket.
  const m = k.match(/^([a-z ]+?)\s+\d+$/);
  if (m && SURGE_BUCKET[m[1]]) return SURGE_BUCKET[m[1]];
  return 'no_restriction';
}
