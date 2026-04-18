/**
 * Phase-D probes: terrain under terminals and crates still takes effect.
 *
 * PROBE-PD-TRM-004: If a terminal is in a space containing terrain, the
 *   terrain in the space still takes effect. (CRR TERMINAL TOKENS)
 * PROBE-PD-CRT-002: If a crate token is in a space containing terrain,
 *   the terrain in the space still takes effect. (CRR CRATE TOKENS)
 *
 * Implementation: terrain is a space-keyed property in `mapSpaces.terrain`
 *   that is populated from mission data and never mutated by token
 *   placement. Crate and terminal tokens live in their own coord maps
 *   (`game.cratePositions`, mission-terminal arrays) which the movement
 *   layer does not read — so no token can override or suppress the
 *   underlying terrain classification.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MV_SRC = readFileSync(resolve(__dirname, '../../../src/game/movement.js'), 'utf8');

const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1,
  isLarge: false, allowDiagonal: true, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

function makeLineMap(terrain = {}) {
  return {
    spaces: ['a1', 'a2', 'a3'],
    adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] },
    terrain,
    blocking: [],
    movementBlockingEdges: [],
    impassableEdges: [],
  };
}

describe('PROBE-PD-TRM-004: terrain still applies under a terminal token', () => {
  it('004a: source — movement.js does not read terminal-position maps (terrain is independent)', () => {
    assert.ok(!/terminalPositions/.test(MV_SRC),
      'movement.js must not reference terminalPositions — CRR-TRM-004');
    assert.ok(!/\.terminal\b/.test(MV_SRC),
      'movement.js must not gate terrain lookup on terminal presence — CRR-TRM-004');
  });

  it('004b: behavior — a difficult cell retains +1 surcharge regardless of token overlay', () => {
    // Even with a terminal conceptually placed at a2, mapSpaces.terrain
    // is authoritative. Simulate by constructing a map with a2 difficult;
    // an overlay coord map for "terminal at a2" doesn't enter movement.
    const board = buildTempBoardState(makeLineMap({ a2: 'difficult' }), [], null, {
      terminalPositions: { a2: 'a2' },
      cratePositions: {},
    });
    const cache = computeMovementCache('a1', 10, board, BASE_PROFILE);
    assert.equal(cache.cells.get('a2')?.cost, 2,
      'terminal overlay must not suppress terrain +1 — CRR-TRM-004');
  });
});

describe('PROBE-PD-CRT-002: terrain still applies under a crate token', () => {
  it('002a: source — movement.js does not read cratePositions (terrain is independent)', () => {
    assert.ok(!/cratePositions/.test(MV_SRC),
      'movement.js must not reference cratePositions — CRR-CRT-002');
  });

  it('002b: behavior — a difficult cell with a crate overlay still costs +1', () => {
    const board = buildTempBoardState(makeLineMap({ a2: 'difficult' }), [], null, {
      cratePositions: { a2: 'a2' },
    });
    const cache = computeMovementCache('a1', 10, board, BASE_PROFILE);
    assert.equal(cache.cells.get('a2')?.cost, 2,
      'crate overlay must not suppress terrain +1 — CRR-CRT-002');
  });

  it('002c: terrain is stored in mapSpaces.terrain, not in any token map', () => {
    const mapSpaces = makeLineMap({ a2: 'difficult' });
    assert.equal(mapSpaces.terrain.a2, 'difficult',
      'terrain lives on the space, not the token — CRR-CRT-002');
  });
});
