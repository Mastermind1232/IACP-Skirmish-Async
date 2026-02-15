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

**All image paths in data files and the build use these subfolders.** Do not store paths under `vassal_extracted/images/` without the correct subfolder (e.g. use `vassal_extracted/images/maps/Map_X.gif`, not `vassal_extracted/images/Map_X.gif`).

| Subfolder | Contents | Data that references it |
|-----------|----------|---------------------------|
| `cc/` | Command cards (C card--, IACP_C card--, etc.) | Command card effects / images |
| `dc-figures/` | Deployment cards with figures | `data/dc-images.json` |
| `DC Skirmish Upgrades/` | Deployment cards without figures (Skirmish upgrades) | `data/dc-images.json` |
| `figures/` | Circular figure tokens for map (Figure-Imperial--, etc.) | `data/figure-images.json` |
| `tokens/` | Counters, mission tokens (Counter--Terminal, Mission Token--, etc.) | `data/token-images.json` (filenames; optional `tokenImageBasePath` = folder path to serve from) |
| `maps/` | Map backgrounds (Map_*.gif) | `data/map-registry.json` |
| `mission-cards/` | Mission cards (SkMission Card--*.jpg) | `data/mission-cards.json` |
| `conditions/` | Condition cards and markers | — |
| `companions/` | Companion cards and tokens | `data/companion-images.json` |
| `cardbacks/` | All cardbacks | — |
| `dice/` | Dice box, Dice Clear button, Dice Icon colors, Dice faces | — |
| `dc-supplemental/` | Attachments, IACP Shape Cards, IACP Loadout Cards | — |

Runtime resolution (`resolveAssetPath`, `resolveImagePath` in index.js and map-renderer) still tries the correct subfolder first, then the path as stored, so old data without subfolders continues to work until data is re-extracted or updated.

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
