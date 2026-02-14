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
- **Triggered / interrupt** timings (e.g. `whenHostileFigureEntersAdjacentSpace`, `whenCommandCardPlayed`) — Require specific triggers; not yet supported from the generic Play CC flow. May be added in a later pass.

## Implementation

- **`src/game/cc-timing.js`**: `getCcPlayContext(game, playerNum)`, `isCcPlayableNow(game, playerNum, cardName)`, `getPlayableCcFromHand(game, playerNum, hand)`.
- **Hand Play**: `handleCcPlay` builds the select menu from `getPlayableCcFromHand(...)`; if none, replies that no cards can be played right now. `handleCcPlaySelect` validates with `isCcPlayableNow` and rejects if the card is no longer legal.
