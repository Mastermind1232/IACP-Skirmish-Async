/**
 * Validation of the unified CC-play subroutine (alexanbv 2026-06-14). This is
 * DEPLOYED (not flag-gated) code — handleCcPlay calls onCcPlayed on every play —
 * so validating it matters for live games. Covers:
 *  - runCcPlayTriggers runs cleanly on a minimal game (no Kallus/Blaise → no-op);
 *    this is the path that fixed the cost-0-CC-skipped-triggers bug.
 *  - onCcPlayed cost 0 → opens the Negation counter-window (pendingNegation set).
 *  - onCcPlayed cost > 0 → no Negation window (Comm Disruption only, gated).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onCcPlayed, runCcPlayTriggers } from '../../../src/handlers/cc-hand.js';

const ch = { send: async () => ({ id: 'm' }) };
function game() {
  return {
    gameId: '42', player1Id: 'P1', player2Id: 'P2', p1HandId: 'h1', p2HandId: 'h2',
    p1DcList: [], p2DcList: [], figurePositions: { 1: {}, 2: {} },
    huntDissentResolvedThisRound: {}, adaptBlaiseResolvedThisRound: {},
  };
}
function ctx(extra = {}) {
  return {
    logGameAction: async () => ({ id: 'log' }),
    saveGames: () => {},
    dcMessageMeta: new Map(),
    client: { channels: { fetch: async () => ch } },
    getNegationResponseButtons: () => ({ type: 1, components: [] }),
    ...extra,
  };
}
const interaction = { client: { channels: { fetch: async () => ch } } };

describe('CC-play subroutine: runCcPlayTriggers', () => {
  it('runs cleanly on a minimal game (no Kallus/Blaise present → no-op, no throw)', async () => {
    await assert.doesNotReject(() => runCcPlayTriggers(game(), 1, { client: interaction.client, logGameAction: async () => {}, dcMessageMeta: new Map(), saveGames: () => {} }));
  });
});

describe('CC-play subroutine: onCcPlayed counter-window', () => {
  it('cost 0 opens the Negation window (pendingNegation set for the played card)', async () => {
    const g = game();
    await onCcPlayed(g, '42', 1, 'Some Free CC', 0, interaction, ctx(), { handChannel: ch });
    assert.ok(g.pendingNegation, 'Negation window opened');
    assert.equal(g.pendingNegation.card, 'Some Free CC');
    assert.equal(g.pendingNegation.playedBy, 1);
  });

  it('cost > 0 does NOT open a Negation window', async () => {
    const g = game();
    await onCcPlayed(g, '42', 1, 'Costly CC', 2, interaction, ctx(), { handChannel: ch });
    assert.equal(g.pendingNegation, undefined, 'no Negation for cost>0');
  });
});
