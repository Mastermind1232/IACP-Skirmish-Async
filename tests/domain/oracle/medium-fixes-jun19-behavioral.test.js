/**
 * BEHAVIORAL oracle tests for the Jun-19 MEDIUM ability-fix batch.
 *
 * Covers the data/logic fixes that are cleanly exercised through the pure
 * resolveAbility() entry point (no Discord handler mocking):
 *
 *   - bully_jabba:        targetHostileFigure + allowFriendly → friendly
 *     figures within 3 are now selectable (CSV "a figure of your choice").
 *   - incentivize_jabba:  "an elite figure of your choice" has NO affiliation
 *     condition → a non-Scum elite is now enumerated.
 *
 * Both load their entry from the LIVE ability-library.json via getAbility,
 * so these tests assert the shipped data + resolver together.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';

const GAME_ID = 'medfix1';

function baseGame(overrides = {}) {
  return {
    gameId: GAME_ID,
    player1Id: 'user_p1',
    player2Id: 'user_p2',
    figurePositions: { 1: {}, 2: {} },
    figureConditions: {},
    figurePowerTokens: {},
    currentRound: 1,
    selectedMap: { id: 'unit-test-grid' },
    dcActionsData: {},
    ...overrides,
  };
}

// ── Bug 4: Bully (Jabba) — allowFriendly enumeration ───────────────────────────
describe('MEDFIX Bully (Jabba): allowFriendly lets a friendly within 3 be chosen', () => {
  function buildBullyContext({ jabbaPos = 'a1', friendlyPositions = {}, enemyPositions = {} } = {}) {
    const dcMessageMeta = new Map();
    const jabbaMsgId = 'msg_jabba';
    dcMessageMeta.set(jabbaMsgId, { gameId: GAME_ID, playerNum: 1, dcName: 'Jabba the Hutt', displayName: 'Jabba the Hutt [DG 1]' });
    const game = baseGame({
      figurePositions: {
        1: { 'Jabba the Hutt-1-0': jabbaPos, ...friendlyPositions },
        2: { ...enemyPositions },
      },
    });
    return {
      game,
      context: {
        game, playerNum: 1,
        meta: dcMessageMeta.get(jabbaMsgId),
        msgId: jabbaMsgId,
        dcMessageMeta,
        dcHealthState: new Map(),
        getMapData: () => null,
        getFigureSize: () => '1x1',
      },
    };
  }

  it('a friendly figure within 3 spaces is enumerated as a valid target', () => {
    const { context } = buildBullyContext({
      jabbaPos: 'a1',
      friendlyPositions: { 'Gamorrean Guard-1-0': 'a2' },
      enemyPositions: { 'Darth Vader-1-0': 'a3' },
    });
    const result = resolveAbility('bully_jabba', context);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.ok(result.targetFigureKeys.includes('Gamorrean Guard-1-0'),
      'friendly within 3 selectable now that allowFriendly is set');
    assert.ok(result.targetFigureKeys.includes('Darth Vader-1-0'),
      'hostile within 3 still selectable');
  });

  it('a friendly figure beyond 3 spaces is excluded (range still enforced)', () => {
    const { context } = buildBullyContext({
      jabbaPos: 'a1',
      friendlyPositions: { 'Gamorrean Guard-1-0': 'h8' },
    });
    const result = resolveAbility('bully_jabba', context);
    // With nothing in range the resolver returns a manual-message fallthrough.
    const keys = result.targetFigureKeys || [];
    assert.ok(!keys.includes('Gamorrean Guard-1-0'), 'out-of-range friendly excluded');
  });
});

// ── Bug 5: Incentivize (Jabba) — no affiliation condition ───────────────────────
// REVERSED 2026-09-02. This suite's June fix removed Incentivize's affiliation
// filter on the strength of combat-spec.csv's prose column ("an elite figure of
// your choice"). That was the wrong column: the same CSV row's affects_others
// column reads "a SCUM figure of your choice", and the card prints the Scum
// glyph. alexanbv 2026-09-02: "Jabba can only target SCUM figures. He can never
// target imperial figures. Elite is irrelevant." The filter is back, on
// affiliation rather than on elite. See jabba-scum-targeting.test.js.
describe('MEDFIX Incentivize (Jabba): only SCUM figures are selectable', () => {
  it('Agent Blaise (Imperial elite) is NOT enumerated; a Scum figure is', async () => {
    const { getDcEffects } = await import('../../../src/data-loader.js');
    const dcMessageMeta = new Map();
    const jabbaMsgId = 'msg_jabba';
    dcMessageMeta.set(jabbaMsgId, { gameId: GAME_ID, playerNum: 1, dcName: 'Jabba the Hutt', displayName: 'Jabba the Hutt [DG 1]' });
    // Non-Scum elite on the OPPONENT side; a Scum elite on the friendly side.
    const game = baseGame({
      figurePositions: {
        1: { 'Jabba the Hutt-1-0': 'a1', '4-LOM-1-0': 'a2' },
        2: { 'Agent Blaise-1-0': 'b3' },
      },
    });
    const context = {
      game, playerNum: 1,
      meta: dcMessageMeta.get(jabbaMsgId),
      msgId: jabbaMsgId,
      dcMessageMeta,
      getDcEffects,
    };
    const result = resolveAbility('incentivize_jabba', context);
    assert.strictEqual(result.applied, false);
    assert.strictEqual(result.requiresChoice, true);
    assert.ok(!result.targetFigureKeys.includes('Agent Blaise-1-0'),
      'an Imperial figure is never a legal Incentivize target, elite or not');
    assert.ok(result.targetFigureKeys.includes('4-LOM-1-0'),
      'the Scum figure is enumerated');
  });
});
