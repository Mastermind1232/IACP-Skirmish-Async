# Destruct's Testing Cases — Implementation Grades

Deep-audited against codebase on 2026-03-11 (2nd pass with full code reads).

## Grading Scale
- **PASS** — Verified in code with file:line evidence
- **PARTIAL** — Some aspects implemented, specific gaps identified
- **FAIL** — Not implemented or incorrect behavior confirmed
- **MANUAL** — Genuinely requires runtime playtesting (rare)
- **N/A** — Not applicable to async bot

---

## GENERAL MECHANICS

| ID | Grade | Evidence |
|---|---|---|
| G1 | PASS | `doubleActionSpecial` timing in cc-timing.js:45,457. DC play area handler at dc-play-area.js:1704 implements double-action attacks. |
| G2 | FAIL | No code distinguishes Bleeding + double action. Strain from any source applies as direct HP loss via `applyStrainToFigure` (combat.js:75-196) with no bleeding-aware reduction. |
| G3 | PASS | activation.js:134-154 — `pass_activation_turn_` handler checks activations remaining, allows pass only when opponent has more. |
| G4 | PARTIAL | Squad Swarm in activation.js:555-581 checks combined cost ≤15 but line 566 is **buggy**: adds the SAME card's cost twice instead of the candidate's cost. General SU restrictions not centrally validated. |
| G5 | PASS | activation.js:565-566 uses `getDcStats(meta.dcName).cost` which reads base `cost` from dc-effects.json. Attachments stored in separate maps, NOT included in getDcStats().cost. |
| G6 | PARTIAL | Change of Plans (abilities.js:7364-7399) checks shared keywords but does NOT check "equal or lower Deployment cost" as required. Attachment costs excluded correctly (not in getDcStats), but the cost comparison itself is missing entirely. |
| G7 | PASS | combat.js:474-483 — "Pre-combat window" posted with "Ready to roll combat dice" button. `getPlayableReactionCards` checks `whenAttackDeclared` timing (cc-timing.js:88-91). |
| G8 | PASS | Same "Pre-combat window" shown to both players. CC timing `whenAttackDeclaredOnYou` at cc-timing.js:92-94 allows defender reactions. Strike Me Down (combat.js:1396+) is a working defender-declared example. |
| G9 | PASS | combat.js:1584,1647 — `combat_roll_attack` and `combat_roll_defense` with rollAttackDice/rollSingleAttackDie. |
| G10 | PASS | combat.js:2047-2088 — reroll UI with "Reroll Window (Attacker)". |
| G11 | PASS | combat.js:2145-2157 — "Reroll Window (Defender)" and reroll prompts. |
| G12 | FAIL | No per-die reroll tracking. Reroll system uses simple counter (`attackerRerollsRemaining`/`defenderRerollsRemaining`) decremented on use (combat.js:2284). Any die can be selected multiple times. No `alreadyRerolled` flag per die. |
| G13 | PASS | `resolveCombatAfterRolls` (index.js:2271+) applies `bonusHits`, `bonusPierce`, `bonusAccuracy`, trooper bonuses. `applyDcPassivesToCombat` (combat.js:580) applies DC passives. |
| G14 | PASS | `resolveCombatAfterRolls` applies `roundDefenseBonusBlock` (index.js:2288-2290), `roundDefenseBonusEvade`, Harsh Environment, Weakened. `computeCombatResult` (combat.js:239-253) handles pierce reduction, Cunning, defense ignore. |
| G15 | PASS | combat.js:3267-3370 — "Spend surge" UI with surge ability selection, redraw cards, gain PT options. |
| G16 | PASS | `computeCombatResult` (combat.js:232-237): `if (combat.isRanged && combat.distanceToTarget != null) { if (totalAccuracy < combat.distanceToTarget) { hit = false; missReason = 'insufficient accuracy'; } }`. |
| G17 | PASS | index.js:2456-2477 — damage application after hit determination. |
| G18 | PARTIAL | Defeat checked at index.js:2456-2470+. "When defeated" CC timings exist (cc-timing.js:109,142,157,160). But interrupt system is ad-hoc per ability (e.g., `pendingSelfDestruct`), not a systematic interrupt chain. |
| G19 | PASS | Extensive post-attack attacker abilities in index.js:2378+: Guerilla (2528), Jets/Fly-By (2537), Locked and Loaded (2569), Leg Hydraulics (2640), Cover Fire (3617), Cleave (3681). |
| G20 | PASS | index.js:3086: `if (effectiveBlast > 0 && hit && damage > 0 && game.selectedMap?.id)` — `damage > 0` required. |
| G21 | PASS | index.js:3684: `if (hit && damage > 0 && effectiveCleave > 0 && game.selectedMap?.id)` — `damage > 0` required. |
| G22 | FAIL | Conditions from surges applied at index.js:2468-2477 AFTER damage block. Conditions applied even when `damage === 0` as long as attack hit — falls OUTSIDE the `if (damage > 0)` block scope. Should require damage > 0 per IA rules. |
| G23 | PASS | index.js:3071 — `healHp` called regardless of damage value, no damage > 0 check. |
| G24 | PASS | Defender post-attack abilities: Nimble/Asajj (index.js:2612-2627), Slippery (2628-2639), Force Deflection/Yoda (2658+), Self-Preservation (2504-2513). CC timing `afterAttackTargetingYouResolved` at cc-timing.js:95. |
| G25 | FAIL | Lure of the Dark Side ability-library entry only has `chooseAdjacentHostileThen: { strain: 2 }`. Handler (abilities.js:4382-4461) only applies 2 Strain. The "attack WITH that hostile figure" core mechanic is NOT implemented. |
| G26 | FAIL | Lure hostile attack not implemented — no focus/token usage from hostile figure coded. |
| G27 | FAIL | Lure hostile attack not implemented — no friendly/hostile reclassification during attack. |
| G28 | FAIL | Lure hostile attack not implemented — no ability usage from hostile figure coded. |
| G29 | PASS | Bleed resolved after action via `bleed_resolve` (combat-special-effects.js:122). |
| G30 | PASS | movement.js:203-204,258,260 — Mobile keyword detected, correctly ignores difficult terrain and hostile figure entry costs. |
| G31 | PASS | movement.js:205-214,258,260 — Efficient Travel checked. CC sets `roundEfficientTravel` per abilities.js:5455-5461. |
| G32 | PASS | movement.js:203 — Massive keyword checked for cost calculation. |
| G33 | FAIL | No Spire tile LOS rule implementation in spatial.js or LOS code. |
| G34 | FAIL | No ranged cleave implementation. Cleave exists only as melee mechanic. |
| G35 | PASS | combat.js:35-44 — `getPlayableReactionCards` uses Set to deduplicate by cardName per timing instance. |
| G36 | FAIL | Parting Blow (abilities.js:7197-7211) has no per-move tracking. No `partingBlowUsedThisMove` flag. Could be played multiple times per move. |
| G37 | FAIL | Jundland Terror (abilities.js:5768-5799) has no per-EOR restriction. No `jundlandTerrorUsedThisEOR` flag. |
| G38 | PASS | Excavation in round.js:528,796 triggers only during SOR via `runStartOfRoundDcEffects`. |
| G39 | FAIL | No companion space sharing system. `getOccupiedSpacesForMovement` (movement.js:79-91) has no companion exemptions. |
| G40 | FAIL | Only Cal's Buddy (abilities.js:8140) has companion deployment. No general companion entering-play system. |
| G41 | FAIL | No companion exit-from-play system. `clearConfig` (figure-config.js:35) removes per-figure config on defeat but doesn't cascade to companion figures. |
| G42 | PARTIAL | activation.js:1195-1198 sends informational text reminder about co-activation. No mechanical enforcement (readying, action tracking, ordering). |
| G43 | PARTIAL | Same informational-only system. No conditional activation logic for Junk Droid. |
| G44 | PARTIAL | No Junk Droid + Ugnaughts interaction beyond informational reminders. |
| G45 | PASS | mission-rules.js:30-56 — figure counting with specific companion exclusions. |
| G46 | PASS | mission-rules.js:37-40 — excludes "salacious b. crumb" and conditionally "the child" from control. |
| G47 | FAIL | No companion cost system. No code enforces companions = 0 cost for VP/game purposes. |
| G48 | FAIL | No companion interact restriction in board-helpers.js or interact.js. |
| G49 | FAIL | No companion-specific CC play rules. cc-timing.js:405 checks playableBy but no companion awareness. |
| G50 | PASS | mission-rules.js:28-56 — `getNamedAreaController()` with figure counting, tie logic, space control. |
| G51 | PASS | movement.js:184 — impassableEdges in movementBlockingSet; spatial.js:45-59 `impassableEdgeToWallSegment()`. |
| G52 | PASS | movement.js:164,384-387 — blockingSet checked for movement. |
| G53 | PASS | movement.js:170-175 — rubble tokens treated as difficult terrain. |
| G54 | PASS | movement.js:171 — `game.rubbleTokens` array checked and treated as difficult terrain. |
| G55 | PASS | interact.js:123-124 — doors added to `game.openedDoors`; map-events.js:32-33 also opens. |
| G56 | PASS | `openedDoors` array tracks state; movement.js:188-194 treats non-opened doors as blocking. |
| G57 | PASS | dc-play-area.js:867-886 — shield spaces from `game.ancillaryTokens.energyShield` added to blocking array. Comment: "Energy shields block LOS but not movement." |
| G58 | PASS | activation-state.js:66 and activation.js:465 — figures handled per figureKey within group. |
| G59 | PASS | movement.js:253,392-395 — `isLarge` flag handled; `getMovementProfile()` returns isLarge. |
| G60 | PASS | movement.js:423-432 — `enteringDifficult` checks if ANY entering cell is difficult terrain, `extraCost += 1`. For large figures, `entering` is the set of new cells. |
| G61 | PASS | movement.js:371-374 — `profile.canRotate` based on dimensions; large non-square figures can't rotate when pushed. |
| G62 | PARTIAL | dc-play-area.js:942 auto-checks all attacker cells to all target cells for LOS. No explicit "declare which space" step for large/Massive figures. |
| G63 | PASS | spatial.js:99+ — `hasLineOfSight()` with corner-based LOS checks and wall segment logic. |
| G64 | PARTIAL | `canEndOnOccupied: isMassive` (movement.js:261) allows Massive to end on occupied. But no Massive-blocks-Massive rule (preventing entry to spaces with other Massive figures). |
| G65 | PARTIAL | Multi-cell LOS checks exist but no explicit Massive LOS exemption (figures don't block LOS to/from Massive). |
| G66 | PARTIAL | `resolveMassivePush` (movement.js:654-667) pushes overlapping figures, but no voluntary movement restriction after ending on occupied space. |
| G67 | PARTIAL | Same gap — no SOR-specific voluntary movement restriction for Massive. |
| G68 | PARTIAL | Same gap — no EOR-specific voluntary movement restriction for Massive. |
| G69 | PARTIAL | `resolveMassivePush` exists but no player-chosen ordering (friendly first, hostile second). |
| G70 | PARTIAL | Same — push ordering not player-controllable. |
| G71 | PARTIAL | Push exists but companion-specific inclusion not verified. |
| G72 | PASS | combat.js and abilities.js — Hit, Block, Surge, Evade tokens; `figurePowerTokens` in game state. |
| G73 | PARTIAL | Token cap enforced at 2 (game-helpers.js:30-38). Migs has max 3. But no "choose which to discard" when gaining 3rd — code simply caps. |
| G74 | PARTIAL | Discard pile mechanics exist (index.js:3940-4009 for Mastery, Military Efficiency redraw). Not full "select from discard" feature. |
| G75 | PARTIAL | Fool Me Once sets discard to empty array (abilities.js:2430). Cards deleted, not tracked in separate "game box" collection. |
| G76 | PARTIAL | Suffix letters a/b in components.js:189. Health tracking supports multi-figure arrays (damage-helpers.js:31-44). But no attachment-to-individual-figure pairing. |
| G77 | PARTIAL | Attachments tracked per DC msgId, not per individual figure within group. |
| G78 | PARTIAL | No deployment pairing choice for multifigure groups. |
| G79 | PASS | Map/mission selection in setup.js and game-creation.js; `getMissionRules()` from mission-cards.json. |
| G80 | PASS | setup.js:735-776 — `handleDetermineInitiative`; Math.random(). |
| G81 | FAIL | No "least deployment points" tiebreaker. Uses pure random (line 762: `Math.random() < 0.5`). |
| G82 | FAIL | No Devious Scheme check before initiative roll. |
| G83 | PASS | setup.js — `handleDeploymentZone` (line 782) and `handleDeploymentFig` (line 864). |
| G84 | PASS | Skirmish upgrades placed after figure deployment (post-deploy.js, setup.js:1582). |
| G85 | FAIL | No deployment zone overflow handling or validation. |
| G86 | PASS | setup.js:822-857 — initiative player deploys first. |
| G87 | PASS | post-deploy.js:659 — `runPostDeployPhase()` ordered by initiative player first (line 664). |
| G88 | PASS | cc-hand.js:1159 — "I Know Everything" (Moff Gideon) runs before card draw. |
| G89 | PASS | cc-hand.js — `handleDrawInitialHand` (line 1149); round.js:430-435 Status Phase draw. |
| G90 | PASS | mission-rules.js — startOfRound rules (round.js:406-407). |
| G91 | PASS | round.js:749 — `if (interaction.user.id === initiativeId)` initiative player first. |
| G92 | PASS | round.js:750-754 — non-initiative player second. |
| G93 | PASS | activation.js — sequential activations with `pass_activation_turn` and `end_turn`. |
| G94 | PASS | round.js:291 — `dcExhaustedState.set(msgId, false)` for all DCs. |
| G95 | PASS | round.js:324-365 — each player draws `1 + terminals_controlled` cards. Cut Lines sets draw to 0. |
| G96 | PASS | `runEndOfRoundRules()` in mission-rules.js (round.js:369-377). |
| G97 | PASS | round.js:81-89 — initiative player effects first in `handleEndEndOfRound`. |
| G98 | PASS | round.js:90-91 — switches to other player. |
| G99 | PASS | Round-scoped flags cleared at `cleanupRoundStart` (activation-state.js:279-295). EOR effects persist through EOR, cleared only at round start. |
| G100 | PASS | Same mechanism — "during this round" flags also cleared at `cleanupRoundStart`, so they apply during EOR. |
| G101 | PASS | round.js:319 — `setActivatedDcIndices()` called at EOR after all effects complete. |
| G102 | FAIL | No "Zillo readied before EOR" mechanic. `cleanupRoundStart` resets round flags but no figure-specific readying before EOR exists. Zillo Technique itself has zero code implementation. |
| G103 | PASS | round.js:403 — initiative switches to other player. |
| G104 | PARTIAL | Strain applied as direct HP damage (`applyStrainToFigure` combat.js:75+). No "choose damage vs discard" option for strain. |
| G105 | PARTIAL | No multi-strain up-front allocation choice. Strain always applied as damage. |
| G106 | PASS | activation.js — Mounted (732), Fulcrum (779), Fleet (1180) with start-of-activation hooks. |
| G107 | PASS | Initiative player resolves first per activation — implicit in sequential order. |
| G108 | PASS | Non-initiative player second — handled by `pass_activation_turn`. |
| G109 | FAIL | No Jyn Quick Draw / Vader Unshakeable initiative-dependent timing implementation. |
| G110 | PASS | vp-helpers.js:23-39 — kills and objectives tracked separately. |
| G111 | PARTIAL | Kill points tracked separately but tiebreaker logic not in `checkWinConditions`. |
| G112 | FAIL | No `totalDamageReceived` tracking. |
| G113 | FAIL | No blue die accuracy rolloff tiebreaker. |

---

## REBEL DEPLOYMENT CARDS

| ID | Grade | Evidence |
|---|---|---|
| R1 | PASS | dc-effects.json — Chewbacca `"cost": 15`. |
| R2 | PASS | abilities.js:3324 — Debts Repaid readied into starting hand. |
| R3 | PARTIAL | Slam mechanism exists (abilities.js:1685-1855) but Wookiee Avenger free Slam noted at activation.js:1215 as "not yet automated (needs target picker)". No `specialAction` counter for CC purposes (To the Limit, All in a Day's Work). |
| R4 | PASS | dc-effects.json — Chewbacca Dodge converts to evade. |
| R5 | FAIL | No upgrade validation at army setup for Chewbacca. |
| R6 | PASS | dc-effects.json — Han Solo `"cost": 12`. |
| R7 | PASS | combat.js:620 — "Rogue Smuggler (Han Solo): reroll 1 atk die". |
| R8 | PASS | combat.js:243 — "+1 Block per rolled Evade result while defending". |
| R9 | PASS | dc-effects.json — Return Fire ability text confirmed. |
| R10 | PASS | dc-effects.json — Rogue Smuggler EOR attack confirmed. |
| R11 | FAIL | No upgrade validation for Han Solo. |
| R12 | PASS | dc-effects.json — Heir to the Jedi attachment cost: 0. |
| R13 | PASS | abilities.js:4233-4236 — Deflect with counter-damage logic. |
| R14 | PASS | abilities.js:1570 — `freeAttackBonus` (Heroic). |
| R15 | PASS | Player must click Heroic button before attacking, which serves as declaration. The free attack is via `freeAttackBonusPending`. |
| R16 | PASS | dc-effects.json — Cara Dune Shock and Awe die replacement. |
| R17 | PASS | abilities.js:1685 — Smash ability. |
| R18 | PASS | Smash has "may push" requiring valid adjacent space check. |
| R19 | PASS | dc-effects.json — Hunker Down confirmed. |
| R20 | PASS | dc-effects.json and abilities.js:2096 — Demolish. |
| R21 | PARTIAL | Rubble tokens placed by Demolish (abilities.js:2173-2177) and rendered. But no Wasskah wall interaction — rubble tokens have no movement-cost or wall-breaking enforcement in movement.js. |
| R22 | PASS | dc-effects.json — Shrapnel surge ability. |
| R23 | PASS | dc-effects.json: Drokkatta has `unique: true` but NO `elite: true`. Fury of Kashyyyk Pierce check at combat.js:775 requires `_fokIsElite` — Drokkatta correctly excluded. |
| R24 | PASS | abilities.js:581-604 — Battlefield Leadership. |
| R25 | PASS | abilities.js:170-186 — Military Efficiency. |
| R26 | PASS | combat.js:1514 — Bo-Rifle Staff Strike. |
| R27 | PASS | combat.js:2963,3938-3982 — Lasat Honor Guard. |
| R28 | FAIL | No Twin Sabers reroll restriction. No code prevents re-rerolling a die that was already rerolled by Twin Sabers. |
| R29 | FAIL | No simultaneous Twin Sabers reroll implementation. |
| R30 | PASS | combat.js:1085-1099 — Much to Learn. |
| R31 | FAIL | No interrupt-ordering system between Brutal Cleave's damage and Parting Blow's Stun. |
| R32 | PASS | activation.js:1112-1128 — Trust Goes Both Ways checks friendlies within 3 spaces using `getRange`. Button picker for selection. |
| R33 | PASS | Trust Goes Both Ways fires at activation start (activation.js:1112). Card text specifies start of activation only, which matches implementation. |
| R34 | FAIL | Kanan opponent naming group not found in code. |
| R35 | FAIL | Kanan defeated group flexibility not implemented. |
| R36 | FAIL | Kanan pass restriction not implemented. |
| R37 | PASS | Ko-Tun Arms Distribution at activation.js:1093-1109 distributes 2 power tokens among friendlies within 3 spaces with interactive picker. |
| R38 | PASS | Ko-Tun in standard activation system with `elite: true, unique: true`. |
| R39 | PASS | Dead Precise at combat.js:1245-1250: checks `!game.figureMoved?.[attackerFigureKey]`, applies +2 Accuracy. |
| R40 | PARTIAL | Squad Cohesion in ability-library.json as `passive-aura` with `wiredStatus: "wired"`, but no code enforces cross-figure power token spending. Players must handle manually. |
| R41 | FAIL | Luke Hero 0-pt upgrade enforcement not found. |
| R42 | PASS | combat.js:615-666 — Luke (Hero) reroll on sabre strike. |
| R43 | FAIL | No "+1 damage on sabre strike" found for Luke Hero. |
| R44 | PASS | combat.js:661-666 — Luke (Hero) autofocus on sabre strike. |
| R45 | FAIL | No global reroll for Luke Hero. |
| R46 | PASS | board-helpers.js:136-152 blocks interaction for hostile figures cost ≤9 within 3 spaces of Obi-Wan. board-helpers.js:218-270 excludes from objective control. Both automated. |
| R47 | PASS | combat.js:1396-1411: Yes/No buttons for Strike Me Down. combat-reactions.js:296-379: reduces VP by 3, defeats Obi-Wan, cancels attack. |
| R48 | PASS | abilities.js:1603 — Verena Close Quarters attack override. |
| R49 | PASS | Into the Fray (activation.js:856-876): 1 MP + Surge tokens per hostile with LOS. Hold the Line (activation.js:306-329): Block tokens per hostile with LOS. Both automated. |
| R50 | MANUAL | Cassian companion defeat trigger — Strike Team is automated but companion-specific defeat tracking not independently verified. |
| R51 | PASS | post-deploy.js:92-93,375-430 — Strike Team fully automated: 2 MP to Cassian, 2 MP to adjacent friendly, distribute 4 Hit tokens. |
| R52 | FAIL | CT-1701 Barrage (+white die on second attack) not found as automated ability. Only Cover Fire is wired. |
| R53 | PASS | Cover Fire fully automated at combat.js:4155-4217 with Block token distribution and condition/power-token discard pickers. |
| R54 | PASS | movement.js:532-576 — Cut and Run: when exiting hostile space, that hostile suffers 1 Damage. Tracks `roundFigureAbilityUsed` for once-per-figure-per-round. |
| R55 | MANUAL | Fell Swoop back-and-forth movement for Cut and Run requires runtime verification. |
| R56 | PASS | combat.js:2042,2452-2459 — Lando Resourceful + Gambit reroll/switch. |
| R57 | PASS | combat.js:1902-1909 Resourceful adds to `pendingPreRerolls`. Gambit at combat.js:2452-2458 allows die color swap. Die used in other reroll effects tracked separately. |
| R58 | PASS | combat.js:2035-2043 — Shrewd Scoundrel guess (0/1/2 Hits). Checked at combat.js:2792-2807: compares guess to roll, awards 2 VP if correct. |
| R59 | PASS | cc-timing.js:376-395 — Fast Learner: once per round, may play CC whose restriction matches another DC name in army (except Arcing Shot). Iterates all army DCs. |
| R60 | PARTIAL | cc-timing.js:315-337: affiliation matching automated for CC restriction bypass. But trait grant (HUNTER/SMUGGLER/GUARDIAN) is described only in dc-effects.json abilityText — no runtime keyword injection. |
| R61 | PARTIAL | Pathfinder Infiltration: no code found specifically for deployment zone override. |
| R62 | PASS | combat.js:1798-1805 — Light it Up grants +1 atk reroll if target had no LOS to attacker at activation start. |
| R63 | FAIL | Distracting Fire defined in ability-library.json but no automated damage handler found. |
| R64 | PARTIAL | J4X-7 companion referenced in abilities.js:5997-6012 (Droid Mastery CC). Focus + free attack granted. But J4X-7 deployment says "Deploy manually." |
| R65 | PASS | Jyn Odan Cunning at combat.js:860-863 — `hasCunning = true` while defending (+1 Block per Evade). |
| R66 | PARTIAL | Loku attack effects wired (combat.js:1383-1393): Set Your Sights +Pierce 2, Mon Cala SF Focus. But recon token PLACEMENT is not automated. |
| R67 | PASS | Tress: Shared Intuition (combat.js:978-988), Fyrnock Style (combat.js:1851-1854), Krayt Dragon Fury (combat.js:3164-3169,3401-3414). |
| R68 | PASS | Krayt Dragon Fury resolves X-based surge abilities counting dice results. |
| R69 | PARTIAL | Autofire chain attack wired (combat.js:756-758 `autofireActive`). Rotary Cannon auto-Focus may be manual. |
| R70 | PASS | Chirrut: Force is With Me (combat.js:1337-1379) — ranged attack targeting Chirrut modifies attack, damages adjacent hostile. Devout (cc-timing.js:314) enables FORCE USER CCs. |
| R71 | PASS | Hera: Call the Shots (combat.js:2900-2937) — +2 Acc, +1 Hit, or +1 Surge choice for friendly within 3. Once per round tracked. |
| R72 | PARTIAL | Murne Figurehead in ability-library.json as `dcSpecial`, `freeAction: true`, `wiredStatus: "wired"` but NO handler code found. Interactive interrupt for redirect not coded. |
| R73 | PASS | False Orders fully automated at combat.js:4064-4151. `falseOrdersControllerPlayerNum` tracked throughout combat (combat.js:1564,2181,3266,3575). Controller rolls dice and spends surge. |
| R74 | PASS | Saska devices: `deviceTokens` at activation.js:1871-1876. Power Converter at combat-reactions.js:481-580: reroll with optional color swap. Once per round tracked. |
| R75 | PARTIAL | Device tokens placed and consumed via Power Converter. But no broader device system (removal on defeat, board rendering outside combat flow). |
| R76 | MANUAL | Shared reroll pool (once anyone uses reroll, exhausted for ALL device figures) requires runtime verification of the once-per-round tracking scope. |
| R77 | PASS | combat-reactions.js:481-580 — dice color swap during Power Converter reroll. |
| R78 | PASS | combat.js:1210-1217 — `camouflage_mak` blocks ranged attacks from 4+ spaces. Attack cancelled automatically. |
| R79 | PARTIAL | Critical Hit surge: Pierce 2 handled via standard surge damage. But "target may not play Command cards this round" CC-blocking effect not automated. |
| R80 | PASS | dc-effects.json — Bodhi Rook Smooth Landing confirmed. |
| R81 | PASS | combat.js:866-878 — `distracting_c3po` checks if C-3PO adjacent to targeted SPACE (not defending figure). Uses `adjToTarget` from `mapSpaces.adjacency` of `target.coord`. |
| R82 | PASS | abilities.js:7898-7905 — `searchDeckForCC` preserves deck order. |
| R83 | PASS | combat.js:769-792 — Fury of Kashyyyk Pierce only for elite WOOKIEEs (`_fokIsElite` check). |
| R84 | PASS | dc-effects.json — "if there is another friendly WOOKIEE" (any Wookiee in range). |
| R85 | FAIL | Fury of Kashyyyk "When a friendly WOOKIEE suffers 3+ Damage, become Focused" — no code implementing this damage-triggered Focus. Only Reach and Pierce 1 are wired. |
| R86 | PASS | dc-effects.json — Heavy Fire text does not require damage. |
| R87 | PASS | dc-effects.json — Heavy Fire usable on missed attacks. |
| R88 | FAIL | Heavy Fire has NO handler code. The ability (deal 1 damage per die to hostiles within 2, opponent chooses conditions) is entirely unimplemented. |
| R89 | PASS | dc-effects.json — Lie in Ambush timing confirmed. |
| R90 | PASS | dc-effects.json — group deploys ready. |
| R91 | PASS | activation.js:583-608 — explicitly checks `(game.currentRound || 1) > 1` to skip round 1. Checks 3+ exhausted/defeated groups. |
| R92 | PASS | abilities.js — deck order preserved for Smuggling Compartment/Heroic Effort. |
| R93 | PASS | dc-effects.json — bottom cards stay on bottom unless shuffled. |
| R94 | PARTIAL | Rogue One token sharing (discard PT from friendly for +1 Surge while attacking) — no automated mid-attack handler. Only start-of-round draw-3/return-2 automated (round.js:637-674). |
| R95 | PASS | round.js:637-674,1106-1154 — Rogue One start-of-round draw 3, return 2 with interactive picker. Blocking until resolved. |

---

## MERCENARY DEPLOYMENT CARDS

| ID | Grade | Evidence |
|---|---|---|
| M1 | PASS | abilities.js:189-239 — Wrist Cord (`pushTargetWithinRange`) with MP cost at lines 220-221. |
| M2 | PASS | abilities.js:2096-2179 — Flamethrower (`fixedAreaEffect` with MP cost). |
| M3 | PARTIAL | Arsenal checked at dc-play-area.js:1375-1383 but no validation.js rule requiring IG-88 to bring upgrade. |
| M4 | PASS | dc-play-area.js:1375-1386 — Arsenal declaration; `arsenal_pick_` handler at handlers/index.js:386. |
| M5 | PASS | index.js:3193-3203 — Crippling Blow Stun applied only if hit (line 3195). |
| M6 | PASS | Crippling Blow only applies if `hit && combat.target?.figureKey` — excludes misses. |
| M7 | FAIL | `voracious_rancor` defined in ability-library.json (trigger: "other-activation") but NO handler code in any src file. "voracious" not found in JS. |
| M8 | FAIL | No Voracious handler — cannot validate friendly triggering. |
| M9 | FAIL | No Voracious handler — cannot validate hostile triggering. |
| M10 | FAIL | No Voracious handler — cannot validate different Rancor triggering. |
| M11 | PASS | combat.js:1810-1812 — HK Versatile Weaponry forces defender reroll in `forcedRerollQueue` before voluntary rerolls. |
| M12 | PASS | `forcedRerollQueue` processes before defender voluntary rerolls. |
| M13 | FAIL | No "Krrstanan" or "autofocus" code anywhere in codebase. Ability entirely absent. |
| M14 | PASS | index.js:3206-3218 — Disruptor Rifle additional damage. |
| M15 | PASS | round.js:532,1178-1193 — 4-LOM Programming Override trait declared at start of round. |
| M16 | PASS | combat-special-effects.js:14-43 — Indiscriminate Fire respects target exclusion. |
| M17 | PASS | combat-special-effects.js:449-480 — Spread the Pain with condition picker. |
| M18 | FAIL | Punishing Strike (SU) — no handler code in src. dc-effects.json:391-397 data only. |
| M19 | FAIL | Power token cap globally hardcoded to 2 everywhere (activation.js:256, interrupts.js:320, movement.js:855,887, abilities.js:731,1274,1318). No per-figure override for Migs Mayfeld's 3-token limit. "Migs" and "Locked and Loaded" not in any src file. |
| M20 | FAIL | Droid Arm has no implementation. dc-effects.json describes it but no specialAbilityIds or handler code. |
| M21 | FAIL | Depends on M20 — not implemented. |
| M22 | FAIL | Migs Return Fire has no handler code. |
| M23 | PASS | combat.js:149-162 and interrupts.js:652-690 — Paz Vizsla Submit or Fight strain mechanic. |
| M24 | PASS | abilities.js:189-239 — Mandalorian Whip space-by-space push. |
| M25 | PASS | abilities.js:226-231 — `postPushFreeAttack` can trigger Parting Blow. |
| M26 | PASS | combat.js:1157-1171 — Keep the Peace checks adjacent to target space. |
| M27 | PARTIAL | Form picker at setup.js:1380-1403 and round.js:550-571. But NO uniqueness check — two Clawdites can pick the same form. |
| M28 | FAIL | No code restricting multiple Clawdites from sharing a form. |
| M29 | PASS | round.js:551 — Clawdite forms assigned at start of round. |
| M30 | PARTIAL | Gar Saxon Airborne Commander defined as passive-aura (WIRED). activation.js:995-997 shows reminder. But actual surge-sharing in combat not automated — textual reminder only. |
| M31 | FAIL | No Mobile trait verification on the attacking figure. Reminder only says "Mobile figures within 4 spaces may use surge abilities." |
| M32 | PASS | activation.js:991-992 — Hondo Negotiate asks opponent. |
| M33 | PASS | abilities.js:1432 — VP payment check for Hondo. |
| M34 | FAIL | Nefarious Gains has no implementation. No defeat hook transfers VP for Jabba. `nextHostileDefeatVpBonus` system is for CC effects only. |
| M35 | FAIL | abilities.js:982-1011 — Incentivize targets ANY elite figure on board (both players, lines 995-1002). No Scum affiliation filter. |
| M36 | FAIL | ability-library.json has `chooseFriendlyToFocus: true, choiceRequiresElite: true` but no Scum restriction. |
| M37 | PASS | dc-play-area.js:2037-2044 — Dual-Bladed Fury with Darksaber. |
| M38 | PASS | Stalk Prey surge parsed at combat.js:125, flag set at combat.js:3311. |
| M39 | PARTIAL | `combat.surgeStalkPrey` flag is set but NEVER consumed — no code reads it to grant MP or tokens post-combat. Effect incomplete. |
| M40 | PASS | abilities.js:3081-3085,3466-3469 — Sustained by Rage damage recovery. |
| M41 | PASS | combat.js:2688,2873-2881 — Onar Get Down defensive bonus via pending combat passive. |
| M42 | PASS | cc-timing.js:303,313,341-355 — Fallen Master: FORCE USER figures re-check CC restrictions with IMPERIAL affiliation override. Correctly allows FORCE USER figures to use IMPERIAL CCs. |
| M43 | PARTIAL | Rubble placement system exists (game-state.js:114, ability-library.json). But Taron-specific rubble effects (combat bonuses from rubble) not implemented. |
| M44 | PASS | combat.js:121 — Stun Net as surge effect, applies without damage requirement. |
| M45 | PASS | activation.js:1274-1305 — Cad Bane triggers at other figure activation. |
| M46 | PASS | Same handler triggers on hostile figure activation. |
| M47 | PASS | activation.js:1274-1310 — fires on EVERY activation (both players), checks range + LOS, skips self. Grants 1 MP to each qualifying HUNTER. |
| M48 | PASS | combat.js — Hired Guns Focused before defeated logic for Parting Shot. |
| M49 | PASS | Post-combat resolution ensures Parting Shot before Stun. |
| M50 | PASS | abilities.js:7621 — Nexu Pounce counts spaces via `getReachableSpaces` (not MP). |
| M51 | PASS | Pounce can originate from any space of figure. |
| M52 | PASS | Pounce only requires one space within counted range. |
| M53 | PARTIAL | activation.js:1195-1199 posts notification. `overclock` and `spot_weld` in ability-library are `informational: true`. Junk Droid companion mechanic is honor-system only — no companion figure tracking or automated combat/movement. |
| M54 | PASS | Aphra BT-1 and 0-0-0 deployed together via attachment logic. |
| M55 | PASS | dc-play-area.js grants +1 action after 0-0-0 resolves Invasive Procedure; combat-special-effects.js grants +1 action after BT-1 ends Missile Salvo. Both check Doctor Aphra alive on same team. |
| M56 | PASS | interrupts.js:621-650 — Excavation with `excavation_pick_` handlers. round.js:911-947 filters cost ≤1. |
| M57 | PASS | Excavation fires at SOR only (round.js:528). Cannot replay a card excavated in the same SOR since it goes to hand, not play. |
| M58 | PARTIAL | Excavation filters cost ≤1 but no explicit Fool Me Once interaction handler. |
| M59 | PARTIAL | No Rest in Peace interaction — if Rest in Peace is active (discard blocked), Excavation from discard would still work since it just moves card. |
| M60 | PASS | Greedo uses same defense modifier logic as Hired Guns. |
| M61 | PARTIAL | `bartered_information` at abilities.js:1117-1148 correctly restricts to Scum (line 1138). But VP-spend for second Focus is described in log message only, not enforced. `illicit_arms_bib` (discard CC for +1 Hit) is NOT implemented. |
| M62 | FAIL | `illicit_arms_bib` defined in ability-library.json (trigger: "attack-declare") but no handler code in src. |
| M63 | PARTIAL | `bartered_information` enforces Scum-only (abilities.js:1138). But `illicit_arms_bib` is not implemented so can't evaluate its restrictions. |
| M64 | PASS | combat.js — Jawa Take Cover usable with no evade results. |
| M65 | PASS | -1 evade is noop if no evade results. |
| M66 | PASS | combat.js:3346-3358 — Jawa Bargain VP mechanics. |
| M67 | FAIL | `hop_on_kuiil` defined in ability-library.json but no handler code. Data-only, not implemented. |
| M68 | PASS | dc-play-area.js:186 — Orbital Bombardment token depletion. |
| M69 | FAIL | Beast Tamer SU has no handler code. Not automated. |
| M70 | FAIL | Same — not implemented. |
| M71 | FAIL | [Black Market] SU has no handler code. Note: "Black Market Prices" CC IS implemented (abilities.js:2456-2474) but the SU is not. |
| M72 | FAIL | Same — SU not implemented. |
| M73 | FAIL | Same — three-choice mechanic not implemented. |
| M74 | PARTIAL | dc-effects.json defines companion "The Child". activation.js:206-209 posts reminder. Force Heal may have handler but Force Exhaustion (remove die + Weaken) not in combat code. |
| M75 | FAIL | [Devious Scheme] SU has no handler code. |
| M76 | PARTIAL | [Indentured Jester] companion defined. `scratch_crumb` in ability-library has `targetHostileFigure: { damage: 1, range: 1 }` with handler. activation.js:211-212 posts reminder. But "not counted for control" handled via mission-rules.js:37. |
| M77 | FAIL | [Punishing Strike] SU — no handler code. |
| M78 | PASS | combat.js:689-694 — Scavenged Weaponry transfer upon defeat. |
| M79 | FAIL | [Under Duress] SU — no handler code. |
| M80 | FAIL | Same — not implemented. |
| M81 | PASS | post-deploy.js:115-127,494-518,937-952 — Scavenged Walker post-deploy movement fully automated with move/skip buttons. |
| M82 | PASS | interrupts.js:428-451 — Scavenged Walker EOR attack with -1 Hit penalty (activation-state.js:187). Attack/skip buttons. |
| M83 | PASS | dc-play-area.js:1333-1335 — affiliation change (loses Assault). |
| M84 | PASS | round.js:238-253 — Scavenged Walker EOR attack. |

---

## IMPERIAL DEPLOYMENT CARDS

| ID | Grade | Evidence |
|---|---|---|
| I1 | PASS | dc-effects.json line 1926: Darth Vader `"cost": 18`. Used as canonical cost everywhere. |
| I2 | FAIL | No validation requiring Driven by Hatred upgrade. No error/warning produced. |
| I3 | PARTIAL | Lord of the Sith automated (abilities.js:7018-7072). But Driven by Hatred EOR attack noted at activation.js:1269 as "not yet automated". |
| I4 | PASS | activation.js:1017-1033,1647-1695 — General's Orders picks up to 2 friendlies, each gains 2 MP via `addMovementPoints`. |
| I5 | PASS | dc-play-area.js:838-843,1372-1386 — Epic Arsenal 3-dice selector correctly skips `c1 === c2 && c2 === c3`. Focus adds green die separately at combat time, NOT counted toward the 2-same-color limit. |
| I6 | PASS | combat.js:1202-1208 — `awkward_atst` cancels attack if `distanceToTarget <= 1`. |
| I7 | PARTIAL | Executor defined as `freeMoveBonus: 2, freeAttackBonus: true`. Handler is generic (abilities.js:2226-2235). But no special timing to ensure it fires BEFORE "after attack resolves" — relies on player manually triggering. |
| I8 | PASS | combat.js:1114-1141 — Sentinel at line 1130: `if (fkAbilityIds.includes('sentinel') && !defenderIsGuardian)` — +1 Block only for non-GUARDIAN. |
| I9 | PASS | abilities.js:7898-7940 — `searchDeckForCC` filters by traits (FORCE USER, BRAWLER) and cost (≤2), shows choices, moves to hand, shuffles deck. |
| I10 | PARTIAL | Composite Plating (+1 Block at 4+ spaces) at combat.js:1067-1070. Spray Fire (-3 Accuracy +1 Surge) at combat.js:1253-1258. Both wired. But -1 cost discount for Modular attachment noted but not enforced in army building. |
| I11 | PASS | combat.js:1210-1218 — `camouflage_scout_trooper` blocks ranged attacks from 4+ spaces. Cancels attack. Unit tested (abilities.test.js:658-672). |
| I12 | PARTIAL | Forward Mounted Blasters passive at combat.js:582-599 (reroll if target in same row, -1 Hit otherwise). But no movement restriction for the Bikes specifically. |
| I13 | PASS | combat.js:588-597 — uses `getFootprintCells` to check if target row matches ALL bike cells. Correct geometric check. |
| I14 | PARTIAL | Static Pulse (Dio's CC) automated (abilities.js:5647-5695). But Droid Kit (gain PT if Dio in space) and Pulse Cannon (+4 Acc +1 Hit when spending PT) not automated — honor-system. Dio companion deployment not automated. |
| I15 | FAIL | Dio "not counted for control" when Iden alive, but SHOULD count after Iden defeated. No code implements this state change. |
| I16 | PASS | abilities.js:1048-1083 (Elite) and 1085-1115 (Regular) — Coordinated Raid. Elite: IMPERIAL cost ≤4 within 4 spaces. Regular: same group. Both grant interrupt attack. |
| I17 | FAIL | No ranged cleave implementation found. TGI abilities not automated. |
| I18 | FAIL | No TGI-specific reroll found. |
| I19 | PARTIAL | Hunt Dissent at activation.js:1138-1140 — reminder message only. No automated defeat tracking or Block Token granting. ACS range extension not dynamically applied. |
| I20 | PASS | combat.js:914-922 — auto-Focuses Dark Trooper on attack declare. combat.js:2301-2312 — if rerolled die has fewer Hits, +1 Hit bonus. |
| I21 | PASS | "I Know Everything" at cc-hand.js:1159-1184,1229-1267 — reveals 2 cards, opponent keeps one, other removed. "The Darksaber" via `pendingDarksaberSecondAttack`. Both automated. |
| I22 | PARTIAL | Thrawn: Long-Laid Plans IS automated (activation.js:1035-1053 — distributes N power tokens). Strategize is reminder only (activation.js:1055-1058 — "Look at top CC of each deck"). |
| I23 | PASS | Interrogate: surge parsed at combat.js:159-160. Handler at post-combat.js:236-326 — shows opponent hand, pick card, optional discard-to-force-discard. Full interactive flow. |
| I24 | PARTIAL | BT-1 Assassin uses `battle_meditation` (combat.js:836-842) — auto-Focuses before attack. But Focus is consumed on first attack's green die, and combat.js:916 checks `!attackerConds.includes('Focus')` — so subsequent Missile Salvo attacks won't re-Focus if Focus was consumed. |
| I25 | PARTIAL | Gifted Mechanic uses `targetFriendlyFigureAdjacent` handler (abilities.js:466-510). Trait filter exists but specific "adjacent Droid or Vehicle" filter content not fully traced. |
| I26 | PARTIAL | Advanced Weapons Research at activation.js:886-895 — range hardcoded to 2 (`_getRange(selfPos, fp) <= 2`). No dynamic ACS check to extend range to 3. |
| I27 | PASS | dc-play-area.js:1743-1785 — Overwatch token placement with LOS validation. Position stored in game state. Reminder at activation start (lines 201-205). |
| I28 | FAIL | No Incinerate code in src. No handler for rubble-from-damage or Reduce to Rubble interaction. |
| I29 | FAIL | No rubble-breaks-walls code. No Wasskah-specific logic. |
| I30 | PARTIAL | Fireproof at combat.js:83-88 blocks Strain (`Flame Trooper` check). But Bleed immunity not explicitly coded. |
| I31 | PARTIAL | Sorin Bombardment automated (abilities.js:868-879). Advanced Firepower is reminder only (activation.js:999-1001). Aura check for Droids/Vehicles not dynamically verified at combat time. |
| I32 | N/A | Deck-building convention, not code. |
| I33 | PASS | combat.js:1772-1794 — Coordinated Hunt: checks if attacker is Purge Commander (self +1 reroll) OR if attacker is HUNTER with Purge Commander in LOS. |
| I34 | FAIL | No `saber_orbit` or `sabre_orbit` code found. Saber Orbit special action not automated. |
| I35 | PASS | Mastery surge at combat.js:157-158. post-combat.js:190-232 — shows eligible FORCE USER CC cards cost ≤1 from discard, interactive picker to return to hand. |
| I36 | PARTIAL | Invasive Procedure handler (abilities.js:324-410) finds adjacent hostiles. If NO adjacent figures, returns "No valid targets" — ability fails. Test case says it should work (self-Focus) even with no adjacent figure. Self-Focus is conditional on targeting someone. |
| I37 | FAIL | No `field_tactics` or `death_trooper` ability code in src. Not automated. |
| I38 | FAIL | Chain requires Death Trooper Field Tactics which isn't implemented (see I37). |
| I39 | PASS | Elite: `executive_order` (abilities.js:801-835) — choose Imperial within 2, interrupt move/attack. Regular: `officer_order` (lines 837-865) — 2 MP to friendly within 2. Regular also has `cower_imperial_officer_reg` (combat.js:1735-1740) — defense reroll if adjacent friendly. Distinct abilities. |
| I40 | N/A | TBD per test doc. |
| I41 | PASS | dc-play-area.js:1352-1377 — loadout picker shown after deployment. `handleLoadoutPick` at lines 1412-1435 stores via `setConfig`. |
| I42 | PASS | dc-play-area.js:1357-1363 — ALL loadout names shown as buttons. No uniqueness check. Multiple Purge Troopers can pick same loadout. |
| I43 | PARTIAL | Electrohammer `electro_pulse` defined in loadout-cards.json. `loadoutPostAttack` stored on combat object (combat.js:542) but NEVER consumed — no handler processes it. Splash damage not applied. |
| I44 | PARTIAL | Electrostaff `quick_strike`: `defenderRerolledOrModified` flag IS tracked (combat.js:2336,3552,3608). But `loadoutPostAttack` never consumed — Quick Strike damage never applied. |
| I45 | PASS | combat.js:679-681 sets `crossTrainingDefend = true`. Lines 1620-1624: replaces first non-white defense die with white. |
| I46 | FAIL | Cross-Training has no exhaust tracking. Die swap at combat.js:680 applies EVERY time figure defends. No `exhaustedSkirmishUpgrades` check. Should be once per round. |
| I47 | PARTIAL | Imperial Citadel SOR token placement automated (round.js:676-692,1157-1175). But "gain on defeat" (transfer PTs from defeated figure to Citadel) has no automated defeat hook. |
| I48 | FAIL | Imperial Retrofitting defined in dc-effects.json:279 but no implementation code. Data only. |
| I49 | PASS | combat.js:733-740 — +1 Hit when attacking during non-activation. dc-play-area.js:1220-1224 — +2 MP for non-activation move. Both correctly gate on "not during this group's activation." |
| I50 | PASS | dc-play-area.js:1628-1690 — two special action buttons: "VF: Attack+Move" and "VF: Focus" (once/round via `vadersFocusUsedThisRound`). |
| I51 | FAIL | Zillo Technique has zero implementation in src. Entirely honor-system. |
| I52 | FAIL | Same — no code at all. Cannot verify Pierce reduction timing. |
| I53 | PASS | Overwatch fully implemented (see I27). |

---

## COMMAND CARDS

| ID | Grade | Evidence |
|---|---|---|
| C1 | PARTIAL | Assassinate in cc-effects.json with `attackBonusHits: 3` (abilities.js:3960-3970). +3 Hits mechanic works. But FAQ mutual exclusion ("first CC this attack; no other CCs") NOT enforced — no logic blocks other CCs after Assassinate. |
| C2 | MANUAL | Lord of the Sith timing `whenHostileFigureDefeatedNotYourActivation` (cc-timing.js:160-162). Whether usable "after Parting Blow before Stun" depends on timing window ordering — both are honor-system in async. |
| C3 | FAIL | Lure of the Dark Side: `chooseAdjacentHostileThen: { strain: 2 }` only applies 2 Strain. The "attack WITH that hostile figure" core mechanic is NOT implemented (see G25-G28). |
| C4 | PARTIAL | On the Lam timing `whenAttackDeclaredOnYou` — grants MP for movement. But bot does NOT auto-check LOS after defender moves. No automated LOS recheck found. |
| C5 | MANUAL | On the Lam + Return Fire timing interaction is honor-system. No code enforces ordering. |
| C6 | PASS | Son of Skywalker timing `afterActivationResolves` (cc-effects.json:1711). abilities.js:7662-7675 sets `game.sonOfSkywalkerActive`. activation.js:362-378 auto-readies Luke's DC. Timing allows playing after last figure goes. |
| C7 | PASS | Bot uses manual "End R{N} Activation Phase" button (activation.js:65-112). Round does NOT auto-end when deployments exhausted — `bothEnded` requires both players to click. |
| C8 | PASS | Adrenaline `cc:adrenaline` wired with `adrenalineEffect: true`. abilities.js applies +5 maxHp/curHp to each friendly WOOKIEE. round.js end-of-round reverts +5 maxHp and deals 5 Damage. Tracked via `game.adrenalineBonuses`. |
| C9 | PASS | Blaze of Glory timing `afterActivationResolves` (cc-effects.json:134), same as Son of Skywalker. `readyOwnDeploymentCard: true` + `endOfRoundSelfDamage: 3` (abilities.js:4792). round.js:223-236 applies self-damage at EOR. |
| C10 | MANUAL | Capitalize: `defensePoolRemoveMax: 1`. Whether defeated figure gains conditions from that attack is standard defeat logic — no Capitalize-specific code. Requires runtime check. |
| C11 | PARTIAL | Cloned Reinforcements uses `placeDefeatedFigure` (abilities.js:7971-8137). Places figure on board but does NOT explicitly set respawned group to Readied if entire group was defeated. |
| C12 | PARTIAL | Same handler. Reinforced figure inherits DC's exhausted state implicitly (per-DC not per-figure). Partially correct by structure but not explicitly coded. |
| C13 | PARTIAL | Comm Disruption (abilities.js:7425-7439): counts SPY groups, reports cancelable card cost. But no automatic interrupt/prompt system asks "play Comm Disruption?" each time opponent plays a card. |
| C14 | FAIL | `whenCommandCardPlayed` timing maps to `duringActivation` (cc-timing.js:196-198), requiring it to be YOUR activation. But Comm Disruption should be playable during OPPONENT's turn. **Timing bug**: card cannot be played at the correct time. |
| C15 | PARTIAL | Dirty Trick timing `whenHostileFigureEntersAdjacentSpace` maps to `ctx.duringActivation`. Trigger typically happens during OPPONENT's activation — no automated prompt when hostile moves past smuggler/hunter. Honor-system. |
| C16 | MANUAL | Parting Blow + Dirty Trick: both available during activation, player must choose. No automated conflict resolution. |
| C17 | PARTIAL | Evacuate (abilities.js:5882-5927): `Math.ceil(baseCost / 2)`. Uses base DC cost (no attachments). But does NOT do "half initial cost, then subtract attachment cost" — just halves base cost. |
| C18 | PASS | Final Stand timing `whenFriendlyFigureWithin3SpacesWouldBeDefeated`, playableBy `Baze Malbus`. Baze is within 0 spaces of himself. No code prevents self-targeting. |
| C19 | PARTIAL | Get Behind Me timing exists in cc-timing.js. But no dedicated handler found — complex mechanics (check small, cost ≤10, within 3, redirect attack) are not automated. |
| C20 | PARTIAL | Get Behind Me not automated (see C19). Defense pool card cancellation on target change not coded. |
| C21 | PARTIAL | Jundland Terror (abilities.js:5768-5798) has no "max 1 per EOR" enforcement — same issue as G37. |
| C22 | PARTIAL | Knowledge and Defense: defense die bonus works (abilities.js:4150-4165, adds black die). But passive redraw ("While in discard, FORCE USERS gain Surge: Re-draw") NOT implemented. |
| C23 | PARTIAL | Parting Blow timing `whenHostileFigureExitsAdjacentSpace` maps to `ctx.duringActivation`. No per-space movement tracking to trigger multiple checks. Honor-system. |
| C24 | PASS | Reduce to Rubble timing `afterYouResolveAttackThatDidNotMissDueToAccuracy`. A dodge is NOT missing due to accuracy, so card IS playable after dodge. |
| C25 | PARTIAL | Reinforcements timing `startOfRound`. Per-SOR limit depends on having only 1 copy — no explicit code enforces "max 1 per SOR." |
| C26 | PASS | Repair timing `duringActivation` (not `specialAction`). For Technicians, plays without consuming action slot. cc-effects.json text confirms. |
| C27 | PASS | Squad Swarm cost check at activation.js:565-566 uses `getDcStats().cost` which is base DC cost from dc-effects.json, excluding attachments. |
| C28 | PASS | Close and Personal only in cc-effects.json as CC. Not on Biv's DC. |
| C29 | PASS | Still Faster Than You: `game.stillFasterPlayerNum` set (abilities.js:7764). dc-play-area.js:224-233 checks at every activation start, shows interrupt prompt. Works during opponent's turn. |
| C30 | MANUAL | Support Specialist is `informational: true` only. No handler. Whether "action" includes special action is rules interpretation — not enforced in code. |
| C31 | MANUAL | Same — CC action inclusion is rules interpretation, not coded. |
| C32 | PASS | Vanish (abilities.js:5275-5285): `vanishImmunityUntilNextActivation: true` + `nextActivationMpBonus: 4`. Immunity + 4 MP at next activation. |
| C33 | PARTIAL | You Will Not Deny Me (index.js:2718-2727): prevent defeat, restore to 1 HP. Timing is `other` mapping to `ctx.duringActivation` — may not be active during combat resolution. Zillo interaction depends on correct timing window. |
| C34 | PASS | Combat.js:1445-1453 auto-prompts defender with all playable reaction cards (including `whenAttackDeclaredOnYou` cards like Ambush) when attack declared. Defender sees Ambush automatically if in hand. |
| C35 | PARTIAL | Arcing Shot timing `beforeYouDeclareAttack` for Drokkatta. Can be played (timing works). But targeting override (target figure adjacent to empty space in your LOS) not automated — honor-system. |
| C36 | PARTIAL | Bodyguard timing `whenAttackDeclaredOnAdjacentFriendly`. Grants MP and logs redirect. But actual attack target swap not automated in combat resolution. |
| C37 | PARTIAL | Built on Hope (abilities.js:5853-5877): top 3 cards, choose one for hand. Active effect works. But passive "when discarded from deck, re-draw it" NOT implemented. |
| C38 | PASS | Cal's Buddy (abilities.js:8140-8169): finds Cal's position, prompts adjacent space, places BD-1. |
| C39 | PARTIAL | Change of Plans (abilities.js:7364-7399): enumerates DC pairs with shared trait. But does NOT check "equal or lower Deployment cost" — only shared trait. Cost comparison missing entirely. |
| C40 | PARTIAL | Disarm: `chooseAdjacentHostileThen: { damage: 1, weaken: true }` — applies damage + Weakened. But "can't discard the Weakened" not enforced. No undiscardable flag. |
| C41 | PARTIAL | Same as C40 — Weakened applied as normal condition. Any ability can remove it. No permanent/undiscardable mechanism. |
| C42 | PARTIAL | Since Disarm's Weakened is a normal condition (no lock), Punishing Strike interaction cannot be properly enforced. |
| C43 | FAIL | Disengage timing maps to `ctx.duringActivation`. No per-square movement trigger. Bot does not prompt for Disengage on every square moved near Mak. |
| C44 | FAIL | Elusive has NO wired implementation. No handler in abilities.js. Entirely honor-system. |
| C45 | PASS | abilities.js:3181-3205 — Escalating Hostility counts copies in discard, adds to base 1 Strain. |
| C46 | PARTIAL | Extra Protection timing maps to `ctx.duringActivation`. No automated check whether friendly within 2 suffered 3+ damage. Honor-system. |
| C47 | PASS | abilities.js:5968-5993 — Ferocity scans CREATURE figures from BOTH players (`for (const pn of [1, 2])`). Opponent's creatures included. |
| C48 | PASS | Field Tactician (abilities.js:6608-6619) grants MP to any friendly within 2, which includes companions. |
| C49 | FAIL | abilities.js:6796-6822 — Force Push teleports figure directly (`figurePositions[targetPn][chosenFigureKey] = chosenSpace`). No path computed. Parting Blow cannot trigger since no intermediate spaces traversed. |
| C50 | PASS | abilities.js:5195-5200 — In the Shadows sets `game.roundInTheShadowsPlayerNum`. Round-scoped flag tracked and cleared per round. |
| C51 | PASS | cc-hand.js:598-614 — when ANY cost-0 CC played, bot sets `game.pendingNegation` and sends Negation buttons to opponent. Also in dc-play-area.js:719-735. |
| C52 | PARTIAL | Right Back At Ya at post-combat.js:104-136: checks Ahsoka Block Token, offers 1/3 damage. But fires as post-combat reaction, not "when attack declared" prompt. Not proactively asked before each attack on Ahsoka. |
| C53 | PARTIAL | Shared Experience: `mpCost: 3, applyFocus: true` — active effect works. But passive redraw "when friendly DROID/VEHICLE defeated" NOT implemented. |
| C54 | PARTIAL | abilities.js:2299-2334 — Smoke Grenade places token at `game.ancillaryTokens.smoke`. Token stored and rendered. But NO code in LOS calculations checks smoke as LOS-blocking. Token exists but not consulted during attacks. |
| C55 | PASS | Sniper Configuration: `rerollOneAttackDie: true` wired. abilities.js:4005-4008 handles `attackAccuracyBonus + attackBonusPierce`. LOS-from-friendly is honor-system but mechanical bonuses work. |
| C56 | PARTIAL | abilities.js:5248-5253 — Strength in Numbers sets flag and logs 12-cost cap. But cost check is entirely honor-system. No code verifies base group cost excluding attachments. |
| C57 | PARTIAL | abilities.js:4844-4875 — De Wanna Wanga active effect (choose from discard, shuffle into deck) works. But PASSIVE "once per round when discarded, may shuffle into deck" NOT implemented. |
| C58 | PARTIAL | abilities.js:6851-6884 — Devotion: identifies trait to search, shuffles deck, but does NOT programmatically search for and draw matching card. Tells player to search manually. |
| C59 | PASS | abilities.js:5996-6012 — Droid Mastery: finds J4X-7, applies Focus, grants free attack via `freeAttackBonusPending`. |
| C60 | PARTIAL | Element of Surprise: `defensePoolRemoveMax: 1` removes defense die when played. But "target did not have LOS to you at start of activation" check NOT enforced. |
| C61 | PASS | cc-timing.js:87-88 — `whenYouDeclareAttack` maps to `duringActivation` only. `duringActivation` requires `!game.endOfRoundWhoseTurn` (line 22-23). Cannot be used in SOR or EOR. |
| C62 | PARTIAL | Fool Me Once (abilities.js:2424-2454): clears discard, draws if SPY. But "Cost: 2 Strain" mentioned in card text is NOT enforced — no `selfStrain` field in ability-library entry. Strain not applied before draw. |
| C63 | PARTIAL | abilities.js:2430 — `game[discardKey] = []` deletes cards (empty array). Not tracked in separate "game box" collection. If game box needs to be queryable, this is incomplete. |
| C64 | PASS | data/map-spaces.json has `exterior` sections per map. data-loader.js:197-202 `isExteriorSpace()`. abilities.js:7694-7702 sets `game.harshEnvironmentActive`. |
| C65 | PARTIAL | abilities.js:7652-7659 — Opportunistic grants 3 MP to active DC's movement bank. Correctly banks during activation. But timing `afterHostileFigureSuffersDamage` maps ONLY to `duringActivation` — cannot be played outside activation. |
| C66 | FAIL | Opportunistic timing restricts to `duringActivation` only. The "not currently activating, must spend immediately" scenario CANNOT occur — card literally unplayable outside activation. |
| C67 | PASS | Parry timing `whileDefending` maps to `ctx.duringAttack && ctx.isDefender`. Shows as playable whenever defending, including modifiers phase. |
| C68 | PARTIAL | abilities.js:5289-5296 — Rebel Graffiti awards 2 VP. But passive "if Sabine, re-draw" NOT implemented. |
| C69 | PARTIAL | ability-library.json: Rest in Peace only has `{draw: 1}`. "Players cannot choose/play/re-draw from discard piles" enforcement NOT implemented. Just the EOR draw. |
| C70 | PASS | abilities.js:7242-7256 — Reverse Engineer sets `reverseEngineerActive`. combat.js:101-102: uses defender's surge abilities INSTEAD of attacker's. Cannot mix — always uses defender's when flag set. |
| C71 | FAIL | Self-Augmentation: `roundAttackRerollDice: 1` only. No code adds DROID to figure's keywords. `getDcKeywords()` loads static data. CCs checking DROID won't match. |
| C72 | FAIL | Same — no dynamic keyword addition. Other abilities checking DROID won't recognize the figure. |
| C73 | PASS | abilities.js:5078-5086 — Sit Tight sets `game.sitTightPlayerNum`. dc-play-area.js:79-85 blocks activation if `remaining <= oppRem`. Integrates with passing. |
| C74 | PARTIAL | Targeting Network: `rerollOneAttackDie: true` works. But passive "DROIDs gain Surge: Re-draw" NOT implemented. |
| C75 | PARTIAL | abilities.js:5203-5211 — To the Limit: grants extra action then Stunned. But does NOT restrict Move as the extra action, and does not implement "gain 4 MP then Stunned BEFORE spending." |
| C76 | FAIL | No `cannotGetHarmful` immunity check in To the Limit. Code unconditionally applies Stun. |
| C77 | PARTIAL | Urgency: `mpBonusFromSpeed: 2` adds Speed+2 MP to movement bank. But no "must spend all at once" enforcement — MP can be spent incrementally. |

---

## SUMMARY STATISTICS

| Section | PASS | PARTIAL | FAIL | MANUAL | N/A | Total |
|---|---|---|---|---|---|---|
| General Mechanics (G1-G113) | 65 | 24 | 24 | 0 | 0 | 113 |
| Rebel Deployment (R1-R95) | 65 | 12 | 15 | 3 | 0 | 95 |
| Mercenary Deployment (M1-M84) | 45 | 12 | 27 | 0 | 0 | 84 |
| Imperial Deployment (I1-I53) | 22 | 16 | 13 | 0 | 2 | 53 |
| Command Cards (C1-C77) | 24 | 37 | 10 | 6 | 0 | 77 |
| **TOTAL** | **221** | **101** | **89** | **9** | **2** | **422** |

**Definitive Pass Rate:** 221 / (221+101+89) = **53.8%**
**Pass + Partial:** 322 / 411 = **78.3%**
**Hard Failures:** 89 items require code changes
**Remaining MANUAL:** 9 items genuinely need runtime testing

---

## CRITICAL GAPS (Game-Breaking if Missing)

### Tier 1 — Core Rules Bugs
1. **G12** — No per-die reroll tracking (any die rerolled unlimited times)
2. **G22** — Conditions from surges applied even when damage = 0
3. **G25-G28 / C3** — Lure of the Dark Side hostile attack not implemented at all
4. **G34** — Ranged Cleave missing (affects TGI, I17, I18)
5. **G36** — Parting Blow can be used twice on same move
6. **G81** — <40 deployment points initiative not implemented
7. **I46** — Cross-Training die swap fires every defense, should be once per round

### Tier 2 — Figure-Breaking Gaps
8. **R28-R29** — Ahsoka Twin Sabers reroll restrictions absent
9. **R34-R36** — Kanan Jarrus group naming mechanic entirely missing
10. **M7-M10** — Rancor Voracious not implemented at all
11. **M13** — Krrstanan autofocus absent
12. **M19-M22** — Migs Mayfeld 3-token, Droid Arm, Return Fire all missing
13. **M34-M36** — Jabba Nefarious Gains + affiliation restrictions missing
14. **M62** — Bib Fortuna Illicit Arms not implemented
15. **I34** — Second Sister Saber Orbit not automated
16. **I37-I38** — Death Trooper Field Tactics + chain missing
17. **I51-I52** — Zillo Technique zero implementation
18. **R85** — Fury of Kashyyyk 3+ damage Focus trigger missing
19. **R88** — Heavy Fire ability entirely unimplemented

### Tier 3 — Skirmish Upgrades & CCs Missing
20. **M69-M70** — Beast Tamer SU not implemented
21. **M71-M73** — Black Market SU not implemented
22. **M75** — Devious Scheme SU not implemented
23. **M77** — Punishing Strike SU not implemented
24. **M79-M80** — Under Duress SU not implemented
25. **I48** — Imperial Retrofitting SU not implemented
26. **C49** — Force Push teleports (no path, no Parting Blow trigger)
28. **C54** — Smoke Grenade token not consulted in LOS
29. **C71-C72** — Self-Augmentation doesn't add DROID keyword

### Tier 4 — Passive Redraws & Timing Enforcement
30. **C14** — Comm Disruption timing bug (can't play during opponent's turn)
31. **C22** — Knowledge and Defense passive redraw missing
32. **C37** — Built on Hope passive redraw missing
33. **C53** — Shared Experience passive redraw missing
34. **C57** — De Wanna Wanga passive reshuffle missing
35. **C66** — Opportunistic can't be played outside activation
36. **C68** — Rebel Graffiti redraw missing
37. **C74** — Targeting Network passive redraw missing
38. **C69** — Rest in Peace discard-blocking not enforced

### Tier 5 — Companion System
39. **G39-G41** — Companion space sharing, entering, exiting play
40. **G47-G49** — Companion cost, interact restriction, CC play
41. **M53** — Ugnaught Junk Droids honor-system only
42. **M67** — Kuiil Hop On not implemented

### Tier 6 — Edge Cases & Polish
43. **G4** — Squad Swarm cost calculation bug (adds same card twice)
44. **G33** — Spire tile LOS
45. **G37** — Jundland Terror once per EOR not enforced
46. **G82** — Devious Scheme pre-initiative check
47. **G85** — Deployment zone overflow
48. **G102** — Zillo readied before EOR
49. **G104-G105** — Strain damage/discard choice not offered
50. **G109** — Initiative-dependent start-of-activation timing
51. **G111-G113** — Tiebreaker system incomplete
