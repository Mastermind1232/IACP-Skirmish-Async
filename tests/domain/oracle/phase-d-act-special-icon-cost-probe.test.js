/**
 * Phase-D probe: special action icon cost semantics (1♦ vs 2♦).
 *
 * PROBE-PD-ACT-004: CRR ACTIONS — "Special actions are denoted by ♦; a
 *   single ♦ costs one action, two ♦ icons cost two actions but are
 *   treated as one ability; special actions containing multiple attacks
 *   or a move+attack still cost only the listed number of actions."
 *
 * Implementation: cost is carried by an `actionCost` field on the action
 *   payload. Surfacing: `src/engine/available-actions.js` tags CC specials
 *   with `actionCost: 1` and CC doubles with `actionCost: 2`. Deduction:
 *   `src/handlers/dc-play-area.js` reads `specialCosts[i] ?? 1` for DC
 *   specials (a 2-cost DC special uses a 2 entry in `specialCosts`), gates
 *   insufficient actions, and subtracts the cost from
 *   `actionsData.remaining`. The domain reducer's `DcActionPerformed`
 *   event subtracts `payload.actionCost || 1`, giving a single-ability
 *   deduction per special-action click regardless of the internal
 *   attack/move composition.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activationReducerHandlers } from '../../../src/domain/reducer/activation-reducer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const AA_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const DCPA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');

describe('PROBE-PD-ACT-004: special action icon cost semantics (1♦ vs 2♦)', () => {
  it('004a: CC specials tag actionCost: 1', () => {
    assert.match(AA_SRC,
      /PLAY_CC_SPECIAL[^\n]*\n[^\n]*\n[\s\S]{0,200}actionCost: 1/,
      'CC special-action surfacing must tag actionCost: 1 — CRR-ACT-004');
  });

  it('004b: CC doubles tag actionCost: 2', () => {
    assert.match(AA_SRC,
      /PLAY_CC_DOUBLE[^\n]*\n[^\n]*\n[\s\S]{0,200}actionCost: 2/,
      'CC double-action surfacing must tag actionCost: 2 — CRR-ACT-004');
  });

  it('004c: DC specials read per-index cost from specialCosts (default 1)', () => {
    assert.match(DCPA_SRC,
      /_effectiveActionCost = \(getDcStats\(meta\.dcName\)\.specialCosts \|\| \[\]\)\[specialIdx\] \?\? 1;/,
      'DC special cost must come from specialCosts[i] with default 1 — CRR-ACT-004');
  });

  it('004d: insufficient-action gate rejects specials that cost more than remaining', () => {
    assert.match(DCPA_SRC,
      /if \(actionsRemaining < _effectiveActionCost\) \{/,
      'must block a 2♦ special when only 1 action remains — CRR-ACT-004');
  });

  it('004e: action deduction uses _effectiveActionCost for dc_special_, else 1', () => {
    // Refactored 2026-05-07: per destruct multi-figure activation fix, the
    // group-wide remaining decrement now also tracks per-figure budgets via
    // consumeActionForCurrentFigure. Pin the helper call shape.
    assert.match(DCPA_SRC,
      /const actionCost = buttonKey === 'dc_special_' \? _effectiveActionCost : 1;\s*\n\s*consumeActionForCurrentFigure\(actionsData, actionCost\);/,
      'deduction must subtract the declared cost in one step via consumeActionForCurrentFigure — CRR-ACT-004');
  });

  it('004f: reducer DcActionPerformed subtracts payload.actionCost (default 1)', () => {
    const state = { dcActionsData: { 'mid-1': { remaining: 2, total: 2 } } };
    const after1 = activationReducerHandlers.DcActionPerformed(state, { msgId: 'mid-1' });
    assert.equal(after1.dcActionsData['mid-1'].remaining, 1,
      'default actionCost = 1 deducts exactly 1 — CRR-ACT-004');
    const after2 = activationReducerHandlers.DcActionPerformed(state, { msgId: 'mid-1', actionCost: 2 });
    assert.equal(after2.dcActionsData['mid-1'].remaining, 0,
      'actionCost: 2 deducts both actions in one event — CRR-ACT-004 (two-icon = two-action but one ability)');
  });
});
