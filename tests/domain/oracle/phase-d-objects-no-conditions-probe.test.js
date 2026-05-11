/**
 * Phase-D probe: objects cannot gain conditions (architectural invariant).
 *
 * PROBE-PD-CND-009: Objects cannot gain conditions. (CRR CONDITIONS)
 *
 * Implementation: the condition system is keyed exclusively by figureKey.
 *   - src/game/conditions.js `applyCondition(game, figureKey, cond)` writes
 *     into game.figureConditions[figureKey]
 *   - Objects (terminals, crates) live in dedicated maps: game.cratePositions,
 *     game.crateHealth, game.crateTokens, game.deviceTokens, etc.
 *   - No `crateConditions` / `terminalConditions` / object-level conditions
 *     map exists. There is no API path from an object identifier into
 *     figureConditions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCondition } from '../../../src/game/conditions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

describe('PROBE-PD-CND-009: objects cannot gain conditions (keyed-by-figureKey invariant)', () => {
  it('009a: applyCondition signature pins its parameter as figureKey', () => {
    const src = readFileSync(join(ROOT, 'src/game/conditions.js'), 'utf8');
    assert.ok(
      src.includes('export function applyCondition(game, figureKey, cond)'),
      'applyCondition must be keyed by figureKey — CRR-CND-009'
    );
  });

  it('009b: no object-level condition storage exists (no crateConditions / terminalConditions fields)', () => {
    // Walk the whole src tree: no code defines object-condition maps.
    const filesToScan = [
      'src/game/conditions.js',
      'src/game-state.js',
      'src/handlers/round.js',
      'src/handlers/map-events.js',
      'src/engine/misc-helpers.js',
    ];
    for (const relPath of filesToScan) {
      const src = readFileSync(join(ROOT, relPath), 'utf8');
      assert.ok(!/crateConditions|terminalConditions|objectConditions/.test(src),
        `${relPath} must not reference an object-level condition map — CRR-CND-009`);
    }
  });

  it('009c: game-state CLEARABLE list separates object token fields from figureConditions', () => {
    // Slice 5 (alexanbv 2026-05-10): cratePositions removed in favor of
    // unified objectPositions/objectHealth/objectMeta. The structural
    // separation between figure-conditions and object-state still holds.
    const src = readFileSync(join(ROOT, 'src/game-state.js'), 'utf8');
    assert.ok(src.includes('objectPositions'),
      'objectPositions must be a distinct object-position map — CRR-CND-009');
    assert.ok(src.includes('figureConditions'),
      'figureConditions must be a distinct figure-keyed map — CRR-CND-009');
  });

  it('009d: applying a condition only mutates figureConditions (round-trip)', () => {
    const game = {};
    applyCondition(game, 'Stormtrooper-1-0', 'Stun');
    assert.ok(game.figureConditions,
      'figureConditions must be the only map touched — CRR-CND-009');
    assert.ok(!('crateConditions' in game),
      'no crateConditions sidecar may be created — CRR-CND-009');
    assert.ok(!('terminalConditions' in game),
      'no terminalConditions sidecar may be created — CRR-CND-009');
    assert.deepEqual(game.figureConditions['Stormtrooper-1-0'], ['Stun']);
  });
});
