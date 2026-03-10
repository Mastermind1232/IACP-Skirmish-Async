/**
 * Parses Vassal .vsav squad files from IACP List Builder.
 * Extracts Deployment Cards and Command Cards.
 */

/**
 * Normalize a card name exported by IACP List Builder to match bot data keys.
 *   - Strip trailing " IACP" suffix (e.g. "Leia Organa IACP" → "Leia Organa")
 *   - Strip single-letter faction/variant suffix like " (M)", " (F)", " (I)" etc.
 *     (e.g. "Temporary Alliance (M)" → "Temporary Alliance")
 *   - Convert " [E]" → " (Elite)"  (e.g. "Hired Gun [E]" → "Hired Gun (Elite)")
 *   - Convert " [R]" → " (Regular)"
 * Bracket-prefixed attachment names ("[Black Market]") are handled by the lookup
 * fallback in validation.js and getDcStats().
 */
function normalizeCardName(name) {
  let n = name.replace(/\s+IACP$/i, '').trim();
  // Strip faction/variant suffixes:
  //   Single-letter: " (M)", " (F)", " (R)", " (I)"
  //   Full-word: " (Mercenary)", " (Imperial)", " (Rebel)"
  n = n.replace(/\s+\([A-Z]\)$/i, '').trim();
  n = n.replace(/\s+\((?:Mercenary|Imperial|Rebel)\)$/i, '').trim();
  // Convert elite/regular bracket notation to paren notation used in the data
  n = n.replace(/\s+\[E\]$/i, ' (Elite)');
  n = n.replace(/\s+\[R\]$/i, ' (Regular)');
  return n;
}

/**
 * Parse vsav file content and extract DC/CC lists.
 *
 * Primary source: VASSAL "piece;;;" entries — these are the authoritative card list
 * representing actual cards in the player's hand/deck.  Older vsav files may only
 * contain the legacy "D card-" / "C card--" image-reference format, so we fall back
 * to that when no piece entries are found.
 *
 * Newer IACP cards use image names like "014 Paz Vizsla Final.png" instead of the
 * standard "D card-Faction--Name.ext" convention.  These cannot be classified as DC
 * or CC from the image name alone, so they are returned in an `unclassified` array
 * for the caller (normalizeSquadInput) to resolve against the card databases.
 *
 * @param {string} content - Raw vsav file content (UTF-8)
 * @returns {{ dcList: string[], ccList: string[], unclassified?: string[], squadName?: string } | null}
 */
export function parseVsav(content) {
  if (!content || typeof content !== 'string') return null;

  // ── Primary: parse piece;;; entries (authoritative VASSAL card list) ──
  const pieceDcList = [];
  const pieceCcList = [];
  const pieceUnclassified = [];

  const pieceRegex = /piece;;;([^;]+\.(?:jpg|png|gif));([^/\\]+?)(?:\/)/g;
  let m;
  while ((m = pieceRegex.exec(content)) !== null) {
    const img = m[1];
    const rawName = m[2].trim();
    if (!rawName || !/[A-Za-z]/.test(rawName) || rawName.length < 2) continue;
    // Skip companion/token cards (e.g. "Comp card--The Child", "Companion Card--Junk Droid")
    if (/Comp(?:anion)?\s*[Cc]ard/i.test(img)) continue;

    const name = normalizeCardName(rawName);

    // Classify by image path — handles both legacy and IACP-prefixed naming
    //   "D card-Imp--Name.jpg"  or  "IACP11_D card-Imp--Name.png"
    //   "C card--Name.jpg"      or  "IACP9_C card--Name.png"
    if (/(?:^|_)D card-/i.test(img)) {
      pieceDcList.push(name);
    } else if (/(?:^|_)C card-/i.test(img)) {
      pieceCcList.push(name);
    } else {
      // New IACP format (e.g. "014 Paz Vizsla Final.png", "Smoke Grenade Final.png")
      // Cannot classify from image name — needs database lookup
      pieceUnclassified.push(name);
    }
  }

  if (pieceDcList.length > 0 || pieceCcList.length > 0 || pieceUnclassified.length > 0) {
    return {
      dcList: pieceDcList,
      ccList: pieceCcList,
      unclassified: pieceUnclassified.length > 0 ? pieceUnclassified : undefined,
      dcCount: pieceDcList.length,
      ccCount: pieceCcList.length,
    };
  }

  // ── Fallback: legacy regex parsing (older vsav files without piece entries) ──
  const dcList = [];
  const ccList = [];

  const dcRegex = /D card-[^;]+\.(?:jpg|png|gif);([^/\\]+?)(?:\/|;;|$)/g;
  while ((m = dcRegex.exec(content)) !== null) {
    const raw = m[1].trim();
    if (raw && !/^[;\s]*$|^;?true$/i.test(raw) && /[A-Za-z]/.test(raw) && raw.length > 2) {
      dcList.push(normalizeCardName(raw));
    }
  }

  const ccRegex = /C card--[^;]+\.(?:jpg|png|gif);([^/\\]+?)(?:\/|;;|$)/g;
  while ((m = ccRegex.exec(content)) !== null) {
    const raw = m[1].trim();
    if (raw && !/^[;\s]*$|^;?true$/i.test(raw) && /[A-Za-z]/.test(raw) && raw.length > 2) {
      ccList.push(normalizeCardName(raw));
    }
  }

  if (dcList.length === 0 && ccList.length === 0) return null;

  return {
    dcList,
    ccList,
    dcCount: dcList.length,
    ccCount: ccList.length,
  };
}

/**
 * Parse IACP list paste format (from Share button in IACP List Builder).
 * Format:
 *   -- Army Name ---
 *   Deployment Cards:
 *   - Card1
 *   - Card2
 *   Command Cards:
 *   - CC1
 *   Stats: ...
 * @param {string} content - Pasted message content
 * @returns {{ dcList: string[], ccList: string[], name?: string } | null}
 */
export function parseIacpListPaste(content) {
  if (!content || typeof content !== 'string') return null;
  const text = content.trim();
  if (!text.includes('Deployment Cards:') || !text.includes('Command Cards:')) return null;

  let name = '';
  const nameMatch = text.match(/^[-]*\s*(.+?)\s*-{2,}/m);
  if (nameMatch) name = nameMatch[1].trim();

  const beforeCC = text.split(/Command Cards:/i)[0];
  // Only parse lines after the "Deployment Cards:" header — excludes the army name header line
  const dcSectionStart = beforeCC.indexOf('Deployment Cards:');
  const dcSection = dcSectionStart >= 0 ? beforeCC.slice(dcSectionStart) : beforeCC;
  const ccSection = text.split(/Command Cards:/i)[1]?.split(/Stats:/i)[0] || '';

  const parseSection = (section) => {
    const items = [];
    for (const line of section.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.endsWith(':') || trimmed.startsWith('--') || trimmed.startsWith('#')) continue;
      // "- Card Name" or "- 8 Card Name" (bullet format, optionally with cost prefix)
      const bulletMatch = trimmed.match(/^-\s+(.+)$/);
      if (bulletMatch) {
        let cardText = bulletMatch[1].trim();
        // Strip leading cost number if present (e.g. "8 Zeb Orrelios" → "Zeb Orrelios")
        cardText = cardText.replace(/^\d+\s+/, '');
        items.push(normalizeCardName(cardText));
        continue;
      }
      // "12 Card Name" (cost-prefix format)
      const costMatch = trimmed.match(/^\d+\s+(.+)$/);
      if (costMatch) { items.push(normalizeCardName(costMatch[1].trim())); continue; }
      // Plain "Card Name" (no prefix)
      if (/[A-Za-z]/.test(trimmed)) items.push(normalizeCardName(trimmed));
    }
    return items;
  };

  const dcList = parseSection(dcSection);
  const ccList = parseSection(ccSection);

  if (dcList.length === 0 && ccList.length === 0) return null;

  return {
    dcList,
    ccList,
    dcCount: dcList.length,
    ccCount: ccList.length,
    name: name || undefined,
  };
}
