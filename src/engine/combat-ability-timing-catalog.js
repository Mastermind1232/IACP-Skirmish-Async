// Combat ability TIMING CATALOG — slice C (alexanbv 2026-06-14:
// "each ability in the registry should have a timing indicator as to where it
// affects combat — make sure this is complete").
//
// This file gives EVERY combat ability/CC/attachment/surge-effect a timing
// indicator (which window it triggers in: on_declare → rerolls → mods →
// special → after_resolve) + side + passive/interactive kind. Entries here are
// "timing-only" (no `applies`): they tag the timing comprehensively but their
// live detection/resolution for not-yet-wired windows is added as each window
// is hooked into combat. The `mods` window's executable entries (with real
// `applies`) live in combat-abilities-mods.js and are NOT duplicated here.
//
// Sourced from a full code walk of the live combat pipeline (handleAttackTarget
// declaration block, reroll setup, proceedAfterRerolls/sendModsYn, _enterStep4,
// after-attack-fire/resolve, combat-special-effects) + combat-order-validator.
//
// Importing this module self-registers the catalog.

import { registerCombatAbility } from './combat-timing-registry.js';

// Compact entry helper: e(id, name, side, kind, windows, detect, special?)
function e(id, name, side, kind, windows, detect, special) {
  registerCombatAbility({ id, name, side, kind, windows, detect, special });
}
const ON = ['on_declare'];
const RR = ['rerolls'];
const SP = ['special'];
const ZL = ['zillo'];
const AR = ['after_resolve'];

// ── ON_DECLARE (CRR step 1+2) ────────────────────────────────────────────────
// Attacker
e('focus_condition', 'Focus', 'attacker', 'passive', ON, 'attacker has Focus → +1 green die');
e('utinni', 'Utinni!', 'attacker', 'passive', ON, 'roundUtinniJawaBuffs + Jawa → +1 Acc + VP surge');
e('merciless', 'Merciless (HK Assassin Droid Elite)', 'attacker', 'interactive', ON, 'defender has harmful cond → use prompt');
e('knowledge_and_defense_redraw', 'Knowledge and Defense (redraw surge)', 'attacker', 'interactive', ON, 'KD in discard + FORCE USER');
e('targeting_network_redraw', 'Targeting Network (redraw surge)', 'attacker', 'interactive', ON, 'TN in discard + DROID');
e('imperial_loadout', 'Imperial Loadout (Purge Trooper Elite)', 'attacker', 'passive', ON, 'config loadout → inject surges');
e('clawdite_form', 'Clawdite Form', 'attacker', 'passive', ON, 'config form → surges/passives');
e('covering_fire', 'Covering Fire', 'attacker', 'passive', ON, 'roundTrooperSurgeStun + TROOPER → +stun surge');
e('forward_mounted_blasters', 'Forward Mounted Blasters (74-Z)', 'attacker', 'interactive', ON, 'reroll-or-(-1 Dmg)');
e('targeting_computer_attachment', 'Targeting Computer (attachment)', 'attacker', 'passive', ON, 'atk upgrade → +1 atk reroll');
e('driven_by_hatred_attachment', 'Driven by Hatred (attachment)', 'attacker', 'passive', ON, 'atk upgrade → +1 Hit, +1 reroll');
e('heir_to_the_jedi', 'Heir to the Jedi (attachment)', 'attacker', 'passive', ON, 'atk upgrade → +1 reroll/+Hit');
e('prey_on_the_weak', 'Prey on the Weak (attachment)', 'attacker', 'passive', ON, 'atk cost > def cost → Pierce 1 + Acc 1');
e('explosive_armaments', 'Explosive Armaments (attachment)', 'attacker', 'passive', ON, '+blast surge; exhaust → Blast 1');
e('feeding_frenzy', 'Feeding Frenzy (attachment)', 'attacker', 'passive', ON, 'dist≤1 → recover surge');
e('focused_on_the_kill', 'Focused on the Kill (IG-88)', 'attacker', 'passive', ON, 'swap recover→pierce surge + auto-Focus');
e('scavenged_weaponry', 'Scavenged Weaponry (attachment)', 'attacker', 'passive', ON, 'exhaust → +1 Hit');
e('the_darksaber_declare', 'The Darksaber (attachment, declare)', 'attacker', 'passive', ON, 'exhaust → +1 reroll');
e('rotary_cannon_z6', 'Rotary Cannon (Z-6 Trooper)', 'attacker', 'passive', ON, 'atk upgrade → auto-Focus');
// 'the_generals_ranks' is now an EXECUTABLE mods passive (combat-abilities-mods.js,
// +1 Damage outside the owner's activation) — no timing-only catalog entry here so
// it isn't clobbered by the catalog import (registerCombatAbility is per-id).
e('fireproof_attacker', 'Fireproof (Flame Trooper, atk)', 'attacker', 'passive', ON, 'no Strain on self-damage');
e('autofire', 'Autofire', 'attacker', 'passive', ON, 'autofireActive → autofire_chain surge');
e('barrage_declare', 'Barrage (CT-1701, declare)', 'attacker', 'passive', ON, 'barrageDefenseBonus → mark barrageAttack');
e('fire_mission', 'Fire Mission', 'attacker', 'passive', ON, 'fireMissionActive → +Blast 1');
e('unhinged_director_krennic', 'Unhinged Director (Krennic)', 'attacker', 'interactive', ON, 'eligible spender → +2 token bonus');
e('fury_of_kashyyyk', 'Fury of Kashyyyk', 'attacker', 'passive', ON, 'elite WOOKIEE proximity → Pierce 1');
e('payback', 'Payback (Dengar)', 'attacker', 'passive', ON, 'paybackBonusSurge on counter → +Surge');
e('no_cheating', 'No Cheating (debuff)', 'attacker', 'passive', ON, 'roundDebuff → auto-remove atk dice');
e('fury', 'Fury (Wookiee Warriors)', 'attacker', 'passive', ON, '5+ dmg → +1 Surge');
e('relentless', 'Relentless', 'attacker', 'passive', ON, 'in range → applyStrain to target');
e('advanced_targeting_computer', 'Advanced Targeting Computer (Dark Trooper Mk III)', 'attacker', 'passive', ON, 'auto-Focus');
e('flawless_execution', 'Flawless Execution (Cad Bane)', 'attacker', 'interactive', ON, 'auto-Focus or die+token pickers');
// 'shock_and_awe' (Cara Dune) is now an EXECUTABLE on_declare INTERACTIVE
// (combat-abilities-ondeclare.js): a PLAYER CHOICE, once per round, to swap 1
// Yellow attack die for 1 Red. Per the per-id-clobber rule, NO timing-only
// catalog entry here so the catalog import doesn't overwrite the executable one
// (alexanbv 2026-06-18 FIX-1; the prior entry was a passive AI-default swap).
e('vanguard', 'Vanguard (AT-RT)', 'attacker', 'interactive', ON, 'pre-target swap + die-swap picker');
// 'shared_intuition' (4-LOM) is now an EXECUTABLE mods passive
// (combat-abilities-mods.js — +1 Damage when a friendly HUNTER ≤3 has LOS to the
// target space), gated on the reusable LOS aura primitive. No timing-only catalog
// entry here so the catalog import doesn't clobber the executable one
// (gate-rework 2026-06-18; the prior entry was an on_declare placeholder).
e('query_declare', 'Query (HK-47, declare flag)', 'attacker', 'interactive', ON, 'sets queryNeedsPrompt (resolves mods)');
e('front_line', 'Front Line (Echo Base Trooper)', 'attacker', 'interactive', ON, 'dist≤3 → +2 Acc + die swap');
e('sniper', 'Sniper / Elite Sniper (Alliance Ranger)', 'attacker', 'passive', ON, 'dist≥5 → +forced rerolls');
e('much_to_learn', 'Much to Learn (Ezra)', 'attacker', 'interactive', ON, 'friendly unique ≤3 → reroll/turn');
e('keep_the_peace_elite', 'Keep the Peace Elite (Wing Guard Elite)', 'attacker', 'passive', ON, 'adjacent → attacker suffers Strain');
e('keep_the_peace_reg', 'Keep the Peace Regular (Wing Guard)', 'attacker', 'interactive', ON, 'adjacent → strain-for-strain reminder');
e('bespin_security', 'Bespin Security (Wing Guard Elite)', 'attacker', 'passive', ON, 'adjacent source + LEADER → +1 reroll');
e('airborne_commander', 'Airborne Commander (Gar Saxon)', 'attacker', 'passive', ON, 'friendly ≤4 + MOBILE → share surges');
e('advanced_firepower', 'Advanced Firepower (General Sorin)', 'attacker', 'passive', ON, 'friendly in range + DROID/VEHICLE → share surges');
e('awkward', 'Awkward (AT-ST)', 'attacker', 'passive', ON, 'adjacent target → cancels attack');
e('tripod', 'Tripod (E-Web)', 'attacker', 'passive', ON, 'moved this activation → cancels attack');
e('dead_precise_kotun', 'Dead Precise (Ko-Tun Feralo)', 'attacker', 'passive', ON, 'spent token + Ko-Tun ≤3 → +reroll, -Dodge');
e('override_dice', 'Attack dice override (Saber Strike/Bo-Rifle/etc.)', 'attacker', 'passive', ON, 'pendingOverrideAttackDice');
e('attack_type_override', 'Attack-type override (Overheated)', 'attacker', 'passive', ON, 'attackTypeOverride');
e('close_quarters', 'Close Quarters', 'attacker', 'passive', ON, 'adopt adjacent pool +1 Acc -1 def die');
e('optimal_bombardment', 'Optimal Bombardment', 'attacker', 'passive', ON, '+Blast');
// 'set_your_sights' is now an EXECUTABLE mods passive (combat-abilities-mods.js,
// +1 Pierce when the target carries a Recon token) — no timing-only catalog entry
// here so it isn't clobbered by the catalog import (per-id last-write).
e('mon_cala_special_forces', 'Mon Cala Special Forces (Loku)', 'attacker', 'passive', ON, 'recon target → Loku Focus');
e('ee3_carbine', 'EE-3 Carbine (Boba Fett)', 'attacker', 'interactive', ON, 'MP≥2 → die-swap picker');
e('element_of_surprise', 'Element of Surprise (CC)', 'attacker', 'interactive', ON, 'pool-mod -1 def die');
e('tools_for_the_job', 'Tools for the Job (CC)', 'attacker', 'interactive', ON, 'pool-mod +1 atk die');
e('concentrated_fire', 'Concentrated Fire (CC)', 'attacker', 'interactive', ON, '+1 red die on TROOPER declare');
e('on_declare_tokens_atk', 'On-declare power tokens / Squad Cohesion (atk)', 'attacker', 'interactive', ON, 'token spend window');
// Defender (on_declare)
e('combat_suit', 'Combat Suit (attachment)', 'defender', 'passive', ON, 'reduce Pierce by 1');
e('wookiee_avenger_defend', 'Wookiee Avenger (defend)', 'defender', 'passive', ON, 'Dodge→Evade conversion');
e('cross_training_declare', 'Cross Training (attachment, declare)', 'defender', 'interactive', ON, 'def upgrade → reroll available');
e('rogue_smuggler_defend', 'Rogue Smuggler (lose Distracting)', 'defender', 'passive', ON, 'def upgrade → cancel Distracting');
e('fireproof_defender', 'Fireproof (Flame Trooper, def)', 'defender', 'passive', ON, 'defenderFireproof');
// 'hunker_down' is now an EXECUTABLE mods passive (combat-abilities-mods.js, +1
// Evade when adjacent to blocking/impassable/difficult terrain) — no timing-only
// catalog entry so it isn't clobbered by the catalog import (per-id last-write).
e('on_a_diplomatic_mission', 'On a Diplomatic Mission', 'defender', 'passive', ON, 'diplomaticMissionEvade → +1 Evade');
e('slippery_declare', 'Slippery (Alliance Smuggler, declare)', 'defender', 'passive', ON, '-2 Accuracy');
// 'sentinel' + 'protector' are now EXECUTABLE mods passives (combat-abilities-mods.js,
// +1 Block when an owner is adjacent to the targeted space) — no timing-only catalog
// entries here so they aren't clobbered by the catalog import.
// 'improvised_cover_verena' is likewise now an EXECUTABLE mods passive (+1 Block
// when adjacent to an object or non-friendly figure) — no timing-only entry here.
e('inside_job', 'Inside Job (Hoth Battle Station A)', 'defender', 'passive', ON, 'mission zone → +Block/+Evade');
e('the_force_is_with_me', 'The Force is With Me (Chirrut)', 'defender', 'interactive', ON, 'Ranged + adjacent hostiles → -1 Dmg picker');
e('strike_me_down', 'Strike Me Down (Obi-Wan)', 'defender', 'interactive', ON, 'yes/decline self-defeat');
e('force_exhaustion', 'Force Exhaustion (The Child)', 'defender', 'interactive', ON, 'yes/decline incapacitate Child');
e('on_the_lam', 'On the Lam (CC)', 'defender', 'interactive', ON, 'when attack targeting you declared');
e('camouflage', 'Camouflage (CC)', 'defender', 'interactive', ON, 'becomes Hidden');
e('get_behind_me', 'Get Behind Me! (CC)', 'defender', 'interactive', ON, 'target redirect');
e('iron_will', 'Iron Will (CC)', 'defender', 'interactive', ON, 'damage cap (enforced step 7)');
e('brace_for_impact', 'Brace for Impact (CC)', 'defender', 'interactive', ON, 'pool-mod +1 black die');
e('knowledge_and_defense', 'Knowledge and Defense (CC)', 'defender', 'interactive', ON, 'pool-mod +1 black die');
e('slow_on_the_draw', 'Slow on the Draw (Greedo)', 'defender', 'interactive', ON, 'attacker is Greedo → defender interrupt');
// 'vague_and_unconvincing' is now an EXECUTABLE mods passive (combat-abilities-mods.js,
// reports the K-2SO lock-out; enforcement is the derived token/CC denial in
// combat-abilities-tokens.js + cc-timing.js) — no timing-only catalog entry here.
e('on_declare_tokens_def', 'On-declare power tokens / Squad Cohesion (def)', 'defender', 'interactive', ON, 'token spend window');

// ── REROLLS (CRR step 3) ─────────────────────────────────────────────────────
e('targeting_computer', 'Targeting Computer (figure)', 'attacker', 'interactive', RR, 'hasTargetingComputerAbility');
e('overpower_atk', 'Overpower (red die)', 'attacker', 'interactive', RR, 'Royal Guard Champion');
e('overpower_def', 'Overpower (black die)', 'defender', 'interactive', RR, 'hasOverpowerAbility(def)');
e('foresight', 'Foresight (Vader)', 'defender', 'interactive', RR, 'hasForesightAbility');
e('defensive_stance_reroll', 'Defensive Stance (reroll grant, Diala)', 'defender', 'interactive', RR, 'hasDefensiveStanceAbility');
// 'charge_generators' (AT-DP) is now an EXECUTABLE mods interactive
// (combat-abilities-mods.js: +1 Damage gated on suffered<9, plus an optional
// attack-die reroll — both halves of its single attack:modifiers CSV row). Per
// the same per-id-clobber rule as 'the_generals_ranks' above, NO timing-only
// catalog entry here so the catalog import doesn't overwrite the executable one
// (alexanbv 2026-06-18 FIX-3; the prior RR entry mis-binned it to rerolls).
e('inspiring', 'Inspiring (Luke)', 'attacker', 'interactive', RR, 'friendly Inspiring within 3');
e('soresu_form_reroll', 'Soresu Form (reroll grant, Kanan)', 'defender', 'interactive', RR, 'friendly soresu within 3');
e('cower', 'Cower (C-3PO / Imperial Officer)', 'defender', 'interactive', RR, 'adjacent friendly');
e('squad_training', 'Squad Training', 'attacker', 'interactive', RR, 'adjacent friendly TROOPER');
e('coordinated_hunt', 'Coordinated Hunt (Purge Commander)', 'attacker', 'interactive', RR, 'HUNTER + Purge Commander LOS');
e('light_it_up', 'Light It Up (Rebel Pathfinder)', 'attacker', 'interactive', RR, 'no LOS at activation start');
e('sling_barrage', 'Sling Barrage', 'attacker', 'interactive', RR, 'pendingSlingBarrage');
e('versatile_weaponry', 'Versatile Weaponry (HK Elite)', 'attacker', 'interactive', RR, 'forces def die');
e('shared_calculations', 'Shared Calculations (Zuckuss)', 'attacker', 'interactive', RR, 'friendly DROID ≤3 + LOS');
e('raider', 'Raider (Weequay)', 'attacker', 'interactive', RR, 'reroll any 1 die');
e('precision_grand_inquisitor', 'Precision (Grand Inquisitor)', 'either', 'interactive', RR, 'attacker adjacent defender');
e('fyrnock_style', 'Fyrnock Style (Tress Hacnua)', 'either', 'interactive', RR, 'forces 1 atk die');
e('survival_is_strength', 'Survival is Strength (Armorer)', 'defender', 'interactive', RR, 'defenderSpentBlock + Armorer ≤3, per-attack');
e('trusted_ally', 'Trusted Ally (attachment)', 'attacker', 'interactive', RR, 'friendly DROID ≤3, non-exhausted');
e('the_darksaber_reroll', 'The Darksaber (reroll, attachment)', 'attacker', 'interactive', RR, 'non-exhausted SU');
e('self_augmentation', 'Self-Augmentation (attachment)', 'attacker', 'interactive', RR, 'selfAugmentationMsgId');
e('doubt', '[Doubt] (SU)', 'defender', 'interactive', RR, 'forces 1 atk die, lazy-deplete');
e('guardian_stance', 'Guardian Stance', 'defender', 'interactive', RR, 'defenderRerollDiceMax > 0 (CC grant)');
e('round_cc_reroll', 'Round CC Reroll', 'attacker', 'interactive', RR, 'activeRoundModifiers rerollAttackDice (per-figure)');
e('innate_attack_reroll', 'Innate Attack Reroll (card text)', 'attacker', 'interactive', RR, 'getInnateRerollAbilities atk');
e('innate_defense_reroll', 'Innate Defense Reroll (card text)', 'defender', 'interactive', RR, 'getInnateRerollAbilities def');
e('twin_sabers', 'Twin Sabers (Ahsoka)', 'attacker', 'interactive', RR, 'reroll all atk / force all def');
e('resourceful', 'Resourceful (Lando)', 'either', 'interactive', RR, 'reroll 1 die');
e('gambit', 'Gambit (Lando)', 'either', 'interactive', RR, 'pre-reroll color swap on Resourceful');
e('shrewd_scoundrel', 'Shrewd Scoundrel (Lando)', 'either', 'interactive', RR, 'guess hits, double if correct');
e('trained_rancor', 'Trained (Rancor)', 'attacker', 'interactive', RR, 'suffer Strain to reroll');
e('power_converter_saska', 'Power Converter (Saska)', 'attacker', 'interactive', RR, 'Device token, once/round');
e('cross_training_reroll', 'Cross Training (reroll, attachment)', 'defender', 'interactive', RR, 'non-exhausted SU, color swap');
e('targeting_network', 'Targeting Network (CC)', 'attacker', 'interactive', RR, 'reroll 1 atk die');
e('there_is_no_try', 'There Is No Try (CC)', 'either', 'interactive', RR, 'REBEL FORCE USER → set die face');
e('demoralizing_monologue', 'Demoralizing Monologue (CC)', 'attacker', 'interactive', RR, 'forces def die');
// Rapid Recalibration fires as the LAST thing in the ATTACKER reroll stage —
// before the defender rerolls (alexanbv 2026-06-16: "Rapid recal happens as the
// last thing in the attacker reroll stage. It is different than zeb, which
// happens after ALL rerolls"). So it lives in the rerolls window, not special.
e('rapid_recalibration', 'Rapid Recalibration (CC)', 'attacker', 'interactive', RR, 'last thing in attacker reroll stage; set 1 atk die', 'rapid_recal');

// ── SPECIAL sub-windows (die-turns AFTER ALL rerolls — Zeb only) ──────────────
e('lasat_honor_guard', 'Lasat Honor Guard (Zeb Orrelios)', 'attacker', 'interactive', SP, 'after ALL rerolls, before mods; turn 1 single-symbol die', 'zeb');
e('zillo_technique_pierce_cancel', 'Zillo Technique (exhaust → cancel 2 Pierce)', 'defender', 'interactive', ZL, 'zillo step: between spend_surges and damage; finalized Pierce>0', 'zillo_exhaust');

// ── MODS (missing from combat-abilities-mods.js — timing-only until wired) ────
e('guidance_systems', 'Guidance Systems', 'attacker', 'interactive', ['mods'], 'sendModsYn prompt; -1 Hit/+2 Acc per use');
e('illicit_arms', 'Illicit Arms (Bib Fortuna)', 'attacker', 'interactive', ['mods'], 'sendModsYn; friendly eligible + CC hand');
e('zillo_technique_discard', 'Zillo Technique (discard CC → +1 Block)', 'defender', 'interactive', ['mods'], 'sendModsYn defender; [Zillo Technique] DC + CC hand');
e('assassinate', 'Assassinate (CC)', 'attacker', 'interactive', ['mods'], 'attackBonusHits +3, mutual-exclude');
e('positioning_advantage', 'Positioning Advantage (CC)', 'attacker', 'interactive', ['mods'], 'attackBonusHits +1');
e('overwhelming_impact', 'Overwhelming Impact (CC)', 'attacker', 'interactive', ['mods'], 'bonusDamagePerDefenseDie + ignore non-die def');
e('hunter_protocol', 'Hunter Protocol (CC)', 'attacker', 'interactive', ['mods'], 'declared step4, persists into surge double-trigger');
e('parry', 'Parry (CC)', 'defender', 'interactive', ['mods'], 'applyDefenseBonusBlock/Evade +1');
e('force_illusion', 'Force Illusion (CC)', 'defender', 'interactive', ['mods'], 'becomes Hidden, modifies results');
e('distracting', 'Distracting (Han / C-3PO)', 'defender', 'passive', ['mods'], 'friendly distracting adjacent to target → +1 Evade');
e('hidden_attacker_surge', 'Hidden (attacker, +1 Surge)', 'attacker', 'passive', ['mods'], 'attacker Hidden + not suppressed → +1 Surge');

// ── AFTER_RESOLVE (CRR step 8) ───────────────────────────────────────────────
// Attacker
e('recover', 'Recover N', 'attacker', 'passive', AR, 'surgeRecover > 0');
e('blast', 'Blast N', 'attacker', 'passive', AR, 'hit + damage>0 + blast → splash');
e('cleave', 'Cleave N', 'attacker', 'interactive', AR, 'hit + damage>0; target picker per source');
e('surge_condition', 'Surge condition (Bleed/Stun/Weaken/Focus/Hide)', 'either', 'interactive', AR, '_step8Conditions entries');
e('leg_hydraulics', 'Leg Hydraulics (Tress Hacnua)', 'attacker', 'interactive', AR, 'Move-1 picker');
e('vaders_finest_move', 'Vader\'s Finest (post-attack move)', 'attacker', 'interactive', AR, 'vadersFinestPostAttackMove');
e('stun_batons', 'Stun Batons (Riot Trooper)', 'attacker', 'passive', AR, 'hit + damage>0 → Strain');
e('stalk_prey', 'Stalk Prey (CC)', 'attacker', 'passive', AR, 'surgeStalkPrey + hit → +2 MP +1 dmg token');
e('burst_fire', 'Burst Fire (Imperial Loadout)', 'attacker', 'passive', AR, 'hit + damage>0 → Stun adjacent');
e('crippling_blow', 'Crippling Blow (Imperial Loadout)', 'attacker', 'passive', AR, 'hit → Stun defender');
e('disruptor_rifle', 'Disruptor Rifle (Imperial Loadout)', 'attacker', 'passive', AR, 'hit + target at 1 HP → defeat');
e('electro_pulse', 'Electro-pulse (Electrohammer)', 'attacker', 'passive', AR, '1 dmg within 1 of target');
e('quick_strike', 'Quick Strike (Electrostaff)', 'attacker', 'passive', AR, 'hit + defender rerolled/modified → 1 dmg');
e('tonfa_strike', 'Tonfa Strike (Imperial Loadout)', 'attacker', 'interactive', AR, 'chain attack');
e('barrage_chain', 'Barrage (CT-1701, chain)', 'attacker', 'interactive', AR, 'chain attack within 3');
e('flurry_of_blows', 'Flurry of Blows (Electrobaton)', 'attacker', 'interactive', AR, 'hit, once/round → chain attack');
e('fell_swoop', 'Fell Swoop (Davith Elso)', 'attacker', 'interactive', AR, 'surgeFellSwoop → Hide+Move+chain');
e('bladestorm', 'Bladestorm (CC)', 'attacker', 'passive', AR, 'postAttackAoeDamage + hit → AoE');
e('shrapnel_splash', 'Shrapnel Splash (Drokkatta)', 'attacker', 'passive', AR, 'surgeShrapnelSplash + hit');
e('sidewinder', 'Sidewinder (Jyn Odan)', 'attacker', 'interactive', AR, 'once/round → Strain + Move 2');
e('boltslinger', 'Boltslinger (Vinto Hreeda)', 'attacker', 'interactive', AR, 'target picker → 1 dmg');
e('indiscriminate_fire', 'Indiscriminate Fire (Bossk)', 'attacker', 'interactive', AR, 'hit → non-red die splash');
e('heavy_fire', 'Heavy Fire (Skirmish Upgrade)', 'attacker', 'interactive', AR, 'multi-target + opponent conditions');
e('havoc_shot', 'Havoc Shot (Fenn Signis)', 'attacker', 'interactive', AR, 'hit → Strain → pick 2 in LOS');
e('concussive_bolt', 'Concussive Bolt (4-LOM)', 'attacker', 'interactive', AR, 'surge + hit + 1x1 target → push');
e('fighting_knife', 'Fighting Knife (Verena Talos)', 'attacker', 'interactive', AR, 'surge + hit → roll 1 red die');
e('spread_the_pain', 'Spread the Pain (Dengar)', 'attacker', 'interactive', AR, 'hit → per-condition figure picks');
e('distracting_fire', 'Distracting Fire (Rebel Pathfinder Elite)', 'attacker', 'passive', AR, 'force defender group next activation');
e('wanton_destruction', 'Wanton Destruction (Saw Gerrera)', 'attacker', 'interactive', AR, 'discard CC → pick 2 within 2');
// Defender (after_resolve)
e('slippery_after', 'Slippery (after-attack MP)', 'defender', 'interactive', AR, 'gain 2 MP immediate-spend');
e('furious_charge', 'Furious Charge (CC)', 'defender', 'passive', AR, 'damage ≥ threshold → Focus');
e('force_deflection', 'Force Deflection (Yoda CC)', 'defender', 'passive', AR, 'attacker suffers dmg = atk dice (may defeat)');
e('deflect', 'Deflect (Luke JK)', 'defender', 'interactive', AR, 'Ranged → pick hostile in LOS → 1 dmg');
e('deflection', 'Deflection (CC)', 'defender', 'passive', AR, 'hit + pending → attacker suffers N dmg');
e('return_fire', 'Return Fire (Han / Migs)', 'defender', 'interactive', AR, 'chain attack on attacker (before attacker chains)');
// Defeat-boundary CCs (route through shared defeat pipeline)
e('final_stand', 'Final Stand (CC)', 'either', 'interactive', AR, 'before friendly defeated → nested attack (defeat-trigger)');
e('extra_protection', 'Extra Protection (CC)', 'either', 'interactive', AR, 'friendly ≤2 suffers 3+ → nested attack (defeat-trigger)');
e('debts_repaid', 'Debts Repaid (CC)', 'either', 'interactive', AR, 'when friendly defeated (defeat-trigger)');
