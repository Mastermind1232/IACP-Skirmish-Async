/**
 * Decision-class audit (2026-04-17) — tracks which branch of pickSmartAction
 * actually produced the returned action. Needed for the representation-vs-
 * credit-assignment diagnostic: before investing in graph or MC-return, we
 * need to know how often the DQN argmax even decides vs gets bypassed by
 * mandatory flow, the within-activation planner, ε-exploration, or fallback.
 *
 *   mandatoryFlow     — gate / combat_flow abstract types (no strategic choice)
 *   epsilonExplore    — ε-greedy heuristic pick
 *   plannerDominated  — oracleActivationPlan returned a plan
 *   dqnArgmax         — full Q-argmax → within-group scorer path
 *   heuristicFallback — any "no network / no absTypes / bestType==null" path
 *
 * wgResolved[class] is keyed by the returned action's abstract class so the
 * action-mix is visible orthogonal to how the decision was reached.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDecisionClassAudit,
  resetDecisionClassAudit,
  pickSmartAction,
  setGreedyMode,
} from '../../headless/learnings.js';

function baseLearnings() {
  return { network: null, graphNetwork: null, withinGroupWeights: {}, meta: { totalGames: 0 } };
}

function gateGame() {
  return {
    currentRound: 1,
    figurePositions: { 1: { 'TestDC-1-0': 'a4' }, 2: { 'Enemy-1-0': 'a5' } },
    p1ActivatedDcIndices: [], p2ActivatedDcIndices: [],
    p1DcMessageIds: ['msg-p1-dc1'], p2DcMessageIds: ['msg-p2-dc1'],
    selectedMap: { id: 'devaron-garrison' }, selectedMission: { variant: 'a' },
    dcActionsData: { 'msg-p1-dc1': { selectedFigure: 0 } },
  };
}

describe('decision-class audit — lifecycle', () => {
  beforeEach(() => resetDecisionClassAudit());

  it('reset zeroes every counter', () => {
    const a = getDecisionClassAudit();
    assert.equal(a.calls, 0);
    assert.equal(a.mandatoryFlow, 0);
    assert.equal(a.epsilonExplore, 0);
    assert.equal(a.plannerDominated, 0);
    assert.equal(a.dqnArgmax, 0);
    assert.equal(a.heuristicFallback, 0);
    for (const k of Object.keys(a.wgResolved)) assert.equal(a.wgResolved[k], 0);
  });

  it('get returns a deep copy — mutating snapshot does not leak into state', () => {
    const s1 = getDecisionClassAudit();
    s1.calls = 999;
    s1.wgResolved.attack = 999;
    const s2 = getDecisionClassAudit();
    assert.equal(s2.calls, 0);
    assert.equal(s2.wgResolved.attack, 0);
  });
});

describe('decision-class audit — pickSmartAction instrumentation', () => {
  after(() => setGreedyMode(false));

  it('mandatoryFlow: all-mandatory input increments mandatoryFlow', () => {
    resetDecisionClassAudit();
    setGreedyMode(true); // suppress ε branch (irrelevant here but keeps things deterministic)
    const mandatory = [
      { type: 'phase_gate_ready', params: {}, actingPlayer: 1 },
      { type: 'end_start_of_round', params: {}, actingPlayer: 1 },
    ];
    pickSmartAction(mandatory, gateGame(), baseLearnings(), 1, new Map(), new Map());
    const a = getDecisionClassAudit();
    assert.equal(a.calls, 1);
    assert.equal(a.mandatoryFlow, 1);
    assert.equal(a.dqnArgmax, 0);
    // Final action is a gate → not one of the wgResolved buckets proper; it
    // lands in 'other' since 'gate' is not in the coarse classifier map.
    assert.equal(a.wgResolved.other, 1);
  });

  it('heuristicFallback: null network, strategic input → heuristicFallback bucket', () => {
    resetDecisionClassAudit();
    setGreedyMode(true); // epsilon = 0 → bypass ε branch, hit no-network fallback
    const strategic = [
      { type: 'dc_end_activation', params: { msgId: 'msg-p1-dc1', dcName: 'TestDC' }, actingPlayer: 1 },
      { type: 'attack_target',
        params: { msgId: 'msg-p1-dc1', dcName: 'TestDC', targetFigureKey: 'Enemy-1-0' },
        actingPlayer: 1 },
    ];
    pickSmartAction(strategic, gateGame(), baseLearnings(), 1, new Map(), new Map());
    const a = getDecisionClassAudit();
    assert.equal(a.calls, 1);
    assert.equal(a.mandatoryFlow, 0);
    assert.equal(a.heuristicFallback, 1);
    // Classifier should route the chosen action into a known bucket
    // (attack_close/ranged → 'attack', end_activation → 'other').
    const landed = a.wgResolved.attack + a.wgResolved.other;
    assert.equal(landed, 1);
  });

  it('wgResolved: attack classification when attack is returned', () => {
    resetDecisionClassAudit();
    setGreedyMode(true);
    // Heuristic fallback with only attacks legal — chosen action must classify
    // under wgResolved.attack.
    const attacksOnly = [
      { type: 'attack_target',
        params: { msgId: 'msg-p1-dc1', dcName: 'TestDC', targetFigureKey: 'Enemy-1-0' },
        actingPlayer: 1 },
    ];
    // Single-action early-exit path is uninstrumented (no real decision), so
    // add a second distinct target to force the strategic route.
    attacksOnly.push({
      type: 'attack_target',
      params: { msgId: 'msg-p1-dc1', dcName: 'TestDC', targetFigureKey: 'Enemy-1-0' },
      actingPlayer: 1,
    });
    pickSmartAction(attacksOnly, gateGame(), baseLearnings(), 1, new Map(), new Map());
    const a = getDecisionClassAudit();
    assert.equal(a.calls, 1);
    assert.equal(a.wgResolved.attack, 1);
  });

  it('single-action early-exit path is not counted (no decision made)', () => {
    resetDecisionClassAudit();
    const only = [{ type: 'dc_end_activation', params: {}, actingPlayer: 1 }];
    pickSmartAction(only, gateGame(), baseLearnings(), 1, new Map(), new Map());
    assert.equal(getDecisionClassAudit().calls, 0,
      'single-action calls skip all return-site instrumentation');
  });

  it('counters accumulate across multiple calls', () => {
    resetDecisionClassAudit();
    setGreedyMode(true);
    const mandatory = [
      { type: 'phase_gate_ready', params: {}, actingPlayer: 1 },
      { type: 'end_start_of_round', params: {}, actingPlayer: 1 },
    ];
    for (let i = 0; i < 3; i++) {
      pickSmartAction(mandatory, gateGame(), baseLearnings(), 1, new Map(), new Map());
    }
    const a = getDecisionClassAudit();
    assert.equal(a.calls, 3);
    assert.equal(a.mandatoryFlow, 3);
  });
});
