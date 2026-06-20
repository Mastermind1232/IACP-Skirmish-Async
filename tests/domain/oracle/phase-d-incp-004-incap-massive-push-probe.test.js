/**
 * Phase-D probe: CRR INCP-004 — "An incapacitated figure can still be pushed
 * by a massive figure ending its movement in the incapacitated figure's space."
 *
 * This is the explicit exception to INCP-001 ("other figures cannot end
 * movement in [an incapacitated figure's] space"). The skirmish substrate is
 * the iterative massive-displacement engine in src/game/movement.js, which
 * (a) lets Massive figures end on any occupied space (canEndOnOccupied: true
 * bypasses the occupiedSet gate that enforces INCP-001 for non-Massive
 * figures), and (b) collects ALL overlapping figures — including companions
 * and incapacitated figures — and pushes them out via
 * resolveNextDisplacements → pushFigure / pushFigureToNearestValid.
 *
 * Implementation chain (invariant pin):
 *   1. getMovementProfile: Massive figures get `canEndOnOccupied: true` — the
 *      occupiedSet gate that enforces INCP-001's "cannot end in incap space"
 *      is bypassed for Massive movers.
 *   2. collectOverlappingFigures iterates every figure in figurePositions and
 *      only skips `movingFigureKey`. It does NOT skip companions and does NOT
 *      skip incapacitated figures — so an incap Child whose footprint overlaps
 *      a Massive mover's final footprint is collected for displacement.
 *   3. resolveMassivePush calls initMassiveDisplacement (which in turn calls
 *      collectOverlappingFigures), then iteratively pushes the overlapping
 *      figures via pushFigure / pushFigureToNearestValid. The push path does
 *      NOT check game.childIncapacitated, so the Child is pushed regardless
 *      of incap state — pin "massive figure can still push".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-INCP-004: massive figure can still push an incapacitated figure out of its ending space', () => {
  it('004a: source — getMovementProfile grants Massive figures canEndOnOccupied: true (bypasses INCP-001 occupiedSet gate)', () => {
    assert.match(MV_SRC,
      /canEndOnOccupied:\s*isMassive,/,
      'Massive movement profile must set canEndOnOccupied: true — CRR-INCP-004 (exception to INCP-001)');
  });

  it('004b: source — the occupiedSet gate in BFS is expressly short-circuited when profile.canEndOnOccupied is true', () => {
    // The BFS that enumerates valid ending footprints computes
    // `canEnd = !isOccupied || profile.canEndOnOccupied;` — the second
    // disjunct is the Massive exception that lets a Massive figure end on
    // the occupied-by-incap-Child cell.
    // The `(!isOccupied || profile.canEndOnOccupied)` disjunct is the Massive
    // exception. A later `&& !endsOnBlocking` clause was added for Force Jump's
    // cannotEndOnBlocking (MOBILE may pass through but not end on blocking terrain);
    // it does not affect Massive movers (they never set cannotEndOnBlocking).
    assert.match(MV_SRC,
      /const isOccupied = current\.footprint\.some\(\(cell\) => board\.occupiedSet\.has\(cell\)\);[\s\S]*?const canEnd = \(!isOccupied \|\| profile\.canEndOnOccupied\)( && !endsOnBlocking)?;/,
      'BFS canEnd gate must allow Massive figures to end on occupied — CRR-INCP-004');
  });

  it('004c: source — collectOverlappingFigures does NOT skip companions or incap figures (only skips movingFigureKey)', () => {
    // The only skip in the loop is `key === movingFigureKey`. No
    // isDcCompanion check, no childIncapacitated check — so an incap
    // companion overlapping the Massive footprint IS collected.
    assert.match(MV_SRC,
      /export function collectOverlappingFigures\(game, movingPlayerNum, movingFigureKey, footprint\) \{[\s\S]*?if \(key === movingFigureKey\) continue;[\s\S]*?const intersects = cells\.some\(\(cell\) => footprint\.has\(cell\)\);[\s\S]*?if \(!intersects\) continue;[\s\S]*?\}[\s\S]*?return \[\.\.\.overlapsFriendly, \.\.\.overlapsEnemy\];\s*\n\}/,
      'collectOverlappingFigures must include every overlapping figure (no companion/incap exemption) — CRR-INCP-004');
    // Defensive: explicitly rule out a companion-skip or incap-skip in the
    // overlap collection path (these would cause the incap Child to be
    // silently left behind when a Massive figure ends on its cell).
    const overlapFn = MV_SRC.match(/export function collectOverlappingFigures[\s\S]*?^}/m)?.[0] || '';
    assert.ok(overlapFn.length > 0,
      'collectOverlappingFigures body must be locatable — CRR-INCP-004');
    assert.doesNotMatch(overlapFn, /isDcCompanion\s*\(/,
      'collectOverlappingFigures must NOT skip companions — CRR-INCP-004');
    assert.doesNotMatch(overlapFn, /childIncapacitated/,
      'collectOverlappingFigures must NOT skip incapacitated figures — CRR-INCP-004');
  });

  it('004d: source — resolveMassivePush early-exits unless profile.canEndOnOccupied (guards the Massive-only exception)', () => {
    assert.match(MV_SRC,
      /export async function resolveMassivePush\([\s\S]*?\) \{\s*\n\s*if \(!profile\.canEndOnOccupied\) return;/,
      'resolveMassivePush must gate on canEndOnOccupied so only Massive movers trigger INCP-004 — CRR-INCP-004');
  });

  it('004e: source — displacement of an incap Child is unconditional: pushFigure / pushFigureToNearestValid do not check childIncapacitated', () => {
    // The iterative displacement engine invokes pushFigure (for 1-space
    // auto-resolve and controller-chosen placement) and pushFigureToNearestValid
    // (BFS fallback). Neither consults game.childIncapacitated, so the incap
    // Child is pushed out using the ordinary movement machinery.
    const pushFigureBody = MV_SRC.match(/function pushFigure\(game, playerNum, figureKey, coord\)[\s\S]*?^}/m)?.[0]
      || MV_SRC.match(/function pushFigure\([\s\S]*?\) \{[\s\S]*?^}/m)?.[0]
      || '';
    const pushBfsBody = MV_SRC.match(/export function pushFigureToNearestValid[\s\S]*?^}/m)?.[0] || '';
    assert.doesNotMatch(pushFigureBody, /childIncapacitated/,
      'pushFigure must not refuse to move an incapacitated figure — CRR-INCP-004');
    assert.doesNotMatch(pushBfsBody, /childIncapacitated/,
      'pushFigureToNearestValid must not refuse to move an incapacitated figure — CRR-INCP-004');
  });

  it('004f: behavioural — initMassiveDisplacement returns a non-null pending struct including the incap Child when its cell is overlapped', async () => {
    // Exercise the real entry point end-to-end on a synthetic game state.
    // The Massive mover ends on 2D (a 1x1 cell occupied by the incap Child);
    // the overlap collector should include The Child in the enemy queue.
    const mv = await import(resolve(ROOT, 'src/game/movement.js'));
    const game = {
      childIncapacitated: true,
      figurePositions: {
        1: { 'Massive Mover-1-0': 'D2' },
        2: { 'The Child-1-0': 'D2' },
      },
      figureOrientations: {
        'Massive Mover-1-0': '1x1',
        'The Child-1-0': '1x1',
      },
    };
    const footprintSet = new Set(['d2']);
    const pending = mv.initMassiveDisplacement(game, 1, 'Massive Mover-1-0', footprintSet);
    assert.ok(pending,
      'Massive mover ending on incap Child\'s cell must produce a non-null pending displacement — CRR-INCP-004');
    const childEntry = pending.enemyQueue.find((e) => e.figureKey === 'The Child-1-0');
    assert.ok(childEntry,
      'The incap Child must appear in the enemyQueue of the massive-push engine — CRR-INCP-004');
    assert.equal(childEntry.dcName, 'The Child',
      'Overlap entry dcName must resolve to "The Child" — CRR-INCP-004');
    assert.equal(pending.totalDisplaced, 1,
      'Exactly one figure (the incap Child) should be slated for displacement — CRR-INCP-004');
  });
});
