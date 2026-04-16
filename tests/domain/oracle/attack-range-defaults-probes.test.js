/**
 * Tier 3 Oracle Probes: Ranged Attack Target Range Defaults
 *
 * Regression probes for the systemic targeting bug where DCs lacking an explicit
 * `attack.range` field (which is effectively every DC in `data/dc-effects.json`)
 * were being capped at 3 spaces for target selection, silently dropping valid
 * long-range targets before the accuracy check could fire.
 *
 * Root cause was 5 copies of `attackInfo.range || [1, 3]` in
 * `src/handlers/dc-play-area.js`. All replaced with `defaultAttackRange(attackInfo)`,
 * which returns `[1, 99]` for ranged attacks, `[1, 1]` for melee, and the
 * explicit range when set. The real range limit is enforced by the accuracy
 * check in `src/game/combat.js` (~line 240): `totalAccuracy < distanceToTarget → miss`.
 *
 * Rule claims enforced:
 *   PROBE-ATR-001: Ranged attack with no explicit range allows targets beyond 3 spaces
 *   PROBE-ATR-002: Melee attack with no explicit range stays adjacent-only
 *   PROBE-ATR-003: Explicit attack.range overrides the default
 *   PROBE-ATR-004: Reach extends melee from 1 to 2 but does not shrink ranged
 *   PROBE-ATR-005: Accuracy check still misses when dice do not produce enough accuracy
 *   PROBE-ATR-006: No `|| [1, 3]` range default remains in dc-play-area.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defaultAttackRange } from '../../../src/handlers/dc-play-area.js';
import { computeCombatResult } from '../../../src/game/combat.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── PROBE-ATR-001: Ranged default is effectively unbounded ──────────────────

describe('PROBE-ATR-001: Ranged attack with no explicit range allows distant targets', () => {
  it('001a: ranged attack with no range field → maxRange well beyond 3', () => {
    const [minRange, maxRange] = defaultAttackRange({ type: 'range', dice: ['red', 'blue', 'yellow'] });
    assert.equal(minRange, 1, 'minRange must be 1');
    assert.ok(maxRange >= 5,
      `Ranged default maxRange must allow distance-5 targets, got ${maxRange}`);
    assert.ok(maxRange > 3,
      `Ranged default maxRange must exceed the legacy buggy cap of 3, got ${maxRange}`);
  });

  it('001b: target at distance 5 is within default ranged bounds', () => {
    const [minRange, maxRange] = defaultAttackRange({ type: 'range', dice: ['red'] });
    const dist = 5;
    assert.ok(dist >= minRange && dist <= maxRange,
      `Distance ${dist} must pass filter [${minRange}, ${maxRange}]`);
  });
});

// ── PROBE-ATR-002: Melee stays adjacent-only ─────────────────────────────────

describe('PROBE-ATR-002: Melee attack with no explicit range stays adjacent-only', () => {
  it('002a: melee attack with no range field → [1, 1]', () => {
    assert.deepEqual(
      defaultAttackRange({ type: 'melee', dice: ['red'] }),
      [1, 1]
    );
  });

  it('002b: distance 2 is outside melee default bounds', () => {
    const [minRange, maxRange] = defaultAttackRange({ type: 'melee', dice: ['red'] });
    assert.ok(!(2 >= minRange && 2 <= maxRange),
      `Distance 2 must NOT pass melee filter [${minRange}, ${maxRange}]`);
  });
});

// ── PROBE-ATR-003: Explicit range overrides default ──────────────────────────

describe('PROBE-ATR-003: Explicit attack.range overrides default', () => {
  it('003a: explicit [2, 4] is preserved', () => {
    assert.deepEqual(
      defaultAttackRange({ type: 'range', range: [2, 4], dice: ['red'] }),
      [2, 4]
    );
  });

  it('003b: explicit [1, 1] on a nominally ranged weapon is preserved', () => {
    assert.deepEqual(
      defaultAttackRange({ type: 'range', range: [1, 1], dice: ['red'] }),
      [1, 1]
    );
  });

  it('003c: missing type treated as ranged (defensive default)', () => {
    assert.deepEqual(
      defaultAttackRange({ dice: ['red'] }),
      [1, 99]
    );
  });
});

// ── PROBE-ATR-004: Reach interaction ─────────────────────────────────────────
//
// Mirrors the call-site formula in dc-play-area.js:
//   const effectiveMaxRange = hasReach && maxRange < 2 ? 2 : maxRange;

describe('PROBE-ATR-004: Reach extends melee to 2 but does not shrink ranged', () => {
  function applyReach(maxRange, hasReach) {
    return hasReach && maxRange < 2 ? 2 : maxRange;
  }

  it('004a: Reach lifts melee from 1 to 2', () => {
    const [, maxRange] = defaultAttackRange({ type: 'melee', dice: ['red'] });
    assert.equal(applyReach(maxRange, true), 2);
  });

  it('004b: Reach does not change ranged (stays 99)', () => {
    const [, maxRange] = defaultAttackRange({ type: 'range', dice: ['red'] });
    assert.equal(applyReach(maxRange, true), 99);
  });

  it('004c: melee without Reach stays adjacent-only', () => {
    const [, maxRange] = defaultAttackRange({ type: 'melee', dice: ['red'] });
    assert.equal(applyReach(maxRange, false), 1);
  });

  it('004d: Reach does not extend melee with explicit range [1, 3]', () => {
    // A melee weapon with explicit range [1, 3] is already wider than 2; Reach is a no-op.
    const [, maxRange] = defaultAttackRange({ type: 'melee', range: [1, 3], dice: ['red'] });
    assert.equal(applyReach(maxRange, true), 3);
  });
});

// ── PROBE-ATR-005: Accuracy check remains the real range limit ───────────────

describe('PROBE-ATR-005: Combat resolution still misses on insufficient accuracy', () => {
  it('005a: ranged attack with 2 accuracy rolled vs distance-5 target → miss', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 2, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 5,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, false,
      `Expected miss (acc 2 < dist 5). Got: hit=${result.hit}, damage=${result.damage}`);
    assert.match(result.resultText || '', /insufficient accuracy/i);
  });

  it('005b: ranged attack with 6 accuracy rolled vs distance-5 target → hit', () => {
    const result = computeCombatResult({
      attackRoll: { acc: 6, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: true,
      distanceToTarget: 5,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, true,
      `Expected hit (acc 6 ≥ dist 5). Got: hit=${result.hit}`);
  });

  it('005c: melee attack ignores distance in accuracy check', () => {
    // Melee attacks have isRanged=false — the totalAccuracy < distanceToTarget branch is skipped.
    const result = computeCombatResult({
      attackRoll: { acc: 0, dmg: 3, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
      isRanged: false,
      distanceToTarget: 1,
      surgeDamage: 0,
      surgePierce: 0,
      surgeAccuracy: 0,
    });
    assert.equal(result.hit, true, 'Melee with 0 accuracy must still hit at distance 1');
  });
});

// ── PROBE-ATR-006: Source-level regression guard ─────────────────────────────

describe('PROBE-ATR-006: No residual "|| [1, 3]" range fallback in handler source', () => {
  it('006: dc-play-area.js contains no `|| [1, 3]` range default', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/handlers/dc-play-area.js'),
      'utf8'
    );
    const badPattern = /\|\|\s*\[\s*1\s*,\s*3\s*\]/g;
    const matches = src.match(badPattern) || [];
    assert.equal(matches.length, 0,
      `Found ${matches.length} residual \`|| [1, 3]\` default(s) in dc-play-area.js. ` +
      `Must use defaultAttackRange(attackInfo) instead.`);
  });
});
