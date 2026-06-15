/**
 * Phase-D probe: CRR MSV-007 — "When a Massive figure pushes other figures
 * as a result of ending its movement, the Mobile keyword on a pushed figure
 * affects the push and where the pushed figure can end movement."
 *
 * This is the Mobile-half of the PUSH p.51 rule "When a figure with Massive
 * or Mobile is pushed, the push ignores terrain" — for Mobile pushed figures
 * being displaced by a Massive figure's end-of-movement footprint, the push
 * destination search treats blocking terrain as passable (the figure can end
 * movement there).
 *
 * Implementation chain (invariant pin):
 *   1. `getMovementKeywords(dcName, game)` — returns the lowercased keyword
 *      set from the dcName-indexed table, so a figure tagged Mobile in its
 *      Deployment card data surfaces `'mobile'` in the profile.
 *   2. `getMovementProfile` — derives `isMobile = keywords.has('mobile')`
 *      and sets `ignoreBlocking: isMassive || isMobile`, piping the Mobile
 *      keyword into the shared movement-profile flag.
 *   3. `getNearestDisplacementOptions` — the ring search used by the
 *      massive-push displacement engine constructs the profile via
 *      `getMovementProfile(dcName, figureKey, game)` and gates blocking-cell
 *      rejection behind `profile.ignoreBlocking`, so a Mobile pushed figure
 *      can land on a cell that a non-Mobile figure could not.
 *
 * Per alexanbv 2026-06-15 the engine never auto-places: a displaced figure is
 * always offered the nearest ring of legal spaces (within 1, else within 2, …)
 * to choose from. The Mobile invariant moved out of the old auto-BFS fallback
 * and into `getNearestDisplacementOptions`. This probe pins the chain so any
 * future refactor that decouples the keyword→profile→push path fails loudly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-MSV-007: Mobile affects push destinations when Massive ends movement', () => {
  it('007a: source — getMovementKeywords returns a lowercased keyword set from dc data', () => {
    assert.match(MV_SRC,
      /export function getMovementKeywords\(dcName, game\) \{\s*\n\s*const raw = getDcKeywords\(game\)\?\.\[dcName\] \|\| \[\];\s*\n\s*return new Set\(raw\.map\(\(k\) => String\(k\)\.toLowerCase\(\)\)\);/,
      'getMovementKeywords must expose a lowercased keyword set — CRR-MSV-007');
  });

  it('007b: source — getMovementProfile derives isMobile and pipes it into ignoreBlocking', () => {
    assert.match(MV_SRC,
      /const isMobile = keywords\.has\('mobile'\);/,
      'profile must derive isMobile from the keyword set — CRR-MSV-007');
    assert.match(MV_SRC,
      /ignoreBlocking: isMassive \|\| isMobile,/,
      'Mobile must flow into profile.ignoreBlocking alongside Massive — CRR-MSV-007');
  });

  it('007c: source — pushFigureToNearestValid constructs the profile for the PUSHED figure and gates blocking behind ignoreBlocking', () => {
    // Pull the function body and assert both: (1) profile is built from the
    // pushed figure's own dcName/figureKey, and (2) the blocking rejection
    // is !profile.ignoreBlocking gated.
    const fnMatch = MV_SRC.match(
      /export function pushFigureToNearestValid\(game, playerNum, figureKey, forbiddenSet\) \{[\s\S]*?\n\}/,
    );
    assert.ok(fnMatch, 'pushFigureToNearestValid must be locatable');
    const body = fnMatch[0];
    assert.match(body, /const dcName = dcNameFromFigureKey\(figureKey\);/,
      'push must derive dcName from the pushed figureKey — CRR-MSV-007');
    assert.match(body, /const profile = getMovementProfile\(dcName, figureKey, game\);/,
      'push must build the movement profile for the pushed figure — CRR-MSV-007');
    assert.match(body,
      /const blocked = !profile\.ignoreBlocking && \[\.\.\.footprint\]\.some\(\(cell\) => board\.blockingSet\.has\(cell\)\);/,
      'blocking-cell rejection must be gated by !profile.ignoreBlocking — CRR-MSV-007');
  });

  it('007d: source — resolveNextDisplacements offers the nearest legal ring via getNearestDisplacementOptions (no auto-place), and that ring search honors ignoreBlocking', () => {
    // Per alexanbv 2026-06-15: the engine never auto-places. A displaced figure
    // with no adjacent space is offered ALL spaces at the next ring (within 2,
    // etc.) to choose from. The Mobile invariant lives in the ring search,
    // which gates blocking behind profile.ignoreBlocking.
    assert.match(MV_SRC,
      /const options = getNearestDisplacementOptions\(game, entry\.figureKey, entry\.playerNum, forbiddenSet\);/,
      'displacement engine must compute the nearest legal ring via getNearestDisplacementOptions — CRR-MSV-007');
    const fnMatch = MV_SRC.match(
      /export function getNearestDisplacementOptions\(game, figureKey, playerNum, forbiddenSet\) \{[\s\S]*?\n\}/,
    );
    assert.ok(fnMatch, 'getNearestDisplacementOptions must be locatable');
    assert.match(fnMatch[0],
      /profile\.ignoreBlocking \|\| !board\.blockingSet\.has\(cell\)/,
      'ring search must let Mobile/Massive figures land on blocking cells (ignoreBlocking) — CRR-MSV-007');
  });
});
