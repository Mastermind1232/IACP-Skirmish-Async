/**
 * Phase-D probe: difficult-terrain exit is free (no surcharge on leaving).
 *
 * PROBE-PD-DT-002: A figure does not need to spend additional movement
 *   points to exit a space containing difficult terrain. (CRR DIFFICULT TERRAIN)
 *
 * Implementation: src/game/movement.js evaluateMovementStep charges the
 * difficult +1 only on ENTRY (gated by `enteringDifficult`). There is no
 * corresponding `exitingDifficult` branch. This probe pins the asymmetry
 * directly: moving from a difficult-terrain origin onto a normal cell
 * costs the base 1 MP — the origin's terrain contributes zero.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

describe('PROBE-PD-DT-002: exiting difficult terrain costs no additional MP', () => {
  it('002a: moving from a difficult-origin cell to a normal cell costs exactly 1 MP', () => {
    const mapSpaces = { ...BASE_MAP, terrain: { a1: 'difficult' } };
    const board = buildTempBoardState(mapSpaces, [], null);
    const cache = computeMovementCache('a1', 10, board, BASE_PROFILE);
    const costToA2 = cache.cells.get('a2')?.cost;
    assert.equal(costToA2, 1,
      `exiting difficult must not add a surcharge; expected 1 got ${costToA2} — CRR-DT-002`);
  });

  it('002b: origin-terrain irrelevance — difficult-origin cost equals normal-origin cost', () => {
    const normalBoard = buildTempBoardState({ ...BASE_MAP, terrain: {} }, [], null);
    const diffOriginBoard = buildTempBoardState({ ...BASE_MAP, terrain: { a1: 'difficult' } }, [], null);
    const normalCost = computeMovementCache('a1', 10, normalBoard, BASE_PROFILE).cells.get('a2')?.cost;
    const diffOriginCost = computeMovementCache('a1', 10, diffOriginBoard, BASE_PROFILE).cells.get('a2')?.cost;
    assert.equal(diffOriginCost, normalCost,
      `difficult origin must not alter exit cost; got ${diffOriginCost} vs normal ${normalCost} — CRR-DT-002`);
  });

  it('002c: source pin — movement.js has no exitingDifficult branch (asymmetry is literal)', () => {
    const src = readFileSync(resolve(__dirname, '../../../src/game/movement.js'), 'utf8');
    // Entry branch exists...
    assert.match(src, /enteringDifficult/,
      'enteringDifficult branch must exist — CRR-DT-001/DT-002');
    // ...but no exit counterpart.
    assert.ok(!/exitingDifficult/.test(src),
      'no exitingDifficult branch must exist in movement.js — CRR-DT-002');
    assert.ok(!/leavingDifficult/.test(src),
      'no leavingDifficult branch must exist in movement.js — CRR-DT-002');
  });
});
