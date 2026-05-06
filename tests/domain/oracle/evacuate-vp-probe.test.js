/**
 * Evacuate VP calculation — behavioral probe.
 *
 * Destruct V2 ruling (CC17) + 2026-05-06 ceil→floor fix: Evacuate halves
 * the DC's BASE cost first (rounded DOWN per card text "rounded down"),
 * then applies negative-cost attachments AFTER halving. Formula:
 *   halfVp = max(0, floor((baseCost + positiveAttachments) / 2) + negativeAttachments)
 *
 * Prior code (a) only summed CC attachments and halved the total — ignored
 * DC-level attachments — and (b) used Math.ceil for the halve, contradicting
 * the card's "rounded down" text. Example: Chewbacca (15) + Wookiee Avenger (-4)
 *   previously: ceil(11/2) = 6 VP (no DC-att support)
 *   then briefly: ceil(15/2) − 4 = 4 VP (DC-att support, wrong rounding)
 *   now correctly: floor(15/2) − 4 = 3 VP
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

function setup({ dcName, baseMsgId = 'msg_target', targetFigKey, baseCost, ccAtts = [], dcAtts = [] }) {
  const dcMessageMeta = new Map();
  dcMessageMeta.set('msg_evacuator', { gameId: 't', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper' });
  dcMessageMeta.set(baseMsgId, { gameId: 't', playerNum: 1, dcName, displayName: dcName });
  const dcHealthState = new Map();
  dcHealthState.set(baseMsgId, [[baseCost, baseCost]]);
  const game = {
    gameId: 't', player1Id: 'p1', player2Id: 'p2', currentRound: 1,
    p1DcList: [{ name: 'Rebel Trooper' }, { name: dcName }],
    p1DcMessageIds: ['msg_evacuator', baseMsgId],
    p1ActivatedDcIndices: [0],
    figurePositions: { 1: { [targetFigKey]: 'b3', 'Rebel Trooper-1-0': 'c3' }, 2: {} },
    p1CcAttachments: { [baseMsgId]: ccAtts },
    p2CcAttachments: {},
    p1DcAttachments: { [baseMsgId]: dcAtts },
    p2DcAttachments: {},
    dcActionsData: { msg_evacuator: { actionsUsed: [] } },
  };
  return {
    game, dcMessageMeta, dcHealthState,
    context: { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: targetFigKey },
  };
}

function vpFromLog(logMessage) {
  const m = logMessage.match(/gains (\d+) VP/);
  if (m) return parseInt(m[1], 10);
  if (/gains no VP/.test(logMessage)) return 0;
  return null;
}

// ── PROBE-EVAC-001: negative DC attachment (Wookiee Avenger on Chewbacca) ───

describe('PROBE-EVAC-001: negative DC attachment subtracted AFTER halving', () => {
  it('Chewbacca (15) + Wookiee Avenger (-4) = 3 VP (floor(15/2)−4)', () => {
    const { context } = setup({
      dcName: 'Chewbacca', baseCost: 15,
      targetFigKey: 'Chewbacca-1-0',
      dcAtts: ['Wookiee Avenger'],
    });
    const result = resolveAbility('Evacuate', context);
    assert.equal(result.applied, true, 'Evacuate should resolve');
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 3, `expected 3 VP (floor(15/2)−4), got ${vp} — log: ${result.logMessage}`);
  });

  it('Gaarkhan (7) + Driven by Hatred (-5) = 0 VP (floor(7/2)−5, clamped)', () => {
    const { context } = setup({
      dcName: 'Gaarkhan', baseCost: 7,
      targetFigKey: 'Gaarkhan-1-0',
      dcAtts: ['Driven by Hatred'],
    });
    const result = resolveAbility('Evacuate', context);
    assert.equal(result.applied, true);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 0, `expected 0 VP (3−5 clamped at 0), got ${vp} — log: ${result.logMessage}`);
  });

  it('AT-ST (10) + Scavenged Walker (-1) = 4 VP', () => {
    const { context } = setup({
      dcName: 'AT-ST', baseCost: 10,
      targetFigKey: 'AT-ST-1-0',
      dcAtts: ['Scavenged Walker'],
    });
    const result = resolveAbility('Evacuate', context);
    assert.equal(result.applied, true);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 4, `expected 4 VP (floor(10/2)−1), got ${vp} — log: ${result.logMessage}`);
  });
});

// ── PROBE-EVAC-002: no attachments — baseline (half of base, rounded up) ────

describe('PROBE-EVAC-002: no-attachment baseline', () => {
  it('Chewbacca (15) alone = 7 VP (floor(15/2))', () => {
    const { context } = setup({
      dcName: 'Chewbacca', baseCost: 15,
      targetFigKey: 'Chewbacca-1-0',
    });
    const result = resolveAbility('Evacuate', context);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 7, `expected 7 VP (floor(15/2)), got ${vp} — log: ${result.logMessage}`);
  });

  it('Rebel Trooper Regular (6) alone = 3 VP', () => {
    const { context } = setup({
      dcName: 'Rebel Trooper (Regular)', baseCost: 6,
      targetFigKey: 'Rebel Trooper (Regular)-1-0',
    });
    const result = resolveAbility('Evacuate', context);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 3, `expected 3 VP (floor(6/2)), got ${vp} — log: ${result.logMessage}`);
  });
});

// ── PROBE-EVAC-003: positive DC attachment folded into pre-halving sum ──────

describe('PROBE-EVAC-003: positive DC attachment folded into pre-halving sum', () => {
  it('Stormtrooper Regular (6) + Flame Trooper upgrade (+5) = 5 VP (floor(11/2))', () => {
    const { context } = setup({
      dcName: 'Stormtrooper (Regular)', baseCost: 6,
      targetFigKey: 'Stormtrooper (Regular)-1-0',
      dcAtts: ['Flame Trooper'],
    });
    const result = resolveAbility('Evacuate', context);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 5, `expected 5 VP (floor((6+5)/2)), got ${vp} — log: ${result.logMessage}`);
  });
});

// ── PROBE-EVAC-004: half cannot go negative ────────────────────────────────

describe('PROBE-EVAC-004: half-VP never below zero', () => {
  it('Rebel Trooper Regular (6) + Driven by Hatred (-5) = 0 VP (clamped)', () => {
    // Nonsensical pairing mechanically, but guards against formula underflow.
    const { context } = setup({
      dcName: 'Rebel Trooper (Regular)', baseCost: 6,
      targetFigKey: 'Rebel Trooper (Regular)-1-0',
      dcAtts: ['Driven by Hatred'],
    });
    const result = resolveAbility('Evacuate', context);
    const vp = vpFromLog(result.logMessage);
    assert.equal(vp, 0, `expected 0 VP (clamp), got ${vp} — log: ${result.logMessage}`);
  });
});
