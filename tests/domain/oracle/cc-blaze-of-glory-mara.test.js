/**
 * Blaze of Glory (IG-88 CC) and Mara Jade's Fast Learner.
 *
 * alexanbv 2026-08-21: "Confirm that ig-88 cc is Mara aware if mara also in
 * list" — i.e. when BOTH IG-88 and Mara Jade are in the army, does the card know
 * which of them played it?
 *
 * It does, and the "both present" case is the one worth pinning: the earlier
 * behaviour to guard against is the card silently assuming the named figure. The
 * card reads "ready YOUR Deployment card ... you suffer 3 Damage", so when Mara
 * plays it through Fast Learner, both halves must land on Mara.
 *
 * Order of resolution (resolveUniqueFigureCcFigureKey, abilities.js:198):
 *   0. game.ccPlayedByFigureKey — whoever the player picked, and this wins even
 *      when the named figure is also on the board (alexanbv 2026-06-21)
 *   1. the named figure on the board
 *   2. a Fast Learner figure on the board
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { getUniqueCcPlayerOptions } from '../../../src/game/unique-figure-ccs.js';

const IG = 'IG-88-1-0';
const MARA = 'Mara Jade-2-0';
const IG_MSG = 'm-ig';
const MARA_MSG = 'm-mara';

function bothInArmy() {
  return {
    gameId: 'g-m',
    currentRound: 2,
    figurePositions: { 1: { [IG]: 'e19', [MARA]: 'e20' } },
    p1DcList: [{ dcName: 'IG-88' }, { dcName: 'Mara Jade' }],
    p1DcMessageIds: [IG_MSG, MARA_MSG],
    lastActivationMsgIdByPlayer: { 1: IG_MSG },
    dcActionsData: {},
  };
}
const meta = () => new Map([
  [IG_MSG, { gameId: 'g-m', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }],
  [MARA_MSG, { gameId: 'g-m', playerNum: 1, dcName: 'Mara Jade', displayName: 'Mara Jade [Group 2]' }],
]);
const play = (game) => resolveAbility('Blaze of Glory', {
  game, playerNum: 1, dcMessageMeta: meta(), recomputeActivationCounts: () => {},
});

describe('Blaze of Glory is Mara-aware with IG-88 also in the list', () => {
  it('offers BOTH figures, so the player is prompted rather than assumed', () => {
    const opts = getUniqueCcPlayerOptions(bothInArmy(), 1, 'Blaze of Glory');
    assert.equal(opts.length, 2, `expected IG-88 and Mara, got ${JSON.stringify(opts)}`);
    assert.ok(opts.some((o) => o.figureKey === IG && o.kind === 'named'));
    const fl = opts.find((o) => o.figureKey === MARA);
    assert.ok(fl, 'Mara must be offered');
    assert.equal(fl.kind, 'fast_learner');
    assert.equal(fl.consume, 'fast_learner', 'playing it as Mara spends Fast Learner');
    // cc-hand prompts when options.length > 1, so two options means a prompt.
  });

  it('played as Mara: readies MARA and the 3 Damage lands on MARA', () => {
    const game = bothInArmy();
    game.ccPlayedByFigureKey = MARA;
    const r = play(game);
    assert.equal(r.applied, true);
    assert.deepEqual(r.readyDcMsgIds, [MARA_MSG],
      'the chosen figure wins even though IG-88 is on the board');
    assert.equal(game.endOfRoundSelfDamage?.[1]?.msgId, MARA_MSG,
      '"you suffer 3 Damage" follows the figure that played it');
    assert.equal(game.endOfRoundSelfDamage?.[1]?.damage, 3);
  });

  it('played as IG-88: readies IG-88 and the damage lands on IG-88', () => {
    const game = bothInArmy();
    game.ccPlayedByFigureKey = IG;
    const r = play(game);
    assert.equal(r.applied, true);
    assert.deepEqual(r.readyDcMsgIds, [IG_MSG]);
    assert.equal(game.endOfRoundSelfDamage?.[1]?.msgId, IG_MSG);
  });

  it('with no explicit pick it falls back to the named figure, not the last activation', () => {
    const game = bothInArmy();
    const r = play(game);
    assert.equal(r.applied, true);
    assert.deepEqual(r.readyDcMsgIds, [IG_MSG]);
  });

  it('Mara alone, no IG-88 on the board: she is the fallback', () => {
    const game = {
      gameId: 'g-m2',
      currentRound: 2,
      figurePositions: { 1: { [MARA]: 'e20' } },
      p1DcList: [{ dcName: 'Mara Jade' }],
      p1DcMessageIds: [MARA_MSG],
      lastActivationMsgIdByPlayer: { 1: MARA_MSG },
      dcActionsData: {},
    };
    const r = resolveAbility('Blaze of Glory', {
      game,
      playerNum: 1,
      dcMessageMeta: new Map([[MARA_MSG, { gameId: 'g-m2', playerNum: 1, dcName: 'Mara Jade', displayName: 'Mara Jade [Group 2]' }]]),
      recomputeActivationCounts: () => {},
    });
    assert.equal(r.applied, true);
    assert.deepEqual(r.readyDcMsgIds, [MARA_MSG]);
  });
});
