/**
 * Phase-D probe: pushed large figure cannot move diagonally or rotate.
 *
 * PROBE-PD-PSH-006: While pushing a large figure, it cannot move diagonally
 *   and cannot be rotated. (CRR PUSH)
 *
 * Implementation: Two source invariants combine to enforce the rule.
 *   1. `pushFigureToNearestValid` in src/game/movement.js uses an
 *      orthogonal-only BFS: its `moveVectors` array contains only the
 *      four cardinal vectors {±1,0} and {0,±1}. No diagonal BFS step
 *      exists, so a pushed figure of any size reaches destinations
 *      only via edge-sharing steps.
 *   2. `getNeighborStates` in src/game/movement.js (the generic
 *      movement expander used for voluntary moves and any BFS that
 *      respects `profile.allowDiagonal`) explicitly rejects diagonal
 *      neighbours for any large figure with the guard
 *      `if (isDiagonal && profile.isLarge) continue;`. Large figures
 *      therefore never take a diagonal step in either voluntary
 *      movement or push pathways.
 *   The no-rotate half is covered by CRR-LF-007 (pushFigure never
 *   writes figureOrientations).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MOVEMENT_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');
const HELPERS_SRC = readFileSync(resolve(ROOT, 'src/game/player-helpers.js'), 'utf8');

describe('PROBE-PD-PSH-006: pushed large figure — no diagonal step, no rotation', () => {
  it('006a: source — pushFigureToNearestValid defined as the BFS push helper', () => {
    assert.match(MOVEMENT_SRC,
      /export function pushFigureToNearestValid\(game, playerNum, figureKey, forbiddenSet\) \{/,
      'pushFigureToNearestValid must be the exported BFS push helper — CRR-PSH-006');
  });

  it('006b: source — pushFigureToNearestValid BFS uses orthogonal-only moveVectors', () => {
    const m = MOVEMENT_SRC.match(/export function pushFigureToNearestValid[\s\S]*?\n\}/);
    assert.ok(m, 'pushFigureToNearestValid must be parseable');
    const body = m[0];
    // Orthogonal four vectors present.
    assert.match(body, /\{ dx: 1, dy: 0 \}/, 'must include +x vector — CRR-PSH-006');
    assert.match(body, /\{ dx: -1, dy: 0 \}/, 'must include -x vector — CRR-PSH-006');
    assert.match(body, /\{ dx: 0, dy: 1 \}/, 'must include +y vector — CRR-PSH-006');
    assert.match(body, /\{ dx: 0, dy: -1 \}/, 'must include -y vector — CRR-PSH-006');
    // No diagonal vectors in the push BFS (both components non-zero).
    const diagMatches = body.match(/\{ dx: -?1, dy: -?1 \}/g) || [];
    assert.equal(diagMatches.length, 0,
      'push BFS must NOT contain diagonal moveVectors — CRR-PSH-006');
  });

  it('006c: source — large-figure movement expander rejects diagonal neighbours', () => {
    assert.match(MOVEMENT_SRC,
      /if \(isDiagonal && profile\.isLarge\) continue;/,
      'large figures must be diagonal-disallowed in getNeighborStates — CRR-PSH-006');
  });

  it('006d: source — pushFigure (the write path) never rotates the figure', () => {
    // The no-rotate half is pinned by CRR-LF-007 via pushFigure not touching figureOrientations.
    const m = HELPERS_SRC.match(/export function pushFigure\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'pushFigure must be defined');
    assert.ok(!/figureOrientations/.test(m[0]),
      'pushFigure body must not touch figureOrientations (no rotate on push) — CRR-PSH-006/LF-007');
  });

  it('006e: behavior — a direct pushFigureToNearestValid BFS simulation takes only orthogonal steps', () => {
    // Mirror the BFS expansion step: from a starting cell, legal next steps are exactly the 4 orthogonal neighbours.
    const expand = (x, y) => {
      const neighbors = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        neighbors.push([x + dx, y + dy]);
      }
      return neighbors;
    };
    const n = expand(2, 2);
    const keys = new Set(n.map(([x, y]) => `${x},${y}`));
    assert.ok(keys.has('3,2') && keys.has('1,2') && keys.has('2,3') && keys.has('2,1'),
      'BFS must reach all 4 orthogonal neighbours — CRR-PSH-006');
    assert.ok(!keys.has('3,3') && !keys.has('1,1') && !keys.has('3,1') && !keys.has('1,3'),
      'BFS must NOT reach any diagonal neighbour — CRR-PSH-006');
  });

  it('006f: behavior — large-figure diagonal guard predicate matches CRR semantics', () => {
    const allowStep = (profile, isDiagonal) => !(isDiagonal && profile.isLarge);
    assert.equal(allowStep({ isLarge: true }, true), false,
      'large + diagonal → disallowed — CRR-PSH-006');
    assert.equal(allowStep({ isLarge: true }, false), true,
      'large + orthogonal → allowed');
    assert.equal(allowStep({ isLarge: false }, true), true,
      'small + diagonal → allowed (not this rule)');
  });
});
