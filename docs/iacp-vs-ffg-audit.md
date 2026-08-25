# FFG vs IACP card audit

alexanbv 2026-08-18: "audit FFG vs IACP for all DC and CC".

The failure mode being hunted: our card data holds the superseded **FFG** text for
a card that IACP reissued. Disable was the known instance, and it held the FFG
card outright.

This file is the running record. It exists because the audit is roughly 580 cards
and will not fit in one session.

## Ground truth

The card images in `vassal_extracted/images/`. Directories in scope:

| directory | images |
|---|---|
| `cc` | 304 |
| `dc-figures` | 182 |
| `DC Skirmish Upgrades` | 60 |
| `companions` | 15-22 |
| `dc-supplemental` | 10 |

## Scoping: filenames are NOT the index

The obvious approach, grepping filenames for `IACP`, finds **50** cards and is
wrong. alexanbv flagged it: "there are WAY more than 50 cards with an IACP mark."

Detecting the IACP roundel by pixel instead, on Command Cards where the card
layout is uniform, finds **91 of 304** marked, against 25 whose filename says so.
**Filenames catch about a quarter.** The 66 marked-but-unnamed CCs are listed
below and are the never-checked set.

That detector does NOT generalise to Deployment Cards: their art is full of reds,
the roundel sits mid-right rather than bottom-right, and retuning it made it drop
cards known to be IACP (Ahsoka, Moff Gideon, Paz Vizsla, Tauntaun Rider). A
classifier that silently mislabels is worse than none, so **do not pre-filter DCs
by mark**. Compare every card against its image; drift is drift either way.

## Ground truth rule (RESOLVED, alexanbv 2026-08-19)

> "for MOST cards the latest playtest image is the correct one, EXCEPT for the
>  ones that I indicated in previous conversations have been changed since."

So: **the latest playtest image wins**, except for the cards listed below, where
alexanbv's stated text supersedes the printed card.

This matters more than it looks. For the exception cards the IMAGE IS WRONG.
"Correcting" our data to match the image would REGRESS them, turning a correct
implementation into a defect. Check this list before touching any card.

Only 6 CC cards have more than one image (Assassinate, Cavalry Charge, Covering
Fire, Expose Weakness, Stimulants, Wookiee Rage); for the rest the single image
present is the latest. Printings in the module span `IACP Approved`, `Season
5/5.1/11/12` and `10.0/10.1/11.1/12.0 Playtest`.

### Exception list: cards changed AFTER their image

**All 12 verified as already implemented correctly (2026-08-19). No action
needed on any of them, and none should be "corrected" toward their image.**

Recovered from channel history (2026-06-21, 2026-06-22). alexanbv at the time:
"Mark that these cards have been changed and do not match the previous text."

| card | the change | implemented? |
|---|---|---|
| Bo-Katan Kryze | Beskar Armor: gain 2 Block Tokens after deployment. Bonus once-per-round Ranged attack grants 2 Block Tokens BEFORE it, replacing 1 token after each attack | YES, verified |
| Dioxis Fumes | flat 1 Strain, not a yellow die roll | YES, verified |
| Rebel Trooper (Elite) | reverted. Aim as on regulars, tracked per figure at the start of its OWN activation. New "Get Ready". "Get into Position" is a Double Action: move up to 4 and become Focused. Cost 7/3. Surge +3 Acc; surge +1 Damage, Pierce 1 | YES, verified. All three abilities and both surges present, cost 7 |
| CT-1701 | Cover Fire is now Limit Once Per Round | YES, verified |
| Leia Organa | Military Efficiency is now a SURGE ability, still resolving after the attack | YES, verified. Tagged `Military Efficiency (Surge)` and present in `surgeAbilities` |
| Get Behind Me! | limited to a GUARDIAN or a MELEE Rebel FORCE USER | YES, verified. `abilities.js:5422` gates on GUARDIAN or (FORCE USER and Rebel and melee attack type) and cites the 2026-06-21 ruling. The looser `playableBy` string is not the gate |
| Bantha Rider | Wild Beast: limit once per activation AND once per status phase | YES, verified |
| The Armorer | "This Is the Way" and "Survival is Strength" are now friendly figures within 4 spaces of the Armorer | YES, verified. Both read "within 4 spaces of the Armorer" |
| Yoda | cost 5; condition removal and focus both limited to REBEL FORCE USERS | YES, verified. Calming Presence and Do or Do Not both restrict to REBEL FORCE USER; cost 5 |
| KX-Series Security Droid | Shoulder Rush is now a Double Action, move up to 6, otherwise unchanged. A non-small figure is not pushed and KX cannot enter its space, but KX may still attack it | YES, verified, including the non-SMALL clause |
| Stimulants | no longer costs an action; any friendly or hostile figure except yourself | YES, verified |
| Wookiee Rage | confirmed correct as-is | YES |

## Results

Method per card: read the image, compare printed text, cost, restriction and
timing against `data/cc-effects.json` / `data/dc-effects.json`.

### Command Cards checked

| card | footer | verdict |
|---|---|---|
| Disable | IACP Approved | matches (drift already fixed previously) |
| Assassinate | IACP Approved | matches |
| Covering Fire | IACP Approved | matches |
| Deflection | IACP Approved | matches |
| Expose Weakness | IACP Approved | matches |
| Cavalry Charge | IACP Season 5 | matches |
| Capitalize | 10.1 Playtest | text matches; our data adds a `Passive (Discard Pile):` label the card does not print. Verify the redraw really is discard-pile-only. |
| Close the Gap | 10.0 Playtest | matches |
| All in a Day's Work | IACP Approved | matches |
| Ambush | IACP Approved | **DRIFT, FIXED 2026-08-21.** Card prints "move **up to** 4 spaces"; our stored text said "move 4 spaces". alexanbv confirmed: "Ambush is up to 4 spaces". Corrected in `data/cc-effects.json`, `docs/combat-spec.csv` and the regenerated `docs/ability-text-snapshot.json`. Behaviour never needed a change: the resolver grants `pendingMoveX` and already logs "Move up to N spaces" (`abilities.js:8983`), and the picker's Done button ends the move early. |
| Apex Predator | IACP Season 5.1 | matches |
| Beatdown | (footer unclear) | matches |
| Blend In | IACP Season 5.1 | matches |
| Cal's Buddy | IACP Approved | matches |
| Stimulants | 12.0 Playtest (Season 12) | matches. Card reads "An adjacent figure suffers 1 Damage, then gains 1 movement point and becomes Focused", cost 0, Smuggler or Technician. Our data agrees, including adjacency. alexanbv's "select any friendly or hostile figure except yourself" is consistent with it: "any" means friendly OR hostile rather than friendly only, and adjacency already excludes self. |
| Bo-Katan Kryze (DC) | n/a, ruling supersedes | matches his ruling exactly, both the Beskar Armor deployment tokens and the pre-attack tokens on Dual-Wield Pistols |
| Dioxis Fumes | n/a, ruling supersedes | matches, flat 1 Strain |
| Built on Hope | IACP Season 4.1 | matches |
| Choose a Side | IACP Approved | matches |
| Cloned Reinforcements | 11.3 Playtest (Season 11) | matches, including the Double Action cost |
| Dangerous Prey | IACP Approved | matches |
| Close and Personal | IACP Approved | matches |
| De Wanna Wanga | IACP Approved | matches, both the Special Action and the once-per-round passive |
| Demoralizing Monologue | IACP Approved | matches |
| Deploy the Garrison | IACP Season 5 | matches. See the naming decision below. |
| Desperate Escape | IACP Approved | matches, both the end-of-round move and the Kuiil-defeated passive |
| Disarm | IACP Approved | matches |

| Definition: 'Love' | IACP Season 5 | matches |
| Disengage | 11.0 Playtest (Season 11) | matches |
| Double or Nothing | 8.0 Playtest (Season 8) | matches |
| Elusive | IACP Approved | matches |
| Eye on the Prize | 12.0 Playtest (Season 12) | **NAME DRIFT + TOKEN DRIFT, both FIXED 2026-08-21.** Renamed to the printed singular; the token is a Block token. Body text otherwise matches. |
| Face Me! | IACP Season 5 | matches, including the Special Action icon |
| Feint | IACP Season 5 | matches |
| Field Promotion | IACP Approved | matches, cost 0 |
| Final Stand | IACP Approved | matches; prints the generic "?" Power Token badge, so "Power Token" is right |
| Findsman Meditation | IACP Approved | matches |
| Forbidden Knowledge | IACP Approved | matches |
| Force Drain | IACP Approved | matches, including the Special Action icon |
| Gauntlet Blade | 12.0 Playtest (Season 12) | **TOKEN DRIFT, FIXED.** See below. Everything else matches. |
| Guerilla Warfare | IACP Approved | matches, including the one-r spelling of "Guerilla" and the Block Token |
| Guild Programming | Rebalanced | matches |
| Honoring the Fallen | IACP Approved | matches |
| Mandalorian Steel | IACP Season 10 | Block-token clause verified while calibrating the symbol reading; already in `cc-verified.json` |
| Apex Predator, Battle Scars, Price of Glory | various | generic "?" Power Token badge confirmed; "Power Token" is correct on all three |
| Marked Territory | (footer not read) | **TOKEN DRIFT, text only.** See below. |

### Power Token faces: the card tells you which one (audit 2026-08-21)

The engine models a Power Token as generic and prompts the player to pick its
face. That is correct only when the card prints the generic badge. The module
ships the four faces as separate art in `vassal_extracted/images/tokens/`
(`Power Token--Block/Evade/Hit/Surge`), and card text uses them directly:

| printed glyph | meaning |
|---|---|
| black badge, white trefoil | Block Token |
| black badge, white burst | Hit Token |
| black badge, white question mark | generic Power Token, player chooses the face |

Calibrated against Mandalorian Steel, which is one of the three cards already
recorded in `data/cc-verified.json` and prints "if that figure spent a [trefoil]".

Three cards were storing the generic wording for a specific printed face:

| card | prints | was | now |
|---|---|---|---|
| Eye on the Prize | Block | "gain 1 Power Token", resolver stashed `pendingPowerTokenGrant` and opened the face picker (`abilities.js:5090`) | grants Block outright, no picker |
| Gauntlet Blade | Block | same, on the Surge branch (`abilities.js:3554`) | grants Block outright, no picker |
| Marked Territory | Hit (second clause) | "gains 1 Power Token" | "gains 1 Hit Token", stored text only |

The first two were live defects: the player could take Evade or Hit where the
card says Block. Marked Territory is stored text only, because the whole card
routes to `markedTerritoryUnimplemented` (a deliberate no-op, alexanbv
2026-06-21) and the `conditionalExteriorPowerToken` code path it would have used
is dead.

Guarded by `tests/domain/oracle/cc-gauntlet-blade-block-token.test.js` (drives
every green-die face deterministically by stubbing `Math.random`) and by the
updated `tests/domain/oracle/cc-eyes-on-the-prize.test.js`. Both were confirmed
non-vacuous by reintroducing the defect.

Correct as printed, no change: Apex Predator, Battle Scars, Final Stand, Price
of Glory (all print the "?" badge) and Guerilla Warfare (prints Block and
already granted Block).

### Absences that are not gaps

- **No Cheating** has an image in `vassal_extracted/images/cc/` but no entry in
  `cc-effects.json`. That is correct: it is the Asajj-Ventress-only CC, removed
  with her on 2026-05-07 per destruct 2026-05-05.
- **`abilityId` is optional.** 44 of the 292 CC entries omit it, including cards
  known to work (Mandalorian Steel, Stimulants, Tough Luck, Son of Skywalker).
  A missing `abilityId` is not evidence of a missing implementation.

| Self-Augmentation | 11.0 Playtest (Season 11) | matches (our `Attachment:` label is our own convention) |
| Set the Charge | 8.0 Playtest (Season 8) | body matches. **NAME DRIFT, FIXED 2026-08-21.** The card is "Set the **Charge**", singular. Renamed to match print. |
| Smoke Grenade | (blank footer, IACP mark) | **THREE DRIFTS, FIXED 2026-08-21.** See below. |
| Sniper Configuration | IACP Approved | matches |
| Static Pulse | IACP Season 5 | matches |
| Still Faster Than You | IACP Approved | matches |
| Supercharge | IACP Approved | matches |
| Support Specialist | 8.0 Playtest (Season 8) | body matches. **FIXED 2026-08-21.** Retagged `specialAction` so it comes off the DC button, and its picker is now two menus (figure, then action) per alexanbv. |

### Smoke Grenade held the superseded card (fixed 2026-08-21)

The IACP card reads:

> Special Action: Choose a space within **3** spaces and **mark it**. A friendly
> figure within 2 spaces of the chosen space gains 2 movement points **and
> becomes HIDDEN**. **Until the start of the next round**, the marked space
> blocks line of sight.

Our data and resolver held a different card and were wrong three separate ways,
all of them live:

| | was | now |
|---|---|---|
| range of the marked space | within 2 | within 3 (`spaceRange` in `ability-library.json`) |
| the recipient | gained 2 MP only | also becomes Hidden (`recipientBecomesHidden`) |
| how long the smoke blocks LOS | stamped `expiresAfterRound = currentRound + 1`, so it survived the whole following round | stamps `currentRound`, so it lifts when the next round starts |

This is the same failure mode as Disable: our copy is the superseded text rather
than the IACP reissue. The duration error was the largest, leaving a
LOS-blocking space up for roughly twice as long as the card allows.

Guarded by `tests/domain/oracle/cc-smoke-grenade-iacp.test.js`, four tests, all
confirmed non-vacuous by reintroducing each defect. The flag key
`chooseSpaceWithin2OfActivating` is left as-is because it is an id recorded in
the ledger and the wiring probes; the range now lives in the data and the
comment says so.

| There Is No Try | IACP Approved | matches |
| Transmit the Plans | IACP Approved | matches |
| Whistling Birds | IACP Season 4.1 | matches |
| Windfall | IACP Season 5.1 | matches |
| Jundland Terror | (LFL/FFG footer) | matches, and confirmed narrow: "attack or Special Action", not any action |
| Smuggler's Tricks | (LFL/FFG footer) | matches; retagged `specialAction`, see below |
| A Powerful Influence | (LFL/FFG footer) | matches |
| Adrenaline | (LFL/FFG footer) | **TEXT DRIFT, FIXED 2026-08-21.** Card prints "WOOKIEES"; our text said "WOOKIES". Display only, the resolver keys on the WOOKIEE keyword. Also corrected a comment at `abilities.js` that claimed the figures suffer 5 Damage at end of round; they do not, the +5 max is reverted and current is clamped (`round.js:737`). |
| Advance Warning | (LFL/FFG footer) | matches |
| Against the Odds | (LFL/FFG footer) | matches |
| Arcing Shot | (LFL/FFG footer) | matches |
| Armed Escort | (LFL/FFG footer) | matches |
| Balancing Force | (LFL/FFG footer) | matches |
| Ballistics Matrix | (LFL/FFG footer) | matches |

| Battlefield Awareness | (LFL/FFG) | text matches. **OPEN:** its "within 3 spaces" is measured from the ACTIVATING figure, but the card is a reaction played by a Leader while someone else attacks, so it should measure from the Leader. See the open item below. |
| Behind Enemy Lines | (LFL/FFG) | matches (fixed a missing apostrophe in our stored text) |
| Black Market Prices | (LFL/FFG) | matches |
| Bladestorm | (LFL/FFG) | matches; `attackSurgeBonus 1`, `postAttackAoeDamage 1`, `postAttackAoeRange 2` |
| Blaze of Glory | (LFL/FFG) | matches; verified it readies IG-88's OWN card, not whichever DC just activated |
| Blitz | (LFL/FFG) | matches |
| Blood Feud | (LFL/FFG) | matches |
| Bodyguard | (LFL/FFG) | matches |
| Brace for Impact | (LFL/FFG) | matches |
| Brace Yourself | (LFL/FFG) | matches |
| Burst Fire | (LFL/FFG) | matches |
| Call the Vanguard | (LFL/FFG) | matches; grants "a move and an attack" specifically, so the granted-ACTION menu does not apply |
| Camouflage | (LFL/FFG) | matches |
| Capture the Weary | (LFL/FFG) | matches |
| Celebration | (LFL/FFG) | matches |
| Change of Plans | (LFL/FFG) | matches; verified the resolver enforces BOTH "equal or lower cost" and the shared trait. Library label had dropped the cost half; corrected. |
| Chaotic Force | (LFL/FFG) | matches; verified each player picks **up to 3** with a Done option. Library label said "all figures"; corrected. |
| Cheat to Win | (LFL/FFG) | matches |
| Collateral Damage | (LFL/FFG) | matches; verified the defender is excluded from the candidate list and objects are included |
| Collect Intel | (LFL/FFG) | matches |
| Combat Resupply | (LFL/FFG) | matches |
| Comm Disruption | (LFL/FFG) | matches (fixed "cancel is effects" to "cancel its effects" in our stored text) |
| Concentrated Fire | (LFL/FFG) | matches |
| Coordinated Attack | (LFL/FFG) | matches; card prints the DOUBLE Special Action arrow and our timing is `doubleActionSpecial` |

### Open: Battlefield Awareness measures range from the wrong figure

Card: "Use after another friendly figure within 3 spaces rolls any number of dice
to reroll 1 of those dice." alexanbv 2026-06-17: "played by a Leader while
someone ELSE within 3 spaces is attacking. The die is rerolled, technically the
Leader playing BA is the one doing it, which only matters in this case for
Lando."

`abilities.js:14597` measures the range from `actPos`, the ACTIVATING figure, and
excludes that DC's figures from the candidate list. Since the card is a reaction
played by the Leader while someone else attacks, the range should be measured
from the Leader, and the figure that rolled (the attacker, who IS the activating
figure) is precisely the one being excluded.

Mitigating: in live combat the queue entry is `pool: 'attack'` keyed to
`combat.attackerPlayerNum`, so the reroll lands in the right pool no matter which
figure the picker named — the chosen name only labels the log. The
out-of-combat path (grant the reroll to a figure's next attack this round) does
use the chosen figure.

Not changed. BA's targeting already carries rulings and the Lando / Gambit /
Shrewd Scoundrel interaction is delicate, so this needs alexanbv first.

| Corrupting Force | (LFL/FFG) | matches; shares the "each player picks up to 3" machinery with Chaotic Force. Library label said "all figures"; corrected. |
| Counter Attack | (LFL/FFG) | matches |
| Cripple | (LFL/FFG) | matches |
| Cruel Strike | (LFL/FFG) | matches (fixed "Perform an an attack" in our stored text) |
| Crush | (LFL/FFG) | matches |
| Cut Lines | (LFL/FFG) | matches |
| Dangerous Bargains | (LFL/FFG) | matches |
| Dark Energy | (LFL/FFG) | matches. The card says "another **small figure**", NOT hostile, and the resolver correctly enumerates both players' figures. The library label and two comments said "hostile"; corrected before someone "fixed" the code to match them. |
| Balancing Force | (LFL/FFG) | matches; same up-to-3 machinery. Library label corrected likewise. |
| Data Theft | (LFL/FFG) | matches |
| Deadeye | (LFL/FFG) | matches |
| Deadly Precision | (LFL/FFG) | matches |
| Deathblow | (LFL/FFG) | matches |
| Blaze of Glory (Mara) | n/a | confirmed Mara-aware with IG-88 also in the list; see the tests noted below |

| Debts Repaid | (LFL/FFG) | **LIVE BUG, FIXED 2026-08-22.** See below. |
| Devotion | (LFL/FFG) | matches |
| Dirty Trick | (LFL/FFG) | matches |
| Disorient | (LFL/FFG) | matches. Its config uses the `chooseAdjacentHostileThen` key but sets `range: 999`, so there is no adjacency restriction — correct, the card does not impose one. The key name is a misnomer here; it is shared, so left alone. |

### Defender-side unique-figure CCs were playable by the wrong figure (fixed 2026-08-24)

Found while auditing alexanbv's correction that "furious charge also is out of
activation".

A card reading "an attack targeting YOU" ties "you" to the figure being attacked.
But `ctx.isDefender` in `cc-timing.js` is only PLAYER-level
(`combat.defenderPlayerNum === playerNum`), and `isCcPlayLegalByRestriction` is
army/board-level. Together that made a unique-figure defender-side CC playable
whenever ANY of your figures was the defender — and the resolver then acted on
that defender.

Furious Charge (Gaarkhan) is the clearest case: a Rebel Trooper takes 3+ Damage
while Gaarkhan stands across the map, and `fireFuriousCharge` readies the **Rebel
Trooper's** Deployment card.

Ten unique-figure CCs sit on a defender-side timing: Ambush, Dangerous Prey,
Furious Charge, Gauntlet Blade, Let's Make a Deal, Payback, Reactive Loyalties,
Right Back At Ya!, Stroke of Brilliance, and Preservation Protocol (excluded — it
gates on `duringActivation`, a different shape).

Fixed with one gate in `isCcPlayableNow` rather than ten patches. It asks
`getUniqueCcPlayerOptions` who may legally play the card instead of re-listing the
enablers, so it cannot drift out of step with the picker cc-hand shows, and it
preserves every route in: the named figure, Mara via Fast Learner, a Force User
via There is Another, and any friendly figure when an un-depleted [A New Hope] is
in the army (alexanbv 2026-08-24: "debts repaid, like SoS, also has an option to
work with any figure if A New Hope is in this list" — verified for both cards).

The gate abstains rather than blocking whenever it cannot be sure: no live
combat, no identifiable defender, or the named figure absent from the army (there
the restriction gate is what rejects the play).

**Keyword restrictions: RULED and included (alexanbv 2026-08-24).**

> "the figure playing the card must have the keyword. If the card is played by
>  the defender, the defender must have that keyword. Some cards are played by
>  nearby figure while someone else is defending, for example guardian stance,
>  bodyguard, get behind me. In each case, the figure playing the card (which is
>  defended if self, but it is not always self) that had to have the keyword"

So on these timings the player IS the defender, and the DEFENDER must carry the
keyword — not merely somebody in the army, which is all
`isCcPlayLegalByRestriction` checks. Counter Attack (BRAWLER) is no longer
playable because a TROOPER took the hit while a BRAWLER stood elsewhere. Same for
Elusive, Parry, Iron Will, Heavy Armor, Knowledge and Defense, On the Lam, Run
for Cover, Savage Vigor and Stealth Tactics. Unrestricted ones (Brace Yourself,
Brace for Impact, Camouflage, Hard to Hit) are unaffected by definition.

The match is delegated to `ccPlayableByMatches`, the same per-DC matcher the
Special Action menu uses, so Programming Override's granted keywords and the
Darksaber's IMPERIAL access keep working on the defender.

**The nearby-figure cards are a different case and never reach this gate.**
Guardian Stance, Bodyguard and Get Behind Me! are played by a figure standing
near the defender, so it is the PLAYING figure that needs the keyword, not the
defender. They sit on their own adjacent-friendly timings
(`whileAdjacentFriendlyFigureDefending`, `whenAttackDeclaredOnAdjacentFriendly`,
`whenAttackDeclaredTargetingFriendlySmallFigureCost10OrLessWithin3Spaces`), which
are deliberately not in `DEFENDER_SIDE_TIMINGS`. A test pins that a TROOPER
defending does not block a nearby GUARDIAN from playing Guardian Stance.

Guarded by `tests/domain/oracle/cc-defender-identity-gate.test.js`.

### Debts Repaid anchored on the wrong figure (fixed 2026-08-22)

Card: "Use when a friendly figure is defeated. Ready YOUR Deployment card and
become Focused." Chewbacca, cost 3.

The resolver keyed off `findActiveActivationMsgId`. But a friendly figure usually
dies on the OPPONENT's turn, so Chewbacca is very often not the activating
figure, and often nothing is activating at all:

| situation | was | now |
|---|---|---|
| nobody activating (the card's most common window) | bailed with "no activation in progress" — the card did nothing and the 3 cost was wasted | readies Chewbacca and Focuses him |
| another friendly group activating | Focused and readied **that group** instead | Chewbacca |
| Chewbacca activating | correct, by luck | Chewbacca |

Identical to the Blaze of Glory defect alexanbv caught on 2026-08-12, and fixed
the same way: an opt-in `anchorOnNamedFigure` flag routes the lookup through
`findOwnDcMsgIdForCc`, which resolves the named figure and inherits Mara /
Fast Learner awareness for free.

The flag is opt-in because the resolver block is shared with every other
`applyFocus` card. Debts Repaid is the only one **in that block** with an
out-of-activation timing — the rest are duringActivation, specialAction or attack-declaration
timings where the activating figure genuinely is "you" — so nothing else changes.
A test pins that a plain Focus still follows the activating figure. (alexanbv
corrected the wider claim: Furious Charge is also out-of-activation. It is
excluded from this block and handled separately — see the defender-identity gate
above, which is what it actually needed.)

Guarded by `tests/domain/oracle/cc-debts-repaid-anchor.test.js`.

| Droid Mastery | (LFL/FFG) | matches |
| Dying Lunge | (LFL/FFG) | matches |
| Eerie Visage | (LFL/FFG) | matches; verified `targetAll` really does hit every hostile with line of sight rather than prompting for one |
| Efficient Travel | (LFL/FFG) | matches |
| Element of Surprise | (LFL/FFG) | matches |
| Emergency Aid | (LFL/FFG) | matches |
| Endless Reserves | (LFL/FFG) | matches |
| Escalating Hostility | (LFL/FFG) | matches |
| Self-Defense | (LFL/FFG) | text matches. **LIVE BUG, FIXED 2026-08-24** — see below. |

### Reaction cards had no way to name their own figure (fixed 2026-08-24)

Found sweeping for the "declared figure" bug class. Three unrestricted,
hand-played cards refer to a FIGURE rather than the player: Dying Lunge, To the
Limit and Self-Defense. Having no restriction box, the declaration step has
nothing to offer them, so they fell back on "whoever is activating".

To the Limit is fine — it says "during your activation", so the activating figure
genuinely is "you".

**Self-Defense was broken in its only real window.** "Use when a hostile figure
enters a space adjacent to you" fires during the OPPONENT's move, when no
activation of yours exists, so it bailed with "no activation in progress".

The information was always present: the move-interrupt opportunity records which
of your figures the hostile moved next to (`triggerFigureKey`). Slippery Target
had been special-cased to read it (alexanbv 2026-06-19). Rather than special-case
a second resolver, `cc-hand` now sets the declaration from the live opportunity
for ANY interrupt card, so the generic resolution picks it up — Parting Blow and
Dirty Trick included, and anything added to `INTERRUPT_CARD_BY_TYPE` later.

Guarded by `tests/domain/oracle/cc-interrupt-window-declaration.test.js`.

| Espionage Mastery | (LFL/FFG) | matches |
| Etiquette and Protocol | (LFL/FFG) | matches |
| Evacuate | (LFL/FFG) | matches |
| Explosive Weaponry | (LFL/FFG) | matches |
| Extra Protection | (LFL/FFG) | matches. **Its log told the player a rule that does not exist**, instructing them to "perform an attack targeting the figure who attacked you". The card does not restrict the target. Advisory text only, not enforced, but it would have people playing it wrong. Corrected. |
| Face to Face | (LFL/FFG) | **BEHAVIOURAL DRIFT, FIXED 2026-08-24.** `overrideAttackType: "Melee"` forced the attack to be Melee. The card says "perform an attack targeting an adjacent figure or object" and does NOT say Melee — Feral Swipes prints the melee icon on the same sheet and Face to Face does not. A BRAWLER with a Ranged attack was being made to roll the wrong dice. |
| Fatal Deception | (LFL/FFG) | matches |
| Feral Swipes | (LFL/FFG) | matches, including the printed melee icon |

| Ferocity | (LFL/FFG) | matches |
| Field Supply | (LFL/FFG) | matches. The card says "Up to 2 **other figures** within 3 spaces", not "friendly", and its next sentence does say friendly, so the omission is deliberate. alexanbv 2026-08-24: "field supply is technically anyone, but no one gives enemy figures tokens." The picker offered friendlies only; it now offers any figure within 3. |
| Field Tactician | (LFL/FFG) | matches |
| Fleet Footed | (LFL/FFG) | matches |
| Flurry of Blades | (LFL/FFG) | matches, including the double Special Action arrow |
| Fool Me Once | (LFL/FFG) | matches, including the 2 Strain cost |
| Force Illusion | (LFL/FFG) | matches |
| Force Jump | (LFL/FFG) | matches |
| Force Push | (LFL/FFG) | **RESTRICTION DRIFT, FIXED 2026-08-24.** Its band prints the Rebel starbird before "Force User"; we stored plain FORCE USER, so an Imperial or Scum Force User could play it. Force Rush and Force Surge, either side of it on the same sheet, print no icon and are correct as stored. |
| Force Rush | (LFL/FFG) | matches |
| Force Surge | (LFL/FFG) | matches |
| Foresee | (LFL/FFG) | matches |

| Forward March | (LFL/FFG) | matches |
| Furious Charge | (LFL/FFG) | matches; its play-time gate was corrected separately (see the defender-identity section) |
| Glory of the Kill | (LFL/FFG) | matches |
| Grenadier | (LFL/FFG) | matches, including "each figure" rather than each hostile |
| Grisly Contest | (LFL/FFG) | matches |
| Heavy Armor | (LFL/FFG) | matches |
| Heavy Ordnance | (LFL/FFG) | matches, including the object clause |
| Heightened Reflexes | (LFL/FFG) | matches |

| Force Lightning | (LFL/FFG) | matches; band reads "[Imperial] Force User" and we store IMPERIAL FORCE USER |
| Fuel Upgrade | (LFL/FFG) | matches |
| Harsh Environment | (LFL/FFG) | matches |
| Heart of Freedom | (LFL/FFG) | matches; band reads "Any [Rebel] Figure" |
| Hidden Trap | (LFL/FFG) | matches |
| Hide in Plain Sight | (LFL/FFG) | matches |
| Hit and Run | (LFL/FFG) | matches |
| Hold Ground | (LFL/FFG) | matches |

### Stale library labels are worth fixing

`entry.label` is not dead metadata: it surfaces to players in manual-resolve
fallbacks and in several prompts. Four labels contradicted their own cards and
have been corrected: Chaotic Force / Corrupting Force / Balancing Force all said
"all figures" where the card and the resolver do "each player chooses up to 3",
Change of Plans dropped the "equal or lower cost" half of its condition, and Dark
Energy said "hostile" where the card says "another small figure" either side.

The Dark Energy one is the cautionary case: the code was right and the label was
wrong, so the danger was someone later "correcting" the code to match the label.

### Condition discards are Special Actions (RESOLVED 2026-08-21)

alexanbv: "condition discards count as special actions", then, on the two
follow-ups: "they are different discards, and a figure cannot be double stunned.
So a figure could discard stunned and bleeding" and "A disabled figure who is
also stunned or bleeding may not discard it".

Three consequences, all implemented:

1. **Disable now blocks them.** Disable reads "cannot use Special Actions this
   round", so a Disabled figure cannot discard Stun or Bleed. Gated in
   `handleDcRemoveStun` / `handleDcRemoveBleed`, in the button render
   (`components.js`), and in the granted-action menu.
2. **Both discards remain available together.** They are separate Special
   Actions, so a figure holding both spends two actions and clears both. Nothing
   treats them as one shared once-per-activation special.
3. **Jundland Terror offers them.** The card grants "an attack or Special
   Action", so its mode menu now lists the discards the chosen figure can
   actually make. Confirmed with alexanbv that Jundland stays narrow otherwise:
   it grants attack or Special Action, NOT any action, so no Move and no
   Interact. The card's arrow icon and our stored text both say so.

Guarded in `tests/domain/oracle/cc-support-specialist-menus.test.js`.

### Naming: match the printed card (RESOLVED 2026-08-21)

alexanbv, asked to rule on the class rather than card by card: **"match printed
cards"**. Applied to all three known mismatches, including Deploy the Garrison,
whose exclamation mark I had earlier decided to drop:

| was stored | now, as printed |
|---|---|
| Eyes on the Prize | **Eye on the Prize** |
| Set the Charges | **Set the Charge** |
| Deploy the Garrison | **Deploy the Garrison!** |

Matching print is also the more consistent answer: Face Me!, Karabast!, Draw! and
Utinni! already keep their exclamation marks in our data, so Garrison was the
outlier.

The rename covers the `cc-effects.json` keys and `abilityId`s,
`ability-library.json`, `destruct-test-decks.json`, `unique-figure-ccs.json`,
`scripts/cc-names.js`, the resolvers and helpers in `src/`, the oracle, headless
and certification fixtures, `dc-cc-ledger.json`, `port_coverage.json`,
`combat-spec.csv`, the regenerated ability-text snapshot, the python port and its
parity snapshots, and the card image filenames (`getCommandCardImagePath`
resolves by filename, so the images had to move too). The redundant low-resolution
`Eye on the Prize.png` was replaced by the high-resolution file that had been
misfiled under the plural name.

Deliberately **not** renamed, because they are dated historical records rather
than live data: `docs/dc-cc-timing-audit-*.md`, the one-shot migration scripts
under `scripts/` (`seed-cc-unverified-first-pass.js`,
`add-missing-cc-abilities.js`, `dc-cc-ledger-patch-batch-*.js`), and the
`tests/headless/learnings-*.json` training artifacts, which no code path reads.

### Special Action tagging (RESOLVED 2026-08-21)

alexanbv: "Support specialist is a special action. Should be the same as any
other special action... There needs to be a menu to choose which figure is being
selected and then another menu for which action that figure is doing."

Two cards printed the single Special Action arrow but carried
`timing: "duringActivation"`, which in this engine means "played from hand"
rather than from the DC's Special Action button: **Support Specialist** and
**Smuggler's Tricks**. Both retagged `specialAction`.

Support Specialist's picker was also rebuilt as two menus. It used to be one flat
list crossing every eligible figure with every action, which grows as figures x
actions; it is now figure first, then that figure's action.

The second menu is a new shared primitive, `src/handlers/granted-action.js`,
because alexanbv widened the scope on the same day: "perform an action refers to
any action, including interact move attack or special action. No rest actions in
skirmish", then "you must do all of them. Remember that there are other
possibilities for actions also include: discarding bleed / Discarding stun /
Special actions from mission rules."

Rather than enumerate that list a second time, the menu renders the grantee's
real DC buttons through `getDcActionButtons` and rewrites their custom ids to
route back through the ordinary action pipeline. That inherits, for free, every
rule the play area already knows: attachment-injected and mission-injected
specials, specials an attachment removes, Stun blocking Move and Attack but not
Interact or Specials, and the condition-discard row. A second copy of that list
is exactly the kind of duplication that produced the MASSIVE line-of-sight defect.

The interrupting figure is not activating, so it has no action economy. The flow
stamps `grantedAction: true` on the synthesized context and
`consumeActionForCurrentFigure` early-returns on it, which also stops the
interrupt from taking `game.activationLockKey` away from the real activation.

Note the neighbouring ruling, which is why this is a separate primitive from the
existing narrow granted-ATTACK button: "when it says 'may perform an attack' that
is just a regular attack, and cannot be used for a special attack action (ex
crippling blow on rancor)." Verified the engine already complies: the free-attack
grant is consumed only where the action is literally Attack
(`dc-play-area.js:2759`), and no Special Action path reads that flag.

Guarded by `tests/domain/oracle/cc-support-specialist-menus.test.js`.

The seven cards on `doubleActionSpecial` (Cloned Reinforcements, Coordinated
Attack, Flurry of Blades, Maximum Firepower, New Orders, Optimal Bombardment,
Pummel) print the double arrow and are correctly distinct.

`data/cc-verified.json` records only 3 cards as verified: Mandalorian Steel,
Stimulants, Wookiee Rage.

**164 of ~580 checked.** Drifts so far: Smoke Grenade (three live drifts, fixed),
the Power Token faces on Eye on the Prize and Gauntlet Blade (live, fixed) and on
Marked Territory (text only, fixed), Ambush (text only, fixed), Reverse
Engineer's dropped Surge qualifier (text only, fixed), the Eye/Eyes and
Charge/Charges names (resolved: match print), and the Special Action tagging on
Support Specialist and Smuggler's Tricks (resolved).

alexanbv 2026-08-19: "Remember most cards are IACP cards" — so there is no
meaningful non-IACP subset to skip. Sweep everything.

Note on our added labels: our stored text prefixes clauses with schema labels the
printed card does not carry (`Passive (Discard Pile):` on Capitalize,
`Attachment:` on Blend In). That appears to be our own convention rather than
drift, but it means a plain string comparison against card text will produce
false positives. Compare meaning, not bytes.

### Name-resolution artifacts, not gaps

- `Definition Love.png` is the card stored as `Definition: 'Love'`.
- `Eye on the Prize.png` and `Eyes on the Prize.png` used to both be present and
  were the same 12.0 Playtest card at two resolutions. Resolved 2026-08-21: the
  card is `Eye on the Prize`, and the high-resolution file now carries that name.

Filename-to-card-name matching is noisy. Confirm against `cc-effects.json` keys
before reporting any card as missing from data.

## The 66 IACP-marked CCs with no IACP in the filename

Never checked. Highest value targets.

Struck through as they are cleared. Remaining, in sweep order:

There Is No Try, Transmit the Plans, Whistling Birds, Windfall.

Cleared so far from this list: All in a Day's Work, Ambush, Apex Predator,
Beatdown, Blend In, Built on Hope, Cal's Buddy, Choose a Side, Cloned
Reinforcements, Close and Personal, Dangerous Prey, De Wanna Wanga, Definition
Love, Demoralizing Monologue, Deploy the Garrison!, Desperate Escape, Dioxis
Fumes, Disarm, Disengage, Double or Nothing, Elusive, Eye on the Prize, Face Me!,
Feint, Field Promotion, Final Stand, Findsman Meditation, Forbidden Knowledge,
Force Drain, Gauntlet Blade, Get Behind Me!, Guerilla Warfare, Guild Programming,
Honoring the Fallen, Iron Will, Just Business, Karabast!, Lightbow, Mandalorian
Steel, Overwhelming Impact, Paid in Beskar, Personal Energy Shield, Preservation
Protocol, Rapid Recalibration, Reactive Loyalties, Reduce to Rubble, Rest in
Peace, Retaliation, Reverse Engineer, Savage Vigor, Self-Augmentation, Set the
Charge, Smoke Grenade, Sniper Configuration, Static Pulse, Still Faster Than You,
Stimulants, Supercharge, Support Specialist, Wookiee Rage. No Cheating is not in
the data at all and correctly so (see above).

## Reproducing the CC detection

```python
from PIL import Image
im = Image.open(path).convert('RGB'); w, h = im.size
c = im.crop((int(w*0.82), int(h*0.88), w, h)); px = list(c.getdata())
red = sum(1 for r, g, b in px if r > 110 and g < 90 and b < 90)
marked = 100 * red / len(px) > 3      # IACP cards land 10-15%, others 0
```
