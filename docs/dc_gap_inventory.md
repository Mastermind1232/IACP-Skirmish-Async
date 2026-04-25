# DC Ability Gap Inventory

**Total**: 310 DC abilities. **275 real (89%)**, **35 stub (11%)**.

Of the 35 "stubs":
- 27 are **real port targets** (Pattern C deferred — handlers exist in JS, need Python ports).
- 8 are `data-only-unreferenced` — declared in `data/ability-library.json` but no
  JS code consumes them as a string literal. Inert in JS; no port required.

## Real port targets (27)

### deferred-bridge (7) — start-of-activation / combat-bridge hooks
- `adapt_blaise` — start-of-activation hook
- `fast_learner_mara_jade` — start-of-activation hook
- `scrap_battalion_ugnaught_elite` — start-of-activation hook
- `scrap_battalion_ugnaught_reg` — start-of-activation hook
- `defensive_fire_bokatan` — `combat-bridge.js:2680`
- `insignificant_dio` — `available-actions.js` + `dc-play-area.js`
- `overload_saboteur` — `available-actions.js` + `combat.js` + `combat-reactions.js`

### deferred-handler-combat (13) — combat passives
- `camouflage_mak` / `camouflage_scout_trooper` — distance-gated LOS deny
- `coordinated_hunt_purge_commander` — combat bonus
- `gambit_lando` — combat bonus
- `krayt_dragon_fury_tress` — combat bonus
- `light_it_up_rebel_pathfinder` — combat bonus
- `mon_cala_sf_loku` — combat bonus
- `pulse_cannon_iden` — combat bonus
- `shared_calculations_zuckuss` — combat bonus
- `spray_fire_heavy_stormtrooper` — multi-target attack
- `tripod_eweb` — multi-fire conditional
- `vague_and_unconvincing_k2s0` — defensive
- `versatile_weaponry_hk_elite` — versatility

### deferred-handler-other (3)
- `imperial_loadout_purge_trooper` — setup/phase-gate/activation-setup
- `shape_clawdite_elite` / `shape_clawdite_reg` — setup/round/phase-gate/activation-setup

### deferred-cc-timing (3)
- `adaptive_skills_mara_jade` — CC reroll gate
- `devout_chirrut` — CC timing window
- `fallen_master_malicos` — CC timing-related

### deferred-abilities-js (1)
- `spiked_boots_snowtrooper` — push/rush MASSIVE-pusher guard

## Inert (8) — no Python port needed
- `attached_dio` — dcPassive trigger; attachment plumbing partial
- `dirty_dealing_bib`, `droid_kit_iden`, `dubious_counterparts_aphra`,
  `last_wielder_darksaber_bokatan`, `modular_heavy_stormtrooper`,
  `scavenged_stock_jawa_elite`, `shady_contacts_saska` — declared in library,
  no JS string-literal consumption found
