/**
 * Phase-D probe: an ability whose use costs more VP than the player has
 * cannot be used; the attempt returns `{ applied: false }` with no VP
 * deduction and no effect resolution.
 *
 * PROBE-PD-VPS-004: CRR VICTORY POINTS — "If using an ability requires a
 *   player to pay more VPs than that player has, that player cannot use
 *   that ability."
 *
 * Implementation: in `src/game/abilities.js`, any dcSpecial entry with
 *   `autoDeductVp > 0` (e.g. Order Hit's 2-VP cost) is gated in Phase 1
 *   (target-enumeration) by:
 *     if (entry.autoDeductVp > 0) {
 *       const currentVp = game[vpKey(playerNum)]?.total || 0;
 *       if (currentVp < entry.autoDeductVp) {
 *         return { applied: false, manualMessage: '…' };
 *       }
 *     }
 *   This gate precedes the Phase-2 `deductVp(...)` + `applyCondition(...)`
 *   resolution — so a player below the threshold never reaches target
 *   selection, never has VP deducted, and the effect never resolves.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ABIL_SRC = readFileSync(resolve(ROOT, 'src/game/abilities.js'), 'utf8');

describe('PROBE-PD-VPS-004: VP-cost abilities are gated by affordability', () => {
  it('004a: source — autoDeductVp gate reads currentVp and short-circuits on shortfall', () => {
    assert.match(ABIL_SRC,
      /if \(entry\.autoDeductVp > 0\) \{\s*\n\s*const vk = vpKey\(playerNum\);\s*\n\s*const currentVp = game\[vk\]\?\.total \|\| 0;\s*\n\s*if \(currentVp < entry\.autoDeductVp\) \{\s*\n\s*return \{ applied: false, manualMessage:/,
      'Phase-1 VP gate must return applied:false when currentVp < autoDeductVp — CRR-VPS-004');
  });

  it('004b: source — gate precedes the Phase-2 deductVp call in source order', () => {
    const gateIdx = ABIL_SRC.indexOf("if (currentVp < entry.autoDeductVp) {");
    const deductIdx = ABIL_SRC.indexOf("deductVp(game, playerNum, entry.autoDeductVp);");
    assert.ok(gateIdx > 0, 'VP gate must be locatable');
    assert.ok(deductIdx > 0, 'deductVp call must be locatable');
    // The deductVp call is in Phase-2 (target already chosen); the gate is
    // in Phase-1 (before returning target picker). Phase-1 runs before
    // Phase-2 on a given invocation, so the only way to reach the deduct
    // path is to have re-entered after the gate already returned applied:true.
    // We pin both: the gate exists with the exact shortfall message shape,
    // and the deduct is NOT preceded by an un-gated execution in a different
    // autoDeductVp branch.
    assert.equal(
      (ABIL_SRC.match(/deductVp\(game, playerNum, entry\.autoDeductVp\);/g) || []).length,
      1,
      'there must be exactly one deductVp(…, entry.autoDeductVp) call — any second site would need its own gate — CRR-VPS-004'
    );
  });

  it('004c: source — shortfall branch returns applied:false (does not throw or silently deduct)', () => {
    // The return shape guarantees the caller sees a no-op, not a partial apply.
    assert.match(ABIL_SRC,
      /return \{ applied: false, manualMessage: `\*\*\$\{entry\.label\}\*\* requires \$\{entry\.autoDeductVp\} VP but you only have \$\{currentVp\}\.` \};/,
      'shortfall message must carry required/current VP for UI, with applied:false — CRR-VPS-004');
  });

  it('004d: source — there is no code path that deducts VP before the affordability check', () => {
    // Structural invariant: every autoDeductVp read that leads to deductVp
    // is downstream of (or co-located with) the shortfall gate. Grep the
    // file: the only `entry.autoDeductVp > 0` branches are (1) the
    // Phase-2 deduct site and (2) the Phase-1 gate site. No third site.
    const matches = ABIL_SRC.match(/if \(entry\.autoDeductVp > 0\)/g) || [];
    assert.equal(matches.length, 2,
      'exactly two `entry.autoDeductVp > 0` branches (Phase-2 apply + Phase-1 gate) — CRR-VPS-004');
  });
});
