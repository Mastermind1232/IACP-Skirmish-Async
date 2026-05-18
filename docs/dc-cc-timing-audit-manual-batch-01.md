# DC/CC Timing Audit — Manual Triage Batch 01

Scope: first 10 Deployment Cards alphabetically: 0-0-0, 4-LOM,
74-Z Speeder Bike (Elite), 88-Z, AT-DP, AT-RT, AT-ST, Agent Blaise,
Agent Kallus, Ahsoka Tano.

This batch was missing from the original audit pass and is filled in
here for completeness (alexanbv 2026-05-17). Format matches batches
02-53.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## 0-0-0

**Surge (Shocking Palm)** — "The attack misses and the defender becomes Stunned."
- Impl: `shocking_palm` keyed at 1 site; surgeAbilities entry.
- ⚠️ suspicious — verify (a) surge cost = 1 from attacker pool, (b) attack force-misses (attackerResult treated as miss regardless of accuracy/damage), (c) defender still Stunned via applyCondition (immunity respected), (d) per-attack scope.

**Special Action (Invasive Procedure)** — "An adjacent figure suffers 1 Damage, 1 Strain, and becomes Bleeding. You become Focused."
- Impl: `invasive_procedure` keyed at 1 site; dc-play-area.js:3210 has Dubious Counterparts (Aphra) bonus-action hook.
- ⚠️ suspicious — verify (a) Special Action (1 action), (b) adjacent picker (friendly OR hostile? — card says "An adjacent figure" literal includes friendly), (c) target: 1 Damage via standard pipeline + 1 Strain via applyStrain (Fireproof/Headhunter fire) + Bleeding via applyCondition (immunity respected), (d) 0-0-0 gains Focus via applyCondition.

**Unnerving (passive)** — "At the end of your activation, each adjacent hostile figure becomes Weakened."
- Impl: `unnerving` — NO src hits.
- — no impl OR ⚠️ suspicious — EoA hook for 0-0-0 needed: iterate adjacent hostiles (path-1) + Weaken each via applyCondition.

---

## 4-LOM

**Programming Override** — "At the start of each round, choose one TRAIT. You gain that TRAIT until the end of the round."
- Impl: `programming_override_4lom` keyed at 1 site; `roundProgrammingOverrideTrait` round-flag.
- ⚠️ suspicious — verify (a) SoR prompt to 4-LOM's player, (b) trait picker (full trait list — HUNTER, SPY, TROOPER, LEADER, etc.), (c) round-long flag adds trait to 4-LOM's effectiveKeywords, (d) EoR revert.

**Surge (Concussive Bolt)** — "After this attack resolves, if you are targeting a SMALL figure and it did not miss, you may push that figure 1 space."
- Impl: `concussive_bolt` keyed at 7 sites; `pendingConcussiveBolt` flag.
- ⚠️ suspicious — verify (a) surge cost = 1, (b) post-attack non-miss + SMALL-target gates, (c) "may" → Use/Skip push prompt, (d) 1-space push picker (player picks landing space).

**Shared Intuition** — "While attacking, if another friendly HUNTER within 3 spaces has line of sight to the target space, apply +1 Damage to your attack results."
- Impl: `shared_intuition` keyed at 2 sites.
- ⚠️ suspicious — verify (a) attacker step-4 mod check: any OTHER friendly HUNTER within path-3 of 4-LOM with LoS to target space → +1 Damage, (b) "another" excludes 4-LOM himself (he can be HUNTER but doesn't count), (c) per-attack scope.

---

## 74-Z Speeder Bike (Elite)

**Efficient Travel + Mounted + Thrusters + Forward Mounted Blasters** (all passives)
- Impl: shared keyword/passive sites; `mounted` shared family (2 sites); `thrusters` no src hits.
- ⚠️ suspicious — verify (a) Efficient Travel: movement validator ignores difficult-terrain + hostile-figure cost adders, (b) Mounted: SoA hook grants +3 MP via grantMovementBank (perFig-keyed per 2026-05-13 migration), (c) Thrusters: movement validator allows passing impassable terrain BUT requires ending at least 1 space in current footprint (anchor-cell constraint), (d) Forward Mounted Blasters: same-row +1 Damage gate at step-4 attacker mod — requires target's space to share a row with BOTH of speeder's 2 cells (multi-cell figure).

---

## 88-Z

**Effect** — abilityText is empty in dc-effects.json.
- Impl: nothing wired (no abilityIds).
- — no impl — 88-Z appears to be a vanilla DC with no special abilities. Just dice + passives if any. Verify dc-stats has attack pool / health / passives populated.

---

## AT-DP

**Assault (passive)** — "You can perform multiple attacks during your activation."
- Impl: handled via keyword/passive check on `attackPerformedThisActivation` figkey gate (per migration commit `997b5cc3`).
- ✅ correct — Assault is a recognized passive that bypasses the once-per-activation attack gate. Each figure with Assault (single-figure here for AT-DP) can attack multiple times.

**Charge Generators** — "While attacking, if you have suffered fewer than 9 Damage, apply +1 Damage to the attack results and you may reroll 1 attack die."
- Impl: `charge_generators` keyed at 1 site.
- ⚠️ suspicious — verify (a) HP check: damage-suffered < 9 → (maxHp - currentHp < 9), (b) +1 Damage at step-4 attacker mod, (c) named attacker reroll bucket (1 die), (d) per-attack scope, (e) if AT-DP heavily wounded (damage ≥ 9), CG disables.

---

## AT-RT

**Mortar Launcher** — "At the end of the round, you may move up to 2 spaces. Then, choose a space within 3 spaces that contains a hostile figure and roll 1 red die. Each figure on or adjacent to that space suffers Damage equal to the Damage results."
- Impl: `mortar_launcher` — NO src hits.
- — no impl — needs: (a) EoR Use/Skip hook for AT-RT, (b) 2-space Move-X with bypassCosts, (c) hostile-occupied space picker within path-3, (d) 1 red die roll, (e) AoE: figures on/adjacent to chosen space suffer Damage = Damage rolled, via standard pipeline (object damage hook for objects).

**Vanguard** — "While attacking a figure within 3 spaces, you may replace one die in your attack pool with 1 red die."
- Impl: `vanguard` keyed at 4 sites (shared with Vanguard SU mechanic on AT-ST).
- ⚠️ suspicious — verify (a) attacker side, (b) gate: target within path-3, (c) picker: 1 attack die in pool → replace with red die, (d) per-attack scope.

---

## AT-ST

**Targeting Computer** — "While attacking, you may reroll 1 attack die."
- Impl: `targeting_computer_atst` keyed at 1 site (shared family with Probe Droid Elite, Sentry Droid, etc.).
- ⚠️ suspicious — verify (a) attacker named reroll bucket (1 die per attack), (b) AT-ST is single-figure so no multifig concern.

**Awkward** — "You cannot attack adjacent figures."
- Impl: `awkward_atst` keyed at 1 site.
- ⚠️ suspicious — verify (a) attack-target validator excludes path-1 targets from AT-ST's target picker, (b) gate fires at target-picker render time (not after pick).

---

## Agent Blaise

**Adapt** — "The first time your opponent plays a Command card each round, choose 1 SPY or TROOPER. That figure becomes Hidden."
- Impl: `adapt_blaise` keyed at 2 sites.
- ⚠️ suspicious — verify (a) first-opponent-CC-per-round trigger gated by round-flag, (b) picker: friendly SPY OR TROOPER, (c) Hide applied via applyCondition (immunity respected), (d) once-per-round cleanup at SoR.

**Surge (Interrogate)** — "Look at your opponent's hand and choose a Command card. You may discard a card of equal or greater cost from your hand to discard the chosen card."
- Impl: `interrogate` keyed at 7 sites; `pendingInterrogate` flag.
- ⚠️ suspicious — verify (a) surge cost = 1, (b) opponent's hand revealed to Blaise's player only (private hand-channel ephemeral per privacy commit), (c) picker: opponent's CC to target for discard, (d) Blaise's hand picker: own CC of cost ≥ target's cost, (e) both discards go to public discard piles — names OK to log per privacy rule.

---

## Agent Kallus

**Hunt Dissent** — "When your opponent plays a Command card, you may distribute 2 Damage Tokens among friendly figures within 1 space. Limit once per round."
- Impl: `hunt_dissent_kallus` keyed at 4 sites; `huntDissentResolvedThisRound` + `pendingHuntDissent` flags.
- ⚠️ suspicious — verify (a) on-opponent-CC-play trigger, (b) Use/Skip prompt to Kallus's player, (c) once-per-round gate via `huntDissentResolvedThisRound[playerNum]`, (d) picker chain: 2 Damage Tokens distributed across adjacent friendlies (path-1 from Kallus; can stack on one figure or split), (e) tokens via grantPowerTokens with max-cap.

**Fulcrum** — "At the start of your activation, you may have each player draw 1 Command card."
- Impl: `fulcrum` keyed at 3 sites; SoA orchestrator-wired (per soa-handler.js:743 pattern).
- ⚠️ suspicious — verify (a) SoA Use/Skip prompt, (b) Use: both players drawCcCards(1) — count-only public log per privacy commit, (c) Kallus's player triggered the effect so log attribution is on Kallus.

**Bo-Rifle** — "Before you declare an attack, you may treat your attack type as Melee. If you do, replace 1 blue die with 1 red die."
- Impl: `bo_rifle_kallus` keyed at 1 site; pendingOverrideAttackDice figkey-keyed (post-2026-05-13 migration).
- ⚠️ suspicious — verify (a) on-declare Use/Skip prompt, (b) Use: pendingOverrideAttackDice[figureKey] with `{dice: meleeDice, type: 'melee'}` where meleeDice = Kallus's pool with blue→red swap, (c) per-attack play.

---

## Ahsoka Tano

**Special Action (Force Leap)** — "Place your figure in an empty space within 6 spaces."
- Impl: `force_leap_ahsoka` — NO src hits. (Likely shared mechanic with Second Sister's Force Leap and the CC Jump Jets — all "place in empty space within N" mechanics.)
- — no impl — needs: (a) Special Action (1 action), (b) empty-space picker within path-6 (or LoS-counted? probably path-counted since "place" bypasses normal movement), (c) place (not move — bypasses terrain costs, push immunity, etc.).

**Vigor** — "At the start of your activation, you may gain 2 movement points or 1 Block Token."
- Impl: `vigor` keyed at 3 sites.
- ⚠️ suspicious — verify (a) SoA Use/Skip prompt, (b) 2-option picker: 2 MP via grantMovementBank (perFig-keyed per perFig migration 2026-05-13) OR 1 Block Token via grantPowerTokens with max-cap.

**Twin Sabers** — "While attacking, you may reroll all attack die or force the defender to reroll all defense die."
- Impl: `twin_sabers_ahsoka` keyed at 1 site.
- ⚠️ suspicious — verify (a) attacker-side mid-attack, (b) 2-option picker: reroll ALL attack dice OR force defender to reroll ALL defense dice (whole-pool reroll, not single die), (c) per-attack play.

---

## Batch 01 — Summary

- ✅ correct: 1 (Assault on AT-DP via figkey migration)
- ⚠️ suspicious: 17
- ❌ wrong-stage: 0
- — no impl: 4 (Unnerving on 0-0-0, 88-Z vanilla, Mortar Launcher on AT-RT, Force Leap on Ahsoka)
- vanilla/no-text: 1 (88-Z empty abilityText)

**Highest-priority items surfaced:**

1. **Unnerving (0-0-0) NO IMPL** — EoA AoE Weaken on adjacent hostiles. Simple SoA-orchestrator-style hook.

2. **Mortar Launcher (AT-RT) NO IMPL** — EoR Move-X-2 + AoE damage chain. Multi-step (move + space pick + die roll + AoE). Substantial impl needed.

3. **Force Leap (Ahsoka) NO IMPL** — parallel to Second Sister's Force Leap (batch 14 also NO IMPL) and Jump Jets CC (batch 39 also NO IMPL). Three cards share the same "place in empty space within N" mechanic — implementing the shared helper would close all three at once.

4. **88-Z empty abilityText** — verify in dc-stats whether 88-Z has attack pool / health / etc. defined elsewhere. May be a placeholder or removed card.

5. **0-0-0 Shocking Palm surge** — attack force-misses regardless of accuracy/damage. Distinctive surge that overrides normal attack-resolves-with-hits flow.

6. **74-Z Forward Mounted Blasters same-row check** — multi-cell figure (2 cells) needs both cells AND target on same row. Geometry edge case.

7. **Agent Blaise Interrogate hand-reveal** — opponent's hand to Blaise's player only. Private hand-channel ephemeral per the privacy rule (commit `31b285e0` / `b0ab67f8`).

**This concludes batches 01-53** — the full alphabetical pass of the IACP card set is now in `docs/`.
