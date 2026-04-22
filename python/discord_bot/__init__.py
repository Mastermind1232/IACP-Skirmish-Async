"""Phase 12 Discord UI port — discord.py-based bot adapter over the headless stepper.

Package layout mirrors src/ on the JS side:
  main.py       ← src/index.js           bot bootstrap, slash commands
  router.py     ← src/router.js          customId prefix dispatch
  context.py    ← src/context-factory.js per-handler DI
  handlers/     ← src/handlers/*.js      per-domain button handlers
  components/   ← src/discord/           button/embed builders
  messages/     ← src/engine/            message-update state machines
  db.py         ← src/db.js              game persistence

The Discord layer is a thin adapter over python/engine/stepper.py:
button click → parse customId → build Action → step(game, action) →
render response.
"""
