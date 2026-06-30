/**
 * Tough Luck — end-of-rerolls picker (alexanbv 2026-06-30 redesign).
 *
 * NEW BEHAVIOR: Tough Luck is no longer a per-reroll gate. Instead, at the end
 * of the rerolls window, each player gets a one-time chance to cancel any one
 * rerolled opponent die:
 *   • Defender: cancels any rerolled attack die.
 *   • Attacker: cancels any rerolled defense die.
 *
 * This exercises handleToughLuckFinalPick (tl_final_remove_ / tl_final_skip_).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleToughLuckFinalPick } from '../../../src/handlers/combat.js';

const thread = { send: async () => ({}) };

function recalcAttackTotals(dice) {
  return dice.reduce((t, d) => ({ acc: t.acc + (d.acc || 0), dmg: t.dmg + (d.dmg || 0), surge: t.surge + (d.surge || 0) }), { acc: 0, dmg: 0, surge: 0 });
}
function recalcDefenseTotals(dice) {
  return dice.reduce((t, d) => ({ block: t.block + (d.block || 0), evade: t.evade + (d.evade || 0), dodge: t.dodge || d.dodge }), { block: 0, evade: 0, dodge: false });
}

function makeCtx(game) {
  return {
    getGame: () => game,
    saveGames: () => {},
    replyIfGameEnded: async () => false,
    recalcAttackTotals,
    recalcDefenseTotals,
  };
}

function makeInteraction(customId, userId) {
  return {
    customId,
    user: { id: userId },
    client: {},
    message: { edit: async () => ({}) },
    deferUpdate: async () => ({}),
    followUp: async () => ({}),
  };
}

describe('handleToughLuckFinalPick — remove path', () => {
  function freshGame() {
    return {
      gameId: 'g-tlf',
      player1Id: 'A',
      player2Id: 'D',
      player2CcHand: ['Tough Luck'],
      player2CcDiscard: [],
      pendingCombat: {
        gameId: 'g-tlf',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: undefined,
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
        _rerolledDice: [{ pool: 'attack', index: 0 }],
        _pendingToughLuckFinal: { phase: 'defender', playerNum: 2 },
        _tlFinalDefenderOffered: true,
      },
    };
  }

  it('removes the selected die result, discards Tough Luck from hand, clears pending', async () => {
    const game = freshGame();
    const combat = game.pendingCombat;
    const ctx = makeCtx(game);
    // Simulate playCC by pre-injecting the poc stub:
    // playCC checks hand for the card — Tough Luck IS in hand, so it proceeds.
    // The poc would open a counter window — in tests without a Discord client,
    // promptOpponentCancel is called but openCcCounterWindow skips (no responder).
    // We verify the downstream effect (die zeroed, card consumed).
    await handleToughLuckFinalPick(makeInteraction('tl_final_remove_g-tlf_attack_0', 'D'), ctx);
    // Die result zeroed.
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 0, dmg: 0, surge: 0 });
    // Card consumed from hand → discard.
    assert.deepEqual(game.player2CcHand, [], 'Tough Luck left the hand');
    assert.deepEqual(game.player2CcDiscard, ['Tough Luck'], 'Tough Luck went to discard');
    // Pending state cleared.
    assert.equal(combat._pendingToughLuckFinal, undefined, 'pending state cleared');
  });

  it('a second remove on the same die (already zeroed) still clears pending', async () => {
    const game = freshGame();
    // Pre-zero the die so the effect is idempotent.
    game.pendingCombat.attackDiceResults[0] = { color: 'red', acc: 0, dmg: 0, surge: 0 };
    await handleToughLuckFinalPick(makeInteraction('tl_final_remove_g-tlf_attack_0', 'D'), makeCtx(game));
    assert.equal(game.pendingCombat._pendingToughLuckFinal, undefined);
  });
});

describe('handleToughLuckFinalPick — skip path', () => {
  function freshGame() {
    return {
      gameId: 'g-tlf-sk',
      player1Id: 'A',
      player2Id: 'D',
      player2CcHand: ['Tough Luck'],
      player2CcDiscard: [],
      pendingCombat: {
        gameId: 'g-tlf-sk',
        attackerPlayerNum: 1,
        defenderPlayerNum: 2,
        combatThreadId: undefined,
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
        _rerolledDice: [{ pool: 'attack', index: 0 }],
        _pendingToughLuckFinal: { phase: 'defender', playerNum: 2 },
        _tlFinalDefenderOffered: true,
      },
    };
  }

  it('skip leaves die intact and card in hand', async () => {
    const game = freshGame();
    const combat = game.pendingCombat;
    await handleToughLuckFinalPick(makeInteraction('tl_final_skip_g-tlf-sk', 'D'), makeCtx(game));
    // Die untouched.
    assert.deepEqual(combat.attackDiceResults[0], { color: 'red', acc: 1, dmg: 2, surge: 1 });
    // Card still in hand.
    assert.deepEqual(game.player2CcHand, ['Tough Luck'], 'card not consumed on skip');
    assert.deepEqual(game.player2CcDiscard, []);
    // Pending cleared.
    assert.equal(combat._pendingToughLuckFinal, undefined);
  });
});

describe('handleToughLuckFinalPick — wrong player guard', () => {
  it('rejects if wrong player clicks the button', async () => {
    const game = {
      gameId: 'g-tlf-guard',
      player1Id: 'A', player2Id: 'D',
      player2CcHand: ['Tough Luck'], player2CcDiscard: [],
      pendingCombat: {
        gameId: 'g-tlf-guard',
        attackerPlayerNum: 1, defenderPlayerNum: 2,
        combatThreadId: undefined,
        attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 1 }],
        defenseDiceResults: [],
        _rerolledDice: [{ pool: 'attack', index: 0 }],
        _pendingToughLuckFinal: { phase: 'defender', playerNum: 2 },
        _tlFinalDefenderOffered: true,
      },
    };
    const errors = [];
    const interaction = { ...makeInteraction('tl_final_remove_g-tlf-guard_attack_0', 'WRONG'),
      followUp: async (m) => { errors.push(m.content); return {}; } };
    await handleToughLuckFinalPick(interaction, makeCtx(game));
    assert.ok(errors.length > 0 || game.pendingCombat._pendingToughLuckFinal !== undefined,
      'wrong player rejected — pending state intact or error sent');
  });
});
