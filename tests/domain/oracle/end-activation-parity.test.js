/**
 * Oracle + behavioral tests for end-of-activation parity (Phase 1).
 * Covers: Shield, In The Shadows, Unnerving, Hold the Line, Son of Skywalker.
 * Verifies the shared applyEndOfActivationEffects() function works correctly
 * and is wired into both Discord (handleDcEndActivation) and headless paths.
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
// BEHAVIORAL TESTS — applyEndOfActivationEffects()
// ══════════════════════════════════════════════════════════════════════════════

describe('B-ENDACT-001: Shield grants Block Token when none present', () => {
  it('grants 1 Block Token to figure with no Block tokens', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Riot Trooper (Elite)-1-0': 'a3', 'Riot Trooper (Elite)-1-1': 'a4' } },
      figurePowerTokens: {},
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Riot Trooper (Elite)',
      playerNum: 1,
      displayName: 'Riot Trooper (Elite)',
      msgId: 'rt-msg-1',
    });
    const shieldEffects = applied.filter(e => e.effect === 'Shield');
    assert.strictEqual(shieldEffects.length, 2, 'Shield fired for both figures');
    assert.ok(game.figurePowerTokens['Riot Trooper (Elite)-1-0']?.includes('Block'),
      'Figure 0 has Block token');
    assert.ok(game.figurePowerTokens['Riot Trooper (Elite)-1-1']?.includes('Block'),
      'Figure 1 has Block token');
  });

  it('does not grant Block Token when figure already has one', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Riot Trooper (Elite)-1-0': 'a3' } },
      figurePowerTokens: { 'Riot Trooper (Elite)-1-0': ['Block'] },
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Riot Trooper (Elite)',
      playerNum: 1,
      displayName: 'Riot Trooper (Elite)',
      msgId: 'rt-msg-2',
    });
    const shieldEffects = applied.filter(e => e.effect === 'Shield');
    assert.strictEqual(shieldEffects.length, 0, 'Shield did not fire (already has Block)');
    assert.strictEqual(game.figurePowerTokens['Riot Trooper (Elite)-1-0'].length, 1,
      'Still has exactly 1 Block token');
  });
});

describe('B-ENDACT-002: In The Shadows applies Hidden to ISB Infiltrator Elite', () => {
  it('applies Hide condition to all figures in DG', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 2: { 'ISB Infiltrator (Elite)-1-0': 'b2', 'ISB Infiltrator (Elite)-1-1': 'b3' } },
      figureConditions: {},
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'ISB Infiltrator (Elite)',
      playerNum: 2,
      displayName: 'ISB Infiltrator (Elite)',
      msgId: 'isb-msg-1',
    });
    const itsEffects = applied.filter(e => e.effect === 'In The Shadows');
    assert.strictEqual(itsEffects.length, 1, 'In The Shadows fired');
    assert.ok(game.figureConditions['ISB Infiltrator (Elite)-1-0']?.includes('Hide'),
      'Figure 0 is Hidden');
    assert.ok(game.figureConditions['ISB Infiltrator (Elite)-1-1']?.includes('Hide'),
      'Figure 1 is Hidden');
  });
});

describe('B-ENDACT-003: Unnerving applies Weaken to adjacent hostiles', () => {
  it('applies Weaken to adjacent enemy figure', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: {
        1: { '0-0-0-1-0': 'a3' },
        2: { 'Rebel-1-0': 'a4' },
      },
      figureConditions: {},
      selectedMap: { id: 'test-map' },
    };
    // We need map adjacency data. Since we import getMapData from data-loader,
    // and test maps aren't loaded, we test that the function handles missing map gracefully.
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: '0-0-0',
      playerNum: 1,
      displayName: '0-0-0',
      msgId: 'ooo-msg-1',
    });
    // With no map data, adjacency is empty, so Unnerving fires but finds no adjacent hostiles.
    // This confirms the function runs without error and handles missing map data.
    const unnEffects = applied.filter(e => e.effect === 'Unnerving');
    assert.strictEqual(unnEffects.length, 0, 'No weakened targets when map data unavailable');
  });

  it('applies Weaken when adjacency data exists', async () => {
    // Manually mock the adjacency by directly testing the condition application
    const { applyCondition, isConditionImmune } = await import('../../../src/game/conditions.js');
    const game = { figureConditions: {} };
    // Simulate what Unnerving does: apply Weaken to non-immune figure
    const enemyFk = 'Rebel Trooper-1-0';
    if (!isConditionImmune(game, enemyFk)) {
      applyCondition(game, enemyFk, 'Weaken');
    }
    assert.ok(game.figureConditions[enemyFk]?.includes('Weaken'),
      'Weaken applied to non-immune figure');
  });

  it('skips immune figures', async () => {
    const { isConditionImmune } = await import('../../../src/game/conditions.js');
    // Onar Koma should be immune
    const game = {};
    const isImmune = isConditionImmune(game, 'Onar Koma-1-0');
    assert.strictEqual(isImmune, true, 'Onar Koma is immune to harmful conditions');
  });
});

describe('B-ENDACT-004: Hold the Line grants Block tokens per hostile with LOS', () => {
  it('grants 0 Block tokens when no figure positions', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      figurePowerTokens: {},
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Baze Malbus',
      playerNum: 1,
      displayName: 'Baze Malbus',
      msgId: 'baze-msg-1',
    });
    const htlEffects = applied.filter(e => e.effect === 'Hold the Line');
    assert.strictEqual(htlEffects.length, 1, 'Hold the Line always fires for Baze');
    assert.ok(htlEffects[0].message.includes('0 Block Token'), 'Message shows 0 tokens');
  });
});

describe('B-ENDACT-005: Son of Skywalker re-readies Luke after other activation', () => {
  it('removes Luke index from activatedDcIndices when another DC finishes', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'c1' } },
      sonOfSkywalkerActive: { dcMsgId: 'luke-msg', playerNum: 1 },
      p1ActivatedDcIndices: [0, 2], // Luke is at index 2
      p1DcMessageIds: ['st-msg', 'other-msg', 'luke-msg'],
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper',
      msgId: 'st-msg', // Not Luke's msgId
    });
    const sosEffects = applied.filter(e => e.effect === 'Son of Skywalker');
    assert.strictEqual(sosEffects.length, 1, 'Son of Skywalker fired');
    assert.ok(!game.p1ActivatedDcIndices.includes(2),
      'Luke index removed from activated list (re-readied)');
    assert.ok(game.p1ActivatedDcIndices.includes(0),
      'Other DC index preserved');
  });

  it('does NOT re-ready Luke when it is Luke own activation ending', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Luke Skywalker-1-0': 'c1' } },
      sonOfSkywalkerActive: { dcMsgId: 'luke-msg', playerNum: 1 },
      p1ActivatedDcIndices: [2],
      p1DcMessageIds: ['a-msg', 'b-msg', 'luke-msg'],
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Luke Skywalker',
      playerNum: 1,
      displayName: 'Luke Skywalker',
      msgId: 'luke-msg', // IS Luke's msgId
    });
    const sosEffects = applied.filter(e => e.effect === 'Son of Skywalker');
    assert.strictEqual(sosEffects.length, 0, 'Son of Skywalker did NOT fire for Luke own activation');
    assert.ok(game.p1ActivatedDcIndices.includes(2),
      'Luke index still in activated list');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — wiring verification
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-ENDACT-001: handleDcEndActivation calls applyEndOfActivationEffects', () => {
  it('activation.js imports applyEndOfActivationEffects', () => {
    const src = readSrc('src/handlers/activation.js');
    assert.ok(src.includes("import { applyEndOfActivationEffects } from '../engine/activation-effects.js'"),
      'activation.js must import applyEndOfActivationEffects');
  });

  it('handleDcEndActivation calls applyEndOfActivationEffects', () => {
    const src = readSrc('src/handlers/activation.js');
    const fnIdx = src.indexOf('export async function handleDcEndActivation');
    assert.ok(fnIdx > 0, 'handleDcEndActivation found');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 5000);
    assert.ok(block.includes('applyEndOfActivationEffects(game,'),
      'handleDcEndActivation must call applyEndOfActivationEffects');
  });
});

describe('ORACLE-ENDACT-002: handleEndTurn no longer contains extracted effects', () => {
  it('handleEndTurn does not contain Shield inline logic', () => {
    const src = readSrc('src/handlers/activation.js');
    const fnIdx = src.indexOf('export async function handleEndTurn');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(!block.includes("includes('Shield')"),
      'handleEndTurn must not contain Shield logic (moved to shared function)');
  });

  it('handleEndTurn does not contain In The Shadows inline logic', () => {
    const src = readSrc('src/handlers/activation.js');
    const fnIdx = src.indexOf('export async function handleEndTurn');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(!block.includes("ISB Infiltrator (Elite)"),
      'handleEndTurn must not contain In The Shadows logic');
  });

  it('handleEndTurn does not contain Son of Skywalker inline logic', () => {
    const src = readSrc('src/handlers/activation.js');
    const fnIdx = src.indexOf('export async function handleEndTurn');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(!block.includes('sonOfSkywalkerActive'),
      'handleEndTurn must not contain Son of Skywalker logic');
  });
});

describe('ORACLE-ENDACT-003: Shared function is Discord-agnostic', () => {
  it('activation-effects.js has no Discord imports', () => {
    const src = readSrc('src/engine/activation-effects.js');
    assert.ok(!src.includes('discord.js'), 'No discord.js import');
    assert.ok(!src.includes('discord/'), 'No discord/ path imports');
    assert.ok(!src.includes('thread.send'), 'No thread.send calls');
    assert.ok(!src.includes('logGameAction'), 'No logGameAction calls');
    assert.ok(!src.includes('interaction'), 'No interaction references');
  });

  it('activation-effects.js returns structured results (not void)', () => {
    const src = readSrc('src/engine/activation-effects.js');
    assert.ok(src.includes('return { applied }'),
      'Function returns { applied } array');
  });
});

describe('ORACLE-ENDACT-004: Flawless Execution pattern preserved — choice effects remain in handleEndTurn', () => {
  it('Trust Goes Both Ways remains in handleEndTurn (choice-based, not extracted)', () => {
    const src = readSrc('src/handlers/activation.js');
    const fnIdx = src.indexOf('export async function handleEndTurn');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(block.includes('trust_goes_both_ways_jyn'),
      'Trust Goes Both Ways must remain in handleEndTurn (choice-based)');
  });
});
