# Cutover Criteria — JS → Python Engine

This document captures the gates that must all pass before deleting
`src/` and switching the Discord bot from Node.js to Python. It is
the P3.15 deliverable in `docs/python_migration_plan.md`.

**Status: most criteria green, two remain in flight.**

---

## Gate 1: Pattern Coverage ✅

Every ability ID in `data/ability-library.json` resolves through the
Python pattern dispatcher. Coverage gate test:
`python/parity/oracles/combat/test_pattern_e_coverage.py`.

| Pattern | Count | Wired |
|---------|-------|-------|
| A       | 55    | 55    |
| B       | 51    | 51    |
| C       | 63    | 63    |
| D       | 161   | 161   |
| E       | 355   | 355   |
| **Total** | **685** | **685** |

Zero `PatternNotImplemented` raised across the full library.

---

## Gate 2: CC + DC Parity ✅

Per-card oracle parity tests — Python ↔ JS:

- `python/parity/cc_golden.py`: 293 CC cards, 0 fail.
- `python/parity/ability_golden.py`: 333 DC abilities, 0 fail.

---

## Gate 3: Engine Pipeline End-to-End ✅

Each major engine entry point has its own oracle suite under
`python/parity/oracles/combat/`:

| Module | Tests | Status |
|--------|-------|--------|
| Combat orchestrator (16 phases) | 90+ | Pass |
| Combat math + dice + LOS | 40+ | Pass |
| Activation start/end + cleanup | 30+ | Pass |
| Round flow (start/end of round) | 14+ | Pass |
| DC play area (activate/attack/move/interact/special) | 55+ | Pass |
| CC hand engine | 16   | Pass |
| Movement interrupts | 12 | Pass |
| Setup attachment restriction | 15 | Pass |
| legal_actions pendingXxx gates | 19 | Pass |
| resolve_ability dispatch | 10 | Pass |
| Mission rules (8 maps) | 34 | Pass |

Aggregate: **~450 oracle tests** green.

---

## Gate 4: Headless Full-Game ⚠️

`python/parity/oracles/combat/test_full_game_smoke.py` runs 10 random-
policy games to 5000 steps:

- **Progress gate**: 10/10 games run ≥100 steps without crashing. ✅
- **Multi-round gate**: at least one game advances past round 1.
  Currently failing — random-policy creates pathological activation-
  phase stalls. Must improve before live play. ⚠️
- **Win-condition gate**: 10/10 games reach `phase=game_over` with
  a winner assigned. Currently 0/10. ⚠️

This gate is the **last load-bearing item before cutover**. It will
likely close once `legal_actions` no longer over-approximates attack
targets (LOS + range edge cases that surface as ValueError mid-step).

---

## Gate 5: Performance ⚠️

JS game-tick benchmark vs Python equivalent. **Not yet measured.**

Reasonable target: Python ≤ 2× JS step time. Discord game-loop is
human-paced (seconds between interactions); pure step-time
performance matters for AI training, not live play.

---

## Gate 6: Test Coverage ✅

`pytest python/` total count exceeds the JS jest suite (3,973 tests).
Per-PR regression net is `pytest python/parity/oracles/combat/`.

---

## Gate 7: Live Discord ⚠️

One test game completed end-to-end on a live Discord server using the
Python bot. **Not yet attempted** — pending Gate 4 + 5 closure.

---

## Cutover Sequence (P3.16)

After all gates green:

1. Tag JS source: `git tag js-final && git push origin js-final`.
2. Delete `src/`, `tests/headless/`, `index.js`.
3. Update `package.json` to remove discord.js + dependencies.
   Keep `data/` (shared JSON catalogs).
4. Switch Railway deployment from JS service to Python service.
5. Verify one live Discord game completes without errors.

**These steps are destructive and require explicit user authorization
before execution.**
