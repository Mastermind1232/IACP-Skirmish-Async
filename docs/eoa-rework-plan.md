# End-of-Activation rework

Rulings from alexanbv, 2026-08-11/12, via Skirbo.

> "End of activation and after activation resolves are two different windows.
> End of activation happens first. In initiative order. Then after activation
> resolves happens. In init order."
>
> "end of act needs to be its own window and should exactly mirror SoA"

## The two windows

| | Window 1 | Window 2 |
|---|---|---|
| name | end of activation | after activation resolves |
| order | first | second |
| activation state | still standing | torn down |
| player order | initiative | initiative |
| CSV timing | `end_of_activation` | `after_activation_resolves` |

Window 2 is bounded by the **End Activation** and **End Turn** buttons.
`handleEndTurn` refuses to run until End Activation has been pressed, and turn
order flips only on End Turn, which is why chained activations skip the
opponent for free.

## Status

**Slice 1 — DONE** (`1b7bf73c`). Window 1 now holds the activation open.
`handleDcEndActivation` records `game.pendingEndActivationResume` and returns
while a window is open; `postChooserOrComplete` in `handlers/eoa-handler.js`
calls `finishDcEndActivation` when the last bucket closes.

**Slice 2 — DONE** (this commit). CSV retimed, see below.

**Slices 3-5 — TODO**, listed at the end.

## Do not mirror SoA's control flow

SoA also posts its chooser and continues. What it actually does is refuse the
End Activation click while the chooser is open, via
`describeActivationActionInProgress` in `game/activation-state.js`. That is safe
at the *start* of an activation because nothing is being destroyed. It does not
transfer to window 1, where teardown follows immediately, so window 1 needs real
deferral. What DOES mirror SoA is the bucketing: descriptors sorted by
`ownerPlayerNum`, initiative bucket first.

## Window-1 inventory

Swept from `docs/combat-spec.csv` (`timing = end_of_activation`), 13 rows.

### Wired as EoA descriptors (5 abilities, 6 rows)

| Ability | Card | subPromptKey |
|---|---|---|
| Unnerving | 0-0-0 | `unnerving` |
| Hold the Line | Baze Malbus | `hold_the_line` |
| In The Shadows | ISB Infiltrator (Elite) | `in_the_shadows` |
| Shield | Riot Trooper (Regular/Elite) | `shield` |
| Trust Goes Both Ways | Jyn Erso | `trust_both_ways_eoa` |

### NOT wired — still ad-hoc, and now firing AFTER teardown (5 rows)

| Ability | Card | Where it lives now |
|---|---|---|
| On a Diplomatic Mission | attachment | ad-hoc `on_diplomatic_*` buttons in the continuation |
| Wild Fury | CC | inline block in the continuation, reads a pre-cleanup snapshot |
| Clan of Two | attachment | ad-hoc teleport prompt |
| Force Surge | CC | not wired to the window at all — **still unplayable** |
| Rebel Graffiti | CC | resolves either side of teardown, so unaffected |

### Moved to window 2, no migration needed

**Field Tactics** (Death Trooper Regular/Elite). alexanbv 2026-08-12: "field
tactics should have the same timing as strength in numbers." That makes it
window 2, activator-only, alongside Squad Swarm and Strength in Numbers — all
three grant a further activation, and the ruling that chained activations are
whole new activations named Field Tactics explicitly.

Its CSV rows were retimed to `after_activation_resolves`. No code change: it is
already invoked from the continuation, which *is* window 2, so its existing
placement was correct for the wrong stated reason. It must NOT be pulled into
the EoA orchestrator.

Two of these already carry workarounds for the teardown they should never have
been behind: the continuation snapshots `attackPerformedThisActivation` and
`postActivationConditions` before `cleanupActivation` wipes them, purely so
Diplomatic Mission and Wild Fury can still read them. Those snapshots can be
deleted once both move into the window.

### What actually breaks these cards (corrected)

An earlier version of this doc claimed the problem was that effects need the
activation standing, because `cleanupActivation` clears `movementBank`. **That
was wrong.** alexanbv 2026-08-12:

> "immediate spends do NOT require an activation. For example, an eOfficer can
> order a move that another figure spends immediately. Jundland Terror is an EOR
> effect with immediate spend."

`addMovementPoints` already tags any grant made while `dcActionsData[msgId]` is
absent as `_outOfActivation` / `_mustSpendImmediately`. That is the path Order
and Tactical Maneuver use, and it works with no activation at all.

The real defect was narrower: these resolvers looked their actor up with
`findActiveActivationMsgId`, which needs a live activation, so they refused to
resolve rather than resolving with immediate-spend semantics. Fixed for Force
Surge by falling back to the just-resolved pointer with `scope: 'own'`.

**Scope matters here.** `findJustResolvedActivationMsgId` takes `'own'` or
`'any'`. Blaze and Son of Skywalker are `'any'` (either player's activation
opens their window). Force Surge is `'own'` — it grants MP to the resolved DC,
and `'any'` would hand it to whichever card activated last, possibly the
opponent's.

So window 1 exists for **ordering**, not because the effects need a live
activation: strictly end-of-activation, ahead of the after-resolves window, in
initiative order.

## Slice 2: CSV retiming (done)

Six rows were tagged `end_of_activation` but are window 2 per the rulings and
per their own `cc-effects.json` timing. Wiring descriptors from the CSV before
fixing this would have put window-2 cards into window 1:

Blaze of Glory, Change of Plans, Provoke, Son of Skywalker, Squad Swarm,
Strength in Numbers → `after_activation_resolves`.

Note `Provoke` was in this set: it reads
`afterYouResolveGroupsActivation`, so it is window 2, activator-only.

## Movement grants: `pendingMoveX` vs `grantMovementBank`

alexanbv asked why movement-granting abilities are not all unified on
`pendingMoveX`, the usual picker. Census, because the answer is not "they are
not":

**The out-of-activation cases mostly ARE unified.** Order, Tactical Maneuver,
Slippery Target and Force Surge all write `pendingMoveX`, per the ruling of
2026-07-27: *"all immediate-spend MP goes to pendingMoveX with
allowAbilitySpend so it can be spent on MOVEMENT and on MP-cost abilities"*.

**The real divergence is `grantMovementBank`.** Compare the two grant helpers:

| | out-of-activation tagging |
|---|---|
| `addMovementPoints` (`abilities.js` ~495) | detects `!game.dcActionsData[msgId]` and sets `_outOfActivation` + `_mustSpendImmediately` |
| `grantMovementBank` (`game-helpers.js:89`) | **none** — just `total += n; remaining += n` |

So MP granted outside an activation through `grantMovementBank` is never tagged
must-spend-immediately, and can persist when it should expire.

`grantMovementBank` is not wrong in itself: MP gained during a figure's own
activation legitimately banks for the rest of it. The problem is only
out-of-activation callers.

**11 call sites outside `abilities.js`.** Several are legitimately in-activation
(e.g. `after-attack-fire.js`, during the attacker's own activation).
**Confirmed out-of-activation straggler: On a Diplomatic Mission**
(`handlers/interrupts.js:937`) — it fires at end of activation, after teardown,
and uses the untagged path. The remaining sites need classifying one by one;
do not assume.

This converges with slice 3: moving Diplomatic Mission into the window is also
the fix for its movement grant.

## Remaining slices

3. **Migrate the 6 ad-hoc window-1 prompts into the orchestrator**, in the order
   listed above. Diplomatic Mission first — alexanbv confirmed it is a choice
   ("+2 MP / +1 Evade rest of round / +1 VP"), it is already implemented with
   all three options, and it only needs moving. Delete the pre-cleanup
   snapshots as each one lands.
4. **Opponent enumeration pass.** `enumerateActivatorEoaDescriptors` walks one
   player. The bucketing already supports two. NOTE: the sweep found no
   opponent-owned window-1 ability today, so this pass currently has nothing to
   carry — wire it when a descriptor needs it rather than building it empty.
5. **Companion-activates-after-parent inside the phase.** alexanbv: "If a
   companion is chosen to activate after their parent figure, their activation
   happens within the parent EoA phase." Currently handled by the separate
   slice-3 partial-end logic, not as a descriptor.

## Window ordering constraint

Window 1 holds two kinds of content and they are not interchangeable:

- **Choices** — Hold the Line, Shield, In The Shadows, Unnerving, Jyn, Field
  Tactics, Diplomatic Mission. These go in the chooser.
- **Automatic terminations** — Blend In discarding, Weakened discarding, Wild
  Fury's queued conditions, and the IACP Disable expiry. These are
  deterministic and live in `cleanupActivation` /
  `applyEndOfActivationEffects`.

Terminations must run **after** the choice window closes. Before slice 1 the
chooser was non-blocking so cleanup always won the race; now that it blocks,
anything worded "at the end of your next activation" depends on this ordering
holding.

## Movement-grant call-site enumeration (alexanbv asked for this explicitly)

> "you need to enumerate the outstanding call sites and decide. Some abilities
> may be both. A post-attack MP grant would be banked if the attack was
> performed during the attacker's activation, but would NOT be banked if the
> attack was performed outside of the attacker's activation. Additionally, all
> Move X spaces abilities are resolve-immediate"

Because "both" exists, the choice cannot be made per call site. Three functions:

| function | when |
|---|---|
| `grantMovementBank` | definitionally in-activation |
| `grantImmediateMoveX` | definitionally immediate, incl. every spaces grant |
| `grantMovementPoints` | **either** — checks `dcActionsData[msgId]` at runtime |

### BANK — start-of-activation, always the activator (12 sites, unchanged)

`soa-handler.js` 209 (Mounted), 772 (Vigor), 787 (Responsive), 824 (Hunger
Elite), 845 (Hunger Regular), 858 (Focused on the Kill), 919 (Into the Fray),
955 (speed MP), 1287 and 1342 (both already commented "in-activation grant on
the activator"); `activation-setup.js` 384 (deploy bonus), 1086 (Fleet).

### RUNTIME — the "both" cases (4 sites, converted)

`after-attack-fire.js` 323 (Fly-By), 331 (Jets), 400 (Stalk Prey) — post-attack
grants to the attacker, exactly the case alexanbv described.
`third-party-ccs.js` 228 (Opportunistic) — fires off a damage-pipeline
reaction, and the SCUM figure receiving the MP is frequently not the activator.

### IMMEDIATE — already correct

Order, Tactical Maneuver, Slippery Target, Force Surge (spaces),
On a Diplomatic Mission (converted earlier).

### Bug found while enumerating

`applyThirdPartyCcEffect` is called in exactly one production place
(`handlers/combat.js` ~2133) and was passed only `{ applyCondition }`. Both
`findDcMessageIdForFigure` and the grant function were missing, so
**Opportunistic's 3 MP always fell through to "MP grant deps missing" and did
nothing in a real game.** Its unit test injects its own deps, which is why the
gap survived. Deps now wired, plus a test asserting the failure branch reports
rather than silently no-ops.

## Deployment MP (answering "how are bodhi, cassian, hera, scav walker implemented")

**Already implemented as an after-deployment sequence**, which is what alexanbv
asked for, in `src/handlers/post-deploy.js`:

| Card | Ability | Descriptor |
|---|---|---|
| Bodhi Rook, Hera Syndulla | Smooth Landing — "you and each adjacent friendly figure gains 1 MP" | `smooth_landing`, `type: 'multi_movement'`, interactive |
| Cassian Andor | Strike Team — "you and an adjacent friendly figure gain 2 MP" | `strike_team`, `type: 'complex'` |
| Scavenged Walker | "After deployment, you may perform a move" | post-deploy move |

It grants through `setupPendingMoveXSequence`, i.e. the normal move-X picker,
migrated from `pendingOrderedMove` on 2026-05-09. `smooth_landing` posts a
**picker so the player chooses which figure moves next** when more than one
remains — exactly the per-figure ordering alexanbv described.

So deployment MP was never banked and never needed to be: `post-deploy.js`
superseded the `deployBonusMp` block long ago, which is why nothing wrote that
field. Deleting it closed the loop.

## Tactical Maneuver vs Tactical Movement (do not confuse these)

alexanbv 2026-08-12: "tactical maneuver (gideon) CANNOT target himself. Tactical
movement (Fenn) can target himself, but also others."

| Card | Target | Grant |
|---|---|---|
| **Tactical Maneuver** (Gideon Argus) | another figure only | always immediate, like Order |
| **Tactical Movement** (Fenn Signis) | self OR another | runtime: banks on self, immediate otherwise |

Fenn's already dispatches correctly inline (`soa-handler.js` ~1339), as does
"I Make the Rules Now" (~1284). Those two were miscounted as plain banking sites
in the first enumeration; they are in fact the runtime pattern, hand-rolled.

## Companion activations and the EoA window (slice 5 spec)

alexanbv 2026-08-12, verbatim because the orderings are the specification:

> "remember all companion activations: if they activate first, they resolve
> first. If the activate after the main figure, their activation resolves
> INSIDE the figure's EOA window. Thus, for example:
> Baze with Child attached can choose to either:
> Activate child first, then baze, then Child teleports
> Activate baze first, teleport child, activate child
> Activate baze first, activate child, teleport child
>
> Teleport reffers to the "place your figure" part of clan of two"

### What this means structurally

Two separate things live in the host's EoA window when the companion goes
second, and **the player chooses the order between them**:

1. the companion's own activation
2. Clan of Two's "place your figure" teleport

That is exactly the shape the EoA chooser already provides — several descriptors
in one bucket, player picks which resolves next — so this does not need new
machinery, it needs both items to BE descriptors.

### The three legal orderings, usable directly as acceptance tests

| # | order |
|---|---|
| A | Child activates · Baze activates · Child teleports |
| B | Baze activates · Child teleports · Child activates |
| C | Baze activates · Child activates · Child teleports |

A is the companion-first path (already handled: it resolves before the host).
B and C are the same EoA window with the two descriptors resolved in either
order, which is precisely what the bucket chooser gives for free.

### Current state

**Clan of Two's teleport is in the WRONG WINDOW.** It is an ad-hoc prompt inside
`finishDcEndActivation` (~1327), i.e. after `cleanupActivation` (~1118), so it
fires in window 2. It must become an EoA descriptor.

**Companion-after-host** is handled by the separate slice-3 partial-end logic
(`getPairedActiveMsgId`), not as a descriptor, so it cannot currently be
interleaved with the teleport at all — orderings B and C are indistinguishable
today because neither is player-controlled.

### THIS APPLIES TO ALL COMPANIONS, NOT JUST THE CHILD

alexanbv 2026-08-12: "Remember this does not just apply to child, this applies
to ALL companions."

Baze + The Child is the worked example, not the scope. There are **5 companion
pairings** in the data (`companion` on the host card):

| Host | Companion |
|---|---|
| [Clan of Two] attachment | The Child |
| [Indentured Jester] attachment | Salacious B. Crumb |
| Iden Versio | Dio |
| Jarrod Kelvin | J4X-7 |
| (companion cards themselves) | 88-Z, BD-1, Cam Droid, Junk Droid, Pit Droid |

So the ordering rule — companion-second resolves INSIDE the host's EoA window —
must be implemented on the general companion path, not on a Child-specific
branch. Note the existing Clan of Two teleport code hard-codes
`fk.startsWith('The Child-')`, which is correct for that ATTACHMENT's own
teleport effect but must not become the model for the ordering itself.

Distinguish the two:

- **the ordering rule** — general, every companion
- **Clan of Two's teleport** — one attachment's effect, which happens to be the
  thing being ordered in the worked example

### Work

1. Make the Clan of Two teleport an EoA descriptor on the host's window.
2. Make "companion activates now" a descriptor in the same bucket when the
   companion was chosen to go second.
3. The chooser then produces B and C naturally. A is unchanged.
