/**
 * Per-step pipeline confirmation (alexanbv 2026-06-14: "wire sample abilities
 * for each gate, at each step of combat, so you can confirm the pipeline
 * works. Report that the pipeline works or does not work with test cases.").
 *
 * The gate pipeline is window-parameterized — the SAME engine (buildStepGate →
 * runGate → resolver dispatch) drives every step. These cases run that engine
 * at EACH combat window (on_declare → rerolls → mods → special → after_resolve)
 * with sample abilities and confirm the canonical sequence holds everywhere:
 * passives auto-fire, the active player resolves interactive abilities in the
 * order they choose, attacker gate fully before defender gate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TIMING_WINDOWS } from './combat-timing-registry.js';
import { buildStepGate, runGate, isGateComplete } from './combat-ability-gate.js';

function sampleGate(step) {
  return buildStepGate(step, [
    { id: `${step}-a-pass`, name: 'AP', side: 'attacker', kind: 'passive' },
    { id: `${step}-a-i1`, name: 'AI1', side: 'attacker', kind: 'interactive' },
    { id: `${step}-a-i2`, name: 'AI2', side: 'attacker', kind: 'interactive' },
    { id: `${step}-d-pass`, name: 'DP', side: 'defender', kind: 'passive' },
    { id: `${step}-d-i1`, name: 'DI1', side: 'defender', kind: 'interactive' },
  ]);
}

describe('combat pipeline: works at every step (window-agnostic engine)', () => {
  for (const step of TIMING_WINDOWS) {
    it(`${step}: passives auto-fire, interactive player-ordered, attacker gate before defender`, async () => {
      const gate = sampleGate(step);
      const log = [];
      // attacker resolves i2 then i1 (player's chosen order); defender resolves i1.
      const picks = { attacker: [`${step}-a-i2`, `${step}-a-i1`], defender: [`${step}-d-i1`] };
      await runGate(gate, {
        firePassive: (side, id) => log.push(`P:${side}:${id}`),
        resolveInteractive: (side, id) => log.push(`I:${side}:${id}`),
        pickNext: (side) => picks[side].shift() ?? null,
      });
      assert.deepEqual(log, [
        `P:attacker:${step}-a-pass`,
        `I:attacker:${step}-a-i2`,
        `I:attacker:${step}-a-i1`,
        `P:defender:${step}-d-pass`,
        `I:defender:${step}-d-i1`,
      ], `step '${step}' sequence`);
      assert.ok(isGateComplete(gate), `step '${step}' completes`);
    });
  }

  it('a player may pass without resolving (any step)', async () => {
    const gate = sampleGate('mods');
    const log = [];
    await runGate(gate, {
      firePassive: (s, id) => log.push(`P:${s}:${id}`),
      resolveInteractive: (s, id) => log.push(`I:${s}:${id}`),
      pickNext: () => null, // decline everything
    });
    assert.deepEqual(log.filter((l) => l.startsWith('I:')), [], 'no interactive resolved when passing');
    assert.ok(isGateComplete(gate));
  });
});
