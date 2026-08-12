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
