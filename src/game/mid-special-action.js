/**
 * Is a figure part-way through a multi-step SPECIAL ACTION?
 *
 * alexanbv 2026-09-10: "Spending banked Mp should not be permitted between
 * steps of any special action (for example, the three attacks of missile
 * salvo). MP gained as part of the special action must be spent immediately.
 * Banked mp are available once the special action fully resolves."
 *
 * The multi-step specials each track their own progress under a different key —
 * there is no shared "special action in progress" concept — so the knowledge of
 * WHICH states mean "mid-resolution" lives here, once, rather than being
 * repeated at each site that needs to ask. That is deliberate: this codebase has
 * repeatedly grown two or three copies of the same predicate that then drift
 * apart (the free-attack lists, the O/0 droid fold, Squad Cohesion's
 * attacker-only rule).
 *
 * Scope is the "perform N attacks as ONE action" family. Round-scoped and
 * per-attack modifiers (arcingShotActive, surgeDoublingActive, and the rest of
 * the *Active flags) are NOT special actions in progress and must not be here.
 */

/**
 * @returns {string|null} the special action's display name, or null if the
 *   figure is not mid-way through one.
 */
export function midSpecialAction(game, msgId, figureKey) {
  if (!game) return null;

  // Missile Salvo (BT-1) — alexanbv's named example. Keyed by msgId, and it
  // survives between shots while dice remain to be chosen.
  if (msgId != null && game.pendingMissileSalvo?.[msgId]) return 'Missile Salvo';

  if (!figureKey) return null;

  // THE GENERAL CASE. alexanbv 2026-09-10: "there are many more two attack
  // abilities. For example, vinto, ig11, tonfa. As well as abilities that allow
  // you to attack without spending an action."
  //
  // He is right that enumerating them was the wrong shape. `freeAttackBonus` is
  // the shared mechanism behind all of them — abilities.js:3095 calls it
  // "Heroic, Rapid Fire, Brutality, etc." — and it leaves
  // freeAttackBonusPending[figureKey] set for exactly as long as the figure
  // still owes an attack. An outstanding granted attack IS an action still
  // resolving, so taking a Move or spending banked MP first would be the two-
  // actions-at-once he ruled out.
  //
  // This covers Vinto's Rapid Fire, IG-11, Brutality, Sarlacc Sweep and every
  // future ability that grants an attack, without anyone having to remember to
  // add it to a list.
  if (game.freeAttackBonusPending?.[figureKey] != null) return 'a granted attack';
  if (game.pounceAttackPending?.[figureKey] != null) return 'Pounce';

  // The "perform N attacks" specials, each keyed per figure.
  const counted = [
    ['focusFireActive', 'Focus Fire'],
    ['multiFireActive', 'Multi-Fire'],
    ['overheatedActive', 'Overheated'],
  ];
  for (const [key, label] of counted) {
    const rec = game[key]?.[figureKey];
    if (rec && (rec.attacksRemaining ?? 0) > 0) return label;
  }

  const bare = [
    ['saberOrbitAttacksRemaining', 'Saber Orbit'],
    ['pummelAttacksRemaining', 'Pummel'],
  ];
  for (const [key, label] of bare) {
    if ((game[key]?.[figureKey] ?? 0) > 0) return label;
  }

  return null;
}

/** Every state key this module treats as "a special action is mid-resolution". */
export const MID_SPECIAL_ACTION_KEYS = Object.freeze([
  'pendingMissileSalvo',
  'freeAttackBonusPending',
  'pounceAttackPending',
  'focusFireActive',
  'multiFireActive',
  'overheatedActive',
  'saberOrbitAttacksRemaining',
  'pummelAttacksRemaining',
]);
