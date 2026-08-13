# Pipeline re-audit worklist (SoA, status phase, EOR, SOR)

Requested by alexanbv 2026-08-12, after the EoA rework:

> "re audit the EoA and SoA pipelines. Then reaudit the status phase, EOR, and
> SOR pipelines"

The EoA pipeline is done and is now enforced by
`tests/certification/eoa-pipeline-coverage.test.js`. This is the scope for the
remaining four, written so the next session starts executing rather than
scoping.

## Scale, from the spec

| timing in `combat-spec.csv` | rows | pipeline |
|---|---|---|
| `during_activation` | 108 | activation (not requested, but the largest bucket) |
| `start_of_activation` | 51 | **SoA** |
| `start_of_round` | 50 | **SOR** |
| `end_of_round` | 22 | **EOR** |
| `end_of_activation` | 13 | EoA — DONE |
| `after_activation_resolves` | 8 | window 2 — DONE |

So the four remaining audits cover **123 spec rows**, against 21 already
covered. This is bigger than the EoA pass, which took a full session once the
rulings started landing.

## Entry points

| file | lines | role |
|---|---|---|
| `src/game/soa-orchestrator.js` | 1017 | SoA descriptors, bucketing, lifecycle |
| `src/handlers/soa-handler.js` | 1757 | SoA sub-prompts and resolution |
| `src/game/round-trigger-orchestrator.js` | 97 | round-boundary orchestration |
| `src/game/round-trigger-bins.js` | 66 | round trigger binning |
| `src/game/sor-enumerator.js` | 69 | start-of-round enumeration |
| `src/game/sor-resolution.js` | 32 | start-of-round resolution |
| `src/game/phase.js` | 146 | phase transitions |

Existing tests: `round-trigger-bins.test.js`, `round-trigger-orchestrator.test.js`,
`sor-enumerator.test.js`, `phase.test.js`.

## The method that worked for EoA

Do these in this order. Steps 1-2 are what caught the real bugs; step 4 is what
makes the audit survive.

1. **Sweep the spec first, and fix the spec before reading code.** The EoA sweep
   found 6 rows tagged for the wrong window. Wiring from a wrong spec would have
   put window-2 cards into window 1. Check each row's timing against its own
   `cc-effects.json` timing and reconcile disagreements with alexanbv.
2. **Cross-reference every row to a home.** Descriptor, or explicitly classified
   as something else (CC-window, automatic termination, other pipeline). A row
   with no home is the bug.
3. **Trace, do not pattern-match.** Every classification alexanbv corrected in
   the EoA pass came from judging a call site by its filename or its grep line.
   `activation-setup.js` sounded like activation; that call was deploy. Two
   hand-rolled runtime dispatchers were filed as plain banking because they
   *call* `grantMovementBank`.
4. **Land the audit as a certification test, not prose.** A hand sweep rots the
   moment someone adds a row. Model on `eoa-pipeline-coverage.test.js`.

## Specific things to check, carried over from the EoA pass

- **Initiative order.** Fixed for SoA/EoA in `b7004758` — all five call sites
  read fields that were never assigned, so both windows had always run
  activator-first. **Check whether the round/EOR/SOR paths have the same bug**;
  the same phantom-field pattern may exist there. `getInitiativePlayerNum` is
  the correct reader.
- **Ordering of choices vs terminations.** Choices go in a chooser; automatic
  terminations must run after it closes. This bit EoA and is likely to recur at
  round boundaries, where "until end of round" effects expire.
- **Name-only card lookups.** `tests/certification/name-only-card-lookups.test.js`
  guards the class. Any new lookup in these pipelines must resolve by figureKey.
- **Deps actually passed at the call site.** Twice a test passed while
  production was broken because the test injected deps the real caller did not
  (Opportunistic's MP grant, the headless CC sweep). Check the production call
  site, not just the unit test.

## Open, unrelated, still outstanding

- **IACP-vs-FFG card drift.** Disable held the FFG card entirely. alexanbv:
  "many times more than 20" cards across DCs and CCs. Ground truth is the
  `(IACP)`-suffixed images in `vassal_extracted/images/cc/`, readable directly.
  See the memory note `project_iacp_vs_ffg_card_drift`.
- **12 pre-existing headless failures** (attack targeting, MASSIVE LOS, Recover,
  Element of Surprise). They predate 2026-08-11 and keep `npm run predeploy`
  red. Verify by stashing before blaming any change.

---

# AUDIT RESULTS — SoA and SOR (2026-08-13)

## Spec sweep (step 1) — 5 disagreements, 2 real

Compared each row's CSV timing against the card's own `cc-effects.json` timing.

**3 were false alarms, resolved by the `part` column.** Blaze of Glory, Rest in
Peace and Set a Trap are multi-clause cards whose parts legitimately sit in
different phases (Blaze part 1 = after-activation-resolves ready, part 2 =
end-of-round 3 Damage). Checking `part` before "fixing" them is what stopped
this becoming three wrong edits.

**2 were real, and both are spec imprecision rather than code bugs:**

| card | was | now | why |
|---|---|---|---|
| Cut Lines | `start_of_round` | `start_of_status_phase` | card reads "Use at the start of a Status Phase"; it is consumed in the Status Phase draw step in `handlers/round.js` |
| Still Faster Than You | `start_of_activation` | `start_of_hostile_activation` | card reads "at the start of a HOSTILE figure's activation"; `activation-setup.js:1416` correctly fires only when the activating player is not the owner |

Both implementations were already correct. The timing column simply could not
express the distinction — the same collapse that hid the two post-activation
windows behind one `end_of_activation` tag. Retimed so the status-phase audit
does not miss Cut Lines and an SoA audit does not treat Still Faster Than You as
an own-activation card.

## SoA pipeline — no gaps

All **47** distinct `start_of_activation` cards resolve to a wired
ability-library entry (checked by data, not by name-matching: every card's
`abilityId` returns an entry and none carry a non-wired `wiredStatus`).

Three name-based heuristics flagged Force Rush, Fatal Deception and Rank and
File as possibly unwired. All three are wired — Force Rush is a generic
`mpBonus` card so it never names itself in the orchestrator. Recorded because
the heuristic was wrong three times in a row, which is the same failure mode as
the misclassifications in the EoA pass.

## Initiative order — the SoA/EoA bug does NOT extend to the round pipelines

`handlers/round.js` uses the real `game.initiativePlayerId`, and
`sor-resolution.js` uses `getInitiativePlayerNum`. The phantom-field class is
also now enforced repo-wide by
`tests/certification/initiative-order-resolution.test.js`.

## FINDING: the SoR round-trigger orchestrator is DORMANT

`startSorResolution` (`src/game/sor-resolution.js`) has **no production
caller** — the only references are its own definition and its test file. It is
the sole caller of `enumerateSorDescriptors`, `startRoundTriggerResolution` and
`bucketizeRoundTriggers`, so that whole stack is dead:

| file | lines | status |
|---|---|---|
| `src/game/sor-resolution.js` | 32 | dormant |
| `src/game/sor-enumerator.js` | 69 | dormant (only called by the above) |
| `src/game/round-trigger-orchestrator.js` | 97 | dormant |
| `src/game/round-trigger-bins.js` | 66 | dormant |

**Production start-of-round runs an ad-hoc path in `handlers/round.js`** —
`game.startOfRoundWhoseTurn = game.initiativePlayerId` plus mission SoR effects
via `runMissionSorEffects` / `runStartOfRoundRules`. That path IS initiative-first,
so behaviour is not wrong today.

This is the same "dormant machine beside a live ad-hoc engine" pattern recorded
for the combat gate rework, and it is the same shape as three dead things found
last night (`deployBonusMp`, `eoaResolvedCallback`, Opportunistic's unpassed
deps): green tests over code no caller reaches.

**NOT removed, and not wired in, because that is a design decision for
alexanbv.** Either the orchestrator replaces the ad-hoc path (which would give
SoR the same strict mission → init → non-init binning the EoA window now has),
or it should be deleted. Leaving it dormant is the one option that keeps costing
— it reads as covered.

## Still to do

Status phase and EOR pipelines, using the same method.
