import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupActivation,
  cleanupRoundStart,
  ACTIVATION_MSGID_FLAGS,
  ACTIVATION_FIGKEY_FLAGS,
  ACTIVATION_PLAYERNUM_FLAGS,
  ACTIVATION_SCALAR_FLAGS,
  ROUND_OBJECT_FLAGS,
  ROUND_NULL_FLAGS,
  ROUND_ARRAY_FLAGS,
  ROUND_FALSE_FLAGS,
  ROUND_DELETE_FLAGS,
} from './activation-state.js';

describe('cleanupActivation', () => {
  it('deletes msgId-keyed entries', () => {
    const game = {};
    for (const key of ACTIVATION_MSGID_FLAGS) {
      game[key] = { msg123: 'val', msg456: 'other' };
    }
    cleanupActivation(game, 'msg123', 1, []);
    for (const key of ACTIVATION_MSGID_FLAGS) {
      assert.strictEqual(game[key].msg123, undefined, `${key} should have msg123 deleted`);
      assert.strictEqual(game[key].msg456, 'other', `${key} should preserve msg456`);
    }
  });

  it('deletes figureKey entries for all provided figureKeys', () => {
    const game = {};
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      game[key] = { 'Trooper-0-0': 'a', 'Trooper-0-1': 'b', 'Other-0-0': 'c' };
    }
    cleanupActivation(game, 'msg1', 1, ['Trooper-0-0', 'Trooper-0-1']);
    for (const key of ACTIVATION_FIGKEY_FLAGS) {
      assert.strictEqual(game[key]['Trooper-0-0'], undefined, `${key}[Trooper-0-0] deleted`);
      assert.strictEqual(game[key]['Trooper-0-1'], undefined, `${key}[Trooper-0-1] deleted`);
      assert.strictEqual(game[key]['Other-0-0'], 'c', `${key}[Other-0-0] preserved`);
    }
  });

  it('deletes playerNum-keyed entries', () => {
    const game = {};
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      game[key] = { 1: 'val', 2: 'other' };
    }
    cleanupActivation(game, 'msg1', 1, []);
    for (const key of ACTIVATION_PLAYERNUM_FLAGS) {
      assert.strictEqual(game[key][1], undefined, `${key}[1] deleted`);
      assert.strictEqual(game[key][2], 'other', `${key}[2] preserved`);
    }
  });

  it('deletes scalar flags', () => {
    const game = { commsJammerActivePlayerNum: 1, partingShotTriggered: true };
    cleanupActivation(game, 'msg1', 1, []);
    assert.strictEqual(game.commsJammerActivePlayerNum, undefined);
    assert.strictEqual(game.partingShotTriggered, undefined);
  });

  it('tolerates missing game properties', () => {
    const game = {};
    assert.doesNotThrow(() => cleanupActivation(game, 'msg1', 1, ['Trooper-0-0']));
  });

  it('preserves unrelated game properties', () => {
    const game = { currentRound: 3, player1Id: 'abc', figureConditions: { 'X-0-0': ['Stun'] } };
    cleanupActivation(game, 'msg1', 1, []);
    assert.strictEqual(game.currentRound, 3);
    assert.strictEqual(game.player1Id, 'abc');
    assert.deepStrictEqual(game.figureConditions, { 'X-0-0': ['Stun'] });
  });
});

describe('cleanupRoundStart', () => {
  it('resets object flags to empty objects', () => {
    const game = {};
    for (const key of ROUND_OBJECT_FLAGS) {
      game[key] = { foo: 'bar' };
    }
    cleanupRoundStart(game);
    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepStrictEqual(game[key], {}, `${key} should be {}`);
    }
  });

  it('resets null flags to null', () => {
    const game = {};
    for (const key of ROUND_NULL_FLAGS) {
      game[key] = 'something';
    }
    cleanupRoundStart(game);
    for (const key of ROUND_NULL_FLAGS) {
      assert.strictEqual(game[key], null, `${key} should be null`);
    }
  });

  it('resets array flags to empty arrays', () => {
    const game = {};
    for (const key of ROUND_ARRAY_FLAGS) {
      game[key] = ['a', 'b'];
    }
    cleanupRoundStart(game);
    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepStrictEqual(game[key], [], `${key} should be []`);
    }
  });

  it('resets false flags to false', () => {
    const game = {};
    for (const key of ROUND_FALSE_FLAGS) {
      game[key] = true;
    }
    cleanupRoundStart(game);
    for (const key of ROUND_FALSE_FLAGS) {
      assert.strictEqual(game[key], false, `${key} should be false`);
    }
  });

  it('deletes delete flags', () => {
    const game = { commsJammerActivePlayerNum: 1, partingShotTriggered: true };
    cleanupRoundStart(game);
    assert.ok(!('commsJammerActivePlayerNum' in game));
    assert.ok(!('partingShotTriggered' in game));
  });

  it('fixes priceBounties leak (resets to {} not preserved)', () => {
    const game = { priceBounties: { 'IG-88': { amount: 4, playerNum: 1 } } };
    cleanupRoundStart(game);
    assert.deepStrictEqual(game.priceBounties, {});
  });

  it('preserves non-round game state', () => {
    const game = { currentRound: 3, player1Id: 'abc', p1DcList: [{ dcName: 'Trooper' }] };
    cleanupRoundStart(game);
    assert.strictEqual(game.currentRound, 3);
    assert.strictEqual(game.player1Id, 'abc');
    assert.deepStrictEqual(game.p1DcList, [{ dcName: 'Trooper' }]);
  });
});

describe('flag list completeness', () => {
  it('no duplicate flags across activation lists', () => {
    const all = [...ACTIVATION_MSGID_FLAGS, ...ACTIVATION_FIGKEY_FLAGS, ...ACTIVATION_PLAYERNUM_FLAGS, ...ACTIVATION_SCALAR_FLAGS];
    const unique = new Set(all);
    assert.strictEqual(all.length, unique.size, 'Duplicate flags in activation lists');
  });

  it('no duplicate flags across round lists', () => {
    const all = [...ROUND_OBJECT_FLAGS, ...ROUND_NULL_FLAGS, ...ROUND_ARRAY_FLAGS, ...ROUND_FALSE_FLAGS, ...ROUND_DELETE_FLAGS];
    const unique = new Set(all);
    assert.strictEqual(all.length, unique.size, 'Duplicate flags in round lists');
  });

  it('all game-state.js round-scoped container keys appear in round cleanup lists', () => {
    // These 10 keys are the "Round-scoped containers" from ensureGameShape (game-state.js:166-170).
    // If a key is added there, it MUST also appear in a ROUND_*_FLAGS list or it will leak across rounds.
    const ROUND_SCOPED_CONTAINERS = [
      'roundFigureAbilityUsed', 'roundAttackRerollDice', 'roundAttackSurgeBonus',
      'roundDefenseBonusBlock', 'roundDefenseBonusEvade', 'roundDefenderBonusBlockPerEvade',
      'roundEfficientTravel', 'roundProgrammingOverrideTrait',
      'roundTrooperAttackHitBonus', 'roundVehicleSpeedBonus', 'roundTrooperSurgeStun',
    ];
    const allRoundFlags = new Set([
      ...ROUND_OBJECT_FLAGS, ...ROUND_NULL_FLAGS, ...ROUND_ARRAY_FLAGS,
      ...ROUND_FALSE_FLAGS, ...ROUND_DELETE_FLAGS,
    ]);
    const missing = ROUND_SCOPED_CONTAINERS.filter(k => !allRoundFlags.has(k));
    assert.deepStrictEqual(missing, [],
      `Round-scoped containers missing from cleanup lists: ${missing.join(', ')}`);
  });

  it('cleanupRoundStart resets every round-list key to its default', () => {
    const game = {};
    // Pollute every round-list key with a non-default value
    for (const key of ROUND_OBJECT_FLAGS) game[key] = { leaked: true };
    for (const key of ROUND_NULL_FLAGS) game[key] = 'leaked';
    for (const key of ROUND_ARRAY_FLAGS) game[key] = ['leaked'];
    for (const key of ROUND_FALSE_FLAGS) game[key] = true;
    for (const key of ROUND_DELETE_FLAGS) game[key] = 'leaked';
    // Also add a non-round key to verify it's preserved
    game.currentRound = 5;
    game.player1Id = 'test-player';

    cleanupRoundStart(game);

    // Verify every round key is reset
    for (const key of ROUND_OBJECT_FLAGS) {
      assert.deepStrictEqual(game[key], {}, `${key} should be {} after cleanup`);
    }
    for (const key of ROUND_NULL_FLAGS) {
      assert.strictEqual(game[key], null, `${key} should be null after cleanup`);
    }
    for (const key of ROUND_ARRAY_FLAGS) {
      assert.deepStrictEqual(game[key], [], `${key} should be [] after cleanup`);
    }
    for (const key of ROUND_FALSE_FLAGS) {
      assert.strictEqual(game[key], false, `${key} should be false after cleanup`);
    }
    for (const key of ROUND_DELETE_FLAGS) {
      assert.ok(!(key in game), `${key} should be deleted after cleanup`);
    }
    // Non-round state preserved
    assert.strictEqual(game.currentRound, 5);
    assert.strictEqual(game.player1Id, 'test-player');
  });
});
