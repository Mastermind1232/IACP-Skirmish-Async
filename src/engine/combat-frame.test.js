// Unit tests for the combat-frame scaffolding (slice 2).
// No behavior-coupling — these only verify the shape constructors and
// the snapshot adapter map the existing pendingCombat shape correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMBAT_STEPS,
  stepIndex,
  canAdvanceStep,
  makeResultSymbol,
  makeModifier,
  makeCcPlayStackEntry,
  makeAttackFrame,
  dropDefenderBoundModifiers,
  advanceFrameStep,
  snapshotPendingCombat,
} from './combat-frame.js';

// ── Step ordering ─────────────────────────────────────────────────────────────

test('COMBAT_STEPS encodes the canonical CRR order', () => {
  // Spot-check the critical orderings destruct nailed down in the audit.
  assert(stepIndex('step1+2-attacker') < stepIndex('step1+2-defender'),
    'attacker resolves Step 1+2 before defender');
  assert(stepIndex('step1+2-defender') < stepIndex('roll'),
    'roll happens after both sides have committed pool/on-declare effects');
  assert(stepIndex('step3-attacker') < stepIndex('step3-defender'),
    'attacker rerolls before defender (per CRR Conflicts p.22)');
  assert(stepIndex('step5') < stepIndex('zillo-window'),
    'Zillo special window fires after surge-spend, before damage calc');
  assert(stepIndex('zillo-window') < stepIndex('step7'),
    'Zillo special window resolves before damage calculation');
  assert(stepIndex('step7') < stepIndex('step8'),
    'damage applies before after-attack-resolves');
  assert.equal(stepIndex('resolved'), COMBAT_STEPS.length - 1,
    'resolved is terminal');
});

test('canAdvanceStep refuses backward transitions', () => {
  assert.equal(canAdvanceStep('step5', 'step7'), true);
  assert.equal(canAdvanceStep('step5', 'step3-attacker'), false);
  assert.equal(canAdvanceStep('step1+2-attacker', 'step1+2-attacker'), true, 'self-transition allowed');
  assert.equal(canAdvanceStep('not-a-step', 'step5'), false);
});

// ── ResultSymbol ──────────────────────────────────────────────────────────────

test('makeResultSymbol validates kind and source, freezes the object', () => {
  const r = makeResultSymbol({ kind: 'damage', source: 'rolled-die' });
  assert.equal(r.kind, 'damage');
  assert.equal(r.source, 'rolled-die');
  assert.equal(r.value, 1);
  assert.equal(Object.isFrozen(r), true);
});

test('makeResultSymbol rejects unknown kind/source', () => {
  assert.throws(() => makeResultSymbol({ kind: 'wat', source: 'rolled-die' }), /invalid kind/);
  assert.throws(() => makeResultSymbol({ kind: 'damage', source: 'wat' }), /invalid source/);
});

test('makeResultSymbol rejects non-positive value', () => {
  assert.throws(() => makeResultSymbol({ kind: 'damage', source: 'rolled-die', value: 0 }), /value/);
  assert.throws(() => makeResultSymbol({ kind: 'damage', source: 'rolled-die', value: -1 }), /value/);
});

// ── Modifier ──────────────────────────────────────────────────────────────────

test('makeModifier validates subject and freezes', () => {
  const m = makeModifier({
    source: 'Tools for the Job',
    subject: { kind: 'attack' },
    effect: { kind: 'pool-add', dieColor: 'yellow' },
    applyAt: 'step1+2-attacker',
  });
  assert.equal(m.source, 'Tools for the Job');
  assert.equal(m.subject.kind, 'attack');
  assert.equal(Object.isFrozen(m), true);
  assert.equal(Object.isFrozen(m.subject), true);
  assert.equal(Object.isFrozen(m.effect), true);
});

test('makeModifier requires figureKey when subject.kind is attacker or defender', () => {
  assert.throws(() => makeModifier({
    source: 'Element of Surprise',
    subject: { kind: 'defender' },
    effect: { kind: 'pool-remove' },
    applyAt: 'step1+2-attacker',
  }), /figureKey/);
});

test('makeModifier rejects invalid applyAt', () => {
  assert.throws(() => makeModifier({
    source: 'X',
    subject: { kind: 'attack' },
    effect: {},
    applyAt: 'not-a-step',
  }), /applyAt/);
});

// ── CcPlayStackEntry ──────────────────────────────────────────────────────────

test('makeCcPlayStackEntry initializes flags to false', () => {
  const e = makeCcPlayStackEntry({ ccName: 'Brace for Impact', playerNum: 2 });
  assert.equal(e.ccName, 'Brace for Impact');
  assert.equal(e.playerNum, 2);
  assert.equal(e.depth, 0);
  assert.equal(e.canceled, false);
  assert.equal(e.resolved, false);
});

test('makeCcPlayStackEntry rejects invalid playerNum', () => {
  assert.throws(() => makeCcPlayStackEntry({ ccName: 'X', playerNum: 3 }), /playerNum/);
  assert.throws(() => makeCcPlayStackEntry({ ccName: 'X', playerNum: 0 }), /playerNum/);
});

test('makeCcPlayStackEntry tracks counter recursion depth', () => {
  const counter = makeCcPlayStackEntry({
    ccName: 'Comm Disruption',
    playerNum: 1,
    depth: 1,
  });
  assert.equal(counter.depth, 1);
});

// ── AttackFrame ───────────────────────────────────────────────────────────────

test('makeAttackFrame initializes canonical fields', () => {
  const f = makeAttackFrame({
    frameId: 'root',
    attackerFigureKey: 'Han Solo-1-0',
    attackerPlayerNum: 1,
    defenderFigureKey: 'Hired Gun-1-0',
    defenderPlayerNum: 2,
    attackPool: ['red', 'green'],
    defensePool: ['white'],
  });
  assert.equal(f.frameId, 'root');
  assert.equal(f.parentFrameId, null);
  assert.equal(f.attacker.figureKey, 'Han Solo-1-0');
  assert.equal(f.defender.figureKey, 'Hired Gun-1-0');
  assert.deepEqual(f.attackPool, ['red', 'green']);
  assert.deepEqual(f.defensePool, ['white']);
  assert.deepEqual(f.attackResults, []);
  assert.deepEqual(f.defenseResults, []);
  assert.deepEqual(f.modifiers, []);
  assert.deepEqual(f.ccPlayStack, []);
  assert.equal(f.currentStep, 'pre-declare');
  assert.deepEqual(f.perStepPasses, { attacker: {}, defender: {} });
  assert.deepEqual(f.perFrameLimits, {});
});

test('makeAttackFrame copies pools so caller mutations do not leak', () => {
  const pool = ['red'];
  const f = makeAttackFrame({
    frameId: 'root',
    attackerFigureKey: 'A-1-0',
    attackerPlayerNum: 1,
    defenderFigureKey: 'B-1-0',
    defenderPlayerNum: 2,
    attackPool: pool,
  });
  pool.push('blue');
  assert.deepEqual(f.attackPool, ['red'], 'caller pool mutation must not leak into frame');
});

test('makeAttackFrame rejects bad inputs', () => {
  assert.throws(() => makeAttackFrame({
    frameId: '',
    attackerFigureKey: 'A',
    attackerPlayerNum: 1,
    defenderFigureKey: 'B',
    defenderPlayerNum: 2,
  }), /frameId/);
  assert.throws(() => makeAttackFrame({
    frameId: 'r',
    attackerFigureKey: 'A',
    attackerPlayerNum: 3,
    defenderFigureKey: 'B',
    defenderPlayerNum: 2,
  }), /attackerPlayerNum/);
});

test('makeAttackFrame supports nested frames via parentFrameId', () => {
  const nested = makeAttackFrame({
    frameId: 'parting-shot-1',
    parentFrameId: 'root',
    attackerFigureKey: 'Hired Gun-1-0', // HG attacks Han during Parting Shot
    attackerPlayerNum: 2,
    defenderFigureKey: 'Han Solo-1-0',
    defenderPlayerNum: 1,
  });
  assert.equal(nested.parentFrameId, 'root');
  assert.equal(nested.attacker.figureKey, 'Hired Gun-1-0',
    'inverted attacker/defender for nested Parting Shot');
});

// ── Modifier subject-binding ──────────────────────────────────────────────────

test('dropDefenderBoundModifiers drops only the named defender', () => {
  const eos = makeModifier({
    source: 'Element of Surprise',
    subject: { kind: 'defender', figureKey: 'Han Solo-1-0' },
    effect: { kind: 'pool-remove', count: 1 },
    applyAt: 'step1+2-attacker',
  });
  const tools = makeModifier({
    source: 'Tools for the Job',
    subject: { kind: 'attack' },
    effect: { kind: 'pool-add', dieColor: 'yellow' },
    applyAt: 'step1+2-attacker',
  });
  const result = dropDefenderBoundModifiers([eos, tools], 'Han Solo-1-0');
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'Tools for the Job');
});

test('dropDefenderBoundModifiers keeps modifiers bound to a different defender', () => {
  const eos = makeModifier({
    source: 'Element of Surprise',
    subject: { kind: 'defender', figureKey: 'Han Solo-1-0' },
    effect: { kind: 'pool-remove', count: 1 },
    applyAt: 'step1+2-attacker',
  });
  const result = dropDefenderBoundModifiers([eos], 'Different-Defender-1-0');
  assert.equal(result.length, 1, 'modifier bound to a different figure must persist');
});

// ── advanceFrameStep ──────────────────────────────────────────────────────────

test('advanceFrameStep advances forward and rejects backward', () => {
  const f = makeAttackFrame({
    frameId: 'root',
    attackerFigureKey: 'A-1-0',
    attackerPlayerNum: 1,
    defenderFigureKey: 'B-1-0',
    defenderPlayerNum: 2,
  });
  const f2 = advanceFrameStep(f, 'step1+2-attacker');
  assert.equal(f2.currentStep, 'step1+2-attacker');
  assert.notEqual(f2, f, 'advanceFrameStep returns a new object');
  assert.throws(() => advanceFrameStep(f2, 'pre-declare'), /cannot advance/);
});

// ── Snapshot adapter ──────────────────────────────────────────────────────────

test('snapshotPendingCombat returns null when no combat in progress', () => {
  assert.equal(snapshotPendingCombat({}), null);
  assert.equal(snapshotPendingCombat({ pendingCombat: null }), null);
  assert.equal(snapshotPendingCombat(null), null);
});

test('snapshotPendingCombat maps key fields from the legacy shape', () => {
  const game = {
    pendingCombat: {
      attackerFigureKey: 'Han Solo-1-0',
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      target: { figureKey: 'Hired Gun-1-0' },
      attackInfo: { dice: ['red', 'green'], type: 'range' },
      targetStats: { defense: ['white'] },
    },
  };
  const f = snapshotPendingCombat(game);
  assert.equal(f.frameId, 'root');
  assert.equal(f.parentFrameId, null);
  assert.equal(f.attacker.figureKey, 'Han Solo-1-0');
  assert.equal(f.attacker.playerNum, 1);
  assert.equal(f.defender.figureKey, 'Hired Gun-1-0');
  assert.equal(f.defender.playerNum, 2);
  assert.deepEqual(f.attackPool, ['red', 'green']);
  assert.deepEqual(f.defensePool, ['white']);
});

test('snapshotPendingCombat normalizes scalar defense to an array', () => {
  const game = {
    pendingCombat: {
      attackerFigureKey: 'A-1-0',
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      target: { figureKey: 'B-1-0' },
      attackInfo: { dice: ['red'] },
      targetStats: { defense: 'white' },
    },
  };
  const f = snapshotPendingCombat(game);
  assert.deepEqual(f.defensePool, ['white']);
});
