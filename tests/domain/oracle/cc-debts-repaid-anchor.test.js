/**
 * Debts Repaid (Chewbacca CC, cost 3) — "Use when a friendly figure is defeated.
 * Ready YOUR Deployment card and become Focused."
 *
 * "Your" is Chewbacca's. The card's whole purpose is reacting to a friendly
 * figure dying, and a friendly usually dies on the OPPONENT's turn, so the
 * activating figure is very often not Chewbacca — or there is no activation at
 * all. Until 2026-08-22 the resolver keyed off findActiveActivationMsgId, which
 * meant:
 *
 *   - some other group activating -> it Focused and readied THAT group instead
 *   - nobody activating           -> "no activation in progress", the card did
 *                                    nothing at all and the 3 cost was wasted
 *
 * Exactly the defect Blaze of Glory had (alexanbv 2026-08-12), and the same fix:
 * anchor on the named figure via findOwnDcMsgIdForCc, which also inherits
 * Mara/Fast Learner awareness.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const CHEW = 'Chewbacca-1-0';
const TROOP = 'Rebel Trooper-2-0';
const CHEW_MSG = 'm-chew';
const TROOP_MSG = 'm-troop';

const meta = () => new Map([
  [CHEW_MSG, { gameId: 'g', playerNum: 1, dcName: 'Chewbacca', displayName: 'Chewbacca [Group 1]' }],
  [TROOP_MSG, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 2]' }],
]);

function game(activeMsg) {
  const g = {
    gameId: 'g',
    currentRound: 2,
    figurePositions: { 1: { [CHEW]: 'e19', [TROOP]: 'e20' } },
    p1DcList: [{ dcName: 'Chewbacca' }, { dcName: 'Rebel Trooper' }],
    p1DcMessageIds: [CHEW_MSG, TROOP_MSG],
    figureConditions: {},
    dcActionsData: {},
  };
  if (activeMsg) g.dcActionsData[activeMsg] = { selectedFigure: 0, perFigureRemaining: { 0: 2 } };
  return g;
}
const play = (g) => resolveAbility('Debts Repaid', { game: g, playerNum: 1, dcMessageMeta: meta() });

describe('Debts Repaid anchors on Chewbacca, not on whoever is activating', () => {
  it('works when NO ONE is activating — its most common window', () => {
    // A friendly figure usually dies on the opponent's turn. This used to bail
    // with "no activation in progress" and the card did nothing.
    const g = game(null);
    const r = play(g);
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(r.readyDcMsgIds, [CHEW_MSG]);
    assert.deepEqual(g.figureConditions[CHEW], ['Focus']);
  });

  it('readies CHEWBACCA when a different group is activating', () => {
    const g = game(TROOP_MSG);
    const r = play(g);
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(r.readyDcMsgIds, [CHEW_MSG],
      'the card says "your" Deployment card, meaning Chewbacca\'s');
    assert.deepEqual(g.figureConditions[CHEW], ['Focus']);
    assert.ok(!g.figureConditions[TROOP], 'the activating group must not be Focused');
  });

  it('still works when Chewbacca is the one activating', () => {
    const g = game(CHEW_MSG);
    const r = play(g);
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(r.readyDcMsgIds, [CHEW_MSG]);
    assert.deepEqual(g.figureConditions[CHEW], ['Focus']);
  });

  it('reports honestly when Chewbacca is not in play', () => {
    const g = {
      gameId: 'g', currentRound: 2,
      figurePositions: { 1: { [TROOP]: 'e20' } },
      p1DcList: [{ dcName: 'Rebel Trooper' }],
      p1DcMessageIds: [TROOP_MSG],
      figureConditions: {}, dcActionsData: {},
    };
    const r = resolveAbility('Debts Repaid', {
      game: g, playerNum: 1,
      dcMessageMeta: new Map([[TROOP_MSG, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 2]' }]]),
    });
    assert.equal(r.applied, false);
    assert.ok(!g.figureConditions[TROOP], 'must not fall through onto some other group');
  });
});

describe('the anchor stays opt-in', () => {
  it('an ordinary Focus card still uses the activating figure', () => {
    // Debts Repaid is the only applyFocus card with an out-of-activation timing;
    // everything else must keep keying off the activation.
    const g = game(TROOP_MSG);
    const r = resolveAbility('Focus', { game: g, playerNum: 1, dcMessageMeta: meta() });
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(g.figureConditions[TROOP], ['Focus'],
      'plain Focus Focuses the ACTIVATING figure');
    assert.ok(!g.figureConditions[CHEW]);
  });
});
