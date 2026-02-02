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
- **229 Command cards** — `C card--[Name].jpg` (e.g. `C card--Force Lightning.jpg`)
- **Deployment cards** — different naming in buildFile (DeploymentCardImperial, Rebel, Mercenary, Neutral)
- **Figures** — Figure1x1, Figure1x2, Figure2x2, Figure2x3
- **Map images** — mission/map backgrounds
- **Power tokens** — Damage, Surge, Block, Evade
- **Conditions** — Bleeding, Stunned, Weakened

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
