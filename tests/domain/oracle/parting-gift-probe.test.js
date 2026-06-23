/**
 * PROBE-SABINE-PARTING-GIFT: Sabine Wren's Parting Gift behavioral oracle.
 *
 * CSV (Sabine Wren / Parting Gift): "Choose a space within 3 spaces and roll 1
 * green die; each other figure and object on or adjacent to that space suffers
 * Damage equal to the Damage results." once per activation.
 *
 * The resolver lives on the spaceWithin / rollOneDie / affectsObjects path in
 * abilities.js. Reachability: Sabine's dc-effects entry declares
 * specialAbilityIds=['evasive_maneuver','parting_gift']; getDcStats() derives the
 * Special-Action `specials` list (and the dc_special_ button) from those ids
 * (data-loader.js), so the button is generated and dispatch maps specialIdx 1 →
 * 'parting_gift'. Once-per-activation is enforced by the special-action framework
 * (specialsUsedByFig in dc-play-area.js), NOT by a resolver-internal gate (such a
 * gate would wrongly block the two-phase space-pick re-entry).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { drainPendingDamage } from '../../../src/game/damage-pipeline.js';
import { getDcStats } from '../../../src/data-loader.js';

const MAP_ID = 'anchorhead-cantina-bar';

function buildGame({ sabinePos = 'a1', hostilePos = 'b1' } = {}) {
  const dcMessageMeta = new Map();
  const dcHealthState = new Map();
  const sabineMsgId = 'msg_sabine';
  const trooperMsgId = 'msg_trooper';
  dcMessageMeta.set(sabineMsgId, {
    gameId: 'gpg', playerNum: 1, dcName: 'Sabine Wren',
    displayName: 'Sabine Wren [DG 1]',
  });
  dcMessageMeta.set(trooperMsgId, {
    gameId: 'gpg', playerNum: 2, dcName: 'Rebel Trooper',
    displayName: 'Rebel Trooper [DG 1]',
  });
  dcHealthState.set(sabineMsgId, [[11, 11]]);
  dcHealthState.set(trooperMsgId, [[4, 4]]);
  const game = {
    gameId: 'gpg',
    player1Id: 'p1', player2Id: 'p2',
    currentRound: 1,
    figurePositions: { 1: { 'Sabine Wren-1-0': sabinePos }, 2: { 'Rebel Trooper-1-0': hostilePos } },
    figureConditions: {},
    figurePowerTokens: {},
    dcActionsData: { [sabineMsgId]: { selectedFigure: 0 } },
    p1DcList: [{ dcName: 'Sabine Wren' }],
    p2DcList: [{ dcName: 'Rebel Trooper' }],
    p1DcMessageIds: [sabineMsgId],
    p2DcMessageIds: [trooperMsgId],
    selectedMap: { id: MAP_ID },
  };
  const meta = dcMessageMeta.get(sabineMsgId);
  return { game, dcMessageMeta, dcHealthState, sabineMsgId, trooperMsgId, meta };
}

describe('PROBE-SABINE-PARTING-GIFT-000: button reachability', () => {
  it("Sabine's Special-Action list includes Parting Gift mapped to the parting_gift id", () => {
    const s = getDcStats('Sabine Wren');
    const idx = (s.specialIds || []).indexOf('parting_gift');
    assert.ok(idx >= 0, 'parting_gift must be in derived specialIds (so a dc_special_ button is generated)');
    assert.ok((s.specials || [])[idx], 'a special-action label must exist at the same index');
  });
});

describe('PROBE-SABINE-PARTING-GIFT-001: Phase 1 enumerates spaces within 3', () => {
  it('returns requiresSpaceChoice with spaces within 3 of Sabine', () => {
    const { game, meta, sabineMsgId, dcMessageMeta } = buildGame({ sabinePos: 'a1', hostilePos: 'c1' });
    const result = resolveAbility('parting_gift', {
      game, playerNum: 1, meta, msgId: sabineMsgId, dcMessageMeta,
    });
    assert.equal(result.requiresSpaceChoice, true, 'should offer a space choice');
    assert.ok(Array.isArray(result.validSpaces) && result.validSpaces.length > 0, 'should have valid spaces');
  });
});

describe('PROBE-SABINE-PARTING-GIFT-002: Phase 2 rolls green die + applies Damage to figures (other-exclusion) and objects', () => {
  it('hostile on chosen space takes the rolled green-die Damage', async () => {
    const orig = Math.random;
    Math.random = () => 0.9; // green face index 5 → dmg 2
    try {
      const { game, dcMessageMeta, dcHealthState, meta, sabineMsgId, trooperMsgId } = buildGame({ sabinePos: 'a1', hostilePos: 'b1' });
      const result = resolveAbility('parting_gift', {
        game, playerNum: 1, meta, msgId: sabineMsgId, dcMessageMeta, dcHealthState,
        chosenSpace: 'b1',
      });
      assert.equal(result.applied, true, `should resolve: ${result.logMessage || result.manualMessage}`);
      await drainPendingDamage(game, { dcHealthState });
      assert.deepStrictEqual(dcHealthState.get(trooperMsgId), [[2, 4]], 'trooper: 4 HP → 2 HP (2 Damage rolled)');
    } finally {
      Math.random = orig;
    }
  });

  it('source (Sabine) is excluded — "each OTHER figure"', () => {
    const orig = Math.random;
    Math.random = () => 0.9; // dmg 2
    try {
      // Place Sabine adjacent to the chosen space so she would be in the blast if not excluded.
      const { game, dcMessageMeta, dcHealthState, meta, sabineMsgId } = buildGame({ sabinePos: 'a1', hostilePos: 'j10' });
      resolveAbility('parting_gift', {
        game, playerNum: 1, meta, msgId: sabineMsgId, dcMessageMeta, dcHealthState,
        chosenSpace: 'a1', // Sabine's own space
      });
      assert.deepStrictEqual(dcHealthState.get(sabineMsgId), [[11, 11]], 'Sabine takes no self-damage (excluded)');
    } finally {
      Math.random = orig;
    }
  });

  it('objects on or adjacent to the chosen space also take damage (affectsObjects)', () => {
    const orig = Math.random;
    Math.random = () => 0.9; // dmg 2
    try {
      const { game, dcMessageMeta, dcHealthState, meta, sabineMsgId } = buildGame({ sabinePos: 'a1', hostilePos: 'j10' });
      game.objectPositions = { crate1: 'b1' };
      game.objectHealth = { crate1: [3, 3] };
      game.objectMeta = { crate1: { name: 'Crate' } };
      const result = resolveAbility('parting_gift', {
        game, playerNum: 1, meta, msgId: sabineMsgId, dcMessageMeta, dcHealthState,
        chosenSpace: 'b1',
      });
      assert.equal(result.applied, true);
      assert.deepStrictEqual(game.objectHealth.crate1, [1, 3], 'crate: 3 HP → 1 HP (2 Damage)');
    } finally {
      Math.random = orig;
    }
  });
});

describe('PROBE-SABINE-PARTING-GIFT-003: library-contract pinning', () => {
  it('library entry has the rollOneDie / spaceWithin / affectsObjects structure', async () => {
    const { readFile } = await import('node:fs/promises');
    const lib = JSON.parse(await readFile(new URL('../../../data/ability-library.json', import.meta.url), 'utf8'));
    const entry = lib.abilities?.parting_gift;
    assert.ok(entry, 'parting_gift must exist');
    assert.equal(entry.type, 'dcSpecial');
    assert.equal(entry.rollOneDie, 'green');
    assert.equal(entry.rollOneDieTarget, 'spaceWithin');
    assert.equal(entry.rollOneDieRange, 3);
    assert.equal(entry.affectsObjects, true);
    assert.equal(entry.oncePer, 'activation');
  });
});
