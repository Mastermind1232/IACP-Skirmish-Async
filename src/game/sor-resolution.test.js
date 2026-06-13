import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startSorResolution } from './sor-resolution.js';
import { currentBin } from './round-trigger-orchestrator.js';

const EFF = {
  'Ezra Bridger': { specialAbilityIds: ['brash_ezra'] },
  'Cal Kestis': { specialAbilityIds: ['force_slow_cal'] },
};
const deps = { getDcEffects: () => EFF };

describe('startSorResolution', () => {
  it('starts a SoR resolution with mission bin first, then init player', () => {
    const game = {
      player1Id: 'p1', player2Id: 'p2', initiativePlayerId: 'p2', // init = player 2
      p1DcList: [{ dcName: 'Ezra Bridger' }],
      p1DcMessageIds: ['m-ezra'],
      p2DcList: [{ dcName: 'Cal Kestis' }],
      p2DcMessageIds: ['m-cal'],
    };
    const started = startSorResolution(game, { missionDescriptors: [{ id: 'sor-mission' }], deps });
    assert.strictEqual(started, true);
    assert.strictEqual(game.pendingRoundTrigger.phase, 'SoR');
    // mission bin resolves first
    assert.strictEqual(currentBin(game).bin, 'mission');
    // init player is 2 -> Cal (force_slow) is in the init bin, Ezra in non-init
    const buckets = game.pendingRoundTrigger.buckets;
    assert.deepStrictEqual(buckets[1].descriptors.map((d) => d.abilityId), ['force_slow_cal']);
    assert.deepStrictEqual(buckets[2].descriptors.map((d) => d.abilityId), ['brash_ezra']);
  });

  it('returns false when there are no SoR triggers', () => {
    const game = { initiativePlayerNum: 1, p1DcList: [], p1DcMessageIds: [], p2DcList: [], p2DcMessageIds: [] };
    assert.strictEqual(startSorResolution(game, { deps }), false);
    assert.strictEqual(game.pendingRoundTrigger, undefined);
  });
});
