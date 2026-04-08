/**
 * Oracle tests for pushFigure() Phase 1 migration.
 *
 * Structural: all push/pull sites use pushFigure().
 * Behavioral: representative caller path preserves existing behavior.
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

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-PUSH-001: All migrated files import pushFigure ────────────────────
describe('ORACLE-PUSH-001: All migrated files import pushFigure', () => {
  const files = [
    'src/game/abilities.js',
    'src/game/movement.js',
    'src/handlers/movement.js',
    'src/handlers/dc-play-area.js',
    'src/handlers/activation.js',
    'src/handlers/combat-special-effects.js',
  ];

  for (const file of files) {
    it(`${file} imports pushFigure`, () => {
      const src = readSrc(file);
      assert.ok(src.includes('pushFigure'), `${file} must import/use pushFigure`);
    });
  }
});

// ── ORACLE-PUSH-002: pushFigure is defined in player-helpers.js ──────────────
describe('ORACLE-PUSH-002: pushFigure defined in player-helpers.js', () => {
  it('player-helpers.js exports pushFigure', () => {
    const src = readSrc('src/game/player-helpers.js');
    assert.ok(src.includes('export function pushFigure'), 'pushFigure must be exported');
  });

  it('pushFigure normalizes to lowercase', () => {
    const src = readSrc('src/game/player-helpers.js');
    const fnIdx = src.indexOf('export function pushFigure');
    assert.ok(fnIdx > 0, 'pushFigure found');
    const fnBlock = src.slice(fnIdx, fnIdx + 400);
    assert.ok(fnBlock.includes('.toLowerCase()'), 'pushFigure must normalize space to lowercase');
  });

  it('pushFigure guards against missing position', () => {
    const src = readSrc('src/game/player-helpers.js');
    const fnIdx = src.indexOf('export function pushFigure');
    const fnBlock = src.slice(fnIdx, fnIdx + 400);
    assert.ok(fnBlock.includes('return null'), 'pushFigure must return null for missing figure');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── B-PUSH-001: pushFigure updates position in deployed game state ───────────
describe('B-PUSH-001: pushFigure works with real game state from builder', () => {
  it('moves a deployed figure to a new space', async () => {
    const { game } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Find P2 officer figure
    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer exists on board');
    const origPos = game.figurePositions[2][officerFigKey];
    assert.ok(origPos, 'officer has a position');

    // Import pushFigure and use it
    const { pushFigure } = await import('../../../src/game/player-helpers.js');

    const result = pushFigure(game, 2, officerFigKey, 'Z9');
    assert.ok(result, 'pushFigure returned a result');
    assert.strictEqual(result.prevPos, origPos, 'prevPos matches original');
    assert.strictEqual(result.newPos, 'z9', 'newPos is normalized lowercase');
    assert.strictEqual(game.figurePositions[2][officerFigKey], 'z9', 'game state updated');
  });

  it('no-ops for a figure not on the board', async () => {
    const { game } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const { pushFigure } = await import('../../../src/game/player-helpers.js');

    const result = pushFigure(game, 1, 'Nonexistent-1-0', 'a1');
    assert.strictEqual(result, null, 'returns null for missing figure');
    assert.strictEqual(game.figurePositions[1]['Nonexistent-1-0'], undefined, 'no ghost write');
  });
});
