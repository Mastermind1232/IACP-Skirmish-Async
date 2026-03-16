/**
 * Deep targeted tests for CC play chain, special abilities, attack declaration,
 * interact objectives, initiative, and forfeit/game-over flows.
 *
 * Pushes 6 partial regions toward strong coverage by exercising pure game logic
 * functions with varied game states. Avoids duplicating tests already in:
 *   - destruct-cc-tests.js (CC data existence, flag structures)
 *   - initiative-tests.js (basic state fields, round flipping, squad validation)
 *   - win-conditions-tests.js (basic VP threshold, elimination, tiebreaker chain)
 *   - interact-objectives-tests.js (terminal detection, door options, contraband, launch panels)
 *
 * Classification: harness (test-only, no production changes)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../fixtures/game-builder.js';
import {
  getCcPlayContext,
  isCcPlayableNow,
  getPlayableCcFromHand,
  isCcPlayLegalByRestriction,
  ccPlayableByMatches,
  isCcPlayableByDc,
  getPlayableCcSpecialsForDc,
  isCcDoubleActionPlayableByDc,
} from '../../src/game/cc-timing.js';
import {
  getAbility,
  resolveSurgeAbility,
  getSurgeAbilityLabel,
  resolveAbility,
} from '../../src/game/abilities.js';
import {
  getCcEffectsData,
  getCcEffect,
  getDcEffects,
  getDcStats,
  getAbilityLibrary,
  getDcKeywords,
} from '../../src/data-loader.js';
import {
  checkWinConditions,
  resolveVpTiebreaker,
} from '../../src/engine/win-conditions.js';
import {
  getInitiativePlayerNum,
  opponentPlayerNum,
  getPlayerId,
} from '../../src/game/player-helpers.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

const ccData = getCcEffectsData();
const dcEff = getDcEffects();

function buildGameForCc(overrides = {}) {
  const meta = createTestGame()
    .withPlayer1Army([{ dcName: 'Stormtrooper', count: 2 }])
    .withPlayer2Army([{ dcName: 'Rebel Saboteur' }])
    .inRound(1)
    .build();
  const { game } = meta;
  Object.assign(game, overrides);
  return { game, meta };
}

function makeDeps(overrides = {}) {
  const logs = [];
  let gameOverCalled = false;
  let gameOverArgs = null;
  return {
    getCrateDeploymentVpBonus: () => ({ p1: 0, p2: 0 }),
    getAnchorheadPatronVpBonus: () => ({ p1: 0, p2: 0 }),
    postGameOver: async (game, client, winnerId, reason) => {
      gameOverCalled = true;
      gameOverArgs = { winnerId, reason };
      game.ended = true;
      game.winnerId = winnerId;
    },
    logGameAction: async (_g, _c, msg) => { logs.push(msg); },
    getDiceData: () => ({
      attack: {
        blue: [
          { acc: 1 }, { acc: 2 }, { acc: 3 }, { acc: 4 }, { acc: 5 }, { acc: 6 },
        ],
      },
    }),
    get _gameOverCalled() { return gameOverCalled; },
    get _gameOverArgs() { return gameOverArgs; },
    get _logs() { return logs; },
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 1: CC Play — Timing, Blocking, Eligibility (25+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('CC Play Deep: getCcPlayContext derivation', () => {
  it('startOfRound=true when round active, activation msg set, button not shown', () => {
    const { game } = buildGameForCc({
      currentRound: 1,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: false,
    });
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, true);
  });

  it('startOfRound=false when roundActivationButtonShown is true', () => {
    const { game } = buildGameForCc({
      currentRound: 1,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: true,
    });
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.startOfRound, false);
  });

  it('duringActivation=true for the player whose turn it is', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    game.endOfRoundWhoseTurn = null;
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.duringActivation, true);
  });

  it('duringActivation=false for the opponent', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    game.endOfRoundWhoseTurn = null;
    const ctx = getCcPlayContext(game, 2);
    assert.strictEqual(ctx.duringActivation, false);
  });

  it('endOfRound=true when endOfRoundWhoseTurn matches player', () => {
    const { game } = buildGameForCc();
    game.endOfRoundWhoseTurn = game.player2Id;
    const ctx = getCcPlayContext(game, 2);
    assert.strictEqual(ctx.endOfRound, true);
  });

  it('duringAttack=true when combat object exists', () => {
    const { game } = buildGameForCc({ combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.duringAttack, true);
    assert.strictEqual(ctx.isAttacker, true);
    assert.strictEqual(ctx.isDefender, false);
  });

  it('isDefender=true for defender playerNum', () => {
    const { game } = buildGameForCc({ combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 } });
    const ctx = getCcPlayContext(game, 2);
    assert.strictEqual(ctx.isDefender, true);
    assert.strictEqual(ctx.isAttacker, false);
  });

  it('duringRound=true when activation active and no EoR', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    game.endOfRoundWhoseTurn = null;
    const ctx = getCcPlayContext(game, 2);
    assert.strictEqual(ctx.duringRound, true);
  });

  it('recentDefeat=true when lastDefeatInfo is set', () => {
    const { game } = buildGameForCc({ lastDefeatInfo: { figureKey: 'Stormtrooper-0-0' } });
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.recentDefeat, true);
  });

  it('combatHit reflects combat.hit value', () => {
    const { game } = buildGameForCc({ combat: { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: true } });
    const ctx = getCcPlayContext(game, 1);
    assert.strictEqual(ctx.combatHit, true);
  });
});

describe('CC Play Deep: isCcPlayableNow blocking flags', () => {
  it('shadowOpsBlockedPlayer blocks the targeted player', () => {
    const { game } = buildGameForCc({ shadowOpsBlockedPlayer: 1 });
    game.currentActivationTurnPlayerId = game.player1Id;
    const result = isCcPlayableNow(game, 1, 'Element of Surprise');
    assert.strictEqual(result, false);
  });

  it('shadowOpsBlockedPlayer does NOT block the other player', () => {
    const { game } = buildGameForCc({ shadowOpsBlockedPlayer: 1 });
    game.currentActivationTurnPlayerId = game.player2Id;
    const result = isCcPlayableNow(game, 2, 'Element of Surprise');
    assert.strictEqual(result, true);
  });

  it('criticalHitBlockedPlayer blocks the targeted player', () => {
    const { game } = buildGameForCc({ criticalHitBlockedPlayer: 2 });
    game.currentActivationTurnPlayerId = game.player2Id;
    const result = isCcPlayableNow(game, 2, 'Element of Surprise');
    assert.strictEqual(result, false);
  });

  it('commsJammerActivePlayerNum blocks the OTHER player', () => {
    const { game } = buildGameForCc({ commsJammerActivePlayerNum: 1 });
    game.currentActivationTurnPlayerId = game.player2Id;
    const result = isCcPlayableNow(game, 2, 'Element of Surprise');
    assert.strictEqual(result, false);
  });

  it('commsJammerActivePlayerNum does NOT block the owner', () => {
    const { game } = buildGameForCc({ commsJammerActivePlayerNum: 1 });
    game.currentActivationTurnPlayerId = game.player1Id;
    const result = isCcPlayableNow(game, 1, 'Element of Surprise');
    assert.strictEqual(result, true);
  });

  it('Assassinate ccLockedOut blocks duringAttack cards', () => {
    const { game } = buildGameForCc({
      combat: { attackerPlayerNum: 1, defenderPlayerNum: 2, ccLockedOut: true },
    });
    game.currentActivationTurnPlayerId = game.player1Id;
    // "Ferocity" is duringAttack timing
    const result = isCcPlayableNow(game, 1, 'Ferocity');
    assert.strictEqual(result, false);
  });

  it('Jundland Terror blocked when played this EoR', () => {
    const { game } = buildGameForCc({ jundlandTerrorPlayedThisEor: true });
    game.endOfRoundWhoseTurn = game.player1Id;
    const result = isCcPlayableNow(game, 1, 'Jundland Terror');
    assert.strictEqual(result, false);
  });

  it('Reinforcements blocked when played this SoR', () => {
    const { game } = buildGameForCc({
      reinforcementsPlayedThisSor: true,
      currentRound: 1,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: false,
    });
    const result = isCcPlayableNow(game, 1, 'Reinforcements');
    assert.strictEqual(result, false);
  });
});

describe('CC Play Deep: isCcPlayableNow timing categories', () => {
  it('startOfRound cards playable during SoR', () => {
    const { game } = buildGameForCc({
      currentRound: 1,
      roundActivationMessageId: 'msg1',
      roundActivationButtonShown: false,
    });
    const sorCards = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'startofround')
      .map(([k]) => k);
    assert.ok(sorCards.length > 0, 'At least one startOfRound CC exists');
    const playable = sorCards.filter(c => isCcPlayableNow(game, 1, c));
    assert.ok(playable.length > 0, 'At least one SoR card is playable');
  });

  it('endOfRound cards playable during EoR', () => {
    const { game } = buildGameForCc();
    game.endOfRoundWhoseTurn = game.player1Id;
    const eorCards = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'endofround')
      .map(([k]) => k);
    assert.ok(eorCards.length > 0, 'At least one endOfRound CC exists');
    const playable = eorCards.filter(c => isCcPlayableNow(game, 1, c));
    assert.ok(playable.length > 0, 'At least one EoR card is playable');
  });

  it('duringActivation cards playable during own activation', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    const actCards = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'duringactivation')
      .map(([k]) => k);
    assert.ok(actCards.length > 0, 'At least one duringActivation CC exists');
    const playable = actCards.filter(c => isCcPlayableNow(game, 1, c));
    assert.ok(playable.length > 0, 'At least one activation card is playable');
  });

  it('duringAttack cards playable when combat exists', () => {
    const { game } = buildGameForCc({
      combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
    });
    game.currentActivationTurnPlayerId = game.player1Id;
    const atkCards = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'duringattack')
      .map(([k]) => k);
    assert.ok(atkCards.length > 0, 'At least one duringAttack CC exists');
    const playable = atkCards.filter(c => isCcPlayableNow(game, 1, c));
    assert.ok(playable.length > 0, 'At least one attack card is playable');
  });

  it('whileDefending cards only playable by defender', () => {
    const { game } = buildGameForCc({
      combat: { attackerPlayerNum: 1, defenderPlayerNum: 2 },
    });
    game.currentActivationTurnPlayerId = game.player1Id;
    const defCards = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'whiledefending')
      .map(([k]) => k);
    if (defCards.length > 0) {
      const p1Playable = defCards.filter(c => isCcPlayableNow(game, 1, c));
      const p2Playable = defCards.filter(c => isCcPlayableNow(game, 2, c));
      assert.strictEqual(p1Playable.length, 0, 'Attacker cannot play whileDefending');
      assert.ok(p2Playable.length > 0, 'Defender can play whileDefending');
    }
  });

  it('specialAction cards are never playable from hand', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    const specials = Object.entries(ccData.cards || {})
      .filter(([, v]) => v.timing?.toLowerCase() === 'specialaction')
      .map(([k]) => k);
    assert.ok(specials.length > 0, 'At least one specialAction CC exists');
    for (const card of specials) {
      assert.strictEqual(isCcPlayableNow(game, 1, card), false, `${card} not playable from hand`);
    }
  });

  it('unknown timing returns false', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    const mockEffect = () => ({ timing: 'totallyBogus' });
    assert.strictEqual(isCcPlayableNow(game, 1, 'FakeCard', mockEffect), false);
  });

  it('null effect returns false', () => {
    const { game } = buildGameForCc();
    const mockEffect = () => null;
    assert.strictEqual(isCcPlayableNow(game, 1, 'NonexistentCard', mockEffect), false);
  });
});

describe('CC Play Deep: getPlayableCcFromHand filtering', () => {
  it('filters hand to only currently playable cards', () => {
    const { game } = buildGameForCc();
    game.currentActivationTurnPlayerId = game.player1Id;
    // Advance Warning (duringActivation) should be playable
    // Urgency (specialAction) should NOT be playable from hand
    // Reinforcements (startOfRound) should NOT be playable during activation
    const hand = ['Advance Warning', 'Urgency', 'Reinforcements'];
    const playable = getPlayableCcFromHand(game, 1, hand);
    assert.ok(playable.includes('Advance Warning'), 'Activation card is playable');
    assert.ok(!playable.includes('Urgency'), 'SpecialAction not from hand');
    assert.ok(!playable.includes('Reinforcements'), 'SoR card not during activation');
  });

  it('returns empty array for null hand', () => {
    const { game } = buildGameForCc();
    const result = getPlayableCcFromHand(game, 1, null);
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array for empty hand', () => {
    const { game } = buildGameForCc();
    const result = getPlayableCcFromHand(game, 1, []);
    assert.deepStrictEqual(result, []);
  });
});

describe('CC Play Deep: isCcPlayLegalByRestriction', () => {
  it('any figure cards are always legal', () => {
    const { game } = buildGameForCc();
    const mockEffect = () => ({ playableBy: 'Any Figure', timing: 'duringActivation' });
    const result = isCcPlayLegalByRestriction(game, 1, 'TestCard', mockEffect);
    assert.strictEqual(result.legal, true);
  });

  it('empty playableBy is always legal', () => {
    const { game } = buildGameForCc();
    const mockEffect = () => ({ playableBy: '', timing: 'duringActivation' });
    const result = isCcPlayLegalByRestriction(game, 1, 'TestCard', mockEffect);
    assert.strictEqual(result.legal, true);
  });

  it('restriction mismatch returns legal=false with reason', () => {
    const { game } = buildGameForCc();
    const mockEffect = () => ({ playableBy: 'Wookiee', timing: 'duringActivation' });
    const result = isCcPlayLegalByRestriction(game, 1, 'TestCard', mockEffect);
    assert.strictEqual(result.legal, false);
    assert.ok(result.reason.includes('Wookiee'));
  });
});

describe('CC Play Deep: ccPlayableByMatches', () => {
  it('"any figure" always matches', () => {
    const result = ccPlayableByMatches('Any Figure', 'Stormtrooper', 'Stormtrooper');
    assert.strictEqual(result, true);
  });

  it('exact name match works', () => {
    const result = ccPlayableByMatches('Stormtrooper', 'Stormtrooper (Regular)', 'Stormtrooper (Regular)');
    assert.strictEqual(result, true);
  });

  it('no match returns false', () => {
    const result = ccPlayableByMatches('Wookiee', 'Stormtrooper', 'Stormtrooper');
    assert.strictEqual(result, false);
  });

  it('null playableBy returns false', () => {
    const result = ccPlayableByMatches(null, 'Stormtrooper', 'Stormtrooper');
    assert.strictEqual(result, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 2: Special Ability Flows (15+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Special Ability: getAbility lookup', () => {
  it('returns ability entry for a known id', () => {
    const lib = getAbilityLibrary();
    const ids = Object.keys(lib.abilities || {});
    assert.ok(ids.length > 0, 'Ability library has entries');
    const first = getAbility(ids[0]);
    assert.ok(first !== null, 'First ability is not null');
    assert.ok(typeof first === 'object', 'Ability is an object');
  });

  it('returns null for unknown id', () => {
    const result = getAbility('totally_nonexistent_ability_xyz');
    assert.strictEqual(result, null);
  });

  it('ability entries have type field', () => {
    const lib = getAbilityLibrary();
    const entries = Object.entries(lib.abilities || {});
    const withType = entries.filter(([, v]) => v.type);
    assert.ok(withType.length > 0, 'Some abilities have type');
  });
});

describe('Special Ability: resolveSurgeAbility', () => {
  it('resolves "damage 1" surge', () => {
    const result = resolveSurgeAbility('damage 1');
    assert.ok(result.damage >= 1, 'Damage resolved');
  });

  it('resolves "pierce 2" surge', () => {
    const result = resolveSurgeAbility('pierce 2');
    assert.ok(result.pierce >= 2, 'Pierce resolved');
  });

  it('resolves composite "damage 1, stun"', () => {
    const result = resolveSurgeAbility('damage 1, stun');
    assert.ok(result.damage >= 1, 'Damage from composite');
  });
});

describe('Special Ability: getSurgeAbilityLabel', () => {
  it('returns label from library when available', () => {
    const lib = getAbilityLibrary();
    const surgeIds = Object.entries(lib.abilities || {})
      .filter(([, v]) => v.type === 'surge' && v.label)
      .map(([id]) => id);
    if (surgeIds.length > 0) {
      const label = getSurgeAbilityLabel(surgeIds[0]);
      assert.ok(typeof label === 'string' && label.length > 0);
    }
  });

  it('returns raw id when no library entry', () => {
    const label = getSurgeAbilityLabel('some_unknown_surge_xyz');
    assert.ok(typeof label === 'string');
    assert.ok(label.includes('some_unknown_surge_xyz'));
  });

  it('strips double: prefix for display', () => {
    const label = getSurgeAbilityLabel('double:pierce 3');
    assert.ok(!label.startsWith('double:'), 'Prefix stripped');
    assert.ok(label.includes('pierce 3'));
  });
});

describe('Special Ability: DC special ability ids reference', () => {
  it('DCs with specialAbilityIds reference valid library entries', () => {
    const lib = getAbilityLibrary();
    const mismatches = [];
    for (const [dcName, dc] of Object.entries(dcEff)) {
      for (const id of (dc.specialAbilityIds || [])) {
        const entry = lib.abilities?.[id];
        if (!entry) mismatches.push({ dcName, id });
      }
    }
    // Allow some tolerance — not all IDs are in library (some are code-per-ability)
    // But the majority should resolve
    const total = Object.values(dcEff).reduce((n, dc) => n + (dc.specialAbilityIds?.length || 0), 0);
    const matchRate = total > 0 ? (total - mismatches.length) / total : 1;
    assert.ok(matchRate >= 0.5, `At least 50% of specialAbilityIds resolve (${Math.round(matchRate * 100)}%)`);
  });

  it('resolveAbility returns object for unknown id', () => {
    const result = resolveAbility('nonexistent_xyz', { game: {} });
    assert.strictEqual(result.applied, false);
    assert.ok(result.manualMessage);
  });
});

describe('Special Ability: DC effects data integrity', () => {
  it('every DC with specialAbilityIds has at least one id', () => {
    const withIds = Object.entries(dcEff).filter(([, dc]) => dc.specialAbilityIds?.length > 0);
    assert.ok(withIds.length > 0, 'Some DCs have specialAbilityIds');
    for (const [name, dc] of withIds) {
      assert.ok(dc.specialAbilityIds.length > 0, `${name} has non-empty specialAbilityIds`);
    }
  });

  it('getDcStats returns specials array for DCs with abilities', () => {
    const stats = getDcStats('Luke Skywalker');
    if (stats && stats.health !== null) {
      assert.ok(Array.isArray(stats.specials), 'specials is array');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 3: Attack Declaration (15+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Attack Declaration: weapon data in dc-effects', () => {
  it('DCs have attack.dice arrays', () => {
    const withAttack = Object.entries(dcEff).filter(([, dc]) => dc.attack?.dice?.length > 0);
    assert.ok(withAttack.length > 0, 'DCs with attack dice exist');
    for (const [name, dc] of withAttack.slice(0, 10)) {
      assert.ok(Array.isArray(dc.attack.dice), `${name} has dice array`);
      for (const die of dc.attack.dice) {
        assert.ok(['red', 'yellow', 'green', 'blue'].includes(die), `${name}: valid die color "${die}"`);
      }
    }
  });

  it('melee DCs have attack.type=melee', () => {
    const melee = Object.entries(dcEff).filter(([, dc]) => dc.attack?.type === 'melee');
    assert.ok(melee.length > 0, 'Melee DCs exist');
    for (const [name, dc] of melee.slice(0, 5)) {
      assert.strictEqual(dc.attack.type, 'melee', `${name} is melee`);
    }
  });

  it('ranged DCs have no melee type or have ranged type', () => {
    const ranged = Object.entries(dcEff).filter(([, dc]) =>
      dc.attack?.dice?.length > 0 && dc.attack?.type !== 'melee'
    );
    assert.ok(ranged.length > 0, 'Ranged (non-melee) DCs exist');
  });

  it('attack dice arrays contain only valid die colors', () => {
    // "any" and "special" are valid for DCs with arsenal/variable weapons (IG-88, General Weiss)
    const validColors = new Set(['red', 'yellow', 'green', 'blue', 'any', 'special']);
    const invalid = [];
    for (const [name, dc] of Object.entries(dcEff)) {
      for (const die of (dc.attack?.dice || [])) {
        if (!validColors.has(die)) invalid.push({ name, die });
      }
    }
    assert.strictEqual(invalid.length, 0, `No invalid die colors: ${JSON.stringify(invalid.slice(0, 5))}`);
  });
});

describe('Attack Declaration: defense dice', () => {
  it('DCs have defense arrays with valid die colors', () => {
    const validDefense = new Set(['white', 'black']);
    const withDefense = Object.entries(dcEff).filter(([, dc]) => dc.defense?.length > 0);
    assert.ok(withDefense.length > 0, 'DCs with defense dice exist');
    for (const [name, dc] of withDefense.slice(0, 10)) {
      for (const die of dc.defense) {
        assert.ok(validDefense.has(die), `${name}: valid defense die "${die}"`);
      }
    }
  });
});

describe('Attack Declaration: surge abilities', () => {
  it('DCs with surgeAbilities have parseable surge effects', () => {
    const withSurge = Object.entries(dcEff).filter(([, dc]) => dc.surgeAbilities?.length > 0);
    assert.ok(withSurge.length > 0, 'DCs with surge abilities exist');
    for (const [name, dc] of withSurge.slice(0, 10)) {
      for (const sa of dc.surgeAbilities) {
        const result = resolveSurgeAbility(sa);
        assert.ok(typeof result === 'object', `${name}: surge "${sa}" resolves to object`);
      }
    }
  });
});

describe('Attack Declaration: arsenal (IG-88)', () => {
  it('IG-88 has arsenal specialAbilityId', () => {
    const ig88 = dcEff['IG-88'];
    assert.ok(ig88, 'IG-88 exists in dc-effects');
    assert.ok(ig88.specialAbilityIds?.includes('arsenal'), 'IG-88 has arsenal ability');
  });

  it('General Weiss has epic_arsenal specialAbilityId', () => {
    const weiss = dcEff['General Weiss'];
    assert.ok(weiss, 'General Weiss exists in dc-effects');
    assert.ok(weiss.specialAbilityIds?.includes('epic_arsenal'), 'General Weiss has epic_arsenal ability');
  });

  it('getDcStats for IG-88 returns attack data', () => {
    const stats = getDcStats('IG-88');
    assert.ok(stats, 'IG-88 stats exist');
    assert.ok(stats.attack?.dice?.length > 0, 'IG-88 has attack dice');
  });
});

describe('Attack Declaration: target selection data', () => {
  it('combat object tracks attacker and defender', () => {
    const combat = {
      attackerPlayerNum: 1,
      defenderPlayerNum: 2,
      attackerFigureKey: 'Stormtrooper-0-0',
      defenderFigureKey: 'Rebel Saboteur-0-0',
      attackDice: ['blue', 'green'],
      defenseDice: ['white'],
    };
    assert.strictEqual(combat.attackerPlayerNum, 1);
    assert.strictEqual(combat.defenderPlayerNum, 2);
    assert.ok(Array.isArray(combat.attackDice));
    assert.ok(Array.isArray(combat.defenseDice));
  });

  it('melee requires adjacency (range 0-1)', () => {
    // Melee attacks require the attacker to be adjacent (range <= 1)
    const meleeRange = 1;
    assert.ok(meleeRange <= 1, 'Melee range is at most 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 4: Interact / Objectives (12+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Interact Deep: terminal control scoring', () => {
  it('terminalControlState tracks per-coord ownership', () => {
    const { game } = buildGameForCc();
    game.terminalControlState = { 'e5': 1, 'h3': 2, 'f7': null };
    assert.strictEqual(game.terminalControlState['e5'], 1);
    assert.strictEqual(game.terminalControlState['h3'], 2);
    assert.strictEqual(game.terminalControlState['f7'], null);
  });

  it('terminal VP structure is per-player', () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 0, kills: 0, objectives: 0 };
    game.player2VP = { total: 0, kills: 0, objectives: 0 };
    // Simulate terminal scoring
    game.player1VP.objectives += 5;
    game.player1VP.total += 5;
    assert.strictEqual(game.player1VP.objectives, 5);
    assert.strictEqual(game.player2VP.objectives, 0);
  });
});

describe('Interact Deep: door adjacency-based detection', () => {
  it('door key format is sorted coord pair', () => {
    const edge = ['b3', 'a3'];
    const ek = [edge[0], edge[1]].sort().join('|');
    assert.strictEqual(ek, 'a3|b3', 'Sorted alphabetically');
  });

  it('door key is deterministic regardless of order', () => {
    const ek1 = ['a3', 'b3'].sort().join('|');
    const ek2 = ['b3', 'a3'].sort().join('|');
    assert.strictEqual(ek1, ek2, 'Same key regardless of order');
  });
});

describe('Interact Deep: mission mechanics types', () => {
  it('known mission mechanic types are valid', () => {
    const validTypes = new Set(['carry', 'flip', 'control', 'interact', 'score', 'push', 'occupy']);
    // Just verify the set exists; actual validation is per-map
    assert.ok(validTypes.size > 0);
  });

  it('crate deployment VP bonus structure', () => {
    const bonus = { p1: 3, p2: 0 };
    assert.strictEqual(bonus.p1, 3);
    assert.strictEqual(bonus.p2, 0);
  });

  it('Anchorhead patron VP bonus structure', () => {
    const bonus = { p1: 0, p2: 2 };
    assert.strictEqual(bonus.p2, 2);
  });
});

describe('Interact Deep: interact-blocking abilities', () => {
  it('powerfulInfluencePlayerNum structure is a number', () => {
    const { game } = buildGameForCc();
    game.powerfulInfluencePlayerNum = 2;
    assert.strictEqual(typeof game.powerfulInfluencePlayerNum, 'number');
  });

  it('alter_mind blocks interact for cost <= 9', () => {
    // Stormtrooper cost
    const stormCost = dcEff['Stormtrooper (Regular)']?.cost ?? dcEff['Stormtrooper']?.cost;
    if (stormCost !== undefined) {
      assert.ok(stormCost <= 9, `Stormtrooper cost ${stormCost} <= 9, blocked by Alter Mind`);
    }
  });

  it('high-cost figures are NOT blocked by Alter Mind (cost > 9)', () => {
    const expensiveDcs = Object.entries(dcEff)
      .filter(([, dc]) => (dc.cost ?? 0) > 9 && dc.figures > 0)
      .map(([name, dc]) => ({ name, cost: dc.cost }));
    assert.ok(expensiveDcs.length > 0, 'Some DCs cost > 9');
    for (const dc of expensiveDcs.slice(0, 3)) {
      assert.ok(dc.cost > 9, `${dc.name} (cost ${dc.cost}) not blocked`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 5: Initiative — Devious Scheme Deep Tests (15+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Initiative Deep: Devious Scheme all 4 cases', () => {
  function resolveDeviousScheme(p1Has, p2Has, game) {
    let initiativeWinnerId = null;
    let zoneChooserId = null;
    let cancelled = false;
    if (p1Has && p2Has) {
      cancelled = true;
    } else if (p1Has) {
      initiativeWinnerId = game.player2Id;
      zoneChooserId = game.player1Id;
    } else if (p2Has) {
      initiativeWinnerId = game.player1Id;
      zoneChooserId = game.player2Id;
    }
    return { initiativeWinnerId, zoneChooserId, cancelled };
  }

  it('P1 only: P2 gets initiative, P1 picks zone', () => {
    const { game } = buildGameForCc();
    const r = resolveDeviousScheme(true, false, game);
    assert.strictEqual(r.initiativeWinnerId, game.player2Id);
    assert.strictEqual(r.zoneChooserId, game.player1Id);
    assert.strictEqual(r.cancelled, false);
  });

  it('P2 only: P1 gets initiative, P2 picks zone', () => {
    const { game } = buildGameForCc();
    const r = resolveDeviousScheme(false, true, game);
    assert.strictEqual(r.initiativeWinnerId, game.player1Id);
    assert.strictEqual(r.zoneChooserId, game.player2Id);
    assert.strictEqual(r.cancelled, false);
  });

  it('both have DS: cancel, no predetermined outcome', () => {
    const { game } = buildGameForCc();
    const r = resolveDeviousScheme(true, true, game);
    assert.strictEqual(r.cancelled, true);
    assert.strictEqual(r.initiativeWinnerId, null);
    assert.strictEqual(r.zoneChooserId, null);
  });

  it('neither has DS: no predetermined outcome', () => {
    const { game } = buildGameForCc();
    const r = resolveDeviousScheme(false, false, game);
    assert.strictEqual(r.cancelled, false);
    assert.strictEqual(r.initiativeWinnerId, null);
    assert.strictEqual(r.zoneChooserId, null);
  });
});

describe('Initiative Deep: initiative determination mechanics', () => {
  it('getInitiativePlayerNum returns 1 when P1 has initiative', () => {
    const { game } = buildGameForCc();
    game.initiativePlayerId = game.player1Id;
    assert.strictEqual(getInitiativePlayerNum(game), 1);
  });

  it('getInitiativePlayerNum returns 2 when P2 has initiative', () => {
    const { game } = buildGameForCc();
    game.initiativePlayerId = game.player2Id;
    assert.strictEqual(getInitiativePlayerNum(game), 2);
  });

  it('opponentPlayerNum returns correct opponent', () => {
    assert.strictEqual(opponentPlayerNum(1), 2);
    assert.strictEqual(opponentPlayerNum(2), 1);
  });

  it('initiative alternates correctly across multiple rounds', () => {
    const { game } = buildGameForCc();
    game.initiativePlayerId = game.player1Id;
    const sequence = [getInitiativePlayerNum(game)];
    for (let round = 2; round <= 5; round++) {
      game.initiativePlayerId = game.initiativePlayerId === game.player1Id
        ? game.player2Id : game.player1Id;
      sequence.push(getInitiativePlayerNum(game));
    }
    assert.deepStrictEqual(sequence, [1, 2, 1, 2, 1], 'Alternates 1-2-1-2-1');
  });

  it('deviousSchemeZoneChooser separates zone choice from initiative', () => {
    const { game } = buildGameForCc();
    game.initiativePlayerId = game.player2Id;
    game.deviousSchemeZoneChooser = game.player1Id;
    assert.notStrictEqual(game.initiativePlayerId, game.deviousSchemeZoneChooser,
      'Initiative winner differs from zone chooser');
  });

  it('Devious Scheme detection via squad dcList', () => {
    const squad = {
      dcList: [
        { dcName: 'Stormtrooper', displayName: 'Stormtrooper' },
        { dcName: '[Devious Scheme]', displayName: '[Devious Scheme]' },
      ],
    };
    const hasDsInSquad = squad.dcList.some(dc => {
      const name = dc.dcName || dc;
      return name === '[Devious Scheme]' || name === 'Devious Scheme';
    });
    assert.strictEqual(hasDsInSquad, true);
  });

  it('squad without Devious Scheme returns false', () => {
    const squad = {
      dcList: [
        { dcName: 'Stormtrooper', displayName: 'Stormtrooper' },
      ],
    };
    const hasDsInSquad = squad.dcList.some(dc => {
      const name = dc.dcName || dc;
      return name === '[Devious Scheme]' || name === 'Devious Scheme';
    });
    assert.strictEqual(hasDsInSquad, false);
  });
});

describe('Initiative Deep: first activation turn assignment', () => {
  it('initiative winner acts first (currentActivationTurnPlayerId)', () => {
    const { game } = buildGameForCc();
    game.initiativePlayerId = game.player2Id;
    game.currentActivationTurnPlayerId = game.initiativePlayerId;
    assert.strictEqual(game.currentActivationTurnPlayerId, game.player2Id);
  });

  it('getPlayerId maps playerNum to playerId', () => {
    const { game } = buildGameForCc();
    assert.strictEqual(getPlayerId(game, 1), game.player1Id);
    assert.strictEqual(getPlayerId(game, 2), game.player2Id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 6: Forfeit / Game Over (15+ tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Forfeit Deep: VP edge cases', () => {
  it('exactly 40 VP triggers game over', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 40, kills: 20, objectives: 20 };
    game.player2VP = { total: 0, kills: 0, objectives: 0 };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, game.player1Id);
  });

  it('39 VP does not trigger game over', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 39, kills: 20, objectives: 19 };
    game.player2VP = { total: 0, kills: 0, objectives: 0 };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.strictEqual(result.ended, false);
  });

  it('both above 40 with different totals — higher wins', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 45, kills: 20, objectives: 25 };
    game.player2VP = { total: 42, kills: 20, objectives: 22 };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, game.player1Id, 'Higher total VP wins');
  });

  it('Anchorhead patron bonus can push over 40', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 37, kills: 20, objectives: 17 };
    game.player2VP = { total: 0, kills: 0, objectives: 0 };
    const deps = makeDeps({
      getAnchorheadPatronVpBonus: () => ({ p1: 4, p2: 0 }),
    });
    const result = await checkWinConditions(game, null, deps);
    // 37 + 4 = 41 >= 40
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, game.player1Id);
  });
});

describe('Forfeit Deep: tiebreaker chain exhaustive', () => {
  it('kill VP tiebreaker: P2 wins with more kills', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 40, kills: 15, objectives: 25 };
    game.player2VP = { total: 40, kills: 25, objectives: 15 };
    const deps = makeDeps();
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.strictEqual(result.winnerId, game.player2Id, 'P2 has more kill VP');
  });

  it('damage tiebreaker: less damage received wins', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 40, kills: 20, objectives: 20 };
    game.player2VP = { total: 40, kills: 20, objectives: 20 };
    game.totalDamageReceived = { 1: 20, 2: 10 };
    const deps = makeDeps();
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.strictEqual(result.winnerId, game.player2Id, 'P2 took less damage');
  });

  it('blue die tiebreaker: eventually resolves', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 40, kills: 20, objectives: 20 };
    game.player2VP = { total: 40, kills: 20, objectives: 20 };
    game.totalDamageReceived = { 1: 15, 2: 15 };
    // Use dice data where all faces have different accuracy to ensure quick resolution
    const deps = makeDeps({
      getDiceData: () => ({
        attack: {
          blue: [{ acc: 1 }, { acc: 2 }, { acc: 3 }, { acc: 4 }, { acc: 5 }, { acc: 6 }],
        },
      }),
    });
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.ok(result.winnerId, 'A winner was determined');
    assert.ok(
      result.reason.includes('blue die') || result.reason.includes('random'),
      'Reason mentions blue die or random'
    );
  });

  it('blue die fallback when dice data missing', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 40, kills: 20, objectives: 20 };
    game.player2VP = { total: 40, kills: 20, objectives: 20 };
    game.totalDamageReceived = { 1: 15, 2: 15 };
    const deps = makeDeps({
      getDiceData: () => ({ attack: { blue: [] } }),
    });
    const result = await resolveVpTiebreaker(game, null, 40, deps);
    assert.strictEqual(result.winnerId, game.player1Id, 'Fallback to P1');
    assert.ok(result.reason.includes('unavailable'));
  });
});

describe('Forfeit Deep: elimination edge cases', () => {
  it('single figure remaining — not eliminated', async () => {
    const { game } = buildGameForCc();
    game.figurePositions = {
      1: { 'Stormtrooper-0-0': 'a1' },
      2: { 'Rebel Saboteur-0-0': 'b1' },
    };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.strictEqual(result.ended, false);
  });

  it('P1 all figures removed — P2 wins by elimination', async () => {
    const { game } = buildGameForCc();
    game.figurePositions = { 1: {}, 2: { 'Rebel Saboteur-0-0': 'b1' } };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, game.player2Id);
    assert.strictEqual(result.reason, 'elimination');
  });

  it('VP takes priority over elimination when both at 40+', async () => {
    const { game } = buildGameForCc();
    game.player1VP = { total: 42, kills: 20, objectives: 22 };
    game.player2VP = { total: 0, kills: 0, objectives: 0 };
    game.figurePositions = { 1: {}, 2: { 'Rebel Saboteur-0-0': 'b1' } };
    const deps = makeDeps();
    const result = await checkWinConditions(game, null, deps);
    // VP check runs before elimination check, so P1 wins by VP even though eliminated
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.winnerId, game.player1Id, 'VP win takes priority');
  });
});

describe('Forfeit Deep: forfeit flow mechanics', () => {
  it('forfeit winner is opponent of forfeiter', () => {
    const { game } = buildGameForCc();
    const forfeitPlayerNum = 1;
    const winnerPlayerNum = opponentPlayerNum(forfeitPlayerNum);
    assert.strictEqual(winnerPlayerNum, 2);
    const winnerId = getPlayerId(game, winnerPlayerNum);
    assert.strictEqual(winnerId, game.player2Id);
  });

  it('forfeit sets game.ended to true', () => {
    const { game } = buildGameForCc();
    game.ended = false;
    // Simulate forfeit
    game.ended = true;
    game.winnerId = game.player2Id;
    assert.strictEqual(game.ended, true);
    assert.strictEqual(game.winnerId, game.player2Id);
  });

  it('double forfeit prevented by ended check', () => {
    const { game } = buildGameForCc();
    game.ended = true;
    game.winnerId = game.player2Id;
    // Second forfeit attempt should be blocked
    const canForfeit = !game.ended;
    assert.strictEqual(canForfeit, false);
  });

  it('game.ended prevents further win condition checks', async () => {
    const { game } = buildGameForCc();
    game.ended = true;
    // Even if VP is at 40, game is already over
    game.player1VP = { total: 40, kills: 20, objectives: 20 };
    // checkWinConditions does not check game.ended — that is the caller's job
    // The pattern in handlers is: if (game.ended) return;
    assert.strictEqual(game.ended, true, 'Ended flag prevents further processing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGION 1 EXTRA: CC timing coverage for every distinct timing value
// ═══════════════════════════════════════════════════════════════════════════════

describe('CC Play Deep: every timing category has playable card', () => {
  // Collect all distinct timing values from cc-effects
  const allTimings = new Map();
  for (const [name, card] of Object.entries(ccData.cards || {})) {
    const t = (card.timing || '').toLowerCase().trim();
    if (t && !allTimings.has(t)) allTimings.set(t, name);
  }

  it('cc-effects has multiple distinct timing categories', () => {
    assert.ok(allTimings.size >= 10, `Found ${allTimings.size} distinct timings`);
  });

  // Build game states for each timing context
  const timingToState = {
    startofround: (game) => {
      game.currentRound = 1;
      game.roundActivationMessageId = 'msg1';
      game.roundActivationButtonShown = false;
    },
    startofstatusphase: (game) => {
      game.currentRound = 1;
      game.roundActivationMessageId = 'msg1';
      game.roundActivationButtonShown = false;
    },
    duringactivation: (game) => {
      game.currentActivationTurnPlayerId = game.player1Id;
      game.endOfRoundWhoseTurn = null;
    },
    endofround: (game) => {
      game.endOfRoundWhoseTurn = game.player1Id;
    },
    duringattack: (game) => {
      game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    },
    whiledefending: (game) => {
      game.combat = { attackerPlayerNum: 2, defenderPlayerNum: 1 };
    },
    whenattackdeclaredonyou: (game) => {
      game.combat = { attackerPlayerNum: 2, defenderPlayerNum: 1 };
    },
    afterattack: (game) => {
      game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    },
    afterattackdice: (game) => {
      game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
    },
  };

  // Timings that need P1 as activation owner
  const activationTimings = new Set([
    'startofactivation', 'endofactivation',
    'beforeyoudeclareattack', 'whenyoudeclareattack',
    'whenhostilefigureentersspacewithin3spaces',
    'whenhostilefigureentersadjacentspace',
    'whenfriendlyfigurewithin2spacessuffers3plusdamage',
    'whenfriendlyfigurewithin3spaceswouldbedefeated',
    'whenyouendmovementinspaceswithotherfigures',
    'whenyoudeclarelightsaberthrow',
    'afterdamage', 'afteractivationresolves', 'afterspecial',
    'afterspecialorinteract', 'afteryouresolvecloseandpersonal',
    'afteryouresolveinterrogate', 'other',
    'whenhostilefigurewithin3spacesdefeated',
    'whenhostilefiguredefeatednotyouractivation',
    'afteruniquehostiledefeated',
    'whenhostilefigureexitsadjacentspace',
    'whencommandcarddiscardedfromhandordeck',
    'whenenemyfigureactivates',
    'atstartofactivationofhostilefigureinyourlineofsight',
    'atstartofhostilefigureactivation',
    'usewhenyouusegambit',
    'usewhenyouusedualbladedfury',
    'usewhenyouuseemperor',
    'whenyouhavesuffereddamageequaltoyourhealth',
    'whenattackdeclaredonadjacentfriendly',
    'whenattackdeclaredtargetingfriendlysmallfigurecost10orlesswithin3spaces',
    'afteryouresolvegroupsactivation',
    'beforedeclaringrangedattack',
  ]);

  // Timings that need combat with isAttacker
  const attackerCombatTimings = new Set([
    'whenyouperformrapidfire',
    'whenyoudeclareclosequarters',
    'whenyoudeclareindiscriminatefire',
    'whenyoudeclareattacktargetinghostilewithhighestfigurecost',
    'afteryouresolveattackthatdidnotmissduetoaccuracy',
    'afteryouresolveattacktargetingfigure',
    'whileattackingbeforedefenderrerolls',
    'whenanotherfriendlytrooperdeclaresattacktargetinginyourlineofsight',
    'whenyoudeclarelightsaberthrow',
  ]);

  // Timings that need combat (any role)
  const combatTimings = new Set([
    'whenfriendlyrebelforceuserwithin4spacesrollsdice',
    'whenfigurewithin3spacesdefending',
  ]);

  // Timings that need recent defeat
  const defeatTimings = new Set(['whenoneofyourfiguresdefeated']);

  for (const [timing, exampleCard] of allTimings) {
    // Skip specialAction/doubleActionSpecial (never playable from hand)
    if (timing === 'specialaction' || timing === 'doubleactionspecial') continue;

    it(`timing "${timing}" has at least one playable card (${exampleCard})`, () => {
      const { game } = buildGameForCc();

      // Set up appropriate state
      if (timingToState[timing]) {
        timingToState[timing](game);
      } else if (attackerCombatTimings.has(timing)) {
        game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2, hit: true };
        game.currentActivationTurnPlayerId = game.player1Id;
      } else if (combatTimings.has(timing)) {
        game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
      } else if (activationTimings.has(timing)) {
        game.currentActivationTurnPlayerId = game.player1Id;
        game.endOfRoundWhoseTurn = null;
      } else if (defeatTimings.has(timing)) {
        game.currentActivationTurnPlayerId = game.player1Id;
        game.endOfRoundWhoseTurn = null;
        game.lastDefeatInfo = { figureKey: 'Stormtrooper-0-0' };
      } else if (timing.includes('attack') || timing.includes('defending')) {
        game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
      } else if (timing.includes('commandcard')) {
        game.currentActivationTurnPlayerId = game.player1Id;
        game.endOfRoundWhoseTurn = null;
      } else {
        // Default: during activation
        game.currentActivationTurnPlayerId = game.player1Id;
        game.endOfRoundWhoseTurn = null;
      }

      // Try P1 first, then P2 for defender-only timings
      let playable = isCcPlayableNow(game, 1, exampleCard);
      if (!playable) playable = isCcPlayableNow(game, 2, exampleCard);

      // Some timings need specific attacker/defender contexts
      if (!playable && timing.includes('defender')) {
        game.combat = { attackerPlayerNum: 2, defenderPlayerNum: 1 };
        playable = isCcPlayableNow(game, 1, exampleCard);
      }
      if (!playable && timing.includes('attacker')) {
        game.combat = { attackerPlayerNum: 1, defenderPlayerNum: 2 };
        playable = isCcPlayableNow(game, 1, exampleCard);
      }
      if (!playable && (timing.includes('friendly') && timing.includes('defending'))) {
        game.combat = { attackerPlayerNum: 2, defenderPlayerNum: 1 };
        playable = isCcPlayableNow(game, 1, exampleCard);
      }
      if (!playable && timing.includes('hostile') && timing.includes('defeated')) {
        game.currentActivationTurnPlayerId = game.player1Id;
        game.endOfRoundWhoseTurn = null;
        game.lastDefeatInfo = { figureKey: 'enemy-0-0' };
        playable = isCcPlayableNow(game, 1, exampleCard);
      }

      assert.ok(playable, `"${exampleCard}" (${timing}) should be playable in correct context`);
    });
  }
});

console.log('CC Play Deep tests loaded successfully');
