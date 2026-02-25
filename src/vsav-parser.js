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
  // Strip single-letter faction/variant suffixes like " (M)", " (F)", " (R)", " (I)"
  // The regex matches a space + one uppercase letter in parens at the end of the string.
  n = n.replace(/\s+\([A-Z]\)$/i, '').trim();
  // Convert elite/regular bracket notation to paren notation used in the data
  n = n.replace(/\s+\[E\]$/i, ' (Elite)');
  n = n.replace(/\s+\[R\]$/i, ' (Regular)');
  return n;
}

/**
 * Parse vsav file content and extract DC/CC lists.
 * @param {string} content - Raw vsav file content (UTF-8)
 * @returns {{ dcList: string[], ccList: string[], squadName?: string } | null}
 */
export function parseVsav(content) {
  if (!content || typeof content !== 'string') return null;

  const dcList = [];
  const ccList = [];
  const dcSeen = new Set();
  const ccSeen = new Set();

  // Deployment cards: D card-Imp--, D card-Reb--, D card-Merc--, D card-Neu--, etc.
  const dcRegex = /D card-[^;]+\.(?:jpg|png|gif);([^/\\]+?)(?:\/|;;|$)/g;
  let m;
  while ((m = dcRegex.exec(content)) !== null) {
    const raw = m[1].trim();
    if (raw && !/^[;\s]*$|^;?true$/i.test(raw) && /[A-Za-z]/.test(raw) && raw.length > 2) {
      const name = normalizeCardName(raw);
      if (!dcSeen.has(name)) { dcSeen.add(name); dcList.push(name); }
    }
  }

  // Command cards: C card--Name.jpg;Name/
  const ccRegex = /C card--[^;]+\.(?:jpg|png|gif);([^/\\]+?)(?:\/|;;|$)/g;
  while ((m = ccRegex.exec(content)) !== null) {
    const raw = m[1].trim();
    if (raw && !/^[;\s]*$|^;?true$/i.test(raw) && /[A-Za-z]/.test(raw) && raw.length > 2) {
      const name = normalizeCardName(raw);
      if (!ccSeen.has(name)) { ccSeen.add(name); ccList.push(name); }
    }
  }

  if (dcList.length === 0 && ccList.length === 0) return null;

  // Squad name from filename pattern "IA List [Faction] - Name.vsav" if we had it
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

  const dcSection = text.split(/Command Cards:/i)[0];
  const ccSection = text.split(/Command Cards:/i)[1]?.split(/Stats:/i)[0] || '';

  const parseSection = (section) => {
    const items = [];
    for (const line of section.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.endsWith(':') || trimmed.startsWith('--') || trimmed.startsWith('#')) continue;
      // "- Card Name" (bullet format)
      const bulletMatch = trimmed.match(/^-\s+(.+)$/);
      if (bulletMatch) { items.push(normalizeCardName(bulletMatch[1].trim())); continue; }
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
