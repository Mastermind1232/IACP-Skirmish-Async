/**
 * Ability-priority planner tests.
 *
 * Locks in the 2026-04-16 Devaron arbitration fix: oracleActivationPlan's
 * priority chain previously had no ability clause, so when dc_special was the
 * only productive legal type, the chain fell through to end_activation
 * (priority 5). The 50g forensic probe classified 321/330 (97.3%) of Devaron
 * premature-ends as this exact pattern.
 *
 * The fix inserts an `ability` priority between `mission_interact` and
 * `start_move`. These tests verify the new ordering:
 *   1. attack            (still wins when legal)
 *   2. mission_interact  (still wins when legal)
 *   2.5. ability         ← NEW
 *   3. start_move / move_space
 *   4. move_done
 *   5. end_activation
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { oracleActivationPlan, abilityCategory, getAbilityGateAudit, resetAbilityGateAudit } from '../../headless/learnings.js';

// Minimal game stub — the planner only reads currentRound, figurePositions,
// and mission data, none of which matter for the branches we're testing.
function stubGame() {
  return {
    currentRound: 1,
    figurePositions: { 1: {}, 2: {} },
    p1ActivatedDcIndices: [],
    p2ActivatedDcIndices: [],
    p1DcMessageIds: ['msg-p1-dc1'],
    p2DcMessageIds: ['msg-p2-dc1'],
    selectedMap: { id: 'devaron-garrison' },
    selectedMission: { variant: 'a' },
  };
}

// Build an action with the minimum shape the planner inspects.
function act(type, params = {}) {
  return { type, params: { msgId: 'msg-p1-dc1', dcName: 'TestDC', ...params }, actingPlayer: 1 };
}

// Groups indexed by abstract type — mirrors pickSmartAction's grouping.
function makeGroups(entries) {
  const g = {};
  for (const [absType, actions] of Object.entries(entries)) {
    g[absType] = actions;
  }
  return g;
}

describe('oracleActivationPlan — ability priority (2026-04-16 fix)', () => {
  it('special-only frame returns an ability action (no longer falls through to end)', () => {
    const ability1 = act('dc_special', { specialName: 'Pounce' });
    const ability2 = act('dc_special', { specialName: 'Brutality' });
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      ability: [ability1, ability2],
      end_activation: [endAct],
    });
    const absTypes = ['ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res.type, 'dc_special',
      'priority 2.5 returns an ability, not end_activation');
  });

  it('single-ability frame returns the only ability', () => {
    const ability = act('dc_special', { specialName: 'Slam' });
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      ability: [ability],
      end_activation: [endAct],
    });
    const absTypes = ['ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res, ability);
  });
});

describe('oracleActivationPlan — higher priorities still win over ability', () => {
  it('priority 1 attack_close beats ability when both are legal', () => {
    const attack = act('attack_target', { targetFigureKey: 'Enemy-1-0' });
    const ability = act('dc_special', { specialName: 'Pounce' });
    const endAct = act('dc_end_activation');
    const g = stubGame();
    // Planner's attack scorer reads from figurePositions + dcHealthState.
    // Set a minimal target so scoring doesn't throw.
    g.figurePositions[2]['Enemy-1-0'] = 'a1';
    g.figurePositions[1]['TestDC-1-0'] = 'a2';
    const dcMeta = new Map([
      ['msg-p1-dc1', { dcName: 'TestDC', displayName: 'TestDC [Group 1]' }],
    ]);
    const groups = makeGroups({
      attack_close: [attack],
      ability: [ability],
      end_activation: [endAct],
    });
    const absTypes = ['attack_close', 'ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), dcMeta, null);
    assert.equal(res.type, 'attack_target',
      'attack fires at priority 1 before ability at priority 2.5');
  });

  it('priority 1 attack_ranged beats ability when both are legal', () => {
    const attack = act('attack_target', { targetFigureKey: 'Enemy-1-0' });
    const ability = act('dc_special', { specialName: 'Force Lightning' });
    const endAct = act('dc_end_activation');
    const g = stubGame();
    g.figurePositions[2]['Enemy-1-0'] = 'a1';
    g.figurePositions[1]['TestDC-1-0'] = 'b3';
    const dcMeta = new Map([
      ['msg-p1-dc1', { dcName: 'TestDC', displayName: 'TestDC [Group 1]' }],
    ]);
    const groups = makeGroups({
      attack_ranged: [attack],
      ability: [ability],
      end_activation: [endAct],
    });
    const absTypes = ['attack_ranged', 'ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), dcMeta, null);
    assert.equal(res.type, 'attack_target');
  });

  it('priority 2 mission_interact beats ability when both are legal', () => {
    const missionInteract = act('interact', { optionId: 'launch_panel' });
    const ability = act('dc_special', { specialName: 'Battlefield Leadership' });
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      interact: [missionInteract],
      ability: [ability],
      end_activation: [endAct],
    });
    const absTypes = ['interact', 'ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res.type, 'interact',
      'mission interact (priority 2) beats ability (priority 2.5)');
  });

  it('use_terminal interact does NOT win (non-scoring interact falls through to ability)', () => {
    // use_terminal interact is filtered out of mission-scoring list, so the
    // chain should continue past priority 2 and reach ability.
    const useTerminal = act('interact', { optionId: 'use_terminal' });
    const ability = act('dc_special', { specialName: 'Calming Presence' });
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      interact: [useTerminal],
      ability: [ability],
      end_activation: [endAct],
    });
    const absTypes = ['interact', 'ability', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res.type, 'dc_special',
      'use_terminal is non-scoring — ability should win');
  });
});

describe('oracleActivationPlan — ability beats movement priorities', () => {
  it('ability beats start_move', () => {
    const ability = act('dc_special', { specialName: 'Pounce' });
    const startMove = act('start_move');
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      ability: [ability],
      start_move: [startMove],
      end_activation: [endAct],
    });
    const absTypes = ['ability', 'start_move', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res.type, 'dc_special',
      'ability (priority 2.5) beats start_move (priority 3)');
  });

  it('ability beats move_space candidates', () => {
    const ability = act('dc_special', { specialName: 'Slam' });
    const moveSpace = act('move_pick_space', { coord: 'b1' });
    const endAct = act('dc_end_activation');
    const g = stubGame();
    g.figurePositions[1]['TestDC-1-0'] = 'a1';
    const groups = makeGroups({
      ability: [ability],
      move_toward: [moveSpace],
      end_activation: [endAct],
    });
    const absTypes = ['ability', 'move_toward', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), new Map(), null);
    assert.equal(res.type, 'dc_special',
      'ability beats move_toward (priority 3b)');
  });
});

describe('oracleActivationPlan — no-ability paths preserved', () => {
  it('start_move still fires when no ability/attack/interact is legal', () => {
    const startMove = act('start_move');
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      start_move: [startMove],
      end_activation: [endAct],
    });
    const absTypes = ['start_move', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res, startMove,
      'start_move (priority 3) still fires when ability is absent');
  });

  it('move_space still fires when no ability/attack/interact/start_move is legal', () => {
    const moveSpace = act('move_pick_space', { coord: 'b1' });
    const endAct = act('dc_end_activation');
    const g = stubGame();
    g.figurePositions[1]['TestDC-1-0'] = 'a1';
    const groups = makeGroups({
      move_toward: [moveSpace],
      end_activation: [endAct],
    });
    const absTypes = ['move_toward', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), new Map(), null);
    assert.equal(res, moveSpace,
      'move_toward still fires at priority 3b when ability is absent');
  });

  it('end_activation fall-through still fires when truly nothing productive is legal', () => {
    // Edge case: planner fires because end_activation is in _WITHIN_ACT_TYPES.
    // If no productive type is in the group set, priority 5 still returns end.
    const endAct = act('dc_end_activation');
    const groups = makeGroups({
      end_activation: [endAct],
    });
    const absTypes = ['end_activation'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res, endAct,
      'priority 5 still fires as last resort');
  });
});

describe('oracleActivationPlan — between-activation decisions untouched', () => {
  it('returns null when activate is in absTypes (between-activation decision)', () => {
    const activate = act('activate_dc', { msgId: 'msg-p1-dc2' });
    const ability = act('dc_special', { specialName: 'Pounce' });
    const groups = makeGroups({
      activate: [activate],
      ability: [ability],
    });
    const absTypes = ['activate', 'ability'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res, null,
      'activate in absTypes means between-activation — planner returns null to let DQN pick');
  });

  it('returns null when no within-activation type is in absTypes', () => {
    // No attack/interact/move/end_activation — planner doesn't fire.
    const ability = act('dc_special', { specialName: 'Pounce' });
    const groups = makeGroups({
      ability: [ability],
    });
    const absTypes = ['ability'];
    const res = oracleActivationPlan(absTypes, groups, stubGame(), new Map(), new Map(), null);
    assert.equal(res, null,
      'ability alone is not a within-act gate — planner returns null');
  });
});

// ── Distance-gate + category-order heuristic (2026-04-16) ──────────────────
// After the priority-2.5 arbitration fix, the 50g Devaron audit found 58% of
// offensive and 80% of support abilities firing at d≥7 from any enemy, and
// only 1.4% of offensive plays followed by an attack. The heuristic adds:
//   1) Distance gate — skip ability branch if actor is >6 from every enemy.
//   2) Category order — offensive > off+move > defense > support > other.

// Game stub that exercises figure-position lookup so the gate can measure
// real distances. getAttackerPosition requires dcActionsData + meta to resolve.
function gateGame({ actorCoord, enemyCoord, npcKryknaCoord = null, npcThugsCoord = null }) {
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
  if (npcThugsCoord) g.npcThugs = [{ coord: npcThugsCoord, defeated: false, hp: 5, maxHp: 5 }];
  return g;
}
function gateMeta() {
  return new Map([
    ['msg-p1-dc1', { dcName: 'TestDC', displayName: 'TestDC [Group 1]' }],
  ]);
}

describe('oracleActivationPlan — ability distance gate', () => {
  it('far-support: actor >6 from enemy falls through to start_move (support skipped)', () => {
    resetAbilityGateAudit();
    const support = act('dc_special', { specialName: 'Strategize' });
    const startMove = act('start_move');
    const endAct = act('dc_end_activation');
    // Actor at a1 (col 0, row 1), enemy at j10 (col 9, row 10) — Manhattan ≈ 18
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'j10' });
    const groups = makeGroups({
      ability: [support],
      start_move: [startMove],
      end_activation: [endAct],
    });
    const absTypes = ['ability', 'start_move', 'end_activation'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, startMove, 'gate fires → falls through to start_move');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gateHit, 1, 'gate-hit counter incremented');
    assert.equal(audit.skippedByCat.support, 1, 'support skip recorded');
  });

  it('far-offensive: actor >6 from enemy falls through even for offensive abilities', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Force Choke' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'j10' });
    const groups = makeGroups({
      ability: [offensive],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, startMove, 'gate applies to offensive too — move first');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gateHit, 1);
    assert.equal(audit.skippedByCat.offensive, 1);
  });

  it('gate-hit audit tracks off+move suppressions (main over-gating risk)', () => {
    resetAbilityGateAudit();
    const offMove = act('dc_special', { specialName: 'Pounce' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'k12' });
    const groups = makeGroups({
      ability: [offMove],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    const audit = getAbilityGateAudit();
    assert.equal(audit.skippedByCat.off_move, 1,
      'off+move skip counted — user needs visibility on this over-gating risk');
  });

  it('near-offensive: actor ≤6 from enemy plays the offensive ability', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Force Choke' });
    const startMove = act('start_move');
    // Actor at a1, enemy at a4 → d=3 (within gate)
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a4' });
    const groups = makeGroups({
      ability: [offensive],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, offensive, 'gate passes → offensive fires');
    const audit = getAbilityGateAudit();
    assert.equal(audit.gatePass, 1);
    assert.equal(audit.playedByCat.offensive, 1);
  });

  it('boundary: actor exactly at gate distance (=6) still passes', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Saber Strike' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a7' });
    const groups = makeGroups({
      ability: [offensive],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, offensive, 'd=6 passes the gate (strictly >6 gates)');
  });

  it('NPC Krykna counts toward nearest-enemy distance', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Force Choke' });
    const startMove = act('start_move');
    // DC enemy far, but Krykna NPC close — gate should pass.
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'l15', npcKryknaCoord: 'b2' });
    const groups = makeGroups({
      ability: [offensive],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, offensive, 'NPC Krykna within range → gate passes');
  });

  it('defeated NPCs do not count toward gate', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Force Choke' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'l15' });
    // Adjacent Krykna but defeated — should not save the gate.
    g.npcKrykna = [{ coord: 'b2', defeated: true, hp: 0, maxHp: 8 }];
    const groups = makeGroups({
      ability: [offensive],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, startMove, 'defeated NPC ignored → gate fires');
  });
});

describe('oracleActivationPlan — ability category ordering', () => {
  it('offensive wins over off+move within gate', () => {
    resetAbilityGateAudit();
    const offensive = act('dc_special', { specialName: 'Force Choke' });
    const offMove = act('dc_special', { specialName: 'Pounce' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a3' });
    const groups = makeGroups({
      ability: [offMove, offensive], // offered in "wrong" order to prove sorting
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, offensive, 'offensive (rank 0) beats off+move (rank 1)');
  });

  it('off+move wins over defense within gate', () => {
    resetAbilityGateAudit();
    const offMove = act('dc_special', { specialName: 'Trample' });
    const defense = act('dc_special', { specialName: 'Force Deflection' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a3' });
    const groups = makeGroups({
      ability: [defense, offMove],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, offMove, 'off+move (rank 1) beats defense (rank 2)');
  });

  it('defense wins over support within gate', () => {
    resetAbilityGateAudit();
    const defense = act('dc_special', { specialName: 'Calming Presence' });
    const support = act('dc_special', { specialName: 'Strategize' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a3' });
    const groups = makeGroups({
      ability: [support, defense],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, defense, 'defense (rank 2) beats support (rank 3)');
  });

  it('support wins over unknown/other when only those are available', () => {
    resetAbilityGateAudit();
    const support = act('dc_special', { specialName: 'Battlefield Leadership' });
    const other = act('dc_special', { specialName: 'Some Uncategorized Ability' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a3' });
    const groups = makeGroups({
      ability: [other, support],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
    assert.equal(res, support, 'support (rank 3) beats other (rank 4)');
  });

  it('two abilities in same category — random pick within winners (both are plausible)', () => {
    resetAbilityGateAudit();
    const offA = act('dc_special', { specialName: 'Force Choke' });
    const offB = act('dc_special', { specialName: 'Brutality' });
    const support = act('dc_special', { specialName: 'Strategize' });
    const startMove = act('start_move');
    const g = gateGame({ actorCoord: 'a1', enemyCoord: 'a3' });
    const groups = makeGroups({
      ability: [support, offA, offB],
      start_move: [startMove],
    });
    const absTypes = ['ability', 'start_move'];
    // Run many picks; result must always be one of the offensive abilities.
    const picks = new Set();
    for (let i = 0; i < 50; i++) {
      const res = oracleActivationPlan(absTypes, groups, g, new Map(), gateMeta(), null);
      assert.ok(res === offA || res === offB,
        'tie-break must stay within offensive category');
      picks.add(res);
    }
    // Both should have been picked at least once with very high probability.
    assert.ok(picks.size >= 1, 'at least one offensive ability was picked');
  });
});

describe('abilityCategory helper', () => {
  it('classifies known abilities into expected categories', () => {
    assert.equal(abilityCategory('Force Choke'), 'offensive');
    assert.equal(abilityCategory('Pounce'), 'off_move');
    assert.equal(abilityCategory('Survival is Strength'), 'defense');
    assert.equal(abilityCategory('Strategize'), 'support');
  });
  it('returns "other" for unknown or missing names', () => {
    assert.equal(abilityCategory('Unmapped Ability'), 'other');
    assert.equal(abilityCategory(null), 'other');
    assert.equal(abilityCategory(undefined), 'other');
  });
});
