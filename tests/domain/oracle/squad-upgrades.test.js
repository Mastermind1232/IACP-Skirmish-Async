/**
 * Squad Upgrade figure membership + effective figure count (alexanbv 2026-06-17).
 * Riot Trooper is NOT a squad upgrade; Flame Trooper IS. A group can hold only
 * one attachment, so at most one squad upgrade adds at most one figure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSquadUpgradeCard, squadUpgradeOnGroup, effectiveFigureCount, SQUAD_UPGRADE_FIGURE_CARDS } from '../../../src/game/squad-upgrades.js';
import { getDeployFigureLabels } from '../../../src/discord/components.js';

describe('Squad Upgrade membership', () => {
  it('Z-6, Mortar, Flame Trooper are squad upgrades; Riot Trooper is not', () => {
    assert.deepEqual([...SQUAD_UPGRADE_FIGURE_CARDS].sort(), ['Flame Trooper', 'Mortar Trooper', 'Z-6 Trooper']);
    for (const su of ['Z-6 Trooper', 'Mortar Trooper', 'Flame Trooper']) assert.equal(isSquadUpgradeCard(su), true, su);
    assert.equal(isSquadUpgradeCard('Riot Trooper'), false, 'Riot Trooper is NOT a squad upgrade');
    assert.equal(isSquadUpgradeCard('Combat Suit'), false);
  });
  it('is bracket-tolerant', () => {
    assert.equal(isSquadUpgradeCard('[Flame Trooper]'), true);
  });
  it('squadUpgradeOnGroup finds the one SU on a group (bare name)', () => {
    assert.equal(squadUpgradeOnGroup(['Flame Trooper']), 'Flame Trooper');
    assert.equal(squadUpgradeOnGroup(['[Z-6 Trooper]']), 'Z-6 Trooper');
    assert.equal(squadUpgradeOnGroup(['Combat Suit']), null);
    assert.equal(squadUpgradeOnGroup([]), null);
    assert.equal(squadUpgradeOnGroup(undefined), null);
  });
  it('effectiveFigureCount adds 1 only when a squad upgrade is present', () => {
    assert.equal(effectiveFigureCount(2, ['Mortar Trooper']), 3);
    assert.equal(effectiveFigureCount(2, ['Combat Suit']), 2);
    assert.equal(effectiveFigureCount(2, []), 2);
    assert.equal(effectiveFigureCount(1, ['Z-6 Trooper']), 2);
  });
});

describe('Squad Upgrade deploy placement (slice 2)', () => {
  const helpers = (getNickname) => ({
    resolveDcName: (d) => d.dcName || d,
    isFigurelessDc: () => false,
    getDcStats: (n) => ({ 'Heavy Stormtrooper': { figures: 2 } }[n] || { figures: 1 }),
    getNickname,
  });
  it('a base-2 group with an SU figure deploys 3 figures (the 3rd nicknamed)', () => {
    // SU figure is nicknamed at index = base figure count (2).
    const getNick = (dc, dg, f) => (dc === 'Heavy Stormtrooper' && f === 2 ? 'Flame Trooper' : null);
    const r = getDeployFigureLabels([{ dcName: 'Heavy Stormtrooper' }], helpers(getNick));
    assert.equal(r.metadata.length, 3, 'three deploy buttons');
    assert.deepEqual(r.metadata.map((m) => m.figureIndex), [0, 1, 2]);
    assert.match(r.labels[2], /Flame Trooper/, 'the 3rd figure shows the SU nickname');
  });
  it('a base-2 group with no SU deploys only 2 figures', () => {
    const r = getDeployFigureLabels([{ dcName: 'Heavy Stormtrooper' }], helpers(() => null));
    assert.equal(r.metadata.length, 2);
  });
});
