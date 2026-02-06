# Command Card Data Conventions

When entering Command Card effects in `cc-effects.json` (via the review tool or editor):

## Effect text

- **Use full card text** — Type out the complete effect as printed on the card.
- **Traits in ALL CAPS** — Put trait keywords in all caps so they stand out and are easy to spot. Examples:
  - WOOKIES
  - Hunter
  - Droid
  - Rebel
  - Imperial
  - Leader
  - Elite
  - Trooper

This makes it clear which words reference traits vs. plain English, and helps with future parsing or tooling.

## Timing window implementation (future)

When building logic that checks CC timing windows (or timing windows tied to DC triggers on the field):

- **Only consider a CC’s timing** if that CC is **in hand** (or otherwise playable at that moment). Do not evaluate timing for command cards that are in the deck, discarded, or not in the game.
- **Only consider a DC’s trigger/timing** if that **DC is on the field** (deployed and in play). For example, Agent Blaise’s card timing does not need to be checked if he is not in the game, or his associated CC is not in hand.

So: CC timing windows should only be checked when the CC is in hand; DC-correlated timing/triggers should only be checked when the DC in question is on the field.

## Unique deployment / figure (for card effects)

For the purposes of **all** card effects (CC and DC), a deployment card is considered **unique** if:

1. There is only **one copy** of that DC in the deck, and  
2. That DC has only **one figure** in its deployment group (DG).

Use this definition whenever an effect refers to a “unique figure”, “unique hostile figure”, “non-unique figure”, or similar.
