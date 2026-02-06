# Gaps & To-Do

**Purpose:** Identify what’s missing or blocking a full game, plus planned work and feature requests. Prioritized by impact.

---

## Critical (Game Can't End)

### 1. ~~No win/loss detection~~ (done)
- **40 VP** — Game checks after defeats, contraband delivery, Mission A/B VP. Declares winner and sets `game.ended`.
- **Elimination** — When one player has no figures left, other player wins.

---

## High (Broken or Incomplete Flow)

### 2. ~~Special actions~~ (done — manual resolve)
- Special actions consume the action and show "Resolve manually (see rules)" with a Done button.

### 3. Command card effects — partial (manual)
- Playing a CC: bot loads `cc-effects.json`; if card has effect data, shows "Apply effect: [text]" reminder. Use `scripts/cc-effect-editor.html` to build the database.

### 4. ~~Mission A objectives~~ (done)
- Mission A (Get to the Ship): Launch panels — flip to colored/gray (1 per player per round). End of round: 5 VP per colored panel controlled, 2 VP per gray.

### 5. ~~Defeated groups still activatable~~ (done)
- Defeated groups are filtered from Activate list; `ActivationsRemaining` decremented when a non-activated group is fully defeated.

---

## Medium (UX / Correctness)

### 6. ~~DC cost missing for some units~~ (done)
- `dc-stats.json`: Some entries lack `cost` (e.g. Rebel Trooper Elite, Trandoshan Hunter). VP on defeat uses `targetStats.cost ?? 5`.
- **Needed:** Add `cost` to all deployment cards or handle missing cost explicitly.

### 7. ~~Launch Panel (Mission A)~~ (done)
- Interact "Launch Panel" logs use but doesn't change game state.
- **Needed:** Confirm what Launch Panel does (likely mission-specific VP or trigger) and implement it.

### 8. ~~Doors not drawn on map~~ (done)
- Door tokens drawn on map edges (R11–S11, R12–S12 on Mos Eisley Outskirts). Horizontal orientation, matte white backfill, single span across cells.

---

## Lower (Polish / Edge Cases)

### 9. Multi-figure defeat and DC display
- When one figure in a 3-figure group dies, healthState and display should reflect survivors. Needs verification.
- **Needed:** Ensure healthState and DC embeds correctly show remaining figures and that dead figures are removed from figurePositions.

### 10. Command card timing
- When can you play a CC? Typically before/during/after attacks or at specific phases. Current flow may not enforce timing.
- **Needed:** Document or enforce when CCs can be played per rules.

---

## To-Do / Planned work

- [ ] **Create UI tool to determine interior vs exterior spaces.** Many cards reference interior/exterior (e.g. MASSIVE cannot enter interior spaces). The backend needs to know which map cells are interior vs exterior so card effects and movement rules can be enforced correctly.

- [ ] **Wire up all CCs so they have actual effects.** Command cards currently show effect text as a reminder; implement real game-state effects for each CC (or document which are manual).

- [ ] **Wire up all DCs so they have actual effects.** Deployment card abilities (passives, surge, keywords, etc.) should affect game state where applicable; implement or document manual resolution.

---

## Summary

| Gap | Blocks full game? | Effort |
|-----|-------------------|--------|
| Win/loss detection | Yes | Low |
| Special actions | Yes (for those units) | High |
| CC effects | Partial (manual workaround) | High |
| Mission A objectives | Yes (for Mission A) | Medium |
| Defeated group filtering | Yes (weird UX) | Low |
| DC cost completeness | Partial (fallback 5) | Low |
| Launch Panel effect | For Mission A | Low–Medium |
| Door rendering | No | — (done) |
| Multi-figure defeat display | Edge case | Low |
| CC timing | Edge case | Low |

**Minimum to run a full game:** #1 (win/loss), #5 (defeated groups), and either avoid special-action units or implement a basic "resolve manually" for them.
