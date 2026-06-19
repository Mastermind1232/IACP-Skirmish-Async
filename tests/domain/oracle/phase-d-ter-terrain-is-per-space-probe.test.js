/**
 * Phase-D probe: terrain is a per-space attribute read directly from
 * map-authored data; the "fully-encompass" and "edge-only" rules
 * are map-authoring rules (applied at data-bake time), not
 * engine-runtime rules.
 *
 * PROBE-PD-TER-001: CRR TERRAIN — "If a group of spaces is fully
 *   encompassed by a single terrain border (or a combination of a
 *   single terrain border and walls), each of those spaces is
 *   considered to contain that terrain type."
 *
 * PROBE-PD-TER-002: CRR TERRAIN — "Colored borders (in combination
 *   with walls) that do not fully encompass a space or group of
 *   spaces are terrain edges — terrain rules are applied only to the
 *   colored edge of this space and not the space itself."
 *
 * Implementation: `data/map-spaces.json` bakes terrain as a per-space
 *   object `terrain: { <coord>: <type> }`. The engine reads this via
 *   `mapSpaces.terrain[coord]` in `src/game/movement.js` and
 *   `src/handlers/combat.js` (Hunker Down list). There is NO edge-
 *   terrain container anywhere in src/ (no terrainEdges,
 *   edgeTerrain, borderTerrain, colouredBorders). There is NO
 *   "encompass region" computation at runtime — encompass-based
 *   terrain assignment happens at map-authoring time and is baked
 *   into the per-space object. This two-rule pair is thus vacuously
 *   satisfied at runtime (the engine trusts the map data).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');
const HD_SRC = readFileSync(resolve(ROOT, 'src/game/hunker-down-helpers.js'), 'utf8');
// Hunker Down's runtime terrain read moved (2026-06-18) from the inline
// declaration block in combat.js to the reusable `near_terrain_type` condition
// primitive in combat-conditions.js (mods-window gate passive). The per-space
// terrain contract is unchanged — it reads mapSp.terrain[coord] per-space.
const CC_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-conditions.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-TER-001/002: terrain is per-space from map data; engine has no runtime encompass or edge-terrain concept', () => {
  it('001a: data — map-spaces.json bakes terrain as a per-space coord→type object (no encompass region, no edge list)', () => {
    const ms = JSON.parse(readFileSync(resolve(ROOT, 'data/map-spaces.json'), 'utf8'));
    const maps = ms.maps;
    assert.ok(maps && typeof maps === 'object', 'map-spaces.json must have maps block');
    for (const [mapId, m] of Object.entries(maps)) {
      assert.ok(m.terrain && typeof m.terrain === 'object',
        `${mapId} must have terrain object — CRR-TER-001`);
      // Every terrain value must be a simple string type (no edge-keyed objects or arrays).
      for (const [coord, type] of Object.entries(m.terrain)) {
        assert.equal(typeof type, 'string',
          `${mapId}.terrain[${coord}] must be a simple string type (per-space) — CRR-TER-002`);
      }
      // No sibling edge-terrain container should exist on the map.
      assert.ok(!('terrainEdges' in m), `${mapId} must not declare terrainEdges — CRR-TER-002`);
      assert.ok(!('edgeTerrain' in m), `${mapId} must not declare edgeTerrain — CRR-TER-002`);
      assert.ok(!('borderTerrain' in m), `${mapId} must not declare borderTerrain — CRR-TER-002`);
    }
  });

  it('001b: source — movement.js reads terrain per-space from mapSpaces.terrain (coord→type) and does no runtime encompass computation', () => {
    assert.match(MV_SRC,
      /for \(const \[coord, type\] of Object\.entries\(mapSpaces\.terrain \|\| \{\}\)\) \{\s*\n\s*terrain\[normalizeCoord\(coord\)\] = String\(type \|\| 'normal'\)\.toLowerCase\(\);/,
      'movement.js must build terrain as a per-space coord→type map — CRR-TER-001');
  });

  it('001c: source — Hunker Down terrain check reads terrain per-space (coord→type), never per-edge', () => {
    // The per-space contract is enforced in two places: the legacy
    // hunker-down-helpers.js (terrainMap[coord]) AND the live runtime read,
    // which now lives in the `near_terrain_type` condition primitive
    // (combat-conditions.js → mapSp.terrain[coord], geometric per-space).
    assert.match(HD_SRC,
      /terrainMap\?\.\[coord\] \|\| 'normal'/,
      'hunker-down-helpers.js must read terrain per-space via terrainMap[coord] — CRR-TER-001');
    // near_terrain_type reads `mapSp.terrain` and indexes it per-space (coord→type)
    // — never an edge container.
    assert.match(CC_SRC,
      /const terrain = mapSp\.terrain \|\| \{\};[\s\S]*terrain\[n\]/,
      'combat-conditions.js near_terrain_type must read terrain per-space (mapSp.terrain[coord]) — CRR-TER-001');
  });

  it('002a: source — no src file declares a runtime edge-terrain container (no edgeTerrain / terrainEdges / borderTerrain / coloredBorders)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/\bedgeTerrain\b|\bterrainEdges\b|\bborderTerrain\b|\bcoloredBorders\b|\bcolouredBorders\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a runtime edge-terrain container — CRR-TER-002');
  });

  it('002b: source — no src file declares a runtime encompass-region computation (no enclosedRegion / encompassRegion / encompassTerrain)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/\benclosedRegion\b|\bencompassRegion\b|\bencompassTerrain\b|\bcomputeEncompass\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a runtime encompass-region helper — CRR-TER-001 (rule is baked at data-authoring time)');
  });
});
