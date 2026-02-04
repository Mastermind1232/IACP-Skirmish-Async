# Play-Ready Maps (Bot Pool)

Mission A and Mission B count separately. **2** in the play-ready pool so far.

| # | Map | Mission |
|---|-----|---------|
| 1 | Mos Eisley Outskirts | A — Get to the Ship |
| 2 | Mos Eisley Outskirts | B — Smuggled Goods |

---

## Adding a new map

When adding a new map+mission, ensure:
- `deployment-zones.json` has red and blue zones for the map
- `map-spaces.json` has spaces, adjacency, terrain
- `map-tokens.json` has terminals, mission-specific tokens (launchPanels for A, contraband for B), and doors (edges like `[["r11","s11"]]`)
- `mission-cards.json` has the mission card (name, imagePath)
