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
