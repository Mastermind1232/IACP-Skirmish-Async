/**
 * Tier 3 Legality-Oracle Probes: Mission Scoring Handlers (D8)
 *
 * PROBE-VP-004: vpPerLaunchPanelControlled — colored (green VP), gray (gray VP), unflipped (0)
 * PROBE-VP-005: vpPerControlledSpaceInList — controlled spaces award VP, uncontrolled don't
 * PROBE-VP-006: autoDistributeCrateTokens — controlled→VP+clear, uncontrolled→clear+noVP
 * PROBE-VP-007: vpPerContrabandInDeploymentZone — figure in DZ→VP, not in DZ→noVP
 * PROBE-VP-008: vpPerTokenForControllingCell — controller+tokens→VP+reset, no controller→reset+noVP
 *
 * All tests call runEndOfRoundRules() with mocked ctx (same pattern as cantina probes).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEndOfRoundRules } from '../../../src/game/mission-rules.js';

// ── Shared fixtures ───────────────────────────────────────────────────────

const MAP_ID = 'test-map';
const VARIANT = 'a';

function buildGame(p1Positions = {}, p2Positions = {}, extra = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    figurePositions: { 1: p1Positions, 2: p2Positions },
    ended: false,
    initiativePlayerId: 'p1',
    ...extra,
  };
}

/**
 * Build ctx with mocked functions. controllerMap maps coord→playerNum (or null).
 * getMapTokensData returns missionA/missionB data with given positions.
 */
function buildCtx(overrides = {}) {
  return {
    logGameAction: async () => {},
    client: null,
    checkWinConditions: async () => {},
    getMapTokensData: () => ({}),
    getSpaceController: () => null,
    isFigureInDeploymentZone: () => false,
    getFiguresOnOrAdjacentToSpace: () => [],
    ...overrides,
  };
}

// ── PROBE-VP-004: vpPerLaunchPanelControlled ──────────────────────────────

describe('PROBE-VP-004: vpPerLaunchPanelControlled — colored/gray/unflipped panels', () => {
  const RULES = {
    vpPerLaunchPanelControlled: { green: 5, gray: 2 },
  };

  it('004a: colored (flipped green) panel controlled → awards green VP', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'c3' },
      { 'Rebel-0-0': 'z1' },
      {
        launchPanelState: { c3: 'colored' },
        selectedMission: { variant: 'a' },
      },
    );
    const ctx = buildCtx({
      getMapTokensData: () => ({
        [MAP_ID]: { missionA: { positions: { launchPanels: ['c3'] } } },
      }),
      getSpaceController: (_g, _m, coord) => coord === 'c3' ? 1 : null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 5, 'P1 gains 5 VP for colored panel');
    assert.equal(game.player1VP.total, 5, 'P1 total VP = 5');
  });

  it('004b: gray panel controlled → awards gray VP', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'd4' },
      { 'Rebel-0-0': 'z1' },
      {
        launchPanelState: { d4: 'gray' },
        selectedMission: { variant: 'a' },
      },
    );
    const ctx = buildCtx({
      getMapTokensData: () => ({
        [MAP_ID]: { missionA: { positions: { launchPanels: ['d4'] } } },
      }),
      getSpaceController: (_g, _m, coord) => coord === 'd4' ? 1 : null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 2, 'P1 gains 2 VP for gray panel');
    assert.equal(game.player1VP.total, 2, 'P1 total VP = 2');
  });

  it('004c: unflipped panel (no state entry) → 0 VP', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'e5' },
      { 'Rebel-0-0': 'z1' },
      {
        launchPanelState: {}, // e5 not flipped
        selectedMission: { variant: 'a' },
      },
    );
    const ctx = buildCtx({
      getMapTokensData: () => ({
        [MAP_ID]: { missionA: { positions: { launchPanels: ['e5'] } } },
      }),
      getSpaceController: (_g, _m, coord) => coord === 'e5' ? 1 : null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'No VP for unflipped panel');
    assert.equal(game.player1VP.total, 0, 'Total VP unchanged');
  });
});

// ── PROBE-VP-005: vpPerControlledSpaceInList ──────────────────────────────

describe('PROBE-VP-005: vpPerControlledSpaceInList — VP per controlled mission position', () => {
  const RULES = {
    vpPerControlledSpaceInList: { vp: 2 },
  };

  it('005a: P1 controls 2 of 3 mission spaces → 4 VP', async () => {
    const game = buildGame();
    const controllerMap = { a1: 1, b2: 1, c3: null };
    const ctx = buildCtx({
      getMapTokensData: () => ({
        [MAP_ID]: { missionA: { positions: { critical: ['a1', 'b2', 'c3'] } } },
      }),
      getSpaceController: (_g, _m, coord) => controllerMap[coord] ?? null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 4, 'P1 gains 2×2 = 4 VP for 2 controlled spaces');
    assert.equal(game.player1VP.total, 4);
  });

  it('005b: no spaces controlled → 0 VP', async () => {
    const game = buildGame();
    const ctx = buildCtx({
      getMapTokensData: () => ({
        [MAP_ID]: { missionA: { positions: { critical: ['a1', 'b2'] } } },
      }),
      getSpaceController: () => null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'No VP when no spaces controlled');
    assert.equal(game.player2VP.objectives, 0);
  });
});

// ── PROBE-VP-006: autoDistributeCrateTokens ───────────────────────────────

describe('PROBE-VP-006: autoDistributeCrateTokens — VP + token clear vs uncontrolled clear', () => {
  const RULES = {
    autoDistributeCrateTokens: { vpPerCrate: 2 },
  };

  it('006a: P1 controls crate with tokens → 2 VP + tokens cleared', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'c3' },
      {},
      { crateTokens: { c3: ['Surge', 'Block'] } },
    );
    const ctx = buildCtx({
      getSpaceController: (_g, _m, coord) => coord === 'c3' ? 1 : null,
      getFiguresOnOrAdjacentToSpace: (_g, pn, coord) =>
        pn === 1 && coord === 'c3' ? ['Stormtrooper-0-0'] : [],
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 2, 'P1 gains 2 VP for controlled crate');
    assert.equal(game.player1VP.total, 2);
    assert.deepEqual(game.crateTokens.c3, [], 'Crate tokens cleared after distribution');
  });

  it('006b: uncontrolled crate → tokens cleared, no VP awarded', async () => {
    const game = buildGame(
      {},
      {},
      { crateTokens: { d4: ['Damage', 'Evade'] } },
    );
    const ctx = buildCtx({
      getSpaceController: () => null, // no controller
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'No VP for uncontrolled crate');
    assert.equal(game.player2VP.objectives, 0);
    assert.deepEqual(game.crateTokens.d4, [], 'Tokens still cleared even without controller');
  });
});

// ── PROBE-VP-007: vpPerContrabandInDeploymentZone ─────────────────────────

describe('PROBE-VP-007: vpPerContrabandInDeploymentZone — contraband in own DZ → VP', () => {
  const RULES = {
    vpPerContrabandInDeploymentZone: { vp: 4 },
  };

  it('007a: P1 figure carrying contraband in own DZ → 4 VP + contraband consumed', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'r17' },
      {},
      { figureContraband: { 'Stormtrooper-0-0': true } },
    );
    const ctx = buildCtx({
      isFigureInDeploymentZone: (_g, pn, fk) =>
        pn === 1 && fk === 'Stormtrooper-0-0',
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 4, 'P1 gains 4 VP for contraband in DZ');
    assert.equal(game.player1VP.total, 4);
    assert.equal(game.figureContraband['Stormtrooper-0-0'], undefined,
      'Contraband removed after scoring');
  });

  it('007b: P1 figure carrying contraband NOT in DZ → no VP, contraband retained', async () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13' },
      {},
      { figureContraband: { 'Stormtrooper-0-0': true } },
    );
    const ctx = buildCtx({
      isFigureInDeploymentZone: () => false, // not in any DZ
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'No VP — figure not in DZ');
    assert.equal(game.figureContraband['Stormtrooper-0-0'], true,
      'Contraband still carried (not consumed)');
  });
});

// ── PROBE-VP-008: vpPerTokenForControllingCell ────────────────────────────

describe('PROBE-VP-008: vpPerTokenForControllingCell — tokens + controller → VP + reset', () => {
  const RULES = {
    vpPerTokenForControllingCell: {
      controlCell: 'm13',
      vpPerToken: 3,
      tokenCountKey: 'missionObjectiveTokens',
    },
  };

  it('008a: P2 controls cell with 4 tokens → 12 VP, token count reset to 0', async () => {
    const game = buildGame(
      {},
      {},
      { missionObjectiveTokens: 4 },
    );
    const ctx = buildCtx({
      getSpaceController: (_g, _m, coord) => coord === 'm13' ? 2 : null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player2VP.objectives, 12, 'P2 gains 3×4 = 12 VP');
    assert.equal(game.player2VP.total, 12);
    assert.equal(game.missionObjectiveTokens, 0, 'Token count reset to 0');
  });

  it('008b: no controller but tokens present → tokens reset to 0, no VP', async () => {
    const game = buildGame(
      {},
      {},
      { missionObjectiveTokens: 3 },
    );
    const ctx = buildCtx({
      getSpaceController: () => null,
    });

    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'No VP without controller');
    assert.equal(game.player2VP.objectives, 0);
    assert.equal(game.missionObjectiveTokens, 0, 'Token count still reset to 0 (no controller path)');
  });
});
