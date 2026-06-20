/**
 * STANDING FIGURE AURAS — passive abilities on a board figure that project a
 * COMBAT-STAT bonus (attack/defense dice modifier) onto OTHER nearby friendly
 * figures, based per-figure on the acting figure's keyword / distance from the
 * AURA SOURCE figure / attack type (alexanbv 2026-06-20 ruling).
 *
 *   "Auras are PER FIGURE, but they are separate on which apply FIRST on a
 *    per-player basis (the ATTACKING player applies first, then the DEFENDING
 *    player). They apply at the SAME TIME as other mods/rerolls/etc. for that
 *    player."
 *
 * This module is the DATA table that drives evaluateFigureAuras() in
 * round-modifiers.js. Each entry is keyed by the carrier figure's
 * specialAbilityId. At combat-modifier time the evaluator scans the owning
 * player's on-board figures, and for every figure whose DC carries one of these
 * specialAbilityIds it synthesizes a round-modifier descriptor with
 * sourceFigureKey = the carrier figure, then applies it to the acting figure
 * via the SAME figureMeetsConditions / effect-aggregation path as played-CC
 * round modifiers. So the bonus lands on the acting figure only IF that figure
 * meets the aura's per-figure conditions at the moment it attacks/defends.
 *
 * Descriptor template shape (sourceFigureKey is filled in per carrier at
 * evaluation time):
 *   {
 *     specialAbilityId,   // carrier ability id (match against DC specialAbilityIds)
 *     card,               // display name for logging
 *     side: 'attack'|'defense',
 *     conditions: { ...figureMeetsConditions keys... },
 *     effect: { block?, evade?, accuracyPenalty?, hit?, surge?,
 *               rerollAttackDice?, blockPerEvade?, personalCombatShield? },
 *   }
 *
 * NOTE (investigation 2026-06-20): every genuine outward combat-stat figure
 * aura currently in data/dc-effects.json (Distracting, Protector, Sentinel,
 * Get Down, Soresu Form, Survival is Strength, Supporting Fire, Inspiring,
 * Shared Intuition, Squad Training, Call the Shots, Much to Learn, etc.) is
 * ALREADY handled correctly and per-figure by dedicated ad-hoc handlers in
 * src/handlers/combat.js (proximity + keyword + once-per-X limiters, plus
 * interactive prompts those auras require). Folding those into this flat
 * additive table would DOUBLE-COUNT them and drop their limiters/prompts, so
 * this table is intentionally EMPTY for now. The evaluation hook below is wired
 * into the same combat insertion points so that any FUTURE pure additive
 * combat-stat aura (one with no interactive prompt / no per-attack limiter) can
 * be migrated by adding a descriptor here — no engine change required.
 *
 * Self-conditional abilities (e.g. C-3PO/Imperial Officer "Cower" — buff the
 * figure ITSELF when adjacent to a friendly) are NOT auras and are not listed
 * here; they remain correctly handled per-figure in combat.js.
 *
 * @type {Array<{specialAbilityId:string, card:string, side:'attack'|'defense',
 *   conditions:object, effect:object}>}
 */
export const FIGURE_AURA_DESCRIPTORS = [
  // (intentionally empty — see module header)
];
