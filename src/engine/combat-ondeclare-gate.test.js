import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOnDeclareGate } from './combat-ondeclare-gate.js';
import { activeSide, pendingInteractive, autoResolvePassives, passGate } from './combat-ability-gate.js';

function deps(effMap) {
  return { getDcEffects: () => effMap, getMapData: () => ({ adjacency: {} }), isWithinSpaces: () => true, getFigureSize: () => [1, 1] };
}
const game = () => ({ figurePositions: { 1: {}, 2: {} }, selectedMap: { id: 'm' }, selectedMission: { rules: {} }, roundFigureAbilityUsed: {} });
const combat = (o = {}) => ({ attackerFigureKey: 'Atk-1-0', attackerDcName: 'Atk', attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Def-1-0' }, defenseRoll: {}, ...o });

describe('combat-ondeclare-gate: builds the on-declare gate from the registry', () => {
  it('attacker interactive on-declare DC abilities surface as gate options', () => {
    const d = deps({ Atk: { specialAbilityIds: ['vanguard', 'flawless_execution'] }, Def: { specialAbilityIds: [] } });
    const g = buildOnDeclareGate(game(), combat(), d);
    assert.equal(activeSide(g), 'attacker');
    autoResolvePassives(g, 'attacker');
    const pending = pendingInteractive(g, 'attacker');
    assert.ok(pending.includes('vanguard'), 'vanguard offered');
    assert.ok(pending.includes('flawless_execution'), 'flawless offered');
  });

  it('defender interactive on-declare DC abilities surface on the defender side', () => {
    const d = deps({ Atk: { specialAbilityIds: [] }, Def: { specialAbilityIds: ['strike_me_down_obiwan'] } });
    const g = buildOnDeclareGate(game(), combat(), d);
    // alexanbv 2026-06-23: the empty attacker side is active first (must pass);
    // then the defender side surfaces its abilities.
    assert.equal(activeSide(g), 'attacker');
    autoResolvePassives(g, 'attacker');
    passGate(g, 'attacker');
    assert.equal(activeSide(g), 'defender');
    autoResolvePassives(g, 'defender');
    assert.ok(pendingInteractive(g, 'defender').includes('strike_me_down'), 'strike me down offered');
  });

  it('resolved flags suppress an ability', () => {
    const d = deps({ Atk: { specialAbilityIds: ['vanguard'] }, Def: { specialAbilityIds: [] } });
    const g = buildOnDeclareGate(game(), combat({ vanguardResolved: true }), d);
    // vanguard is suppressed → no abilities, but the gate still prompts each side
    // (no auto-skip): attacker active until passed, no vanguard offered.
    assert.equal(activeSide(g), 'attacker');
    autoResolvePassives(g, 'attacker');
    assert.ok(!pendingInteractive(g, 'attacker').includes('vanguard'), 'vanguard suppressed');
  });
});
