/**
 * Phase-D probe: the Move action completes immediately after granting MP;
 * action-count advances before any MP is spent.
 *
 * PROBE-PD-MOVE-006: CRR ACTIONS/MOVEMENT — "When a figure performs a Move
 *   action, it gains MP equal to its Speed; the Move action is complete as
 *   soon as those MP are granted. The figure may then spend MP at any
 *   point (including interleaved with another action). Spending MP is
 *   never itself an action."
 *
 * Implementation: `src/handlers/dc-play-area.js` handles the `dc_move_`
 *   button. It (1) computes `mpRemaining = currentMp + speed` and writes
 *   it to `game.movementBank[msgId].remaining`, (2) decrements
 *   `actData.remaining` by 1 (unless SpendMp or Executive-Order free
 *   move), and only then (3) sets up `game.moveInProgress[...]` and
 *   shows the space picker. The subsequent space-pick handler
 *   (`src/handlers/movement.js`) never touches `actionsData.remaining`,
 *   so MP spending — even interleaved with another action — never costs
 *   a second action.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DCPA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');
const MOVE_SRC = readFileSync(resolve(ROOT, 'src/handlers/movement.js'), 'utf8');

describe('PROBE-PD-MOVE-006: Move action completes at MP-grant, not at MP-spend', () => {
  it('006a: source — dc_move handler branches on the Move action', () => {
    assert.match(DCPA_SRC,
      /if \(action === 'Move' \|\| action === 'SpendMp'\) \{/,
      'dc_move handler must gate on action === Move / SpendMp — CRR-MOVE-006');
  });

  it('006b: source — Move grants MP (speed) to movementBank before deducting the action', () => {
    // Per alexanbv 2026-06-13: MP is STRICTLY per-figure — no shared
    // top-level bank. The grant writes the figure's running MP into its
    // perFig sub-bank (perFig[figureIndex].remaining = mpRemaining).
    // Check that per-figure grant-write precedes the action deduction.
    const grantIdx = DCPA_SRC.indexOf("_top.perFig[figureIndex].remaining = mpRemaining;");
    // Per alexanbv 2026-06-13: the action is consumed strictly per-figure via
    // consumeActionForCurrentFigure (the old top-level actData.remaining
    // decrement is gone). Pin that the per-figure consume in the Move branch
    // follows the MP grant.
    const deductIdx = DCPA_SRC.indexOf("consumeActionForCurrentFigure(actData, 1, game, msgId);");
    assert.ok(grantIdx > 0, 'per-figure MP-grant write must exist');
    assert.ok(deductIdx > 0, 'action-deduct must exist');
    assert.ok(grantIdx < deductIdx,
      'MP-grant must precede action-deduct in dc_move handler — CRR-MOVE-006');
  });

  it('006c: source — Move action deducts 1 action (not 2) for a plain Move', () => {
    // Per alexanbv 2026-06-13: per-figure consume with cost 1 (not 2).
    assert.match(DCPA_SRC,
      /consumeActionForCurrentFigure\(actData, 1, game, msgId\);/,
      'Move costs exactly 1 action (per-figure consume) — CRR-MOVE-006');
  });

  it('006d: source — SpendMp and Executive-Order free-moves bypass the action deduction', () => {
    // The action deduction lives inside `if (!isSpendMp)` (SpendMp bypasses
    // it) and inside the `else` of the Executive-Order free-move branch
    // (ExecOrder bypasses it too). Per-figure consume replaces the old
    // top-level decrement.
    assert.match(DCPA_SRC,
      /if \(!isSpendMp\) \{[\s\S]{0,400}pendingExecutiveOrder[\s\S]{0,400}consumeActionForCurrentFigure\(actData, 1, game, msgId\);/,
      'SpendMp and ExecutiveOrder free-moves must short-circuit the action deduction — CRR-MOVE-006');
  });

  it('006e: source — the space-pick handler (movement.js) never deducts an action', () => {
    assert.doesNotMatch(MOVE_SRC,
      /actionsData\.remaining\s*=.*-\s*1/,
      'MP spending during space-pick must not cost an action — CRR-MOVE-006');
    assert.doesNotMatch(MOVE_SRC,
      /actData\.remaining\s*=.*-\s*1/,
      'MP spending during space-pick must not cost an action — CRR-MOVE-006');
  });

  it('006f: source — Move writes the space picker AFTER the action is already deducted', () => {
    const deductIdx = DCPA_SRC.indexOf("consumeActionForCurrentFigure(actData, 1, game, msgId);");
    const moveInProgressIdx = DCPA_SRC.indexOf("game.moveInProgress[moveKey] = {");
    assert.ok(deductIdx > 0 && moveInProgressIdx > 0,
      'both positions must be locatable');
    assert.ok(deductIdx < moveInProgressIdx,
      'action deduction precedes space-picker setup — Move is complete at grant-time — CRR-MOVE-006');
  });
});
