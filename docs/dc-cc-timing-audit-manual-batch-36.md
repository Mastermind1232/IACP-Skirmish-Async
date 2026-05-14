# DC/CC Timing Audit — Manual Triage Batch 36

Scope: Command Cards alphabetical after "Force Rush", 10 cards:
Force Surge, Foresee, Forward March, Fuel Upgrade, Furious Charge,
Gauntlet Blade, Get Behind Me!, Glory of the Kill, Grenadier,
Grisly Contest.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Force Surge

**Effect** — "Force User, cost 2, endOfActivation. Move up to 1 space. Then, choose an adjacent hostile figure. That figure suffers 2 Damage and 1 Strain."
- Impl: `Force Surge` keyed at 3 sites.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) EoA timing, (c) 1-space Move-X (bypassCosts per alexanbv 2026-05-13), (d) after move resolves, adjacent-hostile picker (path-1 from FS-caster's new position), (e) 2 Damage via standard pipeline + 1 Strain via applyStrain (Fireproof/Headhunter fire).

---

## Foresee

**Effect** — "Thrawn, cost 0, duringActivation. Look at the top 2 Command cards of your opponent's deck and discard 1 of those cards. If its cost is 1 or less, draw 1 Command card."
- Impl: `Foresee` keyed at 1 site (abilities.js:9500 `foreseeEffect`).
- ⚠️ suspicious — verify (a) Thrawn only, (b) during-activation timing, (c) look at top-2 — private to Foresee caster (picker UI in private hand-channel per privacy), (d) discard 1 — name OK to log (going to public discard pile), (e) other card stays SECRET on top of opponent's deck (per alexanbv 2026-05-13 ruling confirmed; my fix already accounts for it), (f) cost ≤1 bonus draw — Foresee caster draws 1 card (count-only public log per privacy commit; the drawn card stays SECRET — fixed in commit `b0ab67f8`).

---

## Forward March

**Effect** — "VEHICLE, cost 1, duringActivation. Each friendly figure within 2 spaces of you gains 1 movement point."
- Impl: `Forward March` keyed at 1 site.
- ⚠️ suspicious — verify (a) VEHICLE playableBy, (b) during-activation, (c) iterate friendly figures within path-2 of FM-caster, (d) each gets +1 MP via grantMovementBank (figureKey-keyed per perFig migration 2026-05-13), (e) MP goes into each figure's per-figure bank.

---

## Fuel Upgrade

**Effect** — "Any Figure, cost 1, startOfRound. Until the end of the round, each of your VEHICLES gains +1 Speed and applies +1 Evade to its defense results."
- Impl: `Fuel Upgrade` keyed at 2 sites.
- ⚠️ suspicious — verify (a) SoR timing, (b) round-long passive on caster's VEHICLE figures, (c) +1 Speed at movement-validator (each VEHICLE moves +1 cell per MP-spend? or +1 total Speed when Move-action triggers?), (d) +1 Evade at defender step-5 mod, (e) round-end revert.

---

## Furious Charge

**Effect** — "Gaarkhan, cost 2, afterAttackTargetingYouResolved. If you suffered 3 or more Damage, ready your Deployment card."
- Impl: `Furious Charge` keyed at 7 sites.
- ⚠️ suspicious — verify (a) Gaarkhan only, (b) post-attack-against-self trigger, (c) gate: Gaarkhan suffered ≥ 3 Damage in this attack, (d) ready DC: clear exhausted state for Gaarkhan's DC so he can activate again this round.

---

## Gauntlet Blade

**Effect** — "Bo-Katan Kryze, cost 1, afterAttackTargetingYouResolved. Choose an adjacent hostile figure and roll 1 green die. That figure suffers Damage equal to the Hit results. Then, if you rolled a Surge, gain a Power Token."
- Impl: `Gauntlet Blade` keyed at 1 site.
- ⚠️ suspicious — verify (a) Bo-Katan only, (b) post-attack-against-self trigger (does NOT require Bo-Katan to have suffered damage — fires on any resolved attack against her), (c) adjacent hostile picker (path-1 from Bo-Katan), (d) 1 green die roll, (e) damage = Hit results via standard pipeline, (f) if surge rolled → gain 1 PT (picker for type? or default).

---

## Get Behind Me!

**Effect** — "GUARDIAN or FORCE USER, cost 2, whenAttackDeclaredTargetingFriendlySmallFigureCost10OrLessWithin3Spaces. Move up to 3 spaces into a space adjacent to that figure that can be targeted by the attack. The attack targets you instead, if able."
- Impl: `Get Behind Me!` keyed at 7 sites.
- ⚠️ suspicious — verify (a) GUARDIAN/FORCE USER playableBy, (b) on-declare-against-friendly trigger, (c) target eligibility: SMALL + cost ≤ 10 + within path-3 of caster, (d) Use: 3-space Move-X to land adjacent to target AND in attacker's range/LoS, (e) retarget: combat.defenderFigureKey = caster, (f) "if able" gate: caster must be reachable + targetable; if no valid landing space, ability fizzles.

---

## Glory of the Kill

**Effect** — "HUNTER, cost 1, afterAttack. If the defender was defeated, recover 3 Damage."
- Impl: `Glory of the Kill` — NO src hits.
- — no impl — needs: (a) HUNTER playableBy, (b) post-attack timing, (c) defender-was-defeated gate, (d) Use: caster recovers 3 Damage via heal pipeline.

---

## Grenadier

**Effect** — "TROOPER, cost 3, specialAction. Choose a space within 3 spaces and roll 1 red die. Each figure on or adjacent to the chosen space suffers Damage equal to the Hit results."
- Impl: `Grenadier` keyed at 1 site.
- ⚠️ suspicious — verify (a) TROOPER playableBy, (b) Special Action (1 action), (c) space picker: within path-3 of caster, (d) 1 red die roll, (e) AoE: each figure on/adjacent to chosen space (path-0 + path-1) suffer Hit-Damage via standard pipeline, (f) friendly inclusion? Card says "each figure" not "each hostile" — friendly inclusion is literal.

---

## Grisly Contest

**Effect** — "BRAWLER, cost 2, duringActivation. An adjacent hostile figure suffers 2 Damage. Then, you suffer 2 Strain."
- Impl: `Grisly Contest` — NO src hits.
- — no impl — needs: (a) BRAWLER playableBy, (b) during-activation, (c) adjacent hostile picker (path-1 from caster), (d) 2 Damage to target via standard pipeline, (e) 2 Strain to caster via applyStrain (Fireproof/Headhunter/Submit-or-Fight fire).

---

## Batch 36 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 8
- ❌ wrong-stage: 0
- — no impl: 2 (Glory of the Kill, Grisly Contest)

**Highest-priority items surfaced:**

1. **Glory of the Kill NO IMPL** — HUNTER post-attack-on-defeat self-heal 3.

2. **Grisly Contest NO IMPL** — BRAWLER 2-Damage-to-hostile + 2-Strain-to-self.

3. **Get Behind Me! "if able" reachability check** — multiple gates: SMALL target, cost ≤ 10, within 3, valid landing space adjacent to target AND in attacker's range/LoS. Verify ALL gates checked before retarget.

4. **Gauntlet Blade unconditional post-attack trigger** — fires on ANY attack against Bo-Katan (not gated on damage suffered). Distinct from Counter Attack / Furious Charge.

5. **Foresee privacy** — bonus draw stays secret (fixed in `b0ab67f8`); the other top-card stays on opponent's deck (not named). Confirmed correct per alexanbv 2026-05-13 ruling.

6. **Grenadier AoE friendly inclusion** — "each figure" literal includes friendlies. Verify AoE doesn't filter to hostile-only.

**Next:** Batch 37 (next 10 CCs after Grisly Contest).
