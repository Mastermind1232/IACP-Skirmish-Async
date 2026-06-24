/**
 * Phase-D probes: VP payment between players (symmetric transfer).
 *
 * PROBE-PD-PAY-001: In a Skirmish, when an ability instructs a player to
 *   pay another player VPs, the paying player loses VPs and the paid
 *   player gains an equal number of VPs. (CRR PAY VPS)
 * PROBE-PD-VPS-003: (same rule, cross-referenced under VP).
 *
 * Implementation: every "pay N VP" operation in the engine is a pair
 *   `deductVp(game, payerPN, N)` + `awardObjectiveVp(game, recipientPN, N)`
 *   (see src/handlers/combat.js:4094-4095 for Hondo Negotiate). The
 *   primitives live in src/game/vp-helpers.js and are symmetric:
 *   deductVp subtracts exactly N from payer, awardObjectiveVp adds
 *   exactly N to recipient.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deductVp, awardObjectiveVp } from '../../../src/game/vp-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMBAT_SRC = readFileSync(resolve(__dirname, '../../../src/handlers/combat.js'), 'utf8');

function makeGame() {
  return {
    player1VP: { total: 10, kills: 4, objectives: 6 },
    player2VP: { total: 7, kills: 2, objectives: 5 },
  };
}

describe('PROBE-PD-PAY-001 / PROBE-PD-VPS-003: VP payment is symmetric (lose = gain)', () => {
  it('001a: behavior — deductVp(N) + awardObjectiveVp(N) preserves total VP across both players', () => {
    const game = makeGame();
    const before = game.player1VP.total + game.player2VP.total;
    // P1 pays 3 VP to P2 (pattern: deduct from payer, award to recipient).
    deductVp(game, 1, 3);
    awardObjectiveVp(game, 2, 3);
    const after = game.player1VP.total + game.player2VP.total;
    assert.equal(after, before,
      `symmetric transfer must preserve total VP; before=${before} after=${after} — CRR-PAY-001`);
    assert.equal(game.player1VP.total, 10 - 3,
      'payer loses exactly N VP — CRR-PAY-001');
    assert.equal(game.player2VP.total, 7 + 3,
      'recipient gains exactly N VP — CRR-PAY-001');
  });

  it('001b: behavior — payment amount is the same number on both sides (no asymmetry)', () => {
    const game = makeGame();
    const p1Before = game.player1VP.total;
    const p2Before = game.player2VP.total;
    deductVp(game, 1, 5);
    awardObjectiveVp(game, 2, 5);
    const delta1 = p1Before - game.player1VP.total;
    const delta2 = game.player2VP.total - p2Before;
    assert.equal(delta1, delta2,
      `payer loss must equal recipient gain; loss=${delta1} gain=${delta2} — CRR-VPS-003`);
  });

  it('001d: recipient gain goes to objectives (not kills); paid VP is objective VP', () => {
    const game = makeGame();
    const objBefore = game.player2VP.objectives;
    const killsBefore = game.player2VP.kills;
    awardObjectiveVp(game, 2, 4);
    assert.equal(game.player2VP.objectives, objBefore + 4,
      'recipient objectives must increase by payment amount — CRR-PAY-001');
    assert.equal(game.player2VP.kills, killsBefore,
      'recipient kills must be unchanged by VP payment — CRR-PAY-001');
  });
});
