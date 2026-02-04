/**
 * Parses Vassal .vsav squad files from IACP List Builder.
 * Extracts Deployment Cards and Command Cards.
 */

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
    const name = m[1].trim();
    if (name && !dcSeen.has(name) && !/^[;\s]*$|^;?true$/i.test(name) && /[A-Za-z]/.test(name) && name.length > 2) {
      dcSeen.add(name);
      dcList.push(name);
    }
  }

  // Command cards: C card--Name.jpg;Name/
  const ccRegex = /C card--[^;]+\.(?:jpg|png|gif);([^/\\]+?)(?:\/|;;|$)/g;
  while ((m = ccRegex.exec(content)) !== null) {
    const name = m[1].trim();
    if (name && !ccSeen.has(name) && !/^[;\s]*$|^;?true$/i.test(name) && /[A-Za-z]/.test(name) && name.length > 2) {
      ccSeen.add(name);
      ccList.push(name);
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

  const parseBullets = (section) => {
    const lines = section.split('\n');
    const items = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^-\s+(.+)$/);
      if (match) {
        const item = match[1].trim();
        if (item && /[A-Za-z0-9]/.test(item)) items.push(item);
      }
    }
    return items;
  };

  const dcList = parseBullets(dcSection);
  const ccList = parseBullets(ccSection);

  if (dcList.length === 0 && ccList.length === 0) return null;

  return {
    dcList,
    ccList,
    dcCount: dcList.length,
    ccCount: ccList.length,
    name: name || undefined,
  };
}
