# JS → Python Port Status

**Last updated:** 2026-04-24. Anti-backtracking ground-truth.

This is the honest map of what's been ported. Mechanical audit
(`python -m python.parity.port_audit`) lives at `docs/port_audit.md`
as raw data; this document adds the human judgement the mechanical
audit can't make (e.g. `abilities.js` is split across ten Python
files so the mechanical mapper flags it MISSING even though it's
substantially ported).

## Legend

- **DONE** — behavior verified against JS via parity test or snapshot
- **CLOSE** — most behavior present; known small gaps documented
- **PARTIAL** — meaningful subset done, large known gaps
- **STUB** — Python file exists but minimal
- **MISSING** — no Python counterpart; work not started

Only DONE entries should be considered trustworthy for training.

---

## Layer 1 — Core game mechanics (rules engine)

| Area | JS source | Python | Status | Notes |
|---|---|---|---|---|
| Action types enum | `src/engine/action-types.js` | `python/engine/actions.py` | DONE | 83 types registered; all stepper handlers wired |
| Action handlers (stepper) | `src/handlers/*.js` | `python/engine/stepper.py` | PARTIAL | 83/83 types registered, but many handlers are thin vs JS; needs per-type behavioral parity |
| Action parser (customId → Action) | JS routed via handler registry | `python/engine/action_parser.py` | PARTIAL | 619 LOC; covers common paths; ValueError → pending-stamp fallback for gaps |
| Legal-action enumerator | `src/engine/available-actions.js` (2394 LOC) | `python/mcts/actions.py` | PARTIAL | Used by MCTS; not byte-parity with JS |
| Combat resolution | `src/handlers/combat.js` (6335 LOC) + `src/engine/combat-bridge.js` (2930 LOC) + `src/game/combat.js` (370) | `python/engine/mechanics/combat.py` (248), `combat_declare.py`, `combat_defense_friends.py`, `attack_orchestrator.py` (662) | PARTIAL | Attack orchestrator is the main path; surge/reroll/override wiring exists; NOT behaviorally verified end-to-end |
| Movement | `src/game/movement.js` (1099) + `src/handlers/movement.js` (1463) + `src/game/movement-interrupts.js` (200) | `python/engine/mechanics/movement_board.py` + `movement_cache.py` (501) | PARTIAL | Basic MP/path cache done; interrupt chain, rotation, strain-for-MP unverified |
| Line of sight | Inside `src/game/combat.js` + `src/game/spatial.js` | `python/engine/mechanics/los.py` (247) | CLOSE | Figure-blocking LOS verified via slice-1 parity; slice-2 (doors/multi-cell) deferred |
| Conditions (Bleed/Burn/Stun/etc.) | `src/game/conditions.js` (89) | `python/engine/mechanics/conditions.py` (128) | CLOSE | 6 conditions implemented; clears at end-of-round |
| Strain + Power Tokens | Scattered in combat.js/activation.js | `python/engine/mechanics/strain.py` (92), `tokens.py` (114) | PARTIAL | Grant/spend works; overflow unverified |
| CC timing gates | `src/game/cc-timing.js` (619) | `python/engine/mechanics/cc_timing.py` (630) | CLOSE | 15 JS fns ≤ 16 Python fns; shape matches |
| Phase gates (SOR/EOR) | `src/game/phase-gate.js` (358) + `src/handlers/phase-gate.js` (426) | `python/engine/mechanics/phase_gate.py` (136) | PARTIAL | Basic phase transitions; full handler path unverified |
| Round effects | `src/handlers/round.js` (2154) | `python/engine/mechanics/round_effects.py` (183) | PARTIAL | 3 Python fns vs 28 JS; lots of round-end cleanup missing |
| Mission scoring | `src/game/mission-rules.js` (711) + `src/engine/mission-helpers.js` | `python/engine/mechanics/mission_rules.py` (979) | CLOSE | 12 fns vs 8 JS; unverified per-mission |
| NPC lifecycle | Scattered in handlers + game | `python/engine/mechanics/npc.py` (159) | PARTIAL | Krykna/Thugs/Wampa/Nexu — partial coverage |
| Interact (crate/terminal) | `src/handlers/interact.js` (201) | `python/engine/mechanics/interact.py` (142) | CLOSE | 2 fns match; basic flow works |
| Defeat + self-defeat | `src/engine/defeat-handler.js` (321) | `python/engine/mechanics/defeat.py` (368) | CLOSE | Shape matches; not verified behavior-for-behavior |
| Win conditions | `src/engine/win-conditions.js` (309) | `python/engine/mechanics/win_conditions.py` (113) | PARTIAL | 5 Python fns vs 7 JS |

## Layer 2 — Abilities

| Category | JS source | Python | Status | Notes |
|---|---|---|---|---|
| Pattern A (pure CC delta) | Inline in `src/game/abilities.js` | `python/engine/abilities/pattern_a.py` + `cards/cc_bulk_named.py` | PARTIAL | 52/55 wrapped; wrappers are mostly ValueError→pending-stamp shells, NOT real mechanics for most CCs |
| Pattern B (surge) | Inline in `src/game/combat.js` | `python/engine/abilities/pattern_b.py` (112) | PARTIAL | Surge resolution inline; not per-surge verified |
| Pattern C (passive) | Many `<keyword>-helpers.js` files + combat.js inline | `python/engine/abilities/pattern_c.py` (467) | PARTIAL | 55/63 marked 'deferred-handler-combat' — rely on combat.js-side integration, NOT yet verified |
| Pattern D (triggered) | Inline in `src/game/abilities.js` | `pattern_d.py`, `pattern_d_extras.py`, `pattern_d_handlers.py`, `bespoke_d.py` | CLOSE | 161/161 with real handlers; snapshot-locked; but fixture is minimal — many handlers return early on ctx gaps |
| Pattern E (active dcSpecial) | Inline in `src/game/abilities.js` | `pattern_e_schema.py`, `bespoke_e.py`, `force_push.py`, `force_throw.py`, `push_target_within_range.py`, `barrage.py`, `hop_on.py`, `pattern_e_bulk.py` | CLOSE | 117/117 produce post-state; 37 byte-identical to JS, 54 superset; 0 unhandled |
| Command card effects | `data/cc-effects.json` + `src/game/abilities.js` branches | `python/engine/cards/cc_effects.py` (4300+), `cc_schema.py`, `cc_bulk_named.py` | DONE | 293/293 cards behavior-verified via `python/parity/cc_golden.py`: 76 PASS byte-identical with JS, 217 PY_AHEAD (Python applies mechanic JS defers to handler). Snapshot-locked via 294 pytests. Commit 32b42dc. |

## Layer 3 — Setup + deployment

| Area | JS source | Python | Status |
|---|---|---|---|
| Game creation | `src/game-creation.js` + `src/engine/game-creation-bridge.js` | `python/engine/creation.py` (49) | STUB |
| Setup flow (zone → deploy → CC-draw) | `src/handlers/setup.js` (2604) + `src/engine/activation-setup.js` (1383) + `src/engine/setup-bridge.js` (609) | `python/engine/setup.py` (242) | PARTIAL |
| Post-deploy handlers | `src/handlers/post-deploy.js` (1871) | — | MISSING |
| Blitz deploy | `src/handlers/blitz-deploy.js` (712) | — | MISSING |
| Attachment confirmation | Inside setup.js | — | MISSING |

## Layer 4 — Handlers with NO Python counterpart

These are big-LOC JS files that nothing Python-side substantially covers:

| JS file | LOC | What it does |
|---|---|---|
| `src/handlers/dc-play-area.js` | 3698 | DC activation UI + ability choice + space picker + attack button |
| `src/engine/combat-bridge.js` | 2930 | Bridge between domain reducers and combat handlers |
| `src/engine/available-actions.js` | 2394 | Legal action enumerator (partially replicated in python/mcts) |
| `src/handlers/post-deploy.js` | 1871 | Post-deployment prompt handling |
| `src/handlers/cc-hand.js` | 1721 | CC hand display + play triggers |
| `src/handlers/combat-special-effects.js` | 1192 | Per-card combat effect skip handlers |
| `src/handlers/combat-reactions.js` | 910 | Combat-reaction prompts (interrupts) |
| `src/handlers/recover.js` | 839 | Recover action + condition discard |
| `src/handlers/blitz-deploy.js` | 712 | Blitz deploy UI |
| `src/handlers/favorites.js` | 664 | Squad/card favorites |
| `src/handlers/fast-forward.js` | 468 | Fast-forward end-of-round |
| `src/engine/message-updaters.js` | 467 | Discord embed rebuilders |
| `src/handlers/map-events.js` | 410 | Map-scripted events |
| `src/handlers/post-combat.js` | 332 | Post-combat prompt chain |
| `src/handlers/botmenu.js` | 266 | Bot UI menu |
| `src/engine/scenario-mutators.js` | 264 | Per-mission state mutations |
| `src/game/cc-passive-redraw.js` | 247 | Passive CC-redraw rules |
| `src/handlers/lobby.js` | 170 | Lobby matchmaking |
| `src/engine/prompt-reconciler.js` | 166 | Prompt reconciliation on reload |
| `src/engine/recovery.js` | 152 | Crash recovery |
| `src/handlers/space-picker.js` | 143 | Space-picker component |
| ... + ~80 smaller ability-helper files | | |

**The handler files (`src/handlers/`) are mostly Discord-glue — not all of them need a direct Python counterpart if the game logic they expose is captured in `python/engine/stepper.py`.** The question is per-handler: does the stepper's corresponding action type apply the same state transition as the JS handler?

## Honest completion estimate by layer

| Layer | Estimated completion |
|---|---|
| Core engine (actions, stepper, phases) | ~55% |
| Combat resolution | ~40% — lots of surge/override/reroll/reaction untouched |
| Movement | ~50% — cache + pathing done; interrupts + triggers partial |
| Conditions / strain / tokens | ~70% |
| Line of sight | ~80% slice-1 only |
| Mission scoring | ~50% per-mission |
| Setup flow | ~30% |
| Pattern E abilities | ~85% (snapshot-locked) |
| Pattern D abilities | ~75% (real handlers, fixture-driven) |
| Pattern A (CC mechanics) | ~30% — most are wrapper-only |
| Command card effects | ~25% — 11/293 bespoke |
| NPC lifecycle | ~50% |
| Attack orchestrator (full combat flow) | ~60% |

**Rough weighted average: ~50% of the rules engine is behaviorally ported.**

## The highest-leverage next targets, in order

1. **Command cards (293 cards)** — biggest single gap. Most go through a generic schema fallback that probably doesn't match JS. Each card needs its mechanic verified. Bulk-approach: a parity harness like `ability_golden.py` but for cc_effects.
2. **Combat resolution end-to-end** — `src/handlers/combat.js` is 6335 LOC. Python's attack_orchestrator is 662 LOC. Huge gap. Attack declare → dice roll → surge spend → reroll → defense → damage application needs a full per-phase parity test.
3. **Per-DC ability verification** — 310 DC abilities across Pattern D+E; current snapshots only lock the minimal-fixture behavior. Real games involve richer state (targets, adjacencies, power tokens already spent). Need fixture variations per ability.
4. **Setup flow** — 2600+ LOC of setup handlers. Python has 242 LOC. This is why running the game from setup produces degenerate states.
5. **Round-end cleanup + status phase** — `src/handlers/round.js` (2154 LOC) vs `round_effects.py` (183 LOC). The full round-end pipeline (mission scoring, condition clears, zone VP tick, EOR triggers) needs per-step verification.

## The rule for this campaign

**Do not mark anything DONE without a behavioral parity test that fails when the Python behavior drifts.** Period. No "I ported it, looks right, moving on."
