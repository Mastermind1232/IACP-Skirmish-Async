/**
 * Phase-D probe: the skirmish engine has no "impassable terrain"
 * category; the CRR-CS-002 exception (impassable terrain traversable
 * for counting-spaces) is vacuously satisfied.
 *
 * PROBE-PD-CS-002: CRR COUNTING SPACES — "Impassable terrain can be
 *   moved into and through for counting-spaces measurement (even
 *   though figures cannot actually enter)."
 *
 * Implementation: the rulebook distinguishes "impassable terrain"
 *   (blocks movement but not LOS or counting) from "blocking terrain"
 *   (blocks movement, LOS, and counting). This engine models only:
 *     - `blocking`: an array of space coords excluded from adjacency
 *     - `terrain[coord]`: a per-space string type — only 'normal' and
 *       'difficult' values are used in `src/` (never 'impassable')
 *     - `impassableEdges`: an edge-list, i.e. walls (not terrain)
 *   There is no `impassableTerrain` / `impassableSpaces` field on
 *   mapSpaces, no `terrain[c] === 'impassable'` branch anywhere in
 *   `src/game/` or `src/engine/`, and no map-data JSON encodes an
 *   impassable-terrain category. Because the rule's premise (a
 *   terrain type that blocks movement but allows counting) has no
 *   engine substrate, CRR-CS-002 is vacuously satisfied. CRR-CS-003
 *   (counting cannot pass through walls/doors/blocking) pins the
 *   positive counterpart that IS implemented.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SP_SRC = readFileSync(resolve(ROOT, 'src/game/spatial.js'), 'utf8');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-CS-002: no impassable-terrain category exists in the engine; rule vacuously satisfied', () => {
  it('002a: source — countSpaces BFS operates on mapSpaces.adjacency and an optional blockedEdges set; does not filter by terrain type', () => {
    // 2026-07-09: impassable terrain IS implemented now (cells + edges). The
    // CRR-CS-002 rule stands — counting passes through impassable — because
    // impassable never filters the BFS: impassable EDGES stay in adjacency,
    // and the optional extraAdj overlay only ADDS links (occupied-blocking /
    // Spire); countSpaces still never consults terrain type.
    assert.match(SP_SRC,
      /export function countSpaces\(mapSpaces, coordA, coordB, blockedEdges = null, maxDist = 50, extraAdj = null\)/,
      'countSpaces signature must include blockedEdges (doors) — CRR-CS-002');
    // The BFS body must not filter by terrain type — no terrain[...] check inside countSpaces
    const csBody = SP_SRC.match(/export function countSpaces[\s\S]*?\n\}/)[0];
    assert.doesNotMatch(csBody, /terrain\[/,
      'countSpaces must not consult terrain[] — counting does not care about terrain type — CRR-CS-002');
    assert.doesNotMatch(csBody, /impassable/i,
      'countSpaces must not reference any impassable-terrain concept — CRR-CS-002');
  });

  it('002b: source — the only terrain-type values assigned anywhere in src/game/movement.js are normal/difficult; never impassable', () => {
    const terrainAssigns = MV_SRC.match(/terrain\[[^\]]+\]\s*=\s*['"`][a-z]+['"`]/gi) || [];
    const terrainCoalesce = MV_SRC.match(/terrain\[[^\]]+\]\s*=\s*String\([^)]*\)\.toLowerCase\(\)/g) || [];
    assert.ok(terrainAssigns.length + terrainCoalesce.length >= 2,
      'movement.js must have terrain-type assignment sites — CRR-CS-002');
    // No literal 'impassable' may be assigned as a terrain type anywhere in src/game/
    assert.doesNotMatch(MV_SRC, /terrain\[[^\]]+\]\s*=\s*['"`]impassable['"`]/i,
      'no code may assign "impassable" as a terrain type — CRR-CS-002');
  });

  it('002c: source — no src/ file references an `impassableTerrain` / `impassableSpaces` container field (only `impassableEdges` exists, which is walls)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/impassableTerrain|impassableSpaces/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare impassableTerrain or impassableSpaces — only edge-level impassableEdges exists — CRR-CS-002');
  });

  it('002d: source — no `terrain === "impassable"` or `=== \'impassable\'` branch exists anywhere in src/', () => {
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      assert.doesNotMatch(src,
        /terrain\[[^\]]+\]\s*===?\s*['"`]impassable['"`]|terrain\s*===?\s*['"`]impassable['"`]/i,
        `${p.replace(ROOT + '/', '')} must not branch on terrain === 'impassable' — CRR-CS-002`);
    }
  });

  it('002e: data — no file under data/ encodes a terrain entry with value "impassable" (the only Hunker-Down-list branch that would consult such a value is therefore dormant)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'data'))) {
      const src = readFileSync(p, 'utf8');
      if (/"terrain"\s*:\s*"impassable"|"impassable"\s*:\s*\[/i.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no map-data file may encode terrain: "impassable" — CRR-CS-002 (no engine substrate for the rule)');
  });

  it('002f: cross-ref — CRR-CS-003 (counting blocked by walls/doors/blocking) pins the positive counterpart; this probe pins the vacuous impassable-terrain exception', () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, 'docs/crr-ledger.json'), 'utf8'));
    const cs003 = ledger.atoms.find(a => a.id === 'CRR-CS-003');
    assert.ok(cs003, 'CRR-CS-003 must exist in the ledger');
    assert.ok(['covered', 'covered_by_ref'].includes(cs003.status),
      'CRR-CS-003 must be pinned (positive counterpart) — CRR-CS-002 context');
  });
});
