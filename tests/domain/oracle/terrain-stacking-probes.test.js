/**
 * Tier 3 Legality-Oracle Probes: Difficult + Hostile Terrain Stacking (B4 / D2)
 *
 * Phase-2 B4 closure pass. The cost calculation in
 * src/game/movement.js evaluateMovementStep (lines 574-584) is the
 * single place where the difficult-terrain +1 and the hostile-figure +1
 * are summed into movement cost. Both increments are additive:
 *
 *   baseCost = 1
 *   if (enteringDifficult) extraCost += 1
 *   if (enteringHostile && !profile.ignoreFigureCost) extraCost += 1
 *   return baseCost + extraCost
 *
 * Prior tests exercise difficult terrain (rubble/hostile terrain data)
 * and hostile occupancy individually through selfplay games, but no test
 * asserts the stacked cost on a single cell, and no test pins that
 * profile.ignoreDifficult and profile.ignoreFigureCost suppress ONLY
 * their own increment (a subtle class of Survivalist/Efficient-Travel
 * refactor drift).
 *
 * PROBE-TERRAIN-001: baseline normal cell = 1
 * PROBE-TERRAIN-002: difficult alone = 2
 * PROBE-TERRAIN-003: hostile alone = 2
 * PROBE-TERRAIN-004: difficult + hostile stack = 3
 * PROBE-TERRAIN-005: ignoreDifficult suppresses ONLY difficult
 * PROBE-TERRAIN-006: ignoreFigureCost suppresses ONLY hostile
 * PROBE-TERRAIN-007: both ignores on stacked cell = 1
 * PROBE-TERRAIN-008: source pin on evaluateMovementStep cost lines
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTempBoardState, computeMovementCache } from '../../../src/game/movement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Minimal synthetic map: 3-cell corridor a1—a2—a3 ────────────────────────
// Probing a2 as endpoint keeps the probe fixture-free and isolates the
// entering-step cost exactly. a3 exists so a2 is not the board boundary
// (noop, but defensive against any future BFS-boundary optimisation).
const BASE_MAP = {
  spaces: ['a1', 'a2', 'a3'],
  adjacency: { a1: ['a2'], a2: ['a1', 'a3'], a3: ['a2'] },
  terrain: {},
  blocking: [],
  movementBlockingEdges: [],
  impassableEdges: [],
};

const BASE_PROFILE = {
  size: '1x1', cols: 1, rows: 1,
  isLarge: false, allowDiagonal: true, canRotate: false,
  isMassive: false, isMobile: false,
  ignoreDifficult: false, ignoreBlocking: false, ignoreFigureCost: false,
  canEndOnOccupied: false,
  treatBlockingAsDifficult: false,
};

function costToA2({ difficult = false, hostile = false, profileOverrides = {} } = {}) {
  const mapSpaces = { ...BASE_MAP, terrain: difficult ? { a2: 'difficult' } : {} };
  const occupied = [];
  const hostileSet = hostile ? ['a2'] : null;
  const board = buildTempBoardState(mapSpaces, occupied, hostileSet);
  const profile = { ...BASE_PROFILE, ...profileOverrides };
  const cache = computeMovementCache('a1', 10, board, profile);
  return cache.cells.get('a2')?.cost;
}

// ── PROBE-TERRAIN-001: baseline ────────────────────────────────────────────

describe('PROBE-TERRAIN-001: baseline — normal cell costs 1 MP', () => {
  it('entering a normal cell costs 1 MP', () => {
    assert.equal(costToA2(), 1);
  });
});

// ── PROBE-TERRAIN-002: difficult alone ─────────────────────────────────────

describe('PROBE-TERRAIN-002: difficult alone — +1 = 2 MP', () => {
  it('entering a difficult-only cell costs 2 MP', () => {
    assert.equal(costToA2({ difficult: true }), 2);
  });
});

// ── PROBE-TERRAIN-003: hostile alone ───────────────────────────────────────

describe('PROBE-TERRAIN-003: hostile alone — +1 = 2 MP', () => {
  it('entering a hostile-only cell costs 2 MP', () => {
    assert.equal(costToA2({ hostile: true }), 2);
  });
});

// ── PROBE-TERRAIN-004: difficult + hostile stack ───────────────────────────

describe('PROBE-TERRAIN-004: difficult + hostile stack — +1 +1 = 3 MP', () => {
  it('entering a cell that is both difficult terrain and hostile-occupied costs 3 MP', () => {
    assert.equal(costToA2({ difficult: true, hostile: true }), 3);
  });
  it('stacked cost equals sum of individual increments (baseline + diff + host - 2*baseline)', () => {
    const base = costToA2();
    const diffOnly = costToA2({ difficult: true });
    const hostOnly = costToA2({ hostile: true });
    const stacked = costToA2({ difficult: true, hostile: true });
    assert.equal(stacked, base + (diffOnly - base) + (hostOnly - base),
      'stack should be base + difficult-increment + hostile-increment, not max(a,b) or multiplicative');
  });
});

// ── PROBE-TERRAIN-005: ignoreDifficult suppresses ONLY difficult ───────────

describe('PROBE-TERRAIN-005: ignoreDifficult suppresses ONLY the difficult +1', () => {
  it('ignoreDifficult on difficult-only cell → 1 MP', () => {
    assert.equal(costToA2({ difficult: true, profileOverrides: { ignoreDifficult: true } }), 1);
  });
  it('ignoreDifficult on stacked cell still pays hostile +1 → 2 MP', () => {
    assert.equal(costToA2({ difficult: true, hostile: true, profileOverrides: { ignoreDifficult: true } }), 2);
  });
});

// ── PROBE-TERRAIN-006: ignoreFigureCost suppresses ONLY hostile ────────────

describe('PROBE-TERRAIN-006: ignoreFigureCost suppresses ONLY the hostile +1', () => {
  it('ignoreFigureCost on hostile-only cell → 1 MP', () => {
    assert.equal(costToA2({ hostile: true, profileOverrides: { ignoreFigureCost: true } }), 1);
  });
  it('ignoreFigureCost on stacked cell still pays difficult +1 → 2 MP', () => {
    assert.equal(costToA2({ difficult: true, hostile: true, profileOverrides: { ignoreFigureCost: true } }), 2);
  });
});

// ── PROBE-TERRAIN-007: both ignores on stacked cell ────────────────────────

describe('PROBE-TERRAIN-007: both ignores on stacked cell → 1 MP', () => {
  it('ignoreDifficult + ignoreFigureCost on stacked cell collapses to base', () => {
    assert.equal(
      costToA2({ difficult: true, hostile: true, profileOverrides: { ignoreDifficult: true, ignoreFigureCost: true } }),
      1
    );
  });
});

// ── PROBE-TERRAIN-008: source pin ──────────────────────────────────────────

describe('PROBE-TERRAIN-008: source pin — cost lines in evaluateMovementStep', () => {
  it('pins the additive-increment cost construction in movement.js', () => {
    const movementPath = resolve(__dirname, '../../../src/game/movement.js');
    const src = readFileSync(movementPath, 'utf8');
    // Base cost starts at 1
    assert.match(src, /const\s+baseCost\s*=\s*1\s*;/,
      'baseCost is literal 1');
    // Difficult increment is additive and gated by enteringDifficult
    assert.match(src, /if\s*\(\s*enteringDifficult\s*\)\s*extraCost\s*\+=\s*1\s*;/,
      'difficult adds exactly +1 to extraCost');
    // Hostile increment is additive and gated by enteringHostile AND !ignoreFigureCost
    assert.match(src, /if\s*\(\s*enteringHostile\s*&&\s*!profile\.ignoreFigureCost\s*\)\s*extraCost\s*\+=\s*1\s*;/,
      'hostile adds exactly +1 to extraCost, suppressed by ignoreFigureCost only');
    // Difficult branch gated by !ignoreDifficult (read from enteringDifficult expr)
    assert.match(src, /enteringDifficult\s*=\s*\n?\s*!profile\.ignoreDifficult/,
      'enteringDifficult is gated by !ignoreDifficult');
    // Return: baseCost + extraCost (the additive shape itself)
    assert.match(src, /cost:\s*baseCost\s*\+\s*extraCost/,
      'final cost is baseCost + extraCost (pure additive, not max/clamp)');
  });
});
