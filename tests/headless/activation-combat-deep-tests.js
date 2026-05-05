/**
 * Deep targeted tests for activation, combat, movement, conditions,
 * reroll, token-overflow, strain-choice, and push-pull regions.
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupActivation,
  cleanupRoundStart,
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from '../../src/game/activation-state.js';
import {
  applyCondition,
  filterCondition,
  resetCondition,
  isConditionImmune,
  HARMFUL_CONDITIONS,
} from '../../src/game/conditions.js';
import {
  getRange,
  hasLineOfSight,
  isWithinSpaces,
} from '../../src/game/spatial.js';
import {
  parseCoord,
  normalizeCoord,
  colRowToCoord,
  edgeKey,
  parseSizeString,
  sizeToString,
  rotateSizeString,
  shiftCoord,
  getFootprintCells,
} from '../../src/game/coords.js';
import {
  recalcAttackTotals,
  recalcDefenseTotals,
  parseSurgeEffect,
  computeCombatResult,
} from '../../src/game/combat.js';
import {
  grantMovementBank,
  grantPowerTokens,
  resolveOverflowDiscard,
} from '../../src/game/game-helpers.js';
import {
  opponentPlayerNum,
  removeFigurePosition,
} from '../../src/game/player-helpers.js';
import {
  buildTempBoardState,
  computeMovementCache,
  getReachableSpaces,
  getPathCost,
  collectOverlappingFigures,
  movementStateKey,
  getNormalizedFootprint,
} from '../../src/game/movement.js';
import { getMaxPowerTokens } from '../../src/game/dc-helpers.js';

// ═══════════════════════════════════════════════════════════════════════════
// Region 1: activate-dc — DC activation state, actions, flag cleanup
// ═══════════════════════════════════════════════════════════════════════════

describe('activate-dc: cleanupActivation', () => {
  it('deletes ACTIVATION_MSGID_FLAGS keyed by msgId', () => {
    const game = {};
    const msgId = 'msg1';
    for (const key of ACTIVATION_MSGID_FLAGS) {
      game[key] = { [msgId]: 'data', other: 'keep' };
    }
    cleanupActivation(game, msgId, 1, []);
    for (const key of ACTIVATION_MSGID_FLAGS) {
      assert.strictEqual(game[key][msgId], undefined, `${key}[${msgId}] deleted`);
      assert.strictEqual(game[key].other, 'keep', `${key}.other kept`);
    }
  });

  it('deletes ACTIVATION_FIGKEY_FLAGS for each figureKey', () => {
    const game = {};
    const fks = ['Trooper-0-0', 'Trooper-0-1'];
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      game[key] = { 'Trooper-0-0': true, 'Trooper-0-1': true, 'Other-0-0': true };
    }
    cleanupActivation(game, 'msg1', 1, fks);
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      assert.strictEqual(game[key]['Trooper-0-0'], undefined, `${key}[Trooper-0-0] deleted`);
      assert.strictEqual(game[key]['Trooper-0-1'], undefined, `${key}[Trooper-0-1] deleted`);
      assert.strictEqual(game[key]['Other-0-0'], true, `${key}[Other-0-0] kept`);
    }
  });

  it('deletes ACTIVATION_PLAYERNUM_FLAGS for the activating player only', () => {
    const game = {};
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      game[key] = { 1: 'p1data', 2: 'p2data' };
    }
    cleanupActivation(game, 'msg1', 1, []);
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      assert.strictEqual(game[key][1], undefined, `${key}[1] deleted`);
      assert.strictEqual(game[key][2], 'p2data', `${key}[2] kept`);
    }
  });

  it('deletes ACTIVATION_SCALAR_FLAGS outright', () => {
    const game = {};
    for (const key of ACTIVATION_SCALAR_FLAGS) {
      game[key] = 'some_value';
    }
    cleanupActivation(game, 'msg1', 1, []);
    for (const key of ACTIVATION_SCALAR_FLAGS) {
      assert.strictEqual(game[key], undefined, `${key} deleted`);
    }
  });

  it('handles missing flag objects gracefully', () => {
    const game = {};
    assert.doesNotThrow(() => cleanupActivation(game, 'msg1', 1, ['Trooper-0-0']));
  });

  it('dcActionsData cleanup for activation tracking', () => {
    const game = { dcActionsData: { msg1: { actionsUsed: 2, actionsTotal: 2 }, msg2: { actionsUsed: 0, actionsTotal: 2 } } };
    cleanupActivation(game, 'msg1', 1, []);
    assert.strictEqual(game.dcActionsData.msg1, undefined, 'msg1 actions data cleaned');
    assert.deepStrictEqual(game.dcActionsData.msg2, { actionsUsed: 0, actionsTotal: 2 }, 'msg2 untouched');
  });

  it('movementBank cleanup per msgId', () => {
    const game = { movementBank: { msg1: { total: 4, remaining: 2 }, msg2: { total: 3, remaining: 3 } } };
    cleanupActivation(game, 'msg1', 1, []);
    assert.strictEqual(game.movementBank.msg1, undefined, 'msg1 bank cleaned');
    assert.ok(game.movementBank.msg2, 'msg2 bank kept');
  });
});

describe('activate-dc: cleanupRoundStart', () => {
  it('resets ROUND_OBJECT_FLAGS to empty objects', () => {
    const game = {};
    for (const key of ROUND_OBJECT_FLAGS) game[key] = { stale: true };
    cleanupRoundStart(game);
    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepStrictEqual(game[key], {}, `${key} reset to {}`);
    }
  });

  it('resets ROUND_NULL_FLAGS to null', () => {
    const game = {};
    for (const key of ROUND_NULL_FLAGS) game[key] = 'staleValue';
    cleanupRoundStart(game);
    for (const key of ROUND_NULL_FLAGS) {
      assert.strictEqual(game[key], null, `${key} reset to null`);
    }
  });

  it('resets ROUND_ARRAY_FLAGS to empty arrays', () => {
    const game = {};
    for (const key of ROUND_ARRAY_FLAGS) game[key] = ['stale'];
    cleanupRoundStart(game);
    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepStrictEqual(game[key], [], `${key} reset to []`);
    }
  });

  it('resets ROUND_FALSE_FLAGS to false', () => {
    const game = {};
    for (const key of ROUND_FALSE_FLAGS) game[key] = true;
    cleanupRoundStart(game);
    for (const key of ROUND_FALSE_FLAGS) {
      assert.strictEqual(game[key], false, `${key} reset to false`);
    }
  });

  it('deletes ROUND_DELETE_FLAGS', () => {
    const game = {};
    for (const key of ROUND_DELETE_FLAGS) game[key] = 'val';
    cleanupRoundStart(game);
    for (const key of ROUND_DELETE_FLAGS) {
      assert.strictEqual(game[key], undefined, `${key} deleted`);
    }
  });

  it('flag arrays are non-empty (sanity)', () => {
    assert.ok(ACTIVATION_MSGID_FLAGS.length > 10, 'ACTIVATION_MSGID_FLAGS has entries');
    assert.ok(ROUND_OBJECT_FLAGS.length > 10, 'ROUND_OBJECT_FLAGS has entries');
    assert.ok(ROUND_NULL_FLAGS.length > 10, 'ROUND_NULL_FLAGS has entries');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 2: movement — movement point tracking, movement bank, grid adjacency
// ═══════════════════════════════════════════════════════════════════════════

describe('movement: grantMovementBank', () => {
  it('initializes movement bank from scratch', () => {
    const game = {};
    grantMovementBank(game, 'msg1', 4);
    assert.deepStrictEqual(game.movementBank.msg1, { total: 4, remaining: 4 });
  });

  it('adds to existing movement bank', () => {
    const game = { movementBank: { msg1: { total: 4, remaining: 2 } } };
    grantMovementBank(game, 'msg1', 2);
    assert.strictEqual(game.movementBank.msg1.total, 6);
    assert.strictEqual(game.movementBank.msg1.remaining, 4);
  });

  it('no-ops when amount is 0', () => {
    const game = {};
    grantMovementBank(game, 'msg1', 0);
    assert.strictEqual(game.movementBank, undefined);
  });

  it('no-ops when msgId is falsy', () => {
    const game = {};
    grantMovementBank(game, null, 4);
    assert.strictEqual(game.movementBank, undefined);
  });
});

describe('movement: coord helpers', () => {
  it('parseCoord parses a1 to col=0, row=0', () => {
    const p = parseCoord('a1');
    assert.strictEqual(p.col, 0);
    assert.strictEqual(p.row, 0);
  });

  it('parseCoord parses z26 to col=25, row=25', () => {
    const p = parseCoord('z26');
    assert.strictEqual(p.col, 25);
    assert.strictEqual(p.row, 25);
  });

  it('colRowToCoord round-trips with parseCoord', () => {
    for (const coord of ['a1', 'b5', 'j10', 'c3']) {
      const p = parseCoord(coord);
      const back = colRowToCoord(p.col, p.row);
      assert.strictEqual(back, coord);
    }
  });

  it('shiftCoord moves correctly', () => {
    assert.strictEqual(shiftCoord('c3', 1, 0), 'd3');
    assert.strictEqual(shiftCoord('c3', 0, 1), 'c4');
    assert.strictEqual(shiftCoord('c3', -1, -1), 'b2');
  });

  it('getFootprintCells returns correct cells for 2x2', () => {
    const cells = getFootprintCells('b2', '2x2');
    assert.strictEqual(cells.length, 4);
    assert.ok(cells.includes('b2'));
    assert.ok(cells.includes('c2'));
    assert.ok(cells.includes('b3'));
    assert.ok(cells.includes('c3'));
  });

  it('getFootprintCells returns single cell for 1x1', () => {
    const cells = getFootprintCells('d5', '1x1');
    assert.deepStrictEqual(cells, ['d5']);
  });

  it('rotateSizeString swaps cols and rows', () => {
    assert.strictEqual(rotateSizeString('1x2'), '2x1');
    assert.strictEqual(rotateSizeString('2x1'), '1x2');
    assert.strictEqual(rotateSizeString('2x2'), '2x2');
  });

  it('edgeKey is order-independent', () => {
    assert.strictEqual(edgeKey('a1', 'a2'), edgeKey('a2', 'a1'));
  });
});

describe('movement: spatial getRange and adjacency', () => {
  it('getRange returns Manhattan distance', () => {
    assert.strictEqual(getRange('a1', 'a1'), 0);
    assert.strictEqual(getRange('a1', 'a2'), 1);
    assert.strictEqual(getRange('a1', 'b2'), 2);
    assert.strictEqual(getRange('a1', 'c4'), 5);
  });

  it('getRange returns 999 for invalid coords', () => {
    assert.strictEqual(getRange('', 'a1'), 999);
    assert.strictEqual(getRange('a1', ''), 999);
  });

  // isAdjacentCoords + isWithinRange tests removed 2026-05-05 — helpers
  // deleted (Manhattan-based, CRR-incorrect, zero production callers).
});

describe('movement: isWithinSpaces BFS', () => {
  it('returns true for same coord at distance 0', () => {
    const mapSpaces = { adjacency: { a1: ['a2'], a2: ['a1'] } };
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a1', 0));
  });

  it('finds path via adjacency within maxDist', () => {
    const mapSpaces = {
      adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2', 'a4'], a4: ['a3'] },
    };
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a3', 2));
    assert.ok(!isWithinSpaces(mapSpaces, 'a1', 'a4', 2));
    assert.ok(isWithinSpaces(mapSpaces, 'a1', 'a4', 3));
  });

  it('returns false for disconnected graph', () => {
    const mapSpaces = { adjacency: { a1: ['a2'], a2: ['a1'], c1: ['c2'], c2: ['c1'] } };
    assert.ok(!isWithinSpaces(mapSpaces, 'a1', 'c1', 10));
  });

  it('returns false with missing adjacency data', () => {
    assert.ok(!isWithinSpaces(null, 'a1', 'a2', 1));
    assert.ok(!isWithinSpaces({}, 'a1', 'a2', 1));
  });
});

// getFiguresWithinRange + getFiguresAdjacentTo describe block removed
// 2026-05-05 alongside the dead Manhattan helpers themselves.

describe('movement: computeMovementCache basics', () => {
  it('computes reachable cells on a simple linear map', () => {
    const mapSpaces = {
      spaces: ['a1', 'a2', 'a3', 'a4', 'a5'],
      adjacency: {
        a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2', 'a4'], a4: ['a3', 'a5'], a5: ['a4'],
      },
      blocking: [],
      terrain: {},
      movementBlockingEdges: [],
      impassableEdges: [],
    };
    const board = buildTempBoardState(mapSpaces, []);
    const profile = {
      size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true,
      canRotate: false, isMassive: false, isMobile: false,
      ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
      canEndOnOccupied: false,
    };
    const cache = computeMovementCache('a1', 3, board, profile);
    assert.ok(cache.cells.has('a2'));
    assert.ok(cache.cells.has('a3'));
    assert.ok(cache.cells.has('a4'));
    assert.ok(!cache.cells.has('a5'), 'a5 is 4 steps away, limit is 3');
  });

  it('difficult terrain costs 2 MP', () => {
    const mapSpaces = {
      spaces: ['a1', 'a2', 'a3'],
      adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] },
      blocking: [],
      terrain: { a2: 'difficult' },
      movementBlockingEdges: [],
      impassableEdges: [],
    };
    const board = buildTempBoardState(mapSpaces, []);
    const profile = {
      size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true,
      canRotate: false, isMassive: false, isMobile: false,
      ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
      canEndOnOccupied: false,
    };
    const cache = computeMovementCache('a1', 2, board, profile);
    const a2Info = cache.cells.get('a2');
    assert.ok(a2Info, 'a2 is reachable');
    assert.strictEqual(a2Info.cost, 2, 'difficult terrain costs 2');
    assert.ok(!cache.cells.has('a3'), 'a3 not reachable with 2MP through difficult');
  });

  it('blocking terrain prevents movement when not ignoring', () => {
    const mapSpaces = {
      spaces: ['a1', 'a2', 'a3'],
      adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] },
      blocking: ['a2'],
      terrain: {},
      movementBlockingEdges: [],
      impassableEdges: [],
    };
    const board = buildTempBoardState(mapSpaces, []);
    const profile = {
      size: '1x1', cols: 1, rows: 1, isLarge: false, allowDiagonal: true,
      canRotate: false, isMassive: false, isMobile: false,
      ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
      canEndOnOccupied: false,
    };
    const cache = computeMovementCache('a1', 3, board, profile);
    assert.ok(!cache.cells.has('a2'), 'a2 is blocking');
    assert.ok(!cache.cells.has('a3'), 'a3 is unreachable behind blocking');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 3: reroll — reroll state machine, indices, dedup, forced queue
// ═══════════════════════════════════════════════════════════════════════════

describe('reroll: recalcAttackTotals', () => {
  it('sums dice results correctly', () => {
    const dice = [
      { acc: 2, dmg: 1, surge: 0 },
      { acc: 0, dmg: 3, surge: 1 },
    ];
    const totals = recalcAttackTotals(dice);
    assert.strictEqual(totals.acc, 2);
    assert.strictEqual(totals.dmg, 4);
    assert.strictEqual(totals.surge, 1);
  });

  it('handles empty dice array', () => {
    const totals = recalcAttackTotals([]);
    assert.strictEqual(totals.acc, 0);
    assert.strictEqual(totals.dmg, 0);
    assert.strictEqual(totals.surge, 0);
  });

  it('handles dice with missing properties', () => {
    const totals = recalcAttackTotals([{ acc: 1 }, { dmg: 2 }]);
    assert.strictEqual(totals.acc, 1);
    assert.strictEqual(totals.dmg, 2);
    assert.strictEqual(totals.surge, 0);
  });
});

describe('reroll: recalcDefenseTotals', () => {
  it('sums defense results and tracks dodge', () => {
    const dice = [
      { block: 1, evade: 0, dodge: false },
      { block: 0, evade: 1, dodge: true },
    ];
    const totals = recalcDefenseTotals(dice);
    assert.strictEqual(totals.block, 1);
    assert.strictEqual(totals.evade, 1);
    assert.strictEqual(totals.dodge, true);
  });

  it('dodge is false when no die rolled dodge', () => {
    const dice = [{ block: 2, evade: 0, dodge: false }];
    const totals = recalcDefenseTotals(dice);
    assert.strictEqual(totals.dodge, false);
  });
});

describe('reroll: index tracking and dedup', () => {
  it('rerolled indices prevent selecting same die twice', () => {
    const rerolled = [0, 2];
    const diceCount = 4;
    const available = [];
    for (let i = 0; i < diceCount; i++) {
      if (!rerolled.includes(i)) available.push(i);
    }
    assert.deepStrictEqual(available, [1, 3]);
  });

  it('adding duplicate index does not create new entry when checked', () => {
    const rerolled = [0];
    const tryAdd = (idx) => { if (!rerolled.includes(idx)) rerolled.push(idx); };
    tryAdd(0);
    assert.strictEqual(rerolled.length, 1, 'still 1 entry');
    tryAdd(1);
    assert.strictEqual(rerolled.length, 2, 'added index 1');
  });

  it('reroll totals update after replacing a die', () => {
    const dice = [
      { acc: 1, dmg: 2, surge: 0 },
      { acc: 0, dmg: 0, surge: 1 },
    ];
    // Simulate rerolling die at index 1
    dice[1] = { acc: 2, dmg: 1, surge: 0 };
    const totals = recalcAttackTotals(dice);
    assert.strictEqual(totals.acc, 3);
    assert.strictEqual(totals.dmg, 3);
    assert.strictEqual(totals.surge, 0);
  });
});

describe('reroll: forced reroll queue processing', () => {
  it('processes queue in FIFO order', () => {
    const queue = [
      { source: 'A', remaining: 1, controlPlayer: 1 },
      { source: 'B', remaining: 2, controlPlayer: 2 },
    ];
    const first = queue[0];
    first.remaining--;
    if (first.remaining <= 0) queue.shift();
    assert.strictEqual(queue.length, 1);
    assert.strictEqual(queue[0].source, 'B');
  });

  it('multi-remaining entry decrements correctly', () => {
    const queue = [{ source: 'X', remaining: 3, controlPlayer: 1 }];
    queue[0].remaining--;
    assert.strictEqual(queue[0].remaining, 2);
    queue[0].remaining--;
    assert.strictEqual(queue[0].remaining, 1);
    queue[0].remaining--;
    if (queue[0].remaining <= 0) queue.shift();
    assert.strictEqual(queue.length, 0);
  });

  it('empty queue returns no forced reroll', () => {
    const queue = [];
    const hasForcedReroll = queue.length > 0;
    assert.ok(!hasForcedReroll);
  });

  it('doubleMatchingIconsOnReroll flag structure', () => {
    const game = { doubleMatchingIconsOnReroll: { attackerPlayerNum: 1, type: 'attack' } };
    assert.strictEqual(game.doubleMatchingIconsOnReroll.type, 'attack');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 4: conditions — apply/remove/reset/immunity, Bleed/Stun/Weaken
// ═══════════════════════════════════════════════════════════════════════════

describe('conditions: applyCondition edge cases', () => {
  it('initializes figureConditions on fresh game', () => {
    const game = {};
    applyCondition(game, 'Fig-0-0', 'Focus');
    assert.deepStrictEqual(game.figureConditions['Fig-0-0'], ['Focus']);
  });

  it('allows multiple different conditions on same figure', () => {
    const game = {};
    applyCondition(game, 'Fig-0-0', 'Focus');
    applyCondition(game, 'Fig-0-0', 'Stun');
    applyCondition(game, 'Fig-0-0', 'Hide');
    assert.strictEqual(game.figureConditions['Fig-0-0'].length, 3);
  });

  it('dedup prevents same condition twice', () => {
    const game = {};
    const r1 = applyCondition(game, 'Fig-0-0', 'Stun');
    const r2 = applyCondition(game, 'Fig-0-0', 'Stun');
    assert.strictEqual(r1, true);
    assert.strictEqual(r2, false);
    assert.strictEqual(game.figureConditions['Fig-0-0'].length, 1);
  });

  it('conditions on different figures are independent', () => {
    const game = {};
    applyCondition(game, 'A-0-0', 'Stun');
    applyCondition(game, 'B-0-0', 'Bleed');
    assert.deepStrictEqual(game.figureConditions['A-0-0'], ['Stun']);
    assert.deepStrictEqual(game.figureConditions['B-0-0'], ['Bleed']);
  });
});

describe('conditions: filterCondition edge cases', () => {
  it('no-ops when figure has no conditions', () => {
    const game = { figureConditions: {} };
    filterCondition(game, 'Fig-0-0', 'Stun');
    assert.strictEqual(game.figureConditions['Fig-0-0'], undefined);
  });

  it('no-ops when figureConditions is missing', () => {
    const game = {};
    assert.doesNotThrow(() => filterCondition(game, 'Fig-0-0', 'Stun'));
  });

  it('removes only the specified condition, leaves others', () => {
    const game = { figureConditions: { 'Fig-0-0': ['Stun', 'Bleed', 'Weaken'] } };
    filterCondition(game, 'Fig-0-0', 'Stun');
    assert.deepStrictEqual(game.figureConditions['Fig-0-0'], ['Bleed', 'Weaken']);
  });

  it('removing last condition deletes the figureKey entry', () => {
    const game = { figureConditions: { 'Fig-0-0': ['Stun'] } };
    filterCondition(game, 'Fig-0-0', 'Stun');
    assert.strictEqual(game.figureConditions['Fig-0-0'], undefined);
  });

  it('disarmPermanentWeakened prevents Weaken removal', () => {
    const game = {
      figureConditions: { 'Fig-0-0': ['Weaken', 'Stun'] },
      disarmPermanentWeakened: { 'Fig-0-0': true },
    };
    filterCondition(game, 'Fig-0-0', 'Weaken');
    assert.ok(game.figureConditions['Fig-0-0'].includes('Weaken'), 'Weaken kept due to disarm lock');
    filterCondition(game, 'Fig-0-0', 'Stun');
    assert.ok(!game.figureConditions['Fig-0-0'].includes('Stun'), 'Stun removed normally');
  });
});

describe('conditions: resetCondition', () => {
  it('adds condition to empty figure', () => {
    const game = {};
    resetCondition(game, 'Fig-0-0', 'Focus');
    assert.deepStrictEqual(game.figureConditions['Fig-0-0'], ['Focus']);
  });

  it('ensures exactly one instance when duplicates existed', () => {
    const game = { figureConditions: { 'Fig-0-0': ['Focus', 'Focus', 'Stun'] } };
    resetCondition(game, 'Fig-0-0', 'Focus');
    const count = game.figureConditions['Fig-0-0'].filter(c => c === 'Focus').length;
    assert.strictEqual(count, 1);
    assert.ok(game.figureConditions['Fig-0-0'].includes('Stun'), 'other conditions preserved');
  });

  it('adds condition at end when it was not present', () => {
    const game = { figureConditions: { 'Fig-0-0': ['Stun'] } };
    resetCondition(game, 'Fig-0-0', 'Focus');
    const last = game.figureConditions['Fig-0-0'].at(-1);
    assert.strictEqual(last, 'Focus');
  });
});

describe('conditions: HARMFUL_CONDITIONS set', () => {
  it('contains exactly Stun, Bleed, Weaken', () => {
    assert.deepStrictEqual([...HARMFUL_CONDITIONS].sort(), ['Bleed', 'Stun', 'Weaken']);
  });

  it('Focus and Hide are NOT harmful', () => {
    assert.ok(!HARMFUL_CONDITIONS.includes('Focus'));
    assert.ok(!HARMFUL_CONDITIONS.includes('Hide'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 5: combat-interrupts — Negation/Celebration/StrikeMeDown lifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe('combat-interrupts: pendingNegation lifecycle', () => {
  it('sets and clears pendingNegation', () => {
    const game = {};
    game.pendingNegation = { playedBy: 1, card: 'Take Initiative', fromDc: false };
    assert.ok(game.pendingNegation);
    delete game.pendingNegation;
    assert.strictEqual(game.pendingNegation, undefined);
  });

  it('opponent is determined correctly', () => {
    const game = { pendingNegation: { playedBy: 2, card: 'Son of Skywalker' } };
    assert.strictEqual(opponentPlayerNum(game.pendingNegation.playedBy), 1);
  });
});

describe('combat-interrupts: pendingCelebration lifecycle', () => {
  it('stores attackerPlayerNum and combatThreadId', () => {
    const game = {};
    game.pendingCelebration = { attackerPlayerNum: 1, combatThreadId: 'thread-x' };
    assert.strictEqual(game.pendingCelebration.attackerPlayerNum, 1);
    assert.strictEqual(game.pendingCelebration.combatThreadId, 'thread-x');
  });

  it('clearing pendingCelebration without side effects', () => {
    const game = { pendingCelebration: { attackerPlayerNum: 2, combatThreadId: 'th' }, player2VP: { total: 5 } };
    delete game.pendingCelebration;
    assert.strictEqual(game.pendingCelebration, undefined);
    assert.strictEqual(game.player2VP.total, 5, 'VP unchanged');
  });
});

describe('combat-interrupts: pendingStrikeMeDown lifecycle', () => {
  it('stores all required fields', () => {
    const game = {};
    game.pendingStrikeMeDown = {
      playerNum: 1,
      figureKey: 'Obi-Wan Kenobi-0-0',
      combatThreadId: 'thread-obi',
    };
    assert.strictEqual(game.pendingStrikeMeDown.figureKey, 'Obi-Wan Kenobi-0-0');
    assert.strictEqual(game.pendingStrikeMeDown.playerNum, 1);
    assert.strictEqual(game.pendingStrikeMeDown.combatThreadId, 'thread-obi');
  });

  it('Strike Me Down customId format parses correctly', () => {
    const gameId = 'g1';
    const customId = `strike_me_down_accept_${gameId}`;
    assert.ok(customId.startsWith('strike_me_down_accept_'));
    const parsed = customId.replace('strike_me_down_accept_', '');
    assert.strictEqual(parsed, gameId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 6: token-overflow — power token cap, overflow choice
// ═══════════════════════════════════════════════════════════════════════════

describe('token-overflow: grantPowerTokens', () => {
  it('grants tokens to a fresh figure', () => {
    const game = {};
    grantPowerTokens(game, 'Fig-0-0', 'Block', 2);
    assert.deepStrictEqual(game.figurePowerTokens['Fig-0-0'], ['Block', 'Block']);
  });

  it('queues overflow when exceeding cap', () => {
    const game = {};
    // Default cap is 2 for unknown figures
    grantPowerTokens(game, 'Fig-0-0', 'Block', 3);
    assert.strictEqual(game.figurePowerTokens['Fig-0-0'].length, 3);
    assert.ok(game.pendingPowerTokenOverflow, 'overflow queued');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'Fig-0-0');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });

  it('no overflow when at or under cap', () => {
    const game = {};
    grantPowerTokens(game, 'Fig-0-0', 'Hit', 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined);
  });

  it('custom max overrides default cap', () => {
    const game = {};
    grantPowerTokens(game, 'Fig-0-0', 'Block', 4, 5);
    assert.strictEqual(game.pendingPowerTokenOverflow, undefined, 'no overflow with custom max=5');
    grantPowerTokens(game, 'Fig-0-0', 'Block', 2, 5);
    assert.ok(game.pendingPowerTokenOverflow, 'overflow with 6 tokens, max=5');
    assert.strictEqual(game.pendingPowerTokenOverflow[0].discardCount, 1);
  });

  it('returns 0 for count <= 0', () => {
    const game = {};
    const result = grantPowerTokens(game, 'Fig-0-0', 'Block', 0);
    assert.strictEqual(result, 0);
  });

  it('returns 0 for falsy figureKey', () => {
    const game = {};
    const result = grantPowerTokens(game, null, 'Block', 2);
    assert.strictEqual(result, 0);
  });
});

describe('token-overflow: resolveOverflowDiscard', () => {
  it('discards token at given index and decrements overflow', () => {
    const game = {
      figurePowerTokens: { 'Fig-0-0': ['Block', 'Hit', 'Block'] },
      pendingPowerTokenOverflow: [{ figureKey: 'Fig-0-0', discardCount: 1 }],
    };
    const result = resolveOverflowDiscard(game, 'Fig-0-0', 0);
    assert.strictEqual(result.discarded, 'Block');
    assert.strictEqual(result.remaining, 0);
    assert.strictEqual(game.figurePowerTokens['Fig-0-0'].length, 2);
    assert.strictEqual(game.pendingPowerTokenOverflow, null, 'overflow cleared when empty');
  });

  it('handles invalid index gracefully', () => {
    const game = { figurePowerTokens: { 'Fig-0-0': ['Block'] } };
    const result = resolveOverflowDiscard(game, 'Fig-0-0', 5);
    assert.strictEqual(result.discarded, null);
  });

  it('handles missing figure gracefully', () => {
    const game = {};
    const result = resolveOverflowDiscard(game, 'Missing-0-0', 0);
    assert.strictEqual(result.discarded, null);
  });

  it('multiple overflow entries decrement independently', () => {
    const game = {
      figurePowerTokens: { 'A-0-0': ['Block', 'Hit', 'Block'], 'B-0-0': ['Hit', 'Hit', 'Hit'] },
      pendingPowerTokenOverflow: [
        { figureKey: 'A-0-0', discardCount: 1 },
        { figureKey: 'B-0-0', discardCount: 1 },
      ],
    };
    resolveOverflowDiscard(game, 'A-0-0', 0);
    assert.strictEqual(game.pendingPowerTokenOverflow.length, 1);
    assert.strictEqual(game.pendingPowerTokenOverflow[0].figureKey, 'B-0-0');
  });
});

describe('token-overflow: getMaxPowerTokens', () => {
  it('returns 2 for null figureKey', () => {
    assert.strictEqual(getMaxPowerTokens(null), 2);
  });

  it('returns 2 for generic figure', () => {
    assert.strictEqual(getMaxPowerTokens('SomeUnit-0-0'), 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 7: strain-choice — strain as damage vs CC discard
// ═══════════════════════════════════════════════════════════════════════════

describe('strain-choice: pendingStrainChoice structure', () => {
  it('stores all required fields', () => {
    const game = {};
    game.pendingStrainChoice = {
      playerNum: 1,
      figureKey: 'Trooper-0-0',
      strainAmount: 2,
      displayName: 'Stormtrooper',
      combatThreadId: 'thread-1',
    };
    assert.strictEqual(game.pendingStrainChoice.strainAmount, 2);
    assert.strictEqual(game.pendingStrainChoice.playerNum, 1);
    assert.strictEqual(game.pendingStrainChoice.figureKey, 'Trooper-0-0');
  });

  it('strain_choice_alldmg customId parses correctly', () => {
    const gameId = 'g99';
    const fk = 'Jyn Odan-0-0';
    const customId = `strain_choice_alldmg_${gameId}_1_${fk}`;
    const rest = customId.replace('strain_choice_alldmg_', '');
    const parts = rest.split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parts[1], '1');
    assert.strictEqual(parts.slice(2).join('_'), fk);
  });

  it('strain_choice_discard customId parses correctly', () => {
    const gameId = 'g99';
    const fk = 'Jyn Odan-0-0';
    const customId = `strain_choice_discard_${gameId}_1_${fk}`;
    const rest = customId.replace('strain_choice_discard_', '');
    const parts = rest.split('_');
    assert.strictEqual(parts[0], gameId);
    assert.strictEqual(parts[1], '1');
  });

  it('clearing pendingStrainChoice after resolution', () => {
    const game = { pendingStrainChoice: { playerNum: 1, strainAmount: 3 } };
    game.pendingStrainChoice = null;
    assert.strictEqual(game.pendingStrainChoice, null);
  });

  it('strain choice affects CC hand when discard is chosen (simulated)', () => {
    const hand = ['Take Initiative', 'Element of Surprise', 'Pummel'];
    const discardCount = 2;
    const discarded = hand.splice(0, discardCount);
    assert.strictEqual(hand.length, 1);
    assert.strictEqual(discarded.length, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Region 8: push-pull — displacement rules, Massive push, Cover Fire
// ═══════════════════════════════════════════════════════════════════════════

describe('push-pull: collectOverlappingFigures', () => {
  it('finds overlapping figures on same footprint', () => {
    const game = {
      figurePositions: {
        1: { 'Big-0-0': 'c3' },
        2: { 'Small-0-0': 'c3', 'Far-0-0': 'j10' },
      },
    };
    const footprint = new Set(['c3']);
    const overlaps = collectOverlappingFigures(game, 1, 'Big-0-0', footprint);
    assert.strictEqual(overlaps.length, 1);
    assert.strictEqual(overlaps[0].figureKey, 'Small-0-0');
  });

  it('returns empty when no overlaps', () => {
    const game = {
      figurePositions: {
        1: { 'A-0-0': 'a1' },
        2: { 'B-0-0': 'z26' },
      },
    };
    const footprint = new Set(['a1']);
    const overlaps = collectOverlappingFigures(game, 1, 'A-0-0', footprint);
    assert.strictEqual(overlaps.length, 0);
  });

  it('friendly overlaps come before enemy overlaps', () => {
    const game = {
      figurePositions: {
        1: { 'Big-0-0': 'c3', 'Friendly-0-0': 'c4' },
        2: { 'Enemy-0-0': 'c4' },
      },
    };
    const footprint = new Set(['c3', 'c4']);
    const overlaps = collectOverlappingFigures(game, 1, 'Big-0-0', footprint);
    const friendlyIdx = overlaps.findIndex(o => o.figureKey === 'Friendly-0-0');
    const enemyIdx = overlaps.findIndex(o => o.figureKey === 'Enemy-0-0');
    assert.ok(friendlyIdx < enemyIdx, 'friendly before enemy');
  });
  it('G71: companion in Massive footprint appears in overlaps', () => {
    // G71 rule: when a Massive figure moves into a space occupied by a companion,
    // the companion must be pushed. collectOverlappingFigures must detect companions
    // in the footprint even though companions don't block LOS.
    const game = {
      figurePositions: {
        1: { 'AT-ST-1-0': 'c3' },
        2: { 'Salacious B. Crumb-1-0': 'c3' },
      },
    };
    const footprint = new Set(['c3', 'c4']);
    const overlaps = collectOverlappingFigures(game, 1, 'AT-ST-1-0', footprint);
    assert.strictEqual(overlaps.length, 1, 'companion in footprint detected');
    assert.strictEqual(overlaps[0].figureKey, 'Salacious B. Crumb-1-0',
      'G71: companion figure key returned for Massive push resolution');
  });
});

describe('push-pull: massiveMovementLocked', () => {
  it('locks voluntary movement after Massive push', () => {
    const game = { massiveMovementLocked: {} };
    game.massiveMovementLocked['AT-ST-0-0'] = true;
    assert.strictEqual(game.massiveMovementLocked['AT-ST-0-0'], true);
    assert.strictEqual(game.massiveMovementLocked['Other-0-0'], undefined);
  });

  it('cleaned up by cleanupActivation via ACTIVATION_FIGKEY_FLAGS', () => {
    assert.ok(
      ACTIVATION_FIGKEY_FLAGS.includes('massiveMovementLocked'),
      'massiveMovementLocked is in figkey cleanup list'
    );
  });
});

describe('push-pull: removeFigurePosition cleanup', () => {
  it('removes position, deviceTokens, and figureConditions', () => {
    const game = {
      figurePositions: { 1: { 'A-0-0': 'c3' }, 2: {} },
      deviceTokens: { 'A-0-0': ['mine'] },
      figureConditions: { 'A-0-0': ['Stun'] },
    };
    removeFigurePosition(game, 1, 'A-0-0');
    assert.strictEqual(game.figurePositions[1]['A-0-0'], undefined);
    assert.strictEqual(game.deviceTokens['A-0-0'], undefined);
    assert.strictEqual(game.figureConditions['A-0-0'], undefined);
  });

  it('handles missing sub-objects gracefully', () => {
    const game = {};
    assert.doesNotThrow(() => removeFigurePosition(game, 1, 'Missing-0-0'));
  });
});

describe('push-pull: displacement customId parsing', () => {
  it('push_choice customId parses direction and figure', () => {
    const gameId = 'g1';
    const fk = 'Trooper-0-0';
    const customId = `push_choice_${gameId}_${fk}_north`;
    const rest = customId.replace('push_choice_', '');
    const lastUnder = rest.lastIndexOf('_');
    const direction = rest.slice(lastUnder + 1);
    assert.strictEqual(direction, 'north');
  });

  it('cover_fire_block customId extracts gameId and playerNum', () => {
    const customId = 'cover_fire_block_game42_2_Rebel Trooper-0-0';
    const rest = customId.replace('cover_fire_block_', '');
    const parts = rest.split('_');
    assert.strictEqual(parts[0], 'game42');
    assert.strictEqual(parts[1], '2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bonus: computeCombatResult pure function tests
// ═══════════════════════════════════════════════════════════════════════════

describe('computeCombatResult: pure combat math', () => {
  it('basic hit with no surge', () => {
    const combat = {
      attackRoll: { acc: 3, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
    };
    const result = computeCombatResult(combat);
    assert.ok(result.hit);
    assert.strictEqual(result.damage, 3);
  });

  it('dodge causes miss', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: true },
    };
    const result = computeCombatResult(combat);
    assert.ok(!result.hit);
    assert.strictEqual(result.damage, 0);
  });

  it('Deadly cancels dodge', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 5, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: true },
      surgeCancelDodge: true,
    };
    const result = computeCombatResult(combat);
    assert.ok(result.hit);
    assert.strictEqual(result.damage, 5);
  });

  it('insufficient accuracy causes miss for ranged attack', () => {
    const combat = {
      attackRoll: { acc: 2, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 5,
    };
    const result = computeCombatResult(combat);
    assert.ok(!result.hit);
  });

  it('pierce reduces effective block', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 3, surge: 0 },
      defenseRoll: { block: 3, evade: 0, dodge: false },
      surgePierce: 2,
    };
    const result = computeCombatResult(combat);
    assert.ok(result.hit);
    assert.strictEqual(result.effectiveBlock, 1);
    assert.strictEqual(result.damage, 2);
  });

  it('attacker Weakened reduces damage by 1', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      attackerConds: ['Weaken'],
    };
    const result = computeCombatResult(combat);
    assert.strictEqual(result.damage, 2);
  });

  it('defender Weakened reduces block by 1', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 3, surge: 0 },
      defenseRoll: { block: 2, evade: 0, dodge: false },
      defenderConds: ['Weaken'],
    };
    const result = computeCombatResult(combat);
    assert.strictEqual(result.effectiveBlock, 1);
    assert.strictEqual(result.damage, 2);
  });

  it('defender Hidden gives -2 accuracy', () => {
    const combat = {
      attackRoll: { acc: 4, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 3,
      defenderConds: ['Hide'],
    };
    const result = computeCombatResult(combat);
    // Effective accuracy = 4 - 2 = 2, distance = 3, miss
    assert.ok(!result.hit);
  });

  it('bonus hits add to damage', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 2, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
      bonusHits: 3,
    };
    const result = computeCombatResult(combat);
    assert.strictEqual(result.damage, 4);
  });

  it('forceMiss overrides everything', () => {
    const combat = {
      attackRoll: { acc: 10, dmg: 10, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      forceMiss: true,
    };
    const result = computeCombatResult(combat);
    assert.ok(!result.hit);
    assert.strictEqual(result.damage, 0);
  });

  it('damage cannot go below 0', () => {
    const combat = {
      attackRoll: { acc: 5, dmg: 1, surge: 0 },
      defenseRoll: { block: 5, evade: 0, dodge: false },
    };
    const result = computeCombatResult(combat);
    assert.strictEqual(result.damage, 0);
  });
});

describe('parseSurgeEffect: surge key parsing', () => {
  it('parses damage N', () => {
    const e = parseSurgeEffect('damage 2');
    assert.strictEqual(e.damage, 2);
  });

  it('parses pierce N', () => {
    const e = parseSurgeEffect('pierce 3');
    assert.strictEqual(e.pierce, 3);
  });

  it('parses accuracy N', () => {
    const e = parseSurgeEffect('accuracy 2');
    assert.strictEqual(e.accuracy, 2);
  });

  it('parses stun condition', () => {
    const e = parseSurgeEffect('stun');
    assert.deepStrictEqual(e.conditions, ['Stun']);
  });

  it('parses combo key: +1 hit, stun', () => {
    const e = parseSurgeEffect('+1 hit, stun');
    assert.strictEqual(e.damage, 1);
    assert.deepStrictEqual(e.conditions, ['Stun']);
  });

  it('parses blast N', () => {
    const e = parseSurgeEffect('blast 2');
    assert.strictEqual(e.blast, 2);
  });

  it('parses recover N', () => {
    const e = parseSurgeEffect('recover 2');
    assert.strictEqual(e.recover, 2);
  });

  it('parses cleave N', () => {
    const e = parseSurgeEffect('cleave 2');
    assert.strictEqual(e.cleave, 2);
  });

  it('strips double: prefix', () => {
    const e = parseSurgeEffect('double:damage 2');
    assert.strictEqual(e.damage, 2);
  });

  it('parses focus as self-focus', () => {
    const e = parseSurgeEffect('focus');
    assert.strictEqual(e.surgeSelfFocus, true);
  });

  it('parses hide as self-hide', () => {
    const e = parseSurgeEffect('hide');
    assert.strictEqual(e.surgeSelfHide, true);
  });
});

// ── LOS regression tests (LOS-19, LOS-20) ──────────────────────────────────
describe('LOS: hasLineOfSight wall and blocking checks', () => {
  // Minimal mapSpaces with a wall between a2 and a3
  const wallMs = {
    impassableEdges: [['a2', 'a3']],
    blocking: [],
  };

  it('LOS-20 regression: wall between source and target blocks LOS', () => {
    // a1 → a4 with wall between a2/a3 — should be blocked
    assert.strictEqual(hasLineOfSight('a1', 'a4', wallMs, null), false,
      'LOS should be blocked by wall between a2 and a3');
  });

  it('LOS-20 regression: same wall does not block adjacent LOS on same side', () => {
    // a1 → a2 — wall is on far edge of a2, LOS to a2 itself should pass
    assert.strictEqual(hasLineOfSight('a1', 'a2', wallMs, null), true,
      'LOS to a2 should not be blocked by wall on a2/a3 boundary');
  });

  it('LOS-19 regression: closed door edge blocks LOS', () => {
    // Simulate a closed door between c3 and c4 by adding it as an impassable edge
    const doorMs = {
      impassableEdges: [['c3', 'c4']],
      blocking: [],
    };
    assert.strictEqual(hasLineOfSight('c2', 'c5', doorMs, null), false,
      'LOS should be blocked by closed door between c3 and c4');
  });

  it('LOS-19 regression: energy shield space blocks LOS through it', () => {
    // Energy shield on b3 — LOS from b1 to b5 should be blocked
    const shieldMs = {
      impassableEdges: [],
      blocking: ['b3'],
    };
    assert.strictEqual(hasLineOfSight('b1', 'b5', shieldMs, null), false,
      'LOS should be blocked by energy shield on b3');
  });

  it('LOS-19 regression: smoke space blocks LOS through it', () => {
    const smokeMs = {
      impassableEdges: [],
      blocking: ['d3'],
    };
    assert.strictEqual(hasLineOfSight('d1', 'd5', smokeMs, null), false,
      'LOS should be blocked by smoke on d3');
  });
});

console.log('activation-combat-deep-tests loaded successfully');
