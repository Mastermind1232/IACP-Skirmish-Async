# Discord Server Structure for IACP Skirmish Async

## TI4 Async Inspiration

From the [AsyncTI4 GitHub](https://github.com/AsyncTI4/TI4_map_generator_bot):

**Multi-server setup:**
- **Primary Hub** — LFG, discussion, main entry point
- **Overflow servers** — When the hub fills, new games are created on overflow servers (Stroter's Paradise, Dreadn't, War Sun Tzu, etc.)
- **Variant servers** — Fog of War, Community Plays (team-based), Tournament server — each on its own guild
- Bot connects to 15+ servers via startup args; each has its own Admin/Developer/Bothelper role IDs

**Categories:** Games live in categories named `PBD #` (Play By Discord). Bot scans all guilds for categories matching `PBD #*` to find active games. `CategoryCleanupCron` removes stale/empty categories.

**Channels:**
- `bot-log` — Required; bot posts startup, errors, debug. Can split into `bot-log-info`, `bot-log-warning`, `bot-log-error`
- Game content lives in channels under the PBD category (one category per game, channels inside for map/state)

**Roles:** Admin, Developer, Bothelper — whitelisted by role ID per server. Admins get `/admin`, developers get `/developer`, bothelpers get `/bothelper` (e.g. `list_buttons`, spoof buttons for testing).

**Other:** Slash commands (`/game swap`, etc.), Cron jobs for auto-ping, end old games, close launch threads, reupload emojis. Uses webhook for bot-log if channel not found. Images uploaded to S3/CloudFront, served to a separate website.

---

## Recommended Layout (IACP Skirmish)

### Category: 📢 General
| Channel | Purpose |
|---------|---------|
| `#announcements` | Server news, bot updates, IACP season changes |
| `#rules-and-faq` | How to play async, LFG etiquette, links to IACP docs |
| `#general` | General chat, questions, community |

### Category: 🎮 Looking for Game (LFG)
| Channel | Purpose |
|---------|---------|
| `#lfg` | Chat and discussion. People can talk, ask questions. |
| `#new-games` | **Forum channel.** Each post = one game lobby. Creator posts "Looking for game" → others join via button/reply → when both players are in, **Start Game** button appears → creates the game channel. |
| `#active-games` | Bot posts summaries / links to active games (optional). |

### Category: ⚔️ Games
*(One category per game, e.g. `IA #00001`. When **Start Game** is pressed, bot creates the category and channels below. When game ends, category moves to Archived.)*

| Channel | Purpose | Visibility |
|---------|---------|------------|
| `IA00001 Game Log` | Bot posts game actions, setup messages, round updates | Both |
| `IA00001 General chat` | Discussion, questions | Both |
| `IA00001 Board` | Map + figures, regenerated after each action (like TI4 map tool) | Both |
| `IA00001 Player 1 Hand` | Command cards | Private (P1 only) |
| `IA00001 Player 1 Play Area` | Deployment cards, readied vs exhausted | Both |
| `IA00001 Player 2 Hand` | Command cards | Private (P2 only) |
| `IA00001 Player 2 Play Area` | Deployment cards, readied vs exhausted | Both |

### Category: 🛠️ Bot / Admin (optional)
| Channel | Purpose |
|---------|---------|
| `#bot-logs` | Game errors (message + game ID + optional jump link). The bot @mentions the **Bothelpers** role (by name) on each error; create a role named "Bothelpers" so the team gets notified. |
| `#statistics` | **Stats commands only.** Use `/statcheck`, `/affiliation`, `/dcwinrate` here. Results are from the `completed_games` table (games that have ended). |
| `#bot-requests-and-suggestions` or `#bot-feedback-and-requests` | **Forum.** Feature requests, bug reports. First message in a thread gets **IMPLEMENTED** / **REJECTED** buttons; admins use them to set the thread title to `[IMPLEMENTED]` or `[REJECTED]`. |

---

## How It Works

1. **LFG:** `#lfg` = chat. `#new-games` (Forum) = game finding.
2. **Create lobby:** Player creates a new post in `#new-games` (or bot creates one when they click Create Game from `#lfg`). Post = pre-game lobby.
3. **Join:** Second player joins via button or reply in the post. Bot detects when both players are in.
4. **Start Game:** Once both in, bot shows **Start Game** button. Both (or creator) presses it → bot creates game category (IA #XXXXX) with General chat, Board, and per-player Hand + Play Area channels.
5. **Game:** Board channel = map + figures (regenerated on actions). General chat = discussion. Hand channels = private Command cards. Play Area channels = Deployment cards (readied/exhausted), visible to both.
6. **Game end:** Game category moved to Archived.

---

## Permissions Summary

| Approach | Bot Permissions |
|----------|-----------------|
| **Bot creates structure** | Manage Channels, Manage Threads, Send Messages, Embed Links, Attach Files, Use External Emojis, Mention Everyone (for turn pings), Read Message History |
| **You create structure** | Send Messages, Embed Links, Attach Files, Create Public Threads, Send Messages in Threads, Read Message History |

---

## Setup Steps

**If you create channels manually:**
1. Create the categories and channels above.
2. Set `#lfg` as the main place for `play` / `skirmish` commands.
3. Ensure the bot can read/send in `#lfg` and create threads in the Games area.
4. Re-invite the bot with **Create Public Threads** and **Send Messages in Threads** if you haven’t already.

**If the bot creates structure:**
1. Re-invite the bot with **Manage Channels** and **Manage Threads**.
2. Add a setup command (e.g. `play setup`) that creates the categories/channels if they don’t exist.
