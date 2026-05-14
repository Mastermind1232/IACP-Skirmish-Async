# DC/CC Timing Audit — Manual Triage Batch 51

Scope: Command Cards alphabetical after "Take it Down", 10 cards:
Targeting Network, Telekinetic Throw, Terminal Network,
Terminal Protocol, There Is No Try, There is Another, To the Limit,
Tools for the Job, Tough Luck, Toxic Dart.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Targeting Network

**Effect** — "DROID or HEAVY WEAPON, cost 0, duringAttack. Reroll 1 attack die. Passive (Discard pile): While in discard pile, DROIDS gain Surge: Re-draw this card."
- Impl: `Targeting Network` keyed at 5 sites.
- ⚠️ suspicious — verify (a) DROID/HEAVY WEAPON playableBy, (b) free cost, (c) attacker reroll bucket (1 die), (d) discard-pile passive: when DROID attacks (any caster's DROID), Surge can re-draw TN to that player's hand, (e) only matters when TN is in caster's own discard.

---

## Telekinetic Throw

**Effect** — "FORCE USER, cost 1, specialAction. Choose a hostile figure in your line of sight within 3 spaces. Roll 2 blue dice. That figure suffers Damage equal to the Hit results."
- Impl: `Telekinetic Throw` keyed at 1 site.
- ⚠️ suspicious — verify (a) FORCE USER playableBy, (b) Special Action (1 action), (c) picker: hostile in LoS within path-3, (d) 2 blue die roll, (e) damage = total Hit results via standard pipeline.

---

## Terminal Network

**Effect** — "R2-D2, cost 2, specialAction. Use while adjacent to a terminal. Until the start of the next round, you gain control of all terminals, regardless of which figures are adjacent to them."
- Impl: `Terminal Network` keyed at 3 sites; `terminalControlPlayerNum` flag.
- ⚠️ suspicious — verify (a) R2-D2 only, (b) Special Action (1 action), (c) adjacency-to-terminal gate at play time, (d) round-long flag: all terminals counted as controlled by R2-D2's player for mission scoring, regardless of physical adjacency, (e) clears at start of next round.

---

## Terminal Protocol

**Effect** — "DROID, cost 1, duringActivation. Roll 1 green die. Each other figure and object in or adjacent to your space suffers Damage equal to the Damage results. Then, you are defeated."
- Impl: `Terminal Protocol` keyed at 1 site.
- ⚠️ suspicious — verify (a) DROID playableBy, (b) during-activation, (c) 1 green die roll, (d) AoE: every figure + object in or adjacent (path-0 + path-1) to caster suffers Damage = Damage results via standard pipeline (object damage hook), (e) caster IS defeated after AoE resolves (self-destruct mechanic similar to Probe Droid Self-Destruct).

---

## There Is No Try

**Effect** — "Yoda, cost 2, whenFriendlyRebelForceUserWithin4SpacesRollsDice. Choose one of those dice and turn it to any other side. On that die, convert each Dodge result to 2 Blocks and 1 Evade."
- Impl: `There Is No Try` keyed at 8 sites; `pendingThereIsNoTry` flag.
- ⚠️ suspicious — verify (a) Yoda only, (b) trigger: friendly REBEL FORCE USER within path-4 rolls dice (any roll — attack or defense), (c) Use: 1-die picker, turn to any other side, (d) Dodge-to-2-Block-1-Evade conversion applies to the chosen die's NEW face if it shows Dodge.

---

## There is Another

**Effect** — "Leia Organa, cost 0, startOfRound. Draw 1 Command card. During this round, you may play Command cards whose restriction matches the name of another FORCE USER Deployment card in your army."
- Impl: `There is Another` keyed at 1 site.
- ⚠️ suspicious — verify (a) Leia only, (b) free cost, (c) SoR timing, (d) draw 1 CC (count-only public log per privacy), (e) round-long: CC-play validator bypasses playableBy restriction for cards matching ANOTHER FORCE USER DC in Leia's army (e.g., Yoda's Calming Presence playable by Leia if Yoda is in army), (f) flag scoped to Leia's playerNum.

---

## To the Limit

**Effect** — "Any Figure, cost 0, afterSpecial. Use after you resolve a Special Action during your activation to perform 1 additional action. Then you become Stunned."
- Impl: `To the Limit` keyed at 5 sites.
- ⚠️ suspicious — verify (a) free cost, (b) post-Special-Action timing during own activation (similar to All in a Day's Work but no TECHNICIAN gate + Stun cost), (c) +1 action to perFigureRemaining[selectedFigure] (per destruct 2026-05-07 per-figure budget), (d) Stun via applyCondition on caster, (e) Stun is the cost — figure may end up stunned mid-activation but can still use the extra action first.

---

## Tools for the Job

**Effect** — "HUNTER or SMUGGLER, cost 2, whenYouDeclareAttack. Add 1 attack die of your choice to the attack pool."
- Impl: `Tools for the Job` keyed at 8 sites.
- ⚠️ suspicious — verify (a) HUNTER/SMUGGLER playableBy, (b) on-declare, (c) die-color picker (red/blue/green/yellow), (d) chosen color added to attackInfo.dice, rolled with normal pool.

---

## Tough Luck

**Effect** — "Any Figure, cost 1, other. Use after your opponent rerolls a die. Remove that die's result from the results."
- Impl: `Tough Luck` keyed at 7 sites; `pendingToughLuck` flag.
- ⚠️ suspicious — verify (a) trigger: opponent rerolls a die (any reroll source — CC, named bucket, surge), (b) Use: the just-rerolled die has its result set to blank, (c) per-reroll play (multiple TL plays per attack possible on different rerolls).

---

## Toxic Dart

**Effect** — "HUNTER or SMUGGLER, cost 0, duringActivation. A hostile figure within 3 spaces and in line of sight suffers 1 Strain and becomes Weakened."
- Impl: `Toxic Dart` keyed at 1 site.
- ⚠️ suspicious — verify (a) HUNTER/SMUGGLER playableBy, (b) free cost, (c) during-activation, (d) picker: hostile within path-3 + LoS, (e) target: 1 Strain via applyStrain (Fireproof/Headhunter fire) + Weaken via applyCondition (immunity respected).

---

## Batch 51 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 10
- ❌ wrong-stage: 0
- — no impl: 0

**Highest-priority items surfaced:**

1. **There Is No Try Dodge-to-2-Block-1-Evade conversion** — niche mechanic. The chosen die's RESULTING face (after turn-to-any-side) is checked for Dodge; if so, replaced with 2 Block + 1 Evade.

2. **Terminal Network full-board control** — round-long override of terminal control regardless of physical adjacency. All terminal-scoring sites must honor terminalControlPlayerNum flag.

3. **Terminal Protocol self-destruct** — caster is defeated after AoE. BEFORE_DEFEATED hooks (Useful Hide / Last Resort / etc.) fire on caster's defeat.

4. **There is Another faction-bypass** — Leia plays CCs restricted to other FORCE USER DCs in army. CC-play validator must check "is restriction the NAME of another FORCE USER DC in my army".

5. **Tough Luck multi-reroll plays** — multiple TLs can fire per attack on different reroll triggers. Per-reroll scope.

6. **To the Limit Stun-after-extra-action** — caster Stuns after the +1 action resolves, meaning the action benefits from no Stun debuff.

**Next:** Batch 52 (next 10 CCs after Toxic Dart).
