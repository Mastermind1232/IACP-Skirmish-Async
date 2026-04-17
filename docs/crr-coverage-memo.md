# CRR Coverage Heat Map — Skirbo First-Pass Audit

**Date:** 2026-04-14 (initial), 2026-04-16 (v1.2 — heat-map expanded 35 → 55 entries; v1.3 — post-target-select gating reclassified uncovered → direct_oracle; v1.4 — LOS Slice 2 doors + multi-cell reclassified uncovered → direct_oracle; v1.5 — LOS-06 Energy Shield reclassified uncovered → direct_oracle)
**Scope:** All engine subsystems against the Consolidated Rules Reference
**Test inventory:** 1,092 assertions via `npm test` (72 oracle files + engine unit tests)
**Campaign status:** CLOSED. All 5 original top risks resolved. v1.2 is measurement-only: parity scenarios broken out per-row and honest uncovered rows added. v1.3 closes one of the v1.2 uncovered rows with a new 13-scenario certification lane. v1.4 closes the two LOS Slice 2 rows with a new direct-oracle probe file plus two parity scenarios. v1.5 closes the LOS-06 Energy Shield row with a 4-probe file and one more parity scenario; diagonal-corner shield rule deferred as a separate mini-lane.

---

## 1. Methodology

This audit partitions the CRR into 10 domains (D1-D10) and assesses each rule claim against actual test evidence. Coverage is classified into six types, ordered by strength:

| Type | Meaning |
|------|---------|
| **direct_oracle** | Pure-function probe pins the exact semantic claim |
| **runtime_invariant** | RT-1..RT-12 runtime checks assert consistency during training |
| **certification** | Card catalog regression validates data integrity |
| **unit_test** | Co-located or domain unit test covers the function |
| **headless_selfplay** | Exercised in end-to-end selfplay but never explicitly asserted |
| **inferred_only** | Believed to work because adjacent features work; no direct test |
| **uncovered** | No test or runtime check of any kind |

"Inferred_only" is **not** real coverage. It means "this probably works because nothing has broken yet." This audit treats it as a gap, not as evidence.

---

## 2. Coverage Map by Domain

### D1: Action Economy and Surfacing (6 subdomains)
**Overall: STRONG.** 10 oracle probes across 3 batches pin all major gates: action budget, movement blockers (stun, massive-lock), attack gate (one-per-activation + 5 bypass flags), interact gates (Non-Sentient, companion, Beast Tamer, Alter Mind), DC special cost, CC special/double cost.

### D2: Movement (4 subdomains + 3 LOS rows tracked as of v1.2; 2 closed in v1.4, final 1 closed in v1.5)
**Overall: STRONG.** The most heavily oracle-tested subsystem (~200 probes). Core pathfinding, terrain costs, large figure movement, blocking, doors, and movement triggers all have dedicated oracle files.

**Partial gap:** Difficult + hostile terrain stacking on same cell is untested. Low real-world risk (rare map occurrence).

**v1.2 honest uncovered.** Three LOS rows were added as `uncovered` to stop inferring coverage: LOS-06 Energy Shield exception (open P2 from the 2026-04-01 LOS audit), LOS Slice 2 doors (open/closed state), and LOS Slice 2 multi-cell-figure LOS. Slice 1 (figure-blocking LOS) remains closed.

**v1.4 LOS Slice 2 lane.** `tests/domain/oracle/los-slice2-probes.test.js` adds 4 direct oracle probes that hard-fail on CRR violations of the `hasLineOfSight` pure function: PROBE-LOS-SLICE2-001 (closed-door block), PROBE-LOS-SLICE2-002 (open/unrelated door does not block), PROBE-LOS-SLICE2-003 (multi-cell attacker any-cell LOS), PROBE-LOS-SLICE2-004 (multi-cell target any-cell reachability). Two new handler-parity scenarios (14 closed door, 15 multi-cell attacker top-left-only LOS, both in `tests/certification/_crr-baselines.js`) baseline the engine's drift: the engine calls `hasLineOfSight` with raw `mapSpaces` (no door merging) and the attacker's top-left cell only (no footprint iteration). The shadow in `handler-parity-reporting.test.js` was expanded to merge closed-door edges into `effectiveMs` and iterate attacker-fp × target-fp so the parity test surfaces the engine drift rather than masking it. LOS-06 Energy Shield remains uncovered (intentionally out of scope for this lane).

**v1.5 LOS-06 Energy Shield lane.** `tests/domain/oracle/los-06-energy-shield-probes.test.js` adds 4 direct oracle probes pinning the three CRR p.28 carve-outs: PROBE-LOS-06-001 (LOS can be drawn OUT of a shielded space when the attacker is on the shield), PROBE-LOS-06-002 (LOS can be traced INTO a shielded space when the target is on the shield), PROBE-LOS-06-003 (LOS cannot be traced THROUGH a shielded space when the shield is between endpoints), and PROBE-LOS-06-004 (multi-cell attacker with a shield on one footprint cell still has LOS via the shield cell's own self-exclusion). Rules "in" and "out" rely on the existing `spatial.js:141-143` source/dest self-exclusion. One new handler-parity scenario (16 in `_crr-baselines.js`) baselines the engine's shield-blindness: engine reads raw `ms` from `getMapData` and never consults `game.ancillaryTokens.energyShield` (zero matches across `src/engine/`); handler merges shield spaces into `effectiveMs.blocking` at `dc-play-area.js:951-968`. Shadow expanded to merge shield spaces into blocking alongside closed-door edges. Diagonal corner-intersection rule (p.28/p.40: LOS cannot pass through a corner where a shield meets wall/door/blocker/another shield) explicitly deferred as a separate follow-up mini-lane.

### D3: Combat (7 subdomains + 13 parity subdomains as of v1.2)
**Overall: MIXED.** Damage formula, accuracy/range, LOS, rerolls, blast/cleave are all well-tested. The original three high-risk areas are now **resolved** (surge legality, power-token timing, attack-type validation — see §5).

**v1.2 parity breakout.** The handler-vs-engine target-enumeration scoreboard is now one direct_oracle row per scenario (13 total): 2 positive controls (default, Insignificant/Dio), 3 Reach-family rows (permanent Reach and nextAttackReach flag landed in parity 2026-04-16; Fury of Kashyyyk and Electrostaff loadout are known engine-side gaps), 3 LOS-bypass rows (Priority Target, Marksman CC, Clawdite Scout form — all engine-side gaps), and 4 divergences of different shape (I Must Go Alone distance cap, Fire Mission group-LOS, Vanish immunity, Hide no-longer-a-filter). See `tests/certification/handler-parity-reporting.test.js` and `tests/certification/_crr-baselines.js`.

**v1.3 post-target-select gating lane.** A second direct_oracle lane now pins the post-target-select decision block in `src/handlers/combat.js:869–969`. `tests/certification/post-select-gating.test.js` runs 13 scenarios through a narrow shadow `decideAfterTargetSelect` that mirrors the handler's first-match ordering across 4 block gates (etiquette, Still Faster Than You, forced-target, multi-fire same-target) and 8 consumption windows (Battlefield Leadership, Fell Swoop, Emperor Interrupt, Executive Order, Bombardment Sorin, Firing Squad, Coordinated Raid, Field Tactics), plus a positive-control baseline. Engine-blindness is tracked as a report-only counter (currently 11-of-12 gated scenarios — the engine is unaware of these post-select flags). Side effects (flag cleanup, token deduction, arcing-shot / ballistics-matrix clears) and combat resolution itself are deliberately out of scope.

One combat-adjacent row remains **uncovered**: loadout-card passives beyond Reach.

### D4: Conditions (2 subdomains)
**Overall: STRONG.** Individual condition application/removal well-tested. Multi-condition interaction is inferred_only but low risk since conditions use independent flag tracking.

### D5: Defeat and VP (2 subdomains)
**Overall: STRONG with one gap.** Single-figure defeat and VP award well-pinned. Multi-figure group defeat activation count is untested — if all 3 Stormtroopers die, does the activation correctly decrement?

### D6: Deployment (1 subdomain)
**Overall: ADEQUATE.** Exercised every selfplay game. Deployment zone coords validated in mission-scoring probes. No dedicated deployment legality oracle (figures must deploy in friendly zone).

### D7: Round Structure (3 subdomains)
**Overall: STRONG.** Phase transitions, initiative swap, activation ordering, flag reset all tested via oracle and runtime invariants. Start-of-round DC effect sequencing is inferred_only but relatively rare.

### D8: Mission Scoring (5 subdomains)
**Overall: STRONG.** 11 VP handler probes cover: launch panels, space-in-list, crate tokens, contraband-in-zone, deployment zone majority. Alter Mind and Powerful Influence control exclusions tested through real board computation.

### D9: Card Data Integrity (2 subdomains)
**Overall: STRONG.** Full 410+ card catalog certified. CC timing windows unit-tested. Not all CC cards have dedicated playability probes.

### D10: Map Topology (1 subdomain)
**Overall: INFERRED.** Movement and LOS tests use real map data and pass, which implies adjacency is correct. BFS distances manually verified for key spaces. No dedicated map topology validation suite. A silent adjacency error would corrupt movement, LOS, and control simultaneously.

---

## 3. Where Coverage Is Strong

These areas have high-confidence direct oracle coverage and require no further audit investment:

- **Action surfacing gates** (D1): All 6 action types pinned with positive/negative pairs
- **Movement pathfinding** (D2): ~200 probes including large figures, terrain, doors
- **Damage formula and pierce** (D3): Core combat math pinned
- **Accuracy and range** (D3): Range check and miss behavior tested
- **LOS core** (D3): Wall and figure blocking tested (Slice 1 closed)
- **Condition lifecycle** (D4): Application, removal, stun action consumption
- **Single-figure defeat and VP** (D5): VP award, figure removal, companion defeat
- **Round structure and flag reset** (D7): Phase transitions + RT invariants
- **Mission scoring handlers** (D8): 7 handler variants across 11 probes
- **Control exclusions** (D8): Alter Mind and Powerful Influence through real BFS
- **Card catalog** (D9): Full certification of all 410+ cards

---

## 4. Where Coverage Is Partial or Weak

### 4a. Legacy gaps (pre-v1.2)

| Area | Coverage Type | Risk |
|------|--------------|------|
| Map topology correctness | inferred_only | **Critical foundational** — silent corruption vector |
| SoR effect sequencing | inferred_only | **Medium** — rare but critical when it fires |
| CC playability per card | unit_test | **Medium** — timing tested, not all cards probed |
| Multi-figure group defeat activation | inferred_only | **Medium** — wrong count breaks round structure |
| Deployment zone legality | headless_selfplay | **Low** — exercised but never asserted |
| Difficult+hostile terrain combo | inferred_only | **Low** — rare map occurrence |

Note: Surge spending legality, power-token timing, attack-type validation, and condition immunity — all previously in this table — were closed during Tier A + rules-audit campaign (see §5).

### 4b. Surfaced by v1.2 expansion

| Area | Coverage Type | Risk |
|------|--------------|------|
| Handler-engine parity: Priority Target LOS bypass | direct_oracle (baselined handler_only) | **Medium** — engine offers fewer legal targets |
| Handler-engine parity: Marksman CC LOS bypass | direct_oracle (baselined handler_only) | **Medium** — same shape |
| Handler-engine parity: Clawdite Scout form | direct_oracle (baselined handler_only) | **Low** — rare line |
| Handler-engine parity: Fury of Kashyyyk Reach | direct_oracle (baselined handler_only) | **Medium** — engine undercounts WOOKIEE melee range |
| Handler-engine parity: Electrostaff loadout Reach | direct_oracle (baselined handler_only) | **Medium** — engine never reads loadout cards |
| Handler-engine parity: I Must Go Alone | direct_oracle (baselined engine_only) | **Medium** — engine offers illegal distant targets |
| Handler-engine parity: Fire Mission group-LOS | direct_oracle (baselined handler_only) | **Low** — Mortar rare in self-play |
| Handler-engine parity: Vanish immunity | direct_oracle (baselined engine_only) | **Medium** — engine offers immune targets |
| LOS-06 Energy Shield exception | direct_oracle (v1.5) | **Closed** — three p.28 carve-outs pinned by PROBE-LOS-06-001/002/003/004 + parity scenario 16; diagonal-corner subrule deferred |
| LOS Slice 2 — Doors | direct_oracle (v1.4) | **Closed** — closed doors as walls pinned by PROBE-LOS-SLICE2-001/002 + parity scenario 14 |
| LOS Slice 2 — Multi-cell figures | direct_oracle (v1.4) | **Closed** — any-cell LOS rule pinned by PROBE-LOS-SLICE2-003/004 + parity scenario 15 |
| Post-target-select combat gating | direct_oracle (v1.3) | **Closed** — 13-scenario certification lane, engine-blindness 11-of-12 tracked |
| Loadout-card passives beyond Reach | uncovered | **Low** — Reach is the only wired passive today |
| Mission-specific scoring variants | inferred_only | **Medium** — selfplay exercises but nothing asserts per-mission VP math |
| Free-attack window mutex | inferred_only | **Medium** — individual flags tested, mutex isn't |

---

## 5. Top 5 Remaining Correctness Risks

### Risk #1: Surge Spending Legality (D3)
**Blast radius: Critical.** No test validates that surges can only be spent on available surge abilities or that each ability is used at most once per attack. If the engine accepts illegal surge spending, every combat's damage output is potentially inflated. This is the single highest-value probe target remaining.

**Recommended fix:** Oracle probe with fixed dice → assert only legal surge combos accepted; illegal combos (non-existent ability, duplicate use) rejected.

### Risk #2: Power Token Application Timing (D3)
**Blast radius: High.** Focus and Hidden tokens are tested in conditions.test.js isolation but never traced through the combat flow. If tokens are consumed at the wrong phase (e.g., focus applied after roll instead of adding a die before roll), the dice pool is silently wrong.

**Recommended fix:** Oracle probe tracing token state through each combat.js phase boundary.

### Risk #3: Condition Immunity in Combat Resolution (D3)
**Blast radius: Medium.** isConditionImmune is tested as a pure function. But no test runs a full combat where a surge applies Stun to an immune figure and asserts the condition is not applied. The integration seam between combat resolution and condition application is untested.

**Recommended fix:** Oracle probe: attack with Stun surge vs immune target → assert condition absent post-combat.

### Risk #4: Attack Type Validation — Melee vs Ranged (D3)
**Blast radius: High.** The isRanged flag in DC data drives target filtering in available-actions.js. No test validates this flag matches the card's actual weapon type. A wrong flag would silently let a melee figure attack at range or force a ranged figure to only attack adjacent targets.

**Recommended fix:** Certification sweep: assert isRanged matches known weapon type for all DCs in catalog.

### Risk #5: Multi-Figure Group Defeat Activation Count (D5)
**Blast radius: Medium.** When all figures in a multi-figure deployment group (e.g., 3 Stormtroopers) are defeated, the group's activation should be removed from the round. No test verifies this. If activation count is wrong after group wipe, one player gets extra or missing activations.

**Recommended fix:** Oracle probe: defeat all figures in a 3-figure group → assert activation count decremented correctly.

---

## 6. Recommended Next Audit Investments

**Tier A — Highest ROI (do next):**
1. **Surge legality oracle** (Risk #1): 2-3 probes, pins the highest-risk gap
2. **Power token combat timing oracle** (Risk #2): 2 probes, traces token through phases
3. **Condition immunity integration oracle** (Risk #3): 1-2 probes, small but high signal

**Tier B — Important but lower urgency:**
4. **isRanged certification sweep** (Risk #4): Catalog-level check, fast to implement
5. **Multi-figure group defeat oracle** (Risk #5): 1-2 probes
6. **Map topology certification**: Validate adjacency graph against known map layouts

**Tier C — Nice to have:**
7. SoR effect sequencing probes
8. Deployment zone legality oracle
9. CC playability probes for high-impact cards
10. Difficult+hostile terrain stacking probe

---

## 7. Structured Coverage Artifact

The machine-readable coverage map is at: `docs/crr-coverage-heat-map.json` (v1.5, 2026-04-16).

It contains **55** coverage entries across 10 domains with fields: domain, subdomain, crr_rule_or_claim, engine_location, current_coverage_type, evidence, training_blast_radius, confidence, recommended_next_audit_type, notes. Plus the top 5 risks with recommended actions.

### Coverage Distribution Summary (v1.5, post-reclassification)

| Coverage Type | Count | % |
|--------------|-------|---|
| direct_oracle | 43 | 78.2% |
| inferred_only | 6 | 10.9% |
| uncovered | 1 | 1.8% |
| certification | 2 | 3.6% |
| unit_test | 1 | 1.8% |
| runtime_invariant | 1 | 1.8% |
| headless_selfplay | 1 | 1.8% |

**Change vs v1.4 (55 entries, same total):** +1 direct_oracle (LOS-06 Energy Shield), −1 uncovered (same row reclassified). No new entries; total count unchanged.

**Change vs v1.2 (55 entries, same total):** +4 direct_oracle (post-target-select gating in v1.3; LOS Slice 2 doors + multi-cell in v1.4; LOS-06 Energy Shield in v1.5), −4 uncovered (same rows reclassified). No new entries; total count unchanged.

**Change vs v1.1 (35 entries):** +17 direct_oracle (13 parity scenarios broken out per-row in v1.2 + post-select gating reclassified in v1.3 + LOS Slice 2 doors & multi-cell reclassified in v1.4 + LOS-06 Energy Shield reclassified in v1.5), +2 inferred_only (mission-specific scoring, free-attack window mutex), +1 uncovered (loadout passives). No entries removed.

**78% of audited rules have direct oracle coverage.** All 5 original top risks remain resolved; post-target-select combat gating is the second certification-backed direct_oracle lane alongside the handler-engine parity scoreboard, LOS Slice 2 (doors + multi-cell figures) adds a third pure-function oracle lane, and LOS-06 Energy Shield adds a fourth. Only one uncovered row remains (loadout-card passives beyond Reach).

**Still weak after v1.5:** Map topology (inferred_only, critical foundational), loadout-card passives beyond Reach (uncovered, low), parity gaps for loadout/attachment-driven Reach and LOS bypass (known-and-baselined engine-side drift), mission-specific VP math (inferred_only), and the diagonal-corner Energy-Shield intersection subrule (explicitly deferred from v1.5, separate follow-up mini-lane). The rollup at `docs/crr-status.json` makes the distribution a one-file PR review target.
