/**
 * Phase-D probe: when a large figure moves or rotates it exits all
 * old spaces and enters all new spaces — with no intermediate
 * partial-occupancy state visible to triggered effects.
 *
 * PROBE-PD-LF-006: CRR LARGE FIGURES — "When a large figure moves or
 *   rotates, it exits all spaces it occupied and then enters all of
 *   its new spaces, even if some of those spaces overlap."
 *
 * Implementation: figure position in the engine is a single top-left
 *   coord stored at `game.figurePositions[playerNum][figureKey]`.
 *   Multi-cell footprint is derived on-read by `getFootprintCells`
 *   /`getNormalizedFootprint` in `src/game/coords.js`. Every movement
 *   write site replaces the entire top-left coord in one assignment —
 *   there is no multi-cell per-cell position storage, and no
 *   intermediate "half-moved" state can ever be observed by triggered
 *   effects. "Exit all old cells, then enter all new cells" is the
 *   atomic consequence of the single-coord replacement: at step n
 *   the footprint is the old cells; at step n+1 it is the new cells,
 *   with no interleaving.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');
const CD_SRC = readFileSync(resolve(ROOT, 'src/game/coords.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-LF-006: large-figure move/rotate is atomic (single top-left replacement; no multi-cell partial state)', () => {
  it('006a: source — movement write site replaces the top-left coord in a single assignment (atomic exit-then-enter)', () => {
    assert.match(MV_SRC,
      /const newTopLeft = targetInfo\.topLeft;\s*\n\s*game\.figurePositions\[playerNum\]\[figureKey\] = newTopLeft;/,
      'movement.js must write newTopLeft in a single assignment — CRR-LF-006');
  });

  it('006b: source — getFootprintCells derives multi-cell footprint from the top-left coord + size (no stored per-cell occupancy)', () => {
    assert.match(CD_SRC,
      /export function getFootprintCells\(topLeftCoord, size\) \{[\s\S]*?cells\.push\(colRowToCoord\(col \+ c, row \+ r\)\);/,
      'getFootprintCells must derive footprint from (topLeft, size) — CRR-LF-006');
  });

  it('006c: source — no src file stores a per-cell occupancy map for large figures (would allow a half-moved intermediate state)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/figureFootprintMap\b|figureCellOccupancy\b|multiCellPositions\b|perCellFigurePositions\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a per-cell footprint occupancy container — CRR-LF-006');
  });
});
