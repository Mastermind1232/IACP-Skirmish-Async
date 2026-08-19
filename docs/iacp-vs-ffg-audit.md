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

## OPEN QUESTION, blocking any data change

The module does not hold one consistent printing. Footers seen so far:

| footer | cards |
|---|---|
| `IACP Approved` | Disable, Covering Fire, Deflection, Assassinate, Expose Weakness |
| `IACP Season 5` | Cavalry Charge |
| `10.0 Playtest` | Close the Gap |
| `10.1 Playtest` | Capitalize |
| `11.1 Playtest` | AT-RT (also carries a Season 11 roundel) |

Treating a playtest image as ground truth would push **unapproved** text into the
engine, which is a worse defect than the FFG drift being fixed. Asked alexanbv
whether approved printings are the sole authority, or whether the latest playtest
supersedes where one exists. **No card data changes until that is answered.**

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
| Ambush | IACP Approved | **TEXT DRIFT.** Card prints "move **up to** 4 spaces"; our `effect` says "move 4 spaces". Confirmed at 6x zoom, not a low-res misread. Behaviour is correct: it grants `pendingMoveX` with `remaining: 4` and the picker has a Done button that ends the move early (`handleMoveXDone`), so "up to" already holds. Stored text only. |
| Apex Predator | IACP Season 5.1 | matches |
| Beatdown | (footer unclear) | matches |
| Blend In | IACP Season 5.1 | matches |
| Cal's Buddy | IACP Approved | matches |

`data/cc-verified.json` records only 3 cards as verified: Mandalorian Steel,
Stimulants, Wookiee Rage.

**14 of ~580 checked.** One text-level drift, no behavioural drift yet.

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
