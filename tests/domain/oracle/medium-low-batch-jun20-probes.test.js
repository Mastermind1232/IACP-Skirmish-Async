/**
 * Behavioral probes for the Jun-20 MEDIUM/LOW ability-audit batch.
 *
 * Covers the data/profile-level fixes that are unit-testable without a full
 * combat/Discord harness:
 *   - Thrusters (74-Z Speeder Bike Elite) → profile.ignoreImpassable, plus the
 *     impassable-edge waiver in buildTempBoardState/evaluateMovementStep.
 *   - Wampa (Elite/Regular) Efficient Travel → movement waiver (ignoreDifficult).
 *   - Utinni! → +1 Speed for Jawa Scavenger figures (getEffectiveSpeed).
 *   - On the Hunt → +1 Hit gated on a unique hostile target (library shape).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getMovementProfile,
  buildTempBoardState,
  computeMovementCache,
} from '../../../src/game/movement.js';
import { getEffectiveSpeed } from '../../../src/game/board-helpers.js';
import { getDcKeywords } from '../../../src/data-loader.js';
import { resolveAbility } from '../../../src/game/abilities.js';
import abilityLibrary from '../../../data/ability-library.json' with { type: 'json' };

function makeMinimalGame() {
  return { figurePositions: { 1: {}, 2: {} }, figureOrientations: {} };
}

// ── Thrusters: profile.ignoreImpassable ──────────────────────────────────────
describe('Thrusters → profile.ignoreImpassable', () => {
  it('74-Z Speeder Bike (Elite) profile has ignoreImpassable=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('74-Z Speeder Bike (Elite)', '74-Z Speeder Bike (Elite)-1-0', game);
    assert.strictEqual(profile.ignoreImpassable, true,
      'Thrusters waives impassable terrain while moving');
  });
  it('a non-Thrusters DC has ignoreImpassable=false', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Rebel Trooper', 'Rebel Trooper-1-0', game);
    assert.strictEqual(profile.ignoreImpassable, false);
  });
});

// ── Impassable-edge waiver actually lets the path cross ───────────────────────
describe('ignoreImpassable waiver crosses an impassable edge', () => {
  // 3-cell row a1-b1-c1, with an impassable edge between a1|b1.
  const mapSpaces = {
    spaces: ['a1', 'b1', 'c1'],
    blocking: [],
    terrain: {},
    adjacency: { a1: ['b1'], b1: ['a1', 'c1'], c1: ['b1'] },
    movementBlockingEdges: [],
    impassableEdges: [['a1', 'b1']],
  };

  it('without ignoreImpassable the a1→b1 edge blocks movement', () => {
    const board = buildTempBoardState(mapSpaces, []);
    assert.ok(board.impassableEdgeSet && board.impassableEdgeSet.size === 1,
      'impassable edges tracked separately on the board');
    const profile = { size: '1x1', allowDiagonal: true, isLarge: false, canRotate: false,
      ignoreDifficult: false, ignoreBlocking: false, ignoreImpassable: false, ignoreFigureCost: false };
    const cache = computeMovementCache('a1', 5, board, profile);
    assert.ok(!cache.cells.has('b1'), 'b1 unreachable across the impassable edge');
  });

  it('with ignoreImpassable the figure can cross to b1 (and c1)', () => {
    const board = buildTempBoardState(mapSpaces, []);
    const profile = { size: '1x1', allowDiagonal: true, isLarge: false, canRotate: false,
      ignoreDifficult: false, ignoreBlocking: false, ignoreImpassable: true, ignoreFigureCost: false };
    const cache = computeMovementCache('a1', 5, board, profile);
    assert.ok(cache.cells.has('b1'), 'b1 reachable when impassable terrain is ignored');
    assert.ok(cache.cells.has('c1'), 'continues past the waived edge');
  });
});

// ── Wampa Efficient Travel ───────────────────────────────────────────────────
describe('Wampa Efficient Travel → movement waiver', () => {
  it('Wampa (Elite) keywords include Efficient Travel', () => {
    const kws = (getDcKeywords()['Wampa (Elite)'] || []).map((k) => String(k).toLowerCase());
    assert.ok(kws.includes('efficient travel'), 'Efficient Travel promoted to keyword');
  });
  it('Wampa (Elite) profile.ignoreDifficult=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Wampa (Elite)', 'Wampa (Elite)-1-0', game);
    assert.strictEqual(profile.ignoreDifficult, true);
    assert.strictEqual(profile.ignoreFigureCost, true);
  });
  it('Wampa (Regular) profile.ignoreDifficult=true', () => {
    const game = makeMinimalGame();
    const profile = getMovementProfile('Wampa (Regular)', 'Wampa (Regular)-1-0', game);
    assert.strictEqual(profile.ignoreDifficult, true);
  });
});

// ── Utinni! +1 Speed for Jawa Scavenger ──────────────────────────────────────
describe('Utinni! → +1 Speed for Jawa Scavenger', () => {
  it('roundUtinniJawaBuffs adds +1 Speed to a Jawa Scavenger', () => {
    const base = getEffectiveSpeed('Jawa Scavenger', 'Jawa Scavenger-1-0', { figurePositions: { 1: {}, 2: {} } }, 1);
    const buffed = getEffectiveSpeed('Jawa Scavenger', 'Jawa Scavenger-1-0', { roundUtinniJawaBuffs: true, figurePositions: { 1: {}, 2: {} } }, 1);
    assert.strictEqual(buffed, base + 1, 'Jawa Scavenger gains +1 Speed under Utinni!');
  });
  it('does not buff non-Jawa figures', () => {
    const base = getEffectiveSpeed('Rebel Trooper', 'Rebel Trooper-1-0', { figurePositions: { 1: {}, 2: {} } }, 1);
    const same = getEffectiveSpeed('Rebel Trooper', 'Rebel Trooper-1-0', { roundUtinniJawaBuffs: true, figurePositions: { 1: {}, 2: {} } }, 1);
    assert.strictEqual(same, base, 'non-Jawa figures unaffected by Utinni!');
  });
});

// ── Built on Hope: top-vs-bottom placement choice ────────────────────────────
describe('Built on Hope → top/bottom placement choice', () => {
  function makeGame() {
    // deck top = end of array; top 3 = [c, b, a] reading down... here e is the top.
    return { gameId: 'g', player1CcDeck: ['x', 'y', 'z', 'd', 'e'], player1CcHand: [] };
  }
  it('after picking a card, offers a top/bottom placement choice', () => {
    const game = makeGame();
    const r = resolveAbility('Built on Hope', { game, playerNum: 1, choiceIndex: 0 });
    assert.ok(r.requiresChoice, 'second-stage choice offered');
    assert.equal(r.choiceOptions.length, 2, 'top vs bottom');
    assert.ok(/TOP/i.test(r.choiceOptions[0]) && /BOTTOM/i.test(r.choiceOptions[1]));
    assert.ok(game.pendingBuiltOnHope?.[1], 'pending placement state stashed');
    // one card moved to hand, top-3 removed from deck pending placement
    assert.equal(game.player1CcHand.length, 1, '1 card drawn to hand');
  });
  it('choosing BOTTOM with 2 cards offers an ordering step, then places them at the bottom', () => {
    const game = makeGame();
    resolveAbility('Built on Hope', { game, playerNum: 1, choiceIndex: 0 });
    const before = [...game.player1CcDeck];
    // With 2 non-chosen cards remaining, CSV "in any order" → choosing BOTTOM
    // surfaces a relative-ordering choice rather than finishing immediately.
    const r2 = resolveAbility('Built on Hope', { game, playerNum: 1, choiceIndex: 1 });
    assert.ok(r2.requiresChoice, 'ordering choice offered for the 2 remaining cards');
    assert.equal(r2.choiceOptions.length, 2, 'keep-order vs reverse-order');
    assert.ok(game.pendingBuiltOnHope?.[1]?.awaitingOrder, 'awaiting-order state stashed');
    assert.equal(game.pendingBuiltOnHope[1].side, 'bottom');
    // Resolve the ordering (keep shown order) → final placement at the bottom.
    const r3 = resolveAbility('Built on Hope', { game, playerNum: 1, choiceIndex: 0 });
    assert.equal(r3.applied, true);
    assert.ok(/bottom/i.test(r3.logMessage), 'log notes bottom placement');
    // bottom = front of array; the two non-chosen cards now lead the deck.
    assert.equal(game.player1CcDeck.length, before.length + 2);
    assert.ok(!game.pendingBuiltOnHope?.[1], 'pending state cleared');
  });
});

// ── On the Hunt: +1 Hit gated on unique hostile target ───────────────────────
describe('On the Hunt → requiresUniqueHostileTarget flag wired', () => {
  it('library entry carries requiresUniqueHostileTarget on the Hit bonus', () => {
    const oth = abilityLibrary.abilities.on_the_hunt;
    assert.ok(oth, 'on_the_hunt library entry exists');
    assert.strictEqual(oth.nextAttacksBonusHits?.requiresUniqueHostileTarget, true,
      '+1 Hit must be gated on a unique hostile target (CSV row 396)');
  });
});
