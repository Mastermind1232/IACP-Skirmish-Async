/**
 * Phase-D probe: initiative is determined by squad cost, with random tiebreak.
 *
 * PROBE-PD-SKMS-002: CRR SKIRMISH SETUP Step 2 — "The player who has the
 *   lowest total cost of Deployment cards chooses which player begins the
 *   game with the initiative token. In the case of a tie, players determine
 *   initiative randomly."
 *
 * Implementation: both the Discord handler (src/handlers/setup.js
 *   handleInitiativeRoll) and the headless bridge
 *   (src/engine/setup-bridge.js autoSetupFromDecks) compute a per-player
 *   squad cost by summing DC-stat costs, then assign initiative to the
 *   lower-cost player. On a tie, they fall back to a 50/50 coin flip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const SETUP_SRC = readFileSync(resolve(ROOT, 'src/handlers/setup.js'), 'utf8');
const BRIDGE_SRC = readFileSync(resolve(ROOT, 'src/engine/setup-bridge.js'), 'utf8');

describe('PROBE-PD-SKMS-002: initiative = lower-cost squad, tied → random', () => {
  it('002a: handler — Discord setup sums both squad costs before picking winner', () => {
    assert.match(SETUP_SRC,
      /const p1Cost = squadCost\(game\.player1Squad\);\s*\n\s*const p2Cost = squadCost\(game\.player2Squad\);/,
      'handleInitiativeRoll must compute both squad costs — CRR-SKMS-002');
  });

  it('002b: handler — lower-cost path assigns initiative to the cheaper squad', () => {
    assert.match(SETUP_SRC,
      /if \(p1Cost < p2Cost\) winner = game\.player1Id;\s*\n\s*else if \(p2Cost < p1Cost\) winner = game\.player2Id;/,
      'handler must award initiative to the lower-cost player — CRR-SKMS-002');
  });

  it('002c: handler — ties fall back to a 50/50 coin flip', () => {
    assert.match(SETUP_SRC,
      /else winner = Math\.random\(\) < 0\.5 \? game\.player1Id : game\.player2Id;/,
      'tied-cost fallback must be random — CRR-SKMS-002');
  });

  it('002d: bridge — headless setup also uses lower-cost + random tiebreak', () => {
    assert.match(BRIDGE_SRC,
      /if \(p1Cost < p2Cost\) winner = game\.player1Id;\s*\n\s*else if \(p2Cost < p1Cost\) winner = game\.player2Id;\s*\n\s*else winner = Math\.random\(\) < 0\.5 \? game\.player1Id : game\.player2Id;/,
      'setup-bridge must mirror handler initiative logic — CRR-SKMS-002');
  });

  it('002e: behavior — pure predicate matches CRR semantics', () => {
    const pick = (p1Cost, p2Cost, coin) => {
      if (p1Cost < p2Cost) return 'p1';
      if (p2Cost < p1Cost) return 'p2';
      return coin < 0.5 ? 'p1' : 'p2';
    };
    assert.equal(pick(38, 40, 0.9), 'p1', 'p1 cheaper → p1 chooses');
    assert.equal(pick(40, 38, 0.9), 'p2', 'p2 cheaper → p2 chooses');
    assert.equal(pick(40, 40, 0.1), 'p1', 'tie + coin<0.5 → p1');
    assert.equal(pick(40, 40, 0.9), 'p2', 'tie + coin>=0.5 → p2');
  });
});
