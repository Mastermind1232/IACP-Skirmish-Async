// Third-party-figure CC eligibility (alexanbv 2026-06-16): friendly figures (not
// the attacker/defender) that can legally play a reaction CC for the current attack.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleThirdPartyCcFigures, isThirdPartyCc, thirdPartyCardName, THIRD_PARTY_CC_SPECS } from './third-party-ccs.js';

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
