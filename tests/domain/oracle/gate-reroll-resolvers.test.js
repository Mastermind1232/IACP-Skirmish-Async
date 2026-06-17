/**
 * Bespoke gate reroll resolvers (COMBAT_RESOLVERS) for abilities the generic
 * pick-one-die resolver can't express. alexanbv 2026-06-16.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_RESOLVERS } from '../../../src/handlers/combat.js';
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
