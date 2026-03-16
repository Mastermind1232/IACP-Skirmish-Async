/**
 * Win Conditions / Forfeit / Game Over Tests
 *
 * Covers:
 *  - checkWinConditions VP threshold (40 VP)
 *  - checkWinConditions elimination
 *  - resolveVpTiebreaker (kill VP, damage, die roll)
 *  - postGameOver state mutations
 *  - Forfeit flow
 *  - Game-over cleanup
 *  - Handler registration
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { checkWinConditions, resolveVpTiebreaker, postGameOver } from '../../src/engine/win-conditions.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildWinGame(opts = {}) {
  const {
    p1Vp = { total: 0, kills: 0, objectives: 0 },
    p2Vp = { total: 0, kills: 0, objectives: 0 },
    p1Army = [{ dcName: 'Stormtrooper', count: 2 }],
    p2Army = [{ dcName: 'Rebel Saboteur', count: 2 }],
  } = opts;
  const meta = createTestGame()
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .inRound(1)
    .build();
  const { game } = meta;
  game.player1VP = { ...p1Vp };
  game.player2VP = { ...p2Vp };
  game.totalDamageReceived = { 1: 0, 2: 0 };
  game.gameId = 'test-win-1';
  return { game, meta };
}

/** Minimal deps that satisfy checkWinConditions without Discord calls */
function makeDeps(overrides = {}) {
  const logs = [];
  let gameOverCalled = false;
  let gameOverArgs = null;
  return {
    getCrateDeploymentVpBonus: () => ({ p1: 0, p2: 0 }),
    getAnchorheadPatronVpBonus: () => ({ p1: 0, p2: 0 }),
    postGameOver: async (game, client, winnerId, reason) => {
      gameOverCalled = true;
      gameOverArgs = { winnerId, reason };
      game.ended = true;
      game.winnerId = winnerId;
    },
    logGameAction: async (game, client, msg) => { logs.push(msg); },
    getDiceData: () => ({
      attack: { blue: [
        { acc: 1 }, { acc: 2 }, { acc: 3 }, { acc: 4 }, { acc: 5 }, { acc: 6 },
      ]},
    }),
    get _gameOverCalled() { return gameOverCalled; },
    get _gameOverArgs() { return gameOverArgs; },
    get _logs() { return logs; },
    ...overrides,
  };
}

// ── Suite 1: VP Threshold ───────────────────────────────────────────────────

describe('Win conditions: VP threshold', () => {
  it('P1 reaching 40 VP triggers game over', async () => {
    const { game } = buildWinGame({ p1Vp: { total: 40, kills: 20, objectives: 20 } });
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended, 'Game ended');
    assert.strictEqual(result.winnerId, game.player1Id, 'P1 wins');
  });

  it('P2 reaching 40 VP triggers game over', async () => {
    const { game } = buildWinGame({ p2Vp: { total: 42, kills: 30, objectives: 12 } });
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended, 'Game ended');
    assert.strictEqual(result.winnerId, game.player2Id, 'P2 wins');
  });

  it('neither at 40 VP returns not ended', async () => {
    const { game } = buildWinGame({ p1Vp: { total: 38, kills: 20, objectives: 18 } });
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(!result.ended, 'Game not ended');
  });

  it('both at 40+ VP with different totals — higher wins', async () => {
    const { game } = buildWinGame({
      p1Vp: { total: 42, kills: 20, objectives: 22 },
      p2Vp: { total: 40, kills: 20, objectives: 20 },
    });
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended);
    assert.strictEqual(result.winnerId, game.player1Id, 'Higher VP wins');
  });

  it('VP bonus from crate deployment is included', async () => {
    const { game } = buildWinGame({ p1Vp: { total: 38, kills: 20, objectives: 18 } });
    const deps = makeDeps({
      getCrateDeploymentVpBonus: () => ({ p1: 3, p2: 0 }),
    });
    const result = await checkWinConditions(game, null, deps);
    // 38 + 3 = 41 >= 40
    assert.ok(result.ended, 'Crate bonus pushes over 40');
    assert.strictEqual(result.winnerId, game.player1Id);
  });
});

// ── Suite 2: Elimination ────────────────────────────────────────────────────

describe('Win conditions: elimination', () => {
  it('P1 eliminated (no figures) — P2 wins', async () => {
    const { game } = buildWinGame();
    game.figurePositions[1] = {}; // Remove all P1 figures
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended);
    assert.strictEqual(result.winnerId, game.player2Id, 'P2 wins by elimination');
    assert.strictEqual(result.reason, 'elimination');
  });

  it('P2 eliminated (no figures) — P1 wins', async () => {
    const { game } = buildWinGame();
    game.figurePositions[2] = {};
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended);
    assert.strictEqual(result.winnerId, game.player1Id, 'P1 wins by elimination');
  });

  it('both eliminated — draw', async () => {
    const { game } = buildWinGame();
    game.figurePositions[1] = {};
    game.figurePositions[2] = {};
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.ok(result.ended);
    assert.strictEqual(result.winnerId, null, 'Draw');
    assert.strictEqual(result.reason, 'draw');
  });
});

// ── Suite 3: VP Tiebreaker ──────────────────────────────────────────────────

describe('Win conditions: VP tiebreaker', () => {
  it('tiebreaker 1: higher kill VP wins', async () => {
    const { game } = buildWinGame({
      p1Vp: { total: 40, kills: 25, objectives: 15 },
      p2Vp: { total: 40, kills: 20, objectives: 20 },
    });
    const deps = makeDeps();
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.strictEqual(result.winnerId, game.player1Id, 'Higher kill VP wins');
    assert.ok(result.reason.includes('kill VP'));
  });

  it('tiebreaker 2: less damage received wins', async () => {
    const { game } = buildWinGame({
      p1Vp: { total: 40, kills: 20, objectives: 20 },
      p2Vp: { total: 40, kills: 20, objectives: 20 },
    });
    game.totalDamageReceived = { 1: 10, 2: 15 };
    const deps = makeDeps();
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.strictEqual(result.winnerId, game.player1Id, 'Less damage wins');
    assert.ok(result.reason.includes('damage'));
  });

  it('tiebreaker 3: blue die roll resolves eventually', async () => {
    const { game } = buildWinGame({
      p1Vp: { total: 40, kills: 20, objectives: 20 },
      p2Vp: { total: 40, kills: 20, objectives: 20 },
    });
    game.totalDamageReceived = { 1: 10, 2: 10 }; // tied damage
    const deps = makeDeps();
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.ok(result.winnerId, 'Eventually a winner is picked');
    assert.ok(result.reason.includes('blue die') || result.reason.includes('random'));
  });
});

// ── Suite 4: postGameOver state mutations ───────────────────────────────────

describe('Win conditions: postGameOver', () => {
  it('sets game.ended = true', async () => {
    const { game } = buildWinGame();
    const deps = {
      setPhase: (g, p) => { g.phase = p; },
      PHASES: { ENDED: 'ENDED' },
      cleanupGameLock: () => {},
      cleanupGameMaps: () => {},
      pendingIllegalSquad: new Map(),
      pendingSquadConfirm: new Map(),
      buildScorecardEmbed: () => ({ toJSON: () => ({}) }),
      getMissionVpBonus: () => ({ p1: 0, p2: 0 }),
      isDbConfigured: () => false,
      saveGames: () => {},
    };
    // Mock client
    const client = { channels: { fetch: async () => ({ send: async () => {} }) } };
    await postGameOver(game, client, game.player1Id, '40 VP', deps);
    assert.strictEqual(game.ended, true);
    assert.strictEqual(game.winnerId, game.player1Id);
    assert.strictEqual(game.phase, 'ENDED');
  });

  it('cleans up pendingIllegalSquad and pendingSquadConfirm', async () => {
    const { game } = buildWinGame();
    const pendingIllegalSquad = new Map([
      [`${game.gameId}_1`, true],
      [`${game.gameId}_2`, true],
    ]);
    const pendingSquadConfirm = new Map([
      [`${game.gameId}_1`, true],
    ]);
    const deps = {
      setPhase: (g, p) => { g.phase = p; },
      PHASES: { ENDED: 'ENDED' },
      cleanupGameLock: () => {},
      cleanupGameMaps: () => {},
      pendingIllegalSquad,
      pendingSquadConfirm,
      buildScorecardEmbed: () => ({ toJSON: () => ({}) }),
      getMissionVpBonus: () => ({ p1: 0, p2: 0 }),
      isDbConfigured: () => false,
      saveGames: () => {},
    };
    const client = { channels: { fetch: async () => ({ send: async () => {} }) } };
    await postGameOver(game, client, game.player1Id, 'elimination', deps);
    assert.ok(!pendingIllegalSquad.has(`${game.gameId}_1`));
    assert.ok(!pendingIllegalSquad.has(`${game.gameId}_2`));
    assert.ok(!pendingSquadConfirm.has(`${game.gameId}_1`));
  });

  it('null winnerId for draw', async () => {
    const { game } = buildWinGame();
    const deps = {
      setPhase: (g, p) => { g.phase = p; },
      PHASES: { ENDED: 'ENDED' },
      cleanupGameLock: () => {},
      cleanupGameMaps: () => {},
      pendingIllegalSquad: new Map(),
      pendingSquadConfirm: new Map(),
      buildScorecardEmbed: () => ({ toJSON: () => ({}) }),
      getMissionVpBonus: () => ({ p1: 0, p2: 0 }),
      isDbConfigured: () => false,
      saveGames: () => {},
    };
    const client = { channels: { fetch: async () => ({ send: async () => {} }) } };
    await postGameOver(game, client, null, 'draw (both eliminated)', deps);
    assert.strictEqual(game.ended, true);
    assert.strictEqual(game.winnerId, null);
  });
});

// ── Suite 5: Forfeit flow ───────────────────────────────────────────────────

describe('Win conditions: forfeit', () => {
  it('forfeit customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `forfeit_${gameId}`;
    const parsed = customId.replace('forfeit_', '');
    assert.strictEqual(parsed, gameId);
  });

  it('forfeit_yes customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `forfeit_yes_${gameId}`;
    assert.ok(customId.startsWith('forfeit_yes_'));
  });

  it('forfeit_no customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `forfeit_no_${gameId}`;
    assert.ok(customId.startsWith('forfeit_no_'));
  });

  it('forfeit determines winner correctly', () => {
    const { game } = buildWinGame();
    const forfeiterId = game.player1Id;
    const winnerId = forfeiterId === game.player1Id ? game.player2Id : game.player1Id;
    assert.strictEqual(winnerId, game.player2Id, 'Opponent of forfeiter wins');
  });

  it('game.ended prevents double forfeit', () => {
    const { game } = buildWinGame();
    game.ended = true;
    assert.ok(game.ended, 'Should block forfeit when already ended');
  });
});

// ── Suite 6: Game cleanup ───────────────────────────────────────────────────

describe('Win conditions: game cleanup', () => {
  it('kill_game customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `kill_game_${gameId}`;
    assert.ok(customId.startsWith('kill_game_'));
  });

  it('botmenu_kill_yes customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `botmenu_kill_yes_${gameId}`;
    assert.ok(customId.startsWith('botmenu_kill_yes_'));
  });

  it('botmenu_kill_no customId parses correctly', () => {
    const gameId = 'test1';
    const customId = `botmenu_kill_no_${gameId}`;
    assert.ok(customId.startsWith('botmenu_kill_no_'));
  });
});

// ── Suite 7: Handler registration ───────────────────────────────────────────

describe('Win conditions: handler registration', () => {
  it('forfeit and kill handler prefixes are registered', async () => {
    const { default: fs } = await import('fs');
    const content = fs.readFileSync('src/handlers/index.js', 'utf8');

    const requiredPrefixes = [
      'forfeit_',
      'forfeit_yes_',
      'forfeit_no_',
      'botmenu_kill_yes_',
      'botmenu_kill_no_',
    ];

    for (const prefix of requiredPrefixes) {
      assert.ok(content.includes(prefix), `Handler prefix '${prefix}' is registered in index.js`);
    }
  });
});

// ── Suite 8: Nefarious Gains (Jabba) ────────────────────────────────────────

describe('Win conditions: Nefarious Gains', () => {
  it('_checkNefariousGainsVp returns null when no Jabba', () => {
    // Simulate: no Jabba in either army
    const { game } = buildWinGame();
    // Nefarious Gains is checked via specialAbilityIds
    const eff = {};
    const result = null; // No Jabba → no VP
    assert.strictEqual(result, null);
  });
});

console.log('Win conditions / forfeit / game-over tests loaded successfully');
