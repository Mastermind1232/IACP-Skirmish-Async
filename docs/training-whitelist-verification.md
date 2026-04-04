# Training Whitelist Verification Document

**Generated:** 2026-04-03 | **Purpose:** Phase B of training-readiness plan
**Action required:** Compare every field below against actual IACP card text. Flag discrepancies.

---

## FLAGGED ISSUES (review these first)

### F1: Take Cover — "-2 Accuracy" vs "+2 Evade"
- **cc-effects.json says:** "apply +1 Block and **-2 Accuracy** to the results"
- **ability-library.json implements:** `roundDefenseBonusBlock: 1, roundDefenseBonusEvade: 2`
- **Engine behavior:** `roundDefenseBonusEvade` adds evade which cancels attacker surges (combat.js:4467). It does NOT subtract from accuracy.
- **Impact:** -2 Accuracy would cause ranged miss at extended range. +2 Evade cancels surges (damage, pierce, conditions). Completely different effects.
- **Verdict:** One of these is wrong. Check the actual card.

### F2: Deflection — "-2 Accuracy" vs "+2 Evade"
- **cc-effects.json says:** "Apply **-2 Accuracy** to the attack results"
- **ability-library.json implements:** `roundDefenseBonusEvade: 2`
- **Same issue as F1.** Check the actual card.

### F3: 3 Unplayable CCs in Training Decks
These CCs are in training deck CC lists but cannot be played by any DC in the training whitelist:

| CC | playableBy | Why unplayable |
|---|---|---|
| **Burst Fire** | "Fenn Signis" | No Fenn Signis in whitelist |
| **Hunt Them Down** | "The Grand Inquisitor" | No Grand Inquisitor in whitelist |
| **Lock On** | "HEAVY WEAPON" | No HEAVY WEAPON keyword DCs in whitelist |

These are dead cards that will sit in hands. Not a rules error (holding unplayable CCs is legal), but the AI learns around 3 dead slots per affected deck.

- **Burst Fire** is in the Rebels deck
- **Hunt Them Down** is in the Scum deck
- **Lock On** is in all 3 decks

**Decision needed:** Accept dead cards, or swap them for playable alternatives?

### F4: Wookiee Rage playableBy Spelling
- **cc-effects.json:** `"playableBy": "WOOKIE"` (single-e)
- **Wookiee Warrior keyword:** `"WOOKIEE"` (double-e)
- **Currently works** via name-substring match in `cc-timing.js:290` (`"wookiee warrior".includes("wookie")` → true). Fragile but functional.
- **Not a training blocker** but worth fixing for correctness.

### F5: Stormtrooper (Elite) "Last Stand" — No specialAbilityId
- Listed in `passives` array but NOT in `specialAbilityIds`
- **IS implemented** via passives check in `combat-bridge.js:1004` — when defeated, another figure in the group becomes Focused
- **Verify text:** "When you are defeated, choose another figure in your group. That figure becomes Focused."

### F6: Nexu (Elite) "Non-Sentient" — No specialAbilityId
- Listed in `abilityText` but NOT in `specialAbilityIds`
- **IS implemented** via text-matching in `available-actions.js:776`, `dc-play-area.js:1791`, `components.js:933`
- **Verify text:** "Non-Sentient: You cannot interact."

---

## DEPLOYMENT CARDS (7)

### 1. Luke Skywalker — Hero of the Rebellion

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 7 | |
| Health | 10 | |
| Speed | 5 | |
| Figures | 1 | |
| Elite | Yes | |
| Unique | Yes | |
| Affiliation | Rebel | |
| Keywords | FORCE USER | |
| Attack Dice | Blue, Green, Yellow | |
| Attack Type | Ranged | |
| Defense Dice | White | |
| Passives | Block 1 | |
| Surge: +2 Hits | 1 surge | |
| Surge: Recover 2 | 1 surge | |
| Surge: +2 Accuracy | 1 surge | |

**Abilities:**
- **Saber Strike** (specialAction): Perform a melee attack using 1 Red and 1 Yellow die. Attack gains Pierce 3.
  - Implementation: `overrideAttackDice: ["red","yellow"], overrideAttackType: "melee", overrideAttackPierce: 3, freeAttackBonus: true`
- **Inspiring** (passive-reactive, combat-dice): While another friendly figure within 3 spaces is attacking, it may reroll 1 die.
  - Implementation: wired

### 2. Wookiee Warrior (Elite)

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 9 (sub: 5) | |
| Health | 13 | |
| Speed | 4 | |
| Figures | 2 | |
| Elite | Yes | |
| Affiliation | Rebel | |
| Keywords | BRAWLER, WOOKIEE | |
| Attack Dice | Red, Green | |
| Attack Type | Melee | |
| Defense Dice | Black | |
| Surge: +2 Hits | 1 surge | |
| Surge: Bleed | 1 surge | |
| Surge: Cleave 2 | 1 surge | |

**Abilities:**
- **Fury** (passive-auto, combat-dice): While attacking, if you have suffered 5 or more Damage, apply +1 Surge to the attack results.
  - Implementation: wired

### 3. Darth Vader — Lord of the Sith

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 18 | |
| Health | 16 | |
| Speed | 4 | |
| Figures | 1 | |
| Elite | Yes | |
| Unique | Yes | |
| Affiliation | Imperial | |
| Keywords | FORCE USER, LEADER, BRAWLER | |
| Attack Dice | Red, Red, Yellow | |
| Attack Type | Melee | |
| Defense Dice | Black, Black | |
| Surge: +2 Hits | 1 surge | |
| Surge: Pierce 3 | 1 surge | |

**Abilities:**
- **Force Choke** (specialAction): Choose a hostile figure in your LOS. That figure suffers 2 Damage and 1 Strain.
  - Implementation: `targetHostileFigure: { damage: 2, strain: 1, requiresLos: true }`
- **Brutality** (specialAction): Perform 2 attacks. Each attack must have a different target.
  - Implementation: `freeAttackBonus: true, freeAttackBonusCount: 2`
- **Foresight** (passive-reactive, combat-dice): While defending, you may reroll 1 defense die.
  - Implementation: wired

### 4. Emperor Palpatine — Sith Master

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 8 | |
| Health | 13 | |
| Speed | 3 | |
| Figures | 1 | |
| Elite | Yes | |
| Unique | Yes | |
| Affiliation | Imperial | |
| Keywords | FORCE USER, LEADER | |
| Attack Dice | Red, Green | |
| Attack Type | Melee | |
| Defense Dice | Black | |
| Passives | Pierce 3 | |
| Surge: +1 Hit | 1 surge | |

**Abilities:**
- **Force Lightning** (DC specialAction): Choose a figure within 4 spaces and LOS. That figure suffers 3 Damage and becomes Weakened. Each figure adjacent to that figure suffers 1 Damage.
  - Implementation: `targetHostileFigure: { damage: 3, strain: 0, applyCondition: "Weaken", range: 4, requiresLos: true, splashDamage: 1 }`
- **Emperor** (active, activation): Choose a friendly figure within 4 spaces. That figure may interrupt to perform an attack.
  - Implementation: wired
- **Tempt** (active, activation): Choose any figure within 4 spaces. That figure suffers 1 Damage and gains 1 Hit Token.
  - Implementation: wired

### 5. Stormtrooper (Elite)

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 7 (sub: 3) | |
| Health | 5 | |
| Speed | 4 | |
| Figures | 3 | |
| Elite | Yes | |
| Affiliation | Imperial | |
| Keywords | TROOPER | |
| Attack Dice | Blue, Green | |
| Attack Type | Ranged | |
| Defense Dice | Black | |
| Passives | Last Stand (see F5) | |
| Surge: +3 Accuracy | 1 surge | |
| Surge: +2 Hits | 1 surge | |

**Abilities:**
- **Squad Training** (passive): While attacking, while adjacent to another friendly TROOPER, you may reroll 1 attack die.
  - Implementation: wired
- **Last Stand** (passive — see F5): When you are defeated, choose another figure in your group. That figure becomes Focused.
  - Implementation: via passives check in combat-bridge

### 6. Boba Fett — Infamous Bounty Hunter

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 13 | |
| Health | 14 | |
| Speed | 6 | |
| Figures | 1 | |
| Elite | Yes | |
| Unique | Yes | |
| Affiliation | Scum | |
| Keywords | HUNTER, VEHICLE, MOBILE | |
| Attack Dice | Blue, Green, Green | |
| Attack Type | Ranged | |
| Defense Dice | Black | |
| Passives | Block 1, +1 Evade | |
| Surge: Pierce 1 | 1 surge | |
| Surge: +2 Hits | 1 surge | |

**Abilities:**
- **Wrist Cord** (specialAction): Spend 2 MP to push a SMALL figure within 3 spaces (LOS) to a space adjacent to you.
  - Implementation: `mpCostToActivate: 2, pushTargetWithinRange: { range: 3, requiresSmall: true, requiresLos: true }`
- **Wrist Flamethrower** (active, once per activation): Spend 2 MP. Choose a space within 2 spaces. Each figure on or adjacent suffers 1 Damage + 1 Strain + becomes Weakened.
  - Implementation: `fixedAreaEffect: true, fixedAreaRange: 2, fixedAreaDamage: 1, fixedAreaStrain: 1, fixedAreaConditions: ["Weaken"], mpCost: 2`
- **EE-3 Carbine** (passive-reactive, combat-declare, once per attack): When you declare an attack, spend 2 MP to change one attack die to a red die.
  - Implementation: wired

### 7. Nexu (Elite)

| Field | Repo Value | Verify |
|---|---|---|
| Cost | 5 | |
| Health | 8 | |
| Speed | 6 | |
| Figures | 1 | |
| Elite | Yes | |
| Affiliation | Scum | |
| Keywords | CREATURE, BRAWLER | |
| Attack Dice | Green, Red | |
| Attack Type | Melee | |
| Defense Dice | White | |
| Passives | Mobile, Bleed, Cleave 2 | |
| Surge: +2 Hits | 1 surge | |

**Abilities:**
- **Pounce** (specialAction): Place your figure in an empty space within 3 spaces. Then, you may perform an attack (free).
  - Implementation: `pounceRange: 3`
- **Cunning** (passive-auto, when-targeted): While defending, apply +1 Block for each Evade result.
  - Implementation: wired (also hardcoded in combat.js damage formula)
- **Non-Sentient** (see F6): You cannot interact.
  - Implementation: via abilityText text-matching

---

## COMMAND CARDS (20)

### Playability Matrix (which DCs can play each CC)

| CC | playableBy | Playable by (training DCs) |
|---|---|---|
| Burst Fire | Fenn Signis | **NONE** (F3) |
| Concentrated Fire | Any Figure (needs TROOPER trigger) | All (trigger: Stormtrooper attacking) |
| Covering Fire | Any Figure (applies to TROOPERs) | All (benefits Stormtrooper only) |
| Deadeye | Any Figure | All |
| Deflection | FORCE USER | Luke, Vader, Palpatine |
| Dirty Trick | SMUGGLER or HUNTER | Boba Fett |
| Disorient | Any Figure | All |
| Element of Surprise | Any Figure | All |
| Focus | Any Figure | All |
| Force Lightning (CC) | IMPERIAL FORCE USER | Vader, Palpatine |
| Force Push | FORCE USER | Luke, Vader, Palpatine |
| Hunt Them Down | The Grand Inquisitor | **NONE** (F3) |
| Lock On | HEAVY WEAPON | **NONE** (F3) |
| Lure of the Dark Side | FORCE USER | Luke, Vader, Palpatine |
| Marksman | Any Figure | All |
| Ready Weapons | TROOPER or GUARDIAN | Stormtrooper |
| Take Cover | Any Figure | All |
| Take Initiative | Any Figure | All |
| Urgency | Any Figure | All |
| Wookiee Rage | WOOKIE (see F4) | Wookiee Warrior |

### CC Detail

**1. Burst Fire** (cost 2, Fenn Signis only)
- Timing: specialAction
- Effect: Perform an attack. If target suffers 1+ Damage, each figure adjacent to target space is Stunned.
- Implementation: `freeAttackBonus: true` + auto-Stun adjacent on damage

**2. Concentrated Fire** (cost 1, Any Figure)
- Timing: whenAnotherFriendlyTrooperDeclaresAttackTargetingInYourLineOfSight
- Effect: If you have Ranged attack type, add 1 red die to the attack pool. You become Stunned.
- Implementation: `attackBonusDice: 1, attackBonusDiceColor: "red", applySelfStunAfterAttack: true`

**3. Covering Fire** (cost 3, Any Figure)
- Timing: startOfRound
- Effect: Up to 3 friendly TROOPERs become Hidden. During this round, each TROOPER gains Surge: Stun (if already Stunned, +2 Hits instead).
- Implementation: `applyHide: true`

**4. Deadeye** (cost 0, Any Figure)
- Timing: duringAttack
- Effect: Apply +2 Accuracy to attack results.
- Implementation: `attackAccuracyBonus: 2`

**5. Deflection** (cost 1, FORCE USER) — **SEE F2**
- Timing: whenAttackDeclaredOnYou (Ranged only)
- cc-effects text: "Apply -2 Accuracy to the attack results. After attack resolves, if you took no Damage, attacker suffers 2 Damage."
- Implementation: `roundDefenseBonusEvade: 2, deflectionCounterDamage: 2`
- **Discrepancy: -2 Accuracy ≠ +2 Evade. Check actual card.**

**6. Dirty Trick** (cost 2, SMUGGLER or HUNTER)
- Timing: whenHostileFigureEntersAdjacentSpace
- Effect: That figure must choose: suffer 3 Strain OR become Stunned.
- Implementation: `chooseAdjacentHostileThen: { strain: 3, orStunInstead: true }`

**7. Disorient** (cost 0, Any Figure)
- Timing: afterDamage
- Effect: After a hostile figure with a BENEFICIAL condition suffers Damage, discard 1 BENEFICIAL condition. Then, that figure suffers 2 Strain.
- Implementation: `chooseAdjacentHostileThen: { strain: 2, requireBeneficialCondition: true, discardBeneficialCondition: true }`

**8. Element of Surprise** (cost 0, Any Figure)
- Timing: whenYouDeclareAttack
- Effect: If target had no LOS to you at start of your activation, remove 1 die from its defense pool.
- Implementation: `defensePoolRemoveMax: 1, requireNoLosAtActivationStart: true`

**9. Focus** (cost 1, Any Figure)
- Timing: specialAction
- Effect: You become Focused.
- Implementation: `applyFocus: true`

**10. Force Lightning (CC)** (cost 3, IMPERIAL FORCE USER)
- Timing: specialAction
- Effect: Choose a hostile figure within 2 spaces and LOS. That figure and each adjacent figure suffers 2 Damage and becomes Stunned.
- Implementation: `chooseAdjacentHostileThen: { damage: 2, stun: true, splashDamage: 2, splashConditions: ["Stun"], range: 2 }`
- **Note:** Different from Palpatine's DC Force Lightning ability (4 range, 3 dmg, Weaken, 1 splash)

**11. Force Push** (cost 1, FORCE USER)
- Timing: duringActivation
- Effect: Choose another SMALL figure within 3 spaces. Push that figure up to 2 spaces.
- Implementation: `forcePushEffect: true`

**12. Hunt Them Down** (cost 2, The Grand Inquisitor only)
- Timing: whenYouDeclareLightsaberThrow
- Effect: +2 Accuracy, attack gains Cleave 2.
- Implementation: `attackAccuracyBonus: 2, attackBonusSurgeAbilities: ["cleave 2"]`

**13. Lock On** (cost 2, HEAVY WEAPON)
- Timing: duringAttack
- Effect: Apply +3 Accuracy, or -1 Dodge, or -1 Evade to the results.
- Implementation: `attackAccuracyBonus: 3` (only +3 Accuracy option implemented?)
- **Verify:** Does the actual card offer a choice? Is only +3 Accuracy used?

**14. Lure of the Dark Side** (cost 3, FORCE USER)
- Timing: specialAction
- Effect: Choose a hostile figure in LOS. That figure gains +2 Hit Tokens, then perform an attack with that figure against a target within 4 spaces. Then, chosen figure suffers 2 Strain.
- Implementation: `lureOfTheDarkSide: true`

**15. Marksman** (cost 1, Any Figure)
- Timing: beforeDeclaringRangedAttack
- Effect: Figures do not block LOS for this attack.
- Implementation: `nextAttackIgnoreFigureLOS: true`

**16. Ready Weapons** (cost 0, TROOPER or GUARDIAN)
- Timing: specialAction
- Effect: Distribute 3 Hit Tokens among figures in your group.
- Implementation: `powerTokenGainToGroup: 3`

**17. Take Cover** (cost 0, Any Figure) — **SEE F1**
- Timing: specialAction
- cc-effects text: "During this round, while defending, apply +1 Block and -2 Accuracy to the results."
- Implementation: `roundDefenseBonusBlock: 1, roundDefenseBonusEvade: 2`
- **Discrepancy: -2 Accuracy ≠ +2 Evade. Check actual card.**

**18. Take Initiative** (cost 0, Any Figure)
- Timing: startOfRound
- Effect: Claim the initiative token. Then exhaust 1 of your Deployment cards.
- Implementation: `claimInitiative: true, exhaustOneDeploymentCard: true`

**19. Urgency** (cost 0, Any Figure)
- Timing: specialAction
- Effect: Gain movement points equal to your Speed +2.
- Implementation: `mpBonusFromSpeed: 2, mustSpendAll: true`

**20. Wookiee Rage** (cost 2, WOOKIE) — **SEE F4**
- Timing: specialAction
- Effect: Choose up to 3 hostile figures adjacent to you. Each suffers 1 Damage per Damage you've suffered, max 3.
- Implementation: `chooseAdjacentHostileThen: { damage: 3 }`
- **Note:** No `abilityId` in cc-effects.json (resolved by name match to ability-library)
- **Verify:** Implementation says flat 3 damage. Card says "1 per Damage suffered, max 3." Is the variable scaling implemented or hardcoded to max?

---

## THINGS I CANNOT VERIFY FROM REPO DATA ALONE

1. **All stat values** (cost, health, speed, figures, dice, surge tables) — I extracted what the repo has, but cannot confirm these match actual IACP card text. The Neurostim precedent (confirmed wrong data in ability-library.json) means we cannot trust repo data at face value.

2. **F1/F2: Take Cover and Deflection accuracy vs evade** — need actual card text to determine which is correct.

3. **F3: Whether dead CCs in training decks are acceptable** — design decision, not a data question.

4. **Wookiee Rage damage scaling** — implementation may be hardcoded to max 3 rather than scaling with damage suffered. Need card text + implementation trace to confirm.

5. **Palpatine "Tempt" range** — abilityText says "within 4 spaces" but ability-library entry doesn't have an explicit range field. Need to verify the range is enforced in the wired implementation.

6. **Palpatine "Emperor" interrupt** — complex mechanic (interrupt another figure's activation to attack). Need card text to verify the implementation matches.

7. **Lock On choice** — card offers 3 options (+3 Acc, -1 Dodge, -1 Evade). Implementation only shows `attackAccuracyBonus: 3`. Are the other options implemented? (Moot for training since Lock On is unplayable, but worth noting.)

8. **Covering Fire Surge: Stun bonus** — card says "each TROOPER gains Surge: Stun. If target was already Stunned, +2 Hits instead." Is the conditional +2 Hits implemented?

9. **Any IACP-specific modifications** to these cards vs the original FFG versions. If IACP changed stats/abilities, the repo data may reflect FFG originals rather than IACP versions (or vice versa).
