/**
 * Phase-D probe: attack resolution is atomic — a single in-flight
 * combat object (`game.pendingCombat`) represents the whole attack
 * from declaration through damage application. Because the combat
 * FSM holds one attack at a time and is resolved before control
 * returns to the action loop, there is no substrate for a defender
 * to move or for LOS to change mid-attack, and "after performing"
 * and "after resolving" are the same timing instance.
 *
 * PROBE-PD-ATK-007: CRR ATTACK — "During an attack, if the attacker's
 *   LOS to the target space changes or the defender moves, the
 *   attacker must re-declare a target space."
 *   (structurally vacuous — defender cannot move mid-attack)
 * PROBE-PD-ATK-008: CRR ATTACK — melee target-moved-out-of-range miss.
 *   (same: target cannot move mid-attack)
 * PROBE-PD-ATK-028: CRR ATTACK — "after performing" and "after
 *   resolving" an attack refer to the same timing instance.
 *   (single pendingCombat lifecycle → single terminal step)
 *
 * Implementation: `game.pendingCombat` is a single object set in
 *   `src/handlers/combat.js` at attack declaration (line 1157) and
 *   cleared after resolution. `resolveCombatAfterRolls` in
 *   `src/engine/combat-bridge.js` walks through the whole resolution
 *   (bonus application → roll → surge → damage → defeat) in one
 *   async flow; there is no "defender move" branch inside that flow.
 *   Interrupt-triggered nulling (Slow on the Draw) is the single
 *   cancel-and-replace path, which clears pendingCombat entirely
 *   rather than resuming it with updated state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const CM_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const CR_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat-reactions.js'), 'utf8');

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (p.endsWith('.js')) yield p;
  }
}

describe('PROBE-PD-ATK-007/008/028: combat is atomic — single pendingCombat lifecycle, no mid-attack defender-move substrate', () => {
  it('007a: source — combat.js sets game.pendingCombat as a single object at attack declaration (one in-flight attack at a time)', () => {
    assert.match(CM_SRC,
      /game\.pendingCombat = \{\s*\n\s*gameId: game\.gameId,\s*\n\s*attackerPlayerNum,/,
      'combat.js must set pendingCombat as a single object — CRR-ATK-007/008/028');
  });

  it('007b: source — no pendingCombat array/list container exists (no parallel-attack substrate)', () => {
    const hits = [];
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      if (/pendingCombats\b|pendingAttackQueue\b|pendingCombatList\b/.test(src)) {
        hits.push(p.replace(ROOT + '/', ''));
      }
    }
    assert.deepEqual(hits, [],
      'no src file may declare a parallel-combat container — CRR-ATK-007/008/028');
  });

  it('008a: source — no "defender moves mid-attack" or "re-declare target" path exists in combat resolution', () => {
    for (const p of walkFiles(resolve(ROOT, 'src'))) {
      const src = readFileSync(p, 'utf8');
      assert.doesNotMatch(src, /redeclareTarget|reDeclareTarget|defenderMovedDuringAttack/,
        `${p.replace(ROOT + '/', '')} must not declare a mid-attack target re-declaration path — CRR-ATK-007`);
    }
  });

  it('028a: source — resolveCombatAfterRolls is the single post-rolls resolution path (one terminal step for "after performing"/"after resolving")', () => {
    assert.match(CB_SRC,
      /export async function resolveCombatAfterRolls\(game, combat, client, deps\) \{/,
      'resolveCombatAfterRolls must be the sole post-rolls resolver — CRR-ATK-028');
  });

  it('028b: source — Slow-on-the-Draw interrupt clears pendingCombat (single cancel-and-replace path, not a resume-with-updated-state path)', () => {
    // Slice 7.3 (2026-05-06): `game.pendingCombat = null;` migrated to
    // `resolvePendingCombat(game)` (combat-stack helper that clears the
    // current frame and pops any nested-outer frame). The cancel-and-
    // replace semantic is unchanged — SoTD still stores its own outer
    // combat separately in `game.slowOnTheDrawInterrupt`.
    assert.match(CR_SRC,
      /resolvePendingCombat\(game\)/,
      'Slow-on-the-Draw must clear pendingCombat via resolvePendingCombat (cancel-and-replace, not mid-state resume) — CRR-ATK-028');
  });
});
