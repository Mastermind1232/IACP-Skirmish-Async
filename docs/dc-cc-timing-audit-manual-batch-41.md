# DC/CC Timing Audit — Manual Triage Batch 41

Scope: Command Cards alphabetical after "Mandalorian Steel", 10 cards:
Mandalorian Tactics, Marked Territory, Marksman, Master Operative,
Maximum Firepower, Meditation, Merciless, Miracle Worker, Mitigate,
Navigation Upgrade.

Verdicts: ✅ correct | ⚠️ suspicious | ❌ wrong-stage | — no impl

---

## Mandalorian Tactics

**Effect** — "Boba Fett, cost 3, duringActivation. Choose 1: Gain 4 movement points / Perform an attack without spending an action."
- Impl: `Mandalorian Tactics` — NO src hits.
- — no impl — needs: (a) Boba Fett only, (b) during-activation, (c) 2-option picker: +4 MP via grantMovementBank (perFig-keyed) OR free attack via freeAttackBonusPending (figkey-keyed).

---

## Marked Territory

**Effect** — "CREATURE, cost 0, duringActivation. Gain 1 Power Token. Then, a figure in your group in an exterior space gains 1 Power Token."
- Impl: `Marked Territory` keyed at 1 site.
- ⚠️ suspicious — verify (a) CREATURE playableBy, (b) free cost, (c) caster gains 1 PT (picker for type? or default Damage), (d) bonus: if any group-mate (same DC) is on an exterior space, that figure also gains 1 PT, (e) needs map-data exterior/interior tag (same dependency as Survivalist / Harsh Environment), (f) "a figure in your group" — picker if multiple qualifying groupmates.

---

## Marksman

**Effect** — "Any Figure, cost 1, beforeDeclaringRangedAttack. Figures do not block line of sight for this attack."
- Impl: `Marksman` keyed at 9 sites; `nextAttackIgnoreFigureLOS` figkey-keyed (migrated 2026-05-13).
- ⚠️ suspicious — verify (a) before-declare Ranged attack timing, (b) `nextAttackIgnoreFigureLOS[figureKey]` set for THIS attack, (c) target picker (buildAndSendAttackTargets) reads flag to suppress figure-blocking in LoS calc, (d) flag consumed at attack-declare per the alexanbv 2026-05-13 figkey migration.

---

## Master Operative

**Effect** — "Verena Talos, cost 2, whenYouDeclareCloseQuarters. You become Focused. Apply +1 Surge to the attack results."
- Impl: `Master Operative` keyed at 3 sites.
- ⚠️ suspicious — verify (a) Verena only, (b) trigger: when Verena declares Close Quarters special, (c) Verena gains Focus via applyCondition, (d) +1 Surge at step-4 attacker mod for THIS attack.

---

## Maximum Firepower

**Effect** — "HEAVY WEAPON, cost 3, doubleActionSpecial. Perform an attack. Apply +4 Hit to the attack results."
- Impl: `Maximum Firepower` keyed at 3 sites.
- ⚠️ suspicious — verify (a) HEAVY WEAPON playableBy, (b) DOUBLE Action Special (2 actions), (c) free attack via freeAttackBonusPending, (d) +4 Hits at step-4 attacker mod (big mod).

---

## Meditation

**Effect** — "REBEL, cost 3, specialAction. You become Focused. Once during your next activation, if you are a FORCE USER, you may perform an attack targeting an adjacent figure without spending an action."
- Impl: `Meditation` keyed at 9 sites; `nextActivationFreeAttack` ROUND_OBJECT_FLAGS entry.
- ⚠️ suspicious — verify (a) REBEL playableBy, (b) Special Action (1 action), (c) Focus applied to caster, (d) `nextActivationFreeAttack[playerNum]` flag set with dice/melee data per activation-setup.js:1198+ — fires on FORCE USER's next activation, (e) free attack targets adjacent figure (path-1) only.

---

## Merciless

**Effect** — "HUNTER, cost 1, specialAction. Choose an adjacent hostile figure. That figure's player may discard 2 cards from the top of his Command deck. If he does not, your player gains 3 VPs."
- Impl: `Merciless` keyed at 3 sites.
- ⚠️ suspicious — verify (a) HUNTER playableBy, (b) Special Action (1 action), (c) adjacent hostile picker, (d) prompt to OPPONENT: discard 2 top deck cards (to public discard pile) OR allow caster +3 VP, (e) "may" → opponent's choice — Use/Skip prompt to opponent, (f) cross-player Discord agency.

---

## Miracle Worker

**Effect** — "MHD-19, cost 2, whenFriendlyFigureWithin3SpacesWouldBeDefeated. Instead of being defeated, it recovers 3 damage."
- Impl: `Miracle Worker` keyed at 3 sites; `pendingMiracleWorker` flag.
- ⚠️ suspicious — verify (a) MHD-19 only, (b) BEFORE_DEFEATED hook (per the 2026-05-08 defeat-timing rewrite), (c) Use/Skip prompt to MHD-19's owner, (d) Use: cancel defeat + heal 3 (so figure's current HP = maxHp - currentDamage + 3, clamped to maxHp), (e) friendly within path-3 of MHD-19.

---

## Mitigate

**Effect** — "Any Figure, cost 0, duringAttack. Reroll 1 attack die."
- Impl: `Mitigate` keyed at 1 site.
- ⚠️ suspicious — verify (a) free cost, (b) during-own-attack, (c) named reroll bucket: 1 attack die reroll, (d) per-attack play.

---

## Navigation Upgrade

**Effect** — "DROID, cost 2, specialAction. Take 1 Strain. Place this card in your Play Area as an Attachment. Attachment: Exhaust this card during a friendly DROID's activation. That figure gains 1 movement point."
- Impl: `Navigation Upgrade` keyed at 1 site.
- ⚠️ suspicious — verify (a) DROID playableBy, (b) Special Action (1 action), (c) caster suffers 1 Strain via applyStrain pipeline (Fireproof/Headhunter fire), (d) NU card moves from hand → attachment (permanent until end of game), (e) ATTACHMENT effect: exhaust button on any friendly DROID's activation grants +1 MP via grantMovementBank (perFig-keyed), (f) once-per-round exhaust.

---

## Batch 41 — Summary

- ✅ correct: 0
- ⚠️ suspicious: 9
- ❌ wrong-stage: 0
- — no impl: 1 (Mandalorian Tactics)

**Highest-priority items surfaced:**

1. **Mandalorian Tactics NO IMPL** — Boba 2-option picker (4 MP OR free attack).

2. **Merciless cross-player discard prompt** — caster's opponent decides whether to discard 2 or give 3 VP. Cross-player Discord agency.

3. **Marked Territory exterior-space dependency** — requires map exterior/interior tags. Same blocker as Survivalist / Harsh Environment / etc.

4. **Miracle Worker BEFORE_DEFEATED + heal-instead-of-defeat** — defeat cancellation pattern. Verify BEFORE_DEFEATED hook order vs other prevention abilities (Strike Me Down, Last Resort, Dying Lunge, etc.).

5. **Navigation Upgrade attachment lifecycle** — CC moves to play area as attachment. Persists until game end. Exhaust-once-per-round.

6. **Meditation next-activation free attack** — `nextActivationFreeAttack` is round-scoped but spans into next activation. FORCE USER gate at fire time (not at cast time — REBEL plays it, FORCE USER consumes).

**Next:** Batch 42 (next 10 CCs after Navigation Upgrade).
