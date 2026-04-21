/**
 * PROBE-R2D2-SERVICE: R2-D2's Service ability behavioral oracle.
 *
 * Card text: "Special Action (Service): You or an adjacent friendly DROID
 *  or VEHICLE recovers 1 Damage."
 *
 * Found gap 2026-04-21 via scripts/library-stub-audit.mjs: library entry
 * had `wiredStatus: "wired"` but no structural fields and no src/ code
 * references, so invoking the ability returned "Resolve manually".
 * Fix: added `recoverSelfOrAdjacentFriendly: 1` +
 * `recoverSelfOrAdjacentTraitFilter: ['DROID','VEHICLE']` + new dispatch
 * branch in src/game/abilities.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const MAP_ID = 'anchorhead-cantina-bar';

function buildGame({
  r2Pos = 'a1',
  adjFriendly = null,     // { dcName, pos, healthCurrent, healthMax }
  farFriendly = null,
} = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const r2MsgId = 'msg_r2';
  const adjMsgId = 'msg_adj';
  const farMsgId = 'msg_far';

  dcMessageMeta.set(r2MsgId, {
    gameId: 'gsv', playerNum: 1, dcName: 'R2-D2',
    displayName: 'R2-D2 [DG 1]',
  });
  // R2-D2 starts at 4/6 so we can observe the heal.
  dcHealthState.set(r2MsgId, [[4, 6]]);

  const p1Positions = { 'R2-D2-1-0': r2Pos };
  const p1DcList = [{ dcName: 'R2-D2' }];
  const p1DcMessageIds = [r2MsgId];

  if (adjFriendly) {
    dcMessageMeta.set(adjMsgId, {
      gameId: 'gsv', playerNum: 1, dcName: adjFriendly.dcName,
      displayName: `${adjFriendly.dcName} [DG 1]`,
    });
    dcHealthState.set(adjMsgId, [[adjFriendly.healthCurrent, adjFriendly.healthMax]]);
    p1Positions[`${adjFriendly.dcName}-1-0`] = adjFriendly.pos;
    p1DcList.push({ dcName: adjFriendly.dcName });
    p1DcMessageIds.push(adjMsgId);
  }
  if (farFriendly) {
    dcMessageMeta.set(farMsgId, {
      gameId: 'gsv', playerNum: 1, dcName: farFriendly.dcName,
      displayName: `${farFriendly.dcName} [DG 1]`,
    });
    dcHealthState.set(farMsgId, [[farFriendly.healthCurrent, farFriendly.healthMax]]);
    p1Positions[`${farFriendly.dcName}-1-0`] = farFriendly.pos;
    p1DcList.push({ dcName: farFriendly.dcName });
    p1DcMessageIds.push(farMsgId);
  }

  const game = {
    gameId: 'gsv',
    player1Id: 'p1', player2Id: 'p2',
    currentRound: 1,
    figurePositions: { 1: p1Positions, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    dcActionsData: { [r2MsgId]: { selectedFigure: 0, actionsUsed: [] } },
    p1DcList,
    p2DcList: [],
    p1DcMessageIds,
    p2DcMessageIds: [],
    selectedMap: { id: MAP_ID },
  };
  const meta = dcMessageMeta.get(r2MsgId);
  return { game, dcMessageMeta, dcHealthState, r2MsgId, adjMsgId, farMsgId, meta };
}

describe('PROBE-R2D2-SERVICE-001: self-heal path (no eligible adjacent)', () => {
  it('with no adjacents, applies 1 HP heal to R2-D2 directly', () => {
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({ r2Pos: 'a1' });
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
    });
    assert.equal(result.applied, true, `applied: ${result.logMessage || result.manualMessage}`);
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[5, 6]], 'R2 self-heal 4→5');
  });

  it('at full health, still applies (heals 0) and does not crash', () => {
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({ r2Pos: 'a1' });
    dcHealthState.set(r2MsgId, [[6, 6]]);
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
    });
    assert.equal(result.applied, true);
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[6, 6]], 'no change at full HP');
  });
});

describe('PROBE-R2D2-SERVICE-002: trait filter — adjacent non-DROID/VEHICLE is ineligible', () => {
  it('adjacent human (Rebel Trooper, no DROID/VEHICLE) — falls through to self-heal', () => {
    // Rebel Trooper has no DROID or VEHICLE keyword, so the adjacent-target
    // list is empty and the handler heals self without asking.
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({
      r2Pos: 'a1',
      adjFriendly: { dcName: 'Rebel Trooper', pos: 'b1', healthCurrent: 1, healthMax: 4 },
    });
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
    });
    assert.equal(result.applied, true, `applied: ${result.logMessage || result.manualMessage}`);
    // Rebel Trooper NOT healed.
    assert.deepStrictEqual(
      dcHealthState.get('msg_adj'), [[1, 4]], 'trooper untouched (ineligible trait)');
    // R2 healed instead.
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[5, 6]], 'self-heal fallback 4→5');
  });
});

describe('PROBE-R2D2-SERVICE-003: adjacent eligible DROID triggers a choice', () => {
  it('adjacent IG-88 (DROID) injured → presents self-vs-adj choice', () => {
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({
      r2Pos: 'a1',
      adjFriendly: { dcName: 'IG-88', pos: 'b1', healthCurrent: 5, healthMax: 12 },
    });
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
    });
    assert.equal(result.requiresChoice, true, 'should prompt for choice');
    assert.ok(Array.isArray(result.choiceOptions) && result.choiceOptions.length === 2);
    assert.deepStrictEqual(result.targetFigureKeys, ['self', 'IG-88-1-0']);
    // No heal applied during choice phase.
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[4, 6]], 'R2 unchanged in phase 1');
    assert.deepStrictEqual(dcHealthState.get('msg_adj'), [[5, 12]], 'IG-88 unchanged in phase 1');
  });

  it('phase 2: choosing adjacent DROID heals 1 HP to that figure', () => {
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({
      r2Pos: 'a1',
      adjFriendly: { dcName: 'IG-88', pos: 'b1', healthCurrent: 5, healthMax: 12 },
    });
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
      targetFigureKey: 'IG-88-1-0',
    });
    assert.equal(result.applied, true, `applied: ${result.logMessage || result.manualMessage}`);
    assert.deepStrictEqual(dcHealthState.get('msg_adj'), [[6, 12]], 'IG-88 5→6');
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[4, 6]], 'R2 unchanged');
  });
});

describe('PROBE-R2D2-SERVICE-004: far friendly DROID is out of range', () => {
  it('DROID 3 spaces away is not offered as a heal target', () => {
    const { game, meta, dcMessageMeta, dcHealthState, r2MsgId } = buildGame({
      r2Pos: 'a1',
      farFriendly: { dcName: 'IG-88', pos: 'd1', healthCurrent: 5, healthMax: 12 },
    });
    const result = resolveAbility('service_r2d2', {
      game, playerNum: 1, meta, msgId: r2MsgId,
      dcMessageMeta, dcHealthState,
    });
    // No adjacent → self-heal fallback, no choice.
    assert.equal(result.applied, true);
    assert.equal(result.requiresChoice, undefined);
    assert.deepStrictEqual(dcHealthState.get(r2MsgId), [[5, 6]], 'R2 self-heal 4→5');
    assert.deepStrictEqual(dcHealthState.get('msg_far'), [[5, 12]], 'far IG-88 untouched');
  });
});

describe('PROBE-R2D2-SERVICE-005: library-contract pinning', () => {
  it('library entry has the structural fields required for dispatch', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.service_r2d2;
    assert.ok(entry, 'service_r2d2 must exist in ability library');
    assert.equal(entry.type, 'dcSpecial');
    assert.equal(entry.wiredStatus, 'wired');
    assert.equal(entry.recoverSelfOrAdjacentFriendly, 1);
    assert.deepStrictEqual(entry.recoverSelfOrAdjacentTraitFilter, ['DROID', 'VEHICLE']);
  });
});
