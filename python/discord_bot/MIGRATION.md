# Node → Python Migration Guide

How to cut the Railway deployment from the Node.js bot (`src/`, `index.js`)
to the Python bot (`python/discord_bot/`).

## Prerequisites

- **Same Discord application** — token + slash-command registration carry
  over; no Discord-side changes needed.
- **Same Postgres** — schema is byte-identical (`games.game_id` PK,
  `games.game_data` JSONB, plus the domain_events / snapshots tables
  the JS side writes but the Python side ignores for now).

## Deploy switchover

1. Push this branch to the Railway-connected GitHub repo.
2. In the Railway service settings, swap the start command:
   - From: `node index.js`
   - To:   `python -m python.discord_bot`
3. Ensure these env vars are set on the service:
   - `DISCORD_BOT_TOKEN` (carried over from the Node service)
   - `DATABASE_URL` (carried over from the Postgres plugin)
4. Redeploy. The Python bot will pick up existing live games from the
   `games` table verbatim and start handling button clicks.

## Rollback

Set the start command back to `node index.js`. Python doesn't mutate
the JS-side event tables (`domain_events`, `completed_games`,
`coverage_incidents`, etc.), so they stay intact across the switch.

## What the Python bot DOESN'T do yet

- `completed_games` inserts on game-over (stat history for
  `/profile`-style commands).
- `achievement_defs` / `user_achievements` writes.
- `domain_events` / `game_snapshots` — JS writes, Python ignores on
  read.
- Rich board images (JS uses Canvas with real map backgrounds; Python
  uses a basic PIL renderer).
- Some button handlers (~55 ported) — not every edge-case dialog is
  migrated. Unhandled button customIds return
  `{ok: False, reason: 'no_handler'}` and the bot logs a warning but
  doesn't crash.

## Verification

Before flipping production:

1. **Dry-run test server** — create a Railway environment with the
   Python start command pointed at a test Discord guild + disposable
   Postgres. Play a full game end-to-end.
2. **Staging mirror** — run both Node + Python against the same DB,
   with the Python bot as a *second* Discord application listening
   on the same guild. Compare game-state behavior side-by-side for 24h.
3. **Live cutover** — after the dry-run + mirror pass, stop the Node
   service, swap start command, redeploy.

## Known Python-side gotchas

- CC decks default to a "generic Any Figure" pool when the squad
  doesn't supply `ccCards` — user-selected decks via `/squad` work,
  but historical games without ccCards get auto-seeded on first load.
- Multi-figure group activation in the stepper uses `perFigureMp` per
  figure. JS writes a single `movementPoints` field. Python reads
  both with perFigureMp as the override; JS reads only
  movementPoints. Cross-boot compatibility works as long as games
  complete their current activation in one engine at a time.
