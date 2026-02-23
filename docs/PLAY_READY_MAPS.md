# Play-Ready Maps (Bot Pool)

Mission A and Mission B count separately. **12** in the play-ready pool (6 maps × 2 variants each).

| # | Map | Mission |
|---|-----|---------|
| 1 | Mos Eisley Outskirts | A — Get to the Ship |
| 2 | Mos Eisley Outskirts | B — Smuggled Goods |
| 3 | Corellian Underground | A |
| 4 | Corellian Underground | B |
| 5 | Chopper Base Atollon | A |
| 6 | Chopper Base Atollon | B |
| 7 | Lothal Wastes | A |
| 8 | Lothal Wastes | B |
| 9 | Development Facility | A |
| 10 | Development Facility | B |
| 11 | Devaron Garrison | A |
| 12 | Devaron Garrison | B |

---

## Adding a new map

When adding a new map+mission, ensure:
- `deployment-zones.json` has red and blue zones for the map
- `map-spaces.json` has spaces, adjacency, terrain
- `map-tokens.json` has terminals, mission-specific tokens (launchPanels for A, contraband for B), and doors (edges like `[["r11","s11"]]`)
- `mission-cards.json` has the mission card (name, imagePath)
