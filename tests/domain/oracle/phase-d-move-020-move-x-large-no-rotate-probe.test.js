/**
 * Phase-D probe: during a "Move X spaces" effect, a Large figure's
 * base may not rotate (its footprint orientation is locked for the
 * duration of the Move-X).
 *
 * PROBE-PD-MOVE-020: CRR MOVEMENT — "During a 'Move X spaces' effect,
 *   a Large figure's base cannot rotate."
 *
 * Implementation: the Move-X bypass flag introduced for MOVE-017
 *   (`game.moveXBypassActive[msgId]`) is read at each handleMovePick
 *   profile-setup site; when set AND the mover is Large, the profile's
 *   `canRotate` is forced to false. `getNeighborStates` in
 *   `src/game/movement.js` only emits a `{ type: 'rotate' }` neighbor
 *   when `profile.canRotate` is truthy, so the rotation step cannot be
 *   planned or committed for the duration of the Move-X.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');
const MVG_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-MOVE-020: Large figures cannot rotate during "Move X spaces"', () => {
  it('020a: source — every moveXBypassActive profile-setup branch forces canRotate = false for Large', () => {
    const branches = [...MV_SRC.matchAll(
      /if \(game\.moveXBypassActive\?\.\[msgId\]\) \{\s*\n\s*\w+\.ignoreFigureCost = true;\s*\n\s*\w+\.ignoreDifficult = true;\s*\n\s*if \(\w+\.isLarge\) \w+\.canRotate = false;\s*\n\s*\}/g,
    )];
    assert.ok(branches.length >= 3,
      `expected at least 3 movement.js profile sites to force canRotate=false for Large during Move-X; found ${branches.length} — CRR-MOVE-020`);
  });

  it('020b: source — getNeighborStates only emits rotate-neighbor when profile.canRotate is set (so the false override actually suppresses rotation)', () => {
    assert.match(MVG_SRC,
      /if \(profile\.canRotate\) \{\s*\n\s*const rotatedSize = rotateSizeString\(state\.size\);\s*\n\s*neighbors\.push\(\{ type: 'rotate',/,
      'getNeighborStates must gate rotation behind profile.canRotate — CRR-MOVE-020');
  });
});
