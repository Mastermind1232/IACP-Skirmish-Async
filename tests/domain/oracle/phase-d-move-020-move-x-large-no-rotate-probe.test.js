/**
 * Phase-D probe: during a "Move X spaces" effect, a Large figure's
 * base may not rotate (its footprint orientation is locked for the
 * duration of the Move-X).
 *
 * PROBE-PD-MOVE-020: CRR MOVEMENT — "During a 'Move X spaces' effect,
 *   a Large figure's base cannot rotate."
 *
 * Architecture (post-2026-05-08 refactor):
 *   - Move-X effects flow through the dedicated picker in
 *     src/handlers/move-x-handler.js. The picker only emits cardinal
 *     translations (N/S/E/W) of the figure's footprint via
 *     shiftCoord(pos, dx, dy). It never offers a rotation candidate,
 *     so MOVE-020 is enforced by construction — there is no path
 *     through the picker that produces a rotated footprint.
 *   - The legacy moveXBypassActive flag and its read sites in
 *     handlers/movement.js are gone; the rotation gate that lived
 *     there has been replaced by the picker's translation-only
 *     candidate set.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MX_SRC = readFileSync(resolve(ROOT, 'src/handlers/move-x-handler.js'), 'utf8');

describe('PROBE-PD-MOVE-020: Large figures cannot rotate during "Move X spaces"', () => {
  it('020a: picker only emits cardinal translations (no rotation candidates)', () => {
    // The candidate-generator iterates a hard-coded direction list of
    // four cardinal vectors. Any rotation candidate would require an
    // additional source line introducing a rotated size, which the
    // picker module deliberately does not contain.
    assert.match(MX_SRC, /\{ dx: 0, dy: -1 \}, \/\/ N/);
    assert.match(MX_SRC, /\{ dx: 0, dy: 1 \},\s+\/\/ S/);
    assert.match(MX_SRC, /\{ dx: 1, dy: 0 \},\s+\/\/ E/);
    assert.match(MX_SRC, /\{ dx: -1, dy: 0 \}, \/\/ W/);
    assert.doesNotMatch(MX_SRC, /rotateSizeString\b/,
      'move-x picker must not invoke rotateSizeString — MOVE-020 forbids rotation during Move-X');
    assert.doesNotMatch(MX_SRC, /\bcanRotate\b/,
      'move-x picker must not consult canRotate — rotation is structurally absent from the candidate set');
  });

  it('020b: candidate footprints derive from the figure\'s current size only (no rotated variant)', () => {
    // getFootprintCells is called with the figure's saved size, never
    // a rotated one — so candidate footprints share orientation with
    // the current footprint.
    const calls = [...MX_SRC.matchAll(/getFootprintCells\([^)]+,\s*size\)/g)];
    assert.ok(calls.length >= 2,
      `expected the picker to call getFootprintCells with the unchanged size at least twice (old + new footprint); found ${calls.length} — MOVE-020`);
  });
});
