/**
 * Bespoke gate reroll resolvers (COMBAT_RESOLVERS) for abilities the generic
 * pick-one-die resolver can't express. alexanbv 2026-06-16.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_RESOLVERS, _doubleDieResults, _resolveShrewdScoundrel } from '../../../src/handlers/combat.js';
import { buildHeadlessDeps } from '../../../src/headless/headless-deps.js';

function deps() {
  return buildHeadlessDeps({ dcMessageMeta: new Map(), dcExhaustedState: new Map(), dcHealthState: new Map() });
}
const thread = { send: async () => ({}) };

describe('Twin Sabers (Ahsoka): reroll ALL dice of one pool, except already-rerolled', () => {
  function combat() {
    return {
      attackDiceResults: [
        { color: 'blue', acc: 1, dmg: 1, surge: 0 },
        { color: 'green', acc: 0, dmg: 1, surge: 0 },
        { color: 'red', acc: 2, dmg: 2, surge: 0 },
      ],
      defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
      _rerolledDieIds: new Set(['attack:1']), // index 1 already rerolled
      attackRoll: { acc: 3, dmg: 4, surge: 0 },
      defenseRoll: { block: 1, evade: 0, dodge: false },
    };
  }

  it('rerolls every attack die except the one already rerolled', async () => {
    const res = COMBAT_RESOLVERS['reroll:ahsoka_tano:attacker'];
    assert.ok(res, 'Twin Sabers resolver registered');
    const c = combat();
    // prompt should count only selectable (non-already-rerolled) attack dice = 2
    const p = res.prompt({ combat: c });
    assert.match(p.buttons[0][1], /\(2\)/, 'attack option counts 2 selectable dice');
    await res.apply('atk', { combat: c, ctx: deps(), thread });
    assert.deepEqual([...c._rerolledDieIds].sort(), ['attack:0', 'attack:1', 'attack:2'],
      'all attack dice are now rerolled (0 and 2 added, 1 was already)');
  });

  it('the "force defender" choice rerolls all defense dice', async () => {
    const res = COMBAT_RESOLVERS['reroll:ahsoka_tano:attacker'];
    const c = combat();
    await res.apply('def', { combat: c, ctx: deps(), thread });
    assert.ok(c._rerolledDieIds.has('defense:0'), 'defense die rerolled');
    assert.ok(!c._rerolledDieIds.has('attack:0'), 'attack pool untouched on the defender choice');
  });

  it('skip rerolls nothing', async () => {
    const res = COMBAT_RESOLVERS['reroll:ahsoka_tano:attacker'];
    const c = combat();
    await res.apply('skip', { combat: c, ctx: deps(), thread });
    assert.deepEqual([...c._rerolledDieIds].sort(), ['attack:1'], 'no rerolls on skip');
  });
});

describe('Shrewd Scoundrel double (IACP FAQ): all symbols incl. dodge', () => {
  it('_doubleDieResults doubles every attack symbol', () => {
    const die = { color: 'red', acc: 2, dmg: 2, surge: 1 };
    _doubleDieResults(die, 'attack');
    assert.deepEqual(die, { color: 'red', acc: 4, dmg: 4, surge: 2 });
  });

  it('_doubleDieResults doubles block/evade and turns a boolean dodge into 2', () => {
    const die = { color: 'white', block: 1, evade: 1, dodge: true };
    _doubleDieResults(die, 'defense');
    assert.equal(die.block, 2);
    assert.equal(die.evade, 2);
    assert.equal(die.dodge, 2, 'a doubled Dodge becomes a numeric 2');
  });

  it('_resolveShrewdScoundrel doubles only when the guess matches the current Damage', async () => {
    const ctx = deps();
    // Match: die shows 2 Damage, guess 2 → doubled to 4.
    const matched = { attackDiceResults: [{ color: 'red', acc: 1, dmg: 2, surge: 0 }], shrewdScoundrel: { pool: 'attack', index: 0, guess: 2 } };
    await _resolveShrewdScoundrel(matched, ctx, thread);
    assert.equal(matched.attackDiceResults[0].dmg, 4, 'matched guess doubles the die');
    assert.equal(matched.attackRoll.dmg, 4, 'totals recalculated');
    assert.equal(matched.shrewdScoundrel, undefined, 'consumed');

    // No match: die shows 1 Damage, guess 2 → unchanged.
    const missed = { attackDiceResults: [{ color: 'red', acc: 1, dmg: 1, surge: 0 }], shrewdScoundrel: { pool: 'attack', index: 0, guess: 2 } };
    await _resolveShrewdScoundrel(missed, ctx, thread);
    assert.equal(missed.attackDiceResults[0].dmg, 1, 'no match → unchanged');
  });
});

describe('Capitalize (CC): attacker rerolls ANY attack or defense die', () => {
  function combat() {
    return {
      attackerPlayerNum: 1, attackerFigureKey: 'Han Solo-1-0',
      attackDiceResults: [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }],
      defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
      _rerolledDieIds: new Set(),
    };
  }
  it('offers BOTH pools (unlike Battlefield Awareness, which is attack-only)', () => {
    const res = COMBAT_RESOLVERS.capitalize;
    assert.ok(res, 'Capitalize resolver registered');
    const p = res.prompt({ combat: combat() });
    const ids = p.buttons.map((b) => b[0]);
    assert.ok(ids.includes('a0'), 'offers an attack die');
    assert.ok(ids.includes('d0'), 'offers a defense die');
  });
  it('plays through the counter-window FIRST, then rerolls the chosen die (Negate/Comms before the reroll)', async () => {
    // alexanbv 2026-06-19: neg/comms first, THEN the reroll. apply() discards
    // Capitalize + opens the counter-window; with no opponent counter the window
    // auto-resolves and the 'reroll_cc' continuation performs the reroll.
    const c = combat();
    const game = { gameId: 'g1', pendingCombat: c, player1CcHand: ['Capitalize'], player1CcDiscard: [] };
    await COMBAT_RESOLVERS.capitalize.apply('d0', { game, combat: c, ctx: deps(), thread, side: 'attacker', id: 'capitalize', window: 'rerolls' });
    assert.ok((game.player1CcDiscard || []).includes('Capitalize'), 'Capitalize discarded (played) before the window');
    assert.ok(c._rerolledDieIds.has('defense:0'), 'defense die rerolled + locked once the (uncontested) window resolves');
  });
});

describe('Resourceful (Lando) staged resolver stores the Shrewd guess', () => {
  it('pick → Gambit keep → guess sets combat.shrewdScoundrel for the deferred double', async () => {
    const res = COMBAT_RESOLVERS['reroll:lando_calrissian:attacker'];
    assert.ok(res, 'Resourceful resolver registered');
    const ctx = deps();
    const combat = {
      attackerDcName: 'Lando Calrissian', attackerPlayerNum: 1, defenderPlayerNum: 2,
      attackDiceResults: [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }],
      defenseDiceResults: [{ color: 'white', block: 1, evade: 0, dodge: false }],
      _rerolledDieIds: new Set(),
    };
    const game = { activationAbilityUsed: {} };
    const a = { game, combat, ctx, thread, gameId: 'g', id: 'reroll:lando_calrissian:attacker' };
    // Lando has Gambit + Shrewd: pick attack die 0 → gambit stage
    let r = await res.apply('a0', a);
    assert.deepEqual(r, { followUp: true }, 'enters Gambit stage');
    // keep the color → shrewd guess stage
    r = await res.apply('keep', a);
    assert.deepEqual(r, { followUp: true }, 'enters Shrewd guess stage');
    // guess 1 → reroll + store
    await res.apply('g1', a);
    assert.deepEqual(combat.shrewdScoundrel, { pool: 'attack', index: 0, guess: 1 },
      'guess stored for the deferred end-of-step-3 double');
    assert.ok(combat._rerolledDieIds.has('attack:0'), 'the die was rerolled');
  });
});
