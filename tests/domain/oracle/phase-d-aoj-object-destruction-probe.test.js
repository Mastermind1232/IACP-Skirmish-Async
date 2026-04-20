/**
 * Phase-D probe: an attackable object (crate) is destroyed when its
 * accumulated damage reaches its mission-specified Health.
 *
 * PROBE-PD-AOJ-001: CRR ATTACKING OBJECTS — "An object has Health
 *   specified by mission rules; when damage >= Health, the object is
 *   destroyed."
 *
 * Implementation: crates are the sole skirmish object with an HP pool
 *   (Devaron Garrison, 5 HP per mission spec). Every site that damages
 *   a crate follows the same three-step pattern in
 *   `src/engine/combat-bridge.js`:
 *     1. Initialize pool from mission spec (default 5 if unset).
 *     2. Subtract damage with a non-negative floor:
 *          `game.crateHealth[origCoord] = Math.max(0, game.crateHealth[origCoord] - damage)`.
 *     3. Destroy when `game.crateHealth[origCoord] <= 0` —
 *        `delete game.cratePositions[origCoord]` removes the object
 *        from the map.
 *   Two damage sources (direct attack, Blast splash) share this shape.
 *   Doors are not attackable in this codebase (opened via interact, not
 *   combat), so the "doors are opened" clause of CRR-AOJ-001 is
 *   vacuously satisfied.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');

describe('PROBE-PD-AOJ-001: crates are destroyed when accumulated damage >= mission-specified Health', () => {
  it('001a: source — direct-attack crate damage initializes HP (5 default), subtracts with non-negative floor, destroys at <=0', () => {
    assert.match(CB_SRC,
      /if \(typeof game\.crateHealth\[origCoord\] !== 'number'\) game\.crateHealth\[origCoord\] = 5;\s*\n\s*if \(damage > 0 && hit\) \{\s*\n\s*game\.crateHealth\[origCoord\] = Math\.max\(0, game\.crateHealth\[origCoord\] - damage\);[\s\S]*?if \(game\.crateHealth\[origCoord\] <= 0\) \{[\s\S]*?delete game\.cratePositions\[origCoord\];/,
      'direct-attack path must init HP, subtract with floor, destroy at <=0, and delete cratePositions — CRR-AOJ-001');
  });

  it('001b: source — Blast splash damage shares the same init/subtract/destroy shape', () => {
    assert.match(CB_SRC,
      /if \(typeof game\.crateHealth\[origCoord\] !== 'number'\) game\.crateHealth\[origCoord\] = 5;\s*\n\s*game\.crateHealth\[origCoord\] = Math\.max\(0, game\.crateHealth\[origCoord\] - effectiveBlast\);[\s\S]*?if \(game\.crateHealth\[origCoord\] <= 0\) \{\s*\n\s*delete game\.cratePositions\[origCoord\];/,
      'Blast splash path must init HP, subtract with floor, destroy at <=0, and delete cratePositions — CRR-AOJ-001');
  });

  it('001c: source — destruction threshold is `<= 0` (i.e., damage >= Health), NOT strict `< 0`', () => {
    const thresholds = CB_SRC.match(/if \(game\.crateHealth\[origCoord\] <= 0\) \{/g) || [];
    assert.ok(thresholds.length >= 2,
      'there must be ≥2 destruction-threshold sites (direct + blast), both using <= 0 — CRR-AOJ-001');
    const strictSites = CB_SRC.match(/if \(game\.crateHealth\[origCoord\] < 0\) \{/g) || [];
    assert.equal(strictSites.length, 0,
      'no destruction site may use strict < 0 — CRR-AOJ-001');
  });

  it('001d: source — damage subtraction is bounded by Math.max(0, ...) — HP never goes negative', () => {
    const floorSites = CB_SRC.match(/game\.crateHealth\[origCoord\] = Math\.max\(0, game\.crateHealth\[origCoord\] - [a-zA-Z]+\);/g) || [];
    assert.ok(floorSites.length >= 2,
      'damage subtraction must be clamped to ≥ 0 at both damage sites — CRR-AOJ-001');
  });

  it('001e: source — destruction deletes from cratePositions (object is removed from map)', () => {
    const deletes = CB_SRC.match(/delete game\.cratePositions\[origCoord\];/g) || [];
    assert.ok(deletes.length >= 2,
      'destruction must delete cratePositions entry at each damage path — CRR-AOJ-001');
  });

  it('001f: source — crate destruction log fires with "destroyed" wording when HP reaches 0', () => {
    assert.match(CB_SRC,
      /Crate at \*\*\$\{[^}]*\}\*\* destroyed/,
      'destruction log must state "destroyed" — CRR-AOJ-001');
  });
});
