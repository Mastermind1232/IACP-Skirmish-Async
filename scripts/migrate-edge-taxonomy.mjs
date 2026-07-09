// One-time migration (alexanbv 2026-07-09): split the conflated impassableEdges
// field into the three rule-distinct edge classes:
//   wallEdges             — black lines + map boundary; adjacency CUT
//   movementBlockingEdges — solid red; adjacent but gated (Wall Run crosses)
//   impassableEdges       — dashed red; adjacent but gated (Thrusters/Haul/
//                           Wall Run cross)
// Sources: nick-los.json walls/blockingEdges (authoritative), current spaces
// for boundary detection, and lothal's orth adjacency cuts (the traced
// sinkhole/cliff dashed edges) which move from pure cuts to gated edges.
// Diagonal pit-corner cuts on lothal stay cut (conservative; needs a ruling).
// Idempotent: reruns produce the same output.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MS = JSON.parse(readFileSync(join(ROOT, 'data/map-spaces.json'), 'utf8'));
const NICK = JSON.parse(readFileSync(join(ROOT, 'data/nick-los.json'), 'utf8')).maps;

function colToLetter(c) { return c < 26 ? String.fromCharCode(65 + c) : colToLetter(Math.floor(c / 26) - 1) + colToLetter(c % 26); }
const coordKey = (c, r) => colToLetter(c).toLowerCase() + (r + 1);
function parseKey(k) {
  const m = /^([a-z]+)(\d+)$/.exec(k.toLowerCase());
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 96);
  return { col: col - 1, row: +m[2] - 1 };
}
const ek = (a, b) => [a, b].sort().join('|');
const isOrth = (a, b) => {
  const A = parseKey(a), B = parseKey(b);
  return Math.abs(A.col - B.col) + Math.abs(A.row - B.row) === 1;
};

function makeFromNick(nl) {
  const tx = nl.transform.x, ty = nl.transform.y;
  return (nx, ny) => {
    const xS = (nx - tx.offset) / tx.scale, yS = (ny - ty.offset) / ty.scale;
    let col, row;
    if (tx.from === 'col') col = xS; else row = xS;
    if (ty.from === 'col') col = yS; else row = yS;
    return { col: Math.round(col), row: Math.round(row) };
  };
}
function expandSegs(segs, fromNick) {
  const out = new Set();
  const tile = (x, y) => { const { col, row } = fromNick(x, y); return coordKey(col, row); };
  for (const [p1, p2] of segs || []) {
    const wdx = p2.x - p1.x, wdy = p2.y - p1.y;
    if (wdy === 0 && wdx !== 0) {
      const Y = p1.y, X0 = Math.min(p1.x, p2.x), X1 = Math.max(p1.x, p2.x);
      for (let X = X0; X < X1; X++) out.add(ek(tile(X, Y - 1), tile(X, Y)));
    } else if (wdx === 0 && wdy !== 0) {
      const X = p1.x, Y0 = Math.min(p1.y, p2.y), Y1 = Math.max(p1.y, p2.y);
      for (let Y = Y0; Y < Y1; Y++) out.add(ek(tile(X - 1, Y), tile(X, Y)));
    }
  }
  return out;
}

for (const [id, m] of Object.entries(MS.maps)) {
  if (id === 'unit-test-grid' || !NICK[id]) continue;
  const nl = NICK[id];
  const fromNick = makeFromNick(nl);
  const wallUnits = expandSegs(nl.walls, fromNick);
  const blockUnits = expandSegs(nl.blockingEdges, fromNick);
  const spaces = new Set(m.spaces);

  const adjPairs = new Set();
  for (const [c, ns] of Object.entries(m.adjacency)) for (const n of ns) adjPairs.add(ek(c, n));

  const wallEdges = [];
  const mbe = [];
  const impassable = [];
  const seen = new Set();
  const push = (arr, a, b) => { const k = ek(a, b); if (!seen.has(k)) { seen.add(k); arr.push([a, b].sort()); } };

  // idempotency: edges already classified into wallEdges stay walls, and
  // existing movementBlockingEdges stay blocking (must ingest BEFORE the
  // adjacency-cut scan or their freshly-cut links get reclassified as
  // impassable on reruns)
  for (const [a, b] of m.wallEdges || []) push(wallEdges, a.toLowerCase(), b.toLowerCase());
  // existing movementBlockingEdges: keep as blocking ONLY if nick's LOS data
  // knows the edge (solid red blocks LOS, so every true blocking edge is in
  // nick.blockingEdges). Anything nick lacks cannot block LOS -> it is a
  // dashed-red IMPASSABLE edge that was misfiled (lothal sinkhole/cliffs etc.).
  for (const [a0, b0] of m.movementBlockingEdges || []) {
    const a = a0.toLowerCase(), b = b0.toLowerCase();
    if (blockUnits.has(ek(a, b))) push(mbe, a, b); else push(impassable, a, b);
  }
  // classify every edge currently in impassableEdges
  for (const [a0, b0] of m.impassableEdges || []) {
    const a = a0.toLowerCase(), b = b0.toLowerCase();
    const k = ek(a, b);
    if (blockUnits.has(k)) push(mbe, a, b);
    else if (wallUnits.has(k)) push(wallEdges, a, b);
    else if (!spaces.has(a) || !spaces.has(b)) push(wallEdges, a, b); // boundary = wall
    else push(impassable, a, b); // both on-map, not a nick wall: dashed-red terrain edge
  }
  // orth adjacency cuts not explained by walls = dashed-red edges recorded only
  // as cuts (lothal sinkhole/cliffs)
  for (const c of m.spaces) {
    const { col, row } = parseKey(c);
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const n = coordKey(col + dc, row + dr);
      if (!spaces.has(n)) continue;
      const k = ek(c, n);
      if (adjPairs.has(k) || wallUnits.has(k) || blockUnits.has(k) || seen.has(k)) continue;
      if ((m.blocking || []).includes(c) || (m.blocking || []).includes(n)) continue; // blocking-cell isolation
      push(impassable, c, n);
    }
  }
  // adjacency per CRR (alexanbv 2026-07-09):
  //  - impassable edges: counting goes THROUGH impassable ("can be moved into
  //    and through for this measurement") — the two cells stay ADJACENT.
  //  - blocking edges: counting "cannot go through walls, doors, or blocking
  //    terrain" — adjacency is CUT (Massive/Mobile crossing is an engine
  //    special-case, not an adjacency link).
  const restore = impassable.filter(([a, b]) => spaces.has(a) && spaces.has(b) && isOrth(a, b));
  let restored = 0;
  for (const [a, b] of restore) {
    if (!(m.adjacency[a] || []).includes(b)) { (m.adjacency[a] = m.adjacency[a] || []).push(b); restored++; }
    if (!(m.adjacency[b] || []).includes(a)) { (m.adjacency[b] = m.adjacency[b] || []).push(a); }
  }
  let cut = 0;
  for (const [a, b] of mbe) {
    if ((m.adjacency[a] || []).includes(b)) { m.adjacency[a] = m.adjacency[a].filter((x) => x !== b); cut++; }
    if ((m.adjacency[b] || []).includes(a)) { m.adjacency[b] = m.adjacency[b].filter((x) => x !== a); }
  }

  const sortEdges = (arr) => arr.sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
  m.wallEdges = sortEdges(wallEdges);
  m.movementBlockingEdges = sortEdges(mbe);
  m.impassableEdges = sortEdges(impassable);
  console.log(id.padEnd(26), `walls=${wallEdges.length} blockingEdges=${mbe.length} impassable=${impassable.length} adjRestored=${restored} adjCut=${cut}`);
}

writeFileSync(join(ROOT, 'data/map-spaces.json'), JSON.stringify(MS, null, 2) + '\n');
console.log('map-spaces.json migrated');
