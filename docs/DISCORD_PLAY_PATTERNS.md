# Discord play patterns (CC/DC wiring contract)

**Purpose:** One place that defines how the bot implements player choices and effects in Discord. When wiring a card, **use an existing pattern or add one pattern and reuse it.** No one-off flows per card — that’s what makes things fragile.

**Rule:** Every fully wired CC/DC effect maps to exactly one of these (or a documented combination). New effects extend the list only when we need a new *kind* of interaction, not a new variant of an existing one.

---

## When to do what (order of work)

1. **Lock patterns first (or in lockstep), then wire in batches.**  
   Don’t wire all 200+ cards and *then* design Discord UX. You get 200 one-offs. Instead:
   - **Option A:** Write this doc (patterns + when to use each), implement any missing pattern **once** (e.g. reusable “pick a space” for CC/DC), then wire cards **using** the patterns.
   - **Option B:** Wire in small batches by pattern (e.g. “all cards that only need choice buttons”, then “all cards that need pick a space”). As you add a new pattern, document it here and reuse it for every subsequent card that needs it.

2. **DCs use the same patterns as CCs.**  
   Entry point differs (DC play area vs hand); the way we collect “choose one”, “pick a space”, “pick a figure” is the same. One implementation per pattern.

3. **Rock solid = consistent + documented.**  
   Same way to pick a space for push, placement, or “choose a cell”. Same way to pick a figure/DC (buttons with clear labels). Same way to resolve “choose one” (buttons). If something doesn’t fit, add **one** new pattern and use it everywhere it applies.

---

## Canonical patterns

### 1. Choice from list (buttons)

- **When:** “Choose one of these” (options known at resolve time).
- **Backend:** `resolveAbility` returns `requiresChoice: true`, `choiceOptions: string[]`.
- **Discord:** Handler sends one message with buttons (e.g. `cc_choice_${gameId}_${index}`); on click, call `resolveAbility` again with `choiceIndex` or `chosenOption: choiceOptions[choiceIndex]`.
- **Used by:** Blaze of Glory (which DC to ready), De Wanna Wanga (which card to shuffle), New Orders (which adjacent friendly DC), choose-one CCs (Smuggled Supplies, Retaliation, etc.).
- **Handlers:** `cc-hand.js` (handleCcChoice), dc-play-area when playing from DC.

### 2. Pick a space (grid + map)

- **When:** “Choose a cell” — placement, push destination, “choose a space within N”, etc.
- **Backend:** `resolveAbility` returns e.g. `requiresSpaceChoice: true`, `validSpaces: string[]` (coords). On second call, context includes `chosenSpace`.
- **Discord:** Reuse movement pattern: **zoomed map** (only valid spaces highlighted) + **grid of buttons** (e.g. `cc_space_${gameId}_${abilityId}_${space}`). Same layout as movement so players don’t learn two UIs.
- **Implementation:** One reusable flow: e.g. `getCcSpaceChoiceRows(gameId, abilityId, validSpaces, mapSpaces)` (or reuse `getMoveSpaceGridRows` with a different prefix), plus map attachment for `validSpaces`. One handler for `cc_space_*` that completes the ability with `chosenSpace`.
- **Used by (when built):** Cloned Reinforcements, Endless Reserves (place figure), Force Push (push destination), any “choose a space” effect.
- **Status:** Implemented. getSpaceChoiceRows + getMapAttachmentForSpaces; handleCcSpacePick for cc_space_*; Smoke Grenade wired (see ABILITY_LIBRARY.md “Pick a space”).

### 3. Pick a figure / target (buttons by name)

- **When:** “Choose a figure” (friendly or hostile), “choose a DC”, “choose adjacent hostile”, etc.
- **Backend:** Either (a) `requiresChoice` + `choiceOptions` = list of display names (e.g. figure names, DC names), or (b) `choiceTarget: string` and handler builds `choiceOptions` from game state and passes chosen value in context (e.g. `readyAdjacentFriendlyDcName`).
- **Discord:** Buttons per option (same as pattern 1). If the list comes from game state (e.g. “adjacent friendly figures”), handler computes it once and sends buttons.
- **Used by:** New Orders (adjacent friendly DC), Blaze of Glory (your DC), Expose Weakness (adjacent hostile), repair/recovery (adjacent friendly), etc.

### 4. Informational / log only

- **When:** No game state change; player just needs a reminder or to “look at” something.
- **Backend:** `resolveAbility` returns `applied: true`, `logMessage: string`. Optional: “Look at opponent’s Hand channel” etc.
- **Discord:** Log the message; no buttons. Optionally send an ephemeral or thread message.
- **Used by:** Collect Intel, Behind Enemy Lines (if we only log “look at top 3”), etc.

### 5. Reactive (e.g. cancel / respond to opponent play)

- **When:** “When opponent plays X, you may …” (e.g. Comm Disruption, Negation).
- **Backend:** Play flow for the *other* player is interrupted; we prompt the reactor with “Cancel this play? [Yes] [No]”. If Yes, we don’t apply the played card and remove it from hand / return to hand.
- **Discord:** When opponent clicks Play on a card, before applying: check if reactor has a reactive card; if so, send them a prompt in thread or DM; on Yes/No, continue or abort.
- **Status:** Partially present (e.g. Negation); full “cancel and discard” needs a single reusable hook in the CC play path.

---

## Wiring checklist (per card)

When fully wiring a CC or DC effect:

1. **Backend:** Add or extend a branch in `resolveAbility()` (and game state) so the effect is computed correctly. Return one of: `applied` + optional `logMessage` / `readyDcMsgIds` / etc.; or `requiresChoice` + `choiceOptions`; or `requiresSpaceChoice` + `validSpaces`; or `choiceTarget` + let handler supply options.
2. **Pattern:** Map to a pattern above. If it doesn’t fit, add **one** new pattern to this doc and implement it once.
3. **Handler:** Ensure the handler that calls `resolveAbility` does the Discord side for that pattern (buttons, grid+map, or log). Use existing `handleCcChoice`, `cc_space_*` (when built), etc. — no new handler per card unless it’s a new pattern.
4. **Library:** Update `ability-library.json` (and `wiredStatus` via script if used).

---

## Summary

- **Do not** wire everything first and then “fix Discord later.” You get fragile, inconsistent UX.
- **Do** define patterns (this doc), implement each pattern **once**, then wire cards **to** patterns. Same primitives for choice, space, figure, log, reactive.
- **DCs:** Same patterns; only the entry point (DC play area) differs.
- **Result:** Rock solid = every card uses a small set of well-defined, reusable Discord flows; fixing or improving a pattern fixes all cards that use it.
