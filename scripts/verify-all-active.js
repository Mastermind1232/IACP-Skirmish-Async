#!/usr/bin/env node
/**
 * Verify domain events match actual game state for all active games.
 * Usage: node scripts/verify-all-active.js
 */

import { verifyGameEvents } from '../src/domain/event-verifier.js';
import { initDb } from '../src/db.js';
import { loadGames, getGamesMap } from '../src/game-state.js';

async function main() {
  await initDb();
  await loadGames();

  const gamesMap = getGamesMap();
  const gameIds = [...gamesMap.keys()];

  if (gameIds.length === 0) {
    console.log('[verify-all] No active games found.');
    process.exit(0);
  }

  console.log(`[verify-all] Checking ${gameIds.length} active games...`);

  let checked = 0;
  let mismatched = 0;

  for (const gameId of gameIds) {
    const game = gamesMap.get(gameId);
    try {
      const result = await verifyGameEvents(gameId, game || {});
      checked++;
      if (!result.match) {
        mismatched++;
        console.log(`[verify-all] MISMATCH game ${gameId}: ${result.mismatches.length} differences`);
        for (const m of result.mismatches.slice(0, 5)) {
          console.log(`  ${m.key}: replayed=${JSON.stringify(m.replayed)?.slice(0, 60)} actual=${JSON.stringify(m.actual)?.slice(0, 60)}`);
        }
      }
    } catch (err) {
      console.error(`[verify-all] ERROR game ${gameId}: ${err.message}`);
      checked++;
      mismatched++;
    }
  }

  console.log(`[verify-all] Summary: ${checked} checked, ${mismatched} mismatches`);
  process.exit(mismatched > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('[verify-all] Fatal:', err.message);
  process.exit(2);
});
