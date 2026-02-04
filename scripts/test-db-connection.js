#!/usr/bin/env node
/**
 * Quick test: Can we connect to Postgres and read/write?
 * Run: DATABASE_URL="your-url" node scripts/test-db-connection.js
 * Or with .env: node scripts/test-db-connection.js (loads dotenv)
 */
import 'dotenv/config';
import { isDbConfigured, initDb, loadGamesFromDb, saveGamesToDb } from '../src/db.js';

async function main() {
  if (!isDbConfigured()) {
    console.log('❌ DATABASE_URL is not set. Set it in .env or as an env var to test.');
    process.exit(1);
  }

  console.log('Connecting to PostgreSQL...');
  await initDb();

  const testId = '__test_persistence_' + Date.now();
  const testGame = { gameId: testId, test: true, createdAt: new Date().toISOString() };

  console.log('Loading existing games, adding test game...');
  const existing = await loadGamesFromDb();
  const games = new Map(Object.entries(existing));
  games.set(testId, testGame);
  await saveGamesToDb(games);

  console.log('Reading back...');
  const loaded = await loadGamesFromDb();
  if (loaded[testId]?.test) {
    console.log('✅ Success! Database read/write works. Test game stored and retrieved.');
  } else {
    console.log('❌ Failed: could not read back the test game.');
    process.exit(1);
  }

  // Clean up: remove test game only
  games.delete(testId);
  await saveGamesToDb(games);
  console.log('(Test game removed from DB)');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
