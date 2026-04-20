/**
 * Phase-D probe: CRR CC-007 — "If the card has the (special action) icon,
 * that figure must spend one action to resolve the ability. If the card has
 * two special action icons, that figure must spend two actions to resolve
 * the ability."
 *
 * Substrate: Special Action CCs are played from a DC's action thread via the
 * PLAY_CC_SPECIAL action type (1 action) and Double Action CCs via
 * PLAY_CC_DOUBLE (2 actions). Gates in available-actions.js prevent offering
 * them when the figure lacks the required actions; the dc-play-area.js
 * handler decrements the figure's remaining actions on resolve.
 *
 * Implementation chain (invariant pin):
 *   1. ACTION_TYPES.PLAY_CC_SPECIAL and PLAY_CC_DOUBLE exist as distinct
 *      action types (pin "one action" vs "two actions" split).
 *   2. available-actions.js gates: PLAY_CC_SPECIAL gated on remaining >= 1
 *      (and offered with actionCost: 1); PLAY_CC_DOUBLE gated on
 *      remaining >= 2 (and offered with actionCost: 2).
 *   3. dc-play-area.js _playCcFromDcThread decrements remaining by 1 for
 *      Special Action, and sets remaining to 0 for Double Action.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const ACTION_TYPES_SRC = readFileSync(resolve(ROOT, 'src/engine/action-types.js'), 'utf8');
const AVAIL_SRC = readFileSync(resolve(ROOT, 'src/engine/available-actions.js'), 'utf8');
const DCPA_SRC = readFileSync(resolve(ROOT, 'src/handlers/dc-play-area.js'), 'utf8');

describe('PROBE-PD-CC-007: CC special action icons cost 1 or 2 actions', () => {
  it('007a: source — ACTION_TYPES defines PLAY_CC_SPECIAL and PLAY_CC_DOUBLE as distinct action types', () => {
    assert.match(ACTION_TYPES_SRC,
      /PLAY_CC_SPECIAL: 'play_cc_special',/,
      'PLAY_CC_SPECIAL action type must exist — CRR-CC-007 (single-icon cost)');
    assert.match(ACTION_TYPES_SRC,
      /PLAY_CC_DOUBLE: 'play_cc_double',/,
      'PLAY_CC_DOUBLE action type must exist — CRR-CC-007 (double-icon cost)');
  });

  it('007b: source — available-actions gates PLAY_CC_SPECIAL on remaining >= 1 with actionCost: 1', () => {
    assert.match(AVAIL_SRC,
      /if \(deps\.getPlayableCcSpecialsForDc && data\.remaining >= 1\) \{/,
      'Special Action CCs must require at least 1 remaining action — CRR-CC-007');
    assert.match(AVAIL_SRC,
      /type: ACTION_TYPES\.PLAY_CC_SPECIAL,[\s\S]{0,400}?actionCost: 1 \}/,
      'PLAY_CC_SPECIAL offering must carry actionCost: 1 — CRR-CC-007');
  });

  it('007c: source — available-actions gates PLAY_CC_DOUBLE on remaining >= 2 with actionCost: 2', () => {
    assert.match(AVAIL_SRC,
      /if \(deps\.getPlayableCcDoubleActionsForDc && data\.remaining >= 2\) \{/,
      'Double Action CCs must require at least 2 remaining actions — CRR-CC-007');
    assert.match(AVAIL_SRC,
      /type: ACTION_TYPES\.PLAY_CC_DOUBLE,[\s\S]{0,400}?actionCost: 2 \}/,
      'PLAY_CC_DOUBLE offering must carry actionCost: 2 — CRR-CC-007');
  });

  it('007d: source — dc-play-area Special Action path decrements remaining by 1', () => {
    assert.match(DCPA_SRC,
      /if \(timingLabel === 'Special Action'\) \{\s*\n\s*const data = game\.dcActionsData\?\.\[msgId\];\s*\n\s*if \(data && typeof data\.remaining === 'number'\) data\.remaining = Math\.max\(0, data\.remaining - 1\);/,
      'Special Action CC must decrement remaining by 1 — CRR-CC-007');
  });

  it('007e: source — dc-play-area Double Action path zeroes remaining (spends both actions)', () => {
    assert.match(DCPA_SRC,
      /\} else if \(timingLabel === 'Double Action'\) \{\s*\n\s*const data = game\.dcActionsData\?\.\[msgId\];\s*\n\s*if \(data && typeof data\.remaining === 'number'\) data\.remaining = 0;/,
      'Double Action CC must zero remaining (costs both actions) — CRR-CC-007');
  });
});
