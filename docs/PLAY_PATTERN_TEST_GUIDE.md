# Play pattern test guide (Discord)

**Purpose:** One place for **what to test in Discord** and **how to give feedback** so we keep play patterns solid and UX consistent. Testing in the real bot (with real buttons, channels, latency) is the right place to feel out the flow.

---

## Yes: previous wired CCs are still there

All **already-wired** flows are unchanged:

- **Choice from list** (Blaze of Glory, De Wanna Wanga, Smuggled Supplies, Retaliation, etc.): still use `requiresChoice` → buttons → `handleCcChoice` with `chosenOption`. No code path was removed or replaced.
- **Immediate apply** (Focus, Cut Lines, draw cards, MP, etc.): still use `result.applied` and never hit the new `requiresSpaceChoice` branch.
- **Pick a space** was **added** as a new branch and new handler (`cc_space_*`); it only runs when a card returns `requiresSpaceChoice` + `validSpaces` (e.g. Smoke Grenade).

So: **existing wired CCs behave as before.** When in doubt, do a quick smoke test in Discord (e.g. play Blaze of Glory → choose a DC → confirm it readies; play a simple draw card → confirm it draws).

---

## Flow: test in Discord → feedback → iterate

1. **We add or change a pattern** (or wire a card to a pattern).
2. **You test in Discord** using testgame (and, if we add them, scenario presets).
3. **You give feedback** in a simple format (see below). You’re the playtester; your “this felt wrong” or “buttons were unclear” is exactly what we need.
4. **We adjust** (copy, layout, order of steps, or pattern design) and you re-test as needed.

That loop is the main way to **define** the Discord play patterns in practice: the doc describes the contract; your testing and feedback shape whether the contract is right and how it feels.

---

## One scenario per pattern (not per card)

**You do not test every single CC and DC.** Tests are by **pattern** (and timing/effect shape). One scenario validates a pattern; every card that uses that pattern is covered by that same test.

- **smoke_grenade** = pick-a-space pattern. Validates Smoke Grenade, and any other card that uses "choose a space" (e.g. Cloned Reinforcements, Force Push, Jump Jets) uses the same flow.
- **blaze** (when we add it) = choice-from-list pattern. Validates Blaze of Glory, De Wanna Wanga, Smuggled Supplies, Retaliation, etc.
- **combat_roll** = combat resolve. Validates the combat flow for all attacks.
- **move_pick** = movement destination. Validates movement for all figures.

So we add a **small number of scenarios** (one per pattern or per distinct flow). That splashes across many cards with similar timing and effects.

---

## Minimal playable (target)

A game is **minimally playable** when these flows work in order:

1. Setup (map, squads, deploy, draw hands)
2. Round start (initiative, activations message)
3. Activate a DC
4. Move (pick space)
5. Attack + resolve (declare, roll, damage)
6. Play one CC (choice or space or immediate)
7. End round (ready DCs, draw, next round)

We build **one scenario per flow** (or per critical moment) so we can test each step without playing a full game.

---

## Scenario backlog (ordered)

| # | Scenario ID | Pattern / flow | Cards covered |
|---|-------------|----------------|----------------|
| 1 | smoke_grenade | Pick a space (CC) | Smoke Grenade, Cloned Reinforcements, Force Push, Jump Jets, etc. |
| 2 | blaze | Choice from list (CC) | Blaze of Glory, De Wanna Wanga, Smuggled Supplies, Retaliation, etc. |
| 3 | combat_roll | Combat resolve | All attacks |
| 4 | move_pick | Movement destination | All moves |
| 5 | (TBD) | End round, etc. | — |

**How to run a scenario (recommended: Discord #lfg):**

Type in **#lfg**: `testgame smoke_grenade` (or `testgame blaze`, etc.). The bot **skips setup entirely** — map, decks, deploy, and draw are all applied automatically. You land straight in Round 1 with the scenario state ready: for `smoke_grenade`, P1 already has Smoke Grenade in hand, figures deployed, activation phase started. Go to your **Hand channel**, **activate a DC** in your Play Area, then **play Smoke Grenade** to test the pick-a-space flow.

Type **`testready`** in #lfg to get a **random scenario** with `status: "testready"` — useful for checking scenarios off one by one.

Type `testgame` (no scenario) for a normal test game where you pick map and decks manually.

*Optional (local only):* If the bot is running locally and `DISCORD_GUILD_ID` is set, you can also trigger creation via `POST http://127.0.0.1:3999/testgame` with body `{ "scenarioId": "smoke_grenade" }`. Not needed when using the bot on Railway.

---

## How to test each pattern (in Discord)

Use **testgame** (type `testgame` or `testgame smoke_grenade` etc. in #lfg). With a scenario, your hand/state is seeded so you can trigger the flow quickly; without one, play normally until you can test the pattern.

### Pattern 1: Choice from list (buttons)

- **Get there:** Start a round, have a CC that needs a choice (e.g. **Blaze of Glory**, **De Wanna Wanga**, **Smuggled Supplies**). Play it from hand.
- **Check:** You get a message “Choose one (for **Card Name**):” with **buttons** (one per option). Click one; the effect resolves and the choice message is cleared/replaced.
- **Things to notice:** Are labels clear? Too many buttons / too cramped? Wrong channel?

### Pattern 2: Pick a space (grid + map)

- **Get there:** During **your activation**, play **Smoke Grenade** from hand (must be in hand; play it as a Special or when the bot allows). You should get “Pick a space (for **Smoke Grenade**):” with **space buttons** and a **map image** (zoomed to valid spaces).
- **Check:** Buttons are coords (e.g. A1, B2). Map shows the same spaces. Click a space; the effect completes and the message updates.
- **Things to notice:** Is the map useful or redundant? Are space labels in a sensible order? Too many rows?

### Pattern 3: Pick a figure / target (buttons by name)

- **Get there:** Play something that needs a target (e.g. **New Orders** when you have an adjacent friendly; **Expose Weakness** when you have an adjacent hostile). If the handler supplies `choiceOptions`, you get buttons with figure/DC names.
- **Check:** Buttons show the right targets. Click one; effect applies to that target.
- **Things to notice:** Are names clear? Missing or wrong targets?

### Pattern 4: Informational / log only

- **Get there:** Play **Collect Intel** (or similar).
- **Check:** A log message appears; no buttons. No game state change.

---

## Feedback template (paste back after testing)

Use this (or a short version) when you test so we can iterate quickly:

```
**Tested:** [pattern name or card name]
**What I did:** [e.g. "testgame → map → default decks → R1 → played Blaze of Glory from P1 hand"]
**Worked:** [what was good]
**Didn't work:** [bugs, wrong channel, missing buttons, etc.]
**UX note:** [confusing label, too many clicks, would prefer X]
```

You don’t have to fill every line; even “Tested Smoke Grenade – map didn’t load” or “Blaze buttons were clear” is enough.

---

## Optional: testgame scenario presets

Right now `testgame` creates a blank game; you do map → decks → play until you reach the scenario you want.

We can add **scenario presets** so you can jump to a specific flow faster, for example:

- `testgame` — current behavior (blank game).
- `testgame cc_choice` — after creation, P1 hand is seeded with e.g. Blaze of Glory (or a deck that has it) and game is advanced so you can play it in one round.
- `testgame cc_space` — P1 hand has Smoke Grenade, game is in a round with an active activation so playing Smoke Grenade immediately shows the space grid + map.

Implementation sketch: when `message.content` is `testgame cc_choice` or `testgame cc_space`, after creating the game we’d set something like `game.testScenario = 'cc_choice'` and then, after map selection and squad submit (or default deck), a small “scenario apply” step would seed hand and/or phase so the next action is the one we want to test. We can add these one by one as we add patterns or cards.

If you’d like this, we can add one preset first (e.g. `testgame cc_choice`) and you try it in Discord; then we add more based on what you test most.

---

## Brainstorm: You vs Bot + Jump to moment

Two ideas that make the feedback loop even tighter:

### 1. Testgame = you (P1) vs bot (P2)

- **Idea:** Spin up a game with **you as Player 1** and **the Discord bot as Player 2** (your opponent).
- **Why:** Feels more like a real game; you only think as P1; the bot can do the minimum as P2 so the scenario reaches the moment we care about (e.g. bot passes activation so it's your turn to play a CC).
- **What "bot as P2" could mean:**
  - **Minimal:** P2 is a dummy — channels and deck exist, but no one clicks. You can open P2's hand and click as them if you want. (Same as today, framed as "vs bot" with P2 idle.)
  - **Scenario automation:** For a given scenario, the bot has a tiny script: e.g. after channels are ready, the bot (as P2) auto-clicks Pass / End Turn so it becomes P1's activation. You don't have to click P2's buttons to get to the test moment.
  - **Full bot opponent:** Bot plays cards, attacks, moves. Much bigger; not required for pattern testing.

For pattern testing, **scenario automation** (bot does minimal clicks to get to the right state) is the sweet spot.

### 2. Scenario = jump right to the moment

- **Idea:** A scenario doesn't start at "blank game, pick map, pick decks." It **jumps to a point in time**: map set, figures deployed, round 1, P1 has Smoke Grenade in hand and an activation in progress. You open the game and the next thing you do is "Play Smoke Grenade" → space grid + map. One click to the flow we're testing.
- **Why:** No setup clicking; instant feedback. Test five variants in 10 minutes.
- **Implementation sketch:** A scenario definition (e.g. `scenarios/smoke_grenade.js` or JSON) that sets `selectedMap`, `player1CcHand`, `figurePositions`, `currentRound`, `dcActionsData`, etc. When you type `testgame smoke_grenade`, we create channels then **apply that state**. We may need to create DC messages, hand messages, and a "Round 1 — your activation" message so the UI looks right. First scenarios: `testgame smoke_grenade`, `testgame blaze`, `testgame combat_roll`, etc.

### 3. Instant feedback: thumbs up / thumbs down + tips

- Quick verdict (thumbs up/down in Discord or short message) plus optional tips. Thumbs up = ship it; thumbs down = we ask for one sentence or you paste the feedback template. Optional: a #testgame-feedback thread where we log "Scenario: X. Result: 👍/👎. Notes: …"

**Combined:** `testgame <scenario>` → you vs bot (or you-both), **jump to the moment**, you take one or two actions to trigger the pattern, then **thumbs up/down + tips**. That's the tight loop.

---

## Is this the best flow?

Yes, for **defining and validating** Discord play patterns:

- **Unit tests** = “Does the logic (e.g. validSpaces, resolveAbility) do the right thing?”
- **Discord + you** = “Does the flow feel right? Are the right things in the right place? Do we need to change the pattern?”

So: **build → you test in Discord → you give feedback → we refine** is the right loop. The doc and patterns are the contract; your testing and feedback close the loop and keep the patterns actually playable and consistent.

---

## What's missing to make the flow better (and reach the endgame)

Endgame: **rock-solid, fully playable async Skirmish in Discord**, with consistent patterns and a tight test → feedback loop. Gaps and best path:

### Gaps to fill

1. **Minimal playable definition** — No single checklist yet: "A game is playable when these flows work." **Add:** Short list of flows that form one playable loop (e.g. setup → round start → activate → move → attack → resolve → one CC play → end round). Then we build one scenario per flow in that order.

2. **Scenario priority = path to playable** — Which jump-to-moment scenarios first should follow that path. **Add:** A scenario backlog (e.g. 1. smoke_grenade, 2. blaze, 3. combat_roll, 4. move_pick). Next scenario we implement = next step toward playable.

3. **Definition of done per scenario** — When is a scenario done? **Add:** One sentence per scenario, e.g. "User runs testgame smoke_grenade, sees grid + map, clicks space, gets success; thumbs up." Exit criterion before moving on.

4. **Discord state for jump-to-moment** — Jumping needs Discord state (hand message, DC embeds, round message), not just game state. **Add:** Per scenario: "Messages that must exist." One helper that creates/updates those messages from scenario game state so the UI isn't empty.

5. **One place for feedback** — Thumbs up/down and tips must live somewhere. **Add:** One of: #testgame-feedback channel, thread per testgame, or a `feedback 👍 smoke_grenade` style command that logs. Use it every time.

6. **Regression check** — After code changes, know we didn't break a scenario. **Add:** One-line manual checklist: "After big changes, run scenario X (and Y if time)."

7. **Bot P2 behavior per scenario** — Be explicit what the bot does as P2. **Add:** Small table: Scenario → Bot P2 actions (e.g. smoke_grenade: none; combat_roll: click Roll Defense when prompted). Keeps automation minimal.

### Best path to the endgame

1. **Lock minimal playable** — One list: playable = setup + [these N flows] in order. That's the target.
2. **Scenario backlog from that list** — One jump-to-moment scenario per flow; order backlog by that. First scenario = first flow testable.
3. **Implement one scenario at a time** — Define game state + Discord messages → implement testgame &lt;id&gt; → you run and thumbs up/down → mark done when definition of done is met → next from backlog.
4. **Use the single feedback place** — Every test: verdict + optional note there. Iterate from that.
5. **Light regression** — After each (or every few) scenario, run through previous scenario(s).
6. **When all minimal-playable scenarios exist and are thumbs-up** — You have a defined playable loop and repeatable test. Then expand: more cards, more scenarios, optional bot P2 automation.

**Summary:** Define minimal playable → scenario backlog → build one scenario at a time with clear done + one feedback place → light regression. That's the best path to rock-solid, fully playable, with you as playtester.
