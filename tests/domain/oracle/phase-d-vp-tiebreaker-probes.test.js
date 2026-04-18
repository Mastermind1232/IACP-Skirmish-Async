/**
 * Phase-D probes: VP-tiebreaker invariants.
 *
 * PROBE-PD-TIE-001: If both players have the same VP total at game end,
 *   the player with more kill VPs wins. (CRR TIE)
 * PROBE-PD-TIE-002: If kill VPs are also tied, the player with the lowest
 *   sum of damage tokens on remaining figures + Health of defeated DCs
 *   (≡ totalDamageReceived) wins. (CRR TIE)
 * PROBE-PD-TIE-003: If still tied after damage, each player rolls one blue
 *   die; highest Accuracy wins (resolveVpTiebreaker eventually returns
 *   a winner). (CRR TIE)
 *
 * Implementation: src/engine/win-conditions.js `resolveVpTiebreaker`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVpTiebreaker } from '../../../src/engine/win-conditions.js';

function makeGame({ kills1, kills2, dmg1 = 0, dmg2 = 0 }) {
  return {
    gameId: 'tie-probe',
    player1Id: 'P1',
    player2Id: 'P2',
    player1VP: { total: 40, kills: kills1, objectives: 40 - kills1 },
    player2VP: { total: 40, kills: kills2, objectives: 40 - kills2 },
    totalDamageReceived: { 1: dmg1, 2: dmg2 },
  };
}

function makeDeps() {
  return {
    logGameAction: async () => {},
    getDiceData: () => ({
      attack: { blue: [
        { acc: 1 }, { acc: 2 }, { acc: 3 }, { acc: 4 }, { acc: 5 }, { acc: 6 },
      ]},
      defense: { black: [], white: [] },
    }),
  };
}

describe('PROBE-PD-TIE-001: higher kill VP wins when VP total is tied', () => {
  it('001a: P1 has more kill VP → P1 wins', async () => {
    const game = makeGame({ kills1: 25, kills2: 20 });
    const result = await resolveVpTiebreaker(game, null, 40, makeDeps());
    assert.equal(result.winnerId, 'P1',
      'higher kill VP wins tiebreaker 1 — CRR-TIE-001');
    assert.match(result.reason, /kill VP/,
      'winner reason must cite kill VP — CRR-TIE-001');
  });

  it('001b: P2 has more kill VP → P2 wins', async () => {
    const game = makeGame({ kills1: 15, kills2: 22 });
    const result = await resolveVpTiebreaker(game, null, 40, makeDeps());
    assert.equal(result.winnerId, 'P2', 'higher kill VP wins — CRR-TIE-001');
  });
});

describe('PROBE-PD-TIE-002: lower damage received wins when kill VP is also tied', () => {
  it('002a: kills tied, P1 has less damage → P1 wins', async () => {
    const game = makeGame({ kills1: 20, kills2: 20, dmg1: 10, dmg2: 15 });
    const result = await resolveVpTiebreaker(game, null, 40, makeDeps());
    assert.equal(result.winnerId, 'P1',
      'lower damage received wins tiebreaker 2 — CRR-TIE-002');
    assert.match(result.reason, /damage/,
      'winner reason must cite damage — CRR-TIE-002');
  });

  it('002b: kills tied, P2 has less damage → P2 wins', async () => {
    const game = makeGame({ kills1: 20, kills2: 20, dmg1: 18, dmg2: 7 });
    const result = await resolveVpTiebreaker(game, null, 40, makeDeps());
    assert.equal(result.winnerId, 'P2', 'lower damage received wins — CRR-TIE-002');
  });
});

describe('PROBE-PD-TIE-003: blue-die roll resolves when kills + damage both tied', () => {
  it('003: kills + damage tied → blue-die roll eventually picks a winner', async () => {
    const game = makeGame({ kills1: 20, kills2: 20, dmg1: 10, dmg2: 10 });
    const result = await resolveVpTiebreaker(game, null, 40, makeDeps());
    assert.ok(result.winnerId, 'tiebreaker 3 must eventually pick a winner — CRR-TIE-003');
    assert.match(result.reason, /blue die|random/,
      'winner reason must cite blue die or random resolution — CRR-TIE-003');
  });
});
