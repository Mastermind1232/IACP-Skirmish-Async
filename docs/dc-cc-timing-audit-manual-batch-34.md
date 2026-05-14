# DC/CC Timing Audit — Manual Triage Batch 34

Scope: Command Cards alphabetical after "Face to Face", 10 cards:
Fatal Deception, Feint, Feral Swipes, Ferocity, Field Promotion,
Field Supply, Field Tactician, Final Stand, Findsman Meditation,
Fleet Footed.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Fatal Deception

**Effect** — "Murne Rin, cost 1, startOfActivation. When you use 'False Orders' this round, you may choose a figure with a figure cost of 5 or less within 5 spaces."
- Impl: `Fatal Deception` keyed at 1 site.
- ⚠️ suspicious — verify (a) Murne Rin only, (b) SoA timing, (c) round-long flag on Murne's player, (d) modifies False Orders' target picker: expands cost limit from 4 to 5 AND range from 4 to 5 (per card baseline of "≤4 / within 4"), (e) flag consumed only when False Orders is played; cleared at EoR otherwise.

---

## Feint

**Effect** — "BRAWLER, cost 1, duringAttack. Use while attacking a figure within 2 spaces. Choose 1 attack die and 1 defense die and remove their results from the attack and defense results."
- Impl: `Feint` — NO src hits.
- — no impl — needs: (a) BRAWLER playableBy, (b) attacker-side mid-attack, (c) range gate: target within path-2, (d) picker 1: 1 attack die set to blank, picker 2: 1 defense die set to blank (mutual symbol-removal).

---

## Feral Swipes

**Effect** — "CREATURE, cost 1, specialAction. For each die in your attack pool, perform a Melee attack using 1 red die."
- Impl: `Feral Swipes` keyed at 1 site.
- ⚠️ suspicious — verify (a) CREATURE playableBy, (b) Special Action (1 action), (c) attack-count = base attack pool die count (e.g., 3-die DC = 3 attacks), (d) each attack uses pendingOverrideAttackDice (figkey-keyed) with `{dice: ['red'], type: 'melee'}`, (e) attacks chained — first is paid via the Feral Swipes special, subsequent are free via freeAttackBonusPending count.

---

## Ferocity

**Effect** — "Any Figure, cost 1, endOfRound. Choose 1 of your or 1 of your opponent's CREATURES. Perform 1 attack with that figure."
- Impl: `Ferocity` keyed at 2 sites.
- ⚠️ suspicious — verify (a) EoR timing, (b) picker: ANY CREATURE on board (either player's), (c) Ferocity-player commands the chosen creature to attack (target picker still happens through the creature's owner? or Ferocity-player picks target too?). CRR check on agency, (d) free attack — no action cost since EoR, (e) uses creature's own attack pool.

---

## Field Promotion

**Effect** — "LEADER, cost 0, afterYouResolveAttackTargetingFigure. If that figure has been defeated and your army affiliation is REBEL or IMPERIAL, you gain 4 VPs and increase your figure cost by 2."
- Impl: `Field Promotion` keyed at 2 sites.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) REBEL/IMPERIAL affiliation gate, (c) post-attack: if attack defeated target → Use/Skip prompt, (d) +4 VP via awardObjectiveVp, (e) figure cost +2 (mutates DC stats — opponent's future kill VPs for this LEADER go up).

---

## Field Supply

**Effect** — "Ko-Tun Feralo, cost 1, startOfRound. Up to 2 other figures within 3 spaces gain 1 Hit Token or 1 Surge Token. During this round, a friendly figure who spends a Hit Token or a Surge Token may reroll 1 attack die during that attack."
- Impl: `Field Supply` keyed at 1 site.
- ⚠️ suspicious — verify (a) Ko-Tun only, (b) SoR timing, (c) per-figure picker (up to 2): adjacent-or-near friendly + token-type picker (Hit/Surge), (d) round-long passive: PT-spend triggers reroll prompt during attacks — needs PT-spend hook + attacker reroll bucket.

---

## Field Tactician

**Effect** — "SMALL, cost 1, specialAction. Choose a friendly figure within 2 spaces. That figure may interrupt to perform a move."
- Impl: `Field Tactician` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMALL trait playableBy, (b) Special Action (1 action), (c) picker: friendly within path-2, (d) chosen figure interrupts to perform a Move action (gains MP equal to their Speed, perFig-keyed via grantMovementBank post-2026-05-13).

---

## Final Stand

**Effect** — "Baze Malbus, cost 2, whenFriendlyFigureWithin3SpacesWouldBeDefeated. Move up to 2 spaces, gain 1 Power Token, and then perform an attack. Then, that friendly figure is defeated."
- Impl: `Final Stand` keyed at 13 sites; `pendingFinalStand` flag.
- ⚠️ suspicious — verify (a) Baze only, (b) BEFORE_DEFEATED hook on friendly within path-3, (c) Use/Skip prompt to Baze's owner, (d) Use: Baze 2-space Move-X (bypassCosts), Baze gains 1 PT (picker for type? or default Damage?), Baze free attack, (e) AFTER Baze's attack resolves, the originally-dying friendly proceeds to defeated, (f) memory note: Mara picker pattern queued for Final Stand alongside other BEFORE_DEFEATED migrations.

---

## Findsman Meditation

**Effect** — "Zuckuss, cost 0, startOfRound. Choose one of your opponent's groups. When your opponent activates that group during this round, you may interrupt to perform a move or an attack."
- Impl: `Findsman Meditation` keyed at 3 sites; `findsmanMeditationTarget` flag (recategorized 2026-05-13 to PLAYERNUM).
- ⚠️ suspicious — verify (a) Zuckuss only, (b) free cost, (c) SoR timing, (d) opponent-group picker stored in `findsmanMeditationTarget[playerNum]`, (e) at marked group's activation, Use/Skip prompt for Zuckuss: Move OR Attack interrupt, (f) one-time per round (flag cleared on use OR at EoR).

---

## Fleet Footed

**Effect** — "Any Figure, cost 0, duringActivation. Gain 1 movement point."
- Impl: `Fleet Footed` keyed at 3 sites.
- ⚠️ suspicious — verify (a) free cost, (b) during-activation, (c) +1 MP via grantMovementBank (figkey-keyed perFig migration), (d) MP goes into bank (not Move-X) per alexanbv 2026-05-13 ruling on in-activation MP gains.

---

## Batch 34 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Feint)

**Highest-priority items surfaced:**

1. **Feint NO IMPL** — BRAWLER mid-attack 1-att-die + 1-def-die mutual blank.

2. **Feral Swipes per-die-attack chain** — N attacks where N = base attack pool die count. Each uses `{dice: ['red'], type: 'melee'}` override; subsequent are free.

3. **Ferocity creature-attack-on-EoR** — Ferocity-player commands ANY creature (incl. opponent's). Agency on target picker — CRR question.

4. **Field Promotion cost-mutation** — increases caster's figure cost permanently (affects subsequent kill VPs). Stat mutation on the LEADER's DC.

5. **Final Stand Mara picker pattern** — per memory note (2026-05-10 audit Part 2), Mara picker pattern queued for Final Stand. Verify if landed.

6. **Findsman Meditation playerNum-keyed target** — recategorized 2026-05-13 to PLAYERNUM_FLAGS. Verify the cleanup loop wipes correctly at EoR.

**Next:** Batch 35 (next 10 CCs after Fleet Footed).
