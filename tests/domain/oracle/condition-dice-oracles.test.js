/**
 * Oracle tests for condition→dice bonus extraction:
 * applyConditionWithDie() centralizes the "become Focused → +1 green die" pattern.
 * Phase 1 covers 5 Pattern A sites in combat.js that use applyCondition + dice spread.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

function readSrc(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — applyConditionWithDie()
// ══════════════════════════════════════════════════════════════════════════════

describe('B-CONDDICE-001: applyConditionWithDie applies condition and adds die', () => {
  it('adds green die when Focus is newly applied', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: {} };
    const attackInfo = { dice: ['blue', 'red'] };
    const result = applyConditionWithDie(game, 'Trooper-1-0', 'Focus', attackInfo, 'green');
    assert.strictEqual(result.applied, true, 'condition was applied');
    assert.deepStrictEqual(result.attackInfo.dice, ['blue', 'red', 'green'],
      'green die appended');
    assert.ok(game.figureConditions['Trooper-1-0'].includes('Focus'),
      'Focus condition is on the figure');
  });

  it('does not add die when figure is already Focused', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: { 'Trooper-1-0': ['Focus'] } };
    const attackInfo = { dice: ['blue', 'red'] };
    const result = applyConditionWithDie(game, 'Trooper-1-0', 'Focus', attackInfo, 'green');
    assert.strictEqual(result.applied, false, 'condition was NOT applied (already present)');
    assert.deepStrictEqual(result.attackInfo.dice, ['blue', 'red'],
      'dice unchanged');
  });

  it('initializes dice array when attackInfo has no dice', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: {} };
    const attackInfo = {};
    const result = applyConditionWithDie(game, 'Zuckuss-1-0', 'Focus', attackInfo, 'green');
    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(result.attackInfo.dice, ['green'],
      'dice array created with green die');
  });

  it('does not mutate the original attackInfo object', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: {} };
    const originalDice = ['blue', 'red'];
    const attackInfo = { dice: originalDice };
    const result = applyConditionWithDie(game, 'Trooper-1-0', 'Focus', attackInfo, 'green');
    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(originalDice, ['blue', 'red'],
      'original dice array not mutated');
    assert.notStrictEqual(result.attackInfo, attackInfo,
      'returned attackInfo is a new object');
  });

  it('works for non-Focus conditions (extensibility)', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: {} };
    const attackInfo = { dice: ['red'] };
    const result = applyConditionWithDie(game, 'Hunter-1-0', 'Hide', attackInfo, 'white');
    assert.strictEqual(result.applied, true);
    assert.deepStrictEqual(result.attackInfo.dice, ['red', 'white']);
    assert.ok(game.figureConditions['Hunter-1-0'].includes('Hide'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — combat.js migration
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-CONDDICE-001: Migrated sites use applyConditionWithDie', () => {
  it('combat.js imports applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    assert.ok(src.includes('applyConditionWithDie'),
      'combat.js must import applyConditionWithDie');
  });

  it('Mystic Hunter uses applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf("includes('Mystic Hunter')");
    assert.ok(idx > 0, 'Mystic Hunter site found');
    const block = src.slice(idx, idx + 200);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Mystic Hunter must use applyConditionWithDie');
  });

  it('Focused on the Kill uses applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf("cardNameIncludes(_atkUpgrades, 'Focused on the Kill')");
    assert.ok(idx > 0, 'Focused on the Kill site found');
    const block = src.slice(idx, idx + 600);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Focused on the Kill must use applyConditionWithDie');
  });

  it('Z-6 Trooper uses applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf('Z-6 Trooper Rotary Cannon');
    assert.ok(idx > 0, 'Z-6 Trooper site found');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Z-6 Trooper must use applyConditionWithDie');
  });
});

describe('ORACLE-CONDDICE-002: No remaining inline applyCondition+dice in Pattern A sites', () => {
  it('no applyCondition followed by inline dice spread in combat.js Pattern A region', () => {
    const src = readSrc('src/handlers/combat.js');
    // Pattern A sites were between lines ~1070 and ~1475 (pre-attack setup).
    // Check that the old pattern "applyCondition(game, attackerFigureKey, 'Focus')" followed by
    // "dice: [...(*.dice || []), 'green']" no longer exists in a 5-line window.
    const pattern = /applyCondition\(game, attackerFigureKey, 'Focus'\)\) \{\s*\n\s*.*dice: \[/;
    assert.ok(!pattern.test(src),
      'No inline applyCondition + dice spread should remain for Pattern A sites');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Pattern B sites migrated to applyConditionWithDie
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-CONDDICE-003: Pattern B sites use applyConditionWithDie', () => {
  it('Battle Meditation uses applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf("atkSpecialIds.includes('battle_meditation')");
    assert.ok(idx > 0, 'battle_meditation site found');
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Battle Meditation must use applyConditionWithDie');
  });

  it('Full of Rage (late) uses applyConditionWithDie', () => {
    const src = readSrc('src/handlers/combat.js');
    // The late Full of Rage site is after the pendingCombat write (~line 1637+)
    const pcIdx = src.indexOf('game.pendingCombat = {');
    const region = src.slice(pcIdx);
    const forIdx = region.indexOf("atkSpecialIds.includes('full_of_rage')");
    assert.ok(forIdx > 0, 'Full of Rage late site found');
    const block = region.slice(forIdx, forIdx + 300);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Full of Rage (late) must use applyConditionWithDie');
  });

  it('Advanced Targeting Computer uses applyConditionWithDie', () => {
    // Advanced Targeting Computer was extracted to
    // src/game/adv-targeting-computer-helpers.js during the
    // medium-risk probe grind. Handler now delegates via
    // hasAdvTargetingComputerAbility, and Focus + green-die are
    // named constants. The applyConditionWithDie contract is still
    // enforced at the ATC call site.
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf('hasAdvTargetingComputerAbility(atkSpecialIds)');
    assert.ok(idx > 0, 'Advanced Targeting Computer site found (post-extraction)');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Advanced Targeting Computer must use applyConditionWithDie');
    assert.ok(block.includes('ADV_TARGETING_COMPUTER_CONDITION'),
      'Advanced Targeting Computer must pass ADV_TARGETING_COMPUTER_CONDITION constant');
    assert.ok(block.includes('ADV_TARGETING_COMPUTER_BONUS_DIE'),
      'Advanced Targeting Computer must pass ADV_TARGETING_COMPUTER_BONUS_DIE constant');
  });

  it('Sharpshooter uses applyConditionWithDie', () => {
    // Sharpshooter predicate was extracted to
    // src/game/sharpshooter-helpers.js during the medium-risk probe
    // grind. Handler now delegates slug + range check via
    // hasSharpshooterAbility / sharpshooterInRange, and the Focus
    // condition + bonus die are named constants. The
    // applyConditionWithDie contract is still enforced at the site.
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf('hasSharpshooterAbility(atkSpecialIds) && sharpshooterInRange');
    assert.ok(idx > 0, 'Sharpshooter site found (post-extraction)');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('applyConditionWithDie(game, attackerFigureKey'),
      'Sharpshooter must use applyConditionWithDie');
    assert.ok(block.includes('SHARPSHOOTER_CONDITION'),
      'Sharpshooter must pass SHARPSHOOTER_CONDITION constant');
    assert.ok(block.includes('SHARPSHOOTER_BONUS_DIE'),
      'Sharpshooter must pass SHARPSHOOTER_BONUS_DIE constant');
  });
});

describe('ORACLE-CONDDICE-004: No remaining inline resetCondition+dice in Pattern B sites', () => {
  it('no resetCondition followed by inline dice spread outside Flawless Execution', () => {
    const src = readSrc('src/handlers/combat.js');
    // Find all resetCondition calls in the declare-attack region
    const pcIdx = src.indexOf('game.pendingCombat = {');
    const region = src.slice(pcIdx);
    // Count remaining resetCondition(game, attackerFigureKey, 'Focus') calls
    const matches = region.match(/resetCondition\(game, attackerFigureKey, 'Focus'\)/g) || [];
    assert.strictEqual(matches.length, 1,
      'Only Flawless Execution should still use inline resetCondition (1 call expected)');
  });
});

describe('ORACLE-CONDDICE-005: Flawless Execution intentionally remains inline', () => {
  it('Flawless Execution still uses resetCondition (not applyConditionWithDie)', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf("atkSpecialIds.includes('flawless_execution')");
    assert.ok(idx > 0, 'Flawless Execution site found');
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes("resetCondition(game, attackerFigureKey, 'Focus')"),
      'Flawless Execution must still use resetCondition inline');
    assert.ok(!block.includes('applyConditionWithDie'),
      'Flawless Execution must NOT use applyConditionWithDie (has else-branch)');
  });

  it('Flawless Execution has yellow die else-branch', () => {
    const src = readSrc('src/handlers/combat.js');
    const idx = src.indexOf("atkSpecialIds.includes('flawless_execution')");
    const block = src.slice(idx, idx + 800);
    assert.ok(block.includes("'yellow'"),
      'Flawless Execution else-branch adds yellow die');
    assert.ok(block.includes('pendingPowerTokenGrant'),
      'Flawless Execution else-branch grants power token');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Pattern B migration correctness
// ══════════════════════════════════════════════════════════════════════════════

describe('B-CONDDICE-002: Pattern B site applies Focus + green die when not already Focused', () => {
  it('applyConditionWithDie on unfocused figure adds Focus and green die', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    // Simulate a Pattern B site: figure has no Focus, pendingCombat.attackInfo has dice
    const game = { figureConditions: {} };
    const pendingAttackInfo = { dice: ['blue', 'red', 'green'] };
    const result = applyConditionWithDie(game, 'Diala-1-0', 'Focus', pendingAttackInfo, 'green');
    assert.strictEqual(result.applied, true, 'Focus was applied');
    assert.deepStrictEqual(result.attackInfo.dice, ['blue', 'red', 'green', 'green'],
      'green die appended to existing dice');
    assert.ok(game.figureConditions['Diala-1-0'].includes('Focus'),
      'Focus condition is on the figure');
  });
});

describe('B-CONDDICE-003: Pattern B site rejects Focus + die when already Focused', () => {
  it('applyConditionWithDie on already-Focused figure does not add die', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    // Simulate: an earlier Pattern A site already applied Focus during pre-attack
    const game = { figureConditions: { 'Krrsantan-1-0': ['Focus'] } };
    const pendingAttackInfo = { dice: ['red', 'green'] };
    const result = applyConditionWithDie(game, 'Krrsantan-1-0', 'Focus', pendingAttackInfo, 'green');
    assert.strictEqual(result.applied, false, 'Focus was NOT applied (already present)');
    assert.deepStrictEqual(result.attackInfo.dice, ['red', 'green'],
      'dice unchanged — no extra green die');
  });
});

describe('B-CONDDICE-004: pendingCombat.attackInfo assignment through migrated path', () => {
  it('caller correctly assigns returned attackInfo to game.pendingCombat.attackInfo', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    // Simulate the exact call pattern used in migrated sites
    const game = {
      figureConditions: {},
      pendingCombat: { attackInfo: { dice: ['blue', 'red'] } },
    };
    const result = applyConditionWithDie(game, 'DarkTrooper-1-0', 'Focus', game.pendingCombat.attackInfo, 'green');
    if (result.applied) {
      game.pendingCombat.attackInfo = result.attackInfo;
    }
    assert.deepStrictEqual(game.pendingCombat.attackInfo.dice, ['blue', 'red', 'green'],
      'pendingCombat.attackInfo updated with new dice array');
    // Verify original pendingCombat structure is preserved
    assert.ok(game.pendingCombat.attackInfo !== undefined,
      'pendingCombat.attackInfo still exists');
  });

  it('original pendingCombat.attackInfo is not mutated when Focus already present', async () => {
    const { applyConditionWithDie } = await import('../../../src/game/conditions.js');
    const game = {
      figureConditions: { 'Fennec-1-0': ['Focus'] },
      pendingCombat: { attackInfo: { dice: ['blue', 'green'] } },
    };
    const originalRef = game.pendingCombat.attackInfo;
    const result = applyConditionWithDie(game, 'Fennec-1-0', 'Focus', game.pendingCombat.attackInfo, 'green');
    if (result.applied) {
      game.pendingCombat.attackInfo = result.attackInfo;
    }
    assert.strictEqual(game.pendingCombat.attackInfo, originalRef,
      'attackInfo reference unchanged when condition not applied');
    assert.deepStrictEqual(game.pendingCombat.attackInfo.dice, ['blue', 'green'],
      'dice array unchanged');
  });
});
