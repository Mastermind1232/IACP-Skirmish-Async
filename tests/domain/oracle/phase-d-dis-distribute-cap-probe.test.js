/**
 * Phase-D probe: distributing identical elements (e.g. HP across figures
 * in a DC group) never hands out more than the designated total.
 *
 * PROBE-PD-DIS-001: CRR DISTRIBUTE — "When distributing a number of
 *   identical elements amongst figures, the total given out must be ≤
 *   the designated amount; each recipient may receive zero up to the
 *   full amount."
 *
 * Implementation: in `src/game/damage-helpers.js`, `healHpDistributed`
 *   is the skirmish distribute-healing helper. It initializes
 *   `remaining = totalAmount` and per figure caps `heal = Math.min(
 *   remaining, damage)`, decrementing `remaining -= heal` each time;
 *   the loop short-circuits on `remaining <= 0`. The return shape is
 *   `{ totalRecovered: totalAmount - remaining, perFigure }`. Because
 *   `remaining` is monotonically non-increasing and is initialized to
 *   `totalAmount`, the invariant `totalRecovered ≤ totalAmount` holds
 *   by construction. A single recipient may receive zero (damage=0
 *   skips) through to the full amount.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { healHpDistributed } from '../../../src/game/damage-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DH_SRC = readFileSync(resolve(ROOT, 'src/game/damage-helpers.js'), 'utf8');

describe('PROBE-PD-DIS-001: distributed totals never exceed the designated amount', () => {
  it('001a: source — healHpDistributed initializes remaining=totalAmount and caps per-heal', () => {
    assert.match(DH_SRC,
      /export function healHpDistributed\(dcHealthState, game, msgId, totalAmount, playerNum\) \{[\s\S]*?let remaining = totalAmount;[\s\S]*?const heal = Math\.min\(remaining, damage\);[\s\S]*?remaining -= heal;/,
      'per-iteration heal must be Math.min(remaining, damage) with remaining decremented — CRR-DIS-001');
  });

  it('001b: source — loop short-circuits on remaining <= 0', () => {
    assert.match(DH_SRC,
      /if \(remaining <= 0\) break;/,
      'distribution must stop once the designated total is exhausted — CRR-DIS-001');
  });

  it('001c: source — totalRecovered is computed as totalAmount - remaining', () => {
    assert.match(DH_SRC,
      /totalRecovered: totalAmount - remaining/,
      'totalRecovered must be totalAmount minus the residue, bounded above by totalAmount — CRR-DIS-001');
  });

  it('001d: behavior — distribute 5 across a DC with only 3 total damage → totalRecovered=3 (≤ total)', () => {
    const dcHealthState = new Map();
    // 3 figures with [currentHp, maxHp] — total damage 3 (1+2+0)
    dcHealthState.set('m1', [[3, 4], [2, 4], [4, 4]]);
    const game = { player1DcList: [[{ msgId: 'm1' }]], player2DcList: [] };
    const result = healHpDistributed(dcHealthState, game, 'm1', 5, 1);
    assert.ok(result.totalRecovered <= 5,
      `totalRecovered (${result.totalRecovered}) must be ≤ designated 5 — CRR-DIS-001`);
    assert.equal(result.totalRecovered, 3,
      'with only 3 damage across the group, only 3 can be healed — CRR-DIS-001');
  });

  it('001e: behavior — distribute 5 across a DC with 10 total damage → totalRecovered=5 (exact cap)', () => {
    const dcHealthState = new Map();
    dcHealthState.set('m1', [[0, 5], [0, 5]]);
    const game = { player1DcList: [[{ msgId: 'm1' }]], player2DcList: [] };
    const result = healHpDistributed(dcHealthState, game, 'm1', 5, 1);
    assert.ok(result.totalRecovered <= 5,
      `totalRecovered (${result.totalRecovered}) must be ≤ designated 5 — CRR-DIS-001`);
    assert.equal(result.totalRecovered, 5,
      'when damage exceeds total, recover exactly the designated total — CRR-DIS-001');
  });

  it('001f: behavior — individual figure can receive zero (undamaged skipped, others healed)', () => {
    const dcHealthState = new Map();
    // Fig 0 undamaged, Fig 1 damaged by 2 → distribute 2 → Fig 0 gets 0, Fig 1 gets 2
    dcHealthState.set('m1', [[5, 5], [3, 5]]);
    const game = { player1DcList: [[{ msgId: 'm1' }]], player2DcList: [] };
    const result = healHpDistributed(dcHealthState, game, 'm1', 2, 1);
    assert.equal(result.totalRecovered, 2, 'designated total handed out — CRR-DIS-001');
    const perFig0 = result.perFigure.find((p) => p.index === 0);
    assert.equal(perFig0, undefined, 'undamaged recipient receives zero (no entry) — CRR-DIS-001');
    const perFig1 = result.perFigure.find((p) => p.index === 1);
    assert.equal(perFig1?.healed, 2, 'damaged recipient receives the full designated amount — CRR-DIS-001');
  });
});
