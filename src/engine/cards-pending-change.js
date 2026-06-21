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
  // CT-1701 STAYS: only Cover Fire is finalized (now once/round, hand-wired);
  //   Barrage is still mid-change, so keep CT-1701 pending to avoid graduating
  //   its possibly-stale CSV rows.
  //   [Mortar Trooper] — innate +1 Acc, Surge +2 Dmg, Surge +2 Acc, Guidance
  //                      Systems now LIMIT once per attack
  //   74-Z Speeder Bike — Forward Mounted Blasters "same row" = same LINE
  //                       (row OR column); already implemented as the inline test
  //   The Armorer — HP increased 10 → 11
  'CT-1701',              // Barrage still changing (Cover Fire finalized + hand-wired)
  'Yoda',                 // Force Deflection
  'Stimulants',           // changing
  'Wookiee Rage',         // changing
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
