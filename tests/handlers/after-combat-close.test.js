// Regression for the "pendingCombat lingers after every combat" bug (alexanbv
// 2026-06-26). On the LIVE path, the after-resolve "Done" click (handleAarDone,
// 'postCombat' ctx group) has NO afterAttackClose closure — that closure only
// survives the self-play/inline drain. So finishCombatResolution →
// resolvePendingCombat never ran, pendingCombat lingered, and End Activation was
// blocked by "combat in progress" every combat. handleAarDone's defender-done
// path must rebuild the close from ctx.checkPostCombatSurges/finishCombatResolution.
//
// These tests drive the LIVE path (a postCombat-style ctx, NO afterAttackClose) —
// the exact path the headless self-play tests can't reach (they keep the closure).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleAarDone } from '../../src/handlers/after-attack-resolve.js';
import { resolvePendingCombat } from '../../src/game/combat-stack.js';

function makeGame() {
  return {
    gameId: 'g1', isTestGame: true, player1Id: 'P1', player2Id: 'P2',
    pendingCombat: {
      gameId: 'g1', combatThreadId: 't1', attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackerFigureKey: 'A-1-0', target: { figureKey: 'D-2-0' },
      _aarCloseArgs: { resultText: '2 Damage', embedRefreshMsgIds: [], ownerId: 'P2', defenderPlayerNum: 2 },
    },
  };
}
function makeInteraction() {
  return {
    customId: 'aar_done_def_g1',
    user: { id: 'P2' },
    deferUpdate: async () => {},
    followUp: async () => {},
    message: { components: [], edit: async () => {} },
  };
}
function makeThread() { return { send: async () => ({ id: 'm1' }) }; }

describe('after-combat close — pendingCombat is cleared on the LIVE Done click', () => {
  it('rebuilds the close from ctx deps when afterAttackClose is absent (postCombat ctx) → pendingCombat null', async () => {
    const game = makeGame();
    let finishCalled = false;
    let surgesChecked = false;
    const ctx = {
      getGame: () => game,
      saveGames: () => {},
      client: { channels: { fetch: async () => makeThread() } },
      // NO afterAttackClose — exactly like the live 'postCombat' ctx group.
      checkPostCombatSurges: async () => { surgesChecked = true; return false; },
      finishCombatResolution: async (g) => { finishCalled = true; resolvePendingCombat(g); },
    };
    await handleAarDone(makeInteraction(), ctx);
    assert.equal(surgesChecked, true, 'must check post-combat surges before finishing');
    assert.equal(finishCalled, true, 'must call finishCombatResolution on the live Done click');
    assert.equal(game.pendingCombat, null, 'pendingCombat MUST be cleared — no more lingering / forced clear-stale');
  });

  it('does NOT finish when a post-combat reaction is pending (checkPostCombatSurges → true)', async () => {
    const game = makeGame();
    let finishCalled = false;
    const ctx = {
      getGame: () => game,
      saveGames: () => {},
      client: { channels: { fetch: async () => makeThread() } },
      checkPostCombatSurges: async () => true, // a reaction prompt was posted; its handler finishes later
      finishCombatResolution: async (g) => { finishCalled = true; resolvePendingCombat(g); },
    };
    await handleAarDone(makeInteraction(), ctx);
    assert.equal(finishCalled, false, 'a pending post-combat reaction defers finish to its own handler');
    assert.ok(game.pendingCombat, 'pendingCombat stays set while a reaction is genuinely pending');
  });

  it('prefers the afterAttackClose closure when present (self-play / inline path)', async () => {
    const game = makeGame();
    let closureUsed = false;
    let fallbackFinishCalled = false;
    const ctx = {
      getGame: () => game,
      saveGames: () => {},
      client: { channels: { fetch: async () => makeThread() } },
      afterAttackClose: async (_t, g) => { closureUsed = true; resolvePendingCombat(g); },
      checkPostCombatSurges: async () => false,
      finishCombatResolution: async () => { fallbackFinishCalled = true; },
    };
    await handleAarDone(makeInteraction(), ctx);
    assert.equal(closureUsed, true, 'closure path used when available');
    assert.equal(fallbackFinishCalled, false, 'fallback not used when the closure is present');
    assert.equal(game.pendingCombat, null, 'pendingCombat cleared via the closure');
  });
});
