# Vassal Module Assets Catalog

Extracted from `Imperial_Assault_-_Skirmish_12.11.3.0.vmod` (IACP Season 11.3, Waves 1-11).

## Maps & Missions
~50 skirmish missions, each with a `.vsav` setup file. Examples:
- Chopper Base, Atollon (A/B)
- Corellian Underground (A/B)
- Lothal Wastes (A/B)
- ISB Headquarters (A/B)
- Temple Gardens (A/B)
- Training Ground (A/B)
- ...and more

Tournament-legal maps rotate per IACP season (see FFG support docs).

## Images (`vassal_extracted/images/`)

Images are organized into subfolders. Run `npm run organize-images` to sort existing files.

| Subfolder | Contents |
|-----------|----------|
| `cc/` | Command cards (C card--, IACP_C card--, etc.) |
| `dc-figures/` | Deployment cards with figures |
| `DC Skirmish Upgrades/` | Deployment cards without figures (Skirmish upgrades like [Zillo Technique]) |
| `figures/` | Circular figure tokens for map (Figure-Imperial--, etc.) |
| `tokens/` | Counters, mission tokens (Counter--Terminal, Mission Token--, etc.) |
| `maps/` | Map backgrounds (Map_*.gif) |
| `mission-cards/` | Mission cards (SkMission Card--*.jpg) |
| `conditions/` | Condition cards and markers (Condition card--*, Condition Marker--*) |
| `companions/` | Companion cards and tokens (Companion Card--*, Companion Token--*) |
| `cardbacks/` | All cardbacks (Command, Deployment, Companion, Mission, Shape, etc.) |
| `dice/` | Dice box, Dice Clear button, Dice Icon colors, Dice faces (Black/Blue/Green/Red/White/Yellow) |
| `dc-supplemental/` | Attachments, IACP Shape Cards, IACP Loadout Cards |

The bot checks subfolders first, then root, for backward compatibility.

## Game Structure (from buildFile.xml)
- **Player Hands** — 4 players (green, red, blue, yellow)
- **Deck types** — Command Cards (shuffled), Deployment Cards, Figures
- **Figure sizes** — 1x1, 1x2, 2x2, 2x3
- **Factions** — Imperial, Rebel, Mercenary, Neutral

## Files
- `buildFile.xml` — full Vassal module definition (~1.1M chars)
- `*.vsav` — map setup files (board layout, deployment zones)
- `sounds/` — 30 WAV files (dice, command cards, etc.)

## Next Steps for Discord Bot
1. Parse `buildFile.xml` for piece definitions (stats, costs, abilities)
2. Parse `.vsav` files for map geometry / deployment zones
3. Map image filenames → game data (command card effects, deployment stats)
4. Build game state model from rules + Vassal structure
