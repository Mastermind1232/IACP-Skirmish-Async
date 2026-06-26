// Focused tests for the overnight ability-audit (2026-06-26) handler fixes.
//
//  - Deflection part 2: the after-attack counter-damage must only enqueue for a
//    RANGED attack (combat.isRanged), never for a Melee attack. The card only
//    triggers "when a Ranged attack targeting you is declared"
//    (library `deflectionRangedOnly`).
//  - Tress Hacnua / Leg Hydraulics: the enqueued button label describes a
//    move-up-to-1-space, not an MP grant.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueDefenderStep8Effects,
  enqueueAttackerPerDcEffects,
} from '../../src/handlers/after-attack-resolve.js';
// Importing the hooks module registers the Vengeance/Forward Vengeance hooks
// onto the shared WHEN_DEFEATED_HOOKS array exported from damage-pipeline.js.
import '../../src/game/damage-pipeline-hooks.js';
import { WHEN_DEFEATED_HOOKS } from '../../src/game/damage-pipeline.js';
import { getDcEffects } from '../../src/data-loader.js';

function baseDeps() {
  return {
    // No DC special abilities on either figure — we only exercise the
    // game.deflectionPending branch, which is independent of specialAbilityIds.
    getDcEffects: () => ({}),
    findDcMessageIdForFigure: () => 'msg-def',
    dcNameFromFigureKey: (fk) => String(fk).replace(/-\d+-\d+$/, ''),
  };
}

function combatBase(isRanged) {
  return {
    defenderPlayerNum: 1,
    isRanged,
    target: { figureKey: 'Greedo-1-0' },
    afterAttackEffects: [],
  };
}

describe('Deflection part 2 — counter-damage is Ranged-only', () => {
  it('enqueues the deflection counter-damage on a RANGED attack', () => {
    const game = { gameId: 'g1', deflectionPending: { 1: 1 }, deflectionUnconditional: { 1: true } };
    const combat = combatBase(true);
    enqueueDefenderStep8Effects(combat, game, baseDeps());
    const deflect = (combat.afterAttackEffects || []).find((e) => e.type === 'deflection');
    assert.ok(deflect, 'deflection counter-damage enqueued for a Ranged attack');
  });

  it('does NOT enqueue the deflection counter-damage on a MELEE attack', () => {
    const game = { gameId: 'g1', deflectionPending: { 1: 1 }, deflectionUnconditional: { 1: true } };
    const combat = combatBase(false);
    enqueueDefenderStep8Effects(combat, game, baseDeps());
    const deflect = (combat.afterAttackEffects || []).find((e) => e.type === 'deflection');
    assert.equal(deflect, undefined, 'deflection counter-damage NOT enqueued for a Melee attack');
  });
});

describe('Tress Hacnua / Leg Hydraulics — label is a move, not an MP grant', () => {
  it('enqueues the move-up-to-1-space label', () => {
    const game = { gameId: 'g1' };
    const combat = {
      attackerFigureKey: 'Tress Hacnua-1-0',
      attackerMsgId: 'atk-msg',
      attackerDcName: 'Tress Hacnua',
      afterAttackEffects: [],
    };
    const deps = {
      getDcEffects: () => ({ 'Tress Hacnua': { specialAbilityIds: ['leg_hydraulics_tress'] } }),
    };
    enqueueAttackerPerDcEffects(combat, game, deps);
    const leg = (combat.afterAttackEffects || []).find((e) => e.type === 'leg_hydraulics');
    assert.ok(leg, 'leg_hydraulics effect enqueued');
    assert.equal(leg.label, 'Leg Hydraulics: move up to 1 space');
    assert.ok(!/gain 1 MP/i.test(leg.label), 'label no longer says "gain 1 MP"');
  });
});

describe('Royal Guard Vengeance/Forward Vengeance — defeated companion excluded', () => {
  const hook = WHEN_DEFEATED_HOOKS.find((h) => h.id === 'royal_guard_vengeance_focus');

  it('the shared focus hook is registered', () => {
    assert.ok(hook, 'royal_guard_vengeance_focus hook present');
  });

  it('a defeated COMPANION figure (non-GUARDIAN) does not trigger the hook', () => {
    // Dio is a companion (companion:true) with only the DROID keyword (no
    // GUARDIAN), so the companion guard is the only thing that can block it.
    const dioEff = getDcEffects()['Dio'];
    assert.equal(dioEff?.companion, true, 'Dio is a companion in dc-effects');
    assert.ok(
      !(dioEff?.keywords || []).map((k) => String(k).toUpperCase()).includes('GUARDIAN'),
      'Dio has no GUARDIAN keyword — only the companion guard can block it',
    );
    const game = { selectedMap: { id: 'm' }, figurePositions: { 1: {} } };
    const res = hook.probe(game, {
      figureKey: 'Dio-1-0',
      controllerPlayerNum: 1,
      defeatedPos: 'a1',
    });
    assert.equal(res, false, 'companion defeat does not trigger Vengeance');
  });
});
