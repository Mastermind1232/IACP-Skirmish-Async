/**
 * Phase-D probe: rotation rules during Move-X vs Push.
 *
 * PROBE-PD-MOVE-020 (revised 2026-05-08): Earlier read of the rule
 * was wrong. CRR MOVEMENT actually says:
 *   - During a "Move X spaces" effect, Large/Massive figures CAN
 *     rotate (rotation costs 1 space, prompts the player for the
 *     pivot cell).
 *   - During a Push, Large/Massive figures CANNOT rotate.
 *
 * Architecture (post-2026-05-08 refactor):
 *   - The Move-X picker (src/handlers/move-x-handler.js) emits
 *     rotation candidates for non-1x1 figures, keyed by (pivotCell,
 *     direction). Each candidate keeps the chosen pivot cell at its
 *     current world coordinate while rotating the rest of the
 *     footprint 90° around it. The handleMoveXRotate handler applies
 *     the rotation and decrements remaining by 1.
 *   - The Push flow (src/handlers/movement.js handleMassivePushSpace
 *     and friends) directly translates the displaced figure to a
 *     chosen space — no rotation candidates are emitted, so MOVE-020
 *     is enforced for Push by construction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MX_SRC = readFileSync(resolve(ROOT, 'src/handlers/move-x-handler.js'), 'utf8');
const MV_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');

describe('PROBE-PD-MOVE-020: rotation rules — Move-X allows, Push forbids', () => {
  it('020a: Move-X picker emits rotation candidates for Large/Massive figures', () => {
    // Large detection (size has any axis > 1) gates the rotation
    // candidate loop.
    assert.match(MX_SRC, /const isLarge = String\(size\)\.split\('x'\)\.some\(n => Number\(n\) > 1\);/,
      'Move-X picker must detect Large figures via the size string');
    // Per-pivot rotation enumeration.
    assert.match(MX_SRC, /for \(const pivotCell of oldCells\)/,
      'Move-X picker must iterate over each cell of the current footprint as a pivot candidate — MOVE-020');
    // CW + CCW directions for each pivot.
    assert.match(MX_SRC, /for \(const direction of \['CW', 'CCW'\]\)/,
      'Move-X picker must enumerate both CW and CCW rotation per pivot — MOVE-020');
    // Rotated candidates carry kind: 'rotate' so the picker render
    // path can distinguish them from translations.
    assert.match(MX_SRC, /kind:\s*'rotate'/,
      'rotation candidates must be marked with kind: "rotate" — MOVE-020');
  });

  it('020b: handleMoveXRotate applies rotation and decrements remaining', () => {
    assert.match(MX_SRC, /export async function handleMoveXRotate\(interaction, ctx\)/,
      'move-x-handler must export handleMoveXRotate');
    assert.match(MX_SRC, /game\.figureOrientations\[pending\.figureKey\] = match\.rotatedSize;/,
      'rotation must update figureOrientations to the rotated size — MOVE-020');
    assert.match(MX_SRC, /pending\.remaining\s*=\s*Math\.max\(0,\s*pending\.remaining\s*-\s*cost\);/,
      'rotation must decrement remaining by the step cost — MOVE-020');
  });

  it('020c: Push flow does NOT emit rotation candidates (rotation forbidden during Push)', () => {
    // The push handlers translate-only — there is no rotate button
    // generator in the push code path.
    assert.doesNotMatch(MV_SRC, /massive_push_rotate_/,
      'push flow must not register a rotate button — MOVE-020');
    assert.doesNotMatch(MV_SRC, /rotateSizeString\(/,
      'push flow must not invoke rotateSizeString — MOVE-020');
  });
});
