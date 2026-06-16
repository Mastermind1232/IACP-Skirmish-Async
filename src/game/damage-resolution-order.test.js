// Damage-pipeline reaction resolution order (alexanbv 2026-06-16): who resolves
// their "when damaged" / "would be defeated" / "when defeated" abilities first.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { damageResolutionPlayerOrder } from './damage-pipeline.js';

describe('damageResolutionPlayerOrder', () => {
  const g = { player1Id: 'A', player2Id: 'B', initiativePlayerId: 'B' }; // P2 has initiative

  it('inside an attack → attacker first, then defender (initiative ignored)', () => {
    assert.deepEqual(damageResolutionPlayerOrder(g, { combat: { attackerPlayerNum: 1 } }), [1, 2]);
    assert.deepEqual(damageResolutionPlayerOrder(g, { fromAttack: true, attackerPlayerNum: 2 }), [2, 1]);
  });

  it('NOT inside an attack → initiative player first, then the other', () => {
    assert.deepEqual(damageResolutionPlayerOrder(g, {}), [2, 1]); // P2 has initiative
    assert.deepEqual(damageResolutionPlayerOrder({ player1Id: 'A', player2Id: 'B', initiativePlayerId: 'A' }, {}), [1, 2]);
  });
});
