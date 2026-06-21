/**
 * Range-anchor audit fixes (2026-06-21). Behavioral coverage for the 7 gaps
 * where a "within N spaces of you" range was measured from the WRONG figure.
 * Designer rule: range is ALWAYS measured from the figure that plays the card /
 * owns the ability.
 *
 *   #1 Just Business      — start_of_round LEADER CC; anchor = played-by figure
 *                           (covered in src/game/round-modifiers.test.js).
 *   #2 Paid in Beskar     — HUNTER "you"-CC; within-3 + Block recipient = the
 *                           playing HUNTER, not nearest-to-kill.
 *   #3 Cripple            — "an adjacent hostile figure"; gate the offered
 *                           hostiles to those adjacent to the activating figure.
 *   #4 Miracle Worker     — MHD-19 unique-CC; within-3 anchors on the playing
 *                           figure (Mara via Fast Learner substitution honored).
 *   #5 Final Stand        — Baze Malbus unique-CC; same anchor + Fast Learner.
 *   #6 Extra Protection   — Onar Koma unique-CC; within-2 anchor + Fast Learner.
 *   #7 Protect the Old Ways — Kanan unique-CC; within-3 anchors on the single
 *                           playing FORCE USER, not player-wide.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const MAP = 'mos-eisley-outskirts';

function baseGame(id) {
  return {
    gameId: id,
    selectedMap: { id: MAP },
    figurePositions: { 1: {}, 2: {} },
    activeRoundModifiers: [],
    player1CcDiscard: [],
    player2CcDiscard: [],
  };
}

// ── #2 Paid in Beskar ────────────────────────────────────────────────────────
describe('Range anchor #2 — Paid in Beskar (within 3 of YOU, the playing HUNTER)', () => {
  it('measures within-3 from the playing HUNTER (not the nearest friendly to the kill) and grants Block to that HUNTER', () => {
    const game = baseGame('g-pib-1');
    // Boba Fett (HUNTER) is 3 spaces from the defeated figure (m17→p17). A
    // closer non-HUNTER friendly (Greedo at m18, 1 from the kill) must NOT be
    // chosen — the range + recipient anchor on the playing HUNTER.
    game.figurePositions[1] = {
      'Boba Fett-1-0': 'm17',   // the playing HUNTER
      'Greedo-1-0': 'm18',      // closer to the kill, but not a HUNTER
    };
    const r = resolveAbility('Paid in Beskar', {
      game, playerNum: 1, cardName: 'Paid in Beskar',
      defeatedPos: 'p17', // a hostile defeated 3 spaces from Boba
    });
    assert.equal(r.applied, true);
    assert.deepEqual(game.figurePowerTokens?.['Boba Fett-1-0'], ['Block', 'Block'],
      'the playing HUNTER (Boba Fett) gains 2 Block tokens');
    assert.equal(game.figurePowerTokens?.['Greedo-1-0'], undefined,
      'the closer non-HUNTER friendly does NOT receive the tokens');
  });

  it('does NOT fire when the defeated figure is out of range of the playing HUNTER', () => {
    const game = baseGame('g-pib-2');
    game.figurePositions[1] = { 'Boba Fett-1-0': 'm17' };
    const r = resolveAbility('Paid in Beskar', {
      game, playerNum: 1, cardName: 'Paid in Beskar',
      defeatedPos: 'r17', // 7 spaces from Boba → out of range
    });
    assert.equal(r.applied, true);
    assert.equal(game.figurePowerTokens?.['Boba Fett-1-0'], undefined,
      'no Block tokens when the kill is >3 spaces from the HUNTER');
  });
});

// ── #3 Cripple ───────────────────────────────────────────────────────────────
describe('Range anchor #3 — Cripple (only ADJACENT hostiles offered)', () => {
  it('offers only hostile figures adjacent to the activating figure', () => {
    const game = baseGame('g-cr-1');
    const msgId = 'm-cr';
    game.dcActionsData = { [msgId]: { selectedFigure: 0 } };
    game.figurePositions[1] = { 'Greedo-1-0': 'm17' }; // the activating (playing) figure
    game.figurePositions[2] = {
      'Stormtrooper-2-0': 'm18',     // adjacent to Greedo → offered
      'Stormtrooper-2-1': 'r17',     // far away → NOT offered
    };
    // Opponent DC list (player 2). Cripple reads getDcList(game, 3-playerNum).
    game.p2DcList = [
      { dcName: 'Stormtrooper', displayName: 'Stormtrooper', defeated: false },
    ];
    const dcMessageMeta = new Map([[msgId, { gameId: 'g-cr-1', playerNum: 1, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
    const r = resolveAbility('Cripple', { game, playerNum: 1, dcMessageMeta });
    // Stormtrooper has a figure adjacent (m18) to Greedo → it IS offered.
    assert.ok(r.requiresChoice, 'a choice is offered when an adjacent hostile exists');
    assert.ok(r.choiceOptions.includes('Stormtrooper'),
      'the hostile DC with an adjacent figure is offered');
  });

  it('offers nothing when no hostile figure is adjacent to the activating figure', () => {
    const game = baseGame('g-cr-2');
    const msgId = 'm-cr2';
    game.dcActionsData = { [msgId]: { selectedFigure: 0 } };
    game.figurePositions[1] = { 'Greedo-1-0': 'm17' };
    game.figurePositions[2] = { 'Stormtrooper-2-0': 'r17' }; // far from Greedo
    game.p2DcList = [
      { dcName: 'Stormtrooper', displayName: 'Stormtrooper', defeated: false },
    ];
    const dcMessageMeta = new Map([[msgId, { gameId: 'g-cr-2', playerNum: 1, dcName: 'Greedo', displayName: 'Greedo [Group 1]' }]]);
    const r = resolveAbility('Cripple', { game, playerNum: 1, dcMessageMeta });
    assert.equal(r.applied, false, 'no adjacent hostile → not applied');
    assert.match(r.manualMessage || '', /No adjacent hostile/i);
  });
});

// ── #7 Protect the Old Ways ──────────────────────────────────────────────────
describe('Range anchor #7 — Protect the Old Ways (within 3 of the single playing FORCE USER)', () => {
  it('applies when the defender is within 3 of the playing Kanan', () => {
    const game = baseGame('g-pow-1');
    game.figurePositions[1] = {
      'Kanan Jarrus-1-0': 'm17',  // the playing FORCE USER
      'Rebel Trooper-1-0': 'p17', // defender, 3 spaces from Kanan
    };
    game.pendingCombat = { target: { figureKey: 'Rebel Trooper-1-0' } };
    const r = resolveAbility('Protect the Old Ways', {
      game, playerNum: 1, cardName: 'Protect the Old Ways', combat: game.pendingCombat,
    });
    assert.equal(r.applied, true, 'within 3 of Kanan → bonus applies');
    assert.ok((game.pendingCombat.bonusBlock || 0) >= 1, '+Block applied to the defender');
  });

  it('does NOT apply when the defender is within 3 of a DIFFERENT FORCE USER but far from the playing Kanan', () => {
    const game = baseGame('g-pow-2');
    game.figurePositions[1] = {
      'Kanan Jarrus-1-0': 'm17',  // the playing figure (anchor)
      'Ezra Bridger-1-0': 'r17',  // a different FORCE USER, near the defender
      'Rebel Trooper-1-0': 'r18', // defender adjacent to Ezra, FAR from Kanan
    };
    game.pendingCombat = { target: { figureKey: 'Rebel Trooper-1-0' } };
    const r = resolveAbility('Protect the Old Ways', {
      game, playerNum: 1, cardName: 'Protect the Old Ways', combat: game.pendingCombat,
    });
    assert.equal(r.applied, false,
      'player-wide over-broadening removed: anchors on the single playing Kanan');
  });

  it('anchors on Mara when she plays it via Fast Learner (ccPlayedByFigureKey)', () => {
    const game = baseGame('g-pow-3');
    game.figurePositions[1] = {
      'Kanan Jarrus-1-0': 'r17',  // named figure, FAR from the defender
      'Mara Jade-1-0': 'm17',     // Fast Learner substitute, 3 from defender
      'Rebel Trooper-1-0': 'p17', // defender, 3 from Mara, far from Kanan
    };
    game.pendingCombat = { target: { figureKey: 'Rebel Trooper-1-0' } };
    game.ccPlayedByFigureKey = 'Mara Jade-1-0';
    const r = resolveAbility('Protect the Old Ways', {
      game, playerNum: 1, cardName: 'Protect the Old Ways', combat: game.pendingCombat,
    });
    delete game.ccPlayedByFigureKey;
    assert.equal(r.applied, true,
      'range anchors on Mara (the chosen playing figure), not the named Kanan');
  });
});

// ── #4/#5/#6 Unique-figure before-defeated / when-damaged hooks ──────────────
describe('Range anchor #4/#5/#6 — unique-figure CC hooks anchor on the playing figure', () => {
  async function hooks() {
    const { BEFORE_DEFEATED_HOOKS, WHEN_DAMAGED_HOOKS } = await import('../../../src/game/damage-pipeline.js');
    await import('../../../src/game/damage-pipeline-hooks.js');
    return { BEFORE_DEFEATED_HOOKS, WHEN_DAMAGED_HOOKS };
  }

  it('#5 Final Stand: probe true with Baze within 3, and TRUE when Mara substitutes via Fast Learner (Baze off-board)', async () => {
    const { BEFORE_DEFEATED_HOOKS } = await hooks();
    const fs = BEFORE_DEFEATED_HOOKS.find(h => h.id === 'final_stand');
    // Named figure on board.
    const g1 = {
      gameId: 'g-fs-1', player1CcHand: ['Final Stand'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Baze Malbus-1-0': 'm18' } },
    };
    assert.equal(fs.probe(g1, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), true,
      'Baze within 3 → probe true');
    // Baze OFF-board, Mara substitutes via Fast Learner. Previously the hard-
    // coded "Baze Malbus" name check returned false (card could never fire).
    const g2 = {
      gameId: 'g-fs-2', player1CcHand: ['Final Stand'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Mara Jade-1-0': 'm18' } },
    };
    assert.equal(fs.probe(g2, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), true,
      'Mara (Fast Learner) within 3 → probe true even with Baze off-board');
  });

  it('#5 Final Stand: probe FALSE when the playing figure (Baze) is out of range', async () => {
    const { BEFORE_DEFEATED_HOOKS } = await hooks();
    const fs = BEFORE_DEFEATED_HOOKS.find(h => h.id === 'final_stand');
    const g = {
      gameId: 'g-fs-3', player1CcHand: ['Final Stand'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Baze Malbus-1-0': 'r17' } }, // 7 spaces
    };
    assert.equal(fs.probe(g, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), false);
  });

  it('#4 Miracle Worker: probe TRUE when Mara substitutes via Fast Learner (MHD-19 off-board)', async () => {
    const { BEFORE_DEFEATED_HOOKS } = await hooks();
    const mw = BEFORE_DEFEATED_HOOKS.find(h => h.id === 'miracle_worker');
    const g = {
      gameId: 'g-mw-1', player1CcHand: ['Miracle Worker'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Mara Jade-1-0': 'm18' } }, // MHD-19 absent
    };
    assert.equal(mw.probe(g, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), true,
      'Mara within 3 → probe true even with MHD-19 off-board');
  });

  it('#4 Miracle Worker: probe anchors range on the named MHD-19 when present', async () => {
    const { BEFORE_DEFEATED_HOOKS } = await hooks();
    const mw = BEFORE_DEFEATED_HOOKS.find(h => h.id === 'miracle_worker');
    const gIn = {
      gameId: 'g-mw-2', player1CcHand: ['Miracle Worker'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'MHD-19-1-0': 'm18' } },
    };
    assert.equal(mw.probe(gIn, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), true);
    const gOut = {
      gameId: 'g-mw-3', player1CcHand: ['Miracle Worker'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'MHD-19-1-0': 'r17' } }, // out of range
    };
    assert.equal(mw.probe(gOut, { figureKey: 'Rebel Trooper-1-0', msgId: 'x', figIndex: 0, controllerPlayerNum: 1 }), false);
  });

  it('#6 Extra Protection: probe TRUE when Mara substitutes via Fast Learner (Onar off-board) within 2', async () => {
    const { WHEN_DAMAGED_HOOKS } = await hooks();
    const ep = WHEN_DAMAGED_HOOKS.find(h => h.id === 'extra_protection_onar_koma');
    const g = {
      gameId: 'g-ep-1', player1CcHand: ['Extra Protection'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Mara Jade-1-0': 'm18' } }, // Onar absent
    };
    assert.equal(ep.probe(g, { figureKey: 'Rebel Trooper-1-0', controllerPlayerNum: 1, amount: 3 }), true,
      'Mara within 2 → probe true even with Onar off-board');
  });

  it('#6 Extra Protection: probe FALSE when the playing figure is >2 spaces away', async () => {
    const { WHEN_DAMAGED_HOOKS } = await hooks();
    const ep = WHEN_DAMAGED_HOOKS.find(h => h.id === 'extra_protection_onar_koma');
    const g = {
      gameId: 'g-ep-2', player1CcHand: ['Extra Protection'], selectedMap: { id: MAP },
      figurePositions: { 1: { 'Rebel Trooper-1-0': 'm17', 'Onar Koma-1-0': 'p17' } }, // 3 spaces > 2
    };
    assert.equal(ep.probe(g, { figureKey: 'Rebel Trooper-1-0', controllerPlayerNum: 1, amount: 3 }), false);
  });
});
