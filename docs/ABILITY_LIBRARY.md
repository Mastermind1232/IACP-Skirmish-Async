# Ability library (F1, F3, F4)

The bot resolves abilities from a central **ability library** (`data/ability-library.json`) and code in `src/game/abilities.js`. Surge abilities are fully wired (F2); DC specials and CC effects use the library and fall back to "Resolve manually" until implemented (F3/F4).

## Data: ability-library.json

- **Format:** `{ "source": "...", "abilities": { "id": { "type", ... } } }`.
- **Surge abilities:** `type: "surge"`, optional `surgeCost` (default 1), `label` for display. Keys match `dc-effects.json` surgeAbilities (e.g. `"damage 1"`, `"pierce 2"`, `"damage 4"` with surgeCost 2).
- **Other types (future):** `specialAction`, `passive`, `triggered`, `ccEffect` — add an entry and implement the branch in `resolveAbility()`.

## Surge (F2 — done)

- Combat uses `resolveSurgeAbility(id)` and `getSurgeAbilityLabel(id)` from context.
- Resolution: `parseSurgeEffect(id)` in `src/game/combat.js` returns damage, pierce, accuracy, conditions, blast, recover, cleave.
- To add a new surge option: add the key to `ability-library.json` with `type: "surge"` and ensure `parseSurgeEffect()` handles that key (or add a case there).

## DC specials and CC effects (F3/F4 — incremental)

- **DC Special:** Handler passes an ability id (e.g. `dc_special:DCName:0`) to `resolveAbility(id, ctx)`. If the library has a non-surge implementation, it runs; otherwise the user sees "Resolve manually: …".
- **CC play:** After a CC is played, the bot calls `resolveAbility(cardName, ctx)`. Card name is used as the library id for CCs unless we migrate to explicit ids (D2).

### Implemented CC effects

**Draw N cards**

- In `ability-library.json`, add `"Card Name": { "type": "ccEffect", "label": "Draw 1 Command card", "draw": 1 }` (use `draw`: 2, 3, etc. for multi-draw).

**Conditional draw (drawIfTrait)**

- Add `"drawIfTrait": "LEADER"` (or other trait) to only draw when the figure has that trait. Uses combat context (attacker during attack) or dcMessageMeta (during activation). Example: **Officer's Training** — draws 1 only if the attacking figure is a LEADER.

**+N MP (fixed bonus)**

- Add `"mpBonus": N` — e.g. Fleet Footed (+1 MP), Force Rush (+2 MP). Requires active activation (`dcMessageMeta`, `findActiveActivationMsgId`).

**Speed + N MP**

- Add `"mpBonusFromSpeed": N` — MP gained = DC's Speed + N (e.g. Urgency: Speed+2). Requires active activation. Uses `getStatsForDc(meta.dcName)` for speed lookup.

**Focus**

- `abilityId === "Focus"` or `applyFocus: true` — applies Focus condition to all figures in the active DC. **Meditation** uses `applyFocus` (future attack option manual).
- `resolveAbility` will mutate `game.player1CcDeck` / `player2CcDeck` and hand, return `{ applied: true, drewCards: [...] }`. The CC handler refreshes the hand message and logs the draw.
**Power Token gain (powerTokenGain)**

- Add `"powerTokenGain": 1` (or 2) — give Power Token(s) to activating figure. Optional `powerTokenGainIfDamagedGte: { "3": 2 }` — if figure has suffered ≥3 damage, give 2 instead.
- Example: **Battle Scars** — 1 token normally, 2 if suffered 3+ damage.

**Focus to figures (focusGainToUpToNFigures)**

- Add `"focusGainToUpToNFigures": 3` with `vpCondition: { opponentHasAtLeastMore: 8 }` — end of round; if opponent has ≥8 more VPs, apply Focus to up to N of your figures. Auto when you have ≤N figures; manual when >N (choose which).
- Example: **Against the Odds**.

**MP after attack (mpAfterAttack)**

- Add `"mpAfterAttack": N` — Special Action: perform an attack; after it resolves, gain N movement points. Sets `game.hitAndRunPendingMp`; `finishCombatResolution` in index.js adds MP when the attacker's combat resolves.
- Example: **Hit and Run** (3 MP after attack).

**Next N attacks bonus hits (nextAttacksBonusHits)**

- Add `"nextAttacksBonusHits": { "count": N, "bonus": M }` — during activation, apply +M Hit to the next N attacks by your figures. Consumed in `resolveCombatAfterRolls`; cleared when activation ends.
- Optional `"nextAttacksBonusConditions": { "count": N, "conditions": ["Weaken"] }` — also apply conditions to the defender on the next N attacks.
- Example: **Beatdown** (+1 Hit to next 2 attacks), **Size Advantage** (+2 Hit, Weaken to next attack).

**Attack surge bonus (attackSurgeBonus)**

- Add `"attackSurgeBonus": N` — during attack, as the attacker, add +N Surge to the attack results. If played before surge step, stored in `combat.surgeBonus`; if played during surge step, added directly to `combat.surgeRemaining`.
- Example: **Blitz** (+1 Surge), **Bladestorm** (+1 Surge; hostiles within 2 spaces suffer 1 Damage after attack — resolve manually).

**Attack bonus hits (attackBonusHits)**

- Add `"attackBonusHits": N` — during attack, as the attacker, add +N Hit to this attack's results. Stored in `combat.bonusHits`.
- Example: **Positioning Advantage** (+1 Hit), **Heavy Ordnance** (+1 Hit vs figure; vs object use +2 Hit and Pierce 2 manually), **Assassinate** (+3 Hits; play as first CC, no other CCs — honor rule manually), **Deathblow** (+1 Hit for Melee; +2 if defender has Ranged — manual).
- Combo with **applyFocus**: `applyFocus: true` + `attackBonusHits: N` — become Focused and add +N Hit. Example: **Primary Target** (target must have highest figure cost — validate manually).

**Attack accuracy bonus (attackAccuracyBonus)**

- Add `"attackAccuracyBonus": N` — during attack, as the attacker, add +N Accuracy to this attack. Stored in `combat.bonusAccuracy`.
- Example: **Deadeye** (+2 Accuracy), **Lock On** (+3 Accuracy; -1 Dodge/-1 Evade options manual).

**Attack bonus pierce (attackBonusPierce)**

- Add `"attackBonusPierce": N` — during attack, as the attacker, add +N Pierce to this attack. Stored in `combat.bonusPierce`. Ready for Heavy Ordnance vs object (+2 Hit, Pierce 2) when object detection is added.

**Attack bonus dice (attackBonusDice)**

- Add `"attackBonusDice": N` — when declaring attack, as the attacker, add N attack dice to the attack pool. Uses primary die color. Example: **Tools for the Job** (add 1 attack die).

**Defense bonus block (applyDefenseBonusBlock)**

- Add `"applyDefenseBonusBlock": N` — when defending, add +N Block to defense results. Stored in `combat.bonusBlock`.
- Optional `"defenseBonusOnlyWhenNotAttackerActivation": true` — only apply when the attack is NOT during the attacker's activation (e.g. Overwatch). Example: **Brace Yourself** (+2 Block).

**Attack bonus blast (attackBonusBlast)**

- Add `"attackBonusBlast": N` — when declaring attack, as the attacker, this attack gains Blast N. Stored in `combat.bonusBlast`.
- Example: **Explosive Weaponry** (Blast 1).

**Apply Hide when defending (applyHideWhenDefending)**

- Add `"applyHideWhenDefending": true` — when an attack targeting you is declared, the defender becomes Hidden. Requires combat context with defender as player. Stored in `game.figureConditions[target.figureKey]`.
- Example: **Camouflage** (become Hidden when attack declared on you).

**Clear opponent discard (clearOpponentDiscard)**

- Add `"clearOpponentDiscard": true` — return opponent's Command discard pile to the game box. Optional `"draw": N` + `"drawIfTrait": "TRAIT"` — then draw N cards if the activating figure has that trait. Example: **Fool Me Once** (clear discard; draw 1 if SPY).

**Discard HARMFUL conditions (discardHarmfulConditions)**

- Add `"discardHarmfulConditions": true` — at start of activation, discard all Stun, Weaken, Bleed from the activating figure(s). Requires active activation.
- Example: **Rally**.

**Recover damage (recoverDamage)**

- Add `"recoverDamage": N` — Special Action: the activating figure recovers N damage. Requires dcHealthState and msgId in context (passed when playing CC as special from DC play area).
- Example: **Recovery** (Recover 2 Damage).

**Heart of Freedom combo (discardUpToNHarmful + recoverDamage + mpBonus)**

- Add `"discardUpToNHarmful": N`, `"recoverDamage": M`, `"mpBonus": K` — at start of activation: discard up to N HARMFUL conditions, recover M damage, gain K MP. Requires dcMessageMeta, dcHealthState (from cc-hand or dc-play-area).
- Example: **Heart of Freedom** (discard 1, recover 2, gain 2 MP).

- Example cards in library: **There is Another** (draw 1), **Planning** (draw 2), **Black Market Prices** (draw 2), **Forbidden Knowledge** (draw 1), **Officer's Training** (draw 1 if LEADER), **Fool Me Once** (clear opponent discard; draw 1 if SPY), **Fleet Footed** (+1 MP), **Advance Warning** (+2 MP to you and adjacent), **Force Rush** (+2 MP), **Heart of Freedom** (discard 1 HARMFUL, recover 2, +2 MP), **Price of Glory** (discard 1 HARMFUL, +2 MP; Power Tokens manual), **Worth Every Credit** (discard 1 HARMFUL, +2 MP; VP on defeat manual), **Apex Predator** (+2 MP), **Rank and File** (+1 MP; adjacent TROOPERS manual), **Urgency** (Speed+2 MP), **Focus** (become Focused), **Battle Scars** (Power Token gain), **Rally** (discard HARMFUL conditions), **Against the Odds** (Focus up to 3 if VP condition met), **Hit and Run** (3 MP after attack), **Beatdown** (+1 Hit to next 2 attacks), **Blitz** (+1 Surge during attack), **Positioning Advantage** (+1 Hit), **Deadeye** (+2 Accuracy), **Heavy Ordnance** (+1 Hit vs figure), **Assassinate** (+3 Hits), **Deathblow** (+1 Hit), **Bladestorm** (+1 Surge; blast manual), **Lock On** (+3 Accuracy; -1 Dodge/Evade manual), **Explosive Weaponry** (Blast 1), **Maximum Firepower** (+4 Hit to next attack via nextAttacksBonusHits), **Tools for the Job** (add 1 attack die), **Brace Yourself** (+2 Block when not attacker's activation).

### Adding a non-surge ability

1. **Add to ability-library.json**  
   Example: `"my_ability_id": { "type": "specialAction", "label": "Do X" }`.

2. **Implement in src/game/abilities.js**  
   In `resolveAbility(abilityId, context)`:
   - After the existing `if (!entry || entry.type === 'surge')` check, add a branch for your type, e.g. `if (entry.type === 'specialAction') { ... }`.
   - Use `context.game`, `context.playerNum`, etc. to apply state changes (no Discord calls; return `{ applied: true }` or `{ applied: false, manualMessage: '...' }`).
   - The handler that called `resolveAbility` is responsible for logging and Discord UI (e.g. "Resolve manually" message when `applied: false`).

3. **Wire the id from the card**  
   DC effects reference abilities via surgeAbilities or specials; CCs currently use card name as id. When you add an implementation, ensure the handler passes the same id that you added to the library.

## Files

| File | Role |
|------|------|
| `data/ability-library.json` | Id → type, label, surgeCost; add new abilities here. |
| `src/game/abilities.js` | getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility. |
| `src/game/combat.js` | parseSurgeEffect (surge modifiers). |
| DC/CC handlers | Call resolveAbility with the appropriate id and context. |

### Example: There is Another (CC — Draw 1)

- **ability-library.json:** `"There is Another": { "type": "ccEffect", "label": "Draw 1 Command card", "draw": 1 }`.
- **abilities.js:** For `ccEffect` with `draw: 1`, `drawCcCards(game, playerNum, 1)` is called; returns `{ applied: true, drewCards: [card] }`.
- **cc-hand.js:** When `resolveAbility` returns `applied: true` and `drewCards`, the handler calls `updateHandVisualMessage` and logs the drawn card(s).

## Power Tokens (consolidated rules reference)

From **docs/RULES_REFERENCE.md** and **docs/consolidated-rules-raw.txt**:

- **Types:** Surge (surge), Damage/Hit, Evade, Block. Wild (player chooses any).
- **Spending:** When a figure declares an attack or is declared as target, it may spend 1 Power Token to apply +1 of the symbol to attack results. Attacker cannot spend Block or Evade; defender cannot spend Hit or Surge.
- **Max 2 per figure.** If a figure would gain more than 2, its player must choose tokens to discard until the figure has 2.
- **Max 1 spent per attack.**

**Status:** Power Token **tracking and display** are implemented. `game.figurePowerTokens[figureKey]` stores tokens; map shows them on figures. **Gaining** via CC (Battle Scars) is automated. **Spending** during combat (attacker/defender restrictions) is not yet wired — resolve manually.

---

## Progress (~7% of CCs auto; ~90% of those with abilityId)

- **Surge:** 100% — all surge abilities resolved.
- **CC effects:** 298 total; 39 have abilityId; ~39 fully or partially automated.
- **CCs with automation:** Draw (4), conditional draw (2), MP bonus (9 incl. Advance Warning), Focus (2 incl. Meditation), Power Token gain (1), Rally (discardHarmfulConditions), Recovery (recoverDamage), Heart of Freedom, Price of Glory, Worth Every Credit (discardUpToNHarmful + mpBonus combo), Apex Predator (Focus + Hide + 2 Power Tokens + 2 MP; recovery on defeat manual), Against the Odds (1), Hit and Run (mpAfterAttack), Beatdown (nextAttacksBonusHits), Maximum Firepower (nextAttacksBonusHits), Size Advantage (nextAttacksBonusHits + nextAttacksBonusConditions; target SMALL manual), Blitz (attackSurgeBonus), Master Operative (applyFocus + attackSurgeBonus), Primary Target (applyFocus + attackBonusHits; highest-cost target manual), Bladestorm (attackSurgeBonus; blast manual), Camouflage (applyHideWhenDefending), Positioning Advantage (attackBonusHits), Assassinate (attackBonusHits), Deathblow (attackBonusHits; +2 vs Ranged manual), Deadeye (attackAccuracyBonus), Lock On (attackAccuracyBonus; -1 Dodge/Evade manual), Heavy Ordnance (attackBonusHits vs figure), Explosive Weaponry (attackBonusBlast), Tools for the Job (attackBonusDice), Brace Yourself (applyDefenseBonusBlock; when not attacker's activation), Fool Me Once (clearOpponentDiscard; draw 1 if SPY).

Phase 2 next: add more `type` values and branches in `resolveAbility` (e.g. more CC “draw N” effects, DC specials by name) so more effects run automatically instead of showing "Resolve manually".
