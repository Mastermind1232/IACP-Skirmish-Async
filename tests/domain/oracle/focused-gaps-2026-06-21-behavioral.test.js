/**
 * Behavioral coverage for the focused-gaps fixes (2026-06-21):
 *
 *   1/2. Targeting Computer reroll OVER-GRANT (Sentry Droid family) — the
 *        named ability must yield EXACTLY 1 attack-die reroll, not 2-3.
 *   3.   Ko-Tun Feralo "Professional" reroll DOUBLE-GRANT — exactly 1.
 *        (Plus proof that DISTINCT reroll sources still stack to 2.)
 *   4.   Zuckuss "Mystic Hunter" on_declare auto-Focus passive is detected
 *        (robustly via passives ∪ abilities) and applicable.
 *   5.   Overrun (CC) — entering a hostile's space deals 2 Damage (the
 *        damage call previously referenced an undefined `hostileFk`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getInnateRerollAbilities } from '../../../src/game/combat.js';
import { abilitiesForWindow } from '../../../src/engine/combat-timing-registry.js';
import '../../../src/engine/combat-abilities-ondeclare.js';
import { getDcEffects } from '../../../src/data-loader.js';
import { handleMovePick } from '../../../src/handlers/movement.js';
import {
  getBoardStateForMovement,
  getMovementProfile,
  computeMovementCache,
  ensureMovementCache,
  getMovementTarget,
  getMovementPath,
  getNormalizedFootprint,
} from '../../../src/game/movement.js';
import { normalizeCoord } from '../../../src/game/coords.js';
import { getFigureSize, getDcStats } from '../../../src/data-loader.js';
import { getFastLearnerPickerEligibility } from '../../../src/game/unique-figure-ccs.js';
import { isCcPlayLegalByRestriction } from '../../../src/game/cc-timing.js';

// ─────────────────────────────────────────────────────────────────────────────
// #1/#2/#3 — getInnateRerollAbilities de-dup (named reroll = exactly 1 entry)
// ─────────────────────────────────────────────────────────────────────────────

describe('Focused-gap 1/2: Targeting Computer = exactly 1 attack reroll entry', () => {
  for (const dc of ['Sentry Droid (Elite) [DC]', 'Sentry Droid (Regular) [DC]']) {
    it(`${dc} → single 'targeting-computer' entry (not the generic atkMatch too)`, () => {
      const abs = getInnateRerollAbilities(dc);
      const atk = abs.filter((a) => a.pool === 'attack');
      assert.equal(atk.length, 1, 'exactly one attack-die reroll entry from card text');
      assert.equal(atk[0].id, 'targeting-computer');
      assert.equal(atk[0].remainingUses, 1);
      // The generic atkMatch branch must NOT also fire for the same text.
      assert.ok(!abs.some((a) => a.id === 'while-attacking-reroll'),
        'generic while-attacking-reroll must be suppressed for the named ability');
    });
  }
});

describe('Focused-gap 3: Ko-Tun Feralo Professional = exactly 1 attack reroll entry', () => {
  it("getInnateRerollAbilities returns a single 'professional' entry", () => {
    const abs = getInnateRerollAbilities('Ko-Tun Feralo [DC]');
    const atk = abs.filter((a) => a.pool === 'attack');
    assert.equal(atk.length, 1, 'incidental "stacks with Professional" text must not double-count');
    assert.equal(atk[0].id, 'professional');
    assert.equal(atk[0].remainingUses, 1);
  });
});

// ── Proof DISTINCT reroll sources still STACK (the de-dup only collapses the
//    SAME ability counted twice; genuinely different abilities give 2). ───────
describe('Focused-gap 1-3: distinct reroll sources still stack', () => {
  // Drive the SAME push/skip contract the handler uses (id/passive path +
  // text path) and confirm two DIFFERENT named abilities still yield 2 buckets.
  function buildQueue({ idTargetingComputer = false, passiveProfessional = false, innateDcName }) {
    const combat = { forcedRerollQueue: [] };
    const _push = (source) => combat.forcedRerollQueue.push({ controlPlayer: 1, pool: 'attack', remaining: 1, source });
    // id-path (handlers/combat.js:5852)
    if (idTargetingComputer) { _push('Targeting Computer'); combat._targetingComputerIdPushed = true; }
    // passive-path (applyDcPassivesToCombat → rerollOneAttackDie + flag)
    if (passiveProfessional) { combat.rerollOneAttackDie = 1; combat._professionalPassivePushed = true; }
    // text-path (handlers/combat.js:6170) with the SAME de-dup the handler applies
    for (const ab of getInnateRerollAbilities(innateDcName)) {
      if (ab.pool !== 'attack' && ab.pool !== 'any') continue;
      if (ab.id === 'targeting-computer' && combat._targetingComputerIdPushed) continue;
      if (ab.id === 'professional' && combat._professionalPassivePushed) continue;
      for (let i = 0; i < (ab.remainingUses || 1); i++) _push(ab.label || 'Innate');
    }
    // rerollOneAttackDie consumption (handlers/combat.js:6185)
    for (let i = 0; i < (combat.rerollOneAttackDie || 0); i++) _push('Professional (rerollOneAttackDie)');
    return combat.forcedRerollQueue;
  }

  it('Sentry Droid (Elite): id-path + text-path collapse to 1 bucket', () => {
    const q = buildQueue({ idTargetingComputer: true, innateDcName: 'Sentry Droid (Elite) [DC]' });
    assert.equal(q.length, 1, 'Targeting Computer = exactly 1 reroll bucket');
  });

  it('Ko-Tun: passive-path Professional + incidental text collapse to 1 bucket', () => {
    const q = buildQueue({ passiveProfessional: true, innateDcName: 'Ko-Tun Feralo [DC]' });
    assert.equal(q.length, 1, 'Professional = exactly 1 reroll bucket');
  });

  it('TWO genuinely different abilities still stack to 2 buckets', () => {
    // id-path Targeting Computer (Sentry) + a SEPARATE Professional passive
    // grant must NOT collapse — they are distinct sources.
    const q = buildQueue({
      idTargetingComputer: true,        // Targeting Computer
      passiveProfessional: true,        // Professional (different ability)
      innateDcName: 'Sentry Droid (Elite) [DC]', // text path adds nothing new (deduped TC)
    });
    assert.equal(q.length, 2, 'Targeting Computer + Professional = 2 independent reroll buckets');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #4 — Mystic Hunter (Zuckuss) on_declare auto-Focus passive is detected
// ─────────────────────────────────────────────────────────────────────────────

describe('Focused-gap 4: Zuckuss Mystic Hunter on_declare passive', () => {
  it('is applicable as an auto-fire passive for Zuckuss', () => {
    const combat = { attackerDcName: 'Zuckuss [DC]', attackerFigureKey: 'Zuckuss-1-0', target: { figureKey: 'X-2-0' } };
    const out = abilitiesForWindow('on_declare', 'attacker', {}, combat, { getDcEffects });
    const mh = out.find((o) => o.id === 'mystic_hunter');
    assert.ok(mh, 'mystic_hunter must be offered on_declare for Zuckuss');
    assert.equal(mh.kind, 'passive', 'auto-fires (no player decision)');
  });

  it('does NOT fire for a non-owner', () => {
    const combat = { attackerDcName: 'Sentry Droid (Elite) [DC]', attackerFigureKey: 'S-1-0', target: { figureKey: 'X-2-0' } };
    const out = abilitiesForWindow('on_declare', 'attacker', {}, combat, { getDcEffects });
    assert.ok(!out.some((o) => o.id === 'mystic_hunter'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #5 — Overrun: AT-ST (MASSIVE 2x3) entering a hostile's space deals 2 Damage
// ─────────────────────────────────────────────────────────────────────────────

function mockInteraction(customId, userId = 'player1') {
  const mockMsg = {
    id: 'grid-msg-1', delete: async () => ({}), edit: async () => ({}),
    attachments: new Map(), author: { id: 'bot' },
  };
  return {
    customId, user: { id: userId },
    followUp: async () => mockMsg, deferUpdate: async () => ({}), update: async () => ({}),
    message: mockMsg,
    channel: { messages: { fetch: async (o) => (typeof o === 'string' ? mockMsg : new Map()) }, send: async () => mockMsg },
  };
}

function makeGame(overrides = {}) {
  return {
    gameId: '42', player1Id: 'player1', player2Id: 'player2',
    selectedMap: { id: 'unit-test-grid' },
    figurePositions: { 1: {}, 2: {} }, figureOrientations: {}, figureConditions: {}, figurePowerTokens: {},
    openedDoors: [], moveInProgress: {}, movementBank: {}, moveGridMessageIds: {}, pendingSpacePick: {},
    ...overrides,
  };
}

function buildCtx(game, dcMetaEntries, overrides = {}) {
  const calls = { logGameAction: [], processFigureDefeat: [] };
  const mockChannel = { messages: { fetch: async () => ({ delete: async () => ({}), edit: async () => ({}) }) }, send: async () => ({ id: 'new-msg' }) };
  return {
    ctx: {
      getGame: (id) => (String(id) === String(game.gameId) ? game : null),
      dcMessageMeta: new Map(dcMetaEntries),
      dcHealthState: overrides.dcHealthState || new Map(),
      clearMoveGridMessages: async () => {},
      getBoardStateForMovement: (g, fk) => getBoardStateForMovement(g, fk),
      getMovementProfile: (dcName, fk, g) => getMovementProfile(dcName, fk, g),
      ensureMovementCache: (ms, start, mp, board, prof) => ensureMovementCache(ms, start, mp, board, prof),
      computeMovementCache: (start, mp, board, prof) => computeMovementCache(start, mp, board, prof),
      normalizeCoord: (c) => normalizeCoord(c),
      getMovementTarget: (cache, coord) => getMovementTarget(cache, coord),
      getFigureSize: (dcName) => getFigureSize(dcName),
      getNormalizedFootprint: (pos, size) => getNormalizedFootprint(pos, size),
      resolveMassivePush: async () => {},
      updateMovementBankMessage: async () => {},
      getMovementPath: (cache, start, dest, size, prof) => getMovementPath(cache, start, dest, size, prof),
      pushUndo: () => {},
      logGameAction: async (...args) => { calls.logGameAction.push(args); return { id: 'log-msg' }; },
      countTerminalsControlledByPlayer: () => 0,
      getMovementMinimapAttachment: async () => null,
      buildBoardMapPayload: async () => ({}),
      getDcStats: (dcName) => getDcStats(dcName),
      saveGames: () => {},
      client: { channels: { fetch: async () => mockChannel }, user: { id: 'bot' } },
      processFigureDefeat: async (g, opts) => { calls.processFigureDefeat.push(opts); },
      updateDcActionsMessage: async () => {},
      ...overrides,
    },
    calls,
  };
}

function seedMoveState(game, msgId, figureIndex, figureKey, playerNum, startCoord, mp, displayName, dcName) {
  const moveKey = `${msgId}_${figureIndex}`;
  const boardState = getBoardStateForMovement(game, figureKey);
  const profile = getMovementProfile(dcName, figureKey, game);
  const cache = computeMovementCache(startCoord, mp, boardState, profile);
  game.moveInProgress[moveKey] = {
    figureKey, playerNum, mpRemaining: mp, displayName, startCoord,
    boardState, movementProfile: profile, movementCache: cache, cacheMaxMp: mp, pendingMp: null,
  };
  return { moveKey, cache };
}

describe('Focused-gap 5: Overrun deals 2 Damage on entering a hostile space', () => {
  it('AT-ST (2x3) moving onto a hostile applies 2 Damage (no ReferenceError)', async () => {
    // AT-ST start a1 (fp a1,b1,a2,b2,a3,b3); move to a2 (fp a2,b2,a3,b3,a4,b4)
    // → newly entered spaces a4,b4. Hostile Stormtrooper at a4 is entered.
    const game = makeGame({
      figurePositions: {
        1: { 'AT-ST-1-0': 'a1' },
        2: { 'Stormtrooper (Regular)-1-0': 'a4' },
      },
      overrunThisActivation: { 'AT-ST-1-0': true },
    });
    const dcMeta = [
      ['3001', { dcName: 'AT-ST', displayName: 'AT-ST', playerNum: 1, gameId: '42' }],
      ['4001', { dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper (Regular)', playerNum: 2, gameId: '42' }],
    ];
    const dcHealthState = new Map();
    dcHealthState.set('4001', [[5, 5]]); // figIndex 0: [currentHp, maxHp]

    seedMoveState(game, '3001', 0, 'AT-ST-1-0', 1, 'a1', 2, 'AT-ST', 'AT-ST');
    const { ctx, calls } = buildCtx(game, dcMeta, { dcHealthState });

    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    const [hp, max] = dcHealthState.get('4001')[0];
    assert.equal(max, 5, 'max HP unchanged');
    assert.equal(hp, 3, 'Stormtrooper took exactly 2 Damage (5 → 3)');

    // Once-per-hostile-per-move flag recorded.
    assert.ok(game.overrunDamagedThisMove?.['AT-ST-1-0']?.includes('Stormtrooper (Regular)-1-0'),
      'hostile recorded as already-damaged this move');

    // An Overrun log line was emitted.
    const logged = calls.logGameAction.some((a) => /Overrun/.test(a[2] || ''));
    assert.ok(logged, 'Overrun damage logged');
  });

  it('hits MULTIPLE hostiles whose spaces are entered in one step (alexanbv 2026-06-21)', async () => {
    // AT-ST a1→a2 enters a4 AND b4. Two hostiles at a4 and b4 → BOTH take 2.
    const game = makeGame({
      figurePositions: {
        1: { 'AT-ST-1-0': 'a1' },
        2: { 'Stormtrooper (Regular)-1-0': 'a4', 'Stormtrooper (Regular)-1-1': 'b4' },
      },
      overrunThisActivation: { 'AT-ST-1-0': true },
    });
    const dcMeta = [
      ['3001', { dcName: 'AT-ST', displayName: 'AT-ST', playerNum: 1, gameId: '42' }],
      ['4001', { dcName: 'Stormtrooper (Regular)', displayName: 'Stormtrooper (Regular) [Group 1]', playerNum: 2, gameId: '42' }],
    ];
    const dcHealthState = new Map();
    dcHealthState.set('4001', [[5, 5], [5, 5]]); // two figures

    seedMoveState(game, '3001', 0, 'AT-ST-1-0', 1, 'a1', 2, 'AT-ST', 'AT-ST');
    const { ctx } = buildCtx(game, dcMeta, { dcHealthState });

    await handleMovePick(mockInteraction('move_pick_3001_0_a2', 'player1'), ctx);

    const hs = dcHealthState.get('4001');
    assert.equal(hs[0][0], 3, 'first hostile (a4) took 2 Damage');
    assert.equal(hs[1][0], 3, 'second hostile (b4) took 2 Damage');
    assert.ok(game.overrunDamagedThisMove['AT-ST-1-0'].includes('Stormtrooper (Regular)-1-0'));
    assert.ok(game.overrunDamagedThisMove['AT-ST-1-0'].includes('Stormtrooper (Regular)-1-1'));
  });
});

// ── Fast Learner picker board-presence (alexanbv 2026-06-21) ──
// When both Mara and the named figure are ON THE BOARD, the player is prompted
// to choose who plays a unique CC. A defeated named figure (still in the army
// list) must NOT prompt.
describe('Fast Learner picker prompts only when both are on the board', () => {
  function flGame(positions) {
    return {
      gameId: 'fl', p1DcList: ['The Armorer', 'Mara Jade'], p2DcList: [],
      figurePositions: { 1: positions, 2: {} }, roundFigureAbilityUsed: {},
    };
  }
  it('prompts (choose Armorer or Mara) when BOTH are alive on the board', () => {
    const e = getFastLearnerPickerEligibility(flGame({ 'The Armorer-1-0': 'a1', 'Mara Jade-1-0': 'b1' }), 1, 'Mandalorian Steel');
    assert.equal(e.shouldPrompt, true);
  });
  it('does NOT prompt when the named figure is defeated (only Mara on board) — Mara substitutes', () => {
    const e = getFastLearnerPickerEligibility(flGame({ 'Mara Jade-1-0': 'b1' }), 1, 'Mandalorian Steel');
    assert.equal(e.shouldPrompt, false);
  });
  it('does NOT prompt when Mara is defeated (only the named figure on board)', () => {
    const e = getFastLearnerPickerEligibility(flGame({ 'The Armorer-1-0': 'a1' }), 1, 'Mandalorian Steel');
    assert.equal(e.shouldPrompt, false);
  });
  it('does NOT prompt when Fast Learner was already used this round', () => {
    const g = flGame({ 'The Armorer-1-0': 'a1', 'Mara Jade-1-0': 'b1' });
    g.roundFigureAbilityUsed['Mara Jade_fast_learner'] = true;
    assert.equal(getFastLearnerPickerEligibility(g, 1, 'Mandalorian Steel').shouldPrompt, false);
  });
});

// isCcPlayLegalByRestriction: a unique-figure CC's named figure must be ALIVE ON
// THE BOARD to satisfy the restriction "as the named figure". A defeated named
// figure (still in the army dcList) must route the play through Mara Jade's Fast
// Learner (which is then consumed). alexanbv 2026-06-21.
describe('isCcPlayLegalByRestriction — unique-figure-CC board-presence gate', () => {
  function g(dcList, positions) {
    return {
      gameId: 't', p1DcList: dcList, p2DcList: [],
      figurePositions: { 1: positions, 2: {} }, roundFigureAbilityUsed: {},
    };
  }

  it('(a) named figure on board, no Mara → legal, no fastLearner', () => {
    const r = isCcPlayLegalByRestriction(g(['The Armorer'], { 'The Armorer-1-0': 'x' }), 1, 'Mandalorian Steel');
    assert.equal(r.legal, true);
    assert.ok(!r.fastLearner);
  });

  it('(b) named figure + Mara both on board → legal (picker handles choice), no fastLearner flag', () => {
    const r = isCcPlayLegalByRestriction(
      g(['The Armorer', 'Mara Jade'], { 'The Armorer-1-0': 'x', 'Mara Jade-1-0': 'y' }), 1, 'Mandalorian Steel');
    assert.equal(r.legal, true);
    assert.ok(!r.fastLearner);
  });

  it('(c) named figure DEFEATED (in dcList, off board) + Mara on board → legal WITH fastLearner', () => {
    const r = isCcPlayLegalByRestriction(
      g(['The Armorer', 'Mara Jade'], { 'Mara Jade-1-0': 'y' }), 1, 'Mandalorian Steel');
    assert.equal(r.legal, true);
    assert.equal(r.fastLearner, true);
  });

  it('(d) named figure defeated + no Mara → not legal', () => {
    const r = isCcPlayLegalByRestriction(g(['The Armorer'], {}), 1, 'Mandalorian Steel');
    assert.equal(r.legal, false);
  });

  it('(e) keyword-restricted CC (TROOPER) is UNAFFECTED by board-presence change', () => {
    // Army has a TROOPER DC but NOTHING on the board: keyword restriction stays
    // army/keyword based, so the CC is still legal.
    const r = isCcPlayLegalByRestriction(
      { gameId: 't', p1DcList: ['74-Z Speeder Bike (Elite)'], p2DcList: [], figurePositions: { 1: {}, 2: {} }, roundFigureAbilityUsed: {} },
      1, 'Concentrated Fire');
    assert.equal(r.legal, true);
    assert.ok(!r.fastLearner);
  });
});
