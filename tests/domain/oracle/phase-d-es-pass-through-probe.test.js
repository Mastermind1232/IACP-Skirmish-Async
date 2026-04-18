/**
 * Phase-D probe: energy shields are movement/adjacency/counting transparent.
 *
 * PROBE-PD-ES-002: An energy shield does not block movement, adjacency,
 *   or counting spaces. (CRR ENERGY SHIELD)
 *
 * Implementation: energy-shield tokens are stored exclusively in
 *   game.ancillaryTokens.energyShield (a label/LOS overlay), and movement.js
 *   never reads that field. Movement cost, adjacency, and space-counting
 *   all run off `mapSpaces.terrain` / `mapSpaces.adjacency` (+ rubble, via
 *   ancillaryTokens.rubble — the *only* ancillary channel movement reads).
 *   Therefore: a space flagged as an energy shield in game state cannot
 *   affect any movement-cost, adjacency, or distance computation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MV_SRC = readFileSync(resolve(__dirname, '../../../src/game/movement.js'), 'utf8');

const BASE_MAP = {
  spaces: ['a1', 'a2', 'a3'],
  adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] },
  terrain: {},
  blocking: [],
  movementBlockingEdges: [],
  impassableEdges: [],
};
const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1,
  isLarge: false, allowDiagonal: true, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

describe('PROBE-PD-ES-002: energy shield does not block movement/adjacency/counting', () => {
  it('002a: src/game/movement.js has no reference to energyShield (shield-blind movement)', () => {
    assert.ok(!/energyShield/.test(MV_SRC),
      'movement.js must not read energyShield — CRR-ES-002');
    assert.ok(!/ancillaryTokens\?\.\s*shield\b/.test(MV_SRC),
      'movement.js must not read ancillary shield tokens — CRR-ES-002');
  });

  it('002b: buildTempBoardState ignores game.ancillaryTokens.energyShield (only rubble is read)', () => {
    // The only ancillaryTokens channel movement reads is rubble (adds difficult).
    const ancillarySrc = MV_SRC.match(/game\.ancillaryTokens[\s\S]{0,200}/g) || [];
    for (const snippet of ancillarySrc) {
      assert.ok(!/shield/i.test(snippet),
        `movement.js ancillaryTokens read must not include shield: ${snippet.slice(0,80)} — CRR-ES-002`);
    }
  });

  it('002c: shield on a middle cell does not change movement cost (a1→a3 costs 2 either way)', () => {
    const mapSpaces = { ...BASE_MAP, terrain: {} };
    const board = buildTempBoardState(mapSpaces, [], null, {
      ancillaryTokens: { energyShield: ['a2'] },
    });
    const cache = computeMovementCache('a1', 10, board, BASE_PROFILE);
    assert.equal(cache.cells.get('a2')?.cost, 1,
      'shield cell must remain enterable at cost 1 — CRR-ES-002');
    assert.equal(cache.cells.get('a3')?.cost, 2,
      'shield-adjacent path must cost 2 (shield is movement-transparent) — CRR-ES-002');
  });

  it('002d: adjacency set is shield-blind (a2 remains a neighbor of a1/a3 with shield present)', () => {
    const board = buildTempBoardState(BASE_MAP, [], null, {
      ancillaryTokens: { energyShield: ['a2'] },
    });
    assert.ok(board.adjacency.a1.includes('a2'),
      'shield presence must not remove adjacency a1↔a2 — CRR-ES-002');
    assert.ok(board.adjacency.a2.includes('a3'),
      'shield presence must not remove adjacency a2↔a3 — CRR-ES-002');
  });
});
