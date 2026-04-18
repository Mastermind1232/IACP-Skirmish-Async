/**
 * Phase-D probe: objects cannot be pushed (architectural invariant).
 *
 * PROBE-PD-OBJ-003: Objects cannot be pushed. (CRR OBJECTS)
 *
 * Implementation: the push/displacement API only accepts figures.
 *   - src/game/player-helpers.js `pushFigure(game, playerNum, figureKey, newSpace)`
 *     writes into game.figurePositions[playerNum][figureKey].
 *   - There is no pushCrate / pushTerminal / pushObject API.
 *   - Object-position maps (cratePositions, deviceTokens) are initialised
 *     at mission setup and never rewritten by push/movement logic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pushFigure } from '../../../src/game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

describe('PROBE-PD-OBJ-003: objects cannot be pushed (push API accepts only figures)', () => {
  it('003a: pushFigure signature binds to figurePositions[playerNum][figureKey]', () => {
    const src = readFileSync(join(ROOT, 'src/game/player-helpers.js'), 'utf8');
    const fnIdx = src.indexOf('export function pushFigure');
    const close = src.indexOf('\n}\n', fnIdx);
    const body = src.slice(fnIdx, close);
    assert.ok(body.includes('game.figurePositions?.[playerNum]'),
      'pushFigure must read positions from figurePositions[playerNum] — CRR-OBJ-003');
    assert.ok(!body.includes('cratePositions'),
      'pushFigure must not touch cratePositions — CRR-OBJ-003');
    assert.ok(!body.includes('deviceTokens'),
      'pushFigure must not touch deviceTokens — CRR-OBJ-003');
    assert.ok(!body.includes('terminalPositions'),
      'pushFigure must not touch terminal positions — CRR-OBJ-003');
  });

  it('003b: no pushCrate / pushTerminal / pushObject helper exists', () => {
    const filesToScan = [
      'src/game/player-helpers.js',
      'src/game/movement.js',
      'src/game/abilities.js',
      'src/handlers/combat.js',
    ];
    for (const relPath of filesToScan) {
      const src = readFileSync(join(ROOT, relPath), 'utf8');
      assert.ok(!/function\s+pushCrate\b/.test(src),
        `${relPath} must not define pushCrate — CRR-OBJ-003`);
      assert.ok(!/function\s+pushTerminal\b/.test(src),
        `${relPath} must not define pushTerminal — CRR-OBJ-003`);
      assert.ok(!/function\s+pushObject\b/.test(src),
        `${relPath} must not define pushObject — CRR-OBJ-003`);
    }
  });

  it('003c: pushFigure ignores non-existent figure keys (returns null)', () => {
    // A crate-style identifier ("g5" initial coord) is not a figureKey;
    // pushFigure finds no position for it and short-circuits without writing.
    const game = { figurePositions: { 1: {}, 2: {} }, cratePositions: { g5: 'g5' } };
    const r = pushFigure(game, 1, 'g5', 'h6');
    assert.equal(r, null, 'pushFigure must return null for non-figure keys — CRR-OBJ-003');
    assert.equal(game.cratePositions.g5, 'g5',
      'crate position must be untouched by pushFigure — CRR-OBJ-003');
  });
});
