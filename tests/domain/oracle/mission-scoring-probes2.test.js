/**
 * Tier 3 Legality-Oracle Probes: Mission Scoring Handlers Batch 2 (D8)
 *
 * PROBE-VP-010: vpPerControlledDeploymentZone — strict majority per zone
 *   a) P1 has more figures in red zone → P1 gains VP
 *   b) Equal figures → tie → no VP
 *
 * PROBE-VP-011: vpPerContrabandInOpponentDeploymentZone — contraband in opponent DZ
 *   a) P1 figure carrying contraband in opponent's (blue) zone → VP + consumed
 *   b) P1 figure carrying contraband NOT in opponent zone → no VP + retained
 *
 * Both handlers use internal getDeploymentZones() (real data) and getPlayerOccupiedCellsForControl().
 * Tests use mos-eisley-outskirts deployment zone coords.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEndOfRoundRules } from '../../../src/game/mission-rules.js';

const MAP_ID = 'mos-eisley-outskirts';
const VARIANT = 'a';

// Red zone coords (mos-eisley-outskirts): p19, p20, q19, q20, ...
// Blue zone coords (mos-eisley-outskirts): g10, g11, g12, g9, ...

function buildGame(p1Positions = {}, p2Positions = {}, extra = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    figurePositions: { 1: p1Positions, 2: p2Positions },
    ended: false,
    initiativePlayerId: 'p1',
    deploymentZoneChosen: 'red',
    ...extra,
  };
}

function buildCtx(overrides = {}) {
  return {
    logGameAction: async () => {},
    client: null,
    checkWinConditions: async () => {},
    getMapTokensData: () => ({}),
    getSpaceController: () => null,
    ...overrides,
  };
}

// ── PROBE-VP-010: vpPerControlledDeploymentZone ───────────────────────────

describe('PROBE-VP-010: vpPerControlledDeploymentZone — strict majority per zone', () => {
  const RULES = {
    vpPerControlledDeploymentZone: { vp: 3 },
  };

  it('010a: P1 has 2 figures vs P2 has 1 in red zone → P1 gains 3 VP', async () => {
    const game = buildGame(
      // P1: 2 figures in red zone
      { 'Stormtrooper (Regular)-0-0': 'p19', 'Stormtrooper (Regular)-0-1': 'p20' },
      // P2: 1 figure in red zone
      { 'Rebel Saboteur-0-0': 'q19' },
    );
    const ctx = buildCtx();

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);

    assert.equal(game.player1VP.objectives, 3,
      'P1 gains 3 VP for strict majority in red zone (2 > 1)');
    assert.equal(game.player2VP.objectives, 0,
      'P2 gains 0 VP — no majority in any zone');
  });

  it('010b: equal figures in red zone (1 vs 1) → tie → no VP for either', async () => {
    const game = buildGame(
      // P1: 1 figure in red zone
      { 'Stormtrooper (Regular)-0-0': 'p19' },
      // P2: 1 figure in red zone
      { 'Rebel Saboteur-0-0': 'q19' },
    );
    const ctx = buildCtx();

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);

    assert.equal(game.player1VP.objectives, 0, 'P1 gains 0 VP — tie in red zone');
    assert.equal(game.player2VP.objectives, 0, 'P2 gains 0 VP — tie in red zone');
  });
});

// ── PROBE-VP-011: vpPerContrabandInOpponentDeploymentZone ─────────────────

describe('PROBE-VP-011: vpPerContrabandInOpponentDeploymentZone — contraband in opponent DZ', () => {
  const RULES = {
    vpPerContrabandInOpponentDeploymentZone: { vp: 4 },
  };

  // Builder defaults: initiativePlayerId = 'p1', deploymentZoneChosen = 'red'
  // P1 has initiative, chose red → P1's opponent zone = blue
  // Blue zone coords: g10, g11, g12, ...

  it('011a: P1 figure with contraband in opponent (blue) zone → 4 VP + consumed', async () => {
    const game = buildGame(
      { 'Stormtrooper (Regular)-0-0': 'g10' }, // P1 fig in blue zone
      { 'Rebel Saboteur-0-0': 'a1' },
      { figureContraband: { 'Stormtrooper (Regular)-0-0': true } },
    );
    const ctx = buildCtx();

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);

    assert.equal(game.player1VP.objectives, 4,
      'P1 gains 4 VP for contraband in opponent deployment zone');
    assert.equal(game.player1VP.total, 4);
    assert.equal(game.figureContraband['Stormtrooper (Regular)-0-0'], undefined,
      'Contraband consumed after scoring');
  });

  it('011b: P1 figure with contraband NOT in opponent zone → no VP + retained', async () => {
    const game = buildGame(
      { 'Stormtrooper (Regular)-0-0': 'm13' }, // P1 fig NOT in any zone
      { 'Rebel Saboteur-0-0': 'a1' },
      { figureContraband: { 'Stormtrooper (Regular)-0-0': true } },
    );
    const ctx = buildCtx();

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);

    assert.equal(game.player1VP.objectives, 0, 'No VP — figure not in opponent zone');
    assert.equal(game.figureContraband['Stormtrooper (Regular)-0-0'], true,
      'Contraband retained when not in opponent zone');
  });
});
