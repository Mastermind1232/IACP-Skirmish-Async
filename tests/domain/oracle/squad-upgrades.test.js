/**
 * Squad Upgrade figures — comprehensive suite (alexanbv 2026-06-17). A Squad
 * Upgrade (Z-6 / Mortar / Flame Trooper; NOT Riot Trooper) adds ONE full figure
 * to its attached group: own health box, own cost/traits, deploys + activates as
 * a 3rd group member, defeated/reinforced at its OWN printed cost. Covers slices
 * 1-5: membership, effective count, deploy placement, defeat detection, VP,
 * reinforcement, per-figure DC UI.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSquadUpgradeCard, squadUpgradeOnGroup, effectiveFigureCount,
  attachmentsForMsgId, groupEffectiveFigures, groupSuFigureHealth,
  squadUpgradeFigureCard, SQUAD_UPGRADE_FIGURE_CARDS,
} from '../../../src/game/squad-upgrades.js';
import { getDeployFigureLabels } from '../../../src/discord/components.js';
import { isGroupDefeated } from '../../../src/engine/game-readers.js';
import { calculateKillVp } from '../../../src/engine/mission-helpers.js';
import { getNicknamesForDcMessage, getConditionsForDcMessage } from '../../../src/engine/dc-ui-helpers.js';

// ── Slice 1: membership + effective count ────────────────────────────────────
describe('SU membership', () => {
  it('Z-6 / Mortar / Flame are SUs; Riot Trooper is not', () => {
    assert.deepEqual([...SQUAD_UPGRADE_FIGURE_CARDS].sort(), ['Flame Trooper', 'Mortar Trooper', 'Z-6 Trooper']);
    for (const su of SQUAD_UPGRADE_FIGURE_CARDS) assert.equal(isSquadUpgradeCard(su), true, su);
    assert.equal(isSquadUpgradeCard('Riot Trooper'), false);
    assert.equal(isSquadUpgradeCard('[Flame Trooper]'), true, 'bracket-tolerant');
    assert.equal(isSquadUpgradeCard('Combat Suit'), false);
  });
  it('squadUpgradeOnGroup returns the one SU (bare name) or null', () => {
    assert.equal(squadUpgradeOnGroup(['[Z-6 Trooper]']), 'Z-6 Trooper');
    assert.equal(squadUpgradeOnGroup(['Combat Suit']), null);
    assert.equal(squadUpgradeOnGroup([]), null);
  });
  it('effectiveFigureCount = base + 1 only with an SU', () => {
    assert.equal(effectiveFigureCount(2, ['Mortar Trooper']), 3);
    assert.equal(effectiveFigureCount(2, ['Combat Suit']), 2);
    assert.equal(effectiveFigureCount(2, []), 2);
  });
});

describe('SU msgId helpers', () => {
  const game = { p1DcAttachments: { m1: ['Flame Trooper'] }, p2DcAttachments: { m2: ['Combat Suit'] } };
  it('attachmentsForMsgId reads either player', () => {
    assert.deepEqual(attachmentsForMsgId(game, 'm1'), ['Flame Trooper']);
    assert.deepEqual(attachmentsForMsgId(game, 'm2'), ['Combat Suit']);
    assert.deepEqual(attachmentsForMsgId(game, 'mX'), []);
  });
  it('groupEffectiveFigures counts the SU on that group', () => {
    assert.equal(groupEffectiveFigures(game, 'm1', 2), 3);
    assert.equal(groupEffectiveFigures(game, 'm2', 2), 2);
  });
  it('groupSuFigureHealth returns the SU card HP, else null', () => {
    assert.equal(groupSuFigureHealth(game, 'm1', (n) => ({ 'Flame Trooper': { health: 8 } }[n])), 8);
    assert.equal(groupSuFigureHealth(game, 'm2', () => ({ health: 99 })), null, 'no SU → null');
  });
});

describe('SU figure-scoped combat abilities', () => {
  it('squadUpgradeFigureCard identifies the SU figure by its nickname', () => {
    const game = { figureNicknames: { 'Heavy Stormtrooper-1-2': 'Z-6 Trooper', 'Heavy Stormtrooper-1-0': 'Custom Name' } };
    // The SU figure (nicknamed with an SU card) is recognised; a base figure with
    // a non-SU nickname is not (only SU figures are ever nicknamed in practice).
    assert.equal(squadUpgradeFigureCard(game, 'Heavy Stormtrooper-1-2'), 'Z-6 Trooper');
    assert.equal(squadUpgradeFigureCard(game, 'Heavy Stormtrooper-1-0'), null, 'non-SU nickname → null');
    assert.equal(squadUpgradeFigureCard(game, 'Heavy Stormtrooper-1-1'), null, 'no nickname → null');
  });
});

// ── Slice 2: deploy places the SU as a 3rd figure ────────────────────────────
describe('SU deploy placement', () => {
  const helpers = (getNickname) => ({
    resolveDcName: (d) => d.dcName || d, isFigurelessDc: () => false,
    getDcStats: (n) => ({ 'Heavy Stormtrooper': { figures: 2 } }[n] || { figures: 1 }), getNickname,
  });
  it('base-2 + SU → 3 deploy buttons, the 3rd nicknamed', () => {
    const r = getDeployFigureLabels([{ dcName: 'Heavy Stormtrooper' }],
      helpers((dc, dg, f) => (f === 2 ? 'Flame Trooper' : null)));
    assert.equal(r.metadata.length, 3);
    assert.deepEqual(r.metadata.map((m) => m.figureIndex), [0, 1, 2]);
    assert.match(r.labels[2], /Flame Trooper/);
  });
  it('base-2 + no SU → 2 deploy buttons', () => {
    assert.equal(getDeployFigureLabels([{ dcName: 'Heavy Stormtrooper' }], helpers(() => null)).metadata.length, 2);
  });
});

// ── Slice 3: defeat detection is SU-aware ────────────────────────────────────
describe('SU defeat detection (group alive while SU figure lives)', () => {
  const deps = { getDcList: () => [{ dcName: 'Heavy Stormtrooper', displayName: 'Heavy Stormtrooper' }], getDcStats: () => ({ figures: 2 }) };
  it('only the SU figure (index 2) on board → group NOT defeated', () => {
    assert.equal(isGroupDefeated({ figurePositions: { 1: { 'Heavy Stormtrooper-1-2': 'a5' } } }, 1, 0, deps), false);
  });
  it('only a base figure on board → not defeated', () => {
    assert.equal(isGroupDefeated({ figurePositions: { 1: { 'Heavy Stormtrooper-1-0': 'a1' } } }, 1, 0, deps), false);
  });
  it('no figures on board → defeated', () => {
    assert.equal(isGroupDefeated({ figurePositions: { 1: {} } }, 1, 0, deps), true);
  });
});

// ── Slice 5a: the SU figure is scored at its own cost ────────────────────────
describe('SU defeat VP', () => {
  const deps = {
    isDcCompanion: () => false,
    getDcStats: (n) => ({ '[Flame Trooper]': { figures: 1, cost: 5 }, 'Heavy Stormtrooper': { figures: 2, subCost: 3 } }[n] || {}),
    getDcEffects: () => ({ 'Heavy Stormtrooper': { subCost: 3 } }),
  };
  it('SU card scores its own printed cost (figures:1 → cost)', () => {
    assert.equal(calculateKillVp('[Flame Trooper]', deps), 5);
  });
  it('a base multi-figure group still scores its per-figure subCost', () => {
    assert.equal(calculateKillVp('Heavy Stormtrooper', deps), 3);
  });
});

// ── Slice 3: per-figure DC UI includes the SU figure ─────────────────────────
describe('SU per-figure DC UI', () => {
  const deps = { getDcStats: () => ({ figures: 2 }) };
  const meta = { dcName: 'Heavy Stormtrooper', displayName: 'Heavy Stormtrooper' };
  it('nicknames include the SU figure (at index = base count)', () => {
    const game = { figureNicknames: { 'Heavy Stormtrooper-1-2': 'Flame Trooper' } };
    const nicks = getNicknamesForDcMessage(game, meta, deps);
    assert.ok(nicks, 'returns nicknames');
    assert.equal(nicks.length, 3, 'three figure slots');
    assert.equal(nicks[2], 'Flame Trooper');
  });
  it('conditions include the SU figure slot', () => {
    const game = {
      figureNicknames: { 'Heavy Stormtrooper-1-2': 'Flame Trooper' },
      figureConditions: { 'Heavy Stormtrooper-1-2': ['Bleed'] },
    };
    const conds = getConditionsForDcMessage(game, meta, deps);
    assert.ok(conds);
    assert.equal(conds.length, 3);
    assert.deepEqual(conds[2], ['Bleed']);
  });
});
