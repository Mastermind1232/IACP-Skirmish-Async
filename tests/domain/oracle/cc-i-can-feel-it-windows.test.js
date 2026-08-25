/**
 * I Can Feel It — three windows, one ability each.
 *
 * alexanbv 2026-08-24: "yes, I can feel it can be played in three different
 * windows. When played, you only get the ONE ability corresponding to the window
 * in which it was played."
 *
 * The card prints three abilities divided by rules: reroll a defense die while
 * defending, reroll an attack die while attacking, and a Special Action to gain
 * 1 VP. We had it as `timing: 'other'`, which resolves to "during your
 * activation" — so the DEFENDING window, the one that fires on the opponent's
 * turn, could never be reached at all. And all three options were offered as a
 * free choice whenever it was played.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCcPlayableNow, isCcPlayableByDc } from '../../../src/game/cc-timing.js';
import { resolveAbility } from '../../../src/game/abilities.js';

const ME = 'Luke Skywalker-1-0';
const MSG = 'm';
const meta = () => new Map([[MSG, { gameId: 'g', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke Skywalker [Group 1]' }]]);

function game(combat, activeTurnPlayerId) {
  return {
    gameId: 'g', currentRound: 2, player1Id: 'p1', player2Id: 'p2',
    currentActivationTurnPlayerId: activeTurnPlayerId,
    figurePositions: { 1: { [ME]: 'e19' } },
    p1DcList: [{ dcName: 'Luke Skywalker' }], p1DcMessageIds: [MSG],
    player1VP: { total: 0 },
    dcActionsData: {},
    pendingCombat: combat,
  };
}

describe('all three windows are reachable', () => {
  it('DEFENDING, on the opponent turn — the window that was unreachable', () => {
    const g = game({ attackerPlayerNum: 2, defenderPlayerNum: 1 }, 'p2');
    assert.equal(isCcPlayableNow(g, 1, 'I Can Feel It'), true);
  });

  it('ATTACKING, on your own turn', () => {
    const g = game({ attackerPlayerNum: 1, defenderPlayerNum: 2 }, 'p1');
    assert.equal(isCcPlayableNow(g, 1, 'I Can Feel It'), true);
  });

  it('SPECIAL ACTION, off the Deployment card button', () => {
    assert.equal(isCcPlayableByDc('I Can Feel It', 'Luke Skywalker', 'Luke Skywalker [Group 1]'), true);
  });

  it('is not playable from hand with no combat and no activation', () => {
    assert.equal(isCcPlayableNow(game(null, 'p2'), 1, 'I Can Feel It'), false);
  });
});

describe('each window grants exactly ONE ability, not a choice of three', () => {
  const play = (ctx) => resolveAbility('I Can Feel It', {
    game: game(null, 'p1'), playerNum: 1, dcMessageMeta: meta(), cardName: 'I Can Feel It', ...ctx,
  });

  it('defending offers only the defense-die reroll', () => {
    const r = play({ combat: { attackerPlayerNum: 2, defenderPlayerNum: 1 } });
    assert.ok(!r.requiresChoice, 'must not present a three-way choice');
    assert.match(String(r.manualMessage || r.logMessage || ''), /defense die/i);
  });

  it('attacking offers only the attack-die reroll', () => {
    const r = play({ combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    assert.ok(!r.requiresChoice);
    assert.match(String(r.manualMessage || r.logMessage || ''), /attack die/i);
  });

  it('the Special Action window gives the VP and nothing else', () => {
    const g = game(null, 'p1');
    const r = resolveAbility('I Can Feel It', {
      game: g, playerNum: 1, dcMessageMeta: meta(), cardName: 'I Can Feel It', msgId: MSG,
    });
    assert.equal(r.applied, true, r.manualMessage);
    assert.equal(g.player1VP.total, 1);
    assert.ok(!/reroll/i.test(String(r.logMessage || '')), 'no reroll offered in this window');
  });
});
