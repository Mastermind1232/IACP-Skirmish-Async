/**
 * Phase-D probe: "Move X spaces" grants MP but still obeys all
 * non-cost terrain and figure restrictions — the engine has no
 * Move-X-specific commit path; all MP (regardless of source) flows
 * through the same movementBank and the same `handleMovePick`
 * commit path, which validates against a single movementCache
 * that encodes terrain + figure restrictions.
 *
 * PROBE-PD-MOVE-018: CRR MOVEMENT — "'Move X spaces' still obeys
 *   all non-cost terrain and figure restrictions (e.g., cannot end
 *   in another figure's space)."
 *
 * Implementation:
 *   - Move-X grants deposit MP into `game.movementBank[msgId]`
 *     with the same shape used by native activation MP
 *     (`{ total, remaining, threadId, messageId, displayName }`) —
 *     see activation-setup.js:199, fast-forward.js:247,
 *     interrupts.js (Still Faster Than You +2 MP, Emergency Power
 *     +2 MP), dc-play-area.js (bonus MP grants), abilities.js
 *     (Junk Droid 4 MP). None of these writes set a terrain-bypass
 *     or figure-bypass flag on the bank entry.
 *   - The sole commit path `handleMovePick` in
 *     `src/handlers/movement.js` validates every move through the
 *     shared movementCache built by `computeMovementCache`, which
 *     applies terrain cost + impassable + figure-occupancy rules.
 *     `getMovementTarget(cache, target)` returns null (rejected)
 *     if the target is blocked by terrain or an occupant.
 *   - The only profile-level bypass (`ignoreBlocking`,
 *     `ignoreFigureCost`, `ignoreDifficult`) is set by Force
 *     Jump's `mobileMovementActive`, which is keyed by a
 *     DC-level ability flag — NOT by Move-X grants.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-MOVE-018: Move-X grants MP but commits via the same validated move path — terrain/figure restrictions still apply', () => {
  it('018a: source — handleMovePick is the sole commit path and validates each step via getMovementTarget(cache, ...) (rejects blocked/occupied spaces)', () => {
    assert.match(MV_SRC,
      /const targetInfo = getMovementTarget\(cache, targetLower\);\s*\n\s*if \(!targetInfo\) \{\s*\n\s*await interaction\.followUp\(\{ content: 'Destination not valid for the selected MP\.'/,
      'handleMovePick must reject destinations the movementCache considers invalid — CRR-MOVE-018');
  });

  it('018b: source — no movementBank write sets a terrain-bypass or figure-bypass flag (all MP sources obey terrain/figure restrictions)', () => {
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      const matches = [...src.matchAll(/movementBank\[[^\]]+\]\s*=\s*\{([^}]*)\}/g)];
      for (const m of matches) {
        const body = m[1];
        const rel = p.replace(ROOT + '/', '');
        assert.ok(!/ignoreBlocking|ignoreFigureCost|ignoreDifficult|ignoreTerrain|bypassTerrain|bypassFigure|ignoreRestrictions/i.test(body),
          `${rel} movementBank entry must not declare bypass flags (body: ${body}) — CRR-MOVE-018`);
      }
    }
  });

  it('018c: source — the only terrain/figure bypass on the movement profile comes from Force-Jump (mobileMovementActive), NOT from Move-X grants', () => {
    const lines = MV_SRC.split('\n');
    const bypassLines = [];
    lines.forEach((ln, i) => {
      if (/profile\.ignoreBlocking\s*=\s*true/.test(ln)) bypassLines.push(i);
    });
    assert.ok(bypassLines.length >= 1, 'expected at least one profile.ignoreBlocking assignment');
    for (const i of bypassLines) {
      const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      assert.match(window, /mobileMovementActive/,
        `profile.ignoreBlocking at line ${i + 1} must be gated by mobileMovementActive (Force Jump) — CRR-MOVE-018`);
    }
  });

  it('018d: source — no Move-X / bonus-MP site declares a separate commit handler (single commit path means single validation rule)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/handleMoveXCommit|commitMoveX|commitBonusMove|handleBonusMove/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may define a Move-X-specific commit handler — CRR-MOVE-018');
  });
});
