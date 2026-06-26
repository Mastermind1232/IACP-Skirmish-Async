/**
 * Phase-D probe: abilities that modify the attack or defense dice pools
 * are resolved before the dice are rolled (Step-2 setup).
 *
 * PROBE-PD-ATK-018: CRR ATTACKS — "If any abilities modify the attack or
 *   defense dice pools, they are resolved before rolling (Step 2 setup)."
 *
 * Implementation: `src/handlers/combat.js` gathers every pool-mutation
 *   input BEFORE the `rollAttackDice(dice)` call site:
 *     - base dice: `_buildAttackPool` (`const dice = [...baseDice];`)
 *     - additive: `combat.attackBonusDice`, `combat.attackBonusDiceColors`
 *     - subtractive: `combat.attackPoolRemoveMax`  (Run for Cover)
 *     - capping: `combat.attackPoolKeepMax`        (Savage Vigor)
 *       The remove/keep trims are now CHOICE-DRIVEN: `_resolveAttackPoolTrim`
 *       returns `{dice}` for the deterministic (no-choice) case and
 *       `{needPicker,...}` when the defender (Run for Cover) / attacker
 *       (Savage Vigor) must pick which die — the picker posts and the next
 *       Roll click consumes `combat._atkPickIdxList`. Either way the trimmed
 *       `dice` is fixed BEFORE `rollAttackDice`.
 *     - minimum-fill: `combat.attackPoolAddYellowUntilTotal`
 *     - override: `game.pendingOverrideAttackDice[msgId]` is consumed
 *       earlier in the same handler (before the `if (!combat.attackRoll)`
 *       gate), rewriting `attackInfo` and being DELETED before the roll.
 *   computeCombatResult never re-rolls; it consumes `combat.attackRoll`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const H_CB_SRC = readFileSync(resolve(ROOT, 'src/handlers/combat.js'), 'utf8');

describe('PROBE-PD-ATK-018: pool modifications resolve BEFORE the roll (Step 2 setup)', () => {
  it('018a: source — the attack pool is a `const dice = [...baseDice];` accumulator (in _buildAttackPool)', () => {
    assert.match(H_CB_SRC,
      /const baseDice = combat\.attackInfo\?\.dice \|\| \[\];[\s\S]*?const dice = \[\.\.\.baseDice\];/,
      'attack pool must start as a mutable copy of base dice — CRR-ATK-018');
  });

  it('018b: source — bonus/remove/keep trims resolve via _resolveAttackPoolTrim before fill + roll', () => {
    // _resolveAttackPoolTrim folds the base+bonus pool build, the Run-for-Cover
    // (attackPoolRemoveMax) removal and the Savage-Vigor (attackPoolKeepMax) cap
    // (now choice-driven) into one helper, returning the trimmed `dice` BEFORE
    // the minimum-fill block and the single rollAttackDice site.
    assert.match(H_CB_SRC,
      /const removeMax = combat\.attackPoolRemoveMax \|\| 0;[\s\S]*?const keepMax = \(typeof combat\.attackPoolKeepMax === 'number'\)[\s\S]*?if \(removeMax > 0\) dice = dice\.slice\(0, Math\.max\(0, dice\.length - removeMax\)\);[\s\S]*?if \(keepMax != null && keepMax > 0 && dice\.length > keepMax\) dice = dice\.slice\(0, keepMax\);/,
      '_resolveAttackPoolTrim must build the pool and apply remove/keep trims pre-roll — CRR-ATK-018');
    // The roll branches consume the trimmed dice then run the minimum-fill block
    // immediately before the roll.
    assert.match(H_CB_SRC,
      /let dice = _atkTrim\.dice;\s*\n\s*const addYellowUntil = combat\.attackPoolAddYellowUntilTotal;[\s\S]*?const result = rollAttackDice\(dice\);/,
      'trimmed dice + minimum-fill must precede rollAttackDice — CRR-ATK-018');
  });

  it('018c: source — the rollAttackDice call is uniquely downstream of the pool-trim call', () => {
    const rollIdx = H_CB_SRC.indexOf('const result = rollAttackDice(dice);');
    // The pool mutations are now resolved by _resolveAttackPoolTrim, CALLED in
    // each roll branch before the roll (the helper itself is defined lower in
    // the file but JS-hoisted). Anchor the order check on the first call site.
    const mutBlockIdx = H_CB_SRC.indexOf('const _atkTrim = _resolveAttackPoolTrim(combat);');
    assert.ok(mutBlockIdx > 0, 'pool-trim call must be locatable');
    assert.ok(rollIdx > 0, 'rollAttackDice call must be locatable');
    assert.ok(rollIdx > mutBlockIdx,
      'rollAttackDice must follow the pool-trim call in source order — CRR-ATK-018');
    const rollHits = (H_CB_SRC.match(/const result = rollAttackDice\(dice\);/g) || []).length;
    // 2026-05-04: held-roll feature added a second rollAttackDice site for
    // the first-press path (computes silently, holds the result until the
    // other player rolls). Both sites preserve the mutation-block-before-roll
    // invariant — the order check (rollIdx > mutBlockIdx) above runs against
    // the FIRST occurrence of each, which is the held-roll site.
    assert.ok(rollHits === 1 || rollHits === 2,
      'rollAttackDice site count must be 1 (legacy) or 2 (legacy + held-roll first-press) — CRR-ATK-018');
  });

  it('018d: source — pendingOverrideAttackDice is consumed BEFORE the roll (rewrites attackInfo, then deletes)', () => {
    // Per alexanbv 2026-05-13: keyed by attacker figureKey (_attackerFkEarly).
    const overrideIdx = H_CB_SRC.indexOf('const overrideDice = game.pendingOverrideAttackDice?.[_attackerFkEarly];');
    const deleteIdx = H_CB_SRC.indexOf('delete game.pendingOverrideAttackDice[_attackerFkEarly];');
    const rollIdx = H_CB_SRC.indexOf('const result = rollAttackDice(dice);');
    assert.ok(overrideIdx > 0, 'override read must be locatable');
    assert.ok(deleteIdx > 0, 'override delete must be locatable');
    assert.ok(overrideIdx < deleteIdx, 'override must be read before deletion');
    assert.ok(deleteIdx < rollIdx,
      'override must be fully consumed (read + applied + deleted) before rollAttackDice — CRR-ATK-018');
  });

  it('018e: source — override rewrites attackInfo.dice (not the rolled result)', () => {
    assert.match(H_CB_SRC,
      /if \(overrideDice\.dice\) attackInfo = \{ \.\.\.attackInfo, dice: overrideDice\.dice \};/,
      'override must rewrite the dice pool pre-roll, not post-roll results — CRR-ATK-018');
  });

  it('018f: source — combat.attackRoll is assigned exclusively from the rollAttackDice result', () => {
    assert.match(H_CB_SRC,
      /const result = rollAttackDice\(dice\);\s*\n\s*combat\.attackRoll = \{ acc: result\.acc, dmg: result\.dmg, surge: result\.surge \};/,
      'attackRoll must be the direct output of the single roll call — CRR-ATK-018');
  });
});
