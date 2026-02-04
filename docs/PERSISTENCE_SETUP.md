# Game persistence (PostgreSQL)

Game state is saved so it survives bot restarts and redeploys.

## Testing persistence

### 1. Quick DB test (before going live)

```bash
# Locally with your Railway DATABASE_URL (use the *public* URL from Railway's Variables tab, not the internal one)
DATABASE_URL="postgresql://..." node scripts/test-db-connection.js
```

You should see: `✅ Success! Database read/write works.`

### 2. Live test (after deploy)

1. Create a game and play a few steps (e.g., select map, submit squads, deploy a figure).
2. Note which game you're in (channel name or game number).
3. **Redeploy** the bot (push to git or click Deploy in Railway).
4. After redeploy, go back to that game and click a button (e.g., in Board or Hand).
5. If it works (no "Game not found"), persistence is working.

Also check Railway logs after redeploy for:
```
[DB] PostgreSQL connected, games table ready.
[Games] Loaded X game(s) from PostgreSQL.
```

## What gets persisted

The bot saves the **entire game object** for each active game. This was already designed for file-based persistence—we simply swapped the backend to Postgres. The same data that used to go into `data/games-state.json` now goes into the database.

On load, the bot rebuilds the in-memory Maps (`dcMessageMeta`, `dcExhaustedState`, `dcHealthState`) from the game objects via `repopulateDcMapsFromGames()`. So all game state (map, mission, deployments, health, hand, deck, phase, round, initiative, etc.) is captured.

---

## On Railway

1. **Add PostgreSQL** to your project:
   - In your Railway project, click **New** → **Database** → **PostgreSQL**
   - Railway creates a Postgres service and usually adds `DATABASE_URL` to your bot service automatically

2. **If `DATABASE_URL` is not set** on your bot service:
   - Open your **bot service** (the one running the Discord bot)
   - Go to **Variables**
   - Add a variable: `DATABASE_URL`
   - Set it to **Reference** the Postgres service’s `DATABASE_URL`, or copy the value from the Postgres service’s Variables tab

3. **Redeploy** the bot so it picks up the new variable.

The bot will then load and save games to Postgres instead of a file.

## Locally (no Postgres)

If `DATABASE_URL` is not set, the bot uses `data/games-state.json` for storage. Nothing else to configure.
