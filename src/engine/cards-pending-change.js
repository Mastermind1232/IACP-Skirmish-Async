// Cards whose IACP card text is CURRENTLY BEING CHANGED (alexanbv 2026-06-16).
// Their abilities are intentionally NOT (re)implemented into the new timing
// pipeline until the final text lands — implementing them now would encode the
// soon-to-be-wrong version. Treat every entry here as "skip / do not wire".
//
// When a card's new text is finalized, remove it here and implement to spec.
//
// Match by DC/card BASE name (variant suffixes like " (Elite)" stripped).
export const CARDS_PENDING_CHANGE = new Set([
  // FINALIZED in the IACP 2026-06-21 update — implemented to spec, removed here:
  //   Rebel Trooper (Elite) — Aim / Get Ready / Get into Position / cost / surges
  //   Leia Organa — Military Efficiency is now a surge ability
  //   Bantha Rider — Wild Beast once/activation AND once/status phase
  //   Get Behind Me! — eligible figure = GUARDIAN or Rebel melee FORCE USER
  //   Bo-Katan Kryze — Beskar Armor (2 Block before the bonus ranged attack)
  //   CT-1701 — GRADUATED 2026-06-21: Cover Fire is once/round (hand-wired) and
  //   alexanbv confirmed Barrage is UNCHANGED (Perform 2 attacks; 2nd target
  //   within 3 of the first target space + adds 1 white die to the defense
  //   pool — implemented via barrageSecondAttack at abilities.js:2840). Removed.
  //   [Mortar Trooper] — innate +1 Acc, Surge +2 Dmg, Surge +2 Acc, Guidance
  //                      Systems now LIMIT once per attack
  //   74-Z Speeder Bike — Forward Mounted Blasters "same row" = same LINE
  //                       (row OR column); already implemented as the inline test
  //   The Armorer — HP increased 10 → 11; This is the Way + Survival is Strength
  //                 now gated to a friendly within 4 spaces of the Armorer
  //   KX-Series Security Droid — Shoulder Rush reworked (Double Action, move 6,
  //                 non-SMALL target: no push / KX cannot enter its space, still attacks)
  //   Yoda — VERIFIED already correct (cost 5; Calming Presence + Do or Do Not
  //          limited to REBEL FORCE USERS; Force Deflection wired + once/round, correct)
  //   Wookiee Rage / Stimulants — confirmed correct by designer (text unchanged)
  //
  // CHANGED SINCE THEIR PRINTED ART (alexanbv 2026-08-31) — the images in
  // vassal_extracted are SUPERSEDED for these, so do NOT "correct" the data
  // toward them. They are implemented to the ruling, not the picture:
  //   74-Z Speeder Bike — Forward Mounted Blasters was REWORKED. The art shows a
  //     flat "+1 Damage on the same row"; the live rule is: if you can draw a
  //     straight line of spaces (horizontal OR vertical) from BOTH of the 74-Z's
  //     spaces to the target, you may reroll 1 attack die, otherwise -1 Damage.
  //     That is what is implemented at handlers/combat.js:3982.
  //   Bodhi Rook — Air Support keeps its "and is not Focused" limitation, which
  //     the art omits. His surge is "+1 Damage" only; the art's "Pierce 1" on
  //     that cell is not live.
  //
  // NOTE: K-2SO STAYS (alexanbv 2026-06-16). The new "KX security droid" is a
  // separate card not yet in the DB — nothing to mark for it.
]);

/** Strip variant/group suffixes and test membership. */
export function isCardPendingChange(name) {
  if (!name) return false;
  const base = String(name)
    .replace(/\s*\[(?:DG|Group)\s*\d+\]\s*$/i, '')
    .replace(/\s*\((?:Elite|Regular)\)\s*$/i, '')
    .trim();
  return CARDS_PENDING_CHANGE.has(base) || CARDS_PENDING_CHANGE.has(String(name).trim());
}
