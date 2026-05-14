# DC/CC Timing Audit — Manual Triage Batch 39

Scope: Command Cards alphabetical after "I Make My Own Luck", 10 cards:
I Must Go Alone, Improvised Weapons, In the Shadows, Induce Rage,
Inspiring Speech, Intelligence Leak, Iron Will, Jump Jets,
Jundland Terror, Just Business.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## I Must Go Alone

**Effect** — "Obi-Wan Kenobi, cost 1, startOfRound. Until the end of the round, hostile figures cannot declare attacks targeting you unless they are within 3 spaces of you."
- Impl: `I Must Go Alone` keyed at 2 sites.
- ⚠️ suspicious — verify (a) Obi-Wan only, (b) SoR timing, (c) round-long target-restriction: hostiles attacking Obi-Wan only if attacker is within path-3, (d) attack-target validator checks IMGA flag + path distance before allowing Obi-Wan as target.

---

## Improvised Weapons

**Effect** — "Any Figure, cost 0, specialAction. Perform a Ranged attack using 1 green and 1 yellow die. You cannot use abilities during this attack."
- Impl: `Improvised Weapons` keyed at 1 site.
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) pendingOverrideAttackDice (figkey-keyed post-2026-05-13) with `{dice: ['green', 'yellow'], type: 'ranged', blockSurgeAbilities: true}`, (d) "cannot use abilities" — needs to block surge abilities + special-action follow-ups + on-declare CC plays (broader than just surge block; CRR ruling on scope).

---

## In the Shadows

**Effect** — "SMUGGLER or HUNTER, cost 1, startOfRound. Until the end of the round, hostile figures 4 or more spaces away from you do not have line of sight to you. You do not block line of sight for those figures."
- Impl: `In the Shadows` keyed at 3 sites; `roundInTheShadowsPlayerNum` flag in ROUND_NULL_FLAGS.
- ⚠️ suspicious — verify (a) SMUGGLER/HUNTER playableBy, (b) SoR timing, (c) round-long: attackers at path-≥4 cannot draw LoS to ITS caster, (d) ITS caster doesn't block LoS for distant figures (same as Scout Trooper Camouflage but CC-level), (e) bidirectional LoS gate at LoS validator.

---

## Induce Rage

**Effect** — "Any Figure, cost 1, startOfRound. Choose up to 2 figures. Each of those figures discards each of its conditions, then gains 1 Hit Token for each condition discarded this way."
- Impl: `Induce Rage` keyed at 1 site.
- ⚠️ suspicious — verify (a) SoR timing, (b) picker: up to 2 figures (either army), (c) each chosen figure: filterCondition removes ALL conditions (count first), then grant Hit Tokens = count via grantPowerTokens (Damage type per alexanbv 2026-05-08 ruling), (d) BENEFICIAL + HARMFUL both discarded (card says "each of its conditions").

---

## Inspiring Speech

**Effect** — "LEADER, cost 2, specialAction. Choose up to 2 friendly figures adjacent to you. Those figures become Focused."
- Impl: `Inspiring Speech` keyed at 1 site.
- ⚠️ suspicious — verify (a) LEADER playableBy, (b) Special Action (1 action), (c) picker: up to 2 friendly figures within path-1 of caster, (d) each gains Focus via applyCondition (immunity respected per figure).

---

## Intelligence Leak

**Effect** — "SPY, cost 1, duringActivation. Look at your opponent's hand. You may choose and discard a Command card from it. Then, you suffer Strain equal to that card's cost."
- Impl: `Intelligence Leak` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SPY playableBy, (b) during-activation, (c) opponent's hand revealed to IL caster ONLY (private hand-channel ephemeral message — already verified per the audit batch 31 privacy review), (d) optional discard picker (Skip allowed), (e) discarded card → opponent's discard pile (public — name OK to log), (f) caster suffers Strain = card cost via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire), (g) if no discard chosen, no Strain.

---

## Iron Will

**Effect** — "GUARDIAN, cost 3, whenAttackDeclaredOnYou. You cannot suffer more than 3 Damage from that attack."
- Impl: `Iron Will` keyed at 3 sites.
- ⚠️ suspicious — verify (a) GUARDIAN playableBy, (b) on-declare-against-self, (c) damage-cap of 3 applied at step-7 (damage application — clamp final damage to min(damage, 3)), (d) interacts with prevention abilities (Beskar Armor's Block tokens fire first, then IW caps the rest), (e) per-attack scope.

---

## Jump Jets

**Effect** — "Any Small Figure, cost 1, specialAction. Place your figure in an empty space within 5 spaces."
- Impl: `Jump Jets` — NO src hits.
- — no impl — needs: (a) SMALL trait playableBy, (b) Special Action (1 action), (c) empty-space picker within path-5 (or LoS-counted? probably path-counted since "place" bypasses normal movement), (d) place (not move — bypasses all movement rules: terrain, push, etc.).

---

## Jundland Terror

**Effect** — "Any Figure, cost 2, endOfRound. Choose a Tusken Raider or Bantha Rider figure. The chosen figure gains 2 movement points and may interrupt to perform an attack or Special Action."
- Impl: `Jundland Terror` keyed at 3 sites; `jundlandTerrorPlayedThisEor` flag.
- ⚠️ suspicious — verify (a) EoR timing, (b) picker: Tusken Raider OR Bantha Rider figure (either army? card says "a... figure" not "friendly"), (c) chosen figure +2 MP via grantMovementBank (perFig-keyed), (d) Use/Skip for attack OR Special Action interrupt, (e) once-per-EoR flag prevents multiple plays in same EoR.

---

## Just Business

**Effect** — "LEADER, cost 1, startOfRound. During this round, friendly Scum figures gain 'Professional' while within 3 spaces of you. (Those figures may reroll 1 attack die while attacking.)"
- Impl: `Just Business` keyed at 1 site.
- ⚠️ suspicious — verify (a) LEADER playableBy + SCUM affiliation (probably restricted to SCUM LEADER even though playableBy says "LEADER"), (b) SoR timing, (c) round-long Professional injection on friendly SCUM figures within path-3 of caster, (d) Professional adds 1-attack-die reroll bucket while attacking.

---

## Batch 39 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Jump Jets)

**Highest-priority items surfaced:**

1. **Jump Jets NO IMPL** — SMALL place-in-empty-space-within-5. Similar mechanic to Second Sister's Force Leap (audit batch 14).

2. **Improvised Weapons "cannot use abilities" scope** — CRR ruling needed on what counts as "abilities" — surge abilities only? Surge + on-declare CCs? Surge + special-action follow-ups?

3. **In the Shadows bidirectional LoS gate** — same mechanic as Scout Trooper Elite Camouflage (batch 14). Verify both check sites consistent.

4. **Induce Rage discards BENEFICIAL + HARMFUL** — "each of its conditions" is literal. Verify the impl discards ALL condition categories, not just harmful.

5. **Iron Will damage cap timing** — applied at step-7 after Block token spends. Interaction with Beskar Armor / Damage tokens.

6. **Jundland Terror cross-army targeting** — card says "a Tusken Raider or Bantha Rider figure" (not "friendly"). Either player's Tusken/Bantha can be commanded by the JT player.

**Next:** Batch 40 (next 10 CCs after Just Business).
