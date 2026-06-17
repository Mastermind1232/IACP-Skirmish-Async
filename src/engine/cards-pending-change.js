// Cards whose IACP card text is CURRENTLY BEING CHANGED (alexanbv 2026-06-16).
// Their abilities are intentionally NOT (re)implemented into the new timing
// pipeline until the final text lands — implementing them now would encode the
// soon-to-be-wrong version. Treat every entry here as "skip / do not wire".
//
// When a card's new text is finalized, remove it here and implement to spec.
//
// Match by DC/card BASE name (variant suffixes like " (Elite)" stripped).
export const CARDS_PENDING_CHANGE = new Set([
  'Rebel Trooper',        // Aim (Elite) reworked
  'Mortar Trooper',       // [Mortar Trooper] / Guidance Systems
  '74-Z Speeder Bike',    // Forward Mounted Blasters etc.
  'Leia Organa',
  'CT-1701',              // Barrage / Cover Fire
  'Yoda',                 // Force Deflection
  'Bantha Rider',         // Wild Beast
  'K-2SO',                // KX security droid
  'Get Behind Me!',       // CC reworked
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
