/**
 * Phase-D probe: when a figure with Massive or Mobile is pushed, the push
 * ignores blocking/difficult terrain; Massive may additionally end in
 * spaces containing other figures.
 *
 * PROBE-PD-PSH-007: CRR PUSH — "When a figure with Massive or Mobile is
 *   pushed, the push ignores terrain; Massive may also end movement in
 *   spaces with other figures."
 *
 * Implementation: `getMovementProfile` in `src/game/movement.js` lifts
 *   three flags from the figure's keyword set:
 *     - ignoreDifficult: isMassive || isMobile || …
 *     - ignoreBlocking:  isMassive || isMobile
 *     - canEndOnOccupied: isMassive
 *   `pushFigureToNearestValid` then consults those same flags when
 *   searching for a destination via BFS:
 *     - `const blocked = !profile.ignoreBlocking && [...footprint].some(
 *        (cell) => board.blockingSet.has(cell));`
 *       → Massive/Mobile candidates are NEVER blocked-by-blocking during
 *         push destination search.
 *   Difficult terrain contributes no additional cost to a push (BFS cost
 *   is 1 per edge, and only spaces that pass the blocking/forbidden/occupied
 *   checks are considered). The occupied-space test uses `board.occupiedSet`
 *   and is a hard reject, but `pushFigureToNearestValid` is only invoked
 *   AFTER the massive-displacement engine has relocated overlapping figures,
 *   so a Massive figure ending in an originally-occupied space is valid.
 *   The `canEndOnOccupied: isMassive` flag is the static source of this
 *   Massive-only allowance.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-PSH-007: Massive/Mobile push ignores terrain; Massive may end on occupied', () => {
  it('007a: source — profile.ignoreBlocking is driven by Massive OR Mobile', () => {
    assert.match(MV_SRC,
      /ignoreBlocking: isMassive \|\| isMobile,/,
      'ignoreBlocking must be isMassive || isMobile — CRR-PSH-007');
  });

  it('007b: source — profile.ignoreDifficult is driven by Massive OR Mobile (among others)', () => {
    assert.match(MV_SRC,
      /ignoreDifficult: isMassive \|\| isMobile \|\| hasEfficientTravel \|\| hasSurvivalist,/,
      'ignoreDifficult must be lifted for Massive/Mobile — CRR-PSH-007');
  });

  it('007c: source — profile.canEndOnOccupied is Massive-only', () => {
    assert.match(MV_SRC,
      /canEndOnOccupied: isMassive,/,
      'canEndOnOccupied must be exclusively isMassive — CRR-PSH-007');
  });

  it('007d: source — pushFigureToNearestValid skips the blocking check when ignoreBlocking is set', () => {
    assert.match(MV_SRC,
      /const blocked = !profile\.ignoreBlocking && \[\.\.\.footprint\]\.some\(\(cell\) => board\.blockingSet\.has\(cell\)\);/,
      'push destination search must honor ignoreBlocking — CRR-PSH-007');
  });

  it('007e: source — pushFigureToNearestValid accepts a destination when not forbidden, not occupied, and not blocked', () => {
    assert.match(MV_SRC,
      /if \(!overlapForbidden && !overlapOther && !blocked\) \{\s*\n\s*pushFigure\(game, playerNum, figureKey, topLeft\);\s*\n\s*return true;/,
      'destination acceptance must be a 3-way AND gate — CRR-PSH-007');
  });

  it('007f: source — push BFS cost is uniform (no DT surcharge) — only edge-count determines "nearest"', () => {
    // The BFS pushes neighbors via moveVectors with no per-step cost
    // accumulator; difficult terrain contributes nothing to push distance.
    const pushBody = MV_SRC.match(/export function pushFigureToNearestValid[\s\S]*?^}/m);
    assert.ok(pushBody, 'pushFigureToNearestValid body must be locatable');
    assert.doesNotMatch(pushBody[0], /enteringDifficult|extraCost|difficult.*surcharge/,
      'push BFS must not add DT surcharges — CRR-PSH-007');
    assert.match(pushBody[0], /queue\.push\(nextTopLeft\);/,
      'push BFS must enqueue neighbors uniformly — CRR-PSH-007');
  });
});
