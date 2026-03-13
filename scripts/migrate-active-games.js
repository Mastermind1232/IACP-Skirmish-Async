/**
 * Migration script: snapshots all active games as version 0
 * into game_snapshots table, establishing the baseline for
 * event sourcing.
 *
 * Usage: node scripts/migrate-active-games.js
 */
import { loadGames } from '../src/game-state.js';
import { insertSnapshot } from '../src/db.js';

async function migrateActiveGames() {
  console.log('[migrate] Loading active games...');
  const games = await loadGames();

  if (!games || games.size === 0) {
    console.log('[migrate] No active games found.');
    return;
  }

  console.log(`[migrate] Found ${games.size} active game(s). Snapshotting...`);

  let migrated = 0;
  let errors = 0;

  for (const [gameId, gameState] of games) {
    try {
      // Strip transient fields before snapshotting
      const snapshot = structuredClone(gameState);
      delete snapshot.undoStack;
      delete snapshot.moveGridMessageIds;

      await insertSnapshot(gameId, 0, snapshot);
      migrated++;
      console.log(`[migrate] ✓ ${gameId}`);
    } catch (err) {
      errors++;
      console.error(`[migrate] ✗ ${gameId}: ${err.message}`);
    }
  }

  console.log(`[migrate] Done. Migrated: ${migrated}, Errors: ${errors}`);
}

migrateActiveGames().catch(err => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
