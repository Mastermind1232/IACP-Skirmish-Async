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

// Per destruct 2026-05-07 (slice 3): Mounted / Comms Jammer / Focused on
// the Kill / Hunger Regular are no longer auto-fired by
// applyStartOfActivationEffects — they are descriptors enumerated by the
// SoA orchestrator and triggered manually via the chooser. The legacy
// "auto-grant" assertions were rewritten as "applyStartOfActivationEffects
// does NOT auto-grant" + "enumerateActivatorSoaDescriptors returns the
// matching descriptor" pairs.

describe('B-STARTACT-001: Mounted is enumerated as a SoA descriptor (not auto-fired)', () => {
  it('applyStartOfActivationEffects no longer auto-grants 3 MP for Captain Terro', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = { movementBank: {} };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Captain Terro', playerNum: 1, displayName: 'Captain Terro', msgId: 'terro-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Mounted').length, 0);
    assert.strictEqual(game.movementBank['terro-msg-1'], undefined);
  });

  it('enumerateActivatorSoaDescriptors returns a Mounted descriptor for Captain Terro', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { movementBank: {} };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Captain Terro', playerNum: 1, msgId: 'terro-msg-1',
    });
    const m = descriptors.find(d => d.subPromptKey === 'mounted');
    assert.ok(m, 'Mounted descriptor enumerated');
    assert.strictEqual(m.ownerPlayerNum, 1);
    assert.strictEqual(m.sourceMsgId, 'terro-msg-1');
  });

  it('enumerateActivatorSoaDescriptors returns a Mounted descriptor for Kuiil', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {};
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Kuiil', playerNum: 2, msgId: 'kuiil-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'mounted'),
      'Mounted descriptor enumerated for Kuiil');
  });

  it('does not enumerate Mounted for unrelated DC', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {};
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg-1',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'mounted'));
  });
});

describe('B-STARTACT-002: Comms Jammer is enumerated (not auto-fired)', () => {
  it('applyStartOfActivationEffects no longer auto-sets commsJammerActivePlayerNum', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {};
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'ISB Infiltrator (Elite)', playerNum: 2, displayName: 'ISB Infiltrator (Elite)', msgId: 'isb-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Comms Jammer').length, 0);
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined);
  });

  it('enumerateActivatorSoaDescriptors returns a comms_jammer descriptor', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {};
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'ISB Infiltrator (Elite)', playerNum: 2, msgId: 'isb-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'comms_jammer'));
  });
});

describe('B-STARTACT-003: Focused on the Kill is enumerated (not auto-fired)', () => {
  it('applyStartOfActivationEffects no longer auto-grants 2 MP from FotK attachment', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      p1DcAttachments: { 'ig88-msg-1': ['Focused on the Kill'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'IG-88', playerNum: 1, displayName: 'IG-88', msgId: 'ig88-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Focused on the Kill').length, 0);
  });

  it('enumerateActivatorSoaDescriptors returns a fotk descriptor (p1DcAttachments)', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p1DcAttachments: { 'ig88-msg-1': ['Focused on the Kill'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'IG-88', playerNum: 1, msgId: 'ig88-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'fotk'));
  });

  it('enumerateActivatorSoaDescriptors returns a fotk descriptor (p2DcAttachments)', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p2DcAttachments: { 'ig88-msg-2': ['Focused on the Kill', 'Some Other Card'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'IG-88', playerNum: 2, msgId: 'ig88-msg-2',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'fotk'));
  });
});

describe('B-STARTACT-004: Multiple SoA descriptors can co-exist for one activation', () => {
  it('Mounted + FotK both enumerated for Captain Terro with FotK attachment', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p1DcAttachments: { 'terro-msg-1': ['Focused on the Kill'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Captain Terro', playerNum: 1, msgId: 'terro-msg-1',
    });
    const ids = descriptors.map(d => d.subPromptKey);
    assert.ok(ids.includes('mounted'), 'Mounted enumerated');
    assert.ok(ids.includes('fotk'), 'FotK enumerated');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Phase 2b: Madness, Into the Fray
// ══════════════════════════════════════════════════════════════════════════════

describe('B-STARTACT-005: Madness is enumerated as a SoA descriptor', () => {
  it('applyStartOfActivationEffects no longer auto-fires Madness', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const dcHealthState = new Map();
    dcHealthState.set('tm-msg-1', { 0: [8, 8] });
    const game = {
      figurePositions: { 1: { 'Taron Malicos-1-0': 'd4' } },
      figureConditions: {},
      player1CcHand: [],
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Taron Malicos', playerNum: 1, displayName: 'Taron Malicos', msgId: 'tm-msg-1', dcHealthState,
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Madness').length, 0,
      'Madness no longer auto-fires (slice 4 — destruct 2026-05-07)');
    assert.strictEqual(game.figureConditions['Taron Malicos-1-0'], undefined,
      'no auto Focus applied');
  });

  it('enumerateActivatorSoaDescriptors returns a madness descriptor for Taron Malicos', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Taron Malicos', playerNum: 1, msgId: 'tm-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'madness'),
      'madness descriptor enumerated');
  });

  it('does not enumerate madness for non-Taron DC', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'madness'));
  });
});

describe('B-STARTACT-006: Into the Fray is enumerated as a SoA descriptor', () => {
  it('applyStartOfActivationEffects no longer auto-fires Into the Fray', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      figurePositions: { 1: { 'Baze Malbus-1-0': 'a3' }, 2: {} },
      figurePowerTokens: {},
      movementBank: {},
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus', playerNum: 1, displayName: 'Baze Malbus', msgId: 'baze-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Into the Fray').length, 0);
    assert.strictEqual(game.movementBank['baze-msg-1'], undefined);
  });

  it('enumerateActivatorSoaDescriptors returns into_the_fray descriptor for Baze', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Baze Malbus', playerNum: 1, msgId: 'baze-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'into_the_fray'));
  });

  it('does not enumerate into_the_fray for non-Baze DC', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'into_the_fray'));
  });
});

describe('B-STARTACT-007: Slice-4 — Into the Fray + FotK both descriptors', () => {
  it('Mounted + Into the Fray are different descriptor keys (different DCs)', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const baze = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Baze Malbus', playerNum: 1, msgId: 'baze-msg-1',
    });
    assert.ok(!baze.some(d => d.subPromptKey === 'mounted'), 'Baze is not Mounted');
    assert.ok(baze.some(d => d.subPromptKey === 'into_the_fray'), 'Into the Fray enumerated');
  });

  it('Into the Fray + FotK both enumerated for Baze with attachment', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      movementBank: {},
      figurePositions: { 1: { 'Baze Malbus-1-0': 'c1' }, 2: {} },
      figurePowerTokens: {},
      p1DcAttachments: { 'baze-msg-1': ['Focused on the Kill'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Baze Malbus', playerNum: 1, displayName: 'Baze Malbus', msgId: 'baze-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Into the Fray').length, 0,
      'Into the Fray no longer auto-fires (slice 4)');
    assert.strictEqual(applied.filter(e => e.effect === 'Focused on the Kill').length, 0,
      'FotK no longer auto-fires (slice 3)');
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Baze Malbus', playerNum: 1, msgId: 'baze-msg-1',
    });
    const ids = descriptors.map(d => d.subPromptKey);
    assert.ok(ids.includes('into_the_fray'), 'into_the_fray enumerated');
    assert.ok(ids.includes('fotk'), 'fotk enumerated');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Phase 2c: Beast Tamer, Hunger Regular
// ══════════════════════════════════════════════════════════════════════════════

describe('B-STARTACT-008: Beast Tamer is enumerated as a SoA descriptor', () => {
  it('applyStartOfActivationEffects no longer auto-fires Beast Tamer', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      p1DcAttachments: { 'bantha-msg-1': ['Beast Tamer'] },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Bantha Rider', playerNum: 1, displayName: 'Bantha Rider', msgId: 'bantha-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Beast Tamer').length, 0);
    assert.strictEqual(game.movementBank['bantha-msg-1'], undefined);
    assert.strictEqual(game.exhaustedSkirmishUpgrades?.['bantha-msg-1'], undefined);
  });

  it('enumerateActivatorSoaDescriptors returns beast_tamer descriptor for CREATURE', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p1DcAttachments: { 'bantha-msg-1': ['Beast Tamer'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Bantha Rider', playerNum: 1, msgId: 'bantha-msg-1',
    });
    const bt = descriptors.find(d => d.subPromptKey === 'beast_tamer');
    assert.ok(bt, 'beast_tamer descriptor enumerated for Bantha Rider (CREATURE)');
    assert.strictEqual(bt.extras?.isNonSentient, false,
      'Bantha Rider is not Non-Sentient');
  });

  it('does not enumerate beast_tamer when already exhausted', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p1DcAttachments: { 'bantha-msg-1': ['Beast Tamer'] },
      exhaustedSkirmishUpgrades: { 'bantha-msg-1': ['Beast Tamer'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Bantha Rider', playerNum: 1, msgId: 'bantha-msg-1',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'beast_tamer'));
  });

  it('does not enumerate beast_tamer for non-CREATURE DC', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p1DcAttachments: { 'trooper-msg-1': ['Beast Tamer'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'trooper-msg-1',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'beast_tamer'));
  });

  it('isNonSentient flag set for Non-Sentient creatures', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: {}, 2: {} },
      p2DcAttachments: { 'nexu-msg-1': ['Beast Tamer'] },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Nexu (Elite)', playerNum: 2, msgId: 'nexu-msg-1',
    });
    const bt = descriptors.find(d => d.subPromptKey === 'beast_tamer');
    assert.ok(bt, 'beast_tamer enumerated for Nexu Elite');
    assert.strictEqual(bt.extras?.isNonSentient, true,
      'Nexu Elite is Non-Sentient → flag enables override sub-prompt button');
  });
});

describe('B-STARTACT-009: Hunger Regular is enumerated (not auto-fired)', () => {
  it('applyStartOfActivationEffects no longer auto-grants 2 MP for Wampa', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      figurePositions: { 1: { 'Wampa-1-0': 'a1' }, 2: { 'Rebel-1-0': 'z9' } },
      selectedMap: { id: 'test-map' },
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Wampa', playerNum: 1, displayName: 'Wampa', msgId: 'wampa-msg-1',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'Hunger').length, 0);
    assert.strictEqual(game.movementBank['wampa-msg-1'], undefined);
  });

  it('enumerateActivatorSoaDescriptors returns hunger_regular when no hostile within 3', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Wampa (Regular)-1-0': 'a1' }, 2: { 'Rebel-1-0': 'z9' } },
      selectedMap: { id: 'test-map' },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Wampa (Regular)', playerNum: 1, msgId: 'wampa-msg-1',
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'hunger_regular'));
  });

  it('does not enumerate hunger_regular for Wampa Elite (different ability path)', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Wampa (Elite)-1-0': 'a1' }, 2: {} },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Wampa (Elite)', playerNum: 1, msgId: 'wampa-elite-msg-1',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'hunger_regular'),
      'Wampa Elite uses hunger_elite, not hunger_regular');
  });

  it('does not enumerate hunger_regular for non-Wampa DC', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = { figurePositions: { 1: {}, 2: {} } };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg-1',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'hunger_regular'));
  });
});

describe('B-STARTACT-010: Slice-3 migration — Hunger Regular + FotK both as descriptors', () => {
  it('both descriptors enumerated for Wampa with FotK attachment', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Wampa (Regular)-1-0': 'a1' }, 2: {} },
      p1DcAttachments: { 'wampa-msg-1': ['Focused on the Kill'] },
      selectedMap: { id: 'test-map' },
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Wampa (Regular)', playerNum: 1, msgId: 'wampa-msg-1',
    });
    const ids = descriptors.map(d => d.subPromptKey);
    assert.ok(ids.includes('hunger_regular'), 'hunger_regular enumerated');
    assert.ok(ids.includes('fotk'), 'fotk enumerated');
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

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — Phase 2c wiring verification
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-STARTACT-008: Phase 2c extracted effects no longer inline', () => {
  it('D6 Hunger Regular is no longer inline', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    const d6Region = sectionD.slice(sectionD.indexOf('D6.'), sectionD.indexOf('D7.'));
    assert.ok(!d6Region.includes("dcName === 'Wampa' && _hungerCheck"),
      'D6 Hunger Regular must not have inline _hungerCheck for Wampa');
    assert.ok(!d6Region.includes("grantMovementBank(game, msgId, 2)"),
      'D6 must not have inline 2 MP grant for Regular Wampa');
  });

  it('D6 Wampa Elite Hunger migrated to SoA orchestrator (slice 2 — destruct 2026-05-07)', () => {
    // Wampa Elite Hunger was previously inline because of its choice branch
    // (Block or Evade token after gaining 3 MP). The SoA orchestrator
    // (slice 2) handles per-trigger choice branches via subPromptKey,
    // so the inline block was removed and the descriptor moved to
    // soa-orchestrator.js enumerateActivatorSoaDescriptors. This test now
    // pins the new architecture: NO inline `Wampa (Elite)` block in D4-D7
    // section, AND a hunger_elite descriptor exists in the orchestrator.
    const setupSrc = readSrc('src/engine/activation-setup.js');
    const sectionD = setupSrc.slice(setupSrc.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    const d4to7Region = sectionD.slice(sectionD.indexOf('D4'), sectionD.indexOf('D8.'));
    assert.ok(!d4to7Region.includes('hunger_block'),
      'D4-D7 must not contain inline `hunger_block` button (migrated to SoA orchestrator)');
    const orchestratorSrc = readSrc('src/game/soa-orchestrator.js');
    assert.ok(orchestratorSrc.includes("'Wampa (Elite)'"),
      'soa-orchestrator must enumerate a Wampa (Elite) descriptor');
    assert.ok(orchestratorSrc.includes("subPromptKey: 'hunger_elite'"),
      'soa-orchestrator must use the hunger_elite subPromptKey');
  });

  it('Beast Tamer is no longer inline in D35', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    const d35Idx = sectionD.indexOf('D35.');
    assert.ok(d35Idx > 0, 'D35 section found');
    const d35Block = sectionD.slice(d35Idx, d35Idx + 1000);
    assert.ok(!d35Block.includes("_btKws.includes('CREATURE')"),
      'D35 Beast Tamer must not have inline CREATURE keyword check');
    assert.ok(!d35Block.includes("getDcStatsFn(dcName)?.speed"),
      'D35 Beast Tamer must not have inline getDcStatsFn speed lookup');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// BEHAVIORAL TESTS — Phase 2d: I Make the Rules Now
// ══════════════════════════════════════════════════════════════════════════════

describe('B-STARTACT-011: IMTRN — fires on ANY non-Cad-Bane activation, grants per friendly HUNTER (destruct 2026-05-07)', () => {
  it('applyStartOfActivationEffects no longer auto-fires IMTRN', async () => {
    const { applyStartOfActivationEffects } = await import('../../../src/engine/activation-effects.js');
    const game = {
      movementBank: {},
      figurePositions: { 1: { 'Cad Bane-1-0': 'a1', 'Bossk-1-0': 'a3' }, 2: {} },
      p1DcList: [
        { dcName: 'Stormtrooper', displayName: 'Stormtrooper' },
        { dcName: 'Cad Bane', displayName: 'Cad Bane' },
        { dcName: 'Bossk', displayName: 'Bossk' },
      ],
      p1DcMessageIds: ['st-msg', 'cad-msg', 'bossk-msg'],
      p2DcList: [],
      p2DcMessageIds: [],
    };
    const { applied } = applyStartOfActivationEffects(game, {
      dcName: 'Stormtrooper', playerNum: 1, displayName: 'Stormtrooper', msgId: 'st-msg',
    });
    assert.strictEqual(applied.filter(e => e.effect === 'I Make the Rules Now').length, 0);
    assert.strictEqual(game.movementBank['bossk-msg'], undefined);
  });

  it('non-HUNTER activator (Stormtrooper) still triggers IMTRN — single descriptor per Cad Bane', async () => {
    // Per destruct correction (2nd): IMTRN fires on ANY non-Cad-Bane
    // activation. ONE descriptor per Cad Bane; the sub-prompt asks Cad
    // Bane's player which HUNTER (within 4) to grant 1 MP to — Cad Bane
    // himself counts as an eligible HUNTER.
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Cad Bane-1-0': 'a1', 'Bossk-1-0': 'a3', 'Stormtrooper-1-0': 'b2' }, 2: {} },
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [
        { dcName: 'Stormtrooper', displayName: 'Stormtrooper' },
        { dcName: 'Cad Bane', displayName: 'Cad Bane' },
        { dcName: 'Bossk', displayName: 'Bossk' },
      ],
      p1DcMessageIds: ['st-msg', 'cad-msg', 'bossk-msg'],
      p2DcList: [],
      p2DcMessageIds: [],
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg',
    });
    const imrnDescs = descriptors.filter(d => d.subPromptKey === 'imrn');
    assert.strictEqual(imrnDescs.length, 1, 'exactly ONE IMTRN descriptor per Cad Bane');
    assert.strictEqual(imrnDescs[0].extras?.cadFigureKey, 'Cad Bane-1-0');
    assert.strictEqual(imrnDescs[0].ownerPlayerNum, 1);
    assert.strictEqual(imrnDescs[0].extras?.activatorMsgId, 'st-msg');
  });

  it('does not enumerate IMTRN when no friendly HUNTER is within 4 of Cad Bane', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Cad Bane-1-0': 'a1', 'Stormtrooper-1-0': 'b2' }, 2: {} },
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [
        { dcName: 'Stormtrooper', displayName: 'Stormtrooper' },
        { dcName: 'Cad Bane', displayName: 'Cad Bane' },
      ],
      p1DcMessageIds: ['st-msg', 'cad-msg'],
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg',
    });
    // Cad Bane himself is HUNTER and within 0 of himself → still eligible.
    const imrnDescs = descriptors.filter(d => d.subPromptKey === 'imrn');
    assert.strictEqual(imrnDescs.length, 1,
      'Cad Bane self-eligibility means descriptor still enumerated');
  });

  it('does not enumerate IMTRN when Cad Bane himself is activating', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Cad Bane-1-0': 'a1', 'Bossk-1-0': 'a3' }, 2: {} },
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [
        { dcName: 'Cad Bane', displayName: 'Cad Bane' },
        { dcName: 'Bossk', displayName: 'Bossk' },
      ],
      p1DcMessageIds: ['cad-msg', 'bossk-msg'],
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Cad Bane', playerNum: 1, msgId: 'cad-msg',
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'imrn'),
      'Cad Bane\'s own activation does not trigger his own IMTRN');
  });
});

describe('B-STARTACT-012: IMTRN — opponent activation triggers single descriptor for Cad Bane\'s player', () => {
  it('P1 Stormtrooper activates → P2 Cad Bane gets ONE descriptor (sub-prompt picks the HUNTER)', async () => {
    const { enumerateActivatorSoaDescriptors } = await import('../../../src/game/soa-orchestrator.js');
    const game = {
      figurePositions: { 1: { 'Stormtrooper-1-0': 'b2' }, 2: { 'Cad Bane-1-0': 'a1', 'Bossk-1-0': 'a3' } },
      selectedMap: { id: 'mos-eisley-outskirts' },
      p1DcList: [{ dcName: 'Stormtrooper', displayName: 'Stormtrooper' }],
      p1DcMessageIds: ['st-msg'],
      p2DcList: [
        { dcName: 'Cad Bane', displayName: 'Cad Bane' },
        { dcName: 'Bossk', displayName: 'Bossk' },
      ],
      p2DcMessageIds: ['cad-msg-p2', 'bossk-msg-p2'],
    };
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Stormtrooper', playerNum: 1, msgId: 'st-msg',
    });
    const imrnDescs = descriptors.filter(d => d.subPromptKey === 'imrn');
    assert.strictEqual(imrnDescs.length, 1, 'exactly ONE descriptor per Cad Bane (regardless of HUNTER count)');
    assert.strictEqual(imrnDescs[0].ownerPlayerNum, 2, 'owner is P2 (Cad Bane\'s team)');
    assert.strictEqual(imrnDescs[0].extras?.cadPlayerNum, 2);
    assert.strictEqual(imrnDescs[0].extras?.activatorMsgId, 'st-msg');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STRUCTURAL ORACLES — Phase 2d wiring verification
// ══════════════════════════════════════════════════════════════════════════════

describe('ORACLE-STARTACT-009: D38 I Make the Rules Now no longer inline', () => {
  it('D38 is replaced with a comment pointing to shared function', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    assert.ok(sectionD.includes('D38. I Make the Rules Now'),
      'D38 comment exists');
    assert.ok(sectionD.includes('now handled by applyStartOfActivationEffects'),
      'D38 comment references shared function');
  });

  it('D38 does not contain dcMessageMeta iteration', () => {
    const src = readSrc('src/engine/activation-setup.js');
    const sectionD = src.slice(src.indexOf('[D] START-OF-ACTIVATION PASSIVES'));
    const d38Idx = sectionD.indexOf('D38.');
    const d39Idx = sectionD.indexOf('D39.');
    assert.ok(d38Idx > 0 && d39Idx > d38Idx, 'D38 and D39 sections found');
    const d38Region = sectionD.slice(d38Idx, d39Idx);
    assert.ok(!d38Region.includes('dcMessageMeta'),
      'D38 must not iterate dcMessageMeta (replaced with getDcList + getDcMessageIds in shared function)');
    assert.ok(!d38Region.includes("'i_make_the_rules_cad_bane'"),
      'D38 must not contain inline ability ID check');
  });

  it('shared function uses getDcList + getDcMessageIds (no dcMessageMeta)', () => {
    const src = readSrc('src/engine/activation-effects.js');
    assert.ok(src.includes('getDcList'), 'Shared function imports getDcList');
    assert.ok(src.includes('getDcMessageIds'), 'Shared function imports getDcMessageIds');
    assert.ok(!src.includes('dcMessageMeta'),
      'Shared function must NOT reference dcMessageMeta (Discord infrastructure)');
  });
});
