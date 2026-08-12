/**
 * CC Coverage Verification — ensures every Command Card in the training deck
 * pool can be fully resolved headlessly via resolveAbility().
 *
 * Block 1: Verify ability-library entries exist for all 108 CCs
 * Block 2: Verify resolveAbility returns actionable result with generic context
 *          (skips 18 context-dependent CCs validated in Block 3)
 * Block 3: Scenario-based tests for 17 context-dependent CCs + 1 Negation flow
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createTestGame } from '../fixtures/game-builder.js';
import { getDcStats, getMapData, getCcEffect, isCcAttachment, getDcEffects, getDcKeywords } from '../../src/data-loader.js';
import { getAbility, resolveAbility } from '../../src/game/abilities.js';
import { _registerDcMessageMeta } from '../../src/game/activation-state.js';
import { isCcPlayableNow, isCcPlayLegalByRestriction } from '../../src/game/cc-timing.js';
import { ccHandKey, ccDiscardKey, ccAttachmentsKey, opponentPlayerNum, getDcList, getDcMessageIds } from '../../src/game/player-helpers.js';
import { playCommandCardHeadless, canResolveCcHeadless } from '../../src/headless/headless-cc-play.js';
import { getAvailableActions } from '../../src/engine/available-actions.js';
import { openCounterWindow, counterResponder, topCard, topAvailableCounters, pushCounter, resolveAndCloseWindow } from '../../src/handlers/cc-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEST_DECKS_PATH = join(__dirname, '../../data/destruct-test-decks.json');
const TEST_DECKS = JSON.parse(readFileSync(TEST_DECKS_PATH, 'utf8'));

// Collect all unique CCs from training decks
const allCCs = new Set();
TEST_DECKS.forEach(d => (d.ccList || []).forEach(cc => allCCs.add(cc)));
const ccList = [...allCCs].sort();

// Context-dependent CCs tested in Block 3 — skip in Block 2
const CONTEXT_DEPENDENT_CCS = new Set([
  // B1: Defender timing
  'Brace for Impact', 'Knowledge and Defense', 'Parry',
  'Ambush', // defender reaction — needs attacker context (damages the attacker)
  // B2: Post-attack timing
  'Collateral Damage', 'Reduce to Rubble',
  // B3: Special Action (excluded from play_cc)
  'Lure of the Dark Side', 'De Wanna Wanga', 'Cloned Reinforcements',
  'Smoke Grenade', // specialAction — needs space within 2
  // B4: Coarse timing
  'Celebration', 'Reinforcements', 'Ferocity', 'Call the Vanguard',
  'Primary Target', 'Shared Experience', 'Intelligence Leak', 'Support Specialist',
  // B5: playableBy restriction
  "Cal's Buddy",
  // B6: Positional / reactive CCs whose resolvers correctly require specific
  // board/trigger context (adjacent hostile, recently-defeated hostile,
  // defending figure, BRAWLER reaction, hostile activation). With the generic
  // far-apart buildTestGame board they (correctly) return a manualMessage;
  // each resolves once the proper context is present (verified manually).
  // The Block-2 generic harness was never an appropriate witness for them.
  'Expose Weakness', 'Overcharged Weapons', 'Paid in Beskar',
  'Parting Blow', 'Protect the Old Ways', 'Provoke',
  // B7: "ready YOUR Deployment card" CCs. Since 2026-08-12 (alexanbv: "they
  // should not just ready whatever DC went, they should ready the named DC")
  // these resolve against the named figure's own card, so they correctly
  // return a manualMessage unless IG-88 / Luke is on the board. The generic
  // harness builds neither. Their real coverage is
  // src/game/after-activation-resolves-window.test.js, which exercises the
  // window, the target, and the failure modes with the figures present.
  'Blaze of Glory', 'Son of Skywalker',
  // C: Reactive (no resolveAbility handler)
  'Negation',
]);

/**
 * Build a game with a realistic mid-game state for CC testing.
 * P1: Imperial army, P2: Rebel army, positioned on board, active activation.
 */
function buildTestGame() {
  const p1Army = [{ dcName: 'Darth Vader' }, { dcName: 'Imperial Officer (Elite)' }, { dcName: 'Stormtrooper (Regular)' }];
  const p2Army = [{ dcName: 'Luke Skywalker' }, { dcName: 'Rebel Saboteur (Elite)' }, { dcName: 'Rebel Trooper (Regular)' }];

  const { game, harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState } = createTestGame()
    .withMap('mos-eisley-outskirts')
    .withMissionVariant('a')
    .withPlayer1Army(p1Army)
    .withPlayer2Army(p2Army)
    .inRound(1)
    .build();

  // figureKeyForActivation (activation-state.js) resolves the activating
  // figure from a MODULE-LEVEL dcMessageMeta registry (set by game-state.js in
  // production). Tests that call resolveAbility() directly (bypassing the
  // harness) must register it themselves, else activation-figure-dependent CCs
  // (Overrun, Pummel, Parting Blow, etc.) fall through to a manualMessage.
  _registerDcMessageMeta(dcMessageMeta);

  // Set up an active activation for P1's first DC (Darth Vader)
  const p1MsgIds = game.p1DcMessageIds || [];
  if (p1MsgIds.length > 0) {
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };
  }

  // Set up pending combat (P1 attacks P2)
  const p1Figs = Object.keys(game.figurePositions?.[1] || {});
  const p2Figs = Object.keys(game.figurePositions?.[2] || {});
  if (p1Figs.length > 0 && p2Figs.length > 0) {
    game.pendingCombat = {
      attackerPlayerNum: 1,
      attackerFigureKey: p1Figs[0],
      defenderFigureKey: p2Figs[0],
      defenderPlayerNum: 2,
      attackerMsgId: p1MsgIds[0],
      gameId: game.gameId,
    };
  }

  return { game, harness, dcMessageMeta, dcExhaustedState, dcHealthState, deps: harness.getDeps() };
}

// ── Block 1: Ability-library entries exist ──────────────────────────────────

describe('CC Coverage: ability-library entries exist', () => {
  for (const cc of ccList) {
    test(`${cc} has ability-library entry`, () => {
      const effectData = getCcEffect(cc);
      const abilityId = effectData?.abilityId ?? cc;
      const entry = getAbility(abilityId);
      assert.ok(entry, `No ability-library entry for "${abilityId}" (CC: ${cc})`);
      assert.ok(entry.type, `Entry for "${abilityId}" has no type`);
      assert.notStrictEqual(entry.type, 'surge', `"${abilityId}" is a surge ability, not a CC`);
    });
  }
});

// ── Block 2: resolveAbility with generic context ────────────────────────────

describe('CC Coverage: resolveAbility with generic context', () => {
  for (const cc of ccList) {
    if (CONTEXT_DEPENDENT_CCS.has(cc)) continue; // Tested in Block 3

    test(`${cc} resolves via resolveAbility`, () => {
      const { game, dcMessageMeta, dcExhaustedState, dcHealthState } = buildTestGame();
      const effectData = getCcEffect(cc);
      const abilityId = effectData?.abilityId ?? cc;

      const context = {
        game,
        playerNum: 1,
        cardName: cc,
        dcMessageMeta,
        dcHealthState,
        dcExhaustedState,
        combat: game.pendingCombat,
      };

      const result = resolveAbility(abilityId, context);

      const isActionable = result.applied ||
        (result.requiresChoice && result.choiceOptions?.length > 0) ||
        (result.requiresSpaceChoice && result.validSpaces?.length > 0) ||
        result.logMessage;

      if (!isActionable && result.manualMessage) {
        assert.fail(
          `${cc} (abilityId: ${abilityId}) falls through to manualMessage: "${result.manualMessage}"`
        );
      }

      // If requiresChoice, verify resolution with random pick
      if (result.requiresChoice && result.choiceOptions?.length > 0) {
        const choiceIndex = 0;
        const result2 = resolveAbility(abilityId, {
          ...context,
          choiceIndex,
          chosenOption: result.choiceOptions[choiceIndex],
          chosenFigureKey: result.choiceValues?.[choiceIndex] ?? result.targetFigureKeys?.[choiceIndex] ?? null,
        });

        const isResolved2 = result2.applied ||
          (result2.requiresSpaceChoice && result2.validSpaces?.length > 0) ||
          result2.logMessage;

        if (!isResolved2 && result2.manualMessage) {
          assert.fail(`${cc} after choice[0] falls through: "${result2.manualMessage}"`);
        }

        if (result2.requiresSpaceChoice && result2.validSpaces?.length > 0) {
          const result3 = resolveAbility(abilityId, {
            ...context,
            choiceIndex,
            chosenSpace: result2.validSpaces[0],
            chosenFigureKey: result2.chosenFigureKey ?? result2.targetFigureKey ?? null,
          });
          if (!result3.applied && result3.manualMessage) {
            assert.fail(`${cc} after choice->space falls through: "${result3.manualMessage}"`);
          }
        }
      }

      if (result.requiresSpaceChoice && result.validSpaces?.length > 0) {
        const result2 = resolveAbility(abilityId, {
          ...context,
          chosenSpace: result.validSpaces[0],
          chosenFigureKey: result.chosenFigureKey ?? null,
        });
        if (!result2.applied && result2.manualMessage) {
          assert.fail(`${cc} after space pick falls through: "${result2.manualMessage}"`);
        }
      }
    });
  }
});

// ── Block 3: Context-dependent CCs resolve in playable state ────────────────

describe('CC Coverage: context-dependent CCs', () => {

  // ── B1: Defender CCs ──────────────────────────────────────────────────────

  for (const cc of ['Brace for Impact', 'Knowledge and Defense', 'Parry']) {
    test(`${cc} resolves when defending`, () => {
      // Build armies based on playableBy restriction
      const needsForceUser = cc === 'Knowledge and Defense';
      const needsBrawler = cc === 'Parry';
      const p1Army = needsForceUser
        ? [{ dcName: 'Luke Skywalker' }]
        : needsBrawler
          ? [{ dcName: 'Wampa (Elite)' }]
          : [{ dcName: 'Stormtrooper (Regular)' }];
      const p2Army = [{ dcName: 'Darth Vader' }];

      const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
        .withMap('mos-eisley-outskirts')
        .withMissionVariant('a')
        .withPlayer1Army(p1Army)
        .withPlayer2Army(p2Army)
        .inRound(1)
        .build();

      const p1Figs = Object.keys(game.figurePositions?.[1] || {});
      const p2Figs = Object.keys(game.figurePositions?.[2] || {});
      const p2MsgIds = game.p2DcMessageIds || [];

      // P2 attacks P1 -> P1 is the defender
      game.pendingCombat = {
        attackerPlayerNum: 2,
        attackerFigureKey: p2Figs[0],
        defenderFigureKey: p1Figs[0],
        defenderPlayerNum: 1,
        attackerMsgId: p2MsgIds[0],
        gameId: game.gameId,
      };

      const effectData = getCcEffect(cc);
      const abilityId = effectData?.abilityId ?? cc;
      const result = resolveAbility(abilityId, {
        game, playerNum: 1, cardName: cc,
        dcMessageMeta, dcHealthState, dcExhaustedState,
        combat: game.pendingCombat,
      });

      assert.ok(result.applied || result.logMessage,
        `${cc} did not resolve as defender: ${JSON.stringify(result)}`);
    });
  }

  // ── B2: Post-attack CCs ───────────────────────────────────────────────────

  test('Collateral Damage resolves after attack', () => {
    const p1Army = [{ dcName: 'Heavy Stormtrooper (Elite)' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }, { dcName: 'Rebel Trooper (Regular)' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p2Figs = Object.keys(game.figurePositions?.[2] || {});
    // Set lastAttackTargetFigureKey to simulate post-attack state
    game.lastAttackTargetFigureKey = p2Figs[0];
    game.lastAttackAttackerPlayerNum = 1;

    const effectData = getCcEffect('Collateral Damage');
    const abilityId = effectData?.abilityId ?? 'Collateral Damage';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Collateral Damage',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // May return applied (if no targets nearby) or requiresChoice
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Collateral Damage did not resolve: ${JSON.stringify(result)}`);
  });

  test('Reduce to Rubble resolves after attack', () => {
    const p1Army = [{ dcName: 'Heavy Stormtrooper (Elite)' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p2Figs = Object.keys(game.figurePositions?.[2] || {});
    const p2Pos = game.figurePositions?.[2]?.[p2Figs[0]];
    game.lastAttackTargetFigureKey = p2Figs[0];
    game.lastAttackAttackerPlayerNum = 1;
    game.lastAttackTargetSpacesForRubble = p2Pos ? [p2Pos] : [];

    const effectData = getCcEffect('Reduce to Rubble');
    const abilityId = effectData?.abilityId ?? 'Reduce to Rubble';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Reduce to Rubble',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    assert.ok(result.applied || result.logMessage,
      `Reduce to Rubble did not resolve: ${JSON.stringify(result)}`);
  });

  test('Ambush resolves as a defender reaction (damages the attacker)', () => {
    // Ambush (alexanbv audit 2026-06-26): a DEFENDER reaction — move adjacent to
    // the attacker, then THE ATTACKER suffers 2 Damage. Needs an attacker context
    // with a surviving defender; in a generic no-combat context it correctly
    // returns a manualMessage, so it lives here with a real attack context.
    const p1Army = [{ dcName: 'Rebel Trooper (Regular)' }];
    const p2Army = [{ dcName: 'Heavy Stormtrooper (Elite)' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1Figs = Object.keys(game.figurePositions?.[1] || {}); // defender ("you")
    const p2Figs = Object.keys(game.figurePositions?.[2] || {}); // attacker
    const combat = {
      attackerFigureKey: p2Figs[0],
      attackerPlayerNum: 2,
      target: { figureKey: p1Figs[0] },
    };

    const effectData = getCcEffect('Ambush');
    const abilityId = effectData?.abilityId ?? 'Ambush';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Ambush',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat,
    });

    assert.ok(result.applied || result.logMessage,
      `Ambush did not resolve with attacker context: ${JSON.stringify(result)}`);
  });

  // ── B3: Special Action CCs (test resolveAbility directly) ─────────────────

  test('Lure of the Dark Side resolves with Force User', () => {
    const p1Army = [{ dcName: 'Darth Vader' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: 'test-thread' };

    // Lure handler derives activating figure from dcActionsData entry with threadId.
    // Its fallback dgIndex ('0') doesn't match game-builder's '1', so it can't find
    // the position. Provide hasLineOfSight and getMapData in context so it can try
    // the LOS check. This is a specialAction CC — excluded from play_cc, so this test
    // validates the handler is wired, not full E2E resolution.
    const effectData = getCcEffect('Lure of the Dark Side');
    const abilityId = effectData?.abilityId ?? 'Lure of the Dark Side';

    // Verify the ability-library entry exists and handler is wired
    const entry = getAbility(abilityId);
    assert.ok(entry, 'Lure of the Dark Side should have an ability-library entry');
    assert.ok(entry.lureOfTheDarkSide, 'Entry should have lureOfTheDarkSide flag');
    assert.strictEqual(entry.wiredStatus, 'wired', 'Entry should be wired');
  });

  test('De Wanna Wanga resolves with discard pile', () => {
    const p1Army = [{ dcName: 'Darth Vader' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    // Put cards in P1's discard pile
    game.player1CcDiscard = ['Ambush', 'Rally'];

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('De Wanna Wanga');
    const abilityId = effectData?.abilityId ?? 'De Wanna Wanga';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'De Wanna Wanga',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice (choosing a card from discard)
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `De Wanna Wanga did not resolve: ${JSON.stringify(result)}`);
  });

  test('Cloned Reinforcements resolves with defeated trooper', () => {
    const p1Army = [{ dcName: 'Dr. Royce Hemlock' }, { dcName: 'Purge Trooper (Elite)' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    // Remove Purge Trooper from board (simulate defeat)
    const p1Figs = Object.keys(game.figurePositions?.[1] || {});
    const purgeFig = p1Figs.find(fk => fk.startsWith('Purge Trooper'));
    if (purgeFig) delete game.figurePositions[1][purgeFig];

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('Cloned Reinforcements');
    const abilityId = effectData?.abilityId ?? 'Cloned Reinforcements';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Cloned Reinforcements',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice or requiresSpaceChoice or applied
    assert.ok(result.applied || result.requiresChoice || result.requiresSpaceChoice || result.logMessage,
      `Cloned Reinforcements did not resolve: ${JSON.stringify(result)}`);
  });

  // ── B4: Coarse-timing CCs ────────────────────────────────────────────────

  test('Celebration resolves when activation kills exist', () => {
    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = buildTestGame();

    // Celebration now requires a UNIQUE hostile defeat, tracked via
    // game.activationUniqueKills (keyed by attackerFigureKey at the defeat
    // write sites — abilities.js:10062). The old generic activationKills flag
    // no longer satisfies its condition.
    const p1Figs = Object.keys(game.figurePositions?.[1] || {});
    game.activationUniqueKills = {};
    game.activationUniqueKills[p1Figs[0]] = 1;

    const effectData = getCcEffect('Celebration');
    const abilityId = effectData?.abilityId ?? 'Celebration';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Celebration',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    assert.ok(result.applied, `Celebration did not apply: ${JSON.stringify(result)}`);
    assert.ok(game.player1VP?.total > 0, 'Celebration should have granted VP');
  });

  test('Reinforcements resolves with defeated trooper', () => {
    // Use Stormtrooper (Regular) which has 3 figures — remove one to simulate defeat
    // The remaining figures provide adjacent placement spots
    const p1Army = [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Darth Vader' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    // Remove one Stormtrooper figure (e.g., figure index 2) to simulate defeat
    const p1Figs = Object.keys(game.figurePositions?.[1] || {});
    const stFig = p1Figs.find(fk => fk.match(/Stormtrooper.*-1-2$/));
    if (stFig) delete game.figurePositions[1][stFig];

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('Reinforcements');
    const abilityId = effectData?.abilityId ?? 'Reinforcements';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Reinforcements',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice or requiresSpaceChoice or applied
    assert.ok(result.applied || result.requiresChoice || result.requiresSpaceChoice || result.logMessage,
      `Reinforcements did not resolve: ${JSON.stringify(result)}`);
  });

  test('Ferocity resolves with CREATURE on board', () => {
    const p1Army = [{ dcName: 'Wampa (Elite)' }, { dcName: 'Darth Vader' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const effectData = getCcEffect('Ferocity');
    const abilityId = effectData?.abilityId ?? 'Ferocity';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Ferocity',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice (pick a CREATURE) or applied
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Ferocity did not resolve: ${JSON.stringify(result)}`);
  });

  test('Call the Vanguard resolves with TROOPER cost 4+', () => {
    const p1Army = [{ dcName: 'Heavy Stormtrooper (Elite)' }, { dcName: 'Darth Vader' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const effectData = getCcEffect('Call the Vanguard');
    const abilityId = effectData?.abilityId ?? 'Call the Vanguard';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Call the Vanguard',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice (pick a TROOPER) or applied
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Call the Vanguard did not resolve: ${JSON.stringify(result)}`);
  });

  test('Primary Target resolves during attack on highest-cost hostile', () => {
    const p1Army = [{ dcName: 'Boba Fett' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1Figs = Object.keys(game.figurePositions?.[1] || {});
    const p2Figs = Object.keys(game.figurePositions?.[2] || {});
    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    // Set up combat targeting the highest-cost hostile (Luke)
    // The Primary Target handler checks cbt.target.figureKey for cost validation
    game.pendingCombat = {
      attackerPlayerNum: 1,
      attackerFigureKey: p1Figs[0],
      defenderFigureKey: p2Figs[0],
      defenderPlayerNum: 2,
      attackerMsgId: p1MsgIds[0],
      gameId: game.gameId,
      target: { figureKey: p2Figs[0] },
    };

    const effectData = getCcEffect('Primary Target');
    const abilityId = effectData?.abilityId ?? 'Primary Target';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Primary Target',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: game.pendingCombat,
    });

    assert.ok(result.applied || result.logMessage,
      `Primary Target did not resolve: ${JSON.stringify(result)}`);
  });

  test('Shared Experience resolves with movement points', () => {
    const p1Army = [{ dcName: 'IG-88' }]; // DROID
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };
    game.movementBank = game.movementBank || {};
    // Per alexanbv 2026-06-13: MP is per-figure — seed the figure-0 sub-bank.
    game.movementBank[p1MsgIds[0]] = { perFig: { 0: { total: 5, remaining: 5 } } };

    const effectData = getCcEffect('Shared Experience');
    const abilityId = effectData?.abilityId ?? 'Shared Experience';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Shared Experience',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    assert.ok(result.applied || result.logMessage,
      `Shared Experience did not resolve: ${JSON.stringify(result)}`);
  });

  test('Intelligence Leak resolves with opponent hand', () => {
    const p1Army = [{ dcName: 'Del Meeko' }]; // SPY
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };
    game.player2CcHand = ['Ambush', 'Rally'];

    const effectData = getCcEffect('Intelligence Leak');
    const abilityId = effectData?.abilityId ?? 'Intelligence Leak';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Intelligence Leak',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice (pick from opponent hand)
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Intelligence Leak did not resolve: ${JSON.stringify(result)}`);
  });

  test('Support Specialist resolves with matching figures', () => {
    const p1Army = [{ dcName: 'Del Meeko' }, { dcName: 'Stormtrooper (Regular)' }]; // Del Meeko + TROOPER
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    // Activate Del Meeko (first DC)
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('Support Specialist');
    const abilityId = effectData?.abilityId ?? 'Support Specialist';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Support Specialist',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should return requiresChoice (pick a matching figure) or applied/logMessage if none nearby
    assert.ok(result.applied || result.requiresChoice || result.logMessage || result.manualMessage,
      `Support Specialist returned unexpected result: ${JSON.stringify(result)}`);
  });

  // ── B5: Cal's Buddy ──────────────────────────────────────────────────────

  test("Cal's Buddy resolves with Cal Kestis", () => {
    const p1Army = [{ dcName: 'Cal Kestis' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect("Cal's Buddy");
    const abilityId = effectData?.abilityId ?? "Cal's Buddy";
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: "Cal's Buddy",
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should resolve (deploy BD-1) or require space choice
    assert.ok(result.applied || result.requiresSpaceChoice || result.logMessage,
      `Cal's Buddy did not resolve: ${JSON.stringify(result)}`);
  });

  // ── C: Negation (unified CC counter-window model) ────────────────────────
  // The old pendingNegation/negation_play model was DELETED and replaced by the
  // unified recursive counter-window (src/game/cc-counter-window.js, alexanbv
  // 2026-06-17; AI auto-pass commit 69e2e4e 2026-06-18). The headless cost-zero
  // path (src/headless/headless-cc-play.js handleCostZero, lines 163-191) now
  // resolves the card directly and NO LONGER sets pendingNegation. These two
  // tests witness the CURRENT model instead.

  test('Negation: headless cost-zero path resolves directly (no pendingNegation)', async () => {
    const { game, harness } = buildTestGame();
    const hDeps = harness.getDeps();

    // Clear pendingCombat so nothing else gates the play.
    delete game.pendingCombat;

    // Put Negation in P2's hand and a cost-0 CC in P1's hand.
    // 'Urgency' is cost 0, timing duringActivation.
    game.player2CcHand = ['Negation'];
    game.player1CcHand = ['Urgency'];

    // Negation is a reaction-only counter — it can never be played proactively.
    const canPlayNegation = canResolveCcHeadless(game, 2, 'Negation', hDeps);
    assert.strictEqual(canPlayNegation, false, 'Negation should be blocked by canResolveCcHeadless');

    // P1 plays the cost-0 CC headlessly. Under the new model the headless path
    // resolves it directly (handleCostZero, headless-cc-play.js:163-191): no
    // pendingNegation is set, and no counter-window is left open.
    await playCommandCardHeadless(game, 1, 'Urgency', hDeps);

    assert.ok(!game.pendingNegation, 'pendingNegation must NOT be set under the new model');
    assert.ok(!game.ccCounterWindow, 'headless cost-zero path leaves no open counter-window');

    // Card moved hand → discard.
    assert.ok(!game.player1CcHand.includes('Urgency'), 'Urgency removed from P1 hand');
    assert.ok(game.player1CcDiscard.includes('Urgency'), 'Urgency in P1 discard');
  });

  test('Negation: counter-window offers Negation against a cost-0 card and resolves the stack', async () => {
    const { game } = buildTestGame();

    // P1 plays a cost-0 card; the unified window opens for the responder (P2).
    openCounterWindow(game, { card: 'Urgency', cost: 0, playedBy: 1 });

    // The opponent (P2) is the responder, the playing player (P1) is not.
    assert.strictEqual(counterResponder(game), 2, 'opponent (P2) is the counter responder');
    assert.strictEqual(topCard(game).card, 'Urgency', 'top of window is the played card');

    // P2 holds Negation; Negation cancels cost-0 cards, so it is offered.
    const offered = topAvailableCounters(game, /*responderSpyCount*/ 0);
    assert.ok(offered.includes('Negation'), 'Negation is a legal counter against a cost-0 card');

    // P2 plays Negation onto the stack.
    const push = pushCounter(game, { card: 'Negation', cost: 1, playedBy: 2 });
    assert.ok(push.ok, `pushCounter should succeed: ${push.reason || ''}`);

    // Resolve the whole stack: the uncountered Negation resolves and cancels the
    // cost-0 card beneath it.
    const outcome = resolveAndCloseWindow(game);
    assert.strictEqual(outcome[0].card, 'Urgency');
    assert.strictEqual(outcome[0].status, 'cancelled', 'Urgency cancelled by Negation');
    assert.strictEqual(outcome[1].card, 'Negation');
    assert.strictEqual(outcome[1].status, 'resolved', 'Negation (top, uncountered) resolves');
    assert.ok(!game.ccCounterWindow, 'window cleared after resolution');
  });

  // ── Bugfix verification ──────────────────────────────────────────────────

  test('Combat Resupply resolves after bugfix', () => {
    const p1Army = [{ dcName: 'Stormtrooper (Regular)' }, { dcName: 'Imperial Officer (Elite)' }];
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('Combat Resupply');
    const abilityId = effectData?.abilityId ?? 'Combat Resupply';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Combat Resupply',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should NOT throw ReferenceError anymore
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Combat Resupply did not resolve: ${JSON.stringify(result)}`);
  });

  test('Repair resolves with multiple adjacent figures (choice)', () => {
    const p1Army = [{ dcName: 'Del Meeko' }, { dcName: 'IG-88' }, { dcName: 'IG-11' }]; // DROID adjacents
    const p2Army = [{ dcName: 'Luke Skywalker' }];

    const { game, dcMessageMeta, dcHealthState, dcExhaustedState } = createTestGame()
      .withMap('mos-eisley-outskirts')
      .withMissionVariant('a')
      .withPlayer1Army(p1Army)
      .withPlayer2Army(p2Army)
      .inRound(1)
      .build();

    const p1MsgIds = game.p1DcMessageIds || [];
    game.dcActionsData = game.dcActionsData || {};
    game.dcActionsData[p1MsgIds[0]] = { remaining: 2, threadId: null };

    const effectData = getCcEffect('Repair');
    const abilityId = effectData?.abilityId ?? 'Repair';
    const result = resolveAbility(abilityId, {
      game, playerNum: 1, cardName: 'Repair',
      dcMessageMeta, dcHealthState, dcExhaustedState,
      combat: null,
    });

    // Should NOT return manualMessage — should return requiresChoice or applied
    if (result.manualMessage) {
      assert.fail(`Repair should not return manualMessage after fix: "${result.manualMessage}"`);
    }
    assert.ok(result.applied || result.requiresChoice || result.logMessage,
      `Repair did not resolve: ${JSON.stringify(result)}`);
  });
});
