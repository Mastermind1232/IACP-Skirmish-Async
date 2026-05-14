# DC/CC Timing Audit — Manual Triage Batch 47

Scope: Command Cards alphabetical after "Roar", 10 cards:
Run for Cover, Sarlacc Sweep, Savage Vigor, Second Chance,
Self-Augmentation, Self-Defense, Set a Trap, Set for Stun,
Set the Charges, Shadow Ops.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Run for Cover

**Effect** — "SMUGGLER, cost 2, whenAttackDeclaredOnYou. Choose 1 die and remove it from the attack pool."
- Impl: `Run for Cover` keyed at 1 site.
- ⚠️ suspicious — verify (a) SMUGGLER playableBy, (b) on-declare-against-self trigger, (c) picker: 1 attack die from pool (color/index), (d) die fully removed (not blanked — actually removed from attackInfo.dice), per-attack scope.

---

## Sarlacc Sweep

**Effect** — "Diala Passil, cost 2, specialAction. Perform 2 attacks. Each attack must target a different figure."
- Impl: `Sarlacc Sweep` keyed at 3 sites; `freeAttackDifferentTargets` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) Diala only, (b) Special Action (1 action), (c) 2-attack chain: 1 paid + 1 free via freeAttackBonusPending, (d) different-target constraint via freeAttackDifferentTargets[figureKey] tracking first target, second attack blocks same target (per commit 165ce220 figkey-keyed migration).

---

## Savage Vigor

**Effect** — "CREATURE, cost 2, whenAttackDeclaredOnYou. The attacker chooses 2 attack dice and removes the rest from the attack pool."
- Impl: `Savage Vigor` keyed at 1 site.
- ⚠️ suspicious — verify (a) CREATURE playableBy, (b) on-declare-against-self trigger, (c) attacker (NOT defender) picks 2 dice to KEEP; rest removed from pool, (d) gives attacker some agency — but caps attack at 2 dice max, (e) opposite agency to Run for Cover (defender picks 1 to remove).

---

## Second Chance

**Effect** — "Unique, cost 2, startOfRound. Place this card on your Deployment card as an Attachment. Attachment: Before you would be defeated, or at the end of this round, recover 2 Damage and discard this card."
- Impl: `Second Chance` keyed at 10 sites.
- ⚠️ suspicious — verify (a) Unique playableBy (any unique figure), (b) SoR timing for attach, (c) attachment mode: CC moves from hand to DC, (d) BEFORE_DEFEATED hook: heal 2 + discard SC card → cancels defeat if 2 HP recovery brings figure above 0, (e) EoR fallback: if SC still attached, heal 2 + auto-discard at EoR, (f) one-shot — SC discards itself either way.

---

## Self-Augmentation

**Effect** — "TECHNICIAN, cost 0, duringActivation. Place this card on your Deployment card as an Attachment. Attachment: You gain the DROID trait. While attacking, you may reroll one attack die."
- Impl: `Self-Augmentation` keyed at 3 sites.
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy, (b) free cost, (c) during-activation timing for attach, (d) attachment effects: DROID keyword added (effectiveKeywords layer), (e) attacker named reroll bucket (1 attack die per attack), (f) persistent until end of game (no auto-discard).

---

## Self-Defense

**Effect** — "Any Figure, cost 0, whenHostileFigureEntersAdjacentSpace. That figure suffers 1 Damage."
- Impl: `Self-Defense` keyed at 4 sites.
- ⚠️ suspicious — verify (a) free cost, (b) movement-trigger: hostile enters path-1 of SD-holder during their move, (c) 1 Damage via standard pipeline mid-move (could cause defeat — does the hostile's move continue if they survive? CRR check), (d) per-trigger play (multiple SD plays per round on different entries).

---

## Set a Trap

**Effect** — "Any Figure, cost 0, startOfRound. Choose a map tile. At the end of the round, choose one of your figures on that tile to interrupt to perform an attack targeting a hostile figure on that tile."
- Impl: `Set a Trap` keyed at 2 sites; `setTrapSpace` flag (moved 2026-05-13 to ROUND_OBJECT_FLAGS).
- ⚠️ suspicious — verify (a) free cost, (b) SoR timing, (c) map-tile picker (mission tile, not single space), (d) `setTrapSpace[playerNum]` round-flag stores tile ID, (e) EoR: prompt to pick own figure on tile + hostile on tile, free attack, (f) "if able" gate: silent fizzle if no own/hostile figures on tile.

---

## Set for Stun

**Effect** — "Any Figure, cost 0, specialAction. Perform an attack. If the target would suffer 1 or more Damage, reduce the Damage suffered to 0. Then, the target becomes Stunned."
- Impl: `Set for Stun` keyed at 3 sites.
- ⚠️ suspicious — verify (a) free cost, (b) Special Action (1 action), (c) free attack via freeAttackBonusPending, (d) post-attack damage hook: if final Damage ≥ 1, clamp to 0 AND apply Stun via applyCondition, (e) Damage-zero + Stun = "set for stun" mechanic (no damage but condition applied).

---

## Set the Charges

**Effect** — "TECHNICIAN, cost 2, specialAction. Choose a space within 3 spaces and roll a blue die. Open any unlocked doors adjacent to that space. Then, each figure or object on or adjacent to that space suffers Damage equal to the combined Hit and Surge results."
- Impl: `Set the Charges` keyed at 1 site.
- ⚠️ suspicious — verify (a) TECHNICIAN playableBy, (b) Special Action (1 action), (c) space picker within path-3, (d) 1 blue die roll, (e) door opening: iterate doors adjacent to chosen space (path-1 from chosen), open each unlocked one (game.openedDoors update), (f) AoE damage = (Hit + Surge) on/adjacent to chosen space, figures + objects.

---

## Shadow Ops

**Effect** — "Mak Eshka'rey, cost 3, specialAction. Until the end of the round, the opposing player cannot play Command cards."
- Impl: `Shadow Ops` keyed at 3 sites; `shadowOpsBlockedPlayer` flag.
- ⚠️ suspicious — verify (a) Mak only, (b) Special Action (1 action), (c) round-long flag with opponent's playerNum, (d) CC-play validator: when `shadowOpsBlockedPlayer === playerNum`, all CC plays from that player are refused, (e) EoR reset.

---

## Batch 47 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **Savage Vigor agency to attacker** — defender plays the card, but ATTACKER picks which 2 dice to keep. Cross-player picker.

2. **Second Chance BEFORE_DEFEATED + EoR dual-trigger** — attachment fires whichever comes first (defeat-attempt OR EoR). Auto-discard either way.

3. **Self-Defense mid-move 1 Damage** — could defeat the moving hostile mid-move. CRR ruling on whether their move continues or interrupts.

4. **Set a Trap tile-scoped picker** — map tile selection (not single space), then EoR figure-on-tile picker + hostile-on-tile target.

5. **Set for Stun damage-to-zero + Stun** — clamp final damage to 0 even if attack would land big damage. Damage-suppression + status-effect mechanic.

6. **Set the Charges door-opening + AoE chain** — multi-step special: space pick → die roll → open doors → AoE damage. Object-damage pipeline integration.

**Next:** Batch 48 (next 10 CCs after Shadow Ops).
