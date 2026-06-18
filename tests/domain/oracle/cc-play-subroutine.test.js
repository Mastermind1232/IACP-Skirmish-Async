/**
 * Validation of the unified CC-play subroutine (alexanbv 2026-06-14). The old
 * onCcPlayed (inline Negation / Comm-Disruption window) was deleted 2026-06-17 —
 * every CC play now routes through the unified recursive counter-window, covered
 * by cc-counter-window*.test.js. What remains here is runCcPlayTriggers, the
 * on-CC-play trigger fan-out (Kallus Hunt Dissent / Blaise Adapt) that both the
 * hand and combat play paths call; this is the path that fixed the
 * cost-0-CC-skipped-triggers bug.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCcPlayTriggers } from '../../../src/handlers/cc-hand.js';

const ch = { send: async () => ({ id: 'm' }) };
function game() {
  return {
    gameId: '42', player1Id: 'P1', player2Id: 'P2', p1HandId: 'h1', p2HandId: 'h2',
    p1DcList: [], p2DcList: [], figurePositions: { 1: {}, 2: {} },
    huntDissentResolvedThisRound: {}, adaptBlaiseResolvedThisRound: {},
  };
}
const interaction = { client: { channels: { fetch: async () => ch } } };

describe('CC-play subroutine: runCcPlayTriggers', () => {
  it('runs cleanly on a minimal game (no Kallus/Blaise present → no-op, no throw)', async () => {
    await assert.doesNotReject(() => runCcPlayTriggers(game(), 1, { client: interaction.client, logGameAction: async () => {}, dcMessageMeta: new Map(), saveGames: () => {} }));
  });
});
