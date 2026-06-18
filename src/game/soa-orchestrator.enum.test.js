import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateActivatorSoaDescriptors } from './soa-orchestrator.js';

// Uses real card data (data/dc-effects.json) via getDcEffects().

function activatorGame(dcName, { opponentDcs = [] } = {}) {
  const msgId = 'mAct';
  const game = {
    dcMessageMeta: new Map([[msgId, { displayName: `${dcName} [DG 1]`, gameId: 'g', playerNum: 1, dcName }]]),
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [`${dcName}-1-0`]: 'a1' }, 2: {} },
  };
  // Attach opponent DCs (for opponent-trigger descriptors like Chirrut).
  game.p2DcList = [];
  game.p2DcMessageIds = [];
  opponentDcs.forEach((odc, i) => {
    const omsg = `mOpp${i}`;
    game.p2DcList.push({ dcName: odc, displayName: `${odc} [DG 1]` });
    game.p2DcMessageIds.push(omsg);
    game.dcMessageMeta.set(omsg, { displayName: `${odc} [DG 1]`, gameId: 'g', playerNum: 2, dcName: odc });
    game.figurePositions[2][`${odc}-1-0`] = 'b2';
  });
  return { game, opts: { dcName, playerNum: 1, msgId } };
}

describe('enumerateActivatorSoaDescriptors — Mounted covers every Mounted figure', () => {
  // The 2026-06 audit: 74-Z Speeder Bike (Elite) and Tauntaun Rider have
  // "Mounted" in abilityText/abilities but neither a mounted_* specialAbilityId
  // nor a `Mounted` passive, so they used to miss the 3-MP grant.
  for (const dcName of [
    'Captain Terro',
    'Kuiil',
    'Dewback Rider',
    '74-Z Speeder Bike (Elite)',
    'Tauntaun Rider',
  ]) {
    it(`${dcName} -> mounted descriptor`, () => {
      const { game, opts } = activatorGame(dcName);
      const keys = enumerateActivatorSoaDescriptors(game, opts).map((d) => d.subPromptKey);
      assert.ok(keys.includes('mounted'), `${dcName} should enumerate the mounted descriptor`);
    });
  }

  it('a non-Mounted figure does not get the mounted descriptor', () => {
    const { game, opts } = activatorGame('Stormtrooper');
    const keys = enumerateActivatorSoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(!keys.includes('mounted'));
  });
});

describe("enumerateActivatorSoaDescriptors — Chirrut I'm One With the Force", () => {
  it('fires at the start of a HOSTILE activation (owner = Chirrut player)', () => {
    const { game, opts } = activatorGame('Stormtrooper', { opponentDcs: ['Chirrut Imwe'] });
    const desc = enumerateActivatorSoaDescriptors(game, opts).find((d) => d.subPromptKey === 'i_am_one_with_the_force');
    assert.ok(desc, 'descriptor present at hostile activation');
    assert.strictEqual(desc.ownerPlayerNum, 2, 'owner is Chirrut player (the non-activator)');
    assert.strictEqual(desc.extras.chirrutFigureKey, 'Chirrut Imwe-1-0');
  });

  it("does NOT fire on Chirrut's own activation", () => {
    const msgId = 'mChir';
    const game = {
      dcMessageMeta: new Map([[msgId, { displayName: 'Chirrut Imwe [DG 1]', gameId: 'g', playerNum: 1, dcName: 'Chirrut Imwe' }]]),
      dcActionsData: { [msgId]: { selectedFigure: 0 } },
      figurePositions: { 1: { 'Chirrut Imwe-1-0': 'a1' }, 2: {} },
      p2DcList: [],
      p2DcMessageIds: [],
    };
    const keys = enumerateActivatorSoaDescriptors(game, { dcName: 'Chirrut Imwe', playerNum: 1, msgId }).map((d) => d.subPromptKey);
    assert.ok(!keys.includes('i_am_one_with_the_force'));
  });

  it('does not fire again once used this round', () => {
    const { game, opts } = activatorGame('Stormtrooper', { opponentDcs: ['Chirrut Imwe'] });
    game.chirrutOneWithForceUsed = { [game.p2DcMessageIds[0]]: true };
    const keys = enumerateActivatorSoaDescriptors(game, opts).map((d) => d.subPromptKey);
    assert.ok(!keys.includes('i_am_one_with_the_force'));
  });
});
