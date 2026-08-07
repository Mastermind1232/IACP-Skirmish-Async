/**
 * Droid Mastery (CC, CSV row 627) — J4X-7 companion deploy.
 *
 * CSV effect: "J4X-7 becomes Focused, then may interrupt to perform an attack;
 * if not in play, put J4X-7 into your space instead" (condition;companion_place).
 *
 * alexanbv 2026-06-20 ruling: "Droid Mastery should use the same companion deploy
 * as the other companions, like The Child." Since the sync ccEffect resolver has
 * no Discord client, it returns a deployCompanion DIRECTIVE that the async apply
 * layer (which HAS the client) acts on via post-deploy.deployCompanionFigure.
 *
 * Branch 1 (J4X-7 in play): Focus + free-attack bonus, no deploy directive.
 * Branch 2 (J4X-7 NOT in play): returns deployCompanion {J4X-7, atFigureKey:<Jarrod
 *   Kelvin>}, and deployCompanionFigure places the figure + host map.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAbility } from '../../../src/game/abilities.js';
import { deployCompanionFigure } from '../../../src/handlers/post-deploy.js';

function baseGame() {
  return {
    gameId: 'g-dm',
    figurePositions: { 1: {}, 2: {} },
  };
}

describe('Droid Mastery resolver — J4X-7 in play (Focus + free attack)', () => {
  it('Focuses J4X-7 and grants a pending free attack; NO deploy directive', () => {
    const game = baseGame();
    game.figurePositions[1] = { 'Jarrod Kelvin-1-0': 'b2', 'J4X-7-0-0': 'b3' };
    const dcMessageMeta = new Map([
      ['msg-j4x', { gameId: 'g-dm', playerNum: 1, dcName: 'J4X-7', displayName: 'J4X-7' }],
    ]);
    const result = resolveAbility('Droid Mastery', { game, playerNum: 1, dcMessageMeta });
    assert.equal(result.applied, true);
    assert.equal(result.deployCompanion, undefined, 'no deploy directive when J4X-7 already in play');
    // Focus condition applied to the in-play J4X-7 (the in-play branch).
    assert.ok((game.figureConditions?.['J4X-7-0-0'] || []).includes('Focus'), 'J4X-7 Focused');
  });
});

describe('Droid Mastery resolver — J4X-7 NOT in play (deploy directive)', () => {
  it('returns a deployCompanion directive anchored on Jarrod Kelvin', () => {
    const game = baseGame();
    game.figurePositions[1] = { 'Jarrod Kelvin-1-0': 'c4' };
    const dcMessageMeta = new Map();
    const result = resolveAbility('Droid Mastery', { game, playerNum: 1, dcMessageMeta });
    assert.equal(result.applied, true);
    assert.ok(result.deployCompanion, 'deploy directive returned when J4X-7 not in play');
    assert.equal(result.deployCompanion.companionName, 'J4X-7');
    assert.equal(result.deployCompanion.atFigureKey, 'Jarrod Kelvin-1-0', 'anchored on the host (Jarrod Kelvin)');
    assert.equal(result.deployCompanion.playerNum, 1);
  });

  it('no directive when neither J4X-7 nor Jarrod Kelvin is on the board', () => {
    const game = baseGame();
    const result = resolveAbility('Droid Mastery', { game, playerNum: 1, dcMessageMeta: new Map() });
    assert.equal(result.applied, true);
    assert.equal(result.deployCompanion, undefined, 'nothing to deploy without a host');
  });
});

describe('deployCompanionFigure — programmatic companion deploy (mirrors The Child path)', () => {
  it('places the companion at the host space + records the host map + builds the DC embed', async () => {
    const game = {
      gameId: 'g-dm2',
      figurePositions: { 1: { 'Jarrod Kelvin-1-0': 'd5' }, 2: {} },
      p1PlayAreaId: 'pa1',
      p1DcMessageIds: ['msg-host'],
      p1DcCompanionMessageIds: [null],
    };
    const dcMessageMeta = new Map([
      ['msg-host', { gameId: 'g-dm2', playerNum: 1, dcName: 'Jarrod Kelvin', displayName: 'Jarrod Kelvin [DG 1]' }],
    ]);
    // Capture the embed-build call to confirm the SAME companion-deploy routine runs.
    let embedBuilt = false;
    const sentMessages = [];
    const fakeChannel = { send: async (p) => { sentMessages.push(p); return { id: 'msg-comp', edit: async () => ({}) }; } };
    const client = { channels: { fetch: async () => fakeChannel } };
    const deps = {
      buildDcEmbedAndFiles: async () => { embedBuilt = true; return { embed: {}, files: [] }; },
      dcMessageMeta,
      dcExhaustedState: new Map(),
      dcHealthState: new Map(),
      getDcPlayAreaComponents: () => [],
      getNicknamesForDcMessage: () => undefined,
      logGameAction: async () => {},
    };
    const r = await deployCompanionFigure(
      game,
      { companionName: 'J4X-7', hostFigureKey: 'Jarrod Kelvin-1-0', playerNum: 1 },
      client,
      deps,
    );
    assert.equal(r.ok, true);
    assert.equal(r.companionKey, 'J4X-7-1-0');
    // Placed at the host's space ("your space").
    assert.equal(game.figurePositions[1]['J4X-7-1-0'], 'd5', 'J4X-7 placed in Jarrod Kelvin\'s space');
    // Host map recorded (same shape as handleCompanionDeployPick).
    assert.deepEqual(game.companionHostMap['J4X-7-1-0'], { hostFigureKey: 'Jarrod Kelvin-1-0', playerNum: 1 });
    // Companion registered at the host's index (parallel-array fallback).
    assert.equal(game.p1DcCompanionMessageIds[0], 'msg-comp', 'companion msgId stored at host index');
    assert.equal(embedBuilt, true, 'the SAME _createCompanionDcEmbed routine ran (DC embed built)');
  });

  it('no-op when the host is not on the board', async () => {
    const game = { gameId: 'g-dm3', figurePositions: { 1: {} } };
    const r = await deployCompanionFigure(game, { companionName: 'J4X-7', hostFigureKey: 'Jarrod Kelvin-1-0', playerNum: 1 }, {}, {});
    assert.equal(r.ok, false);
  });
});
