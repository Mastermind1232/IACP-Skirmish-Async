/**
 * Phase-D probe: when multiple figures under one player's control
 * must resolve simultaneous effects, the player picks the order.
 *
 * PROBE-PD-CNF-004: CRR CONFLICTS — "Effects from multiple figures
 *   under the control of a single player are resolved in the order
 *   of that player's choice."
 *
 * Implementation: the Massive-push displacement engine in
 *   `src/game/movement.js` is the canonical site where multiple
 *   friendly figures can simultaneously need to resolve a push.
 *   `resolveNextDisplacements` returns `needsFigurePick` with the
 *   full queue of pickable entries; the controller (friendly phase:
 *   the moving player; enemy phase: the pushed figure's owner)
 *   chooses which figure to displace next via `applyFigurePick`,
 *   which swaps the chosen entry into the current slot without
 *   advancing the index — the caller then asks that figure for its
 *   destination space. This is exactly CNF-004 semantics.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-CNF-004: multi-figure player-choice order via Massive-push controller-picks-order', () => {
  it('004a: source — resolveNextDisplacements returns needsFigurePick when >=2 unresolved entries need the controller to pick order', () => {
    assert.match(MV_SRC,
      /const unresolvedCount = queue\.length - pending\.currentIndex;[\s\S]*?if \(unresolvedCount >= 2 && !orderLocked\) \{[\s\S]*?needsFigurePick: \{ pickable, controllerPlayerNum \},/,
      'resolveNextDisplacements must hand off figure-pick to the controller when >=2 figures remain — CRR-CNF-004');
  });

  it('004b: source — controllerPlayerNum is the moving player in the friendly phase and the pushed figure\'s owner in the enemy phase (each player chooses for their own figures)', () => {
    assert.match(MV_SRC,
      /const controllerPlayerNum = pending\.phase === 'friendly'\s*\n\s*\? pending\.movingPlayerNum\s*\n\s*: entry\.playerNum;/,
      'controllerPlayerNum must be derived from phase (friendly → mover, enemy → owner) — CRR-CNF-004');
  });

  it('004c: source — applyFigurePick swaps the chosen entry into the current slot without advancing currentIndex (lock order; caller then picks space)', () => {
    assert.match(MV_SRC,
      /export function applyFigurePick\(pending, figureKey\) \{[\s\S]*?queue\[pending\.currentIndex\] = queue\[targetIdx\];[\s\S]*?queue\[targetIdx\] = tmp;[\s\S]*?pending\._figurePickLockedIdx = pending\.currentIndex;/,
      'applyFigurePick must swap chosen entry to currentIndex and lock order — CRR-CNF-004');
  });
});
