# Definitive Ability Audit — All Figures

Generated 2026-02-26. Single source of truth for automation status.

## Status Key
- **WIRED** — Fully automated with code
- **PARTIAL** — Has code but not fully automated (e.g. reminder + some logic)
- **INFORMATIONAL** — Shows instructions to player, no mechanical automation
- **NOT_WIRED** — Zero code coverage
- **N/A** — Not applicable in skirmish, or keyword-only handled by movement engine
- **PASSIVE_COMBAT** — Handled automatically in applyDcPassivesToCombat (e.g. +1 Hit, Pierce 1, Bleed)

## Difficulty Key (for NOT_WIRED only)
- **EASY** — Can use existing data-driven patterns (data field in ability-library.json)
- **MEDIUM** — Needs new logic within existing infrastructure
- **HARD** — Needs fundamentally new infrastructure (interrupts, multi-phase, etc.)

---

## 0-0-0

| Ability | Status | Notes |
|---------|--------|-------|
| Shocking Palm (surge: attack misses, defender Stunned) | WIRED | Standard surge parsing |
| Invasive Procedure | WIRED | `invasive_procedure` — targetHostileFigure + selfCondition |
| Unnerving (end of activation: each adjacent hostile Weakened) | NOT_WIRED | MEDIUM — end-of-activation adjacency condition application |

## 4-LOM

| Ability | Status | Notes |
|---------|--------|-------|
| Shared Intuition (passive: +1 Hit if friendly HUNTER w/ LOS to target within 3) | WIRED | `shared_intuition` in ability-library.json, wiredStatus: wired |
| Lockdown (surge) | WIRED | Standard surge parsing |
| Calculate (end of activation: gain power token or recover) | NOT_WIRED | MEDIUM — needs end-of-activation hook + choice |

## Ahsoka Tano

| Ability | Status | Notes |
|---------|--------|-------|
| Force Leap | WIRED | `force_leap_ahsoka` — pounce handler |
| Dual-Wield (perform 2 attacks, each with different dice pool) | INFORMATIONAL | Shows instructions; player resolves manually |
| Force Speed (end of activation: gain 2 MP) | NOT_WIRED | EASY — existing freeMoveBonus pattern at end-of-activation |
| +1 Evade passive | PASSIVE_COMBAT | applyDcPassivesToCombat |

## Agent Blaise

| Ability | Status | Notes |
|---------|--------|-------|
| Adapt (first CC played each round: choose SPY/TROOPER to become Hidden) | NOT_WIRED | HARD — reactive on opponent CC play |
| Interrogate (surge: look at opponent hand, conditional discard) | NOT_WIRED | HARD — hand reveal + discard mechanic |

## Agent Kallus

| Ability | Status | Notes |
|---------|--------|-------|
| Hunt Dissent (opponent plays CC: distribute 2 Hit Tokens) | NOT_WIRED | HARD — reactive on CC play |
| Fulcrum (start of activation: each player draws 1 CC) | NOT_WIRED | MEDIUM — start-of-activation CC draw |
| Bo-Rifle (before attack: treat as Melee, replace blue with red) | NOT_WIRED | MEDIUM — attack type switch + die swap |

## Asajj Ventress

| Ability | Status | Notes |
|---------|--------|-------|
| Nimble (after attack targeting you: gain 2 MP per Block result) | NOT_WIRED | MEDIUM — post-defense MP based on Block count |
| Consider It My Payment (start of activation: opponent reveals CC) | NOT_WIRED | HARD — CC hand reveal + conditional discard |
| Force Push (push SMALL figure within 3, 2 spaces) | WIRED | If using force_throw pattern |

## AT-RT

| Ability | Status | Notes |
|---------|--------|-------|
| Mortar Launcher | WIRED | `mortar_launcher` — rollOneDie + freeMoveBonus |
| Vanguard | WIRED | `vanguard` — replace die with red within 3 |
| Block 1, +2 Accuracy passives | PASSIVE_COMBAT | |

## Alliance Ranger (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Sharpshooter (5+ spaces: become Focused) | WIRED | `sharpshooter` in ability-library.json |
| Elite Sniper (5+ spaces: reroll up to 2 attack dice) | WIRED | `elite_sniper` in ability-library.json |
| Guerilla (after attack, if defender defeated: become Hidden) | WIRED | Checked in index.js:3559 |
| +1 Accuracy passive | PASSIVE_COMBAT | applyDcPassivesToCombat |

## Alliance Ranger (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Sniper (5+ spaces: reroll 1 attack die) | WIRED | `sniper` in ability-library.json |
| Guerilla (after attack, if defender defeated: become Hidden) | WIRED | index.js:3559 |
| +1 Accuracy passive | PASSIVE_COMBAT | applyDcPassivesToCombat |

## Alliance Smuggler (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Improved Smuggler's Instincts | WIRED | `improved_smugglers_instincts` — freeAction + freeMoveBonus |
| Cunning (while defending: +1 Block per Evade) | WIRED | Cunning handled in combat.js:453 |
| +2 Accuracy passive | PASSIVE_COMBAT | applyDcPassivesToCombat |

## Alliance Smuggler (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Smuggler's Instincts | WIRED | `smugglers_instincts` — freeMoveBonus + freeAttackBonus |
| +2 Accuracy passive | PASSIVE_COMBAT | applyDcPassivesToCombat |

## AT-DP

| Ability | Status | Notes |
|---------|--------|-------|
| Assault (multiple attacks per activation) | NOT_WIRED | MEDIUM — multi-attack flag, honor system for now |
| Charge Generators (if < 9 dmg: +1 Hit, reroll 1 attack die) | WIRED | `charge_generators` in ability-library.json |
| +2 Accuracy, Massive passives | PASSIVE_COMBAT / N/A | Movement engine handles Massive |

## AT-ST

| Ability | Status | Notes |
|---------|--------|-------|
| Assault (multiple attacks per activation) | NOT_WIRED | MEDIUM — honor system |
| +2 Accuracy, Massive passives | PASSIVE_COMBAT / N/A | |

## Bantha Rider

| Ability | Status | Notes |
|---------|--------|-------|
| Trample | WIRED | `trample_bantha` — rollOneDie red, adjacentHostile target |
| Mounted | WIRED | `mounted_terro` — start-of-activation 3 MP (shared pattern) |
| Massive, +1 Hit passives | PASSIVE_COMBAT / N/A | |
| Stampede (after you resolve a move, each figure you moved through suffers 1 dmg) | NOT_WIRED | HARD — needs movement tracking of figures passed through |

## Bib Fortuna

| Ability | Status | Notes |
|---------|--------|-------|
| Bartered Information | WIRED | `bartered_information` — SCUM figure picker + Focus |
| Dirty Dealing (army restriction) | N/A | |
| Illicit Arms (friendly attacking, SCUM affiliation: discard CC for +1 Hit) | NOT_WIRED | HARD — cross-figure reactive CC discard |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Biv Bodhrik

| Ability | Status | Notes |
|---------|--------|-------|
| Multi-Fire | INFORMATIONAL | `multi_fire` — shows instructions |
| Suppression (surge: after ranged attack, strain = defender's defense results) | NOT_WIRED | MEDIUM — post-attack strain based on defense results |
| Block 1, +2 Accuracy passives | PASSIVE_COMBAT | |

## Baze Malbus

| Ability | Status | Notes |
|---------|--------|-------|
| Vanguard (within 3 spaces: replace 1 die with red) | WIRED | `vanguard` in ability-library.json |
| Front Line (within 3 spaces: replace 1 blue with red) | WIRED | `front_line` in ability-library.json |
| Assault (multiple attacks per activation) | NOT_WIRED | MEDIUM — honor system |

## Bespin Gambit Heroes — See Davith Elso, Murne Rin, Onar Koma, Shyla Varad, Verena Talos, Vinto Hreeda

## Cad Bane

| Ability | Status | Notes |
|---------|--------|-------|
| Flawless Execution | WIRED | `flawless_execution` — before attack Focus or power token + extra die |
| I Make the Rules Now (start of another figure's activation: friendly HUNTER gains 1 MP) | NOT_WIRED | HARD — other-figure activation trigger |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Cal Kestis

| Ability | Status | Notes |
|---------|--------|-------|
| Wall Run | WIRED | `wall_run` — freeMoveEqualToSpeed (terrain ignore: honor system) |
| Force Slow (start of round: hostile within 3 cannot activate next turn) | NOT_WIRED | HARD — activation order enforcement |

## Captain Terro

| Ability | Status | Notes |
|---------|--------|-------|
| Flamethrower (space within 2: each figure 1 dmg + 1 strain + Weakened) | WIRED | Same pattern as `wrist_flamethrower` |
| Mounted | WIRED | `mounted_terro` — 3 MP at start |
| Efficient Travel | N/A | Movement engine |
| Professional | PASSIVE_COMBAT | |

## Clawdite Shapeshifter (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Shape (on deploy: gain Form card) | NOT_WIRED | HARD — Form card sub-system |
| Shift (start of round: switch Form card) | NOT_WIRED | HARD — Form card sub-system |

## Clawdite Shapeshifter (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Shape | NOT_WIRED | HARD — Form card sub-system |
| Shift | NOT_WIRED | HARD — Form card sub-system |

## Dark Trooper Mk III

| Ability | Status | Notes |
|---------|--------|-------|
| Lift Off | WIRED | `lift_off_dark_trooper` — freeMoveBonus 4 + Mobile |
| Advanced Targeting Computer (declare: Focused + reroll 1, +1 Hit if reroll worse) | NOT_WIRED | MEDIUM — conditional reroll with hit comparison |
| Durasteel Fist (once/activation: adjacent figure roll 1 green die for dmg + push) | NOT_WIRED | EASY — rollOneDie pattern |

## Death Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Squad Captain (once/activation: adjacent TROOPER/LEADER gains power token) | NOT_WIRED | MEDIUM — activation-time token grant |
| Field Tactics (after activation: immediately activate TROOPER/LEADER group cost <=6) | NOT_WIRED | HARD — activation chaining |
| +4 Accuracy passive | PASSIVE_COMBAT | |

## Death Trooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Security Detail (after deploy: friendly LEADER gains Block Token) | NOT_WIRED | EASY — post-deploy token grant |
| Field Tactics | NOT_WIRED | HARD — activation chaining |
| +3 Accuracy passive | PASSIVE_COMBAT | |

## Dengar

| Ability | Status | Notes |
|---------|--------|-------|
| Spread the Pain (surge: choose harmful condition, apply to figure on/adjacent to target) | NOT_WIRED | MEDIUM — multi-use surge with condition choice |
| +1 Hit, Block 1 passives | PASSIVE_COMBAT | |

## Diala Passil

| Ability | Status | Notes |
|---------|--------|-------|
| Battle Meditation | WIRED | `battle_meditation` — before attack: become Focused |
| Defensive Stance | WIRED | `defensive_stance` — reroll defense die + Dodge conversion |
| Force Throw | WIRED | `force_throw` — 3-phase push |

## Director Krennic

| Ability | Status | Notes |
|---------|--------|-------|
| Advanced Weapons Research (start of activation: friendly within 2 gains Hit/Surge token) | WIRED | Handled in activation.js (in start-of-activation hooks) |
| Unhinged Director (friendly TROOPER/GUARDIAN within 2 spends token: suffer 1 strain for +2) | NOT_WIRED | HARD — reactive token spend modification |
| +1 Surge passive | PASSIVE_COMBAT | |

## Emperor Palpatine

| Ability | Status | Notes |
|---------|--------|-------|
| Emperor (interrupt: friendly within 4 performs attack) | WIRED | `emperor_interrupt` |
| Tempt (start of activation: figure suffers 1 dmg + gains Hit Token) | WIRED | `tempt` |
| Force Lightning | WIRED | `force_lightning` — targetHostileFigure with splash |
| Pierce 3 passive | PASSIVE_COMBAT | |

## Ewok Warrior (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Ambush (after deploy: become Hidden) | NOT_WIRED | EASY — post-deploy condition |
| Forest Fighters | WIRED | `forest_fighters` — melee while Hidden: +1 Hit |
| Sling Barrage (special ranged attack, reroll per group member with LOS) | NOT_WIRED | HARD — multi-figure LOS-dependent reroll count |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Ezra Bridger

| Ability | Status | Notes |
|---------|--------|-------|
| Brush (start of round: move up to 4 spaces) | NOT_WIRED | MEDIUM — start-of-round movement |
| Much to Learn | WIRED | `much_to_learn` — friendly unique within 3: reroll |

## Fenn Signis

| Ability | Status | Notes |
|---------|--------|-------|
| Havoc Shot | WIRED | `havoc_shot` — post-attack 1 strain for 1 dmg to 2 figures |
| Tactical Movement (start of activation: friendly within 3 gains 2 MP) | WIRED | Handled in activation.js start-of-activation hooks |
| +1 Accuracy, Pierce 1 passives | PASSIVE_COMBAT | |

## Fennec Shand

| Ability | Status | Notes |
|---------|--------|-------|
| Bounty (when defeated: opponent gains 2 VP) | NOT_WIRED | EASY — on-defeat VP grant |
| Sharpshooter | WIRED | `sharpshooter` — 5+ spaces: become Focused |
| Block 1 passive | PASSIVE_COMBAT | |

## Boba Fett

| Ability | Status | Notes |
|---------|--------|-------|
| Wrist Flamethrower | WIRED | `wrist_flamethrower` — fixedAreaEffect, fully interactive |
| EE-3 Carbine (spend 2 MP to swap die to red) | WIRED | `ee3_carbine` — interactive die converter |
| Battle Discipline (start of activation: choose +2 Accuracy, +1 Block, or 1 MP) | WIRED | Handled in activation.js start-of-activation hooks |
| Mobile keyword | N/A | Movement engine |

## Bodhi Rook

| Ability | Status | Notes |
|---------|--------|-------|
| I Can Do This (when friendly within 3 declares attack, may move 1 space) | NOT_WIRED | MEDIUM — reactive on another figure's attack declaration |
| Scomp Link | WIRED | `scomp_link` — draw 1 CC card |
| Born to Fly (interact: gain 1 MP) | NOT_WIRED | EASY — post-interact hook |

## Bossk

| Ability | Status | Notes |
|---------|--------|-------|
| Indiscriminate Fire | WIRED | `indiscriminate_fire` — freeAction, splash die choice |
| Regenerate (end of round: recover 2, discard harmful) | WIRED | `regenerate_bossk` — end-of-round auto |
| Trandoshan Terror (when wounded group enters your LOS: focused) | NOT_WIRED | MEDIUM — reactive on hostile movement |

## BT-1

| Ability | Status | Notes |
|---------|--------|-------|
| Missile Salvo | WIRED | `missile_salvo` — missileSalvoStart, interactive multi-attack |
| Invasive Procedure | WIRED | `invasive_procedure` — targetHostileFigure + selfCondition |
| Havoc Shot (after attack: suffer 1 strain to deal 1 dmg to up to 2 figures) | WIRED | `havoc_shot` in ability-library.json |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## C-3PO

| Ability | Status | Notes |
|---------|--------|-------|
| Distracting | WIRED | `distracting_c3po` — adjacent defender +1 Evade |
| Calculate (interact: gain power token and/or roll die effects) | NOT_WIRED | MEDIUM — needs interact hook + die roll |
| Informant (end of round: look at top CC of opponent deck) | NOT_WIRED | EASY — end-of-round info reveal |

## C1-10P (Chopper)

| Ability | Status | Notes |
|---------|--------|-------|
| Ram | WIRED | `ram_chopper` — freeMoveBonus + rollOneDie |
| System Shock | WIRED | `system_shock_chopper` — targetHostileFigure |
| Power Disruption (interact: terminal-adjacent hostile suffers 1 strain) | NOT_WIRED | EASY — interact hook |

## Cara Dune

| Ability | Status | Notes |
|---------|--------|-------|
| Smash | WIRED | `smash` — rollOneDie red, adjacentHostile + push |
| Shock and Awe (replace yellow with red, once/round) | WIRED | `shock_and_awe` in ability-library.json |
| Flawless Execution (before attack: become Focused; if already, power token + extra die) | WIRED | `flawless_execution` in ability-library.json |
| +1 Evade passive | PASSIVE_COMBAT | |

## Cassian Andor

| Ability | Status | Notes |
|---------|--------|-------|
| Bartered Information | WIRED | `bartered_information` — SCUM figure picker + Focus |
| Undercover (after deployment: become Hidden) | NOT_WIRED | EASY — post-deploy hook |
| Rebel Intelligence (start of activation: look at top of opponent's CC deck) | NOT_WIRED | EASY — info reveal |

## Chewbacca

| Ability | Status | Notes |
|---------|--------|-------|
| Slam | WIRED | `slam` — push SMALL adjacent figure |
| Protector | WIRED | `protector` — +1 Block when adjacent friendly defending |
| Fury (5+ dmg: +1 Surge) | WIRED | Handled via abilityText parsing |
| Bowcaster (special attack with blue + red + green ranged) | WIRED | overrideAttackDice |

## Chirrut Imwe

| Ability | Status | Notes |
|---------|--------|-------|
| I'm One With the Force | WIRED | `i_am_one_with_the_force` — freeMoveBonus |
| Cortosis Weave (while defending: reduce Pierce by 2) | WIRED | `cortosis_weave` in ability-library.json |
| Reach passive | N/A | Movement engine / target range |
| Guardian of the Whills (start of activation: may become Focused or gain 1 block token) | NOT_WIRED | MEDIUM — start-of-activation choice |

## CT-1701

| Ability | Status | Notes |
|---------|--------|-------|
| Barrage | INFORMATIONAL | `barrage_ct1701` — shows instructions, 2 manual attacks |
| Mortar Launcher (end of round: move 2, roll 1 red die area) | WIRED | `mortar_launcher` — rollOneDie + freeMoveBonus |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Darth Vader

| Ability | Status | Notes |
|---------|--------|-------|
| Brutality (perform 2 attacks, different targets) | INFORMATIONAL | `brutality` — shows instructions |
| Force Choke | WIRED | `force_choke` — targetHostileFigure |
| +1 Hit passive | PASSIVE_COMBAT | |

## Darth Vader (Lord of the Sith)

| Ability | Status | Notes |
|---------|--------|-------|
| Tempt | WIRED | `tempt` — targetHostileFigure (1 dmg + 1 Hit token) |
| Emperor (friendly figure within 4 performs attack) | WIRED | `emperor_interrupt` — interrupt attack handler |
| Battle Meditation (before attack: become Focused) | WIRED | `battle_meditation` in ability-library.json |
| Force Throw | WIRED | `force_throw` — 3-phase push interactive |
| +1 Hit, +1 Evade passives | PASSIVE_COMBAT | |

## Davith Elso

| Ability | Status | Notes |
|---------|--------|-------|
| Forest Fighters (melee while Hidden: +1 Hit) | WIRED | `forest_fighters` in ability-library.json |
| Fell Swoop (move up to 3 spaces, free melee attack) | WIRED | freeMoveBonus + freeAttackBonus |
| Vanish (end of activation: become Hidden + 2 MP next activation) | WIRED | Fully wired in activation.js |
| +1 Evade passive | PASSIVE_COMBAT | |

## Del Meeko

| Ability | Status | Notes |
|---------|--------|-------|
| Expertise (after Special Action: +1 action, once/activation) | WIRED | `expertise` in ability-library.json, handled in dc-play-area.js |
| Tactical Movement (start of activation: 1 MP) | WIRED | Handled in activation.js |
| Gifted Mechanic | WIRED | `gifted_mechanic` — targetFriendlyFigureAdjacent |
| Open-Minded (after attack: gain 1 MP or Power Token) | WIRED | Batch 7 — post-attack choice in index.js + activation.js |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Dewback Rider

| Ability | Status | Notes |
|---------|--------|-------|
| Mounted | WIRED | `mounted_dewback` — start-of-activation 3 MP |
| Shock Lance | WIRED | `shock_lance_dewback` — rollOneDie green |
| Efficient Travel keyword | N/A | Movement engine |
| Stampede (after you resolve a move, each figure you moved through suffers 1 dmg) | NOT_WIRED | HARD — needs movement tracking |

## Dio (Companion)

| Ability | Status | Notes |
|---------|--------|-------|
| Stim Canister | WIRED | `stim_canister_bd1` — targetFriendlyFigureAdjacent |
| Scratch | WIRED | `scratch_crumb` — targetHostileFigure 1 dmg |
| Mobile keyword | N/A | Movement engine |

## Doctor Aphra

| Ability | Status | Notes |
|---------|--------|-------|
| Sith Acolyte | INFORMATIONAL | `sith_acolyte` — search CC deck, resolve manually |
| To The Escape Ship! (start of activation: may move to adjacent space of adjacent friendly DROID) | NOT_WIRED | MEDIUM — position-aware start-of-activation |
| Worth Every Credit (when hostile defeated this activation: +1 VP) | WIRED | Checked in index.js:3725 |

## Drokkatta

| Ability | Status | Notes |
|---------|--------|-------|
| Demolish | WIRED | `demolish` — fixedAreaEffect + placesRubble |
| Overcharged Weapons (reaction: after attack, choose 1 die and double its result) | INFORMATIONAL | Shows instructions |
| +1 Surge passive | PASSIVE_COMBAT | |

## E-Web Engineer (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Hunker Down (defending near terrain: +1 Evade) | WIRED | `hunker_down` in ability-library.json |
| Focused Fire (double action: 2 attacks same target) | INFORMATIONAL | `focus_fire_tank` pattern — manual |
| +4 Accuracy passive | PASSIVE_COMBAT | |
| Overwatch (place token, interrupt attack when hostile enters adjacent) | NOT_WIRED | HARD — needs movement interrupt system |

## E-Web Engineer (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Set Up (start of activation: become Focused if no move this activation) | NOT_WIRED | MEDIUM — conditional on movement tracking |
| +4 Accuracy passive | PASSIVE_COMBAT | |

## Echo Base Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Covering Fire (start of activation: choose hostile in LOS, it suffers -1 Accuracy) | NOT_WIRED | MEDIUM — needs hostile targeting at activation start |
| Efficient Travel | N/A | Movement engine |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Echo Base Trooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Efficient Travel | N/A | Movement engine |

## Fifth Brother

| Ability | Status | Notes |
|---------|--------|-------|
| Relentless Pursuit (declare attack: target suffers 1 Strain) | WIRED | `fifth_brother_relentless` in ability-library.json |
| Much to Learn (friendly unique within 3: reroll) | WIRED | `much_to_learn` in ability-library.json |
| Foresight (defending: reroll 1 defense die) | WIRED | `foresight` in ability-library.json |
| +1 Hit passive | PASSIVE_COMBAT | |

## Gaarkhan

| Ability | Status | Notes |
|---------|--------|-------|
| Brutal Cleave | WIRED | `brutal_cleave` — strain + free melee attack with override dice |
| Charge | WIRED | `charge` — freeMoveEqualToSpeed + freeAttackBonus |
| Fury (5+ dmg: +1 Surge) | WIRED | In abilityText parsing |
| Reach, Bleed passives | PASSIVE_COMBAT / N/A | |

## Gamorrean Guard (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Gamorrean Honor Guard (defending ranged: +1 Block) | WIRED | `gamorrean_honor_guard` in ability-library.json |
| Professional | PASSIVE_COMBAT | applyDcPassivesToCombat |
| Reach passive | N/A | |

## Gar Saxon

| Ability | Status | Notes |
|---------|--------|-------|
| Gar Saxon's Flamethrower | WIRED | `gar_saxon_flamethrower` — fixedAreaEffect |
| Airborne Commander (friendly Mobile within 4 use your surges) | NOT_WIRED | HARD — needs cross-figure surge sharing |
| Personal Combat Shield (spend Block: +1 Evade) | NOT_WIRED | MEDIUM — defense token conversion |
| Mobile, +1 Hit passives | N/A / PASSIVE_COMBAT | |

## General Sorin

| Ability | Status | Notes |
|---------|--------|-------|
| Bombardment | WIRED | `bombardment_sorin` — interrupt attack + Blast 1 |
| Advanced Firepower (adjacent DROIDS/VEHICLES use your surges) | NOT_WIRED | HARD — cross-figure surge sharing |

## General Weiss

| Ability | Status | Notes |
|---------|--------|-------|
| Epic Arsenal | WIRED | `epic_arsenal` — interactive dice picker |
| General's Orders (start of activation: up to 2 friendly figures interrupt to move) | NOT_WIRED | HARD — multi-figure interrupt moves |
| Massive, +2 Accuracy passives | PASSIVE_COMBAT / N/A | |

## Gideon Argus

| Ability | Status | Notes |
|---------|--------|-------|
| Tactical Maneuver | WIRED | `tactical_maneuver` — target gains 2 MP |
| On My Mark | WIRED | `on_my_mark` — target becomes Focused |

## Greedo

| Ability | Status | Notes |
|---------|--------|-------|
| Slow on the Draw (defender may interrupt to attack you) | NOT_WIRED | HARD — needs interrupt attack system |
| Parting Shot (before defeat: interrupt to attack) | NOT_WIRED | HARD — needs before-defeat interrupt |
| +1 Hit, +1 Accuracy passives | PASSIVE_COMBAT | |

## Han Solo

| Ability | Status | Notes |
|---------|--------|-------|
| Return Fire | WIRED | `return_fire` — freeAttackBonus + freeAction |
| Cunning | WIRED | `cunning_han` — +1 Block per Evade in defense |
| Distracting | WIRED | `distracting_han` — adjacent defender +1 Evade |

## Heavy Stormtrooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Spray Fire (apply -3 Accuracy + 1 Surge) | NOT_WIRED | MEDIUM — attack modifier choice |
| Modular (include attachment at -1 cost) | N/A | Army building rule |
| +3 Accuracy passive | PASSIVE_COMBAT | |

## Heavy Stormtrooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Composite Plating | WIRED | `composite_plating` — +1 Block if attacker 4+ spaces |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Hemlock

| Ability | Status | Notes |
|---------|--------|-------|
| Neurotoxin | WIRED | `neurotoxin_hemlock` — rollOneDie yellow, area Weaken |
| Neurostim | WIRED | `neurostim_hemlock` — rollOneDie yellow, friendly buff |
| Scientific Cruelty (when hostile within 3 gains harmful condition: it suffers 1 dmg) | NOT_WIRED | MEDIUM — reactive on condition application |

## Hera Syndulla

| Ability | Status | Notes |
|---------|--------|-------|
| Call the Shots (friendly within 3 attacking: +2 Acc, +1 Hit, or +1 Surge) | NOT_WIRED | HARD — reactive choice during another figure's attack |
| Smooth Landing (after deployment: self + adjacent gain 1 MP) | NOT_WIRED | EASY — post-deploy hook |
| Double surge abilities | WIRED | Double-surge parsing wired |

## Hired Gun (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Self-Preservation (when suffer damage: become Focused) | NOT_WIRED | MEDIUM — reactive on damage |
| Parting Shot | NOT_WIRED | HARD — before-defeat interrupt attack |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Hired Gun (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Parting Shot | NOT_WIRED | HARD — before-defeat interrupt attack |
| Disposable (-1 Evade while defending) | WIRED | `disposable` in ability-library.json |

## HK Assassin Droid (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Targeting Computer | WIRED | `targeting_computer_hk_elite` — reroll 1 attack die |
| Versatile Weaponry (force defender to reroll 1 defense die) | NOT_WIRED | MEDIUM — defense reroll forcing |
| Merciless (declare attack: if defender has harmful condition, 1 dmg) | NOT_WIRED | MEDIUM — condition check at declare |
| Priority Target passive | WIRED | buildAndSendAttackTargets filter |

## HK-47

| Ability | Status | Notes |
|---------|--------|-------|
| Query (declare attack: +1 Hit unless defender becomes Bleeding) | WIRED | `query_hk47` in ability-library.json |
| Conclusion (attacking: -1 Evade to defense) | WIRED | `conclusion` in ability-library.json |
| Mockery (once/activation: hostile in LOS suffers 1 Strain) | NOT_WIRED | EASY — targetHostileFigure pattern |

## Hondo Ohnaka

| Ability | Status | Notes |
|---------|--------|-------|
| Negotiate (declare attack: +2 Damage unless defender pays 2 VP) | NOT_WIRED | HARD — opponent choice interrupt |
| What's Yours is Mine (end of round in opponent deploy zone: steal 2 VP) | NOT_WIRED | MEDIUM — end-of-round position + VP check |

## Iden Versio

| Ability | Status | Notes |
|---------|--------|-------|
| Droid Kit (once/activation: if Dio in space, gain 1 power token) | NOT_WIRED | MEDIUM — companion proximity check |
| Pulse Cannon (if spent power token: +4 Accuracy, +1 Hit) | NOT_WIRED | MEDIUM — conditional on token spending |
| ID10 Seeker Droid (Dio companion start of game) | NOT_WIRED | MEDIUM — companion deployment |

## IG-11

| Ability | Status | Notes |
|---------|--------|-------|
| Rapid Fire | WIRED | `rapid_fire_ig11` — freeAttackBonus |
| Targeting Computer | WIRED | `targeting_computer_ig11` — reroll 1 attack die |
| Self-Destruct Protocol | PARTIAL | `self_destruct_protocol` — has logMessage + rollOneDie data, but before-defeat trigger is honor system |
| Block 1 passive | PASSIVE_COMBAT | |

## IG-88

| Ability | Status | Notes |
|---------|--------|-------|
| Arsenal | WIRED | `arsenal` — interactive dice picker |
| Relentless | WIRED | `relentless_ig88` — auto-strain on declare |
| Assault (multiple attacks) | NOT_WIRED | MEDIUM — honor system |

## Imperial Officer (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Executive Order | WIRED | `executive_order` — interrupt move or attack |

## Imperial Officer (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Order (skirmish: target gains 2 MP) | WIRED | `officer_order` — freeMoveBonus |
| Cower (defending adjacent to friendly: reroll 1 defense die) | NOT_WIRED | MEDIUM — adjacency-conditional defense reroll |

## ISB Infiltrator (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Coordinated Raid | WIRED | `coordinated_raid_elite` — interrupt attack |
| In The Shadows (deployed + end of activation: become Hidden) | WIRED | activation.js:255 |
| Comms Jammer (opponent cannot play CC during your activation) | NOT_WIRED | HARD — requires CC play interception |

## ISB Infiltrator (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Coordinated Raid | WIRED | `coordinated_raid_regular` — interrupt attack |

## Jabba the Hutt

| Ability | Status | Notes |
|---------|--------|-------|
| Bully | WIRED | `bully_jabba` — targetHostileFigure 3 dmg |
| Incentivize | WIRED | `incentivize_jabba` — elite figure becomes Focused |
| Scheme | WIRED | `scheme_jabba` — draw 1 CC |
| Order Hit | WIRED | `order_hit_jabba` — double action, VP cost + interrupt attack |
| Nefarious Gains (hostile defeated: gain 1 VP) | WIRED | index.js:3803 |

## Jarrod Kelvin

| Ability | Status | Notes |
|---------|--------|-------|
| Leaping Slash | WIRED | `leaping_slash` — freeMoveBonus + freeAttackBonus |
| Droid Master (J4X-7 companion at start of mission) | NOT_WIRED | MEDIUM — companion deployment |
| +1 Hit, +1 Evade passives | PASSIVE_COMBAT | |

## Jawa Scavenger (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Bargain (surge) | WIRED | Standard surge parsing (VP gamble) |
| Take Cover (while defending: +1 Block, -1 Evade) | NOT_WIRED | MEDIUM — optional defense modifier |
| Scavenged Stock (army building) | N/A | |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Jawa Scavenger (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Harass (surge: if not miss, defender suffers 1 Strain) | WIRED | `harass` surge in ability-library.json |
| Take Cover | NOT_WIRED | MEDIUM — optional defense modifier |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Jet Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Agile (defending: convert 1 Block to 1 Evade) | NOT_WIRED | MEDIUM — defense die conversion |
| Fly-By (declare within 2: +1 blue die; after: +2 MP) | WIRED | `fly_by` + combat.js:303 + index.js:3577 |

## Jet Trooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Agile | NOT_WIRED | MEDIUM — defense die conversion |
| Jets (after attack within 2: +1 MP) | WIRED | index.js:3591, `jets_jet_trooper` |
| Mobile keyword | N/A | Movement engine |

## Jyn Erso

| Ability | Status | Notes |
|---------|--------|-------|
| Trust Goes Both Ways (start/end activation: adjacent friendly, both recover 1 + surge token) | NOT_WIRED | MEDIUM — start/end activation hook + adjacency |
| Tonfa Strike | WIRED | `tonfa_strike` — freeMoveBonus + override dice |
| Pierce 1 passive | PASSIVE_COMBAT | |

## Jyn Odan

| Ability | Status | Notes |
|---------|--------|-------|
| Hair Trigger | WIRED | `hair_trigger` — freeAttackBonus at hostile activation start |
| Sidewinder | WIRED | `sidewinder` — post-combat 1 strain for 2 MP |
| Cunning | WIRED | `cunning_jyn` — +1 Block per Evade |
| +1 Accuracy, +1 Hit passives | PASSIVE_COMBAT | |

## K-2SO

| Ability | Status | Notes |
|---------|--------|-------|
| Continually Unexpected | WIRED | `continually_unexpected` — token check + free attack |
| Vague and Unconvincing (defending: no power tokens or CC) | NOT_WIRED | HARD — requires token/card play blocking |
| Cassian Said I Had To (friendly LEADER enters adjacent: gain Hit Token) | NOT_WIRED | HARD — movement proximity trigger |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Kanan Jarrus

| Ability | Status | Notes |
|---------|--------|-------|
| Soresu Form | WIRED | `soresu_form` — reroll + Dodge conversion (honor system for strain) |
| Force Vision (start of activation: opponent must activate chosen group next) | NOT_WIRED | HARD — activation order enforcement |

## Kayn Somos

| Ability | Status | Notes |
|---------|--------|-------|
| Firing Squad | WIRED | `firing_squad` — 2 adjacent Troopers interrupt attack |
| Squad Command (surge: adjacent Trooper becomes Focused) | WIRED | `squad_command` surge |

## Ko-Tun Feralo

| Ability | Status | Notes |
|---------|--------|-------|
| Arms Distribution (start of activation: distribute 2 power tokens) | NOT_WIRED | MEDIUM — multi-figure token distribution |
| Dead Precise (friendly within 3 spends power token: Pierce 1, -1 Evade) | NOT_WIRED | HARD — reactive on another figure's token spend |
| Squad Cohesion (rebels within 3 share tokens) | NOT_WIRED | HARD — cross-figure token sharing |
| Professional passive | PASSIVE_COMBAT | |

## Krrsantan

| Ability | Status | Notes |
|---------|--------|-------|
| Electrified Knuckledusters | WIRED | `electrified_knuckledusters` — rollOneDie blue + Stun |
| Full of Rage (3+ dmg: become Focused before attack) | WIRED | `full_of_rage` in ability-library.json |
| Bleed, Pierce 1 passives | PASSIVE_COMBAT | |

## Kuiil

| Ability | Status | Notes |
|---------|--------|-------|
| Mounted | WIRED | `mounted_kuiil` — 3 MP at start of activation |
| Hop On! (Special: carry/push SMALL friendly during move) | NOT_WIRED | HARD — movement interrupt + figure tracking |
| Efficient Travel | N/A | Movement engine |

## Lando Calrissian

| Ability | Status | Notes |
|---------|--------|-------|
| Resourceful (attack or defend: reroll 1 die) | NOT_WIRED | MEDIUM — reroll choice during attack/defense |
| Gambit (before reroll: replace die with same type) | NOT_WIRED | HARD — die replacement before reroll |
| Shrewd Scoundrel (guess number, double die if correct) | NOT_WIRED | HARD — interactive guess mechanic |

## Leia Organa

| Ability | Status | Notes |
|---------|--------|-------|
| Battlefield Leadership | WIRED | `battlefield_leadership` — attack + friendly interrupt |
| Military Efficiency | WIRED | `military_efficiency` — shuffleOneDiscardToDeck |
| +1 Evade passive | PASSIVE_COMBAT | |

## Loku Kanoloa

| Ability | Status | Notes |
|---------|--------|-------|
| Set Your Sights (Recon token: friendly attacking recon target gains Pierce 1) | NOT_WIRED | MEDIUM — persistent token + cross-figure Pierce |
| Priority Target (LOS ignoring) | WIRED | Priority Target intercept in buildAndSendAttackTargets |
| Mon Cala Special Forces (declare attack on recon target: become Focused) | NOT_WIRED | MEDIUM — depends on recon token |

## Loth-cat (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Pounce | WIRED | `dc_pounce` — place in empty space + attack |
| Fresh Catch | WIRED | `fresh_catch_lothcat` — power token to self/CREATURE |
| Curious (after interact: suffer 1 Strain) | WIRED | Batch 7 — post-interact strain in interact.js |
| Pierce 1 passive | PASSIVE_COMBAT | |

## Loth-cat (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Pounce | WIRED | `dc_pounce` |
| Rat Catcher | WIRED | `rat_catcher_lothcat` — Block token |
| Curious | WIRED | Batch 7 — post-interact strain in interact.js |
| Pierce 1 passive | PASSIVE_COMBAT | |

## Luke Skywalker

| Ability | Status | Notes |
|---------|--------|-------|
| Saber Strike | WIRED | `saber_strike` — override dice + Pierce 3 |
| Inspiring | WIRED | `inspiring` — friendly within 3 reroll |
| Block 1 passive | PASSIVE_COMBAT | |

## Luke Skywalker (Jedi Knight)

| Ability | Status | Notes |
|---------|--------|-------|
| Deflect | WIRED | `deflect` — targetHostileFigure 1 dmg after ranged attack |
| Heroic | WIRED | `heroic` — freeAttackBonus |
| +1 Hit, +1 Evade passives | PASSIVE_COMBAT | |

## Mak Eshka'rey

| Ability | Status | Notes |
|---------|--------|-------|
| Critical Hit (surge) | WIRED | `critical_hit` surge — Pierce 2 + block CC |
| Camouflage (hostile 4+ spaces cannot draw LOS) | NOT_WIRED | HARD — LOS modification system |
| Priority Target passive | WIRED | buildAndSendAttackTargets filter |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Mara Jade

| Ability | Status | Notes |
|---------|--------|-------|
| Adaptive Skills (affiliation matching) | N/A | Army building |
| Fast Learner (play CC matching another DC name) | NOT_WIRED | HARD — CC play rule override |
| Professional | PASSIVE_COMBAT | applyDcPassivesToCombat (not in passives array but in abilityText) |

## Maul

| Ability | Status | Notes |
|---------|--------|-------|
| Dual-Bladed Fury | WIRED | `dual_bladed_fury` — chooseOne: Reach+Cleave2 or Focus |
| Stalk Prey (surge) | WIRED | `stalk_prey` surge — 2 MP + Hit Token |
| Sustained by Rage | PARTIAL | `sustained_by_rage` — has wiredStatus:wired but actual defeat-immunity is honor system |
| +1 Hit passive | PASSIVE_COMBAT | |

## MHD-19

| Ability | Status | Notes |
|---------|--------|-------|
| Medical Loadout | WIRED | `medical_loadout` — recover 3 |
| Improper Procedure | NOT_WIRED | EASY — targetHostileFigure pattern (1 dmg + Weaken) — may already be wired in medical_loadout entry |

## Migs Mayfeld

| Ability | Status | Notes |
|---------|--------|-------|
| Locked and Loaded (after attack: gain 2 power tokens, max 3) | WIRED | index.js:3605 |
| Droid Arm (discard power token: draw LOS from adjacent space) | NOT_WIRED | HARD — LOS modification |
| Return Fire | WIRED | `return_fire` pattern (same as Han Solo) |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Murne Rin

| Ability | Status | Notes |
|---------|--------|-------|
| False Orders | WIRED | `false_orders` — 3-phase interactive: figure pick, action, target |
| Field Report | WIRED | `field_report` — applyHideToFriendlyWithinRange |
| Figurehead | PARTIAL | `figurehead` — has entry but damage redirect is honor system |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Nexu (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Pounce | WIRED | `dc_pounce` |
| Cunning | WIRED | `cunning_nexu_elite` |
| Non-Sentient (cannot interact) | N/A | Enforced by game rules |
| Mobile, Bleed, Cleave 2 passives | N/A / PASSIVE_COMBAT | |

## Nexu (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Pounce | WIRED | `dc_pounce` |
| Cunning | WIRED | `cunning_nexu_reg` |
| Non-Sentient | N/A | |
| Bleed, Mobile passives | N/A / PASSIVE_COMBAT | |

## Obi-Wan Kenobi

| Ability | Status | Notes |
|---------|--------|-------|
| Alter Mind (hostile cost <=9 within 3: cannot interact, not counted for control) | NOT_WIRED | HARD — persistent area denial effect |
| Strike Me Down (when attacked: reduce cost by 3, then defeated) | NOT_WIRED | HARD — reactive self-defeat + VP manipulation |
| Into the Force (when defeated: friendly becomes Focused) | WIRED | index.js:3814 |
| +1 Evade passive | PASSIVE_COMBAT | |

## Onar Koma

| Ability | Status | Notes |
|---------|--------|-------|
| Rush | WIRED | `rush_onar` — freeMoveBonus 4 + push honor system |
| Get Down (small friendly within 2 defending: +1 Block or Evade) | NOT_WIRED | MEDIUM — reactive defense buff for nearby friendlies |
| Immune (cannot gain harmful conditions) | NOT_WIRED | MEDIUM — condition application filter |

## Probe Droid (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Targeting Computer | WIRED | `targeting_computer_probe_elite` |
| Self-Destruct (end of round) | WIRED | `self_destruct_probe` — rollOneDie + defeat |
| Mobile keyword | N/A | |

## Probe Droid (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Self-Destruct | WIRED | Same pattern as Elite |
| Mobile keyword | N/A | |

## Purge Commander (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Shock Grenade | WIRED | `shock_grenade_purge` — rollOneDie green + area Weaken |
| Coordinated Hunt (self or friendly HUNTER in LOS: reroll 1 attack die) | NOT_WIRED | MEDIUM — cross-figure reroll conditional |

## Purge Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| On the Hunt | WIRED | `on_the_hunt` — freeMoveBonus + freeAttackBonus + unique target filter |
| Imperial Loadout (gain Loadout card on deploy) | NOT_WIRED | HARD — Loadout card sub-system |

## R2-D2

| Ability | Status | Notes |
|---------|--------|-------|
| Scomp Link | WIRED | `scomp_link` — draw 1 CC (terminal adjacency: honor system) |
| Service (recover 1 for self or adjacent DROID/VEHICLE) | NOT_WIRED | EASY — targetFriendlyFigureAdjacent pattern |
| Lucky (defending: blank result adds Dodge) | NOT_WIRED | HARD — post-roll die result conversion |
| +2 Accuracy, +1 Surge passives | PASSIVE_COMBAT | |

## Rancor

| Ability | Status | Notes |
|---------|--------|-------|
| Crippling Blow | WIRED | `crippling_blow` — freeAttackBonus + Stun honor system |
| Trained (suffer 1 Strain to reroll 1 attack die) | NOT_WIRED | MEDIUM — optional strain-for-reroll |
| Voracious (start of another figure's activation: defeat friendly to recover + ready) | NOT_WIRED | HARD — other-figure activation trigger + readying |
| Massive, Reach, Block 1 passives | N/A / PASSIVE_COMBAT | |

## Rebel Pathfinder (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Infiltration (after deployment: move up to 6) | NOT_WIRED | EASY — post-deploy freeMoveBonus |
| Light It Up (if target didn't have LOS to you at start: reroll 1 attack die) | NOT_WIRED | HARD — tracking LOS state at activation start |
| Distracting Fire (after attack not miss: force defender's group to activate next) | NOT_WIRED | HARD — activation order enforcement |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Rebel Saboteur (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Overload (trigger same surge up to twice) | NOT_WIRED | MEDIUM — surge trigger count override |
| Priority Target | WIRED | buildAndSendAttackTargets |
| +4 Accuracy passive | PASSIVE_COMBAT | |

## Rebel Saboteur (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Overload | NOT_WIRED | MEDIUM |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Rebel Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Aim (if not moved: +1 Hit, +2 Accuracy) | NOT_WIRED | MEDIUM — movement tracking conditional |
| Get into Position (double action: 4 MP + Focused) | WIRED | `get_into_position` — freeMoveBonus + Focus |

## Rebel Trooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Aim | NOT_WIRED | MEDIUM — movement tracking conditional |

## Riot Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Stun Batons | WIRED | index.js:3536 — auto 1 Strain after attack if dmg dealt |
| Shield (end of activation: gain Block Token if none) | WIRED | Handled in activation.js end-of-activation |
| Professional | PASSIVE_COMBAT | |

## Riot Trooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Stun Batons | WIRED | Same as Elite |
| Shield | WIRED | Same as Elite |

## Royal Guard (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Sentinel | WIRED | `sentinel` — +1 Block when adjacent friendly non-GUARDIAN defending |
| Forward Vengeance (adjacent friendly non-GUARDIAN defeated: Focused + move 1) | WIRED | index.js:3784 area (Vengeance variant) |
| Professional | PASSIVE_COMBAT | |
| Reach, Pierce 1 passives | N/A / PASSIVE_COMBAT | |

## Royal Guard (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Sentinel | WIRED | `sentinel` |
| Vengeance (adjacent friendly non-GUARDIAN defeated: Focused) | WIRED | index.js:3828 |
| Reach passive | N/A | |

## Royal Guard Champion

| Ability | Status | Notes |
|---------|--------|-------|
| Brutality | INFORMATIONAL | Shows instructions; 2 attacks different targets |
| Executor | WIRED | `executor` — freeMoveBonus + freeAttackBonus on friendly defeat |
| Overpower | WIRED | `overpower` — reroll red/black die |
| Reach passive | N/A | |

## Sabine Wren

| Ability | Status | Notes |
|---------|--------|-------|
| Evasive Maneuver | WIRED | `evasive_maneuver` — freeMoveBonus + recover |
| Parting Gift | WIRED | `parting_gift` — rollOneDie green, area damage |
| Mobile keyword | N/A | |

## Saska Teft

| Ability | Status | Notes |
|---------|--------|-------|
| Shady Contacts (army building) | N/A | |
| Unstable Devices (once/activation: friendly in LOS gains Device token) | NOT_WIRED | MEDIUM — token placement system |
| Power Converter (friendly with Device attacking: reroll + die swap) | NOT_WIRED | HARD — cross-figure reactive reroll + die swap |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Saw Gerrera

| Ability | Status | Notes |
|---------|--------|-------|
| Brutal Tactics (hostile defeated: choose hostile within 3, Weakened) | NOT_WIRED | MEDIUM — on-defeat reactive targeting |
| Wanton Destruction (after friendly attack: discard CC to deal 1 dmg to 2 figures near target) | NOT_WIRED | HARD — post-attack CC discard + multi-target |
| +2 Accuracy, +1 Surge passives | PASSIVE_COMBAT | |

## SC2-M Repulsor Tank

| Ability | Status | Notes |
|---------|--------|-------|
| Focus Fire (double action: 2 attacks same target) | INFORMATIONAL | `focus_fire_tank` — manual |
| Defensible (defending: +1 Block or +1 Evade) | NOT_WIRED | MEDIUM — defense choice |
| Massive, +2 Accuracy passives | N/A / PASSIVE_COMBAT | |

## Scout Trooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Camouflage (hostile 4+ spaces cannot draw LOS) | NOT_WIRED | HARD — LOS modification |
| Find Weakness (attacking: +3 Acc, -1 Evade) | WIRED | `find_weakness` in ability-library.json |
| Exploit Weakness (attacking figure w/ harmful condition: +1 Surge) | WIRED | `exploit_weakness` in ability-library.json |
| Professional, +3 Accuracy passives | PASSIVE_COMBAT | |

## Second Sister

| Ability | Status | Notes |
|---------|--------|-------|
| Force Leap | WIRED | `force_leap_second_sister` — pounce 6 spaces |
| Saber Orbit | INFORMATIONAL | `saber_orbit` — 3 melee attacks with 1 red die each |
| Mastery (surge) | WIRED | `mastery` surge — search CC discard |
| +1 Surge passive | PASSIVE_COMBAT | |

## Sentry Droid (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Multi-Fire | INFORMATIONAL | `multi_fire` — manual 2 attacks, -1 Hit each |
| Charged Shot | NOT_WIRED | EASY — freeAttackBonus + override accuracy |
| Targeting Computer | WIRED | `targeting_computer_sentry_elite` |

## Sentry Droid (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Multi-Fire | INFORMATIONAL | Same |
| Charged Shot | NOT_WIRED | EASY |
| Targeting Computer | WIRED | `targeting_computer_sentry_reg` |

## Shoretrooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Squad Training (adjacent friendly TROOPER: reroll 1 attack die) | NOT_WIRED | MEDIUM — adjacency-conditional reroll |
| Efficient Travel | N/A | Movement engine |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Shyla Varad

| Ability | Status | Notes |
|---------|--------|-------|
| Mandalorian Whip | WIRED | `mandalorian_whip` — push + free attack |
| Responsive | WIRED | activation.js:689 — choice: 1 MP or recover 1 |
| +1 Evade passive | PASSIVE_COMBAT | |

## Snowtrooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Disruptor Rifle | WIRED | `disruptor_rifle_snowtrooper` — freeAttackBonus + honor system finish |
| Spiked Boots (cannot be pushed except by MASSIVE) | NOT_WIRED | MEDIUM — push immunity filter |
| Immune (cannot gain harmful conditions) | NOT_WIRED | MEDIUM — condition application filter |
| Efficient Travel | N/A | |

## Snowtrooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Environmental Recovery Gear | WIRED | `env_recovery_gear` — recoverSelf + logMessage |

## Stormtrooper (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Squad Training | NOT_WIRED | MEDIUM — adjacency-conditional reroll |
| Last Stand (when defeated: another in group becomes Focused) | WIRED | index.js:3784 |

## Stormtrooper (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Squad Training | NOT_WIRED | MEDIUM — adjacency-conditional reroll |

## Super Commando (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Jetpack Rocket (spend 2 MP: roll 1 blue die, hostile within 3 suffers Hit dmg) | NOT_WIRED | MEDIUM — MP spend + rollOneDie pattern |
| Shield Gauntlets (spend 1 MP: gain Block token, once/activation) | NOT_WIRED | MEDIUM — MP spend + token gain |
| Mobile, Professional, +2 Accuracy, Pierce 1 passives | N/A / PASSIVE_COMBAT | |

## Taron Malicos

| Ability | Status | Notes |
|---------|--------|-------|
| Boulder Barrage | WIRED | `boulder_barrage` — fixedAreaEffect + placesRubble |
| Madness | WIRED | activation.js:668 — start of activation auto |
| Fallen Master (friendly FORCE USER ignore IMPERIAL restriction on CC) | NOT_WIRED | HARD — CC play rule override |
| +1 Surge passive | PASSIVE_COMBAT | |

## The Armorer

| Ability | Status | Notes |
|---------|--------|-------|
| Beskar Armor (after deployment: gain 2 Block Tokens) | WIRED | Batch 7 — post-deploy 2 Block Tokens in round.js |
| This is the Way (friendly defeats hostile: gain Block Token) | WIRED | index.js:3854 |
| Survival is Strength (friendly within 3 defending, spent Block: reroll 1 defense die) | NOT_WIRED | HARD — reactive on another figure's defense token spend |

## The Grand Inquisitor

| Ability | Status | Notes |
|---------|--------|-------|
| Precision (attacking or defending adjacent: choose 1 die to reroll) | NOT_WIRED | MEDIUM — contextual reroll choice |
| Lightsaber Throw | WIRED | `lightsaber_throw_gi` — ranged override + accuracy |
| Deadly Spin (surge) | WIRED | `deadly_spin` surge — -1 Dodge + Cleave 3 |

## The Mandalorian (Din Djarin)

| Ability | Status | Notes |
|---------|--------|-------|
| Beskar Armor (after deploy: gain 2 Block Tokens) | WIRED | Batch 7 — post-deploy 2 Block Tokens in round.js |
| Disruptor Rifle | WIRED | `disruptor_rifle_mando` — freeAttackBonus + honor system finish |
| Din's Wrist Flamethrower | WIRED | `dins_wrist_flamethrower` — fixedAreaEffect + freeMoveBonus |
| Paid in Beskar (hostile defeated within range: gain Block Token) | WIRED | index.js:3710 |

## The Mandalorian (Renegade Hunter)

| Ability | Status | Notes |
|---------|--------|-------|
| TBD | NOT_WIRED | Data incomplete — "TBD (IACP - verify from card)" |

## Thrawn

| Ability | Status | Notes |
|---------|--------|-------|
| Long-Laid Plans (start of activation: distribute N power tokens = round number) | NOT_WIRED | MEDIUM — multi-figure token distribution |
| Strategize (start of activation: look at top CC of both decks, discard 1) | NOT_WIRED | MEDIUM — deck peek + discard choice |
| Double surge abilities | WIRED | Double-surge parsing |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Trandoshan Hunter (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Relentless | WIRED | `relentless_trandoshan_elite` — auto-strain on declare |
| ACP Scattergun | WIRED | `acp_scattergun` — +2 Hits if adjacent |
| Hardy (end of round: discard all harmful conditions) | WIRED | Batch 7 — end-of-round condition clear in round.js |

## Trandoshan Hunter (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Relentless | WIRED | `relentless_trandoshan_reg` |
| Scattergun | WIRED | `scattergun` — +1 Hit if adjacent |

## Tress Hacnua

| Ability | Status | Notes |
|---------|--------|-------|
| Krayt Dragon Fury (X = surges rolled, used in surge abilities) | NOT_WIRED | HARD — dynamic surge value calculation |
| Fyrnock Style (attack or defend: choose 1 die to reroll) | NOT_WIRED | MEDIUM — contextual reroll choice |
| Leg Hydraulics (after attack: move 1 space) | WIRED | Batch 7 — post-attack 1 MP hook in index.js |

## Tusken Raider (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Tusken Cycler | WIRED | `tusken_cycler_elite` — override dice + ranged + accuracy |
| Double surge abilities | WIRED | Double-surge parsing |

## Tusken Raider (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Tusken Cycler | WIRED | `tusken_cycler_regular` — override dice (no abilities: honor system) |

## Ugnaught Tinkerer (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Spot Weld | INFORMATIONAL | `spot_weld` — companion placement manual |
| Overclock | INFORMATIONAL | `overclock` — companion action manual |
| Scrap Battalion (Junk Droid readies at start) | NOT_WIRED | HARD — companion readying system |

## Ugnaught Tinkerer (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Spot Weld | INFORMATIONAL | Same |
| Scrap Battalion | NOT_WIRED | HARD |

## Verena Talos

| Ability | Status | Notes |
|---------|--------|-------|
| Close Quarters | WIRED | `close_quarters` — freeMoveBonus + freeAttackBonus (target's pool: honor system) |
| Fighting Knife (surge) | WIRED | `fighting_knife` surge — roll 1 red die, adjacent hostile suffers Hit dmg |
| Improvised Cover (defending adjacent to object/non-friendly: +1 Block) | NOT_WIRED | MEDIUM — adjacency to terrain/figure check |
| +1 Evade passive | PASSIVE_COMBAT | |

## Vinto Hreeda

| Ability | Status | Notes |
|---------|--------|-------|
| Rapid Fire | WIRED | `rapid_fire_vinto` — freeAttackBonus |
| Boltslinger | WIRED | `boltslinger` — post-combat 1 dmg to hostile within 3 |

## Wampa (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Efficient Travel | N/A | Movement engine (in keywords) |
| Hunger (start of activation: if no hostile within 2, gain 3 MP + Block/Evade token) | WIRED | activation.js:714 — position-aware + token choice |
| Non-Sentient | N/A | |
| +2 Hit, Reach passives | PASSIVE_COMBAT / N/A | |

## Wampa (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Efficient Travel | N/A | Movement engine |
| Hunger (start of activation: if no hostile within 3, gain 2 MP) | WIRED | activation.js:714 |
| Non-Sentient | N/A | |
| +1 Hit passive | PASSIVE_COMBAT | |

## Weequay Pirate (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Prowl | WIRED | `prowl` — become Hidden |
| Raider (attack or defend: choose 1 die to reroll) | NOT_WIRED | MEDIUM — contextual reroll choice |
| +2 Accuracy passive | PASSIVE_COMBAT | |

## Weequay Pirate (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Raider | NOT_WIRED | MEDIUM — contextual reroll choice |
| +1 Accuracy passive | PASSIVE_COMBAT | |

## Wing Guard (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Keep the Peace | WIRED | `keep_the_peace_elite` — attacker suffers 1 Strain |
| Bespin Security | WIRED | `bespin_security` — adjacent LEADER/SCUM TROOPER reroll |

## Wing Guard (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Keep the Peace | WIRED | `keep_the_peace_regular` — self suffers 1 Strain, attacker suffers 1 Strain |

## Wookiee Warrior (Elite)

| Ability | Status | Notes |
|---------|--------|-------|
| Fury | WIRED | `fury_wookiee_elite` — +1 Surge if 5+ damage |

## Wookiee Warrior (Regular)

| Ability | Status | Notes |
|---------|--------|-------|
| Fury | WIRED | `fury_wookiee_reg` |

## Yoda

| Ability | Status | Notes |
|---------|--------|-------|
| Do or Do Not | WIRED | `do_or_do_not_yoda` — REBEL FORCE USER becomes Focused |
| Calming Presence (start of friendly REBEL activation: remove harmful + 1 strain) | NOT_WIRED | HARD — other-figure activation trigger |
| Wisdom (start of activation: draw CC, place 1 from hand on bottom) | NOT_WIRED | MEDIUM — deck manipulation |
| Force Deflection (after attack on you or adjacent: attacker suffers dmg = attack dice count) | NOT_WIRED | HARD — post-attack reactive damage |

## Zeb Orrelios

| Ability | Status | Notes |
|---------|--------|-------|
| Bo-Rifle Staff Strike | WIRED | `bo_rifle_staff_strike` — free melee with 2 red dice |
| Lasat-Honor Guard (after rerolls: turn 1 single-icon die to any side) | PARTIAL | `lasat_honor_guard` — has entry but die conversion is honor system |
| +3 Accuracy passive | PASSIVE_COMBAT | |

## Zuckuss

| Ability | Status | Notes |
|---------|--------|-------|
| Mystic Hunter (declare attack: become Focused) | WIRED | Checked in combat.js:292 |
| Stun Net (surge) | WIRED | `stun_net` surge — target becomes Stunned |
| Shared Calculations (friendly DROID within 3 w/ LOS: force defender reroll) | NOT_WIRED | HARD — cross-figure LOS + defense reroll forcing |
| +2 Accuracy passive | PASSIVE_COMBAT | |

---

## Summary Statistics

### By Status (approximate across ~168 figures, ~380 abilities)
| Status | Count |
|--------|-------|
| WIRED | ~155 |
| PASSIVE_COMBAT | ~60 |
| N/A | ~35 |
| INFORMATIONAL | ~10 |
| PARTIAL | ~4 (Sustained by Rage, Lasat-Honor Guard, Figurehead, Self-Destruct Protocol) |
| NOT_WIRED | ~115 |

### NOT_WIRED by Difficulty
| Difficulty | Count | Examples |
|------------|-------|----------|
| EASY | ~18 | Beskar Armor (token grant), Curious (post-interact), Hardy (EoR condition clear), Infiltration, Service, Born to Fly, Smooth Landing, Ambush, Security Detail, Bounty, Durasteel Fist, Charged Shot, Leg Hydraulics, HK-47 Mockery |
| MEDIUM | ~52 | Squad Training, Aim, Self-Preservation, Defensible, Take Cover, Overload, Spray Fire, Arms Distribution, Jetpack Rocket, Shield Gauntlets, Droid Kit, Pulse Cannon, Agile, Immune, Cower, Precision, Raider, Fyrnock Style, Nimble, Bo-Rifle, Fulcrum, Madness, Wisdom, Long-Laid Plans, etc. |
| HARD | ~45 | Parting Shot, Slow on the Draw, Call the Shots, Dead Precise, Vague and Unconvincing, Cassian Said I Had To, Force Vision, Calming Presence, Overwatch, Camouflage (LOS mod), Negotiate, General's Orders, Stampede, Voracious, Form cards, Field Tactics, Comms Jammer, I Make the Rules Now, Force Slow, Sling Barrage, Shrewd Scoundrel, etc. |

### Highest-Impact NOT_WIRED (commonly played figures)
1. **Squad Training** — Stormtrooper E/R, Shoretrooper E (MEDIUM)
2. **Aim** — Rebel Trooper E/R (MEDIUM)
3. **Parting Shot** — Greedo, Hired Guns (HARD)
4. **Overload** — Rebel Saboteur E/R (MEDIUM)
5. **Call the Shots** — Hera Syndulla (HARD)
6. **Negotiate** — Hondo Ohnaka (HARD)
7. **Agile** — Jet Trooper E/R (MEDIUM)
8. **Long-Laid Plans** — Thrawn (MEDIUM)
9. **Arms Distribution** — Ko-Tun Feralo (MEDIUM)
10. **Self-Preservation** — Hired Gun Elite (MEDIUM)
11. **Field Tactics** — Death Trooper E/R (HARD)
12. **Beskar Armor** — The Mandalorian, The Armorer (EASY)
13. **Hardy** — Trandoshan Hunter Elite (EASY)
14. **Precision** — The Grand Inquisitor (MEDIUM)
15. **Resourceful/Gambit/Shrewd** — Lando Calrissian (HARD)
