# DC/CC Timing Audit — Manual Triage Batch 08

Scope: DCs alphabetical after Hired Gun (Elite), 10 cards: Hired Gun
(Regular), Hondo Ohnaka, IG-11, IG-88, ISB Infiltrator (Elite), ISB
Infiltrator (Regular), Iden Versio, Imperial Officer (Elite), Imperial
Officer (Regular), J4X-7.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Hired Gun (Regular)

**Parting Shot** (shared `parting_shot_*` family) — same BEFORE_DEFEATED hook as Greedo / Hired Gun (Elite).
- Impl: `data/ability-library.json:parting_shot_hired_gun_reg` (descriptor) + `src/game/damage-pipeline-hooks.js:559+` (shared hook family).
- ✅ correct — fires via the BEFORE_DEFEATED pipeline-hook (HP→0 first, then Stun-gated PS prompt).

**Disposable** — "While defending, apply -1 Evade to your defense results."
- Impl: `src/game/evade-debuff-helpers.js` (shared with HK-47 Conclusion / Loku) + `src/handlers/combat.js`.
- ✅ correct — step-4 defender passive; subtracts 1 from defender's final evade count (clamped at 0).

---

## Hondo Ohnaka

**Negotiate** — "When you declare an attack, apply +2 Damage to the attack results unless the defender pays you 2 VPs."
- Impl: `src/handlers/combat.js:6846-6860` (step-4 attacker modifier). If defender's VP total < 2 → auto-apply +2 Hit; else prompt defender to pay 2 VP or accept +2 Hit.
- ⚠️ suspicious — verify (a) "pays you 2 VPs" actually **transfers** 2 VP from defender to Hondo's player (not just spends). (b) The auto-apply when defender has <2 VP correctly handles partial VP (e.g., defender has 1 VP — still can't pay, so +2 Hit). (c) Card says "+2 Damage to the **attack results**" — should be `bonusHits` (which represents Hit results = Damage adders). The impl uses `bonusHits` — correct.

**What's Yours is Mine** — "At the end of a round, if you are in an opponent's deployment zone, that opponent loses 2 VPs and you gain 2 VPs. Limit once per mission."
- Impl: `src/handlers/round.js:463-475+` — EoR check; auto-detects if Hondo is in opponent DZ; once-per-mission gate.
- ⚠️ suspicious — verify (a) once-per-MISSION gate persists across rounds (not once-per-round), (b) "if you are" → at LEAST one Hondo figure is in the DZ (Hondo's group could be multi-figure with attachments; though canonically Hondo is unique), (c) opponent's VP can go negative or floors at 0.

---

## IG-11

**Special Action (Rapid Fire)** — "Perform 2 attacks."
- Impl: `data/ability-library.json:rapid_fire_ig11` — `freeAttackBonus: true`, `freeAttackBonusCount: 2`. Generic dcSpecial handler grants 2 free attacks via `freeAttackBonusPending`.
- ✅ correct — Special Action; player gets 2 free attacks (no different-target requirement since card doesn't say so).

**Targeting Computer** — `targeting_computer_ig11` in the shared id family.
- Impl: `src/game/targeting-computer-helpers.js` + reroll bucket.
- ✅ correct.

**Self-Destruct Protocol** — "When you have suffered Damage equal to your Health, before you are defeated, you may move up to 3 spaces and roll 1 red die. Each figure or object adjacent to you suffers Damage equal to the Damage results. Then, you are defeated."
- Impl: `src/game/damage-pipeline-hooks.js` (BEFORE_DEFEATED hook), `src/handlers/interrupts.js` (Self-Destruct flow), `src/domain/sagas/interrupt-saga.js`, `src/handlers/index.js` (button registration).
- ⚠️ suspicious — verify (a) "may move up to 3 spaces" presents a move picker BEFORE the red-die roll (so IG-11 can position the splash), (b) "each figure or object adjacent" includes friendly figures (canonical IACP "each figure" includes both teams), (c) objects (terminals, doors, mission tokens) take damage too via `object-damage-pipeline.js`, (d) IG-11 is defeated AFTER the splash damage applies.

---

## IG-88

**Arsenal** — "Your attack pool consists of any combination of 2 attack dice."
- Impl: `src/engine/available-actions.js`, `src/handlers/dc-play-area.js`, `src/handlers/index.js` (button routing). 2-die combo enumeration; differs from Epic Arsenal (3 dice + color cap).
- ✅ correct.

**Relentless** — see batch 06; shared family. IG-88's variant has range 3 (the standard).
- ✅ correct (post-batch-06 fix preserves the range-3 cap for non-Fifth-Brother ids).

**Assault** — multi-attack passive.
- ✅ correct (action-availability gate).

---

## ISB Infiltrator (Elite)

**In The Shadows** — "When you are deployed and at the end of your activation, you become Hidden."
- Impl: post-deploy at `src/handlers/post-deploy.js:80-82, 298-300` (applies Hide); EoA at `src/engine/activation-effects.js:142-152`.
- ✅ correct — both triggers fire (post-deploy AND EoA Hide).

**Comms Jammer** — "Your opponent cannot play Command cards during your activation."
- Impl: `src/game/soa-orchestrator.js:211-225` (descriptor surfaced at SoA for player-driven timing) + `src/game/cc-timing.js` (blocks opponent CC plays during the active group's activation) + `src/engine/activation-effects.js`, `src/engine/activation-setup.js`.
- ⚠️ suspicious — verify (a) "during your activation" runs from SoA → EoA inclusive, (b) the block is opponent-only (player can still play their own CCs), (c) the cc-timing gate cleanly clears at EoA so opponent regains CC play immediately. Also: if multiple ISB Elite groups activate sequentially, ensure the block stacks (no race condition between groups).

**Special Action (Coordinated Raid Elite)** — "Another friendly IMPERIAL figure with figure cost of 4 or less within 4 spaces may interrupt to perform an attack. Limit once per group per round."
- Impl: `src/game/abilities.js:1499+` — `coordinated_raid_elite` keyed; picker enumerates friendly IMPERIAL figures cost ≤4 within 4 spaces; chosen figure gets `setPendingCoordinatedRaid` + `freeAttackBonusPending`.
- ⚠️ suspicious — verify (a) the cost-4 filter uses the BASE figure cost (not adjusted by attachments), (b) "within 4 spaces" is path-counted (door-aware), (c) "Limit once per group per round" gates via `roundFigureAbilityUsed` keyed on the GROUP, not the figure — so multiple Elite figures in a 2-figure group share the once-per-round.

---

## ISB Infiltrator (Regular)

**Special Action (Coordinated Raid Regular)** — "Another figure in your group may interrupt to perform an attack targeting a hostile figure in your line of sight. Limit once per group per round."
- Impl: `src/game/abilities.js:coordinated_raid_regular` keyed (separate handler from Elite variant).
- ⚠️ suspicious — Regular's variant differs from Elite:
  - Target: "another figure in your group" (same DC + same DG index) — not any friendly Imperial within 4.
  - Constraint: "targeting a hostile figure in YOUR (Regular's) line of sight" — not just any target.
  
  Verify both differences are encoded in the picker / target enumeration. If shared code paths between Elite and Regular conflate the rules, the Regular variant would be wrong.

---

## Iden Versio

**Droid Kit** — "Once during your activation, if a friendly 'Dio' is in your space, you may gain 1 Power Token."
- Impl: `data/ability-library.json:droid_kit_iden` (descriptor) + `src/game/droid-kit-helpers.js` + `src/engine/activation-setup.js`, `src/handlers/activation.js`.
- ⚠️ suspicious — verify (a) "in your space" = same footprint cell (Dio is on Iden's exact space; not adjacent), (b) once-per-activation gate, (c) "you may" → Use/Skip prompt with token-type picker for the granted Power Token (since the card doesn't specify a type — IACP convention is the player picks).

**Pulse Cannon** — "While attacking, if you spent a Power Token during this attack, apply an additional +4 Accuracy and +1 Damage to the attack results."
- Impl: `src/handlers/combat.js:6806-6817` — checks `combat.attackerSpentPowerToken` flag at step-4 attacker mods; if Iden's specialAbilityIds includes `pulse_cannon_iden`, adds +4 Acc + 1 Hit. Gated by `pulseCannonResolved` (once per attack).
- ✅ correct — step-4 attacker; once-per-attack via `pulseCannonResolved`. `attackerSpentPowerToken` flag set at every attacker token-spend site (same family as Bodhi Air Support — fix in commit 98add05b also touched these sites).

**ID10 Seeker Droid** — "At the start of the game, put the 'Dio' companion into play in your space. It activates at the start or end of your activation, and is not counted for the purposes of control."
- Impl: `src/game/board-helpers.js:114` (excludes ID10/Dio from control counting). Dio companion placement likely happens at deploy via standard companion machinery.
- ⚠️ suspicious — verify (a) Dio is auto-placed in Iden's space at setup (not requiring a separate deploy step), (b) Dio's "start or end of your activation" is a CHOICE — does the SoA/EoA flow present a picker, or default to one? Standard IACP companions activate together with the host; this card explicitly allows the choice.

---

## Imperial Officer (Elite)

**Special Action (Executive Order)** — "Choose another friendly Imperial figure within 2 spaces. That figure may interrupt to perform a move or attack."
- Impl: `src/game/abilities.js:1177+` — `executive_order` keyed; picker enumerates friendly Imperial figures within 2 spaces; chosen figure gets the interrupt with action choice (move or attack).
- ⚠️ suspicious — verify (a) "another friendly **Imperial** figure" — affiliation filter (not just any friendly), (b) within-2 is path-counted, (c) "may interrupt to perform a move **or attack**" — confirm BOTH options are offered to the chosen figure's owner (not just one or auto-pick).

---

## Imperial Officer (Regular)

**Special Action (Order)** — "During a campaign... During a skirmish, that figure gains 2 movement points."
- Impl: `src/game/abilities.js:1254+` — `officer_order` keyed; gives 2 MP to chosen friendly within 2 spaces via `pendingMoveX`.
- ✅ correct — skirmish-only branch (skip the campaign clause); 2 MP grant via pendingMoveX with `bypassCosts: false` so terrain/figure adders apply normally.

**Cower** (`cower_imperial_officer_reg`, shared id family with C-3P0 Cower) — defender reroll while adjacent friendly.
- Impl: `src/handlers/combat.js` — same handler as `cower_c3po`.
- ✅ correct.

---

## J4X-7

**Supporting Fire** — "While another friendly figure is attacking a figure adjacent to you, apply Pierce 1 to the attack results. Limit once per activation."
- Impl: **❌ NO IMPL.** The DC entry in dc-effects.json has no `specialAbilityIds` field at all — Supporting Fire isn't wired. (The few J4X mentions in src/ are for other interactions like Focus + free-attack-bonus from CCs.)
- ❌ wrong-stage / missing — completely unwired. Need to:
  1. Add `supporting_fire_j4x7` to `specialAbilityIds` in dc-effects.json.
  2. Add a step-4 attacker passive trigger: for every attack, check if J4X-7 is adjacent to the target AND the attacker is another friendly figure → +1 Pierce.
  3. Limit once per activation (per J4X-7 figure) via `roundFigureAbilityUsed[<j4xFk>_supporting_fire_<activationNonce>]` or similar.

---

## Batch 08 — Summary

- ✅ correct: 10
- ⚠️ suspicious: 11
- ❌ wrong-stage / missing: 1 (J4X-7 Supporting Fire — completely unwired)
- — no impl: 0 (Supporting Fire is the ❌ above)

**Highest-priority items surfaced this batch:**

1. **J4X-7 Supporting Fire** — completely unwired. Similar pattern to BD-1 Terminal Slicing (fixed in batch 07 follow-up): missing `specialAbilityIds`, missing handler. Same fix structure: add ability id, add step-4-atk handler with adjacency + once-per-activation gate.

2. **IG-11 Self-Destruct Protocol** — verify the move-then-splash ordering: card says "move up to 3 spaces and roll 1 red die. Each figure or object adjacent to you..." → IG-11 picks new position FIRST, then the splash radius is computed from the new position. Bug pattern: if splash fires from old position, IG-11 can't reposition to maximize splash.

3. **Hondo Negotiate VP transfer** — verify "pays you 2 VPs" is a transfer (defender -2, Hondo +2), not just a spend.

4. **ISB Coordinated Raid Elite vs Regular** — distinct rules. Elite: friendly Imperial cost ≤4 within 4. Regular: same-group + Regular's LoS. Verify the two handlers don't share code that conflates the rules.

5. **Iden ID10 Seeker Droid auto-deploy + activation choice** — verify Dio is placed in Iden's space at setup and the start-or-end-of-activation choice is presented to Iden's owner.

**Next:** Batch 09 (DCs alphabetical after J4X-7).
