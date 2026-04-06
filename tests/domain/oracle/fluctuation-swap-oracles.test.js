/**
 * Oracle tests for Lothal Wastes B — Fluctuations swap mechanic.
 *
 * Rules:
 *   EOR: Each player gains 1 VP per controlled fluctuation.
 *        Figures on fluctuations gain color-matched power tokens.
 *        Then, in initiative order, each player may swap 1 fluctuation with another.
 *        A fluctuation cannot be moved twice in the same round.
 *
 * These tests cover:
 *   - getCurrentFluctuationPositions lazy init + persistence
 *   - VP scoring uses canonical (potentially swapped) positions
 *   - Swap mechanics (coordinate exchange between token type arrays)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentFluctuationPositions, runEndOfRoundRules } from '../../../src/game/mission-rules.js';

const MAP_ID = 'lothal-wastes';
const VARIANT = 'b';

const EOR_RULES = {
  vpPerControlledFluctuation: {
    vp: 1,
    grantPowerToken: true,
    vpMessage: 'fluctuations controlled ({count} × 1 VP)',
  },
};

/** Minimal fake map-tokens data matching Lothal Wastes B layout. */
function fakeMapTokensData() {
  return {
    [MAP_ID]: {
      missionB: {
        tokenTypes: [
          { id: '0', label: 'Fluctuation', image: 'Mission Token--Neutral Yellow.gif' },
          { id: '1', label: 'Fluctuation', image: 'Mission Token--Neutral Blue.gif' },
          { id: '2', label: 'Fluctuation', image: 'Mission Token--Neutral Blue.gif' },
          { id: '3', label: 'Fluctuation', image: 'Mission Token--Neutral Green.gif' },
          { id: '4', label: 'Fluctuation', image: 'Mission Token--Neutral Red.gif' },
        ],
        positions: {
          '0': ['j10', 'p10'],
          '1': [],
          '2': ['h21', 't21'],
          '3': ['i16', 'q16'],
          '4': ['l7', 'o7'],
        },
      },
    },
  };
}

function noopCtx() {
  return {
    logGameAction: async () => {},
    client: null,
    getMapTokensData: fakeMapTokensData,
    checkWinConditions: async () => {},
    getSpaceController: () => null,
    isFigureInDeploymentZone: () => false,
    getFiguresOnOrAdjacentToSpace: () => [],
  };
}

function buildGame(p1Positions = {}, p2Positions = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    figurePositions: { 1: p1Positions, 2: p2Positions },
    figurePowerTokens: {},
    ended: false,
  };
}

// ── getCurrentFluctuationPositions ──────────────────────────────────────────

describe('ORACLE-FLUCT-001: getCurrentFluctuationPositions lazy init', () => {
  it('001a: initializes game.fluctuationPositions from static JSON on first call', () => {
    const game = {};
    const positions = getCurrentFluctuationPositions(game, MAP_ID, fakeMapTokensData);
    // Should have been written to game
    assert.ok(game.fluctuationPositions, 'Should set game.fluctuationPositions');
    assert.deepStrictEqual(game.fluctuationPositions, positions, 'Return value should be game.fluctuationPositions');
    // Verify contents match static data
    assert.deepStrictEqual(positions['0'], ['j10', 'p10']);
    assert.deepStrictEqual(positions['1'], []);
    assert.deepStrictEqual(positions['2'], ['h21', 't21']);
    assert.deepStrictEqual(positions['3'], ['i16', 'q16']);
    assert.deepStrictEqual(positions['4'], ['l7', 'o7']);
  });

  it('001b: returns existing game.fluctuationPositions without re-reading static data', () => {
    const swapped = { '0': ['l7', 'p10'], '4': ['j10', 'o7'] };
    const game = { fluctuationPositions: swapped };
    const positions = getCurrentFluctuationPositions(game, MAP_ID, fakeMapTokensData);
    assert.strictEqual(positions, swapped, 'Should return the existing object, not a new copy');
    assert.deepStrictEqual(positions['0'], ['l7', 'p10'], 'Swapped positions preserved');
  });
});

// ── VP scoring with swapped positions ───────────────────────────────────────

describe('ORACLE-FLUCT-002: VP scoring uses canonical (swapped) positions', () => {
  it('002a: VP scored at original positions when no swap occurred', async () => {
    // P1 controls j10 (Yellow), P2 controls i16 (Green)
    const game = buildGame(
      { 'Stormtrooper-1-0': 'j10' },
      { 'Luke Skywalker-1-0': 'i16' },
    );
    const ctx = {
      ...noopCtx(),
      getSpaceController: (_game, _mapId, coord) => {
        if (coord === 'j10') return 1;
        if (coord === 'i16') return 2;
        return null;
      },
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    assert.equal(game.player1VP.objectives, 1, 'P1 gets 1 VP for j10');
    assert.equal(game.player2VP.objectives, 1, 'P2 gets 1 VP for i16');
  });

  it('002b: VP scored at swapped positions after swap', async () => {
    // Swap: Yellow j10 ↔ Red l7 (j10 now has Red token, l7 now has Yellow)
    const game = buildGame(
      { 'Stormtrooper-1-0': 'l7' },  // P1 figure at l7 (now Yellow after swap)
      {},
    );
    // Pre-set swapped positions
    game.fluctuationPositions = {
      '0': ['l7', 'p10'],   // Yellow moved from j10 → l7
      '1': [],
      '2': ['h21', 't21'],
      '3': ['i16', 'q16'],
      '4': ['j10', 'o7'],   // Red moved from l7 → j10
    };
    const ctx = {
      ...noopCtx(),
      getSpaceController: (_game, _mapId, coord) => {
        // P1 controls l7 (now Yellow)
        if (coord === 'l7') return 1;
        return null;
      },
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    assert.equal(game.player1VP.objectives, 1, 'P1 gets 1 VP for controlling l7 (now Yellow)');
    // Power token: figure on l7 gets Surge (Yellow → Surge)
    const tokens = game.figurePowerTokens?.['Stormtrooper-1-0'] || [];
    assert.ok(tokens.includes('Surge'), `Figure on Yellow fluctuation should get Surge token, got: ${tokens}`);
  });

  it('002c: power tokens match swapped color, not original', async () => {
    // j10 originally had Yellow. After swap, j10 has Red.
    const game = buildGame(
      { 'Stormtrooper-1-0': 'j10' },  // P1 figure at j10 (now Red after swap)
      {},
    );
    game.fluctuationPositions = {
      '0': ['l7', 'p10'],   // Yellow moved from j10 → l7
      '1': [],
      '2': ['h21', 't21'],
      '3': ['i16', 'q16'],
      '4': ['j10', 'o7'],   // Red moved from l7 → j10
    };
    const ctx = {
      ...noopCtx(),
      getSpaceController: (_game, _mapId, coord) => {
        if (coord === 'j10') return 1;
        return null;
      },
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    // Power token: figure on j10 gets Damage (Red → Damage), NOT Surge (Yellow)
    const tokens = game.figurePowerTokens?.['Stormtrooper-1-0'] || [];
    assert.ok(tokens.includes('Damage'), `Figure on Red fluctuation (swapped to j10) should get Damage token, got: ${tokens}`);
    assert.ok(!tokens.includes('Surge'), 'Should NOT get Surge (Yellow was swapped away from j10)');
  });
});

// ── Swap mechanic correctness ───────────────────────────────────────────────

describe('ORACLE-FLUCT-003: Swap mechanic coordinate exchange', () => {
  it('003a: swapping two fluctuations exchanges their coords in the positions object', () => {
    const game = {};
    const positions = getCurrentFluctuationPositions(game, MAP_ID, fakeMapTokensData);

    // Before swap: Yellow at j10, Red at l7
    assert.ok(positions['0'].includes('j10'), 'Yellow has j10 before swap');
    assert.ok(positions['4'].includes('l7'), 'Red has l7 before swap');

    // Execute swap: j10 ↔ l7
    const sourceIdx = positions['0'].indexOf('j10');
    const targetIdx = positions['4'].indexOf('l7');
    positions['0'][sourceIdx] = 'l7';
    positions['4'][targetIdx] = 'j10';

    // After swap: Yellow at l7, Red at j10
    assert.ok(positions['0'].includes('l7'), 'Yellow has l7 after swap');
    assert.ok(!positions['0'].includes('j10'), 'Yellow no longer at j10');
    assert.ok(positions['4'].includes('j10'), 'Red has j10 after swap');
    assert.ok(!positions['4'].includes('l7'), 'Red no longer at l7');
    // Other positions unchanged
    assert.deepStrictEqual(positions['2'], ['h21', 't21'], 'Blue unchanged');
    assert.deepStrictEqual(positions['3'], ['i16', 'q16'], 'Green unchanged');
  });

  it('003b: swapping within the same color group is valid', () => {
    const game = {};
    const positions = getCurrentFluctuationPositions(game, MAP_ID, fakeMapTokensData);

    // Swap two Blue positions: h21 ↔ t21 (both type 2)
    const idx1 = positions['2'].indexOf('h21');
    const idx2 = positions['2'].indexOf('t21');
    positions['2'][idx1] = 't21';
    positions['2'][idx2] = 'h21';

    // Result: same coords, just swapped order (effectively no-op for gameplay)
    assert.ok(positions['2'].includes('h21'));
    assert.ok(positions['2'].includes('t21'));
  });
});
