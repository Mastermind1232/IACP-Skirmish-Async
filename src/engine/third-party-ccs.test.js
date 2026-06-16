// Third-party-figure CC eligibility (alexanbv 2026-06-16): friendly figures (not
// the attacker/defender) that can legally play a reaction CC for the current attack.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleThirdPartyCcFigures, isThirdPartyCc, thirdPartyCardName, THIRD_PARTY_CC_SPECS, applyThirdPartyCcEffect } from './third-party-ccs.js';

describe('applyThirdPartyCcEffect — Concentrated Fire', () => {
  const deps = (stun) => ({
    applyCondition: (g, fk, c) => stun.push([fk, c]),
    getDcEffects: () => ({ Stormtrooper: { attack: { type: 'range' } }, 'Royal Guard (Elite)': { attack: { type: 'melee' } } }),
  });
  it('Ranged playing figure → +1 red die to the pool AND Stun', () => {
    const stun = []; const combat = { attackInfo: { dice: ['green', 'green'] } };
    const r = applyThirdPartyCcEffect('Concentrated Fire', {}, combat, 'Stormtrooper-1-1', deps(stun));
    assert.equal(r.applied, true);
    assert.deepEqual(combat.attackInfo.dice, ['green', 'green', 'red']);
    assert.deepEqual(stun, [['Stormtrooper-1-1', 'Stun']]);
  });
  it('non-Ranged playing figure → Stun only, no die added', () => {
    const stun = []; const combat = { attackInfo: { dice: ['blue'] } };
    applyThirdPartyCcEffect('Concentrated Fire', {}, combat, 'Royal Guard (Elite)-1-2', deps(stun));
    assert.deepEqual(combat.attackInfo.dice, ['blue']);
    assert.deepEqual(stun, [['Royal Guard (Elite)-1-2', 'Stun']]);
  });
});

// Mock adjacency map: b2<->b3 adjacent, p15 far away.
const mapDeps = { getMapData: () => ({ adjacency: { b2: ['b3'], b3: ['b2', 'b4'], b4: ['b3'] } }) };

describe('isThirdPartyCc / thirdPartyCardName', () => {
  it('recognizes the exception cards and resolves side-qualified aliases', () => {
    assert.equal(isThirdPartyCc('Concentrated Fire'), true);
    assert.equal(isThirdPartyCc('Wild Attack'), false);
    assert.equal(thirdPartyCardName('There Is No Try (defender)'), 'There Is No Try');
    assert.equal(thirdPartyCardName('Guardian Stance'), 'Guardian Stance');
  });
});

describe('Concentrated Fire — friendly TROOPER (not the attacker) with LOS to target', () => {
  const game = {
    figurePositions: {
      1: { 'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'c3', 'Royal Guard (Elite)-1-2': 'a2' },
      2: { 'Darth Vader-2-0': 'b2' },
    },
  };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Darth Vader-2-0' } };

  it('offers other friendly TROOPERS (excludes the attacker, excludes non-TROOPERS)', () => {
    const elig = eligibleThirdPartyCcFigures(game, 'Concentrated Fire', combat);
    assert.deepEqual(elig, ['Stormtrooper-1-1']); // not the attacker (1-0), not the Royal Guard (not a TROOPER)
  });
  it('a blocking LOS predicate removes a figure', () => {
    const elig = eligibleThirdPartyCcFigures(game, 'Concentrated Fire', combat, { hasLineOfSight: (g, fk) => fk !== 'Stormtrooper-1-1' });
    assert.deepEqual(elig, []);
  });
});

describe('Guardian Stance — GUARDIAN on the defender team adjacent to the defender', () => {
  const game = {
    selectedMap: { id: 'm' },
    figurePositions: {
      1: { 'Stormtrooper-1-0': 'a1' },
      2: { 'Darth Vader-2-0': 'b2', 'Royal Guard (Elite)-2-1': 'b3', 'Royal Guard (Elite)-2-2': 'p15' },
    },
  };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Darth Vader-2-0' } };

  it('offers only the adjacent guardian (the far one is out of range)', () => {
    const elig = eligibleThirdPartyCcFigures(game, 'Guardian Stance', combat, mapDeps);
    assert.deepEqual(elig, ['Royal Guard (Elite)-2-1']);
  });
});

describe('Get Behind Me! — GUARDIAN or FORCE USER within 3 of the defender', () => {
  it('range 3 reaches a figure two steps away (b2→b3→b4)', () => {
    const game = {
      selectedMap: { id: 'm' },
      figurePositions: {
        1: { 'Stormtrooper-1-0': 'a1' },
        2: { 'Darth Vader-2-0': 'b2', 'Royal Guard (Elite)-2-1': 'b4' },
      },
    };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Darth Vader-2-0' } };
    const elig = eligibleThirdPartyCcFigures(game, 'Get Behind Me!', combat, mapDeps);
    assert.deepEqual(elig, ['Royal Guard (Elite)-2-1']);
  });
});

describe('every spec has a known window', () => {
  it('windows are on_declare / rerolls / damage_pipeline', () => {
    for (const [k, s] of Object.entries(THIRD_PARTY_CC_SPECS)) {
      assert.ok(['on_declare', 'rerolls', 'damage_pipeline'].includes(s.window), `${k} has bad window ${s.window}`);
    }
  });
});

// Registration into the combat-gate windows (offered army-wide when eligible).
import './combat-mods-gate.js';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';

describe('third-party CC gate registration', () => {
  it('registers combat-window specs with kind:third_party_cc', () => {
    const cf = getCombatAbility('tpcc:concentrated_fire:on_declare:attacker');
    assert.equal(cf?.params?.kind, 'third_party_cc');
    const gs = getCombatAbility('tpcc:guardian_stance:rerolls:defender');
    assert.equal(gs?.params?.kind, 'third_party_cc');
    // Opportunistic is damage_pipeline → NOT a combat-gate ability
    assert.ok(!getCombatAbility('tpcc:opportunistic:damage_pipeline:attacker'));
  });

  it('Concentrated Fire is offered at on_declare/attacker only when in hand AND a trooper is eligible', () => {
    const figs = { 1: { 'Stormtrooper-1-0': 'a1', 'Stormtrooper-1-1': 'c3' }, 2: { 'Darth Vader-2-0': 'b2' } };
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Darth Vader-2-0' } };
    const offered = (g) => abilitiesForWindow('on_declare', 'attacker', g, combat, {}).map((a) => a.name);
    assert.ok(offered({ player1CcHand: ['Concentrated Fire'], figurePositions: figs }).includes('Concentrated Fire'));
    // only the attacker is a trooper → excludeActive leaves nobody eligible
    assert.ok(!offered({ player1CcHand: ['Concentrated Fire'], figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' }, 2: { 'Darth Vader-2-0': 'b2' } } }).includes('Concentrated Fire'));
    // not in hand
    assert.ok(!offered({ player1CcHand: [], figurePositions: figs }).includes('Concentrated Fire'));
  });
});
