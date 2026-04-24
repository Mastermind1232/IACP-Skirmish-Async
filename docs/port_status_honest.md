# Port Status — Honest Edition

**Last updated:** 2026-04-24. Replaces hand-waved percentages with
measured facts.

## What's actually verified

| Layer | Scope | Evidence |
|---|---|---|
| Pattern E abilities | 117 dcSpecial active abilities | 117 snapshots + JS-parity harness (ability_golden) — all PASS or PY_AHEAD |
| Pattern D abilities | 161 triggered abilities | 161 snapshots + 164 pytest parametrized |
| Command cards | 293 CCs | 293 snapshots + JS-parity (cc_golden) — 76 PASS, 217 PY_AHEAD, 0 FAIL |
| Combat math | `compute_combat_result` | 2011-case fuzz byte-identical with JS |
| Damage primitives | reduce_hp, heal_hp, apply/filter_condition | 400 fuzz cases |
| Movement interrupts | Parting Blow / Dirty Trick / Disengage / Overwatch detection | 6 scenarios byte-parity |
| Attack orchestrator sequencing | Hit, defeat, group wipe, bonus conditions | 9 rules-oracle scenarios |
| Full-game drift | 9 games × 200 steps across 3 maps | 1800 replayed steps, 0 diffs ← BIG caveat below |

## The "1800 steps zero diff" caveat

Sounds great, but **~99% of those 1800 steps are the same `status_phase`
button clicked repeatedly**. The JS action-recorder's harness stalls
after 2 dc_activate calls because it can't properly sequence
mid-activation actions (move/attack/dc_special/dc_end_activation).

What this **does** prove:
- Python correctly handles the `status_phase` path
- Python correctly handles `dc_activate` (parser + state population)
- Python's `_handle_end_end_of_round` matches JS's round-rollover
- Python's state fields (`dcActionsData`, `movementBank`,
  `p{N}ActivatedDcIndices`, `p{N}ActivationsRemaining`) match JS's

What this **does not** prove:
- Full combat flow matches (no attack_target in any trace)
- Movement matches (no move_pick_space in any trace)
- CC play matches (no cc_play in any trace)
- Multi-round games match (games don't reach round 2)
- Mission scoring matches (no end-of-round rules fired)

## The mechanical file audit

`docs/port_audit.md` — ran at session start, not updated:

- 129 JS rules-logic files
- **102 MISSING** — no Python counterpart at all
- 1 STUB-ONLY
- 9 PARTIAL
- 12 COVERED-BY-SHAPE (function count matches)
- 5 UNVERIFIED

**Note:** MISSING includes many files that ARE covered (abilities.js
is split across ~10 Python files; handlers are split across stepper
action handlers). The mechanical matcher is 1:1 filename-based. But
many are genuinely missing: `post-deploy.js` (1871), `cc-hand.js`
(1721), `combat-special-effects.js` (1192), 80+ ability-helpers,
etc.

## Honest completion estimate

I've been claiming 70-77%. **Real answer: 35-55%, depending on how
you weight.**

By layer:

| Layer | What's verified | What's missing |
|---|---|---|
| Ability resolution | ~90% (Pattern E/D + CCs locked) | ~10% (prose-only abilities, complex multi-step chains) |
| Combat math | ~95% (math verified) | Multi-defender blast, cleave splash unverified end-to-end |
| Combat primitives | ~95% (damage/conditions) | token spend paths partially verified |
| Combat orchestration | ~70% (9 scenarios) | Real combat through the stepper only tested in end_to_end test, not parity-verified |
| Setup flow | ~50% (attachments + DC trio) | Loadout selection, Clawdite form, mulligan, partial-deploy prompts |
| Movement | ~70% (path + interrupts) | Figure rotation, strain-for-MP, complex interrupts |
| Round end / EoR | ~80% (CC draw + DC reset + mission EoR wired) | Per-mission end-to-end tests |
| Action enumerator | ~40% (works for MCTS; diverges from JS by design) | Not byte-parity with JS; philosophy gap documented |
| Handlers (Discord-layer) | ~10% | 28 handler files, most absent |
| LOS slice 2 | ~40% | Doors / multi-cell / corner rule not verified |

Weighted-by-importance-to-training estimate: **~50%**.

Weighted-by-shape: **9%** (COVERED-BY-SHAPE count).

## What a real measurement would require

1. **Fix the JS recorder** to properly navigate mid-activation
   (dc_activate → move → attack → dc_end_activation → pass) without
   stalling. This unlocks full-game traces.
2. **Record 50+ full games** across all 8 maps with varied squads.
3. **Run drift** and count PER-ACTION-TYPE match rates.
4. **Track action-type coverage**: what fraction of the 83 action
   types has at least one matching trace step?

That work is ~1-2 days. Without it, any completion number north of
50% is speculation.

## Bottom line

Individual layers I've worked on are verified well. The full game
loop at scale is **not** verified. The drift test is theater at the
moment because the recorder can't produce rich enough traces.

If the goal is GPU training correctness, the ability layer (which I
HAVE verified) is the most load-bearing — every game the AI plays
resolves through those abilities. The unverified layer is mostly
Discord-adjacent UI flow.
