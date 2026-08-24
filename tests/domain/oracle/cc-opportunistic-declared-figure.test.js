/**
 * Opportunistic (SCUM) — "Use after a hostile figure suffers Damage. You gain 3
 * movement points."
 *
 * alexanbv 2026-08-24 gave the three cases this must cover:
 *   "Activating figure plays - mp banked.
 *    Non activating figure plays during friendly turn - spend immediate
 *    Figure plays during opponent turn - spend immediate"
 *
 * The bank-vs-immediate rule is his 2026-07-13 one: movement points bank only
 * for a figure that is actually activating.
 *
 * The card is the worked example for the declaration step, because "you" is
 * whichever SCUM figure played it, which is frequently not the activating one
 * and often nobody's activation at all.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const SCUM = 'Gamorrean Guard (Elite)-1-0';
const REB = 'Rebel Trooper (Regular)-2-0';
const M_SCUM = 'm-scum';
const M_REB = 'm-reb';

const meta = () => new Map([
  [M_SCUM, { gameId: 'g', playerNum: 1, dcName: 'Gamorrean Guard (Elite)', displayName: 'Gamorrean Guard (Elite) [Group 1]' }],
  [M_REB, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper (Regular)', displayName: 'Rebel Trooper (Regular) [Group 2]' }],
]);

function game({ activating = null, declared = null } = {}) {
  const g = {
    gameId: 'g', currentRound: 2,
    figurePositions: { 1: { [SCUM]: 'e19', [REB]: 'e20' } },
    p1DcList: [{ dcName: 'Gamorrean Guard (Elite)' }, { dcName: 'Rebel Trooper (Regular)' }],
    p1DcMessageIds: [M_SCUM, M_REB],
    dcActionsData: activating ? { [activating]: { selectedFigure: 0, perFigureRemaining: { 0: 2 } } } : {},
    figureConditions: {},
  };
  if (declared) g.ccPlayedByFigureKey = declared;
  return g;
}
const play = (g) => resolveAbility('Opportunistic', {
  game: g, playerNum: 1, dcMessageMeta: meta(), cardName: 'Opportunistic',
});

describe('Opportunistic: the three cases', () => {
  it('1. the activating figure plays it — movement points BANK', () => {
    const g = game({ activating: M_SCUM, declared: SCUM });
    const r = play(g);
    assert.equal(r.applied, true);
    assert.equal(r.refreshMovementBank, true, 'banked');
    assert.equal(g.pendingMoveX, undefined, 'not an immediate spend');
  });

  it('2. a non-activating friendly plays it during your turn — spend IMMEDIATELY', () => {
    const g = game({ activating: M_REB, declared: SCUM });
    const r = play(g);
    assert.equal(r.applied, true);
    assert.equal(g.pendingMoveX?.[M_SCUM]?.remaining, 3, 'immediate spend on the SCUM figure');
    assert.ok(!r.refreshMovementBank, 'must not bank for a figure that is not activating');
  });

  it('3. it is played during the opponent turn — spend IMMEDIATELY', () => {
    const g = game({ activating: null, declared: SCUM });
    const r = play(g);
    assert.equal(r.applied, true, r.manualMessage);
    assert.equal(g.pendingMoveX?.[M_SCUM]?.remaining, 3);
  });

  it('the points go to the figure that PLAYED it, not the one activating', () => {
    // The Rebel Trooper is activating; the Gamorrean played the card.
    const g = game({ activating: M_REB, declared: SCUM });
    play(g);
    assert.ok(g.pendingMoveX?.[M_SCUM], 'the Scum figure gets them');
    assert.ok(!g.pendingMoveX?.[M_REB], 'the activating Rebel Trooper does not');
  });
});

describe('the fallback picker offers only figures that could legally play it', () => {
  it('a SCUM card does not offer a Rebel Trooper', () => {
    // alexanbv 2026-08-24: "Only figures who can legally play the card should be
    // offered." This used to list every friendly Deployment card.
    const r = play(game({ activating: null, declared: null }));
    assert.equal(r.requiresChoice, true);
    assert.deepEqual(r.choiceOptions, ['Gamorrean Guard (Elite)']);
  });
});
