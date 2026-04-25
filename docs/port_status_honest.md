# Port Status — Honest Edition

**Last regenerated: 2026-04-25 (recordings reach round 8).** Numbers
are pulled from `docs/coverage_audit.json` (regenerable via
`python3 python/parity/coverage_audit.py --refresh`). When in doubt,
trust the JSON over any prose here.

The companion machine report is `docs/coverage_audit.md` — that's the
table-of-everything. This file is the plain-English interpretation.

## Headline number

**Weighted completion estimate: ~56%.** Up from 53% earlier tonight.
The recordings now drive full round-cycles (rounds 1-8 reachable in
200 steps), so 18 of 81 action types have at least one observed
recording — up from 2 at session start.

## What we've taught Python well

| Layer | Status | Plain English |
|---|---|---|
| Reading deployment-card abilities | 275/310 = 89% | The engine knows what every DC special does, except for 35 Pattern-C passives that need their consumption layer ported (combat handler, bridge, CC-timing, etc.) |
| Reading command cards | 293/293 = 100% | Every CC has a registered handler |
| Rolling attack/defense dice | byte-identical | 2,011 fuzz cases vs JS pass clean |
| Damage / wounds / conditions | byte-identical | Bleed/Stun/Focus/Hide application matches JS |
| Drawing line of sight (basics) | wired | Figure-blocking LOS slice 1 closed |
| Mission rules per map | 8/8 | Wired and replay-clean for the recorded games |
| Pattern-C passives | 22/58 wired | Tonight's grind: cower, AT-ST targeting, Squad Training, Take Cover, Aim, Dead Precise, Lucky R2-D2, Verena cover, Gar Saxon shield, Jyn trust, Armorer/Kallus death triggers, awkward AT-ST, C-3PO non-combatant. 36 still deferred. |

## What we haven't really taught Python

| Layer | Status | Plain English |
|---|---|---|
| Setup flow | partial | Squad submit + DC trio works; loadout selection, Clawdite form, mulligans, post-deploy abilities mostly absent |
| Discord-button handlers | ~10% | The 28 JS handler files (cc-hand, post-deploy, fast-forward, recover, blitz-deploy, combat-reactions, combat-special-effects, defeat-handler, etc.) are mostly Python-absent |
| End-of-round mission scoring | wired but unverified end-to-end | Rules are there but no recorded game reaches scoring |
| LOS edge cases | partial | Doors, multi-cell figures, corner rule deferred |
| 36 Pattern-C deferred passives | not wired | Need the consumption layer for each |

## The drift suite — what it does and doesn't prove

We have **43 recorded games** of JS gameplay that we replay through
Python. After tonight's fixes, drift now exercises **18 of 81 action
types** (was 2 at start of session):

- 🥇 GOLD: `activate_dc` (724 hits), `attack_target` (70 hits)
- 🥈 SILVER (16): full activation cycle (`dc_special`, `dc_move`,
  `move_pick_space`, `dc_end_activation`, `dc_ability_choice`,
  `pass_activation_turn`), full combat cycle (`combat_ready`,
  `combat_gate`, `combat_roll`, `combat_reroll`, `combat_surge`,
  `combat_resolve`), full round cycle (`phase_gate_ready`,
  `end_end_of_round`, `end_activation_phase`), and `pounce_space`

Recordings now reach **rounds 1-8** in a 200-step game — the round
cycle works end-to-end through pre_end_of_round → post_end_of_round →
pre_activation phase gates.

What we still don't have evidence for: command-card plays, deployment
(traces start in round 1), mission-specific scoring events.

## Action-type verdicts (the medal table)

| Medal | Count | Meaning |
|---|---|---|
| 🥇 GOLD | 2 | Wired, tested, observed in real recording |
| 🥈 SILVER | 16 | Wired, observed live, no targeted oracle test |
| 🥉 BRONZE | 0 | Wired, tested, never observed live |
| ⬜ UNVERIFIED | 63 | Wired, no test reference, no drift evidence |
| 🚫 UNREGISTERED | 0 | Enum value with no handler |

Combat is now fully exercised in recordings: `combat_ready`,
`combat_gate`, `combat_roll`, `combat_reroll`, `combat_surge`, and
`combat_resolve` all fire across multiple games.

**63 handlers still have zero behavioral evidence.** Many have indirect
coverage via integration tests but don't reference the action enum
directly, so the scanner can't credit them.

## What "are we treading old ground?" means in practice

For one-ability-at-a-time porting (the recent Pattern-C grind):
**low duplication risk.** The catalog in `pattern_c.py` is hand-edited
and shows status. We'd notice porting the same passive twice.

For structural work on the missing handler families: **the inventory
exists but nobody has been working from it.** `port_audit.md` lists
102 JS files with no Python counterpart but that includes false
negatives (split-into-many-files cases). The 30 largest are in
`coverage_audit.md` for triage.

For "is this verified or just running?" the medal table is now the
answer. Before tonight, no doc could answer it.

## Drift findings (live bug list)

Run: `PYTHONPATH=. python3 python/parity/drift_findings.py` →
`docs/drift_findings.md`. As of latest run:

- **48k disagreements / 0 crashes** across 43 replayed games (down from 176k after diff filtering + state-shim tuning)
- Tonight: crashes dropped **1,977 → 0** (100%):
  - 8 parser bugs fixed (msg_id → figure_key resolution, surge ability
    lookup, damage/defeated from pendingCombat, etc.)
  - `_handle_move_figure` now grants speed MP per Move action with
    JS-matching first-vs-subsequent semantics (no double-count with
    activate_dc's pre-grant)
  - `attack_target` falls back to `selectedMap.id` when `mapId` missing
  - Replay shim pre-stamps JS state from the previous recorded
    snapshot before each step:
    - Transient pending state (`pendingCombat`, `pendingDcAbilityChoice`,
      `pendingPounceSpaceChoice`, `attackTargets`) so multi-step
      combat/choice flows work against Python's atomic handlers
    - Position/MP state (`figurePositions`, `movementBank`,
      `perFigureMp`, `movementPoints`) so each step starts from JS's
      view rather than accumulated divergence
  - Last 35 MP crashes resolved: Python's path-cost was treating
    friendly figures as blockers. Per IACP rules, friendlies don't
    block traversal — only end-of-move. Added `hostile_occupied_set`
    to `get_path_cost` and threaded it through `_handle_move_pick_space`.

The 69k disagreements remaining are now informative — single-step
deltas between Python's handlers and JS's expected post-state. Each
diff points at a specific "Python's handler doesn't do X that JS does"
rather than accumulated divergence noise. The big buckets are:
- `pendingCombat` (~7k): Python's atomic attack collapses what JS keeps
  open across the combat-button sequence
- `figureMoved` (~5k): Python doesn't stamp per-figure moved flag
- `p1/p2DcList[]` mutations (~7k total): DC depletion / damage tracking
  diverges between handlers
- `totalDamageReceived` / `attackPerformedThisActivation` /
  `lastCombatResult` (~4k): combat-bookkeeping not mirrored in Python
- Pattern E + pending UI state (`pendingPatternE`, `pendingCleave`,
  `pendingWristFlamethrower`, `pendingSpacePick`): partially ported

## What changed tonight

- **Recorder no longer reads stale state.** Was using the original
  `game` reference; harness clones internally. Now uses
  `harness.getGame()`. (record-sample-games.js)
- **Headless fast-path for `dc_end_activation_`.** Calls
  `cleanupActivation` + `applyEndOfActivationEffects` directly, skips
  Discord IO. Lightweight-only.
- **Headless fast-path for `pass_activation_turn_`.** Mirrors the JS
  state mutation (`currentActivationTurnPlayerId = opponent`).
  Lightweight-only.
- **Recorder uses real `game.player1Id`** so `status_phase`'s
  `isTestGame` shortcut activates (single click sets both flags).
- **Recorder passes `lightweight: true`** so the new fast-paths fire
  and surface-event tests still pass on full-Discord paths.

Result: drift now exercises 7 action types (was 2), 13 distinct
customId prefixes (was 2). All 3,973 jest tests still pass.

## The remaining cheap unlocks

**1. Headless fast-path for `phase_gate_ready_`.** Today the recorder
spends ~4,000 steps clicking the phase gate without it advancing —
each click is wasted. Fix would be ~30 lines mirroring
`recordPhaseGateReady` + `dispatchPhaseAdvance`. Would let recordings
reach round 2.

**2. Python parsers + stub handlers for `dc_move_`, `dc_special_`,
`move_pick_`, `phase_gate_ready_`.** Currently drift skips them as
"unsupported", which trips mission_coverage's "0 unsupported" gate
and drops mission validation from 8/8 to 0/8. Adding parsers (even
no-op handlers) returns mission_coverage to honest partial-validation
numbers.

**3. Add `ActionType.X` references to existing oracle tests.** Many
combat tests exercise `attack_target` indirectly via orchestrator
helpers. A 30-minute pass adding the enum literal where it's already
used would lift several actions from UNVERIFIED to BRONZE.

**4. Each Pattern-C consumption layer ported = more passives wired.**
36 still deferred. Last night ported ~20.

## Bottom line

Layers I've worked on directly are well-verified for what they cover
(byte-identical fuzzes, oracle batteries, snapshots). The full game
loop at scale is **not** verified, because the recorder can't produce
trace data rich enough to test it. The 89% / 100% headlines from
`port_coverage.json` mean "handlers exist", not "handlers are right".

For AI training, the load-bearing layers (ability resolution, combat
math, dice, conditions) are the ones in solid shape. The unverified
~80 action types are mostly Discord-button-flow stuff that doesn't
matter for headless self-play but does matter for the live bot.
