/**
 * Pure helpers for Jawa Scavenger (Elite)'s **Scavenged Stock**.
 *
 * Card text: "Your army may include up to 3 DROID cards from other
 *  affiliations."
 *
 * Army-building rule. Non-primary-affiliation DROID DCs already excused
 * by another ability (Doctor Aphra, Saska Teft, etc.) are skipped so
 * Scavenged Stock's 3-slot budget is not spent on DCs already allowed.
 *
 * Extracted from src/game/validation.js validateArmyAffiliation
 * (inlined at ~line 644) so the excusal math is covered by an explicit
 * probe.
 */

export const SCAVENGED_STOCK_JAWA_NAME = 'Jawa Scavenger (Elite)';
export const SCAVENGED_STOCK_MAX = 3;

function dcIsDroid(dc) {
  const kws = dc?.keywords || [];
  return kws.some((k) => String(k).toUpperCase() === 'DROID');
}

/**
 * Returns the list of DC names that Scavenged Stock should excuse from
 * affiliation checks, in encounter order (stable with `resolved`).
 *
 *   - Skips DCs sharing `primaryAffiliation`.
 *   - Skips `Any`-affiliation DCs (already universally legal).
 *   - Skips DCs already in `alreadyExcused`.
 *   - Non-DROID DCs are never excused.
 *   - Caps total excusals at SCAVENGED_STOCK_MAX (3).
 */
export function scavengedStockExcusals(
  resolved,
  primaryAffiliation,
  alreadyExcused = new Set(),
) {
  if (!Array.isArray(resolved) || !primaryAffiliation) return [];
  const out = [];
  for (const dc of resolved) {
    if (out.length >= SCAVENGED_STOCK_MAX) break;
    if (!dc || typeof dc !== 'object') continue;
    if (dc.affiliation === primaryAffiliation) continue;
    if (dc.affiliation === 'Any') continue;
    if (alreadyExcused.has(dc.name)) continue;
    if (!dcIsDroid(dc)) continue;
    out.push(dc.name);
  }
  return out;
}
