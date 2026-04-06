/**
 * Oracle tests for Chopper Base Atollon B — Powered Perimeter.
 *
 * Rules:
 *   SOR: Each player randomly reveals 1 of 3 set-aside tokens (without replacement).
 *        +1 strain on each signal marker matching the revealed color.
 *   EOR: Each player removes all strain from signal markers they control,
 *        gaining 2 VP per strain removed. Uncontrolled markers retain strain.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runStartOfRoundRules, runEndOfRoundRules } from '../../../src/game/mission-rules.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MAP_ID = 'chopper-base-atollon';
const VARIANT = 'b';

/** Minimal map-tokens data matching real Chopper Base B layout. */
function fakeMapTokensData() {
  return {
    [MAP_ID]: {
      missionB: {
        tokenTypes: [
          { id: '0', label: 'Signal Marker', image: 'Mission Token--Neutral Red.gif' },
          { id: '1', label: 'Signal Marker', image: 'Mission Token--Neutral Green.gif' },
          { id: '2', label: 'Signal Marker', image: 'Mission Token--Neutral Blue.gif' },
        ],
        positions: {
          '0': ['m17', 'o12'],
          '1': ['k23', 'q6'],
          '2': ['l6', 'p23'],
        },
      },
    },
  };
}

const SOR_RULES = { randomRevealAndPlaceStrain: { strainStateKey: 'signalMarkerStrain' } };
const EOR_RULES = {
  vpPerStrainOnControlledSpaces: {
    vpPerStrain: 2,
    strainStateKey: 'signalMarkerStrain',
    vpMessage: 'signal markers controlled ({count} strain removed × 2 VP)',
  },
};

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

// ── SOR: Token Reveal ────────────────────────────────────────────────────────

describe('ORACLE-PPERI-SOR: Powered Perimeter token reveal', () => {
  it('001: two distinct colors are revealed per round (no duplicates)', async () => {
    // Run 50 trials — statistically, if duplicates were possible (33% per trial),
    // we'd see them. With correct without-replacement logic, 0 duplicates.
    const colorPairs = [];
    for (let i = 0; i < 50; i++) {
      const game = { signalMarkerStrain: {} };
      await runStartOfRoundRules(game, MAP_ID, VARIANT, SOR_RULES, noopCtx());
      // Determine which colors got strain
      const strained = new Set();
      for (const [coord, count] of Object.entries(game.signalMarkerStrain)) {
        if (count > 0) strained.add(coord.toLowerCase());
      }
      // Map coords back to colors
      const colors = new Set();
      if (strained.has('m17') || strained.has('o12')) colors.add('red');
      if (strained.has('k23') || strained.has('q6')) colors.add('green');
      if (strained.has('l6') || strained.has('p23')) colors.add('blue');
      colorPairs.push(colors);
      assert.equal(colors.size, 2, `Trial ${i}: expected 2 distinct colors, got ${colors.size}: ${[...colors].join(', ')}`);
    }
  });

  it('002: exactly 4 signal markers receive strain when 2 different colors revealed', async () => {
    const game = { signalMarkerStrain: {} };
    await runStartOfRoundRules(game, MAP_ID, VARIANT, SOR_RULES, noopCtx());
    const strainedCoords = Object.entries(game.signalMarkerStrain).filter(([, c]) => c > 0);
    assert.equal(strainedCoords.length, 4, `Expected 4 strained markers, got ${strainedCoords.length}`);
    // Each strained marker should have exactly 1 strain
    for (const [coord, count] of strainedCoords) {
      assert.equal(count, 1, `Marker ${coord} should have 1 strain, got ${count}`);
    }
  });

  it('003: strain accumulates across rounds', async () => {
    const game = { signalMarkerStrain: { m17: 2, o12: 2 } };
    // Force a reveal that includes red — run until red is picked
    // Since we can't control randomness, just verify strain is additive
    await runStartOfRoundRules(game, MAP_ID, VARIANT, SOR_RULES, noopCtx());
    const total = Object.values(game.signalMarkerStrain).reduce((s, v) => s + v, 0);
    // Started with 4 (2+2 on red), added 2 distinct colors × 2 coords each = always 8 total
    assert.equal(total, 8, `Total strain should be exactly 8, got ${total}`);
  });
});

// ── EOR: VP Scoring ──────────────────────────────────────────────────────────

describe('ORACLE-PPERI-EOR: Powered Perimeter end-of-round scoring', () => {
  it('004: controlled markers award 2 VP per strain and strain is removed', async () => {
    const game = {
      signalMarkerStrain: { m17: 2, o12: 1, k23: 1 },
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      player1Id: 'p1',
      player2Id: 'p2',
      ended: false,
    };
    // P1 controls m17 (2 strain) and o12 (1 strain), P2 controls k23 (1 strain)
    const ctx = {
      ...noopCtx(),
      getSpaceController: (_game, _mapId, coord) => {
        if (coord === 'm17' || coord === 'o12') return 1;
        if (coord === 'k23') return 2;
        return null;
      },
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    assert.equal(game.player1VP.objectives, 6, 'P1 should get 6 VP (3 strain × 2)');
    assert.equal(game.player2VP.objectives, 2, 'P2 should get 2 VP (1 strain × 2)');
    assert.equal(game.signalMarkerStrain.m17, 0, 'Controlled marker m17 strain should be 0');
    assert.equal(game.signalMarkerStrain.o12, 0, 'Controlled marker o12 strain should be 0');
    assert.equal(game.signalMarkerStrain.k23, 0, 'Controlled marker k23 strain should be 0');
  });

  it('005: uncontrolled markers retain their strain', async () => {
    const game = {
      signalMarkerStrain: { m17: 3, o12: 1, k23: 2 },
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      player1Id: 'p1',
      player2Id: 'p2',
      ended: false,
    };
    // Only m17 is controlled (by P1); o12 and k23 are uncontrolled (contested or empty)
    const ctx = {
      ...noopCtx(),
      getSpaceController: (_game, _mapId, coord) => {
        if (coord === 'm17') return 1;
        return null; // contested or empty
      },
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    assert.equal(game.player1VP.objectives, 6, 'P1 should get 6 VP (3 strain × 2)');
    assert.equal(game.player2VP.objectives, 0, 'P2 should get 0 VP');
    assert.equal(game.signalMarkerStrain.m17, 0, 'Controlled marker m17 strain removed');
    assert.equal(game.signalMarkerStrain.o12, 1, 'Uncontrolled marker o12 retains strain');
    assert.equal(game.signalMarkerStrain.k23, 2, 'Uncontrolled marker k23 retains strain');
  });

  it('006: no VP awarded and no strain removed when no markers are controlled', async () => {
    const game = {
      signalMarkerStrain: { m17: 2, k23: 1 },
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },
      player1Id: 'p1',
      player2Id: 'p2',
      ended: false,
    };
    const ctx = {
      ...noopCtx(),
      getSpaceController: () => null,
    };
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, ctx);
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
    assert.equal(game.signalMarkerStrain.m17, 2, 'Strain preserved on m17');
    assert.equal(game.signalMarkerStrain.k23, 1, 'Strain preserved on k23');
  });
});
