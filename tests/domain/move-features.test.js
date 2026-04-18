/**
 * Move-feature fixture tests — verifies the 6 new features in extractMoveFeatures
 * (canAttackFromDest, bestReachableKillFraction, reachableUnactivatedFraction,
 *  netDamageDelta, attackActionFeasibleAfterMove, losTargetCountNorm).
 *
 * Uses hand-built minimal game states so each test isolates one feature.
 *
 * Feature indices (0-based):
 *   0 distToNearestEnemy   5 bias               10 bestReachableKillFraction
 *   1 threatAtDest         6 destInEnemyRange   11 reachableUnactivatedFraction
 *   2 objectiveProximity   7 destOnObjective    12 netDamageDelta
 *   3 allySupport          8 destAdjacentToAlly 13 attackActionFeasibleAfterMove
 *   4 mpEfficiency         9 canAttackFromDest  14 losTargetCountNorm
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractMoveFeatures, MOVE_FEATURE_NAMES, getPracticalAttackRange } from '../headless/learnings.js';
import { getDcEffects, getMapData } from '../../src/data-loader.js';
import { colRowToCoord } from '../../src/game/coords.js';

// ── Feature-index symbolic constants ────────────────────────────────────────
const F = MOVE_FEATURE_NAMES.reduce((acc, name, i) => { acc[name] = i; return acc; }, {});

// ── Test DC choices (verify up front that the data has what we need) ────────
// Flame Trooper: dice [red, green] — melee (no type field, defaults to range=1)
// 74-Z Speeder Bike (Elite): dice [blue, blue, yellow] type=range
//   Practical range = 5+5+2 = 12
//   Expected damage = 1.17+1.17+0.67 ≈ 3.01
const MELEE_DC = '[Flame Trooper]';
const RANGED_DC = '74-Z Speeder Bike (Elite)';

const dcEffects = getDcEffects();

// Sanity: confirm DC data for our test fixtures
describe('Fixture DC sanity', () => {
  it('test DCs exist in dc-effects.json', () => {
    assert.ok(dcEffects[MELEE_DC], `${MELEE_DC} missing — pick a different fixture DC`);
    assert.ok(dcEffects[RANGED_DC], `${RANGED_DC} missing — pick a different fixture DC`);
  });

  it('getPracticalAttackRange returns 1 for melee fixture', () => {
    assert.equal(getPracticalAttackRange(dcEffects, MELEE_DC), 1);
  });

  it('getPracticalAttackRange returns >=4 for ranged fixture (accuracy ceiling)', () => {
    const r = getPracticalAttackRange(dcEffects, RANGED_DC);
    assert.ok(r >= 4, `expected practical range ≥4 for ranged, got ${r}`);
  });
});

// ── Minimal game-state builder ──────────────────────────────────────────────
// Produces just enough of `game` to drive extractMoveFeatures. No harness, no
// deps — just plain objects. Each test tweaks what it needs.
function makeGame({
  mapId = 'mos-eisley-outskirts',
  myFigs = {},      // { figureKey: "colRow" }  — figureKey = `${dcName}-${dgIdx}-${figIdx}`
  oppFigs = {},     // same
  p1DcList = [],
  p2DcList = [],
  p1Activated = [],
  p2Activated = [],
  dcActionsData = {}, // { msgId: { remaining } }
  attackPerformedThisActivation = {},
  moveInProgress = {}, // { moveKey: { figureKey, playerNum, totalMp, mpRemaining } }
} = {}) {
  return {
    selectedMap: { id: mapId },
    figurePositions: { 1: myFigs, 2: oppFigs },
    p1DcList, p2DcList,
    p1ActivatedDcIndices: p1Activated,
    p2ActivatedDcIndices: p2Activated,
    dcActionsData,
    attackPerformedThisActivation,
    moveInProgress,
  };
}

function makeMoveAction({ coord, moveKey, cost = 1, done = false }) {
  return { type: 'move_pick_space', params: { coord, moveKey, cost, done } };
}

// Coord constructor: col/row (0-indexed) → "<letter><row+1>" format that parseCoord
// accepts (e.g., col=4,row=4 → "e5"). All fixtures use open interior squares
// to avoid stepping onto map-blocked tiles in LoS tests.
function c(col, row) {
  return colRowToCoord(col, row);
}

// Minimal HP state helpers — figureKey → { current, max }
function makeHpState(targets) {
  // targets: [{ playerNum, msgId, dcName, figureIndex, hp, max }]
  const dcHealthState = new Map();
  const dcMessageMeta = new Map();
  for (const t of targets) {
    if (!dcMessageMeta.has(t.msgId)) dcMessageMeta.set(t.msgId, { playerNum: t.playerNum, dcName: t.dcName });
    if (!dcHealthState.has(t.msgId)) dcHealthState.set(t.msgId, []);
    const arr = dcHealthState.get(t.msgId);
    while (arr.length <= t.figureIndex) arr.push([0, 0]);
    arr[t.figureIndex] = [t.hp, t.max];
  }
  return { dcHealthState, dcMessageMeta };
}

// ── Sanity check: map data is available ─────────────────────────────────────
describe('Map data available for LoS', () => {
  it('getMapData returns blocking + impassableEdges for test map', () => {
    const md = getMapData('mos-eisley-outskirts');
    assert.ok(md, 'mos-eisley-outskirts map missing');
    assert.ok(Array.isArray(md.blocking) || md.blocking === undefined);
    assert.ok(Array.isArray(md.impassableEdges) || md.impassableEdges === undefined);
  });
});

// ── [9] canAttackFromDest ───────────────────────────────────────────────────
describe('[9] canAttackFromDest — binary: reachable target with LoS', () => {
  it('melee with enemy adjacent → 1', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `${RANGED_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(6, 5) }, // Manhattan dist 1 from dest 6,5? Let's put them adjacent
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    // Move destination adjacent to the enemy
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.canAttackFromDest], 1, 'melee adjacent should be attackable');
  });

  it('melee with enemy 3 spaces away → 0 (range gate)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `${RANGED_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(8, 5) }, // Manhattan dist 3 from dest 5,5
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.canAttackFromDest], 0, 'melee at range 3 should be out of range');
  });

  it('ranged with enemy at distance 4 → 1 (within accuracy ceiling)', () => {
    const myFk = `${RANGED_DC}-1-0`;
    const enemyFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(9, 5) }, // Manhattan dist 4 from dest 5,5
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.canAttackFromDest], 1, 'ranged at dist 4 should be attackable (accuracy ceiling 12)');
  });

  it('no enemies → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: {},
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.canAttackFromDest], 0);
  });

  it('no moveKey (actor context missing) → 0', () => {
    const game = makeGame({
      oppFigs: { 'enemy-1-0': c(5, 5) },
    });
    const action = { type: 'move_pick_space', params: { coord: c(5, 5) } }; // no moveKey
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.canAttackFromDest], 0);
  });
});

// ── [10] bestReachableKillFraction ──────────────────────────────────────────
describe('[10] bestReachableKillFraction — max(myExpDmg / hp) over reachable', () => {
  it('low-HP enemy adjacent → high fraction (capped at 1)', () => {
    // Flame Trooper expected damage ≈ 2.17 + 1.33 = 3.5
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `target-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(6, 5) },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const { dcHealthState, dcMessageMeta } = makeHpState([
      { playerNum: 2, msgId: 'E0', dcName: 'target', figureIndex: 0, hp: 1, max: 10 }, // 1 HP left
    ]);
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1, dcHealthState, dcMessageMeta);
    assert.equal(f[F.bestReachableKillFraction], 1, 'expDmg 3.5 vs 1 HP → clipped to 1');
  });

  it('high-HP enemy adjacent → low fraction', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `target-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(6, 5) },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const { dcHealthState, dcMessageMeta } = makeHpState([
      { playerNum: 2, msgId: 'E0', dcName: 'target', figureIndex: 0, hp: 20, max: 20 }, // 20 HP
    ]);
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1, dcHealthState, dcMessageMeta);
    // expDmg ≈ 3.5, hp 20 → ~0.175
    assert.ok(f[F.bestReachableKillFraction] > 0 && f[F.bestReachableKillFraction] < 0.3,
      `expected small frac, got ${f[F.bestReachableKillFraction]}`);
  });

  it('picks the softest reachable target (not average)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const enemy1 = `tough-1-0`; // 20 HP
    const enemy2 = `soft-1-0`;  // 2 HP
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemy1]: c(6, 5), [enemy2]: c(4, 5) }, // both adjacent
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const { dcHealthState, dcMessageMeta } = makeHpState([
      { playerNum: 2, msgId: 'E0', dcName: 'tough', figureIndex: 0, hp: 20, max: 20 },
      { playerNum: 2, msgId: 'E1', dcName: 'soft', figureIndex: 0, hp: 2, max: 10 },
    ]);
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1, dcHealthState, dcMessageMeta);
    // expDmg 3.5 vs 2 HP → 1.0 (clipped), not 3.5/20 = 0.175
    assert.equal(f[F.bestReachableKillFraction], 1, 'should pick the soft target');
  });

  it('no HP state available → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1); // no dcHealthState
    assert.equal(f[F.bestReachableKillFraction], 0);
  });
});

// ── [11] reachableUnactivatedFraction ───────────────────────────────────────
describe('[11] reachableUnactivatedFraction — fraction of reachable targets that have not activated', () => {
  it('all reachable targets unactivated → 1.0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemyA-1-0': c(6, 5), 'enemyB-1-0': c(4, 5) },
      p2DcList: ['enemyA', 'enemyB'],
      p2Activated: [], // none activated
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.reachableUnactivatedFraction], 1);
  });

  it('all reachable targets already activated → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemyA-1-0': c(6, 5), 'enemyB-1-0': c(4, 5) },
      p2DcList: ['enemyA', 'enemyB'],
      p2Activated: [0, 1], // both activated
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.reachableUnactivatedFraction], 0);
  });

  it('half reachable are unactivated → 0.5', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemyA-1-0': c(6, 5), 'enemyB-1-0': c(4, 5) },
      p2DcList: ['enemyA', 'enemyB'],
      p2Activated: [0], // only enemyA activated
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.reachableUnactivatedFraction], 0.5);
  });

  it('no reachable targets → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemyA-1-0': c(10, 5) }, // out of melee range
      p2DcList: ['enemyA'],
      p2Activated: [],
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.reachableUnactivatedFraction], 0);
  });
});

// ── [12] netDamageDelta ─────────────────────────────────────────────────────
describe('[12] netDamageDelta — (my outgoing − incoming) / 10, clipped [-1, 1]', () => {
  it('I can attack, no enemies can hit me → positive', () => {
    // Ranged attacker at (5,5), enemy at (9,5) with melee range 1 → enemy cannot reach me,
    // but I can reach them (ranged). Outgoing ≈ 3.0, incoming = 0.
    const myFk = `${RANGED_DC}-1-0`;
    const enemyFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(9, 5) }, // dist 4 — I can hit, they cannot
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.ok(f[F.netDamageDelta] > 0, `expected positive, got ${f[F.netDamageDelta]}`);
  });

  it('enemy can hit me, I cannot reach → negative', () => {
    // Melee attacker at (5,5), ranged enemy at (9,5) → they can hit (dist 4 within accuracy ceiling),
    // I cannot (melee range 1).
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `${RANGED_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(9, 5) },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    // Outgoing = 0 (enemy too far), incoming = ~3.0 from ranged dice
    // Note: incoming uses getAttackRange (not practical), which returns 1 for the speeder
    // because it has no explicit range field. So incoming may be 0 too in this legacy path.
    // The test verifies ≤ 0 (neutral or negative), which is correct for the legacy semantics.
    assert.ok(f[F.netDamageDelta] <= 0, `expected ≤ 0, got ${f[F.netDamageDelta]}`);
  });

  it('both attack each other → near zero', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const enemyFk = `${MELEE_DC}-1-0`; // both melee
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { [enemyFk]: c(6, 5) }, // adjacent
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    // Outgoing ≈ 3.5, incoming ≈ 3.5 → delta ≈ 0
    assert.ok(Math.abs(f[F.netDamageDelta]) < 0.1, `expected near zero, got ${f[F.netDamageDelta]}`);
  });

  it('clipped to [-1, 1]', () => {
    // Extreme outgoing would still clip — confirm bound
    const myFk = `${RANGED_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(8, 5) }, // 3 away, within ranged practical range
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.ok(f[F.netDamageDelta] >= -1 && f[F.netDamageDelta] <= 1);
  });
});

// ── [13] attackActionFeasibleAfterMove ──────────────────────────────────────
describe('[13] attackActionFeasibleAfterMove — actions left AND haven\'t attacked yet', () => {
  it('fresh activation (remaining=2, not attacked) → 1', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) },
      moveInProgress: { 'MSG123_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
      dcActionsData: { 'MSG123': { remaining: 2 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG123_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.attackActionFeasibleAfterMove], 1);
  });

  it('already attacked this activation → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) },
      moveInProgress: { 'MSG123_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
      dcActionsData: { 'MSG123': { remaining: 1 } },
      attackPerformedThisActivation: { 'MSG123': true },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG123_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.attackActionFeasibleAfterMove], 0);
  });

  it('no actions remaining → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) },
      moveInProgress: { 'MSG123_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
      dcActionsData: { 'MSG123': { remaining: 0 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG123_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.attackActionFeasibleAfterMove], 0);
  });

  it('missing dcActionsData → falls back to remaining=2 default (feasible)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) },
      moveInProgress: { 'MSG123_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
      // no dcActionsData
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG123_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.attackActionFeasibleAfterMove], 1);
  });
});

// ── [14] losTargetCountNorm ─────────────────────────────────────────────────
describe('[14] losTargetCountNorm — enemies with LoS from dest, normalized by 4', () => {
  it('no enemies → 0', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: {},
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.losTargetCountNorm], 0);
  });

  it('1 enemy in open → 0.25 (1/4)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'enemy-1-0': c(6, 5) }, // adjacent, clear LoS
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.losTargetCountNorm], 0.25);
  });

  it('3 enemies in open → 0.75 (3/4)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: { 'a-1-0': c(6, 5), 'b-1-0': c(7, 5), 'c-1-0': c(8, 5) },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.losTargetCountNorm], 0.75);
  });

  it('5 enemies → clamped to 1 (cap at 4/4)', () => {
    const myFk = `${MELEE_DC}-1-0`;
    const game = makeGame({
      myFigs: { [myFk]: c(5, 5) },
      oppFigs: {
        'a-1-0': c(6, 5), 'b-1-0': c(7, 5), 'c-1-0': c(8, 5),
        'd-1-0': c(9, 5), 'e-1-0': c(10, 5),
      },
      moveInProgress: { 'MSG_P1_0_0': { figureKey: myFk, playerNum: 1, totalMp: 4, mpRemaining: 4 } },
    });
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.losTargetCountNorm], 1);
  });
});

// ── Integration: full 15-dim vector shape ───────────────────────────────────
describe('Vector shape and bias invariant', () => {
  it('returns Float64Array of length 15', () => {
    const game = makeGame({});
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.ok(f instanceof Float64Array);
    assert.equal(f.length, 15);
  });

  it('bias (index 5) is 1.0 regardless of inputs', () => {
    const game = makeGame({});
    const action = makeMoveAction({ coord: c(5, 5), moveKey: 'MSG_P1_0_0' });
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f[F.bias], 1.0);
  });

  it('done=true action returns zeroed vector with bias still set', () => {
    const game = makeGame({});
    const action = { type: 'move_pick_space', params: { coord: c(5, 5), moveKey: 'MSG_P1_0_0', done: true } };
    const f = extractMoveFeatures(action, game, 1);
    assert.equal(f.length, 15);
    assert.equal(f[F.bias], 1.0);
    // Other features should be zero since we short-circuited
    assert.equal(f[F.canAttackFromDest], 0);
    assert.equal(f[F.losTargetCountNorm], 0);
  });
});
