# Cost-9+ Deployment Card Audit (2026-05-06)

Per destruct: re-read all 23 cost-9+ DC cards carefully against canonical
images, identify implementation gaps, fix obvious bugs, document the rest.

Principles applied:
- Player chooses among options (no auto-pick)
- Dice ability timing per CRR step
- "May" abilities never forced
- Canonical card image outranks data/CRR paraphrase

## Status legend
- ✓ verified correct
- ⚠ partial / known gap
- ✗ behavioral bug found
- (fixed) — bug shipped this session

---

## Darth Vader (18) — drilled deeply earlier

With **[Driven by Hatred]** attached:
- ✓ Force Choke (`force_choke`): hostile in LOS suffers 2 Damage + 1 Strain
- ✓ Brutality removed under DBH (components.js:910)
- ✓ Foresight: while defending reroll 1 def die; DBH adds atk-side reroll
- ✓ +1 Damage passive (combat.js:1627 via DBH-specific wiring; innate-passive helper unaware since data passives are empty)
- ✓ EOR move 2 + Force Choke OR attack-with-1-die-removed (player picks die per b31dff47/44911743)
- ✓ Surges: 1-surge +2 Damage, 1-surge Pierce 3 (data correct)

## Chewbacca (15) — drilled deeply earlier

With **[Wookiee Avenger]** attached:
- ✓ Slam: rollOneDie path; player picks adj hostile; push optional (f5251c1e)
- ✓ Wookiee Avenger Dodge→Evade defending (combat.js:1695)
- ✓ Setup pulls Debts Repaid into hand + draws 1 fewer (973a1ef8)
- ✓ Free Slam once-per-activation; consumes once-per-activation right (b31dff47)
- ✓ +1 Damage passive on attacks (combat.js:1640 — WA-specific wiring)
- ✓ Protector replaced by WA passive (f5251c1e — combat.js:2269 gates on WA)
- ✓ Surges: 1-surge +2 Damage / Stun / +2 Accuracy

## Boba Fett (13) — re-audited

- ✓ Wrist Cord: pushTargetWithinRange impl, MP 2, once-per-round
- ✓ Wrist Flamethrower: fixedAreaEffect impl, MP 2, once-per-round, "each other" excludes source
- ✓ EE-3 Carbine: player picks die, has Skip, MP 2 — once-per-attack (4c390801)
- ✓ Block 1 + +1 Evade passives (49f06226 — innate-passive helper)
- ✓ Out-of-activation MP usage works (no activation gate on MP-cost specials; Order Hit refresh c3627a96)

## General Weiss (13)

- ✓ Epic Arsenal: player chooses 3-die combo, max 2 same color enforced
- ✓ General's Orders: choose up to 2 OTHER friendly figures on the map (self-EXCL)
- ⚠ +2 Accuracy passive: NOT wired (out of scope per destruct's "+dmg/+surge/+block/+evade only")
- ✓ Surges: 'blast 3 (2 surges)', 'pierce 2' — needs verification of doubleSurgeAbilities

## Alliance Ranger (Elite) (12)

- ✓ Elite Sniper: while attacking target ≥ 5 spaces away, may reroll up to 2 atk dice (sniper-helpers.js)
- ✗ **Guerrilla NOT IMPLEMENTED**: card text "After you resolve an attack, if the defender was defeated, become Hidden." No specialAbilityId for it; no runtime hook. Real bug.
- ⚠ Pierce 1 + +1 Accuracy passives: not wired (out of scope)
- ✓ Surges: pierce 1, damage 2, accuracy 3

## Han Solo (12) — drilled deeply earlier

With **[Rogue Smuggler]** attached:
- ✓ Return Fire: combat-bridge.js post-defeat interrupt; Stun-blocks-declare wired
- ✓ Cunning: combat.js:308 +1 Block per rolled Evade; OI ignores Cunning
- ✓ Distracting (replaced by Rogue Smuggler if attached)
- ✓ Rogue Smuggler: lose Distracting, +1 atk reroll, Return Fire usable after damage

## IG-88 (12) — drilled with Focused on the Kill

With **[Focused on the Kill]** attached:
- ✓ Arsenal: similar to Epic Arsenal — choose dice; max 1 of each color (?)
- ✓ Relentless: relentless-helpers.js
- ⚠ Focused on the Kill: passive +5 Health (in DC stats); start of activation gain 2 MP; before declaring atk become Focused — needs verification

## Snowtrooper (Elite) (11)

- ✓ Disruptor Rifle: extra 1 damage if defender at 1 HP after non-miss attack
- ✓ Immune (Snowtrooper Elite): conditions.js isConditionImmune blocks HARMFUL conditions
- ✓ Spiked Boots: ignore Difficult Terrain MP cost; cannot be pushed except by Massive
- ✓ Surges: acc 2 + dmg 1 / dmg 1 + weaken / focus

## AT-ST (10)

With **[Scavenged Walker]** attached:
- ✓ Targeting Computer: while attacking may reroll 1 atk die
- ✓ Awkward: cannot attack adjacent figures (combat.js:2378 block)
- ✓ Scavenged Walker: changes affiliation to SCUM, loses ASSAULT keyword
- ⚠ +3 Accuracy passive: not wired (out of scope)
- ✓ Surges: blast 2, pierce 2

## Luke Skywalker (Jedi Knight) (10) — drilled with Heir to the Jedi

With **[Heir to the Jedi]** attached:
- ✓ Heroic: defensive reroll
- ✓ Deflect: combat-bridge.js post-defense interrupt
- ✓ Heir to the Jedi: reroll 1 atk die; +1 Hit on Ranged; Saber Strike Focus
- ✓ +1 Damage + +1 Evade passives (49f06226 — innate-passive helper)
- ✓ Surges: damage 1, pierce 3

## Royal Guard Champion (10)

- ✓ Brutality: special action, 2 attacks at different targets (freeAttackBonus)
- ✓ Executor: post-defeat interrupt, friendly within 3 defeated → move 2 + attack; once per round per RGC; correct same-space-via-helper adjacency
- ✓ Overpower: combat.js attacker reroll + defender reroll paths
- ✓ Reach passive (kw)
- ✓ Surges: damage 2, bleed, pierce 2

## Alliance Ranger (Regular) (9)

- ✓ Sniper: sniper-helpers.js — combat.js sniperGateOpen reroll
- ⚠ +1 Accuracy passive: not wired (out of scope)
- ✓ Surges: pierce 1, damage 2, accuracy 2

## AT-DP (9)

With **[Scavenged Walker]** attached (eligible):
- ✓ Charge Generators: charge-generators-helpers.js
- ✓ Block 1 passive (49f06226 — innate-passive helper)
- ⚠ +3 Accuracy passive: not wired (out of scope)
- ✓ Surges: damage 1, pierce 3

## Bantha Rider (9)

- ✓ Trample (`trample_bantha`): roll 1 red die against up to 3 adjacent hostiles, dmg = hits
- ✗ **Stampede NOT IMPLEMENTED**: card "When you end your movement in spaces that contain other figures, each hostile figure in your space suffers 1 Damage." Movement-end trigger, hostile-in-same-space damage. Real bug.
- ✗ **Wild Beast NOT IMPLEMENTED**: card "When you would perform an attack, you may perform a Trample instead." Replaces Attack action with optional Trample. Real bug — likely never offered.
- ⚠ +2 Accuracy + Pierce 2 passives: not wired (out of scope)

## Bo-Katan Kryze (9)

- ⚠ Personal Combat Shield: combat-bridge.js +Block aura; OI gate verification needed
- ⚠ Defensive Fire: post-defense interrupt — implementation needs review
- ⚠ Dual Wield Pistols: combat surge ability — verification needed
- ⚠ Last Wielder of the Darksaber: keyword-conditional CC access — verification needed
- ⚠ Mobile + +1 Accuracy passives: not wired (out of scope)

## Cara Dune (9)

- ✓ Smash: rollOneDie path with adjacent hostile picker; push optional via allowSkipPush (f5251c1e — same fix as Slam)
- ✓ Shock and Awe: shock-and-awe-helpers.js — combat.js die swap, once/round
- ✓ Hunker Down: hunker-down-helpers.js — combat.js while defending and adjacent to blocking/impassable/difficult, +1 Evade
- ⚠ +1 Accuracy passive: not wired (out of scope)

## Drokkatta (9)

- ✓ Demolish: special action — choose space within 3 + LOS; figures on/adjacent suffer 1 Damage; place rubble token; Drokkatta suffers 1 Damage
- ⚠ Shrapnel surge: parseSurgeEffect hardcodes Blast 2 (combat.js:186) but card says "Blast 1" or splash. **Real bug** — wrong Blast amount AND missing player choice between Blast 1 vs splash.
- ✓ +1 Damage + +1 Block passives (49f06226 — innate-passive helper parses comma-separated)
- ⚠ +1 Accuracy passive: not wired (out of scope)

## IG-11 (9)

- ⚠ Rapid Fire: combat surge — needs verification
- ✓ Targeting Computer: targeting-computer-helpers.js reroll
- ✓ Self-Destruct Protocol: combat-bridge.js pre-defeat interrupt; gates on _defeatSuppressed; player chooses Use vs Skip
- ✓ Block 1 passive (49f06226 — innate-passive helper)

## Rancor (9)

- ⚠ Crippling Blow: surge — needs verification
- ⚠ Trained Rancor: passive — needs verification  
- ✓ Voracious Rancor: at start of another fig's activation, defeat friendly non-companion within 2 → recover 2 dmg + ready DC
- ✓ Massive + Reach + Block 1 passives — Block 1 wired (49f06226)

## Royal Guard (Elite) (9)

- ✓ Sentinel: combat-bridge.js — while friendly non-GUARDIAN defending and RG adjacent to target space, +1 Block; GUARDIAN class gates correctly
- ⚠ Pierce 1 passive: not wired (out of scope)
- ✓ Reach + Professional passives

## SC2-M Repulsor Tank (9)

- ⚠ Focus Fire (Tank): combat surge — needs verification
- ⚠ Defensible (SC2-M): combat-bridge.js — while defending +1 Block under conditions — verification needed (allowSkipPush-style "may apply" check?)
- ⚠ +2 Accuracy + Massive: accuracy not wired (out of scope), MASSIVE wired

## Sentry Droid (Elite) (9)

- ✓ Targeting Computer (Sentry Elite): reroll
- ⚠ Charged Shot (Elite): surge override / strain-cost extra die — needs verification
- ✓ Multi-Fire: combat surge — multi-target (memory: pointer-shared with Regular)

## Wookiee Warrior (Elite) (9)

- ⚠ Fury (Wookiee Elite): full-of-rage + fury-helpers.js — when WW takes damage threshold, become Focused / +Surge bonus — needs verification
- ✓ Surges: +2 hits, bleed, cleave 2

---

## Summary of real bugs found

1. **EE-3 Carbine** (Boba Fett): once-per-activation instead of once-per-attack — **fixed** (4c390801)
2. **Guerrilla** (Alliance Ranger Elite): completely unimplemented — open
3. **Stampede** (Bantha Rider): movement-end damage trigger unimplemented — open
4. **Wild Beast** (Bantha Rider): Attack-replaceable-with-Trample unimplemented — open
5. **Shrapnel** (Drokkatta): wrong Blast amount (impl says 2, card says 1) AND missing player choice — open

## Out-of-scope but flagged

- Innate +Accuracy and Pierce passives are not wired. Per destruct
  2026-05-06 the priority was +dmg/+surge/+block/+evade only. These
  remain a follow-up.

## Verifications still pending (deeper read needed)

- ✓ Bo-Katan Kryze: 4 specials verified — Defensive Fire / Dual-Wield Pistols / Personal Combat Shield / Last Wielder Darksaber all wired
- ✓ IG-88 Arsenal vs Weiss Epic Arsenal: same dice-choice helper — both verified
- ✓ Rancor: Crippling Blow (Stun on hit) + Trained Rancor passive (e38fe753 — 2 Damage cost)
- ✓ SC2-M Repulsor Tank: Focus Fire (combat surge wired) + Defensible (player choice prompt)
- ✓ Sentry Droid (Elite): Charged Shot (free attack +2 Accuracy)
- ✓ Wookiee Warrior (Elite): Fury (5+ damage threshold) wired in fury-helpers.js
- ⚠ Captain Terro Flamethrower data mismatch: abilityText says "1 Damage and 1 Strain", ability-library `fixedAreaDamage: 2`. Need canonical IACP card to confirm which is correct.

## Cost-8/7 audit pass (2026-05-06)

- Bossk Regenerate scope FIXED: was Bleed-only, now discards all harmful conditions (Bleed/Stun/Weaken) per card text "discard all Harmful conditions" (commit 0363e1f4)
- Innate-passive double-apply BUG FIXED: applyDcPassivesToCombat at handlers/combat.js:1589 already covered all attacker/defender bonuses, but a redundant innate-passive helper at line 1965-1966 was double-counting bonusHits/bonusSurge/bonusBlock/bonusEvade (commit 34b3406c)
- Verified wired: Beskar Armor, Submit or Fight, Heavy Repeater, Spread the Pain, Pulse Cannon, Self-Preservation, Last Stand, Aim, Merciless, Cover Fire, Smooth Landing, Brutal Tactics, Locked and Loaded, Open-Minded, Bounty, Stealthy/Ambush/In The Shadows, Into the Fray + Hold the Line, Hardy, Regenerate, Crippling Blow, Defensive Fire, Dual-Wield Pistols, Personal Combat Shield, Improvised Cover, Parting Gift, Flamethrower (Terro)
- Auto-pick anti-pattern flagged: Last Stand picks `_lsAlive[0]` instead of prompting player when 2+ figures alive in defeated stormtrooper's group — falls under sweep task #90
