import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateSorDescriptors } from './sor-enumerator.js';

const EFF = {
  'Ezra Bridger': { specialAbilityIds: ['brash_ezra'] },
  'Cal Kestis': { specialAbilityIds: ['force_slow_cal'] },
  'Stormtrooper': { specialAbilityIds: ['nothing_here'] },
};
const deps = { getDcEffects: () => EFF };

describe('enumerateSorDescriptors', () => {
  it('produces one descriptor per matching SoR ability, owner-tagged', () => {
    const game = {
      p1DcList: [{ dcName: 'Ezra Bridger' }, { dcName: 'Stormtrooper' }],
      p1DcMessageIds: ['m-ezra', 'm-storm'],
      p2DcList: [{ dcName: 'Cal Kestis' }],
      p2DcMessageIds: ['m-cal'],
    };
    const descs = enumerateSorDescriptors(game, deps);
    assert.strictEqual(descs.length, 2);
    const ezra = descs.find((d) => d.abilityId === 'brash_ezra');
    assert.ok(ezra);
    assert.strictEqual(ezra.ownerPlayerNum, 1);
    assert.strictEqual(ezra.sourceMsgId, 'm-ezra');
    assert.strictEqual(ezra.id, 'sor:brash_ezra:m-ezra');
    const cal = descs.find((d) => d.abilityId === 'force_slow_cal');
    assert.strictEqual(cal.ownerPlayerNum, 2);
    assert.ok(!descs.some((d) => d.extras.dcName === 'Stormtrooper'));
  });

  it('skips defeated DCs', () => {
    const game = {
      p1DcList: [{ dcName: 'Ezra Bridger', defeated: true }],
      p1DcMessageIds: ['m-ezra'],
      p2DcList: [], p2DcMessageIds: [],
    };
    assert.deepStrictEqual(enumerateSorDescriptors(game, deps), []);
  });

  it('returns empty for no game', () => {
    assert.deepStrictEqual(enumerateSorDescriptors(null, deps), []);
  });
});
