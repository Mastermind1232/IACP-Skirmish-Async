/**
 * Phase-D probe: "Move X spaces" effects ignore movement-point costs —
 * the standard +1 MP adders for difficult terrain and hostile figures
 * do not apply when MP comes from a "Move up to X" effect.
 *
 * PROBE-PD-MOVE-017: CRR MOVEMENT — "'Move X spaces' effects ignore
 *   movement-point costs (terrain/figure additional costs do not apply)."
 *
 * Architecture (post-2026-05-08 refactor):
 *   - Move-X effects no longer bank MP into movementBank with a
 *     side-channel `moveXBypassActive` flag. Instead they stamp a
 *     dedicated `game.pendingMoveX[msgId]` budget and post a
 *     1-space-at-a-time picker (`src/handlers/move-x-handler.js`).
 *   - The picker computes valid 1-space cardinal translations and
 *     decrements the budget per click. Every step costs exactly 1
 *     space regardless of terrain/figure cost — that IS the MOVE-017
 *     enforcement.
 *   - The legacy `moveXBypassActive` flag is being deleted as the
 *     remaining freeMoveBonus dispatch sites migrate (phase 3 of the
 *     refactor); this test no longer enforces its existence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AB_SRC = readFileSync(resolve(ROOT, 'src/game/abilities.js'), 'utf8');
const MX_SRC = readFileSync(resolve(ROOT, 'src/handlers/move-x-handler.js'), 'utf8');
const AS_SRC = readFileSync(resolve(ROOT, 'src/game/activation-state.js'), 'utf8');

describe('PROBE-PD-MOVE-017: Move-X effects bypass MP costs via pendingMoveX picker', () => {
  it('017a: source — abilities.js freeMoveBonus dispatch sites stamp pendingMoveX', () => {
    const grantSites = [...AB_SRC.matchAll(/game\.pendingMoveX\[msgId\] = \{[\s\S]*?remaining: entry\.freeMoveBonus,/g)];
    assert.ok(grantSites.length >= 2,
      `expected at least 2 abilities.js sites that stamp game.pendingMoveX from entry.freeMoveBonus; found ${grantSites.length} — CRR-MOVE-017`);
  });

  it('017b: source — pendingMoveX picker is the MOVE-017 enforcement (bypassCosts=true → step cost 1)', () => {
    // Step-cost helper short-circuits to 1 when the budget is in
    // bypass mode (Move-X effects). Regular MP-gain budgets
    // (bypassCosts=false) honor the +1 difficult / +1 hostile
    // adders and the figure's profile flags via getMovementProfile.
    assert.match(MX_SRC, /if \(bypassCosts \|\| !profile \|\| !board\) return 1;/,
      'move-x picker must return cost=1 when bypassCosts is true — CRR-MOVE-017');
    // Each step decrement uses match.stepCost — Move-X candidates
    // always have stepCost=1 by virtue of the helper above.
    assert.match(MX_SRC, /pending\.remaining\s*=\s*Math\.max\(0,\s*pending\.remaining\s*-\s*cost\);/,
      'move-x picker must decrement remaining by the step cost — CRR-MOVE-017');
    // Picker exposes setupPendingMoveX (async) and stampPendingMoveX
    // (sync) so both async and sync callers can route through.
    assert.match(MX_SRC, /export\s+(async\s+)?function\s+setupPendingMoveX\b/,
      'move-x-handler must export setupPendingMoveX — CRR-MOVE-017');
    assert.match(MX_SRC, /export\s+function\s+stampPendingMoveX\b/,
      'move-x-handler must export stampPendingMoveX — CRR-MOVE-017');
  });

  it('017c: source — pendingMoveX is cleaned up per round (state-flag registry)', () => {
    assert.match(AS_SRC, /ROUND_OBJECT_FLAGS[\s\S]*?'pendingMoveX'/,
      'pendingMoveX must appear in ROUND_OBJECT_FLAGS — CRR-MOVE-017');
  });
});
