# Deterministic Ability Audit

**Code-generated** from `dc-effects.json` + `ability-library.json`. Run `node audit-stubs.cjs` to regenerate.
Generated: 2026-03-10

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

### 74-Z Speeder Bike (Elite)
| Ability | Status |
|---------|--------|
| Mounted | PASSIVE_DATA_ONLY |
| Thrusters | PASSIVE_DATA_ONLY |
| Forward Mounted Blasters | PASSIVE_DATA_ONLY |

### Agent Blaise
| Ability | Status |
|---------|--------|
| Adapt | WIRED |
| Surge: Interrogate | WIRED_SURGE |

### Agent Kallus
| Ability | Status |
|---------|--------|
| Hunt Dissent | WIRED |
| Fulcrum | NOT_WIRED |
| Bo-Rifle | NOT_WIRED |

### Ahsoka Tano
| Ability | Status |
|---------|--------|
| Special: Force Leap | WIRED |
| Vigor | WIRED |
| Twin Sabers | WIRED |

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
| Slippery | WIRED |

### Alliance Smuggler (Regular)
| Ability | Status |
|---------|--------|
| Special: Smuggler's Instincts | WIRED |
| Slippery | WIRED |

### Asajj Ventress
| Ability | Status |
|---------|--------|
| Nimble | WIRED |
| Consider It My Payment | WIRED |

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
| Targeting Computer | WIRED |
| Awkward | WIRED |

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
| Dirty Dealing | WIRED |
| Special: Bartered Information | WIRED |
| Illicit Arms | WIRED |

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
| Air Support | WIRED |

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
| Cower | WIRED |
| Distracting | WIRED |
| Non-Combatant | WIRED |

### C1-10P "Chopper"
| Ability | Status |
|---------|--------|
| Special: Ram | WIRED |
| Special: System Shock | WIRED |

### Cad Bane
| Ability | Status |
|---------|--------|
| Flawless Execution | WIRED |
| I Make the Rules Now | WIRED |

### Cal Kestis
| Ability | Status |
|---------|--------|
| Special: Wall Run | WIRED |
| Force Slow | WIRED |

### Captain Terro
| Ability | Status |
|---------|--------|
| Special: Flamethrower | WIRED |
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
| Strike Team | WIRED |
| It Will be Alright | WIRED |

### Chewbacca
| Ability | Status |
|---------|--------|
| Special: Slam | WIRED |
| Protector | WIRED |

### Chirrut Imwe
| Ability | Status |
|---------|--------|
| Devout | WIRED |
| I'm One With the Force | WIRED |
| The Force is With Me | WIRED |

### Clawdite Shapeshifter (Elite)
| Ability | Status |
|---------|--------|
| Shape | WIRED |
| Shift | WIRED |

### Clawdite Shapeshifter (Regular)
| Ability | Status |
|---------|--------|
| Shape | WIRED |
| Shift | WIRED |

### CT-1701
| Ability | Status |
|---------|--------|
| Special: Barrage | INFORMATIONAL |
| Cover Fire | WIRED |

### Dark Trooper Mk III
| Ability | Status |
|---------|--------|
| Advanced Targeting Computer | WIRED |
| Durasteel Fist | WIRED |
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
| Cut and Run | WIRED |
| Surge: Fell Swoop | WIRED_SURGE |

### Death Trooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Captain | WIRED |
| Field Tactics | WIRED |

### Death Trooper (Regular)
| Ability | Status |
|---------|--------|
| Security Detail | WIRED |
| Field Tactics | WIRED |

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
| Unhinged Director | WIRED |

### Doctor Aphra
| Ability | Status |
|---------|--------|
| Dubious Counterparts | WIRED |
| Excavation | WIRED |

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
| Tripod | WIRED |
| Assault | N/A_HONOR |

### E-Web Engineer (Regular)
| Ability | Status |
|---------|--------|
| Tripod | WIRED |
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
| Special: Sling Barrage | WIRED |

### Ezra Bridger
| Ability | Status |
|---------|--------|
| Brush | WIRED |
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
| Special: Sith Acolyte | WIRED |

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
| Airborne Commander | WIRED |
| Personal Combat Shield | WIRED |
| Special: Gar Saxon's Flamethrower | WIRED |

### General Sorin
| Ability | Status |
|---------|--------|
| Special: Bombardment | WIRED |
| Advanced Firepower | WIRED |

### General Weiss
| Ability | Status |
|---------|--------|
| General's Orders | WIRED |
| Epic Arsenal | WIRED |

### Gideon Argus
| Ability | Status |
|---------|--------|
| Special: Tactical Maneuver | WIRED |
| Special: On My Mark | WIRED |

### Greedo
| Ability | Status |
|---------|--------|
| Slow on the Draw | WIRED |
| Parting Shot | WIRED |

### Han Solo
| Ability | Status |
|---------|--------|
| Return Fire | WIRED |
| Distracting | WIRED |
| Cunning | WIRED |

### Heavy Stormtrooper (Elite)
| Ability | Status |
|---------|--------|
| Modular | WIRED |
| Spray Fire | WIRED |

### Heavy Stormtrooper (Regular)
| Ability | Status |
|---------|--------|
| Composite Plating | WIRED |

### Hera Syndulla
| Ability | Status |
|---------|--------|
| Call the Shots | WIRED |
| Smooth Landing | WIRED |

### Hired Gun (Elite)
| Ability | Status |
|---------|--------|
| Self-Preservation | WIRED |
| Parting Shot | WIRED |

### Hired Gun (Regular)
| Ability | Status |
|---------|--------|
| Parting Shot | WIRED |
| Disposable | WIRED |

### HK Assassin Droid (Elite)
| Ability | Status |
|---------|--------|
| Targeting Computer | WIRED |
| Versatile Weaponry | WIRED |
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
| Negotiate | WIRED |
| What's Yours is Mine | WIRED |

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
| Relentless | WIRED |
| Assault | N/A_HONOR |

### Imperial Officer (Elite)
| Ability | Status |
|---------|--------|
| Special: Executive Order | WIRED |

### Imperial Officer (Regular)
| Ability | Status |
|---------|--------|
| Special: Order | WIRED |
| Cower | WIRED |

### ISB Infiltrator (Elite)
| Ability | Status |
|---------|--------|
| In The Shadows | WIRED |
| Comms Jammer | WIRED |
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
| Special: Order Hit | WIRED |
| Nefarious Gains | WIRED |

### Jawa Scavenger (Elite)
| Ability | Status |
|---------|--------|
| Surge: Bargain | WIRED_SURGE |
| Take Cover | WIRED |
| Scavenged Stock | WIRED |

### Jawa Scavenger (Regular)
| Ability | Status |
|---------|--------|
| Surge: Harass | WIRED_SURGE |
| Take Cover | WIRED |

### Jet Trooper (Elite)
| Ability | Status |
|---------|--------|
| Agile | WIRED |
| Fly-By | WIRED |

### Jet Trooper (Regular)
| Ability | Status |
|---------|--------|
| Agile | WIRED |
| Jets | WIRED |

### Jyn Erso
| Ability | Status |
|---------|--------|
| Trust Goes Both Ways | WIRED |
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
| Vague and Unconvincing | WIRED |
| Cassian Said I Had To | NOT_WIRED |
| Special: Continually Unexpected | WIRED |

### Kanan Jarrus
| Ability | Status |
|---------|--------|
| Force Vision | WIRED |
| Soresu Form | WIRED |

### Kayn Somos
| Ability | Status |
|---------|--------|
| Special: Firing Squad | WIRED |
| Surge: Squad Command | WIRED_SURGE |

### Ko-Tun Feralo
| Ability | Status |
|---------|--------|
| Arms Distribution | WIRED |
| Dead Precise | WIRED |
| Squad Cohesion | WIRED |

### Krrsantan
| Ability | Status |
|---------|--------|
| Full of Rage | WIRED |
| Electrified Knuckledusters | WIRED |

### Kuiil
| Ability | Status |
|---------|--------|
| Mounted | WIRED |
| Special: Hop On! | WIRED |

### KX-Series Security Droid (Elite)
| Ability | Status |
|---------|--------|
| Special: Shoulder Rush | WIRED |
| Deference Protocol | WIRED |

### Lando Calrissian
| Ability | Status |
|---------|--------|
| Resourceful | WIRED |
| Gambit | WIRED |
| Shrewd Scoundrel | WIRED |

### Leia Organa
| Ability | Status |
|---------|--------|
| Special: Battlefield Leadership | WIRED |
| Military Efficiency (Surge) | NOT_WIRED |

### Loku Kanoloa
| Ability | Status |
|---------|--------|
| Set Your Sights | WIRED |
| Priority Target | WIRED |
| Mon Cala Special Forces | WIRED |

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
| Camouflage | WIRED |

### Mara Jade
| Ability | Status |
|---------|--------|
| Adaptive Skills | WIRED |
| Fast Learner | WIRED |
| Professional | PASSIVE_COMBAT |

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
| Special: Improper Procedure | WIRED |

### Migs Mayfeld
| Ability | Status |
|---------|--------|
| Locked and Loaded | WIRED |
| Return Fire | NOT_WIRED |

### Moff Gideon
| Ability | Status |
|---------|--------|
| I Know Everything | NOT_WIRED |
| You Have Something I Want | WIRED |

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
| Alter Mind | WIRED |
| Strike Me Down | WIRED |
| Into the Force | WIRED |

### Onar Koma
| Ability | Status |
|---------|--------|
| Special: Rush | WIRED |
| Get Down | WIRED |
| Immune | WIRED |

### Paz Vizsla
| Ability | Status |
|---------|--------|
| Heavy Repeater | NOT_WIRED |
| Submit or Fight | NOT_WIRED |

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
| Coordinated Hunt | WIRED |

### Purge Trooper (Elite)
| Ability | Status |
|---------|--------|
| Imperial Loadout | WIRED |
| Special: On the Hunt | WIRED |

### R2-D2
| Ability | Status |
|---------|--------|
| Special: Scomp Link | WIRED |
| Special: Service | WIRED |
| Lucky | WIRED |

### Rancor
| Ability | Status |
|---------|--------|
| Special: Crippling Blow | WIRED |
| Trained | WIRED |
| Voracious | WIRED |

### Rebel Pathfinder (Elite)
| Ability | Status |
|---------|--------|
| Infiltration | WIRED |
| Light It Up | WIRED |
| Distracting Fire | WIRED |

### Rebel Saboteur (Elite)
| Ability | Status |
|---------|--------|
| Overload | WIRED |
| Priority Target | WIRED |

### Rebel Saboteur (Regular)
| Ability | Status |
|---------|--------|
| Overload | WIRED |

### Rebel Trooper (Elite)
| Ability | Status |
|---------|--------|
| Aim | PASSIVE_DATA_ONLY |
| Special: Get into Position | WIRED |

### Rebel Trooper (Regular)
| Ability | Status |
|---------|--------|
| Aim | WIRED |

### Riot Trooper (Elite)
| Ability | Status |
|---------|--------|
| Stun Batons | WIRED |
| Shield | WIRED |
| Professional | PASSIVE_COMBAT |

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
| Professional | PASSIVE_COMBAT |

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
| Shady Contacts | WIRED |
| Unstable Devices | WIRED |
| Power Converter | WIRED |

### Saw Gerrera
| Ability | Status |
|---------|--------|
| Brutal Tactics | WIRED |
| Wanton Destruction | WIRED |

### SC2-M Repulsor Tank
| Ability | Status |
|---------|--------|
| Special: Focus Fire | INFORMATIONAL |
| Defensible | WIRED |

### Scout Trooper (Elite)
| Ability | Status |
|---------|--------|
| Camouflage | WIRED |
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
| Special: Charged Shot | WIRED |
| Targeting Computer | WIRED |

### Sentry Droid (Regular)
| Ability | Status |
|---------|--------|
| Special: Multi-Fire | INFORMATIONAL |
| Special: Charged Shot | WIRED |
| Targeting Computer | WIRED |

### Shoretrooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Training | WIRED |

### Shyla Varad
| Ability | Status |
|---------|--------|
| Special: Mandalorian Whip | WIRED |
| Responsive | WIRED |

### Snowtrooper (Elite)
| Ability | Status |
|---------|--------|
| Special: Disruptor Rifle | WIRED |
| Spiked Boots | WIRED |
| Immune | WIRED |

### Snowtrooper (Regular)
| Ability | Status |
|---------|--------|
| Special: Environmental Recovery Gear | WIRED |

### Stormtrooper (Elite)
| Ability | Status |
|---------|--------|
| Squad Training | WIRED |
| Last Stand | WIRED |

### Stormtrooper (Regular)
| Ability | Status |
|---------|--------|
| Squad Training | WIRED |

### Super Commando (Elite)
| Ability | Status |
|---------|--------|
| Jetpack Rocket | WIRED |
| Shield Gauntlets | WIRED |

### Taron Malicos
| Ability | Status |
|---------|--------|
| Fallen Master | WIRED |
| Madness | WIRED |
| Special: Boulder Barrage | WIRED |

### Tauntaun Rider
| Ability | Status |
|---------|--------|
| Mounted | PASSIVE_DATA_ONLY |
| Special: Headbutt | WIRED |
| Useful Hide | NOT_WIRED |

### The Armorer
| Ability | Status |
|---------|--------|
| Beskar Armor | WIRED |
| This is the Way | WIRED |
| Survival is Strength | WIRED |

### The Grand Inquisitor
| Ability | Status |
|---------|--------|
| Precision | WIRED |
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
| Long-Laid Plans | WIRED |
| Strategize | WIRED |

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
| Krayt Dragon Fury | WIRED |
| Fyrnock Style | WIRED |
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
| Scrap Battalion | WIRED |

### Ugnaught Tinkerer (Regular)
| Ability | Status |
|---------|--------|
| Special: Spot Weld | INFORMATIONAL |
| Scrap Battalion | WIRED |

### Verena Talos
| Ability | Status |
|---------|--------|
| Special: Close Quarters | WIRED |
| Surge: Fighting Knife | WIRED_SURGE |
| Improvised Cover | WIRED |

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
| Raider | WIRED |

### Weequay Pirate (Regular)
| Ability | Status |
|---------|--------|
| Raider | WIRED |

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
| Calming Presence | WIRED |
| Wisdom | WIRED |
| Special: Do or Do Not | WIRED |
| Force Deflection | WIRED |

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
| Shared Calculations | WIRED |

---

## Summary

**Total abilities:** 395

| Status | Count | % |
|--------|-------|---|
| WIRED | 340 | 86% |
| WIRED_SURGE | 16 | 4% |
| NOT_WIRED | 12 | 3% |
| INFORMATIONAL | 9 | 2% |
| PASSIVE_DATA_ONLY | 5 | 1% |
| N/A_HONOR | 5 | 1% |
| PASSIVE_COMBAT | 4 | 1% |
| N/A | 4 | 1% |

**Automated:** 360 (91%)
**Not wired:** 12 (3%)

---

## NOT_WIRED — Complete List

| Figure | Ability | Description |
|--------|---------|-------------|
| 4-LOM | Programming Override | At the start of each round, choose one TRAIT. You gain that TRAIT until the end of the round. |
| Agent Kallus | Fulcrum | At the start of your activation, you may have each player draw 1 Command card. |
| Agent Kallus | Bo-Rifle | Before you declare an attack, you may treat your attack type as Melee. If you do, replace 1 blue die with 1 red die. |
| Captain Terro | Professional | While attacking, you may reroll 1 attack die. |
| K-2S0 | Cassian Said I Had To | Once per round, when a friendly LEADER enters an adjacent space, gain up to 1 Hit Token. |
| Leia Organa | Military Efficiency (Surge) | After you resolve an attack, you may choose 1 Command card in your discard pile and shuffle it into your Command deck. |
| Migs Mayfeld | Return Fire | After an attack targeting you is resolved, you can interrupt to perform an attack targeting that attacker. Limit once per round. |
| Moff Gideon | I Know Everything | During setup, before drawing Command cards, search your opponent's Command deck and reveal 2 cards. Your opponent chooses 1 to shuffle back into the d |
| Paz Vizsla | Heavy Repeater | While performing a Ranged attack, you may suffer 1 Strain to apply +1 Hit, Blast 2, or +3 Accuracy to the attack results. |
| Paz Vizsla | Submit or Fight | When you would suffer Damage from Strain, you may return any number of Command cards from your discard pile to the game box to prevent that much Damag |
| Probe Droid (Regular) | Self-Destruct | At the end of a round, you may roll 1 red die. Each adjacent figure and object suffers Damage equal to the Hit results. Then, you are defeated. |
| Tauntaun Rider | Useful Hide | When this figure is defeated, distribute up to 2 Evade Tokens among friendly figures. |
