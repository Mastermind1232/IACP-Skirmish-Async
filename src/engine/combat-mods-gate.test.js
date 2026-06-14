import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildModsGate } from './combat-mods-gate.js';
import { runGate, activeSide } from './combat-ability-gate.js';

function deps(effMap) {
  return {
    getDcEffects: () => effMap,
    getMapData: () => ({ adjacency: {} }),
    isWithinSpaces: () => true,
    getFigureSize: () => [1, 1],
  };
}
const game = (o = {}) => ({
  player1VP: { total: 0 }, player2VP: { total: 0 }, figurePositions: { 1: {}, 2: {} },
  figureContraband: {}, figureOrientations: {}, roundFigureAbilityUsed: {},
  selectedMap: { id: 'm' }, selectedMission: { rules: {} }, ...o,
});
const combat = (o = {}) => ({
  attackerFigureKey: 'Atk-1-0', attackerDcName: 'Atk', attackerPlayerNum: 1, defenderPlayerNum: 2,
  target: { figureKey: 'Def-1-0' }, defenseRoll: { block: 1, dodge: false }, attackType: 'Ranged', ...o,
});

describe('combat-mods-gate: builds the mods gate from the registry', () => {
  it('attacker mods then defender mods, real end-to-end drive', async () => {
    const d = deps({
      Atk: { specialAbilityIds: ['spray_fire_heavy_stormtrooper', 'pulse_cannon_iden'] },
      Def: { specialAbilityIds: ['agile_jet_trooper_reg'] },
    });
    const g = buildModsGate(game(), combat({ attackerSpentPowerToken: true }), d);
    assert.equal(activeSide(g), 'attacker');
    const fired = [];
    await runGate(g, {
      firePassive: (side, id) => fired.push(`P:${side}:${id}`),
      resolveInteractive: (side, id) => fired.push(`I:${side}:${id}`),
      pickNext: (side, pending) => pending[0] ?? null, // resolve everything, registry order
    });
    // Pulse Cannon is a passive attacker mod; Spray Fire interactive attacker;
    // Agile interactive defender (block present). Sequence: attacker passives,
    // attacker interactive, then defender interactive.
    assert.ok(fired.includes('P:attacker:pulse_cannon'));
    assert.ok(fired.includes('I:attacker:spray_fire'));
    assert.ok(fired.includes('I:defender:agile'));
    // attacker side fully resolved before defender
    assert.ok(fired.indexOf('I:attacker:spray_fire') < fired.indexOf('I:defender:agile'));
    assert.ok(fired.indexOf('P:attacker:pulse_cannon') < fired.indexOf('I:defender:agile'));
  });

  it('empty gate when no mods abilities present', () => {
    const g = buildModsGate(game(), combat({ defenseRoll: { block: 0, dodge: false } }),
      deps({ Atk: { specialAbilityIds: [] }, Def: { specialAbilityIds: [] } }));
    assert.equal(activeSide(g), null);
  });
});
