/**
 * Tier 3 Legality-Oracle Probes: VP / Mission Scoring (D8)
 *
 * PROBE-VP-001: Companion exclusion in named-area control
 *   a) Salacious B. Crumb always excluded (Indentured Jester)
 *   b) The Child excluded when incapacitated (Clan of Two)
 *   c) Dio excluded while Iden Versio alive
 *
 * PROBE-VP-002: getSpaceController tie/exclusive semantics
 *   a) Both players present on target space → null (no controller)
 *   b) Only one player present → that player
 *
 * PROBE-VP-003: Nefarious Gains (Jabba +1 objective VP on hostile defeat)
 *   a) Jabba alive → award
 *   b) Jabba dead → no award
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runEndOfRoundRules } from '../../../src/game/mission-rules.js';
import { checkNefariousGains } from '../../../src/game/vp-helpers.js';
import { getSpaceController } from '../../../src/game/board-helpers.js';

// ── Shared fixtures (reuse Cantina pattern from cantina-vp-oracles) ─────────

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

function buildGame(p1Positions = {}, p2Positions = {}, extra = {}) {
  return {
    player1Id: 'p1',
    player2Id: 'p2',
    player1VP: { total: 0, kills: 0, objectives: 0 },
    player2VP: { total: 0, kills: 0, objectives: 0 },
    figurePositions: { 1: p1Positions, 2: p2Positions },
    ended: false,
    ...extra,
  };
}

// ── PROBE-VP-001: Companion exclusion in named-area control ─────────────────

describe('PROBE-VP-001: Companion figures excluded from named-area control', () => {
  it('001a: Salacious B. Crumb always excluded — loses majority when Crumb is only extra figure', async () => {
    // P1: Stormtrooper + Crumb in Cantina; P2: 1 figure in Cantina
    // Crumb always excluded → P1 effective count = 1, P2 = 1 → tie → no VP
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13', 'Salacious B. Crumb-1-0': 'n14' },
      { 'Rebel Saboteur-0-0': 'o15' },
    );
    await runEndOfRoundRules(game, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game.player1VP.objectives, 0, 'P1 should NOT gain VP — Crumb excluded makes it a tie');
    assert.equal(game.player2VP.objectives, 0, 'P2 should not gain VP either');
  });

  it('001b: The Child excluded when incapacitated, counts when active', async () => {
    // Incapacitated: The Child excluded → P1 count = 1, P2 = 1 → tie → no VP
    const game1 = buildGame(
      { 'Stormtrooper-0-0': 'm13', 'The Child-1-0': 'n14' },
      { 'Rebel Saboteur-0-0': 'o15' },
      { childIncapacitated: true },
    );
    await runEndOfRoundRules(game1, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game1.player1VP.objectives, 0, 'Incapacitated Child excluded → tie → no VP');

    // Active: The Child counts → P1 count = 2, P2 = 1 → P1 majority → VP
    const game2 = buildGame(
      { 'Stormtrooper-0-0': 'm13', 'The Child-1-0': 'n14' },
      { 'Rebel Saboteur-0-0': 'o15' },
      { childIncapacitated: false },
    );
    await runEndOfRoundRules(game2, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game2.player1VP.objectives, 6, 'Active Child counts → P1 majority → 6 VP');
  });

  it('001c: Dio excluded while Iden Versio alive, counts after Iden defeated', async () => {
    // Iden alive (on board outside Cantina): Dio excluded → P1 = 1 (Stormtrooper), P2 = 1 → tie
    const game1 = buildGame(
      { 'Dio-0-0': 'm13', 'Stormtrooper-1-0': 'n14', 'Iden Versio-2-0': 'a1' },
      { 'Rebel Saboteur-0-0': 'o15' },
    );
    await runEndOfRoundRules(game1, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game1.player1VP.objectives, 0, 'Dio excluded (Iden alive) → tie → no VP');

    // Iden defeated (removed from board): Dio counts → P1 = 2 (Dio + Stormtrooper), P2 = 1 → P1 majority
    const game2 = buildGame(
      { 'Dio-0-0': 'm13', 'Stormtrooper-1-0': 'n14' },
      { 'Rebel Saboteur-0-0': 'o15' },
    );
    await runEndOfRoundRules(game2, MAP_ID, VARIANT, EOR_RULES, noopCtx());
    assert.equal(game2.player1VP.objectives, 6, 'Dio counts (Iden defeated) → P1 majority → 6 VP');
  });
});

// ── PROBE-VP-002: getSpaceController tie/exclusive semantics ────────────────

describe('PROBE-VP-002: getSpaceController returns null on shared presence, player on exclusive', () => {
  it('002a: both players have figures on the target space → null (no controller)', () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13' },
      { 'Rebel Saboteur-0-0': 'm13' },
    );
    const result = getSpaceController(game, MAP_ID, 'm13');
    assert.equal(result, null, 'Both players on same space → no controller');
  });

  it('002b: only P1 has a figure on/adjacent to space → returns 1', () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13' },
      { 'Rebel Saboteur-0-0': 'a1' },
    );
    const result = getSpaceController(game, MAP_ID, 'm13');
    assert.equal(result, 1, 'Only P1 on/adjacent to target → controller = 1');
  });
});

// ── PROBE-VP-003: Nefarious Gains ───────────────────────────────────────────

describe('PROBE-VP-003: Nefarious Gains — Jabba awards +1 objective VP on hostile defeat', () => {
  it('003a: Jabba alive on opposing team → +1 objective VP', () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13' },
      { 'Jabba the Hutt-0-0': 'a1' },
    );
    const result = checkNefariousGains(game, 1); // P1 figure defeated
    assert.ok(result, 'Should return non-null when Jabba alive');
    assert.equal(result.jabbaOwnerPN, 2, 'Jabba owned by P2');
    assert.equal(game.player2VP.objectives, 1, 'P2 gains +1 objective VP');
    assert.equal(game.player2VP.total, 1, 'P2 total VP = 1');
    assert.equal(game.player2VP.kills, 0, 'P2 kills unchanged');
  });

  it('003b: Jabba not alive → no VP awarded', () => {
    const game = buildGame(
      { 'Stormtrooper-0-0': 'm13' },
      { 'Greedo-0-0': 'a1' },
    );
    const result = checkNefariousGains(game, 1);
    assert.equal(result, null, 'Returns null when Jabba dead');
    assert.equal(game.player2VP.objectives, 0, 'No VP awarded');
    assert.equal(game.player2VP.total, 0, 'Total VP unchanged');
  });
});
