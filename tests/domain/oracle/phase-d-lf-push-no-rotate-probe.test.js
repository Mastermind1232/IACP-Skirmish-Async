/**
 * Phase-D probe: large figures retain orientation when pushed.
 *
 * PROBE-PD-LF-007: When a large figure is pushed or moves a set number of
 *   spaces, its base cannot rotate and must retain its current orientation.
 *   (CRR LARGE FIGURES)
 *
 * Implementation: `pushFigure` in src/game/player-helpers.js is the canonical
 *   push/pull/displacement write — it touches `game.figurePositions` only
 *   and never mutates `game.figureOrientations`. Rotation writes (`game.figureOrientations[figureKey] = ...`) exist
 *   only in voluntary-move and setup code paths (handlers/movement.js,
 *   handlers/setup.js, engine/setup-bridge.js), NOT in any push pathway.
 *   Behavioral check: calling `pushFigure` with a new coord leaves
 *   `figureOrientations[figureKey]` unchanged.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushFigure } from '../../../src/game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const HELPERS_SRC = readFileSync(resolve(ROOT, 'src/game/player-helpers.js'), 'utf8');
const MOVEMENT_ENGINE_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-LF-007: pushed/move-X large figures retain orientation', () => {
  it('007a: source — pushFigure is the canonical push write and only mutates figurePositions', () => {
    // The body must write positions[figureKey] and NOT touch figureOrientations.
    assert.match(HELPERS_SRC,
      /export function pushFigure\(game, playerNum, figureKey, newSpace\) \{\s*\n\s*const positions = game\.figurePositions\?\.\[playerNum\];/,
      'pushFigure must read figurePositions by playerNum — CRR-LF-007');
    assert.match(HELPERS_SRC,
      /positions\[figureKey\] = String\(newSpace\)\.toLowerCase\(\);/,
      'pushFigure must write the new space to positions[figureKey] — CRR-LF-007');
  });

  it('007b: source — pushFigure does NOT read or write figureOrientations (no rotation on push)', () => {
    // Extract the pushFigure function body and verify no figureOrientations reference.
    const match = HELPERS_SRC.match(/export function pushFigure\([^)]*\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'pushFigure must be defined — CRR-LF-007');
    assert.ok(!/figureOrientations/.test(match[0]),
      'pushFigure body must not reference figureOrientations — CRR-LF-007');
  });

  it('007c: source — pushFigureToNearestValid uses pushFigure and preserves the size profile', () => {
    // BFS-based push-to-nearest-valid must use the existing movement profile (size unchanged)
    // and write via pushFigure (no orientation mutation).
    assert.match(MOVEMENT_ENGINE_SRC,
      /const profile = getMovementProfile\(dcName, figureKey, game\);/,
      'pushFigureToNearestValid must compute profile from current state — CRR-LF-007');
    assert.match(MOVEMENT_ENGINE_SRC,
      /pushFigure\(game, playerNum, figureKey, topLeft\);/,
      'pushFigureToNearestValid must write via pushFigure — CRR-LF-007');
  });

  it('007d: behavior — pushFigure leaves figureOrientations unchanged', () => {
    const game = {
      figurePositions: { 1: { 'myDc_f0': 'a1' } },
      figureOrientations: { 'myDc_f0': '2x3' },
    };
    const out = pushFigure(game, 1, 'myDc_f0', 'c4');
    assert.equal(out.prevPos, 'a1', 'push must report prevPos');
    assert.equal(out.newPos, 'c4', 'push must report newPos');
    assert.equal(game.figurePositions[1]['myDc_f0'], 'c4', 'position must update');
    assert.equal(game.figureOrientations['myDc_f0'], '2x3',
      'orientation must NOT change on push — CRR-LF-007');
  });

  it('007e: behavior — pushFigure on a rotated 3x2 figure keeps the rotated size', () => {
    // A figure whose base has been rotated to 3x2 must stay 3x2 after a push.
    const game = {
      figurePositions: { 2: { 'largeDc_f0': 'e5' } },
      figureOrientations: { 'largeDc_f0': '3x2' },
    };
    pushFigure(game, 2, 'largeDc_f0', 'g7');
    assert.equal(game.figureOrientations['largeDc_f0'], '3x2',
      'rotated orientation must persist across push — CRR-LF-007');
  });

  it('007f: source — orientation writes live outside push pathways', () => {
    // pushFigure never rotates; the push pathway in movement.js never assigns figureOrientations.
    // Grep guard: no `figureOrientations[...] =` inside pushFigureToNearestValid / initMassiveDisplacement / resolveMassivePush.
    // Find each push fn body and assert no orientation write.
    for (const fnName of ['pushFigureToNearestValid', 'initMassiveDisplacement', 'resolveMassivePush']) {
      const re = new RegExp(`export (?:async )?function ${fnName}\\([^)]*\\)[\\s\\S]*?\\n\\}`, 'm');
      const m = MOVEMENT_ENGINE_SRC.match(re);
      if (!m) continue; // fn may be defined inline elsewhere
      assert.ok(!/figureOrientations\s*\[/.test(m[0]),
        `${fnName} body must not write figureOrientations — CRR-LF-007`);
    }
  });
});
