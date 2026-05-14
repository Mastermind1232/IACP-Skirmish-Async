# DC/CC Timing Audit — Manual Triage Batch 19

Scope: Skirmish Upgrades alphabetical after [Black Market], 10 cards:
[Channel the Force], [Clan of Two], [Combat Suit], [Cross Training],
[Devious Scheme], [Doubt], [Driven by Hatred], [Explosive Armaments],
[Extra Armor], [Feeding Frenzy].

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## [Channel the Force]

**Effect** — "Exhaust this card when you would draw 1 or more Command cards. Draw 1 fewer card than you would have. Then, search your Command deck for a card with the FORCE USER trait, reveal it, and put it in your hand. Then, shuffle your Command deck. Then, choose a friendly FORCE USER. That figure suffers Strain equal to the cost of the revealed card."
- Impl: `Channel the Force` keyed at 2 sites in src/.
- ⚠️ suspicious — verify (a) interrupt fires when player WOULD draw ≥1 CCs (status-phase / Reinforcements / etc.), (b) "draw 1 fewer" — adjust the draw count down by 1, (c) search-deck-for-FORCE-USER picker (filtered by playableBy includes FORCE USER), (d) **revealed card name IS public per card text "reveal it"** (alexanbv 2026-05-13 exception to secret-card rule), (e) deck shuffled after pick, (f) friendly FORCE USER picker + Strain via applyStrain (cost = revealed card's cost).

---

## [Clan of Two]

**Effect** — "UNIQUE GUARDIAN ONLY. At the start of the mission, place The Child companion in your space or an adjacent space..."
- Impl: `Clan of Two` keyed at 11 sites in src/.
- ⚠️ suspicious — verify (a) setup-time placement of The Child companion adjacent to the unique GUARDIAN, (b) The Child activates at start OR end of GUARDIAN's activation (player choice, or always one?), (c) end-of-activation push back to adjacent (or to GUARDIAN's space), (d) Incapacitated Child excluded from control counting, (e) Child cannot suffer Damage unless directly attacked (blocks splash/AoE damage), (f) on GUARDIAN-defeat, UNIQUE figure retrieval grants 1 VP (one-time per Child or per game?).

---

## [Combat Suit]

**Effect** — "While you are defending, reduce the Pierce value of the attack results by 1, to a minimum of 0."
- Impl: `Combat Suit` keyed at 4 sites.
- ⚠️ suspicious — verify (a) defender step-4/5 mod, (b) reads `combat.attackerPierce` (or whatever the pierce accumulator is) and decrements by 1, (c) clamped at 0 (no negative pierce), (d) applies per-figure (each attached figure benefits).

---

## [Cross Training]

**Effect** — "TROOPER ONLY. This group gains the SPY trait. After deployment, this group becomes Hidden. Exhaust this card while a figure in this group is defending to reroll 1 Defense Die. Before rerolling, replace that die with another defense die of a different color. That new die is considered rerolled."
- Impl: `Cross Training` keyed at 7 sites; uses `exhaustedSkirmishUpgrades` per the memory note.
- ⚠️ suspicious — verify (a) TROOPER-only validation, (b) SPY keyword added at deploy (memory `effectiveKeywords` or similar), (c) post-deploy Hidden applied to all figures in group via applyCondition, (d) defender reroll bucket with "replace die color + reroll" 2-step picker, (e) single exhaust per round.

---

## [Devious Scheme]

**Effect** — "After setup, choose your Deployment zone. Your opponent starts the game with initiative and must deploy their figures first. If your opponent also has 'Devious Scheme', this card has no effect."
- Impl: `Devious Scheme` keyed at 1 site.
- ⚠️ suspicious — verify (a) setup-time hook flips initiative to opponent + reverses deploy order, (b) both-have-DS no-op gate (mutual cancellation), (c) deploy-zone-choice picker for DS-holder, (d) one-time at game start.

---

## [Doubt]

**Effect** — "At the end of the round, you may choose a hostile figure and discard 1 condition or Power Token from that figure. Deplete this card while a hostile figure is attacking to choose 1 attack die. Your opponent must reroll that die."
- Impl: `Doubt` keyed at 4 sites.
- ⚠️ suspicious — verify (a) EoR Use/Skip picker, (b) Use: hostile-figure picker + condition/PT pick (need 3rd picker for which condition/token if multiple), (c) deplete-while-attacking: defender bucket button to force-reroll, (d) deplete = permanent until card resets next mission (not just exhaust).

---

## [Driven by Hatred]

**Effect** — "DARTH VADER (LORD OF THE SITH) ONLY. Passive bonus: +1 Damage. You lose 'Brutality.' While attacking, you may reroll 1 attack die. At the end of each round, move up to 2 spaces. Then you may use 'Force Choke' or perform an attack. When you declare this attack, remove 1 die from your attack pool."
- Impl: `Driven by Hatred` keyed at 9 sites; `drivenByHatredAttackPenalty` flag in ROUND_OBJECT_FLAGS; `drivenByHatredForceChoke` in ROUND_DELETE_FLAGS.
- ⚠️ suspicious — verify (a) only attaches to LotS Vader, (b) +1 Damage attacker mod always-on, (c) Brutality special action removed (special-pool override), (d) attacker reroll bucket always available, (e) EoR Vader 2-space Move-X (bypassCosts) → then Force Choke OR free attack picker, (f) free-attack pool gets -1 die via attackDicePenaltyForMsgId (figkey-keyed post-2026-05-13).

---

## [Explosive Armaments]

**Effect** — "HUNTER OR DROID ONLY. Each figure in this group gains: Surge: +1 Damage, Blast 1. Exhaust this card while attacking to apply Blast 1 to the attack results."
- Impl: `Explosive Armaments` keyed at 1 site.
- ⚠️ suspicious — verify (a) HUNTER or DROID validation, (b) Surge ability injected into attacker surge pool while EA-holder attacks, (c) attacker-side exhaust button for Blast 1 application, (d) single exhaust per round.

---

## [Extra Armor]

**Effect** — "After deployment, distribute 4 Block Tokens among friendly figures."
- Impl: `Extra Armor` keyed at 5 sites.
- ⚠️ suspicious — verify (a) post-deploy hook fires after the attached group deploys, (b) picker distributes 4 Block tokens (player can split as 4-on-1, 2-2, 1-1-1-1, etc.), (c) max-cap clamping (each figure's PT max), (d) Block tokens granted via grantPowerTokens with Block type.

---

## [Feeding Frenzy]

**Effect** — "CREATURE ONLY. Exhaust this card while attacking a figure that has suffered damage to apply +1 Damage to the attack results. While attacking an adjacent figure, you gain: Surge: Recover 2 Damage."
- Impl: `Feeding Frenzy` keyed at 1 site.
- ⚠️ suspicious — verify (a) CREATURE-only validation, (b) attacker-side exhaust button for +1 Damage, gated on "target has suffered damage" (current HP < maxHP), (c) Recover-2-Damage surge injected into CREATURE's surge pool ONLY when attacking adjacent figure (path-1 gate), (d) single exhaust per round for the +1 Damage; surge always available when adjacent.

---

## Batch 19 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **[Channel the Force] reveal card name** — card text explicitly says "reveal it" so the revealed FORCE USER card name IS publicly logged per the alexanbv 2026-05-13 exception. Verify the impl actually surfaces the name (some draws default to count-only now after the privacy commit).

2. **[Clan of Two] full mission lifecycle** — placement at mission start, activation timing (start OR end of GUARDIAN), end-of-activation push back, incapacitated control exclusion, retrieve-for-VP on GUARDIAN defeat. Multi-stage flow; worth a destruct click-through.

3. **[Cross Training] "replace die color + reroll" 2-step picker** — defender picks a die, then picks a DIFFERENT color to swap in, then that swapped die is "considered rerolled" (no actual reroll roll). 2-step Discord interaction.

4. **[Devious Scheme] both-have-DS mutual cancellation** — no-op when both players run it. Verify the no-op gate runs BEFORE the initiative flip.

5. **[Driven by Hatred] EoR Vader picker chain** — 2-space Move-X (bypassCosts) → then Force Choke OR free attack picker → if attack, -1 die from pool. Multi-step.

6. **[Doubt] EoR condition-or-PT picker** — needs 3 pickers: figure → which conditions/PTs to choose from → which one to discard. Click-through depth needs verification.

**Next:** Batch 20 (next 10 cards alphabetically — SUs continuing through [F...] / [G...]).
