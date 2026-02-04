# Play-Ready Maps (Bot Pool)

Mission A and Mission B count separately. **2** in the play-ready pool so far.

| # | Map | Mission |
|---|-----|---------|
| 1 | Mos Eisley Outskirts | A — Get to the Ship |
| 2 | Mos Eisley Outskirts | B — Smuggled Goods |

## Source

Canonical list: `data/play-ready-maps.json`

When adding a new map+mission, ensure:
- `deployment-zones.json` has red and blue zones for the map
- `map-spaces.json` has spaces, adjacency, terrain
- `map-tokens.json` has terminals and mission-specific tokens (launchPanels for A, contraband for B)
- `mission-cards.json` has the mission card (name, imagePath)
