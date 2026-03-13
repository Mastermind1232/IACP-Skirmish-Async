/**
 * Fluent game builder for headless integration tests.
 *
 * Usage:
 *   const { game, harness, deps } = createTestGame()
 *     .withMap('mos-eisley-outskirts')
 *     .withPlayer1Army([{ dcName: 'Stormtrooper', count: 1 }])
 *     .withPlayer2Army([{ dcName: 'Rebel Saboteur', count: 1 }])
 *     .deployed()
 *     .inRound(1)
 *     .build();
 */

import { createHarness } from '../../src/headless/game-harness.js';
import { buildHeadlessDeps } from '../../src/headless/headless-deps.js';
import { initializeDcState, initializeFigurePositions } from '../../src/headless/init-dc-state.js';
import { getDcStats, getDeploymentZones, getMapSpaces } from '../../src/data-loader.js';
import { PHASES, ROUND_PHASES } from '../../src/game/phase.js';
import { isFigurelessDc } from '../../src/game/dc-helpers.js';

let gameIdCounter = 1;

export function createTestGame() {
  return new GameBuilder();
}

class GameBuilder {
  constructor() {
    this._mapId = 'mos-eisley-outskirts';
    this._p1Army = [];
    this._p2Army = [];
    this._deployed = false;
    this._round = 0;
    this._gameId = String(gameIdCounter++).padStart(5, '0');
    this._p1Id = 'player1';
    this._p2Id = 'player2';
    this._p1CcDeck = [];
    this._p2CcDeck = [];
    this._p1CcHand = [];
    this._p2CcHand = [];
  }

  withMap(mapId) { this._mapId = mapId; return this; }
  withGameId(id) { this._gameId = id; return this; }
  withPlayer1Id(id) { this._p1Id = id; return this; }
  withPlayer2Id(id) { this._p2Id = id; return this; }

  withPlayer1Army(army) { this._p1Army = army; return this; }
  withPlayer2Army(army) { this._p2Army = army; return this; }

  withPlayer1CcHand(cards) { this._p1CcHand = cards; return this; }
  withPlayer2CcHand(cards) { this._p2CcHand = cards; return this; }
  withPlayer1CcDeck(cards) { this._p1CcDeck = cards; return this; }
  withPlayer2CcDeck(cards) { this._p2CcDeck = cards; return this; }

  deployed() { this._deployed = true; return this; }
  inRound(n) { this._round = n; this._deployed = true; return this; }

  build() {
    const game = this._buildGame();
    const dcMessageMeta = new Map();
    const dcExhaustedState = new Map();
    const dcHealthState = new Map();

    // Initialize DC state
    initializeDcState(game, dcMessageMeta, dcExhaustedState, dcHealthState);

    // Build deps and harness
    const deps = buildHeadlessDeps({
      dcMessageMeta,
      dcExhaustedState,
      dcHealthState,
    });

    // If deployed, initialize figure positions
    if (this._deployed) {
      const deploymentZones = getDeploymentZones();
      const mapSpaces = getMapSpaces(this._mapId);
      initializeFigurePositions(game, dcMessageMeta, { deploymentZones, mapSpaces });
    }

    // Set up activations
    if (this._round > 0) {
      this._setupActivations(game, dcMessageMeta);
    }

    const harness = createHarness(game, { deps, dcMessageMeta, dcExhaustedState, dcHealthState });

    return { game: harness.getGame(), harness, deps, dcMessageMeta, dcExhaustedState, dcHealthState };
  }

  _buildDcList(army) {
    const dcList = [];
    for (const entry of army) {
      const dcName = entry.dcName || entry;
      const count = entry.count || 1;
      for (let dg = 0; dg < count; dg++) {
        const stats = getDcStats(dcName);
        const displayName = count > 1 ? `${dcName} [DG ${dg + 1}]` : dcName;
        const figureCount = stats?.figures ?? 1;
        const maxHp = stats?.health ?? 1;
        const healthState = [];
        for (let f = 0; f < figureCount; f++) {
          healthState.push([maxHp, maxHp]);
        }
        dcList.push({
          dcName,
          displayName,
          healthState,
          cost: stats?.cost ?? 0,
        });
      }
    }
    return dcList;
  }

  _buildGame() {
    const p1DcList = this._buildDcList(this._p1Army);
    const p2DcList = this._buildDcList(this._p2Army);

    const game = {
      gameId: this._gameId,
      player1Id: this._p1Id,
      player2Id: this._p2Id,
      selectedMap: { id: this._mapId },
      round: this._round || 1,
      ended: false,

      // Squads
      player1Squad: { dcList: p1DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName })) },
      player2Squad: { dcList: p2DcList.map(d => ({ dcName: d.dcName, displayName: d.displayName })) },
      p1DcList,
      p2DcList,

      // VP
      player1VP: { total: 0, kills: 0, objectives: 0 },
      player2VP: { total: 0, kills: 0, objectives: 0 },

      // Figure positions
      figurePositions: { 1: {}, 2: {} },

      // CC state
      player1CcHand: [...this._p1CcHand],
      player2CcHand: [...this._p2CcHand],
      player1CcDeck: [...this._p1CcDeck],
      player2CcDeck: [...this._p2CcDeck],
      player1CcDiscard: [],
      player2CcDiscard: [],
      player1CcDrawn: true,
      player2CcDrawn: true,

      // Initiative
      initiativePlayerId: this._p1Id,

      // Deployment zones
      player1DeploymentZone: 'red',
      player2DeploymentZone: 'blue',

      // Damage tracking
      totalDamageReceived: { 1: 0, 2: 0 },

      // Undo
      undoStack: [],
    };

    // Set phase based on build config
    if (this._round > 0) {
      game.phase = PHASES.ROUND_ACTIVE;
      game.roundPhase = ROUND_PHASES.ACTIVATION;
      game.currentActivationTurnPlayerId = this._p1Id;
    } else if (this._deployed) {
      game.phase = PHASES.ROUND_ACTIVE;
      game.roundPhase = ROUND_PHASES.START_OF_ROUND;
    } else {
      game.phase = PHASES.LOBBY;
    }

    return game;
  }

  _setupActivations(game, dcMessageMeta) {
    // Count non-figureless DCs for each player
    let p1Acts = 0, p2Acts = 0;
    for (const [msgId, meta] of dcMessageMeta) {
      if (meta.gameId !== game.gameId) continue;
      if (isFigurelessDc(meta.dcName)) continue;
      if (meta.playerNum === 1) p1Acts++;
      else p2Acts++;
    }

    game.p1ActivationsRemaining = p1Acts;
    game.p2ActivationsRemaining = p2Acts;
    game.p1ActivationsTotal = p1Acts;
    game.p2ActivationsTotal = p2Acts;
    game.p1ActivatedDcIndices = [];
    game.p2ActivatedDcIndices = [];

    // Initialize dcActionsData — each DC starts with 0 actions (not activated yet)
    game.dcActionsData = {};
  }
}
