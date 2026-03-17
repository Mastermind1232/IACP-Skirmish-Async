/**
 * Compute a deterministic hash for a normalized squad's card lists.
 * Used for deduplication of favorite decks — two squads with the same
 * cards (in any order) produce the same hash.
 *
 * Input: post-normalizeSquadInput() squad object with dcList and ccList.
 */
import { createHash } from 'node:crypto';

export function computeDeckHash(squad) {
  const dcSorted = [...(squad.dcList || [])].sort();
  const ccSorted = [...(squad.ccList || [])].sort();
  const identity = JSON.stringify({ dc: dcSorted, cc: ccSorted });
  return createHash('sha256').update(identity).digest('hex');
}
