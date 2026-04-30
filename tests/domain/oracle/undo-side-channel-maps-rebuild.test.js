/**
 * UNDO-SIDE-CHANNEL-MAPS-REBUILD: handleUndo must repopulate the
 * module-scoped side-channel Maps (dcMessageMeta, dcExhaustedState,
 * dcHealthState) after restoring a game snapshot.
 *
 * Why this matters:
 *
 *   - pushUndo snapshots `JSON.stringify(game)` (excluding undoStack). The
 *     Maps are module-scoped, not part of the game object — they are NOT
 *     captured in the snapshot.
 *   - Without rebuild, after undo the game object holds pre-action HP /
 *     activation state, but the Maps still hold POST-action values. The
 *     UI reads the Maps, so the player sees stale "exhausted" / "damaged"
 *     state — a CRR-visible drift.
 *   - The Resync button hit this same class and got the
 *     repopulateDcMapsForGame(gameId) treatment. Undo needs the same.
 *
 * This test pins:
 *   - handleUndo imports and calls repopulateDcMapsForGame after the
 *     snapshot-restore block.
 *   - The call sits inside the snapshot-restore branch (so it fires
 *     whenever there's actually a snapshot to restore).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SRC = readFileSync(resolve(ROOT, 'src/handlers/game-tools.js'), 'utf8');

describe('UNDO-SIDE-CHANNEL-MAPS-REBUILD: handleUndo rebuilds module-scoped Maps after snapshot restore', () => {
  it('game-tools.js imports repopulateDcMapsForGame from game-state', () => {
    assert.match(SRC,
      /import\s*\{\s*repopulateDcMapsForGame\s*\}\s*from\s*['"]\.\.\/game-state\.js['"]/,
      'must import repopulateDcMapsForGame');
  });

  it('handleUndo calls repopulateDcMapsForGame INSIDE the snapshot-restore branch', () => {
    // Locate the `if (last.snapshot) { ... }` block in handleUndo.
    const fn = SRC.match(/export async function handleUndo\(interaction, ctx\) \{[\s\S]*?^}/m);
    assert.ok(fn, 'handleUndo body must be locatable');
    const body = fn[0];
    // The call must appear inside the snapshot-restore branch — same scope
    // where Object.assign(game, last.snapshot) happens.
    const restoreBlock = body.match(/if \(last\.snapshot\) \{[\s\S]*?Object\.assign\(game, last\.snapshot\);[\s\S]*?repopulateDcMapsForGame\(gameId\);/);
    assert.ok(restoreBlock,
      'repopulateDcMapsForGame(gameId) must be called inside the snapshot-restore branch, after Object.assign — otherwise the Maps stay at post-action values');
  });

  it('repopulate call is wrapped in try/catch (failure during rebuild should not blow up the undo flow)', () => {
    // Defensive: a Map-rebuild failure should be logged and skipped, not
    // crash the entire undo handler — the game state restore has already
    // succeeded by that point.
    assert.match(SRC,
      /try \{\s*\n\s*repopulateDcMapsForGame\(gameId\);\s*\n\s*\} catch \(err\) \{/,
      'repopulate call must be wrapped in try/catch with error logged');
  });
});
