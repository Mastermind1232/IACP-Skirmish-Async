// Defense-pool die-turn recompute (alexanbv 2026-06-16), incl. Yoda's Dodge→2B+1E.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDefenseDieTurn } from './defense-die-turn.js';

describe('applyDefenseDieTurn', () => {
  it('Yoda: turning a die to a Dodge face converts it to 2 Blocks + 1 Evade (not a dodge)', () => {
    const c = { defenseDiceResults: [{ block: 1, evade: 0, dodge: false }, { block: 0, evade: 1, dodge: false }] };
    applyDefenseDieTurn(c, 0, { block: 0, evade: 0, dodge: true }, true);
    assert.deepEqual(c.defenseRoll, { block: 2, evade: 2, dodge: false }); // 2B from convert, 1E from convert + 1E die#1
  });
  it('without conversion, a Dodge face yields a real dodge', () => {
    const c = { defenseDiceResults: [{ block: 1, evade: 0, dodge: false }, { block: 0, evade: 1, dodge: false }] };
    applyDefenseDieTurn(c, 0, { block: 0, evade: 0, dodge: true }, false);
    assert.equal(c.defenseRoll.dodge, true);
  });
  it('turning to a block/evade face recomputes totals across all dice', () => {
    const c = { defenseDiceResults: [{ block: 0, evade: 0, dodge: false }, { block: 1, evade: 0, dodge: false }] };
    applyDefenseDieTurn(c, 0, { block: 1, evade: 1, dodge: false }, true);
    assert.deepEqual(c.defenseRoll, { block: 2, evade: 1, dodge: false });
  });
  it('another die keeping its dodge stays a dodge even with Yoda converting a different die', () => {
    const c = { defenseDiceResults: [{ block: 0, evade: 0, dodge: false }, { block: 0, evade: 0, dodge: true }] };
    applyDefenseDieTurn(c, 0, { block: 0, evade: 0, dodge: true }, true); // convert die0
    assert.equal(c.defenseRoll.dodge, true); // die1 still a dodge
    assert.equal(c.defenseRoll.block, 2);    // from die0 conversion
  });
});
