import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';

describe('headless combat resolution', () => {
  it('reduces target HP when damage is applied', () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    // Verify initial state
    assert.ok(game, 'game exists');
    assert.ok(dcMessageMeta.size > 0, 'dcMessageMeta populated');
    assert.ok(dcHealthState.size > 0, 'dcHealthState populated');

    // Find P2's DC msgId
    let targetMsgId = null;
    let targetMeta = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.playerNum === 2) {
        targetMsgId = msgId;
        targetMeta = meta;
        break;
      }
    }
    assert.ok(targetMsgId, 'found target DC msgId');

    // Get initial HP
    const initialHealth = dcHealthState.get(targetMsgId);
    assert.ok(initialHealth, 'health state exists for target');
    const initialHp = initialHealth[0][0];
    assert.ok(initialHp > 0, `initial HP is positive: ${initialHp}`);

    // Apply damage using reduceHp
    const { newHp, maxHp, wasDefeated } = deps.reduceHp(dcHealthState, game, targetMsgId, 0, 2, 2);
    assert.equal(newHp, initialHp - 2, 'HP reduced by 2');
    assert.equal(maxHp, initialHp, 'maxHp unchanged');
  });

  it('figure is defeated when HP reaches 0', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    // Find target
    let targetMsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.playerNum === 2) { targetMsgId = msgId; break; }
    }

    const initialHealth = dcHealthState.get(targetMsgId);
    const maxHp = initialHealth[0][1];

    // Deal lethal damage
    const { wasDefeated } = deps.reduceHp(dcHealthState, game, targetMsgId, 0, maxHp + 5, 2);
    assert.ok(wasDefeated, 'figure was defeated');
  });

  it('applyNpcDamageToFigure applies damage and defeats', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    // Find a P2 figure key
    const p2Figs = Object.keys(game.figurePositions[2]);
    assert.ok(p2Figs.length > 0, 'P2 has figures deployed');

    const figKey = p2Figs[0];
    const initialFigCount = p2Figs.length;

    // Apply heavy NPC damage to defeat the figure
    await deps.applyNpcDamageToFigure(game, 2, figKey, 100, 'Test NPC');

    // Figure should be removed from positions
    const remainingFigs = Object.keys(game.figurePositions[2]);
    assert.ok(remainingFigs.length < initialFigCount, 'figure was removed from positions');
    assert.ok(!game.figurePositions[2][figKey], 'specific figure key removed');
  });

  it('checkWinConditions triggers on elimination', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    // Remove all P2 figures to simulate elimination
    game.figurePositions[2] = {};

    const result = await deps.checkWinConditions(game, deps.client);
    assert.ok(result.ended, 'game ended');
    assert.equal(result.winnerId, game.player1Id, 'P1 wins by elimination');
    assert.ok(game.ended, 'game.ended flag set');
  });

  it('RNG-03: melee attackInfo.type produces isRanged=false, ranged produces true', async () => {
    const { getDcStats } = await import('../../src/data-loader.js');

    // Wampa (Elite) — melee, red-only dice pool. Most vulnerable to the old bug.
    const wampaStats = getDcStats('Wampa (Elite)');
    assert.ok(wampaStats?.attack, 'Wampa (Elite) has attack data');
    assert.strictEqual(wampaStats.attack.type, 'melee', 'Wampa attack type is melee');
    const wampaIsRanged = wampaStats.attack.type === 'range';
    assert.strictEqual(wampaIsRanged, false, 'Wampa must NOT be classified as ranged');

    // Gamorrean Guard (Elite) — melee, red-only dice pool.
    const gamorreanStats = getDcStats('Gamorrean Guard (Elite)');
    assert.ok(gamorreanStats?.attack, 'Gamorrean Guard (Elite) has attack data');
    assert.strictEqual(gamorreanStats.attack.type, 'melee', 'Gamorrean attack type is melee');
    const gamorreanIsRanged = gamorreanStats.attack.type === 'range';
    assert.strictEqual(gamorreanIsRanged, false, 'Gamorrean must NOT be classified as ranged');

    // IG-88 — ranged. Verify ranged still works.
    const igStats = getDcStats('IG-88');
    assert.ok(igStats?.attack, 'IG-88 has attack data');
    assert.strictEqual(igStats.attack.type, 'range', 'IG-88 attack type is range');
    const igIsRanged = igStats.attack.type === 'range';
    assert.strictEqual(igIsRanged, true, 'IG-88 must be classified as ranged');

    // Verify no .range property on any attackInfo (confirms fallback was the bug vector)
    assert.strictEqual(wampaStats.attack.range, undefined, 'Wampa attack has no .range property');
    assert.strictEqual(gamorreanStats.attack.range, undefined, 'Gamorrean attack has no .range property');
  });

  it('VP award triggers game end at 40', async () => {
    const { game, deps } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Rebel Saboteur (Elite)' }])
      .inRound(1)
      .build();

    // Set P1 VP to 40
    game.player1VP.total = 40;

    const result = await deps.checkWinConditions(game, deps.client);
    assert.ok(result.ended, 'game ended at 40 VP');
    assert.equal(result.winnerId, game.player1Id, 'P1 wins by VP');
  });
});
