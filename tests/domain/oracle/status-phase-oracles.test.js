/**
 * Oracle tests for Status Phase ordering (Wave 6).
 *
 * Rule: STATUS PHASE IN A SKIRMISH (RULES_REFERENCE.md L2714-2718):
 *   Step 1: Ready all exhausted Deployment cards and Skirmish Upgrade cards.
 *   Step 2: Each player draws 1 Command card + 1 per terminal controlled.
 *   Step 3: Resolve all "end of each round" abilities.
 *   Step 4: The player with initiative passes the initiative token.
 *
 * Confirmed-safe core:
 *   - CC draw (Step 2) happens BEFORE EoR abilities (Step 3)
 *   - Black Market (Step 3) peeks at deck AFTER draw
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { runStatusPhaseAfterEndOfRound } from '../../../src/handlers/round.js';

// ── ORACLE-SP-001: Black Market Reveals Post-Draw Deck Top Card ─────────

describe('ORACLE-SP-001: Black Market Reveals Post-Draw Deck Top Card', () => {
  it('001: Black Market reveals post-draw deck top card (Step 2 before Step 3)', async () => {
    const { game, deps } = createTestGame()
      .withPlayer1Army([{ dcName: 'Greedo' }, { dcName: '[Black Market]' }])
      .withPlayer2Army([{ dcName: 'Elite Stormtrooper' }])
      .inRound(1)
      .build();

    // Set round phase to end_of_round (runStatusPhaseAfterEndOfRound expects this)
    game.roundPhase = 'end_of_round';

    // Override CC state after build to get deterministic deck ordering
    // (builder auto-draws 3 when inRound(1), so set directly)
    game.player1CcDeck = ['Adrenaline', 'Advance Warning', 'Against the Odds'];
    game.player1CcHand = [];
    game.player2CcDeck = ['Negation', 'Urgency', 'Deathblow'];
    game.player2CcHand = [];

    // Run the full status phase
    await runStatusPhaseAfterEndOfRound(game, deps);

    // Step 2 draws 1 card (0 terminals = base draw of 1).
    // 'Adrenaline' is drawn off the top → deck becomes ['Advance Warning', 'Against the Odds'].
    // (Hand is cleared by cleanupRoundStart at end of status phase, so check deck instead)
    assert.deepStrictEqual(
      game.player1CcDeck,
      ['Advance Warning', 'Against the Odds'],
      'P1 deck should have 2 cards remaining after draw'
    );

    // Step 3: Black Market peeks at deck top AFTER draw.
    // pendingBlackMarket is cleared by cleanupRoundStart at end of status phase,
    // so we verify via the action log that Black Market revealed 'Advance Warning'
    // (post-draw top), NOT 'Adrenaline' (pre-draw top).
    const bmLog = deps._actionLog.find(e => e.msg?.includes('[Black Market]'));
    assert.ok(bmLog, 'Black Market action log entry should exist');
    assert.ok(
      bmLog.msg.includes('Advance Warning'),
      `Black Market should reveal post-draw deck top 'Advance Warning', not pre-draw 'Adrenaline'. Log: ${bmLog.msg}`
    );
    assert.ok(
      !bmLog.msg.includes('Adrenaline'),
      `Black Market should NOT reveal pre-draw deck top 'Adrenaline'. Log: ${bmLog.msg}`
    );
  });
});
