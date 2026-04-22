# Pending-State Inventory

Every `pending*` and `_`-prefixed field on the JS game object, with trigger source,
resolution path, and the deliverable that ports it to Python.

Inventory derived from `_field_inventory.txt` (category = `pending`). 111 entries total:
104 `pending*` + 7 internal `_`-prefixed staging vars.

## Categorization

- **D3 Pattern E** — one of the 20 dedicated ability-chain parity tests (E.1–E.20).
- **D3 general** — resolves through the ability-dispatch registry; no dedicated test.
- **D4** — resolves through DC activation or CC timing systems.
- **D5** — resolves at round boundaries (SoR, EoR).
- **D2** — resolves inside mechanics (combat, movement, displacement).
- **internal** — transient staging var; not persisted across game steps.

The `Deliverable` column names the owning deliverable; the `Resolution` column
names the code path in the JS engine that clears the field.

| Field | Trigger source | Resolution path | Deliverable |
|---|---|---|---|
| _closeQuartersBonusAcc | combat pre-attack apply (Close Quarters) | consumed during recalcAttackTotals | internal |
| _closeQuartersRemoveDefDie | combat pre-attack apply (Close Quarters) | consumed during recalcDefenseTotals | internal |
| _lffPendingTokenFigureKey | LFF surge resolution staging | consumed during LFF token apply | internal |
| _pendingBlockSurgeAbilities | combat surge menu staging | consumed during combat surge select | internal |
| _pendingStatusPhaseLog | status-phase log staging | flushed during round end | internal |
| _postDeployMoveDeferred | post-deploy move staging (Smooth Landing) | consumed during post-deploy queue | internal |
| _wookieeRageTargets | Wookiee Rage target staging | consumed during chain resolution | D3 Pattern E (E.8) |
| pendingAssassinsBlade | Assassin's Blade CC play | resolved in CC chain | D3 Pattern E |
| pendingAttachConfirm | DC attachment flow | resolved in attachment phase | D4 |
| pendingAwr | AWR CC play | resolved in CC chain | D3 Pattern E |
| pendingBELReorder | Battlefield Leadership reorder | resolved in E.17 | D3 Pattern E (E.17) |
| pendingBattlefieldLeadership | Battlefield Leadership CC trigger | resolved in E.17 | D3 Pattern E (E.17) |
| pendingBlackMarket | Black Market CC play | resolved in CC chain | D3 Pattern E |
| pendingBoRifle | Bo-Rifle weapon choice | resolved in weapon-choice chain | D3 Pattern E |
| pendingBoltslinger | Boltslinger CC play | resolved in CC chain | D3 Pattern E |
| pendingBombDrop | Bomb Drop ability | resolved via bomb_drop_space action | D3 Pattern E |
| pendingBombardmentSorin | Sorin Bombardment | resolved via pick-space | D3 Pattern E |
| pendingCcAttachment | CC attachment to DC | resolved in attachment phase | D4 |
| pendingCcChoice | CC choice prompt | resolved via cc_choice action | D4 |
| pendingCcConfirmation | CC play confirmation prompt | resolved via cc_confirm_play / cc_cancel_play | D4 |
| pendingCcSpaceChoice | CC space choice prompt | resolved via cc_space action | D4 |
| pendingCelebration | Celebration CC play | resolved via celebration_play/pass | D4 |
| pendingChannelTheForceStrain | Channel The Force strain choice | resolved via strain_choice action | D3 Pattern E |
| pendingCleave | Cleave surge ability | resolved in surge chain | D3 general |
| pendingCombat | In-flight combat resolution | resolved via combat_resolve | D2 |
| pendingCombatResupply | Combat Resupply CC | resolved in CC chain | D3 Pattern E |
| pendingCommDisruptionPrompt | Comm Disruption CC | resolved via comm_disruption_play/skip | D4 |
| pendingConcussiveBolt | Concussive Bolt ability | resolved in ability chain | D3 general |
| pendingConspire | Conspire CC | resolved in CC chain | D3 Pattern E |
| pendingCoordinatedRaid | Coordinated Raid CC | resolved in CC chain | D3 Pattern E |
| pendingCoverFire | Cover Fire CC interrupt | resolved via cover_fire_block/skip | D3 Pattern D (triggered event) |
| pendingDcAbilityChoice | DC ability choice prompt | resolved via dc_ability_choice action | D3 general |
| pendingDeflect | Deflect CC defensive react | resolved in CC react chain | D3 general |
| pendingDeployOrientation | Multi-cell figure deploy rotation | resolved in deployment phase | D4 |
| pendingDioFollow | Dio companion follow trigger | resolved in movement trigger | D3 Pattern D |
| pendingDoorSelections | Door open/close selection | resolved in interact flow | D5 (mission interact) |
| pendingEe3Carbine | EE3 carbine dice choice | resolved in weapon-choice chain | D3 Pattern E |
| pendingEmperorInterrupt | Emperor's Trap interrupt | resolved in E.13 | D3 Pattern E (E.13) |
| pendingEndTurn | End-turn prompt | resolved via end_turn action | D4 |
| pendingExecutiveOrder | Executive Order issuance | resolved in E.14 | D3 Pattern E (E.14) |
| pendingExecutorInterrupt | Executor interrupt | resolved in CC react chain | D3 general |
| pendingExtraProtection | Extra Protection CC defensive | resolved in CC react chain | D3 general |
| pendingFalseOrders | False Orders CC | resolved via false_orders_action_* | D3 Pattern E |
| pendingFieldTactics | Field Tactics CC | resolved in CC chain | D3 Pattern E |
| pendingFightingKnife | Fighting Knife ability | resolved in ability chain | D3 general |
| pendingFigurehead | Figurehead passive trigger | resolved during activation | D3 Pattern C |
| pendingFiringSquad | Firing Squad chained attack | resolved in E.19 | D3 Pattern E (E.19) |
| pendingFluctuationSwapFirst | Fluctuation displacement start | resolved in E.2 | D3 Pattern E (E.2) |
| pendingFluctuationSwapQueue | Fluctuation displacement queue | resolved in E.2 | D3 Pattern E (E.2) |
| pendingForceExhaustion | Force Exhaustion strain trigger | resolved in ability chain | D3 general |
| pendingGeneralsOrders | General's Orders CC | resolved in CC chain | D3 Pattern E |
| pendingHavocShot | Havoc Shot multi-target | resolved in E.4 | D3 Pattern E (E.4) |
| pendingHeavyFire | Heavy Fire ability | resolved in ability chain | D3 general |
| pendingHeroicEffortReturn | Heroic Effort card return | resolved in E.18 | D3 Pattern E (E.18) |
| pendingHunterProtocol | Hunter Protocol CC | resolved in CC chain | D3 Pattern E |
| pendingIKnowEverything | I Know Everything CC | resolved in CC chain | D3 Pattern E |
| pendingIllegalCcPlay | Illegal CC play guard | resolved in validation | D4 |
| pendingIllicitArms | Illicit Arms CC | resolved in CC chain | D3 Pattern E |
| pendingIndiscriminateFire | Indiscriminate Fire ability | resolved in ability chain | D3 general |
| pendingInterrogate | Interrogate ability | resolved in ability chain | D3 general |
| pendingItWillBeAlright | "It Will Be Alright" CC | resolved in CC chain | D3 Pattern E |
| pendingKryknaPushQueue | Krykna placement / push queue | resolved in E.3 | D3 Pattern E (E.3) |
| pendingLastResort | Last Resort CC | resolved in CC chain | D3 Pattern E |
| pendingLieInAmbush | Lie in Ambush interrupt | resolved in E.6 | D3 Pattern E (E.6) |
| pendingLoadoutSelection | Loadout card selection | resolved in attachment phase | D4 |
| pendingLure | Lure CC | resolved in CC chain | D3 Pattern E |
| pendingMassivePush | Massive-push multi-figure displacement | resolved in displacement queue | D2 |
| pendingMastery | Mastery ability | resolved in ability chain | D3 general |
| pendingMissileSalvo | Missile Salvo multi-die | resolved via missile_salvo_die/done | D3 Pattern E |
| pendingMissionSorReveal | Mission SoR reveal | resolved at SoR | D5 |
| pendingMotivation | Motivation CC | resolved in CC chain | D3 Pattern E |
| pendingMpBonus | Movement bonus grant | consumed on activation | D4 |
| pendingMultiTargetRoll | Multi-target dice roll staging | resolved in combat chain | D2 |
| pendingNegation | Negation CC react | resolved in E.10 | D3 Pattern E (E.10) |
| pendingOrbitalBombardment | Orbital Bombardment CC | resolved via ob_space action | D3 Pattern E |
| pendingOrderedMove | Ordered Move CC | resolved in CC chain | D3 Pattern E |
| pendingOverrideAttackDice | Pre-attack dice override (e.g. Bo-Rifle) | consumed in rollAttackDice path | D2 |
| pendingOverwatchPlacement | Overwatch space placement | resolved via overwatch_space action | D3 Pattern D |
| pendingPostAttackConditions | Post-attack condition apply queue | resolved after combat_resolve | D2 |
| pendingPounceSpaceChoice | Pounce target space choice | resolved via pounce_space action | D3 Pattern E |
| pendingPowerConverter | Power Converter ability | resolved in ability chain | D3 general |
| pendingPowerTokenGrant | Power token grant prompt | resolved via power_token_choice | D2 |
| pendingPowerTokenOverflow | Power token overflow (>3 stack) | resolved via pt_overflow action | D2 |
| pendingPunishingStrike | Punishing Strike ability | resolved in ability chain | D3 general |
| pendingReaction | Generic combat reaction prompt | resolved in reaction chain | D3 Pattern D |
| pendingRightBackAtYa | Right Back At Ya CC | resolved in CC react chain | D3 general |
| pendingRogueOneTokenPick | Rogue One token pick | resolved via power_token_choice | D3 general |
| pendingRushPush | Rush push sub-chain | resolved via rush_push_fig/skip | D3 Pattern E |
| pendingScavengedWeaponryTransfer | Scavenged Weaponry transfer | resolved in CC chain | D3 Pattern E |
| pendingSelfDestruct | Self Destruct ability | resolved at EoR or defeat | D3 general |
| pendingShoulderRush | Shoulder Rush sub-chain | resolved via shoulder_rush_fig/skip | D3 Pattern E |
| pendingSlowOnTheDraw | Slow on the Draw CC | resolved in CC chain | D3 general |
| pendingSorActions | SoR action queue | resolved during SoR sequencing | D5 |
| pendingSpacePick | Generic space-pick prompt | resolved via space selection action | D3 general |
| pendingSpreadThePain | Spread the Pain CC | resolved via spread_pain_cond | D3 Pattern E |
| pendingSpreadThePainCondPick | Spread the Pain condition pick | resolved via spread_pain_cond | D3 Pattern E |
| pendingStartOfRoundResolve | SoR DC-effect queue | resolved during SoR sequencing | D5 |
| pendingStillFaster | Still Faster CC | resolved in CC chain | D3 Pattern E |
| pendingStrainChoice | Strain-or-discard prompt | resolved via strain_choice_alldmg/discard | D3 general |
| pendingStrikeMeDown | Strike Me Down ability | resolved in ability chain | D3 general |
| pendingSuppressiveFireMp | Suppressive Fire MP cost staging | consumed during movement | D3 general |
| pendingSurgeOverflow | Unresolved surge pool | consumed in surge select | D2 |
| pendingThereIsNoTry | There Is No Try attach-and-attack | resolved in E.12 | D3 Pattern E (E.12) |
| pendingTokenDistribution | Generic token distribution prompt | resolved via token_distribution actions | D3 general |
| pendingToughLuck | Tough Luck CC | resolved in CC chain | D3 Pattern E |
| pendingTrustedAlly | Trusted Ally CC | resolved in CC chain | D3 Pattern E |
| pendingVoracious | Voracious ability | resolved in ability chain | D3 general |
| pendingWantonDestruction | Wanton Destruction CC | resolved in CC chain | D3 Pattern E |
| pendingWookSlamPush | Wookiee Slam push sub-chain | resolved in displacement queue | D2 |
| pendingYHSIW | YHSIW multi-figure condition choice | resolved in E.9 | D3 Pattern E (E.9) |
| pendingZilloDiscard | Zillo discard prompt | resolved via CC discard | D3 Pattern E |

## Coverage summary

- 7 internal staging vars — not persisted across game steps; Python equivalents
  live as function locals, not `GameState` fields.
- 15 entries route to D3 Pattern E (E.1–E.20 dedicated chains).
- 59 entries route to D3 general (ability-dispatch registry).
- 13 entries route to D4 (activation / CC timing).
- 4 entries route to D5 (mission / round-boundary).
- 7 entries route to D2 (combat / displacement mechanics).

Every entry has an owning deliverable. When a pending field is ported, check
this row off — D3.27 ("remaining pending-state chains") iterates this inventory
until every row is covered.
