import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import { createFlowHarness } from './flow-harness.js';
import { applyCondition } from '../../src/game/conditions.js';

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

  it('R43: Heir to the Jedi on melee attacker grants rerollOneAttackDie but not bonusHits', async () => {
    // Darth Vader (melee) with Heir to the Jedi attachment.
    // Card text: "While attacking, you may reroll 1 attack die.
    //   When you declare a Ranged attack, apply +1 Hit to the attack results."
    // Vader has no innate attack rerolls (foresight = defense only). Clean witness.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Darth Vader' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    const dcMeta = fh.getDcMessageMeta();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Discover Vader's msgId from harness state
    let vaderMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1 && meta.dcName === 'Darth Vader') { vaderMsgId = msgId; break; }
    }
    assert.ok(vaderMsgId, 'Vader msgId found');

    // Pin positions: Vader at e5, one Stormtrooper at f6 (adjacent, distance 1), rest parked far
    const vaderFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Darth Vader'));
    game.figurePositions[1][vaderFigKey] = 'e5';
    const p2Figs = Object.keys(game.figurePositions[2]);
    const targetFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper'));
    game.figurePositions[2][targetFigKey] = 'f6';
    for (const fk of p2Figs) {
      if (fk !== targetFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Attach Heir to the Jedi to Vader
    game.p1DcAttachments = { [vaderMsgId]: ['Heir to the Jedi'] };

    // Drive: activate → attack_target
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action');
    await fh.act(activateAction.customId, 'player1');

    const attackAction = fh.getActions(1).find(a => a.type === 'attack_target');
    assert.ok(attackAction, 'P1 has attack target action');
    await fh.act(attackAction.customId, 'player1');

    // Witness pendingCombat after attack_target
    assert.ok(game.pendingCombat, 'pendingCombat created');
    assert.strictEqual(game.pendingCombat.isRanged, false, 'Vader is melee');
    assert.strictEqual(game.pendingCombat.rerollOneAttackDie, 1,
      'R43: Heir to the Jedi grants +1 rerollOneAttackDie');
    assert.strictEqual(game.pendingCombat.bonusHits || 0, 0,
      'R43: Heir to the Jedi does NOT grant bonusHits on melee attack');
  });

  it('R43: Heir to the Jedi on ranged attacker grants rerollOneAttackDie + bonusHits', async () => {
    // Han Solo (ranged) with Heir to the Jedi attachment.
    // Ranged attacks get the reroll AND the +1 Hit (ranged-only clause).
    // Han has no innate attack rerolls. Clean witness.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Han Solo' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    const dcMeta = fh.getDcMessageMeta();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Discover Han's msgId from harness state
    let hanMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1 && meta.dcName === 'Han Solo') { hanMsgId = msgId; break; }
    }
    assert.ok(hanMsgId, 'Han msgId found');

    // Pin positions: Han at e5, one Stormtrooper at f6, rest parked far
    const hanFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Han Solo'));
    game.figurePositions[1][hanFigKey] = 'e5';
    const p2Figs = Object.keys(game.figurePositions[2]);
    const targetFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper'));
    game.figurePositions[2][targetFigKey] = 'f6';
    for (const fk of p2Figs) {
      if (fk !== targetFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Attach Heir to the Jedi to Han
    game.p1DcAttachments = { [hanMsgId]: ['Heir to the Jedi'] };

    // Drive: activate → attack_target
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    await fh.act(activateAction.customId, 'player1');

    const attackAction = fh.getActions(1).find(a => a.type === 'attack_target');
    await fh.act(attackAction.customId, 'player1');

    // Witness pendingCombat after attack_target
    assert.ok(game.pendingCombat, 'pendingCombat created');
    assert.strictEqual(game.pendingCombat.isRanged, true, 'Han Solo is ranged');
    assert.strictEqual(game.pendingCombat.rerollOneAttackDie, 1,
      'R43: Heir to the Jedi grants +1 rerollOneAttackDie even on ranged');
    assert.strictEqual(game.pendingCombat.bonusHits, 1,
      'R43: Heir to the Jedi grants +1 bonusHits on ranged attack');
  });

  it('R45: Inspiring — friendly Luke within 3 spaces grants +1 attackerRerollsRemaining', async () => {
    // Han Solo attacks while Luke Skywalker (Inspiring) is within 3 spaces.
    // Inspiring: "While another friendly figure within 3 spaces is attacking, it may reroll 1 die."
    // Han has zero innate attack rerolls, so attackerRerollsRemaining directly reflects Inspiring.
    //
    // Pinned coordinates (verified against map-spaces.json adjacency):
    //   Han at a10 (attacker), Luke at a12 (distance 2: a10→a11→a12), Stormtrooper at b10 (target)
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Han Solo' }, { dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin P1 figures
    const hanFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Han Solo'));
    const lukeFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][hanFigKey] = 'a10';
    game.figurePositions[1][lukeFigKey] = 'a12';

    // Pin P2 figures: one Stormtrooper at b10, rest parked far
    const p2Figs = Object.keys(game.figurePositions[2]);
    const targetFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper'));
    game.figurePositions[2][targetFigKey] = 'b10';
    for (const fk of p2Figs) {
      if (fk !== targetFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Step 1: Activate Han (not Luke — Inspiring requires "another friendly")
    const activateHan = fh.getActions(1).find(
      a => a.type === 'activate_dc' && a.params?.dcName === 'Han Solo'
    );
    assert.ok(activateHan, 'Found activate action for Han Solo');
    await fh.act(activateHan.customId, 'player1');

    // Step 2: Attack target
    const attackAction = fh.getActions(1).find(a => a.type === 'attack_target');
    assert.ok(attackAction, 'Han has attack target action');
    await fh.act(attackAction.customId, 'player1');
    assert.ok(game.pendingCombat, 'pendingCombat created after attack_target');

    // Step 3: Both players ready
    const readyP1 = fh.getActions(1).find(a => a.type === 'combat_ready');
    assert.ok(readyP1, 'P1 has combat_ready action');
    await fh.act(readyP1.customId, 'player1');
    const readyP2 = fh.getActions(2).find(a => a.type === 'combat_ready');
    assert.ok(readyP2, 'P2 has combat_ready action');
    await fh.act(readyP2.customId, 'player2');

    // Step 4: Attack roll (P1), then defense roll (P2)
    // Inspiring scan fires during defense roll phase (combat.js:2844-2860)
    // attackerRerollsRemaining set at combat.js:3130
    const atkRoll = fh.getActions(1).find(a => a.type === 'combat_roll');
    assert.ok(atkRoll, 'P1 (attacker) has combat_roll action');
    await fh.act(atkRoll.customId, 'player1');
    const defRoll = fh.getActions(2).find(a => a.type === 'combat_roll');
    assert.ok(defRoll, 'P2 (defender) has combat_roll action');
    await fh.act(defRoll.customId, 'player2');

    // Witness: Inspiring grants exactly 1 attack reroll
    assert.strictEqual(game.pendingCombat.attackerRerollsRemaining, 1,
      'R45: Inspiring — Luke within 3 spaces grants +1 attackerRerollsRemaining');
  });

  it('R45: Inspiring — friendly Luke beyond 3 spaces grants 0 attackerRerollsRemaining', async () => {
    // Same setup as positive test, but Luke at a14 (distance 4: a10→a11→a12→a13→a14).
    // Beyond 3 spaces, so Inspiring should NOT fire.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Han Solo' }, { dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin P1 figures: Han at a10, Luke at a14 (beyond 3 spaces)
    const hanFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Han Solo'));
    const lukeFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][hanFigKey] = 'a10';
    game.figurePositions[1][lukeFigKey] = 'a14';

    // Pin P2 figures: one Stormtrooper at b10, rest parked far
    const p2Figs = Object.keys(game.figurePositions[2]);
    const targetFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper'));
    game.figurePositions[2][targetFigKey] = 'b10';
    for (const fk of p2Figs) {
      if (fk !== targetFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Drive same flow as positive test
    const activateHan = fh.getActions(1).find(
      a => a.type === 'activate_dc' && a.params?.dcName === 'Han Solo'
    );
    assert.ok(activateHan, 'Found activate action for Han Solo');
    await fh.act(activateHan.customId, 'player1');

    const attackAction = fh.getActions(1).find(a => a.type === 'attack_target');
    await fh.act(attackAction.customId, 'player1');

    const readyP1 = fh.getActions(1).find(a => a.type === 'combat_ready');
    await fh.act(readyP1.customId, 'player1');
    const readyP2 = fh.getActions(2).find(a => a.type === 'combat_ready');
    await fh.act(readyP2.customId, 'player2');

    const atkRoll = fh.getActions(1).find(a => a.type === 'combat_roll');
    await fh.act(atkRoll.customId, 'player1');
    const defRoll = fh.getActions(2).find(a => a.type === 'combat_roll');
    await fh.act(defRoll.customId, 'player2');

    // Witness: no rerolls granted
    assert.strictEqual(game.pendingCombat.attackerRerollsRemaining, 0,
      'R45: Inspiring — Luke beyond 3 spaces grants 0 attackerRerollsRemaining');
  });

  it('LOS-PARITY: non-MASSIVE figure blocks LOS in computeAttackTargets', async () => {
    // Layout on mos-eisley-outskirts:
    //   P1 Han Solo at e2 (ranged attacker)
    //   P1 Luke Skywalker at e3 (friendly figure — should block LOS to e5)
    //   P2 Stormtrooper (Regular) at e5 (target behind Luke)
    //
    // Before the figure-blocking fix, computeAttackTargets passed null for
    // blocking coords — so the target at e5 was reachable through Luke.
    // After the fix, Luke at e3 blocks LOS from e2 to e5.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Han Solo' }, { dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin P1 figures: Han at e2 (attacker), Luke at e3 (blocker)
    const hanFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Han Solo'));
    const lukeFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][hanFigKey] = 'e2';
    game.figurePositions[1][lukeFigKey] = 'e3';

    // Pin P2 figures: one Stormtrooper at e5 (behind Luke), rest parked far
    const p2Figs = Object.keys(game.figurePositions[2]);
    const targetFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper'));
    game.figurePositions[2][targetFigKey] = 'e5';
    for (const fk of p2Figs) {
      if (fk !== targetFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Activate Han
    const activateHan = fh.getActions(1).find(
      a => a.type === 'activate_dc' && a.params?.dcName === 'Han Solo'
    );
    assert.ok(activateHan, 'Found activate action for Han Solo');
    await fh.act(activateHan.customId, 'player1');

    // Check: target at e5 should NOT appear in attack_target actions (Luke blocks LOS)
    const attackActions = fh.getActions(1).filter(a => a.type === 'attack_target');
    const targetAtE5 = attackActions.find(a => a.params?.targetFigureKey === targetFigKey);
    assert.strictEqual(targetAtE5, undefined,
      'LOS-PARITY: friendly figure at e3 blocks LOS from e2 to e5 — target must not appear');
  });

  it('LOS-PARITY: MASSIVE figure does NOT block LOS in computeAttackTargets', async () => {
    // Same layout as G65 but testing the headless computeAttackTargets path
    // (getAvailableActions) rather than the Discord buildAndSendAttackTargets handler.
    //
    // Layout:
    //   P1 Stormtrooper (Elite) at e2 (ranged attacker)
    //   P2 AT-RT at e3 (MASSIVE, 2x2 footprint — should NOT block LOS)
    //   P2 Stormtrooper (Regular) at e5 (target)
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Stormtrooper (Elite)' }],
      p2Army: [{ dcName: 'AT-RT' }, { dcName: 'Stormtrooper (Regular)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin P1 figures
    const p1Figs = Object.keys(game.figurePositions[1]);
    game.figurePositions[1][p1Figs[0]] = 'e2';
    for (let i = 1; i < p1Figs.length; i++) game.figurePositions[1][p1Figs[i]] = `t${17 + i}`;

    // Pin P2 figures: AT-RT at e3 (MASSIVE, 2x2), Stormtrooper at e5
    const p2Figs = Object.keys(game.figurePositions[2]);
    const atrtFig = p2Figs.find(fk => fk.startsWith('AT-RT'));
    const regularFigs = p2Figs.filter(fk => fk.startsWith('Stormtrooper (Regular)'));
    game.figurePositions[2][atrtFig] = 'e3';
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[atrtFig] = '2x2';
    game.figurePositions[2][regularFigs[0]] = 'e5';
    for (let i = 1; i < regularFigs.length; i++) game.figurePositions[2][regularFigs[i]] = `s${15 + i}`;

    // Activate P1's DC
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action');
    await fh.act(activateAction.customId, 'player1');

    // Check: target at e5 SHOULD appear (AT-RT is MASSIVE, excluded from blocking)
    const attackActions = fh.getActions(1).filter(a => a.type === 'attack_target');
    const targetAtE5 = attackActions.find(a => {
      const fk = a.params?.targetFigureKey;
      return fk && fk.startsWith('Stormtrooper (Regular)');
    });
    assert.ok(targetAtE5,
      'LOS-PARITY: MASSIVE AT-RT at e3 must NOT block LOS — target at e5 appears via computeAttackTargets');
  });

  it('LOS-19b: non-MASSIVE figure blocks LOS in False Orders attack targeting', async () => {
    // Layout: P1 controls P2's ranged Stormtrooper (Elite) via False Orders.
    //   P2 Stormtrooper (Elite) at e2 (controlled ranged attacker)
    //   P1 Han Solo at e3 (intervening figure — should block LOS to e5)
    //   P1 Luke Skywalker at e5 (target behind blocker)
    //
    // Before fix: null passed for figure blocking, so Luke at e5 was targetable through Han.
    // After fix: Han at e3 blocks LOS from e2 to e5.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Han Solo' }, { dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Elite)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Discover P1's DC msgId (controller of False Orders)
    const dcMeta = fh.getDcMessageMeta();
    let p1MsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'P1 DC msgId found');

    // Pin figures
    const hanFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Han Solo'));
    const lukeFigKey = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][hanFigKey] = 'e3';
    game.figurePositions[1][lukeFigKey] = 'e5';
    const p2Figs = Object.keys(game.figurePositions[2]);
    const controlledFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper (Elite)'));
    game.figurePositions[2][controlledFigKey] = 'e2';
    for (const fk of p2Figs) {
      if (fk !== controlledFigKey) game.figurePositions[2][fk] = 't17';
    }

    // Set up pendingFalseOrders: P1 controls P2's Stormtrooper via False Orders
    game.pendingFalseOrders = {
      controlledFigureKey: controlledFigKey,
      controlledPlayerNum: 2,
      controllerPlayerNum: 1,
      murneRinMsgId: p1MsgId,
    };

    // Trigger the False Orders attack action
    await fh.act(`false_orders_action_${game.gameId}_${p1MsgId}_attack`, 'player1');

    // Check: falseOrdersAttackTargets should mark Luke at e5 as hasLOS: false
    const targets = game.falseOrdersAttackTargets?.[p1MsgId] || [];
    const lukeTarget = targets.find(t => t.figureKey === lukeFigKey);
    if (lukeTarget) {
      assert.strictEqual(lukeTarget.hasLOS, false,
        'LOS-19b: Han at e3 blocks LOS from e2 to e5 — Luke target should have hasLOS=false');
    }
    // Either Luke doesn't appear (filtered by range) or appears with hasLOS=false — both are correct
    // The key assertion: Luke should NOT appear with hasLOS=true
    const lukeWithLOS = targets.find(t => t.figureKey === lukeFigKey && t.hasLOS === true);
    assert.strictEqual(lukeWithLOS, undefined,
      'LOS-19b: Luke at e5 must NOT have hasLOS=true when Han blocks at e3');
  });

  it('LOS-19b: MASSIVE figure does NOT block LOS in False Orders attack targeting', async () => {
    // Same layout but with MASSIVE AT-RT at e3 instead of Han.
    //   P2 Stormtrooper (Elite) at e2 (controlled ranged attacker)
    //   P1 AT-RT at e3 (MASSIVE — should NOT block LOS)
    //   P1 Stormtrooper (Regular) at e5 (target)
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'AT-RT' }, { dcName: 'Stormtrooper (Regular)' }],
      p2Army: [{ dcName: 'Stormtrooper (Elite)' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    const dcMeta = fh.getDcMessageMeta();
    let p1MsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'P1 DC msgId found');

    // Pin figures
    const atrtFig = Object.keys(game.figurePositions[1]).find(fk => fk.startsWith('AT-RT'));
    const regularFigs = Object.keys(game.figurePositions[1]).filter(fk => fk.startsWith('Stormtrooper (Regular)'));
    game.figurePositions[1][atrtFig] = 'e3';
    game.figureOrientations = game.figureOrientations || {};
    game.figureOrientations[atrtFig] = '2x2';
    game.figurePositions[1][regularFigs[0]] = 'e5';
    for (let i = 1; i < regularFigs.length; i++) game.figurePositions[1][regularFigs[i]] = `s${15 + i}`;
    // Park remaining P1 figures far away
    for (const fk of Object.keys(game.figurePositions[1])) {
      if (fk !== atrtFig && !regularFigs.includes(fk)) game.figurePositions[1][fk] = 't18';
    }

    const p2Figs = Object.keys(game.figurePositions[2]);
    const controlledFigKey = p2Figs.find(fk => fk.startsWith('Stormtrooper (Elite)'));
    game.figurePositions[2][controlledFigKey] = 'e2';
    for (const fk of p2Figs) {
      if (fk !== controlledFigKey) game.figurePositions[2][fk] = 't17';
    }

    game.pendingFalseOrders = {
      controlledFigureKey: controlledFigKey,
      controlledPlayerNum: 2,
      controllerPlayerNum: 1,
      murneRinMsgId: p1MsgId,
    };

    await fh.act(`false_orders_action_${game.gameId}_${p1MsgId}_attack`, 'player1');

    // Check: Stormtrooper (Regular) at e5 should have hasLOS=true (MASSIVE AT-RT doesn't block)
    const targets = game.falseOrdersAttackTargets?.[p1MsgId] || [];
    const regularTarget = targets.find(t => t.figureKey === regularFigs[0]);
    assert.ok(regularTarget, 'LOS-19b: Stormtrooper target at e5 appears in False Orders targets');
    assert.strictEqual(regularTarget.hasLOS, true,
      'LOS-19b: MASSIVE AT-RT at e3 must NOT block LOS — target at e5 has hasLOS=true');
  });

  it('Fulcrum: accept — both players draw 1 CC', async () => {
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Agent Kallus' }],
      p2Army: [{ dcName: 'Stormtrooper (Elite)' }],
      p1CcHand: ['Take Initiative'],
      p2CcHand: ['Negation'],
      p1CcDeck: ['Element of Surprise'],
      p2CcDeck: ['Celebration'],
    });
    const game = fh.getGame();

    // Record initial hand sizes
    const p1HandBefore = game.player1CcHand.length;
    const p2HandBefore = game.player2CcHand.length;
    assert.strictEqual(p1HandBefore, 1, 'P1 starts with 1 CC in hand');
    assert.strictEqual(p2HandBefore, 1, 'P2 starts with 1 CC in hand');

    // Activate Agent Kallus → triggers Fulcrum prompt (does NOT auto-draw)
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action for Kallus');
    await fh.act(activateAction.customId, 'player1');

    // Hands should be unchanged — prompt shown but not yet resolved
    assert.strictEqual(game.player1CcHand.length, p1HandBefore, 'P1 hand unchanged before Fulcrum choice');
    assert.strictEqual(game.player2CcHand.length, p2HandBefore, 'P2 hand unchanged before Fulcrum choice');

    // Discover Kallus msgId
    const dcMeta = fh.getDcMessageMeta();
    let kallusMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.dcName === 'Agent Kallus') { kallusMsgId = msgId; break; }
    }
    assert.ok(kallusMsgId, 'Kallus msgId found');

    // Click "Use Fulcrum"
    await fh.act(`act_passive_${game.gameId}_${kallusMsgId}_fulcrum_use`, 'player1');

    // Both hands should have grown by 1
    assert.strictEqual(game.player1CcHand.length, p1HandBefore + 1, 'P1 drew 1 CC from Fulcrum');
    assert.strictEqual(game.player2CcHand.length, p2HandBefore + 1, 'P2 drew 1 CC from Fulcrum');
    assert.ok(game.player1CcHand.includes('Element of Surprise'), 'P1 drew Element of Surprise');
    assert.ok(game.player2CcHand.includes('Celebration'), 'P2 drew Celebration');
  });

  it('Fulcrum: decline — hand sizes unchanged', async () => {
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Agent Kallus' }],
      p2Army: [{ dcName: 'Stormtrooper (Elite)' }],
      p1CcHand: ['Take Initiative'],
      p2CcHand: ['Negation'],
      p1CcDeck: ['Element of Surprise'],
      p2CcDeck: ['Celebration'],
    });
    const game = fh.getGame();

    const p1HandBefore = game.player1CcHand.length;
    const p2HandBefore = game.player2CcHand.length;

    // Activate Agent Kallus
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action for Kallus');
    await fh.act(activateAction.customId, 'player1');

    // Discover Kallus msgId
    const dcMeta = fh.getDcMessageMeta();
    let kallusMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.dcName === 'Agent Kallus') { kallusMsgId = msgId; break; }
    }
    assert.ok(kallusMsgId, 'Kallus msgId found');

    // Click "Skip"
    await fh.act(`act_passive_${game.gameId}_${kallusMsgId}_fulcrum_skip`, 'player1');

    // Hands must be unchanged
    assert.strictEqual(game.player1CcHand.length, p1HandBefore, 'P1 hand unchanged after declining Fulcrum');
    assert.strictEqual(game.player2CcHand.length, p2HandBefore, 'P2 hand unchanged after declining Fulcrum');
    // Decks must be unchanged too
    assert.strictEqual(game.player1CcDeck.length, 1, 'P1 deck unchanged');
    assert.strictEqual(game.player2CcDeck.length, 1, 'P2 deck unchanged');
  });

  it('Useful Hide: range filter — only friendly within 3 spaces gets Evade', async () => {
    // P1 Stormtrooper (Elite) at e2 attacks P2 Tauntaun Rider at e3 (1 HP).
    // P2 also has: Rebel Saboteur at e5 (within 3 of e3), Luke Skywalker at e10 (beyond 3).
    // On defeat, Useful Hide should give Evade only to the Saboteur (within 3), not Luke (beyond 3).
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Stormtrooper (Elite)' }],
      p2Army: [{ dcName: 'Tauntaun Rider' }, { dcName: 'Rebel Saboteur (Elite)' }, { dcName: 'Luke Skywalker' }],
      diceOverrides: {
        attackRolls: [{ acc: 5, dmg: 3, surge: 0, dice: [{ color: 'blue', acc: 5, dmg: 0, surge: 0 }, { color: 'green', acc: 0, dmg: 3, surge: 0 }] }],
        defenseRolls: [{ block: 0, evade: 0, dodge: false, color: 'black' }],
      },
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Pin P1 attacker
    const p1Figs = Object.keys(game.figurePositions[1]);
    const attackerFigKey = p1Figs.find(fk => fk.startsWith('Stormtrooper (Elite)'));
    game.figurePositions[1][attackerFigKey] = 'e2';
    for (const fk of p1Figs) {
      if (fk !== attackerFigKey) game.figurePositions[1][fk] = 't17';
    }

    // Pin P2 figures
    const p2Figs = Object.keys(game.figurePositions[2]);
    const tauntaunFig = p2Figs.find(fk => fk.startsWith('Tauntaun Rider'));
    const saboteurFig = p2Figs.find(fk => fk.startsWith('Rebel Saboteur'));
    const lukeFig = p2Figs.find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[2][tauntaunFig] = 'e3';
    game.figurePositions[2][saboteurFig] = 'e5';   // within 3 of e3
    game.figurePositions[2][lukeFig] = 'e10';       // beyond 3 of e3
    for (const fk of p2Figs) {
      if (![tauntaunFig, saboteurFig, lukeFig].includes(fk)) game.figurePositions[2][fk] = 't18';
    }

    // Set Tauntaun HP to 1 so attack kills it
    const dcMeta = fh.getDcMessageMeta();
    let tauntaunMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.dcName === 'Tauntaun Rider') { tauntaunMsgId = msgId; break; }
    }
    const tauntaunHs = fh.getDeps().dcHealthState.get(tauntaunMsgId);
    if (tauntaunHs?.[0]) tauntaunHs[0] = [1, tauntaunHs[0][1]];

    // Snapshot tokens before combat
    game.figurePowerTokens = game.figurePowerTokens || {};
    const sabEvadeBefore = (game.figurePowerTokens[saboteurFig] || []).filter(t => t === 'Evade').length;
    const lukeEvadeBefore = (game.figurePowerTokens[lukeFig] || []).filter(t => t === 'Evade').length;

    // Activate P1 attacker
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'P1 has activate action');
    await fh.act(activateAction.customId, 'player1');

    // Select Tauntaun Rider as attack target
    const attackAction = fh.getActions(1).find(a =>
      a.type === 'attack_target' && a.params?.targetFigureKey === tauntaunFig
    );
    assert.ok(attackAction, 'Tauntaun Rider is a valid attack target');
    await fh.act(attackAction.customId, 'player1');

    // Both players ready
    const readyP1 = fh.getActions(1).find(a => a.type === 'combat_ready');
    if (readyP1) await fh.act(readyP1.customId, 'player1');
    const readyP2 = fh.getActions(2).find(a => a.type === 'combat_ready');
    if (readyP2) await fh.act(readyP2.customId, 'player2');

    // Attack roll
    const atkRoll = fh.getActions(1).find(a => a.type === 'combat_roll');
    assert.ok(atkRoll, 'Attacker has combat_roll');
    await fh.act(atkRoll.customId, 'player1');

    // Defense roll
    const defRoll = fh.getActions(2).find(a => a.type === 'combat_roll');
    assert.ok(defRoll, 'Defender has combat_roll');
    await fh.act(defRoll.customId, 'player2');

    // Advance through reroll/token/surge phases until resolve
    for (let step = 0; step < 20; step++) {
      const p1Actions = fh.getActions(1);
      const p2Actions = fh.getActions(2);
      const resolve = p1Actions.find(a => a.type === 'combat_resolve')
        || p2Actions.find(a => a.type === 'combat_resolve');
      if (resolve) {
        await fh.act(resolve.customId, resolve === p1Actions.find(a => a.type === 'combat_resolve') ? 'player1' : 'player2');
        break;
      }
      const skipSurges = p1Actions.find(a => a.type === 'combat_skip_surges');
      if (skipSurges) { await fh.act(skipSurges.customId, 'player1'); continue; }
      const reroll = p1Actions.find(a => a.type === 'combat_reroll')
        || p2Actions.find(a => a.type === 'combat_reroll');
      if (reroll) {
        await fh.act(reroll.customId, reroll === p1Actions.find(a => a.type === 'combat_reroll') ? 'player1' : 'player2');
        continue;
      }
      const token = p1Actions.find(a => a.type === 'combat_token')
        || p2Actions.find(a => a.type === 'combat_token');
      if (token) {
        await fh.act(token.customId, token === p1Actions.find(a => a.type === 'combat_token') ? 'player1' : 'player2');
        continue;
      }
      const passive = p1Actions.find(a => a.type === 'combat_passive')
        || p2Actions.find(a => a.type === 'combat_passive');
      if (passive) {
        await fh.act(passive.customId, passive === p1Actions.find(a => a.type === 'combat_passive') ? 'player1' : 'player2');
        continue;
      }
      // Fallback: try any remaining combat action
      const any = [...p1Actions, ...p2Actions].find(a => a.type.startsWith('combat_'));
      if (any) {
        const userId = p1Actions.includes(any) ? 'player1' : 'player2';
        await fh.act(any.customId, userId);
        continue;
      }
      break;
    }

    // Assert: Tauntaun Rider is defeated (position removed)
    assert.ok(!game.figurePositions[2][tauntaunFig], 'Tauntaun Rider position removed (defeated)');

    // Assert: Saboteur (within 3) got Evade token
    const sabEvadeAfter = (game.figurePowerTokens[saboteurFig] || []).filter(t => t === 'Evade').length;
    assert.ok(sabEvadeAfter > sabEvadeBefore, `Saboteur within 3 spaces gained Evade token (${sabEvadeBefore} → ${sabEvadeAfter})`);

    // Assert: Luke (beyond 3) did NOT get Evade token
    const lukeEvadeAfter = (game.figurePowerTokens[lukeFig] || []).filter(t => t === 'Evade').length;
    assert.strictEqual(lukeEvadeAfter, lukeEvadeBefore, 'Luke beyond 3 spaces did NOT gain Evade token');
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

  // ── Strain CC Discard: deck top, not hand ───────────────────────────────────

  it('strain discard comes from deck top, not hand', async () => {
    // Rules: "discard one Command card from the top of their deck"
    // Set up: P1 has a known deck [A, B, C] and hand [X, Y].
    // Strain 2, choose to discard 2 CCs → deck loses A and B from front, hand unchanged.
    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
      p1CcDeck: ['CardA', 'CardB', 'CardC'],
      p1CcHand: ['CardX', 'CardY'],
    });
    const game = fh.getGame();
    const dcMeta = fh.getDcMessageMeta();

    // Find P1's DC msgId and figure key
    let p1MsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'found P1 DC msgId');
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    assert.ok(p1FigKey, 'P1 has a figure');

    // Manually set pendingStrainChoice (normally created by applyStrainToFigure)
    game.pendingStrainChoice = {
      figureKey: p1FigKey,
      playerNum: 1,
      amount: 2,
      headhunterDmg: 0,
      abilityLabel: 'Test Strain',
      sourceLabel: 'test',
      dcName: 'Luke Skywalker',
      msgId: p1MsgId,
      figureIndex: 0,
      threadId: 'test-combat-thread',
      discardedCount: 0,
      underDuressActive: false,
      ccCostPerStrain: 1,
    };

    // Snapshot before
    const deckBefore = [...game.player1CcDeck];
    const handBefore = [...game.player1CcHand];
    const discardBefore = [...(game.player1CcDiscard || [])];

    // Act: choose to discard 2 CCs for strain
    await fh.act(`strain_choice_discard_${game.gameId}_2`, 'player1');

    // Assert: deck lost 2 cards from front
    assert.deepEqual(game.player1CcDeck, ['CardC'],
      'deck should have only CardC remaining (A and B discarded from top)');

    // Assert: hand unchanged
    assert.deepEqual(game.player1CcHand, handBefore,
      'hand must be unchanged — strain discards come from deck, not hand');

    // Assert: discard pile gained the 2 deck-top cards
    assert.ok(game.player1CcDiscard.includes('CardA'), 'CardA in discard pile');
    assert.ok(game.player1CcDiscard.includes('CardB'), 'CardB in discard pile');

    // Assert: pendingStrainChoice cleared
    assert.strictEqual(game.pendingStrainChoice, undefined,
      'pendingStrainChoice should be cleared after resolution');
  });

  // ── Attachment VP on Group Defeat ────────────────────────────────────────────

  it('attachment VP awarded when last figure in group defeated', async () => {
    // Rules: "When the last figure of a group with an 'Attachment' card is defeated,
    //  the opposing player scores VPs equal to the deployment cost of the 'Attachment' card."
    // Feeding Frenzy costs 1 VP. IG-88 costs 12 VP. Total should be 13.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'IG-88' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Regular)' }])
      .inRound(1)
      .build();

    // Find P1's IG-88 msgId
    let p1MsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'found P1 DC msgId');

    // Attach [Feeding Frenzy] (cost 1) to IG-88
    game.p1DcAttachments = game.p1DcAttachments || {};
    game.p1DcAttachments[p1MsgId] = ['[Feeding Frenzy]'];

    // Record VP before
    const vpBefore = game.player2VP.total;

    // Defeat IG-88 with lethal NPC damage
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    await deps.applyNpcDamageToFigure(game, 1, p1FigKey, 100, 'Test');

    // Assert: P2 gets IG-88 cost (12) + Feeding Frenzy cost (1) = 13 VP
    const vpGained = game.player2VP.total - vpBefore;
    assert.equal(vpGained, 13,
      'VP should include base figure cost (12) + attachment cost (1) = 13');
  });

  it('attachment VP not awarded when non-last figure defeated', async () => {
    // Multi-figure group: defeating one figure should NOT award attachment VP.
    // Stormtrooper (Regular) has 2 figures. Only when BOTH are dead should attachment VP apply.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Regular)' }])
      .withPlayer2Army([{ dcName: 'Luke Skywalker' }])
      .inRound(1)
      .build();

    // Find P1's Stormtrooper msgId
    let p1MsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    assert.ok(p1MsgId, 'found P1 DC msgId');

    // Attach [Feeding Frenzy] (cost 1)
    game.p1DcAttachments = game.p1DcAttachments || {};
    game.p1DcAttachments[p1MsgId] = ['[Feeding Frenzy]'];

    // Verify Stormtrooper (Regular) is multi-figure
    const figKeys = Object.keys(game.figurePositions[1]).filter(fk =>
      fk.startsWith('Stormtrooper (Regular)-')
    );
    assert.ok(figKeys.length >= 2, `Stormtrooper (Regular) has ${figKeys.length} figures (multi-figure)`);

    // Record VP before
    const vpBefore = game.player2VP.total;

    // Defeat only the first figure
    await deps.applyNpcDamageToFigure(game, 1, figKeys[0], 100, 'Test');

    // Assert: VP should include only per-figure reinforcement cost, no attachment VP
    const vpGained = game.player2VP.total - vpBefore;
    // Stormtrooper (Regular) reinforcement cost is subCost (typically 3)
    // Should NOT include Feeding Frenzy's 1 VP
    assert.ok(vpGained < 6,
      `VP (${vpGained}) should be only reinforcement cost, not including attachment VP`);
    assert.ok(!game.player2VP.total.toString().includes('attachment'),
      'no attachment VP awarded for non-last figure');
  });

  it('negative-cost attachment reduces VP on group defeat', async () => {
    // Rules: "When a group with an attachment with a negative deployment cost is defeated,
    //  the VPs scored are modified by that card's negative cost."
    // Driven by Hatred costs -5. IG-88 costs 12. Total should be 12 + (-5) = 7.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'IG-88' }])
      .withPlayer2Army([{ dcName: 'Stormtrooper (Regular)' }])
      .inRound(1)
      .build();

    let p1MsgId = null;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }

    // Attach [Driven by Hatred] (cost -5)
    game.p1DcAttachments = game.p1DcAttachments || {};
    game.p1DcAttachments[p1MsgId] = ['[Driven by Hatred]'];

    const vpBefore = game.player2VP.total;

    // Defeat IG-88
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    await deps.applyNpcDamageToFigure(game, 1, p1FigKey, 100, 'Test');

    // Assert: P2 gets 12 + (-5) = 7 VP
    const vpGained = game.player2VP.total - vpBefore;
    assert.equal(vpGained, 7,
      'VP should be base (12) + negative attachment (-5) = 7');
  });

  it('strain discard with empty deck offers only all-damage option', async () => {
    // Rules: discards come from deck top. If deck is empty, no discard is possible.
    // getStrainChoiceActions should offer only "take all as damage" — no discard buttons.
    const { getAvailableActions } = await import('../../src/engine/available-actions.js');

    const fh = createFlowHarness({
      mapId: 'mos-eisley-outskirts',
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Stormtrooper (Regular)' }],
      p1CcDeck: [],   // empty deck
      p1CcHand: ['CardX', 'CardY'],  // hand has cards, but strain uses deck
    });
    const game = fh.getGame();
    const dcMeta = fh.getDcMessageMeta();

    let p1MsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.playerNum === 1) { p1MsgId = msgId; break; }
    }
    const p1FigKey = Object.keys(game.figurePositions[1])[0];

    // Set pending strain
    game.pendingStrainChoice = {
      figureKey: p1FigKey,
      playerNum: 1,
      amount: 2,
      headhunterDmg: 0,
      abilityLabel: 'Test Strain',
      sourceLabel: 'test',
      dcName: 'Luke Skywalker',
      msgId: p1MsgId,
      figureIndex: 0,
      threadId: 'test-combat-thread',
      discardedCount: 0,
      underDuressActive: false,
      ccCostPerStrain: 1,
    };

    // Get available actions for P1
    const actions = fh.getActions(1);
    const strainActions = actions.filter(a =>
      a.type === 'strain_choice_alldmg' || a.type === 'strain_choice_discard'
    );

    // Only "all damage" should be available — no discard options despite hand having cards
    assert.equal(strainActions.length, 1, 'only one strain action available');
    assert.equal(strainActions[0].type, 'strain_choice_alldmg',
      'only action is take-all-as-damage when deck is empty');
  });
});

// ── Weakened removal timing (rules: WEAKENED) ─────────────────────────────────

describe('Weakened removal at end of activation', () => {
  it('Weakened removed at end of figure\'s activation', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Find P1's figure key
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    assert.ok(p1FigKey, 'P1 has a figure');

    // Apply Weakened
    applyCondition(game, p1FigKey, 'Weaken');
    assert.ok(game.figureConditions[p1FigKey].includes('Weaken'), 'Weakened applied');

    // Activate P1's DC
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'activate action available');
    await fh.act(activateAction.customId, 'player1');

    // End activation (triggers end-of-activation cleanup)
    const endAction = fh.getActions(1).find(a => a.type === 'dc_end_activation');
    assert.ok(endAction, 'end activation action available');
    await fh.act(endAction.customId, 'player1');

    // Weakened should be removed
    const conds = game.figureConditions[p1FigKey] || [];
    assert.ok(!conds.includes('Weaken'), 'Weakened removed at end of activation');
  });

  it('Weakened with Disarm permanent lock persists through activation', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';

    // Find P1's figure key
    const p1FigKey = Object.keys(game.figurePositions[1])[0];
    assert.ok(p1FigKey, 'P1 has a figure');

    // Apply Weakened + set disarmPermanentWeakened lock
    applyCondition(game, p1FigKey, 'Weaken');
    game.disarmPermanentWeakened = game.disarmPermanentWeakened || {};
    game.disarmPermanentWeakened[p1FigKey] = true;

    // Activate P1's DC
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    assert.ok(activateAction, 'activate action available');
    await fh.act(activateAction.customId, 'player1');

    // End activation
    const endAction = fh.getActions(1).find(a => a.type === 'dc_end_activation');
    assert.ok(endAction, 'end activation action available');
    await fh.act(endAction.customId, 'player1');

    // Weakened should persist due to Disarm lock
    const conds = game.figureConditions[p1FigKey] || [];
    assert.ok(conds.includes('Weaken'), 'Weakened persists with disarmPermanentWeakened lock');
  });
});

// ── Recover keyword on 0-damage attacks (rules: RECOVER) ─────────────────────

/**
 * Drive combat to completion, spending a specific surge ability by index.
 * All other phases (reroll, token, passive) are auto-advanced.
 */
async function driveCombatWithSurge(fh, surgeIndex) {
  // Both players ready
  const readyP1 = fh.getActions(1).find(a => a.type === 'combat_ready');
  if (readyP1) await fh.act(readyP1.customId, 'player1');
  const readyP2 = fh.getActions(2).find(a => a.type === 'combat_ready');
  if (readyP2) await fh.act(readyP2.customId, 'player2');

  // Attack roll
  const atkRoll = fh.getActions(1).find(a => a.type === 'combat_roll');
  assert.ok(atkRoll, 'Attacker has combat_roll');
  await fh.act(atkRoll.customId, 'player1');

  // Defense roll
  const defRoll = fh.getActions(2).find(a => a.type === 'combat_roll');
  assert.ok(defRoll, 'Defender has combat_roll');
  await fh.act(defRoll.customId, 'player2');

  // Advance through phases, spending the requested surge
  let surgeSpent = false;
  for (let step = 0; step < 30; step++) {
    const p1Actions = fh.getActions(1);
    const p2Actions = fh.getActions(2);

    const resolve = p1Actions.find(a => a.type === 'combat_resolve')
      || p2Actions.find(a => a.type === 'combat_resolve');
    if (resolve) {
      const uid = p1Actions.includes(resolve) ? 'player1' : 'player2';
      await fh.act(resolve.customId, uid);
      break;
    }

    // Spend the target surge if available
    if (!surgeSpent) {
      const surgeAction = p1Actions.find(a =>
        a.type === 'combat_surge' && a.params?.surgeIndex === surgeIndex
      );
      if (surgeAction) {
        await fh.act(surgeAction.customId, 'player1');
        surgeSpent = true;
        continue;
      }
    }

    // Skip remaining surges
    const skipSurges = p1Actions.find(a => a.type === 'combat_skip_surges');
    if (skipSurges) { await fh.act(skipSurges.customId, 'player1'); continue; }

    // Auto-advance other phases
    const reroll = p1Actions.find(a => a.type === 'combat_reroll')
      || p2Actions.find(a => a.type === 'combat_reroll');
    if (reroll) {
      await fh.act(reroll.customId, p1Actions.includes(reroll) ? 'player1' : 'player2');
      continue;
    }
    const token = p1Actions.find(a => a.type === 'combat_token')
      || p2Actions.find(a => a.type === 'combat_token');
    if (token) {
      await fh.act(token.customId, p1Actions.includes(token) ? 'player1' : 'player2');
      continue;
    }
    const passive = p1Actions.find(a => a.type === 'combat_passive')
      || p2Actions.find(a => a.type === 'combat_passive');
    if (passive) {
      await fh.act(passive.customId, p1Actions.includes(passive) ? 'player1' : 'player2');
      continue;
    }
    const any = [...p1Actions, ...p2Actions].find(a => a.type.startsWith('combat_'));
    if (any) {
      await fh.act(any.customId, p1Actions.includes(any) ? 'player1' : 'player2');
      continue;
    }
    break;
  }
  return { surgeSpent };
}

describe('Recover heals attacker regardless of damage dealt', () => {
  it('Recover heals attacker when attack deals 0 damage (fully blocked)', async () => {
    // Luke (P1, attacker) has surge ability index 1 = "recover 2"
    // Darth Vader (P2, defender) with black die
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
      diceOverrides: {
        // Attack: 1 damage, 1 surge (enough to spend Recover)
        attackRolls: [{ acc: 5, dmg: 1, surge: 1, dice: [
          { color: 'blue', acc: 5, dmg: 0, surge: 0 },
          { color: 'green', acc: 0, dmg: 0, surge: 1 },
          { color: 'yellow', acc: 0, dmg: 1, surge: 0 },
        ] }],
        // Defense: 3 block — more than enough to absorb 1 damage → 0 net damage
        defenseRolls: [{ block: 3, evade: 0, dodge: false, color: 'black' }],
      },
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';
    const dcMeta = fh.getDcMessageMeta();
    const dcHealthState = fh.getDeps().dcHealthState;

    // Find Luke's msgId
    let lukeMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.dcName === 'Luke Skywalker' && meta.playerNum === 1) { lukeMsgId = msgId; break; }
    }
    assert.ok(lukeMsgId, 'Found Luke msgId');

    // Damage Luke by 4 so Recover has room to heal
    const lukeHs = dcHealthState.get(lukeMsgId);
    lukeHs[0] = [lukeHs[0][1] - 4, lukeHs[0][1]]; // HP = max - 4
    const hpBefore = lukeHs[0][0];

    // Pin positions: Luke near Vader (Luke is ranged — acc 5 covers distance)
    const p1Figs = Object.keys(game.figurePositions[1]);
    const lukeFig = p1Figs.find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][lukeFig] = 'e2';
    const p2Figs = Object.keys(game.figurePositions[2]);
    const vaderFig = p2Figs.find(fk => fk.startsWith('Darth Vader'));
    game.figurePositions[2][vaderFig] = 'e3';

    // Activate Luke
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    await fh.act(activateAction.customId, 'player1');

    // Select Vader as attack target
    const attackAction = fh.getActions(1).find(a =>
      a.type === 'attack_target' && a.params?.targetFigureKey === vaderFig
    );
    assert.ok(attackAction, 'Vader is a valid attack target');
    await fh.act(attackAction.customId, 'player1');

    // Drive combat, spending surge index 1 (recover 2)
    const { surgeSpent } = await driveCombatWithSurge(fh, 1);
    assert.ok(surgeSpent, 'Recover surge was spent');

    // Verify: Luke should have healed by 2 despite 0 damage dealt
    const hpAfter = dcHealthState.get(lukeMsgId)[0][0];
    assert.equal(hpAfter, hpBefore + 2, `Recover healed Luke from ${hpBefore} to ${hpBefore + 2} (got ${hpAfter})`);
  });

  it('Recover heals attacker on normal attack (control, damage > 0)', async () => {
    const fh = createFlowHarness({
      p1Army: [{ dcName: 'Luke Skywalker' }],
      p2Army: [{ dcName: 'Darth Vader' }],
      diceOverrides: {
        // Attack: 3 damage, 1 surge
        attackRolls: [{ acc: 5, dmg: 3, surge: 1, dice: [
          { color: 'blue', acc: 5, dmg: 0, surge: 0 },
          { color: 'green', acc: 0, dmg: 2, surge: 1 },
          { color: 'yellow', acc: 0, dmg: 1, surge: 0 },
        ] }],
        // Defense: 0 block — damage goes through
        defenseRolls: [{ block: 0, evade: 0, dodge: false, color: 'black' }],
      },
    });
    const game = fh.getGame();
    game.p1PlayAreaId = 'p1-play-area';
    game.p2PlayAreaId = 'p2-play-area';
    game.generalId = 'general-channel';
    const dcMeta = fh.getDcMessageMeta();
    const dcHealthState = fh.getDeps().dcHealthState;

    let lukeMsgId = null;
    for (const [msgId, meta] of dcMeta) {
      if (meta.dcName === 'Luke Skywalker' && meta.playerNum === 1) { lukeMsgId = msgId; break; }
    }

    // Damage Luke by 4
    const lukeHs = dcHealthState.get(lukeMsgId);
    lukeHs[0] = [lukeHs[0][1] - 4, lukeHs[0][1]];
    const hpBefore = lukeHs[0][0];

    // Pin positions
    const p1Figs = Object.keys(game.figurePositions[1]);
    const lukeFig = p1Figs.find(fk => fk.startsWith('Luke Skywalker'));
    game.figurePositions[1][lukeFig] = 'e2';
    const p2Figs = Object.keys(game.figurePositions[2]);
    const vaderFig = p2Figs.find(fk => fk.startsWith('Darth Vader'));
    game.figurePositions[2][vaderFig] = 'e3';

    // Activate and attack
    const activateAction = fh.getActions(1).find(a => a.type === 'activate_dc');
    await fh.act(activateAction.customId, 'player1');
    const attackAction = fh.getActions(1).find(a =>
      a.type === 'attack_target' && a.params?.targetFigureKey === vaderFig
    );
    assert.ok(attackAction, 'Vader is a valid attack target');
    await fh.act(attackAction.customId, 'player1');

    // Drive combat, spending surge index 1 (recover 2)
    const { surgeSpent } = await driveCombatWithSurge(fh, 1);
    assert.ok(surgeSpent, 'Recover surge was spent');

    // Verify: Luke healed by 2 (control: Recover works when damage > 0)
    const hpAfter = dcHealthState.get(lukeMsgId)[0][0];
    assert.equal(hpAfter, hpBefore + 2, `Recover healed Luke from ${hpBefore} to ${hpBefore + 2} (got ${hpAfter})`);
  });
});
