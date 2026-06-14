/**
 * Devaron Garrison B "Crate Rush" EoR resume (alexanbv 2026-06-13).
 *
 * Regression guard for the soft-lock bug: after the door step, each player
 * who controls crates gets a "Done pushing crates" button. The round must
 * only resume (open the player EoR window) once EVERY such player has pressed
 * Done — previously there was no Done button and the chain dead-ended, so the
 * end of round never advanced.
 *
 * D-CRATE-001: first player's Done does NOT resume (still waiting on the other)
 * D-CRATE-002: last player's Done resumes → player EoR window opens, resume
 *              state cleared.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDevaronCrateDone } from '../../../src/handlers/map-events.js';

function makeGame() {
  return {
    gameId: '42',
    player1Id: 'P1', player2Id: 'P2',
    initiativePlayerId: 'P1',
    pendingCratePush: [1, 2],
    _devaronResumeLogVars: { p1Terminals: 0, p2Terminals: 0 },
    p1DcList: [], p2DcList: [],
    p1DcMessageIds: [], p2DcMessageIds: [],
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
  };
}

function makeCtx(game) {
  return {
    getGame: () => game,
    saveGames: () => {},
    client: {},
    logGameAction: async () => {},
    canActAsPlayer: () => true,
    updateHandChannelMessages: async () => {},
    getInitiativePlayerZoneLabel: () => '',
    dcMessageMeta: new Map(),
    dcHealthState: new Map(),
    isDepletedRemovedFromGame: () => false,
    isFigureInDeploymentZone: () => false,
    checkWinConditions: async () => {},
  };
}

function fakeInteraction(pn, userId) {
  return {
    customId: `devaron_crate_done_42_${pn}`,
    user: { id: userId },
    deferUpdate: async () => {},
    message: { edit: async () => {} },
    followUp: async () => {},
  };
}

describe('Devaron Crate Rush EoR resume', () => {
  it('D-CRATE-001: first player Done does not resume the round (waits for the other)', async () => {
    const game = makeGame();
    const ctx = makeCtx(game);
    await handleDevaronCrateDone(fakeInteraction(1, 'P1'), ctx);
    assert.deepEqual(game.pendingCratePush, [2], 'player 1 removed, player 2 still pending');
    assert.equal(game.endOfRoundWhoseTurn, undefined, 'EoR window must NOT open yet');
    assert.ok(game._devaronResumeLogVars, 'resume state retained until crate rush is done');
  });

  it('D-CRATE-002: last player Done resumes → player EoR window opens', async () => {
    const game = makeGame();
    const ctx = makeCtx(game);
    await handleDevaronCrateDone(fakeInteraction(1, 'P1'), ctx);
    await handleDevaronCrateDone(fakeInteraction(2, 'P2'), ctx);
    assert.equal(game.pendingCratePush, undefined, 'crate push tracking cleared');
    assert.equal(game.endOfRoundWhoseTurn, 'P1', 'player EoR window opened on the initiative player');
    assert.equal(game._devaronResumeLogVars, undefined, 'resume state consumed');
  });
});
