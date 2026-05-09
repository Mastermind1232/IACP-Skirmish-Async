/**
 * Oracle tests for micro-fix correctness pass 2:
 * 1. Black Market defeat bypass — lethal strain must route through processFigureDefeat
 * 2. Pending-state round-cleanup gaps (pendingDcAbilityChoice, pendingFluctuationSwapQueue/First)
 * 3. Interrupt stale-state gaps (drivenByHatredForceChoke, pendingSuppressiveFireMp)
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
// BLACK MARKET DEFEAT BYPASS FIX
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-BMDEFEAT-001: Black Market uses reduceHp, not raw dcHealthState ──
describe('ORACLE-BMDEFEAT-001: Black Market strain uses canonical HP path', () => {
  it('handleBlackMarket applies strain via the canonical applyStrain pipeline', () => {
    // 2026-05-09: migrated from `_applyDamage(viaStrain:true)` direct call
    // to the `applyStrain` pipeline, so Fireproof / Headhunter / per-strain
    // choice / Under Duress / Paz interactions fire correctly. The
    // damage branch still routes through _applyDamage internally (via
    // _applyDamageFromStrain) — the call from the handler itself is now
    // applyStrain.
    const src = readSrc('src/handlers/interrupts.js');
    const bmIdx = src.indexOf('function handleBlackMarket');
    assert.ok(bmIdx > 0, 'handleBlackMarket found');
    const fnEnd = src.indexOf('\nexport ', bmIdx + 1);
    const block = src.slice(bmIdx, fnEnd > bmIdx ? fnEnd : bmIdx + 3000);
    assert.ok(/applyStrain\(game,[\s\S]*?figureKey: smugglerFk/.test(block),
      'Black Market must apply strain via the applyStrain pipeline (smugglerFk)');
    assert.ok(block.includes("source: 'Black Market'"),
      'Black Market strain must be tagged with source: "Black Market"');
  });

  it('handleBlackMarket no longer mutates dcHealthState directly', () => {
    const src = readSrc('src/handlers/interrupts.js');
    const bmIdx = src.indexOf('function handleBlackMarket');
    const fnEnd = src.indexOf('\nexport ', bmIdx + 1);
    const block = src.slice(bmIdx, fnEnd > bmIdx ? fnEnd : bmIdx + 3000);
    assert.ok(!block.includes('_bmHs[smugglerFigIdx] ='),
      'Black Market must not directly mutate healthState array');
  });

  it('handleBlackMarket calls processFigureDefeat on lethal strain', () => {
    const src = readSrc('src/handlers/interrupts.js');
    const bmIdx = src.indexOf('function handleBlackMarket');
    const fnEnd = src.indexOf('\nexport ', bmIdx + 1);
    const block = src.slice(bmIdx, fnEnd > bmIdx ? fnEnd : bmIdx + 3000);
    assert.ok(block.includes('processFigureDefeat'),
      'Black Market must call processFigureDefeat when strain kills');
  });

  it('handleBlackMarket destructures processFigureDefeat from ctx', () => {
    const src = readSrc('src/handlers/interrupts.js');
    const bmIdx = src.indexOf('function handleBlackMarket');
    const block = src.slice(bmIdx, bmIdx + 300);
    assert.ok(block.includes('processFigureDefeat'),
      'processFigureDefeat must be in ctx destructure');
  });
});

// ── B-BMDEFEAT-001: Lethal Black Market strain triggers defeat pipeline ────
describe('B-BMDEFEAT-001: Lethal Black Market strain routes through reduceHp', () => {
  it('reduceHp returns wasDefeated:true when strain kills a 1-HP figure', async () => {
    const { reduceHp } = await import('../../../src/game/damage-helpers.js');
    const dcHealthState = new Map();
    dcHealthState.set('smuggler-msg-1', [[1, 5]]); // 1 HP remaining, max 5
    const game = {
      p1DcList: [{ healthState: [[1, 5]] }],
      p1DcMessageIds: ['smuggler-msg-1'],
    };
    const result = reduceHp(dcHealthState, game, 'smuggler-msg-1', 0, 1, 1);
    assert.strictEqual(result.prevHp, 1, 'prevHp is 1');
    assert.strictEqual(result.newHp, 0, 'newHp is 0');
    assert.strictEqual(result.wasDefeated, true, 'wasDefeated is true');
  });

  it('reduceHp returns wasDefeated:false when strain does not kill', async () => {
    const { reduceHp } = await import('../../../src/game/damage-helpers.js');
    const dcHealthState = new Map();
    dcHealthState.set('smuggler-msg-2', [[3, 5]]);
    const game = {
      p1DcList: [{ healthState: [[3, 5]] }],
      p1DcMessageIds: ['smuggler-msg-2'],
    };
    const result = reduceHp(dcHealthState, game, 'smuggler-msg-2', 0, 1, 1);
    assert.strictEqual(result.prevHp, 3, 'prevHp is 3');
    assert.strictEqual(result.newHp, 2, 'newHp is 2');
    assert.strictEqual(result.wasDefeated, false, 'wasDefeated is false');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PENDING-STATE ROUND-CLEANUP GAPS
// ══════════════════════════════════════════════════════════════════════════════

// ── ORACLE-PENDGAP-001: New fields in cleanup lists ────────────────────────
describe('ORACLE-PENDGAP-001: Pending-state gaps added to round cleanup', () => {
  it('pendingDcAbilityChoice is in ROUND_OBJECT_FLAGS', async () => {
    const { ROUND_OBJECT_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_OBJECT_FLAGS.includes('pendingDcAbilityChoice'),
      'pendingDcAbilityChoice must be cleaned up at round start');
  });

  it('pendingSuppressiveFireMp is in ROUND_NULL_FLAGS', async () => {
    const { ROUND_NULL_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_NULL_FLAGS.includes('pendingSuppressiveFireMp'),
      'pendingSuppressiveFireMp must be cleaned up at round start');
  });

  it('pendingFluctuationSwapQueue is in ROUND_DELETE_FLAGS', async () => {
    const { ROUND_DELETE_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_DELETE_FLAGS.includes('pendingFluctuationSwapQueue'),
      'pendingFluctuationSwapQueue must be cleaned up at round start');
  });

  it('pendingFluctuationSwapFirst is in ROUND_DELETE_FLAGS', async () => {
    const { ROUND_DELETE_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_DELETE_FLAGS.includes('pendingFluctuationSwapFirst'),
      'pendingFluctuationSwapFirst must be cleaned up at round start');
  });

  it('drivenByHatredForceChoke is in ROUND_DELETE_FLAGS', async () => {
    const { ROUND_DELETE_FLAGS } = await import('../../../src/game/activation-state.js');
    assert.ok(ROUND_DELETE_FLAGS.includes('drivenByHatredForceChoke'),
      'drivenByHatredForceChoke must be cleaned up at round start');
  });
});

// ── B-PENDGAP-001: cleanupRoundStart clears the new fields ────────────────
describe('B-PENDGAP-001: cleanupRoundStart clears newly added fields at runtime', () => {
  it('pendingDcAbilityChoice is reset to {} after round cleanup', async () => {
    const { cleanupRoundStart } = await import('../../../src/game/activation-state.js');
    const game = {
      pendingDcAbilityChoice: { 'msg1_0': { abilityId: 'test', playerNum: 1 } },
    };
    cleanupRoundStart(game);
    assert.deepStrictEqual(game.pendingDcAbilityChoice, {},
      'pendingDcAbilityChoice reset to empty object');
  });

  it('pendingSuppressiveFireMp is nulled after round cleanup', async () => {
    const { cleanupRoundStart } = await import('../../../src/game/activation-state.js');
    const game = {
      pendingSuppressiveFireMp: { attackerPlayerNum: 1 },
    };
    cleanupRoundStart(game);
    assert.strictEqual(game.pendingSuppressiveFireMp, null,
      'pendingSuppressiveFireMp nulled');
  });

  it('pendingFluctuationSwapQueue is deleted after round cleanup', async () => {
    const { cleanupRoundStart } = await import('../../../src/game/activation-state.js');
    const game = {
      pendingFluctuationSwapQueue: [1, 2],
      pendingFluctuationSwapFirst: 'a3',
    };
    cleanupRoundStart(game);
    assert.strictEqual(game.pendingFluctuationSwapQueue, undefined,
      'pendingFluctuationSwapQueue deleted');
    assert.strictEqual(game.pendingFluctuationSwapFirst, undefined,
      'pendingFluctuationSwapFirst deleted');
  });

  it('drivenByHatredForceChoke is deleted after round cleanup', async () => {
    const { cleanupRoundStart } = await import('../../../src/game/activation-state.js');
    const game = {
      drivenByHatredForceChoke: { 'msg-vader-1': true },
    };
    cleanupRoundStart(game);
    assert.strictEqual(game.drivenByHatredForceChoke, undefined,
      'drivenByHatredForceChoke deleted');
  });
});

// ── B-PENDGAP-002: pendingCombat is intentionally NOT in round cleanup ─────
describe('B-PENDGAP-002: pendingCombat intentionally handled by recovery only', () => {
  it('pendingCombat is NOT in any ROUND cleanup list (would be destructive)', async () => {
    const { ROUND_OBJECT_FLAGS, ROUND_NULL_FLAGS, ROUND_ARRAY_FLAGS, ROUND_DELETE_FLAGS } =
      await import('../../../src/game/activation-state.js');
    const allFlags = [...ROUND_OBJECT_FLAGS, ...ROUND_NULL_FLAGS, ...ROUND_ARRAY_FLAGS, ...ROUND_DELETE_FLAGS];
    assert.ok(!allFlags.includes('pendingCombat'),
      'pendingCombat must NOT be in round cleanup — recovery.js is the intended handler');
  });

  it('pendingCombat is detected by recovery.js getRecoveryReason', async () => {
    const { getRecoveryReason } = await import('../../../src/engine/recovery.js');
    const game = { pendingCombat: { rerollPhase: false } };
    const reason = getRecoveryReason(game);
    assert.ok(reason && reason.includes('pendingCombat'),
      'recovery.js must detect pendingCombat');
  });
});
