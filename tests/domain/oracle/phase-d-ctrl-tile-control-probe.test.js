/**
 * Phase-D probe: a player controls a tile iff at least one friendly figure
 * is present AND no hostile figure is present; shared occupation → no
 * one controls.
 *
 * PROBE-PD-CTRL-001: CRR CONTROL — "A player controls a tile if at least
 *   one friendly figure occupies it and no hostile figure occupies it;
 *   shared occupation → no one controls."
 *
 * Implementation: every control-scoring site in the codebase uses the
 *   same two-predicate shape:
 *     const p1Has = … p1Cells …;
 *     const p2Has = … p2Cells …;
 *     if (p1Has && !p2Has) → player 1 controls
 *     else if (p2Has && !p1Has) → player 2 controls
 *     else → nobody controls (shared or empty)
 *   Three call sites share this shape:
 *     - getSpaceController (src/game/board-helpers.js)
 *     - countTerminalsControlledByPlayer (src/game/board-helpers.js)
 *     - vpPerControlledDeploymentZone (src/game/mission-rules.js)
 *   All three source their cell sets from the same helper —
 *   `getPlayerOccupiedCellsForControl(game, playerNum)` — which excludes
 *   companion figures that do not count for control. Because the shape
 *   is shared and non-bypassable, the CTRL-001 rule is structurally
 *   guaranteed everywhere control is measured.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const BH_SRC = readFileSync(resolve(ROOT, 'src/game/board-helpers.js'), 'utf8');
const MR_SRC = readFileSync(resolve(ROOT, 'src/game/mission-rules.js'), 'utf8');

describe('PROBE-PD-CTRL-001: tile control requires friendly presence AND no hostile presence', () => {
  it('001a: source — getSpaceController uses the present-and-no-hostile shape (returns 1, 2, or null)', () => {
    assert.match(BH_SRC,
      /export function getSpaceController\(game, mapId, coord\) \{[\s\S]*?if \(p1Has && !p2Has\) return 1;\s*\n\s*if \(p2Has && !p1Has\) return 2;\s*\n\s*return null;\s*\n\}/,
      'getSpaceController must return 1/2/null on present-and-no-hostile — CRR-CTRL-001');
  });

  it('001b: source — countTerminalsControlledByPlayer uses the same shape', () => {
    assert.match(BH_SRC,
      /export function countTerminalsControlledByPlayer\(game, playerNum, mapId\) \{[\s\S]*?if \(playerNum === 1 && p1Has && !p2Has\) count\+\+;\s*\n\s*if \(playerNum === 2 && p2Has && !p1Has\) count\+\+;/,
      'terminal control must require present-and-no-hostile — CRR-CTRL-001');
  });

  it('001c: source — vpPerControlledDeploymentZone uses the count-based equivalent (present-and-no-hostile)', () => {
    assert.match(MR_SRC,
      /if \(p1Count > 0 && p2Count === 0\) vpByPlayer\[1\] \+= vp;\s*\n\s*else if \(p2Count > 0 && p1Count === 0\) vpByPlayer\[2\] \+= vp;/,
      'deployment-zone control must require present-and-no-hostile — CRR-CTRL-001');
  });

  it('001d: source — all three sites source cells from the SAME helper getPlayerOccupiedCellsForControl', () => {
    const bhCalls = (BH_SRC.match(/getPlayerOccupiedCellsForControl\(game, (1|2)\)/g) || []).length;
    const mrCalls = (MR_SRC.match(/getPlayerOccupiedCellsForControl\(game, (1|2)\)/g) || []).length;
    // getSpaceController: 2 calls; countTerminalsControlledByPlayer: 2 calls; zone-VP: 2 calls.
    assert.ok(bhCalls >= 4,
      'board-helpers.js must call getPlayerOccupiedCellsForControl ≥4× (2 per site × 2 sites) — CRR-CTRL-001');
    assert.ok(mrCalls >= 2,
      'mission-rules.js must call getPlayerOccupiedCellsForControl ≥2× (p1 + p2) — CRR-CTRL-001');
  });

  it('001e: source — getPlayerOccupiedCellsForControl excludes companion figures that do not count for control', () => {
    assert.match(BH_SRC,
      /export function getPlayerOccupiedCellsForControl\(game, playerNum\) \{[\s\S]*?if \(_isExcludedFromControl\(game, playerNum, k\)\) continue;/,
      'control-cell helper must filter out excluded figures (companions) — CRR-CTRL-001');
  });

  it('001f: source — rule intent is explicitly documented at the deployment-zone scoring site', () => {
    assert.match(MR_SRC,
      /\/\/ CRR CONTROL: "a player Controls a deployment zone if there is at least one\s*\n\s*\/\/ friendly figure in any space of that deployment zone and no hostile figures\s*\n\s*\/\/ in any space of that deployment zone\."/,
      'zone-VP scoring must cite the CRR CONTROL rule verbatim — CRR-CTRL-001');
  });
});
