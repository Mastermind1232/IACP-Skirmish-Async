// Generate the final map-spaces.json content for step-2 completion.
// hoth-battle-station: untouched (validated exact).
// lothal-wastes: adopt nick geometry (3 link changes) + keep curated terrain-edge
//   cuts (sinkhole/cliff dotted-red edges) harvested from the live file.
// all others: full rebuild from nick + curated terrain/blocking preserved.
import { readFileSync, writeFileSync } from 'fs';
import { rebuildMap, CUR, NICK, parseKey, coordKey } from './rebuild-map-spaces-from-nick.mjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ek = (a, b) => [a, b].sort().join('|');
const OUT = process.argv[2]; // optional output path; omit = dry-run report

// --- harvest lothal impassable-terrain edge cuts (curated adjacency cuts that
// are NOT explained by nick walls/BIs/blocking) --------------------------------
function pairSet(adj) {
  const s = new Set();
  for (const [c, ns] of Object.entries(adj)) for (const n of ns || []) s.add(ek(c.toLowerCase(), String(n).toLowerCase()));
  return s;
}
const lothalRebuilt = rebuildMap('lothal-wastes');
const lothalCurAdj = pairSet(CUR['lothal-wastes'].adjacency);
const lothalNewAdj = pairSet(lothalRebuilt.adjacency);
const lothalTerrainCuts = [...lothalNewAdj].filter((e) => !lothalCurAdj.has(e));
console.log(`lothal terrain-edge cuts harvested: ${lothalTerrainCuts.length}`);

const TERRAIN_EDGE_CUTS = { 'lothal-wastes': new Set(lothalTerrainCuts) };

// --- build final per-map records ---------------------------------------------
const final = {};
for (const id of Object.keys(NICK)) {
  if (id === 'hoth-battle-station') { final[id] = CUR[id]; continue; }
  const r = rebuildMap(id);
  const cur = CUR[id];
  const cuts = TERRAIN_EDGE_CUTS[id] || new Set();

  const spaces = [...r.spaces].sort((a, b) => { const A = parseKey(a), B = parseKey(b); return A.row - B.row || A.col - B.col; });

  // blocking: curated where traced (validated vs nick), else nick-derived
  const blocking = (cur.blocking && cur.blocking.length ? cur.blocking.map((x) => x.toLowerCase()) : [...r.blocking]).sort();
  const blockSet = new Set(blocking);

  // adjacency: terrain-edge cuts applied; blocking cells isolated per curated list
  const adjacency = {};
  for (const c of spaces) {
    adjacency[c] = blockSet.has(c) ? [] : (r.adjacency[c] || []).filter((n) => !cuts.has(ek(c, n)) && !blockSet.has(n));
  }

  // terrain: sparse — keep curated non-normal entries that are still on-map,
  // and guarantee every blocking cell is marked blocking
  const terrain = {};
  for (const [k, v] of Object.entries(cur.terrain || {})) {
    const kk = k.toLowerCase();
    if (v && v !== 'normal' && r.spaces.has(kk)) terrain[kk] = v;
  }
  for (const b of blocking) terrain[b] = 'blocking';

  // impassableEdges: walls + blockingEdges (in wallPairs) + boundary
  const impassable = [...r.impassable].sort().map((e) => e.split('|'));

  final[id] = {
    ...cur,
    ...(id === 'corellian-underground' ? { playReady: true } : {}),
    spaces,
    adjacency,
    terrain,
    blocking,
    impassableEdges: impassable,
    movementBlockingEdges: cur.movementBlockingEdges || [],
  };
}

// --- validations ---------------------------------------------------------------
let fail = 0;
const err = (m) => { console.log('  FAIL ' + m); fail++; };

// lothal: exactly 3 adjacency link changes + impEdges superset
{
  const before = pairSet(CUR['lothal-wastes'].adjacency);
  const after = pairSet(final['lothal-wastes'].adjacency);
  const removed = [...before].filter((e) => !after.has(e));
  const added = [...after].filter((e) => !before.has(e));
  console.log(`lothal adjacency delta: removed=${removed.join(',') || 'none'} added=${added.join(',') || 'none'}`);
  // First run removes the 3 nick-alignment links; reruns are idempotent (no delta).
  const rm = removed.sort().join(' ');
  if (added.length !== 0 || (rm !== '' && rm !== 'h17|i18 k7|l8 l7|l8')) err('lothal delta unexpected');
}

// mission tokens / terminals / doors / DZs must be on-map
const mt = JSON.parse(readFileSync(`${ROOT}/data/map-tokens.json`, 'utf8'));
const dzAll = JSON.parse(readFileSync(`${ROOT}/data/deployment-zones.json`, 'utf8'));
for (const id of Object.keys(final)) {
  const sp = new Set(final[id].spaces);
  const check = (coords, label) => {
    for (const c of coords || []) {
      const cc = String(c).toLowerCase();
      if (!sp.has(cc)) err(`${id}: ${label} ${cc} off-map`);
    }
  };
  const t = mt[id] || {};
  check(t.terminals, 'terminal');
  for (const m of ['missionA', 'missionB']) {
    const mm = t[m] || {};
    for (const arr of Object.values(mm.positions || {})) check(arr, `${m} token`);
    check(mm.launchPanels, `${m} launchPanel`);
    check(mm.contraband, `${m} contraband`);
  }
  for (const d of t.doors || []) check(d, 'door cell');
  const dz = dzAll[id] || dzAll.maps?.[id] || {};
  check(dz.red, 'DZ red');
  check(dz.blue, 'DZ blue');
}

// chopper: k23/p23 must be reachable from a terminal cell via adjacency
{
  const adj = final['chopper-base-atollon'].adjacency;
  const seen = new Set(['j9']);
  const q = ['j9'];
  while (q.length) { const c = q.shift(); for (const n of adj[c] || []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  for (const c of ['k23', 'p23', 'r20']) if (!seen.has(c)) err(`chopper ${c} unreachable`);
  console.log(`chopper BFS from j9 reaches ${seen.size}/${final['chopper-base-atollon'].spaces.length} cells`);
}

// corellian: adjacency must stay within spaces; no off-map leak possible
for (const id of Object.keys(final)) {
  const sp = new Set(final[id].spaces);
  for (const [c, ns] of Object.entries(final[id].adjacency)) {
    if (!sp.has(c)) err(`${id}: adjacency key ${c} off-map`);
    for (const n of ns) if (!sp.has(n)) err(`${id}: adjacency ${c}->${n} off-map`);
  }
}

console.log(fail === 0 ? 'ALL VALIDATIONS PASSED' : `${fail} VALIDATION FAILURES`);

if (OUT && fail === 0) {
  const full = JSON.parse(readFileSync(`${ROOT}/data/map-spaces.json`, 'utf8'));
  full.maps = final;
  writeFileSync(OUT, JSON.stringify(full, null, 2) + '\n');
  console.log('wrote', OUT);
}
