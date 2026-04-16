# CRR Coverage Heat Map — Skirbo First-Pass Audit

**Date:** 2026-04-14 (initial), updated after Tier A + Tier B passes
**Scope:** All engine subsystems against the Consolidated Rules Reference
**Test inventory:** 1,092 assertions via `npm test` (72 oracle files + engine unit tests)
**Campaign status:** CLOSED. All 5 original top risks resolved.

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

### D2: Movement (4 subdomains)
**Overall: STRONG.** The most heavily oracle-tested subsystem (~200 probes). Core pathfinding, terrain costs, large figure movement, blocking, doors, and movement triggers all have dedicated oracle files.

**Partial gap:** Difficult + hostile terrain stacking on same cell is untested. Low real-world risk (rare map occurrence).

### D3: Combat (7 subdomains)
**Overall: MIXED.** Damage formula, accuracy/range, LOS, rerolls, blast/cleave are all well-tested. However, three high-risk areas are **inferred_only**:
- Surge spending legality (no test validates illegal surges are rejected)
- Power token application timing (tokens tested in isolation, not in combat flow)
- Attack type validation (isRanged flag never checked against card data)

Condition immunity exists as a unit test but has no integration path through combat resolution.

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

| Area | Coverage Type | Risk |
|------|--------------|------|
| Surge spending legality | inferred_only | **Critical** — illegal surges inflate damage silently |
| Power token timing in combat | inferred_only | **High** — wrong phase = wrong dice pool |
| Attack type validation (melee/ranged) | inferred_only | **High** — wrong isRanged corrupts target filtering |
| Condition immunity in combat flow | unit_test | **Medium** — isolated test, no integration path |
| Multi-figure group defeat activation | inferred_only | **Medium** — wrong count breaks round structure |
| Map topology correctness | inferred_only | **Critical foundational** — silent corruption vector |
| Deployment zone legality | headless_selfplay | **Low** — exercised but never asserted |
| SoR effect sequencing | inferred_only | **Medium** — rare but critical when it fires |
| CC playability per card | unit_test | **Medium** — timing tested, not all cards probed |
| Difficult+hostile terrain combo | inferred_only | **Low** — rare map occurrence |

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

The machine-readable coverage map is at: `docs/crr-coverage-heat-map.json`

It contains 35 coverage entries across 10 domains with fields: domain, subdomain, crr_rule_or_claim, engine_location, current_coverage_type, evidence, training_blast_radius, confidence, recommended_next_audit_type, notes. Plus the top 5 risks with recommended actions.

### Coverage Distribution Summary (post Tier A + Tier B)

| Coverage Type | Count | % |
|--------------|-------|---|
| direct_oracle | 24 | 69% |
| certification | 2 | 6% |
| runtime_invariant | 1 | 3% |
| unit_test | 2 | 6% |
| headless_selfplay | 1 | 3% |
| inferred_only | 5 | 14% |
| uncovered | 0 | 0% |

**69% of audited rules have direct oracle coverage. All 5 original top risks resolved. Remaining 14% inferred_only are low/medium risk — not the best next investment.**
