/**
 * Phase-D probes: push-direction / push-cost invariants.
 *
 * PROBE-PD-PSH-002: A pushed figure can move in any direction; it does NOT
 *   need to move directly away from the pusher. (CRR PUSH)
 *   The canonical write helper `pushFigure` in src/game/player-helpers.js
 *   takes (game, playerNum, figureKey, newSpace) — the pusher's position is
 *   not an argument, so the helper cannot enforce any directional constraint
 *   relative to the pusher. Callers pick the destination directly.
 *
 * PROBE-PD-PSH-004: Pushing a figure requires no movement points and ignores
 *   additional movement costs. (CRR PUSH)
 *   `pushFigure` mutates only `game.figurePositions[playerNum][figureKey]`;
 *   it never reads or writes `movementBank` or `mpRemaining`, so push cannot
 *   consume MP or be blocked by MP exhaustion. Terrain-cost additions
 *   (difficult-terrain, adjacency-cost) also live in the MP spender, not the
 *   push write-path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushFigure } from '../../../src/game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const PH_SRC = readFileSync(join(ROOT, 'src/game/player-helpers.js'), 'utf8');

describe('PROBE-PD-PSH-002: pushed figure can move in any direction (no pusher-position constraint)', () => {
  it('002a: pushFigure signature takes no pusher position, so direction cannot be enforced', () => {
    // Exact signature pin — if the canonical helper ever grows a pusher-pos
    // argument, this probe must be revisited (see CRR-PSH-002).
    const sigIdx = PH_SRC.indexOf('export function pushFigure(game, playerNum, figureKey, newSpace)');
    assert.ok(sigIdx > 0,
      'pushFigure signature (game, playerNum, figureKey, newSpace) must hold — CRR-PSH-002');
  });

  it('002b: pushFigure body contains no direction/angle/vector math vs a pusher', () => {
    const fnIdx = PH_SRC.indexOf('export function pushFigure');
    const close = PH_SRC.indexOf('\n}\n', fnIdx);
    const body = PH_SRC.slice(fnIdx, close);
    // No references to a "pusher" source, no Math trig, no direction arithmetic.
    assert.ok(!/pusher/i.test(body), 'pushFigure must not reference a pusher — CRR-PSH-002');
    assert.ok(!/Math\.(atan|sign|abs)/.test(body),
      'pushFigure must not compute direction vectors — CRR-PSH-002');
  });

  it('002c: pushFigure accepts an arbitrary destination (any-direction round-trip)', () => {
    const game = { figurePositions: { 1: { 'Unit-1-0': 'a1' } } };
    // "Any direction" including a non-adjacent space (caller's responsibility).
    const r = pushFigure(game, 1, 'Unit-1-0', 'z9');
    assert.deepEqual(r, { prevPos: 'a1', newPos: 'z9' },
      'push destination must be whatever the caller provided — CRR-PSH-002');
  });
});

describe('PROBE-PD-PSH-004: pushing ignores movement points', () => {
  it('004a: pushFigure source never touches movementBank or mpRemaining', () => {
    const fnIdx = PH_SRC.indexOf('export function pushFigure');
    const close = PH_SRC.indexOf('\n}\n', fnIdx);
    const body = PH_SRC.slice(fnIdx, close);
    assert.ok(!body.includes('movementBank'),
      'pushFigure must not read/write movementBank — CRR-PSH-004');
    assert.ok(!body.includes('mpRemaining'),
      'pushFigure must not read/write mpRemaining — CRR-PSH-004');
  });

  it('004b: pushing a figure with zero MP still succeeds', () => {
    // Caller has no MP bank at all; push still writes the new position.
    const game = { figurePositions: { 2: { 'Stormtrooper-2-0': 'b2' } } };
    const r = pushFigure(game, 2, 'Stormtrooper-2-0', 'c3');
    assert.equal(r.newPos, 'c3',
      'push must succeed regardless of MP state — CRR-PSH-004');
  });
});
