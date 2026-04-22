# _channel_list.md — D7.2 committed spatial-tensor channels

**Deliverable:** D7 (Lossless board tensor encoding) — atomic task 7.2.

**Verify (plan task 7.2):** Channel list documented; total channels ≤ 256.

**Version:** 1 (initial D7.2 commit, 2026-04-21).

---

## Decision summary

- **Total spatial channels: 96.** Well under the 256 hard cap from the plan;
  ~32 channels of headroom below a soft 128-channel target.
- **POV convention:** the tensor is **player-relative**. A figure owned by the
  POV player is always `friendly`; the opposite side is always `enemy`.
  `encode_state(game_state, pov_player)` is responsible for that remapping
  (D7.5). This file lists channels in friendly/enemy terms only — no `p1`/`p2`.
- **Coordinate convention:** figures / tokens / mission objects are encoded
  at the top-left of their footprint cell. Multi-cell figures (`1x2`, `2x2`,
  `2x3` from `data/figure-sizes.json`) light the footprint with an extra
  "figure interior" channel covering the full footprint.
- **Literal plan text "N_DC channels per side" is NOT taken literally.** 241
  DCs × 2 sides = 482 channels would exceed the cap by 188%. Decision: encode
  DC identity as a set of `(affiliation, size, keyword-trait)` category
  channels that cover every DC with 24 channels instead of 482. The CNN learns
  a sub-type embedding from trait combinations; exact DC-name identity lives
  in the scalar vector (D7.3) as a one-hot bitset over 241 slots per player.

> Rationale: the CNN's job on the spatial map is "what's where and how does
> it fight locally?" Keyword traits (Brawler, Trooper, Force User, etc.) + the
> DC's scalar profile (HP channel, power-token channels, condition channels,
> attack-dice from scalar) give the CNN every tactical fact it needs. Exact
> name-identity (Vader vs Maul vs Luke) is a scalar fact; it matters for
> opponent-modelling and squad-synergy reasoning, which are global not
> positional. This split mirrors AlphaZero chess/Go designs that use piece-
> type channels, not piece-identity channels.

---

## Channel ledger (index → name → source → encoding)

Counts in parentheses are cumulative after the group.

### Group A — Figure presence & ownership (3 channels, cum. 3)

| Idx | Name | Source field | Encoding | Range |
|---|---|---|---|---|
| 0  | `friendly_footprint`    | `figurePositions[pov]`     | 1.0 at every cell covered by any friendly figure's footprint | {0, 1} |
| 1  | `enemy_footprint`       | `figurePositions[!pov]`    | 1.0 at every cell covered by any enemy figure's footprint | {0, 1} |
| 2  | `figure_anchor_topleft` | `figurePositions[both]`    | 1.0 at the top-left (anchor) cell of each figure; used to key per-figure state channels below | {0, 1} |

### Group B — DC identity categories (24 channels, cum. 27)

Shared-sided (one channel per category, 1.0 under the figure's top-left
regardless of ownership — since Group A already encodes owner). 14 keyword
channels + 4 affiliation channels + 4 size-bucket channels + 1 unique flag +
1 attachment flag = 24.

Source: `figurePositions` + `data/dc-effects.json[cards][<dcName>]{keywords,
affiliation,attachment}` + `data/figure-sizes.json[figureSizes][<figureName>]`.

Encoding: each channel is 1.0 at the figure's anchor cell iff the DC carries
that category; 0.0 elsewhere. Multi-category DCs light multiple channels.

Case-normalized keyword canonicalization (mirrors JS library loader):
`WOOKIE → WOOKIEE`; `Mobile → MOBILE`; `Vehicle → VEHICLE`; `Heavy Weapon →
HEAVY WEAPON`; `Brawler → BRAWLER`. Single-DC keyword tags (`IG-88`,
`LUKE SKYWALKER`, `DARK DISCIPLE`) are dropped — handled by the scalar
DC-name bitset instead.

| Idx | Name | Category | Coverage (DCs) |
|---|---|---|---|
| 3  | `dc_trooper`       | keyword TROOPER        | 49 |
| 4  | `dc_leader`        | keyword LEADER         | 43 |
| 5  | `dc_brawler`       | keyword BRAWLER        | 42 |
| 6  | `dc_hunter`        | keyword HUNTER         | 36 |
| 7  | `dc_guardian`      | keyword GUARDIAN       | 26 |
| 8  | `dc_droid`         | keyword DROID          | 25 |
| 9  | `dc_smuggler`      | keyword SMUGGLER       | 24 |
| 10 | `dc_spy`           | keyword SPY            | 22 |
| 11 | `dc_force_user`    | keyword FORCE USER     | 21 |
| 12 | `dc_creature`      | keyword CREATURE       | 14 |
| 13 | `dc_heavy_weapon`  | keyword HEAVY WEAPON   | 14 |
| 14 | `dc_vehicle`       | keyword VEHICLE        | 13 |
| 15 | `dc_technician`    | keyword TECHNICIAN     | 10 |
| 16 | `dc_wookiee`       | keyword WOOKIEE        | 6  |
| 17 | `dc_mobile`        | keyword MOBILE         | 6  |
| 18 | `dc_massive`       | keyword MASSIVE        | 7  |
| 19 | `dc_reach`         | keyword REACH          | 2  |
| 20 | `dc_professional`  | keyword PROFESSIONAL   | 2  |
| 21 | `aff_imperial`     | affiliation Imperial   | 68 |
| 22 | `aff_rebel`        | affiliation Rebel      | 74 |
| 23 | `aff_scum`         | affiliation Scum       | 71 |
| 24 | `aff_any`          | affiliation Any        | 20 |
| 25 | `size_small_1x1`   | figure-size 1x1        | bulk |
| 26 | `size_medium_1x2`  | figure-size 1x2        | ~7  |
| 27 | `size_large_2x2`   | figure-size 2x2 / 2x3  | AT-DP, AT-RT, AT-ST, General Weiss, Nexu, Mortar Trooper, Rancor, Bantha Rider, Dewback Rider, SC2-M |
| 28 | `is_attachment`    | `attachment: true`     | 33  |

> Note 1: `size_large_2x2` groups any footprint ≥2 cells in both dimensions.
> Precise footprint (2x2 vs 2x3) is not disambiguated in a dedicated channel
> because the footprint shape is already represented by cells 0/1 lighting
> the full set of cells under the figure.
>
> Note 2: scope of this category set is **shape, not identity**. Which exact
> DC a figure is (`Darth Vader` vs `Maul` vs `Luke Skywalker`) lives in the
> scalar vector as a 241-slot bitset per player (D7.3).

### Group C — Per-figure state (25 channels, cum. 52)

Keyed at the figure anchor cell (channel 2). For cells without an anchor,
these channels are 0.

| Idx | Name | Source field | Encoding | Range |
|---|---|---|---|---|
| 29 | `hp_fraction`             | `dcHealthState[msgId][figIdx]` (nested; D2.29)   | `hp / maxHp`                   | [0, 1] |
| 30 | `hp_is_full`              | derived (`hp == maxHp`)                          | 1 if at full                   | {0, 1} |
| 31 | `strain_fraction`         | `figureStrain[fk]`                               | `strain / maxStrain`           | [0, 1] |
| 32 | `orient_N`                | `figureOrientations[fk] == 'N'`                  | 1 if facing N                  | {0, 1} |
| 33 | `orient_E`                | `figureOrientations[fk] == 'E'`                  | "                              | {0, 1} |
| 34 | `orient_S`                | `figureOrientations[fk] == 'S'`                  | "                              | {0, 1} |
| 35 | `orient_W`                | `figureOrientations[fk] == 'W'`                  | "                              | {0, 1} |
| 36 | `cond_stun`               | `figureConditions[pn][fk]`                       | 1 if present                   | {0, 1} |
| 37 | `cond_bleed`              | "                                                | "                              | {0, 1} |
| 38 | `cond_focus`              | "                                                | "                              | {0, 1} |
| 39 | `cond_hide`               | "                                                | "                              | {0, 1} |
| 40 | `cond_weaken`             | "                                                | "                              | {0, 1} |
| 41 | `cond_immobilize`         | "                                                | reserved (D2.24 stubbed)       | {0, 1} |
| 42 | `cond_exposed`            | "                                                | reserved                       | {0, 1} |
| 43 | `cond_disoriented`        | "                                                | reserved                       | {0, 1} |
| 44 | `cond_hindered`           | "                                                | reserved                       | {0, 1} |
| 45 | `pt_surge`                | `figurePowerTokens[fk]`                          | count (0-2 w/o LnL, 0-3 w/ LnL)| {0,1,2,3} |
| 46 | `pt_evade`                | "                                                | "                              | {0,1,2,3} |
| 47 | `pt_block`                | "                                                | "                              | {0,1,2,3} |
| 48 | `pt_damage`               | "                                                | "                              | {0,1,2,3} |
| 49 | `contraband`              | `figureContraband[fk]`                           | 1 if carrying                  | {0, 1} |
| 50 | `activation_anchor`       | `activationStartPositions[fk]`                   | 1 at start-of-activation coord | {0, 1} |
| 51 | `is_active_figure`        | derived from `currentActivationTurnPlayerId` + `p1/p2DcList` | 1 at anchor of currently-activating DC group | {0, 1} |
| 52 | `damage_this_activation`  | `activationDamagedFigures[fk]`                   | 1 if dealt damage this activation | {0, 1} |
| 53 | `has_moved_this_round`    | `figureMoved[fk]`                                | 1 if moved this activation     | {0, 1} |

> Power-token channels capped at 4 colors (Surge/Evade/Block/Damage —
> matches `grant_power_tokens` primitive in D2.27). If variant-colour tokens
> are added in a future rules set, extend here.

### Group D — Terrain (11 channels, cum. 63)

Source: `data/map-spaces.json[<missionId>]` + mission-rule state.

| Idx | Name | Encoding | Notes |
|---|---|---|---|
| 54 | `terrain_difficult`        | 1 if cell tagged difficult     | static from mission |
| 55 | `terrain_hostile`          | 1 if hostile                    | static from mission |
| 56 | `terrain_rubble`           | 1 if rubble token present       | dynamic (`rubbleTokens`) |
| 57 | `wall_static`              | 1 if permanent wall at cell     | static from mission |
| 58 | `wall_los_blocking`        | 1 if LOS-blocking (terrain + rubble + figures with Stealthy not counted) | derived |
| 59 | `door_open`                | 1 on a door-edge cell if door is open   | `openedDoors` |
| 60 | `door_closed`              | 1 on a door-edge cell if door is closed | `openedDoors` |
| 61 | `fluctuation_yellow`       | `fluctuationPositions` color=yellow     | Lothal Wastes B only |
| 62 | `fluctuation_blue`         | "                                       | "                      |
| 63 | `fluctuation_green`        | "                                       | "                      |
| 64 | `fluctuation_red`          | "                                       | "                      |

### Group E — Mission objects (16 channels, cum. 79)

Source: `cratePositions`, `crateHealth`, `crateTokens`, `terminalControlPlayerNum`,
mission-specific token fields.

| Idx | Name | Encoding | Notes |
|---|---|---|---|
| 65 | `crate_present`            | 1 at crate cell                 | `cratePositions` |
| 66 | `crate_hp_fraction`        | `crateHealth/maxHealth`         | `crateHealth` |
| 67 | `crate_token_generic`      | 1 if generic-crate token        | `crateTokens` |
| 68 | `crate_token_interact`     | 1 if interact-crate token       | "                |
| 69 | `terminal_present`         | 1 if cell is a terminal         | derived from mission data |
| 70 | `terminal_friendly_ctrl`   | 1 if terminal at cell controlled by POV | `terminalControlPlayerNum` |
| 71 | `terminal_enemy_ctrl`      | 1 if terminal at cell controlled by opponent | "        |
| 72 | `device_token`             | 1 if device token present       | `deviceTokens` |
| 73 | `ancillary_token_a`        | mission-specific token slot A   | `ancillaryTokens` bucket |
| 74 | `ancillary_token_b`        | mission-specific token slot B   | "                        |
| 75 | `ancillary_token_c`        | mission-specific token slot C   | "                        |
| 76 | `ancillary_token_d`        | mission-specific token slot D   | "                        |
| 77 | `imperial_citadel`         | 1 at citadel token              | `imperialCitadelTokens` |
| 78 | `orbital_bombardment`      | 1 at OB residual cell           | `orbitalBombardmentTokens` |
| 79 | `overwatch_token`          | 1 at overwatch marker cell      | `overwatchTokenPosition` |
| 80 | `set_trap`                 | 1 at trap marker cell           | `setTrapSpace` + `reconToken` merged |

> Note: ancillary token slots a-d intentionally oversubscribe. Each mission
> uses at most 2-3 of the 4 slots; the mapping from mission-specific token
> → slot index is pinned in `_mission_token_map.json` (D7.3).

### Group F — NPC figures (3 channels, cum. 82)

Non-DC NPCs (Krykna on Devaron, Thugs on Jabba's Realm). Separate from Group
A because they have no DC identity — neither side "owns" them; they respond
to a mission rule.

| Idx | Name | Source | Encoding |
|---|---|---|---|
| 81 | `npc_krykna`           | `npcKrykna`        | 1 at Krykna cell |
| 82 | `npc_thug`             | `npcThugs`         | 1 at thug cell |
| 83 | `npc_krykna_claimed`   | `claimedKrykna`    | 1 at claimed Krykna cell |

### Group G — Legal-action masks (6 channels, cum. 88)

Target promotion from D7.1's "13 pending-coord fields flagged for D7.2".
These are the masks an AlphaZero policy head benefits from seeing rendered
as channels — they let the CNN output spatial policy logits directly.

| Idx | Name | Source | Encoding |
|---|---|---|---|
| 84 | `legal_move_mask`          | `computeMovementCache` for active figure | 1 at reachable cell |
| 85 | `legal_attack_target_mask` | derived from LOS + range for active figure | 1 at targetable cell |
| 86 | `pending_space_pick_mask`  | union of `pendingSpacePick` + `pendingPounceSpaceChoice` + `pendingOverwatchPlacement` + `pendingOrbitalBombardment` + `pendingCcSpaceChoice` | 1 at valid pick cell |
| 87 | `pending_push_dest_mask`   | union of `pendingKryknaPushQueue` + `pendingMassivePush` + `pendingWookSlamPush` + `pendingRushPush` + `pendingShoulderRush` | 1 at valid landing cell |
| 88 | `pending_fluctuation_mask` | `pendingFluctuationSwapQueue`, with `pendingFluctuationSwapFirst` marked | 1 at swappable cell; 0.5 at first-picked cell (already selected) |
| 89 | `pending_door_mask`        | `pendingDoorSelections`                  | 1 at door cell awaiting selection |

> Rationale: D7.1 flagged these thirteen `pending*Pick` / `pending*Push` /
> `pendingDoorSelections` fields as candidates for spatial rendering. D7.2
> promotes them. The scalar vector (D7.3) still carries the **payload**
> (active-chain ID, remaining-count, owner, etc.) but the **coord set** is
> a mask channel so the policy head can vote spatially.

### Group H — Zone control + scoring overlay (3 channels, cum. 91)

| Idx | Name | Source | Encoding |
|---|---|---|---|
| 90 | `zone_friendly_ctrl`       | derived from `figurePositions` + mission zone def, per D5 fix `64303bd` | 1 at zone cell under friendly uncontested control |
| 91 | `zone_enemy_ctrl`          | "                                                                         | 1 at enemy uncontested zone cell |
| 92 | `zone_contested`           | "                                                                         | 1 at contested (both sides present) zone cell |

### Group I — Combat POV markers (3 channels, cum. 94)

Transient per-combat markers. Active only while `pendingCombat` is set.

| Idx | Name | Source | Encoding |
|---|---|---|---|
| 93 | `attacker_anchor`          | `lastAttackAttackerFigureIndex` → anchor cell | 1 at attacker's top-left |
| 94 | `defender_anchor`          | `lastAttackTargetFigureKey` → anchor cell     | 1 at defender's top-left |
| 95 | `attack_path_cells`        | LOS cells between attacker & defender          | 1 at each cell on the attack path |

---

## Final totals

- **Committed spatial channels:** **96** (indices 0–95)
- **Hard cap:** 256 (plan 7.2 verify)
- **Soft target:** 128 (D7.1 budget)
- **Headroom:** 96 → 128 = 32 free slots; 96 → 256 = 160 free slots

Headroom is reserved for:
- New conditions added by future rules revisions (currently 4 reserved channels idx 41–44)
- New mission-specific token slots (currently 4 allocated idx 73–76)
- Per-chain pending-state masks if the 6 Group-G channels prove insufficient
- Experimentation with distance / LOS-cone / path-planning auxiliary channels

---

## Verification checklist (for D7.6 bijection test)

Every entry in `python/encoding/_channel_inventory.md` spatial bucket (22
source fields) has at least one channel here:

| Source field | Channel(s) |
|---|---|
| `figurePositions` | 0, 1, 2 |
| `figureOrientations` | 32–35 |
| `figureConditions` | 36–44 |
| `figurePowerTokens` | 45–48 |
| `figureStrain` | 31 |
| `figureContraband` | 49 |
| `activationStartPositions` | 50 |
| `cratePositions` | 65 |
| `crateHealth` | 66 |
| `crateTokens` | 67–68 |
| `openedDoors` | 59–60 |
| `ancillaryTokens` | 73–76 |
| `deviceTokens` | 72 |
| `rubbleTokens` | 56 |
| `imperialCitadelTokens` | 77 |
| `orbitalBombardmentTokens` | 78 |
| `overwatchTokenPosition` | 79 |
| `setTrapSpace` | 80 |
| `reconToken` | 80 (merged) |
| `fluctuationPositions` | 61–64 |
| `npcKrykna` | 81, 83 |
| `npcThugs` | 82 |
| `claimedKrykna` | 83 |
| `terminalControlPlayerNum` | 69–71 |
| `lastAttackTargetSpacesForRubble` | (subsumed by 56 + 95) |
| `barrageTargetSpace` | 86 (pending_space_pick_mask when the E.5 chain is live) |
| `autofireChainTargetSpace` | 86 |
| `falseOrdersAttackTargets` | 86 |

> Note: `lastAttackTargetSpacesForRubble`, `barrageTargetSpace`,
> `autofireChainTargetSpace`, `falseOrdersAttackTargets` don't get their own
> dedicated channel. They are either transient single cells (covered by the
> "currently-pending-chain" masks 86–89) or historical markers already
> implied by `rubbleTokens` once resolved. D7.6 bijection will assert the
> decode path reconstructs them correctly from the scalar vector's chain
> metadata.

---

## Out of scope (explicitly deferred)

- **Board dimensions (H, W).** Plan task 7.3. Current plan text commits to
  32x32; this file does not re-decide that.
- **Scalar vector contents + widths.** Plan task 7.4. Depends on decisions
  here (e.g. DC-name bitset size = 241, terminal-count, pending-chain payload
  shapes).
- **Batch encoding.** Plan task 7.9.
- **`encode_state` / `decode_state` signatures.** Plan tasks 7.5, 7.6.

---

## Revision policy

Numbered indices 0–95 are **stable contract**. Subsequent D7 passes may:

- Add a channel at a new index ≥96 (budget allows 160 more).
- Tighten a channel's encoding (e.g. promote `hp_fraction` from float to a
  bucketed multi-channel representation) by splitting one channel into
  several at appended indices — the original index stays at index 29 as a
  back-compat alias until bumped.
- Never: delete / reshuffle / repurpose an index. A checkpoint trained on
  version N of this list must remain loadable under version N+K.

Version bumps happen on any reshuffle; current version is 1 (2026-04-21).
