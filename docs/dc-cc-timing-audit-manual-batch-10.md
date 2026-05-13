# DC/CC Timing Audit — Manual Triage Batch 10

Scope: DCs alphabetical after K-2S0, 10 cards: KX-Series Security Droid
(Elite), Kanan Jarrus, Kayn Somos, Ko-Tun Feralo, Krrsantan, Kuiil,
Lando Calrissian, Leia Organa, Loku Kanoloa, Loth-cat (Elite).

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## KX-Series Security Droid (Elite)

**Special Action (Shoulder Rush)** — "Move up to 2 spaces and choose an adjacent hostile figure. If that figure is SMALL, push it 1 space and enter the space it exited. Then, perform an attack targeting the chosen figure."
- Impl: `src/handlers/movement.js`, `src/handlers/dc-play-area.js`, `src/handlers/move-x-handler.js`, `src/engine/available-actions.js`, `src/handlers/index.js` button routing.
- ⚠️ suspicious — multi-step picker (move-2 → pick adjacent hostile → push-if-SMALL → attack-target-locked-to-chosen). Verify (a) the post-move adjacency check uses the NEW position (not the pre-move position), (b) SMALL-only push (non-SMALL targets get attacked directly without push), (c) "enter the space it exited" — the attacker moves into the hostile's old space, (d) the attack target is **forced** to the chosen figure (no other target options offered).

**Deference Protocol** — "Once per round, when a friendly LEADER enters an adjacent space, you may gain 1 Block token."
- Impl: `src/handlers/movement.js` (`deference_protocol` keyed) — triggered when LEADER moves into adjacent.
- ⚠️ suspicious — "**may** gain" → confirm Use/Skip prompt (player chooses); per memory `feedback_no_chebyshev_stopgap.md` similar "may" auto-grants are recurring concern. Also verify once-per-round gate persists.

---

## Kanan Jarrus

**Force Vision** — "At the start of your activation, your opponent chooses one of their ready groups and must activate it next if possible."
- Impl: `src/game/soa-orchestrator.js`, `src/game/phase-gate.js`, `src/engine/activation-setup.js`, `src/handlers/soa-handler.js`.
- ⚠️ suspicious — verify (a) opponent's picker enumerates only **ready** (not-yet-activated, not-exhausted) groups, (b) the chosen group is locked-in for the next opponent activation phase ("must activate next if possible"). Edge case: opponent has no ready groups → trigger no-ops.

**Soresu Form** — "While a friendly figure within 3 spaces is defending, it may reroll 1 die. If it does, convert each Dodge result to 2 Block and 1 Evade and, if that figure is not FORCE USER, you suffer 1 Strain."
- Impl: `src/handlers/combat.js` (`soresu_form` keyed).
- ⚠️ suspicious — three-part effect: (1) within-3 friendly defender reroll bucket (player choice), (2) Dodge→2 Block + 1 Evade conversion on the rerolled die, (3) Kanan suffers 1 Strain if the rerolling friendly is NOT FORCE USER. Verify (a) the FORCE USER exemption check correctly checks the rerolling friendly's keywords, (b) Strain via applyStrain pipeline (Headhunter etc. fire on Kanan), (c) Dodge conversion is applied per-die per-reroll, (d) "may reroll 1 die" — exposed as named reroll bucket in step-3 def per 2026-05-13 unified model.

---

## Kayn Somos

**Special Action (Firing Squad)** — "Choose up to 2 adjacent friendly TROOPERS. Each of those figures may interrupt to perform an attack targeting the same figure."
- Impl: `src/game/abilities.js`, `src/handlers/combat.js`, `src/game/activation-state.js`. Per memory `ROUND_OBJECT_FLAGS.firingSquadLockedTarget` — first chosen Trooper's attack locks the target for subsequent Troopers.
- ✅ correct — multi-step picker (up-to-2 adjacent friendly TROOPERs, "same figure" target lock via `firingSquadLockedTarget`).

**Surge (Squad Command)** — "Choose an adjacent friendly TROOPER. That figure becomes Focused."
- Impl: `src/game/combat.js`, `src/engine/combat-bridge.js`.
- ⚠️ suspicious — verify the surge spend opens a player-choice picker among adjacent friendly TROOPERs and applies Focus to the chosen one (not auto-pick or auto-apply).

---

## Ko-Tun Feralo

**Arms Distribution** — "At the beginning of your activation, distribute 2 Power Tokens among up to 2 friendly figures within 3 spaces."
- Impl: `src/game/soa-orchestrator.js`, `src/engine/activation-setup.js`, `src/handlers/post-deploy.js`, `src/handlers/soa-handler.js`, `src/handlers/activation.js`.
- ⚠️ suspicious — verify (a) SoA picker shows up-to-2 distinct friendly figures within 3 spaces, (b) for each chosen, the player picks the token TYPE (Damage / Surge / Block / Evade — Wild is gain-time picker only per the 2026-05-13 wild-token refactor), (c) the 2 tokens can go to ONE figure (1+1) or TWO figures (1 each) — "among up to 2 figures" allows both shapes.

**Dead Precise** — "When a figure within 3 spaces of Ko-Tun is attacking, if it spent a Power Token, it may reroll 1 attack die and apply -1 Dodge to the attack results."
- Impl: `src/game/dead-precise-kotun-helpers.js`, `src/engine/activation-setup.js`, `src/handlers/combat.js`.
- ⚠️ suspicious — verify (a) "if it spent a Power Token" check uses `combat.attackerSpentPowerToken` flag (set at the 3 token-spend sites — same family as Bodhi Air Support that landed in commit `4149366b`), (b) "reroll 1 attack die" → named reroll bucket button, (c) -1 Dodge applies as a step-4 attacker modifier on the same attack, (d) stacks with Professional per card text.

**Squad Cohesion** — "When a friendly REBEL figure within 3 spaces declares an attack, it may spend a Power Token from a friendly REBEL figure within 3 spaces of itself for its effect."
- Impl: `src/game/effective-los.js`, `src/engine/activation-setup.js`, `src/handlers/combat.js`. The token-borrow logic is in `sendTokenWindow` (combat.js:5821) via `squadCohesionTokens`.
- ✅ correct — already wired and battle-tested. Token-borrow picker at step-6 spend; allowed types respect attacker (Damage/Surge) vs defender (Block/Evade) per CRR.

---

## Krrsantan

**Full of Rage** — "Before you declare an attack, if you have suffered 3 or more Damage, become Focused."
- Impl: `src/game/full-of-rage-helpers.js`, `src/handlers/combat.js:2243`. Damage threshold = 3.
- ✅ correct — declare-time auto-Focus + 1 green die when damage suffered ≥ 3.

**Electrified Knuckledusters** — "Choose an adjacent hostile figure and roll 1 blue die. That figure suffers Damage equal to the Damage results. Then, if you rolled 1 or more Surge results, that figure becomes Stunned."
- Impl: `data/ability-library.json:electrified_knuckledusters` (descriptor) + `src/game/abilities.js` generic dcSpecial handler.
- ⚠️ suspicious — verify the descriptor includes the `rollOneDieSurgeCondition: 'Stun'` field (sister to Shock Lance / Dewback). The Damage application: it's "Damage equal to Damage results" — should NOT be reduced by defender's defense roll (this is direct damage, not an attack).

---

## Kuiil

**Mounted** — SoA 3 MP.
- ✅ correct (shared mounted_* family).

**Special Action (Hop On!)** — "Choose a SMALL friendly figure with a figure cost of 8 or less. When you enter that figure's space during this activation, you may interrupt to push that figure 1 space."
- Impl: `data/ability-library.json:hop_on_kuiil` (descriptor) + `src/game/abilities.js`.
- ⚠️ suspicious — multi-phase effect: (1) pick a SMALL friendly cost-8-or-less at activation-time, (2) THIS-ACTIVATION-only flag that fires when Kuiil enters that figure's space, (3) interrupt push prompt. Verify (a) cost-8 filter uses base figure cost, (b) the "this activation" scope clears at EoA (don't leak to next activation), (c) the interrupt fires AT the moment Kuiil enters the space (during the move) — not after the move completes.

**Efficient Travel** — canonical keyword.
- ✅ correct.

---

## Lando Calrissian

**Resourceful** — "While attacking or defending, you may reroll 1 of your attack or defense dice."
- Impl: `src/engine/combat-order-validator.js`, `src/handlers/combat.js`. Routes through unified reroll bucket per 2026-05-13.
- ✅ correct — named reroll bucket button in step-3 attacker / step-3 defender windows.

**Gambit** — "Before you reroll a die, you may replace it with another die of the same type. After rolling, the new die is considered rerolled."
- Impl: `src/game/cc-timing.js`, `src/game/abilities.js`, `src/engine/combat-order-validator.js`, `src/handlers/combat.js`.
- ⚠️ suspicious — pre-reroll die-swap interrupt. Verify (a) fires BEFORE a reroll is committed (so the swapped die becomes the rerolled die), (b) "same type" = same color (red/blue/green/yellow), (c) "the new die is considered rerolled" → counts against per-attack reroll limits.

**Shrewd Scoundrel** — "While attacking or defending, before you reroll a die with 'Resourceful', you may guess aloud a number from 0-2. After rerolls, if the number of Damage or Block symbols on that die matches the number you guessed, double that die's results. Limit once per activation."
- Impl: `src/engine/combat-order-validator.js`, `src/handlers/combat.js`. Per the validator name-comment file, this orchestrates with Resourceful.
- ⚠️ suspicious — complex multi-step: (1) named reroll bucket activation only when Resourceful is being used (tied to Resourceful, not standalone), (2) 0/1/2 guess picker (Discord buttons), (3) post-reroll Damage/Block count comparison, (4) doubling of that die's results, (5) once-per-activation gate. Verify all 5 sub-steps; this is the most complex reroll in the game.

---

## Leia Organa

**Special Action (Battlefield Leadership)** — "Perform an attack, then choose another friendly figure within 3 spaces. That figure may interrupt to move up to 1 space and then perform an attack with the same target."
- Impl: `src/discord/apply-ability-result.js`, `src/game/abilities.js`, `src/engine/combat-bridge.js`, `src/handlers/combat.js`, `src/handlers/checkpoint.js`. `setPendingBattlefieldLeadership` interrupt.
- ⚠️ suspicious — multi-stage: (1) Leia performs the primary attack, (2) post-attack picker for "another friendly within 3", (3) chosen friendly's owner gets a 1-space-move-then-attack prompt with the **same target** as Leia's attack. Verify (a) the target lock is enforced on the chosen friendly's attack, (b) the move-1 picker fires before the attack picker, (c) the chosen friendly's free attack consumes the chained-attack budget correctly (not free-attack-bonus stacking).

**Surge (Military Efficiency)** — "Choose 1 Command card in your discard pile and shuffle it into your Command deck."
- Impl: `src/game/combat.js` (surge), `src/game/abilities.js`, `src/engine/combat-bridge.js`, `src/handlers/post-combat.js`.
- ⚠️ suspicious — surge-spend → picker among CCs in Leia's discard → shuffle the chosen CC back into the deck (not directly to hand). Verify the discard-pile picker UI fires and the shuffle is into-deck, not into-hand.

---

## Loku Kanoloa

**Set Your Sights** — "At the start of the mission, place a Recon token on a unique hostile figure. While a friendly figure is attacking a figure with a Recon token, apply Pierce 1 to the attack results."
- Impl: `src/handlers/post-deploy.js` (mission-start placement), `src/engine/combat-bridge.js`, `src/handlers/combat.js` (per-attack Pierce 1).
- ✅ correct — alexanbv-confirmed 2026-05-08: post-deploy picker fires for unique hostile placement; per-attack Pierce 1 fires when target has the recon token (combat.js:2968 wiring verified).

**Priority Target** — "Figures do not block line of sight for your attacks."
- Impl: `src/game/effective-los.js`, `src/game/spatial.js`, `src/engine/available-actions.js`, `src/handlers/dc-play-area.js`.
- ✅ correct — LoS computation skips figure-blocking when attacker has Priority Target. Canonical IACP keyword.

**Mon Cala Special Forces** — "When you declare an attack targeting a figure with a Recon token, you become Focused."
- Impl: `src/game/mon-cala-sf-loku-helpers.js`, `src/handlers/combat.js:2974`.
- ✅ correct — declare-time auto-Focus when target has recon token.

---

## Loth-cat (Elite)

**Special Action (Pounce)** — "Place your figure in an empty space within 3 spaces. Then, you may perform an attack."
- Impl: `data/ability-library.json:dc_pounce` (descriptor) + `src/game/abilities.js:11820+` — picks empty space within 3, teleports, sets `pounceAttackPending[figureKey]` (per-figure post-2026-05-13 migration).
- ✅ correct — alexanbv-confirmed migration to per-figureKey in commit `165ce220`.

**Special Action (Fresh Catch)** — "You or an adjacent CREATURE gains 1 Power Token."
- Impl: `src/game/abilities.js` (`fresh_catch_lothcat` keyed).
- ⚠️ suspicious — verify (a) picker presents Loth-cat itself + adjacent CREATURE figures, (b) the chosen figure picks the token type (Damage/Surge/Block/Evade — Wild is gain-time only).

**Curious** — "After you interact, suffer 1 Strain."
- Impl: `src/handlers/interact.js`.
- ✅ correct (post-interact Strain via applyStrain).

---

## Batch 10 — Summary

- ✅ correct: 10
- ⚠️ suspicious: 15
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced this batch:**

1. **Lando Shrewd Scoundrel** — most complex reroll-with-guess-and-doubling in the game. 5 sub-steps to verify. Likely the highest bug-risk surface in this batch.

2. **Kanan Soresu Form Strain exemption** — "if that figure is not FORCE USER, you suffer 1 Strain" — verify the FORCE USER check correctly inspects the rerolling friendly's keywords. Edge case: friendly is FORCE USER → Kanan does NOT take strain. Important for Kanan's survival when supporting another Jedi.

3. **KX Shoulder Rush post-move adjacency** — adjacent hostile check should use NEW position after the 2-space move, not pre-move position.

4. **Leia Battlefield Leadership target lock** — chosen friendly's interrupt attack must hit the SAME target as Leia's primary attack. Bug-risk if the chosen friendly's target picker shows other options.

5. **Ko-Tun Dead Precise + Power Token spend** — relies on `combat.attackerSpentPowerToken` flag at all 3 spend sites (Wild / Squad Cohesion / direct). The same flag was the trigger condition for Bodhi Air Support (fixed batch 02). Worth confirming Dead Precise also fires uniformly.

**Next:** Batch 11 (DCs alphabetical after Loth-cat (Elite)).
