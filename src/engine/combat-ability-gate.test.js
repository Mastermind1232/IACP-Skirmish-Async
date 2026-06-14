import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStepGate,
  activeSide,
  isGateComplete,
  autoResolvePassives,
  pendingInteractive,
  chooseAbility,
  passGate,
} from './combat-ability-gate.js';

const A_PASS = { id: 'a-pass', name: '+1 Damage', side: 'attacker', kind: 'passive' };
const A_INT1 = { id: 'a-int1', name: 'Reroll', side: 'attacker', kind: 'interactive' };
const A_INT2 = { id: 'a-int2', name: 'Tools for the Job', side: 'attacker', kind: 'interactive' };
const D_PASS = { id: 'd-pass', name: '+1 Block', side: 'defender', kind: 'passive' };
const D_INT1 = { id: 'd-int1', name: 'Parry', side: 'defender', kind: 'interactive' };

describe('combat-ability-gate: construction + validation', () => {
  it('rejects bad side / kind / duplicate id', () => {
    assert.throws(() => buildStepGate('step4-attacker', [{ id: 'x', side: 'nope', kind: 'passive' }]));
    assert.throws(() => buildStepGate('step4-attacker', [{ id: 'x', side: 'attacker', kind: 'bogus' }]));
    assert.throws(() => buildStepGate('step4-attacker', [{ id: 'x', side: 'attacker', kind: 'passive' }, { id: 'x', side: 'defender', kind: 'passive' }]));
  });
});

describe('combat-ability-gate: attacker gate fully completes before defender opens', () => {
  it('activeSide is attacker until it passes, then defender, then null', () => {
    const g = buildStepGate('step4-attacker', [A_PASS, A_INT1, D_PASS, D_INT1]);
    assert.equal(activeSide(g), 'attacker');
    // defender choices are not allowed while attacker is active
    assert.throws(() => chooseAbility(g, 'defender', 'd-int1'), /not active/);

    assert.deepEqual(autoResolvePassives(g, 'attacker'), ['a-pass']);
    chooseAbility(g, 'attacker', 'a-int1');
    passGate(g, 'attacker');

    assert.equal(activeSide(g), 'defender');
    assert.deepEqual(autoResolvePassives(g, 'defender'), ['d-pass']);
    passGate(g, 'defender');

    assert.equal(activeSide(g), null);
    assert.ok(isGateComplete(g));
  });
});

describe('combat-ability-gate: passives auto-fire, interactive is player-ordered', () => {
  it('passives must fire before interactive choices', () => {
    const g = buildStepGate('step4-attacker', [A_PASS, A_INT1, A_INT2]);
    assert.throws(() => chooseAbility(g, 'attacker', 'a-int1'), /resolve passives/);
    autoResolvePassives(g, 'attacker');
    assert.doesNotThrow(() => chooseAbility(g, 'attacker', 'a-int1'));
  });

  it('autoResolvePassives is idempotent (returns [] second time)', () => {
    const g = buildStepGate('step4-attacker', [A_PASS, A_INT1]);
    assert.deepEqual(autoResolvePassives(g, 'attacker'), ['a-pass']);
    assert.deepEqual(autoResolvePassives(g, 'attacker'), []);
  });

  it('player chooses interactive order; pendingInteractive shrinks; cannot double-resolve', () => {
    const g = buildStepGate('step4-attacker', [A_INT1, A_INT2]);
    autoResolvePassives(g, 'attacker'); // none, but required by contract
    assert.deepEqual(pendingInteractive(g, 'attacker'), ['a-int1', 'a-int2']);
    // resolve in player-chosen order: INT2 then INT1
    assert.equal(chooseAbility(g, 'attacker', 'a-int2').name, 'Tools for the Job');
    assert.deepEqual(pendingInteractive(g, 'attacker'), ['a-int1']);
    assert.equal(chooseAbility(g, 'attacker', 'a-int1').name, 'Reroll');
    assert.deepEqual(pendingInteractive(g, 'attacker'), []);
    assert.throws(() => chooseAbility(g, 'attacker', 'a-int1'), /already resolved/);
    assert.deepEqual(g.attacker.resolved, ['a-int2', 'a-int1']); // chosen order preserved
  });
});

describe('combat-ability-gate: empty sides auto-complete', () => {
  it('a side with no abilities does not block; gate with no abilities is complete', () => {
    const g = buildStepGate('step5', []);
    assert.ok(isGateComplete(g));
    assert.equal(activeSide(g), null);

    const g2 = buildStepGate('step4-attacker', [D_INT1]); // defender-only
    assert.equal(activeSide(g2), 'defender'); // attacker side auto-complete (empty)
    autoResolvePassives(g2, 'defender');
    passGate(g2, 'defender');
    assert.ok(isGateComplete(g2));
  });
});

describe('combat-ability-gate: a player may pass without resolving any interactive', () => {
  it('passGate completes the side even with interactive abilities left unresolved', () => {
    const g = buildStepGate('step4-attacker', [A_INT1, A_INT2]);
    autoResolvePassives(g, 'attacker');
    passGate(g, 'attacker'); // declines both
    assert.equal(activeSide(g), null); // no defender abilities → complete
    assert.deepEqual(g.attacker.resolved, []);
  });
});
