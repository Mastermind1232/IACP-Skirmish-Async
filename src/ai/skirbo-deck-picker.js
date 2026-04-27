/**
 * Pick a Destruct test deck for SKIRBO based on the opponent's squad.
 *
 * Rule: SKIRBO's deck must come from a different affiliation than the
 * opponent's. If the opponent has multiple affiliations (mixed deck),
 * SKIRBO's deck must avoid all of them.
 *
 * Falls back to any random Destruct deck if no eligible deck exists.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDcEffects } from '../data-loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

let _decks = null;
function loadDecks() {
  if (_decks) return _decks;
  try {
    _decks = JSON.parse(readFileSync(join(rootDir, 'data', 'destruct-test-decks.json'), 'utf8'));
  } catch {
    _decks = [];
  }
  return _decks;
}

function deckAffiliations(deck) {
  const cards = getDcEffects() || {};
  const affs = new Set();
  for (const entry of (deck?.dcList || [])) {
    if (typeof entry !== 'string') continue;
    // Skip bracket entries — those are attachments, not deployment cards.
    if (entry.charAt(0) === '[') continue;
    const card = cards[entry];
    if (card?.affiliation) affs.add(card.affiliation);
  }
  return affs;
}

/**
 * @param {object} playerSquad - Player's submitted squad ({ dcList, ccList, ... }).
 * @returns {{ name: string, dcList: string[], ccList: string[], dcCount: number, ccCount: number }}
 */
export function pickSkirboDeckForOpponent(playerSquad) {
  const decks = loadDecks();
  if (decks.length === 0) {
    return { name: 'SKIRBO Default', dcList: [], ccList: [], dcCount: 0, ccCount: 0 };
  }
  const playerAffs = deckAffiliations(playerSquad);
  const eligible = decks.filter((deck) => {
    const affs = deckAffiliations(deck);
    if (affs.size === 0) return false;
    for (const a of affs) if (playerAffs.has(a)) return false;
    return true;
  });
  const pool = eligible.length > 0 ? eligible : decks;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return {
    name: `SKIRBO: ${chosen.name}`,
    dcList: [...(chosen.dcList || [])],
    ccList: [...(chosen.ccList || [])],
    dcCount: (chosen.dcList || []).length,
    ccCount: (chosen.ccList || []).length,
  };
}
