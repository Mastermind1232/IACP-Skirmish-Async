# Coverage Audit — Single Source of Truth

Regenerated: `2026-04-25T21:31:20.282715+00:00`. Run `python3 python/parity/coverage_audit.py` to refresh.

This report cross-references the action enum, drift recordings, oracle tests, the live dispatch probe, the Pattern C catalog, and the file-by-file shape audit. It answers two questions:

1. **Have we ever observed each kind of action in a real game?**
2. **What's the honest, current completion estimate?**

## Headline

- **Weighted completion estimate: 56.2%** (layer-by-layer below)
- **Action types**: 81 total, 18 ever observed in any drift recording
- **Drift evidence**: 8,600 recorded steps across 43 files
- **Live dispatch probe** (handler exists & runs): DC abilities 277/310, CC effects 293/293, missions 0/8, action handlers 81/81
- **Pattern C passives** wired vs deferred: 24/58 (deferred: 24)

## Verdict per action type

Each of the 81 action types gets a medal based on three signals: is it registered in the stepper, does any oracle test reference it, has any drift recording exercised it.

- **🥇 GOLD** — registered, oracle-tested, observed in drift
- **🥈 SILVER** — registered, observed in drift, no targeted oracle
- **🥉 BRONZE** — registered, oracle-tested, never seen in any recording
- **⬜ UNVERIFIED** — registered, no oracle, no drift evidence
- **🚫 UNREGISTERED** — enum value with no stepper handler

Counts:
- GOLD: **2**
- SILVER: **16**
- BRONZE: **0**
- UNVERIFIED: **63**
- UNREGISTERED: **0**

### GOLD (2)

| Action | Drift hits | Drift files | Oracle tests |
|---|---|---|---|
| `activate_dc` | 724 | 43 | 2 |
| `attack_target` | 70 | 14 | 1 |

### SILVER (16)

| Action | Drift hits | Drift files | Oracle tests |
|---|---|---|---|
| `end_activation_phase` | 3539 | 43 | 0 |
| `phase_gate_ready` | 942 | 27 | 0 |
| `dc_end_activation` | 677 | 27 | 0 |
| `move_pick_space` | 602 | 24 | 0 |
| `move_figure` | 438 | 27 | 0 |
| `end_end_of_round` | 316 | 27 | 0 |
| `combat_gate` | 291 | 14 | 0 |
| `pass_activation_turn` | 266 | 27 | 0 |
| `dc_special` | 257 | 27 | 0 |
| `combat_ready` | 139 | 14 | 0 |
| `combat_roll` | 136 | 14 | 0 |
| `dc_ability_choice` | 51 | 16 | 0 |
| `pounce_space` | 49 | 14 | 0 |
| `combat_surge` | 42 | 13 | 0 |
| `combat_reroll` | 31 | 12 | 0 |
| `combat_resolve` | 16 | 11 | 0 |

### UNVERIFIED (63)

| Action | Drift hits | Drift files | Oracle tests |
|---|---|---|---|
| `arsenal_pick` | 0 | 0 | 0 |
| `auto_deploy` | 0 | 0 | 0 |
| `bomb_drop_space` | 0 | 0 | 0 |
| `bo_rifle_skip` | 0 | 0 | 0 |
| `bo_rifle_use` | 0 | 0 | 0 |
| `cc_cancel_play` | 0 | 0 | 0 |
| `cc_choice` | 0 | 0 | 0 |
| `cc_confirm_play` | 0 | 0 | 0 |
| `cc_draw` | 0 | 0 | 0 |
| `cc_space` | 0 | 0 | 0 |
| `celebration_pass` | 0 | 0 | 0 |
| `celebration_play` | 0 | 0 | 0 |
| `combat_passive` | 0 | 0 | 0 |
| `combat_skip_surges` | 0 | 0 | 0 |
| `combat_token` | 0 | 0 | 0 |
| `comm_disruption_play` | 0 | 0 | 0 |
| `comm_disruption_skip` | 0 | 0 | 0 |
| `confirm_attachment` | 0 | 0 | 0 |
| `cover_fire_block` | 0 | 0 | 0 |
| `cover_fire_skip` | 0 | 0 | 0 |
| `dc_action` | 0 | 0 | 0 |
| `deployment_done` | 0 | 0 | 0 |
| `deploy_figure` | 0 | 0 | 0 |
| `deploy_pick` | 0 | 0 | 0 |
| `deploy_row` | 0 | 0 | 0 |
| `determine_initiative` | 0 | 0 | 0 |
| `draft_random` | 0 | 0 | 0 |
| `draw_cc` | 0 | 0 | 0 |
| `end_round_pass` | 0 | 0 | 0 |
| `end_start_of_round` | 0 | 0 | 0 |
| `end_turn` | 0 | 0 | 0 |
| `false_orders_attack` | 0 | 0 | 0 |
| `false_orders_move` | 0 | 0 | 0 |
| `false_orders_skip` | 0 | 0 | 0 |
| `interact` | 0 | 0 | 0 |
| `map_confirm` | 0 | 0 | 0 |
| `map_go_back` | 0 | 0 | 0 |
| `map_type_choice` | 0 | 0 | 0 |
| `missile_salvo_die` | 0 | 0 | 0 |
| `missile_salvo_done` | 0 | 0 | 0 |
| `move_letter` | 0 | 0 | 0 |
| `move_mp` | 0 | 0 | 0 |
| `ob_space` | 0 | 0 | 0 |
| `overwatch_space` | 0 | 0 | 0 |
| `phase_gate_unready` | 0 | 0 | 0 |
| `pick_zone` | 0 | 0 | 0 |
| `play_cc` | 0 | 0 | 0 |
| `play_cc_double` | 0 | 0 | 0 |
| `play_cc_special` | 0 | 0 | 0 |
| `power_token_choice` | 0 | 0 | 0 |
| `pt_overflow` | 0 | 0 | 0 |
| `refresh_map` | 0 | 0 | 0 |
| `rush_push_fig` | 0 | 0 | 0 |
| `rush_push_skip` | 0 | 0 | 0 |
| `select_map` | 0 | 0 | 0 |
| `shoulder_rush_fig` | 0 | 0 | 0 |
| `shoulder_rush_skip` | 0 | 0 | 0 |
| `special_action` | 0 | 0 | 0 |
| `spread_pain_cond` | 0 | 0 | 0 |
| `strain_choice_alldmg` | 0 | 0 | 0 |
| `strain_choice_discard` | 0 | 0 | 0 |
| `submit_squad` | 0 | 0 | 0 |
| `undo` | 0 | 0 | 0 |

## Pattern C catalog — passive abilities ledger

Hand-maintained in `python/engine/abilities/pattern_c.py:_CATALOG`. Promoting an ability from `deferred-*` to `wired-engine` requires porting its consumption layer (combat handler, bridge, etc.).

| Status bucket | Count |
|---|---|
| `wired-engine` | 24 |
| `deferred-handler-combat` | 10 |
| `data-only-unreferenced` | 10 |
| `deferred-bridge` | 7 |
| `deferred-handler-other` | 3 |
| `deferred-cc-timing` | 3 |
| `deferred-abilities-js` | 1 |

## Oracle tests by area

| Area | Files | JS-parity | Snapshot | Probe | Unit | Test fns |
|---|---|---|---|---|---|---|
| abilities | 25 | 0 | 2 | 0 | 23 | 651 |
| cards | 1 | 0 | 1 | 0 | 0 | 2 |
| combat | 12 | 3 | 0 | 1 | 8 | 205 |
| conditions | 3 | 0 | 0 | 1 | 2 | 32 |
| los | 4 | 1 | 0 | 3 | 0 | 21 |
| missions | 1 | 0 | 0 | 0 | 1 | 41 |
| movement | 4 | 1 | 0 | 1 | 2 | 42 |

## Top file-level gaps (from `port_audit.md`)

Note: file-name match. Some "MISSING" entries are actually split across multiple Python files — this surfaces the largest 30 raw gaps so you can manually sift true missing vs. structurally split.

| JS file | LOC | Fns |
|---|---|---|
| `src/game/abilities.js` | 9798 | 15 |
| `src/handlers/dc-play-area.js` | 3698 | 37 |
| `src/engine/combat-bridge.js` | 2930 | 8 |
| `src/engine/available-actions.js` | 2394 | 44 |
| `src/handlers/post-deploy.js` | 1871 | 35 |
| `src/handlers/cc-hand.js` | 1721 | 31 |
| `src/engine/activation-setup.js` | 1383 | 3 |
| `src/handlers/combat-special-effects.js` | 1192 | 36 |
| `src/handlers/combat-reactions.js` | 910 | 11 |
| `src/handlers/recover.js` | 839 | 21 |
| `src/handlers/index.js` | 721 | 4 |
| `src/handlers/blitz-deploy.js` | 712 | 19 |
| `src/game/validation.js` | 696 | 13 |
| `src/handlers/favorites.js` | 664 | 17 |
| `src/engine/setup-bridge.js` | 609 | 5 |
| `src/engine/misc-helpers.js` | 598 | 15 |
| `src/handlers/game-tools.js` | 504 | 6 |
| `src/handlers/fast-forward.js` | 468 | 11 |
| `src/engine/message-updaters.js` | 467 | 12 |
| `src/game/activation-state.js` | 462 | 2 |
| `src/handlers/map-events.js` | 410 | 8 |
| `src/handlers/post-combat.js` | 332 | 5 |
| `src/engine/defeat-handler.js` | 321 | 1 |
| `src/engine/action-types.js` | 284 | 1 |
| `src/handlers/botmenu.js` | 266 | 10 |
| `src/engine/scenario-mutators.js` | 264 | 4 |
| `src/game/cc-passive-redraw.js` | 247 | 6 |
| `src/engine/game-creation-bridge.js` | 244 | 11 |
| `src/game/movement-interrupts.js` | 200 | 3 |
| `src/handlers/lobby.js` | 170 | 2 |

## Weighted completion estimate

Layer-by-layer breakdown. Weights reflect importance for AI training (ability resolution and combat are most load-bearing).

| Layer | Weight | Ratio | Contribution |
|---|---|---|---|
| Ability resolution | 25 | 0.894 | 22.34 |
| Combat math/primitives | 15 | 0.950 | 14.25 |
| Action types verified (GOLD+SILVER) | 20 | 0.222 | 4.44 |
| Pattern C wired ratio | 10 | 0.414 | 4.14 |
| Command card effects | 10 | 1.000 | 10.0 |
| Mission scoring | 10 | 0.000 | 0.0 |
| Discord-flow handlers | 10 | 0.100 | 1.0 |
| **Total** | **100** | — | **56.2** |

## What this audit *cannot* tell you

- Whether a "real" handler is **correct** — only that it executes. Correctness lives in the oracle tests for that handler.
- Whether a SILVER/UNVERIFIED handler would crash under unusual state — synthetic ctx and drift coverage both bias toward common paths.
- Whether the Pattern C catalog's `wired-engine` claim corresponds to a real handler — that's a hand-maintained promise.
- Whether the file-name matcher in `port_audit.md` correctly attributes split-file ports — it does not.

Closing the BRONZE/UNVERIFIED action types requires either fixing the JS recorder to drive mid-activation actions (attack/move/CC/choices), or building targeted scripted scenarios that exercise each handler against a JS fixture.

