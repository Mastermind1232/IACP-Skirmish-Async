/**
 * Gate-path combat-ability fixes (alexanbv 2026-06-18). Verifies the player-owner
 * directed corrections to specific abilities now route through the live gate
 * machinery:
 *   FIX-1 Shock and Awe (Cara Dune) — on_declare PLAYER CHOICE, once per round.
 *   FIX-2 On a Diplomatic Mission — +1 Evade is round-scoped (NOT consumed).
 *   FIX-3 Charge Generators (AT-DP) — mods +1 Damage gated on suffered<9 + reroll.
 *   FIX-4 Trusted Ally — aura exhaust attachment exhausts the BEARER on use.
 *   FIX-5 Alliance Ranger Sniper — OPTIONAL (interactive) for Regular + Elite.
 *   FIX-6 Fyrnock Style (Tress) — attacker/defender rows are mutually exclusive.
 *   FIX-7 Lasat-Honor Guard (Zeb) — lives in the SPECIAL window, NOT rerolls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/engine/combat-abilities-rerolls.js';
import '../../../src/engine/combat-abilities-mods.js';
import '../../../src/engine/combat-abilities-ondeclare.js';
import '../../../src/engine/combat-abilities-special.js';
import { COMBAT_RESOLVERS } from '../../../src/handlers/combat.js';
import { getCombatAbility } from '../../../src/engine/combat-timing-registry.js';
import { markAbilityUsed } from '../../../src/engine/combat-conditions.js';
import { auraAttachmentBearerMsgId, isAttachmentExhausted, exhaustAttachment } from '../../../src/game/card-state-helpers.js';
import { cleanupRoundStart, ROUND_OBJECT_FLAGS, ACTIVATION_MSGID_FLAGS, ACTIVATION_FIGKEY_FLAGS, ACTIVATION_SCALAR_FLAGS } from '../../../src/game/activation-state.js';

const thread = { send: async () => ({}) };

// ── FIX-2: On a Diplomatic Mission — +1 Evade is round-scoped ─────────────────
describe('FIX-2 On a Diplomatic Mission +1 Evade persists to round end', () => {
  it('diplomaticMissionEvade is a ROUND-scoped object flag (cleared only at round start)', () => {
    // Round-scoped (not activation-scoped) → the +1 Evade buff survives every
    // attack until end of round, then is wiped at the next round start.
    assert.ok(ROUND_OBJECT_FLAGS.includes('diplomaticMissionEvade'), 'in ROUND_OBJECT_FLAGS');
    assert.ok(!ACTIVATION_MSGID_FLAGS.includes('diplomaticMissionEvade'), 'NOT activation-msgid-scoped');
    assert.ok(!ACTIVATION_FIGKEY_FLAGS.includes('diplomaticMissionEvade'), 'NOT activation-figkey-scoped');
    assert.ok(!ACTIVATION_SCALAR_FLAGS.includes('diplomaticMissionEvade'), 'NOT activation-scalar-scoped');
  });
  it('cleanupRoundStart resets the evade buff to {} (consumed at round boundary, not per attack)', () => {
    const game = { diplomaticMissionEvade: { msg123: true } };
    cleanupRoundStart(game);
    assert.deepEqual(game.diplomaticMissionEvade, {}, 'cleared at round start');
  });
});

// ── FIX-1: Shock and Awe — player choice, once per round ──────────────────────
describe('FIX-1 Shock and Awe (Cara Dune)', () => {
  it('is registered as an interactive on_declare ability with a once-per-round limit', () => {
    const a = getCombatAbility('shock_and_awe');
    assert.ok(a, 'registered');
    assert.deepEqual(a.windows, ['on_declare']);
    assert.equal(a.kind, 'interactive');
    assert.equal(a.side, 'attacker');
    assert.equal(a.params.limit, 'once per round');
  });

  it('applies only with a Yellow die in the pool and not yet used this round', () => {
    const a = getCombatAbility('shock_and_awe');
    const combat = { attackerFigureKey: 'Cara Dune-1-0', attackerDcName: 'Cara Dune', attackInfo: { dice: ['yellow', 'blue'] } };
    const game = { roundAbilityUsed: {} };
    assert.equal(a.applies(game, combat, 'attacker', {}), true, 'offered: has yellow, unused');
    // No yellow die → not offered.
    assert.equal(a.applies(game, { ...combat, attackInfo: { dice: ['blue'] } }, 'attacker', {}), false);
    // Mark used (once per round) → suppressed for the rest of the round.
    markAbilityUsed(game, combat, a.params);
    assert.equal(a.applies(game, combat, 'attacker', {}), false, 'suppressed within the same round');
    // A fresh round (cleared roundAbilityUsed) re-offers it.
    assert.equal(a.applies({ roundAbilityUsed: {} }, combat, 'attacker', {}), true, 'available next round');
  });

  it('resolver: use swaps 1 Yellow→Red; skip leaves the pool unchanged', async () => {
    const c = { attackInfo: { dice: ['yellow', 'blue', 'green'] } };
    await COMBAT_RESOLVERS.shock_and_awe.apply('use', { combat: c, thread });
    assert.deepEqual(c.attackInfo.dice, ['red', 'blue', 'green']);
    const c2 = { attackInfo: { dice: ['yellow', 'blue'] } };
    await COMBAT_RESOLVERS.shock_and_awe.apply('skip', { combat: c2, thread });
    assert.deepEqual(c2.attackInfo.dice, ['yellow', 'blue']);
  });
});

// ── FIX-1: Charge Generators — SPLIT: +1 Damage at MODS, reroll in REROLLS ─────
describe('FIX-1 Charge Generators (AT-DP) split across windows', () => {
  it('is registered as a mods interactive attacker ability (the +1 Damage half)', () => {
    const a = getCombatAbility('charge_generators');
    assert.ok(a);
    assert.deepEqual(a.windows, ['mods']);
    assert.equal(a.side, 'attacker');
    assert.equal(a.kind, 'interactive');
  });

  it('reroll half lives in the REROLLS window (charge_generators_reroll, pool=attack)', () => {
    const r = getCombatAbility('charge_generators_reroll');
    assert.ok(r, 'reroll half registered');
    assert.deepEqual(r.windows, ['rerolls']);
    assert.equal(r.side, 'attacker');
    assert.equal(r.params?.kind, 'reroll');
    assert.equal(r.params?.pool, 'attack');
  });

  it('applies only while the AT-DP has suffered fewer than 9 Damage', () => {
    const a = getCombatAbility('charge_generators');
    const combat = { attackerFigureKey: 'AT-DP-1-0', attackerDcName: 'AT-DP', attackerMsgId: 'm1', attackerFigureIndex: 0 };
    // suffered = max - current. [current, max].
    const suffered5 = { dcHealthState: new Map([['m1', [[15, 20]]]]) }; // suffered 5 (<9)
    assert.equal(a.applies({}, combat, 'attacker', suffered5), true);
    const suffered9 = { dcHealthState: new Map([['m1', [[11, 20]]]]) }; // suffered 9 (NOT <9)
    assert.equal(a.applies({}, combat, 'attacker', suffered9), false);
    const suffered12 = { dcHealthState: new Map([['m1', [[8, 20]]]]) }; // suffered 12
    assert.equal(a.applies({}, combat, 'attacker', suffered12), false);
  });

  it('mods resolver applies ONLY +1 Damage (the reroll moved to the rerolls window)', async () => {
    const c = {};
    const r = await COMBAT_RESOLVERS.charge_generators.apply(null, { combat: c, thread, ctx: {}, gameId: '1', id: 'charge_generators' });
    assert.equal(c.bonusHits, 1);
    assert.equal(r?.followUp, undefined);
    assert.equal(c._chargeGenStage, undefined, 'no reroll sub-stage anymore');
  });
});

// ── FIX-4: Trusted Ally — aura exhaust attachment exhausts the BEARER ──────────
describe('FIX-4 Trusted Ally aura exhaust', () => {
  it('registers with auraExhaustOnUse + auraRange (not the self-attachment exhaustOnUse)', () => {
    const a = getCombatAbility('reroll:trusted_ally:attacker');
    assert.ok(a);
    assert.equal(a.params.auraExhaustOnUse, 'Trusted Ally');
    assert.equal(a.params.auraRange, 3);
    assert.equal(a.params.exhaustOnUse, undefined, 'aura, not a self-attachment');
  });

  it('auraAttachmentBearerMsgId finds a ready within-3 bearer and skips an exhausted one', () => {
    const deps = {
      getMapData: () => ({}),
      isWithinSpaces: () => true, // pretend in range
      getDcList: (g, pn) => g[`p${pn}DcList`],
      getDcMessageIds: (g, pn) => g[`p${pn}DcMessageIds`],
    };
    const game = {
      selectedMap: { id: 'm' },
      figurePositions: { 1: { 'AT-DP-1-0': 'a1', 'R2-D2-2-0': 'b1' } },
      p1DcList: [{ dcName: 'AT-DP' }, { dcName: 'R2-D2' }],
      p1DcMessageIds: ['mAT', 'mR2'],
      p1DcAttachments: { mR2: [{ name: 'Trusted Ally' }] },
      exhaustedSkirmishUpgrades: {},
    };
    const combat = { attackerPlayerNum: 1, attackerFigureKey: 'AT-DP-1-0' };
    assert.equal(auraAttachmentBearerMsgId(game, combat, 'Trusted Ally', 3, deps, true), 'mR2', 'ready bearer found');
    exhaustAttachment(game, 'mR2', 'Trusted Ally');
    assert.equal(isAttachmentExhausted(game, 'mR2', 'Trusted Ally'), true);
    assert.equal(auraAttachmentBearerMsgId(game, combat, 'Trusted Ally', 3, deps, true), null, 'exhausted bearer not offered');
  });
});

// ── FIX-5: Alliance Ranger Sniper — OPTIONAL for Regular + Elite ───────────────
describe('FIX-5 Alliance Ranger Sniper is optional', () => {
  it('Regular Sniper and Elite Sniper are both interactive (player choice) rerolls', () => {
    const reg = getCombatAbility('reroll:alliance_ranger_regular:attacker');
    const eli = getCombatAbility('reroll:alliance_ranger_elite:attacker');
    assert.ok(reg && eli);
    assert.equal(reg.kind, 'interactive', 'Regular Sniper offered, not auto-applied');
    assert.equal(eli.kind, 'interactive', 'Elite Sniper offered, not auto-applied');
    assert.deepEqual(reg.windows, ['rerolls']);
    assert.deepEqual(eli.windows, ['rerolls']);
  });
});

// ── FIX-6: Fyrnock Style — attacker/defender rows mutually exclusive ───────────
describe('FIX-6 Fyrnock Style does not double-fire', () => {
  const fa = getCombatAbility('reroll:tress_hacnua:attacker');
  const fd = getCombatAbility('reroll:tress_hacnua:defender');
  const dice = [{ color: 'blue', acc: 1, dmg: 1, surge: 0 }];
  it('only the attacker-side row fires when Tress attacks', () => {
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Tress Hacnua-1-0', attackerDcName: 'Tress Hacnua', target: { figureKey: 'Stormtrooper-2-0' }, attackDiceResults: dice, _rerolledDieIds: new Set() };
    const game = { figurePositions: { 1: { 'Tress Hacnua-1-0': 'a1' }, 2: { 'Stormtrooper-2-0': 'b1' } }, p1Cards: ['Tress Hacnua'] };
    assert.equal(fa.applies(game, combat), true);
    assert.equal(fd.applies(game, combat), false);
  });
  it('only the defender-side row fires when Tress defends', () => {
    const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', attackerDcName: 'Stormtrooper', defenderDcName: 'Tress Hacnua', target: { figureKey: 'Tress Hacnua-2-0' }, attackDiceResults: dice, _rerolledDieIds: new Set() };
    const game = { figurePositions: { 1: { 'Stormtrooper-1-0': 'a1' }, 2: { 'Tress Hacnua-2-0': 'b1' } }, p2Cards: ['Tress Hacnua'] };
    assert.equal(fa.applies(game, combat), false);
    assert.equal(fd.applies(game, combat), true);
  });
});

// ── FIX-7: Lasat-Honor Guard (Zeb) — SPECIAL window, NOT rerolls ──────────────
describe('FIX-7 Lasat-Honor Guard is in the special window, not rerolls', () => {
  it('lasat_honor_guard is registered for the special window only', () => {
    const a = getCombatAbility('lasat_honor_guard');
    assert.ok(a);
    assert.deepEqual(a.windows, ['special']);
    assert.equal(a.side, 'attacker');
  });
  it('the CSV-driven rerolls loop does NOT also register a Zeb reroll button', () => {
    assert.equal(getCombatAbility('reroll:zeb_orrelios:attacker'), null, 'Zeb not double-binned in rerolls');
  });
});
