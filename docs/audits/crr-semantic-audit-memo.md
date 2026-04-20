# CRR Semantic-Coverage Audit — 2026-04-20

## Purpose

Every covered atom in `docs/crr-ledger.json` pairs a CRR rule with a probe. An earlier drive-by audit suggested ~15% of probes were narrower than the rule they claim to cover. This audit checked every covered skirmish atom (284 total) for semantic fit between rule and probe.

## Method

For each atom, an Explore agent:
1. Read the CRR text verbatim (pulled from a pre-built manifest).
2. Decomposed it into numbered clauses.
3. Read the probe file(s) in full.
4. Mapped each clause to specific test bodies, or flagged the clause as uncovered.
5. Assigned a fit verdict (`full` / `partial` / `unclear`) and risk level.

Groups A and E were rerun with a stricter rubric after the first pass produced suspiciously clean verdicts (46/46 full on attacks; 83/88 full on the most heterogeneous group). The redo rubric required each rationale to cite a specific test body, not just count matching assertion strings.

## Headline

- **284 atoms audited.**
- **223 full (78.5 %)** — probe exercises every clause.
- **57 partial (20.1 %)** — one or more clauses uncovered.
- **4 unclear (1.4 %)** — need human review.
- **23 high-risk partials** — silent breaks would corrupt state, grant illegal actions, or mis-score VP.
- 24 medium-risk, 10 low-risk.

The 20 % partial rate is a little higher than the 15 % drive-by estimate but well within the same order of magnitude.

## Three confirmed engine bugs

These atoms were flagged **partial + high risk** and, on inspection, are not just test gaps — they are actual engine bugs that the existing probes already document but don't catch behaviorally:

1. **CRR-BLST-001** — Blast does not fire on a defeated target. The target's position is removed before the adjacency check runs.
2. **CRR-CLV-001** — Cleave uses the target's adjacency instead of the attacker's when picking eligible figures.
3. **CRR-CLV-003** — Same root cause as CLV-001; Cleave target eligibility is computed from the wrong figure.

These should be fixed first — they're the rare intersection of "test gap + known engine fault."

## High-risk pattern: invariant_pin without behavioral backing

The dominant high-risk pattern across attacks and damage (ATK-004/007/018/029/030, DT-001/005, MEL-001/002/003, INCP-001, SKA-003): the probe regex-matches a code line or flag name to prove structure, but no behavioral test exercises the rule under realistic game state. These pass any refactor that preserves the line shape, even if the refactor changes behavior.

## LOS gap

**CRR-LOS-001** and **CRR-LOS-002** both promise that non-companion figures block LOS. No direct behavioral probe exercises figure-as-LOS-blocker — doors, walls, shields, and terrain are all tested but figures aren't.

## Shallow-coverage flags

Several atoms have 5–9 clauses but only 1–2 assertions: **BT-001, BT-004, PLC-001, PLC-003, RTK-002, WIN-004**. Not necessarily wrong — but a signal that the probe is likely riding on a single happy-path check.

## Full-coverage groups

- Movement (Group C) — 0 high-risk partials across 50 atoms. The movement oracle suite is tight.
- Group D LOS work (post-2026-04-02 slice 1 closure) was broadly thorough, with the two figure-blocker gaps as the main exception.

## Artifacts

- `docs/audits/crr-semantic-manifest.json` — per-atom CRR text + probe assertions (input).
- `docs/audits/crr-semantic-groups.json` — group-by-prefix assignment (284 atoms across A–E).
- `docs/audits/crr-semantic-group-{A..E}.json` — per-group findings.
- `docs/audits/crr-semantic-audit-consolidated.json` — all findings merged.
- `docs/audits/README-semantic-audit.md` — agent briefing.

## Recommended next steps

1. **Fix the three engine bugs** (BLST-001, CLV-001, CLV-003). Engine work, not just test work.
2. **Add behavioral probes for the 20 other high-risk partials**, starting with the attack atoms (ATK-004/007/018/029/030, DT-001/005) and LOS-001/002.
3. **Leave medium/low-risk partials for later** — they're real but not urgent.
4. **Do not flip any atom's `status`** as part of this audit. Current `covered` is load-bearing for the completeness test; re-covering under stricter probes is a separate workstream.
