/**
 * PROBE-TERRO-FLAME: Captain Terro's Flamethrower behavioral oracle.
 *
 * Card text: "Choose a space within 2 and adjacent to a hostile figure.
 *  Each figure in or adjacent to that space suffers 2 Damage, 1 Strain,
 *  and becomes Weakened."
 *
 * Found gap 2026-04-21: library entry had `wiredStatus: "wired"` but no
 * structural fields (fixedAreaEffect, etc.), so the dispatch handler never
 * fired. Fix: added fixedAreaEffect / fixedAreaRange / fixedAreaDamage /
 * fixedAreaStrain / fixedAreaConditions / fixedAreaRequiresAdjacentHostile
 * to the library entry + taught the space-choice enumerator to filter by
 * "adjacent to hostile" when that flag is set.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const MAP_ID = 'anchorhead-cantina-bar';

function buildGame({ terroPos = 'a1', hostilePos = 'b1', extraFriendly = null } = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const terroMsgId = 'msg_terro';
  const trooperMsgId = 'msg_trooper';
  const friendlyMsgId = 'msg_friendly';

  dcMessageMeta.set(terroMsgId, {
    gameId: 'gtf', playerNum: 1, dcName: 'Captain Terro',
    displayName: 'Captain Terro [DG 1]',
  });
  dcMessageMeta.set(trooperMsgId, {
    gameId: 'gtf', playerNum: 2, dcName: 'Rebel Trooper',
    displayName: 'Rebel Trooper [DG 1]',
  });
  if (extraFriendly) {
    dcMessageMeta.set(friendlyMsgId, {
      gameId: 'gtf', playerNum: 1, dcName: 'Gamorrean Guard',
      displayName: 'Gamorrean Guard [DG 1]',
    });
    dcHealthState.set(friendlyMsgId, [[9, 9]]);
  }

  dcHealthState.set(terroMsgId, [[9, 9]]);
  dcHealthState.set(trooperMsgId, [[4, 4]]);

  const p1Positions = { 'Captain Terro-1-0': terroPos };
  if (extraFriendly) p1Positions['Gamorrean Guard-1-0'] = extraFriendly;

  const game = {
    gameId: 'gtf',
    player1Id: 'p1', player2Id: 'p2',
    currentRound: 1,
    figurePositions: { 1: p1Positions, 2: { 'Rebel Trooper-1-0': hostilePos } },
    figureConditions: {},
    figurePowerTokens: {},
    dcActionsData: { [terroMsgId]: { selectedFigure: 0 } },
    p1DcList: [{ dcName: 'Captain Terro' }, ...(extraFriendly ? [{ dcName: 'Gamorrean Guard' }] : [])],
    p2DcList: [{ dcName: 'Rebel Trooper' }],
    p1DcMessageIds: [terroMsgId, ...(extraFriendly ? [friendlyMsgId] : [])],
    p2DcMessageIds: [trooperMsgId],
    selectedMap: { id: MAP_ID },
  };
  const meta = dcMessageMeta.get(terroMsgId);
  return { game, dcMessageMeta, dcHealthState, terroMsgId, trooperMsgId, friendlyMsgId, meta };
}

describe('PROBE-TERRO-FLAME-001: Phase 1 enumerates adjacent-to-hostile spaces within 2', () => {
  it('returns requiresSpaceChoice with spaces that are within 2 AND adjacent to a hostile', () => {
    const { game, meta, terroMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'c1' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
    });
    assert.equal(result.requiresSpaceChoice, true, 'should offer a space choice');
    assert.ok(Array.isArray(result.validSpaces), 'validSpaces should be an array');
    assert.ok(result.validSpaces.length > 0, 'should have at least one valid space');
    // Every valid space must itself be the hostile's space OR adjacent to the hostile.
    const hostileAdj = new Set(['b1', 'b2', 'd1', 'd2', 'c1', 'c2']); // c1 + adjacency
    for (const sp of result.validSpaces) {
      assert.ok(hostileAdj.has(sp), `space ${sp} should be in or adjacent to hostile at c1`);
    }
  });

  it('returns no valid spaces when no hostile is within range+1', () => {
    const { game, meta, terroMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'j10' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
    });
    // Either requires-choice with 0 (filtered out) → manual fallback, or empty list.
    if (result.requiresSpaceChoice) {
      assert.equal(result.validSpaces.length, 0, 'no valid spaces when hostile is far');
    } else {
      assert.equal(result.applied, false, 'should fallback to manual when no valid spaces');
    }
  });
});

describe('PROBE-TERRO-FLAME-002: Phase 2 applies 2 damage + 1 strain + Weaken to each figure in area', () => {
  it('target on chosen space takes 3 HP damage and gains Weakened', () => {
    const { game, dcMessageMeta, dcHealthState, meta, terroMsgId, trooperMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'b1' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
      dcMessageMeta, dcHealthState,
      chosenSpace: 'b1',
    });
    assert.equal(result.applied, true, `should resolve: ${result.logMessage || result.manualMessage}`);
    const trooperHp = dcHealthState.get(trooperMsgId);
    assert.deepStrictEqual(trooperHp, [[1, 4]], 'trooper: 4 HP → 1 HP (2 dmg + 1 strain)');
    const conds = game.figureConditions?.['Rebel Trooper-1-0'] || [];
    assert.ok(conds.includes('Weaken'), `expected Weaken on target, got: ${JSON.stringify(conds)}`);
  });

  it('friendly figure adjacent to chosen space ALSO takes damage (no self-exclusion)', () => {
    // Card text: "each figure in or adjacent" — no friendly-only exclusion.
    const { game, dcMessageMeta, dcHealthState, meta, terroMsgId, trooperMsgId, friendlyMsgId } = buildGame({
      terroPos: 'a1', hostilePos: 'b1', extraFriendly: 'a2',
    });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
      dcMessageMeta, dcHealthState,
      chosenSpace: 'b1',
    });
    assert.equal(result.applied, true);
    const friendlyHp = dcHealthState.get(friendlyMsgId);
    assert.deepStrictEqual(friendlyHp, [[6, 9]], 'friendly adjacent: 9 HP → 6 HP');
    const conds = game.figureConditions?.['Gamorrean Guard-1-0'] || [];
    assert.ok(conds.includes('Weaken'), 'friendly also becomes Weakened');
  });
});

describe('PROBE-TERRO-FLAME-003: library-contract pinning', () => {
  it('library entry has the 6 structural fields required for dispatch', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.flamethrower_terro;
    assert.ok(entry, 'flamethrower_terro must exist in ability library');
    assert.equal(entry.type, 'dcSpecial');
    assert.equal(entry.fixedAreaEffect, true);
    assert.equal(entry.fixedAreaRange, 2);
    assert.equal(entry.fixedAreaDamage, 2);
    assert.equal(entry.fixedAreaStrain, 1);
    assert.deepStrictEqual(entry.fixedAreaConditions, ['Weaken']);
    assert.equal(entry.fixedAreaRequiresAdjacentHostile, true);
  });
});
