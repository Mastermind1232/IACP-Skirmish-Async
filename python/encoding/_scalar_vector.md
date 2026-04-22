# D7.4 — Scalar global vector

Commits the non-spatial scalar vector shape: field inventory, block layout,
index contract, normalization policy, and POV rotation semantics.

Doc-only slice. No engine code. Unblocks D7.5 (`encode_state`) and D7.6
(`decode_state`) by pinning the scalar vector shape contract.

---

## Decision

**Scalar vector: `S = 1481` floats**, indexed as `scalar[0..1480]` with block
ranges documented below. Stored as `float32`. POV-symmetric: encoder rotates
`p1_*` / `p2_*` state fields to `own_*` / `opp_*` before emitting, so one
network can play either seat.

This is larger than the plan's `e.g., 128` suggestion. The number is driven
by honest encoding of three high-cardinality facts that D7.1 surfaced:

- **293-CC library** (own hand bitset + both discard bitsets): **879 scalars**.
- **241-DC library** (both squad-roster bitsets): **482 scalars**.
- **50 non-coord pending-state flags** (coord-carrying pending fields already
  live in the spatial tensor's Group G, per D7.2 — not re-encoded here).

Plan target `~128` was a rough magnitude from before the D7.1 field inventory
and D7.2 channel-list commits. After the inventory, the correct number is
driven by "what does a lossless POV encoding cost" — not a capacity budget.

---

## POV rotation

The scalar vector is encoded from `pov_player`'s perspective. Given a raw
`GameState`, the encoder reads the `pov_player`'s fields into `own_*` slots
and the opponent's fields into `opp_*` slots. This means:

- A single network head serves both seats.
- Training mirrors half the replay buffer's POV automatically (flip POV on
  re-encode, label `z` negates, `π` pre-image remains legal).
- The spatial tensor's per-figure channels (D7.2 Groups A and B) also rotate
  so "own figures" is always the first half of the per-player split.

Non-POV scalars (mission ID, round number) are encoded raw. Initiative holder
and active-player are written as `own_*` / `opp_*` one-hot pairs instead of
absolute player-number so the rotation is total.

---

## Block inventory

| Block | Name                       | Idx range    | Size | Notes |
|---    |---                         |---           |---   |---    |
| A     | Meta (mission + round)     | 0..9         | 10   | mission one-hot ×8 + round normalizations ×2 |
| B     | Phase + lifecycle          | 10..26       | 17   | phase + round-phase one-hots + seat markers |
| C     | VP + win thresholds        | 27..34       | 8    | own/opp VP + margin + threshold flags |
| D     | Activations remaining      | 35..54       | 20   | one-hot 0..9 per side |
| E     | Affiliation                | 55..60       | 6    | Rebel/Imperial/Merc one-hot per side |
| F     | Squad cost                 | 61..64       | 4    | normalized squad cost + initiative-tie flag |
| G     | Own CC hand (full info)    | 65..358      | 294  | hand size + 293-slot CC bitset |
| H     | CC discards (both, public) | 359..944     | 586  | 293 own + 293 opp bitsets |
| I     | Hidden deck counts         | 945..948     | 4    | own deck + opp hand + opp deck (sizes only) |
| J     | DC squad rosters           | 949..1430    | 482  | 241 own + 241 opp bitsets |
| K     | Pending-state flags        | 1431..1480   | 50   | non-coord `pending*` bits |

**Total: 10 + 17 + 8 + 20 + 6 + 4 + 294 + 586 + 4 + 482 + 50 = 1481 scalars.**

---

## Per-block detail

### Block A — Meta (idx 0..9)

| idx | field                          | notes |
|---  |---                             |---    |
| 0..7 | mission one-hot over 8 canonical missions | mos-eisley-outskirts, corellian-underground, chopper-base-atollon, lothal-wastes, development-facility, devaron-garrison, anchorhead-cantina-bar, hoth-battle-station |
| 8   | `min(round / 10, 1.0)`          | linear round, saturating |
| 9   | `round >= 4`                    | post-SoR-ramp indicator (binary) |

### Block B — Phase + lifecycle (idx 10..26)

| idx | field | notes |
|---  |---    |---    |
| 10..15 | phase one-hot (size 6)  | Pin to `python.engine.phases.Phase` enum at D7.5 write time. Current JS enum: squad_select, deployment, cc_draw, round, game_over. If the enum grows beyond 6, reserve idx 15 as an "other" bucket and pin the mapping explicitly. |
| 16..19 | round_phase one-hot (size 4) | status / activation / end_of_round / other. Pin to `python.engine.phases.RoundPhase` at D7.5. |
| 20..21 | `own_holds_initiative`, `opp_holds_initiative` one-hot | mutually exclusive |
| 22..23 | `own_is_active_player`, `opp_is_active_player` one-hot | active side controls the next action |
| 24..25 | reserved (phase continuation flags) | claim in first revision if needed |
| 26 | `sor_effects_pending`              | 1 iff `runStartOfRoundDcEffects` has queued async work (D5.9 SoR queue) |

### Block C — VP + win thresholds (idx 27..34)

| idx | field | notes |
|---  |---    |---    |
| 27  | `min(own_vp / 40, 1.0)` | canonical 40-point win threshold |
| 28  | `min(opp_vp / 40, 1.0)` |  |
| 29  | `(own_vp - opp_vp) / 40` | signed margin, clamped to [-1, 1] |
| 30  | `own_vp >= 40` | canonical win flag |
| 31  | `opp_vp >= 40` |  |
| 32  | `own_vp >= 30` | near-threshold pressure |
| 33  | `opp_vp >= 30` |  |
| 34  | reserved | |

### Block D — Activations remaining (idx 35..54)

| idx | field | notes |
|---  |---    |---    |
| 35..44 | `own_activations_remaining` one-hot 0..9 | ≥9 clamped into slot 9 |
| 45..54 | `opp_activations_remaining` one-hot 0..9 | |

Per D5.11 / `recompute_activation_counts` (D2.29), activation counts are
re-derived from `figurePositions` each round reset. The scalar encoder reads
the already-computed counts off `game.activationsRemaining[player]`.

### Block E — Affiliation (idx 55..60)

| idx | field | notes |
|---  |---    |---    |
| 55..57 | own affiliation one-hot (Rebel / Imperial / Merc) |  |
| 58..60 | opp affiliation one-hot |  |

### Block F — Squad cost (idx 61..64)

| idx | field | notes |
|---  |---    |---    |
| 61  | `own_squad_cost / 40` | normalized; 40-point armies are the standard cap |
| 62  | `opp_squad_cost / 40` |  |
| 63  | `own_squad_cost < opp_squad_cost` | initiative tiebreaker per commit `64303bd` (lower-cost squad wins tie) |
| 64  | reserved |  |

### Block G — Own CC hand (idx 65..358)

| idx | field | notes |
|---  |---    |---    |
| 65  | `min(own_hand_size / 8, 1.0)` | hand cap ≈8 under standard draw rules |
| 66..358 | own CC hand bitset over 293 canonical CC names | 1 per card currently held |

**Private info.** From the POV player, this is fully observable. Enemy hand
identity is intentionally NOT encoded — see Block I.

### Block H — CC discards (idx 359..944)

| idx | field | notes |
|---  |---    |---    |
| 359..651 | own CC discard bitset (293) | public info — IA discard piles are face-up |
| 652..944 | opp CC discard bitset (293) | public info |

Discard piles let the network infer deck composition for both sides (what
has been played vs. what can still be drawn).

### Block I — Hidden deck counts (idx 945..948)

| idx | field | notes |
|---  |---    |---    |
| 945 | `min(own_deck_size / 10, 1.0)` | own deck count (POV player sees their own deck size directly) |
| 946 | `min(opp_hand_size / 8, 1.0)` | opp hand SIZE only, not identities |
| 947 | `min(opp_deck_size / 10, 1.0)` |  |
| 948 | reserved |  |

**Imperfect-info boundary.** Under async IA rules, enemy hand identities are
hidden. The scalar vector commits to this: only counts for the opponent, no
identity bitset. Future Monte Carlo sampling for MCTS may reconstruct
plausible enemy hands from the discard + deck size; that sampling is a
Phase-F Imperfect-info concern (memory project_alphazero_skirbo), not an
encoder concern.

### Block J — DC squad rosters (idx 949..1430)

| idx | field | notes |
|---  |---    |---    |
| 949..1189 | own squad DC bitset over 241 canonical DC names | 1 iff the DC is in the player's original squad (whether or not any figures remain alive) |
| 1190..1430 | opp squad DC bitset |  |

**Roster vs. presence.** This is the *original roster* — set at squad-select,
immutable for the game. The *live presence* of figures on the board lives in
the spatial tensor (D7.2 Groups A and B per-figure channels). A DC with all
figures dead is still 1 in the roster bitset but contributes zero spatial
channels — the network can distinguish "Vader squad lost" from "Trooper squad
lost".

**Per-DC-group exhaust state.** Per-deployment-group activation state
(`has_activated_this_round`) already lives in the spatial tensor as a
per-figure channel in D7.2 Group E. The scalar vector does NOT duplicate it.

### Block K — Pending-state flags (idx 1431..1480)

50 binary flags for non-coord pending-state fields from
`python/engine/pending_state_inventory.md`. Coord-carrying pending fields
(target prompts, landing-space prompts) already surface as spatial masks in
D7.2 Group G and are NOT duplicated here.

| idx | field | notes |
|---  |---    |---    |
| 1431 | `pendingCombat` active | attack pipeline mid-flight |
| 1432 | `pendingOverrideAttackDice` active | dice-pool surgery pending |
| 1433 | `pendingStrainChoice` active | HP-vs-CC-discard prompt |
| 1434 | `pendingPowerTokenGrant` active | flawless-execution-style grant |
| 1435 | `pendingPowerTokenOverflow` active | per-figure cap exceeded, discard prompt |
| 1436 | `pendingReaction` active | combat-reaction window open |
| 1437 | `pendingEndTurn` active | end-of-activation CC-play window |
| 1438 | `pendingCcChoice` active | CC-play choice |
| 1439 | `pendingCcConfirmation` active | CC-play confirmation |
| 1440 | `pendingCcSpaceChoice` active | CC-play space-picker |
| 1441 | `pendingDcChoice` active | DC-play / companion-choice |
| 1442 | `pendingCardPick` active | multi-card pick prompt |
| 1443 | `pendingFigurePick` active | target-figure prompt |
| 1444 | `pendingSorActions` non-empty | SoR queue populated |
| 1445 | `pendingEorActions` non-empty | EoR queue populated |
| 1446 | `pendingMassivePush` active | massive-figure displacement resolution |
| 1447 | `pendingMassiveDisplacement` active | massive-target displacement queue |
| 1448 | `pendingKrykaRespawn` active | Krykna mid-round respawn (D3 E.3) |
| 1449 | `pendingFluctuationSwapQueue` non-empty | Lothal Wastes B swap queue active (D3.10) |
| 1450 | `pendingFluctuationSwapFirst` active | first-click pinned |
| 1451 | `pendingAbilityChain` depth ≥ 1 | generic Pattern E mid-resolution |
| 1452 | `pendingLieInAmbush` active | ambush interrupt pending (D3 E.6) |
| 1453 | `pendingForcePush` active | Force Push target/landing (D3.8 E.1) |
| 1454 | `pendingForceThrow` active | D3.11 E.16 |
| 1455 | `pendingWristCord` active | D3.15 |
| 1456 | `pendingMandalorianWhip` active | D3.15 |
| 1457 | `pendingHopOn` active | D3.13 |
| 1458 | `pendingHavocShot` active | D3 E.4 |
| 1459 | `pendingBarrage` active | D3 E.5 |
| 1460 | `pendingWookieeRage` active | D3 E.8 |
| 1461 | `pendingSaberOrbit` active | D3 E.15 |
| 1462 | `pendingWildCohesion` active | D3 E.7 |
| 1463 | `pendingYhsiw` active | D3 E.9 |
| 1464 | `pendingNegation` active | D3 E.10 |
| 1465 | `pendingBleeding` active | D3 E.11 |
| 1466 | `pendingThereIsNoTry` active | D3 E.12 |
| 1467 | `pendingEmperorTrap` active | D3 E.13 |
| 1468 | `pendingExecutiveOrder` active | D3 E.14 |
| 1469 | `pendingBattlefieldLeadership` active | D3 E.17 |
| 1470 | `pendingHeroicEffort` active | D3 E.18 |
| 1471 | `pendingFiringSquad` active | D3 E.19 |
| 1472 | `pendingSentryMultiFire` active | shared `multi_fire` pointer (D3 E.20) |
| 1473 | `pendingDeploymentChoice` active | deployment branch prompt |
| 1474 | `pendingLoadoutCard` active | setup loadout attachment |
| 1475 | `pendingReactionPick` active | multi-reaction disambiguator |
| 1476 | `pendingOverrunDamage` active | move-through-enemy damage |
| 1477 | `pendingCutAndRunDamage` active | |
| 1478 | `pendingDefeatResolution` active | mid-defeat cleanup pause |
| 1479 | `pendingInitiativeChoice` active | initiative-tie player pick |
| 1480 | catch-all `anyOtherPending` | 1 iff any pending field not listed above is active |

Exact per-flag bindings pin to the `python.engine.pending_state_inventory`
module at D7.5 write time. The list above is the declared 50-slot allocation;
any pending field not on the named list routes to idx 1480 so the encoder is
still lossy-safe against future ports that introduce a new pending field.

---

## Normalization policy

- **Binary facts**: stored as `0.0` or `1.0` (not logits).
- **Bounded counts** (VP, hand size, deck size, round, activations): divided
  by a canonical cap (40, 8, 10, 10, 10) and clamped to `[0, 1]` or `[-1, 1]`
  for signed values (VP margin).
- **Signed deltas**: signed normalization in `[-1, 1]`.
- **Unbounded counts**: there are none in this vector — all counts have a
  canonical game-rules cap.

No z-score normalization, no running-mean / running-std. The network's input
stem (D8.4) will include BatchNorm to handle activation-distribution drift;
the encoder commits only to fixed scale.

---

## Rationale — why 1481 not 128

The plan's original `e.g., 128` suggestion pre-dated the D7.1 field inventory.
Once every non-UI, non-log state field is classified (D7.1) and the spatial
channels are committed (D7.2), the residual scalar requirements are driven by
three factual sources:

1. **CC library cardinality (293).** Own hand + both discards require three
   bitsets of length 293 → 879 scalars. Replacing with "summary counts"
   would lose which cards are gone vs. playable — a correctness-critical
   planner fact.
2. **DC library cardinality (241).** Squad rosters require two bitsets of
   length 241 → 482 scalars. Same rationale: without the per-DC roster, the
   network can't distinguish a Vader squad from a Stormtrooper squad after
   all figures die.
3. **Pending-state surface area.** ~50 distinct non-coord `pending*` fields
   from the D1.12 inventory. Each is a planning-relevant flag (mid-pipeline
   vs. idle).

The remaining ~70 scalars (Blocks A–F + I) cover POV, VP, phase, activations,
affiliation, and squad cost. These are the scalars the `e.g., 128` suggestion
anticipated.

**Plan suggestion honored in spirit.** The plan's goal was "capture every
non-spatial fact"; 128 was a pre-inventory estimate of how many that would be.
The post-inventory number is 1481. Memory-wise 1481 `float32`s is ~6 KB per
state — trivially within the 10 GB VRAM budget at batch 256 (~1.5 MB of
scalar data per batch).

---

## Revision policy

The scalar vector size `S = 1481` and the block layout are **stable contract**
from this slice onward. New scalar fields land as explicit reserved-slot
allocations (Block B idx 24-25, Block C idx 34, Block F idx 64, Block I idx
948) or as a new block appended after Block K (idx 1481+).

Library growth:

- **New CC added** → Blocks G and H grow by 3 positions (own hand + 2
  discards). Recorded as a separate slice; existing indices shift one-time;
  trained weights migrate by zero-pad on the new slot.
- **New DC added** → Block J grows by 2 positions. Same migration pattern.
- **New mission added** → Block A mission one-hot grows by 1.

All migrations are deterministic and rerunnable against the training replay
buffer via the bijection (D7.6 decoder) + re-encoding under the new layout.

---

## Decode contract

`decode_state(spatial, scalar, pov_player) -> GameState` must recover every
field listed in Blocks A–K on the POV player's side. Bijection is required
over the set of POV-observable facts (D7.7). Enemy hand identity is
explicitly NOT recoverable from the scalar vector under Block I's
imperfect-info commitment — that's a decode-time constraint, not a bijection
failure. The D7.7 bijection test masks enemy hand identity when comparing
round-tripped state.

---

## POV swap semantics

`encode_state(game, pov_player)` produces a vector where:

- Block A (mission, round) is absolute.
- Block B (phase, initiative, active-player) uses `own_*` / `opp_*` one-hots.
- Blocks C, D, E, F, G, H, I, J, K use `own_*` / `opp_*` slot assignments.

`encode_state(game, 1) ≡ encode_state(swap_players(game), 2)` up to POV.
Training on `(state, π, z)` tuples mirrors half the buffer by flipping POV
before the scalar encode — this halves the effective sample requirement at
no correctness cost.

---

## Verification checklist

- [x] Every `own_*` / `opp_*` field pair exists in both positions (no
      accidental POV asymmetry).
- [x] Sum of block sizes = 1481 (matches declared total).
- [x] Every non-coord pending-state field from `pending_state_inventory.md`
      has either a dedicated slot in Block K or routes to the catch-all idx
      1480.
- [x] No Block K slot duplicates a coord-carrying pending field that already
      lives in spatial Group G.
- [x] Imperfect-info boundary pinned: own CC identities encoded, opp CC hand
      identities NOT encoded.
- [x] All bounded counts have a canonical cap documented (40, 8, 10).
- [x] POV rotation is total across Blocks B–K (no seat-specific raw slot).

---

## Out of scope

- `encode_state` implementation (D7.5).
- `decode_state` implementation (D7.6).
- Spatial tensor shape (D7.3 — already committed at `[96, 32, 32]`).
- Bijection tests (D7.7) and 10K round-trip (D7.10).
- Batch encoder (D7.9).
- Imperfect-info enemy-hand sampling for MCTS (Phase F future work).
- Network input stem — lives in D8.4 (combines spatial conv + scalar MLP).
