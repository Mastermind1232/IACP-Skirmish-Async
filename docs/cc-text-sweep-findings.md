# Command Card text sweep — findings

Sweep of all 292 Command Cards, comparing `data/cc-effects.json` reference text
and `data/ability-library.json` labels against the printed card images in
`vassal_extracted/images/cc/`.

Ground-truth rule: the latest playtest image wins, except for the 12 cards
alexanbv changed after printing (Bo-Katan, Rebel Trooper (Elite), CT-1701,
Leia, Bantha Rider, The Armorer, Yoda, KX-Series Security Droid, Dioxis Fumes,
Stimulants, Get Behind Me!, Wookiee Rage). For those the image is superseded
and the data must not be corrected toward it.

**Status: all 292 Command Cards read.** Progress state lives in
`~/skirbo-listener/audit/sweep_done_cc.json` and `sweep_todo_cc.json`; the todo
list is empty. The batch tooling (`next.py N <tag>` to build a contact sheet and
dump the stored data, `mark.py <tag>` once the sheet has actually been read) is
kept for the Deployment Card sweep, which is the next 182 cards.

## Open questions for alexanbv

### 1. "Hit" vs "Damage" for the attack-results symbol

Sixteen cards render the attack-results symbol as "Hit" ("apply +1 Hit to the
attack results"); one renders it as "Damage". The printed glyph is identical on
all of them. The ambiguity matters because "Hit Token" is a separate game
object that other cards genuinely grant, so the same word currently names two
different things. All 17 have been left on "Hit" (the current majority) rather
than half-migrated. Asked in Discord 2026-08-31.

### 2. Disarm — does the lock survive the round?

The card reads "Put this card into play... that figure suffers 1 Damage,
becomes Weakened, and can't discard the Weakened condition." No duration is
printed. `clearUntilEndOfRoundFlags` in `src/handlers/round.js:183` resets
`disarmPermanentWeakened` every round, with the comment "Disarm card leaves
play at end of round", which the card does not say. Either the comment records
an unwritten ruling or the lock expires too early.

### 3. Rapid Recalibration — reroll vs. set

The card reads "Choose 1 attack die and turn that die to any side", and
`docs/combat-spec.csv` records that text correctly. The ability library
implements it as `rerollOneAttackDie: true`, which is the shared random-reroll
counter also used by Mitigate, Officer's Training, Sniper, Bespin Security,
Much to Learn and Professional. A reroll is random; turning a die to any side
is deterministic and strictly stronger, so the card is currently weaker than
printed.

A set-die-to-a-chosen-face flow already exists: **There Is No Try** does die
picker, then face picker, then apply, in `src/handlers/combat-reactions.js`,
building its buttons from `getDistinctDieFaces` over `data/dice.json` (alexanbv
2026-06-21). That helper already handles attack dice as well as defense dice;
There Is No Try only calls it with `'defense'`. Closing Rapid Recalibration is
therefore reusing that two-step picker against the attack pool, not building a
new mechanism.

## Deferred, verified as correct

- **Marked Territory** is a deliberate no-op (alexanbv 2026-06-21). A full
  `conditionalExteriorPowerToken` handler already exists in
  `src/game/abilities.js`, but no map in `data/map-spaces.json` carries an
  `exterior` map, so wiring it now would silently drop the second clause on
  every map. It needs exterior cells tagged on the maps, not new code.

## Fixed in this sweep

Text corrections to `data/cc-effects.json`:

- **Lord of the Sith** was missing a whole clause. The card ends "When you
  declare this attack, remove 1 die from your attack pool." The die removal was
  already implemented at `abilities.js:14939`; only the reference text was short.
- **Disable** carried "Technician or Smuggler Action:" (the restriction box
  pasted into the action line) and listed the two blocked ability types in the
  wrong order. The printed line is "cannot use [Surge] or [Special Action]
  abilities". `src/game/disable-iacp-duration.test.js` pinned the old order and
  was updated with the corrected transcription.
- **Close the Gap** said "Armor Token"; the card prints the Block face and every
  other card says "Block Token".
- **Evacuate** and **De Wanna Wanga** were missing the "Special Action:" prefix
  that the other 74 special-action cards carry.
- **Built on Hope** read "the top of bottom"; the card reads "the top or bottom".
- **Blend In** carried an invented sentence ("It is now an Attachment.") that is
  not printed.
- **Navigation Upgrade**, **Ballistics Matrix** and **Signal Jammer** carried
  Discord-specific asides ("i.e. in your discord Player Area channel") and
  ad-hoc `----` dividers instead of the blank-line convention.
- **I Can Feel It** carried a "(MULTIPLE TIMING WINDOWS)" editorial marker; the
  card has three divider-separated blocks and the structured `timings` array
  already records them.
- **Repair** had a typo ("If you a are TECHNICIAN") and a duplicated "Free
  Action (TECHNICIAN)" line that is not on the card.
- **Knowledge and Defense** dropped "your" from "your FORCE USERS gain".
- **Deflection**, **Close and Personal**, **Battle Scars**, **Parry** had small
  wording drifts from the printed text.
- Casing normalised: "damage" to "Damage" on four cards, "Block token" to
  "Block Token" on three.

Label and log-message corrections to `data/ability-library.json`, where the code
was already right and only the player-facing string was stale:

- **Double or Nothing** said the matching icons were "doubled automatically" and
  keyed on "the same icon type". The implemented behaviour, per alexanbv
  2026-06-20, is the same number of symbols plus a double / cancel / decline
  choice.
- **Disable** said "this round"; the code implements "until the end of that
  figure's next activation".
- **Force Drain** said "if you are a FORCE USER"; the card and the code both
  check the chosen target. A source comment at `abilities.js:9999` said the same
  thing and was corrected.
- **Face Me!** said "Melee attack"; the code deliberately grants a generic
  attack.
- **Findsman Meditation** said "move 2"; the code grants a move equal to
  Zuckuss's speed.
- **Guerilla Warfare** said "no adjacent friendly"; the rule is no other friendly
  within 2 spaces.
- **Gauntlet Blade** said "gain Power Token"; it grants a Block Token.
- **Built on Hope** said the other cards return to the top; they go to the top or
  bottom in any order.
- **Demoralizing Monologue** described only the reroll and omitted the
  reveal-hand half.
- **Looking for a Fight** said "Gain 1 Power Token ... choose type"; per alexanbv
  2026-06-22 it grants a Hit Token with no face choice, which is what the code
  does.
- **Cloned Reinforcements** showed a double-encoded character where a
  "less than or equal" sign belongs (four occurrences repaired).

Additional text corrections, second half of the sweep:

- **Terminal Protocol** was missing its opening sentence, "Use during your
  activation."
- **Windfall** ran its two divider-separated blocks together as one paragraph.
- **Wild Fire** began a sentence in lower case.
- **Second Chance** and **Self-Augmentation** carried "as an Attachment" in the
  placement sentence, which neither card prints.
- **Triangulate** said "DROIDS who have line of sight"; the card says "that".
- **Reactive Loyalties**, **Knowledge and Defense**, **Shared Experience** and
  **Targeting Network** had inconsistent spacing or passive-block labels.
- **Reduce to Rubble** carried a dead `chooseAdjacentHostileThen` key. The
  `placeRubbleOnTargetAndAdjacent` branch returns first, so it never ran live,
  but it survived as a headless playability gate that wrongly required an
  adjacent hostile before the sim would play an area-damage card.
  `tests/domain/oracle/dc-cc-library-wiring-batch-14-probe.test.js` was updated.

Further label corrections where the code was already right:

- **Retaliation** said "Gain 2 Power Tokens"; the option grants Hit Tokens.
- **Support Specialist** said "grant free interrupt move"; per alexanbv
  2026-08-21 it grants any action, and the code hands off to the shared
  granted-action menu.
- **Transmit the Plans** said "Grant 2 Damage Tokens to activating figure"; it
  runs a sequential picker that distributes among friendly figures.
- **Triangulate** said "damage = # DROIDs in play"; the code counts only the
  moved DROIDs that have line of sight to the target.

## Verified correct, no change needed

These were checked because a label or key looked wrong, and the implementation
turned out to match the card:

Ambush (forces the damage onto the attacker), Built on Hope (top or bottom with
ordering), Cal's Buddy, Close the Gap, Disarm's lock mechanism, Double or
Nothing, Field Promotion (writes figure cost, despite the key name
`increaseArmyCostBy`), Force Drain, Findsman Meditation, Just Business, Knowledge
and Defense's discard-pile passive (lives in `cc-passive-redraw.js`, not the
ability library), Learn by Example, Mandalorian Steel, On the Lam
(`mpBonusFromSpeed: 0` means speed plus zero), Optimal Bombardment, Overcharged
Weapons, Overheated, Preservation Protocol (including the ability-loss clause),
Reduce to Rubble's area damage, Shared Experience, Sniper Configuration's
line-of-sight clause, There Is No Try.

Forty-four cards carry no `abilityId`. That is not a gap: `cc-pipeline.js:289`
resolves `effect.abilityId ?? cardName`, and all 44 have a library entry keyed by
their card name.
