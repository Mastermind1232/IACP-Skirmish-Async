/**
 * PROBE-TERRO-FLAME: Captain Terro's Flamethrower behavioral oracle.
 *
 * Card text (CSV row 174): "Choose a space within 2 spaces. Each OTHER figure
 *  on or adjacent to that space suffers 1 Damage and 1 Strain, then becomes
 *  Weakened." (alexanbv 2026-06-20: corrected from the prior 2-Damage /
 *  adjacent-to-hostile-required implementation — the card has neither.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { applyDeferredAbilityEffects } from '../../../src/game/damage-pipeline.js';

const MAP_ID = 'unit-test-grid';

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

describe('PROBE-TERRO-FLAME-001: Phase 1 enumerates spaces within 2 (no adjacent-to-hostile requirement)', () => {
  it('returns requiresSpaceChoice with spaces within 2 of Terro', () => {
    const { game, meta, terroMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'c1' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
    });
    assert.equal(result.requiresSpaceChoice, true, 'should offer a space choice');
    assert.ok(Array.isArray(result.validSpaces), 'validSpaces should be an array');
    assert.ok(result.validSpaces.length > 0, 'should have at least one valid space');
  });

  it('offers valid spaces even when no hostile is nearby (no adjacency constraint)', () => {
    const { game, meta, terroMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'j10' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
    });
    // The card has no "adjacent to a hostile" constraint, so spaces within 2 of
    // Terro are valid regardless of hostile proximity.
    assert.equal(result.requiresSpaceChoice, true);
    assert.ok(result.validSpaces.length > 0, 'spaces within 2 of Terro are valid even with no hostile nearby');
  });
});

describe('PROBE-TERRO-FLAME-002: Phase 2 applies 1 damage synchronously, queues 1 strain via pendingStrain, Weaken to each figure in area', () => {
  it('target on chosen space takes 1 damage via the pipeline, gains Weakened, has strain queued', async () => {
    const { game, dcMessageMeta, dcHealthState, meta, terroMsgId, trooperMsgId } = buildGame({ terroPos: 'a1', hostilePos: 'b1' });
    const result = resolveAbility('flamethrower_terro', {
      game, playerNum: 1, meta, msgId: terroMsgId,
      dcMessageMeta, dcHealthState,
      chosenSpace: 'b1',
    });
    assert.equal(result.applied, true, `should resolve: ${result.logMessage || result.manualMessage}`);
    await applyDeferredAbilityEffects(game, { dcHealthState });
    const trooperHp = dcHealthState.get(trooperMsgId);
    assert.deepStrictEqual(trooperHp, [[3, 4]], 'trooper: 4 HP → 3 HP (1 damage; strain via pipeline)');
    const conds = game.figureConditions?.['Rebel Trooper-1-0'] || [];
    assert.ok(conds.includes('Weaken'), `expected Weaken on target, got: ${JSON.stringify(conds)}`);
    assert.ok(Array.isArray(result.pendingStrain), 'pendingStrain queued');
    const trooperStrain = result.pendingStrain.find((s) => s.figureKey === 'Rebel Trooper-1-0');
    assert.ok(trooperStrain, 'trooper strain entry queued');
    assert.equal(trooperStrain.amount, 1);
  });

  it('friendly figure adjacent to chosen space ALSO takes damage (no self-exclusion)', async () => {
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
    await applyDeferredAbilityEffects(game, { dcHealthState });
    const friendlyHp = dcHealthState.get(friendlyMsgId);
    assert.deepStrictEqual(friendlyHp, [[8, 9]], 'friendly adjacent: 9 HP → 8 HP (1 damage; strain via pipeline)');
    const conds = game.figureConditions?.['Gamorrean Guard-1-0'] || [];
    assert.ok(conds.includes('Weaken'), 'friendly also becomes Weakened');
    assert.ok(Array.isArray(result.pendingStrain), 'pendingStrain queued');
    const friendlyStrain = result.pendingStrain.find((s) => s.figureKey === 'Gamorrean Guard-1-0');
    assert.ok(friendlyStrain, 'friendly strain entry queued');
  });
});

describe('PROBE-TERRO-FLAME-003: library-contract pinning', () => {
  it('library entry has the corrected structural fields (1 damage, no adjacency requirement)', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.flamethrower_terro;
    assert.ok(entry, 'flamethrower_terro must exist in ability library');
    assert.equal(entry.type, 'dcSpecial');
    assert.equal(entry.fixedAreaEffect, true);
    assert.equal(entry.fixedAreaRange, 2);
    assert.equal(entry.fixedAreaDamage, 1);
    assert.equal(entry.fixedAreaStrain, 1);
    assert.deepStrictEqual(entry.fixedAreaConditions, ['Weaken']);
    assert.equal(entry.fixedAreaRequiresAdjacentHostile, undefined, 'no adjacent-to-hostile requirement on the card');
  });
});
