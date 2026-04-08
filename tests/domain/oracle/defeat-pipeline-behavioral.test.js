/**
 * BEHAVIORAL oracle tests for processFigureDefeat.
 *
 * Unlike the structural oracles (defeat-pipeline-oracles.test.js) which grep source
 * files, these tests actually INVOKE processFigureDefeat with real game state and
 * injected deps, then assert observable game-state mutations.
 *
 * Test categories:
 *   B-DEFEAT-001–008: Direct invocation — each side effect asserted independently
 *   B-DEFEAT-E2E-001: End-to-end via Dioxis Fumes ability → defeatedFigures → processFigureDefeat
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../../fixtures/game-builder.js';
import { resolveAbility } from '../../../src/game/abilities.js';

// ── Helper: find a player's DC msgId from dcMessageMeta ─────────────────────

function findMsgId(dcMessageMeta, playerNum, dcNamePrefix) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.playerNum === playerNum && meta.dcName.startsWith(dcNamePrefix)) return msgId;
  }
  return null;
}

function findDcIdx(game, playerNum, dcNamePrefix) {
  const dcList = playerNum === 1 ? game.p1DcList : game.p2DcList;
  return dcList.findIndex(dc => (dc.dcName || dc).startsWith(dcNamePrefix));
}

// ── B-DEFEAT-001: Position removal + conditions cleanup ─────────────────────

describe('B-DEFEAT-001: processFigureDefeat removes position and conditions', () => {
  it('figure removed from figurePositions and conditions cleaned', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const figKey = Object.keys(game.figurePositions[2])[0];
    assert.ok(figKey, 'P2 has a figure');
    assert.ok(game.figurePositions[2][figKey], 'figure has a position');

    // Give the figure a condition to verify cleanup
    game.figureConditions = game.figureConditions || {};
    game.figureConditions[figKey] = ['Stunned'];

    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Assert position removed
    assert.equal(game.figurePositions[2][figKey], undefined, 'figure position removed');
    // Assert conditions cleaned
    assert.equal(game.figureConditions[figKey], undefined, 'figure conditions cleaned');
  });
});

// ── B-DEFEAT-002: VP award ──────────────────────────────────────────────────

describe('B-DEFEAT-002: processFigureDefeat awards VP to attacker', () => {
  it('attacker gains kill VP equal to deployment cost', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const vpBefore = game.player1VP.total;
    const killsBefore = game.player1VP.kills;
    const figKey = Object.keys(game.figurePositions[2])[0];
    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    const result = await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    assert.ok(result.vp > 0, `VP awarded should be positive (got ${result.vp})`);
    assert.equal(game.player1VP.kills, killsBefore + result.vp, 'kills VP incremented');
    assert.equal(game.player1VP.total, vpBefore + result.vp, 'total VP incremented');
  });
});

// ── B-DEFEAT-003: VP suppression (awardVp: false) ──────────────────────────

describe('B-DEFEAT-003: processFigureDefeat suppresses VP when awardVp=false', () => {
  it('no VP awarded but position still removed', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const vpBefore = game.player1VP.total;
    const figKey = Object.keys(game.figurePositions[2])[0];
    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    const result = await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Adrenaline',
      awardVp: false,
    });

    assert.equal(result.vp, 0, 'VP should be 0 when suppressed');
    assert.equal(game.player1VP.total, vpBefore, 'total VP unchanged');
    assert.equal(game.figurePositions[2][figKey], undefined, 'position still removed');
  });
});

// ── B-DEFEAT-004: Activation decrement on group defeat ──────────────────────

describe('B-DEFEAT-004: processFigureDefeat decrements activations when group fully defeated', () => {
  it('activations remaining decremented after last figure in group defeated', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }, { dcName: 'Stormtrooper (Elite)' }])
      .inRound(1)
      .build();

    // Imperial Officer has 1 figure — defeating it wipes the group
    const activsBefore = game.p2ActivationsRemaining;
    const figKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(figKey, 'found Imperial Officer figure');

    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Activation count should decrease (recomputeActivationCounts called)
    assert.ok(
      game.p2ActivationsRemaining < activsBefore || game.p2ActivationsTotal < activsBefore,
      `activations should decrease (was ${activsBefore}, now remaining=${game.p2ActivationsRemaining}, total=${game.p2ActivationsTotal})`
    );
  });
});

// ── B-DEFEAT-005: CC attachment cleanup ─────────────────────────────────────

describe('B-DEFEAT-005: processFigureDefeat clears CC attachments on group defeat', () => {
  it('CC attachments for the DC message are deleted', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const figKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    // Plant a CC attachment on the DC
    game.p2CcAttachments = game.p2CcAttachments || {};
    game.p2CcAttachments[msgId] = ['Comm Disruption'];

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // CC attachment should be cleaned up
    assert.ok(
      !game.p2CcAttachments[msgId]?.length,
      'CC attachments for defeated DC should be cleared'
    );
  });
});

// ── B-DEFEAT-006: Passive redraw (Shared Experience) ────────────────────────

describe('B-DEFEAT-006: processFigureDefeat triggers passive CC redraws', () => {
  it('Shared Experience redrawn from discard when DROID defeated', async () => {
    // Probe Droid (Elite) is a DROID — its defeat should trigger Shared Experience redraw
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Probe Droid (Elite)' }])
      .inRound(1)
      .build();

    const figKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Probe Droid (Elite)-'));
    assert.ok(figKey, 'found Probe Droid (Elite) figure');

    const msgId = findMsgId(dcMessageMeta, 2, 'Probe Droid (Elite)');
    const dcIdx = findDcIdx(game, 2, 'Probe Droid (Elite)');

    // Place "Shared Experience" in P2's discard pile
    game.player2CcDiscard = ['Shared Experience'];
    game.player2CcHand = game.player2CcHand || [];
    const handBefore = [...game.player2CcHand];

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Shared Experience should move from discard to hand
    assert.ok(
      !game.player2CcDiscard.includes('Shared Experience'),
      'Shared Experience removed from discard'
    );
    assert.ok(
      game.player2CcHand.includes('Shared Experience'),
      'Shared Experience added to hand'
    );
  });
});

// ── B-DEFEAT-007: Nefarious Gains (Jabba VP) ───────────────────────────────

describe('B-DEFEAT-007: processFigureDefeat triggers Nefarious Gains', () => {
  it('Jabba owner gains 1 objective VP when hostile figure defeated', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jabba the Hutt' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Verify Jabba is alive on P1
    const jabbaAlive = Object.keys(game.figurePositions[1]).some(fk => fk.startsWith('Jabba the Hutt-'));
    assert.ok(jabbaAlive, 'Jabba is alive on P1');

    const vpBefore = game.player1VP.total;
    const objBefore = game.player1VP.objectives;

    const figKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Jabba gains 1 objective VP (from Nefarious Gains) + kill VP from the defeat itself
    const killVp = game.player1VP.kills;
    assert.ok(
      game.player1VP.objectives > objBefore,
      `Jabba should gain objective VP (was ${objBefore}, now ${game.player1VP.objectives})`
    );
  });
});

// ── B-DEFEAT-008: Heroic Effort pending state ───────────────────────────────

describe('B-DEFEAT-008: processFigureDefeat sets Heroic Effort pending state', () => {
  it('draws CC and sets pendingHeroicEffortReturn when unique figure defeated', async () => {
    // IG-88 is unique. P2 needs [Heroic Effort] in dcList + cards in deck.
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'IG-88' }])
      .withPlayer2CcDeck(['Card A', 'Card B', 'Card C', 'Card D', 'Card E', 'Card F'])
      .inRound(1)
      .build();

    // Manually add [Heroic Effort] to P2's dcList (it's a special upgrade card)
    game.p2DcList.push({ dcName: '[Heroic Effort]', displayName: '[Heroic Effort]', healthState: [] });

    const figKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('IG-88-'));
    assert.ok(figKey, 'found IG-88 figure');

    const msgId = findMsgId(dcMessageMeta, 2, 'IG-88');
    const dcIdx = findDcIdx(game, 2, 'IG-88');

    const deckBefore = game.player2CcDeck.length;
    const handBefore = game.player2CcHand.length;

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // Heroic Effort: draw 1 CC from deck, set pending return state
    assert.equal(
      game.player2CcDeck.length, deckBefore - 1,
      'one card drawn from deck'
    );
    assert.equal(
      game.player2CcHand.length, handBefore + 1,
      'one card added to hand'
    );
    assert.ok(
      game.pendingHeroicEffortReturn?.[2],
      'pendingHeroicEffortReturn set for P2'
    );
  });
});

// ── B-DEFEAT-009: Win condition check fires ─────────────────────────────────

describe('B-DEFEAT-009: processFigureDefeat triggers win condition check', () => {
  it('game ends when last figure defeated (elimination)', async () => {
    const { game, deps, dcMessageMeta } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Imperial Officer is the only P2 figure
    const figKey = Object.keys(game.figurePositions[2])[0];
    const msgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const dcIdx = findDcIdx(game, 2, 'Imperial Officer');

    assert.equal(game.ended, false, 'game not ended before');

    await deps.processFigureDefeat(game, {
      defeatedPlayerNum: 2,
      figureKey: figKey,
      attackerPlayerNum: 1,
      msgId,
      dcIdx,
      source: 'Test',
    });

    // P2 has no figures left → elimination win
    assert.ok(game.ended, 'game should end on elimination');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E2E TEST: Dioxis Fumes → defeatedFigures → processFigureDefeat
// ══════════════════════════════════════════════════════════════════════════════

describe('B-DEFEAT-E2E-001: Dioxis Fumes → processFigureDefeat end-to-end', () => {
  it('ability resolution + processFigureDefeat produces correct game state', async () => {
    // Build a game where Dioxis Fumes will kill a figure at 1 HP.
    // Use the game builder for proper headless wiring, then manually reduce HP.
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Jabba the Hutt' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    // Reduce Imperial Officer to 1 HP so Dioxis Fumes kills it
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    assert.ok(officerMsgId, 'found Imperial Officer msgId');
    const healthArr = dcHealthState.get(officerMsgId);
    assert.ok(healthArr, 'health state exists');
    healthArr[0][0] = 1; // set current HP to 1

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'Imperial Officer figure exists');
    assert.ok(game.figurePositions[2][officerFigKey], 'figure has position');

    const vpBefore = game.player1VP.total;

    // Step 1: Resolve Dioxis Fumes ability (same as abilities.js does)
    const result = resolveAbility('cc:dioxis_fumes', {
      game,
      playerNum: 1,  // P1 plays the card
      dcMessageMeta,
      dcHealthState,
    });

    assert.ok(result.applied, 'Dioxis Fumes resolved');
    assert.ok(result.defeatedFigures?.length > 0, 'defeatedFigures returned');

    // Figure should still be in figurePositions (not removed inline)
    assert.ok(
      game.figurePositions[2][officerFigKey],
      'figure NOT removed inline by abilities.js'
    );

    // Step 2: Process defeated figures — mimics headless-cc-play.js processDefeatedFigures
    for (const df of result.defeatedFigures) {
      await deps.processFigureDefeat(game, {
        defeatedPlayerNum: df.defeatedPlayerNum,
        figureKey: df.figureKey,
        attackerPlayerNum: df.attackerPlayerNum,
        source: df.source || '',
      });
    }

    // Step 3: Assert all side effects
    // 3a. Position removed
    assert.equal(
      game.figurePositions[2][officerFigKey], undefined,
      'E2E: figure position removed after processFigureDefeat'
    );

    // 3b. VP awarded to attacker (P1)
    assert.ok(
      game.player1VP.total > vpBefore,
      `E2E: VP awarded (was ${vpBefore}, now ${game.player1VP.total})`
    );

    // 3c. Nefarious Gains — Jabba is on P1, hostile figure defeated → +1 objective VP
    assert.ok(
      game.player1VP.objectives > 0,
      `E2E: Nefarious Gains fired (objectives VP = ${game.player1VP.objectives})`
    );

    // 3d. Win condition fired — P2 has no figures → elimination
    assert.ok(game.ended, 'E2E: game ended by elimination win condition');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E2E TESTS: Main Combat Damage → processFigureDefeat (Phase 2)
//
// These tests exercise the REAL combat resolution path:
//   resolveCombatAfterRolls → applyDamageAndFinishCombat → processFigureDefeat
// proving that the highest-traffic defeat pipeline now routes through the
// canonical defeat handler.
// ══════════════════════════════════════════════════════════════════════════════

// ── Helper: build a minimal combat object for resolveCombatAfterRolls ──────

function buildCombat(game, dcMessageMeta, opts = {}) {
  const attackerPN = opts.attackerPlayerNum || 1;
  const defenderPN = attackerPN === 1 ? 2 : 1;
  let attackerMsgId, attackerMeta, defenderMsgId, defenderMeta;
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta.gameId !== game.gameId) continue;
    if (meta.playerNum === attackerPN && !attackerMsgId) {
      attackerMsgId = msgId;
      attackerMeta = meta;
    }
    if (meta.playerNum === defenderPN && !defenderMsgId) {
      defenderMsgId = msgId;
      defenderMeta = meta;
    }
  }
  const defenderFigKey = Object.keys(game.figurePositions[defenderPN])[0];
  const attackerFigKey = Object.keys(game.figurePositions[attackerPN])[0];
  return {
    gameId: game.gameId,
    attackerPlayerNum: attackerPN,
    defenderPlayerNum: defenderPN,
    attackerMsgId,
    attackerDcName: attackerMeta.dcName,
    defenderDcName: defenderMeta?.dcName,
    attackerDisplayName: attackerMeta.displayName || attackerMeta.dcName,
    attackerFigureIndex: 0,
    attackerFigureKey: attackerFigKey,
    attackerConds: [],
    defenderConds: [],
    target: {
      msgId: defenderMsgId,
      figureKey: defenderFigKey,
      label: defenderMeta.displayName || defenderMeta.dcName,
    },
    targetStats: { defense: ['black'], cost: 5, figures: 1 },
    attackInfo: { dice: ['blue', 'green'], type: 'melee' },
    isRanged: false,
    distanceToTarget: 1,
    combatThreadId: 'defeat-e2e-combat-thread',
    combatDeclareMsgId: 'defeat-e2e-declare',
    combatPreMsgId: 'defeat-e2e-pre',
    attackRoll: opts.attackRoll || { acc: 5, dmg: 6, surge: 0 },
    defenseRoll: opts.defenseRoll || { block: 0, evade: 0, dodge: false },
    surgeConditions: opts.surgeConditions || [],
    bonusConditions: [],
    surgeDamage: opts.surgeDamage || 0,
    surgePierce: opts.surgePierce || 0,
    surgeAccuracy: 0,
    bonusSurgeAbilities: [],
    bonusHits: 0,
    bonusPierce: 0,
    bonusAccuracy: 0,
    bonusBlock: 0,
    bonusEvade: 0,
    surgeBlast: 0,
    bonusBlast: 0,
    surgeCleave: 0,
    bonusCleave: 0,
    surgeRecover: 0,
    p1Ready: true,
    p2Ready: true,
    attackTargetMsgId: 'defeat-e2e-target',
    ...(opts.extra || {}),
  };
}

// ── B-DEFEAT-E2E-COMBAT-001: Combat kill → processFigureDefeat core ────────

describe('B-DEFEAT-E2E-COMBAT-001: Combat damage kill routes through processFigureDefeat', () => {
  it('position removed + VP awarded through canonical defeat pipeline', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');

    // Reduce HP to 1 so combat damage of 6 definitely kills
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1; // 1 HP remaining

    const vpBefore = game.player1VP.total;

    // Attack roll: 6 dmg, defense: 0 block → 6 final damage, kills the 1-HP officer
    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 6, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Position removed (proves processFigureDefeat step 1 ran)
    assert.equal(
      game.figurePositions[2][officerFigKey], undefined,
      'COMBAT-E2E: figure position removed'
    );

    // VP awarded (proves processFigureDefeat step 2 ran)
    assert.ok(
      game.player1VP.total > vpBefore,
      `COMBAT-E2E: VP awarded (${vpBefore} → ${game.player1VP.total})`
    );

    // Win condition fired — P2 eliminated (proves processFigureDefeat + caller checkWinConditions)
    assert.ok(game.ended, 'COMBAT-E2E: game ended by elimination');
  });
});

// ── B-DEFEAT-E2E-COMBAT-002: Combat kill + Heroic Effort ───────────────────
//
// This test proves a PREVIOUSLY MISSING feature: Heroic Effort now fires
// from the main combat damage path because it goes through processFigureDefeat.

describe('B-DEFEAT-E2E-COMBAT-002: Combat kill triggers Heroic Effort (previously missing)', () => {
  it('unique figure killed via combat → CC drawn + pending return state', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'IG-88' }])
      .withPlayer2CcDeck(['Card A', 'Card B', 'Card C', 'Card D', 'Card E', 'Card F'])
      .inRound(1)
      .build();

    // Add [Heroic Effort] to P2's dcList
    game.p2DcList.push({ dcName: '[Heroic Effort]', displayName: '[Heroic Effort]', healthState: [] });

    const ig88FigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('IG-88-'));
    assert.ok(ig88FigKey, 'P2 IG-88 figure exists');

    // Reduce IG-88 to 1 HP
    const ig88MsgId = findMsgId(dcMessageMeta, 2, 'IG-88');
    const healthArr = dcHealthState.get(ig88MsgId);
    healthArr[0][0] = 1;

    const deckBefore = game.player2CcDeck.length;
    const handBefore = game.player2CcHand.length;

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 6, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Position removed
    assert.equal(game.figurePositions[2][ig88FigKey], undefined, 'COMBAT-E2E: IG-88 position removed');

    // Heroic Effort: CC drawn from deck
    assert.equal(
      game.player2CcDeck.length, deckBefore - 1,
      'COMBAT-E2E: Heroic Effort drew 1 card from deck'
    );
    assert.equal(
      game.player2CcHand.length, handBefore + 1,
      'COMBAT-E2E: Heroic Effort added 1 card to hand'
    );

    // Heroic Effort: pending return state set
    assert.ok(
      game.pendingHeroicEffortReturn?.[2],
      'COMBAT-E2E: pendingHeroicEffortReturn set for P2'
    );
  });
});

// ── B-DEFEAT-E2E-COMBAT-003: skipWinConditions + post-defeat VP ────────────
//
// Proves that processFigureDefeat's win condition check is correctly deferred
// until after combat-specific VP modifications.

describe('B-DEFEAT-E2E-COMBAT-003: Win conditions deferred until after combat VP mods', () => {
  it('game does not prematurely end before combat-specific VP adjustments', async () => {
    const { game, deps, dcMessageMeta, dcHealthState } = createTestGame()
      .withPlayer1Army([{ dcName: 'Stormtrooper (Elite)' }])
      .withPlayer2Army([{ dcName: 'Imperial Officer' }, { dcName: 'Stormtrooper' }])
      .inRound(1)
      .build();

    const officerFigKey = Object.keys(game.figurePositions[2]).find(fk => fk.startsWith('Imperial Officer-'));
    assert.ok(officerFigKey, 'P2 officer figure exists');

    // Reduce officer to 1 HP
    const officerMsgId = findMsgId(dcMessageMeta, 2, 'Imperial Officer');
    const healthArr = dcHealthState.get(officerMsgId);
    healthArr[0][0] = 1;

    // P2 still has Stormtrooper alive, so no elimination. Give P1 38 VP — after kill VP
    // (Imperial Officer costs 2), P1 will be at 40, triggering win. The kill goes through
    // processFigureDefeat which SKIPS win conditions, then combat wrapper checks afterwards.
    game.player1VP.total = 38;
    game.player1VP.kills = 38;

    const combat = buildCombat(game, dcMessageMeta, {
      attackRoll: { acc: 5, dmg: 6, surge: 0 },
      defenseRoll: { block: 0, evade: 0, dodge: false },
    });

    await deps.resolveCombatAfterRolls(game, combat, deps.client);

    // Officer should be defeated
    assert.equal(game.figurePositions[2][officerFigKey], undefined, 'officer defeated');

    // VP threshold reached (38 + 2 = 40)
    assert.ok(game.player1VP.total >= 40, `VP threshold reached: ${game.player1VP.total}`);

    // Game should end (combat wrapper calls checkWinConditions after processFigureDefeat)
    assert.ok(game.ended, 'game ends at 40 VP via deferred win condition check');
  });
});
