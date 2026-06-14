/**
 * Validation of the gate-path mods resolvers (alexanbv 2026-06-14: "perform
 * with flag on and validate with test cases"). Exercises each ability's
 * resolver `apply` directly — the first real execution of this gate-path code —
 * asserting the chosen option mutates combat the same way the legacy inline
 * handlers did.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_RESOLVERS, handleModsPick, handleModsSubChoice } from '../../../src/handlers/combat.js';
import { buildStepGate, activeSide, isGateComplete, autoResolvePassives } from '../../../src/engine/combat-ability-gate.js';

const thread = { send: async () => ({}) };
const baseArgs = (combat, game = {}) => ({ game, combat, thread, ctx: { checkWinConditions: async () => {}, client: {} }, side: 'attacker', gameId: '42' });

describe('mods resolvers: attacker', () => {
  it('spray_fire apply → -3 Acc, +1 Surge; skip → just resolved', async () => {
    const c = {}; await COMBAT_RESOLVERS.spray_fire.apply('apply', baseArgs(c));
    assert.equal(c.bonusAccuracy, -3); assert.equal(c.surgeBonus, 1); assert.equal(c.sprayFireResolved, true);
    const c2 = {}; await COMBAT_RESOLVERS.spray_fire.apply('skip', baseArgs(c2));
    assert.equal(c2.sprayFireResolved, true); assert.equal(c2.bonusAccuracy, undefined);
  });

  it('call_the_shots applies the chosen bonus', async () => {
    const g = { figurePositions: { 1: {} }, selectedMap: { id: 'm' }, roundFigureAbilityUsed: {} };
    const c1 = { attackerPlayerNum: 1, attackerFigureKey: 'X-1-0' }; await COMBAT_RESOLVERS.call_the_shots.apply('acc', baseArgs(c1, g));
    assert.equal(c1.bonusAccuracy, 2); assert.equal(c1.callTheShotsResolved, true);
    const c2 = { attackerPlayerNum: 1, attackerFigureKey: 'X-1-0' }; await COMBAT_RESOLVERS.call_the_shots.apply('hit', baseArgs(c2, g));
    assert.equal(c2.bonusHits, 1);
    const c3 = { attackerPlayerNum: 1, attackerFigureKey: 'X-1-0' }; await COMBAT_RESOLVERS.call_the_shots.apply('surge', baseArgs(c3, g));
    assert.equal(c3.surgeBonus, 1);
  });

  it('heavy_repeater skip resolves without strain', async () => {
    const c = {}; await COMBAT_RESOLVERS.heavy_repeater.apply('skip', baseArgs(c));
    assert.equal(c.heavyRepeaterResolved, true);
  });

  it('negotiate accept → +2 Damage; pay → VP transfer', async () => {
    const cAcc = { attackerPlayerNum: 1, defenderPlayerNum: 2 }; await COMBAT_RESOLVERS.negotiate.apply('accept', baseArgs(cAcc));
    assert.equal(cAcc.bonusHits, 2); assert.equal(cAcc.negotiateResolved, true);
    const g = { player1VP: { total: 0, kills: 0, objectives: 0 }, player2VP: { total: 5, kills: 0, objectives: 0 } };
    const cPay = { attackerPlayerNum: 1, defenderPlayerNum: 2 }; await COMBAT_RESOLVERS.negotiate.apply('pay', baseArgs(cPay, g));
    assert.equal(g.player2VP.total, 3); // defender paid 2
    assert.ok(g.player1VP.total >= 2); // attacker gained
    assert.equal(cPay.negotiateResolved, true);
  });
});

describe('mods resolvers: defender', () => {
  it('defensible block/evade', async () => {
    const cB = {}; await COMBAT_RESOLVERS.defensible.apply('block', baseArgs(cB)); assert.equal(cB.bonusBlock, 1); assert.equal(cB.defensibleResolved, true);
    const cE = {}; await COMBAT_RESOLVERS.defensible.apply('evade', baseArgs(cE)); assert.equal(cE.bonusEvade, 1);
  });

  it('agile converts a block to evade when one is present', async () => {
    const c = { defenseRoll: { block: 1 } }; await COMBAT_RESOLVERS.agile.apply('apply', baseArgs(c));
    assert.equal(c.agileJetTrooperApplied, true);
    assert.equal((c.bonusEvade || 0), 1); // 1 block → 1 evade
  });

  it('get_down block/evade', async () => {
    const g = { figurePositions: { 2: {} }, selectedMap: { id: 'm' }, roundFigureAbilityUsed: {} };
    const c = { attackerPlayerNum: 1, target: { figureKey: 'D-1-0' } }; await COMBAT_RESOLVERS.get_down.apply('block', baseArgs(c, g));
    assert.equal(c.bonusBlock, 1); assert.equal(c.getDownResolved, true);
  });

  it('query accept → +1 Damage; bleed → applies Bleed to defender', async () => {
    const cAcc = { target: { figureKey: 'D-1-0' } }; await COMBAT_RESOLVERS.query.apply('accept', baseArgs(cAcc));
    assert.equal(cAcc.bonusHits, 1); assert.equal(cAcc.queryResolved, true);
    const g = { figureConditions: {} };
    const cBleed = { target: { figureKey: 'D-1-0' } }; await COMBAT_RESOLVERS.query.apply('bleed', baseArgs(cBleed, g));
    assert.ok((g.figureConditions['D-1-0'] || []).includes('Bleed')); assert.equal(cBleed.queryResolved, true);
  });

  it('elusive nullifies the chosen attack die + worst defense die; skip resolves', async () => {
    const c = { attackDiceResults: [{ color: 'red', dmg: 2, surge: 1, acc: 0 }], defenseDiceResults: [{ color: 'white', block: 1, evade: 0 }] };
    await COMBAT_RESOLVERS.elusive.apply('0', baseArgs(c));
    assert.equal(c.attackRoll.dmg, 0); assert.equal(c.elusiveResolved, true);
    const c2 = { attackDiceResults: [{ color: 'red', dmg: 2 }] }; await COMBAT_RESOLVERS.elusive.apply('skip', baseArgs(c2));
    assert.equal(c2.elusiveResolved, true);
  });
});

describe('mods gate handlers: full flag-on flow (pick → sub-choice → apply → re-drive)', () => {
  function setup() {
    const thread2 = { send: async () => ({}) };
    const game = {
      gameId: '42', player1Id: 'P1', player2Id: 'P2',
      pendingCombat: {
        gameId: '42', combatThreadId: 't', useModsGate: true,
        attackerPlayerNum: 1, defenderPlayerNum: 2,
        attackerFigureKey: 'X-1-0', target: { figureKey: 'D-1-0' },
        defenseRoll: {},
        // attacker has two interactive abilities so resolving one leaves the
        // gate active (no onComplete → no proceedAfterTokens dependency).
        modsGate: buildStepGate('mods', [
          { id: 'spray_fire', name: 'Spray Fire', side: 'attacker', kind: 'interactive' },
          { id: 'defensible', name: 'Defensible', side: 'attacker', kind: 'interactive' },
        ]),
      },
    };
    // Simulate the initial gate drive (_enterStep4) that fires the active
    // side's passives + posts the choose window before the player clicks.
    autoResolvePassives(game.pendingCombat.modsGate, 'attacker');
    const client = { channels: { fetch: async () => thread2 } };
    const ctx = { getGame: () => game, replyIfGameEnded: async () => false, saveGames: () => {}, client };
    const interaction = (customId) => ({ customId, client, user: { id: 'P1' }, deferUpdate: async () => {}, message: { edit: async () => {} }, followUp: async () => {} });
    return { game, ctx, interaction };
  }

  it('picking Spray Fire then choosing Apply resolves it and keeps the gate active', async () => {
    const { game, ctx, interaction } = setup();
    const combat = game.pendingCombat;
    // 1) pick spray_fire → posts its sub-choice prompt (gate unchanged, still attacker)
    await handleModsPick(interaction('combat_mods_pick_42_spray_fire'), ctx);
    assert.equal(activeSide(combat.modsGate), 'attacker');
    assert.equal(combat.bonusAccuracy, undefined); // not applied yet (waiting on sub-choice)
    // 2) choose Apply → applies effect, records spray_fire, re-drives
    await handleModsSubChoice(interaction('combat_modsub_42_apply_spray_fire'), ctx);
    assert.equal(combat.bonusAccuracy, -3);
    assert.equal(combat.surgeBonus, 1);
    assert.equal(combat.sprayFireResolved, true);
    // gate still active (defensible pending) — not complete
    assert.equal(isGateComplete(combat.modsGate), false);
    assert.deepEqual(combat.modsGate.attacker.resolved, ['spray_fire']);
  });

  it('picking an interactive ability with no resolver records + skips (gate never stalls)', async () => {
    const { game, ctx, interaction } = setup();
    const combat = game.pendingCombat;
    combat.modsGate = buildStepGate('mods', [
      { id: 'unknown_ability', name: 'Unknown', side: 'attacker', kind: 'interactive' },
      { id: 'defensible', name: 'Defensible', side: 'attacker', kind: 'interactive' },
    ]);
    autoResolvePassives(combat.modsGate, 'attacker');
    await handleModsPick(interaction('combat_mods_pick_42_unknown_ability'), ctx);
    assert.deepEqual(combat.modsGate.attacker.resolved, ['unknown_ability']); // recorded + skipped
  });
});
