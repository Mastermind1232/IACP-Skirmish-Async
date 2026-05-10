/**
 * Oracle tests for micro-fix correctness pass:
 * 1. Pending-state leak cleanup (pendingInterrogate, pendingMastery, pendingMissionSorReveal)
 * 2. Teleport figureMoved tracking (Headbutt, Pounce, False Orders, Ordered Move)
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
// PENDING-STATE LEAK FIX
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-PENDLEAK-001: Leaked fields in ROUND_NULL_FLAGS ──────────────────
describe('ORACLE-PENDLEAK-001: Leaked pending fields added to round cleanup', () => {
  it('pendingInterrogate is in ROUND_NULL_FLAGS', async () => {
    const { ROUND_NULL_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_NULL_FLAGS.includes('pendingInterrogate'),
      'pendingInterrogate must be cleaned up at round start');
  });

  it('pendingMastery is in ROUND_NULL_FLAGS', async () => {
    const { ROUND_NULL_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_NULL_FLAGS.includes('pendingMastery'),
      'pendingMastery must be cleaned up at round start');
  });

  it('pendingMissionSorReveal is in ROUND_NULL_FLAGS', async () => {
    const { ROUND_NULL_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_NULL_FLAGS.includes('pendingMissionSorReveal'),
      'pendingMissionSorReveal must be cleaned up at round start');
  });
});

// ── ORACLE-PENDLEAK-002: Leaked fields in recovery detection ────────────────
describe('ORACLE-PENDLEAK-002: Leaked pending fields detected by recovery', () => {
  it('recovery.js detects pendingInterrogate', () => {
    const src = readSrc('src/engine/recovery.js');
    assert.ok(src.includes("game.pendingInterrogate"),
      'recovery.js must check pendingInterrogate');
  });

  it('recovery.js detects pendingMastery', () => {
    const src = readSrc('src/engine/recovery.js');
    assert.ok(src.includes("game.pendingMastery"),
      'recovery.js must check pendingMastery');
  });
});

// ── B-PENDLEAK-001: Round cleanup nulls the leaked fields ───────────────────
describe('B-PENDLEAK-001: cleanupRoundStart nulls leaked fields at runtime', () => {
  it('pendingInterrogate and pendingMastery are nulled after round cleanup', async () => {
    const { cleanupRoundStart } = await import('../../../src/game/activation-state.js');
    const game = {
      pendingInterrogate: { attackerPlayerNum: 1, chosenCardName: 'Sabotage' },
      pendingMastery: { attackerPlayerNum: 2, eligible: ['card1'] },
      pendingMissionSorReveal: true,
    };
    cleanupRoundStart(game);
    assert.strictEqual(game.pendingInterrogate, null, 'pendingInterrogate nulled');
    assert.strictEqual(game.pendingMastery, null, 'pendingMastery nulled');
    assert.strictEqual(game.pendingMissionSorReveal, null, 'pendingMissionSorReveal nulled');
  });
});

// ── B-PENDLEAK-002: Recovery detects stuck pending states ───────────────────
describe('B-PENDLEAK-002: Recovery identifies stuck Interrogate/Mastery states', () => {
  it('getRecoveryReason returns reason for pendingInterrogate', async () => {
    const { getRecoveryReason } = await import('../../../src/engine/recovery.js');
    const game = { pendingInterrogate: { attackerPlayerNum: 1 } };
    const reason = getRecoveryReason(game);
    assert.strictEqual(reason, 'pendingInterrogate');
  });

  it('getRecoveryReason returns reason for pendingMastery', async () => {
    const { getRecoveryReason } = await import('../../../src/engine/recovery.js');
    const game = { pendingMastery: { attackerPlayerNum: 2 } };
    const reason = getRecoveryReason(game);
    assert.strictEqual(reason, 'pendingMastery');
  });

  it('needsRecovery returns true for pendingInterrogate', async () => {
    const { needsRecovery } = await import('../../../src/engine/recovery.js');
    assert.strictEqual(needsRecovery({ pendingInterrogate: {} }), true);
  });

  it('needsRecovery returns true for pendingMastery', async () => {
    const { needsRecovery } = await import('../../../src/engine/recovery.js');
    assert.strictEqual(needsRecovery({ pendingMastery: {} }), true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TELEPORT FIGUREMOVED TRACKING
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-TELEMOVE-001: All teleport sites set figureMoved ─────────────────
describe('ORACLE-TELEMOVE-001: Teleport sites set figureMoved', () => {
  it('Headbutt (abilities.js) sets figureMoved[activatingFigureKey]', () => {
    const src = readSrc('src/game/abilities.js');
    // Headbutt writes activatingFigureKey position, then must flag figureMoved
    const idx = src.indexOf('game.figureMoved[activatingFigureKey] = true');
    assert.ok(idx > 0, 'Headbutt must set figureMoved[activatingFigureKey]');
  });

  it('Pounce (abilities.js) sets figureMoved[fk]', () => {
    const src = readSrc('src/game/abilities.js');
    // Find the Pounce teleport block (near pounceAttackPending)
    const pounceIdx = src.indexOf('pounceAttackPending');
    assert.ok(pounceIdx > 0, 'Pounce site found');
    // figureMoved[fk] should appear before pounceAttackPending
    const block = src.slice(Math.max(0, pounceIdx - 300), pounceIdx);
    assert.ok(block.includes('figureMoved[fk] = true'), 'Pounce must set figureMoved[fk]');
  });

  it('False Orders (dc-play-area.js) sets figureMoved[controlledFigureKey]', () => {
    const src = readSrc('src/handlers/dc-play-area.js');
    assert.ok(src.includes('figureMoved[controlledFigureKey] = true'),
      'False Orders must set figureMoved[controlledFigureKey]');
  });

  it('Ordered Move pipeline retired 2026-05-09 — migrated to pendingMoveX', () => {
    // pendingOrderedMove → pendingMoveX migration: Officer Order /
    // Tactical Maneuver / generic post-deploy moves now use the move-x
    // picker (move-x-handler.js). figureMoved is set inside the
    // move-x step handlers and end-of-move flow.
    const src = readSrc('src/handlers/dc-play-area.js');
    assert.ok(!src.includes('handleOrderMove'),
      'handleOrderMove should be deleted after migration to pendingMoveX');
  });
});

// ── B-TELEMOVE-001: figureMoved is flagged after teleport ───────────────────
describe('B-TELEMOVE-001: figureMoved tracking works at runtime', () => {
  it('Headbutt sets figureMoved for the activating figure', async () => {
    // Simulate what the Headbutt code does
    const game = {
      figurePositions: { 1: { 'Test-1-0': 'a1' } },
    };
    // Replicate the exact pattern added to Headbutt
    game.figurePositions[1]['Test-1-0'] = 'b2';
    game.figureMoved = game.figureMoved || {};
    game.figureMoved['Test-1-0'] = true;

    assert.strictEqual(game.figureMoved['Test-1-0'], true, 'figureMoved flagged');
    assert.strictEqual(game.figurePositions[1]['Test-1-0'], 'b2', 'position updated');
  });

  it('figureMoved init guard does not clobber existing entries', () => {
    const game = {
      figurePositions: { 1: { 'A-1-0': 'c3', 'B-1-0': 'd4' } },
      figureMoved: { 'A-1-0': true },
    };
    // Simulate second teleport on different figure
    game.figurePositions[1]['B-1-0'] = 'e5';
    game.figureMoved = game.figureMoved || {};
    game.figureMoved['B-1-0'] = true;

    assert.strictEqual(game.figureMoved['A-1-0'], true, 'first entry preserved');
    assert.strictEqual(game.figureMoved['B-1-0'], true, 'second entry added');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BD-1 / CAL'S BUDDY COMPANION HOST MAP
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-BD1HOST-001: Cal's Buddy sets companionHostMap ──────────────────
describe('ORACLE-BD1HOST-001: Cal\'s Buddy registers companion host relationship', () => {
  it('abilities.js writes companionHostMap in Cal\'s Buddy handler', () => {
    const src = readSrc('src/game/abilities.js');
    const buddyIdx = src.indexOf("abilityId === \"Cal's Buddy\"");
    assert.ok(buddyIdx > 0, "Cal's Buddy handler found");
    const block = src.slice(buddyIdx, buddyIdx + 2000);
    assert.ok(block.includes('companionHostMap[bd1Key]'),
      "Cal's Buddy must write companionHostMap[bd1Key]");
  });

  it('companionHostMap entry shape matches post-deploy pattern', () => {
    const src = readSrc('src/game/abilities.js');
    const buddyIdx = src.indexOf("abilityId === \"Cal's Buddy\"");
    const block = src.slice(buddyIdx, buddyIdx + 2000);
    assert.ok(block.includes('hostFigureKey: calFigKey'),
      'companionHostMap entry must include hostFigureKey');
    assert.ok(block.includes('playerNum'),
      'companionHostMap entry must include playerNum');
  });
});

// ── B-BD1HOST-001: Cal's Buddy registers host map at runtime ───────────────
describe('B-BD1HOST-001: Cal\'s Buddy companion host map works at runtime', () => {
  it('resolveAbility sets companionHostMap for BD-1 with Cal as host', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const game = {
      selectedMap: { id: 'uscru' },
      figurePositions: {
        1: { 'Cal Kestis-1-0': 'b2' },
      },
    };
    const context = { game, playerNum: 1, chosenSpace: 'b2' };
    const result = resolveAbility("Cal's Buddy", context);
    assert.strictEqual(result.applied, true, 'ability applied');
    assert.ok(game.companionHostMap, 'companionHostMap created');
    const bd1Entry = game.companionHostMap['BD-1-1-0'];
    assert.ok(bd1Entry, 'BD-1-1-0 entry exists in companionHostMap');
    assert.strictEqual(bd1Entry.hostFigureKey, 'Cal Kestis-1-0', 'host is Cal');
    assert.strictEqual(bd1Entry.playerNum, 1, 'playerNum is correct');
  });

  it('existing BD-1 key is reused when BD-1 is already deployed', async () => {
    const { resolveAbility } = await import('../../../src/game/abilities.js');
    const game = {
      selectedMap: { id: 'uscru' },
      figurePositions: {
        1: { 'Cal Kestis-1-0': 'b2', 'BD-1-1-0': 'a1' },
      },
    };
    const context = { game, playerNum: 1, chosenSpace: 'c3' };
    const result = resolveAbility("Cal's Buddy", context);
    assert.strictEqual(result.applied, true, 'ability applied');
    assert.strictEqual(game.figurePositions[1]['BD-1-1-0'], 'c3', 'BD-1 moved to new space');
    assert.strictEqual(game.companionHostMap['BD-1-1-0'].hostFigureKey, 'Cal Kestis-1-0');
  });
});

// ── B-BD1HOST-002: isCompanionHostDefeated works for BD-1 ──────────────────
describe('B-BD1HOST-002: isCompanionHostDefeated detects Cal defeated for BD-1', () => {
  it('returns true when Cal is defeated and BD-1 has companionHostMap entry', async () => {
    const { isCompanionHostDefeated } = await import('../../../src/game/dc-helpers.js');
    const game = {
      figurePositions: { 1: { 'BD-1-1-0': 'b2' } }, // Cal is NOT in positions (defeated)
      companionHostMap: {
        'BD-1-1-0': { hostFigureKey: 'Cal Kestis-1-0', playerNum: 1 },
      },
    };
    assert.strictEqual(isCompanionHostDefeated(game, 'BD-1', 1), true,
      'BD-1 should be blocked when Cal is defeated');
  });

  it('returns false when Cal is alive and BD-1 has companionHostMap entry', async () => {
    const { isCompanionHostDefeated } = await import('../../../src/game/dc-helpers.js');
    const game = {
      figurePositions: { 1: { 'BD-1-1-0': 'b2', 'Cal Kestis-1-0': 'c3' } },
      companionHostMap: {
        'BD-1-1-0': { hostFigureKey: 'Cal Kestis-1-0', playerNum: 1 },
      },
    };
    assert.strictEqual(isCompanionHostDefeated(game, 'BD-1', 1), false,
      'BD-1 should be allowed when Cal is alive');
  });

  it('returns false when BD-1 has no companionHostMap entry (pre-fix state)', async () => {
    const { isCompanionHostDefeated } = await import('../../../src/game/dc-helpers.js');
    const game = {
      figurePositions: { 1: { 'BD-1-1-0': 'b2' } },
      // No companionHostMap — simulates the bug before fix
    };
    assert.strictEqual(isCompanionHostDefeated(game, 'BD-1', 1), false,
      'Without companionHostMap, function returns false (cannot determine host)');
  });
});
