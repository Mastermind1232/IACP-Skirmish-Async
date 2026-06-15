/**
 * Generic window-gate wiring (alexanbv 2026-06-15: "wire the other combat
 * windows to allow for the inclusion of abilities in those windows"). Proves the
 * single generic builder (buildWindowGate) + the gate engine drive ANY attack
 * window — here the previously-undriven rerolls and after_resolve windows — with
 * the canonical sequence: passives auto-fire, interactive abilities resolve in
 * the player's chosen order, attacker gate fully before defender gate.
 *
 * Sample abilities are registered with an `applies` gated on a test-only combat
 * flag so they never appear in real combat queries.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWindowGate } from '../../../src/engine/combat-mods-gate.js';
import { registerCombatAbility } from '../../../src/engine/combat-timing-registry.js';
import { runGate, isGateComplete } from '../../../src/engine/combat-ability-gate.js';

const TEST = (g, c) => !!c?._testWindowGate;
for (const w of ['rerolls', 'after_resolve']) {
  registerCombatAbility({ id: `tw_${w}_a_pass`, name: 'AP', windows: [w], side: 'attacker', kind: 'passive', applies: TEST });
  registerCombatAbility({ id: `tw_${w}_a_i1`, name: 'AI1', windows: [w], side: 'attacker', kind: 'interactive', applies: TEST });
  registerCombatAbility({ id: `tw_${w}_a_i2`, name: 'AI2', windows: [w], side: 'attacker', kind: 'interactive', applies: TEST });
  registerCombatAbility({ id: `tw_${w}_d_i1`, name: 'DI1', windows: [w], side: 'defender', kind: 'interactive', applies: TEST });
}

describe('combat window gate: generic builder drives rerolls + after_resolve', () => {
  for (const w of ['rerolls', 'after_resolve']) {
    it(`${w}: builds from registry + drives attacker-then-defender, passives auto-fire`, async () => {
      const combat = { _testWindowGate: true };
      const gate = buildWindowGate(w, {}, combat, {});
      const ids = (s) => gate[s].passive.concat(gate[s].interactive);
      assert.ok(ids('attacker').includes(`tw_${w}_a_pass`), 'attacker passive present');
      assert.ok(ids('attacker').includes(`tw_${w}_a_i1`) && ids('attacker').includes(`tw_${w}_a_i2`), 'attacker interactives present');
      assert.ok(ids('defender').includes(`tw_${w}_d_i1`), 'defender interactive present');

      const log = [];
      const picks = { attacker: [`tw_${w}_a_i2`, `tw_${w}_a_i1`], defender: [`tw_${w}_d_i1`] };
      await runGate(gate, {
        firePassive: (side, id) => log.push(`P:${side}:${id}`),
        resolveInteractive: (side, id) => log.push(`I:${side}:${id}`),
        pickNext: (side) => picks[side].shift() ?? null,
      });
      assert.deepEqual(log, [
        `P:attacker:tw_${w}_a_pass`,
        `I:attacker:tw_${w}_a_i2`,
        `I:attacker:tw_${w}_a_i1`,
        `I:defender:tw_${w}_d_i1`,
      ], `${w} sequence: passive then player-ordered interactives, attacker before defender`);
      assert.ok(isGateComplete(gate));
    });
  }

  it('a window with no eligible abilities builds an empty, already-complete gate', () => {
    const gate = buildWindowGate('rerolls', {}, { _testWindowGate: false }, {});
    assert.ok(isGateComplete(gate), 'empty gate is complete (drives straight to onComplete)');
  });
});
