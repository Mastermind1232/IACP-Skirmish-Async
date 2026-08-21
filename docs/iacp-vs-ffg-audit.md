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
| Eye on the Prize | 12.0 Playtest (Season 12) | **NAME DRIFT + TOKEN DRIFT.** See below. Body text otherwise matches. |
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

### Open: Eye on the Prize is stored under the wrong name

The card prints **"Eye on the Prize"**, singular. The codebase stores
**"Eyes on the Prize"** in every place: the `cc-effects.json` key and
`abilityId`, `ability-library.json`, the python parity snapshot,
`catalog-manifest.json`, `dc-cc-ledger.json`, `board-helpers.js`,
`abilities.js`, and several oracle and headless fixtures. Both images in the
module are the same 12.0 Playtest card, and one of them is filed correctly as
`Eye on the Prize.png`.

Unlike Deploy the Garrison this is a different word rather than punctuation, and
it is the name a player reads on the card. Raised with alexanbv 2026-08-21;
awaiting his call before the rename.

### Naming decision: Deploy the Garrison (RESOLVED 2026-08-21)

The printed card title is `Deploy the Garrison!` with a trailing exclamation mark.
alexanbv: "Pick one name for deploy the garrison and stick with it."

**Canonical name: `Deploy the Garrison`, with no exclamation mark.** The codebase
already uses that spelling everywhere with no competing variant: the
`data/cc-effects.json` key and `abilityId`, `data/ability-library.json`,
`data/destruct-test-decks.json`, `scripts/cc-names.js`, `tests/certification/catalog-manifest.json`,
the python parity snapshot, and the image file `vassal_extracted/images/cc/Deploy the Garrison.png`.
Adopting the printed spelling would require renaming the image file alongside every
data key and derived artifact, for a punctuation mark that changes no behaviour, so
the existing spelling is the one being kept. The trailing "!" on the card art is a
known cosmetic difference and is not drift.

`data/cc-verified.json` records only 3 cards as verified: Mandalorian Steel,
Stimulants, Wookiee Rage.

**42 of ~580 checked.** Drifts so far: Ambush (text only, fixed), the Power Token
faces on Eye on the Prize and Gauntlet Blade (behavioural, fixed) and on Marked
Territory (text only, fixed), and the Eye/Eyes name (open).

alexanbv 2026-08-19: "Remember most cards are IACP cards" — so there is no
meaningful non-IACP subset to skip. Sweep everything.

Note on our added labels: our stored text prefixes clauses with schema labels the
printed card does not carry (`Passive (Discard Pile):` on Capitalize,
`Attachment:` on Blend In). That appears to be our own convention rather than
drift, but it means a plain string comparison against card text will produce
false positives. Compare meaning, not bytes.

### Name-resolution artifacts, not gaps

- `Definition Love.png` is the card stored as `Definition: 'Love'`.
- `Eye on the Prize.png` and `Eyes on the Prize.png` are both present; the card is
  `Eyes on the Prize`.

Filename-to-card-name matching is noisy. Confirm against `cc-effects.json` keys
before reporting any card as missing from data.

## The 66 IACP-marked CCs with no IACP in the filename

Never checked. Highest value targets.

All in a Day's Work, Ambush, Apex Predator, Beatdown, Blend In, Built on Hope,
Cal's Buddy, Choose a Side, Cloned Reinforcements, Close and Personal, Dangerous
Prey, De Wanna Wanga, Definition Love, Demoralizing Monologue, Deploy the
Garrison, Desperate Escape, Dioxis Fumes, Disarm, Disengage, Double or Nothing,
Elusive, Eye on the Prize, Eyes on the Prize, Face Me!, Feint, Field Promotion,
Final Stand, Findsman Meditation, Forbidden Knowledge, Force Drain, Gauntlet
Blade, Get Behind Me!, Guerilla Warfare, Guild Programming, Honoring the Fallen,
Iron Will, Just Business, Karabast!, Lightbow, Mandalorian Steel, No Cheating,
Overwhelming Impact, Paid in Beskar, Personal Energy Shield, Preservation
Protocol, Rapid Recalibration, Reactive Loyalties, Reduce to Rubble, Rest in
Peace, Retaliation, Reverse Engineer, Savage Vigor, Self-Augmentation, Set the
Charges, Smoke Grenade, Sniper Configuration, Static Pulse, Still Faster Than
You, Stimulants, Supercharge, Support Specialist, There Is No Try, Transmit the
Plans, Whistling Birds, Windfall, Wookiee Rage

## Reproducing the CC detection

```python
from PIL import Image
im = Image.open(path).convert('RGB'); w, h = im.size
c = im.crop((int(w*0.82), int(h*0.88), w, h)); px = list(c.getdata())
red = sum(1 for r, g, b in px if r > 110 and g < 90 and b < 90)
marked = 100 * red / len(px) > 3      # IACP cards land 10-15%, others 0
```
