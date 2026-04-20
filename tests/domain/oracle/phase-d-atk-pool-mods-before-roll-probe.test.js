/**
 * Phase-D probe: abilities that modify the attack or defense dice pools
 * are resolved before the dice are rolled (Step-2 setup).
 *
 * PROBE-PD-ATK-018: CRR ATTACKS — "If any abilities modify the attack or
 *   defense dice pools, they are resolved before rolling (Step 2 setup)."
 *
 * Implementation: `src/handlers/combat.js` gathers every pool-mutation
 *   input BEFORE the sole `rollAttackDice(dice)` call site:
 *     - base dice: `const baseDice = combat.attackInfo?.dice || [];`
 *     - additive: `combat.attackBonusDice`, `combat.attackBonusDiceColors`
 *     - subtractive: `combat.attackPoolRemoveMax`
 *     - capping: `combat.attackPoolKeepMax`
 *     - minimum-fill: `combat.attackPoolAddYellowUntilTotal`
 *     - override: `game.pendingOverrideAttackDice[msgId]` is consumed
 *       earlier in the same handler (before the `if (!combat.attackRoll)`
 *       gate), rewriting `attackInfo` and being DELETED before the roll.
 *   The `rollAttackDice(dice)` call is the single dice-resolution site
 *   — every mutation listed above is applied to `dice` before that
 *   call. computeCombatResult never re-rolls; it consumes `combat.attackRoll`.
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
  it('018a: source — the attack pool is a single `let dice = [...baseDice];` accumulator', () => {
    assert.match(H_CB_SRC,
      /const baseDice = combat\.attackInfo\?\.dice \|\| \[\];[\s\S]*?let dice = \[\.\.\.baseDice\];/,
      'attack pool must start as a mutable copy of base dice — CRR-ATK-018');
  });

  it('018b: source — pool mutations are gathered in a single pre-roll block', () => {
    assert.match(H_CB_SRC,
      /let dice = \[\.\.\.baseDice\];[\s\S]*?for \(let i = 0; i < bonusDice; i\+\+\) dice\.push\(bonusColors\[i\] \?\? primaryColor\);[\s\S]*?const removeMax = combat\.attackPoolRemoveMax \|\| 0;\s*\n\s*if \(removeMax > 0\) dice = dice\.slice\(0, Math\.max\(0, dice\.length - removeMax\)\);[\s\S]*?const keepMax = combat\.attackPoolKeepMax;[\s\S]*?const addYellowUntil = combat\.attackPoolAddYellowUntilTotal;[\s\S]*?const result = rollAttackDice\(dice\);/,
      'bonus/remove/keep/fill mutations must all precede rollAttackDice — CRR-ATK-018');
  });

  it('018c: source — the rollAttackDice call is uniquely downstream of the mutation block', () => {
    const rollIdx = H_CB_SRC.indexOf('const result = rollAttackDice(dice);');
    const mutBlockIdx = H_CB_SRC.indexOf('const baseDice = combat.attackInfo?.dice || [];');
    assert.ok(mutBlockIdx > 0, 'mutation block start must be locatable');
    assert.ok(rollIdx > 0, 'rollAttackDice call must be locatable');
    assert.ok(rollIdx > mutBlockIdx,
      'rollAttackDice must follow the mutation block in source order — CRR-ATK-018');
    const rollHits = (H_CB_SRC.match(/const result = rollAttackDice\(dice\);/g) || []).length;
    assert.equal(rollHits, 1,
      'there must be exactly one rollAttackDice site — no bypass path — CRR-ATK-018');
  });

  it('018d: source — pendingOverrideAttackDice is consumed BEFORE the roll (rewrites attackInfo, then deletes)', () => {
    const overrideIdx = H_CB_SRC.indexOf('const overrideDice = game.pendingOverrideAttackDice?.[msgId];');
    const deleteIdx = H_CB_SRC.indexOf('delete game.pendingOverrideAttackDice[msgId];');
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
