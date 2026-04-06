/**
 * Oracle tests for Corellian Underground A — Local Trouble: Cantina 6 VP.
 *
 * Rule: At end of round, the player who controls the Cantina gains 6 VPs.
 * Control = more figures in the area's cells than opponent (majority).
 * Tie or no presence = no controller = no VP.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEndOfRoundRules } from '../../../src/game/mission-rules.js';

const MAP_ID = 'corellian-underground';
const VARIANT = 'a';

const EOR_RULES = {
  vpForControllingNamedArea: {
    areaName: 'Cantina',
    vp: 6,
  },
};

function fakeMapTokensData() {
  return {
    [MAP_ID]: {
      namedAreas: [
        {
          name: 'Cantina',
          cells: ['l12', 'l13', 'l14', 'l15', 'l16', 'm12', 'm13', 'm14', 'm15', 'm16',
            'n12', 'n13', 'n14', 'n15', 'n16', 'o12', 'o13', 'o14', 'o15', 'o16'],
        },
      ],
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
    ended: false,
  };
}

describe('ORACLE-CANTINA-001: Cantina controller gains 6 VP', () => {
  it('001a: P1 has majority in Cantina → P1 gains 6 VP', async () => {
    const game = buildGame(
      { 'Stormtrooper-1-0': 'm13', 'Stormtrooper-1-1': 'n14' },
      { 'Luke Skywalker-1-0': 'o15' },
    );
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game.player1VP.objectives, 6);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('001b: P2 has majority in Cantina → P2 gains 6 VP', async () => {
    const game = buildGame(
      {},
      { 'Luke Skywalker-1-0': 'l12', 'Wookiee Warrior-1-0': 'l13' },
    );
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 6);
  });
});

describe('ORACLE-CANTINA-002: No VP when Cantina is tied or empty', () => {
  it('002a: equal figures → no VP awarded', async () => {
    const game = buildGame(
      { 'Stormtrooper-1-0': 'm13' },
      { 'Luke Skywalker-1-0': 'n14' },
    );
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('002b: no figures in Cantina → no VP awarded', async () => {
    const game = buildGame(
      { 'Stormtrooper-1-0': 'a1' },
      { 'Luke Skywalker-1-0': 'z25' },
    );
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
  });
});
