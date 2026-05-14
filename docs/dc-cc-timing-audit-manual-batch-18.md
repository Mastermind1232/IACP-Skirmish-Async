# DC/CC Timing Audit — Manual Triage Batch 18

Scope: last 5 DCs alphabetically (Wookiee Warrior Elite/Regular, Yoda,
Zeb Orrelios, Zuckuss) + first 5 Skirmish Upgrades alphabetically
([A New Hope], [Advanced Com Systems], [Balance of the Force],
[Beast Tamer], [Black Market]).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Wookiee Warrior (Elite & Regular)

**Fury** — "While attacking, if you have suffered 5 or more Damage, apply +1 Surge to the attack results."
- Impl: `fury_wookiee_*` keyed at 2 sites each.
- ⚠️ suspicious — verify (a) attacker step-4 mod checks current HP vs maxHP (damageSuffered = maxHP - currentHP), (b) threshold ≥ 5, (c) +1 Surge added to attacker's roll, (d) per-figure read (Wookiee Warrior is a multifig group; each figure has its own HP threshold).

---

## Yoda

**Calming Presence** — "At the start of a friendly REBEL FORCE USER figure's activation, that figure may remove one HARMFUL condition and suffer 1 Strain. Limit once per round."
- Impl: `calming_presence_yoda` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoA hook fires on FRIENDLY REBEL FORCE USER activation (not Yoda's own SoA), (b) "may" → Use/Skip picker, (c) Use: remove 1 harmful condition (picker if multiple) AND suffer 1 Strain via applyStrain, (d) once-per-round gate keyed on Yoda's playerNum or msgId.

**Wisdom** — "At the start of your activation, you may draw 1 Command card. If you do, place 1 card from your hand on the bottom of your deck."
- Impl: `wisdom_yoda` keyed at 1 site (SoA orchestrator-wired per slice 8a 2026-05-07).
- ⚠️ suspicious — verify (a) SoA Use/Skip prompt to Yoda's controller, (b) Use: drawCcCards(1), then picker shows hand for "place 1 on bottom of deck" selection (private hand-channel UI), (c) per alexanbv 2026-05-13 privacy: drawn card stays SECRET, only count in public log; returned card name MAY be public OK since it's going to bottom of deck (which is private) — actually that's secret too. Verify the return-card log is count-only.

**Special Action (Do or Do Not)** — "Choose another friendly REBEL FORCE USER within 4 spaces. That figure becomes Focused."
- Impl: `do_or_do_not_yoda` keyed at 1 site.
- ⚠️ suspicious — verify (a) picker filters: friendly + REBEL + FORCE USER + non-self + path-4, (b) Focus applied via applyCondition (immunity respected), (c) cost = 1 action.

**Force Deflection** — "After an attack targeting you or an adjacent friendly REBEL figure resolves, you may have the attacking figure suffer Damage equal to the number of attack dice rolled. Limit once per round."
- Impl: `force_deflection_yoda` keyed at 3 sites.
- ⚠️ suspicious — verify (a) post-attack hook fires when defender is Yoda OR adjacent friendly REBEL (path-1 from Yoda), (b) "may" → Use/Skip prompt, (c) Use: attacker suffers Damage = number of attack dice in the attack pool (NOT damage rolled — die COUNT), (d) once-per-round gate keyed on Yoda.

---

## Zeb Orrelios

**Bo-Rifle Staff Strike** — "Once during your activation, you may perform a Melee attack using 2 red dice without spending an action."
- Impl: `bo_rifle_staff_strike` keyed at 2 sites; `boRifleStaffUsedThisActivation` figureKey-keyed (migrated 2026-05-09).
- ⚠️ suspicious — verify (a) once-per-activation gate via boRifleStaffUsedThisActivation[figureKey], (b) pendingOverrideAttackDice (figureKey-keyed post-2026-05-13) set with `{dice: ['red', 'red'], type: 'melee'}`, (c) freeAttackBonusPending set for Zeb's figureKey, (d) shows as a separate button on Zeb's DC card.

**Lasat-Honor Guard** — "While attacking, after any rerolls, you may turn 1 die showing only a single attack icon to any other side."
- Impl: `lasat_honor_guard` keyed at 2 sites.
- ⚠️ suspicious — verify (a) attacker-side prompt fires AFTER all rerolls resolved (timing — needs to wait for reroll chain to drain), (b) "die showing only a single attack icon" filter (face has exactly 1 hit/surge/etc.? — needs CRR clarification on what "single attack icon" means), (c) "turn to any other side" — player picks one of the other 5 faces for that die, (d) per attack scope, (e) "may" → Use/Skip.

---

## Zuckuss

**Mystic Hunter (passive)** — "When you declare an attack, you become Focused."
- Impl: passives include "Mystic Hunter"; no specific id grep hit.
- ⚠️ suspicious — verify (a) on-declare auto-applies Focus to Zuckuss via applyCondition, (b) Focus immunity respected (probably not an issue since Zuckuss has no Immune), (c) fires every attack.

**Surge (Stun Net)** — "After this attack resolves, if it did not miss, the target becomes Stunned."
- Impl: `stun_net` keyed at 2 sites; surgeAbilities entry.
- ⚠️ suspicious — verify (a) surge cost = 1 from attacker roll, (b) post-attack hook fires only on non-miss, (c) Stun applied to defender via applyCondition (immunity respected), (d) per-attack scope.

**Shared Calculations** — "While attacking, if a friendly DROID within 3 spaces has line of sight to the target space, you may force the defender to reroll 1 defense die."
- Impl: `shared_calculations_zuckuss` keyed at 1 site.
- ⚠️ suspicious — verify (a) attacker-side prompt fires when condition met (friendly DROID at path≤3 with LoS to target's space, not just to Zuckuss), (b) Use/Skip prompt, (c) Use: defender forced to reroll 1 defense die (player picks which? or random?), (d) per-attack scope.

---

## [A New Hope] (Skirmish Upgrade)

**Effect** — "Include this card in your army only if each group in your army has one of the following names or sub-names... Deplete this card to have a friendly figure play a Command card with a restriction matching the name of another Deployment card in your army."
- Impl: NO direct ANH handler — needs ability to deplete + bypass CC playableBy restriction for once.
- — no impl — Audit reveals no implementation. Needs:
  - army-build validation (each group must match list)
  - runtime deplete-once-per-game button
  - on-deplete: choose a CC, choose a friendly figure, allow play despite restriction mismatch (so long as ANOTHER DC in army matches the CC's restriction)

---

## [Advanced Com Systems] (Skirmish Upgrade)

**Effect** — "LEADER ONLY. Abilities on your Deployment card that choose or affect adjacent friendly figures or friendly figures within 2 spaces can choose or affect other friendly figures within 3 spaces instead."
- Impl: 2 sites — `combat.js:2131`, `combat.js:2805` (`cardNameIncludes(kAtts, 'Advanced Com Systems')`).
- ⚠️ suspicious — verify (a) attached only to LEADER (army-build), (b) at runtime when LEADER's DC ability targets adjacency, the range expands to path-3, (c) only adjacent / within-2 range checks are expanded (not other ranges), (d) audits in combat.js:2131 + 2786 / 2805 cover specific abilities (which ones? — probably specific reroll buckets / pickers).

---

## [Balance of the Force] (Skirmish Upgrade)

**Effect** — "You may include an additional 3 points worth of Command cards in your deck."
- Impl: build-time only — increases CC budget.
- — no impl needed at runtime — pure army-build validation. Verify deck-builder honors the +3 cost cap.

---

## [Beast Tamer] (Skirmish Upgrade)

**Effect** — "Exhaust this card at the start of a CREATURE's activation for that figure to perform a move. Exhaust this card at the start of a figure's activation if that figure has the 'NON-SENTIENT' trait. During this activation, that figure can interact."
- Impl: `src/handlers/soa-handler.js:898` — `Beast Tamer` SoA branch wired.
- ⚠️ suspicious — verify (a) two-branch picker (Speed exhaust for CREATURE OR Interact override for NON-SENTIENT), (b) "perform a move" branch grants the CREATURE's Speed in MP (line 909 sets +Speed MP), (c) "can interact during this activation" branch sets `beastTamerInteractOverride[figureKey] = true` (figkey-keyed post-2026-05-13), (d) one exhaust per round (Beast Tamer SU exhausts on use).

---

## [Black Market] (Skirmish Upgrade)

**Effect** — "At the end of each round, a friendly SMUGGLER may suffer 1 Strain. If it does, reveal the top Command card of your deck. Then choose: spend VP to draw, discard for VP, or return to top."
- Impl: `src/handlers/interrupts.js:1306` — `[Black Market]` SU handler.
- ⚠️ suspicious — verify (a) EoR trigger offers each friendly SMUGGLER (Use/Skip per SMUGGLER), (b) chosen SMUGGLER suffers 1 Strain via applyStrain, (c) top card is REVEALED publicly (per card text — explicit "reveal" — this is the alexanbv 2026-05-13 confirmed exception to the secret-card rule), (d) 3-option picker (Draw with VP cost / Discard for VP / Return to top), (e) once per EoR per SMUGGLER instance OR once per [Black Market] copy?

---

## Batch 18 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 21
- ❌ wrong-stage: 0
- — no impl: 2 ([A New Hope], [Balance of the Force] — both are army-build-only with no runtime triggers needed beyond [BoF])

**Highest-priority items surfaced:**

1. **[A New Hope] not implemented** — needs deplete-once handler that lets a friendly figure play a CC with a restriction matching another army DC's name.

2. **Yoda Force Deflection "number of attack dice rolled"** — Damage equals DIE COUNT (size of attack pool), not damage results. Verify the calc reads pool size pre-roll vs post-roll (probably attackInfo.dice.length).

3. **Yoda Calming Presence cross-figure SoA trigger** — fires on OTHER REBEL FORCE USER's SoA. SoA orchestrator must enumerate Yoda's Calming Presence as a passive owned by Yoda but TRIGGERED by another figure's activation start.

4. **Zeb Lasat-Honor Guard "single attack icon" face filter** — needs CRR clarification on what counts as "showing only a single attack icon" (1 hit only? 1 surge only? both excluded?).

5. **Advanced Com Systems range-expansion scope** — only adjacent / within-2 abilities expand to within-3. NOT all DC abilities. Audit combat.js:2131 + 2805 to verify the specific abilities being expanded.

6. **[Black Market] reveal-then-pick chain** — top card is intentionally publicly revealed per card text ("reveal"); confirmed alexanbv 2026-05-13 exception to the secret-card rule.

**Next:** Batch 19 (next 10 cards alphabetically — all Skirmish Upgrades from [B...] onward).
