/**
 * Phase-D probe: an attackable object (crate) is destroyed when its
 * accumulated damage reaches its mission-specified Health.
 *
 * PROBE-PD-AOJ-001: CRR ATTACKING OBJECTS — "An object has Health
 *   specified by mission rules; when damage >= Health, the object is
 *   destroyed."
 *
 * Slice 3 rewrite (alexanbv 2026-05-10): the legacy `game.crateHealth`
 * mechanism was replaced by the unified object-damage pipeline
 * (`src/game/object-damage-pipeline.js`). Crates are now declared as
 * mission-rule `damageableObjects` and their HP lives in
 * `game.objectHealth[objectId]`. All damage routes through
 * `applyDamageToObject`, which:
 *   1. Validates the object id and reads `game.objectHealth[id]`.
 *   2. Subtracts damage with a non-negative floor:
 *      `newHp = Math.max(0, cur - amount)`.
 *   3. On `newHp === 0`, logs "{name} destroyed!", deletes from
 *      `game.objectPositions`, fires `splashOnDefeat` via the figure-
 *      damage adapter (Devaron crate = 2 Damage within 1).
 *
 * The combat-bridge.js npcType==='crate' attack block + fireBlast object
 * loop both route through this single function. There is no longer any
 * direct `game.crateHealth[origCoord] -= damage` site in `src/`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const PIPE_SRC = readFileSync(resolve(ROOT, 'src/game/object-damage-pipeline.js'), 'utf8');
const CB_SRC = readFileSync(resolve(ROOT, 'src/engine/combat-bridge.js'), 'utf8');
const FIRE_SRC = readFileSync(resolve(ROOT, 'src/handlers/after-attack-fire.js'), 'utf8');

describe('PROBE-PD-AOJ-001: crates destroyed when accumulated damage >= mission-specified Health (via unified object-damage pipeline)', () => {
  it('001a: pipeline — applyDamageToObject subtracts amount with non-negative floor (HP never goes negative)', () => {
    assert.match(PIPE_SRC,
      /const newHp = Math\.max\(0, cur - amount\);/,
      'applyDamageToObject must subtract with non-negative floor — CRR-AOJ-001');
  });

  it('001b: pipeline — destruction threshold is `newHp > 0 ? not-defeated : defeated` (damage >= Health)', () => {
    assert.match(PIPE_SRC,
      /if \(newHp > 0\) \{\s*\n\s*return \{ applied: true, prevHp, newHp, defeated: false \};/,
      'defeat threshold must trigger at newHp == 0 (not < 0) — CRR-AOJ-001');
  });

  it('001c: pipeline — destruction removes object from positions', () => {
    assert.match(PIPE_SRC,
      /if \(game\.objectPositions\) delete game\.objectPositions\[objectId\];/,
      'destruction must delete objectPositions[objectId] — CRR-AOJ-001');
  });

  it('001d: pipeline — destruction log fires with "destroyed" wording when HP reaches 0', () => {
    assert.match(PIPE_SRC,
      /\*\*\$\{objName\}\*\* destroyed!/,
      'destruction log must state "destroyed" — CRR-AOJ-001');
  });

  it('001e: pipeline — splashOnDefeat fires through the figure-damage adapter (Devaron crate = 2 within 1)', () => {
    assert.match(PIPE_SRC,
      /typeof ctx\?\.applyFigureDamageAt === 'function'/,
      'splashOnDefeat must delegate to ctx.applyFigureDamageAt — CRR-AOJ-001');
    assert.match(PIPE_SRC,
      /splashTargets = await ctx\.applyFigureDamageAt\(coord, radius, splash\.amount,/,
      'splashOnDefeat must call applyFigureDamageAt with coord/radius/amount — CRR-AOJ-001');
  });

  it('001f: caller — combat-bridge.js npcType==="crate" attack block routes through applyDamageToObject', () => {
    assert.match(CB_SRC,
      /applyDamageToObject\(game, _crateCtx, \{\s*objectId, amount: damage,/,
      'crate-attack block must call applyDamageToObject — CRR-AOJ-001');
    // Legacy crateHealth decrement must be gone.
    assert.doesNotMatch(CB_SRC,
      /game\.crateHealth\[origCoord\] = Math\.max\(0,/,
      'legacy crateHealth decrement must be removed — Slice 3');
  });

  it('001g: caller — fireBlast (after-attack-fire.js) damages objects via applyDamageToObject within blast radius', () => {
    assert.match(FIRE_SRC,
      /getDamageableObjectsWithinN\(game, .*, 1\)/,
      'fireBlast must enumerate damageable objects within 1 of target — CRR-AOJ-001');
    assert.match(FIRE_SRC,
      /applyDamageToObject\(game, _blastObjCtx, \{\s*objectId: objId, amount, attackerPlayerNum,/,
      'fireBlast must apply Blast damage via applyDamageToObject — CRR-AOJ-001');
  });
});
