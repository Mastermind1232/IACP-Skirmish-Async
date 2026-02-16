# Command Card timing (F5)

Command Cards can only be played when the game is in the correct **timing** window. Each CC in `data/cc-effects.json` has a `timing` field. The bot enforces timing when playing from hand (Play CC button).

## Play sources

1. **From Hand (Play CC)** — Player clicks Play CC in their Hand channel and selects a card. Timing is **enforced**: only cards whose `timing` matches the current game context can be selected or played.
2. **Special Action (from DC)** — Player uses the CC Special button on a Deployment Card. Only cards with `timing: "specialAction"` (or `doubleActionSpecial`) are offered there; those are **not** playable from the Hand Play flow.

## Game context (what the bot tracks)

| Context | When it's true |
|--------|-----------------|
| **startOfRound** | Round has started (round message sent) and "End Activation Phase" has not yet been shown. |
| **duringActivation** | It is this player's activation turn (`currentActivationTurnPlayerId`). |
| **endOfRound** | We're in the End of Round window and it's this player's turn (`endOfRoundWhoseTurn`). |
| **duringAttack** | An attack is in progress (`game.combat` or `game.pendingCombat`). |
| **isAttacker / isDefender** | During an attack, this player is the attacker or defender. |

## Supported timings (from Hand)

Cards with these `timing` values are considered playable when the matching context is true:

| timing value | Required context |
|--------------|------------------|
| `startOfRound`, `startOfStatusPhase` | startOfRound |
| `duringActivation`, `startOfActivation`, `endOfActivation` | duringActivation |
| `endOfRound` | endOfRound |
| `duringAttack` | duringAttack |
| `whileDefending`, `whenAttackDeclaredOnYou` | duringAttack + isDefender |
| `beforeYouDeclareAttack`, `whenYouDeclareAttack` | duringActivation |
| `afterAttack`, `afterAttackDice`, `afterAttackTargetingYouResolved` | duringAttack (or isDefender where relevant) |

## Not playable from Hand

- **specialAction**, **doubleActionSpecial** — Played only via the DC Special Action button.
- **other** — Not mapped to a context; treated as not playable from Hand.
- **Triggered / interrupt** timings (e.g. `whenHostileFigureExitsAdjacentSpace`, `whenHostileFigureEntersAdjacentSpace`, `whenCommandCardPlayed`) — Require specific triggers; not yet supported from the generic Play CC flow. See "Interrupt / trigger windows" below.

## Interrupt / trigger windows (Parting Blow and similar)

Cards like **Parting Blow** ("Interrupt when a hostile figure **exits** an adjacent space. Before that figure moves, perform an attack…") have a timing window that is **inside** another action (e.g. during the opponent's move). FFG rules treat the effect as happening "before" the trigger (so no literal rewind if the game is paused at the right moment).

**Intended approach (v2, ~honor system then harden):**

1. **Hold at the window** — When the active player commits a move (e.g. picks destination), **before** applying the move:
   - If the move would cause a hostile figure to **exit** a space adjacent to the **opponent's** figure(s), and the opponent has a card like Parting Blow in hand (and any card-specific checks: e.g. BRAWLER, not Stunned), the bot **pauses** and pings the opponent: "Parting Blow window — [Play] [Pass]".
   - If they choose Play, resolve the attack (and Stun), then either complete or cancel the original move as per rules.
   - If they choose Pass (or don't have the card), apply the move as normal.
   - No undo/rewind is needed if we never advance past the window.

2. **Avoid skip-reveal** — Only hold when necessary (e.g. opponent has a relevant card in hand, or has opted in for "prompt for this timing"). Otherwise skipping through the window would reveal information (MTG Arena–style).

3. **Optional: pre-set conditions** — Let a player set a condition at start of round or when holding: "If hostile X moves out of my adjacent space this activation, offer Parting Blow (or auto-play)." Reduces repeated prompts; bot still only offers when the condition is met.

4. **Optional: start-of-round opt-in** — "Do you want to be prompted for Parting Blow (and similar) this round? [Hold at window] [Ignore]." Cuts down prompts when the player doesn't care.

**Current state:** These timings are not wired. Parting Blow (`whenHostileFigureExitsAdjacentSpace`) falls through to `default` in `isCcPlayableNow` and is never offered. Implementation will require a movement flow that: (a) knows "move from A → B" before applying it, (b) checks "exiting space adjacent to opponent's figure" and "opponent has PB in hand" (or opt-in), (c) sends the ping and waits for [Play] / [Pass], then (d) applies move or resolves PB then move.

## Implementation

- **`src/game/cc-timing.js`**: `getCcPlayContext(game, playerNum)`, `isCcPlayableNow(game, playerNum, cardName)`, `getPlayableCcFromHand(game, playerNum, hand)`.
- **Hand Play**: `handleCcPlay` builds the select menu from `getPlayableCcFromHand(...)`; if none, replies that no cards can be played right now. `handleCcPlaySelect` validates with `isCcPlayableNow` and rejects if the card is no longer legal.
