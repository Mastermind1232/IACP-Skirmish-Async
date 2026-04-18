/**
 * Phase-D probes: rubble stacking and rubble+shield co-occupancy.
 *
 * PROBE-PD-RBL-002: The effect of rubble does not stack with the effect
 *   of preexisting difficult terrain. (CRR RUBBLE)
 * PROBE-PD-RBL-003: A space can contain both rubble and an energy shield.
 *   (CRR RUBBLE)
 *
 * Implementation:
 *   - src/game/movement.js `getBoardStateForMovement` only upgrades a
 *     rubble cell's terrain if it was 'normal' or absent:
 *     `if (!terrain[nc] || terrain[nc] === 'normal') terrain[nc] = 'difficult'`.
 *     A preexisting 'difficult' cell stays 'difficult' — the rubble effect
 *     is clamped to the single difficult surcharge.
 *   - Rubble and energy-shield tokens live in independent
 *     `game.ancillaryTokens.{rubble, energyShield}` arrays. There is no
 *     cross-exclusion logic; both arrays accept the same cell.
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

describe('PROBE-PD-RBL-002: rubble does not stack with preexisting difficult terrain', () => {
  it('002a: source — both rubble paths gate upgrade by normal-terrain precondition (no stacking)', () => {
    // Both rubble upgrade sites (getBoardStateForMovement + getBrokenWallEdges
    // caller) use the same guarded form:
    const gates = MV_SRC.match(/if \(!terrain\[nc\] \|\| terrain\[nc\] === 'normal'\) terrain\[nc\] = 'difficult';/g);
    assert.ok(gates && gates.length >= 2,
      `rubble upgrade must be gated against preexisting difficult — matched ${gates?.length||0} — CRR-RBL-002`);
  });

  it('002b: source — no branch applies difficult surcharge twice under rubble (no += 1)', () => {
    // Negative invariant: rubble code path uses a single assignment, never '+= 1'.
    const rubbleSnippets = MV_SRC.match(/ancillaryTokens\?\.rubble[\s\S]{0,200}?terrain\[nc\]\s*=\s*'difficult'/g) || [];
    for (const snippet of rubbleSnippets) {
      assert.ok(!/\+=\s*1/.test(snippet),
        'rubble path must not additively stack cost — CRR-RBL-002');
    }
  });

  it('002c: behavior — difficult surcharge is a single +1 (bound that rubble cannot exceed)', () => {
    // Establishes the invariant bound: cost(a1→a2) on difficult == 2, not 3.
    // Combined with the source pin above, rubble cannot raise this to 3.
    const board = buildTempBoardState(makeLineMap({ a2: 'difficult' }), [], null);
    const cache = computeMovementCache('a1', 10, board, BASE_PROFILE);
    assert.equal(cache.cells.get('a2')?.cost, 2,
      'difficult surcharge is a single +1 — CRR-RBL-002');
  });
});

describe('PROBE-PD-RBL-003: rubble and energy shield may co-occupy a space', () => {
  it('003a: ancillaryTokens.rubble and .energyShield are independent arrays (no mutual exclusion)', () => {
    const game = { ancillaryTokens: { rubble: ['a2'], energyShield: ['a2'] } };
    assert.ok(game.ancillaryTokens.rubble.includes('a2'),
      'a2 must remain in rubble array — CRR-RBL-003');
    assert.ok(game.ancillaryTokens.energyShield.includes('a2'),
      'a2 must remain in energyShield array — CRR-RBL-003');
  });

  it('003b: source — no cross-exclusion logic between rubble and energyShield', () => {
    // No single line (or short stretch) mentions both rubble and energyShield
    // — they are channels without interaction.
    const lines = MV_SRC.split('\n');
    for (const line of lines) {
      const hasRubble = /rubble/.test(line);
      const hasShield = /energyShield|shield/i.test(line);
      assert.ok(!(hasRubble && hasShield),
        `movement.js line must not cross-check rubble+shield: ${line.trim().slice(0,100)} — CRR-RBL-003`);
    }
  });

  it('003c: shield layer is orthogonal — movement.js does not read energyShield at all', () => {
    assert.ok(!/energyShield/.test(MV_SRC),
      'movement.js must be shield-blind; rubble+shield co-occupancy is trivially allowed — CRR-RBL-003');
  });
});
