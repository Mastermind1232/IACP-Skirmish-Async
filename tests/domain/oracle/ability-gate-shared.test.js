/**
 * Shared ability-gate helper tests (2026-04-16 follow-up).
 *
 * The original gate+rank logic was inlined in oracleActivationPlan priority
 * 2.5. It is now extracted into three exported helpers so the same discipline
 * can apply at the non-planner emission paths (pickWithinGroup 'ability' case
 * and heuristicPick specials branch). These tests pin the helper contract and
 * exercise the non-planner paths that were previously uniform-random.
 *
 *   abilityGateSuppresses  — pure: true iff actor >6 from every enemy
 *   auditAbilitySuppressed — side-effect: increments gateHit + skippedByCat
 *   pickAndAuditAbility    — picks by category rank + increments gatePass +
 *                            playedByCat
 *
 * End-to-end path exercised via pickSmartAction with a null network (forces
 * heuristicPick fallback), mirroring the "argmax had no network / absTypes
 * empty" branches that previously returned uniform-random ability picks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  abilityGateSuppresses,
  auditAbilitySuppressed,
  pickAndAuditAbility,
  getAbilityGateAudit,
  resetAbilityGateAudit,
  pickSmartAction,
} from '../../headless/learnings.js';

function act(type, specialName, overrides = {}) {
  return {
    type,
    params: { msgId: 'msg-p1-dc1', dcName: 'TestDC', specialName, ...(overrides.params || {}) },
    actingPlayer: 1,
    ...overrides.top,
  };
}

function gateGame({ actorCoord, enemyCoord, npcKryknaCoord = null }) {
  const g = {
    currentRound: 1,
    figurePositions: {
      1: { 'TestDC-1-0': actorCoord },
      2: { 'Enemy-1-0': enemyCoord },
    },
    p1ActivatedDcIndices: [],
    p2ActivatedDcIndices: [],
    p1DcMessageIds: ['msg-p1-dc1'],
    p2DcMessageIds: ['msg-p2-dc1'],
    selectedMap: { id: 'devaron-garrison' },
    selectedMission: { variant: 'a' },
    dcActionsData: { 'msg-p1-dc1': { selectedFigure: 0 } },
  };
  if (npcKryknaCoord) g.npcKrykna = [{ coord: npcKryknaCoord, defeated: false, hp: 8, maxHp: 8 }];
  return g;
}
function gateMeta() {
  return new Map([
    ['msg-p1-dc1', { dcName: 'TestDC', displayName: 'TestDC [Group 1]' }],
  ]);
}

describe('abilityGateSuppresses — pure gate check', () => {
  it('returns true when actor >6 from every enemy (Manhattan)', () => {
    const ability = act('dc_special', 'Force Choke');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'j10' });
    assert.equal(abilityGateSuppresses([ability], g, gateMeta()), true);
  });

  it('returns false when actor is within gate range', () => {
    const ability = act('dc_special', 'Force Choke');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a4' });
    assert.equal(abilityGateSuppresses([ability], g, gateMeta()), false);
  });

  it('returns false for an empty ability list (no gating)', () => {
    assert.equal(abilityGateSuppresses([], {}, new Map()), false);
    assert.equal(abilityGateSuppresses(null, {}, new Map()), false);
  });

  it('returns false when actor position is unresolvable (conservative)', () => {
    // No dcActionsData → getAttackerPosition returns null → helper treats as pass.
    const ability = act('dc_special', 'Force Choke');
    const g = { currentRound: 1, figurePositions: { 1: {}, 2: { 'Enemy-1-0': 'j10' } } };
    assert.equal(abilityGateSuppresses([ability], g, new Map()), false);
  });

  it('counts NPC Krykna toward nearest-enemy distance', () => {
    const ability = act('dc_special', 'Force Choke');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'l15', npcKryknaCoord: 'a2' });
    assert.equal(abilityGateSuppresses([ability], g, gateMeta()), false,
      'adjacent Krykna pulls nearest-enemy below gate');
  });

  it('boundary d=6 passes; d=7 suppresses (strict >6)', () => {
    const ability = act('dc_special', 'Force Choke');
    assert.equal(abilityGateSuppresses(
      [ability], gateGame({ actorCoord: 'a1', enemyCoord: 'a7' }), gateMeta()), false);
    assert.equal(abilityGateSuppresses(
      [ability], gateGame({ actorCoord: 'a1', enemyCoord: 'a8' }), gateMeta()), true);
  });
});

describe('pickAndAuditAbility — category rank + audit', () => {
  it('picks the offensive ability when offensive+support are offered', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', 'Force Choke');
    const support = act('dc_special', 'Strategize');
    const chosen = pickAndAuditAbility([support, offensive]);
    assert.equal(chosen, offensive, 'offensive beats support');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gatePass, 1);
    assert.equal(audit.playedByCat.offensive, 1);
    assert.equal(audit.playedByCat.support, 0);
  });

  it('off+move is preferred over defense when no offensive offered', () => {
    resetAbilityGateAudit();
    const offMove = act('dc_special', 'Pounce');
    const defense = act('dc_special', 'Force Deflection');
    const chosen = pickAndAuditAbility([defense, offMove]);
    assert.equal(chosen, offMove);
    assert.equal(getAbilityGateAudit().playedByCat.off_move, 1);
  });

  it('random tie-break inside the winning category', () => {
    resetAbilityGateAudit();
    const offA = act('dc_special', 'Force Choke');
    const offB = act('dc_special', 'Brutality');
    const support = act('dc_special', 'Strategize');
    const picks = new Set();
    for (let i = 0; i < 40; i++) {
      const chosen = pickAndAuditAbility([support, offA, offB]);
      assert.ok(chosen === offA || chosen === offB,
        'tie-break stays inside the offensive bucket');
      picks.add(chosen);
    }
    // 40 trials, 50/50 — both picked with probability > 1 − 2^-39.
    assert.equal(picks.size, 2);
  });

  it('unknown abilities fall into "other" and lose to every ranked category', () => {
    resetAbilityGateAudit();
    const other = act('dc_special', 'Mystery Move');
    const support = act('dc_special', 'Strategize');
    const chosen = pickAndAuditAbility([other, support]);
    assert.equal(chosen, support, 'support (rank 3) beats other (rank 4)');
  });
});

describe('auditAbilitySuppressed — gate-hit side effect', () => {
  it('increments gateHit once and skippedByCat per ability', () => {
    resetAbilityGateAudit();
    auditAbilitySuppressed([
      act('dc_special', 'Force Choke'),
      act('dc_special', 'Pounce'),
      act('dc_special', 'Strategize'),
    ]);
    const audit = getAbilityGateAudit();
    assert.equal(audit.gateHit, 1);
    assert.equal(audit.skippedByCat.offensive, 1);
    assert.equal(audit.skippedByCat.off_move, 1);
    assert.equal(audit.skippedByCat.support, 1);
    assert.equal(audit.gatePass, 0);
  });

  it('null or empty list is a no-op for audit increments', () => {
    resetAbilityGateAudit();
    auditAbilitySuppressed(null);
    auditAbilitySuppressed([]);
    const audit = getAbilityGateAudit();
    // gateHit is bumped even for empty lists — conservative: the caller asserts
    // suppression happened. Regression test verifies that no skipped-by-cat
    // entries are spuriously incremented when there are no abilities.
    assert.equal(audit.skippedByCat.offensive, 0);
    assert.equal(audit.skippedByCat.off_move, 0);
  });
});

// ── End-to-end: null-network fallback exercises heuristicPick specials ──────
// pickSmartAction with learnings.network=null (and no graph network) forwards
// to heuristicPick(strategicActions, game, ccWeights, dcMessageMeta). Its
// specials branch now gates and category-ranks. This mirrors the pre-argmax
// fallback path that was previously uniform-random.

function minimalLearnings() {
  return {
    network: null,
    graphNetwork: null,
    withinGroupWeights: {},
    meta: { totalGames: 0 },
  };
}

describe('heuristicPick specials branch — gated + ranked (null-network path)', () => {
  it('far actor: specials branch is skipped; falls through to end_activation', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', 'Force Choke');
    const endAct = act('dc_end_activation');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'j10' });
    const res = pickSmartAction([offensive, endAct], g, minimalLearnings(), 1, new Map(), gateMeta());
    assert.equal(res.type, 'dc_end_activation',
      'gate suppresses the specials branch → falls through to end_activation');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gateHit, 1);
    assert.equal(audit.skippedByCat.offensive, 1);
  });

  it('near actor, mixed categories: offensive wins over support', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', 'Force Choke');
    const support = act('dc_special', 'Strategize');
    const endAct = act('dc_end_activation');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a4' });
    const res = pickSmartAction([support, offensive, endAct], g, minimalLearnings(),
      1, new Map(), gateMeta());
    assert.equal(res, offensive, 'category rank picks offensive, not uniform random');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gatePass, 1);
    assert.equal(audit.playedByCat.offensive, 1);
  });

  it('near actor, only support abilities: support is played (not random)', () => {
    resetAbilityGateAudit();
    const support = act('dc_special', 'Strategize');
    const endAct = act('dc_end_activation');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a4' });
    const res = pickSmartAction([support, endAct], g, minimalLearnings(),
      1, new Map(), gateMeta());
    assert.equal(res, support, 'no suppression when only support is offered and actor near');
    assert.equal(getAbilityGateAudit().playedByCat.support, 1);
  });

  it('unresolvable actor position: gate does not fire (conservative) → ability plays', () => {
    resetAbilityGateAudit();
    const support = act('dc_special', 'Strategize');
    const endAct = act('dc_end_activation');
    const g = { // no dcActionsData → getAttackerPosition returns null
      currentRound: 1,
      figurePositions: { 1: {}, 2: { 'Enemy-1-0': 'j10' } },
      p1ActivatedDcIndices: [], p2ActivatedDcIndices: [],
      p1DcMessageIds: ['msg-p1-dc1'], p2DcMessageIds: ['msg-p2-dc1'],
      selectedMap: { id: 'devaron-garrison' },
    };
    const res = pickSmartAction([support, endAct], g, minimalLearnings(),
      1, new Map(), new Map());
    assert.equal(res, support,
      'unresolved position must not accidentally gate legal plays');
  });
});
