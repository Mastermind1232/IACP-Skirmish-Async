// Analyzer-only geometry helpers. Reporting/diagnostic use; no policy consumer.
import { parseCoord } from '../../src/game/coords.js';

// Min Manhattan distance from coord to any live enemy — opponent DC figures
// plus non-defeated npcKrykna / npcThugs. Returns null when no enemies or
// coord unresolvable, so callers don't need an Infinity sentinel check.
//
// Mirrors learnings.js `_distToEnemyForAbility` so analyzer reports align
// with the live gate's nearest-enemy view on NPC maps (Atollon, Corellian).
export function distToNearestEnemy(coord, game, playerNum) {
  if (!coord) return null;
  const oppNum = playerNum === 1 ? 2 : 1;
  const positions = [];
  const oppFigs = game?.figurePositions?.[oppNum] || {};
  for (const pos of Object.values(oppFigs)) {
    if (pos) positions.push(pos);
  }
  for (const k of (game?.npcKrykna || [])) {
    if (k?.coord && !k.defeated) positions.push(k.coord);
  }
  for (const t of (game?.npcThugs || [])) {
    if (t?.coord && !t.defeated) positions.push(t.coord);
  }
  if (positions.length === 0) return null;
  let best = Infinity;
  const pa = parseCoord(coord);
  for (const op of positions) {
    try {
      const pb = parseCoord(op);
      const d = Math.abs(pa.col - pb.col) + Math.abs(pa.row - pb.row);
      if (d < best) best = d;
    } catch {}
  }
  return best < Infinity ? best : null;
}
