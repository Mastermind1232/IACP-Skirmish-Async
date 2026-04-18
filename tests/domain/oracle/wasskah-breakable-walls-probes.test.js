/**
 * Tier 3 Legality-Oracle Probes: Wasskah Hunting Ground Breakable Walls (A2)
 *
 * Heat-map row (A2 "Wasskah breakable walls in LOS"): on the Wasskah
 * Hunting Ground map, blue-line walls between two difficult-terrain spaces
 * do not block movement, adjacency, LOS, or counting spaces. The shared
 * helper `getBrokenWallEdges(game, mapSpaces)` in src/game/movement.js is
 * the single source of truth; both the handler (dc-play-area.js:955-960)
 * and the engine (available-actions.js effectiveMs construction) filter
 * this Set out of impassableEdges before LOS checks.
 *
 * Before these probes the row was inferred_only — the helper itself had
 * unit coverage elsewhere, but no probe pinned the fact that BOTH the
 * handler and the engine call it at the effectiveMs construction site.
 * Without that pin, a refactor that removes the engine-side merge would
 * silently re-open an engine/handler drift lane.
 *
 * Note on scenario-level coverage: Wasskah Hunting Ground has no entry in
 * data/map-spaces.json, so an end-to-end parity scenario (like the Smoke
 * scenario at _crr-baselines.js #17) is not currently constructible. These
 * pure-function probes are the tightest regression proof available until
 * the map data lands.
 *
 * PROBE-WASS-001: Helper gate — non-Wasskah maps yield empty Set
 * PROBE-WASS-002: Helper activates only when both endpoints are difficult
 * PROBE-WASS-003: Rubble tokens (ancillaryTokens.rubble) count as difficult
 * PROBE-WASS-004: Handler source pin — dc-play-area.js still imports and
 *   calls getBrokenWallEdges at the effectiveMs construction site
 * PROBE-WASS-005: Engine source pin — available-actions.js still imports
 *   and calls getBrokenWallEdges at the effectiveMs construction site
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBrokenWallEdges } from '../../../src/game/movement.js';
import { edgeKey } from '../../../src/game/coords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Wasskah Breakable Walls Oracle Probes', () => {
  describe('PROBE-WASS-001: helper gate', () => {
    it('returns empty Set for non-Wasskah maps', () => {
      const game = { selectedMap: { id: 'mos-eisley-outskirts' } };
      const ms = { terrain: { e8: 'difficult', e9: 'difficult' } };
      const broken = getBrokenWallEdges(game, ms);
      assert.equal(broken.size, 0);
    });
    it('returns empty Set when game has no selectedMap', () => {
      assert.equal(getBrokenWallEdges({}, {}).size, 0);
    });
  });

  describe('PROBE-WASS-002: activates only when both endpoints are difficult', () => {
    it('both endpoints difficult → wall is broken', () => {
      const game = { selectedMap: { id: 'wasskah-hunting-ground' } };
      const ms = { terrain: { e8: 'difficult', e9: 'difficult' } };
      const broken = getBrokenWallEdges(game, ms);
      assert.ok(broken.has(edgeKey('e8', 'e9')), 'e8|e9 should be broken');
      assert.equal(broken.size, 1);
    });
    it('only one endpoint difficult → wall stays', () => {
      const game = { selectedMap: { id: 'wasskah-hunting-ground' } };
      const ms = { terrain: { e8: 'difficult' } };
      const broken = getBrokenWallEdges(game, ms);
      assert.equal(broken.size, 0);
    });
    it('neither endpoint difficult → wall stays', () => {
      const game = { selectedMap: { id: 'wasskah-hunting-ground' } };
      const ms = { terrain: {} };
      const broken = getBrokenWallEdges(game, ms);
      assert.equal(broken.size, 0);
    });
  });

  describe('PROBE-WASS-003: rubble tokens count as difficult', () => {
    it('ancillaryTokens.rubble at both endpoints breaks the wall', () => {
      const game = {
        selectedMap: { id: 'wasskah-hunting-ground' },
        ancillaryTokens: { rubble: ['f6', 'g6'] },
      };
      const ms = { terrain: {} };
      const broken = getBrokenWallEdges(game, ms);
      assert.ok(broken.has(edgeKey('f6', 'g6')), 'f6|g6 should be broken via rubble');
    });
    it('game.rubbleTokens at both endpoints breaks the wall', () => {
      const game = {
        selectedMap: { id: 'wasskah-hunting-ground' },
        rubbleTokens: ['h9', 'h10'],
      };
      const ms = { terrain: {} };
      const broken = getBrokenWallEdges(game, ms);
      assert.ok(broken.has(edgeKey('h9', 'h10')), 'h9|h10 should be broken via rubbleTokens');
    });
  });

  describe('PROBE-WASS-004: handler source pin', () => {
    it('dc-play-area.js imports and calls getBrokenWallEdges at effectiveMs site', () => {
      const src = readFileSync(resolve(__dirname, '../../../src/handlers/dc-play-area.js'), 'utf8');
      assert.ok(src.includes('getBrokenWallEdges'), 'handler must reference getBrokenWallEdges');
      assert.ok(
        /const\s+brokenWalls\s*=\s*getBrokenWallEdges\(/.test(src),
        'handler must call getBrokenWallEdges to build the brokenWalls Set'
      );
    });
  });

  describe('PROBE-WASS-005: engine source pin', () => {
    it('available-actions.js imports and calls getBrokenWallEdges at effectiveMs site', () => {
      const src = readFileSync(resolve(__dirname, '../../../src/engine/available-actions.js'), 'utf8');
      assert.ok(src.includes('getBrokenWallEdges'), 'engine must reference getBrokenWallEdges');
      assert.ok(
        /_aaBrokenWalls\s*=\s*getBrokenWallEdges\(/.test(src),
        'engine must call getBrokenWallEdges to build the _aaBrokenWalls Set'
      );
    });
  });
});
