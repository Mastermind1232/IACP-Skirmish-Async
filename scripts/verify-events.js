#!/usr/bin/env node
/**
 * CLI tool to verify domain events match actual game state.
 * Usage: node scripts/verify-events.js <gameId>
 */

import { verifyGameEvents } from '../src/domain/event-verifier.js';
import { initDb } from '../src/db.js';
import { loadGames, getGame } from '../src/game-state.js';

const gameId = process.argv[2];
if (!gameId) {
  console.error('Usage: node scripts/verify-events.js <gameId>');
  process.exit(1);
}

async function main() {
  await initDb();
  await loadGames();

  console.log(`[verify] Verifying events for game: ${gameId}`);

  const result = await verifyGameEvents(gameId, getGame(gameId) || {});
  if (result.match) {
    console.log('[verify] MATCH — replayed state equals actual state');
  } else {
    console.log(`[verify] MISMATCH — ${result.mismatches.length} differences found:`);
    for (const m of result.mismatches.slice(0, 20)) {
      console.log(`  ${m.key}: replayed=${JSON.stringify(m.replayed)?.slice(0, 80)} actual=${JSON.stringify(m.actual)?.slice(0, 80)}`);
    }
  }
  process.exit(result.match ? 0 : 1);
}

main().catch(err => {
  console.error('[verify] Fatal:', err.message);
  process.exit(2);
});
