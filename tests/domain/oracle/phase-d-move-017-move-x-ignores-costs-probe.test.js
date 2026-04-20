/**
 * Phase-D probe: "Move X spaces" effects ignore movement-point costs —
 * the standard +1 MP adders for difficult terrain and hostile figures
 * do not apply when MP comes from a "Move up to X" effect.
 *
 * PROBE-PD-MOVE-017: CRR MOVEMENT — "'Move X spaces' effects ignore
 *   movement-point costs (terrain/figure additional costs do not apply)."
 *
 * Implementation:
 *   - `src/game/abilities.js` tags every `freeMoveBonus` grant site
 *     (Mortar Launcher, I'm One With the Force / Executor class, On
 *     the Hunt) with `game.moveXBypassActive[msgId] = true` — a
 *     side-channel that does NOT mutate the movementBank entry
 *     (preserving the MOVE-018 invariant).
 *   - `src/handlers/movement.js` reads `moveXBypassActive` alongside
 *     the existing `mobileMovementActive` branch and sets
 *     `profile.ignoreFigureCost = true; profile.ignoreDifficult = true;`
 *     so `computeMovementCache` → `evaluateMovementStep` skips the
 *     terrain-difficult and hostile-figure +1 adders.
 *   - `profile.ignoreBlocking` is NOT set (Move-X still cannot end in
 *     a blocking cell; that's a non-cost restriction covered by MOVE-018).
 *   - `src/game/activation-state.js` lists `moveXBypassActive` in the
 *     ACTIVATION_MSGID_FLAGS + ROUND_OBJECT_FLAGS cleanup tables so it
 *     does not leak across activations or rounds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AB_SRC = readFileSync(resolve(ROOT, 'src/game/abilities.js'), 'utf8');
const MV_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');
const AS_SRC = readFileSync(resolve(ROOT, 'src/game/activation-state.js'), 'utf8');

describe('PROBE-PD-MOVE-017: Move-X effects bypass MP costs via moveXBypassActive', () => {
  it('017a: source — every freeMoveBonus grant site tags moveXBypassActive[msgId]', () => {
    const grantSites = [...AB_SRC.matchAll(/addMovementPoints\(game, msgId, entry\.freeMoveBonus\);/g)];
    assert.ok(grantSites.length >= 3,
      `expected at least 3 freeMoveBonus grant sites; found ${grantSites.length} — CRR-MOVE-017`);
    // Each grant must be followed (within 400 chars) by the bypass flag set.
    for (const m of grantSites) {
      const window = AB_SRC.slice(m.index, m.index + 400);
      assert.match(window,
        /game\.moveXBypassActive = game\.moveXBypassActive \|\| \{\};\s*\n\s*game\.moveXBypassActive\[msgId\] = true;/,
        'every freeMoveBonus grant must set moveXBypassActive[msgId] — CRR-MOVE-017');
    }
  });

  it('017b: source — movement.js profile-setup branches read moveXBypassActive and set ignoreFigureCost + ignoreDifficult', () => {
    const matches = [...MV_SRC.matchAll(
      /if \(game\.moveXBypassActive\?\.\[msgId\]\) \{\s*\n\s*\w+\.ignoreFigureCost = true;\s*\n\s*\w+\.ignoreDifficult = true;/g,
    )];
    assert.ok(matches.length >= 3,
      `expected at least 3 movement.js profile sites to wire moveXBypassActive; found ${matches.length} — CRR-MOVE-017`);
  });

  it('017c: source — moveXBypassActive is cleaned up per activation + per round', () => {
    assert.match(AS_SRC, /ACTIVATION_MSGID_FLAGS[\s\S]*?'moveXBypassActive'/,
      'moveXBypassActive must appear in ACTIVATION_MSGID_FLAGS — CRR-MOVE-017');
    assert.match(AS_SRC, /ROUND_OBJECT_FLAGS[\s\S]*?'moveXBypassActive'/,
      'moveXBypassActive must appear in ROUND_OBJECT_FLAGS — CRR-MOVE-017');
  });
});
