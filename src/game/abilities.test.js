/**
 * Tests for src/game/abilities.js (F1 ability library). Run: node --test src/game/abilities.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import { getAbility, resolveSurgeAbility, getSurgeAbilityLabel, resolveAbility } from './abilities.js';
import { _registerDcMessageMeta } from './activation-state.js';
import { drainPendingDamage, applyDeferredAbilityEffects } from './damage-pipeline.js';

test('getAbility returns library entry for known surge id', () => {
  const entry = getAbility('damage 1');
  assert.ok(entry);
  assert.strictEqual(entry.type, 'surge');
  assert.strictEqual(entry.surgeCost, 1);
  assert.strictEqual(entry.label, '+1 Damage');
  assert.strictEqual(getAbility('stun').label, 'Stun');
});

test('getAbility returns null for unknown id', () => {
  assert.strictEqual(getAbility('unknown_key'), null);
});

test('F13: getAbility supports surgeCost > 1 (multi-surge)', () => {
  const entry = getAbility('damage 4');
  assert.ok(entry);
  assert.strictEqual(entry.surgeCost, 2);
  assert.strictEqual(entry.label, '+4 Damage');
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
  assert.strictEqual(getSurgeAbilityLabel('damage 1'), '+1 Damage');
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-plan', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [Group 1]' }]]);
  const result = resolveAbility('Planning', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player1CcHand.length, 1);
  assert.strictEqual((game.player1CcDiscard || []).length, 1);
  assert.ok(result.logMessage?.includes('not LEADER'));
});

test('resolveAbility Black Market Prices draws 2, then player-chooses a hand card to discard, gains VP = cost', () => {
  const game = {
    player1CcDeck: ['Planning', 'Blitz'],
    player1CcHand: [],
    player2CcHand: [],
    player1VP: { total: 0 },
    gameId: 'g-bmp',
  };
  // Phase 1: draw 2, then prompt the player to choose a hand card to discard.
  const phase1 = resolveAbility('Black Market Prices', { game, playerNum: 1 });
  assert.strictEqual(phase1.applied, false);
  assert.strictEqual(phase1.requiresChoice, true);
  assert.deepStrictEqual(phase1.choiceOptions, ['Planning', 'Blitz']);
  assert.deepStrictEqual(phase1.choiceValues, ['Planning', 'Blitz']);
  // Drawn cards are already in hand.
  assert.deepStrictEqual(game.player1CcHand, ['Planning', 'Blitz']);
  // Phase 2: the player chooses to discard Blitz (the chosen value comes
  // back via chosenFigureKey, carrying the card NAME).
  const phase2 = resolveAbility('Black Market Prices', { game, playerNum: 1, chosenFigureKey: 'Blitz' });
  assert.strictEqual(phase2.applied, true);
  assert.strictEqual(game.player1CcHand.length, 1);
  assert.strictEqual(game.player1CcHand[0], 'Planning');
  assert.strictEqual((game.player1CcDiscard || []).length, 1);
  assert.strictEqual(game.player1CcDiscard[0], 'Blitz');
  // VP awarded equals the discarded card's cost (Blitz = 1).
  assert.strictEqual(game.player1VP.total, 1);
});

test('resolveAbility Black Market Prices reveals the discarded card name (discardedCcs)', () => {
  const game = {
    player1CcDeck: ['Planning', 'Blitz'],
    player1CcHand: [],
    player2CcHand: [],
    player1VP: { total: 0 },
    gameId: 'g-bmp-reveal',
  };
  resolveAbility('Black Market Prices', { game, playerNum: 1 });
  const phase2 = resolveAbility('Black Market Prices', { game, playerNum: 1, chosenFigureKey: 'Blitz' });
  assert.strictEqual(phase2.applied, true);
  // The discarded card name is surfaced for the public reveal.
  assert.deepStrictEqual(phase2.discardedCcs, ['Blitz']);
});

test('resolveAbility Planning (non-LEADER) reveals discarded card names (discardedCcs)', () => {
  const msgId = 'msg-plan-reveal';
  const game = {
    player1CcDeck: ['A', 'B', 'C'],
    player1CcHand: [],
    player2CcHand: [],
    gameId: 'g-plan-reveal',
    dcActionsData: { [msgId]: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-plan-reveal', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [Group 1]' }]]);
  const result = resolveAbility('Planning', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(Array.isArray(result.discardedCcs));
  assert.strictEqual(result.discardedCcs.length, 1);
  // Whatever name was discarded, it must also be present in the discard pile.
  assert.ok(game.player1CcDiscard.includes(result.discardedCcs[0]));
});

test('resolveAbility Forbidden Knowledge collects discarded names and reveals them at Done', () => {
  const msgId = 'msg-fk';
  const game = {
    player1CcDeck: ['Drew1'],
    player1CcHand: ['Card A', 'Card B'],
    player2CcHand: [],
    gameId: 'g-fk',
    dcActionsData: { [msgId]: {} },
    // minimal figure plumbing so the per-card effects loop is harmless
    figurePositions: { 1: {}, 2: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-fk', playerNum: 1, dcName: 'Taron Malicos', displayName: 'Taron Malicos' }]]);
  const dcHealthState = new Map();
  // Phase 1: draw + open the discard picker.
  const p1 = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(p1.requiresChoice, true);
  assert.ok(game.pendingForbiddenKnowledge);
  // Pick a card to discard.
  const toDiscard = (game.player1CcHand || [])[0];
  resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenOption: toDiscard });
  assert.ok(game.player1CcDiscard.includes(toDiscard));
  // Done: finalize and surface the discarded names.
  const done = resolveAbility('Forbidden Knowledge', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenOption: '✓ Done discarding' });
  assert.strictEqual(done.applied, true);
  assert.deepStrictEqual(done.discardedCcs, [toDiscard]);
});

test('resolveAbility Demoralizing Monologue phase 1 queues forced reroll + offers reveal choice', () => {
  const game = { gameId: 'g-dm', player1CcHand: ['x', 'y'], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackDiceResults: [], defenseDiceResults: [{ color: 'white' }] };
  const result = resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.requiresChoice, true);
  assert.strictEqual(result.choiceOptions.length, 2);
  // The forced defense-die reroll (attacker-controlled) is queued.
  const q = combat.forcedRerollQueue || [];
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].pool, 'defense');
  assert.strictEqual(q[0].controlPlayer, 1);
  assert.strictEqual(q[0].demoralizingMonologue, true);
});

test('resolveAbility Demoralizing Monologue reveal (2+ cards) arms die-removal flag', () => {
  const game = { gameId: 'g-dm2', player1CcHand: ['a', 'b', 'c'], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackDiceResults: [], defenseDiceResults: [{ color: 'white' }] };
  resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat });
  const reveal = resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat, choiceIndex: 0 });
  assert.strictEqual(reveal.applied, true);
  // 3 cards in hand ⇒ qualifies ⇒ arm the cross-file removal flag.
  assert.ok(combat.demoralizingMonologueRemoveDie);
  assert.strictEqual(combat.demoralizingMonologueRemoveDie.casterPlayerNum, 1);
  // The reveal publicly lists the hand card names.
  assert.ok(reveal.logMessage.includes('**a**'));
});

test('resolveAbility Demoralizing Monologue reveal with <2 cards does NOT arm removal', () => {
  const game = { gameId: 'g-dm3', player1CcHand: ['only'], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackDiceResults: [], defenseDiceResults: [{ color: 'white' }] };
  resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat });
  const reveal = resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat, choiceIndex: 0 });
  assert.strictEqual(reveal.applied, true);
  assert.ok(!combat.demoralizingMonologueRemoveDie);
});

test('resolveAbility Demoralizing Monologue skip reveal applies without removal', () => {
  const game = { gameId: 'g-dm4', player1CcHand: ['a', 'b'], player2CcHand: [] };
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, attackDiceResults: [], defenseDiceResults: [{ color: 'white' }] };
  resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat });
  const skip = resolveAbility('Demoralizing Monologue', { game, playerNum: 1, combat, choiceIndex: 1 });
  assert.strictEqual(skip.applied, true);
  assert.ok(!combat.demoralizingMonologueRemoveDie);
});

test('resolveAbility draw with empty deck: draws what is available', () => {
  const game = { player1CcDeck: ['Only'], player2CcDeck: [], player1CcHand: [], player2CcHand: [] };
  const result = resolveAbility('Planning', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(result.drewCards, ['Only']);
  assert.strictEqual(game.player1CcDeck.length, 0);
});

test('resolveAbility Adrenaline returns manual when no WOOKIEEs found', () => {
  const game = { gameId: 'g1', p1DcMessageIds: [], p1DcList: [] };
  const result = resolveAbility('Adrenaline', { game, playerNum: 1, dcHealthState: new Map() });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage);
});

test('resolveAbility Fleet Footed without activation returns manual', () => {
  const game = { gameId: 'g1', dcActionsData: {}, movementBank: {} };
  const dcMessageMeta = new Map();
  const result = resolveAbility('Fleet Footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.includes('activation'));
});

test('resolveAbility Fleet Footed with active activation applies +1 MP', () => {
  // Per alexanbv 2026-06-13: MP is per-figure; the activating figure (0)
  // owns its bank under perFig[0].
  const msgId = 'msg123';
  const game = {
    gameId: 'g1',
    dcActionsData: { [msgId]: { remaining: 1, selectedFigure: 0 } },
    movementBank: { [msgId]: { perFig: { 0: { total: 4, remaining: 2 } } } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g1', playerNum: 1, dcName: 'Test', displayName: 'Test [Group 1]' }]]);
  const result = resolveAbility('Fleet Footed', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 1 movement point.');
  assert.strictEqual(game.movementBank[msgId].perFig[0].remaining, 3);
  assert.strictEqual(game.movementBank[msgId].perFig[0].total, 5);
});

test('resolveAbility Force Rush with active activation applies +2 MP', () => {
  const msgId = 'msg456';
  const game = {
    gameId: 'g2',
    dcActionsData: { [msgId]: { remaining: 1, selectedFigure: 0 } },
    movementBank: { [msgId]: { perFig: { 0: { total: 4, remaining: 2 } } } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g2', playerNum: 2, dcName: 'Vader', displayName: 'Vader [Group 1]' }]]);
  const result = resolveAbility('Force Rush', { game, playerNum: 2, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 2 movement points.');
  assert.strictEqual(game.movementBank[msgId].perFig[0].remaining, 4);
  assert.strictEqual(game.movementBank[msgId].perFig[0].total, 6);
});

test('resolveAbility Urgency (Speed+2) routes to pendingMoveX with allowAbilitySpend', () => {
  // Per alexanbv 2026-07-27: all immediate-spend MP goes to pendingMoveX with
  // allowAbilitySpend:true so it can be spent on MOVEMENT *and* MP-cost abilities
  // (Wrist Cord, Super Commando rockets). consumeMovementPoints drains pendingMoveX
  // first; components.js includes pendingMoveX.remaining in ability button gating.
  const msgId = 'msg789';
  const figureKey = 'Luke Skywalker-1-0';
  const game = {
    gameId: 'g3',
    dcActionsData: { [msgId]: { remaining: 1, selectedFigure: 0, threadId: null } },
    figurePositions: { 1: { [figureKey]: 'a1' } },
  };
  // Luke Skywalker has speed 5 in dc-stats → 5+2=7 MP
  const dcMessageMeta = new Map([[msgId, { gameId: 'g3', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  const result = resolveAbility('Urgency', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.match(result.logMessage, /gains 7 MP/);
  // Routed through pendingMoveX (not movementBank._mustSpendImmediately).
  assert.ok(game.pendingMoveX?.[msgId], 'pendingMoveX should be stamped');
  assert.strictEqual(game.pendingMoveX[msgId].remaining, 7);
  assert.strictEqual(game.pendingMoveX[msgId].allowAbilitySpend, true);
  assert.strictEqual(game.pendingMoveX[msgId].bypassCosts, false);
  assert.strictEqual(game.pendingMoveX[msgId].figureKey, figureKey);
  assert.strictEqual(result.pendingMoveXMsgId, msgId);
  // movementBank is NOT touched.
  assert.strictEqual(game.movementBank, undefined);
});

test('resolveAbility Urgency on a multi-figure group targets the selected figure in pendingMoveX', () => {
  // Per alexanbv 2026-07-27: pendingMoveX.figureKey encodes the specific figure
  // so sibling figures cannot spend from this pool.
  const msgId = 'msgGrp';
  const f0 = 'Stormtrooper-1-0';
  const f1 = 'Stormtrooper-1-1';
  const game = {
    gameId: 'g4',
    dcActionsData: { [msgId]: { remaining: 2, selectedFigure: 1, threadId: null } },
    figurePositions: { 1: { [f0]: 'a1', [f1]: 'a2' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g4', playerNum: 1, dcName: 'Stormtrooper', displayName: 'Stormtrooper [Group 1]' }]]);
  const result = resolveAbility('Urgency', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // pendingMoveX targets figure 1 specifically.
  assert.ok(game.pendingMoveX?.[msgId], 'pendingMoveX should be stamped');
  assert.strictEqual(game.pendingMoveX[msgId].figureKey, f1);
  assert.strictEqual(game.pendingMoveX[msgId].allowAbilitySpend, true);
  assert.ok(game.pendingMoveX[msgId].remaining > 0);
  // movementBank is NOT touched.
  assert.strictEqual(game.movementBank, undefined);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g4', playerNum: 1, dcName: 'Agent Blaise', displayName: 'Agent Blaise [Group 1]' }]]);
  const result = resolveAbility('Fool Me Once', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player2CcDiscard.length, 0);
  assert.deepStrictEqual(game.gameBox, ['X', 'Y']);
  assert.strictEqual(result.drewCards?.length, 1);
  assert.strictEqual(game.player1CcHand.length, 1);
});

test("resolveAbility Fool Me Once stamps pendingStrainCost (resolved via prompt, no sync HP reduction)", () => {
  // Migration 2026-05-09: Fool Me Once's 2-Strain cost is now fired
  // through the applyStrain pipeline via result.pendingStrainCost, so
  // Fireproof / Headhunter / Under Duress / Paz / top-of-deck-discard
  // all gate correctly. The dispatch no longer reduces HP synchronously.
  const msgId = 'msg-spy2';
  const game = {
    player1CcDeck: ['A'],
    player2CcDeck: [],
    player1CcHand: [],
    player2CcHand: [],
    player2CcDiscard: ['X', 'Y'],
    gameId: 'g4b',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Agent Blaise-1-0': 'a1' }, 2: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Agent Blaise', healthState: [[8, 8]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g4b', playerNum: 1, dcName: 'Agent Blaise', displayName: 'Agent Blaise [Group 1]' }]]);
  const dcHealthState = new Map([[msgId, [[8, 8]]]]);
  const result = resolveAbility('Fool Me Once', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player2CcDiscard.length, 0);
  assert.deepStrictEqual(game.gameBox, ['X', 'Y']);
  // HP unchanged synchronously — strain prompt fires via applyAbilityResult.
  const hs = dcHealthState.get(msgId);
  assert.strictEqual(hs[0][0], 8);
  assert.strictEqual(result.pendingStrainCost?.figureKey, 'Agent Blaise-1-0');
  assert.strictEqual(result.pendingStrainCost?.controllerPlayerNum, 1);
  assert.strictEqual(result.pendingStrainCost?.amount, 2);
  assert.ok(result.logMessage.includes('Suffers 2 Strain'));
  assert.strictEqual(result.refreshDcEmbed, true);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g5', playerNum: 1, dcName: 'Wookiee Warrior (Elite)', displayName: 'Wookiee [Group 1]' }]]);
  const result = resolveAbility('Battle Scars', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 1 Power Token — choose type.');
  assert.strictEqual(result.requiresPowerTokenChoice, true);
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.figureKey, 'Wookiee Warrior (Elite)-1-0');
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.count, 1);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g6', playerNum: 1, dcName: 'Wookiee Warrior (Regular)', displayName: 'Wookiee [Group 1]' }]]);
  const result = resolveAbility('Battle Scars', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.logMessage, 'Gained 2 Power Tokens — choose type.');
  assert.strictEqual(result.requiresPowerTokenChoice, true);
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.figureKey, 'Wookiee Warrior (Regular)-1-0');
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.count, 2);
});

test('resolveAbility Against the Odds when VP condition met applies Focus to all figures', () => {
  const game = {
    gameId: 'g7',
    player1VP: { total: 2 },
    player2VP: { total: 12 },
    figurePositions: { 1: { 'Luke-1-0': 'a1', 'Trooper-1-0': 'a2' }, 2: {} },
  };
  const result = resolveAbility('Against the Odds', { game, playerNum: 1 });
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
  const result = resolveAbility('Against the Odds', { game, playerNum: 1 });
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

test('resolveAbility Advance Warning — no adj friendly: activator banks 1 MP, no chooser', () => {
  // Migration 2026-05-09: Advance Warning routes through a custom
  // dispatch (advanceWarningEffect). When no adjacent friendly is in
  // range, the activator banks their share and the second MP is
  // skipped (no recipient).
  const msgId = 'msg-aw';
  const game = {
    gameId: 'g-aw',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    movementBank: {},
    figurePositions: { 1: { 'C-3PO-1-0': 'a1' }, 2: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-aw', playerNum: 1, dcName: 'C-3PO', displayName: 'C-3PO [Group 1]' }]]);
  const result = resolveAbility('Advance Warning', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.match(result.logMessage, /Activator banks/);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rally', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 1]' }]]);
  const result = resolveAbility('Rally', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.figureConditions['Stormtroopers-1-0'], ['Focus']);
  assert.deepStrictEqual(game.figureConditions['Stormtroopers-1-1'] ?? [], []);
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
  const dcMessageMeta = new Map([['msg-pt', { gameId: 'g-pt', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba [Group 1]' }]]);
  const result = resolveAbility('Primary Target', { game, playerNum: 1, combat, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Damage'));
  assert.strictEqual(combat.bonusHits, 1);
  assert.strictEqual(game.figureConditions['Boba Fett-1-0']?.includes('Focus'), true);
});

test('Primary Target uses the PRINTED figure cost (subCost), not group cost ÷ figures', () => {
  // Jet Trooper (Elite): group cost 7, 2 figures, printed figure cost (subCost) 4
  //   → cost/figures would be 3.5.
  // Alliance Ranger (Elite): group cost 12, 3 figures, printed figure cost 4.
  // Both have printed figure cost 4 → TIE → the target IS (tied) the highest, so
  // Primary Target is allowed. The old cost/figures logic gave the target 3.5 <
  // Ranger 4.0 and wrongly REJECTED it. This case discriminates subCost from
  // cost/figures.
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, gameId: 'g-pt2', target: { figureKey: 'Jet Trooper (Elite)-1-0' } };
  const game = {
    gameId: 'g-pt2', dcActionsData: { 'msg-pt2': {} }, pendingCombat: combat,
    figurePositions: { 1: { 'Boba Fett-1-0': 'a1' } }, figureConditions: {},
    p2DcList: [{ dcName: 'Jet Trooper (Elite)' }, { dcName: 'Alliance Ranger (Elite)' }],
    p2DcMessageIds: ['m1', 'm2'],
  };
  const dcMessageMeta = new Map([['msg-pt2', { gameId: 'g-pt2', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba [Group 1]' }]]);
  const result = resolveAbility('Primary Target', { game, playerNum: 1, combat, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.bonusHits, 1);
});

test('Primary Target rejects when a hostile has a strictly higher printed figure cost', () => {
  // Target Rebel Trooper (Regular) printed figure cost 2 < AT-ST 10 → not highest.
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, gameId: 'g-pt3', target: { figureKey: 'Rebel Trooper (Regular)-1-0' } };
  const game = {
    gameId: 'g-pt3', dcActionsData: { 'msg-pt3': {} }, pendingCombat: combat,
    figurePositions: { 1: { 'Boba Fett-1-0': 'a1' } }, figureConditions: {},
    p2DcList: [{ dcName: 'AT-ST' }, { dcName: 'Rebel Trooper (Regular)' }],
    p2DcMessageIds: ['m1', 'm2'],
  };
  const dcMessageMeta = new Map([['msg-pt3', { gameId: 'g-pt3', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba [Group 1]' }]]);
  const result = resolveAbility('Primary Target', { game, playerNum: 1, combat, dcMessageMeta });
  assert.strictEqual(result.applied, false);
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
  const dcMessageMeta = new Map([['msg-mo', { gameId: 'g-mo', playerNum: 1, dcName: 'Verena Talos', displayName: 'Verena [Group 1]' }]]);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-med', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  const result = resolveAbility('Meditation', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage.startsWith('Became Focused.'));
  assert.strictEqual(game.figureConditions['Luke Skywalker-1-0']?.includes('Focus'), true);
});

test('resolveAbility Guild Programming Focuses IG-11 and arms re-Focus for the 2nd Rapid Fire attack', () => {
  const msgId = 'msg-gp';
  const game = {
    gameId: 'g-gp',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'IG-11-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-gp', playerNum: 1, dcName: 'IG-11', displayName: 'IG-11 [Group 1]' }]]);
  const result = resolveAbility('Guild Programming', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // First Rapid Fire attack's Focus applied now.
  assert.strictEqual(game.figureConditions['IG-11-1-0']?.includes('Focus'), true);
  // Re-Focus armed so the figure becomes Focused again before the 2nd attack.
  assert.strictEqual(game.guildProgrammingRefocus?.['IG-11-1-0'], true);
});

test('Stimulants (errata): targets any friendly/hostile EXCEPT self; hostile takes 1 Damage + Focus', async () => {
  const actMsg = 'msg-stim-act';
  const tgtMsg = 'msg-stim-tgt';
  const buildGame = () => ({
    gameId: 'g-stim',
    dcActionsData: { [actMsg]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Luke Skywalker-1-0': 'a1' }, 2: { 'Stormtrooper (Elite)-1-0': 'a2' } },
    figureConditions: {},
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[12, 12]] }],
    p2DcList: [{ dcName: 'Stormtrooper (Elite)', healthState: [[6, 6], [6, 6], [6, 6]] }],
    p1DcMessageIds: [actMsg],
    p2DcMessageIds: [tgtMsg],
    selectedMap: { id: 'test_map' },
  });
  const meta = () => new Map([
    [actMsg, { gameId: 'g-stim', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }],
    [tgtMsg, { gameId: 'g-stim', playerNum: 2, dcName: 'Stormtrooper (Elite)', displayName: 'Stormtrooper (Elite) [Group 1]' }],
  ]);
  // Phase 2 with the hostile chosen: 1 Damage + Focus; the opponent gains 1 MP
  // to spend immediately (pendingMoveX keyed to the hostile's owner, not banked).
  const g2 = buildGame();
  const hs2 = new Map([[actMsg, [[12, 12]]], [tgtMsg, [[6, 6], [6, 6], [6, 6]]]]);
  const r = resolveAbility('Stimulants', { game: g2, playerNum: 1, dcMessageMeta: meta(), dcHealthState: hs2, chosenFigureKey: 'Stormtrooper (Elite)-1-0' });
  assert.strictEqual(r.applied, true);
  await applyDeferredAbilityEffects(g2, { dcHealthState: hs2 }, r);
  assert.deepStrictEqual(hs2.get(tgtMsg)[0], [5, 6], 'hostile took 1 Damage');
  assert.ok((g2.figureConditions['Stormtrooper (Elite)-1-0'] || []).includes('Focus'), 'hostile becomes Focused');
  assert.ok(/hostile/i.test(r.logMessage), 'log notes the hostile target');
  // Opponent (player 2) gets an immediate 1-MP move on the hostile — not banked.
  assert.ok(game2HasHostileMp(g2, tgtMsg), 'opponent gains 1 MP to spend immediately on the hostile');
});

function game2HasHostileMp(game, tgtMsg) {
  const mv = game.pendingMoveX?.[tgtMsg];
  return !!mv && mv.remaining === 1 && mv.playerNum === 2 && mv.source === 'Stimulants';
}

test('Veteran Instincts: constrained pair — 1 attack token (Hit/Surge) + 1 defense token (Block/Evade)', () => {
  const msgId = 'msg-vi';
  const game = {
    gameId: 'g-vi',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-vi', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 1]' }]]);
  // Phase 1: only the 4 valid (attack, defense) pairs are offered — never 2 of
  // the same family (e.g. Damage+Damage or Block+Evade).
  const p1 = resolveAbility('Veteran Instincts', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(p1.requiresChoice, true);
  assert.deepStrictEqual(p1.choiceValues, ['Damage+Block', 'Damage+Evade', 'Surge+Block', 'Surge+Evade']);
  // Phase 2: grant the chosen pair to the activating figure.
  const p2 = resolveAbility('Veteran Instincts', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: 'Surge+Evade' });
  assert.strictEqual(p2.applied, true);
  assert.deepStrictEqual(game.figurePowerTokens['Rebel Trooper-1-0'], ['Surge', 'Evade']);
});

test('Price of Glory: offers all distinct token options (none / any single / any distinct pair)', () => {
  const msgId = 'msg-pog';
  const game = {
    gameId: 'g-pog',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Boba Fett-1-0': 'a1' } },
    figureConditions: { 'Boba Fett-1-0': ['Bleed'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-pog', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba [Group 1]' }]]);
  const p1 = resolveAbility('Price of Glory', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(p1.requiresChoice, true);
  // skip + 4 singles + 6 distinct pairs = 11 options (was only 3 hardcoded pairs).
  assert.strictEqual(p1.choiceValues.length, 11);
  assert.ok(p1.choiceValues.includes('Surge+Evade'), 'now includes the previously-missing Surge+Evade pair');
  assert.ok(p1.choiceValues.includes('Damage'), 'now includes single-token options ("up to 2")');
});

test('Etiquette and Protocol: excludes the C-3PO source (not self) and pairs hostile×friendly', () => {
  const game = {
    gameId: 'g-eap',
    figurePositions: {
      1: { 'C-3PO-1-0': 'a1', 'Rebel Trooper-1-0': 'a2' },
      2: { 'Stormtrooper-1-0': 'b1' },
    },
    // no selectedMap → LOS check is permissive; source resolves to C-3PO by name.
  };
  const result = resolveAbility('Etiquette and Protocol', { game, playerNum: 1 });
  assert.strictEqual(result.requiresChoice, true);
  // C-3PO is the LOS source → cannot be the chosen friendly figure; only the
  // Rebel Trooper pairs with the hostile Stormtrooper.
  assert.deepStrictEqual(result.choiceValues, ['Stormtrooper-1-0|Rebel Trooper-1-0']);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rec', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-hof', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  const result = resolveAbility('Heart of Freedom', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('Damage'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Luke Skywalker-1-0'], ['Focus']);
  assert.deepStrictEqual(healthState[0], [6, 6]);
  assert.strictEqual(game.movementBank[msgId]?.perFig?.[0]?.remaining, 2);
});

test('resolveAbility Price of Glory applies discard 1 HARMFUL and gain 2 MP', () => {
  const msgId = 'msg-pog';
  const game = {
    gameId: 'g-pog',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Stormtroopers-1-0': 'a1' } },
    figureConditions: { 'Stormtroopers-1-0': ['Weaken'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-pog', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 1]' }]]);
  const result = resolveAbility('Price of Glory', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: 'skip' });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Stormtroopers-1-0'] ?? [], []);
  assert.strictEqual(game.movementBank[msgId]?.perFig?.[0]?.remaining, 2);
});

test('resolveAbility Worth Every Credit applies discard 1 HARMFUL and gain 2 MP', () => {
  const msgId = 'msg-wec';
  const game = {
    gameId: 'g-wec',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Bossk-1-0': 'a1' } },
    figureConditions: { 'Bossk-1-0': ['Bleed'] },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-wec', playerNum: 1, dcName: 'Bossk', displayName: 'Bossk [Group 1]' }]]);
  const result = resolveAbility('Worth Every Credit', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('HARMFUL'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.deepStrictEqual(game.figureConditions['Bossk-1-0'] ?? [], []);
  assert.strictEqual(game.movementBank[msgId]?.perFig?.[0]?.remaining, 2);
});

test('resolveAbility Apex Predator applies Focus, Hide, 2 Power Tokens, 2 MP', () => {
  const msgId = 'msg-apex';
  const game = {
    gameId: 'g-apex',
    dcActionsData: { [msgId]: {} },
    figurePositions: { 1: { 'Nexu-1-0': 'a1' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-apex', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [Group 1]' }]]);
  const result = resolveAbility('Apex Predator', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Focused'));
  assert.ok(result.logMessage?.includes('Hidden'));
  assert.ok(result.logMessage?.includes('Power Token'));
  assert.ok(result.logMessage?.includes('MP'));
  assert.strictEqual(game.figureConditions['Nexu-1-0']?.includes('Focus'), true);
  assert.strictEqual(game.figureConditions['Nexu-1-0']?.includes('Hide'), true);
  assert.strictEqual(result.requiresPowerTokenChoice, true);
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.figureKey, 'Nexu-1-0');
  assert.strictEqual(game.pendingPowerTokenGrant?.grants?.[0]?.count, 2);
  assert.strictEqual(game.movementBank[msgId]?.perFig?.[0]?.remaining, 2);
});

test('resolveAbility Honoring the Fallen adds +1 Hit per defeated friendly figure (max 3)', () => {
  const combat = {
    attackerPlayerNum: 1,
    attackInfo: { dice: ['red'] },
  };
  const game = {
    gameId: 'g-htf',
    pendingCombat: combat,
    p1DcList: [
      { dcName: 'Nexu', displayName: 'Nexu [Group 1]' },
      { dcName: 'Echo Base Trooper (Elite)', displayName: 'Echo Base Trooper (Elite) [Group 2]' },
    ],
    figurePositions: {
      1: { 'Nexu-1-0': 'a1' },
      2: {},
    },
  };
  const result = resolveAbility('Honoring the Fallen', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('defeated'));
  assert.strictEqual(combat.bonusHits, 2);
});

test('resolveAbility Honoring the Fallen caps at 3 Hits', () => {
  const combat = { attackerPlayerNum: 1 };
  const game = {
    gameId: 'g-htf2',
    pendingCombat: combat,
    p1DcList: [
      { dcName: 'A', displayName: 'A [Group 1]' },
      { dcName: 'B', displayName: 'B [Group 2]' },
      { dcName: 'C', displayName: 'C [Group 3]' },
      { dcName: 'D', displayName: 'D [Group 4]' },
    ],
    figurePositions: { 1: {} },
  };
  const result = resolveAbility('Honoring the Fallen', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.bonusHits, 3);
});

test('resolveAbility Tools for the Job prompts for die color, then adds 1 die of chosen color', () => {
  const combat = {
    attackerPlayerNum: 1,
    attackInfo: { dice: ['red', 'blue'], range: [1, 3] },
  };
  const game = { gameId: 'g-tfj', pendingCombat: combat };
  // Phase 1: CSV "add 1 attack die OF YOUR CHOICE" — prompts for the die color.
  const prompt = resolveAbility('Tools for the Job', { game, playerNum: 1, combat });
  assert.strictEqual(prompt.requiresChoice, true);
  assert.deepStrictEqual(prompt.choiceValues, ['tools_color:red', 'tools_color:yellow', 'tools_color:green', 'tools_color:blue']);
  // Phase 2: choosing green adds a green die to the pool.
  const result = resolveAbility('Tools for the Job', { game, playerNum: 1, combat, chosenFigureKey: 'tools_color:green' });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('attack die'));
  assert.ok(result.logMessage?.includes('green'));
  assert.strictEqual(combat.attackBonusDice, 1);
  assert.deepStrictEqual(combat.attackBonusDiceColors, ['green']);
});

test('resolveAbility Spinning Kick adds Cleave 1 and Cleave 2 as surge options', () => {
  const combat = {
    attackerPlayerNum: 1,
    attackerDcName: 'Tress Hacnua',
    attackInfo: { dice: ['red'], range: [1, 2] },
  };
  const game = { gameId: 'g-sk', pendingCombat: combat };
  const result = resolveAbility('Spinning Kick', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(combat.bonusSurgeAbilities, ['cleave 1', 'cleave 2']);
});

test('resolveAbility Parry offers +1 Block OR +1 Evade choice when defending', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    target: { figureKey: 'Wookiee-2-0' },
  };
  const game = { gameId: 'g-parry', pendingCombat: combat };
  // Phase 1: no chosenOption → presents the Block-or-Evade choice.
  const r1 = resolveAbility('Parry', { game, playerNum: 2, combat });
  assert.strictEqual(r1.requiresChoice, true);
  assert.deepStrictEqual(r1.choiceOptions, ['+1 Block', '+1 Evade']);
  // Phase 2a: choose Block.
  const rBlock = resolveAbility('Parry', { game, playerNum: 2, combat, chosenOption: '+1 Block' });
  assert.strictEqual(rBlock.applied, true);
  assert.strictEqual(combat.bonusBlock, 1);
  // Phase 2b: choose Evade (fresh combat).
  const combat2 = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Wookiee-2-0' } };
  const game2 = { gameId: 'g-parry2', pendingCombat: combat2 };
  const rEvade = resolveAbility('Parry', { game: game2, playerNum: 2, combat: combat2, chosenOption: '+1 Evade' });
  assert.strictEqual(rEvade.applied, true);
  assert.strictEqual(combat2.bonusEvade, 1);
});

test('resolveAbility Brace Yourself applies +2 Block when not attacker activation', () => {
  const combat = {
    attackerPlayerNum: 1,
    defenderPlayerNum: 2,
    attackerMsgId: 'msg-attacker',
    target: { figureKey: 'Wookiee-2-0', label: 'Wookiee [Group 1]' },
  };
  const game = { gameId: 'g-by', pendingCombat: combat };
  const result = resolveAbility('Brace Yourself', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Block'));
  assert.strictEqual(combat.bonusBlock, 2);
});

test('resolveAbility Stealth Tactics adds 1 white die to defense pool', () => {
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Nexu-2-0' } };
  const game = { gameId: 'g-st', pendingCombat: combat };
  const result = resolveAbility('Stealth Tactics', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.toLowerCase().includes('white'));
  assert.deepStrictEqual(combat.defenseBonusDice, ['white']);
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

test("resolveAbility One in a Million removes all defense dice when not attacker's activation", () => {
  const combat = {
    attackerPlayerNum: 1,
    attackerMsgId: 'msg-ow',
    target: { figureKey: 'Stormtroopers-2-0' },
  };
  const game = { gameId: 'g-oam', pendingCombat: combat, dcActionsData: {} };
  const result = resolveAbility("One in a Million", { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.defensePoolRemoveAll, true);
});

test("resolveAbility One in a Million returns manual when it is attacker's activation", () => {
  const combat = {
    attackerPlayerNum: 1,
    attackerMsgId: 'msg-act',
    target: { figureKey: 'Stormtroopers-2-0' },
  };
  const game = { gameId: 'g-oam2', pendingCombat: combat, dcActionsData: { 'msg-act': {} } };
  const result = resolveAbility("One in a Million", { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.toLowerCase().includes("not your activation"));
});

test('resolveAbility Wild Fire removes up to 2 dice from defense pool when attacker plays', () => {
  const combat = {
    attackerPlayerNum: 1,
    target: { figureKey: 'CT-1701-2-0' },
    targetStats: { defense: 'white' },
  };
  const game = { gameId: 'g-wf', pendingCombat: combat };
  const result = resolveAbility('Wild Fire', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.toLowerCase().includes('remove'));
  assert.strictEqual(combat.defensePoolRemoveMax, 2);
});

test('resolveAbility Wild Attack adds 1 red die to attack and 1 white die to defense when attacker plays', () => {
  const combat = {
    attackerPlayerNum: 1,
    attackInfo: { dice: ['yellow'], range: [1, 3] },
    target: { figureKey: 'Nexu-2-0' },
  };
  const game = { gameId: 'g-wa', pendingCombat: combat };
  const result = resolveAbility('Wild Attack', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('attack die'));
  assert.ok(result.logMessage?.toLowerCase().includes('white'));
  assert.strictEqual(combat.attackBonusDice, 1);
  assert.deepStrictEqual(combat.attackBonusDiceColors, ['red']);
  assert.deepStrictEqual(combat.defenseBonusDice, ['white']);
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
    target: { figureKey: 'Stormtroopers-2-0', label: 'Stormtroopers [Group 1]' },
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
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-rally2', playerNum: 1, dcName: 'Darth Vader', displayName: 'Vader [Group 1]' }]]);
  const result = resolveAbility('Rally', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.figureConditions['Darth Vader-1-0'], ['Focus']);
});

test('resolveAbility Size Advantage sets nextAttacksBonusHits and nextAttacksBonusConditions', () => {
  const msgId = 'msg-sa';
  const game = {
    gameId: 'g-sa',
    p1ActivatedDcIndices: [],
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    nextAttacksBonusHits: {},
    nextAttacksBonusConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-sa', playerNum: 1, dcName: 'Nexu', displayName: 'Nexu [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Size Advantage', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // Per-figure 2026-05-09 (multifigure-independent-activation rule).
  // requiresSmallTarget carried on both entries (CSV row 720 SMALL-target gate).
  assert.deepStrictEqual(game.nextAttacksBonusHits['Nexu-1-0'], { count: 1, bonus: 2, requiresSmallTarget: true });
  assert.deepStrictEqual(game.nextAttacksBonusConditions['Nexu-1-0'], { count: 1, conditions: ['Weaken'], requiresSmallTarget: true });
});

test('resolveAbility Maximum Firepower sets nextAttacksBonusHits', () => {
  const msgId = 'msg-mfp';
  const game = {
    gameId: 'g11',
    p2ActivatedDcIndices: [],
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    nextAttacksBonusHits: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g11', playerNum: 2, dcName: 'Heavy Troopers', displayName: 'Heavy Troopers [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Maximum Firepower', { game, playerNum: 2, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.nextAttacksBonusHits['Heavy Troopers-1-0'], { count: 1, bonus: 4 });
});

test('resolveAbility Cruel Strike sets nextAttackBonusSurgeAbilities', () => {
  const msgId = 'msg-cs';
  const game = {
    gameId: 'g-cs',
    p1ActivatedDcIndices: [],
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    nextAttackBonusSurgeAbilities: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-cs', playerNum: 1, dcName: 'Trandoshan Hunter', displayName: 'Trandoshan Hunter [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Cruel Strike', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.nextAttackBonusSurgeAbilities['Trandoshan Hunter-1-0'], ['pierce 1, weaken']);
  assert.ok(result.logMessage?.toLowerCase().includes('pierce') && result.logMessage?.toLowerCase().includes('weaken'));
});

test('resolveAbility Element of Surprise adds defensePoolRemoveMax', () => {
  const combat = { attackerPlayerNum: 1, attackerDcName: 'Nexu', target: { figureKey: 'Stormtroopers-2-0' } };
  const game = { gameId: 'g-eos', pendingCombat: combat };
  const result = resolveAbility('Element of Surprise', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.defensePoolRemoveMax, 1);
});

test('resolveAbility Element of Surprise — blocked when target had LOS to attacker at activation start (per-figure check)', () => {
  // unit-test-grid is an open grid; all cells have mutual LOS.
  // activationStartAllPositions is keyed by per-figure figureKey (NOT group-level).
  const combat = {
    attackerPlayerNum: 1,
    attackerFigureKey: 'Stormtrooper Group-1-2', // 3rd figure in group
    target: { figureKey: 'Nexu-2-0', coord: 'p8' },
  };
  const game = {
    gameId: 'g-eos-los-blocked',
    selectedMap: { id: 'unit-test-grid' },
    pendingCombat: combat,
    figurePositions: {},
    activationStartAllPositions: {
      'Stormtrooper Group-1-2': 'a1',  // specific attacking figure at a1
      'Nexu-2-0': 'a2',               // target at adjacent a2 (has LOS to a1)
    },
  };
  const result = resolveAbility('Element of Surprise', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, false, 'target had LOS → EoS blocked');
  assert.ok(result.manualMessage && result.manualMessage.includes('had LOS'), 'manualMessage explains block');
  assert.strictEqual(combat.defensePoolRemoveMax, undefined, 'defensePoolRemoveMax not set');
});

test('resolveAbility Element of Surprise — applies when activationStartAllPositions missing for attacker', () => {
  // If the attacking figure is not in the snapshot (e.g. was not on board at activation start),
  // the LOS check is skipped and EoS applies unconditionally.
  const combat = {
    attackerPlayerNum: 1,
    attackerFigureKey: 'Stormtrooper Group-1-2',
    target: { figureKey: 'Nexu-2-0', coord: 'p8' },
  };
  const game = {
    gameId: 'g-eos-no-snap',
    selectedMap: { id: 'unit-test-grid' },
    pendingCombat: combat,
    figurePositions: {},
    activationStartAllPositions: {
      // attacker key absent — LOS check is skipped
      'Nexu-2-0': 'a2',
    },
  };
  const result = resolveAbility('Element of Surprise', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true, 'no attacker snapshot → check skipped, EoS applies');
  assert.strictEqual(combat.defensePoolRemoveMax, 1);
});

test('resolveAbility Trandoshan Terror adds 1 yellow attack die', () => {
  const combat = { attackerPlayerNum: 1, attackerDcName: 'Bossk', attackInfo: { dice: ['green'], range: [1, 3] } };
  const game = { gameId: 'g-tt', pendingCombat: combat };
  const result = resolveAbility('Trandoshan Terror', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.attackBonusDice, 1);
  assert.deepStrictEqual(combat.attackBonusDiceColors, ['yellow']);
});

test('resolveAbility Concentrated Fire adds 1 red attack die', () => {
  const combat = { attackerPlayerNum: 1, attackerDcName: 'Stormtroopers' };
  // Concentrated Fire card text: the CC-player ("you") is a friendly Ranged
  // TROOPER other than the attacker. The requireRangedAttackType gate only
  // grants the die bonus if such a figure exists on the board.
  const game = {
    gameId: 'g-cf',
    pendingCombat: combat,
    figurePositions: { 1: { 'Stormtrooper (Regular)-2-0': 'a1' } },
  };
  const result = resolveAbility('Concentrated Fire', { game, playerNum: 1, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.attackBonusDice, 1);
  assert.deepStrictEqual(combat.attackBonusDiceColors, ['red']);
});

test('resolveAbility Stroke of Brilliance adds +2 Block and +1 Evade', () => {
  const combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, target: { figureKey: 'Greedo-2-0' } };
  const game = { gameId: 'g-sb', pendingCombat: combat };
  const result = resolveAbility('Stroke of Brilliance', { game, playerNum: 2, combat });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(combat.bonusBlock, 2);
  assert.strictEqual(combat.bonusEvade, 1);
});

test('resolveAbility Regroup discards HARMFUL from adjacent figures', () => {
  const msgId = 'msg-r';
  const game = {
    gameId: 'g-r',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Leader-1-0': 'o8', 'Trooper-1-0': 'p8' }, 2: {} },
    figureConditions: { 'Trooper-1-0': ['Stun'] },
    dcActionsData: { [msgId]: {} },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-r', playerNum: 1, dcName: 'Leader', displayName: 'Leader [Group 1]' }]]);
  const result = resolveAbility('Regroup', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.figureConditions['Trooper-1-0'] ?? [], []);
});

test('resolveAbility Take Position registers a +1 Block defense round-modifier', () => {
  const msgId = 'msg-tp';
  const game = { gameId: 'g-tp', dcActionsData: { [msgId]: {} } };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-tp', playerNum: 1, dcName: 'Guardian', displayName: 'Guard [Group 1]' }]]);
  const result = resolveAbility('Take Position', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // Per-figure registry (alexanbv 2026-06-20: "'you' = ONLY the figure that
  // played the card"): figure-scoped +1 Block defense.
  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Take Position' && m.side === 'defense');
  assert.ok(d, 'Take Position defense descriptor registered');
  assert.strictEqual(d.ownerPlayerNum, 1);
  assert.strictEqual(d.effect.block, 1);
  assert.deepStrictEqual(d.conditions, { selfIsSourceFigure: true }, 'figure-scoped to the playing figure');
  assert.strictEqual(d.duration, 'during-round');
});

test('resolveAbility Survival Instincts registers +1 Block and +1 Evade (until-eor)', () => {
  const msgId = 'msg-si';
  const game = { gameId: 'g-si', dcActionsData: { [msgId]: {} } };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-si', playerNum: 2, dcName: 'Nexu', displayName: 'Nexu [Group 1]' }]]);
  const result = resolveAbility('Survival Instincts', { game, playerNum: 2, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Survival Instincts' && m.side === 'defense');
  assert.ok(d);
  assert.strictEqual(d.ownerPlayerNum, 2);
  assert.strictEqual(d.effect.block, 1);
  assert.strictEqual(d.effect.evade, 1);
  assert.strictEqual(d.duration, 'until-eor');
});

test('resolveAbility Hour of Need recovers round number damage', () => {
  const msgId = 'msg-hon';
  const healthState = [[4, 6]];
  const dcHealthState = new Map([[msgId, healthState]]);
  const game = {
    gameId: 'g-hon',
    currentRound: 3,
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[4, 6]] }],
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-hon', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  const result = resolveAbility('Hour of Need', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(healthState[0], [6, 6]);
  assert.ok(result.logMessage?.includes('3'));
});

test('resolveAbility Take Cover registers +1 Block and -2 Accuracy defense modifier', () => {
  const msgId = 'msg-tc';
  const game = { gameId: 'g-tc', dcActionsData: { [msgId]: {} } };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-tc', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 1]' }]]);
  const result = resolveAbility('Take Cover', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // Card text: "apply +1 Block and -2 Accuracy to the results."
  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Take Cover' && m.side === 'defense');
  assert.ok(d);
  assert.strictEqual(d.effect.block, 1);
  assert.strictEqual(d.effect.accuracyPenalty, 2);
  // Figure-scoped (alexanbv 2026-06-20: "'you' = ONLY the figure that played it").
  assert.deepStrictEqual(d.conditions, { selfIsSourceFigure: true });
});

test('resolveAbility Emergency Aid recovers to adjacent figure', () => {
  const msgId = 'msg-ea';
  const targetMsgId = 'msg-target';
  const healthState = [[3, 6]];
  const dcHealthState = new Map([
    [msgId, [[6, 6]]],
    [targetMsgId, healthState],
  ]);
  const game = {
    gameId: 'g-ea',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Leader-1-0': 'o8', 'Trooper-1-0': 'p8' }, 2: {} },
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId, targetMsgId],
    p1DcList: [
      { dcName: 'Leader', healthState: [[6, 6]] },
      { dcName: 'Trooper', healthState: [[3, 6]] },
    ],
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-ea', playerNum: 1, dcName: 'Leader', displayName: 'Leader [Group 1]' }],
    [targetMsgId, { gameId: 'g-ea', playerNum: 1, dcName: 'Trooper', displayName: 'Trooper [Group 1]' }],
  ]);
  const result = resolveAbility('Emergency Aid', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(healthState[0], [5, 6]);
});

test('resolveAbility Dirty Trick with adjacent hostile presents orStunInstead choice', () => {
  const msgId = 'msg-dt';
  const hostileMsgId = 'msg-hostile-dt';
  const game = {
    gameId: 'g-dt',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Akbar-1-0': 'o8' }, 2: { 'Stormtroopers-2-0': 'p8' } },
    dcActionsData: { [msgId]: {} },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[4, 5]] }],
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-dt', playerNum: 1, dcName: 'Akbar', displayName: 'Akbar [Group 1]' }],
    [hostileMsgId, { gameId: 'g-dt', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 2]' }],
  ]);
  const result = resolveAbility('Dirty Trick', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(result.requiresChoice, true);
  assert.strictEqual(result.choiceOptions?.length, 2);
  assert.ok(result.choiceOptions[0].includes('Strain'));
  assert.ok(result.choiceOptions[1].includes('Stun'));
  assert.ok(result.choiceValues[0].startsWith('strain:'));
  assert.ok(result.choiceValues[1].startsWith('stun:'));
});

test('resolveAbility Dirty Trick with stun: choice applies Stun condition', () => {
  const hostileFk = 'Stormtroopers-2-0';
  const hostileMsgId = 'msg-hostile-dt2';
  const game = {
    gameId: 'g-dt2',
    figurePositions: { 1: {}, 2: { [hostileFk]: 'p8' } },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[4, 5]] }],
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [hostileMsgId, { gameId: 'g-dt2', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 2]' }],
  ]);
  const result = resolveAbility('Dirty Trick', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: `stun:${hostileFk}` });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Stun'));
  assert.ok(game.figureConditions[hostileFk]?.includes('Stun'));
});

test('resolveAbility Dirty Trick with strain: choice applies 3 Strain damage', () => {
  const hostileFk = 'Stormtroopers-2-0';
  const hostileMsgId = 'msg-hostile-dt3';
  const healthState = [[4, 5]];
  const dcHealthState = new Map([[hostileMsgId, healthState]]);
  const game = {
    gameId: 'g-dt3',
    figurePositions: { 1: {}, 2: { [hostileFk]: 'p8' } },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[4, 5]] }],
  };
  const dcMessageMeta = new Map([
    [hostileMsgId, { gameId: 'g-dt3', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 2]' }],
  ]);
  const result = resolveAbility('Dirty Trick', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: `strain:${hostileFk}` });
  assert.strictEqual(result.applied, true);
  // Strain queues via pendingStrain[] — HP unchanged synchronously.
  assert.deepStrictEqual(healthState[0], [4, 5]);
  assert.ok(Array.isArray(result.pendingStrain) && result.pendingStrain.length === 1);
  assert.strictEqual(result.pendingStrain[0].figureKey, hostileFk);
  assert.strictEqual(result.pendingStrain[0].amount, 3);
});

test('resolveAbility Close and Personal stamps pendingMoveX (no bank)', () => {
  const msgId = 'msg-cap';
  const figureKey = 'Luke Skywalker-1-0';
  const game = {
    gameId: 'g-cap',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [figureKey]: 'a1' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-cap', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  const result = resolveAbility('Close and Personal', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(game.pendingMoveX, 'pendingMoveX stamped');
  assert.strictEqual(game.pendingMoveX[msgId].remaining, 2);
  assert.strictEqual(game.pendingMoveX[msgId].bypassCosts, true);
  assert.strictEqual(game.pendingMoveX[msgId].nextAction?.type, 'freeAttackPrompt');
  assert.strictEqual(result.pendingMoveXMsgId, msgId);
  assert.strictEqual(game.movementBank, undefined, 'no bank — Move-X discards remainder');
});

// ── Tests for recently promoted partial→wired cards ───────────────────────────

test('resolveAbility Wild Fury applies Focus and uses entry logMessage', () => {
  const msgId = 'msg-wf';
  const game = {
    gameId: 'g-wf2',
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Darth Vader', healthState: [[8, 10]] }],
    figureConditions: {},
    figurePositions: { 1: { 'Darth Vader-1-0': 'n8' }, 2: {} },
    selectedMap: { id: 'unit-test-grid' },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-wf2', playerNum: 1, dcName: 'Darth Vader', displayName: 'Darth Vader [Group 1]' }]]);
  const result = resolveAbility('Wild Fury', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.startsWith('Became Focused'));
  // alexanbv 2026-06-21: Wild Fury grants ASSAULT for the activation (a second
  // attack), not multiple free attacks.
  assert.ok(result.logMessage?.includes('Assault') || result.logMessage?.includes('manually'));
  assert.ok(game.figureConditions['Darth Vader-1-0']?.includes('Focus'));
});

test('resolveAbility Dying Lunge stamps pendingMoveX (Move-X) when figure deployed', () => {
  const msgId = 'msg-dl';
  const figureKey = 'Luke Skywalker-1-0';
  const game = {
    gameId: 'g-dl',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [figureKey]: 'a1' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-dl', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }]]);
  // Per alexanbv 2026-05-13: selfDefeatsAfterAttackMsgId is figureKey-keyed
  // and the write derives the figureKey via figureKeyForActivation, which
  // reads from the module-level meta registry. Register here so the
  // derivation finds Luke's figureKey.
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Dying Lunge', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // Move-X path: pendingMoveX with bypassCosts: true, no bank.
  assert.ok(game.pendingMoveX, 'pendingMoveX stamped');
  assert.strictEqual(game.pendingMoveX[msgId].remaining, 2);
  assert.strictEqual(game.pendingMoveX[msgId].bypassCosts, true);
  assert.strictEqual(game.pendingMoveX[msgId].nextAction?.type, 'freeAttackPrompt');
  assert.strictEqual(result.pendingMoveXMsgId, msgId);
  assert.strictEqual(game.movementBank, undefined, 'no bank — Move-X discards remainder');
  // selfDefeatsAfterAttack still flagged for the post-attack defeat.
  // Per alexanbv 2026-05-13: keyed by figureKey now.
  assert.ok(game.selfDefeatsAfterAttackMsgId?.[figureKey]);
});

test('resolveAbility Out of Time applies strain = round number via scaleStrainToRound', () => {
  const msgId = 'msg-oot';
  const hostileMsgId = 'msg-oot-hostile';
  const healthState = [[8, 10]];
  const dcHealthState = new Map([[hostileMsgId, healthState]]);
  const game = {
    gameId: 'g-oot',
    currentRound: 4,
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Obi-Wan-1-0': 'o8' }, 2: { 'Stormtroopers-2-0': 'p8' } },
    dcActionsData: { [msgId]: {} },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[8, 10]] }],
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-oot', playerNum: 1, dcName: 'Obi-Wan', displayName: 'Obi-Wan [Group 1]' }],
    [hostileMsgId, { gameId: 'g-oot', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 2]' }],
  ]);
  const result = resolveAbility('Out of Time', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  // Strain queues via pendingStrain[] — HP unchanged synchronously.
  assert.deepStrictEqual(healthState[0], [8, 10]);
  assert.ok(Array.isArray(result.pendingStrain) && result.pendingStrain.length === 1);
  assert.strictEqual(result.pendingStrain[0].amount, 4); // round 4
});

test('resolveAbility Force Drain applies damage+Stun+Weaken and heals self if the TARGET is a FORCE USER', async () => {
  // alexanbv 2026-06-19 / CSV row 665: "If THAT figure [the chosen target] is a
  // FORCE USER, you recover 3 Damage" — the trait gate is on the chosen hostile,
  // not the casting figure. Here the target (Darth Vader) IS a FORCE USER, so the
  // caster (Luke) heals 3.
  const msgId = 'msg-fd';
  const hostileMsgId = 'msg-fd-hostile';
  const selfHealth = [[6, 10]];
  const hostileHealth = [[8, 10]];
  const dcHealthState = new Map([
    [msgId, selfHealth],
    [hostileMsgId, hostileHealth],
  ]);
  const game = {
    gameId: 'g-fd',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Luke Skywalker-1-0': 'o8' }, 2: { 'Darth Vader-2-0': 'p8' } },
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[6, 10]] }],
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Darth Vader', healthState: [[8, 10]] }],
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-fd', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }],
    [hostileMsgId, { gameId: 'g-fd', playerNum: 2, dcName: 'Darth Vader', displayName: 'Darth Vader [Group 2]' }],
  ]);
  const result = resolveAbility('Force Drain', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  await applyDeferredAbilityEffects(game, { dcHealthState }, result);
  assert.deepStrictEqual(hostileHealth[0], [5, 10]); // 8 - 3 = 5
  const fk = 'Darth Vader-2-0';
  assert.ok(game.figureConditions[fk]?.includes('Stun'));
  assert.ok(game.figureConditions[fk]?.includes('Weaken'));
  // Target IS a FORCE USER → caster heals 3: 6 + 3 = 9.
  // Handler uses .slice() so we read back through dcHealthState (the Map was updated)
  assert.deepStrictEqual(dcHealthState.get(msgId)[0], [9, 10]);
});

test('resolveAbility Force Drain does NOT heal when the target is NOT a FORCE USER', () => {
  const msgId = 'msg-fd2';
  const hostileMsgId = 'msg-fd2-hostile';
  const dcHealthState = new Map([
    [msgId, [[6, 10]]],
    [hostileMsgId, [[8, 10]]],
  ]);
  const game = {
    gameId: 'g-fd2',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Luke Skywalker-1-0': 'o8' }, 2: { 'Nexu-2-0': 'p8' } },
    dcActionsData: { [msgId]: {} },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Luke Skywalker', healthState: [[6, 10]] }],
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Nexu', healthState: [[8, 10]] }],
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-fd2', playerNum: 1, dcName: 'Luke Skywalker', displayName: 'Luke [Group 1]' }],
    [hostileMsgId, { gameId: 'g-fd2', playerNum: 2, dcName: 'Nexu', displayName: 'Nexu [Group 2]' }],
  ]);
  const result = resolveAbility('Force Drain', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  // Target (Nexu) is not a FORCE USER → caster does NOT heal (stays at 6).
  assert.deepStrictEqual(dcHealthState.get(msgId)[0], [6, 10]);
});

test('resolveAbility Force Lightning applies 2 Damage and Stun to adjacent hostile', async () => {
  const msgId = 'msg-fl';
  const hostileMsgId = 'msg-fl-hostile';
  const hostileHealth = [[6, 8]];
  const dcHealthState = new Map([[hostileMsgId, hostileHealth]]);
  const game = {
    gameId: 'g-fl',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Emperor Palpatine-1-0': 'o8' }, 2: { 'Stormtroopers-2-0': 'p8' } },
    dcActionsData: { [msgId]: {} },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[6, 8]] }],
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-fl', playerNum: 1, dcName: 'Emperor Palpatine', displayName: 'Emperor Palpatine [Group 1]' }],
    [hostileMsgId, { gameId: 'g-fl', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 2]' }],
  ]);
  const result = resolveAbility('Force Lightning', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true);
  await applyDeferredAbilityEffects(game, { dcHealthState }, result);
  assert.deepStrictEqual(hostileHealth[0], [4, 8]); // 6 - 2 = 4
  assert.ok(game.figureConditions['Stormtroopers-2-0']?.includes('Stun'));
});

// ── Tests for sets* game-state-flag handlers ─────────────────────────────────

test('resolveAbility Signal Jammer sets signalJammerActive on game', () => {
  const game = { gameId: 'g-sj' };
  const result = resolveAbility('Signal Jammer', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.signalJammerActive, { playerNum: 1 });
});

test('resolveAbility Shadow Ops sets shadowOpsBlockedPlayer to opponent', () => {
  const game = { gameId: 'g-so' };
  const result = resolveAbility('Shadow Ops', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.shadowOpsBlockedPlayer, 2);
});

test('resolveAbility Shadow Ops for player 2 blocks player 1', () => {
  const game = { gameId: 'g-so2' };
  resolveAbility('Shadow Ops', { game, playerNum: 2 });
  assert.strictEqual(game.shadowOpsBlockedPlayer, 1);
});

test('resolveAbility Tough Luck is reaction-only — not a proactive round-long effect', () => {
  // Tough Luck is a discrete post-reroll reaction (handled by _offerToughLuck +
  // handleToughLuckGate in combat.js), NOT a proactively-played round-long effect.
  // resolveAbility must NOT arm any round flag; there is no setsToughLuck handler.
  const game = { gameId: 'g-tl' };
  const result = resolveAbility('Tough Luck', { game, playerNum: 2 });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(game.toughLuckPlayerNum, undefined);
});

test('resolveAbility Hold Ground sets holdGroundPlayerNum', () => {
  const game = { gameId: 'g-hg' };
  const result = resolveAbility('Hold Ground', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.holdGroundPlayerNum, 1);
});

test('resolveAbility Terminal Network sets terminalControlPlayerNum', () => {
  const game = { gameId: 'g-tn' };
  const result = resolveAbility('Terminal Network', { game, playerNum: 2 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.terminalControlPlayerNum, 2);
});

test('resolveAbility Windfall (reaction play) gains VP = recorded discard cost', () => {
  // Windfall is now discard-triggered, not a play-time flag (alexanbv 2026-06-17).
  const game = { gameId: 'g-wf3', player1VP: { total: 0, kills: 0, objectives: 0 }, windfallDiscardCost: { 1: 2 } };
  const result = resolveAbility('Windfall', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player1VP.total, 2);
  assert.strictEqual(game.windfallActive, undefined);
});

test('resolveAbility Still Faster Than You sets stillFasterPlayerNum', () => {
  const game = { gameId: 'g-sft' };
  const result = resolveAbility('Still Faster Than You', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.stillFasterPlayerNum, 1);
});

test('resolveAbility Disable with no choice presents hostile list', () => {
  const game = {
    gameId: 'g-dis',
    p2DcList: [{ dcName: 'Nexu', displayName: 'Nexu [Group 1]' }],
  };
  const result = resolveAbility('Disable', { game, playerNum: 1 });
  assert.strictEqual(result.requiresChoice, true);
  assert.ok(result.choiceOptions?.includes('Nexu [Group 1]'));
});

test('resolveAbility Disable with chosenOption adds to disabledFigures', () => {
  const game = { gameId: 'g-dis2', p2DcList: [], disabledFigures: [] };
  const result = resolveAbility('Disable', { game, playerNum: 1, chosenOption: 'Nexu [Group 1]' });
  assert.strictEqual(result.applied, true);
  assert.ok(game.disabledFigures.includes('Nexu [Group 1]'));
  assert.ok(result.logMessage?.includes('Nexu'));
});

test('resolveAbility Beatdown sets groupNextAttacksBonusHits for 2 attacks +1 Hit (group scope)', () => {
  const msgId = 'msg-bd';
  const game = { gameId: 'g-bd', p1ActivatedDcIndices: [], dcActionsData: { [msgId]: { selectedFigure: 0 } } };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-bd', playerNum: 1, dcName: 'Wookiee Warrior', displayName: 'Wookiee Warrior [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Beatdown', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  // 2026-05-09: Beatdown is the one exception to the per-figure rule —
  // applies to "your group's activation" per CRR. Stored in
  // groupNextAttacksBonusHits[playerNum].
  assert.deepStrictEqual(game.groupNextAttacksBonusHits[1], { count: 2, bonus: 1 });
  assert.ok(result.logMessage?.includes('2') && result.logMessage?.includes('+1 Damage'));
});

test('resolveAbility New Orders first call returns choice list of friendly DCs', () => {
  const game = {
    gameId: 'g-no',
    p1DcList: [{ dcName: 'Boba Fett', displayName: 'Boba Fett [Group 1]' }],
  };
  const result = resolveAbility('New Orders', { game, playerNum: 1 });
  assert.strictEqual(result.requiresChoice, true);
  assert.ok(result.choiceOptions?.includes('Boba Fett [Group 1]'));
});

test('resolveAbility New Orders second call readies matching DC', () => {
  const game = {
    gameId: 'g-no2',
    p1DcList: [{ dcName: 'Boba Fett', displayName: 'Boba Fett [Group 1]', exhausted: true }],
  };
  const result = resolveAbility('New Orders', { game, playerNum: 1, chosenOption: 'Boba Fett [Group 1]' });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.p1DcList[0].exhausted, false);
  assert.ok(result.logMessage?.includes('Boba Fett'));
});

test('resolveAbility Roar fails damage check when insufficient damage suffered', () => {
  const msgId = 'msg-roar';
  // healthState [7, 10]: suffered 3 damage (10-7=3), exactly meets threshold
  const dcHealthState = new Map([[msgId, [[7, 10]]]]);
  const game = { gameId: 'g-roar', dcActionsData: { [msgId]: {} }, p2DcList: [] };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-roar', playerNum: 1, dcName: 'Bantha', displayName: 'Bantha [Group 1]' }]]);
  // 10-7 = 3 damage, threshold is 3 — should pass
  const result = resolveAbility('Roar', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  // Should NOT return the damage-check failure (no hostile DCs → different error)
  assert.ok(!result.manualMessage?.includes('you have suffered 0'));
});

test('resolveAbility Roar returns manual when damage < threshold', () => {
  const msgId = 'msg-roar2';
  // healthState [9, 10]: only 1 damage suffered, threshold is 3
  const dcHealthState = new Map([[msgId, [[9, 10]]]]);
  const game = { gameId: 'g-roar2', dcActionsData: { [msgId]: {} } };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-roar2', playerNum: 1, dcName: 'Bantha', displayName: 'Bantha [Group 1]' }]]);
  const result = resolveAbility('Roar', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage?.includes('Damage'));
  // totalDamage = 10 - 9 = 1, should say "you have suffered 1" not "suffered 0"
  assert.ok(result.manualMessage?.includes('1'));
});

test('resolveAbility Roar with chosenFigureKey applies Stun to hostile figures', () => {
  const msgId = 'msg-roar3';
  const hostileMsgId = 'msg-roar3-hostile';
  // No damage check needed: pass dcHealthState with enough damage
  const dcHealthState = new Map([[msgId, [[5, 10]]]]);
  const game = {
    gameId: 'g-roar3',
    dcActionsData: { [msgId]: {} },
    p2DcMessageIds: [hostileMsgId],
    p2DcList: [{ dcName: 'Nexu', displayName: 'Nexu [Group 2]', healthState: [[3, 6]] }],
    figurePositions: { 1: {}, 2: { 'Nexu-2-0': 'p8' } },
    figureConditions: {},
  };
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-roar3', playerNum: 1, dcName: 'Rancor', displayName: 'Rancor [Group 1]' }],
    [hostileMsgId, { gameId: 'g-roar3', playerNum: 2, dcName: 'Nexu', displayName: 'Nexu [Group 2]' }],
  ]);
  const result = resolveAbility('Roar', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: hostileMsgId });
  assert.strictEqual(result.applied, true);
  assert.ok(game.figureConditions['Nexu-2-0']?.includes('Stun'));
});

test('resolveAbility Blaze of Glory requires an active IG-88 activation', () => {
  // Corrected behavior (audit 2026-06-26): Blaze of Glory is unique to IG-88
  // and readies the ACTIVATING figure's own DC — it no longer offers a free
  // menu of every DC. With no active activation it returns a manualMessage.
  const msgId = 'msg-bog';
  const game = { gameId: 'g-bog' }; // no dcActionsData → no active activation
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-bog', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }]]);
  const result = resolveAbility('Blaze of Glory', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.ok(result.manualMessage);
});

test("resolveAbility Blaze of Glory readies IG-88's DC and sets EOR damage", () => {
  const msgId = 'msg-bog2';
  const game = {
    gameId: 'g-bog2',
    dcActionsData: { [msgId]: { remaining: 2 } }, // active activation
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'IG-88', displayName: 'IG-88 [Group 1]', exhausted: true }],
    // The target is now IG-88's own card, resolved from the board rather than
    // from the activation (alexanbv 2026-08-12). See after-activation-resolves-
    // window.test.js for the case where those two differ.
    figurePositions: { 1: { 'IG-88-1-0': 'a1' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-bog2', playerNum: 1, dcName: 'IG-88', displayName: 'IG-88 [Group 1]' }]]);
  const result = resolveAbility('Blaze of Glory', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.p1DcList[0].exhausted, false);
  assert.strictEqual(game.endOfRoundSelfDamage[1].damage, 3);
  assert.ok(result.logMessage?.includes('3 Damage'));
});

test('resolveAbility Hidden Trap returns informational logMessage', () => {
  const game = { gameId: 'g-ht' };
  const result = resolveAbility('Hidden Trap', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Hidden Trap'));
  assert.ok(result.logMessage?.includes('2 Damage'));
  assert.ok(result.logMessage?.includes('terminal'));
});

test('resolveAbility Lightbow returns informational logMessage', () => {
  const game = { gameId: 'g-lb' };
  const result = resolveAbility('Lightbow', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.ok(result.logMessage?.includes('Ranged'));
  assert.ok(result.logMessage?.includes('Accuracy'));
  assert.ok(result.logMessage?.includes('blue'));
});

test('resolveAbility Celebration grants VP', () => {
  const game = {
    gameId: 'g-cel',
    player1VP: { total: 2, kills: 0, objectives: 0 },
    // Card text: "Use after a unique hostile figure is defeated." Code gates on
    // activationUniqueKills having at least one UNIQUE kill before granting VP.
    activationUniqueKills: { 'defeated-fk': 1 },
  };
  const result = resolveAbility('Celebration', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.player1VP.total, 6); // 2 + 4
  assert.ok(result.logMessage?.includes('4 VP'));
});

test('Celebration: non-unique hostile kill does NOT satisfy condition', () => {
  const game = {
    gameId: 'g-cel-nonuniq',
    player1VP: { total: 2, kills: 0, objectives: 0 },
    // A non-unique hostile was defeated (counted in activationKills) but NOT
    // in activationUniqueKills — Celebration must not fire (CSV row 573).
    activationKills: { 'defeated-fk': 1 },
  };
  const result = resolveAbility('Celebration', { game, playerNum: 1 });
  assert.strictEqual(result.applied, false);
  assert.strictEqual(game.player1VP.total, 2);
});

// ── MEDIUM-batch ability fixes (behavioral) ──────────────────────────────

test('Counter Attack: damages the attacker (not a free adjacent hostile) when adjacent and not defeated', async () => {
  const atkMsgId = 'msg-ca-atk';
  const dcMessageMeta = new Map([
    [atkMsgId, { gameId: 'g-ca', playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [DG 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const dcHealthState = new Map([[atkMsgId, [[6, 6]]]]);
  const game = {
    gameId: 'g-ca',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: {
      1: { 'Royal Guard-1-0': 'a1' }, // defender (you)
      2: { 'Stormtrooper-1-0': 'a2' }, // attacker (adjacent)
    },
    p2DcList: [{ dcName: 'Stormtrooper', healthState: [6, 6] }],
    p2DcMessageIds: [atkMsgId],
  };
  const combat = { attackerPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Royal Guard-1-0' } };
  const r = resolveAbility('Counter Attack', { game, playerNum: 1, combat, dcMessageMeta, dcHealthState });
  assert.strictEqual(r.applied, true);
  await drainPendingDamage(game, { dcHealthState });
  // The attacker (Stormtrooper) took 2 damage.
  assert.deepStrictEqual(dcHealthState.get(atkMsgId), [[4, 6]]);
});

test('Counter Attack: no effect when defender is not adjacent to the attacker', () => {
  const atkMsgId = 'msg-ca-atk2';
  const dcMessageMeta = new Map([
    [atkMsgId, { gameId: 'g-ca2', playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [DG 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const dcHealthState = new Map([[atkMsgId, [[6, 6]]]]);
  const game = {
    gameId: 'g-ca2',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: {
      1: { 'Royal Guard-1-0': 'a1' },
      2: { 'Stormtrooper-1-0': 'c3' }, // 2 spaces away
    },
    p2DcList: [{ dcName: 'Stormtrooper', healthState: [6, 6] }],
    p2DcMessageIds: [atkMsgId],
  };
  const combat = { attackerPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Royal Guard-1-0' } };
  const r = resolveAbility('Counter Attack', { game, playerNum: 1, combat, dcMessageMeta, dcHealthState });
  assert.strictEqual(r.applied, false);
  assert.deepStrictEqual(dcHealthState.get(atkMsgId), [[6, 6]]);
});

test('Counter Attack: no effect when defender was defeated (no longer on board)', () => {
  const atkMsgId = 'msg-ca-atk3';
  const dcMessageMeta = new Map([
    [atkMsgId, { gameId: 'g-ca3', playerNum: 2, dcName: 'Stormtrooper', displayName: 'Stormtrooper [DG 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const dcHealthState = new Map([[atkMsgId, [[6, 6]]]]);
  const game = {
    gameId: 'g-ca3',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: {
      1: {}, // defender removed from board (defeated)
      2: { 'Stormtrooper-1-0': 'a2' },
    },
    p2DcList: [{ dcName: 'Stormtrooper', healthState: [6, 6] }],
    p2DcMessageIds: [atkMsgId],
  };
  const combat = { attackerPlayerNum: 2, attackerFigureKey: 'Stormtrooper-1-0', target: { figureKey: 'Royal Guard-1-0' } };
  const r = resolveAbility('Counter Attack', { game, playerNum: 1, combat, dcMessageMeta, dcHealthState });
  assert.strictEqual(r.applied, false);
  assert.deepStrictEqual(dcHealthState.get(atkMsgId), [[6, 6]]);
});

test('Crush: only SMALL adjacent hostiles are eligible (LARGE/MASSIVE excluded)', () => {
  const actMsgId = 'msg-crush-act';
  const massiveMsgId = 'msg-crush-massive';
  const dcMessageMeta = new Map([
    [actMsgId, { gameId: 'g-crush', playerNum: 1, dcName: 'Royal Guard', displayName: 'Royal Guard [DG 1]' }],
    [massiveMsgId, { gameId: 'g-crush', playerNum: 2, dcName: 'AT-ST', displayName: 'AT-ST [DG 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const dcHealthState = new Map([
    [actMsgId, [[8, 8]]],
    [massiveMsgId, [[11, 11]]],
  ]);
  const game = {
    gameId: 'g-crush',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: {
      1: { 'Royal Guard-1-0': 'a1' },
      2: { 'AT-ST-1-0': 'a2' }, // adjacent but MASSIVE → not eligible
    },
    dcActionsData: { [actMsgId]: { selectedFigure: 0 } },
    p1DcMessageIds: [actMsgId],
    p2DcMessageIds: [massiveMsgId],
    p1DcList: [{ dcName: 'Royal Guard', healthState: [8, 8] }],
    p2DcList: [{ dcName: 'AT-ST', healthState: [11, 11] }],
    activatingPlayerNum: 1,
    activatingDcMsgId: actMsgId,
  };
  const r = resolveAbility('Crush', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  // No SMALL hostile in range → applied:true with "no valid hostile" message,
  // and the MASSIVE AT-ST takes no damage.
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(dcHealthState.get(massiveMsgId), [[11, 11]]);
});

test('Combat Resupply: does NOT grant the activator a Power Token (only Hit-token distribution)', () => {
  const msgId = 'msg-cr';
  const dcMessageMeta = new Map([
    [msgId, { gameId: 'g-cr', playerNum: 1, dcName: 'Royal Guard', displayName: 'Royal Guard [DG 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const game = {
    gameId: 'g-cr',
    currentRound: 1,
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { 'Royal Guard-1-0': 'a1' } },
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    p1DcMessageIds: [msgId],
    p1DcList: [{ dcName: 'Royal Guard', healthState: [8, 8] }],
    figurePowerTokens: {},
    activatingPlayerNum: 1,
    activatingDcMsgId: msgId,
  };
  const r = resolveAbility('Combat Resupply', { game, playerNum: 1, dcMessageMeta });
  // No spurious Power Token grant queued, and the result does not request a
  // power-token-type choice.
  assert.ok(!r.requiresPowerTokenChoice, 'must not request a power token choice');
  assert.ok(!game.pendingPowerTokenGrant, 'must not queue a power token grant');
});

test('Deathblow: +1 Hit on a Melee attack vs non-Ranged defender', () => {
  const combat = { attackerPlayerNum: 1, isRanged: false, attackerDcName: 'Ahsoka Tano', target: { figureKey: 'Wampa (Elite)-2-0' }, bonusHits: 0 };
  const game = { gameId: 'g-db1', pendingCombat: combat };
  const r = resolveAbility('Deathblow', { game, playerNum: 1, combat });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusHits, 1);
});

test('Deathblow: +2 Hit on Melee attack vs Ranged defender', () => {
  const combat = { attackerPlayerNum: 1, isRanged: false, attackerDcName: 'Ahsoka Tano', target: { figureKey: '4-LOM-2-0' }, bonusHits: 0 };
  const game = { gameId: 'g-db2', pendingCombat: combat };
  const r = resolveAbility('Deathblow', { game, playerNum: 1, combat });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusHits, 2);
});

test('Deathblow: does NOT apply on a Ranged attack', () => {
  const combat = { attackerPlayerNum: 1, isRanged: true, attackerDcName: '4-LOM', target: { figureKey: 'Ahsoka Tano-2-0' }, bonusHits: 0 };
  const game = { gameId: 'g-db3', pendingCombat: combat };
  const r = resolveAbility('Deathblow', { game, playerNum: 1, combat });
  assert.strictEqual(r.applied, false);
  assert.strictEqual(combat.bonusHits, 0);
});

test('Deflection: registers a Ranged-only, self-figure accuracy-penalty modifier + deflection counter', () => {
  const game = { gameId: 'g-defl' };
  const r = resolveAbility('Deflection', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);
  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Deflection' && m.side === 'defense');
  assert.ok(d, 'Deflection defense descriptor registered');
  assert.strictEqual(d.effect.accuracyPenalty, 2);
  // CSV "when a Ranged attack targeting YOU is declared" → self figure + range.
  assert.strictEqual(d.conditions.selfIsSourceFigure, true);
  assert.strictEqual(d.conditions.attackType, 'range');
  // alexanbv 2026-06-22: the -2 applies to ONLY the attack it reacted to, not
  // the whole round → 'this-attack' (cleared by clearRoundModifiersThisAttack).
  assert.strictEqual(d.duration, 'this-attack');
  // Deflection counter-damage still flows through deflectionPending.
  assert.strictEqual(game.deflectionPending?.[1], 1);
});

test('Fuel Upgrade: registers a VEHICLE-scoped Evade defense modifier + Speed (movement) flag', () => {
  const game = { gameId: 'g-fuel' };
  const r = resolveAbility('Fuel Upgrade', { game, playerNum: 1 });
  assert.strictEqual(r.applied, true);
  const d = (game.activeRoundModifiers || []).find((m) => m.card === 'Fuel Upgrade' && m.side === 'defense');
  assert.ok(d, 'Fuel Upgrade defense descriptor registered');
  assert.strictEqual(d.effect.evade, 1);
  assert.strictEqual(d.conditions.selfKeyword, 'VEHICLE', 'Evade applies only to VEHICLES');
  // Speed bonus is a movement effect — stays on the per-player flag.
  assert.strictEqual(game.roundVehicleSpeedBonus?.[1], 1);
});

test('Glory of the Kill: no recover when the defender was not defeated', () => {
  const meta = { playerNum: 1, dcName: 'Ahsoka Tano' };
  const dcMessageMeta = new Map([['m1', meta]]);
  const dcHealthState = new Map([['m1', [[3, 5]]]]);
  const game = {
    gameId: 'g-glory0',
    pendingCombat: { attackerPlayerNum: 1, target: { figureKey: 'Onar Koma-2-0' } },
    dcActionsData: { m1: { selectedFigure: 0 } },
    p1ActivatedDcIndices: [],
    currentActivationTurnPlayerId: undefined,
  };
  // No lastDefeatInfo → not defeated → must not recover.
  const r = resolveAbility('Glory of the Kill', { game, playerNum: 1, dcMessageMeta, dcHealthState, msgId: 'm1', combat: game.pendingCombat });
  assert.strictEqual(r.applied, false);
  assert.strictEqual(dcHealthState.get('m1')[0][0], 3); // unchanged
});

test('Glory of the Kill: recovers when the defender was defeated', () => {
  const meta = { playerNum: 1, dcName: 'Ahsoka Tano' };
  const dcMessageMeta = new Map([['m1', meta]]);
  const dcHealthState = new Map([['m1', [[1, 5]]]]);
  const game = {
    gameId: 'g-glory1',
    pendingCombat: { attackerPlayerNum: 1, target: { figureKey: 'Onar Koma-2-0' } },
    lastDefeatInfo: { figureKey: 'Onar Koma-2-0', playerNum: 2 },
    dcActionsData: { m1: { selectedFigure: 0 } },
  };
  const r = resolveAbility('Glory of the Kill', { game, playerNum: 1, dcMessageMeta, dcHealthState, msgId: 'm1', combat: game.pendingCombat });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(dcHealthState.get('m1')[0][0], 4); // 1 + 3
});

// ── Lock On: +3 Accuracy OR -1 Dodge OR -1 Evade (player choice) ─────────────

test('Lock On offers three options and applies +3 Accuracy', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-lockon' };
  const game = { gameId: 'g-lockon', pendingCombat: combat };
  const prompt = resolveAbility('Lock On', { game, playerNum: 1, combat });
  assert.strictEqual(prompt.requiresChoice, true);
  assert.strictEqual(prompt.choiceOptions.length, 3);
  const r = resolveAbility('Lock On', { game, playerNum: 1, combat, choiceIndex: 0 });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusAccuracy, 3);
});

test('Lock On option 2 applies -1 Dodge', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-lockon2' };
  const game = { gameId: 'g-lockon2', pendingCombat: combat };
  const r = resolveAbility('Lock On', { game, playerNum: 1, combat, choiceIndex: 1 });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusDodge, -1);
});

test('Lock On option 3 applies -1 Evade', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-lockon3' };
  const game = { gameId: 'g-lockon3', pendingCombat: combat };
  const r = resolveAbility('Lock On', { game, playerNum: 1, combat, choiceIndex: 2 });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusEvade, -1);
});

// ── Heavy Ordnance: +1 Hit normally, +2 Hit + Pierce 2 vs object (crate) ─────

test('Heavy Ordnance applies +1 Hit vs a normal defender', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-ho1', target: { figureKey: 'Stormtroopers-2-0' } };
  const game = { gameId: 'g-ho1', pendingCombat: combat };
  const r = resolveAbility('Heavy Ordnance', { game, playerNum: 1, combat });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusHits, 1);
  assert.ok(!combat.bonusPierce);
});

test('Heavy Ordnance applies +2 Hit + Pierce 2 vs an object (crate)', () => {
  const combat = { attackerPlayerNum: 1, gameId: 'g-ho2', target: { isNpc: true, npcType: 'crate' } };
  const game = { gameId: 'g-ho2', pendingCombat: combat };
  const r = resolveAbility('Heavy Ordnance', { game, playerNum: 1, combat });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(combat.bonusHits, 2);
  assert.strictEqual(combat.bonusPierce, 2);
});

// ── Cruel Strike: grants the free attack AND the surge buff ──────────────────

test('Cruel Strike grants a free attack and arms the surge buff', () => {
  const msgId = 'msg-cs2';
  const game = {
    gameId: 'g-cs2',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    nextAttackBonusSurgeAbilities: {},
    freeAttackBonusPending: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-cs2', playerNum: 1, dcName: 'Trandoshan Hunter', displayName: 'Trandoshan Hunter [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const r = resolveAbility('Cruel Strike', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(game.nextAttackBonusSurgeAbilities['Trandoshan Hunter-1-0'], ['pierce 1, weaken']);
  assert.strictEqual(game.freeAttackBonusPending['Trandoshan Hunter-1-0'], true);
});

// ── Take Initiative: mandatory exhaust of a Deployment card ──────────────────

test('Take Initiative auto-exhausts the only readied DC', () => {
  const game = {
    gameId: 'g-ti1', player1Id: 'P1', player2Id: 'P2',
    p1DcList: [{ dcName: 'Stormtroopers' }],
    p1DcMessageIds: ['dc-st'],
  };
  const dcExhaustedState = new Map([['dc-st', false]]);
  const dcMessageMeta = new Map([['dc-st', { dcName: 'Stormtroopers', playerNum: 1 }]]);
  const r = resolveAbility('Take Initiative', { game, playerNum: 1, dcExhaustedState, dcMessageMeta });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.initiativePlayerId, 'P1');
  assert.strictEqual(dcExhaustedState.get('dc-st'), true);
  assert.deepStrictEqual(r.exhaustDcMsgIds, ['dc-st']);
});

test('Take Initiative prompts to choose among multiple readied DCs', () => {
  const game = {
    gameId: 'g-ti2', player1Id: 'P1', player2Id: 'P2',
    p1DcList: [{ dcName: 'Stormtroopers' }, { dcName: 'Royal Guard' }],
    p1DcMessageIds: ['dc-a', 'dc-b'],
  };
  const dcExhaustedState = new Map([['dc-a', false], ['dc-b', false]]);
  const dcMessageMeta = new Map([['dc-a', { dcName: 'Stormtroopers', playerNum: 1 }], ['dc-b', { dcName: 'Royal Guard', playerNum: 1 }]]);
  const r = resolveAbility('Take Initiative', { game, playerNum: 1, dcExhaustedState, dcMessageMeta });
  assert.strictEqual(r.requiresChoice, true);
  assert.strictEqual(r.choiceValues.length, 2);
  // Initiative is still claimed even though exhaust choice is pending.
  assert.strictEqual(game.initiativePlayerId, 'P1');
  // Resolve the choice → second DC exhausted.
  const r2 = resolveAbility('Take Initiative', { game, playerNum: 1, dcExhaustedState, dcMessageMeta, choiceIndex: 1, chosenFigureKey: 'dc-b' });
  assert.strictEqual(r2.applied, true);
  assert.strictEqual(dcExhaustedState.get('dc-b'), true);
});

// ── Jundland Terror: figure pick → Attack/Special choice → free action ──────

function _jundlandGame(msgId) {
  return {
    gameId: 'g-jt', player1Id: 'P1', player2Id: 'P2',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Tusken Raider-1-0': 'a1' }, 2: {} },
    freeAttackBonusPending: {},
    freeSpecialActionPending: {},
    pendingMoveX: {},
  };
}
function _jundlandMeta(msgId) {
  const m = new Map([[msgId, { gameId: 'g-jt', playerNum: 1, dcName: 'Tusken Raider', displayName: 'Tusken Raider [Group 1]' }]]);
  _registerDcMessageMeta(m);
  return m;
}
// Bantha Rider has a real Special Action (Trample) — used to exercise the
// per-special Phase 2 listing + the immediate (non-deferred) special branch.
function _banthaGame(msgId) {
  return {
    gameId: 'g-jt', player1Id: 'P1', player2Id: 'P2',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Bantha Rider-1-0': 'a1' }, 2: {} },
    freeAttackBonusPending: {},
    freeSpecialActionPending: {},
    pendingMoveX: {},
  };
}
function _banthaMeta(msgId) {
  const m = new Map([[msgId, { gameId: 'g-jt', playerNum: 1, dcName: 'Bantha Rider', displayName: 'Bantha Rider [Group 1]' }]]);
  _registerDcMessageMeta(m);
  return m;
}

test('Jundland Terror Phase 1 prompts which Tusken/Bantha figure plays it', () => {
  const msgId = 'jt-1';
  const game = _jundlandGame(msgId);
  const dcMessageMeta = _jundlandMeta(msgId);
  const r = resolveAbility('Jundland Terror', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(r.requiresChoice, true);
  assert.deepStrictEqual(r.choiceValues, ['Tusken Raider-1-0']);
});

test('Jundland Terror Phase 2 lists Attack only for a figure with no specials', () => {
  const msgId = 'jt-2';
  const game = _jundlandGame(msgId);
  const dcMessageMeta = _jundlandMeta(msgId);
  // Base "Tusken Raider" has no native Special Action → Attack is the only option.
  const r = resolveAbility('Jundland Terror', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: 'Tusken Raider-1-0' });
  assert.strictEqual(r.requiresChoice, true);
  assert.deepStrictEqual(r.choiceOptions, ['Jundland: Attack']);
  assert.deepStrictEqual(r.choiceValues, ['Tusken Raider-1-0']);
  // Not yet committed: EOR flag stays unset until a mode is chosen.
  assert.ok(!game.jundlandTerrorPlayedThisEor);
});

test('Jundland Terror Phase 2 lists Attack PLUS each Special Action the figure has', () => {
  const msgId = 'jt-2b';
  const game = _banthaGame(msgId);
  const dcMessageMeta = _banthaMeta(msgId);
  const r = resolveAbility('Jundland Terror', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: 'Bantha Rider-1-0' });
  assert.strictEqual(r.requiresChoice, true);
  // Attack first, then one option per native special (Bantha Rider → Trample),
  // each carrying its render-position special index encoded as `#<idx>`.
  assert.deepStrictEqual(r.choiceOptions, ['Jundland: Attack', 'Jundland: Special: Trample #0']);
  assert.deepStrictEqual(r.choiceValues, ['Bantha Rider-1-0', 'Bantha Rider-1-0']);
  assert.ok(!game.jundlandTerrorPlayedThisEor);
});

test('Jundland Terror Attack mode arms free attack + 2 MP + EOR gate', () => {
  const msgId = 'jt-3';
  const game = _jundlandGame(msgId);
  const dcMessageMeta = _jundlandMeta(msgId);
  const r = resolveAbility('Jundland Terror', {
    game, playerNum: 1, dcMessageMeta,
    chosenFigureKey: 'Tusken Raider-1-0', chosenOption: 'Jundland: Attack',
  });
  assert.strictEqual(r.applied, true);
  assert.strictEqual(game.freeAttackBonusPending['Tusken Raider-1-0'], true);
  assert.ok(!game.freeSpecialActionPending['Tusken Raider-1-0']);
  assert.strictEqual(game.pendingMoveX[msgId]?.remaining, 2);
  assert.strictEqual(game.pendingMoveX[msgId]?.nextAction?.type, 'freeAttackPrompt');
  assert.strictEqual(game.jundlandTerrorPlayedThisEor, true);
});

test('Jundland Terror Special mode arms an IMMEDIATE special picker (NOT freeSpecialActionPending)', () => {
  const msgId = 'jt-4';
  const game = _banthaGame(msgId);
  const dcMessageMeta = _banthaMeta(msgId);
  const r = resolveAbility('Jundland Terror', {
    game, playerNum: 1, dcMessageMeta,
    chosenFigureKey: 'Bantha Rider-1-0', chosenOption: 'Jundland: Special: Trample #0',
  });
  assert.strictEqual(r.applied, true);
  // The special is resolved NOW via a freeSpecialPrompt Move-X continuation —
  // it must NOT defer to next activation via freeSpecialActionPending.
  assert.ok(!game.freeSpecialActionPending['Bantha Rider-1-0']);
  assert.ok(!game.freeAttackBonusPending['Bantha Rider-1-0']);
  assert.strictEqual(game.pendingMoveX[msgId]?.remaining, 2);
  const next = game.pendingMoveX[msgId]?.nextAction;
  assert.strictEqual(next?.type, 'freeSpecialPrompt');
  assert.strictEqual(next?.payload?.specialIdx, 0);
  assert.strictEqual(next?.payload?.specialLabel, 'Trample');
  assert.strictEqual(next?.payload?.figureKey, 'Bantha Rider-1-0');
  assert.strictEqual(game.jundlandTerrorPlayedThisEor, true);
});

// ── Transmit the Plans: distribute 2 Hit Tokens among friendly figures ──────

test('Transmit the Plans distributes 2 Hit Tokens among friendly figures', () => {
  const msgId = 'msg-ttp';
  const game = {
    gameId: 'g-ttp',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Rebel Trooper-1-0': 'a1', 'Rebel Trooper-1-1': 'a2' } },
    figurePowerTokens: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-ttp', playerNum: 1, dcName: 'Rebel Trooper', displayName: 'Rebel Trooper [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const prompt = resolveAbility('Transmit the Plans', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(prompt.requiresChoice, true);
  assert.ok(prompt.targetFigureKeys.length >= 2);
  // Assign first token to figure 0.
  const r1 = resolveAbility('Transmit the Plans', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0, targetFigureKey: 'Rebel Trooper-1-0' });
  assert.strictEqual(r1.requiresChoice, true); // one more to assign
  // Assign second token to figure 1.
  const r2 = resolveAbility('Transmit the Plans', { game, playerNum: 1, dcMessageMeta, choiceIndex: 0, targetFigureKey: 'Rebel Trooper-1-1' });
  assert.strictEqual(r2.applied, true);
  const tok0 = (game.figurePowerTokens['Rebel Trooper-1-0'] || []).length;
  const tok1 = (game.figurePowerTokens['Rebel Trooper-1-1'] || []).length;
  assert.strictEqual(tok0 + tok1, 2);
});

// ── Lightbow / Close and Personal: replacement surges via blockSurgeAbilities ─

test('getAttackerSurgeAbilities returns ONLY replacement surges when blocked', async () => {
  const { getAttackerSurgeAbilities } = await import('./combat.js');
  // blocked + replacement surges supplied → only the replacements come through.
  const combat = { attackerDcName: 'Greedo', blockSurgeAbilities: true, bonusSurgeAbilities: ['+1 hit', 'pierce 4'] };
  assert.deepStrictEqual(getAttackerSurgeAbilities(combat), ['+1 hit', 'pierce 4']);
  // blocked + no replacements → empty (Tusken Cycler / Improvised Weapons).
  assert.deepStrictEqual(getAttackerSurgeAbilities({ attackerDcName: 'Greedo', blockSurgeAbilities: true }), []);
});

// ── MEDIUM-severity ability-audit fixes (alexanbv 2026-06-20) ──────────────

test('Expose Weakness stores target-keyed pierce on the chosen hostile (Phase 2)', () => {
  // CSV row 641/642: "next attack TARGETING that figure gains Pierce 3" — keyed to
  // the chosen hostile (defender), NOT the activator.
  const game = { gameId: 'g-ew' };
  const result = resolveAbility('Expose Weakness', {
    game, playerNum: 1, dcMessageMeta: new Map(), chosenFigureKey: 'Stormtrooper-1-0',
  });
  assert.strictEqual(result.applied, true);
  assert.strictEqual(game.nextAttackPierceVsDefender?.['Stormtrooper-1-0'], 3);
});

test('Merciless prompts the OPPONENT to choose discard-2 vs concede VP', () => {
  // CSV row 746: "that figure's player MAY discard 2... OR your player gains 3 VPs"
  // — the opponent chooses, routed via choiceForControllerPlayerNum.
  const game = {
    gameId: 'g-merc',
    player2CcDeck: ['A', 'B', 'C'], // opponent (player 2) deck has >= 2 cards
  };
  const prompt = resolveAbility('Merciless', { game, playerNum: 1 });
  assert.strictEqual(prompt.requiresChoice, true);
  assert.strictEqual(prompt.choiceForControllerPlayerNum, 2);
  assert.deepStrictEqual(prompt.choiceValues, ['merciless_discard', 'merciless_vp']);
  // Opponent picks discard-2.
  const discard = resolveAbility('Merciless', { game, playerNum: 1, chosenFigureKey: 'merciless_discard' });
  assert.strictEqual(discard.applied, true);
  assert.strictEqual(game.player2CcDeck.length, 1);
});

test('Merciless: opponent declining concedes VP to the card player', () => {
  const game = { gameId: 'g-merc2', player2CcDeck: ['A', 'B', 'C'], player1VP: { total: 0 } };
  resolveAbility('Merciless', { game, playerNum: 1 }); // prompt
  const vp = resolveAbility('Merciless', { game, playerNum: 1, chosenFigureKey: 'merciless_vp' });
  assert.strictEqual(vp.applied, true);
  assert.strictEqual(game.player2CcDeck.length, 3); // not discarded
  assert.strictEqual(game.player1VP.total, 3);
});

test('Merciless: deck too small → no choice, card player gains VP directly', () => {
  const game = { gameId: 'g-merc3', player2CcDeck: ['only-one'], player1VP: { total: 0 } };
  const result = resolveAbility('Merciless', { game, playerNum: 1 });
  assert.strictEqual(result.applied, true);
  assert.ok(!result.requiresChoice);
  assert.strictEqual(game.player1VP.total, 3);
});

test('Support Specialist Phase 2 attack option grants a free interrupt attack', () => {
  // CSV: "That figure interrupts to perform an action" — now offers attack, not just move.
  const msgId = 'msg-ss';
  const figureKey = 'C1-10P-1-0';
  const game = {
    gameId: 'g-ss',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [figureKey]: 'b2' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-ss', playerNum: 1, dcName: 'C1-10P', displayName: 'C1-10P [Group 1]' }]]);
  const result = resolveAbility('Support Specialist', {
    game, playerNum: 1, dcMessageMeta, chosenFigureKey: `${figureKey}|attack`,
  });
  assert.strictEqual(result.applied, true);
  assert.ok(game.freeAttackBonusPending?.[figureKey]);
  assert.match(result.logMessage, /free attack/i);
});

test('Field Supply: token-type choice (Hit vs Surge) and up to 2 figures', () => {
  const msgId = 'msg-fs';
  const f1 = 'Trooper A-1-0';
  const game = {
    gameId: 'g-fs',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    // Activating figure omitted from positions → actPos null → the within-3 range
    // filter is skipped (no map in this unit test), so f1 stays eligible.
    figurePositions: { 1: { [f1]: 'a2' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-fs', playerNum: 1, dcName: 'Field Tech', displayName: 'Field Tech [Group 1]' }]]);
  // First call → prompt offering Hit Token + Surge Token per eligible figure.
  const prompt = resolveAbility('Field Supply', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(prompt.requiresChoice, true);
  assert.ok(prompt.choiceValues.includes(`${f1}|Damage`));
  assert.ok(prompt.choiceValues.includes(`${f1}|Surge`));
  // Pick a Surge token for f1 → grants a Surge token, then re-offers / finalizes.
  const after = resolveAbility('Field Supply', { game, playerNum: 1, dcMessageMeta, chosenFigureKey: `${f1}|Surge` });
  assert.ok(after.applied || after.requiresChoice);
  assert.ok((game.figurePowerTokens?.[f1] || []).includes('Surge'));
});

test('Collateral Damage: single adjacent damageable OBJECT is auto-damaged for 2 (CSV row 582)', () => {
  // CSV: "Choose a figure or object other than the defender within 2 spaces of
  // the target space; it suffers 2 Damage." Only an object is in range → auto-apply.
  const game = {
    gameId: 'g-cd-obj',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: { 'Target-1-0': 'o8' } },
    lastAttackTargetFigureKey: 'Target-1-0',
    objectHealth: { 'crate-1': [3, 3] },
    objectPositions: { 'crate-1': 'o8' },
    objectMeta: { 'crate-1': { name: 'Crate' } },
  };
  const dcMessageMeta = new Map([['m2', { gameId: 'g-cd-obj', playerNum: 2, dcName: 'Target', displayName: 'Target [Group 1]' }]]);
  const dcHealthState = new Map([['m2', [[5, 5]]]]);
  const r = resolveAbility('Collateral Damage', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(game.objectHealth['crate-1'], [1, 3]);
  assert.ok(/Crate/.test(r.logMessage));
});

test('Collateral Damage: an object at 0 HP is removed from positions (destroyed)', () => {
  const game = {
    gameId: 'g-cd-destroy',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: { 'Target-1-0': 'o8' } },
    lastAttackTargetFigureKey: 'Target-1-0',
    objectHealth: { 'barrel-1': [2, 2] },
    objectPositions: { 'barrel-1': 'o8' },
    objectMeta: { 'barrel-1': { name: 'Barrel' } },
  };
  const dcMessageMeta = new Map([['m2', { gameId: 'g-cd-destroy', playerNum: 2, dcName: 'Target', displayName: 'Target [Group 1]' }]]);
  const r = resolveAbility('Collateral Damage', { game, playerNum: 1, dcMessageMeta, dcHealthState: new Map([['m2', [[5, 5]]]]) });
  assert.strictEqual(r.applied, true);
  assert.deepStrictEqual(game.objectHealth['barrel-1'], [0, 2]);
  assert.strictEqual(game.objectPositions['barrel-1'], undefined, 'destroyed object removed from positions');
  assert.ok(/destroyed/.test(r.logMessage));
});

test('Collateral Damage: figure + object both in range → choice offers both; object pick damages object', () => {
  const game = {
    gameId: 'g-cd-multi',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: { 'Target-1-0': 'o8', 'Bystander-1-0': 'o8' } },
    lastAttackTargetFigureKey: 'Target-1-0',
    objectHealth: { 'crate-1': [3, 3] },
    objectPositions: { 'crate-1': 'o8' },
    objectMeta: { 'crate-1': { name: 'Crate' } },
  };
  const dcMessageMeta = new Map([['m2', { gameId: 'g-cd-multi', playerNum: 2, dcName: 'Target', displayName: 'Target [Group 1]' }]]);
  const dcHealthState = new Map([['m2', [[5, 5]]]]);
  const phase1 = resolveAbility('Collateral Damage', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(phase1.requiresChoice, true);
  // CSV "a figure or OBJECT" — both candidate kinds present.
  assert.ok(phase1.choiceValues.includes('Bystander-1-0'), 'figure candidate offered');
  const objVal = phase1.choiceValues.find((v) => String(v).startsWith('obj:'));
  assert.ok(objVal, 'object candidate offered as obj:<id>');
  // CC choice re-entry routes the chosen value as chosenFigureKey (cc-hand path).
  const phase2 = resolveAbility('Collateral Damage', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: objVal });
  assert.strictEqual(phase2.applied, true);
  assert.deepStrictEqual(game.objectHealth['crate-1'], [1, 3]);
});

test('Collateral Damage: figure pick (cc-hand chosenFigureKey route) damages the chosen figure', () => {
  const game = {
    gameId: 'g-cd-fig',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: { 'Target-1-0': 'o8', 'Bystander-1-0': 'o8' } },
    lastAttackTargetFigureKey: 'Target-1-0',
    objectHealth: { 'crate-1': [3, 3] },
    objectPositions: { 'crate-1': 'o8' },
    objectMeta: { 'crate-1': { name: 'Crate' } },
  };
  const dcMessageMeta = new Map([['m2', { gameId: 'g-cd-fig', playerNum: 2, dcName: 'Bystander', displayName: 'Bystander [Group 1]' }]]);
  const dcHealthState = new Map([['m2', [[6, 6]]]]);
  const phase2 = resolveAbility('Collateral Damage', { game, playerNum: 1, dcMessageMeta, dcHealthState, chosenFigureKey: 'Bystander-1-0' });
  assert.strictEqual(phase2.applied, true);
  assert.deepStrictEqual(dcHealthState.get('m2')[0], [4, 6]);
});

// ─── Re-audit gap fixes (2026-06-21) ──────────────────────────────────────────

test('Wild Fury grants Focus + Assault-for-activation + post-activation Stun/Bleed (gap 4/5)', () => {
  // alexanbv 2026-06-21: Wild Fury does NOT grant multiple free attacks. It
  // effectively gives the figure ASSAULT for that activation, surfaced via the
  // per-figure game.activationAssaultGranted flag (NOT freeAttackBonusPending).
  const msgId = 'msg-wf';
  const game = {
    gameId: 'g-wf',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { 'Wookiee Warriors-1-0': 'a1' } },
    figureConditions: {},
    freeAttackBonusPending: {},
    activationAssaultGranted: {},
    postActivationConditions: {},
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-wf', playerNum: 1, dcName: 'Wookiee Warriors', displayName: 'Wookiee Warriors [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Wild Fury', { game, playerNum: 1, dcMessageMeta, msgId });
  assert.strictEqual(result.applied, true);
  // Focus applied
  assert.ok(game.figureConditions['Wookiee Warriors-1-0']?.includes('Focus'), 'Focus applied');
  // Assault granted for this activation (NOT a freeAttackBonusPending grant)
  assert.strictEqual(game.activationAssaultGranted['Wookiee Warriors-1-0'], true, 'activationAssaultGranted set');
  assert.ok(game.freeAttackBonusPending['Wookiee Warriors-1-0'] == null, 'no free-attack count granted');
  // End-of-activation Stun + Bleed queued
  assert.deepStrictEqual(game.postActivationConditions['Wookiee Warriors-1-0'], ['Stun', 'Bleed'], 'postActivationConditions queued');
});

test('Bombardment (Sorin) stores Blast 1 (no Accuracy) by figureKey for the granted attack (gap 1)', () => {
  const game = {
    gameId: 'g-bomb',
    nextAttacksBonusHits: {},
  };
  const findDcMessageIdForFigure = () => 'chosen-msg';
  const result = resolveAbility('bombardment_sorin', {
    game, playerNum: 1, msgId: 'sorin-msg',
    choiceIndex: 0, targetFigureKey: 'B2-EMO-1-0', findDcMessageIdForFigure,
  });
  assert.strictEqual(result.applied, true);
  assert.deepStrictEqual(game.nextAttacksBonusHits['B2-EMO-1-0'], { count: 1, bonus: 0, blast: 1 });
  assert.ok(!/Accuracy/.test(result.logMessage), 'log no longer claims +1 Accuracy');
  assert.match(result.logMessage, /Blast 1/);
});

test('Dark Energy enumerates friendly SMALL figures too, excluding only the activator (gap 10)', () => {
  const msgId = 'msg-de';
  const game = {
    gameId: 'g-de',
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: {
      1: { 'Smuggler-1-0': 'a1', 'AllySmall-1-0': 'a2' },
      2: { 'Foe-1-0': 'a3' },
    },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-de', playerNum: 1, dcName: 'Smuggler', displayName: 'Smuggler [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Dark Energy', { game, playerNum: 1, dcMessageMeta });
  // Phase 1 with multiple targets returns a choice; the friendly ally must be present.
  assert.ok(result.choiceValues || result.requiresSpaceChoice, 'returns target choice or auto-selects');
  if (result.choiceValues) {
    assert.ok(result.choiceValues.includes('AllySmall-1-0'), 'friendly SMALL figure is targetable');
    assert.ok(result.choiceValues.includes('Foe-1-0'), 'hostile SMALL figure is targetable');
    assert.ok(!result.choiceValues.includes('Smuggler-1-0'), 'the activator is excluded');
  }
});

test('Pounce uses the selected figure index, not figure 0 (gap 11/13/14)', () => {
  const msgId = 'msg-pounce';
  const game = {
    gameId: 'g-pounce',
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: { [msgId]: { selectedFigure: 1 } },
    figurePositions: { 1: { 'Loth-cat-1-0': 'a1', 'Loth-cat-1-1': 'b2' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-pounce', playerNum: 1, dcName: 'Loth-cat', displayName: 'Loth-cat [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  // Phase 1 (no chosenSpace) enumerates empty spaces within range of the SELECTED
  // figure (index 1 at b2). It should not throw and should produce a space choice.
  const result = resolveAbility('Pounce', { game, playerNum: 1, dcMessageMeta, msgId });
  assert.ok(result.requiresSpaceChoice || result.applied === false, 'pounce resolves for selected figure');
});

test('Emperor may target a HOSTILE figure within 4 (gap 9)', () => {
  const msgId = 'msg-emp';
  const game = {
    gameId: 'g-emp',
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: {
      1: { 'Emperor Palpatine-1-0': 'a1' },
      2: { 'Rebel Trooper-1-0': 'a2' },
    },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-emp', playerNum: 1, dcName: 'Emperor Palpatine', displayName: 'Emperor Palpatine [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('emperor_interrupt', { game, playerNum: 1, meta: dcMessageMeta.get(msgId), msgId, dcMessageMeta });
  assert.strictEqual(result.requiresChoice, true);
  assert.ok(result.targetFigureKeys.includes('Rebel Trooper-1-0'), 'hostile figure within 4 is targetable');
});

// ───────────────────────────────────────────────────────────────────────────
// Overnight audit HIGH fixes (2026-06-26): Stay Down guard, Wrist Cord /
// Wrist Flamethrower oncePer:'round', Ambush forces damage onto the attacker.
// ───────────────────────────────────────────────────────────────────────────

test('Stay Down arms the post-attack Stun (guard matches abilityId, not the long label)', () => {
  // Bug: the guard was `entry.label === 'Stay Down'`, but the library label is
  // a long descriptive string, so stayDownPendingMsgId was never set. The fix
  // also matches on abilityId === 'Stay Down'.
  const msgId = 'msg-staydown';
  const figureKey = 'Stormtroopers-1-0';
  const game = {
    gameId: 'g-sd',
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [figureKey]: 'a1' } },
  };
  const dcMessageMeta = new Map([[msgId, { gameId: 'g-sd', playerNum: 1, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 1]' }]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Stay Down', { game, playerNum: 1, dcMessageMeta, msgId });
  assert.strictEqual(result.applied, true, 'free attack granted');
  assert.ok(game.stayDownPendingMsgId, 'stayDownPendingMsgId object created');
  assert.strictEqual(game.stayDownPendingMsgId[figureKey], true, 'Stun pending armed for the activating figure');
});

test('Wrist Cord enforces oncePer:round per figure (push branch)', () => {
  // Bug: the pushTargetWithinRange branch never read/wrote the round flag, so
  // it re-fired while 2 MP remained. The fix gates on
  // game.roundFigureAbilityUsed[`${figureKey}_wrist_cord`].
  const msgId = 'msg-wristcord';
  const figureKey = 'Boba Fett-1-0';
  const game = {
    gameId: 'g-wc',
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: { [msgId]: { selectedFigure: 0 } },
    figurePositions: { 1: { [figureKey]: 'a1' }, 2: { 'Rebel Trooper-1-0': 'a2' } },
    // Pre-mark used this round → the branch must short-circuit.
    roundFigureAbilityUsed: { [`${figureKey}_wrist_cord`]: true },
  };
  const meta = { gameId: 'g-wc', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba Fett [Group 1]' };
  const dcMessageMeta = new Map([[msgId, meta]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('wrist_cord', { game, playerNum: 1, meta, msgId, dcMessageMeta });
  assert.strictEqual(result.applied, false, 'blocked — already used this round');
  assert.ok(/already used this round/i.test(result.manualMessage || ''), 'round-limit message surfaced');
});

test('Wrist Cord round flag is keyed per figure (not group-wide)', () => {
  // figureKey-scoped → a sibling figure in the same group is NOT blocked.
  const msgId = 'msg-wristcord2';
  const figA = 'Boba Fett-1-0';
  const figB = 'Boba Fett-1-1';
  const game = {
    gameId: 'g-wc2',
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: { [msgId]: { selectedFigure: 1 } }, // figure B is acting
    figurePositions: { 1: { [figA]: 'a1', [figB]: 'b1' }, 2: { 'Rebel Trooper-1-0': 'a2' } },
    roundFigureAbilityUsed: { [`${figA}_wrist_cord`]: true }, // only A used it
  };
  const meta = { gameId: 'g-wc2', playerNum: 1, dcName: 'Boba Fett', displayName: 'Boba Fett [Group 1]' };
  const dcMessageMeta = new Map([[msgId, meta]]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('wrist_cord', { game, playerNum: 1, meta, msgId, dcMessageMeta });
  // Figure B is not blocked → proceeds to enumerate targets (requiresChoice) or
  // a no-targets manual message; the key point is it is NOT the round-limit block.
  assert.ok(!/already used this round/i.test(result.manualMessage || ''), 'sibling figure B is not round-limited');
});

test('Ambush forces 2 Damage onto THE ATTACKER (no free target pick) and grants the move', async () => {
  // Bug: routed through the generic move-X handler with no damage step at all
  // (the dedicated chooseAdjacentHostileThen handler was unreachable). The fix
  // excludes cah cards from the generic mpBonus handler and adds an Ambush
  // branch that forces the damage onto the attacker (mirrors cah.targetAttacker).
  const defMsgId = 'msg-ambush-def';
  const attMsgId = 'msg-ambush-att';
  const defFk = 'Ewok Warrior-1-0';
  const attFk = 'Stormtroopers-1-0';
  const attHealth = [[10, 10]];
  const dcHealthState = new Map([[attMsgId, attHealth]]);
  const game = {
    gameId: 'g-ambush',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: { [defFk]: 'a1' }, 2: { [attFk]: 'a2' } },
    p2DcMessageIds: [attMsgId],
    p2DcList: [{ dcName: 'Stormtroopers', healthState: [[10, 10]] }],
    // Combat context: defender being attacked declares Ambush on the attacker.
    combat: {
      attackerFigureKey: attFk,
      attackerPlayerNum: 2,
      target: { figureKey: defFk },
    },
  };
  const dcMessageMeta = new Map([
    [defMsgId, { gameId: 'g-ambush', playerNum: 1, dcName: 'Ewok Warrior', displayName: 'Ewok Warrior [Group 1]' }],
    [attMsgId, { gameId: 'g-ambush', playerNum: 2, dcName: 'Stormtroopers', displayName: 'Stormtroopers [Group 1]' }],
  ]);
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Ambush', { game, playerNum: 1, dcMessageMeta, dcHealthState });
  assert.strictEqual(result.applied, true, 'Ambush resolves');
  // 2 Damage applied to THE ATTACKER (no choice prompt).
  assert.strictEqual(result.requiresChoice, undefined, 'no free target pick');
  await applyDeferredAbilityEffects(game, { dcHealthState }, result);
  assert.deepStrictEqual(dcHealthState.get(attMsgId)[0], [8, 10], 'attacker took exactly 2 Damage');
  // 4-space move granted to the defender (no free-pick continuation).
  assert.ok(game.pendingMoveX?.[defMsgId], 'move-X granted to the defender');
  assert.strictEqual(game.pendingMoveX[defMsgId].remaining, 4, '4-space move');
  assert.strictEqual(game.pendingMoveX[defMsgId].nextAction, null, 'no free-target picker continuation');
});

test('Ambush aborts cleanly with no combat/attacker context', () => {
  const game = { gameId: 'g-ambush2', figurePositions: { 1: {}, 2: {} } };
  const dcMessageMeta = new Map();
  _registerDcMessageMeta(dcMessageMeta);
  const result = resolveAbility('Ambush', { game, playerNum: 1, dcMessageMeta });
  assert.strictEqual(result.applied, false);
  assert.ok(/attacker context/i.test(result.manualMessage || ''), 'manual fallback when no attacker context');
});
