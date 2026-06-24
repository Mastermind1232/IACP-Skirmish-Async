import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStepGate, isGateComplete, activeSide } from './combat-ability-gate.js';
import { driveModsGate, recordModsChoice, passModsSide } from './combat-mods-orchestrator.js';

function gate() {
  return buildStepGate('mods', [
    { id: 'a-pass', name: 'AP', side: 'attacker', kind: 'passive' },
    { id: 'a-i1', name: 'AI1', side: 'attacker', kind: 'interactive' },
    { id: 'a-i2', name: 'AI2', side: 'attacker', kind: 'interactive' },
    { id: 'd-i1', name: 'DI1', side: 'defender', kind: 'interactive' },
  ]);
}

describe('combat-mods-orchestrator: event-driven sequencing', () => {
  it('fires passives, pauses for the attacker choose window, resumes on pick, then defender, then complete', async () => {
    const g = gate();
    const log = [];
    const dispatches = {
      firePassive: (side, id) => log.push(`P:${side}:${id}`),
      postChooseWindow: (side, pending) => log.push(`WIN:${side}:[${pending.join(',')}]`),
      onComplete: () => log.push('COMPLETE'),
    };

    // 1) enter mods → fires attacker passive, posts attacker choose window, pauses
    await driveModsGate(g, dispatches);
    assert.deepEqual(log, ['P:attacker:a-pass', 'WIN:attacker:[a-i1,a-i2]']);

    // 2) attacker picks a-i2 (resolves), re-drive → window again with a-i1 only
    recordModsChoice(g, 'attacker', 'a-i2');
    await driveModsGate(g, dispatches);
    assert.equal(log.at(-1), 'WIN:attacker:[a-i1]');

    // 3) attacker clicks Done → pass attacker → defender window
    passModsSide(g, 'attacker');
    await driveModsGate(g, dispatches);
    assert.equal(activeSide(g), 'defender');
    assert.equal(log.at(-1), 'WIN:defender:[d-i1]');

    // 4) defender clicks Done → gate complete → onComplete
    passModsSide(g, 'defender');
    await driveModsGate(g, dispatches);
    assert.ok(isGateComplete(g));
    assert.equal(log.at(-1), 'COMPLETE');
  });

  // alexanbv 2026-06-23: by DEFAULT (live games) every side posts a Done window
  // even with zero interactive abilities — no window auto-skips. The old
  // auto-advance behavior is preserved only under autoPassEmpty (self-play).
  it('autoPassEmpty: a gate with only passives completes without posting a window', async () => {
    const g = buildStepGate('mods', [
      { id: 'a-pass', name: 'AP', side: 'attacker', kind: 'passive' },
      { id: 'd-pass', name: 'DP', side: 'defender', kind: 'passive' },
    ]);
    const log = [];
    await driveModsGate(g, {
      autoPassEmpty: true,
      firePassive: (s, id) => log.push(`P:${s}:${id}`),
      postChooseWindow: () => log.push('WIN'),
      onComplete: () => log.push('COMPLETE'),
    });
    assert.deepEqual(log, ['P:attacker:a-pass', 'P:defender:d-pass', 'COMPLETE']);
  });

  it('autoPassEmpty: an empty gate completes immediately', async () => {
    const log = [];
    await driveModsGate(buildStepGate('mods', []), { autoPassEmpty: true, onComplete: () => log.push('COMPLETE') });
    assert.deepEqual(log, ['COMPLETE']);
  });

  it('default (live): an empty gate posts a Done window for EACH side before completing', async () => {
    const g = buildStepGate('mods', []);
    const log = [];
    const d = {
      firePassive: (s, id) => log.push(`P:${s}:${id}`),
      postChooseWindow: (side, pending) => log.push(`WIN:${side}:[${pending.join(',')}]`),
      onComplete: () => log.push('COMPLETE'),
    };
    await driveModsGate(g, d); // posts empty attacker window, pauses
    assert.deepEqual(log, ['WIN:attacker:[]']);
    passModsSide(g, 'attacker');
    await driveModsGate(g, d); // posts empty defender window, pauses
    assert.equal(log.at(-1), 'WIN:defender:[]');
    passModsSide(g, 'defender');
    await driveModsGate(g, d);
    assert.equal(log.at(-1), 'COMPLETE');
  });
});
