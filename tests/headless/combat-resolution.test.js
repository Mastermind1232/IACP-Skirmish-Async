import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { createFlowHarness } from './flow-harness.js';

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

  it('RNG-01/02: attack target distance uses graph distance via buildAndSendAttackTargets', async () => {
    // Map: mos-eisley-outskirts (flow-harness default, pinned explicitly here).
    // Coords: e5 ↔ f6 are diagonal-adjacent in this map's adjacency graph.
    //   Graph distance = 1 (diagonal neighbors share an edge).
    //   Manhattan distance = 2 (|e-f| + |5-6| = 1+1 = 2).
    // This test exercises the real Discord handler path (buildAndSendAttackTargets)
    // via the flow harness, NOT the headless computeAttackTargets shortcut.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();

    // Set channel IDs so handlers can fetch channels via fake client
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin positions to known diagonal-adjacent pair
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    const p2FigKey = Object.keys(game.figurePositions[2])[0];
    game.figurePositions[1][p1FigKey] = 'e5';
    game.figurePositions[2][p2FigKey] = 'f6';

    // Activate P1's DC
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action');
    await fh.act(activateAction.customId, 'player1');

    // Find and submit attack target
    const attackAction = fh.getActions(1).find(a => a.type === 'attack_target');
    assert.ok(attackAction, 'P1 has attack target action after activation');
    await fh.act(attackAction.customId, 'player1');

    // pendingCombat.distanceToTarget must be graph distance (1), not Manhattan (2)
    assert.ok(game.pendingCombat, 'pendingCombat was created');
    assert.strictEqual(game.pendingCombat.distanceToTarget, 1,
      'Diagonal-adjacent target: graph distance=1, not Manhattan=2');
  });

  it('G65: MASSIVE figure excluded from figure blocking in buildAndSendAttackTargets', async () => {
    // Layout on mos-eisley-outskirts:
    //   P1 Stormtrooper (Elite) fig 0 at e2 (ranged attacker, maxRange=3)
    //   P2 AT-RT at e3 (MASSIVE, 2x2 → footprint e3,f3,e4,f4) — interposed
    //   P2 Stormtrooper (Regular) fig 0 at e5 (target, graph distance ≤3)
    //
    // G65 rule: MASSIVE figures are excluded from the figure-blocking set.
    // Without the exemption, AT-RT cells (e3,e4) block LOS from e2 to e5.
    // With the exemption, LOS passes through and target.hasLOS === true.
    //
    // We submit dc_attack_{msgId}_f0 to exercise the REAL buildAndSendAttackTargets
    // (not the headless computeAttackTargets which uses null figure blocking).
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Stormtrooper (Elite)' }],
      p2Army: [{ dcName: 'AT-RT' }, { dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    const dcMeta = fh.getDcMessageMeta();

    // Set channel IDs so handlers can fetch channels
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Find P1's DC msgId
    let p1MsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1 && meta.gameId === game.gameId) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'P1 DC msgId found');

    // Pin all figure positions to controlled coords
    const p1Figs = Object.keys(game.figurePositions[1]);
    game.figurePositions[1][p1Figs[0]] = 'e2';
    for (let i = 1; i < p1Figs.length; i++) game.figurePositions[1][p1Figs[i]] = `t${17 + i}`;

    const p2Figs = Object.keys(game.figurePositions[2]);
    const atrtFig = p2Figs.find(fk => fk.startsWith('AT-RT'));
    const regularFigs = p2Figs.filter(fk => fk.startsWith('Stormtrooper (Regular)'));
    assert.ok(atrtFig, 'AT-RT figure key found');
    assert.ok(regularFigs.length >= 1, 'Stormtrooper (Regular) figure keys found');

    game.figurePositions[2][atrtFig] = 'e3';
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[atrtFig] = '2x2';
    game.figurePositions[2][regularFigs[0]] = 'e5';
    for (let i = 1; i < regularFigs.length; i++) game.figurePositions[2][regularFigs[i]] = `s${15 + i}`;

    // Activate P1's DC
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action');
    await fh.act(activateAction.customId, 'player1');

    // Submit dc_attack_ to trigger real buildAndSendAttackTargets (not headless shortcut)
    const harness = fh.getHarness();
    await harness.submitAction(`dc_attack_${p1MsgId}_f0`, 'player1');

    // Verify handler-computed targets
    const targetKey = `${p1MsgId}_0`;
    const targets = game.attackTargets?.[targetKey];
    assert.ok(targets, `attackTargets[${targetKey}] populated by buildAndSendAttackTargets`);

    const targetAtE5 = targets.find(t => String(t.coord).toLowerCase() === 'e5');
    assert.ok(targetAtE5, 'Stormtrooper (Regular) at e5 appears in attack targets');
    assert.strictEqual(targetAtE5.hasLOS, true,
      'G65: MASSIVE AT-RT at e3 must NOT block LOS from e2 to e5 — figure excluded from blocking set');
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
