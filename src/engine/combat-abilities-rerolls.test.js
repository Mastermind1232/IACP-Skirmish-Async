import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesForWindow, getCombatAbility } from './combat-timing-registry.js';
import './combat-mods-gate.js'; // self-registers the data-driven reroll detection
import { markDieRerolled, dieId } from './combat-reroll-lock.js';
import { depletableCardMsgId } from './combat-abilities-rerolls.js';
import { depleteDc, isDcDepleted } from '../game/card-state-helpers.js';

// Cara Dune: an UNCONDITIONAL DC attacker reroll row in docs/combat-spec.csv →
// registered data-driven as reroll:cara_dune:attacker. As a DC self-ability its
// condition is attacker_is_self (the figure must be the one attacking).
const ID = 'reroll:cara_dune:attacker';
const combat = (attackerDcName) => ({ attackerPlayerNum: 1, attackerDcName, attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }] });
const atkIds = (game, c) => abilitiesForWindow('rerolls', 'attacker', game, c, {}).map((a) => a.id);

describe('rerolls gate: data-driven (CSV) reroll detection', () => {
  it('registers reroll abilities from the CSV with params derived from the row', () => {
    const reg = getCombatAbility(ID);
    assert.ok(reg, 'Cara Dune reroll should be registered from the CSV');
    assert.equal(reg.params?.kind, 'reroll');
    assert.equal(reg.params?.pool, 'attack');
  });

  it('offers a DC self-reroll only when that figure is the ATTACKER (not merely held)', () => {
    assert.ok(atkIds({}, combat('Cara Dune')).includes(ID), 'Cara Dune attacking → offered');
    assert.ok(!atkIds({}, combat('Greedo')).includes(ID), 'a different attacker → not offered (self/aura distinction)');
  });

  it('does NOT offer once the only die is locked (binary reroll flag)', () => {
    const c = combat('Cara Dune');
    markDieRerolled(c, dieId('attack', 0));
    assert.ok(!atkIds({}, c).includes(ID), 'locked die → not selectable → not offered');
  });
});

// FIX-1: AT-DP Charge Generators is SPLIT — the +1 Damage at mods, the REROLL in
// the rerolls window ('charge_generators_reroll'), both gated on suffered<9.
describe('rerolls gate: Charge Generators reroll half (FIX-1 split)', () => {
  const CG = 'charge_generators_reroll';
  const eff = { 'AT-DP': { specialAbilityIds: ['charge_generators'] } };
  const cgCombat = (overrides = {}) => ({
    attackerPlayerNum: 1, attackerDcName: 'AT-DP', attackerFigureKey: 'AT-DP-1-0', attackerMsgId: 'm', attackerFigureIndex: 0,
    attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }], ...overrides,
  });
  const cgDeps = (suffered) => ({ getDcEffects: () => eff, dcHealthState: new Map([['m', [[16 - suffered, 16]]]]) });

  it('reroll is OFFERED in the rerolls window while suffered<9', () => {
    const reg = getCombatAbility(CG);
    assert.ok(reg, 'charge_generators_reroll should be registered');
    assert.equal(reg.params?.kind, 'reroll');
    assert.equal(reg.params?.pool, 'attack');
    const list = abilitiesForWindow('rerolls', 'attacker', {}, cgCombat(), cgDeps(3)).map((a) => a.id);
    assert.ok(list.includes(CG), 'suffered 3 < 9 → reroll offered');
  });

  it('reroll is NOT offered at suffered>=9, nor once used this attack', () => {
    let list = abilitiesForWindow('rerolls', 'attacker', {}, cgCombat(), cgDeps(9)).map((a) => a.id);
    assert.ok(!list.includes(CG), 'suffered 9 → not offered');
    // Once the reroll half is used (its own limit key) → not re-offered.
    const cUsed = cgCombat({ _abilityUsedThisAttack: { 'AT-DP:Charge Generators (Reroll)': true } });
    list = abilitiesForWindow('rerolls', 'attacker', {}, cUsed, cgDeps(3)).map((a) => a.id);
    assert.ok(!list.includes(CG), 'reroll used this attack → not re-offered');
  });
});

// FIX 2 (alexanbv): Field Supply attacker-rerolls option — modeled on Ko-Tun's
// "Dead Precise" token-spend reroll, additionally gated on Field Supply being
// PLAYED at start of round. Offered iff (a) a Hit/Surge token was spent this
// attack AND (b) game.fieldSupplyPlayedRound[attackerPlayerNum]. STACKS with
// other reroll sources (additive — its own once-per-attack limit key).
describe('rerolls gate: Field Supply token-spend reroll (FIX 2)', () => {
  const FS = 'reroll:field_supply:attacker';
  const fsCombat = (overrides = {}) => ({
    attackerPlayerNum: 1, attackerDcName: 'Stormtrooper',
    attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }], ...overrides,
  });
  const ids = (game, c) => abilitiesForWindow('rerolls', 'attacker', game, c, {}).map((a) => a.id);

  it('is registered as an attacker attack-pool reroll', () => {
    const reg = getCombatAbility(FS);
    assert.ok(reg, 'Field Supply reroll should be registered');
    assert.equal(reg.params?.kind, 'reroll');
    assert.equal(reg.params?.pool, 'attack');
  });

  it('offered only when a Hit/Surge token was spent AND Field Supply was played this round', () => {
    const played = { fieldSupplyPlayedRound: { 1: true } };
    // (a) token spent + (b) played → offered.
    assert.ok(ids(played, fsCombat({ attackerSpentHitOrSurgeToken: true })).includes(FS),
      'token spent + played → offered');
    // No token spent → not offered.
    assert.ok(!ids(played, fsCombat({})).includes(FS), 'no token spent → not offered');
    // Token spent but NOT played this round → not offered.
    assert.ok(!ids({}, fsCombat({ attackerSpentHitOrSurgeToken: true })).includes(FS),
      'Field Supply not played → not offered');
  });

  it('STACKS additively — once-per-attack limit is independent of other rerolls', () => {
    const played = { fieldSupplyPlayedRound: { 1: true } };
    // Charge Generators is unrelated; both can be offered simultaneously, and using
    // Field Supply (its own limit key) doesn't block — only re-offering Field Supply.
    const used = fsCombat({ attackerSpentHitOrSurgeToken: true, _abilityUsedThisAttack: { 'Field Supply:Field Supply': true } });
    assert.ok(!ids(played, used).includes(FS), 'Field Supply used this attack → not re-offered');
    // A FRESH attack with the same flags → offered again (per-attack limit).
    assert.ok(ids(played, fsCombat({ attackerSpentHitOrSurgeToken: true })).includes(FS),
      'fresh attack → offered again');
  });
});

// Doubt ([Doubt] Upgrade) — the CSV row is attack_side='attacker' (the POOL is the
// attacker's dice), but Doubt is the DEFENDER's disruption upgrade with a DEPLETE
// cost. The data-driven loop must (1) register it DEFENDER-side / attack-pool, and
// (2) attach a deplete cost gated on isDcDepleted. alexanbv 2026-06-26 (audit fix).
describe('rerolls gate: Doubt — defender-side attack-pool reroll with a deplete cost', () => {
  const DOUBT = 'reroll:doubt:defender';
  const doubtGame = (extra = {}) => ({
    gameId: 'g', p1DcList: [], p1DcMessageIds: [],
    p2DcList: [{ dcName: '[Doubt]' }], p2DcMessageIds: ['mDoubt'], ...extra,
  });
  const doubtCombat = () => ({
    attackerPlayerNum: 1, defenderPlayerNum: 2,
    attackDiceResults: [{ color: 'blue', dmg: 0, surge: 0, acc: 1 }],
  });
  const defIds = (g, c) => abilitiesForWindow('rerolls', 'defender', g, c, {}).map((a) => a.id);

  it('registers DEFENDER-side, ATTACK pool, with a deplete cost (not attacker-side)', () => {
    const reg = getCombatAbility(DOUBT);
    assert.ok(reg, 'Doubt should register on the defender side as reroll:doubt:defender');
    assert.equal(reg.side, 'defender');
    assert.equal(reg.params?.pool, 'attack');
    assert.equal(reg.params?.depleteOnUse, 'Doubt');
    // It must NOT be registered attacker-side (the wrong-player bug).
    assert.ok(!getCombatAbility('reroll:doubt:attacker'), 'must NOT be registered attacker-side');
  });

  it('offered to the DEFENDER who owns Doubt, only while the card is NOT depleted', () => {
    assert.ok(defIds(doubtGame(), doubtCombat()).includes(DOUBT), 'held + ready → offered to defender');
    const depleted = doubtGame({ p2DepletedDcMessageIds: ['mDoubt'] });
    assert.ok(!defIds(depleted, doubtCombat()).includes(DOUBT), 'depleted → not offered');
  });

  it('depletableCardMsgId resolves the owner upgrade msgId for the deplete cost', () => {
    const game = doubtGame();
    const mid = depletableCardMsgId(game, 2, 'Doubt');
    assert.equal(mid, 'mDoubt');
    assert.equal(isDcDepleted(game, mid), false);
    depleteDc(game, mid, 2);
    assert.equal(isDcDepleted(game, mid), true);
  });
});
