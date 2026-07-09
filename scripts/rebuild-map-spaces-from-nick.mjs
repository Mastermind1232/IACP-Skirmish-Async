// ⚠️ BOOTSTRAP-ERA SCRIPT — FROZEN 2026-07-09 (alexanbv directive).
// The map tool's saved data (data/map-spaces.json via the hosted editor) is
// now the ONLY ground truth for spaces/terrain/edges. Do NOT rerun this
// script against tool-authored data — it would overwrite manual corrections.
// Kept for historical reference and for bootstrapping brand-new maps ONLY
// (and then only before any manual tool edits exist for that map).
// Rebuild map-spaces geometry (spaces / adjacency / impassableEdges) for every
// map from nick-los.json, and validate the rebuild rule against the two
// nick-native human-curated maps (hoth-battle-station, lothal-wastes).
//
// Curated conventions (decoded from hoth/lothal ground truth):
//   spaces          = nick grid extent minus offMapTiles
//   impassableEdges = nick walls (unit-expanded) + nick blockingEdges
//                     + boundary edges (on-map cell <-> off-map orth neighbor)
//   adjacency       = orth + diagonal among on-map cells, minus:
//                     - blocking-terrain cells (isolated entirely)
//                     - orth pairs cut by walls/blockingEdges
//                     - diagonal pairs cut at a blockingIntersection vertex
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NICK = JSON.parse(readFileSync(`${ROOT}/data/nick-los.json`, 'utf8')).maps;
export const CUR = JSON.parse(readFileSync(`${ROOT}/data/map-spaces.json`, 'utf8')).maps;

// development-facility transform in nick-los.json is wrong (axes swapped; no
// blocking anchors existed to verify it). Solved by silhouette fit + visual check.
export const FIXED_TRANSFORMS = {
  'development-facility': { x: { from: 'col', scale: 1, offset: -5 }, y: { from: 'row', scale: 1, offset: -4 } },
};

function colToLetter(c) { return c < 26 ? String.fromCharCode(65 + c) : colToLetter(Math.floor(c / 26) - 1) + colToLetter(c % 26); }
export const coordKey = (c, r) => colToLetter(c).toLowerCase() + (r + 1);
export function parseKey(k) {
  const m = /^([a-z]+)(\d+)$/.exec(k.toLowerCase());
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 96);
  return { col: col - 1, row: +m[2] - 1 };
}
const ek = (a, b) => [a, b].sort().join('|');

function makeFromNick(nl, id) {
  const t = FIXED_TRANSFORMS[id] || nl.transform;
  const tx = t.x, ty = t.y;
  return (nx, ny) => {
    const xS = (nx - tx.offset) / tx.scale, yS = (ny - ty.offset) / ty.scale;
    let col, row;
    if (tx.from === 'col') col = xS; else row = xS;
    if (ty.from === 'col') col = yS; else row = yS;
    return { col: Math.round(col), row: Math.round(row) };
  };
}

export function rebuildMap(id) {
  const nl = NICK[id];
  const fromNick = makeFromNick(nl, id);
  const tileKey = (x, y) => { const { col, row } = fromNick(x, y); return coordKey(col, row); };

  // --- spaces
  let maxX = 0, maxY = 0;
  for (const t of [...(nl.offMapTiles || []), ...(nl.blockingTiles || []), ...(nl.spireTiles || [])]) { maxX = Math.max(maxX, t.x); maxY = Math.max(maxY, t.y); }
  const off = new Set((nl.offMapTiles || []).map((t) => `${t.x},${t.y}`));
  const spaces = new Set();
  for (let y = 0; y <= maxY; y++) for (let x = 0; x <= maxX; x++) if (!off.has(`${x},${y}`)) spaces.add(tileKey(x, y));

  // --- blocking terrain cells (from nick, transform-mapped)
  const blocking = new Set((nl.blockingTiles || []).map((t) => tileKey(t.x, t.y)));

  // --- wall + blockingEdge unit pairs (both block orth adjacency)
  const wallPairs = new Set();
  const expandEdges = (segs) => {
    for (const [p1, p2] of segs || []) {
      const wdx = p2.x - p1.x, wdy = p2.y - p1.y;
      if (wdy === 0 && wdx !== 0) {
        const Y = p1.y, X0 = Math.min(p1.x, p2.x), X1 = Math.max(p1.x, p2.x);
        for (let X = X0; X < X1; X++) wallPairs.add(ek(tileKey(X, Y - 1), tileKey(X, Y)));
      } else if (wdx === 0 && wdy !== 0) {
        const X = p1.x, Y0 = Math.min(p1.y, p2.y), Y1 = Math.max(p1.y, p2.y);
        for (let Y = Y0; Y < Y1; Y++) wallPairs.add(ek(tileKey(X - 1, Y), tileKey(X, Y)));
      }
    }
  };
  expandEdges(nl.walls);
  expandEdges(nl.blockingEdges);

  // --- blocking intersections -> vertex ids (set of up-to-4 our-frame cells)
  const vertexId = (cells) => cells.slice().sort().join('+');
  const biVertices = new Set();
  for (const bi of nl.blockingIntersections || []) {
    const { x, y } = bi;
    biVertices.add(vertexId([tileKey(x - 1, y - 1), tileKey(x - 1, y), tileKey(x, y - 1), tileKey(x, y)]));
  }

  // --- impassableEdges: walls + blockingEdges + boundary (on-map <-> off orth neighbor)
  const impassable = new Set(wallPairs);
  for (const c of spaces) {
    const { col, row } = parseKey(c);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0) continue;
      const n = coordKey(nc, nr);
      if (!spaces.has(n)) impassable.add(ek(c, n));
    }
  }

  // --- adjacency
  const adjacency = {};
  for (const c of spaces) adjacency[c] = [];
  for (const c of spaces) {
    if (blocking.has(c)) continue; // blocking cells isolated
    const { col, row } = parseKey(c);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = col + dc, nr = row + dr;
      if (nc < 0 || nr < 0) continue;
      const n = coordKey(nc, nr);
      if (!spaces.has(n) || blocking.has(n)) continue;
      if (dc === 0 || dr === 0) {
        if (wallPairs.has(ek(c, n))) continue;
      } else {
        // diagonal: shared vertex = the 4 cells at the corner
        const cells = [coordKey(col, row), coordKey(nc, nr), coordKey(col, nr), coordKey(nc, row)];
        if (biVertices.has(vertexId(cells))) continue;
      }
      adjacency[c].push(n);
    }
  }
  return { spaces, blocking, wallPairs, impassable, adjacency, biVertices };
}

// ---------------------------------------------------------------- validation
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of ['hoth-battle-station', 'lothal-wastes']) {
    const r = rebuildMap(id);
    const cur = CUR[id];
    const curSpaces = new Set(cur.spaces.map((s) => s.toLowerCase()));
    const spacesOk = r.spaces.size === curSpaces.size && [...r.spaces].every((c) => curSpaces.has(c));
    const curImp = new Set(cur.impassableEdges.map(([a, b]) => ek(a.toLowerCase(), b.toLowerCase())));
    const impMissing = [...curImp].filter((e) => !r.impassable.has(e));
    const impExtra = [...r.impassable].filter((e) => !curImp.has(e));
    // adjacency diff (undirected pair level)
    const pairSet = (adj) => {
      const s = new Set();
      for (const [c, ns] of Object.entries(adj)) for (const n of ns) s.add(ek(c.toLowerCase(), String(n).toLowerCase()));
      return s;
    };
    const curAdj = pairSet(cur.adjacency);
    const newAdj = pairSet(r.adjacency);
    const adjMissing = [...curAdj].filter((e) => !newAdj.has(e));
    const adjExtra = [...newAdj].filter((e) => !curAdj.has(e));
    console.log(`${id}: spaces ${spacesOk ? 'EXACT' : 'DIFF'} | impEdges missing=${impMissing.length} extra=${impExtra.length} | adjacency missing=${adjMissing.length} extra=${adjExtra.length}`);
    if (impMissing.length && impMissing.length <= 20) console.log('  imp missing:', impMissing.join(' '));
    if (impExtra.length && impExtra.length <= 20) console.log('  imp extra:', impExtra.join(' '));
    if (adjMissing.length && adjMissing.length <= 24) console.log('  adj missing:', adjMissing.join(' '));
    if (adjExtra.length && adjExtra.length <= 24) console.log('  adj extra:', adjExtra.join(' '));
  }
}
