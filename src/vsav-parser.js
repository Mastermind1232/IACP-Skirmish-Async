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
