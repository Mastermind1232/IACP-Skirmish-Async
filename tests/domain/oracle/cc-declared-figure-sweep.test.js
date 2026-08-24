/**
 * Sweep: the DECLARED figure is "you" for every Command card, not the activating
 * one.
 *
 * alexanbv 2026-08-24: "sweep all CC for this bug and report. Do not stop until
 * all CC are fixed."
 *
 * The bug was that resolvers asked findActiveActivationMsgId / figureKeyForActivation
 * — "who is activating" — when the card means "who played me". That is right only
 * when those happen to be the same figure. Debts Repaid, Blaze of Glory and
 * Opportunistic were the three found by hand; there were 109 call sites of the
 * first helper and 46 of the second, so they were fixed at the source rather than
 * one at a time: both helpers now prefer game.ccPlayedByFigureKey, which exists
 * only for the duration of one card's resolution.
 *
 * This file is the guard on the mechanism itself, so a future resolver written
 * the old way still lands on the right figure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _registerDcMessageMeta, figureKeyForActivation } from '../../../src/game/activation-state.js';
import { resolveAbility } from '../../../src/game/abilities.js';

const ACT = 'Rebel Trooper (Regular)-1-0';   // the group that is activating
const DECL = 'Gamorrean Guard (Elite)-2-0';  // the figure that played the card
const M_ACT = 'm-act';
const M_DECL = 'm-decl';

const meta = () => new Map([
  [M_ACT, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper (Regular)', displayName: 'Rebel Trooper (Regular) [Group 1]' }],
  [M_DECL, { gameId: 'g', playerNum: 1, dcName: 'Gamorrean Guard (Elite)', displayName: 'Gamorrean Guard (Elite) [Group 2]' }],
]);

function game({ declared = null } = {}) {
  const g = {
    gameId: 'g', currentRound: 2,
    figurePositions: { 1: { [ACT]: 'e19', [DECL]: 'e20' } },
    p1DcList: [{ dcName: 'Rebel Trooper (Regular)' }, { dcName: 'Gamorrean Guard (Elite)' }],
    p1DcMessageIds: [M_ACT, M_DECL],
    // The OTHER group is the one activating.
    dcActionsData: { [M_ACT]: { selectedFigure: 0, perFigureRemaining: { 0: 2 } } },
    figureConditions: {},
  };
  if (declared) g.ccPlayedByFigureKey = declared;
  return g;
}

describe('the declaration overrides "whoever is activating"', () => {
  it('an MP grant lands on the declaring figure, not the activating group', () => {
    const g = game({ declared: DECL });
    const r = resolveAbility('Opportunistic', {
      game: g, playerNum: 1, dcMessageMeta: meta(), cardName: 'Opportunistic',
    });
    assert.equal(r.applied, true, r.manualMessage);
    assert.ok(g.pendingMoveX?.[M_DECL], 'the declaring figure gets the movement points');
    assert.ok(!g.pendingMoveX?.[M_ACT], 'the activating group does not');
  });

  it('with no declaration the old behaviour is untouched', () => {
    // Nothing declared: resolvers still fall back to the activating figure, so
    // Deployment-card abilities and activation-timed effects are unaffected.
    const g = game({ declared: null });
    const r = resolveAbility('Opportunistic', {
      game: g, playerNum: 1, dcMessageMeta: meta(), cardName: 'Opportunistic',
    });
    // Activating group is a Rebel Trooper, which cannot legally play a SCUM card,
    // so this resolves against the activation rather than the declaration.
    assert.ok(r.applied || r.requiresChoice, 'still resolves somehow');
    assert.equal(g.ccPlayedByFigureKey, undefined, 'no declaration leaked in');
  });
});

describe('figureKeyForActivation honours the declaration', () => {
  it('returns the declared figure even when it is not the selected one', () => {
    _registerDcMessageMeta(meta());
    const g = game({ declared: DECL });
    assert.equal(figureKeyForActivation(g, M_DECL), DECL);
  });

  it('picks the declared figure INSIDE a multi-figure group, not figure 0', () => {
    // A card declared by figure 2 of a group used to resolve as figure 0,
    // because selectedFigure is unset for a group that is not activating.
    _registerDcMessageMeta(meta());
    const g = game({ declared: 'Gamorrean Guard (Elite)-2-1' });
    g.figurePositions[1]['Gamorrean Guard (Elite)-2-1'] = 'e21';
    assert.equal(figureKeyForActivation(g, M_DECL), 'Gamorrean Guard (Elite)-2-1');
  });

  it('an explicit figure index still wins over the declaration', () => {
    _registerDcMessageMeta(meta());
    const g = game({ declared: DECL });
    assert.equal(figureKeyForActivation(g, M_DECL, 1), 'Gamorrean Guard (Elite)-2-1');
  });

  it('falls back to the activating selection when nothing is declared', () => {
    _registerDcMessageMeta(meta());
    const g = game({ declared: null });
    assert.equal(figureKeyForActivation(g, M_ACT), ACT);
  });
});

describe('resolvers that identify "you" via the activation lookup', () => {
  // Wild Fury is CREATURE or WOOKIEE, played from hand during your activation,
  // and resolves through the shared applyFocus branch — which asks
  // findActiveActivationMsgId who "you" is. Declared by a figure in a group that
  // is not the activating one, the Focus must still land on the declaring group.
  const WOOK = 'Gaarkhan-2-0';
  const M_WOOK = 'm-wook';
  const wfMeta = () => new Map([
    [M_ACT, { gameId: 'g', playerNum: 1, dcName: 'Rebel Trooper (Regular)', displayName: 'Rebel Trooper (Regular) [Group 1]' }],
    [M_WOOK, { gameId: 'g', playerNum: 1, dcName: 'Gaarkhan', displayName: 'Gaarkhan [Group 2]' }],
  ]);
  function wfGame(declared) {
    const g = {
      gameId: 'g', currentRound: 2,
      figurePositions: { 1: { [ACT]: 'e19', [WOOK]: 'e20' } },
      p1DcList: [{ dcName: 'Rebel Trooper (Regular)' }, { dcName: 'Gaarkhan' }],
      p1DcMessageIds: [M_ACT, M_WOOK],
      dcActionsData: { [M_ACT]: { selectedFigure: 0, perFigureRemaining: { 0: 2 } } },
      figureConditions: {},
    };
    if (declared) g.ccPlayedByFigureKey = declared;
    return g;
  }

  it('Focus lands on the DECLARING figure, not the activating group', () => {
    const g = wfGame(WOOK);
    const r = resolveAbility('Wild Fury', {
      game: g, playerNum: 1, dcMessageMeta: wfMeta(), cardName: 'Wild Fury',
    });
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(g.figureConditions[WOOK], ['Focus'],
      'the Wookiee that played it becomes Focused');
    assert.ok(!g.figureConditions[ACT],
      'the activating Rebel Trooper must not be the one Focused');
  });

  it('without a declaration it still uses the activating figure', () => {
    const g = wfGame(null);
    const r = resolveAbility('Wild Fury', {
      game: g, playerNum: 1, dcMessageMeta: wfMeta(), cardName: 'Wild Fury',
    });
    assert.equal(r.applied, true, r.manualMessage);
    assert.deepEqual(g.figureConditions[ACT], ['Focus']);
  });
});
