/**
 * Tier 3 Legality-Oracle Probes: Mission Scoring Handlers Batch 3 (D8 / B3)
 *
 * Phase-2 B3 closure pass — closes the unasserted mission-specific VP effect
 * types discovered by the Phase-2 audit inventory. The scoring engine is
 * data-driven: src/game/mission-rules.js dispatches on rule type, and
 * src/engine/mission-helpers.js computes persistent (non-end-of-round) VP
 * bonuses. Previous probe batches covered 7 of 11 effect types
 * (mission-scoring-probes.test.js VP-004..008, mission-scoring-probes2.test.js
 * VP-010..011). This file covers the remaining 3 end-of-round effect types
 * plus the two persistent VP bonus helpers.
 *
 * PROBE-VP-012: vpForControllingNamedArea (corellian A / hoth A)
 *   a) strict majority → VP to controller
 *   b) tie → no VP
 *   c) excluded companion (Salacious B. Crumb) doesn't tip the count
 *   d) Dio excluded while Iden Versio is alive, counts once Iden is dead
 *
 * PROBE-VP-013: vpPerControlledFluctuation (lothal B)
 *   a) controlled fluctuation → VP
 *   b) uncontrolled → no VP
 *   c) grantPowerToken wires color → power token for figures on fluctuation
 *
 * PROBE-VP-014: vpPerStrainOnControlledSpaces (chopper B)
 *   a) controller + strain → VP = vpPerStrain × strain; strain cleared
 *   b) uncontrolled marker → strain retained, no VP
 *
 * PROBE-VP-015: persistent VP bonus helpers (mission-helpers.js)
 *   a) Anchorhead A patron-token VP table (0,2,5,10,20 capped at 4)
 *   b) Devaron B crate-in-deployment-zone 6 VP per crate
 *   c) Non-matching map returns zero from both helpers
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEndOfRoundRules } from '../../../src/game/mission-rules.js';
import {
  getCrateDeploymentVpBonus,
  getAnchorheadPatronVpBonus,
} from '../../../src/engine/mission-helpers.js';

// ── Shared fixtures ───────────────────────────────────────────────────────

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

// ── PROBE-VP-012: vpForControllingNamedArea ───────────────────────────────

describe('PROBE-VP-012: vpForControllingNamedArea — controller gets VP, companion exclusions respected', () => {
  const MAP_ID = 'corellian-underground';
  const VARIANT = 'a';
  const AREA = 'Cantina';
  // Named-area cells (deliberately isolated so only explicit figures touch them).
  const AREA_CELLS = ['m14', 'm15', 'n14', 'n15'];
  const RULES = { vpForControllingNamedArea: { areaName: AREA, vp: 6 } };

  function buildMapTokensData() {
    return () => ({
      [MAP_ID]: {
        namedAreas: [{ name: AREA, cells: AREA_CELLS }],
      },
    });
  }

  it('012a: P1 has strict majority in Cantina → P1 gets 6 VP', async () => {
    const game = buildGame(
      { 'Stormtrooper (Regular)-0-0': 'm14', 'Stormtrooper (Regular)-0-1': 'm15' },
      { 'Rebel Saboteur-0-0': 'n14' },
    );
    const ctx = buildCtx({ getMapTokensData: buildMapTokensData() });
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 6);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('012b: tie in Cantina → no VP for either', async () => {
    const game = buildGame(
      { 'Stormtrooper (Regular)-0-0': 'm14' },
      { 'Rebel Saboteur-0-0': 'n14' },
    );
    const ctx = buildCtx({ getMapTokensData: buildMapTokensData() });
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('012c: Salacious B. Crumb does NOT count as a controller-tipping figure', async () => {
    // P1: just Salacious B. Crumb in the area (should not count).
    // P2: one normal figure. Expect P2 to win control via 1 > 0.
    const game = buildGame(
      { 'Salacious B. Crumb-0-0': 'm14' },
      { 'Rebel Saboteur-0-0': 'n14' },
    );
    const ctx = buildCtx({ getMapTokensData: buildMapTokensData() });
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0, 'Salacious B. Crumb excluded');
    assert.equal(game.player2VP.objectives, 6, 'P2 wins control 1-0');
  });

  it('012d: Dio excluded while Iden Versio alive; counts once Iden is defeated', async () => {
    // Setup: P1 has Dio + Iden alive → P1 counts 1 (just Iden). P2 has 1 fig → tie, no VP.
    const gameA = buildGame(
      { 'Dio-0-0': 'm14', 'Iden Versio-0-0': 'z1' },
      { 'Rebel Saboteur-0-0': 'n14' },
    );
    const ctx = buildCtx({ getMapTokensData: buildMapTokensData() });
    await runEndOfRoundRules(gameA, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(gameA.player1VP.objectives, 0, 'Dio excluded, no-one in area, P2 wins? actually P1 has 0 area-figs, P2 has 1 → P2 wins');
    assert.equal(gameA.player2VP.objectives, 6);

    // Now Iden defeated → Dio counts → P1 1 (Dio), P2 1 → tie, no VP.
    const gameB = buildGame(
      { 'Dio-0-0': 'm14' }, // Iden not present = defeated
      { 'Rebel Saboteur-0-0': 'n14' },
    );
    const ctxB = buildCtx({ getMapTokensData: buildMapTokensData() });
    await runEndOfRoundRules(gameB, MAP_ID, VARIANT, RULES, ctxB);
    assert.equal(gameB.player1VP.objectives, 0, 'tie once Dio counts');
    assert.equal(gameB.player2VP.objectives, 0);
  });
});

// ── PROBE-VP-013: vpPerControlledFluctuation ──────────────────────────────

describe('PROBE-VP-013: vpPerControlledFluctuation — VP per fluctuation + power-token grant', () => {
  const MAP_ID = 'lothal-wastes';
  const VARIANT = 'b';
  const RULES = { vpPerControlledFluctuation: { vp: 1, grantPowerToken: true } };

  function buildFluctuationCtx(controllerByCoord, tokenTypes) {
    return {
      getMapTokensData: () => ({
        [MAP_ID]: {
          missionB: { tokenTypes, positions: {} },
        },
      }),
      getSpaceController: (_g, _m, coord) => controllerByCoord[String(coord).toLowerCase()] ?? null,
    };
  }

  it('013a: P1 controls 2 fluctuations → P1 gains 2 VP', async () => {
    const game = buildGame({}, {}, {
      fluctuationPositions: { 0: ['e5'], 1: ['f7'] },
      powerTokens: { 1: {}, 2: {} },
    });
    const ctx = buildCtx(buildFluctuationCtx(
      { e5: 1, f7: 1 },
      [{ image: 'Neutral Yellow.png' }, { image: 'Neutral Red.png' }],
    ));
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 2);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('013b: uncontrolled fluctuation → no VP', async () => {
    const game = buildGame({}, {}, {
      fluctuationPositions: { 0: ['e5'] },
      powerTokens: { 1: {}, 2: {} },
    });
    const ctx = buildCtx(buildFluctuationCtx({ e5: null }, [{ image: 'Neutral Yellow.png' }]));
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
  });

  it('013c: grantPowerToken wires yellow→Surge for a figure on the fluctuation', async () => {
    const game = buildGame(
      { 'Stormtrooper (Regular)-0-0': 'e5' },
      {},
      { fluctuationPositions: { 0: ['e5'] } },
    );
    const ctx = buildCtx(buildFluctuationCtx({ e5: 1 }, [{ image: 'Neutral Yellow.png' }]));
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    const tokens = game.figurePowerTokens?.['Stormtrooper (Regular)-0-0'] || [];
    assert.ok(tokens.includes('Surge'),
      `Figure on yellow fluctuation should receive a Surge token; got ${JSON.stringify(tokens)}`);
  });
});

// ── PROBE-VP-014: vpPerStrainOnControlledSpaces ───────────────────────────

describe('PROBE-VP-014: vpPerStrainOnControlledSpaces — controller + strain → VP; strain cleared', () => {
  const MAP_ID = 'chopper-base-atollon';
  const VARIANT = 'b';
  const RULES = { vpPerStrainOnControlledSpaces: { vpPerStrain: 2, strainStateKey: 'signalMarkerStrain' } };

  it('014a: P1 controls marker with 3 strain → P1 gains 6 VP; strain cleared', async () => {
    const game = buildGame({}, {}, {
      signalMarkerStrain: { j8: 3, k9: 0 },
    });
    const ctx = buildCtx({
      getSpaceController: (_g, _m, coord) => (coord === 'j8' ? 1 : null),
    });
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 6, '2 VP × 3 strain');
    assert.equal(game.signalMarkerStrain.j8, 0, 'strain cleared after scoring');
  });

  it('014b: uncontrolled marker retains strain and yields no VP', async () => {
    const game = buildGame({}, {}, {
      signalMarkerStrain: { j8: 4 },
    });
    const ctx = buildCtx({ getSpaceController: () => null });
    await runEndOfRoundRules(game, MAP_ID, VARIANT, RULES, ctx);
    assert.equal(game.player1VP.objectives, 0);
    assert.equal(game.player2VP.objectives, 0);
    assert.equal(game.signalMarkerStrain.j8, 4, 'strain retained on uncontrolled marker');
  });
});

// ── PROBE-VP-015: persistent VP bonus helpers ─────────────────────────────

describe('PROBE-VP-015: persistent VP bonus helpers (anchorhead + devaron)', () => {
  describe('PROBE-VP-015a: Anchorhead patron-token VP table', () => {
    function makeAnchorheadGame(tokensByOwner) {
      return {
        selectedMap: { id: 'anchorhead-cantina-bar' },
        selectedMission: { variant: 'a' },
        anchorheadPatronTokens: tokensByOwner,
      };
    }

    it('progresses 0 → 2 → 5 → 10 → 20 at thresholds 0,1,2,3,4', () => {
      const table = [0, 2, 5, 10, 20];
      for (let tokens = 0; tokens <= 4; tokens++) {
        const game = makeAnchorheadGame(Object.fromEntries(
          Array.from({ length: tokens }, (_, i) => [`t${i}`, 1])
        ));
        const bonus = getAnchorheadPatronVpBonus(game);
        assert.equal(bonus.p1, table[tokens], `P1 with ${tokens} tokens → ${table[tokens]} VP`);
        assert.equal(bonus.p2, 0);
      }
    });

    it('caps at 20 for 5+ tokens', () => {
      const game = makeAnchorheadGame({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 });
      const bonus = getAnchorheadPatronVpBonus(game);
      assert.equal(bonus.p1, 20, '5 tokens cap at the 4-token threshold');
    });

    it('returns 0/0 for non-matching map/variant', () => {
      const game = { selectedMap: { id: 'mos-eisley-outskirts' }, selectedMission: { variant: 'a' }, anchorheadPatronTokens: { a: 1, b: 1 } };
      assert.deepEqual(getAnchorheadPatronVpBonus(game), { p1: 0, p2: 0 });
    });
  });

  describe('PROBE-VP-015b: Devaron crate-in-deployment-zone VP bonus', () => {
    const CRATE_COORDS = ['e3', 'e4'];
    const P1_ZONE = ['e3'];  // e3 in P1 zone → P1 gets 6 VP
    const P2_ZONE = ['e4'];  // e4 in P2 zone → P2 gets 6 VP
    const deps = {
      getMapTokensData: () => ({
        'devaron-garrison': { missionB: { positions: { 0: CRATE_COORDS } } },
      }),
      normalizeCoord: (c) => String(c).toLowerCase(),
      getInitiativePlayerNum: () => 1,
      getDeploymentZones: () => ({
        'devaron-garrison': { red: P1_ZONE, blue: P2_ZONE },
      }),
      getPlayerDeploymentZones: () => ({ p1Zone: 'red', p2Zone: 'blue' }),
    };

    it('015b-i: crate in P1 zone + crate in P2 zone → each player gets 6 VP', () => {
      const game = {
        selectedMap: { id: 'devaron-garrison' },
        selectedMission: { variant: 'b' },
        cratePositions: {},
      };
      const bonus = getCrateDeploymentVpBonus(game, deps);
      assert.deepEqual(bonus, { p1: 6, p2: 6 });
    });

    it('015b-ii: non-devaron map returns zeros', () => {
      const game = {
        selectedMap: { id: 'mos-eisley-outskirts' },
        selectedMission: { variant: 'b' },
      };
      assert.deepEqual(getCrateDeploymentVpBonus(game, deps), { p1: 0, p2: 0 });
    });

    it('015b-iii: devaron variant A (non-B) returns zeros', () => {
      const game = {
        selectedMap: { id: 'devaron-garrison' },
        selectedMission: { variant: 'a' },
      };
      assert.deepEqual(getCrateDeploymentVpBonus(game, deps), { p1: 0, p2: 0 });
    });
  });
});
