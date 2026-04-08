/**
 * Oracle + behavioral tests for start-of-activation parity (Phase 2a).
 * Covers: Mounted, Comms Jammer, Focused on the Kill.
 * Verifies the shared applyStartOfActivationEffects() function works correctly
 * and is wired into both Discord (finalizeActivation) and headless paths.
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
// BEHAVIORAL TESTS — applyStartOfActivationEffects()
// ══════════════════════════════════════════════════════════════════════════════

describe('B-STARTACT-001: Mounted grants 3 MP at start of activation', () => {
  it('grants 3 MP to Captain Terro via specialAbilityIds', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      displayName: 'Captain Terro',
      msgId: 'terro-msg-1',
    });
    const mountedEffects = applied.filter(e => e.effect === 'Mounted');
    assert.strictEqual(mountedEffects.length, 1, 'Mounted fired for Captain Terro');
    assert.strictEqual(game.movementBank['terro-msg-1']?.total, 3, 'Movement bank has 3 MP');
  });

  it('grants 3 MP to Kuiil via specialAbilityIds', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Kuiil',
      playerNum: 2,
      displayName: 'Kuiil',
      msgId: 'kuiil-msg-1',
    });
    const mountedEffects = applied.filter(e => e.effect === 'Mounted');
    assert.strictEqual(mountedEffects.length, 1, 'Mounted fired for Kuiil');
    assert.strictEqual(game.movementBank['kuiil-msg-1']?.total, 3, 'Movement bank has 3 MP');
  });

  it('does not grant Mounted MP to non-mounted DC', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper',
      msgId: 'st-msg-1',
    });
    const mountedEffects = applied.filter(e => e.effect === 'Mounted');
    assert.strictEqual(mountedEffects.length, 0, 'Mounted did not fire for Stormtrooper');
  });

  it('adds 3 MP to existing movement bank (from pendingMpBonus)', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    // Simulate headless: movementBank already initialized with 2 MP from pendingMpBonus
    const game = {
      movementBank: { 'terro-msg-1': { total: 2, remaining: 2 } },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      displayName: 'Captain Terro',
      msgId: 'terro-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Mounted').length, 1);
    assert.strictEqual(game.movementBank['terro-msg-1']?.total, 5,
      'Movement bank has 2 + 3 = 5 MP');
  });
});

describe('B-STARTACT-002: Comms Jammer sets opponent CC lock', () => {
  it('sets commsJammerActivePlayerNum for ISB Infiltrator Elite', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {};
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'ISB Infiltrator (Elite)',
      playerNum: 2,
      displayName: 'ISB Infiltrator (Elite)',
      msgId: 'isb-msg-1',
    });
    const cjEffects = applied.filter(e => e.effect === 'Comms Jammer');
    assert.strictEqual(cjEffects.length, 1, 'Comms Jammer fired');
    assert.strictEqual(game.commsJammerActivePlayerNum, 2,
      'commsJammerActivePlayerNum set to activating player');
    assert.ok(cjEffects[0].message.includes('P1'),
      'Message mentions opponent player number');
  });

  it('does not set Comms Jammer for non-ISB DC', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {};
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper',
      msgId: 'st-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Comms Jammer').length, 0);
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined,
      'commsJammerActivePlayerNum not set');
  });
});

describe('B-STARTACT-003: Focused on the Kill grants 2 MP via attachment', () => {
  it('grants 2 MP when DC has Focused on the Kill attachment', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      p1DcAttachments: { 'ig88-msg-1': ['Focused on the Kill'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'IG-88',
      playerNum: 1,
      displayName: 'IG-88',
      msgId: 'ig88-msg-1',
    });
    const fotkEffects = applied.filter(e => e.effect === 'Focused on the Kill');
    assert.strictEqual(fotkEffects.length, 1, 'Focused on the Kill fired');
    assert.strictEqual(game.movementBank['ig88-msg-1']?.total, 2, 'Movement bank has 2 MP');
  });

  it('does not grant MP when DC has no attachments', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'IG-88',
      playerNum: 1,
      displayName: 'IG-88',
      msgId: 'ig88-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Focused on the Kill').length, 0);
  });

  it('reads p2DcAttachments when DC belongs to player 2', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      p2DcAttachments: { 'ig88-msg-2': ['Focused on the Kill', 'Some Other Card'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'IG-88',
      playerNum: 2,
      displayName: 'IG-88',
      msgId: 'ig88-msg-2',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Focused on the Kill').length, 1,
      'Focused on the Kill found in p2DcAttachments');
    assert.strictEqual(game.movementBank['ig88-msg-2']?.total, 2);
  });
});

describe('B-STARTACT-004: Multiple effects can fire for same DC', () => {
  it('Mounted + Focused on the Kill stack (grants 3 + 2 = 5 MP)', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      p1DcAttachments: { 'terro-msg-1': ['Focused on the Kill'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro',
      playerNum: 1,
      displayName: 'Captain Terro',
      msgId: 'terro-msg-1',
    });
    const mounted = applied.filter(e => e.effect === 'Mounted');
    const fotk = applied.filter(e => e.effect === 'Focused on the Kill');
    assert.strictEqual(mounted.length, 1, 'Mounted fired');
    assert.strictEqual(fotk.length, 1, 'Focused on the Kill fired');
    assert.strictEqual(game.movementBank['terro-msg-1']?.total, 5,
      'Movement bank has 3 + 2 = 5 MP');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Phase 2b: Madness, Into the Fray
// ══════════════════════════════════════════════════════════════════════════════

describe('B-STARTACT-005: Madness applies Focus + Strain when CC hand ≤ 2', () => {
  it('applies Focus and suffers 1 Strain when hand has 0 CC cards', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const dcHealthState = new Map();
    dcHealthState.set('tm-msg-1', { 0: [8, 8] });
    const game = {
      figurePositions: { 1: { 'Taron Malicos-1-0': 'd4' } },
      figureConditions: {},
      player1CcHand: [],
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Taron Malicos',
      playerNum: 1,
      displayName: 'Taron Malicos',
      msgId: 'tm-msg-1',
      dcHealthState,
    });
    const madnessEffects = applied.filter(e => e.effect === 'Madness');
    assert.strictEqual(madnessEffects.length, 1, 'Madness fired');
    assert.ok(game.figureConditions['Taron Malicos-1-0']?.includes('Focus'),
      'Taron Malicos became Focused');
    assert.deepStrictEqual(dcHealthState.get('tm-msg-1')[0], [7, 8],
      'HP reduced by 1 Strain (8 → 7)');
  });

  it('applies Focus and suffers 1 Strain when hand has 2 CC cards', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const dcHealthState = new Map();
    dcHealthState.set('tm-msg-1', { 0: [6, 8] });
    const game = {
      figurePositions: { 1: { 'Taron Malicos-1-0': 'd4' } },
      figureConditions: {},
      player1CcHand: ['card-a', 'card-b'],
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Taron Malicos',
      playerNum: 1,
      displayName: 'Taron Malicos',
      msgId: 'tm-msg-1',
      dcHealthState,
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Madness').length, 1, 'Madness fired at exactly 2 CC');
    assert.deepStrictEqual(dcHealthState.get('tm-msg-1')[0], [5, 8], 'HP reduced by 1');
  });

  it('does NOT fire when hand has 3 or more CC cards', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Taron Malicos-1-0': 'd4' } },
      figureConditions: {},
      player1CcHand: ['card-a', 'card-b', 'card-c'],
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Taron Malicos',
      playerNum: 1,
      displayName: 'Taron Malicos',
      msgId: 'tm-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Madness').length, 0, 'Madness did not fire');
    assert.strictEqual(game.figureConditions['Taron Malicos-1-0'], undefined,
      'No Focus applied');
  });

  it('works without dcHealthState (headless graceful path)', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 2: { 'Taron Malicos-1-0': 'e5' } },
      figureConditions: {},
      player2CcHand: ['card-a'],
    };
    // No dcHealthState passed — should still apply Focus without crashing
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Taron Malicos',
      playerNum: 2,
      displayName: 'Taron Malicos',
      msgId: 'tm-msg-2',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Madness').length, 1, 'Madness fired');
    assert.ok(game.figureConditions['Taron Malicos-1-0']?.includes('Focus'),
      'Focus applied even without dcHealthState');
  });
});

describe('B-STARTACT-006: Into the Fray grants 1 MP and Surge Tokens per hostile with LOS', () => {
  it('grants 1 MP even with no hostile figures', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Baze Malbus-1-0': 'a3' }, 2: {} },
      figurePowerTokens: {},
      movementBank: {},
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus',
      playerNum: 1,
      displayName: 'Baze Malbus',
      msgId: 'baze-msg-1',
    });
    const itfEffects = applied.filter(e => e.effect === 'Into the Fray');
    assert.strictEqual(itfEffects.length, 1, 'Into the Fray always fires for Baze');
    assert.strictEqual(game.movementBank['baze-msg-1']?.total, 1, 'Movement bank has 1 MP');
    assert.ok(itfEffects[0].message.includes('0 Surge Token'), 'Message shows 0 surge tokens');
  });

  it('does not fire for non-Baze DC', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: {} },
      movementBank: {},
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Stormtrooper',
      playerNum: 1,
      displayName: 'Stormtrooper',
      msgId: 'st-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Into the Fray').length, 0);
  });

  it('message reflects surge count correctly', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    // Without map data, surgeCount will be 0 — but the effect still fires with 1 MP
    const game = {
      figurePositions: {
        1: { 'Baze Malbus-1-0': 'a3' },
        2: { 'Rebel-1-0': 'a4', 'Rebel-1-1': 'b2' },
      },
      figurePowerTokens: {},
      movementBank: {},
      selectedMap: { id: 'nonexistent-map' },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus',
      playerNum: 1,
      displayName: 'Baze Malbus',
      msgId: 'baze-msg-2',
    });
    const itfEffects = applied.filter(e => e.effect === 'Into the Fray');
    assert.strictEqual(itfEffects.length, 1);
    // Without valid map data, LOS can't be checked, so 0 surge tokens
    assert.ok(itfEffects[0].message.includes('0 Surge Token'),
      'Without map data, no surges granted');
    assert.strictEqual(game.movementBank['baze-msg-2']?.total, 1, 'Still gets 1 MP');
  });
});

describe('B-STARTACT-007: Multiple Phase 2a+2b effects stack correctly', () => {
  it('Mounted + Into the Fray should not both fire (different DCs)', async () => {
    // Sanity: Mounted is for Terro/Kuiil/Dewback, Into the Fray is for Baze only
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {}, figurePositions: { 1: { 'Baze Malbus-1-0': 'c1' }, 2: {} }, figurePowerTokens: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus', playerNum: 1, displayName: 'Baze Malbus', msgId: 'baze-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Mounted').length, 0, 'Baze is not Mounted');
    assert.strictEqual(applied.filter(e => e.effect === 'Into the Fray').length, 1, 'Into the Fray fires');
  });

  it('Into the Fray + Focused on the Kill stack for Baze with attachment', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      figurePositions: { 1: { 'Baze Malbus-1-0': 'c1' }, 2: {} },
      figurePowerTokens: {},
      p1DcAttachments: { 'baze-msg-1': ['Focused on the Kill'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus', playerNum: 1, displayName: 'Baze Malbus', msgId: 'baze-msg-1',
    });
    const itf = applied.filter(e => e.effect === 'Into the Fray');
    const fotk = applied.filter(e => e.effect === 'Focused on the Kill');
    assert.strictEqual(itf.length, 1, 'Into the Fray fired');
    assert.strictEqual(fotk.length, 1, 'Focused on the Kill fired');
    assert.strictEqual(game.movementBank['baze-msg-1']?.total, 3,
      'Movement bank has 1 (ItF) + 2 (FotK) = 3 MP');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — wiring verification
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-STARTACT-001: finalizeActivation calls applyStartOfActivationEffects', () => {
  it('activation-setup.js imports applyStartOfActivationEffects', () => {
    const src = readSrc('src/engine/activation-setup.js');
    assert.ok(src.includes("import { applyStartOfActivationEffects } from './activation-effects.js'"),
      'activation-setup.js must import applyStartOfActivationEffects');
  });

  it('finalizeActivation calls applyStartOfActivationEffects', () => {
    const src = readSrc('src/engine/activation-setup.js');
    assert.ok(src.includes('applyStartOfActivationEffects(game,'),
      'activation-setup.js must call applyStartOfActivationEffects');
  });
});

describe('ORACLE-STARTACT-002: headlessActivateDc calls applyStartOfActivationEffects', () => {
  it('game-harness.js imports applyStartOfActivationEffects', () => {
    const src = readSrc('src/headless/game-harness.js');
    assert.ok(src.includes("import { applyStartOfActivationEffects } from '../engine/activation-effects.js'"),
      'game-harness.js must import applyStartOfActivationEffects');
  });

  it('headlessActivateDc calls applyStartOfActivationEffects', () => {
    const src = readSrc('src/headless/game-harness.js');
    const fnIdx = src.indexOf('function headlessActivateDc');
    assert.ok(fnIdx > 0, 'headlessActivateDc found');
    const fnEnd = src.indexOf('\n/**', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(block.includes('applyStartOfActivationEffects(game,'),
      'headlessActivateDc must call applyStartOfActivationEffects');
  });
});

describe('ORACLE-STARTACT-003: Extracted effects no longer inline in activation-setup.js', () => {
  it('D1 Mounted is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    // The old inline pattern: grantMovementBank(game, msgId, 3) preceded by mounted_terro check
    // Should not appear in the D section except via the shared function
    const d1Region = sectionD.slice(0, sectionD.indexOf('D2.'));
    assert.ok(!d1Region.includes("_abilityIds.includes('mounted_terro')"),
      'D1 Mounted must not have inline mounted_terro check');
  });

  it('D11 Comms Jammer is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    assert.ok(!sectionD.includes("game.commsJammerActivePlayerNum = playerNum"),
      'D11 Comms Jammer assignment must not be inline');
  });

  it('D35a Focused on the Kill is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    // The old inline pattern: cardNameIncludes check + grantMovementBank within D35 block
    const d35Idx = sectionD.indexOf('D35.');
    assert.ok(d35Idx > 0, 'D35 section found');
    const d35Block = sectionD.slice(d35Idx, d35Idx + 500);
    assert.ok(!d35Block.includes("cardNameIncludes(_suActivationUpgrades, 'Focused on the Kill')"),
      'D35a Focused on the Kill cardNameIncludes check must not be inline');
  });
});

describe('ORACLE-STARTACT-004: Shared function is Discord-agnostic', () => {
  it('activation-effects.js has no Discord imports', () => {
    const src = readSrc('src/engine/activation-effects.js');
    assert.ok(!src.includes('discord.js'), 'No discord.js import');
    assert.ok(!src.includes('discord/'), 'No discord/ path imports');
    assert.ok(!src.includes('thread.send'), 'No thread.send calls');
    assert.ok(!src.includes('interaction'), 'No interaction references');
  });

  it('applyStartOfActivationEffects returns structured results', () => {
    const src = readSrc('src/engine/activation-effects.js');
    const fnIdx = src.indexOf('export function applyStartOfActivationEffects');
    assert.ok(fnIdx > 0, 'applyStartOfActivationEffects found');
    const fnEnd = src.indexOf('\nexport ', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 2000);
    assert.ok(block.includes('return { applied }'),
      'Function returns { applied } array');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — Phase 2b wiring verification
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-STARTACT-005: Phase 2b extracted effects no longer inline', () => {
  it('D3 Madness is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    // Old inline pattern: dcName === 'Taron Malicos' with applyCondition + reduceHp
    const d3Region = sectionD.slice(sectionD.indexOf('D3.'), sectionD.indexOf('D4.'));
    assert.ok(!d3Region.includes("dcName === 'Taron Malicos'"),
      'D3 Madness must not have inline Taron Malicos check');
    assert.ok(!d3Region.includes("reduceHp(dcHealthState"),
      'D3 Madness must not have inline reduceHp call');
  });

  it('D8 Into the Fray is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    const d8Region = sectionD.slice(sectionD.indexOf('D8.'), sectionD.indexOf('D9.'));
    assert.ok(!d8Region.includes("dcName === 'Baze Malbus'"),
      'D8 Into the Fray must not have inline Baze Malbus check');
    assert.ok(!d8Region.includes("grantPowerTokens(game, selfFk, 'Surge'"),
      'D8 Into the Fray must not have inline grantPowerTokens call');
  });
});

describe('ORACLE-STARTACT-006: Discord path passes dcHealthState to shared function', () => {
  it('activation-setup.js passes dcHealthState in shared function call', () => {
    const src = readSrc('src/engine/activation-setup.js');
    assert.ok(src.includes('applyStartOfActivationEffects(game, { dcName, playerNum, displayName, msgId, dcHealthState })'),
      'shared function call must include dcHealthState');
  });
});

describe('ORACLE-STARTACT-007: headless path passes dcHealthState to shared function', () => {
  it('game-harness.js passes dcHealthState in headlessActivateDc call', () => {
    const src = readSrc('src/headless/game-harness.js');
    assert.ok(src.includes('headlessActivateDc(game, customId, deps.dcExhaustedState, deps.dcHealthState)'),
      'headlessActivateDc call must include dcHealthState');
  });

  it('headlessActivateDc passes dcHealthState to shared function', () => {
    const src = readSrc('src/headless/game-harness.js');
    const fnIdx = src.indexOf('function headlessActivateDc');
    const fnEnd = src.indexOf('\n/**', fnIdx + 1);
    const block = src.slice(fnIdx, fnEnd > fnIdx ? fnEnd : fnIdx + 3000);
    assert.ok(block.includes('dcHealthState'),
      'headlessActivateDc function uses dcHealthState');
  });
});
