/**
 * Oracle + behavioral tests for interrupt and dc-play-area defeat pipeline.
 *
 * Covers: Overdrive (self-damage), YHSIW (interrupt damage), Orbital Bombardment (AoE),
 * Assassin's Blade (interrupt damage).
 *
 * Structural tests verify wiring; behavioral tests invoke the real
 * reduceHp → processFigureDefeat sequence and assert game-state mutations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestGame } from '../../fixtures/game-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ── Helper: find a player's DC msgId from dcMessageMeta ─────────────────────

function findMsgId(dcMessageMeta, playerNum, dcNamePrefix) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.playerNum === playerNum && meta.dcName.startsWith(dcNamePrefix)) return msgId;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-INTDEFEAT-001: Interrupts source tags present ─────────────────────
describe('ORACLE-INTDEFEAT-001: Interrupt defeat sites have source tags', () => {
  const src = readSrc('src/handlers/interrupts.js');

  for (const tag of [
    "source: 'Overdrive'",
    "source: 'Self-Destruct Probe'",
    "source: 'Self-Destruct Protocol'",
    "source: 'You Have Something I Want'",
    "source: 'Last Resort'",
    "source: \"Assassin's Blade\"",
  ]) {
    it(`interrupts.js includes ${tag}`, () => {
      assert.ok(src.includes(tag), `interrupts.js must contain ${tag}`);
    });
  }
});

// ── ORACLE-INTDEFEAT-002: dc-play-area source tags present ───────────────────
describe('ORACLE-INTDEFEAT-002: dc-play-area defeat sites have source tags', () => {
  const src = readSrc('src/handlers/dc-play-area.js');

  for (const tag of [
    "source: 'Rush'",
    "source: 'Orbital Bombardment'",
    "source: 'Bomb Drop'",
  ]) {
    it(`dc-play-area.js includes ${tag}`, () => {
      assert.ok(src.includes(tag), `dc-play-area.js must contain ${tag}`);
    });
  }
});

// ── ORACLE-INTDEFEAT-003: Context groups wire processFigureDefeat ────────────
describe('ORACLE-INTDEFEAT-003: Context groups wire processFigureDefeat for interrupts and dcPlayArea', () => {
  const src = readSrc('src/context-factory.js');

  for (const group of ['interrupts', 'dcPlayArea']) {
    it(`${group} context group includes processFigureDefeat`, () => {
      const groupIdx = src.indexOf(`${group}:`);
      assert.ok(groupIdx > 0, `${group} group found`);
      const closeIdx = src.indexOf('],', groupIdx);
      assert.ok(closeIdx > groupIdx, `found end of ${group} array`);
      const block = src.slice(groupIdx, closeIdx);
      assert.ok(block.includes('processFigureDefeat'), `${group} must include processFigureDefeat`);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── B-INTDEFEAT-001: Overdrive self-damage defeat (self-damage style) ────────
describe('B-INTDEFEAT-001: Overdrive self-damage defeat removes figure and awards VP to opponent', () => {
  it('self-damage to 0 HP + processFigureDefeat awards VP to opponent', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Find P1 figure and set to 1 HP (Overdrive deals 1 self-damage → kill)
    const stormFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Stormtrooper (Elite)-'));
    assert.ok(stormFigKey, 'P1 stormtrooper figure exists');
    const stormMsgId = findMsgId(dcMessageMeta, 1, 'Stormtrooper (Elite)');
    assert.ok(stormMsgId, 'stormtrooper msgId found');
    const healthArr = dcHealthState.get(stormMsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const vpBefore = game.player2VP.total;

    // Simulate Overdrive self-damage: reduceHp(1 damage to self)
    const { newHp } = deps.reduceHp(dcHealthState, game, stormMsgId, 0, 1, 1);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 1 self-damage on 1 HP');

    // Route through processFigureDefeat — opponent gets VP for self-damage kill
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 1,
      figureKey: stormFigKey,
      attackerPlayerNum: 2, // opponent gets VP
      source: 'Overdrive',
    });

    // Assert position removed
    assert.equal(game.figurePositions[1][stormFigKey], undefined, 'figure removed from board');
    // Assert VP awarded to opponent (P2)
    assert.ok(game.player2VP.total > vpBefore, `VP awarded to opponent (${vpBefore} → ${game.player2VP.total})`);
  });
});

// ── B-INTDEFEAT-002: YHSIW defeat removes figure and awards VP ───────────────
describe('B-INTDEFEAT-002: YHSIW defeat removes figure and awards VP', () => {
  it('3 damage to 0 HP + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 2; // 2 HP remaining, 3 damage → kill

    const vpBefore = game.player1VP.total;

    // Simulate YHSIW damage: reduceHp(3 damage)
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 3, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 3 damage on 2 HP');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'You Have Something I Want',
    });

    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-INTDEFEAT-003: Orbital Bombardment AoE defeat ──────────────────────────
describe('B-INTDEFEAT-003: Orbital Bombardment AoE defeat removes figure and awards VP', () => {
  it('AoE damage to 0 HP + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const vpBefore = game.player1VP.total;

    // Simulate Orbital Bombardment AoE damage: 3 damage to each figure in area
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 3, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP');

    // Process defeats after AoE loop (same pattern as dc-play-area.js)
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Orbital Bombardment',
    });

    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-INTDEFEAT-004: Assassin's Blade defeat removes figure and awards VP ────
describe("B-INTDEFEAT-004: Assassin's Blade defeat removes figure and awards VP", () => {
  it('rolled damage to 0 HP + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const vpBefore = game.player1VP.total;

    // Simulate Assassin's Blade damage: 2 hits
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 2, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: "Assassin's Blade",
    });

    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-INTDEFEAT-005: Non-lethal interrupt damage does NOT trigger defeat ──────
describe('B-INTDEFEAT-005: Non-lethal interrupt damage preserves figure on board', () => {
  it('figure survives interrupt damage and remains in figurePositions', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0] = [5, 5];

    const posBefore = game.figurePositions[2][officerFigKey];
    assert.ok(posBefore, 'figure has position before damage');

    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 1, 2);
    assert.ok(newHp > 0, `figure should survive 1 damage (HP: ${newHp})`);

    assert.equal(game.figurePositions[2][officerFigKey], posBefore, 'figure remains at same position');
    assert.equal(game.ended, false, 'game not ended');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVATION ABILITY DEFEAT PATHS (Tier 1)
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-ACTDEFEAT-001: Wookiee Avenger Slam and Durasteel Fist source tags ─
describe('ORACLE-ACTDEFEAT-001: Activation ability defeat sites have source tags', () => {
  const src = readSrc('src/handlers/activation.js');

  it("activation.js includes source: 'Wookiee Avenger Slam'", () => {
    assert.ok(src.includes("source: 'Wookiee Avenger Slam'"), "activation.js must contain source: 'Wookiee Avenger Slam'");
  });

  it("activation.js includes source: 'Durasteel Fist'", () => {
    assert.ok(src.includes("source: 'Durasteel Fist'"), "activation.js must contain source: 'Durasteel Fist'");
  });
});

// ── ORACLE-ACTDEFEAT-002: handleActPassive ctx includes processFigureDefeat ──
describe('ORACLE-ACTDEFEAT-002: handleActPassive destructures processFigureDefeat', () => {
  it('handleActPassive ctx destructuring includes processFigureDefeat', () => {
    const src = readSrc('src/handlers/activation.js');
    // Find the handleActPassive function and verify its ctx destructuring
    const fnIdx = src.indexOf('export async function handleActPassive');
    assert.ok(fnIdx > 0, 'handleActPassive found');
    const ctxBlock = src.slice(fnIdx, fnIdx + 500);
    assert.ok(ctxBlock.includes('processFigureDefeat'), 'handleActPassive ctx must include processFigureDefeat');
  });
});

// ── B-ACTDEFEAT-001: Wookiee Avenger Slam defeat removes figure and awards VP ─
describe('B-ACTDEFEAT-001: Wookiee Avenger Slam kill removes figure and awards VP', () => {
  it('rolled damage to 0 HP + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 2; // 2 HP remaining, red die can roll 2+ hits → kill

    const vpBefore = game.player1VP.total;

    // Simulate Wookiee Avenger Slam: rolled 3 hits on red die
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 3, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 3 damage on 2 HP');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Wookiee Avenger Slam',
    });

    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-ACTDEFEAT-002: Durasteel Fist defeat removes figure and awards VP ──────
describe('B-ACTDEFEAT-002: Durasteel Fist kill removes figure and awards VP', () => {
  it('rolled damage to 0 HP + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1; // 1 HP remaining, green die can roll 1+ hits → kill

    const vpBefore = game.player1VP.total;

    // Simulate Durasteel Fist: rolled 2 hits on green die
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 2, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 2 damage on 1 HP');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Durasteel Fist',
    });

    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    assert.ok(game.ended, 'game ended by elimination');
  });
});
