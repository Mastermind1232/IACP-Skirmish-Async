/**
 * Behavioral coverage for the MEDIUM-severity ability-audit batch fixes.
 *
 *   MB-01: False Orders — per-figure subCost eligibility (multi-figure
 *          groups whose figure cost <=4 but group cost >4 are eligible).
 *   MB-02: Field Report — "Choose up to 2 friendly figures" now offers a
 *          player pick (requiresChoice) when >2 candidates exist.
 *   MB-03: You Have Something I Want — once-per-activation guard.
 *   MB-04: This is the Way — The Armorer does not self-grant (probe-level).
 *   MB-05: Calming Presence — REBEL FORCE USER keyword gate + once/round.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { enumerateActivatorSoaDescriptors } from '../../../src/game/soa-orchestrator.js';

function makeGame(overrides = {}) {
  return {
    gameId: 'mbtest',
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    ...overrides,
  };
}

// countGameSpaces / getReachableSpaces use the REAL data-loader map, not the
// context mock — use a real map id with known-close coords.
const REAL_MAP_ID = 'unit-test-grid';

function baseContext(game, { msgId, meta, targetFigureKey, choiceIndex } = {}) {
  return {
    game,
    playerNum: 1,
    meta,
    msgId,
    dcMessageMeta: new Map([[msgId, meta]]),
    dcHealthState: new Map(),
    hasLineOfSight: () => true,
    hasLineOfSightByCoord: () => true,
    getFigureSize: () => '1x1',
    getRange: () => 8,
    getMapData: () => ({ adjacency: {}, spaces: [] }),
    targetFigureKey,
    choiceIndex,
  };
}

// ── MB-01: False Orders uses per-figure subCost ────────────────────────────
describe('MB-01: False Orders — per-figure subCost eligibility', () => {
  function buildFalseOrders(enemyPositions) {
    const msgId = 'msg_murne';
    const meta = { gameId: 'mbtest', playerNum: 1, dcName: 'Murne Rin', displayName: 'Murne Rin [DG 1]' };
    const game = makeGame({
      selectedMap: { id: REAL_MAP_ID },
      figurePositions: { 1: { 'Murne Rin-1-0': 'd4' }, 2: enemyPositions },
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
      ccHands: { 1: [], 2: [] },
    });
    return baseContext(game, { msgId, meta });
  }

  it('includes a multi-figure DC whose subCost<=4 even though group cost>4', () => {
    // 74-Z Speeder Bike (Elite): cost 7, subCost 4 → eligible by subCost.
    const ctx = buildFalseOrders({ '74-Z Speeder Bike (Elite)-1-0': 'e4' });
    const result = resolveAbility('false_orders', ctx);
    assert.equal(result.requiresChoice, true, 'should offer the 74-Z as a target');
    assert.ok(result.targetFigureKeys.includes('74-Z Speeder Bike (Elite)-1-0'),
      'subCost 4 figure should be eligible');
  });
});

// ── MB-02: Field Report multi-select ───────────────────────────────────────
describe('MB-02: Field Report — choose up to 2 friendly figures', () => {
  function buildFieldReport(friendlyExtra) {
    const msgId = 'msg_murne_fr';
    const meta = { gameId: 'mbtest', playerNum: 1, dcName: 'Murne Rin', displayName: 'Murne Rin [DG 1]' };
    const game = makeGame({
      selectedMap: { id: REAL_MAP_ID },
      figurePositions: {
        1: { 'Murne Rin-1-0': 'd4', ...friendlyExtra },
        2: {},
      },
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
    });
    return { game, ctx: baseContext(game, { msgId, meta }), msgId, meta };
  }

  it('offers a player pick (requiresChoice) when >2 candidates exist', () => {
    // 3 low-dice friendly troopers within range → must let the player pick.
    const { ctx } = buildFieldReport({
      'Rebel Trooper-1-0': 'd5',
      'Rebel Trooper-2-0': 'd3',
      'Rebel Trooper-3-0': 'e4',
    });
    const result = resolveAbility('field_report', ctx);
    assert.equal(result.applied, false);
    assert.equal(result.requiresChoice, true, 'with >2 candidates a choice must be offered');
    assert.ok(result.choiceOptions.includes('Done selecting'), 'should include a Done option');
    assert.ok(result.targetFigureKeys.includes('__done__'));
  });

  it('sequential pick caps at 2 then applies Hide', () => {
    const { game, ctx, msgId, meta } = buildFieldReport({
      'Rebel Trooper-1-0': 'd5',
      'Rebel Trooper-2-0': 'd3',
      'Rebel Trooper-3-0': 'e4',
    });
    resolveAbility('field_report', ctx); // Phase 1: sets pendingFieldReport
    assert.ok(game.pendingFieldReport?.[msgId], 'pending state created');
    // Pick first
    const r1 = resolveAbility('field_report', baseContext(game, { msgId, meta, targetFigureKey: 'Rebel Trooper-1-0' }));
    assert.equal(r1.requiresChoice, true, 'after 1 pick still offers another');
    // Pick second → caps and applies
    const r2 = resolveAbility('field_report', baseContext(game, { msgId, meta, targetFigureKey: 'Rebel Trooper-2-0' }));
    assert.equal(r2.applied, true, 'second pick reaches the cap and applies');
    assert.ok(!game.pendingFieldReport?.[msgId], 'pending cleared after cap');
    assert.deepEqual(game.figureConditions['Rebel Trooper-1-0'], ['Hide']);
    assert.deepEqual(game.figureConditions['Rebel Trooper-2-0'], ['Hide']);
    assert.equal(game.figureConditions['Rebel Trooper-3-0'], undefined, 'third not hidden');
  });

  it('auto-applies when <=2 candidates (no spurious choice)', () => {
    const { game, ctx } = buildFieldReport({ 'Rebel Trooper-1-0': 'd5' });
    const result = resolveAbility('field_report', ctx);
    assert.equal(result.applied, true);
    assert.deepEqual(game.figureConditions['Rebel Trooper-1-0'], ['Hide']);
  });
});

// ── MB-03: You Have Something I Want — once per activation ──────────────────
describe('MB-03: You Have Something I Want — once per activation', () => {
  function build(game) {
    const msgId = 'msg_gideon';
    const meta = { gameId: 'mbtest', playerNum: 1, dcName: 'Moff Gideon', displayName: 'Moff Gideon [DG 1]' };
    return { msgId, meta, ctx: (extra) => baseContext(game, { msgId, meta, ...extra }) };
  }

  it('blocks a fresh Phase-1 entry after the flag is set', () => {
    const game = makeGame({
      selectedMap: { id: REAL_MAP_ID },
      figurePositions: { 1: { 'Moff Gideon-1-0': 'd4' }, 2: { 'Rebel Trooper-1-0': 'e4' } },
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Block'] },
      dcActionsData: { msg_gideon: { selectedFigure: 0 } },
      yhsiwUsedThisActivation: { msg_gideon: true },
    });
    const { ctx } = build(game);
    const result = resolveAbility('you_have_something_i_want_gideon', ctx({}));
    assert.equal(result.applied, false);
    assert.match(result.manualMessage || '', /Already used this activation/);
  });

  it('Phase-1 offers a choice when not yet used', () => {
    const game = makeGame({
      selectedMap: { id: REAL_MAP_ID },
      figurePositions: { 1: { 'Moff Gideon-1-0': 'd4' }, 2: { 'Rebel Trooper-1-0': 'e4' } },
      figurePowerTokens: { 'Rebel Trooper-1-0': ['Block'] },
      dcActionsData: { msg_gideon: { selectedFigure: 0 } },
    });
    const { ctx } = build(game);
    const result = resolveAbility('you_have_something_i_want_gideon', ctx({}));
    assert.equal(result.requiresChoice, true);
  });
});

// ── MB-05: Calming Presence — REBEL FORCE USER gate + once/round ────────────
describe('MB-05: Calming Presence — FORCE USER gate + once per round', () => {
  function buildGame({ activatorDc, cond = ['Stun'], used = false }) {
    const yodaMsgId = 'msg_yoda';
    const actMsgId = 'msg_act';
    const actFk = `${activatorDc}-1-0`;
    const game = makeGame({
      figurePositions: { 1: { 'Yoda-1-0': 'b2', [actFk]: 'c3' }, 2: {} },
      figureConditions: { [actFk]: cond },
      dcMessageMeta: new Map([
        [yodaMsgId, { dcName: 'Yoda', displayName: 'Yoda [DG 1]', playerNum: 1 }],
        [actMsgId, { dcName: activatorDc, displayName: `${activatorDc} [DG 1]`, playerNum: 1 }],
      ]),
      // getDcList / getDcMessageIds read these.
      p1DcList: [{ dcName: 'Yoda' }, { dcName: activatorDc }],
      p1DcMessageIds: [yodaMsgId, actMsgId],
      calmingPresenceUsed: used ? { [yodaMsgId]: true } : {},
    });
    return { game, actMsgId, activatorDc };
  }

  it('enumerates a Calming Presence descriptor for a REBEL FORCE USER activator', () => {
    // Luke Skywalker is REBEL + FORCE USER.
    const { game, actMsgId } = buildGame({ activatorDc: 'Luke Skywalker' });
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Luke Skywalker', playerNum: 1, msgId: actMsgId, figureIndex: 0,
    });
    assert.ok(descriptors.some(d => d.subPromptKey === 'calming_presence'),
      'REBEL FORCE USER with a harmful condition should get the descriptor');
  });

  it('does NOT enumerate for a REBEL non-FORCE-USER activator', () => {
    // Rebel Trooper is REBEL but not a FORCE USER.
    const { game, actMsgId } = buildGame({ activatorDc: 'Rebel Trooper' });
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Rebel Trooper', playerNum: 1, msgId: actMsgId, figureIndex: 0,
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'calming_presence'),
      'non-FORCE-USER must not trigger Calming Presence');
  });

  it('does NOT enumerate when already used this round', () => {
    const { game, actMsgId } = buildGame({ activatorDc: 'Luke Skywalker', used: true });
    const descriptors = enumerateActivatorSoaDescriptors(game, {
      dcName: 'Luke Skywalker', playerNum: 1, msgId: actMsgId, figureIndex: 0,
    });
    assert.ok(!descriptors.some(d => d.subPromptKey === 'calming_presence'),
      'once-per-round flag must suppress the descriptor');
  });
});
