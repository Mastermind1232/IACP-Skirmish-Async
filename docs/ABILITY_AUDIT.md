# Deterministic Ability Audit

**Code-generated** from `dc-effects.json` + `ability-library.json`. Run `node audit-stubs.cjs` to regenerate.
Generated: 2026-02-26

## Status Key
- **WIRED** — Fully automated with code
- **WIRED_SURGE** — Surge ability handled by parseSurgeEffect
- **PASSIVE_COMBAT** — Auto-applied in combat (+Hit, Pierce, Bleed, etc.)
- **PASSIVE_DATA_ONLY** — Listed in passives array, no known code hook
- **INFORMATIONAL** — Shows instructions to player, no mechanical effect
- **N/A** — Restriction text, flavor, or not applicable
- **N/A_HONOR** — Cannot be automated (Assault multi-attack tracking)
- **NOT_WIRED** — Zero code coverage

---

### 0-0-0
| Ability | Status |
|---------|--------|
| Surge: Shocking Palm | WIRED_SURGE |
| Special: Invasive Procedure | WIRED |
| Unnerving | WIRED |

### 4-LOM
| Ability | Status |
|---------|--------|
| Programming Override | NOT_WIRED |
| Surge: Concussive Bolt | WIRED_SURGE |
| Shared Intuition | WIRED |

### Agent Blaise
| Ability | Status |
|---------|--------|
| Adapt | NOT_WIRED |
| Surge: Interrogate | WIRED_SURGE |

### Agent Kallus
| Ability | Status |
|---------|--------|
| Hunt Dissent | NOT_WIRED |
| Fulcrum | NOT_WIRED |
| Bo-Rifle | NOT_WIRED |

### Ahsoka Tano
| Ability | Status |
|---------|--------|
| Special: Force Leap | WIRED |
| Vigor | WIRED |
| Twin Sabers | NOT_WIRED |

### Alliance Ranger (Elite)
| Ability | Status |
|---------|--------|
| Guerilla | WIRED |
| Elite Sniper | WIRED |

### Alliance Ranger (Regular)
| Ability | Status |
|---------|--------|
| Guerilla | WIRED |
| Sniper | WIRED |

### Alliance Smuggler (Elite)
| Ability | Status |
|---------|--------|
| Special: Improved Smuggler's Instincts | WIRED |
| Slippery | NOT_WIRED |

### Alliance Smuggler (Regular)
| Ability | Status |
|---------|--------|
| Special: Smuggler's Instincts | WIRED |
| Slippery | NOT_WIRED |

### Asajj Ventress
| Ability | Status |
|---------|--------|
| Nimble | NOT_WIRED |
| Consider It My Payment | NOT_WIRED |

### AT-DP
| Ability | Status |
|---------|--------|
| Assault | N/A_HONOR |
| Charge Generators | WIRED |

### AT-RT
| Ability | Status |
|---------|--------|
| Mortar Launcher | WIRED |
| Vanguard | WIRED |

### AT-ST
| Ability | Status |
|---------|--------|
| Targeting Computer | NOT_WIRED |
| Awkward | NOT_WIRED |

### Bantha Rider
| Ability | Status |
|---------|--------|
| Special: Trample | WIRED |

### Baze Malbus
| Ability | Status |
|---------|--------|
| Into the Fray | WIRED |
| Assault | N/A_HONOR |
| Hold the Line | WIRED |

### Bib Fortuna
| Ability | Status |
|---------|--------|
| Dirty Dealing | NOT_WIRED |
| Special: Bartered Information | WIRED |
| Illicit Arms | NOT_WIRED |

### Biv Bodhrik
| Ability | Status |
|---------|--------|
| Special: Multi-Fire | INFORMATIONAL |
| Surge: Suppression | WIRED_SURGE |

### Boba Fett
| Ability | Status |
|---------|--------|
| Wrist Cord | WIRED |
| Wrist Flamethrower | WIRED |
| EE-3 Carbine | WIRED |

### Bodhi Rook
| Ability | Status |
|---------|--------|
| Smooth Landing | WIRED |
| Air Support | NOT_WIRED |

### Bossk
| Ability | Status |
|---------|--------|
| Special: Indiscriminate Fire | WIRED |
| Regenerate | WIRED |

### BT-1
| Ability | Status |
|---------|--------|
| Special: Missile Salvo | WIRED |
| Assassin | WIRED |

### C-3P0
| Ability | Status |
|---------|--------|
| Special: Inform | WIRED |
| Cower | NOT_WIRED |
| Distracting | WIRED |
| Non-Combatant | NOT_WIRED |

### C1-10P "Chopper"
| Ability | Status |
|---------|--------|
| Special: Ram | WIRED |
| Special: System Shock | WIRED |

### Cad Bane
| Ability | Status |
|---------|--------|
| Flawless Execution | WIRED |
| I Make the Rules Now | NOT_WIRED |

### Cal Kestis
| Ability | Status |
|---------|--------|
| Special: Wall Run | WIRED |
| Force Slow | NOT_WIRED |

### Captain Terro
| Ability | Status |
|---------|--------|
| Special: Flamethrower | NOT_WIRED |
| Mounted | WIRED |
| Efficient Travel | WIRED |
| Professional | NOT_WIRED |

### Cara Dune
| Ability | Status |
|---------|--------|
| Shock and Awe | WIRED |
| Smash | WIRED |
| Hunker Down | WIRED |

### Cassian Andor
| Ability | Status |
|---------|--------|
| Strike Team | NOT_WIRED |
| It Will be Alright | NOT_WIRED |

### Chewbacca
| Ability | Status |
|---------|--------|
| Special: Slam | WIRED |
| Protector | WIRED |

### Chirrut Imwe
| Ability | Status |
|---------|--------|
| Devout | NOT_WIRED |
| I'm One With the Force | WIRED |
| The Force is With Me | NOT_WIRED |

### Clawdite Shapeshifter (Elite)
| Ability | Status |
|---------|--------|
| Shape | NOT_WIRED |
| Shift | NOT_WIRED |

### Clawdite Shapeshifter (Regular)
| Ability | Status |
|---------|--------|
| Shape | NOT_WIRED |
| Shift | NOT_WIRED |

### CT-1701
| Ability | Status |
|---------|--------|
| Special: Barrage | INFORMATIONAL |
| Cover Fire | WIRED |

### Dark Trooper Mk III
| Ability | Status |
|---------|--------|
| Advanced Targeting Computer | NOT_WIRED |
| Durasteel Fist | NOT_WIRED |
| Special: Lift Off | WIRED |

### Darth Vader
| Ability | Status |
|---------|--------|
| Special: Brutality | WIRED |
| Special: Force Choke | WIRED |
| Foresight | WIRED |

### Davith Elso
| Ability | Status |
|---------|--------|
| Stealthy | WIRED |
| Cut and Run | NOT_WIRED |
| Surge: Fell Swoop | WIRED_SURGE |

### Death Trooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Captain | WIRED |
| Field Tactics | NOT_WIRED |

### Death Trooper (Regular)
| Ability | Status |
|---------|--------|
| Security Detail | WIRED |
| Field Tactics | NOT_WIRED |

### Del Meeko
| Ability | Status |
|---------|--------|
| Expertise | WIRED |
| Special: Gifted Mechanic | WIRED |
| Open-Minded | WIRED |

### Dengar
| Ability | Status |
|---------|--------|
| Surge: Spread the Pain | WIRED_SURGE |

### Dewback Rider
| Ability | Status |
|---------|--------|
| Special: Shock Lance | WIRED |
| Mounted | WIRED |

### Diala Passil
| Ability | Status |
|---------|--------|
| Battle Meditation | WIRED |
| Defensive Stance | WIRED |
| Force Throw | WIRED |

### Director Krennic
| Ability | Status |
|---------|--------|
| Advanced Weapons Research | WIRED |
| Unhinged Director | NOT_WIRED |

### Doctor Aphra
| Ability | Status |
|---------|--------|
| Dubious Counterparts | NOT_WIRED |
| Excavation | NOT_WIRED |

### Dr. Royce Hemlock
| Ability | Status |
|---------|--------|
| Special: Neurotoxin | WIRED |
| Special: Neurostim | WIRED |

### Drokkatta
| Ability | Status |
|---------|--------|
| Demolish | WIRED |
| Surge: Shrapnel | WIRED_SURGE |

### E-Web Engineer (Elite)
| Ability | Status |
|---------|--------|
| Forward Emplacement | WIRED |
| Tripod | NOT_WIRED |
| Assault | N/A_HONOR |

### E-Web Engineer (Regular)
| Ability | Status |
|---------|--------|
| Tripod | NOT_WIRED |
| Assault | N/A_HONOR |

### Echo Base Trooper (Elite)
| Ability | Status |
|---------|--------|
| Front Line | WIRED |
| Cortosis Weave | WIRED |

### Echo Base Trooper (Regular)
| Ability | Status |
|---------|--------|
| Front Line | WIRED |
| Efficient Travel | WIRED |

### Emperor Palpatine
| Ability | Status |
|---------|--------|
| Emperor | WIRED |
| Tempt | WIRED |
| Special: Force Lightning | WIRED |

### Ewok Warrior (Elite)
| Ability | Status |
|---------|--------|
| Ambush | WIRED |
| Forest Fighters | WIRED |
| Special: Sling Barrage | NOT_WIRED |

### Ezra Bridger
| Ability | Status |
|---------|--------|
| Brush | NOT_WIRED |
| Much to Learn | WIRED |

### Fenn Signis
| Ability | Status |
|---------|--------|
| Havoc Shot | WIRED |
| Tactical Movement | WIRED |

### Fennec Shand
| Ability | Status |
|---------|--------|
| Bounty | WIRED |
| Sharpshooter | WIRED |

### Fifth Brother
| Ability | Status |
|---------|--------|
| Vigor | WIRED |
| Relentless Pursuit | WIRED |
| Special: Sith Acolyte | INFORMATIONAL |

### Gaarkhan
| Ability | Status |
|---------|--------|
| Brutal Cleave | WIRED |
| Special: Charge | WIRED |

### Gamorrean Guard (Elite)
| Ability | Status |
|---------|--------|
| Gamorrean Honor Guard | WIRED |
| Professional | PASSIVE_COMBAT |

### Gar Saxon
| Ability | Status |
|---------|--------|
| Airborne Commander | NOT_WIRED |
| Personal Combat Shield | NOT_WIRED |
| Special: Gar Saxon's Flamethrower | WIRED |

### General Sorin
| Ability | Status |
|---------|--------|
| Special: Bombardment | WIRED |
| Advanced Firepower | NOT_WIRED |

### General Weiss
| Ability | Status |
|---------|--------|
| General's Orders | NOT_WIRED |
| Epic Arsenal | WIRED |

### Gideon Argus
| Ability | Status |
|---------|--------|
| Special: Tactical Maneuver | WIRED |
| Special: On My Mark | WIRED |

### Greedo
| Ability | Status |
|---------|--------|
| Slow on the Draw | NOT_WIRED |
| Parting Shot | NOT_WIRED |

### Han Solo
| Ability | Status |
|---------|--------|
| Return Fire | WIRED |
| Distracting | WIRED |
| Cunning | WIRED |

### Heavy Stormtrooper (Elite)
| Ability | Status |
|---------|--------|
| Modular | NOT_WIRED |
| Spray Fire | NOT_WIRED |

### Heavy Stormtrooper (Regular)
| Ability | Status |
|---------|--------|
| Composite Plating | WIRED |

### Hera Syndulla
| Ability | Status |
|---------|--------|
| Call the Shots | NOT_WIRED |
| Smooth Landing | WIRED |

### Hired Gun (Elite)
| Ability | Status |
|---------|--------|
| Self-Preservation | WIRED |
| Parting Shot | NOT_WIRED |

### Hired Gun (Regular)
| Ability | Status |
|---------|--------|
| Parting Shot | NOT_WIRED |
| Disposable | WIRED |

### HK Assassin Droid (Elite)
| Ability | Status |
|---------|--------|
| Targeting Computer | WIRED |
| Versatile Weaponry | NOT_WIRED |
| Merciless | WIRED |

### HK-47
| Ability | Status |
|---------|--------|
| Query | WIRED |
| Conclusion | WIRED |
| Mockery | WIRED |

### Hondo Ohnaka
| Ability | Status |
|---------|--------|
| Negotiate | NOT_WIRED |
| What's Yours is Mine | NOT_WIRED |

### IG-11
| Ability | Status |
|---------|--------|
| Special: Rapid Fire | WIRED |
| Targeting Computer | WIRED |
| Self-Destruct Protocol | WIRED |

### IG-88
| Ability | Status |
|---------|--------|
| Arsenal | WIRED |
| Relentless | PASSIVE_DATA_ONLY |
| Assault | N/A_HONOR |

### Imperial Officer (Elite)
| Ability | Status |
|---------|--------|
| Special: Executive Order | WIRED |

### Imperial Officer (Regular)
| Ability | Status |
|---------|--------|
| Special: Order | WIRED |
| Cower | NOT_WIRED |

### ISB Infiltrator (Elite)
| Ability | Status |
|---------|--------|
| In The Shadows | WIRED |
| Comms Jammer | NOT_WIRED |
| Special: Coordinated Raid | WIRED |

### ISB Infiltrator (Regular)
| Ability | Status |
|---------|--------|
| Special: Coordinated Raid | WIRED |

### Jabba the Hutt
| Ability | Status |
|---------|--------|
| Special: Bully | WIRED |
| Special: Incentivize | WIRED |
| Special: Scheme | WIRED |
| Double Action Special (Order Hit) | NOT_WIRED |
| Nefarious Gains | WIRED |

### Jawa Scavenger (Elite)
| Ability | Status |
|---------|--------|
| Surge: Bargain | WIRED_SURGE |
| Take Cover | NOT_WIRED |
| Scavenged Stock | NOT_WIRED |

### Jawa Scavenger (Regular)
| Ability | Status |
|---------|--------|
| Surge: Harass | WIRED_SURGE |
| Take Cover | NOT_WIRED |

### Jet Trooper (Elite)
| Ability | Status |
|---------|--------|
| Agile | NOT_WIRED |
| Fly-By | WIRED |

### Jet Trooper (Regular)
| Ability | Status |
|---------|--------|
| Agile | NOT_WIRED |
| Jets | WIRED |

### Jyn Erso
| Ability | Status |
|---------|--------|
| Trust Goes Both Ways | NOT_WIRED |
| Special: Tonfa Strike | WIRED |

### Jyn Odan
| Ability | Status |
|---------|--------|
| Hair Trigger | WIRED |
| Sidewinder | WIRED |
| Cunning | WIRED |

### K-2S0
| Ability | Status |
|---------|--------|
| Vague and Unconvincing | NOT_WIRED |
| Cassian Said I Had To | NOT_WIRED |
| Special: Continually Unexpected | WIRED |

### Kanan Jarrus
| Ability | Status |
|---------|--------|
| Force Vision | NOT_WIRED |
| Soresu Form | WIRED |

### Kayn Somos
| Ability | Status |
|---------|--------|
| Special: Firing Squad | WIRED |
| Surge: Squad Command | WIRED_SURGE |

### Ko-Tun Feralo
| Ability | Status |
|---------|--------|
| Arms Distribution | NOT_WIRED |
| Dead Precise | NOT_WIRED |
| Squad Cohesion | NOT_WIRED |

### Krrsantan
| Ability | Status |
|---------|--------|
| Full of Rage | WIRED |
| Electrified Knuckledusters | WIRED |

### Kuiil
| Ability | Status |
|---------|--------|
| Mounted | WIRED |
| Special: Hop On! | NOT_WIRED |

### Lando Calrissian
| Ability | Status |
|---------|--------|
| Resourceful | NOT_WIRED |
| Gambit | NOT_WIRED |
| Shrewd Scoundrel | NOT_WIRED |

### Leia Organa
| Ability | Status |
|---------|--------|
| Special: Battlefield Leadership | WIRED |
| Military Efficiency | WIRED |

### Loku Kanoloa
| Ability | Status |
|---------|--------|
| Set Your Sights | NOT_WIRED |
| Priority Target | WIRED |
| Mon Cala Special Forces | NOT_WIRED |

### Loth-cat (Elite)
| Ability | Status |
|---------|--------|
| Special: Pounce | WIRED |
| Special: Fresh Catch | WIRED |
| Curious | WIRED |

### Loth-cat (Regular)
| Ability | Status |
|---------|--------|
| Special: Pounce | WIRED |
| Special: Rat Catcher | WIRED |
| Curious | WIRED |

### Luke Skywalker
| Ability | Status |
|---------|--------|
| Special: Saber Strike | WIRED |
| Inspiring | WIRED |

### Luke Skywalker (Jedi Knight)
| Ability | Status |
|---------|--------|
| Deflect | WIRED |
| Heroic | WIRED |

### Mak Eshka'rey
| Ability | Status |
|---------|--------|
| Surge: Critical Hit | WIRED_SURGE |
| Camouflage | NOT_WIRED |

### Mara Jade
| Ability | Status |
|---------|--------|
| Adaptive Skills | NOT_WIRED |
| Fast Learner | NOT_WIRED |
| Professional | NOT_WIRED |

### Maul
| Ability | Status |
|---------|--------|
| Dual-Bladed Fury | WIRED |
| Surge: Stalk Prey | WIRED_SURGE |
| Sustained by Rage | WIRED |

### MHD-19
| Ability | Status |
|---------|--------|
| Special: Medical Loadout | WIRED |
| Special: Improper Procedure | NOT_WIRED |

### Migs Mayfeld
| Ability | Status |
|---------|--------|
| Locked and Loaded | WIRED |
| Return Fire | NOT_WIRED |

### Murne Rin
| Ability | Status |
|---------|--------|
| Special: False Orders | WIRED |
| Special: Field Report | WIRED |
| Figurehead | WIRED |

### Nexu (Elite)
| Ability | Status |
|---------|--------|
| Special: Pounce | WIRED |
| Cunning | WIRED |
| Non-Sentient | N/A |

### Nexu (Regular)
| Ability | Status |
|---------|--------|
| Special: Pounce | WIRED |
| Cunning | WIRED |
| Non-Sentient | N/A |

### Obi-Wan Kenobi
| Ability | Status |
|---------|--------|
| Alter Mind | NOT_WIRED |
| Strike Me Down | NOT_WIRED |
| Into the Force | WIRED |

### Onar Koma
| Ability | Status |
|---------|--------|
| Special: Rush | WIRED |
| Get Down | NOT_WIRED |
| Immune | NOT_WIRED |

### Probe Droid (Elite)
| Ability | Status |
|---------|--------|
| Targeting Computer | WIRED |
| Self-Destruct | WIRED |

### Probe Droid (Regular)
| Ability | Status |
|---------|--------|
| Self-Destruct | NOT_WIRED |

### Purge Commander (Elite)
| Ability | Status |
|---------|--------|
| Special: Shock Grenade | WIRED |
| Coordinated Hunt | NOT_WIRED |

### Purge Trooper (Elite)
| Ability | Status |
|---------|--------|
| Imperial Loadout | NOT_WIRED |
| Special: On the Hunt | WIRED |

### R2-D2
| Ability | Status |
|---------|--------|
| Special: Scomp Link | WIRED |
| Special: Service | NOT_WIRED |
| Lucky | NOT_WIRED |

### Rancor
| Ability | Status |
|---------|--------|
| Special: Crippling Blow | WIRED |
| Trained | NOT_WIRED |
| Voracious | NOT_WIRED |

### Rebel Pathfinder (Elite)
| Ability | Status |
|---------|--------|
| Infiltration | NOT_WIRED |
| Light It Up | NOT_WIRED |
| Distracting Fire | NOT_WIRED |

### Rebel Saboteur (Elite)
| Ability | Status |
|---------|--------|
| Overload | NOT_WIRED |
| Priority Target | WIRED |

### Rebel Saboteur (Regular)
| Ability | Status |
|---------|--------|
| Overload | NOT_WIRED |

### Rebel Trooper (Elite)
| Ability | Status |
|---------|--------|
| Aim | NOT_WIRED |
| Double Action Special (Get into Position) | NOT_WIRED |

### Rebel Trooper (Regular)
| Ability | Status |
|---------|--------|
| Aim | NOT_WIRED |

### Riot Trooper (Elite)
| Ability | Status |
|---------|--------|
| Stun Batons | WIRED |
| Shield | WIRED |
| Professional | NOT_WIRED |

### Riot Trooper (Regular)
| Ability | Status |
|---------|--------|
| Stun Batons | WIRED |
| Shield | WIRED |

### Royal Guard (Elite)
| Ability | Status |
|---------|--------|
| Sentinel | WIRED |
| Forward Vengeance | WIRED |
| Professional | NOT_WIRED |

### Royal Guard (Regular)
| Ability | Status |
|---------|--------|
| Sentinel | WIRED |
| Vengeance | WIRED |

### Royal Guard Champion
| Ability | Status |
|---------|--------|
| Special: Brutality | WIRED |
| Executor | WIRED |
| Overpower | WIRED |

### Sabine Wren
| Ability | Status |
|---------|--------|
| Special: Evasive Maneuver | WIRED |
| Parting Gift | WIRED |

### Saska Teft
| Ability | Status |
|---------|--------|
| Shady Contacts | NOT_WIRED |
| Unstable Devices | NOT_WIRED |
| Power Converter | NOT_WIRED |

### Saw Gerrerra
| Ability | Status |
|---------|--------|
| Brutal Tactics | NOT_WIRED |
| Wanton Destruction | NOT_WIRED |

### SC2-M Repulsor Tank
| Ability | Status |
|---------|--------|
| Double Action Special (Focus Fire) | NOT_WIRED |
| Defensible | NOT_WIRED |

### Scout Trooper (Elite)
| Ability | Status |
|---------|--------|
| Camouflage | NOT_WIRED |
| Find Weakness | WIRED |
| Exploit Weakness | WIRED |

### Second Sister
| Ability | Status |
|---------|--------|
| Special: Force Leap | WIRED |
| Special: Saber Orbit | INFORMATIONAL |
| Surge: Mastery | WIRED_SURGE |

### Sentry Droid (Elite)
| Ability | Status |
|---------|--------|
| Special: Multi-Fire | INFORMATIONAL |
| Special: Charged Shot | NOT_WIRED |
| Targeting Computer | WIRED |

### Sentry Droid (Regular)
| Ability | Status |
|---------|--------|
| Special: Multi-Fire | INFORMATIONAL |
| Special: Charged Shot | NOT_WIRED |
| Targeting Computer | WIRED |

### Shoretrooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Training | NOT_WIRED |

### Shyla Varad
| Ability | Status |
|---------|--------|
| Special: Mandalorian Whip | WIRED |
| Responsive | WIRED |

### Snowtrooper (Elite)
| Ability | Status |
|---------|--------|
| Special: Disruptor Rifle | WIRED |
| Spiked Boots | NOT_WIRED |
| Immune | NOT_WIRED |

### Snowtrooper (Regular)
| Ability | Status |
|---------|--------|
| Special: Environmental Recovery Gear | WIRED |

### Stormtrooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Training | NOT_WIRED |
| Last Stand | WIRED |

### Stormtrooper (Regular)
| Ability | Status |
|---------|--------|
| Squad Training | NOT_WIRED |

### Super Commando (Elite)
| Ability | Status |
|---------|--------|
| Jetpack Rocket | NOT_WIRED |
| Shield Gauntlets | NOT_WIRED |

### Taron Malicos
| Ability | Status |
|---------|--------|
| Fallen Master | NOT_WIRED |
| Madness | WIRED |
| Special: Boulder Barrage | WIRED |

### The Armorer
| Ability | Status |
|---------|--------|
| Beskar Armor | WIRED |
| This is the Way | WIRED |
| Survival is Strength | NOT_WIRED |

### The Grand Inquisitor
| Ability | Status |
|---------|--------|
| Precision | NOT_WIRED |
| Special: Lightsaber Throw | WIRED |
| Surge: Deadly Spin | WIRED_SURGE |

### The Mandalorian
| Ability | Status |
|---------|--------|
| Beskar Armor | WIRED |
| Special: Disruptor Rifle | WIRED |
| Special: Din's Wrist Flamethrower | WIRED |

### Thrawn
| Ability | Status |
|---------|--------|
| Long-Laid Plans | NOT_WIRED |
| Strategize | NOT_WIRED |

### Trandoshan Hunter (Elite)
| Ability | Status |
|---------|--------|
| Relentless | WIRED |
| ACP Scattergun | WIRED |
| Hardy | WIRED |

### Trandoshan Hunter (Regular)
| Ability | Status |
|---------|--------|
| Relentless | WIRED |
| Scattergun | WIRED |

### Tress Hacnua
| Ability | Status |
|---------|--------|
| Krayt Dragon Fury | NOT_WIRED |
| Fyrnock Style | NOT_WIRED |
| Leg Hydraulics | WIRED |

### Tusken Raider (Elite)
| Ability | Status |
|---------|--------|
| Special: Tusken Cycler | WIRED |

### Tusken Raider (Regular)
| Ability | Status |
|---------|--------|
| Special: Tusken Cycler | WIRED |

### Ugnaught Tinkerer (Elite)
| Ability | Status |
|---------|--------|
| Special: Spot Weld | INFORMATIONAL |
| Special: Overclock | INFORMATIONAL |
| Scrap Battalion | NOT_WIRED |

### Ugnaught Tinkerer (Regular)
| Ability | Status |
|---------|--------|
| Special: Spot Weld | INFORMATIONAL |
| Scrap Battalion | NOT_WIRED |

### Verena Talos
| Ability | Status |
|---------|--------|
| Special: Close Quarters | WIRED |
| Surge: Fighting Knife | WIRED_SURGE |
| Improvised Cover | NOT_WIRED |

### Vinto Hreeda
| Ability | Status |
|---------|--------|
| Special: Rapid Fire | WIRED |
| Boltslinger | WIRED |

### Wampa (Elite)
| Ability | Status |
|---------|--------|
| Efficient Travel | WIRED |
| Hunger | WIRED |
| Non-Sentient | N/A |

### Wampa (Regular)
| Ability | Status |
|---------|--------|
| Efficient Travel | WIRED |
| Hunger | WIRED |
| Non-Sentient | N/A |

### Weequay Pirate (Elite)
| Ability | Status |
|---------|--------|
| Special: Prowl | WIRED |
| Raider | NOT_WIRED |

### Weequay Pirate (Regular)
| Ability | Status |
|---------|--------|
| Raider | NOT_WIRED |

### Wing Guard (Elite)
| Ability | Status |
|---------|--------|
| Keep the Peace | WIRED |
| Bespin Security | WIRED |

### Wing Guard (Regular)
| Ability | Status |
|---------|--------|
| Keep the Peace | WIRED |

### Wookiee Warrior (Elite)
| Ability | Status |
|---------|--------|
| Fury | WIRED |

### Wookiee Warrior (Regular)
| Ability | Status |
|---------|--------|
| Fury | WIRED |

### Yoda
| Ability | Status |
|---------|--------|
| Calming Presence | NOT_WIRED |
| Wisdom | NOT_WIRED |
| Special: Do or Do Not | WIRED |
| Force Deflection | NOT_WIRED |

### Zeb Orrelios
| Ability | Status |
|---------|--------|
| Bo-Rifle Staff Strike | WIRED |
| Lasat-Honor Guard | WIRED |

### Zuckuss
| Ability | Status |
|---------|--------|
| Mystic Hunter | WIRED |
| Surge: Stun Net | WIRED_SURGE |
| Shared Calculations | NOT_WIRED |

---

## Summary

**Total abilities:** 383

| Status | Count | % |
|--------|-------|---|
| WIRED | 211 | 55% |
| NOT_WIRED | 136 | 36% |
| WIRED_SURGE | 16 | 4% |
| INFORMATIONAL | 9 | 2% |
| N/A_HONOR | 5 | 1% |
| N/A | 4 | 1% |
| PASSIVE_COMBAT | 1 | 0% |
| PASSIVE_DATA_ONLY | 1 | 0% |

**Automated:** 228 (60%)
**Not wired:** 136 (36%)

---

## NOT_WIRED — Complete List

| Figure | Ability | Description |
|--------|---------|-------------|
| 4-LOM | Programming Override | At the start of each round, choose one TRAIT. You gain that TRAIT until the end of the round. |
| Agent Blaise | Adapt | The first time your opponent plays a Command card each round, choose 1 SPY or TROOPER. That figure becomes Hidden |
| Agent Kallus | Hunt Dissent | When your opponent plays a Command card, you may distribute 2 Hit Tokens among friendly figures within 1 space. Limit once per round. |
| Agent Kallus | Fulcrum | At the start of your activation, you may have each player draw 1 Command card. |
| Agent Kallus | Bo-Rifle | Before you declare an attack, you may treat your attack type as Melee. If you do, replace 1 blue die with 1 red die. |
| Ahsoka Tano | Twin Sabers | While attacking, you may reroll all attack die or force the defender to reroll all defense die. |
| Alliance Smuggler (Elite) | Slippery | While defending, apply -2 Accuracy to the attack results. After an attack targeting you resolves, gain 2 movement points. |
| Alliance Smuggler (Regular) | Slippery | While defending, apply -2 Accuracy to the attack results. After an attack targeting you resolves, gain 2 movement points. |
| Asajj Ventress | Nimble | After an attack targeting you is resolved, gain 2 movement points for each of your Block results. |
| Asajj Ventress | Consider It My Payment | At the start of your activation, your opponent reveals a Command card from his hand. During this round, if the next Command card played by that player |
| AT-ST | Targeting Computer | While attacking, you may reroll 1 attack die. |
| AT-ST | Awkward | You cannot attack adjacent figures. |
| Bib Fortuna | Dirty Dealing | You cannot be included in the same army as any REBEL Deployment cards. |
| Bib Fortuna | Illicit Arms | While a friendly figure is attacking, if your army's affiliation is SCUM, you may discard 1 Command card from your hand to apply +1 Hit to the attack  |
| Bodhi Rook | Air Support | When a friendly figure spends a Power Token while attacking, apply +2 Accuracy to the attack results. |
| C-3P0 | Cower | While defending, while adjacent to a friendly figure, you may reroll 1 defense die. |
| C-3P0 | Non-Combatant | You cannot attack. |
| Cad Bane | I Make the Rules Now | At the start of another figure's activation, a friendly HUNTER within 4 spaces may gain 1 movement point. Limit once per round. |
| Cal Kestis | Force Slow | At the start of the round, choose a hostile figure within 3 spaces. That figure's group cannot be activated during its owner's next opportunity to res |
| Captain Terro | Special: Flamethrower | Choose a space within 2 spaces. Each other figure on or adjacent to that space suffers 1 Damage and 1 Strain, then becomes Weakened. |
| Captain Terro | Professional | While attacking, you may reroll 1 attack die. |
| Cassian Andor | Strike Team | After deployment, you and an adjacent friendly figure gain 2 movement points. Then, up to 4 friendly figures outside of your deployment zone each gain |
| Cassian Andor | It Will be Alright | Once during your activation, you may choose another friendly figure within 2 spaces that can be defeated. That figure is defeated, then perform a move |
| Chirrut Imwe | Devout | You may use Rebel FORCE USER Command cards. |
| Chirrut Imwe | The Force is With Me | When a Ranged attack targeting you is declared, choose an adjacent hostile figure. If you do, apply -1 Hit to the attack results and the chosen figure |
| Clawdite Shapeshifter (Elite) | Shape | When you are deployed, you may gain 1 Form card of your choice from the supply. |
| Clawdite Shapeshifter (Elite) | Shift | At the start of each round, you may switch your Form card with 1 other Form card of your choice. |
| Clawdite Shapeshifter (Regular) | Shape | When you are deployed, you may gain 1 Form card of your choice from the supply. |
| Clawdite Shapeshifter (Regular) | Shift | At the start of each round, you may switch your Form card with 1 other Form card of your choice. |
| Dark Trooper Mk III | Advanced Targeting Computer | When you declare an attack, you become Focused. During this attack, you may reroll 1 attack die. If the rerolled die has fewer Hit symbols than before |
| Dark Trooper Mk III | Durasteel Fist | Once during your activation, you may choose 1 adjacent figure or object and roll 1 green die. It suffers Damage equal to the Hit results. Then, if you |
| Davith Elso | Cut and Run | When you exit a space containing a hostile figure, that figure suffers 1 Damage. Limit once per figure per round. |
| Death Trooper (Elite) | Field Tactics | After your activation, you may immediately activate a friendly TROOPER or LEADER group with cost 6 or less. That group loses "Field Tactics" this roun |
| Death Trooper (Regular) | Field Tactics | After your activation, you may immediately activate a friendly TROOPER or LEADER group with cost 6 or less. That group loses "Field Tactics" this roun |
| Director Krennic | Unhinged Director | When a friendly TROOPER or GUARDIAN within 2 spaces spends a Hit Token or Surge Token while declaring an attack, it may suffer 1 Strain to apply +2 of |
| Doctor Aphra | Dubious Counterparts | If your army's affiliation is Scum, you may include "0-0-0" and "BT-1" in your army together. After a friendly DROID resolves "Invasive Procedure" or  |
| Doctor Aphra | Excavation | At the start of each round, you may choose 1 Command card in any discard pile that costs 1 or less, except "Take Initiative". Once during this round,  |
| E-Web Engineer (Elite) | Tripod | During your activation, you cannot voluntarily exit your space if you attack, and you cannot attack if you exit your space. |
| E-Web Engineer (Regular) | Tripod | During your activation, you cannot voluntarily exit your space if you attack, and you cannot attack if you exit your space. |
| Ewok Warrior (Elite) | Special: Sling Barrage | Perform a Ranged attack using your printed attack pool. During this attack, you may reroll up to 1 attack die for each other figure in your group with |
| Ezra Bridger | Brush | At the start of each round, move up to 4 spaces. |
| Gar Saxon | Airborne Commander | Friendly Mobile figures within 4 spaces can use your surge abilities. |
| Gar Saxon | Personal Combat Shield | Whenever you spend a Block while defending, apply +1 Evade to the defense results. |
| General Sorin | Advanced Firepower | Adjacent friendly DROIDS and VEHICLES can use your surge abilities. |
| General Weiss | General's Orders | At the start of your activation choose up to 2 other friendly figures on the map. Those figures may each interrupt to perform a move. |
| Greedo | Slow on the Draw | When you declare an attack, the defender may interrupt to perform an attack targeting you. |
| Greedo | Parting Shot | When you have suffered Damage equal to your Health, before you are defeated, you may interrupt to perform an attack. Then, you are defeated. |
| Heavy Stormtrooper (Elite) | Modular | You may include an attachment card in your army and decrease its cost by 1, to a minimum of 0. During setup, you must attach that card to this group. |
| Heavy Stormtrooper (Elite) | Spray Fire | While attacking, you may apply -3 Accuracy and +1 Surge to the attack results. |
| Hera Syndulla | Call the Shots | While another friendly figure within 3 spaces is attacking, you may apply +2 Accuracy, +1 Hit, or +1 Surge to the attack results. Limit once per round |
| Hired Gun (Elite) | Parting Shot | When you have suffered Damage equal to your Health, before you are defeated, you may interrupt to perform an attack. Then, you are defeated. |
| Hired Gun (Regular) | Parting Shot | When you have suffered Damage equal to your Health, before you are defeated, you may interrupt to perform an attack. Then, you are defeated. |
| HK Assassin Droid (Elite) | Versatile Weaponry | While attacking, you may force the defender to reroll 1 defense die. |
| Hondo Ohnaka | Negotiate | When you declare an attack, apply +2 Damage to the attack results unless the defender pays you 2 VPs. |
| Hondo Ohnaka | What's Yours is Mine | At the end of a round, if you are in an opponent's deployment zone, that opponent loses 2 VPs and you gain 2 VPs. Limit once per mission. |
| Imperial Officer (Regular) | Cower | While defending, while adjacent to a friendly figure, you may reroll 1 defense die. |
| ISB Infiltrator (Elite) | Comms Jammer | Your opponent cannot play Command cards during your activation. |
| Jabba the Hutt | Double Action Special (Order Hit) | Spend 2 VPs. An elite figure of your choice may interrupt to perform an attack. Then, it gains 2 movement points. |
| Jawa Scavenger (Elite) | Take Cover | While defending, you may apply +1 Block and -1 Evade to the defense results. |
| Jawa Scavenger (Elite) | Scavenged Stock | If your army's affiliation is Scum, you may include up to 3 DROID groups from any other affiliations in your army. |
| Jawa Scavenger (Regular) | Take Cover | While defending, you may apply +1 Block and -1 Evade to the defense results. |
| Jet Trooper (Elite) | Agile | While defending, you may convert 1 Block to 1 Evade |
| Jet Trooper (Regular) | Agile | While defending, you may convert 1 Block to 1 Evade. |
| Jyn Erso | Trust Goes Both Ways | At the start or end of your activation, choose an adjacent friendly figure. If you do, you and that figure Recover 1 Damage and gain 1 Surge Token. Li |
| K-2S0 | Vague and Unconvincing | While defending, your player and your opponent cannot spend power tokens or play Command cards. |
| K-2S0 | Cassian Said I Had To | Once per round, when a friendly LEADER enters an adjacent space, gain up to 1 Hit Token. |
| Kanan Jarrus | Force Vision | At the start of you activation, your opponent chooses one of their ready groups and must activate it next if possible. |
| Ko-Tun Feralo | Arms Distribution | At the beginning of your activation, distribute 2 Power Tokens among up to 2 friendly figures within 3 spaces. |
| Ko-Tun Feralo | Dead Precise | When a friendly figure within 3 spaces spends a Power Token while attacking, apply Pierce 1 and -1 Evade to the attack results. |
| Ko-Tun Feralo | Squad Cohesion | When a friendly REBEL figure within 3 spaces declares an attack, it may spend a tower token from a friendly REBEL figure within 3 spaces of itself for |
| Kuiil | Special: Hop On! | Choose a SMALL friendly figure with a figure cost of 8 or less. When you enter that figure's space during this activation, you may interrupt to push t |
| Lando Calrissian | Resourceful | While attacking or defending, you may reroll 1 of your attack or defense dice. |
| Lando Calrissian | Gambit | Before you reroll a die, you may replace it with another die of the same type. After rolling, the new die is considered rerolled. |
| Lando Calrissian | Shrewd Scoundrel | While attacking or defending, before you reroll a die with "Resourceful", you may guess aloud a number from 0-2. After rerolls, if the number of Hits  |
| Loku Kanoloa | Set Your Sights | At the start of the mission, place a Recon token on a unique hostile figure. While a friendly figure is attacking a figure with a Recon token, apply P |
| Loku Kanoloa | Mon Cala Special Forces | When you declare an attack targeting a figure with a Recon token, you become Focused. |
| Mak Eshka'rey | Camouflage | Hostile figures 4 or more spaces away cannot draw line of sight to you. You do not block line of sight for those figures. |
| Mara Jade | Adaptive Skills | Your affiliation matches your army's affiliation. You gain 1 of the following traits based on your army's affiliation: 
- IMPERIAL: HUNTER 
- SCUM: SM |
| Mara Jade | Fast Learner | Once per round, you may play a Command card whose restriction matches the name of another Deployment card in your army, except "Arcing Shot". |
| Mara Jade | Professional | While attacking, you may reroll 1 attack die. |
| MHD-19 | Special: Improper Procedure | Choose an adjacent hostile figure. That figure suffers 1 Damage and becomes Weakened. |
| Migs Mayfeld | Return Fire | After an attack targeting you is resolved, you can interrupt to perform an attack targeting that attacker. Limit once per round. |
| Obi-Wan Kenobi | Alter Mind | Hostile figures with a figure cost of 9 or less within 3 spaces of you cannot interact and are not counted for the purposes of control. |
| Obi-Wan Kenobi | Strike Me Down | When an attack targeting you is declared, you may reduce your figure cost by 3. If you do, you are then defeated. |
| Onar Koma | Get Down | While a small figure within 2 spaces is defending, you may apply +1 Block or +1 Evade to the defense results. Limit once per round. |
| Onar Koma | Immune | You cannot gain HARMFUL conditions. |
| Probe Droid (Regular) | Self-Destruct | At the end of a round, you may roll 1 red die. Each adjacent figure and object suffers Damage equal to the Hit results. Then, you are defeated. |
| Purge Commander (Elite) | Coordinated Hunt | While you or a friendly HUNTER in your line of sight is attacking, it may reroll 1 attack die. Limit one "Coordinated Hunt" per attack. |
| Purge Trooper (Elite) | Imperial Loadout | When you are deployed, gain 1 Loadout card from the supply. |
| R2-D2 | Special: Service | You or an adjacent friendly DROID or VEHICLE recovers 1 Damage. |
| R2-D2 | Lucky | While defending, if you roll a blank result, add +1 Dodge to the defense results. |
| Rancor | Trained | While attacking, you may suffer 1 Strain to reroll 1 attack die. |
| Rancor | Voracious | At the start of another figure's activation, you may defeat a friendly non-companion figure within 2 spaces to recover 2 Damage and ready your Deploym |
| Rebel Pathfinder (Elite) | Infiltration | After deployment, you may move up to 6 spaces. |
| Rebel Pathfinder (Elite) | Light It Up | While attacking, if the target of your attack did not have line of sight to you at the start of your activation, you may reroll up to 1 attack die. |
| Rebel Pathfinder (Elite) | Distracting Fire | After resolving an attack, if it did not miss, you may force the defender's group to activate next if able. Limit once per group per round. |
| Rebel Saboteur (Elite) | Overload | You can trigger the same Surge ability up to twice per attack. |
| Rebel Saboteur (Regular) | Overload | You can trigger the same Surge ability up to twice per attack. |
| Rebel Trooper (Elite) | Aim | If you have not exited your space during this activation, apply +1 Hit and +2 Accuracy to your attack results. |
| Rebel Trooper (Elite) | Double Action Special (Get into Position) | Gain 4 movement points and become Focused. |
| Rebel Trooper (Regular) | Aim | If you have not exited your space during this activation, apply +1 Hit and +2 Accuracy to your attack results. |
| Riot Trooper (Elite) | Professional | While attacking, you may reroll 1 attack die. |
| Royal Guard (Elite) | Professional | While attacking, you may reroll one attack die. |
| Saska Teft | Shady Contacts | You may include up to 1 non-upgrade SCUM Deployment card in your army. |
| Saska Teft | Unstable Devices | Once during your activation, a friendly figure in your line of sight may gain 1 Device token. |
| Saska Teft | Power Converter | Once per round, while a friendly figure with a Device token is attacking, it may reroll 1 attack die. Before rerolling, you may replace that die with  |
| Saw Gerrerra | Brutal Tactics | Once per round, when a hostile figure is defeated, choose a hostile figure within 3 spaces of the defeated figure's space. The chose figure becomes we |
| Saw Gerrerra | Wanton Destruction | After a friendly resolves an attack, you may discard 1 Command card from your hand to choose up to 2 figures other than the defender within 2 spaces o |
| SC2-M Repulsor Tank | Double Action Special (Focus Fire) | Perform 2 attacks targeting the same figure. |
| SC2-M Repulsor Tank | Defensible | While defending, you may apply either +1 Block or +1 Evade to your defense results. |
| Scout Trooper (Elite) | Camouflage | Hostile figures 4 or more spaces away from you cannot draw line of sight to you. You do not block line of sight for those figures. |
| Sentry Droid (Elite) | Special: Charged Shot | Perform an attack. Apply +2 Accuracy to the attack results. |
| Sentry Droid (Regular) | Special: Charged Shot | Perform an attack. Apply +2 Accuracy to the attack results. |
| Shoretrooper (Elite) | Squad Training | While attacking, while adjacent to another friendly TROOPER, you may reroll 1 attack die. |
| Snowtrooper (Elite) | Spiked Boots | You cannot be pushed out of your space except by MASSIVE figures. |
| Snowtrooper (Elite) | Immune | You cannot gain HARMFUL conditions. |
| Stormtrooper (Elite) | Squad Training | While adjacent to another friendly TROOPER, you may reroll 1 attack die. |
| Stormtrooper (Regular) | Squad Training | While attacking, while adjacent to another friendly TROOPER, you may reroll 1 attack die. |
| Super Commando (Elite) | Jetpack Rocket | Once per figure per round, you may spend 2 movement points to choose a hostile figure within 3 spaces and line of sight. Roll 1 blue die. That figure  |
| Super Commando (Elite) | Shield Gauntlets | Once during your activation, you may spend 1 movement point to gain 1 Block token. |
| Taron Malicos | Fallen Master | Friendly non-companion FORCE USER figures may ignore the IMPERIAL restriction when using Command cards. |
| The Armorer | Survival is Strength | While a friendly figure within 3 spaces is defending, if it spent a Block symbol during this attack, it may reroll 1 attack die. |
| The Grand Inquisitor | Precision | While attacking or defending against an adjacent figure, you may choose 1 die. The player that rolled that die must reroll it. |
| Thrawn | Long-Laid Plans | At the start of your activation, distribute among friendly figures different Power tokens equal to the current round number. |
| Thrawn | Strategize | At the start of your activation, look at the top Command card of each player's deck. You may discard one of those cards. |
| Tress Hacnua | Krayt Dragon Fury | While attacking, X equals the number of Surge rolled. |
| Tress Hacnua | Fyrnock Style | While attacking or defending, choose 1 attack die. The player that rolled that die must reroll that die. |
| Ugnaught Tinkerer (Elite) | Scrap Battalion | The Junk Droid readies at the start of your activation. It activates as though it was part of your group and may use your surge abilities. |
| Ugnaught Tinkerer (Regular) | Scrap Battalion | The Junk Droid readies at the start of your activation. It activates as though it was part of your group and may use your surge abilities. |
| Verena Talos | Improvised Cover | While defending, if you are adjacent to an object or non-friendly figure other than the attacker, apply +1 Block to the defense results. |
| Weequay Pirate (Elite) | Raider | While attacking, you may choose 1 die. The player that rolled that die must reroll that die. |
| Weequay Pirate (Regular) | Raider | While attacking, you may choose 1 die. The player that rolled that die must reroll that die. |
| Yoda | Calming Presence | At the start of a friendly REBEL figure's activation, that figure may remove one HARMFUL condition and suffer 1 Strain. Limit once per round. |
| Yoda | Wisdom | At the start of your activation, you may draw 1 Command card. If you do, place 1 card from your hand on the bottom of your deck. |
| Yoda | Force Deflection | After an attack targeting you or an adjacent friendly REBEL figure resolves, you may have the attacking figure suffer Damage equal to the number of at |
| Zuckuss | Shared Calculations | While attacking, if a friendly DROID within 3 spaces has line of sight to the target space, you may force the defender to reroll 1 defense die. |
