/**
 * Tests for src/game/abilities.js (F1 ability library). Run: node --test src/game/abilities.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import { getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility } from './abilities.js';

test('getAbility returns library entry for known surge id', () => {
  const entry = getAbility('damage 1');
  assert.ok(entry);
  assert.strictEqual(entry.type, 'surge');
  assert.strictEqual(entry.surgeCost, 1);
  assert.strictEqual(entry.label, '+1 Hit');
  assert.strictEqual(getAbility('stun').label, 'Stun');
});

test('getAbility returns null for unknown id', () => {
  assert.strictEqual(getAbility('unknown_key'), null);
});

test('F13: getAbility supports surgeCost > 1 (multi-surge)', () => {
  const entry = getAbility('damage 4');
  assert.ok(entry);
  assert.strictEqual(entry.surgeCost, 2);
  assert.strictEqual(entry.label, '+4 Hits');
  assert.strictEqual(resolveSurgeAbility('damage 4').damage, 4);
});

test('resolveSurgeAbility returns same shape as parseSurgeEffect', () => {
  const r = resolveSurgeAbility('damage 2');
  assert.strictEqual(r.damage, 2);
  assert.strictEqual(r.pierce, 0);
  assert.strictEqual(r.accuracy, 0);
  assert.deepStrictEqual(r.conditions, []);
  const r2 = resolveSurgeAbility('damage 1, stun');
  assert.strictEqual(r2.damage, 1);
  assert.deepStrictEqual(r2.conditions, ['Stun']);
});

test('getSurgeAbilityLabel uses library when present', () => {
  assert.strictEqual(getSurgeAbilityLabel('damage 1'), '+1 Hit');
  assert.strictEqual(getSurgeAbilityLabel('pierce 2'), 'Pierce 2');
});

test('getSurgeAbilityLabel returns id for unknown (composite or not in library)', () => {
  const label = getSurgeAbilityLabel('some composite key');
  assert.strictEqual(label, 'some composite key');
});

test('resolveAbility draw 1 (There is Another): mutates game, returns applied and drewCards', () => {
  const game = { player1CcDeck: ['A', 'B', 'C'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('There is Another', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['A']);
  assert.strictEqual(game.player1CcHand.length, 1);
  assert.strictEqual(game.player1CcHand[0], 'A');
  assert.strictEqual(game.player1CcDeck.length, 2);
});

test('resolveAbility draw 2 (Planning): draws two cards', () => {
  const game = { player1CcDeck: ['X', 'Y', 'Z'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('Planning', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['X', 'Y']);
  assert.strictEqual(game.player1CcHand.length, 2);
  assert.strictEqual(game.player1CcDeck.length, 1);
});

test('resolveAbility Planning with non-LEADER discards 1 of drawn', () => {
  const msgId = 'msg-plan';
  const game = {
    player1CcDeck: ['A', 'B', 'C'],
    player1CcHand: [],
    player2CcHand: [],
    gameId: 'g-plan',
    dcActionsData: { [msgId]: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-plan', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [DG 1]' }]]);
  const result = resolveAbility('Planning', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player1CcHand.length, 1);
  assert.strictEqual((game.player1CcDiscard || []).length, 1);
  assert.ok(result.logMessage?.includes('not LEADER'));
});

test('resolveAbility draw with empty deck: draws what is available', () => {
  const game = { player1CcDeck: ['Only'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('Planning', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['Only']);
  assert.strictEqual(game.player1CcDeck.length, 0);
});

test('resolveAbility returns manual for unimplemented ccEffect', () => {
  const result = resolveAbility('cc:adrenaline', { game: {}, playerNum: 1 });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage);
});

test('resolveAbility Fleet Footed without activation returns manual', () => {
  const game = { gameId: 'g1', dcActionsData: {}, movementBank: {} };
  const dcMessageMeta = new Map();
  const result = resolveAbility('cc:fleet_footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.includes('activation'));
});

test('resolveAbility Fleet Footed with active activation applies +1 MP', () => {
  const msgId = 'msg123';
  const game = {
    gameId: 'g1',
    dcActionsData: { [msgId]: { remaining: 1 } },
    movementBank: { [msgId]: { total: 4, remaining: 2 } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g1', playerNum: 1, dcName: 'Test', displayName: 'Test [DG 1]' }]]);
  const result = resolveAbility('cc:fleet_footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 1 movement point.');
  assert.strictEqual(game.movementBank[msgId].remaining, 3);
  assert.strictEqual(game.movementBank[msgId].total, 5);
});

test('resolveAbility Force Rush with active activation applies +2 MP', () => {
  const msgId = 'msg456';
  const game = {
    gameId: 'g2',
    dcActionsData: { [msgId]: { remaining: 1 } },
    movementBank: { [msgId]: { total: 4, remaining: 2 } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g2', playerNum: 2, dcName: 'Vader', displayName: 'Vader [DG 1]' }]]);
  const result = resolveAbility('Force Rush', { game, playerNum: 2, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 2 movement points.');
  assert.strictEqual(game.movementBank[msgId].remaining, 4);
  assert.strictEqual(game.movementBank[msgId].total, 6);
});

test('resolveAbility Urgency (Speed+2) with active activation applies MP', () => {
  const msgId = 'msg789';
  const game = {
    gameId: 'g3',
    dcActionsData: { [msgId]: { remaining: 1 } },
    movementBank: { [msgId]: { total: 4, remaining: 2 } },
  };
  // Luke Skywalker has speed 5 in dc-stats → 5+2=7 MP
  const dcMessageMeta = new Map([[msgId, { gameId: 'g3', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [DG 1]' }]]);
  const result = resolveAbility('Urgency', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 7 movement points.');
  assert.strictEqual(game.movementBank[msgId].remaining, 9);
  assert.strictEqual(game.movementBank[msgId].total, 11);
});

test("resolveAbility Officer's Training with LEADER (during attack) draws 1", () => {
  const game = { player1CcDeck: ['X', 'Y'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, attackerDcName: 'Darth Vader' };
  const result = resolveAbility("Officer's Training", { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.drewCards?.length, 1);
  assert.strictEqual(game.player1CcHand.length, 1);
});

test("resolveAbility Officer's Training without LEADER (during attack) does not draw", () => {
  const game = { player1CcDeck: ['X', 'Y'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, attackerDcName: 'Nexu (Regular)' };
  const result = resolveAbility("Officer's Training", { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.drewCards?.length ?? 0, 0);
  assert.strictEqual(game.player1CcHand.length, 0);
});

test("resolveAbility Fool Me Once clears opponent discard and draws 1 if SPY", () => {
  const msgId = 'msg-spy';
  const game = {
    player1CcDeck: ['A'],
    player2CcDeck: [],
    player1CcHand: [],
    player2CcHand: [],
    player2CcDiscard: ['X', 'Y'],
    gameId: 'g4',
    dcActionsData: { [msgId]: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g4', playerNum: 1, dcName: 'Agent Blaise', displayName: 'Agent Blaise [DG 1]' }]]);
  const result = resolveAbility('Fool Me Once', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player2CcDiscard.length, 0);
  assert.strictEqual(result.drewCards?.length, 1);
  assert.strictEqual(game.player1CcHand.length, 1);
});

test('resolveAbility Battle Scars with active activation gains 1 Power Token', () => {
  const msgId = 'msg-pt';
  const game = {
    gameId: 'g5',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Wookiee Warrior (Elite)-1-0': 'a1' }, 2: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Wookiee Warrior (Elite)', healthState: [[7, 8]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g5', playerNum: 1, dcName: 'Wookiee Warrior (Elite)', displayName: 'Wookiee [DG 1]' }]]);
  const result = resolveAbility('Battle Scars', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 1 Power Token.');
  assert.deepStrictEqual(game.figurePowerTokens['Wookiee Warrior (Elite)-1-0'], ['Wild']);
});

test('resolveAbility Battle Scars with 3+ damage gains 2 Power Tokens', () => {
  const msgId = 'msg-pt2';
  const game = {
    gameId: 'g6',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Wookiee Warrior (Regular)-1-0': 'b2' }, 2: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Wookiee Warrior (Regular)', healthState: [[4, 8]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g6', playerNum: 1, dcName: 'Wookiee Warrior (Regular)', displayName: 'Wookiee [DG 1]' }]]);
  const result = resolveAbility('Battle Scars', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 2 Power Tokens.');
  assert.deepStrictEqual(game.figurePowerTokens['Wookiee Warrior (Regular)-1-0'], ['Wild', 'Wild']);
});

test('resolveAbility Against the Odds when VP condition met applies Focus to all figures', () => {
  const game = {
    gameId: 'g7',
    player1VP: { total: 2 },
    player2VP: { total: 12 },
    figurePositions: { 1: { 'Luke-1-0': 'a1', 'Trooper-1-0': 'a2' }, 2: {} },
  };
  const result = resolveAbility('cc:against_the_odds', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.figureConditions['Luke-1-0']?.includes('Focus'), true);
  assert.strictEqual(game.figureConditions['Trooper-1-0']?.includes('Focus'), true);
});

test('resolveAbility Against the Odds when VP condition not met does nothing', () => {
  const game = {
    gameId: 'g8',
    player1VP: { total: 8 },
    player2VP: { total: 10 },
    figurePositions: { 1: { 'Luke-1-0': 'a1' }, 2: {} },
  };
  const result = resolveAbility('cc:against_the_odds', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.ok(!game.figureConditions || !game.figureConditions['Luke-1-0']?.includes('Focus'));
});

test('resolveAbility Blitz during attack adds surgeBonus', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g9' };
  const game = { gameId: 'g9', pendingCombat: combat };
  const result = resolveAbility('Blitz', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.surgeBonus, 1);
});

test('resolveAbility Positioning Advantage adds bonusHits to combat', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g9b' };
  const game = { gameId: 'g9b', pendingCombat: combat };
  const result = resolveAbility('Positioning Advantage', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.bonusHits, 1);
});

test('resolveAbility Deadeye adds bonusAccuracy to combat', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g9c' };
  const game = { gameId: 'g9c', pendingCombat: combat };
  const result = resolveAbility('Deadeye', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.bonusAccuracy, 2);
});

test('resolveAbility Blitz during surge step adds to surgeRemaining', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g10', surgeRemaining: 2 };
  const game = { gameId: 'g10', pendingCombat: combat };
  const result = resolveAbility('Blitz', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.surgeRemaining, 3);
});

test('resolveAbility Advance Warning (cc:advance_warning) with active activation applies +2 MP', () => {
  const msgId = 'msg-aw';
  const game = {
    gameId: 'g-aw',
    dcActionsData: { [msgId]: {} },
    movementBank: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-aw', playerNum: 1, dcName: 'C-3PO', displayName: 'C-3PO [DG 1]' }]]);
  const result = resolveAbility('cc:advance_warning', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 2 movement points.');
});

test('resolveAbility Rally discards HARMFUL conditions from activating figures', () => {
  const msgId = 'msg-rally';
  const game = {
    gameId: 'g-rally',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Stormtroopers-1-0': 'a1', 'Stormtroopers-1-1': 'a2' } },
    figureConditions: {
      'Stormtroopers-1-0': ['Stun', 'Focus'],
      'Stormtroopers-1-1': ['Weaken'],
    },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rally', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [DG 1]' }]]);
  const result = resolveAbility('Rally', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.figureConditions['Stormtroopers-1-0'], ['Focus']);
  assert.strictEqual(game.figureConditions['Stormtroopers-1-1']?.length, 0);
});

test('resolveAbility Primary Target applies Focus and attackBonusHits', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-pt' };
  const game = {
    gameId: 'g-pt',
    dcActionsData: { 'msg-pt': {} },
    pendingCombat: combat,
    figurePositions: { 1: { 'Boba Fett-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([['msg-pt', { gameId: 'g-pt', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba [DG 1]' }]]);
  const result = resolveAbility('Primary Target', { game, playerNum: 1, combat, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Hit'));
  assert.strictEqual(combat.bonusHits, 1);
  assert.strictEqual(game.figureConditions['Boba Fett-1-0']?.includes('Focus'), true);
});

test('resolveAbility Master Operative applies Focus and attackSurgeBonus', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-mo' };
  const game = {
    gameId: 'g-mo',
    dcActionsData: { 'msg-mo': {} },
    pendingCombat: combat,
    figurePositions: { 1: { 'Verena Talos-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([['msg-mo', { gameId: 'g-mo', playerNum: 1, dcName: 'Verena Talos', displayName: 'Verena [DG 1]' }]]);
  const result = resolveAbility('Master Operative', { game, playerNum: 1, combat, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Surge'));
  assert.strictEqual(combat.surgeBonus, 1);
  assert.strictEqual(game.figureConditions['Verena Talos-1-0']?.includes('Focus'), true);
});

test('resolveAbility Meditation applies Focus (same as Focus)', () => {
  const msgId = 'msg-med';
  const game = {
    gameId: 'g-med',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Luke Skywalker-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-med', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [DG 1]' }]]);
  const result = resolveAbility('Meditation', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Became Focused.');
  assert.strictEqual(game.figureConditions['Luke Skywalker-1-0']?.includes('Focus'), true);
});

test('resolveAbility Recovery recovers 2 damage when dcHealthState and msgId provided', () => {
  const msgId = 'msg-rec';
  const healthState = [[3, 6]];
  const dcHealthState = new Map([[msgId, healthState]]);
  const game = {
    gameId: 'g-rec',
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[3, 6]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rec', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [DG 1]' }]]);
  const result = resolveAbility('Recovery', { game, playerNum: 1, dcMessageMeta, dcHealthState, msgId });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Recovered 2 Damage.');
  assert.deepStrictEqual(healthState[0], [5, 6]);
  assert.deepStrictEqual(game.p1DcList[0].healthState[0], [5, 6]);
});

test('resolveAbility Heart of Freedom applies discard 1 HARMFUL, recover 2, gain 2 MP', () => {
  const msgId = 'msg-hof';
  const healthState = [[4, 6]];
  const dcHealthState = new Map([[msgId, healthState]]);
  const game = {
    gameId: 'g-hof',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Luke Skywalker-1-0': 'a1' } },
    figureConditions: { 'Luke Skywalker-1-0': ['Stun', 'Focus'] },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[4, 6]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-hof', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [DG 1]' }]]);
  const result = resolveAbility('Heart of Freedom', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('Damage'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Luke Skywalker-1-0'], ['Focus']);
  assert.deepStrictEqual(healthState[0], [6, 6]);
  assert.strictEqual(game.movementBank[msgId]?.remaining, 2);
});

test('resolveAbility Price of Glory applies discard 1 HARMFUL and gain 2 MP', () => {
  const msgId = 'msg-pog';
  const game = {
    gameId: 'g-pog',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Stormtroopers-1-0': 'a1' } },
    figureConditions: { 'Stormtroopers-1-0': ['Weaken'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-pog', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [DG 1]' }]]);
  const result = resolveAbility('Price of Glory', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Stormtroopers-1-0'], []);
  assert.strictEqual(game.movementBank[msgId]?.remaining, 2);
});

test('resolveAbility Worth Every Credit applies discard 1 HARMFUL and gain 2 MP', () => {
  const msgId = 'msg-wec';
  const game = {
    gameId: 'g-wec',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Bossk-1-0': 'a1' } },
    figureConditions: { 'Bossk-1-0': ['Bleed'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-wec', playerNum: 1, dcName: 'Bossk', displayName: 'Bossk [DG 1]' }]]);
  const result = resolveAbility('Worth Every Credit', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Bossk-1-0'], []);
  assert.strictEqual(game.movementBank[msgId]?.remaining, 2);
});

test('resolveAbility Apex Predator applies Focus, Hide, 2 Power Tokens, 2 MP', () => {
  const msgId = 'msg-apex';
  const game = {
    gameId: 'g-apex',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Nexu-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-apex', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [DG 1]' }]]);
  const result = resolveAbility('Apex Predator', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Focused'));
  assert.ok(result.logMessage?.includes('Hidden'));
  assert.ok(result.logMessage?.includes('Power Token'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.strictEqual(game.figureConditions['Nexu-1-0']?.includes('Focus'), true);
  assert.strictEqual(game.figureConditions['Nexu-1-0']?.includes('Hide'), true);
  assert.strictEqual(game.figurePowerTokens['Nexu-1-0']?.length, 2);
  assert.strictEqual(game.movementBank[msgId]?.remaining, 2);
});

test('resolveAbility Tools for the Job adds 1 attack die when declaring attack', () => {
  const combat = {
    attackerPlayerNum: 1,
    attackInfo: { dice: ['red', 'blue'], range: [1, 3] },
  };
  const game = { gameId: 'g-tfj', pendingCombat: combat };
  const result = resolveAbility('Tools for the Job', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('attack die'));
  assert.strictEqual(combat.attackBonusDice, 1);
});

test('resolveAbility Brace Yourself applies +2 Block when not attacker activation', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerMsgId: 'msg-attacker',
    target: { figureKey: 'Wookiee-2-0', label: 'Wookiee [DG 1]' },
  };
  const game = { gameId: 'g-by', pendingCombat: combat };
  const result = resolveAbility('Brace Yourself', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Block'));
  assert.strictEqual(combat.bonusBlock, 2);
});

test('resolveAbility Brace for Impact adds 1 black die to defense pool', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    target: { figureKey: 'Stormtroopers-2-0' },
  };
  const game = { gameId: 'g-bfi', pendingCombat: combat };
  const result = resolveAbility('Brace for Impact', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.toLowerCase().includes('black'));
  assert.deepStrictEqual(combat.defenseBonusDice, ['black']);
});

test('resolveAbility Brace Yourself returns manual when attacker is activating', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerMsgId: 'msg-attacker',
    target: { figureKey: 'Wookiee-2-0' },
  };
  const game = { gameId: 'g-by2', pendingCombat: combat, dcActionsData: { 'msg-attacker': {} } };
  const result = resolveAbility('Brace Yourself', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.includes("attacker's activation"));
});

test('resolveAbility Camouflage applies Hide to defender when attack declared on them', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    target: { figureKey: 'Stormtroopers-2-0', label: 'Stormtroopers [DG 1]' },
  };
  const game = {
    gameId: 'g-cam',
    pendingCombat: combat,
    figureConditions: {},
  };
  const result = resolveAbility('Camouflage', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Became Hidden.');
  assert.strictEqual(game.figureConditions['Stormtroopers-2-0']?.includes('Hide'), true);
});

test('resolveAbility Rally with no harmful conditions returns applied', () => {
  const msgId = 'msg-rally2';
  const game = {
    gameId: 'g-rally2',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Darth Vader-1-0': 'a1' } },
    figureConditions: { 'Darth Vader-1-0': ['Focus'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rally2', playerNum: 1, dcName: 'Darth Vader', displayName: 'Vader [DG 1]' }]]);
  const result = resolveAbility('Rally', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.figureConditions['Darth Vader-1-0'], ['Focus']);
});

test('resolveAbility Size Advantage sets nextAttacksBonusHits and nextAttacksBonusConditions', () => {
  const msgId = 'msg-sa';
  const game = {
    gameId: 'g-sa',
    dcActionsData: { [msgId]: {} },
    nextAttacksBonusHits: {},
    nextAttacksBonusConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-sa', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [DG 1]' }]]);
  const result = resolveAbility('Size Advantage', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.nextAttacksBonusHits[1], { count: 1, bonus: 2 });
  assert.deepStrictEqual(game.nextAttacksBonusConditions[1], { count: 1, conditions: ['Weaken'] });
});

test('resolveAbility Maximum Firepower sets nextAttacksBonusHits', () => {
  const msgId = 'msg-mfp';
  const game = {
    gameId: 'g11',
    dcActionsData: { [msgId]: {} },
    nextAttacksBonusHits: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g11', playerNum: 2, dcName: 'Heavy Troopers', displayName: 'Heavy [DG 1]' }]]);
  const result = resolveAbility('Maximum Firepower', { game, playerNum: 2, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.nextAttacksBonusHits[2], { count: 1, bonus: 4 });
});
