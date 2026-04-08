/**
 * Oracle + behavioral tests for movement-triggered defeat pipeline.
 *
 * Covers: Overrun, Cut and Run, Swipe — the 3 movement.js defeat sites
 * that now route through processFigureDefeat.
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

// ── ORACLE-MVDEFEAT-001: All 3 movement defeat sites call processFigureDefeat ─
describe('ORACLE-MVDEFEAT-001: Movement defeat sites use processFigureDefeat', () => {
  const src = readSrc('src/handlers/movement.js');

  it('movement.js includes processFigureDefeat', () => {
    assert.ok(src.includes('processFigureDefeat'), 'movement.js must call processFigureDefeat');
  });

  it('Overrun defeat routes through processFigureDefeat with source tag', () => {
    assert.ok(src.includes("source: 'Overrun'"), 'Overrun processFigureDefeat call must include source tag');
  });

  it('Cut and Run defeat routes through processFigureDefeat with source tag', () => {
    assert.ok(src.includes("source: 'Cut and Run'"), 'Cut and Run processFigureDefeat call must include source tag');
  });

  it('Swipe defeat routes through processFigureDefeat with source tag', () => {
    assert.ok(src.includes("source: 'Swipe'"), 'Swipe processFigureDefeat call must include source tag');
  });
});

// ── ORACLE-MVDEFEAT-002: No "may be defeated" ghost-figure text remains ───────
describe('ORACLE-MVDEFEAT-002: No ghost-figure defeat text remains', () => {
  it('movement.js does not contain "may be defeated" for these 3 sites', () => {
    const src = readSrc('src/handlers/movement.js');
    assert.ok(
      !src.includes('may be defeated'),
      'movement.js should no longer contain "may be defeated" — all defeats are now handled'
    );
  });
});

// ── ORACLE-MVDEFEAT-003: movePick context includes processFigureDefeat ────────
describe('ORACLE-MVDEFEAT-003: movePick context group wires processFigureDefeat', () => {
  it('context-factory.js movePick group includes processFigureDefeat', () => {
    const src = readSrc('src/context-factory.js');
    // Find the movePick group definition
    const movePickIdx = src.indexOf('movePick:');
    assert.ok(movePickIdx > 0, 'movePick group found in context-factory');
    // Find the closing bracket of the movePick array
    const closeIdx = src.indexOf('],', movePickIdx);
    assert.ok(closeIdx > movePickIdx, 'found end of movePick array');
    const movePickBlock = src.slice(movePickIdx, closeIdx);
    assert.ok(
      movePickBlock.includes('processFigureDefeat'),
      'movePick context group must include processFigureDefeat'
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── B-MVDEFEAT-001: Overrun defeat removes figure and awards VP ─────────────
describe('B-MVDEFEAT-001: Overrun kill removes figure and awards VP', () => {
  it('reduceHp to 0 + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Find the P2 figure and reduce to 1 HP (Overrun deals 2 damage → kill)
    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'officer msgId found');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const vpBefore = game.player1VP.total;

    // Simulate Overrun damage: reduceHp(2 damage) → figure at 0 HP
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 2, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 2 damage on 1 HP');

    // Route through processFigureDefeat (exactly as movement.js now does)
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Overrun',
    });

    // Assert position removed
    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    // Assert VP awarded
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    // Assert win condition (P2 eliminated)
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-MVDEFEAT-002: Cut and Run defeat removes figure and awards VP ─────────
describe('B-MVDEFEAT-002: Cut and Run kill removes figure and awards VP', () => {
  it('reduceHp to 0 + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    healthArr_setup: {
      const healthArr = dcHealthState.get(officerMsgId);
      healthArr[0][0] = 1; // 1 HP remaining
    }

    const vpBefore = game.player1VP.total;

    // Simulate Cut and Run damage: reduceHp(1 damage) → figure at 0 HP
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 1, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 1 damage on 1 HP');

    // Route through processFigureDefeat (exactly as movement.js now does)
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Cut and Run',
    });

    // Assert position removed
    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    // Assert VP awarded
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    // Assert win condition (P2 eliminated)
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-MVDEFEAT-003: Swipe defeat removes figure and awards VP ───────────────
describe('B-MVDEFEAT-003: Swipe kill removes figure and awards VP', () => {
  it('reduceHp to 0 + processFigureDefeat produces correct game state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    healthArr_setup: {
      const healthArr = dcHealthState.get(officerMsgId);
      healthArr[0][0] = 1; // 1 HP remaining
    }

    const vpBefore = game.player1VP.total;

    // Simulate Swipe damage: reduceHp(1 damage) → figure at 0 HP
    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 1, 2);
    assert.ok(newHp <= 0, 'figure should be at 0 HP after 1 damage on 1 HP');

    // Route through processFigureDefeat (exactly as movement.js now does)
    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: officerFigKey,
      attackerPlayerNum: 1,
      source: 'Swipe',
    });

    // Assert position removed
    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'figure removed from board');
    // Assert VP awarded
    assert.ok(game.player1VP.total > vpBefore, `VP awarded (${vpBefore} → ${game.player1VP.total})`);
    // Assert win condition (P2 eliminated)
    assert.ok(game.ended, 'game ended by elimination');
  });
});

// ── B-MVDEFEAT-004: Non-lethal movement damage does NOT trigger defeat ──────
describe('B-MVDEFEAT-004: Non-lethal movement damage preserves figure on board', () => {
  it('figure survives movement damage and remains in figurePositions', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    // Set HP to 5 so 1 damage leaves the figure alive
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0] = [5, 5];

    const posBefore = game.figurePositions[2][officerFigKey];
    assert.ok(posBefore, 'figure has position before damage');

    const { newHp } = deps.reduceHp(dcHealthState, game, officerMsgId, 0, 1, 2);
    // Should NOT call processFigureDefeat when newHp > 0
    assert.ok(newHp > 0, `figure should survive 1 damage (HP: ${newHp})`);

    // Figure remains on board
    assert.equal(game.figurePositions[2][officerFigKey], posBefore, 'figure remains at same position');
    assert.equal(game.ended, false, 'game not ended');
  });
});

// ── B-MVDEFEAT-005: Movement defeat fires Heroic Effort ─────────────────────
describe('B-MVDEFEAT-005: Movement-triggered defeat fires Heroic Effort', () => {
  it('unique figure killed by movement damage → CC drawn + pending return', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'IG-88' }])
      .withPlayer2CcDeck(['Card A', 'Card B', 'Card C', 'Card D', 'Card E', 'Card F'])
      .inRound(1)
      .build();

    // Add [Heroic Effort] to P2's dcList
    game.p2DcList.push({ dcName: '[Heroic Effort]', displayName: '[Heroic Effort]', healthState: [] });

    const ig88FigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('IG-88-'));
    assert.ok(ig88FigKey, 'P2 IG-88 figure exists');
    const ig88MsgId = findMsgId(dcMessageMeta, 2, 'IG-88');
    const healthArr = dcHealthState.get(ig88MsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const deckBefore = game.player2CcDeck.length;
    const handBefore = game.player2CcHand.length;

    // Simulate movement damage kill
    const { newHp } = deps.reduceHp(dcHealthState, game, ig88MsgId, 0, 2, 2);
    assert.ok(newHp <= 0, 'IG-88 should be at 0 HP');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: ig88FigKey,
      attackerPlayerNum: 1,
      source: 'Overrun',
    });

    // Position removed
    assert.equal(game.figurePositions[2][ig88FigKey], undefined, 'IG-88 removed from board');

    // Heroic Effort: draw 1 CC from deck
    assert.equal(game.player2CcDeck.length, deckBefore - 1, 'one card drawn from deck');
    assert.equal(game.player2CcHand.length, handBefore + 1, 'one card added to hand');
    assert.ok(game.pendingHeroicEffortReturn?.[2], 'pendingHeroicEffortReturn set for P2');
  });
});
