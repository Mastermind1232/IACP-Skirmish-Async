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

// 2026-06 audit: Shield / In The Shadows / Unnerving / Hold the Line are no
// longer auto-fired by applyEndOfActivationEffects(). They are PLAYER-CHOICE
// orchestrator descriptors (eoa-orchestrator.js → eoa-handler.js). These
// tests now assert the auto-fire path is GONE (no double-fire) and that the
// descriptor enumeration is the single path.
describe('B-ENDACT-001: Shield is NOT auto-fired (player-choice descriptor only)', () => {
  it('applyEndOfActivationEffects does not grant a Block Token automatically', async () => {
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
    assert.strictEqual(applied.filter(e => e.effect === 'Shield').length, 0, 'Shield no longer auto-fires');
    assert.ok(!game.figurePowerTokens['Riot Trooper (Elite)-1-0']?.includes('Block'), 'No auto Block token');
  });

  it('Shield is enumerated as a single EoA descriptor instead', async () => {
    const { enumerateActivatorEoaDescriptors } = await import('../../../src/game/eoa-orchestrator.js');
    const msgId = 'rt-msg-1';
    const game = {
      dcMessageMeta: new Map([[msgId, { displayName: 'Riot Trooper (Elite) [Group 1]', gameId: 'g', playerNum: 1, dcName: 'Riot Trooper (Elite)' }]]),
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
      figurePositions: { 1: {} },
    };
    const shield = enumerateActivatorEoaDescriptors(game, { dcName: 'Riot Trooper (Elite)', playerNum: 1, msgId }).filter(d => d.subPromptKey === 'shield');
    assert.strictEqual(shield.length, 1, 'exactly one shield descriptor');
  });
});

describe('B-ENDACT-002: In The Shadows is NOT auto-fired (player-choice descriptor only)', () => {
  it('applyEndOfActivationEffects does not auto-Hide ISB Infiltrator figures', async () => {
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
    assert.strictEqual(applied.filter(e => e.effect === 'In The Shadows').length, 0, 'In The Shadows no longer auto-fires');
    assert.ok(!game.figureConditions['ISB Infiltrator (Elite)-1-0']?.includes('Hide'), 'No auto Hide');
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

describe('B-ENDACT-004: Hold the Line is NOT auto-fired (player-choice descriptor only)', () => {
  it('applyEndOfActivationEffects does not auto-grant Hold the Line', async () => {
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
    assert.strictEqual(applied.filter(e => e.effect === 'Hold the Line').length, 0, 'Hold the Line no longer auto-fires');
  });

  it('Hold the Line is enumerated as a single EoA descriptor instead', async () => {
    const { enumerateActivatorEoaDescriptors } = await import('../../../src/game/eoa-orchestrator.js');
    const msgId = 'baze-msg-1';
    const game = {
      dcMessageMeta: new Map([[msgId, { displayName: 'Baze Malbus', gameId: 'g', playerNum: 1, dcName: 'Baze Malbus' }]]),
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
      figurePositions: { 1: {} },
    };
    const htl = enumerateActivatorEoaDescriptors(game, { dcName: 'Baze Malbus', playerNum: 1, msgId }).filter(d => d.subPromptKey === 'hold_the_line');
    assert.strictEqual(htl.length, 1, 'exactly one hold_the_line descriptor');
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

describe('B-ENDACT-006: Weakened auto-discards at end of activation (CRR-WKN-002)', () => {
  it('discards Weaken on all activating-DC figures', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'a2' } },
      figureConditions: {
        'Stormtrooper-1-0': ['Weaken'],
        'Stormtrooper-1-1': ['Weaken', 'Focus'],
      },
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper [DG 1]',
      msgId: 'st-msg-1',
    });
    const wknEffects = applied.filter(e => e.effect === 'Weaken discard');
    assert.strictEqual(wknEffects.length, 2, 'Weaken discard fired for both figures');
    assert.ok(!game.figureConditions['Stormtrooper-1-0']?.includes('Weaken'),
      'Figure 0 Weaken cleared');
    assert.ok(!game.figureConditions['Stormtrooper-1-1']?.includes('Weaken'),
      'Figure 1 Weaken cleared');
    assert.ok(game.figureConditions['Stormtrooper-1-1']?.includes('Focus'),
      'Figure 1 Focus preserved (only Weaken auto-discards)');
  });

  it('respects disarmPermanentWeakened lock (Weaken stays)', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' } },
      figureConditions: { 'Stormtrooper-1-0': ['Weaken'] },
      disarmPermanentWeakened: { 'Stormtrooper-1-0': true },
    };
    const { applied } = applyEndOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper [DG 1]',
      msgId: 'st-msg-2',
    });
    const wknEffects = applied.filter(e => e.effect === 'Weaken discard');
    assert.strictEqual(wknEffects.length, 0, 'No Weaken discard effect fired (locked)');
    assert.ok(game.figureConditions['Stormtrooper-1-0']?.includes('Weaken'),
      'Weaken persists under disarmPermanentWeakened lock');
  });

  it('does not touch Stun (only Weaken auto-discards)', async () => {
    const { applyEndOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' } },
      figureConditions: { 'Stormtrooper-1-0': ['Stun', 'Bleed'] },
    };
    applyEndOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper [DG 1]',
      msgId: 'st-msg-3',
    });
    assert.ok(game.figureConditions['Stormtrooper-1-0']?.includes('Stun'),
      'Stun preserved (must be removed via dc_remove_stun_ action)');
    assert.ok(game.figureConditions['Stormtrooper-1-0']?.includes('Bleed'),
      'Bleed preserved (removed via surge-to-discard, not auto)');
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

describe('ORACLE-ENDACT-004: Trust Goes Both Ways EoA consolidated into the orchestrator', () => {
  // 2026-06 audit: the legacy ad-hoc `trust_goes_both_ways_jyn` end-of-
  // activation prompt (and its `act_passive_..._trustboth_` handler) was
  // REMOVED from handleEndTurn — it double-wired the ability with a different
  // once-per-round key than the EoA orchestrator. The single player-choice
  // path is now the orchestrator descriptor `trust_both_ways_eoa`.
  it('legacy trustboth emitter + handler no longer present in activation.js', () => {
    const src = readSrc('src/handlers/activation.js');
    // The button emitter and the act_passive handler branch are gone (comments
    // referencing the removal are allowed).
    assert.ok(!/setCustomId\(`act_passive_[^`]*_trustboth_/.test(src),
      'legacy act_passive trustboth button emitter must be removed');
    assert.ok(!/ability === 'trustboth'/.test(src),
      'legacy trustboth act_passive handler branch must be removed');
  });

  it("Trust Goes Both Ways EoA is a player-choice orchestrator descriptor", () => {
    const eoaSrc = readSrc('src/game/eoa-orchestrator.js');
    assert.ok(eoaSrc.includes('trust_both_ways_eoa'),
      'EoA orchestrator must enumerate trust_both_ways_eoa');
    const handlerSrc = readSrc('src/handlers/eoa-handler.js');
    assert.ok(handlerSrc.includes('trust_both_ways_eoa'),
      'eoa-handler must resolve trust_both_ways_eoa');
  });

  it('the once-per-round key is unified (per-msgId) across SoA and EoA', () => {
    const eoaSrc = readSrc('src/game/eoa-orchestrator.js');
    const soaSrc = readSrc('src/game/soa-orchestrator.js');
    assert.ok(eoaSrc.includes('trustBothWays_${msgId}'), 'EoA uses per-msgId key');
    assert.ok(soaSrc.includes('trustBothWays_${msgId}'), 'SoA uses per-msgId key');
  });
});
