/**
 * Phase-D probe: when a large figure enters difficult terrain, the MP
 * surcharge is +1 regardless of how many difficult-terrain spaces it
 * occupies on that step.
 *
 * PROBE-PD-DT-005: CRR DIFFICULT TERRAIN — "When a large figure enters
 *   difficult terrain, it spends only one additional movement point
 *   regardless of how many spaces of difficult terrain it occupies."
 *
 * Implementation: in `src/game/movement.js`, `evaluateMovementStep` builds
 *   `entering` = the cells of the next footprint not in the previous
 *   footprint, then computes `enteringDifficult` as a single boolean via
 *   `entering.some((cell) => (board.terrain[cell] || 'normal') === 'difficult')`.
 *   The surcharge is applied unconditionally once: `if (enteringDifficult)
 *   extraCost += 1;`. Because `enteringDifficult` is a boolean and the
 *   increment is a single `+= 1`, a large figure sliding two cells into
 *   two DT spaces pays +1, not +2.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const MV_SRC = readFileSync(resolve(ROOT, 'src/game/movement.js'), 'utf8');

describe('PROBE-PD-DT-005: large figures pay +1 MP for entering DT regardless of DT-cell count', () => {
  it('005a: source — `entering` is the set of newly-entered cells (nextFootprint minus prevFootprint)', () => {
    assert.match(MV_SRC,
      /const entering = nextFootprint\.filter\(\(cell\) => !prevSet\.has\(cell\)\);/,
      '`entering` must be the newly-entered footprint cells — CRR-DT-005');
  });

  it('005b: source — `enteringDifficult` is a single boolean via Array.some, not a count', () => {
    // Allow optional gate lines (e.g. !wallRunWaivesDifficult) to appear
    // between !profile.ignoreDifficult and the entering.some(...) check.
    // The invariant is: the boolean is computed via Array.some over entering
    // cells, not a per-cell counter; additional && gates are permitted.
    assert.match(MV_SRC,
      /const enteringDifficult =\s*\n\s*!profile\.ignoreDifficult &&[\s\S]{0,200}?\(entering\.some\(\(cell\) => \(board\.terrain\[cell\] \|\| 'normal'\) === 'difficult'\)/,
      'enteringDifficult must be a boolean (some), not a per-cell counter — CRR-DT-005');
  });

  it('005c: source — the DT surcharge is a single unconditional +1 (no loop, no multiplier)', () => {
    assert.match(MV_SRC,
      /if \(enteringDifficult\) extraCost \+= 1;/,
      'DT surcharge must be exactly +1 per step, not per DT cell — CRR-DT-005');
    const stepBody = MV_SRC.match(/const enteringDifficult =[\s\S]*?if \(enteringHostile && !profile\.ignoreFigureCost\) extraCost \+= 1;/);
    assert.ok(stepBody, 'step-cost block must be locatable');
    assert.doesNotMatch(stepBody[0], /for \([^)]*difficult[^)]*\)/,
      'no per-DT-cell loop may appear in the step-cost block — CRR-DT-005');
    assert.doesNotMatch(stepBody[0], /extraCost \+= [^1]/,
      'DT surcharge must not multiply by DT count — CRR-DT-005');
  });

  it('005d: source — only one `enteringDifficult` definition exists (no size-branched alternate surcharge)', () => {
    const defs = (MV_SRC.match(/const enteringDifficult =/g) || []).length;
    assert.equal(defs, 1,
      'a size-branched alternate DT-surcharge definition would invalidate the single-rule pin — CRR-DT-005');
  });

  it('005e: source — the step-cost is baseCost (1) + extraCost (DT + hostile surcharges only)', () => {
    assert.match(MV_SRC,
      /const baseCost = 1;\s*\n\s*let extraCost = 0;\s*\n\s*if \(enteringDifficult\) extraCost \+= 1;\s*\n\s*if \(enteringHostile && !profile\.ignoreFigureCost\) extraCost \+= 1;/,
      'total step cost must be base=1 plus up-to-two single surcharges — CRR-DT-005');
  });
});
